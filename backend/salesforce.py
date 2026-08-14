import os
import re
import json
import threading
from simple_salesforce import Salesforce
import models
from sqlalchemy.orm import Session
from datetime import datetime
from sf_logger import log_sf_operation


def _sanitize_email(email: str) -> str:
    """Sanitize an email address before sending to Salesforce.

    Handles dirty source data:
      - Strips leading/trailing whitespace
      - Removes internal spaces (e.g. 'example. com' → 'example.com')
      - Removes trailing dots from the TLD (e.g. '.com.' → '.com')
      - Returns '' if the result doesn't look like a valid email (no @)
    """
    if not email:
        return ''
    cleaned = email.strip()
    # Remove any internal whitespace (spaces inside the email string)
    cleaned = re.sub(r'\s+', '', cleaned)
    # Remove trailing dots (e.g. 'user@domain.com.' → 'user@domain.com')
    cleaned = cleaned.rstrip('.')
    # Basic sanity check: must contain exactly one '@' with chars on both sides
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', cleaned):
        return ''
    return cleaned

# Salesforce → Local status mapping (used when pulling leads FROM Salesforce)
SF_TO_LOCAL_STATUS = {
    "Open - Not Contacted": "Lead Assigned",
    "New":                  "Lead Assigned",
    "New Lead":             "Lead Assigned",
    "Working - Contacted":  "Calling",
    "Closed - Converted":   "Meeting Scheduled",
}

# Local → Salesforce status mapping (pushed to Lead_Status__c picklist)
LOCAL_TO_SF_STATUS = {
    "Lead Assigned":      "New Lead",
    "Research":           "New Lead",
    "Calling":            "New Lead",
    "Meeting Scheduled":  "New Lead",
}

# Pipeline order for comparing stage progression (higher = more advanced)
PIPELINE_ORDER = {
    "Lead Assigned": 0,
    "Research": 1,
    "Calling": 2,
    "Meeting Scheduled": 3,
}

def get_sf_client():
    """
    Initializes and returns a Salesforce client.
    
    PRECEDENCE RULE:
    1. If an active UI-configured connection exists in the DB → use those (decrypted) credentials
    2. Otherwise → fall back to env vars (SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN)
    
    This ensures that once an admin saves credentials via the Settings UI,
    the DB connection takes priority, but existing env-var setups keep working.
    """
    # ── Step 1: Try DB connection first ──────────────────────────────────────
    try:
        from database import SessionLocal
        from crypto import decrypt_token
        db = SessionLocal()
        try:
            conn = db.query(models.SalesforceConnection).filter(
                models.SalesforceConnection.is_active == True,
                models.SalesforceConnection.connection_status != "disconnected",
            ).first()
            if conn:
                domain = "test" if conn.environment == "sandbox" else "login"
                sf = Salesforce(
                    username=conn.username,
                    password=decrypt_token(conn.password_encrypted),
                    security_token=decrypt_token(conn.security_token_encrypted),
                    domain=domain,
                )
                # Update instance_url if we don't have it yet
                if not conn.instance_url and hasattr(sf, 'sf_instance'):
                    conn.instance_url = f"https://{sf.sf_instance}"
                    db.commit()
                return sf
        except Exception as e:
            print(f"[SF] DB connection failed, falling back to env vars: {e}")
        finally:
            db.close()
    except Exception as e:
        print(f"[SF] Could not check DB connection: {e}")

    # ── Step 2: Fall back to env vars ────────────────────────────────────────
    try:
        username = os.getenv("SF_USERNAME")
        if not username:
            print("[SF] No DB connection and no SF_USERNAME env var — Salesforce not configured")
            return None
        return Salesforce(
            username=username,
            password=os.getenv("SF_PASSWORD"),
            security_token=os.getenv("SF_SECURITY_TOKEN"),
            domain=os.getenv("SF_DOMAIN", "login")
        )
    except Exception as e:
        print(f"Failed to connect to Salesforce: {e}")
        return None

def get_record_types_from_salesforce(sf: Salesforce) -> list:
    """Fetch active Lead Record Types from Salesforce."""
    if not sf:
        return []
    try:
        result = sf.query(
            "SELECT Id, Name FROM RecordType WHERE SobjectType = 'Lead' AND IsActive = true ORDER BY Name"
        )
        return [{"id": r["Id"], "name": r["Name"]} for r in result.get("records", [])]
    except Exception as e:
        print(f"[SF] Failed to fetch RecordTypes: {e}")
        return []


