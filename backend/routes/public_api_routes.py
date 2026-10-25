# ── routes/public_api_routes.py — Public API for external tool (CMT ↔ SF bridge) ──
"""
Public API endpoints — no Google SSO required.
Authentication via X-API-Key header (managed in Admin Settings → Public API tab).

Available endpoints:
  GET /api/public/sf/account       — Look up a Salesforce Account (or Lead fallback)
                                      using messaging_provider_AccountId__c or Account Name.
  GET /api/public/leads/search     — Search leads by name/email/company.
  GET /api/public/leads/{id}/calls — Call history for a lead.
  GET /api/public/health           — Unauthenticated liveness check.

A valid API key grants full (Super Admin-equivalent) read access — same trust
model as the existing sf/account endpoint. There is no per-key user identity or
role scoping, so treat the key itself as the access boundary: one key per
consumer, and only hand it out for read-only internal tooling (e.g. the
Alternate CRM MCP server in mcp_server/).
"""
import logging
import re
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from sqlalchemy.orm import Session
from pydantic import BaseModel
from auth import require_api_key, public_endpoint
from database import get_db
from salesforce import get_sf_client, sf_lightning_url
from routes.lead_helpers import _apply_filters
from domain.actor import Actor
from domain.lead_access import visible_leads
from routes.call_routes import get_lead_calls as _get_lead_calls
import models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/public", tags=["public-api"])

# An API key has no per-user role or pod, so it reads at unrestricted scope
# (see module docstring). Declared as a service Actor rather than a fake
# Super Admin token dict: same reach, but audit trails can tell the two
# apart, and the domain rule no longer needs a JWT-shaped input to be called.
_API_KEY_ACTOR = Actor.service("public-api-key")

# ── SF field name for SMS Magic Account ID on Account object ──────────────────
SF_MESSAGING_PROVIDER_FIELD = "messaging_provider_AccountId__c"

# ── Helpers ───────────────────────────────────────────────────────────────────

def _escape_soql(value: str) -> str:
    """Escape single quotes in SOQL string values to prevent injection."""
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _build_sf_url(sf_client, record_id: str, object_type: str) -> Optional[str]:
    """Build the full Salesforce Lightning URL for a record.
    
    Uses sf_instance from the live client rather than relying solely on DB,
    so it's always accurate even when instance_url hasn't been persisted yet.
    """
    try:
        instance = None
        # Prefer live client attribute (always accurate)
        if hasattr(sf_client, "sf_instance") and sf_client.sf_instance:
            instance = f"https://{sf_client.sf_instance}"
        # Fallback: derive from base_url attribute
        elif hasattr(sf_client, "base_url") and sf_client.base_url:
            # base_url is like "https://xxx.salesforce.com/services/data/vXX.0/"
            match = re.match(r"(https://[^/]+)", sf_client.base_url)
            if match:
                instance = match.group(1)
        if instance:
            return sf_lightning_url(instance, object_type, record_id)
    except Exception:
        pass
    return None


def _query_account_by_messaging_provider_id(sf, sms_id: str) -> Optional[dict]:
    """Query Salesforce Account object by messaging_provider_AccountId__c (exact match)."""
    safe_id = _escape_soql(sms_id)
    try:
        result = sf.query(
            f"SELECT Id, Name FROM Account WHERE {SF_MESSAGING_PROVIDER_FIELD} = '{safe_id}' LIMIT 1"
        )
        records = result.get("records", [])
        if records:
            return {"record": records[0], "confidence": "exact", "matched_by": "messaging_provider_id"}
    except Exception as e:
        err = str(e)
        if "INVALID_FIELD" in err or "No such column" in err:
            logger.warning(f"[PublicAPI] {SF_MESSAGING_PROVIDER_FIELD} field not found on Account object. "
                           f"Check SF field API name. Error: {e}")
            return None
        logger.error(f"[PublicAPI] SOQL error querying Account by messaging_provider_id: {e}")
        raise HTTPException(status_code=503,
                            detail="Salesforce query error. Check server logs.")
    return None


