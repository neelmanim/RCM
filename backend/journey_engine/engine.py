# ── journey_engine/engine.py — Sales Journey execution engine ───────────────
"""
Postgres-native poller. Full design: docs/SALES_JOURNEY_ARCHITECTURE.md.

Core loop: journey_execution_queue holds one row per pending step, claimed
via SELECT...FOR UPDATE SKIP LOCKED. SQLAlchemy silently omits the FOR UPDATE
clause entirely on SQLite (confirmed: no error, just not emitted) — so the
same call is correct on both dialects: real cross-instance locking on
Postgres, a plain claim on SQLite (fine there since SQLite serializes all
writers at the connection level anyway, and dev/test only ever runs one
process).
"""
import logging
import os
import socket
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func

import models
import database as _database_module   # module reference, not `from database import SessionLocal` —
                                        # tests monkey-patch database.SessionLocal/.engine (see
                                        # tests/conftest.py's `db` fixture, same pattern sf_logger.py
                                        # uses); binding the names at import time would miss that.
from activity_logger import log_activity
from error_logger import log_error
from journey_engine.channels import get_channel_provider

logger = logging.getLogger(__name__)

CLAIM_BATCH_SIZE = 50
LEASE_DURATION_SECONDS = 300          # 5 min — far longer than any single outbound call
MAX_NODE_PASSES = 500                 # Gap 3: runaway-loop cap
MAX_SEND_ATTEMPTS = 5
RETRY_BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600]   # 1m, 5m, 30m, 2h, 6h
COOLDOWN_HOURS = 24                    # Gap 2: cross-journey per-lead-per-channel cooldown
COOLDOWN_RECHECK_HOURS = 3             # how long a cooldown-blocked step waits before rechecking
# 2026-08-05 hardening pass: an exception in execute_step() previously left the
# queue row 'claimed' forever — its lease expires, it gets re-claimed, throws
# again, forever, with no admin-visible trace anywhere (not the failed-
# enrollments panel, not stats — only a logger.error() line nobody reads).
# attempt_count already increments on every claim (_claim_due_rows), so it's
# reused here as the ceiling instead of a second counter.
MAX_UNEXPECTED_ERRORS = 5
# Same audit: cooldown/domain-cadence blocks reschedule a step forever with no
# ceiling if two journeys keep colliding on the same lead/channel — mirrors
# MAX_NODE_PASSES' runaway-safety-valve philosophy for a structural cross-
# journey conflict instead of a graph cycle.
MAX_BLOCKED_RECHECKS = 20
# Phase 4 — deliverability: protects the SENDING domain's reputation, distinct
# from the cooldown above (which protects one lead from being over-contacted).
# Env-overridable for the same "tune based on real usage" reason as the
# enrollment rate cap.
EMAIL_DOMAIN_CADENCE_LIMIT_PER_HOUR = int(os.getenv("JOURNEY_EMAIL_DOMAIN_CADENCE_LIMIT_PER_HOUR", "50"))
DOMAIN_CADENCE_RECHECK_HOURS = 1


def _worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"


# ── Graph helpers (Phase 0: linear graphs only — first outgoing edge wins;
#    Phase 1 adds real branching via node_config.branch_on_event/timeout) ───

def _find_node(graph: dict, node_id: str):
    for node in graph.get("nodes", []):
        if node.get("id") == node_id:
            return node
    return None


def _find_next_node_id(graph: dict, from_node_id: str):
    for edge in graph.get("edges", []):
        if edge.get("source") == from_node_id:
            return edge.get("target")
    return None


def _find_trigger_node(graph: dict):
    for node in graph.get("nodes", []):
        if node.get("type") == "trigger":
            return node
    return None


# ── Lead eligibility (Gap 1) ─────────────────────────────────────────────────

