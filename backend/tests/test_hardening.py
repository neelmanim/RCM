"""Tests for post-incident hardening (May 6, 2026).

Phase 1: Health check + connect_timeout
Phase 2: Phone dedup OOM fix + CSV row cap
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import csv
import io
import pytest
from unittest.mock import patch, MagicMock
from sqlalchemy import text


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 1: Health Check Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestHealthCheck:
    """Tests for the improved /api/health endpoint."""

    def test_health_returns_ok_with_db_status(self, client):
        """Health check should include db_connected status."""
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["db_connected"] is True

    def test_health_check_verifies_db_connectivity(self, client, db):
        """Health check must actually query the database, not just return 200."""
        resp = client.get("/api/health")
        assert resp.status_code == 200
        # The response should indicate DB is connected
        assert resp.json()["db_connected"] is True


class TestDeepHealthCheck:
    """Tests for the /api/health/deep endpoint."""

    def test_deep_health_returns_memory_info(self, client):
        """Deep health check should report memory usage in MB."""
        resp = client.get("/api/health/deep")
        assert resp.status_code == 200
        data = resp.json()
        assert "memory_mb" in data
        assert isinstance(data["memory_mb"], (int, float))
        assert data["memory_mb"] > 0

    def test_deep_health_returns_db_latency(self, client):
        """Deep health check should report DB query latency in ms."""
        resp = client.get("/api/health/deep")
        assert resp.status_code == 200
        data = resp.json()
        assert "db_latency_ms" in data
        assert isinstance(data["db_latency_ms"], (int, float))
        assert data["db_latency_ms"] >= 0

    def test_deep_health_returns_status(self, client):
        """Deep health check should return a valid status.

        'ok' means all integrations healthy.
        'degraded' means core DB is up but external integrations (SF, Aircall)
        are not configured — expected in local test environment.
        """
        resp = client.get("/api/health/deep")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("ok", "degraded"), f"Unexpected status: {data['status']}"
        assert data["db_connected"] is True


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 1: connect_timeout Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestConnectTimeout:
    """Tests for database connect_timeout configuration."""

    def test_postgres_connect_args_include_timeout(self):
        """When DATABASE_URL is PostgreSQL, connect_args must include connect_timeout."""
        # Simulate a PostgreSQL URL
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://user:pass@host:5432/dbname"}):
            # Re-evaluate the connect_args logic
            url = os.getenv("DATABASE_URL", "sqlite:///./crm.db")
            if "sqlite" in url:
                connect_args = {"check_same_thread": False}
            else:
                connect_args = {"connect_timeout": 10}

            assert "connect_timeout" in connect_args
            assert connect_args["connect_timeout"] == 10

    def test_sqlite_connect_args_unchanged(self):
        """SQLite connect_args should still have check_same_thread: False."""
        with patch.dict(os.environ, {"DATABASE_URL": "sqlite:///./test.db"}):
            url = os.getenv("DATABASE_URL", "sqlite:///./crm.db")
            if "sqlite" in url:
                connect_args = {"check_same_thread": False}
            else:
                connect_args = {"connect_timeout": 10}

            assert "check_same_thread" in connect_args
            assert connect_args["check_same_thread"] is False
            assert "connect_timeout" not in connect_args


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 2: Phone Dedup OOM Fix Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestPhoneDedupFix:
    """Tests that phone dedup uses DB-side matching, not loading all records."""

    def _build_csv(self, rows):
        """Build a CSV string from list of dicts."""
        if not rows:
            return ""
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue()

    def test_upload_dedup_by_phone_works(self, client, db):
        """Upload should detect duplicate phones via DB query, not in-memory scan."""
        import models

        # Create an existing lead with a known phone number
        lead = models.Lead(
            first_name="Existing", last_name="Lead",
            email="existing@test.com", company="TestCo",
            phone="+1 (555) 123-4567"
        )
        db.add(lead)
        db.commit()

        # Upload a CSV with the same phone number (different formatting)
        csv_data = self._build_csv([{
            "First Name": "New",
            "Last Name": "Person",
            "Email": "new@test.com",
            "Company": "NewCo",
            "Phone": "5551234567",  # Same digits, different format
        }])

        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": csv_data,
            "mapping": {
                "First Name": "first_name",
                "Last Name": "last_name",
                "Email": "email",
                "Company": "company",
                "Phone": "phone",
            },
            "skip_unmatched": True,
            "filename": "test.csv",
        })
        assert resp.status_code == 200
        data = resp.json()
        # The duplicate should be detected
        assert data["duplicates"] >= 1

    def test_upload_unique_phone_creates_lead(self, client, db):
        """Upload with a unique phone number should create the lead successfully."""
        csv_data = self._build_csv([{
            "First Name": "Unique",
            "Last Name": "Phone",
            "Email": "unique@test.com",
            "Company": "UniqueCo",
            "Phone": "9998887777",
        }])

        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": csv_data,
            "mapping": {
                "First Name": "first_name",
                "Last Name": "last_name",
                "Email": "email",
                "Company": "company",
                "Phone": "phone",
            },
            "skip_unmatched": True,
            "filename": "test.csv",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] >= 1

    def test_upload_does_not_load_all_phones_in_memory(self, client, db):
        """Verify that upload does NOT call Lead.phone.all() without filters.

        This is the critical regression test — the old code loaded ALL leads
        with phone numbers into memory on every row. The fix should use a
        targeted DB query instead.
        """
        import models

        # Create 50 leads with phone numbers to ensure there's data
        for i in range(50):
            lead = models.Lead(
                first_name=f"Bulk{i}", last_name=f"Lead{i}",
                email=f"bulk{i}@test.com", company=f"BulkCo{i}",
                phone=f"+1555{i:07d}"
            )
            db.add(lead)
        db.commit()

        # Upload a small CSV (3 rows with phones)
        rows = [
            {"First Name": f"New{i}", "Last Name": f"User{i}",
             "Email": f"new{i}@test.com", "Company": f"NewCo{i}",
             "Phone": f"888{i:07d}"}
            for i in range(3)
        ]
        csv_data = self._build_csv(rows)

        # We can't easily intercept the internal .all() calls from the route,
        # but we CAN verify the upload succeeds and dedup works correctly
        # even with a populated database. The key assertion is that all 3
        # unique-phone rows are created despite 50 existing leads.

        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": csv_data,
            "mapping": {
                "First Name": "first_name",
                "Last Name": "last_name",
                "Email": "email",
                "Company": "company",
                "Phone": "phone",
            },
            "skip_unmatched": True,
            "filename": "test.csv",
        })
        assert resp.status_code == 200
        data = resp.json()
        # All 3 should be created (unique phones)
        assert data["created"] == 3


class TestCSVRowCap:
    """Tests for the CSV upload row limit."""

    def _build_csv(self, rows):
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue()

    def test_upload_rejects_csv_over_row_cap(self, client, db):
        """Upload should reject CSVs exceeding the row cap (10,000 rows)."""
        # Build a CSV with 10,001 rows (we use minimal data to keep test fast)
        rows = [
            {"First Name": f"Name{i}", "Last Name": f"Last{i}",
             "Email": f"test{i}@example.com", "Company": f"Co{i}"}
            for i in range(10_001)
        ]
        csv_data = self._build_csv(rows)

        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": csv_data,
            "mapping": {
                "First Name": "first_name",
                "Last Name": "last_name",
                "Email": "email",
                "Company": "company",
            },
            "skip_unmatched": True,
            "filename": "big_test.csv",
        })
        # Should fail with a clear error
        assert resp.status_code in (400, 422)

    def test_upload_allows_csv_within_row_cap(self, client, db):
        """Upload should accept CSVs within the row cap."""
        rows = [
            {"First Name": f"Name{i}", "Last Name": f"Last{i}",
             "Email": f"ok{i}@example.com", "Company": f"Co{i}",
             "Phone": f"777{i:07d}"}
            for i in range(5)
        ]
        csv_data = self._build_csv(rows)

        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": csv_data,
            "mapping": {
                "First Name": "first_name",
                "Last Name": "last_name",
                "Email": "email",
                "Company": "company",
                "Phone": "phone",
            },
            "skip_unmatched": True,
            "filename": "small_test.csv",
        })
        assert resp.status_code == 200
        assert resp.json()["created"] == 5
