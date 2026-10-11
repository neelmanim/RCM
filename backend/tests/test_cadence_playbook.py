"""v13.0.0 — cadence engine support for research-led, multi-channel playbooks
(the two-cadence playbook shared 2026-09-30): manual task steps that wait for
the rep and branch on their outcome, lead-field branches, text steps skipped
for leads with no phone, journey-wide stop rules, a hard duration limit, the
re-engagement task, sending as the lead's rep, and the new merge fields.
"""
import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

import models
from crypto import encrypt_token
from journey_engine import engine as je

from conftest import create_test_lead, create_test_user, create_nylas_config, create_user_mailbox


def _journey(db, nodes, edges, **settings):
    j = models.Journey(name="Playbook", owner_id="owner-1", status="active", **settings)
    db.add(j)
    db.flush()
    v = models.JourneyVersion(journey_id=j.id, version_number=1, status="published",
                              graph_definition={"nodes": nodes, "edges": edges})
    db.add(v)
    db.flush()
    j.live_version_id = v.id
    db.commit()
    return j


def _edges(*pairs):
    return [{"id": f"e{i}", "source": a, "target": b} for i, (a, b) in enumerate(pairs)]


TRIGGER = {"id": "t", "type": "trigger", "data": {"event": "status_changed"}}
WAIT = {"id": "w", "type": "wait", "data": {"duration_hours": 72}}


def _run(db, enrollment):
    """Run this enrollment's pending step now (as if its time had come)."""
    row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id,
        models.JourneyExecutionQueue.status == "pending",
    ).first()
    row.next_run_at = datetime.now(timezone.utc)
    db.commit()
    je.execute_step(row.id)
    db.expire_all()
    return db.query(models.JourneyEnrollment).get(enrollment.id)


def _rep_lead(db, **lead_kwargs):
    owner = db.query(models.User).get("owner-1") or create_test_user(
        db, email="owner@test.com", name="Olivia Owner", role="Pod Admin", id="owner-1")
    rep = create_test_user(db, email="rep@test.com", name="Riya Rep", role="SDR", id="rep-1")
    lead = create_test_lead(db, **lead_kwargs)
    rep.assigned_leads.append(lead)
    db.commit()
    return owner, rep, lead


LINKEDIN = {"id": "li", "type": "task", "data": {
    "task_kind": "linkedin_connect", "instructions": "Hi {{first_name}}, {{research_hook}}",
    "outcomes": [{"key": "accepted", "label": "Accepted"}, {"key": "not_accepted", "label": "Not accepted"}],
    "branch_on_outcome": {"accepted": "msg"}, "due_within_hours": 48,
}}
MSG = {"id": "msg", "type": "task", "data": {"task_kind": "linkedin_message", "instructions": "Thanks for connecting"}}


# ── Manual task steps ────────────────────────────────────────────────────────

def test_task_step_creates_the_reps_task_and_waits_for_it(db):
    _, rep, lead = _rep_lead(db, first_name="Paul")
    lead.research_hook = "saw your new clinic opening"
    db.commit()
    j = _journey(db, [TRIGGER, LINKEDIN, MSG, WAIT], _edges(("t", "li"), ("li", "w")))
    e = je.enroll_lead(db, j, lead)

    e = _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "li").one()
    assert task.user_id == rep.id and task.journey_enrollment_id == e.id
    assert task.description == "Hi Paul, saw your new clinic opening"
    assert [o["key"] for o in json.loads(task.outcome_options)] == ["accepted", "not_accepted"]
    # Still parked on the step — the journey waits for the rep.
    assert e.status == "active" and e.current_node_id == "li"


def test_completing_with_an_outcome_routes_the_journey(db):
    _, _, lead = _rep_lead(db)
    j = _journey(db, [TRIGGER, LINKEDIN, MSG, WAIT], _edges(("t", "li"), ("li", "w")))
    e = je.enroll_lead(db, j, lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "li").one()

    task.outcome, task.done = "accepted", "true"
    db.commit()
    assert je.complete_manual_step(db, task) is True
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).current_node_id == "msg"