def _is_lead_eligible(lead) -> bool:
    """Checked fresh before every single send, not just at enrollment time —
    a lead's eligibility can change at any point during a multi-day journey."""
    if lead is None:
        return False
    if lead.do_not_contact or lead.unsubscribed_at is not None:
        return False
    if lead.status in models.TERMINAL_STATUSES:
        return False
    return True


# ── Enrollment ───────────────────────────────────────────────────────────────

def enroll_lead(db, journey, lead, trigger_node_id: str = None, commit: bool = True):
    """Enroll a lead into a journey's live published version.

    Returns None (no-op, not an error) if the journey has no live version,
    has no node after its entry point, or the lead already has an active
    enrollment in it — the last case is also enforced DB-side by
    ix_enrollment_one_active_per_lead_journey, this is just the friendly
    pre-check so callers don't need to catch IntegrityError.

    commit=False when called from inside another function's own transaction
    (e.g. models.log_status_change, which is a non-committing helper by
    convention — its callers commit later) so this doesn't prematurely
    commit whatever else that transaction was doing. The API route (direct
    manual enrollment) uses the default commit=True, since that request has
    nothing else pending in the same transaction.
    """
    if not journey.live_version_id:
        return None

    existing = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey.id,
        models.JourneyEnrollment.lead_id == lead.id,
        models.JourneyEnrollment.status == "active",
    ).first()
    if existing:
        return None

    version = db.query(models.JourneyVersion).filter(
        models.JourneyVersion.id == journey.live_version_id
    ).first()
    if not version:
        return None
    graph = version.graph_definition or {}

    if trigger_node_id:
        start_node_id = _find_next_node_id(graph, trigger_node_id)
    else:
        trigger = _find_trigger_node(graph)
        start_node_id = _find_next_node_id(graph, trigger.get("id")) if trigger else None

    if not start_node_id:
        logger.warning(f"[JourneyEngine] Journey {journey.id}: no node after its trigger — nothing to enroll into")
        return None

    enrollment = models.JourneyEnrollment(
        journey_id=journey.id,
        version_id=version.id,
        lead_id=lead.id,
        current_node_id=start_node_id,
        node_pass=0,
        status="active",
    )
    db.add(enrollment)
    db.flush()   # need enrollment.id for the queue row

    start_run_at = _compute_run_at_for_node(_find_node(graph, start_node_id), journey)
    _enqueue_node(db, enrollment, start_node_id, run_at=start_run_at)
    if commit:
        db.commit()
    else:
        db.flush()

    log_activity(
        user_id=journey.owner_id, action_type="JOURNEY_ENROLLED",
        object_type="journey_enrollment", object_id=enrollment.id,
        metadata={"journey_id": journey.id, "lead_id": lead.id},
    )
    return enrollment


def check_entry_triggers(db, event_type: str, lead, commit: bool = True, **event_context):
    """Gap 4 — auto-enrollment. Scans active journeys' live-version graphs in
    Python for a matching trigger node, rather than a JSONB containment query:
    simpler, dialect-portable, and this table stays at journey-count scale
    (tens to low hundreds) — nothing like execution_logs' billions-of-rows
    concern that would justify a GIN-indexed query here.

    commit=False propagates to enroll_lead — see its docstring. Wired into
    models.log_status_change (the one funnel every status change already
    passes through) with commit=False, since that helper doesn't commit
    itself; its callers do.
    """
    journeys = db.query(models.Journey).filter(
        models.Journey.status == "active",
        models.Journey.live_version_id.isnot(None),
    ).all()

    enrolled = []
    for journey in journeys:
        # Pod scoping: NULL pod_id (default) matches every lead. A scoped
        # journey only auto-enrolls leads in that same pod — a lead with no
        # pod_id of its own can't match a pod-scoped journey.
        if journey.pod_id and journey.pod_id != lead.pod_id:
            continue
        version = db.query(models.JourneyVersion).filter(
            models.JourneyVersion.id == journey.live_version_id
        ).first()
        if not version:
            continue
        graph = version.graph_definition or {}
        for node in graph.get("nodes", []):
            if node.get("type") != "trigger":
                continue
            data = node.get("data", {})
            if data.get("event") != event_type:
                continue
            if event_type == "status_changed" and data.get("to_status") and \
               data.get("to_status") != event_context.get("to_status"):
                continue
            enrollment = enroll_lead(db, journey, lead, trigger_node_id=node.get("id"), commit=commit)
            if enrollment:
                enrolled.append(enrollment)
            break   # one trigger match per journey is enough
    return enrolled


