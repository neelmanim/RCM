# ── dialer_service.py — Dialer Service orchestration layer ──────────────────
"""
Orchestrates dialer operations by reading config from SyncSettings,
instantiating the correct provider, and delegating calls/webhooks.
All business logic for dialer operations lives here.
"""
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import func, literal, or_
from sqlalchemy.exc import IntegrityError

import ownership_history as oh
import models
from dialer_provider import DialerProvider, NormalizedCallEvent, CallEventType
from aircall_provider import AircallDialerProvider
from dialer_messaging_provider import AlternateDialerProvider
from phone_utils import _normalize_digits, _digits_suffix_match

logger = logging.getLogger(__name__)

# Registry of supported providers
SUPPORTED_PROVIDERS = {"aircall", "messenger"}


def _get_settings(db: Session) -> models.SyncSettings:
    """Get or create the global settings row."""
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        settings = models.SyncSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


# ── Phone-matching helpers ────────────────────────────────────────────────────

def _normalize_digits(phone: Optional[str]) -> str:
    """Strip all non-digit characters from a phone number for comparison."""
    if not phone:
        return ""
    return re.sub(r"\D", "", phone)


def _digits_suffix_match(a: str, b: str) -> bool:
    """True if one digit string ends with the other. Handles a leading country
    code present on only one side (e.g. Aircall's webhook phone carries "+1",
    the Alternate CRM-initiated placeholder's stored phone doesn't) — the same
    class  _find_lead_by_phone's suffix tiers already handle."""
    return bool(a) and bool(b) and (a.endswith(b) or b.endswith(a))


def _sql_digits(column):
    """Return a SQL expression that strips non-digit characters from a column.
    Uses PostgreSQL regexp_replace when available; falls back to chained
    REPLACE() for common non-digit characters (works in SQLite)."""
    try:
        # PostgreSQL: regexp_replace(col, '\D', '', 'g')
        return func.regexp_replace(column, r'\D', '', 'g')
    except Exception:
        # Fallback — strip the most common non-digit chars via nested REPLACE
        expr = column
        for ch in ['+', '-', '(', ')', ' ', '.']:
            expr = func.replace(expr, ch, '')
        return expr


def _find_lead_by_phone(db: Session, raw_phone: str) -> Optional[models.Lead]:
    """
    Find the best-matching lead for a given phone number.
    Checks Lead.phone (primary) first, then Lead.phone_secondary.
    Both sides are digit-normalised before comparison.
    EC-1: primary + secondary matching.
    EC-2: when multiple matches, prefer most recently active (status_changed_at desc).
    Suffix-fallback: if no exact match, accept a lead whose stored number *ends with*
    the incoming digits (handles Aircall stripping country codes).
    Returns None if no match.

    Performance: Each tier runs a single SQL query returning at most 1 lead,
    instead of loading all 7000+ leads into memory.
    """
    digits = _normalize_digits(raw_phone)
    if not digits:
        return None

    # A lead in a live cadence wins over others sharing the number (the cadence
    # is waiting on its reply), then most recently active — same rule as the
    # Alternate Messenger inbound-SMS webhook.
    in_cadence = db.query(models.JourneyEnrollment.lead_id).filter(models.JourneyEnrollment.status == "active")
    order = (models.Lead.id.in_(in_cadence).desc(), models.Lead.status_changed_at.desc().nullslast())
    phone_digits = _sql_digits(models.Lead.phone)
    phone2_digits = _sql_digits(models.Lead.phone_secondary)

    # 1. Exact primary match
    match = db.query(models.Lead).filter(
        models.Lead.phone.isnot(None),
        phone_digits == digits,
    ).order_by(*order).first()
    if match:
        return match

    # 2. Exact secondary match
    match = db.query(models.Lead).filter(
        models.Lead.phone_secondary.isnot(None),
        phone2_digits == digits,
    ).order_by(*order).first()
    if match:
        return match

    # 3. Suffix primary match (stored number ends with incoming digits)
    #    e.g. Aircall sends '8552628000', lead has '+918552628000'
    match = db.query(models.Lead).filter(
        models.Lead.phone.isnot(None),
        phone_digits.like(f'%{digits}'),
        phone_digits != '',
    ).order_by(*order).first()
    if match:
        return match

    # 3b. Reverse suffix: incoming digits end with stored number
    #     e.g. lead stores '2125551234', Aircall sends '+12125551234'
    #     SQL: :digits LIKE '%' || normalized_phone
    match = db.query(models.Lead).filter(
        models.Lead.phone.isnot(None),
        literal(digits).like(literal('%') + phone_digits),
        phone_digits != '',
    ).order_by(*order).first()
    if match:
        return match

    # 4. Suffix secondary match
    match = db.query(models.Lead).filter(
        models.Lead.phone_secondary.isnot(None),
        phone2_digits.like(f'%{digits}'),
        phone2_digits != '',
    ).order_by(*order).first()
    if match:
        return match

    # 4b. Reverse suffix secondary
    match = db.query(models.Lead).filter(
        models.Lead.phone_secondary.isnot(None),
        literal(digits).like(literal('%') + phone2_digits),
        phone2_digits != '',
    ).order_by(*order).first()
    if match:
        return match

    return None


def _find_or_create_lead_by_phone(
    db: Session, phone_number: str, sdr_id: Optional[str], source_tag: str,
    try_salesforce_lookup: bool = False,
) -> Optional["models.Lead"]:
    """Find a lead by phone; if none exists, auto-create one and assign it to
    the resolved SDR. Mirrors the Klenty nightly sync's own create-on-miss
    logic (scheduled_jobs.py) — extended here to Aircall's webhook and
    historical-sync paths, which previously left the call lead-less (webhook)
    or dropped it entirely (historical sync) whenever the dialed number
    wasn't already a lead. Only creates when both a phone number and a
    resolved Alternate CRM user are present — per policy, tracking is mandatory
    only for calls made by users who exist in Alternate CRM; a call with no
    resolvable SDR has no assignee to create the lead under, so it's left
    unmatched rather than creating an orphaned lead.

    try_salesforce_lookup: v11.4.2, RCA — the org runs Salesforce sync
    push_only by design (Alternate CRM is a funnel INTO Salesforce, not a mirror
    of it), so inbound Salesforce Leads/Opportunities that never went through
    the outbound upload flow have no local row to match. When True and no
    local match exists, checks Salesforce live (Lead, then Contact->
    Opportunity — see salesforce.find_lead_or_opportunity_by_phone) before
    falling back to a bare placeholder, so the auto-created lead carries the
    real name/company and a link back to the real record instead of
    "Unknown Caller". Only passed True from the real-time webhook path
    (single call, already backgrounded) — left off historical bulk-sync
    (dialer_service.py's other call site) to avoid one SF API round-trip per
    miss in a large batch.
    """
    if not phone_number:
        return None
    lead = _find_lead_by_phone(db, phone_number)
    if lead or not sdr_id:
        return lead
    sdr = db.query(models.User).filter(models.User.id == sdr_id).first()
    if not sdr:
        return None

    sf_match = None
    if try_salesforce_lookup:
        try:
            from salesforce import get_sf_client, find_lead_or_opportunity_by_phone
            sf = get_sf_client()
            if sf:
                sf_match = find_lead_or_opportunity_by_phone(sf, phone_number)
        except Exception as e:
            logger.warning(f"[DialerService] Salesforce lookup failed for {phone_number}: {e}")

    lead = models.Lead(
        sf_lead_id=(
            sf_match["id"] if sf_match and sf_match["type"] == "Lead"
            else f"{source_tag}-{uuid.uuid4().hex[:12]}"
        ),
        sf_opportunity_id=sf_match["id"] if sf_match and sf_match["type"] == "Opportunity" else None,
        first_name=sf_match["first_name"] if sf_match else "",
        last_name=sf_match["last_name"] if sf_match else "Unknown",
        company=sf_match.get("company") if sf_match else None,
        email=sf_match.get("email") if sf_match else None,
        phone=phone_number,
        status="Calling",
        lead_source=f"{source_tag}+salesforce_match" if sf_match else source_tag,
        pod_id=sdr.pod_id,
    )
    try:
        db.add(lead)
        db.flush()
    except IntegrityError:
        # A concurrent webhook already created this exact lead between our
        # lookup above and this flush — extremely narrow window, only
        # reachable when sf_match gave us a real (non-random) sf_lead_id.
        db.rollback()
        existing = _find_lead_by_phone(db, phone_number)
        if existing:
            return existing
        if sf_match and sf_match["type"] == "Lead":
            existing = db.query(models.Lead).filter(models.Lead.sf_lead_id == sf_match["id"]).first()
            if existing:
                return existing
        raise
    oh.set_assignment_context(db, oh.R_DIALER_INBOUND)
    db.execute(models.lead_assignments.insert().values(user_id=sdr.id, lead_id=lead.id))
    return lead


def _transition_lead_to_calling(db: Session, lead: models.Lead, changed_by: str = "system") -> bool:
    """
    Move a lead to 'Calling' status if not already in a forward-pipeline stage.
    EC-7: forward-only — never moves backwards from Calling/Meeting Scheduled/terminal states.
    Returns True if the transition was made.
    """
    FORWARD_LOCKED = {
        "Calling", "Meeting Scheduled",
        "1st Discovery Meeting", "Discovery Complete",
        "Demo Scheduled", "Demo Done",
        "Disqualified", "Closed",
    }
    if lead.status in FORWARD_LOCKED:
        return False
    lead.status = "Calling"
    lead.status_changed_at = datetime.now(timezone.utc)
    return True


_AIRCALL_DIRECT_NOTE = "No research done – called directly from Aircall"


