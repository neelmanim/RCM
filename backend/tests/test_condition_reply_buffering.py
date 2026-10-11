"""v13.3.5 — a "replied?" condition must see a reply (or out-of-office) that
arrived while the lead was still on an EARLIER step.

Before: check_exit_triggers only acted on a lead parked ON the condition. In
the demo graph (email -> wait -> "replied?") a lead who replied during the
wait was ignored; the condition later timed out and the cadence sent the
"no reply" SMS to someone who had replied.

Every inbound email here goes through the real Nylas webhook route.
"""
import json
from datetime import datetime, timezone

import models
from journey_engine import engine as je

from conftest import create_test_lead, create_email_thread
from test_cadence_playbook import _journey, _edges, _run, TRIGGER

WAIT = {"id": "w", "type": "wait", "data": {"duration_hours": 1}}
REPLIED = {"id": "replied", "type": "task", "data": {"task_kind": "custom", "instructions": "Respond personally"}}
OOO = {"id": "ooo", "type": "task", "data": {"task_kind": "custom", "instructions": "They're away — try later"}}
NO_REPLY = {"id": "no_reply", "type": "task", "data": {"task_kind": "custom", "instructions": "Send the SMS"}}


def _demo_journey(db, with_ooo_branch=False):
    branch_on_event = {"email_replied": "replied"}
    if with_ooo_branch:
        branch_on_event["email_auto_replied"] = "ooo"
    cond = {"id": "c", "type": "condition", "data": {
        "timeout_hours": 48, "branch_on_event": branch_on_event, "branch_on_timeout": "no_reply"}}
    return _journey(db, [TRIGGER, WAIT, cond, REPLIED, OOO, NO_REPLY],
                    _edges(("t", "w"), ("w", "c"), ("c", "no_reply")))


def _inbound(client, lead, msg_id, subject):
    payload = {"data": {"type": "message.created", "object_data": {
        "id": msg_id, "thread_id": f"thread-{lead.id}", "from": [{"email": lead.email}],
        "to": [{"email": "rep@test.com"}], "subject": subject, "body": "..."}}}
    assert client.post("/webhooks/nylas", content=json.dumps(payload)).status_code == 200


def _enrolled_on_wait(db, journey):
    lead = create_test_lead(db, email="prospect@acme.com")
    create_email_thread(db, lead_id=lead.id, nylas_thread_id=f"thread-{lead.id}")
    e = je.enroll_lead(db, journey, lead)
    assert e.current_node_id == "w"
    # the cadence has emailed the lead (a reply only counts when it answers mail we sent)
    db.add(models.LeadEmailActivity(lead_id=lead.id, direction="outbound", subject="Quick question",
                                    nylas_thread_id=f"thread-{lead.id}", enrollment_id=e.id, journey_id=e.journey_id,
                                    timestamp=datetime.now(timezone.utc)))
    db.commit()
    return lead, e


def _finish_wait(db, e):
    """The wait elapses: the lead moves onto the condition."""
    e = _run(db, e)
    assert e.current_node_id == "c"
    return e


def _condition_due_now(db, e):
    row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == e.id,
        models.JourneyExecutionQueue.status == "pending").one()
    return row.next_run_at.replace(tzinfo=row.next_run_at.tzinfo or timezone.utc) <= datetime.now(timezone.utc)


def test_reply_during_the_wait_takes_the_replied_branch_immediately(client, db):
    lead, e = _enrolled_on_wait(db, _demo_journey(db))
    _inbound(client, lead, "m1", "Re: quick question")
    e = _finish_wait(db, e)
    assert _condition_due_now(db, e)          # doesn't sit out the 48h timeout
    assert _run(db, e).current_node_id == "replied"


def test_out_of_office_during_the_wait_is_not_a_reply(client, db):
    lead, e = _enrolled_on_wait(db, _demo_journey(db))
    _inbound(client, lead, "m1", "Automatic reply: I am out of the office")
    e = _finish_wait(db, e)
    assert not _condition_due_now(db, e)      # still waits for a real reply
    # ...and if none comes, times out to the no-reply path.
    assert _run(db, e).current_node_id == "no_reply"


def test_out_of_office_takes_its_own_branch_when_the_cadence_has_one(client, db):
    lead, e = _enrolled_on_wait(db, _demo_journey(db, with_ooo_branch=True))
    _inbound(client, lead, "m1", "Out of Office: back Monday")
    e = _finish_wait(db, e)
    assert _run(db, e).current_node_id == "ooo"


def test_a_real_reply_after_an_out_of_office_wins(client, db):
    lead, e = _enrolled_on_wait(db, _demo_journey(db, with_ooo_branch=True))
    _inbound(client, lead, "m1", "Out of Office: back Monday")
    _inbound(client, lead, "m2", "Re: sure, let's talk")
    e = _finish_wait(db, e)
    assert _run(db, e).current_node_id == "replied"


