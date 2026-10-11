"""
Analytics Routes — /api/admin/analytics
=======================================
4 focused, cacheable endpoints serving the Analytics Hub dashboard.

Design principles:
- Each endpoint is a single optimised SQL query (no N+1)
- In-memory TTL cache (2 min) — no Redis required
- Pod Admins are auto-scoped server-side (pod_id from token, never from param)
- All rate calculations use NULLIF to avoid division-by-zero
- NULL call outcomes are excluded from Connect Rate numerator AND denominator
- Legacy call outcomes are mapped via CASE statements at query time
- FastAPI runs sync routes in a threadpool — parallel frontend fetches are served concurrently
"""

import csv
import io
import time
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from threading import Lock
from typing import List as _List, Optional

from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, case, cast, String, distinct, text, and_, or_, exists, select
from sqlalchemy.orm import Session

from database import get_db
from auth import require_admin, require_admin_or_ae, require_export_access
from access_db import pod_of
from routes.lead_helpers import authorize_lead
from routes._admin_helpers import resolve_sort
import models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics", tags=["analytics"])

# ─── In-memory TTL cache ────────────────────────────────────────────────────
_cache: dict[str, tuple[dict, float]] = {}
_cache_lock = Lock()
CACHE_TTL_SECONDS = 600  # 10 minutes — dashboard metrics don't change second-by-second


def _cache_key(*parts) -> str:
    return ":".join(str(p) for p in parts)


def _cache_get(key: str):
    with _cache_lock:
        entry = _cache.get(key)
        if entry:
            data, expires_at = entry
            if time.time() < expires_at:
                return data
            del _cache[key]
    return None


# RCA 2026-08-26 (staging OOM): keys include free-form date-range/pod/sdr/
# source/page combos — high cardinality, rarely re-read after expiry, so the
# lazy delete-on-read in _cache_get never frees them. Same unbounded-growth
# shape cache.py's _SWEEP_THRESHOLD fix already addressed for its own store.
_CACHE_SWEEP_THRESHOLD = 500

def _cache_set(key: str, data):
    with _cache_lock:
        _cache[key] = (data, time.time() + CACHE_TTL_SECONDS)
        if len(_cache) > _CACHE_SWEEP_THRESHOLD:
            now = time.time()
            for k in [k for k, (_, exp) in _cache.items() if now > exp]:
                del _cache[k]


def _cache_invalidate_prefix(prefix: str):
    """Remove all cache entries whose key starts with prefix."""
    with _cache_lock:
        stale = [k for k in _cache if k.startswith(prefix)]
        for k in stale:
            del _cache[k]


# ─── Shared filter helpers ──────────────────────────────────────────────────

# Statuses indicating a meeting was booked (reached or passed Meeting Scheduled)
MEETING_REACHED_STATUSES = [
    "Meeting Scheduled", "1st Discovery Meeting", "Discovery Complete",
    "Demo Scheduled", "Demo Done", "Completed",
]

# Terminal/disqualified statuses (+ legacy outcome-as-status values kept for old data)
DISQUALIFIED_STATUSES = ["Disqualified", "Not Interested", "Unreachable", "Customer Declined"]

# Legacy outcome → canonical outcome mapping (applied at query time via CASE)
LEGACY_OUTCOME_MAP = {
    "Call Completed": "Meeting Scheduled",
    "Customer Declined": "Not Interested",
    "Callback Scheduled": "Call Back Later",
}


def _resolve_date_range_simple(
    date_from: Optional[str],
    date_to: Optional[str],
    preset: Optional[str],
) -> tuple[Optional[datetime], Optional[datetime]]:
    """Simplified version without lambda issues.

    RCA-2026-07-13: explicit date_from/date_to must win over `preset` even
    though several callers default preset="30d" via FastAPI Query(). Checking
    preset first meant any Custom-range pick silently fell back to the last
    30 days the instant the frontend omitted `preset` from the query string.
    """
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if date_from or date_to:
        start = end = None
        if date_from:
            try:
                start = datetime.fromisoformat(date_from).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
            except ValueError:
                pass
        if date_to:
            try:
                end = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59, microsecond=0, tzinfo=timezone.utc)
            except ValueError:
                pass
        if start and end and start > end:
            start, end = end, start
        return start, end

    if preset == "7d":
        return today - timedelta(days=6), now
    if preset == "30d":
        return today - timedelta(days=29), now
    if preset == "90d":
        return today - timedelta(days=89), now
    return None, None


def _resolve_date_range_for_tz(
    date_from: Optional[str],
    date_to: Optional[str],
    preset: Optional[str],
    tz_name: str,
) -> "tuple[Optional[datetime], Optional[datetime]]":
    """Same as _resolve_date_range_simple, except a CUSTOM date_from/date_to
    is interpreted as that calendar day in `tz_name` (a pod's own timezone),
    not a UTC day — added 2026-08-14 so a US team's "Aug 14" actually means
    their own midnight-to-midnight, not a UTC day that splits their real
    work day across two on-screen dates.

    RCA 2026-08-21 (live): presets (7d/30d/90d) used to be left UTC-anchored
    here too, on the theory that a rolling window ending at `now` (an exact
    instant) has no day-boundary to mismatch — but the START of that window
    is still a picked calendar day ("N days ago, at midnight"), and that
    midnight was UTC's, not the pod's. A US team whose shift runs into the
    next UTC day had that boundary fall mid-shift, splitting one evening's
    activity across two on-screen windows — exactly the reported symptom,
    and exactly what this function already fixed for a custom date pick.
    Presets now resolve their start boundary against the pod's own local
    midnight too; `all` (no window) and the `now` end-instant are unaffected.
    """
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        tz = timezone.utc

    if not (date_from or date_to):
        _preset_days = {"7d": 6, "30d": 29, "90d": 89}.get(preset)
        if _preset_days is None:
            return _resolve_date_range_simple(date_from, date_to, preset)  # "all" / unset → None, None
        from datetime import timedelta
        today_local = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
        start = (today_local - timedelta(days=_preset_days)).astimezone(timezone.utc)
        return start, datetime.now(timezone.utc)

    start = end = None
    if date_from:
        try:
            start = datetime.fromisoformat(date_from).replace(
                hour=0, minute=0, second=0, microsecond=0, tzinfo=tz
            ).astimezone(timezone.utc)
        except ValueError:
            pass
    if date_to:
        try:
            end = datetime.fromisoformat(date_to).replace(
                hour=23, minute=59, second=59, microsecond=0, tzinfo=tz
            ).astimezone(timezone.utc)
        except ValueError:
            pass
    if start and end and start > end:
        start, end = end, start
    return start, end


def _resolve_analytics_date_range(db, effective_pod, effective_sdr, date_from, date_to, preset):
    """Resolve (date_start, date_end) against the SCOPED pod's own timezone
    instead of a UTC-anchored day boundary.

    RCA 2026-08-21 (live — reported as "call counts don't match within
    Analytics Hub itself"): _compute_sdr_rows (the SDR table) already
    grouped by pod timezone via _resolve_date_range_for_tz; get_funnel,
    get_trend, get_email_breakdown, and get_batch_summary all still called
    _resolve_date_range_simple directly, purely UTC. Two views in the same
    Analytics Hub were using two different day-boundary rules on the same
    underlying calls.

    Scoped to a single pod or SDR — the common Pod Admin/AE/SDR view, and
    the one actually reported. True org-wide aggregation across multiple
    pods with DIFFERENT timezones at once is a separate, larger change
    (see _compute_sdr_rows's per-timezone-group loop for that pattern) —
    not attempted here; an org-wide view (no pod/SDR scope) falls back to
    UTC, unchanged from before.
    """
    pod_id = effective_pod
    if effective_sdr and not pod_id:
        pod_id = db.query(models.User.pod_id).filter(models.User.id == effective_sdr).scalar()
    tz_name = "UTC"
    if pod_id:
        tz_name = db.query(models.Pod.timezone).filter(models.Pod.id == pod_id).scalar() or "UTC"
    return _resolve_date_range_for_tz(date_from, date_to, preset, tz_name)


def _effective_pod_id(admin: dict, pod_id_param: Optional[str]) -> Optional[str]:
    """
    EC-6: Pod Admins are always scoped to their own pod.
    Super Admins respect the pod_id query param.
    """
    if admin.get("role") == "Pod Admin":
        return pod_of(admin)  # force — ignore param entirely; a pod-less Pod Admin matches nothing, never everything
    return pod_id_param or None


def _effective_ae_sdr(admin: dict) -> Optional[str]:
    """AE/SDR role: Analytics Hub is forced to that user's own leads/calls
    only — no pod-wide or cross-SDR visibility. Mirrors _effective_pod_id's
    force-ignore-the-param idiom, just scoped to self instead of a pod."""
    if admin.get("role") in ("AE", "SDR"):
        return admin.get("sub")
    return None


def _resolve_sdr_filter(admin: dict, sdr_id_param: Optional[str], db: Session) -> Optional[str]:
    """The Analytics Hub "Rep" filter: an admin/pod-admin picking a specific
    SDR/AE from the dropdown fed by get_filter_options' `sdrs` list. Self-scope
    (AE/SDR) always wins and ignores the param, same as _effective_pod_id.
    A Pod Admin can only pick a rep inside their own pod — get_filter_options
    already only returns their own pod's reps, but a direct API call could
    still pass an out-of-pod id, so it's re-checked here rather than trusted."""
    self_scoped = _effective_ae_sdr(admin)
    if self_scoped:
        return self_scoped
    if not sdr_id_param:
        return None
    if admin.get("role") == "Pod Admin":
        target_pod = db.query(models.User.pod_id).filter(models.User.id == sdr_id_param).scalar()
        if target_pod != admin.get("pod_id"):
            return None
    return sdr_id_param


# ─── Source prefix mapping for normalized filter values ─────────────────────
_SOURCE_PREFIX_MAP = {
    "google_sheet": "gsheet:%",
    "uploaded": "upload:%",
    "salesforce": "salesforce",
    "manual": "manual",
}


def _lead_source_filter(query, lead_source, model=None):
    """Apply normalized lead_source filter using prefix matching.
    
    Accepts normalized source keys (google_sheet, uploaded, etc.)
    and maps them to LIKE patterns for prefix-based sources.
    """
    if not lead_source:
        return query
    target = model or models.Lead
    prefix = _SOURCE_PREFIX_MAP.get(lead_source)
    if prefix and "%" in prefix:
        return query.filter(target.lead_source.like(prefix))
    elif prefix:
        return query.filter(target.lead_source == prefix)
    else:
        return query.filter(target.lead_source == lead_source)


def _pod_scope_lead_query(query, effective_pod, effective_sdr=None):
    """OR-fallback pod scoping for a query anchored on (or joined to) Lead:
    matches if the lead's own pod_id matches, OR any of its assigned users
    belongs to the pod. models.assign_lead keeps lead.pod_id in sync with
    its assignee's pod going forward, so this EXISTS fallback is defense
    against a lead where that's drifted (a pod re-org, or a row predating
    that guarantee) — without it, a pod-scoped view can silently drop a
    lead its own SDR still sees elsewhere in the app.

    effective_sdr (AE self-scope, see _effective_ae_sdr) takes priority over
    effective_pod when both are given — callers null out effective_pod for
    an AE before calling this, but the explicit check keeps this function
    correct even if a future caller forgets that.

    .correlate(models.Lead) below is load-bearing, not decoration: a caller
    whose own query already joins lead_assignments directly (e.g.
    get_batch_summary's per-SDR breakdown) makes that table ALSO visible to
    SQLAlchemy's auto-correlation, which then correlates BOTH lead_assignments
    and Lead away from this EXISTS — leaving it with zero FROM clauses and
    raising InvalidRequestError. Confirmed live in production (three
    occurrences, AE-role users on the batch-summary view) and reproduced
    locally byte-for-byte before this fix. correlate(models.Lead) restricts
    auto-correlation to just the intended column, keeping lead_assignments
    as this subquery's own table regardless of what the outer query joins.
    """
    if effective_sdr:
        return query.filter(exists().where(
            models.lead_assignments.c.lead_id == models.Lead.id
        ).where(models.lead_assignments.c.user_id == effective_sdr).correlate(models.Lead))
    if not effective_pod:
        return query
    assignee_in_pod = exists().where(
        models.lead_assignments.c.lead_id == models.Lead.id
    ).where(
        models.lead_assignments.c.user_id.in_(
            select(models.User.id).where(models.User.pod_id == effective_pod)
        )
    ).correlate(models.Lead)
    return query.filter(or_(models.Lead.pod_id == effective_pod, assignee_in_pod))


def _pod_scope_call_query(query, effective_pod, effective_sdr=None):
    """OR-fallback pod scoping for a query anchored on a call record
    (DialerCall/CallLog) that already has User and Lead joined/outerjoined:
    matches if the calling user's pod matches OR the dialed lead's pod
    matches. Caller is responsible for the joins existing first.

    effective_sdr (AE self-scope) takes priority — see _pod_scope_lead_query."""
    if effective_sdr:
        return query.filter(models.User.id == effective_sdr)
    if not effective_pod:
        return query
    return query.filter(or_(models.User.pod_id == effective_pod, models.Lead.pod_id == effective_pod))


