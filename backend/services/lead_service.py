# ── services/lead_service.py — Lead business logic (no HTTP concerns) ───────
"""
Business rules for editing a Lead, extracted out of routes/lead_routes.py so
they're readable and testable independent of FastAPI.

This is the first real module in services/ (previously just an empty
directory) — a worked example of the target "thin route -> service" layering
for this codebase's God Files (lead_routes.py is 1,490 lines and shows up in
the dependency graph as its own near-zero-cohesion community). Routes stay
responsible for auth/HTTP concerns (404s, 403s, request/response shaping);
services own the rules about what a valid edit actually is.
"""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_

import ownership_history as oh
import models
from models import log_status_change, PARKED_STATUSES
from routes.lead_helpers import _is_backward_move, _skips_stage, STAGE_SKIP_MSG

# Shared by both gate call sites (here and lead_routes' status-change route) so
# they can't drift. Says what actually blocks — the old "At least 1 call must be
# logged" read as a flat contradiction to the Calls tab sitting right next to it.
MEETING_NEEDS_CALL_MSG = (
    "Log an answered call or a manual call log for this lead before moving it to "
    "Meeting Scheduled — no connected call is recorded yet."
)

ALLOWED_UPDATE_FIELDS = {
    "first_name", "last_name", "email", "phone", "phone_secondary", "company_phone",
    "company", "title", "status", "do_not_contact", "talking_points", "vertical",
}


def _digits(phone) -> str:
    return "".join(c for c in str(phone or "") if c.isdigit())


def mark_phone_invalid(db, lead: "models.Lead", actor_name: str) -> bool:
    """The lead's phone doesn't reach them. Flags it (call and text cadence
    steps then skip — email carries on), leaves a note, and closes the open
    call-reminder tasks cadences already created for it. Idempotent; does not
    commit. Returns True only when this call newly marked it.

    Only tasks whose cadence node is a "call" step are closed: a manual "task"
    step (LinkedIn, research) is also a Task with an enrollment but has nothing
    to do with the phone."""
    if lead.phone_invalid_at:
        return False
    lead.phone_invalid_at = datetime.now(timezone.utc)
    db.add(models.Note(lead_id=lead.id, content=f"Phone marked wrong by {actor_name}", author=actor_name))

    from journey_engine.engine import _find_node  # local: the engine imports models, not this module
    rows = db.query(models.Task, models.JourneyVersion.graph_definition).join(
        models.JourneyEnrollment, models.JourneyEnrollment.id == models.Task.journey_enrollment_id
    ).join(
        models.JourneyVersion, models.JourneyVersion.id == models.JourneyEnrollment.version_id
    ).filter(
        models.Task.lead_id == lead.id,
        models.Task.kind.is_(None),
        models.Task.done != "true",
    ).all()
    for task, graph in rows:
        node = _find_node(graph or {}, task.journey_node_id)
        if node and node.get("type") == "call":
            task.done, task.outcome = "true", "wrong_number"
    return True


def logged_call_count(db, lead_id: str) -> int:
    """Calls logged for a lead — manual CallLog rows plus dialer calls that
    got an outcome attached directly to DialerCall. Counting CallLog alone
    undercounts any lead whose calls were all made via the in-app dialer.

    RCA 2026-08-20: dialer_service._auto_log_outcome DOES create a paired
    CallLog (dialer_call_id set) for every auto-tagged Aircall call, despite
    this docstring's original claim otherwise — exclude those or they're
    counted on both sides.

    RCA 2026-09-03: an *answered* dialer call now counts even with no outcome
    attached. Requiring an outcome made this gate disagree with the lead's own
    Calls tab — which counts every call — so an SDR who had demonstrably
    spoken to a lead was told "At least 1 call must be logged" while looking
    at the call that was logged. That is the reported prod symptom, and it was
    not rare: 1,305 of the 5,848 prod leads with calls (22%) had no
    outcome-bearing call at all, 304 of them despite a call the lead answered.
    A missing outcome is a real, separately-tracked data-quality gap (see the
    dialer self-heal work) — it is not evidence the call never happened, which
    is the only thing this gate exists to establish. Unanswered calls still
    don't count: those genuinely aren't a conversation."""
    manual = db.query(models.CallLog).filter(
        models.CallLog.lead_id == lead_id,
        models.CallLog.dialer_call_id.is_(None),
    ).count()
    dialer = db.query(models.DialerCall).filter(
        models.DialerCall.lead_id == lead_id,
        or_(
            models.DialerCall.outcome.isnot(None),
            models.DialerCall.answered_at.isnot(None),
        ),
    ).count()
    return manual + dialer


CORE_RESEARCH_FIELDS = {
    "research_company": "What does this company do?",
    "research_contact": "Contact Context",
    "research_hypothesis": "Pitch Angle / Hypothesis",
    "research_personalization": "Personalization Note",
}