def sync_leads_from_salesforce(
    db: Session,
    sf: Salesforce,
    limit: int = 1000,
    record_type_ids: list = None
) -> int:
    """
    Sync leads from Salesforce into the local DB.

    Args:
        limit: max leads to fetch. 0 = no limit (enterprise mode).
        record_type_ids: list of SF RecordType IDs to filter on. None = all types.
    """
    if not sf:
        return 0

    # Build WHERE clause — only add RecordType filter if IDs provided
    where_clauses = []
    if record_type_ids:
        id_list = ", ".join(f"'{rid}'" for rid in record_type_ids)
        where_clauses.append(f"RecordTypeId IN ({id_list})")
    where_clause = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    # Build SOQL — omit LIMIT clause when limit = 0 (enterprise mode)
    limit_clause = f"LIMIT {limit}" if limit and limit > 0 else ""

    def _build_query(include_record_type_id: bool) -> str:
        fields = (
            "Id, FirstName, LastName, Email, Phone, Status, Company, "
            "RecordTypeId, LastModifiedDate"
            if include_record_type_id else
            "Id, FirstName, LastName, Email, Phone, Status, Company, LastModifiedDate"
        )
        # Strip record type WHERE filter too if RecordTypeId is unavailable
        wc = where_clause if include_record_type_id else ""
        return f"SELECT {fields} FROM Lead {wc} ORDER BY LastModifiedDate DESC {limit_clause}".strip()

    # Try with RecordTypeId first; fall back gracefully if org doesn't support it
    has_record_type = True
    try:
        records = sf.query(_build_query(True)).get("records", [])
    except Exception as e:
        if "INVALID_FIELD" in str(e) and "RecordTypeId" in str(e):
            print("[SF] RecordTypeId not available in this org — retrying without it.")
            has_record_type = False
            try:
                records = sf.query(_build_query(False)).get("records", [])
            except Exception as e2:
                print(f"[SF] Lead query failed: {e2}")
                raise e2
        else:
            print(f"[SF] Lead query failed: {e}")
            raise

    upserted_count = 0
    new_lead_ids = []  # Track new leads for AM background sync
    for record in records:
        sf_id = record["Id"]

        sf_status = record.get("Status", "New")
        # Map Salesforce statuses to V2 pipeline stages
        local_status = SF_TO_LOCAL_STATUS.get(sf_status, "Lead Assigned")

        lead = db.query(models.Lead).filter(models.Lead.sf_lead_id == sf_id).first()
        is_new = False
        
        # If not matched by SF ID, try matching by email so we don't duplicate uploaded leads
        if not lead and record.get("Email"):
            lead = db.query(models.Lead).filter(models.Lead.email == record.get("Email")).first()
            if lead:
                # Link the existing local lead to this Salesforce ID
                lead.sf_lead_id = sf_id
        
        if not lead:
            is_new = True
            lead = models.Lead(
                sf_lead_id=sf_id,
                last_name=record.get("LastName") or "Unknown",
                lead_source="salesforce",
            )
            db.add(lead)
            db.flush()  # Get the ID immediately for AM sync tracking

        # Use OR-fallback: don't wipe enriched local data with null SF values
        lead.first_name     = record.get("FirstName") or lead.first_name
        lead.last_name      = record.get("LastName") or lead.last_name or "Unknown"
        lead.email          = record.get("Email") or lead.email
        lead.phone          = record.get("Phone") or lead.phone
        lead.company        = record.get("Company") or lead.company
        lead.record_type_id = (record.get("RecordTypeId") if has_record_type else None) or lead.record_type_id

        # Only set status for NEW leads, or if SF has a MORE advanced stage
        # Never regress an existing lead's pipeline status
        if is_new:
            lead.status = local_status
        else:
            current_order = PIPELINE_ORDER.get(lead.status, 0)
            sf_order = PIPELINE_ORDER.get(local_status, 0)
            if sf_order > current_order:
                lead.status = local_status

        op_type = "create" if is_new else "upsert"
        log_sf_operation(
            db=db, operation_type=op_type, sf_object="Lead",
            record_identifier=sf_id,
            first_name=record.get("FirstName"),
            last_name=record.get("LastName"),
            email=record.get("Email"),
            fields_updated=["FirstName", "LastName", "Email", "Phone", "Company", "Status"],
            status="success",
            source_system="sync_button",
        )
        upserted_count += 1
        if is_new:
            new_lead_ids.append(lead.id)

    db.commit()

    # Fire-and-forget: sync new leads to Audience Manager
    from audience_manager import sync_leads_to_am_background
    sync_leads_to_am_background(new_lead_ids)

    return upserted_count


