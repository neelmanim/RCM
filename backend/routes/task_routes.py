# ── routes/task_routes.py — Tasks CRUD + Notification endpoints ────────────────
import json
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, joinedload

import models
from database import get_db
from auth import get_current_user
from routes.lead_helpers import load_lead

router = APIRouter(prefix="/api", tags=["Tasks"])


def _lead_display_name(lead) -> str:
    """Same fallback used by every notification-style endpoint below
    (get_my_tasks, get_pending_tasks, get_pending_replies) — a lead can be
    None (deleted/reassigned out from under the task) or missing a name."""
    if not lead:
        return "Unknown"
    return f"{lead.first_name or ''} {lead.last_name or ''}".strip()


@router.get("/leads/{lead_id}/tasks")
def get_tasks(lead_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    load_lead(db, user, lead_id)
    return db.query(models.Task).filter(models.Task.lead_id == lead_id).order_by(models.Task.created_at.asc()).all()


@router.post("/leads/{lead_id}/tasks")
def add_task(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    load_lead(db, user, lead_id, edit=True)
    # Parse optional due_time (ISO 8601 string)
    due_time = None
    if body.get("due_time"):
        try:
            due_time = datetime.fromisoformat(body["due_time"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            pass
    task = models.Task(
        lead_id=lead_id,
        user_id=user.get("sub"),
        title=body.get("title", ""),
        due_date=body.get("due_date"),
        due_time=due_time,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


_APPROVAL_CHANNELS = {"email_approval": "email", "sms_approval": "sms"}


def _preflight_approval(db, task):
    """Refuse a manual-draft approval that would certainly fail to send (e.g.
    no connected mailbox) — 409, task left open, draft kept — instead of
    closing the task and failing the enrollment after the rep clicked Send."""
    from journey_engine.channels import get_channel_provider
    enrollment = db.query(models.JourneyEnrollment).get(task.journey_enrollment_id)
    if not enrollment or enrollment.status != "active":
        return   # cadence already ended — approving is a no-op, nothing to check
    journey = db.query(models.Journey).get(enrollment.journey_id)
    lead = db.query(models.Lead).get(task.lead_id)
    err = get_channel_provider(_APPROVAL_CHANNELS[task.kind]).preflight(db, lead, journey)
    if err:
        raise HTTPException(status_code=409, detail=f"Can't send yet: {err}. Your draft is kept — fix this, then send again.")


@router.patch("/leads/{lead_id}/tasks/{task_id}")
def toggle_task(lead_id: str, task_id: str, body: dict, db: Session = Depends(get_db),
                user: dict = Depends(get_current_user)):
    load_lead(db, user, lead_id, edit=True)
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.lead_id == lead_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if body.get("done") and task.done != "true" and task.kind in _APPROVAL_CHANNELS and task.journey_enrollment_id:
        _preflight_approval(db, task)
    task.done = "true" if body.get("done") else "false"
    outcome = body.get("outcome")
    if outcome is not None:
        # A cadence manual step's outcome must be one it offers (e.g. accepted /
        # not_accepted) — it's what the journey branches on.
        allowed = {o.get("key") for o in json.loads(task.outcome_options or "[]")}
        if outcome not in allowed:
            raise HTTPException(status_code=422, detail=f"Outcome must be one of: {', '.join(sorted(allowed)) or 'none'}")
        task.outcome, task.done = outcome, "true"
    db.commit()
    if task.done == "true" and task.journey_enrollment_id:
        if task.kind == "email_approval":
            # v13.1.0 (Viren's request): approving a manual cadence email —
            # body.subject/body are the rep's edits (None = send the parked
            # draft as-is). The actual send + fresh eligibility re-check
            # happen inside the engine, not here.
            from journey_engine.engine import complete_manual_email_step
            complete_manual_email_step(db, task, subject=body.get("subject"), body=body.get("body"))
        elif task.kind == "sms_approval":
            from journey_engine.engine import complete_manual_sms_step
            complete_manual_sms_step(db, task, message=body.get("message"))
        else:
            from journey_engine.engine import complete_manual_step
            complete_manual_step(db, task)   # advances the cadence now, instead of at the step's deadline
    db.refresh(task)
    return task


@router.post("/leads/{lead_id}/tasks/{task_id}/skip")
def skip_task(lead_id: str, task_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """v13.7.0 "Skip this step" for a cadence task or approval: closes it and
    moves the lead on along the step's no-response path, sending nothing."""
    load_lead(db, user, lead_id, edit=True)
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.lead_id == lead_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not task.journey_enrollment_id:
        raise HTTPException(status_code=400, detail="Only a cadence step can be skipped — this is a regular task.")
    if task.done == "true":
        raise HTTPException(status_code=409, detail="This step is already done.")
    from journey_engine.engine import skip_manual_step
    skip_manual_step(db, task)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/leads/{lead_id}/tasks/{task_id}")
def delete_task(lead_id: str, task_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    load_lead(db, user, lead_id, edit=True)
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.lead_id == lead_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.journey_enrollment_id and task.done != "true":
        # Deleting it left the cadence parked on a task that no longer existed.
        raise HTTPException(status_code=409, detail="This step belongs to a cadence — use \"Skip this step\" so the lead moves on.")
    db.delete(task)
    db.commit()
    return {"ok": True}


# ── Notification endpoints ─────────────────────────────────────────────────────

@router.get("/my/tasks")
def get_my_tasks(status: str = "open", user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """The full "My Tasks" list — every task assigned to me across every
    lead, not just the ones due right now (that's /my/tasks/pending, the
    notification-bell feed). `status`: "open" (default, not done) | "done" |
    "all". Sorted overdue/soonest-due first; tasks with no due_time (set via
    the lead detail Tasks panel without a date) sort last, oldest-created
    first within that group — same "is-null last" ordering used for open
    call scripts in lead_helpers.py's _batch_open_call_scripts."""
    query = db.query(models.Task).options(joinedload(models.Task.lead)).filter(models.Task.user_id == user["sub"])
    if status == "open":
        query = query.filter(models.Task.done != "true")
    elif status == "done":
        query = query.filter(models.Task.done == "true")
    elif status != "all":
        raise HTTPException(status_code=400, detail="status must be 'open', 'done', or 'all'")

    tasks = query.order_by(
        models.Task.due_time.is_(None), models.Task.due_time.asc(), models.Task.created_at.asc()
    ).limit(200).all()

    return [
        {
            "id": t.id,
            "title": t.title,
            "done": t.done == "true",
            "due_date": t.due_date,
            "due_time": t.due_time.isoformat() if t.due_time else None,
            "snoozed_until": t.snoozed_until.isoformat() if t.snoozed_until else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "lead_id": t.lead_id,
            "lead_name": _lead_display_name(t.lead),
            "lead_company": t.lead.company if t.lead else None,
            # Cadence manual steps: the instructions/message and the outcomes
            # the rep picks from (engine.complete_manual_step branches on it).
            "description": t.description,
            "outcome_options": json.loads(t.outcome_options) if t.outcome_options else [],
            "outcome": t.outcome,
            "from_cadence": bool(t.journey_enrollment_id),
            # v13.1.0: kind="email_approval"/"sms_approval" (Viren's manual-send
            # steps) — the rep reviews/edits this draft and sends instead of
            # picking an outcome.
            "kind": t.kind,
            "draft_subject": t.draft_subject,
            "draft_body": t.draft_body,
            "draft_body_format": t.draft_body_format,
        }
        for t in tasks
    ]


@router.get("/my/tasks/pending")
def get_pending_tasks(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return tasks for current user that are due and not yet dismissed/done.

    RCA-2026-05-29: Wrapped in OperationalError guard — Render Postgres can briefly
    refuse TCP connections under burst load (psycopg2.OperationalError at socket level).
    Return 503 + Retry-After so the frontend silently retries instead of logging a 500.
    """
    now = datetime.now(timezone.utc)
    try:
        tasks = (
            db.query(models.Task)
            .options(joinedload(models.Task.lead))
            .filter(
                models.Task.user_id == user["sub"],
                models.Task.done != "true",
                models.Task.dismissed != "true",
                # Reminders once they're due; an approval as soon as it exists
                # (the cadence is waiting on the rep right now).
                ((models.Task.due_time != None) & (models.Task.due_time <= now))
                | models.Task.kind.in_(list(_APPROVAL_CHANNELS)),
            )
            .filter(
                (models.Task.snoozed_until == None) | (models.Task.snoozed_until <= now)
            )
            .order_by(models.Task.due_time.asc())
            .limit(50)
            .all()
        )
    except OperationalError:
        # Transient DB connect failure (e.g. Render Postgres TCP timeout under burst).
        # Return 503 so the frontend can silently retry — do NOT surface as a 500.
        raise HTTPException(
            status_code=503,
            detail="Task reminders temporarily unavailable — please retry in a moment.",
            headers={"Retry-After": "5"},
        )
    result = []
    for t in tasks:
        lead = t.lead
        result.append({
            "id": t.id,
            "title": t.title,
            "due_time": t.due_time.isoformat() if t.due_time else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "lead_id": t.lead_id,
            "lead_name": _lead_display_name(lead),
            "lead_company": lead.company if lead else None,
            "lead_phone": lead.phone if lead else None,
            "kind": t.kind,
            "from_cadence": bool(t.journey_enrollment_id),
        })
    return result


@router.patch("/my/tasks/{task_id}/snooze")
def snooze_task(task_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Snooze a task for N minutes (bell: 5/15/30/60), or until a given time
    (My Tasks: "Tomorrow" / a picked date — body.until, ISO 8601, within 90 days)."""
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.user_id == user["sub"]).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    now = datetime.now(timezone.utc)
    if body.get("until"):
        try:
            until = datetime.fromisoformat(str(body["until"]).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=422, detail="until must be an ISO 8601 date-time")
        until = until if until.tzinfo else until.replace(tzinfo=timezone.utc)
        if not now < until <= now + timedelta(days=90):
            raise HTTPException(status_code=422, detail="Snooze to a time in the next 90 days")
        task.snoozed_until = until
    else:
        minutes = int(body.get("minutes", 15))
        if minutes not in (5, 15, 30, 60):
            minutes = 15
        task.snoozed_until = now + timedelta(minutes=minutes)
    db.commit()
    db.refresh(task)
    return {"ok": True, "snoozed_until": str(task.snoozed_until)}


@router.patch("/my/tasks/{task_id}/dismiss")
def dismiss_task(task_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Dismiss a task notification (stops it from appearing, but task remains)."""
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.user_id == user["sub"]).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.dismissed = "true"
    db.commit()
    return {"ok": True}


@router.get("/my/replies/pending")
def get_pending_replies(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Unread prospect replies on leads assigned to the current user — feeds
    the same notification bell as task reminders (no other signal exists
    today for an inbound reply, see docs/RELEASES.md v11.3.0)."""
    try:
        activities = (
            db.query(models.LeadEmailActivity)
            .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.LeadEmailActivity.lead_id)
            .options(joinedload(models.LeadEmailActivity.lead))
            .filter(
                models.lead_assignments.c.user_id == user["sub"],
                models.LeadEmailActivity.direction == "inbound",
                models.LeadEmailActivity.is_auto_reply.isnot(True),
                models.LeadEmailActivity.read_at.is_(None),
            )
            .order_by(models.LeadEmailActivity.timestamp.desc())
            .limit(50)
            .all()
        )
    except OperationalError:
        raise HTTPException(
            status_code=503,
            detail="Reply notifications temporarily unavailable — please retry in a moment.",
            headers={"Retry-After": "5"},
        )
    result = []
    for a in activities:
        lead = a.lead
        result.append({
            "id": a.id,
            "title": a.subject or "(no subject)",
            "due_time": str(a.timestamp) if a.timestamp else None,
            "lead_id": a.lead_id,
            "lead_name": _lead_display_name(lead),
            "lead_company": lead.company if lead else None,
        })
    return result


@router.patch("/my/replies/{activity_id}/dismiss")
def dismiss_reply(activity_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mark a reply notification read — does not touch the underlying email activity record."""
    activity = (
        db.query(models.LeadEmailActivity)
        .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.LeadEmailActivity.lead_id)
        .filter(
            models.LeadEmailActivity.id == activity_id,
            models.lead_assignments.c.user_id == user["sub"],
        )
        .first()
    )
    if not activity:
        raise HTTPException(status_code=404, detail="Reply not found")
    activity.read_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}

