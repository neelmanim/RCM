"""v13.1.0 — manual-email cadence step (Viren's request): an email step
marked send_mode="manual" pauses for the lead's rep to review, optionally
edit, and approve before anything sends — mirroring the existing Task
step's two-pass park/resume shape (see test_cadence_playbook.py), but with
the actual send deferred to approval instead of happening automatically.

Covers: drafting/parking, eligibility re-checked at BOTH park and send time
(the gap between them can be hours/days), edits flowing through to the real
send, never auto-sending on a missed deadline, and the task_routes.py API
dispatch routing an email_approval task to the right engine function.
"""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

import models
from crypto import encrypt_token
from journey_engine import engine as je

from conftest import create_test_lead, create_test_user, create_nylas_config, create_user_mailbox
from test_cadence_playbook import _journey, _edges, _run, _rep_lead, TRIGGER, WAIT


def _manual_email_journey(db, **data_overrides):
    email = {"id": "m", "type": "email", "data": {
        "subject": "Hi {{first_name}}", "body": "Following up, {{first_name}}.",
        "send_mode": "manual", **data_overrides,
    }}
    return _journey(db, [TRIGGER, email, WAIT], _edges(("t", "m"), ("m", "w")))


def _capture_send():
    sent = {}

    def fake(db, mailbox, subject, body, lead, **kw):
        sent.update(mailbox_id=mailbox.id, subject=subject, body=body)
        return SimpleNamespace(success=True, error=None, retryable=False, provider_ref="msg-1")
    return sent, patch("email_send.send_email", side_effect=fake)


def _setup(db, **lead_kwargs):
    _, rep, lead = _rep_lead(db, **lead_kwargs)
    create_nylas_config(db, api_key_encrypted=encrypt_token("k"))
    create_user_mailbox(db, user_id="owner-1")
    create_user_mailbox(db, user_id=rep.id, email_address="rep@test.com")
    return rep, lead


def test_manual_email_parks_and_creates_an_approval_task(db):
    rep, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_email_journey(db), lead)
    e = _run(db, e)

    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()
    assert task.kind == "email_approval"
    assert task.user_id == rep.id
    assert task.draft_subject == "Hi Paul"
    assert task.draft_body == "Following up, Paul."
    assert task.done == "false"
    # Parked, not advanced — the cadence waits for the rep.
    assert e.status == "active" and e.current_node_id == "m"


def _aware(d):
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def test_the_approval_is_due_at_the_steps_deadline_not_overdue_on_arrival(db):
    """v13.7.0: the task used to be due "now", so My Tasks showed it Overdue a
    minute after it appeared. It's due when the cadence stops waiting."""
    _, lead = _setup(db)
    e = je.enroll_lead(db, _manual_email_journey(db, due_within_hours=6), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()
    hours = (_aware(task.due_time) - datetime.now(timezone.utc)).total_seconds() / 3600
    assert 5.9 < hours <= 6


def test_a_hard_stop_approval_has_no_due_time(db):
    _, lead = _setup(db)
    e = je.enroll_lead(db, _manual_email_journey(db, hard_stop=True), lead)
    _run(db, e)
    assert db.query(models.Task).filter(models.Task.journey_node_id == "m").one().due_time is None


def test_ineligible_lead_never_gets_a_draft(db):
    _, lead = _setup(db)
    lead.do_not_contact = True
    db.commit()
    e = je.enroll_lead(db, _manual_email_journey(db), lead)
    e = _run(db, e)
    assert db.query(models.Task).filter(models.Task.journey_node_id == "m").count() == 0
    assert e.status == "exited_early"


def test_approving_sends_the_draft_unchanged_and_advances(db):
    _, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_email_journey(db), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()

    sent, p = _capture_send()
    with p:
        assert je.complete_manual_email_step(db, task) is True
    db.expire_all()
    assert sent["subject"] == "Hi Paul"
    assert sent["body"] == "Following up, Paul."
    assert db.query(models.JourneyEnrollment).get(e.id).current_node_id == "w"


def test_approving_with_edits_sends_the_edited_content(db):
    _, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_email_journey(db), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()

    sent, p = _capture_send()
    with p:
        je.complete_manual_email_step(db, task, subject="Edited subject", body="Edited body, rewritten by the rep.")
    assert sent["subject"] == "Edited subject"
    assert sent["body"] == "Edited body, rewritten by the rep."


def test_eligibility_is_rechecked_at_approval_time_not_just_park_time(db):
    """The gap between a draft parking and a rep approving it can be hours or
    days — a lead who unsubscribed in between must not get the email anyway,
    even though they were eligible when the draft was created."""
    _, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_email_journey(db), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()

    lead.unsubscribed_at = datetime.now(timezone.utc)
    db.commit()

    sent, p = _capture_send()
    with p:
        je.complete_manual_email_step(db, task)
    db.expire_all()
    assert sent == {}  # send_email never called
    assert db.query(models.JourneyEnrollment).get(e.id).status == "exited_early"


def test_missed_deadline_skips_without_ever_sending(db):
    """The whole point of 'manual' is a human in the loop — a missed deadline
    must never silently auto-send; that would turn manual into automated."""
    _, lead = _setup(db)
    j = _manual_email_journey(db, branch_on_timeout="w")
    e = je.enroll_lead(db, j, lead)
    _run(db, e)   # creates the draft, parks

    sent, p = _capture_send()
    with p:
        e = _run(db, e)   # deadline reached, nobody approved it
    assert sent == {}  # send_email never called
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()
    assert (task.done, task.outcome) == ("true", "missed_deadline")
    assert e.current_node_id == "w"


def test_hard_stop_never_times_out(db):
    """Feedback #6/#7: hard_stop=True must not auto-advance past the rep —
    the deadline is pushed ~100 years out instead of the normal 24h."""
    _, lead = _setup(db)
    j = _manual_email_journey(db, hard_stop=True, branch_on_timeout="w")
    e = je.enroll_lead(db, j, lead)
    e = _run(db, e)

    row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == e.id).first()
    now = datetime.now(timezone.utc)
    next_run_at = row.next_run_at if row.next_run_at.tzinfo else row.next_run_at.replace(tzinfo=timezone.utc)
    assert next_run_at.year > now.year + 50
    assert e.status == "active" and e.current_node_id == "m"


