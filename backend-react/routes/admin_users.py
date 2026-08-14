"""Admin routes — User management, access control, login logs, feedback, impersonation."""
import os, json, csv, io
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import get_db
from middleware import get_current_user, require_admin, require_super_admin, create_jwt
from models import (
    User, AllowedUser, Pod, LoginLog, Feedback, UserActivityLog,
    lead_assignments, ACTIVE_STATUSES,
)
from services.auth_service import (
    add_allowed_user, remove_allowed_user, is_user_allowed,
    get_allowed_user, process_csv,
)
from utils.activity_logger import log_activity

router = APIRouter(prefix="/api/admin", tags=["Admin"])


def _get_active_lead_cap(db, user):
    from models import SyncSettings
    if user.pod_id:
        pod = user.pod if user.pod else db.query(Pod).filter(Pod.id == user.pod_id).first()
        if pod and pod.active_lead_cap is not None:
            return pod.active_lead_cap
    settings = db.query(SyncSettings).filter(SyncSettings.id == 1).first()
    return settings.active_lead_cap if settings and settings.active_lead_cap is not None else 500


def _active_lead_count(user):
    return len([l for l in user.assigned_leads if l.status in ACTIVE_STATUSES])


# ── User CRUD ────────────────────────────────────────────────────────────────

