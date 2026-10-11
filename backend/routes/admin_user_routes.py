# ── routes/admin_user_routes.py — User management (split from admin_routes.py) ──
import logging
import re

logger = logging.getLogger(__name__)
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

import ownership_history as oh
import models
import access_db
from database import get_db
from auth import create_jwt, require_admin, require_super_admin, may_export, EXPORT_ALWAYS_ROLES
from salesforce import backfill_sf_identity_links
from domain.actor import VALID_ROLES
from routes._admin_helpers import _get_or_create_sync_settings
from messaging_service import (
    SUPPORTED_MESSAGING_PROVIDERS,
    resolve_messaging_for_user,
    resolve_provider_name,
)
from messaging_auth import AlternateMessengerAuthManager


# ── Who may a caller manage? ─────────────────────────────────────────────────
# require_admin admits Pod Admin (auth.py), so these routes checked the
# caller's role but never *whose* account they targeted: POST /users took
# role="Super Admin" from a Pod Admin (privilege escalation — the role-change
# route was already require_super_admin, the role set at creation was not),
# and DELETE/access only refused the caller's own account. list_users is
# pod-scoped, but these take a user_id off the URL and ids are discoverable
# (leaderboard rows, cadence owners), so that scoping was never the guard.
# Rule matches legacy admin.js: SDR/AE rows in the caller's own pod.
POD_ADMIN_MANAGEABLE_ROLES = ("SDR", "AE")


def _is_pod_admin(admin: dict) -> bool:
    """True for a caller whose reach is one pod, not the org."""
    return admin.get("role") not in ("Super Admin", "Admin")


def _caller_pod_id(db: Session, admin: dict):
    """The caller's pod, read from the DB row rather than the JWT — exactly
    what list_users below scopes on, so "who is in my list" and "who I may
    act on" can never disagree (and a stale JWT after a pod reassignment
    can't widen access)."""
    row = db.query(models.User).filter(models.User.id == admin.get("sub")).first()
    pod = access_db.pod_for(db, row) if row else None      # users.pod_id, else their pod_admins row
    return None if pod == access_db.NO_POD else pod


def _require_may_manage_user(db: Session, admin: dict, target: models.User, action: str) -> None:
    """Raise 403 unless `admin` may act on `target`."""
    if not _is_pod_admin(admin):
        return
    # Pod Admin: SDR/AE members of their own pod only.
    if target.role not in POD_ADMIN_MANAGEABLE_ROLES:
        raise HTTPException(
            status_code=403,
            detail=f"Only a Super Admin can {action} a {target.role}.",
        )
    admin_pod = _caller_pod_id(db, admin)
    if not admin_pod or target.pod_id != admin_pod:
        raise HTTPException(
            status_code=403,
            detail=f"You can only {action} members of your own POD.",
        )


router = APIRouter(prefix="/api/admin", tags=["Admin – Users"])


# ── User Management ─────────────────────────────────────────────────────────

