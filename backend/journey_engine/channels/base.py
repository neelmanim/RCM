# ── journey_engine/channels/base.py — Abstract Channel Provider interface ───
"""
Mirrors dialer_provider.py's DialerProvider ABC pattern: one interface,
one dataclass result shape, per-channel concrete implementations.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class SendResult:
    """Result of one channel send attempt."""
    success:      bool
    provider_ref: Optional[str] = None   # provider-side message/call id, once known
    error:        Optional[str] = None
    # Non-retryable errors (bad address, 401, invalid config) skip straight to
    # the enrollment's failed/dead-letter state instead of burning through the
    # retry schedule — see docs/SALES_JOURNEY_ARCHITECTURE.md, Fault Tolerance.
    retryable:    bool = True


def resolve_destination_phone(lead, settings):
    """Cadence/Messaging Sandbox: a test lead's own phone field is never the
    real destination — every send redirects to the org's configured sandbox
    number, unconditionally. Returns (phone, None) normally, or (None, error)
    if a test lead has no sandbox number configured — the caller returns a
    failed, non-retryable SendResult with that error. Shared by
    whatsapp_channel.py and sms_channel.py (was identical duplicated logic
    in both)."""
    if not lead.is_test:
        return lead.phone, None
    phone = getattr(settings, "sandbox_test_phone_number", None) or ""
    if not phone:
        return None, "Test lead but no sandbox_test_phone_number configured (Settings → Sandbox)"
    return phone, None


class ChannelProvider(ABC):
    """Abstract base for Sales Journey outreach channels (email/call/linkedin).

    Callers (journey_engine.engine) own the idempotency check and the
    lead-eligibility check (Gap 1) — this class only performs the send.
    """

    @property
    @abstractmethod
    def channel_name(self) -> str:
        """Unique channel identifier (e.g. 'email', 'call', 'linkedin')."""
        ...

    @abstractmethod
    def send(self, db, lead, journey, node_data: dict, enrollment=None, node_id: str = None) -> SendResult:
        """
        Perform the outreach action for one node.
        Args:
            db: active SQLAlchemy session
            lead: models.Lead instance
            journey: models.Journey instance (for owner_id / sender identity)
            node_data: the node's `data` dict from graph_definition
            enrollment: models.JourneyEnrollment instance, for engagement-tracking
                        linkage (nullable — not every provider needs it)
            node_id: the graph node id being executed, same purpose as enrollment
        Returns: SendResult
        """
        ...