def _pod_scope_activity_query(query, effective_pod):
    """Activity Monitor / Call Monitor scoping: a record belongs to the pod of the PERSON WHO DID IT. A Pod Admin must
    not see another pod's reps just because they called a lead that sits in this pod. Records with no person (inbound
    sync rows, Instantly) fall back to the pod of the lead's current owner. User and Lead must be (outer)joined.
    (Analytics Hub keeps the lead-anchored _pod_scope_call_query: that is reporting on the pod's leads.)"""
    if not effective_pod:
        return query
    owner_in_pod = models.Lead.id.in_(
        select(models.lead_assignments.c.lead_id).join(models.User, models.User.id == models.lead_assignments.c.user_id)
        .where(models.User.pod_id == effective_pod))
    return query.filter(or_(models.User.pod_id == effective_pod, and_(models.User.id.is_(None), owner_in_pod)))


def _sdr_dropdown(db, effective_pod):
    """Rep filter-dropdown list, pod-scoped. Shared by list_call_logs
    and Activity Monitor's email/message-logs endpoints — same role set,
    same pod filter, same {id, name, email} shape.

    Role list was SDR/Pod Admin/Admin only from when Activity Monitor was
    SDR-only; CSM and AE reps now also make calls/send emails and were
    invisible in this dropdown despite having logged activity."""
    q = db.query(models.User).filter(models.User.role.in_(["SDR", "Pod Admin", "Admin", "CSM", "AE"])).order_by(models.User.name)
    if effective_pod:
        q = q.filter(models.User.pod_id == effective_pod)
    return [{"id": u.id, "name": u.name, "email": u.email} for u in q.all()]


def _lead_closed_date_expr():
    """COALESCE(lead_closed_at, status_changed_at) — the date a lead's
    terminal/meeting-reached status transition should be attributed to.
    lead_closed_at is the intended source of truth but historical rows (or
    any path that predates a given close-setting fix) may have it NULL;
    status_changed_at is set on every status transition, so it's the same
    fallback trend's meetings query has used since v9.7.1, shared here so
    funnel and trend can't silently disagree on which leads have a close
    date at all.
    """
    return func.coalesce(models.Lead.lead_closed_at, models.Lead.status_changed_at)


def _scope_query_to_sdr_leads(db, query, sdr_id):
    """Restrict a Lead-based query to leads assigned to sdr_id.
    Shared by get_trend's meetings/disqualified sub-queries."""
    sdr_lead_ids = [
        row[0] for row in db.query(models.lead_assignments.c.lead_id)
        .filter(models.lead_assignments.c.user_id == sdr_id).all()
    ]
    if sdr_lead_ids:
        return query.filter(models.Lead.id.in_(sdr_lead_ids))
    return query.filter(False)  # SDR has no leads


# ─── EC-9: Legacy outcome normalisation expression ───────────────────────────
def _normalised_outcome_expr():
    """
    SQLAlchemy CASE expression that maps legacy outcome strings
    to their canonical equivalents at query time.
    """
    return case(
        (models.CallLog.outcome == "Call Completed", "Meeting Scheduled"),
        (models.CallLog.outcome == "Customer Declined", "Not Interested"),
        (models.CallLog.outcome == "Callback Scheduled", "Call Back Later"),
        else_=models.CallLog.outcome,
    )


def _cl_connected(norm_expr):
    """CallLog "connected" check on an already-normalised outcome expression —
    mirrors models.call_log_is_conversation()'s exclusion rule."""
    return func.lower(norm_expr).notin_(models.NOT_ANSWERED_OUTCOMES_LOWER)


# ─── Extracted scalar computations (reused by get_funnel AND the analytics
# semantic layer's Connect Rate / Leads Assigned adapters — see
# backend/analytics/adapters.py). Extraction is behavior-preserving: same
# queries, same math, just callable outside get_funnel(). ────────────────────

def _compute_leads_assigned_count(db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id):
    """Canonical Leads Assigned: entity count of leads created in the period,
    excluding parked/test/deleted leads. Matches master-doc definition 5.4
    verbatim — no semantic change from the existing Dashboard behavior."""
    lead_q = db.query(func.count(models.Lead.id).label("total"))
    lead_q = lead_q.filter(~models.Lead.status.in_(models.PARKED_STATUSES))
    if not upload_log_id:
        if date_start:
            lead_q = lead_q.filter(models.Lead.created_at >= date_start)
        if date_end:
            lead_q = lead_q.filter(models.Lead.created_at <= date_end)
    lead_q = _pod_scope_lead_query(lead_q, effective_pod, effective_sdr)
    lead_q = models.exclude_test_and_deleted_leads(lead_q)
    if lead_source:
        lead_q = _lead_source_filter(lead_q, lead_source)
    if upload_log_id:
        lead_q = lead_q.filter(models.Lead.upload_log_id == upload_log_id)
    return lead_q.scalar() or 0


def _compute_calls_and_connect_rate(db, effective_pod, effective_sdr, date_start, date_end,
                                     lead_source, upload_log_id, conversation_min_seconds):
    """Canonical Calls Made / Connect Rate: DialerCall + pure-manual CallLog
    union, deduped via CallLog.dialer_call_id.is_(None) so an Aircall-mirrored
    CallLog row is never double-counted. Matches master-doc definitions 5.1/5.5
    verbatim — no semantic change from the existing Dashboard behavior."""
    _dc_q = db.query(
        func.count(models.DialerCall.id).label("total"),
        func.count(
            case((models.DialerCall.outcome.isnot(None), models.DialerCall.id))
        ).label("with_outcome"),
        func.count(
            case((models.dialer_call_connected(conversation_min_seconds), models.DialerCall.id))
        ).label("connected"),
        func.count(
            case((models.dialer_call_is_conversation(conversation_min_seconds), models.DialerCall.id))
        ).label("conversations"),
        func.count(
            case((models.DialerCall.outcome.is_(None), models.DialerCall.id))
        ).label("null_outcome"),
        func.count(distinct(models.DialerCall.lead_id)).label("unique_leads"),
    ).join(
        models.User, models.User.id == models.DialerCall.user_id
    ).filter(
        models.DialerCall.direction == "outbound"
    )
    _dc_q = models.exclude_test_and_deleted_leads(_dc_q, models.DialerCall)
    if date_start:
        _dc_q = _dc_q.filter(models.dialer_call_event_time() >= date_start)
    if date_end:
        _dc_q = _dc_q.filter(models.dialer_call_event_time() <= date_end)
    if effective_pod or effective_sdr or upload_log_id or lead_source:
        _dc_q = _dc_q.outerjoin(
            models.Lead, models.Lead.id == models.DialerCall.lead_id
        )
        if effective_sdr:
            _dc_q = _dc_q.filter(models.DialerCall.user_id == effective_sdr)
        elif effective_pod:
            _dc_q = _dc_q.filter(
                (models.User.pod_id == effective_pod) |
                (models.Lead.pod_id == effective_pod)
            )
        if upload_log_id:
            _dc_q = _dc_q.filter(models.Lead.upload_log_id == upload_log_id)
        if lead_source:
            _dc_q = _lead_source_filter(_dc_q, lead_source)
    _dc = _dc_q.one()

    _cl_q = db.query(
        func.count(models.CallLog.id).label("total"),
        func.count(
            case((models.CallLog.outcome.isnot(None), models.CallLog.id))
        ).label("with_outcome"),
        func.count(distinct(models.CallLog.lead_id)).label("unique_leads"),
        func.count(
            case((_cl_connected(_normalised_outcome_expr()), models.CallLog.id))
        ).label("connected"),
        func.count(
            case((models.call_log_is_conversation(), models.CallLog.id))
        ).label("conversations"),
    ).filter(models.CallLog.dialer_call_id.is_(None))
    _cl_q = models.exclude_test_and_deleted_leads(_cl_q, models.CallLog)
    if date_start:
        _cl_q = _cl_q.filter(models.CallLog.called_at >= date_start)
    if date_end:
        _cl_q = _cl_q.filter(models.CallLog.called_at <= date_end)
    if effective_pod or effective_sdr or upload_log_id or lead_source:
        _cl_q = _cl_q.join(
            models.Lead, models.Lead.id == models.CallLog.lead_id
        )
        if effective_pod or effective_sdr:
            _cl_q = _cl_q.outerjoin(models.User, models.User.id == models.CallLog.user_id)
            _cl_q = _pod_scope_call_query(_cl_q, effective_pod, effective_sdr)
        if upload_log_id:
            _cl_q = _cl_q.filter(models.Lead.upload_log_id == upload_log_id)
        if lead_source:
            _cl_q = _lead_source_filter(_cl_q, lead_source)
    _cl = _cl_q.one()

    calls_made         = (_dc.total or 0) + (_cl.total or 0)
    calls_with_outcome = (_dc.with_outcome or 0) + (_cl.with_outcome or 0)
    calls_connected    = (_dc.connected or 0) + (_cl.connected or 0)
    conversations      = (_dc.conversations or 0) + (_cl.conversations or 0)
    calls_null_outcome = calls_made - calls_with_outcome
    unique_leads_called = (_dc.unique_leads or 0) + (_cl.unique_leads or 0)
    avg_calls_per_lead = round(calls_made / unique_leads_called, 1) if unique_leads_called > 0 else 0
    connect_rate = round(calls_connected / calls_made * 100, 1) if calls_made > 0 else None

    return {
        "calls_made": calls_made,
        "calls_with_outcome": calls_with_outcome,
        "calls_connected": calls_connected,
        "conversations": conversations,
        "calls_null_outcome": calls_null_outcome,
        "unique_leads_called": unique_leads_called,
        "avg_calls_per_lead": avg_calls_per_lead,
        "connect_rate": connect_rate,
    }


def _compute_email_stats(db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id):
    """Canonical Email Sent / Opened / Replied: extracted verbatim from
    get_funnel()'s email block, unchanged — includes the lead_source-on-replies
    fix (RCA 2026-07-27) and test/deleted-lead exclusion. Phase 2: also reused
    by the semantic layer's email adapters, which is what lets Ask AI's
    separately-implemented email queries (smart_analytics.py's
    _q_email_open_rate/_q_email_reply_rate, missing both of those) be rewired
    onto this already-correct definition instead of drifting further."""
    email_q = db.query(
        func.count(models.LeadEmailActivity.id).label("sent"),
        func.count(models.LeadEmailActivity.opened_at).label("opened"),
    ).join(models.Lead, models.Lead.id == models.LeadEmailActivity.lead_id).filter(
        models.LeadEmailActivity.direction == "outbound"
    )
    if date_start:
        email_q = email_q.filter(models.LeadEmailActivity.timestamp >= date_start)
    if date_end:
        email_q = email_q.filter(models.LeadEmailActivity.timestamp <= date_end)
    email_q = _pod_scope_lead_query(email_q, effective_pod, effective_sdr)
    email_q = models.exclude_test_and_deleted_leads(email_q)
    if lead_source:
        email_q = _lead_source_filter(email_q, lead_source)
    if upload_log_id:
        email_q = email_q.filter(models.Lead.upload_log_id == upload_log_id)

    email_row = email_q.one()
    emails_sent   = email_row.sent or 0
    emails_opened = email_row.opened or 0

    # Count inbound replies as "replied"
    reply_q = db.query(func.count(distinct(models.LeadEmailActivity.nylas_thread_id))).join(
        models.Lead, models.Lead.id == models.LeadEmailActivity.lead_id
    ).filter(models.LeadEmailActivity.direction == "inbound")
    reply_q = _pod_scope_lead_query(reply_q, effective_pod, effective_sdr)
    reply_q = models.exclude_test_and_deleted_leads(reply_q)
    if lead_source:
        # RCA 2026-07-27: was the only email metric not scoped to lead_source —
        # sent/opened correctly shrank when filtering by source, replied didn't.
        reply_q = _lead_source_filter(reply_q, lead_source)
    if upload_log_id:
        reply_q = reply_q.filter(models.Lead.upload_log_id == upload_log_id)
    emails_replied = reply_q.scalar() or 0

    # Reply rate denominator: distinct outbound THREADS, not raw send rows —
    # matches smart_analytics.py's original _q_email_reply_rate definition
    # (a thread with 3 outbound touches that gets one reply is a 100% reply
    # rate, not 33%). Same scope filters as above, just a different count shape.
    sent_threads_q = db.query(func.count(distinct(models.LeadEmailActivity.nylas_thread_id))).join(
        models.Lead, models.Lead.id == models.LeadEmailActivity.lead_id
    ).filter(models.LeadEmailActivity.direction == "outbound")
    sent_threads_q = _pod_scope_lead_query(sent_threads_q, effective_pod, effective_sdr)
    sent_threads_q = models.exclude_test_and_deleted_leads(sent_threads_q)
    if lead_source:
        sent_threads_q = _lead_source_filter(sent_threads_q, lead_source)
    if upload_log_id:
        sent_threads_q = sent_threads_q.filter(models.Lead.upload_log_id == upload_log_id)
    sent_threads = sent_threads_q.scalar() or 0

    open_rate = round(emails_opened / emails_sent * 100, 1) if emails_sent > 0 else None
    reply_rate = round(emails_replied / sent_threads * 100, 1) if sent_threads > 0 else None

    return {
        "emails_sent": emails_sent,
        "emails_opened": emails_opened,
        "emails_replied": emails_replied,
        "sent_threads": sent_threads,
        "open_rate": open_rate,
        "reply_rate": reply_rate,
    }


