# ── routes/admin_user_routes.py — User management (split from admin_routes.py) ──
import logging
import re

logger = logging.getLogger(__name__)
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

import models
import access_db
from database import get_db
from auth import create_jwt, require_admin, require_super_admin
from routes._admin_helpers import _get_active_lead_cap, _active_lead_count
from rcm_auth import RCMAuthManager

router = APIRouter(prefix="/api/admin", tags=["Admin – Users"])


# ── User Management ─────────────────────────────────────────────────────────

@router.post("/users/upload")
async def upload_sdrs_csv(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Process SDR CSV with columns: email, name, action (add/remove)."""
    csv_content = body.get("csv")
    if not csv_content:
        raise HTTPException(status_code=400, detail="CSV content missing")

    result = access_db.process_csv(db, csv_content, admin.get("email", "admin"))

    for email in result["added"]:
        existing = db.query(models.User).filter(func.lower(models.User.email) == email.lower()).first()
        if not existing:
            access_user = access_db.get_allowed_user(db, email)
            name = access_user.name if access_user else email.split('@')[0]
            new_user = models.User(email=email, name=name, role="SDR")
            db.add(new_user)

    for email in result["removed"]:
        user = db.query(models.User).filter(models.User.email == email).first()
        if user:
            user.assigned_leads = []

    db.commit()
    return {
        "message": f"CSV processed. Added {len(result['added'])}, removed {len(result['removed'])}, skipped {len(result['skipped'])}.",
        "added": result["added"],
        "removed": result["removed"],
        "skipped": result["skipped"]
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Return CRM users. Pod Admin sees only their pod members."""
    from datetime import datetime, timezone, timedelta
    from cache import get_cached, set_cached, invalidate, _is_test_db, claim_inflight, wait_inflight, release_inflight

    # Cache (120s) per admin role + pod scope — invalidated on any user write.
    # Stampede guard: only one worker computes on a cold miss; others wait.
    # Skip cache in test/SQLite mode to prevent test pollution.
    _use_cache = not _is_test_db(db)
    cache_key = f"users:{admin.get('role')}:{admin.get('pod_id')}"
    if _use_cache:
        cached = get_cached('users', cache_key)
        if cached is not None:
            return cached
        # Stampede guard — only the first concurrent miss computes
        if not claim_inflight('users', cache_key):
            wait_inflight('users', cache_key)
            cached = get_cached('users', cache_key)
            if cached is not None:
                return cached
            # Fallthrough: timeout expired, compute anyway

    role = admin.get("role")
    if role == "Pod Admin":
        admin_user = db.query(models.User).filter(models.User.id == admin["sub"]).first()
        if admin_user and admin_user.pod_id:
            users = (
                db.query(models.User)
                .options(selectinload(models.User.pod), selectinload(models.User.assigned_leads))
                .filter(models.User.pod_id == admin_user.pod_id)
                .all()
            )
        else:
            users = [admin_user] if admin_user else []
    else:
        # Batch-load pod + assigned_leads in 2 extra queries instead of N lazy-loads
        # Eliminates the N+1 that was causing 3,984ms latency on this endpoint
        users = (
            db.query(models.User)
            .options(selectinload(models.User.pod), selectinload(models.User.assigned_leads))
            .all()
        )

    # ── Auto-close stale sessions (fire-and-forget background thread) ────────
    # Moving the commit() off the hot read path eliminates write-lock contention
    # under concurrent requests (was causing 16s P95 under load test with 5 workers).
    import threading
    def _close_stale_sessions():
        from database import SessionLocal
        from datetime import datetime, timezone, timedelta
        _db = SessionLocal()
        try:
            _cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
            _stale = _db.query(models.LoginLog).filter(
                models.LoginLog.logout_at == None,
                models.LoginLog.login_at < _cutoff,
            ).all()
            for s in _stale:
                if s.last_heartbeat_at:
                    s.logout_at = s.last_heartbeat_at + timedelta(minutes=5)
                else:
                    s.logout_at = s.login_at + timedelta(minutes=30)
            if _stale:
                _db.commit()
        except Exception:
            pass
        finally:
            _db.close()
    threading.Thread(target=_close_stale_sessions, daemon=True).start()

    # ── Pre-fetch last real activity for all users in batch ────────────
    # Best signal: last heartbeat, then last non-login activity, then last_login_at
    last_heartbeat_q = db.query(
        models.LoginLog.user_id,
        func.max(func.coalesce(models.LoginLog.last_heartbeat_at, models.LoginLog.login_at)).label("last_seen")
    ).group_by(models.LoginLog.user_id).all()
    heartbeat_map = {r.user_id: r.last_seen for r in last_heartbeat_q}

    last_action_q = db.query(
        models.UserActivityLog.user_id,
        func.max(models.UserActivityLog.created_at).label("last_action")
    ).filter(
        models.UserActivityLog.action_type != "LOGIN"
    ).group_by(models.UserActivityLog.user_id).all()
    action_map = {r.user_id: r.last_action for r in last_action_q}

    # ── Pre-fetch allowed_users in one query (avoid N+1 per-user is_user_allowed call) ──
    allowed_emails = {
        r[0].strip().lower()
        for r in db.query(models.AllowedUser.email).all()
    }

    # ── Pre-fetch lead cap ONCE (avoid N calls to _get_or_create_sync_settings) ──
    # _get_active_lead_cap falls back to sync_settings.active_lead_cap.
    # Fetch settings once here; pod-level caps use the pre-loaded pod relationship.
    from routes._admin_helpers import _get_or_create_sync_settings
    global_settings = _get_or_create_sync_settings(db)
    global_cap = global_settings.active_lead_cap if global_settings.active_lead_cap is not None else 500

    result = []
    for u in users:
        pod_info = None
        if u.pod_id and u.pod:
            pod_info = {"id": u.pod.id, "name": u.pod.name}
        # Use pod cap if set, otherwise global cap (mirrors _get_active_lead_cap logic)
        cap = (u.pod.active_lead_cap if (u.pod and u.pod.active_lead_cap is not None) else global_cap)

        # Compute last_active_at: the most recent REAL interaction
        # Priority: max(last_heartbeat, last_non_login_action)
        # Fallback: last_login_at from users table (for pre-login_logs data)
        candidates = []
        hb = heartbeat_map.get(u.id)
        if hb:
            candidates.append(hb)
        act = action_map.get(u.id)
        if act:
            candidates.append(act)

        if candidates:
            # Use the most recent real signal
            last_active = max(candidates)
        else:
            # No login_logs or activity_logs — fall back to users.last_login_at
            last_active = u.last_login_at

        is_active = u.email.strip().lower() in allowed_emails
        result.append({
            "id":             u.id,
            "name":           u.name,
            "email":          u.email,
            "role":           u.role,
            "google_id":      u.google_id,
            "sso_linked":     u.google_id is not None,
            "access_allowed": is_active,
            "is_active":      is_active,
            "assigned_leads": len(u.assigned_leads),
            "active_leads":   len([l for l in u.assigned_leads if l.status in models.ACTIVE_STATUSES]),
            "max_active":     cap,
            "pod":            pod_info,
            "pod_name":       pod_info["name"] if pod_info else None,
            "last_login_at":  str(last_active) if last_active else None,
            "created_at":     str(u.created_at),
            "dialer_enabled":           bool(getattr(u, 'dialer_enabled', False)),
            "email_sync_enabled":        bool(getattr(u, 'email_sync_enabled', False)),
            "rcm_user_id":        getattr(u, 'rcm_user_id', None) or None,
            "rcm_from_number":    getattr(u, 'rcm_from_number', None) or None,
            "rcm_email":          getattr(u, 'rcm_email', None) or None,
            "dialer_provider_override":  getattr(u, 'dialer_provider_override', None) or None,
        })
    if _use_cache:
        set_cached('users', cache_key, result)
        release_inflight('users', cache_key)
    return result


@router.post("/users")
def create_crm_user(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    from cache import invalidate
    invalidate('users')  # Bust cache so next list_users reflects new user
    """Admin can pre-create a user by email/name/role."""
    email = (body.get("email") or "").strip().lower()
    name  = body.get("name")
    role  = body.get("role", "SDR")

    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    existing = db.query(models.User).filter(func.lower(models.User.email) == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    valid_roles = {"Super Admin", "Pod Admin", "SDR", "AE"}
    if role not in valid_roles:
        role = "SDR"

    new_user = models.User(email=email, name=name, role=role)
    # Optionally assign to pod
    pod_id = body.get("pod_id")
    if pod_id:
        new_user.pod_id = pod_id
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    access_db.add_allowed_user(db, email, name, role, admin.get("email", "admin"))
    return {"message": "User created and access granted", "user_id": new_user.id}


@router.patch("/users/{user_id}/role")
def update_user_role(user_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Super Admin can change a user's role."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    new_role = body.get("role")
    valid_roles = {"Super Admin", "Pod Admin", "SDR", "AE"}
    if new_role not in valid_roles:
        raise HTTPException(status_code=400, detail="Invalid role")
    # Pod purity check: prevent SDR↔AE role change while user is in a pod
    if user.pod_id and new_role in ("SDR", "AE") and user.role in ("SDR", "AE") and user.role != new_role:
        existing_roles = {
            m.role for m in db.query(models.User)
            .filter(models.User.pod_id == user.pod_id, models.User.id != user.id)
            .all()
        }
        conflicting_role = "AE" if new_role == "SDR" else "SDR"
        if conflicting_role in existing_roles:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot change role to {new_role}: pod contains {conflicting_role} members. "
                       f"Move this user to a different pod first."
            )
    user.role = new_role
    db.commit()

    access_db.remove_allowed_user(db, user.email)
    access_db.add_allowed_user(db, user.email, user.name, new_role, admin.get("email", "admin"))

    from cache import invalidate
    invalidate('users')  # Bust cache so next list_users reflects the new role
    return {"message": f"User {user.email} role updated to {new_role}"}


@router.patch("/users/{user_id}/access")
def toggle_user_access(user_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Grant or revoke login access. action: 'grant' | 'revoke'"""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    action = body.get("action")
    if action == "revoke":
        access_db.remove_allowed_user(db, user.email)
        from cache import invalidate
        invalidate('users')  # Bust cache so next list_users reflects revoked access
        return {"message": f"Access revoked for {user.email}", "access_allowed": False}
    elif action == "grant":
        access_db.add_allowed_user(db, user.email, user.name or "", user.role, admin.get("email", "admin"))
        from cache import invalidate
        invalidate('users')  # Bust cache so next list_users reflects granted access
        return {"message": f"Access granted for {user.email}", "access_allowed": True}
    else:
        raise HTTPException(status_code=400, detail="action must be 'grant' or 'revoke'")


@router.patch("/users/{user_id}/settings")
def update_user_settings(user_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Super Admin can toggle per-SDR dialer, email sync access, and RCM sub-agent config."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    warning = None

    if "dialer_enabled" in body:
        user.dialer_enabled = bool(body["dialer_enabled"])
    if "email_sync_enabled" in body:
        user.email_sync_enabled = bool(body["email_sync_enabled"])

    if "rcm_user_id" in body:
        new_agent_id = (body["rcm_user_id"] or "").strip() or None

        if new_agent_id:
            # ── Live validation against RCM API ────────────────────────
            # The HMAC auth endpoint authenticates with the given user_id.
            # If the ID is wrong/nonexistent, RCM returns 401/400,
            # which test_connection() maps to success=False.
            # We reject the save immediately so admins can't persist ghost IDs.
            dialer_cfg = db.query(models.SyncSettings).first()
            conv_api_key  = getattr(dialer_cfg, "rcm_api_key", None) or ""
            conv_base_url = (
                getattr(dialer_cfg, "rcm_base_url", None)
                or "https://app.bercm.com"
            )

            if not conv_api_key:
                # No global API key yet — skip validation, just store
                logger.warning(
                    "[AdminSettings] rcm_api_key not configured; "
                    "skipping agent ID validation for user_id=%s", new_agent_id
                )
            else:
                logger.info(
                    "[AdminSettings] Validating RCM agent ID '%s' via HMAC auth",
                    new_agent_id,
                )
                result = RCMAuthManager.test_connection(
                    conv_base_url, conv_api_key, new_agent_id
                )
                if not result.get("success"):
                    err = result.get("error", "Unknown error")
                    logger.warning(
                        "[AdminSettings] RCM agent ID '%s' rejected: %s",
                        new_agent_id, err,
                    )
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"RCM Agent ID '{new_agent_id}' could not be verified. "
                            f"RCM rejected it with: {err}. "
                            "Please double-check the ID in your RCM Contact Center dashboard."
                        ),
                    )
                # Clear any stale cached token for this ID (fresh valid one just fetched)
                RCMAuthManager.clear_cache(conv_base_url, conv_api_key, new_agent_id)
                logger.info("[AdminSettings] Agent ID '%s' verified ✓", new_agent_id)

            # ── Duplicate check (soft-warn) ───────────────────────────────────
            existing = (
                db.query(models.User)
                .filter(
                    models.User.rcm_user_id == new_agent_id,
                    models.User.id != user_id,
                )
                .first()
            )
            if existing:
                warning = (
                    f"RCM Agent ID '{new_agent_id}' is already assigned to "
                    f"{existing.name or existing.email}. Calls may conflict."
                )

        user.rcm_user_id = new_agent_id

    if "rcm_from_number" in body:
        phone = (body["rcm_from_number"] or "").strip() or None
        if phone:
            digits_only = re.sub(r"[\s\-().]", "", phone)
            valid = (
                re.fullmatch(r"\+[1-9]\d{6,14}", digits_only)    # E.164: +919240915643
                or re.fullmatch(r"00[1-9]\d{6,14}", digits_only) # 00-prefix: 00919240915643
                or re.fullmatch(r"[1-9]\d{9,14}", digits_only)   # bare national: 9240915643
            )
            if not valid:
                raise HTTPException(
                    status_code=422,
                    detail="Invalid phone number. Use E.164 (+919240915643), "
                           "00-prefix (00919240915643), or a 10+ digit national number."
                )
        user.rcm_from_number = phone

    if "rcm_email" in body:
        conv_email = (body["rcm_email"] or "").strip().lower() or None
        if conv_email and not re.fullmatch(r"[^@]+@[^@]+\.[^@]+", conv_email):
            raise HTTPException(status_code=422, detail="Invalid email format for rcm_email.")
        user.rcm_email = conv_email

    if "dialer_provider_override" in body:
        val = (body["dialer_provider_override"] or "").strip().lower() or None
        if val and val not in ("aircall", "rcm"):
            raise HTTPException(status_code=400, detail=f"Invalid provider: {val}. Use 'aircall', 'rcm', or null.")
        user.dialer_provider_override = val

    db.commit()

    from cache import invalidate
    invalidate('users')  # Bust cache so next list_users reflects the updated settings
    response = {
        "message": f"Settings updated for {user.email}",
        "dialer_enabled":          bool(user.dialer_enabled),
        "email_sync_enabled":      bool(user.email_sync_enabled),
        "rcm_user_id":      user.rcm_user_id or None,
        "rcm_from_number":  user.rcm_from_number or None,
        "rcm_email":        user.rcm_email or None,
        "dialer_provider_override": user.dialer_provider_override or None,
    }
    if warning:
        response["warning"] = warning
    return response


@router.get("/dialer/sdr-configs")
def get_sdr_dialer_configs(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Super Admin only: Return all SDR RCM dialer assignments.

    Returns every user whose role is SDR (or any dialer-eligible user) with their
    current RCM sub-agent configuration.  Used by the Admin Dialer Settings
    panel to display and manage per-SDR assignments in a single table.
    """
    sdrs = (
        db.query(models.User)
        .filter(models.User.role.in_(["SDR", "AE"]))
        .order_by(models.User.name)
        .all()
    )
    return [
        {
            "id":                   u.id,
            "name":                 u.name or u.email,
            "email":                u.email,
            "dialer_enabled":       bool(getattr(u, "dialer_enabled", False)),
            "dialer_provider_override": getattr(u, "dialer_provider_override", None) or None,
            "rcm_user_id":   getattr(u, "rcm_user_id", None) or None,
            "rcm_from_number": getattr(u, "rcm_from_number", None) or None,
            "rcm_email":     getattr(u, "rcm_email", None) or None,
        }
        for u in sdrs
    ]


@router.delete("/users/{user_id}")
def delete_crm_user(user_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Remove a user from the CRM."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user.assigned_leads = []
    db.commit()
    access_db.remove_allowed_user(db, user.email)
    db.delete(user)
    db.commit()

    from cache import invalidate
    invalidate('users')  # Bust cache so next list_users reflects the deletion
    return {"message": f"User {user.email} removed and access revoked"}


@router.get("/users/{user_id}/token")
def get_user_token(user_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Super Admin: Generate a JWT for any user."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    token = create_jwt({
        "sub": user.id, "email": user.email, "name": user.name, "role": user.role,
        "pod_id": user.pod_id,
        "dialer_enabled": bool(getattr(user, 'dialer_enabled', False)),
        "email_sync_enabled": bool(getattr(user, 'email_sync_enabled', False)),
    })
    return {"token": token, "url": f"/frontend/index.html?token={token}"}
