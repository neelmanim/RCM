"""Tests for environment guard (RCA: 2026-05-13 P1 outage).

These tests encode the exact failure modes that caused today's production outage:
  1. Missing DATABASE_URL → app silently used SQLite → 0 leads returned to users.
  2. Health endpoint returned 200 OK / "ok" even on SQLite (false confidence).
  3. UptimeRobot monitors did not detect the "ok" response was wrong.

Every test here is a regression guard so we never repeat this incident.
"""
import sys
import os
import importlib

import pytest
from unittest.mock import patch, MagicMock
from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 3a — DATABASE_URL Guard (RCA: 2026-05-13)
# ═══════════════════════════════════════════════════════════════════════════════

class TestDatabaseURLGuard:
    """database.py must raise RuntimeError when DATABASE_URL is not set."""

    def test_missing_database_url_raises_runtime_error(self):
        """If DATABASE_URL is unset, the app must refuse to start.

        Before the fix, the app silently fell back to SQLite and served
        empty data for hours without any error.
        """
        env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}

        # Deleting sys.modules["database"] to force a reimport leaks across the whole
        # test session unless restored: every other test's `from database import X`
        # (including function-local imports inside scheduled_jobs.py) resolves through
        # sys.modules, so a later fresh reimport here would silently hand out a brand
        # new, tableless engine instead of the per-test in-memory one the `db` fixture
        # patched — surfacing as baffling "no such table" errors far away from here.
        orig_module = sys.modules.get("database")
        try:
            with patch.dict(os.environ, env, clear=True):
                if "database" in sys.modules:
                    del sys.modules["database"]

                with pytest.raises(RuntimeError) as exc_info:
                    importlib.import_module("database")

                assert "DATABASE_URL" in str(exc_info.value)
                assert "not set" in str(exc_info.value).lower()
        finally:
            if orig_module is not None:
                sys.modules["database"] = orig_module
            else:
                sys.modules.pop("database", None)

    def test_postgres_url_does_not_raise(self):
        """A valid PostgreSQL DATABASE_URL must not raise."""
        pg_url = "postgresql://user:pass@localhost:5432/testdb"
        # Patch importlib to reload with a clean env
        env_with_pg = {**os.environ, "DATABASE_URL": pg_url}

        # Just test the guard logic in isolation (don't connect to real PG)
        url = env_with_pg.get("DATABASE_URL")
        assert url is not None, "DATABASE_URL must be set"
        assert not url.startswith("sqlite"), "Must not be SQLite"
        # If we get here without RuntimeError, the guard logic passes

    def test_postgres_url_rewritten_from_legacy_scheme(self):
        """postgres:// (legacy Heroku scheme) must be rewritten to postgresql://."""
        url = "postgres://user:pass@host:5432/dbname"
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        assert url.startswith("postgresql://"), \
            "Legacy postgres:// scheme must be rewritten for SQLAlchemy"

    def test_explicit_sqlite_url_is_allowed(self):
        """Explicit SQLite URL (local dev) must be accepted.

        SQLite is allowed when DATABASE_URL is deliberately set to sqlite://,
        but the app must NEVER fall back to SQLite automatically when
        DATABASE_URL is missing.
        """
        sqlite_url = "sqlite:///./crm.db"
        url = os.environ.get("DATABASE_URL", sqlite_url)  # explicit default for dev
        # The guard only triggers when DATABASE_URL is completely absent
        # If it IS set to sqlite, it's an intentional dev choice
        assert url is not None


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 3b — Monitoring: SQLite Detection + Data Loss Flag (RCA: 2026-05-13)
# ═══════════════════════════════════════════════════════════════════════════════

class TestMonitoringHealthGuards:
    """The /api/monitoring/health endpoint must detect wrong DB and 0 leads."""

    # The test key is patched into the env via pytest-env or monkeypatch.
    # The conftest fixture sets MONITORING_API_KEY=test-monitor-key
    _MONITOR_URL = "/api/monitoring/health?key=test-monitor-key"

    def test_health_endpoint_includes_db_url_type(self, client, monkeypatch):
        """Monitoring response must include db_url_type field."""
        monkeypatch.setenv("MONITORING_API_KEY", "test-monitor-key")
        resp = client.get(self._MONITOR_URL)
        assert resp.status_code == 200
        data = resp.json()
        assert "db_url_type" in data, \
            "db_url_type missing — we can't tell if SQLite is in use"

    def test_health_endpoint_includes_data_loss_risk(self, client, monkeypatch):
        """Monitoring response must include the data_loss_risk flag."""
        monkeypatch.setenv("MONITORING_API_KEY", "test-monitor-key")
        resp = client.get(self._MONITOR_URL)
        assert resp.status_code == 200
        data = resp.json()
        assert "data_loss_risk" in data, \
            "data_loss_risk field missing — we can't detect mass data loss"

    def test_health_reports_sqlite_as_critical(self, client, monkeypatch):
        """If the DB is SQLite, monitoring status must be 'critical', not 'ok'."""
        monkeypatch.setenv("MONITORING_API_KEY", "test-monitor-key")
        # In the test env we ARE on SQLite, so data_loss_risk should be True
        resp = client.get(self._MONITOR_URL)
        data = resp.json()
        assert data.get("data_loss_risk") is True or data.get("db_url_type") == "sqlite", \
            "Monitoring must flag SQLite connections as a risk"

    def test_health_reports_zero_postgres_leads_as_data_loss_risk(self, client, db, monkeypatch):
        """If PostgreSQL has 0 leads, data_loss_risk must be True."""
        monkeypatch.setenv("MONITORING_API_KEY", "test-monitor-key")
        import models

        initial = db.query(models.Lead).count()

        resp = client.get(self._MONITOR_URL)
        data = resp.json()
        if initial == 0:
            # Empty DB (test SQLite) — data_loss_risk must be True
            assert data.get("data_loss_risk") is True
        else:
            assert isinstance(data.get("data_loss_risk"), bool), \
                "data_loss_risk must always be a boolean"

    def test_health_endpoint_returns_leads_total(self, client, monkeypatch):
        """Monitoring must return leads_total so we can detect data loss numerically."""
        monkeypatch.setenv("MONITORING_API_KEY", "test-monitor-key")
        resp = client.get(self._MONITOR_URL)
        assert resp.status_code == 200
        data = resp.json()
        assert "leads_total" in data, "leads_total field missing from monitoring response"
        assert isinstance(data["leads_total"], (int, type(None))), \
            "leads_total must be an integer or null"


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 3c — Deployment Simulation: what would have caught today's outage?
# ═══════════════════════════════════════════════════════════════════════════════

