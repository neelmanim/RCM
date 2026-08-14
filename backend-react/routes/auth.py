"""
Auth routes — login, callback, session, health, config.
"""
import os
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from database import get_db
from config import settings
from middleware import create_jwt, get_current_user
from services.auth_service import (
    process_login, close_sessions, heartbeat as heartbeat_service,
    is_user_allowed, add_allowed_user, get_allowed_user,
)
from integrations.google_auth import google_auth_url, exchange_code_for_user
from models import User, LoginLog
from utils.activity_logger import log_activity

router = APIRouter(prefix="/api", tags=["Auth"])


@router.get("/auth/login")
def login(origin: str = ""):
    """Redirect to Google OAuth consent screen."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google OAuth not configured")
    return RedirectResponse(url=google_auth_url(state=origin))


@router.get("/auth/callback")
async def auth_callback(
    code: str = None, error: str = None, state: str = "",
    request: Request = None, db: Session = Depends(get_db)
):
    """Google redirects here after user approves."""
    if error or not code:
        raise HTTPException(status_code=400, detail=f"OAuth error: {error or 'no code received'}")
    try:
        google_user = await exchange_code_for_user(code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to exchange code: {e}")

    user, allowed = process_login(db, google_user, request)

    if not user:
        frontend_url = settings.FRONTEND_URL
        if state == "react" and frontend_url:
            return RedirectResponse(url=f"{frontend_url}/login?error=unauthorized")
        return RedirectResponse(url="/frontend/login.html?error=unauthorized")

    # Activity log
    client_ip = request.client.host if request and request.client else None
    try:
        log_activity(user.id, "LOGIN", user_email=user.email, user_name=user.name,
                     metadata={"ip_address": client_ip})
    except Exception:
        pass

    token = create_jwt({
        "sub": user.id, "email": user.email, "name": user.name, "role": user.role,
        "pod_id": user.pod_id,
        "dialer_enabled": bool(getattr(user, 'dialer_enabled', False)),
        "email_sync_enabled": bool(getattr(user, 'email_sync_enabled', False)),
    })

    frontend_url = settings.FRONTEND_URL
    if state == "react" and frontend_url:
        return RedirectResponse(url=f"{frontend_url}/login?token={token}")
    return RedirectResponse(url=f"/frontend/login.html?token={token}")


@router.get("/health")
def health():
    return {"status": "ok"}


@router.post("/auth/heartbeat")
def heartbeat(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    heartbeat_service(db, user["sub"])
    return {"ok": True}


@router.post("/auth/logout")
def logout(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    close_sessions(db, user["sub"])
    return {"ok": True}


@router.get("/auth/me")
def me(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return user


@router.get("/auth/demo")
def demo_login(role: str = "SDR", db: Session = Depends(get_db)):
    if not settings.ALLOW_DEMO:
        raise HTTPException(status_code=403, detail="Demo login is disabled")
    valid_roles = {"Super Admin", "Pod Admin", "SDR"}
    if role == "Admin":
        role = "Super Admin"
    if role not in valid_roles:
        role = "SDR"

    demo_email = f"demo.{role.lower().replace(' ', '')}@rcm.dev"
    user = db.query(User).filter(User.email == demo_email).first()
    if not user:
        user = User(
            google_id=f"demo-{role.lower().replace(' ', '')}",
            email=demo_email, name=f"Demo {role}", role=role
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        add_allowed_user(db, demo_email, f"Demo {role}", role, "demo-system")
    else:
        if user.role != role:
            user.role = role
            user.name = f"Demo {role}"
            db.commit()

    token = create_jwt({
        "sub": user.id, "email": user.email, "name": user.name, "role": user.role,
        "pod_id": user.pod_id,
        "dialer_enabled": bool(getattr(user, 'dialer_enabled', False)),
        "email_sync_enabled": bool(getattr(user, 'email_sync_enabled', False)),
    })
    return {"token": token, "user": {"email": user.email, "name": user.name, "role": user.role}}


@router.get("/config")
def get_config():
    return {"allow_demo": settings.ALLOW_DEMO}
