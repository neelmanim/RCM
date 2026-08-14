"""Call logging, call summary, lead close, and leaderboard routes."""
import logging, threading
from datetime import datetime, timezone, timedelta, date
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from middleware import get_current_user, require_admin
from models import (
    Lead, User, Pod, CallLog, DialerCall, CallOutcome, LeadStatusLog,
    LeadEmailActivity, SyncSettings,
    TERMINAL_STATUSES, ACTIVE_STATUSES, ATTEMPT_OUTCOMES, LEGACY_OUTCOME_MAP,
    log_status_change,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Calls"])


def _call_to_dict(call):
    return {"id": call.id, "lead_id": call.lead_id, "user_id": call.user_id, "user_name": call.user.name if call.user else "Unknown", "outcome": call.outcome if isinstance(call.outcome, str) else (call.outcome.value if call.outcome else None), "notes": call.notes, "called_at": str(call.called_at) if call.called_at else None}


def _get_settings(db):
    s = db.query(SyncSettings).filter(SyncSettings.id == 1).first()
    if not s:
        s = SyncSettings(id=1); db.add(s); db.commit(); db.refresh(s)
    return s


def _can_modify_lead(db, user, lead_id):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    role = user.get("role", "")
    if role in ("Super Admin", "Pod Admin"):
        return lead
    if any(u.id == user["sub"] for u in lead.assigned_users):
        return lead
    raise HTTPException(status_code=403, detail="You are not assigned to this lead")


# ── Call History ─────────────────────────────────────────────────────────────

@router.get("/leads/{lead_id}/calls")
def get_call_logs(lead_id: str, db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    manual = db.query(CallLog).filter(CallLog.lead_id == lead_id).order_by(CallLog.called_at.desc()).all()
    dialer = db.query(DialerCall).filter(DialerCall.lead_id == lead_id, DialerCall.status != "FAILED").order_by(DialerCall.created_at.desc()).all()

    combined = []
    for c in manual:
        combined.append({"id": c.id, "source": "manual", "provider": None, "lead_id": c.lead_id, "user_id": c.user_id, "user_name": c.user.name if c.user else "Unknown", "outcome": c.outcome if isinstance(c.outcome, str) else (c.outcome.value if c.outcome else None), "notes": c.notes, "direction": "outbound", "duration": 0, "phone_number": None, "recording_url": None, "status": None, "called_at": str(c.called_at) if c.called_at else None, "started_at": str(c.called_at) if c.called_at else None, "answered_at": None, "ended_at": None, "created_at": str(c.called_at) if c.called_at else None, "_sort_ts": c.called_at})
    for c in dialer:
        u = db.query(User).filter(User.id == c.user_id).first() if c.user_id else None
        ts = c.started_at or c.created_at
        combined.append({"id": c.id, "source": "dialer", "provider": c.provider, "lead_id": c.lead_id, "user_id": c.user_id, "user_name": u.name if u else "Unknown", "outcome": c.outcome, "notes": c.notes, "direction": c.direction or "outbound", "duration": c.duration or 0, "phone_number": c.phone_number, "recording_url": c.recording_url, "transcript": c.transcript, "status": c.status, "called_at": ts.isoformat() if ts else None, "started_at": c.started_at.isoformat() if c.started_at else None, "answered_at": c.answered_at.isoformat() if c.answered_at else None, "ended_at": c.ended_at.isoformat() if c.ended_at else None, "created_at": c.created_at.isoformat() if c.created_at else None, "_sort_ts": ts})

    combined.sort(key=lambda x: x.get("_sort_ts") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    for c in combined:
        c.pop("_sort_ts", None)

    total = len(combined)
    connected = sum(1 for c in combined if c.get("outcome") in ("Meeting Scheduled", "Meeting Confirmed", "Call Back Later", "Text Me", "Not the Right Person", "Referred Someone Else") or c.get("status") == "CALL_ANSWERED")
    total_dur = sum(c.get("duration", 0) for c in combined)
    return {"calls": combined, "stats": {"total": total, "connected": connected, "avg_duration": total_dur // total if total else 0, "last_called": combined[0].get("called_at") if combined else None}}


# ── Log Call ─────────────────────────────────────────────────────────────────

@router.post("/leads/{lead_id}/calls")
def log_call(lead_id: str, body: dict, bg_tasks: BackgroundTasks, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = _can_modify_lead(db, user, lead_id)
    settings = _get_settings(db)
    outcome_str = body.get("outcome", "")
    if outcome_str in LEGACY_OUTCOME_MAP:
        outcome_str = LEGACY_OUTCOME_MAP[outcome_str]
    if outcome_str not in [o.value for o in CallOutcome]:
        raise HTTPException(status_code=400, detail=f"Invalid outcome. Must be one of: {[o.value for o in CallOutcome]}")
    notes = body.get("notes", "").strip()
    if outcome_str in ("Meeting Confirmed", "Not Interested") and not notes:
        raise HTTPException(status_code=422, detail=f"Notes are mandatory when call outcome is '{outcome_str}'.")

    recent_cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    recent_dialer = db.query(DialerCall).filter(DialerCall.lead_id == lead_id, DialerCall.user_id == user["sub"], DialerCall.status != "FAILED", DialerCall.outcome.is_(None), DialerCall.created_at >= recent_cutoff).order_by(DialerCall.created_at.desc()).first()

    attached_to_dialer = False
    if recent_dialer:
        recent_dialer.outcome = outcome_str; recent_dialer.notes = notes
        attached_to_dialer = True; call = recent_dialer
    else:
        call = CallLog(lead_id=lead_id, user_id=user["sub"], outcome=CallOutcome(outcome_str), notes=notes)
        db.add(call)

    lead.last_call_timestamp = datetime.now(timezone.utc)
    if outcome_str in ATTEMPT_OUTCOMES:
        lead.call_attempt_count = (lead.call_attempt_count or 0) + 1

    db.commit(); db.refresh(call); db.refresh(lead)

    # Auto-status transition for Meeting Confirmed
    new_status = None
    if outcome_str == "Meeting Confirmed" and lead.status != "Meeting Scheduled":
        new_status = "Meeting Scheduled"
    if new_status:
        old_status = lead.status
        lead.status = new_status; lead.status_changed_at = datetime.now(timezone.utc)
        log_status_change(db, lead.id, old_status, new_status, user.get("name") or user.get("email", "unknown"))
        if new_status in TERMINAL_STATUSES:
            lead.lead_closed_at = datetime.now(timezone.utc); lead.closed_reason = new_status
        db.commit(); db.refresh(lead)

    try:
        from utils.activity_logger import log_activity
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        log_activity(user["sub"], "LOG_CALL", user_email=user.get("email"), user_name=user.get("name"), object_type="call", object_id=call.id, metadata={"lead_name": lead_name, "outcome": outcome_str})
    except Exception:
        pass

    max_attempts = settings.max_call_attempts or 5
    resp = {"call": {"id": call.id, "lead_id": call.lead_id, "user_id": call.user_id, "user_name": user.get("name", "Unknown"), "outcome": outcome_str, "notes": notes, "called_at": str(getattr(call, 'called_at', None) or getattr(call, 'started_at', None) or getattr(call, 'created_at', None)), "attached_to_dialer": attached_to_dialer}, "lead_status": lead.status, "call_attempt_count": lead.call_attempt_count or 0, "max_call_attempts": max_attempts, "max_attempts_reached": (lead.call_attempt_count or 0) >= max_attempts}
    return resp


# ── Close Lead ───────────────────────────────────────────────────────────────

@router.post("/leads/{lead_id}/close")
def close_lead(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = _can_modify_lead(db, user, lead_id)
    settings = _get_settings(db)
    reason = body.get("reason", "").strip()
    VALID = {"Customer Declined", "Unreachable", "Wrong Number", "Not Interested", "No Phone Number", "Other"}
    if reason not in VALID:
        raise HTTPException(status_code=400, detail=f"Invalid reason. Must be one of: {sorted(VALID)}")
    if lead.status != "Calling":
        raise HTTPException(status_code=422, detail=f"Lead must be in 'Calling' status. Current: {lead.status}")
    has_phone = bool((lead.phone or "").strip()) or bool((getattr(lead, 'phone_secondary', None) or "").strip())
    if reason == "No Phone Number" and has_phone:
        raise HTTPException(status_code=422, detail="Cannot use 'No Phone Number' — lead has a phone number.")
    skip_check = reason == "No Phone Number" and not has_phone
    if not skip_check:
        current = lead.call_attempt_count or 0
        max_att = settings.max_call_attempts or 5
        has_definitive = db.query(CallLog).filter(CallLog.lead_id == lead_id, CallLog.outcome.in_({"Wrong Number", "Not Interested", "Unreachable"})).first() is not None
        if current < max_att and not has_definitive:
            raise HTTPException(status_code=422, detail=f"Cannot close yet. Reach {max_att} attempts ({current} so far) or log a definitive outcome.")
    old = lead.status; lead.status = "Disqualified"; lead.status_changed_at = datetime.now(timezone.utc); lead.lead_closed_at = datetime.now(timezone.utc); lead.closed_reason = reason
    log_status_change(db, lead.id, old, "Disqualified", user.get("name") or user.get("email", "unknown"))
    db.commit()
    return {"message": f"Lead closed as Disqualified: {reason}", "lead_status": lead.status, "closed_reason": reason}


@router.delete("/leads/{lead_id}/calls/{call_id}")
def delete_call_log(lead_id: str, call_id: str, db: Session = Depends(get_db)):
    call = db.query(CallLog).filter(CallLog.id == call_id, CallLog.lead_id == lead_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call log not found")
    db.delete(call); db.commit()
    return {"ok": True}


# ── SDR Call Summary ─────────────────────────────────────────────────────────

@router.get("/sdr/call-summary")
def get_sdr_call_summary(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    today_start = datetime.combine(date.today(), datetime.min.time())
    db_user = db.query(User).filter(User.id == user["sub"]).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    assigned = db_user.assigned_leads
    all_calls = db.query(CallLog).filter(CallLog.user_id == user["sub"]).all()
    calls_today = [c for c in all_calls if c.called_at and c.called_at.replace(tzinfo=None) >= today_start]
    return {"total_assigned": len(assigned), "lead_assigned": len([l for l in assigned if l.status == "Lead Assigned"]), "calls_today": len(calls_today), "total_calls_ever": len(all_calls), "calling": len([l for l in assigned if l.status == "Calling"]), "callbacks_pending": len([l for l in assigned if l.status == "Calling"]), "meetings_scheduled": len([l for l in assigned if l.status == "Meeting Scheduled"]), "research_pending": len([l for l in assigned if l.status == "Research"]), "disqualified": len([l for l in assigned if l.status == "Disqualified"]), "outcomes_today": {o.value: len([c for c in calls_today if c.outcome == o]) for o in CallOutcome}}


# ── Leaderboard ──────────────────────────────────────────────────────────────

@router.get("/leaderboard")
def get_leaderboard(range: int = Query(0, ge=0, le=365), user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    today_start = datetime.combine(date.today(), datetime.min.time())
    cutoff = (datetime.now(timezone.utc) - timedelta(days=range)) if range > 0 else None
    sdrs = db.query(User).filter(User.role == "SDR").all()
    board = []
    for sdr in sdrs:
        calls_q = db.query(CallLog).filter(CallLog.user_id == sdr.id)
        if cutoff: calls_q = calls_q.filter(CallLog.called_at >= cutoff)
        all_calls = calls_q.all()
        calls_today = [c for c in all_calls if c.called_at and c.called_at.replace(tzinfo=None) >= today_start]
        assigned = sdr.assigned_leads
        if cutoff:
            cutoff_naive = cutoff.replace(tzinfo=None)
            assigned = [l for l in assigned if (l.status_changed_at or l.created_at) and (l.status_changed_at or l.created_at).replace(tzinfo=None) >= cutoff_naive]
        meetings = len([l for l in assigned if l.status == "Meeting Scheduled"])
        total = len(assigned)
        board.append({"id": sdr.id, "name": sdr.name or sdr.email, "email": sdr.email, "pod_name": sdr.pod.name if sdr.pod_id and sdr.pod else None, "calls_today": len(calls_today), "total_calls": len(all_calls), "meetings_scheduled": meetings, "disqualified": len([l for l in assigned if l.status == "Disqualified"]), "active_leads": len([l for l in assigned if l.status in ACTIVE_STATUSES]), "total_leads": total, "conversion_rate": round(meetings / total * 100, 1) if total else 0.0})
    board.sort(key=lambda x: (-x["meetings_scheduled"], -x["total_calls"]))
    for i, e in enumerate(board):
        e["rank"] = i + 1
    return board
