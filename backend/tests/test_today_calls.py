"""
Tests for GET /api/my/today-calls — SDR Daily Call Tracker endpoint.

Covers:
  - TC-01: Response shape (date, summary, calls keys)
  - TC-02: recording_url present when set on DialerCall  ← BUG FIX REGRESSION GUARD
  - TC-03: recording_url=None on DialerCall → null in response
  - TC-04: Manual CallLog → recording_url always null
  - TC-05: User isolation — SDR sees only their own calls
  - TC-06: Date boundary — yesterday's calls excluded
  - TC-07: ?date=YYYY-MM-DD param returns the right day
  - TC-08: Mixed sources — manual + dialer both returned
  - TC-09: Multi-provider — aircall and rcm in same response
  - TC-10: Empty state — no calls today → calls=[], summary all zeros
  - TC-11: Invalid date format → 400
  - TC-12: DialerCall with started_at=None → excluded (not in today's window)
  - TC-13: lead_id=None (anonymous call) → no crash, lead_name=null
  - TC-14: recording_url="" (empty string) → no crash
  - TC-15: Summary outcome bucket counts correct
  - TC-16: DialerCall with outcome=None → "—" in response (no crash)
  - TC-17: Calls sorted newest-first when manual + dialer mixed
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient

from conftest import (
    create_test_user, create_test_lead, SUPER_ADMIN, SDR_USER,
    _build_test_app,
)
import models


# ── Helpers ──────────────────────────────────────────────────────────────────

def _today_utc():
    """Midnight UTC for today."""
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _make_dialer_call_today(
    db,
    user_id,
    *,
    lead_id=None,
    provider="aircall",
    outcome="No Answer",
    recording_url=None,
    started_at=None,
    duration=60,
):
    """DialerCall with started_at defaulting to 'this morning' so it
    falls within the today-calls date window (filter: started_at >= day_start)."""
    if started_at is None:
        started_at = _today_utc().replace(hour=9, minute=0, second=0)

    dc = models.DialerCall(
        user_id=user_id,
        lead_id=lead_id,
        provider=provider,
        direction="outbound",
        status="CALL_ENDED",
        outcome=outcome,
        duration=duration,
        recording_url=recording_url,
        phone_number="+10000000000",
        started_at=started_at,
    )
    db.add(dc)
    db.commit()
    db.refresh(dc)
    return dc


def _make_manual_call_today(db, user_id, *, lead_id=None, outcome="No Answer", called_at=None):
    """CallLog with called_at defaulting to today."""
    if called_at is None:
        called_at = _today_utc().replace(hour=10, minute=0, second=0)
    call = models.CallLog(
        lead_id=lead_id,
        user_id=user_id,
        outcome=outcome,
        called_at=called_at,
    )
    db.add(call)
    db.commit()
    db.refresh(call)
    return call


def _make_sdr_client(db, sdr_user_id, sdr_email="sdr@test.com"):
    """Build a TestClient authenticated as a specific SDR."""
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin

    app = _build_test_app()
    sdr_payload = {
        "sub": sdr_user_id,
        "email": sdr_email,
        "name": "Test SDR",
        "role": "SDR",
        "pod_id": None,
    }

    def _override_db():
        yield db

    def _deny_admin():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Admin access required")

    def _deny_super():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Super Admin access required")

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: sdr_payload
    app.dependency_overrides[require_admin] = _deny_admin
    app.dependency_overrides[require_super_admin] = _deny_super
    return TestClient(app)


# ── TC-01: Response Shape ────────────────────────────────────────────────────

class TestTodayCallsShape:

    def test_tc01_response_shape(self, db):
        """TC-01: Top-level keys date, summary, calls must all be present."""
        sdr = create_test_user(db, email="sdr_shape@tc.com", role="SDR")
        c = _make_sdr_client(db, sdr.id, sdr.email)
        resp = c.get("/api/my/today-calls")
        assert resp.status_code == 200
        data = resp.json()
        for key in ("date", "summary", "calls"):
            assert key in data, f"Missing key: {key}"

    def test_tc01b_summary_shape(self, db):
        """TC-01b: Summary must contain total, connected, no_answer, voicemail, callback, meeting, other."""
        sdr = create_test_user(db, email="sdr_sumshape@tc.com", role="SDR")
        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()
        for key in ("total", "connected", "no_answer", "voicemail", "callback", "meeting", "other"):
            assert key in data["summary"], f"Missing summary key: {key}"

    def test_tc01c_call_item_fields(self, db):
        """TC-01c: Each call item must have id, source, lead_id, lead_name, company,
        lead_status, outcome, duration_sec, notes, called_at, sdr_name, recording_url,
        phone_number."""
        sdr = create_test_user(db, email="sdr_fields@tc.com", role="SDR")
        lead = create_test_lead(db, email="lead@tc.com", first_name="Jane", last_name="Doe")
        _make_dialer_call_today(db, sdr.id, lead_id=lead.id,
                                recording_url="https://cdn.aircall.io/rec/test.mp3")
        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()
        assert data["calls"], "Expected at least one call"
        item = data["calls"][0]
        for field in ("id", "source", "lead_id", "lead_name", "company",
                      "lead_status", "outcome", "duration_sec", "notes",
                      "called_at", "sdr_name", "recording_url", "phone_number"):
            assert field in item, f"Missing field: {field}"
        assert item["lead_name"] == "Jane Doe"


# ── TC-02/03/04: recording_url field ────────────────────────────────────────

class TestTodayCallsRecordingUrl:

    def test_tc02_dialer_call_recording_url_returned(self, db):
        """TC-02 — REGRESSION GUARD: recording_url must be present in the
        response when set on a DialerCall. This was the bug — the field was
        omitted from the endpoint's response dict."""
        sdr = create_test_user(db, email="sdr_rec02@tc.com", role="SDR")
        _make_dialer_call_today(
            db, sdr.id,
            provider="aircall",
            recording_url="https://cdn.aircall.io/recordings/abc123.mp3",
        )
        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()

        assert data["calls"], "Expected a call in today's list"
        item = data["calls"][0]
        assert "recording_url" in item, "recording_url key must be present"
        assert item["recording_url"] == "https://cdn.aircall.io/recordings/abc123.mp3"

    def test_tc03_dialer_call_no_recording_returns_null(self, db):
        """TC-03: DialerCall with recording_url=None must yield null (not missing key)."""
        sdr = create_test_user(db, email="sdr_rec03@tc.com", role="SDR")
        _make_dialer_call_today(db, sdr.id, recording_url=None)
        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()

        item = next(i for i in data["calls"] if i["source"] in ("aircall", "rcm", "dialer"))
        assert "recording_url" in item, "recording_url key must be present even when null"
        assert item["recording_url"] is None

    def test_tc04_manual_call_recording_url_is_null(self, db):
        """TC-04: Manual CallLog entries never have a recording — recording_url must be null."""
        sdr = create_test_user(db, email="sdr_rec04@tc.com", role="SDR")
        lead = create_test_lead(db, email="lead04@tc.com")
        _make_manual_call_today(db, sdr.id, lead_id=lead.id)
        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()

        manual_calls = [i for i in data["calls"] if i["source"] == "manual"]
        assert manual_calls, "Expected at least one manual call"
        for item in manual_calls:
            assert item.get("recording_url") is None, \
                "Manual calls must never have a recording_url"

    def test_tc14_empty_string_recording_url_no_crash(self, db):
        """TC-14: recording_url='' (empty string written by some webhook edge cases)
        must not crash the endpoint and must be returned as empty string."""
        sdr = create_test_user(db, email="sdr_rec14@tc.com", role="SDR")
        _make_dialer_call_today(db, sdr.id, recording_url="")
        c = _make_sdr_client(db, sdr.id, sdr.email)
        resp = c.get("/api/my/today-calls")
        assert resp.status_code == 200
        # Just verify it doesn't crash — empty string is acceptable
        data = resp.json()
        assert data["calls"]