def _build_lead_description(lead, db: Session = None) -> str:
    """
    Build an enriched Description string for Salesforce push.

    Includes up to 6 sections (only sections with data appear):
      1. LEAD SUMMARY — title, company, industry, geo, timezone
      2. SDR RESEARCH — company/contact insights, services, hypothesis
      3. OUTREACH STRATEGY — hook, personalization, channels
      4. CALL HISTORY — chronological call log entries
      5. SDR NOTES — timestamped notes with author
      6. OPPORTUNITY CONTEXT — outcome, notes, updated by
    """
    sections = []

    # ── 1. Lead Summary ──────────────────────────────────────────────────────
    summary_lines = []
    if lead.title and lead.company:
        summary_lines.append(f"{lead.title} at {lead.company}")
    elif lead.title:
        summary_lines.append(lead.title)
    elif lead.company:
        summary_lines.append(lead.company)

    detail_parts = []
    if lead.industry or getattr(lead, 'research_industry', None):
        detail_parts.append(f"Industry: {lead.industry or lead.research_industry}")
    if getattr(lead, 'research_company_size', None):
        detail_parts.append(f"Company Size: {lead.research_company_size}")
    if detail_parts:
        summary_lines.append(" | ".join(detail_parts))

    geo_parts = []
    if getattr(lead, 'research_geo', None):
        geo_parts.append(f"Geography: {lead.research_geo}")
    if getattr(lead, 'research_timezone', None):
        geo_parts.append(f"Timezone: {lead.research_timezone}")
    if geo_parts:
        summary_lines.append(" | ".join(geo_parts))

    if summary_lines:
        sections.append("LEAD SUMMARY\n" + "\n".join(summary_lines))

    # ── 2. SDR Research ──────────────────────────────────────────────────────
    research_lines = []
    if getattr(lead, 'research_company', None):
        research_lines.append(f"Company Insight: {lead.research_company}")
    if getattr(lead, 'research_contact', None):
        research_lines.append(f"Contact Insight: {lead.research_contact}")
    if getattr(lead, 'research_services', None):
        research_lines.append(f"Services: {lead.research_services}")
    if getattr(lead, 'research_hypothesis', None):
        research_lines.append(f"Why They're a Fit: {lead.research_hypothesis}")
    if research_lines:
        sections.append("SDR RESEARCH\n" + "\n".join(research_lines))

    # ── 3. Outreach Strategy ─────────────────────────────────────────────────
    strategy_lines = []
    if getattr(lead, 'research_hook', None):
        strategy_lines.append(f"Opening Hook: {lead.research_hook}")
    if getattr(lead, 'research_personalization', None):
        strategy_lines.append(f"Personalization: {lead.research_personalization}")
    if getattr(lead, 'research_channels', None):
        strategy_lines.append(f"Preferred Channels: {lead.research_channels}")
    if strategy_lines:
        sections.append("OUTREACH STRATEGY\n" + "\n".join(strategy_lines))

    # ── 4. Call History (requires db session) ────────────────────────────────
    if db:
        calls = db.query(models.CallLog).filter(
            models.CallLog.lead_id == lead.id
        ).order_by(models.CallLog.called_at.asc()).all()
        if calls:
            call_lines = []
            for call in calls:
                date_str = call.called_at.strftime("%b %d") if call.called_at else "Unknown"
                entry = f"• {date_str} — {call.outcome}"
                if call.notes:
                    entry += f": {call.notes}"
                call_lines.append(entry)
            sections.append(f"CALL HISTORY ({len(calls)} call{'s' if len(calls) != 1 else ''})\n" + "\n".join(call_lines))

    # ── 5. SDR Notes (requires db session) ───────────────────────────────────
    if db:
        notes = db.query(models.Note).filter(
            models.Note.lead_id == lead.id
        ).order_by(models.Note.created_at.asc()).all()
        if notes:
            note_lines = []
            for note in notes:
                date_str = note.created_at.strftime("%b %d") if note.created_at else "Unknown"
                author = note.author or "SDR"
                note_lines.append(f"• {date_str} ({author}): {note.content}")
            sections.append("SDR NOTES\n" + "\n".join(note_lines))

    # ── 6. Opportunity Context ───────────────────────────────────────────────
    if getattr(lead, 'opportunity_status', None):
        opp_lines = [f"Status: {lead.opportunity_status}"]
        if getattr(lead, 'opportunity_notes', None):
            opp_lines.append(f"Notes: {lead.opportunity_notes}")
        if getattr(lead, 'opportunity_updated_by', None):
            updated_str = ""
            if lead.opportunity_updated_at:
                updated_str = f" on {lead.opportunity_updated_at.strftime('%b %d, %Y')}"
            opp_lines.append(f"Updated by: {lead.opportunity_updated_by}{updated_str}")
        sections.append("OPPORTUNITY CONTEXT\n" + "\n".join(opp_lines))

    return "\n\n".join(sections) if sections else None


# Known sentinel prefixes for sf_lead_id values that are NOT real Salesforce IDs.
# Real SF IDs are 15 or 18 alphanumeric chars with no hyphens.
_SENTINEL_PREFIXES = ("mig-", "manual-", "upload-", "sandbox-")

def _is_sentinel_sf_id(sf_id: str) -> bool:
    """Return True if sf_id is a local placeholder, not a real Salesforce Lead ID.

    Guards:
      1. Prefix check (case-insensitive) — covers MIG-, MANUAL-, upload-, sandbox-
      2. Hyphen check — real SF IDs are 15/18 alphanumeric chars, never contain hyphens
    """
    if not sf_id:
        return True
    lower = sf_id.lower()
    if any(lower.startswith(p) for p in _SENTINEL_PREFIXES):
        return True
    if "-" in sf_id:  # Any hyphen = not a real SF ID
        return True
    return False


