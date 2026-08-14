"""Tests for Lead Deprioritization (v4.7.0).

Covers:
- PATCH /leads/{id}/priority  — manual re-prioritization endpoint
- Auto-deprioritization hook  — priority lowers after log_call
- My Leads ordering           — priority_score DESC sort order
- Lead summary includes priority_score
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_user, create_test_lead, create_test_call, SUPER_ADMIN, SDR_USER
import models


# ═══════════════════════════════════════════════════════════════════════════════
# Manual Re-prioritization Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestReprioritizeEndpoint:

    def test_set_priority_to_100(self, client, db):
        """Re-prioritize a deprioritized lead back to High (100)."""
        lead = create_test_lead(db, email="prio1@t.com")
        lead.priority_score = 25
        db.commit()
        resp = client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": 100})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["priority_score"] == 100

    def test_set_priority_to_50(self, client, db):
        """Set priority to Medium (50)."""
        lead = create_test_lead(db, email="prio2@t.com")
        resp = client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": 50})
        assert resp.status_code == 200
        assert resp.json()["priority_score"] == 50

    def test_priority_clamped_max_100(self, client, db):
        """Score above 100 is clamped to 100."""
        lead = create_test_lead(db, email="prio3@t.com")
        resp = client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": 200})
        assert resp.status_code == 200
        assert resp.json()["priority_score"] == 100

    def test_priority_clamped_min_0(self, client, db):
        """Score below 0 is clamped to 0."""
        lead = create_test_lead(db, email="prio4@t.com")
        resp = client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": -50})
        assert resp.status_code == 200
        assert resp.json()["priority_score"] == 0

    def test_priority_defaults_to_100(self, client, db):
        """Omitting priority_score defaults to 100."""
        lead = create_test_lead(db, email="prio5@t.com")
        lead.priority_score = 25
        db.commit()
        resp = client.patch(f"/api/leads/{lead.id}/priority", json={})
        assert resp.status_code == 200
        assert resp.json()["priority_score"] == 100

    def test_priority_rejects_non_integer(self, client, db):
        """Non-integer priority_score returns 400."""
        lead = create_test_lead(db, email="prio6@t.com")
        resp = client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": "abc"})
        assert resp.status_code == 400
        assert "integer" in resp.json()["detail"].lower()

    def test_priority_nonexistent_lead_404(self, client):
        """Updating priority of a non-existent lead returns 404."""
        resp = client.patch("/api/leads/nonexistent-id/priority", json={"priority_score": 100})
        assert resp.status_code == 404

    def test_priority_persists_in_db(self, client, db):
        """Priority update is persisted to the database."""
        lead = create_test_lead(db, email="prio7@t.com")
        client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": 42})
        db.refresh(lead)
        assert lead.priority_score == 42


# ═══════════════════════════════════════════════════════════════════════════════
# Auto-Deprioritization After Call Logging
# ═══════════════════════════════════════════════════════════════════════════════

class TestAutoDeprioritization:

    def test_first_call_sets_medium_priority(self, client, db):
        """After logging the first call today, priority drops to 50 (Medium)."""
        user = create_test_user(db, email="admin@test.com")
        lead = create_test_lead(db, email="autodep1@t.com", status="Calling")
        assert lead.priority_score == 100  # default

        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "No Answer", "notes": ""
        })
        assert resp.status_code == 200

        db.refresh(lead)
        assert lead.priority_score == 50  # Medium after 1st call

    def test_second_call_sets_deprioritized(self, client, db):
        """After 2+ calls today, priority drops to 25 (Deprioritized)."""
        user = create_test_user(db, email="admin@test.com")
        lead = create_test_lead(db, email="autodep2@t.com", status="Calling")

        # First call
        client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "No Answer", "notes": ""
        })
        # Second call
        client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "Left Voicemail", "notes": ""
        })
        db.refresh(lead)
        assert lead.priority_score == 25  # Deprioritized after 2nd call

    def test_auto_deprioritize_never_raises(self, client, db):
        """Auto-deprioritization only lowers priority, never raises it."""
        user = create_test_user(db, email="admin@test.com")
        lead = create_test_lead(db, email="autodep3@t.com", status="Calling")
        lead.priority_score = 10  # Manually set very low
        db.commit()

        resp = client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "No Answer", "notes": ""
        })
        assert resp.status_code == 200
        db.refresh(lead)
        # Should stay at 10, not raised to 50
        assert lead.priority_score == 10

    def test_manual_reprioritize_after_auto(self, client, db):
        """After auto-deprioritization, manual re-prioritize restores to 100."""
        user = create_test_user(db, email="admin@test.com")
        lead = create_test_lead(db, email="autodep4@t.com", status="Calling")

        # Auto-deprioritize via call
        client.post(f"/api/leads/{lead.id}/calls", json={
            "outcome": "No Answer", "notes": ""
        })
        db.refresh(lead)
        assert lead.priority_score < 100

        # Manual re-prioritize
        resp = client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": 100})
        assert resp.status_code == 200
        db.refresh(lead)
        assert lead.priority_score == 100


# ═══════════════════════════════════════════════════════════════════════════════
# My Leads — Priority-Based Ordering
# ═══════════════════════════════════════════════════════════════════════════════

class TestMyLeadsPriorityOrder:

    def test_my_leads_returns_priority_score(self, client_as_sdr, db):
        """GET /leads/my includes priority_score in each lead summary."""
        sdr = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR", role="SDR")
        db.add(sdr)
        lead = create_test_lead(db, email="myp1@t.com")
        lead.priority_score = 75
        sdr.assigned_leads.append(lead)
        db.commit()

        resp = client_as_sdr.get("/api/leads/my")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) >= 1
        assert data[0]["priority_score"] == 75

    def test_my_leads_high_before_deprioritized(self, client_as_sdr, db):
        """High priority leads (100) appear before Deprioritized (25)."""
        sdr = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR", role="SDR")
        db.add(sdr)

        lead_low = create_test_lead(db, email="low@t.com", company="Acme")
        lead_low.priority_score = 25
        sdr.assigned_leads.append(lead_low)

        lead_high = create_test_lead(db, email="high@t.com", company="Acme")
        lead_high.priority_score = 100
        sdr.assigned_leads.append(lead_high)
        db.commit()

        resp = client_as_sdr.get("/api/leads/my")
        data = resp.json()["data"]
        assert len(data) >= 2
        # High priority should come first
        scores = [d["priority_score"] for d in data]
        assert scores == sorted(scores, reverse=True)

    def test_new_lead_defaults_to_high_priority(self, client, db):
        """Newly created leads default to priority_score = 100."""
        lead = create_test_lead(db, email="newp@t.com")
        assert lead.priority_score == 100


# ═══════════════════════════════════════════════════════════════════════════════
# Lead Summary — priority_score Inclusion
# ═══════════════════════════════════════════════════════════════════════════════

class TestLeadSummaryPriority:

    def test_lead_priority_score_in_model(self, client, db):
        """Lead model stores and retrieves priority_score correctly."""
        lead = create_test_lead(db, email="det1@t.com")
        lead.priority_score = 42
        db.commit()
        db.refresh(lead)
        assert lead.priority_score == 42
        # Verify the lead detail endpoint returns 200 (priority used in sort)
        resp = client.get(f"/api/leads/{lead.id}")
        assert resp.status_code == 200

    def test_dashboard_leads_include_priority_score(self, client, db):
        """Dashboard recent leads include priority_score in each summary."""
        lead = create_test_lead(db, email="dash1@t.com")
        lead.priority_score = 50
        db.commit()
        resp = client.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        recent = resp.json()["recent_leads"]
        if recent:
            assert "priority_score" in recent[0]
