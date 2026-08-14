# ── messaging_service.py — resolve the active MessagingProvider ─────────────
"""
Provider resolution for SMS/WhatsApp, mirroring dialer_service.py's
get_provider_by_name()/get_provider_for_user() pattern one layer over.

SyncSettings.messaging_provider ("rcm" | "aircall") picks which
vendor every caller (Cadence channels, Widget routes) gets — they never
need to know which one is actually active.
"""
from typing import Optional
from sqlalchemy.orm import Session

from aircall_messaging_provider import AircallMessagingProvider
from rcm_messaging_provider import RCMMessagingProvider
from messaging_provider import MessagingProvider
from routes._admin_helpers import _get_or_create_sync_settings


def get_messaging_provider_for_org(db: Session) -> Optional[MessagingProvider]:
    """Resolve the org's active messaging provider from SyncSettings.
    Returns None if messaging isn't enabled or isn't fully configured."""
    settings = _get_or_create_sync_settings(db)
    provider_name = (getattr(settings, "messaging_provider", None) or "rcm").lower()

    if provider_name == "aircall":
        api_id = getattr(settings, "dialer_api_id", None) or ""
        api_token = getattr(settings, "dialer_api_token", None) or ""
        number_id = getattr(settings, "aircall_messaging_number_id", None) or ""
        if not all([api_id, api_token, number_id]):
            return None
        from crypto import decrypt_token
        return AircallMessagingProvider(api_id=api_id, api_token=decrypt_token(api_token), number_id=number_id)

    if not getattr(settings, "rcm_enabled", False):
        return None
    api_key = getattr(settings, "rcm_api_key", None) or ""
    user_id = getattr(settings, "rcm_user_id", None) or ""
    account_id = getattr(settings, "rcm_account_id", None) or ""
    if not all([api_key, user_id, account_id]):
        return None
    return RCMMessagingProvider(api_key=api_key, user_id=user_id, account_id=account_id)
