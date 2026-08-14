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
from crypto import decrypt_token
from email_utils import sanitize_preview as _sanitize_preview, is_auto_reply as _is_auto_reply
import models

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Webhooks"])


def _verify_signature(body: bytes, signature: str, secret: str) -> bool:
    """Validate Nylas webhook signature (HMAC-SHA256)."""
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# _sanitize_preview is now imported from email_utils (see top of file).


@router.get("/webhooks/nylas")
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


def _handle_message_link_clicked(obj_data: dict, db) -> None:
    """Handle a ``message.link_clicked`` Nylas event — no sender-preview
    time-gate needed here (unlike opens, an email client doesn't
    auto-click links while previewing the Sent folder)."""
    nested_obj = obj_data.get("object", {}) if isinstance(obj_data.get("object"), dict) else {}
    message_id = (
        obj_data.get("message_id") or nested_obj.get("message_id")
        or obj_data.get("id") or nested_obj.get("id") or ""
    )
    if not message_id:
        return
    activity = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.nylas_message_id == message_id
    ).first()
    if not activity:
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
    if sender_mailbox:
        logger.debug(f"Skipping internal email from {from_email}")
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
    auto_reply = _is_auto_reply(obj_data.get("headers", []), subject)

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
        from journey_engine.engine import check_entry_triggers, check_exit_triggers
        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        if lead:
            if auto_reply:
                check_exit_triggers(db, "email_auto_replied", lead, commit=True)
            else:
                check_exit_triggers(db, "email_replied", lead, commit=True)
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


@router.post("/webhooks/nylas")
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

    if config and config.webhook_secret_encrypted:
        try:
            secret = decrypt_token(config.webhook_secret_encrypted)
            if signature and not _verify_signature(body, signature, secret):
                logger.warning("Webhook signature verification failed")
                raise HTTPException(status_code=401, detail="Invalid webhook signature")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Signature verification error: {e}")

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

    for delta in deltas:
        event_type = delta.get("type", payload.get("type", ""))
        obj_data   = delta.get("object_data", delta.get("data", delta))

        if event_type not in (
            "message.created", "message.updated",
            "message.send_success", "message.opened", "message.link_clicked",
        ):
            continue

        if event_type == "message.opened":
            _handle_message_opened(obj_data, db)
            continue

        if event_type == "message.link_clicked":
            _handle_message_link_clicked(obj_data, db)
            continue

        # message.created / message.updated / message.send_success
        thread_id = obj_data.get("thread_id", "")
        _handle_inbound_message(obj_data, thread_id, db)

    return {"status": "ok"}



# ─────────────────────────────────────────────────────────────────────────────
# RCM SMS Webhook
# Handles delivery status reports and inbound SMS from RCM Push URL.
# Configure in RCM Portal: Settings → Push URL → <crm>/api/webhooks/rcm-sms
# ─────────────────────────────────────────────────────────────────────────────
import os
import json as _cw_json  # named to avoid collision with top-level json usage


@router.post("/api/webhooks/rcm-sms")
async def rcm_sms_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Receive delivery receipts and inbound SMS from RCM.

    Security: Validates X-RCM-Webhook-Secret header against the
    RCM_WEBHOOK_SECRET environment variable.
    """
    # ── 1. Auth ───────────────────────────────────────────────────────────────
    expected_secret = os.getenv("RCM_WEBHOOK_SECRET", "")
    incoming_secret = request.headers.get("X-RCM-Webhook-Secret", "")

    if expected_secret and incoming_secret != expected_secret:
        logger.warning("[SMS Webhook] Invalid secret")
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

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

        lead = db.query(models.Lead).filter(
            (models.Lead.phone == from_number) |
            (models.Lead.phone_secondary == from_number)
        ).first()

        inbound_log = models.SmsLog(
            direction="inbound",
            status="received",
            phone_number=from_number,
            message_text=message_text,
            lead_id=lead.id if lead else None,
        )
        db.add(inbound_log)
        db.commit()
        logger.info("[SMS Webhook] Inbound from %s, lead=%s", from_number, lead.id if lead else "unknown")
        return {"status": "ok", "type": "incoming"}

    logger.debug("[SMS Webhook] Unrecognised event type: %s", event_type)
    return {"status": "ok", "type": "ignored"}
