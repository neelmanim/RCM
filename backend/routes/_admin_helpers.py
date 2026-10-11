# ── routes/_admin_helpers.py — Shared private helpers for admin sub-modules ──
#
# Extracted from admin_routes.py so that:
#   - routes/admin_user_routes.py  can import _get_active_lead_cap, _active_lead_count
#   - routes/ai_research_routes.py can import _get_or_create_sync_settings
# without creating circular imports.
#
# DO NOT add route decorators here — this is a pure utility module.

import os
import models
from models import ACTIVE_STATUSES
from sqlalchemy import func


# ── Sortable list endpoints ──────────────────────────────────────────────────

def resolve_sort(sort_by, columns, default_col=None):
    """Turn a `sort_by` query param into an (order_by column, descending) pair.

    `columns` maps the allowed sort keys to their SQLAlchemy column. A
    `-`-prefixed key means descending; an unknown/missing key falls back to
    `default_col` descending (or, with `default_col=None`, signals the caller
    to leave its own default `order_by` untouched via a `None` column).
    Shared by every route below that grew its own copy of this: journey_routes,
    email_campaign_routes, report_routes, analytics_routes, admin_routes,
    activity_monitor_routes, admin_upload_routes.
    """
    key = (sort_by or "").lstrip("-")
    col = columns.get(key, default_col)
    if col is None:
        return None, False
    desc = key not in columns or (sort_by or "").startswith("-")
    return col, desc


# ── SDR Lead Cap ─────────────────────────────────────────────────────────────

def _get_active_lead_cap(db, user):
    """Get the SDR lead-cap value — always the single global setting.

    RCA 2026-09-22: this used to be enforced (blocking bulk_assign,
    assign_leads_to_pod, and CSV/Sheet upload-import once an SDR hit this
    count) — that enforcement was removed org-wide as a deprecated feature.
    The value now only feeds admin_user_routes.py's per-user `max_active`
    display, which BulkActionBar.jsx uses to softly rank/label SDRs in the
    manual assign picker (never blocks); `user` is unused but kept in the
    signature since every caller passes it.
    """
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


def get_conversation_min_seconds(db) -> int:
    """The org's configured conversation-length threshold, used by both
    models.dialer_call_connected() and models.dialer_call_is_conversation()
    — shared so every call site passes the same real setting instead of
    each one falling back to the hardcoded default independently."""
    return _get_or_create_sync_settings(db).conversation_min_seconds or models.CONVERSATION_MIN_SECONDS


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

    Returns the existing models.Lead if found, else None. Deleted leads and
    Cadence Sandbox test leads never count: re-adding a deleted contact is
    legitimate, and every sandbox lead shares the sandbox phone — matching
    them blocked creation with "already exists" pointing at a lead nobody
    can open.
    """
    leads = lambda: models.exclude_test_leads(models.exclude_deleted_leads(db.query(models.Lead)))
    if email and _is_valid_email(email):
        existing = leads().filter(models.Lead.email == email).first()
        if existing:
            return existing

    if linkedin_url or person_linkedin:
        li = linkedin_url or person_linkedin
        existing = leads().filter(
            (models.Lead.linkedin_url == li) | (models.Lead.person_linkedin == li)
        ).first()
        if existing:
            return existing

    if phone:
        phone_digits = ''.join(c for c in phone if c.isdigit())[-10:]
        if phone_digits and len(phone_digits) >= 7:
            existing = leads().filter(
                models.Lead.phone.isnot(None),
                func.right(func.regexp_replace(models.Lead.phone, r'[^0-9]', '', 'g'), 10) == phone_digits
            ).first()
            if existing:
                return existing

    first = (first_name or "").strip()
    last = (last_name or "").strip()
    comp = (company or "").strip()
    if first and last and comp:
        existing = leads().filter(
            models.Lead.first_name.ilike(first),
            models.Lead.last_name.ilike(last),
            models.Lead.company.ilike(f"%{comp}%")
        ).first()
        if existing:
            return existing

    return None


def duplicate_match_field(lead, email=None, linkedin_url=None, person_linkedin=None, phone=None) -> str:
    """Which field made `lead` a duplicate — same tier order as _find_duplicate_lead."""
    if email and (lead.email or "").lower() == email.lower():
        return "email"
    li = {(x or "").lower() for x in (linkedin_url, person_linkedin) if x}
    if li & {(lead.linkedin_url or "").lower(), (lead.person_linkedin or "").lower()}:
        return "LinkedIn profile"
    digits = lambda v: "".join(c for c in (v or "") if c.isdigit())[-10:]
    if phone and digits(phone) and digits(phone) == digits(lead.phone):
        return "phone number"
    return "name and company"


def _is_placeholder_lead(lead) -> bool:
    """True for a bare Lead auto-created by a dialer webhook/sync on an
    unmatched inbound number (Aircall real-time webhook, Aircall/Klenty
    nightly sync) — no real name on file yet, just whatever filler the
    creating path used ("" / "Unknown" / "Caller").

    RCA 2026-08-14 (LIVE): a call placed via Aircall to a brand-new number
    auto-creates exactly this kind of row before the SDR gets a chance to
    add the real lead. The SDR's subsequent POST /leads for the real contact
    then hit _find_duplicate_lead's phone tier and was hard-blocked (409) —
    so the real name was silently discarded and the placeholder became the
    permanent record. Detecting this shape lets the caller enrich the
    placeholder in place instead of blocking a legitimate Add Lead.
    """
    first = (lead.first_name or "").strip()
    last = (lead.last_name or "").strip()
    return not first and last in ("", "Unknown", "Caller")


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

def _assign_lead_round_robin(db, new_lead, pod_sdrs, batch_counts, company_sdr_map, company_key):
    """Assign a single lead using fair round-robin with company grouping.

    Uses batch_counts (dict: sdr_id -> int) to track how many leads each SDR
    has been assigned in THIS batch, ensuring fair distribution regardless of
    pre-existing active lead counts.

    RCA 2026-09-22: this used to skip an SDR once a global active-lead cap
    was reached (and return None if every SDR in the pod was "full"); the
    cap concept was removed org-wide, so every pod SDR is always eligible —
    always returns an SDR when pod_sdrs is non-empty.
    """
    pod_sdr_ids = {s.id for s in pod_sdrs}
    pod_sdr_map = {s.id: s for s in pod_sdrs}

    # 1) Same-company affinity: if this company was already assigned to an SDR in this batch
    if company_key and company_key in company_sdr_map:
        prev_sdr = company_sdr_map[company_key]
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
            batch_counts[owner_sdr.id] = batch_counts.get(owner_sdr.id, 0) + 1
            company_sdr_map[company_key] = owner_sdr
            return owner_sdr

    # 3) Fair round-robin: pick SDR with fewest batch assignments (ties broken by fewest active)
    candidates = [
        (batch_counts.get(sdr.id, 0), _active_lead_count(sdr, db) + batch_counts.get(sdr.id, 0), sdr)
        for sdr in pod_sdrs
    ]
    if not candidates:
        return None  # No SDRs in this pod

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

# Lead fields a CSV column can map to on import (upload-preview's
# available_fields) and that a CSV export writes back out — one list so the
# two stay symmetric instead of two hand-maintained copies drifting apart.
LEAD_CSV_FIELDS = [
    "first_name", "last_name", "email", "phone", "phone_secondary", "company", "title",
    "linkedin_url", "person_linkedin", "website", "city", "state", "country",
    "industry", "employee_count", "annual_revenue", "total_funding",
    "company_phone", "company_linkedin", "company_street", "company_city",
    "company_postal_code", "company_state", "company_country", "company_founded",
]

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
