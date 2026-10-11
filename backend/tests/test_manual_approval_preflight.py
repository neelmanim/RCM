"""v13.3.5 — approving a manual email/SMS draft that can't possibly send (no
connected mailbox, lead has no phone...) is refused up front with a clear
409, leaving the draft open and the enrollment intact.

Found live on staging: a rep with no connected mailbox clicked Send, got a
200, the draft vanished, and the enrollment silently went to "failed" — the
rep thought the email had gone out.
"""
import os
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

import models
from crypto import encrypt_token
from journey_engine import engine as je

from conftest import create_nylas_config
from test_cadence_playbook import _run, _rep_lead
from test_manual_email_cadence_step import _manual_email_journey, _setup as _email_setup, _capture_send as _capture_email
from test_manual_sms_cadence_step import _manual_sms_journey, _setup as _sms_setup, _capture_send as _capture_sms


def _parked(db, journey_fn, lead):
    e = _run(db, je.enroll_lead(db, journey_fn(db), lead))
    task = db.query(models.Task).filter(models.Task.journey_enrollment_id == e.id).one()
    return e, task


def _assert_kept(db, e, task):
    db.expire_all()
    assert db.query(models.Task).get(task.id).done == "false"
    e = db.query(models.JourneyEnrollment).get(e.id)
    assert e.status == "active" and e.current_node_id == "m"


def test_email_approval_without_any_mailbox_is_refused_and_draft_kept(client, db):
    _, _, lead = _rep_lead(db, first_name="Paul")
    create_nylas_config(db, api_key_encrypted=encrypt_token("k"))   # no mailbox for rep or owner
    e, task = _parked(db, _manual_email_journey, lead)

    sent, p = _capture_email()
    with p:
        r = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True, "subject": "edited"})
    assert r.status_code == 409
    assert "No connected mailbox" in r.json()["detail"]
    assert "draft is kept" in r.json()["detail"]
    assert sent == {}
    _assert_kept(db, e, task)


def test_email_approval_when_lead_lost_its_email_is_refused(client, db):
    _, lead = _email_setup(db, first_name="Paul")
    e, task = _parked(db, _manual_email_journey, lead)
    lead.email = None
    db.commit()
    r = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True})
    assert r.status_code == 409 and "no email address" in r.json()["detail"]
    _assert_kept(db, e, task)


def test_email_approval_with_a_mailbox_still_sends(client, db):
    _, lead = _email_setup(db, first_name="Paul")
    e, task = _parked(db, _manual_email_journey, lead)
    sent, p = _capture_email()
    with p:
        r = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True})
    assert r.status_code == 200
    assert sent["subject"] == "Hi Paul"


def test_sms_approval_when_lead_has_no_phone_is_refused(client, db):
    _, lead = _sms_setup(db, first_name="Paul")
    e, task = _parked(db, _manual_sms_journey, lead)
    lead.phone = None
    db.commit()
    provider, p = _capture_sms()
    with p:
        r = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True})
    assert r.status_code == 409 and "no phone number" in r.json()["detail"]
    provider.send.assert_not_called()
    _assert_kept(db, e, task)


def test_sms_approval_without_messaging_access_is_refused(client, db):
    _, lead = _sms_setup(db, first_name="Paul")
    e, task = _parked(db, _manual_sms_journey, lead)
    denied = SimpleNamespace(provider=None, error="SMS is not enabled for Riya Rep", retryable=False)
    with patch("messaging_service.resolve_messaging_for_user", return_value=denied):
        r = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True})
    assert r.status_code == 409 and "SMS is not enabled" in r.json()["detail"]
    _assert_kept(db, e, task)


def test_sms_transient_provider_error_does_not_block_approval(client, db):
    """Retryable failures are the engine's backoff's job, not a refusal."""
    _, lead = _sms_setup(db, first_name="Paul")
    e, task = _parked(db, _manual_sms_journey, lead)
    blip = SimpleNamespace(provider=None, error="provider timeout", retryable=True)
    with patch("messaging_service.resolve_messaging_for_user", return_value=blip):
        r = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True})
    assert r.status_code == 200
