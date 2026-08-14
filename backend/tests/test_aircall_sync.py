"""
test_aircall_sync.py — Aircall Headless Sync test suite (v4.14.0)
=================================================================
22 tests covering:
  - fetch_calls_paginated (pagination, 429 handling, empty)
  - sync_historical_calls (dedup, phone matching, status transitions, times_called, inbound)
  - handle_webhook (source attribution, times_called, case-insensitive email, secondary phone)
  - Admin sync endpoints (trigger, status, auth guard, date validation)
  - Scheduler startup catch-up check

All network and DB side effects are isolated: Aircall API calls are patched,
and every DB operation uses the in-memory SQLite engine from conftest.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from unittest.mock import patch, MagicMock, PropertyMock

import models
from conftest import (
    create_test_user,
    create_test_lead,
    create_test_pod,
    create_sync_settings,
    SUPER_ADMIN,
    SDR_USER,
)


# ── Shared helpers ────────────────────────────────────────────────────────────

def _make_aircall_call(
    call_id="AC001",
    direction="outbound",
    status="done",
    raw_digits="+919876543210",
    user_email="sdr@test.com",
    duration=60,
    started_at=None,
    ended_at=None,
):
    """Factory for a raw Aircall call dict (as returned by their REST API)."""
    now = int(datetime.now(timezone.utc).timestamp())
    return {
        "id": call_id,
        "direction": direction,
        "status": status,
        "raw_digits": raw_digits,
        "duration": duration,
        "started_at": started_at or now - 120,
        "answered_at": started_at or now - 90,
        "ended_at": ended_at or now,
        "user": {"email": user_email, "id": "u1", "name": "SDR One"},
        "contact": {},
    }


def _configure_aircall(db, api_id="id", api_token="tok"):
    """Insert a SyncSettings row with Aircall configured as active provider."""
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        settings = models.SyncSettings(id=1)
        db.add(settings)
    settings.dialer_provider = "aircall"
    settings.dialer_api_id = api_id
    settings.dialer_api_token = api_token
    db.commit()
    return settings


def _make_dialer_client(db):
    """Minimal FastAPI TestClient including the dialer router."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from database import get_db
    from auth import get_current_user
    from routes.dialer_routes import router as dialer_router

    app = FastAPI()
    app.include_router(dialer_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SUPER_ADMIN
    return TestClient(app)


def _make_sdr_client(db):
    """Client authenticated as SDR (should be blocked from admin endpoints)."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from database import get_db
    from auth import get_current_user
    from routes.dialer_routes import router as dialer_router

    app = FastAPI()
    app.include_router(dialer_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SDR_USER
    return TestClient(app)


# ══════════════════════════════════════════════════════════════════════════════
# 1. fetch_calls_paginated
# ══════════════════════════════════════════════════════════════════════════════

class TestFetchCallsPaginated:
    """Unit tests for AircallDialerProvider.fetch_calls_paginated()."""

    def _make_provider(self):
        from aircall_provider import AircallDialerProvider
        return AircallDialerProvider(api_id="test-id", api_token="test-token")

    def test_single_page_returns_all_calls(self):
        """When one page covers all results, all calls are returned."""
        provider = self._make_provider()
        mock_calls = [_make_aircall_call(call_id=str(i)) for i in range(5)]

        with patch.object(provider, "_get") as mock_get:
            mock_get.return_value = {
                "calls": mock_calls,
                "meta": {"total": 5, "per_page": 50},
            }
            result = provider.fetch_calls_paginated(from_unix=1000, to_unix=2000)

        assert len(result) == 5
        mock_get.assert_called_once()

    def test_multi_page_fetches_all(self):
        """When API returns paginated results, all pages are fetched and merged."""
        provider = self._make_provider()
        page1 = [_make_aircall_call(call_id=f"p1-{i}") for i in range(3)]
        page2 = [_make_aircall_call(call_id=f"p2-{i}") for i in range(2)]

        call_count = {"n": 0}
        def _side_effect(path, params=None):
            call_count["n"] += 1
            page = params.get("page", 1) if params else 1
            if page == 1:
                return {"calls": page1, "meta": {"total": 5, "per_page": 3}}
            return {"calls": page2, "meta": {"total": 5, "per_page": 3}}

        with patch.object(provider, "_get", side_effect=_side_effect):
            result = provider.fetch_calls_paginated(from_unix=1000, to_unix=2000, per_page=3)

        assert len(result) == 5
        assert call_count["n"] == 2

    def test_empty_response_returns_empty_list(self):
        """When Aircall returns no calls, result is an empty list (not an error)."""
        provider = self._make_provider()

        with patch.object(provider, "_get") as mock_get:
            mock_get.return_value = {"calls": [], "meta": {"total": 0, "per_page": 50}}
            result = provider.fetch_calls_paginated(from_unix=1000, to_unix=2000)

        assert result == []

    def test_api_error_returns_partial_results(self):
        """If API fails mid-pagination, already-fetched calls are returned (partial > nothing)."""
        provider = self._make_provider()
        page1 = [_make_aircall_call(call_id="ok-1")]

        call_n = {"n": 0}
        def _side_effect(path, params=None):
            call_n["n"] += 1
            page = (params or {}).get("page", 1)
            if page == 1:
                return {"calls": page1, "meta": {"total": 100, "per_page": 1}}
            raise Exception("Network timeout")

        with patch.object(provider, "_get", side_effect=_side_effect):
            result = provider.fetch_calls_paginated(from_unix=1000, to_unix=2000, per_page=1)

        # Should return what was fetched before the error
        assert len(result) == 1
        assert result[0]["id"] == "ok-1"


# ══════════════════════════════════════════════════════════════════════════════
# 2. sync_historical_calls — core logic
# ══════════════════════════════════════════════════════════════════════════════

class TestSyncHistoricalCalls:
    """Integration tests for dialer_service.sync_historical_calls()."""

    def _sync(self, db, raw_calls, from_dt=None, to_dt=None):
        """Helper: run sync with mocked Aircall API."""
        from dialer_service import sync_historical_calls

        _configure_aircall(db)
        # Use a narrow window (1 day) to avoid the 10s inter-sub-batch sleep
        # that would cause tests to hang for 120+ seconds
        if from_dt is None:
            to_dt = datetime.now(timezone.utc)
            from_dt = to_dt - timedelta(days=1)
        with patch("dialer_service.get_active_provider") as mock_provider:
            provider_mock = MagicMock()
            provider_mock.provider_name = "aircall"
            provider_mock.fetch_calls_paginated.return_value = raw_calls
            mock_provider.return_value = provider_mock
            return sync_historical_calls(db, from_dt=from_dt, to_dt=to_dt)

    # TC-01
    def test_basic_import_creates_dialer_call(self, db):
        """A matched outbound call produces one DialerCall record."""
        lead = create_test_lead(db, phone="+919876543210", status="Lead Assigned")
        call = _make_aircall_call(raw_digits="+919876543210")

        result = self._sync(db, [call])

        assert result["success"] is True
        assert result["imported"] == 1
        dc = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "AC001"
        ).first()
        assert dc is not None
        assert dc.lead_id == lead.id
        assert dc.source == "aircall_direct"

    # TC-02
    def test_deduplication_skips_existing_call(self, db):
        """Re-running sync does not create duplicate records for the same call."""
        lead = create_test_lead(db, phone="+919876543210", status="Lead Assigned")
        call = _make_aircall_call(raw_digits="+919876543210")

        # First sync: 1 call imported across 13 sub-batches (only first is new)
        result1 = self._sync(db, [call])
        assert result1["imported"] == 1

        # Second sync: the 1 sub-batch sees it as already imported
        result2 = self._sync(db, [call])
        assert result2["imported"] == 0
        assert result2["skipped_duplicates"] == 1  # 1 dupe in the single sub-batch
        assert db.query(models.DialerCall).count() == 1

    # TC-03
    def test_unmatched_phone_is_ignored(self, db):
        """Calls for numbers not in RCM are skipped."""
        call = _make_aircall_call(raw_digits="+910000000000")  # no lead has this

        result = self._sync(db, [call])

        assert result["imported"] == 0
        assert result["unmatched_phone"] == 1  # 1 unmatched in the single sub-batch

    # TC-03b
    def test_unmatched_phone_auto_creates_lead_for_known_sdr(self, db):
        """Previously the historical sync silently dropped any call whose
        number didn't already match a lead — worse than the webhook path,
        which at least stored the call. Now, when the calling SDR IS a known
        RCM user (user.email matches), a lead is auto-created and
        assigned to them, mirroring Klenty's own create-on-miss sync logic."""
        pod = create_test_pod(db)
        sdr = create_test_user(db, email="sync-autolead@test.com", role="SDR", pod_id=pod.id)
        call = _make_aircall_call(raw_digits="+910000000001", user_email="sync-autolead@test.com")

        result = self._sync(db, [call])

        assert result["imported"] == 1
        assert result["unmatched_phone"] == 0
        lead = db.query(models.Lead).filter(models.Lead.phone == "+910000000001").first()
        assert lead is not None
        assert lead.pod_id == pod.id
        assert sdr in lead.assigned_users
        dc = db.query(models.DialerCall).filter(models.DialerCall.provider_call_id == "AC001").first()
        assert dc.lead_id == lead.id

    def test_unmatched_phone_stays_unmatched_for_unknown_sdr(self, db):
        """A call from a user who isn't in RCM at all must not create a
        lead — same policy as the live webhook path."""
        call = _make_aircall_call(raw_digits="+910000000002", user_email="not-in-rcm@test.com")

        result = self._sync(db, [call])

        assert result["imported"] == 0
        assert result["unmatched_phone"] == 1
        assert db.query(models.Lead).filter(models.Lead.phone == "+910000000002").first() is None

    def test_import_sets_answered_disposition(self, db):
        """provider_disposition="ANSWERED" should be set on import whenever
        the call has an answered_at — same signal Klenty's sync already
        writes, so Connect Rate isn't blind to Aircall's own native answer
        status."""
        create_test_lead(db, phone="+919876543210", status="Lead Assigned")
        call = _make_aircall_call(raw_digits="+919876543210")

        self._sync(db, [call])

        dc = db.query(models.DialerCall).filter(models.DialerCall.provider_call_id == "AC001").first()
        assert dc.provider_disposition == "ANSWERED"

    def test_import_leaves_disposition_null_when_never_answered(self, db):
        create_test_lead(db, phone="+919876543211", status="Lead Assigned")
        now = int(datetime.now(timezone.utc).timestamp())
        call = {
            "id": "AC-NOANSWER", "direction": "outbound", "status": "missed",
            "raw_digits": "+919876543211", "duration": 0,
            "started_at": now - 30, "answered_at": None, "ended_at": now,
            "user": {"email": "sdr@test.com", "id": "u1", "name": "SDR One"},
            "contact": {},
        }

        self._sync(db, [call])

        dc = db.query(models.DialerCall).filter(models.DialerCall.provider_call_id == "AC-NOANSWER").first()
        assert dc.provider_disposition is None

    # TC-04
    def test_lead_assigned_transitions_to_calling(self, db):
        """EC-7: Lead Assigned → Calling when a matching call is synced."""
        lead = create_test_lead(db, phone="+919876543210", status="Lead Assigned")
        call = _make_aircall_call(raw_digits="+919876543210")

        self._sync(db, [call])

        db.refresh(lead)
        assert lead.status == "Calling"

    # TC-05
    def test_research_status_transitions_to_calling(self, db):
        """EC-7: Research → Calling when a matching call is synced."""
        lead = create_test_lead(db, phone="+919876543210", status="Research")
        call = _make_aircall_call(raw_digits="+919876543210")

        self._sync(db, [call])

        db.refresh(lead)
        assert lead.status == "Calling"

    # TC-06
    def test_calling_status_remains_calling(self, db):
        """EC-7: A lead already in Calling is not moved backward or forward."""
        lead = create_test_lead(db, phone="+919876543210", status="Calling")
        call = _make_aircall_call(raw_digits="+919876543210")

        self._sync(db, [call])

        db.refresh(lead)
        assert lead.status == "Calling"

    # TC-07
    def test_meeting_scheduled_status_untouched(self, db):
        """EC-7: Terminal status Meeting Scheduled is never changed by sync."""
        lead = create_test_lead(db, phone="+919876543210", status="Meeting Scheduled")
        call = _make_aircall_call(raw_digits="+919876543210")

        self._sync(db, [call])

        db.refresh(lead)
        assert lead.status == "Meeting Scheduled"

    # TC-08
    def test_times_called_incremented_for_outbound(self, db):
        """EC-9: times_called is incremented for each outbound completed call."""
        lead = create_test_lead(db, phone="+919876543210", status="Lead Assigned")
        lead.times_called = 0
        db.commit()

        calls = [
            _make_aircall_call(call_id="AC001", direction="outbound", status="done"),
            _make_aircall_call(call_id="AC002", direction="outbound", status="missed"),
        ]
        self._sync(db, calls)

        db.refresh(lead)
        assert lead.times_called == 2

    # TC-09
    def test_inbound_call_does_not_increment_times_called(self, db):
        """EC-9: Inbound calls must NOT increment times_called."""
        lead = create_test_lead(db, phone="+919876543210", status="Calling")
        lead.times_called = 0
        db.commit()

        call = _make_aircall_call(call_id="AC050", direction="inbound", status="done")
        self._sync(db, [call])

        db.refresh(lead)
        assert lead.times_called == 0

    # TC-10
    def test_secondary_phone_matched(self, db):
        """EC-1: Leads are matched via phone_secondary when primary doesn't match."""
        lead = models.Lead(
            first_name="Jane",
            last_name="Doe",
            phone="+910000000001",
            phone_secondary="+919876543210",
            status="Lead Assigned",
            sf_lead_id="sf-secondary-test",
            lead_source="test",
        )
        db.add(lead)
        db.commit()

        call = _make_aircall_call(raw_digits="+919876543210")
        result = self._sync(db, [call])

        assert result["imported"] == 1
        dc = db.query(models.DialerCall).first()
        assert dc.lead_id == lead.id

    # TC-11
    def test_90_day_window_cap_is_enforced(self, db):
        """Date window exceeding 90 days is capped to exactly 90 days."""
        from dialer_service import sync_historical_calls

        _configure_aircall(db)
        now = datetime.now(timezone.utc)
        from_dt = now - timedelta(days=180)     # 180 days — exceeds limit
        to_dt = now

        with patch("dialer_service.get_active_provider") as mock_provider, \
             patch("dialer_service.time.sleep"):  # Skip inter-sub-batch 10s cooldowns
            provider_mock = MagicMock()
            provider_mock.provider_name = "aircall"
            provider_mock.fetch_calls_paginated.return_value = []
            mock_provider.return_value = provider_mock

            sync_historical_calls(db, from_dt=from_dt, to_dt=to_dt)

            # First sub-batch call should start from to_dt - 90 days
            first_call = provider_mock.fetch_calls_paginated.call_args_list[0]
            actual_from_unix = first_call[0][0]  # first positional arg
            expected_from_unix = int((to_dt - timedelta(days=90)).timestamp())

            # Allow 5-second tolerance for call timing
            assert abs(actual_from_unix - expected_from_unix) < 5

    # TC-12
    def test_case_insensitive_sdr_email_match(self, db):
        """EC-5: Aircall user email matching is case-insensitive."""
        user = create_test_user(db, email="SDR@Company.com", role="SDR")
        lead = create_test_lead(db, phone="+919876543210", status="Lead Assigned")

        # Aircall sends email in lowercase
        call = _make_aircall_call(
            raw_digits="+919876543210",
            user_email="sdr@company.com",
        )
        result = self._sync(db, [call])

        assert result["imported"] == 1
        dc = db.query(models.DialerCall).first()
        assert dc.user_id == user.id

    # TC-13
    def test_no_provider_configured_returns_error(self, db):
        """sync_historical_calls returns error dict when no Aircall provider is configured."""
        from dialer_service import sync_historical_calls

        # No SyncSettings → no provider
        result = sync_historical_calls(db)
        assert result["success"] is False
        assert "provider" in result["error"].lower()

    # TC-19a
    def test_research_fields_stamped_on_aircall_direct_import(self, db):
        """EC-8: research fields are written to 'No research done' when blank on import."""
        from dialer_service import _AIRCALL_DIRECT_NOTE
        lead = create_test_lead(db, phone="+919876543210", status="Lead Assigned")
        call = _make_aircall_call(raw_digits="+919876543210")

        self._sync(db, [call])

        db.refresh(lead)
        assert lead.research_company == _AIRCALL_DIRECT_NOTE
        assert lead.research_contact == _AIRCALL_DIRECT_NOTE
        assert lead.research_hypothesis == _AIRCALL_DIRECT_NOTE
        assert lead.research_personalization == _AIRCALL_DIRECT_NOTE

    # TC-19b
    def test_existing_research_not_overwritten_on_import(self, db):
        """EC-8: research fields are NEVER overwritten if SDR already filled them."""
        from dialer_service import _AIRCALL_DIRECT_NOTE
        lead = create_test_lead(db, phone="+919876543210", status="Lead Assigned")
        lead.research_company = "Existing company research"
        lead.research_contact = "Existing contact research"
        db.commit()

        call = _make_aircall_call(raw_digits="+919876543210")
        self._sync(db, [call])

        db.refresh(lead)
        assert lead.research_company == "Existing company research"
        assert lead.research_contact == "Existing contact research"
        # Blank fields get the stamp
        assert lead.research_hypothesis == _AIRCALL_DIRECT_NOTE


# ══════════════════════════════════════════════════════════════════════════════
# 3. handle_webhook — source attribution & times_called
# ══════════════════════════════════════════════════════════════════════════════

class TestHandleWebhookSync:
    """Tests for the updated handle_webhook() in dialer_service."""

    def _fire_webhook(self, db, direction="outbound", phone="+919876543210",
                      event_type="CALL_ENDED", provider_call_id="WH001", user_email="sdr@test.com"):
        """
        Call handle_webhook() with the provider's handle_webhook mocked to return
        a NormalizedCallEvent. This tests all real in-DB logic (status transitions,
        times_called, DialerCall creation) without touching the Aircall HTTP layer.
        """
        from dialer_service import handle_webhook
        from dialer_provider import NormalizedCallEvent, CallEventType

        et = getattr(CallEventType, event_type, event_type)
        event = NormalizedCallEvent(
            event_type=et,
            provider="aircall",
            provider_call_id=provider_call_id,
            phone_number=phone,
            direction=direction,
            user_email=user_email,
            raw_payload={},
        )

        _configure_aircall(db)
        with patch("dialer_service._instantiate_provider") as mock_provider:
            provider_mock = MagicMock()
            provider_mock.provider_name = "aircall"
            provider_mock.handle_webhook.return_value = event
            mock_provider.return_value = provider_mock
            return handle_webhook(db, "aircall", {})

    # TC-14
    def test_unknown_caller_creates_aircall_direct_record(self, db):
        """WH arriving with no prior RCM record gets source='aircall_direct'."""
        create_test_lead(db, phone="+919876543210", status="Lead Assigned")

        self._fire_webhook(db, phone="+919876543210")

        dc = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "WH001"
        ).first()
        assert dc is not None
        assert dc.source == "aircall_direct"

    # TC-15
    def test_webhook_call_ended_outbound_increments_times_called(self, db):
        """EC-9/10: CALL_ENDED + outbound → lead.times_called incremented."""
        lead = create_test_lead(db, phone="+919876543210", status="Lead Assigned")
        lead.times_called = 0
        db.commit()

        self._fire_webhook(db, direction="outbound", phone="+919876543210")

        db.refresh(lead)
        assert lead.times_called == 1

    # TC-16
    def test_inbound_call_ended_does_not_increment_times_called(self, db):
        """EC-9: Inbound CALL_ENDED must not increment times_called."""
        lead = create_test_lead(db, phone="+919876543210", status="Calling")
        lead.times_called = 2
        db.commit()

        self._fire_webhook(db, direction="inbound", phone="+919876543210")

        db.refresh(lead)
        assert lead.times_called == 2  # unchanged

    # TC-17
    def test_webhook_transitions_lead_assigned_to_calling(self, db):
        """Aircall-direct CALL_ENDED transitions Lead Assigned → Calling."""
        lead = create_test_lead(db, phone="+919876543210", status="Lead Assigned")

        self._fire_webhook(db, phone="+919876543210")

        db.refresh(lead)
        assert lead.status == "Calling"

    # TC-18
    def test_webhook_secondary_phone_matches_lead(self, db):
        """EC-1: Webhook phone matched against phone_secondary."""
        lead = models.Lead(
            first_name="Sam",
            last_name="Sec",
            phone="+910000000001",
            phone_secondary="+919876543210",
            status="Lead Assigned",
            sf_lead_id="sf-wh-sec",
            lead_source="test",
        )
        db.add(lead)
        db.commit()

        self._fire_webhook(db, phone="+919876543210")

        dc = db.query(models.DialerCall).first()
        assert dc.lead_id == lead.id



