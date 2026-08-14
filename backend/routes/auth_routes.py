# ── routes/auth_routes.py — Authentication & user identity ─────────────────────
import os
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

import models
import access_db
from database import get_db
from auth import (
    create_jwt, get_current_user,
    google_auth_url, exchange_code_for_user, GOOGLE_CLIENT_ID
)
from salesforce import get_sf_client, push_sdr_metrics_to_salesforce
from models import log_user_login

router = APIRouter(prefix="/api", tags=["Auth"])


@router.get("/auth/login")
def login(origin: str = ""):
    """Redirect the browser to Google OAuth consent screen.
    Pass ?origin=react from the React frontend so the callback
    knows where to redirect after successful authentication.
    Legacy callers omit the param and get the default redirect."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID in .env")
    return RedirectResponse(url=google_auth_url(state=origin))


@router.get("/auth/callback")
async def auth_callback(code: str = None, error: str = None, state: str = "", request: Request = None, db: Session = Depends(get_db)):
    """Google redirects here after the user approves. Exchange code → JWT.

    The `state` param carries the FRONTEND ORIGIN (e.g. 'https://rcm-frontend-develop.onrender.com')
    set by login.html so we redirect the token back to whichever frontend initiated the login.
    Falls back to FRONTEND_URL env var for backwards compatibility.
    """
    # ── Resolve which frontend to redirect back to ────────────────────────────
    import urllib.parse
    _allowed_origins = [
        o.strip().rstrip('/')
        for o in os.getenv("FRONTEND_URLS", os.getenv("FRONTEND_URL", "")).split(",")
        if o.strip()
    ]

    def _resolve_frontend(state_val: str) -> str:
        """Return a safe redirect base URL. State wins if it's in the allowlist."""
        try:
            decoded = urllib.parse.unquote(state_val).rstrip('/')
        except Exception:
            decoded = ""
        if decoded and (not _allowed_origins or decoded in _allowed_origins):
            return decoded
        # Fall back to FRONTEND_URL (single env var) for legacy setups
        return os.getenv("FRONTEND_URL", "").strip().rstrip('/')
    if error or not code:
        raise HTTPException(status_code=400, detail=f"OAuth error: {error or 'no code received'}")
    try:
        google_user = await exchange_code_for_user(code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to exchange code: {e}")

    google_id = google_user["sub"]
    email     = google_user["email"].strip().lower()   # Normalize — prevents case-sensitive duplicates
    name      = google_user.get("name", "")

    user = db.query(models.User).filter(
        (models.User.google_id == google_id) | (models.User.email == email)
    ).first()

    if not user:
        no_allowed_users = db.query(models.AllowedUser).count() == 0
        existing_count = db.query(models.User).count()
        if existing_count == 0 or no_allowed_users:
            role = "Super Admin"
            user = models.User(google_id=google_id, email=email, name=name, role=role)
            db.add(user)
            db.commit()
            db.refresh(user)
            access_db.add_allowed_user(db, email, name, "Super Admin", "system-first-user")
        else:
            if not access_db.is_user_allowed(db, email):
                _fe = _resolve_frontend(state)
                return RedirectResponse(url=f"{_fe}/login.html?error=unauthorized" if _fe else "/frontend/login.html?error=unauthorized")
            access_info = access_db.get_allowed_user(db, email)
            role_str = access_info.role if access_info else "SDR"
            role_map = {"Super Admin": "Super Admin", "Pod Admin": "Pod Admin"}
            db_role = role_map.get(role_str, "SDR")
            user = models.User(google_id=google_id, email=email, name=name, role=db_role)
            db.add(user)
            db.commit()
            db.refresh(user)
    else:
        no_allowed_users = db.query(models.AllowedUser).count() == 0
        if no_allowed_users:
            access_db.add_allowed_user(db, email, user.name or name, "Super Admin", "system-bootstrap")
            user.role = "Super Admin"
        else:
            if not access_db.is_user_allowed(db, email):
                _fe = _resolve_frontend(state)
                return RedirectResponse(url=f"{_fe}/login.html?error=unauthorized" if _fe else "/frontend/login.html?error=unauthorized")
            # Sync role from allowed_users on every login
            access_info = access_db.get_allowed_user(db, email)
            if access_info:
                role_map = {"Super Admin": "Super Admin", "Admin": "Super Admin", "admin": "Super Admin",
                            "Pod Admin": "Pod Admin", "Pod_Admin": "Pod Admin"}
                synced_role = role_map.get(access_info.role, access_info.role or "SDR")
                if user.role != synced_role:
                    user.role = synced_role
        if not user.google_id:
            user.google_id = google_id
        user.name = name
        db.commit()

    from datetime import datetime, timezone
    user.last_login_at = datetime.now(timezone.utc)

    # Record login in audit log
    client_ip = request.client.host if request and request.client else None
    ua = request.headers.get("user-agent", "")[:255] if request else None
    log_user_login(db, user.id, user.email, name=user.name, role=user.role, ip_address=client_ip, user_agent=ua)
    # Fire-and-forget activity log
    from activity_logger import log_activity
    log_activity(user.id, "LOGIN", user_email=user.email, user_name=user.name,
                 metadata={"ip_address": client_ip})
    db.commit()

    token = create_jwt({
        "sub": user.id, "email": user.email, "name": user.name, "role": user.role,
        "pod_id": user.pod_id,
        "dialer_enabled": bool(getattr(user, 'dialer_enabled', False)),
        "email_sync_enabled": bool(getattr(user, 'email_sync_enabled', False)),
    })
    _fe = _resolve_frontend(state)
    return RedirectResponse(url=f"{_fe}/login.html?token={token}" if _fe else f"/frontend/login.html?token={token}")


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """Shallow health check used by Render's health probe.
    Always returns 200 to prevent restart loops during startup/migration.
    Check 'startup_complete' to know when the service is fully ready.
    For table-level lock detection use /health/deep.
    """
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
        db_connected = True
    except Exception:
        db_connected = False

    import app_state
    return {
        "status": "ok" if db_connected else "degraded",
        "db_connected": db_connected,
        "startup_complete": app_state.startup_complete,
    }


@router.get("/health/deep")
def deep_health(db: Session = Depends(get_db)):
    """Deep health check — detects DB lock outages, memory, and startup state.
    Use for monitoring and debugging; NOT for Render's health probe.
    If 'db_tables_accessible' is False while 'db_connected' is True,
    the DB is connected but queries are being blocked by a lock.
    """
    import time
    import resource
    import platform
    from sqlalchemy import text
    import app_state

    # Memory usage (RSS in MB)
    usage = resource.getrusage(resource.RUSAGE_SELF)
    if platform.system() == "Linux":
        memory_mb = round(usage.ru_maxrss / 1024, 1)  # Linux: KB
    else:
        memory_mb = round(usage.ru_maxrss / (1024 * 1024), 1)  # macOS: bytes

    # Shallow DB check
    db_connected = False
    db_latency_ms = -1
    try:
        start = time.monotonic()
        db.execute(text("SELECT 1"))
        db_latency_ms = round((time.monotonic() - start) * 1000, 2)
        db_connected = True
    except Exception:
        pass

    # Deep table check: can we actually read the leads table?
    # A 2s timeout means we detect lock outages before users do.
    db_tables_accessible = False
    if db_connected:
        try:
            db.execute(text("SET LOCAL statement_timeout = '2000'"))  # 2 seconds
            db.execute(text("SELECT 1 FROM leads LIMIT 1"))
            db_tables_accessible = True
        except Exception:
            db.rollback()  # Release any failed transaction state

    return {
        "status": "ok" if (db_connected and db_tables_accessible) else "degraded",
        "db_connected": db_connected,
        "db_tables_accessible": db_tables_accessible,
        "db_latency_ms": db_latency_ms,
        "startup_complete": app_state.startup_complete,
        "memory_mb": memory_mb,
    }


@router.post("/auth/heartbeat")
def heartbeat(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Frontend sends this every 5 min when the user is actively interacting.
    Updates last_heartbeat_at on the current open session."""
    from datetime import datetime, timezone as tz
    session = db.query(models.LoginLog).filter(
        models.LoginLog.user_id == user["sub"],
        models.LoginLog.logout_at == None,
    ).order_by(models.LoginLog.login_at.desc()).first()
    if session:
        session.last_heartbeat_at = datetime.now(tz.utc)
        db.commit()
    return {"ok": True}


@router.post("/auth/logout")
def logout(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Explicitly close the current session so time tracking is accurate."""
    from datetime import datetime, timezone as tz
    open_sessions = db.query(models.LoginLog).filter(
        models.LoginLog.user_id == user["sub"],
        models.LoginLog.logout_at == None,
    ).all()
    now = datetime.now(tz.utc)
    for s in open_sessions:
        s.logout_at = now
        if not s.last_heartbeat_at:
            s.last_heartbeat_at = now
    db.commit()
    return {"ok": True}


@router.get("/auth/me")
def me(bg_tasks: BackgroundTasks, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns the current authenticated user from the JWT."""
    bg_tasks.add_task(_push_user_metrics_to_sf, user["sub"], db, last_login=True)
    return user


def _push_user_metrics_to_sf(user_id: str, db: Session, last_login=False):
    """Computes SDR metrics and pushes to Salesforce SDR__c object."""
    from datetime import datetime, date
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user or not db_user.sf_sdr_id:
        return

    today_start = datetime.combine(date.today(), datetime.min.time())
    # Push date filter into SQL — avoids fetching ALL lifetime call logs into Python
    calls_today_count = (
        db.query(func.count(models.CallLog.id))
        .filter(
            models.CallLog.user_id == user_id,
            models.CallLog.called_at >= today_start,
        )
        .scalar() or 0
    )
    last_call_row = (
        db.query(models.CallLog.called_at)
        .filter(models.CallLog.user_id == user_id, models.CallLog.called_at.isnot(None))
        .order_by(models.CallLog.called_at.desc())
        .first()
    )
    last_call = last_call_row[0] if last_call_row else None

    metrics = {
        "calls_today": calls_today_count,
        "total_leads": len(db_user.assigned_leads),
        "role":        db_user.role if isinstance(db_user.role, str) else str(db_user.role)
    }
    if last_login:
        metrics["last_login"] = datetime.now()
    if last_call:
        metrics["last_call"] = last_call

    sf = get_sf_client()
    if sf:
        push_sdr_metrics_to_salesforce(sf, db_user, metrics)


@router.get("/auth/demo")
def demo_login(role: str = "SDR", db: Session = Depends(get_db)):
    """Dev-only quick login. Returns a JWT without Google OAuth."""
    if os.getenv("ALLOW_DEMO", "false").lower() != "true":
        raise HTTPException(status_code=403, detail="Demo login is disabled in this environment.")
    valid_roles = {"Super Admin", "Pod Admin", "SDR", "AE"}
    # Map legacy "Admin" to "Super Admin" for demo compatibility
    if role == "Admin":
        role = "Super Admin"
    if role not in valid_roles:
        role = "SDR"

    demo_email = f"demo.{role.lower().replace(' ', '')}@rcm.dev"
    user = db.query(models.User).filter(models.User.email == demo_email).first()
    if not user:
        user = models.User(
            google_id=f"demo-{role.lower().replace(' ', '')}",
            email=demo_email,
            name=f"Demo {role}",
            role=role
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        access_db.add_allowed_user(db, demo_email, f"Demo {role}", role, "demo-system")
    else:
        # Ensure role matches request (handles V1→V2 upgrade case)
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
    """Expose environment config to the frontend (safe settings only)."""
    return {
        "allow_demo": os.getenv("ALLOW_DEMO", "false").lower() == "true"
    }
