# ── routes/audit_routes.py — the permanent "who did what, when" trail (models.AuditEvent) ─────────────────────────────────
#   GET  /api/admin/audit-log      Super Admin only (category = one or several, comma separated): exports, changes to who may export, Salesforce mapping edits
#   POST /api/me/export-event      a screen that builds its CSV in the browser reports it here, so it is recorded too
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

import models
from auth import check_export_access, get_current_user, require_super_admin
from database import get_db
from services import audit

router = APIRouter(tags=["Audit"])
CATEGORIES = ("export", "export_access", "sf_mapping", "setting")


def _day(value, end=False):
    try:
        d = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Dates look like 2026-10-31.")
    return d + timedelta(days=1) if end else d


@router.get("/api/admin/audit-log")
def audit_log(category: str = "", q: str = "", date_from: str = "", date_to: str = "", page: int = 1, per_page: int = 25,
              admin: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    cats = [c for c in category.split(",") if c]
    if any(c not in CATEGORIES for c in cats):
        raise HTTPException(status_code=400, detail="Unknown category.")
    per_page = max(1, min(per_page, 100))
    query = db.query(models.AuditEvent)
    if cats:
        query = query.filter(models.AuditEvent.category.in_(cats))
    if date_from:
        query = query.filter(models.AuditEvent.created_at >= _day(date_from))
    if date_to:
        query = query.filter(models.AuditEvent.created_at < _day(date_to, end=True))
    if q.strip():
        like = f"%{q.strip().lower()}%"
        query = query.filter(or_(models.AuditEvent.actor_name.ilike(like), models.AuditEvent.actor_email.ilike(like), models.AuditEvent.summary.ilike(like)))
    total = query.count()
    rows = query.order_by(models.AuditEvent.created_at.desc(), models.AuditEvent.id).offset((max(page, 1) - 1) * per_page).limit(per_page).all()
    return {"items": [audit.row(e) for e in rows], "total": total, "page": max(page, 1), "per_page": per_page, "pages": max(1, -(-total // per_page))}


@router.post("/api/me/export-event")
def export_event(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """A CSV built in the browser (Activity Monitor, Replies, Dashboard): refused without export access, otherwise recorded."""
    what = str(body.get("what") or "CSV").strip()[:80] or "CSV"
    rows = body.get("rows")
    rows = rows if isinstance(rows, int) and 0 <= rows < 10_000_000 else None
    check_export_access(db, user, "/browser-csv", action="BROWSER_CSV", label=f"CSV built in the browser: {what}", rows=rows)
    return {"recorded": True}