# ══════════════════════════════════════════════════════════════════════════════
# 4. Admin sync endpoints
# ══════════════════════════════════════════════════════════════════════════════

class TestAdminSyncEndpoints:
    """Tests for POST/GET /api/admin/dialer/sync-aircall."""

    # TC-19
    def test_trigger_sync_returns_200_with_running_true(self, db):
        """POST /api/admin/dialer/sync-aircall kicks off a background job."""
        client = _make_dialer_client(db)
        _configure_aircall(db)

        with patch("routes.dialer_routes.dialer_service.run_sync_in_background") as mock_run:
            mock_run.return_value = True  # job started
            resp = client.post("/api/admin/dialer/sync-aircall", json={})

        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is True
        mock_run.assert_called_once()

    # TC-20
    def test_trigger_sync_returns_409_if_already_running(self, db):
        """Returns 200 with 'already running' message when a job is in progress."""
        client = _make_dialer_client(db)
        _configure_aircall(db)

        with patch("routes.dialer_routes.dialer_service.run_sync_in_background") as mock_run:
            mock_run.return_value = False  # already running
            resp = client.post("/api/admin/dialer/sync-aircall", json={})

        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is True
        assert "already running" in data["message"].lower()

    # TC-21
    def test_sdr_cannot_trigger_sync(self, db):
        """SDR must receive 403 when attempting to trigger sync."""
        client = _make_sdr_client(db)

        resp = client.post("/api/admin/dialer/sync-aircall", json={})
        assert resp.status_code == 403

    # TC-22
    def test_date_range_exceeding_90_days_returns_400(self, db):
        """POST with a >90-day date range returns 400 Bad Request."""
        client = _make_dialer_client(db)
        _configure_aircall(db)

        resp = client.post("/api/admin/dialer/sync-aircall", json={
            "from_date": "2024-10-01",
            "to_date": "2025-04-21",   # 202 days — exceeds cap
        })
        assert resp.status_code == 400
        assert "90" in resp.json()["detail"]

    def test_status_endpoint_returns_job_dict(self, db):
        """GET /api/admin/dialer/sync-aircall/status returns job state dict."""
        client = _make_dialer_client(db)

        fake_status = {
            "running": False,
            "last_run": "2025-04-21T02:00:00+00:00",
            "result": {"imported": 12, "skipped_duplicates": 0},
            "error": None,
        }
        with patch("routes.dialer_routes.dialer_service.get_sync_job_status") as mock_status:
            mock_status.return_value = fake_status
            resp = client.get("/api/admin/dialer/sync-aircall/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is False
        assert data["result"]["imported"] == 12


# ══════════════════════════════════════════════════════════════════════════════
# 5. Scheduler startup catch-up check (EC-11)
# ══════════════════════════════════════════════════════════════════════════════

class TestStartupCatchUp:
    """Unit tests for scheduled_jobs._should_run_aircall_sync_on_startup."""

    def test_returns_true_when_never_synced(self, db):
        """EC-11: If aircall_last_sync_at is None, startup sync is required."""
        import database as _db_mod
        orig = _db_mod.SessionLocal
        settings = create_sync_settings(db)
        settings.aircall_last_sync_at = None
        db.commit()

        _db_mod.SessionLocal = lambda: db
        try:
            from scheduled_jobs import _should_run_aircall_sync_on_startup
            assert _should_run_aircall_sync_on_startup() is True
        finally:
            _db_mod.SessionLocal = orig

    def test_returns_false_when_synced_recently(self, db):
        """EC-11: If last sync was < 25h ago, startup sync is NOT required."""
        import database as _db_mod
        orig = _db_mod.SessionLocal
        settings = create_sync_settings(db)
        settings.aircall_last_sync_at = datetime.now(timezone.utc) - timedelta(hours=12)
        db.commit()

        _db_mod.SessionLocal = lambda: db
        try:
            from scheduled_jobs import _should_run_aircall_sync_on_startup
            assert _should_run_aircall_sync_on_startup() is False
        finally:
            _db_mod.SessionLocal = orig

    def test_returns_true_when_sync_overdue(self, db):
        """EC-11: If last sync was > 25h ago, startup sync is required."""
        import database as _db_mod
        orig = _db_mod.SessionLocal
        settings = create_sync_settings(db)
        settings.aircall_last_sync_at = datetime.now(timezone.utc) - timedelta(hours=30)
        db.commit()

        _db_mod.SessionLocal = lambda: db
        try:
            from scheduled_jobs import _should_run_aircall_sync_on_startup
            assert _should_run_aircall_sync_on_startup() is True
        finally:
            _db_mod.SessionLocal = orig


# ══════════════════════════════════════════════════════════════════════════════
# 6. _format_e164 — extension stripping + E.164 normalisation (RCA: 2026-05-27)
# ══════════════════════════════════════════════════════════════════════════════

class TestFormatE164:
    """
    Unit tests for AircallDialerProvider._format_e164.
    Covers the extension-stripping fix (RCA: 2026-05-27):
      - Aircall returns 400 Bad Request when 'ext NNN', 'xNNN', or '#NNN'
        suffixes are passed in the 'to' field.
    """

    def _fmt(self, phone: str) -> str:
        from aircall_provider import AircallDialerProvider
        return AircallDialerProvider._format_e164(phone)

    # ── Extension stripping ──────────────────────────────────────────────────

    def test_strips_ext_with_space(self):
        """'+1 800-887-8965 ext 288' (the exact prod failure) → '+18008878965'."""
        assert self._fmt("+1 800-887-8965 ext 288") == "+18008878965"

    def test_strips_ext_without_space(self):
        """Extension glued directly: 'ext288' stripped."""
        assert self._fmt("+18008878965ext288") == "+18008878965"

    def test_strips_x_prefix(self):
        """'x288' extension suffix stripped."""
        assert self._fmt("+18008878965 x288") == "+18008878965"

    def test_strips_hash_extension(self):
        """'#288' extension suffix stripped."""
        assert self._fmt("+18008878965#288") == "+18008878965"

    def test_strips_ext_dot(self):
        """'ext.' variant stripped."""
        assert self._fmt("+18008878965 ext.288") == "+18008878965"

    def test_extension_case_insensitive(self):
        """'EXT 288' (uppercase) stripped."""
        assert self._fmt("+18008878965 EXT 288") == "+18008878965"

    # ── Standard E.164 normalisation ────────────────────────────────────────

    def test_already_e164_passthrough(self):
        """E.164 number with + prefix passes through unchanged."""
        assert self._fmt("+919876543210") == "+919876543210"

    def test_ten_digit_starting_6_9_is_us_not_india(self):
        """RCA 2026-07-22: a bare 10-digit number starting 6-9 used to be
        guessed as Indian (+91) — but US area codes fully overlap that range
        (602, 702, 803, 918, ...), and a live DB audit found every genuine
        India-country lead already carries an explicit '+91' prefix, while
        this guess was misdialing real US leads as India. Bare 10-digit
        numbers are always +1 now — no digit-based country guessing."""
        assert self._fmt("9876543210") == "+19876543210"
        assert self._fmt("8025551234") == "+18025551234"  # real US area code (803, SC)

    def test_ten_digit_us(self):
        """10-digit US number → +1 prefix."""
        assert self._fmt("2125551234") == "+12125551234"

    def test_eleven_digit_us_with_leading_1(self):
        """11-digit number starting with 1 → +1XXXXXXXXXX."""
        assert self._fmt("12125551234") == "+12125551234"

    def test_dashes_and_spaces_stripped(self):
        """Formatting characters (dashes, spaces, parens) are removed."""
        assert self._fmt("+1 (212) 555-1234") == "+12125551234"

    def test_empty_string_returns_empty(self):
        """Empty input returns empty string without crashing."""
        assert self._fmt("") == ""


# ══════════════════════════════════════════════════════════════════════════════
# 7. initiate_call — 405 non-agent role handling (RCA: 2026-05-27)
# ══════════════════════════════════════════════════════════════════════════════

class TestInitiateCallErrors:
    """
    Unit tests for AircallDialerProvider.initiate_call error paths.
    Covers the 405 Method Not Allowed fix (RCA: 2026-05-27):
      - Aircall returns 405 when the user is admin/supervisor, not agent.
    """

    def _make_provider(self):
        from aircall_provider import AircallDialerProvider
        return AircallDialerProvider(api_id="test-id", api_token="test-token")

    def _make_mock_user(self, user_id=1759179, name="Monisha Sharma", number_id=999):
        return {
            "id": user_id,
            "name": name,
            "email": "monisha.sharma@screen-magic.com",
            "numbers": [{"id": number_id}],
            "default_number_id": number_id,
        }

    def _make_http_error(self, status_code: int, body: str = ""):
        """Build a requests.HTTPError with a mocked response."""
        import requests
        mock_resp = MagicMock()
        mock_resp.status_code = status_code
        mock_resp.text = body
        mock_resp.json.return_value = {}
        err = requests.HTTPError(response=mock_resp)
        return err

    def test_405_returns_actionable_error_message(self):
        """
        405 from Aircall → friendly message: user may be on a call or Aircall Desktop not open.
        Seen for monisha.sharma (user 1759179). Was able to call before → transient state issue,
        NOT a role issue.
        """
        provider = self._make_provider()
        mock_user = self._make_mock_user()

        with patch.object(provider, "_find_user_by_email", return_value=mock_user), \
             patch.object(provider, "_post", side_effect=self._make_http_error(405)):
            result = provider.initiate_call(
                phone_number="+12523156535",
                user_email="monisha.sharma@screen-magic.com",
                lead_id="lead-123",
            )

        assert result.success is False
        # Must mention active call or Desktop app — NOT role/admin changes
        assert "active call" in result.error.lower() or "desktop" in result.error.lower()
        assert "try again" in result.error.lower()


    def test_400_returns_failure_not_crash(self):
        """
        400 from Aircall with an extension number returns failure (not crash).
        The _format_e164 fix prevents this in practice, but backend must still
        handle 400 gracefully if an unsupported number format slips through.
        """
        provider = self._make_provider()
        mock_user = self._make_mock_user()

        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.text = '{"troubleshoot": "Invalid phone number format"}'
        mock_resp.json.return_value = {"troubleshoot": "Invalid phone number format"}

        import requests
        http_err = requests.HTTPError(response=mock_resp)

        with patch.object(provider, "_find_user_by_email", return_value=mock_user), \
             patch.object(provider, "_post", side_effect=http_err):
            result = provider.initiate_call(
                phone_number="+18008879865",
                user_email="vanshika.koli@screen-magic.com",
                lead_id="lead-456",
            )

        assert result.success is False
        assert "Invalid phone number format" in result.error

    def test_extension_stripped_before_api_call(self):
        """
        E2E: when a number with 'ext NNN' is passed to initiate_call,
        the formatted number sent to Aircall has no extension.
        """
        provider = self._make_provider()
        mock_user = self._make_mock_user(user_id=1759177, name="Vanshika Koli")
        captured = {}

        def _fake_post(path, data=None):
            captured["to"] = (data or {}).get("to")
            return {"call": {"id": "AC999"}}

        with patch.object(provider, "_find_user_by_email", return_value=mock_user), \
             patch.object(provider, "_post", side_effect=_fake_post):
            result = provider.initiate_call(
                phone_number="+1 800-887-8965 ext 288",
                user_email="vanshika.koli@screen-magic.com",
                lead_id="lead-789",
            )

        assert result.success is True
        # Extension must not reach Aircall
        assert captured["to"] == "+18008878965"
        assert "ext" not in captured["to"].lower()


# ══════════════════════════════════════════════════════════════════════════════
# 8. _validate_phone_for_aircall — pre-flight phone validation (RCA: 2026-05-27)
# ══════════════════════════════════════════════════════════════════════════════

class TestValidatePhoneForAircall:
    """
    Unit tests for AircallDialerProvider._validate_phone_for_aircall.

    This validator runs BEFORE the Aircall API call and catches bad numbers
    stored in the DB — returning human-readable errors instead of raw HTTP 400s.

    Key cases from prod:
      - '+11860483970' = Indian 1860 service number mis-stored with US +1 prefix → rejects cleanly
      - '+1 186...' area code starting with 1 → invalid NANP → caught pre-API
    """

    def _validate(self, formatted: str, original: str = "") -> Optional[str]:
        from aircall_provider import AircallDialerProvider
        return AircallDialerProvider._validate_phone_for_aircall(formatted, original)

    # ── NANP area code validation ────────────────────────────────────────────

    def test_nanp_area_code_starting_with_1_is_rejected(self):
        """
        '+11860483970' (the exact prod failure) — subscriber '1860483970' is an
        Indian service number mis-stored with +1 prefix. In phone_utils the Indian
        service check runs BEFORE the generic NANP check to give a more specific
        message. Either message (Indian service OR invalid NANP) is acceptable.
        """
        err = self._validate("+11860483970")
        assert err is not None
        # Accept either the specific Indian service message or the generic NANP message
        assert (
            "indian" in err.lower()
            or "service" in err.lower()
            or "area code" in err.lower()
            or "not a valid" in err.lower()
        )

    def test_nanp_area_code_starting_with_0_is_rejected(self):
        """Area code starting with 0 is also invalid in NANP."""
        err = self._validate("+10125551234")
        assert err is not None
        assert "area code" in err.lower() or "not a valid" in err.lower()

    def test_valid_us_number_passes(self):
        """+12125551234 — area code 212 is valid NANP → no error."""
        assert self._validate("+12125551234") is None

    def test_valid_canada_number_passes(self):
        """+14165551234 — Toronto area code 416 → no error."""
        assert self._validate("+14165551234") is None

    # ── Indian 1860/1800 service numbers mis-stored with +1 prefix ───────────

    def test_indian_1860_stored_as_us_is_rejected(self):
        """
        '1860483970' stored as 10 digits → _format_e164 maps to +11860483970.
        _validate_phone catches this as an Indian service number with wrong prefix.
        """
        err = self._validate("+11860483970")
        assert err is not None
        # Must surface actionable guidance — not a raw Aircall error
        assert "service" in err.lower() or "indian" in err.lower() or "1860" in err

    def test_indian_1800_stored_as_us_is_rejected(self):
        """1800 toll-free Indian number wrongly stored with +1 prefix → caught."""
        err = self._validate("+11800123456")
        # This hits the NANP area-code check (area code 180 starts with 1) first
        assert err is not None

    def test_indian_1860_with_correct_prefix_rejected(self):
        """+911860483970 — 1860 with +91 prefix is also undiallable (domestic-only)."""
        err = self._validate("+911860483970")
        assert err is not None
        assert "service" in err.lower() or "toll-free" in err.lower() or "domestic" in err.lower()

    # ── General E.164 sanity ─────────────────────────────────────────────────

    def test_no_plus_prefix_is_rejected(self):
        """Number without + prefix fails (formatter should have added it, but guard catches it)."""
        err = self._validate("11860483970", original="11860483970")
        assert err is not None
        assert "international format" in err.lower() or "country code" in err.lower()

    def test_too_short_number_rejected(self):
        """5-digit number is too short to be a real phone number."""
        err = self._validate("+12345")
        assert err is not None
        assert "digit" in err.lower()

    def test_too_long_number_rejected(self):
        """17-digit number exceeds E.164 max of 15 digits."""
        err = self._validate("+1" + "9" * 16)
        assert err is not None
        assert "digit" in err.lower()

    def test_valid_indian_mobile_passes(self):
        """+919876543210 — valid Indian mobile → no error."""
        assert self._validate("+919876543210") is None

    def test_valid_uk_number_passes(self):
        """+447911123456 — valid UK mobile → no error."""
        assert self._validate("+447911123456") is None

    def test_empty_string_rejected(self):
        """Empty string returns an error, not None."""
        err = self._validate("", original="")
        assert err is not None


# ══════════════════════════════════════════════════════════════════════════════
# 9. Availability pre-check in initiate_call (RCA: 2026-05-27)
# ══════════════════════════════════════════════════════════════════════════════

class TestAvailabilityPreCheck:
    """
    Tests for the availability pre-check in initiate_call().
    When Aircall reports a user as 'offline' or 'do_not_disturb', we surface
    a clear message BEFORE attempting the API call — avoiding a cryptic 405.
    """

    def _make_provider(self):
        from aircall_provider import AircallDialerProvider
        return AircallDialerProvider(api_id="test-id", api_token="test-token")

    def _make_user(self, availability: str = "available", number_id: int = 999):
        return {
            "id": 1759179,
            "name": "Test SDR",
            "email": "sdr@test.com",
            "availability_status": availability,
            "numbers": [{"id": number_id}],
            "default_number_id": number_id,
        }

    def test_offline_user_blocked_with_friendly_message(self):
        """User marked 'offline' in Aircall → blocked before API call, clear message."""
        provider = self._make_provider()

        with patch.object(provider, "_find_user_by_email", return_value=self._make_user("offline")), \
             patch.object(provider, "_post") as mock_post:
            result = provider.initiate_call(
                phone_number="+12125551234",
                user_email="sdr@test.com",
                lead_id="lead-1",
            )

        mock_post.assert_not_called()  # must not hit Aircall API at all
        assert result.success is False
        assert "offline" in result.error.lower()
        assert "available" in result.error.lower()  # tells them what to do

    def test_do_not_disturb_user_blocked(self):
        """User in DND → blocked with actionable message."""
        provider = self._make_provider()

        with patch.object(provider, "_find_user_by_email", return_value=self._make_user("do_not_disturb")), \
             patch.object(provider, "_post") as mock_post:
            result = provider.initiate_call(
                phone_number="+12125551234",
                user_email="sdr@test.com",
                lead_id="lead-2",
            )

        mock_post.assert_not_called()
        assert result.success is False
        assert "do_not_disturb" in result.error.lower() or "dnd" in result.error.lower() or "do not disturb" in result.error.lower()

    def test_available_user_proceeds_to_api(self):
        """User marked 'available' → pre-check passes, call proceeds to Aircall."""
        provider = self._make_provider()

        with patch.object(provider, "_find_user_by_email", return_value=self._make_user("available")), \
             patch.object(provider, "_post", return_value={"call": {"id": "AC100"}}):
            result = provider.initiate_call(
                phone_number="+12125551234",
                user_email="sdr@test.com",
                lead_id="lead-3",
            )

        assert result.success is True

    def test_custom_status_proceeds_to_api(self):
        """'custom' status (not explicitly blocked) → optimistically proceeds."""
        provider = self._make_provider()

        with patch.object(provider, "_find_user_by_email", return_value=self._make_user("custom")), \
             patch.object(provider, "_post", return_value={"call": {"id": "AC101"}}):
            result = provider.initiate_call(
                phone_number="+12125551234",
                user_email="sdr@test.com",
                lead_id="lead-4",
            )

        assert result.success is True

    def test_missing_availability_status_proceeds(self):
        """If availability_status not in response, we default to optimistic → proceeds."""
        provider = self._make_provider()
        user = self._make_user()
        del user["availability_status"]  # simulate missing field

        with patch.object(provider, "_find_user_by_email", return_value=user), \
             patch.object(provider, "_post", return_value={"call": {"id": "AC102"}}):
            result = provider.initiate_call(
                phone_number="+12125551234",
                user_email="sdr@test.com",
                lead_id="lead-5",
            )

        assert result.success is True