def check_exit_triggers(db, event_type: str, lead, commit: bool = True, **event_context):
    """Phase 1 — event-driven early exit from a 'condition' node (the
    counterpart to check_entry_triggers/auto-enrollment above). Looks up this
    lead's active enrollments currently parked on a condition node whose
    branch_on_event map has a matching key, and forces early processing
    instead of waiting out the node's timeout.

    commit=True (the default) also does a best-effort INLINE execute_step()
    call for near-instant branching — safe here because commit=True means
    the trigger_event/next_run_at update this function just made is already
    durably visible to the fresh session execute_step() opens. commit=False
    (used when called from inside another function's own transaction, e.g.
    models.log_status_change) skips the inline call for exactly that reason
    — the regular poller tick (<=30s) is the guaranteed backstop instead.
    """
    enrollments = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.lead_id == lead.id,
        models.JourneyEnrollment.status == "active",
    ).all()

    triggered_queue_row_ids = []
    for enrollment in enrollments:
        version = db.query(models.JourneyVersion).filter(
            models.JourneyVersion.id == enrollment.version_id
        ).first()
        if not version:
            continue
        graph = version.graph_definition or {}
        node = _find_node(graph, enrollment.current_node_id)
        if not node or node.get("type") != "condition":
            continue
        branch_on_event = (node.get("data") or {}).get("branch_on_event") or {}
        if event_type not in branch_on_event:
            continue
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id,
            models.JourneyExecutionQueue.node_id == enrollment.current_node_id,
            models.JourneyExecutionQueue.status == "pending",
        ).first()
        if not queue_row:
            continue
        enrollment.trigger_event = {"type": event_type, **event_context}
        queue_row.next_run_at = datetime.now(timezone.utc)
        triggered_queue_row_ids.append(queue_row.id)

    if commit:
        db.commit()
        for qid in triggered_queue_row_ids:
            try:
                execute_step(qid)
            except Exception as e:
                logger.error(f"[JourneyEngine] inline execute_step failed for {qid}: {e}")
    else:
        db.flush()

    return triggered_queue_row_ids


def force_next_step(db, enrollment_id: str) -> str:
    """Cadence/Messaging Sandbox: advance one active enrollment's pending
    step right now, instead of waiting out its real wait/send-window delay.
    Same next_run_at=now() + inline execute_step() shape as
    check_exit_triggers above; the difference is this works on whatever
    node an *active* enrollment is currently parked on (any pending queue
    row), not only a condition node matching an event.

    Raises ValueError if the enrollment isn't active or has no pending step
    — the caller (an admin route) turns that into a 404/409.
    """
    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.id == enrollment_id
    ).first()
    if not enrollment or enrollment.status != "active":
        raise ValueError("Enrollment not found or not active")

    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id,
        models.JourneyExecutionQueue.status == "pending",
    ).order_by(models.JourneyExecutionQueue.next_run_at).first()
    if not queue_row:
        raise ValueError("No pending step for this enrollment")

    queue_row.next_run_at = datetime.now(timezone.utc)
    db.commit()

    qid = queue_row.id
    execute_step(qid)
    return qid


# ── Queueing / advancing ─────────────────────────────────────────────────────

def _enqueue_node(db, enrollment, node_id: str, run_at: datetime):
    idempotency_key = f"{enrollment.id}:{node_id}:{enrollment.node_pass}"
    row = models.JourneyExecutionQueue(
        enrollment_id=enrollment.id,
        node_id=node_id,
        next_run_at=run_at,
        status="pending",
        idempotency_key=idempotency_key,
    )
    db.add(row)
    return row


