"""
Nylas Webhook Routes.
Handles challenge verification and incoming email events.
Separate from email_routes to avoid auth dependencies on webhook calls.
"""
import hashlib
import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from database import get_db
from auth import public_endpoint, security_deny
from crypto import decrypt_token
from email_utils import sanitize_preview as _sanitize_preview, is_auto_reply as _is_auto_reply, is_system_message, internal_domains, is_internal_sender
import models

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Webhooks"])


def _verify_signature(body: bytes, signature: str, secret: str) -> bool:
    """Validate Nylas webhook signature (HMAC-SHA256)."""
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# _sanitize_preview is now imported from email_utils (see top of file).


@router.get("/webhooks/nylas", dependencies=[Depends(public_endpoint)])
def nylas_webhook_challenge(challenge: str = Query(...)):
    """
    Nylas sends a GET with ?challenge=... for verification.
    Must return the challenge value as plain text (not JSON).
    """
    return PlainTextResponse(content=challenge)


def _handle_message_opened(obj_data: dict, db) -> None:
    """
    Handle a ``message.opened`` Nylas event.

    Sender-preview heuristic (time-gate): the first open of an outbound email
    is almost always the sender's email client auto-previewing the Sent folder.
    This typically happens within a few seconds of send.

    Rule: skip the first open ONLY if it occurs within 10 seconds of send.
    Any open that arrives >10s after send is treated as a genuine lead open.

    Multiple opens after the first counted open always increment the counter.
    Inbound emails: always counted immediately (no sender heuristic applies).
    """
    nested_obj = obj_data.get("object", {}) if isinstance(obj_data.get("object"), dict) else {}
    open_message_id = (
        obj_data.get("message_id")
        or nested_obj.get("message_id")
        or obj_data.get("id")
        or nested_obj.get("id")
        or ""
    )
    logger.info(
        f"message.opened received: extracted message_id={open_message_id}, "
        f"raw_keys={list(obj_data.keys())}"
    )
    if not open_message_id:
        logger.warning(
            f"message.opened with no extractable message_id, "
            f"payload keys: {list(obj_data.keys())}, full delta keys: {list(obj_data.keys())}"
        )
        return

    activity = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.nylas_message_id == open_message_id
    ).first()
    if not activity:
        logger.info(f"Open event for unknown message_id={open_message_id} (no matching activity)")
        return

    raw_count = (activity.open_count or 0) + 1

    # ── Sender-preview time-gate (outbound only, first open only) ─────────
    if activity.direction == "outbound" and raw_count <= 1:
        sent_at = activity.timestamp
        if sent_at:
            # SQLite returns naive datetimes; ensure both sides are UTC-aware
            if sent_at.tzinfo is None:
                sent_at = sent_at.replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - sent_at).total_seconds()
            if elapsed < 10:
                # Almost certainly the sender's own email client auto-previewing
                # the Sent folder immediately after sending. Skip this open.
                activity.open_count = 0
                db.commit()
                logger.info(
                    f"Skipping sender preview (<10s elapsed={elapsed:.1f}s): "
                    f"message_id={open_message_id}"
                )
                return
        # No timestamp on record (old data) or elapsed >= 10s → count it
        logger.info(
            f"Counting first open (outbound, elapsed>10s or no timestamp): "
            f"message_id={open_message_id}"
        )

    if not activity.opened_at:
        activity.opened_at = datetime.now(timezone.utc)
    # Always count the open at this point — time-gate handled the skip case above
    activity.open_count = raw_count
    db.commit()
    logger.info(
        f"Email opened: message_id={open_message_id}, "
        f"count={activity.open_count}, lead_id={activity.lead_id}"
    )


_UNSUBSCRIBE_PATH = "/api/public/unsubscribe"


def _clicked_urls(obj_data: dict, nested_obj: dict) -> list:
    """The original URLs Nylas reports for a link-click event (data.object.link_data[].url)."""
    links = obj_data.get("link_data") or nested_obj.get("link_data") or []
    return [l.get("url", "") for l in links if isinstance(l, dict)]


