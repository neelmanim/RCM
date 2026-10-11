# ── audience_manager.py — Audience Manager (Alternate Messenger) contact sync ───────────
"""
Service module for Audience Manager API integration.
Handles contact search and creation for Alternate Messenger messaging.
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
                   email: str = "", extra_fields: dict = None) -> Optional[str]:
    """Create a contact in Audience Manager.

    `extra_fields` (v12.3): segmentable contact properties beyond the
    original name/phone/email — status, country, state, city, unique_id,
    owner, group, lifecycle_stage. Keys follow AM's own property_id naming
    (confirmed snake_case of the property's display name — e.g. "Mobile
    Number" -> mobile_number, "Lifecycle Stage" -> lifecycle_stage). Falsy
    values are omitted rather than sent as empty strings, same reasoning as
    the existing email handling below.

    Returns the record_id string if successful, None on failure.
    """
    url = f"{base_url.rstrip('/')}/api/v1/audience-manager/contact"
    params = {"user_id": user_id}
    payload = {
        "first_name": first_name or "Unknown",
        "last_name": last_name or "Lead",
        "mobile_number": phone,
        "source": "Alternate CRM",
        "create_consent": 1,
    }
    # AM API rejects empty email strings — only include if valid
    if email:
        payload["email"] = email
    for key, value in (extra_fields or {}).items():
        if value:
            payload[key] = value
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
                   email: str = "", extra_fields: dict = None) -> Optional[str]:
    """Search for a contact by phone; create if not found. Returns record_id or None.

    Existing contacts are NOT updated with `extra_fields` here — re-POSTing
    to the create endpoint risks creating a duplicate rather than updating
    in place. This function's job is first-time sync only; later field
    changes on an already-synced lead go through update_contact() /
    sync_lead_update_to_am() instead (see routes/lead_routes.py's
    `_push_am_update`)."""
    if not phone:
        return None

    # 1. Search first
    record = search_contact(base_url, api_key, phone)
    if record:
        return str(record.get("record_id") or "")

    # 2. Not found → create
    return create_contact(base_url, api_key, user_id, first_name, last_name, phone, email, extra_fields=extra_fields)


# Per Alternate Messenger's own API docs (Audience Manager API — Contact Integration
# Guide): these are silently ignored by the update endpoint even if sent.
_AM_UPDATE_IMMUTABLE_FIELDS = {"mobile_number", "updated_at", "created_at", "source"}


def update_contact(base_url: str, api_key: str, record_id: str, record_data: dict) -> bool:
    """Update fields on an existing AM contact (PATCH /record/contacts/<id>).

    mobile_number can never be updated on this endpoint — filtered out here
    defensively even though AM ignores it anyway. Returns True on success,
    False on any failure (never raises, matches create_contact's contract)."""
    url = f"{base_url.rstrip('/')}/api/v2/converse_integration/record/contacts/{record_id}"
    payload = {
        "crm_name": "audience_manager",
        "record_data": {k: v for k, v in (record_data or {}).items() if k not in _AM_UPDATE_IMMUTABLE_FIELDS},
    }
    try:
        resp = requests.patch(url, headers=_get_am_headers(api_key), json=payload, timeout=AM_TIMEOUT)
        resp.raise_for_status()
        logger.info(f"[AM] Updated contact record_id={record_id}: fields={list(payload['record_data'].keys())}")
        return True
    except requests.exceptions.Timeout:
        logger.warning(f"[AM] Update timed out for record_id={record_id}")
        return False
    except Exception as e:
        logger.warning(f"[AM] Update failed for record_id={record_id}: {e}")
        return False


def sync_lead_update_to_am(lead_id):
    """Background-thread entry point: push an already-synced lead's current
    name/email/status/lifecycle fields to AM. No-op if AM isn't configured
    or the lead was never synced (no am_record_id) — this never creates a
    contact, only updates one that ensure_contact already created.

    Mirrors the existing Salesforce status-push pattern (see
    routes/lead_routes.py's `_check_sf_push`/`_sf_status_push`): re-fetches
    everything fresh in its own session rather than reusing the request's
    (about-to-close) one."""
    from database import SessionLocal
    import models

    db = SessionLocal()
    try:
        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        if not settings or not settings.messenger_enabled or not settings.messenger_api_key:
            return
        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        if not lead or not lead.am_record_id:
            return

        record_data = {"first_name": lead.first_name or "Unknown", "last_name": lead.last_name or "Lead"}
        if lead.email:
            record_data["email"] = lead.email
        record_data.update(lead_extra_fields(lead, db=db))

        base_url = settings.messenger_base_url or "https://app.alternatecrm.com"
        update_contact(base_url, settings.messenger_api_key, lead.am_record_id, record_data)
    except Exception as e:
        logger.warning(f"[AM] sync_lead_update_to_am failed for lead_id={lead_id}: {e}")
    finally:
        db.close()


_LIFECYCLE_STAGE_MAP = {
    "Lead Assigned": "New",
    "Research": "New",
    "Calling": "Working",
    "Pending Review": "Working",
    "Meeting Scheduled": "Meeting Scheduled",
    "1st Discovery Meeting": "Meeting Scheduled",
    "Discovery Complete": "Meeting Scheduled",
    "Demo Scheduled": "Meeting Scheduled",
    "Demo Done": "Demo Done",
    "Completed": "Won",
    "Disqualified": "Lost",
    "Customer Declined": "Lost",
    "Unreachable": "Lost",
    "No Phone - Parked": "Lost",
}


def lifecycle_stage_for_status(status: str) -> str:
    """Coarse funnel bucket for AM's constrained `lifecycle_stage` property
    (a single_select_list — must be one of the 6 values configured there).
    Our own detailed status still goes into AM's free-text `status` property
    separately; this is only the segmentation-friendly bucket."""
    return _LIFECYCLE_STAGE_MAP.get(status, "New")


def owner_names(lead) -> str:
    """All assigned users' names (SDR + AE) for AM's 'Owner' property.
    Unlike Salesforce's SDR_Name__c (salesforce.sdr_only_names), this isn't
    a restricted picklist, so it isn't limited to SDR-role assignees."""
    return ", ".join(u.name for u in lead.assigned_users if u.name)


def lead_extra_fields(lead, db=None) -> dict:
    """Builds the `extra_fields` dict for create_contact/ensure_contact from
    a Lead ORM object — the one place this mapping is defined, reused by
    every sync call site (single lead creation, upload, Salesforce sync,
    the background worker, and the bulk backfill) instead of each one
    re-deriving it. `db` is optional — Lead has no `pod` relationship, only
    a raw `pod_id` FK, so resolving the pod's name needs one extra lookup;
    pass a session when you have one in scope, omit it to skip Group."""
    pod_name = None
    if db is not None and lead.pod_id:
        import models
        pod = db.query(models.Pod).filter(models.Pod.id == lead.pod_id).first()
        pod_name = pod.name if pod else None
    return {
        "status": lead.status,
        "country": lead.country,
        "state": lead.state,
        "city": lead.city,
        "unique_id": lead.id,
        "owner": owner_names(lead),
        "group": pod_name,
        "lifecycle_stage": lifecycle_stage_for_status(lead.status),
    }


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
        if not settings or not settings.messenger_enabled:
            logger.info("[AM Sync] Alternate Messenger not enabled — skipping background sync")
            return
        if not settings.messenger_api_key or not settings.messenger_user_id:
            logger.info("[AM Sync] Missing API key or user ID — skipping background sync")
            return

        base_url = settings.messenger_base_url or "https://app.alternatecrm.com"
        api_key = settings.messenger_api_key
        user_id = settings.messenger_user_id

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
                    lead.phone, lead.email or "",
                    extra_fields=lead_extra_fields(lead, db=db)
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
