"""v13.8.0 — what counts as "the lead replied" (RCA 2026-10-07).

An AE ran a cadence on prod to two colleagues who opened and clicked it. One
cadence ended with "The lead replied" though she never replied: any mail
involving the lead's address — a colleague's, a receipt, another thread — was
read as a reply. Also: Nylas v3 nests the message under data.object, and the
webhook's message.created branch read thread_id off the envelope, so webhook
replies were dropped entirely (opens/clicks already unwrapped it)."""
import json
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import models
from journey_engine import engine as je
from conftest import create_email_thread
from test_cadence_playbook import _parked_on_wait

LEAD_THREAD = "t-cad"


def _cadence(db, **settings):
    """A lead parked in a stop-on-reply cadence that has sent them one email."""
    lead, e = _parked_on_wait(db, stop_on_reply=True, **settings)
    e.enrolled_at = datetime.now(timezone.utc) - timedelta(hours=2)
    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="outbound", subject="Quick question", nylas_message_id="out-1",
        nylas_thread_id=LEAD_THREAD, journey_id=e.journey_id, enrollment_id=e.id,
        timestamp=datetime.now(timezone.utc) - timedelta(hours=1)))
    db.commit()
    return lead, e


def _msg(lead, **kw):
    return {"id": "in-1", "thread_id": LEAD_THREAD, "from": lead.email, "subject": "Re: Quick question",
            "source": "test", **kw}


def _status(db, e):
    db.expire_all()
    return db.query(models.JourneyEnrollment).get(e.id)


def test_a_reply_from_the_lead_in_the_cadence_thread_stops_it_and_the_stop_names_the_message(db):
    lead, e = _cadence(db)
    je.notify_inbound_email(db, lead, False, message=_msg(lead))
    assert _status(db, e).exited_reason == "replied"
    log = db.query(models.ExecutionLog).filter_by(enrollment_id=e.id, event_type="journey_stopped").one()
    assert log.detail["message_id"] == "in-1" and log.detail["thread_id"] == LEAD_THREAD
    assert log.detail["from"] == lead.email and log.detail["source"] == "test"


def test_mail_from_the_lead_on_another_thread_is_not_a_reply_to_the_cadence(db):
    lead, e = _cadence(db)
    je.notify_inbound_email(db, lead, False, message=_msg(lead, thread_id="t-other", subject="Lunch on Friday?"))
    assert _status(db, e).status == "active"


def test_a_reply_whose_client_broke_the_thread_still_matches_on_subject(db):
    lead, e = _cadence(db)
    je.notify_inbound_email(db, lead, False, message=_msg(lead, thread_id="t-new", subject="RE: Re: quick question"))
    assert _status(db, e).exited_reason == "replied"


def test_a_colleague_or_forwarder_in_the_thread_is_not_the_lead(db):
    lead, e = _cadence(db)
    je.notify_inbound_email(db, lead, False, message=_msg(lead, **{"from": "someone.else@acme.com"}))
    assert _status(db, e).status == "active"


def test_read_receipts_bounces_and_noreply_notices_are_not_replies(db):
    lead, e = _cadence(db)
    for subject, sender in (("Read: Quick question", lead.email), ("Undeliverable: Quick question", lead.email),
                            ("Delivered: Quick question", lead.email), ("Accepted: Quick question", lead.email),
                            ("Re: Quick question", "mailer-daemon@acme.com"), ("Re: Quick question", "noreply@acme.com")):
        je.notify_inbound_email(db, lead, False, message=_msg(lead, subject=subject, **{"from": sender}))
    assert _status(db, e).status == "active"


def test_a_lead_who_was_never_emailed_by_a_cadence_cannot_have_replied_to_it(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)            # no email sent yet
    je.notify_inbound_email(db, lead, False, message=_msg(lead))
    assert _status(db, e).status == "active"


def test_a_reply_stops_only_the_cadence_it_answers(db):
    from test_cadence_playbook import _journey, _edges, TRIGGER, LINKEDIN, WAIT
    lead, e1 = _cadence(db)
    j2 = _journey(db, [TRIGGER, LINKEDIN, WAIT], _edges(("t", "li"), ("li", "w")), stop_on_reply=True)
    e2 = je.enroll_lead(db, j2, lead)
    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="outbound", subject="Different topic", nylas_thread_id="t-two",
        journey_id=e2.journey_id, enrollment_id=e2.id, timestamp=datetime.now(timezone.utc) + timedelta(minutes=1)))
    db.commit()
    je.notify_inbound_email(db, lead, False, message=_msg(lead))              # answers the first one
    assert _status(db, e1).exited_reason == "replied" and _status(db, e2).status == "active"


