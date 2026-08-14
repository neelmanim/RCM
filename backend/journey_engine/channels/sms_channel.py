# ── journey_engine/channels/sms_channel.py ───────────────────────────────────
"""
SMS channel for Sales Journey — wraps the existing RCM SMS send path
(routes/sms_routes.py -> rcm_sms_service.send_sms) rather than
reimplementing it or a new vendor integration. This is the same real,
already-shipped provider the Floating Widget's manual "send SMS" button uses;
a cadence's sms node is just a second, automated caller of that same
function.
"""
import logging

import rcm_sms_service as sms_service
import models
from journey_engine.merge_fields import apply_merge_fields as _apply_merge_fields
from routes._admin_helpers import _get_or_create_sync_settings

from .base import ChannelProvider, SendResult, resolve_destination_phone

logger = logging.getLogger(__name__)

# 1600 chars matches the common carrier-level cap this codebase's own
# competitive research found (10 segments of 160 chars) — RCM doesn't
# document a harder limit of its own, so this is the same ceiling the builder
# validates against (nodeDefaults.js SMS_MAX_LENGTH).
SMS_MAX_LENGTH = 1600


class SMSChannelProvider(ChannelProvider):
    channel_name = "sms"

    def send(self, db, lead, journey, node_data: dict, enrollment=None, node_id: str = None) -> SendResult:
        if not lead.phone:
            return SendResult(success=False, error="Lead has no phone number", retryable=False)

        settings = _get_or_create_sync_settings(db)

        destination_phone, err = resolve_destination_phone(lead, settings)
        if err:
            return SendResult(success=False, error=err, retryable=False)

        if not settings.rcm_enabled:
            return SendResult(success=False, error="RCM SMS is not enabled (Settings → SMS)", retryable=True)
        api_key = settings.rcm_api_key or ""
        from_number = settings.rcm_from_number or ""
        if not api_key or not from_number:
            return SendResult(success=False, error="RCM SMS is enabled but not fully configured (API key / from number)", retryable=True)

        message = _apply_merge_fields(node_data.get("message", ""), lead)
        result = sms_service.send_sms(api_key, from_number, destination_phone, message)

        # Log every attempt regardless of outcome — same convention as the
        # Floating Widget's manual send (routes/sms_routes.py).
        db.add(models.SmsLog(
            message_id=result.get("message_id"),
            lead_id=lead.id,
            user_id=journey.owner_id,
            direction="outbound",
            status="sent" if result["success"] else "failed",
            phone_number=destination_phone,
            message_text=message,
            journey_id=journey.id,
            enrollment_id=enrollment.id if enrollment else None,
            journey_node_id=node_id,
        ))
        db.flush()

        if result["success"]:
            return SendResult(success=True, provider_ref=result["message_id"])
        # RCM's API doesn't distinguish permanent (bad number) from
        # transient (rate limit) failures in its response — treat as
        # retryable, same posture as email's generic 5xx handling; a bad
        # number will exhaust MAX_SEND_ATTEMPTS and fail the enrollment
        # rather than retry forever.
        return SendResult(success=False, error=result.get("error", "SMS send failed"), retryable=True)