def _stamp_aircall_direct_research(lead: models.Lead) -> None:
    """
    Write a standard note into the lead's research fields when a call was
    placed directly from Aircall (not via Alternate CRM).
    EC-8: only stamps fields that are currently blank — never overwrites
    existing SDR research.
    """
    if not lead.research_company:
        lead.research_company = _AIRCALL_DIRECT_NOTE
    if not lead.research_contact:
        lead.research_contact = _AIRCALL_DIRECT_NOTE
    if not lead.research_hypothesis:
        lead.research_hypothesis = _AIRCALL_DIRECT_NOTE
    if not lead.research_personalization:
        lead.research_personalization = _AIRCALL_DIRECT_NOTE



def get_active_provider(db: Session) -> Optional[DialerProvider]:
    """
    Read the active dialer config from SyncSettings and return
    an instantiated provider, or None if dialer is disabled.
    """
    settings = _get_settings(db)
    provider_name = (settings.dialer_provider or "none").lower()

    if provider_name == "none" or provider_name not in SUPPORTED_PROVIDERS:
        return None

    if provider_name == "aircall":
        api_id = settings.dialer_api_id
        api_token = settings.dialer_api_token
        if not api_id or not api_token:
            logger.warning("[DialerService] Aircall selected but credentials missing")
            return None
        # Decrypt the token
        try:
            from crypto import decrypt_token
            decrypted_token = decrypt_token(api_token)
        except Exception as e:
            logger.error(f"[DialerService] Failed to decrypt Aircall token: {e}")
            return None
        return AircallDialerProvider(api_id=api_id, api_token=decrypted_token)

    # Alternate Messenger Contact Center
    if provider_name == "messenger":
        from_number = settings.messenger_from_number or ""
        # Resolve credentials + base_url: shared (from Conversations tab) or separate
        base_url, api_key, user_id = _resolve_dialer_credentials(settings)
        if not api_key or not user_id:
            logger.warning("[DialerService] Alternate Messenger selected but API key or User ID missing")
            return None
        from config import backend_base_url
        _backend_url = backend_base_url()
        _notify_url  = f"{_backend_url}/api/webhooks/dialer" if _backend_url else ""
        return AlternateDialerProvider(
            base_url=base_url, api_key=api_key,
            user_id=user_id, from_number=from_number,
            notify_url=_notify_url,
        )

    return None


def _instantiate_provider(
    provider_name: str,
    settings: models.SyncSettings,
    user_id_override: str = None,
) -> Optional[DialerProvider]:
    """
    Instantiate a specific provider by name using global settings credentials.
    Shared logic used by both get_active_provider() and get_provider_for_user().

    user_id_override lets a caller substitute a specific SDR's Alternate Messenger
    identity (User.messenger_user_id) in place of the global SyncSettings
    one — without this, every SDR's calls (and in-call actions: hold/mute/
    hangup/disconnect) authenticate as the same shared Alternate Messenger agent, and
    that agent's own phone number (not the SDR's) is what Alternate Messenger requires.
    (from_number itself has its own separate per-SDR override, applied at
    call time in initiate_call() below — not duplicated here.)
    """
    if provider_name == "aircall":
        api_id = settings.dialer_api_id
        api_token = settings.dialer_api_token
        if not api_id or not api_token:
            return None
        try:
            from crypto import decrypt_token
            return AircallDialerProvider(api_id=api_id, api_token=decrypt_token(api_token))
        except Exception:
            return None

    if provider_name == "messenger":
        base_url, api_key, user_id = _resolve_dialer_credentials(settings)
        user_id = user_id_override or user_id
        from_number = settings.messenger_from_number or ""
        if not api_key or not user_id:
            return None
        try:
            return AlternateDialerProvider(
                base_url=base_url, api_key=api_key,
                user_id=user_id, from_number=from_number,
            )
        except Exception as e:
            logger.error(f"[DialerService] Failed to instantiate Alternate Messenger provider: {e}")
            return None

    return None


def get_provider_by_name(provider_name: str, db: Session) -> Optional[DialerProvider]:
    """
    Instantiate a provider by its string name (e.g. 'messenger', 'aircall')
    using the global SyncSettings credentials.  Returns None if credentials
    are missing or the name is unknown.

    Use this when you need a *specific* provider regardless of which one is
    globally active — e.g. refreshing recording URLs for a DialerCall whose
    .provider column differs from the globally-configured dialer_provider.
    """
    settings = _get_settings(db)
    return _instantiate_provider(provider_name, settings)


def _resolve_dialer_credentials(settings: models.SyncSettings) -> tuple:
    """
    Resolve Alternate Messenger credentials for the dialer.
    Returns (base_url, api_key, user_id) — either shared from Conversations tab or separate.
    """
    default_url = "https://app.alternatecrm.com"
    if getattr(settings, 'dialer_use_shared_creds', True):
        # Reuse messaging credentials + base URL
        base_url = settings.messenger_base_url or default_url
        logger.info(f"[DialerService] Using SHARED credentials — base_url={base_url}, user_id={settings.messenger_user_id or '(none)'}")
        return base_url, settings.messenger_api_key or "", settings.messenger_user_id or ""
    # Separate Contact Center credentials + optional separate URL
    base_url = getattr(settings, 'dialer_base_url', None) or settings.messenger_base_url or default_url
    api_key = ""
    if settings.dialer_api_key:
        try:
            from crypto import decrypt_token
            api_key = decrypt_token(settings.dialer_api_key)
        except Exception:
            pass
    logger.info(f"[DialerService] Using SEPARATE credentials — base_url={base_url}, user_id={settings.dialer_user_id or '(none)'}")
    return base_url, api_key, settings.dialer_user_id or ""


def get_provider_for_user(db: Session, user: dict) -> Optional[DialerProvider]:
    """
    Resolve the dialer provider for a specific user.
    Priority:
      1. User.dialer_provider_override (per-SDR setting)
      2. SyncSettings.dialer_provider  (global default)

    Gate: returns None immediately if the user's dialer_enabled flag is False in
    the DB.  This is the live-DB check — it takes effect as soon as the admin
    toggles the flag, with no re-login required on the SDR's side.  Admins are
    exempt and always allowed through.
    """
    settings = _get_settings(db)

    db_user = db.query(models.User).filter(models.User.id == user.get("sub")).first()

    # Non-admin users must have dialer_enabled=True in the DB (live check — not JWT)
    is_admin_role = user.get("role") in ("Super Admin", "Admin", "Pod Admin")
    if db_user and not is_admin_role and not bool(getattr(db_user, "dialer_enabled", False)):
        logger.info(
            f"[DialerService] User {user.get('email')} dialer_enabled=False — no provider resolved"
        )
        return None

    messenger_user_id_override = getattr(db_user, "messenger_user_id", None) if db_user else None

    # Check per-SDR override
    if db_user and db_user.dialer_provider_override:
        override = db_user.dialer_provider_override.lower()
        if override in SUPPORTED_PROVIDERS:
            provider = _instantiate_provider(override, settings, user_id_override=messenger_user_id_override)
            if provider:
                return provider
            logger.warning(f"[DialerService] User {user.get('email')} has override '{override}' but credentials missing")

    # Fall back to global (still applying the SDR's own Alternate Messenger identity, if set)
    global_provider = (settings.dialer_provider or "none").lower()
    if global_provider != "none" and global_provider in SUPPORTED_PROVIDERS:
        return _instantiate_provider(global_provider, settings, user_id_override=messenger_user_id_override)

    return None



# ── EC-16 staleness thresholds (shared by initiate_call + my-active endpoint) ─
_STALE_STARTED_MINUTES  = 5    # CALL_STARTED older than 5 min = dead (never answered)
_STALE_ANSWERED_MINUTES = 15   # CALL_ANSWERED older than 15 min = zombie (disconnect webhook lost).
                                 # Alternate Messenger auto-terminates bridge calls after ~12 min of silence;
                                 # 15 min is safe and avoids the 90-min block SDRs were hitting
                                 # when hangup() 502'd and the DB was never updated. (RCA 2026-06-16)

# AircallDialerProvider.get_call_status(fast=True) only ever returns "completed"
# or "active" — see its implementation in aircall_provider.py.
_LIVE_ENDED_STATUSES = {"completed"}


def _get_active_call_for_user(db: Session, user_id: str) -> Optional[models.DialerCall]:
    """
    Return the user's current non-stale active DialerCall (CALL_STARTED or CALL_ANSWERED),
    or None if no fresh active call exists.

    Applies EC-16 staleness check and auto-heals stale records exactly as initiate_call()
    does. Extracted here so both code paths stay in sync.

    Returns:
        DialerCall instance if a fresh active call exists, else None.
        Stale calls are marked CALL_ENDED in-place and None is returned.
    """
    if not user_id:
        return None

    active_call = (
        db.query(models.DialerCall)
        .filter(
            models.DialerCall.user_id == user_id,
            models.DialerCall.status.in_(["CALL_STARTED", "CALL_ANSWERED"]),
        )
        .order_by(models.DialerCall.created_at.desc())
        .first()
    )
    if not active_call:
        return None

    # EC-16: staleness check
    _ref_time = active_call.started_at or active_call.created_at
    _is_stale = False
    _threshold = (
        _STALE_STARTED_MINUTES
        if active_call.status == "CALL_STARTED"
        else _STALE_ANSWERED_MINUTES
    )
    if _ref_time:
        if _ref_time.tzinfo is None:
            _ref_time = _ref_time.replace(tzinfo=timezone.utc)
        _age_minutes = (datetime.now(timezone.utc) - _ref_time).total_seconds() / 60
        _is_stale = _age_minutes >= _threshold

    # EC-16 ended_at guard: already closed even if age < threshold
    if active_call.ended_at and not _is_stale:
        _is_stale = True

    if _is_stale:
        logger.warning(
            f"[DialerService] EC-16: Auto-healing stale {active_call.status!r} call "
            f"{active_call.id} for user {user_id} — treating as CALL_ENDED."
        )
        active_call.status   = "CALL_ENDED"
        active_call.ended_at = active_call.ended_at or datetime.now(timezone.utc)
        try:
            db.commit()
        except Exception:
            db.rollback()
        return None  # stale → report as no active call

    return active_call