def push_pending_leads_to_salesforce(db: Session, sf: Salesforce, push_stage: str = "Meeting Scheduled") -> dict:
    """
    Find all local leads at the push stage (e.g. Meeting Scheduled) that
    don't yet exist in Salesforce and create them there.

    Leads created via CSV upload have sf_lead_id like 'upload-xxxx' which
    is not a real Salesforce ID, so those also need to be pushed.

    RCA-2026-07-20: each lead's local write-back is committed individually
    (not batched into one commit() at the end). Two local leads sharing an
    email can both resolve to the same existing SF Lead Id, which collides
    with the unique index on sf_lead_id — that failure must only roll back
    the ONE offending lead, not silently discard every other lead's
    already-succeeded Salesforce creates/links from the same sync run (the
    remote SF creates can't be undone, so losing the local write-back meant
    every subsequent sync re-created the same leads in Salesforce again).

    Returns a dict with detailed results for debugging.
    """
    result = {"pushed": 0, "created": [], "linked": [], "skipped": [], "errors": []}
    if not sf:
        return result

    # Find leads at push stage
    leads = db.query(models.Lead).filter(
        models.Lead.status == push_stage
    ).all()

    for lead in leads:
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or lead.id
        
        # Case 1: Lead already in Salesforce (has a real 18-char SF ID — not a sentinel)
        if lead.sf_lead_id and not _is_sentinel_sf_id(lead.sf_lead_id):
            # Skip if status hasn't changed since last sync
            if lead.last_synced_at and lead.status_changed_at:
                # Strip timezone info for safe comparison (mixed naive/aware datetimes)
                synced = lead.last_synced_at.replace(tzinfo=None) if lead.last_synced_at else None
                changed = lead.status_changed_at.replace(tzinfo=None) if lead.status_changed_at else None
                if synced and changed and changed <= synced:
                    result["skipped"].append({"name": lead_name, "sf_id": lead.sf_lead_id, "reason": "No changes since last sync"})
                    continue
            elif lead.last_synced_at and not lead.status_changed_at:
                result["skipped"].append({"name": lead_name, "sf_id": lead.sf_lead_id, "reason": "No status change recorded"})
                continue
            try:
                # Push status update + enriched description
                update_payload = {
                    "status": lead.status,
                    "description": _build_lead_description(lead, db),
                }
                success = push_lead_to_salesforce(sf, lead.sf_lead_id, update_payload,
                                                  lead_info=lead_push_info(lead, db),
                                                  source="sync_button")
                if success:
                    lead.last_synced_at = datetime.now()
                    db.commit()
                    result["pushed"] += 1
                    result["linked"].append({"name": lead_name, "sf_id": lead.sf_lead_id, "note": "Updated status"})
                else:
                    result["skipped"].append({"name": lead_name, "sf_id": lead.sf_lead_id, "reason": "No fields to update"})
            except Exception as e:
                db.rollback()
                result["errors"].append({"name": lead_name, "error": f"Status update failed: {e}"})
            continue

        try:
            # Duplicate check: query SF by email before creating
            if lead.email:
                safe_email = lead.email.replace("'", "\\'")
                existing = sf.query(
                    f"SELECT Id FROM Lead WHERE Email = '{safe_email}' LIMIT 1"
                )
                if existing.get("totalSize", 0) > 0:
                    sf_id = existing["records"][0]["Id"]
                    # ponytail: this pre-check is redundant with the except/rollback
                    # below (a plain unique-constraint IntegrityError would already be
                    # isolated to just this lead) — kept anyway because THIS exact bug
                    # went unnoticed for 3 months specifically because the failure was
                    # an opaque exception string nobody read; a named conflicting lead
                    # id is worth the extra query here.
                    conflict = db.query(models.Lead).filter(
                        models.Lead.sf_lead_id == sf_id, models.Lead.id != lead.id
                    ).first()
                    if conflict:
                        result["errors"].append({
                            "name": lead_name,
                            "error": f"Duplicate local lead (id={conflict.id}) already linked to {sf_id} via the same email {lead.email} — merge or remove one of these local leads.",
                        })
                        continue
                    lead.sf_lead_id = sf_id
                    db.commit()
                    result["pushed"] += 1
                    result["linked"].append({"name": lead_name, "email": lead.email, "sf_id": sf_id})
                    log_sf_operation(
                        operation_type="upsert", sf_object="Lead",
                        record_identifier=sf_id,
                        first_name=lead.first_name, last_name=lead.last_name, email=lead.email,
                        fields_updated=["sf_lead_id"],
                        status="success", source_system="sync_button",
                        response_payload={"action": "linked_to_existing", "sf_id": sf_id},
                    )
                    continue

            create_data = lead_push_info(lead, db)
            create_data["industry"] = lead.industry or getattr(lead, 'research_industry', None)
            sf_id = create_new_lead_in_salesforce(sf, create_data, source="sync_button")
            lead.sf_lead_id = sf_id
            db.commit()
            result["pushed"] += 1
            result["created"].append({"name": lead_name, "sf_id": sf_id})
        except Exception as e:
            db.rollback()
            result["errors"].append({"name": lead_name, "error": str(e)})
            log_sf_operation(
                operation_type="create", sf_object="Lead",
                record_identifier=lead.id,
                first_name=lead.first_name, last_name=lead.last_name, email=lead.email,
                status="failed", error_message=str(e),
                source_system="sync_button",
            )

    return result


