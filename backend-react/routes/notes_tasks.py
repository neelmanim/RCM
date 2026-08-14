"""Notes, Tasks, and Search routes."""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from database import get_db
from middleware import get_current_user
from models import Lead, Note, Task, User, lead_assignments
from services.lead_service import lead_to_dict

router = APIRouter(prefix="/api", tags=["Notes & Tasks"])


# ── Notes ────────────────────────────────────────────────────────────────────

@router.get("/leads/{lead_id}/notes")
def get_notes(lead_id: str, db: Session = Depends(get_db)):
    return db.query(Note).filter(Note.lead_id == lead_id).order_by(Note.created_at.desc()).all()

@router.post("/leads/{lead_id}/notes")
def add_note(lead_id: str, body: dict, db: Session = Depends(get_db)):
    if not db.query(Lead).filter(Lead.id == lead_id).first():
        raise HTTPException(status_code=404, detail="Lead not found")
    note = Note(lead_id=lead_id, content=body.get("content", ""), author=body.get("author", "You"))
    db.add(note); db.commit(); db.refresh(note)
    return note

@router.delete("/leads/{lead_id}/notes/{note_id}")
def delete_note(lead_id: str, note_id: str, db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id, Note.lead_id == lead_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note); db.commit()
    return {"ok": True}


# ── Tasks ────────────────────────────────────────────────────────────────────

@router.get("/leads/{lead_id}/tasks")
def get_tasks(lead_id: str, db: Session = Depends(get_db)):
    return db.query(Task).filter(Task.lead_id == lead_id).order_by(Task.created_at.asc()).all()

@router.post("/leads/{lead_id}/tasks")
def add_task(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    if not db.query(Lead).filter(Lead.id == lead_id).first():
        raise HTTPException(status_code=404, detail="Lead not found")
    due_time = None
    if body.get("due_time"):
        try: due_time = datetime.fromisoformat(body["due_time"].replace("Z", "+00:00"))
        except (ValueError, AttributeError): pass
    task = Task(lead_id=lead_id, user_id=user.get("sub"), title=body.get("title", ""), due_date=body.get("due_date"), due_time=due_time)
    db.add(task); db.commit(); db.refresh(task)
    return task

@router.patch("/leads/{lead_id}/tasks/{task_id}")
def toggle_task(lead_id: str, task_id: str, body: dict, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.lead_id == lead_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.done = "true" if body.get("done") else "false"
    db.commit(); db.refresh(task)
    return task

@router.delete("/leads/{lead_id}/tasks/{task_id}")
def delete_task(lead_id: str, task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.lead_id == lead_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task); db.commit()
    return {"ok": True}


# ── Task Notifications ──────────────────────────────────────────────────────

@router.get("/my/tasks/pending")
def get_pending_tasks(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    tasks = db.query(Task).options(joinedload(Task.lead)).filter(
        Task.user_id == user["sub"], Task.done != "true", Task.dismissed != "true",
        Task.due_time != None, Task.due_time <= now,
    ).filter((Task.snoozed_until == None) | (Task.snoozed_until <= now)).order_by(Task.due_time.asc()).limit(50).all()
    return [{"id": t.id, "title": t.title, "due_time": str(t.due_time) if t.due_time else None, "created_at": str(t.created_at) if t.created_at else None, "lead_id": t.lead_id, "lead_name": f"{t.lead.first_name or ''} {t.lead.last_name or ''}".strip() if t.lead else "Unknown", "lead_company": t.lead.company if t.lead else None, "lead_phone": t.lead.phone if t.lead else None} for t in tasks]

@router.patch("/my/tasks/{task_id}/snooze")
def snooze_task(task_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user["sub"]).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    minutes = int(body.get("minutes", 15))
    if minutes not in (5, 15, 30, 60): minutes = 15
    task.snoozed_until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    db.commit()
    return {"ok": True, "snoozed_until": str(task.snoozed_until)}

@router.patch("/my/tasks/{task_id}/dismiss")
def dismiss_task(task_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user["sub"]).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.dismissed = "true"; db.commit()
    return {"ok": True}


# ── Search ───────────────────────────────────────────────────────────────────

@router.get("/search")
def global_search(q: str = Query(...), user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    q_filter = f"%{q}%"
    role = user.get("role")
    is_admin = role in ("Super Admin", "Pod Admin")
    if is_admin:
        leads_q = db.query(Lead).filter((Lead.first_name.ilike(q_filter)) | (Lead.last_name.ilike(q_filter)) | (Lead.email.ilike(q_filter)) | (Lead.company.ilike(q_filter))).limit(10).all()
        users_q = db.query(User).filter((User.name.ilike(q_filter)) | (User.email.ilike(q_filter))).limit(5).all()
        user_results = [{"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in users_q]
    else:
        assigned_ids = db.query(lead_assignments.c.lead_id).filter(lead_assignments.c.user_id == user.get("sub")).subquery()
        leads_q = db.query(Lead).filter(Lead.id.in_(assigned_ids), (Lead.first_name.ilike(q_filter)) | (Lead.last_name.ilike(q_filter)) | (Lead.email.ilike(q_filter)) | (Lead.company.ilike(q_filter))).limit(10).all()
        user_results = []
    return {"leads": [lead_to_dict(l) for l in leads_q], "users": user_results}