def apply_phone_match(db: Session, call: models.DialerCall, match: dict) -> bool:
    """Heal `call` to CALL_ENDED from a find_recent_call_by_phone() result.

    Two leads can share one number (bare vs. "ext." suffix), so the lookup
    can return a call another dialer_calls row already owns — writing that
    id trips idx_dialer_calls_dedup. Unblocking the SDR is the point and the
    id is bookkeeping, so a claimed id (and its duration, which belongs to
    that other call) is skipped and the status healed anyway. Always rolls
    back its own failed commit. 17 prod 500s over 4 bursts; see RELEASES.md
    v12.2.2 for the incident.
    """
    provider_call_id = str(match["id"])
    claimed_by = db.query(models.DialerCall.id).filter(
        models.DialerCall.provider == call.provider,
        models.DialerCall.provider_call_id == provider_call_id,
        models.DialerCall.id != call.id,
    ).first()
    if claimed_by:
        logger.warning(
            f"[DialerService] Phone-match for call {call.id} returned Aircall call "
            f"{provider_call_id}, already recorded on DialerCall {claimed_by[0]} — "
            f"healing status only (two leads almost certainly share this number)."
        )
    else:
        call.provider_call_id = provider_call_id
        if match.get("duration") is not None:
            call.duration = match["duration"]
    call.status = "CALL_ENDED"
    call.ended_at = call.ended_at or datetime.now(timezone.utc)
    try:
        db.commit()
        return True
    except Exception as e:
        # Mid-request: a failed-flush session turns the caller's next write
        # into an opaque 500 instead of the handled failure it should be.
        db.rollback()
        logger.error(
            f"[DialerService] Phone-match heal commit failed for call {call.id}: {e}"
        )
        return False


def _try_live_self_heal(db: Session, active_call: models.DialerCall) -> bool:
    """
    RCA 2026-08-19: Aircall webhook delivery lag (confirmed in prod logs —
    bursts up to 24s+) left a call the SDR had already hung up on still
    blocking their next dial for the full EC-16 window (5-15 min), since our
    own record only updates on webhook receipt. The real problem is a stale
    LOCAL record, not a stale call — so ask Aircall directly before blocking
    a new dial, instead of just waiting on the webhook or the timer.

    Aircall only — Alternate Messenger is deliberately excluded, matching the same
    provider check in dialer_routes.py's GET /calls/{id}/status (RCA
    2026-06-11): Alternate Messenger's /status endpoint isn't built for polling and
    returns 502s "consistently under load"; that endpoint already documents
    "webhook-first, no provider API call" for Alternate Messenger, so this must not
    reintroduce polling of it (production usage today is Aircall-only anyway
    — Alternate Messenger has 0 live calls in the last 3 days per prod DB).

    Deliberately NOT folded into _get_active_call_for_user(): that helper also
    backs the passive /calls/my-active polling endpoint, which would otherwise
    fire a live provider request on every poll for the entire duration of every
    real call — hammering the provider API for no benefit (a still-active call
    is expected to keep reporting active). This only runs on the one path
    where blocking actually costs the SDR something: about to reject a new
    dial attempt.

    Failback: get_call_status(fast=True) is a single short-timeout, no-retry
    attempt (see AircallDialerProvider.get_call_status's docstring) — any
    error, timeout, or unknown status here is swallowed and returns False, so
    the caller falls straight through to the pre-existing "block" behavior. A
    real Aircall outage never hangs the dial attempt or behaves worse than
    today; the EC-16 timer remains the last-resort safety net regardless of
    provider reachability.

    Returns True if the record was healed to CALL_ENDED (safe to proceed).

    RCA 2026-09-03 (staging test session, real DB evidence): every single
    Aircall DialerCall placed that session had provider_call_id == "" — the
    synchronous POST /users/{id}/calls response never carried an id (expected
    for bridge-mode dials, see initiate_call's own comment on this), and the
    old version of this function bailed out immediately whenever
    provider_call_id was falsy, leaving the SDR blocked for the full EC-16
    window (or a manual Force Clear) even when Aircall itself already
    considered the call over. Falls back to a phone-number + recency lookup
    (find_recent_call_by_phone) in that case, instead of giving up.
    """
    if (active_call.provider or "").lower() != "aircall":
        return False
    provider = get_provider_by_name("aircall", db)
    if not provider:
        return False

    if active_call.provider_call_id:
        try:
            status = provider.get_call_status(active_call.provider_call_id, fast=True)
            if status and (status.get("status") or "").strip() in _LIVE_ENDED_STATUSES:
                logger.info(
                    f"[DialerService] Self-healed active call {active_call.id} — "
                    f"Aircall reports call already ended, local webhook hadn't arrived yet."
                )
                active_call.status   = "CALL_ENDED"
                active_call.ended_at = active_call.ended_at or datetime.now(timezone.utc)
                db.commit()
                return True
        except Exception as e:
            db.rollback()  # a swallowed failed commit poisons the session
            logger.warning(f"[DialerService] Live status self-heal check failed for call {active_call.id}: {e}")
        return False

    # No provider_call_id ever recorded — ask Aircall directly by phone
    # number + recency instead of blocking until the EC-16 timer expires.
    since = active_call.started_at or active_call.created_at
    if not active_call.phone_number or not since:
        return False
    # Aircall's call log is company-wide, so the lookup must be scoped to this
    # call's own SDR or it can match a teammate's call to the same number.
    call_owner = db.query(models.User).filter(models.User.id == active_call.user_id).first()
    if not call_owner or not call_owner.email:
        return False
    try:
        match = provider.find_recent_call_by_phone(
            active_call.phone_number, since, call_owner.email
        )
        if match and match.get("ended"):
            logger.info(
                f"[DialerService] Self-healed active call {active_call.id} via phone-match "
                f"(no provider_call_id was ever recorded) — Aircall call {match['id']} already ended."
            )
            return apply_phone_match(db, active_call, match)
    except Exception as e:
        db.rollback()
        logger.warning(f"[DialerService] Phone-match self-heal failed for call {active_call.id}: {e}")
    return False


