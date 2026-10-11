"""v13.8.0 — Instantly mail sync: every real Instantly email (replies + sent)
stored once, keyed on Instantly's email id, read incrementally in one global
pass. These pin the data layer the Replies inbox/report sit on."""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

import models
from conftest import create_test_lead
from instantly_provider import InstantlyPlanTierError

NOW = datetime.now(timezone.utc)


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _email(eid, lead="jim@test.com", ue=2, subject="Re: hello", body="Sounds good", created=None,
           campaign="camp-1", **kw):
    created = created or NOW - timedelta(hours=1)
    e = {
        "id": eid, "lead": lead, "ue_type": ue, "subject": subject,
        "body": {"text": body, "html": f"<p>{body}</p>"} if body is not None else None,
        "timestamp_created": _iso(created), "timestamp_email": _iso(created),
        "from_address_email": lead if ue == 2 else "rep@send.example.com",
        "to_address_email_list": "rep@send.example.com" if ue == 2 else lead,
        "campaign_id": campaign, "thread_id": f"th-{eid}", "step": "1_0", "eaccount": "rep@send.example.com",
        "lead_id": "il-1", "is_auto_reply": 0,
    }
    e.update(kw)
    return e


def _settings():
    s = MagicMock()
    s.instantly_enabled = True
    s.instantly_api_key = "k"
    s.instantly_mail_cursor = None
    return s


def _provider(received=(), sent=(), pages=None):
    """list_unibox_emails answers by email_type; `pages` overrides with a call-ordered list."""
    p = MagicMock()
    calls = []

    def fake(**kw):
        calls.append(kw)
        if pages is not None:
            r = pages[len(calls) - 1]
            if isinstance(r, Exception):
                raise r
            return r
        items = list(received if kw["email_type"] == "received" else sent)
        return {"items": items, "next_starting_after": None}
    p.list_unibox_emails.side_effect = fake
    p.calls = calls
    return p


def _run(db, provider, settings=None):
    from scheduled_jobs import _instantly_mail_sync_job
    settings = settings or _settings()
    with patch("database.SessionLocal", return_value=db), patch.object(db, "close"), \
            patch("dialer_service._get_settings", return_value=settings), \
            patch("instantly_provider.InstantlyProvider", return_value=provider), \
            patch("time.sleep"):
        return _instantly_mail_sync_job(), settings


def _rows(db, lead_id=None):
    q = db.query(models.LeadEmailActivity).filter(models.LeadEmailActivity.instantly_email_id.isnot(None))
    if lead_id:
        q = q.filter(models.LeadEmailActivity.lead_id == lead_id)
    return q.all()


def test_stores_a_reply_and_a_sent_email_with_everything_the_inbox_needs(db):
    lead = create_test_lead(db, email="jim@test.com")
    res, _ = _run(db, _provider(
        received=[_email("e-r1", ue=2, subject="Re: hello", body="Call me")],
        sent=[_email("e-s1", ue=3, subject="hello", body="Hi Jim", step="0_0")],
    ))
    assert res["ran"] is True and res["stored"] == 2
    reply = next(r for r in _rows(db, lead.id) if r.instantly_email_id == "e-r1")
    assert (reply.direction, reply.subject, reply.body_preview) == ("inbound", "Re: hello", "Call me")
    assert (reply.instantly_thread_id, reply.instantly_campaign_id, reply.instantly_eaccount, reply.source) == \
        ("th-e-r1", "camp-1", "rep@send.example.com", "instantly")
    sent = next(r for r in _rows(db, lead.id) if r.instantly_email_id == "e-s1")
    assert (sent.direction, sent.instantly_step, sent.is_auto_reply) == ("outbound", 0, False)
    assert sent.to_email == "jim@test.com"


def test_a_second_run_over_the_same_window_adds_nothing(db):
    create_test_lead(db, email="jim@test.com")
    provider = _provider(received=[_email("e-r1")])
    _run(db, provider)
    res, _ = _run(db, provider)
    assert res["stored"] == 0 and len(_rows(db)) == 1