@router.post("/users/upload")
async def upload_sdrs_csv(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Process SDR CSV with columns: email, name, action (add/remove). Org-wide, so Super Admin/Admin only —
    a Pod Admin could otherwise remove (offboard) anyone, including other pods and admins, by email."""
    if admin.get("role") == "Pod Admin":
        raise HTTPException(status_code=403, detail="Bulk user changes are for Super Admins. Add or remove people one at a time.")
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
            from services import offboarding
            offboarding.offboard(db, user, admin["sub"])

    for email in result["added"]:   # someone added back after leaving is active again
        back = db.query(models.User).filter(func.lower(models.User.email) == email.lower()).first()
        if back and back.left_at:
            back.left_at = None

    db.commit()
    from cache import invalidate
    invalidate('users')
    return {
        "message": f"CSV processed. Added {len(result['added'])}, removed {len(result['removed'])}, skipped {len(result['skipped'])}.",
        "added": result["added"],
        "removed": result["removed"],
        "skipped": result["skipped"]
    }


@router.get("/access-requests")
def list_access_requests(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Pending sign-in attempts from emails not yet in allowed_users — see
    models.AccessRequest. Super Admin only, since granting access (adding
    the user) is itself Super-Admin-only in Team & Access."""
    rows = db.query(models.AccessRequest).order_by(models.AccessRequest.requested_at.desc()).all()
    return [{"email": r.email, "name": r.name, "requested_at": r.requested_at.isoformat() if r.requested_at else None} for r in rows]


@router.get("/users")
def list_users(include_left: bool = False, fresh: bool = False, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Return CRM users. Pod Admin sees only their pod members. People who were offboarded (left_at set) are left out
    unless include_left=true; each row carries `left` so screens can mark them."""
    from datetime import datetime, timezone, timedelta
    from cache import get_cached, set_cached, invalidate, _is_test_db, claim_inflight, wait_inflight, release_inflight

    # Cache (120s) per admin role + pod scope — invalidated on any user write.
    # Stampede guard: only one worker computes on a cold miss; others wait.
    # Skip cache in test/SQLite mode to prevent test pollution.
    _use_cache = not _is_test_db(db)
    cache_key = f"users:{admin.get('role')}:{admin.get('pod_id')}:{include_left}"
    if _use_cache and not fresh:      # fresh=true: the Control Center re-reads after every change and must never see a cached copy
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
        pod = admin.get("pod_id")             # resolved per request (users.pod_id, else their pod_admins row)
        if admin_user and pod and pod != access_db.NO_POD:
            users = (
                db.query(models.User)
                .options(selectinload(models.User.pod), selectinload(models.User.assigned_leads))
                .filter(models.User.pod_id == pod)
                .order_by(models.User.name, models.User.id)       # a stable order: without one the rows reshuffle between reloads
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
            .order_by(models.User.name, models.User.id)
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
    # Single global setting for every user — see _get_active_lead_cap's RCA
    # 2026-08-25 docstring for why a per-pod override no longer applies.
    from routes._admin_helpers import _get_or_create_sync_settings
    global_settings = _get_or_create_sync_settings(db)
    global_cap = global_settings.active_lead_cap if global_settings.active_lead_cap is not None else 500

    if not include_left:
        users = [u for u in users if u.left_at is None]
    result = []
    for u in users:
        pod_info = None
        if u.pod_id and u.pod:
            pod_info = {"id": u.pod.id, "name": u.pod.name}
        cap = global_cap

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
            "left":           u.left_at is not None or not is_active,   # no sign-in access = effectively left
            "left_at":        u.left_at.isoformat() if u.left_at else None,
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
            "last_login_at":  last_active.isoformat() if last_active else None,
            "created_at":     u.created_at.isoformat() if u.created_at else None,
            "dialer_enabled":           bool(getattr(u, 'dialer_enabled', False)),
            # v11.10.1: Admin → Users shows these three as read-only chips. The
            # editor is Settings → Calling & Messaging → User Access.
            "sms_enabled":              bool(getattr(u, 'sms_enabled', False)),
            "whatsapp_enabled":         bool(getattr(u, 'whatsapp_enabled', False)),
            "email_sync_enabled":        bool(getattr(u, 'email_sync_enabled', False)),
            "export_enabled":            may_export(u.role, u.export_enabled, u.export_blocked),   # effective: what they can do right now
            "export_always":             u.role in EXPORT_ALWAYS_ROLES,                            # role default is "on" (Super Admin): the switch then means "not blocked"
            "messenger_user_id":        getattr(u, 'messenger_user_id', None) or None,
            "messenger_from_number":    getattr(u, 'messenger_from_number', None) or None,
            "messenger_email":          getattr(u, 'messenger_email', None) or None,
            "dialer_provider_override":  getattr(u, 'dialer_provider_override', None) or None,
            "messenger_whatsapp_sender_id": getattr(u, 'messenger_whatsapp_sender_id', None) or None,
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
    if existing and existing.left_at is None:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    if existing:   # someone who left, added back: same row (their history stays), access granted again
        from services import offboarding
        offboarding.reactivate(db, existing)
        access_db.add_allowed_user(db, email, name or existing.name, existing.role, admin.get("email", "admin"))
        return {"message": "User re-activated and access granted", "user_id": existing.id}
    valid_roles = set(VALID_ROLES)
    if role not in valid_roles:
        role = "SDR"
    if _is_pod_admin(admin) and role not in POD_ADMIN_MANAGEABLE_ROLES:
        raise HTTPException(status_code=403, detail=f"Only a Super Admin can create a {role}.")

    new_user = models.User(email=email, name=name, role=role)
    # Optionally assign to pod
    pod_id = body.get("pod_id")
    if pod_id:
        # A Pod Admin can only place a new member in their own pod — otherwise
        # they could seed users into a pod they don't run.
        if _is_pod_admin(admin) and pod_id != _caller_pod_id(db, admin):
            raise HTTPException(status_code=403, detail="You can only add users to your own POD.")
        new_user.pod_id = pod_id
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    backfill_sf_identity_links(db, new_user)

    access_db.add_allowed_user(db, email, name, role, admin.get("email", "admin"))
    return {"message": "User created and access granted", "user_id": new_user.id}


@router.patch("/users/{user_id}/role")
def update_user_role(user_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Super Admin can change a user's role."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    new_role = body.get("role")
    valid_roles = set(VALID_ROLES)
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
    if user_id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="Cannot revoke your own access")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _require_may_manage_user(db, admin, user, "change login access for")
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
def update_user_settings(user_id: str, body: dict, background_tasks: BackgroundTasks,
                         db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Super Admin can toggle per-SDR dialer, email sync access, and Alternate Messenger sub-agent config."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Snapshot before any field below overwrites it — used after commit to
    # send an access-granted email only on a real off→on (or None→set)
    # transition, never on a revoke or a no-op re-save (Phase 1.5).
    _before_access = {
        "dialer_enabled": bool(user.dialer_enabled),
        "sms_enabled": bool(user.sms_enabled),
        "whatsapp_enabled": bool(user.whatsapp_enabled),
        "messenger_user_id": user.messenger_user_id,
    }

    warning = None

    if "dialer_enabled" in body:
        user.dialer_enabled = bool(body["dialer_enabled"])
    if "email_sync_enabled" in body:
        user.email_sync_enabled = bool(body["email_sync_enabled"])
    if "export_enabled" in body:
        from services import audit
        want = bool(body["export_enabled"])      # the wanted end state; this route is Super Admin only
        if not want and user.id == admin["sub"]:
            raise HTTPException(status_code=400, detail="You cannot switch off your own export access.")
        was = may_export(user.role, user.export_enabled, user.export_blocked)
        if user.role in EXPORT_ALWAYS_ROLES:
            user.export_blocked = not want       # Super Admin: on by role, so "off" is an explicit block
        else:
            user.export_enabled, user.export_blocked = want, False
        if was != want:                          # a re-save that changes nothing is not an event
            audit.record(db, admin, "export_access", "ALLOWED" if want else "BLOCKED",
                         f"{'Allowed' if want else 'Switched off'} data export for {user.name} ({user.email})" if user.name else f"{'Allowed' if want else 'Switched off'} data export for {user.email}",
                         {"target_user_id": user.id, "target_email": user.email, "target_role": user.role})

    if "messenger_user_id" in body:
        new_agent_id = (body["messenger_user_id"] or "").strip() or None

        if new_agent_id:
            # ── Live validation against Alternate Messenger API ────────────────────────
            # The HMAC auth endpoint authenticates with the given user_id.
            # If the ID is wrong/nonexistent, Alternate Messenger returns 401/400,
            # which test_connection() maps to success=False.
            # We reject the save immediately so admins can't persist ghost IDs.
            dialer_cfg = db.query(models.SyncSettings).first()
            conv_api_key  = getattr(dialer_cfg, "messenger_api_key", None) or ""
            conv_base_url = (
                getattr(dialer_cfg, "messenger_base_url", None)
                or "https://app.alternatecrm.com"
            )

            if not conv_api_key:
                # No global API key yet — skip validation, just store
                logger.warning(
                    "[AdminSettings] messenger_api_key not configured; "
                    "skipping agent ID validation for user_id=%s", new_agent_id
                )
            else:
                logger.info(
                    "[AdminSettings] Validating Alternate Messenger agent ID '%s' via HMAC auth",
                    new_agent_id,
                )
                result = AlternateMessengerAuthManager.test_connection(
                    conv_base_url, conv_api_key, new_agent_id
                )
                if not result.get("success"):
                    err = result.get("error", "Unknown error")
                    logger.warning(
                        "[AdminSettings] Alternate Messenger agent ID '%s' rejected: %s",
                        new_agent_id, err,
                    )
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Alternate Messenger Agent ID '{new_agent_id}' could not be verified. "
                            f"Alternate Messenger rejected it with: {err}. "
                            "Please double-check the ID in your Alternate Messenger Contact Center dashboard."
                        ),
                    )
                # Clear any stale cached token for this ID (fresh valid one just fetched)
                AlternateMessengerAuthManager.clear_cache(conv_base_url, conv_api_key, new_agent_id)
                logger.info("[AdminSettings] Agent ID '%s' verified ✓", new_agent_id)

            # ── Duplicate check (soft-warn) ───────────────────────────────────
            existing = (
                db.query(models.User)
                .filter(
                    models.User.messenger_user_id == new_agent_id,
                    models.User.id != user_id,
                )
                .first()
            )
            if existing:
                warning = (
                    f"Alternate Messenger Agent ID '{new_agent_id}' is already assigned to "
                    f"{existing.name or existing.email}. Calls may conflict."
                )

        user.messenger_user_id = new_agent_id

    if "messenger_from_number" in body:
        phone = (body["messenger_from_number"] or "").strip() or None
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
        user.messenger_from_number = phone

    if "messenger_email" in body:
        conv_email = (body["messenger_email"] or "").strip().lower() or None
        if conv_email and not re.fullmatch(r"[^@]+@[^@]+\.[^@]+", conv_email):
            raise HTTPException(status_code=422, detail="Invalid email format for messenger_email.")
        user.messenger_email = conv_email

    if "messenger_whatsapp_sender_id" in body:
        wa_sender = (body["messenger_whatsapp_sender_id"] or "").strip() or None
        if wa_sender:
            digits_only = re.sub(r"[\s\-().]", "", wa_sender)
            valid = (
                re.fullmatch(r"\+[1-9]\d{6,14}", digits_only)
                or re.fullmatch(r"00[1-9]\d{6,14}", digits_only)
                or re.fullmatch(r"[1-9]\d{9,14}", digits_only)
            )
            if not valid:
                raise HTTPException(
                    status_code=422,
                    detail="Invalid WhatsApp sender number. Use E.164 (+919240915643), "
                           "00-prefix (00919240915643), or a 10+ digit national number."
                )
        user.messenger_whatsapp_sender_id = wa_sender

    if "dialer_provider_override" in body:
        val = (body["dialer_provider_override"] or "").strip().lower() or None
        if val and val not in ("aircall", "messenger"):
            raise HTTPException(status_code=400, detail=f"Invalid provider: {val}. Use 'aircall', 'messenger', or null.")
        user.dialer_provider_override = val

    # ── v11.10.0: per-SDR messaging access ────────────────────────────────────
    if "messaging_provider_override" in body:
        val = (body["messaging_provider_override"] or "").strip().lower() or None
        if val and val not in SUPPORTED_MESSAGING_PROVIDERS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid messaging provider: {val}. Use 'aircall', 'messenger', or null.",
            )
        user.messaging_provider_override = val

    for field in ("sms_enabled", "whatsapp_enabled"):
        if field in body:
            setattr(user, field, bool(body[field]))

    # Enabling a channel whose vendor isn't configured yet would look like it
    # worked and then fail silently at the first send — the exact failure mode
    # this release exists to remove. Save it (the admin may be filling org
    # credentials in a moment) but hand back a warning, which the settings UI
    # shows inline against that user's row. Asking the resolver rather than
    # re-deriving the gaps means this warning is, by construction, the message
    # the send path would actually produce.
    granted = [c for c in ("sms", "whatsapp") if body.get(f"{c}_enabled")]
    if granted:
        blocked = resolve_messaging_for_user(db, user, granted[0])
        if blocked.error:
            warning = f"Messaging enabled for {user.email}, but it won't send yet — {blocked.error}"

    db.commit()

    # Access-granted email (Phase 1.5) — one email per request, batching every
    # capability that just went from off/None to on/set. Sender is the admin
    # performing the grant, via their own connected Nylas mailbox.
    granted_capabilities = [
        key for key in ("dialer_enabled", "sms_enabled", "whatsapp_enabled")
        if getattr(user, key) and not _before_access[key]
    ]
    if user.messenger_user_id and not _before_access["messenger_user_id"]:
        granted_capabilities.append("messenger_user_id")
    if granted_capabilities:
        # Off the request path: a slow or failing Nylas send must not add
        # latency to the grant, and must never fail a change that is already
        # committed. See notify_access_granted_in_background's RCA.
        from access_notifications import notify_access_granted_in_background
        background_tasks.add_task(
            notify_access_granted_in_background,
            admin["sub"], user.id, granted_capabilities,
        )

    from cache import invalidate
    invalidate('users')  # Bust cache so next list_users reflects the updated settings
    response = {
        "message": f"Settings updated for {user.email}",
        "dialer_enabled":          bool(user.dialer_enabled),
        "email_sync_enabled":      bool(user.email_sync_enabled),
        "export_enabled":          may_export(user.role, user.export_enabled, user.export_blocked),
        "messenger_user_id":      user.messenger_user_id or None,
        "messenger_from_number":  user.messenger_from_number or None,
        "messenger_email":        user.messenger_email or None,
        "dialer_provider_override": user.dialer_provider_override or None,
        "messenger_whatsapp_sender_id": user.messenger_whatsapp_sender_id or None,
        "sms_enabled":              bool(user.sms_enabled),
        "whatsapp_enabled":         bool(user.whatsapp_enabled),
        "messaging_provider_override": user.messaging_provider_override or None,
    }
    if warning:
        response["warning"] = warning
    return response


@router.get("/dialer/sdr-configs")
def get_sdr_dialer_configs(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Super Admin only: Return all SDR Alternate Messenger dialer assignments.

    Returns every user whose role is SDR (or any dialer-eligible user) with their
    current Alternate Messenger sub-agent configuration.  Used by the Admin Dialer Settings
    panel to display and manage per-SDR assignments in a single table.
    """
    from services import offboarding
    sdrs = (
        db.query(models.User)
        .filter(models.User.role.in_(["SDR", "AE"]))
        .order_by(models.User.name)
        .all()
    )
    gone = offboarding.left_ids(db, sdrs)       # people who left must not keep showing in Calling & Messaging settings
    sdrs = [u for u in sdrs if u.id not in gone]
    settings = _get_or_create_sync_settings(db)
    return [
        {
            "id":                   u.id,
            "name":                 u.name or u.email,
            "email":                u.email,
            "dialer_enabled":       bool(getattr(u, "dialer_enabled", False)),
            "dialer_provider_override": getattr(u, "dialer_provider_override", None) or None,
            "messenger_user_id":   getattr(u, "messenger_user_id", None) or None,
            "messenger_from_number": getattr(u, "messenger_from_number", None) or None,
            "messenger_email":     getattr(u, "messenger_email", None) or None,
            "messenger_whatsapp_sender_id": getattr(u, "messenger_whatsapp_sender_id", None) or None,
            "sms_enabled":          bool(getattr(u, "sms_enabled", False)),
            "whatsapp_enabled":     bool(getattr(u, "whatsapp_enabled", False)),
            "messaging_provider_override": getattr(u, "messaging_provider_override", None) or None,
            # Effective vendors after per-user override → org default, so the
            # settings table can show what each row will actually use without
            # re-deriving the fallback chain in JavaScript.
            "effective_dialer_provider":    (getattr(u, "dialer_provider_override", None)
                                             or getattr(settings, "dialer_provider", None) or "none").lower(),
            "effective_messaging_provider": resolve_provider_name(settings, u),
        }
        for u in sdrs
    ]


@router.get("/users/{user_id}/pod-admin-of")
def get_user_pod_admin_of(user_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Pods this user is a Pod Admin of — used to warn before deleting them."""
    rows = (
        db.query(models.Pod.id, models.Pod.name)
        .join(models.PodAdmin, models.PodAdmin.pod_id == models.Pod.id)
        .filter(models.PodAdmin.user_id == user_id)
        .all()
    )
    return [{"id": r.id, "name": r.name} for r in rows]


@router.delete("/users/{user_id}")
def delete_crm_user(user_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Remove a user from the CRM = offboard them (services/offboarding.py): sign-in, dialer, messaging and email access
    are all switched off, their leads are released, and they show as Left in reports. The row is kept so history
    (calls, meetings, ownership) still has a name — a hard delete used to fail on prod with no visible error."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    _require_may_manage_user(db, admin, user, "delete")
    from services import offboarding
    offboarding.offboard(db, user, admin["sub"])

    from cache import invalidate
    invalidate('users')  # Bust cache so next list_users reflects the removal
    return {"message": f"User {user.email} removed and access revoked"}


@router.get("/users/{user_id}/token")
def get_user_token(user_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Generate a JWT for a user — backs Control Center's "View As". A Super Admin may view as anyone; a Pod Admin only
    as an SDR or AE in their own pod (v14.0.0), never another Pod Admin, an admin, or a rep in another pod.

    RCA 2026-09-04: this absorbed the audit-log + self-view guard that used to
    live on the separate, never-called POST /admin/impersonate/{id} (deleted —
    zero frontend callers, this endpoint was the one View As actually used, so
    the other one silently never logged or guarded anything in production).
    """
    if user_id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="Cannot view as yourself")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _require_may_manage_user(db, admin, user, "view as")
    if user.left_at is not None:
        raise HTTPException(status_code=400, detail="That person has left, so there is nothing to view.")

    from activity_logger import log_activity
    log_activity(admin["sub"], "IMPERSONATE", user_email=admin.get("email"),
                 user_name=admin.get("name"),
                 metadata={"target_user_id": user.id, "target_email": user.email})

    token = create_jwt({
        "sub": user.id, "email": user.email, "name": user.name, "role": user.role,
        "pod_id": user.pod_id,
        "dialer_enabled": bool(getattr(user, 'dialer_enabled', False)),
        "email_sync_enabled": bool(getattr(user, 'email_sync_enabled', False)),
        # A Pod Admin only looks (middleware_view_as.py); a Super Admin keeps full access as before.
        **({"view_as_read_only": True} if admin.get("role") == "Pod Admin" else {}),
    })
    return {"token": token, "url": f"/frontend/index.html?token={token}"}