def _handle_message_link_clicked(obj_data: dict, db) -> None:
    """Handle a ``message.link_clicked`` Nylas event.

    Not counted: a click on the Unsubscribe link (mail-security scanners fetch every
    link at delivery, so it inflated "clicked" on campaigns and was never a real
    interest signal), and a click within 10 s of the send (the same scanners)."""
    nested_obj = obj_data.get("object", {}) if isinstance(obj_data.get("object"), dict) else {}
    message_id = (
        obj_data.get("message_id") or nested_obj.get("message_id")
        or obj_data.get("id") or nested_obj.get("id") or ""
    )
    urls = _clicked_urls(obj_data, nested_obj)
    recents = obj_data.get("recents") or nested_obj.get("recents") or []
    logger.info(
        f"message.link_clicked received: message_id={message_id} urls={[u[:80] for u in urls]} "
        f"recents={len(recents)} agents={sorted({str(r.get('user_agent', ''))[:40] for r in recents if isinstance(r, dict)})[:3]}"
    )
    if not message_id:
        return
    if urls and all(_UNSUBSCRIBE_PATH in u for u in urls):
        logger.info(f"Ignoring unsubscribe-link click: message_id={message_id}")
        return
    activity = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.nylas_message_id == message_id
    ).first()
    if not activity:
        logger.info(f"Click event for unknown message_id={message_id} (no matching activity)")
        return
    sent_at = activity.timestamp
    if activity.direction == "outbound" and sent_at:
        sent_at = sent_at if sent_at.tzinfo else sent_at.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - sent_at).total_seconds() < 10:
            logger.info(f"Ignoring click <10s after send (scanner): message_id={message_id}")
            return
    if not activity.clicked_at:
        activity.clicked_at = datetime.now(timezone.utc)
    activity.click_count = (activity.click_count or 0) + 1
    db.commit()
    logger.info(f"Email link clicked: message_id={message_id}, count={activity.click_count}")


def _handle_inbound_message(obj_data: dict, thread_id: str, db) -> None:
    """
    Handle a ``message.created`` / ``message.updated`` / ``message.send_success`` event.

    Looks up the thread → lead mapping, skips internal (SDR-sent) emails and
    duplicate messages, then persists a new inbound ``LeadEmailActivity`` row.
    """
    message_id = obj_data.get("id", obj_data.get("message_id", ""))
    from_list  = obj_data.get("from", [])
    to_list    = obj_data.get("to", [])
    subject    = obj_data.get("subject", "")
    body_text  = obj_data.get("body", obj_data.get("snippet", ""))
    from_email = from_list[0].get("email", "") if from_list else ""

    if not thread_id:
        logger.debug(f"Webhook event without thread_id, skipping: {message_id}")
        return

    # Find the lead via thread mapping
    thread_mapping = db.query(models.EmailThread).filter(
        models.EmailThread.nylas_thread_id == thread_id
    ).first()
    if not thread_mapping:
        # Fallback: match inbound by lead's email address (catches Gmail-direct replies)
        lead = db.query(models.Lead).filter(
            models.Lead.email == from_email.lower()
        ).first()
        if not lead:
            logger.debug(
                f"No thread mapping and no lead email match: "
                f"thread_id={thread_id}, from={from_email}"
            )
            return
        # Create thread mapping on the fly so future messages are routed correctly
        thread_mapping = models.EmailThread(
            nylas_thread_id=thread_id,
            lead_id=lead.id,
        )
        db.add(thread_mapping)
        db.flush()
        logger.info(
            f"Created thread mapping via lead-email fallback: "
            f"lead_id={lead.id}, thread_id={thread_id}, from={from_email}"
        )

    lead_id = thread_mapping.lead_id

    # Skip emails sent by one of our connected SDR mailboxes
    sender_mailbox = db.query(models.UserMailbox).filter(
        models.UserMailbox.email_address == from_email.lower(),
        models.UserMailbox.status == "connected",
    ).first()
    if sender_mailbox or is_internal_sender(from_email, internal_domains(db)):
        logger.debug(f"Skipping internal email from {from_email}")   # a colleague's mail is not a lead reply
        return

    # Deduplicate
    if message_id:
        existing = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == message_id
        ).first()
        if existing:
            logger.debug(f"Duplicate webhook event for message_id={message_id}")
            return

    # Extract attachment metadata
    import json as _json
    to_email = to_list[0].get("email", "") if to_list else ""
    raw_attachments = obj_data.get("attachments", [])
    attachments_meta = None
    if raw_attachments:
        attachments_meta = _json.dumps([
            {
                "id":           att.get("id", ""),
                "filename":     att.get("filename", "attachment"),
                "content_type": att.get("content_type", "application/octet-stream"),
                "size":         att.get("size", 0),
            }
            for att in raw_attachments
            if att.get("content_disposition") != "inline"
        ])
        if attachments_meta == "[]":
            attachments_meta = None

    # v10.9.9: an auto-reply (out-of-office, autoresponder) is not a genuine
    # engagement signal — it must not count as "the lead replied" for a
    # condition branch, nor start a new cadence via the email_received
    # trigger. Still logged (is_auto_reply=True) so it's visible in the
    # activity feed, and a condition node can explicitly branch on
    # "email_auto_replied" if an author wants to react to it (e.g. wait
    # longer before the next touch).
    auto_reply = _is_auto_reply(obj_data.get("headers", []), subject) or is_system_message(from_email, subject)

    activity = models.LeadEmailActivity(
        lead_id=lead_id,
        user_id=None,
        direction="inbound",
        subject=subject,
        body_preview=_sanitize_preview(body_text),
        from_email=from_email,
        to_email=to_email,
        nylas_message_id=message_id,
        nylas_thread_id=thread_id,
        attachments_json=attachments_meta,
        is_auto_reply=auto_reply,
    )
    db.add(activity)
    db.commit()

    # Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md, Phase 1 — conditional
    # branching): a lead currently parked on a "condition" node waiting for a
    # reply gets its early-exit signal here, after this webhook's own commit.
    # Best-effort: must never affect the webhook's own processing.
    try:
        from journey_engine.engine import check_entry_triggers, notify_inbound_email
        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        if lead:
            notify_inbound_email(db, lead, auto_reply, message={
                "id": message_id, "thread_id": thread_id, "from": from_email, "subject": subject, "source": "webhook"})
            if not auto_reply:
                # v10.9.8: a cadence can also be entered when the SDR/AE receives
                # an inbound email for this lead — same event, different trigger
                # node type ("trigger" vs. a "condition" node parked mid-cadence).
                check_entry_triggers(db, "email_received", lead, commit=True)
    except Exception as e:
        logger.error(f"[JourneyEngine] check_exit_triggers failed for inbound email webhook: {e}")

    att_info = f", attachments={len(raw_attachments)}" if raw_attachments else ""
    logger.info(
        f"Inbound email logged: from={from_email}, lead_id={lead_id}, "
        f"subject={subject[:50]}{att_info}"
    )