def test_out_of_office_while_parked_on_the_condition_keeps_waiting(client, db):
    lead, e = _enrolled_on_wait(db, _demo_journey(db))
    e = _finish_wait(db, e)
    _inbound(client, lead, "m1", "Automatic reply: away")
    db.expire_all()
    e = db.query(models.JourneyEnrollment).get(e.id)
    assert e.current_node_id == "c" and e.trigger_event is None
    _inbound(client, lead, "m2", "Re: interested")        # a real reply now branches at once
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).current_node_id == "replied"


def test_a_reply_already_used_by_one_condition_does_not_leak_into_the_next(client, db):
    c2 = {"id": "c2", "type": "condition", "data": {
        "timeout_hours": 48, "branch_on_event": {"email_replied": "replied"}, "branch_on_timeout": "no_reply"}}
    w2 = {"id": "w2", "type": "wait", "data": {"duration_hours": 1}}
    c1 = {"id": "c", "type": "condition", "data": {
        "timeout_hours": 48, "branch_on_event": {"email_replied": "w2"}, "branch_on_timeout": "no_reply"}}
    journey = _journey(db, [TRIGGER, WAIT, c1, w2, c2, REPLIED, NO_REPLY],
                       _edges(("t", "w"), ("w", "c"), ("w2", "c2")))
    lead, e = _enrolled_on_wait(db, journey)
    _inbound(client, lead, "m1", "Re: yes")
    e = _finish_wait(db, e)
    e = _run(db, e)                            # c1 consumes the reply -> w2
    assert e.current_node_id == "w2"
    e = _run(db, e)                            # w2 elapses -> c2
    assert e.current_node_id == "c2"
    assert not _condition_due_now(db, e)       # no new reply: c2 waits, not re-fired by the old one


def test_the_status_label_still_says_awaiting_rep_after_a_reply_is_remembered(client, db):
    """event_received rows must not mask why the current step is waiting."""
    from routes.journey_routes import _pending_reason
    task_first = {"id": "task", "type": "task", "data": {"task_kind": "custom", "instructions": "x"}}
    cond = {"id": "c", "type": "condition", "data": {"timeout_hours": 48, "branch_on_event": {"email_replied": "replied"}}}
    journey = _journey(db, [TRIGGER, task_first, cond, REPLIED], _edges(("t", "task"), ("task", "c")))
    lead = create_test_lead(db, email="prospect@acme.com")
    create_email_thread(db, lead_id=lead.id, nylas_thread_id=f"thread-{lead.id}")
    e = _run(db, je.enroll_lead(db, journey, lead))
    assert e.current_node_id == "task"
    _inbound(client, lead, "m1", "Re: hi")
    db.expire_all()
    assert _pending_reason(db, db.query(models.JourneyEnrollment).get(e.id))["reason"] == "awaiting_rep"


# ── "Stop on reply" vs a reply branch (v13.4.0) ─────────────────────────────

def _reply_branch_graph():
    return {"nodes": [
        {"id": "t", "type": "trigger", "data": {"event": "status_changed", "to_status": "Lead Assigned"}},
        {"id": "c", "type": "condition", "data": {"label": "Replied?", "timeout_hours": 24,
                                                  "branch_on_event": {"email_replied": "r"}, "branch_on_timeout": "n"}},
        {"id": "r", "type": "task", "data": {"task_kind": "custom", "instructions": "reply"}},
        {"id": "n", "type": "task", "data": {"task_kind": "custom", "instructions": "no reply"}},
    ], "edges": [{"id": "a", "source": "t", "target": "c"}, {"id": "b", "source": "c", "target": "n"}]}


def _new_cadence(client):
    j = client.post("/api/journeys", json={"name": "Reply branch"}).json()
    assert client.put(f"/api/journeys/{j['id']}/versions/{j['draft_version_id']}",
                      json={"graph_definition": _reply_branch_graph()}).status_code == 200
    return j


def test_publishing_a_reply_branch_with_stop_on_reply_on_is_refused_with_the_fix(client, db):
    j = _new_cadence(client)                       # new cadences start with stop_on_reply on
    r = client.post(f"/api/journeys/{j['id']}/publish")
    assert r.status_code == 422
    assert '"Stop on reply" is on' in r.json()["detail"] and '"Replied?"' in r.json()["detail"]

    assert client.patch(f"/api/journeys/{j['id']}", json={"stop_on_reply": False}).status_code == 200
    assert client.post(f"/api/journeys/{j['id']}/publish").status_code == 200


def test_turning_stop_on_reply_on_for_a_live_reply_branch_is_refused(client, db):
    j = _new_cadence(client)
    client.patch(f"/api/journeys/{j['id']}", json={"stop_on_reply": False})
    assert client.post(f"/api/journeys/{j['id']}/publish").status_code == 200
    r = client.patch(f"/api/journeys/{j['id']}", json={"stop_on_reply": True})
    assert r.status_code == 422 and "can never run" in r.json()["detail"]
    assert db.query(models.Journey).get(j["id"]).stop_on_reply is False