def _compute_meetings_booked_snapshot(db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id):
    """Legacy Dashboard 'Meetings' definition: leads CURRENTLY at-or-past the
    Meeting Scheduled stage, date-scoped by COALESCE(lead_closed_at,
    status_changed_at). This is a current-state snapshot, NOT the canonical
    event metric (see backend/analytics/adapters.py:meetings_scheduled, which
    uses Lead.meeting_scheduled_at instead) — kept as-is, unchanged, still used
    by the existing Dashboard funnel card."""
    _meeting_date = _lead_closed_date_expr()
    meeting_q = db.query(
        func.count(models.Lead.id).label("meetings"),
        func.sum(models.Lead.no_show_count).label("no_shows"),
    ).filter(models.Lead.status.in_(MEETING_REACHED_STATUSES))
    if date_start:
        meeting_q = meeting_q.filter(_meeting_date >= date_start)
    if date_end:
        meeting_q = meeting_q.filter(_meeting_date <= date_end)
    meeting_q = _pod_scope_lead_query(meeting_q, effective_pod, effective_sdr)
    meeting_q = models.exclude_test_and_deleted_leads(meeting_q)
    if lead_source:
        meeting_q = _lead_source_filter(meeting_q, lead_source)
    if upload_log_id:
        meeting_q = meeting_q.filter(models.Lead.upload_log_id == upload_log_id)
    meeting_row = meeting_q.one()
    return meeting_row.meetings or 0, int(meeting_row.no_shows or 0)


def _compute_disqualified_snapshot(db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id):
    """Legacy Dashboard 'Disqualified' definition: leads currently in one of
    DISQUALIFIED_STATUSES (4 values, 3 of them legacy outcome-as-status data),
    date-scoped by COALESCE(lead_closed_at, status_changed_at). Kept as-is,
    unchanged, still used by the existing Dashboard funnel card. The canonical
    event metric (backend/analytics/adapters.py:disqualified) uses only
    status == "Disqualified" + Lead.lead_closed_at instead — see Phase 1 plan
    open question #2."""
    _disq_date = _lead_closed_date_expr()
    disq_q = db.query(func.count(models.Lead.id)).filter(
        models.Lead.status.in_(DISQUALIFIED_STATUSES)
    )
    disq_q = _pod_scope_lead_query(disq_q, effective_pod, effective_sdr)
    disq_q = models.exclude_test_and_deleted_leads(disq_q)
    if lead_source:
        disq_q = _lead_source_filter(disq_q, lead_source)
    if upload_log_id:
        disq_q = disq_q.filter(models.Lead.upload_log_id == upload_log_id)
    if date_start:
        disq_q = disq_q.filter(_disq_date >= date_start)
    if date_end:
        disq_q = disq_q.filter(_disq_date <= date_end)
    return disq_q.scalar() or 0


# ─── Endpoint 1: KPI Funnel ──────────────────────────────────────────────────

