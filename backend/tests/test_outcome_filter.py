"""
Tests for the outcome filter in lead_routes._apply_filters
and the _lead_to_summary serializer (XSS, last_call_outcome).

Bug #1 fixed: _apply_filters previously only queried CallLog for the
outcome filter — DialerCall-only leads were silently excluded.

Bug #2 fixed (v4.6.2): _apply_filters matched ANY historical call with the
requested outcome.  The fix uses a ranked subquery so only the *most recent*
call per lead is compared, preventing stale outcomes from surfacing.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import models
from conftest import create_test_user, create_test_lead, create_test_call


# ════════════════════════════════════════════════════════════════════════════════
# Outcome filter — _apply_filters (CallLog + DialerCall UNION)
# ════════════════════════════════════════════════════════════════════════════════

class TestOutcomeFilter:

    def test_filter_by_call_log_outcome(self, client, db):
        """Lead with a matching CallLog outcome appears; other outcomes don't."""
        user = create_test_user(db, email="oc_user@t.com")
        lead_match = create_test_lead(db, email="oc_match@t.com")
        lead_other = create_test_lead(db, email="oc_other@t.com")
        create_test_call(db, lead_match.id, user.id, outcome="Call Back Later")
        create_test_call(db, lead_other.id, user.id, outcome="No Answer")

        resp = client.get("/api/leads?outcome=Call+Back+Later")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead_match.id in ids
        assert lead_other.id not in ids

    def test_filter_by_dialer_call_outcome(self, client, db):
        """Lead with ONLY a DialerCall (no CallLog) must now appear — this was the bug."""
        lead_dialer = create_test_lead(db, email="dc_only@t.com")
        lead_other  = create_test_lead(db, email="dc_other@t.com")

        dc = models.DialerCall(
            lead_id=lead_dialer.id,
            provider="aircall",
            status="CALL_ENDED",
            outcome="Call Back Later",
        )
        db.add(dc)
        db.commit()

        resp = client.get("/api/leads?outcome=Call+Back+Later")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead_dialer.id in ids
        assert lead_other.id not in ids

    def test_filter_deduplicates_lead_with_both_sources(self, client, db):
        """Lead with both CallLog + DialerCall matching the same outcome appears exactly once."""
        user = create_test_user(db, email="both_src@t.com")
        lead = create_test_lead(db, email="both@t.com")
        create_test_call(db, lead.id, user.id, outcome="No Answer")

        dc = models.DialerCall(
            lead_id=lead.id,
            provider="rcm",
            status="CALL_ENDED",
            outcome="No Answer",
        )
        db.add(dc)
        db.commit()

        resp = client.get("/api/leads?outcome=No+Answer")
        assert resp.status_code == 200
        matching = [l for l in resp.json()["data"] if l["id"] == lead.id]
        assert len(matching) == 1, "Lead must appear exactly once (UNION de-dup)"

    def test_outcome_filter_no_match_returns_empty(self, client, db):
        create_test_lead(db, email="nomatch@t.com")
        resp = client.get("/api/leads?outcome=Meeting+Confirmed")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    def test_outcome_filter_multiple_leads_different_outcomes(self, client, db):
        """Only the lead whose outcome matches is returned."""
        user = create_test_user(db, email="multi_oc@t.com")
        l1 = create_test_lead(db, email="l1_oc@t.com")
        l2 = create_test_lead(db, email="l2_oc@t.com")
        l3 = create_test_lead(db, email="l3_oc@t.com")
        create_test_call(db, l1.id, user.id, outcome="Call Back Later")
        create_test_call(db, l2.id, user.id, outcome="No Answer")
        # l3 has no calls

        resp = client.get("/api/leads?outcome=Call+Back+Later")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert l1.id in ids
        assert l2.id not in ids
        assert l3.id not in ids

    def test_outcome_filter_via_my_leads(self, client_as_sdr, db):
        """Same UNION fix applies to /api/leads/my — DialerCall-only leads must appear."""
        sdr_db_user = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR", role="SDR")
        db.add(sdr_db_user)
        lead_dc = create_test_lead(db, email="mydc@t.com")
        sdr_db_user.assigned_leads.append(lead_dc)
        db.commit()

        dc = models.DialerCall(
            lead_id=lead_dc.id,
            provider="aircall",
            status="CALL_ENDED",
            outcome="Left Voicemail",
        )
        db.add(dc)
        db.commit()

        resp = client_as_sdr.get("/api/leads/my?outcome=Left+Voicemail")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead_dc.id in ids

    def test_dialer_outcome_not_returned_for_different_filter(self, client, db):
        """A lead with DialerCall outcome 'No Answer' must NOT appear when filtering 'Call Back Later'."""
        lead = create_test_lead(db, email="wrong_dc@t.com")
        dc = models.DialerCall(
            lead_id=lead.id,
            provider="aircall",
            status="CALL_ENDED",
            outcome="No Answer",
        )
        db.add(dc)
        db.commit()

        resp = client.get("/api/leads?outcome=Call+Back+Later")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id not in ids

    # ── New regression tests for Bug #2 (most-recent-only filter) ────────────

    def test_historical_outcome_does_not_match_filter(self, client, db):
        """
        REGRESSION: Amy Miller bug from screenshots.
        A lead that previously had 'Call Back Later' but whose MOST RECENT call
        is 'Meeting Confirmed' must NOT appear under the 'Call Back Later' filter.
        """
        from datetime import datetime, timezone, timedelta

        user = create_test_lead(db, email="history_user@t.com")
        lead = create_test_lead(db, email="amy_miller@t.com")

        # Older call — Call Back Later
        old_call = models.CallLog(
            lead_id=lead.id,
            outcome="Call Back Later",
            notes="",
            called_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        # Newer call — Meeting Confirmed
        new_call = models.CallLog(
            lead_id=lead.id,
            outcome="Meeting Confirmed",
            notes="",
            called_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        db.add_all([old_call, new_call])
        db.commit()

        resp = client.get("/api/leads?outcome=Call+Back+Later")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id not in ids, (
            "Lead with last_call='Meeting Confirmed' must NOT appear under 'Call Back Later' filter"
        )

    def test_most_recent_dialer_call_overrides_older_call_log(self, client, db):
        """
        When a DialerCall is newer than a CallLog, the DialerCall outcome wins.
        """
        from datetime import datetime, timezone, timedelta

        lead = create_test_lead(db, email="dialer_wins@t.com")

        # Older manual call — 'Call Back Later'
        old_call = models.CallLog(
            lead_id=lead.id,
            outcome="Call Back Later",
            notes="",
            called_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        # Newer DialerCall — 'No Answer'
        new_dc = models.DialerCall(
            lead_id=lead.id,
            provider="aircall",
            status="CALL_ENDED",
            outcome="No Answer",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        db.add_all([old_call, new_dc])
        db.commit()

        # Outcome filter for 'Call Back Later' must NOT include this lead
        resp = client.get("/api/leads?outcome=Call+Back+Later")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id not in ids, "DialerCall 'No Answer' should override older 'Call Back Later'"

        # Outcome filter for 'No Answer' MUST include it
        resp2 = client.get("/api/leads?outcome=No+Answer")
        assert resp2.status_code == 200
        ids2 = [l["id"] for l in resp2.json()["data"]]
        assert lead.id in ids2, "Lead's most-recent DialerCall 'No Answer' must match filter"

    def test_no_calls_lead_excluded_from_all_outcome_filters(self, client, db):
        """A lead with zero calls must not appear under ANY outcome filter."""
        lead = create_test_lead(db, email="no_calls@t.com")

        for outcome in ["Call Back Later", "Meeting Confirmed", "No Answer", "Unreachable"]:
            resp = client.get(f"/api/leads?outcome={outcome.replace(' ', '+')}")
            assert resp.status_code == 200
            ids = [l["id"] for l in resp.json()["data"]]
            assert lead.id not in ids, f"No-call lead must not appear under '{outcome}' filter"

    def test_meeting_confirmed_filter_correct_after_escalation(self, client, db):
        """
        Lead who went Call Back Later → Meeting Confirmed must appear under
        'Meeting Confirmed' and NOT 'Call Back Later'.
        """
        from datetime import datetime, timezone, timedelta

        lead = create_test_lead(db, email="escalation@t.com")

        db.add(models.CallLog(
            lead_id=lead.id, outcome="Call Back Later", notes="",
            called_at=datetime.now(timezone.utc) - timedelta(hours=3),
        ))
        db.add(models.CallLog(
            lead_id=lead.id, outcome="Meeting Confirmed", notes="",
            called_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        ))
        db.commit()

        resp_cbl = client.get("/api/leads?outcome=Call+Back+Later")
        assert resp_cbl.status_code == 200
        assert lead.id not in [l["id"] for l in resp_cbl.json()["data"]]

        resp_mc = client.get("/api/leads?outcome=Meeting+Confirmed")
        assert resp_mc.status_code == 200
        assert lead.id in [l["id"] for l in resp_mc.json()["data"]]


# ════════════════════════════════════════════════════════════════════════════════
# _lead_to_summary — last_call_outcome and XSS escaping
# ════════════════════════════════════════════════════════════════════════════════

class TestLeadToSummaryOutcome:

    def test_summary_returns_call_log_outcome(self, client, db):
        user = create_test_user(db, email="sumcl@t.com")
        lead = create_test_lead(db, email="sumcl_lead@t.com")
        create_test_call(db, lead.id, user.id, outcome="Meeting Scheduled")

        # _lead_to_summary is called for the admin list endpoint
        resp = client.get("/api/leads")
        assert resp.status_code == 200
        matched = next((l for l in resp.json()["data"] if l["id"] == lead.id), None)
        assert matched is not None
        assert matched["last_call_outcome"] == "Meeting Scheduled"

    def test_summary_no_calls_outcome_is_null(self, client, db):
        lead = create_test_lead(db, email="nocall_summ@t.com")
        resp = client.get("/api/leads")
        assert resp.status_code == 200
        matched = next((l for l in resp.json()["data"] if l["id"] == lead.id), None)
        assert matched is not None
        assert matched["last_call_outcome"] is None

    def test_summary_xss_escaped_in_latest_note(self, client, db):
        """Note content containing <script> must be HTML-escaped in the list summary."""
        lead = create_test_lead(db, email="xss@t.com")
        note = models.Note(
            lead_id=lead.id,
            content="<script>alert(1)</script>",
            author="SDR",
        )
        db.add(note)
        db.commit()

        resp = client.get("/api/leads")
        assert resp.status_code == 200
        leads_data = resp.json()["data"]
        matched = next((l for l in leads_data if l["id"] == lead.id), None)
        assert matched is not None
        note_content = (matched.get("latest_note") or {}).get("content", "")
        assert "<script>" not in note_content, "Raw <script> tag must not be present"
        assert "&lt;script&gt;" in note_content, "HTML-escaped form must be present"