def test_an_outcome_with_no_branch_follows_the_plain_edge(db):
    _, _, lead = _rep_lead(db)
    j = _journey(db, [TRIGGER, LINKEDIN, MSG, WAIT], _edges(("t", "li"), ("li", "w")))
    e = je.enroll_lead(db, j, lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "li").one()
    task.outcome, task.done = "not_accepted", "true"
    db.commit()
    je.complete_manual_step(db, task)
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).current_node_id == "w"


def test_a_missed_deadline_moves_on_and_takes_the_task_off_the_list(db):
    _, _, lead = _rep_lead(db)
    step = {**LINKEDIN, "data": {**LINKEDIN["data"], "branch_on_timeout": "w"}}
    j = _journey(db, [TRIGGER, step, MSG, WAIT], _edges(("t", "li"), ("li", "msg")))
    e = je.enroll_lead(db, j, lead)
    _run(db, e)          # creates the task, parks
    e = _run(db, e)      # deadline reached, nobody completed it
    task = db.query(models.Task).filter(models.Task.journey_node_id == "li").one()
    assert e.current_node_id == "w"
    assert (task.done, task.outcome) == ("true", "missed_deadline")


def test_hard_stop_task_waits_indefinitely_instead_of_timing_out(db):
    """Feedback #6/#7: a Task step marked hard_stop=True must never
    auto-advance — the cadence has to support a real hard stop, not just a
    longer deadline."""
    _, _, lead = _rep_lead(db)
    step = {**LINKEDIN, "data": {**LINKEDIN["data"], "hard_stop": True, "branch_on_timeout": "w"}}
    j = _journey(db, [TRIGGER, step, MSG, WAIT], _edges(("t", "li"), ("li", "msg")))
    e = je.enroll_lead(db, j, lead)
    e = _run(db, e)  # creates the task, parks

    row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == e.id).first()
    now = datetime.now(timezone.utc)
    next_run_at = row.next_run_at if row.next_run_at.tzinfo else row.next_run_at.replace(tzinfo=timezone.utc)
    assert next_run_at.year > now.year + 50
    assert e.status == "active" and e.current_node_id == "li"


# ── Lead-field branches ──────────────────────────────────────────────────────

def _persona_journey(db):
    cond = {"id": "c", "type": "condition", "data": {
        "field_rule": {"field": "title", "op": "contains_any", "value": "marketing, growth, demand"},
        "branch_on_match": "mkt", "branch_on_no_match": "ops"}}
    mkt = {"id": "mkt", "type": "wait", "data": {"duration_hours": 1}}
    ops = {"id": "ops", "type": "wait", "data": {"duration_hours": 1}}
    return _journey(db, [TRIGGER, cond, mkt, ops], _edges(("t", "c")))


def test_field_rule_picks_the_marketing_variant_by_title(db):
    _, _, lead = _rep_lead(db)
    lead.title = "VP Demand Generation"
    db.commit()
    e = je.enroll_lead(db, _persona_journey(db), lead)
    assert _run(db, e).current_node_id == "mkt"


def test_field_rule_falls_to_the_other_branch(db):
    _, _, lead = _rep_lead(db)
    lead.title = "Practice Manager"
    db.commit()
    e = je.enroll_lead(db, _persona_journey(db), lead)
    assert _run(db, e).current_node_id == "ops"


# ── Text only once a number exists ───────────────────────────────────────────

def test_text_step_is_skipped_not_failed_when_the_lead_has_no_phone(db):
    _, _, lead = _rep_lead(db, phone=None)
    sms = {"id": "s", "type": "sms", "data": {"message": "Hi {{first_name}}"}}
    j = _journey(db, [TRIGGER, sms, WAIT], _edges(("t", "s"), ("s", "w")))
    e = je.enroll_lead(db, j, lead)
    e = _run(db, e)
    assert e.status == "active" and e.current_node_id == "w"
    assert db.query(models.ExecutionLog).filter(models.ExecutionLog.event_type == "step_skipped").count() == 1