# Nodes whose processing is an actual automated outreach send — the
# send-time window applies to these and only these (a "call" node just
# creates a task for a human; a "wait"/"condition" node's own timing is
# already its whole point, not something a business-hours window should
# additionally delay).
_SEND_WINDOW_NODE_TYPES = ("email", "sms", "whatsapp")


def _apply_send_window(run_at: datetime, journey) -> datetime:
    """v10.9.9 — push an automated-send run_at forward to the journey's
    configured business-hours window / allowed weekdays, if any are set.
    All-nullable on Journey: a cadence with none of this configured behaves
    exactly as before (send whenever the step is due). Fixed cadence-level
    timezone, not true per-lead timezone detection — there's no phone/geo
    timezone-resolution in this backend today to make the latter reliable;
    documented as a deliberate scope cut, not an oversight.
    """
    if journey is None:
        return run_at
    has_window = journey.send_window_start_hour is not None and journey.send_window_end_hour is not None
    has_days = bool(journey.send_days)
    if not has_window and not has_days:
        return run_at

    tz = ZoneInfo(journey.send_tz or "UTC")
    allowed_days = None
    if has_days:
        try:
            allowed_days = {int(d) for d in journey.send_days.split(",") if d.strip() != ""}
        except ValueError:
            allowed_days = None   # malformed config — fail open rather than block sends entirely

    local = run_at.astimezone(tz)
    # Bounded to 8 iterations — worst case (a single allowed weekday plus a
    # window already just missed) needs at most one push per day for a week.
    for _ in range(8):
        if allowed_days is not None and local.weekday() not in allowed_days:
            local = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            continue
        if has_window:
            if local.hour < journey.send_window_start_hour:
                local = local.replace(hour=journey.send_window_start_hour, minute=0, second=0, microsecond=0)
                continue
            if local.hour >= journey.send_window_end_hour:
                local = (local + timedelta(days=1)).replace(
                    hour=journey.send_window_start_hour, minute=0, second=0, microsecond=0)
                continue
        break

    return local.astimezone(timezone.utc)


def _compute_run_at_for_node(node, journey=None) -> datetime:
    """The delay lives on the node being ENTERED, not the one being left —
    a 'wait' node's duration_hours / a 'condition' node's timeout_hours is
    how long that node itself is resided in before it's next processed.
    Every other node type (email/call) is processed as soon as possible,
    subject to the journey's send-time window (email/sms only — see
    _apply_send_window)."""
    now = datetime.now(timezone.utc)
    if node is None:
        return now
    data = node.get("data") or {}
    node_type = node.get("type")
    if node_type == "wait":
        return now + timedelta(hours=data.get("duration_hours", 0))
    if node_type == "condition":
        return now + timedelta(hours=data.get("timeout_hours", 0))
    if node_type in _SEND_WINDOW_NODE_TYPES:
        return _apply_send_window(now, journey)
    return now


def _advance_to_node(db, enrollment, journey, node_id: str, graph: dict):
    """Move the enrollment onto node_id and enqueue it, with next_run_at
    computed from the TARGET node's own type (see _compute_run_at_for_node).
    Enforces the runaway-loop cap (Gap 3) on every transition."""
    enrollment.node_pass += 1
    if enrollment.node_pass > MAX_NODE_PASSES:
        _fail_enrollment(
            db, enrollment,
            reason="exceeded_max_node_passes",
            error=f"Exceeded {MAX_NODE_PASSES} node passes — likely an unintended loop",
        )
        return
    enrollment.current_node_id = node_id
    enrollment.trigger_event = None   # consumed by whichever branch decision used it, if any
    run_at = _compute_run_at_for_node(_find_node(graph, node_id), journey)
    _enqueue_node(db, enrollment, node_id, run_at)


