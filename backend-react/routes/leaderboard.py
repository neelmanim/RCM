"""Leaderboard + SDR performance drill-down routes."""
import statistics
from datetime import datetime, date, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from middleware import get_current_user
from models import User, CallLog, Status, ACTIVE_STATUSES, TERMINAL_STATUSES

router = APIRouter(prefix="/api", tags=["Leaderboard & SDR Performance"])


@router.get("/leaderboard")
def get_leaderboard(range: int = Query(0, ge=0, le=365), user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    today_start = datetime.combine(date.today(), datetime.min.time())
    cutoff = datetime.now(timezone.utc) - timedelta(days=range) if range > 0 else None
    sdrs = db.query(User).filter(User.role == "SDR").all()
    board = []
    for sdr in sdrs:
        cq = db.query(CallLog).filter(CallLog.user_id == sdr.id)
        if cutoff: cq = cq.filter(CallLog.called_at >= cutoff)
        all_calls = cq.all()
        calls_today = [c for c in all_calls if c.called_at and c.called_at.replace(tzinfo=None) >= today_start]
        leads = sdr.assigned_leads
        if cutoff:
            cn = cutoff.replace(tzinfo=None)
            leads = [l for l in leads if (l.status_changed_at or l.created_at) and (l.status_changed_at or l.created_at).replace(tzinfo=None) >= cn]
        total = len(leads)
        meetings = len([l for l in leads if l.status == "Meeting Scheduled"])
        board.append({"id": sdr.id, "name": sdr.name or sdr.email, "email": sdr.email, "pod_name": sdr.pod.name if sdr.pod_id and sdr.pod else None, "calls_today": len(calls_today), "total_calls": len(all_calls), "meetings_scheduled": meetings, "disqualified": len([l for l in leads if l.status == "Disqualified"]), "active_leads": len([l for l in leads if l.status in ACTIVE_STATUSES]), "total_leads": total, "conversion_rate": round(meetings / total * 100, 1) if total else 0.0})
    board.sort(key=lambda x: (-x["meetings_scheduled"], -x["total_calls"]))
    for i, e in enumerate(board): e["rank"] = i + 1
    return board


def _parse_period(period, start_date=None, end_date=None):
    now = datetime.now(timezone.utc); today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "today": return today, now
    if period == "this_week": return today - timedelta(days=today.weekday()), now
    if period == "this_month": return today.replace(day=1), now
    if period == "custom" and start_date and end_date:
        try: return datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc), datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
        except Exception: pass
    return None, None


@router.get("/sdr-performance/{sdr_id}")
def get_sdr_performance(sdr_id: str, period: str = Query("all_time"), start_date: Optional[str] = None, end_date: Optional[str] = None, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    sdr = db.query(User).filter(User.id == sdr_id).first()
    if not sdr: raise HTTPException(status_code=404, detail="SDR not found")
    role = user.get("role")
    if role == "SDR" and user["sub"] != sdr_id: raise HTTPException(status_code=403, detail="SDRs can only view own performance.")
    if role == "Pod Admin":
        au = db.query(User).filter(User.id == user["sub"]).first()
        if au and sdr.pod_id != au.pod_id: raise HTTPException(status_code=403, detail="Pod Admins limited to own POD.")
    ps, pe = _parse_period(period, start_date, end_date)
    all_leads = sdr.assigned_leads
    leads = [l for l in all_leads if l.lead_started_at and l.lead_started_at.replace(tzinfo=timezone.utc if l.lead_started_at.tzinfo is None else l.lead_started_at.tzinfo) >= ps] if ps else list(all_leads)
    cq = db.query(CallLog).filter(CallLog.user_id == sdr_id)
    if ps: cq = cq.filter(CallLog.called_at >= ps)
    if pe: cq = cq.filter(CallLog.called_at <= pe)
    calls = cq.all()
    tl = len(leads); tc = len(calls)
    sc = {s.value: len([l for l in leads if l.status == s.value]) for s in Status}
    active = len([l for l in leads if l.status in ACTIVE_STATUSES])
    closed = len([l for l in leads if l.status in TERMINAL_STATUSES])
    meetings = sc.get("Meeting Scheduled", 0)
    lt = []
    for l in leads:
        if l.status in TERMINAL_STATUSES and l.lead_started_at and l.lead_closed_at:
            s = l.lead_started_at.replace(tzinfo=timezone.utc) if l.lead_started_at.tzinfo is None else l.lead_started_at
            c = l.lead_closed_at.replace(tzinfo=timezone.utc) if l.lead_closed_at.tzinfo is None else l.lead_closed_at
            lt.append((c - s).total_seconds() / 3600)
    return {"sdr": {"id": sdr.id, "name": sdr.name or sdr.email, "email": sdr.email, "pod_name": sdr.pod.name if sdr.pod_id and sdr.pod else None}, "period": period, "productivity": {"total_leads_assigned": tl, "active_leads": active, "leads_closed": closed, "calls_made": tc, "avg_calls_per_lead": round(tc / tl, 1) if tl else 0}, "conversion": {"meetings_scheduled": meetings, "conversion_rate": round(meetings / tl * 100, 1) if tl else 0}, "efficiency": {"avg_time_per_lead_hours": round(statistics.mean(lt), 1) if lt else None, "median_time_per_lead_hours": round(statistics.median(lt), 1) if lt else None}, "funnel": {"Lead Assigned": sc.get("Lead Assigned", 0), "Research": sc.get("Research", 0), "Calling": sc.get("Calling", 0), "Meeting Scheduled": meetings, "Customer Declined": sc.get("Customer Declined", 0), "Unreachable": sc.get("Unreachable", 0)}}
