"""
T6 — Research Cache v2 Tests (8 tests)
========================================
Tests for the v2 company-level research cache behaviour:

  EC-16: Old v1 cache entries (missing heat/opening) treated as miss
  EC-12: Race condition on cache upsert handled gracefully
  Cache TTL: entries older than CACHE_TTL_DAYS are treated as stale
  _cache_has_v2_fields: utility function correctness
  _update_company_cache: upsert creates and updates correctly
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

import models
from conftest import create_test_lead, create_test_user, SUPER_ADMIN, create_sync_settings


def _make_cache_entry(db, company_key, heat=None, opening=None, days_old=0):
    """Create a CompanyResearch cache entry, optionally with v2 fields."""
    from sqlalchemy.exc import IntegrityError
    updated_at = datetime.now(timezone.utc) - timedelta(days=days_old)
    # Try to find existing first
    existing = db.query(models.CompanyResearch).filter(
        models.CompanyResearch.company_name == company_key
    ).first()
    if existing:
        existing.research_heat    = heat
        existing.research_opening = opening
        existing.updated_at       = updated_at
        db.commit()
        return existing
    entry = models.CompanyResearch(
        company_name=company_key,
        research_heat=heat,
        research_opening=opening,
        updated_at=updated_at,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ─────────────────────────────────────────────────────────────────────────────
# _cache_has_v2_fields
# ─────────────────────────────────────────────────────────────────────────────

class TestCacheHasV2Fields:
    """Unit tests for the _cache_has_v2_fields() utility."""

    def test_cv01_returns_true_when_both_fields_present(self, db):
        """CV-01: True when both research_heat and research_opening are set."""
        from routes.ai_research_routes import _cache_has_v2_fields
        entry = _make_cache_entry(db, "cv01corp", heat="warm", opening="Hi there!")
        assert _cache_has_v2_fields(entry) is True

    def test_cv02_returns_false_when_heat_missing(self, db):
        """CV-02: False when research_heat is None (v1 cache entry)."""
        from routes.ai_research_routes import _cache_has_v2_fields
        entry = _make_cache_entry(db, "cv02corp", heat=None, opening="Hi there!")
        assert _cache_has_v2_fields(entry) is False

    def test_cv03_returns_false_when_opening_missing(self, db):
        """CV-03: False when research_opening is None (v1 cache entry)."""
        from routes.ai_research_routes import _cache_has_v2_fields
        entry = _make_cache_entry(db, "cv03corp", heat="warm", opening=None)
        assert _cache_has_v2_fields(entry) is False

    def test_cv04_returns_false_when_both_missing(self, db):
        """CV-04: False when both v2 fields are None (pure v1 entry)."""
        from routes.ai_research_routes import _cache_has_v2_fields
        entry = _make_cache_entry(db, "cv04corp", heat=None, opening=None)
        assert _cache_has_v2_fields(entry) is False


# ─────────────────────────────────────────────────────────────────────────────
# EC-16: v1 cache treated as miss
# ─────────────────────────────────────────────────────────────────────────────

class TestV1CacheUpgrade:
    """EC-16: Old v1 cache entries without heat/opening are treated as cache misses."""

    def test_cv05_v1_cache_triggers_groq_call(self, db):
        """CV-05: v1 cache (missing heat+opening) → research is regenerated."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from routes.ai_research_routes import router as research_router
        from auth import get_current_user
        from database import get_db

        # Create a v1 cache entry (no heat, no opening)
        lead = create_test_lead(db, email="cv05@t.com")
        lead.company = "CV05Corp"
        db.commit()
        _make_cache_entry(db, "cv05corp", heat=None, opening=None)

        app = FastAPI()
        app.include_router(research_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: SUPER_ADMIN

        client = TestClient(app)

        mock_result = {
            "company_pulse": "CV05 does SaaS",
            "why_they_need_us": "Call tracking",
            "opening_line": "Hi, saw you are growing",
            "likely_objection": "Cost → ROI is clear",
            "persona_signal": "COO — full authority",
            "heat_score": "warm, COO at mid-size firm",
        }

        with patch("routes.ai_research_routes._call_groq_single", return_value=mock_result):
            resp = client.post(f"/api/leads/{lead.id}/ai-research")

        assert resp.status_code == 200
        data = resp.json()
        assert data["from_cache"] is False  # v1 cache was treated as miss
        assert data["heat_score"] == "warm"


# ─────────────────────────────────────────────────────────────────────────────
# _update_company_cache (upsert)
# ─────────────────────────────────────────────────────────────────────────────

class TestUpdateCompanyCache:
    """Tests for the _update_company_cache() upsert function."""

    def _result(self):
        return {
            "research_company": "Acme does SaaS",
            "research_hypothesis": "Needs call tracking",
            "research_personalization": "Ops teams love efficiency",
            "research_contact": "Jane is COO",
            "research_hook": "Hi, how do you track SDR calls?",
            "research_heat": "hot",
            "research_opening": "Hi there, quick question about your SDR process?",
        }

    def test_cv06_creates_new_cache_entry(self, db):
        """CV-06: _update_company_cache creates a new row when none exists."""
        from routes.ai_research_routes import _update_company_cache
        key = f"cv06newcorp_{id(db)}"
        _update_company_cache(db, key, self._result(), {})
        entry = db.query(models.CompanyResearch).filter(
            models.CompanyResearch.company_name == key
        ).first()
        assert entry is not None
        assert entry.research_heat == "hot"

    def test_cv07_updates_existing_cache_entry(self, db):
        """CV-07: _update_company_cache updates existing row (upsert)."""
        from routes.ai_research_routes import _update_company_cache
        key = f"cv07updcorp_{id(db)}"
        _make_cache_entry(db, key, heat="cold", opening="Old opening")
        new_result = {**self._result(), "research_heat": "warm", "research_opening": "New opening"}
        _update_company_cache(db, key, new_result, {})
        entry = db.query(models.CompanyResearch).filter(
            models.CompanyResearch.company_name == key
        ).first()
        assert entry.research_heat == "warm"
        assert entry.research_opening == "New opening"

    def test_cv08_stale_cache_not_used(self, db):
        """CV-08: Cache entries older than CACHE_TTL_DAYS are treated as stale."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from routes.ai_research_routes import router as research_router, CACHE_TTL_DAYS
        from auth import get_current_user
        from database import get_db

        lead = create_test_lead(db, email="cv08@t.com")
        lead.company = "CV08StaleCompany"
        db.commit()

        # Insert cache entry older than TTL
        _make_cache_entry(db, "cv08stalecompany", heat="warm",
                          opening="Old stale line", days_old=CACHE_TTL_DAYS + 1)

        app = FastAPI()
        app.include_router(research_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: SUPER_ADMIN
        client = TestClient(app)

        mock_result = {
            "company_pulse": "CV08 does SaaS",
            "why_they_need_us": "Call tracking",
            "opening_line": "Hi fresh line",
            "likely_objection": "Cost → ROI",
            "persona_signal": "Founder",
            "heat_score": "hot, founder at startup",
        }

        with patch("routes.ai_research_routes._call_groq_single", return_value=mock_result):
            resp = client.post(f"/api/leads/{lead.id}/ai-research")

        assert resp.status_code == 200
        data = resp.json()
        # Stale cache → must have called Groq → from_cache=False
        assert data["from_cache"] is False
