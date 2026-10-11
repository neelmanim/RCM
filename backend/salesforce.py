import os
import re
import json
import threading
from typing import Optional
from simple_salesforce import Salesforce
import models
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from datetime import datetime, timezone
from sf_logger import log_sf_operation
from phone_utils import _normalize_digits


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


def get_opportunity_stage_options_from_salesforce(sf: Salesforce) -> list:
    """Fetch this org's actual Opportunity.StageName picklist values, so the
    AE Pipeline / CSM Portal "update deal" forms can render a real dropdown
    instead of a free-text field that could push an invalid value into a
    restricted SF picklist. No caching, same as get_record_types_from_salesforce
    above — this is a describe() call, not a query, and is only fetched once
    per form load, not per keystroke."""
    if not sf:
        return []
    try:
        stage_field = next(
            (f for f in sf.Opportunity.describe()["fields"] if f["name"] == "StageName"), None
        )
        if not stage_field:
            return []
        return [
            {"value": pv["value"], "label": pv["label"]}
            for pv in stage_field.get("picklistValues", [])
            if pv.get("active")
        ]
    except Exception as e:
        print(f"[SF] Failed to fetch Opportunity StageName picklist: {e}")
        return []


def get_standard_product_options_from_salesforce(sf: Salesforce) -> list:
    """Fetch this org's real Standard_Product_Name__c picklist values (a
    multipicklist), so the AE close-deal form can render real checkboxes
    instead of free text that would get rejected by SF's own restricted
    picklist. Same describe()-only, no-caching shape as
    get_opportunity_stage_options_from_salesforce above."""
    if not sf:
        return []
    try:
        field = next(
            (f for f in sf.Opportunity.describe()["fields"] if f["name"] == "Standard_Product_Name__c"), None
        )
        if not field:
            return []
        return [
            {"value": pv["value"], "label": pv["label"]}
            for pv in field.get("picklistValues", [])
            if pv.get("active")
        ]
    except Exception as e:
        print(f"[SF] Failed to fetch Opportunity Standard_Product_Name__c picklist: {e}")
        return []


def get_lost_reason_options_from_salesforce(sf: Salesforce) -> list:
    """Fetch this org's real Opportunity_Lost_Reason__c picklist — required
    by an SF validation rule on any Closed Lost push, alongside Standard
    Product / Invoice Number (required on any Closed push). Same
    describe()-only, no-caching shape as the sibling option fetchers above."""
    if not sf:
        return []
    try:
        field = next(
            (f for f in sf.Opportunity.describe()["fields"] if f["name"] == "Opportunity_Lost_Reason__c"), None
        )
        if not field:
            return []
        return [
            {"value": pv["value"], "label": pv["label"]}
            for pv in field.get("picklistValues", [])
            if pv.get("active")
        ]
    except Exception as e:
        print(f"[SF] Failed to fetch Opportunity_Lost_Reason__c picklist: {e}")
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
        prev_status = lead.status
        if is_new:
            lead.status = local_status
        else:
            current_order = PIPELINE_ORDER.get(lead.status, 0)
            sf_order = PIPELINE_ORDER.get(local_status, 0)
            if sf_order > current_order:
                lead.status = local_status
        # v13.10.0: a status set by the Salesforce pull used to leave no trace (no log row, no status_changed_at).
        if is_new or lead.status != prev_status:
            lead.status_changed_at = datetime.now(timezone.utc)
            models.log_status_change(db, lead.id, None if is_new else prev_status, lead.status, "Salesforce sync")

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
            direction="inbound",
        )
        upserted_count += 1
        if is_new:
            new_lead_ids.append(lead.id)

    db.commit()

    # Fire-and-forget: sync new leads to Audience Manager
    from audience_manager import sync_leads_to_am_background
    sync_leads_to_am_background(new_lead_ids)

    return upserted_count


