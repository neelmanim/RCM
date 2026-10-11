"""v13.6.1 — a reply moves the cadence even when no webhook reaches us.

Staging gets no Nylas webhooks (the one webhook URL points at prod) and prod
can miss one, so the periodic mailbox sync must signal the cadence too; and
the periodic SMS sync must file a reply on the lead whose cadence is waiting
for it when several leads share the number."""
import os
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

import models
from crypto import encrypt_token
from journey_engine import engine as je
from dialer_service import _find_lead_by_phone
from conftest import create_test_lead, create_user_mailbox
from test_cadence_playbook import _parked_on_wait


def _cadence_sent(db, lead, e, thread="t-1"):
    db.add(models.LeadEmailActivity(lead_id=lead.id, direction="outbound", subject="Quick question",
                                    nylas_thread_id=thread, journey_id=e.journey_id, enrollment_id=e.id,
                                    timestamp=datetime.now(timezone.utc)))
    db.commit()


def _sync(db, lead, subject="Re: Quick question", hours_ago=0):
    from routes.email_routes import _sync_full_mailbox
    db.add(models.NylasConfig(id=1, client_id="c", api_key_encrypted=encrypt_token("k"),
                              redirect_uri="http://x", is_active=True))
    create_user_mailbox(db, "rep-1", email_address="rep@test.com")
    db.commit()
    msg = {"id": f"m-{subject}-{hours_ago}", "from": [{"email": lead.email}], "to": [{"email": "rep@test.com"}],
           "subject": subject, "body": "Sounds good", "thread_id": "t-1",
           "date": int(time.time() - hours_ago * 3600), "attachments": []}
    resp = MagicMock(status_code=200)
    resp.json.return_value = {"data": [msg]}
    with patch("routes.email_routes.httpx.get", return_value=resp) as get:
        _sync_full_mailbox(lead.id, db)
    db.expire_all()
    return get.call_args.kwargs["params"]


def _status(db, e):
    return db.query(models.JourneyEnrollment).get(e.id).status


def test_a_reply_found_by_the_mailbox_sync_moves_the_cadence(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    _cadence_sent(db, lead, e)
    _sync(db, lead)
    assert db.query(models.JourneyEnrollment).get(e.id).exited_reason == "replied"
    assert db.query(models.LeadEmailActivity).filter_by(lead_id=lead.id, direction="inbound").count() == 1


def test_the_mailbox_search_uses_a_date_filter_nylas_accepts(db):
    """start_after isn't a Nylas messages parameter — every search 400'd and
    the sync silently fell back, so no Gmail reply was ever picked up."""
    lead, _ = _parked_on_wait(db)
    params = _sync(db, lead)
    assert "received_after" in params and "start_after" not in params


def test_mail_from_before_the_enrolment_is_history_not_a_reply(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    _sync(db, lead, hours_ago=48)
    assert _status(db, e) == "active"


def test_an_out_of_office_found_by_the_sync_is_not_a_reply(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    _sync(db, lead, subject="Automatic reply: Out of Office")
    assert _status(db, e) == "active"
    assert db.query(models.LeadEmailActivity).filter_by(lead_id=lead.id).one().is_auto_reply


def test_a_shared_number_goes_to_the_lead_whose_cadence_is_waiting(db):
    in_cadence, _ = _parked_on_wait(db)
    in_cadence.phone = "+14702059963"
    newer = create_test_lead(db, email="newer@example.com", first_name="Newer", phone="14702059963")
    newer.status_changed_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db.commit()
    assert _find_lead_by_phone(db, "+1 470 205 9963").id == in_cadence.id


def test_unrelated_mail_involving_the_lead_found_by_the_sync_is_not_a_reply(db):
    """RCA 2026-10-07: the sync searches the rep's mailbox for the lead's address, so unrelated mail
    (a different thread and subject than the cadence's email) ended the cadence as "replied"."""
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    _cadence_sent(db, lead, e, thread="t-cadence")             # the helper's message is on thread t-1
    _sync(db, lead, subject="Lunch on Friday?")
    assert _status(db, e) == "active"
    assert db.query(models.LeadEmailActivity).filter_by(lead_id=lead.id, direction="inbound").count() == 1   # still logged


def test_a_reply_in_the_cadences_own_thread_stops_it_and_names_the_message(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    _cadence_sent(db, lead, e, thread="t-1")
    _sync(db, lead, subject="Quick question")
    log = db.query(models.ExecutionLog).filter_by(enrollment_id=e.id, event_type="journey_stopped").one()
    assert log.detail["source"] == "mailbox_sync" and log.detail["thread_id"] == "t-1"


def test_a_read_receipt_found_by_the_sync_is_not_a_reply(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    _cadence_sent(db, lead, e)
    _sync(db, lead, subject="Read: Quick question")
    assert _status(db, e) == "active"
