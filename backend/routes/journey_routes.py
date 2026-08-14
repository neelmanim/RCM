# ── routes/journey_routes.py — Sales Journey API (Phase 0-3) ─────────────────
"""
Create/autosave/publish/archive a journey, enroll a lead (with the
Deliverable 5 rate cap), read status/stats. Full design + phasing:
docs/SALES_JOURNEY_ARCHITECTURE.md.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from auth import get_current_user, require_pod_admin_or_above
import models
from activity_logger import log_activity
from journey_engine.engine import enroll_lead, force_next_step
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


# Mirrors frontend-react/.../sales-journey/nodeDefaults.js NODE_LABELS — keep in sync.
_NODE_LABELS = {"trigger": "Trigger", "email": "Email", "wait": "Wait", "condition": "Condition", "call": "Call"}


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
    ).order_by(models.ExecutionLog.created_at.desc()).first()

    if last_log and last_log.event_type == "cooldown_blocked":
        return {"reason": "cooldown_blocked", "detail": "Blocked briefly — another cadence already contacted this lead recently.", "next_run_at": next_run_at}
    if last_log and last_log.event_type == "domain_cadence_blocked":
        return {"reason": "domain_cadence_blocked", "detail": "Blocked briefly by the sending domain's rate limit.", "next_run_at": next_run_at}
    if last_log and last_log.event_type == "send_attempted" and last_log.status == "failure":
        return {"reason": "retry_pending", "detail": "A previous send failed — will retry automatically.", "next_run_at": next_run_at}
    return {"reason": "waiting", "detail": "Waiting for its scheduled time.", "next_run_at": next_run_at}


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

    reachable = {e.get("target") for e in edges}
    for n in nodes:
        if n.get("type") == "condition":
            data = n.get("data") or {}
            if data.get("branch_on_timeout"):
                reachable.add(data["branch_on_timeout"])
            for target in (data.get("branch_on_event") or {}).values():
                if target:
                    reachable.add(target)
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
        elif node_type == "wait":
            if not data.get("duration_hours") or data["duration_hours"] <= 0:
                errors.append(f"{label} needs a duration greater than 0 hours.")
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
        elif node_type == "whatsapp":
            # A cadence's first touch is always outside any existing session
            # window, so a template is the only reliable send path — a plain
            # message is accepted too (used only if the window happens to
            # already be open) but isn't sufficient on its own.
            if not (data.get("template_name") or "").strip():
                errors.append(f"{label} needs a WhatsApp template selected.")
    return errors


def _send_window_fields(j) -> dict:
    return {
        "send_tz": j.send_tz,
        "send_window_start_hour": j.send_window_start_hour,
        "send_window_end_hour": j.send_window_end_hour,
        "send_days": j.send_days,
    }


def _validate_send_window_body(body: dict) -> dict:
    """Shared by create_journey and update_journey_settings. Only validates/
    returns keys actually present in body — callers apply what's given."""
    out = {}
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
    return out


@router.post("/ai/generate-email")
def ai_generate_email(body: dict, db: Session = Depends(get_db),
                       user: dict = Depends(require_pod_admin_or_above)):
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
def list_journeys(db: Session = Depends(get_db), user: dict = Depends(require_pod_admin_or_above)):
    """List journeys for the builder's landing list. Pod Admin+ only, same
    gate as authoring — matches Users & Permissions in the architecture doc."""
    journeys = db.query(models.Journey).order_by(models.Journey.created_at.desc()).all()
    return [
        {"id": j.id, "name": j.name, "status": j.status, "owner_id": j.owner_id, "pod_id": j.pod_id,
         "created_at": j.created_at.isoformat() if j.created_at else None, **_send_window_fields(j)}
        for j in journeys
    ]


@router.get("/{journey_id}")
def get_journey(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(require_pod_admin_or_above)):
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

    return {
        "id": journey.id, "name": journey.name, "status": journey.status, "pod_id": journey.pod_id,
        "live_version_id": journey.live_version_id,
        "version_id": version.id, "version_number": version.version_number,
        "version_status": version.status,
        "graph_definition": version.graph_definition,
        "updated_at": version.updated_at.isoformat() if version.updated_at else None,
        **_send_window_fields(journey),
    }


@router.patch("/{journey_id}")
def update_journey_settings(journey_id: str, body: dict, db: Session = Depends(get_db),
                             user: dict = Depends(require_pod_admin_or_above)):
    """Journey-level settings that aren't part of the graph_definition draft/publish
    flow — pod scoping and the send-time window. Takes effect immediately
    (no draft/publish step), same as pause/resume."""
    journey = _get_journey_or_404(db, journey_id)
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
    for key, value in _validate_send_window_body(body).items():
        setattr(journey, key, value)
    db.commit()
    return {"id": journey.id, "name": journey.name, "pod_id": journey.pod_id, **_send_window_fields(journey)}