def sync_accounts_from_salesforce(db: Session, sf: Salesforce, limit: int = 1000) -> int:
    """Pull Salesforce Accounts into the local Account table — read-only
    reference data for the CSM Portal (ARR/renewal context), mirroring
    sync_leads_from_salesforce's upsert-by-sf-id, OR-fallback pattern.

    assigned_csm_id: SF's own CSM field (Account_Manager_Lookup__c, labeled
    "Customer Success Manager(CSM)" in Setup) is resolved by email, same
    match-by-Owner.Email pattern sync_opportunities_from_salesforce uses for
    Opportunity owner. Only fills a currently-unassigned account — an
    existing local assignment (AE handover or Super Admin reassignment) is
    never overwritten by a pull."""
    if not sf:
        return 0

    limit_clause = f"LIMIT {limit}" if limit and limit > 0 else ""
    query = (
        "SELECT Id, Name, Industry, CreatedDate, "
        "Account_Manager_Lookup__r.Email, Account_Manager_Lookup__r.Name, "
        "Owner.Email, Owner.Name "
        f"FROM Account ORDER BY LastModifiedDate DESC {limit_clause}"
    ).strip()
    try:
        records = sf.query(query).get("records", [])
    except Exception as e:
        print(f"[SF] Account query failed: {e}")
        raise

    upserted_count = 0
    for record in records:
        sf_id = record["Id"]
        account = db.query(models.Account).filter(models.Account.sf_account_id == sf_id).first()
        is_new = account is None
        if is_new:
            account = models.Account(sf_account_id=sf_id, name=record.get("Name") or "Unnamed Account")
            db.add(account)

        # OR-fallback: don't wipe local data with null SF values
        account.name     = record.get("Name") or account.name
        account.industry = record.get("Industry") or account.industry
        # health score's relationship factor needs a tenure anchor — SF never
        # sent one, so every account fell back to the "never synced" floor
        # score. CreatedDate is immutable in SF, so OR-fallback is safe here.
        created_date = record.get("CreatedDate")
        account.customer_since = account.customer_since or _parse_sf_date(created_date[:10] if created_date else None)

        csm_rel = record.get("Account_Manager_Lookup__r") or {}
        account.sf_csm_email = csm_rel.get("Email") or account.sf_csm_email
        account.sf_csm_name  = csm_rel.get("Name") or account.sf_csm_name
        if not account.assigned_csm_id and account.sf_csm_email:
            csm_user = db.query(models.User).filter(
                func.lower(models.User.email) == account.sf_csm_email.lower()
            ).first()
            if csm_user:
                account.assigned_csm_id = csm_user.id

        # Owner is a standard, always-populated SF field (unlike the custom
        # CSM lookup above) — useful as a fallback identity to show in the
        # UI on accounts where Account_Manager_Lookup__c is still empty.
        # Raw email/name are stored even with no Alternate CRM user match yet —
        # backfill_sf_identity_links() resolves owner_user_id retroactively
        # the moment that person registers.
        owner_rel = record.get("Owner") or {}
        account.sf_owner_email = owner_rel.get("Email") or account.sf_owner_email
        account.sf_owner_name  = owner_rel.get("Name") or account.sf_owner_name
        if not account.owner_user_id and account.sf_owner_email:
            owner_user = db.query(models.User).filter(
                func.lower(models.User.email) == account.sf_owner_email.lower()
            ).first()
            if owner_user:
                account.owner_user_id = owner_user.id

        log_sf_operation(
            db=db, operation_type="create" if is_new else "upsert", sf_object="Account",
            record_identifier=sf_id, fields_updated=["Name", "Industry", "CreatedDate", "Account_Manager_Lookup__c", "OwnerId"],
            status="success", source_system="sync_button",
            direction="inbound",
        )
        upserted_count += 1

    db.commit()
    return upserted_count


def backfill_sf_identity_links(db, user) -> int:
    """Call right after a new User is created (SSO first login, admin
    create-user). Accounts synced before this person had a Alternate CRM login
    stored their SF Owner/CSM email on sf_owner_email/sf_csm_email but left
    owner_user_id/assigned_csm_id null (see sync_accounts_from_salesforce) —
    this resolves those links retroactively by email match. Returns the
    number of accounts updated."""
    email = user.email.lower()
    updated = 0
    for account in db.query(models.Account).filter(
        models.Account.owner_user_id.is_(None), func.lower(models.Account.sf_owner_email) == email
    ).all():
        account.owner_user_id = user.id
        updated += 1
    for account in db.query(models.Account).filter(
        models.Account.assigned_csm_id.is_(None), func.lower(models.Account.sf_csm_email) == email
    ).all():
        account.assigned_csm_id = user.id
        updated += 1
    if updated:
        db.commit()
    return updated


def sync_contacts_from_salesforce(db: Session, sf: Salesforce, limit: int = 2000) -> int:
    """Pull SF Contacts tied to an already-synced Account — CSM Portal
    stakeholder mapping (item #7). Skips contacts whose Account hasn't been
    synced locally yet (nothing to attach to); `role` is never set here, see
    AccountStakeholder's doc comment for why."""
    if not sf:
        return 0

    limit_clause = f"LIMIT {limit}" if limit and limit > 0 else ""
    query = (
        "SELECT Id, Name, Email, Phone, Title, CreatedDate, AccountId "
        f"FROM Contact WHERE AccountId != null ORDER BY LastModifiedDate DESC {limit_clause}"
    ).strip()
    try:
        records = sf.query(query).get("records", [])
    except Exception as e:
        print(f"[SF] Contact query failed: {e}")
        raise

    upserted_count = 0
    for record in records:
        account = db.query(models.Account).filter(models.Account.sf_account_id == record["AccountId"]).first()
        if not account:
            continue

        sf_id = record["Id"]
        contact = db.query(models.AccountStakeholder).filter(models.AccountStakeholder.sf_contact_id == sf_id).first()
        is_new = contact is None
        if is_new:
            contact = models.AccountStakeholder(sf_contact_id=sf_id, account_id=account.id, name=record.get("Name") or "Unnamed Contact")
            db.add(contact)

        contact.account_id = account.id  # SF can re-parent a Contact to a different Account
        contact.name  = record.get("Name") or contact.name
        contact.email = record.get("Email") or contact.email
        contact.phone = record.get("Phone") or contact.phone
        contact.title = record.get("Title") or contact.title
        created_date = record.get("CreatedDate")
        contact.sf_created_at = contact.sf_created_at or _parse_sf_date(created_date[:10] if created_date else None)

        log_sf_operation(
            db=db, operation_type="create" if is_new else "upsert", sf_object="Contact",
            record_identifier=sf_id, fields_updated=["Name", "Email", "Phone", "Title", "AccountId"],
            status="success", source_system="sync_button",
            direction="inbound",
        )
        upserted_count += 1

    db.commit()
    return upserted_count


