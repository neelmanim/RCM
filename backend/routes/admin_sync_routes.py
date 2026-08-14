# ── routes/admin_sync_routes.py — Salesforce sync, settings, AM sync (split from admin_routes.py) ──
import os
import logging
import json
import threading
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import require_admin, require_super_admin
from salesforce import (
    get_sf_client,
    get_record_types_from_salesforce,
    run_full_salesforce_sync,
)
from routes._admin_helpers import _get_or_create_sync_settings

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


@router.get("/sync-settings")
def get_sync_settings(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    settings = _get_or_create_sync_settings(db)
    rtype_ids = json.loads(settings.record_type_ids) if settings.record_type_ids else []
    return {
        "lead_limit":      settings.lead_limit,
        "record_type_ids": rtype_ids,
        "sf_push_stage":   settings.sf_push_stage or "Meeting Scheduled",
        "sync_direction":  settings.sync_direction if hasattr(settings, 'sync_direction') and settings.sync_direction else "push_only",
        "allow_multi_pod_sdr": settings.allow_multi_pod_sdr,
        # V44: Salesforce auto-sync schedule
        "sf_auto_sync_enabled":     getattr(settings, 'sf_auto_sync_enabled', False) or False,
        "sf_auto_sync_hour_utc":    getattr(settings, 'sf_auto_sync_hour_utc', None),
        "sf_auto_sync_minute_utc":  getattr(settings, 'sf_auto_sync_minute_utc', 0) or 0,
        "sf_auto_sync_last_run_at": str(settings.sf_auto_sync_last_run_at) if getattr(settings, 'sf_auto_sync_last_run_at', None) else None,
        # Phase 3
        "active_lead_cap":                  settings.active_lead_cap if settings.active_lead_cap is not None else 5,
        "max_call_attempts":                settings.max_call_attempts if settings.max_call_attempts is not None else 5,
        "min_call_attempts_for_unreachable": settings.min_call_attempts_for_unreachable if settings.min_call_attempts_for_unreachable is not None else 3,
        "sync_declined_to_salesforce":      settings.sync_declined_to_salesforce if hasattr(settings, 'sync_declined_to_salesforce') else False,
        "sync_unreachable_to_salesforce":   settings.sync_unreachable_to_salesforce if hasattr(settings, 'sync_unreachable_to_salesforce') else False,
        "terminal_lead_cooldown_days":      settings.terminal_lead_cooldown_days if settings.terminal_lead_cooldown_days is not None else 30,
        "conversation_min_seconds":         settings.conversation_min_seconds if settings.conversation_min_seconds is not None else 30,
        "updated_at":      str(settings.updated_at) if settings.updated_at else None,
        # RCM / RCM Messaging messaging
        "rcm_enabled":      getattr(settings, 'rcm_enabled', False) or False,
        "rcm_base_url":     getattr(settings, 'rcm_base_url', '') or '',
        "rcm_api_key":      getattr(settings, 'rcm_api_key', '') or '',
        "rcm_user_id":      getattr(settings, 'rcm_user_id', '') or '',
        "rcm_account_id":   getattr(settings, 'rcm_account_id', '') or '',
        "rcm_sender_id":    getattr(settings, 'rcm_sender_id', '') or '',
        # Messaging provider selection
        "messaging_provider":            getattr(settings, 'messaging_provider', 'rcm') or 'rcm',
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
        "widget_enabled":          getattr(settings, 'widget_enabled', False) or False,
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

@router.patch("/sync-settings")
def update_sync_settings(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
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
    if "active_lead_cap" in body:
        cap = int(body["active_lead_cap"])
        if cap < 0:
            raise HTTPException(status_code=422, detail="active_lead_cap must be 0 or positive")
        settings.active_lead_cap = cap

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

    # RCM / RCM Messaging messaging settings
    if "rcm_enabled" in body:
        settings.rcm_enabled = bool(body["rcm_enabled"])
    if "rcm_base_url" in body:
        settings.rcm_base_url = body["rcm_base_url"].rstrip("/")
    if "rcm_api_key" in body:
        settings.rcm_api_key = body["rcm_api_key"]
    if "rcm_user_id" in body:
        settings.rcm_user_id = body["rcm_user_id"]
    if "rcm_account_id" in body:
        settings.rcm_account_id = body["rcm_account_id"]
    if "rcm_sender_id" in body:
        settings.rcm_sender_id = body["rcm_sender_id"]
    if "rcm_access_token" in body:
        # Legacy — silently accept but ignore (auth is now auto-HMAC)
        pass

    # Messaging provider selection
    if "messaging_provider" in body:
        val = body["messaging_provider"]
        if val not in ("rcm", "aircall"):
            raise HTTPException(status_code=422, detail="messaging_provider must be 'rcm' or 'aircall'")
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

    # Credential clearing: clear all RCM creds when requested
    if body.get("clear_rcm_credentials"):
        settings.rcm_api_key = None
        settings.rcm_user_id = None
        settings.rcm_account_id = None
        settings.rcm_sender_id = None
        settings.rcm_access_token = None
        # Also reset the singleton so it re-auths with new creds
        try:
            import rcm_conversations_service as _ccs
            _ccs._instance = None
            _ccs._instance_key = ()
        except Exception:
            pass
        try:
            from rcm_auth import RCMAuthManager
            RCMAuthManager.clear_cache()
        except Exception:
            pass
    if body.get("clear_dialer_credentials"):
        settings.dialer_api_key = None
        settings.dialer_user_id = None
        settings.dialer_use_shared_creds = True
        try:
            from rcm_auth import RCMAuthManager
            RCMAuthManager.clear_cache()
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
    if "widget_enabled" in body:
        settings.widget_enabled = bool(body["widget_enabled"])
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
        "allow_multi_pod_sdr": settings.allow_multi_pod_sdr,
        "sf_auto_sync_enabled":     settings.sf_auto_sync_enabled,
        "sf_auto_sync_hour_utc":    settings.sf_auto_sync_hour_utc,
        "sf_auto_sync_minute_utc":  settings.sf_auto_sync_minute_utc,
        "sf_auto_sync_last_run_at": str(settings.sf_auto_sync_last_run_at) if settings.sf_auto_sync_last_run_at else None,
        "active_lead_cap":                  settings.active_lead_cap,
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
        "rcm_enabled":      settings.rcm_enabled,
        "rcm_base_url":     settings.rcm_base_url or "",
        "rcm_api_key":      settings.rcm_api_key or "",
        "rcm_user_id":      settings.rcm_user_id or "",
        "rcm_account_id":   getattr(settings, 'rcm_account_id', '') or '',
        "rcm_sender_id":    getattr(settings, 'rcm_sender_id', '') or '',
        "messaging_provider":            getattr(settings, 'messaging_provider', 'rcm') or 'rcm',
        "aircall_messaging_number_id":   getattr(settings, 'aircall_messaging_number_id', '') or '',
        "sandbox_test_phone_number":     getattr(settings, 'sandbox_test_phone_number', '') or '',
        "dialer_use_shared_creds": getattr(settings, 'dialer_use_shared_creds', True),
        "dialer_api_key":          "••••" if settings.dialer_api_key else "",
        "dialer_user_id":          settings.dialer_user_id or "",
        # V29: Dynamic call outcome configuration
        "outcome_config":  models.get_outcome_config(db),
        # V33: Floating Widget
        "widget_enabled":          getattr(settings, 'widget_enabled', False) or False,
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

# In-memory progress tracker for background AM sync
_am_sync_status = {
    "running": False, "synced": 0, "failed": 0, "skipped": 0,
    "total": 0, "errors": [], "started_at": None, "finished_at": None, "message": ""
}


def _am_bulk_sync_worker(delay_s, batch_size):
    """Background worker: push leads to AM one by one with rate limiting."""
    global _am_sync_status
    import time as _time
    from database import SessionLocal
    from audience_manager import ensure_contact

    db = SessionLocal()
    try:
        settings = db.query(models.SyncSettings).first()
        base_url = (settings.rcm_base_url or "https://app.rcm-messaging.com").rstrip("/")
        api_key = settings.rcm_api_key
        user_id = settings.rcm_user_id

        leads = db.query(models.Lead).filter(
            models.Lead.am_record_id.is_(None),
            (models.Lead.phone.isnot(None) & (models.Lead.phone != "")) |
            (models.Lead.phone_secondary.isnot(None) & (models.Lead.phone_secondary != ""))
        ).all()

        _am_sync_status["total"] = len(leads)

        for lead in leads:
            phone = (lead.phone or "").strip() or (lead.phone_secondary or "").strip()
            if not phone:
                _am_sync_status["skipped"] += 1
                continue
            try:
                record_id = ensure_contact(
                    base_url=base_url, api_key=api_key, user_id=user_id,
                    first_name=lead.first_name or "", last_name=lead.last_name or "",
                    phone=phone, email=lead.email or "",
                )
                if record_id:
                    lead.am_record_id = record_id
                    _am_sync_status["synced"] += 1
                    if _am_sync_status["synced"] % batch_size == 0:
                        db.commit()
                else:
                    _am_sync_status["failed"] += 1
                    if len(_am_sync_status["errors"]) < 10:
                        _am_sync_status["errors"].append(f"{lead.first_name} {lead.last_name} ({phone}): no record_id")
            except Exception as e:
                _am_sync_status["failed"] += 1
                if len(_am_sync_status["errors"]) < 10:
                    _am_sync_status["errors"].append(f"{lead.first_name} {lead.last_name} ({phone}): {str(e)[:80]}")
            if delay_s > 0:
                _time.sleep(delay_s)

        db.commit()
        _am_sync_status["message"] = f"Complete: {_am_sync_status['synced']} synced, {_am_sync_status['failed']} failed, {_am_sync_status['skipped']} skipped"
    except Exception as e:
        _am_sync_status["message"] = f"Error: {str(e)[:200]}"
    finally:
        _am_sync_status["running"] = False
        _am_sync_status["finished_at"] = datetime.now(timezone.utc).isoformat()
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
    global _am_sync_status

    dry_run = request_body.get("dry_run", False)
    batch_size = min(request_body.get("batch_size", 50), 200)
    delay_s = request_body.get("delay_ms", 200) / 1000.0

    if _am_sync_status["running"]:
        return {"error": True, "message": "Sync already running. GET /api/admin/sync-am-status for progress.", "status": _am_sync_status}

    settings = db.query(models.SyncSettings).first()
    if not settings or not settings.rcm_enabled:
        return {"error": True, "message": "Conversations not enabled. Enable in Settings -> Sync Settings."}
    if not settings.rcm_api_key:
        return {"error": True, "message": "API key not configured in Sync Settings."}
    if not settings.rcm_user_id:
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

    _am_sync_status = {
        "running": True, "synced": 0, "failed": 0, "skipped": 0,
        "total": to_sync, "errors": [],
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None, "message": "Sync in progress..."
    }
    thread = threading.Thread(target=_am_bulk_sync_worker, args=(delay_s, batch_size), daemon=True, name="am-bulk-sync")
    thread.start()

    return {
        "message": f"Bulk sync started for {to_sync} leads. Poll GET /api/admin/sync-am-status for progress.",
        "to_sync": to_sync, "already_synced": already_synced, "no_phone_skipped": no_phone
    }


@router.get("/sync-am-status")
def get_am_sync_status(user: dict = Depends(require_super_admin)):
    """Check progress of the background AM bulk sync."""
    return _am_sync_status