def run_full_salesforce_sync(db: Session, sf: Salesforce, settings) -> dict:
    """Core pull(if 2-way)+push sync logic — shared by the manual '/api/admin/sync'
    button and the scheduled auto-sync job (V44) so both behave identically."""
    sync_direction = settings.sync_direction if getattr(settings, 'sync_direction', None) else "push_only"

    lead_count = 0
    if sync_direction == "both":
        rtype_ids = json.loads(settings.record_type_ids) if settings.record_type_ids else None
        lead_count = sync_leads_from_salesforce(db, sf, limit=settings.lead_limit, record_type_ids=rtype_ids)

    push_stage = settings.sf_push_stage or "Meeting Scheduled"
    push_result = push_pending_leads_to_salesforce(db, sf, push_stage)

    all_at_stage = db.query(models.Lead).filter(models.Lead.status == push_stage).all()
    debug_info = {
        "sync_direction": sync_direction,
        "push_stage_configured": push_stage,
        "total_leads_at_push_stage": len(all_at_stage),
        "with_upload_prefix": len([l for l in all_at_stage if l.sf_lead_id and l.sf_lead_id.startswith("upload-")]),
        "without_sf_id": len([l for l in all_at_stage if not l.sf_lead_id]),
        "with_real_sf_id": len([l for l in all_at_stage if l.sf_lead_id and not l.sf_lead_id.startswith("upload-")]),
        "sample_sf_ids": [l.sf_lead_id for l in all_at_stage[:5]],
    }

    return {
        "status": "Sync completed successfully",
        "leads_synced": lead_count,
        "leads_pushed_to_sf": push_result["pushed"],
        "push_details": {
            "created_in_sf": push_result["created"],
            "linked_to_existing": push_result["linked"],
            "skipped_already_in_sf": len(push_result["skipped"]),
            "errors": push_result["errors"],
        },
        "sync_direction": sync_direction,
        "lead_limit": settings.lead_limit,
        "record_type_ids": json.loads(settings.record_type_ids) if settings.record_type_ids else None,
        "debug": debug_info,
    }


def sync_sdrs_from_salesforce(db: Session, sf: Salesforce):
    """Fetches records from the custom SDR__c object and syncs them to our local User table."""
    if not sf:
        return 0
        
    query = """
        SELECT Id, Name, Email__c, Role__c, Active__c
        FROM SDR__c
        WHERE Active__c = True
    """
    try:
        records = sf.query(query).get("records", [])
    except Exception as e:
        print(f"Failed to query SDR__c object (Make sure it exists in SF): {e}")
        return 0
    
    upserted_count = 0
    for record in records:
        sf_id = record["Id"]
        email = record.get("Email__c")
        if not email: continue
        
        # Check if user exists by email or sf_sdr_id
        user = db.query(models.User).filter(
            (models.User.email == email) | (models.User.sf_sdr_id == sf_id)
        ).first()

        if not user:
            user = models.User(email=email, sf_sdr_id=sf_id)
            db.add(user)
        
        user.name = record.get("Name")
        user.sf_sdr_id = sf_id
        
        # Map Role__c picklist values to V2 roles
        sf_role = record.get("Role__c")
        if sf_role == "Admin":
            user.role = "Super Admin"
        elif sf_role == "SDR":
            user.role = "SDR"
        elif sf_role == "Sales":
            user.role = "SDR"
        
        upserted_count += 1
        
    db.commit()
    return upserted_count


# RCA 2026-08-03: 6 different push paths (Kanban move, call outcome,
# no-show, disqualification, scheduled sync, status-reach) can each
# independently detect the same deleted sf_lead_id and try to recreate it —
# without this, two firing close together could both find no match and
# both create a duplicate Lead in Salesforce. One lock per stale sf_lead_id
# (unique in the DB, so this is exactly "one lock per affected local lead")
# keeps a second, near-simultaneous recovery from racing the first.
# ponytail: locks are never removed from this dict — Salesforce deletions
# are rare (one in this system's whole history so far), so this stays at
# a handful of entries for the process's lifetime; add cleanup if that
# stops being true.
_lead_recreate_locks_guard = threading.Lock()
_lead_recreate_locks = {}


def _get_recreate_lock(sf_lead_id: str) -> threading.Lock:
    with _lead_recreate_locks_guard:
        lock = _lead_recreate_locks.get(sf_lead_id)
        if lock is None:
            lock = threading.Lock()
            _lead_recreate_locks[sf_lead_id] = lock
        return lock


def lead_push_info(lead, db: Session = None) -> dict:
    """Build the lead_info dict push_lead_to_salesforce logs against, and
    recreates the Lead from if it was deleted in Salesforce.

    Callers on a background thread must call this BEFORE the thread starts,
    while `lead` is still attached to the request's db session. Pass `db`
    when you have one in scope (i.e. calling this synchronously, before a
    background thread starts) to get the full call-history-enriched
    description; omitted, you still get the lead-only sections (research,
    outreach strategy, opportunity context) since _build_lead_description
    already handles db=None gracefully.
    """
    return {
        "first_name": lead.first_name, "last_name": lead.last_name, "email": lead.email,
        "company": lead.company, "phone": lead.phone, "title": lead.title,
        "website": lead.website, "industry": lead.industry,
        "employee_count": lead.employee_count, "annual_revenue": lead.annual_revenue,
        # RCA 2026-08-03: City/State/Country are contact-level fields, almost
        # always blank on an uploaded/list-sourced lead — the real location
        # data lives in the company_* enrichment fields. Fall back to those
        # rather than pushing blanks to Salesforce's Address section.
        "city": lead.city or lead.company_city,
        "state": lead.state or lead.company_state,
        "country": lead.country or lead.company_country,
        "company_street": lead.company_street, "company_postal_code": lead.company_postal_code,
        "linkedin_url": lead.linkedin_url or lead.person_linkedin,
        "sdr_name": ", ".join(u.name for u in lead.assigned_users if u.name) or None,
        "description": _build_lead_description(lead, db),
    }


