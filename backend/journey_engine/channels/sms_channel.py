# ── journey_engine/channels/sms_channel.py ───────────────────────────────────
"""
SMS channel for Sales Journey — goes through the provider-agnostic
messaging_service resolver, exactly like whatsapp_channel.py.

v11.10.0: this used to call sms_service.send_sms() directly with
SyncSettings.messenger_from_number as the sender. That field is the Alternate Messenger
*voice* caller ID (models.py: "E.164 business caller ID for Alternate Messenger calls"),
not a messaging sender — so an org that had filled in the WhatsApp/SMS sender
(messenger_sender_id) still saw every cadence SMS fail with "not fully
configured", while WhatsApp on the very same account worked. Routing through
the shared resolver means SMS and WhatsApp now agree on the sender, respect the
per-SDR grant, and both work on either vendor.
"""
import logging

import models
from journey_engine.merge_fields import apply_merge_fields as _apply_merge_fields
from routes._admin_helpers import _get_or_create_sync_settings

from .base import ChannelProvider, SendResult, resolve_destination_phone, resolve_messaging_sender

logger = logging.getLogger(__name__)

# 1600 chars matches the common carrier-level cap this codebase's own
# competitive research found (10 segments of 160 chars) — Alternate Messenger doesn't
# document a harder limit of its own, so this is the same ceiling the builder
# validates against (nodeDefaults.js SMS_MAX_LENGTH).
SMS_MAX_LENGTH = 1600


def resolve_message(node_data: dict, lead, sender=None) -> str:
    """Pure merge-field resolution, no send — shared by SMSChannelProvider.send
    (automated) and journey_engine.engine._handle_manual_sms_node's 1st pass
    (manual: resolves the draft a rep reviews before approving). Mirrors
    email_channel.resolve_subject_body; SMS has no subject/variants."""
    return _apply_merge_fields(node_data.get("message", ""), lead, sender=sender)


class SMSChannelProvider(ChannelProvider):
    channel_name = "sms"

    def preflight(self, db, lead, journey):
        if lead.phone_invalid_at:
            return "Phone marked wrong"
        if not lead.phone and not lead.is_test:
            return "Lead has no phone number"
        _, err = resolve_destination_phone(lead, _get_or_create_sync_settings(db))
        if err:
            return err
        _, _, failure = resolve_messaging_sender(db, lead, journey, "sms")
        # A retryable failure (e.g. a provider blip) is the engine's backoff's
        # job, not a reason to refuse the rep's approval.
        return failure.error if failure and not failure.retryable else None

    def send(self, db, lead, journey, node_data: dict, enrollment=None, node_id: str = None) -> SendResult:
        if lead.phone_invalid_at:
            return SendResult(success=False, error="Phone marked wrong", retryable=False, skip=True)
        if not lead.phone and not lead.is_test:
            # Not a failure: the step just doesn't apply to a lead with no number.
            return SendResult(success=False, error="Lead has no phone number", retryable=False, skip=True)

        settings = _get_or_create_sync_settings(db)

        destination_phone, err = resolve_destination_phone(lead, settings)
        if err:
            return SendResult(success=False, error=err, retryable=False)

        # v11.10.0: resolves the cadence owner's SMS grant, vendor and sender in
        # one call — the same gate WhatsApp and the Widget use.
        # First sender candidate with a working sms grant sends — the lead's
        # rep, else the cadence owner (base.sender_candidates).
        sender, resolved, failure = resolve_messaging_sender(db, lead, journey, "sms")
        if failure:
            return failure

        message = resolve_message(node_data, lead, sender=sender)
        result = resolved.provider.send(
            phone=destination_phone,
            channel="sms",
            sender_id=resolved.sender_id,
            text=message,
            contact_first_name=lead.first_name or "",
        )

        # Log every attempt regardless of outcome — same convention as the
        # Floating Widget's manual send (routes/sms_routes.py).
        db.add(models.SmsLog(
            message_id=result.message_id,
            lead_id=lead.id,
            user_id=sender.id,
            direction="outbound",
            status="sent" if result.success else "failed",
            phone_number=destination_phone,
            message_text=message,
            channel="sms",
            provider=result.provider,
            conversation_id=result.conversation_id,
            journey_id=journey.id,
            enrollment_id=enrollment.id if enrollment else None,
            journey_node_id=node_id,
            failure_reason=None if result.success else result.error,
        ))
        db.flush()

        if result.success:
            return SendResult(success=True, provider_ref=result.message_id)
        # Alternate Messenger's API doesn't distinguish permanent (bad number) from
        # transient (rate limit) failures in its response — treat as
        # retryable, same posture as email's generic 5xx handling; a bad
        # number will exhaust MAX_SEND_ATTEMPTS and fail the enrollment
        # rather than retry forever.
        return SendResult(success=False, error=result.error or "SMS send failed", retryable=True)
