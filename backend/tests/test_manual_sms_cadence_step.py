"""Feedback item #15 (keep SMS manual for initial rollout): an SMS step
marked send_mode="manual" pauses for the lead's rep to review, optionally
edit, and approve before anything sends — mirrors
test_manual_email_cadence_step.py's coverage for the email equivalent, since
_handle_manual_sms_node is a straight port of _handle_manual_email_node.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

import models
from journey_engine import engine as je

from conftest import create_test_lead
from test_cadence_playbook import _journey, _edges, _run, _rep_lead, TRIGGER, WAIT
from test_journey_engine import _setup_sms_infra


def _manual_sms_journey(db, **data_overrides):
    sms = {"id": "m", "type": "sms", "data": {
        "message": "Hi {{first_name}}, following up.", "send_mode": "manual", **data_overrides,
    }}
    return _journey(db, [TRIGGER, sms, WAIT], _edges(("t", "m"), ("m", "w")))


def _capture_send():
    """Returns (mock_provider, patcher) — after the patched call runs,
    mock_provider.send.call_args.kwargs holds what was actually sent."""
    fake_result = SimpleNamespace(success=True, error=None, retryable=False, message_id="sms-1", provider="messenger", conversation_id=None)
    provider = MagicMock()
    provider.send.return_value = fake_result

    def fake_resolve(db, user, channel):
        return SimpleNamespace(provider=provider, sender_id="918956778474", provider_name="messenger", error=None, retryable=True)

    return provider, patch("messaging_service.resolve_messaging_for_user", side_effect=fake_resolve)


def _setup(db, **lead_kwargs):
    _, rep, lead = _rep_lead(db, phone="+919876543210", **lead_kwargs)
    _setup_sms_infra(db)
    return rep, lead


def test_manual_sms_parks_and_creates_an_approval_task(db):
    rep, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_sms_journey(db), lead)
    e = _run(db, e)

    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()
    assert task.kind == "sms_approval"
    assert task.user_id == rep.id
    assert task.draft_body == "Hi Paul, following up."
    assert task.draft_body_format == "text"
    assert task.done == "false"
    assert e.status == "active" and e.current_node_id == "m"


def test_ineligible_lead_never_gets_a_draft(db):
    _, lead = _setup(db)
    lead.do_not_contact = True
    db.commit()
    e = je.enroll_lead(db, _manual_sms_journey(db), lead)
    e = _run(db, e)
    assert db.query(models.Task).filter(models.Task.journey_node_id == "m").count() == 0
    assert e.status == "exited_early"


def test_approving_sends_the_draft_and_advances(db):
    _, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_sms_journey(db), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()

    provider, patcher = _capture_send()
    with patcher:
        assert je.complete_manual_sms_step(db, task) is True
    db.expire_all()
    sent = provider.send.call_args.kwargs
    assert sent["phone"] == "+919876543210"
    assert sent["text"] == "Hi Paul, following up."
    assert db.query(models.JourneyEnrollment).get(e.id).current_node_id == "w"


def test_approving_with_edits_sends_the_edited_content(db):
    _, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_sms_journey(db), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()

    provider, patcher = _capture_send()
    with patcher:
        je.complete_manual_sms_step(db, task, message="Edited by the rep.")
    assert provider.send.call_args.kwargs["text"] == "Edited by the rep."


def test_eligibility_is_rechecked_at_approval_time(db):
    _, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_sms_journey(db), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()

    lead.unsubscribed_at = datetime.now(timezone.utc)
    db.commit()

    provider, patcher = _capture_send()
    with patcher:
        je.complete_manual_sms_step(db, task)
    db.expire_all()
    provider.send.assert_not_called()
    assert db.query(models.JourneyEnrollment).get(e.id).status == "exited_early"


def test_missed_deadline_skips_without_ever_sending(db):
    _, lead = _setup(db)
    j = _manual_sms_journey(db, branch_on_timeout="w")
    e = je.enroll_lead(db, j, lead)
    _run(db, e)

    provider, patcher = _capture_send()
    with patcher:
        e = _run(db, e)
    provider.send.assert_not_called()
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()
    assert (task.done, task.outcome) == ("true", "missed_deadline")
    assert e.current_node_id == "w"


def test_hard_stop_never_times_out(db):
    """Feedback #6/#7: hard_stop=True must not auto-advance even far past
    the ordinary 24h default — the deadline is pushed out ~100 years."""
    _, lead = _setup(db)
    j = _manual_sms_journey(db, hard_stop=True, branch_on_timeout="w")
    e = je.enroll_lead(db, j, lead)
    e = _run(db, e)

    row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == e.id).first()
    now = datetime.now(timezone.utc)
    next_run_at = row.next_run_at if row.next_run_at.tzinfo else row.next_run_at.replace(tzinfo=timezone.utc)
    assert next_run_at.year > now.year + 50
    assert next_run_at > now  # not due — the poller's _claim_due_rows would skip it
    assert e.status == "active" and e.current_node_id == "m"


def test_publish_validation_covers_the_manual_sms_step():
    from routes.journey_routes import _validate_graph_for_publish
    bad = {"id": "m", "type": "sms", "data": {
        "message": "hi", "send_mode": "manual", "due_within_hours": -1, "branch_on_timeout": "nowhere"}}
    errors = " | ".join(_validate_graph_for_publish(
        {"nodes": [TRIGGER, bad, WAIT], "edges": _edges(("t", "m"), ("m", "w"))}))
    assert "deadline greater than 0 hours" in errors
    assert "deadline branch points at a node that no longer exists" in errors


def test_manual_sms_branch_on_timeout_target_counts_as_reachable():
    """A node reached ONLY via a manual SMS step's deadline branch must not
    be falsely flagged unreachable — same treatment manual email already gets."""
    from routes.journey_routes import _validate_graph_for_publish
    manual = {"id": "m", "type": "sms", "data": {"message": "hi", "send_mode": "manual", "branch_on_timeout": "escalate"}}
    escalate = {"id": "escalate", "type": "wait", "data": {"duration_hours": 1}}
    errors = " | ".join(_validate_graph_for_publish(
        {"nodes": [TRIGGER, manual, escalate], "edges": _edges(("t", "m"))}))
    assert "unreachable" not in errors


def test_patch_task_api_routes_an_sms_approval_task_to_the_right_handler(client, db):
    _, lead = _setup(db, first_name="Paul")
    e = je.enroll_lead(db, _manual_sms_journey(db), lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()

    provider, patcher = _capture_send()
    with patcher:
        resp = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True})
    assert resp.status_code == 200
    assert provider.send.call_args.kwargs["text"] == "Hi Paul, following up."
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).current_node_id == "w"
