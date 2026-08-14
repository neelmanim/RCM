# ── routes/sdr_performance_routes.py — SDR performance drill-down ──────────────
from datetime import datetime, date, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
import statistics

import models
from models import TERMINAL_STATUSES
from database import get_db
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["SDR Performance"])


def _parse_period(period: str, start_date: str = None, end_date: str = None):
    """Return (start_dt, end_dt) based on period string."""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if period == "today":
        return today, now
    elif period == "this_week":
        start = today - timedelta(days=today.weekday())
        return start, now
    elif period == "this_month":
        start = today.replace(day=1)
        return start, now
    elif period == "custom" and start_date and end_date:
        try:
            s = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
            e = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
            return s, e
        except Exception:
            pass
    # all_time
    return None, None


@router.get("/sdr-performance/{sdr_id}")
def get_sdr_performance(
    sdr_id: str,
    period: str = Query("all_time"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """SDR performance drill-down with productivity, conversion, efficiency metrics."""

    # Get the target SDR
    sdr = db.query(models.User).filter(models.User.id == sdr_id).first()
    if not sdr:
        raise HTTPException(status_code=404, detail="SDR not found")

    # Access control
    role = user.get("role")
    if role in ("SDR", "AE") and user["sub"] != sdr_id:
        raise HTTPException(status_code=403, detail="You can only view your own performance.")
    if role == "Pod Admin":
        admin_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
        if admin_user and sdr.pod_id != admin_user.pod_id:
            raise HTTPException(status_code=403, detail="Pod Admins can only view users in their POD.")

    # Parse time filter
    period_start, period_end = _parse_period(period, start_date, end_date)

    # Get all leads ever assigned to this SDR
    all_assigned_leads = sdr.assigned_leads

    # Filter by period if needed
    if period_start:
        leads_in_period = [
            l for l in all_assigned_leads
            if l.lead_started_at and l.lead_started_at.replace(tzinfo=timezone.utc if l.lead_started_at.tzinfo is None else l.lead_started_at.tzinfo) >= period_start
        ]
    else:
        leads_in_period = list(all_assigned_leads)

    # Get all calls
    all_calls_query = db.query(models.CallLog).filter(models.CallLog.user_id == sdr_id)
    if period_start:
        all_calls_query = all_calls_query.filter(models.CallLog.called_at >= period_start)
    if period_end:
        all_calls_query = all_calls_query.filter(models.CallLog.called_at <= period_end)
    calls_in_period = all_calls_query.all()

    total_leads = len(leads_in_period)
    total_calls = len(calls_in_period)

    # Status counts via SQL GROUP BY — avoids N list comprehensions over Python objects
    from sqlalchemy import func as _func, text as _text
    _base_lead_q = (
        db.query(models.Lead.status, _func.count(models.Lead.id).label("cnt"))
        .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id)
        .filter(models.lead_assignments.c.user_id == sdr_id)
    )
    if period_start:
        _base_lead_q = _base_lead_q.filter(models.Lead.status_changed_at >= period_start)
    _status_rows = _base_lead_q.group_by(models.Lead.status).all()
    status_counts = {s.value: 0 for s in models.Status}
    for _status, _cnt in _status_rows:
        if _status in status_counts:
            status_counts[_status] = _cnt

    active_leads      = sum(status_counts.get(s, 0) for s in models.ACTIVE_STATUSES)
    leads_closed      = sum(status_counts.get(s, 0) for s in TERMINAL_STATUSES)
    MEETING_OR_BEYOND = {"Meeting Scheduled", "1st Discovery Meeting", "Discovery Complete", "Demo Scheduled", "Demo Done", "Completed"}
    meetings_scheduled = sum(status_counts.get(s, 0) for s in MEETING_OR_BEYOND)

    # Productivity
    avg_calls_per_lead = round(total_calls / total_leads, 1) if total_leads > 0 else 0

    # Conversion
    conversion_rate = round((meetings_scheduled / total_leads * 100), 1) if total_leads > 0 else 0

    # Efficiency: time per lead (for closed leads)
    lead_times = []
    for l in leads_in_period:
        if l.status in TERMINAL_STATUSES and l.lead_started_at and l.lead_closed_at:
            started = l.lead_started_at
            closed = l.lead_closed_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            if closed.tzinfo is None:
                closed = closed.replace(tzinfo=timezone.utc)
            delta = (closed - started).total_seconds() / 3600  # hours
            lead_times.append(delta)

    avg_time_per_lead = round(statistics.mean(lead_times), 1) if lead_times else None
    median_time_per_lead = round(statistics.median(lead_times), 1) if lead_times else None

    # Pod info
    pod_name = sdr.pod.name if sdr.pod_id and sdr.pod else None

    return {
        "sdr": {
            "id": sdr.id,
            "name": sdr.name or sdr.email,
            "email": sdr.email,
            "pod_name": pod_name,
        },
        "period": period,
        "productivity": {
            "total_leads_assigned": total_leads,
            "active_leads": active_leads,
            "leads_closed": leads_closed,
            "calls_made": total_calls,
            "avg_calls_per_lead": avg_calls_per_lead,
        },
        "conversion": {
            "meetings_scheduled": meetings_scheduled,
            "conversion_rate": conversion_rate,
        },
        "efficiency": {
            "avg_time_per_lead_hours": avg_time_per_lead,
            "median_time_per_lead_hours": median_time_per_lead,
        },
        "funnel": {
            "Lead Assigned": status_counts.get("Lead Assigned", 0),
            "Research": status_counts.get("Research", 0),
            "Calling": status_counts.get("Calling", 0),
            "Meeting Scheduled": status_counts.get("Meeting Scheduled", 0),
            "1st Discovery Meeting": status_counts.get("1st Discovery Meeting", 0),
            "Discovery Complete": status_counts.get("Discovery Complete", 0),
            "Demo Scheduled": status_counts.get("Demo Scheduled", 0),
            "Demo Done": status_counts.get("Demo Done", 0),
            "Completed": status_counts.get("Completed", 0),
            "Disqualified": status_counts.get("Disqualified", 0),
        },
    }