def push_lead_to_salesforce(sf: Salesforce, sf_lead_id: str, updates: dict, lead_info: dict = None, source: str = "api") -> bool:
    """
    Write updated lead fields back to Salesforce via the REST API.
    
    Args:
        sf: authenticated Salesforce client
        sf_lead_id: the 18-char Salesforce Lead ID (stored in leads.sf_lead_id)
        updates: dict of field:value pairs to update in Salesforce
        lead_info: optional dict with first_name, last_name, email for logging
        source: source system identifier for logging
    
    Returns:
        True on success, False on failure
    """
    if not sf or not sf_lead_id:
        return False

    # Guard: never push sentinel/placeholder IDs to Salesforce.
    # MIG-, MANUAL-, upload-, sandbox- prefixes are local-only identifiers.
    if _is_sentinel_sf_id(sf_lead_id):
        import logging
        logging.getLogger(__name__).warning(
            f"[SF Write-back] Skipping push — sentinel sf_lead_id: {sf_lead_id!r}"
        )
        return False

    lead_info = lead_info or {}

    # RCA 2026-08-03: SDR_Name__c and LinkedIn_Profile__c were only ever
    # sent at creation time — a lead reassigned to a different SDR (or with
    # a LinkedIn URL added later) would leave Salesforce showing a
    # permanently stale value from whenever the Lead was first created.
    # Re-sync them from lead_info on every push, not just at creation;
    # respects an explicit override in `updates` if a caller ever sets one.
    for _always_sync_key in ("sdr_name", "linkedin_url"):
        if _always_sync_key not in updates and lead_info.get(_always_sync_key) is not None:
            updates = {**updates, _always_sync_key: lead_info[_always_sync_key]}

    # Map our local field names → Salesforce field API names
    field_map = {
        "first_name":       "FirstName",
        "last_name":        "LastName",
        "email":            "Email",
        "phone":            "Phone",
        "status":           "Lead_Status__c",
        "title":            "Job_Title__c",   # RCA 2026-08-03: org uses this custom field, not standard Title
        "website":          "Website",
        "industry":         "Industry",
        "employee_count":   "NumberOfEmployees",
        "annual_revenue":   "AnnualRevenue",
        "city":             "City",
        "state":            "State",
        "country":          "Country",
        "company_street":   "Street",
        "company_postal_code": "PostalCode",
        "description":      "Description",
        "linkedin_url":     "LinkedIn_Profile__c",
        "sdr_name":         "SDR_Name__c",
        "disqualification_reason": "Lead_Lost_Reason__c",
    }

    sf_payload = {}
    for local_key, value in updates.items():
        sf_field = field_map.get(local_key)
        if sf_field and value is not None:
            # Translate CRM status to SF picklist value
            if local_key == "status":
                value = LOCAL_TO_SF_STATUS.get(value, value)
            # Convert employee_count to int for SF NumberOfEmployees
            if local_key == "employee_count" and value:
                try:
                    value = int(value)
                except (ValueError, TypeError):
                    continue
            # Sanitize email before sending to Salesforce
            if local_key == "email":
                value = _sanitize_email(value or '')
                if not value:
                    continue  # skip empty/invalid email rather than failing
            sf_payload[sf_field] = value

    if not sf_payload:
        return True  # Nothing to push

    try:
        sf.Lead.update(sf_lead_id, sf_payload)
        print(f"[SF Write-back] Updated Lead {sf_lead_id}: {sf_payload}")
        log_sf_operation(
            operation_type="update", sf_object="Lead",
            record_identifier=sf_lead_id,
            first_name=lead_info.get("first_name"),
            last_name=lead_info.get("last_name"),
            email=lead_info.get("email"),
            fields_updated=list(sf_payload.keys()),
            status="success",
            request_payload=sf_payload,
            source_system=source,
        )
        return True
    except Exception as e:
        error_str = str(e)
        print(f"[SF Write-back] Failed to update Lead {sf_lead_id}: {e}")
        log_sf_operation(
            operation_type="update", sf_object="Lead",
            record_identifier=sf_lead_id,
            first_name=lead_info.get("first_name"),
            last_name=lead_info.get("last_name"),
            email=lead_info.get("email"),
            fields_updated=list(sf_payload.keys()),
            status="failed", error_message=error_str,
            request_payload=sf_payload,
            source_system=source,
        )
        # RCA 2026-08-03: a Lead deleted directly in Salesforce keeps its
        # sf_lead_id locally forever otherwise — every push path treats a
        # well-formed (non-sentinel) ID as "already linked" and only ever
        # tries another update, never a re-create. Some push paths (e.g. a
        # Kanban status move) only ever fire once, right when a status
        # changes — a lead already past that trigger would never get
        # touched again, so clearing the stale ID alone isn't enough; this
        # recreates it immediately, right here, so every caller gets it.
        if _is_entity_deleted_error(e):
            recreate_lock = _get_recreate_lock(sf_lead_id)
            if not recreate_lock.acquire(blocking=False):
                print(f"[SF Write-back] Recreate already in progress for {sf_lead_id} — skipping")
                return False
            try:
                new_sf_id = None
                try:
                    new_sf_id = find_or_create_lead_in_salesforce(sf, lead_info, source=source)
                except Exception as recreate_err:
                    print(f"[SF Write-back] Failed to recreate Lead after deletion for {sf_lead_id}: {recreate_err}")
                try:
                    from database import SessionLocal
                    with SessionLocal() as clear_db:
                        cleared = clear_db.query(models.Lead).filter(
                            models.Lead.sf_lead_id == sf_lead_id
                        ).update({"sf_lead_id": new_sf_id, "last_synced_at": None})
                        clear_db.commit()
                    if cleared and not new_sf_id:
                        log_sf_operation(
                            operation_type="unlink", sf_object="Lead",
                            record_identifier=sf_lead_id,
                            first_name=lead_info.get("first_name"),
                            last_name=lead_info.get("last_name"),
                            email=lead_info.get("email"),
                            status="success", source_system=source,
                            response_payload={"action": "cleared_deleted_sf_id"},
                        )
                except Exception as clear_err:
                    print(f"[SF Write-back] Failed to clear sf_lead_id after deletion for {sf_lead_id}: {clear_err}")
            finally:
                recreate_lock.release()
        return False


