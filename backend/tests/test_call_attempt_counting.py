"""A call counts as ONE attempt on the lead.

Prod report: an AE saw "7 attempts" for a lead she had not called 7 times. Two
counters ran for the same physical call: handle_webhook (any outbound
CALL_ENDED, keyed on ended_at, which Aircall's call.hungup doesn't carry) and
_auto_log_outcome (any webhook with a mapped tag, inbound included). These
pin: first terminal event counts once, tags never count, inbound never counts,
log_call agrees with whoever got there first.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import models
from conftest import create_test_dialer_call, create_test_lead, create_test_user

PHONE = "+919876543210"


def _configure_aircall(db):
    s = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first() or models.SyncSettings(id=1)
    s.dialer_provider, s.dialer_api_id, s.dialer_api_token = "aircall", "id", "tok"
    db.add(s)
    db.commit()


def _webhook(db, event_type="CALL_ENDED", direction="outbound", call_id="CNT-1", tags=None, ended_at=None):
    from dialer_provider import CallEventType, NormalizedCallEvent
    from dialer_service import handle_webhook

    event = NormalizedCallEvent(
        event_type=getattr(CallEventType, event_type, event_type), provider="aircall",
        provider_call_id=call_id, phone_number=PHONE, direction=direction,
        user_email="sdr@test.com", raw_payload={}, tags=tags, ended_at=ended_at,
    )
    _configure_aircall(db)
    with patch("dialer_service._instantiate_provider") as mock_provider:
        provider = MagicMock()
        provider.handle_webhook.return_value = event
        mock_provider.return_value = provider
        return handle_webhook(db, "aircall", {})


def _lead(db):
    lead = create_test_lead(db, phone=PHONE, status="Calling")
    lead.call_attempt_count, lead.times_called = 0, 0
    db.commit()
    return lead


class TestWebhookCountsOnce:
    def test_tag_arriving_after_call_ended_counts_one_not_two(self, db):
        lead = _lead(db)
        _webhook(db)  # call.ended, no tags yet
        _webhook(db, tags=["Not Answered"])  # tag lands in a later delivery
        db.refresh(lead)
        assert lead.call_attempt_count == 1
        assert lead.times_called == 1

    def test_tagged_call_ended_counts_one(self, db):
        lead = _lead(db)
        result = _webhook(db, tags=["Not Answered"], ended_at=datetime.now(timezone.utc))
        assert result["auto_logged_outcome"] == "No Answer"
        db.refresh(lead)
        assert lead.call_attempt_count == 1

    def test_hungup_without_ended_at_then_call_ended_counts_one(self, db):
        lead = _lead(db)
        _webhook(db)  # call.hungup: CALL_ENDED, no ended_at
        _webhook(db, ended_at=datetime.now(timezone.utc))  # call.ended: same call, now with ended_at
        db.refresh(lead)
        assert lead.call_attempt_count == 1
        assert lead.times_called == 1

    def test_duplicate_call_ended_counts_one(self, db):
        lead = _lead(db)
        ended = datetime.now(timezone.utc)
        _webhook(db, ended_at=ended)
        _webhook(db, ended_at=ended)
        db.refresh(lead)
        assert lead.call_attempt_count == 1

    def test_inbound_tagged_call_counts_zero(self, db):
        lead = _lead(db)
        _webhook(db, direction="inbound", tags=["Not Answered"], ended_at=datetime.now(timezone.utc))
        db.refresh(lead)
        assert lead.call_attempt_count == 0
        assert lead.times_called == 0

    def test_two_different_outbound_calls_count_two(self, db):
        lead = _lead(db)
        _webhook(db, call_id="CNT-A")
        _webhook(db, call_id="CNT-B")
        db.refresh(lead)
        assert lead.call_attempt_count == 2


class TestLogCallAgreesWithWebhook:
    def _log(self, client, lead, dc=None, outcome="No Answer"):
        body = {"outcome": outcome, "notes": ""}
        if dc is not None:
            body["dialer_call_id"] = dc.id
        resp = client.post(f"/api/leads/{lead.id}/calls", json=body)
        assert resp.status_code == 200, resp.text

    def test_log_call_after_webhook_counts_one_total(self, client, db):
        create_test_user(db, email="admin@test.com")
        lead = _lead(db)
        _webhook(db)  # hungup path: status CALL_ENDED, ended_at still None
        dc = db.query(models.DialerCall).filter(models.DialerCall.provider_call_id == "CNT-1").one()
        assert dc.status == "CALL_ENDED" and dc.ended_at is None
        dc.user_id = "test-user-id"
        db.commit()

        self._log(client, lead, dc)

        db.refresh(lead)
        assert lead.call_attempt_count == 1

    def test_webhook_after_log_call_counts_one_total(self, client, db):
        create_test_user(db, email="admin@test.com")
        lead = _lead(db)
        dc = create_test_dialer_call(db, lead_id=lead.id, user_id="test-user-id", status="CALL_STARTED")
        dc.provider_call_id = "CNT-LOGFIRST"
        db.commit()

        self._log(client, lead, dc)  # SDR logs first: counts, closes the call
        db.refresh(lead)
        assert lead.call_attempt_count == 1
        _webhook(db, call_id="CNT-LOGFIRST")  # provider's call.ended lands afterwards
        db.refresh(lead)
        assert lead.call_attempt_count == 1

    def test_manual_log_call_without_webhook_counts_one(self, client, db):
        create_test_user(db, email="admin@test.com")
        lead = _lead(db)
        self._log(client, lead)
        db.refresh(lead)
        assert lead.call_attempt_count == 1