def _parse_sf_date(value) -> Optional[datetime]:
    """SF's CloseDate comes back as a plain 'YYYY-MM-DD' string, not a
    datetime — assigning that string directly to a DateTime column works on
    Postgres (implicit cast) but fails hard on SQLite, which requires a real
    datetime/date object. Parse explicitly so this isn't DB-driver-dependent."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


# The StageName values an AE/CSM close writes locally, and the only thing
# push_opportunity_to_salesforce can use to tell Salesforce a deal is closed:
# SF derives IsClosed/IsWon from StageName as read-only formula fields, so on
# the write path the stage name IS the close signal, not a label alongside it.
# ponytail: stock SF picklist values. An org with a renamed closed stage gets
# a visible INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST on the row's
# sf_push_error, not a silent wrong state — make these a SyncSettings field
# if that ever actually happens.
CLOSED_WON_STAGE = "Closed Won"
CLOSED_LOST_STAGE = "Closed Lost"

# The opening stage for a CSM-created renewal. Both the local row and the SF
# create payload have to use this same value: sync_opportunities_from_salesforce
# overwrites stage_name from SF unconditionally (`opp.stage_name =
# record.get("StageName") or opp.stage_name`, either direction mode), so a local
# label SF doesn't share is guaranteed to flip on the next pull. It used to be
# exactly that — created locally as "Renewal", pushed as "Prospecting".
NEW_RENEWAL_STAGE = "Prospecting"


# Opportunity stage precedence for the pull/push "never regress" rule.
# Deliberately NOT a StageName ordinal ladder — this org's custom sales
# process picklist isn't known, but IsClosed/IsWon are standard SF
# Opportunity fields regardless of custom stage labels, and "closed" vs
# "open" is the only distinction the bidirectional sync actually needs.
# (No contradiction with the constants above: on the *pull* side SF hands us
# IsClosed/IsWon already computed, which is exactly why they're the reliable
# thing to compare; it's only the *push* side that can't write them.)
def _opportunity_precedence(is_closed: bool, is_won: bool) -> int:
    """Higher = more advanced. Closed-Won is the only state a pull/push
    should never regress away from once reached locally."""
    if is_closed and is_won:
        return 2
    if is_closed:
        return 1
    return 0


def sync_opportunities_from_salesforce(db: Session, sf: Salesforce, limit: int = 1000, direction: str = "push_only") -> int:
    """Pull Salesforce Opportunities into the local Opportunity table.

    `direction` ("push_only" | "both", SyncSettings.opportunity_sync_direction)
    controls only the is_closed/is_won stage fields, not the rest of the row:
    display fields (Name, Amount, CloseDate, StageName, AccountId, Owner)
    always refresh every run — that's harmless reference-data freshening.
    Stage is different: in "push_only", a local Closed-Won (set by the AE's
    close-deal action, which pushes it to SF) is authoritative and a pull
    must never touch it — only "both" lets SF's stage advance the local one,
    still guarded by the never-regress precedence check below.

    This function is the pull half only — the push half (AE close-deal
    action) lives in the ae_pipeline route, mirroring how Lead sync splits
    sync_leads_from_salesforce (pull) from push_lead_to_salesforce (push)."""
    if not sf:
        return 0

    limit_clause = f"LIMIT {limit}" if limit and limit > 0 else ""
    query = (
        "SELECT Id, Name, Amount, CloseDate, StageName, IsClosed, IsWon, AccountId, Owner.Email "
        f"FROM Opportunity ORDER BY LastModifiedDate DESC {limit_clause}"
    ).strip()
    try:
        records = sf.query(query).get("records", [])
    except Exception as e:
        print(f"[SF] Opportunity query failed: {e}")
        raise

    upserted_count = 0
    for record in records:
        sf_id = record["Id"]
        opp = db.query(models.Opportunity).filter(models.Opportunity.sf_opportunity_id == sf_id).first()
        is_new = opp is None
        if is_new:
            opp = models.Opportunity(sf_opportunity_id=sf_id)
            db.add(opp)

        sf_account_id = record.get("AccountId")
        if sf_account_id:
            account = db.query(models.Account).filter(models.Account.sf_account_id == sf_account_id).first()
            if account:
                opp.account_id = account.id

        owner_email = ((record.get("Owner") or {}).get("Email"))
        if owner_email:
            owner = db.query(models.User).filter(models.User.email == owner_email).first()
            if owner:
                opp.owner_user_id = owner.id

        # OR-fallback for display fields
        opp.name       = record.get("Name") or opp.name
        opp.amount     = record.get("Amount") if record.get("Amount") is not None else opp.amount
        opp.close_date = _parse_sf_date(record.get("CloseDate")) or opp.close_date
        opp.stage_name = record.get("StageName") or opp.stage_name

        sf_is_closed = bool(record.get("IsClosed"))
        sf_is_won = bool(record.get("IsWon"))

        # Never regress, and only let a pull touch stage at all in "both"
        # mode — see the direction docstring above.
        if is_new:
            opp.is_closed, opp.is_won = sf_is_closed, sf_is_won
        elif direction == "both":
            current_order = _opportunity_precedence(opp.is_closed, opp.is_won)
            sf_order = _opportunity_precedence(sf_is_closed, sf_is_won)
            if sf_order >= current_order:
                opp.is_closed, opp.is_won = sf_is_closed, sf_is_won

        log_sf_operation(
            db=db, operation_type="create" if is_new else "upsert", sf_object="Opportunity",
            record_identifier=sf_id, fields_updated=["Name", "Amount", "CloseDate", "StageName", "IsClosed", "IsWon"],
            status="success", source_system="sync_button",
            direction="inbound",
        )
        upserted_count += 1

    db.commit()
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

def find_lead_or_opportunity_by_phone(sf: Salesforce, phone_number: str) -> Optional[dict]:
    """Live Salesforce lookup for a phone number with no matching local Lead —
    used when a direct-dial webhook can't attach the call to anything Alternate CRM
    already knows about (v11.4.2, RCA: inbound Salesforce Leads/Opportunities
    that never went through the outbound upload flow have no local row to
    match, so every first call created a placeholder "Unknown Caller" lead
    instead of the real record).

    Checks Lead first, then Contact -> most recent Opportunity via
    OpportunityContactRole (the standard SF junction; if an org doesn't use
    Contact Roles this simply returns no rows, same as no match).

    SOQL has no digit-normalizing function, so this fetches candidates via a
    LIKE on the last 7 digits (long enough to be practically unique) and
    confirms the match in Python — same suffix-matching approach
    dialer_service._find_lead_by_phone already uses locally.

    Returns {"type": "Lead"|"Opportunity", "id", "first_name", "last_name",
    "company", "email"} or None. Never raises — a lookup failure (no
    Contact Roles, API error, timeout) just means "no match found", the
    same as if this function didn't exist.
    """
    if not sf or not phone_number:
        return None
    digits = _normalize_digits(phone_number)
    if len(digits) < 7:
        return None
    suffix = digits[-7:]  # digits-only, safe to interpolate — never contains a quote

    def _matches(raw_phone):
        p = _normalize_digits(raw_phone)
        return bool(p) and (p.endswith(digits) or digits.endswith(p))

    try:
        leads = sf.query(
            f"SELECT Id, FirstName, LastName, Company, Email, Phone FROM Lead "
            f"WHERE Phone LIKE '%{suffix}%' LIMIT 5"
        ).get("records", [])
        for rec in leads:
            if _matches(rec.get("Phone")):
                return {
                    "type": "Lead", "id": rec["Id"],
                    "first_name": rec.get("FirstName") or "",
                    "last_name": rec.get("LastName") or "Unknown",
                    "company": rec.get("Company"), "email": rec.get("Email"),
                }

        contacts = sf.query(
            f"SELECT Id, FirstName, LastName, Phone, MobilePhone, Account.Name FROM Contact "
            f"WHERE Phone LIKE '%{suffix}%' OR MobilePhone LIKE '%{suffix}%' LIMIT 5"
        ).get("records", [])
        for rec in contacts:
            if not (_matches(rec.get("Phone")) or _matches(rec.get("MobilePhone"))):
                continue
            roles = sf.query(
                f"SELECT OpportunityId FROM OpportunityContactRole "
                f"WHERE ContactId = '{rec['Id']}' ORDER BY Opportunity.CreatedDate DESC LIMIT 1"
            ).get("records", [])
            if roles:
                account = rec.get("Account") or {}
                return {
                    "type": "Opportunity", "id": roles[0]["OpportunityId"],
                    "first_name": rec.get("FirstName") or "",
                    "last_name": rec.get("LastName") or "Unknown",
                    "company": account.get("Name"), "email": None,
                }
        return None
    except Exception as e:
        print(f"[SF] find_lead_or_opportunity_by_phone failed: {e}")
        return None


def find_sf_match_by_phone(db: Session, sf: Salesforce, phone: str, exclude_lead_id: str = None) -> Optional[dict]:
    """Phone-based fallback duplicate check for the lead-push paths
    (_do_push, push_pending_leads_to_salesforce) — the same root cause as the
    Aircall direct-dial dedup fix (v11.4.2): an existing SF Lead/Opportunity
    with no email, or a different email than the local lead has, was never
    caught by the email-only pre-create check those paths already ran, so a
    fresh duplicate Lead got created in Salesforce whenever the phone alone
    would have matched.

    Guards sf_lead_id's unique constraint exactly like
    backfill_direct_dial_leads does: a Lead match already linked to a
    *different* local lead is treated as no match (caller falls through to
    its normal create path) rather than stealing the link.
    """
    if not phone:
        return None
    match = find_lead_or_opportunity_by_phone(sf, phone)
    if not match:
        return None
    if match["type"] == "Lead":
        conflict = db.query(models.Lead).filter(
            models.Lead.sf_lead_id == match["id"], models.Lead.id != exclude_lead_id,
        ).first()
        if conflict:
            return None
    return match


def sf_lightning_url(instance_url: str, object_type: str, record_id: str) -> str:
    """The literal Salesforce Lightning record-view URL shape — the one place
    this path format lives, however instance_url was resolved (live client
    in routes/public_api_routes.py's _build_sf_url, persisted
    SalesforceConnection row here)."""
    return f"{instance_url}/lightning/r/{object_type}/{record_id}/view"


def salesforce_record_url(db: Session, object_type: str, record_id: str) -> Optional[str]:
    """Build a clickable Salesforce Lightning URL from the org's own
    instance_url (captured live from the API connection — never hardcode a
    domain, it differs per org). Returns None if there's no id or no active
    connection with a known instance_url yet."""
    if not record_id:
        return None
    conn = db.query(models.SalesforceConnection).filter(
        models.SalesforceConnection.is_active == True,
    ).first()
    if not conn or not conn.instance_url:
        return None
    return sf_lightning_url(conn.instance_url, object_type, record_id)


def _direct_dial_placeholder_query(db: Session):
    """The exact candidate set for backfill_direct_dial_leads — factored out
    so the "how many are left" count in its response uses the identical
    filter, not a hand-kept copy that could drift."""
    return db.query(models.Lead).filter(
        models.Lead.sf_opportunity_id.is_(None),
        models.Lead.first_name == "",
        models.Lead.last_name == "Unknown",
        or_(
            models.Lead.lead_source.like("aircall_webhook:%"),
            models.Lead.lead_source.like("aircall_sync:%"),
        ),
    )


def list_backfilled_direct_dial_leads(db: Session):
    """Every lead backfill_direct_dial_leads has ever actually enriched (its
    lead_source is tagged "+salesforce_match" on a real commit) — for
    auditing exactly which real leads a backfill run touched."""
    return (
        db.query(models.Lead)
        .filter(models.Lead.lead_source.ilike("%+salesforce_match"))
        .order_by(models.Lead.created_at.desc())
        .all()
    )


def backfill_direct_dial_leads(db: Session, sf: Salesforce, limit: int = 50, dry_run: bool = False) -> dict:
    """One-off backfill for placeholder "Unknown Caller" leads created by the
    direct-dial fallback BEFORE v11.4.2's live lookup shipped (see
    find_lead_or_opportunity_by_phone / dialer_service._find_or_create_lead_by_phone).
    Re-checks each one against Salesforce now and, on a match, enriches it
    in place — never creates a new lead, never touches a row an SDR/admin has
    since renamed or researched by hand (scoped to rows still exactly at the
    placeholder signature: first_name="", last_name="Unknown").

    limit bounds this to a single synchronous HTTP request's worth of work
    (each candidate costs up to 3 sequential SOQL round-trips) — call again
    while the response's "remaining" count is > 0 to work through a larger
    backlog; already-matched rows naturally drop out of the candidate filter,
    so repeat calls never re-process the same lead.

    dry_run=True runs the identical lookup logic but rolls back instead of
    committing, and returns a "preview" list showing exactly what each
    candidate would become — for inspecting real impact before writing.
    """
    if not sf:
        return {"checked": 0, "matched": 0, "skipped_conflict": 0, "remaining": 0, "preview": []}

    candidates = _direct_dial_placeholder_query(db).order_by(models.Lead.created_at.asc()).limit(limit).all()

    matched = 0
    skipped_conflict = 0
    preview = []
    for lead in candidates:
        sf_match = find_lead_or_opportunity_by_phone(sf, lead.phone)
        if not sf_match and lead.phone_secondary:
            sf_match = find_lead_or_opportunity_by_phone(sf, lead.phone_secondary)
        if not sf_match:
            preview.append({"lead_id": lead.id, "phone": lead.phone, "result": "no_match"})
            continue

        if sf_match["type"] == "Lead":
            # Guard sf_lead_id's unique constraint — another local lead may
            # already legitimately hold this exact Salesforce Lead Id (e.g.
            # from an old sync before push_only was set).
            conflict = db.query(models.Lead).filter(
                models.Lead.sf_lead_id == sf_match["id"], models.Lead.id != lead.id,
            ).first()
            if conflict:
                skipped_conflict += 1
                preview.append({
                    "lead_id": lead.id, "phone": lead.phone, "result": "skipped_conflict",
                    "sf_type": "Lead", "sf_id": sf_match["id"],
                })
                continue
            lead.sf_lead_id = sf_match["id"]
        else:
            lead.sf_opportunity_id = sf_match["id"]

        preview.append({
            "lead_id": lead.id, "phone": lead.phone, "result": "matched",
            "sf_type": sf_match["type"], "sf_id": sf_match["id"],
            "before": {"first_name": lead.first_name, "last_name": lead.last_name, "company": lead.company},
            "after": {
                "first_name": sf_match["first_name"], "last_name": sf_match["last_name"],
                "company": sf_match.get("company") or lead.company,
            },
        })

        lead.first_name = sf_match["first_name"]
        lead.last_name = sf_match["last_name"]
        if sf_match.get("company"):
            lead.company = sf_match["company"]
        if sf_match.get("email"):
            lead.email = sf_match["email"]
        lead.lead_source = f"{lead.lead_source}+salesforce_match"
        matched += 1

    if dry_run:
        db.rollback()
    else:
        db.commit()
    remaining = _direct_dial_placeholder_query(db).count()

    return {
        "checked": len(candidates),
        "matched": matched,
        "skipped_conflict": skipped_conflict,
        "remaining": remaining,
        "preview": preview,
    }


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

            # Duplicate check by phone — catches an SF record with no
            # email, or a different email than ours, that the check above
            # would otherwise miss (same root cause as the Aircall
            # direct-dial dedup fix, applied here to the push-to-SF path).
            phone_match = find_sf_match_by_phone(db, sf, lead.phone, exclude_lead_id=lead.id)
            if phone_match:
                if phone_match["type"] == "Lead":
                    lead.sf_lead_id = phone_match["id"]
                else:
                    lead.sf_opportunity_id = phone_match["id"]
                db.commit()
                result["pushed"] += 1
                result["linked"].append({"name": lead_name, "sf_id": phone_match["id"], "matched_by": "phone"})
                log_sf_operation(
                    operation_type="upsert", sf_object=phone_match["type"],
                    record_identifier=phone_match["id"],
                    first_name=lead.first_name, last_name=lead.last_name, email=lead.email,
                    fields_updated=["sf_lead_id" if phone_match["type"] == "Lead" else "sf_opportunity_id"],
                    status="success", source_system="sync_button",
                    response_payload={"action": "linked_to_existing_by_phone", "sf_id": phone_match["id"]},
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


def _update_sf_connection_sync_status(db: Session, status: str, error: str = None, records_synced: int = 0) -> None:
    """Stamp the active SalesforceConnection row after a sync attempt.

    Root cause of last_sync_at always showing "Never" in Control Center /
    legacy Settings: run_full_salesforce_sync (below) is the single choke
    point for both the manual '/api/admin/sync' button and the scheduled
    auto-sync job, but nothing ever wrote to last_sync_at/last_sync_status/
    last_sync_error/records_synced_last_run — those columns existed on the
    model since the start but had zero write sites anywhere in the codebase.
    """
    conn = db.query(models.SalesforceConnection).filter(
        models.SalesforceConnection.is_active == True
    ).first()
    if not conn:
        return
    conn.last_sync_at = datetime.utcnow()
    conn.last_sync_status = status
    conn.last_sync_error = error
    conn.records_synced_last_run = records_synced
    db.commit()


def run_full_salesforce_sync(db: Session, sf: Salesforce, settings) -> dict:
    """Core pull(if 2-way)+push sync logic — shared by the manual '/api/admin/sync'
    button and the scheduled auto-sync job (V44) so both behave identically."""
    sync_direction = settings.sync_direction if getattr(settings, 'sync_direction', None) else "push_only"

    opportunity_direction = getattr(settings, 'opportunity_sync_direction', None) or "push_only"

    try:
        lead_count = 0
        if sync_direction == "both":
            rtype_ids = json.loads(settings.record_type_ids) if settings.record_type_ids else None
            lead_count = sync_leads_from_salesforce(db, sf, limit=settings.lead_limit, record_type_ids=rtype_ids)

        # Account/Opportunity: reference data for the CSM Portal. Gated the
        # same way Lead's own pull is (sync_direction == "both") — "push_only"
        # means this batch job never touches SF for Opportunity/Account at
        # all (the AE close-deal action's push still happens independently).
        if opportunity_direction == "both":
            sync_accounts_from_salesforce(db, sf)
            sync_contacts_from_salesforce(db, sf)
            sync_opportunities_from_salesforce(db, sf, direction=opportunity_direction)

        push_stage = settings.sf_push_stage or "Meeting Scheduled"
        push_result = push_pending_leads_to_salesforce(db, sf, push_stage)
    except Exception as e:
        _update_sf_connection_sync_status(db, "failed", error=str(e))
        raise

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

    _update_sf_connection_sync_status(db, "success", records_synced=lead_count + push_result["pushed"])

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


def ae_owner_email(lead) -> str:
    """Email of the AE whose Salesforce User should own this lead. Lead
    Owner (unlike SDR_Name__c) is a normal lookup field, not a restricted
    picklist, so it accepts anyone with a real Salesforce User record —
    that's the field an AE's assignment maps to. Picks the first AE
    alphabetically by name when a lead is (unusually) assigned to more than
    one, for determinism."""
    aes = sorted(
        (u for u in lead.assigned_users if u.role == "AE" and u.email),
        key=lambda u: u.name or "",
    )
    return aes[0].email if aes else None


def _sf_user_id_by_email(sf: Salesforce, email: str):
    """Resolve a Salesforce User Id by Email, for setting Lead Owner. Best
    effort — returns None (never raises) if there's no matching User, so a
    lookup miss just skips the OwnerId write instead of failing the push."""
    if not email:
        return None
    safe_email = email.replace("'", "\\'")
    try:
        res = sf.query(f"SELECT Id FROM User WHERE Email = '{safe_email}' LIMIT 1")
        records = res.get("records", [])
        return records[0]["Id"] if records else None
    except Exception:
        return None


def sdr_only_names(lead) -> str:
    """Names for SDR_Name__c — a Salesforce restricted picklist limited to
    real SDR names. An AE's name is not a valid picklist value there, and
    Salesforce rejects the write wholesale (400 INVALID_OR_NULL_FOR_
    RESTRICTED_PICKLIST) rather than dropping just that field — a lead
    assigned only to an AE was failing to sync at all as a result. Only
    SDR-role assignees qualify; an AE-only lead pushes no value for this
    field — AE ownership goes to Salesforce's own Lead Owner field instead,
    see ae_owner_email below."""
    return ", ".join(u.name for u in lead.assigned_users if u.name and u.role == "SDR") or None


from services.sf_field_mapping import custom_payload, builtin_overrides


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
        "sdr_name": sdr_only_names(lead),
        "owner_email": ae_owner_email(lead),
        "description": _build_lead_description(lead, db),
        # v14.1.0: admin-configured extra fields (Control Center -> Salesforce field mapping), {SF API name: value}
        "custom_sf_fields": custom_payload(db, lead) if db is not None else {},
        # v14.1.0: built-in mappings an admin re-pointed ({lead key: SF name}) or switched off ({lead key: None})
        "builtin_overrides": builtin_overrides(db) if db is not None else {},
    }


# Alternate CRM lead field -> Salesforce Lead API name for the built-in push (extra fields are configured, see services/sf_field_mapping.py)
LEAD_FIELD_MAP = {
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
    for _always_sync_key in ("sdr_name", "linkedin_url", "owner_email"):
        if _always_sync_key not in updates and lead_info.get(_always_sync_key) is not None:
            updates = {**updates, _always_sync_key: lead_info[_always_sync_key]}

    overrides = lead_info.get("builtin_overrides") or {}
    field_map = {k: overrides.get(k, v) for k, v in LEAD_FIELD_MAP.items() if overrides.get(k, v)}

    sf_payload = {}
    for local_key, value in updates.items():
        # owner_email isn't a straight field passthrough — it needs an
        # Email -> Salesforce User Id lookup, done here (not in field_map)
        # since resolving it needs the `sf` client, which lead_push_info's
        # caller doesn't always have on hand.
        if local_key == "owner_email":
            owner_id = _sf_user_id_by_email(sf, value)
            if owner_id:
                sf_payload["OwnerId"] = owner_id
            continue
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

    custom = lead_info.get("custom_sf_fields") or {}
    sf_payload.update({k: v for k, v in custom.items() if k not in sf_payload})

    if not sf_payload:
        return True  # Nothing to push

    try:
        _call_with_picklist_retry(lambda p: sf.Lead.update(sf_lead_id, p), sf_payload, retry_fields=("SDR_Name__c", *custom, *[v for v in overrides.values() if v]))
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


def _rejected_restricted_picklist_field(exc: Exception, field: str) -> bool:
    """True if Salesforce rejected the request specifically because `field`
    failed a restricted-picklist check (errorCode
    INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST). Org-specific picklists (like
    SDR_Name__c — see sdr_only_names) can lag behind Alternate CRM's real SDR
    roster; when that happens SF rejects the *whole* create/update, not just
    that field, so callers use this to retry once with the field dropped
    rather than failing the entire push. Same .content-then-string-fallback
    approach as _is_entity_deleted_error."""
    content = getattr(exc, "content", None)
    if isinstance(content, list):
        for err in content:
            if (isinstance(err, dict) and err.get("errorCode") == "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST"
                    and field in (err.get("fields") or [])):
                return True
    return "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST" in str(exc) and field in str(exc)


# Why Salesforce can refuse ONE admin-mapped field (v14.1.0): it was deleted/renamed, the value is too long, or the type is wrong.
# One bad mapped field must not stop the rest of the lead from saving, so the caller drops just that field and retries.
_FIELD_LEVEL_ERRORS = {"INVALID_FIELD", "INVALID_FIELD_FOR_INSERT_UPDATE", "STRING_TOO_LONG", "INVALID_TYPE_ON_FIELD_IN_RECORD",
                       "FIELD_INTEGRITY_EXCEPTION", "FIELD_CUSTOM_VALIDATION_EXCEPTION", "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST"}


def _rejected_custom_field(exc: Exception, field: str) -> bool:
    content = getattr(exc, "content", None)
    if isinstance(content, list):
        for err in content:
            if isinstance(err, dict) and err.get("errorCode") in _FIELD_LEVEL_ERRORS and (
                    field in (err.get("fields") or []) or field in str(err.get("message", ""))):
                return True
    text = str(exc)
    return field in text and any(code in text for code in _FIELD_LEVEL_ERRORS | {"No such column"})


def _call_with_picklist_retry(call, payload: dict, retry_fields=("SDR_Name__c",)):
    """Run `call(payload)` (a Lead create/update), retrying once per field in
    retry_fields if SF rejected the *whole* request over just that field's
    restricted-picklist value — org-managed picklists like SDR_Name__c can
    lag behind Alternate CRM's real SDR roster, and SF has no partial-field
    rejection, so without this a stale picklist blocks every field on the
    lead, not just the one it doesn't like."""
    try:
        return call(payload)
    except Exception as e:
        for field in retry_fields:
            if field in payload and (_rejected_restricted_picklist_field(e, field)
                                     or (field != "SDR_Name__c" and _rejected_custom_field(e, field))):
                print(f"[SF Write-back] {field}={payload[field]!r} rejected by a restricted picklist — retrying without it")
                return _call_with_picklist_retry(call, {k: v for k, v in payload.items() if k != field}, retry_fields)
        raise


