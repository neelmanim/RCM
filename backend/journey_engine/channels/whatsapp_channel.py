# ── journey_engine/channels/whatsapp_channel.py ──────────────────────────────
"""
WhatsApp channel for Sales Journey — goes through the provider-agnostic
messaging_service resolver rather than importing RCM directly, so a
future second provider (Aircall, if that stays in scope) plugs in here with
zero changes to this file or to engine.py.

A cadence's first touch to a lead is, by definition, outside any existing
conversation window — Meta requires a pre-approved template for that, not
freeform text (see docs/AGENT_PROTOCOL.md-adjacent plan notes on this). This
channel therefore expects `template_name` in node_data; free-text is only
attempted if the session window happens to already be open (a lead who
replied recently), mirroring the RCM Widget's own send-routing logic
rather than reinventing it.
"""
import logging

import models
from journey_engine.merge_fields import apply_merge_fields as _apply_merge_fields
from messaging_service import get_messaging_provider_for_org
from routes._admin_helpers import _get_or_create_sync_settings

from .base import ChannelProvider, SendResult, resolve_destination_phone

logger = logging.getLogger(__name__)


class WhatsAppChannelProvider(ChannelProvider):
    channel_name = "whatsapp"

    def send(self, db, lead, journey, node_data: dict, enrollment=None, node_id: str = None) -> SendResult:
        if not lead.phone:
            return SendResult(success=False, error="Lead has no phone number", retryable=False)

        settings = _get_or_create_sync_settings(db)

        destination_phone, err = resolve_destination_phone(lead, settings)
        if err:
            return SendResult(success=False, error=err, retryable=False)

        if not settings.rcm_enabled:
            return SendResult(success=False, error="RCM messaging is not enabled (Settings → Conversations)", retryable=True)
        sender_id = getattr(settings, "rcm_sender_id", None) or ""
        if not sender_id:
            return SendResult(success=False, error="RCM is enabled but rcm_sender_id is not set", retryable=True)

        provider = get_messaging_provider_for_org(db)
        if provider is None:
            return SendResult(success=False, error="No messaging provider is configured", retryable=True)

        template_name = node_data.get("template_name")
        free_text = _apply_merge_fields(node_data.get("message", ""), lead) if node_data.get("message") else None

        if not template_name and not free_text:
            return SendResult(success=False, error="WhatsApp node has neither a template nor a message", retryable=False)

        # If only a template is configured but the session window happens to
        # already be open, sending the template anyway is still valid (Meta
        # allows it, it's just unnecessary) — so no session-state branching
        # is needed here; only a template-less free-text send needs the
        # window actually open, and a failed attempt surfaces that via the
        # provider's own error rather than a pre-check duplicating its logic.
        result = provider.send(
            phone=destination_phone,
            channel="whatsapp",
            sender_id=sender_id,
            text=None if template_name else free_text,
            template_name=template_name,
            contact_first_name=lead.first_name or "",
        )

        # Same convention as sms_channel.py — log every attempt regardless of
        # outcome, into the same table the RCM Widget's manual sends
        # now write to.
        db.add(models.SmsLog(
            message_id=result.message_id,
            lead_id=lead.id,
            user_id=journey.owner_id,
            direction="outbound",
            status="sent" if result.success else "failed",
            phone_number=destination_phone,
            message_text=free_text or (template_name and f"[template: {template_name}]"),
            channel="whatsapp",
            provider=result.provider,
            conversation_id=result.conversation_id,
            template_name=template_name,
            journey_id=journey.id,
            enrollment_id=enrollment.id if enrollment else None,
            journey_node_id=node_id,
        ))
        db.flush()

        if result.success:
            return SendResult(success=True, provider_ref=result.message_id)
        return SendResult(success=False, error=result.error or "WhatsApp send failed", retryable=True)
