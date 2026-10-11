# ── routes/tag_routes.py — Lead tags (Leads redesign) ──────────────────────────
# A tag is independent of any single upload batch: it can span multiple imports
# over time, and a lead can carry more than one. Applied at upload time (see
# admin_upload_routes.py's `tags` body field) or attached/detached afterward here.
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import get_current_user, require_admin
from routes.lead_helpers import load_lead

router = APIRouter(prefix="/api", tags=["Tags"])


@router.get("/tags")
def list_tags(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """All tags in use, for the Tag filter's multi-select options."""
    tags = db.query(models.Tag).order_by(models.Tag.name.asc()).all()
    return {"tags": [{"id": t.id, "name": t.name} for t in tags]}


@router.post("/tags")
def create_tag(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Create-on-use — matches how the upload flow and filter both behave."""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    tag = db.query(models.Tag).filter(models.Tag.name == name).first()
    if not tag:
        tag = models.Tag(name=name)
        db.add(tag)
        db.commit()
        db.refresh(tag)
    return {"id": tag.id, "name": tag.name}


@router.post("/leads/{lead_id}/tags/{tag_id}")
def attach_tag(lead_id: str, tag_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    lead = load_lead(db, admin, lead_id, edit=True)  # Pod Admin: own pod's leads only
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if tag not in lead.tags:
        lead.tags.append(tag)
        models.record_lead_history(db, lead.id, "tags", None, tag.name, admin.get("name") or admin.get("email"))
        db.commit()
    return {"message": "Tag attached", "tags": [{"id": t.id, "name": t.name} for t in lead.tags]}


@router.delete("/leads/{lead_id}/tags/{tag_id}")
def detach_tag(lead_id: str, tag_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    lead = load_lead(db, admin, lead_id, edit=True)  # Pod Admin: own pod's leads only
    removed = [t for t in lead.tags if t.id == tag_id]
    lead.tags = [t for t in lead.tags if t.id != tag_id]
    for t in removed:
        models.record_lead_history(db, lead.id, "tags", t.name, None, admin.get("name") or admin.get("email"))
    db.commit()
    return {"message": "Tag detached", "tags": [{"id": t.id, "name": t.name} for t in lead.tags]}