# ── TC-05: User Isolation ────────────────────────────────────────────────────

class TestTodayCallsUserIsolation:

    def test_tc05_sdr_sees_only_own_calls(self, db):
        """TC-05: An SDR must only see their own calls, not another SDR's calls."""
        sdr_a = create_test_user(db, email="sdr_a@tc.com", role="SDR")
        sdr_b = create_test_user(db, email="sdr_b@tc.com", role="SDR")
        call_a = _make_dialer_call_today(db, sdr_a.id, recording_url="https://a.mp3")
        call_b = _make_dialer_call_today(db, sdr_b.id, recording_url="https://b.mp3")

        client_a = _make_sdr_client(db, sdr_a.id, sdr_a.email)
        data = client_a.get("/api/my/today-calls").json()

        ids = [c["id"] for c in data["calls"]]
        assert call_a.id in ids,  "SDR A's own call must be visible"
        assert call_b.id not in ids, "SDR B's call must NOT be visible to SDR A"


# ── TC-06/07: Date Filtering ─────────────────────────────────────────────────

class TestTodayCallsDateFilter:

    def test_tc06_yesterday_calls_excluded(self, db):
        """TC-06: Calls from yesterday must NOT appear in today's results."""
        sdr = create_test_user(db, email="sdr_date06@tc.com", role="SDR")
        yesterday = _today_utc() - timedelta(days=1)
        _make_dialer_call_today(db, sdr.id, started_at=yesterday.replace(hour=9))  # yesterday
        _make_dialer_call_today(db, sdr.id)  # today

        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()  # no ?date param → today
        # Only today's call should appear
        assert data["summary"]["total"] == 1, \
            "Only today's call should appear; yesterday's must be excluded"

    def test_tc07_date_param_returns_correct_day(self, db):
        """TC-07: ?date=YYYY-MM-DD must return calls for that specific day only."""
        sdr = create_test_user(db, email="sdr_date07@tc.com", role="SDR")
        yesterday = _today_utc() - timedelta(days=1)
        yesterday_call = _make_dialer_call_today(
            db, sdr.id,
            started_at=yesterday.replace(hour=14),
            recording_url="https://rec.mp3",
        )
        _make_dialer_call_today(db, sdr.id)  # today

        c = _make_sdr_client(db, sdr.id, sdr.email)
        date_str = yesterday.date().isoformat()
        data = c.get(f"/api/my/today-calls?date={date_str}").json()

        assert data["date"] == date_str
        assert data["summary"]["total"] == 1
        ids = [i["id"] for i in data["calls"]]
        assert yesterday_call.id in ids, "Yesterday's call must appear when ?date= yesterday"

    def test_tc07b_date_param_recording_url_included(self, db):
        """TC-07b: recording_url must be in response when using ?date param (not just default today)."""
        sdr = create_test_user(db, email="sdr_date07b@tc.com", role="SDR")
        yesterday = _today_utc() - timedelta(days=1)
        _make_dialer_call_today(
            db, sdr.id,
            started_at=yesterday.replace(hour=11),
            recording_url="https://yesterday.mp3",
        )
        c = _make_sdr_client(db, sdr.id, sdr.email)
        date_str = yesterday.date().isoformat()
        data = c.get(f"/api/my/today-calls?date={date_str}").json()

        assert data["calls"]
        assert data["calls"][0]["recording_url"] == "https://yesterday.mp3"