def test_the_unique_email_id_is_enforced_by_the_database(db):
    lead = create_test_lead(db, email="jim@test.com")
    for _ in range(2):
        db.add(models.LeadEmailActivity(lead_id=lead.id, direction="inbound", source="instantly", instantly_email_id="dup"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_the_watermark_advances_and_the_next_run_reads_from_it_minus_the_overlap(db):
    create_test_lead(db, email="jim@test.com")
    created = NOW - timedelta(hours=2)
    provider = _provider(received=[_email("e-r1", created=created)])
    _, settings = _run(db, provider)
    cursor = json.loads(settings.instantly_mail_cursor)
    assert abs(datetime.fromisoformat(cursor["received"]) - created) < timedelta(seconds=2)

    provider2 = _provider()
    _run(db, provider2, settings)
    first = next(c for c in provider2.calls if c["email_type"] == "received")
    assert first["sort_order"] == "asc"
    assert first["min_timestamp_created"] == _iso(created - timedelta(minutes=5))


def test_a_failed_page_keeps_the_watermark_of_the_last_good_page(db):
    create_test_lead(db, email="jim@test.com")
    page1 = {"items": [_email("e-r1", created=NOW - timedelta(hours=3))], "next_starting_after": "cur-1"}
    res, settings = _run(db, _provider(pages=[page1, RuntimeError("instantly 500")]))
    assert res["ran"] is False
    assert [r.instantly_email_id for r in _rows(db)] == ["e-r1"]          # page 1 is kept
    assert "received" in json.loads(settings.instantly_mail_cursor)
    assert "sent" not in json.loads(settings.instantly_mail_cursor)


def test_pagination_follows_the_cursor(db):
    create_test_lead(db, email="jim@test.com")
    page1 = {"items": [_email("e-1", created=NOW - timedelta(hours=3))], "next_starting_after": "c1"}
    page2 = {"items": [_email("e-2", created=NOW - timedelta(hours=2))], "next_starting_after": None}
    sent = {"items": [], "next_starting_after": None}
    provider = _provider(pages=[page1, page2, sent])
    res, _ = _run(db, provider)
    assert res["stored"] == 2 and provider.calls[1]["starting_after"] == "c1"


def test_scheduled_unmatched_and_missing_id_emails_are_not_stored(db):
    create_test_lead(db, email="jim@test.com")
    res, _ = _run(db, _provider(received=[
        _email("e-sched", ue=4), _email("e-nobody", lead="nobody@test.com"), _email(None),
    ]))
    assert res["stored"] == 0 and res["unmatched"] == 1 and _rows(db) == []


def test_out_of_office_replies_are_flagged_by_instantly_and_by_subject(db):
    lead = create_test_lead(db, email="jim@test.com")
    _run(db, _provider(received=[
        _email("e-ooo", subject="Out of office: back Monday"),
        _email("e-flag", subject="Re: hello", is_auto_reply=1),
        _email("e-real", subject="Re: hello"),
    ]))
    by_id = {r.instantly_email_id: r for r in _rows(db, lead.id)}
    assert (by_id["e-ooo"].is_auto_reply, by_id["e-flag"].is_auto_reply, by_id["e-real"].is_auto_reply) == (True, True, False)


def test_old_replies_are_stored_already_read_so_a_backfill_never_floods_the_bell(db):
    lead = create_test_lead(db, email="jim@test.com")
    _run(db, _provider(received=[
        _email("e-old", created=NOW - timedelta(days=10)), _email("e-new", created=NOW - timedelta(hours=2)),
    ]))
    by_id = {r.instantly_email_id: r for r in _rows(db, lead.id)}
    assert by_id["e-old"].read_at is not None and by_id["e-new"].read_at is None


def test_an_html_only_body_is_stored_as_plain_text(db):
    lead = create_test_lead(db, email="jim@test.com")
    e = _email("e-h")
    e["body"] = {"html": "<p>Hello&nbsp;Jim</p><p>Call <b>me</b></p><script>x()</script>"}
    _run(db, _provider(received=[e]))
    body = _rows(db, lead.id)[0].body_preview
    assert "Call me" in body and "<" not in body and "x()" not in body


def test_legacy_stub_and_poll_duplicate_are_replaced_by_the_real_email_keeping_read_state(db):
    """Before v13.8.0 a reply was stored twice (webhook stub with no subject,
    poll row with it) with no email id. The real row replaces both; a reply the
    rep had already cleared stays cleared."""
    lead = create_test_lead(db, email="jim@test.com")
    when = NOW - timedelta(hours=1)
    cleared = NOW - timedelta(minutes=30)
    db.add_all([
        models.LeadEmailActivity(lead_id=lead.id, direction="inbound", source="instantly", timestamp=when,
                                 instantly_campaign_id="camp-1"),
        models.LeadEmailActivity(lead_id=lead.id, direction="inbound", source="instantly", timestamp=when,
                                 subject="Re: hello", instantly_lead_id="il-1", instantly_campaign_id="camp-1",
                                 read_at=cleared),
    ])
    db.commit()
    _run(db, _provider(received=[_email("e-r1", created=when)]))
    inbound = db.query(models.LeadEmailActivity).filter_by(lead_id=lead.id, direction="inbound").all()
    assert len(inbound) == 1 and inbound[0].instantly_email_id == "e-r1" and inbound[0].read_at is not None


def test_a_legacy_reply_with_no_real_counterpart_is_left_alone(db):
    lead = create_test_lead(db, email="jim@test.com")
    db.add(models.LeadEmailActivity(lead_id=lead.id, direction="inbound", source="instantly",
                                    timestamp=NOW - timedelta(days=45), subject="old"))
    db.commit()
    _run(db, _provider(received=[_email("e-r1", created=NOW - timedelta(hours=1))]))
    assert db.query(models.LeadEmailActivity).filter_by(lead_id=lead.id, direction="inbound").count() == 2


def test_webhook_then_sync_leaves_exactly_one_reply_row(client, db):
    """The duplicate that started this: webhook row + poll row for one reply."""
    from test_instantly_webhook_routes import _settings as webhook_settings, _fire
    webhook_settings(db)
    lead = create_test_lead(db, email="a@example.com")
    assert _fire(client, "reply_received", lead.email).status_code == 200
    _run(db, _provider(received=[_email("e-r1", lead="a@example.com")]))
    assert db.query(models.LeadEmailActivity).filter_by(lead_id=lead.id, direction="inbound").count() == 1


def test_plan_without_the_emails_api_degrades_quietly(db):
    create_test_lead(db, email="jim@test.com")
    res, _ = _run(db, _provider(pages=[InstantlyPlanTierError("402")]))
    assert res["ran"] is False and "plan" in res["reason"].lower()


def test_noop_when_instantly_is_off(db):
    s = _settings()
    s.instantly_enabled = False
    res, _ = _run(db, _provider(), s)
    assert res == {"ran": False, "reason": "Instantly sync not enabled"}


def test_a_sent_email_with_no_lead_field_matches_on_a_list_of_recipients(db):
    lead = create_test_lead(db, email="jim@test.com")
    e = _email("e-s-list", ue=3, subject="hello")
    e.pop("lead")
    e["to_address_email_list"] = ["jim@test.com", "cc@test.com"]
    _run(db, _provider(sent=[e]))
    assert [r.instantly_email_id for r in _rows(db, lead.id)] == ["e-s-list"]


def test_an_out_of_office_does_not_resume_a_parked_instantly_step_as_replied(db):
    """The webhook-miss safety net reads these rows; an auto-reply isn't a reply."""
    from datetime import datetime, timezone
    from test_scheduled_jobs import TestResumeStalledInstantlyEnrollments as T
    from scheduled_jobs import _resume_stalled_instantly_enrollments
    t = T()
    e, lead = t._setup(db)
    jie = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id).one()
    db.add(models.LeadEmailActivity(lead_id=lead.id, direction="inbound", source="instantly", is_auto_reply=True,
                                    instantly_campaign_id=jie.instantly_campaign_id, timestamp=datetime.now(timezone.utc)))
    db.commit()
    _resume_stalled_instantly_enrollments(db, {})
    db.expire_all()
    assert db.query(models.JourneyInstantlyEnrollment).get(jie.id).status == "active"
