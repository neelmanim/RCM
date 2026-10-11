# ── messaging_service.py — resolve the active MessagingProvider ─────────────
"""
Provider resolution for SMS/WhatsApp, mirroring dialer_service.py's
get_provider_by_name()/get_provider_for_user() pattern one layer over.

Two levels of resolution live here:

* **Org** — SyncSettings.messaging_provider ("messenger" | "aircall") picks
  which vendor is the default for everyone.
* **Per user** — User.messaging_provider_override picks a different vendor for
  one SDR, and User.sms_enabled / whatsapp_enabled decide whether that SDR may
  use each channel at all.

v11.10.0: before this, messaging had no per-user gate of its own. The Message
tab rode on dialer_enabled plus a *Alternate Messenger dialer* provider (the widget-init
gate in frontend/js/app.js), which meant an SDR on Aircall for calling could
never message however well messaging was configured, and granting someone the
dialer silently granted WhatsApp too. resolve_messaging_for_user() is now the
one place that decides, and every send path routes through it.
"""
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

import models
from aircall_messaging_provider import AircallMessagingProvider
from dialer_messaging_provider import AlternateDialerProvider
from messaging_provider import MessagingProvider
from routes._admin_helpers import _get_or_create_sync_settings

# Also the allowlist for user_can_message's attribute lookup — a channel not
# named here can never resolve to a User column.
CHANNELS = ("sms", "whatsapp")

SUPPORTED_MESSAGING_PROVIDERS = ("messenger", "aircall")


def resolve_provider_name(settings, db_user) -> str:
    """Which vendor this user messages through — their own override if set,
    else the org default. Pass db_user=None for the plain org default.
    Deliberately independent of the *dialer* provider: calling on Aircall while
    messaging on Alternate Messenger is a supported config."""
    override = getattr(db_user, "messaging_provider_override", None) if db_user else None
    return (override or getattr(settings, "messaging_provider", None) or "messenger").lower()


def _build_provider(provider_name: str, settings) -> Optional[MessagingProvider]:
    """Instantiate one vendor from org credentials, or None if incomplete.
    Returning None (rather than raising) keeps "not configured" and "misbehaving
    vendor" as distinct outcomes for callers."""
    if provider_name == "aircall":
        api_id = getattr(settings, "dialer_api_id", None) or ""
        api_token = getattr(settings, "dialer_api_token", None) or ""
        # Aircall needs nothing but the org credentials: it already knows which
        # numbers each user owns, so the send-from number is discovered per SDR
        # by email (resolve_sender_for_user), exactly as calling has always done.
        # aircall_messaging_number_id survives only as an org-wide fallback.
        if not all([api_id, api_token]):
            return None
        from crypto import decrypt_token
        return AircallMessagingProvider(
            api_id=api_id, api_token=decrypt_token(api_token),
            number_id=getattr(settings, "aircall_messaging_number_id", None) or "",
        )

    if not getattr(settings, "messenger_enabled", False):
        return None
    api_key = getattr(settings, "messenger_api_key", None) or ""
    user_id = getattr(settings, "messenger_user_id", None) or ""
    account_id = getattr(settings, "messenger_account_id", None) or ""
    if not all([api_key, user_id, account_id]):
        return None
    return AlternateMessenger(api_key=api_key, user_id=user_id, account_id=account_id)


def missing_org_config(provider_name: str, settings) -> list[str]:
    """Human-readable names of the org-level fields still blank for this
    vendor. Powers the admin UI's readiness hints, so an admin sees *what* to
    fill in rather than only that sending failed."""
    if provider_name == "aircall":
        missing = []
        if not (getattr(settings, "dialer_api_id", None) or ""):
            missing.append("Aircall API ID")
        if not (getattr(settings, "dialer_api_token", None) or ""):
            missing.append("Aircall API Token")
        # Deliberately no Number ID here — it is auto-discovered per SDR.
        return missing

    missing = []
    if not getattr(settings, "messenger_enabled", False):
        missing.append("Alternate Messenger messaging is switched off")
    if not (getattr(settings, "messenger_api_key", None) or ""):
        missing.append("API Key")
    if not (getattr(settings, "messenger_user_id", None) or ""):
        missing.append("User ID")
    if not (getattr(settings, "messenger_account_id", None) or ""):
        missing.append("Account ID")
    return missing


def get_messaging_provider_for_org(db: Session) -> Optional[MessagingProvider]:
    """Resolve the org's active messaging provider from SyncSettings.
    Returns None if messaging isn't enabled or isn't fully configured."""
    settings = _get_or_create_sync_settings(db)
    return _build_provider(resolve_provider_name(settings, None), settings)


def user_can_message(db_user, channel: str) -> bool:
    """Whether this SDR has been granted the channel. Unlike calling, there is
    no admin bypass here: an admin who wants to send messages grants themselves
    the channel like anyone else, so what the UI offers always matches what the
    send path will accept."""
    return bool(db_user and channel in CHANNELS
                and getattr(db_user, f"{channel}_enabled", False))


