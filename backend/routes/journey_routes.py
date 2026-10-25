# ── routes/journey_routes.py — Sales Journey API (Phase 0-3) ─────────────────
"""
Create/autosave/publish/archive a journey, enroll a lead (with the
Deliverable 5 rate cap), read status/stats. Full design + phasing:
docs/SALES_JOURNEY_ARCHITECTURE.md.
"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from database import get_db
from auth import get_current_user, require_export_access, require_pod_admin_or_above, require_super_admin
from routes.lead_helpers import load_lead
from domain.actor import Actor
from domain.lead_access import visible_lead_ids, visible_leads
import models
from activity_logger import log_activity
from time_utils import as_utc as _aware
from journey_engine.engine import enroll_lead, reenroll_block_reason, force_next_step, _exit_enrollment_early, _find_node, FIELD_RULE_FIELDS, FIELD_RULE_OPS, REPLY_EVENTS
from journey_engine.channels.base import sender_candidates
from journey_engine.channels.task_channel import TASK_KIND_LABELS
from journey_engine.channels.sms_channel import SMS_MAX_LENGTH
from journey_engine.ai_copy import generate_email_copy, AICopyError
from routes._admin_helpers import _get_or_create_sync_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/journeys", tags=["journeys"])

# Deliverable 5 — hard per-journey enrollment-rate cap. Conservative default;
# excess requests within the window are skipped (not queued into a separate
# mechanism) with a reason the caller can retry on — simplest correct choice,
# no new infrastructure needed for what's fundamentally a "try again shortly" case.
# Env-overridable (Phase 4: "tuning based on real usage") without a redeploy.
ENROLLMENT_RATE_CAP_PER_HOUR = int(os.getenv("JOURNEY_ENROLLMENT_RATE_CAP_PER_HOUR", "2000"))


def _get_journey_or_404(db: Session, journey_id: str) -> models.Journey:
    journey = db.query(models.Journey).filter(models.Journey.id == journey_id).first()
    if not journey:
        raise HTTPException(status_code=404, detail="Journey not found")
    return journey


def _require_journey_owner(journey: models.Journey, user: dict, action: str = "modify") -> None:
    """Cadences are readable org-wide (v12.1 made them visible to every role
    for transparency) but writable only by their owner, mirroring the
    creator-or-Super-Admin rule email templates already use.

    Every route below that changes a cadence's definition, lifecycle or
    enrollments (rename/settings, save draft, publish, pause, resume,
    archive, enroll, sandbox test-enroll, and the per-enrollment
    retry/force-next-step/skip actions) calls this.
    Before v12.2 they were gated on `require_pod_admin_or_above` alone, which
    let any Pod Admin rename, re-point, publish, pause or archive a cadence
    belonging to a different Pod Admin.

    An orphaned cadence (owner_id NULL — the owner's user row was deleted,
    ondelete="SET NULL") is deliberately Super-Admin-only rather than
    open to everyone."""
    if user.get("role") == "Super Admin":
        return
    if journey.owner_id and journey.owner_id == user.get("sub"):
        return
    raise HTTPException(
        status_code=403,
        detail=f"Only the cadence owner or a Super Admin can {action} this cadence.",
    )


# Mirrors frontend-react/.../sales-journey/nodeDefaults.js NODE_LABELS — keep in sync.
_NODE_LABELS = {"trigger": "Trigger", "email": "Email", "wait": "Wait", "condition": "Condition", "call": "Call",
                "sms": "SMS", "whatsapp": "WhatsApp", "task": "Task", "instantly_sequence": "Instantly Sequence"}


def _resolve_node_label(graph: dict, node_id: str) -> str:
    """A raw auto-generated node id (n1785910912340_1) means nothing to an
    SDR/admin reading enrollment status — resolve it to the same friendly,
    only-numbered-when-repeated label the builder itself shows
    (NodeConfigPanel.jsx's labelForNode)."""
    nodes = (graph or {}).get("nodes", [])
    node = next((n for n in nodes if n.get("id") == node_id), None)
    if not node:
        return "Unknown step"
    node_type = node.get("type")
    same_type = [n for n in nodes if n.get("type") == node_type]
    label = _NODE_LABELS.get(node_type, node_type)
    if len(same_type) > 1:
        idx = next((i for i, n in enumerate(same_type) if n.get("id") == node_id), 0)
        return f"{label} #{idx + 1}"
    return label


def _pending_reason(db: Session, enrollment: "models.JourneyEnrollment") -> dict:
    """What's actually happening for an active enrollment right now.
    Natural wait, a cooldown block, a retry backoff, and a domain-cadence
    recheck all share the identical shape (status='pending' + a pushed
    next_run_at) — indistinguishable to an admin without this. Best-effort:
    reads the most recent log entry for the enrollment's pending node rather
    than adding new columns to track this explicitly."""
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id,
        models.JourneyExecutionQueue.status.in_(["pending", "claimed"]),
    ).order_by(models.JourneyExecutionQueue.next_run_at.asc()).first()
    if not queue_row:
        return {"reason": "unknown", "detail": "No pending step found — it may have just completed.", "next_run_at": None}

    next_run_at = queue_row.next_run_at.isoformat() if queue_row.next_run_at else None
    if queue_row.status == "claimed":
        return {"reason": "processing", "detail": "Being processed right now.", "next_run_at": next_run_at}

    last_log = db.query(models.ExecutionLog).filter(
        models.ExecutionLog.enrollment_id == enrollment.id,
        models.ExecutionLog.node_id == queue_row.node_id,
        # A reply remembered for a later condition says nothing about why
        # THIS step is waiting.
        models.ExecutionLog.event_type != "event_received",
    ).order_by(models.ExecutionLog.created_at.desc()).first()

    if last_log and last_log.event_type == "cooldown_blocked":
        return {"reason": "cooldown_blocked", "detail": "Blocked briefly — another cadence already contacted this lead recently.", "next_run_at": next_run_at}
    if last_log and last_log.event_type == "domain_cadence_blocked":
        return {"reason": "domain_cadence_blocked", "detail": "Blocked briefly by the sending domain's rate limit.", "next_run_at": next_run_at}
    if last_log and last_log.event_type == "send_attempted" and last_log.status == "failure":
        return {"reason": "retry_pending", "detail": "A previous send failed — will retry automatically.", "next_run_at": next_run_at}
    # Parked on a person: the step created a task/approval and waits for it.
    # Manual email/SMS log their own channel — they used to fall through to
    # "Waiting for its scheduled time" while the rep's approval sat in My Tasks.
    awaiting = {
        "task": ("awaiting_rep", "Waiting for the rep to complete a manual step."),
        "email_manual": ("awaiting_email_approval", "Waiting for the rep to approve the email draft."),
        "sms_manual": ("awaiting_sms_approval", "Waiting for the rep to approve the SMS draft."),
    }
    if last_log and last_log.event_type == "send_attempted" and last_log.channel in awaiting:
        reason, detail = awaiting[last_log.channel]
        return {"reason": reason, "detail": detail, "next_run_at": next_run_at}
    version = db.query(models.JourneyVersion).filter(models.JourneyVersion.id == enrollment.version_id).first()
    node = (_find_node(version.graph_definition or {}, queue_row.node_id) or {}) if version else {}
    if node.get("type") == "condition":
        return {"reason": "awaiting_reply", "detail": "Waiting to see if the lead replies.", "next_run_at": next_run_at}
    return {"reason": "waiting", "detail": "Waiting for its scheduled time.", "next_run_at": next_run_at}


def _branch_targets(data: dict) -> list:
    """Every node a condition/task step can route to besides its plain edge."""
    return [data.get("branch_on_timeout"), data.get("branch_on_match"), data.get("branch_on_no_match"),
            *(data.get("branch_on_event") or {}).values(), *(data.get("branch_on_outcome") or {}).values()]


def _reply_branch_conflict(graph: dict, stop_on_reply: bool):
    """"Stop on reply" ends the enrollment on ANY reply, before a condition
    step can branch on it — so a reply branch with it on silently never runs
    (found rehearsing the demo cadence: new cadences start with it on).
    Returns the error to show, or None."""
    if not stop_on_reply:
        return None
    for n in (graph or {}).get("nodes", []):
        data = n.get("data") or {}
        if n.get("type") == "condition" and set(data.get("branch_on_event") or {}) & set(REPLY_EVENTS):
            where = f'"{data["label"]}"' if data.get("label") else "a condition step"
            return (f'"Stop on reply" is on, so the reply branch on {where} can never run — turn off '
                    f'"Stop on reply" in Cadence rules, or remove that branch')
    return None


