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

from sqlalchemy import func, or_

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
# v13.0.0 — journey-wide stop rules (Journey.stop_on_reply / stop_on_meeting).
# email_auto_replied is deliberately absent: an out-of-office is not a reply.
REPLY_EVENTS = ("email_replied", "sms_replied", "whatsapp_replied")
# ExecutionLog event types for condition-branch events: one that arrived while
# the lead was on another step, and each condition decision (which closes the
# window of events the next condition considers).
EVENT_RECEIVED = "event_received"
CONDITION_DECIDED = "condition_decided"
# Manual-step deadline rule — lives with the channels so the rep's Task gets
# the same deadline the cadence waits for (see manual_step_due_time).
from journey_engine.channels.base import (  # noqa: E402
    HARD_STOP_DUE_HOURS, manual_step_deadline_hours,
    manual_step_due_time,
)


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


from time_utils import as_utc as _aware   # SQLite hands back naive datetimes; treat them as UTC


# Lead fields a condition node may branch on (v13.0.0 — e.g. the playbook's
# Ops vs Marketing email by title, "text only if a phone number exists").
FIELD_RULE_FIELDS = ("title", "company", "industry", "lead_source", "status", "email", "phone")
FIELD_RULE_OPS = ("contains_any", "equals", "exists", "not_exists")


def _field_rule_matches(lead, rule: dict) -> bool:
    """{field, op, value}. contains_any: any comma-separated keyword appears in
    the field (case-insensitive) — "marketing, growth, demand". equals is
    case-insensitive. exists / not_exists ignore value. Unknown field/op never
    matches (publish validation rejects them first)."""
    field, op = rule.get("field"), rule.get("op")
    if lead is None or field not in FIELD_RULE_FIELDS or op not in FIELD_RULE_OPS:
        return False
    current = str(getattr(lead, field, None) or "").strip().lower()
    if op == "exists":
        return bool(current)
    if op == "not_exists":
        return not current
    wanted = str(rule.get("value") or "").strip().lower()
    if op == "equals":
        return current == wanted
    keywords = [k.strip() for k in wanted.split(",") if k.strip()]
    return any(k in current for k in keywords)


# ── Lead eligibility (Gap 1) ─────────────────────────────────────────────────

def _is_lead_eligible(lead) -> bool:
    """Checked fresh before every single send, not just at enrollment time —
    a lead's eligibility can change at any point during a multi-day journey."""
    if lead is None:
        return False
    if lead.do_not_contact or lead.unsubscribed_at is not None or lead.deleted_at is not None:
        return False
    if lead.status in models.TERMINAL_STATUSES:
        return False
    return True


# ── Enrollment ───────────────────────────────────────────────────────────────

def enroll_lead(db, journey, lead, trigger_node_id: str = None, commit: bool = True, via: str = None):
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

    via records HOW the lead got in ("trigger:<event>", "manual", "sandbox") in
    the JOURNEY_ENROLLED audit row, so "why is this lead in my cadence?" is answerable.
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

    blocked = reenroll_block_reason(db, journey, lead)
    if blocked:
        logger.info(f"[JourneyEngine] not re-enrolling lead {lead.id} in journey {journey.id}: {blocked}")
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
        metadata={"journey_id": journey.id, "lead_id": lead.id, "via": via},
    )
    return enrollment


def reenroll_block_reason(db, journey, lead):
    """Why `lead` may not be enrolled AGAIN in `journey`, or None if it may. Only runs/exits count
    (completed, exited early, paused); a failed run may be retried, and so may a lead a rep removed by hand. allow_reenroll NULL = a cadence from
    before v13.9.0 = allowed, so nothing changes for them until the owner turns it off."""
    prior = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey.id,
        models.JourneyEnrollment.lead_id == lead.id,
        models.JourneyEnrollment.status.in_(("completed", "exited_early", "paused")),
        # a rep pulling a lead out by hand never blocks adding them back (feedback #13)
        or_(models.JourneyEnrollment.exited_reason.is_(None), models.JourneyEnrollment.exited_reason != "manually_removed"),
    ).order_by(func.coalesce(models.JourneyEnrollment.completed_at, models.JourneyEnrollment.enrolled_at).desc()).first()
    if not prior:
        return None
    when = prior.completed_at or prior.enrolled_at
    if journey.allow_reenroll is False:
        return (f"this lead already went through this cadence"
                f"{' on ' + when.strftime('%d %b %Y') if when else ''}, and re-enrollment is off for it "
                f"(turn on 'Allow re-enrollment' in the cadence settings)")
    days = journey.reenroll_cooloff_days
    if days and when:
        age = (datetime.now(timezone.utc) - _aware(when)).days
        if age < days:
            return f"this lead's last run in this cadence was {age} day(s) ago; it waits {days} days before re-enrolling"
    return None


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
    # A "change" to the status the lead is already in is not a change — the
    # trigger means "status CHANGES to X", never "lead is in X".
    if event_type == "status_changed" and event_context.get("from_status") == event_context.get("to_status") \
            and event_context.get("from_status") is not None:
        return []

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
            if event_type == "status_changed":
                # A blank status used to mean "every status change" — enrolling leads the owner never meant to.
                # publish refuses it since v13.8.0; this stops an older live cadence acting on it.
                want = str(data.get("to_status") or "").strip()
                if not want:
                    logger.warning(f"[JourneyEngine] journey {journey.id}: status trigger has no status set — ignored")
                    continue
                if want != event_context.get("to_status"):
                    continue
            enrollment = enroll_lead(db, journey, lead, trigger_node_id=node.get("id"), commit=commit,
                                     via=f"trigger:{event_type}")
            if enrollment:
                enrolled.append(enrollment)
            break   # one trigger match per journey is enough
    return enrolled