def initiate_call(db: Session, user: dict, lead_id: str, phone_number: str,
                  call_mode: str = "bridge", request_base_url: str = "") -> dict:
    """
    Start an outbound call through the active dialer provider.
    Creates a DialerCall record regardless of outcome.
    call_mode: 'bridge' (3-party, SDR phone) or 'browser' (2-party, WebRTC)
    request_base_url: the origin of the FastAPI request (e.g. https://api.alternatecrm.com/)
                      used to build the webhook notify_url — no env var needed.
    """
    provider = get_provider_for_user(db, user)
    if not provider:
        return {"success": False, "error": "No dialer provider configured for your account. Contact your admin."}

    # Capture provider name now — used in early-return error dicts so callers
    # (e.g. the error logger in dialer_routes.py) always see the correct label
    # instead of falling back to a hardcoded default (EC-17 / RCA-2026-06-08).
    _provider_name = provider.provider_name

    # Guard: block concurrent calls via shared EC-16 helper.
    # _get_active_call_for_user() applies staleness thresholds, auto-heals stale records,
    # and returns None when the SDR is safe to place a new call.
    user_id = user.get("sub")
    if user_id:
        blocking_call = _get_active_call_for_user(db, user_id)
        if blocking_call and _try_live_self_heal(db, blocking_call):
            blocking_call = None  # provider confirms it's actually over — proceed
        if blocking_call:
            # Fresh active call — legitimately in progress. Block the new call.
            logger.warning(
                f"[DialerService] Blocked concurrent call for user {user_id} — "
                f"active call {blocking_call.id} still in status {blocking_call.status!r}"
            )
            return {
                "success": False,
                "provider": _provider_name,  # EC-17: always include provider so error log is accurate
                "error": (
                    "You already have an active call in progress. "
                    "Please hang up the current call before starting a new one."
                ),
            }

    # Inject the webhook notify_url derived from the live request URL.
    # This lets Alternate Messenger push real-time events back to us without any
    # static configuration or env vars.
    # Points at the Alternate Messenger-only endpoint (not the shared /webhooks/dialer)
    # so Alternate Messenger traffic can never be misrouted into the Aircall parser —
    # see RCA 2026-07-10 in dialer_routes.py's dialer_webhook().
    if request_base_url and hasattr(provider, 'notify_url') and not provider.notify_url:
        base = request_base_url.rstrip("/")
        provider.notify_url = f"{base}/api/webhooks/messenger"
        logger.info(f"[DialerService] notify_url set to: {provider.notify_url}")

    # Resolve caller ID: SDR personal → global fallback → omit
    # The provider is already constructed with the global from_number (from SyncSettings).
    # Override with SDR's personal caller ID if they've set one.
    if hasattr(provider, 'from_number'):
        db_user = db.query(models.User).filter(models.User.id == user.get("sub")).first()
        if db_user and db_user.messenger_from_number:
            provider.from_number = db_user.messenger_from_number
            logger.info(f"[DialerService] Using SDR caller ID: {db_user.messenger_from_number}")
        elif provider.from_number:
            logger.info(f"[DialerService] Using global caller ID: {provider.from_number}")
        else:
            logger.info("[DialerService] No caller ID configured — Alternate Messenger will use account default")

    # Validate lead exists
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        return {"success": False, "error": "Lead not found"}

    # Eligibility gate (mirrors journey_engine.engine._is_lead_eligible) — a
    # suppressed lead must never reach the provider, regardless of entry point
    # (Leads Hub quick-call, Power Dialer queue, ad-hoc dial). This is the one
    # choke point every calling path already routes through.
    if lead.do_not_contact or lead.unsubscribed_at is not None:
        return {
            "success": False,
            "provider": _provider_name,
            "error": "This lead has opted out of contact (do-not-contact/unsubscribed) and cannot be called.",
            "suppressed": True,
        }

    # RCA 2026-09-04: the DialerCall record used to be created only *after*
    # provider.initiate_call() returned, leaving the whole external Aircall
    # round-trip (plus its 405 retry-with-sleep) inside the window where
    # _get_active_call_for_user() sees no active call yet. A second request
    # for the same SDR landing in that window (impatient re-click, Power
    # Dialer auto-advance) sailed straight past the guard and dialed again —
    # confirmed in prod: 38 same-lead dial pairs less than 5s apart over 14
    # days. Reserve the slot with a placeholder row *before* calling the
    # provider, then fill it in below, so a concurrent request's guard check
    # actually sees it instead of racing an in-flight external API call.
    reserved_call = models.DialerCall(
        lead_id=lead_id,
        user_id=user.get("sub"),
        provider=provider.provider_name,
        provider_call_id="",
        phone_number=phone_number,
        status=CallEventType.CALL_STARTED,
        direction="outbound",
        started_at=datetime.now(timezone.utc),
    )
    db.add(reserved_call)
    db.commit()
    db.refresh(reserved_call)

    user_email = user.get("email", "")
    use_agent_phone = (call_mode == "bridge")

    # Auto-transition lead status: Lead Assigned / Research → Calling
    # This mirrors the behaviour for Aircall-direct calls (handled in handle_webhook)
    # but fires earlier — when SDR clicks dial — so the pipeline is always up to date.
    # _transition_lead_to_calling is forward-only (won't regress from Meeting Scheduled etc.)
    prev_status = lead.status
    changed_by_name = user.get("name") or user_email or "unknown"
    if _transition_lead_to_calling(db, lead, changed_by=changed_by_name):
        try:
            models.log_status_change(db, lead.id, prev_status, "Calling", changed_by_name,
                                     changed_by_user_id=user.get("sub"))
        except Exception:
            pass  # status log is non-critical
        db.commit()
        logger.info(
            f"[DialerService] Auto-moved lead {lead_id} from '{prev_status}' → 'Calling' "
            f"on dial by {user_email}"
        )

    lead_name = f"{lead.first_name or ''} {lead.last_name}".strip()
    result = provider.initiate_call(phone_number, user_email, lead_id,
                                     use_agent_phone=use_agent_phone, contact_name=lead_name)

    # RCA 2026-08-18: this 405 message predates Aircall Everywhere and only
    # ever told the SDR to open the Desktop app — actively wrong guidance
    # once Everywhere is enabled, since logging into the Alternate CRM drawer is
    # now the intended alternative device. Patched here (not in
    # aircall_provider.py) so the provider stays unaware of an org-wide
    # feature flag that isn't its concern.
    if not result.success and result.error and "Aircall Desktop app is open" in result.error:
        if _get_settings(db).aircall_everywhere_enabled:
            result.error = result.error.replace(
                "Please ensure their Aircall Desktop app is open and status is set to Available, then try again.",
                "Please ensure they're logged into either the Aircall Desktop app or the "
                "Aircall drawer in Alternate CRM (top bar), with status set to Available, then try again.",
            )

    # Fill in the reservation placed above with the real outcome — never a
    # second row (that would defeat the whole point of reserving the slot).
    dialer_call = reserved_call
    dialer_call.provider_call_id = result.provider_call_id or ""
    dialer_call.status = CallEventType.CALL_STARTED if result.success else "FAILED"
    if not result.success:
        dialer_call.started_at = None
        dialer_call.notes = result.error  # persist failure reason
    def _persist_dialer_call():
        db.commit()
        db.refresh(dialer_call)

    # RCA 2026-08-31: with no try/except here, a real successful provider
    # call (the phone already rang) followed by a transient commit failure
    # silently lost the only record of it — reported as "I dialed N times,
    # the system only shows fewer." One retry covers a transient blip; if it
    # still fails, log loudly (Rule 12 precedent — never swallow) instead of
    # losing the trail, and if the call itself did go out, tell the SDR that
    # plainly rather than a generic error.
    try:
        _persist_dialer_call()
    except Exception as e:
        db.rollback()
        logger.error(f"[DialerService] DialerCall commit failed after dial (lead={lead_id}, provider_success={result.success}): {e}")
        try:
            _persist_dialer_call()
        except Exception as e2:
            db.rollback()
            logger.error(f"[DialerService] DialerCall commit retry also failed (lead={lead_id}): {e2}")
            if result.success:
                return {
                    "success": True,
                    "provider": _provider_name,
                    "warning": "The call was placed, but Alternate CRM failed to record it — please log the outcome manually.",
                }
            raise

    logger.info(
        f"[DialerService] Call {'started' if result.success else 'FAILED'}: "
        f"lead={lead_id}, provider={provider.provider_name}, "
        f"call_id={dialer_call.id}"
        + (f", error={result.error!r}" if not result.success else "")
    )
    if not result.success:
        logger.error(
            f"[DialerService] {provider.provider_name} call initiation failed for lead={lead_id} "
            f"phone={phone_number!r} user={user.get('email')!r}: {result.error}"
        )

    response = {
        "success": result.success,
        "call_id": dialer_call.id,
        "provider": provider.provider_name,
        "provider_call_id": result.provider_call_id,
        "status": dialer_call.status,
        "error": result.error,
    }

    # Pass through LiveKit fields for browser-based Alternate Messenger calling
    if result.livekit_token:
        response["livekit_token"] = result.livekit_token
    if result.livekit_url:
        response["livekit_url"] = result.livekit_url
    if result.room_name:
        response["room_name"] = result.room_name
    if result.agent_join_via_phone is not None:
        response["agent_join_via_phone"] = result.agent_join_via_phone

    return response


# ── V39: Aircall tag → outcome auto-log ──────────────────────────────────────
_DEFAULT_TAG_MAPPING = {
    "No Answer":       "No Answer",
    "Left Voicemail":  "Left Voicemail",
    "Voicemail":       "Left Voicemail",
    "Busy":            "Busy",
    "Wrong Number":    "Wrong Number",
    "Connected":       "Not Interested",
    "Not Interested":  "Not Interested",
    "Call Back Later": "Call Back Later",
    "Meeting Booked":  "Meeting Confirmed",
    "Meeting":         "Meeting Confirmed",
    "Disqualify":      "Disqualify",
    # RCA 2026-08-18 (LIVE, prod): this org's actual configured Aircall tags —
    # confirmed against real raw_payload data, not guessed. Admins can freely
    # rename/add tags in Aircall's own dashboard, so the generic names above
    # never matched anything here — every call sat unlogged despite being
    # tagged. "Cold Call" deliberately has no entry: it's a call-type label
    # this org also uses, not an outcome.
    "Not Answered":              "No Answer",
    "Bad Number":                "Wrong Number",
    "Answered – Not Interested": "Not Interested",
    # RCA 2026-09-29 (prod): 74 calls tagged "Meeting Set" were never mapped, so
    # 39 leads sat in Calling with a meeting booked. Tag list from prod raw_payload.
    "Answered – Discovery Call / Meeting Set": "Meeting Confirmed",
    "Answered – Call Back Later":              "Call Back Later",
    "Answered – Wrong Number":                 "Wrong Number",
    "Voicemail – Left Message":                "Left Voicemail",
}


def _tag_key(tag) -> str:
    # ponytail: Aircall admins type hyphens, en or em dashes interchangeably.
    return str(tag).replace("—", "–").replace(" - ", " – ").strip().casefold()


def _auto_log_outcome(db: Session, dialer_call: models.DialerCall, tags: list, settings: models.SyncSettings) -> Optional[str]:
    """
    Map Aircall tag names → Alternate CRM outcome and auto-log via existing log_call machinery.
    Returns the outcome string if logged, None if skipped.

    Idempotency: if dialer_call.outcome is already set, skip (SDR may have manually
    logged before the webhook arrived — EC-4).
    """
    if not tags:
        logger.debug("[AutoLog] call.tagged with empty tags list — skipping")
        return None

    # Idempotency: outcome already logged (EC-4 — SDR beat webhook)
    if dialer_call.outcome:
        logger.info(f"[AutoLog] Outcome already logged ({dialer_call.outcome}) for call {dialer_call.id} — skipping webhook auto-log")
        return None

    # Load admin-configured mapping (falls back to defaults)
    tag_mapping = _DEFAULT_TAG_MAPPING.copy()
    if settings.aircall_tag_mapping:
        try:
            custom = json.loads(settings.aircall_tag_mapping)
            if isinstance(custom, dict):
                tag_mapping.update(custom)
        except Exception:
            pass

    # Find first matching tag (EC-3: multiple tags → first match wins)
    tag_mapping = {_tag_key(k): v for k, v in tag_mapping.items()}
    mapped_outcome = None
    matched_tag    = None
    for tag in tags:
        outcome = tag_mapping.get(_tag_key(tag))
        if outcome:
            mapped_outcome = outcome
            matched_tag    = tag
            break

    if not mapped_outcome:
        logger.info(f"[AutoLog] No mapping for tags {tags} on call {dialer_call.id} — skipping (EC-1)")
        return None

    # Write outcome onto the DialerCall record
    dialer_call.outcome = mapped_outcome
    dialer_call.notes   = f"[Auto-logged from Aircall tag: {matched_tag}]"

    # Write outcome directly to the DialerCall. The attempt counter is NOT touched
    # here: handle_webhook counts an outbound call once, on its first terminal
    # event; counting again on the tag made every tagged call count twice (and
    # a tagged inbound call count as an attempt).
    if dialer_call.lead_id:
        try:
            lead = db.query(models.Lead).filter(models.Lead.id == dialer_call.lead_id).first()
            if lead:
                lead.last_call_timestamp = datetime.now(timezone.utc)
                # Create a lightweight CallLog so the calls tab reflects it
                try:
                    outcome_enum = models.CallOutcome(mapped_outcome)
                except (ValueError, AttributeError):
                    outcome_enum = mapped_outcome
                call_log = models.CallLog(
                    lead_id=dialer_call.lead_id,
                    # RCA 2026-08-19: "system" isn't a real users.id row — every
                    # tag-auto-logged call with no dialer_call.user_id (rare, but
                    # real) raised an FK violation here. user_id is nullable;
                    # None is the correct "no SDR" value the column already supports.
                    user_id=dialer_call.user_id,
                    outcome=outcome_enum,
                    notes=dialer_call.notes or "",
                    dialer_call_id=dialer_call.id,
                )
                db.add(call_log)
                if mapped_outcome == "Wrong Number":
                    from services.lead_service import mark_phone_invalid  # local: avoid import cycle at module load
                    mark_phone_invalid(db, lead, f"Aircall tag: {matched_tag}")
                # Same transition log_call makes for a meeting outcome — the tag
                # path only recorded the outcome, so the lead never left Calling.
                # SF creation then follows via the normal sf_push_stage sync.
                cfg = models.get_outcome_by_value(mapped_outcome, db) or {}
                if cfg.get("action") == "meeting_scheduled" and models.STAGE_GROUP.get(lead.status) == 0:
                    old_status = lead.status
                    lead.status = "Meeting Scheduled"
                    lead.status_changed_at = datetime.now(timezone.utc)
                    lead.meeting_scheduled_at = lead.meeting_scheduled_at or lead.status_changed_at
                    models.log_status_change(db, lead.id, old_status, lead.status, f"Aircall tag: {matched_tag}",
                                             changed_by_user_id=dialer_call.user_id)
        except Exception as e:
            logger.warning(f"[AutoLog] Lead/CallLog update failed for call {dialer_call.id}: {e}")

    logger.info(f"[AutoLog] Auto-logged outcome '{mapped_outcome}' from Aircall tag '{matched_tag}' on call {dialer_call.id}")
    return mapped_outcome


