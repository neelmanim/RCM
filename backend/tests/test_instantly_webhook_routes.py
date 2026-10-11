"""
test_instantly_webhook_routes.py — POST /webhooks/instantly (v13.3.0 Phase 3).

Covers: auth (missing/wrong secret -> 401), each event type's engine
routing (mocked InstantlyProvider/engine calls where a real Instantly HTTP
call would otherwise fire), idempotency on a replayed event, and the
stop_on_reply-parity assertion (same journey config, same exit behavior
whether the reply arrives via Nylas's handler or this one).
"""
import os
from unittest.mock import MagicMock, patch

os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

import json
import pytest
from datetime import datetime, timezone

import models
from journey_engine import engine as je
from conftest import create_test_lead

from test_cadence_playbook import _journey, _edges, _run, TRIGGER, WAIT

STEPS = [{"subject": "Hi {{first_name}}", "body": "Following up.", "delay_days": 0}]


def _instantly_journey(db, **settings):
    node = {"id": "i", "type": "instantly_sequence", "data": {"steps": STEPS}}
    return _journey(db, [TRIGGER, node, WAIT], _edges(("t", "i"), ("i", "w")), **settings)


def _settings(db, webhook_secret="whsec_test"):
    s = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not s:
        s = models.SyncSettings(id=1)
        db.add(s)
    s.instantly_api_key = "test-key"
    s.instantly_webhook_secret = webhook_secret
    db.commit()
    return s


def _enroll_and_park(db, journey, lead, campaign_id="camp-1", instantly_lead_id="ilead-1"):
    """Enroll + run the instantly_sequence node's 1st pass with a mocked
    provider, landing the enrollment parked on the node with an active
    JourneyInstantlyEnrollment — the state a live Instantly webhook would
    arrive against."""
    provider = MagicMock()
    provider.create_campaign.return_value = {"id": campaign_id}
    provider.add_lead_to_campaign.return_value = {"id": instantly_lead_id}
    with patch("instantly_provider.InstantlyProvider", return_value=provider):
        e = je.enroll_lead(db, journey, lead)
        e = _run(db, e)
    assert e.status == "active" and e.current_node_id == "i"
    return e


def _fire(client, event_type, lead_email, campaign_id="camp-1", secret="whsec_test", **extra):
    payload = {
        "event_type": event_type, "campaign_id": campaign_id,
        "lead_email": lead_email, "step": 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **extra,
    }
    headers = {"X-Webhook-Secret": secret} if secret is not None else {}
    return client.post("/webhooks/instantly", content=json.dumps(payload), headers=headers)


# ═══════════════════════════════════════════════════════════════════════════
# 1. Auth
# ═══════════════════════════════════════════════════════════════════════════

class TestInstantlyWebhookAuth:
    """conftest.py's autouse fixture pins SECURITY_WEBHOOK_MODE to "monitor"
    for the whole suite (test_security_access.py owns proving the enforce
    path generically) — these tests flip it to "enforce" locally, same
    convention test_dialer_routes.py's webhook tests already use, to assert
    the actual 401 rather than just the "would_refuse" log line."""

    def test_missing_secret_config_401(self, client, db, monkeypatch):
        monkeypatch.setenv("SECURITY_WEBHOOK_MODE", "enforce")
        lead = create_test_lead(db, email="a@example.com")
        resp = _fire(client, "email_opened", lead.email, secret="whatever")
        assert resp.status_code == 401

    def test_wrong_secret_401(self, client, db, monkeypatch):
        monkeypatch.setenv("SECURITY_WEBHOOK_MODE", "enforce")
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        resp = _fire(client, "email_opened", lead.email, secret="wrong-secret")
        assert resp.status_code == 401

    def test_missing_header_401(self, client, db, monkeypatch):
        monkeypatch.setenv("SECURITY_WEBHOOK_MODE", "enforce")
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        resp = _fire(client, "email_opened", lead.email, secret=None)
        assert resp.status_code == 401

    def test_correct_secret_200(self, client, db, monkeypatch):
        monkeypatch.setenv("SECURITY_WEBHOOK_MODE", "enforce")
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        resp = _fire(client, "email_opened", lead.email)
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════
# 2. Activity logging (open/click/reply) + unmatched lead
# ═══════════════════════════════════════════════════════════════════════════

class TestInstantlyWebhookActivityLogging:
    def test_email_opened_logs_activity(self, client, db):
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        resp = _fire(client, "email_opened", lead.email)
        assert resp.status_code == 200
        rows = db.query(models.LeadEmailActivity).filter(models.LeadEmailActivity.lead_id == lead.id).all()
        assert len(rows) == 1
        assert rows[0].source == "instantly" and rows[0].opened_at is not None

    def test_reply_received_writes_no_stub_row(self, client, db):
        """The webhook has no reply body, and the body-less row it used to write
        was never matched by the poll, so every reply showed up twice. The mail
        sync stores the real email; the webhook only routes the cadence."""
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        assert _fire(client, "reply_received", lead.email).status_code == 200
        assert db.query(models.LeadEmailActivity).filter(models.LeadEmailActivity.lead_id == lead.id).count() == 0

    def test_unmatched_email_is_a_harmless_noop(self, client, db):
        _settings(db)
        resp = _fire(client, "email_opened", "nobody@example.com")
        assert resp.status_code == 200
        assert db.query(models.LeadEmailActivity).count() == 0

    def test_replayed_event_is_idempotent(self, client, db):
        """Same payload (same timestamp) sent twice must not duplicate the
        LeadEmailActivity row — Instantly's webhook has no event id, so this
        is the only idempotency signal available."""
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        ts = datetime.now(timezone.utc).isoformat()
        payload = {
            "event_type": "email_link_clicked", "campaign_id": "camp-1",
            "lead_email": lead.email, "step": 1, "timestamp": ts,
        }
        headers = {"X-Webhook-Secret": "whsec_test"}
        r1 = client.post("/webhooks/instantly", content=json.dumps(payload), headers=headers)
        r2 = client.post("/webhooks/instantly", content=json.dumps(payload), headers=headers)
        assert r1.status_code == 200 and r2.status_code == 200
        assert db.query(models.LeadEmailActivity).filter(models.LeadEmailActivity.lead_id == lead.id).count() == 1


