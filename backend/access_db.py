"""
User access control layer.
Uses the same SQLAlchemy database as the rest of the CRM (crm.db / PostgreSQL).
The `allowed_users` table is the source of truth for who can log into the application.
"""
from sqlalchemy.orm import Session
import models


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
        if role_in_csv == "admin":
            skipped.append(f"{email}: Admin users can only be managed via portal")
            continue

        if action == "add":
            # Honour role column: AE → AE, anything else → SDR (admins blocked above)
            assigned_role = "AE" if role_in_csv == "ae" else "SDR"
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