@router.post("")
def create_journey(body: dict, db: Session = Depends(get_db), user: dict = Depends(require_pod_admin_or_above)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")

    pod_id = body.get("pod_id") or None
    if pod_id and not db.query(models.Pod).filter(models.Pod.id == pod_id).first():
        raise HTTPException(status_code=422, detail="Unknown pod_id")

    journey = models.Journey(name=name, owner_id=user.get("sub"), status="draft", pod_id=pod_id)
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


@router.put("/{journey_id}/versions/{version_id}")
def save_draft(journey_id: str, version_id: str, body: dict,
               db: Session = Depends(get_db), user: dict = Depends(require_pod_admin_or_above)):
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
def publish_journey(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(require_pod_admin_or_above)):
    journey = _get_journey_or_404(db, journey_id)

    draft = db.query(models.JourneyVersion).filter(
        models.JourneyVersion.journey_id == journey_id,
        models.JourneyVersion.status == "draft",
    ).order_by(models.JourneyVersion.version_number.desc()).first()
    if not draft:
        raise HTTPException(status_code=409, detail="No draft version to publish")

    graph = draft.graph_definition or {}
    errors = _validate_graph_for_publish(graph)
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


@router.post("/{journey_id}/enroll")
# Pod Admin+ (not get_current_user) while this ships as a Super-Admin-only
# soft launch — the nav entry and the LeadsHub bulk-enroll action are both
# hidden from everyone else, so this is the one write endpoint a stray direct
# API call could otherwise reach. Relax back to get_current_user once SDR
# self-enroll (docs/SALES_JOURNEY_ARCHITECTURE.md, Users & Permissions) is
# actually exposed in the UI.
def enroll(journey_id: str, body: dict, db: Session = Depends(get_db), user: dict = Depends(require_pod_admin_or_above)):
    journey = _get_journey_or_404(db, journey_id)

    lead_ids = body.get("lead_ids") or []
    if not lead_ids:
        raise HTTPException(status_code=422, detail="lead_ids is required")
    if len(lead_ids) > 200:
        raise HTTPException(status_code=400, detail="Use the filter-based bulk path for more than 200 leads")

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
        enrollment = enroll_lead(db, journey, lead)
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
    settings = _get_or_create_sync_settings(db)
    sandbox_phone = getattr(settings, "sandbox_test_phone_number", None) or ""
    if not sandbox_phone:
        raise HTTPException(status_code=422, detail="Set a Sandbox Test Phone Number in Settings first.")

    journey = _get_journey_or_404(db, journey_id)
    if not journey.live_version_id:
        raise HTTPException(status_code=409, detail="This journey has no published version to enroll into.")

    lead = models.Lead(
        first_name="Sandbox",
        last_name=(body.get("label") or "Test Lead").strip()[:100],
        phone=sandbox_phone,
        lead_source="manual",
        is_test=True,
    )
    db.add(lead)
    db.flush()

    enrollment = enroll_lead(db, journey, lead)
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
    lead_id ON DELETE CASCADE — belt-and-suspenders, since this codebase's
    test suite runs on SQLite without foreign_keys enforcement turned on and
    so can't itself prove the DB-level cascade fires. SmsLog/DialerCall/
    CallLog/Task rows are still left to the DB's own lead_id cascade."""
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


@router.get("/{journey_id}/stats")
def get_journey_stats(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    journey = _get_journey_or_404(db, journey_id)

    rows = models.exclude_test_leads(
        db.query(models.JourneyEnrollment.status, func.count(models.JourneyEnrollment.id)).filter(
            models.JourneyEnrollment.journey_id == journey_id
        ),
        models.JourneyEnrollment,
    ).group_by(models.JourneyEnrollment.status).all()
    counts = {status: count for status, count in rows}

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

    return {
        "journey_id": journey_id,
        "active": counts.get("active", 0),
        "completed": counts.get("completed", 0),
        "failed": counts.get("failed", 0),
        "exited_early": counts.get("exited_early", 0),
        "paused": counts.get("paused", 0),
        "total": sum(counts.values()),
        "queue_depth": queue_depth or 0,
        "oldest_overdue_seconds": oldest_overdue_seconds,
        "engagement": _journey_engagement_stats(db, journey_id),
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

    return {
        "overall": _engagement_rates(**overall),
        "by_step": {
            node_id: {
                **_engagement_rates(**counts),
                **({"by_variant": {
                    vkey: _engagement_rates(**vcounts) for vkey, vcounts in variant_counts[node_id].items()
                }} if node_id in variant_counts else {}),
            }
            for node_id, counts in by_step.items()
        },
    }


@router.post("/{journey_id}/archive")
def archive_journey(journey_id: str, body: dict, db: Session = Depends(get_db),
                     user: dict = Depends(require_pod_admin_or_above)):
    """Gap 7 — archiving a journey with active enrollments force-exits them
    rather than leaving them orphaned. Requires the caller to echo back the
    current active-enrollment count (confirm_exit_count) — the same
    count-confirmation pattern as bulk enroll — so an "Archive" click can't
    silently strand leads the caller didn't realize were still in flight."""
    journey = _get_journey_or_404(db, journey_id)

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
        enrollment.status = "exited_early"
        enrollment.exited_reason = "journey_archived"
        enrollment.completed_at = now
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
        }
        if e.status == "active":
            entry["pending_status"] = _pending_reason(db, e)
        result.append(entry)
    return result


@router.post("/{journey_id}/pause")
def pause_journey(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(require_pod_admin_or_above)):
    """Gap 5. Freezes every one of this journey's enrollments in place — the
    poller's claim query (journey_engine.engine._claim_due_rows) joins
    through to Journey and excludes 'paused' rows, so next_run_at simply
    stops advancing rather than being lost."""
    journey = _get_journey_or_404(db, journey_id)
    if journey.status != "active":
        raise HTTPException(status_code=409, detail=f"Only an active journey can be paused (current status: {journey.status})")

    journey.status = "paused"
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_PAUSED",
                 object_type="journey", object_id=journey.id, metadata={"journey_name": journey.name})
    return {"id": journey.id, "status": journey.status}


@router.post("/{journey_id}/resume")
def resume_journey(journey_id: str, db: Session = Depends(get_db), user: dict = Depends(require_pod_admin_or_above)):
    """Gap 5. Resuming does NOT fire every now-overdue step at once — no
    extra rate-limiting needed to achieve that: the poller's own per-tick
    claim batch (CLAIM_BATCH_SIZE=50, ticked every 30s — see
    journey_engine.engine) already paces execution regardless of how many
    rows are simultaneously due, the same as it does for any other backlog.
    Flipping status back to 'active' is the only step required — the
    existing claim mechanics handle the rest."""
    journey = _get_journey_or_404(db, journey_id)
    if journey.status != "paused":
        raise HTTPException(status_code=409, detail=f"Only a paused journey can be resumed (current status: {journey.status})")

    journey.status = "active"
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_RESUMED",
                 object_type="journey", object_id=journey.id, metadata={"journey_name": journey.name})
    return {"id": journey.id, "status": journey.status}