def _complete_enrollment(db, enrollment):
    enrollment.status = "completed"
    enrollment.completed_at = datetime.now(timezone.utc)


def _exit_enrollment_early(db, enrollment, reason: str):
    enrollment.status = "exited_early"
    enrollment.exited_reason = reason
    enrollment.completed_at = datetime.now(timezone.utc)


def _fail_enrollment(db, enrollment, reason: str, error: str = None):
    enrollment.status = "failed"
    enrollment.exited_reason = reason
    enrollment.last_error = error
    enrollment.completed_at = datetime.now(timezone.utc)

    journey = db.query(models.Journey).filter(models.Journey.id == enrollment.journey_id).first()
    log_error(
        db=db,
        severity="warning",
        source="backend",
        category="sales_journey",
        feature="Sales Journey",
        title=f"Journey enrollment failed: {reason}",
        description=error or reason,
        action_hint="Check the failed-journeys admin view for this enrollment and decide whether to retry or skip it.",
        context_json=f'{{"enrollment_id": "{enrollment.id}", "lead_id": "{enrollment.lead_id}"}}',
        user_id=journey.owner_id if journey else None,
    )


# ── Idempotency ──────────────────────────────────────────────────────────────

def _already_sent(db, idempotency_key: str) -> bool:
    row = db.query(models.ExecutionLog).filter(
        models.ExecutionLog.idempotency_key == idempotency_key,
        models.ExecutionLog.event_type == "send_attempted",
        models.ExecutionLog.status == "success",
    ).first()
    return row is not None