def check_exit_triggers(db, event_type: str, lead, commit: bool = True, only_enrollments=None, evidence=None,
                        **event_context):
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
    q = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.lead_id == lead.id,
        models.JourneyEnrollment.status == "active",
    )
    if only_enrollments is not None:     # a reply stops the cadences it replied to, not every one the lead is in
        q = q.filter(models.JourneyEnrollment.id.in_(only_enrollments))
    enrollments = q.all()

    triggered_queue_row_ids = []
    for enrollment in enrollments:
        # v13.0.0 journey-wide stop rules: they end the enrollment wherever it
        # is (a wait, a send, a manual step) — not only on a condition node.
        journey = db.query(models.Journey).filter(models.Journey.id == enrollment.journey_id).first()
        stop_reason = None
        if journey and journey.stop_on_reply and event_type in REPLY_EVENTS:
            stop_reason = "replied"
        elif journey and journey.stop_on_meeting and event_type == "status_changed" and \
                models.STAGE_GROUP.get(event_context.get("to_status"), 0) >= 1:
            stop_reason = "meeting_booked"
        if stop_reason:
            db.query(models.JourneyExecutionQueue).filter(
                models.JourneyExecutionQueue.enrollment_id == enrollment.id,
                models.JourneyExecutionQueue.status.in_(["pending", "claimed"]),
            ).update({"status": "done"}, synchronize_session=False)
            # `evidence` = which message did this (id, thread, sender, subject, source) so a stop is auditable.
            _log(db, enrollment, enrollment.current_node_id, "journey_stopped", stop_reason,
                 detail={"event": event_type, **(evidence or {})})
            _exit_enrollment_early(db, enrollment, reason=stop_reason)
            continue

        version = db.query(models.JourneyVersion).filter(
            models.JourneyVersion.id == enrollment.version_id
        ).first()
        if not version:
            continue
        graph = version.graph_definition or {}
        node = _find_node(graph, enrollment.current_node_id) or {}
        branch_on_event = (node.get("data") or {}).get("branch_on_event") or {} if node.get("type") == "condition" else {}
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id,
            models.JourneyExecutionQueue.node_id == enrollment.current_node_id,
            models.JourneyExecutionQueue.status == "pending",
        ).first() if event_type in branch_on_event else None
        if not queue_row:
            # Not parked on a condition waiting for this event (e.g. the lead
            # replied during the wait BEFORE the "replied?" check). Remember
            # it, so that condition still sees it when the lead gets there
            # (_buffered_condition_event) instead of timing out as "no reply".
            _log(db, enrollment, enrollment.current_node_id, EVENT_RECEIVED, "success",
                 detail={"event": event_type, **event_context, **(evidence or {})})
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


def notify_inbound_message(db, lead, channel: str, commit: bool = True):
    """An inbound SMS/WhatsApp from `lead` — the single entry point both
    inbound paths (Alternate Messenger webhook, Aircall messaging sync) call, so a
    text reply can stop a cadence (stop_on_reply) or fire a condition
    branch the same way an email reply does."""
    if lead is None or channel not in ("sms", "whatsapp"):
        return []
    return check_exit_triggers(db, f"{channel}_replied", lead, commit=commit)


def _norm_subject(subject) -> str:
    import re
    return re.sub(r"^(\s*(re|fwd?|aw|sv)\s*:\s*)+", "", subject or "", flags=re.I).strip().lower()


def _enrollments_replied_to(db, lead, thread_id, subject) -> list:
    """Ids of the lead's ACTIVE enrollments this message answers: it is on the same Nylas thread as,
    or has the same subject (minus Re:/Fwd:) as, an email we sent the lead since that enrollment began —
    sent by the cadence or by the rep by hand (a task step "email them personally" is answered too).
    Mail that answers nothing we sent them (a colleague writing about lunch) matches none."""
    aware = lambda d: d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)
    sends = db.query(models.LeadEmailActivity.nylas_thread_id, models.LeadEmailActivity.subject,
                     models.LeadEmailActivity.timestamp).filter(
        models.LeadEmailActivity.lead_id == lead.id, models.LeadEmailActivity.direction == "outbound").all()
    wanted = _norm_subject(subject)
    answered = []
    for eid, enrolled_at in db.query(models.JourneyEnrollment.id, models.JourneyEnrollment.enrolled_at).filter(
            models.JourneyEnrollment.lead_id == lead.id, models.JourneyEnrollment.status == "active").all():
        since = aware(enrolled_at) - timedelta(seconds=5)      # clock skew between the app and the mail provider
        if any((aware(ts) is None or aware(ts) >= since) and
               ((thread_id and tid == thread_id) or (wanted and _norm_subject(subj) == wanted))
               for tid, subj, ts in sends):
            answered.append(eid)
    return sorted(answered)


def notify_inbound_email(db, lead, auto_reply: bool, commit: bool = True, *, message: dict):
    """An inbound email from `lead` — shared by the Nylas webhook and the
    periodic mailbox sync (staging gets no Nylas webhooks; prod can miss one),
    so a reply moves the cadence whichever path saw it first.

    `message` = {"id", "thread_id", "from", "subject", "source"}. It only counts as a reply to
    a cadence when it (1) is not a receipt/bounce/no-reply notice, (2) is FROM the lead's own
    address — a colleague, forwarder or CC is not the lead — and (3) answers an email we sent them since that cadence began (RCA 2026-10-07: any mail involving the lead's address, e.g. a colleague emailing
    the rep about something else, was read as "the lead replied" and ended the cadence).
    The stop is logged with the message so it can be audited."""
    from email_utils import is_system_message
    if lead is None:
        return []
    sender = (message.get("from") or "").strip().lower()
    if is_system_message(sender, message.get("subject")) or sender != (lead.email or "").strip().lower():
        return []
    ids = _enrollments_replied_to(db, lead, message.get("thread_id"), message.get("subject"))
    if not ids:
        return []
    evidence = {"message_id": message.get("id"), "thread_id": message.get("thread_id"), "from": sender,
                "subject": (message.get("subject") or "")[:120], "source": message.get("source")}
    return check_exit_triggers(db, "email_auto_replied" if auto_reply else "email_replied", lead, commit=commit,
                               only_enrollments=ids, evidence=evidence)