# ── the Nylas webhook: real v3 envelope ──────────────────────────────────────

def _v3(event_type, obj):
    return {"specversion": "1.0", "type": event_type, "source": "/google/emails/realtime", "id": "evt-1",
            "time": int(time.time()), "webhook_delivery_attempt": 1,
            "data": {"application_id": "app-1", "object": obj}}


def _message(lead, **kw):
    return {"id": "wh-msg-1", "grant_id": "g1", "thread_id": LEAD_THREAD, "subject": "Re: Quick question",
            "from": [{"email": lead.email}], "to": [{"email": "rep@test.com"}], "body": "Sounds good", **kw}


def test_a_v3_message_created_webhook_stores_the_reply_and_stops_the_cadence(client, db):
    lead, e = _cadence(db)
    create_email_thread(db, lead_id=lead.id, nylas_thread_id=LEAD_THREAD)
    r = client.post("/webhooks/nylas", content=json.dumps(_v3("message.created", _message(lead))))
    assert r.status_code == 200
    assert db.query(models.LeadEmailActivity).filter_by(nylas_message_id="wh-msg-1", direction="inbound").count() == 1
    assert _status(db, e).exited_reason == "replied"
    log = db.query(models.ExecutionLog).filter_by(enrollment_id=e.id, event_type="journey_stopped").one()
    assert log.detail["source"] == "webhook" and log.detail["message_id"] == "wh-msg-1"


def test_a_colleague_message_on_the_thread_is_logged_but_does_not_stop_the_cadence(client, db):
    lead, e = _cadence(db)
    create_email_thread(db, lead_id=lead.id, nylas_thread_id=LEAD_THREAD)
    colleague = _message(lead, id="wh-msg-2", **{"from": [{"email": "colleague@acme.com"}]})
    client.post("/webhooks/nylas", content=json.dumps(_v3("message.created", colleague)))
    assert db.query(models.LeadEmailActivity).filter_by(nylas_message_id="wh-msg-2").count() == 1
    assert _status(db, e).status == "active"


def test_a_read_receipt_webhook_is_stored_as_an_auto_reply_and_does_not_stop_the_cadence(client, db):
    lead, e = _cadence(db)
    create_email_thread(db, lead_id=lead.id, nylas_thread_id=LEAD_THREAD)
    receipt = _message(lead, id="wh-msg-3", subject="Read: Quick question")
    client.post("/webhooks/nylas", content=json.dumps(_v3("message.created", receipt)))
    row = db.query(models.LeadEmailActivity).filter_by(nylas_message_id="wh-msg-3").one()
    assert row.is_auto_reply is True and _status(db, e).status == "active"


def test_open_and_click_events_never_touch_the_cadence(client, db):
    lead, e = _cadence(db)
    for kind, obj in (("message.opened", {"message_id": "out-1"}),
                      ("message.link_clicked", {"message_id": "out-1", "link_data": [{"url": "https://x.com", "count": 1}]})):
        client.post("/webhooks/nylas", content=json.dumps(_v3(kind, obj)))
    assert _status(db, e).status == "active"


# ── link clicks: unsubscribe and scanners are not interest ──────────────────

def _click(client, url, message_id="out-2"):
    obj = {"message_id": message_id, "link_data": [{"url": url, "count": 1}], "recents": [{"user_agent": "x"}]}
    return client.post("/webhooks/nylas", content=json.dumps(_v3("message.link_clicked", obj)))


def _outbound(db, lead, seconds_ago):
    from datetime import timedelta
    db.add(models.LeadEmailActivity(lead_id=lead.id, direction="outbound", nylas_message_id="out-2",
                                    timestamp=datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)))
    db.commit()


def test_a_click_on_the_unsubscribe_link_is_not_counted(client, db):
    lead, _ = _cadence(db)
    _outbound(db, lead, seconds_ago=600)
    _click(client, "https://api.example.com/api/public/unsubscribe?token=abc")
    assert db.query(models.LeadEmailActivity).filter_by(nylas_message_id="out-2").one().click_count in (None, 0)


