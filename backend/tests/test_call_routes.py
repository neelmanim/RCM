"""Tests for routes/call_routes.py — Call logging, close-lead, SDR call summary."""
import sys, os
import threading
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, MagicMock

from conftest import (SUPER_ADMIN, 
    create_test_user, create_test_lead, create_test_call, create_sync_settings,
    create_nylas_config, create_user_mailbox, create_test_dialer_call,
)
import models


def _connect_mailbox(db, email="admin@test.com"):
    """Meeting Confirmed now hard-blocks without a connected mailbox (matches
    the auth override's fixed sub — see conftest.py's SUPER_ADMIN/client fixture)."""
    user = create_test_user(db, email=email)
    user.id = "test-user-id"
    db.commit()
    create_nylas_config(db)
    create_user_mailbox(db, user_id=user.id, email_address=email)
    return user


def _resp(status_code, json_data):
    """Fake httpx.Response for mocking nylas_calendar's module-level httpx calls."""
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = json_data
    r.text = str(json_data)
    return r


class TestLogCall:

    def test_log_valid_call(self, client, db):
        lead = create_test_lead(db, email="call@t.com")
        user = create_test_user(db, email="admin@test.com")  # match auth override sub
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "No Answer", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["call"]["outcome"] == "No Answer"

    def test_log_call_invalidates_leads_cache(self, client, db):
        # RCA 2026-08-25: logging a call mutates call_attempt_count/times_called/
        # priority_score but never busted my_leads/leads_count — the SDR's own
        # "My Leads" view could keep showing 0 calls until the cache's TTL
        # passed on its own.
        lead = create_test_lead(db, email="cachecall@t.com")
        create_test_user(db, email="admin@test.com")
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.post(f"/api/leads/{lead.id}/calls", json={"outcome": "No Answer", "notes": ""})
        assert resp.status_code == 200
        invalidated = {call.args[0] for call in mock_invalidate.call_args_list}
        assert {"my_leads", "leads_count", "leads_page"}.issubset(invalidated)

    def test_invalid_outcome_returns_400(self, client, db):
        lead = create_test_lead(db, email="badcall@t.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Hung Up", "notes": ""
        })
        assert resp.status_code == 400

    def test_call_completed_without_notes_maps_to_meeting_scheduled(self, client, db):
        """Legacy 'Call Completed' maps to 'Meeting Scheduled' which does NOT require notes."""
        lead = create_test_lead(db, email="nonotes@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Call Completed", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["call"]["outcome"] == "Meeting Scheduled"  # legacy mapped

    def test_meeting_confirmed_without_notes_returns_422(self, client, db):
        """Meeting Confirmed requires mandatory notes."""
        lead = create_test_lead(db, email="confnotes@t.com", status="Calling")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Meeting Confirmed", "notes": ""
        })
        assert resp.status_code == 422

    def test_call_completed_does_not_auto_move(self, client, db):
        """v4.0.2: 'Call Completed' → 'Meeting Scheduled' (tentative) — lead stays in Calling.
        Only 'Meeting Confirmed' outcome triggers auto-transition."""
        lead = create_test_lead(db, email="automove@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Call Completed", "notes": "Had a great conversation"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Calling"  # Tentative — stays in Calling

    def test_customer_declined_does_not_change_status(self, client, db):
        """Customer Declined (legacy → Not Interested) should NOT auto-transition the lead status."""
        lead = create_test_lead(db, email="declined@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Customer Declined", "notes": "Not interested in our services"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Calling"  # Status stays as Calling

    def test_unreachable_does_not_change_status(self, client, db):
        """Unreachable should NOT auto-transition the lead status (no disqualify action in config)."""
        lead = create_test_lead(db, email="unreach@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Unreachable", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Calling"  # Status stays as Calling

    def test_can_correct_an_already_logged_dialer_outcome(self, client, db):
        """RCA 2026-08-19: an outcome auto-logged (e.g. by Aircall AutoLog tag
        mapping) or previously mis-logged must be correctable — the SDR's
        explicit correction should overwrite DialerCall.outcome (what analytics
        reads), not silently create a second, separate CallLog."""
        lead = create_test_lead(db, email="correct@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        dc = create_test_dialer_call(
            db, lead_id=lead.id, user_id="test-user-id",
            status="CALL_ENDED", outcome="No Answer",  # wrong auto-tagged outcome
        )
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Call Back Later", "notes": "Actually connected", "dialer_call_id": dc.id,
        })
        assert resp.status_code == 200
        assert resp.json()["call"]["outcome"] == "Call Back Later"
        assert resp.json()["call"]["attached_to_dialer"] is True

        db.refresh(dc)
        assert dc.outcome == "Call Back Later"  # overwritten, not left stale

        # No duplicate manual CallLog created for this correction
        manual_logs = db.query(models.CallLog).filter(models.CallLog.lead_id == lead.id).count()
        assert manual_logs == 0

    def test_correcting_outcome_also_updates_the_paired_autolog_call_log(self, client, db):
        """The AutoLog CallLog created alongside a tag-mapped DialerCall (linked via
        CallLog.dialer_call_id) must be kept in sync on correction — otherwise the
        Calls tab shows two rows disagreeing on the outcome for the same call."""
        lead = create_test_lead(db, email="paired@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        dc = create_test_dialer_call(
            db, lead_id=lead.id, user_id="test-user-id",
            status="CALL_ENDED", outcome="No Answer",
        )
        paired = models.CallLog(lead_id=lead.id, user_id=None, outcome="No Answer",
                                 notes="[Auto-logged from Aircall tag: Not Answered]",
                                 dialer_call_id=dc.id)
        db.add(paired)
        db.commit()

        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Call Back Later", "notes": "Actually connected", "dialer_call_id": dc.id,
        })
        assert resp.status_code == 200

        db.refresh(paired)
        assert paired.outcome == "Call Back Later"

    def test_no_answer_increments_attempt_count(self, client, db):
        """All non-successful outcomes should increment call_attempt_count."""
        lead = create_test_lead(db, email="noanswer@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "No Answer", "notes": ""
        })
        assert resp.status_code == 200
        # Check the lead was updated
        db.refresh(lead)
        assert lead.call_attempt_count >= 1

    def test_times_called_not_double_counted_when_webhook_already_ended_the_call(self, client, db):
        """RCA 2026-08-21 (live): dialer_service.handle_webhook increments
        lead.times_called unconditionally on outbound CALL_ENDED. Submitting
        the outcome afterward must not increment it a second time here --
        call_attempt_count already had this exact guard (already_counted_by_
        webhook), but times_called two lines below it never got it. This
        counted every Aircall call twice once the outcome-modal SSE fix made
        the webhook-then-outcome-submit sequence complete reliably."""
        from datetime import datetime, timezone
        lead = create_test_lead(db, email="doublecount@t.com", status="Calling")
        lead.times_called = 0
        db.commit()
        create_test_user(db, email="admin@test.com")
        dc = create_test_dialer_call(
            db, lead_id=lead.id, user_id="test-user-id",
            status="CALL_ENDED", outcome=None,  # webhook set status, no outcome yet
        )
        # Simulate what dialer_service.handle_webhook already did for this call:
        # set ended_at and increment times_called once (dialer_service.py:1056-1058).
        dc.ended_at = datetime.now(timezone.utc)
        lead.times_called = 1
        db.commit()

        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Call Back Later", "notes": "", "dialer_call_id": dc.id,
        })
        assert resp.status_code == 200

        db.refresh(lead)
        assert lead.times_called == 1

    def test_logging_outcome_closes_out_a_still_active_dialer_call(self, client, db):
        """RCA 2026-09-01 (live production, reported by SDRs): initiate_call's
        "you already have an active call in progress" guard keys purely on
        DialerCall.status, cleared only by a provider webhook (or a 5-15min
        staleness timeout) -- never by the SDR finishing this outcome-log
        step. When the provider's webhook never lands on this row (a known,
        confirmed Aircall Everywhere embedded-window race), the SDR is
        blocked from their next dial even after logging the outcome in both
        the CRM pop-up and Aircall's own window. Logging an outcome must
        close out the call itself, independent of any webhook ever arriving."""
        lead = create_test_lead(db, email="stillactive@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")
        dc = create_test_dialer_call(
            db, lead_id=lead.id, user_id="test-user-id",
            status="CALL_STARTED", outcome=None,  # no webhook has fired yet
        )
        assert dc.ended_at is None

        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Call Back Later", "notes": "", "dialer_call_id": dc.id,
        })
        assert resp.status_code == 200

        db.refresh(dc)
        assert dc.status == "CALL_ENDED"
        assert dc.ended_at is not None

    def test_logging_outcome_does_not_touch_ended_at_already_set_by_a_webhook(self, client, db):
        """The fix above must be additive to the webhook path, not override
        it: if a webhook already set ended_at (the call's real end time),
        logging the outcome afterward must not overwrite it with "now"."""
        from datetime import datetime, timezone, timedelta
        lead = create_test_lead(db, email="webhookended@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")
        real_ended_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        dc = create_test_dialer_call(
            db, lead_id=lead.id, user_id="test-user-id",
            status="CALL_ENDED", outcome=None,
        )
        dc.ended_at = real_ended_at
        db.commit()

        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Call Back Later", "notes": "", "dialer_call_id": dc.id,
        })
        assert resp.status_code == 200

        db.refresh(dc)
        assert dc.status == "CALL_ENDED"
        # SQLite round-trips DateTime columns as naive — normalize before diffing.
        stored = dc.ended_at.replace(tzinfo=None) if dc.ended_at.tzinfo else dc.ended_at
        expected = real_ended_at.replace(tzinfo=None)
        assert abs((stored - expected).total_seconds()) < 1

    def test_lead_not_found_404(self, client):
        resp = client.post("/api/leads/fake-id/calls", json={
            "outcome": "No Answer", "notes": ""
        })
        assert resp.status_code == 404