def _resume_manual_step(db, task, trigger_event: dict, commit: bool = True) -> bool:
    """Shared resume mechanism for every manual cadence step (Task outcome,
    manual email approval): if the enrollment is still parked exactly on
    this task's step, record trigger_event and process it now instead of at
    its deadline. Returns True if an enrollment was advanced."""
    if not task.journey_enrollment_id or not task.journey_node_id:
        return False
    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.id == task.journey_enrollment_id,
        models.JourneyEnrollment.status == "active",
    ).first()
    if not enrollment or enrollment.current_node_id != task.journey_node_id:
        return False   # already moved on (deadline passed) or ended — nothing to do
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id,
        models.JourneyExecutionQueue.node_id == task.journey_node_id,
        models.JourneyExecutionQueue.status == "pending",
    ).first()
    if not queue_row:
        return False
    enrollment.trigger_event = trigger_event
    queue_row.next_run_at = datetime.now(timezone.utc)
    if not commit:
        db.flush()
        return True
    db.commit()
    try:
        execute_step(queue_row.id)
    except Exception as e:
        logger.error(f"[JourneyEngine] inline execute_step failed after manual step {task.id}: {e}")
    return True


def complete_manual_step(db, task, commit: bool = True) -> bool:
    """The rep finished a cadence Task step, optionally with an outcome."""
    return _resume_manual_step(db, task, {"type": "task_completed", "outcome": task.outcome}, commit)


def skip_manual_step(db, task) -> bool:
    """The rep chose "Skip this step" on a cadence task/approval: close it and
    move the lead on now along the step's no-response path — exactly what its
    deadline would do, and nothing is sent. (Deleting the task used to leave
    the cadence waiting for a task that no longer existed.) A call reminder
    never parks the cadence, so for it this just closes the task."""
    task.done, task.outcome = "true", "skipped"
    return _resume_manual_step(db, task, {"type": "manual_step_skipped"})


def complete_manual_email_step(db, task, subject: str = None, body: str = None, commit: bool = True) -> bool:
    """The rep approved (optionally editing) a manual cadence email step's
    draft. The actual send and a fresh eligibility re-check happen inside
    _handle_manual_email_node's 2nd pass, not here, so a failed send goes
    through the same retry/fail-enrollment handling every other channel
    send already does. subject/body are the rep's edits; None means "send
    the parked draft unchanged"."""
    return _resume_manual_step(db, task, {"type": "manual_email_approved", "subject": subject, "body": body}, commit)


def complete_manual_sms_step(db, task, message: str = None, commit: bool = True) -> bool:
    """The rep approved (optionally editing) a manual cadence SMS step's
    draft. message=None means "send the parked draft unchanged" — mirrors
    complete_manual_email_step."""
    return _resume_manual_step(db, task, {"type": "manual_sms_approved", "message": message}, commit)


def resume_instantly_sequence_step(db, enrollment_id: str, node_id: str, outcome: str, commit: bool = True) -> bool:
    """v13.3.0 — counterpart to _resume_manual_step for the instantly_sequence
    park: called by the webhook handler and the 15-min poll's reconciliation
    fallback (both a later phase) when Instantly reports a lead outcome.
    outcome: one of "replied"/"interested"/"meeting_booked"/"completed"/
    "unsubscribed"/"bounced".

    Ends the matching JourneyInstantlyEnrollment row BEFORE resuming —
    "unsubscribed"/"bounced" end it as exited, everything else as completed
    — then resumes the parked queue row the same way
    complete_manual_email_step -> _resume_manual_step does.

    Idempotent by construction: this only acts on a JourneyInstantlyEnrollment
    row that's still status="active". A second call for an enrollment a prior
    call (or an unrelated _exit_enrollment_early) already ended finds nothing
    active and returns False — a safe no-op, not an error or a double-advance.
    Instantly's webhook delivery isn't exactly-once and the poll can race a
    webhook for the same event, so this needs to tolerate being called twice.
    """
    jie = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == enrollment_id,
        models.JourneyInstantlyEnrollment.node_id == node_id,
        models.JourneyInstantlyEnrollment.status == "active",
    ).order_by(models.JourneyInstantlyEnrollment.enrolled_at.desc()).first()
    if not jie:
        return False

    jie.status = "exited" if outcome in ("unsubscribed", "bounced") else "completed"
    jie.ended_at = datetime.now(timezone.utc)
    jie.end_reason = outcome

    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.id == enrollment_id,
        models.JourneyEnrollment.status == "active",
    ).first()
    queue_row = None
    if enrollment and enrollment.current_node_id == node_id:
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id,
            models.JourneyExecutionQueue.node_id == node_id,
            models.JourneyExecutionQueue.status == "pending",
        ).first()
    if not queue_row:
        # Ending the Instantly-side handoff is still real work worth
        # committing even if the Alternate CRM enrollment already moved on/ended
        # by some other route — just nothing left to resume.
        if commit:
            db.commit()
        else:
            db.flush()
        return False

    enrollment.trigger_event = {"type": "instantly_outcome", "outcome": outcome}
    queue_row.next_run_at = datetime.now(timezone.utc)
    if not commit:
        db.flush()
        return True
    db.commit()
    try:
        execute_step(queue_row.id)
    except Exception as e:
        logger.error(f"[JourneyEngine] inline execute_step failed after Instantly resume "
                     f"{enrollment_id}/{node_id}: {e}")
    return True


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
        if data.get("field_rule"):
            return now   # a lead-field branch is decided on entry, nothing to wait for
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
    node = _find_node(graph, node_id)
    run_at = _compute_run_at_for_node(node, journey)
    if node and node.get("type") == "condition":
        # The lead may already have replied (or sent an OOO) while on an
        # earlier step — branch on that now instead of waiting out the timeout.
        buffered = _buffered_condition_event(db, enrollment, (node.get("data") or {}).get("branch_on_event") or {})
        if buffered:
            enrollment.trigger_event = buffered
            run_at = datetime.now(timezone.utc)
    _enqueue_node(db, enrollment, node_id, run_at)