def handle_webhook(db: Session, provider_name: str, payload: dict) -> dict:
    """
    Process an incoming webhook from a dialer provider.
    Normalizes the event and updates/creates the DialerCall record.
    For calls initiated directly via provider (not via Alternate CRM UI):
      - source is set to '{provider}_direct'
      - lead status is auto-transitioned to 'Calling'
      - lead.times_called is incremented (outbound CALL_ENDED only) — EC-9, EC-10
    """
    # Instantiate the specific provider by name (not global — supports dual providers)
    settings = _get_settings(db)
    provider = _instantiate_provider(provider_name, settings)
    if not provider:
        logger.warning(f"[DialerService] Webhook for '{provider_name}' but provider not configured")
        return {"ok": False, "reason": f"Provider '{provider_name}' not configured"}

    event = provider.handle_webhook(payload)
    if not event:
        return {"ok": True, "reason": "Event ignored (not relevant)"}

    # V48: resolve the CRM user this event belongs to (by Aircall's own account
    # email, case-insensitive — EC-5) up front, so the pending-row match below can
    # scope to it. Without this, two SDRs calling leads that share a phone number
    # (duplicate lead, shared switchboard) could have their pending rows cross-
    # matched — a pre-existing gap that Aircall Everywhere widens (its pending
    # window is click-to-dial-until-webhook-arrival, seconds, vs. bridge mode's
    # near-instant REST-POST-confirms-provider_call_id window).
    event_user_id = None
    if event.user_email:
        _crm_user = db.query(models.User).filter(
            func.lower(models.User.email) == event.user_email.lower()
        ).first()
        if _crm_user:
            event_user_id = _crm_user.id

    # Find or create the DialerCall record
    def _find_by_call_id():
        return db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == event.provider_call_id,
            models.DialerCall.provider == provider_name,
        ).first()

    dialer_call = None
    alternatecrm_initiated = False  # tracks whether Alternate CRM started this call
    if event.provider_call_id:
        dialer_call = _find_by_call_id()
        if dialer_call:
            alternatecrm_initiated = (dialer_call.source == "alternatecrm")

    # If not found, try to match an initiation record with empty provider_call_id.
    # EC-14 FIX: Normalize digits on both sides — Aircall formats phones differently
    # between CALL_STARTED ("+91 8109730301") and CALL_ENDED ("+91 81097 30301").
    if not dialer_call and event.provider_call_id and event.phone_number:
        event_digits = _normalize_digits(event.phone_number)
        # RCA 2026-08-24: Aircall Everywhere (embedded) widens the pending
        # window this match relies on (per the V48 comment above) far enough
        # that this match started missing routinely instead of rarely, and a
        # missed match fell into the create-new-row path below — the SDR's
        # original call stayed stuck at CALL_STARTED (never got an outcome)
        # while a second, invisible "_direct" row got the real terminal data.
        # Bound the match window to 10 minutes: long enough to cover the
        # embedded widget's ring delay, short enough to not let the periodic
        # sweeper's own 90-minute zombie threshold cross-match an unrelated
        # later call reusing the same number.
        _pending_cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)

        def _pending_candidates(scope_to_user):
            q = db.query(models.DialerCall).filter(
                models.DialerCall.provider_call_id == "",
                models.DialerCall.provider == provider_name,
                models.DialerCall.status.in_(["CALL_STARTED", "FAILED"]),
                models.DialerCall.created_at >= _pending_cutoff,
            )
            if scope_to_user and event_user_id:
                q = q.filter(models.DialerCall.user_id == event_user_id)
            return q.order_by(models.DialerCall.created_at.desc()).limit(20).all()

        # First try exact string match (fast path). V48: scope to the resolved
        # user_id when known — narrows, never widens, the existing match so two
        # SDRs calling leads sharing a phone number can't cross-attribute a call.
        pending_q = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "",
            models.DialerCall.provider == provider_name,
            models.DialerCall.phone_number == event.phone_number,
            models.DialerCall.status.in_(["CALL_STARTED", "FAILED"]),
            models.DialerCall.created_at >= _pending_cutoff,
        )
        if event_user_id:
            pending_q = pending_q.filter(models.DialerCall.user_id == event_user_id)
        pending = pending_q.order_by(models.DialerCall.created_at.desc()).first()
        # Fallback: digits-only comparison for format mismatches (e.g. spaces added by Aircall)
        if not pending and event_digits:
            for c in _pending_candidates(scope_to_user=True):
                if _digits_suffix_match(_normalize_digits(c.phone_number), event_digits):
                    pending = c
                    break
        # Last-chance reconciliation before falling through to create a new
        # row: same digit-suffix match, same window, but WITHOUT the
        # event_user_id scope — Aircall's call.created payload frequently
        # has no attributable user yet (see aircall_provider.py), which was
        # silently defeating the user_id-scoped match above on the very
        # first webhook for an embedded call. Only take it if exactly one
        # candidate matches — ambiguity falls through to create-new unchanged.
        if not pending and event_digits:
            matches = [c for c in _pending_candidates(scope_to_user=False)
                       if _digits_suffix_match(_normalize_digits(c.phone_number), event_digits)]
            if len(matches) == 1:
                pending = matches[0]
                logger.warning(
                    f"[DialerService] Reconciled pending DialerCall {pending.id} without "
                    f"user_id scope (embedded-call race) — would otherwise have created a "
                    f"duplicate '{provider_name}_direct' row for phone digits {event_digits}"
                )
        if pending:
            pending.provider_call_id = event.provider_call_id
            dialer_call = pending
            alternatecrm_initiated = True  # matched a Alternate CRM-initiated record
            logger.info(f"[DialerService] Matched pending DialerCall by normalized phone digits ({event_digits})")

    if not dialer_call and event.event_type == CallEventType.TRANSCRIPTION_READY:
        # RCA 2026-08-18 (LIVE, prod): found 88 orphaned DialerCall rows stuck at
        # status=TRANSCRIPTION_READY with no ended_at, across one evening. A
        # transcript always belongs to a call that already happened — if we can't
        # match it to an existing row (provider_call_id extraction mismatch, or
        # the transcript simply arrives with no corresponding call.* webhook ever
        # received), there is nothing real to create. TRANSCRIPTION_READY isn't
        # in _TERMINAL_STATES, so a fabricated row here would sit unresolved
        # forever — unlike call.created/answered/ended, which legitimately do
        # represent a brand-new direct-dial call we've never seen.
        logger.info(
            f"[DialerService] Ignoring unmatched transcription event for "
            f"provider_call_id={event.provider_call_id!r} — no existing call to attach it to"
        )
        return {"ok": True, "reason": "Transcription event unmatched — no call to attach"}

    created_now = False  # True only when this webhook inserted the row (set below)
    if not dialer_call:
        # Webhook arrived before/without a POST /calls/start — call was made directly in Aircall.
        # user_id already resolved above (event_user_id) — EC-5: case-insensitive match.
        user_id = event_user_id

        # Find or create the lead by phone (primary + secondary) — EC-1, EC-2.
        # try_salesforce_lookup only when sync_direction=="both": a push_only
        # org has explicitly said Alternate CRM should never pull FROM Salesforce
        # (RCA 2026-08-31 — this per-call lookup was the one path that ignored
        # that setting, continuously pulling real SF leads into Alternate CRM).
        # Still creates a bare placeholder lead either way, so the call itself
        # is never left untracked — only the SF-populate step is gated.
        lead = _find_or_create_lead_by_phone(
            db, event.phone_number, user_id,
            f"aircall_webhook:{datetime.now(timezone.utc).date().isoformat()}",
            try_salesforce_lookup=(settings.sync_direction == "both"),
        )
        lead_id = lead.id if lead else None

        dialer_call = models.DialerCall(
            lead_id=lead_id,
            provider=provider_name,
            provider_call_id=event.provider_call_id,
            phone_number=event.phone_number,
            user_id=user_id,
            direction=event.direction,
            status=event.event_type,
            source=f"{provider_name}_direct",  # not via Alternate CRM UI
        )
        db.add(dialer_call)
        alternatecrm_initiated = False
        created_now = True
        # RCA 2026-07-27: two near-simultaneous webhooks for the same call
        # (e.g. call.answered + call.ended firing back-to-back) can both miss
        # the SELECT above and both try to INSERT here — the second commit hit
        # the idx_dialer_calls_dedup unique constraint and the whole webhook
        # (often carrying the terminal CALL_ENDED) was dropped, leaving the
        # call stuck at CALL_STARTED/CALL_ANSWERED forever. Flush now so the
        # race is caught and resolved by re-fetching the row the other
        # request just inserted, instead of aborting.
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            dialer_call = _find_by_call_id()
            alternatecrm_initiated = bool(dialer_call and dialer_call.source == "alternatecrm")
            created_now = False

    # Update the record with event data.
    # EC-17: Terminal-state guard — once CALL_ENDED or CALL_FAILED is reached
    # (either by the disconnect endpoint, force-end, or an earlier webhook),
    # no late-arriving webhook can downgrade status back to CALL_STARTED/CALL_ANSWERED.
    # Alternate Messenger retries webhook delivery and sends status events out of order;
    # a 'call.answered' webhook arriving 50+ seconds after the SDR clicked Disconnect
    # is the primary source of ghost active-call records that block future dials.
    _TERMINAL_STATES = {"CALL_ENDED", "CALL_FAILED"}
    # Was this row already finished before this webhook? A row this webhook just
    # inserted is born with the event's status, so it is not "already" anything.
    # Keyed on status, not ended_at: Aircall's call.hungup carries no ended_at,
    # so the call.ended that follows used to look like a first delivery.
    was_already_terminal = (not created_now) and dialer_call.status in _TERMINAL_STATES
    if dialer_call.status not in _TERMINAL_STATES:
        dialer_call.status = event.event_type
    else:
        # Already terminal — only allow CALL_ENDED overwrite (idempotent) or
        # metadata updates (duration, recording_url, transcript) below.
        # Swallow non-terminal status events silently.
        if event.event_type not in _TERMINAL_STATES:
            logger.info(
                f"[DialerService] EC-17: Ignoring late {event.event_type!r} webhook "
                f"for already-terminal call {dialer_call.id} "
                f"(status={dialer_call.status!r})"
            )

    if event.started_at:
        dialer_call.started_at = event.started_at
    if event.answered_at:
        dialer_call.answered_at = event.answered_at
        # Native "the callee picked up" signal, same field/value Klenty's own
        # sync already writes — dialer_call_connected() picks this up with no
        # change to that shared check. Without this, Aircall/Alternate Messenger calls
        # only ever count as connected when an SDR manually logs a qualifying
        # outcome, which most provider-direct calls never get.
        dialer_call.provider_disposition = "ANSWERED"
    # Idempotency guard: never overwrite ended_at or duration once set.
    # Alternate Messenger retries webhook delivery — a second CALL_ENDED must not
    # corrupt the original timestamp or duration recorded by the first delivery.
    if event.ended_at and not dialer_call.ended_at:
        dialer_call.ended_at = event.ended_at
    # Allow overwriting duration=0 with a real value — call.created often sets
    # duration=0 before call.ended arrives with the actual duration.
    if event.duration is not None and (dialer_call.duration is None or dialer_call.duration == 0):
        dialer_call.duration = event.duration
    if event.recording_url:
        dialer_call.recording_url = event.recording_url
    if event.transcript:
        dialer_call.transcript = event.transcript
    if event.direction:
        dialer_call.direction = event.direction
    if event.raw_payload:
        dialer_call.raw_payload = json.dumps(event.raw_payload)

    # — Post-call lead updates (on CALL_ENDED only) — EC-10
    is_call_ended = (event.event_type == CallEventType.CALL_ENDED)
    is_outbound = (event.direction == "outbound")

    if is_call_ended and dialer_call.lead_id:
        lead = db.query(models.Lead).filter(models.Lead.id == dialer_call.lead_id).first()
        if lead:
            # Auto-transition status (aircall_direct calls only — Alternate CRM-initiated
            # calls update status via call_routes.py log_call)
            if not alternatecrm_initiated:
                _transition_lead_to_calling(db, lead, changed_by=f"{provider_name}_webhook")
                # Stamp research fields so SDRs have context (only if blank — EC-8)
                _stamp_aircall_direct_research(lead)

            # Track total dial attempts (outbound only) — EC-9.
            # RCA 2026-08-21 (live): this ran on every CALL_ENDED delivery,
            # not just the first -- ended_at itself is already guarded
            # against Alternate Messenger/Aircall's own documented webhook retries
            # (comment above), but this increment had no equivalent guard,
            # so a redelivered CALL_ENDED double-counted every time on its own,
            # independent of any SDR action.
            if is_outbound and not was_already_terminal:
                lead.times_called = (lead.times_called or 0) + 1
                # RCA 2026-08-31: call_routes.py's log_call (EC-13) already
                # skips its own call_attempt_count increment whenever this
                # webhook got here first (`already_counted_by_webhook`,
                # keyed off this same ended_at) — its comment assumes THIS
                # line already exists. It never did, so a webhook-first
                # Aircall call (the common case for direct/unreviewed calls)
                # incremented times_called but not call_attempt_count on
                # either path, showing as "not contacted" despite a real
                # completed call.
                lead.call_attempt_count = (lead.call_attempt_count or 0) + 1
                lead.last_call_timestamp = event.ended_at or datetime.now(timezone.utc)

    # V39/RCA 2026-08-18: auto-log outcome whenever a webhook carries tags —
    # not gated on event_type == CALL_TAGGED anymore. Confirmed live that this
    # org's Aircall account never sends a standalone call.tagged webhook; tags
    # only ever arrive inside call.ended's own payload (see aircall_provider.py's
    # handle_webhook). Gating on tags being present (idempotent — skips if
    # already logged) works regardless of which event type happens to carry them.
    auto_logged_outcome = None
    if event.tags:
        auto_logged_outcome = _auto_log_outcome(db, dialer_call, event.tags, settings)

    db.commit()

    # Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md, Phase 1 — conditional
    # branching): a lead currently parked on a "condition" node waiting for
    # a call outcome gets its early-exit signal here, after the webhook's own
    # commit — so the fresh session check_exit_triggers/execute_step opens
    # sees this durably. Best-effort: must never affect the webhook's own
    # success response, hence the broad except.
    if dialer_call.lead_id and event.event_type in (CallEventType.CALL_ANSWERED, CallEventType.CALL_ENDED):
        try:
            from journey_engine.engine import check_exit_triggers
            journey_lead = db.query(models.Lead).filter(models.Lead.id == dialer_call.lead_id).first()
            if journey_lead:
                check_exit_triggers(db, event.event_type, journey_lead, commit=True)
        except Exception as e:
            logger.error(f"[JourneyEngine] check_exit_triggers failed for webhook: {e}")

    logger.info(
        f"[DialerService] Webhook processed: event={event.event_type}, "
        f"provider_call_id={event.provider_call_id}, call_id={dialer_call.id}"
        + (f", auto_logged_outcome={auto_logged_outcome}" if auto_logged_outcome else "")
    )

    # Caller-ID lookup (v11.3.0): the matching/auto-create above already runs
    # on the FIRST webhook for a call (call.created/CALL_STARTED, not just
    # CALL_ENDED) — dialer_call.lead_id is already known by then, so identity
    # can be surfaced to the SDR while the phone is still ringing, not only
    # after it's over. Reuses the exact matching this call already went
    # through above — no separate lookup path to keep in sync.
    lead_name = None
    lead_company = None
    if dialer_call.lead_id:
        identified_lead = db.query(models.Lead).filter(models.Lead.id == dialer_call.lead_id).first()
        if identified_lead:
            lead_name = f"{identified_lead.first_name or ''} {identified_lead.last_name or ''}".strip() or None
            lead_company = identified_lead.company

    return {
        "ok":                 True,
        "event_type":         event.event_type,
        "call_id":            dialer_call.id,
        "auto_logged_outcome": auto_logged_outcome,
        # Phase 3 SSE fan-out fields
        "user_id":  dialer_call.user_id,
        "status":   event.event_type,
        "duration": dialer_call.duration,
        "direction":    dialer_call.direction,
        "lead_name":    lead_name,
        "lead_company": lead_company,
    }


