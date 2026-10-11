"""SDR Metrics, analytics, and performance drill-down routes."""
import csv, io, statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone, date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, case, cast, Date
from sqlalchemy.orm import Session

from database import get_db
from middleware import require_admin, get_current_user
from models import (
    User, CallLog, Lead, LoginLog, Status,
    UserActivityLog, UserActivityDailySummary,
    TERMINAL_STATUSES, ACTIVE_STATUSES,
)

router = APIRouter(prefix="/api", tags=["Metrics & Analytics"])


def _get_date_range(range_days, start_date=None, end_date=None):
    if start_date and end_date:
        try:
            s = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
            e = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
            return s, e
        except ValueError:
            pass
    end = datetime.now(timezone.utc)
    return end - timedelta(days=range_days), end


def _sdr_ids(db):
    return [uid for (uid,) in db.query(User.id).filter(User.role.notin_(["Super Admin", "Admin"])).all()]


def _session_duration(s):
    if not s.login_at or not s.logout_at:
        return 0
    login = s.login_at.replace(tzinfo=None) if s.login_at.tzinfo else s.login_at
    if s.last_heartbeat_at:
        hb = s.last_heartbeat_at.replace(tzinfo=None) if s.last_heartbeat_at.tzinfo else s.last_heartbeat_at
        dur = (hb - login).total_seconds() / 60.0 + 5
    else:
        lo = s.logout_at.replace(tzinfo=None) if s.logout_at.tzinfo else s.logout_at
        dur = min((lo - login).total_seconds() / 60.0, 30)
    return max(0, min(dur, 120))


# ── KPI Summary ─────────────────────────────────────────────────────────────

