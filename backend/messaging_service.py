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
from messaging_provider import MessagingProvider

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


def get_messaging_provider_for_org(db: Session) -> Optional[MessagingProvider]:
    return None


def user_can_message(db_user, channel: str) -> bool:
    """Whether this SDR has been granted the channel. Unlike calling, there is
    no admin bypass here: an admin who wants to send messages grants themselves
    the channel like anyone else, so what the UI offers always matches what the
    send path will accept."""
    return bool(db_user and channel in CHANNELS
                and getattr(db_user, f"{channel}_enabled", False))


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
    return ResolvedMessaging(
        error="Connect a messaging provider to use SMS or WhatsApp.",
        retryable=False,
    )


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