# ═══════════════════════════════════════════════════════════════════════════
# 3. Event -> engine routing
# ═══════════════════════════════════════════════════════════════════════════

class TestInstantlyWebhookRouting:
    def test_reply_received_resumes_enrollment(self, client, db):
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        journey = _instantly_journey(db)
        e = _enroll_and_park(db, journey, lead)

        resp = _fire(client, "reply_received", lead.email)
        assert resp.status_code == 200

        db.expire_all()
        e = db.query(models.JourneyEnrollment).get(e.id)
        jie = db.query(models.JourneyInstantlyEnrollment).filter(
            models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id).one()
        assert jie.status == "completed" and jie.end_reason == "replied"
        # Advanced past the instantly_sequence node (next in sequence: "w").
        assert e.current_node_id == "w"

    def test_lead_interested_resumes_with_interested_outcome(self, client, db):
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        journey = _instantly_journey(db)
        e = _enroll_and_park(db, journey, lead)

        resp = _fire(client, "lead_interested", lead.email)
        assert resp.status_code == 200

        db.expire_all()
        jie = db.query(models.JourneyInstantlyEnrollment).filter(
            models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id).one()
        assert jie.status == "completed" and jie.end_reason == "interested"

    def test_lead_meeting_booked_resumes_with_meeting_booked_outcome(self, client, db):
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        journey = _instantly_journey(db)
        e = _enroll_and_park(db, journey, lead)

        resp = _fire(client, "lead_meeting_booked", lead.email)
        assert resp.status_code == 200

        db.expire_all()
        jie = db.query(models.JourneyInstantlyEnrollment).filter(
            models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id).one()
        assert jie.status == "completed" and jie.end_reason == "meeting_booked"

    def test_campaign_completed_resumes_with_completed_outcome(self, client, db):
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        journey = _instantly_journey(db)
        e = _enroll_and_park(db, journey, lead)

        resp = _fire(client, "campaign_completed", lead.email)
        assert resp.status_code == 200

        db.expire_all()
        jie = db.query(models.JourneyInstantlyEnrollment).filter(
            models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id).one()
        assert jie.status == "completed" and jie.end_reason == "completed"

    def test_lead_unsubscribed_hard_stops_the_enrollment(self, client, db):
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        journey = _instantly_journey(db)
        e = _enroll_and_park(db, journey, lead)

        with patch("instantly_provider.InstantlyProvider") as MockProvider:
            MockProvider.return_value.remove_lead_from_campaign.return_value = {}
            resp = _fire(client, "lead_unsubscribed", lead.email)
        assert resp.status_code == 200

        db.expire_all()
        e = db.query(models.JourneyEnrollment).get(e.id)
        lead = db.query(models.Lead).get(lead.id)
        assert e.status == "exited_early" and e.exited_reason == "lead_unsubscribed"
        assert lead.unsubscribed_at is not None
        jie = db.query(models.JourneyInstantlyEnrollment).filter(
            models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id).one()
        assert jie.status == "exited"

    def test_email_bounced_hard_stops_without_setting_unsubscribed_at(self, client, db):
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        journey = _instantly_journey(db)
        e = _enroll_and_park(db, journey, lead)

        with patch("instantly_provider.InstantlyProvider") as MockProvider:
            MockProvider.return_value.remove_lead_from_campaign.return_value = {}
            resp = _fire(client, "email_bounced", lead.email)
        assert resp.status_code == 200

        db.expire_all()
        e = db.query(models.JourneyEnrollment).get(e.id)
        lead = db.query(models.Lead).get(lead.id)
        assert e.status == "exited_early" and e.exited_reason == "email_bounced"
        assert lead.unsubscribed_at is None

    def test_no_matching_enrollment_is_a_harmless_noop(self, client, db):
        """A lead with no active JourneyInstantlyEnrollment under this
        campaign_id -> activity still logged, no engine call blows up."""
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        resp = _fire(client, "lead_interested", lead.email)
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════
# 4. stop_on_reply parity with the Nylas webhook path
# ═══════════════════════════════════════════════════════════════════════════

class TestStopOnReplyParity:
    def test_instantly_reply_stops_the_journey_same_as_nylas_would(self, client, db):
        """Same journey config (stop_on_reply=True), same exit behavior
        regardless of which channel's webhook delivered the reply — the one
        behavior explicitly required to be indistinguishable from the
        existing Nylas path (webhook_routes.py's nylas_webhook_event, which
        calls check_exit_triggers(db, "email_replied", lead, commit=True))."""
        _settings(db)
        lead = create_test_lead(db, email="a@example.com")
        journey = _instantly_journey(db, stop_on_reply=True)
        e = _enroll_and_park(db, journey, lead)

        resp = _fire(client, "reply_received", lead.email)
        assert resp.status_code == 200

        db.expire_all()
        e = db.query(models.JourneyEnrollment).get(e.id)
        # journey.stop_on_reply ends the WHOLE enrollment wherever it is
        # parked — exactly what check_exit_triggers does for a Nylas reply.
        assert e.status == "exited_early" and e.exited_reason == "replied"
