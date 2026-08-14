# ── routes/admin_assignment_routes.py — Lead assignment (split from admin_routes.py) ──
import logging

logger = logging.getLogger(__name__)
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

import models
from database import get_db
from auth import require_admin
from routes._admin_helpers import _get_active_lead_cap, _active_lead_count

router = APIRouter(prefix="/api/admin", tags=["Admin – Assignments"])


def _has_valid_phone(phone_val):
    """Check if a phone string contains at least 7 digits (a callable number)."""
    if not phone_val:
        return False
    digits = ''.join(c for c in str(phone_val) if c.isdigit())
    return len(digits) >= 7


# ── Lead Assignment ──────────────────────────────────────────────────────────

@router.get("/leads/unassigned")
def get_unassigned_leads(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    from sqlalchemy import text
    rows = db.execute(text("""
        SELECT l.id, l.first_name, l.last_name, l.email, l.company, l.status,
               l.closed_reason, l.created_at, l.call_attempt_count
        FROM leads l
        LEFT JOIN lead_assignments la ON la.lead_id = l.id
        WHERE la.lead_id IS NULL
        ORDER BY l.created_at DESC
        LIMIT 5000
    """)).fetchall()
    return [{
        "id": r.id, "first_name": r.first_name, "last_name": r.last_name,
        "email": r.email, "company": r.company, "status": r.status,
        "closed_reason": r.closed_reason,
        "created_at": str(r.created_at) if r.created_at else None,
        "call_count": r.call_attempt_count or 0, "assigned_to": [],
    } for r in rows]


@router.get("/leads/assigned")
def get_assigned_leads(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    from sqlalchemy import text
    rows = db.execute(text("""
        SELECT l.id, l.first_name, l.last_name, l.email, l.company, l.status,
               l.closed_reason, l.created_at, l.call_attempt_count,
               string_agg(u.id || '::' || COALESCE(u.name,''), '||') AS users_agg
        FROM leads l
        INNER JOIN lead_assignments la ON la.lead_id = l.id
        INNER JOIN users u ON u.id = la.user_id
        GROUP BY l.id, l.first_name, l.last_name, l.email, l.company, l.status,
                 l.closed_reason, l.created_at, l.call_attempt_count
        ORDER BY l.created_at DESC
        LIMIT 5000
    """)).fetchall()

    result = []
    for r in rows:
        assigned_to = []
        if r.users_agg:
            for pair in r.users_agg.split("||"):
                parts = pair.split("::", 1)
                if len(parts) == 2:
                    assigned_to.append({"id": parts[0], "name": parts[1]})
        result.append({
            "id": r.id, "first_name": r.first_name, "last_name": r.last_name,
            "email": r.email, "company": r.company, "status": r.status,
            "closed_reason": r.closed_reason,
            "created_at": str(r.created_at) if r.created_at else None,
            "call_count": r.call_attempt_count or 0, "assigned_to": assigned_to,
        })
    return result


@router.post("/assignments/bulk-assign")
def bulk_assign(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    user_id  = body.get("user_id")
    lead_ids = body.get("lead_ids", [])
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Pod Admin can only assign to SDRs/AEs in their pod
    if admin.get("role") == "Pod Admin":
        admin_user = db.query(models.User).filter(models.User.id == admin["sub"]).first()
        if admin_user and user.pod_id != admin_user.pod_id:
            raise HTTPException(status_code=403, detail="Pod Admin can only assign leads to users within their POD")

    assigned = []
    skipped_pod_lock = []
    skipped_cap = []
    skipped_no_phone = []
    for lid in lead_ids:
        lead = db.query(models.Lead).filter(models.Lead.id == lid).first()
        if not lead:
            continue
        # Skip parked leads (no phone) — they shouldn't be assigned to SDRs
        if lead.status in models.PARKED_STATUSES or not _has_valid_phone(lead.phone):
            skipped_no_phone.append(lid)
            continue
        # Pod-lock: if lead is already assigned to someone in a different pod, skip
        if lead.assigned_users:
            existing_pods = {u.pod_id for u in lead.assigned_users if u.pod_id}
            if existing_pods and user.pod_id not in existing_pods:
                skipped_pod_lock.append(lid)
                continue
        # Lead cap: skip if SDR already at max active leads (per-pod cap)
        cap = _get_active_lead_cap(db, user)
        if cap == 0:  # pause mode
            skipped_cap.append(lid)
            continue
        if _active_lead_count(user) >= cap:
            skipped_cap.append(lid)
            continue
        if models.assign_lead(user, lead):
            # Set lead_started_at if not already set
            if not lead.lead_started_at:
                from datetime import datetime, timezone
                lead.lead_started_at = datetime.now(timezone.utc)
            assigned.append(lid)
            # NOTE: AE cascade to Pod Admin removed (v10).
            # Pod Admins see AE leads via pod scoping in lead_helpers.py.
    db.commit()
    cap_display = _get_active_lead_cap(db, user)
    msg = f"{len(assigned)} leads assigned to {user.name}"
    if skipped_no_phone:
        msg += f". {len(skipped_no_phone)} skipped (no phone number)."
    if skipped_pod_lock:
        msg += f". {len(skipped_pod_lock)} skipped (assigned to another POD)."
    if skipped_cap:
        msg += f" {len(skipped_cap)} skipped (user at max {cap_display} active leads)."
    return {"message": msg, "assigned": assigned, "pod_locked": skipped_pod_lock, "cap_reached": skipped_cap, "no_phone": skipped_no_phone}


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
    ).all()
    if not unassigned_leads:
        return {"message": "No unassigned leads found"}

    # Pod Admin: only assign to their pod's SDRs/AEs
    if admin.get("role") == "Pod Admin":
        admin_user = db.query(models.User).filter(models.User.id == admin["sub"]).first()
        sdrs = db.query(models.User).filter(
            models.User.role.in_(["SDR", "AE"]),
            models.User.pod_id == admin_user.pod_id
        ).all() if admin_user else []
    else:
        sdrs = db.query(models.User).filter(models.User.role.in_(["SDR", "AE"])).all()

    if not sdrs:
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
    sdr_idx = 0
    sdr_count = len(sdrs)
    full_sdrs = set()

    for batch in assignment_batches:
        if len(full_sdrs) == sdr_count:
            skipped += len(batch)
            continue

        placed = False
        for attempt in range(sdr_count):
            sdr = sdrs[(sdr_idx + attempt) % sdr_count]
            if sdr.id in full_sdrs:
                continue
            cap = _get_active_lead_cap(db, sdr)
            if cap == 0:
                full_sdrs.add(sdr.id)
                continue
            current = _active_lead_count(sdr)
            if current >= cap:
                full_sdrs.add(sdr.id)
                continue

            batch_assigned = 0
            for lead in batch:
                if cap > 0 and (current + batch_assigned) >= cap:
                    break
                if models.assign_lead(sdr, lead):
                    if not lead.lead_started_at:
                        from datetime import datetime, timezone
                        lead.lead_started_at = datetime.now(timezone.utc)
                    batch_assigned += 1
                    # NOTE: AE cascade to Pod Admin removed (v10).
                    # Pod Admins see AE leads via pod scoping in lead_helpers.py.

            count += batch_assigned
            skipped += len(batch) - batch_assigned
            sdr_idx = (sdr_idx + attempt + 1) % sdr_count
            placed = True
            break

        if not placed:
            skipped += len(batch)

    db.commit()
    msg = f"Successfully auto-assigned {count} leads across {sdr_count} users"
    if skipped:
        msg += f". {skipped} leads skipped (all users at capacity)."
    return {"message": msg, "assigned_count": count, "skipped": skipped}


@router.delete("/assignments/{user_id}/{lead_id}")
def unassign_lead(user_id: str, lead_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    # Pod Admin can only unassign users in their pod
    if admin.get("role") == "Pod Admin":
        target_user = db.query(models.User).filter(models.User.id == user_id).first()
        admin_user = db.query(models.User).filter(models.User.id == admin["sub"]).first()
        if target_user and admin_user and target_user.pod_id != admin_user.pod_id:
            raise HTTPException(status_code=403, detail="You can only unassign leads from users in your POD.")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if lead and lead in user.assigned_leads:
        user.assigned_leads.remove(lead)
        # NOTE: AE cascade-unassign removed (v10). Pod Admins not in lead_assignments.
        db.commit()
    return {"ok": True}


@router.post("/assignments/bulk-unassign")
def bulk_unassign(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Remove ALL assignments for the given lead IDs."""
    lead_ids = body.get("lead_ids", [])
    if not lead_ids:
        raise HTTPException(status_code=400, detail="No lead IDs provided")

    count = 0
    for lid in lead_ids:
        lead = db.query(models.Lead).options(
            joinedload(models.Lead.assigned_users)
        ).filter(models.Lead.id == lid).first()
        if not lead or not lead.assigned_users:
            continue

        # Pod Admin: can only unassign leads belonging to their pod's SDRs/AEs
        if admin.get("role") == "Pod Admin":
            admin_user = db.query(models.User).filter(models.User.id == admin["sub"]).first()
            pod_id = admin_user.pod_id if admin_user else None
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
    return {"message": f"{count} leads unassigned", "count": count}


@router.post("/leads/bulk-delete")
def bulk_delete_leads(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Permanently delete multiple leads. Cascades to assignments, notes, calls, tasks, status logs."""
    lead_ids = body.get("lead_ids", [])
    if not lead_ids:
        raise HTTPException(status_code=400, detail="No lead IDs provided")

    # Only Super Admin can bulk delete
    if admin.get("role") not in ("Super Admin", "Admin"):
        raise HTTPException(status_code=403, detail="Only Super Admins can delete leads")

    count = 0
    for lid in lead_ids:
        lead = db.query(models.Lead).filter(models.Lead.id == lid).first()
        if lead:
            # Manually delete child records that lack cascade relationships
            db.query(models.LeadEmailActivity).filter(models.LeadEmailActivity.lead_id == lid).delete()
            db.query(models.EmailThread).filter(models.EmailThread.lead_id == lid).delete()
            db.query(models.DialerCall).filter(models.DialerCall.lead_id == lid).delete()
            db.delete(lead)
            count += 1
    db.commit()
    return {"message": f"{count} leads permanently deleted", "count": count}
