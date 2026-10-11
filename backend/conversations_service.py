"""
Alternate Messenger Conversations Service (SDK)
---------------------------------------
Fully native REST integration with the Alternate Messenger Converse Desk API.
No iframe required.

Reverse-engineered auth flow (verified 2026-05-12):
  1. HMAC authenticate → sets mAgIC_pAnDa + mAgIC_r_pAnDa session cookies
  2. Persist cookie jar across all subsequent requests
  3. Use Authorization: JWT <token> header  ← NOT Bearer

Confirmed working endpoints (live-captured 2026-05-12):
  GET  /api/v2/converse_desk/conversation           – list conversations
  GET  /api/v2/converse_desk/conversation/messages  – full thread
  GET  /api/v2/converse_desk/conversation/count     – count
  GET  /api/v2/converse_desk/pinned-conversation    – pinned list
  POST /api/v2/filter_templates                     – WhatsApp template list
  POST /api/v2/converse_desk/converse               – ✅ SEND (NOT /message/send!)

  The send endpoint /api/v2/converse_desk/converse was discovered by intercepting
  the Alternate Messenger web UI network traffic. The previously-attempted /api/v2/message/send
  endpoint is a different route that requires separate API-level permissions and
  was returning "Message details missing" for our account.

Session-state rules (when WhatsApp requires a template):
  • is_live == 1  OR  last_message_direction == "IN"  → free text allowed
  • Otherwise (expired window / new contact) → MTM template REQUIRED
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional, Union

from phone_utils import _normalize_digits, _digits_suffix_match

logger = logging.getLogger(__name__)

CONVERSE_DESK_BASE = "https://app.alternatecrm.com"
TOKEN_TTL_SECONDS = 7200  # 2 hours — refresh proactively


def _phone_digits_match(a: str, b: str) -> bool:
    """Suffix-tolerant digit match — same helper dialer_service.py uses for
    webhook phone matching, reused here rather than re-derived a third time
    (routes/conversations_routes.py's _phone_matches_lead delegates to this)."""
    return _digits_suffix_match(_normalize_digits(a), _normalize_digits(b))


# ──────────────────────────────────────────────────────────────────────────────
# Dataclasses
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class MessengerMessage:
    message_id: int
    text: str
    direction: str          # "in" | "out"
    channel: str            # "whatsapp" | "sms"
    created_on: str
    sender_id: str
    mobile_number: str
    delivery_status: Optional[str] = None
    sent_status: Optional[str] = None
    attach_url: Optional[str] = None
    visual_indicator: Optional[str] = None
    user_name: Optional[str] = None
    response_id: Optional[str] = None
    content: Optional[dict] = None


@dataclass
class ConversationSummary:
    id: int
    mobile_number: str
    contact_phone: str
    contact_name: str
    channel: str            # "whatsapp" | "sms"
    status: str             # "open" | "closed"
    last_message_text: str
    last_message_direction: str   # "IN" | "OUT"
    unread_message_count: int
    modified_at: str
    sender_id: str
    owner_id: int
    crm_name: str
    is_session_expired: int
    visual_indicator: Optional[str] = None
    is_live: int = 0
    last_message_delivery_status: Optional[str] = None
    reference_id: Optional[str] = None


@dataclass
class ConversationThread:
    conversation_id: int
    outgoing: List = field(default_factory=list)
    incoming: List = field(default_factory=list)

    @property
    def all_messages(self):
        """Chronologically sorted messages (outgoing + incoming merged).
        created_on format is unverified against a live sample — try a real
        datetime parse for the whole list first; if any entry doesn't parse,
        fall back to the original plain-string sort rather than risk comparing
        a mix of datetime and str (which raises TypeError)."""
        all_msgs = self.outgoing + self.incoming
        try:
            return sorted(all_msgs, key=lambda m: datetime.fromisoformat(m.created_on.replace("Z", "+00:00")))
        except (ValueError, AttributeError):
            return sorted(all_msgs, key=lambda m: m.created_on)


@dataclass
class MessageTemplate:
    id: int
    name: str
    template_text: str         # raw with ${contacts.first_name} placeholders
    content: dict              # full components object for send payload
    channel: str = "whatsapp"
    is_registered: bool = True


@dataclass
class ConversationStatus:
    conversation_id: Optional[int]
    channel: str                    # "whatsapp" | "sms"
    requires_template: bool         # True = must use MTM template
    is_live: int                    # 1 = session window open
    last_direction: str             # "IN" | "OUT" | ""
    sender_id: str                  # active sender number


# ──────────────────────────────────────────────────────────────────────────────
# Service
# ──────────────────────────────────────────────────────────────────────────────

class AlternateMessengerService:
    """
    Stateful session client for the Alternate Messenger Converse Desk API.

    SDK Usage:
        svc = AlternateMessenger(api_key, user_id, account_id)

        # Check session state for a lead
        state = svc.get_session_state("919019280470", sender_id="918956778474")
        if state.requires_template:
            templates = svc.get_whatsapp_templates()
            # show picker, let SDR choose template…
            result = svc.send_whatsapp_template(
                phone="919019280470",
                sender_id="918956778474",
                template=templates[0],
                contact_first_name="Ravi",
                conversation_id=state.conversation_id,
            )
        else:
            result = svc.send_text_message(
                phone="919019280470",
                sender_id="918956778474",
                text="Hey, following up!",
                conversation_id=state.conversation_id,
            )
    """

    def __init__(self, api_key: str, user_id: str, account_id: str):
        self.api_key = api_key
        self.user_id = str(user_id)
        self.account_id = str(account_id)

        # Cookie jar — persists mAgIC_pAnDa and mAgIC_r_pAnDa across all calls
        self._jar = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._jar)
        )
        self._token: Optional[str] = None
        self._token_expires_at: float = 0.0

    # ──────────────────────────────────────────────
    # Auth
    # ──────────────────────────────────────────────

    def _ensure_authenticated(self) -> str:
        """Return a valid JWT, refreshing if within 5 min of expiry."""
        if self._token and time.time() < (self._token_expires_at - 300):
            return self._token
        self._token = self._authenticate()
        self._token_expires_at = time.time() + TOKEN_TTL_SECONDS
        return self._token

    def _authenticate(self) -> str:
        """
        HMAC authenticate against Alternate Messenger.
        Side-effect: sets mAgIC_pAnDa + mAgIC_r_pAnDa session cookies in jar.
        """
        now = datetime.now(timezone.utc)
        ts = now.strftime("%Y-%m-%dT%H:%M:%S.") + now.strftime("%f")[:3] + "Z"
        msg = f"userId={self.user_id}&timestamp={ts}&"
        sig = base64.b64encode(
            hmac.new(self.api_key.encode(), msg.encode(), hashlib.sha256).digest()
        ).decode()
        qs = "&".join([
            "crm=audience_manager",
            f"userId={self.user_id}",
            f"apiKey={self.api_key}",
            f"timestamp={urllib.parse.quote(ts)}",
            f"signature={urllib.parse.quote(sig)}",
        ])
        url = f"{CONVERSE_DESK_BASE}/api/v2/crm/authenticate?{qs}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with self._opener.open(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        token = data.get("access_token")
        if not token:
            raise RuntimeError(f"Alternate Messenger auth failed: {data}")
        logger.info("Alternate Messenger auth refreshed. Cookies: %s",
                    [c.name for c in self._jar])
        return token

    # ──────────────────────────────────────────────
    # HTTP helpers
    # ──────────────────────────────────────────────

    def _get(self, path: str, params: dict) -> dict | list:
        token = self._ensure_authenticated()
        url = f"{CONVERSE_DESK_BASE}{path}?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={
            "Authorization": f"JWT {token}",
            "Accept": "application/json, text/plain, */*",
            "Referer": f"{CONVERSE_DESK_BASE}/inbox",
            "Origin": CONVERSE_DESK_BASE,
            "User-Agent": "Alternate CRM-CRM/5.0",
        })
        try:
            with self._opener.open(req, timeout=15) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            logger.error("GET %s → %d: %s", path, e.code, body[:200])
            raise RuntimeError(f"HTTP {e.code}: {body[:300]}") from e

    def _post(self, path: str, body: dict) -> dict:
        token = self._ensure_authenticated()
        url = f"{CONVERSE_DESK_BASE}{path}"
        data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, headers={
            "Authorization": f"JWT {token}",
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Referer": f"{CONVERSE_DESK_BASE}/inbox",
            "Origin": CONVERSE_DESK_BASE,
            "User-Agent": "Alternate CRM-CRM/5.0",
        }, method="POST")
        try:
            with self._opener.open(req, timeout=20) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body_text = e.read().decode(errors="replace")
            logger.error("POST %s → %d: %s", path, e.code, body_text[:500])
            raise RuntimeError(f"HTTP {e.code}: {body_text[:300]}") from e

    # ──────────────────────────────────────────────
    # Conversations
    # ──────────────────────────────────────────────

    def get_conversations(
        self,
        phone: Optional[str] = None,
        status: str = "open",
        count: int = 20,
        index: int = 0,
        include_all_statuses: bool = False,
    ) -> list[Conversation]:
        """
        List conversations, optionally filtered by phone number.

        Args:
            phone: E.164 or local format e.g. "919019280470"
            status: "open" | "closed" (ignored if include_all_statuses=True)
            count: page size
            index: page offset
            include_all_statuses: if True, omit status filter
        """
        params: dict = {
            "account_id": self.account_id,
            "count": str(count),
            "filter": "All",
            "index": str(index),
            "is_bot": "0",
            "is_sent": "0",
            "is_spam": "0",
            "is_voice": "0",
            "owner_id": self.user_id,
            "query": phone or "",
        }
        if not include_all_statuses:
            params["status"] = status
        if phone:
            params["mobile_number"] = phone

        raw = self._get("/api/v2/converse_desk/conversation", params)
        items = raw if isinstance(raw, list) else raw.get("conversations", [])
        parsed = [self._parse_conversation(c) for c in items]

        if phone:
            # Observed live on staging: Alternate Messenger's own mobile_number/query
            # filter does not reliably filter server-side — when the phone
            # doesn't match cleanly (e.g. missing/extra country code, or no
            # conversation exists yet for this contact), it has been seen
            # silently falling back to unrelated recent conversations for the
            # whole account instead of an empty list. That's a real
            # cross-contact data leak (get_session_state picked another
            # lead's conversation as if it were this phone's; the /messages
            # ownership check would have accepted it too). Every caller
            # (get_conversations_for_lead, list_conversations route) routes
            # through here, so verifying client-side once fixes it for all
            # of them rather than patching each caller separately.
            parsed = [c for c in parsed if _phone_digits_match(c.mobile_number, phone)]

        return parsed

    def get_conversations_for_lead(self, phone: str) -> list[Conversation]:
        """
        Convenience: get all (open + closed) conversations for a specific lead.
        Normalizes phone to remove leading + and spaces.
        """
        normalized = phone.lstrip("+").replace(" ", "").replace("-", "")
        return self.get_conversations(phone=normalized, include_all_statuses=True)

    def get_thread(self, conversation_id: int, count: int = 50, index: int = 0) -> ConversationThread:
        """Fetch full message thread. Returns ConversationThread with .all_messages."""
        raw = self._get("/api/v2/converse_desk/conversation/messages", {
            "conversation_id": str(conversation_id),
            "count": str(count),
            "index": str(index),
        })
        outgoing = [self._parse_message(m) for m in raw.get("outgoing", [])]
        incoming = [self._parse_message(m) for m in raw.get("incoming", [])]
        return ConversationThread(
            conversation_id=conversation_id,
            outgoing=outgoing,
            incoming=incoming,
        )

    def get_conversation_count(self) -> int:
        """Total conversation count for the owner."""
        raw = self._get("/api/v2/converse_desk/conversation/count", {
            "account_id": self.account_id,
            "owner_id": self.user_id,
        })
        return int(raw) if isinstance(raw, (int, str)) else 0

    def get_pinned_conversations(self) -> list[Conversation]:
        """Return pinned conversations."""
        raw = self._get("/api/v2/converse_desk/pinned-conversation", {
            "account_id": self.account_id,
        })
        items = raw if isinstance(raw, list) else []
        return [self._parse_conversation(c) for c in items]

    # ──────────────────────────────────────────────
    # Session state
    # ──────────────────────────────────────────────

    def get_session_state(self, phone: str, sender_id: str, channel: str = "whatsapp") -> SessionState:
        """
        Determine whether the WhatsApp session window is open for a phone number.

        Session rules (sourced from live Alternate Messenger UI behaviour):
          • is_live == 1  OR  last_message_direction == "IN"
            → free-text messaging is allowed
          • All other states (expired window, no conversation)
            → MTM WhatsApp template REQUIRED

        Returns a SessionState dataclass  flag.
        """
        channel_lower = channel.lower()

        if channel_lower == "sms":
            # SMS never requires a template, but the conversation_id still needs
            # a real lookup (same as the WhatsApp branch below) — previously
            # hardcoded to None, which meant SMS history could never be fetched.
            conversations = self.get_conversations_for_lead(phone)
            sms_convs = [c for c in conversations if c.channel.lower() == "sms"]
            conversation_id = None
            if sms_convs:
                conversation_id = sorted(sms_convs, key=lambda c: c.modified_at, reverse=True)[0].id
            return SessionState(
                conversation_id=conversation_id,
                channel="sms",
                requires_template=False,
                is_live=1,
                last_direction="",
                sender_id=sender_id,
            )

        # WhatsApp — check conversation state
        conversations = self.get_conversations_for_lead(phone)
        # Filter to WhatsApp conversations only
        wa_convs = [c for c in conversations if c.channel.lower() == "whatsapp"]

        if not wa_convs:
            # No prior conversation → template required to open new thread
            return SessionState(
                conversation_id=None,
                channel="whatsapp",
                requires_template=True,
                is_live=0,
                last_direction="",
                sender_id=sender_id,
            )

        # Sort by most recently modified
        latest = sorted(wa_convs, key=lambda c: c.modified_at, reverse=True)[0]

        # Session is live if is_live flag set OR last incoming message exists
        is_live = latest.is_live == 1
        last_in = latest.last_message_direction.upper() == "IN"
        requires_template = not (is_live or last_in)

        return SessionState(
            conversation_id=latest.id,
            channel="whatsapp",
            requires_template=requires_template,
            is_live=latest.is_live,
            last_direction=latest.last_message_direction,
            sender_id=latest.sender_id or sender_id,
        )

    # ──────────────────────────────────────────────
    # Templates
    # ──────────────────────────────────────────────

    def get_whatsapp_templates(
        self,
        search: str = "",
        count: int = 50,
        index: int = 0,
    ) -> list[WhatsAppTemplate]:
        """
        Fetch all WhatsApp MTM templates registered with the account.

        Uses the exact payload captured from live Alternate Messenger UI (2026-05-12).
        Filters: channel_type=["WhatsApp","Registered"], template_type=[3],
                 is_whatsapp_mtm_template=true, validity_status=true.
        """
        raw = self._post("/api/v2/filter_templates", {
            "index": index,
            "count": count,
            "channel_type": ["WhatsApp", "Registered"],
            "search_text": search,
            "template_type": [3],
            "module_type": ["contacts"],
            "crm_name": ["audience_manager"],
            "template_label": [],
            "validity_status": True,
            "created_by": [],
            "generic": False,
            "folder_ids": [],
        })

        items = raw if isinstance(raw, list) else raw.get("result", [])
        templates = []
        for item in items:
            if not item.get("is_whatsapp_mtm_template"):
                continue
            content = item.get("content", {})
            templates.append(WhatsAppTemplate(
                id=item.get("id", 0),
                name=item.get("name", ""),
                template_text=item.get("template", ""),
                content=content,
                channel="whatsapp",
                is_registered=True,
            ))
        return templates

    # ──────────────────────────────────────────────
    # Sending
    # ──────────────────────────────────────────────

    def send_whatsapp_template(
        self,
        phone: str,
        sender_id: str,
        template: WhatsAppTemplate,
        conversation_id: Optional[int],
        contact_first_name: str = "",
        reference_type: str = "contacts",
        reference_id: str = "",
    ) -> dict:
        """
        Send a WhatsApp MTM template message via Converse Desk.

        Uses the live-captured endpoint:  POST /api/v2/converse_desk/converse
        (NOT /api/v2/message/send — that endpoint requires different permissions)

        Variable substitution: ${contacts.first_name} → contact_first_name
        Fallback: if name is blank, leaves variable as-is (Alternate Messenger resolves server-side).

        Args:
            phone: recipient phone without + e.g. "919545455721"
            sender_id: Alternate Messenger sender e.g. "918956778474"
            template: WhatsAppTemplate from get_whatsapp_templates()
            conversation_id: existing conversation ID (None = new thread)
            contact_first_name: resolved first name for ${contacts.first_name}
            reference_type: CRM module type ("contacts" | "leads" etc.)
            reference_id: CRM record ID
        """
        normalized_phone = phone.lstrip("+").replace(" ", "").replace("-", "")

        # Resolve ${contacts.first_name} if we have the name
        resolved_text = template.template_text
        if contact_first_name:
            resolved_text = re.sub(
                r"\$\{contacts\.first_name\}",
                contact_first_name,
                resolved_text,
            )

        # RCA 2026-08-25 (live-verified against a real get_whatsapp_templates()
        # response): `message_text` above is a display-only mirror — Alternate Messenger
        # validates the *send* against `content.components[].text`, which still
        # carries the raw ${contacts.first_name} placeholder unless resolved
        # here too. Left unresolved, Alternate Messenger rejects the send outright:
        # "number of localizable_params (0) does not match the expected
        # number of params (1)". Apply the same substitution to every
        # component's text, not just `body` — a future template could put a
        # variable in any component.
        resolved_content = json.loads(json.dumps(template.content))  # deep copy
        if contact_first_name:
            for component in resolved_content.get("components", []):
                if component.get("text"):
                    component["text"] = re.sub(
                        r"\$\{contacts\.first_name\}",
                        contact_first_name,
                        component["text"],
                    )

        # Build the exact payload structure captured from the Alternate Messenger UI
        payload: dict = {
            "channel": "whatsapp",
            "message_text": resolved_text,
            "phone_number": normalized_phone,
            "owner_id": int(self.user_id),
            "media_url": "",
            "country_id": "-1",
            "sender_id": sender_id,
            "content": resolved_content,
            "temp_unique_id": self._temp_id(),
            "reference_type": reference_type,
        }

        if conversation_id is not None:
            payload["conversation_id"] = conversation_id

        if reference_id:
            payload["reference_id"] = reference_id

        logger.info(
            "Sending WhatsApp template '%s' to %s via /converse_desk/converse",
            template.name, normalized_phone,
        )
        result = self._post("/api/v2/converse_desk/converse", payload)
        # Our own generated tracking id — merged in (not overwriting anything
        # Alternate Messenger returns) so callers can persist the exact key this send
        # used, without re-deriving or guessing it.
        result.setdefault("temp_unique_id", payload["temp_unique_id"])
        return result

    def send_text_message(
        self,
        phone: str,
        sender_id: str,
        text: str,
        conversation_id: Optional[int],
        channel: str = "whatsapp",
        reference_type: str = "contacts",
        reference_id: str = "",
    ) -> dict:
        """
        Send a free-text message (only valid when session window is open).

        Args:
            phone: recipient phone, e.g. "919545455721" or "+14692466072"
            sender_id: Alternate Messenger sender e.g. "918956778474"
            text: message body text
            conversation_id: existing conversation ID
            channel: "whatsapp" | "sms"
            reference_type: CRM module type
            reference_id: CRM record ID
        """
        # RCA 2026-09-30: country_id=-1 means "auto-detect", but without a
        # leading "+" Alternate Messenger apparently assumes the account's own home
        # country (India) — a bare US number like "14692466072" then fails
        # validation as a malformed Indian number ("Invalidmobilenumbererror"
        # on Alternate Messenger's own dashboard, even though converse_desk/converse
        # itself returns 200). Keeping the "+" (E.164) lets -1 read the real
        # country code. Every number this codebase has sent until now has
        # been Indian without a "+", so this only changes behavior for a
        # number that wasn't being reached correctly before.
        digits = phone.lstrip("+").replace(" ", "").replace("-", "")
        normalized_phone = f"+{digits}"

        payload: dict = {
            "channel": channel.lower(),
            "message_text": text,
            "phone_number": normalized_phone,
            "owner_id": int(self.user_id),
            "media_url": "",
            "country_id": "-1",
            "sender_id": sender_id,
            "temp_unique_id": self._temp_id(),
            "reference_type": reference_type,
        }

        if conversation_id is not None:
            payload["conversation_id"] = conversation_id

        if reference_id:
            payload["reference_id"] = reference_id

        logger.info(
            "Sending free-text %s message to %s via /converse_desk/converse",
            channel, normalized_phone,
        )
        result = self._post("/api/v2/converse_desk/converse", payload)
        result.setdefault("temp_unique_id", payload["temp_unique_id"])
        return result

    # ──────────────────────────────────────────────
    # Parsers
    # ──────────────────────────────────────────────

    @staticmethod
    def _parse_conversation(raw: dict) -> Conversation:
        return Conversation(
            id=raw["id"],
            mobile_number=raw.get("mobile_number", ""),
            contact_phone=raw.get("contact_phone", ""),
            contact_name=raw.get("contact_name") or raw.get("title", "Unknown"),
            channel=raw.get("channel", "sms"),
            status=raw.get("status", "open"),
            last_message_text=raw.get("last_message_text", ""),
            last_message_direction=raw.get("last_message_direction", ""),
            unread_message_count=raw.get("unread_message_count", 0),
            modified_at=raw.get("modified_at", ""),
            sender_id=raw.get("sender_id", ""),
            owner_id=raw.get("owner_id", 0),
            crm_name=raw.get("crm_name", ""),
            is_session_expired=raw.get("is_session_expired", 0),
            visual_indicator=raw.get("visual_indicator"),
            is_live=raw.get("is_live", 0),
            last_message_delivery_status=raw.get("last_message_delivery_status"),
            reference_id=raw.get("reference_id"),
        )

    @staticmethod
    def _parse_message(raw: dict) -> ConversationMessage:
        return ConversationMessage(
            message_id=raw.get("message_id", 0),
            text=raw.get("text", ""),
            direction=raw.get("direction", ""),
            channel=raw.get("channel", ""),
            created_on=raw.get("created_on", ""),
            sender_id=raw.get("sender_id", ""),
            mobile_number=raw.get("mobile_number", ""),
            delivery_status=raw.get("delivery_status"),
            sent_status=raw.get("sent_status"),
            attach_url=raw.get("attach_url") or None,
            visual_indicator=raw.get("visual_indicator"),
            user_name=raw.get("user_name"),
            response_id=raw.get("response_id"),
            content=raw.get("content"),
        )

    @staticmethod
    def _temp_id() -> str:
        """Generate a temp_unique_id matching the format used by the Alternate Messenger UI."""
        import uuid
        u = uuid.uuid4().hex
        return f"{u[:6]}-{u[6:9]}-{u[9:13]}-{u[13:16]}-{u[16:28]}"