def _query_account_by_name(sf, company_name: str) -> Optional[dict]:
    """Query Salesforce Account by Name — exact first, then LIKE fallback."""
    safe_name = _escape_soql(company_name)

    # Step 1: Exact match
    try:
        result = sf.query(
            f"SELECT Id, Name FROM Account WHERE Name = '{safe_name}' LIMIT 1"
        )
        records = result.get("records", [])
        if records:
            return {"record": records[0], "confidence": "exact", "matched_by": "company_name"}
    except Exception as e:
        logger.error(f"[PublicAPI] SOQL error (Account exact name): {e}")
        raise HTTPException(status_code=503, detail="Salesforce query error.")

    # Step 2: LIKE fallback — return up to 5 matches
    try:
        result = sf.query(
            f"SELECT Id, Name FROM Account WHERE Name LIKE '%{safe_name}%' LIMIT 5"
        )
        records = result.get("records", [])
        if records:
            # Return the first match but include all candidates for CMT to choose
            return {
                "record": records[0],
                "confidence": "like",
                "matched_by": "company_name",
                "candidates": [{"sf_account_id": r["Id"], "account_name": r["Name"]}
                               for r in records],
            }
    except Exception as e:
        logger.error(f"[PublicAPI] SOQL error (Account LIKE name): {e}")
        raise HTTPException(status_code=503, detail="Salesforce query error.")

    return None


def _query_lead_by_messaging_provider_id(sf, sms_id: str) -> Optional[dict]:
    """Fallback: query Salesforce Lead by messaging_provider_AccountId__c."""
    safe_id = _escape_soql(sms_id)
    try:
        result = sf.query(
            f"SELECT Id, FirstName, LastName, Company FROM Lead "
            f"WHERE {SF_MESSAGING_PROVIDER_FIELD} = '{safe_id}' LIMIT 1"
        )
        records = result.get("records", [])
        if records:
            return {"record": records[0], "confidence": "exact", "matched_by": "messaging_provider_id"}
    except Exception as e:
        err = str(e)
        if "INVALID_FIELD" in err or "No such column" in err:
            logger.warning(f"[PublicAPI] {SF_MESSAGING_PROVIDER_FIELD} field not found on Lead object.")
            return None
        logger.error(f"[PublicAPI] SOQL error querying Lead by messaging_provider_id: {e}")
    return None


def _query_lead_by_company(sf, company_name: str) -> Optional[dict]:
    """Fallback: query Salesforce Lead by Company name — exact first, then LIKE."""
    safe_name = _escape_soql(company_name)

    # Exact
    try:
        result = sf.query(
            f"SELECT Id, FirstName, LastName, Company FROM Lead "
            f"WHERE Company = '{safe_name}' LIMIT 1"
        )
        records = result.get("records", [])
        if records:
            return {"record": records[0], "confidence": "exact", "matched_by": "company_name"}
    except Exception as e:
        logger.error(f"[PublicAPI] SOQL error (Lead exact company): {e}")

    # LIKE
    try:
        result = sf.query(
            f"SELECT Id, FirstName, LastName, Company FROM Lead "
            f"WHERE Company LIKE '%{safe_name}%' LIMIT 5"
        )
        records = result.get("records", [])
        if records:
            return {
                "record": records[0],
                "confidence": "like",
                "matched_by": "company_name",
                "candidates": [{"sf_lead_id": r["Id"],
                                "lead_name": f"{r.get('FirstName','')} {r.get('LastName','')}".strip(),
                                "company": r.get("Company", "")}
                               for r in records],
            }
    except Exception as e:
        logger.error(f"[PublicAPI] SOQL error (Lead LIKE company): {e}")

    return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/health", dependencies=[Depends(public_endpoint)])
def public_health():
    """Unauthenticated liveness check for the public API."""
    return {"status": "ok", "api": "Alternate CRM Public API"}


