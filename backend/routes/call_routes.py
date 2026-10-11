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
from salesforce import get_sf_client, push_lead_to_salesforce, push_sdr_metrics_to_salesforce, lead_push_info, _is_sentinel_sf_id
from routes.lead_helpers import _can_modify_lead, load_lead
from services import lead_service

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
        attribution = f"Booked via Alternate CRM by {user.get('name') or user.get('email')}"
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
    Deliberately takes no `db` — RCA 2026-07-27: Alternate Messenger's 502-retry loop
    (`time.sleep(1)`, `time.sleep(2)`, ...) runs synchronously and can take
    several seconds per call during a Alternate Messenger brownout. The batch refresh
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
    Works for both Aircall and Alternate Messenger providers.

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


# Only terminal calls are worth re-fetching — a call still in CALL_STARTED /
# CALL_ANSWERED has nothing final to backfill and gets updated by webhook.
_TERMINAL_CALL_STATUSES = {"CALL_ENDED", "CALL_FAILED", "FAILED", "completed",
                           "failed", "cancelled", "no_answer", "busy"}


def _refresh_calls_in_background(call_ids: list) -> None:
    """Backfill recording URL / duration / ended_at / transcript for these
    DialerCalls, off the request path, in ONE background thread.

    RCA 2026-09-03 (self-inflicted staging outage, reproduced): get_lead_calls
    used to spawn one thread per DialerCall on the lead, each opening its own
    DB session and then making a provider API call *while holding it*. Opening
    ~18 leads in quick succession was enough to exhaust the connection pool and
    take the whole app down with platform 502s — an SDR opening the Calls tab on
    a lead with many calls hits the same fan-out, and it degrades the app for
    everyone, not just them. Aircall's own 429 backoff makes it far worse:
    _get() sleeps 10s doubling to 60s over 5 attempts, so a throttled thread
    could sit on a pooled connection for ~150s.

    This is exactly the failure RCA 2026-07-27 already documented and solved for
    activity_feed_routes' batch refresh, and _fetch_call_update_data's docstring
    already prescribes the shape ("Fetch first with no connection held, write
    later in a short-lived session") — this call site simply never adopted it.
    So: bounded to the ids passed in (the requested page, not every call on the
    lead), one thread, and two short-lived sessions with the slow provider calls
    sandwiched between them holding no connection at all.
    """
    if not call_ids:
        return
    threading.Thread(target=_refresh_calls_now, args=(call_ids,), daemon=True).start()


def _refresh_calls_now(call_ids: list) -> None:
    """The actual three-phase refresh. Separate from the thread wrapper so it
    can be tested directly — the property that matters (no DB connection held
    across the provider call) is unobservable through a race with a real
    thread."""
    from database import SessionLocal
    import dialer_service
    try:
        # 1. Short session: decide what to fetch, then release the connection.
        targets = []   # (call_id, provider, provider_call_id)
        db1 = SessionLocal()
        try:
            providers: dict = {}
            for cid in call_ids:
                c = db1.query(models.DialerCall).filter(models.DialerCall.id == cid).first()
                if not c or not c.provider_call_id or not _needs_call_update(c):
                    continue
                pname = (c.provider or "").lower()
                if pname not in providers:
                    providers[pname] = dialer_service.get_provider_by_name(pname, db1)
                if providers[pname]:
                    targets.append((cid, providers[pname], c.provider_call_id))
        finally:
            db1.close()

        # 2. The slow part — provider HTTP, including any 429 backoff — with
        #    no DB connection held. This is the whole point of the split.
        fetched = []
        for cid, prov, provider_call_id in targets:
            try:
                data = prov.fetch_call(provider_call_id)
            except Exception as e:
                logger.warning(f"[CallRoutes] Background fetch_call failed for {cid}: {e}")
                continue
            if data:
                fetched.append((cid, data))

        # 3. Short session again: write only.
        if fetched:
            db2 = SessionLocal()
            try:
                for cid, data in fetched:
                    c = db2.query(models.DialerCall).filter(models.DialerCall.id == cid).first()
                    if c:
                        _apply_call_update_data(c, data, db2)
            finally:
                db2.close()
    except Exception as e:
        # Best-effort backfill — must never take down the worker. But it is
        # logged: the version of this that swallowed silently is precisely
        # why nobody noticed the fan-out for as long as they didn't.
        logger.warning(f"[CallRoutes] Background call refresh failed: {e}", exc_info=True)



