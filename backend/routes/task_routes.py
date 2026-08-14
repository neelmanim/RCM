# ── routes/task_routes.py — Tasks CRUD + Notification endpoints ────────────────
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, joinedload

import models
from database import get_db
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["Tasks"])


@router.get("/leads/{lead_id}/tasks")
def get_tasks(lead_id: str, db: Session = Depends(get_db)):
    return db.query(models.Task).filter(models.Task.lead_id == lead_id).order_by(models.Task.created_at.asc()).all()


@router.post("/leads/{lead_id}/tasks")
def add_task(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
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


@router.patch("/leads/{lead_id}/tasks/{task_id}")
def toggle_task(lead_id: str, task_id: str, body: dict, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.lead_id == lead_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.done = "true" if body.get("done") else "false"
    db.commit()
    db.refresh(task)
    return task


@router.delete("/leads/{lead_id}/tasks/{task_id}")
def delete_task(lead_id: str, task_id: str, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.lead_id == lead_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}


# ── Notification endpoints ─────────────────────────────────────────────────────

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
                models.Task.due_time != None,
                models.Task.due_time <= now,
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
            "due_time": str(t.due_time) if t.due_time else None,
            "created_at": str(t.created_at) if t.created_at else None,
            "lead_id": t.lead_id,
            "lead_name": f"{lead.first_name or ''} {lead.last_name or ''}".strip() if lead else "Unknown",
            "lead_company": lead.company if lead else None,
            "lead_phone": lead.phone if lead else None,
        })
    return result


@router.patch("/my/tasks/{task_id}/snooze")
def snooze_task(task_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Snooze a task for N minutes."""
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.user_id == user["sub"]).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    minutes = int(body.get("minutes", 15))
    if minutes not in (5, 15, 30, 60):
        minutes = 15
    task.snoozed_until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
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

