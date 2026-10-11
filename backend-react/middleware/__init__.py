"""
Authentication middleware — JWT creation/verification and role-based guards.
"""
from datetime import datetime, timedelta
from jose import jwt, JWTError
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from config import settings

JWT_SECRET    = settings.JWT_SECRET
JWT_ALGORITHM = settings.JWT_ALGORITHM
JWT_EXPIRE_HOURS = settings.JWT_EXPIRE_HOURS

bearer_scheme = HTTPBearer(auto_error=False)


# ── JWT Helpers ──────────────────────────────────────────────────────────────

def create_jwt(data: dict, expires_hours: int = None) -> str:
    """Create a JWT token with the given payload."""
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=expires_hours or JWT_EXPIRE_HOURS)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    """Decode and verify a JWT token."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


# ── FastAPI Dependencies ─────────────────────────────────────────────────────

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    """FastAPI dependency — inject into any route to require auth."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_jwt(credentials.credentials)


def require_admin(user: dict = Depends(get_current_user)):
    """Requires Super Admin, Admin (legacy), or Pod Admin role."""
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_super_admin(user: dict = Depends(get_current_user)):
    """Requires Super Admin role only (also accepts legacy 'Admin')."""
    if user.get("role") not in ("Super Admin", "Admin"):
        raise HTTPException(status_code=403, detail="Super Admin access required")
    return user


def require_pod_admin_or_above(user: dict = Depends(get_current_user)):
    """Requires Pod Admin or Super Admin role."""
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Pod Admin or Super Admin access required")
    return user
