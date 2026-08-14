"""
Tests for CRM Stability & UX fixes (v5.2):
  1. Lead count fix — parked lead exclusion from listing endpoints
  2. Rollback endpoint — 12h window, safety guards, cascade deletes
  3. Upload log response — rollback eligibility fields
  4. Edge cases — race conditions, GSheet vs CSV, protected leads
"""
import json
import pytest
from datetime import datetime, timezone, timedelta
from conftest import (
    create_test_user, create_test_lead, create_test_call,
    create_test_note, create_test_task,
    SUPER_ADMIN, SDR_USER,
)
import models


# ─── Factory helpers ──────────────────────────────────────────────────────────

def create_upload_log(db, filename="test_leads.csv", created=10, skipped=2,
                      errors=0, status="completed", uploaded_by=None,
                      created_at=None):
    """Create a LeadUploadLog for testing."""
    log = models.LeadUploadLog(
        filename=filename,
        total_rows=created + skipped + errors,
        created=created,
        skipped=skipped,
        errors=errors,
        status=status,
        uploaded_by=uploaded_by,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    # Override created_at if specified (server_default won't work for SQLite in tests)
    if created_at:
        from sqlalchemy import text
        db.execute(
            text("UPDATE lead_upload_logs SET created_at = :ts WHERE id = :lid"),
            {"ts": created_at.isoformat(), "lid": log.id}
        )
        db.commit()
        db.refresh(log)

    return log


def create_batch_lead(db, filename, status="Lead Assigned", lead_source=None,
                      created_at=None, phone=None):
    """Create a lead that looks like it came from a CSV upload batch."""
    source = lead_source or f"upload:{filename}:{datetime.now(timezone.utc).isoformat()}"
    lead = create_test_lead(
        db, last_name=f"Batch-{status}", company="BatchCo",
        status=status, lead_source=source, phone=phone,
    )
    if created_at:
        from sqlalchemy import text
        db.execute(
            text("UPDATE leads SET created_at = :ts WHERE id = :lid"),
            {"ts": created_at.isoformat(), "lid": lead.id}
        )
        db.commit()
        db.refresh(lead)
    return lead


# ═══════════════════════════════════════════════════════════════════════════════
# 1. LEAD COUNT FIX — Parked lead exclusion
# ═══════════════════════════════════════════════════════════════════════════════

class TestParkedLeadExclusion:
    """Verify parked leads are excluded from listing endpoints by default."""

    def test_get_leads_excludes_parked(self, client, db):
        """GET /api/leads should NOT include 'No Phone - Parked' leads."""
        create_test_lead(db, last_name="Active", status="Lead Assigned")
        create_test_lead(db, last_name="Parked", status="No Phone - Parked")
        create_test_lead(db, last_name="Research", status="Research")

        resp = client.get("/api/leads")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2  # Active + Research, NOT Parked
        names = [l["last_name"] for l in data["data"]]
        assert "Active" in names
        assert "Research" in names
        assert "Parked" not in names

    def test_get_leads_shows_parked_when_filtered(self, client, db):
        """GET /api/leads?status=No Phone - Parked should show parked leads."""
        create_test_lead(db, last_name="Active", status="Lead Assigned")
        create_test_lead(db, last_name="Parked", status="No Phone - Parked")

        resp = client.get("/api/leads", params={"status": "No Phone - Parked"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["data"][0]["last_name"] == "Parked"

    def test_get_kanban_excludes_parked(self, client, db):
        """GET /api/leads/kanban should NOT include parked leads."""
        create_test_lead(db, last_name="Pipeline", status="Calling")
        create_test_lead(db, last_name="Parked", status="No Phone - Parked")

        resp = client.get("/api/leads/kanban")
        assert resp.status_code == 200
        leads = resp.json()
        names = [l["last_name"] for l in leads]
        assert "Pipeline" in names
        assert "Parked" not in names

    def test_dashboard_stats_still_excludes_parked(self, client, db):
        """Dashboard stats already excluded parked — verify it's still correct."""
        create_test_lead(db, last_name="Active", status="Lead Assigned")
        create_test_lead(db, last_name="Parked", status="No Phone - Parked")

        resp = client.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        stats = resp.json()
        assert stats["total"] == 1  # Only the non-parked lead

    def test_leads_and_dashboard_counts_match(self, client, db):
        """Core fix: lead list total should match dashboard total."""
        for i in range(5):
            create_test_lead(db, last_name=f"Active-{i}", status="Lead Assigned",
                             email=f"active{i}@test.com")
        for i in range(3):
            create_test_lead(db, last_name=f"Parked-{i}", status="No Phone - Parked",
                             email=f"parked{i}@test.com")

        leads_resp = client.get("/api/leads")
        dashboard_resp = client.get("/api/leads/dashboard-stats")

        leads_total = leads_resp.json()["total"]
        dashboard_total = dashboard_resp.json()["total"]
        assert leads_total == dashboard_total == 5


# ═══════════════════════════════════════════════════════════════════════════════
# 2. UPLOAD LOG RESPONSE — Rollback eligibility
# ═══════════════════════════════════════════════════════════════════════════════

class TestUploadLogRollbackFields:
    """Verify upload-logs response includes rollback eligibility info."""

    def test_recent_upload_is_rollback_eligible(self, client, db):
        """Upload within 12h should have can_rollback=True."""
        user = create_test_user(db, email="uploader@test.com", role="Super Admin")
        now = datetime.now(timezone.utc)
        log = create_upload_log(db, filename="recent.csv", created=10,
                                uploaded_by=user.id, created_at=now)

        resp = client.get("/api/admin/leads/upload-logs")
        assert resp.status_code == 200
        data = resp.json()
        logs = data["logs"]
        assert len(logs) >= 1
        found = next(l for l in logs if l["id"] == log.id)
        assert found["can_rollback"] is True
        assert found["rollback_hours_remaining"] > 0

    def test_old_upload_not_rollback_eligible(self, client, db):
        """Upload older than 12h should have can_rollback=False."""
        user = create_test_user(db, email="uploader@test.com", role="Super Admin")
        old_time = datetime.now(timezone.utc) - timedelta(hours=13)
        log = create_upload_log(db, filename="old.csv", created=10,
                                uploaded_by=user.id, created_at=old_time)

        resp = client.get("/api/admin/leads/upload-logs")
        logs = resp.json()["logs"]
        found = next(l for l in logs if l["id"] == log.id)
        assert found["can_rollback"] is False
        assert found["rollback_hours_remaining"] == 0

    def test_rolled_back_log_not_eligible(self, client, db):
        """Already rolled-back log should not be eligible again."""
        user = create_test_user(db, email="uploader@test.com", role="Super Admin")
        now = datetime.now(timezone.utc)
        log = create_upload_log(db, filename="done.csv", created=5, status="rolled_back",
                                uploaded_by=user.id, created_at=now)

        resp = client.get("/api/admin/leads/upload-logs")
        logs = resp.json()["logs"]
        found = next(l for l in logs if l["id"] == log.id)
        assert found["can_rollback"] is False

    def test_zero_creates_not_eligible(self, client, db):
        """Upload with 0 created leads should not be eligible for rollback."""
        user = create_test_user(db, email="uploader@test.com", role="Super Admin")
        now = datetime.now(timezone.utc)
        log = create_upload_log(db, filename="noop.csv", created=0, skipped=10,
                                uploaded_by=user.id, created_at=now)

        resp = client.get("/api/admin/leads/upload-logs")
        logs = resp.json()["logs"]
        found = next(l for l in logs if l["id"] == log.id)
        assert found["can_rollback"] is False


# ═══════════════════════════════════════════════════════════════════════════════
# 3. ROLLBACK ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════════

class TestRollbackEndpoint:
    """Test POST /api/admin/upload-logs/{log_id}/rollback."""

    def _setup_batch(self, db, filename="batch.csv", lead_count=5, hours_ago=0):
        """Helper: create upload log + matching leads."""
        user = create_test_user(db, email="uploader@test.com", role="Super Admin")
        upload_time = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        log = create_upload_log(db, filename=filename, created=lead_count,
                                uploaded_by=user.id, created_at=upload_time)

        leads = []
        for i in range(lead_count):
            lead = create_batch_lead(
                db, filename=filename, status="Lead Assigned",
                lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                created_at=upload_time,
            )
            leads.append(lead)
        return log, leads, user

    def test_rollback_deletes_safe_leads(self, client, db):
        """Rollback should delete leads in safe statuses."""
        log, leads, _ = self._setup_batch(db, lead_count=3)
        lead_ids = [l.id for l in leads]

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 200
        result = resp.json()
        assert result["rolled_back"] == 3
        assert result["protected"] == 0

        # Verify leads are gone
        remaining = db.query(models.Lead).filter(models.Lead.id.in_(lead_ids)).count()
        assert remaining == 0

    def test_rollback_protects_progressed_leads(self, client, db):
        """Leads that moved beyond safe statuses should be protected."""
        user = create_test_user(db, email="uploader2@test.com", role="Super Admin")
        upload_time = datetime.now(timezone.utc)
        filename = "mixed.csv"
        log = create_upload_log(db, filename=filename, created=3,
                                uploaded_by=user.id, created_at=upload_time)

        # Safe lead
        safe = create_batch_lead(db, filename=filename, status="Lead Assigned",
                                 lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                                 created_at=upload_time)
        safe_id = safe.id
        # Progressed lead
        progressed = create_batch_lead(db, filename=filename, status="Calling - Attempting",
                                       lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                                       created_at=upload_time)
        progressed_id = progressed.id
        # Meeting lead
        meeting = create_batch_lead(db, filename=filename, status="Meeting Scheduled",
                                    lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                                    created_at=upload_time)
        meeting_id = meeting.id

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 200
        result = resp.json()
        assert result["rolled_back"] == 1  # Only the safe one
        assert result["protected"] == 2    # progressed + meeting

        # Verify protected leads still exist
        assert db.query(models.Lead).filter(models.Lead.id == progressed_id).first() is not None
        assert db.query(models.Lead).filter(models.Lead.id == meeting_id).first() is not None
        # Verify safe lead is deleted
        assert db.query(models.Lead).filter(models.Lead.id == safe_id).first() is None

    def test_rollback_protects_called_leads(self, client, db):
        """Leads with call history should be protected even in safe status."""
        user = create_test_user(db, email="caller@test.com", role="SDR")
        upload_time = datetime.now(timezone.utc)
        filename = "called.csv"
        log = create_upload_log(db, filename=filename, created=2,
                                uploaded_by=user.id, created_at=upload_time)

        # Lead with call
        called = create_batch_lead(db, filename=filename, status="Lead Assigned",
                                   lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                                   created_at=upload_time)
        create_test_call(db, lead_id=called.id, user_id=user.id, outcome="No Answer")

        # Lead without call
        uncalled = create_batch_lead(db, filename=filename, status="Lead Assigned",
                                     lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                                     created_at=upload_time)

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 200
        result = resp.json()
        assert result["rolled_back"] == 1   # uncalled
        assert result["protected"] == 1     # called

        # Called lead should survive
        assert db.query(models.Lead).filter(models.Lead.id == called.id).first() is not None

    def test_rollback_expired_window(self, client, db):
        """Rollback should fail if upload is older than 12 hours."""
        log, _, _ = self._setup_batch(db, filename="expired.csv", hours_ago=13)

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 403
        assert "expired" in resp.json()["detail"].lower()

    def test_rollback_already_rolled_back(self, client, db):
        """Cannot rollback the same batch twice."""
        log, _, _ = self._setup_batch(db, filename="double.csv")

        # First rollback
        resp1 = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp1.status_code == 200

        # Second rollback should fail
        resp2 = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp2.status_code == 400
        assert "already been rolled back" in resp2.json()["detail"]

    def test_rollback_not_found(self, client, db):
        """Rollback on non-existent log should return 404."""
        resp = client.post("/api/admin/leads/upload-logs/nonexistent-id/rollback")
        assert resp.status_code == 404

    def test_rollback_cascades_notes_and_tasks(self, client, db):
        """Rollback should cascade-delete child records (notes, tasks)."""
        log, leads, _ = self._setup_batch(db, filename="cascade.csv", lead_count=1)
        lead = leads[0]
        lead_id = lead.id

        # Add child records
        create_test_note(db, lead_id=lead_id, content="Test note")
        create_test_task(db, lead_id=lead_id, title="Follow up")

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 200
        assert resp.json()["rolled_back"] == 1

        # Verify children are also gone
        notes = db.query(models.Note).filter(models.Note.lead_id == lead_id).count()
        tasks = db.query(models.Task).filter(models.Task.lead_id == lead_id).count()
        assert notes == 0
        assert tasks == 0

    def test_rollback_updates_log_status(self, client, db):
        """After rollback, log status should be 'rolled_back'."""
        log, _, _ = self._setup_batch(db, filename="status.csv", lead_count=1)

        client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")

        db.refresh(log)
        assert log.status == "rolled_back"

    def test_rollback_parked_leads_are_safe_status(self, client, db):
        """'No Phone - Parked' leads should be included in safe statuses for rollback."""
        user = create_test_user(db, email="parker@test.com", role="Super Admin")
        upload_time = datetime.now(timezone.utc)
        filename = "parked.csv"
        log = create_upload_log(db, filename=filename, created=1,
                                uploaded_by=user.id, created_at=upload_time)

        parked = create_batch_lead(db, filename=filename, status="No Phone - Parked",
                                   lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                                   created_at=upload_time)

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 200
        assert resp.json()["rolled_back"] == 1


# ═══════════════════════════════════════════════════════════════════════════════
# 4. GSHEET ROLLBACK — Source pattern matching
# ═══════════════════════════════════════════════════════════════════════════════

class TestGSheetRollback:
    """Verify rollback works for Google Sheet imports (different source pattern)."""

    def test_gsheet_rollback_matches_source(self, client, db):
        """GSheet leads use 'gsheet:{name}:...' source, not 'upload:...'."""
        user = create_test_user(db, email="gsheet@test.com", role="Super Admin")
        upload_time = datetime.now(timezone.utc)
        sheet_name = "US Leads Q2"
        filename = f"gsheet-{sheet_name}"
        log = create_upload_log(db, filename=filename, created=2,
                                uploaded_by=user.id, created_at=upload_time)

        # GSheet leads have source: "gsheet:{sheet_name}:{ts}"
        gsheet_source = f"gsheet:{sheet_name}:{upload_time.isoformat()}"
        lead1 = create_batch_lead(db, filename=filename, status="Lead Assigned",
                                  lead_source=gsheet_source, created_at=upload_time)
        lead2 = create_batch_lead(db, filename=filename, status="Research",
                                  lead_source=gsheet_source, created_at=upload_time)
        lead1_id = lead1.id
        lead2_id = lead2.id

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 200
        result = resp.json()
        assert result["rolled_back"] == 2

        # Verify leads deleted
        assert db.query(models.Lead).filter(models.Lead.id == lead1_id).first() is None
        assert db.query(models.Lead).filter(models.Lead.id == lead2_id).first() is None


# ═══════════════════════════════════════════════════════════════════════════════
# 5. ROLLBACK RESPONSE DETAILS
# ═══════════════════════════════════════════════════════════════════════════════

class TestRollbackResponseDetails:
    """Verify rollback response includes useful feedback."""

    def test_response_includes_protection_reasons(self, client, db):
        """Protected leads should have reason strings in the response."""
        user = create_test_user(db, email="detail@test.com", role="SDR")
        upload_time = datetime.now(timezone.utc)
        filename = "detail.csv"
        log = create_upload_log(db, filename=filename, created=2,
                                uploaded_by=user.id, created_at=upload_time)

        # Progressed lead (protected)
        progressed = create_batch_lead(db, filename=filename, status="Calling - Attempting",
                                       lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                                       created_at=upload_time)
        # Called lead (protected)
        called = create_batch_lead(db, filename=filename, status="Lead Assigned",
                                   lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                                   created_at=upload_time)
        create_test_call(db, lead_id=called.id, user_id=user.id)

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        result = resp.json()
        assert result["protected"] == 2
        assert len(result["protected_details"]) == 2

        reasons = [d["reason"] for d in result["protected_details"]]
        assert any("Status progressed" in r for r in reasons)
        assert any("call" in r.lower() for r in reasons)


# ═══════════════════════════════════════════════════════════════════════════════
# 6. EDGE CASES
# ═══════════════════════════════════════════════════════════════════════════════

class TestEdgeCases:
    """Edge cases for all fixes."""

    def test_no_parked_leads_no_change(self, client, db):
        """If no parked leads exist, counts should be unchanged."""
        for i in range(3):
            create_test_lead(db, last_name=f"Lead-{i}", status="Lead Assigned",
                             email=f"lead{i}@test.com")

        resp = client.get("/api/leads")
        assert resp.json()["total"] == 3

    def test_rollback_no_matching_leads(self, client, db):
        """Rollback with no matching leads should return 0 rolled back."""
        user = create_test_user(db, email="empty@test.com", role="Super Admin")
        now = datetime.now(timezone.utc)
        log = create_upload_log(db, filename="noleads.csv", created=5,
                                uploaded_by=user.id, created_at=now)
        # No leads were created with this source

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 200
        assert resp.json()["rolled_back"] == 0

    def test_rollback_no_filename(self, client, db):
        """Rollback should fail gracefully if log has no filename."""
        user = create_test_user(db, email="noname@test.com", role="Super Admin")
        now = datetime.now(timezone.utc)
        log = create_upload_log(db, filename="", created=5,
                                uploaded_by=user.id, created_at=now)

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 400
        assert "filename" in resp.json()["detail"].lower()

    def test_mixed_statuses_counts_in_list(self, client, db):
        """Verify all non-parked statuses appear in list, only parked excluded."""
        statuses = ["Lead Assigned", "Research", "Calling - Attempting",
                    "Meeting Scheduled", "No Phone - Parked"]
        for i, st in enumerate(statuses):
            create_test_lead(db, last_name=f"S{i}", status=st,
                             email=f"s{i}@test.com")

        resp = client.get("/api/leads")
        assert resp.json()["total"] == 4  # 5 - 1 parked

    def test_rollback_research_status_is_safe(self, client, db):
        """'Research' status should be considered safe for rollback."""
        user = create_test_user(db, email="research@test.com", role="Super Admin")
        upload_time = datetime.now(timezone.utc)
        filename = "research.csv"
        log = create_upload_log(db, filename=filename, created=1,
                                uploaded_by=user.id, created_at=upload_time)

        lead = create_batch_lead(db, filename=filename, status="Research",
                                 lead_source=f"upload:{filename}:{upload_time.isoformat()}",
                                 created_at=upload_time)

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 200
        assert resp.json()["rolled_back"] == 1

    def test_rollback_boundary_12h(self, client, db):
        """Upload at exactly 12h boundary should still fail (> check)."""
        user = create_test_user(db, email="boundary@test.com", role="Super Admin")
        # 12 hours and 1 minute ago
        upload_time = datetime.now(timezone.utc) - timedelta(hours=12, minutes=1)
        log = create_upload_log(db, filename="boundary.csv", created=1,
                                uploaded_by=user.id, created_at=upload_time)

        resp = client.post(f"/api/admin/leads/upload-logs/{log.id}/rollback")
        assert resp.status_code == 403