# ── TC-08/09: Mixed Sources ──────────────────────────────────────────────────

class TestTodayCallsMixedSources:

    def test_tc08_manual_and_dialer_both_returned(self, db):
        """TC-08: Manual CallLog and DialerCall must both appear in the merged result."""
        sdr = create_test_user(db, email="sdr_mixed08@tc.com", role="SDR")
        lead = create_test_lead(db, email="lead08@tc.com")
        dialer_call = _make_dialer_call_today(db, sdr.id, lead_id=lead.id,
                                              recording_url="https://rec.mp3")
        manual_call = _make_manual_call_today(db, sdr.id, lead_id=lead.id)

        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()

        ids = [i["id"] for i in data["calls"]]
        assert dialer_call.id in ids, "Dialer call must be in merged result"
        assert manual_call.id in ids, "Manual call must be in merged result"
        assert data["summary"]["total"] == 2

    def test_tc09_multi_provider_both_returned(self, db):
        """TC-09: Aircall and RCM calls must both appear in the same response."""
        sdr = create_test_user(db, email="sdr_mp09@tc.com", role="SDR")
        aircall   = _make_dialer_call_today(db, sdr.id, provider="aircall",
                                            recording_url="https://aircall.mp3")
        rcm = _make_dialer_call_today(db, sdr.id, provider="rcm",
                                             recording_url="https://rcm.mp3")
        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()

        ids = [i["id"] for i in data["calls"]]
        assert aircall.id in ids,    "Aircall call must appear"
        assert rcm.id in ids, "RCM call must appear"
        # Both recording_urls must be present
        urls = {i["recording_url"] for i in data["calls"] if i["recording_url"]}
        assert "https://aircall.mp3" in urls
        assert "https://rcm.mp3" in urls


# ── TC-10: Empty State ────────────────────────────────────────────────────────

