# ── routes/admin_assignment_routes.py — Lead assignment (split from admin_routes.py) ──
import logging

logger = logging.getLogger(__name__)
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

import ownership_history as oh
import access_db
import models
from database import get_db
from auth import require_admin, require_pod_admin_or_above, require_export_access
from routes._admin_helpers import LEAD_CSV_FIELDS

router = APIRouter(prefix="/api/admin", tags=["Admin – Assignments"])

# RCA 2026-09-03: both list endpoints below used to return every row up to a
# hardcoded LIMIT 5000 on every Control Center Lead Assignments mount (and
# again after every assign/unassign) — a real perf hit the audit flagged as
# the likely cause of "every Control Center tab feels slow". Paginated the
# same way GET /leads already is (lead_routes.py's page/per_page/{data,
# total, pages} contract).
_PER_PAGE_DEFAULT = 50
_PER_PAGE_MAX = 200


def _has_valid_phone(phone_val):
    """Check if a phone string contains at least 7 digits (a callable number)."""
    if not phone_val:
        return False
    digits = ''.join(c for c in str(phone_val) if c.isdigit())
    return len(digits) >= 7


# ── Lead Assignment ──────────────────────────────────────────────────────────

def _pod_sql(admin, alias="l"):
    """(sql, params) limiting a raw lead query to a Pod Admin's own pod; nothing for Super Admin/Admin.
    A Pod Admin with no pod resolves to NO_POD, which matches no lead."""
    if admin.get("role") != "Pod Admin":
        return "", {}
    return f" AND {alias}.pod_id = :_pod", {"_pod": access_db.pod_of(admin)}