def _is_entity_deleted_error(exc: Exception) -> bool:
    """
    True if Salesforce rejected a request because the target record was
    deleted directly in Salesforce (errorCode ENTITY_IS_DELETED).

    Same .content-then-string-fallback approach as _extract_duplicate_sf_id.
    """
    content = getattr(exc, "content", None)
    if isinstance(content, list):
        for err in content:
            if isinstance(err, dict) and err.get("errorCode") == "ENTITY_IS_DELETED":
                return True
    return "ENTITY_IS_DELETED" in str(exc)


def _extract_duplicate_sf_id(exc: Exception) -> "str | None":
    """
    When Salesforce rejects a Lead create with DUPLICATES_DETECTED, extract
    the existing Lead ID from the error payload so we can link to it.

    simple_salesforce raises SalesforceMalformedRequest whose `.content`
    attribute holds the parsed JSON response list, e.g.:
      [{'errorCode': 'DUPLICATES_DETECTED',
        'duplicateResult': {'matchResults': [{'matchRecords': [{'record': {'Id': '00Q...'}}]}]}}]

    Falls back to regex on str(exc) if .content is unavailable.
    Returns the 15/18-char SF ID string, or None if not found.
    """
    # ── Attempt 1: use simple_salesforce's parsed .content ──────────────────
    content = getattr(exc, "content", None)
    if isinstance(content, list):
        for err in content:
            if not isinstance(err, dict):
                continue
            if err.get("errorCode") != "DUPLICATES_DETECTED":
                continue
            try:
                match_results = err["duplicateResult"]["matchResults"]
                for mr in match_results:
                    for rec in mr.get("matchRecords", []):
                        sf_id = rec.get("record", {}).get("Id")
                        if sf_id:
                            return sf_id
            except (KeyError, IndexError, TypeError):
                pass

    # ── Attempt 2: regex fallback on the stringified exception ───────────────
    import re
    error_str = str(exc)
    if "DUPLICATES_DETECTED" in error_str:
        match = re.search(r"'Id':\s*'([A-Z0-9]{15,18})'", error_str)
        if match:
            return match.group(1)

    return None


