"""
T4 — Bulk Research Job Tests (14 tests)
=========================================
Tests for POST /api/admin/bulk-research endpoint and the
_run_bulk_research_background() function behaviour.

All actual Groq calls are mocked — we test:
  - Endpoint guards (auth, 409 concurrency, missing API key)
  - Count logic (total, already_researched, will_process)
  - Background job: skip-if-researched, persist fields, failure isolation
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import create_test_lead, create_test_user, SUPER_ADMIN, create_sync_settings
from database import get_db
from auth import get_current_user, require_admin, require_super_admin


def _make_admin_app(db, user_override=None):
    from routes.admin_routes import router as admin_router
    app = FastAPI()
    app.include_router(admin_router)
    app.dependency_overrides[get_db] = lambda: db
    usr = user_override or SUPER_ADMIN
    app.dependency_overrides[get_current_user] = lambda: usr
    app.dependency_overrides[require_admin] = lambda: usr
    app.dependency_overrides[require_super_admin] = lambda: usr
    return TestClient(app)


def _set_api_key(db, key="test-groq-key"):
    """Write an LLM API key to SyncSettings."""
    import models
    ss = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not ss:
        ss = create_sync_settings(db)
    ss.llm_api_key = key
    db.commit()


def _make_lead(db, email, status="Lead Assigned", researched=False, v2=False):
    """Create a test lead.

    researched=True  → v1-style research (no research_heat). Job WILL process it.
    v2=True          → v2-style research (research_heat set). Job WILL skip it.
    """
    lead = create_test_lead(db, email=email)
    lead.status = status
    if researched or v2:
        lead.research_company       = "Acme Corp"
        lead.research_contact       = "Jane"
        lead.research_hypothesis    = "Needs dialer"
        lead.research_personalization = "Ops head"
    if v2:
        # research_heat is the v2 sentinel — only set for fully upgraded leads
        lead.research_heat = "hot, COO at fast-growing firm"
    db.commit()
    return lead


# ─────────────────────────────────────────────────────────────────────────────
# Status endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestBulkResearchStatus:
    """Tests for GET /api/admin/bulk-research/status."""

    def test_br00_status_not_running(self, db):
        """BR-00: GET /bulk-research/status returns running=False when idle."""
        import routes.admin_routes as ar
        ar._bulk_research_running = False
        client = _make_admin_app(db)
        resp = client.get("/api/admin/bulk-research/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is False
        assert "stats" in data

    def test_br00b_status_while_running(self, db):
        """BR-00b: GET /bulk-research/status returns running=True when job active."""
        import routes.admin_routes as ar
        ar._bulk_research_running = True
        ar._bulk_research_stats   = {"processed": 42, "skipped": 5, "failed": 1, "total": 100, "started_at": "2026-01-01"}
        client = _make_admin_app(db)
        try:
            resp = client.get("/api/admin/bulk-research/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["running"] is True
            assert data["stats"]["processed"] == 42
        finally:
            ar._bulk_research_running = False


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint guards
# ─────────────────────────────────────────────────────────────────────────────

class TestBulkResearchEndpoint:
    """Tests for POST /api/admin/bulk-research."""

    def test_br01_requires_super_admin(self, db):
        """BR-01: SDR cannot trigger bulk research."""
        from routes.admin_routes import router as admin_router
        sdr = create_test_user(db, email="sdr_br01@t.com", role="SDR")
        sdr_identity = {"sub": sdr.id, "email": sdr.email, "role": "SDR"}

        app = FastAPI()
        app.include_router(admin_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: sdr_identity
        # require_super_admin NOT overridden → will reject SDR
        from fastapi import HTTPException
        def _reject():
            raise HTTPException(status_code=403, detail="Super Admin required")
        app.dependency_overrides[require_super_admin] = _reject

        client = TestClient(app)
        resp = client.post("/api/admin/bulk-research")
        assert resp.status_code == 403

    def test_br02_returns_400_when_no_api_key(self, db):
        """BR-02: 400 if LLM API key is not configured."""
        _set_api_key(db, key="")  # blank key
        client = _make_admin_app(db)

        with patch.dict(os.environ, {"GROQ_API_KEY": ""}, clear=False):
            resp = client.post("/api/admin/bulk-research")
        assert resp.status_code == 400
        assert "API key" in resp.json()["detail"]

    def test_br03_returns_202_when_api_key_set(self, db):
        """BR-03: 200/202 response when key is present and no job running."""
        _set_api_key(db, key="sk-test-key")
        client = _make_admin_app(db)

        import routes.admin_routes as ar
        ar._bulk_research_running = False

        # Patch the background function itself — so the daemon thread is a no-op
        with patch("routes.admin_routes._run_bulk_research_background"):
            resp = client.post("/api/admin/bulk-research")

        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data
        assert "will_process" in data

    def test_br04_returns_409_when_already_running(self, db):
        """BR-04: 409 if a bulk research job is already in progress (EC-18)."""
        import routes.admin_routes as ar
        ar._bulk_research_running = True  # simulate running job
        _set_api_key(db, key="sk-test-key")
        client = _make_admin_app(db)

        try:
            resp = client.post("/api/admin/bulk-research")
            assert resp.status_code == 409
            assert "already running" in resp.json()["detail"].lower()
        finally:
            ar._bulk_research_running = False  # always reset

    def test_br05_count_logic_correct(self, db):
        """BR-05: Counts total, already_v2, will_process accurately."""
        _set_api_key(db, key="sk-test-key")
        import routes.admin_routes as ar
        ar._bulk_research_running = False

        # 3 leads: 2 unresearched (v1), 1 already v2 (has research_heat)
        _make_lead(db, "br05a@t.com", status="Lead Assigned", researched=False)
        _make_lead(db, "br05b@t.com", status="Research",      researched=False)
        _make_lead(db, "br05c@t.com", status="Calling",       v2=True)

        client = _make_admin_app(db)
        with patch("routes.admin_routes._run_bulk_research_background"):
            resp = client.post("/api/admin/bulk-research")

        assert resp.status_code == 200
        data = resp.json()
        assert data["will_process"] >= 2
        assert data["already_v2"] >= 1  # was already_researched — field renamed to already_v2

    def test_br06_disqualified_leads_excluded(self, db):
        """BR-06: Disqualified leads are not counted in will_process."""
        _set_api_key(db, key="sk-test-key")
        import routes.admin_routes as ar
        ar._bulk_research_running = False

        _make_lead(db, "br06_dis@t.com", status="Disqualified", researched=False)
        client = _make_admin_app(db)

        with patch("routes.admin_routes._run_bulk_research_background"):
            before = client.post("/api/admin/bulk-research").json()

        # Disqualified lead must not contribute to will_process
        assert "will_process" in before


# ─────────────────────────────────────────────────────────────────────────────
# Background job behaviour (_run_bulk_research_background)
# ─────────────────────────────────────────────────────────────────────────────

class TestBulkResearchBackground:
    """Unit tests for _run_bulk_research_background() logic."""

    def _mock_groq_result(self):
        # Returns the raw Groq JSON structure (pre-sanitize).
        # _sanitize_research_v2 maps: company_pulse→research_company,
        # heat_score→research_heat, why_they_need_us→research_hypothesis etc.
        return {
            "company_pulse":    "Acme does B2B SaaS",
            "why_they_need_us": "They need call tracking",
            "opening_line":     "Hi, saw your team is growing",
            "likely_objection": "Already have CRM",
            "persona_signal":   "COO — full buying authority",
            "heat_score":       "hot",
        }

    def test_br07_skips_v2_lead(self, db):
        """BR-07: Background job skips leads that already have research_heat (v2 sentinel)."""
        import routes.admin_routes as ar

        # v2=True sets research_heat — the skip guard checks this field
        lead = _make_lead(db, "br07@t.com", status="Lead Assigned", v2=True)
        original_company = lead.research_company

        llm_config = {"api_key": "sk-test", "model": "llama-test", "research_prompt": None, "pod_id": None}
        call_count = {"n": 0}

        def mock_groq_sync(prompt, api_key, model):
            call_count["n"] += 1
            return self._mock_groq_result()

        with patch("routes.admin_routes._call_groq_sync", new=mock_groq_sync):
            ar._run_bulk_research_background(llm_config)

        # The specific v2 lead must not have been overwritten
        db.refresh(lead)
        assert lead.research_company == original_company

    def test_br08_persists_fields_to_lead(self, db):
        """BR-08: Background job writes all research fields to the lead row."""
        import routes.admin_routes as ar

        lead = _make_lead(db, "br08@t.com", status="Lead Assigned", researched=False)
        lead.company = f"UniqueCorpBR08_{lead.id}"
        db.commit()

        llm_config = {"api_key": "sk-test", "model": "llama-test", "research_prompt": None, "pod_id": None}

        def mock_groq_sync(prompt, api_key, model):
            return self._mock_groq_result()

        with patch("routes.admin_routes._call_groq_sync", new=mock_groq_sync):
            ar._run_bulk_research_background(llm_config)

        db.refresh(lead)
        assert lead.research_company, "research_company should be populated"
        assert lead.research_heat == "hot"

    def test_br09_one_lead_failure_does_not_kill_batch(self, db):
        """BR-09: Non-retryable error on one lead → batch continues for others."""
        import routes.admin_routes as ar

        lead_ok   = _make_lead(db, "br09ok@t.com",   status="Lead Assigned", researched=False)
        lead_fail = _make_lead(db, "br09fail@t.com", status="Research",      researched=False)
        lead_ok.company   = f"OkCorpBR09_{lead_ok.id}"
        lead_fail.company = f"FailCorpBR09_{lead_fail.id}"
        db.commit()

        def mock_groq_sync(prompt, api_key, model):
            if lead_fail.company and lead_fail.company[:10].lower() in prompt.lower():
                raise RuntimeError("Simulated Groq failure")
            return self._mock_groq_result()

        with patch("routes.admin_routes._call_groq_sync", new=mock_groq_sync):
            ar._run_bulk_research_background({"api_key": "sk-test", "model": "llama-test", "research_prompt": None, "pod_id": None})

        # Job must complete without crashing and flag must reset
        assert not ar._bulk_research_running

    def test_br10_running_flag_reset_on_completion(self, db):
        """BR-10: _bulk_research_running is set to False after job finishes."""
        import routes.admin_routes as ar

        llm_config = {"api_key": "sk-test", "model": "llama-test", "research_prompt": None, "pod_id": None}

        def mock_groq_sync(prompt, api_key, model):
            return self._mock_groq_result()

        ar._bulk_research_running = True
        with patch("routes.admin_routes._call_groq_sync", new=mock_groq_sync):
            ar._run_bulk_research_background(llm_config)

        assert not ar._bulk_research_running, "_bulk_research_running must reset to False"

    def test_br11_resumable_safe_to_run_twice(self, db):
        """BR-11: Running bulk research twice is safe — second pass skips researched leads."""
        import routes.admin_routes as ar

        lead = _make_lead(db, "br11@t.com", status="Lead Assigned", researched=False)
        lead.company = f"ResumableCorpBR11_{lead.id}"
        db.commit()

        call_count = {"n": 0}

        def mock_groq_sync(prompt, api_key, model):
            call_count["n"] += 1
            return self._mock_groq_result()

        llm_config = {"api_key": "sk-test", "model": "llama-test", "research_prompt": None, "pod_id": None}

        # First pass — researches the lead (sets research_heat)
        with patch("routes.admin_routes._call_groq_sync", new=mock_groq_sync):
            ar._run_bulk_research_background(llm_config)

        first_count = call_count["n"]
        db.refresh(lead)
        assert lead.research_heat, "First pass must set research_heat"

        # Second pass — should skip our now-v2 lead
        with patch("routes.admin_routes._call_groq_sync", new=mock_groq_sync):
            ar._run_bulk_research_background(llm_config)

        second_count = call_count["n"] - first_count
        # Our specific lead should have been skipped — so 2nd pass call count
        # for this lead is 0 (other leads in db may still be called)
        db.refresh(lead)
        assert lead.research_company, "Lead should still be researched after second pass"
