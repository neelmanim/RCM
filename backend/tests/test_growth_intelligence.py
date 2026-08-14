"""
test_growth_intelligence.py — Growth Intelligence / AI insights tests.
Covers: metric computation, fallback insights, cache key logic, endpoint.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, AsyncMock

import models
from conftest import (
    create_test_user,
    create_test_lead,
    create_test_call,
    create_sync_settings,
    SUPER_ADMIN,
    SDR_USER,
)
from routes.growth_intelligence_routes import (
    _compute_metrics,
    _fallback_insights,
    _cache_key,
)
import cache as _cache_module  # used to clear GI cache between tests


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Cache Key Logic
# ═══════════════════════════════════════════════════════════════════════════════

class TestCacheKey:
    """Cache key scoping rules."""

    def test_admin_shared(self):
        """Admin and Super Admin should share a single cache key."""
        assert _cache_key("user-1", "Admin") == "growth_admin"
        assert _cache_key("user-2", "Super Admin") == "growth_admin"

    def test_sdr_scoped(self):
        """SDR cache key should be per-user."""
        assert _cache_key("sdr-1", "SDR") == "growth_sdr-1"
        assert _cache_key("sdr-2", "SDR") == "growth_sdr-2"
        assert _cache_key("sdr-1", "SDR") != _cache_key("sdr-2", "SDR")


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Metric Computation
# ═══════════════════════════════════════════════════════════════════════════════

class TestComputeMetrics:
    """Tests for _compute_metrics()."""

    def test_compute_metrics_basic_structure(self, db):
        """Should return dict with all expected metric keys."""
        user = create_test_user(db, email="gi-sdr@test.com", name="GI SDR", role="SDR")
        metrics = _compute_metrics(db, SUPER_ADMIN)

        assert "total_leads" in metrics
        assert "active_leads" in metrics
        assert "terminal_leads" in metrics
        assert "conversion_rate" in metrics
        assert "leads_moved_7d" in metrics
        assert "research_completion_rate" in metrics
        assert "total_calls_30d" in metrics
        assert "connect_rate_30d" in metrics
        assert "status_counts" in metrics

    def test_compute_metrics_with_data(self, db):
        """Metrics should correctly reflect seeded leads."""
        user = create_test_user(db, email="gi-sdr2@test.com", name="GI SDR2", role="SDR")
        lead1 = create_test_lead(db, last_name="A", email="a@test.com", status="Lead Assigned")
        lead2 = create_test_lead(db, last_name="B", email="b@test.com", status="Meeting Scheduled")
        lead3 = create_test_lead(db, last_name="C", email="c@test.com", status="Disqualified")

        metrics = _compute_metrics(db, SUPER_ADMIN)
        assert metrics["total_leads"] >= 3
        assert metrics["meetings_total"] >= 1

    def test_compute_metrics_empty_db(self, db):
        """Empty DB should return zeros without errors."""
        metrics = _compute_metrics(db, SUPER_ADMIN)
        assert metrics["total_leads"] == 0
        assert metrics["conversion_rate"] == 0
        assert metrics["connect_rate_30d"] == 0


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Fallback Insights
# ═══════════════════════════════════════════════════════════════════════════════

class TestFallbackInsights:
    """Tests for _fallback_insights() — deterministic insights when AI is unavailable."""

    def test_fallback_returns_4_insights(self):
        """Should always return exactly 4 insights."""
        metrics = {
            "total_leads": 100, "active_leads": 60, "terminal_leads": 40,
            "new_leads_30d": 20, "meetings_total": 5, "meetings_30d": 3,
            "conversion_rate": 5.0, "leads_moved_7d": 12,
            "research_completion_rate": 45.0, "total_calls_30d": 80,
            "connect_rate_30d": 18.0, "disqualified": 10,
            "customer_declined": 5, "unreachable": 8,
            "status_counts": {},
        }
        result = _fallback_insights(metrics)
        assert len(result["insights"]) == 4
        assert "headline" in result
        assert "health_score" in result

    def test_fallback_health_score_bounded(self):
        """Health score should be between 10 and 100."""
        # Low metrics
        low_metrics = {
            "total_leads": 0, "active_leads": 0, "terminal_leads": 0,
            "new_leads_30d": 0, "meetings_total": 0, "meetings_30d": 0,
            "conversion_rate": 0, "leads_moved_7d": 0,
            "research_completion_rate": 0, "total_calls_30d": 0,
            "connect_rate_30d": 0, "disqualified": 0,
            "customer_declined": 0, "unreachable": 0,
            "status_counts": {},
        }
        result = _fallback_insights(low_metrics)
        assert 10 <= result["health_score"] <= 100

    def test_fallback_velocity_trend_logic(self):
        """Velocity insight trend should be up/neutral/down based on moved leads."""
        high_vel = {
            "leads_moved_7d": 10, "conversion_rate": 5.0,
            "research_completion_rate": 60.0, "connect_rate_30d": 20.0,
            "total_leads": 50, "active_leads": 30, "meetings_30d": 5,
            "meetings_total": 5, "new_leads_30d": 10, "terminal_leads": 10,
            "total_calls_30d": 50, "disqualified": 5, "customer_declined": 2,
            "unreachable": 3, "status_counts": {},
        }
        result = _fallback_insights(high_vel)
        velocity_insight = result["insights"][0]
        assert velocity_insight["category"] == "velocity"
        assert velocity_insight["trend"] == "up"

    def test_fallback_insight_categories(self):
        """Each insight should have one of the expected categories."""
        metrics = {
            "total_leads": 50, "active_leads": 30, "terminal_leads": 20,
            "new_leads_30d": 10, "meetings_total": 3, "meetings_30d": 2,
            "conversion_rate": 6.0, "leads_moved_7d": 8,
            "research_completion_rate": 55.0, "total_calls_30d": 40,
            "connect_rate_30d": 12.0, "disqualified": 5,
            "customer_declined": 3, "unreachable": 4,
            "status_counts": {},
        }
        result = _fallback_insights(metrics)
        categories = {i["category"] for i in result["insights"]}
        assert categories == {"velocity", "conversion", "efficiency", "health"}


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestGrowthIntelligenceEndpoint:
    """GET /api/growth-intelligence."""

    def test_endpoint_returns_200(self, client, db):
        """Endpoint should return 200 with expected top-level keys."""
        # Clear GI cache to avoid stale data from other tests
        _cache_module.invalidate('growth_intelligence')
        create_sync_settings(db)

        resp = client.get("/api/growth-intelligence")
        assert resp.status_code == 200
        data = resp.json()
        assert "metrics" in data
        assert "ai" in data
        assert "generated_at" in data

    def test_endpoint_no_leads_returns_zeros(self, client, db):
        """Empty DB should return zero metrics with fallback insights."""
        _cache_module.invalidate('growth_intelligence')
        create_sync_settings(db)

        resp = client.get("/api/growth-intelligence")
        data = resp.json()
        assert data["metrics"]["total_leads"] == 0
        assert len(data["ai"]["insights"]) == 4  # Fallback always returns 4
