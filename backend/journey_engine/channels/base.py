# ── journey_engine/channels/base.py — Abstract Channel Provider interface ───
"""
Mirrors dialer_provider.py's DialerProvider ABC pattern: one interface,
one dataclass , per-channel concrete implementations.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

# A manual step (task, approval) waits this long for the rep before the
# cadence moves on without them. A call reminder doesn't wait at all.
DEFAULT_TASK_DUE_HOURS = 24
# Feedback item #6/#7: a manual step marked hard_stop=True must never
# auto-advance past the rep — there's no "wait forever" primitive in the
# queue (next_run_at always has a value), so this is effectively forever
# for any cadence the org will realistically still be running.
HARD_STOP_DUE_HOURS = 24 * 365 * 100


def manual_step_deadline_hours(node_data: dict) -> float:
    return HARD_STOP_DUE_HOURS if node_data.get("hard_stop") else (node_data.get("due_within_hours") or DEFAULT_TASK_DUE_HOURS)


def manual_step_due_time(node_data: dict):
    """When the rep's Task for a manual step is due: the cadence's own
    deadline for that step, so My Tasks says "Due in 23h" instead of
    "Overdue" a minute after the task appears. None for a hard stop — it
    waits for the rep however long it takes."""
    if node_data.get("hard_stop"):
        return None
    return datetime.now(timezone.utc) + timedelta(hours=manual_step_deadline_hours(node_data))


@dataclass
class ChannelSendResult:
    """Result of one channel send attempt."""
    success:      bool
    provider_ref: Optional[str] = None   # provider-side message/call id, once known
    error:        Optional[str] = None
    # Non-retryable errors (bad address, 401, invalid config) skip straight to
    # the enrollment's failed/dead-letter state instead of burning through the
    # retry schedule — see docs/SALES_JOURNEY_ARCHITECTURE.md, Fault Tolerance.
    retryable:    bool = True
    # The step can't apply to this lead (e.g. a text step, no phone number):
    # the engine logs it as skipped and moves on instead of failing the
    # whole enrollment. Playbook rule: "text only once a number exists".
    skip:         bool = False


def sender_candidates(db, lead, journey) -> list:
    """Who a cadence message goes out as, in order of preference.
    journey.send_as == "assigned_rep" (the default for cadences created from
    v13.0.0): the lead's assigned rep, then the cadence owner as a fallback
    when the rep has no connected mailbox / messaging grant. NULL (older
    cadences): the owner only — their behaviour is unchanged."""
    import models
    ids = []
    if journey.send_as == "assigned_rep" and lead.assigned_users:
        ids.append(lead.assigned_users[0].id)
    if journey.owner_id and journey.owner_id not in ids:
        ids.append(journey.owner_id)
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(ids)).all()} if ids else {}
    return [users[i] for i in ids if i in users]


def resolve_task_assignee(lead, journey) -> Optional[str]:
    """Who a cadence-created Task (manual research/LinkedIn/email-approval
    step) is assigned to: the lead's own rep, else the cadence owner.
    Shared by task_channel.py and engine._handle_manual_email_node (was
    identical duplicated logic in both)."""
    rep = lead.assigned_users[0] if lead.assigned_users else None
    return rep.id if rep else journey.owner_id


def resolve_messaging_sender(db, lead, journey, channel: str):
    """SMS/WhatsApp: the first sender candidate with a working `channel`
    grant. Returns (sender, resolved, None), or (None, None, SendResult) with
    the failure to return when nobody can send."""
    from messaging_service import resolve_messaging_for_user
    resolved = None
    for user in sender_candidates(db, lead, journey):
        resolved = resolve_messaging_for_user(db, user, channel)
        if resolved.provider is not None:
            return user, resolved, None
    if resolved is None:
        return None, None, SendResult(success=False, error="Cadence has no owner to send as", retryable=False)
    return None, None, SendResult(success=False, error=resolved.error, retryable=resolved.retryable)


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
    lead-eligibility check (Gap 1) — this class  the send.
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

    def preflight(self, db, lead, journey):
        """The error a send would fail on for sure right now (no mailbox, no
        address...), or None. Checked before a rep approves a manual draft,
        so it can be fixed while the draft is kept, instead of discovered
        after it's gone."""
        return None