def _cooldown_blocked(db, lead_id: str, channel_name: str, idempotency_key: str) -> bool:
    """Gap 2 — a per-journey rate cap (Deliverable 5, enforced at enrollment
    time) doesn't stop two DIFFERENT journeys from both touching the same
    lead the same day. This is the second, global guard: no more than one
    successful send per lead per channel per rolling 24h, regardless of
    which journey/step it came from. Excludes this step's own idempotency_key
    so a step doesn't block on its own prior (already-handled by
    _already_sent) attempt."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=COOLDOWN_HOURS)
    row = db.query(models.ExecutionLog).filter(
        models.ExecutionLog.lead_id == lead_id,
        models.ExecutionLog.channel == channel_name,
        models.ExecutionLog.event_type == "send_attempted",
        models.ExecutionLog.status == "success",
        models.ExecutionLog.created_at >= cutoff,
        models.ExecutionLog.idempotency_key != idempotency_key,
    ).first()
    return row is not None


def _domain_cadence_blocked(db, recipient_email: str) -> bool:
    """Phase 4 deliverability guard: no more than
    EMAIL_DOMAIN_CADENCE_LIMIT_PER_HOUR successful sends to the same
    recipient domain (e.g. every @acme.com address, across all leads/
    journeys) in a rolling hour — a workflow engine sending at machine speed
    to a shared corporate domain is exactly the traffic pattern that gets a
    sending domain flagged if unthrottled. Joins execution_logs to leads for
    the domain match; this runs once per send attempt (not per insert), same
    order of magnitude as the cooldown check above.
    ponytail: LIKE match on lead.email, not a dedicated indexed domain
    column — fine at current volume; if this becomes a hot query, denormalize
    a domain column onto Lead (or execution_logs) and index it.
    """
    if not recipient_email or "@" not in recipient_email:
        return False
    domain = recipient_email.rsplit("@", 1)[-1].lower()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    count = (
        db.query(models.ExecutionLog)
        .join(models.Lead, models.ExecutionLog.lead_id == models.Lead.id)
        .filter(
            models.ExecutionLog.channel == "email",
            models.ExecutionLog.event_type == "send_attempted",
            models.ExecutionLog.status == "success",
            models.ExecutionLog.created_at >= cutoff,
            func.lower(models.Lead.email).like(f"%@{domain}"),
        )
        .count()
    )
    return count >= EMAIL_DOMAIN_CADENCE_LIMIT_PER_HOUR


def _log(db, enrollment, node_id, event_type, status, channel=None, idempotency_key=None, detail=None):
    db.add(models.ExecutionLog(
        enrollment_id=enrollment.id,
        journey_id=enrollment.journey_id,
        lead_id=enrollment.lead_id,
        node_id=node_id,
        event_type=event_type,
        channel=channel,
        status=status,
        idempotency_key=idempotency_key,
        detail=detail,
    ))


# ── Claim + execute one step ─────────────────────────────────────────────────

def _claim_due_rows(db, worker_id: str, limit: int = CLAIM_BATCH_SIZE):
    """Phase 4 (Gap 5): joins through to Journey so a paused journey's rows
    are never claimed — next_run_at simply stops advancing while paused,
    not lost. `of=JourneyExecutionQueue` restricts FOR UPDATE to just the
    queue rows, not the joined Journey/JourneyEnrollment rows — those are
    read-only here and locking them too would create needless contention
    with the enroll/publish/pause endpoints touching those same tables."""
    now = datetime.now(timezone.utc)
    rows = (
        db.query(models.JourneyExecutionQueue)
        .join(models.JourneyEnrollment, models.JourneyExecutionQueue.enrollment_id == models.JourneyEnrollment.id)
        .join(models.Journey, models.JourneyEnrollment.journey_id == models.Journey.id)
        .filter(models.JourneyExecutionQueue.next_run_at <= now)
        .filter(models.Journey.status != "paused")
        .filter(
            (models.JourneyExecutionQueue.status == "pending") |
            ((models.JourneyExecutionQueue.status == "claimed") &
             (models.JourneyExecutionQueue.lease_expires_at < now))
        )
        .order_by(models.JourneyExecutionQueue.next_run_at)
        .limit(limit)
        .with_for_update(skip_locked=True, of=models.JourneyExecutionQueue)
        .all()
    )
    claimed_ids = [r.id for r in rows]
    if claimed_ids:
        lease_expires = now + timedelta(seconds=LEASE_DURATION_SECONDS)
        db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.id.in_(claimed_ids)
        ).update({
            "status": "claimed",
            "claimed_by": worker_id,
            "lease_expires_at": lease_expires,
            "attempt_count": models.JourneyExecutionQueue.attempt_count + 1,
        }, synchronize_session=False)
        db.commit()
    return claimed_ids


def execute_step(queue_row_id: str):
    """Process exactly one claimed queue row, in its own session — one
    enrollment's failure must not roll back or block any other."""
    db = _database_module.SessionLocal()
    try:
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.id == queue_row_id
        ).first()
        if not queue_row:
            return
        enrollment = db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.id == queue_row.enrollment_id
        ).first()
        if not enrollment or enrollment.status != "active":
            queue_row.status = "done"
            db.commit()
            return

        journey = db.query(models.Journey).filter(models.Journey.id == enrollment.journey_id).first()
        version = db.query(models.JourneyVersion).filter(models.JourneyVersion.id == enrollment.version_id).first()
        graph = version.graph_definition or {}
        node = _find_node(graph, queue_row.node_id)
        if not node:
            _fail_enrollment(db, enrollment, reason="node_not_found",
                              error=f"Node {queue_row.node_id} not found in graph")
            queue_row.status = "failed"
            db.commit()
            return

        node_type = node.get("type")
        node_data = node.get("data", {}) or {}

        if node_type == "wait":
            _handle_wait_node(db, enrollment, journey, queue_row, graph)
        elif node_type == "condition":
            _handle_condition_node(db, enrollment, journey, queue_row, graph, node_data)
        elif node_type in ("email", "call", "sms", "whatsapp"):
            _handle_channel_node(db, enrollment, journey, queue_row, graph, node_type, node_data)
        elif node_type == "trigger":
            # Defensive only — enrollment always starts past the trigger node.
            next_id = _find_next_node_id(graph, node.get("id"))
            queue_row.status = "done"
            if next_id:
                _advance_to_node(db, enrollment, journey, next_id, graph)
            else:
                _complete_enrollment(db, enrollment)
        else:
            _fail_enrollment(db, enrollment, reason="unknown_node_type", error=f"Unknown node type: {node_type}")
            queue_row.status = "failed"

        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"[JourneyEngine] execute_step failed for queue row {queue_row_id}: {e}")
        _dead_letter_on_repeated_error(db, queue_row_id, e)
    finally:
        db.close()


