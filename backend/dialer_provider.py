# ── dialer_provider.py — Abstract Dialer Provider interface ─────────────────
"""
Defines the DialerProvider ABC that all calling providers must implement.
Standard call event types used for webhook normalization.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


# ── Standard Call Event Types ────────────────────────────────────────────────
class CallEventType:
    CALL_STARTED        = "CALL_STARTED"
    CALL_ANSWERED       = "CALL_ANSWERED"
    CALL_ENDED          = "CALL_ENDED"
    TRANSCRIPTION_READY = "TRANSCRIPTION_READY"
    CALL_TAGGED         = "CALL_TAGGED"          # V39: Aircall mandatory tag → auto-log outcome


@dataclass
class NormalizedCallEvent:
    """Provider-agnostic call event produced by webhook normalization."""
    event_type:       str                      # CallEventType constant
    provider:         str                      # "aircall" | "rcm"
    provider_call_id: str                      # External call ID from provider
    phone_number:     Optional[str] = None
    user_email:       Optional[str] = None     # For auto-matching CRM user
    direction:        Optional[str] = None     # "inbound" | "outbound"
    duration:         Optional[int] = None     # seconds (available on CALL_ENDED)
    recording_url:    Optional[str] = None
    transcript:       Optional[str] = None
    transcript_url:   Optional[str] = None
    started_at:       Optional[datetime] = None
    answered_at:      Optional[datetime] = None
    ended_at:         Optional[datetime] = None
    raw_payload:      Optional[dict] = field(default_factory=dict)
    tags:            Optional[list] = None         # V39: Aircall tag names from call.tagged event


@dataclass
class InitiateCallResult:
    """Result returned when a call is initiated via a provider."""
    success:          bool
    provider:         str
    provider_call_id: Optional[str] = None
    phone_number:     Optional[str] = None
    error:            Optional[str] = None
    # RCM browser calling fields (LiveKit WebRTC)
    livekit_token:    Optional[str] = None
    livekit_url:      Optional[str] = None
    room_name:        Optional[str] = None
    agent_join_via_phone: Optional[bool] = None


class DialerProvider(ABC):
    """
    Abstract base class for dialer providers.
    Each provider (Aircall, RCM, etc.) implements these methods.
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Unique provider identifier (e.g., 'aircall', 'rcm')."""
        ...

    @abstractmethod
    def initiate_call(self, phone_number: str, user_email: str, lead_id: str) -> InitiateCallResult:
        """
        Start an outbound call through this provider.
        Args:
            phone_number: The number to dial
            user_email: CRM user's email (used to find the provider user)
            lead_id: RCM lead ID for tracking
        Returns: InitiateCallResult
        """
        ...

    @abstractmethod
    def get_users(self) -> list[dict]:
        """
        List users/agents registered in this provider.
        Returns list of dicts with at minimum: { id, name, email }
        """
        ...

    @abstractmethod
    def get_numbers(self) -> list[dict]:
        """
        List available phone numbers from this provider.
        Returns list of dicts with at minimum: { id, name, number }
        """
        ...

    @abstractmethod
    def handle_webhook(self, payload: dict) -> Optional[NormalizedCallEvent]:
        """
        Normalize a provider-specific webhook payload into a standard CallEvent.
        Returns None if the event type is not relevant (e.g., SMS events).
        """
        ...

    @abstractmethod
    def test_connection(self) -> dict:
        """
        Validate that the provider credentials are working.
        Returns: { "success": bool, "message": str, "details": dict }
        """
        ...

    def fetch_call(self, provider_call_id: str) -> Optional[dict]:
        """
        Fetch a specific call's current data from the provider API.
        Used for recording URL refresh and transcript retrieval.
        Returns dict with at minimum: { recording_url, transcript }
        Default: not implemented (returns None).
        """
        return None

    def get_recording_url(self, provider_call_id: str) -> Optional[str]:
        """
        Get a fresh pre-signed recording URL for a call.
        Default: tries fetch_call() and extracts recording_url.
        """
        call = self.fetch_call(provider_call_id)
        return call.get("recording_url") if call else None
