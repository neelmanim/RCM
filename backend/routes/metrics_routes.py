"""
SDR Usage Metrics API Routes (Admin only).
Provides KPI summary, daily trends, per-SDR table, and CSV/Excel export.
"""
import csv
import io
import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from auth import require_admin
import models

router = APIRouter(prefix="/api/admin/metrics", tags=["SDR Metrics"])


def _get_date_range(range_days: int, start_date: str = None, end_date: str = None):
    """Return (start_date, end_date) as UTC datetimes.
    If explicit start_date/end_date strings are provided, use those instead of range."""
    if start_date and end_date:
        try:
            start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
            end = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
            return start, end
        except ValueError:
            pass  # Fall through to range-based calculation
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=range_days)
    return start, end


@router.get("/summary")
def get_metrics_summary(
    range: int = Query(30, ge=1, le=365),
    start_date: str = Query(None),
    end_date: str = Query(None),
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Return KPI cards: daily active SDRs, leads processed, meetings, most used feature, avg time spent."""
    start, end = _get_date_range(range, start_date, end_date)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    # Get user IDs for filtering — pod-scoped for Pod Admin (auto-scoped, no toggle)
    sdr_ids_q = db.query(models.User.id).filter(
        models.User.role.notin_(["Super Admin", "Admin"])
    )
    if admin.get("role") == "Pod Admin" and admin.get("pod_id"):
        sdr_ids_q = sdr_ids_q.filter(models.User.pod_id == admin.get("pod_id"))
    sdr_ids = [uid for (uid,) in sdr_ids_q.all()]

    # Query from daily summaries — SDR only
    summaries = db.query(models.UserActivityDailySummary).filter(
        models.UserActivityDailySummary.summary_date >= start_str,
        models.UserActivityDailySummary.summary_date <= end_str,
        models.UserActivityDailySummary.user_id.in_(sdr_ids) if sdr_ids else False,
    ).all()

    # Check if summaries have meaningful activity (not just login-only stale rows)
    has_meaningful_data = summaries and any(
        (s.lead_views or 0) + (s.status_updates or 0) + (s.calls_logged or 0) + (s.meetings_scheduled or 0) > 0
        for s in summaries
    )

    if not has_meaningful_data:
        # Fallback: count raw activity logs broken down by action type
        from sqlalchemy import case
        action_counts = db.query(
            func.count(func.distinct(models.UserActivityLog.user_id)).label("active_sdrs"),
            func.sum(case((models.UserActivityLog.action_type == "VIEW_LEAD", 1), else_=0)).label("lead_views"),
            func.sum(case((models.UserActivityLog.action_type == "UPDATE_LEAD_STATUS", 1), else_=0)).label("status_updates"),
            func.sum(case((models.UserActivityLog.action_type == "LOG_CALL", 1), else_=0)).label("calls_logged"),
            func.sum(case((models.UserActivityLog.action_type == "SCHEDULE_MEETING", 1), else_=0)).label("meetings"),
            func.count(models.UserActivityLog.id).label("total"),
        ).filter(
            models.UserActivityLog.created_at >= start,
            models.UserActivityLog.created_at <= end,
            models.UserActivityLog.user_id.in_(sdr_ids) if sdr_ids else False,
        ).first()

        active_sdrs = action_counts.active_sdrs or 0
        lead_views = action_counts.lead_views or 0
        status_updates = action_counts.status_updates or 0
        calls_logged = action_counts.calls_logged or 0
        meetings = action_counts.meetings or 0
        total = action_counts.total or 0

        # Calculate time spent from LoginLog (heartbeat-based)
        sessions = db.query(models.LoginLog).filter(
            models.LoginLog.login_at >= start,
            models.LoginLog.login_at <= end,
            models.LoginLog.logout_at != None,
            models.LoginLog.user_id.in_(sdr_ids) if sdr_ids else False,
        ).all()
        total_time = 0
        for s in sessions:
            if s.login_at and s.logout_at:
                login_naive = s.login_at.replace(tzinfo=None) if s.login_at.tzinfo else s.login_at
                # Use heartbeat-based end time for accuracy
                if s.last_heartbeat_at:
                    hb_naive = s.last_heartbeat_at.replace(tzinfo=None) if s.last_heartbeat_at.tzinfo else s.last_heartbeat_at
                    dur = (hb_naive - login_naive).total_seconds() / 60.0 + 5  # +5 min buffer
                else:
                    # Legacy session without heartbeats — cap at 30 min
                    logout_naive = s.logout_at.replace(tzinfo=None) if s.logout_at.tzinfo else s.logout_at
                    dur = (logout_naive - login_naive).total_seconds() / 60.0
                    dur = min(dur, 30)
                total_time += max(0, min(dur, 120))  # Cap at 2h per session

        # Determine most used feature
        features = {
            "Lead Views": lead_views,
            "Status Updates": status_updates,
            "Calls Logged": calls_logged,
            "Meetings": meetings,
        }
        most_used = max(features, key=features.get) if any(features.values()) else None

        return {
            "daily_active_sdrs": active_sdrs,
            "leads_processed": status_updates + calls_logged,  # leads worked on (status changes + calls)
            "meetings_scheduled": meetings,
            "most_used_feature": most_used,
            "most_used_feature_count": features.get(most_used, 0) if most_used else 0,
            "total_time_spent_minutes": int(total_time),
            "avg_time_per_sdr_minutes": int(total_time / max(active_sdrs, 1)),
            "total_actions": total,
            "calls_logged": calls_logged,
            "status_updates": status_updates,
        }

    # Aggregate from summaries
    unique_dates = set()
    unique_users = set()
    total_leads = total_status = total_meetings = total_calls = 0
    total_assigns = total_exports = total_actions = total_time_minutes = 0

    for s in summaries:
        unique_dates.add(s.summary_date)
        unique_users.add(s.user_id)
        total_leads += s.lead_views or 0
        total_status += s.status_updates or 0
        total_meetings += s.meetings_scheduled or 0
        total_calls += s.calls_logged or 0
        total_assigns += s.leads_assigned or 0
        total_exports += s.exports or 0
        total_actions += s.total_actions or 0
        total_time_minutes += s.time_spent_minutes or 0

    # Most used feature
    features = {
        "Lead Views": total_leads,
        "Status Updates": total_status,
        "Calls Logged": total_calls,
        "Meetings": total_meetings,
        "Logins": sum(s.login_count or 0 for s in summaries),
    }
    most_used = max(features, key=features.get) if features else None

    num_sdrs = len(unique_users)
    num_days = max(len(unique_dates), 1)
    daily_avg_sdrs = num_sdrs  # unique over period

    return {
        "daily_active_sdrs": daily_avg_sdrs,
        "leads_processed": total_leads,
        "meetings_scheduled": total_meetings,
        "most_used_feature": most_used,
        "most_used_feature_count": features.get(most_used, 0) if most_used else 0,
        "total_time_spent_minutes": total_time_minutes,
        "avg_time_per_sdr_minutes": int(total_time_minutes / max(num_sdrs, 1)),
        "total_actions": total_actions,
        "calls_logged": total_calls,
        "status_updates": total_status,
    }


@router.get("/daily-trend")
def get_daily_trend(
    range: int = Query(30, ge=1, le=365),
    start_date: str = Query(None),
    end_date: str = Query(None),
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Return daily aggregated data for chart rendering."""
    start, end = _get_date_range(range, start_date, end_date)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    # Get user IDs for filtering — pod-scoped for Pod Admin (auto-scoped, no toggle)
    sdr_ids_q = db.query(models.User.id).filter(
        models.User.role.notin_(["Super Admin", "Admin"])
    )
    if admin.get("role") == "Pod Admin" and admin.get("pod_id"):
        sdr_ids_q = sdr_ids_q.filter(models.User.pod_id == admin.get("pod_id"))
    sdr_ids = [uid for (uid,) in sdr_ids_q.all()]

    results = db.query(
        models.UserActivityDailySummary.summary_date,
        func.sum(models.UserActivityDailySummary.lead_views).label("lead_views"),
        func.sum(models.UserActivityDailySummary.status_updates).label("status_updates"),
        func.sum(models.UserActivityDailySummary.calls_logged).label("calls_logged"),
        func.sum(models.UserActivityDailySummary.meetings_scheduled).label("meetings"),
        func.sum(models.UserActivityDailySummary.total_actions).label("total"),
        func.sum(models.UserActivityDailySummary.time_spent_minutes).label("time_spent"),
        func.count(func.distinct(models.UserActivityDailySummary.user_id)).label("active_sdrs"),
    ).filter(
        models.UserActivityDailySummary.summary_date >= start_str,
        models.UserActivityDailySummary.summary_date <= end_str,
        models.UserActivityDailySummary.user_id.in_(sdr_ids) if sdr_ids else False,
    ).group_by(
        models.UserActivityDailySummary.summary_date
    ).order_by(
        models.UserActivityDailySummary.summary_date
    ).all()

    # Check if summaries have meaningful activity (not just login-only stale rows)
    has_meaningful_trend = results and any(
        (r.lead_views or 0) + (r.status_updates or 0) + (r.calls_logged or 0) + (r.meetings or 0) > 0
        for r in results
    )

    if has_meaningful_trend:
        return [{
            "date": r.summary_date,
            "lead_views": r.lead_views or 0,
            "status_updates": r.status_updates or 0,
            "calls_logged": r.calls_logged or 0,
            "meetings": r.meetings or 0,
            "total": r.total or 0,
            "time_spent_minutes": r.time_spent or 0,
            "active_sdrs": r.active_sdrs or 0,
        } for r in results]

    # ── Fallback: aggregate from raw activity logs ────────────────────────
    from sqlalchemy import cast, Date
    raw = db.query(
        cast(models.UserActivityLog.created_at, Date).label("day"),
        models.UserActivityLog.action_type,
        func.count(models.UserActivityLog.id).label("cnt"),
    ).filter(
        models.UserActivityLog.created_at >= start,
        models.UserActivityLog.created_at <= end,
        models.UserActivityLog.user_id.in_(sdr_ids) if sdr_ids else False,
    ).group_by(
        cast(models.UserActivityLog.created_at, Date),
        models.UserActivityLog.action_type,
    ).all()

    if not raw:
        return []

    # Build per-day aggregation
    from collections import defaultdict
    day_data = defaultdict(lambda: {
        "lead_views": 0, "status_updates": 0, "calls_logged": 0,
        "meetings": 0, "total": 0, "time_spent_minutes": 0, "active_sdrs": 0,
    })

    for r in raw:
        day_str = str(r.day)
        action = r.action_type or ""
        count = r.cnt or 0
        d = day_data[day_str]

        if action == "VIEW_LEAD":
            d["lead_views"] += count
        elif action == "UPDATE_LEAD_STATUS":
            d["status_updates"] += count
        elif action == "LOG_CALL":
            d["calls_logged"] += count
        elif action == "SCHEDULE_MEETING":
            d["meetings"] += count
        d["total"] += count

    # Add time spent from login sessions (heartbeat-based per-session)
    login_sessions = db.query(models.LoginLog).filter(
        models.LoginLog.login_at >= start,
        models.LoginLog.login_at <= end,
        models.LoginLog.logout_at != None,
        models.LoginLog.user_id.in_(sdr_ids) if sdr_ids else False,
    ).all()

    for s in login_sessions:
        if not s.login_at or not s.logout_at:
            continue
        login_naive = s.login_at.replace(tzinfo=None) if s.login_at.tzinfo else s.login_at
        if s.last_heartbeat_at:
            hb_naive = s.last_heartbeat_at.replace(tzinfo=None) if s.last_heartbeat_at.tzinfo else s.last_heartbeat_at
            dur = (hb_naive - login_naive).total_seconds() / 60.0 + 5
        else:
            logout_naive = s.logout_at.replace(tzinfo=None) if s.logout_at.tzinfo else s.logout_at
            dur = (logout_naive - login_naive).total_seconds() / 60.0
            dur = min(dur, 30)
        dur = max(0, min(dur, 120))
        day_str = str(login_naive.date())
        if day_str in day_data:
            day_data[day_str]["time_spent_minutes"] += int(dur)
        else:
            day_data[day_str] = {
                "lead_views": 0, "status_updates": 0, "calls_logged": 0,
                "meetings": 0, "total": 0,
                "time_spent_minutes": int(dur),
                "active_sdrs": 0,
            }

    return [{"date": day, **data} for day, data in sorted(day_data.items())]


@router.get("/sdr-table")
def get_sdr_table(
    range: int = Query(30, ge=1, le=365),
    start_date: str = Query(None),
    end_date: str = Query(None),
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Return per-SDR aggregated metrics for the table display."""
    start, end = _get_date_range(range, start_date, end_date)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    # Get user IDs for filtering — pod-scoped for Pod Admin (auto-scoped, no toggle)
    sdr_ids_q = db.query(models.User.id).filter(
        models.User.role.notin_(["Super Admin", "Admin"])
    )
    if admin.get("role") == "Pod Admin" and admin.get("pod_id"):
        sdr_ids_q = sdr_ids_q.filter(models.User.pod_id == admin.get("pod_id"))
    sdr_ids = [uid for (uid,) in sdr_ids_q.all()]

    results = db.query(
        models.UserActivityDailySummary.user_id,
        models.UserActivityDailySummary.user_email,
        models.UserActivityDailySummary.user_name,
        func.sum(models.UserActivityDailySummary.lead_views).label("lead_views"),
        func.sum(models.UserActivityDailySummary.status_updates).label("status_updates"),
        func.sum(models.UserActivityDailySummary.calls_logged).label("calls_logged"),
        func.sum(models.UserActivityDailySummary.meetings_scheduled).label("meetings"),
        func.sum(models.UserActivityDailySummary.total_actions).label("total"),
        func.sum(models.UserActivityDailySummary.time_spent_minutes).label("time_spent"),
    ).filter(
        models.UserActivityDailySummary.summary_date >= start_str,
        models.UserActivityDailySummary.summary_date <= end_str,
        models.UserActivityDailySummary.user_id.in_(sdr_ids) if sdr_ids else False,
    ).group_by(
        models.UserActivityDailySummary.user_id,
        models.UserActivityDailySummary.user_email,
        models.UserActivityDailySummary.user_name,
    ).order_by(
        func.sum(models.UserActivityDailySummary.total_actions).desc()
    ).all()

    # Check if summaries have meaningful activity (not just login-only stale rows)
    has_meaningful_sdr = results and any(
        (r.lead_views or 0) + (r.status_updates or 0) + (r.calls_logged or 0) + (r.meetings or 0) > 0
        for r in results
    )

    if has_meaningful_sdr:
        return [{
            "user_id": r.user_id,
            "user_email": r.user_email,
            "user_name": r.user_name or r.user_email,
            "lead_views": r.lead_views or 0,
            "status_updates": r.status_updates or 0,
            "calls_logged": r.calls_logged or 0,
            "meetings": r.meetings or 0,
            "total_actions": r.total or 0,
            "time_spent_minutes": r.time_spent or 0,
        } for r in results]

    # ── Fallback: aggregate per-user from raw UserActivityLog ─────────────
    from sqlalchemy import case
    from collections import defaultdict

    raw = db.query(
        models.UserActivityLog.user_id,
        models.UserActivityLog.user_email,
        models.UserActivityLog.user_name,
        func.sum(case((models.UserActivityLog.action_type == "VIEW_LEAD", 1), else_=0)).label("lead_views"),
        func.sum(case((models.UserActivityLog.action_type == "UPDATE_LEAD_STATUS", 1), else_=0)).label("status_updates"),
        func.sum(case((models.UserActivityLog.action_type == "LOG_CALL", 1), else_=0)).label("calls_logged"),
        func.sum(case((models.UserActivityLog.action_type == "SCHEDULE_MEETING", 1), else_=0)).label("meetings"),
        func.count(models.UserActivityLog.id).label("total"),
    ).filter(
        models.UserActivityLog.created_at >= start,
        models.UserActivityLog.created_at <= end,
        models.UserActivityLog.user_id.in_(sdr_ids) if sdr_ids else False,
    ).group_by(
        models.UserActivityLog.user_id,
        models.UserActivityLog.user_email,
        models.UserActivityLog.user_name,
    ).all()

    if not raw:
        return []

    # Build user data dict
    user_data = {}
    for r in raw:
        user_data[r.user_id] = {
            "user_id": r.user_id,
            "user_email": r.user_email,
            "user_name": r.user_name or r.user_email,
            "lead_views": r.lead_views or 0,
            "status_updates": r.status_updates or 0,
            "calls_logged": r.calls_logged or 0,
            "meetings": r.meetings or 0,
            "total_actions": r.total or 0,
            "time_spent_minutes": 0,
        }

    # Merge time spent from LoginLog per user (heartbeat-based per-session)
    login_sessions = db.query(models.LoginLog).filter(
        models.LoginLog.login_at >= start,
        models.LoginLog.login_at <= end,
        models.LoginLog.logout_at != None,
        models.LoginLog.user_id.in_(sdr_ids) if sdr_ids else False,
    ).all()

    for s in login_sessions:
        if not s.login_at or not s.logout_at:
            continue
        uid = s.user_id
        if uid not in user_data:
            continue
        login_naive = s.login_at.replace(tzinfo=None) if s.login_at.tzinfo else s.login_at
        if s.last_heartbeat_at:
            hb_naive = s.last_heartbeat_at.replace(tzinfo=None) if s.last_heartbeat_at.tzinfo else s.last_heartbeat_at
            dur = (hb_naive - login_naive).total_seconds() / 60.0 + 5
        else:
            logout_naive = s.logout_at.replace(tzinfo=None) if s.logout_at.tzinfo else s.logout_at
            dur = (logout_naive - login_naive).total_seconds() / 60.0
            dur = min(dur, 30)
        dur = max(0, min(dur, 120))
        user_data[uid]["time_spent_minutes"] += int(dur)

    # Sort by total_actions descending
    return sorted(user_data.values(), key=lambda x: x["total_actions"], reverse=True)


@router.get("/export")
def export_metrics(
    range: int = Query(30, ge=1, le=365),
    format: str = Query("csv"),
    start_date: str = Query(None),
    end_date: str = Query(None),
    token: str = Query(None),
    db: Session = Depends(get_db),
):
    """Export SDR metrics as CSV or Excel file.
    
    Uses token query parameter for auth since window.open() cannot set headers.
    """
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    from auth import decode_jwt
    user = decode_jwt(token)
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    sdr_data = get_sdr_table(range=range, start_date=start_date, end_date=end_date, db=db, admin=user)

    if format == "csv":
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=[
            "user_name", "user_email", "lead_views", "status_updates",
            "calls_logged", "meetings", "total_actions", "time_spent_minutes"
        ])
        writer.writeheader()
        for row in sdr_data:
            writer.writerow({k: row.get(k, "") for k in writer.fieldnames})

        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=sdr_metrics_{range}d.csv"}
        )

    elif format == "xlsx":
        try:
            import openpyxl
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = f"SDR Metrics ({range} Days)"

            headers = ["SDR Name", "Email", "Lead Views", "Status Updates",
                       "Calls Logged", "Meetings", "Total Actions", "Time Spent (min)"]
            ws.append(headers)

            for row in sdr_data:
                ws.append([
                    row.get("user_name", ""),
                    row.get("user_email", ""),
                    row.get("lead_views", 0),
                    row.get("status_updates", 0),
                    row.get("calls_logged", 0),
                    row.get("meetings", 0),
                    row.get("total_actions", 0),
                    row.get("time_spent_minutes", 0),
                ])

            output = io.BytesIO()
            wb.save(output)
            output.seek(0)

            return StreamingResponse(
                output,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename=sdr_metrics_{range}d.xlsx"}
            )
        except ImportError:
            raise HTTPException(status_code=500, detail="openpyxl not installed for Excel export")
    else:
        raise HTTPException(status_code=422, detail="Format must be 'csv' or 'xlsx'")


# ── TEMPORARY: Seed test data endpoint (remove after testing) ─────────────────
@router.post("/seed")
def seed_test_data(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Seed 30 days of test metrics data. TEMPORARY — remove after testing."""
    import random, traceback
    from datetime import timedelta

    try:
        sdrs = db.query(models.User).filter(
            models.User.role == 'SDR'
        ).all()
        if not sdrs:
            sdrs = db.query(models.User).all()
        if not sdrs:
            raise HTTPException(status_code=404, detail="No users found")

        now = datetime.now(timezone.utc)
        days_back = 30
        actions = ['VIEW_LEAD', 'UPDATE_LEAD_STATUS', 'LOG_CALL', 'SCHEDULE_MEETING', 'LOGIN']
        weights = [40, 20, 25, 10, 5]
        log_count = summary_count = login_count = 0
        errors = []

        # ── Step 1: Activity logs ─────────────────────────────────────────────
        try:
            for sdr in sdrs:
                for day_offset in range(days_back):
                    day = now - timedelta(days=day_offset)
                    for _ in range(random.randint(5, 15)):
                        action = random.choices(actions, weights=weights, k=1)[0]
                        ts = day.replace(hour=random.randint(8, 18), minute=random.randint(0, 59))
                        db.add(models.UserActivityLog(
                            user_id=sdr.id, user_email=sdr.email,
                            user_name=sdr.name or sdr.email, action_type=action,
                            object_type='lead' if action != 'LOGIN' else 'session',
                            object_id=f"seed-{random.randint(1000,9999)}",
                            metadata_json='{"source":"seed"}', created_at=ts
                        ))
                        log_count += 1
            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(f"Activity logs failed: {str(e)}")

        # ── Step 2: Daily summaries ───────────────────────────────────────────
        try:
            for sdr in sdrs:
                for day_offset in range(days_back):
                    day_date = (now - timedelta(days=day_offset)).strftime("%Y-%m-%d")
                    lv, su, cl, ms, lc = random.randint(3,25), random.randint(1,10), random.randint(2,15), random.randint(0,3), random.randint(1,4)
                    total = lv + su + cl + ms + lc
                    time_m = random.randint(20, 180)

                    existing = db.query(models.UserActivityDailySummary).filter(
                        models.UserActivityDailySummary.user_id == sdr.id,
                        models.UserActivityDailySummary.summary_date == day_date
                    ).first()
                    if not existing:
                        db.add(models.UserActivityDailySummary(
                            user_id=sdr.id, user_email=sdr.email,
                            user_name=sdr.name or sdr.email,
                            summary_date=day_date, lead_views=lv,
                            status_updates=su, calls_logged=cl,
                            meetings_scheduled=ms, login_count=lc,
                            total_actions=total, time_spent_minutes=time_m
                        ))
                        summary_count += 1
            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(f"Daily summaries failed: {str(e)}")

        # ── Step 3: Login logs ────────────────────────────────────────────────
        try:
            for sdr in sdrs:
                for day_offset in range(days_back):
                    day = now - timedelta(days=day_offset)
                    for _ in range(random.randint(1, 3)):
                        lt = day.replace(hour=random.choice([8,9,10,13,14]), minute=random.randint(0,30))
                        db.add(models.LoginLog(
                            user_id=sdr.id, email=sdr.email,
                            name=sdr.name or sdr.email,
                            ip_address=f"10.0.{random.randint(1,254)}.{random.randint(1,254)}",
                            user_agent="seed-script",
                            login_at=lt, logout_at=lt + timedelta(minutes=random.randint(30,180))
                        ))
                        login_count += 1
            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(f"Login logs failed: {str(e)}")

        result = {
            "message": f"Seeded {log_count} logs, {summary_count} summaries, {login_count} logins for {len(sdrs)} users over {days_back} days",
            "users_found": len(sdrs),
        }
        if errors:
            result["errors"] = errors
        return result

    except HTTPException:
        raise
    except Exception as e:
        return {"error": str(e), "traceback": traceback.format_exc()}
