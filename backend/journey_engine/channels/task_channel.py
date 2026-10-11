# ── journey_engine/channels/task_channel.py ──────────────────────────────────
"""
Manual step for Sales Journey (v13.0.0) — research, LinkedIn connection
request, LinkedIn message, or any other hand-done touch. Creates a Task for
the lead's rep, linked to the enrollment + node so completing it advances the
journey (engine.complete_manual_step) and ending the journey closes it
(engine._on_enrollment_end).

LinkedIn is manual on purpose (user decision 2026-09-30): LinkedIn doesn't
allow automated sends without a third-party vendor. The step pre-fills the
message so the rep copies it, sends it, and picks the outcome.
"""
import json

import models
from journey_engine.merge_fields import apply_merge_fields

from .base import ChannelProvider, SendResult, manual_step_due_time, resolve_task_assignee

# What the rep sees as the task's prefix, per task_kind.
TASK_KIND_LABELS = {
    "research": "Research",
    "linkedin_connect": "LinkedIn connection request",
    "linkedin_message": "LinkedIn message",
    "custom": "Task",
}


class TaskChannelProvider(ChannelProvider):
    channel_name = "task"

    def send(self, db, lead, journey, node_data: dict, enrollment=None, node_id: str = None) -> SendResult:
        assignee_id = resolve_task_assignee(lead, journey)
        if not assignee_id:
            return SendResult(success=False, error="Lead has no assigned rep and the cadence has no owner", retryable=False)

        label = TASK_KIND_LABELS.get(node_data.get("task_kind"), "Task")
        name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or lead.email or "lead"
        title = apply_merge_fields(node_data.get("title") or f"{label}: {name}", lead)
        outcomes = [o for o in (node_data.get("outcomes") or []) if o.get("key") and o.get("label")]
        task = models.Task(
            lead_id=lead.id,
            user_id=assignee_id,
            title=f"[{journey.name}] {title}",
            description=apply_merge_fields(node_data.get("instructions") or "", lead) or None,
            due_time=manual_step_due_time(node_data),
            journey_enrollment_id=enrollment.id if enrollment else None,
            journey_node_id=node_id,
            outcome_options=json.dumps(outcomes) if outcomes else None,
        )
        db.add(task)
        db.flush()
        return SendResult(success=True, provider_ref=task.id)