class TestCloseLead:
    """Tests for POST /api/leads/{lead_id}/close — explicit lead disqualification."""

    def test_close_lead_with_valid_reason(self, client, db):
        lead = create_test_lead(db, email="close@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        # Create enough calls to meet max attempts
        for i in range(5):
            create_test_call(db, lead.id, user.id, "No Answer")
        lead.call_attempt_count = 5
        lead.max_call_attempts = 5
        db.commit()

        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Not Interested"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["lead_status"] == "Disqualified"
        assert data["closed_reason"] == "Not Interested"

    def test_close_lead_with_definitive_outcome(self, client, db):
        """Lead with Wrong Number outcome can be closed even without max attempts."""
        lead = create_test_lead(db, email="wrongnum@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        create_test_call(db, lead.id, user.id, "Wrong Number")
        lead.call_attempt_count = 1
        lead.max_call_attempts = 5
        db.commit()

        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Wrong Number"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"

    def test_close_lead_with_definitive_outcome_from_dialer_call(self, client, db):
        """Bug report: disqualifying a Wrong Number lead was blocked with 'reach
        5 call attempts' when the outcome was logged via the in-app dialer
        (DialerCall.outcome), not the manual-log CallLog — close_lead() only
        checked CallLog for a definitive outcome."""
        from conftest import create_test_dialer_call
        lead = create_test_lead(db, email="wrongnum-dialer@t.com", status="Calling")
        user = create_test_user(db, email="admin2@test.com")
        create_test_dialer_call(db, lead.id, user.id, outcome="Wrong Number")
        lead.call_attempt_count = 1
        lead.max_call_attempts = 5
        db.commit()

        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Wrong Number"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"

    def test_close_lead_requires_reason(self, client, db):
        lead = create_test_lead(db, email="noreason@t.com", status="Calling")
        resp = client.post(f"/api/leads/{lead.id}/close", json={})
        assert resp.status_code == 400  # Empty reason is invalid

    def test_close_lead_not_in_calling(self, client, db):
        """Cannot close a lead that's not in Calling status."""
        lead = create_test_lead(db, email="notcalling@t.com", status="Research")
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Not Interested"
        })
        assert resp.status_code == 422

    def test_close_already_disqualified(self, client, db):
        """Cannot close a lead that's already Disqualified."""
        lead = create_test_lead(db, email="alreadydq@t.com", status="Disqualified")
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Unreachable"
        })
        assert resp.status_code == 422

    # RCA 2026-08-17: stakeholder report "wrong-number disqualify not
    # working" — lead_detail.js offers the Disqualify button (incl. Wrong
    # Number) across 5 statuses, but close_lead() only accepted "Calling".
    def test_close_lead_from_meeting_scheduled_now_allowed(self, client, db):
        lead = create_test_lead(db, email="post-calling@t.com", status="Meeting Scheduled")
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Wrong Number"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"

    def test_close_lead_still_blocked_outside_disqualifiable_statuses(self, client, db):
        """Research is not one of the statuses the Disqualify button is ever
        shown for — must still be blocked, not just widened to everything."""
        lead = create_test_lead(db, email="research-close@t.com", status="Research")
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Wrong Number"
        })
        assert resp.status_code == 422

    def test_close_lead_with_definitive_reason_needs_no_prior_call_log(self, client, db):
        """The SDR explicitly choosing a terminal reason (Wrong Number) through
        this endpoint is itself the definitive outcome — it must not also
        require a separately-logged CallLog/DialerCall row with that same
        outcome, and must not require call_attempt_count to have caught up."""
        lead = create_test_lead(db, email="wrongnum-noattempt@t.com", status="Calling")
        assert lead.call_attempt_count in (0, None)
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Wrong Number"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"

    def test_close_lead_non_definitive_reason_still_needs_attempts(self, client, db):
        """"Other" is a valid close reason but not a terminal-group outcome,
        so it doesn't get the definitive-reason bypass — the attempts gate
        must still fire for it on a lead with 0 attempts and no call logged."""
        lead = create_test_lead(db, email="zero-attempts@t.com", status="Meeting Scheduled")
        lead.call_attempt_count = 0
        db.commit()
        # "Other" is an always-valid extra reason but not in the terminal
        # config group, so it doesn't get the definitive-reason bypass.
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Other"
        })
        assert resp.status_code == 422

    def test_close_lead_other_with_note_bypasses_attempts_gate(self, client, db):
        """RCA 2026-08-31: "Other: <note>" — an SDR explaining why through
        the free-text field — is as deliberate a choice as a real terminal
        outcome and must not need prior attempts either, unlike bare "Other"
        above."""
        lead = create_test_lead(db, email="other-with-note@t.com", status="Meeting Scheduled")
        lead.call_attempt_count = 0
        db.commit()
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Other: prospect confirmed via LinkedIn they left the company"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"


class TestGetCallLogs:

    def test_get_call_logs(self, client, db):
        user = create_test_user(db, email="calluser@t.com")
        lead = create_test_lead(db, email="calllead@t.com")
        create_test_call(db, lead.id, user.id, "No Answer")
        create_test_call(db, lead.id, user.id, "Left Voicemail")

        resp = client.get(f"/api/leads/{lead.id}/calls")
        assert resp.status_code == 200
        data = resp.json()
        # Response is now { calls: [...], stats: {...} }
        assert "calls" in data
        assert "stats" in data
        assert len(data["calls"]) == 2
        assert data["stats"]["total"] == 2

    def test_get_call_logs_lead_not_found(self, client):
        resp = client.get("/api/leads/nonexistent/calls")
        assert resp.status_code == 404