@router.get("/funnel")
def get_funnel(
    preset: Optional[str] = Query(None, description="7d | 30d | 90d | all"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    pod_id: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    upload_log_id: Optional[str] = Query(None),
    sdr_id: Optional[str] = Query(None, description="Scope to a single rep (Analytics Hub Rep filter)"),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """
    Returns 7 KPI metrics for the funnel cards.

    Date scoping (EC-5):
    - leads_assigned   → filtered by leads.created_at
    - calls_made       → filtered by dialer_calls.created_at (Aircall webhook timestamp)
    - emails_sent      → filtered by lead_email_activity.timestamp
    - meetings_booked  → filtered by leads.lead_closed_at
    """
    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _resolve_sdr_filter(admin, sdr_id, db)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, no pod-wide visibility
    date_start, date_end = _resolve_analytics_date_range(db, effective_pod, effective_sdr, date_from, date_to, preset)

    from routes._admin_helpers import get_conversation_min_seconds
    conversation_min_seconds = get_conversation_min_seconds(db)

    ckey = _cache_key("funnel", effective_pod, effective_sdr, lead_source, upload_log_id, date_from or preset, date_to)
    cached = _cache_get(ckey)
    if cached:
        logger.debug("analytics/funnel cache HIT key=%s", ckey)
        return cached

    logger.info("analytics/funnel QUERY pod=%s source=%s preset=%s batch=%s", effective_pod, lead_source, preset, upload_log_id)

    # ── 1. Leads Assigned (EC-5: scoped to leads.created_at) ─────────────────
    # Bug-3 fix: When a specific batch is selected, the batch itself provides
    # complete scoping — skip the date filter on leads so we don't get 0 leads
    # when the batch upload date falls outside the selected date window.
    leads_assigned = _compute_leads_assigned_count(
        db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id
    )

    # ── 3. Emails (EC-5: scoped to lead_email_activity.timestamp) ─────────────
    _emails = _compute_email_stats(
        db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id
    )
    emails_sent    = _emails["emails_sent"]
    emails_opened  = _emails["emails_opened"]
    emails_replied = _emails["emails_replied"]

    # ── 4. Calls — UNION of dialer_calls + pure-manual call_logs
    # RCA-2026-05-22: call_logs alone = 19 (US Team) — missed all Aircall calls.
    # Strategy: two separate ORM queries (SQLite-safe), summed in Python.
    #   A) dialer_calls outbound — covers all Aircall/Alternate Messenger calls
    #   B) call_logs with no dialer_call_id — covers manual (non-Aircall) calls only.
    # RCA 2026-08-25: this used to count ALL call_logs, then subtract a
    # date-based heuristic overlap count from calls_made only — calls_connected
    # was never de-duped at all, so any auto-tagged Aircall call (CallLog rows
    # _auto_log_outcome creates with dialer_call_id set, mirroring a DialerCall)
    # got its connect counted twice once calls_connected started summing
    # dc.connected + cl.connected, inflating connect_rate. _compute_sdr_rows and
    # get_batch_summary already avoid this correctly via dialer_call_id.is_(None)
    # — use that same precise filter here instead of the heuristic.

    # A+B) DialerCall + pure-manual CallLog, deduped — see
    # _compute_calls_and_connect_rate for the RCA history preserved inline there.
    _calls = _compute_calls_and_connect_rate(
        db, effective_pod, effective_sdr, date_start, date_end,
        lead_source, upload_log_id, conversation_min_seconds
    )
    calls_made          = _calls["calls_made"]
    calls_with_outcome  = _calls["calls_with_outcome"]
    calls_connected     = _calls["calls_connected"]
    calls_null_outcome  = _calls["calls_null_outcome"]
    unique_leads_called = _calls["unique_leads_called"]
    avg_calls_per_lead  = _calls["avg_calls_per_lead"]
    connect_rate        = _calls["connect_rate"]

    # Average retries (call_attempt_count on lead)
    avg_q = db.query(func.avg(models.Lead.call_attempt_count))
    avg_q = _pod_scope_lead_query(avg_q, effective_pod, effective_sdr)
    avg_q = models.exclude_test_and_deleted_leads(avg_q)
    if lead_source:
        # RCA 2026-07-27: was unscoped by lead_source, unlike every other funnel card.
        avg_q = _lead_source_filter(avg_q, lead_source)
    if upload_log_id:
        avg_q = avg_q.filter(models.Lead.upload_log_id == upload_log_id)
    avg_retries = round(avg_q.scalar() or 0, 1)

    # ── 5. Meetings (EC-3: status=Meeting Scheduled, no-show as sub-stat) ────
    # Date-scoped via COALESCE(lead_closed_at, status_changed_at) — matches
    # trend's meetings query (v9.7.1) so a lead with no lead_closed_at doesn't
    # appear in one chart's meeting count and not the other's. This is the
    # legacy current-state snapshot — see _compute_meetings_booked_snapshot's
    # docstring for why it's kept separate from the canonical event metric.
    meetings_booked, no_shows = _compute_meetings_booked_snapshot(
        db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id
    )

    # ── 6. Disqualified leads (terminal: Disqualified + Not Interested + legacy) ──
    # Same COALESCE fallback as meetings above, for the same reason. Legacy
    # current-state snapshot — see _compute_disqualified_snapshot's docstring.
    disqualified = _compute_disqualified_snapshot(
        db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id
    )

    # ── 7. Opportunity outcomes (Won/Lost) — post-meeting conversion ──────────
    opp_q = db.query(
        func.count(case((models.Lead.opportunity_status == "Won", models.Lead.id))).label("won"),
        func.count(case((models.Lead.opportunity_status == "Lost", models.Lead.id))).label("lost"),
    )
    opp_q = _pod_scope_lead_query(opp_q, effective_pod, effective_sdr)
    opp_q = models.exclude_test_and_deleted_leads(opp_q)
    if lead_source:
        opp_q = _lead_source_filter(opp_q, lead_source)
    if upload_log_id:
        opp_q = opp_q.filter(models.Lead.upload_log_id == upload_log_id)
    opp_row = opp_q.one()

    result = {
        "leads_assigned": leads_assigned,
        "emails": {
            "sent": emails_sent,
            "opened": emails_opened,
            "open_rate": round(emails_opened / emails_sent * 100, 1) if emails_sent > 0 else None,
            "replied": emails_replied,
            "reply_rate": round(emails_replied / emails_sent * 100, 1) if emails_sent > 0 else None,
        },
        "calls": {
            "made": calls_made,
            "connected": calls_connected,
            "unique_leads_called": unique_leads_called,
            "avg_calls_per_lead": avg_calls_per_lead,
            "null_outcome_count": calls_null_outcome,   # data quality signal
            "has_incomplete_logs": calls_null_outcome > 0,
        },
        "connect_rate": connect_rate,
        "avg_retries": avg_retries,
        "meetings": {
            "booked": meetings_booked,
            "no_shows": no_shows,
            "conversion_pct": round(meetings_booked / leads_assigned * 100, 1) if leads_assigned > 0 else None,
        },
        "disqualified": disqualified,
        "opportunity": {
            "won": opp_row.won or 0,
            "lost": opp_row.lost or 0,
        },
        "meta": {
            "cached": False,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "pod_scoped": effective_pod is not None,
        },
    }

    _cache_set(ckey, result)
    return result


# ─── Endpoint 2: Trend (time series) ─────────────────────────────────────────

@router.get("/trend")
def get_trend(
    preset: Optional[str] = Query("30d"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    pod_id: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    upload_log_id: Optional[str] = Query(None),
    sdr_id: Optional[str] = Query(None, description="Scope trend to a specific SDR"),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """
    Returns time-series data for Calls, Emails, Meetings, Research, and Disqualified.

    EC-12: Auto-granularity based on date range:
      ≤ 14 days  → daily
      15–90 days → weekly
      > 90 days  → monthly

    sdr_id: when provided, scopes all 4 metrics (calls, emails, meetings,
        disqualified) to that SDR only.
    """
    from datetime import timedelta

    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _effective_ae_sdr(admin)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, no pod-wide visibility
        sdr_id = effective_sdr  # force — ignore the query param, same idiom as _effective_pod_id
    # sdr_id may be an admin-picked filter even when effective_sdr (self-scope) is
    # None — resolve the actually-viewed SDR's own pod timezone either way.
    date_start, date_end = _resolve_analytics_date_range(db, effective_pod, effective_sdr or sdr_id, date_from, date_to, preset)

    ckey = _cache_key("trend", effective_pod, lead_source, upload_log_id, date_from or preset, date_to, sdr_id)
    cached = _cache_get(ckey)
    if cached:
        return cached

    # Determine granularity
    if date_start and date_end:
        delta_days = (date_end - date_start).days
    else:
        delta_days = 999  # all time → monthly

    if delta_days <= 14:
        granularity = "daily"
        trunc_fn = "day"
    elif delta_days <= 90:
        granularity = "weekly"
        trunc_fn = "week"
    else:
        granularity = "monthly"
        trunc_fn = "month"

    # Calls per period — UNION of dialer_calls + pure-manual call_logs
    # A) Dialer calls per period
    _dc_trend_q = db.query(
        func.date_trunc(trunc_fn, models.dialer_call_event_time()).label("period"),
        func.count(models.DialerCall.id).label("calls"),
    ).join(
        models.User, models.User.id == models.DialerCall.user_id
    ).filter(models.DialerCall.direction == "outbound")
    _dc_trend_q = models.exclude_test_and_deleted_leads(_dc_trend_q, models.DialerCall)
    if date_start:
        _dc_trend_q = _dc_trend_q.filter(models.dialer_call_event_time() >= date_start)
    if date_end:
        _dc_trend_q = _dc_trend_q.filter(models.dialer_call_event_time() <= date_end)
    if sdr_id:
        _dc_trend_q = _dc_trend_q.filter(models.DialerCall.user_id == sdr_id)
    if effective_pod or lead_source or upload_log_id:
        # Outerjoin Lead so the pod OR-fallback and lead_source/batch filters
        # share one join, same shape as funnel's _dc_q.
        _dc_trend_q = _dc_trend_q.outerjoin(models.Lead, models.Lead.id == models.DialerCall.lead_id)
        if effective_pod:
            # Was User.pod_id-only — disagreed with funnel's calls card, which
            # already has this OR-fallback.
            _dc_trend_q = _pod_scope_call_query(_dc_trend_q, effective_pod, effective_sdr)
        if lead_source:
            _dc_trend_q = _lead_source_filter(_dc_trend_q, lead_source)
        if upload_log_id:
            _dc_trend_q = _dc_trend_q.filter(models.Lead.upload_log_id == upload_log_id)
    _dc_trend_q = _dc_trend_q.group_by(text("1")).order_by(text("1"))
    _dc_trend_rows = _dc_trend_q.all()

    # B) Pure-manual call_logs per period
    _existing_dc_t = db.query(
        models.DialerCall.user_id,
        models.DialerCall.lead_id,
        func.date(models.dialer_call_event_time()).label("call_date"),
    ).filter(
        models.DialerCall.direction == "outbound",
        models.DialerCall.lead_id.isnot(None),
    ).subquery()
    _cl_trend_q = db.query(
        func.date_trunc(trunc_fn, models.CallLog.called_at).label("period"),
        func.count(models.CallLog.id).label("calls"),
    ).outerjoin(
        _existing_dc_t,
        (models.CallLog.user_id == _existing_dc_t.c.user_id) &
        (models.CallLog.lead_id == _existing_dc_t.c.lead_id) &
        (func.date(models.CallLog.called_at) == _existing_dc_t.c.call_date),
    ).filter(_existing_dc_t.c.user_id.is_(None))
    _cl_trend_q = models.exclude_test_and_deleted_leads(_cl_trend_q, models.CallLog)
    if date_start:
        _cl_trend_q = _cl_trend_q.filter(models.CallLog.called_at >= date_start)
    if date_end:
        _cl_trend_q = _cl_trend_q.filter(models.CallLog.called_at <= date_end)
    if sdr_id:
        _cl_trend_q = _cl_trend_q.filter(models.CallLog.user_id == sdr_id)
    if effective_pod or lead_source or upload_log_id:
        _cl_trend_q = _cl_trend_q.outerjoin(models.Lead, models.Lead.id == models.CallLog.lead_id)
        if effective_pod:
            # Was User-only (via subquery) — add the same Lead.pod_id fallback
            # funnel's manual-call query (_cl_q) has, for the same reason.
            _cl_trend_q = _cl_trend_q.outerjoin(models.User, models.User.id == models.CallLog.user_id)
            _cl_trend_q = _pod_scope_call_query(_cl_trend_q, effective_pod, effective_sdr)
        if lead_source:
            _cl_trend_q = _lead_source_filter(_cl_trend_q, lead_source)
        if upload_log_id:
            _cl_trend_q = _cl_trend_q.filter(models.Lead.upload_log_id == upload_log_id)
    _cl_trend_q = _cl_trend_q.group_by(text("1")).order_by(text("1"))
    _cl_trend_rows = _cl_trend_q.all()

    # Merge both into a single dict keyed by period
    _trend_calls: dict = {}
    for r in _dc_trend_rows:
        k = r.period.isoformat() if r.period else "unknown"
        _trend_calls[k] = (_trend_calls.get(k) or 0) + r.calls
    for r in _cl_trend_rows:
        k = r.period.isoformat() if r.period else "unknown"
        _trend_calls[k] = (_trend_calls.get(k) or 0) + r.calls
    call_rows = [type("R", (), {"period": k, "calls": v})() for k, v in _trend_calls.items()]

    # Emails per period
    email_q = db.query(
        func.date_trunc(trunc_fn, models.LeadEmailActivity.timestamp).label("period"),
        func.count(models.LeadEmailActivity.id).label("emails"),
    ).join(models.Lead, models.Lead.id == models.LeadEmailActivity.lead_id).filter(
        models.LeadEmailActivity.direction == "outbound"
    )
    if date_start:
        email_q = email_q.filter(models.LeadEmailActivity.timestamp >= date_start)
    if date_end:
        email_q = email_q.filter(models.LeadEmailActivity.timestamp <= date_end)
    email_q = _pod_scope_lead_query(email_q, effective_pod, effective_sdr)
    email_q = models.exclude_test_and_deleted_leads(email_q)
    if lead_source:
        email_q = _lead_source_filter(email_q, lead_source)
    if upload_log_id:
        email_q = email_q.filter(models.Lead.upload_log_id == upload_log_id)
    if sdr_id:
        email_q = email_q.filter(models.LeadEmailActivity.user_id == sdr_id)
    email_q = email_q.group_by(text("1")).order_by(text("1"))
    email_rows = email_q.all()

    # Meetings per period — bucket by COALESCE(lead_closed_at, status_changed_at).
    # lead_closed_at is set when a lead reaches a meeting status going forward,
    # but historical meetings (before v9.5.6) may have lead_closed_at = NULL.
    # COALESCE falls back to status_changed_at so all meetings appear in the chart
    # without requiring a data backfill. (Fix: v9.7.1 — 2026-06-16)
    _meeting_date = _lead_closed_date_expr()
    meeting_q = db.query(
        func.date_trunc(trunc_fn, _meeting_date).label("period"),
        func.count(models.Lead.id).label("meetings"),
    ).filter(
        models.Lead.status.in_(MEETING_REACHED_STATUSES),
        _meeting_date.isnot(None),
    )
    if date_start:
        meeting_q = meeting_q.filter(_meeting_date >= date_start)
    if date_end:
        meeting_q = meeting_q.filter(_meeting_date <= date_end)
    meeting_q = _pod_scope_lead_query(meeting_q, effective_pod, effective_sdr)
    meeting_q = models.exclude_test_and_deleted_leads(meeting_q)
    if lead_source:
        meeting_q = _lead_source_filter(meeting_q, lead_source)
    if upload_log_id:
        meeting_q = meeting_q.filter(models.Lead.upload_log_id == upload_log_id)
    if sdr_id:
        meeting_q = _scope_query_to_sdr_leads(db, meeting_q, sdr_id)
    meeting_q = meeting_q.group_by(text("1")).order_by(text("1"))
    meeting_rows = meeting_q.all()


    # Disqualified per period — same COALESCE(lead_closed_at, status_changed_at)
    # fallback as meetings above, so a disqualified lead missing lead_closed_at
    # (pre-fix rows) doesn't vanish from this chart while funnel still counts it.
    _disq_date = _lead_closed_date_expr()
    disq_q = db.query(
        func.date_trunc(trunc_fn, _disq_date).label("period"),
        func.count(models.Lead.id).label("disqualified"),
    ).filter(
        models.Lead.status.in_(DISQUALIFIED_STATUSES),
        _disq_date.isnot(None),
    )
    if date_start:
        disq_q = disq_q.filter(_disq_date >= date_start)
    if date_end:
        disq_q = disq_q.filter(_disq_date <= date_end)
    disq_q = _pod_scope_lead_query(disq_q, effective_pod, effective_sdr)
    disq_q = models.exclude_test_and_deleted_leads(disq_q)
    if lead_source:
        disq_q = _lead_source_filter(disq_q, lead_source)
    if upload_log_id:
        disq_q = disq_q.filter(models.Lead.upload_log_id == upload_log_id)
    if sdr_id:
        # RCA 2026-07-27: this was the only one of the 5 trend metrics not
        # scoped to sdr_id — filtering the chart by SDR left Disqualified
        # showing org-wide counts while Calls/Emails/Meetings/Research
        # correctly shrank, breaking the chart's internal consistency.
        disq_q = _scope_query_to_sdr_leads(db, disq_q, sdr_id)
    disq_q = disq_q.group_by(text("1")).order_by(text("1"))
    disq_rows = disq_q.all()

    # Merge into unified period list
    # Normalize period keys: strip TZ suffix so TZ-aware (DialerCall.created_at)
    # and TZ-naive (Lead.status_changed_at) timestamps merge into one bucket.
    def _norm_period(raw):
        """Normalize a period key to a consistent TZ-stripped ISO string."""
        if isinstance(raw, str):
            return raw.replace("+00:00", "").replace("Z", "")
        if raw is None:
            return "unknown"
        iso = raw.isoformat()
        return iso.replace("+00:00", "").replace("Z", "")

    periods: dict[str, dict] = {}
    _default = lambda: {"period": "", "calls": 0, "emails": 0, "meetings": 0, "disqualified": 0}
    for r in call_rows:
        k = _norm_period(r.period)
        periods.setdefault(k, _default()); periods[k]["period"] = k
        periods[k]["calls"] += r.calls
    for r in email_rows:
        k = _norm_period(r.period)
        periods.setdefault(k, _default()); periods[k]["period"] = k
        periods[k]["emails"] += r.emails
    for r in meeting_rows:
        k = _norm_period(r.period)
        periods.setdefault(k, _default()); periods[k]["period"] = k
        periods[k]["meetings"] += r.meetings
    for r in disq_rows:
        k = _norm_period(r.period)
        periods.setdefault(k, _default()); periods[k]["period"] = k
        periods[k]["disqualified"] += r.disqualified

    result = {
        "granularity": granularity,
        "series": sorted(periods.values(), key=lambda x: x["period"]),
        "meta": {"cached": False},
    }
    _cache_set(ckey, result)
    return result


def _compute_sdr_rows(db, effective_pod, date_from, date_to, preset, upload_log_id, lead_source=None, effective_sdr=None):
    """Shared aggregate builder for /sdr-table and /export — one definition of
    calls_made/calls_connected/connect_rate so the dashboard and the CSV export
    can never drift apart. Returns unsorted, unpaginated rows.

    effective_sdr (AE self-scope): restricts the whole table to that one
    user's row instead of a pod's worth of SDRs.

    date_from/date_to/preset (raw, not pre-resolved): a custom range is
    bucketed per-SDR using THAT SDR's own pod timezone (added 2026-08-14) —
    an SDR with no pod, or a pod with no timezone set, defaults to UTC.
    This means two SDRs can be querying different UTC instants for the
    "same" on-screen date — deliberate, since the whole point is that each
    team's own calendar day is what should be filtered, not one shared UTC
    day that splits a US team's real work day across two dates."""
    from datetime import timedelta
    from routes._admin_helpers import get_conversation_min_seconds

    ninety_days_ago = datetime.now(timezone.utc) - timedelta(days=90)
    conversation_min_seconds = get_conversation_min_seconds(db)

    user_q = db.query(models.User).filter(models.User.role.in_(["SDR", "AE"]))
    if effective_sdr:
        user_q = user_q.filter(models.User.id == effective_sdr)
    elif effective_pod:
        user_q = user_q.filter(models.User.pod_id == effective_pod)
    sdrs = user_q.all()
    from services import offboarding
    gone = offboarding.left_ids(db, sdrs)     # marked "left" on the row so a leaver is not mistaken for an idle rep

    # Group SDRs by their pod's timezone (default UTC) so each group's date
    # range is resolved against its own local day, not a single global one.
    pod_ids = {s.pod_id for s in sdrs if s.pod_id}
    pod_tz_map = dict(
        db.query(models.Pod.id, models.Pod.timezone).filter(models.Pod.id.in_(pod_ids)).all()
    ) if pod_ids else {}
    tz_groups: dict = {}
    for s in sdrs:
        tz_name = pod_tz_map.get(s.pod_id) or "UTC"
        tz_groups.setdefault(tz_name, []).append(s.id)

    def _needs_lead_join(q, model):
        if lead_source:
            q = q.join(models.Lead, models.Lead.id == model.lead_id)
            q = _lead_source_filter(q, lead_source)
        if upload_log_id:
            if not lead_source:
                q = q.join(models.Lead, models.Lead.id == model.lead_id)
            q = q.filter(models.Lead.upload_log_id == upload_log_id)
        return q

    lead_counts: dict = {}
    meeting_counts: dict = {}
    call_agg: dict = {}
    email_counts: dict = {}
    account_agg: dict = {}
    norm_sdr = _normalised_outcome_expr()

    for tz_name, sdr_ids in tz_groups.items():
        date_start, date_end = _resolve_date_range_for_tz(date_from, date_to, preset, tz_name)

        # ── Lead counts per SDR (date-filtered) ────────────────────────────
        lead_count_q = (
            db.query(
                models.lead_assignments.c.user_id,
                func.count(distinct(models.lead_assignments.c.lead_id)).label("leads_count"),
            )
            .join(models.Lead, models.Lead.id == models.lead_assignments.c.lead_id)
            .filter(~models.Lead.status.in_(models.PARKED_STATUSES))
        )
        lead_count_q = models.exclude_test_and_deleted_leads(lead_count_q)
        if date_start:
            lead_count_q = lead_count_q.filter(models.Lead.created_at >= date_start)
        if date_end:
            lead_count_q = lead_count_q.filter(models.Lead.created_at <= date_end)
        if lead_source:
            lead_count_q = _lead_source_filter(lead_count_q, lead_source)
        if upload_log_id:
            lead_count_q = lead_count_q.filter(models.Lead.upload_log_id == upload_log_id)
        lead_count_q = lead_count_q.filter(models.lead_assignments.c.user_id.in_(sdr_ids))
        lead_counts.update(dict(lead_count_q.group_by(models.lead_assignments.c.user_id).all()))

        # ── Meetings per SDR = meetings THEY booked in the window (lead_meetings), not leads they currently hold ──
        # (v13.12.1: the old query credited the lead's current owner and dated it by status_changed_at, which moves on any
        # later touch — so a rep with no calls showed meetings.) Same definition as the Leaderboard.
        meeting_q = (
            db.query(models.LeadMeeting.booked_by_user_id, func.count(models.LeadMeeting.id))
            .join(models.Lead, models.Lead.id == models.LeadMeeting.lead_id)
            .filter(models.LeadMeeting.booked_by_user_id.in_(sdr_ids), models.LeadMeeting.status != "cancelled")
        )
        meeting_q = models.exclude_test_and_deleted_leads(meeting_q)
        if date_start:
            meeting_q = meeting_q.filter(models.LeadMeeting.booked_at >= date_start)
        if date_end:
            meeting_q = meeting_q.filter(models.LeadMeeting.booked_at <= date_end)
        if lead_source:
            meeting_q = _lead_source_filter(meeting_q, lead_source)
        if upload_log_id:
            meeting_q = meeting_q.filter(models.Lead.upload_log_id == upload_log_id)
        meeting_counts.update(dict(meeting_q.group_by(models.LeadMeeting.booked_by_user_id).all()))

        # ── Call aggregates per SDR (dialer + manual combined) ─────────────
        _dc_sdr_q = (
            db.query(
                models.DialerCall.user_id,
                func.count(models.DialerCall.id).label("total"),
                func.count(case((
                    models.dialer_call_connected(conversation_min_seconds), models.DialerCall.id
                ))).label("connected"),
                func.count(case((
                    models.DialerCall.outcome.isnot(None), models.DialerCall.id
                ))).label("with_outcome"),
                func.count(case((
                    models.dialer_call_is_conversation(conversation_min_seconds), models.DialerCall.id
                ))).label("conversations"),
            )
            .filter(
                models.DialerCall.user_id.in_(sdr_ids),
                models.DialerCall.direction == "outbound",
            )
        )
        _dc_sdr_q = models.exclude_test_and_deleted_leads(_dc_sdr_q, models.DialerCall)
        if date_start:
            _dc_sdr_q = _dc_sdr_q.filter(models.dialer_call_event_time() >= date_start)
        if date_end:
            _dc_sdr_q = _dc_sdr_q.filter(models.dialer_call_event_time() <= date_end)
        _dc_sdr_q = _needs_lead_join(_dc_sdr_q, models.DialerCall)
        _dc_sdr_agg: dict = {}
        for row in _dc_sdr_q.group_by(models.DialerCall.user_id).all():
            _dc_sdr_agg[row[0]] = {"total": row[1] or 0, "connected": row[2] or 0, "with_outcome": row[3] or 0, "conversations": row[4] or 0}

        _cl_sdr_q = (
            db.query(
                models.CallLog.user_id,
                func.count(models.CallLog.id).label("total"),
                func.count(case((
                    _cl_connected(norm_sdr), models.CallLog.id
                ))).label("connected"),
                func.count(case((
                    models.CallLog.outcome.isnot(None), models.CallLog.id
                ))).label("with_outcome"),
                func.count(case((
                    models.call_log_is_conversation(), models.CallLog.id
                ))).label("conversations"),
            )
            # RCA 2026-08-20: exclude CallLog rows auto-created from a
            # DialerCall (dialer_call_id set by _auto_log_outcome) — without
            # this, every auto-tagged Aircall call is summed on both sides
            # below (dc_sdr_agg + cl_sdr_agg) and double-counted.
            .filter(
                models.CallLog.user_id.in_(sdr_ids),
                models.CallLog.dialer_call_id.is_(None),
            )
        )
        _cl_sdr_q = models.exclude_test_and_deleted_leads(_cl_sdr_q, models.CallLog)
        if date_start:
            _cl_sdr_q = _cl_sdr_q.filter(models.CallLog.called_at >= date_start)
        if date_end:
            _cl_sdr_q = _cl_sdr_q.filter(models.CallLog.called_at <= date_end)
        _cl_sdr_q = _needs_lead_join(_cl_sdr_q, models.CallLog)
        _cl_sdr_agg: dict = {}
        for row in _cl_sdr_q.group_by(models.CallLog.user_id).all():
            _cl_sdr_agg[row[0]] = {"total": row[1] or 0, "connected": row[2] or 0, "with_outcome": row[3] or 0, "conversations": row[4] or 0}

        for uid in set(list(_dc_sdr_agg.keys()) + list(_cl_sdr_agg.keys())):
            dc = _dc_sdr_agg.get(uid, {"total": 0, "connected": 0, "with_outcome": 0, "conversations": 0})
            cl = _cl_sdr_agg.get(uid, {"total": 0, "connected": 0, "with_outcome": 0, "conversations": 0})
            call_agg[uid] = {
                "total": dc["total"] + cl["total"],
                "connected": dc["connected"] + cl["connected"],
                "with_outcome": dc["with_outcome"] + cl["with_outcome"],
                "conversations": dc["conversations"] + cl["conversations"],
            }

        # ── Emails per SDR ──────────────────────────────────────────────────
        email_q = (
            db.query(
                models.LeadEmailActivity.user_id,
                func.count(models.LeadEmailActivity.id).label("emails_sent"),
            )
            .filter(
                models.LeadEmailActivity.user_id.in_(sdr_ids),
                models.LeadEmailActivity.direction == "outbound",
            )
        )
        email_q = models.exclude_test_and_deleted_leads(email_q, models.LeadEmailActivity)
        if date_start:
            email_q = email_q.filter(models.LeadEmailActivity.timestamp >= date_start)
        if date_end:
            email_q = email_q.filter(models.LeadEmailActivity.timestamp <= date_end)
        email_q = _needs_lead_join(email_q, models.LeadEmailActivity)
        email_counts.update(dict(email_q.group_by(models.LeadEmailActivity.user_id).all()))

        # ── Account-level calls (DialerCall → leads.company) ───────────────
        _dc_company_q = (
            db.query(
                models.DialerCall.user_id,
                func.count(distinct(func.lower(models.Lead.company))).label("acct_called"),
                func.count(
                    distinct(case(
                        (models.dialer_call_connected(conversation_min_seconds), func.lower(models.Lead.company)),
                        else_=None
                    ))
                ).label("acct_connected"),
            )
            .join(models.Lead, models.Lead.id == models.DialerCall.lead_id)
            .filter(
                models.DialerCall.user_id.in_(sdr_ids),
                models.DialerCall.direction == "outbound",
                models.Lead.company.isnot(None),
                models.Lead.company != "",
            )
        )
        _dc_company_q = models.exclude_test_and_deleted_leads(_dc_company_q)
        if date_start:
            _dc_company_q = _dc_company_q.filter(models.dialer_call_event_time() >= date_start)
        if date_end:
            _dc_company_q = _dc_company_q.filter(models.dialer_call_event_time() <= date_end)
        if lead_source:
            _dc_company_q = _lead_source_filter(_dc_company_q, lead_source)
        if upload_log_id:
            _dc_company_q = _dc_company_q.filter(models.Lead.upload_log_id == upload_log_id)
        _dc_company_agg: dict = {}
        for row in _dc_company_q.group_by(models.DialerCall.user_id).all():
            _dc_company_agg[row[0]] = {"called": row[1] or 0, "connected": row[2] or 0}

        # ── Account-level calls (CallLog → leads.company) ──────────────────
        _cl_company_q = (
            db.query(
                models.CallLog.user_id,
                func.count(distinct(func.lower(models.Lead.company))).label("acct_called"),
                func.count(
                    distinct(case(
                        (_cl_connected(norm_sdr), func.lower(models.Lead.company)),
                        else_=None
                    ))
                ).label("acct_connected"),
            )
            .join(models.Lead, models.Lead.id == models.CallLog.lead_id)
            .filter(
                models.CallLog.user_id.in_(sdr_ids),
                models.Lead.company.isnot(None),
                models.Lead.company != "",
            )
        )
        _cl_company_q = models.exclude_test_and_deleted_leads(_cl_company_q)
        if date_start:
            _cl_company_q = _cl_company_q.filter(models.CallLog.called_at >= date_start)
        if date_end:
            _cl_company_q = _cl_company_q.filter(models.CallLog.called_at <= date_end)
        if lead_source:
            _cl_company_q = _lead_source_filter(_cl_company_q, lead_source)
        if upload_log_id:
            _cl_company_q = _cl_company_q.filter(models.Lead.upload_log_id == upload_log_id)
        _cl_company_agg: dict = {}
        for row in _cl_company_q.group_by(models.CallLog.user_id).all():
            _cl_company_agg[row[0]] = {"called": row[1] or 0, "connected": row[2] or 0}

        # Merge (MAX — same company may appear in both dialer and manual logs)
        for uid in set(list(_dc_company_agg.keys()) + list(_cl_company_agg.keys())):
            dc_c = _dc_company_agg.get(uid, {"called": 0, "connected": 0})
            cl_c = _cl_company_agg.get(uid, {"called": 0, "connected": 0})
            account_agg[uid] = {
                "called": max(dc_c["called"], cl_c["called"]),
                "connected": max(dc_c["connected"], cl_c["connected"]),
            }

    # ── Assemble rows from pre-fetched aggregates ───────────────────────────
    rows = []
    for sdr in sdrs:
        calls_made = call_agg.get(sdr.id, {}).get("total", 0)
        calls_connected = call_agg.get(sdr.id, {}).get("connected", 0)
        conversations = call_agg.get(sdr.id, {}).get("conversations", 0)
        # BUG-ANALYTICS-1 fix: denominator must be calls_made (total calls),
        # not calls_with_outcome. Dividing by calls_with_outcome inflated the
        # connect rate for SDRs who only log outcomes for productive calls.
        connect_rate = round(calls_connected / calls_made * 100, 1) if calls_made > 0 else None
        emails_sent = email_counts.get(sdr.id, 0)
        leads_count = lead_counts.get(sdr.id, 0)
        meetings = meeting_counts.get(sdr.id, 0)

        # RCA 2026-08-03: a stale last_login_at used to flag inactive even when
        # has_any_activity was true — e.g. an SDR who dials entirely through
        # Klenty and never logs into the CRM itself. Real activity in the
        # selected range now always overrides a stale/absent login.
        has_any_activity = (calls_made > 0 or emails_sent > 0)
        is_inactive = (
            not has_any_activity
            and (sdr.last_login_at is None or sdr.last_login_at < ninety_days_ago)
        )

        acct = account_agg.get(sdr.id, {"called": 0, "connected": 0})
        accounts_called = acct["called"]
        accounts_connected = acct["connected"]
        account_connect_rate = (
            round(accounts_connected / accounts_called * 100, 1)
            if accounts_called > 0 else None
        )

        rows.append({
            "sdr_id": sdr.id,
            "sdr_name": sdr.name or sdr.email,
            "pod_id": sdr.pod_id,
            "left": sdr.id in gone,
            "is_inactive": is_inactive,
            "leads_assigned": leads_count,
            "calls_made": calls_made,
            "calls_connected": calls_connected,
            "connect_rate": connect_rate,
            "accounts_called": accounts_called,
            "accounts_connected": accounts_connected,
            "account_connect_rate": account_connect_rate,
            "emails_sent": emails_sent,
            "meetings": meetings,
            "conversations": conversations,
        })
    return rows


# ─── Endpoint 3: Per-SDR Performance Table ────────────────────────────────────

@router.get("/sdr-table")
def get_sdr_table(
    # BUG-ANALYTICS-4 fix: was "30d" — funnel defaults to None (all-time); SDR table must match.
    preset: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    pod_id: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    upload_log_id: Optional[str] = Query(None),
    sdr_id: Optional[str] = Query(None, description="Scope to a single rep (Analytics Hub Rep filter)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("calls_made", description="calls_made | emails_sent | meetings | connect_rate | leads_assigned | account_connect_rate"),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """
    Returns paginated per-SDR performance breakdown.

    EC-7: SDRs with no calls/emails in the selected range AND no last_login_at
    in 90+ days (or ever) are flagged as inactive. Real activity always
    overrides a stale login — a Klenty-only SDR who never logs into the CRM
    is not "inactive".
    EC-13: Leads with no SDR assignment aggregated as 'Unassigned'.
    """
    from datetime import timedelta

    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _resolve_sdr_filter(admin, sdr_id, db)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, no pod-wide visibility

    # Always return ALL SDRs (active + inactive); frontend toggles visibility client-side
    ckey = _cache_key("sdr", effective_pod, effective_sdr, lead_source, upload_log_id, date_from or preset, date_to, page, page_size, sort_by)
    cached = _cache_get(ckey)
    if cached:
        return cached

    # Date range is resolved per-SDR inside _compute_sdr_rows (each SDR's own
    # pod timezone), not once here — see _resolve_date_range_for_tz.
    rows = _compute_sdr_rows(db, effective_pod, date_from, date_to, preset, upload_log_id, lead_source, effective_sdr)

    # Sort
    sort_key_map = {
        "calls_made": lambda r: r["calls_made"],
        "emails_sent": lambda r: r["emails_sent"],
        "meetings": lambda r: r["meetings"],
        "connect_rate": lambda r: r["connect_rate"] or 0,
        "leads_assigned": lambda r: r["leads_assigned"],
        "account_connect_rate": lambda r: r["account_connect_rate"] or 0,
    }
    key_fn = sort_key_map.get(sort_by, sort_key_map["calls_made"])
    rows.sort(key=key_fn, reverse=True)

    # Paginate
    total = len(rows)
    start = (page - 1) * page_size
    paginated = rows[start: start + page_size]

    result = {
        "sdrs": paginated,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "meta": {"cached": False},
    }
    _cache_set(ckey, result)
    return result


# ─── Endpoint 4: Email Sequence Breakdown ────────────────────────────────────

@router.get("/email-breakdown")
def get_email_breakdown(
    preset: Optional[str] = Query("30d"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    pod_id: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    upload_log_id: Optional[str] = Query(None),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """
    EC-11: Infers email sequence stage by ROW_NUMBER per lead (ordered by timestamp).
    Stage 1 = Intro, Stage 2 = Follow-up 1, Stage 3 = Follow-up 2, 4+ = Additional.

    Uses a SQL window function (ROW_NUMBER) for efficiency.
    """
    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _effective_ae_sdr(admin)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, no pod-wide visibility
    date_start, date_end = _resolve_analytics_date_range(db, effective_pod, effective_sdr, date_from, date_to, preset)

    ckey = _cache_key("email_breakdown", effective_pod, effective_sdr, lead_source, upload_log_id, date_from or preset, date_to)
    cached = _cache_get(ckey)
    if cached:
        return cached

    # Raw SQL with window function for sequence position inference
    # is_test excluded unconditionally (not a user-facing filter, like pod/source below) —
    # Cadence/Messaging Sandbox test leads must never appear in real analytics.
    filters = ["lea.direction = 'outbound'", "l.is_test = false"]
    params: dict = {}

    if date_start:
        filters.append("lea.timestamp >= :date_start")
        params["date_start"] = date_start
    if date_end:
        filters.append("lea.timestamp <= :date_end")
        params["date_end"] = date_end
    if effective_sdr:
        # AE self-scope — same idiom as _pod_scope_lead_query, in raw SQL
        # since this endpoint doesn't go through the ORM.
        filters.append("""EXISTS (
            SELECT 1 FROM lead_assignments la WHERE la.lead_id = l.id AND la.user_id = :sdr_id
        )""")
        params["sdr_id"] = effective_sdr
    elif effective_pod:
        # OR-fallback mirrors _pod_scope_lead_query: the lead's own pod_id,
        # OR any of its assigned users belongs to the pod — same fix as
        # funnel/trend's email queries, needed here in raw SQL since this
        # endpoint doesn't go through the ORM.
        filters.append("""(l.pod_id = :pod_id OR EXISTS (
            SELECT 1 FROM lead_assignments la JOIN users u ON u.id = la.user_id
            WHERE la.lead_id = l.id AND u.pod_id = :pod_id
        ))""")
        params["pod_id"] = effective_pod
    if lead_source:
        # Use LIKE for prefix-based sources (google_sheet, uploaded)
        prefix = _SOURCE_PREFIX_MAP.get(lead_source)
        if prefix and "%" in prefix:
            filters.append("l.lead_source LIKE :lead_source")
            params["lead_source"] = prefix
        elif prefix:
            filters.append("l.lead_source = :lead_source")
            params["lead_source"] = prefix
        else:
            filters.append("l.lead_source = :lead_source")
            params["lead_source"] = lead_source
    if upload_log_id:
        filters.append("l.upload_log_id = :upload_log_id")
        params["upload_log_id"] = upload_log_id

    where_clause = " AND ".join(filters)

    sql = f"""
        WITH numbered AS (
            SELECT
                lea.id,
                lea.lead_id,
                lea.opened_at,
                ROW_NUMBER() OVER (
                    PARTITION BY lea.lead_id
                    ORDER BY lea.timestamp
                ) AS seq_pos
            FROM lead_email_activity lea
            JOIN leads l ON l.id = lea.lead_id
            WHERE {where_clause}
        ),
        stages AS (
            SELECT
                CASE
                    WHEN seq_pos = 1 THEN 'intro'
                    WHEN seq_pos = 2 THEN 'followup_1'
                    WHEN seq_pos = 3 THEN 'followup_2'
                    ELSE 'additional'
                END AS stage,
                COUNT(*) AS sent,
                COUNT(opened_at) AS opened
            FROM numbered
            GROUP BY 1
        )
        SELECT stage, sent, opened FROM stages ORDER BY
            CASE stage WHEN 'intro' THEN 1 WHEN 'followup_1' THEN 2 WHEN 'followup_2' THEN 3 ELSE 4 END
    """

    rows = db.execute(text(sql), params).fetchall()

    # Count inbound replies per stage (approximate: reply within thread)
    # Stage 1 thread replies = leads that replied after intro email
    # This requires a subquery cross-referencing email threads
    reply_sql = f"""
        SELECT COUNT(DISTINCT lea.nylas_thread_id)
        FROM lead_email_activity lea
        JOIN leads l ON l.id = lea.lead_id
        WHERE lea.direction = 'inbound' AND l.is_test = false
        {"AND EXISTS (SELECT 1 FROM lead_assignments la WHERE la.lead_id = l.id AND la.user_id = :sdr_id)" if effective_sdr else ("AND (l.pod_id = :pod_id OR EXISTS (SELECT 1 FROM lead_assignments la JOIN users u ON u.id = la.user_id WHERE la.lead_id = l.id AND u.pod_id = :pod_id))" if effective_pod else '')}
        {'AND l.lead_source = :lead_source' if lead_source else ''}
        {'AND l.upload_log_id = :upload_log_id' if upload_log_id else ''}
    """
    reply_params = {k: v for k, v in params.items() if k in ("pod_id", "sdr_id", "lead_source", "upload_log_id")}
    total_replies = db.execute(text(reply_sql), reply_params).scalar() or 0

    stage_labels = {
        "intro": "Intro",
        "followup_1": "Follow-up 1",
        "followup_2": "Follow-up 2",
        "additional": "Additional",
    }

    stages_out = []
    total_sent = 0
    for row in rows:
        sent = row.sent or 0
        opened = row.opened or 0
        total_sent += sent
        stages_out.append({
            "stage": row.stage,
            "label": stage_labels.get(row.stage, row.stage),
            "sent": sent,
            "opened": opened,
            "open_rate": round(opened / sent * 100, 1) if sent > 0 else None,
        })

    result = {
        "stages": stages_out,
        "total_sent": total_sent,
        "total_replies": total_replies,
        "overall_reply_rate": round(total_replies / total_sent * 100, 1) if total_sent > 0 else None,
        "meta": {"cached": False},
    }
    _cache_set(ckey, result)
    return result


# ─── Endpoint 5: Filter options ───────────────────────────────────────────────

# Human-readable source label map used in batch labels
_BATCH_SOURCE_LABEL_MAP = {
    "gsheet":     "Google Sheet",
    "upload":     "Upload",
    "salesforce": "Salesforce",
    "manual":     "Manual",
}


def _batch_source_label(filename: str) -> str:
    """Derive human-readable source label from batch filename prefix."""
    if not filename:
        return "Upload"
    prefix = filename.split("-")[0] if "-" in filename else filename.split(":")[0]
    return _BATCH_SOURCE_LABEL_MAP.get(prefix.lower(), "Upload")


@router.get("/filters")
def get_filter_options(
    pod_id: Optional[str] = Query(None, description="Scope batches to this pod's leads"),
    date_from: Optional[str] = Query(None, description="Scope batches uploaded from this date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Scope batches uploaded to this date (YYYY-MM-DD)"),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """
    Returns data for populating filter dropdowns.
    Pod Admins only see their own pod.
    When pod_id + date_from/date_to are provided, batches are scoped to that window.
    Each batch includes: id, label ([Source] · [Date]), source, upload_date.
    """
    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _effective_ae_sdr(admin)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, no pod-wide visibility
    # Use a cache key that includes date range so scoped calls are cached independently
    ckey = _cache_key("filters", admin.get("sub"), effective_pod, date_from, date_to)
    cached = _cache_get(ckey)
    if cached:
        return cached

    # Pods (EC-6: Pod Admins only see their pod; AE has no pod-wide view at all)
    if effective_sdr:
        pods = []
    elif admin.get("role") == "Pod Admin":
        pod_q = db.query(models.Pod).filter(models.Pod.id == admin.get("pod_id"))
        pods = [{"id": p.id, "name": p.name} for p in pod_q.all()]
    else:
        pod_q = db.query(models.Pod)
        pods = [{"id": p.id, "name": p.name} for p in pod_q.all()]

    # Distinct lead sources — normalized into categories
    source_categories = []
    try:
        raw_sources = [
            r[0] for r in db.query(distinct(models.Lead.lead_source))
            .filter(models.Lead.lead_source.isnot(None))
            .all()
            if r[0]
        ]
        seen = set()
        _source_label_map = {
            "gsheet": {"value": "google_sheet", "label": "Google Sheet"},
            "upload": {"value": "uploaded", "label": "Uploaded"},
            "salesforce": {"value": "salesforce", "label": "Salesforce"},
            "manual": {"value": "manual", "label": "Manual"},
        }
        for src in raw_sources:
            prefix = src.split(":")[0] if ":" in src else src
            if prefix not in seen:
                seen.add(prefix)
                mapped = _source_label_map.get(prefix)
                if mapped:
                    source_categories.append(mapped)
                else:
                    source_categories.append({"value": src, "label": src.replace("_", " ").title()})
        # Deduplicate by value before returning
        seen_values = set()
        deduped = []
        for sc in source_categories:
            if sc["value"] not in seen_values:
                seen_values.add(sc["value"])
                deduped.append(sc)
        source_categories = sorted(deduped, key=lambda x: x["label"])
    except Exception as e:
        logger.warning("analytics/filters source normalization failed: %s", e)

    # SDRs (scoped by pod for Pod Admins, self-only for AE) — include pod_id
    # for frontend cascade
    sdr_q = db.query(models.User).filter(models.User.role.in_(["SDR", "AE"]))
    if effective_sdr:
        sdr_q = sdr_q.filter(models.User.id == effective_sdr)
    elif admin.get("role") == "Pod Admin":
        eff = _effective_pod_id(admin, None)
        if eff:
            sdr_q = sdr_q.filter(models.User.pod_id == eff)
    elif effective_pod:
        sdr_q = sdr_q.filter(models.User.pod_id == effective_pod)
    sdrs = [
        {"id": str(u.id), "name": (u.name or u.email or "").strip(), "pod_id": str(u.pod_id) if u.pod_id else None}
        for u in sdr_q.order_by(models.User.name).all()
    ]

    # Upload batches — scoped by date range when provided
    batches = []
    if hasattr(models, "LeadUploadLog"):
        try:
            from datetime import timedelta
            batch_q = db.query(
                models.LeadUploadLog.id,
                models.LeadUploadLog.filename,
                models.LeadUploadLog.created_at,
            )
            # Apply date range scoping if provided
            if date_from:
                try:
                    df = datetime.fromisoformat(date_from).replace(
                        hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc
                    )
                    batch_q = batch_q.filter(models.LeadUploadLog.created_at >= df)
                except ValueError:
                    pass
            if date_to:
                try:
                    dt = datetime.fromisoformat(date_to).replace(
                        hour=23, minute=59, second=59, microsecond=0, tzinfo=timezone.utc
                    )
                    batch_q = batch_q.filter(models.LeadUploadLog.created_at <= dt)
                except ValueError:
                    pass

            batch_q = batch_q.order_by(models.LeadUploadLog.created_at.desc()).limit(100)
            batch_rows = batch_q.all()

            # Lead counts per batch, broken down by pod, via the real Lead.upload_log_id
            # FK (indexed) — no filename/timing heuristics. A batch only appears in the
            # dropdown if it actually has leads (in the scoped pod, when one is given),
            # so a selection can never be a guaranteed-empty dead end.
            batch_ids = [r.id for r in batch_rows]
            pod_counts_by_batch: dict = {}
            pod_name_by_id: dict = {}
            sdr_counts_by_batch: dict = {}
            if batch_ids:
                count_rows = (
                    db.query(models.Lead.upload_log_id, models.Lead.pod_id, func.count(models.Lead.id))
                    .filter(models.Lead.upload_log_id.in_(batch_ids))
                    .group_by(models.Lead.upload_log_id, models.Lead.pod_id)
                    .all()
                )
                for bid, pid, cnt in count_rows:
                    pod_counts_by_batch.setdefault(bid, []).append((pid, cnt))

                all_pod_ids = {pid for counts in pod_counts_by_batch.values() for pid, _ in counts if pid}
                if all_pod_ids:
                    pod_name_by_id = dict(
                        db.query(models.Pod.id, models.Pod.name).filter(models.Pod.id.in_(all_pod_ids)).all()
                    )

                if effective_sdr:
                    # AE/SDR self-scope: count only leads in this batch assigned to them,
                    # not every lead in the batch org-wide.
                    sdr_count_rows = (
                        db.query(models.Lead.upload_log_id, func.count(distinct(models.Lead.id)))
                        .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id)
                        .filter(
                            models.Lead.upload_log_id.in_(batch_ids),
                            models.lead_assignments.c.user_id == effective_sdr,
                        )
                        .group_by(models.Lead.upload_log_id)
                        .all()
                    )
                    sdr_counts_by_batch = dict(sdr_count_rows)

            for r in batch_rows:
                pod_breakdown = pod_counts_by_batch.get(r.id, [])
                if effective_pod:
                    lead_count = sum(cnt for pid, cnt in pod_breakdown if pid == effective_pod)
                elif effective_sdr:
                    lead_count = sdr_counts_by_batch.get(r.id, 0)
                else:
                    lead_count = sum(cnt for _, cnt in pod_breakdown)
                if lead_count == 0:
                    continue  # no leads (in scope) \u2014 would be a dead-end selection

                dominant_pod_id = max(pod_breakdown, key=lambda pc: pc[1])[0] if pod_breakdown else None
                pod_name = pod_name_by_id.get(dominant_pod_id) if dominant_pod_id else None

                src_label = _batch_source_label(r.filename or "")
                upload_date_str = r.created_at.strftime("%b %-d") if r.created_at else "Unknown"

                label_parts = [r.filename or src_label, upload_date_str]
                if pod_name:
                    label_parts.append(pod_name)

                batches.append({
                    "id": r.id,
                    "label": " \u00b7 ".join(label_parts),
                    "filename": r.filename,
                    "source": src_label,
                    "upload_date": r.created_at.strftime("%Y-%m-%d") if r.created_at else None,
                    "upload_date_display": upload_date_str,
                    "pod_name": pod_name,
                    "lead_count": lead_count,
                })
        except Exception as e:
            logger.warning("analytics/filters batch query failed: %s", e)

    result = {"pods": pods, "lead_sources": source_categories, "batches": batches, "sdrs": sdrs}
    _cache_set(ckey, result)
    return result


# ─── Endpoint 6: CSV Export (streaming) ──────────────────────────────────────

@router.get("/export", dependencies=[Depends(require_export_access)])
def export_csv(
    preset: Optional[str] = Query("30d"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    pod_id: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    sdr_id: Optional[str] = Query(None, description="Scope to a single rep (Analytics Hub Rep filter)"),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """
    EC-14: Streams a CSV export of the per-SDR performance table.
    Uses chunked query to avoid loading full dataset into memory.
    """
    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _resolve_sdr_filter(admin, sdr_id, db)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, no pod-wide visibility

    def generate():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "SDR Name", "Pod ID", "Status",
            "Leads Assigned", "Calls Made", "Calls Connected", "Conversations",
            "Connect Rate (%)", "Emails Sent", "Meetings Booked",
        ])
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        # Same aggregate builder as /sdr-table (dialer_calls + call_logs,
        # calls_made denominator) — previously reimplemented here with its own
        # CallLog-only query and the wrong (calls_with_outcome) denominator,
        # so the export silently disagreed with the dashboard.
        rows = _compute_sdr_rows(db, effective_pod, date_from, date_to, preset, None, lead_source, effective_sdr)

        for r in rows:
            writer.writerow([
                r["sdr_name"],
                r["pod_id"] or "",
                "Inactive" if r["is_inactive"] else "Active",
                r["leads_assigned"],
                r["calls_made"],
                r["calls_connected"],
                r["conversations"],
                r["connect_rate"] if r["connect_rate"] is not None else "",
                r["emails_sent"],
                r["meetings"],
            ])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    filename = f"analytics_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── AI insights routes moved to analytics_ai_routes.py ───────────────────────
# ── Daily digest routes moved to analytics_digest_routes.py ──────────────────

# ─── Endpoint 9: Batch summary (All Batches view) ─────────────────────────────
#
# Returns one aggregate row per batch within the selected date range + pod.
# Used by the All Batches comparison table.


@router.get("/batch-summary")
def get_batch_summary(
    pod_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    sdr_id: Optional[str] = Query(None, description="Scope to a single rep (Analytics Hub Rep filter)"),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """
    Returns per-batch aggregate metrics for the All Batches comparison table.
    Columns: batch label, leads, calls, connect_rate, meetings, disqualified, research_done.
    """
    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _resolve_sdr_filter(admin, sdr_id, db)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, no pod-wide visibility
    date_start, date_end = _resolve_analytics_date_range(db, effective_pod, effective_sdr, date_from, date_to, None)

    from routes._admin_helpers import get_conversation_min_seconds
    conversation_min_seconds = get_conversation_min_seconds(db)

    def _with_date_bound(condition, date_col):
        """AND a date range onto a CASE condition. RCA 2026-07-27: per-batch
        calls/meetings/disqualified/research previously ignored date_from/
        date_to entirely — the date range only selected which batches appear,
        not the activity counted for them, unlike every other Analytics Hub
        card (which all time-bound the activity itself)."""
        conds = [condition]
        if date_start:
            conds.append(date_col >= date_start)
        if date_end:
            conds.append(date_col <= date_end)
        return and_(*conds) if len(conds) > 1 else conds[0]

    ckey = _cache_key("batch_summary", effective_pod, effective_sdr, date_from, date_to)
    cached = _cache_get(ckey)
    if cached:
        return cached

    if not hasattr(models, "LeadUploadLog"):
        return {"batches": []}

    try:
        batch_q = db.query(
            models.LeadUploadLog.id,
            models.LeadUploadLog.filename,
            models.LeadUploadLog.created_at,
        )
        if date_start:
            batch_q = batch_q.filter(models.LeadUploadLog.created_at >= date_start)
        if date_end:
            batch_q = batch_q.filter(models.LeadUploadLog.created_at <= date_end)
        batch_rows = batch_q.order_by(models.LeadUploadLog.created_at.desc()).limit(100).all()
    except Exception as e:
        logger.warning("batch-summary: batch query failed: %s", e)
        return {"batches": []}

    # Real FK — no lead_source/filename resolution needed.
    batch_ids = [b.id for b in batch_rows]
    if not batch_ids:
        result_rows = []
    else:
        # ── BULK QUERY 1: Lead counts per batch ─────────────────────────
        lead_q = (
            db.query(models.Lead.upload_log_id, func.count(models.Lead.id))
            .filter(models.Lead.upload_log_id.in_(batch_ids))
        )
        lead_q = _pod_scope_lead_query(lead_q, effective_pod, effective_sdr)
        lead_q = models.exclude_test_and_deleted_leads(lead_q)
        lead_counts = dict(lead_q.group_by(models.Lead.upload_log_id).all())

        # ── BULK QUERY 2: Call aggregates per batch (dialer + manual) ──
        # Previously CallLog-only, which misses all Aircall/Klenty/Alternate CRM
        # calls in dialer_calls — same gap as the old /export bug.
        norm = _normalised_outcome_expr()
        _cl_call_q = (
            db.query(
                models.Lead.upload_log_id,
                func.count(models.CallLog.id).label("total"),
                func.count(case((_cl_connected(norm), models.CallLog.id))).label("connected"),
            )
            .join(models.Lead, models.Lead.id == models.CallLog.lead_id)
            # RCA 2026-08-20: exclude CallLog rows auto-created from a
            # DialerCall (dialer_call_id set by _auto_log_outcome) — without
            # this, every auto-tagged Aircall call is summed twice below
            # (_cl_call_agg + _dc_call_agg).
            .filter(
                models.Lead.upload_log_id.in_(batch_ids),
                models.CallLog.dialer_call_id.is_(None),
            )
        )
        _cl_call_q = _pod_scope_lead_query(_cl_call_q, effective_pod, effective_sdr)
        _cl_call_q = models.exclude_test_and_deleted_leads(_cl_call_q)
        if date_start:
            _cl_call_q = _cl_call_q.filter(models.CallLog.called_at >= date_start)
        if date_end:
            _cl_call_q = _cl_call_q.filter(models.CallLog.called_at <= date_end)
        _cl_call_agg = {
            row[0]: {"total": row[1] or 0, "connected": row[2] or 0}
            for row in _cl_call_q.group_by(models.Lead.upload_log_id).all()
        }

        _dc_call_q = (
            db.query(
                models.Lead.upload_log_id,
                func.count(models.DialerCall.id).label("total"),
                func.count(case((
                    models.dialer_call_connected(conversation_min_seconds), models.DialerCall.id
                ))).label("connected"),
            )
            .join(models.Lead, models.Lead.id == models.DialerCall.lead_id)
            .filter(
                models.Lead.upload_log_id.in_(batch_ids),
                models.DialerCall.direction == "outbound",
            )
        )
        _dc_call_q = _pod_scope_lead_query(_dc_call_q, effective_pod, effective_sdr)
        _dc_call_q = models.exclude_test_and_deleted_leads(_dc_call_q)
        if date_start:
            _dc_call_q = _dc_call_q.filter(models.dialer_call_event_time() >= date_start)
        if date_end:
            _dc_call_q = _dc_call_q.filter(models.dialer_call_event_time() <= date_end)
        _dc_call_agg = {
            row[0]: {"total": row[1] or 0, "connected": row[2] or 0}
            for row in _dc_call_q.group_by(models.Lead.upload_log_id).all()
        }

        call_agg = {}
        for bid in set(list(_cl_call_agg.keys()) + list(_dc_call_agg.keys())):
            cl = _cl_call_agg.get(bid, {"total": 0, "connected": 0})
            dc = _dc_call_agg.get(bid, {"total": 0, "connected": 0})
            call_agg[bid] = {"total": cl["total"] + dc["total"], "connected": cl["connected"] + dc["connected"]}

        # ── BULK QUERY 3: Status-based counts per batch ─────────────────
        # Each metric is date-bound by the same column /funnel and /trend use
        # for it (lead_closed_at for meetings/disqualified, status_changed_at
        # for research), so picking a date range actually changes these
        # numbers instead of only changing which batches are listed.
        status_q = (
            db.query(
                models.Lead.upload_log_id,
                func.count(case((
                    _with_date_bound(models.Lead.status.in_(MEETING_REACHED_STATUSES), models.Lead.lead_closed_at),
                    models.Lead.id
                ))).label("meetings"),
                func.count(case((
                    _with_date_bound(models.Lead.status.in_(DISQUALIFIED_STATUSES), models.Lead.lead_closed_at),
                    models.Lead.id
                ))).label("disqualified"),
                func.count(case((
                    _with_date_bound(models.Lead.research_personalization.isnot(None), models.Lead.status_changed_at),
                    models.Lead.id
                ))).label("research"),
            )
            .filter(models.Lead.upload_log_id.in_(batch_ids))
        )
        status_q = _pod_scope_lead_query(status_q, effective_pod, effective_sdr)
        status_q = models.exclude_test_and_deleted_leads(status_q)
        status_agg = {}
        for row in status_q.group_by(models.Lead.upload_log_id).all():
            status_agg[row[0]] = {"meetings": row[1] or 0, "disqualified": row[2] or 0, "research": row[3] or 0}

        # ── BULK QUERY 4: Qualified/disqualified per (batch, SDR) ────────
        # RCA 2026-08-17: stakeholder ask — "analytics on qualified/
        # disqualified accounts & leads by list/SDR/time period". List and
        # period already existed above (upload_log_id + date bounding); SDR
        # was the missing axis. "Qualified" = reached MEETING_REACHED_STATUSES,
        # same bar /funnel and this endpoint's own "meetings" column already
        # use — not a new definition.
        sdr_q = (
            db.query(
                models.Lead.upload_log_id,
                models.User.id,
                models.User.name,
                func.count(case((
                    _with_date_bound(models.Lead.status.in_(MEETING_REACHED_STATUSES), models.Lead.lead_closed_at),
                    models.Lead.id
                ))).label("qualified"),
                func.count(case((
                    _with_date_bound(models.Lead.status.in_(DISQUALIFIED_STATUSES), models.Lead.lead_closed_at),
                    models.Lead.id
                ))).label("disqualified"),
            )
            .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id)
            .join(models.User, models.User.id == models.lead_assignments.c.user_id)
            .filter(models.Lead.upload_log_id.in_(batch_ids))
        )
        sdr_q = _pod_scope_lead_query(sdr_q, effective_pod, effective_sdr)
        sdr_q = models.exclude_test_and_deleted_leads(sdr_q)
        sdr_agg = {}
        for bid, sdr_id, sdr_name, qualified, disqualified in sdr_q.group_by(
            models.Lead.upload_log_id, models.User.id, models.User.name
        ).all():
            if not qualified and not disqualified:
                continue  # no qualifying activity for this SDR in this batch — skip the noise
            sdr_agg.setdefault(bid, []).append({
                "sdr_id": sdr_id,
                "sdr_name": sdr_name,
                "qualified": qualified or 0,
                "disqualified": disqualified or 0,
            })

        # ── Assemble rows ───────────────────────────────────────────────
        result_rows = []
        for b in batch_rows:
            leads = lead_counts.get(b.id, 0)
            if leads == 0:
                continue

            c = call_agg.get(b.id, {"total": 0, "connected": 0})
            # Denominator is total calls made, not calls_with_outcome (BUG-ANALYTICS-1
            # pattern) — matches /sdr-table and /export.
            connect_rate = round(c["connected"] / c["total"] * 100, 1) if c["total"] > 0 else None
            s = status_agg.get(b.id, {"meetings": 0, "disqualified": 0, "research": 0})

            src_label = _batch_source_label(b.filename or "")
            upload_date_str = b.created_at.strftime("%b %-d") if b.created_at else "Unknown"

            result_rows.append({
                "id": b.id,
                "label": f"{src_label} \u00b7 {upload_date_str}",
                "source": src_label,
                "upload_date": b.created_at.strftime("%Y-%m-%d") if b.created_at else None,
                "leads": leads,
                "calls": c["total"],
                "_connected": c["connected"],
                "connect_rate": connect_rate,
                "meetings": s["meetings"],
                "disqualified": s["disqualified"],
                "research_done": s["research"],
                "by_sdr": sdr_agg.get(b.id, []),
            })

    # Totals row
    total_calls = sum(r["calls"] for r in result_rows)
    total_connected = sum(r["_connected"] for r in result_rows)
    totals = {
        "id": None,
        "label": "Total",
        "source": None,
        "upload_date": None,
        "leads": sum(r["leads"] for r in result_rows),
        "calls": total_calls,
        "connect_rate": round(total_connected / total_calls * 100, 1) if total_calls > 0 else None,
        "meetings": sum(r["meetings"] for r in result_rows),
        "disqualified": sum(r["disqualified"] for r in result_rows),
        "research_done": sum(r["research_done"] for r in result_rows),
    }
    for r in result_rows:
        r.pop("_connected", None)

    result = {"batches": result_rows, "totals": totals}
    _cache_set(ckey, result)
    return result


# ─── Endpoint 10: Lead Activity (Analytics Hub drill-down) ────────────────────
#
# Per-lead assignment + call activity, scoped by the same POD/date/batch/rep
# filters as the rest of the hub. Reuses get_upload_batch_leads' assignment
# shape (admin_upload_routes.py) and Lead's own call_attempt_count/
# last_call_timestamp tracking instead of re-deriving call counts from
# call_logs — those fields are already kept in sync on every logged call.

@router.get("/leads")
def get_lead_activity(
    pod_id: Optional[str] = Query(None),
    preset: Optional[str] = Query(None, description="7d | 30d | 90d | all"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    upload_log_id: Optional[str] = Query(None),
    sdr_id: Optional[str] = Query(None, description="Scope to a single rep (Analytics Hub Rep filter)"),
    sort_by: Optional[str] = Query(
        None, description="company | status | calls | last_activity (prefix '-' for descending); default -created_at"
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """Per-lead rows for the Analytics Hub 'Lead Activity' panel: who's
    assigned, how many calls, what the last outcome was.

    sort_by only covers columns that live directly on Lead (company, status,
    call_attempt_count, last_call_timestamp) — email_count/last_call_outcome/
    last_email_status/assigned_to are computed in a second bulk pass after
    pagination (see below) and would need real query restructuring to sort
    on; skipped for now as a lazy-but-correct call, not an oversight."""
    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _resolve_sdr_filter(admin, sdr_id, db)
    if effective_sdr:
        effective_pod = None
    date_start, date_end = _resolve_analytics_date_range(db, effective_pod, effective_sdr, date_from, date_to, preset)

    query = db.query(models.Lead)
    query = _pod_scope_lead_query(query, effective_pod, effective_sdr)
    query = models.exclude_test_and_deleted_leads(query)
    if upload_log_id:
        # Batch scoping overrides date scoping — a batch can predate the
        # selected window (same rule as _compute_leads_assigned_count).
        query = query.filter(models.Lead.upload_log_id == upload_log_id)
    else:
        if date_start:
            query = query.filter(models.Lead.created_at >= date_start)
        if date_end:
            query = query.filter(models.Lead.created_at <= date_end)

    total = query.count()
    sort_columns = {
        "company": models.Lead.company,
        "status": models.Lead.status,
        "calls": models.Lead.call_attempt_count,
        "last_activity": models.Lead.last_call_timestamp,
    }
    sort_col, sort_desc = resolve_sort(sort_by, sort_columns)
    if sort_col is not None:
        query = query.order_by(sort_col.desc() if sort_desc else sort_col.asc(), models.Lead.id)
    else:
        query = query.order_by(models.Lead.created_at.desc(), models.Lead.id)
    leads = (
        query.offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    # Last call outcome per lead — one bulk query, not N+1. Leads in a single
    # page rarely have more than a handful of calls each, so fetching every
    # matching call_logs row and keeping the last one in Python is simpler
    # and just as cheap as a DISTINCT ON that only Postgres (not the SQLite
    # test DB) supports.
    lead_ids = [l.id for l in leads]
    last_outcome_by_lead = {}
    if lead_ids:
        call_rows = (
            db.query(models.CallLog.lead_id, models.CallLog.outcome)
            .filter(models.CallLog.lead_id.in_(lead_ids))
            .order_by(models.CallLog.called_at.asc())
            .all()
        )
        for lid, outcome in call_rows:
            last_outcome_by_lead[lid] = outcome  # last write per lead_id wins

    # Email activity per lead, same bulk-not-N+1 shape as calls above. Status
    # is the furthest stage reached (sent < opened < clicked), not the last
    # email chronologically — a lead with 3 sends where only the 1st was
    # opened should still show "opened", not silently regress to "sent".
    email_count_by_lead = {}
    email_status_by_lead = {}
    if lead_ids:
        email_rows = (
            db.query(
                models.LeadEmailActivity.lead_id,
                models.LeadEmailActivity.clicked_at,
                models.LeadEmailActivity.opened_at,
            )
            .filter(
                models.LeadEmailActivity.lead_id.in_(lead_ids),
                models.LeadEmailActivity.direction == "outbound",
            )
            .all()
        )
        stage_rank = {"sent": 0, "opened": 1, "clicked": 2}
        for lid, clicked_at, opened_at in email_rows:
            email_count_by_lead[lid] = email_count_by_lead.get(lid, 0) + 1
            stage = "clicked" if clicked_at else ("opened" if opened_at else "sent")
            if stage_rank[stage] > stage_rank.get(email_status_by_lead.get(lid), -1):
                email_status_by_lead[lid] = stage

    # Connects vs logged outcomes — "did anyone actually tag what happened on
    # this connect" (dialer_call_connected() is the single source of truth
    # for what counts as a connect, shared with the funnel/SDR-table so this
    # can't silently disagree with those). One query over every filtered
    # lead (not just this page) feeds both the header aggregate and each
    # page row's flag, instead of querying the same table twice.
    from routes._admin_helpers import get_conversation_min_seconds
    conversation_min_seconds = get_conversation_min_seconds(db)

    all_ids = [row[0] for row in query.with_entities(models.Lead.id).all()]
    connect_no_outcome_by_lead = {}
    total_connects = 0
    connects_with_outcome = 0
    if all_ids:
        for lid, outcome in (
            db.query(models.DialerCall.lead_id, models.DialerCall.outcome)
            .filter(models.DialerCall.lead_id.in_(all_ids), models.dialer_call_connected(conversation_min_seconds))
            .all()
        ):
            total_connects += 1
            if outcome is None:
                connect_no_outcome_by_lead[lid] = True
            else:
                connects_with_outcome += 1
                connect_no_outcome_by_lead.setdefault(lid, False)

    rows = []
    for lead in leads:
        assigned = [{"id": u.id, "name": u.name or u.email} for u in (lead.assigned_users or [])]
        rows.append({
            "id": lead.id,
            "name": f"{lead.first_name or ''} {lead.last_name or ''}".strip() or lead.email,
            "company": lead.company,
            "status": lead.status,
            "assigned_to": assigned,
            "call_count": lead.call_attempt_count or 0,
            "last_call_outcome": last_outcome_by_lead.get(lead.id),
            "last_activity_at": str(lead.last_call_timestamp) if lead.last_call_timestamp else None,
            "email_count": email_count_by_lead.get(lead.id, 0),
            "last_email_status": email_status_by_lead.get(lead.id),
            "connect_no_outcome": connect_no_outcome_by_lead.get(lead.id, False),
        })

    return {
        "leads": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "total_connects": total_connects,
        "connects_with_outcome": connects_with_outcome,
    }


@router.get("/leads/{lead_id}/timeline")
def get_lead_timeline(
    lead_id: str,
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """Chronological status-change + call history for one lead — the
    expand-row detail behind the Lead Activity panel."""
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    authorize_lead(admin, lead)

    effective_sdr = _effective_ae_sdr(admin)
    if effective_sdr:
        if effective_sdr not in {u.id for u in (lead.assigned_users or [])}:
            raise HTTPException(status_code=403, detail="Not your lead")
    else:
        effective_pod = _effective_pod_id(admin, None)
        if effective_pod and lead.pod_id != effective_pod:
            raise HTTPException(status_code=403, detail="Lead is outside your pod")

    events = []
    for sl in db.query(models.LeadStatusLog).filter(models.LeadStatusLog.lead_id == lead_id).all():
        events.append({
            "type": "status_change",
            "at": str(sl.changed_at) if sl.changed_at else None,
            "detail": f"{sl.from_status or 'New'} → {sl.to_status}",
            "by": sl.changed_by,
        })

    call_user_ids = set()
    call_logs = db.query(models.CallLog).filter(models.CallLog.lead_id == lead_id).all()
    call_user_ids.update(cl.user_id for cl in call_logs if cl.user_id)
    dialer_calls = db.query(models.DialerCall).filter(models.DialerCall.lead_id == lead_id).all()
    call_user_ids.update(dc.user_id for dc in dialer_calls if dc.user_id)
    user_name_by_id = {
        u.id: (u.name or u.email)
        for u in db.query(models.User).filter(models.User.id.in_(call_user_ids)).all()
    } if call_user_ids else {}

    for cl in call_logs:
        events.append({
            "type": "call",
            "at": str(cl.called_at) if cl.called_at else None,
            "detail": cl.outcome,
            "notes": cl.notes,
            "by": user_name_by_id.get(cl.user_id),
        })
    for dc in dialer_calls:
        event_time = dc.started_at or dc.created_at
        events.append({
            "type": "dialer_call",
            "at": str(event_time) if event_time else None,
            "detail": dc.outcome or dc.provider_disposition,
            "notes": None,
            "by": user_name_by_id.get(dc.user_id),
        })

    email_user_ids = set()
    emails = db.query(models.LeadEmailActivity).filter(models.LeadEmailActivity.lead_id == lead_id).all()
    email_user_ids.update(e.user_id for e in emails if e.user_id)
    if email_user_ids - call_user_ids:
        user_name_by_id.update({
            u.id: (u.name or u.email)
            for u in db.query(models.User).filter(models.User.id.in_(email_user_ids - call_user_ids)).all()
        })
    for e in emails:
        if e.direction == "outbound":
            stage = "clicked" if e.clicked_at else ("opened" if e.opened_at else "sent")
            events.append({
                "type": "email",
                "at": str(e.timestamp) if e.timestamp else None,
                "detail": f"{e.subject or '(no subject)'} — {stage}",
                "notes": None,
                "by": user_name_by_id.get(e.user_id),
            })
        else:
            events.append({
                "type": "email_reply",
                "at": str(e.timestamp) if e.timestamp else None,
                "detail": e.subject or "(no subject)",
                "notes": None,
                "by": e.from_email,
            })

    events.sort(key=lambda e: e["at"] or "")
    return {"lead_id": lead_id, "timeline": events}