class TestTodayCallsEmpty:

    def test_tc10_no_calls_today_returns_zeros(self, db):
        """TC-10: When an SDR has no calls today, calls=[] and all summary counts=0."""
        sdr = create_test_user(db, email="sdr_empty10@tc.com", role="SDR")
        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()

        assert data["calls"] == []
        for key in ("total", "connected", "no_answer", "voicemail", "callback", "meeting"):
            assert data["summary"][key] == 0, f"Expected {key}=0, got {data['summary'][key]}"


# ── TC-11: Input Validation ───────────────────────────────────────────────────

class TestTodayCallsValidation:

    def test_tc11_invalid_date_returns_400(self, db):
        """TC-11: ?date=not-a-date must return 400, not 500."""
        sdr = create_test_user(db, email="sdr_val11@tc.com", role="SDR")
        c = _make_sdr_client(db, sdr.id, sdr.email)
        resp = c.get("/api/my/today-calls?date=not-a-date")
        assert resp.status_code == 400

    def test_tc11b_date_wrong_format_returns_400(self, db):
        """TC-11b: DD/MM/YYYY format must return 400 (not silently accepted)."""
        sdr = create_test_user(db, email="sdr_val11b@tc.com", role="SDR")
        c = _make_sdr_client(db, sdr.id, sdr.email)
        resp = c.get("/api/my/today-calls?date=28/05/2026")
        assert resp.status_code == 400


# ── TC-12: Null started_at ────────────────────────────────────────────────────

class TestTodayCallsNullTimestamp:

    def test_tc12_dialer_call_null_started_at_excluded(self, db):
        """TC-12: DialerCall with started_at=None falls outside the date window
        (filter: started_at >= day_start) and must NOT appear in today's results."""
        sdr = create_test_user(db, email="sdr_null12@tc.com", role="SDR")
        # Call with started_at=None — webhook hasn't fired CALL_STARTED yet
        null_call = models.DialerCall(
            user_id=sdr.id,
            provider="aircall",
            direction="outbound",
            status="CALL_INITIATED",
            phone_number="+10000000001",
            started_at=None,                # no start time yet
            recording_url="https://rec.mp3",
        )
        db.add(null_call)
        db.commit()

        # Also make a normal today call so we confirm the endpoint works
        today_call = _make_dialer_call_today(db, sdr.id)

        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()

        ids = [i["id"] for i in data["calls"]]
        assert null_call.id not in ids, \
            "Call with started_at=None must be excluded (no date → outside window)"
        assert today_call.id in ids, "Normal today call must still appear"


# ── TC-13: Null lead_id ──────────────────────────────────────────────────────

class TestTodayCallsNullLead:

    def test_tc13_anonymous_call_no_crash(self, db):
        """TC-13: DialerCall with lead_id=None (anonymous / pre-lead call)
        must not crash the endpoint. lead_name must be null (not a placeholder
        string) so the frontend can fall back to displaying phone_number
        instead of the bare word "Unknown", which told an SDR nothing about
        who actually called."""
        sdr = create_test_user(db, email="sdr_anon13@tc.com", role="SDR")
        _make_dialer_call_today(db, sdr.id, lead_id=None,
                                recording_url="https://anon.mp3")
        c = _make_sdr_client(db, sdr.id, sdr.email)
        resp = c.get("/api/my/today-calls")
        assert resp.status_code == 200

        data = resp.json()
        item = data["calls"][0]
        assert item["lead_name"] is None, \
            "Anonymous call must have lead_name=null, not a placeholder string"
        assert item["lead_id"] is None
        assert item["recording_url"] == "https://anon.mp3"
        assert "phone_number" in item

    def test_tc13b_auto_created_lead_with_placeholder_name_falls_back_to_null(self, db):
        """A lead auto-created by dialer_service._find_or_create_lead_by_phone
        (first_name='', last_name='Unknown') is a real, matched lead — but
        its name is exactly as unhelpful as no lead at all. Must also resolve
        to lead_name=null, not the literal string 'Unknown'."""
        sdr = create_test_user(db, email="sdr_placeholder13b@tc.com", role="SDR")
        lead = create_test_lead(db, email="placeholder13b@tc.com",
                                 first_name="", last_name="Unknown",
                                 phone="+19995551234")
        _make_dialer_call_today(db, sdr.id, lead_id=lead.id)
        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()
        item = data["calls"][0]
        assert item["lead_name"] is None
        assert item["lead_id"] == lead.id


# ── TC-15: Summary Counts ────────────────────────────────────────────────────