class TestDeleteCall:

    def test_delete_call(self, client, db):
        user = create_test_user(db, email="delcall@t.com")
        lead = create_test_lead(db, email="dellead@t.com")
        call = create_test_call(db, lead.id, user.id, "Wrong Number")

        resp = client.delete(f"/api/leads/{lead.id}/calls/{call.id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_nonexistent_call_404(self, client, db):
        lead = create_test_lead(db, email="delno@t.com")
        resp = client.delete(f"/api/leads/{lead.id}/calls/fake-call-id")
        assert resp.status_code == 404


class TestSdrCallSummary:

    def test_returns_call_stats(self, client, db):
        user = create_test_user(db, email="admin@test.com", role="SDR")
        user.id = "test-user-id"  # match the auth override sub
        db.commit()
        lead = create_test_lead(db, email="summ@t.com", status="Lead Assigned")
        user.assigned_leads.append(lead)
        db.commit()
        create_test_call(db, lead.id, user.id, "No Answer")

        resp = client.get("/api/sdr/call-summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_assigned"] >= 1
        assert data["total_calls_ever"] >= 1
        assert "outcomes_today" in data

    def test_summary_includes_disqualified_count(self, client, db):
        """SDR call summary should show disqualified lead count."""
        user = create_test_user(db, email="admin@test.com", role="SDR")
        user.id = "test-user-id"
        db.commit()
        lead_dq = create_test_lead(db, email="dq@t.com", status="Disqualified")
        user.assigned_leads.append(lead_dq)
        db.commit()

        resp = client.get("/api/sdr/call-summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("disqualified", 0) >= 1


# ═════════════════════════════════════════════════════════════════════════════
# Legacy Outcome Mapping (v4 migration — HIGH RISK)
# ═════════════════════════════════════════════════════════════════════════════

class TestLegacyOutcomeMapping:
    """Legacy outcomes must map to new values seamlessly."""

    def test_call_completed_maps_to_meeting_scheduled(self, client, db):
        """Legacy 'Call Completed' maps to 'Meeting Scheduled' outcome.
        But per v4.0.2, 'Meeting Scheduled' is tentative — lead stays in Calling.
        Only 'Meeting Confirmed' auto-transitions the lead status."""
        lead = create_test_lead(db, email="legacy1@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Call Completed", "notes": "Good conversation"
        })
        assert resp.status_code == 200
        assert resp.json()["call"]["outcome"] == "Meeting Scheduled"
        assert resp.json()["lead_status"] == "Calling"  # v4.0.2: tentative, no auto-transition

    def test_customer_declined_maps_to_not_interested(self, client, db):
        lead = create_test_lead(db, email="legacy2@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Customer Declined", "notes": "Not interested"
        })
        assert resp.status_code == 200
        assert resp.json()["call"]["outcome"] == "Not Interested"

    def test_callback_scheduled_maps_to_call_back_later(self, client, db):
        lead = create_test_lead(db, email="legacy3@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Callback Scheduled", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["call"]["outcome"] == "Call Back Later"


class TestNewOutcomes:
    """Tests for all new v4 call outcome values."""

    def test_meeting_confirmed_requires_notes(self, client, db):
        lead = create_test_lead(db, email="conf1@t.com", status="Calling")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Meeting Confirmed", "notes": ""
        })
        assert resp.status_code == 422

    def test_meeting_confirmed_with_notes_succeeds(self, client, db):
        lead = create_test_lead(db, email="conf2@t.com", status="Calling")
        _connect_mailbox(db)
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Meeting Confirmed", "notes": "Calendar confirmed with AE"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Meeting Scheduled"

    def test_meeting_confirmed_captures_meeting_datetime(self, client, db):
        """Unified calendar: the date/time the SDR enters must be persisted as a
        real field, not just embedded prose inside notes."""
        lead = create_test_lead(db, email="conf3@t.com", status="Calling")
        _connect_mailbox(db)
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Meeting Confirmed", "notes": "Booked",
            "meeting_datetime": "2026-08-15T14:30:00+00:00",
        })
        assert resp.status_code == 200
        db.refresh(lead)
        assert lead.meeting_scheduled_at is not None
        assert lead.meeting_scheduled_at.month == 8 and lead.meeting_scheduled_at.day == 15

    def test_meeting_confirmed_captures_meeting_datetime_from_js_toisostring(self, client, db):
        """RCA-2026-07-17: the frontend sends JS's Date.toISOString(), which always
        ends in 'Z' — datetime.fromisoformat() can't parse that before Python 3.11
        (prod runs 3.10). Confirmed in prod: every 'Meeting Scheduled' lead had
        meeting_scheduled_at silently falling back to status_changed_at (or NULL for
        leads that reached the status after the one-time backfill migration ran),
        because this always raised and was silently swallowed."""
        lead = create_test_lead(db, email="conf3b@t.com", status="Calling")
        _connect_mailbox(db)
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Meeting Confirmed", "notes": "Booked",
            "meeting_datetime": "2026-08-15T14:30:00.000Z",
        })
        assert resp.status_code == 200
        db.refresh(lead)
        assert lead.meeting_scheduled_at is not None
        assert lead.meeting_scheduled_at.month == 8 and lead.meeting_scheduled_at.day == 15
        assert lead.meeting_scheduled_at.hour == 14 and lead.meeting_scheduled_at.minute == 30

    def test_meeting_confirmed_without_meeting_datetime_falls_back_to_status_changed_at(self, client, db):
        """Optional field — omitting it (e.g. an older caller) must not break the call.

        RCA 2026-09-24: meeting_scheduled_at used to stay NULL here, which made
        this exact transition invisible to Analytics Hub's meetings_scheduled
        metric (it filters on meeting_scheduled_at) even though the Leaderboard
        counted it correctly (it reads current status). Now falls back to
        status_changed_at, same convention as the v_backfill_meeting_scheduled_at
        migration for pre-existing leads.
        """
        lead = create_test_lead(db, email="conf4@t.com", status="Calling")
        _connect_mailbox(db)
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Meeting Confirmed", "notes": "Booked",
        })
        assert resp.status_code == 200
        db.refresh(lead)
        assert lead.meeting_scheduled_at == lead.status_changed_at


