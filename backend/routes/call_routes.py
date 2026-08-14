# ── routes/call_routes.py — Call logging & SDR call summary ────────────────────
import json
import logging
import threading
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

import models
from models import (TERMINAL_STATUSES, ATTEMPT_OUTCOMES, LEGACY_OUTCOME_MAP,
                     DISQUALIFYING_OUTCOMES, MEETING_OUTCOMES, NOTES_REQUIRED_OUTCOMES)
from database import get_db
from auth import get_current_user, require_admin

logger = logging.getLogger(__name__)
from salesforce import get_sf_client, push_lead_to_salesforce, push_sdr_metrics_to_salesforce, lead_push_info
from routes.lead_helpers import _can_modify_lead

router = APIRouter(prefix="/api", tags=["Calls"])


def _call_to_dict(call):
    return {
        "id":        call.id,
        "lead_id":   call.lead_id,
        "user_id":   call.user_id,
        "user_name": call.user.name if call.user else "Unknown",
        "outcome":   call.outcome,
        "notes":     call.notes,
        "called_at": str(call.called_at) if call.called_at else None,
    }


def _get_settings(db):
    """Get or create the global sync/config settings row."""
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        settings = models.SyncSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

def _is_signed_url_expired(url: str) -> bool:
    """
    Return True if an AWS pre-signed URL (e.g. Aircall S3 recording) has expired.
    Parses X-Amz-Date + X-Amz-Expires directly from the URL query string.
    Falls back to True (assume expired) if the URL isn\'t a signed AWS URL.
    """
    try:
        from urllib.parse import urlparse, parse_qs
        params = parse_qs(urlparse(url).query)
        amz_date = params.get("X-Amz-Date", [None])[0]
        amz_expires = params.get("X-Amz-Expires", [None])[0]
        if not amz_date or not amz_expires:
            return True  # Not a signed URL or missing params — assume expired
        from datetime import datetime, timezone, timedelta
        signed_at = datetime.strptime(amz_date, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        expiry = signed_at + timedelta(seconds=int(amz_expires))
        return datetime.now(timezone.utc) >= expiry
    except Exception:
        return True  # Parse failure — assume expired to be safe


def _create_meeting_calendar_event(db, lead, user, mailbox, body):
    """Creates a real Nylas calendar event + invite for a just-confirmed
    meeting. Returns (created: bool, error: str or None) — never raises;
    a failure here must never lose the CRM update that already happened
    (lead.status/meeting_scheduled_at are already committed by the caller).
    """
    from crypto import decrypt_token
    from nylas_calendar import (
        get_primary_calendar_id, create_event, NylasCalendarError,
    )

    config = db.query(models.NylasConfig).filter(
        models.NylasConfig.id == 1, models.NylasConfig.is_active == True
    ).first()
    if not config or not config.api_key_encrypted:
        return False, "Nylas is not configured"

    try:
        api_key = decrypt_token(config.api_key_encrypted)
        calendar_id = get_primary_calendar_id(mailbox.nylas_grant_id, api_key)
        if not calendar_id:
            return False, "No calendar found on the connected mailbox"

        duration_minutes = body.get("meeting_duration_minutes", 30)
        try:
            duration_minutes = int(duration_minutes)
        except (TypeError, ValueError):
            duration_minutes = 30
        duration_minutes = max(5, min(480, duration_minutes))

        start_ts = int(lead.meeting_scheduled_at.timestamp())
        end_ts = start_ts + duration_minutes * 60
        full_name = " ".join(filter(None, [lead.first_name, lead.last_name]))
        guest_emails = [e for e in (body.get("meeting_guest_emails") or []) if isinstance(e, str) and e.strip()]

        custom_title = (body.get("meeting_title") or "").strip()
        custom_agenda = (body.get("meeting_agenda") or "").strip()
        title = custom_title or f"Meeting: {full_name} ({lead.company or 'Unknown'})"
        attribution = f"Booked via RCM by {user.get('name') or user.get('email')}"
        description = f"{custom_agenda}\n\n— {attribution}" if custom_agenda else attribution

        event = create_event(
            mailbox.nylas_grant_id, api_key, calendar_id,
            title=title,
            description=description,
            start_ts=start_ts, end_ts=end_ts,
            participant_email=lead.email or None, participant_name=full_name or None,
            extra_emails=guest_emails,
        )
        lead.nylas_event_id = event.get("id")
        lead.calendar_event_url = event.get("html_link")
        lead.calendar_event_title = title
        lead.calendar_event_agenda = custom_agenda or None
        db.commit()
        return True, None
    except Exception as e:
        if isinstance(e, NylasCalendarError) and e.status_code == 401:
            # Grant revoked/expired at the provider — mark it now so the next
            # attempt hard-blocks cleanly instead of failing softly forever.
            mailbox.status = "error"
            db.commit()
        logger.warning(f"[CallLog] Calendar event creation failed for lead {lead.id}: {e}")
        return False, str(e)


def _transcript_eligible(c) -> bool:
    """Same eligibility the provider itself uses to skip transcription
    (duration >= 5s, call was answered) — no point re-checking a call
    that will never have one."""
    return (
        c.transcript is None
        and c.duration is not None and c.duration >= 5
        and c.answered_at is not None
    )


def _needs_call_update(c) -> bool:
    """True if this DialerCall has anything worth re-fetching from the provider."""
    url_expired = c.recording_url and _is_signed_url_expired(c.recording_url)
    needs_refresh = not c.recording_url or url_expired
    needs_duration = c.duration is None or c.ended_at is None
    # RCA 2026-07-22: transcription is generated asynchronously (Deepgram STT,
    # seconds-to-minutes after the call ends) — by the time recording_url/
    # duration/ended_at are already backfilled, this used to skip the transcript
    # check entirely, even though the provider API already includes it in the
    # same response.
    return needs_refresh or needs_duration or _transcript_eligible(c)


def _fetch_call_update_data(c, provider) -> Optional[dict]:
    """
    Hit the provider API for fresh call data, if this record needs it.
    Deliberately takes no `db` — RCA 2026-07-27: RCM's 502-retry loop
    (`time.sleep(1)`, `time.sleep(2)`, ...) runs synchronously and can take
    several seconds per call during a RCM brownout. The batch refresh
    in activity_feed_routes.py used to hold a DB session (a pooled connection)
    for the whole loop while doing this, and under load that starved the pool
    enough to make unrelated requests (e.g. dashboard-stats) time out. Fetch
    first with no connection held, write later in a short-lived session.
    """
    if not provider or not hasattr(provider, 'fetch_call') or not c.provider_call_id:
        return None
    if not _needs_call_update(c):
        return None
    try:
        return provider.fetch_call(c.provider_call_id) or None
    except Exception as e:
        logger.warning(f"[CallRoutes] fetch_call failed for {c.id}: {e}")
        return None


def _apply_call_update_data(c, call_data: dict, db) -> None:
    """Write already-fetched provider call data onto a DialerCall row. Commits on change."""
    try:
        changed = False

        # Backfill recording URL
        url_expired = c.recording_url and _is_signed_url_expired(c.recording_url)
        if (not c.recording_url or url_expired) and call_data.get("recording_url"):
            if c.recording_url != call_data["recording_url"]:
                logger.info(f"[CallRoutes] Refreshed recording URL for call {c.provider_call_id}")
            c.recording_url = call_data["recording_url"]
            changed = True

        # Backfill duration when disconnect webhook was missed
        if c.duration is None and call_data.get("duration") is not None:
            try:
                c.duration = int(call_data["duration"])
                logger.info(
                    f"[CallRoutes] Backfilled duration={c.duration}s for call {c.provider_call_id} "
                    f"(disconnect webhook was missed)"
                )
                changed = True
            except (ValueError, TypeError):
                pass

        # Backfill ended_at when disconnect webhook was missed
        if c.ended_at is None and call_data.get("ended_at"):
            from datetime import datetime, timezone
            try:
                raw = call_data["ended_at"]
                if isinstance(raw, str):
                    ended = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                    c.ended_at = ended.astimezone(timezone.utc).replace(tzinfo=None)
                    logger.info(
                        f"[CallRoutes] Backfilled ended_at for call {c.provider_call_id}"
                    )
                    changed = True
            except Exception:
                pass

        # Backfill transcript once Deepgram STT finishes (async, provider-side)
        if c.transcript is None and call_data.get("transcription"):
            try:
                c.transcript = json.dumps(call_data["transcription"])
                logger.info(f"[CallRoutes] Backfilled transcript for call {c.provider_call_id}")
                changed = True
            except (TypeError, ValueError):
                pass

        if changed:
            db.commit()
    except Exception as e:
        logger.warning(f"[CallRoutes] _apply_call_update_data failed for {c.id}: {e}")


def _refresh_recording_url(c, provider, db) -> None:
    """
    Re-fetch a fresh pre-signed recording URL for a DialerCall record if
    the stored URL is missing or has expired. Also backfills duration and
    ended_at from the provider API when they are null (missed disconnect
    webhook). Commits to DB on change.
    Safe to call from any endpoint — catches all exceptions silently.
    Works for both Aircall and RCM providers.

    Convenience wrapper combining fetch + write. Fine for the low-volume,
    single-call sites (below). For a batch, prefer calling
    _fetch_call_update_data/_apply_call_update_data separately so the DB
    session is only opened for the (fast) write, not the (slow) provider call.
    """
    if not provider or not hasattr(provider, 'fetch_call'):
        if c.provider:  # only log when we expected a provider but got None (missing creds)
            logger.debug(
                f"[CallRoutes] No '{c.provider}' provider instance — skipping recording "
                f"refresh for DialerCall {c.id} (credentials may be missing in SyncSettings)"
            )
        return
    call_data = _fetch_call_update_data(c, provider)
    if call_data:
        _apply_call_update_data(c, call_data, db)



@router.get("/call-outcomes")
def get_call_outcomes(db: Session = Depends(get_db)):
    """Return configurable call outcome definitions for the frontend."""
    config = models.get_outcome_config(db)
    return {
        "outcomes": config,
        "enabled_outcomes": [o for o in config if o["enabled"]]
    }


@router.post("/leads/{lead_id}/calls")
def log_call(lead_id: str, body: dict, bg_tasks: BackgroundTasks, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Log a call outcome. Works alongside dialer — dialer tracks call events,
    while this endpoint records the SDR's chosen outcome and triggers status transitions."""

    lead = _can_modify_lead(db, user, lead_id)
    settings = _get_settings(db)

    outcome_str = body.get("outcome", "")

    # Map legacy outcome values to new ones for backward compatibility
    if outcome_str in LEGACY_OUTCOME_MAP:
        outcome_str = LEGACY_OUTCOME_MAP[outcome_str]

    # Validate against configurable outcome list (not hardcoded enum)
    valid_outcomes = models.get_valid_outcomes(db)
    if outcome_str not in valid_outcomes:
        raise HTTPException(status_code=400, detail=f"Invalid outcome. Must be one of: {sorted(valid_outcomes)}")

    # Look up outcome config for action, notes_required, etc.
    outcome_cfg = models.get_outcome_by_value(outcome_str, db)

    notes = body.get("notes", "").strip()

    # Config-driven mandatory notes enforcement
    if outcome_cfg and outcome_cfg.get("notes_required") and not notes:
        raise HTTPException(status_code=422, detail=f"Notes are mandatory when call outcome is '{outcome_str}'.")

    # Real Nylas calendar event requires the submitting user's own connected
    # mailbox (same grant used for email) — hard-block before any write, same
    # fail-fast style as the checks above. Whoever submits the outcome gets
    # the event on THEIR calendar (matches Salesforce push / activity logging,
    # which already use the submitting user's identity, not the lead's owner).
    outcome_action = outcome_cfg.get("action", "none") if outcome_cfg else "none"
    mailbox = None
    if outcome_action == "meeting_scheduled":
        mailbox = db.query(models.UserMailbox).filter(
            models.UserMailbox.user_id == user["sub"],
            models.UserMailbox.status == "connected",
        ).first()
        if not mailbox:
            raise HTTPException(
                status_code=400,
                detail="Connect your email in Settings before logging a Meeting Booked outcome.",
            )

    # ── Attach outcome to existing DialerCall (no duplicate CallLog) ──────
    # Prefer exact lookup by dialer_call_id when the frontend provides it —
    # this happens when the outcome gate modal was triggered by the dialer.
    # Falls back to a 30-minute time-window heuristic for older clients.
    from datetime import timedelta
    dialer_call_id_hint = body.get("dialer_call_id")
    recent_dialer_call = None

    if dialer_call_id_hint:
        # Exact lookup — the frontend tells us which DialerCall to update
        exact = db.query(models.DialerCall).filter(
            models.DialerCall.id == dialer_call_id_hint,
            models.DialerCall.lead_id == lead_id,
        ).first()
        if exact and exact.outcome is None:
            # Only attach if outcome hasn't been set yet (idempotency guard)
            recent_dialer_call = exact
            logger.info(f"[CallLog] Exact DialerCall match via dialer_call_id hint: {dialer_call_id_hint}")
        elif exact and exact.outcome is not None:
            logger.warning(
                f"[CallLog] DialerCall {dialer_call_id_hint} already has outcome '{exact.outcome}' — "
                "creating manual CallLog to avoid overwrite."
            )

    if recent_dialer_call is None:
        # Fallback: find an unlogged dialer call for this lead within 30 min
        # (extended from 10 min to handle longer calls / slow webhooks)
        recent_cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
        recent_dialer_call = db.query(models.DialerCall).filter(
            models.DialerCall.lead_id == lead_id,
            models.DialerCall.user_id == user["sub"],
            models.DialerCall.status != "FAILED",
            models.DialerCall.outcome.is_(None),  # not already logged
            models.DialerCall.created_at >= recent_cutoff,
        ).order_by(models.DialerCall.created_at.desc()).first()

    attached_to_dialer = False
    if recent_dialer_call:
        # Attach outcome + notes to the existing Aircall record
        recent_dialer_call.outcome = outcome_str
        recent_dialer_call.notes = notes
        attached_to_dialer = True
        call = recent_dialer_call  # use for response
        logger.info(f"[CallLog] Attached outcome '{outcome_str}' to DialerCall {recent_dialer_call.id}")
    else:
        # No recent Aircall call — create a standard manual CallLog
        # Use CallOutcome enum if available, fall back to raw string for custom outcomes
        try:
            outcome_enum = models.CallOutcome(outcome_str)
        except ValueError:
            outcome_enum = outcome_str  # custom outcome — store as raw string
        call = models.CallLog(
            lead_id=lead_id,
            user_id=user["sub"],
            outcome=outcome_enum,
            notes=notes
        )
        db.add(call)

    # Update last_call_timestamp on the lead
    lead.last_call_timestamp = datetime.now(timezone.utc)

    # EC-13: Only increment call_attempt_count if this is a manual call OR if the
    # DialerCall record has NOT yet been finalized by a webhook (ended_at is None).
    # When the Aircall webhook fires CALL_ENDED it already increments the counter
    # in dialer_service.handle_webhook → double-counting is prevented here.
    already_counted_by_webhook = (
        attached_to_dialer
        and recent_dialer_call is not None
        and recent_dialer_call.ended_at is not None  # webhook already fired + set ended_at
    )
    if outcome_str in ATTEMPT_OUTCOMES and not already_counted_by_webhook:
        lead.call_attempt_count = (lead.call_attempt_count or 0) + 1
        logger.info(
            f"[CallLog] Incremented call_attempt_count for lead {lead_id} "
            f"(attached_to_dialer={attached_to_dialer}, already_counted={already_counted_by_webhook})"
        )

    # Always increment times_called for any outbound RCM call (EC-9: unified counter)
    lead.times_called = (lead.times_called or 0) + 1

    # ── Auto-deprioritisation (V22) ───────────────────────────────────────
    # Count how many times this lead has been called today (across CallLog + DialerCall).
    # We do this BEFORE the commit so existing rows are accurate.
    from datetime import date
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
    calls_today = db.query(models.CallLog).filter(
        models.CallLog.lead_id == lead_id,
        models.CallLog.called_at >= today_start,
    ).count()
    # +1 to account for the call we're about to commit (not yet in DB)
    if not attached_to_dialer:
        calls_today += 1
    # Only lower priority; never automatically raise it (that's manual)
    if calls_today >= 2:
        new_priority = 25   # Deprioritized
    elif calls_today == 1:
        new_priority = 50   # Medium
    else:
        new_priority = None
    if new_priority is not None and hasattr(lead, 'priority_score'):
        current_priority = lead.priority_score if lead.priority_score is not None else 100
        if new_priority < current_priority:  # only ever lower automatically
            lead.priority_score = new_priority

    db.commit()
    db.refresh(call)
    db.refresh(lead)

    # ── Config-driven auto-status transitions based on outcome ────────────
    # (outcome_action already resolved above, alongside the mailbox hard-block)
    new_status = None
    is_confirmed_meeting = False
    calendar_event_created = False
    calendar_error = None

    # Auto-disqualify if outcome action is "disqualify"
    if outcome_action == "disqualify" and lead.status not in TERMINAL_STATUSES:
        new_status = "Disqualified"

    # Auto-promote to Meeting Scheduled if outcome action is "meeting_scheduled"
    elif outcome_action == "meeting_scheduled" and lead.status != "Meeting Scheduled":
        new_status = "Meeting Scheduled"
        is_confirmed_meeting = True

    # BUG-8: "Mark Meeting Complete" — advances lead and increments discovery_meeting_count
    # Eligible: Meeting Scheduled → 1st Discovery Meeting, or 1st Discovery Meeting / Demo Scheduled (already at meeting stage)
    elif outcome_action == "meeting_complete" and lead.status in ("Meeting Scheduled", "1st Discovery Meeting", "Demo Scheduled"):
        lead.discovery_meeting_count = (lead.discovery_meeting_count or 0) + 1
        if lead.status == "Meeting Scheduled":
            new_status = "1st Discovery Meeting"
        # For 1st Discovery Meeting / Demo Scheduled: count increments but status stays

    # BUG-10: "Demo Failed" — routes to Pending Review for Pod Admin to re-route
    elif outcome_action == "pending_review" and lead.status in ("Demo Scheduled", "Demo Done"):
        new_status = "Pending Review"

    if new_status:
        old_status = lead.status
        lead.status = new_status
        lead.status_changed_at = datetime.now(timezone.utc)
        models.log_status_change(db, lead.id, old_status, new_status, user.get("name") or user.get("email", "unknown"))

        # Unified calendar: capture the real meeting date/time the SDR entered.
        # Optional field — omitted/absent is a no-op so existing callers (e.g.
        # Salesforce sync) that don't send it keep working unchanged.
        if is_confirmed_meeting and body.get("meeting_datetime"):
            try:
                # JS's toISOString() always ends in "Z", which datetime.fromisoformat()
                # cannot parse before Python 3.11 (prod runs 3.10) — same fix as the
                # /leads/meetings GET endpoint (RCA-2026-07-14), never ported here.
                # Without it this always raised, was silently caught, and
                # meeting_scheduled_at was never actually written.
                lead.meeting_scheduled_at = datetime.fromisoformat(
                    body["meeting_datetime"].replace("Z", "+00:00")
                )
            except (ValueError, TypeError):
                logger.warning(f"[CallLog] Invalid meeting_datetime for lead {lead_id}: {body.get('meeting_datetime')!r}")
            else:
                # `mailbox` was already resolved (and hard-blocked-on-missing) above.
                calendar_event_created, calendar_error = _create_meeting_calendar_event(
                    db, lead, user, mailbox, body
                )

        # Set closed fields for disqualification and other terminal statuses
        if new_status in TERMINAL_STATUSES or new_status == "Disqualified":
            lead.lead_closed_at = datetime.now(timezone.utc)
            lead.closed_reason = outcome_str

        db.commit()
        db.refresh(lead)

        # Push status update to SF for Meeting Scheduled
        if new_status == "Meeting Scheduled":
            _push_sf_status(lead, new_status, db)

        # Push disqualification to SF — but NOT for "Left the Company" (no downstream value)
        if new_status == "Disqualified" and outcome_str != "Left the Company":
            if settings.sync_declined_to_salesforce:
                _push_sf_disqualification(lead, outcome_str, db)

    # Sync metrics to Salesforce in background
    bg_tasks.add_task(_push_call_metrics, user["sub"], db)

    # Build response with attempt limit info
    max_attempts = settings.max_call_attempts or 5
    current_attempts = lead.call_attempt_count or 0

    # Activity log: LOG_CALL + SCHEDULE_MEETING if meeting was booked
    try:
        from activity_logger import log_activity
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        log_activity(user["sub"], "LOG_CALL",
                     user_email=user.get("email"), user_name=user.get("name"),
                     object_type="call", object_id=call.id,
                     metadata={"lead_name": lead_name, "outcome": outcome_str})
        # Emit SCHEDULE_MEETING when call outcome triggers Meeting Scheduled
        if is_confirmed_meeting and new_status == "Meeting Scheduled":
            log_activity(user["sub"], "SCHEDULE_MEETING",
                         user_email=user.get("email"), user_name=user.get("name"),
                         object_type="lead", object_id=lead.id,
                         metadata={"lead_name": lead_name})
    except Exception:
        pass

    # Build response — handle both DialerCall and CallLog objects
    if attached_to_dialer:
        call_response = {
            "id":        call.id,
            "lead_id":   call.lead_id,
            "user_id":   call.user_id,
            "user_name": user.get("name", "Unknown"),
            "outcome":   call.outcome,
            "notes":     call.notes,
            "called_at": call.started_at.isoformat() if call.started_at else (call.created_at.isoformat() if call.created_at else None),
            "attached_to_dialer": True,
        }
    else:
        call_response = _call_to_dict(call)

    # Check company resolution after logging this call
    company_resolved = None
    if outcome_str in ("Meeting Scheduled", "Meeting Confirmed"):
        from routes.lead_helpers import _batch_company_resolutions
        company_resolved = _batch_company_resolutions(db, [lead])[lead.id]
        # Count how many other contacts at same company exist
        company = (lead.company or "").strip()
        if company:
            sibling_count = db.query(models.Lead).filter(
                func.lower(func.trim(models.Lead.company)) == company.lower(),
                models.Lead.id != lead.id,
            ).count()
        else:
            sibling_count = 0

    return {
        "call": call_response,
        "lead_status": lead.status,
        "call_attempt_count": current_attempts,
        "max_call_attempts": max_attempts,
        "max_attempts_reached": current_attempts >= max_attempts,
        "company_resolved_count": sibling_count if outcome_str in ("Meeting Scheduled", "Meeting Confirmed") else None,
        "calendar_event_created": calendar_event_created,
        "calendar_error": calendar_error,
    }


def _push_sf_status(lead, status, db=None):
    """Push status update to SF for existing leads (background thread)."""
    sf_lead_id = lead.sf_lead_id
    if sf_lead_id and not sf_lead_id.startswith("upload-") and not sf_lead_id.startswith("manual-"):
        lead_info = lead_push_info(lead, db)
        def _sf_push():
            try:
                sf_client = get_sf_client()
                if sf_client:
                    push_lead_to_salesforce(sf_client, sf_lead_id, {"status": status}, lead_info=lead_info)
                    logger.info(f"[SF Push] Call → '{status}' for SF lead {sf_lead_id}")
            except Exception as e:
                logger.error(f"[SF Push] Call status push failed for {sf_lead_id}: {e}")
        threading.Thread(target=_sf_push, daemon=True).start()


def _push_sf_disqualification(lead, reason, db=None):
    """Push disqualification to SF for existing leads (background thread)."""
    sf_lead_id = lead.sf_lead_id
    if sf_lead_id and not sf_lead_id.startswith("upload-") and not sf_lead_id.startswith("manual-"):
        lead_info = lead_push_info(lead, db)
        def _sf_push():
            try:
                sf_client = get_sf_client()
                if sf_client:
                    push_lead_to_salesforce(sf_client, sf_lead_id, {
                        "status": "Disqualified",
                        "disqualification_reason": reason,
                    }, lead_info=lead_info)
                    logger.info(f"[SF Push] Disqualified → '{reason}' for SF lead {sf_lead_id}")
            except Exception as e:
                logger.error(f"[SF Push] Disqualification push failed for {sf_lead_id}: {e}")
        threading.Thread(target=_sf_push, daemon=True).start()


def _push_call_metrics(user_id: str, db: Session):
    """Push SDR call metrics to Salesforce."""
    from datetime import date
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user or not db_user.sf_sdr_id:
        return
    today_start = datetime.combine(date.today(), datetime.min.time())
    # Push date filter into SQL — avoids fetching ALL lifetime call logs into Python
    from sqlalchemy import func as _func
    calls_today_count = (
        db.query(_func.count(models.CallLog.id))
        .filter(
            models.CallLog.user_id == user_id,
            models.CallLog.called_at >= today_start,
        )
        .scalar() or 0
    )
    metrics = {"calls_today": calls_today_count, "total_leads": len(db_user.assigned_leads)}
    sf = get_sf_client()
    if sf:
        push_sdr_metrics_to_salesforce(sf, db_user, metrics)



# ── Add Discovery Meeting ─────────────────────────────────────────────────────

@router.post("/leads/{lead_id}/add-discovery")
def add_discovery_meeting(lead_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Log an additional discovery meeting for a lead.
    - Transitions 'Meeting Scheduled' → '1st Discovery Meeting' on the first call.
    - Increments discovery_meeting_count on subsequent calls.
    - Lead must be in '1st Discovery Meeting' or 'Meeting Scheduled' status.
    - For N+1 calls (count >= 1): requires an outcome to have been logged since
      the lead entered '1st Discovery Meeting' (gate for EC-2; EC-1 is exempt).
    """
    lead = _can_modify_lead(db, user, lead_id)

    ELIGIBLE_STATUSES = {"Meeting Scheduled", "1st Discovery Meeting"}
    if lead.status not in ELIGIBLE_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Discovery meeting can only be logged for leads in {sorted(ELIGIBLE_STATUSES)} status. Current: {lead.status}"
        )

    # ── Gate: require an outcome for the current call before adding another ──
    # EC-1: First call (count = 0 → 1) is always allowed — no gate.
    # EC-14: NULL status_changed_at → treat as epoch (datetime.min) → allow.
    current_count = lead.discovery_meeting_count or 0
    if current_count >= 1:
        since = lead.status_changed_at
        if since is None:
            since = datetime.min.replace(tzinfo=timezone.utc)
        elif since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)

        # Check manual CallLog entries (EC-4)
        has_call_outcome = db.query(models.CallLog).filter(
            models.CallLog.lead_id == lead_id,
            models.CallLog.called_at >= since,
        ).first()

        # Check Aircall / RCM DialerCall entries with a resolved outcome (EC-3)
        if not has_call_outcome:
            has_call_outcome = db.query(models.DialerCall).filter(
                models.DialerCall.lead_id == lead_id,
                models.DialerCall.started_at >= since,
                models.DialerCall.outcome.isnot(None),
            ).first()

        if not has_call_outcome:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Please log an outcome for Call {current_count} before adding "
                    f"another discovery call."
                )
            )

    old_status = lead.status
    lead.discovery_meeting_count = current_count + 1

    # First discovery meeting: advance status
    if lead.status == "Meeting Scheduled":
        lead.status = "1st Discovery Meeting"
        lead.status_changed_at = datetime.now(timezone.utc)
        models.log_status_change(db, lead.id, old_status, "1st Discovery Meeting",
                                 user.get("name") or user.get("email", "unknown"))

    db.commit()
    db.refresh(lead)

    try:
        from activity_logger import log_activity
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        log_activity(user["sub"], "ADD_DISCOVERY",
                     user_email=user.get("email"), user_name=user.get("name"),
                     object_type="lead", object_id=lead_id,
                     metadata={"lead_name": lead_name, "discovery_count": lead.discovery_meeting_count})
    except Exception:
        pass

    return {
        "ok": True,
        "discovery_meeting_count": lead.discovery_meeting_count,
        "lead_status": lead.status,
    }



@router.post("/leads/{lead_id}/close")
def close_lead(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Explicitly close/disqualify a lead from Calling status.
    Requires a reason and validates that sufficient attempts were made or a definitive outcome exists."""
    lead = _can_modify_lead(db, user, lead_id)
    settings = _get_settings(db)

    reason = body.get("reason", "").strip()
    # Derive VALID_REASONS from config: terminal outcomes + hardcoded extras
    config = models.get_outcome_config(db)
    VALID_REASONS = {o["value"] for o in config if o["group"] == "terminal"}
    VALID_REASONS.update({"No Phone Number", "Other"})  # Always-valid extras
    if reason not in VALID_REASONS:
        raise HTTPException(status_code=400, detail=f"Invalid reason. Must be one of: {sorted(VALID_REASONS)}")

    if lead.status != "Calling":
        raise HTTPException(status_code=422, detail=f"Lead must be in 'Calling' status to close. Current status: {lead.status}")

    # Bypass call-attempt validation for leads with no phone number
    lead_has_phone = bool((lead.phone or "").strip()) or bool((getattr(lead, 'phone_secondary', None) or "").strip())
    skip_call_check = (reason == "No Phone Number" and not lead_has_phone)

    if reason == "No Phone Number" and lead_has_phone:
        raise HTTPException(status_code=422, detail="Cannot use 'No Phone Number' reason — this lead has a phone number on file.")

    if not skip_call_check:
        # Check if closure is allowed
        current_attempts = lead.call_attempt_count or 0
        max_attempts = settings.max_call_attempts or 5

        # Allow closure if: (1) max attempts reached, OR (2) a definitive outcome was logged
        # Derive definitive outcomes from config: all terminal group outcomes
        DEFINITIVE_OUTCOMES = {o["value"] for o in config if o["group"] == "terminal"}
        has_definitive = db.query(models.CallLog).filter(
            models.CallLog.lead_id == lead_id,
            models.CallLog.outcome.in_(DEFINITIVE_OUTCOMES)
        ).first() is not None or db.query(models.DialerCall).filter(
            models.DialerCall.lead_id == lead_id,
            models.DialerCall.outcome.in_(DEFINITIVE_OUTCOMES)
        ).first() is not None

        if current_attempts < max_attempts and not has_definitive:
            raise HTTPException(
                status_code=422,
                detail=f"Cannot close yet. Either reach {max_attempts} call attempts ({current_attempts} so far) or log a definitive outcome (Wrong Number, Not Interested, or Unreachable)."
            )

    # Close the lead
    models.disqualify_lead(db, lead, reason, user.get("name") or user.get("email", "unknown"))

    db.commit()
    db.refresh(lead)

    # Push disqualification to Salesforce if enabled
    if reason in ("Not Interested",) and settings.sync_declined_to_salesforce:
        _push_sf_disqualification(lead, reason, db)
    elif reason in ("Unreachable", "Wrong Number") and settings.sync_unreachable_to_salesforce:
        _push_sf_disqualification(lead, reason, db)

    return {"message": f"Lead closed as Disqualified: {reason}", "lead_status": lead.status, "closed_reason": reason}


@router.delete("/leads/{lead_id}/calls/{call_id}")
def delete_call_log(lead_id: str, call_id: str, db: Session = Depends(get_db)):
    call = db.query(models.CallLog).filter(
        models.CallLog.id == call_id, models.CallLog.lead_id == lead_id
    ).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call log not found")
    db.delete(call)
    db.commit()
    return {"ok": True}


@router.get("/leads/{lead_id}/calls")
def get_lead_calls(
    lead_id: str,
    page:  int = 1,
    limit: int = 10,
    db: Session = Depends(get_db),
):
    """
    Return call logs for a lead — merging manual CallLog records and
    dialer DialerCall records in chronological order (newest first).

    Supports async pagination: page + limit query params.
    Stats (total, connected, avg_duration, last_called) are always
    computed from the full dataset regardless of page.
    """
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # ── Manual call logs ─────────────────────────────────────────────────
    manual = db.query(models.CallLog).filter(models.CallLog.lead_id == lead_id).all()
    manual_rows = [
        {
            "id":            c.id,
            "source":        "manual",
            "provider":      "manual",
            "outcome":       c.outcome.value if hasattr(c.outcome, 'value') else c.outcome,
            "notes":         c.notes,
            "duration":      0,
            "direction":     "outbound",
            "phone_number":  None,
            "recording_url": None,
            "transcript":    None,
            "status":        None,
            "called_at":     c.called_at.isoformat() if c.called_at else None,
            "created_at":    c.called_at.isoformat() if c.called_at else None,
            "user_name":     c.user.name if c.user else None,
            "_sort_ts":      c.called_at,
        }
        for c in manual
    ]

    # ── Dialer calls — refresh recording URLs using the correct per-call provider ──
    # Each DialerCall.provider may be 'aircall' or 'rcm'. Using a single
    # global provider (get_active_provider) caused RCM calls to silently
    # use the Aircall client — their recording_url was never fetched. We now build
    # a per-provider cache so each call uses its own matching provider instance.
    #
    # PERF FIX (v8.9.9): _refresh_recording_url is now fire-and-forget in background threads.
    # When RCM has upstream issues (502s), the retry loop previously blocked
    # the response for 3–4 seconds. Now we return DB-cached state immediately and
    # let recording URLs update in the background (visible on next page load).
    dialer_rows = []
    try:
        import dialer_service
        _provider_cache: dict = {}
        dialer = db.query(models.DialerCall).filter(models.DialerCall.lead_id == lead_id).all()
        for c in dialer:
            pname = (c.provider or "").lower()
            if pname and pname not in _provider_cache:
                _provider_cache[pname] = dialer_service.get_provider_by_name(pname, db)

        # Kick off recording URL refresh in the background — truly fire-and-forget.
        # Each thread opens its OWN DB session to avoid SQLAlchemy thread-safety violations.
        # The main request thread reads c.recording_url from the already-committed row
        # and returns immediately. Fresh URLs are committed by background threads and
        # visible on the NEXT page load (acceptable UX — avoids 3-4s RCM 502 hangs).
        def _refresh_in_own_session(call_id: str, provider) -> None:
            """Open a fresh DB session, re-fetch the DialerCall, refresh URL, commit, close."""
            try:
                from database import SessionLocal
                _db = SessionLocal()
                try:
                    _call = _db.query(models.DialerCall).filter(models.DialerCall.id == call_id).first()
                    if _call:
                        _refresh_recording_url(_call, provider, _db)
                finally:
                    _db.close()
            except Exception:
                pass  # Best-effort — never crash the request

        for c in dialer:
            pname = (c.provider or "").lower()
            prov = _provider_cache.get(pname)
            # Only spawn a thread if there's a provider + a provider_call_id to refresh from.
            # EC-17: Skip refresh if call already has all data — avoids 502 log storms
            # from RCM when SDRs open the Calls tab on leads with many call records.
            # _refresh_recording_url already checks this internally, but checking here
            # avoids spawning a thread + DB session + API hit entirely.
            if prov and c.provider_call_id:
                url_needs_refresh = (
                    not c.recording_url
                    or _is_signed_url_expired(c.recording_url)
                )
                data_needs_refresh = (c.duration is None or c.ended_at is None)
                transcript_needs_refresh = _transcript_eligible(c)
                # Only refresh terminal calls — non-terminal calls aren't ready yet
                # (CALL_STARTED / CALL_ANSWERED) and will be updated via webhook.
                _TERMINAL = {"CALL_ENDED", "CALL_FAILED", "FAILED", "completed",
                             "failed", "cancelled", "no_answer", "busy"}
                is_terminal = c.status in _TERMINAL
                if is_terminal and (url_needs_refresh or data_needs_refresh or transcript_needs_refresh):
                    threading.Thread(
                        target=_refresh_in_own_session,
                        args=(c.id, prov),
                        daemon=True,
                    ).start()

        for c in dialer:
            user_name = None
            if c.user_id:
                u = db.query(models.User).filter(models.User.id == c.user_id).first()
                if u:
                    user_name = u.name
            dialer_rows.append({
                "id":            c.id,
                "source":        "dialer",
                "provider":      c.provider or "dialer",
                "outcome":       c.outcome,
                "notes":         c.notes,
                "duration":      c.duration,  # keep null — frontend renders '—' for unknown duration
                "direction":     c.direction or "outbound",
                "phone_number":  c.phone_number,
                "recording_url": c.recording_url,
                "transcript":    c.transcript,
                "status":        c.status,
                "called_at":     c.started_at.isoformat() if c.started_at else (c.created_at.isoformat() if c.created_at else None),
                "created_at":    c.created_at.isoformat() if c.created_at else None,
                "user_name":     user_name,
                "_sort_ts":      c.started_at or c.created_at,
            })
    except Exception:
        pass  # DialerCall table may not exist in older deployments

    # Sort newest first, then strip internal key
    all_calls = manual_rows + dialer_rows
    all_calls.sort(key=lambda c: c.get("_sort_ts") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    for c in all_calls:
        c.pop("_sort_ts", None)

    # ── Compute stats from full dataset (not paginated) ───────────────────
    total = len(all_calls)
    CONNECTED_OUTCOMES = {
        "Interested", "Meeting Scheduled", "Meeting Confirmed",
        "Call Back Later", "Text Me", "Not the Right Person", "Referred Someone Else"
    }
    connected = sum(
        1 for c in all_calls
        if c.get("outcome") in CONNECTED_OUTCOMES or c.get("status") == "CALL_ANSWERED"
    )
    known_durations = [c.get("duration") for c in all_calls if c.get("duration") is not None]
    avg_duration = (sum(known_durations) // len(known_durations)) if known_durations else None
    last_called = all_calls[0].get("called_at") if all_calls else None

    # ── Paginate ──────────────────────────────────────────────────────────
    limit   = max(1, min(limit, 100))   # clamp: 1–100
    page    = max(1, page)
    offset  = (page - 1) * limit
    page_calls = all_calls[offset: offset + limit]
    has_more   = (offset + limit) < total

    return {
        "calls":       page_calls,
        "has_more":    has_more,
        "total_count": total,
        "page":        page,
        "limit":       limit,
        "stats": {
            "total":        total,
            "connected":    connected,
            "avg_duration": avg_duration,
            "last_called":  last_called,
        },
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Daily Call Tracker (SDR view)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/my/today-calls")
def get_my_today_calls(
    date: str = None,          # optional YYYY-MM-DD override; defaults to today
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns all calls made today by the logged-in SDR — both manual (CallLog)
    and dialer (DialerCall) — merged and enriched with lead/SDR info.
    Response shape:
      {
        date: "YYYY-MM-DD",
        summary: { total, connected, no_answer, voicemail, callback, meeting, other },
        calls: [ { id, source, lead_id, lead_name, company, lead_status, outcome,
                   duration_sec, notes, called_at, sdr_name, phone_number,
                   recording_url (dialer calls only) } ]
      lead_name is null (not a placeholder string) when there's no real name
      to show — frontend falls back to phone_number.
      }
    """
    from datetime import date as _date
    import pytz

    uid = user["sub"]

    # Resolve the target date (default = today in UTC)
    if date:
        try:
            target_date = _date.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    else:
        target_date = _date.today()

    day_start = datetime.combine(target_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    day_end   = datetime.combine(target_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    def _lead_info(lead):
        # lead_name is None (not a placeholder string) whenever there's no
        # real name to show — including auto-created leads whose last_name
        # is literally "Unknown" (see dialer_service._find_or_create_lead_by_phone).
        # The frontend falls back to the dialed phone number in that case,
        # which is far more useful to an SDR than the bare word "Unknown".
        if not lead:
            return {"lead_id": None, "lead_name": None, "company": "—", "lead_status": "—"}
        name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        return {
            "lead_id":     lead.id,
            "lead_name":   name if name and name.lower() != "unknown" else None,
            "company":     lead.company or "—",
            "lead_status": lead.status or "—",
        }

    calls = []

    # ── Manual call logs ──────────────────────────────────────────────────────
    manual_calls = (
        db.query(models.CallLog)
        .options(joinedload(models.CallLog.lead), joinedload(models.CallLog.user))
        .filter(
            models.CallLog.user_id == uid,
            models.CallLog.called_at >= day_start,
            models.CallLog.called_at <= day_end,
        )
        .order_by(models.CallLog.called_at.desc())
        .all()
    )
    for c in manual_calls:
        info = _lead_info(c.lead)
        calls.append({
            "id":           c.id,
            "source":       "manual",
            "outcome":      c.outcome or "—",
            "duration_sec": None,
            "notes":        c.notes or "",
            "called_at":    c.called_at.isoformat() if c.called_at else None,
            "sdr_name":     c.user.name if c.user else "—",
            "phone_number": c.lead.phone if c.lead else None,
            **info,
        })

    # ── Dialer calls (Aircall / RCM) ──────────────────────────────────
    dialer_calls = (
        db.query(models.DialerCall)
        .options(joinedload(models.DialerCall.lead), joinedload(models.DialerCall.user))
        .filter(
            models.DialerCall.user_id == uid,
            models.DialerCall.started_at >= day_start,
            models.DialerCall.started_at <= day_end,
        )
        .order_by(models.DialerCall.started_at.desc())
        .all()
    )
    for c in dialer_calls:
        info = _lead_info(c.lead)
        calls.append({
            "id":           c.id,
            "source":       c.provider or "dialer",
            "outcome":      c.outcome or "—",
            "duration_sec": c.duration,
            "notes":        "",
            "called_at":    c.started_at.isoformat() if c.started_at else None,
            "sdr_name":     c.user.name if c.user else "—",
            "recording_url": c.recording_url,
            "phone_number": c.phone_number,
            **info,
        })

    # Sort merged list newest-first
    calls.sort(key=lambda x: x["called_at"] or "", reverse=True)

    # ── Summary buckets ───────────────────────────────────────────────────────
    CONNECTED_OUTCOMES = {"Interested", "Meeting Scheduled", "Not Interested",
                          "Call Completed", "Call Back Later", "Customer Declined"}
    NO_ANSWER_OUTCOMES  = {"No Answer", "No answer"}
    VOICEMAIL_OUTCOMES  = {"Left Voicemail", "left_voicemail"}
    CALLBACK_OUTCOMES   = {"Call Back Later", "call_back_later"}
    MEETING_OUTCOMES    = {"Meeting Scheduled", "meeting_scheduled", "Call Completed", "call_completed"}

    total     = len(calls)
    connected = sum(1 for c in calls if c["outcome"] in CONNECTED_OUTCOMES)
    no_answer = sum(1 for c in calls if c["outcome"] in NO_ANSWER_OUTCOMES)
    voicemail = sum(1 for c in calls if c["outcome"] in VOICEMAIL_OUTCOMES)
    callback  = sum(1 for c in calls if c["outcome"] in CALLBACK_OUTCOMES)
    meeting   = sum(1 for c in calls if c["outcome"] in MEETING_OUTCOMES)

    return {
        "date":    target_date.isoformat(),
        "summary": {
            "total":     total,
            "connected": connected,
            "no_answer": no_answer,
            "voicemail": voicemail,
            "callback":  callback,
            "meeting":   meeting,
            "other":     total - no_answer - voicemail - connected,
        },
        "calls": calls,
    }



@router.get("/sdr/call-summary")
def get_sdr_call_summary(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns today's call statistics for the logged-in SDR.

    Fix (v9.7.3): Previously only counted CallLog (manual calls), missing all
    DialerCall records from RCM/Aircall. Now uses the same UNION pattern
    as analytics — both sources merged, outcomes grouped by value.
    Also switched to UTC-aware today_start (consistent with the rest of the codebase).
    """
    uid = user["sub"]

    # Verify user exists
    db_user = db.query(models.User).filter(models.User.id == uid).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    # UTC-aware today boundary (consistent with analytics_routes and lead_routes)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    # Lead status counts — single GROUP BY
    status_q = (
        db.query(models.Lead.status, func.count(models.Lead.id))
        .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id)
        .filter(models.lead_assignments.c.user_id == uid)
        .group_by(models.Lead.status)
    )
    status_map = dict(status_q.all())
    total_assigned = sum(status_map.values())

    # ── A) Manual call_logs today ──────────────────────────────────────────
    cl_today = (
        db.query(models.CallLog.outcome, func.count(models.CallLog.id).label("cnt"))
        .filter(models.CallLog.user_id == uid, models.CallLog.called_at >= today_start)
        .group_by(models.CallLog.outcome)
        .all()
    )
    cl_outcome_map = {(row.outcome or "No Outcome"): row.cnt for row in cl_today}
    cl_total = sum(cl_outcome_map.values())

    total_calls_ever = db.query(func.count(models.CallLog.id)).filter(
        models.CallLog.user_id == uid,
    ).scalar() or 0

    # ── B) Dialer calls today (RCM / Aircall) ───────────────────────
    dc_today = (
        db.query(models.DialerCall.outcome, func.count(models.DialerCall.id).label("cnt"))
        .filter(
            models.DialerCall.user_id == uid,
            models.DialerCall.direction == "outbound",
            models.dialer_call_event_time() >= today_start,
        )
        .group_by(models.DialerCall.outcome)
        .all()
    )
    dc_outcome_map = {(row.outcome or "No Outcome"): row.cnt for row in dc_today}
    dc_total = sum(dc_outcome_map.values())

    # ── Merge both sources ─────────────────────────────────────────────────
    # Union by outcome label; dialer calls dominate when both exist for the same outcome
    merged_outcomes: dict = dict(dc_outcome_map)
    for outcome, cnt in cl_outcome_map.items():
        merged_outcomes[outcome] = merged_outcomes.get(outcome, 0) + cnt

    calls_today_count = cl_total + dc_total

    # Build outcome_today keyed by configured outcome values (fills zeros for
    # outcomes not logged today so the frontend always gets a complete dict)
    outcome_today_full = {
        o["value"]: merged_outcomes.get(o["value"], 0)
        for o in models.get_outcome_config(db)
    }
    # Also include any outcome keys that came from DialerCalls but aren't in config
    for k, v in merged_outcomes.items():
        outcome_today_full.setdefault(k, v)

    return {
        "total_assigned":      total_assigned,
        "lead_assigned":       status_map.get("Lead Assigned", 0),
        "calls_today":         calls_today_count,
        "total_calls_ever":    total_calls_ever,
        "calling":             status_map.get("Calling", 0),
        "callbacks_pending":   status_map.get("Calling", 0),  # kept for backwards compat
        "meetings_scheduled":  status_map.get("Meeting Scheduled", 0),
        "discovery":           status_map.get("1st Discovery Meeting", 0) + status_map.get("Discovery Complete", 0),
        "demo_scheduled":      status_map.get("Demo Scheduled", 0),
        "demo_done":           status_map.get("Demo Done", 0),
        "completed":           status_map.get("Completed", 0),
        "research_pending":    status_map.get("Research", 0),
        "disqualified":        status_map.get("Disqualified", 0),
        "outcomes_today":      outcome_today_full,
    }



# ── Activity feed moved to activity_feed_routes.py ───────────────────────────
