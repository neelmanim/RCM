"""
Tests for GET /api/admin/call-logs — Call Monitor endpoint.

Covers:
  - Happy path: basic load, field presence, pagination, SDR dropdown
  - Filters: sdr_id, provider, direction, outcome, date range, has_recording, search*
  - Stats: completeness, correctness, direction/has_recording respected by stats query
  - Edge cases: null lead, null SDR, null duration, empty/invalid transcript, FAILED notes
  - Security/access: Pod Admin scoped, SDR blocked, unauthenticated blocked
  - Optimisation invariant: COUNT does not include cross-org rows (BUG-2 guard)

*search is a frontend-side filter — not passed to the backend endpoint.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timedelta
import pytest

from conftest import (
    create_test_user, create_test_lead, create_test_pod, SUPER_ADMIN,
)
import models


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_dialer_call(
    db,
    user_id,
    lead_id=None,
    provider="rcm",
    direction="outbound",
    status="CALL_ENDED",
    outcome="No Answer",
    provider_disposition=None,
    duration=90,
    recording_url=None,
    notes=None,
    transcript=None,
    created_at=None,
):
    """Factory for DialerCall rows — all optional kwargs match real column names."""
    dc = models.DialerCall(
        user_id=user_id,
        lead_id=lead_id,
        provider=provider,
        direction=direction,
        status=status,
        outcome=outcome,
        provider_disposition=provider_disposition,
        duration=duration,
        recording_url=recording_url,
        notes=notes,
        transcript=transcript,
        phone_number="+10000000000",
    )
    if created_at:
        dc.created_at = created_at
    db.add(dc)
    db.commit()
    db.refresh(dc)
    return dc


# ── Happy Path ───────────────────────────────────────────────────────────────

class TestCallLogsBasic:

    def test_endpoint_returns_200(self, client, db):
        """Sanity: endpoint exists and returns 200 for Super Admin."""
        sdr = create_test_user(db, email="sdr_basic@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id)
        resp = client.get("/api/admin/call-logs")
        assert resp.status_code == 200

    def test_response_shape(self, client, db):
        """Top-level response keys must all be present."""
        sdr = create_test_user(db, email="sdr_shape@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id)
        data = client.get("/api/admin/call-logs").json()
        for key in ("items", "total", "page", "per_page", "pages", "summary", "sdrs"):
            assert key in data, f"Missing key: {key}"

    def test_item_contains_required_fields(self, client, db):
        """Each item must contain all fields the frontend uses."""
        sdr  = create_test_user(db, email="sdr_fields@t.com", role="SDR", name="Field SDR")
        lead = create_test_lead(db, email="lead_fields@t.com", first_name="Ada", last_name="Lovelace",
                                company="Computing Ltd", phone="+10000000001")
        _make_dialer_call(
            db, user_id=sdr.id, lead_id=lead.id,
            recording_url="https://s3.example.com/rec.mp3",
            notes="Good call", outcome="Interested",
        )
        items = client.get("/api/admin/call-logs").json()["items"]
        assert len(items) >= 1
        item = next(i for i in items if i.get("sdr_name") == "Field SDR")

        for field in [
            "id", "sdr_name", "user_email",
            "lead_id", "lead_name", "lead_company",
            "phone_number", "provider", "provider_call_id",
            "outcome", "status", "direction", "duration",
            "recording_url", "transcript", "notes", "error_detail",
            "created_at", "started_at", "answered_at", "ended_at",
        ]:
            assert field in item, f"Missing field: {field}"

    def test_lead_name_and_company_populated(self, client, db):
        """lead_name (first + last) and lead_company must be set from the joined Lead row."""
        sdr  = create_test_user(db, email="sdr_ln@t.com", role="SDR")
        lead = create_test_lead(db, first_name="Grace", last_name="Hopper",
                                company="Navy Labs", email="grace@navy.mil", phone="+10000000002")
        _make_dialer_call(db, user_id=sdr.id, lead_id=lead.id)
        items = client.get("/api/admin/call-logs").json()["items"]
        item = next(i for i in items if i.get("lead_company") == "Navy Labs")
        assert item["lead_name"] == "Grace Hopper"
        assert item["lead_company"] == "Navy Labs"
        assert item["lead_id"] == lead.id

    def test_sdr_name_and_email_populated(self, client, db):
        """sdr_name and user_email must come from the joined User row."""
        sdr = create_test_user(db, email="sdr_sname@t.com", name="Named SDR", role="SDR")
        _make_dialer_call(db, user_id=sdr.id)
        items = client.get("/api/admin/call-logs").json()["items"]
        item = next(i for i in items if i.get("user_email") == "sdr_sname@t.com")
        assert item["sdr_name"] == "Named SDR"
        assert item["user_email"] == "sdr_sname@t.com"

    def test_recording_url_returned(self, client, db):
        """recording_url must be present in the item when set on DialerCall."""
        sdr = create_test_user(db, email="sdr_rec@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id,
                          recording_url="https://cdn.aircall.io/rec/abc123.mp3")
        items = client.get("/api/admin/call-logs").json()["items"]
        item = next(i for i in items if i.get("user_email") == "sdr_rec@t.com")
        assert item["recording_url"] == "https://cdn.aircall.io/rec/abc123.mp3"

    def test_pagination_default_values(self, client, db):
        """Default page=1 and per_page=20 (backend default) must be reflected in the response."""
        sdr = create_test_user(db, email="sdr_page@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id)
        data = client.get("/api/admin/call-logs").json()
        assert data["page"] == 1
        assert data["per_page"] == 20

    def test_total_count_reflects_visible_rows(self, client, db):
        """total must equal the number of calls by known users."""
        sdr = create_test_user(db, email="sdr_total@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id)
        _make_dialer_call(db, user_id=sdr.id)
        data = client.get("/api/admin/call-logs").json()
        assert data["total"] >= 2

    def test_sdr_dropdown_populated(self, client, db):
        """sdrs[] must list known SDRs for the filter dropdown."""
        sdr = create_test_user(db, email="sdr_dropdown@t.com", name="Dropdown SDR", role="SDR")
        _make_dialer_call(db, user_id=sdr.id)
        data = client.get("/api/admin/call-logs").json()
        emails = [s["email"] for s in data["sdrs"]]
        assert "sdr_dropdown@t.com" in emails

    def test_results_ordered_newest_first(self, client, db):
        """Items must come back most-recent first (created_at DESC)."""
        sdr   = create_test_user(db, email="sdr_order@t.com", role="SDR")
        older = _make_dialer_call(db, user_id=sdr.id,
                                  created_at=datetime(2024, 1, 1, 10, 0, 0))
        newer = _make_dialer_call(db, user_id=sdr.id,
                                  created_at=datetime(2024, 6, 1, 10, 0, 0))
        items = client.get("/api/admin/call-logs").json()["items"]
        ids = [i["id"] for i in items]
        assert ids.index(newer.id) < ids.index(older.id)


# ── Filters ──────────────────────────────────────────────────────────────────

class TestCallLogsFilters:

    def test_filter_by_sdr_id(self, client, db):
        """sdr_id filter must return only that SDR's calls."""
        sdr1 = create_test_user(db, email="sdr_f1@t.com", role="SDR")
        sdr2 = create_test_user(db, email="sdr_f2@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr1.id)
        _make_dialer_call(db, user_id=sdr2.id)
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr1.id}).json()
        for item in data["items"]:
            assert item["user_email"] == "sdr_f1@t.com"

    def test_filter_by_provider_rcm(self, client, db):
        """provider=rcm must exclude Aircall calls."""
        sdr = create_test_user(db, email="sdr_prov@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, provider="rcm")
        _make_dialer_call(db, user_id=sdr.id, provider="aircall")
        data = client.get("/api/admin/call-logs", params={"provider": "rcm"}).json()
        for item in data["items"]:
            assert item["provider"] == "rcm"

    def test_filter_by_direction_outbound(self, client, db):
        """direction=outbound must exclude inbound calls."""
        sdr = create_test_user(db, email="sdr_dir@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, direction="outbound")
        _make_dialer_call(db, user_id=sdr.id, direction="inbound")
        data = client.get("/api/admin/call-logs", params={"direction": "outbound"}).json()
        for item in data["items"]:
            assert item["direction"] == "outbound"

    def test_filter_by_direction_inbound(self, client, db):
        """direction=inbound must exclude outbound calls."""
        sdr = create_test_user(db, email="sdr_dir2@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, direction="outbound")
        _make_dialer_call(db, user_id=sdr.id, direction="inbound")
        data = client.get("/api/admin/call-logs", params={"direction": "inbound"}).json()
        for item in data["items"]:
            assert item["direction"] == "inbound"

    def test_filter_by_outcome_exact_match(self, client, db):
        """outcome filter uses exact equality — 'Interested' must NOT match 'Not Interested'."""
        sdr = create_test_user(db, email="sdr_out@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, outcome="Interested")
        _make_dialer_call(db, user_id=sdr.id, outcome="Not Interested")
        data = client.get("/api/admin/call-logs", params={"outcome": "Interested"}).json()
        for item in data["items"]:
            assert item["outcome"] == "Interested"

    def test_filter_has_recording_true(self, client, db):
        """has_recording=true must return only calls with a non-null, non-empty recording_url."""
        sdr = create_test_user(db, email="sdr_hasrec@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, recording_url="https://s3.example.com/r.mp3")
        _make_dialer_call(db, user_id=sdr.id, recording_url=None)
        data = client.get("/api/admin/call-logs", params={"has_recording": True}).json()
        assert data["total"] >= 1
        for item in data["items"]:
            assert item["recording_url"] is not None
            assert item["recording_url"] != ""

    def test_filter_has_recording_false(self, client, db):
        """has_recording=false must return only calls without a recording."""
        sdr = create_test_user(db, email="sdr_norec@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, recording_url="https://s3.example.com/r2.mp3")
        _make_dialer_call(db, user_id=sdr.id, recording_url=None)
        data = client.get("/api/admin/call-logs", params={"has_recording": False}).json()
        for item in data["items"]:
            assert not item["recording_url"]

    def test_filter_date_from_excludes_older(self, client, db):
        """date_from must exclude calls created before that date."""
        sdr   = create_test_user(db, email="sdr_dfrom@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, created_at=datetime(2024, 1, 1))
        _make_dialer_call(db, user_id=sdr.id, created_at=datetime(2024, 6, 1))
        data = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "date_from": "2024-03-01"},
        ).json()
        assert data["total"] == 1

    def test_filter_date_to_excludes_newer(self, client, db):
        """date_to must exclude calls created after end of that day."""
        sdr = create_test_user(db, email="sdr_dto@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, created_at=datetime(2024, 1, 1))
        _make_dialer_call(db, user_id=sdr.id, created_at=datetime(2024, 6, 1))
        data = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "date_to": "2024-03-01"},
        ).json()
        assert data["total"] == 1

    def test_filter_date_range_combined(self, client, db):
        """date_from + date_to together must return only calls in the window."""
        sdr = create_test_user(db, email="sdr_drange@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, created_at=datetime(2024, 1, 1))   # before
        _make_dialer_call(db, user_id=sdr.id, created_at=datetime(2024, 4, 15))  # in window
        _make_dialer_call(db, user_id=sdr.id, created_at=datetime(2024, 9, 1))   # after
        data = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "date_from": "2024-03-01", "date_to": "2024-05-31"},
        ).json()
        assert data["total"] == 1

    def test_filters_are_combinable(self, client, db):
        """Multiple filters applied together should AND correctly."""
        sdr1 = create_test_user(db, email="sdr_combo1@t.com", role="SDR")
        sdr2 = create_test_user(db, email="sdr_combo2@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr1.id, provider="aircall", direction="outbound")
        _make_dialer_call(db, user_id=sdr1.id, provider="rcm", direction="outbound")
        _make_dialer_call(db, user_id=sdr2.id, provider="aircall", direction="outbound")
        data = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr1.id, "provider": "aircall"},
        ).json()
        assert data["total"] == 1
        assert data["items"][0]["provider"] == "aircall"
        assert data["items"][0]["user_email"] == "sdr_combo1@t.com"


# ── Stats Accuracy ───────────────────────────────────────────────────────────

class TestCallLogsStats:

    def test_summary_completed_count(self, client, db):
        """summary.completed must count rows whose status contains 'ENDED'."""
        sdr = create_test_user(db, email="sdr_stat1@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_FAILED")
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        assert data["summary"]["completed"] == 2

    def test_summary_failed_count(self, client, db):
        """summary.failed must count rows whose status contains 'FAIL'."""
        sdr = create_test_user(db, email="sdr_stat2@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_FAILED")
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        assert data["summary"]["failed"] == 1

    def test_summary_connected_is_not_the_same_as_completed(self, client, db):
        """RCA 2026-08-06: the Call Monitor UI's "Connected" tile read
        summary.completed (status ILIKE '%ENDED%') as if it meant "answered"
        — CALL_ENDED is true for a call that rang out unanswered too. On real
        prod data this showed 97% "Connected" when the real rate (an
        SDR-tagged answered outcome, or provider_disposition='ANSWERED') was
        15%. completed counts every ended call regardless of whether it was
        answered; connected must only count the ones that actually were."""
        sdr = create_test_user(db, email="sdr_stat_conn@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED", outcome="No Answer")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED", outcome="No Answer")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED", outcome="Meeting Scheduled")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED", outcome=None, provider_disposition="ANSWERED")
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        assert data["summary"]["completed"] == 4    # all 4 reached CALL_ENDED
        assert data["summary"]["connected"] == 2    # only the answered ones

    def test_summary_missed_counts_the_real_no_answer_status_value(self, client, db):
        """RCA 2026-08-06: the missed pattern matched '%no-answer%' (hyphenated)
        but the real DialerCall.status value is NO_ANSWER (underscore) — those
        rows never counted as completed, failed, OR missed, silently vanishing
        from every summary tile."""
        sdr = create_test_user(db, email="sdr_stat_missed@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, status="NO_ANSWER")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED")
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        assert data["summary"]["missed"] == 1

    def test_summary_respects_direction_filter(self, client, db):
        """
        Stats must use the SAME filter list as the page query.
        Previously stats ignored direction — this would show inflated completed counts.
        """
        sdr = create_test_user(db, email="sdr_stat3@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, direction="outbound", status="CALL_ENDED")
        _make_dialer_call(db, user_id=sdr.id, direction="outbound", status="CALL_ENDED")
        _make_dialer_call(db, user_id=sdr.id, direction="inbound",  status="CALL_ENDED")
        # Request only outbound — stats should show 2, not 3
        data = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "direction": "outbound"},
        ).json()
        assert data["summary"]["completed"] == 2

    def test_summary_respects_has_recording_filter(self, client, db):
        """
        Stats must respect has_recording filter.
        Previously has_recording was silently ignored in the stats query.
        """
        sdr = create_test_user(db, email="sdr_stat4@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED",
                          recording_url="https://s3.example.com/r3.mp3")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED", recording_url=None)
        # Filter to only calls with recording — should see 1 completed, not 2
        data = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "has_recording": True},
        ).json()
        assert data["summary"]["completed"] == 1

    def test_summary_avg_duration_none_when_all_null(self, client, db):
        """avg_duration must be None (not 0) when all calls have null duration."""
        sdr = create_test_user(db, email="sdr_stat5@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, duration=None)
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        assert data["summary"]["avg_duration"] is None

    def test_summary_avg_duration_calculated(self, client, db):
        """avg_duration must be correct integer average of call durations."""
        sdr = create_test_user(db, email="sdr_stat6@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, duration=60)
        _make_dialer_call(db, user_id=sdr.id, duration=120)
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        assert data["summary"]["avg_duration"] == 90


# ── Edge Cases ───────────────────────────────────────────────────────────────

class TestCallLogsEdgeCases:

    def test_e02_null_lead_shows_unknown(self, client, db):
        """E02: Call with lead_id=None must not crash — lead_name should be None or missing."""
        sdr = create_test_user(db, email="sdr_nolead@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, lead_id=None)
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        assert data["total"] >= 1
        item = data["items"][0]
        # lead_name should be None and lead_company should be empty string
        assert item["lead_name"] is None
        assert item["lead_company"] == ""

    def test_e03_null_user_id_handled(self, client, db):
        """E03: Call with user_id that is NOT in the users table must not appear
        (BUG-2: known_user_ids filter keeps cross-org calls out)."""
        sdr = create_test_user(db, email="sdr_e03@t.com", role="SDR")
        # Insert a call for a user_id that doesn't exist in the users table
        dc = models.DialerCall(
            user_id="ghost-user-id-that-does-not-exist",
            provider="aircall",
            direction="inbound",
            status="CALL_ENDED",
            outcome="No Answer",
            phone_number="+10000000003",
        )
        db.add(dc)
        db.commit()
        data = client.get("/api/admin/call-logs").json()
        ids = [i["id"] for i in data["items"]]
        assert dc.id not in ids, "Cross-org call (unknown user_id) must be filtered out (BUG-2)"

    def test_e04_null_duration_shown_as_none(self, client, db):
        """E04: duration=None must come through as null in JSON, not 0."""
        sdr = create_test_user(db, email="sdr_nodur@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, duration=None)
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        item = data["items"][0]
        assert item["duration"] is None

    def test_e05_empty_transcript_treated_as_absent(self, client, db):
        """E05: Transcript of '{}' or '' must not crash the serialiser.
        The item must still be returned with transcript='' or transcript='{}'."""
        sdr = create_test_user(db, email="sdr_emptytx@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, transcript="{}")
        _make_dialer_call(db, user_id=sdr.id, transcript="")
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        assert data["total"] == 2  # both rows returned, no crash

    def test_e06_manual_provider_visible(self, client, db):
        """E06: provider='manual' calls must appear — no provider-specific exclusion."""
        sdr = create_test_user(db, email="sdr_manual@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, provider="manual")
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        assert data["total"] >= 1
        assert any(i["provider"] == "manual" for i in data["items"])

    def test_e07_zero_results_returns_empty_items(self, client, db):
        """E07: When no calls match the filter, items=[] and total=0."""
        sdr = create_test_user(db, email="sdr_nores@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, provider="aircall")
        data = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "provider": "rcm"},
        ).json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_e09_failed_call_notes_in_error_detail(self, client, db):
        """E09/E10: FAILED calls must surface notes as error_detail, not notes."""
        sdr = create_test_user(db, email="sdr_fail@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_FAILED", notes="Timeout on SIP")
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        item = data["items"][0]
        assert item["error_detail"] == "Timeout on SIP"
        assert item["notes"] is None   # notes must NOT be set for failed calls

    def test_non_failed_call_notes_in_notes(self, client, db):
        """Non-FAILED calls must surface notes in notes field, not error_detail."""
        sdr = create_test_user(db, email="sdr_goodnotes@t.com", role="SDR")
        _make_dialer_call(db, user_id=sdr.id, status="CALL_ENDED", notes="Great call")
        data = client.get("/api/admin/call-logs", params={"sdr_id": sdr.id}).json()
        item = data["items"][0]
        assert item["notes"] == "Great call"
        assert item["error_detail"] is None


# ── Pod Admin Scoping ────────────────────────────────────────────────────────

class TestCallLogsPodAdminScoping:

    def test_pod_admin_sees_only_pod_calls(self, db):
        """Pod Admin's calls must be scoped to SDRs in their pod (same pod_id)."""
        from fastapi.testclient import TestClient
        from tests.conftest import _build_test_app
        from database import get_db
        from auth import get_current_user, require_admin, require_super_admin

        pod = create_test_pod(db, name="Test Pod")
        pod_admin_user = create_test_user(
            db, email="pa_scope@t.com", role="Pod Admin", pod_id=pod.id,
        )
        pod_admin_payload = {
            "sub": pod_admin_user.id, "email": "pa_scope@t.com",
            "name": "Pod Admin", "role": "Pod Admin", "pod_id": pod.id,
        }

        in_pod_sdr  = create_test_user(db, email="insdr@t.com",  role="SDR", pod_id=pod.id)
        out_pod_sdr = create_test_user(db, email="outsdr@t.com", role="SDR")  # different pod

        in_call  = _make_dialer_call(db, user_id=in_pod_sdr.id)
        out_call = _make_dialer_call(db, user_id=out_pod_sdr.id)

        app = _build_test_app()

        def _override_db():
            yield db

        app.dependency_overrides[get_db]             = _override_db
        app.dependency_overrides[get_current_user]   = lambda: pod_admin_payload
        app.dependency_overrides[require_admin]      = lambda: pod_admin_payload
        app.dependency_overrides[require_super_admin] = lambda: (_ for _ in ()).throw(
            __import__('fastapi').HTTPException(status_code=403, detail="Super Admin only")
        )

        with TestClient(app) as c:
            data = c.get("/api/admin/call-logs").json()

        item_ids = [i["id"] for i in data["items"]]
        assert in_call.id in item_ids,  "Pod call must be visible to Pod Admin"
        assert out_call.id not in item_ids, "Out-of-pod call must be hidden from Pod Admin"
        app.dependency_overrides.clear()

    def test_pod_admin_sdr_dropdown_scoped_to_pod(self, db):
        """sdrs[] dropdown must only list SDRs from the Pod Admin's pod."""
        from fastapi.testclient import TestClient
        from tests.conftest import _build_test_app
        from database import get_db
        from auth import get_current_user, require_admin, require_super_admin

        pod = create_test_pod(db, name="SDR Pod")
        pa  = create_test_user(db, email="pa_dd@t.com", role="Pod Admin", pod_id=pod.id)
        pa_payload = {
            "sub": pa.id, "email": "pa_dd@t.com",
            "name": "PA", "role": "Pod Admin", "pod_id": pod.id,
        }

        in_sdr  = create_test_user(db, email="in_dd@t.com",  role="SDR", pod_id=pod.id)
        out_sdr = create_test_user(db, email="out_dd@t.com", role="SDR")

        _make_dialer_call(db, user_id=in_sdr.id)

        app = _build_test_app()

        def _override_db():
            yield db

        app.dependency_overrides[get_db]             = _override_db
        app.dependency_overrides[get_current_user]   = lambda: pa_payload
        app.dependency_overrides[require_admin]      = lambda: pa_payload
        app.dependency_overrides[require_super_admin] = lambda: (_ for _ in ()).throw(
            __import__('fastapi').HTTPException(status_code=403, detail="Super Admin only")
        )

        with TestClient(app) as c:
            data = c.get("/api/admin/call-logs").json()

        sdr_emails = [s["email"] for s in data["sdrs"]]
        assert "in_dd@t.com" in sdr_emails
        assert "out_dd@t.com" not in sdr_emails
        app.dependency_overrides.clear()

    def test_super_admin_sees_all_pods_calls(self, client, db):
        """Super Admin must see calls from all pods, not just one."""
        pod1 = create_test_pod(db, name="Pod One")
        pod2 = create_test_pod(db, name="Pod Two")
        sdr1 = create_test_user(db, email="s1@t.com", role="SDR", pod_id=pod1.id)
        sdr2 = create_test_user(db, email="s2@t.com", role="SDR", pod_id=pod2.id)
        c1 = _make_dialer_call(db, user_id=sdr1.id)
        c2 = _make_dialer_call(db, user_id=sdr2.id)
        data = client.get("/api/admin/call-logs").json()
        ids = [i["id"] for i in data["items"]]
        assert c1.id in ids
        assert c2.id in ids


# ── Security ─────────────────────────────────────────────────────────────────

class TestCallLogsSecurity:

    def test_sdr_cannot_access_call_logs(self, client_as_sdr, db):
        """S01: SDR must receive 403 when hitting the call-logs endpoint."""
        resp = client_as_sdr.get("/api/admin/call-logs")
        assert resp.status_code == 403

    def test_unauthenticated_returns_401_or_403(self, db):
        """S03: Request with no auth must be rejected."""
        from fastapi.testclient import TestClient
        from tests.conftest import _build_test_app

        app = _build_test_app()
        # No dependency overrides — real auth enforced
        with TestClient(app, raise_server_exceptions=False) as c:
            resp = c.get("/api/admin/call-logs")
        assert resp.status_code in (401, 403)

    def test_bug2_cross_org_aircall_calls_excluded(self, client, db):
        """
        BUG-2 regression guard: Aircall webhooks write DialerCall rows with user_ids
        that don't exist in this org's users table (cross-org bleed).
        These rows must NEVER appear in the call monitor.
        """
        sdr = create_test_user(db, email="sdr_bug2@t.com", role="SDR")
        legit_call = _make_dialer_call(db, user_id=sdr.id, provider="aircall")

        # Simulate an Aircall webhook from another org
        foreign_call = models.DialerCall(
            user_id="foreign-org-user-999",   # NOT in this org's users table
            provider="aircall",
            direction="inbound",
            status="CALL_ENDED",
            outcome="No Answer",
            phone_number="+61412345678",       # Australian number — classic bleed signal
        )
        db.add(foreign_call)
        db.commit()

        data = client.get("/api/admin/call-logs").json()
        ids = [i["id"] for i in data["items"]]

        assert legit_call.id in ids,    "Legitimate call must appear"
        assert foreign_call.id not in ids, "Cross-org Aircall call must be excluded (BUG-2)"


# ── Pagination ───────────────────────────────────────────────────────────────

class TestCallLogsPagination:

    def test_per_page_respected(self, client, db):
        """per_page param must limit the number of items returned."""
        sdr = create_test_user(db, email="sdr_pgsize@t.com", role="SDR")
        for _ in range(5):
            _make_dialer_call(db, user_id=sdr.id)
        data = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "per_page": 2},
        ).json()
        assert len(data["items"]) == 2
        assert data["pages"] >= 3

    def test_page_2_returns_different_items(self, client, db):
        """page=2 must not repeat items from page=1."""
        sdr = create_test_user(db, email="sdr_pg2@t.com", role="SDR")
        for _ in range(4):
            _make_dialer_call(db, user_id=sdr.id)
        page1 = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "per_page": 2, "page": 1},
        ).json()
        page2 = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "per_page": 2, "page": 2},
        ).json()
        p1_ids = {i["id"] for i in page1["items"]}
        p2_ids = {i["id"] for i in page2["items"]}
        assert p1_ids.isdisjoint(p2_ids), "Page 1 and Page 2 must not share any items"

    def test_pages_calculated_correctly(self, client, db):
        """pages must be ceil(total / per_page)."""
        import math
        sdr = create_test_user(db, email="sdr_pgcalc@t.com", role="SDR")
        for _ in range(7):
            _make_dialer_call(db, user_id=sdr.id)
        data = client.get(
            "/api/admin/call-logs",
            params={"sdr_id": sdr.id, "per_page": 3},
        ).json()
        expected_pages = math.ceil(data["total"] / 3)
        assert data["pages"] == expected_pages