class TestMeetingConfirmedCalendarIntegration:
    """Real Nylas calendar event creation on "Meeting Confirmed" — the core
    feature. Nylas HTTP calls mocked via nylas_calendar's module-level httpx
    functions (same convention as test_nylas_calendar.py)."""

    def _post_meeting(self, client, lead_id, **extra):
        body = {"outcome": "Meeting Confirmed", "notes": "Booked",
                 "meeting_datetime": "2026-08-15T14:30:00+00:00"}
        body.update(extra)
        return client.post(f"/api/leads/{lead_id}/calls", json=body)

    def test_no_connected_mailbox_hard_blocks_with_no_partial_write(self, client, db):
        """Decision 3: no mailbox connected -> the whole outcome is rejected,
        not silently logged without a calendar event."""
        lead = create_test_lead(db, email="cal-noconn@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")  # no mailbox
        resp = self._post_meeting(client, lead.id)
        assert resp.status_code == 400
        assert "connect your email" in resp.json()["detail"].lower()
        db.refresh(lead)
        assert lead.status == "Calling"  # unchanged — no partial write
        assert lead.meeting_scheduled_at is None

    @patch("crypto.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.get")
    @patch("nylas_calendar.httpx.post")
    def test_successful_creation_sets_event_fields_and_flag(self, mock_post, mock_get, mock_decrypt, client, db):
        lead = create_test_lead(db, email="cal-ok@t.com", first_name="Jane", last_name="Doe",
                                 company="Acme", status="Calling")
        _connect_mailbox(db)
        mock_get.return_value = _resp(200, {"data": [{"id": "cal-1", "is_primary": True}]})
        mock_post.return_value = _resp(200, {"data": {"id": "evt-1", "html_link": "https://cal.example/evt-1"}})

        resp = self._post_meeting(client, lead.id)
        assert resp.status_code == 200
        body = resp.json()
        assert body["calendar_event_created"] is True
        assert body["calendar_error"] is None
        db.refresh(lead)
        assert lead.nylas_event_id == "evt-1"
        assert lead.calendar_event_url == "https://cal.example/evt-1"

        # Invite went to the lead's real email
        sent = mock_post.call_args.kwargs["json"]
        assert sent["participants"] == [{"email": "cal-ok@t.com", "name": "Jane Doe"}]

    @patch("crypto.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.get")
    def test_nylas_failure_does_not_lose_the_crm_update(self, mock_get, mock_decrypt, client, db):
        """Transient Nylas failure (mailbox IS connected) must not roll back
        the meeting — only flag that the invite failed."""
        lead = create_test_lead(db, email="cal-fail@t.com", status="Calling")
        _connect_mailbox(db)
        mock_get.side_effect = RuntimeError("network blip")

        resp = self._post_meeting(client, lead.id)
        assert resp.status_code == 200
        body = resp.json()
        assert body["calendar_event_created"] is False
        assert body["calendar_error"]
        assert body["lead_status"] == "Meeting Scheduled"
        db.refresh(lead)
        assert lead.status == "Meeting Scheduled"
        assert lead.meeting_scheduled_at is not None
        assert lead.nylas_event_id is None

    @patch("crypto.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.get")
    def test_401_marks_mailbox_error_for_next_attempt(self, mock_get, mock_decrypt, client, db):
        from nylas_calendar import NylasCalendarError
        lead = create_test_lead(db, email="cal-401@t.com", status="Calling")
        user = _connect_mailbox(db)
        mock_get.side_effect = NylasCalendarError("grant revoked", status_code=401)

        resp = self._post_meeting(client, lead.id)
        assert resp.status_code == 200
        assert resp.json()["calendar_event_created"] is False

        mailbox = db.query(models.UserMailbox).filter(models.UserMailbox.user_id == user.id).first()
        assert mailbox.status == "error"

    @patch("crypto.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.get")
    @patch("nylas_calendar.httpx.post")
    def test_lead_with_no_email_still_creates_event_without_participant(self, mock_post, mock_get, mock_decrypt, client, db):
        lead = create_test_lead(db, email=None, first_name="No", last_name="Email", status="Calling")
        _connect_mailbox(db)
        mock_get.return_value = _resp(200, {"data": [{"id": "cal-1", "is_primary": True}]})
        mock_post.return_value = _resp(200, {"data": {"id": "evt-3"}})

        resp = self._post_meeting(client, lead.id)
        assert resp.status_code == 200
        assert resp.json()["calendar_event_created"] is True
        sent = mock_post.call_args.kwargs["json"]
        assert sent["participants"] == []

    @patch("crypto.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.get")
    @patch("nylas_calendar.httpx.post")
    def test_duration_clamped_to_sane_range(self, mock_post, mock_get, mock_decrypt, client, db):
        """A raw API caller (not the dropdown-constrained UI) sending an
        out-of-range duration is clamped, not trusted blindly."""
        lead = create_test_lead(db, email="cal-dur@t.com", status="Calling")
        _connect_mailbox(db)
        mock_get.return_value = _resp(200, {"data": [{"id": "cal-1", "is_primary": True}]})
        mock_post.return_value = _resp(200, {"data": {"id": "evt-4"}})

        resp = self._post_meeting(client, lead.id, meeting_duration_minutes=99999)
        assert resp.status_code == 200
        sent = mock_post.call_args.kwargs["json"]
        duration_seconds = sent["when"]["end_time"] - sent["when"]["start_time"]
        assert duration_seconds == 480 * 60  # clamped to the max, not 99999 minutes

    @patch("crypto.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.get")
    @patch("nylas_calendar.httpx.post")
    def test_custom_title_and_agenda_used_in_event(self, mock_post, mock_get, mock_decrypt, client, db):
        lead = create_test_lead(db, email="cal-custom@t.com", first_name="Jane", last_name="Doe",
                                 company="Acme", status="Calling")
        _connect_mailbox(db)
        mock_get.return_value = _resp(200, {"data": [{"id": "cal-1", "is_primary": True}]})
        mock_post.return_value = _resp(200, {"data": {"id": "evt-5"}})

        resp = self._post_meeting(client, lead.id,
                                   meeting_title="Discovery Call: Acme x Alternate CRM",
                                   meeting_agenda="We'll cover current workflow and next steps.")
        assert resp.status_code == 200
        sent = mock_post.call_args.kwargs["json"]
        assert sent["title"] == "Discovery Call: Acme x Alternate CRM"
        assert sent["description"] == "We'll cover current workflow and next steps.\n\n— Booked via Alternate CRM by Test Admin"
        db.refresh(lead)
        assert lead.calendar_event_title == "Discovery Call: Acme x Alternate CRM"
        assert lead.calendar_event_agenda == "We'll cover current workflow and next steps."

    @patch("crypto.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.get")
    @patch("nylas_calendar.httpx.post")
    def test_blank_title_and_agenda_fall_back_to_defaults(self, mock_post, mock_get, mock_decrypt, client, db):
        lead = create_test_lead(db, email="cal-default@t.com", first_name="Jane", last_name="Doe",
                                 company="Acme", status="Calling")
        _connect_mailbox(db)
        mock_get.return_value = _resp(200, {"data": [{"id": "cal-1", "is_primary": True}]})
        mock_post.return_value = _resp(200, {"data": {"id": "evt-6"}})

        resp = self._post_meeting(client, lead.id)
        assert resp.status_code == 200
        sent = mock_post.call_args.kwargs["json"]
        assert sent["title"] == "Meeting: Jane Doe (Acme)"
        assert sent["description"] == "Booked via Alternate CRM by Test Admin"
        db.refresh(lead)
        assert lead.calendar_event_title == "Meeting: Jane Doe (Acme)"
        assert lead.calendar_event_agenda is None

    @patch("crypto.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.get")
    @patch("nylas_calendar.httpx.post")
    def test_whitespace_only_title_treated_as_blank(self, mock_post, mock_get, mock_decrypt, client, db):
        lead = create_test_lead(db, email="cal-ws@t.com", first_name="Jane", last_name="Doe",
                                 company="Acme", status="Calling")
        _connect_mailbox(db)
        mock_get.return_value = _resp(200, {"data": [{"id": "cal-1", "is_primary": True}]})
        mock_post.return_value = _resp(200, {"data": {"id": "evt-7"}})

        resp = self._post_meeting(client, lead.id, meeting_title="   ", meeting_agenda="   ")
        assert resp.status_code == 200
        sent = mock_post.call_args.kwargs["json"]
        assert sent["title"] == "Meeting: Jane Doe (Acme)"
        assert sent["description"] == "Booked via Alternate CRM by Test Admin"

    def test_not_interested_requires_notes(self, client, db):
        lead = create_test_lead(db, email="ni1@t.com", status="Calling")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Not Interested", "notes": ""
        })
        assert resp.status_code == 422

    def test_not_interested_with_notes_succeeds(self, client, db):
        lead = create_test_lead(db, email="ni2@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Not Interested", "notes": "Explicitly said no"
        })
        assert resp.status_code == 200
        assert resp.json()["call"]["outcome"] == "Not Interested"
        assert resp.json()["lead_status"] == "Calling"  # does NOT auto-transition

    def test_call_back_later_does_not_transition(self, client, db):
        lead = create_test_lead(db, email="cbl@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Call Back Later", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Calling"

    def test_text_me_does_not_transition(self, client, db):
        lead = create_test_lead(db, email="txtme@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Text Me", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Calling"

    def test_referred_someone_else_does_not_transition(self, client, db):
        lead = create_test_lead(db, email="referred@t.com", status="Calling")
        create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Referred Someone Else", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Calling"


class TestCloseLeadV4:
    """Close lead edge cases with updated outcome names."""

    def test_close_with_not_interested(self, client, db):
        """Close with 'Not Interested' (replaces 'Customer Declined')."""
        lead = create_test_lead(db, email="close_ni@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        create_test_call(db, lead.id, user.id, "Not Interested")
        lead.call_attempt_count = 1
        lead.max_call_attempts = 5
        db.commit()
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Not Interested"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"

    def test_old_customer_declined_reason_still_works(self, client, db):
        """Legacy 'Customer Declined' reason should still close a lead."""
        lead = create_test_lead(db, email="close_cd@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        # Log with legacy outcome that maps to Not Interested
        create_test_call(db, lead.id, user.id, "Not Interested")
        lead.call_attempt_count = 5
        lead.max_call_attempts = 5
        db.commit()
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Not Interested"
        })
        assert resp.status_code == 200


# ═════════════════════════════════════════════════════════════════════════════
# get_lead_calls — merged CallLog + DialerCall response
# ═════════════════════════════════════════════════════════════════════════════

def _create_dialer_call(db, lead_id, provider="aircall", outcome="No Answer",
                        notes="", duration=60, recording_url=None):
    """Helper: insert a DialerCall record directly into the in-memory DB."""
    dc = models.DialerCall(
        lead_id=lead_id,
        provider=provider,
        status="CALL_ENDED",
        outcome=outcome,
        notes=notes,
        duration=duration,
        recording_url=recording_url,
    )
    db.add(dc)
    db.commit()
    db.refresh(dc)
    return dc


class TestGetLeadCallsMerge:
    """GET /api/leads/{lead_id}/calls — merged manual + dialer call list."""

    def test_returns_only_manual_calls_when_no_dialer_calls(self, client, db):
        user = create_test_user(db, email="merge1user@t.com")
        lead = create_test_lead(db, email="merge1@t.com")
        create_test_call(db, lead.id, user.id, "No Answer")
        create_test_call(db, lead.id, user.id, "Left Voicemail")

        resp = client.get(f"/api/leads/{lead.id}/calls")
        assert resp.status_code == 200
        data = resp.json()
        assert "calls" in data and "stats" in data
        assert len(data["calls"]) == 2
        assert all(c["source"] == "manual" for c in data["calls"])

    def test_merges_manual_and_dialer_calls(self, client, db):
        user = create_test_user(db, email="merge2user@t.com")
        lead = create_test_lead(db, email="merge2@t.com")
        create_test_call(db, lead.id, user.id, "No Answer")
        _create_dialer_call(db, lead.id, provider="aircall", outcome="Interested")

        resp = client.get(f"/api/leads/{lead.id}/calls")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["calls"]) == 2
        sources = {c["source"] for c in data["calls"]}
        assert "manual" in sources
        assert "dialer" in sources

    def test_dialer_call_includes_recording_url(self, client, db):
        lead = create_test_lead(db, email="merge3@t.com")
        _create_dialer_call(db, lead.id, recording_url="https://recordings.example.com/call.mp3")

        resp = client.get(f"/api/leads/{lead.id}/calls")
        assert resp.status_code == 200
        dialer_entries = [c for c in resp.json()["calls"] if c.get("source") != "manual"]
        assert len(dialer_entries) == 1
        assert dialer_entries[0]["recording_url"] == "https://recordings.example.com/call.mp3"

    def test_dialer_call_includes_duration(self, client, db):
        lead = create_test_lead(db, email="merge4@t.com")
        _create_dialer_call(db, lead.id, duration=120)

        resp = client.get(f"/api/leads/{lead.id}/calls")
        assert resp.status_code == 200
        dialer_entries = [c for c in resp.json()["calls"] if c.get("source") != "manual"]
        # Field is now 'duration' (not 'duration_sec') to match frontend
        assert dialer_entries[0]["duration"] == 120

    def test_manual_calls_have_zero_duration(self, client, db):
        user = create_test_user(db, email="merge5user@t.com")
        lead = create_test_lead(db, email="merge5@t.com")
        create_test_call(db, lead.id, user.id, "No Answer")

        resp = client.get(f"/api/leads/{lead.id}/calls")
        assert resp.status_code == 200
        manual_entries = [c for c in resp.json()["calls"] if c["source"] == "manual"]
        assert manual_entries[0]["duration"] == 0

    def test_returns_empty_calls_for_lead_with_no_calls(self, client, db):
        lead = create_test_lead(db, email="merge6@t.com")
        resp = client.get(f"/api/leads/{lead.id}/calls")
        assert resp.status_code == 200
        data = resp.json()
        assert data["calls"] == []
        assert data["stats"]["total"] == 0

    def test_lead_not_found_returns_404(self, client):
        resp = client.get("/api/leads/nonexistent-lead-id/calls")
        assert resp.status_code == 404

    def test_stats_total_matches_call_count(self, client, db):
        """stats.total must equal len(calls) — this is what the frontend reads."""
        user = create_test_user(db, email="statsuser@t.com")
        lead = create_test_lead(db, email="stats1@t.com")
        create_test_call(db, lead.id, user.id, "No Answer")
        create_test_call(db, lead.id, user.id, "Left Voicemail")
        create_test_call(db, lead.id, user.id, "Call Back Later")

        resp = client.get(f"/api/leads/{lead.id}/calls")
        assert resp.status_code == 200
        data = resp.json()
        assert data["stats"]["total"] == len(data["calls"]) == 3

    def test_result_is_sorted_newest_first(self, client, db):
        """Entries with a called_at/created_at should appear newest-first."""
        from datetime import datetime, timedelta
        user = create_test_user(db, email="sort1user@t.com")
        lead = create_test_lead(db, email="sort1@t.com")

        older = models.CallLog(
            lead_id=lead.id, user_id=user.id, outcome="No Answer",
            called_at=datetime(2024, 1, 1, 9, 0, 0),
        )
        newer = models.CallLog(
            lead_id=lead.id, user_id=user.id, outcome="Left Voicemail",
            called_at=datetime(2024, 1, 2, 10, 0, 0),
        )
        db.add_all([older, newer])
        db.commit()

        resp = client.get(f"/api/leads/{lead.id}/calls")
        assert resp.status_code == 200
        data = resp.json()["calls"]
        assert len(data) == 2
        # Newest (Jan 2) should come first
        assert "2024-01-02" in data[0]["called_at"]
        assert "2024-01-01" in data[1]["called_at"]


# ═════════════════════════════════════════════════════════════════════════════
# get_sdr_call_summary — additional coverage
# ═════════════════════════════════════════════════════════════════════════════

class TestSdrCallSummaryExtended:
    """Extended tests for GET /api/sdr/call-summary."""

    def test_user_not_found_returns_404(self, client, db):
        """If the JWT sub doesn't match any User row, expect a 404."""
        # client fixture overrides get_current_user → {"sub": "test-user-id", ...}
        # but we deliberately do NOT create the user in the DB
        resp = client.get("/api/sdr/call-summary")
        assert resp.status_code == 404

    def test_all_status_buckets_are_present(self, client, db):
        """Response must include every documented status bucket."""
        user = create_test_user(db, email="admin@test.com", role="SDR")
        user.id = "test-user-id"
        db.commit()

        resp = client.get("/api/sdr/call-summary")
        assert resp.status_code == 200
        data = resp.json()
        for key in ("total_assigned", "lead_assigned", "calls_today",
                    "total_calls_ever", "calling", "callbacks_pending",
                    "meetings_scheduled", "research_pending", "disqualified",
                    "outcomes_today"):
            assert key in data, f"Missing key: {key}"

    def test_meeting_scheduled_bucket_counts_correctly(self, client, db):
        user = create_test_user(db, email="admin@test.com", role="SDR")
        user.id = "test-user-id"
        db.commit()
        for i in range(3):
            lead = create_test_lead(db, email=f"meeting{i}@t.com", status="Meeting Scheduled")
            user.assigned_leads.append(lead)
        db.commit()

        resp = client.get("/api/sdr/call-summary")
        assert resp.status_code == 200
        assert resp.json()["meetings_scheduled"] == 3

    def test_research_pending_bucket_counts_correctly(self, client, db):
        user = create_test_user(db, email="admin@test.com", role="SDR")
        user.id = "test-user-id"
        db.commit()
        for i in range(2):
            lead = create_test_lead(db, email=f"research{i}@t.com", status="Research")
            user.assigned_leads.append(lead)
        db.commit()

        resp = client.get("/api/sdr/call-summary")
        assert resp.status_code == 200
        assert resp.json()["research_pending"] == 2

    def test_outcomes_today_contains_all_configured_outcomes(self, client, db):
        """outcomes_today dict should have a key for every configured outcome value."""
        user = create_test_user(db, email="admin@test.com", role="SDR")
        user.id = "test-user-id"
        db.commit()

        resp = client.get("/api/sdr/call-summary")
        assert resp.status_code == 200
        outcomes_today = resp.json()["outcomes_today"]
        expected_keys = {o["value"] for o in models.get_outcome_config()}
        assert expected_keys == set(outcomes_today.keys())


class TestCallOutcomesEndpoint:
    """Tests for GET /api/call-outcomes — dynamic outcome configuration endpoint."""

    def test_returns_outcome_config(self, client, db):
        """Endpoint returns all outcomes with structure and enabled list."""
        resp = client.get("/api/call-outcomes")
        assert resp.status_code == 200
        data = resp.json()
        assert "outcomes" in data
        assert "enabled_outcomes" in data
        assert len(data["outcomes"]) > 0

    def test_each_outcome_has_required_fields(self, client, db):
        """Every outcome item must have value, group, action, enabled, notes_required."""
        resp = client.get("/api/call-outcomes")
        for o in resp.json()["outcomes"]:
            assert "value" in o, f"Missing 'value' in {o}"
            assert "group" in o, f"Missing 'group' in {o}"
            assert "action" in o, f"Missing 'action' in {o}"
            assert "enabled" in o, f"Missing 'enabled' in {o}"
            assert "notes_required" in o, f"Missing 'notes_required' in {o}"

    def test_left_the_company_in_outcomes(self, client, db):
        """Left the Company must be present in the outcome list."""
        resp = client.get("/api/call-outcomes")
        values = [o["value"] for o in resp.json()["outcomes"]]
        assert "Left the Company" in values

    def test_enabled_outcomes_subset_of_all(self, client, db):
        """Enabled outcomes should be a subset of all outcomes."""
        resp = client.get("/api/call-outcomes")
        data = resp.json()
        all_values = {o["value"] for o in data["outcomes"]}
        enabled_values = {o["value"] for o in data["enabled_outcomes"]}
        assert enabled_values.issubset(all_values)

    def test_meeting_confirmed_has_meeting_scheduled_action(self, client, db):
        """Meeting Confirmed must have action=meeting_scheduled."""
        resp = client.get("/api/call-outcomes")
        mc = next((o for o in resp.json()["outcomes"] if o["value"] == "Meeting Confirmed"), None)
        assert mc is not None
        assert mc["action"] == "meeting_scheduled"

    def test_left_company_has_disqualify_action(self, client, db):
        """Left the Company must have action=disqualify."""
        resp = client.get("/api/call-outcomes")
        ltc = next((o for o in resp.json()["outcomes"] if o["value"] == "Left the Company"), None)
        assert ltc is not None
        assert ltc["action"] == "disqualify"
        assert ltc["group"] == "terminal"


class TestLeftTheCompany:
    """Tests for the 'Left the Company' auto-disqualification flow."""

    def test_left_company_auto_disqualifies(self, client, db):
        """Logging 'Left the Company' should auto-transition lead to Disqualified."""
        lead = create_test_lead(db, email="ltc@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Left the Company", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"

    def test_left_company_sets_closed_reason(self, client, db):
        """Closed reason should be set to 'Left the Company' on auto-DQ."""
        lead = create_test_lead(db, email="ltc-reason@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Left the Company", "notes": ""
        })
        db.refresh(lead)
        assert lead.status == "Disqualified"
        assert lead.closed_reason == "Left the Company"
        assert lead.lead_closed_at is not None

    def test_left_company_does_not_dq_already_terminal(self, client, db):
        """If lead is already in a terminal status, Left the Company should NOT change it."""
        lead = create_test_lead(db, email="ltc-terminal@t.com", status="Disqualified")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Left the Company", "notes": ""
        })
        assert resp.status_code == 200
        # Should remain Disqualified, not re-disqualify
        assert resp.json()["lead_status"] == "Disqualified"

    def test_left_company_from_research_status(self, client, db):
        """Left the Company from Research status should auto-DQ."""
        lead = create_test_lead(db, email="ltc-research@t.com", status="Research")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Left the Company", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"


