# ── routes/leaderboard_routes.py — SDR performance leaderboard ─────────────────
from datetime import datetime, date, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, case, distinct
from sqlalchemy.orm import Session

import models
from models import TERMINAL_STATUSES, ACTIVE_STATUSES
from database import get_db
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["Leaderboard"])

MEETING_REACHED = {
    "Meeting Scheduled", "1st Discovery Meeting", "Discovery Complete",
    "Demo Scheduled", "Demo Done", "Completed",
}


@router.get("/leaderboard")
def get_leaderboard(
    range: int = Query(0, ge=0, le=365, description="Days to look back. 0 = all time"),
    global_view: bool = False,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Return SDRs ranked by meetings booked.
    Pod Admins see only their pod's SDRs unless global_view=True.
    Uses bulk SQL queries instead of per-SDR loops.
    """
    today_start = datetime.combine(date.today(), datetime.min.time())
    cutoff = None
    if range and range > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=range)

    from cache import get_cached, set_cached, _is_test_db, claim_inflight, wait_inflight, release_inflight
    _use_cache = not _is_test_db(db)
    # Include pod_id + global_view in cache key to prevent cross-pod cache hits
    _pod_id = user.get("pod_id") if user.get("role") == "Pod Admin" else None
    cache_key = f"lb:{range}:{_pod_id or 'all'}:{global_view}"
    if _use_cache:
        cached = get_cached('leaderboard', cache_key)
        if cached is not None:
            return cached
        # Stampede guard — only the first concurrent miss computes
        if not claim_inflight('leaderboard', cache_key):
            wait_inflight('leaderboard', cache_key)
            cached = get_cached('leaderboard', cache_key)
            if cached is not None:
                return cached
            # Fallthrough: timeout expired, compute anyway

    # Get SDRs — pod-scoped for Pod Admin unless global_view
    from sqlalchemy.orm import selectinload
    # selectinload(pod) pre-fetches pod names in 1 extra query — eliminates N lazy loads
    sdr_q = db.query(models.User).filter(models.User.role == "SDR")
    if user.get("role") == "Pod Admin" and not global_view:
        pod_id = user.get("pod_id")
        if pod_id:
            sdr_q = sdr_q.filter(models.User.pod_id == pod_id)
        else:
            return []  # Pod Admin with no pod_id — safe empty fallback
    sdrs = sdr_q.options(selectinload(models.User.pod)).all()
    if not sdrs:
        return []

    sdr_ids = [s.id for s in sdrs]

    # ── BULK QUERY 1: Calls today per SDR ───────────────────────────────────
    # UNION dialer_calls (RCM/Aircall) + call_logs (manual)
    dc_today_q = (
        db.query(
            models.DialerCall.user_id,
            func.count(models.DialerCall.id).label("cnt"),
        )
        .filter(
            models.DialerCall.user_id.in_(sdr_ids),
            models.DialerCall.direction == "outbound",
            models.dialer_call_event_time() >= today_start,
        )
        .group_by(models.DialerCall.user_id)
    )
    cl_today_q = (
        db.query(
            models.CallLog.user_id,
            func.count(models.CallLog.id).label("cnt"),
        )
        .filter(
            models.CallLog.user_id.in_(sdr_ids),
            models.CallLog.called_at >= today_start,
        )
        .group_by(models.CallLog.user_id)
    )
    calls_today_map: dict = {}
    for uid, cnt in dc_today_q.all():
        calls_today_map[uid] = calls_today_map.get(uid, 0) + cnt
    for uid, cnt in cl_today_q.all():
        calls_today_map[uid] = calls_today_map.get(uid, 0) + cnt

    # ── BULK QUERY 2: Total calls per SDR (with optional date range) ────────
    # UNION dialer_calls + call_logs
    dc_total_q = (
        db.query(
            models.DialerCall.user_id,
            func.count(models.DialerCall.id).label("cnt"),
        )
        .filter(
            models.DialerCall.user_id.in_(sdr_ids),
            models.DialerCall.direction == "outbound",
        )
    )
    if cutoff:
        dc_total_q = dc_total_q.filter(models.dialer_call_event_time() >= cutoff)
    dc_total_q = dc_total_q.group_by(models.DialerCall.user_id)

    cl_total_q = (
        db.query(
            models.CallLog.user_id,
            func.count(models.CallLog.id).label("cnt"),
        )
        .filter(models.CallLog.user_id.in_(sdr_ids))
    )
    if cutoff:
        cl_total_q = cl_total_q.filter(models.CallLog.called_at >= cutoff)
    cl_total_q = cl_total_q.group_by(models.CallLog.user_id)

    total_calls_map: dict = {}
    for uid, cnt in dc_total_q.all():
        total_calls_map[uid] = total_calls_map.get(uid, 0) + cnt
    for uid, cnt in cl_total_q.all():
        total_calls_map[uid] = total_calls_map.get(uid, 0) + cnt


    # ── BULK QUERY 3: Lead counts per SDR by status ────────────────────────
    # Base: all assigned leads (optionally date-filtered)
    lead_status_q = (
        db.query(
            models.lead_assignments.c.user_id,
            models.Lead.status,
            func.count(distinct(models.Lead.id)).label("cnt"),
        )
        .join(models.Lead, models.Lead.id == models.lead_assignments.c.lead_id)
        .filter(models.lead_assignments.c.user_id.in_(sdr_ids))
    )
    if cutoff:
        # Use status_changed_at or created_at for time window
        lead_status_q = lead_status_q.filter(
            func.coalesce(models.Lead.status_changed_at, models.Lead.created_at) >= cutoff
        )
    lead_status_q = lead_status_q.group_by(
        models.lead_assignments.c.user_id, models.Lead.status
    )

    # Build nested dict: sdr_id -> {status: count}
    sdr_status_counts = {}
    for user_id, status, cnt in lead_status_q.all():
        sdr_status_counts.setdefault(user_id, {})[status] = cnt

    # ── Assemble leaderboard from pre-fetched data ──────────────────────────
    leaderboard = []
    for sdr in sdrs:
        status_counts = sdr_status_counts.get(sdr.id, {})
        total_leads = sum(status_counts.values())
        meetings_scheduled = sum(
            status_counts.get(s, 0) for s in MEETING_REACHED
        )
        disqualified = status_counts.get("Disqualified", 0)
        active_leads = sum(
            status_counts.get(s, 0) for s in ACTIVE_STATUSES
        )

        total_calls = total_calls_map.get(sdr.id, 0)
        conversion_rate = round((meetings_scheduled / total_leads * 100), 1) if total_leads > 0 else 0.0

        pod_name = None
        if sdr.pod_id and sdr.pod:
            pod_name = sdr.pod.name

        leaderboard.append({
            "id":                 sdr.id,
            "name":               sdr.name or sdr.email,
            "email":              sdr.email,
            "pod_name":           pod_name,
            "calls_today":        calls_today_map.get(sdr.id, 0),
            "total_calls":        total_calls,
            "meetings_scheduled": meetings_scheduled,
            "disqualified":       disqualified,
            "active_leads":       active_leads,
            "total_leads":        total_leads,
            "conversion_rate":    conversion_rate,
        })

    # Sort by meetings_scheduled (desc), then by total_calls (desc)
    leaderboard.sort(key=lambda x: (-x["meetings_scheduled"], -x["total_calls"]))

    # Add rank
    for i, entry in enumerate(leaderboard):
        entry["rank"] = i + 1

    if _use_cache:
        set_cached('leaderboard', cache_key, leaderboard)
        release_inflight('leaderboard', cache_key)
    return leaderboard


@router.get("/leaderboard/ae")
def get_ae_leaderboard(
    range: int = Query(0, ge=0, le=365, description="Days to look back. 0 = all time"),
    global_view: bool = False,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Return AEs ranked by meetings booked.
    Pod Admins see only their pod's AEs unless global_view=True.
    Mirrors the SDR leaderboard but scoped to role='AE' only.
    """
    today_start = datetime.combine(date.today(), datetime.min.time())
    cutoff = None
    if range and range > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=range)

    # Get AEs — pod-scoped for Pod Admin unless global_view
    from sqlalchemy.orm import selectinload
    ae_q = db.query(models.User).filter(models.User.role == "AE")
    if user.get("role") == "Pod Admin" and not global_view:
        pod_id = user.get("pod_id")
        if pod_id:
            ae_q = ae_q.filter(models.User.pod_id == pod_id)
        else:
            return []  # Pod Admin with no pod_id — safe empty fallback
    aes = ae_q.options(selectinload(models.User.pod)).all()
    if not aes:
        return []

    ae_ids = [a.id for a in aes]

    # ── BULK QUERY 1: Calls today per AE ────────────────────────────────────
    dc_today_q = (
        db.query(models.DialerCall.user_id, func.count(models.DialerCall.id).label("cnt"))
        .filter(models.DialerCall.user_id.in_(ae_ids), models.DialerCall.direction == "outbound",
                models.dialer_call_event_time() >= today_start)
        .group_by(models.DialerCall.user_id)
    )
    cl_today_q = (
        db.query(models.CallLog.user_id, func.count(models.CallLog.id).label("cnt"))
        .filter(models.CallLog.user_id.in_(ae_ids), models.CallLog.called_at >= today_start)
        .group_by(models.CallLog.user_id)
    )
    calls_today_map: dict = {}
    for uid, cnt in dc_today_q.all():
        calls_today_map[uid] = calls_today_map.get(uid, 0) + cnt
    for uid, cnt in cl_today_q.all():
        calls_today_map[uid] = calls_today_map.get(uid, 0) + cnt

    # ── BULK QUERY 2: Total calls per AE (with optional date range) ──────────
    dc_total_q = (
        db.query(models.DialerCall.user_id, func.count(models.DialerCall.id).label("cnt"))
        .filter(models.DialerCall.user_id.in_(ae_ids), models.DialerCall.direction == "outbound")
    )
    if cutoff:
        dc_total_q = dc_total_q.filter(models.dialer_call_event_time() >= cutoff)
    dc_total_q = dc_total_q.group_by(models.DialerCall.user_id)

    cl_total_q = (
        db.query(models.CallLog.user_id, func.count(models.CallLog.id).label("cnt"))
        .filter(models.CallLog.user_id.in_(ae_ids))
    )
    if cutoff:
        cl_total_q = cl_total_q.filter(models.CallLog.called_at >= cutoff)
    cl_total_q = cl_total_q.group_by(models.CallLog.user_id)

    total_calls_map: dict = {}
    for uid, cnt in dc_total_q.all():
        total_calls_map[uid] = total_calls_map.get(uid, 0) + cnt
    for uid, cnt in cl_total_q.all():
        total_calls_map[uid] = total_calls_map.get(uid, 0) + cnt

    # ── BULK QUERY 3: Lead counts per AE by status ────────────────────────────
    lead_status_q = (
        db.query(models.lead_assignments.c.user_id, models.Lead.status,
                 func.count(distinct(models.Lead.id)).label("cnt"))
        .join(models.Lead, models.Lead.id == models.lead_assignments.c.lead_id)
        .filter(models.lead_assignments.c.user_id.in_(ae_ids))
    )
    if cutoff:
        lead_status_q = lead_status_q.filter(
            func.coalesce(models.Lead.status_changed_at, models.Lead.created_at) >= cutoff
        )
    lead_status_q = lead_status_q.group_by(models.lead_assignments.c.user_id, models.Lead.status)

    ae_status_counts = {}
    for user_id, status, cnt in lead_status_q.all():
        ae_status_counts.setdefault(user_id, {})[status] = cnt

    # ── Assemble AE leaderboard ───────────────────────────────────────────────
    leaderboard = []
    for ae in aes:
        status_counts = ae_status_counts.get(ae.id, {})
        total_leads = sum(status_counts.values())
        meetings_scheduled = sum(status_counts.get(s, 0) for s in MEETING_REACHED)
        disqualified = status_counts.get("Disqualified", 0)
        active_leads = sum(status_counts.get(s, 0) for s in ACTIVE_STATUSES)
        total_calls = total_calls_map.get(ae.id, 0)
        conversion_rate = round((meetings_scheduled / total_leads * 100), 1) if total_leads > 0 else 0.0

        pod_name = None
        if ae.pod_id and ae.pod:
            pod_name = ae.pod.name

        leaderboard.append({
            "id":                 ae.id,
            "name":               ae.name or ae.email,
            "email":              ae.email,
            "pod_name":           pod_name,
            "calls_today":        calls_today_map.get(ae.id, 0),
            "total_calls":        total_calls,
            "meetings_scheduled": meetings_scheduled,
            "disqualified":       disqualified,
            "active_leads":       active_leads,
            "total_leads":        total_leads,
            "conversion_rate":    conversion_rate,
        })

    leaderboard.sort(key=lambda x: (-x["meetings_scheduled"], -x["total_calls"]))
    for i, entry in enumerate(leaderboard):
        entry["rank"] = i + 1

    return leaderboard
