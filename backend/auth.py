import os
import httpx
from jose import jwt, JWTError
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from database import get_db
from datetime import datetime, timedelta

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

# ── Bearer token extractor ────────────────────────────────────────────────────
bearer_scheme = HTTPBearer(auto_error=False)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    """FastAPI dependency — inject into any route to require auth."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_jwt(credentials.credentials)

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

def require_admin_or_ae(user: dict = Depends(get_current_user)):
    """Analytics Hub access: admin roles (full pod/org scope) or AE (forced
    self-only scope — see analytics_routes._effective_ae_sdr)."""
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin", "AE"):
        raise HTTPException(status_code=403, detail="Admin or AE access required")
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
      2. Env fallback: RCM_API_KEY (for first-time setup before DB key is set)
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
                return True
            # Key present but wrong — fail immediately, don't fall through to env var
            raise HTTPException(status_code=401, detail="Invalid API key.")
    except HTTPException:
        raise
    except Exception:
        pass  # DB unavailable — try env var fallback

    # ── Step 2: Env var fallback (for first-time setup) ───────────────────────
    env_key = os.getenv("RCM_API_KEY", "")
    if env_key and hmac.compare_digest(env_key, x_api_key):
        return True

    raise HTTPException(status_code=401, detail="Invalid API key.")


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