def _buffered_condition_event(db, enrollment, branch_on_event: dict):
    """The event (as a trigger_event dict) this condition should branch on
    from those that arrived since this enrollment's last condition decision,
    or None. A real reply beats an auto-reply/other event; among equals the
    latest wins."""
    if not branch_on_event:
        return None
    logs = db.query(models.ExecutionLog).filter(
        models.ExecutionLog.enrollment_id == enrollment.id,
        models.ExecutionLog.event_type.in_([EVENT_RECEIVED, CONDITION_DECIDED]),
    ).order_by(models.ExecutionLog.created_at.asc()).all()
    since_last_decision = []
    for log in logs:
        if log.event_type == CONDITION_DECIDED:
            since_last_decision = []
        elif (log.detail or {}).get("event") in branch_on_event:
            since_last_decision.append(log.detail)
    if not since_last_decision:
        return None
    best = max(reversed(since_last_decision), key=lambda d: d["event"] in REPLY_EVENTS)   # max keeps the first (= latest) tie
    return {"type": best["event"], **{k: v for k, v in best.items() if k != "event"}}


def _complete_enrollment(db, enrollment, reason: str = None):
    enrollment.status = "completed"
    enrollment.exited_reason = reason   # None for a normal end; "max_duration" for the hard stop
    enrollment.completed_at = datetime.now(timezone.utc)
    _on_enrollment_end(db, enrollment)


def _exit_enrollment_early(db, enrollment, reason: str):
    enrollment.status = "exited_early"
    enrollment.exited_reason = reason
    enrollment.completed_at = datetime.now(timezone.utc)
    _on_enrollment_end(db, enrollment)


def exit_active_enrollments(db, lead_id: str, reason: str):
    """Ends every active enrollment for this lead right now — for "stop
    contacting this lead" events (do-not-contact, unsubscribe, delete). The
    per-send _is_lead_eligible check would suppress the next send anyway,
    but only once it comes due; ending now also closes parked approval
    drafts and stops a live Instantly handoff immediately. Doesn't commit."""
    for enrollment in db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.lead_id == lead_id,
        models.JourneyEnrollment.status == "active",
    ).all():
        _exit_enrollment_early(db, enrollment, reason)


def _exit_active_instantly_enrollment(db, enrollment, reason: str):
    """v13.3.0 — called from _on_enrollment_end, so every way an enrollment
    ends (completed, max-duration stop, reply, DNC, removed, archived) gets
    it: if this enrollment handed the lead off to Instantly and that handoff
    is still active, tell Instantly to stop too. Without this, Instantly
    keeps sending the rest of the sequence on its own schedule after
    Alternate CRM has already considered the journey over.

    Best-effort on the Instantly side: a hiccup there must never block an
    exit that's already decided on the Alternate CRM side — logged and
    swallowed, not raised.
    """
    jie = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == enrollment.id,
        models.JourneyInstantlyEnrollment.status == "active",
    ).first()
    # Re-check in memory: resume_instantly_sequence_step ends the row before
    # advancing, and with autoflush off the query above can still return it.
    if not jie or jie.status != "active":
        return
    try:
        from instantly_provider import InstantlyProvider
        from routes._admin_helpers import _get_or_create_sync_settings
        lead = db.query(models.Lead).filter(models.Lead.id == enrollment.lead_id).first()
        settings = _get_or_create_sync_settings(db)
        if settings.instantly_api_key and lead and lead.email:
            InstantlyProvider(api_key=settings.instantly_api_key).remove_lead_from_campaign(
                jie.instantly_campaign_id, lead.email)
    except Exception as e:
        logger.warning(f"[JourneyEngine] remove_lead_from_campaign failed for enrollment {enrollment.id}: {e}")
    jie.status = "exited"
    jie.ended_at = datetime.now(timezone.utc)
    jie.end_reason = reason


# Exits that mean "stop, this lead is handled" — no re-engagement task for these.
_NO_REENGAGE_REASONS = (
    "suppressed", "meeting_booked", "manually_removed", "journey_archived",
    "do_not_contact", "unsubscribed", "lead_unsubscribed", "bounced", "email_bounced", "lead_deleted",
)


