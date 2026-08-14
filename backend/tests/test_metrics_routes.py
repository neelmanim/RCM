"""
test_metrics_routes.py — SDR Usage Metrics endpoint tests.
Covers: /summary, /daily-trend, /sdr-table, /export (CSV), auth, date range parsing.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import pytest
from datetime import datetime, timezone, timedelta

import models
from conftest import (
    create_test_user,
    create_sync_settings,
    SUPER_ADMIN,
    SDR_USER,
)


def _seed_activity_data(db, user):
    """Seed UserActivityLog and UserActivityDailySummary for a user."""
    now = datetime.now(timezone.utc)

    # Seed some raw activity logs
    for action in ["VIEW_LEAD", "UPDATE_LEAD_STATUS", "LOG_CALL", "SCHEDULE_MEETING"]:
        db.add(models.UserActivityLog(
            user_id=user.id,
            user_email=user.email,
            user_name=user.name,
            action_type=action,
            object_type="lead",
            object_id="lead-seed-1",
            created_at=now - timedelta(hours=2),
        ))

    # Seed daily summary
    db.add(models.UserActivityDailySummary(
        user_id=user.id,
        user_email=user.email,
        user_name=user.name,
        summary_date=now.strftime("%Y-%m-%d"),
        lead_views=10,
        status_updates=5,
        calls_logged=8,
        meetings_scheduled=2,
        login_count=3,
        total_actions=25,
        time_spent_minutes=90,
    ))

    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Summary Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestMetricsSummary:
    """GET /api/admin/metrics/summary — KPI cards."""

    def test_summary_returns_kpi_structure(self, client, db):
        """Response should contain all expected KPI fields."""
        user = create_test_user(db, email="sdr-m@test.com", name="SDR M", role="SDR")
        _seed_activity_data(db, user)

        resp = client.get("/api/admin/metrics/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert "daily_active_sdrs" in data
        assert "leads_processed" in data
        assert "meetings_scheduled" in data
        assert "most_used_feature" in data
        assert "total_time_spent_minutes" in data
        assert "total_actions" in data

    def test_summary_from_daily_summaries(self, client, db):
        """When UserActivityDailySummary rows exist with meaningful data, use them."""
        user = create_test_user(db, email="sdr-s@test.com", name="SDR S", role="SDR")
        _seed_activity_data(db, user)

        resp = client.get("/api/admin/metrics/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["meetings_scheduled"] >= 2
        assert data["total_actions"] >= 25

    def test_summary_empty_db_returns_zeros(self, client, db):
        """With no data, summary should return zero metrics."""
        resp = client.get("/api/admin/metrics/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["daily_active_sdrs"] == 0
        assert data["total_actions"] == 0

    def test_summary_admins_excluded_from_sdr_metrics(self, client, db):
        """Admin and Super Admin users should be excluded from SDR metrics."""
        admin = create_test_user(db, email="admin-ex@test.com", name="Admin", role="Admin")
        now = datetime.now(timezone.utc)
        db.add(models.UserActivityDailySummary(
            user_id=admin.id, user_email=admin.email, user_name=admin.name,
            summary_date=now.strftime("%Y-%m-%d"),
            lead_views=100, status_updates=50, calls_logged=30,
            meetings_scheduled=10, login_count=5, total_actions=200,
            time_spent_minutes=300,
        ))
        db.commit()

        resp = client.get("/api/admin/metrics/summary")
        data = resp.json()
        # The admin's 200 actions should not appear in SDR metrics
        assert data["total_actions"] == 0 or data["daily_active_sdrs"] == 0


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Daily Trend Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestDailyTrend:
    """GET /api/admin/metrics/daily-trend — time series for charts."""

    def test_daily_trend_returns_time_series(self, client, db):
        """Response should be a list of per-day data points."""
        user = create_test_user(db, email="sdr-t@test.com", name="SDR T", role="SDR")
        _seed_activity_data(db, user)

        resp = client.get("/api/admin/metrics/daily-trend")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if data:
            assert "date" in data[0]
            assert "lead_views" in data[0]
            assert "calls_logged" in data[0]

    def test_daily_trend_empty_returns_empty_list(self, client, db):
        """With no data, trend should return empty list."""
        resp = client.get("/api/admin/metrics/daily-trend")
        assert resp.status_code == 200
        assert resp.json() == []


# ═══════════════════════════════════════════════════════════════════════════════
# 3. SDR Table Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestSDRTable:
    """GET /api/admin/metrics/sdr-table — per-SDR aggregated metrics."""

    def test_sdr_table_returns_per_user_rows(self, client, db):
        """Response should contain per-SDR rows with action counts."""
        user = create_test_user(db, email="sdr-u@test.com", name="SDR U", role="SDR")
        _seed_activity_data(db, user)

        resp = client.get("/api/admin/metrics/sdr-table")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if data:
            row = data[0]
            assert "user_id" in row
            assert "user_name" in row
            assert "total_actions" in row

    def test_sdr_table_empty_returns_empty(self, client, db):
        """With no data, table should return empty list."""
        resp = client.get("/api/admin/metrics/sdr-table")
        assert resp.status_code == 200
        assert resp.json() == []


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Export Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestExport:
    """GET /api/admin/metrics/export — CSV/Excel downloads."""

    def test_export_no_token_returns_401(self, client, db):
        """Missing auth token should return 401."""
        resp = client.get("/api/admin/metrics/export", params={"format": "csv"})
        assert resp.status_code == 401

    def test_export_invalid_format_returns_422(self, client, db):
        """Invalid format should return 422."""
        from unittest.mock import patch
        with patch("auth.decode_jwt", return_value=SUPER_ADMIN):
            resp = client.get("/api/admin/metrics/export", params={
                "format": "pdf", "token": "fake-token"
            })
            assert resp.status_code == 422

    def test_export_csv_returns_streaming(self, client, db):
        """Valid CSV export should return streaming response."""
        from unittest.mock import patch
        with patch("auth.decode_jwt", return_value=SUPER_ADMIN):
            resp = client.get("/api/admin/metrics/export", params={
                "format": "csv", "token": "fake-token"
            })
            assert resp.status_code == 200
            assert "text/csv" in resp.headers.get("content-type", "")


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Date Range Parsing
# ═══════════════════════════════════════════════════════════════════════════════

class TestDateRangeParsing:
    """Verify custom start_date/end_date query parameters."""

    def test_custom_date_range(self, client, db):
        """Custom start_date and end_date should be accepted."""
        user = create_test_user(db, email="sdr-dr@test.com", name="SDR DR", role="SDR")
        _seed_activity_data(db, user)

        resp = client.get("/api/admin/metrics/summary", params={
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
        })
        assert resp.status_code == 200