# ── Journey-wide stop rules ──────────────────────────────────────────────────

def _parked_on_wait(db, **settings):
    _, _, lead = _rep_lead(db)
    j = _journey(db, [TRIGGER, LINKEDIN, WAIT], _edges(("t", "li"), ("li", "w")), **settings)
    e = je.enroll_lead(db, j, lead)
    _run(db, e)   # rep now has an open LinkedIn task; enrollment parked on it
    return lead, e


def test_a_reply_anywhere_stops_the_cadence_and_closes_its_tasks(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    je.check_exit_triggers(db, "email_replied", lead)
    db.expire_all()
    e = db.query(models.JourneyEnrollment).get(e.id)
    assert (e.status, e.exited_reason) == ("exited_early", "replied")
    assert db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == e.id,
        models.JourneyExecutionQueue.status == "pending").count() == 0
    task = db.query(models.Task).filter(models.Task.journey_enrollment_id == e.id).one()
    assert (task.done, task.outcome) == ("true", "cadence_ended")


def test_an_out_of_office_is_not_a_reply(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    je.check_exit_triggers(db, "email_auto_replied", lead)
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).status == "active"


def test_existing_cadences_keep_the_old_behaviour(db):
    """stop_on_reply defaults off — a pre-v13 cadence ignores the reply unless
    it's parked on a condition node that branches on it, exactly as before."""
    lead, e = _parked_on_wait(db)
    je.check_exit_triggers(db, "email_replied", lead)
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).status == "active"


def test_a_text_reply_stops_it_too(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    je.notify_inbound_message(db, lead, "sms")
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).exited_reason == "replied"


def test_a_booked_meeting_stops_it(db):
    lead, e = _parked_on_wait(db, stop_on_meeting=True)
    je.check_exit_triggers(db, "status_changed", lead, to_status="Meeting Scheduled")
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).exited_reason == "meeting_booked"


def test_a_pre_meeting_status_change_does_not(db):
    lead, e = _parked_on_wait(db, stop_on_meeting=True)
    je.check_exit_triggers(db, "status_changed", lead, to_status="Calling")
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).status == "active"


# ── Hard stop + re-engagement ────────────────────────────────────────────────

def test_hard_stop_after_max_duration_days(db):
    _, _, lead = _rep_lead(db)
    j = _journey(db, [TRIGGER, WAIT], _edges(("t", "w")), max_duration_days=15)
    e = je.enroll_lead(db, j, lead)
    e.enrolled_at = datetime.now(timezone.utc) - timedelta(days=16)
    db.commit()
    e = _run(db, e)
    assert (e.status, e.exited_reason) == ("completed", "max_duration")


def test_engaged_lead_gets_a_reengage_task_60_days_out(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True, reengage_after_days=60)
    je.check_exit_triggers(db, "email_replied", lead)
    db.expire_all()
    task = db.query(models.Task).filter(models.Task.title.like("%Re-engage%")).one()
    assert task.user_id == "rep-1"
    due = task.due_time if task.due_time.tzinfo else task.due_time.replace(tzinfo=timezone.utc)
    assert timedelta(days=59) < due - datetime.now(timezone.utc) <= timedelta(days=60)


def _finish_with_opens(db, opens):
    _, _, lead = _rep_lead(db)
    j = _journey(db, [TRIGGER, WAIT], _edges(("t", "w")), reengage_after_days=60)
    e = je.enroll_lead(db, j, lead)
    for _ in range(opens):
        db.add(models.LeadEmailActivity(lead_id=lead.id, direction="outbound", enrollment_id=e.id,
                                        opened_at=datetime.now(timezone.utc)))
    db.commit()
    assert _run(db, e).status == "completed"   # wait done, last step → finished
    return db.query(models.Task).filter(models.Task.title.like("%Re-engage%")).count()


def test_two_opened_emails_count_as_engaged(db):
    assert _finish_with_opens(db, 2) == 1


