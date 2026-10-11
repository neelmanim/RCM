"""Tests for services/lead_service.py — extracted from routes/lead_routes.py's
update_lead. Calls the service function directly (no FastAPI client, no HTTP)
to demonstrate it's testable independent of the route layer.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException
from conftest import create_test_lead, create_test_call, create_test_dialer_call, SDR_USER, SUPER_ADMIN
from services import lead_service


class TestUpdateLeadFields:

    def test_updates_allowed_fields(self, db):
        lead = create_test_lead(db, email="svc@t.com")
        changed = lead_service.update_lead_fields(
            db, lead, {"company": "NewCo", "first_name": "Updated"}, SDR_USER,
        )
        assert lead.company == "NewCo"
        assert lead.first_name == "Updated"
        assert changed is False  # no status field in the update

    def test_ignores_disallowed_fields(self, db):
        lead = create_test_lead(db, email="svc2@t.com")
        lead_service.update_lead_fields(db, lead, {"sf_lead_id": "should-not-change"}, SDR_USER)
        assert lead.sf_lead_id != "should-not-change"

    def test_blocks_backward_move_for_sdr(self, db):
        lead = create_test_lead(db, email="svc3@t.com", status="Meeting Scheduled")
        with pytest.raises(HTTPException) as exc:
            lead_service.update_lead_fields(db, lead, {"status": "Lead Assigned"}, SDR_USER)
        assert exc.value.status_code == 403

    def test_allows_backward_move_for_admin(self, db):
        lead = create_test_lead(db, email="svc4@t.com", status="Meeting Scheduled")
        changed = lead_service.update_lead_fields(db, lead, {"status": "Lead Assigned"}, SUPER_ADMIN)
        assert changed is True
        assert lead.status == "Lead Assigned"

    def test_meeting_scheduled_requires_a_logged_call(self, db):
        lead = create_test_lead(db, email="svc5@t.com", status="Calling")  # no calls logged
        with pytest.raises(HTTPException) as exc:
            lead_service.update_lead_fields(db, lead, {"status": "Meeting Scheduled"}, SDR_USER)
        assert exc.value.status_code == 422

    def test_adding_phone_to_parked_lead_unparks_it(self, db):
        lead = create_test_lead(db, email="svc6@t.com", status="No Phone - Parked", phone=None)
        changed = lead_service.update_lead_fields(db, lead, {"phone": "9876543210"}, SDR_USER)
        assert changed is True
        assert lead.status == "Lead Assigned"


class TestLoggedCallCount:

    def test_counts_manual_call_logs(self, db):
        lead = create_test_lead(db, email="calls@t.com")
        create_test_call(db, lead.id, "u1")
        assert lead_service.logged_call_count(db, lead.id) == 1

    def test_counts_dialer_calls_with_an_outcome(self, db):
        lead = create_test_lead(db, email="calls2@t.com")
        create_test_dialer_call(db, lead.id, "u1", outcome="Connected")
        assert lead_service.logged_call_count(db, lead.id) == 1

    def test_zero_when_no_calls_logged(self, db):
        lead = create_test_lead(db, email="calls3@t.com")
        assert lead_service.logged_call_count(db, lead.id) == 0

    def test_counts_an_answered_dialer_call_with_no_outcome_attached(self, db):
        """RCA 2026-09-03, reported from prod: the SDR had spoken to the lead
        but the outcome never got attached, so this gate told them "At least 1
        call must be logged" while the lead's Calls tab showed the call. An
        answered call is proof the call happened, which is all this counts."""
        from datetime import datetime, timezone
        lead = create_test_lead(db, email="calls4@t.com")
        call = create_test_dialer_call(db, lead.id, "u1")
        call.outcome = None
        call.answered_at = datetime.now(timezone.utc)
        db.commit()
        assert lead_service.logged_call_count(db, lead.id) == 1

    def test_an_unanswered_dialer_call_still_does_not_count(self, db):
        """The gate must still block: a lead that never picked up has not been
        spoken to, whatever the dial log says."""
        lead = create_test_lead(db, email="calls5@t.com")
        call = create_test_dialer_call(db, lead.id, "u1")
        call.outcome = None
        call.answered_at = None
        db.commit()
        assert lead_service.logged_call_count(db, lead.id) == 0

    def test_an_answered_call_with_an_outcome_counts_once_not_twice(self, db):
        from datetime import datetime, timezone
        lead = create_test_lead(db, email="calls6@t.com")
        call = create_test_dialer_call(db, lead.id, "u1", outcome="Connected")
        call.answered_at = datetime.now(timezone.utc)
        db.commit()
        assert lead_service.logged_call_count(db, lead.id) == 1
