# ── messaging_provider_provider.py ────────────────────────────────────────
"""
Provider contract for SMS and WhatsApp.

No new send/auth/session logic here — that already exists and works (it's
what the Alternate Messenger Widget calls live in production). This adapts it to the
provider-agnostic MessagingProvider shape so the Sales Cadence engine's
WhatsApp/SMS channels can call "a messaging provider" without knowing it's
Alternate Messenger specifically, the same way sms_channel.py's eventual counterpart
should, and the same way dialer_service.py already does for voice calls.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional



@dataclass
class SendMessageResult:
    """Result of one message send attempt, regardless of vendor."""
    success:         bool
    provider:        str                       # "messenger" | "aircall"
    channel:         str                       # "sms" | "whatsapp"
    message_id:      Optional[str] = None       # provider-side tracking id
    conversation_id: Optional[str] = None
    error:           Optional[str] = None


@dataclass
class ConversationSummary:
    """One conversation thread, account-wide (not scoped to a single lead) —
    used by the inbound-sync job to discover what needs a closer look."""
    conversation_id:        str
    phone_number:           str
    last_message_direction: str      # "inbound" | "outbound"


@dataclass
class InboundMessageRecord:
    """One message from a thread, normalized across vendors — the sync job's
    unit of persistence (maps 1:1 to a models.SmsLog row)."""
    provider_message_id: str
    phone_number:         str
    text:                 str
    channel:               str       # "sms" | "whatsapp"


class MessagingProvider(ABC):
    """
    Abstract base class for messaging (SMS/WhatsApp) providers.
    Each provider (Alternate Messenger, Aircall) implements these.
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Unique provider identifier (e.g. 'messenger')."""
        ...

    @abstractmethod
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
        """
        Send an SMS or WhatsApp message.
        Exactly one of `text` / `template_name` should be provided — text for
        a free-text send (requires an open session window on WhatsApp),
        template_name for a Meta-approved-template send.
        """
        ...

    @abstractmethod
    def list_recent_conversations(self, count: int = 100) -> list[ConversationSummary]:
        """Account-wide conversation list (not scoped to one lead) — used by
        the inbound-message sync job to discover which threads need a
        closer look, rather than polling every lead individually."""
        ...

    @abstractmethod
    def get_inbound_messages(self, conversation_id: str) -> list[InboundMessageRecord]:
        """All inbound (lead-sent) messages in one thread."""
        ...
