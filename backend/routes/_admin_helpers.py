# ── routes/_admin_helpers.py — Shared private helpers for admin sub-modules ──
#
# Extracted from admin_routes.py so that:
#   - routes/pod_routes.py      can import _get_active_lead_cap, _active_lead_count
#   - routes/ai_research_routes.py can import _get_or_create_sync_settings
# without creating circular imports.
#
# DO NOT add route decorators here — this is a pure utility module.

import os
import models
from models import ACTIVE_STATUSES
from sqlalchemy import func


# ── SDR Lead Cap ─────────────────────────────────────────────────────────────

def _get_active_lead_cap(db, user):
    """Get the active lead cap for an SDR. Checks pod-level cap first, falls back to global default."""
    if user.pod_id:
        # Explicitly query the pod if the relationship isn't loaded (lazy-load edge case)
        pod = user.pod if user.pod else db.query(models.Pod).filter(models.Pod.id == user.pod_id).first()
        if pod and pod.active_lead_cap is not None:
            return pod.active_lead_cap
    # Fallback to global setting
    settings = _get_or_create_sync_settings(db)
    return settings.active_lead_cap if settings.active_lead_cap is not None else 500


def _active_lead_count(user, db=None):
    """Count leads assigned to user that are in active (non-terminal) statuses.

    Uses a direct SQL COUNT query instead of the ORM relationship to avoid
    stale in-memory collections during bulk inserts.
    """
    if db is not None:
        count = db.query(func.count(models.Lead.id)).join(
            models.lead_assignments,
            models.lead_assignments.c.lead_id == models.Lead.id
        ).filter(
            models.lead_assignments.c.user_id == user.id,
            models.Lead.status.in_(ACTIVE_STATUSES)
        ).scalar()
        return count or 0
    # Fallback to ORM (for backward compat with non-bulk callers)
    return len([l for l in user.assigned_leads if l.status in ACTIVE_STATUSES])


# ── SyncSettings helper ──────────────────────────────────────────────────────

def _get_or_create_sync_settings(db) -> models.SyncSettings:
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        default_limit = int(os.getenv("SF_LEAD_LIMIT", 1000))
        settings = models.SyncSettings(id=1, lead_limit=default_limit, record_type_ids=None)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


# ── Email validation ─────────────────────────────────────────────────────────

def _is_valid_email(val):
    """Quick email format check: must contain @ with a non-empty local part and a dotted domain."""
    if not val or "@" not in val:
        return False
    local, _, domain = val.rpartition("@")
    return bool(local.strip()) and "." in domain


# ── Duplicate lead detection (single-record) ────────────────────────────────

def _find_duplicate_lead(db, email=None, linkedin_url=None, person_linkedin=None,
                          phone=None, first_name=None, last_name=None, company=None):
    """
    Check whether a lead matching this contact already exists.

    Same priority order as the CSV/Google Sheet import dedup (Email → LinkedIn
    → Phone → Name+Company) in admin_upload_routes.py, but for a single record
    (no pre-fetched batch sets needed — one direct query per tier).

    RCA-2026-07-20: manual lead creation (POST /leads) had no dedup at all,
    unlike the import paths — this let the same contact get re-added
    repeatedly, and each duplicate local lead independently pushes to
    Salesforce as a brand-new Lead on every sync (see push_pending_leads_to_salesforce).

    Returns the existing models.Lead if found, else None.
    """
    if email and _is_valid_email(email):
        existing = db.query(models.Lead).filter(models.Lead.email == email).first()
        if existing:
            return existing

    if linkedin_url or person_linkedin:
        li = linkedin_url or person_linkedin
        existing = db.query(models.Lead).filter(
            (models.Lead.linkedin_url == li) | (models.Lead.person_linkedin == li)
        ).first()
        if existing:
            return existing

    if phone:
        phone_digits = ''.join(c for c in phone if c.isdigit())[-10:]
        if phone_digits and len(phone_digits) >= 7:
            existing = db.query(models.Lead).filter(
                models.Lead.phone.isnot(None),
                func.right(func.regexp_replace(models.Lead.phone, r'[^0-9]', '', 'g'), 10) == phone_digits
            ).first()
            if existing:
                return existing

    first = (first_name or "").strip()
    last = (last_name or "").strip()
    comp = (company or "").strip()
    if first and last and comp:
        existing = db.query(models.Lead).filter(
            models.Lead.first_name.ilike(first),
            models.Lead.last_name.ilike(last),
            models.Lead.company.ilike(f"%{comp}%")
        ).first()
        if existing:
            return existing

    return None


