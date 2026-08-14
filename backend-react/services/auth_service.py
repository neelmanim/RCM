"""
Auth service — business logic for authentication, login, and session management.
Pure functions, no FastAPI dependency.
"""
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from models import User, AllowedUser, LoginLog, log_user_login


# ── Access Control ───────────────────────────────────────────────────────────

def is_user_allowed(db: Session, email: str) -> bool:
    row = db.query(AllowedUser).filter(AllowedUser.email == email.strip().lower()).first()
    return row is not None


def add_allowed_user(db: Session, email: str, name: str = "", role: str = "SDR", added_by: str = "system") -> bool:
    email = email.strip().lower()
    existing = db.query(AllowedUser).filter(AllowedUser.email == email).first()
    if existing:
        return False
    entry = AllowedUser(email=email, name=name, role=role, added_by=added_by)
    db.add(entry)
    db.commit()
    return True


def remove_allowed_user(db: Session, email: str) -> bool:
    entry = db.query(AllowedUser).filter(AllowedUser.email == email.strip().lower()).first()
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    return True


def get_allowed_user(db: Session, email: str):
    return db.query(AllowedUser).filter(AllowedUser.email == email.strip().lower()).first()


def list_allowed_users(db: Session) -> list:
    return db.query(AllowedUser).order_by(AllowedUser.added_at.desc()).all()


# ── CSV Processing ───────────────────────────────────────────────────────────

def process_csv(db: Session, csv_content: str, admin_email: str) -> dict:
    """Process a CSV to add/remove SDR users."""
    import csv
    import io

    reader = csv.DictReader(io.StringIO(csv_content))
    added, removed, skipped = [], [], []

    headers = reader.fieldnames or []
    hmap = {h.strip().lower(): h for h in headers}

    def _get(row, *keys):
        for key in keys:
            orig = hmap.get(key.lower())
            if orig and row.get(orig):
                return row[orig].strip()
        return ""

    for row in reader:
        email = _get(row, "email", "e-mail", "email address").lower()
        name = _get(row, "name", "full name")
        if not name:
            first = _get(row, "first name", "first_name", "firstname")
            last = _get(row, "last name", "last_name", "lastname")
            name = f"{first} {last}".strip()

        action = _get(row, "action").lower() or "add"

        if not email:
            skipped.append("Empty email row skipped")
            continue

        role_in_csv = _get(row, "role").lower()
        if role_in_csv == "admin":
            skipped.append(f"{email}: Admin users can only be managed via portal")
            continue

        if action == "add":
            was_added = add_allowed_user(db, email, name, "SDR", admin_email)
            if was_added:
                added.append(email)
            else:
                skipped.append(f"{email}: already exists")
        elif action == "remove":
            was_removed = remove_allowed_user(db, email)
            if was_removed:
                removed.append(email)
            else:
                skipped.append(f"{email}: not found in access list")
        else:
            skipped.append(f"{email}: invalid action '{action}'")

    return {"added": added, "removed": removed, "skipped": skipped}


# ── Login / User Provisioning ────────────────────────────────────────────────

ROLE_MAP = {
    "Super Admin": "Super Admin", "Admin": "Super Admin", "admin": "Super Admin",
    "Pod Admin": "Pod Admin", "Pod_Admin": "Pod Admin"
}


def process_login(db: Session, google_user: dict, request=None):
    """Process Google OAuth login — creates or syncs user. Returns (user, is_new)."""
    google_id = google_user["sub"]
    email = google_user["email"].strip().lower()
    name = google_user.get("name", "")

    user = db.query(User).filter(
        (User.google_id == google_id) | (User.email == email)
    ).first()

    if not user:
        no_allowed = db.query(AllowedUser).count() == 0
        existing_count = db.query(User).count()
        if existing_count == 0 or no_allowed:
            role = "Super Admin"
            user = User(google_id=google_id, email=email, name=name, role=role)
            db.add(user)
            db.commit()
            db.refresh(user)
            add_allowed_user(db, email, name, "Super Admin", "system-first-user")
        else:
            if not is_user_allowed(db, email):
                return None, False  # Not allowed
            access_info = get_allowed_user(db, email)
            role_str = access_info.role if access_info else "SDR"
            db_role = ROLE_MAP.get(role_str, "SDR")
            user = User(google_id=google_id, email=email, name=name, role=db_role)
            db.add(user)
            db.commit()
            db.refresh(user)
    else:
        no_allowed = db.query(AllowedUser).count() == 0
        if no_allowed:
            add_allowed_user(db, email, user.name or name, "Super Admin", "system-bootstrap")
            user.role = "Super Admin"
        else:
            if not is_user_allowed(db, email):
                return None, False
            access_info = get_allowed_user(db, email)
            if access_info:
                synced_role = ROLE_MAP.get(access_info.role, access_info.role or "SDR")
                if user.role != synced_role:
                    user.role = synced_role
        if not user.google_id:
            user.google_id = google_id
        user.name = name
        db.commit()

    user.last_login_at = datetime.now(timezone.utc)

    # Record login
    client_ip = request.client.host if request and request.client else None
    ua = request.headers.get("user-agent", "")[:255] if request else None
    log_user_login(db, user.id, user.email, name=user.name, role=user.role, ip_address=client_ip, user_agent=ua)
    db.commit()

    return user, True


def close_sessions(db: Session, user_id: str):
    """Close all open sessions for a user."""
    now = datetime.now(timezone.utc)
    open_sessions = db.query(LoginLog).filter(
        LoginLog.user_id == user_id,
        LoginLog.logout_at == None,
    ).all()
    for s in open_sessions:
        s.logout_at = now
        if not s.last_heartbeat_at:
            s.last_heartbeat_at = now
    db.commit()


def heartbeat(db: Session, user_id: str):
    """Update heartbeat on latest open session."""
    session = db.query(LoginLog).filter(
        LoginLog.user_id == user_id,
        LoginLog.logout_at == None,
    ).order_by(LoginLog.login_at.desc()).first()
    if session:
        session.last_heartbeat_at = datetime.now(timezone.utc)
        db.commit()
