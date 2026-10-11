# ── journey_engine/channels/call_channel.py ──────────────────────────────────
"""
Call channel for Sales Journey.

Deliberately NOT wired to dialer_service.initiate_call — that function is
built for a live SDR clicking "Dial": it rings the SDR's own phone (bridge
mode) or requires them actively in the browser (browser mode), with no
automated-outbound-call path at all. Auto-firing it from the engine would
ring an SDR's phone unprompted whenever a wait timer happens to expire (could
be 3am), with no context about who they're being connected to or why.

Instead, a "call" node creates a Task reminder for the lead's assigned SDR —
same model the rest of the app already uses for reminders (task_routes.py),
due immediately. The SDR places the actual call when they see it, same as
any other task. This keeps a human in the loop for calling, matching how
this dialer system is designed to work everywhere else.
"""
import logging
from datetime import datetime, timezone

import models
from journey_engine.merge_fields import apply_merge_fields

from .base import ChannelProvider, SendResult

logger = logging.getLogger(__name__)


class CallChannelProvider(ChannelProvider):
    channel_name = "call"

    def send(self, db, lead, journey, node_data: dict, enrollment=None, node_id: str = None) -> SendResult:
        # A rep flagged the number as wrong (lead_service.mark_phone_invalid): no reminder to call it.
        if lead.phone_invalid_at:
            return SendResult(success=False, error="Phone marked wrong", retryable=False, skip=True)
        assigned = lead.assigned_users[0] if lead.assigned_users else None
        if not assigned:
            return SendResult(success=False, error="Lead has no assigned SDR", retryable=False)

        title = node_data.get("title") or f"Call {(lead.first_name or '').strip()} {lead.last_name}".strip()
        task = models.Task(
            lead_id=lead.id,
            user_id=assigned.id,
            title=f"[{journey.name}] {title}",
            # The cadence's default call script, if the journey builder set
            # one (NodeConfigPanel.jsx's CallFields) — surfaced on the Power
            # Dialer card (models.Task.description's own docstring). Blank
            # when the node has none; a per-lead Lead.talking_points override
            # still wins over this on the card either way.
            description=apply_merge_fields(node_data.get("script") or "", lead) or None,
            # Due now, not at a step deadline: the cadence never waits on a
            # call reminder, so it has no deadline, and the bell shows it
            # straight away (it lists non-approval tasks once due).
            due_time=datetime.now(timezone.utc),
            # Linked so a stopped/finished cadence closes it (engine._on_enrollment_end).
            # A call step still never waits for the rep — only a "task" step does.
            journey_enrollment_id=enrollment.id if enrollment else None,
            journey_node_id=node_id,
        )
        db.add(task)
        db.flush()
        return SendResult(success=True, provider_ref=task.id)