def _is_entity_deleted_error(exc: Exception) -> bool:
    """
    True if Salesforce rejected a request because the target record is gone:
    deleted (ENTITY_IS_DELETED), or merged / hard-deleted — a 404 "Resource
    Lead Not Found" with INVALID_CROSS_REFERENCE_KEY (RCA 2026-09-29: that
    variant kept the dead id forever). Matched on the 404 itself, not the
    bare errorCode — a bad OwnerId is also INVALID_CROSS_REFERENCE_KEY but a 400.

    Same .content-then-string-fallback approach as _extract_duplicate_sf_id.
    """
    if getattr(exc, "status", None) == 404:
        return True
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

    # Standard fields — push everything that has data (same names as LEAD_FIELD_MAP, minus any an admin re-pointed or switched off)
    overrides = lead_data.get("builtin_overrides") or {}
    standard_map = {k: overrides.get(k, LEAD_FIELD_MAP[k]) for k in (
        "title", "website", "industry", "city", "state", "country", "company_street", "company_postal_code",
        "description", "linkedin_url", "sdr_name") if overrides.get(k, LEAD_FIELD_MAP[k])}
    for local_key, sf_field in standard_map.items():
        val = lead_data.get(local_key)
        if val:
            sf_payload[sf_field] = val

    # AE-assigned leads set Lead Owner (a plain lookup) instead of
    # SDR_Name__c (a picklist restricted to SDR names — see sdr_only_names).
    owner_id = _sf_user_id_by_email(sf, lead_data.get("owner_email"))
    if owner_id:
        sf_payload["OwnerId"] = owner_id

    # Numeric fields need type conversion
    if lead_data.get("employee_count") and overrides.get("employee_count", LEAD_FIELD_MAP["employee_count"]):
        try:
            sf_payload[overrides.get("employee_count", LEAD_FIELD_MAP["employee_count"])] = int(lead_data["employee_count"])
        except (ValueError, TypeError):
            pass
    if lead_data.get("annual_revenue") and overrides.get("annual_revenue", LEAD_FIELD_MAP["annual_revenue"]):
        try:
            sf_payload[overrides.get("annual_revenue", LEAD_FIELD_MAP["annual_revenue"])] = float(str(lead_data["annual_revenue"]).replace(",", "").replace("$", ""))
        except (ValueError, TypeError):
            pass

    custom = lead_data.get("custom_sf_fields") or {}      # v14.1.0: admin-configured extra fields
    sf_payload.update({k: v for k, v in custom.items() if k not in sf_payload})

    # Remove empty values but KEEP required fields (False/0 from a custom field are real values)
    required = {"LastName", "Company", "Lead_Status__c", "Lead_Source_New__c"}
    sf_payload = {k: v for k, v in sf_payload.items() if v or k in required or k in custom}

    try:
        response = _call_with_picklist_retry(sf.Lead.create, sf_payload, retry_fields=("SDR_Name__c", *custom, *[v for v in overrides.values() if v]))
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