@router.get("/sf/account")
def get_sf_account(
    messaging_provider_id: Optional[str] = Query(None, description="SMS Magic Account ID (messaging_provider_AccountId__c value in Salesforce)"),
    company_name: Optional[str] = Query(None, description="Salesforce Account Name to look up"),
    _auth: bool = Depends(require_api_key),
):
    """
    Look up a Salesforce Account (or Lead fallback) using Alternate CRM's configured SF connection.

    Provide AT LEAST ONE of: messaging_provider_id | company_name

    Lookup priority:
      1. Try Salesforce Account object
           a. If messaging_provider_id → WHERE messaging_provider_AccountId__c = '<id>'
           b. If company_name → WHERE Name = '<name>' then LIKE fallback
      2. No Account found → try Salesforce Lead object (same matching)
      3. Nothing found → found: false

    Returns the full Salesforce Lightning URL for the matched record.
    """
    # ── Validate input ────────────────────────────────────────────────────────
    messaging_provider_id  = (messaging_provider_id  or "").strip() or None
    company_name  = (company_name  or "").strip() or None

    if not messaging_provider_id and not company_name:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of: messaging_provider_id, company_name"
        )

    # ── Get SF client (uses Alternate CRM's configured connection) ───────────────
    sf = get_sf_client()
    if not sf:
        raise HTTPException(
            status_code=503,
            detail="Salesforce is not connected. Ask your Alternate CRM admin to configure the SF connection."
        )

    # ── Step 1: Query Account ────────────────────────────────────────────────
    account_match = None
    if messaging_provider_id:
        account_match = _query_account_by_messaging_provider_id(sf, messaging_provider_id)
    if not account_match and company_name:
        account_match = _query_account_by_name(sf, company_name)

    if account_match:
        rec = account_match["record"]
        sf_account_id = rec["Id"]
        sf_url = _build_sf_url(sf, sf_account_id, "Account")
        response = {
            "found": True,
            "type": "Account",
            "sf_account_id": sf_account_id,
            "account_name": rec.get("Name", ""),
            "sf_url": sf_url,
            "matched_by": account_match["matched_by"],
            "confidence": account_match["confidence"],
        }
        if account_match.get("candidates"):
            response["candidates"] = account_match["candidates"]
        logger.info(f"[PublicAPI] Account found: id={sf_account_id}, confidence={account_match['confidence']}")
        return response

    # ── Step 2: No Account — fallback to Lead ────────────────────────────────
    lead_match = None
    if messaging_provider_id:
        lead_match = _query_lead_by_messaging_provider_id(sf, messaging_provider_id)
    if not lead_match and company_name:
        lead_match = _query_lead_by_company(sf, company_name)

    if lead_match:
        rec = lead_match["record"]
        sf_lead_id = rec["Id"]
        sf_url = _build_sf_url(sf, sf_lead_id, "Lead")
        lead_name = f"{rec.get('FirstName', '')} {rec.get('LastName', '')}".strip()
        response = {
            "found": True,
            "type": "Lead",
            "sf_lead_id": sf_lead_id,
            "lead_name": lead_name,
            "company": rec.get("Company", ""),
            "sf_url": sf_url,
            "matched_by": lead_match["matched_by"],
            "confidence": lead_match["confidence"],
            "note": "No Account record found in Salesforce. Returning matching Lead record.",
        }
        if lead_match.get("candidates"):
            response["candidates"] = lead_match["candidates"]
        logger.info(f"[PublicAPI] Lead fallback used: id={sf_lead_id}, confidence={lead_match['confidence']}")
        return response

    # ── Step 3: Nothing found ─────────────────────────────────────────────────
    logger.info(f"[PublicAPI] No Account or Lead found for messaging_provider_id={messaging_provider_id!r}, company_name={company_name!r}")
    return {
        "found": False,
        "message": "No Account or Lead found in Salesforce for the given identifier.",
        "searched": {
            "messaging_provider_id": messaging_provider_id,
            "company_name": company_name,
        }
    }