def _validate_graph_for_publish(graph: dict) -> list:
    """Authoritative validation — mirrors (and is stricter than) the
    frontend's validation.js, which explicitly documents itself as
    non-authoritative. Without this, a journey published via a direct API
    call or a builder edge-case could go live with e.g. a blank-subject
    email node, which would actually send before anyone noticed."""
    errors = []
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    by_id = {n.get("id"): n for n in nodes}

    triggers = [n for n in nodes if n.get("type") == "trigger"]
    if not triggers:
        errors.append("This cadence has no trigger node — add one to define how leads enter it.")
    elif len(triggers) > 1:
        errors.append("Only one trigger node is allowed per cadence.")
    for t in triggers:
        td = t.get("data") or {}
        if td.get("event") == "status_changed" and not (td.get("to_status") or "").strip():
            errors.append("The trigger 'Lead status changes to…' needs a status — pick which status starts this cadence.")

    reachable = {e.get("target") for e in edges}
    for n in nodes:
        node_data = n.get("data") or {}
        # v13.1.0: a manual email step's branch_on_timeout is the same kind
        # of extra route a task step's is — its target must count as
        # reachable too, or a node ONLY reached that way gets falsely
        # flagged "unreachable".
        if n.get("type") in ("condition", "task") or (n.get("type") in ("email", "sms") and node_data.get("send_mode") == "manual"):
            reachable.update(t for t in _branch_targets(node_data) if t)
    for n in nodes:
        if n.get("type") != "trigger" and n.get("id") not in reachable:
            errors.append(f"{_resolve_node_label(graph, n.get('id'))} is unreachable — nothing links to it.")

    for n in nodes:
        data = n.get("data") or {}
        node_type = n.get("type")
        label = _resolve_node_label(graph, n.get("id"))
        if node_type == "email":
            variants = data.get("variants")
            if variants:
                if len(variants) < 2:
                    errors.append(f"{label} needs at least 2 variants for an A/B test, or none at all.")
                for i, v in enumerate(variants):
                    if not (v.get("subject") or "").strip():
                        errors.append(f"{label} variant {i + 1} needs a subject.")
                    if not (v.get("body") or "").strip():
                        errors.append(f"{label} variant {i + 1} needs a body.")
            else:
                if not (data.get("subject") or "").strip():
                    errors.append(f"{label} needs a subject.")
                if not (data.get("body") or "").strip():
                    errors.append(f"{label} needs a body.")
            if data.get("send_mode") == "manual":
                hours = data.get("due_within_hours")
                if hours is not None and (not isinstance(hours, (int, float)) or hours <= 0):
                    errors.append(f"{label} needs a deadline greater than 0 hours.")
                timeout_target = data.get("branch_on_timeout")
                if timeout_target and timeout_target not in by_id:
                    errors.append(f"{label}'s deadline branch points at a node that no longer exists.")
        elif node_type == "wait":
            if not data.get("duration_hours") or data["duration_hours"] <= 0:
                errors.append(f"{label} needs a duration greater than 0 hours.")
        elif node_type == "condition" and data.get("field_rule"):
            rule = data["field_rule"]
            if rule.get("field") not in FIELD_RULE_FIELDS:
                errors.append(f"{label} needs a lead field to check ({', '.join(FIELD_RULE_FIELDS)}).")
            if rule.get("op") not in FIELD_RULE_OPS:
                errors.append(f"{label} needs a comparison ({', '.join(FIELD_RULE_OPS)}).")
            elif rule["op"] in ("contains_any", "equals") and not str(rule.get("value") or "").strip():
                errors.append(f"{label} needs a value to compare against.")
            for key in ("branch_on_match", "branch_on_no_match"):
                if data.get(key) and data[key] not in by_id:
                    errors.append(f"{label}'s {key.replace('branch_on_', '').replace('_', ' ')} branch points at a node that no longer exists.")
        elif node_type == "task":
            if data.get("task_kind") not in TASK_KIND_LABELS:
                errors.append(f"{label} needs a task type ({', '.join(TASK_KIND_LABELS)}).")
            if data.get("task_kind") == "linkedin_message" and not (data.get("instructions") or "").strip():
                errors.append(f"{label} needs the LinkedIn message text for the rep to send.")
            keys = [o.get("key") for o in (data.get("outcomes") or [])]
            if any(not k for k in keys) or len(keys) != len(set(keys)):
                errors.append(f"{label} has an outcome with a missing or duplicate key.")
            for outcome, target in (data.get("branch_on_outcome") or {}).items():
                if outcome not in keys:
                    errors.append(f"{label} branches on outcome \"{outcome}\", which the step doesn't offer.")
                elif target not in by_id:
                    errors.append(f"{label}'s \"{outcome}\" branch points at a node that no longer exists.")
            hours = data.get("due_within_hours")
            if hours is not None and (not isinstance(hours, (int, float)) or hours <= 0):
                errors.append(f"{label} needs a deadline greater than 0 hours.")
        elif node_type == "condition":
            if not data.get("timeout_hours") or data["timeout_hours"] <= 0:
                errors.append(f"{label} needs a timeout greater than 0 hours.")
            branch_on_timeout = data.get("branch_on_timeout")
            if not branch_on_timeout:
                errors.append(f"{label} needs an \"on timeout\" branch target.")
            elif branch_on_timeout not in by_id:
                errors.append(f"{label}'s timeout branch points at a node that no longer exists.")
            for event_type, target in (data.get("branch_on_event") or {}).items():
                if not event_type:
                    errors.append(f"{label} has an event branch with no event type set.")
                elif target not in by_id:
                    errors.append(f"{label}'s \"{event_type}\" branch points at a node that no longer exists.")
        elif node_type == "call":
            if not (data.get("title") or "").strip():
                errors.append(f"{label} needs a task title.")
        elif node_type == "sms":
            message = data.get("message") or ""
            if not message.strip():
                errors.append(f"{label} needs a message.")
            elif len(message) > SMS_MAX_LENGTH:
                errors.append(f"{label} message is too long (max {SMS_MAX_LENGTH} characters).")
            if data.get("send_mode") == "manual":
                hours = data.get("due_within_hours")
                if hours is not None and (not isinstance(hours, (int, float)) or hours <= 0):
                    errors.append(f"{label} needs a deadline greater than 0 hours.")
                timeout_target = data.get("branch_on_timeout")
                if timeout_target and timeout_target not in by_id:
                    errors.append(f"{label}'s deadline branch points at a node that no longer exists.")
        elif node_type == "whatsapp":
            # A cadence's first touch is always outside any existing session
            # window, so a template is the only reliable send path — a plain
            # message is accepted too (used only if the window happens to
            # already be open) but isn't sufficient on its own.
            if not (data.get("template_name") or "").strip():
                errors.append(f"{label} needs a WhatsApp template selected.")
    return errors


def _settings_fields(j) -> dict:
    return {
        "send_tz": j.send_tz,
        "send_window_start_hour": j.send_window_start_hour,
        "send_window_end_hour": j.send_window_end_hour,
        "send_days": j.send_days,
        "stop_on_reply": bool(j.stop_on_reply),
        "stop_on_meeting": bool(j.stop_on_meeting),
        "max_duration_days": j.max_duration_days,
        "reengage_after_days": j.reengage_after_days,
        "reengage_min_opens": j.reengage_min_opens,
        "allow_reenroll": j.allow_reenroll is not False,   # NULL (pre-v13.9.0 cadence) = allowed
        "reenroll_cooloff_days": j.reenroll_cooloff_days,
        "send_as": j.send_as or "owner",
        "vertical": j.vertical,
    }


# (min, max) for the cadence-level day/count settings; None clears a setting.
_INT_SETTINGS = {"max_duration_days": (1, 365), "reengage_after_days": (1, 365), "reengage_min_opens": (1, 20),
                 "reenroll_cooloff_days": (1, 365)}


def _validate_settings_body(body: dict) -> dict:
    """Validates the cadence-level settings in update_journey_settings. Only
    validates/returns keys actually present in body — callers apply what's
    given."""
    out = {}
    for key in ("stop_on_reply", "stop_on_meeting", "allow_reenroll"):
        if key in body:
            if not isinstance(body[key], bool):
                raise HTTPException(status_code=422, detail=f"{key} must be true or false")
            out[key] = body[key]
    for key, (lo, hi) in _INT_SETTINGS.items():
        if key in body:
            val = body[key]
            if val is not None and (not isinstance(val, int) or isinstance(val, bool) or not lo <= val <= hi):
                raise HTTPException(status_code=422, detail=f"{key} must be a whole number {lo}-{hi}, or empty")
            out[key] = val
    if "send_as" in body:
        if body["send_as"] not in ("owner", "assigned_rep"):
            raise HTTPException(status_code=422, detail='send_as must be "owner" or "assigned_rep"')
        out["send_as"] = None if body["send_as"] == "owner" else "assigned_rep"
    if "send_tz" in body:
        tz = body["send_tz"] or None
        if tz:
            try:
                ZoneInfo(tz)
            except (ZoneInfoNotFoundError, ValueError):
                raise HTTPException(status_code=422, detail=f"Unknown timezone: {tz}")
        out["send_tz"] = tz
    for key in ("send_window_start_hour", "send_window_end_hour"):
        if key in body:
            val = body[key]
            if val is not None:
                if not isinstance(val, int) or not (0 <= val <= 23):
                    raise HTTPException(status_code=422, detail=f"{key} must be an integer 0-23")
            out[key] = val
    if "send_window_start_hour" in out and "send_window_end_hour" in out:
        start, end = out["send_window_start_hour"], out["send_window_end_hour"]
        if start is not None and end is not None and end <= start:
            raise HTTPException(status_code=422, detail="send_window_end_hour must be after send_window_start_hour")
    if "send_days" in body:
        days = body["send_days"] or None
        if days:
            try:
                parsed = [int(d) for d in days.split(",") if d.strip() != ""]
            except ValueError:
                parsed = None
            if parsed is None or not parsed or any(d < 0 or d > 6 for d in parsed):
                raise HTTPException(status_code=422, detail="send_days must be a comma-separated list of 0-6 (Mon=0..Sun=6)")
        out["send_days"] = days
    if "vertical" in body:
        v = body["vertical"]
        if v is not None and not isinstance(v, str):
            raise HTTPException(status_code=422, detail="vertical must be a string or empty")
        out["vertical"] = (v or None)
    return out


@router.post("/ai/generate-email")
def ai_generate_email(body: dict, db: Session = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    """v10.9.9 — draft an email node's subject/body from a short brief,
    reusing the same Groq config Smart Analytics already uses. Not tied to
    a specific journey_id — generation doesn't read journey data, only the
    brief the admin types."""
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="prompt is required")
    try:
        return generate_email_copy(db, prompt)
    except AICopyError as e:
        status = 422 if e.code == "llm_not_configured" else 502
        raise HTTPException(status_code=status, detail=e.message)