def _on_enrollment_end(db, enrollment):
    """Every way an enrollment finishes (completed / exited early) runs this
    once. Two jobs:
    1. Close the rep's still-open tasks from this enrollment's manual/call
       steps — a lead who replied shouldn't leave a stale "send LinkedIn
       message" on anyone's list.
    2. The playbook's re-engagement rule: if the cadence sets
       reengage_after_days and the lead engaged (replied, or opened at least
       reengage_min_opens emails — default 2), give the rep a "Re-engage"
       task that many days out."""
    _exit_active_instantly_enrollment(db, enrollment, enrollment.exited_reason or enrollment.status)
    now = datetime.now(timezone.utc)
    db.query(models.Task).filter(
        models.Task.journey_enrollment_id == enrollment.id,
        models.Task.done == "false",
    ).update({"done": "true", "outcome": "cadence_ended"}, synchronize_session=False)

    journey = db.query(models.Journey).filter(models.Journey.id == enrollment.journey_id).first()
    if not journey or not journey.reengage_after_days or enrollment.exited_reason in _NO_REENGAGE_REASONS:
        return
    replied = enrollment.exited_reason == "replied"
    opens = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.enrollment_id == enrollment.id,
        models.LeadEmailActivity.opened_at.isnot(None),
    ).count()
    if not replied and opens < (journey.reengage_min_opens or 2):
        return
    lead = db.query(models.Lead).filter(models.Lead.id == enrollment.lead_id).first()
    rep = lead.assigned_users[0] if lead and lead.assigned_users else None
    why = "replied" if replied else f"opened {opens} emails"
    db.add(models.Task(
        lead_id=enrollment.lead_id,
        user_id=rep.id if rep else journey.owner_id,
        title=f"[{journey.name}] Re-engage — {why} during the cadence",
        description=f"This lead finished \"{journey.name}\" and {why}. Time to reach back out.",
        due_time=now + timedelta(days=journey.reengage_after_days),
    ))


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
    # Condition-event rows are ordered against each other
    # (_buffered_condition_event): stamp them app-side to the microsecond —
    # the DB default is per-transaction on Postgres and per-second on SQLite.
    extra = {"created_at": datetime.now(timezone.utc)} if event_type in (EVENT_RECEIVED, CONDITION_DECIDED) else {}
    db.add(models.ExecutionLog(**extra,
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

        # Hard stop (Journey.max_duration_days — playbook: "stops at Day 15
        # regardless of outcome"). Checked before any step runs, so a lead
        # past the limit never gets one more touch.
        if journey.max_duration_days and enrollment.enrolled_at and \
                _aware(enrollment.enrolled_at) + timedelta(days=journey.max_duration_days) <= datetime.now(timezone.utc):
            queue_row.status = "done"
            _complete_enrollment(db, enrollment, reason="max_duration")
            db.commit()
            return

        if node_type == "wait":
            _handle_wait_node(db, enrollment, journey, queue_row, graph)
        elif node_type == "condition":
            _handle_condition_node(db, enrollment, journey, queue_row, graph, node_data)
        elif node_type == "email" and node_data.get("send_mode") == "manual":
            _handle_manual_email_node(db, enrollment, journey, queue_row, graph, node_data)
        elif node_type == "sms" and node_data.get("send_mode") == "manual":
            _handle_manual_sms_node(db, enrollment, journey, queue_row, graph, node_data)
        elif node_type == "instantly_sequence":
            _handle_instantly_sequence_node(db, enrollment, journey, queue_row, graph, node_data)
        elif node_type in ("email", "call", "sms", "whatsapp"):
            _handle_channel_node(db, enrollment, journey, queue_row, graph, node_type, node_data)
        elif node_type == "task":
            _handle_task_node(db, enrollment, journey, queue_row, graph, node_data)
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
    if node_data.get("field_rule"):
        lead = db.query(models.Lead).filter(models.Lead.id == enrollment.lead_id).first()
        matched = _field_rule_matches(lead, node_data["field_rule"])
        next_id = node_data.get("branch_on_match" if matched else "branch_on_no_match") \
            or _find_next_node_id(graph, queue_row.node_id)
        _log(db, enrollment, queue_row.node_id, "field_rule", "matched" if matched else "not_matched",
             detail=node_data["field_rule"])
        if next_id:
            _advance_to_node(db, enrollment, journey, next_id, graph)
        else:
            _complete_enrollment(db, enrollment)
        return

    branch_on_event = node_data.get("branch_on_event") or {}
    branch_on_timeout = node_data.get("branch_on_timeout")

    event_type = (enrollment.trigger_event or {}).get("type")
    next_id = branch_on_event.get(event_type) or branch_on_timeout
    # Shown in the lead's cadence history ("branched on Email replied"), and
    # closes the window of events the next condition considers.
    _log(db, enrollment, queue_row.node_id, CONDITION_DECIDED, "success",
         detail={"event": event_type if event_type in branch_on_event else "timeout", "next_node_id": next_id})

    if not next_id:
        # Not configured as a real branch (or authored with only a single
        # graph edge) — fall back to it, same as a plain node.
        next_id = _find_next_node_id(graph, queue_row.node_id)

    if next_id:
        _advance_to_node(db, enrollment, journey, next_id, graph)
    else:
        _complete_enrollment(db, enrollment)


def _handle_task_node(db, enrollment, journey, queue_row, graph, node_data):
    """v13.0.0 manual step (research, LinkedIn connect/message, anything a rep
    does by hand). Two passes over the same queue row:

    1st pass — create the rep's Task (linked to this enrollment + node, with
       the node's outcome options) and PARK: the row stays pending until the
       step's deadline (due_within_hours, default 24).
    2nd pass — either the rep completed it (complete_manual_step set
       trigger_event, possibly with an outcome) or the deadline passed.
       Route by outcome (branch_on_outcome), else branch_on_timeout on a
       deadline, else the step's single outgoing edge.

    Unlike a "call" node (fire-and-forget reminder), the journey waits for
    the human — the Klenty-style "manual step inside one journey"."""
    idempotency_key = queue_row.idempotency_key
    lead = db.query(models.Lead).filter(models.Lead.id == enrollment.lead_id).first()

    if not _already_sent(db, idempotency_key):
        if not _is_lead_eligible(lead):
            queue_row.status = "done"
            _exit_enrollment_early(db, enrollment, reason="suppressed")
            return
        result = get_channel_provider("task").send(
            db, lead, journey, node_data, enrollment=enrollment, node_id=queue_row.node_id)
        if not result.success:
            _log(db, enrollment, queue_row.node_id, "send_attempted", "failure", channel="task",
                 idempotency_key=idempotency_key, detail={"error": result.error})
            queue_row.status = "failed"
            _fail_enrollment(db, enrollment, reason="send_failed", error=result.error)
            return
        _log(db, enrollment, queue_row.node_id, "send_attempted", "success", channel="task",
             idempotency_key=idempotency_key, detail={"provider_ref": result.provider_ref})
        queue_row.status = "pending"
        queue_row.next_run_at = datetime.now(timezone.utc) + timedelta(hours=manual_step_deadline_hours(node_data))
        return

    queue_row.status = "done"
    event = enrollment.trigger_event or {}
    if event.get("type") == "task_completed":
        outcome = event.get("outcome")
        _log(db, enrollment, queue_row.node_id, "task_completed", "success", channel="task",
             detail={"outcome": outcome})
        next_id = (node_data.get("branch_on_outcome") or {}).get(outcome) if outcome else None
    else:
        _log(db, enrollment, queue_row.node_id, "task_timeout", "skipped", channel="task")
        # The journey has moved on — take the stale step off the rep's list.
        db.query(models.Task).filter(
            models.Task.journey_enrollment_id == enrollment.id,
            models.Task.journey_node_id == queue_row.node_id,
            models.Task.done == "false",
        ).update({"done": "true", "outcome": "missed_deadline"}, synchronize_session=False)
        next_id = node_data.get("branch_on_timeout")
    next_id = next_id or _find_next_node_id(graph, queue_row.node_id)
    if next_id:
        _advance_to_node(db, enrollment, journey, next_id, graph)
    else:
        _complete_enrollment(db, enrollment)


def _handle_manual_email_node(db, enrollment, journey, queue_row, graph, node_data):
    """v13.1.0 manual-email cadence step (Viren's request): an email step
    marked send_mode="manual" pauses the cadence, surfaces the merge-resolved
    draft to the lead's rep as a Task (kind="email_approval") they can edit,
    and only actually sends once the rep approves — exactly mirroring
    _handle_task_node's two-pass park/resume shape, with the real send
    deferred to the 2nd pass instead of happening automatically.

    Recommendation locked in 2026-10-01: a missed deadline never auto-sends —
    that would silently turn "manual" into "automated" whenever a rep is slow
    or away, defeating the entire point of the toggle. A timeout behaves
    exactly like a Task step's timeout: skip (branch_on_timeout, else the
    plain next edge), never send unapproved content.

    Eligibility (do_not_contact/unsubscribed/terminal) is re-checked fresh in
    BOTH passes — the gap between parking a draft and a rep approving it can
    be hours or days, long enough for a lead to opt out in between."""
    idempotency_key = queue_row.idempotency_key
    lead = db.query(models.Lead).filter(models.Lead.id == enrollment.lead_id).first()

    if not _already_sent(db, idempotency_key):
        if not _is_lead_eligible(lead):
            queue_row.status = "done"
            _exit_enrollment_early(db, enrollment, reason="suppressed")
            return
        from journey_engine.channels.base import resolve_task_assignee
        from journey_engine.channels.email_channel import resolve_subject_body
        assignee_id = resolve_task_assignee(lead, journey)
        if not assignee_id:
            queue_row.status = "failed"
            _fail_enrollment(db, enrollment, reason="send_failed",
                              error="Lead has no assigned rep and the cadence has no owner")
            return
        resolved = resolve_subject_body(node_data, lead, enrollment.id, queue_row.node_id)
        name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or lead.email or "lead"
        task = models.Task(
            lead_id=lead.id,
            user_id=assignee_id,
            title=f"[{journey.name}] Review & send email: {name}",
            kind="email_approval",
            draft_subject=resolved["subject"],
            draft_body=resolved["body"],
            draft_body_format="html" if resolved["is_html"] else "text",
            due_time=manual_step_due_time(node_data),
            journey_enrollment_id=enrollment.id,
            journey_node_id=queue_row.node_id,
        )
        db.add(task)
        db.flush()
        _log(db, enrollment, queue_row.node_id, "send_attempted", "success", channel="email_manual",
             idempotency_key=idempotency_key, detail={"provider_ref": task.id})
        queue_row.status = "pending"
        queue_row.next_run_at = datetime.now(timezone.utc) + timedelta(hours=manual_step_deadline_hours(node_data))
        return

    queue_row.status = "done"
    event = enrollment.trigger_event or {}
    if event.get("type") == "manual_email_approved":
        if not _is_lead_eligible(lead):
            _exit_enrollment_early(db, enrollment, reason="suppressed")
            return
        # Rep's edited subject/body (if any) override the parked draft; variants
        # were already resolved once when the draft was created — don't re-roll
        # on send, a human is already in full control of the content.
        send_node_data = {k: v for k, v in node_data.items() if k != "variants"}
        if event.get("subject") is not None:
            send_node_data["subject"] = event["subject"]
        if event.get("body") is not None:
            send_node_data["body"] = event["body"]
        result = get_channel_provider("email").send(
            db, lead, journey, send_node_data, enrollment=enrollment, node_id=queue_row.node_id)
        if not result.success:
            _log(db, enrollment, queue_row.node_id, "manual_email_sent", "failure", channel="email",
                 idempotency_key=idempotency_key, detail={"error": result.error})
            _fail_enrollment(db, enrollment, reason="send_failed", error=result.error)
            return
        _log(db, enrollment, queue_row.node_id, "manual_email_sent", "success", channel="email",
             idempotency_key=idempotency_key, detail={"provider_ref": result.provider_ref})
        next_id = None
    else:
        _log(db, enrollment, queue_row.node_id, "manual_email_timeout", "skipped", channel="email_manual")
        db.query(models.Task).filter(
            models.Task.journey_enrollment_id == enrollment.id,
            models.Task.journey_node_id == queue_row.node_id,
            models.Task.done == "false",
        ).update({"done": "true", "outcome": "missed_deadline"}, synchronize_session=False)
        next_id = node_data.get("branch_on_timeout")
    next_id = next_id or _find_next_node_id(graph, queue_row.node_id)
    if next_id:
        _advance_to_node(db, enrollment, journey, next_id, graph)
    else:
        _complete_enrollment(db, enrollment)


def _handle_manual_sms_node(db, enrollment, journey, queue_row, graph, node_data):
    """Feedback item #15: SMS kept as a manual task for initial rollout,
    rather than auto-sending like _handle_channel_node does. Exactly mirrors
    _handle_manual_email_node's two-pass park/resume/never-auto-send shape —
    see that docstring for the full reasoning, including the hard_stop
    deadline behavior shared via manual_step_deadline_hours."""
    idempotency_key = queue_row.idempotency_key
    lead = db.query(models.Lead).filter(models.Lead.id == enrollment.lead_id).first()

    if not _already_sent(db, idempotency_key):
        if not _is_lead_eligible(lead):
            queue_row.status = "done"
            _exit_enrollment_early(db, enrollment, reason="suppressed")
            return
        from journey_engine.channels.base import resolve_task_assignee
        from journey_engine.channels.sms_channel import resolve_message
        assignee_id = resolve_task_assignee(lead, journey)
        if not assignee_id:
            queue_row.status = "failed"
            _fail_enrollment(db, enrollment, reason="send_failed",
                              error="Lead has no assigned rep and the cadence has no owner")
            return
        message = resolve_message(node_data, lead)
        name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or lead.phone or "lead"
        task = models.Task(
            lead_id=lead.id,
            user_id=assignee_id,
            title=f"[{journey.name}] Review & send SMS: {name}",
            kind="sms_approval",
            draft_body=message,
            draft_body_format="text",
            due_time=manual_step_due_time(node_data),
            journey_enrollment_id=enrollment.id,
            journey_node_id=queue_row.node_id,
        )
        db.add(task)
        db.flush()
        _log(db, enrollment, queue_row.node_id, "send_attempted", "success", channel="sms_manual",
             idempotency_key=idempotency_key, detail={"provider_ref": task.id})
        queue_row.status = "pending"
        queue_row.next_run_at = datetime.now(timezone.utc) + timedelta(hours=manual_step_deadline_hours(node_data))
        return

    queue_row.status = "done"
    event = enrollment.trigger_event or {}
    if event.get("type") == "manual_sms_approved":
        if not _is_lead_eligible(lead):
            _exit_enrollment_early(db, enrollment, reason="suppressed")
            return
        send_node_data = dict(node_data)
        if event.get("message") is not None:
            send_node_data["message"] = event["message"]
        result = get_channel_provider("sms").send(
            db, lead, journey, send_node_data, enrollment=enrollment, node_id=queue_row.node_id)
        if not result.success:
            _log(db, enrollment, queue_row.node_id, "manual_sms_sent", "failure", channel="sms",
                 idempotency_key=idempotency_key, detail={"error": result.error})
            _fail_enrollment(db, enrollment, reason="send_failed", error=result.error)
            return
        _log(db, enrollment, queue_row.node_id, "manual_sms_sent", "success", channel="sms",
             idempotency_key=idempotency_key, detail={"provider_ref": result.provider_ref})
        next_id = None
    else:
        _log(db, enrollment, queue_row.node_id, "manual_sms_timeout", "skipped", channel="sms_manual")
        db.query(models.Task).filter(
            models.Task.journey_enrollment_id == enrollment.id,
            models.Task.journey_node_id == queue_row.node_id,
            models.Task.done == "false",
        ).update({"done": "true", "outcome": "missed_deadline"}, synchronize_session=False)
        next_id = node_data.get("branch_on_timeout")
    next_id = next_id or _find_next_node_id(graph, queue_row.node_id)
    if next_id:
        _advance_to_node(db, enrollment, journey, next_id, graph)
    else:
        _complete_enrollment(db, enrollment)


def _instantly_content_hash(steps) -> str:
    """sha256 of the node's authored steps. A changed hash means the content
    changed since the last campaign was created for this (journey_id,
    node_id) — see JourneyInstantlyCampaign's docstring for why that must
    mint a NEW campaign row rather than mutate the live one in place (leads
    already enrolled are mid-sequence in Instantly, which addresses steps by
    position)."""
    import hashlib
    import json
    return hashlib.sha256(json.dumps(steps, sort_keys=True).encode()).hexdigest()


def _instantly_campaign_schedule(journey) -> dict:
    """Maps the journey's own send-window columns onto Instantly's
    campaign_schedule shape, so a cadence's configured hours/days actually
    govern Instantly's sending instead of Instantly's own defaults.

    Timezone (Phase 1 finding, confirmed live): Instantly validates
    campaign_schedule.schedules[].timezone against its OWN curated enum of
    IANA-looking names, not any real IANA zone, with no documented full
    list — "Asia/Kolkata" is the one confirmed-valid value. Forwarding
    journey.send_tz unverified risks a 400 on every create_campaign call for
    any org whose configured tz isn't in that (unknown) enum, so this
    defaults to "Asia/Kolkata" and logs a warning when the journey asked for
    something else, rather than silently guessing.

    ponytail: send_days' weekday-int mapping (Journey: Mon=0..Sun=6) onto
    Instantly's days object (keyed "0".."6", ordering not confirmed live) is
    a best-effort guess (Sun=0..Sat=6, the common cron/JS convention) — only
    matters for orgs that restrict both tz AND specific weekdays on an
    Instantly-sequence node. Verify against a real create_campaign call
    before relying on it; no evidence yet this combination is in use.
    """
    if journey.send_tz and journey.send_tz != "Asia/Kolkata":
        logger.warning(
            f"[JourneyEngine] Journey {journey.id} send_tz={journey.send_tz!r} is not Instantly's "
            f"confirmed-valid 'Asia/Kolkata' value — Instantly's allowed-timezone enum isn't fully "
            f"documented, so campaign_schedule defaults to Asia/Kolkata instead of forwarding an "
            f"unverified value that risks a 400."
        )
    days = {str(d): True for d in range(7)}
    if journey.send_days:
        try:
            allowed_mon0 = {int(d) for d in journey.send_days.split(",") if d.strip() != ""}
            # Mon=0..Sun=6 -> Sun=0..Sat=6 (best-effort guess, see ponytail note above).
            allowed_sun0 = {(d + 1) % 7 for d in allowed_mon0}
            days = {str(d): (d in allowed_sun0) for d in range(7)}
        except ValueError:
            pass   # malformed config — fail open (all days) rather than block sends entirely
    start_hour = journey.send_window_start_hour if journey.send_window_start_hour is not None else 0
    end_hour = journey.send_window_end_hour if journey.send_window_end_hour is not None else 24
    return {
        "schedules": [{
            "name": "Alternate CRM",
            "timing": {"from": f"{start_hour:02d}:00", "to": f"{min(end_hour, 23):02d}:59"},
            "days": days,
            "timezone": "Asia/Kolkata",
        }],
    }


def _handle_instantly_sequence_node(db, enrollment, journey, queue_row, graph, node_data):
    """v13.3.0 — Instantly-sequence node: hands a lead off to a live Instantly
    campaign instead of Alternate CRM sending it directly, then parks. Two-pass
    shape mirroring _handle_manual_email_node, except what resumes the 2nd
    pass is an external event (resume_instantly_sequence_step, called by a
    later phase's webhook handler / poll reconciliation), not a rep's
    approval — this node has no deadline/timeout of its own, it waits for
    Instantly indefinitely (huge next_run_at, same "no wait-forever
    primitive" shape HARD_STOP_DUE_HOURS already uses for a manual
    hard_stop).

    1st pass (idempotency_key not yet logged success): resolve/reuse the
    (journey_id, node_id)'s live campaign by content_hash, create it if
    missing/changed, enroll the lead, write a JourneyInstantlyEnrollment row,
    park.
    2nd pass (resumed by resume_instantly_sequence_step, which already ended
    the JourneyInstantlyEnrollment and set trigger_event before calling back
    in here): branch on the outcome exactly like _handle_task_node branches
    on a Task outcome.
    """
    idempotency_key = queue_row.idempotency_key
    lead = db.query(models.Lead).filter(models.Lead.id == enrollment.lead_id).first()

    if not _already_sent(db, idempotency_key):
        if not _is_lead_eligible(lead):
            queue_row.status = "done"
            _exit_enrollment_early(db, enrollment, reason="suppressed")
            return
        if not lead.email:
            queue_row.status = "failed"
            _fail_enrollment(db, enrollment, reason="send_failed", error="Lead has no email address")
            return

        import json
        from instantly_provider import InstantlyProvider
        from routes._admin_helpers import _get_or_create_sync_settings

        settings = _get_or_create_sync_settings(db)
        if not settings.instantly_api_key:
            queue_row.status = "failed"
            _fail_enrollment(db, enrollment, reason="send_failed",
                              error="Instantly is not configured (no API key in Sync Settings)")
            return
        provider = InstantlyProvider(api_key=settings.instantly_api_key)

        steps = node_data.get("steps") or []
        # Org-enabled mailboxes (Control Center; None = every mailbox), narrowed
        # by this step's own "Send from" pick. A step never sends from a mailbox
        # a Super Admin has since switched off.
        enabled = json.loads(settings.instantly_sending_accounts) if settings.instantly_sending_accounts else None
        picked = node_data.get("sending_accounts") or []
        if picked and enabled is not None:
            picked = [a for a in picked if a in enabled]
            if not picked:
                queue_row.status = "failed"
                _fail_enrollment(db, enrollment, reason="send_failed",
                                  error="None of this Instantly step's \"Send from\" mailboxes are enabled any more "
                                        "— pick new ones in the cadence (Control Center decides which are enabled).")
                return
        sending_accounts = picked or enabled
        # The pick is part of the campaign's identity (a different pool = a new
        # campaign); steps-only hash when there's no pick keeps existing campaigns.
        content_hash = _instantly_content_hash({"steps": steps, "send_from": sorted(picked)} if picked else steps)
        campaign_row = db.query(models.JourneyInstantlyCampaign).filter(
            models.JourneyInstantlyCampaign.journey_id == journey.id,
            models.JourneyInstantlyCampaign.node_id == queue_row.node_id,
        ).order_by(models.JourneyInstantlyCampaign.created_at.desc()).first()

        try:
            if not campaign_row or campaign_row.content_hash != content_hash:
                created = provider.create_campaign(
                    name=f"{journey.name} — {queue_row.node_id}",
                    steps=steps,
                    schedule=_instantly_campaign_schedule(journey),
                    sending_accounts=sending_accounts,
                )
                campaign_id = created.get("id") if isinstance(created, dict) else None
                if not campaign_id:
                    raise RuntimeError(f"Instantly create_campaign returned no campaign id: {created}")
                campaign_row = models.JourneyInstantlyCampaign(
                    journey_id=journey.id, node_id=queue_row.node_id,
                    instantly_campaign_id=campaign_id, content_hash=content_hash,
                )
                db.add(campaign_row)
                db.flush()   # need campaign_row.instantly_campaign_id durable before add_lead_to_campaign

            added = provider.add_lead_to_campaign(
                campaign_row.instantly_campaign_id, lead.email,
                first_name=lead.first_name, last_name=lead.last_name,
            )
        except Exception as e:
            # Same failure shape _handle_channel_node uses for a channel-send
            # failure (dead-letter after MAX_SEND_ATTEMPTS, else backoff-
            # reschedule) — a transient Instantly outage must look like a
            # transient failure, not a silently-stuck lead.
            _log(db, enrollment, queue_row.node_id, "send_attempted", "failure", channel="instantly",
                 idempotency_key=idempotency_key, detail={"error": str(e)})
            if queue_row.attempt_count >= MAX_SEND_ATTEMPTS:
                queue_row.status = "failed"
                _fail_enrollment(db, enrollment, reason="send_failed", error=str(e))
                return
            backoff_idx = min(queue_row.attempt_count - 1, len(RETRY_BACKOFF_SECONDS) - 1)
            queue_row.status = "pending"
            queue_row.next_run_at = datetime.now(timezone.utc) + timedelta(seconds=RETRY_BACKOFF_SECONDS[backoff_idx])
            return

        instantly_lead_id = added.get("id") if isinstance(added, dict) else None
        db.add(models.JourneyInstantlyEnrollment(
            journey_enrollment_id=enrollment.id, node_id=queue_row.node_id,
            instantly_campaign_id=campaign_row.instantly_campaign_id,
            instantly_lead_id=instantly_lead_id, status="active",
        ))
        _log(db, enrollment, queue_row.node_id, "send_attempted", "success", channel="instantly",
             idempotency_key=idempotency_key, detail={"provider_ref": campaign_row.instantly_campaign_id})
        # Park indefinitely — resumed only by resume_instantly_sequence_step
        # (webhook/poll, later phase), never by this row's own next_run_at.
        queue_row.status = "pending"
        queue_row.next_run_at = datetime.now(timezone.utc) + timedelta(hours=HARD_STOP_DUE_HOURS)
        return

    queue_row.status = "done"
    event = enrollment.trigger_event or {}
    outcome = event.get("outcome") if event.get("type") == "instantly_outcome" else None
    next_id = (node_data.get("branch_on_outcome") or {}).get(outcome) if outcome else None
    next_id = next_id or _find_next_node_id(graph, queue_row.node_id)
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

    if result.skip:
        # The step doesn't apply to this lead (e.g. text, no phone number) —
        # recorded and passed over, never a failed enrollment.
        _log(db, enrollment, queue_row.node_id, "step_skipped", "skipped",
             channel=channel_name, idempotency_key=idempotency_key, detail={"reason": result.error})
        queue_row.status = "done"
        _advance_past(db, enrollment, journey, queue_row, graph)
        return

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
