# ── routes/admin_sync_routes.py — Salesforce sync, settings, AM sync (split from admin_routes.py) ──
import os
import logging
import json
import threading
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import require_admin, require_super_admin
from salesforce import (
    LEAD_FIELD_MAP,
    get_sf_client,
    get_record_types_from_salesforce,
    run_full_salesforce_sync,
    backfill_direct_dial_leads,
    list_backfilled_direct_dial_leads,
)
from routes._admin_helpers import _get_or_create_sync_settings
from activity_logger import log_activity
from services import sf_field_mapping, audit

router = APIRouter(prefix="/api/admin", tags=["Admin – Sync"])


def _mask_llm_key(key: str) -> str:
    """Return a masked version of the LLM API key for safe display in the UI.
    Returns '' when no key is set. Never exposes the full key to the frontend."""
    if not key:
        return ""
    return key[:8] + "•" * max(len(key) - 12, 4) + key[-4:] if len(key) > 12 else "••••"



# ── Salesforce Sync & Settings ───────────────────────────────────────────────

@router.post("/sync")
def sync_salesforce(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    sf = get_sf_client()
    if not sf:
        raise HTTPException(status_code=500, detail="Salesforce configuration missing or invalid credentials")
    try:
        settings = _get_or_create_sync_settings(db)
        return run_full_salesforce_sync(db, sf, settings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync/backfill-direct-dial-leads")
def backfill_direct_dial_leads_endpoint(
    limit: int = 50, dry_run: bool = False, db: Session = Depends(get_db), admin: dict = Depends(require_admin),
):
    """One-off cleanup for placeholder "Unknown Caller" leads created before
    v11.4.2's live Salesforce lookup shipped (see salesforce.py's
    backfill_direct_dial_leads for the exact matching/safety rules). Bounded
    per call — re-call while the response's "remaining" count is > 0.
    dry_run=true previews the exact per-lead changes without writing any."""
    sf = get_sf_client()
    if not sf:
        raise HTTPException(status_code=500, detail="Salesforce configuration missing or invalid credentials")
    try:
        return backfill_direct_dial_leads(db, sf, limit=limit, dry_run=dry_run)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sync/backfill-direct-dial-leads/matched")
def list_backfilled_direct_dial_leads_endpoint(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Audit trail: every lead a real (non-dry-run) backfill call has enriched so far."""
    leads = list_backfilled_direct_dial_leads(db)
    return [
        {
            "id": l.id, "first_name": l.first_name, "last_name": l.last_name, "company": l.company,
            "phone": l.phone, "sf_lead_id": l.sf_lead_id, "sf_opportunity_id": l.sf_opportunity_id,
            "lead_source": l.lead_source,
        }
        for l in leads
    ]


@router.get("/sync-settings")
def get_sync_settings(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    settings = _get_or_create_sync_settings(db)
    rtype_ids = json.loads(settings.record_type_ids) if settings.record_type_ids else []
    return {
        "lead_limit":      settings.lead_limit,
        "record_type_ids": rtype_ids,
        "sf_push_stage":   settings.sf_push_stage or "Meeting Scheduled",
        "sync_direction":  settings.sync_direction if hasattr(settings, 'sync_direction') and settings.sync_direction else "push_only",
        "opportunity_sync_direction": getattr(settings, 'opportunity_sync_direction', None) or "push_only",
        "opportunity_writeback_enabled": bool(getattr(settings, 'opportunity_writeback_enabled', False)),
        "allow_multi_pod_sdr": settings.allow_multi_pod_sdr,
        # V44: Salesforce auto-sync schedule
        "sf_auto_sync_enabled":     getattr(settings, 'sf_auto_sync_enabled', False) or False,
        "sf_auto_sync_hour_utc":    getattr(settings, 'sf_auto_sync_hour_utc', None),
        "sf_auto_sync_minute_utc":  getattr(settings, 'sf_auto_sync_minute_utc', 0) or 0,
        "sf_auto_sync_last_run_at": settings.sf_auto_sync_last_run_at.isoformat() if getattr(settings, 'sf_auto_sync_last_run_at', None) else None,
        # Phase 3
        "max_call_attempts":                settings.max_call_attempts if settings.max_call_attempts is not None else 5,
        "min_call_attempts_for_unreachable": settings.min_call_attempts_for_unreachable if settings.min_call_attempts_for_unreachable is not None else 3,
        "sync_declined_to_salesforce":      settings.sync_declined_to_salesforce if hasattr(settings, 'sync_declined_to_salesforce') else False,
        "sync_unreachable_to_salesforce":   settings.sync_unreachable_to_salesforce if hasattr(settings, 'sync_unreachable_to_salesforce') else False,
        "terminal_lead_cooldown_days":      settings.terminal_lead_cooldown_days if settings.terminal_lead_cooldown_days is not None else 30,
        "conversation_min_seconds":         settings.conversation_min_seconds if settings.conversation_min_seconds is not None else 120,
        "updated_at":      settings.updated_at.isoformat() if settings.updated_at else None,
        # Alternate Messenger / Messaging Provider messaging
        "messenger_enabled":      getattr(settings, 'messenger_enabled', False) or False,
        "messenger_base_url":     getattr(settings, 'messenger_base_url', '') or '',
        # Masked like dialer_api_key below — this endpoint is require_admin
        # (Pod Admin included), so returning the raw key handed a live
        # credential to every Pod Admin. "••••" is the same sentinel the
        # dialer key uses, and update_sync_settings ignores it on write.
        "messenger_api_key":      "••••" if getattr(settings, 'messenger_api_key', None) else '',
        "messenger_user_id":      getattr(settings, 'messenger_user_id', '') or '',
        "messenger_account_id":   getattr(settings, 'messenger_account_id', '') or '',
        "messenger_sender_id":    getattr(settings, 'messenger_sender_id', '') or '',
        "mcp_write_enabled":       bool(getattr(settings, "mcp_write_enabled", False)),
        "mcp_everyone_enabled":    bool(getattr(settings, "mcp_everyone_enabled", False)),
        # Messaging provider selection
        "messaging_provider":            getattr(settings, 'messaging_provider', 'messenger') or 'messenger',
        "aircall_messaging_number_id":   getattr(settings, 'aircall_messaging_number_id', '') or '',
        # Cadence/Messaging Sandbox
        "sandbox_test_phone_number":     getattr(settings, 'sandbox_test_phone_number', '') or '',
        # Dialer credential mode
        "dialer_use_shared_creds": getattr(settings, 'dialer_use_shared_creds', True),
        "dialer_api_key":          "••••" if getattr(settings, 'dialer_api_key', None) else '',
        "dialer_user_id":          getattr(settings, 'dialer_user_id', '') or '',
        # V29: Dynamic call outcome configuration
        "outcome_config":  models.get_outcome_config(db),
        # AI prompt customization
        "research_prompt": getattr(settings, 'research_prompt', None) or '',
        # V40 (Research v2): admin-controlled research gate toggle
        "require_research_before_calling": bool(getattr(settings, 'require_research_before_calling', False)),
        # LLM / AI Research settings — key is masked for display (never exposed raw)
        "llm_provider": getattr(settings, 'llm_provider', 'groq') or 'groq',
        "llm_model":    getattr(settings, 'llm_model', 'gemma2-9b-it') or 'gemma2-9b-it',
        "llm_api_key":  _mask_llm_key(getattr(settings, 'llm_api_key', None)),
        # V33: Floating Widget
        "widget_position":         getattr(settings, 'widget_position', 'bottom-right') or 'bottom-right',
        "widget_theme":            getattr(settings, 'widget_theme', 'dark') or 'dark',
        "widget_allowed_domains":  json.loads(settings.widget_allowed_domains) if getattr(settings, 'widget_allowed_domains', None) else [],
    }


@router.get("/sf-connection-info")
def get_sf_connection_info(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Return Salesforce connection details: instance URL, username, domain type.

    BUG-4 FIX: Check DB-stored connection first (used when admin saved creds via the
    Settings UI), then fall back to env vars. Previously only read env vars, causing
    the Settings page to show 'Not configured' even when the DB connection was active.
    """
    sf_username = None
    domain_label = "Production"
    instance_url = None

    # ── Step 1: Try DB connection first ──────────────────────────────────────
    try:
        conn = db.query(models.SalesforceConnection).filter(
            models.SalesforceConnection.is_active == True,
            models.SalesforceConnection.connection_status != "disconnected",
        ).first()
        if conn:
            sf_username = conn.username
            domain_label = "Sandbox" if conn.environment == "sandbox" else "Production"
            instance_url = conn.instance_url
    except Exception:
        pass

    # ── Step 2: Fall back to env vars ─────────────────────────────────────────
    if not sf_username:
        sf_username = os.getenv("SF_USERNAME", "")
        sf_domain = os.getenv("SF_DOMAIN", "login")
        domain_label = "Sandbox" if sf_domain == "test" else "Production"

    # ── Step 3: Try to get instance URL from live SF client if still unknown ──
    if not instance_url:
        try:
            sf = get_sf_client()
            if sf and hasattr(sf, 'sf_instance'):
                instance_url = f"https://{sf.sf_instance}"
        except Exception:
            pass

    sf_domain_fallback = "test" if domain_label == "Sandbox" else "login"
    return {
        "connected": bool(sf_username),
        "username": sf_username,
        "domain_type": domain_label,
        "instance_url": instance_url or f"https://{sf_domain_fallback}.salesforce.com",
    }

# require_super_admin: require_admin admits Pod Admin, but every field here
# is org-wide (Salesforce sync, dialer credentials and provider, POD and
# call-outcome config) and the UI only ever offered it to Super Admins. GET
# stays on require_admin — masked secrets, and legacy read-only callers.
@router.patch("/sync-settings")
def update_sync_settings(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    settings = _get_or_create_sync_settings(db)

    if "lead_limit" in body:
        limit = int(body["lead_limit"])
        if limit < 0:
            raise HTTPException(status_code=422, detail="lead_limit must be 0 or positive")
        settings.lead_limit = limit

    if "record_type_ids" in body:
        rtype_ids = body["record_type_ids"]
        settings.record_type_ids = json.dumps(rtype_ids) if rtype_ids else None

    if "sf_push_stage" in body:
        settings.sf_push_stage = body["sf_push_stage"]

    if "sync_direction" in body:
        direction = body["sync_direction"]
        if direction not in ("push_only", "both"):
            raise HTTPException(status_code=422, detail="sync_direction must be 'push_only' or 'both'")
        settings.sync_direction = direction

    if "opportunity_sync_direction" in body:
        direction = body["opportunity_sync_direction"]
        if direction not in ("push_only", "both"):
            raise HTTPException(status_code=422, detail="opportunity_sync_direction must be 'push_only' or 'both'")
        settings.opportunity_sync_direction = direction

    if "opportunity_writeback_enabled" in body:
        settings.opportunity_writeback_enabled = bool(body["opportunity_writeback_enabled"])

    if "allow_multi_pod_sdr" in body:
        settings.allow_multi_pod_sdr = bool(body["allow_multi_pod_sdr"])

    # V44: Salesforce auto-sync schedule
    if "sf_auto_sync_enabled" in body:
        settings.sf_auto_sync_enabled = bool(body["sf_auto_sync_enabled"])

    if "sf_auto_sync_hour_utc" in body:
        hour = body["sf_auto_sync_hour_utc"]
        if hour is not None:
            hour = int(hour)
            if not (0 <= hour <= 23):
                raise HTTPException(status_code=422, detail="sf_auto_sync_hour_utc must be 0-23")
        settings.sf_auto_sync_hour_utc = hour

    if "sf_auto_sync_minute_utc" in body:
        minute = int(body["sf_auto_sync_minute_utc"])
        if not (0 <= minute <= 59):
            raise HTTPException(status_code=422, detail="sf_auto_sync_minute_utc must be 0-59")
        settings.sf_auto_sync_minute_utc = minute

    # Phase 3 settings
    if "max_call_attempts" in body:
        val = int(body["max_call_attempts"])
        if val < 1:
            raise HTTPException(status_code=422, detail="max_call_attempts must be at least 1")
        settings.max_call_attempts = val

    if "min_call_attempts_for_unreachable" in body:
        val = int(body["min_call_attempts_for_unreachable"])
        if val < 1:
            raise HTTPException(status_code=422, detail="min_call_attempts_for_unreachable must be at least 1")
        settings.min_call_attempts_for_unreachable = val

    if "sync_declined_to_salesforce" in body:
        settings.sync_declined_to_salesforce = bool(body["sync_declined_to_salesforce"])

    if "sync_unreachable_to_salesforce" in body:
        settings.sync_unreachable_to_salesforce = bool(body["sync_unreachable_to_salesforce"])

    if "terminal_lead_cooldown_days" in body:
        val = int(body["terminal_lead_cooldown_days"])
        if val < 0:
            raise HTTPException(status_code=422, detail="terminal_lead_cooldown_days must be 0 or positive")
        settings.terminal_lead_cooldown_days = val

    if "conversation_min_seconds" in body:
        val = int(body["conversation_min_seconds"])
        if val < 1:
            raise HTTPException(status_code=422, detail="conversation_min_seconds must be at least 1")
        settings.conversation_min_seconds = val

    # LLM / AI settings
    if "llm_provider" in body:
        provider = body["llm_provider"]
        if provider not in ("groq", "gemini", "openai"):
            raise HTTPException(status_code=422, detail="llm_provider must be 'groq', 'gemini', or 'openai'")
        settings.llm_provider = provider

    if "llm_api_key" in body:
        settings.llm_api_key = body["llm_api_key"]

    if "llm_model" in body:
        settings.llm_model = body["llm_model"]

    if "research_prompt" in body:
        val = body["research_prompt"]
        # Empty string → reset to default (store NULL)
        settings.research_prompt = val.strip() if val and val.strip() else None

    # V40 (Research v2): admin-controlled research gate toggle
    if "require_research_before_calling" in body:
        settings.require_research_before_calling = bool(body["require_research_before_calling"])

    # Alternate Messenger / Messaging Provider messaging settings
    if "messenger_enabled" in body:
        settings.messenger_enabled = bool(body["messenger_enabled"])
    if "messenger_base_url" in body:
        settings.messenger_base_url = body["messenger_base_url"].rstrip("/")
    if "messenger_api_key" in body:
        # Same guard as dialer_api_key: the GET now returns "••••", so a
        # form that round-trips what it was given must not persist that
        # placeholder over the real credential.
        ck_val = body["messenger_api_key"]
        if ck_val != "••••":
            settings.messenger_api_key = ck_val
    if "messenger_user_id" in body:
        settings.messenger_user_id = body["messenger_user_id"]
    if "messenger_account_id" in body:
        settings.messenger_account_id = body["messenger_account_id"]
    if "messenger_sender_id" in body:
        settings.messenger_sender_id = body["messenger_sender_id"]
    if "mcp_write_enabled" in body:
        settings.mcp_write_enabled = bool(body["mcp_write_enabled"])
    if "mcp_everyone_enabled" in body:
        settings.mcp_everyone_enabled = bool(body["mcp_everyone_enabled"])
    if "messenger_access_token" in body:
        # Legacy — silently accept but ignore (auth is now auto-HMAC)
        pass

    # Messaging provider selection
    if "messaging_provider" in body:
        val = body["messaging_provider"]
        # Same tuple messaging_service resolves against — spelling it out twice
        # is how the org-level and per-user validators drift apart.
        from messaging_service import SUPPORTED_MESSAGING_PROVIDERS
        if val not in SUPPORTED_MESSAGING_PROVIDERS:
            raise HTTPException(status_code=422, detail="messaging_provider must be 'messenger' or 'aircall'")
        settings.messaging_provider = val
    if "aircall_messaging_number_id" in body:
        settings.aircall_messaging_number_id = body["aircall_messaging_number_id"]
    if "sandbox_test_phone_number" in body:
        settings.sandbox_test_phone_number = body["sandbox_test_phone_number"].strip() or None

    # V28: Separate dialer credentials
    if "dialer_use_shared_creds" in body:
        settings.dialer_use_shared_creds = bool(body["dialer_use_shared_creds"])
    if "dialer_user_id" in body:
        settings.dialer_user_id = body["dialer_user_id"]
    if "dialer_api_key" in body:
        dk_val = body["dialer_api_key"]
        if dk_val == "__CLEAR__" or not dk_val:
            settings.dialer_api_key = None
        elif dk_val != "••••":
            try:
                from crypto import encrypt_token
                settings.dialer_api_key = encrypt_token(dk_val)
            except Exception as e:
                logger.error(f"Failed to encrypt dialer API key: {e}")

    # Credential clearing: clear all Alternate Messenger creds when requested
    if body.get("clear_messenger_credentials"):
        settings.messenger_api_key = None
        settings.messenger_user_id = None
        settings.messenger_account_id = None
        settings.messenger_sender_id = None
        settings.messenger_access_token = None
        # Also reset the singleton so it re-auths with new creds
        try:
            import conversations_service as _ccs
            _ccs._instance = None
            _ccs._instance_key = ()
        except Exception:
            pass
        try:
            from messaging_auth import AlternateMessengerAuthManager
            AlternateMessengerAuthManager.clear_cache()
        except Exception:
            pass
    if body.get("clear_dialer_credentials"):
        settings.dialer_api_key = None
        settings.dialer_user_id = None
        settings.dialer_use_shared_creds = True
        try:
            from messaging_auth import AlternateMessengerAuthManager
            AlternateMessengerAuthManager.clear_cache()
        except Exception:
            pass

    # V29: Dynamic call outcome configuration
    # v5.5: added meeting_complete, pending_review actions and demo group
    VALID_ACTIONS = {"none", "disqualify", "meeting_scheduled", "meeting_complete", "pending_review"}
    VALID_GROUPS  = {"answered", "not_answered", "terminal", "demo"}
    if "outcome_config" in body:
        oc = body["outcome_config"]
        if not isinstance(oc, list):
            raise HTTPException(status_code=422, detail="outcome_config must be a list")

        seen_values = set()
        custom_count = 0
        for idx, item in enumerate(oc):
            # Required fields check
            for field in ("value", "group", "action", "notes_required", "enabled"):
                if field not in item:
                    raise HTTPException(status_code=422, detail=f"outcome_config[{idx}] missing required field: {field}")

            val   = item["value"]
            group = item["group"]
            action = item["action"]

            # Duplicate check
            if val in seen_values:
                raise HTTPException(status_code=422, detail=f"Duplicate outcome value: '{val}'")
            seen_values.add(val)

            # Group validation
            if group not in VALID_GROUPS:
                raise HTTPException(status_code=422, detail=f"outcome_config[{idx}]: invalid group '{group}'. Must be one of: {sorted(VALID_GROUPS)}")

            # Action validation
            if action not in VALID_ACTIONS:
                raise HTTPException(status_code=422, detail=f"outcome_config[{idx}]: invalid action '{action}'. Must be one of: {sorted(VALID_ACTIONS)}")

            # Action-group compatibility: disqualify only on terminal
            if action == "disqualify" and group != "terminal":
                raise HTTPException(status_code=422, detail=f"outcome_config[{idx}]: 'disqualify' action is only valid for 'terminal' group")

            # Custom outcome caps and format
            if not item.get("builtin", False):
                custom_count += 1
                if len(val) < 2 or len(val) > 50:
                    raise HTTPException(status_code=422, detail=f"outcome_config[{idx}]: custom outcome value must be 2-50 characters")

        if custom_count > 10:
            raise HTTPException(status_code=422, detail=f"Maximum 10 custom outcomes allowed ({custom_count} provided)")

        settings.outcome_config = json.dumps(oc)

    # V33: Floating Widget settings
    if "widget_position" in body:
        pos = body["widget_position"]
        if pos not in ("bottom-right", "bottom-left"):
            raise HTTPException(status_code=422, detail="widget_position must be 'bottom-right' or 'bottom-left'")
        settings.widget_position = pos
    if "widget_theme" in body:
        theme = body["widget_theme"]
        if theme not in ("dark", "light"):
            raise HTTPException(status_code=422, detail="widget_theme must be 'dark' or 'light'")
        settings.widget_theme = theme
    if "widget_allowed_domains" in body:
        domains = body["widget_allowed_domains"]
        if not isinstance(domains, list):
            raise HTTPException(status_code=422, detail="widget_allowed_domains must be a list")
        settings.widget_allowed_domains = json.dumps(domains)

    db.commit()
    db.refresh(settings)

    return {
        "lead_limit":      settings.lead_limit,
        "record_type_ids": json.loads(settings.record_type_ids) if settings.record_type_ids else [],
        "sf_push_stage":   settings.sf_push_stage,
        "sync_direction":  settings.sync_direction if hasattr(settings, 'sync_direction') else "push_only",
        "opportunity_sync_direction": getattr(settings, 'opportunity_sync_direction', None) or "push_only",
        "opportunity_writeback_enabled": bool(getattr(settings, 'opportunity_writeback_enabled', False)),
        "allow_multi_pod_sdr": settings.allow_multi_pod_sdr,
        "sf_auto_sync_enabled":     settings.sf_auto_sync_enabled,
        "sf_auto_sync_hour_utc":    settings.sf_auto_sync_hour_utc,
        "sf_auto_sync_minute_utc":  settings.sf_auto_sync_minute_utc,
        "sf_auto_sync_last_run_at": settings.sf_auto_sync_last_run_at.isoformat() if settings.sf_auto_sync_last_run_at else None,
        "max_call_attempts":                settings.max_call_attempts,
        "min_call_attempts_for_unreachable": settings.min_call_attempts_for_unreachable,
        "sync_declined_to_salesforce":      settings.sync_declined_to_salesforce,
        "sync_unreachable_to_salesforce":   settings.sync_unreachable_to_salesforce,
        "terminal_lead_cooldown_days":      settings.terminal_lead_cooldown_days,
        "conversation_min_seconds":         settings.conversation_min_seconds,
        "llm_provider":    settings.llm_provider,
        "llm_api_key":     _mask_llm_key(settings.llm_api_key),
        "llm_model":       settings.llm_model,
        "research_prompt": getattr(settings, 'research_prompt', None) or '',
        # V40 (Research v2): admin-controlled research gate toggle
        "require_research_before_calling": bool(getattr(settings, 'require_research_before_calling', False)),
        "messenger_enabled":      settings.messenger_enabled,
        "messenger_base_url":     settings.messenger_base_url or "",
        "messenger_api_key":      "••••" if settings.messenger_api_key else "",
        "messenger_user_id":      settings.messenger_user_id or "",
        "messenger_account_id":   getattr(settings, 'messenger_account_id', '') or '',
        "messenger_sender_id":    getattr(settings, 'messenger_sender_id', '') or '',
        "messaging_provider":            getattr(settings, 'messaging_provider', 'messenger') or 'messenger',
        "aircall_messaging_number_id":   getattr(settings, 'aircall_messaging_number_id', '') or '',
        "sandbox_test_phone_number":     getattr(settings, 'sandbox_test_phone_number', '') or '',
        "dialer_use_shared_creds": getattr(settings, 'dialer_use_shared_creds', True),
        "dialer_api_key":          "••••" if settings.dialer_api_key else "",
        "dialer_user_id":          settings.dialer_user_id or "",
        # V29: Dynamic call outcome configuration
        "outcome_config":  models.get_outcome_config(db),
        # V33: Floating Widget
        "widget_position":         getattr(settings, 'widget_position', 'bottom-right') or 'bottom-right',
        "widget_theme":            getattr(settings, 'widget_theme', 'dark') or 'dark',
        "widget_allowed_domains":  json.loads(settings.widget_allowed_domains) if getattr(settings, 'widget_allowed_domains', None) else [],
    }


@router.get("/record-types")
def get_lead_record_types(admin: dict = Depends(require_admin)):
    """Return Salesforce record types. Returns empty list (200) when SF is not configured.
    Only raises 503 on actual SF API failures to prevent noisy browser retries."""
    sf = get_sf_client()
    if not sf:
        # SF not configured in this environment — return empty list gracefully
        return []
    try:
        return get_record_types_from_salesforce(sf)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Salesforce API error: {str(e)}")


# ── Bulk Audience Manager Sync ─────────────────────────────────────────────────

AM_SYNC_JOB = "am_bulk_sync"

# A run whose heartbeat is older than this is treated as dead, not running —
# the worker touches the heartbeat every batch, and the only way it goes cold
# is the process dying (deploy, OOM, restart). Generous enough to cover a
# single slow AM call plus the inter-lead delay without false-positiving.
_AM_HEARTBEAT_STALE_SECONDS = 300

_EMPTY_AM_STATE = {
    "synced": 0, "failed": 0, "skipped": 0, "total": 0, "errors": [], "message": ""
}


def _am_status_row(db: Session):
    return db.query(models.BackgroundJobState).filter(
        models.BackgroundJobState.job_name == AM_SYNC_JOB
    ).first()


def _write_am_status(db: Session, state: dict, *, running: bool,
                     started_at=None, finished_at=None):
    """Upsert the single AM-sync progress row. Called at start, on every
    batch boundary (as the heartbeat), and once at the end — not per lead,
    which would add a DB write to every single rate-limited AM call.

    `finished_at` is written unconditionally (None included) so starting a
    new run clears the previous run's completion time; `started_at` is only
    written when given, so the heartbeat and the final write don't wipe it.
    """
    row = _am_status_row(db)
    if row is None:
        row = models.BackgroundJobState(job_name=AM_SYNC_JOB)
        db.add(row)
    row.running = running
    row.state = dict(state)
    row.heartbeat_at = datetime.now(timezone.utc)
    row.finished_at = finished_at
    if started_at is not None:
        row.started_at = started_at
    db.commit()


def _read_am_status(db: Session) -> dict:
    """Progress as the admin UI sees it. A row still flagged running whose
    heartbeat has gone cold means the process that owned the worker died
    mid-run — report that explicitly instead of a plausible-looking
    "in progress" that will never advance again."""
    row = _am_status_row(db)
    if row is None:
        # `interrupted` belongs here too: a poller that only ever sees a
        # never-run job would otherwise get a different key set than one
        # that has, and `status.interrupted` reads as undefined rather than
        # false. Caught on staging, where no AM run has happened since the
        # table was created.
        return {**_EMPTY_AM_STATE, "running": False, "interrupted": False,
                "started_at": None, "finished_at": None}

    state = {**_EMPTY_AM_STATE, **(row.state or {})}
    running = bool(row.running)
    interrupted = False
    if running:
        beat = row.heartbeat_at
        if beat is not None and beat.tzinfo is None:
            beat = beat.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - beat).total_seconds() if beat else None
        if age is None or age > _AM_HEARTBEAT_STALE_SECONDS:
            running, interrupted = False, True
            state["message"] = (
                f"Interrupted after {state['synced']} synced — the server restarted mid-run "
                f"(deploy or crash). Re-run to continue; already-synced leads are skipped."
            )

    return {
        **state,
        "running": running,
        "interrupted": interrupted,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
    }


def _am_bulk_sync_worker(delay_s, batch_size):
    """Background worker: push leads to AM one by one with rate limiting."""
    import time as _time
    from database import SessionLocal
    from audience_manager import ensure_contact, lead_extra_fields

    db = SessionLocal()
    progress = dict(_EMPTY_AM_STATE)
    progress["message"] = "Sync in progress..."
    try:
        settings = db.query(models.SyncSettings).first()
        base_url = (settings.messenger_base_url or "https://app.messaging_provider.com").rstrip("/")
        api_key = settings.messenger_api_key
        user_id = settings.messenger_user_id

        leads = db.query(models.Lead).filter(
            models.Lead.am_record_id.is_(None),
            (models.Lead.phone.isnot(None) & (models.Lead.phone != "")) |
            (models.Lead.phone_secondary.isnot(None) & (models.Lead.phone_secondary != ""))
        ).all()

        progress["total"] = len(leads)

        for lead in leads:
            phone = (lead.phone or "").strip() or (lead.phone_secondary or "").strip()
            if not phone:
                progress["skipped"] += 1
                continue
            try:
                record_id = ensure_contact(
                    base_url=base_url, api_key=api_key, user_id=user_id,
                    first_name=lead.first_name or "", last_name=lead.last_name or "",
                    phone=phone, email=lead.email or "",
                    extra_fields=lead_extra_fields(lead, db=db),
                )
                if record_id:
                    lead.am_record_id = record_id
                    progress["synced"] += 1
                    if progress["synced"] % batch_size == 0:
                        db.commit()
                        # Same batch boundary already used for the lead commit —
                        # doubles as the heartbeat, so progress survives a
                        # mid-run deploy instead of dying with the process.
                        _write_am_status(db, progress, running=True)
                else:
                    progress["failed"] += 1
                    if len(progress["errors"]) < 10:
                        progress["errors"].append(f"{lead.first_name} {lead.last_name} ({phone}): no record_id")
            except Exception as e:
                progress["failed"] += 1
                if len(progress["errors"]) < 10:
                    progress["errors"].append(f"{lead.first_name} {lead.last_name} ({phone}): {str(e)[:80]}")
            if delay_s > 0:
                _time.sleep(delay_s)

        db.commit()
        progress["message"] = f"Complete: {progress['synced']} synced, {progress['failed']} failed, {progress['skipped']} skipped"
    except Exception as e:
        progress["message"] = f"Error: {str(e)[:200]}"
    finally:
        try:
            _write_am_status(db, progress, running=False, finished_at=datetime.now(timezone.utc))
        except Exception as e:
            logger.warning(f"[AM bulk sync] could not persist final status: {e}")
        db.close()


@router.post("/sync-am-bulk")
def bulk_sync_leads_to_am(
    request_body: dict = {},
    db: Session = Depends(get_db),
    user: dict = Depends(require_super_admin),
):
    """Push all existing leads with phone numbers to Audience Manager (background).
    Dry run returns counts. Actual run spawns background thread and returns immediately.
    Poll GET /api/admin/sync-am-status for progress."""
    dry_run = request_body.get("dry_run", False)
    batch_size = min(request_body.get("batch_size", 50), 200)
    delay_s = request_body.get("delay_ms", 200) / 1000.0

    current = _read_am_status(db)
    if current["running"]:
        return {"error": True, "message": "Sync already running. GET /api/admin/sync-am-status for progress.", "status": current}

    settings = db.query(models.SyncSettings).first()
    if not settings or not settings.messenger_enabled:
        return {"error": True, "message": "Conversations not enabled. Enable in Settings -> Sync Settings."}
    if not settings.messenger_api_key:
        return {"error": True, "message": "API key not configured in Sync Settings."}
    if not settings.messenger_user_id:
        return {"error": True, "message": "User ID not configured in Sync Settings."}

    to_sync = db.query(models.Lead).filter(
        models.Lead.am_record_id.is_(None),
        (models.Lead.phone.isnot(None) & (models.Lead.phone != "")) |
        (models.Lead.phone_secondary.isnot(None) & (models.Lead.phone_secondary != ""))
    ).count()
    already_synced = db.query(models.Lead).filter(models.Lead.am_record_id.isnot(None)).count()
    no_phone = db.query(models.Lead).filter(
        (models.Lead.phone.is_(None) | (models.Lead.phone == "")),
        (models.Lead.phone_secondary.is_(None) | (models.Lead.phone_secondary == ""))
    ).count()

    if dry_run:
        return {
            "dry_run": True, "to_sync": to_sync, "already_synced": already_synced,
            "no_phone_skipped": no_phone,
            "estimated_time_seconds": round(to_sync * delay_s + to_sync * 1.5, 1),
            "message": f"{to_sync} leads to push. {already_synced} already synced, {no_phone} no phone."
        }

    _write_am_status(
        db,
        {**_EMPTY_AM_STATE, "total": to_sync, "message": "Sync in progress..."},
        running=True,
        started_at=datetime.now(timezone.utc),
        finished_at=None,
    )
    thread = threading.Thread(target=_am_bulk_sync_worker, args=(delay_s, batch_size), daemon=True, name="am-bulk-sync")
    thread.start()

    return {
        "message": f"Bulk sync started for {to_sync} leads. Poll GET /api/admin/sync-am-status for progress.",
        "to_sync": to_sync, "already_synced": already_synced, "no_phone_skipped": no_phone
    }


@router.get("/sync-am-status")
def get_am_sync_status(db: Session = Depends(get_db), user: dict = Depends(require_super_admin)):
    """Check progress of the background AM bulk sync."""
    return _read_am_status(db)


# ── Salesforce field mapping (v14.1.0) ───────────────────────────────────────
# Extra Alternate CRM -> Salesforce Lead fields a Super Admin configures instead of a code change. The built-in mapping is shown
# read-only for reference; see services/sf_field_mapping.py.

class MappingIn(BaseModel):
    lead_field: str
    sf_field: str


class MappingPatch(BaseModel):
    enabled: Optional[bool] = None
    lead_field: Optional[str] = None
    sf_field: Optional[str] = None


def _mapping_row(m, names=None):
    return {"id": m.id, "lead_field": m.lead_field, "label": sf_field_mapping.LEAD_FIELDS.get(m.lead_field, m.lead_field),
            "sf_field": m.sf_field, "sf_object": sf_field_mapping.SF_OBJECT, "sf_type": m.sf_type, "verified": bool(m.verified), "enabled": bool(m.enabled),
            "created_by": (names or {}).get(m.created_by) or m.created_by, "created_at": m.created_at.isoformat() if m.created_at else None}


def _builtin_rows(db):
    over = {r.lead_field: r for r in db.query(models.SfFieldMapping).filter(models.SfFieldMapping.builtin.is_(True))}
    out = []
    for key, default in LEAD_FIELD_MAP.items():
        o = over.get(key)
        out.append({"lead_field": key, "label": sf_field_mapping.BUILTIN_LABELS.get(key, key), "default_sf_field": default,
                    "sf_field": o.sf_field if o else default, "enabled": o.enabled if o else True, "overridden": bool(o),
                    "locked": key in sf_field_mapping.BUILTIN_LOCKED, "sf_object": sf_field_mapping.SF_OBJECT,
                    "changed_by": o.created_by if o else None, "changed_at": o.created_at.isoformat() if o and o.created_at else None})
    return out


@router.get("/sf-field-mappings")
def list_sf_field_mappings(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    rows = db.query(models.SfFieldMapping).filter(models.SfFieldMapping.builtin.is_(False)).order_by(models.SfFieldMapping.created_at).all()
    used = {r.lead_field for r in rows}
    names = {u.email: u.name for u in db.query(models.User.email, models.User.name).filter(models.User.email.in_({r.created_by for r in rows if r.created_by}))}
    return {
        "custom": [_mapping_row(m, names) for m in rows],
        "builtin": _builtin_rows(db),
        "available": [{"value": k, "label": v} for k, v in sf_field_mapping.LEAD_FIELDS.items() if k not in used],
    }


@router.post("/sf-field-mappings")
def add_sf_field_mapping(body: MappingIn, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    try:
        sf_field, sf_type, verified = sf_field_mapping.check_new(db, body.lead_field, body.sf_field, get_sf_client())
    except sf_field_mapping.MappingError as e:
        raise HTTPException(status_code=400, detail=str(e))
    m = models.SfFieldMapping(lead_field=body.lead_field, sf_field=sf_field, sf_type=sf_type, verified=verified,
                              created_by=admin.get("email"))
    db.add(m)
    audit.record(db, admin, "sf_mapping", "ADDED", f"Added mapping: {_label(m.lead_field)} \u2192 {sf_field}",
                 {"lead_field": m.lead_field, "sf_field": sf_field, "sf_object": sf_field_mapping.SF_OBJECT})
    try:
        db.commit()
    except IntegrityError:      # two admins added the same row at once
        db.rollback()
        raise HTTPException(status_code=400, detail="That field is already mapped.")
    return _mapping_row(m)


def _label(key):
    return sf_field_mapping.LEAD_FIELDS.get(key) or sf_field_mapping.BUILTIN_LABELS.get(key, key)


def _get_mapping(db, mapping_id):
    m = db.query(models.SfFieldMapping).filter(models.SfFieldMapping.id == mapping_id, models.SfFieldMapping.builtin.is_(False)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found.")
    return m


@router.patch("/sf-field-mappings/{mapping_id}")
def update_sf_field_mapping(mapping_id: str, body: MappingPatch, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Switch a mapping on/off, or change which Alternate CRM field / Salesforce field it connects (re-checked like a new one)."""
    m = _get_mapping(db, mapping_id)
    before = {"lead_field": m.lead_field, "sf_field": m.sf_field, "enabled": bool(m.enabled)}
    if body.lead_field is not None or body.sf_field is not None:
        lead_field = body.lead_field if body.lead_field is not None else m.lead_field
        try:
            m.sf_field, m.sf_type, m.verified = sf_field_mapping.check_new(
                db, lead_field, body.sf_field if body.sf_field is not None else m.sf_field, get_sf_client(), exclude_id=m.id)
        except sf_field_mapping.MappingError as e:
            raise HTTPException(status_code=400, detail=str(e))
        m.lead_field = lead_field
    if body.enabled is not None:
        m.enabled = body.enabled
    after = {"lead_field": m.lead_field, "sf_field": m.sf_field, "enabled": bool(m.enabled)}
    if after != before:
        audit.record(db, admin, "sf_mapping", "CHANGED", _change_summary(before, after), {"before": before, "after": after, "sf_object": sf_field_mapping.SF_OBJECT})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="That field is already mapped.")
    return _mapping_row(m)


def _change_summary(before, after):
    bits = []
    if before["enabled"] != after["enabled"]:
        bits.append("switched on" if after["enabled"] else "switched off")
    if before["sf_field"] != after["sf_field"]:
        bits.append(f"{before['sf_field']} \u2192 {after['sf_field']}")
    if before["lead_field"] != after["lead_field"]:
        bits.append(f"Alternate CRM field {_label(before['lead_field'])} \u2192 {_label(after['lead_field'])}")
    return f"Changed mapping {_label(after['lead_field'])}: " + ", ".join(bits)


@router.delete("/sf-field-mappings/{mapping_id}")
def delete_sf_field_mapping(mapping_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    m = _get_mapping(db, mapping_id)
    info = {"lead_field": m.lead_field, "sf_field": m.sf_field, "sf_object": sf_field_mapping.SF_OBJECT}
    audit.record(db, admin, "sf_mapping", "REMOVED", f"Removed mapping: {_label(m.lead_field)} \u2192 {m.sf_field}", info)
    db.delete(m)
    db.commit()
    return {"ok": True}


class BuiltinPatch(BaseModel):
    enabled: Optional[bool] = None
    sf_field: Optional[str] = None


def _builtin_state(db, key):
    return next(r for r in _builtin_rows(db) if r["lead_field"] == key)


@router.patch("/sf-field-mappings/builtin/{lead_field}")
def update_builtin_mapping(lead_field: str, body: BuiltinPatch, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Point a built-in mapping at another Salesforce field, or switch it off. First name, last name, email, phone and status are locked."""
    if lead_field not in LEAD_FIELD_MAP:
        raise HTTPException(status_code=404, detail="Mapping not found.")
    if lead_field in sf_field_mapping.BUILTIN_LOCKED:
        raise HTTPException(status_code=400, detail=f"{sf_field_mapping.BUILTIN_LABELS[lead_field]} is required by Alternate CRM and can't be changed or switched off.")
    before = _builtin_state(db, lead_field)
    row = db.query(models.SfFieldMapping).filter(models.SfFieldMapping.lead_field == lead_field, models.SfFieldMapping.builtin.is_(True)).first()
    sf_field, sf_type, verified = (row.sf_field, row.sf_type, row.verified) if row else (LEAD_FIELD_MAP[lead_field], None, False)
    if body.sf_field is not None and body.sf_field.strip().lower() == LEAD_FIELD_MAP[lead_field].lower():
        sf_field, sf_type, verified = LEAD_FIELD_MAP[lead_field], None, False       # the default again: nothing to check
    elif body.sf_field is not None:
        try:
            sf_field, sf_type, verified = sf_field_mapping.check_builtin(db, lead_field, body.sf_field, LEAD_FIELD_MAP, get_sf_client())
        except sf_field_mapping.MappingError as e:
            raise HTTPException(status_code=400, detail=str(e))
    enabled = body.enabled if body.enabled is not None else (row.enabled if row else True)
    if sf_field == LEAD_FIELD_MAP[lead_field] and enabled:      # back to the default: drop the override
        if row:
            db.delete(row)
    else:
        if not row:
            row = models.SfFieldMapping(lead_field=lead_field, builtin=True)
            db.add(row)
        row.sf_field, row.sf_type, row.verified, row.enabled, row.created_by = sf_field, sf_type, verified, enabled, admin.get("email")
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="That Salesforce field is already used by another mapping.")
    after = _builtin_state(db, lead_field)
    if (before["sf_field"], before["enabled"]) != (after["sf_field"], after["enabled"]):
        audit.record(db, admin, "sf_mapping", "CHANGED", _change_summary(
            {**before, "lead_field": lead_field}, {**after, "lead_field": lead_field}) + " (built-in)",
            {"before": {"sf_field": before["sf_field"], "enabled": before["enabled"]}, "after": {"sf_field": after["sf_field"], "enabled": after["enabled"]},
             "builtin": True, "sf_object": sf_field_mapping.SF_OBJECT})
    db.commit()
    return _builtin_state(db, lead_field)


@router.delete("/sf-field-mappings/builtin/{lead_field}")
def reset_builtin_mapping(lead_field: str, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Back to Alternate CRM's default for this built-in mapping."""
    return update_builtin_mapping(lead_field, BuiltinPatch(sf_field=LEAD_FIELD_MAP.get(lead_field), enabled=True), db, admin)


# ── Salesforce sync overview (v14.1.0) ───────────────────────────────────────
@router.get("/sf-sync-overview")
def sf_sync_overview(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """How many Alternate CRM leads exist in Salesforce. Counts live, non-test leads only; a lead is "in Salesforce" when it has a
    real Salesforce Id (local placeholders such as upload-… / MIG-… contain a hyphen; real 15/18-character Ids never do)."""
    L = models.Lead
    live = db.query(func.count(L.id)).filter(L.deleted_at.is_(None), L.is_test.is_(False))
    in_sf_cond = and_(L.sf_lead_id.isnot(None), ~L.sf_lead_id.contains("-"))
    total = live.scalar() or 0
    in_sf = live.filter(in_sf_cond).scalar() or 0
    stage = _get_or_create_sync_settings(db).sf_push_stage or "Meeting Scheduled"
    waiting = live.filter(or_(L.sf_lead_id.is_(None), L.sf_lead_id.contains("-")), L.status == stage).scalar() or 0
    return {"total": total, "in_salesforce": in_sf, "only_in_alternatecrm": total - in_sf, "push_stage": stage, "waiting_at_push_stage": waiting}
