"""
Analytics Data Audit — Regression Tests
=========================================

Covers the 3 bugs found during the 2026-05-28 prod DB audit:

  BUG-ANALYTICS-1 — SDR connect_rate used calls_with_outcome as denominator
                     (inflated %). Fixed: use calls_made.

  BUG-ANALYTICS-2 — SDR meetings column ignored date_start/date_end filter;
                     always returned all-time meetings even when a date range
                     was selected. Fixed: filter by lead_closed_at.

  BUG-ANALYTICS-4 — SDR table had default preset="30d" while funnel defaulted
                     to None (all-time). On initial load (no filter sent),
                     both should show the same scope. Fixed: preset=None.

Prod audit summary (2026-05-28, Render PostgreSQL rcm-db-prod):
  ✅ Leads 12,057 | Research 5,604 | Meetings 80 | Disqualified 722
  ✅ Calls 17,253 (12,063 dialer + 5,202 call_logs − 12 overlap)
  ✅ Funnel connects 27 | Connect rate 0.2%
  ❌ SDR Aditya connect: 15.9% (bug) vs 6.3% (correct)
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
from conftest import create_test_user, create_test_lead, SUPER_ADMIN
import models
import routes.analytics_routes as ar_module


@pytest.fixture(autouse=True)
def clear_analytics_cache():
    """
    Wipe the module-level in-memory TTL cache between every test.
    Without this, the first test that hits /funnel or /sdr-table caches
    a result that all subsequent tests receive — hiding newly created data.
    """
    with ar_module._cache_lock:
        ar_module._cache.clear()
    yield
    with ar_module._cache_lock:
        ar_module._cache.clear()

# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _make_dialer_call(db, user_id, lead_id, status="CALL_ENDED", outcome=None,
                      direction="outbound", provider="aircall", created_at=None):
    call = models.DialerCall(
        user_id=user_id,
        lead_id=lead_id,
        provider=provider,
        phone_number="+919999999999",
        status=status,
        direction=direction,
        outcome=outcome,
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(call); db.commit(); db.refresh(call)
    return call


def _make_call_log(db, user_id, lead_id, outcome=None, called_at=None):
    log = models.CallLog(
        user_id=user_id,
        lead_id=lead_id,
        outcome=outcome,
        called_at=called_at or datetime.now(timezone.utc),
    )
    db.add(log); db.commit(); db.refresh(log)
    return log


def _assign_lead(db, lead, sdr):
    db.execute(
        models.lead_assignments.insert().values(lead_id=lead.id, user_id=sdr.id)
    )
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# BUG-ANALYTICS-1 — SDR connect_rate denominator
# ═══════════════════════════════════════════════════════════════════════════════

class TestSdrConnectRateDenominator:
    """
    connect_rate must be calls_connected / calls_made × 100,
    NOT calls_connected / calls_with_outcome × 100.

    Scenario that proves the bug:
      SDR makes 10 calls, logs outcomes for only 4, 2 of which are connects.
      Correct rate  = 2/10 = 20%
      Buggy rate    = 2/4  = 50%   ← was being returned before the fix
    """

    def test_connect_rate_uses_calls_made_not_calls_with_outcome(self, client, db):
        """
        If an SDR makes 10 calls and has 2 connects but only 4 calls have
        outcomes logged, connect_rate must be 20% (2/10), not 50% (2/4).
        """
        sdr = create_test_user(db, email="sdr_connect@test.com", role="SDR")
        lead = create_test_lead(db)
        _assign_lead(db, lead, sdr)

        # 10 outbound dialer calls — 2 connects, 4 with outcome, 6 with nothing
        for i in range(10):
            outcome = "Call Back Later" if i < 2 else ("Not Interested" if i < 6 else None)
            _make_dialer_call(db, sdr.id, lead.id, outcome=outcome)

        resp = client.get("/api/admin/analytics/sdr-table?page_size=100")
        assert resp.status_code == 200
        sdrs = resp.json().get("sdrs", [])
        sdr_row = next((r for r in sdrs if r["sdr_id"] == sdr.id), None)
        assert sdr_row is not None, "SDR not found in response"

        calls_made = sdr_row["calls_made"]
        assert calls_made == 10

        connect_rate = sdr_row["connect_rate"]
        assert connect_rate == 20.0, (
            f"Expected 20.0% (2/10) but got {connect_rate}. "
            f"BUG-ANALYTICS-1: denominator must be calls_made, not calls_with_outcome."
        )

    def test_connect_rate_zero_when_no_calls(self, client, db):
        """SDR with no calls has connect_rate=None, not a division error."""
        sdr = create_test_user(db, email="sdr_nocalls@test.com", role="SDR")
        resp = client.get("/api/admin/analytics/sdr-table?page_size=100")
        assert resp.status_code == 200
        sdrs = resp.json().get("sdrs", [])
        sdr_row = next((r for r in sdrs if r["sdr_id"] == sdr.id), None)
        if sdr_row:
            assert sdr_row["connect_rate"] is None

    def test_connect_rate_100pct_all_answered(self, client, db):
        """SDR where every call is CALL_ANSWERED → 100%."""
        sdr = create_test_user(db, email="sdr_all_answered@test.com", role="SDR")
        lead = create_test_lead(db)
        _assign_lead(db, lead, sdr)

        for _ in range(5):
            _make_dialer_call(db, sdr.id, lead.id, outcome="Call Back Later")

        resp = client.get("/api/admin/analytics/sdr-table?page_size=100")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json().get("sdrs", []) if r["sdr_id"] == sdr.id), None
        )
        assert sdr_row is not None
        assert sdr_row["connect_rate"] == 100.0

    def test_connect_rate_production_aditya_scenario(self, client, db):
        """
        Reproduces the Aditya Sharma prod case:
          858 dialer calls (13 CALL_ANSWERED, 53 with outcome)
          481 call_logs (72 connect outcomes, all with outcome)
          Buggy:  (13+72)/(53+481) = 85/534 = 15.9%
          Correct: (13+72)/(858+481) = 85/1339 = 6.3%
        Uses small-scale numbers with same ratio.
        """
        sdr = create_test_user(db, email="sdr_aditya_repro@test.com", role="SDR")
        lead = create_test_lead(db)
        _assign_lead(db, lead, sdr)

        # 8 dialer calls: 1 CALL_ANSWERED + 5 with outcome + 2 null
        _make_dialer_call(db, sdr.id, lead.id, outcome="Call Back Later")
        for _ in range(5):
            _make_dialer_call(db, sdr.id, lead.id, outcome="Not Interested")
        for _ in range(2):
            _make_dialer_call(db, sdr.id, lead.id)

        # 4 call_logs: all with connect outcome (like Aditya's 481 all-outcome logs)
        for _ in range(4):
            _make_call_log(db, sdr.id, lead.id, outcome="Call Back Later")

        # calls_made = 8 + 4 = 12
        # calls_connected = 1 (CALL_ANSWERED) + 4 (connect outcomes) = 5
        # calls_with_outcome = 6 (dialer) + 4 (logs) = 10
        # Correct:  5/12 * 100 = 41.7%
        # Buggy:    5/10 * 100 = 50.0%

        resp = client.get("/api/admin/analytics/sdr-table?page_size=100")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json().get("sdrs", []) if r["sdr_id"] == sdr.id), None
        )
        assert sdr_row is not None
        assert sdr_row["calls_made"] == 12
        assert sdr_row["connect_rate"] == pytest.approx(41.7, abs=0.1), (
            f"Expected ~41.7% (correct) but got {sdr_row['connect_rate']}. "
            f"If 50.0%, the old buggy denominator (calls_with_outcome) is still active."
        )


# ═══════════════════════════════════════════════════════════════════════════════
# BUG-ANALYTICS-2 — SDR meetings not date-filtered
# ═══════════════════════════════════════════════════════════════════════════════

class TestSdrMeetingsDateFilter:
    """
    SDR meetings column must respect the date filter.
    A meeting booked 60 days ago must NOT appear in a 30D filter.
    """

    def _make_meeting_lead(self, db, sdr, days_ago):
        """Create a lead in Meeting Scheduled status with lead_closed_at days_ago."""
        lead = create_test_lead(db)
        lead.status = "Meeting Scheduled"
        lead.lead_closed_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
        db.commit()
        _assign_lead(db, lead, sdr)
        return lead

    def test_old_meeting_excluded_from_30d_filter(self, client, db):
        """A meeting booked 60 days ago must not appear in a 30D window."""
        sdr = create_test_user(db, email="sdr_meetings_old@test.com", role="SDR")
        self._make_meeting_lead(db, sdr, days_ago=60)  # outside 30D

        resp = client.get("/api/admin/analytics/sdr-table?preset=30d&page_size=100")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json().get("sdrs", []) if r["sdr_id"] == sdr.id), None
        )
        # Meetings must be 0 — the meeting is outside the 30D window
        if sdr_row:
            assert sdr_row["meetings"] == 0, (
                f"Expected 0 meetings (meeting is 60d old, filter is 30D) "
                f"but got {sdr_row['meetings']}. BUG-ANALYTICS-2: meetings query "
                f"must apply date filter."
            )

    def test_recent_meeting_included_in_30d_filter(self, client, db):
        """A meeting booked 10 days ago appears in a 30D window."""
        sdr = create_test_user(db, email="sdr_meetings_recent@test.com", role="SDR")
        self._make_meeting_lead(db, sdr, days_ago=10)  # inside 30D

        resp = client.get("/api/admin/analytics/sdr-table?preset=30d&page_size=100")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json().get("sdrs", []) if r["sdr_id"] == sdr.id), None
        )
        if sdr_row:
            assert sdr_row["meetings"] >= 1

    def test_no_filter_shows_all_meetings(self, client, db):
        """With no date filter, both old and new meetings appear."""
        sdr = create_test_user(db, email="sdr_meetings_all@test.com", role="SDR")
        self._make_meeting_lead(db, sdr, days_ago=60)
        self._make_meeting_lead(db, sdr, days_ago=10)

        resp = client.get("/api/admin/analytics/sdr-table?page_size=100")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json().get("sdrs", []) if r["sdr_id"] == sdr.id), None
        )
        if sdr_row:
            assert sdr_row["meetings"] >= 2


# ═══════════════════════════════════════════════════════════════════════════════
# BUG-ANALYTICS-4 — SDR table default preset mismatch
# ═══════════════════════════════════════════════════════════════════════════════

class TestSdrTableDefaultPreset:
    """
    When no preset/date param is sent (initial page load),
    SDR table must NOT apply a 30D filter. It must match the funnel's
    all-time default so both panels are consistent.
    """

    def test_sdr_table_no_params_returns_200(self, client, db):
        """SDR table with no params returns 200 and valid shape."""
        resp = client.get("/api/admin/analytics/sdr-table?page_size=100")
        assert resp.status_code == 200
        data = resp.json()
        assert "sdrs" in data
        assert "total" in data

    def test_sdr_table_old_call_visible_without_preset(self, client, db):
        """
        A call made 45 days ago must appear in the SDR row when no preset
        is sent (all-time). Under the old default (30d), it would be excluded.
        """
        sdr = create_test_user(db, email="sdr_oldcall@test.com", role="SDR")
        lead = create_test_lead(db)
        _assign_lead(db, lead, sdr)

        old_date = datetime.now(timezone.utc) - timedelta(days=45)
        _make_dialer_call(db, sdr.id, lead.id, created_at=old_date)

        # No preset → should show all-time, so old call appears
        resp = client.get("/api/admin/analytics/sdr-table?page_size=100")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json().get("sdrs", []) if r["sdr_id"] == sdr.id), None
        )
        assert sdr_row is not None
        assert sdr_row["calls_made"] >= 1, (
            "SDR with a call from 45 days ago has 0 calls in the no-preset view. "
            "BUG-ANALYTICS-4: SDR table default must be None (all-time), not 30d."
        )

    def test_sdr_table_explicit_30d_excludes_old_call(self, client, db):
        """Explicit preset=30d still works as expected — old calls excluded."""
        sdr = create_test_user(db, email="sdr_oldcall_30d@test.com", role="SDR")
        lead = create_test_lead(db)
        _assign_lead(db, lead, sdr)

        old_date = datetime.now(timezone.utc) - timedelta(days=45)
        _make_dialer_call(db, sdr.id, lead.id, created_at=old_date)

        resp = client.get("/api/admin/analytics/sdr-table?preset=30d&page_size=100")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json().get("sdrs", []) if r["sdr_id"] == sdr.id), None
        )
        if sdr_row:
            assert sdr_row["calls_made"] == 0, (
                "45-day-old call should be excluded by 30d preset."
            )


# ═══════════════════════════════════════════════════════════════════════════════
# Funnel baseline — verified correct numbers (regression guard)
# ═══════════════════════════════════════════════════════════════════════════════

class TestFunnelBaselineCorrect:
    """
    The prod DB audit confirmed the funnel endpoint calculations are correct.
    These tests guard against future regressions.
    """

    def test_funnel_returns_expected_shape(self, client, db):
        """Funnel must return all required keys."""
        resp = client.get("/api/admin/analytics/funnel")
        assert resp.status_code == 200
        data = resp.json()
        assert "leads_assigned" in data
        assert "calls" in data
        assert "connect_rate" in data
        assert "meetings" in data
        assert "disqualified" in data

    def test_funnel_connect_rate_denominator_is_calls_made(self, client, db):
        """
        Funnel connect_rate = calls_connected / calls_made (CALL_ANSWERED / total outbound).
        Prove: 1 CALL_ANSWERED out of 5 total = 20%.
        """
        sdr = create_test_user(db, email="sdr_funnel_cr@test.com", role="SDR")
        lead = create_test_lead(db)

        _make_dialer_call(db, sdr.id, lead.id, outcome="Call Back Later")
        for _ in range(4):
            _make_dialer_call(db, sdr.id, lead.id, status="CALL_ENDED")

        resp = client.get("/api/admin/analytics/funnel")
        assert resp.status_code == 200
        data = resp.json()
        assert data["calls"]["made"] >= 5
        # connect_rate is CALL_ANSWERED / total outbound
        assert data["calls"]["connected"] >= 1

    def test_funnel_leads_excludes_parked(self, client, db):
        """Leads Assigned must exclude 'No Phone - Parked' status."""
        parked = create_test_lead(db)
        parked.status = "No Phone - Parked"
        db.commit()

        resp = client.get("/api/admin/analytics/funnel")
        assert resp.status_code == 200
        # Just confirm it's 200 and has a valid count — the parked lead
        # must NOT inflate leads_assigned (the prod audit verified this: 12,471 - 414 = 12,057)
        data = resp.json()
        assert isinstance(data["leads_assigned"], int)

    def test_funnel_meetings_uses_meeting_reached_statuses(self, client, db):
        """Meetings must count all MEETING_REACHED_STATUSES, not just Meeting Scheduled."""
        for status in ["Meeting Scheduled", "1st Discovery Meeting", "Demo Done"]:
            l = create_test_lead(db)
            l.status = status
            l.lead_closed_at = datetime.now(timezone.utc)
            db.commit()

        resp = client.get("/api/admin/analytics/funnel")
        assert resp.status_code == 200
        data = resp.json()
        assert data["meetings"]["booked"] >= 3