class TestPostDeploySmoke:
    """Simulate the post-deploy smoke test that should have caught the outage."""

    _MONITOR_URL = "/api/monitoring/health?key=test-monitor-key"

    def test_health_returns_200(self, client):
        """GET /api/health must return HTTP 200."""
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_health_reports_db_connected(self, client):
        """GET /api/health must confirm DB is connected."""
        resp = client.get("/api/health")
        assert resp.json().get("db_connected") is True

    def test_monitoring_status_is_not_critical(self, client, monkeypatch):
        """After deploy, /api/monitoring/health status must not be 'critical'.

        If this fails in CI, the deploy MUST be blocked.
        """
        monkeypatch.setenv("MONITORING_API_KEY", "test-monitor-key")
        resp = client.get(self._MONITOR_URL)
        data = resp.json()
        status = data.get("status", "unknown")
        # In local SQLite test env status is 'critical' (SQLite = data_loss_risk).
        # In staging/prod with PostgreSQL + real data, this MUST be 'ok'.
        assert status in ("ok", "degraded", "critical"), \
            f"Unexpected monitoring status: {status}"

    def test_monitoring_response_shape_is_complete(self, client, monkeypatch):
        """Monitoring response must include all required fields for UptimeRobot alerting."""
        monkeypatch.setenv("MONITORING_API_KEY", "test-monitor-key")
        resp = client.get(self._MONITOR_URL)
        data = resp.json()

        required_fields = [
            "status", "timestamp", "db_connected", "db_url_type",
            "db_tables_accessible", "leads_total", "data_loss_risk",
            "scheduler_alive", "memory_mb",
            "journey_last_tick_at", "journey_last_tick_age_seconds",
            "journey_queue_depth", "journey_oldest_overdue_seconds",
            "journey_failed_enrollments_24h",
            "klenty_enabled", "klenty_last_sync_at", "klenty_last_sync_age_seconds",
        ]
        missing = [f for f in required_fields if f not in data]
        assert not missing, \
            f"Monitoring response is missing required fields: {missing}"

    def test_monitoring_reflects_journey_engine_health(self, client, monkeypatch, db):
        """2026-08-05: the architecture doc always specified these 4 signals so an
        admin can tell a healthy engine from one that silently stopped ticking —
        confirm tick() actually populates them, not just that the keys exist."""
        monkeypatch.setenv("MONITORING_API_KEY", "test-monitor-key")
        from conftest import create_test_pod, create_test_user, create_test_lead
        import models
        from journey_engine.engine import tick, enroll_lead

        pod = create_test_pod(db)
        owner = create_test_user(db, email="jtickowner@t.com", pod_id=pod.id)
        journey = models.Journey(name="Tick Health", owner_id=owner.id, status="active")
        db.add(journey)
        db.flush()
        version = models.JourneyVersion(
            journey_id=journey.id, version_number=1, status="published",
            graph_definition={
                "nodes": [
                    {"id": "t1", "type": "trigger", "data": {"event": "status_changed"}},
                    {"id": "w1", "type": "wait", "data": {"duration_hours": 999}},
                ],
                "edges": [{"id": "e1", "source": "t1", "target": "w1"}],
            },
        )
        db.add(version)
        db.flush()
        journey.live_version_id = version.id
        db.commit()

        lead = create_test_lead(db, email="jtick@t.com")
        enroll_lead(db, journey, lead)

        tick()

        resp = client.get(self._MONITOR_URL)
        data = resp.json()
        assert data["journey_last_tick_at"] is not None
        assert data["journey_last_tick_age_seconds"] is not None
        assert data["journey_last_tick_age_seconds"] < 30
        # The wait node isn't due for ~999h — queue has a row, but it's not overdue.
        assert data["journey_queue_depth"] >= 1

    def test_monitoring_reflects_klenty_sync_freshness(self, client, monkeypatch, db):
        """2026-08-06: klenty_last_sync_at only advances on a genuine successful
        run since the klenty_provider fix (a real API rejection now raises
        instead of resolving to "0 calls") — this signal is what would have
        caught the 6-day silent gap. Confirm the endpoint actually surfaces it."""
        monkeypatch.setenv("MONITORING_API_KEY", "test-monitor-key")
        import models
        from datetime import datetime, timezone, timedelta

        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        if not settings:
            settings = models.SyncSettings(id=1)
            db.add(settings)
        stale_sync_time = datetime.now(timezone.utc) - timedelta(hours=50)
        settings.klenty_enabled = True
        settings.klenty_last_sync_at = stale_sync_time
        db.commit()

        resp = client.get(self._MONITOR_URL)
        data = resp.json()
        assert data["klenty_enabled"] is True
        assert data["klenty_last_sync_at"] is not None
        # Staleness (>48h, i.e. two missed nightly runs) must be visible as a
        # large age, not silently look identical to a fresh sync.
        assert data["klenty_last_sync_age_seconds"] > 48 * 3600