def test_one_opened_email_does_not(db):
    assert _finish_with_opens(db, 1) == 0


def test_meeting_booked_never_gets_a_reengage_task(db):
    lead, e = _parked_on_wait(db, stop_on_meeting=True, reengage_after_days=60)
    je.check_exit_triggers(db, "status_changed", lead, to_status="Meeting Scheduled")
    db.expire_all()
    assert db.query(models.Task).filter(models.Task.title.like("%Re-engage%")).count() == 0


# ── Sender + merge fields ────────────────────────────────────────────────────

def _email_journey(db, **settings):
    email = {"id": "m", "type": "email", "data": {
        "subject": "Hi {{first_name}}", "body": "{{research_opening}}\n\n{{sender_name}} ({{rep_name}})"}}
    return _journey(db, [TRIGGER, email, WAIT], _edges(("t", "m"), ("m", "w")), **settings)


def _capture_send():
    sent = {}

    def fake(db, mailbox, subject, body, lead, **kw):
        sent.update(mailbox_id=mailbox.id, subject=subject, body=body, html=kw.get("body_is_html"))
        return SimpleNamespace(success=True, error=None, retryable=False, provider_ref="msg-1")
    return sent, patch("email_send.send_email", side_effect=fake)


def test_sends_as_the_leads_rep_with_rep_merge_fields(db):
    _, rep, lead = _rep_lead(db, first_name="Paul")
    lead.research_opening = "Congrats on the Brisbane expansion."
    create_nylas_config(db, api_key_encrypted=encrypt_token("k"))
    create_user_mailbox(db, user_id="owner-1")
    rep_box_id = create_user_mailbox(db, user_id=rep.id, email_address="rep@test.com").id
    e = je.enroll_lead(db, _email_journey(db, send_as="assigned_rep"), lead)
    sent, p = _capture_send()
    with p:
        _run(db, e)
    assert sent["mailbox_id"] == rep_box_id
    assert sent["subject"] == "Hi Paul"
    assert sent["body"] == "Congrats on the Brisbane expansion.\n\nRiya Rep (Riya Rep)"


def test_falls_back_to_the_owner_when_the_rep_has_no_mailbox(db):
    _, _, lead = _rep_lead(db)
    create_nylas_config(db, api_key_encrypted=encrypt_token("k"))
    owner_box_id = create_user_mailbox(db, user_id="owner-1").id
    e = je.enroll_lead(db, _email_journey(db, send_as="assigned_rep"), lead)
    sent, p = _capture_send()
    with p:
        _run(db, e)
    assert sent["mailbox_id"] == owner_box_id
    assert sent["body"].endswith("Olivia Owner (Riya Rep)")   # sender = who actually sent


def test_legacy_cadence_still_sends_as_the_owner(db):
    _, rep, lead = _rep_lead(db)
    create_nylas_config(db, api_key_encrypted=encrypt_token("k"))
    owner_box_id = create_user_mailbox(db, user_id="owner-1").id
    create_user_mailbox(db, user_id=rep.id, email_address="rep@test.com")
    e = je.enroll_lead(db, _email_journey(db), lead)   # send_as NULL
    sent, p = _capture_send()
    with p:
        _run(db, e)
    assert sent["mailbox_id"] == owner_box_id


def test_rich_text_body_is_sent_as_html_with_escaped_merge_values(db):
    _, _, lead = _rep_lead(db, company="Smith & Sons")
    create_nylas_config(db, api_key_encrypted=encrypt_token("k"))
    create_user_mailbox(db, user_id="owner-1")
    email = {"id": "m", "type": "email", "data": {"subject": "Hi", "body_format": "html",
             "body": "<table><tr><td>{{company}}</td></tr></table>"}}
    e = je.enroll_lead(db, _journey(db, [TRIGGER, email, WAIT], _edges(("t", "m"), ("m", "w"))), lead)
    sent, p = _capture_send()
    with p:
        _run(db, e)
    assert sent["html"] is True
    assert sent["body"] == "<table><tr><td>Smith &amp; Sons</td></tr></table>"