@router.get("/{journey_id}/failed-enrollments")
def get_failed_enrollments(journey_id: str, db: Session = Depends(get_db),
                            user: dict = Depends(require_pod_admin_or_above)):
    """Phase 4 dead-letter view — every enrollment that hit a terminal
    failure/suppression state, with enough context (exited_reason,
    last_error, current_node_id) for an admin to decide retry vs skip."""
    journey = _get_journey_or_404(db, journey_id)

    rows = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id,
        models.JourneyEnrollment.status.in_(["failed", "exited_early"]),
    ).order_by(models.JourneyEnrollment.completed_at.desc()).all()

    result = []
    for e in rows:
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
                          user: dict = Depends(require_pod_admin_or_above)):
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

    events.sort(key=lambda e: e["at"] or "", reverse=True)
    return events[:ACTIVITY_PAGE_LIMIT]


@router.post("/enrollments/{enrollment_id}/retry")
def retry_enrollment(enrollment_id: str, db: Session = Depends(get_db),
                      user: dict = Depends(require_pod_admin_or_above)):
    """Re-activates a failed/exited enrollment at its current node, due
    immediately — the admin's manual counterpart to the automatic retry
    backoff (which only applies to retryable send failures, not a
    terminal/dead-lettered enrollment)."""
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
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
                     user: dict = Depends(require_pod_admin_or_above)):
    """Permanently dismisses a failed/exited enrollment — the admin has
    decided not to retry it. Purely a bookkeeping change (exited_reason),
    no further engine action; the enrollment was already terminal."""
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    if enrollment.status not in ("failed", "exited_early"):
        raise HTTPException(status_code=409, detail=f"Only a failed/exited enrollment can be skipped (current status: {enrollment.status})")

    enrollment.exited_reason = "manually_skipped"
    db.commit()

    log_activity(user_id=user.get("sub"), action_type="JOURNEY_ENROLLMENT_SKIPPED",
                 object_type="journey_enrollment", object_id=enrollment.id,
                 metadata={"journey_id": enrollment.journey_id, "enrollment_id": enrollment.id})
    return {"enrollment_id": enrollment.id, "status": enrollment.status, "exited_reason": enrollment.exited_reason}
