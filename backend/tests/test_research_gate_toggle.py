"""
T2 — Research Gate Toggle Tests (12 tests)
============================================
Tests for the `require_research_before_calling` gate in lead_routes.py.

Gate lives in: PATCH /api/leads/kanban/move?lead_id=...&new_status=...

When True: moving a lead to 'Calling' or 'Meeting Scheduled' requires all 4
core research fields to be populated.
When False (default): no gate — status can move freely.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import create_test_lead, create_test_user, SUPER_ADMIN, create_sync_settings
from database import get_db
from auth import get_current_user


def _make_app(db):
    from routes.lead_routes import router as lead_router
    app = FastAPI()
    app.include_router(lead_router)
    app.dependency_overrides[get_db] = lambda: db
    # Use SDR role — gate applies to all roles equally (check is not role-gated)
    # but backward-move check is role-gated, so use Super Admin to avoid that
    app.dependency_overrides[get_current_user] = lambda: SUPER_ADMIN
    return TestClient(app)


# Gate is in PATCH /api/leads/kanban/move?lead_id=...&new_status=...
def _move(client, lead_id, new_status):
    return client.patch("/api/leads/kanban/move", params={"lead_id": lead_id, "new_status": new_status})


def _set_gate(db, enabled: bool):
    """Enable or disable the research gate in SyncSettings."""
    import models
    ss = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not ss:
        ss = create_sync_settings(db)
    ss.require_research_before_calling = enabled
    db.commit()


def _fully_research(lead, db):
    """Fill all 4 core research fields on a lead."""
    lead.research_company = "Acme Corp — B2B SaaS startup"
    lead.research_contact = "Jane is the ops head"
    lead.research_hypothesis = "They need call tracking"
    lead.research_personalization = "Ops teams love efficiency"
    db.commit()


def _add_call_log(db, lead_id, user_id):
    """Add a call log entry so Meeting Scheduled requirement is satisfied."""
    from conftest import create_test_call
    create_test_call(db, lead_id=lead_id, user_id=user_id)


# ─────────────────────────────────────────────────────────────────────────────
# Gate OFF (default)
# ─────────────────────────────────────────────────────────────────────────────

class TestResearchGateOff:
    """Gate is disabled — status moves freely regardless of research state."""

    def test_rg01_gate_off_unresearched_lead_can_move_to_calling(self, db):
        """RG-01: Gate OFF → unresearched lead can move to Calling."""
        _set_gate(db, False)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg01@t.com")
        lead.status = "Lead Assigned"
        db.commit()

        resp = _move(client, lead.id, "Calling")
        assert resp.status_code == 200, resp.text
        db.refresh(lead)
        assert lead.status == "Calling"

    def test_rg02_gate_off_unresearched_can_move_to_research(self, db):
        """RG-02: Gate OFF → unresearched lead can move to Research freely."""
        _set_gate(db, False)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg02@t.com")
        lead.status = "Lead Assigned"
        db.commit()

        resp = _move(client, lead.id, "Research")
        assert resp.status_code == 200, resp.text

    def test_rg03_gate_off_change_is_live(self, db):
        """RG-03: Admin disabling gate takes effect immediately (EC-14)."""
        _set_gate(db, True)   # enable first
        _set_gate(db, False)  # then disable
        client = _make_app(db)
        lead = create_test_lead(db, email="rg03@t.com")
        lead.status = "Lead Assigned"
        db.commit()

        resp = _move(client, lead.id, "Calling")
        assert resp.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# Gate ON — unresearched leads blocked
# ─────────────────────────────────────────────────────────────────────────────

class TestResearchGateOn:
    """Gate is enabled — moves to Calling/Meeting Scheduled blocked without research."""

    def test_rg04_gate_on_blocks_calling_no_research(self, db):
        """RG-04: Gate ON → 422 when all 4 fields are empty."""
        _set_gate(db, True)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg04@t.com")
        lead.status = "Lead Assigned"
        db.commit()

        resp = _move(client, lead.id, "Calling")
        assert resp.status_code == 422
        assert "required" in resp.json()["detail"].lower()

    def test_rg05_gate_on_blocks_if_one_field_missing(self, db):
        """RG-05: Gate ON → 422 even when only one of the 4 fields is empty."""
        _set_gate(db, True)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg05@t.com")
        lead.status = "Lead Assigned"
        lead.research_company = "Acme"
        lead.research_contact = "Jane"
        lead.research_hypothesis = "Needs dialer"
        # research_personalization is intentionally empty
        db.commit()

        resp = _move(client, lead.id, "Calling")
        assert resp.status_code == 422

    def test_rg06_gate_on_allows_calling_when_fully_researched(self, db):
        """RG-06: Gate ON → move to Calling allowed when all 4 fields present."""
        _set_gate(db, True)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg06@t.com")
        lead.status = "Lead Assigned"
        _fully_research(lead, db)

        resp = _move(client, lead.id, "Calling")
        assert resp.status_code == 200, resp.text

    def test_rg07_gate_on_blocks_calling_partial_research(self, db):
        """RG-07: Gate ON → Calling blocked for partial research (Research status)."""
        _set_gate(db, True)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg07@t.com")
        lead.status = "Research"
        lead.research_company = "Acme"  # Only 1 of 4 fields filled
        db.commit()

        resp = _move(client, lead.id, "Calling")
        assert resp.status_code == 422

    def test_rg08_gate_on_allows_research_status_without_research(self, db):
        """RG-08: Gate ON → moving to 'Research' (not Calling) is always allowed."""
        _set_gate(db, True)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg08@t.com")
        lead.status = "Lead Assigned"
        db.commit()

        resp = _move(client, lead.id, "Research")
        assert resp.status_code == 200

    def test_rg09_error_response_names_missing_fields(self, db):
        """RG-09: 422 detail lists the human-readable field names that are missing."""
        _set_gate(db, True)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg09@t.com")
        lead.status = "Lead Assigned"
        db.commit()

        resp = _move(client, lead.id, "Calling")
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert any(label in detail for label in [
            "What does this company do?", "Contact Context",
            "Pitch Angle", "Personalization Note"
        ])

    def test_rg10_gate_on_change_live_for_existing_session(self, db):
        """RG-10: Enabling gate takes effect immediately without restart (EC-14)."""
        _set_gate(db, False)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg10@t.com")
        lead.status = "Lead Assigned"
        db.commit()

        # First call with gate OFF → succeeds (move to Research, always allowed)
        resp = _move(client, lead.id, "Research")
        assert resp.status_code == 200

        # Enable gate mid-session
        _set_gate(db, True)
        lead2 = create_test_lead(db, email="rg10b@t.com")
        lead2.status = "Lead Assigned"
        db.commit()

        # Second call with gate ON → blocked
        resp2 = _move(client, lead2.id, "Calling")
        assert resp2.status_code == 422

    def test_rg11_gate_on_does_not_block_disqualified_path_notes(self, db):
        """RG-11: Gate only checks Calling/Meeting Scheduled — Research status free."""
        _set_gate(db, True)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg11@t.com")
        lead.status = "Lead Assigned"
        db.commit()

        # Research is not in the gate check — always passes
        resp = _move(client, lead.id, "Research")
        assert resp.status_code == 200

    def test_rg12_gate_on_allows_fully_researched_to_calling(self, db):
        """RG-12: Gate ON → fully researched lead in Research status can move to Calling."""
        _set_gate(db, True)
        client = _make_app(db)
        lead = create_test_lead(db, email="rg12@t.com")
        lead.status = "Research"
        _fully_research(lead, db)

        resp = _move(client, lead.id, "Calling")
        assert resp.status_code == 200, resp.text
