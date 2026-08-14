# ── audience_manager.py — Audience Manager (RCM) contact sync ───────────
"""
Service module for Audience Manager API integration.
Handles contact search and creation for RCM messaging.
Auth: apiKey header (no JWT needed).
"""
import logging
import threading
import requests
from typing import Optional, List

logger = logging.getLogger(__name__)

# Timeout for AM API calls (they can be slow)
AM_TIMEOUT = 30


def _get_am_headers(api_key: str) -> dict:
    """Build headers for Audience Manager API calls."""
    return {
        "apiKey": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def search_contact(base_url: str, api_key: str, phone: str) -> Optional[dict]:
    """Search for a contact in Audience Manager by phone number.
    
    Returns the first matching record dict (with 'record_id' field), or None if not found.
    """
    # AM search API doesn't support '+' prefix — strip it
    search_phone = phone.lstrip('+')
    url = f"{base_url.rstrip('/')}/api/v2/converse_integration/record/search_by_query"
    params = {
        "crm_name": "audience_manager",
        "limit": 5,
        "page": 1,
        "query": search_phone,
        "record_type": "contacts",
    }
    try:
        resp = requests.get(url, headers=_get_am_headers(api_key), params=params, timeout=AM_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        records = data.get("records", [])
        if records:
            record = records[0]
            logger.info(f"[AM] Found contact for phone={phone}: record_id={record.get('record_id')}")
            return record
        logger.info(f"[AM] No contact found for phone={phone}")
        return None
    except requests.exceptions.Timeout:
        logger.warning(f"[AM] Search timed out for phone={phone}")
        return None
    except Exception as e:
        logger.warning(f"[AM] Search failed for phone={phone}: {e}")
        return None


def create_contact(base_url: str, api_key: str, user_id: str,
                   first_name: str, last_name: str, phone: str,
                   email: str = "") -> Optional[str]:
    """Create a contact in Audience Manager.
    
    Returns the record_id string if successful, None on failure.
    """
    url = f"{base_url.rstrip('/')}/api/v1/audience-manager/contact"
    params = {"user_id": user_id}
    payload = {
        "first_name": first_name or "Unknown",
        "last_name": last_name or "Lead",
        "mobile_number": phone,
        "source": "RCM",
        "create_consent": 1,
    }
    # AM API rejects empty email strings — only include if valid
    if email:
        payload["email"] = email
    try:
        resp = requests.post(url, headers=_get_am_headers(api_key), params=params,
                             json=payload, timeout=AM_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        # Try common field names for the record ID
        record_id = (
            data.get("record_id")
            or data.get("id")
            or data.get("contact_id")
            or data.get("data", {}).get("id")
            or data.get("data", {}).get("record_id")
        )
        if record_id:
            logger.info(f"[AM] Created contact: phone={phone}, record_id={record_id}")
            return str(record_id)
        # If no known field, log the full response for debugging
        logger.warning(f"[AM] Contact created but no record_id found in response: {data}")
        return None
    except requests.exceptions.Timeout:
        logger.warning(f"[AM] Create timed out for phone={phone}")
        return None
    except Exception as e:
        logger.warning(f"[AM] Create failed for phone={phone}: {e}")
        return None


def ensure_contact(base_url: str, api_key: str, user_id: str,
                   first_name: str, last_name: str, phone: str,
                   email: str = "") -> Optional[str]:
    """Search for a contact by phone; create if not found. Returns record_id or None."""
    if not phone:
        return None
    
    # 1. Search first
    record = search_contact(base_url, api_key, phone)
    if record:
        return str(record.get("record_id") or "")
    
    # 2. Not found → create
    return create_contact(base_url, api_key, user_id, first_name, last_name, phone, email)


# ── Background Sync (fire-and-forget at lead import time) ────────────────────

def _sync_leads_worker(lead_ids: List[int]):
    """Background worker: sync a batch of leads to Audience Manager.
    
    Creates its own DB session (separate from the request thread).
    Silently skips if AM is not configured or leads have no phone.
    """
    from database import SessionLocal
    import models

    db = SessionLocal()
    try:
        # Read AM config
        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        if not settings or not settings.rcm_enabled:
            logger.info("[AM Sync] RCM not enabled — skipping background sync")
            return
        if not settings.rcm_api_key or not settings.rcm_user_id:
            logger.info("[AM Sync] Missing API key or user ID — skipping background sync")
            return

        base_url = settings.rcm_base_url or "https://app.bercm.com"
        api_key = settings.rcm_api_key
        user_id = settings.rcm_user_id

        # Process each lead
        synced = 0
        skipped = 0
        failed = 0
        for lead_id in lead_ids:
            lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
            if not lead:
                continue
            if lead.am_record_id:
                skipped += 1
                continue  # Already synced
            if not lead.phone:
                skipped += 1
                continue  # No phone number

            try:
                record_id = ensure_contact(
                    base_url, api_key, user_id,
                    lead.first_name or "", lead.last_name or "",
                    lead.phone, lead.email or ""
                )
                if record_id:
                    lead.am_record_id = record_id
                    db.commit()
                    synced += 1
                else:
                    failed += 1
            except Exception as e:
                logger.warning(f"[AM Sync] Failed for lead {lead_id}: {e}")
                failed += 1

        logger.info(f"[AM Sync] Background sync complete: {synced} synced, {skipped} skipped, {failed} failed (batch of {len(lead_ids)})")
    except Exception as e:
        logger.error(f"[AM Sync] Background worker error: {e}")
    finally:
        db.close()


def sync_leads_to_am_background(lead_ids: List[int]):
    """Fire-and-forget: spawn a background thread to sync leads to Audience Manager.
    
    Call this after db.commit() in any lead import path.
    Safe to call even if AM is not configured — worker checks and exits early.
    """
    if not lead_ids:
        return
    thread = threading.Thread(
        target=_sync_leads_worker,
        args=(lead_ids,),
        daemon=True,
        name=f"am-sync-{len(lead_ids)}"
    )
    thread.start()
    logger.info(f"[AM Sync] Spawned background thread for {len(lead_ids)} lead(s)")