def _dead_letter_on_repeated_error(db, queue_row_id: str, error: Exception):
    """Without this, an unexpected exception above left the queue row
    'claimed' forever: its lease expires, it gets re-claimed, throws again,
    forever — bypassing MAX_SEND_ATTEMPTS entirely (that check only lives in
    the channel-send success/failure path) and invisible everywhere (not the
    failed-enrollments panel, not stats, only a logger.error line). Reuses
    attempt_count (already incremented on every claim by _claim_due_rows)
    as the ceiling rather than adding a second counter. Wrapped in its own
    try/except so a bug in this fallback can't crash the tick loop."""
    try:
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.id == queue_row_id
        ).first()
        if not queue_row or queue_row.attempt_count < MAX_UNEXPECTED_ERRORS:
            return   # let the lease expire and retry — might be transient
        enrollment = db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.id == queue_row.enrollment_id
        ).first()
        if enrollment and enrollment.status == "active":
            _fail_enrollment(db, enrollment, reason="unexpected_error", error=str(error))
        queue_row.status = "failed"
        db.commit()
    except Exception:
        db.rollback()
        logger.error(f"[JourneyEngine] dead-letter fallback itself failed for queue row {queue_row_id}")


def _handle_wait_node(db, enrollment, journey, queue_row, graph):
    """Pure delay — no branching. The wait already happened (this row's
    next_run_at was set to now+duration_hours when the node was entered,
    per _compute_run_at_for_node), so processing it just follows the single
    graph edge onward, with no further delay — same as _advance_past."""
    queue_row.status = "done"
    _advance_past(db, enrollment, journey, queue_row, graph)


def _handle_condition_node(db, enrollment, journey, queue_row, graph, node_data):
    """Conditional branching (Phase 1). Converges both paths into this node
    onto one decision: the natural-timeout path (poller claims because
    timeout_hours elapsed, enrollment.trigger_event is still null) and the
    event-triggered early-exit path (check_exit_triggers set trigger_event
    and forced next_run_at=now() before the timeout) both land here — the
    only variable is which field got set first.
    """
    queue_row.status = "done"
    branch_on_event = node_data.get("branch_on_event") or {}
    branch_on_timeout = node_data.get("branch_on_timeout")

    if enrollment.trigger_event:
        event_type = enrollment.trigger_event.get("type")
        next_id = branch_on_event.get(event_type) or branch_on_timeout
    else:
        next_id = branch_on_timeout

    if not next_id:
        # Not configured as a real branch (or authored with only a single
        # graph edge) — fall back to it, same as a plain node.
        next_id = _find_next_node_id(graph, queue_row.node_id)

    if next_id:
        _advance_to_node(db, enrollment, journey, next_id, graph)
    else:
        _complete_enrollment(db, enrollment)


def _reschedule_or_stall(db, enrollment, queue_row, event_type, channel_name, recheck_hours, stall_detail):
    """Shared by the cooldown/domain-cadence blocks below — both log the skip
    (so it's visible to the per-lead status view instead of looking identical
    to a plain wait) and both dead-letter after MAX_BLOCKED_RECHECKS
    consecutive blocks (a structural cross-journey conflict, mirroring
    MAX_NODE_PASSES' runaway-safety-valve philosophy) instead of rescheduling
    forever."""
    _log(db, enrollment, queue_row.node_id, event_type, "skipped",
         channel=channel_name, idempotency_key=queue_row.idempotency_key,
         detail={"recheck_hours": recheck_hours})
    if queue_row.attempt_count >= MAX_BLOCKED_RECHECKS:
        queue_row.status = "failed"
        _fail_enrollment(db, enrollment, reason="cooldown_stalled", error=stall_detail)
        return
    queue_row.status = "pending"
    queue_row.next_run_at = datetime.now(timezone.utc) + timedelta(hours=recheck_hours)


