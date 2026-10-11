# ── messaging_provider_provider.py ────────────────────────────────────────
"""
MessagingProvider implementation wrapping conversations_service.

No new send/auth/session logic here — that already exists and works (it's
what the Alternate Messenger Widget calls live in production). This adapts it to the
provider-agnostic MessagingProvider shape so the Sales Cadence engine's
WhatsApp/SMS channels can call "a messaging provider" without knowing it's
Alternate Messenger specifically, the same way sms_channel.py's eventual counterpart
should, and the same way dialer_service.py already does for voice calls.
"""
from typing import Optional

from conversations_service import get_conversations_service
from messaging_provider import (
    ConversationSummary,
    InboundMessageRecord,
    MessagingProvider,
    SendMessageResult,
)

_DIRECTION_MAP = {"IN": "inbound", "OUT": "outbound"}


class AlternateMessagingProvider(MessagingProvider):
    provider_name = "messenger"

    def __init__(self, api_key: str, user_id: str, account_id: str):
        self._svc = get_conversations_service(api_key=api_key, user_id=user_id, account_id=account_id)

    def send(
        self,
        phone: str,
        channel: str,
        sender_id: str,
        text: Optional[str] = None,
        template_name: Optional[str] = None,
        contact_first_name: str = "",
        conversation_id: Optional[str] = None,
    ) -> SendMessageResult:
        conv_id_int = int(conversation_id) if conversation_id else None

        try:
            if template_name:
                templates = self._svc.get_whatsapp_templates()
                matched = next((t for t in templates if t.name == template_name), None)
                if not matched:
                    return SendMessageResult(
                        success=False, provider=self.provider_name, channel=channel,
                        error=f"Template '{template_name}' not found or not registered with WhatsApp.",
                    )
                result = self._svc.send_whatsapp_template(
                    phone=phone, sender_id=sender_id, template=matched,
                    conversation_id=conv_id_int, contact_first_name=contact_first_name,
                )
            elif text:
                result = self._svc.send_text_message(
                    phone=phone, sender_id=sender_id, text=text,
                    conversation_id=conv_id_int, channel=channel,
                )
            else:
                return SendMessageResult(
                    success=False, provider=self.provider_name, channel=channel,
                    error="Either 'text' or 'template_name' must be provided.",
                )
        except Exception as e:
            return SendMessageResult(success=False, provider=self.provider_name, channel=channel, error=str(e))

        sent_conv_id = result.get("conversation_id") or conversation_id
        return SendMessageResult(
            success=True,
            provider=self.provider_name,
            channel=channel,
            message_id=result.get("temp_unique_id"),
            conversation_id=str(sent_conv_id) if sent_conv_id else None,
        )

    def list_recent_conversations(self, count: int = 100) -> list[ConversationSummary]:
        conversations = self._svc.get_conversations(phone=None, count=count, include_all_statuses=True)
        return [
            ConversationSummary(
                conversation_id=str(c.id),
                phone_number=c.mobile_number,
                last_message_direction=_DIRECTION_MAP.get(c.last_message_direction, "outbound"),
            )
            for c in conversations
        ]

    def get_inbound_messages(self, conversation_id: str) -> list[InboundMessageRecord]:
        thread = self._svc.get_thread(int(conversation_id))
        return [
            InboundMessageRecord(
                provider_message_id=str(m.message_id),
                phone_number=m.mobile_number,
                text=m.text,
                channel=m.channel,
            )
            for m in thread.incoming
        ]
