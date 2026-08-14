"""
error_log_routes.py — Error Logs API

GET  /api/admin/error-logs          — Paginated list (role-scoped)
GET  /api/admin/error-logs/summary  — Unresolved count by severity (badge)
POST /api/admin/error-logs          — Ingest frontend errors (authenticated users)
PATCH /api/admin/error-logs/{id}/resolve — Mark resolved (Admin+ only)

Access control:
  - SDR: own errors only (filtered by user_id)
  - Pod Admin: their pod members' errors
  - Super Admin / Admin: all errors
  - Frontend POST: any authenticated user (rate-limited by error_logger)
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

import models
from database import get_db
from routes.auth_routes import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["error-logs"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ErrorLogIngest(BaseModel):
    """Payload sent by the frontend error reporter."""
    severity: str = "warning"          # "critical" | "warning" | "info"
    category: str = "general"          # "api" | "research" | "dialer" | "upload" | "auth" | "general"
    feature: Optional[str] = None      # "Lead Detail" | "Dialer" | etc.
    title: str
    description: Optional[str] = None
    action_hint: Optional[str] = None
    http_status: Optional[int] = None
    endpoint: Optional[str] = None
    raw_error: Optional[str] = None    # JS error message (stripped by reporter)
    context_json: Optional[str] = None # JSON string of extra context


class ResolvePayload(BaseModel):
    resolver_name: str = "Admin"


# ── Helper: role-scoped query ─────────────────────────────────────────────────

def _scoped_query(db: Session, current_user: dict):
    """Return a base query pre-filtered by the user's access level."""
    q = db.query(models.ErrorLog)
    role = (current_user.get("role") or "").lower()
    if role in ("sdr", "ae"):
        q = q.filter(models.ErrorLog.user_id == current_user["sub"])
    elif role in ("pod_admin", "pod admin"):
        # Pod Admin sees errors from their own pod members
        user_db = db.query(models.User).filter(models.User.id == current_user["sub"]).first()
        if user_db and user_db.pod_id:
            pod_member_ids = [
                u.id for u in db.query(models.User).filter(models.User.pod_id == user_db.pod_id).all()
            ]
            q = q.filter(models.ErrorLog.user_id.in_(pod_member_ids))
        else:
            q = q.filter(models.ErrorLog.user_id == current_user["sub"])
    # Super Admin / Admin: no filter — see everything
    return q


# ── GET /api/admin/error-logs/summary ─────────────────────────────────────────

