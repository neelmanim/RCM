"""v13.7.0 — cadence tasks in My Tasks and the bell: Skip this step instead of
delete, approvals in the bell straight away, and a snooze that can last
past an hour."""
from datetime import datetime, timedelta, timezone

import models
from journey_engine import engine as je
from test_cadence_playbook import _run
from test_manual_email_cadence_step import _setup, _manual_email_journey, _capture_send

ME = "test-user-id"   # the Super Admin the `client` fixture logs in as


def _parked_approval(db):
    _, lead = _setup(db)
    e = _run(db, je.enroll_lead(db, _manual_email_journey(db), lead))
    task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()
    task.user_id = ME
    db.commit()
    return lead, e, task


def test_skip_this_step_closes_the_approval_and_moves_the_lead_on_without_sending(client, db):
    lead, e, task = _parked_approval(db)
    sent, patcher = _capture_send()
    with patcher:
        r = client.post(f"/api/leads/{lead.id}/tasks/{task.id}/skip")
    assert r.status_code == 200, r.text
    assert (r.json()["done"], r.json()["outcome"]) == ("true", "skipped")
    assert sent == {}                                   # nothing went out
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).current_node_id == "w"   # moved on


def test_a_regular_task_cannot_be_skipped(client, db):
    lead, _, _ = _parked_approval(db)
    plain = models.Task(lead_id=lead.id, user_id=ME, title="Call back")
    db.add(plain)
    db.commit()
    assert client.post(f"/api/leads/{lead.id}/tasks/{plain.id}/skip").status_code == 400


def test_deleting_an_open_cadence_step_is_refused(client, db):
    """Deleting it used to leave the cadence parked on a task that no longer existed."""
    lead, e, task = _parked_approval(db)
    r = client.delete(f"/api/leads/{lead.id}/tasks/{task.id}")
    assert r.status_code == 409 and "Skip this step" in r.json()["detail"]
    assert db.query(models.Task).get(task.id) is not None


def test_an_approval_is_in_the_bell_as_soon_as_it_exists(client, db):
    _, _, task = _parked_approval(db)            # due in 24h, so not a due reminder yet
    items = client.get("/api/my/tasks/pending").json()
    assert [(i["id"], i["kind"], i["from_cadence"]) for i in items] == [(task.id, "email_approval", True)]


def test_snooze_until_tomorrow(client, db):
    _, _, task = _parked_approval(db)
    until = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    assert client.patch(f"/api/my/tasks/{task.id}/snooze", json={"until": until}).status_code == 200
    too_far = (datetime.now(timezone.utc) + timedelta(days=400)).isoformat()
    assert client.patch(f"/api/my/tasks/{task.id}/snooze", json={"until": too_far}).status_code == 422
