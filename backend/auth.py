import os
import httpx
from jose import jwt, JWTError
from fastapi import HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from database import get_db
from datetime import datetime, timedelta, timezone

# ── Config ────────────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI  = os.getenv("GOOGLE_REDIRECT_URI", "http://127.0.0.1:8000/api/auth/callback")
JWT_SECRET           = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise ValueError("JWT_SECRET environment variable is required. Generate with: python3 -c \"import secrets; print(secrets.token_urlsafe(48))\"")
JWT_ALGORITHM        = "HS256"
JWT_EXPIRE_HOURS     = 8

GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO  = "https://www.googleapis.com/oauth2/v3/userinfo"

# ── JWT helpers ───────────────────────────────────────────────────────────────
def create_jwt(data: dict, expires_hours: int = None) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=expires_hours or JWT_EXPIRE_HOURS)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

# ── Security rollout switches ─────────────────────────────────────────────────
# RCA 2026-09-29 (access-control audit): every security layer added that day
# ships behind SECURITY_<LAYER>_MODE. "monitor" logs what WOULD be refused and
# lets it through; anything else (the default) refuses. Layers: AUTH_GATE,
# IDENTITY, LEAD_ACCESS, WEBHOOK. Flipping one is an env change + restart,
# not a code deploy.
import logging
security_log = logging.getLogger("security")


# Safe rollout when Render sets nothing: Render never applied render.yaml's env
# values (found 2026-09-30 — staging enforced webhooks it was meant to monitor),
# so a deploy alone must not switch on a layer whose monitor logs haven't been
# reviewed. User-approved 2026-09-30. Staging sets all four to enforce explicitly.
_SECURITY_DEFAULTS = {"AUTH_GATE": "enforce", "IDENTITY": "monitor", "LEAD_ACCESS": "monitor", "WEBHOOK": "monitor"}


def security_enforcing(layer: str) -> bool:
    mode = os.getenv(f"SECURITY_{layer}_MODE") or _SECURITY_DEFAULTS.get(layer, "enforce")
    return mode.strip().lower() != "monitor"


def security_deny(layer: str, status_code: int, detail: str, **context):
    """Log a refusal (or would-be refusal in monitor mode); raise only when enforcing."""
    enforcing = security_enforcing(layer)
    security_log.warning(
        "security_denial layer=%s action=%s status=%s detail=%r %s",
        layer, "refused" if enforcing else "would_refuse", status_code, detail,
        " ".join(f"{k}={v}" for k, v in context.items()),
    )
    if enforcing:
        raise HTTPException(status_code=status_code, detail=detail)


# ── Identity: the token proves who, the database says what they may do ───────
# A JWT's role/pod_id are a login-time snapshot and it can't be revoked — a
# user removed from allowed_users, demoted, or moved pod kept the old access
# until expiry. authenticate() refreshes them from access_db on every request.
def authenticate(token: str, db: Session) -> dict:
    """Decode a JWT and refresh its role/pod from the DB. Every path that
    accepts a user token (header, SSE ?token=, sendBeacon body) goes through here."""
    import access_db
    claims = decode_jwt(token)
    ident = access_db.active_identity(db, claims.get("sub") or "")
    if ident is None:
        security_deny("IDENTITY", 401, "Your access has been removed. Please contact your admin.",
                      user=claims.get("sub"), email=claims.get("email"))
        return claims  # monitor mode
    email, role, pod_id = ident
    if security_enforcing("IDENTITY"):  # monitor mode keeps the token's snapshot
        claims = {**claims, "role": role, "pod_id": pod_id}
    return claims


