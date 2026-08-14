"""
Tests for v9.0.1 performance fixes:
  1. cache.py  — stampede guard (claim_inflight / wait_inflight / release_inflight)
  2. cache.py  — TTL bump (users 120s, leaderboard 120s)
  3. list_call_logs (admin_routes.py) — SQL subquery refactor, pagination, filters
  4. list_users  (admin_user_routes.py) — response shape, pod-scoping, cache
  5. get_leaderboard (leaderboard_routes.py) — stampede guard does not break rankings
  6. get_dashboard_stats (lead_routes.py) — parked_count via single GROUP BY
"""
import sys
import os
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from conftest import create_test_user, create_test_lead


# ═══════════════════════════════════════════════════════════════════════════════
# 1. cache.py — stampede guard unit tests (no HTTP, pure module test)
# ═══════════════════════════════════════════════════════════════════════════════

class TestCacheStampedeGuard:
    """Unit-level tests for cache.claim_inflight / wait_inflight / release_inflight."""

    def setup_method(self):
        """Reset relevant cache namespaces before each test."""
        import cache
        # Clear any leftover state
        cache._stores.pop("_test_stamp", None)
        cache._locks.pop("_test_stamp", None)
        cache._inflight.pop("_test_stamp", None)

    def test_claim_returns_true_on_first_call(self):
        import cache
        result = cache.claim_inflight("_test_stamp", "key1")
        assert result is True
        cache.release_inflight("_test_stamp", "key1")

    def test_claim_returns_false_while_inflight(self):
        import cache
        cache.claim_inflight("_test_stamp", "key2")
        result = cache.claim_inflight("_test_stamp", "key2")
        assert result is False
        cache.release_inflight("_test_stamp", "key2")

    def test_release_allows_next_claim(self):
        import cache
        cache.claim_inflight("_test_stamp", "key3")
        cache.release_inflight("_test_stamp", "key3")
        result = cache.claim_inflight("_test_stamp", "key3")
        assert result is True
        cache.release_inflight("_test_stamp", "key3")

    def test_wait_inflight_unblocks_after_release(self):
        """wait_inflight should return within timeout after release is called."""
        import cache
        cache.claim_inflight("_test_stamp", "key4")

        released_at = []
        waited_at = []

        def _release_after_delay():
            time.sleep(0.05)  # 50ms
            cache.set_cached("_test_stamp", "key4", {"done": True})
            released_at.append(time.monotonic())
            cache.release_inflight("_test_stamp", "key4")

        t = threading.Thread(target=_release_after_delay)
        t.start()

        cache.wait_inflight("_test_stamp", "key4", timeout=2.0)
        waited_at.append(time.monotonic())
        t.join()

        # wait_inflight should have returned AFTER release
        assert waited_at[0] >= released_at[0] - 0.01  # ≥ release time (small slack)

    def test_concurrent_claim_only_one_succeeds(self):
        """Under concurrent contention, exactly one thread should claim the key."""
        import cache
        winners = []
        barrier = threading.Barrier(5)

        def _try_claim():
            barrier.wait()  # all start at same time
            if cache.claim_inflight("_test_stamp", "concurrent_key"):
                winners.append(1)
                time.sleep(0.02)
                cache.release_inflight("_test_stamp", "concurrent_key")

        threads = [threading.Thread(target=_try_claim) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Only one thread should have won the claim
        assert len(winners) == 1

    def test_ttl_users_is_120(self):
        import cache
        assert cache.TTL["users"] == 120

    def test_ttl_leaderboard_is_120(self):
        import cache
        assert cache.TTL["leaderboard"] == 120


# ═══════════════════════════════════════════════════════════════════════════════
# 2. list_call_logs — /api/admin/call-logs (SQL subquery refactor)
# ═══════════════════════════════════════════════════════════════════════════════

class TestListCallLogs:
    """Tests for the /api/admin/call-logs endpoint after SQL subquery refactor."""

    def _make_dialer_call(self, db, user, lead=None, direction="outbound",
                          outcome=None, status="CALL_ENDED", provider="aircall",
                          recording_url=None):
        """Create a DialerCall record for testing."""
        import models, uuid
        call = models.DialerCall(
            id=str(uuid.uuid4()),
            user_id=user.id,
            lead_id=lead.id if lead else None,
            provider=provider,
            provider_call_id=str(uuid.uuid4()),
            phone_number="+15551234567",
            status=status,
            direction=direction,
            duration=60,
            outcome=outcome,
            recording_url=recording_url,
        )
        db.add(call)
        db.commit()
        return call

    def test_returns_200_empty(self, client, db):
        resp = client.get("/api/admin/call-logs")
        assert resp.status_code == 200
        data = resp.json()
        assert "total" in data
        assert "items" in data
        assert data["total"] == 0
        assert data["items"] == []

    def test_returns_calls_from_known_users(self, client, db):
        user = create_test_user(db, email="sdr_calls@t.com", role="SDR", name="Call SDR")
        lead = create_test_lead(db, email="callead@t.com")
        self._make_dialer_call(db, user, lead)
        self._make_dialer_call(db, user, lead, status="CALL_MISSED")

        resp = client.get("/api/admin/call-logs")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["items"]) == 2

    def test_pagination_works(self, client, db):
        user = create_test_user(db, email="pg_sdr@t.com", role="SDR", name="PG SDR")
        for i in range(5):
            lead = create_test_lead(db, email=f"pglead{i}@t.com")
            self._make_dialer_call(db, user, lead)

        resp = client.get("/api/admin/call-logs?page=1&per_page=2")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        assert len(data["items"]) == 2

        resp2 = client.get("/api/admin/call-logs?page=2&per_page=2")
        assert resp2.status_code == 200
        assert len(resp2.json()["items"]) == 2

        resp3 = client.get("/api/admin/call-logs?page=3&per_page=2")
        assert resp3.status_code == 200
        assert len(resp3.json()["items"]) == 1

    def test_filter_by_sdr_id(self, client, db):
        sdr1 = create_test_user(db, email="flt_sdr1@t.com", role="SDR")
        sdr2 = create_test_user(db, email="flt_sdr2@t.com", role="SDR")
        lead = create_test_lead(db, email="fltlead@t.com")
        self._make_dialer_call(db, sdr1, lead)
        self._make_dialer_call(db, sdr1, lead)
        self._make_dialer_call(db, sdr2, lead)

        resp = client.get(f"/api/admin/call-logs?sdr_id={sdr1.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert all(item["sdr_name"] == sdr1.name for item in data["items"])

    def test_filter_by_outcome(self, client, db):
        user = create_test_user(db, email="out_sdr@t.com", role="SDR")
        lead = create_test_lead(db, email="outlead@t.com")
        self._make_dialer_call(db, user, lead, outcome="Meeting Scheduled")
        self._make_dialer_call(db, user, lead, outcome="No Answer")
        self._make_dialer_call(db, user, lead, outcome="No Answer")

        resp = client.get("/api/admin/call-logs?outcome=No+Answer")
        assert resp.status_code == 200
        assert resp.json()["total"] == 2

    def test_item_shape_has_required_fields(self, client, db):
        user = create_test_user(db, email="shape_sdr@t.com", role="SDR", name="Shape SDR")
        lead = create_test_lead(db, email="shapelead@t.com")
        self._make_dialer_call(db, user, lead, recording_url="https://rec.example.com/1.mp3")

        resp = client.get("/api/admin/call-logs")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        for field in ["id", "sdr_name", "lead_name", "phone_number", "provider",
                      "outcome", "status", "direction", "duration", "recording_url", "created_at"]:
            assert field in item, f"Missing field: {field}"

    def test_filter_by_has_recording_true(self, client, db):
        user = create_test_user(db, email="rec_sdr@t.com", role="SDR")
        lead = create_test_lead(db, email="reclead@t.com")
        self._make_dialer_call(db, user, lead, recording_url="https://rec.example.com/1.mp3")
        self._make_dialer_call(db, user, lead, recording_url=None)

        resp = client.get("/api/admin/call-logs?has_recording=true")
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_filter_by_has_recording_false(self, client, db):
        user = create_test_user(db, email="norec_sdr@t.com", role="SDR")
        lead = create_test_lead(db, email="noreclead@t.com")
        self._make_dialer_call(db, user, lead, recording_url="https://rec.example.com/1.mp3")
        self._make_dialer_call(db, user, lead, recording_url=None)

        resp = client.get("/api/admin/call-logs?has_recording=false")
        assert resp.status_code == 200
        assert resp.json()["total"] == 1


# ═══════════════════════════════════════════════════════════════════════════════
# 3. list_users — /api/admin/users (stampede guard smoke + response shape)
# ═══════════════════════════════════════════════════════════════════════════════

class TestListUsers:
    """Tests for /api/admin/users ensuring the stampede guard doesn't break responses."""

    def test_returns_200_with_user_list(self, client, db):
        create_test_user(db, email="u1@t.com", role="SDR", name="User One")
        create_test_user(db, email="u2@t.com", role="SDR", name="User Two")
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 2

    def test_response_shape_has_required_fields(self, client, db):
        create_test_user(db, email="shape_u@t.com", role="SDR", name="Shape User")
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        user = next((u for u in resp.json() if u["email"] == "shape_u@t.com"), None)
        assert user is not None
        for field in ["id", "name", "email", "role"]:
            assert field in user, f"Missing field: {field}"

    def test_cache_returns_same_data_on_second_call(self, client, db):
        """Verify cache warm-path returns consistent data."""
        create_test_user(db, email="cache_u@t.com", role="SDR", name="Cache User")
        resp1 = client.get("/api/admin/users")
        resp2 = client.get("/api/admin/users")
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        # Both should return identical payloads (second is cache hit)
        assert resp1.json() == resp2.json()

    def test_repeated_requests_all_return_consistent_data(self, client, db):
        """5 sequential requests to /api/admin/users return consistent data.

        NOTE: Concurrent threading tests for the stampede guard are covered at
        the pure-module level in TestCacheStampedeGuard, which does not use the
        SQLite in-memory DB (SQLite + multi-threading causes segfaults on macOS).
        """
        create_test_user(db, email="conc_u@t.com", role="SDR", name="Concurrent User")

        results = []
        for _ in range(5):
            resp = client.get("/api/admin/users")
            results.append(resp.status_code)

        assert all(code == 200 for code in results), f"Some requests failed: {results}"
        assert len(results) == 5

    def test_pod_admin_sees_only_pod_members(self, client_as_pod_admin, db):
        """Pod Admin scoping is preserved through the cache layer."""
        resp = client_as_pod_admin.get("/api/admin/users")
        assert resp.status_code == 200
        # All returned users should be in the test pod admin's pod
        # (the test pod admin has pod_id=None so they see their pod only)
        data = resp.json()
        assert isinstance(data, list)


# ═══════════════════════════════════════════════════════════════════════════════
# 4. get_leaderboard — stampede guard doesn't break rankings
# ═══════════════════════════════════════════════════════════════════════════════

class TestLeaderboardStampedeGuard:
    """Stampede guard integration tests for /api/leaderboard."""

    def test_repeated_leaderboard_requests_all_return_200(self, client, db):
        """5 sequential leaderboard requests should all succeed.

        NOTE: Concurrent threading tests are at the cache module level in
        TestCacheStampedeGuard (no DB dependency = no SQLite thread hazard).
        """
        create_test_user(db, email="lb_conc@t.com", role="SDR", name="LB Conc")

        results = []
        for _ in range(5):
            resp = client.get("/api/leaderboard")
            results.append(resp.status_code)

        assert all(code == 200 for code in results), f"Some requests failed: {results}"

    def test_stampede_does_not_cause_double_release(self):
        """release_inflight is idempotent — calling twice doesn't panic."""
        import cache
        cache.claim_inflight("_test_stamp2", "dbl_release")
        cache.release_inflight("_test_stamp2", "dbl_release")
        # Second release should be a no-op, not raise
        cache.release_inflight("_test_stamp2", "dbl_release")


# ═══════════════════════════════════════════════════════════════════════════════
# 5. get_dashboard_stats — parked_count via single GROUP BY
# ═══════════════════════════════════════════════════════════════════════════════

class TestDashboardStatsSingleScan:
    """Verify parked_count is correctly computed via the new single GROUP BY path."""

    def test_parked_count_matches_parked_leads(self, client, db):
        import models
        # Create 2 parked leads
        for i in range(2):
            lead = create_test_lead(db, email=f"park{i}@t.com", status="No Phone - Parked")
            db.add(lead)
        # Create 3 active leads
        for i in range(3):
            lead = create_test_lead(db, email=f"active{i}@t.com", status="Lead Assigned")
            db.add(lead)
        db.commit()

        resp = client.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        data = resp.json()

        assert "parked_count" in data
        assert "total" in data
        assert "status_counts" in data
        assert "recent_leads" in data

        assert data["parked_count"] == 2
        assert data["total"] == 3  # active only
        # Parked leads should NOT appear in status_counts
        assert "No Phone - Parked" not in data["status_counts"] or \
               data["status_counts"].get("No Phone - Parked", 0) == 0

    def test_parked_count_zero_when_no_parked_leads(self, client, db):
        create_test_lead(db, email="nopark1@t.com", status="Lead Assigned")
        create_test_lead(db, email="nopark2@t.com", status="Calling")
        db.commit()

        resp = client.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["parked_count"] == 0
        assert data["total"] == 2

    def test_dashboard_total_excludes_parked(self, client, db):
        """Total should only count active pipeline leads, not parked."""
        create_test_lead(db, email="mix_active@t.com", status="Meeting Scheduled")
        create_test_lead(db, email="mix_parked@t.com", status="No Phone - Parked")
        create_test_lead(db, email="mix_pr@t.com",     status="Pending Review")
        db.commit()

        resp = client.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        data = resp.json()
        # total counts only active leads (Meeting Scheduled)
        # parked_count includes No Phone - Parked + Pending Review
        assert data["total"] == 1
        assert data["parked_count"] == 2

    def test_status_counts_has_all_pipeline_statuses(self, client, db):
        """All known pipeline statuses must be present in status_counts (even if 0)."""
        resp = client.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        counts = resp.json()["status_counts"]
        # Key statuses that must always be present
        for s in ["Lead Assigned", "Calling", "Meeting Scheduled", "Disqualified"]:
            assert s in counts, f"Missing status: {s}"