@router.get("/admin/metrics/summary")
def get_metrics_summary(range: int = Query(30, ge=1, le=365), start_date: str = Query(None), end_date: str = Query(None), db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    start, end = _get_date_range(range, start_date, end_date)
    sdr_list = _sdr_ids(db)
    start_str, end_str = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    summaries = db.query(UserActivityDailySummary).filter(UserActivityDailySummary.summary_date >= start_str, UserActivityDailySummary.summary_date <= end_str, UserActivityDailySummary.user_id.in_(sdr_list) if sdr_list else False).all()
    has_data = summaries and any((s.lead_views or 0) + (s.status_updates or 0) + (s.calls_logged or 0) + (s.meetings_scheduled or 0) > 0 for s in summaries)

    if not has_data:
        ac = db.query(func.count(func.distinct(UserActivityLog.user_id)).label("a"), func.sum(case((UserActivityLog.action_type == "VIEW_LEAD", 1), else_=0)).label("lv"), func.sum(case((UserActivityLog.action_type == "UPDATE_LEAD_STATUS", 1), else_=0)).label("su"), func.sum(case((UserActivityLog.action_type == "LOG_CALL", 1), else_=0)).label("cl"), func.sum(case((UserActivityLog.action_type == "SCHEDULE_MEETING", 1), else_=0)).label("mt"), func.count(UserActivityLog.id).label("t")).filter(UserActivityLog.created_at >= start, UserActivityLog.created_at <= end, UserActivityLog.user_id.in_(sdr_list) if sdr_list else False).first()
        sessions = db.query(LoginLog).filter(LoginLog.login_at >= start, LoginLog.login_at <= end, LoginLog.logout_at != None, LoginLog.user_id.in_(sdr_list) if sdr_list else False).all()
        total_time = sum(_session_duration(s) for s in sessions)
        active_sdrs = ac.a or 0
        features = {"Lead Views": ac.lv or 0, "Status Updates": ac.su or 0, "Calls Logged": ac.cl or 0, "Meetings": ac.mt or 0}
        most_used = max(features, key=features.get) if any(features.values()) else None
        return {"daily_active_sdrs": active_sdrs, "leads_processed": (ac.su or 0) + (ac.cl or 0), "meetings_scheduled": ac.mt or 0, "most_used_feature": most_used, "most_used_feature_count": features.get(most_used, 0) if most_used else 0, "total_time_spent_minutes": int(total_time), "avg_time_per_sdr_minutes": int(total_time / max(active_sdrs, 1)), "total_actions": ac.t or 0, "calls_logged": ac.cl or 0, "status_updates": ac.su or 0}

    users, total_leads, total_status, total_meetings, total_calls, total_actions, total_time = set(), 0, 0, 0, 0, 0, 0
    for s in summaries:
        users.add(s.user_id); total_leads += s.lead_views or 0; total_status += s.status_updates or 0; total_meetings += s.meetings_scheduled or 0; total_calls += s.calls_logged or 0; total_actions += s.total_actions or 0; total_time += s.time_spent_minutes or 0
    features = {"Lead Views": total_leads, "Status Updates": total_status, "Calls Logged": total_calls, "Meetings": total_meetings}
    most_used = max(features, key=features.get) if features else None
    return {"daily_active_sdrs": len(users), "leads_processed": total_leads, "meetings_scheduled": total_meetings, "most_used_feature": most_used, "most_used_feature_count": features.get(most_used, 0) if most_used else 0, "total_time_spent_minutes": total_time, "avg_time_per_sdr_minutes": int(total_time / max(len(users), 1)), "total_actions": total_actions, "calls_logged": total_calls, "status_updates": total_status}


# ── Daily Trend ──────────────────────────────────────────────────────────────

@router.get("/admin/metrics/daily-trend")
def get_daily_trend(range: int = Query(30, ge=1, le=365), start_date: str = Query(None), end_date: str = Query(None), db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    start, end = _get_date_range(range, start_date, end_date)
    sdr_list = _sdr_ids(db)
    start_str, end_str = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    results = db.query(UserActivityDailySummary.summary_date, func.sum(UserActivityDailySummary.lead_views).label("lv"), func.sum(UserActivityDailySummary.status_updates).label("su"), func.sum(UserActivityDailySummary.calls_logged).label("cl"), func.sum(UserActivityDailySummary.meetings_scheduled).label("mt"), func.sum(UserActivityDailySummary.total_actions).label("t"), func.sum(UserActivityDailySummary.time_spent_minutes).label("ts"), func.count(func.distinct(UserActivityDailySummary.user_id)).label("as")).filter(UserActivityDailySummary.summary_date >= start_str, UserActivityDailySummary.summary_date <= end_str, UserActivityDailySummary.user_id.in_(sdr_list) if sdr_list else False).group_by(UserActivityDailySummary.summary_date).order_by(UserActivityDailySummary.summary_date).all()
    has = results and any((r.lv or 0) + (r.su or 0) + (r.cl or 0) + (r.mt or 0) > 0 for r in results)
    if has:
        return [{"date": r.summary_date, "lead_views": r.lv or 0, "status_updates": r.su or 0, "calls_logged": r.cl or 0, "meetings": r.mt or 0, "total": r.t or 0, "time_spent_minutes": r.ts or 0, "active_sdrs": getattr(r, 'as', 0) or 0} for r in results]

    # Fallback to raw logs
    raw = db.query(cast(UserActivityLog.created_at, Date).label("day"), UserActivityLog.action_type, func.count(UserActivityLog.id).label("cnt")).filter(UserActivityLog.created_at >= start, UserActivityLog.created_at <= end, UserActivityLog.user_id.in_(sdr_list) if sdr_list else False).group_by(cast(UserActivityLog.created_at, Date), UserActivityLog.action_type).all()
    if not raw:
        return []
    dd = defaultdict(lambda: {"lead_views": 0, "status_updates": 0, "calls_logged": 0, "meetings": 0, "total": 0, "time_spent_minutes": 0, "active_sdrs": 0})
    for r in raw:
        d = dd[str(r.day)]
        if r.action_type == "VIEW_LEAD": d["lead_views"] += r.cnt
        elif r.action_type == "UPDATE_LEAD_STATUS": d["status_updates"] += r.cnt
        elif r.action_type == "LOG_CALL": d["calls_logged"] += r.cnt
        elif r.action_type == "SCHEDULE_MEETING": d["meetings"] += r.cnt
        d["total"] += r.cnt
    return [{"date": day, **data} for day, data in sorted(dd.items())]


# ── SDR Table ────────────────────────────────────────────────────────────────

@router.get("/admin/metrics/sdr-table")
def get_sdr_table(range: int = Query(30, ge=1, le=365), start_date: str = Query(None), end_date: str = Query(None), db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    start, end = _get_date_range(range, start_date, end_date)
    sdr_list = _sdr_ids(db)
    start_str, end_str = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    results = db.query(UserActivityDailySummary.user_id, UserActivityDailySummary.user_email, UserActivityDailySummary.user_name, func.sum(UserActivityDailySummary.lead_views).label("lv"), func.sum(UserActivityDailySummary.status_updates).label("su"), func.sum(UserActivityDailySummary.calls_logged).label("cl"), func.sum(UserActivityDailySummary.meetings_scheduled).label("mt"), func.sum(UserActivityDailySummary.total_actions).label("t"), func.sum(UserActivityDailySummary.time_spent_minutes).label("ts")).filter(UserActivityDailySummary.summary_date >= start_str, UserActivityDailySummary.summary_date <= end_str, UserActivityDailySummary.user_id.in_(sdr_list) if sdr_list else False).group_by(UserActivityDailySummary.user_id, UserActivityDailySummary.user_email, UserActivityDailySummary.user_name).order_by(func.sum(UserActivityDailySummary.total_actions).desc()).all()
    has = results and any((r.lv or 0) + (r.su or 0) + (r.cl or 0) + (r.mt or 0) > 0 for r in results)
    if has:
        return [{"user_id": r.user_id, "user_email": r.user_email, "user_name": r.user_name or r.user_email, "lead_views": r.lv or 0, "status_updates": r.su or 0, "calls_logged": r.cl or 0, "meetings": r.mt or 0, "total_actions": r.t or 0, "time_spent_minutes": r.ts or 0} for r in results]

    raw = db.query(UserActivityLog.user_id, UserActivityLog.user_email, UserActivityLog.user_name, func.sum(case((UserActivityLog.action_type == "VIEW_LEAD", 1), else_=0)).label("lv"), func.sum(case((UserActivityLog.action_type == "UPDATE_LEAD_STATUS", 1), else_=0)).label("su"), func.sum(case((UserActivityLog.action_type == "LOG_CALL", 1), else_=0)).label("cl"), func.sum(case((UserActivityLog.action_type == "SCHEDULE_MEETING", 1), else_=0)).label("mt"), func.count(UserActivityLog.id).label("t")).filter(UserActivityLog.created_at >= start, UserActivityLog.created_at <= end, UserActivityLog.user_id.in_(sdr_list) if sdr_list else False).group_by(UserActivityLog.user_id, UserActivityLog.user_email, UserActivityLog.user_name).all()
    if not raw:
        return []
    return sorted([{"user_id": r.user_id, "user_email": r.user_email, "user_name": r.user_name or r.user_email, "lead_views": r.lv or 0, "status_updates": r.su or 0, "calls_logged": r.cl or 0, "meetings": r.mt or 0, "total_actions": r.t or 0, "time_spent_minutes": 0} for r in raw], key=lambda x: x["total_actions"], reverse=True)


# ── CSV/Excel Export ─────────────────────────────────────────────────────────

@router.get("/admin/metrics/export")
def export_metrics(range: int = Query(30, ge=1, le=365), format: str = Query("csv"), start_date: str = Query(None), end_date: str = Query(None), token: str = Query(None), db: Session = Depends(get_db)):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    from middleware import decode_jwt
    user = decode_jwt(token)
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    sdr_data = get_sdr_table(range=range, start_date=start_date, end_date=end_date, db=db, admin=user)
    if format == "csv":
        output = io.StringIO()
        fields = ["user_name", "user_email", "lead_views", "status_updates", "calls_logged", "meetings", "total_actions", "time_spent_minutes"]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for row in sdr_data:
            writer.writerow({k: row.get(k, "") for k in fields})
        output.seek(0)
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=sdr_metrics_{range}d.csv"})
    raise HTTPException(status_code=422, detail="Format must be 'csv'")


# ── SDR Performance Drill-down ───────────────────────────────────────────────

@router.get("/sdr-performance/{sdr_id}")
def get_sdr_performance(sdr_id: str, period: str = Query("all_time"), start_date: Optional[str] = None, end_date: Optional[str] = None, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    sdr = db.query(User).filter(User.id == sdr_id).first()
    if not sdr:
        raise HTTPException(status_code=404, detail="SDR not found")
    role = user.get("role")
    if role == "SDR" and user["sub"] != sdr_id:
        raise HTTPException(status_code=403, detail="SDRs can only view their own performance.")
    if role == "Pod Admin":
        admin_user = db.query(User).filter(User.id == user["sub"]).first()
        if admin_user and sdr.pod_id != admin_user.pod_id:
            raise HTTPException(status_code=403, detail="Pod Admins can only view SDRs in their POD.")

    # Parse period
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    ps, pe = None, None
    if period == "today": ps, pe = today, now
    elif period == "this_week": ps, pe = today - timedelta(days=today.weekday()), now
    elif period == "this_month": ps, pe = today.replace(day=1), now
    elif period == "custom" and start_date and end_date:
        try: ps = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc); pe = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
        except Exception: pass

    assigned = sdr.assigned_leads
    if ps:
        assigned = [l for l in assigned if l.lead_started_at and l.lead_started_at.replace(tzinfo=timezone.utc if l.lead_started_at.tzinfo is None else l.lead_started_at.tzinfo) >= ps]
    calls_q = db.query(CallLog).filter(CallLog.user_id == sdr_id)
    if ps: calls_q = calls_q.filter(CallLog.called_at >= ps)
    if pe: calls_q = calls_q.filter(CallLog.called_at <= pe)
    calls = calls_q.all()
    total_leads, total_calls = len(assigned), len(calls)
    status_counts = {s.value: len([l for l in assigned if l.status == s.value]) for s in Status}
    meetings = status_counts.get("Meeting Scheduled", 0)

    # Lead time efficiency
    lead_times = []
    for l in assigned:
        if l.status in TERMINAL_STATUSES and l.lead_started_at and l.lead_closed_at:
            s2 = l.lead_started_at.replace(tzinfo=timezone.utc) if l.lead_started_at.tzinfo is None else l.lead_started_at
            c2 = l.lead_closed_at.replace(tzinfo=timezone.utc) if l.lead_closed_at.tzinfo is None else l.lead_closed_at
            lead_times.append((c2 - s2).total_seconds() / 3600)

    return {"sdr": {"id": sdr.id, "name": sdr.name or sdr.email, "email": sdr.email, "pod_name": sdr.pod.name if sdr.pod_id and sdr.pod else None}, "period": period, "productivity": {"total_leads_assigned": total_leads, "active_leads": len([l for l in assigned if l.status in ACTIVE_STATUSES]), "leads_closed": len([l for l in assigned if l.status in TERMINAL_STATUSES]), "calls_made": total_calls, "avg_calls_per_lead": round(total_calls / total_leads, 1) if total_leads else 0}, "conversion": {"meetings_scheduled": meetings, "conversion_rate": round(meetings / total_leads * 100, 1) if total_leads else 0}, "efficiency": {"avg_time_per_lead_hours": round(statistics.mean(lead_times), 1) if lead_times else None, "median_time_per_lead_hours": round(statistics.median(lead_times), 1) if lead_times else None}, "funnel": {"Lead Assigned": status_counts.get("Lead Assigned", 0), "Research": status_counts.get("Research", 0), "Calling": status_counts.get("Calling", 0), "Meeting Scheduled": meetings, "Customer Declined": status_counts.get("Customer Declined", 0), "Unreachable": status_counts.get("Unreachable", 0)}}