def check_research_gate(db, lead: "models.Lead", new_status: str):
    """Admin-controlled toggle (v8 Research v2, default off): when on, blocks
    a move into Calling/Meeting Scheduled until 4 core research fields are
    filled in. Read per-request so an admin flip takes effect immediately.

    RCA 2026-09-28: this only existed inline in lead_routes.py's
    move_lead_kanban — update_lead_fields (the endpoint the React Lead
    Detail Hub's Change Stage actually calls) never checked it, so turning
    the gate on silently only blocked the legacy kanban-drag path; anyone
    on the React page could still skip straight to Calling/Meeting
    Scheduled with zero research. Pulled out here so both call sites share
    one gate that can't drift out of sync again.
    """
    try:
        _ss = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        require_research = bool(getattr(_ss, "require_research_before_calling", False)) if _ss else False
    except Exception:
        require_research = False

    if not require_research or new_status not in ("Calling", "Meeting Scheduled"):
        return
    missing = [f for f in CORE_RESEARCH_FIELDS if not getattr(lead, f, None)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Complete these required fields: {', '.join(CORE_RESEARCH_FIELDS[f] for f in missing)}"
        )


def update_lead_fields(db, lead: "models.Lead", updates: dict, user: dict) -> bool:
    """Apply an editable-field update to `lead`, enforcing status-transition
    rules and the "auto-revert from parked" side effect. Does not commit —
    the caller (route) owns the transaction/refresh/SF-push trigger.

    Returns True if the lead's status changed (so the caller knows whether
    to trigger a Salesforce push).
    """
    filtered = {k: v for k, v in updates.items() if k in ALLOWED_UPDATE_FIELDS}

    if "status" in filtered and filtered["status"] != lead.status:
        if filtered["status"] not in models.KNOWN_STATUSES:
            raise HTTPException(status_code=422, detail=f'"{filtered["status"]}" is not a lead status.')
        # SDRs cannot move leads backward via direct update.
        # Exception: "Pending Review" is always a forward move from Demo stages
        # and is treated as a parked holding state, not a backward regression.
        if (_is_backward_move(lead.status, filtered["status"])
                and filtered["status"] != "Pending Review"
                and user.get("role") not in ("Super Admin", "Admin", "Pod Admin")):
            raise HTTPException(
                status_code=403,
                detail="SDRs cannot move leads to a previous status. Contact your Pod Admin."
            )
        if (_skips_stage(lead.status, filtered["status"])
                and user.get("role") not in ("Super Admin", "Admin", "Pod Admin")):
            raise HTTPException(status_code=403, detail=STAGE_SKIP_MSG)
        # Validate: Meeting Scheduled requires at least 1 call
        if filtered["status"] == "Meeting Scheduled" and logged_call_count(db, lead.id) == 0:
            raise HTTPException(status_code=422, detail=MEETING_NEEDS_CALL_MSG)
        check_research_gate(db, lead, filtered["status"])
        old_status = lead.status
        lead.status_changed_at = datetime.now(timezone.utc)
        log_status_change(db, lead.id, old_status, filtered["status"], user.get("name") or user.get("email", "unknown"),
                          changed_by_user_id=user["sub"])

    status_changed = "status" in filtered and filtered["status"] != lead.status
    phone_changed = "phone" in filtered and _digits(filtered["phone"]) != _digits(lead.phone)
    for key, val in filtered.items():
        setattr(lead, key, val)

    # A different number deserves a fresh chance: the "wrong number" flag was
    # about the old one.
    if phone_changed:
        lead.phone_invalid_at = None

    # RCA 2026-08-24: do_not_contact/unsubscribed_at were already enforced
    # everywhere (dialer, journeys, power dialer) but nothing could ever set
    # them — this was the only missing piece. They move together: both mean
    # "stop contacting this lead" to every consumer today.
    if filtered.get("do_not_contact") and not lead.unsubscribed_at:
        lead.unsubscribed_at = datetime.now(timezone.utc)

    # v13.3.0: do_not_contact must also stop any live Instantly handoff —
    # Instantly keeps sending on its own schedule otherwise, since nothing
    # else tells it to stop. A lead can be enrolled in more than one journey
    # at once, so this exits every active one, not just the first match.
    # Compliance gap, not just UX, so it happens in this same request rather
    # than waiting for the 15-min poll. Local import: journey_engine is the
    # execution engine importing this services module would be backwards,
    # and this avoids baking in an assumption about which one loads first.
    if filtered.get("do_not_contact"):
        from journey_engine.engine import exit_active_enrollments
        exit_active_enrollments(db, lead.id, "do_not_contact")

    # Auto-revert: if a phone was just added to a parked lead, unpark it
    phone_fields_in_update = {"phone", "phone_secondary"} & filtered.keys()
    if phone_fields_in_update and lead.status in PARKED_STATUSES:
        phone_val = lead.phone or lead.phone_secondary or ""
        phone_digits = ''.join(c for c in str(phone_val) if c.isdigit())
        if len(phone_digits) >= 7:
            old_status = lead.status
            lead.status = "Lead Assigned"
            lead.status_changed_at = datetime.now(timezone.utc)
            log_status_change(db, lead.id, old_status, "Lead Assigned",
                              user.get("name") or user.get("email", "unknown"), changed_by_user_id=user["sub"])
            status_changed = True
            # If SDR added the phone, assign lead to them
            if user.get("role") == "SDR":
                sdr_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
                if sdr_user:
                    models.assign_lead(sdr_user, lead, reason=oh.R_PHONE_ADDED, actor_id=user["sub"])
            # Pod Admin / Admin / Super Admin → keep unassigned

    return status_changed
