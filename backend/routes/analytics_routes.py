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
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from threading import Lock
from typing import List as _List, Optional

from pydantic import BaseModel

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, case, cast, String, distinct, text, and_, or_, exists, select
from sqlalchemy.orm import Session

from database import get_db
from auth import require_admin, require_admin_or_ae
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


def _cache_set(key: str, data):
    with _cache_lock:
        _cache[key] = (data, time.time() + CACHE_TTL_SECONDS)


def _cache_invalidate_prefix(prefix: str):
    """Remove all cache entries whose key starts with prefix."""
    with _cache_lock:
        stale = [k for k in _cache if k.startswith(prefix)]
        for k in stale:
            del _cache[k]


# ─── Shared filter helpers ──────────────────────────────────────────────────

# Outcomes that count as a LIVE CONNECT for connect-rate purposes
# Mirrors ANSWERED_OUTCOMES in models.py
CONNECT_OUTCOMES = {
    "Call Back Later",
    "Meeting Scheduled",
    "Meeting Confirmed",
    "Meeting Complete",      # v5.5 — SDR marks meeting actually happened
    "Text Me",
    "Not the Right Person",
    "Referred Someone Else",
}
_CONNECT_OUTCOMES_LIST = list(CONNECT_OUTCOMES)  # SQLAlchemy .in_() needs a list, not a set

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


def _resolve_date_range(
    date_from: Optional[str],
    date_to: Optional[str],
    preset: Optional[str],
) -> tuple[Optional[datetime], Optional[datetime]]:
    """
    Return (start, end) as UTC-aware datetimes.
    Preset values: '7d', '30d', '90d', 'all'
    Custom: ISO date strings (YYYY-MM-DD)
    """
    now = datetime.now(timezone.utc)

    if preset == "all":
        return None, None
    if preset == "7d":
        return now.replace(hour=0, minute=0, second=0, microsecond=0).__class__(
            now.year, now.month, now.day, 0, 0, 0, tzinfo=timezone.utc
        ) - __import__("datetime").timedelta(days=6), now
    if preset == "30d":
        return now.__class__(now.year, now.month, now.day, 0, 0, 0, tzinfo=timezone.utc) - __import__("datetime").timedelta(days=29), now
    if preset == "90d":
        return now.__class__(now.year, now.month, now.day, 0, 0, 0, tzinfo=timezone.utc) - __import__("datetime").timedelta(days=89), now

    # Custom date range
    start = end = None
    if date_from:
        try:
            start = datetime.fromisoformat(date_from).replace(hour=0, minute=0, second=0, tzinfo=timezone.utc)
        except ValueError:
            pass
    if date_to:
        try:
            end = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            pass
    return start, end


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

    Presets (7d/30d/90d/all) are deliberately left UTC-anchored/unaffected:
    they're a rolling window ending at `now` (an exact instant), not a
    picked calendar day, so the day-boundary mismatch this fixes doesn't
    apply to them the same way — scope kept to the custom-range case that
    was actually reported.
    """
    if not (date_from or date_to):
        return _resolve_date_range_simple(date_from, date_to, preset)

    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        tz = timezone.utc

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


def _effective_pod_id(admin: dict, pod_id_param: Optional[str]) -> Optional[str]:
    """
    EC-6: Pod Admins are always scoped to their own pod.
    Super Admins respect the pod_id query param.
    """
    if admin.get("role") == "Pod Admin":
        return admin.get("pod_id")  # force — ignore param entirely
    return pod_id_param or None


def _effective_ae_sdr(admin: dict) -> Optional[str]:
    """AE role: Analytics Hub is forced to that AE's own leads/calls only —
    no pod-wide or cross-SDR visibility. Mirrors _effective_pod_id's
    force-ignore-the-param idiom, just scoped to self instead of a pod."""
    if admin.get("role") == "AE":
        return admin.get("sub")
    return None


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
    """
    if effective_sdr:
        return query.filter(exists().where(
            models.lead_assignments.c.lead_id == models.Lead.id
        ).where(models.lead_assignments.c.user_id == effective_sdr))
    if not effective_pod:
        return query
    assignee_in_pod = exists().where(
        models.lead_assignments.c.lead_id == models.Lead.id
    ).where(
        models.lead_assignments.c.user_id.in_(
            select(models.User.id).where(models.User.pod_id == effective_pod)
        )
    )
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


# ─── Endpoint 1: KPI Funnel ──────────────────────────────────────────────────

