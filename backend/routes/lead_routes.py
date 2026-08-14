# ── routes/lead_routes.py — Lead CRUD, research, kanban ────────────────────────
import threading
import hmac
import hashlib
import base64
from urllib.parse import quote
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, subqueryload, selectinload, lazyload
from sqlalchemy import func, or_
from typing import Optional, List

import models
from models import log_status_change, TERMINAL_STATUSES, ACTIVE_STATUSES, COMPANY_RESOLVED_OUTCOMES, PARKED_STATUSES
from database import get_db
from auth import get_current_user
from salesforce import get_sf_client, push_lead_to_salesforce, create_new_lead_in_salesforce, lead_push_info
import logging

logger = logging.getLogger(__name__)


def _logged_call_count(db: Session, lead_id: str) -> int:
    """Calls logged for a lead — manual CallLog rows plus dialer calls that
    got an outcome attached directly to DialerCall (no separate CallLog is
    created for those, see call_routes.py's dialer-attach path). Counting
    CallLog alone undercounts any lead whose calls were all made via the
    in-app dialer."""
    manual = db.query(models.CallLog).filter(models.CallLog.lead_id == lead_id).count()
    dialer = db.query(models.DialerCall).filter(
        models.DialerCall.lead_id == lead_id,
        models.DialerCall.outcome.isnot(None),
    ).count()
    return manual + dialer

router = APIRouter(prefix="/api", tags=["Leads"])

ALL_STATUSES = [s.value for s in models.Status]
RESEARCH_FIELDS = [
    "research_company", "research_contact", "research_hypothesis", "research_personalization",
    "research_industry", "research_company_size", "research_services",
    "research_geo", "research_timezone", "research_hook", "research_channels",
]

STATUS_ORDER = [
    "Lead Assigned", "Research", "Calling", "Meeting Scheduled",
    "1st Discovery Meeting", "Discovery Complete",
    "Demo Scheduled", "Demo Done", "Pending Review", "Completed",
]

PER_PAGE_DEFAULT = 20
PER_PAGE_MAX = 100


from routes.lead_helpers import (
    _is_backward_move, _get_company_resolution, _batch_company_resolutions,
    _batch_latest_activity, _batch_last_outbound_email, _lead_to_summary, _get_cached_settings, _lead_to_dict,
    _build_lead_query, _can_modify_lead, _apply_filters, SUMMARY_COLUMNS,
)


# ── Unified calendar ─────────────────────────────────────────────────────────