@router.get("")
def list_journeys(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """List journeys for the builder's landing list. Open to every
    authenticated role — non-admin roles get a read-only builder view in the
    frontend (SalesToolsHub) for transparency; every mutating route below is
    Pod Admin+ AND owner-scoped (see _require_journey_owner).

    owner_name/can_edit are returned so the list can attribute a cadence to
    its owner and gate its own Edit/Delete affordances on the same rule the
    API enforces, instead of offering buttons that 403.

    "My cadences only" filtering happens client-side in JourneyList.jsx off
    of is_mine below — the full list is already small and already fetched
    whole, so a server-side filter param would be unused flexibility."""
    journeys = db.query(models.Journey).order_by(models.Journey.created_at.desc()).all()

    owner_ids = {j.owner_id for j in journeys if j.owner_id}
    owner_names = {}
    if owner_ids:
        owner_names = {
            u.id: (u.name or u.email or "")
            for u in db.query(models.User).filter(models.User.id.in_(owner_ids)).all()
        }

    is_super = user.get("role") == "Super Admin"
    return [
        {"id": j.id, "name": j.name, "status": j.status, "owner_id": j.owner_id, "pod_id": j.pod_id,
         "owner_name": owner_names.get(j.owner_id) or "Unknown",
         "is_mine": bool(j.owner_id) and j.owner_id == user.get("sub"),
         "can_edit": is_super or (bool(j.owner_id) and j.owner_id == user.get("sub")),
         "created_at": j.created_at.isoformat() if j.created_at else None, **_settings_fields(j)}
        for j in journeys
    ]


@router.get("/stats-bulk")
def get_journeys_stats_bulk(ids: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Cross-cadence engagement comparison — one call for N journeys instead
    of JourneyList.jsx's old Promise.all(journeys.map(getStats)) N+1 pattern.
    `ids` is a comma-separated list of journey ids.

    No extra access check beyond existence: list_journeys (above) is
    deliberately "open to every authenticated role... for transparency,"
    with mutations (not reads) being the only owner/Pod-Admin-gated surface
    on this router — get_journey_stats for a single id has never been
    pod-restricted either, so this intentionally matches that, not a new
    access decision made here."""
    journey_ids = [i for i in (ids or "").split(",") if i]
    if not journey_ids:
        return {"journeys": {}}
    existing_ids = {
        j.id for j in db.query(models.Journey.id).filter(models.Journey.id.in_(journey_ids)).all()
    }

    status_rows = models.exclude_test_leads(
        db.query(
            models.JourneyEnrollment.journey_id, models.JourneyEnrollment.status,
            func.count(models.JourneyEnrollment.id),
        ).filter(models.JourneyEnrollment.journey_id.in_(existing_ids)),
        models.JourneyEnrollment,
    ).group_by(models.JourneyEnrollment.journey_id, models.JourneyEnrollment.status).all()
    counts_by_journey = {}
    for jid, status, count in status_rows:
        counts_by_journey.setdefault(jid, {})[status] = count

    engagement_rows = models.exclude_test_leads(
        db.query(
            models.LeadEmailActivity.journey_id, models.LeadEmailActivity.opened_at,
            models.LeadEmailActivity.clicked_at, models.LeadEmailActivity.nylas_thread_id,
        ).filter(
            models.LeadEmailActivity.journey_id.in_(existing_ids),
            models.LeadEmailActivity.direction == "outbound",
        ),
        models.LeadEmailActivity,
    ).all()
    replied_thread_ids_by_journey = {jid: _reply_rate_thread_ids(db, jid) for jid in existing_ids}
    engagement_by_journey = {}
    for jid, opened_at, clicked_at, thread_id in engagement_rows:
        bucket = engagement_by_journey.setdefault(jid, {"sent": 0, "opened": 0, "clicked": 0, "replied": 0})
        bucket["sent"] += 1
        if opened_at:
            bucket["opened"] += 1
        if clicked_at:
            bucket["clicked"] += 1
        if thread_id and thread_id in replied_thread_ids_by_journey.get(jid, set()):
            bucket["replied"] += 1

    return {
        "journeys": {
            jid: {
                "active": counts_by_journey.get(jid, {}).get("active", 0),
                "completed": counts_by_journey.get(jid, {}).get("completed", 0),
                "failed": counts_by_journey.get(jid, {}).get("failed", 0),
                "exited_early": counts_by_journey.get(jid, {}).get("exited_early", 0),
                "paused": counts_by_journey.get(jid, {}).get("paused", 0),
                "engagement": _engagement_rates(**engagement_by_journey.get(
                    jid, {"sent": 0, "opened": 0, "clicked": 0, "replied": 0})),
            }
            for jid in existing_ids
        }
    }


@router.get("/{journey_id}")
def get_journey(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Fetch a journey plus its current draft version's graph, for the
    builder to load into the canvas. Falls back to the live published
    version's graph as a read-only reference if there's no draft (shouldn't
    normally happen — create_journey always makes an initial draft)."""
    journey = _get_journey_or_404(db, journey_id)

    draft = db.query(models.JourneyVersion).filter(
        models.JourneyVersion.journey_id == journey_id,
        models.JourneyVersion.status == "draft",
    ).order_by(models.JourneyVersion.version_number.desc()).first()
    version = draft or db.query(models.JourneyVersion).filter(
        models.JourneyVersion.id == journey.live_version_id
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Journey has no version to load")

    owner = db.query(models.User).filter(models.User.id == journey.owner_id).first() \
        if journey.owner_id else None

    return {
        "id": journey.id, "name": journey.name, "status": journey.status, "pod_id": journey.pod_id,
        "live_version_id": journey.live_version_id,
        "version_id": version.id, "version_number": version.version_number,
        "version_status": version.status,
        "graph_definition": version.graph_definition,
        "updated_at": version.updated_at.isoformat() if version.updated_at else None,
        # Ownership travels with the journey so the builder can render its
        # read-only banner and owner attribution from one source of truth
        # rather than re-deriving the rule client-side.
        "owner_id": journey.owner_id,
        "owner_name": (owner.name or owner.email) if owner else "Unknown",
        "is_mine": bool(journey.owner_id) and journey.owner_id == user.get("sub"),
        "can_edit": user.get("role") == "Super Admin"
                    or (bool(journey.owner_id) and journey.owner_id == user.get("sub")),
        **_settings_fields(journey),
    }


@router.patch("/{journey_id}")
def update_journey_settings(journey_id: str, body: dict, db: Session = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    """Journey-level settings that aren't part of the graph_definition draft/publish
    flow — pod scoping and the send-time window. Takes effect immediately
    (no draft/publish step), same as pause/resume."""
    journey = _get_journey_or_404(db, journey_id)
    _require_journey_owner(journey, user, "change the settings of")
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="name is required")
        journey.name = name
    if "pod_id" in body:
        pod_id = body["pod_id"] or None
        if pod_id and not db.query(models.Pod).filter(models.Pod.id == pod_id).first():
            raise HTTPException(status_code=422, detail="Unknown pod_id")
        journey.pod_id = pod_id
    settings = _validate_settings_body(body)
    if settings.get("stop_on_reply") and journey.live_version_id:
        live = db.query(models.JourneyVersion).filter(models.JourneyVersion.id == journey.live_version_id).first()
        conflict = _reply_branch_conflict(live.graph_definition if live else {}, True)
        if conflict:
            raise HTTPException(status_code=422, detail=conflict)
    for key, value in settings.items():
        setattr(journey, key, value)
    db.commit()
    return {"id": journey.id, "name": journey.name, "pod_id": journey.pod_id, **_settings_fields(journey)}


@router.post("")
def create_journey(body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    # Cadence creation opened to every authenticated role so reps can build
    # their own cadences, not just Pod Admin+ — the creator becomes the
    # owner (owner_id = user.sub below) and every subsequent mutating route
    # (_require_journey_owner) already enforces owner-or-Super-Admin.
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")

    pod_id = body.get("pod_id") or None
    if pod_id and not db.query(models.Pod).filter(models.Pod.id == pod_id).first():
        raise HTTPException(status_code=422, detail="Unknown pod_id")

    # v13.0.0 defaults for NEW cadences (existing ones keep the column
    # defaults = off / owner): a reply or a booked meeting ends it, and the
    # lead's own rep sends. Each is a cadence setting the owner can change.
    journey = models.Journey(name=name, owner_id=user.get("sub"), status="draft", pod_id=pod_id,
                             stop_on_reply=True, stop_on_meeting=True, send_as="assigned_rep",
                             allow_reenroll=False)
    db.add(journey)
    db.flush()

    draft_version = models.JourneyVersion(
        journey_id=journey.id,
        version_number=1,
        graph_definition={"nodes": [], "edges": []},
        status="draft",
        created_by=user.get("sub"),
    )
    db.add(draft_version)
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_CREATED",
                 object_type="journey", object_id=journey.id, metadata={"journey_name": name})

    return {
        "id": journey.id, "name": journey.name, "status": journey.status, "pod_id": journey.pod_id,
        "live_version_id": journey.live_version_id, "draft_version_id": draft_version.id,
    }


# Journey columns a duplicate carries over (everything that's a setting, not identity/lifecycle).
_COPIED_SETTINGS = ("send_tz", "send_window_start_hour", "send_window_end_hour", "send_days",
                    "stop_on_reply", "stop_on_meeting", "max_duration_days",
                    "reengage_after_days", "reengage_min_opens", "send_as",
                    "allow_reenroll", "reenroll_cooloff_days")


@router.post("/{journey_id}/duplicate")
def duplicate_journey(journey_id: str, body: dict = None, db: Session = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    """v13.0.0 — copy a cadence into a new DRAFT owned by the caller: the
    latest version's steps (draft or published) and every cadence setting.
    Nothing is published or enrolled. Cadences are org-readable, so any
    authenticated role may copy one (e.g. build the Salesforce-aware
    Cadence 2 from the generic Cadence 1) — the copy is theirs to edit.
    Widened from Pod Admin+ in v13.1.3, matching create_journey's own
    every-role opening in v13.1.1 — a rep who can build a cadence from
    scratch should also be able to start from a copy of one."""
    import copy
    source = _get_journey_or_404(db, journey_id)
    latest = db.query(models.JourneyVersion).filter(
        models.JourneyVersion.journey_id == source.id
    ).order_by(models.JourneyVersion.version_number.desc()).first()
    name = ((body or {}).get("name") or f"Copy of {source.name}").strip()

    journey = models.Journey(name=name, owner_id=user.get("sub"), status="draft", pod_id=source.pod_id,
                             **{k: getattr(source, k) for k in _COPIED_SETTINGS})
    db.add(journey)
    db.flush()
    draft = models.JourneyVersion(
        journey_id=journey.id, version_number=1, status="draft", created_by=user.get("sub"),
        graph_definition=copy.deepcopy(latest.graph_definition) if latest else {"nodes": [], "edges": []},
    )
    db.add(draft)
    db.commit()
    log_activity(user_id=user.get("sub"), action_type="JOURNEY_CREATED", object_type="journey",
                 object_id=journey.id, metadata={"journey_name": name, "duplicated_from": source.id})
    return {"id": journey.id, "name": journey.name, "status": journey.status, "pod_id": journey.pod_id,
            "live_version_id": None, "draft_version_id": draft.id}


@router.put("/{journey_id}/versions/{version_id}")
def save_draft(journey_id: str, version_id: str, body: dict,
               db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    # Ownership is checked before the version lookup: this is the autosave that
    # writes the graph itself, so it is the single most important of the guarded
    # routes — without it a non-owner's builder session silently overwrote
    # another owner's cadence on every keystroke.
    _require_journey_owner(_get_journey_or_404(db, journey_id), user, "edit")

    version = db.query(models.JourneyVersion).filter(
        models.JourneyVersion.id == version_id,
        models.JourneyVersion.journey_id == journey_id,
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.status != "draft":
        raise HTTPException(status_code=409, detail="Only the current draft version can be autosaved")

    graph_definition = body.get("graph_definition")
    if graph_definition is None:
        raise HTTPException(status_code=422, detail="graph_definition is required")

    # Optimistic concurrency (Gap 6): zero rows affected means someone else
    # saved first — a 409, not a silent overwrite.
    expected_updated_at = body.get("expected_updated_at")
    if expected_updated_at:
        expected_dt = datetime.fromisoformat(expected_updated_at.replace("Z", "+00:00"))
        current_dt = version.updated_at
        if current_dt and current_dt.replace(microsecond=0) != expected_dt.replace(microsecond=0):
            raise HTTPException(
                status_code=409,
                detail="This journey was modified by another editor since you last loaded it. Refresh to see their changes.",
            )

    version.graph_definition = graph_definition
    db.commit()

    return {
        "version_id": version.id, "version_number": version.version_number,
        "status": version.status, "saved_at": version.updated_at.isoformat(),
    }


@router.post("/{journey_id}/publish")
def publish_journey(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    journey = _get_journey_or_404(db, journey_id)
    _require_journey_owner(journey, user, "publish")

    draft = db.query(models.JourneyVersion).filter(
        models.JourneyVersion.journey_id == journey_id,
        models.JourneyVersion.status == "draft",
    ).order_by(models.JourneyVersion.version_number.desc()).first()
    if not draft:
        raise HTTPException(status_code=409, detail="No draft version to publish")

    graph = draft.graph_definition or {}
    errors = _validate_graph_for_publish(graph)
    conflict = _reply_branch_conflict(graph, journey.stop_on_reply)
    if conflict:
        errors.append(conflict)
    if errors:
        raise HTTPException(status_code=422, detail="Cannot publish — " + "; ".join(errors))

    prior_published = db.query(models.JourneyVersion).filter(
        models.JourneyVersion.journey_id == journey_id,
        models.JourneyVersion.status == "published",
    ).first()
    if prior_published:
        prior_published.status = "superseded"

    draft.status = "published"
    draft.published_at = datetime.now(timezone.utc)
    journey.live_version_id = draft.id
    journey.status = "active"

    # Fork the next draft immediately — without this, re-opening a published
    # journey has no draft row to edit into (get_journey falls back to the
    # live version) and save_draft 409s on every save with "Only the current
    # draft version can be autosaved", making a published journey permanently
    # uneditable in practice.
    next_draft = models.JourneyVersion(
        journey_id=journey.id,
        version_number=draft.version_number + 1,
        graph_definition=draft.graph_definition,
        status="draft",
        created_by=user.get("sub"),
    )
    db.add(next_draft)
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_PUBLISHED",
                 object_type="journey", object_id=journey.id,
                 metadata={"journey_name": journey.name, "version_number": draft.version_number})

    return {
        "id": journey.id, "status": journey.status,
        "live_version_id": journey.live_version_id, "version_number": draft.version_number,
        "draft_version_id": next_draft.id,
    }


@router.get("/{journey_id}/enroll-check")
def check_enrollment_mailboxes(journey_id: str, lead_ids: str, db: Session = Depends(get_db),
                                user: dict = Depends(get_current_user)):
    """Two backlog gaps, one non-blocking pre-confirm warning banner (same
    dialog, same "check before you commit" shape — not two separate
    mechanisms):

    1. A broken/missing mailbox previously only surfaced AFTER enrolling, as
       a failed enrollment discovered later in Failed Enrollments. Reuses the
       exact same sender_candidates() resolution the real send uses at
       execute time, so the warning can never drift from actual send
       behavior.
    2. No guardrail existed against enrolling a lead into the wrong
       vertical's cadence. Both Lead.vertical and Journey.vertical are
       free-text and optional — this only warns when BOTH are set and they
       disagree, never blocks (a lead/journey with no vertical set never
       triggers it, so this is a pure opt-in).

    `lead_ids` is a comma-separated list (same shape the frontend already
    has from its selection)."""
    journey = _get_journey_or_404(db, journey_id)
    warnings = []
    for lead_id in [lid for lid in lead_ids.split(",") if lid]:
        try:
            lead = load_lead(db, user, lead_id)
        except HTTPException:
            continue  # same "hide existence" posture as everywhere else — skip, don't leak

        if journey.vertical and lead.vertical and lead.vertical != journey.vertical:
            warnings.append({
                "lead_id": lead_id, "type": "vertical_mismatch",
                "detail": f"This lead is tagged \"{lead.vertical}\" but the cadence is for \"{journey.vertical}\".",
            })

        candidates = sender_candidates(db, lead, journey)
        if not candidates:
            warnings.append({"lead_id": lead_id, "type": "no_sender",
                              "detail": "This cadence has no owner and the lead has no assigned rep — nothing to send as."})
            continue
        sender = candidates[0]
        mailbox = db.query(models.UserMailbox).filter(models.UserMailbox.user_id == sender.id).first()
        if mailbox and mailbox.status == "connected":
            continue
        fallback = next((c for c in candidates[1:]
                          if (m := db.query(models.UserMailbox).filter(
                              models.UserMailbox.user_id == c.id, models.UserMailbox.status == "connected").first())), None)
        warnings.append({
            "lead_id": lead_id, "type": "mailbox",
            "sender_name": sender.name or sender.email,
            "mailbox_status": mailbox.status if mailbox else "not_connected",
            "falls_back_to": (fallback.name or fallback.email) if fallback else None,
        })
    return {"warnings": warnings}


@router.post("/{journey_id}/enroll")
# Opened to every authenticated role so reps can add their own leads to a
# cadence they don't own (previously Pod Admin+ and cadence-owner only).
# The owner-only rule existed because enrolling is a write with a real send
# side effect: pre-v13.0.0, every send went out from journey.owner_id's own
# mailbox, so an unguarded enroll could make mail go out impersonating
# someone else. Since v13.0.0 defaults new cadences to send_as="assigned_rep"
# (the lead's own rep sends, not the owner), that risk doesn't apply there —
# only "owner always sends" cadences still require owner-or-Super-Admin,
# below. load_lead(edit=True) still requires the caller be allowed to edit
# each lead, either way.
def enroll(journey_id: str, body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    journey = _get_journey_or_404(db, journey_id)
    if journey.send_as != "assigned_rep":
        _require_journey_owner(journey, user, "enrol leads into")

    lead_ids = body.get("lead_ids") or []
    if not lead_ids:
        raise HTTPException(status_code=422, detail="lead_ids is required")
    if len(lead_ids) > 200:
        raise HTTPException(status_code=400, detail="Use the filter-based bulk path for more than 200 leads")
    for lid in lead_ids:  # the cadence owner must also be allowed to change each lead
        load_lead(db, user, lid, edit=True)

    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_count = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id,
        models.JourneyEnrollment.enrolled_at >= cutoff,
    ).count()
    remaining_capacity = max(0, ENROLLMENT_RATE_CAP_PER_HOUR - recent_count)

    enrolled, skipped = [], []
    for lead_id in lead_ids:
        if len(enrolled) >= remaining_capacity:
            skipped.append({
                "lead_id": lead_id,
                "reason": "rate_cap_reached_try_again_later",
                "detail": f"{recent_count} of {ENROLLMENT_RATE_CAP_PER_HOUR} enrollments/hour "
                          f"already used for this journey — try again in under an hour.",
            })
            continue
        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        if not lead:
            skipped.append({"lead_id": lead_id, "reason": "lead_not_found"})
            continue
        blocked = reenroll_block_reason(db, journey, lead)
        if blocked:
            skipped.append({"lead_id": lead_id, "reason": "reenrollment_not_allowed", "detail": blocked})
            continue
        enrollment = enroll_lead(db, journey, lead, via="manual")
        if enrollment:
            enrolled.append(lead_id)
        else:
            skipped.append({"lead_id": lead_id, "reason": "already_active_in_journey_or_not_publishable"})

    return {"requested": len(lead_ids), "enrolled": len(enrolled), "skipped": skipped}


@router.post("/{journey_id}/sandbox/enroll-test-lead")
def enroll_test_lead(journey_id: str, body: dict, db: Session = Depends(get_db),
                      user: dict = Depends(require_pod_admin_or_above)):
    """Cadence/Messaging Sandbox — Playground's "Cadence Test" tab. Creates a
    throwaway Lead tagged is_test=True and enrolls it in this journey.

    The lead's phone is always settings.sandbox_test_phone_number, set
    server-side — anything the caller passes for a phone is ignored, so a
    test lead can never be pointed at a real number by mistake (the
    whatsapp/sms channel providers also redirect to this same setting as a
    second, independent guard — see journey_engine/channels/).
    """
    # Authorization first: the sandbox-phone check below is unrelated config,
    # and gating the owner check behind it answered a non-owner with 422
    # instead of 403 (i.e. the guard only applied once the org happened to be
    # configured). Fail closed on identity before validating anything else.
    journey = _get_journey_or_404(db, journey_id)
    _require_journey_owner(journey, user, "enrol a test lead into")

    settings = _get_or_create_sync_settings(db)
    sandbox_phone = getattr(settings, "sandbox_test_phone_number", None) or ""
    if not sandbox_phone:
        raise HTTPException(status_code=422, detail="Set a Sandbox Test Phone Number in Settings first.")

    if not journey.live_version_id:
        raise HTTPException(status_code=409, detail="This journey has no published version to enroll into.")

    import uuid as _uuid
    lead = models.Lead(
        # RCA 2026-09-30: leads.sf_lead_id is NOT NULL in the real database
        # (models.py's nullable=True doesn't reflect it — never migrated).
        # routes/lead_routes.py's manual-create path already works around this
        # with the same synthetic id; this endpoint never did, so every
        # Cadence Sandbox test-lead enrollment failed with a 500 against
        # Postgres since v13.0.0 shipped it — SQLite tests never enforce the
        # constraint the same way, so nothing caught it before a real
        # end-to-end staging run.
        sf_lead_id=f"manual-{_uuid.uuid4().hex[:8]}",
        first_name="Sandbox",
        last_name=(body.get("label") or "Test Lead").strip()[:100],
        phone=sandbox_phone,
        lead_source="manual",
        is_test=True,
    )
    db.add(lead)
    db.flush()

    enrollment = enroll_lead(db, journey, lead, via="sandbox")
    if not enrollment:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not enroll the test lead (journey has no reachable first node).")
    db.commit()

    return {"lead_id": lead.id, "enrollment_id": enrollment.id, "phone": sandbox_phone}


@router.delete("/sandbox/test-leads")
def clear_test_leads(db: Session = Depends(get_db), user: dict = Depends(require_pod_admin_or_above)):
    """Bulk-removes every Cadence/Messaging Sandbox test lead. Explicitly
    deletes JourneyEnrollment rows first (which in turn cascades their own
    JourneyExecutionQueue rows) rather than relying solely on the DB's
    lead_id ON DELETE CASCADE. SmsLog/DialerCall/
    CallLog/Task rows are left to the DB's own lead_id cascade."""
    test_lead_ids = [row[0] for row in db.query(models.Lead.id).filter(models.Lead.is_test.is_(True)).all()]
    if test_lead_ids:
        enrollment_ids = [row[0] for row in db.query(models.JourneyEnrollment.id).filter(
            models.JourneyEnrollment.lead_id.in_(test_lead_ids)
        ).all()]
        if enrollment_ids:
            db.query(models.JourneyExecutionQueue).filter(
                models.JourneyExecutionQueue.enrollment_id.in_(enrollment_ids)
            ).delete(synchronize_session=False)
        db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.lead_id.in_(test_lead_ids)
        ).delete(synchronize_session=False)
    count = db.query(models.Lead).filter(models.Lead.id.in_(test_lead_ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": count}


def _scope_enrollments(db, query, actor):
    """Restrict an enrollment query to the leads `actor` may see — in SQL, so
    counts, pages and the CSV all agree (v13.8.0: the roster used to return
    every lead's name, company and email to any logged-in user)."""
    if actor is None or actor.is_super_admin:
        return query
    return query.filter(models.JourneyEnrollment.lead_id.in_(
        visible_leads(db, actor).with_entities(models.Lead.id).subquery()))


def _journey_status_counts(db, journey_id: str, actor=None) -> dict:
    """Enrollment counts by status — shared by /stats and the enrollment
    roster so they can't drift onto two slightly different queries for the
    same number. /stats stays org-wide (aggregates, no lead data); the roster
    passes the viewer so its counts match the rows it lists."""
    return dict(_scope_enrollments(db, models.exclude_test_leads(
        db.query(models.JourneyEnrollment.status, func.count(models.JourneyEnrollment.id)).filter(
            models.JourneyEnrollment.journey_id == journey_id
        ),
        models.JourneyEnrollment,
    ), actor).group_by(models.JourneyEnrollment.status).all())


@router.get("/{journey_id}/stats")
def get_journey_stats(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    journey = _get_journey_or_404(db, journey_id)
    counts = _journey_status_counts(db, journey_id)

    # queue_depth/oldest_overdue_seconds: "500 active" alone can't tell healthy
    # from wedged — this is what actually distinguishes the two.
    queue_depth = models.exclude_test_leads(
        db.query(func.count(models.JourneyExecutionQueue.id))
        .join(models.JourneyEnrollment, models.JourneyExecutionQueue.enrollment_id == models.JourneyEnrollment.id)
        .filter(models.JourneyEnrollment.journey_id == journey_id)
        .filter(models.JourneyExecutionQueue.status.in_(["pending", "claimed"])),
        models.JourneyEnrollment,
    ).scalar()
    oldest_pending_at = models.exclude_test_leads(
        db.query(func.min(models.JourneyExecutionQueue.next_run_at))
        .join(models.JourneyEnrollment, models.JourneyExecutionQueue.enrollment_id == models.JourneyEnrollment.id)
        .filter(models.JourneyEnrollment.journey_id == journey_id)
        .filter(models.JourneyExecutionQueue.status == "pending"),
        models.JourneyEnrollment,
    ).scalar()
    oldest_overdue_seconds = 0
    if oldest_pending_at:
        now = datetime.now(timezone.utc)
        oldest_dt = oldest_pending_at if oldest_pending_at.tzinfo else oldest_pending_at.replace(tzinfo=timezone.utc)
        oldest_overdue_seconds = max(0, round((now - oldest_dt).total_seconds(), 1))

    total = sum(counts.values())
    exit_reasons = dict(models.exclude_test_leads(
        db.query(models.JourneyEnrollment.exited_reason, func.count(models.JourneyEnrollment.id)).filter(
            models.JourneyEnrollment.journey_id == journey_id,
            models.JourneyEnrollment.exited_reason.isnot(None),
        ), models.JourneyEnrollment,
    ).group_by(models.JourneyEnrollment.exited_reason).all())
    # Feedback: "opt-out rate" as its own stat, not a count buried inside a
    # sentence — "suppressed" is the literal reason _is_lead_eligible's
    # rejection writes (journey_engine/engine.py), confirmed via every
    # _exit_enrollment_early(reason="suppressed") call site.
    opted_out_count = exit_reasons.get("suppressed", 0)

    return {
        "journey_id": journey_id,
        "active": counts.get("active", 0),
        "completed": counts.get("completed", 0),
        "failed": counts.get("failed", 0),
        "exited_early": counts.get("exited_early", 0),
        "paused": counts.get("paused", 0),
        "total": total,
        "queue_depth": queue_depth or 0,
        "oldest_overdue_seconds": oldest_overdue_seconds,
        "engagement": _journey_engagement_stats(db, journey_id),
        "sms_engagement": _journey_sms_engagement_stats(db, journey_id),
        "step_activity": _journey_step_activity(db, journey_id),
        "exit_reasons": exit_reasons,
        "opted_out": {"count": opted_out_count, "rate": round(opted_out_count / total, 3) if total else 0.0},
    }


@router.get("/{journey_id}/stats/trend")
def get_journey_stats_trend(journey_id: str, bucket: str = "week",
                             db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Weekly (or daily) email open/reply rate over time — v1, read-time
    only, no snapshot table. ExecutionLog/LeadEmailActivity are both
    already indexed/timestamped for this; a scheduled daily-rollup table
    (the pattern _aggregate_daily_summaries/UserActivityDailySummary already
    uses elsewhere) is a straightforward follow-up if this read-time query
    ever gets too slow for one journey — not needed yet. Scoped by
    journey_id first (indexed) before grouping, so this stays a targeted
    scan, not a scan of the whole table. Bucketed in plain UTC via
    date_trunc, matching the convention analytics_routes.py's own trend
    endpoints already use (no timezone conversion there either) — not
    introducing a second, inconsistent convention."""
    _get_journey_or_404(db, journey_id)
    trunc_fn = bucket if bucket in ("day", "week", "month") else "week"

    rows = models.exclude_test_leads(
        db.query(
            func.date_trunc(trunc_fn, models.LeadEmailActivity.timestamp).label("period"),
            func.count(models.LeadEmailActivity.id).label("sent"),
            func.count(models.LeadEmailActivity.opened_at).label("opened"),
        ).filter(
            models.LeadEmailActivity.journey_id == journey_id,
            models.LeadEmailActivity.direction == "outbound",
        ),
        models.LeadEmailActivity,
    ).group_by(text("1")).order_by(text("1")).all()

    return {
        "bucket": trunc_fn,
        "points": [
            {
                "period": r.period.isoformat() if r.period else None,
                "sent": r.sent,
                "opened": r.opened,
                "open_rate": round(r.opened / r.sent, 3) if r.sent else 0.0,
            }
            for r in rows
        ],
    }


@router.get("/{journey_id}/stats/by-rep")
def get_journey_stats_by_rep(journey_id: str, db: Session = Depends(get_db),
                              user: dict = Depends(get_current_user)):
    """Which rep's sends on THIS cadence perform best — answers "whose
    cadence sends convert best," which the org-wide SDR analytics (Analytics
    Hub) can't, since those aren't journey-scoped. Reuses the exact
    LeadEmailActivity.user_id grouping _q_email_open_rate/_q_email_reply_rate
    already use in smart_analytics.py — both columns are first-class  row already, no schema change. user_id is written at send time by
    the resolved sender (email_send.py's mailbox.user_id), so a lead
    reassignment mid-cadence does NOT retroactively misattribute historical
    sends to the new owner — confirmed before writing this."""
    _get_journey_or_404(db, journey_id)

    rows = models.exclude_test_leads(
        db.query(
            models.LeadEmailActivity.user_id,
            models.LeadEmailActivity.opened_at,
            models.LeadEmailActivity.nylas_thread_id,
        ).filter(
            models.LeadEmailActivity.journey_id == journey_id,
            models.LeadEmailActivity.direction == "outbound",
        ),
        models.LeadEmailActivity,
    ).all()
    if not rows:
        return {"reps": []}

    replied_thread_ids = _reply_rate_thread_ids(db, journey_id)
    by_user = {}
    for user_id, opened_at, thread_id in rows:
        bucket = by_user.setdefault(user_id, {"sent": 0, "opened": 0, "clicked": 0, "replied": 0})
        bucket["sent"] += 1
        if opened_at:
            bucket["opened"] += 1
        if thread_id and thread_id in replied_thread_ids:
            bucket["replied"] += 1

    names = {
        u.id: (u.name or u.email or "Unknown")
        for u in db.query(models.User).filter(models.User.id.in_(
            [uid for uid in by_user if uid]
        )).all()
    }

    reps = [
        {"user_id": uid, "name": names.get(uid, "Unknown"), **_engagement_rates(**counts)}
        for uid, counts in by_user.items() if uid
    ]
    reps.sort(key=lambda r: r["reply_rate"], reverse=True)
    return {"reps": reps}


def _journey_enrollment_rows(db, journey_id: str, actor=None):
    """Feedback #8/#9: per-lead roster — who's enrolled, where they are right
    now, and how they ended up (vs. the cross-cadence aggregates /stats
    already gives). Shared by the paginated roster endpoint and the CSV
    export so they can never drift apart on what a row means. Scoped to the
    leads `actor` may see."""
    return _scope_enrollments(db, models.exclude_test_leads(
        db.query(models.JourneyEnrollment, models.Lead)
        .join(models.Lead, models.JourneyEnrollment.lead_id == models.Lead.id)
        .filter(models.JourneyEnrollment.journey_id == journey_id)
        .order_by(models.JourneyEnrollment.enrolled_at.desc()),
        models.JourneyEnrollment,
    ), actor)


def _journey_live_graph(db, journey) -> dict:
    """The published graph a journey's active enrollments are running
    against — shared by anything that needs to resolve a node id to its
    label (the roster, its CSV export)."""
    version = db.query(models.JourneyVersion).filter(models.JourneyVersion.id == journey.live_version_id).first()
    return version.graph_definition if version else {}


ENROLLMENT_ROSTER_PAGE_LIMIT = 500


@router.get("/{journey_id}/enrollments")
def get_journey_enrollments(journey_id: str, offset: int = 0, db: Session = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    """The per-lead roster a "cadence dashboard" needs: total enrolled, each
    lead's current step, and how/why they finished — _get_journey_stats only
    has status COUNTS, which can't answer "which leads, specifically.\""""
    journey = _get_journey_or_404(db, journey_id)
    graph = _journey_live_graph(db, journey)

    actor = Actor.from_claims(user)
    base_query = _journey_enrollment_rows(db, journey_id, actor)
    total = base_query.count()
    rows = base_query.offset(offset).limit(ENROLLMENT_ROSTER_PAGE_LIMIT).all()

    # How each lead got in, from the JOURNEY_ENROLLED audit row — one batched
    # query for the page. Enrollments from before `via` existed have none (null).
    via_by_enrollment = {}
    for obj_id, meta in db.query(models.UserActivityLog.object_id, models.UserActivityLog.metadata_json).filter(
        models.UserActivityLog.action_type == "JOURNEY_ENROLLED",
        models.UserActivityLog.object_id.in_([e.id for e, _ in rows]),
    ).all():
        try:
            via_by_enrollment[obj_id] = (json.loads(meta) if meta else {}).get("via")
        except ValueError:
            pass

    # "At what stage are they" — a live-demo question the per-lead table
    # alone answers only by scrolling every row. These two aggregates (true
    # totals, not just the current page) give the "mini funnel" glance a
    # stakeholder actually asks for: how many ended up where, and of the
    # ones still running, which step is holding them.
    status_counts = _journey_status_counts(db, journey_id, actor)
    active_by_node = _scope_enrollments(db, models.exclude_test_leads(
        db.query(models.JourneyEnrollment.current_node_id, func.count(models.JourneyEnrollment.id)).filter(
            models.JourneyEnrollment.journey_id == journey_id,
            models.JourneyEnrollment.status == "active",
        ), models.JourneyEnrollment,
    ), actor).group_by(models.JourneyEnrollment.current_node_id).all()
    stage_breakdown = [
        {"node_id": node_id, "label": _resolve_node_label(graph, node_id), "count": count}
        for node_id, count in active_by_node
    ]

    return {
        "total": total,
        "offset": offset,
        "limit": ENROLLMENT_ROSTER_PAGE_LIMIT,
        "status_counts": status_counts,
        "stage_breakdown": stage_breakdown,
        "enrollments": [
            {
                "enrollment_id": e.id,
                "lead_id": lead.id,
                "lead_name": f"{lead.first_name or ''} {lead.last_name or ''}".strip() or lead.email or "Unknown",
                "lead_company": lead.company,
                "status": e.status,
                "current_node_label": _resolve_node_label(graph, e.current_node_id) if e.status == "active" else None,
                "enrolled_at": e.enrolled_at.isoformat() if e.enrolled_at else None,
                "completed_at": e.completed_at.isoformat() if e.completed_at else None,
                "exited_reason": e.exited_reason,
                "enrolled_via": via_by_enrollment.get(e.id),
            }
            for e, lead in rows
        ],
    }


@router.get("/{journey_id}/enrollments/export", dependencies=[Depends(require_export_access)])
def export_journey_enrollments(journey_id: str, db: Session = Depends(get_db),
                                user: dict = Depends(get_current_user)):
    """Feedback #10: a raw downloadable report, since inspecting the roster
    one page at a time in the UI doesn't scale past a handful of leads."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    journey = _get_journey_or_404(db, journey_id)
    graph = _journey_live_graph(db, journey)
    rows = _journey_enrollment_rows(db, journey_id, Actor.from_claims(user))

    def generate():
        output = io.StringIO()
        writer = csv.writer(output)
        header = ["lead_name", "lead_email", "lead_company", "status", "current_step", "enrolled_at", "completed_at", "exited_reason"]
        writer.writerow(header)
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        for e, lead in rows.yield_per(500):
            writer.writerow([
                f"{lead.first_name or ''} {lead.last_name or ''}".strip() or "Unknown",
                lead.email or "", lead.company or "", e.status,
                _resolve_node_label(graph, e.current_node_id) if e.status == "active" else "",
                e.enrolled_at.isoformat() if e.enrolled_at else "",
                e.completed_at.isoformat() if e.completed_at else "",
                e.exited_reason or "",
            ])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    safe_name = "".join(c for c in journey.name if c.isalnum() or c in " _-").strip() or journey_id
    filename = f"cadence_{safe_name}_{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"
    return StreamingResponse(generate(), media_type="text/csv",
                              headers={"Content-Disposition": f"attachment; filename={filename}"})


_STEP_ACTIVITY_CHANNEL_NORMALIZE = {"email_manual": "email", "sms_manual": "sms"}


def _journey_step_activity(db, journey_id: str) -> dict:
    """v13.0.0 — per-step numbers for the non-automated-email steps, from the
    engine's own ExecutionLog, so manual work is tracked beside email
    engagement: task steps → created / completed / missed deadline + a count
    per outcome; sms/whatsapp/call → sent, and skipped (e.g. no phone number).

    v13.1.5 fix: a manual-approval email/SMS step logs its lifecycle under
    TWO different channel tags — "email_manual"/"sms_manual" when parked
    (_handle_manual_email_node/_handle_manual_sms_node's own event_type is
    the shared "send_attempted", distinguished only by channel) and plain
    "email"/"sms" when the rep's approved send actually fires (event_type
    "manual_email_sent"/"manual_sms_sent", "manual_email_timeout"/
    "manual_sms_timeout"). The original filter matched neither the
    "_manual"-suffixed channel nor these event types, so every manual
    email/SMS step silently showed zero sent/completed/missed forever —
    confirmed via journey_engine/engine.py's own _log() call sites, not
    assumed. Two queries (not one filter with channel="email"/"sms" added
    broadly) because plain "email" is also what an AUTOMATED email step's
    "send_attempted" uses — adding it to the first query's channel list
    would double-count automated email sends here on top of their own
    _journey_engagement_stats entry."""
    rows = models.exclude_test_leads(
        db.query(models.ExecutionLog.node_id, models.ExecutionLog.event_type,
                 models.ExecutionLog.status, models.ExecutionLog.channel, models.ExecutionLog.detail).filter(
            models.ExecutionLog.journey_id == journey_id,
            models.ExecutionLog.event_type.in_(["send_attempted", "task_completed", "task_timeout", "step_skipped"]),
            models.ExecutionLog.channel.in_(["task", "sms", "whatsapp", "call", "email_manual", "sms_manual"]),
        ), models.ExecutionLog,
    ).all()
    manual_completion_rows = models.exclude_test_leads(
        db.query(models.ExecutionLog.node_id, models.ExecutionLog.event_type,
                 models.ExecutionLog.status, models.ExecutionLog.channel, models.ExecutionLog.detail).filter(
            models.ExecutionLog.journey_id == journey_id,
            models.ExecutionLog.event_type.in_(["manual_email_sent", "manual_sms_sent",
                                                 "manual_email_timeout", "manual_sms_timeout"]),
        ), models.ExecutionLog,
    ).all()
    _MANUAL_EVENTS = {"manual_email_sent", "manual_sms_sent", "manual_email_timeout", "manual_sms_timeout"}
    steps = {}
    for node_id, event, status, channel, detail in rows + manual_completion_rows:
        display_channel = _STEP_ACTIVITY_CHANNEL_NORMALIZE.get(channel, channel)
        step = steps.setdefault(node_id, {"channel": display_channel, "sent": 0, "skipped": 0,
                                          "completed": 0, "missed": 0, "outcomes": {}, "is_manual": False})
        # channel in the normalize map OR a manual-only event type both mean
        # "this step is a manual approval step" — neither signal alone covers
        # every row (the park event only has the channel tag, the completion
        # event only has the event-type tag) — frontend needs this to tell a
        # manual SMS/email step apart from an automated one sharing the same
        # post-normalization channel name ("sms"/"email").
        if channel in _STEP_ACTIVITY_CHANNEL_NORMALIZE or event in _MANUAL_EVENTS:
            step["is_manual"] = True
        if event == "send_attempted" and status == "success":
            step["sent"] += 1                      # for a task/manual step: created/parked
        elif event == "step_skipped":
            step["skipped"] += 1
        elif event == "task_completed":
            step["completed"] += 1
            outcome = (detail or {}).get("outcome")
            if outcome:
                step["outcomes"][outcome] = step["outcomes"].get(outcome, 0) + 1
        elif event == "task_timeout":
            step["missed"] += 1
        elif event in ("manual_email_sent", "manual_sms_sent") and status == "success":
            step["completed"] += 1                 # rep approved, it sent
        elif event in ("manual_email_timeout", "manual_sms_timeout"):
            step["missed"] += 1
    return steps


# Outbound statuses that count as "actually reached the carrier" for a
# delivery rate. SmsLog.status is an unvalidated pass-through of whatever
# string the provider's delivery-report webhook sends (see
# webhook_routes.py's `payload.get("status", "delivered")`) — this allowlist
# keeps an unexpected/typo'd provider value from silently corrupting the
# rate instead of just being excluded from the numerator.
_SMS_DELIVERED_STATUSES = ("sent", "delivered")


def _journey_sms_engagement_stats(db, journey_id: str) -> dict:
    """v13.0.6 — SMS/WhatsApp delivery + reply rate, overall and per step.
    Mirrors _journey_engagement_stats's email shape, but the reply signal
    can't use a thread-id join the way email does: outbound SmsLog rows get
    journey_id/enrollment_id at send time (sms_channel.py/whatsapp_channel.py),
    but inbound rows never do (confirmed in webhook_routes.py's and
    messaging_sync.py's inbound write sites — neither sets enrollment_id),
    and conversation_id is only reliably set on the polling-sourced inbound
    path, not the direct-webhook path. So "did this enrollment get a reply"
    is computed the same way the engine itself decides to stop a cadence:
    any inbound SmsLog for the enrollment's lead, timestamped between that
    enrollment's start and end (or now, if still active) — enrollment-scoped,
    not per-outbound-message, so two simultaneously-active cadences for the
    same lead each get their own independent answer instead of double-
    counting one inbound text."""
    outbound_rows = models.exclude_test_leads(
        db.query(
            models.SmsLog.journey_node_id,
            models.SmsLog.enrollment_id,
            models.SmsLog.status,
        ).filter(
            models.SmsLog.journey_id == journey_id,
            models.SmsLog.direction == "outbound",
            models.SmsLog.channel.in_(("sms", "whatsapp")),
        ),
        models.SmsLog,
    ).all()
    if not outbound_rows:
        return {"overall": {"sent": 0, "delivered": 0, "replied": 0,
                             "delivery_rate": 0.0, "reply_rate": 0.0}, "by_step": {}}

    enrollment_ids = {eid for _, eid, _ in outbound_rows if eid}
    enrollments = {
        e.id: e for e in db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.id.in_(enrollment_ids)
        ).all()
    } if enrollment_ids else {}

    lead_ids = {e.lead_id for e in enrollments.values()}
    inbound_by_lead = {}
    if lead_ids:
        for lead_id, sent_at in db.query(models.SmsLog.lead_id, models.SmsLog.sent_at).filter(
            models.SmsLog.lead_id.in_(lead_ids),
            models.SmsLog.direction == "inbound",
            models.SmsLog.channel.in_(("sms", "whatsapp")),
        ).all():
            inbound_by_lead.setdefault(lead_id, []).append(sent_at)

    now = datetime.now(timezone.utc)

    def _enrollment_got_reply(enrollment) -> bool:
        if enrollment is None:
            return False
        window_start = _aware(enrollment.enrolled_at)
        window_end = _aware(enrollment.completed_at) if enrollment.completed_at else now
        for sent_at in inbound_by_lead.get(enrollment.lead_id, ()):
            if window_start <= _aware(sent_at) <= window_end:
                return True
        return False

    replied_enrollment_ids = {
        eid for eid, e in enrollments.items() if _enrollment_got_reply(e)
    }

    overall = {"sent": 0, "delivered": 0, "replied_enrollments": set()}
    by_step = {}
    for node_id, enrollment_id, status in outbound_rows:
        step = by_step.setdefault(node_id, {"sent": 0, "delivered": 0, "replied_enrollments": set()})
        for bucket in (overall, step):
            bucket["sent"] += 1
            if status in _SMS_DELIVERED_STATUSES:
                bucket["delivered"] += 1
            if enrollment_id and enrollment_id in replied_enrollment_ids:
                bucket["replied_enrollments"].add(enrollment_id)

    def _rates(bucket):
        sent = bucket["sent"]
        delivered = bucket["delivered"]
        replied = len(bucket["replied_enrollments"])
        return {
            "sent": sent, "delivered": delivered, "replied": replied,
            "delivery_rate": round(delivered / sent, 3) if sent else 0.0,
            "reply_rate": round(replied / sent, 3) if sent else 0.0,
        }

    return {
        "overall": _rates(overall),
        "by_step": {node_id: _rates(bucket) for node_id, bucket in by_step.items()},
    }


def _outbound_thread_ids(db, journey_id: str) -> set:
    """This journey's own outbound-send thread ids — the outbound activity's
    own nylas_thread_id already captures the same thread Nylas groups a
    reply into, so this doubles as the join key for finding replies without
    a separate email_threads join."""
    return {
        r[0] for r in models.exclude_test_leads(
            db.query(models.LeadEmailActivity.nylas_thread_id).filter(
                models.LeadEmailActivity.journey_id == journey_id,
                models.LeadEmailActivity.direction == "outbound",
                models.LeadEmailActivity.nylas_thread_id.isnot(None),
            ),
            models.LeadEmailActivity,
        ).all()
    }


def _reply_rate_thread_ids(db, journey_id: str) -> set:
    """Of this journey's outbound thread ids, the ones with at least one
    inbound, non-auto-reply row on them — the reply-rate signal (excludes
    auto-reply-only threads; see get_journey_activity for the version that
    doesn't exclude them, for visibility rather than a rate)."""
    thread_ids = _outbound_thread_ids(db, journey_id)
    if not thread_ids:
        return set()
    replied = db.query(models.LeadEmailActivity.nylas_thread_id).filter(
        models.LeadEmailActivity.nylas_thread_id.in_(thread_ids),
        models.LeadEmailActivity.direction == "inbound",
        models.LeadEmailActivity.is_auto_reply.isnot(True),
    ).distinct().all()
    return {r[0] for r in replied}


def _engagement_rates(sent: int, opened: int, clicked: int, replied: int) -> dict:
    def _rate(n):
        return round(n / sent, 3) if sent else 0.0
    return {
        "sent": sent, "opened": opened, "clicked": clicked, "replied": replied,
        "open_rate": _rate(opened), "click_rate": _rate(clicked), "reply_rate": _rate(replied),
    }


def _journey_instantly_engagement_stats(db, journey_id: str) -> dict:
    """v13.3.0 — engagement for this journey's `instantly_sequence` node(s).
    Separate from the email-channel query above because Instantly rows carry
    no journey_id/journey_node_id (scheduled_jobs.py's _record_instantly_
    engagement only has a lead + campaign_id to work from, confirmed when
    building the sender side) — joined instead through
    JourneyInstantlyCampaign, which IS scoped to (journey_id, node_id) by
    construction. A campaign is never shared across journeys or nodes (a
    content change mints a new campaign row rather than reusing one), so
    filtering LeadEmailActivity by instantly_campaign_id already scopes
    correctly with no further lead/enrollment join needed.

    "sent" has no dedicated LeadEmailActivity row (that table only logs a
    signal that advanced — opened/clicked/replied — not the initial send),
    so it's taken from JourneyInstantlyEnrollment's row count per node
    instead: one is written exactly when add_lead_to_campaign succeeds.
    """
    campaigns = db.query(
        models.JourneyInstantlyCampaign.node_id, models.JourneyInstantlyCampaign.instantly_campaign_id,
    ).filter(models.JourneyInstantlyCampaign.journey_id == journey_id).all()
    if not campaigns:
        return {}

    campaign_ids_by_node = {}
    all_campaign_ids = []
    for node_id, campaign_id in campaigns:
        campaign_ids_by_node.setdefault(node_id, []).append(campaign_id)
        all_campaign_ids.append(campaign_id)

    sent_counts = dict(
        db.query(models.JourneyInstantlyEnrollment.node_id, func.count(models.JourneyInstantlyEnrollment.id))
        .filter(models.JourneyInstantlyEnrollment.instantly_campaign_id.in_(all_campaign_ids))
        .group_by(models.JourneyInstantlyEnrollment.node_id)
        .all()
    )

    rows = models.exclude_test_leads(
        db.query(
            models.LeadEmailActivity.instantly_campaign_id,
            models.LeadEmailActivity.direction,
            models.LeadEmailActivity.opened_at,
            models.LeadEmailActivity.clicked_at,
        ).filter(models.LeadEmailActivity.instantly_campaign_id.in_(all_campaign_ids)),
        models.LeadEmailActivity,
    ).all()
    counts_by_campaign = {cid: {"opened": 0, "clicked": 0, "replied": 0} for cid in all_campaign_ids}
    for campaign_id, direction, opened_at, clicked_at in rows:
        bucket = counts_by_campaign[campaign_id]
        if opened_at:
            bucket["opened"] += 1
        if clicked_at:
            bucket["clicked"] += 1
        if direction == "inbound":
            bucket["replied"] += 1

    by_step = {}
    for node_id, campaign_ids in campaign_ids_by_node.items():
        opened = sum(counts_by_campaign[c]["opened"] for c in campaign_ids)
        clicked = sum(counts_by_campaign[c]["clicked"] for c in campaign_ids)
        replied = sum(counts_by_campaign[c]["replied"] for c in campaign_ids)
        by_step[node_id] = _engagement_rates(
            sent=sent_counts.get(node_id, 0), opened=opened, clicked=clicked, replied=replied,
        )
    return by_step


def _journey_engagement_stats(db, journey_id: str) -> dict:
    """v10.9.9 — cadence email engagement (opens/clicks/replies), overall,
    per email step, and per A/B variant within a step. Nothing here existed
    before: cadence emails sent via email_channel.py had no visibility
    beyond enrollment/queue status."""
    rows = models.exclude_test_leads(
        db.query(
            models.LeadEmailActivity.journey_node_id,
            models.LeadEmailActivity.variant_key,
            models.LeadEmailActivity.opened_at,
            models.LeadEmailActivity.clicked_at,
            models.LeadEmailActivity.nylas_thread_id,
        ).filter(
            models.LeadEmailActivity.journey_id == journey_id,
            models.LeadEmailActivity.direction == "outbound",
        ),
        models.LeadEmailActivity,
    ).all()

    replied_thread_ids = _reply_rate_thread_ids(db, journey_id)

    overall = {"sent": 0, "opened": 0, "clicked": 0, "replied": 0}
    by_step = {}
    variant_counts = {}   # node_id -> {variant_key -> counts}
    for node_id, variant_key, opened_at, clicked_at, thread_id in rows:
        step = by_step.setdefault(node_id, {"sent": 0, "opened": 0, "clicked": 0, "replied": 0})
        buckets = [overall, step]
        if variant_key is not None:
            variant_bucket = variant_counts.setdefault(node_id, {}).setdefault(
                variant_key, {"sent": 0, "opened": 0, "clicked": 0, "replied": 0})
            buckets.append(variant_bucket)
        for bucket in buckets:
            bucket["sent"] += 1
            if opened_at:
                bucket["opened"] += 1
            if clicked_at:
                bucket["clicked"] += 1
            if thread_id and thread_id in replied_thread_ids:
                bucket["replied"] += 1

    instantly_by_step = _journey_instantly_engagement_stats(db, journey_id)
    for node_id, rates in instantly_by_step.items():
        for key in ("sent", "opened", "clicked", "replied"):
            overall[key] += rates[key]

    merged_by_step = {
        node_id: {
            **_engagement_rates(**counts),
            **({"by_variant": {
                vkey: _engagement_rates(**vcounts) for vkey, vcounts in variant_counts[node_id].items()
            }} if node_id in variant_counts else {}),
        }
        for node_id, counts in by_step.items()
    }
    merged_by_step.update(instantly_by_step)
    return {"overall": _engagement_rates(**overall), "by_step": merged_by_step}


@router.post("/{journey_id}/archive")
def archive_journey(journey_id: str, body: dict, db: Session = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    """Gap 7 — archiving a journey with active enrollments force-exits them
    rather than leaving them orphaned. Requires the caller to echo back the
    current active-enrollment count (confirm_exit_count) — the same
    count-confirmation pattern as bulk enroll — so an "Archive" click can't
    silently strand leads the caller didn't realize were still in flight."""
    journey = _get_journey_or_404(db, journey_id)
    _require_journey_owner(journey, user, "archive")

    active_enrollments = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id,
        models.JourneyEnrollment.status == "active",
    ).all()

    confirm_exit_count = body.get("confirm_exit_count")
    if confirm_exit_count != len(active_enrollments):
        raise HTTPException(
            status_code=409,
            detail=f"This journey currently has {len(active_enrollments)} active enrollment(s) — "
                   f"refresh and confirm again (someone may have enrolled more since you opened this).",
        )

    now = datetime.now(timezone.utc)
    enrollment_ids = []
    for enrollment in active_enrollments:
        # Shared exit path: also closes parked approval/manual tasks and stops
        # an Instantly handoff — setting the status by hand skipped both.
        _exit_enrollment_early(db, enrollment, "journey_archived")
        enrollment_ids.append(enrollment.id)

    if enrollment_ids:
        db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id.in_(enrollment_ids),
            models.JourneyExecutionQueue.status.in_(["pending", "claimed"]),
        ).update({"status": "failed"}, synchronize_session=False)

    journey.status = "archived"
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_ARCHIVED",
                 object_type="journey", object_id=journey.id,
                 metadata={"journey_name": journey.name, "enrollments_exited": len(enrollment_ids)})

    return {"id": journey.id, "status": "archived", "enrollments_exited": len(enrollment_ids)}


@router.get("/{journey_id}/enrollments/{lead_id}")
def get_enrollment_status(journey_id: str, lead_id: str, db: Session = Depends(get_db),
                           user: dict = Depends(get_current_user)):
    load_lead(db, user, lead_id)
    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id,
        models.JourneyEnrollment.lead_id == lead_id,
    ).order_by(models.JourneyEnrollment.enrolled_at.desc()).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="No enrollment found for this lead in this journey")

    version = db.query(models.JourneyVersion).filter(models.JourneyVersion.id == enrollment.version_id).first()
    graph = version.graph_definition if version else {}

    history = db.query(models.ExecutionLog).filter(
        models.ExecutionLog.enrollment_id == enrollment.id,
    ).order_by(models.ExecutionLog.created_at.asc()).all()

    result = {
        "enrollment_id": enrollment.id, "lead_id": lead_id, "journey_id": journey_id,
        "status": enrollment.status, "current_node_id": enrollment.current_node_id,
        "current_node_label": _resolve_node_label(graph, enrollment.current_node_id),
        "enrolled_at": enrollment.enrolled_at.isoformat() if enrollment.enrolled_at else None,
        "history": [
            {
                "node_id": h.node_id, "event_type": h.event_type, "status": h.status,
                "channel": h.channel, "created_at": h.created_at.isoformat(),
            }
            for h in history
        ],
    }
    if enrollment.status == "active":
        result["pending_status"] = _pending_reason(db, enrollment)
    return result


@router.get("/by-lead/{lead_id}")
def get_lead_journey_enrollments(lead_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """All of a lead's journey enrollments (active + historical), each with
    its journey's name — powers the Lead Detail page's Journey Status card.
    Unlike GET /{journey_id}/enrollments/{lead_id}, this doesn't require the
    caller to already know which journey — the lead detail page only has a
    lead_id and needs to discover what it's enrolled in, if anything."""
    load_lead(db, user, lead_id)
    enrollments = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.lead_id == lead_id
    ).order_by(models.JourneyEnrollment.enrolled_at.desc()).all()

    result = []
    for e in enrollments:
        journey = db.query(models.Journey).filter(models.Journey.id == e.journey_id).first()
        version = db.query(models.JourneyVersion).filter(models.JourneyVersion.id == e.version_id).first()
        graph = version.graph_definition if version else {}
        entry = {
            "enrollment_id": e.id,
            "journey_id": e.journey_id,
            "journey_name": journey.name if journey else "Unknown journey",
            "status": e.status,
            "current_node_id": e.current_node_id,
            "current_node_label": _resolve_node_label(graph, e.current_node_id),
            "enrolled_at": e.enrolled_at.isoformat() if e.enrolled_at else None,
            "exited_reason": e.exited_reason,
            # RCA 2026-08-25: this card only ever showed the generic reason
            # code ("Send failed") — the real cause (e.g. a WhatsApp template
            # param mismatch) was already captured in last_error but never
            # returned here, unlike the admin FailedEnrollmentsPanel endpoint.
            "last_error": e.last_error,
        }
        if e.status == "active":
            entry["pending_status"] = _pending_reason(db, e)
        result.append(entry)
    return result


@router.post("/{journey_id}/pause")
def pause_journey(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Gap 5. Freezes every one of this journey's enrollments in place — the
    poller's claim query (journey_engine.engine._claim_due_rows) joins
    through to Journey and excludes 'paused' rows, so next_run_at simply
    stops advancing rather than being lost."""
    journey = _get_journey_or_404(db, journey_id)
    _require_journey_owner(journey, user, "pause")
    if journey.status != "active":
        raise HTTPException(status_code=409, detail=f"Only an active journey can be paused (current status: {journey.status})")

    journey.status = "paused"
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_PAUSED",
                 object_type="journey", object_id=journey.id, metadata={"journey_name": journey.name})
    return {"id": journey.id, "status": journey.status}


@router.post("/{journey_id}/resume")
def resume_journey(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Gap 5. Resuming does NOT fire every now-overdue step at once — no
    extra rate-limiting needed to achieve that: the poller's own per-tick
    claim batch (CLAIM_BATCH_SIZE=50, ticked every 30s — see
    journey_engine.engine) already paces execution regardless of how many
    rows are simultaneously due, the same as it does for any other backlog.
    Flipping status back to 'active' is the only step required — the
    existing claim mechanics handle the rest."""
    journey = _get_journey_or_404(db, journey_id)
    _require_journey_owner(journey, user, "resume")
    if journey.status != "paused":
        raise HTTPException(status_code=409, detail=f"Only a paused journey can be resumed (current status: {journey.status})")

    journey.status = "active"
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_RESUMED",
                 object_type="journey", object_id=journey.id, metadata={"journey_name": journey.name})
    return {"id": journey.id, "status": journey.status}


@router.get("/{journey_id}/failed-enrollments")
def get_failed_enrollments(journey_id: str, db: Session = Depends(get_db),
                            user: dict = Depends(get_current_user)):
    """Phase 4 dead-letter view — every enrollment that hit a terminal
    failure/suppression state, with enough context (exited_reason,
    last_error, current_node_id) for an admin to decide retry vs skip."""
    journey = _get_journey_or_404(db, journey_id)

    rows = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id,
        models.JourneyEnrollment.status.in_(["failed", "exited_early"]),
    ).order_by(models.JourneyEnrollment.completed_at.desc()).all()
    allowed = visible_lead_ids(db, Actor.from_claims(user), [e.lead_id for e in rows])

    result = []
    for e in rows:
        if e.lead_id not in allowed:
            continue
        lead = db.query(models.Lead).filter(models.Lead.id == e.lead_id).first()
        result.append({
            "enrollment_id": e.id,
            "lead_id": e.lead_id,
            "lead_name": f"{lead.first_name or ''} {lead.last_name}".strip() if lead else "Unknown lead",
            "status": e.status,
            "current_node_id": e.current_node_id,
            "exited_reason": e.exited_reason,
            "last_error": e.last_error,
            "completed_at": e.completed_at.isoformat() if e.completed_at else None,
        })
    return result


ACTIVITY_PAGE_LIMIT = 100


@router.get("/{journey_id}/activity")
def get_journey_activity(journey_id: str, db: Session = Depends(get_db),
                          user: dict = Depends(get_current_user)):
    """v10.9.9 — a unified, chronological feed of every outbound send and
    inbound reply this cadence has produced, across email and SMS — the
    single-channel views (EngagementPanel's rates, SmsLog, LeadEmailActivity)
    all existed in isolation; nothing merged them into one timeline. Capped
    at ACTIVITY_PAGE_LIMIT most-recent events — this is a monitoring feed,
    not an export.

    Deliberately excludes Call nodes' Task reminders: Task has no journey
    linkage today and already has its own dedicated list elsewhere in the
    app — adding that would be a second, larger change, not a natural
    extension of this one.
    """
    _get_journey_or_404(db, journey_id)

    def _lead_name(lead_id):
        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        return f"{lead.first_name or ''} {lead.last_name}".strip() if lead else "Unknown lead"

    events = []

    for a in models.exclude_test_leads(db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.journey_id == journey_id,
        models.LeadEmailActivity.direction == "outbound",
    ), models.LeadEmailActivity).order_by(models.LeadEmailActivity.timestamp.desc()).limit(ACTIVITY_PAGE_LIMIT).all():
        events.append({
            "type": "email_sent", "at": a.timestamp.isoformat() if a.timestamp else None,
            "lead_id": a.lead_id, "lead_name": _lead_name(a.lead_id),
            "subject": a.subject, "opened": bool(a.opened_at), "clicked": bool(a.clicked_at),
            "variant_key": a.variant_key,
        })

    # Unlike _reply_rate_thread_ids (which deliberately excludes
    # auto-reply-only threads from the reply *rate*), the activity feed
    # shows every inbound message on these threads, auto-replies included,
    # since it's a visibility feed, not a metric.
    outbound_thread_ids = _outbound_thread_ids(db, journey_id)
    if outbound_thread_ids:
        for a in db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_thread_id.in_(outbound_thread_ids),
            models.LeadEmailActivity.direction == "inbound",
        ).order_by(models.LeadEmailActivity.timestamp.desc()).limit(ACTIVITY_PAGE_LIMIT).all():
            events.append({
                "type": "email_auto_reply" if a.is_auto_reply else "email_reply",
                "at": a.timestamp.isoformat() if a.timestamp else None,
                "lead_id": a.lead_id, "lead_name": _lead_name(a.lead_id),
                "subject": a.subject,
            })

    for s in models.exclude_test_leads(db.query(models.SmsLog).filter(
        models.SmsLog.journey_id == journey_id,
        models.SmsLog.direction == "outbound",
    ), models.SmsLog).order_by(models.SmsLog.sent_at.desc()).limit(ACTIVITY_PAGE_LIMIT).all():
        # channel-tagged type ("sms_sent" | "whatsapp_sent") so a WhatsApp
        # cadence send doesn't read as a plain SMS in the feed.
        events.append({
            "type": f"{s.channel or 'sms'}_sent", "at": s.sent_at.isoformat() if s.sent_at else None,
            "lead_id": s.lead_id, "lead_name": _lead_name(s.lead_id),
            "message": s.message_text, "status": s.status,
        })

    journey_lead_ids = {
        r[0] for r in models.exclude_test_leads(db.query(models.JourneyEnrollment.lead_id).filter(
            models.JourneyEnrollment.journey_id == journey_id
        ), models.JourneyEnrollment).all()
    }
    if journey_lead_ids:
        for s in db.query(models.SmsLog).filter(
            models.SmsLog.lead_id.in_(journey_lead_ids),
            models.SmsLog.direction == "inbound",
        ).order_by(models.SmsLog.sent_at.desc()).limit(ACTIVITY_PAGE_LIMIT).all():
            events.append({
                "type": f"{s.channel or 'sms'}_reply", "at": s.sent_at.isoformat() if s.sent_at else None,
                "lead_id": s.lead_id, "lead_name": _lead_name(s.lead_id),
                "message": s.message_text,
            })

    # RCA 2026-09-29: this feed carries SMS text and email subjects — only
    # for leads the caller may see (cadences themselves stay org-readable).
    allowed = visible_lead_ids(db, Actor.from_claims(user), [e["lead_id"] for e in events])
    events = [e for e in events if e["lead_id"] in allowed]
    events.sort(key=lambda e: e["at"] or "", reverse=True)
    return events[:ACTIVITY_PAGE_LIMIT]


@router.post("/enrollments/{enrollment_id}/retry")
def retry_enrollment(enrollment_id: str, db: Session = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    """Re-activates a failed/exited enrollment at its current node, due
    immediately — the admin's manual counterpart to the automatic retry
    backoff (which only applies to retryable send failures, not a
    terminal/dead-lettered enrollment)."""
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    _require_journey_owner(_get_journey_or_404(db, enrollment.journey_id), user, "retry an enrollment in")
    if enrollment.status not in ("failed", "exited_early"):
        raise HTTPException(status_code=409, detail=f"Only a failed/exited enrollment can be retried (current status: {enrollment.status})")

    enrollment.status = "active"
    enrollment.exited_reason = None
    enrollment.last_error = None
    enrollment.completed_at = None
    db.add(models.JourneyExecutionQueue(
        enrollment_id=enrollment.id,
        node_id=enrollment.current_node_id,
        next_run_at=datetime.now(timezone.utc),
        status="pending",
        idempotency_key=f"{enrollment.id}:{enrollment.current_node_id}:{enrollment.node_pass}:retry:{datetime.now(timezone.utc).timestamp()}",
    ))
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_ENROLLMENT_RETRIED",
                 object_type="journey_enrollment", object_id=enrollment.id,
                 metadata={"journey_id": enrollment.journey_id, "enrollment_id": enrollment.id})
    return {"enrollment_id": enrollment.id, "status": enrollment.status}


@router.post("/enrollments/{enrollment_id}/force-next-step")
def force_next_step_route(enrollment_id: str, db: Session = Depends(get_db),
                           user: dict = Depends(require_pod_admin_or_above)):
    """Cadence/Messaging Sandbox: advance one active enrollment's next
    pending step right now instead of waiting out its real delay. Intended
    for the Playground's "Cadence Test" tab (test leads only, in practice —
    nothing here restricts it to is_test enrollments, the same way retry/
    skip above aren't restricted either; the actual send-safety guarantee
    lives in the whatsapp/sms channel providers, not here)."""
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    _require_journey_owner(_get_journey_or_404(db, enrollment.journey_id), user, "advance an enrollment in")

    try:
        queue_row_id = force_next_step(db, enrollment_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_ENROLLMENT_FORCED",
                 object_type="journey_enrollment", object_id=enrollment_id,
                 metadata={"enrollment_id": enrollment_id, "queue_row_id": queue_row_id})
    return {"enrollment_id": enrollment_id, "queue_row_id": queue_row_id}


@router.post("/enrollments/{enrollment_id}/skip")
def skip_enrollment(enrollment_id: str, db: Session = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    """Permanently dismisses a failed/exited enrollment — the admin has
    decided not to retry it. Purely a bookkeeping change (exited_reason),
    no further engine action; the enrollment was already terminal."""
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    _require_journey_owner(_get_journey_or_404(db, enrollment.journey_id), user, "skip an enrollment in")
    if enrollment.status not in ("failed", "exited_early"):
        raise HTTPException(status_code=409, detail=f"Only a failed/exited enrollment can be skipped (current status: {enrollment.status})")

    enrollment.exited_reason = "manually_skipped"
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_ENROLLMENT_SKIPPED",
                 object_type="journey_enrollment", object_id=enrollment.id,
                 metadata={"journey_id": enrollment.journey_id, "enrollment_id": enrollment.id})
    return {"enrollment_id": enrollment.id, "status": enrollment.status, "exited_reason": enrollment.exited_reason}


@router.post("/enrollments/{enrollment_id}/remove")
# Feedback gap #13: pull ONE lead out of a currently-active enrollment.
# Before this, the only ways to stop an active enrollment were archiving the
# whole journey (exits every lead in it) or waiting for it to fail/complete.
# Same permission split as enroll(): owner-or-Super-Admin for an
# owner-send cadence, otherwise anyone who can edit the lead — a rep should
# be able to pull their own lead back out the same way they can enroll it.
def remove_enrollment(enrollment_id: str, db: Session = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    journey = _get_journey_or_404(db, enrollment.journey_id)
    if journey.send_as != "assigned_rep":
        _require_journey_owner(journey, user, "remove a lead from")
    load_lead(db, user, enrollment.lead_id, edit=True)

    if enrollment.status != "active":
        raise HTTPException(status_code=409, detail=f"Only an active enrollment can be removed (current status: {enrollment.status})")

    _exit_enrollment_early(db, enrollment, "manually_removed")
    db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id,
        models.JourneyExecutionQueue.status.in_(["pending", "claimed"]),
    ).update({"status": "failed"}, synchronize_session=False)
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_ENROLLMENT_REMOVED",
                 object_type="journey_enrollment", object_id=enrollment.id,
                 metadata={"journey_id": enrollment.journey_id, "enrollment_id": enrollment.id})
    return {"enrollment_id": enrollment.id, "status": enrollment.status, "exited_reason": enrollment.exited_reason}


@router.delete("/gdpr/purge-lead/{lead_id}")
def purge_lead_journey_data(lead_id: str, db: Session = Depends(get_db),
                             user: dict = Depends(require_super_admin)):
    """GDPR right-to-erasure: permanently deletes this lead's cadence
    execution history (Gap 8 — see models.py's ExecutionLog docstring and
    its ix_execution_logs_lead index, built for exactly this query).

    JourneyEnrollment rows already cascade-delete automatically if the lead
    row itself is ever hard-deleted (FK ondelete="CASCADE"). ExecutionLog
    has no FK on lead_id by design (insert-volume tradeoff at billions-of-
    rows scale — see its docstring), so those rows never cascade and are
    the actual gap this closes: callable independently of lead deletion,
    since today's lead deletion is soft-delete only (Lead.deleted_at) and a
    real erasure request can still need cadence history purged on its own.
    """
    deleted = db.query(models.ExecutionLog).filter(models.ExecutionLog.lead_id == lead_id).delete(synchronize_session=False)
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="GDPR_LEAD_JOURNEY_DATA_PURGED",
                 object_type="lead", object_id=lead_id,
                 metadata={"lead_id": lead_id, "execution_logs_deleted": deleted})
    return {"lead_id": lead_id, "execution_logs_deleted": deleted}
