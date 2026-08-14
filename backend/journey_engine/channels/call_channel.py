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

from .base import ChannelProvider, SendResult

logger = logging.getLogger(__name__)


class CallChannelProvider(ChannelProvider):
    channel_name = "call"

    def send(self, db, lead, journey, node_data: dict, enrollment=None, node_id: str = None) -> SendResult:
        assigned = lead.assigned_users[0] if lead.assigned_users else None
        if not assigned:
            return SendResult(success=False, error="Lead has no assigned SDR", retryable=False)

        title = node_data.get("title") or f"Call {(lead.first_name or '').strip()} {lead.last_name}".strip()
        task = models.Task(
            lead_id=lead.id,
            user_id=assigned.id,
            title=f"[{journey.name}] {title}",
            due_time=datetime.now(timezone.utc),
        )
        db.add(task)
        db.flush()
        return SendResult(success=True, provider_ref=task.id)