def test_failed_send_fails_the_enrollment_not_a_silent_drop(db):
    _, lead = _setup(db)
    e = je.enroll_lead(db, _manual_email_journey(db), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()

    def failing_send(db, mailbox, subject, body, lead, **kw):
        return SimpleNamespace(success=False, error="Nylas 500", retryable=False, provider_ref=None)
    with patch("email_send.send_email", side_effect=failing_send):
        je.complete_manual_email_step(db, task)
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).status == "failed"


def test_publish_validation_covers_the_manual_email_step():
    from routes.journey_routes import _validate_graph_for_publish
    bad = {"id": "m", "type": "email", "data": {
        "subject": "Hi", "body": "Hello", "send_mode": "manual",
        "due_within_hours": -1, "branch_on_timeout": "nowhere"}}
    errors = " | ".join(_validate_graph_for_publish(
        {"nodes": [TRIGGER, bad, WAIT], "edges": _edges(("t", "m"), ("m", "w"))}))
    assert "deadline greater than 0 hours" in errors
    assert "deadline branch points at a node that no longer exists" in errors


def test_branch_on_timeout_target_counts_as_reachable():
    """A node reached ONLY via a manual email step's deadline branch (not the
    plain edge list) must not be falsely flagged unreachable — same treatment
    _branch_targets already gives task/condition steps."""
    from routes.journey_routes import _validate_graph_for_publish
    manual = {"id": "m", "type": "email", "data": {
        "subject": "Hi", "body": "Hello", "send_mode": "manual", "branch_on_timeout": "escalate"}}
    escalate = {"id": "escalate", "type": "wait", "data": {"duration_hours": 1}}
    errors = " | ".join(_validate_graph_for_publish(
        {"nodes": [TRIGGER, manual, escalate], "edges": _edges(("t", "m"))}))
    assert "unreachable" not in errors


def test_patch_task_api_routes_an_email_approval_task_to_the_right_handler(client, db):
    _, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_email_journey(db), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()

    sent, p = _capture_send()
    with p:
        resp = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True})
    assert resp.status_code == 200
    assert sent["subject"] == "Hi Paul"
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).current_node_id == "w"


def test_the_lead_card_says_it_waits_for_approval_not_its_scheduled_time(db):
    """v13.7.0: a cadence parked on the rep's email approval said "Waiting for
    its scheduled time" — _pending_reason only recognised task steps."""
    from routes.journey_routes import _pending_reason
    _, lead = _setup(db)
    e = _run(db, je.enroll_lead(db, _manual_email_journey(db), lead))
    assert _pending_reason(db, e)["reason"] == "awaiting_email_approval"


def test_a_reply_check_step_says_it_waits_for_a_reply(db):
    from routes.journey_routes import _pending_reason
    _, _, lead = _rep_lead(db)
    cond = {"id": "c", "type": "condition", "data": {"timeout_hours": 1, "branch_on_event": {"email_replied": "w"}}}
    e = je.enroll_lead(db, _journey(db, [TRIGGER, cond, WAIT], _edges(("t", "c"), ("c", "w"))), lead)
    assert e.current_node_id == "c"     # parked on the reply check (not run: that would time it out)
    assert _pending_reason(db, e)["reason"] == "awaiting_reply"