class TestConfigDrivenNotes:
    """Tests for config-driven mandatory notes enforcement."""

    def test_meeting_confirmed_requires_notes(self, client, db):
        """Meeting Confirmed (notes_required=true in config) should reject empty notes."""
        lead = create_test_lead(db, email="mc-notes@t.com", status="Calling")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Meeting Confirmed", "notes": ""
        })
        assert resp.status_code == 422

    def test_meeting_confirmed_with_notes_succeeds(self, client, db):
        """Meeting Confirmed with notes should succeed."""
        lead = create_test_lead(db, email="mc-ok@t.com", status="Calling")
        _connect_mailbox(db)
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Meeting Confirmed", "notes": "Confirmed for next Tuesday"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Meeting Scheduled"

    def test_not_interested_requires_notes(self, client, db):
        """Not Interested (notes_required=true in config) should reject empty notes."""
        lead = create_test_lead(db, email="ni-notes@t.com", status="Calling")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Not Interested", "notes": ""
        })
        assert resp.status_code == 422

    def test_not_interested_with_notes_succeeds(self, client, db):
        """Not Interested with notes should succeed and NOT auto-DQ."""
        lead = create_test_lead(db, email="ni-ok@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Not Interested", "notes": "They have a competing solution"
        })
        assert resp.status_code == 200
        # Not Interested has action=none — it should NOT auto-DQ
        assert resp.json()["lead_status"] == "Calling"

    def test_no_answer_does_not_require_notes(self, client, db):
        """No Answer (notes_required=false) should succeed with empty notes."""
        lead = create_test_lead(db, email="na-nonotes@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "No Answer", "notes": ""
        })
        assert resp.status_code == 200

    def test_left_company_does_not_require_notes(self, client, db):
        """Left the Company (notes_required=false) should succeed without notes."""
        lead = create_test_lead(db, email="ltc-nonotes@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Left the Company", "notes": ""
        })
        assert resp.status_code == 200


