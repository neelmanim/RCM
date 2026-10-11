"""
User access control layer.
Uses the same SQLAlchemy database as the rest of the CRM (crm.db / PostgreSQL).
The `allowed_users` table is the source of truth for who can log into the application.
"""
import time
from sqlalchemy.orm import Session
import models
from domain.actor import VALID_ROLES

# ponytail: per-process cache, so a removal/demotion takes effect within
# IDENTITY_TTL_SECONDS without a DB hit on every request.
IDENTITY_TTL_SECONDS = 60
_identity_cache: dict = {}


def active_identity(db: Session, user_id: str):
    """(email, role, pod_id) for a user who still exists AND is still on the
    allowed list, else None. The per-request source of truth for a JWT holder's
    role and pod (see auth.authenticate)."""
    hit = _identity_cache.get(user_id)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    user = db.query(models.User).filter(models.User.id == user_id).first()
    ident = (user.email, user.role, pod_for(db, user)) if user and is_user_allowed(db, user.email or "") else None
    _identity_cache[user_id] = (time.monotonic() + IDENTITY_TTL_SECONDS, ident)
    return ident


NO_POD = "__no_pod__"   # matches no pod, so a pod-less Pod Admin sees nothing instead of everything


def pod_of(identity: dict) -> str:
    """The pod a request is scoped to (a Pod Admin's own; NO_POD when none), from the authenticated identity dict."""
    return identity.get("pod_id") or NO_POD


def pod_for(db: Session, user):
    """The pod a user is scoped to. Many routes apply the pod filter only `if Pod Admin and pod_id`, so a Pod Admin
    with no pod would silently get org-wide data: fall back to their pod_admins row, then to a pod that matches nothing."""
    if user.role != "Pod Admin" or user.pod_id:
        return user.pod_id
    row = db.query(models.PodAdmin.pod_id).filter(models.PodAdmin.user_id == user.id).first()
    return row[0] if row else NO_POD


def forget_identity():
    """Drop cached identities — call after changing a user's role/pod/access."""
    _identity_cache.clear()


def is_user_allowed(db: Session, email: str) -> bool:
    """Check if an email is permitted to log in."""
    row = db.query(models.AllowedUser).filter(
        models.AllowedUser.email == email.strip().lower()
    ).first()
    return row is not None


def add_allowed_user(db: Session, email: str, name: str = "", role: str = "SDR", added_by: str = "system") -> bool:
    """Add a user to the access list. Returns True if added, False if already exists."""
    email = email.strip().lower()
    existing = db.query(models.AllowedUser).filter(models.AllowedUser.email == email).first()
    if existing:
        return False
    entry = models.AllowedUser(email=email, name=name, role=role, added_by=added_by)
    db.add(entry)
    # This is the single place a user is actually granted access (single-add
    # and CSV import both call it) — so it's also the single place a pending
    # AccessRequest for that email gets resolved, rather than needing an
    # admin to separately dismiss it.
    pending = db.query(models.AccessRequest).filter(models.AccessRequest.email == email).first()
    if pending:
        db.delete(pending)
    db.commit()
    return True


def remove_allowed_user(db: Session, email: str) -> bool:
    """Remove a user from the access list. Returns True if removed."""
    entry = db.query(models.AllowedUser).filter(
        models.AllowedUser.email == email.strip().lower()
    ).first()
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    forget_identity()  # revoke now, not after the cache TTL
    return True


def get_allowed_user(db: Session, email: str):
    """Get a single allowed user record by email."""
    return db.query(models.AllowedUser).filter(
        models.AllowedUser.email == email.strip().lower()
    ).first()


def list_allowed_users(db: Session) -> list:
    """Return all allowed users."""
    return db.query(models.AllowedUser).order_by(models.AllowedUser.added_at.desc()).all()


def process_csv(db: Session, csv_content: str, admin_email: str) -> dict:
    """
    Process a CSV to add/remove SDR users.

    Supported column formats (case-insensitive):
      - email / Email / EMAIL
      - name / Name / First Name + Last Name
      - action / Action  (defaults to 'add' if missing)
      - role / Role      (rows with role=admin are skipped)

    Returns: { added: [emails], removed: [emails], skipped: [reasons] }
    """
    import csv
    import io

    reader = csv.DictReader(io.StringIO(csv_content))
    added = []
    removed = []
    skipped = []

    # Build case-insensitive header lookup: normalized_key → original_key
    headers = reader.fieldnames or []
    hmap = {h.strip().lower(): h for h in headers}

    def _get(row, *keys):
        """Get a value from the row, trying multiple case-insensitive keys."""
        for key in keys:
            orig = hmap.get(key.lower())
            if orig and row.get(orig):
                return row[orig].strip()
        return ""

    for row in reader:
        email = _get(row, "email", "e-mail", "email address").lower()

        # Build name from 'name' or 'first name' + 'last name'
        name = _get(row, "name", "full name")
        if not name:
            first = _get(row, "first name", "first_name", "firstname")
            last = _get(row, "last name", "last_name", "lastname")
            name = f"{first} {last}".strip()

        # Default action to 'add' when column is missing
        action = _get(row, "action").lower() or "add"

        if not email:
            skipped.append("Empty email row skipped")
            continue

        # Block any row that tries to manage Admin users via CSV
        role_in_csv = _get(row, "role").lower()
        if role_in_csv in ("admin", "super admin", "pod admin"):
            skipped.append(f"{email}: Admin users can only be managed via portal")
            continue

        if action == "add":
            # Honour role column against the individual-contributor-tier roles
            # only (SDR/AE/CSM) — Pod Admin/Super Admin are blocked above and
            # must never become reachable here even by a VALID_ROLES lookup,
            # since CSV bulk import must not be able to grant an admin tier.
            _csv_eligible_roles = {"SDR", "AE", "CSM"}
            _role_by_lower = {r.lower(): r for r in VALID_ROLES if r in _csv_eligible_roles}
            assigned_role = _role_by_lower.get(role_in_csv, "SDR")
            was_added = add_allowed_user(db, email, name, assigned_role, admin_email)
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
            skipped.append(f"{email}: invalid action '{action}' (must be 'add' or 'remove')")

    return {"added": added, "removed": removed, "skipped": skipped}