# ── Phone validation ─────────────────────────────────────────────────────────

def _has_valid_phone(phone_val):
    """Check if a phone string contains at least 7 digits (a callable number)."""
    if not phone_val:
        return False
    digits = ''.join(c for c in str(phone_val) if c.isdigit())
    return len(digits) >= 7


def _lead_data_has_phone(lead_data):
    """Check if lead_data dict has any valid phone across phone, phone_secondary, company_phone.
    If phone is missing but secondary/company has one, promote it to phone.
    Returns True if a valid phone exists (after promotion), False otherwise."""
    if _has_valid_phone(lead_data.get("phone")):
        return True
    # Try promoting phone_secondary → phone
    if _has_valid_phone(lead_data.get("phone_secondary")):
        lead_data["phone"] = lead_data.pop("phone_secondary")
        return True
    # Try promoting company_phone → phone
    if _has_valid_phone(lead_data.get("company_phone")):
        lead_data["phone"] = lead_data["company_phone"]
        return True
    return False


# ── Round-robin assignment ───────────────────────────────────────────────────

def _assign_lead_round_robin(db, new_lead, pod_sdrs, batch_counts, company_sdr_map, company_key, cap):
    """Assign a single lead using fair round-robin with company grouping.

    Uses batch_counts (dict: sdr_id -> int) to track how many leads each SDR
    has been assigned in THIS batch, ensuring fair distribution regardless of
    pre-existing active lead counts.

    Returns the assigned SDR or None if all SDRs are at cap.
    """
    pod_sdr_ids = {s.id for s in pod_sdrs}
    pod_sdr_map = {s.id: s for s in pod_sdrs}

    # 1) Same-company affinity: if this company was already assigned to an SDR in this batch
    if company_key and company_key in company_sdr_map:
        prev_sdr = company_sdr_map[company_key]
        current = _active_lead_count(prev_sdr, db) + batch_counts.get(prev_sdr.id, 0)
        if cap == 0 or current < cap:
            batch_counts[prev_sdr.id] = batch_counts.get(prev_sdr.id, 0) + 1
            return prev_sdr

    # 2) Cross-batch company ownership: check if an SDR in this pod already owns
    #    a lead at the same company from a previous batch
    if company_key:
        existing_owner = (
            db.query(models.lead_assignments.c.user_id)
            .join(models.Lead, models.lead_assignments.c.lead_id == models.Lead.id)
            .filter(
                func.lower(func.trim(models.Lead.company)) == company_key,
                models.lead_assignments.c.user_id.in_(pod_sdr_ids),
            )
            .first()
        )
        if existing_owner and existing_owner.user_id in pod_sdr_map:
            owner_sdr = pod_sdr_map[existing_owner.user_id]
            current = _active_lead_count(owner_sdr, db) + batch_counts.get(owner_sdr.id, 0)
            if cap == 0 or current < cap:
                batch_counts[owner_sdr.id] = batch_counts.get(owner_sdr.id, 0) + 1
                company_sdr_map[company_key] = owner_sdr
                return owner_sdr

    # 3) Fair round-robin: pick SDR with fewest batch assignments (ties broken by fewest active)
    candidates = []
    for sdr in pod_sdrs:
        current = _active_lead_count(sdr, db) + batch_counts.get(sdr.id, 0)
        if cap > 0 and current >= cap:
            continue
        candidates.append((batch_counts.get(sdr.id, 0), current, sdr))

    if not candidates:
        return None  # All SDRs at cap

    # Sort by: batch count first (fairness), then total active (balance)
    candidates.sort(key=lambda x: (x[0], x[1]))
    chosen_sdr = candidates[0][2]

    batch_counts[chosen_sdr.id] = batch_counts.get(chosen_sdr.id, 0) + 1
    if company_key:
        company_sdr_map[company_key] = chosen_sdr
    return chosen_sdr