@router.get("/funnel")
def get_funnel(
    preset: Optional[str] = Query(None, description="7d | 30d | 90d | all"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    pod_id: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    upload_log_id: Optional[str] = Query(None),
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
    effective_sdr = _effective_ae_sdr(admin)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, no pod-wide visibility
    date_start, date_end = _resolve_date_range_simple(date_from, date_to, preset)

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
    lead_q = db.query(func.count(models.Lead.id).label("total"))
    # Exclude parked leads (e.g. "No Phone - Parked") from analytics
    lead_q = lead_q.filter(~models.Lead.status.in_(models.PARKED_STATUSES))
    if not upload_log_id:
        if date_start:
            lead_q = lead_q.filter(models.Lead.created_at >= date_start)
        if date_end:
            lead_q = lead_q.filter(models.Lead.created_at <= date_end)
    lead_q = _pod_scope_lead_query(lead_q, effective_pod, effective_sdr)
    lead_q = models.exclude_test_leads(lead_q)
    if lead_source:
        lead_q = _lead_source_filter(lead_q, lead_source)
    if upload_log_id:
        lead_q = lead_q.filter(models.Lead.upload_log_id == upload_log_id)

    leads_assigned = lead_q.scalar() or 0

    # ── 3. Emails (EC-5: scoped to lead_email_activity.timestamp) ─────────────
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
    email_q = models.exclude_test_leads(email_q)
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
    reply_q = models.exclude_test_leads(reply_q)
    if lead_source:
        # RCA 2026-07-27: was the only email metric not scoped to lead_source —
        # sent/opened correctly shrank when filtering by source, replied didn't.
        reply_q = _lead_source_filter(reply_q, lead_source)
    if upload_log_id:
        reply_q = reply_q.filter(models.Lead.upload_log_id == upload_log_id)
    emails_replied = reply_q.scalar() or 0

    # ── 4. Calls — UNION of dialer_calls + pure-manual call_logs
    # RCA-2026-05-22: call_logs alone = 19 (US Team) — missed all Aircall calls.
    # Strategy: two separate ORM queries (SQLite-safe), summed in Python.
    #   A) dialer_calls outbound — covers all Aircall/RCM calls
    #   B) call_logs where no matching dialer_call for same user+lead+date — covers manual calls
    # Only 1 overlap found org-wide — the NOT EXISTS gate prevents double-counting.

    # A) Dialer calls
    _dc_q = db.query(
        func.count(models.DialerCall.id).label("total"),
        func.count(
            case((models.DialerCall.outcome.isnot(None), models.DialerCall.id))
        ).label("with_outcome"),
        func.count(
            case((models.dialer_call_connected(_CONNECT_OUTCOMES_LIST), models.DialerCall.id))
        ).label("connected"),
        func.count(
            case((models.DialerCall.outcome.is_(None), models.DialerCall.id))
        ).label("null_outcome"),
        func.count(distinct(models.DialerCall.lead_id)).label("unique_leads"),
    ).join(
        models.User, models.User.id == models.DialerCall.user_id
    ).filter(
        models.DialerCall.direction == "outbound"
    )
    _dc_q = models.exclude_test_leads(_dc_q, models.DialerCall)
    if date_start:
        _dc_q = _dc_q.filter(models.dialer_call_event_time() >= date_start)
    if date_end:
        _dc_q = _dc_q.filter(models.dialer_call_event_time() <= date_end)
    if effective_pod or effective_sdr or upload_log_id or lead_source:
        # Explicitly outerjoin Lead so the pod filter doesn't create an implicit
        # cartesian product in the FROM clause (which taints subsequent queries).
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
            # Bug: calls_made/unique_leads_called ignored the batch filter entirely,
            # so selecting a specific batch still showed org/pod-wide call totals.
            _dc_q = _dc_q.filter(models.Lead.upload_log_id == upload_log_id)
        if lead_source:
            # RCA 2026-07-27: Calls Made/Connected/Connect Rate ignored the lead
            # source filter entirely — every other funnel card correctly shrank
            # when filtering by source, Calls silently stayed org-wide.
            _dc_q = _lead_source_filter(_dc_q, lead_source)
    _dc = _dc_q.one()

    # B) Pure-manual call_logs (no matching dialer_call for same user+lead+date)
    # Strategy: count ALL call_logs in scope, then subtract the overlap with dialer_calls.
    # This avoids complex LEFT JOIN + IS NULL patterns that produce duplicate rows in SQLite.
    _cl_q = db.query(
        func.count(models.CallLog.id).label("total"),
        func.count(
            case((models.CallLog.outcome.isnot(None), models.CallLog.id))
        ).label("with_outcome"),
        func.count(distinct(models.CallLog.lead_id)).label("unique_leads"),
    )
    _cl_q = models.exclude_test_leads(_cl_q, models.CallLog)
    if date_start:
        _cl_q = _cl_q.filter(models.CallLog.called_at >= date_start)
    if date_end:
        _cl_q = _cl_q.filter(models.CallLog.called_at <= date_end)
    if effective_pod or effective_sdr or upload_log_id or lead_source:
        # Filter by the lead's pod (original behaviour) — SDRs may not have pod_id set
        _cl_q = _cl_q.join(
            models.Lead, models.Lead.id == models.CallLog.lead_id
        )
        if effective_pod or effective_sdr:
            # Mirrors _dc_q's OR-fallback above: the logging user's pod OR the lead's pod
            # (or, for an AE, self-scope to just their own user_id).
            _cl_q = _cl_q.outerjoin(models.User, models.User.id == models.CallLog.user_id)
            _cl_q = _pod_scope_call_query(_cl_q, effective_pod, effective_sdr)
        if upload_log_id:
            _cl_q = _cl_q.filter(models.Lead.upload_log_id == upload_log_id)
        if lead_source:
            _cl_q = _lead_source_filter(_cl_q, lead_source)

    # Count the overlap: call_logs that already exist as a dialer_call for the same
    # user+lead on the same date. This prevents double-counting the ~1 org-wide overlap.
    _overlap_q = db.query(func.count(models.CallLog.id)).join(
        models.DialerCall,
        (models.CallLog.user_id == models.DialerCall.user_id) &
        (models.CallLog.lead_id == models.DialerCall.lead_id) &
        (func.date(models.CallLog.called_at) == func.date(models.dialer_call_event_time())),
    ).filter(models.DialerCall.direction == "outbound")
    _overlap_q = models.exclude_test_leads(_overlap_q, models.CallLog)
    if date_start:
        _overlap_q = _overlap_q.filter(models.CallLog.called_at >= date_start)
    if date_end:
        _overlap_q = _overlap_q.filter(models.CallLog.called_at <= date_end)
    if effective_pod or effective_sdr or upload_log_id or lead_source:
        # RCA 2026-07-22: this was unscoped while _dc_q/_cl_q above were already
        # batch/pod-scoped — subtracting an org-wide overlap count from a single
        # batch's (much smaller) totals could go negative, and did (Analytics Hub
        # showed "Calls Made: -31" for the Klenty backfill batch).
        # RCA 2026-07-27: same gap existed for lead_source — never closed then.
        _overlap_q = _overlap_q.join(models.Lead, models.Lead.id == models.CallLog.lead_id)
        if effective_pod or effective_sdr:
            _overlap_q = _overlap_q.outerjoin(models.User, models.User.id == models.CallLog.user_id)
            _overlap_q = _pod_scope_call_query(_overlap_q, effective_pod, effective_sdr)
        if upload_log_id:
            _overlap_q = _overlap_q.filter(models.Lead.upload_log_id == upload_log_id)
        if lead_source:
            _overlap_q = _lead_source_filter(_overlap_q, lead_source)
    _overlap_count = _overlap_q.scalar() or 0

    _cl = _cl_q.one()

    calls_made         = (_dc.total or 0) + (_cl.total or 0) - _overlap_count
    calls_with_outcome = (_dc.with_outcome or 0) + (_cl.with_outcome or 0)
    calls_connected    = _dc.connected or 0  # models.dialer_call_connected(): outcome OR provider_disposition
    calls_null_outcome = calls_made - calls_with_outcome
    unique_leads_called = (_dc.unique_leads or 0) + (_cl.unique_leads or 0)
    avg_calls_per_lead = round(calls_made / unique_leads_called, 1) if unique_leads_called > 0 else 0


    # Connect rate = live Aircall answers / total calls made
    connect_rate = round(calls_connected / calls_made * 100, 1) if calls_made > 0 else None

    # Average retries (call_attempt_count on lead)
    avg_q = db.query(func.avg(models.Lead.call_attempt_count))
    avg_q = _pod_scope_lead_query(avg_q, effective_pod, effective_sdr)
    avg_q = models.exclude_test_leads(avg_q)
    if lead_source:
        # RCA 2026-07-27: was unscoped by lead_source, unlike every other funnel card.
        avg_q = _lead_source_filter(avg_q, lead_source)
    if upload_log_id:
        avg_q = avg_q.filter(models.Lead.upload_log_id == upload_log_id)
    avg_retries = round(avg_q.scalar() or 0, 1)

    # ── 5. Meetings (EC-3: status=Meeting Scheduled, no-show as sub-stat) ────
    # Date-scoped via COALESCE(lead_closed_at, status_changed_at) — matches
    # trend's meetings query (v9.7.1) so a lead with no lead_closed_at doesn't
    # appear in one chart's meeting count and not the other's.
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
    meeting_q = models.exclude_test_leads(meeting_q)
    if lead_source:
        meeting_q = _lead_source_filter(meeting_q, lead_source)
    if upload_log_id:
        meeting_q = meeting_q.filter(models.Lead.upload_log_id == upload_log_id)

    meeting_row = meeting_q.one()
    meetings_booked = meeting_row.meetings or 0
    no_shows        = int(meeting_row.no_shows or 0)

    # ── 6. Disqualified leads (terminal: Disqualified + Not Interested + legacy) ──
    # Same COALESCE fallback as meetings above, for the same reason.
    _disq_date = _lead_closed_date_expr()
    disq_q = db.query(func.count(models.Lead.id)).filter(
        models.Lead.status.in_(DISQUALIFIED_STATUSES)
    )
    disq_q = _pod_scope_lead_query(disq_q, effective_pod, effective_sdr)
    disq_q = models.exclude_test_leads(disq_q)
    if lead_source:
        disq_q = _lead_source_filter(disq_q, lead_source)
    if upload_log_id:
        disq_q = disq_q.filter(models.Lead.upload_log_id == upload_log_id)
    if date_start:
        disq_q = disq_q.filter(_disq_date >= date_start)
    if date_end:
        disq_q = disq_q.filter(_disq_date <= date_end)
    disqualified = disq_q.scalar() or 0

    # ── 7. Opportunity outcomes (Won/Lost) — post-meeting conversion ──────────
    opp_q = db.query(
        func.count(case((models.Lead.opportunity_status == "Won", models.Lead.id))).label("won"),
        func.count(case((models.Lead.opportunity_status == "Lost", models.Lead.id))).label("lost"),
    )
    opp_q = _pod_scope_lead_query(opp_q, effective_pod, effective_sdr)
    opp_q = models.exclude_test_leads(opp_q)
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
    date_start, date_end = _resolve_date_range_simple(date_from, date_to, preset)

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
    _dc_trend_q = models.exclude_test_leads(_dc_trend_q, models.DialerCall)
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
    _cl_trend_q = models.exclude_test_leads(_cl_trend_q, models.CallLog)
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
    email_q = models.exclude_test_leads(email_q)
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
    meeting_q = models.exclude_test_leads(meeting_q)
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
    disq_q = models.exclude_test_leads(disq_q)
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
    from routes._admin_helpers import _get_or_create_sync_settings

    ninety_days_ago = datetime.now(timezone.utc) - timedelta(days=90)
    conversation_min_seconds = _get_or_create_sync_settings(db).conversation_min_seconds or models.CONVERSATION_MIN_SECONDS

    user_q = db.query(models.User).filter(models.User.role.in_(["SDR", "AE"]))
    if effective_sdr:
        user_q = user_q.filter(models.User.id == effective_sdr)
    elif effective_pod:
        user_q = user_q.filter(models.User.pod_id == effective_pod)
    sdrs = user_q.all()

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
        lead_count_q = models.exclude_test_leads(lead_count_q)
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

        # ── Meetings per SDR (date-filtered by lead_closed_at) ─────────────
        meeting_q = (
            db.query(
                models.lead_assignments.c.user_id,
                func.count(distinct(models.Lead.id)).label("meetings"),
            )
            .join(models.Lead, models.Lead.id == models.lead_assignments.c.lead_id)
            .filter(
                models.lead_assignments.c.user_id.in_(sdr_ids),
                models.Lead.status.in_(MEETING_REACHED_STATUSES),
            )
        )
        meeting_q = models.exclude_test_leads(meeting_q)
        if date_start:
            meeting_q = meeting_q.filter(models.Lead.lead_closed_at >= date_start)
        if date_end:
            meeting_q = meeting_q.filter(models.Lead.lead_closed_at <= date_end)
        if lead_source:
            meeting_q = _lead_source_filter(meeting_q, lead_source)
        if upload_log_id:
            meeting_q = meeting_q.filter(models.Lead.upload_log_id == upload_log_id)
        meeting_counts.update(dict(meeting_q.group_by(models.lead_assignments.c.user_id).all()))

        # ── Call aggregates per SDR (dialer + manual combined) ─────────────
        _dc_sdr_q = (
            db.query(
                models.DialerCall.user_id,
                func.count(models.DialerCall.id).label("total"),
                func.count(case((
                    models.dialer_call_connected(_CONNECT_OUTCOMES_LIST), models.DialerCall.id
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
        _dc_sdr_q = models.exclude_test_leads(_dc_sdr_q, models.DialerCall)
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
                    norm_sdr.in_(_CONNECT_OUTCOMES_LIST), models.CallLog.id
                ))).label("connected"),
                func.count(case((
                    models.CallLog.outcome.isnot(None), models.CallLog.id
                ))).label("with_outcome"),
                func.count(case((
                    models.call_log_is_conversation(), models.CallLog.id
                ))).label("conversations"),
            )
            .filter(models.CallLog.user_id.in_(sdr_ids))
        )
        _cl_sdr_q = models.exclude_test_leads(_cl_sdr_q, models.CallLog)
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
        email_q = models.exclude_test_leads(email_q, models.LeadEmailActivity)
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
                        (models.dialer_call_connected(_CONNECT_OUTCOMES_LIST), func.lower(models.Lead.company)),
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
        _dc_company_q = models.exclude_test_leads(_dc_company_q)
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
                        (norm_sdr.in_(_CONNECT_OUTCOMES_LIST), func.lower(models.Lead.company)),
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
        _cl_company_q = models.exclude_test_leads(_cl_company_q)
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
    effective_sdr = _effective_ae_sdr(admin)
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
    date_start, date_end = _resolve_date_range_simple(date_from, date_to, preset)

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

            for r in batch_rows:
                pod_breakdown = pod_counts_by_batch.get(r.id, [])
                if effective_pod:
                    lead_count = sum(cnt for pid, cnt in pod_breakdown if pid == effective_pod)
                else:
                    lead_count = sum(cnt for _, cnt in pod_breakdown)
                if lead_count == 0:
                    continue  # no leads (in scope) \u2014 would be a dead-end selection

                dominant_pod_id = max(pod_breakdown, key=lambda pc: pc[1])[0] if pod_breakdown else None
                pod_name = pod_name_by_id.get(dominant_pod_id) if dominant_pod_id else None

                src_label = _batch_source_label(r.filename or "")
                upload_date_str = r.created_at.strftime("%b %-d") if r.created_at else "Unknown"

                label_parts = [src_label, upload_date_str]
                if pod_name:
                    label_parts.append(pod_name)

                batches.append({
                    "id": r.id,
                    "label": " \u00b7 ".join(label_parts),
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

@router.get("/export")
def export_csv(
    preset: Optional[str] = Query("30d"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    pod_id: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """
    EC-14: Streams a CSV export of the per-SDR performance table.
    Uses chunked query to avoid loading full dataset into memory.
    """
    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _effective_ae_sdr(admin)
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
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """
    Returns per-batch aggregate metrics for the All Batches comparison table.
    Columns: batch label, leads, calls, connect_rate, meetings, disqualified, research_done.
    """
    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _effective_ae_sdr(admin)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, no pod-wide visibility
    date_start, date_end = _resolve_date_range_simple(date_from, date_to, None)

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
        lead_q = models.exclude_test_leads(lead_q)
        lead_counts = dict(lead_q.group_by(models.Lead.upload_log_id).all())

        # ── BULK QUERY 2: Call aggregates per batch (dialer + manual) ──
        # Previously CallLog-only, which misses all Aircall/Klenty/RCM
        # calls in dialer_calls — same gap as the old /export bug.
        norm = _normalised_outcome_expr()
        _cl_call_q = (
            db.query(
                models.Lead.upload_log_id,
                func.count(models.CallLog.id).label("total"),
                func.count(case((norm.in_(_CONNECT_OUTCOMES_LIST), models.CallLog.id))).label("connected"),
            )
            .join(models.Lead, models.Lead.id == models.CallLog.lead_id)
            .filter(models.Lead.upload_log_id.in_(batch_ids))
        )
        _cl_call_q = _pod_scope_lead_query(_cl_call_q, effective_pod, effective_sdr)
        _cl_call_q = models.exclude_test_leads(_cl_call_q)
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
                    models.dialer_call_connected(_CONNECT_OUTCOMES_LIST), models.DialerCall.id
                ))).label("connected"),
            )
            .join(models.Lead, models.Lead.id == models.DialerCall.lead_id)
            .filter(
                models.Lead.upload_log_id.in_(batch_ids),
                models.DialerCall.direction == "outbound",
            )
        )
        _dc_call_q = _pod_scope_lead_query(_dc_call_q, effective_pod, effective_sdr)
        _dc_call_q = models.exclude_test_leads(_dc_call_q)
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
        status_q = models.exclude_test_leads(status_q)
        status_agg = {}
        for row in status_q.group_by(models.Lead.upload_log_id).all():
            status_agg[row[0]] = {"meetings": row[1] or 0, "disqualified": row[2] or 0, "research": row[3] or 0}

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