class TestTodayCallsSummaryCounts:

    def test_tc15_summary_buckets_correct(self, db):
        """TC-15: Summary counters must accurately bucket outcomes.

        Setup:
          - 2× No Answer → no_answer=2
          - 1× Left Voicemail → voicemail=1
          - 1× Call Back Later → callback=1
          - 1× Meeting Scheduled → meeting=1, connected=1
          - 1× Interested → connected=1 (total connected=2 via CONNECTED_OUTCOMES)
        """
        sdr = create_test_user(db, email="sdr_sum15@tc.com", role="SDR")
        _make_dialer_call_today(db, sdr.id, outcome="No Answer")
        _make_dialer_call_today(db, sdr.id, outcome="No Answer")
        _make_dialer_call_today(db, sdr.id, outcome="Left Voicemail")
        _make_dialer_call_today(db, sdr.id, outcome="Call Back Later")
        _make_dialer_call_today(db, sdr.id, outcome="Meeting Scheduled")
        _make_dialer_call_today(db, sdr.id, outcome="Interested")

        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()
        s = data["summary"]

        assert s["total"]     == 6
        assert s["no_answer"] == 2
        assert s["voicemail"] == 1
        assert s["callback"]  == 1
        assert s["meeting"]   >= 1   # Meeting Scheduled in MEETING_OUTCOMES
        assert s["connected"] >= 2   # Interested + Meeting Scheduled in CONNECTED_OUTCOMES

    def test_tc15b_other_bucket(self, db):
        """TC-15b: 'other' = total - no_answer - voicemail - connected."""
        sdr = create_test_user(db, email="sdr_sum15b@tc.com", role="SDR")
        _make_dialer_call_today(db, sdr.id, outcome="No Answer")   # no_answer
        _make_dialer_call_today(db, sdr.id, outcome="Interested")  # connected

        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()
        s = data["summary"]

        expected_other = s["total"] - s["no_answer"] - s["voicemail"] - s["connected"]
        assert s["other"] == expected_other, \
            f"other={s['other']} but expected {expected_other}"


# ── TC-16: Null Outcome ───────────────────────────────────────────────────────

class TestTodayCallsNullOutcome:

    def test_tc16_null_outcome_shown_as_dash(self, db):
        """TC-16: DialerCall with outcome=None (call just initiated, no outcome yet)
        must appear as '—' in response — no crash, no missing key."""
        sdr = create_test_user(db, email="sdr_null16@tc.com", role="SDR")
        dc = models.DialerCall(
            user_id=sdr.id,
            provider="aircall",
            direction="outbound",
            status="CALL_INITIATED",
            phone_number="+10000000002",
            started_at=_today_utc().replace(hour=8),
            outcome=None,
            recording_url="https://pending.mp3",
        )
        db.add(dc)
        db.commit()

        c = _make_sdr_client(db, sdr.id, sdr.email)
        resp = c.get("/api/my/today-calls")
        assert resp.status_code == 200

        data = resp.json()
        item = next((i for i in data["calls"] if i["id"] == dc.id), None)
        assert item is not None, "Null-outcome call must still appear"
        assert item["outcome"] == "—", \
            "null outcome must serialize to '—' (as per the backend: c.outcome or '—')"
        assert item["recording_url"] == "https://pending.mp3"


# ── TC-17: Sort Order ────────────────────────────────────────────────────────

class TestTodayCallsSortOrder:

    def test_tc17_calls_sorted_newest_first(self, db):
        """TC-17: Merged call list must be sorted newest called_at first,
        even when interleaving manual and dialer calls."""
        sdr = create_test_user(db, email="sdr_sort17@tc.com", role="SDR")
        lead = create_test_lead(db, email="lead_sort17@tc.com")  # CallLog.lead_id is NOT NULL
        today = _today_utc()

        # Dialer call at 8am (oldest)
        dc_old = _make_dialer_call_today(
            db, sdr.id, started_at=today.replace(hour=8)
        )
        # Manual call at 10am (CallLog requires a lead)
        mc_mid = _make_manual_call_today(
            db, sdr.id, lead_id=lead.id, called_at=today.replace(hour=10)
        )
        # Dialer call at 12pm (newest)
        dc_new = _make_dialer_call_today(
            db, sdr.id, started_at=today.replace(hour=12)
        )

        c = _make_sdr_client(db, sdr.id, sdr.email)
        data = c.get("/api/my/today-calls").json()
        ids = [i["id"] for i in data["calls"]]

        assert ids.index(dc_new.id) < ids.index(mc_mid.id) < ids.index(dc_old.id), \
            "Calls must be sorted newest-first: dc_new → mc_mid → dc_old"