def test_a_real_link_click_is_counted(client, db):
    lead, _ = _cadence(db)
    _outbound(db, lead, seconds_ago=600)
    _click(client, "https://www.example.com/demo")
    row = db.query(models.LeadEmailActivity).filter_by(nylas_message_id="out-2").one()
    assert row.click_count == 1 and row.clicked_at is not None


def test_a_click_seconds_after_the_send_is_a_scanner_not_a_person(client, db):
    lead, _ = _cadence(db)
    _outbound(db, lead, seconds_ago=3)
    _click(client, "https://www.example.com/demo")
    assert db.query(models.LeadEmailActivity).filter_by(nylas_message_id="out-2").one().click_count in (None, 0)


# ── plain-text bodies get real links (Nylas only tracks anchors) ─────────────

def test_a_bare_url_in_a_plain_text_cadence_email_becomes_a_tracked_link():
    from routes.email_routes import _plain_text_to_html
    html = _plain_text_to_html("See https://www.example.com/demo?a=1&b=2. Thanks <b>\nBye", hide_branding=True)
    assert '<a href="https://www.example.com/demo?a=1&amp;b=2">https://www.example.com/demo?a=1&amp;b=2</a>.' in html
    assert "&lt;b&gt;" in html and "<br>" in html            # everything else is still escaped


def test_plain_text_without_a_url_is_unchanged():
    from routes.email_routes import _plain_text_to_html
    assert "<a " not in _plain_text_to_html("Hello there", hide_branding=True)


# ── unsubscribe: a GET only asks ─────────────────────────────────────────────

def _token(lead):
    from routes.email_campaign_routes import create_jwt
    return create_jwt({"purpose": "campaign_unsubscribe", "lead_id": lead.id}, expires_hours=1)


def test_following_the_unsubscribe_link_only_asks_a_scanner_cannot_unsubscribe_a_lead(client, db):
    lead, e = _cadence(db)
    r = client.get(f"/api/public/unsubscribe?token={_token(lead)}")
    assert r.status_code == 200 and "<form" in r.text
    db.expire_all()
    assert db.query(models.Lead).get(lead.id).unsubscribed_at is None
    assert _status(db, e).status == "active"


def test_confirming_unsubscribes_the_lead_and_ends_their_cadences(client, db):
    lead, e = _cadence(db)
    assert client.post(f"/api/public/unsubscribe?token={_token(lead)}").status_code == 200
    db.expire_all()
    assert db.query(models.Lead).get(lead.id).unsubscribed_at is not None
    assert _status(db, e).status == "exited_early"


def test_a_bad_unsubscribe_token_is_refused_on_both_steps(client, db):
    assert client.get("/api/public/unsubscribe?token=nope").status_code == 400
    assert client.post("/api/public/unsubscribe?token=nope").status_code == 400


def test_a_reply_to_an_email_the_rep_sent_by_hand_counts_too(db):
    """A task step "email them personally" then "did they reply?" must still work: the answered email
    needn't have been sent by the cadence, only to this lead since the cadence began."""
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    db.add(models.LeadEmailActivity(lead_id=lead.id, direction="outbound", subject="Personal note",
                                    nylas_thread_id="t-by-hand", timestamp=datetime.now(timezone.utc)))
    db.commit()
    je.notify_inbound_email(db, lead, False, message=_msg(lead, thread_id="t-by-hand", subject="Re: Personal note"))
    assert _status(db, e).exited_reason == "replied"


def test_an_email_we_sent_before_the_cadence_began_is_not_something_it_can_be_answered_by(db):
    lead, e = _parked_on_wait(db, stop_on_reply=True)
    e.enrolled_at = datetime.now(timezone.utc)
    db.add(models.LeadEmailActivity(lead_id=lead.id, direction="outbound", subject="Old thread", nylas_thread_id="t-old",
                                    timestamp=datetime.now(timezone.utc) - timedelta(days=3)))
    db.commit()
    je.notify_inbound_email(db, lead, False, message=_msg(lead, thread_id="t-old", subject="Re: Old thread"))
    assert _status(db, e).status == "active"
