"""
test_sdr_performance.py — SDR performance drill-down endpoint tests.
Covers: access control, metric calculation, status funnel, period filtering.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone, timedelta

import models
from conftest import (
    create_test_user,
    create_test_lead,
    create_test_call,
    create_test_pod,
    SUPER_ADMIN,
    SDR_USER,
    _make_user_payload,
)


def _assign_lead(db, lead, user):
    """Assign a lead to a user via the many-to-many relationship."""
    lead.assigned_users.append(user)
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Not Found & Access Control
# ═══════════════════════════════════════════════════════════════════════════════

class TestSDRPerformanceAccess:
    """Access control for /api/sdr-performance/{sdr_id}."""

    def test_sdr_not_found_returns_404(self, client, db):
        """Non-existent SDR ID should return 404."""
        resp = client.get("/api/sdr-performance/nonexistent-id")
        assert resp.status_code == 404

    def test_admin_can_view_any_sdr(self, client, db):
        """Super Admin should be able to view any SDR's performance."""
        sdr = create_test_user(db, email="sdr-perf@test.com", name="SDR Perf", role="SDR")
        resp = client.get(f"/api/sdr-performance/{sdr.id}")
        assert resp.status_code == 200

    def test_sdr_can_view_own_performance(self, client_as_sdr, db):
        """SDR should be able to view their own performance."""
        # Ensure a user with the SDR_USER id exists
        sdr_obj = db.query(models.User).filter(models.User.id == "sdr-user-id").first()
        if not sdr_obj:
            sdr_obj = models.User(
                id="sdr-user-id",
                email="sdr-own-perf@test.com",
                name="SDR User",
                role="SDR",
            )
            db.add(sdr_obj)
            db.commit()

        resp = client_as_sdr.get("/api/sdr-performance/sdr-user-id")
        assert resp.status_code == 200

    def test_sdr_cannot_view_other_sdr(self, client_as_sdr, db):
        """SDR should get 403 when trying to view another SDR's performance."""
        other_sdr = create_test_user(db, email="other-sdr@test.com", name="Other SDR", role="SDR")
        resp = client_as_sdr.get(f"/api/sdr-performance/{other_sdr.id}")
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Metric Calculation
# ═══════════════════════════════════════════════════════════════════════════════

class TestSDRPerformanceMetrics:
    """Verify calculated productivity, conversion, and efficiency metrics."""

    def test_productivity_metrics_calculated(self, client, db):
        """Response should include total leads, calls, avg calls per lead."""
        sdr = create_test_user(db, email="sdr-prod@test.com", name="SDR Prod", role="SDR")
        lead = create_test_lead(db, last_name="Prod", email="prod@test.com", status="Calling")
        _assign_lead(db, lead, sdr)
        create_test_call(db, lead_id=lead.id, user_id=sdr.id, outcome="No Answer")
        create_test_call(db, lead_id=lead.id, user_id=sdr.id, outcome="connected")

        resp = client.get(f"/api/sdr-performance/{sdr.id}")
        assert resp.status_code == 200
        data = resp.json()

        assert data["productivity"]["total_leads_assigned"] >= 1
        assert data["productivity"]["calls_made"] >= 2
        assert data["productivity"]["avg_calls_per_lead"] > 0

    def test_conversion_metrics(self, client, db):
        """Meeting-stage leads should appear in conversion metrics."""
        sdr = create_test_user(db, email="sdr-conv@test.com", name="SDR Conv", role="SDR")
        lead1 = create_test_lead(db, last_name="Conv1", email="conv1@test.com", status="Meeting Scheduled")
        lead2 = create_test_lead(db, last_name="Conv2", email="conv2@test.com", status="Calling")
        _assign_lead(db, lead1, sdr)
        _assign_lead(db, lead2, sdr)

        resp = client.get(f"/api/sdr-performance/{sdr.id}")
        data = resp.json()

        assert data["conversion"]["meetings_scheduled"] >= 1
        assert data["conversion"]["conversion_rate"] > 0

    def test_funnel_status_counts(self, client, db):
        """Status breakdown in funnel should accurately count leads."""
        sdr = create_test_user(db, email="sdr-fun@test.com", name="SDR Fun", role="SDR")
        lead_a = create_test_lead(db, last_name="FA", email="fa@test.com", status="Lead Assigned")
        lead_b = create_test_lead(db, last_name="FB", email="fb@test.com", status="Research")
        lead_c = create_test_lead(db, last_name="FC", email="fc@test.com", status="Disqualified")
        for ld in [lead_a, lead_b, lead_c]:
            _assign_lead(db, ld, sdr)

        resp = client.get(f"/api/sdr-performance/{sdr.id}")
        data = resp.json()

        assert data["funnel"]["Lead Assigned"] >= 1
        assert data["funnel"]["Research"] >= 1
        assert data["funnel"]["Disqualified"] >= 1


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Response Structure
# ═══════════════════════════════════════════════════════════════════════════════

class TestSDRPerformanceStructure:
    """Verify the response shape."""

    def test_response_has_all_sections(self, client, db):
        """Response should include sdr, period, productivity, conversion, efficiency, funnel."""
        sdr = create_test_user(db, email="sdr-struct@test.com", name="SDR Struct", role="SDR")
        resp = client.get(f"/api/sdr-performance/{sdr.id}")
        data = resp.json()

        assert "sdr" in data
        assert "period" in data
        assert "productivity" in data
        assert "conversion" in data
        assert "efficiency" in data
        assert "funnel" in data

    def test_sdr_section_has_profile(self, client, db):
        """SDR section should include id, name, email."""
        sdr = create_test_user(db, email="sdr-profile@test.com", name="Profile SDR", role="SDR")
        resp = client.get(f"/api/sdr-performance/{sdr.id}")
        data = resp.json()["sdr"]

        assert data["id"] == sdr.id
        assert data["name"] == "Profile SDR"
        assert data["email"] == "sdr-profile@test.com"

    def test_empty_sdr_returns_zeros(self, client, db):
        """SDR with no assigned leads should return zero metrics."""
        sdr = create_test_user(db, email="sdr-empty@test.com", name="Empty SDR", role="SDR")
        resp = client.get(f"/api/sdr-performance/{sdr.id}")
        data = resp.json()

        assert data["productivity"]["total_leads_assigned"] == 0
        assert data["productivity"]["calls_made"] == 0
        assert data["conversion"]["conversion_rate"] == 0
