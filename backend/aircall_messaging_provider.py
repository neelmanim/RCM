# ── aircall_messaging_provider.py — Aircall native Messaging API ───────────
"""
Implements MessagingProvider for Aircall's own SMS/WhatsApp Messaging API —
a second, independent provider alongside RCM Built-in Messaging (see
rcm_messaging_provider.py). Reuses the same account credentials
already stored for Aircall calling (SyncSettings.dialer_api_id/dialer_api_token).

API Docs: https://developer.aircall.io/api-references/ (Messages, WhatsApp)
Auth: Basic Auth (base64(api_id:api_token)) — matches aircall_provider.py's
already-proven call integration for this account.

ponytail: Aircall's own docs disagreed with themselves on the messaging
contract during investigation (2026-08-14) — one page described Basic Auth
against /numbers/:number_id/messages + /numbers/:number_id/whatsapp_messages
(what's implemented here, since it matches this account's proven auth
scheme), another described an OAuth Bearer token against
/messages/send/whatsapp/native with different field names. This has NOT been
verified against a live send. Confirm with a real test message — same
deferred-verification pattern already used for RCM's WhatsApp send —
before flipping SyncSettings.messaging_provider to "aircall" in production.
"""
import base64
import logging
from typing import Optional

import requests

from messaging_provider import (
    ConversationSummary,
    InboundMessageRecord,
    MessagingProvider,
    SendMessageResult,
)

logger = logging.getLogger(__name__)

AIRCALL_API_BASE = "https://api.aircall.io/v1"


class AircallMessagingProvider(MessagingProvider):
    """Aircall's native Messaging API implementation."""

    provider_name = "aircall"

    def __init__(self, api_id: str, api_token: str, number_id: str):
        self._api_id = api_id
        self._api_token = api_token
        self._number_id = number_id

    def _auth_header(self) -> dict:
        creds = base64.b64encode(f"{self._api_id}:{self._api_token}".encode()).decode()
        return {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}

    def _post(self, path: str, data: dict) -> dict:
        resp = requests.post(f"{AIRCALL_API_BASE}{path}", headers=self._auth_header(), json=data, timeout=15)
        resp.raise_for_status()
        if not resp.content or not resp.content.strip():
            return {}
        return resp.json()

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        resp = requests.get(f"{AIRCALL_API_BASE}{path}", headers=self._auth_header(), params=params, timeout=15)
        resp.raise_for_status()
        if not resp.content or not resp.content.strip():
            return {}
        return resp.json()

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
        if not text and not template_name:
            return SendMessageResult(
                success=False, provider=self.provider_name, channel=channel,
                error="Either 'text' or 'template_name' must be provided.",
            )
        path = f"/numbers/{self._number_id}/{'whatsapp_messages' if channel == 'whatsapp' else 'messages'}"
        body = {"to": phone}
        if template_name:
            body["template_id"] = template_name
        else:
            body["body"] = text
        try:
            result = self._post(path, body)
        except Exception as e:
            logger.error(f"[AircallMessaging] send failed: {e}")
            return SendMessageResult(success=False, provider=self.provider_name, channel=channel, error=str(e))
        message_id = result.get("id") or (result.get("message") or {}).get("id")
        return SendMessageResult(
            success=True, provider=self.provider_name, channel=channel,
            message_id=str(message_id) if message_id is not None else None,
        )

    def list_recent_conversations(self, count: int = 100) -> list[ConversationSummary]:
        """
        ponytail: Aircall has no thread/conversation grouping the way
        RCM's Converse Desk does — this groups individual messages
        from /numbers/:number_id/messages by counterpart phone number as a
        best-effort stand-in. Aircall's Messages resource also supports real
        webhooks (the same mechanism the existing call integration already
        uses in dialer_service.handle_webhook) — that's the right long-term
        fix for inbound capture instead of polling; not built here, add when
        Aircall messaging is actually enabled for an org.
        """
        try:
            result = self._get(f"/numbers/{self._number_id}/messages", params={"per_page": count})
        except Exception as e:
            logger.error(f"[AircallMessaging] list_recent_conversations failed: {e}")
            return []
        by_phone: dict = {}
        for m in result.get("messages", []):
            phone = m.get("to") if m.get("direction") == "outbound" else m.get("from")
            if not phone:
                continue
            by_phone[phone] = m
        return [
            ConversationSummary(
                conversation_id=str(m.get("id")),
                phone_number=phone,
                last_message_direction="inbound" if m.get("direction") == "inbound" else "outbound",
            )
            for phone, m in by_phone.items()
        ]

    def get_inbound_messages(self, conversation_id: str) -> list[InboundMessageRecord]:
        """conversation_id here is the individual message id returned by
        list_recent_conversations() above — Aircall has no separate thread id."""
        try:
            result = self._get(f"/messages/{conversation_id}")
        except Exception as e:
            logger.error(f"[AircallMessaging] get_inbound_messages failed: {e}")
            return []
        m = result.get("message", result)
        if m.get("direction") != "inbound":
            return []
        return [InboundMessageRecord(
            provider_message_id=str(m.get("id")),
            phone_number=m.get("from") or "",
            text=m.get("body") or "",
            channel="whatsapp" if m.get("type") == "whatsapp" else "sms",
        )]
