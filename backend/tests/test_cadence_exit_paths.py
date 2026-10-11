"""v13.3.5 — every way a cadence enrollment ends must also (a) close the rep's
parked approval drafts and (b) stop a live Instantly handoff.

Before this, "Remove from cadence" and archive set the enrollment status by
hand, skipping engine._on_enrollment_end: the email/SMS draft stayed in My
Tasks and Instantly kept emailing the lead. Deleting a lead didn't stop its
cadences at all (a soft-deleted lead was still "eligible"), and an
unsubscribe/DNC only ended the enrollment that had an Instantly handoff.
"""
import os

os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

from datetime import datetime, timedelta, timezone

import models
from auth import create_jwt
from journey_engine import engine as je
from services import lead_service

from conftest import create_test_lead
from test_cadence_playbook import _run, _journey, _edges, TRIGGER
from test_manual_email_cadence_step import _setup, _manual_email_journey
from test_instantly_sequence_cadence_step import _parked, _patched, _settings, _mock_provider, STEPS


def _parked_draft(db):
    """A lead parked on a manual-email step, with its open approval task."""
    _, lead = _setup(db, first_name="Paul")
    journey = _manual_email_journey(db)
    e = _run(db, je.enroll_lead(db, journey, lead))
    task = db.query(models.Task).filter(models.Task.journey_enrollment_id == e.id).one()
    assert task.kind == "email_approval" and task.done == "false"
    return journey, lead, e, task


def _reload(db, *rows):
    db.expire_all()
    return [db.query(type(r)).get(r.id) for r in rows]


def _no_reengage_task(db, lead):
    return db.query(models.Task).filter(models.Task.lead_id == lead.id,
                                        models.Task.title.like("Re-engage%")).count() == 0


# ── Remove from cadence ─────────────────────────────────────────────────────

def test_remove_closes_the_parked_draft(client, db):
    _, lead, e, task = _parked_draft(db)
    r = client.post(f"/api/journeys/enrollments/{e.id}/remove")
    assert r.status_code == 200, r.text
    e, task = _reload(db, e, task)
    assert e.status == "exited_early" and e.exited_reason == "manually_removed"
    assert task.done == "true" and task.outcome == "cadence_ended"


def test_remove_stops_the_instantly_handoff(client, db):
    e, lead, provider = _parked(db)
    with _patched(provider):
        assert client.post(f"/api/journeys/enrollments/{e.id}/remove").status_code == 200
    provider.remove_lead_from_campaign.assert_called_once_with("camp-1", "parked@example.com")
    jie = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id).one()
    assert jie.status == "exited" and jie.end_reason == "manually_removed"


def test_approving_a_draft_after_removal_sends_nothing(client, db):
    _, lead, e, task = _parked_draft(db)
    client.post(f"/api/journeys/enrollments/{e.id}/remove")
    db.expire_all()
    task = db.query(models.Task).get(task.id)
    assert je.complete_manual_email_step(db, task) is False


# ── Archive ─────────────────────────────────────────────────────────────────

def test_archive_closes_parked_drafts_and_stops_instantly(client, db):
    journey, lead, e, task = _parked_draft(db)
    r = client.post(f"/api/journeys/{journey.id}/archive", json={"confirm_exit_count": 1})
    assert r.status_code == 200, r.text
    e, task = _reload(db, e, task)
    assert e.status == "exited_early" and e.exited_reason == "journey_archived"
    assert task.done == "true"

    ie, ilead, provider = _parked(db)
    with _patched(provider):
        r = client.post(f"/api/journeys/{ie.journey_id}/archive", json={"confirm_exit_count": 1})
    assert r.status_code == 200, r.text
    provider.remove_lead_from_campaign.assert_called_once_with("camp-1", "parked@example.com")


# ── Lead delete ─────────────────────────────────────────────────────────────

def test_deleting_a_lead_ends_its_cadences_and_closes_drafts(client, db):
    _, lead, e, task = _parked_draft(db)
    r = client.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead.id]})
    assert r.json()["count"] == 1
    e, task = _reload(db, e, task)
    assert e.status == "exited_early" and e.exited_reason == "lead_deleted"
    assert task.done == "true"
    assert _no_reengage_task(db, lead)


def test_deleting_a_lead_stops_the_instantly_handoff(client, db):
    e, lead, provider = _parked(db)
    with _patched(provider):
        client.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead.id]})
    provider.remove_lead_from_campaign.assert_called_once_with("camp-1", "parked@example.com")


def test_a_deleted_lead_is_never_sent_to():
    lead = models.Lead(deleted_at=datetime.now(timezone.utc))
    assert je._is_lead_eligible(lead) is False


# ── DNC / unsubscribe end EVERY cadence, not just an Instantly one ──────────

def test_do_not_contact_ends_a_plain_cadence_and_closes_its_draft(db):
    _, lead, e, task = _parked_draft(db)
    user = {"sub": "owner-1", "role": "Super Admin", "name": "T", "email": "t@test.com"}
    lead_service.update_lead_fields(db, lead, {"do_not_contact": True}, user)
    db.commit()
    e, task = _reload(db, e, task)
    assert e.status == "exited_early" and e.exited_reason == "do_not_contact"
    assert task.done == "true"
    assert _no_reengage_task(db, lead)


def test_unsubscribe_link_ends_every_cadence(client, db):
    _, lead, e, task = _parked_draft(db)
    token = create_jwt({"purpose": "campaign_unsubscribe", "lead_id": lead.id}, expires_hours=1)
    assert client.post(f"/api/public/unsubscribe?token={token}").status_code == 200
    e, task = _reload(db, e, task)
    assert e.status == "exited_early" and e.exited_reason == "unsubscribed"
    assert task.done == "true"


# ── Completion paths ────────────────────────────────────────────────────────

def test_max_duration_stop_also_stops_instantly(db):
    e, lead, provider = _parked(db)
    journey = db.query(models.Journey).get(e.journey_id)
    journey.max_duration_days = 1
    e.enrolled_at = datetime.now(timezone.utc) - timedelta(days=2)
    db.commit()
    with _patched(provider):
        e = _run(db, e)
    assert e.status == "completed" and e.exited_reason == "max_duration"
    provider.remove_lead_from_campaign.assert_called_once_with("camp-1", "parked@example.com")


def test_an_instantly_reply_resume_never_deletes_the_lead_from_instantly(db):
    """resume ends the handoff itself before advancing — the end hook must
    not then treat it as still live and delete the lead from Instantly."""
    _settings(db)
    lead = create_test_lead(db, email="last@example.com")
    # Instantly step is the LAST node, so the resume completes the enrollment
    # and runs _on_enrollment_end — the path that could misfire.
    journey = _journey(db, [TRIGGER, {"id": "i", "type": "instantly_sequence", "data": {"steps": STEPS}}],
                       _edges(("t", "i")))
    provider = _mock_provider()
    with _patched(provider):
        e = _run(db, je.enroll_lead(db, journey, lead))
        assert je.resume_instantly_sequence_step(db, e.id, "i", outcome="replied") is True
    db.expire_all()
    assert db.query(models.JourneyEnrollment).get(e.id).status == "completed"
    provider.remove_lead_from_campaign.assert_not_called()