# ── Bearer token extractor ────────────────────────────────────────────────────
bearer_scheme = HTTPBearer(auto_error=False)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
                     db: Session = Depends(get_db)):
    """FastAPI dependency — inject into any route to require auth."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return authenticate(credentials.credentials, db)

# ── Deny by default ───────────────────────────────────────────────────────────
# RCA 2026-09-29: a route was public unless its author remembered
# Depends(get_current_user) — 35 of 343 were, incl. notes/tasks/calls of any
# lead. Now every route requires a user token unless it declares one of the
# two markers below; enforce_auth_by_default() applies that at startup and
# tests/test_route_access_guard.py fails the build on anything unmarked.

def public_endpoint():
    """Marker: reachable with no user token on purpose (login, health, the
    unsubscribe link, webhooks — which must verify the sender themselves)."""


def authenticates_itself():
    """Marker: authenticates the caller in its own body and MUST fail closed —
    a user token where a header can't carry it (sendBeacon body,
    EventSource / window.open query → authenticate()), or a service token
    header (X-Sandbox-Token)."""


def _auth_gate(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
               db: Session = Depends(get_db)):
    if not credentials:
        security_deny("AUTH_GATE", 401, "Not authenticated")
        return
    try:
        authenticate(credentials.credentials, db)
    except HTTPException as e:
        security_deny("AUTH_GATE", e.status_code, e.detail)


def _declares_auth(dependant) -> bool:
    return any(
        d.call in _AUTH_CALLS or _declares_auth(d) for d in dependant.dependencies
    )


def enforce_auth_by_default(app) -> list:
    """Give every route that declares neither auth nor a marker the login gate.
    Returns the paths it gated (logged at startup — each is a route whose
    author forgot auth)."""
    from fastapi.routing import APIRoute
    from fastapi.dependencies.utils import get_parameterless_sub_dependant
    gated = []
    for route in app.routes:
        if isinstance(route, APIRoute) and not _declares_auth(route.dependant):
            # Same mechanism FastAPI uses for router-level dependencies=[...].
            route.dependant.dependencies.insert(
                0, get_parameterless_sub_dependant(depends=Depends(_auth_gate), path=route.path_format))
            gated.append(f"{','.join(sorted(route.methods))} {route.path}")
    if gated:
        security_log.warning("auth gate added to %d unmarked route(s): %s", len(gated), gated)
    return gated


def require_admin(user: dict = Depends(get_current_user)):
    """Requires Super Admin, Admin (V1), or Pod Admin role."""
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

def require_super_admin(user: dict = Depends(get_current_user)):
    """Requires Super Admin role only (also accepts V1 'Admin')."""
    if user.get("role") not in ("Super Admin", "Admin"):
        raise HTTPException(status_code=403, detail="Super Admin access required")
    return user

def require_pod_admin_or_above(user: dict = Depends(get_current_user)):
    """Requires Pod Admin or Super Admin role."""
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Pod Admin or Super Admin access required")
    return user

def require_metric_editor(user: dict = Depends(get_current_user)):
    """Metric Registry governance: draft/preview a metric definition. Pod Admin or above."""
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Pod Admin or Super Admin access required")
    return user

def require_metric_publisher(user: dict = Depends(get_current_user)):
    """Metric Registry governance: publish a metric definition. Super Admin only."""
    if user.get("role") not in ("Super Admin", "Admin"):
        raise HTTPException(status_code=403, detail="Super Admin access required")
    return user

def require_admin_or_ae(user: dict = Depends(get_current_user)):
    """Analytics Hub access: admin roles (full pod/org scope) or AE/SDR (forced
    self-only scope — see analytics_routes._effective_ae_sdr)."""
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin", "AE", "SDR"):
        raise HTTPException(status_code=403, detail="Admin, AE, or SDR access required")
    return user

def require_admin_or_csm(user: dict = Depends(get_current_user)):
    """CSM Portal access: Super Admin/Admin (full-org visibility, bulk
    assignment), Pod Admin (read-only oversight of the CSMs in their own
    pod — same User.pod_id convention leaderboard_routes/analytics_digest_
    routes already use for Pod Admin scoping, see
    csm_portal_routes._effective_csm_scope), or CSM (own portfolio only).

    Decided 2026-09-17: a CSM (e.g. Kanika) with reportee CSMs gets a Pod
    created for her team; she's made that pod's Pod Admin and can then see
    (not edit — csm_portal_routes._require_account_write_access still
    requires her to actually be the assigned CSM) her team's combined
    portfolio here."""
    if user.get("role") not in ("Super Admin", "Admin", "CSM", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Admin or CSM access required")
    return user

# ── Public API key auth (for external tools — no Google SSO required) ─────────
def require_api_key(
    x_api_key: str = Depends(
        __import__("fastapi.security", fromlist=["api_key"]).APIKeyHeader(name="X-API-Key", auto_error=False)
    ),
    db: Session = Depends(get_db)
):
    """FastAPI dependency — validates X-API-Key header against the encrypted key stored in Settings.

    Priority:
      1. DB: sync_settings.public_api_key (decrypted, admin-managed via Settings UI)
      2. Env fallback: ALTERNATE_CRM_API_KEY (for first-time setup before DB key is set)
    """
    import hmac
    from crypto import decrypt_token
    import models as _models

    if not x_api_key:
        raise HTTPException(status_code=401, detail="API key required. Pass X-API-Key header.")

    # ── Step 1: Try DB-stored key ─────────────────────────────────────────────
    try:
        settings = db.query(_models.SyncSettings).filter(_models.SyncSettings.id == 1).first()
        if settings and settings.public_api_key:
            stored_plain = decrypt_token(settings.public_api_key)
            if hmac.compare_digest(stored_plain, x_api_key):
                settings.public_api_call_count = (settings.public_api_call_count or 0) + 1
                settings.public_api_last_used_at = datetime.now(timezone.utc)
                db.commit()
                return True
            # Key present but wrong — fail immediately, don't fall through to env var
            raise HTTPException(status_code=401, detail="Invalid API key.")
    except HTTPException:
        raise
    except Exception:
        pass  # DB unavailable — try env var fallback

    # ── Step 2: Env var fallback (for first-time setup) ───────────────────────
    env_key = os.getenv("ALTERNATE_CRM_API_KEY", "")
    if env_key and hmac.compare_digest(env_key, x_api_key):
        return True

    raise HTTPException(status_code=401, detail="Invalid API key.")


# Any of these in a route's dependency tree counts as "declares auth".
_AUTH_CALLS = {get_current_user, require_api_key, public_endpoint, authenticates_itself, _auth_gate}


# ── Google OAuth helpers ──────────────────────────────────────────────────────
def google_auth_url(state: str = "") -> str:
    import urllib.parse
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "offline",
        "state":         state,
    }
    # urlencode properly percent-encodes state (e.g. https://... → https%3A%2F%2F...)
    # Without this, Google strips/drops state values containing "://"
    return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"

async def exchange_code_for_user(code: str) -> dict:
    """Exchange the OAuth code for user info from Google."""
    async with httpx.AsyncClient() as client:
        # Exchange code for tokens
        token_resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  GOOGLE_REDIRECT_URI,
            "grant_type":    "authorization_code",
        })
        token_resp.raise_for_status()
        tokens = token_resp.json()

        # Fetch user info
        info_resp = await client.get(GOOGLE_USERINFO, headers={
            "Authorization": f"Bearer {tokens['access_token']}"
        })
        info_resp.raise_for_status()
        return info_resp.json()   # {sub, email, name, picture, ...}



# ── Data export is off unless a Super Admin switched it on for that person ───
# Every CSV / Excel download goes through this. Super Admin (and the legacy "Admin") may by default; everyone else — Pod Admin,
# SDR, AE, CSM — only when users.export_enabled is on. users.export_blocked switches anyone off, Super Admins included. Read from the database on every call (never from the token), so a
# revoke bites at once. It is an extra condition, not a replacement: a route's own role check still applies.
EXPORT_ALWAYS_ROLES = ("Super Admin", "Admin")
EXPORT_DENIED_MESSAGE = "Exporting data is turned off for your account. Ask a Super Admin to switch it on."


def may_export(role, enabled, blocked) -> bool:
    """The one rule: a block beats everything (even a Super Admin); else Super Admin always; else the per-user switch."""
    return not blocked and (role in EXPORT_ALWAYS_ROLES or bool(enabled))


def export_allowed(db: Session, user: dict) -> bool:
    if user.get("view_as_read_only"):          # a Pod Admin looking at someone's screen never downloads their data
        return False
    import models
    row = db.query(models.User.role, models.User.export_enabled, models.User.export_blocked).filter(models.User.id == user.get("sub")).first()
    if row is None:                            # no user row (e.g. a service identity): the token's role decides, as before
        return user.get("role") in EXPORT_ALWAYS_ROLES
    return may_export(row.role, row.export_enabled, row.export_blocked)


def check_export_access(db: Session, user: dict, what: str = "", action: str = None, label: str = None, rows: int = None):
    """Raise 403 unless this user may export; write every allowed export to the permanent audit trail first (who, what, when).
    If the record cannot be written the export is refused: no record, no download."""
    if not export_allowed(db, user):
        security_log.warning("export_denied user=%s role=%s what=%s", user.get("sub"), user.get("role"), what)
        raise HTTPException(status_code=403, detail=EXPORT_DENIED_MESSAGE)
    from services import audit
    bulk = "?per_page=" in (what or "")
    try:
        audit.record_now(db, user, "export", action or ("BULK_READ" if bulk else "DOWNLOAD"),
                         label or (("Bulk list read: " if bulk else "") + audit.export_label(what)),
                         {"path": (what or "").split("?")[0], **({"query": what.split("?", 1)[1]} if bulk else {}), **({"rows": rows} if rows else {})})
    except Exception:
        db.rollback()
        security_log.error("export_audit_failed user=%s what=%s", user.get("sub"), what, exc_info=True)
        raise HTTPException(status_code=503, detail="This export is temporarily unavailable because it could not be recorded. Try again in a moment.")


def require_export_access(request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Route dependency: `@router.get(..., dependencies=[Depends(require_export_access)])` on anything that produces a file."""
    check_export_access(db, user, request.url.path)
    return user


def export_allowed_for_user_id(db: Session, user_id) -> bool:
    """Same rule for someone who is not the caller (a scheduled report's owner at send time)."""
    import models
    row = db.query(models.User.role, models.User.export_enabled, models.User.export_blocked).filter(models.User.id == user_id).first()
    return bool(row and may_export(row.role, row.export_enabled, row.export_blocked))


# A bigger page than any screen asks for is a bulk pull (the Activity / Call Monitor "Export CSV" fetches 2,000 rows from the
# list API and builds the file in the browser), so it is an export and needs the same permission.
BULK_PAGE_LIMIT = 200


def check_bulk_read(db: Session, user: dict, per_page: int, what: str):
    if per_page and per_page > BULK_PAGE_LIMIT:
        check_export_access(db, user, f"{what}?per_page={per_page}")