@router.get("/call-outcomes")
def get_call_outcomes(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
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
        # Exact lookup — the frontend tells us which DialerCall to update.
        # Always attach here, even to correct an outcome that's already set:
        # this is a deliberate, explicit SDR action against one specific call,
        # which must always be able to override an automated guess (e.g. an
        # Aircall AutoLog tag mapping). RCA 2026-08-19: the previous guard
        # ("only attach if outcome is still None") silently created a duplicate
        # CallLog instead of overwriting — corrections never reached
        # DialerCall.outcome, which is what connect-rate/analytics actually read.
        exact = db.query(models.DialerCall).filter(
            models.DialerCall.id == dialer_call_id_hint,
            models.DialerCall.lead_id == lead_id,
        ).first()
        if exact:
            recent_dialer_call = exact
            logger.info(f"[CallLog] Exact DialerCall match via dialer_call_id hint: {dialer_call_id_hint}")

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
    is_correction = False
    if recent_dialer_call:
        is_correction = recent_dialer_call.outcome is not None
        # Attach outcome + notes to the existing Aircall record
        recent_dialer_call.outcome = outcome_str
        recent_dialer_call.notes = notes
        attached_to_dialer = True
        call = recent_dialer_call  # use for response
        if is_correction:
            # Keep the paired AutoLog CallLog (if any) in sync — several
            # analytics queries dedup CallLog against DialerCall for the same
            # physical call by matching user/lead/date, so leaving the old
            # (wrong) outcome on that row would surface it inconsistently
            # alongside the now-corrected DialerCall.
            paired_call_log = db.query(models.CallLog).filter(
                models.CallLog.dialer_call_id == recent_dialer_call.id
            ).first()
            if paired_call_log:
                paired_call_log.outcome = outcome_str
                paired_call_log.notes = notes
            logger.info(
                f"[CallLog] Corrected outcome to '{outcome_str}' on DialerCall "
                f"{recent_dialer_call.id} (previously auto/manually logged)"
            )
        else:
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

    # Wrong Number is about the phone, not the lead: flag it so cadence call/text
    # steps skip (no status change — email still works).
    if outcome_str == "Wrong Number":
        lead_service.mark_phone_invalid(db, lead, user.get("name") or user.get("email") or "a teammate")

    # EC-13: Only increment call_attempt_count if this is a manual call OR if the
    # DialerCall record has NOT yet been finalized by a webhook.
    # When the Aircall webhook fires CALL_ENDED it already increments the counter
    # in dialer_service.handle_webhook → double-counting is prevented here.
    # Status counts too: Aircall's call.hungup finishes the call with no ended_at.
    already_counted_by_webhook = (
        attached_to_dialer
        and recent_dialer_call is not None
        and (recent_dialer_call.ended_at is not None or recent_dialer_call.status == "CALL_ENDED")
    )
    if outcome_str in ATTEMPT_OUTCOMES and not already_counted_by_webhook:
        lead.call_attempt_count = (lead.call_attempt_count or 0) + 1
        logger.info(
            f"[CallLog] Incremented call_attempt_count for lead {lead_id} "
            f"(attached_to_dialer={attached_to_dialer}, already_counted={already_counted_by_webhook})"
        )

    # Always increment times_called for any outbound Alternate CRM call (EC-9: unified
    # counter) — but never for a correction (the call itself already happened once,
    # this invocation is just fixing its recorded outcome), and never when the
    # Aircall webhook already counted it (RCA 2026-08-21, live: dialer_service.
    # handle_webhook increments times_called on every outbound CALL_ENDED —
    # unconditionally, unlike call_attempt_count two lines above, which already
    # had this exact guard. Once the outcome-modal SSE fix made the webhook→
    # outcome-submit sequence complete reliably for Aircall calls, this counted
    # every such call twice.).
    if not is_correction and not already_counted_by_webhook:
        lead.times_called = (lead.times_called or 0) + 1

    # RCA 2026-09-01: initiate_call's "you already have an active call" guard
    # (dialer_service._get_active_call_for_user) keys purely on DialerCall.status
    # — it is cleared ONLY by an Aircall/Alternate Messenger webhook (or a 5-15min
    # staleness timeout), never by the SDR finishing this outcome-log step.
    # An SDR logging outcome via this exact endpoint is the one guaranteed-
    # to-happen signal that the call is over, regardless of whether the
    # provider's own webhook ever lands on this row (confirmed: Aircall
    # Everywhere's embedded-window webhook-matching race can leave a row
    # permanently orphaned at CALL_STARTED with no provider_call_id, which
    # also blocks the existing self-heal). Closing the call out here — after
    # the counters above, which read the call's ORIGINAL ended_at to decide
    # "did a webhook already count this" — means the next dial is never
    # blocked on a webhook that may never arrive. A later webhook for the
    # same row still idempotently backfills duration/recording/tags (EC-17
    # terminal-state guard in dialer_service.py already prevents downgrade).
    if attached_to_dialer and recent_dialer_call.status not in ("CALL_ENDED", "CALL_FAILED"):
        recent_dialer_call.status = "CALL_ENDED"
        recent_dialer_call.ended_at = recent_dialer_call.ended_at or datetime.now(timezone.utc)

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

    # RCA 2026-08-25: this route mutates call_attempt_count/times_called/
    # priority_score/status on every call log but never busted the my_leads/
    # leads_count caches — the SDR's own "My Leads" view (and the admin "All
    # Leads" view) could keep showing the pre-call snapshot (0 calls) for up
    # to the cache's TTL after logging a real call.
    from cache import invalidate
    invalidate('my_leads'); invalidate('leads_count'); invalidate('leads_page')

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
        models.log_status_change(db, lead.id, old_status, new_status, user.get("name") or user.get("email", "unknown"),
                                 changed_by_user_id=user["sub"])

        # Analytics Hub's meetings_scheduled metric keys off meeting_scheduled_at,
        # not current status (the Leaderboard's metric) — stamp it on every
        # meeting-reached transition so the two stop disagreeing. Overwritten
        # below with the SDR's real meeting_datetime when one is provided.
        if new_status in ("Meeting Scheduled", "1st Discovery Meeting") and lead.meeting_scheduled_at is None:
            lead.meeting_scheduled_at = lead.status_changed_at

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
                import meeting_log
                meeting_log.set_meeting_time(db, lead)   # the booking row was written with the stamped time
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
    if not _is_sentinel_sf_id(sf_lead_id):
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
    if not _is_sentinel_sf_id(sf_lead_id):
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

        # Check Aircall / Alternate Messenger DialerCall entries with a resolved outcome (EC-3)
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
                                 user.get("name") or user.get("email", "unknown"), changed_by_user_id=user["sub"])

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
    # "Other: <explanation>" carries the SDR's free-text reason — still a
    # valid selection of the "Other" option, just with detail attached.
    is_other_with_note = reason.startswith("Other: ") and len(reason) > len("Other: ")
    if reason not in VALID_REASONS and not is_other_with_note:
        raise HTTPException(status_code=400, detail=f"Invalid reason. Must be one of: {sorted(VALID_REASONS)}")

    # RCA 2026-08-17: lead_detail.js offers "Disqualify Lead" (incl. "Wrong
    # Number") across DISQUALIFIABLE_STATUSES, not just "Calling" — the old
    # Calling-only gate 422'd for any lead already past that stage.
    if lead.status not in models.DISQUALIFIABLE_STATUSES:
        raise HTTPException(status_code=422, detail=f"Lead cannot be closed from '{lead.status}' status.")

    # Derive definitive outcomes from config: all terminal group outcomes
    DEFINITIVE_OUTCOMES = {o["value"] for o in config if o["group"] == "terminal"}

    # Bypass call-attempt validation for leads with no phone number, or when
    # the SDR is explicitly choosing a terminal reason (e.g. "Wrong Number")
    # through this selector — that choice is itself the definitive outcome,
    # same as if it had already been logged via CallLog/DialerCall (RCA
    # 2026-08-17: requiring a *separate* matching call-log entry on top of an
    # explicit terminal reason was the second half of the "wrong-number
    # disqualify not working" report).
    lead_has_phone = bool((lead.phone or "").strip()) or bool((getattr(lead, 'phone_secondary', None) or "").strip())
    # A bare "Other" (no explanation) deliberately still needs the
    # call-attempt gate below — same as before — so it can't be used as a
    # zero-effort disqualify shortcut the way an SDR just picking a terminal
    # outcome can't either. RCA 2026-08-31: a rep explaining WHY via
    # "Other: <note>" is the equivalent of choosing a genuine terminal
    # reason (same rationale as "Wrong Number" above) and bypasses it — the
    # actual reported bug was that there was no way to attach that note at
    # all (QuickActions.jsx had no free-text field for "Other"), not that
    # the gate itself was wrong.
    skip_call_check = (
        (reason == "No Phone Number" and not lead_has_phone)
        or (reason in DEFINITIVE_OUTCOMES)
        or is_other_with_note
    )

    if reason == "No Phone Number" and lead_has_phone:
        raise HTTPException(status_code=422, detail="Cannot use 'No Phone Number' reason — this lead has a phone number on file.")

    if not skip_call_check:
        # Check if closure is allowed
        current_attempts = lead.call_attempt_count or 0
        max_attempts = settings.max_call_attempts or 5

        # Allow closure if: (1) max attempts reached, OR (2) a definitive outcome was logged
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
def delete_call_log(lead_id: str, call_id: str, db: Session = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    load_lead(db, user, lead_id, edit=True)
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
    user: dict = Depends(get_current_user),
):
    """
    Return call logs for a lead — merging manual CallLog records and
    dialer DialerCall records in chronological order (newest first).

    Supports async pagination: page + limit query params.
    Stats (total, connected, avg_duration, last_called) are always
    computed from the full dataset regardless of page.
    """
    lead = load_lead(db, user, lead_id)

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

    # ── Dialer calls ─────────────────────────────────────────────────────
    # Each DialerCall.provider may be 'aircall' or 'messenger', and each must
    # be refreshed through its own provider client — a single global provider
    # silently used the Aircall client for Alternate Messenger calls, so their
    # recording_url was never fetched. That per-call provider resolution now
    # happens inside _refresh_calls_in_background, in its own session.
    #
    # PERF (v8.9.9, reworked 2026-09-03): the response returns DB-cached state
    # immediately and the provider refresh happens off the request path, so a
    # Alternate Messenger brownout can't add seconds to this endpoint. It is now one
    # bounded background thread for the requested page rather than one thread
    # (and one held DB connection) per call row — see the RCA on
    # _refresh_calls_in_background.
    dialer_rows = []
    # Ids worth re-fetching from the provider. The refresh itself is kicked off
    # AFTER pagination, for the returned page only — refreshing every call on the
    # lead is what made this endpoint able to take the app down (see
    # _refresh_calls_in_background). Provider instances are resolved in that
    # background thread's own session, not here.
    refreshable_ids = []
    try:
        dialer = db.query(models.DialerCall).filter(models.DialerCall.lead_id == lead_id).all()

        # One query for every caller's name, not one per call row.
        _user_ids = {c.user_id for c in dialer if c.user_id}
        _user_names = dict(
            db.query(models.User.id, models.User.name)
              .filter(models.User.id.in_(_user_ids)).all()
        ) if _user_ids else {}

        for c in dialer:
            # EC-17: skip calls that already have everything — avoids a pointless
            # provider hit (and, for Alternate Messenger, a 502 log storm) per call row.
            if (c.provider_call_id
                    and c.status in _TERMINAL_CALL_STATUSES
                    and _needs_call_update(c)):
                refreshable_ids.append(c.id)

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
                "user_name":     _user_names.get(c.user_id),
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

    # Backfill only what this page actually shows, off the request path. Bounds
    # the work to `limit` (≤100) instead of every call ever made to this lead.
    _page_ids = {c["id"] for c in page_calls if c.get("source") == "dialer"}
    _refresh_calls_in_background([cid for cid in refreshable_ids if cid in _page_ids])

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

    # ── Dialer calls (Aircall / Alternate Messenger) ──────────────────────────────────
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
    DialerCall records from Alternate Messenger/Aircall. Now uses the same UNION pattern
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

    # ── B) Dialer calls today (Alternate Messenger / Aircall) ───────────────────────
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