def _handle_channel_node(db, enrollment, journey, queue_row, graph, channel_name, node_data):
    idempotency_key = queue_row.idempotency_key
    lead = db.query(models.Lead).filter(models.Lead.id == enrollment.lead_id).first()

    if not _is_lead_eligible(lead):
        queue_row.status = "done"
        _exit_enrollment_early(db, enrollment, reason="suppressed")
        return

    if _already_sent(db, idempotency_key):
        # A prior attempt succeeded but this row never got marked done
        # (crash between send success and commit) — don't resend, just advance.
        queue_row.status = "done"
        _advance_past(db, enrollment, journey, queue_row, graph)
        return

    if _cooldown_blocked(db, enrollment.lead_id, channel_name, idempotency_key):
        # Gap 2 — cross-journey cooldown: a timing conflict, not an error.
        _reschedule_or_stall(db, enrollment, queue_row, "cooldown_blocked", channel_name,
                              COOLDOWN_RECHECK_HOURS,
                              f"Blocked by another journey's {channel_name} cooldown for "
                              f"{MAX_BLOCKED_RECHECKS} consecutive checks — likely a structural conflict "
                              f"between two journeys touching the same lead.")
        return

    if channel_name == "email" and _domain_cadence_blocked(db, lead.email):
        # Deliverability, not a per-lead concern — same "timing conflict, not an error" handling.
        _reschedule_or_stall(db, enrollment, queue_row, "domain_cadence_blocked", channel_name,
                              DOMAIN_CADENCE_RECHECK_HOURS,
                              f"Blocked by the sending domain's cadence limit for "
                              f"{MAX_BLOCKED_RECHECKS} consecutive checks.")
        return

    provider = get_channel_provider(channel_name)
    result = provider.send(db, lead, journey, node_data, enrollment=enrollment, node_id=queue_row.node_id)

    if result.success:
        _log(db, enrollment, queue_row.node_id, "send_attempted", "success",
             channel=channel_name, idempotency_key=idempotency_key,
             detail={"provider_ref": result.provider_ref})
        queue_row.status = "done"
        _advance_past(db, enrollment, journey, queue_row, graph)
        return

    _log(db, enrollment, queue_row.node_id, "send_attempted", "failure",
         channel=channel_name, idempotency_key=idempotency_key,
         detail={"error": result.error})

    if not result.retryable or queue_row.attempt_count >= MAX_SEND_ATTEMPTS:
        queue_row.status = "failed"
        _fail_enrollment(db, enrollment, reason="send_failed", error=result.error)
        return

    # Retryable — release the claim and reschedule per backoff.
    backoff_idx = min(queue_row.attempt_count - 1, len(RETRY_BACKOFF_SECONDS) - 1)
    queue_row.status = "pending"
    queue_row.next_run_at = datetime.now(timezone.utc) + timedelta(seconds=RETRY_BACKOFF_SECONDS[backoff_idx])


def _advance_past(db, enrollment, journey, queue_row, graph):
    next_id = _find_next_node_id(graph, queue_row.node_id)
    if next_id:
        _advance_to_node(db, enrollment, journey, next_id, graph)
    else:
        _complete_enrollment(db, enrollment)


def tick():
    """Entry point registered with scheduled_jobs.py's _schedule_recurring."""
    import app_state
    app_state.last_journey_tick_at = datetime.now(timezone.utc)

    db = _database_module.SessionLocal()
    try:
        claimed_ids = _claim_due_rows(db, _worker_id())
    finally:
        db.close()

    for queue_row_id in claimed_ids:
        execute_step(queue_row_id)