# ──────────────────────────────────────────────────────────────────────────────
# Singleton factory — reuse session across the app (preserves cookie jar)
# ──────────────────────────────────────────────────────────────────────────────

_instance: Optional[AlternateMessenger] = None
_instance_key: tuple = ()


def get_conversations_service(
    api_key: str,
    user_id: str,
    account_id: str,
) -> AlternateMessenger:
    """
    Return the singleton AlternateMessenger, seeded with credentials
    from SyncSettings.

    The singleton is reset if credentials change (e.g. admin updates them in
    the Settings UI), ensuring a fresh cookie jar and re-authentication.

    Typical call site (in a route):
        settings = db.query(SyncSettings).first()
        svc = get_conversations_service(
            api_key=settings.messenger_api_key,
            user_id=settings.messenger_user_id,
            account_id=settings.messenger_account_id,
        )
    """
    global _instance, _instance_key
    creds_key = (api_key, str(user_id), str(account_id))
    if _instance is None or _instance_key != creds_key:
        if not all(creds_key):
            raise RuntimeError(
                "messenger_api_key, messenger_user_id, and messenger_account_id "
                "must all be set in SyncSettings before using AlternateMessenger."
            )
        _instance = AlternateMessenger(
            api_key=api_key,
            user_id=str(user_id),
            account_id=str(account_id),
        )
        _instance_key = creds_key
        logger.info("AlternateMessenger singleton initialised (user_id=%s)", user_id)
    return _instance