def push_opportunity_to_salesforce(db: Session, sf: Salesforce, opportunity) -> bool:
    """Write an Opportunity's stage fields back to Salesforce — the AE
    close-deal action's push half (see sync_opportunities_from_salesforce's
    own docstring for why the pull and push halves are split, mirroring how
    Lead sync splits sync_leads_from_salesforce from push_lead_to_salesforce).

    Simpler than push_lead_to_salesforce: fixed field set, no field_map, no
    entity-deleted recreate recovery (an Opportunity disappearing from SF
    mid-flow hasn't happened yet the way it has for Lead — add that recovery
    if it ever does).

    No-ops (returns without raising) if there's no SF client, or the
    Opportunity has no sf_opportunity_id — a Alternate CRM-native Opportunity, or
    one Salesforce has never heard of, so there's nothing there to push to.
    """
    if not sf or not opportunity.sf_opportunity_id:
        return False

    # IsClosed/IsWon are deliberately NOT in this payload, despite being what
    # the local row actually tracks. In Salesforce they are read-only formula
    # fields derived from StageName — sending them fails the whole update, and
    # sending them alongside a still-open StageName (which is what this used to
    # do, because apply_opportunity_close never moved stage_name off the open
    # stage) could not have worked even if they were writable. StageName is the
    # close signal; SF recomputes the other two from it, and the next pull reads
    # them back consistent. See CLOSED_WON_STAGE above.
    sf_payload = {
        "StageName": opportunity.stage_name,
        "CloseDate": opportunity.close_date.strftime("%Y-%m-%d") if opportunity.close_date else None,
        # Live finding, 2026-09-15: this org rejects any move to a Closed
        # stage without these — see the model's own comment on why
        # standard_product_names is semicolon-joined (Standard_Product_Name__c
        # is a multipicklist; that's SF's own wire format for one).
        "Standard_Product_Name__c": opportunity.standard_product_names,
        "Invoice_Number__c": opportunity.invoice_number,
        "Opportunity_Lost_Reason__c": opportunity.lost_reason,
    }
    sf_payload = {k: v for k, v in sf_payload.items() if v is not None}
    if not sf_payload:
        return True

    try:
        sf.Opportunity.update(opportunity.sf_opportunity_id, sf_payload)
        print(f"[SF Write-back] Updated Opportunity {opportunity.sf_opportunity_id}: {sf_payload}")
        log_sf_operation(
            db=db, operation_type="update", sf_object="Opportunity",
            record_identifier=opportunity.sf_opportunity_id,
            fields_updated=list(sf_payload.keys()),
            status="success",
            request_payload=sf_payload,
            source_system="ae_pipeline",
        )
        opportunity.sf_push_status = "success"
        opportunity.sf_push_error = None
        opportunity.sf_push_at = datetime.utcnow()
        db.commit()
        return True
    except Exception as e:
        error_str = str(e)
        print(f"[SF Write-back] Failed to update Opportunity {opportunity.sf_opportunity_id}: {e}")
        log_sf_operation(
            db=db, operation_type="update", sf_object="Opportunity",
            record_identifier=opportunity.sf_opportunity_id,
            fields_updated=list(sf_payload.keys()),
            status="failed", error_message=error_str,
            request_payload=sf_payload,
            source_system="ae_pipeline",
        )
        # The AE/CSM who made the edit has no other way to learn this failed
        # short of an admin checking the SF sync log — surface it on the row.
        opportunity.sf_push_status = "failed"
        opportunity.sf_push_error = error_str[:2000]
        opportunity.sf_push_at = datetime.utcnow()
        db.commit()
        return False