@router.post("/webhooks/instantly", dependencies=[Depends(public_endpoint)])
async def instantly_webhook_event(request: Request, db: Session = Depends(get_db)):
    """
    v13.3.0 — real-time Instantly.ai engagement/outcome events. Registered via
    POST /admin/instantly/webhook/register (routes/dialer_routes.py), which
    points Instantly at this URL with a server-generated X-Webhook-Secret
    header (Instantly has no HMAC signing, confirmed in Phase 1 of this
    batch) — auth mirrors the Alternate Messenger SMS webhook below, not Nylas's
    HMAC-over-body shape.

    Base payload fields (confirmed against Instantly's webhook docs):
    event_type, campaign_id, lead_email, step, timestamp.

    Opens and clicks write a LeadEmailActivity counter row via the shared
    _record_instantly_engagement dedup helper (scheduled_jobs.py — the same
    one _instantly_sync_job's 15-min poll uses, so the one dedup rule lives
    in one place); replies and sent emails are stored by
    _instantly_mail_sync_job. Engine routing (resume/exit a parked instantly_sequence
    enrollment) only applies to events where a live JourneyInstantlyEnrollment
    matches this campaign_id + lead — see the plan's Phase 3 section 4.
    """
    body = await request.body()

    # ── Auth ─────────────────────────────────────────────────────────────
    from routes._admin_helpers import _get_or_create_sync_settings
    settings = _get_or_create_sync_settings(db)
    secret = settings.instantly_webhook_secret if settings else None
    incoming_secret = request.headers.get("X-Webhook-Secret", "")
    if not secret:
        security_deny("WEBHOOK", 401, "Instantly webhook secret not configured", source="instantly")
    elif not hmac.compare_digest(incoming_secret, secret):
        security_deny("WEBHOOK", 401, "Invalid webhook secret", source="instantly")

    # ── Parse ────────────────────────────────────────────────────────────
    import json
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = payload.get("event_type", "")
    campaign_id = payload.get("campaign_id")
    lead_email = (payload.get("lead_email") or "").strip().lower()

    from instantly_provider import parse_ts
    ts = parse_ts(payload.get("timestamp"))

    if not lead_email:
        logger.info(f"[Instantly Webhook] event {event_type!r} with no lead_email — nothing to resolve")
        return {"status": "ok"}

    # Same case-insensitive email-match convention _instantly_sync_job already uses.
    lead = db.query(models.Lead).filter(models.Lead.email == lead_email).first()
    if not lead:
        logger.warning(f"[Instantly Webhook] No Alternate CRM match for email={lead_email!r}, event={event_type!r}")
        return {"status": "ok"}

    # Activity log, always, for the three signals LeadEmailActivity has real
    # columns for — same shared dedup helper _instantly_sync_job's 15-min
    # poll uses (scheduled_jobs.py), so the one dedup rule lives in one
    # place. The other event types (email_sent/interest/meeting/completion/
    # unsubscribe/bounce) have no natural open/click/reply column to log
    # into and are handled entirely by the engine routing below instead.
    from scheduled_jobs import _record_instantly_engagement
    if event_type == "email_opened":
        _record_instantly_engagement(db, lead, campaign_id, new_open=ts, open_count=1)
    elif event_type == "email_link_clicked":
        _record_instantly_engagement(db, lead, campaign_id, new_click=ts, click_count=1)
    # reply_received writes NO row here (v13.8.0): the payload has no body, and
    # the stub it used to write was never matched by the poll, so every reply
    # showed up twice. _instantly_mail_sync_job stores the real email (with
    # subject and body) within minutes; the cadence routing below still fires
    # immediately.

    jie = db.query(models.JourneyInstantlyEnrollment).join(
        models.JourneyEnrollment,
        models.JourneyInstantlyEnrollment.journey_enrollment_id == models.JourneyEnrollment.id,
    ).filter(
        models.JourneyInstantlyEnrollment.instantly_campaign_id == campaign_id,
        models.JourneyInstantlyEnrollment.status == "active",
        models.JourneyEnrollment.lead_id == lead.id,
        models.JourneyEnrollment.status == "active",
    ).first()

    from journey_engine.engine import check_exit_triggers, resume_instantly_sequence_step, _exit_enrollment_early, exit_active_enrollments

    if event_type in ("email_opened", "email_link_clicked", "email_sent"):
        pass  # activity log only — already written above
    elif event_type == "reply_received":
        # auto_reply_received is NOT a real Instantly event (Phase 1,
        # confirmed) and reply_received's payload has no documented
        # auto-reply indicator field either — every reply_received is
        # treated as a normal reply. Exact same call Nylas's handler makes
        # above, so journey.stop_on_reply behaves identically either way.
        check_exit_triggers(db, "email_replied", lead, commit=True)
        if jie:
            resume_instantly_sequence_step(db, jie.journey_enrollment_id, jie.node_id, outcome="replied")
    elif event_type == "lead_interested":
        if jie:
            resume_instantly_sequence_step(db, jie.journey_enrollment_id, jie.node_id, outcome="interested")
    elif event_type == "lead_meeting_booked":
        if jie:
            resume_instantly_sequence_step(db, jie.journey_enrollment_id, jie.node_id, outcome="meeting_booked")
        # NOTE: Journey.stop_on_meeting only fires off check_exit_triggers'
        # own "status_changed" + STAGE_GROUP>=1 path (engine.py) — there is
        # no existing trigger string meaning "a meeting was booked" that a
        # raw webhook event could feed. Not inventing one here (would
        # silently do nothing); flagged in the batch report instead.
    elif event_type == "campaign_completed":
        # lead_email is a confirmed base field on every Instantly webhook
        # event (Phase 1), so this is always lead-scoped in practice — no
        # live evidence this event is ever campaign-wide, so no speculative
        # "resume every enrollment under this campaign" fallback is written.
        if jie:
            resume_instantly_sequence_step(db, jie.journey_enrollment_id, jie.node_id, outcome="completed")
    elif event_type in ("lead_unsubscribed", "email_bounced"):
        if event_type == "lead_unsubscribed":
            # Mirrors routes/email_campaign_routes.py's unsubscribe link: an
            # unsubscribe ends every cadence this lead is in, not just this one.
            if not lead.unsubscribed_at:
                lead.unsubscribed_at = datetime.now(timezone.utc)
            exit_active_enrollments(db, lead.id, event_type)
            db.commit()
        elif jie:
            enrollment = db.query(models.JourneyEnrollment).filter(
                models.JourneyEnrollment.id == jie.journey_enrollment_id,
                models.JourneyEnrollment.status == "active",
            ).first()
            if enrollment:
                # Same hard-stop pattern services/lead_service.py's
                # do_not_contact path already uses — a direct
                # _exit_enrollment_early call, not check_exit_triggers
                # (which only acts on condition nodes / journey-wide stop
                # rules, neither of which this park is).
                _exit_enrollment_early(db, enrollment, reason=event_type)
                db.commit()

    return {"status": "ok"}