@router.get("/leads/search")
def search_leads(
    q: str = Query(..., min_length=1, description="Search leads by name, email, or company"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _auth: bool = Depends(require_api_key),
):
    """Search leads for internal read-only tooling (e.g. the Alternate CRM MCP server)."""
    base = visible_leads(db, _API_KEY_ACTOR, global_view=True)
    base = _apply_filters(base, search=q)
    leads = base.order_by(models.Lead.created_at.desc()).limit(limit).all()
    return {
        "leads": [
            {
                "id": l.id,
                "name": f"{l.first_name or ''} {l.last_name or ''}".strip(),
                "company": l.company,
                "status": l.status,
                "assigned_to_name": l.assigned_users[0].name if l.assigned_users else None,
            }
            for l in leads
        ]
    }


@router.get("/leads/{lead_id}/calls")
def get_lead_calls_public(
    lead_id: str,
    page: int = 1,
    limit: int = 10,
    db: Session = Depends(get_db),
    _auth: bool = Depends(require_api_key),
):
    """Call history for a lead — same data/shape as the internal endpoint this wraps."""
    # The API key is a Super-Admin-reach service actor (see _API_KEY_ACTOR).
    return _get_lead_calls(lead_id=lead_id, page=page, limit=limit, db=db,
                           user={"sub": _API_KEY_ACTOR.id, "role": _API_KEY_ACTOR.role})


# ── Dogfooding: Inbound Lead Capture from Marketing Site ──────────────────────

# ── Dogfooding: Inbound Lead Capture from Marketing Site ──────────────────────

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+'\-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$")


def _sanitize_inbound_text(val: Optional[str], max_len: int = 500) -> str:
    """Strip dangerous HTML/script tags and normalize whitespace."""
    if not val:
        return ""
    clean = re.sub(r"<[^>]*?>", "", str(val))
    return clean.strip()[:max_len]


class InboundLeadPayload(BaseModel):
    first_name: str
    last_name: Optional[str] = ""
    email: str
    company: Optional[str] = ""
    phone: Optional[str] = ""
    team_size: Optional[str] = ""
    primary_interest: Optional[str] = ""
    notes: Optional[str] = ""
    source: Optional[str] = "Website - Early Access Request"
    website_hp: Optional[str] = ""  # Honeypot field for bot spam trapping


@router.post("/leads/inbound", dependencies=[Depends(public_endpoint)])
def create_inbound_lead(payload: InboundLeadPayload, db: Session = Depends(get_db)):
    """
    Public inbound lead capture endpoint for AlternateCRM's marketing site.
    Ingests visitor early-access requests directly into AlternateCRM's database
    for real dogfooding (Pipeline, Dialer queue, Cadences, and Dashboard activity).
    """
    # 1. Anti-bot honeypot check: Bots fill hidden website_hp field
    if payload.website_hp and payload.website_hp.strip():
        logger.info(f"[InboundLead] Bot submission caught by honeypot: {payload.email}")
        return {
            "success": True,
            "lead_id": "bot_filtered",
            "status": "created",
            "message": "Thank you! Your early access request has been recorded."
        }

    # 2. Strict email validation & normalization
    clean_email = (payload.email or "").strip().lower()
    if (
        not clean_email
        or len(clean_email) > 255
        or not EMAIL_REGEX.match(clean_email)
        or ".." in clean_email
        or clean_email.startswith(".")
        or clean_email.endswith(".")
    ):
        raise HTTPException(
            status_code=400,
            detail="Please provide a valid work email address (e.g., name@company.com)."
        )

    # 3. Clean and sanitize inputs against buffer-exhaustion / XSS injection
    first_name = _sanitize_inbound_text(payload.first_name, 100)
    if not first_name:
        raise HTTPException(status_code=400, detail="First name is required.")

    last_name = _sanitize_inbound_text(payload.last_name, 100) or "Unknown"

    company = _sanitize_inbound_text(payload.company, 200)
    if not company:
        # Intelligent company fallback inferred from business email domain
        domain = clean_email.split("@")[-1].lower() if "@" in clean_email else ""
        public_providers = {
            "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
            "icloud.com", "aol.com", "proton.me", "protonmail.com"
        }
        if domain and domain not in public_providers and "." in domain:
            company = domain.split(".")[0].capitalize()
        else:
            company = "Unknown"

    phone = (payload.phone or "").strip()
    if phone:
        phone_digits = re.sub(r"[^\d+]", "", phone)
        if len(phone_digits) < 7 or len(phone) > 50:
            phone = None  # discard malformed phone rather than erroring out
        else:
            phone = _sanitize_inbound_text(phone, 50)
    else:
        phone = None

    team_size = _sanitize_inbound_text(payload.team_size, 50)
    interest = _sanitize_inbound_text(payload.primary_interest, 100)
    user_notes = _sanitize_inbound_text(payload.notes, 2000)

    try:
        import ownership_history as oh
        # Find active Admin for assignment
        admin_user = db.query(models.User).filter(
            models.User.role.in_(["Super Admin", "Admin", "Pod Admin"]),
            models.User.left_at.is_(None)
        ).order_by(models.User.created_at.asc()).first()

        # 4. Deduplication & Re-engagement handling
        existing = db.query(models.Lead).filter(models.Lead.email == clean_email).first()
        if existing:
            # Backfill any missing contact details
            if (not existing.company or existing.company == "Unknown") and company != "Unknown":
                existing.company = company
            if not existing.phone and phone:
                existing.phone = phone
            if not existing.first_name:
                existing.first_name = first_name

            # Ensure Inbound and Website tags are attached
            for tag_name in ["Inbound", "Website"]:
                tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
                if not tag:
                    tag = models.Tag(name=tag_name)
                    db.add(tag)
                    db.flush()
                if tag not in existing.tags:
                    existing.tags.append(tag)

            # If existing lead was unassigned, assign to active admin
            if not existing.assigned_users and admin_user:
                models.assign_lead(admin_user, existing, reason=oh.R_LEAD_CREATE, actor_id="public-inbound")

            # If existing lead was in a terminal state (e.g. Disqualified / Won), re-open
            reopened = False
            if existing.status in models.TERMINAL_STATUSES:
                old_status = existing.status
                existing.status = "Lead Assigned"
                existing.lead_closed_at = None
                existing.closed_reason = None
                models.log_status_change(db, existing.id, old_status, "Lead Assigned", "Website Inbound Re-Engagement")
                reopened = True

            # Bump priority score to high intent
            existing.priority_score = 100
            existing.lead_started_at = datetime.now(timezone.utc)

            # Record detailed re-engagement note
            reengage_text = (
                f"[Website Inbound Request] {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
                f"• Re-Engagement: Inbound early access request received from marketing site\n"
                f"• Team Size: {team_size or 'Not specified'}\n"
                f"• Primary Interest: {interest or 'General Conversation OS'}\n"
                f"• Notes: {user_notes or 'None'}"
                + ("\n• Status Update: Lead re-opened from previous terminal state" if reopened else "")
            )
            db.add(models.Note(lead_id=existing.id, content=reengage_text, author="Website (Inbound)"))
            db.commit()
            db.refresh(existing)

            # Invalidate caches
            try:
                from cache import invalidate
                invalidate('dashboard'); invalidate('leads_page'); invalidate('leads_count'); invalidate('my_leads')
            except Exception:
                pass

            return {
                "success": True,
                "lead_id": existing.id,
                "status": "existing_updated",
                "message": "Thank you! We have updated your priority early access request."
            }

        # 5. Create Brand-New Lead in AlternateCRM Database
        lead_id = models.generate_uuid()
        new_lead = models.Lead(
            id=lead_id,
            sf_lead_id=f"inbound-{uuid.uuid4().hex[:8]}",
            first_name=first_name,
            last_name=last_name,
            email=clean_email,
            phone=phone,
            company=company,
            status="Lead Assigned",
            lead_source="Website - Early Access Request",
            lead_started_at=datetime.now(timezone.utc),
            priority_score=100,
            talking_points=f"Inbound early access request. Primary interest: {interest or 'General OS'}. Team size: {team_size or 'Not specified'}.",
        )
        db.add(new_lead)
        db.flush()

        # Auto-assign to active admin or Super Admin
        if admin_user:
            models.assign_lead(admin_user, new_lead, reason=oh.R_LEAD_CREATE, actor_id="public-inbound")

        # Add Inbound and Website tags
        for tag_name in ["Inbound", "Website"]:
            tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
            if not tag:
                tag = models.Tag(name=tag_name)
                db.add(tag)
                db.flush()
            if tag not in new_lead.tags:
                new_lead.tags.append(tag)

        # Status log
        models.log_status_change(db, new_lead.id, None, "Lead Assigned", "Website Inbound")

        # Initial detail note
        note_content = (
            f"[Inbound Lead Form]\n"
            f"• Contact: {first_name} {last_name} ({clean_email})\n"
            f"• Company: {company}\n"
            f"• Team Size: {team_size or 'Not specified'}\n"
            f"• Primary Interest: {interest or 'General Conversation OS'}\n"
            f"• Notes: {user_notes or 'None'}"
        )
        db.add(models.Note(lead_id=new_lead.id, content=note_content, author="Website (Inbound)"))

        # Log activity to user_activity_logs for real-time telemetry
        try:
            from activity_logger import log_activity
            log_activity(
                admin_user.id if admin_user else "system",
                "CREATE_LEAD",
                user_email=clean_email,
                user_name=f"{first_name} {last_name}".strip(),
                object_type="lead",
                object_id=new_lead.id,
                metadata={
                    "company": company,
                    "email": clean_email,
                    "source": "website_early_access",
                    "team_size": team_size,
                    "primary_interest": interest
                }
            )
        except Exception as e:
            logger.warning(f"Failed to log inbound activity: {e}")

        db.commit()
        db.refresh(new_lead)

        # Invalidate dashboard & leads cache
        try:
            from cache import invalidate
            invalidate('dashboard')
            invalidate('leads_page')
            invalidate('leads_count')
            invalidate('my_leads')
            invalidate('lead_companies')
        except Exception:
            pass

        return {
            "success": True,
            "lead_id": new_lead.id,
            "status": "created",
            "message": "Thank you! Your early access request has been recorded."
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"[InboundLead] Error saving inbound lead: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Unable to process your request. Please try again.")


