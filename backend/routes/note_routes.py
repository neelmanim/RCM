# ── routes/note_routes.py — Notes CRUD ─────────────────────────────────────────
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import get_current_user
from routes.lead_helpers import load_lead

router = APIRouter(prefix="/api", tags=["Notes"])


@router.get("/leads/{lead_id}/notes")
def get_notes(lead_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    load_lead(db, user, lead_id)
    return db.query(models.Note).filter(models.Note.lead_id == lead_id).order_by(models.Note.created_at.desc()).all()


@router.post("/leads/{lead_id}/notes")
def add_note(lead_id: str, body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    load_lead(db, user, lead_id, edit=True)
    # Author is who is logged in, not whatever the client sends.
    note = models.Note(lead_id=lead_id, content=body.get("content", ""),
                       author=user.get("name") or user.get("email") or body.get("author", "You"))
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.delete("/leads/{lead_id}/notes/{note_id}")
def delete_note(lead_id: str, note_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    load_lead(db, user, lead_id, edit=True)
    note = db.query(models.Note).filter(models.Note.id == note_id, models.Note.lead_id == lead_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return {"ok": True}