def test_provider_connection(db: Session) -> dict:
    """Test the active provider's credentials."""
    provider = get_active_provider(db)
    if not provider:
        return {"success": False, "message": "No dialer provider configured"}
    return provider.test_connection()


def test_specific_provider(db: Session, provider_key: str) -> dict:
    """
    Test a named provider's credentials directly, regardless of which
    provider is currently active in settings.

    provider_key values:
      "aircall"               → Aircall API creds (dialer_api_id / dialer_api_token)
      "messenger_dialer"     → Alternate Messenger Contact Center creds (separate dialer tab)
      "messaging_provider"  → Alternate Messenger Conversations/messaging creds
    """
    from crypto import decrypt_token

    settings = _get_settings(db)

    if provider_key == "aircall":
        api_id    = settings.dialer_api_id
        api_token = settings.dialer_api_token
        if not api_id or not api_token:
            return {"success": False, "message": "Aircall credentials not configured"}
        try:
            decrypted = decrypt_token(api_token)
        except Exception:
            return {"success": False, "message": "Failed to decrypt Aircall API token"}
        return AircallDialerProvider(api_id=api_id, api_token=decrypted).test_connection()

    if provider_key == "messenger_dialer":
        base_url, api_key, user_id = _resolve_dialer_credentials(settings)
        if not api_key or not user_id:
            return {"success": False, "message": "Alternate Messenger dialer credentials not configured"}
        return AlternateDialerProvider(
            base_url=base_url, api_key=api_key, user_id=user_id, from_number=""
        ).test_connection()

    if provider_key == "messaging_provider":
        api_key  = settings.messenger_api_key or ""
        user_id  = settings.messenger_user_id or ""
        base_url = settings.messenger_base_url or "https://app.alternatecrm.com"
        if not api_key or not user_id:
            return {"success": False, "message": "Alternate Messenger messaging credentials not configured"}
        return AlternateDialerProvider(
            base_url=base_url, api_key=api_key, user_id=user_id, from_number=""
        ).test_connection()

    return {"success": False, "message": f"Unknown provider: {provider_key}"}


