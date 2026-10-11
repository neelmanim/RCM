# ── routes/saved_view_routes.py — a person's saved views ─────────────────────
# Strictly the caller's own rows (user_id comes from the token, never the URL/body). Two kinds, kept apart by `scope`:
#   leads  — a Leads page filter set (filters + keys = the filter names)
#   digest — a Team Digest view: keys = the KPI tiles to show, in order; filters = {"period": <preset>} (optional)
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

import models
from auth import get_current_user
from database import get_db
from services import digest_metrics

router = APIRouter(prefix="/api/me/saved-views", tags=["Saved Views"])
MAX_VIEWS = 30
SCOPES = ("leads", "digest")
SHARE_ROLES = ("Super Admin", "Admin", "Pod Admin")      # who may share a Digest view with the whole team
DIGEST_PERIODS = ("yesterday", "last7", "last_week", "last30", "this_month", "last_month")


def _scope(value):
    value = value or "leads"
    if value not in SCOPES:
        raise HTTPException(status_code=400, detail="Unknown view type.")
    return value


def _row(v, user=None):
    return {"id": v.id, "name": v.name, "filters": v.filters or {}, "keys": v.keys or [], "search": v.search or "", "scope": v.scope or "leads",
            "shared": bool(v.shared), "mine": user is None or v.user_id == user["sub"]}


def _mine(db, user, scope):
    # rows from before `scope` existed were migrated to "leads"
    return db.query(models.SavedView).filter(models.SavedView.user_id == user["sub"], models.SavedView.scope == scope)


@router.get("")
def list_views(scope: str = "leads", user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    scope = _scope(scope)
    q = _mine(db, user, scope)
    if scope == "digest":      # plus the ones an admin shared with the team
        q = db.query(models.SavedView).filter(models.SavedView.scope == "digest",
                                              or_(models.SavedView.user_id == user["sub"], models.SavedView.shared.is_(True)))
    return {"views": [_row(v, user) for v in q.order_by(models.SavedView.created_at.asc(), models.SavedView.id.asc()).all()]}


@router.post("")
def create_view(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    scope = _scope(body.get("scope"))
    name = (body.get("name") or "").strip()[:60]
    filters, keys = body.get("filters"), body.get("keys")
    if not name:
        raise HTTPException(status_code=400, detail="Give the view a name.")
    if scope == "digest":
        filters = filters if isinstance(filters, dict) else {}
        if not isinstance(keys, list) or not keys:
            raise HTTPException(status_code=400, detail="Pick at least one number for the view.")
        if len(set(keys)) != len(keys) or any(k not in digest_metrics.KEYS for k in keys):
            raise HTTPException(status_code=400, detail="That view has a number the Digest doesn't have.")
        if filters.get("period") not in (None, *DIGEST_PERIODS):
            raise HTTPException(status_code=400, detail="Unknown period.")
        filters = {"period": filters["period"]} if filters.get("period") else {}
    elif not isinstance(filters, dict) or not isinstance(keys, list) or not keys:
        raise HTTPException(status_code=400, detail="Add at least one filter before saving a view.")
    shared = bool(body.get("shared")) and scope == "digest"
    if shared and user.get("role") not in SHARE_ROLES:
        raise HTTPException(status_code=403, detail="Only an admin can share a view with the team.")
    mine = _mine(db, user, scope)
    if mine.count() >= MAX_VIEWS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_VIEWS} saved views — remove one first.")
    if mine.filter(models.SavedView.name == name).first():
        raise HTTPException(status_code=409, detail=f'You already have a view called "{name}".')
    v = models.SavedView(user_id=user["sub"], name=name, filters=filters, keys=keys, scope=scope, shared=shared,
                         search=(body.get("search") or "")[:200] or None)
    db.add(v)
    db.commit()
    db.refresh(v)
    return _row(v, user)


@router.delete("/{view_id}")
def delete_view(view_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    v = db.query(models.SavedView).filter(models.SavedView.id == view_id).first()
    # your own, or (a Super Admin) any shared one; someone else's private view looks like it does not exist
    if not v or (v.user_id != user["sub"] and not (v.shared and user.get("role") in ("Super Admin", "Admin"))):
        raise HTTPException(status_code=404, detail="View not found")
    db.delete(v)
    db.commit()
    return {"message": "View removed"}