@router.get("/leads/unassigned")
def get_unassigned_leads(
    page: int = Query(1, ge=1),
    per_page: int = Query(_PER_PAGE_DEFAULT, ge=1, le=_PER_PAGE_MAX),
    db: Session = Depends(get_db), admin: dict = Depends(require_admin),
):
    from sqlalchemy import text
    # v13.12.1: a Pod Admin only sees their own pod's leads (this was the whole org's names/emails/companies)
    pod_sql, pod_args = _pod_sql(admin)
    total = db.execute(text(f"""
        SELECT COUNT(*) FROM leads l
        LEFT JOIN lead_assignments la ON la.lead_id = l.id
        WHERE la.lead_id IS NULL {pod_sql}
    """), pod_args).scalar() or 0
    rows = db.execute(text(f"""
        SELECT l.id, l.first_name, l.last_name, l.email, l.company, l.status,
               l.closed_reason, l.created_at, l.call_attempt_count
        FROM leads l
        LEFT JOIN lead_assignments la ON la.lead_id = l.id
        WHERE la.lead_id IS NULL {pod_sql}
        ORDER BY l.created_at DESC
        LIMIT :per_page OFFSET :offset
    """), {"per_page": per_page, "offset": (page - 1) * per_page, **pod_args}).fetchall()
    data = [{
        "id": r.id, "first_name": r.first_name, "last_name": r.last_name,
        "email": r.email, "company": r.company, "status": r.status,
        "closed_reason": r.closed_reason,
        "created_at": str(r.created_at) if r.created_at else None,
        "call_count": r.call_attempt_count or 0, "assigned_to": [],
    } for r in rows]
    return {"data": data, "total": total, "page": page, "per_page": per_page,
            "pages": max(1, (total + per_page - 1) // per_page)}


@router.get("/leads/assigned")
def get_assigned_leads(
    page: int = Query(1, ge=1),
    per_page: int = Query(_PER_PAGE_DEFAULT, ge=1, le=_PER_PAGE_MAX),
    assigned_to: str = Query(None, description="Filter to leads assigned to this user_id"),
    db: Session = Depends(get_db), admin: dict = Depends(require_admin),
):
    from sqlalchemy import text
    # Filtering to one assignee's leads still has to show every co-assignee
    # in `assigned_to` (a lead can have several) — so the filter picks WHICH
    # leads qualify via a subquery, rather than narrowing the outer join's
    # rows (which would hide co-assignees from string_agg).
    pod_sql, pod_args = _pod_sql(admin, alias="l2")
    qualifying_ids = f"""
        SELECT DISTINCT la2.lead_id FROM lead_assignments la2
        INNER JOIN leads l2 ON l2.id = la2.lead_id
        WHERE (:assigned_to IS NULL OR la2.user_id = :assigned_to) {pod_sql}
    """
    params = {"per_page": per_page, "offset": (page - 1) * per_page, "assigned_to": assigned_to, **pod_args}

    total = db.execute(text(f"SELECT COUNT(*) FROM ({qualifying_ids}) q"), params).scalar() or 0

    rows = db.execute(text(f"""
        SELECT l.id, l.first_name, l.last_name, l.email, l.company, l.status,
               l.closed_reason, l.created_at, l.call_attempt_count,
               string_agg(u.id || '::' || COALESCE(u.name,''), '||') AS users_agg
        FROM leads l
        INNER JOIN lead_assignments la ON la.lead_id = l.id
        INNER JOIN users u ON u.id = la.user_id
        WHERE l.id IN ({qualifying_ids})
        GROUP BY l.id, l.first_name, l.last_name, l.email, l.company, l.status,
                 l.closed_reason, l.created_at, l.call_attempt_count
        ORDER BY l.created_at DESC
        LIMIT :per_page OFFSET :offset
    """), params).fetchall()

    data = []
    for r in rows:
        assigned_to_list = []
        if r.users_agg:
            for pair in r.users_agg.split("||"):
                parts = pair.split("::", 1)
                if len(parts) == 2:
                    assigned_to_list.append({"id": parts[0], "name": parts[1]})
        data.append({
            "id": r.id, "first_name": r.first_name, "last_name": r.last_name,
            "email": r.email, "company": r.company, "status": r.status,
            "closed_reason": r.closed_reason,
            "created_at": str(r.created_at) if r.created_at else None,
            "call_count": r.call_attempt_count or 0, "assigned_to": assigned_to_list,
        })
    return {"data": data, "total": total, "page": page, "per_page": per_page,
            "pages": max(1, (total + per_page - 1) // per_page)}


@router.get("/leads/export", dependencies=[Depends(require_export_access)])
def export_leads_by_sdr(
    assigned_to: Optional[List[str]] = Query(None, description="Export leads assigned to these user_id(s) — one or more"),
    upload_log_id: str = Query(None, description="Export leads from this upload batch"),
    date_from: str = Query(None, description="Export leads created on/after this date (yyyy-mm-dd)"),
    date_to: str = Query(None, description="Export leads created on/before this date (yyyy-mm-dd)"),
    db: Session = Depends(get_db), admin: dict = Depends(require_admin),
):
    """Control Center → Data → 'Export Leads': full lead-field CSV, filterable
    by SDR(s), upload batch, and/or a created_at date range (any combination —
    at least one is required, to guard against an accidental unfiltered
    full-table export now that SDR alone isn't mandatory)."""
    import csv
    import io
    from datetime import datetime as dt
    from fastapi.responses import StreamingResponse

    if not (assigned_to or upload_log_id or date_from or date_to):
        raise HTTPException(status_code=400, detail="Choose at least one filter (SDR, upload batch, or date range) before exporting.")

    # RCA 2026-09-29: was db.query(Lead) — a Pod Admin could export every
    # pod's leads. Same visibility as the Leads list (Pod Admin: own pod;
    # no global_view for bulk export — user decision 2026-09-29).
    from routes.lead_helpers import _build_lead_query
    query = _build_lead_query(db, admin)
    filename_parts = []

    if assigned_to:
        users = db.query(models.User).filter(models.User.id.in_(assigned_to)).all()
        if not users:
            raise HTTPException(status_code=404, detail="User not found")
        query = query.join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id) \
            .filter(models.lead_assignments.c.user_id.in_(assigned_to)).distinct()
        names = ["".join(c for c in (u.name or u.email) if c.isalnum() or c in " _-").strip() or u.id for u in users]
        if len(names) > 2:
            filename_parts.append(f"{names[0]}_{names[1]}_plus{len(names) - 2}more")
        else:
            filename_parts.append("_".join(names))

    if upload_log_id:
        query = query.filter(models.Lead.upload_log_id == upload_log_id)

    if date_from:
        try:
            query = query.filter(models.Lead.created_at >= dt.fromisoformat(date_from))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from — expected yyyy-mm-dd.")
    if date_to:
        try:
            end_of_day = dt.fromisoformat(date_to).replace(hour=23, minute=59, second=59, microsecond=999999)
            query = query.filter(models.Lead.created_at <= end_of_day)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to — expected yyyy-mm-dd.")

    export_fields = LEAD_CSV_FIELDS + ["status"]

    def generate():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(export_fields + ["created_at", "call_attempt_count"])
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        for lead in query.yield_per(500):
            writer.writerow(
                [getattr(lead, f) or "" for f in export_fields]
                + [str(lead.created_at) if lead.created_at else "", lead.call_attempt_count or 0]
            )
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    filename = f"leads_{'_'.join(filename_parts) or 'export'}_{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/assignments/bulk-assign")
def bulk_assign(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    user_id  = body.get("user_id")
    lead_ids = body.get("lead_ids", [])
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Pod Admin can only assign to SDRs/AEs in their pod
    if admin.get("role") == "Pod Admin":
        pod = access_db.pod_of(admin)          # resolved per request; a pod-less admin matches nobody
        if user.pod_id != pod:
            raise HTTPException(status_code=403, detail="Pod Admin can only assign leads to users within their POD")

    assigned = []
    skipped_pod_lock = []
    skipped_no_phone = []
    for lid in lead_ids:
        lead = db.query(models.Lead).filter(models.Lead.id == lid).first()
        if not lead:
            continue
        # Skip parked leads (no phone) — they shouldn't be assigned to SDRs
        if lead.status in models.PARKED_STATUSES or not _has_valid_phone(lead.phone):
            skipped_no_phone.append(lid)
            continue
        # Pod-lock: Pod Admins can't reassign a lead out of another pod's
        # territory. Super Admin/Admin bypass this — RCA 2026-08-24: this
        # check used to run for every caller, so it also silently blocked
        # reassigning a lead away from a departed SDR whose stale pod_id
        # differs from the target's (there's no "departed" concept on User;
        # the lock can't tell that case apart from "active SDR, other pod").
        if admin.get("role") == "Pod Admin" and lead.assigned_users:
            existing_pods = {u.pod_id for u in lead.assigned_users if u.pod_id}
            if existing_pods and user.pod_id not in existing_pods:
                skipped_pod_lock.append(lid)
                continue
        if models.assign_lead(user, lead, reason=oh.R_BULK, actor_id=admin["sub"]):
            # Set lead_started_at if not already set
            if not lead.lead_started_at:
                from datetime import datetime, timezone
                lead.lead_started_at = datetime.now(timezone.utc)
            assigned.append(lid)
            # NOTE: AE cascade to Pod Admin removed (v10).
            # Pod Admins see AE leads via pod scoping in lead_helpers.py.
    db.commit()
    if assigned:
        # RCA 2026-08-25: this route never busted the my_leads/leads_page caches
        # cache.py's own invariant (see its TTL table comment) requires this on
        # any route that assigns a lead — without it, the assignee's "My Leads"
        # and the admin "All Leads" view can serve a stale pre-assignment
        # snapshot for up to the cache's TTL after a successful reassignment.
        from cache import invalidate
        invalidate('my_leads'); invalidate('leads_count'); invalidate('leads_page')
    msg = f"{len(assigned)} leads assigned to {user.name}"
    if skipped_no_phone:
        msg += f". {len(skipped_no_phone)} skipped (no phone number)."
    if skipped_pod_lock:
        msg += f". {len(skipped_pod_lock)} skipped (assigned to another POD)."
    return {"message": msg, "assigned": assigned, "pod_locked": skipped_pod_lock, "no_phone": skipped_no_phone}


@router.post("/assignments/auto-assign-all")
def auto_assign_all(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Distribute ALL unassigned leads across SDRs using Round Robin."""
    assigned_ids_query = db.query(models.lead_assignments.c.lead_id).distinct()
    unassigned_leads = db.query(models.Lead).filter(
        ~models.Lead.id.in_(assigned_ids_query),
        # Exclude parked leads (no phone) from auto-assignment
        ~models.Lead.status.in_(models.PARKED_STATUSES),
        # Extra safety: skip leads with no callable phone even if status wasn't updated
        models.Lead.phone.isnot(None),
        models.Lead.phone != "",
    )
    is_pod_admin = admin.get("role") == "Pod Admin"
    pod = access_db.pod_of(admin)
    if is_pod_admin:       # only their own pod's pool, and only to their own pod's reps
        unassigned_leads = unassigned_leads.filter(models.Lead.pod_id == pod)
    unassigned_leads = unassigned_leads.all()
    if not unassigned_leads:
        return {"message": "No unassigned leads found"}

    sdr_q = db.query(models.User).filter(models.User.role.in_(["SDR", "AE"]))
    sdrs = (sdr_q.filter(models.User.pod_id == pod) if is_pod_admin else sdr_q).all()

    if not sdrs and not is_pod_admin:      # (never fall back to "everyone" for a Pod Admin — that included other pods and admins)
        sdrs = db.query(models.User).all()
    if not sdrs:
        raise HTTPException(status_code=400, detail="No users found to assign leads to")

    # ── Company-grouped round-robin ────────────────────────────────────────
    # Group leads by company so all contacts from the same company go to one SDR
    from collections import OrderedDict
    company_groups = OrderedDict()
    no_company = []

    for lead in unassigned_leads:
        company_key = (lead.company or "").strip().lower()
        if company_key:
            company_groups.setdefault(company_key, []).append(lead)
        else:
            no_company.append(lead)

    # Company groups first, then ungrouped leads one at a time
    assignment_batches = list(company_groups.values()) + [[l] for l in no_company]

    count = 0
    skipped = 0
    sdr_count = len(sdrs)

    for i, batch in enumerate(assignment_batches):
        sdr = sdrs[i % sdr_count]
        batch_assigned = 0
        for lead in batch:
            if models.assign_lead(sdr, lead, reason=oh.R_AUTO, actor_id=admin["sub"]):
                if not lead.lead_started_at:
                    from datetime import datetime, timezone
                    lead.lead_started_at = datetime.now(timezone.utc)
                batch_assigned += 1
                # NOTE: AE cascade to Pod Admin removed (v10).
                # Pod Admins see AE leads via pod scoping in lead_helpers.py.
        count += batch_assigned
        skipped += len(batch) - batch_assigned

    db.commit()
    if count:
        from cache import invalidate
        invalidate('my_leads'); invalidate('leads_count'); invalidate('leads_page')
    msg = f"Successfully auto-assigned {count} leads across {sdr_count} users"
    return {"message": msg, "assigned_count": count, "skipped": skipped}


@router.delete("/assignments/{user_id}/{lead_id}")
def unassign_lead(user_id: str, lead_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    # Pod Admin can only unassign users in their pod
    if admin.get("role") == "Pod Admin":
        target_user = db.query(models.User).filter(models.User.id == user_id).first()
        if target_user and target_user.pod_id != (access_db.pod_of(admin)):
            raise HTTPException(status_code=403, detail="You can only unassign leads from users in your POD.")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if lead and lead in user.assigned_leads:
        oh.set_assignment_context(db, oh.R_UNASSIGN, admin["sub"])
        user.assigned_leads.remove(lead)
        # NOTE: AE cascade-unassign removed (v10). Pod Admins not in lead_assignments.
        db.commit()
        from cache import invalidate
        invalidate('my_leads'); invalidate('leads_count'); invalidate('leads_page')
    return {"ok": True}


@router.post("/assignments/bulk-unassign")
def bulk_unassign(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Remove ALL assignments for the given lead IDs."""
    lead_ids = body.get("lead_ids", [])
    if not lead_ids:
        raise HTTPException(status_code=400, detail="No lead IDs provided")

    oh.set_assignment_context(db, oh.R_BULK_UNASSIGN, admin["sub"])
    count = 0
    for lid in lead_ids:
        lead = db.query(models.Lead).options(
            joinedload(models.Lead.assigned_users)
        ).filter(models.Lead.id == lid).first()
        if not lead or not lead.assigned_users:
            continue

        # Pod Admin: can only unassign leads belonging to their pod's SDRs/AEs
        if admin.get("role") == "Pod Admin":
            pod_id = access_db.pod_of(admin)
            # Only remove users in this admin's pod
            to_remove = [u for u in lead.assigned_users if u.pod_id == pod_id]
            for u in to_remove:
                lead.assigned_users.remove(u)
                # NOTE: AE cascade-unassign removed (v10). Pod Admins not in lead_assignments.
            if to_remove:
                count += 1
        else:
            # Super Admin bulk clear — simply clear all assignments
            lead.assigned_users.clear()
            count += 1

    db.commit()
    if count:
        from cache import invalidate
        invalidate('my_leads'); invalidate('leads_count'); invalidate('leads_page')
    return {"message": f"{count} leads unassigned", "count": count}


@router.post("/leads/bulk-delete")
def bulk_delete_leads(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_pod_admin_or_above)):
    """Soft-delete multiple leads — sets Lead.deleted_at, never a real DELETE.

    RCA 2026-08-17: this used to hard-delete the row and cascade manual
    cleanup of LeadEmailActivity/EmailThread/DialerCall. Per explicit
    product decision, lead deletion is always soft: the row and every
    related call/note/email is kept, just excluded from listings, kanban,
    dashboards, and analytics (see models.exclude_deleted_leads(), threaded
    through routes/lead_helpers.py::_build_lead_query and
    routes/analytics_routes.py). Role gate widened from Super Admin/Admin
    only to require_pod_admin_or_above — the frontend's Delete Lead button
    (lead_detail.js) already shows for Pod Admins too; the backend was
    silently 403ing them."""
    lead_ids = body.get("lead_ids", [])
    if not lead_ids:
        raise HTTPException(status_code=400, detail="No lead IDs provided")

    # Pod Admin: only their pod's leads — unassigned, or assigned to one of
    # their own pod's users. RCA 2026-08-26: this filter didn't exist at all
    # — role check alone (require_pod_admin_or_above) let a Pod Admin delete
    # ANY lead_id in the system, not just their own pod's. Mirrors
    # bulk_unassign's exact scoping rule immediately above, and
    # lead_helpers._can_modify_lead's "unassigned or my pod" rule everywhere
    # else in the codebase — unauthorized IDs are silently skipped, not
    # errored, same as bulk_unassign does for a mixed selection.
    if admin.get("role") == "Pod Admin":
        pod_id = access_db.pod_of(admin)
        candidates = (
            db.query(models.Lead)
            .options(joinedload(models.Lead.assigned_users))
            .filter(models.Lead.id.in_(lead_ids), models.Lead.deleted_at.is_(None))
            .all()
        )
        lead_ids = [
            l.id for l in candidates
            if (any(u.pod_id == pod_id for u in l.assigned_users) if l.assigned_users else l.pod_id == pod_id)
        ]

    now = datetime.now(timezone.utc)
    lead_ids = [row[0] for row in db.query(models.Lead.id).filter(
        models.Lead.id.in_(lead_ids), models.Lead.deleted_at.is_(None)).all()] if lead_ids else []
    count = (
        db.query(models.Lead)
        .filter(models.Lead.id.in_(lead_ids))
        .update({"deleted_at": now}, synchronize_session=False)
    ) if lead_ids else 0
    # A deleted lead must stop receiving cadence sends, close any parked
    # drafts, and leave Instantly — not keep running in the background.
    from journey_engine.engine import exit_active_enrollments
    for lead_id in lead_ids:
        exit_active_enrollments(db, lead_id, "lead_deleted")
    db.commit()
    if count:
        from cache import invalidate
        invalidate('my_leads'); invalidate('leads_count'); invalidate('leads_page')
    return {"message": f"{count} lead(s) deleted", "count": count}