# ── Column mapping for CSV/Sheet uploads ─────────────────────────────────────

COLUMN_MAP = {
    "first name": "first_name", "firstname": "first_name", "first_name": "first_name",
    "last name": "last_name", "lastname": "last_name", "last_name": "last_name",
    "email": "email", "email address": "email", "email_address": "email",
    "phone": "phone", "mobile": "phone",
    "phone number": "phone", "phone numbers": "phone", "phone_number": "phone",
    "direct phone": "phone", "direct phone number": "phone", "direct_phone": "phone",
    "work phone": "phone", "work phone number": "phone", "work_phone": "phone",
    "contact phone": "phone", "contact number": "phone", "contact_phone": "phone",
    "mobile phone": "phone", "mobile number": "phone", "mobile_phone": "phone",
    "cell phone": "phone", "cell": "phone",
    "person phone": "phone", "person phone number": "phone", "person_phone": "phone",
    "telephone": "phone", "tel": "phone",
    "primary phone": "phone", "primary_phone": "phone",
    "company": "company", "company name": "company", "company_name": "company",
    "job title": "title", "title": "title", "job_title": "title",
    "linkedin url": "linkedin_url", "linkedin": "linkedin_url", "linkedin_url": "linkedin_url",
    "person linkedin": "person_linkedin", "person linked": "person_linkedin", "person_linkedin": "person_linkedin",
    "website": "website",
    "city": "city", "state": "state", "country": "country",
    "industry": "industry",
    "# employees": "employee_count", "employees": "employee_count", "employee_count": "employee_count",
    "annual revenue": "annual_revenue", "revenue": "annual_revenue", "annual_revenue": "annual_revenue",
    "total funding": "total_funding", "funding": "total_funding", "total_funding": "total_funding",
    "company phone": "company_phone", "company_phone": "company_phone",
    "secondary phone": "phone_secondary", "phone secondary": "phone_secondary", "phone_secondary": "phone_secondary",
    "other phone": "phone_secondary", "alternate phone": "phone_secondary",
    "home phone": "phone_secondary", "personal phone": "phone_secondary",
    "company linkedin": "company_linkedin", "company linked": "company_linkedin", "company_linkedin": "company_linkedin",
    "company street": "company_street", "company_street": "company_street",
    "company city": "company_city", "company_city": "company_city",
    "company postal code": "company_postal_code", "company postcode": "company_postal_code", "company_postal_code": "company_postal_code",
    "company state": "company_state", "company_state": "company_state",
    "company country": "company_country", "company_country": "company_country",
    "company founded": "company_founded", "company_founded": "company_founded",
    "lead source": "lead_source", "lead_source": "lead_source", "source": "lead_source",
}

# Phone priority columns (first non-empty wins)
PHONE_COLUMNS = [
    "enriched mobile", "enriched mobi", "enriched work", "enriched home", "enriched other",
    "enriched mobile phone", "enriched work phone", "enriched home phone", "enriched other phone",
    "phone", "mobile", "phone number", "phone numbers",
    "direct phone", "direct phone number", "work phone", "work phone number",
    "contact phone", "contact number", "mobile phone", "mobile number",
    "cell phone", "cell", "person phone", "person phone number",
    "telephone", "tel", "primary phone",
]