@router.post("/webhooks/nylas", dependencies=[Depends(public_endpoint)])
async def nylas_webhook_event(request: Request, db: Session = Depends(get_db)):
    """
    Process incoming Nylas webhook events.
    Handles: message.created, message.updated, message.send_success, message.opened,
    message.link_clicked (v10.9.9 — cadence email engagement tracking; requires
    message.link_clicked added to the Nylas webhook's subscribed trigger types
    in the Nylas dashboard/API, same as message.opened already is).
    """
    body = await request.body()

    # ── Validate signature ────────────────────────────────────────────────
    signature = request.headers.get("x-nylas-signature", "")
    config = db.query(models.NylasConfig).filter(
        models.NylasConfig.id == 1,
        models.NylasConfig.is_active == True
    ).first()

    # RCA 2026-09-29: a missing signature header, a missing secret, or a
    # decrypt error all used to skip verification (fail open). Now each is
    # a refusal (SECURITY_WEBHOOK_MODE=monitor logs instead).
    secret = None
    if config and config.webhook_secret_encrypted:
        try:
            secret = decrypt_token(config.webhook_secret_encrypted)
        except Exception as e:
            logger.warning(f"Nylas webhook secret could not be decrypted: {e}")
    if not secret:
        security_deny("WEBHOOK", 401, "Nylas webhook secret not configured", source="nylas")
    elif not signature or not _verify_signature(body, signature, secret):
        security_deny("WEBHOOK", 401, "Invalid webhook signature", source="nylas")

    # ── Parse event ───────────────────────────────────────────────────────
    import json
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Nylas v3 webhook structure
    deltas = payload.get("data", [])
    if isinstance(deltas, dict):
        deltas = [deltas]

    handled_event_types = (
        "message.created", "message.updated",
        "message.send_success", "message.opened", "message.link_clicked",
    )
    for delta in deltas:
        event_type = delta.get("type", payload.get("type", ""))
        obj_data   = delta.get("object_data", delta.get("data", delta))

        if event_type not in handled_event_types:
            # v13.0.6: previously silently dropped with zero trace, which is
            # exactly why we couldn't confirm whether Nylas's bounce trigger
            # (expected name: message.bounce_detected) is actually reaching
            # us despite the dashboard subscription reportedly being
            # enabled — there was no way to find out short of guessing.
            # This makes the next one (bounce or otherwise) visible instead
            # of invisible, without changing behavior for anything we don't
            # yet handle.
            logger.info(f"[Nylas Webhook] Unhandled event type received: {event_type!r} — payload: {obj_data}")
            continue

        if event_type == "message.opened":
            _handle_message_opened(obj_data, db)
            continue

        if event_type == "message.link_clicked":
            _handle_message_link_clicked(obj_data, db)
            continue

        # message.created / message.updated / message.send_success. Nylas v3 nests the message
        # under data.object (the opened/clicked handlers already unwrap it); reading thread_id
        # off the envelope gave "" and every webhook reply was dropped at the thread_id check.
        message = obj_data["object"] if isinstance(obj_data.get("object"), dict) else obj_data
        _handle_inbound_message(message, message.get("thread_id", ""), db)

    return {"status": "ok"}