# ── Historical Sync ─────────────────────────────────────────────────────────

# In-memory job status (single-process safe; Render runs 1 worker)
_SYNC_JOB = {
    "running": False,
    "last_run": None,
    "result": None,
    "error": None,
}

MAX_SYNC_DAYS = 90
SUB_BATCH_DAYS = 7   # fetch + commit independently per 7-day window


def get_sync_job_status() -> dict:
    """Return current / last sync job status (safe to call from any thread)."""
    return dict(_SYNC_JOB)


def sync_historical_calls(
    db: Session,
    from_dt: datetime = None,
    to_dt: datetime = None,
) -> dict:
    """
    Pull all Aircall calls in a date window and upsert into dialer_calls.

    Rules:
    - Max window: MAX_SYNC_DAYS (90) days, enforced here.
    - Window is split into SUB_BATCH_DAYS (7-day) windows, each fetched
      from Aircall and committed independently — so a mid-sync failure
      only loses the current sub-batch, not the whole run.
    - Deduplicates by provider_call_id (EC-4)
    - Matches existing leads by phone, or auto-creates one (assigned to the
      calling SDR) when the SDR is a known Alternate CRM user — same policy as
      the Klenty nightly sync. Calls with no resolvable SDR stay unmatched.
    - Checks lead.phone AND lead.phone_secondary (EC-1)
    - Transitions Lead Assigned / Research → Calling (forward-only)
    - Increments lead.times_called for outbound CALL_ENDED (EC-9)
    - Marks source = 'aircall_direct'
    - Stamps blank research fields with 'No research done' note (EC-8)
    - Returns summary dict; never raises — sync is best-effort
    """
    now = datetime.now(timezone.utc)
    to_dt = to_dt or now
    from_dt = from_dt or (now - timedelta(days=MAX_SYNC_DAYS))

    # Ensure both datetimes are timezone-aware (defensive)
    if from_dt.tzinfo is None:
        from_dt = from_dt.replace(tzinfo=timezone.utc)
    if to_dt.tzinfo is None:
        to_dt = to_dt.replace(tzinfo=timezone.utc)

    # Cap the window
    if (to_dt - from_dt).days > MAX_SYNC_DAYS:
        from_dt = to_dt - timedelta(days=MAX_SYNC_DAYS)
        logger.warning(f"[Sync] Date window capped at {MAX_SYNC_DAYS} days: {from_dt.date()} – {to_dt.date()}")

    # Require an active Aircall provider
    provider = get_active_provider(db)
    if not provider or provider.provider_name != "aircall":
        return {"success": False, "error": "No active Aircall provider configured"}

    # ── Build 7-day sub-windows ───────────────────────────────────────────────
    # e.g. 90-day window → 13 sub-batches (12×7d + 1 tail)
    sub_windows = []
    cursor = from_dt
    while cursor < to_dt:
        window_end = min(cursor + timedelta(days=SUB_BATCH_DAYS), to_dt)
        sub_windows.append((cursor, window_end))
        cursor = window_end

    total_days = (to_dt - from_dt).days
    logger.info(
        f"[Sync] Starting {total_days}-day sync "
        f"({len(sub_windows)} sub-batches of {SUB_BATCH_DAYS}d each) "
        f"{from_dt.date()} → {to_dt.date()}"
    )

    imported = 0
    skipped_dup = 0
    unmatched = 0
    leads_updated = 0
    record_batch_size = 50   # DB commit frequency within a sub-batch

    for batch_idx, (win_start, win_end) in enumerate(sub_windows, start=1):
        logger.info(
            f"[Sync] Sub-batch {batch_idx}/{len(sub_windows)}: "
            f"{win_start.date()} → {win_end.date()}"
        )
        try:
            raw_calls = provider.fetch_calls_paginated(
                int(win_start.timestamp()), int(win_end.timestamp())
            )
        except Exception as e:
            logger.error(f"[Sync] Sub-batch {batch_idx} Aircall fetch failed: {e} — skipping")
            continue

        logger.info(f"[Sync] Sub-batch {batch_idx}: {len(raw_calls)} calls fetched")
        sub_imported = 0

        for i, call in enumerate(raw_calls):
            provider_call_id = str(call.get("id", ""))
            if not provider_call_id:
                continue

            # Extract call fields early so they are available for duration-heal below.
            duration    = call.get("duration")
            answered_at = datetime.fromtimestamp(call["answered_at"], tz=timezone.utc) if call.get("answered_at") else None
            ended_at    = datetime.fromtimestamp(call["ended_at"],    tz=timezone.utc) if call.get("ended_at")    else None

            # Deduplication (EC-4) + duration-heal
            # If the record already exists but is missing duration (webhook fired before
            # Aircall finalised billing) — heal it silently instead of skipping.
            existing = db.query(models.DialerCall).filter(
                models.DialerCall.provider_call_id == provider_call_id,
                models.DialerCall.provider == "aircall",
            ).first()
            if existing:
                healed = False
                if duration is not None and existing.duration is None:
                    existing.duration = duration
                    healed = True
                if answered_at is not None and existing.answered_at is None:
                    existing.answered_at = answered_at
                    healed = True
                if answered_at is not None and existing.provider_disposition is None:
                    existing.provider_disposition = "ANSWERED"
                    healed = True
                if ended_at is not None and existing.ended_at is None:
                    existing.ended_at = ended_at
                    healed = True
                if healed:
                    logger.info(
                        f"[Sync] Duration-healed DialerCall {existing.id} "
                        f"(call {provider_call_id}): duration={duration}s, "
                        f"answered_at={'set' if answered_at else 'n/a'}"
                    )
                skipped_dup += 1
                continue

            # Phone extraction
            raw_phone = ""
            contact = call.get("contact") or {}
            if call.get("raw_digits"):
                raw_phone = call["raw_digits"]
            elif contact.get("phone_number"):
                raw_phone = contact["phone_number"]

            direction   = call.get("direction", "outbound")
            status_str  = call.get("status", "")

            # Timestamps — always UTC-aware
            started_at  = datetime.fromtimestamp(call["started_at"],  tz=timezone.utc) if call.get("started_at")  else None
            # answered_at and ended_at already extracted above (used in heal branch)

            normalized_status = (
                CallEventType.CALL_ENDED
                if status_str in ("done", "missed", "voicemail")

                else status_str.upper()
            )

            # SDR lookup (EC-5: case-insensitive)
            user_id = None
            aircall_user = call.get("user") or {}
            user_email = aircall_user.get("email", "")
            if user_email:
                crm_user = db.query(models.User).filter(
                    func.lower(models.User.email) == user_email.lower()
                ).first()
                if crm_user:
                    user_id = crm_user.id

            # Lead matching, auto-creating on a miss when the SDR is a known
            # Alternate CRM user (EC-1)
            lead = _find_or_create_lead_by_phone(
                db, raw_phone, user_id, f"aircall_sync:{now.date().isoformat()}"
            ) if raw_phone else None
            if not lead:
                unmatched += 1
                logger.debug(f"[Sync] No match for '{raw_phone}' (call {provider_call_id}, user_id={user_id})")
                continue

            # Create DialerCall record
            db.add(models.DialerCall(
                id=str(uuid.uuid4()),
                lead_id=lead.id,
                user_id=user_id,
                provider="aircall",
                provider_call_id=provider_call_id,
                phone_number=raw_phone,
                status=normalized_status,
                direction=direction,
                duration=duration,
                started_at=started_at,
                answered_at=answered_at,
                provider_disposition="ANSWERED" if answered_at else None,
                ended_at=ended_at,
                raw_payload=json.dumps(call),
                source="aircall_direct",
            ))
            imported   += 1
            sub_imported += 1

            # Status transition (forward-only)
            if _transition_lead_to_calling(db, lead, changed_by="aircall_sync"):
                leads_updated += 1

            # Research stamp (EC-8)
            _stamp_aircall_direct_research(lead)

            # times_called — outbound only (EC-9). Also call_attempt_count
            # (RCA 2026-08-31, same gap as the live webhook path above) —
            # a nightly-synced direct Aircall call is just as real an
            # attempt as one placed through Alternate CRM.
            if direction == "outbound" and normalized_status == CallEventType.CALL_ENDED:
                lead.times_called = (lead.times_called or 0) + 1
                lead.call_attempt_count = (lead.call_attempt_count or 0) + 1

            # last_call_timestamp — normalize DB value to UTC-aware before compare
            if ended_at:
                existing_ts = lead.last_call_timestamp
                if existing_ts is not None and existing_ts.tzinfo is None:
                    existing_ts = existing_ts.replace(tzinfo=timezone.utc)
                if existing_ts is None or ended_at > existing_ts:
                    lead.last_call_timestamp = ended_at

            # Mid-sub-batch commit
            if (i + 1) % record_batch_size == 0:
                try:
                    db.commit()
                except Exception as e:
                    db.rollback()
                    logger.error(f"[Sync] Mid-batch commit failed (sub {batch_idx}, idx {i}): {e}")

        # End-of-sub-batch commit
        try:
            db.commit()
            logger.info(f"[Sync] Sub-batch {batch_idx} committed: {sub_imported} imported")
        except Exception as e:
            db.rollback()
            logger.error(f"[Sync] Sub-batch {batch_idx} final commit failed: {e}")

        # 10s cooldown between sub-batches — lets Aircall's rate-limit window reset
        # (skip on the last sub-batch to avoid unnecessary delay at the end)
        if batch_idx < len(sub_windows):
            logger.info(f"[Sync] Cooldown 10s before sub-batch {batch_idx + 1}...")
            time.sleep(10)

    result = {
        "success": True,
        "from_date": from_dt.isoformat(),
        "to_date": to_dt.isoformat(),
        "sub_batches": len(sub_windows),
        "imported": imported,
        "skipped_duplicates": skipped_dup,
        "unmatched_phone": unmatched,
        "leads_transitioned": leads_updated,
    }
    logger.info(f"[Sync] Complete: {result}")
    return result


