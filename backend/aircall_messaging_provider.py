# ── aircall_messaging_provider.py — Aircall native Messaging API ───────────
"""
Implements MessagingProvider for Aircall's own SMS/WhatsApp Messaging API —
a second, independent provider alongside Alternate Messenger/Messaging Provider (see
messaging_provider_provider.py). Reuses the same account credentials
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
deferred-verification pattern already used for Alternate Messenger's WhatsApp send —
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

    def __init__(self, api_id: str, api_token: str, number_id: str = ""):
        self._api_id = api_id
        self._api_token = api_token
        # Org-wide fallback only. The number a message actually goes out from is
        # normally resolved per SDR from Aircall itself — see
        # resolve_number_for_email().
        self._number_id = number_id

    def resolve_number_for_email(self, email: str) -> str:
        """The Aircall number_id this SDR should send from, discovered from
        Aircall rather than typed in by an admin.

        Aircall already knows which numbers each user owns, and calling has
        always used exactly this (aircall_provider.initiate_call picks
        default_number_id, else the first assigned number). Messaging asking an
        admin to hand-type one org-wide Number ID instead meant every SDR sent
        from the same number, and nobody could send until someone found that ID.

        Cached because the lookup behind it is a paginated scan of /users;
        returns "" when the user isn't in Aircall or owns no numbers, and the
        caller falls back to the org-wide number.
        """
        if not email:
            return ""
        from cache import get_cached, set_cached
        cached = get_cached("aircall_msg_number", email.lower())
        if cached is not None:
            return cached

        number_id = ""
        try:
            # Reuse the calling provider's own email->user lookup rather than a
            # second implementation of Aircall's pagination.
            from aircall_provider import AircallDialerProvider
            user = AircallDialerProvider(
                api_id=self._api_id, api_token=self._api_token,
            )._find_user_by_email(email)
            if user:
                default_id = user.get("default_number_id")
                numbers = user.get("numbers") or []
                if default_id:
                    number_id = str(default_id)
                elif numbers:
                    first = numbers[0]
                    number_id = str(first.get("id") if isinstance(first, dict) else first)
        except Exception as e:
            logger.warning("[AircallMessaging] number lookup for %s failed: %s", email, e)
            return ""   # not cached — a transient API failure should be retried

        set_cached("aircall_msg_number", email.lower(), number_id, ttl=600)
        return number_id

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
        # sender_id is the resolved per-SDR number_id (messaging_service does the
        # resolving); fall back to the org-wide one when it couldn't.
        number_id = sender_id or self._number_id
        path = f"/numbers/{number_id}/{'whatsapp_messages' if channel == 'whatsapp' else 'messages'}"
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
        Alternate Messenger's Converse Desk does — this groups individual messages
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
