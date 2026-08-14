"""
Tests for V26 changes:
  1. Upload batch detail — assigned_to field + sdr_name convenience field
  2. Upload tag system — tag stored and exposed in logs/metrics
  3. Daily Digest — working-day comparison logic
"""
import json
import uuid
from datetime import datetime, timedelta, timezone, date as _date

import pytest

import models
from conftest import (
    create_test_user,
    create_test_lead,
    create_test_pod,
    create_sync_settings,
    SUPER_ADMIN,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _create_upload_log(db, filename="test.csv", tag=None, total_rows=5,
                       created=5, skipped=0, errors=0, status="completed",
                       uploaded_by=None, created_at=None):
    """Create a LeadUploadLog for testing."""
    log = models.LeadUploadLog(
        uploaded_by=uploaded_by or SUPER_ADMIN["sub"],
        filename=filename,
        total_rows=total_rows,
        created=created,
        skipped=skipped,
        errors=errors,
        status=status,
        tag=tag,
    )
    if created_at:
        log.created_at = created_at
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def _create_lead_with_source(db, lead_source, first_name="John", last_name="Doe",
                              email=None, company="Acme", status="Lead Assigned"):
    """Create a lead with a specific lead_source (for batch matching)."""
    email = email or f"{uuid.uuid4().hex[:8]}@test.com"
    lead = models.Lead(
        first_name=first_name, last_name=last_name, email=email,
        company=company, status=status, lead_source=lead_source,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


def _assign_lead_to_user(db, lead, user):
    """Assign a lead to a user via the association table."""
    from sqlalchemy import text
    db.execute(
        models.lead_assignments.insert().values(user_id=user.id, lead_id=lead.id)
    )
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Upload Batch Detail — assigned_to + sdr_name fields
# ═══════════════════════════════════════════════════════════════════════════════

class TestBatchLeadDetail:
    """Verify that the batch lead detail endpoint returns correct SDR info."""

    def test_assigned_to_returns_sdr_names(self, client, db):
        """assigned_to should contain actual SDR names, not be empty."""
        sdr = create_test_user(db, email="alice@test.com", name="Alice SDR", role="SDR")
        log = _create_upload_log(db, filename="batch_test.csv", created=1)
        lead = _create_lead_with_source(db, lead_source=f"upload:{log.filename}")
        _assign_lead_to_user(db, lead, sdr)

        res = client.get(f"/api/admin/leads/upload-batch-metrics/{log.id}/leads")
        assert res.status_code == 200
        data = res.json()
        assert data["total"] >= 1

        found = [l for l in data["leads"] if l["id"] == lead.id]
        assert len(found) == 1
        assert "Alice SDR" in found[0]["assigned_to"]

    def test_sdr_name_convenience_field(self, client, db):
        """sdr_name should return the first assigned SDR's name."""
        sdr = create_test_user(db, email="bob@test.com", name="Bob SDR", role="SDR")
        log = _create_upload_log(db, filename="sdr_test.csv", created=1)
        lead = _create_lead_with_source(db, lead_source=f"upload:{log.filename}")
        _assign_lead_to_user(db, lead, sdr)

        res = client.get(f"/api/admin/leads/upload-batch-metrics/{log.id}/leads")
        data = res.json()
        found = [l for l in data["leads"] if l["id"] == lead.id]
        assert len(found) == 1
        assert found[0]["sdr_name"] == "Bob SDR"

    def test_unassigned_lead_has_null_sdr_name(self, client, db):
        """Unassigned leads should have sdr_name=None and assigned_to=[]."""
        log = _create_upload_log(db, filename="no_assign.csv", created=1)
        lead = _create_lead_with_source(db, lead_source=f"upload:{log.filename}")

        res = client.get(f"/api/admin/leads/upload-batch-metrics/{log.id}/leads")
        data = res.json()
        found = [l for l in data["leads"] if l["id"] == lead.id]
        assert len(found) == 1
        assert found[0]["assigned_to"] == []
        assert found[0]["sdr_name"] is None


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Upload Tag System
# ═══════════════════════════════════════════════════════════════════════════════

class TestUploadTag:
    """Verify the optional tag field on upload logs."""

    def test_tag_stored_and_returned_in_upload_logs(self, client, db):
        """Tag should be stored in the model and returned by GET /upload-logs."""
        _create_upload_log(db, filename="tagged.csv", tag="Apollo")

        res = client.get("/api/admin/leads/upload-logs")
        assert res.status_code == 200
        logs = res.json()["logs"]
        tagged = [l for l in logs if l["filename"] == "tagged.csv"]
        assert len(tagged) == 1
        assert tagged[0]["tag"] == "Apollo"

    def test_tag_null_when_not_provided(self, client, db):
        """When tag is not provided, it should be None in the response."""
        _create_upload_log(db, filename="no_tag.csv", tag=None)

        res = client.get("/api/admin/leads/upload-logs")
        logs = res.json()["logs"]
        no_tag = [l for l in logs if l["filename"] == "no_tag.csv"]
        assert len(no_tag) == 1
        assert no_tag[0]["tag"] is None

    def test_tag_in_batch_metrics(self, client, db):
        """Tag should also be present in the upload-batch-metrics response."""
        _create_upload_log(db, filename="metrics_tag.csv", tag="Lusha")

        res = client.get("/api/admin/leads/upload-batch-metrics")
        assert res.status_code == 200
        logs = res.json()
        tagged = [l for l in logs if l["filename"] == "metrics_tag.csv"]
        assert len(tagged) == 1
        assert tagged[0]["tag"] == "Lusha"

    def test_tag_model_max_length(self, db):
        """Tag should be stored even if it's at max 50 chars."""
        long_tag = "A" * 50
        log = _create_upload_log(db, filename="long_tag.csv", tag=long_tag)
        db.refresh(log)
        assert log.tag == long_tag
        assert len(log.tag) == 50

    def test_tag_stored_with_csv_upload(self, client, db):
        """CSV upload endpoint should accept and store the tag."""
        create_sync_settings(db)
        payload = {
            "csv": "first_name,last_name,email,company\nTest,User,tag_upload@test.com,TestCo",
            "mapping": {
                "first_name": "first_name",
                "last_name": "last_name",
                "email": "email",
                "company": "company",
            },
            "filename": "tag_upload_test.csv",
            "tag": "Hunter",
        }
        res = client.post("/api/admin/leads/upload-sheet", json=payload)
        assert res.status_code == 200

        # Verify the tag was persisted
        log = db.query(models.LeadUploadLog).filter(
            models.LeadUploadLog.filename == "tag_upload_test.csv"
        ).first()
        assert log is not None
        assert log.tag == "Hunter"

    def test_empty_tag_stored_as_null(self, client, db):
        """Empty or whitespace-only tags should be stored as NULL."""
        create_sync_settings(db)
        payload = {
            "csv": "first_name,last_name,email,company\nTest,User,empty_tag@test.com,TestCo",
            "mapping": {
                "first_name": "first_name",
                "last_name": "last_name",
                "email": "email",
                "company": "company",
            },
            "filename": "empty_tag_test.csv",
            "tag": "   ",
        }
        res = client.post("/api/admin/leads/upload-sheet", json=payload)
        assert res.status_code == 200

        log = db.query(models.LeadUploadLog).filter(
            models.LeadUploadLog.filename == "empty_tag_test.csv"
        ).first()
        assert log is not None
        assert log.tag is None


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Daily Digest — Working-Day Comparison
# ═══════════════════════════════════════════════════════════════════════════════

class TestDailyDigestWorkingDay:
    """Verify that daily digest skips weekends for comparison dates."""

    def test_weekday_returns_same_date(self, client, db):
        """A weekday date should be returned as-is (no adjustment)."""
        # 2026-04-22 is a Wednesday (weekday=2) — always in the past
        d = "2026-04-22"

        res = client.get(f"/api/admin/analytics/daily-digest?date={d}")
        assert res.status_code == 200
        data = res.json()
        assert data["digest_date"] == d
        assert data["is_working_day"] is True
        assert data["original_date"] == d

    def test_saturday_adjusts_to_friday(self, client, db):
        """A Saturday should auto-adjust to the previous Friday."""
        # 2026-04-25 is a Saturday (weekday=5) → should adjust to 2026-04-24 (Friday)
        d = "2026-04-25"
        expected_friday = "2026-04-24"

        res = client.get(f"/api/admin/analytics/daily-digest?date={d}")
        assert res.status_code == 200
        data = res.json()
        assert data["digest_date"] == expected_friday
        assert data["is_working_day"] is False
        assert data["original_date"] == d

    def test_sunday_adjusts_to_friday(self, client, db):
        """A Sunday should auto-adjust to the previous Friday."""
        # 2026-04-26 is a Sunday (weekday=6) → should adjust to 2026-04-24 (Friday)
        d = "2026-04-26"
        expected_friday = "2026-04-24"

        res = client.get(f"/api/admin/analytics/daily-digest?date={d}")
        assert res.status_code == 200
        data = res.json()
        assert data["digest_date"] == expected_friday
        assert data["is_working_day"] is False
        assert data["original_date"] == d

    def test_comparison_date_is_working_day(self, client, db):
        """The comparison date should also be a working day (Mon-Fri)."""
        # 2026-04-23 is a Thursday — always in the past
        d = "2026-04-23"

        res = client.get(f"/api/admin/analytics/daily-digest?date={d}")
        assert res.status_code == 200
        data = res.json()
        compare = _date.fromisoformat(data["comparison_date"])
        # comparison_date must be Mon-Fri (weekday 0-4)
        assert compare.weekday() < 5, f"Comparison date {compare} is a weekend"

    def test_digest_response_has_kpi_section(self, client, db):
        """Ensure the response still contains the standard KPI section."""
        # 2026-04-21 is a Tuesday — always in the past
        d = "2026-04-21"

        res = client.get(f"/api/admin/analytics/daily-digest?date={d}")
        assert res.status_code == 200
        data = res.json()
        assert "kpi" in data
        assert "new_leads" in data["kpi"]
        assert "calls_made" in data["kpi"]
        assert "meetings_booked" in data["kpi"]
        assert "pipeline_moved" in data["kpi"]
        assert "leads_researched" in data["kpi"]
        assert "demos_completed" in data["kpi"]

    def test_digest_future_date_rejected(self, client, db):
        """Future dates should still return 400."""
        tomorrow = datetime.now(timezone.utc).date() + timedelta(days=1)
        res = client.get(f"/api/admin/analytics/daily-digest?date={tomorrow}")
        assert res.status_code == 400