@router.get("/meetings")
def list_meetings(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    global_view: bool = Query(False, description="Pod Admin only: bypass pod scoping to see all meetings"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Leads with an active scheduled meeting, scoped by role like /leads
    (Super Admin: all, Pod Admin: own pod unless global_view, SDR/AE: own
    assigned leads). Filters on status == "Meeting Scheduled" (not just the
    timestamp) so a lead that moved on (won/lost/disqualified/rescheduled
    off-stage) doesn't linger on the calendar forever."""
    base = _build_lead_query(db, user, global_view=global_view)
    q = base.filter(
        models.Lead.status == "Meeting Scheduled",
        models.Lead.meeting_scheduled_at.isnot(None),
    ).options(joinedload(models.Lead.assigned_users))
    # JS's toISOString() always ends in "Z", which datetime.fromisoformat()
    # cannot parse on this Python version (raises ValueError, silently swallowed
    # below) -- the date filters were never actually applying. RCA 2026-07-14.
    if date_from:
        try:
            q = q.filter(models.Lead.meeting_scheduled_at >= datetime.fromisoformat(date_from.replace("Z", "+00:00")))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(models.Lead.meeting_scheduled_at <= datetime.fromisoformat(date_to.replace("Z", "+00:00")))
        except ValueError:
            pass

    leads = q.order_by(models.Lead.meeting_scheduled_at.asc()).all()
    return {
        "meetings": [
            {
                "lead_id": l.id,
                "lead_name": f"{l.first_name or ''} {l.last_name or ''}".strip(),
                "company": l.company,
                "phone": l.phone,
                "meeting_scheduled_at": str(l.meeting_scheduled_at) if l.meeting_scheduled_at else None,
                "assigned_to_name": l.assigned_users[0].name if l.assigned_users else None,
                "calendar_event_title": l.calendar_event_title,
                "calendar_event_agenda": l.calendar_event_agenda,
            }
            for l in leads
        ]
    }


# ── Paginated list ───────────────────────────────────────────────────────────

@router.get("/leads")
def get_leads(
    page: int = Query(1, ge=1),
    per_page: int = Query(PER_PAGE_DEFAULT, ge=1, le=PER_PAGE_MAX),
    search: Optional[str] = None,
    status: Optional[List[str]] = Query(None),
    source: Optional[str] = None,
    company: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    outcome: Optional[str] = None,
    assigned_to: Optional[str] = None,
    tag: Optional[List[str]] = Query(None),
    upload_log_id: Optional[str] = None,
    ids_only: bool = Query(False),
    global_view: bool = Query(False, description="Pod Admin only: bypass pod scoping to see all leads"),
    sort_by: Optional[str] = Query(None, description="name | status | source | time_in_status | phone | priority"),
    sort_dir: str = Query("asc", description="asc | desc"),
    exclude_dialer_done: bool = Query(False, description="Power Dialer: drop leads the caller has already marked 'called' in their queue"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Paginated leads for admins. Returns { data, total, page, per_page, pages }.

    `status` accepts multiple values (`?status=Calling&status=Research`) for the
    multi-select status filter; a single value still works the same as before.

    `sort_by`/`sort_dir`: only covers columns backed by a single indexable Lead
    column. "Assigned to" (many-to-many via assigned_users) and "Last activity"
    (computed post-fetch from a separate batched notes/calls query, see
    _batch_latest_activity below) are intentionally NOT sortable server-side —
    faking single-page sort for either would be misleading across pagination.
    """
    _SORT_COLUMNS = {
        "name": (func.lower(func.coalesce(models.Lead.first_name, '')), func.lower(func.coalesce(models.Lead.last_name, ''))),
        "status": (models.Lead.status,),
        "source": (models.Lead.lead_source,),
        # Oldest status_changed_at = longest time in status, so "asc" (shortest
        # first) means status_changed_at DESCENDING — inverted from a literal
        # column sort, handled below.
        "time_in_status": (models.Lead.status_changed_at,),
        "phone": (models.Lead.phone,),
        "priority": (models.Lead.priority_score,),
    }
    # _build_lead_query already scopes every role correctly (SDR/AE get only
    # their own assigned leads via the else branch there) — this endpoint was
    # additionally blocking SDR/AE outright on top of that, which is why the
    # redesigned All Leads page 403'd for those roles instead of showing
    # their own leads. global_view is a no-op for SDR/AE (only Pod Admin's
    # branch reads it), so passing it is harmless for those roles.
    base = _build_lead_query(db, user, global_view=global_view)

    # Exclude parked leads by default (align with dashboard counts)
    # unless user explicitly filters for a parked status
    if not status or not any(s in models.PARKED_STATUSES for s in status):
        base = base.filter(models.Lead.status.notin_(models.PARKED_STATUSES))

    base = _apply_filters(base, search, status, source, date_from, date_to, company=company, outcome=outcome)

    if exclude_dialer_done:
        # Power Dialer: a lead marked "called" here stays in whatever CRM
        # status it already had (see models.DialerQueueStatus) — without
        # this, it would keep reappearing on every refresh since nothing
        # about the lead itself changed, and the queue would never run dry
        # on its own even after the rep has genuinely finished it.
        done_ids = db.query(models.DialerQueueStatus.lead_id).filter(
            models.DialerQueueStatus.user_id == user.get("sub"),
            models.DialerQueueStatus.status == "called",
        )
        base = base.filter(~models.Lead.id.in_(done_ids))

    if tag:
        base = base.filter(models.Lead.tags.any(models.Tag.name.in_(tag)))
    if upload_log_id:
        base = base.filter(models.Lead.upload_log_id == upload_log_id)

    # Filter by assigned SDR (or unassigned)
    if assigned_to == 'unassigned':
        assigned_ids = db.query(models.lead_assignments.c.lead_id).distinct()
        base = base.filter(~models.Lead.id.in_(assigned_ids))
    elif assigned_to:
        base = base.filter(models.Lead.assigned_users.any(models.User.id == assigned_to))

    # Cache total count (30s TTL) — COUNT(*) over 10k+ rows is 100-200ms alone.
    # Keyed by user scope + all active filters so each distinct view gets its own entry.
    from cache import get_cached, set_cached, _is_test_db
    _status_key = ",".join(sorted(status)) if status else None
    _tag_key = ",".join(sorted(tag)) if tag else None
    _count_key = f"count:{user.get('sub')}:{user.get('role')}:{user.get('pod_id')}:{global_view}:{search}:{_status_key}:{source}:{assigned_to}:{date_from}:{date_to}:{company}:{outcome}:{_tag_key}:{upload_log_id}:{exclude_dialer_done}"
    _use_count_cache = not _is_test_db(db) and not search  # don't cache search results
    total = None
    if _use_count_cache:
        total = get_cached('leads_count', _count_key)
    if total is None:
        total = base.count()
        if _use_count_cache:
            set_cached('leads_count', _count_key, total, ttl=30)

    # Full-page result cache check (before heavy DB fetch + batch queries).
    # Keyed by: user scope + page + every active filter. TTL 15s.
    # Skipped when search is active (search results are unique per keystroke).
    _leads_page_key = f"leads:{user.get('sub')}:{user.get('role')}:{user.get('pod_id')}:{page}:{per_page}:{_status_key}:{source}:{assigned_to}:{company}:{date_from}:{date_to}:{outcome}:{_tag_key}:{upload_log_id}:{sort_by}:{sort_dir}:{exclude_dialer_done}"
    if _use_count_cache and not ids_only:
        _cached_page = get_cached('leads_page', _leads_page_key)
        if _cached_page is not None:
            return _cached_page

    _sort_cols = _SORT_COLUMNS.get(sort_by)
    if _sort_cols:
        _desc = (sort_dir == "desc")
        if sort_by == "time_in_status":
            _desc = not _desc  # inverted: oldest status_changed_at = longest time in status
        _order_by = tuple(c.desc() if _desc else c.asc() for c in _sort_cols)
    else:
        _order_by = (func.lower(func.coalesce(models.Lead.company, '')).asc(), models.Lead.created_at.desc())

    if ids_only:
        leads = (
            base
            .options(
                selectinload(models.Lead.assigned_users),
                lazyload("*"),
            )
            .order_by(func.lower(func.coalesce(models.Lead.company, '')).asc(), models.Lead.created_at.desc())
            .all()
        )
        return {
            "data": [
                {
                    "id": l.id,
                    "first_name": l.first_name,
                    "last_name": l.last_name,
                    "company": l.company,
                    "phone": l.phone,
                    "phone_secondary": l.phone_secondary,
                    "assigned_to": [{"id": u.id, "name": u.name} for u in l.assigned_users] if l.assigned_users else [],
                }
                for l in leads
            ]
        }

    leads = (
        base
        .options(
            SUMMARY_COLUMNS,
            selectinload(models.Lead.assigned_users),
            selectinload(models.Lead.tags),
            # RCA 2026-08-10: dialer_calls had no loader strategy set here,
            # unlike call_logs/notes — _lead_to_summary's dialer_calls check
            # is unconditional (it merges in DialerCall outcomes even when a
            # prefetched CallLog is given), so it silently lazy-loaded once
            # per lead. 50 leads = 50 extra queries, the dominant cost behind
            # Power Dialer's ~3s load. Same fix the kanban endpoint below
            # already uses for this exact relationship.
            selectinload(models.Lead.dialer_calls),
            lazyload(models.Lead.notes),
            lazyload(models.Lead.call_logs),
        )
        .order_by(*_order_by)
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    # Batch fetch latest notes/calls in 2 queries instead of N
    latest_notes, latest_calls = _batch_latest_activity(db, leads)
    # Batch compute company resolutions for this page of leads
    resolutions = _batch_company_resolutions(db, leads)
    last_emails = _batch_last_outbound_email(db, leads)
    data = []
    for l in leads:
        summary = _lead_to_summary(
            l,
            prefetched_note=latest_notes.get(l.id),
            prefetched_call=latest_calls.get(l.id),
            last_email_sent_at=last_emails.get(l.id),
        )
        summary["company_resolved"] = resolutions.get(l.id)
        data.append(summary)

    _leads_result = {
        "data":     data,
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, (total + per_page - 1) // per_page),
    }
    # Store full page result (15s TTL) so subsequent loads are instant.
    if _use_count_cache:
        set_cached('leads_page', _leads_page_key, _leads_result, ttl=15)
    return _leads_result


@router.get("/leads/companies")
def get_lead_companies(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return distinct company names visible to the current user."""
    base = _build_lead_query(db, user)
    rows = (
        base
        .with_entities(models.Lead.company)
        .filter(models.Lead.company != None, models.Lead.company != "")
        .distinct()
        .all()
    )
    companies = sorted(set(r[0].strip() for r in rows if r[0] and r[0].strip()), key=str.lower)
    return {"companies": companies}


@router.get("/leads/my")
def get_my_leads(
    page: int = Query(1, ge=1),
    per_page: int = Query(PER_PAGE_DEFAULT, ge=1, le=PER_PAGE_MAX),
    search: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    company: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    outcome: Optional[str] = None,
    ids_only: bool = Query(False),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Paginated leads for SDR / Pod Admin / Super Admin."""
    base = _build_lead_query(db, user)

    # Exclude parked leads by default (align with dashboard counts)
    if not status or status not in models.PARKED_STATUSES:
        base = base.filter(models.Lead.status.notin_(models.PARKED_STATUSES))

    base = _apply_filters(base, search, status, source, date_from, date_to, company=company, outcome=outcome)

    # Cache total count (30s TTL) — eliminates 100-200ms COUNT(*) on every page load
    from cache import get_cached, set_cached, _is_test_db
    _count_key = f"mycount:{user.get('sub')}:{status}:{search}:{source}:{company}:{date_from}:{date_to}:{outcome}"
    _use_count_cache = not _is_test_db(db) and not search
    total = None
    if _use_count_cache:
        total = get_cached('leads_count', _count_key)
    if total is None:
        total = base.count()
        if _use_count_cache:
            set_cached('leads_count', _count_key, total, ttl=30)

    # Full-page result cache check (before heavy DB fetch)
    _my_leads_key = f"myleads:{user.get('sub')}:{page}:{per_page}:{status}:{search}:{source}:{company}:{date_from}:{date_to}:{outcome}"
    if _use_count_cache and not ids_only:
        _cached_page = get_cached('my_leads', _my_leads_key)
        if _cached_page is not None:
            return _cached_page

    if ids_only:
        leads = (
            base
            .options(
                selectinload(models.Lead.assigned_users),
                lazyload("*"),
            )
            .order_by(
                models.Lead.priority_score.desc(),
                func.lower(func.coalesce(models.Lead.company, '')).asc(),
                models.Lead.created_at.desc()
            )
            .all()
        )
        return {
            "data": [
                {
                    "id": l.id,
                    "first_name": l.first_name,
                    "last_name": l.last_name,
                    "company": l.company,
                    "phone": l.phone,
                    "phone_secondary": l.phone_secondary,
                    "assigned_to": [{"id": u.id, "name": u.name} for u in l.assigned_users] if l.assigned_users else [],
                }
                for l in leads
            ]
        }

    leads = (
        base
        .options(
            SUMMARY_COLUMNS,
            selectinload(models.Lead.assigned_users),
            selectinload(models.Lead.tags),
            selectinload(models.Lead.dialer_calls),  # same N+1 fix as get_leads above
            lazyload(models.Lead.notes),
            lazyload(models.Lead.call_logs),
        )
        .order_by(
            models.Lead.priority_score.desc(),
            func.lower(func.coalesce(models.Lead.company, '')).asc(),
            models.Lead.created_at.desc()
        )
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    # Batch fetch latest notes/calls in 2 queries instead of N
    latest_notes, latest_calls = _batch_latest_activity(db, leads)
    # Batch compute company resolutions for this page of leads
    resolutions = _batch_company_resolutions(db, leads)
    last_emails = _batch_last_outbound_email(db, leads)
    data = []
    for l in leads:
        summary = _lead_to_summary(
            l,
            prefetched_note=latest_notes.get(l.id),
            prefetched_call=latest_calls.get(l.id),
            last_email_sent_at=last_emails.get(l.id),
        )
        summary["company_resolved"] = resolutions.get(l.id)
        data.append(summary)

    result = {
        "data":     data,
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, (total + per_page - 1) // per_page),
    }
    # Cache the full page result (20s TTL per user+page+filters).
    # Invalidated on lead assignment changes and status updates.
    _my_leads_key = f"myleads:{user.get('sub')}:{page}:{per_page}:{status}:{search}:{source}:{company}:{date_from}:{date_to}:{outcome}"
    if _use_count_cache:  # reuse the SQLite/search guard from count caching above
        set_cached('my_leads', _my_leads_key, result, ttl=20)
    return result


# ── Dashboard stats (lightweight) ────────────────────────────────────────────

@router.get("/leads/dashboard-stats")
def get_dashboard_stats(
    global_view: bool = Query(False, description="Pod Admin only: bypass pod scoping"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns status counts + recent leads for the dashboard, avoiding full lead fetch."""
    from cache import get_cached, set_cached, _is_test_db
    _use_cache = not _is_test_db(db)
    cache_key = f"{user.get('sub')}:{user.get('role')}:{user.get('pod_id')}:{global_view}"
    if _use_cache:
        cached = get_cached('dashboard', cache_key)
        if cached is not None:
            return cached

    # Single base query — no parked filter yet — covers ALL statuses in one scan.
    # This avoids the previous pattern of calling _build_lead_query() twice
    # (once for active counts, once for parked_count), which caused a redundant
    # full 12K-row table scan on every dashboard load.
    base_all = _build_lead_query(db, user, global_view=global_view)

    # Single GROUP BY across all statuses — split into active vs parked in Python
    all_status_rows = base_all.with_entities(
        models.Lead.status, func.count(models.Lead.id)
    ).group_by(models.Lead.status).all()

    all_status_dict = dict(all_status_rows)

    # Parked count: sum the parked statuses from the single GROUP BY result
    parked_count = sum(all_status_dict.get(s, 0) for s in models.PARKED_STATUSES)

    # Active status counts (exclude parked from the pipeline view)
    status_counts = {
        s: cnt for s, cnt in all_status_dict.items()
        if s not in models.PARKED_STATUSES
    }
    # Derive total from active statuses only
    total = sum(status_counts.values())
    # Ensure all pipeline statuses are present (even with 0)
    for s in ALL_STATUSES:
        status_counts.setdefault(s, 0)

    # Recent leads (up to 8 for the priority queue) — use the active-only base
    # Note: call_logs are NOT joinedloaded here — call_attempt_count is a stored column on Lead.
    # Loading all call_logs for 8 leads was adding ~200-400ms with high call volume.
    base_active = base_all.filter(models.Lead.status.notin_(models.PARKED_STATUSES))
    recent = (
        base_active
        .options(
            joinedload(models.Lead.assigned_users),
            selectinload(models.Lead.dialer_calls),  # same N+1 fix as get_leads — _lead_to_summary always checks this
        )
        .order_by(models.Lead.created_at.desc())
        .limit(8)
        .all()
    )

    result = {
        "total": total,
        "status_counts": status_counts,
        "parked_count": parked_count,
        "recent_leads": [_lead_to_summary(l) for l in recent],
    }

    # ── Today's call outcomes (scoped to current user) ────────────────────
    # Uses the same UNION pattern as analytics (dialer_calls + call_logs) to
    # avoid double-counting. Scoped to user.sub for SDR/AE; broader for admin.
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    user_id = user.get("sub")
    role = user.get("role", "")

    # A) Dialer calls today
    dc_q = db.query(
        models.DialerCall.outcome,
        func.count(models.DialerCall.id).label("cnt"),
    ).filter(
        models.DialerCall.direction == "outbound",
        models.dialer_call_event_time() >= today_start,
    )
    if role in ("SDR", "AE"):
        dc_q = dc_q.filter(models.DialerCall.user_id == user_id)
    elif role == "Pod Admin" and user.get("pod_id") and not global_view:
        pod_user_ids = [
            uid for (uid,) in db.query(models.User.id)
            .filter(models.User.pod_id == user.get("pod_id")).all()
        ]
        dc_q = dc_q.filter(models.DialerCall.user_id.in_(pod_user_ids))
    dc_by_outcome = {row.outcome or "No Outcome": row.cnt for row in dc_q.group_by(models.DialerCall.outcome).all()}

    # B) Manual call_logs today (exclude those already in dialer_calls)
    cl_q = db.query(
        models.CallLog.outcome,
        func.count(models.CallLog.id).label("cnt"),
    ).filter(
        models.CallLog.called_at >= today_start,
    )
    if role in ("SDR", "AE"):
        cl_q = cl_q.filter(models.CallLog.user_id == user_id)
    elif role == "Pod Admin" and user.get("pod_id") and not global_view:
        cl_q = cl_q.filter(models.CallLog.user_id.in_(pod_user_ids))
    cl_by_outcome = {row.outcome or "No Outcome": row.cnt for row in cl_q.group_by(models.CallLog.outcome).all()}

    # Merge (dialer takes precedence, add manual-only outcomes on top)
    outcomes_today: dict = dict(dc_by_outcome)
    for outcome, cnt in cl_by_outcome.items():
        outcomes_today[outcome] = outcomes_today.get(outcome, 0) + cnt

    calls_today = sum(outcomes_today.values())
    result["calls_today"] = calls_today
    result["outcomes_today"] = outcomes_today

    if _use_cache:
        set_cached('dashboard', cache_key, result)
    return result



# ── Kanban (non-paginated, but summary only) ─────────────────────────────────

@router.get("/leads/kanban")
def get_kanban_leads(
    global_view: bool = Query(False, description="Pod Admin only: bypass pod scoping"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns all leads in summary format for kanban board (no pagination)."""
    base = _build_lead_query(db, user, global_view=global_view)
    # Exclude parked leads from kanban view
    base = base.filter(models.Lead.status.notin_(models.PARKED_STATUSES))
    leads = base.options(
        selectinload(models.Lead.assigned_users),
        selectinload(models.Lead.tags),
        selectinload(models.Lead.dialer_calls),
        lazyload(models.Lead.notes),
        lazyload(models.Lead.call_logs),
    ).all()
    latest_notes, latest_calls = _batch_latest_activity(db, leads)
    return [
        _lead_to_summary(
            l,
            prefetched_note=latest_notes.get(l.id),
            prefetched_call=latest_calls.get(l.id),
        )
        for l in leads
    ]


# ── Single lead detail ────────────────────────────────────────────────────────

@router.post("/leads")
def create_lead(lead_data: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from cache import invalidate
    # Invalidate all list/page caches when a new lead is created
    invalidate('dashboard'); invalidate('leads_page')
    invalidate('my_leads'); invalidate('leads_count')
    """Creates a new lead in local DB only. Lead will be pushed to SF when it reaches Meeting Scheduled.
    Auto-assigns the lead to the creating user so it appears in their My Leads immediately.
    """
    try:
        import uuid as _uuid
        from routes._admin_helpers import _find_duplicate_lead

        # RCA-2026-07-20: block obvious duplicates the same way CSV/Sheet imports
        # already do — an unchecked duplicate here is what let the same contact
        # get pushed to Salesforce as a new Lead on every sync run.
        dup = _find_duplicate_lead(
            db,
            email=lead_data.get("email"),
            linkedin_url=lead_data.get("linkedin_url"),
            person_linkedin=lead_data.get("person_linkedin"),
            phone=lead_data.get("phone"),
            first_name=lead_data.get("first_name"),
            last_name=lead_data.get("last_name"),
            company=lead_data.get("company"),
        )
        if dup:
            dup_name = f"{dup.first_name or ''} {dup.last_name or ''}".strip() or "this lead"
            raise HTTPException(
                status_code=409,
                detail=f"A matching lead already exists: {dup_name} @ {dup.company or 'Unknown'} (id {dup.id}). Use that lead instead of creating a new one.",
            )

        # Restrict initial status to safe values only
        requested_status = lead_data.get("status", "Lead Assigned")
        allowed_initial = {"Lead Assigned", "Research"}
        if requested_status not in allowed_initial:
            requested_status = "Lead Assigned"

        new_lead = models.Lead(
            sf_lead_id=f"manual-{_uuid.uuid4().hex[:8]}",
            first_name=lead_data.get("first_name", ""),
            last_name=lead_data.get("last_name", "Unknown"),
            email=lead_data.get("email"),
            phone=lead_data.get("phone"),
            phone_secondary=lead_data.get("phone_secondary"),
            company=lead_data.get("company"),
            title=lead_data.get("title"),
            linkedin_url=lead_data.get("linkedin_url"),
            person_linkedin=lead_data.get("person_linkedin"),
            status=requested_status,
            lead_source="manual",
            lead_started_at=datetime.now(timezone.utc),
        )

        # Look up the creating user from DB (needed for pod_id + assignment)
        db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()

        # Set pod_id from the creating user's pod (if they belong to one)
        if db_user and db_user.pod_id:
            new_lead.pod_id = db_user.pod_id

        db.add(new_lead)
        db.flush()  # get the ID before commit

        # Auto-assign to the creating user
        if db_user:
            new_lead.assigned_users.append(db_user)

        # Log initial status for audit trail
        log_status_change(db, new_lead.id, None, requested_status,
                          user.get("name") or user.get("email", "unknown"))

        db.commit()
        db.refresh(new_lead)

        # Activity log: CREATE_LEAD
        try:
            from activity_logger import log_activity
            lead_name = f"{new_lead.first_name or ''} {new_lead.last_name or ''}".strip()
            log_activity(user["sub"], "CREATE_LEAD",
                         user_email=user.get("email"), user_name=user.get("name"),
                         object_type="lead", object_id=new_lead.id,
                         metadata={"lead_name": lead_name, "company": new_lead.company, "status": requested_status})
        except Exception:
            pass

        # Fire-and-forget: sync new lead to Audience Manager
        from audience_manager import sync_leads_to_am_background
        sync_leads_to_am_background([new_lead.id])

        return _lead_to_dict(new_lead)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Activity Feed (must be before /leads/{lead_id} to avoid path conflict) ────

@router.get("/leads/activity-feed")
def get_activity_feed(
    limit: int = Query(50, ge=1, le=200),
    global_view: bool = False,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Activity feed of recent status changes (for dashboard widget).
    Pod Admins see only their pod's lead changes unless global_view=True.
    Uses with_entities() to select only required columns — avoids loading
    full Lead ORM objects via joinedload (previously caused 1,400–1,665ms latency).
    idx_lead_status_logs_changed_at makes the ORDER BY scan fast.
    """
    from sqlalchemy import exists

    q = (
        db.query(
            models.LeadStatusLog.id,
            models.LeadStatusLog.lead_id,
            models.LeadStatusLog.from_status,
            models.LeadStatusLog.to_status,
            models.LeadStatusLog.changed_by,
            models.LeadStatusLog.changed_at,
            models.Lead.first_name,
            models.Lead.last_name,
            models.Lead.company,
        )
        .join(models.Lead, models.LeadStatusLog.lead_id == models.Lead.id, isouter=True)
        # Cadence/Messaging Sandbox test leads must never appear in this dashboard widget.
        .filter(models.Lead.is_test.is_(False))
    )

    # ── Pod scoping for Pod Admin (edge case L-2 + D-3) ──────────────────
    if user.get("role") == "Pod Admin" and not global_view:
        pod_id = user.get("pod_id")
        if not pod_id:
            return []  # misconfigured Pod Admin — safe empty fallback
        # Fetch pod's SDR user IDs (single extra query, fast via idx_users_pod_id)
        pod_sdr_ids = [
            uid for (uid,) in db.query(models.User.id).filter(
                models.User.pod_id == pod_id
            ).all()
        ]
        if not pod_sdr_ids:
            return []  # empty pod — no activity
        # Only include status logs for leads assigned to this pod's SDRs
        # (unassigned-pool leads excluded — consistent with leads scoping)
        q = q.filter(
            exists().where(
                (models.lead_assignments.c.lead_id == models.LeadStatusLog.lead_id) &
                (models.lead_assignments.c.user_id.in_(pod_sdr_ids))
            )
        )

    rows = q.order_by(models.LeadStatusLog.changed_at.desc()).limit(limit).all()
    result = []
    for row in rows:
        lead_name = f"{row.first_name or ''} {row.last_name or ''}".strip() if row.first_name or row.last_name else "Unknown"
        result.append({
            "id": row.id,
            "lead_id": row.lead_id,
            "lead_name": lead_name,
            "company": row.company,
            "from_status": row.from_status,
            "to_status": row.to_status,
            "changed_by": row.changed_by,
            "changed_at": str(row.changed_at) if row.changed_at else None,
        })
    return result


@router.get("/leads/{lead_id}")
def get_lead(lead_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = db.query(models.Lead).options(
        selectinload(models.Lead.assigned_users),
        selectinload(models.Lead.call_logs),
        selectinload(models.Lead.dialer_calls)
    ).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    # Activity log: VIEW_LEAD
    try:
        from activity_logger import log_activity
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        log_activity(user["sub"], "VIEW_LEAD",
                     user_email=user.get("email"), user_name=user.get("name"),
                     object_type="lead", object_id=lead_id,
                     metadata={"lead_name": lead_name})
    except Exception:
        pass
    detail = _lead_to_dict(lead)
    detail["company_resolved"] = _batch_company_resolutions(db, [lead])[lead.id]
    return detail


@router.patch("/leads/{lead_id}")
def update_lead(lead_id: str, updates: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update editable fields on a lead and write-back to Salesforce."""
    lead = _can_modify_lead(db, user, lead_id)

    allowed = {"first_name", "last_name", "email", "phone", "phone_secondary", "company", "title", "status"}
    filtered = {k: v for k, v in updates.items() if k in allowed}
    # Track status change time + audit log
    if "status" in filtered and filtered["status"] != lead.status:
        # SDRs cannot move leads backward via direct update.
        # Exception: "Pending Review" is always a forward move from Demo stages
        # and is treated as a parked holding state, not a backward regression.
        if (_is_backward_move(lead.status, filtered["status"])
                and filtered["status"] != "Pending Review"
                and user.get("role") not in ("Super Admin", "Admin", "Pod Admin")):
            raise HTTPException(
                status_code=403,
                detail="SDRs cannot move leads to a previous status. Contact your Pod Admin."
            )
        # Validate: Meeting Scheduled requires at least 1 call
        if filtered["status"] == "Meeting Scheduled":
            if _logged_call_count(db, lead_id) == 0:
                raise HTTPException(status_code=422, detail="At least 1 call must be logged before moving to Meeting Scheduled.")
        old_status = lead.status
        lead.status_changed_at = datetime.now(timezone.utc)
        log_status_change(db, lead.id, old_status, filtered["status"], user.get("name") or user.get("email", "unknown"))
    status_changed = "status" in filtered and filtered["status"] != lead.status
    for key, val in filtered.items():
        setattr(lead, key, val)

    # Auto-revert: if a phone was just added to a parked lead, unpark it
    phone_fields_in_update = {"phone", "phone_secondary"} & filtered.keys()
    if phone_fields_in_update and lead.status in PARKED_STATUSES:
        phone_val = lead.phone or lead.phone_secondary or ""
        phone_digits = ''.join(c for c in str(phone_val) if c.isdigit())
        if len(phone_digits) >= 7:
            old_status = lead.status
            lead.status = "Lead Assigned"
            lead.status_changed_at = datetime.now(timezone.utc)
            log_status_change(db, lead.id, old_status, "Lead Assigned",
                              user.get("name") or user.get("email", "unknown"))
            status_changed = True
            # If SDR added the phone, assign lead to them
            if user.get("role") == "SDR":
                sdr_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
                if sdr_user:
                    models.assign_lead(sdr_user, lead)
            # Pod Admin / Admin / Super Admin → keep unassigned

    db.commit()
    db.refresh(lead)

    # If lead reached the SF push stage, create in Salesforce (one-way: CRM → SF)
    if status_changed:
        _check_sf_push(lead, db)

    return _lead_to_dict(lead)


# ── Manual re-prioritization (V22) ───────────────────────────────────────────

@router.patch("/leads/{lead_id}/priority")
def update_lead_priority(
    lead_id: str,
    body: dict,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Manually set a lead's priority_score. SDRs use this to re-prioritize a
    deprioritized lead. The score is capped between 0 and 100.
    Send: { \"priority_score\": 100 }
    """
    lead = _can_modify_lead(db, user, lead_id)
    score = body.get("priority_score", 100)
    try:
        score = int(score)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="priority_score must be an integer.")
    lead.priority_score = max(0, min(100, score))
    db.commit()
    db.refresh(lead)
    return {"ok": True, "priority_score": lead.priority_score}


@router.patch("/leads/{lead_id}/research")
def update_research(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Save research fields on a lead."""
    lead = _can_modify_lead(db, user, lead_id)

    for field in RESEARCH_FIELDS:
        if field in body:
            setattr(lead, field, body[field])
    db.commit()
    db.refresh(lead)
    return _lead_to_dict(lead)


def _check_sf_push(lead, db):
    """If lead reached the SF push stage and doesn't exist in SF yet, create it there.
    One-way sync: CRM → SF. Push status updates for existing leads, create new leads.
    Uses the same enriched description (6 sections) as the manual Sync button."""
    from salesforce import _build_lead_description
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    push_stage = settings.sf_push_stage if settings else "Meeting Scheduled"

    if lead.status and lead.status == push_stage:
        # Build enriched description NOW (main thread, while db session is open)
        # _build_lead_description fetches call logs + notes via the db session.
        # The lead object and session will be detached by the time the background
        # thread runs, so we must capture the string here.
        enriched_description = _build_lead_description(lead, db)

        lead_data = {
            "id": lead.id,
            "sf_lead_id": lead.sf_lead_id,
            "first_name": lead.first_name,
            "last_name": lead.last_name,
            "company": lead.company,
            "email": lead.email,
            "phone": lead.phone,
            "status": lead.status,
            "title": lead.title,
            "website": lead.website,
            "industry": lead.industry or lead.research_industry,
            "employee_count": lead.employee_count,
            "annual_revenue": lead.annual_revenue,
            # RCA 2026-08-03: City/State/Country are contact-level fields,
            # almost always blank on an uploaded/list-sourced lead — the
            # real location data lives in the company_* enrichment fields.
            "city": lead.city or lead.company_city,
            "state": lead.state or lead.company_state,
            "country": lead.country or lead.company_country,
            "company_street": lead.company_street,
            "company_postal_code": lead.company_postal_code,
            "linkedin_url": lead.linkedin_url or lead.person_linkedin,
            "sdr_name": ", ".join(u.name for u in lead.assigned_users if u.name) or None,
            "description": enriched_description or None,
        }

        def _do_push():
            from sf_logger import log_sf_operation
            sf = get_sf_client()
            if not sf:
                logger.warning(f"[SF Push] No SF client available for lead {lead_data['id']}")
                return

            _lead_info = {"first_name": lead_data["first_name"], "last_name": lead_data["last_name"], "email": lead_data["email"]}

            # Case 1: Lead already exists in SF → push status update
            if lead_data["sf_lead_id"] and not lead_data["sf_lead_id"].startswith("upload-") and not lead_data["sf_lead_id"].startswith("manual-") and not lead_data["sf_lead_id"].startswith("sandbox-"):
                try:
                    success = push_lead_to_salesforce(sf, lead_data["sf_lead_id"], {"status": lead_data["status"]},
                                            lead_info=_lead_info, source="background_push")
                    # Mark as synced so Sync button won't re-push — only on
                    # actual success (RCA 2026-08-03: this used to run
                    # unconditionally, so a failed push against a Lead
                    # deleted in Salesforce still got marked "synced" and
                    # every future sync silently skipped retrying it).
                    if success:
                        with SessionLocal() as thread_db:
                            db_lead = thread_db.query(models.Lead).filter(models.Lead.id == lead_data["id"]).first()
                            if db_lead:
                                db_lead.last_synced_at = datetime.now(timezone.utc)
                                thread_db.commit()
                except Exception as e:
                    logger.error(f"[SF Push] Failed to update status for {lead_data['sf_lead_id']}: {e}")
                return

            # Case 2: New/uploaded lead → create in SF (with duplicate check)
            from database import SessionLocal
            try:
                # Duplicate check by email
                if lead_data["email"]:
                    safe_email = lead_data["email"].replace("'", "\\'")
                    existing = sf.query(
                        f"SELECT Id FROM Lead WHERE Email = '{safe_email}' LIMIT 1"
                    )
                    if existing.get("totalSize", 0) > 0:
                        sf_id = existing["records"][0]["Id"]
                        with SessionLocal() as thread_db:
                            db_lead = thread_db.query(models.Lead).filter(models.Lead.id == lead_data["id"]).first()
                            if db_lead:
                                db_lead.sf_lead_id = sf_id
                                db_lead.last_synced_at = datetime.now(timezone.utc)
                                thread_db.commit()
                        log_sf_operation(
                            operation_type="upsert", sf_object="Lead",
                            record_identifier=sf_id,
                            first_name=lead_data["first_name"], last_name=lead_data["last_name"], email=lead_data["email"],
                            fields_updated=["sf_lead_id"],
                            status="success", source_system="background_push",
                            response_payload={"action": "linked_to_existing", "sf_id": sf_id},
                        )
                        return

                sf_id = create_new_lead_in_salesforce(sf, lead_data, source="background_push")
                with SessionLocal() as thread_db:
                    db_lead = thread_db.query(models.Lead).filter(models.Lead.id == lead_data["id"]).first()
                    if db_lead:
                        db_lead.sf_lead_id = sf_id
                        db_lead.last_synced_at = datetime.now(timezone.utc)
                        thread_db.commit()
            except Exception as e:
                log_sf_operation(
                    operation_type="create", sf_object="Lead",
                    record_identifier=lead_data["id"],
                    first_name=lead_data["first_name"], last_name=lead_data["last_name"], email=lead_data["email"],
                    status="failed", error_message=str(e),
                    source_system="background_push",
                )
        threading.Thread(target=_do_push, daemon=True).start()


@router.patch("/leads/kanban/move")
def move_lead_kanban(lead_id: str, new_status: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = _can_modify_lead(db, user, lead_id)

    # Disqualified leads must be closed via the /close endpoint
    if new_status == "Disqualified":
        raise HTTPException(status_code=422, detail="Use the 'Close Lead' action to disqualify a lead.")

    # Block moves FROM Disqualified back to active (re-opening not supported via kanban)
    if lead.status == "Disqualified":
        raise HTTPException(status_code=422, detail="Cannot move a disqualified lead. Contact admin to reopen.")

    # SDRs cannot move leads backward in the pipeline.
    # Exception: "Pending Review" is always a forward move from Demo stages
    # and is a Pod Admin holding state, not a backward regression.
    if (_is_backward_move(lead.status, new_status)
            and new_status != "Pending Review"
            and user.get("role") not in ("Super Admin", "Admin", "Pod Admin")):
        raise HTTPException(
            status_code=403,
            detail="SDRs cannot move leads to a previous status. Contact your Pod Admin."
        )

    # Validation: research gate — admin-controlled toggle (v8 Research v2)
    # Default: False (gate OFF) — SDRs can move to Calling without research.
    # When True: 4 core research fields are required (India SDR discovery flow).
    # Read per-request so admin changes take effect immediately (EC-14).
    try:
        _ss = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        _require_research = bool(getattr(_ss, "require_research_before_calling", False)) if _ss else False
    except Exception:
        _require_research = False

    if _require_research and new_status in ("Calling", "Meeting Scheduled"):
        CORE_RESEARCH = ["research_company", "research_contact", "research_hypothesis", "research_personalization"]
        missing = [f for f in CORE_RESEARCH if not getattr(lead, f, None)]
        if missing:
            field_labels = {
                "research_company": "What does this company do?",
                "research_contact": "Contact Context",
                "research_hypothesis": "Pitch Angle / Hypothesis",
                "research_personalization": "Personalization Note"
            }
            missing_labels = [field_labels.get(f, f) for f in missing]
            raise HTTPException(
                status_code=422,
                detail=f"Complete these required fields: {', '.join(missing_labels)}"
            )

    # Validation: Meeting Scheduled requires at least 1 call logged
    if new_status == "Meeting Scheduled":
        if _logged_call_count(db, lead_id) == 0:
            raise HTTPException(
                status_code=422,
                detail="At least 1 call must be logged before moving to Meeting Scheduled."
            )

    old_status = lead.status
    lead.status = new_status
    lead.status_changed_at = datetime.now(timezone.utc)
    log_status_change(db, lead.id, old_status, new_status, user.get("name") or user.get("email", "unknown"))

    # Set closed timestamp for meeting-reached AND terminal statuses.
    # The analytics trend endpoint queries lead_closed_at to bucket meetings
    # over time — if this is null the meeting won't appear in the chart.
    MEETING_REACHED_STATUSES_LOCAL = {"Meeting Scheduled", "Demo Scheduled", "Demo Done", "Completed"}
    if new_status in TERMINAL_STATUSES or new_status in MEETING_REACHED_STATUSES_LOCAL:
        if lead.lead_closed_at is None:  # don't overwrite existing close date
            lead.lead_closed_at = datetime.now(timezone.utc)
    if new_status in TERMINAL_STATUSES:
        lead.closed_reason = new_status

    db.commit()
    db.refresh(lead)

    # Bust page caches so the kanban board reflects the new status immediately
    from cache import invalidate
    invalidate('dashboard'); invalidate('leads_page')
    invalidate('my_leads'); invalidate('leads_count')

    # Check if this stage triggers SF lead creation (one-way: CRM → SF)
    _check_sf_push(lead, db)

    # Push status update to SF for existing leads (one-way: CRM → SF)
    sf_lead_id = lead.sf_lead_id
    new_sf_status = lead.status
    # RCA 2026-08-03: captured here (while `lead` is still attached to the
    # request's db session) and passed through as lead_info — without it,
    # a failed push logs a nameless/emailless row that the Sync Logs page's
    # "Record ID / Name / Email" search can never find by name or email.
    push_lead_info = lead_push_info(lead, db)
    if sf_lead_id and not sf_lead_id.startswith("upload-") and not sf_lead_id.startswith("manual-"):
        def _sf_status_push():
            try:
                sf = get_sf_client()
                if sf:
                    push_lead_to_salesforce(sf, sf_lead_id, {"status": new_sf_status}, lead_info=push_lead_info)
                    logger.info(f"[SF Push] Kanban status → '{new_sf_status}' for SF lead {sf_lead_id}")
            except Exception as e:
                logger.error(f"[SF Push] Kanban status push failed for {sf_lead_id}: {e}")
        threading.Thread(target=_sf_status_push, daemon=True).start()

    # Activity log: UPDATE_LEAD_STATUS
    try:
        from activity_logger import log_activity
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        log_activity(user["sub"], "UPDATE_LEAD_STATUS",
                     user_email=user.get("email"), user_name=user.get("name"),
                     object_type="lead", object_id=lead_id,
                     metadata={"lead_name": lead_name, "from_status": old_status, "to_status": new_status})
        if new_status == "Meeting Scheduled":
            log_activity(user["sub"], "SCHEDULE_MEETING",
                         user_email=user.get("email"), user_name=user.get("name"),
                         object_type="lead", object_id=lead_id,
                         metadata={"lead_name": lead_name})
    except Exception:
        pass

    return {"message": f"Lead {lead_id} status updated to {new_status}", "lead": _lead_to_dict(lead)}



@router.get("/leads/{lead_id}/status-history")
def get_lead_status_history(lead_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return chronological status change log for a single lead."""
    logs = db.query(models.LeadStatusLog).filter(
        models.LeadStatusLog.lead_id == lead_id
    ).order_by(models.LeadStatusLog.changed_at.desc()).all()
    return [{
        "id": l.id,
        "from_status": l.from_status,
        "to_status": l.to_status,
        "changed_by": l.changed_by,
        "changed_at": str(l.changed_at) if l.changed_at else None,
    } for l in logs]


@router.patch("/leads/{lead_id}/outcome")
def update_lead_outcome(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Super Admin / Pod Admin: mark a lead as Won or Lost."""
    # Access check: Pod Admin or Super Admin only
    role = user.get("role")
    if role not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Only Pod Admins and Super Admins can update lead outcomes.")

    lead = db.query(models.Lead).options(
        joinedload(models.Lead.assigned_users)
    ).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Pod Admin: only their pod's leads
    if role == "Pod Admin":
        pod_id = user.get("pod_id")
        lead_pod_ids = [u.pod_id for u in lead.assigned_users if u.pod_id]
        if pod_id not in lead_pod_ids and lead.pod_id != pod_id:
            raise HTTPException(status_code=403, detail="You can only update outcomes for leads in your POD.")

    # Validate status
    opp_status = body.get("status", "").strip()
    if opp_status not in ("Won", "Lost"):
        raise HTTPException(status_code=400, detail="Status must be 'Won' or 'Lost'.")

    # Validate lead is in a post-meeting or terminal state
    OUTCOME_ELIGIBLE = {
        "Meeting Scheduled", "1st Discovery Meeting", "Discovery Complete",
        "Demo Scheduled", "Demo Done", "Completed", "Disqualified",
    }
    if lead.status not in OUTCOME_ELIGIBLE:
        raise HTTPException(status_code=400, detail=f"Outcome can only be set for leads in post-meeting or terminal status. Current: {lead.status}")

    from datetime import datetime, timezone
    lead.opportunity_status = opp_status
    lead.opportunity_notes = body.get("notes", "").strip() or None
    lead.opportunity_updated_at = datetime.now(timezone.utc)
    lead.opportunity_updated_by = user.get("name", "Admin")

    # Log as status change for audit trail
    log_status_change(db, lead.id, f"Outcome: {opp_status}", f"Outcome: {opp_status}",
                      changed_by=user.get("name", "Admin"))

    db.commit()
    db.refresh(lead)
    return {"message": f"Lead outcome updated to {opp_status}", "lead": _lead_to_dict(lead)}


# ── No Show Flow ─────────────────────────────────────────────────────────────

# SDR-only backward transitions (no-show is the only case)
ALLOWED_SDR_NO_SHOW_STATES = {"Meeting Scheduled", "Meeting Confirmed"}

@router.post("/leads/{lead_id}/no-show")
def mark_no_show(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mark a lead as a no-show. Moves from Meeting Scheduled/Confirmed → Calling.
    
    Requirements:
    - Lead must be in 'Meeting Scheduled' status
    - Reason is mandatory (min 10 characters)
    - Increments no_show_count
    - Logs activity
    - Notifies Pod Admin
    - For confirmed meetings: appends no-show context to SF Description
    """
    lead = _can_modify_lead(db, user, lead_id)
    
    # Validate lead is in an eligible no-show stage
    NO_SHOW_ELIGIBLE = {"Meeting Scheduled", "1st Discovery Meeting", "Demo Scheduled"}
    if lead.status not in NO_SHOW_ELIGIBLE:
        raise HTTPException(
            status_code=422,
            detail=f"No-show can only be marked for leads in {', '.join(sorted(NO_SHOW_ELIGIBLE))} status. Current: {lead.status}"
        )
    
    # Validate reason
    reason = body.get("reason", "").strip()
    if len(reason) < 10:
        raise HTTPException(
            status_code=422,
            detail="Reason must be at least 10 characters. Please describe why the meeting was missed."
        )
    
    # Check if the last call outcome was Meeting Confirmed (determines SF behavior)
    last_call = db.query(models.CallLog).filter(
        models.CallLog.lead_id == lead_id
    ).order_by(models.CallLog.called_at.desc()).first()
    
    was_confirmed = last_call and last_call.outcome in ("Meeting Confirmed", "Call Completed")
    
    # Perform state transition
    old_status = lead.status
    lead.status = "Calling"
    lead.status_changed_at = datetime.now(timezone.utc)
    lead.no_show_count = (lead.no_show_count or 0) + 1
    
    # Clear terminal flags (lead is back in active pipeline)
    lead.lead_closed_at = None
    lead.closed_reason = None
    
    # Log status change
    log_status_change(
        db, lead.id, old_status, "Calling",
        changed_by=f"{user.get('name', 'SDR')} (No Show: {reason[:50]})"
    )
    
    db.commit()
    db.refresh(lead)
    
    # Activity logging
    try:
        from activity_logger import log_activity
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        log_activity(
            user["sub"], "NO_SHOW",
            user_email=user.get("email"), user_name=user.get("name"),
            object_type="lead", object_id=lead_id,
            metadata={
                "lead_name": lead_name,
                "reason": reason,
                "no_show_count": lead.no_show_count,
                "was_confirmed": was_confirmed,
            }
        )
    except Exception:
        pass
    
    # If meeting was confirmed → update SF Description with no-show context
    if was_confirmed:
        sf_lead_id = lead.sf_lead_id
        if sf_lead_id and not sf_lead_id.startswith("upload-") and not sf_lead_id.startswith("manual-"):
            no_show_note = (
                f"\n\nNO SHOW — {datetime.now(timezone.utc).strftime('%b %d, %Y %I:%M %p UTC')}\n"
                f"Reason: {reason}\n"
                f"Marked by: {user.get('name', 'SDR')}\n"
                f"Total no-shows: {lead.no_show_count}\n"
                f"Lead returned to Calling."
            )
            no_show_lead_info = lead_push_info(lead, db)
            def _sf_no_show_update():
                try:
                    sf = get_sf_client()
                    if sf:
                        # Fetch current description and append
                        push_lead_to_salesforce(sf, sf_lead_id, {
                            "description": no_show_note,
                        }, lead_info=no_show_lead_info)
                        logger.info(f"[SF Push] No-show context appended for SF lead {sf_lead_id}")
                except Exception as e:
                    logger.error(f"[SF Push] No-show Description update failed for {sf_lead_id}: {e}")
            threading.Thread(target=_sf_no_show_update, daemon=True).start()
    
    # Notify Pod Admin (if lead is assigned to a pod)
    try:
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        sdr_name = user.get("name", "An SDR")
        # Find all pod admins for this lead's pod and notify each
        notified_pods = set()
        for assigned_user in lead.assigned_users:
            if assigned_user.pod_id and assigned_user.pod_id not in notified_pods:
                notified_pods.add(assigned_user.pod_id)
                pod_admin_rows = db.query(models.PodAdmin).filter(
                    models.PodAdmin.pod_id == assigned_user.pod_id
                ).all()
                for pa in pod_admin_rows:
                    from activity_logger import log_activity
                    log_activity(
                        pa.user_id, "NO_SHOW_NOTIFICATION",
                        user_email=user.get("email"), user_name=sdr_name,
                        object_type="lead", object_id=lead_id,
                        metadata={
                            "lead_name": lead_name,
                            "reason": reason,
                            "sdr_name": sdr_name,
                            "no_show_count": lead.no_show_count,
                        }
                    )
    except Exception:
        pass

    
    return {
        "message": f"No-show recorded. Lead moved back to Calling.",
        "lead": _lead_to_dict(lead),
        "no_show_count": lead.no_show_count,
    }


# ── RCM / RCM Messaging Messaging ─────────────────────────────────────────

@router.get("/leads/{lead_id}/messaging/config")
def get_messaging_config(
    lead_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Return the RCM iframe URL for a lead.
    Uses Audience Manager record_id (search/create on demand)."""
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    settings = db.query(models.SyncSettings).first()
    if not settings or not settings.rcm_enabled:
        return {"enabled": False, "reason": "Conversations not enabled. Configure in Settings → Conversations."}

    if not settings.rcm_api_key:
        return {"enabled": False, "reason": "Conversations API key not configured. Contact your admin."}

    phone = (lead.phone or "").strip() or (lead.phone_secondary or "").strip()
    if not phone:
        return {"enabled": True, "has_phone": False, "reason": "No phone number on this lead."}

    base_url = (settings.rcm_base_url or "https://app.bercm.com").rstrip("/")
    api_key = settings.rcm_api_key

    # Per-SDR RCM user ID: check the current user first, then fall back to global
    current_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
    user_id = (
        (getattr(current_user, 'rcm_user_id', None) or "").strip()
        or (settings.rcm_user_id or "")
    )

    # If we already have the AM record_id, use it directly
    record_id = lead.am_record_id

    # If not, try to search/create in Audience Manager on-demand
    if not record_id:
        from audience_manager import ensure_contact
        record_id = ensure_contact(
            base_url=base_url,
            api_key=api_key,
            user_id=user_id,
            first_name=lead.first_name or "",
            last_name=lead.last_name or "",
            phone=phone,
            email=lead.email or "",
        )
        # Persist the record_id for future use
        if record_id:
            lead.am_record_id = record_id
            db.commit()

    if not record_id:
        return {
            "enabled": True,
            "has_phone": True,
            "synced": False,
            "reason": "Could not sync contact to Audience Manager. Try again later.",
        }

    iframe_url = f"{base_url}/fastapp/desk/#/inbox?crm=audience_manager&record_id={record_id}&record_type=contacts"

    # Server-side auth: use shared RCMAuthManager for cached HMAC-based JWT
    auth_ok = False
    auth_error = None
    try:
        from rcm_auth import RCMAuthManager
        access_token = RCMAuthManager.get_token(base_url, api_key, user_id)
        if access_token:
            iframe_url += f"&session_id={access_token}"
            auth_ok = True
            logger.info(f"[Messaging] Server-side auth succeeded for user={user_id}")
    except Exception as auth_err:
        auth_error = f"Authentication failed: {str(auth_err)[:100]}"
        logger.warning(f"[Messaging] Server-side auth failed: {auth_err}")

    return {
        "enabled": True,
        "has_phone": True,
        "synced": True,
        "iframe_url": iframe_url,
        "phone": phone,
        "record_id": record_id,
        "auth_ok": auth_ok,
        "auth_error": auth_error,
    }


@router.post("/leads/{lead_id}/messaging/sync")
def sync_messaging_contact(
    lead_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Manually trigger Audience Manager contact sync for a lead."""
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    settings = db.query(models.SyncSettings).first()
    if not settings or not settings.rcm_enabled or not settings.rcm_api_key:
        raise HTTPException(status_code=400, detail="Conversations not configured")

    phone = (lead.phone or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Lead has no phone number")

    from audience_manager import ensure_contact
    base_url = (settings.rcm_base_url or "https://app.bercm.com").rstrip("/")
    record_id = ensure_contact(
        base_url=base_url,
        api_key=settings.rcm_api_key,
        user_id=settings.rcm_user_id or "",
        first_name=lead.first_name or "",
        last_name=lead.last_name or "",
        phone=phone,
        email=lead.email or "",
    )
    if record_id:
        lead.am_record_id = record_id
        db.commit()
        return {"synced": True, "record_id": record_id}
    raise HTTPException(status_code=502, detail="Failed to sync contact to Audience Manager")
