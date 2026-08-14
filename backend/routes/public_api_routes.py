# ── routes/public_api_routes.py — Public API for external tool (CMT ↔ SF bridge) ──
"""
Public API endpoints — no Google SSO required.
Authentication via X-API-Key header (managed in Admin Settings → Public API tab).

Available endpoints:
  GET /api/public/sf/account       — Look up a Salesforce Account (or Lead fallback)
                                      using RCMMessaging_AccountId__c or Account Name.
  GET /api/public/leads/search     — Search leads by name/email/company.
  GET /api/public/leads/{id}/calls — Call history for a lead.
  GET /api/public/health           — Unauthenticated liveness check.

A valid API key grants full (Super Admin-equivalent) read access — same trust
model as the existing sf/account endpoint. There is no per-key user identity or
role scoping, so treat the key itself as the access boundary: one key per
consumer, and only hand it out for read-only internal tooling (e.g. the
RCM MCP server in mcp_server/).
"""
import logging
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from sqlalchemy.orm import Session

from auth import require_api_key
from database import get_db
from salesforce import get_sf_client
from routes.lead_helpers import _build_lead_query, _apply_filters
from routes.call_routes import get_lead_calls as _get_lead_calls
import models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/public", tags=["public-api"])

# Synthetic identity for _build_lead_query — an API key has no per-user role/pod,
# so it's granted the same unrestricted scope as Super Admin (see module docstring).
_FULL_ACCESS_USER = {"role": "Super Admin", "sub": "public-api-key"}

# ── SF field name for RCM Messaging Account ID on Account object ──────────────────
SF_EXTERNAL_ID_FIELD = "RCMMessaging_AccountId__c"

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
            return f"{instance}/lightning/r/{object_type}/{record_id}/view"
    except Exception:
        pass
    return None


def _query_account_by_rcm_messaging_id(sf, sms_id: str) -> Optional[dict]:
    """Query Salesforce Account object by RCMMessaging_AccountId__c (exact match)."""
    safe_id = _escape_soql(sms_id)
    try:
        result = sf.query(
            f"SELECT Id, Name FROM Account WHERE {SF_EXTERNAL_ID_FIELD} = '{safe_id}' LIMIT 1"
        )
        records = result.get("records", [])
        if records:
            return {"record": records[0], "confidence": "exact", "matched_by": "rcm_messaging_id"}
    except Exception as e:
        err = str(e)
        if "INVALID_FIELD" in err or "No such column" in err:
            logger.warning(f"[PublicAPI] {SF_EXTERNAL_ID_FIELD} field not found on Account object. "
                           f"Check SF field API name. Error: {e}")
            return None
        logger.error(f"[PublicAPI] SOQL error querying Account by rcm_messaging_id: {e}")
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


def _query_lead_by_rcm_messaging_id(sf, sms_id: str) -> Optional[dict]:
    """Fallback: query Salesforce Lead by RCMMessaging_AccountId__c."""
    safe_id = _escape_soql(sms_id)
    try:
        result = sf.query(
            f"SELECT Id, FirstName, LastName, Company FROM Lead "
            f"WHERE {SF_EXTERNAL_ID_FIELD} = '{safe_id}' LIMIT 1"
        )
        records = result.get("records", [])
        if records:
            return {"record": records[0], "confidence": "exact", "matched_by": "rcm_messaging_id"}
    except Exception as e:
        err = str(e)
        if "INVALID_FIELD" in err or "No such column" in err:
            logger.warning(f"[PublicAPI] {SF_EXTERNAL_ID_FIELD} field not found on Lead object.")
            return None
        logger.error(f"[PublicAPI] SOQL error querying Lead by rcm_messaging_id: {e}")
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

@router.get("/health")
def public_health():
    """Unauthenticated liveness check for the public API."""
    return {"status": "ok", "api": "RCM Public API"}


@router.get("/sf/account")
def get_sf_account(
    rcm_messaging_id: Optional[str] = Query(None, description="RCM Messaging Account ID (RCMMessaging_AccountId__c value in Salesforce)"),
    company_name: Optional[str] = Query(None, description="Salesforce Account Name to look up"),
    _auth: bool = Depends(require_api_key),
):
    """
    Look up a Salesforce Account (or Lead fallback) using RCM's configured SF connection.

    Provide AT LEAST ONE of: rcm_messaging_id | company_name

    Lookup priority:
      1. Try Salesforce Account object
           a. If rcm_messaging_id → WHERE RCMMessaging_AccountId__c = '<id>'
           b. If company_name → WHERE Name = '<name>' then LIKE fallback
      2. No Account found → try Salesforce Lead object (same matching)
      3. Nothing found → found: false

    Returns the full Salesforce Lightning URL for the matched record.
    """
    # ── Validate input ────────────────────────────────────────────────────────
    rcm_messaging_id  = (rcm_messaging_id  or "").strip() or None
    company_name  = (company_name  or "").strip() or None

    if not rcm_messaging_id and not company_name:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of: rcm_messaging_id, company_name"
        )

    # ── Get SF client (uses RCM's configured connection) ───────────────
    sf = get_sf_client()
    if not sf:
        raise HTTPException(
            status_code=503,
            detail="Salesforce is not connected. Ask your RCM admin to configure the SF connection."
        )

    # ── Step 1: Query Account ────────────────────────────────────────────────
    account_match = None
    if rcm_messaging_id:
        account_match = _query_account_by_rcm_messaging_id(sf, rcm_messaging_id)
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
    if rcm_messaging_id:
        lead_match = _query_lead_by_rcm_messaging_id(sf, rcm_messaging_id)
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
    logger.info(f"[PublicAPI] No Account or Lead found for rcm_messaging_id={rcm_messaging_id!r}, company_name={company_name!r}")
    return {
        "found": False,
        "message": "No Account or Lead found in Salesforce for the given identifier.",
        "searched": {
            "rcm_messaging_id": rcm_messaging_id,
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
    """Search leads for internal read-only tooling (e.g. the RCM MCP server)."""
    base = _build_lead_query(db, _FULL_ACCESS_USER, global_view=True)
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
    return _get_lead_calls(lead_id=lead_id, page=page, limit=limit, db=db)