# ── API ──────────────────────────────────────────────────────────────────────

def test_new_cadences_default_to_stop_rules_and_rep_sending(client):
    j = client.post("/api/journeys", json={"name": "Cadence 1"}).json()
    detail = client.get(f"/api/journeys/{j['id']}").json()
    assert (detail["stop_on_reply"], detail["stop_on_meeting"], detail["send_as"]) == (True, True, "assigned_rep")


def test_settings_round_trip_and_validation(client):
    j = client.post("/api/journeys", json={"name": "C"}).json()
    ok = client.patch(f"/api/journeys/{j['id']}", json={"max_duration_days": 15, "reengage_after_days": 60,
                                                         "reengage_min_opens": 2, "send_as": "owner"})
    assert ok.status_code == 200 and ok.json()["max_duration_days"] == 15 and ok.json()["send_as"] == "owner"
    assert client.patch(f"/api/journeys/{j['id']}", json={"max_duration_days": 0}).status_code == 422
    assert client.patch(f"/api/journeys/{j['id']}", json={"send_as": "anyone"}).status_code == 422


def test_duplicate_copies_steps_and_settings_into_a_new_draft(client, db):
    src = _journey(db, [TRIGGER, LINKEDIN, WAIT], _edges(("t", "li"), ("li", "w")),
                   stop_on_reply=True, max_duration_days=15, send_as="assigned_rep")
    r = client.post(f"/api/journeys/{src.id}/duplicate", json={"name": "Cadence 2 — Salesforce"})
    assert r.status_code == 200
    copy = db.query(models.Journey).get(r.json()["id"])
    assert (copy.name, copy.status, copy.max_duration_days, copy.send_as) == \
        ("Cadence 2 — Salesforce", "draft", 15, "assigned_rep")
    draft = db.query(models.JourneyVersion).get(r.json()["draft_version_id"])
    assert [n["id"] for n in draft.graph_definition["nodes"]] == ["t", "li", "w"]


def test_duplicate_is_open_to_every_role_not_just_pod_admin_plus(client_as_sdr, db):
    """v13.1.3 — widened from Pod Admin+ to match create_journey's own
    every-role opening in v13.1.1 (feedback: "copy cadence by another
    user" wasn't actually usable by non-admin roles)."""
    src = _journey(db, [TRIGGER, LINKEDIN, WAIT], _edges(("t", "li"), ("li", "w")))
    r = client_as_sdr.post(f"/api/journeys/{src.id}/duplicate", json={"name": "SDR's copy"})
    assert r.status_code == 200
    copy = db.query(models.Journey).get(r.json()["id"])
    assert copy.owner_id == "sdr-user-id"


def test_publish_validation_covers_the_new_steps():
    from routes.journey_routes import _validate_graph_for_publish
    bad_task = {"id": "x", "type": "task", "data": {"task_kind": "linkedin_message",
                "outcomes": [{"key": "a", "label": "A"}], "branch_on_outcome": {"zzz": "t"}}}
    bad_rule = {"id": "y", "type": "condition", "data": {"field_rule": {"field": "salary", "op": "contains_any"}}}
    errors = " | ".join(_validate_graph_for_publish(
        {"nodes": [TRIGGER, bad_task, bad_rule], "edges": _edges(("t", "x"), ("x", "y"))}))
    assert "LinkedIn message text" in errors
    assert "outcome \"zzz\"" in errors
    assert "lead field to check" in errors


def test_completing_a_task_with_an_outcome_via_the_api(client, db):
    _, _, lead = _rep_lead(db)
    j = _journey(db, [TRIGGER, LINKEDIN, MSG, WAIT], _edges(("t", "li"), ("li", "w")))
    e = je.enroll_lead(db, j, lead)
    _run(db, e)
    task = db.query(models.Task).filter(models.Task.journey_node_id == "li").one()
    assert client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True, "outcome": "maybe"}).status_code == 422
    assert client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True, "outcome": "accepted"}).status_code == 200
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).current_node_id == "msg"