def resolve_sender_for_user(settings, db_user, provider_name: str,
                            provider=None, allow_remote_lookup: bool = True) -> str:
    """The number this SDR's messages go out from — the same one for SMS and
    WhatsApp, which is why this takes no channel.

    The two vendors are asymmetric by nature, and the UI mirrors it:

    * **Aircall** needs no per-user setup at all. Give it the org API ID and
      token once and every user who exists in Aircall works, matched on their
      email — numbers included, since Aircall already knows which numbers each
      user owns. Discovered here, with the org-wide Number ID as a fallback.
    * **Alternate Messenger** needs per-user identity: the SDR's own assigned sender,
      falling back to the org-wide one — the same fallback shape
      messenger_from_number already uses for calling.

    Both channels share one sender: that is what the Widget has always done (it
    sends whatever /api/dialer/status handed it for SMS and WhatsApp alike), and
    cadence SMS reading a *different* field (messenger_from_number, the voice
    caller ID) is exactly why WhatsApp could work while SMS cadences failed.
    messenger_from_number stays as a last resort so an org that only ever
    filled that field keeps sending.

    `allow_remote_lookup=False` skips the Aircall API call — used on the
    page-load capabilities path, where a paginated /users scan per request
    would be the wrong trade even cached.
    """
    if provider_name == "aircall":
        org_fallback = getattr(settings, "aircall_messaging_number_id", None) or ""
        email = getattr(db_user, "email", None) if db_user else None
        if allow_remote_lookup and provider is not None and email:
            return provider.resolve_number_for_email(email) or org_fallback
        return org_fallback
    return (
        (getattr(db_user, "messenger_whatsapp_sender_id", None) if db_user else None)
        or getattr(settings, "messenger_sender_id", None)
        or getattr(settings, "messenger_from_number", None)
        or ""
    )


@dataclass
class ResolvedMessaging:
    """Outcome of resolving one (user, channel) pair into something sendable.
    `error` is None exactly when `provider` is set, and is written for an SDR
    or admin to read — it surfaces in cadence step failures and API responses.
    `retryable` distinguishes "an admin must fix config" from "never will work"
    so the cadence engine doesn't burn retries on a permanent problem."""
    provider:  Optional[MessagingProvider] = None
    sender_id: str = ""
    error:     Optional[str] = None
    retryable: bool = True


def resolve_messaging_for_user(db: Session, db_user, channel: str,
                               allow_remote_lookup: bool = True) -> ResolvedMessaging:
    """The single gate every SMS/WhatsApp send goes through.

    Checks, in order: the channel is real, the SDR has been granted it, the
    vendor's org credentials are complete, and a sender number exists.

    `allow_remote_lookup=False` resolves without calling the vendor's API — see
    resolve_sender_for_user.
    """
    if channel not in CHANNELS:
        return ResolvedMessaging(error=f"Unknown channel '{channel}'", retryable=False)

    if not db_user:
        return ResolvedMessaging(error="Sending user no longer exists", retryable=False)

    who = getattr(db_user, "name", None) or getattr(db_user, "email", None) or "This user"

    if not user_can_message(db_user, channel):
        label = "WhatsApp" if channel == "whatsapp" else "SMS"
        return ResolvedMessaging(
            error=f"{who} is not enabled for {label}. "
                  f"Grant it in Settings → Alternate Messenger (or Dialer) → per-user access.",
            retryable=False,
        )

    settings = _get_or_create_sync_settings(db)
    provider_name = resolve_provider_name(settings, db_user)
    if provider_name not in SUPPORTED_MESSAGING_PROVIDERS:
        return ResolvedMessaging(error=f"Unsupported messaging provider '{provider_name}'", retryable=False)

    provider = _build_provider(provider_name, settings)
    if provider is None:
        missing = missing_org_config(provider_name, settings)
        return ResolvedMessaging(
            error=f"{provider_name.title()} messaging is not fully configured"
                  + (f" — missing: {', '.join(missing)}" if missing else ""),
            retryable=True,
        )

    sender_id = resolve_sender_for_user(
        settings, db_user, provider_name, provider=provider,
        allow_remote_lookup=allow_remote_lookup,
    )
    if not sender_id:
        return ResolvedMessaging(
            error="No sender number is set — add one for this user, or an org-wide "
                  "default in Settings → Alternate Messenger.",
            retryable=True,
        )

    return ResolvedMessaging(provider=provider, sender_id=sender_id)


def get_user_capabilities(db: Session, user: dict) -> dict:
    from auth import export_allowed
    """What the current user may actually do, resolved live from the DB — the
    frontend's one source of truth for which widget tabs and lead-detail
    buttons to show.

    Live rather than JWT-derived on purpose: an admin's grant has to take
    effect without forcing the SDR to log out and back in, which is the same
    reason /api/dialer/status re-reads dialer_enabled on every call.
    """
    import dialer_service  # local import — keeps this module free of dialer_service's provider imports

    db_user = db.query(models.User).filter(models.User.id == user.get("sub")).first()
    calling_provider = dialer_service.get_provider_for_user(db, user)

    channels = {}
    for channel in CHANNELS:
        resolved = resolve_messaging_for_user(db, db_user, channel, allow_remote_lookup=False)
        channels[channel] = {
            "enabled": user_can_message(db_user, channel),
            "ready": resolved.provider is not None,
            "reason": resolved.error,
        }

    return {
        "calling": {
            "enabled": bool(calling_provider),
            "provider": calling_provider.provider_name if calling_provider else None,
        },
        "sms": channels["sms"],
        "whatsapp": channels["whatsapp"],
        "export": export_allowed(db, user),     # the UI hides every Export button when this is false
    }