@router.get("/error-logs/summary")
def get_error_log_summary(
    hours: Optional[int] = Query(None, ge=1, le=720),  # e.g. hours=24 for last 24h
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Returns unresolved error counts by severity.
    - hours=24  → only errors from the last 24 hours (for dashboard strip)
    - hours omitted → all unresolved errors (for Audit Logs badge)
    """
    try:
        q = _scoped_query(db, current_user).filter(models.ErrorLog.resolved == False)
        if hours is not None:
            from datetime import timedelta
            cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
            q = q.filter(models.ErrorLog.created_at >= cutoff)
        total     = q.count()
        critical  = q.filter(models.ErrorLog.severity == "critical").count()
        warning   = q.filter(models.ErrorLog.severity == "warning").count()
        info      = q.filter(models.ErrorLog.severity == "info").count()
        return {
            "total": total,
            "critical": critical,
            "warning": warning,
            "info": info,
        }
    except Exception as e:
        logger.error(f"[ErrorLogRoutes] summary error: {e}")
        return {"total": 0, "critical": 0, "warning": 0, "info": 0}


# ── GET /api/admin/error-logs ─────────────────────────────────────────────────

@router.get("/error-logs")
def list_error_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    severity: Optional[str] = Query(None),          # "critical" | "warning" | "info"
    source: Optional[str] = Query(None),             # "frontend" | "backend"
    category: Optional[str] = Query(None),
    resolved: Optional[bool] = Query(False),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Paginated error log list with filters, role-scoped by access level."""
    try:
        q = _scoped_query(db, current_user)

        if severity:
            q = q.filter(models.ErrorLog.severity == severity)
        if source:
            q = q.filter(models.ErrorLog.source == source)
        if category:
            q = q.filter(models.ErrorLog.category == category)
        if resolved is not None:
            q = q.filter(models.ErrorLog.resolved == resolved)
        if search:
            like = f"%{search}%"
            q = q.filter(
                models.ErrorLog.title.ilike(like) |
                models.ErrorLog.description.ilike(like) |
                models.ErrorLog.user_name.ilike(like) |
                models.ErrorLog.feature.ilike(like)
            )

        total = q.count()
        pages = max(1, (total + per_page - 1) // per_page)
        items = q.order_by(desc(models.ErrorLog.created_at)).offset((page - 1) * per_page).limit(per_page).all()

        is_super = (current_user.get("role") or "").lower() in ("super_admin", "super admin", "admin")

        return {
            "total": total,
            "pages": pages,
            "page": page,
            "items": [_serialize(e, show_raw=is_super) for e in items],
        }
    except Exception as e:
        logger.error(f"[ErrorLogRoutes] list error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch error logs")


# ── POST /api/admin/error-logs ────────────────────────────────────────────────

@router.post("/error-logs", status_code=201)
def ingest_frontend_error(
    payload: ErrorLogIngest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Frontend error reporter POSTs here.
    Any authenticated user can write. Rate limiting is handled by error_logger.
    localhost origin is rejected (no dev pollution in prod logs).
    """
    try:
        from error_logger import log_error
        log_error(
            db=db,
            severity=payload.severity,
            source="frontend",
            category=payload.category,
            feature=payload.feature,
            title=payload.title,
            description=payload.description,
            action_hint=payload.action_hint,
            http_status=payload.http_status,
            endpoint=payload.endpoint,
            raw_error=payload.raw_error,
            context_json=payload.context_json,
            user_id=current_user.get("sub"),
            user_email=current_user.get("email"),
            user_name=current_user.get("name"),
            user_role=current_user.get("role"),
        )
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"[ErrorLogRoutes] ingest error: {e}")
        return {"status": "ok"}  # Always return 200 — don't error on error logging


# ── PATCH /api/admin/error-logs/{id}/resolve ──────────────────────────────────

@router.patch("/error-logs/{error_id}/resolve")
def resolve_error_log(
    error_id: str,
    payload: ResolvePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Mark an error log as resolved. Admin/Pod Admin only. Idempotent."""
    role = (current_user.get("role") or "").lower()
    if role in ("sdr", "ae"):
        raise HTTPException(status_code=403, detail="SDRs and AEs cannot resolve error logs")

    entry = db.query(models.ErrorLog).filter(models.ErrorLog.id == error_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Error log not found")

    # Idempotent: already resolved → just return success
    if not entry.resolved:
        entry.resolved = True
        entry.resolved_by = payload.resolver_name or current_user.get("name") or current_user.get("email")
        entry.resolved_at = datetime.now(timezone.utc)
        db.commit()

    return {"status": "resolved", "id": error_id}


# ── Serialiser ────────────────────────────────────────────────────────────────

def _serialize(e: models.ErrorLog, show_raw: bool = False) -> dict:
    """Convert an ErrorLog row to the dict the frontend expects."""
    data = {
        "id": e.id,
        "severity": e.severity,
        "source": e.source,
        "category": e.category,
        "feature": e.feature,
        "title": e.title,
        "description": e.description,
        "action_hint": e.action_hint,
        "http_status": e.http_status,
        "endpoint": e.endpoint,
        "user_name": e.user_name,
        "user_email": e.user_email,
        "user_role": e.user_role,
        "dedup_count": e.dedup_count or 1,
        "resolved": e.resolved,
        "resolved_by": e.resolved_by,
        "resolved_at": e.resolved_at.isoformat() if e.resolved_at else None,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "last_seen_at": e.last_seen_at.isoformat() if e.last_seen_at else None,
    }
    # Only Super Admins see raw technical details
    if show_raw:
        data["raw_error"] = e.raw_error
        data["context_json"] = e.context_json
    return data