# ─────────────────────────────────────────────────────────────────────────────
# Alternate Messenger SMS Webhook
# Handles delivery status reports and inbound SMS from Alternate Messenger Push URL.
# Configure in Alternate Messenger Portal: Settings → Push URL → <crm>/api/webhooks/messenger-sms
# ─────────────────────────────────────────────────────────────────────────────
import os
import json as _cw_json  # named to avoid collision with top-level json usage


@router.post("/api/webhooks/messenger-sms", dependencies=[Depends(public_endpoint)])
async def messenger_sms_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Receive delivery receipts and inbound SMS from Alternate Messenger.

    Security: Validates X-Alternate Messenger-Webhook-Secret header against the
    MESSENGER_WEBHOOK_SECRET environment variable.
    """
    # ── 1. Auth ───────────────────────────────────────────────────────────────
    expected_secret = os.getenv("MESSENGER_WEBHOOK_SECRET", "")
    incoming_secret = request.headers.get("X-Alternate Messenger-Webhook-Secret", "")

    # RCA 2026-09-29: unset secret used to mean "accept anything".
    import hmac
    if not expected_secret:
        security_deny("WEBHOOK", 401, "MESSENGER_WEBHOOK_SECRET not configured", source="messenger-sms")
    elif not hmac.compare_digest(incoming_secret, expected_secret):
        security_deny("WEBHOOK", 401, "Invalid webhook secret", source="messenger-sms")

    # ── 2. Parse ──────────────────────────────────────────────────────────────
    body = await request.body()
    try:
        payload = _cw_json.loads(body)
    except _cw_json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = payload.get("type", "")

    # ── 3a. Delivery report ───────────────────────────────────────────────────
    if event_type == "delivery":
        message_id = payload.get("messageId", "")
        new_status  = payload.get("status", "delivered")
        if message_id:
            log = db.query(models.SmsLog).filter_by(message_id=message_id).first()
            if log:
                log.status = new_status
                db.commit()
                logger.info("[SMS Webhook] Delivery: %s -> %s", message_id, new_status)
        return {"status": "ok", "type": "delivery"}

    # ── 3b. Inbound SMS ───────────────────────────────────────────────────────
    if event_type == "incoming":
        from_number  = payload.get("from", "")
        to_number    = payload.get("to", "")
        message_text = payload.get("message", "")

        # Several leads can share a number — every Cadence Sandbox test lead
        # has the sandbox phone — so prefer the one in a live cadence, then the
        # newest. An unordered .first() filed demo replies on a stale test lead.
        in_cadence = db.query(models.JourneyEnrollment.lead_id).filter(models.JourneyEnrollment.status == "active")
        lead = db.query(models.Lead).filter(
            (models.Lead.phone == from_number) |
            (models.Lead.phone_secondary == from_number)
        ).order_by(models.Lead.id.in_(in_cadence).desc(), models.Lead.created_at.desc()).first()

        # v11.10.0: this row used to be written with neither `channel` nor
        # `user_id`, so every WhatsApp reply was stored as channel="sms" (the
        # column default) and owned by nobody — the Activity Monitor's channel
        # filter mis-bucketed all inbound WhatsApp, and per-SDR views showed
        # none of it. `to_number` was already parsed here and then discarded;
        # it's the sender the lead replied to, which is exactly what identifies
        # the owning SDR.
        channel = (payload.get("channel") or payload.get("message_type") or "sms").lower()
        if channel not in ("sms", "whatsapp"):
            channel = "sms"

        owner = None
        if to_number:
            owner = db.query(models.User).filter(
                (models.User.messenger_whatsapp_sender_id == to_number) |
                (models.User.messenger_from_number == to_number)
            ).first()
        if owner is None and lead is not None:
            # No per-SDR sender matched (org-wide sender, or an unassigned
            # number) — fall back to whoever owns the lead.
            owner = next(iter(lead.assigned_users), None)

        inbound_log = models.SmsLog(
            direction="inbound",
            status="received",
            phone_number=from_number,
            message_text=message_text,
            lead_id=lead.id if lead else None,
            user_id=owner.id if owner else None,
            channel=channel,
            provider="messenger",
        )
        db.add(inbound_log)
        db.commit()
        logger.info("[SMS Webhook] Inbound from %s, lead=%s", from_number, lead.id if lead else "unknown")
        # A text reply stops / branches cadences the same way an email reply does.
        try:
            from journey_engine.engine import notify_inbound_message
            notify_inbound_message(db, lead, channel)
        except Exception as e:
            logger.error(f"[JourneyEngine] inbound {channel} trigger failed: {e}")
        return {"status": "ok", "type": "incoming"}

    logger.debug("[SMS Webhook] Unrecognised event type: %s", event_type)
    return {"status": "ok", "type": "ignored"}