class TestCloseLeadLeftCompany:
    """Tests for close_lead with the new 'Left the Company' reason."""

    def test_close_lead_with_left_company_reason(self, client, db):
        """Left the Company should be a valid close reason."""
        lead = create_test_lead(db, email="close-ltc@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        create_test_call(db, lead.id, user.id, "Left the Company")
        lead.call_attempt_count = 1
        lead.max_call_attempts = 5
        db.commit()

        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Left the Company"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"
        assert resp.json()["closed_reason"] == "Left the Company"

    def test_invalid_close_reason_rejected(self, client, db):
        """An invalid reason should return 400."""
        lead = create_test_lead(db, email="close-bad@t.com", status="Calling")
        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Bored Of Calling"
        })
        assert resp.status_code == 400


# ── Phase 2: DB-stored outcome config in call routes ─────────────────────────

class TestCallOutcomesFromDB:
    """Phase 2 tests: call-outcomes API and log_call respect DB-stored config."""

    def test_call_outcomes_returns_db_config(self, client, db):
        """GET /api/call-outcomes should return DB-stored config when present."""
        import json
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Competitor Using", "group": "terminal", "action": "none",
             "notes_required": True, "builtin": False, "enabled": True},
        ]
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        resp = client.get("/api/call-outcomes")
        assert resp.status_code == 200
        values = {o["value"] for o in resp.json()["outcomes"]}
        assert "Competitor Using" in values
        # Builtins still present via merge
        assert "No Answer" in values

    def test_call_outcomes_returns_default_when_no_db_config(self, client, db):
        """GET /api/call-outcomes returns DEFAULT_OUTCOME_CONFIG when DB is NULL."""
        create_sync_settings(db)  # outcome_config is NULL
        resp = client.get("/api/call-outcomes")
        assert resp.status_code == 200
        values = {o["value"] for o in resp.json()["outcomes"]}
        default_values = {o["value"] for o in models.DEFAULT_OUTCOME_CONFIG}
        assert values == default_values

    def test_meeting_scheduled_outcome_is_not_offered_to_sdrs(self, client, db):
        """RCA 2026-09-29: 'Meeting Scheduled' (action none) sat next to the
        'Meeting Booked' card as a lookalike chip — picking it logged a meeting
        that never advanced the lead. Only the status-advancing 'Meeting
        Confirmed' may be offered; 'Meeting Scheduled' stays valid for history."""
        create_sync_settings(db)
        data = client.get("/api/call-outcomes").json()
        enabled = {o["value"] for o in data["enabled_outcomes"]}
        assert "Meeting Scheduled" not in enabled
        assert "Meeting Confirmed" in enabled
        assert "Meeting Scheduled" in models.get_valid_outcomes(db)
        # Every enabled "meeting"-sounding outcome must actually advance the lead.
        for o in data["enabled_outcomes"]:
            if "meeting" in o["value"].lower():
                assert o["action"] == "meeting_scheduled", o

    def test_saved_outcome_config_cannot_re_enable_the_lookalike(self, client, db):
        """RCA 2026-09-29 (staging Playwright): a saved outcome_config copied from
        the old defaults kept 'Meeting Scheduled' enabled, so the chip came back."""
        import json
        s = create_sync_settings(db)
        s.outcome_config = json.dumps([dict(o, enabled=True) for o in models.DEFAULT_OUTCOME_CONFIG])
        db.commit()
        enabled = {o["value"] for o in client.get("/api/call-outcomes").json()["enabled_outcomes"]}
        assert "Meeting Scheduled" not in enabled
        assert "Meeting Confirmed" in enabled

    def test_log_call_respects_db_notes_override(self, client, db):
        """If DB config overrides notes_required for an outcome, enforce it."""
        import json
        # Override: make 'No Answer' require notes
        custom_config = []
        for o in models.DEFAULT_OUTCOME_CONFIG:
            item = dict(o)
            if item["value"] == "No Answer":
                item["notes_required"] = True
            custom_config.append(item)
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        lead = create_test_lead(db, email="db-notes@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        # No Answer without notes should now fail (DB override)
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "No Answer", "notes": ""
        })
        assert resp.status_code == 422

    def test_log_call_with_custom_outcome_from_db(self, client, db):
        """SDR should be able to log a call with a custom outcome defined in DB."""
        import json
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Competitor Using", "group": "terminal", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        lead = create_test_lead(db, email="custom-outcome@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Competitor Using", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["call"]["outcome"] == "Competitor Using"

    def test_log_call_with_disabled_outcome_still_accepted(self, client, db):
        """A disabled outcome should still be accepted for backward compat
        (in case SDR had modal open before config change)."""
        import json
        custom_config = []
        for o in models.DEFAULT_OUTCOME_CONFIG:
            item = dict(o)
            if item["value"] == "Text Me":
                item["enabled"] = False
            custom_config.append(item)
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        lead = create_test_lead(db, email="disabled-outcome@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        # Disabled but still valid — SDR may have had old picker open
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Text Me", "notes": ""
        })
        assert resp.status_code == 200

    def test_log_call_custom_disqualify_outcome(self, client, db):
        """Custom outcome with action=disqualify should auto-DQ the lead."""
        import json
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Do Not Contact", "group": "terminal", "action": "disqualify",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        lead = create_test_lead(db, email="custom-dq@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Do Not Contact", "notes": ""
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"

    def test_close_lead_accepts_custom_terminal_outcome_as_reason(self, client, db):
        """close_lead should derive VALID_REASONS from config — custom terminal outcomes are valid."""
        import json
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Acquired By Competitor", "group": "terminal", "action": "disqualify",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        lead = create_test_lead(db, email="custom-close@t.com", status="Calling")
        user = create_test_user(db, email="admin@test.com")
        create_test_call(db, lead.id, user.id, "Acquired By Competitor")
        lead.call_attempt_count = 1
        lead.max_call_attempts = 5
        db.commit()

        resp = client.post(f"/api/leads/{lead.id}/close", json={
            "reason": "Acquired By Competitor"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_status"] == "Disqualified"



class TestRefreshRecordingUrlTranscriptBackfill:
    """_refresh_recording_url() also backfills DialerCall.transcript once
    Deepgram STT finishes (async, provider-side) — RCA 2026-07-22: it
    previously only backfilled recording_url/duration/ended_at and never
    looked at the provider's transcription field at all."""

    def _make_call(self, db, lead, user, transcript=None):
        from datetime import datetime, timezone
        call = models.DialerCall(
            lead_id=lead.id, user_id=user.id, provider="messenger",
            provider_call_id="conv-123", status="CALL_ENDED", direction="outbound",
            duration=20, answered_at=datetime.now(timezone.utc),
            ended_at=datetime.now(timezone.utc), recording_url="https://example.com/rec.mp3",
            transcript=transcript,
        )
        db.add(call)
        db.commit()
        db.refresh(call)
        return call

    def test_backfills_transcript_when_available(self, db):
        from routes.call_routes import _refresh_recording_url
        lead = create_test_lead(db, email="transcript1@t.com")
        user = create_test_user(db, email="transcript-sdr1@t.com")
        call = self._make_call(db, lead, user)

        class _Provider:
            def fetch_call(self, provider_call_id):
                return {"transcription": {"transcription": [{"role": "Speaker 0", "content": "Hello"}]}}

        _refresh_recording_url(call, _Provider(), db)
        db.refresh(call)
        assert call.transcript is not None
        assert "Hello" in call.transcript

    def test_does_not_overwrite_existing_transcript(self, db):
        from routes.call_routes import _refresh_recording_url
        lead = create_test_lead(db, email="transcript2@t.com")
        user = create_test_user(db, email="transcript-sdr2@t.com")
        existing = '{"transcription": [{"role": "Speaker 0", "content": "original"}]}'
        call = self._make_call(db, lead, user, transcript=existing)

        class _Provider:
            def fetch_call(self, provider_call_id):
                return {"transcription": {"transcription": [{"role": "Speaker 0", "content": "DIFFERENT"}]}}

        _refresh_recording_url(call, _Provider(), db)
        db.refresh(call)
        assert call.transcript == existing  # untouched — backfill only fills a null transcript


class TestFetchApplySplit:
    """
    RCA 2026-07-27: activity_feed_routes.py's batch recording-URL refresh used
    to hold one DB session (a pooled connection) for its entire loop while
    calling the provider API — during a Alternate Messenger brownout (502 retries with
    time.sleep backoff), this starved the connection pool enough to make
    unrelated requests (e.g. dashboard-stats) time out. Fixed by splitting the
    provider fetch (no db needed) from the DB write (fast, short-lived
    session). This test proves the split combo produces the same result as
    the original combined _refresh_recording_url, and that fetch takes no db.
    """

    def test_fetch_takes_no_db_and_apply_produces_same_result(self, db):
        from routes.call_routes import _fetch_call_update_data, _apply_call_update_data
        lead = create_test_lead(db, email="split-fetch@t.com")
        user = create_test_user(db, email="split-fetch-sdr@t.com")
        call = models.DialerCall(
            lead_id=lead.id, user_id=user.id, provider="messenger",
            provider_call_id="conv-split-1", status="CALL_ENDED", direction="outbound",
            recording_url=None, duration=None, ended_at=None,
        )
        db.add(call)
        db.commit()
        db.refresh(call)

        class _Provider:
            def fetch_call(self, provider_call_id):
                return {"recording_url": "https://example.com/split.mp3", "duration": 55}

        # Fetch must succeed with no db session argument at all.
        call_data = _fetch_call_update_data(call, _Provider())
        assert call_data == {"recording_url": "https://example.com/split.mp3", "duration": 55}

        _apply_call_update_data(call, call_data, db)
        db.refresh(call)
        assert call.recording_url == "https://example.com/split.mp3"
        assert call.duration == 55

    def test_fetch_returns_none_when_nothing_needed(self, db):
        from routes.call_routes import _fetch_call_update_data
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        fresh_signed_url = (
            "https://example.com/fresh.mp3"
            f"?X-Amz-Date={now.strftime('%Y%m%dT%H%M%SZ')}&X-Amz-Expires=3600"
        )
        lead = create_test_lead(db, email="split-noop@t.com")
        user = create_test_user(db, email="split-noop-sdr@t.com")
        call = models.DialerCall(
            lead_id=lead.id, user_id=user.id, provider="messenger",
            provider_call_id="conv-split-2", status="CALL_ENDED", direction="outbound",
            recording_url=fresh_signed_url, duration=30,
            ended_at=now, transcript='{"already": "set"}',
        )
        db.add(call)
        db.commit()
        db.refresh(call)

        calls = {"n": 0}

        class _Provider:
            def fetch_call(self, provider_call_id):
                calls["n"] += 1
                return {"recording_url": "https://example.com/should-not-be-used.mp3"}

        assert _fetch_call_update_data(call, _Provider()) is None
        assert calls["n"] == 0, "Provider must not be called when nothing needs refreshing."


class TestLeadCallsRefreshFanOut:
    """
    RCA 2026-09-03 (self-inflicted staging outage, reproduced): GET
    /api/leads/{id}/calls spawned one background thread per DialerCall on the
    lead, each opening its OWN DB session and then making a provider API call
    *while holding that pooled connection*. Aircall's 429 backoff sleeps 10s
    doubling to 60s over 5 attempts, so a throttled thread could sit on a
    connection for ~150s. Opening ~18 leads in quick succession exhausted the
    pool and the whole app returned platform 502s — reachable by any SDR
    opening the Calls tab on a lead with many calls, and it degrades the app
    for everyone.

    These tests pin the two properties that make that impossible now: the
    refresh is bounded to the requested page, and no DB session is ever held
    across the provider call.
    """

    def _lead_with_calls(self, db, n, email):
        lead = create_test_lead(db, email=email)
        user = create_test_user(db, email=f"fanout-sdr-{email}")
        made = []
        for i in range(n):
            c = models.DialerCall(
                lead_id=lead.id, user_id=user.id, provider="aircall",
                provider_call_id=f"ac-fanout-{i}", status="CALL_ENDED",
                direction="outbound", recording_url=None, duration=None, ended_at=None,
            )
            db.add(c)
            made.append(c)
        db.commit()
        return lead, made

    def test_refresh_is_bounded_to_the_requested_page(self, db):
        """25 calls on the lead, page size 5 → at most 5 ids refreshed, not 25.
        Refreshing every call on the lead is what let one request fan out
        without bound."""
        from routes.call_routes import get_lead_calls
        lead, _ = self._lead_with_calls(db, 25, "fanout-page@t.com")

        seen = {}
        with patch("routes.call_routes._refresh_calls_in_background") as mock_bg:
            resp = get_lead_calls(lead_id=lead.id, page=1, limit=5, db=db, user=SUPER_ADMIN)
            seen["ids"] = mock_bg.call_args.args[0]

        assert len(resp["calls"]) == 5
        assert resp["total_count"] == 25
        assert len(seen["ids"]) <= 5, (
            f"Refresh must be bounded to the page; got {len(seen['ids'])} ids"
        )
        # And they must be exactly the dialer rows on this page.
        assert set(seen["ids"]) == {c["id"] for c in resp["calls"] if c["source"] == "dialer"}

    def test_no_db_session_is_held_across_the_provider_call(self, db):
        """The property that actually caused the outage: the provider's
        fetch_call must run with zero refresh-owned DB sessions open. Tested
        against _refresh_calls_now directly — racing a real background thread
        makes this unobservable (and the assertion silently vacuous)."""
        import routes.call_routes as cr
        import database, dialer_service
        lead, made = self._lead_with_calls(db, 3, "fanout-session@t.com")

        state = {"open": 0, "opens": 0, "max_during_fetch": 0}
        fetched = []
        real_session_local = database.SessionLocal

        class _TrackingSession:
            def __init__(self, inner):
                self._inner = inner
            def __getattr__(self, name):
                return getattr(self._inner, name)
            def close(self):
                state["open"] -= 1
                return self._inner.close()

        def _fake_session_local():
            state["open"] += 1
            state["opens"] += 1
            return _TrackingSession(real_session_local())

        class _Provider:
            def fetch_call(self, provider_call_id):
                state["max_during_fetch"] = max(state["max_during_fetch"], state["open"])
                fetched.append(provider_call_id)
                return {"recording_url": f"https://example.com/{provider_call_id}.mp3",
                        "duration": 12}

        with patch.object(database, "SessionLocal", _fake_session_local), \
             patch.object(dialer_service, "get_provider_by_name", return_value=_Provider()):
            cr._refresh_calls_now([c.id for c in made])

        # Non-vacuity: the patched SessionLocal really was used, the provider
        # really was called, and the writes really landed. Without these the
        # assertion below would pass just as happily on a no-op.
        assert state["opens"] >= 2, f"refresh opened {state['opens']} sessions"
        assert sorted(fetched) == sorted(c.provider_call_id for c in made)
        for c in made:
            db.refresh(c)
            assert c.recording_url == f"https://example.com/{c.provider_call_id}.mp3"
            assert c.duration == 12
        assert state["open"] == 0, "refresh leaked a DB session"

        assert state["max_during_fetch"] == 0, (
            "A DB connection was held while calling the provider — the exact "
            "pool-starvation shape that took staging down."
        )

    def test_one_thread_per_request_not_one_per_call(self, db):
        """The fan-out itself: 30 calls must still be one thread, not 30."""
        import routes.call_routes as cr
        started = []

        class _FakeThread:
            def __init__(self, target=None, args=(), daemon=None, **kw):
                self._target, self._args = target, args
            def start(self):
                started.append(self._args)

        with patch.object(cr.threading, "Thread", _FakeThread):
            cr._refresh_calls_in_background([f"id-{i}" for i in range(30)])

        assert len(started) == 1, f"expected 1 thread for the batch, got {len(started)}"
        assert len(started[0][0]) == 30, "the single thread must receive the whole batch"

    def test_empty_id_list_starts_no_thread(self, db):
        import routes.call_routes as cr
        before = threading.active_count()
        cr._refresh_calls_in_background([])
        assert threading.active_count() == before

    def test_calls_already_complete_are_not_refreshed(self, db):
        """EC-17 behaviour must survive the rework: a call with everything
        already backfilled must not be queued for a provider hit."""
        from datetime import datetime, timezone
        from routes.call_routes import get_lead_calls
        now = datetime.now(timezone.utc)
        fresh_signed_url = (
            "https://example.com/done.mp3"
            f"?X-Amz-Date={now.strftime('%Y%m%dT%H%M%SZ')}&X-Amz-Expires=3600"
        )
        lead = create_test_lead(db, email="fanout-complete@t.com")
        user = create_test_user(db, email="fanout-complete-sdr@t.com")
        db.add(models.DialerCall(
            lead_id=lead.id, user_id=user.id, provider="aircall",
            provider_call_id="ac-complete-1", status="CALL_ENDED", direction="outbound",
            recording_url=fresh_signed_url, duration=30,
            ended_at=datetime.now(timezone.utc).replace(tzinfo=None),
            transcript="already there",
        ))
        db.commit()

        with patch("routes.call_routes._refresh_calls_in_background") as mock_bg:
            get_lead_calls(lead_id=lead.id, page=1, limit=10, db=db, user=SUPER_ADMIN)
            assert mock_bg.call_args.args[0] == []