def run_sync_in_background(db_factory, from_dt: datetime = None, to_dt: datetime = None):
    """
    Run sync_historical_calls in a background thread.
    Updates the global _SYNC_JOB status dict.
    db_factory is a callable that returns a new DB session (e.g. SessionLocal).
    """
    import threading

    if _SYNC_JOB["running"]:
        return False  # already running

    def _run():
        _SYNC_JOB["running"] = True
        _SYNC_JOB["error"] = None
        db = db_factory()
        try:
            result = sync_historical_calls(db, from_dt=from_dt, to_dt=to_dt)
            # Persist last sync timestamp
            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if settings:
                settings.aircall_last_sync_at = datetime.now(timezone.utc)
                db.commit()
            _SYNC_JOB["result"] = result
            _SYNC_JOB["last_run"] = datetime.now(timezone.utc).isoformat()
        except Exception as e:
            logger.error(f"[Sync] Background sync failed: {e}")
            _SYNC_JOB["error"] = str(e)
        finally:
            db.close()
            _SYNC_JOB["running"] = False

    t = threading.Thread(target=_run, daemon=True, name="aircall_sync")
    t.start()
    return True


def get_provider_users(db: Session) -> list[dict]:
    """Get users from the active dialer provider."""
    provider = get_active_provider(db)
    if not provider:
        return []
    return provider.get_users()


def get_provider_numbers(db: Session) -> list[dict]:
    """Get phone numbers from the active dialer provider."""
    provider = get_active_provider(db)
    if not provider:
        return []
    return provider.get_numbers()


def get_dialer_config(db: Session) -> dict:
    """Get current dialer configuration (sanitized, no secrets)."""
    settings = _get_settings(db)
    return {
        "provider": settings.dialer_provider or "none",
        # Aircall credentials present?
        "has_credentials": bool(settings.dialer_api_id and settings.dialer_api_token),
        "api_id": settings.dialer_api_id or "",
        "webhook_token": settings.dialer_webhook_token or "",
        "webhook_url_override": settings.dialer_webhook_url_override or "",
        # Alternate Messenger dialer fields
        "from_number": settings.messenger_from_number or "",
        "has_messenger_credentials": bool(
            (settings.messenger_api_key and settings.messenger_user_id) or
            (settings.dialer_api_key and settings.dialer_user_id)
        ),
        # Credential mode
        "dialer_use_shared_creds": getattr(settings, 'dialer_use_shared_creds', True),
        "dialer_base_url": getattr(settings, 'dialer_base_url', '') or "",
        "dialer_api_key": "••••" if getattr(settings, 'dialer_api_key', None) else "",
        "dialer_user_id": getattr(settings, 'dialer_user_id', '') or "",
        # V39: Aircall tag → outcome mapping (admin-configurable JSON string)
        "aircall_tag_mapping": getattr(settings, 'aircall_tag_mapping', None),
        # Klenty call-activity pull sync (temporary bridge, isolated from the
        # provider/initiate_call system above — Klenty can't place calls)
        "klenty_enabled": getattr(settings, 'klenty_enabled', False) or False,
        "has_klenty_credentials": bool(getattr(settings, 'klenty_api_key', None)),
        "klenty_last_sync_at": settings.klenty_last_sync_at.isoformat() if getattr(settings, 'klenty_last_sync_at', None) else None,
        # Instantly.ai campaign/lead-engagement pull sync (polling-only v1,
        # informational-only signals — same isolated shape as Klenty above)
        "instantly_enabled": getattr(settings, 'instantly_enabled', False) or False,
        "has_instantly_credentials": bool(getattr(settings, 'instantly_api_key', None)),
        "instantly_last_sync_at": settings.instantly_last_sync_at.isoformat() if getattr(settings, 'instantly_last_sync_at', None) else None,
        # v13.3.0: JSON list of mailbox emails campaigns may send from; NULL = all active accounts
        "instantly_sending_accounts": json.loads(settings.instantly_sending_accounts) if getattr(settings, 'instantly_sending_accounts', None) else None,
        # v13.3.0: JSON list of Instantly's own webhook object ids (one per
        # subscribed event type — Instantly has no multi-event webhook) set
        # by POST /admin/instantly/webhook/register; NULL = not registered.
        # The admin UI's "Real-time webhook" toggle reads this to show
        # registered/not-registered state.
        "instantly_webhook_id": json.loads(settings.instantly_webhook_id) if getattr(settings, 'instantly_webhook_id', None) else None,
        # v11.5.3: on/off switch for the Aircall nightly + startup catch-up sync
        "aircall_sync_enabled": getattr(settings, 'aircall_sync_enabled', True),
        "aircall_last_sync_at": settings.aircall_last_sync_at.isoformat() if getattr(settings, 'aircall_last_sync_at', None) else None,
        # V48: Aircall Everywhere (embedded browser softphone) org-wide kill switch
        "aircall_everywhere_enabled": getattr(settings, 'aircall_everywhere_enabled', False) or False,
    }



def save_dialer_config(db: Session, data: dict) -> dict:
    """Save dialer configuration. Encrypts API token before storing."""
    settings = _get_settings(db)

    provider = data.get("provider", "").lower()
    if provider and provider not in SUPPORTED_PROVIDERS and provider != "none":
        return {"success": False, "message": f"Unsupported provider: {provider}"}

    if "provider" in data:
        settings.dialer_provider = provider

    if "api_id" in data:
        settings.dialer_api_id = data["api_id"]

    if "api_token" in data and data["api_token"]:
        # Encrypt before storing
        try:
            from crypto import encrypt_token
            settings.dialer_api_token = encrypt_token(data["api_token"])
        except Exception as e:
            logger.error(f"[DialerService] Failed to encrypt API token: {e}")
            return {"success": False, "message": "Failed to encrypt API token. Check encryption key config."}

    if "webhook_token" in data:
        settings.dialer_webhook_token = data["webhook_token"]

    if "webhook_url_override" in data:
        settings.dialer_webhook_url_override = (data["webhook_url_override"] or "").strip() or None

    # Global fallback caller ID (used when SDR hasn't set their own)
    if "from_number" in data:
        settings.messenger_from_number = (data["from_number"] or "").strip() or None

    # V28: Separate dialer credentials
    if "dialer_base_url" in data:
        settings.dialer_base_url = (data["dialer_base_url"] or "").strip() or None
    if "dialer_use_shared_creds" in data:
        settings.dialer_use_shared_creds = bool(data["dialer_use_shared_creds"])
    if "dialer_user_id" in data:
        settings.dialer_user_id = data["dialer_user_id"] or None
    if "dialer_api_key" in data and data["dialer_api_key"]:
        dk_val = data["dialer_api_key"]
        if dk_val not in ("••••", "__CLEAR__"):
            try:
                from crypto import encrypt_token
                settings.dialer_api_key = encrypt_token(dk_val)
            except Exception as e:
                logger.error(f"[DialerService] Failed to encrypt dialer API key: {e}")
        elif dk_val == "__CLEAR__":
            settings.dialer_api_key = None

    # v11.5.3: Aircall nightly/startup catch-up sync on/off switch
    if "aircall_sync_enabled" in data:
        settings.aircall_sync_enabled = bool(data["aircall_sync_enabled"])

    # Klenty call-activity pull sync (isolated — never touches dialer_provider)
    if "klenty_enabled" in data:
        settings.klenty_enabled = bool(data["klenty_enabled"])
    if "klenty_api_key" in data and data["klenty_api_key"]:
        kk_val = data["klenty_api_key"]
        if kk_val not in ("••••", "__CLEAR__"):
            try:
                from crypto import encrypt_token
                settings.klenty_api_key = encrypt_token(kk_val)
            except Exception as e:
                logger.error(f"[DialerService] Failed to encrypt Klenty API key: {e}")
        elif kk_val == "__CLEAR__":
            settings.klenty_api_key = None

    # Instantly.ai campaign/lead-engagement pull sync (isolated — never
    # touches dialer_provider/SUPPORTED_PROVIDERS). Uses the transparent
    # property/setter on the model, so this just assigns plaintext — the
    # model handles encrypt-on-write itself.
    if "instantly_enabled" in data:
        settings.instantly_enabled = bool(data["instantly_enabled"])
    if "instantly_api_key" in data and data["instantly_api_key"]:
        ik_val = data["instantly_api_key"]
        if ik_val not in ("••••", "__CLEAR__"):
            try:
                settings.instantly_api_key = ik_val
            except Exception as e:
                logger.error(f"[DialerService] Failed to encrypt Instantly API key: {e}")
        elif ik_val == "__CLEAR__":
            settings.instantly_api_key = None
    if "instantly_sending_accounts" in data:
        accounts = data["instantly_sending_accounts"]
        # Empty/falsy -> NULL -> "all active accounts" (plan default), not an
        # empty-list JSON string that would mean "send from nothing".
        settings.instantly_sending_accounts = json.dumps(accounts) if accounts else None

    # V48: Aircall Everywhere org-wide kill switch
    if "aircall_everywhere_enabled" in data:
        settings.aircall_everywhere_enabled = bool(data["aircall_everywhere_enabled"])

    db.commit()
    logger.info(f"[DialerService] Config updated: provider={settings.dialer_provider}")
    return {"success": True, "message": "Dialer configuration saved successfully"}