def create_new_lead_in_salesforce(sf: Salesforce, lead_data: dict, source: str = "api") -> str:
    """
    Creates a new lead in Salesforce and returns the generated Salesforce ID.
    Lead requires at least LastName and Company.
    """
    if not sf:
        raise Exception("Salesforce client not found")

    sf_payload = {
        "FirstName": lead_data.get("first_name") or "",
        "LastName": lead_data.get("last_name") or "Unknown",
        "Company": lead_data.get("company") or "Unknown",
        "Email": _sanitize_email(lead_data.get("email") or ""),
        "Phone": lead_data.get("phone") or "",
        "Lead_Status__c": "New Lead",
        "Lead_Source_New__c": "SDR Generated",
    }

    # Standard fields — push everything that has data
    standard_map = {
        "title":              "Job_Title__c",   # RCA 2026-08-03: org uses this custom field, not standard Title
        "website":            "Website",
        "industry":           "Industry",
        "city":               "City",
        "state":              "State",
        "country":            "Country",
        "company_street":     "Street",
        "company_postal_code": "PostalCode",
        "description":        "Description",
        "linkedin_url":       "LinkedIn_Profile__c",
        "sdr_name":           "SDR_Name__c",
    }
    for local_key, sf_field in standard_map.items():
        val = lead_data.get(local_key)
        if val:
            sf_payload[sf_field] = val

    # Numeric fields need type conversion
    if lead_data.get("employee_count"):
        try:
            sf_payload["NumberOfEmployees"] = int(lead_data["employee_count"])
        except (ValueError, TypeError):
            pass
    if lead_data.get("annual_revenue"):
        try:
            sf_payload["AnnualRevenue"] = float(str(lead_data["annual_revenue"]).replace(",", "").replace("$", ""))
        except (ValueError, TypeError):
            pass

    # Remove empty values but KEEP required fields
    required = {"LastName", "Company", "Lead_Status__c", "Lead_Source_New__c"}
    sf_payload = {k: v for k, v in sf_payload.items() if v or k in required}

    try:
        response = sf.Lead.create(sf_payload)
        sf_lead_id = response.get("id")
        print(f"[SF Write-back] Created new Lead {sf_lead_id}")
        log_sf_operation(
            operation_type="create", sf_object="Lead",
            record_identifier=sf_lead_id,
            first_name=lead_data.get("first_name"),
            last_name=lead_data.get("last_name"),
            email=lead_data.get("email"),
            fields_updated=list(sf_payload.keys()),
            status="success",
            request_payload=sf_payload,
            response_payload={"id": sf_lead_id},
            source_system=source,
        )
        return sf_lead_id

    except Exception as e:
        # ── Duplicate detected: SF blocked creation because the lead already exists ──
        # Extract the existing Lead ID from the error payload and return it.
        # This happens when SF's duplicate rule fires (e.g. Duplicate_lead_based_on_email)
        # and allowSave=False. The pre-flight SOQL check can miss this if the email is
        # absent or SF normalises it differently (case, whitespace, alias).
        existing_id = _extract_duplicate_sf_id(e)
        if existing_id:
            print(
                f"[SF Write-back] DUPLICATES_DETECTED — linking to existing Lead {existing_id} "
                f"(lead: {lead_data.get('first_name')} {lead_data.get('last_name')}, "
                f"email: {lead_data.get('email')})"
            )
            log_sf_operation(
                operation_type="create", sf_object="Lead",
                record_identifier=existing_id,
                first_name=lead_data.get("first_name"),
                last_name=lead_data.get("last_name"),
                email=lead_data.get("email"),
                fields_updated=list(sf_payload.keys()),
                status="success",
                request_payload=sf_payload,
                response_payload={"action": "linked_to_existing_duplicate", "sf_id": existing_id},
                source_system=source,
            )
            return existing_id

        # Any other error — log and re-raise
        print(f"[SF Write-back] Failed to create Lead: {e}")
        log_sf_operation(
            operation_type="create", sf_object="Lead",
            record_identifier=None,
            first_name=lead_data.get("first_name"),
            last_name=lead_data.get("last_name"),
            email=lead_data.get("email"),
            fields_updated=list(sf_payload.keys()),
            status="failed", error_message=str(e),
            request_payload=sf_payload,
            source_system=source,
        )
        raise e


def find_or_create_lead_in_salesforce(sf: Salesforce, lead_data: dict, source: str = "api") -> str:
    """
    Find an existing SF Lead by email, or create a new one — used wherever a
    local lead needs a real sf_lead_id and doesn't already have one (a fresh
    upload/manual lead, or one whose prior link was deleted in Salesforce).
    """
    email = _sanitize_email(lead_data.get("email") or "")
    if email:
        safe_email = email.replace("'", "\\'")
        existing = sf.query(f"SELECT Id FROM Lead WHERE Email = '{safe_email}' LIMIT 1")
        if existing.get("totalSize", 0) > 0:
            sf_id = existing["records"][0]["Id"]
            log_sf_operation(
                operation_type="upsert", sf_object="Lead",
                record_identifier=sf_id,
                first_name=lead_data.get("first_name"), last_name=lead_data.get("last_name"),
                email=lead_data.get("email"),
                status="success", source_system=source,
                response_payload={"action": "linked_to_existing", "sf_id": sf_id},
            )
            return sf_id
    return create_new_lead_in_salesforce(sf, lead_data, source=source)


def create_sdr_in_salesforce(sf: Salesforce, user_data: dict) -> str:
    """
    Creates a new SDR__c record in Salesforce and returns its ID.
    Required fields: Name, Email__c, Role__c.
    """
    if not sf:
        raise Exception("Salesforce client not found")

    sf_payload = {
        "Name":      user_data.get("name") or user_data.get("email"),
        "Email__c":  user_data.get("email"),
        "Role__c":   user_data.get("role", "SDR"),
        "Active__c": True
    }

    try:
        response = sf.SDR__c.create(sf_payload)
        sf_sdr_id = response.get("id")
        print(f"[SF SDR Create] Created new SDR record {sf_sdr_id}")
        return sf_sdr_id
    except Exception as e:
        print(f"[SF SDR Create] Failed to create SDR record in SF: {e}")
        return None

def push_sdr_metrics_to_salesforce(sf: Salesforce, user: models.User, metrics: dict) -> bool:
    """
    Updates the SDR__c record in Salesforce with performance metrics (calls today, total leads, etc.).
    """
    if not sf or not user.sf_sdr_id:
        return False

    # Map our local KPI keys → Salesforce SDR__c field API names
    field_map = {
        "calls_today": "Calls_Today__c",
        "total_leads": "Total_Leads__c",
        "last_login":  "Last_Login__c",
        "last_call":   "Last_Call_Logged__c",
        "role":        "Role__c"
    }

    sf_payload = {}
    for key, value in metrics.items():
        sf_field = field_map.get(key)
        if sf_field:
            if isinstance(value, datetime):
                sf_payload[sf_field] = value.isoformat()
            else:
                sf_payload[sf_field] = value

    if not sf_payload:
        return True

    try:
        sf.SDR__c.update(user.sf_sdr_id, sf_payload)
        print(f"[SF SDR Sync] Updated metrics for {user.email}: {sf_payload}")
        return True
    except Exception as e:
        print(f"[SF SDR Sync] Failed to update metrics for {user.email}: {e}")
        return False