@router.get("/users")
def list_users(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    role = admin.get("role")
    if role == "Pod Admin":
        admin_user = db.query(User).filter(User.id == admin["sub"]).first()
        if admin_user and admin_user.pod_id:
            users = db.query(User).filter(User.pod_id == admin_user.pod_id).all()
        else:
            users = [admin_user] if admin_user else []
    else:
        users = db.query(User).all()

    stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    stale_sessions = db.query(LoginLog).filter(LoginLog.logout_at == None, LoginLog.login_at < stale_cutoff).all()
    for s in stale_sessions:
        s.logout_at = (s.last_heartbeat_at + timedelta(minutes=5)) if s.last_heartbeat_at else (s.login_at + timedelta(minutes=30))
    if stale_sessions:
        db.commit()

    last_heartbeat_q = db.query(LoginLog.user_id, func.max(func.coalesce(LoginLog.last_heartbeat_at, LoginLog.login_at)).label("last_seen")).group_by(LoginLog.user_id).all()
    heartbeat_map = {r.user_id: r.last_seen for r in last_heartbeat_q}
    last_action_q = db.query(UserActivityLog.user_id, func.max(UserActivityLog.created_at).label("last_action")).filter(UserActivityLog.action_type != "LOGIN").group_by(UserActivityLog.user_id).all()
    action_map = {r.user_id: r.last_action for r in last_action_q}

    result = []
    for u in users:
        pod_info = {"id": u.pod.id, "name": u.pod.name} if u.pod_id and u.pod else None
        cap = _get_active_lead_cap(db, u)
        candidates = [v for v in [heartbeat_map.get(u.id), action_map.get(u.id)] if v]
        last_active = max(candidates) if candidates else u.last_login_at
        is_active = is_user_allowed(db, u.email)
        result.append({
            "id": u.id, "name": u.name, "email": u.email, "role": u.role,
            "google_id": u.google_id, "sso_linked": u.google_id is not None,
            "access_allowed": is_active, "is_active": is_active,
            "assigned_leads": len(u.assigned_leads), "active_leads": _active_lead_count(u),
            "max_active": cap, "pod": pod_info, "pod_name": pod_info["name"] if pod_info else None,
            "last_login_at": str(last_active) if last_active else None,
            "created_at": str(u.created_at),
            "dialer_enabled": bool(getattr(u, 'dialer_enabled', False)),
            "email_sync_enabled": bool(getattr(u, 'email_sync_enabled', False)),
            "rcm_user_id": getattr(u, 'rcm_user_id', None) or None,
        })
    return result


@router.post("/users")
def create_crm_user(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    email = (body.get("email") or "").strip().lower()
    name = body.get("name")
    role = body.get("role", "SDR")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    if db.query(User).filter(func.lower(User.email) == email).first():
        raise HTTPException(status_code=400, detail="User with this email already exists")
    if role not in {"Super Admin", "Pod Admin", "SDR"}:
        role = "SDR"
    new_user = User(email=email, name=name, role=role, pod_id=body.get("pod_id"))
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    add_allowed_user(db, email, name, role, admin.get("email", "admin"))
    return {"message": "User created and access granted", "user_id": new_user.id}


@router.post("/users/upload")
async def upload_sdrs_csv(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    csv_content = body.get("csv")
    if not csv_content:
        raise HTTPException(status_code=400, detail="CSV content missing")
    result = process_csv(db, csv_content, admin.get("email", "admin"))
    for email in result["added"]:
        if not db.query(User).filter(func.lower(User.email) == email.lower()).first():
            au = get_allowed_user(db, email)
            db.add(User(email=email, name=au.name if au else email.split('@')[0], role="SDR"))
    for email in result["removed"]:
        u = db.query(User).filter(User.email == email).first()
        if u:
            u.assigned_leads = []
    db.commit()
    return {"message": f"CSV processed. Added {len(result['added'])}, removed {len(result['removed'])}, skipped {len(result['skipped'])}.", **result}


@router.patch("/users/{user_id}/role")
def update_user_role(user_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    new_role = body.get("role")
    if new_role not in {"Super Admin", "Pod Admin", "SDR"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    user.role = new_role
    db.commit()
    remove_allowed_user(db, user.email)
    add_allowed_user(db, user.email, user.name, new_role, admin.get("email", "admin"))
    return {"message": f"User {user.email} role updated to {new_role}"}


@router.patch("/users/{user_id}/access")
def toggle_user_access(user_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    action = body.get("action")
    if action == "revoke":
        remove_allowed_user(db, user.email)
        return {"message": f"Access revoked for {user.email}", "access_allowed": False}
    elif action == "grant":
        add_allowed_user(db, user.email, user.name or "", user.role, admin.get("email", "admin"))
        return {"message": f"Access granted for {user.email}", "access_allowed": True}
    raise HTTPException(status_code=400, detail="action must be 'grant' or 'revoke'")


@router.patch("/users/{user_id}/settings")
def update_user_settings(user_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if "dialer_enabled" in body:
        user.dialer_enabled = bool(body["dialer_enabled"])
    if "email_sync_enabled" in body:
        user.email_sync_enabled = bool(body["email_sync_enabled"])
    if "rcm_user_id" in body:
        user.rcm_user_id = (body["rcm_user_id"] or "").strip() or None
    db.commit()
    return {"message": f"Settings updated for {user.email}", "dialer_enabled": bool(user.dialer_enabled), "email_sync_enabled": bool(user.email_sync_enabled), "rcm_user_id": user.rcm_user_id or None}


@router.delete("/users/{user_id}")
def delete_crm_user(user_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user.assigned_leads = []
    db.commit()
    remove_allowed_user(db, user.email)
    db.delete(user)
    db.commit()
    return {"message": f"User {user.email} removed and access revoked"}


@router.get("/users/{user_id}/token")
def get_user_token(user_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    token = create_jwt({"sub": user.id, "email": user.email, "name": user.name, "role": user.role, "pod_id": user.pod_id, "dialer_enabled": bool(getattr(user, 'dialer_enabled', False)), "email_sync_enabled": bool(getattr(user, 'email_sync_enabled', False))})
    return {"token": token, "url": f"/frontend/index.html?token={token}"}


# ── Login Logs ───────────────────────────────────────────────────────────────

@router.get("/login-logs")
def get_login_logs(page: int = 1, per_page: int = 20, search: str = None, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    query = db.query(LoginLog).order_by(LoginLog.login_at.desc())
    if search:
        term = f"%{search}%"
        query = query.filter(or_(LoginLog.email.ilike(term), LoginLog.name.ilike(term)))
    total = query.count()
    logs = query.offset((page - 1) * per_page).limit(per_page).all()
    result = []
    for l in logs:
        duration = None
        if l.login_at and l.logout_at:
            total_secs = int((l.logout_at - l.login_at).total_seconds())
            hours, remainder = divmod(total_secs, 3600)
            minutes, _ = divmod(remainder, 60)
            duration = f"{hours}h {minutes}m" if hours else f"{minutes}m"
        result.append({"id": l.id, "user_id": l.user_id, "email": l.email, "name": l.name, "role": l.role, "ip_address": l.ip_address, "user_agent": l.user_agent, "login_at": str(l.login_at) if l.login_at else None, "logout_at": str(l.logout_at) if l.logout_at else None, "duration": duration})
    return {"data": result, "total": total, "page": page, "per_page": per_page, "pages": max(1, (total + per_page - 1) // per_page)}


# ── Feedback ─────────────────────────────────────────────────────────────────

@router.post("/feedback", dependencies=[])
def submit_feedback(body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    fb_type = body.get("type", "general")
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    if fb_type not in ("bug", "feature", "general"):
        fb_type = "general"
    entry = Feedback(user_id=user.get("sub"), user_email=user.get("email"), user_name=user.get("name"), type=fb_type, message=message)
    db.add(entry)
    db.commit()
    return {"message": "Thank you for your feedback!", "id": entry.id}


@router.get("/feedback")
def list_feedback(page: int = 1, per_page: int = 20, status: str = None, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    query = db.query(Feedback).order_by(Feedback.created_at.desc())
    if status:
        query = query.filter(Feedback.status == status)
    total = query.count()
    items = query.offset((page - 1) * per_page).limit(per_page).all()
    return {"data": [{"id": f.id, "user_email": f.user_email, "user_name": f.user_name, "type": f.type, "message": f.message, "status": f.status, "created_at": str(f.created_at) if f.created_at else None} for f in items], "total": total, "page": page, "per_page": per_page, "pages": max(1, (total + per_page - 1) // per_page)}


@router.patch("/feedback/{feedback_id}")
def update_feedback_status(feedback_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not fb:
        raise HTTPException(status_code=404, detail="Feedback not found")
    new_status = body.get("status")
    if new_status not in ("new", "reviewed", "resolved"):
        raise HTTPException(status_code=400, detail="Invalid status")
    fb.status = new_status
    db.commit()
    return {"message": f"Feedback marked as {new_status}"}


# ── Impersonate ──────────────────────────────────────────────────────────────

@router.post("/impersonate/{user_id}")
def impersonate_user(user_id: str, admin: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="Cannot impersonate yourself")
    try:
        log_activity(admin["sub"], "IMPERSONATE", user_email=admin.get("email"), user_name=admin.get("name"), metadata={"target_user_id": target.id, "target_email": target.email})
    except Exception:
        pass
    token = create_jwt({"sub": target.id, "email": target.email, "name": target.name, "role": target.role, "pod_id": target.pod_id, "dialer_enabled": bool(getattr(target, 'dialer_enabled', False)), "email_sync_enabled": bool(getattr(target, 'email_sync_enabled', False)), "impersonated_by": admin.get("sub"), "impersonator_name": admin.get("name")}, expires_hours=1)
    return {"token": token, "target_user": {"id": target.id, "name": target.name, "email": target.email, "role": target.role}}
