"""
Unit tests for the enriched _build_lead_description function in salesforce.py.
"""
import os
import sys
import pytest
from datetime import datetime

_backend_dir = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _backend_dir)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base
import models

from salesforce import _build_lead_description


@pytest.fixture()
def db():
    """In-memory SQLite DB for testing."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _make_lead(db, **overrides):
    """Create a lead with optional field overrides."""
    defaults = {
        "first_name": "Jane",
        "last_name": "Smith",
        "email": "jane@acme.com",
        "company": "Acme Corp",
        "status": "Meeting Scheduled",
    }
    defaults.update(overrides)
    lead = models.Lead(**defaults)
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


# ── Test 1: Full data — all 6 sections ──────────────────────────────────────

def test_full_data_all_sections(db):
    lead = _make_lead(
        db,
        title="VP of Sales",
        industry="SaaS",
        research_company_size="200-500",
        research_geo="US West",
        research_timezone="PST",
        research_company="Series B SaaS, expanding to 500 employees",
        research_contact="10yr enterprise sales, ex-Salesforce",
        research_services="Cloud CRM, Sales Automation",
        research_hypothesis="No outbound tooling, growing team needs workflow automation",
        research_hook="Congrats on Series B raise",
        research_personalization="Shared LinkedIn connection",
        research_channels="Email, LinkedIn",
        opportunity_status="Won",
        opportunity_notes="Closed $50K deal",
        opportunity_updated_by="Admin User",
        opportunity_updated_at=datetime(2026, 3, 22),
    )

    # Add calls
    call1 = models.CallLog(lead_id=lead.id, user_id=None, outcome="Connected",
                           notes="Interested, asked for deck",
                           called_at=datetime(2026, 3, 18))
    call2 = models.CallLog(lead_id=lead.id, user_id=None, outcome="Voicemail",
                           notes="Left follow-up",
                           called_at=datetime(2026, 3, 20))
    db.add_all([call1, call2])

    # Add notes
    note1 = models.Note(lead_id=lead.id, content="Sent pricing deck via email",
                        author="Jane", created_at=datetime(2026, 3, 19))
    db.add(note1)
    db.commit()

    desc = _build_lead_description(lead, db)

    assert desc is not None
    assert "LEAD SUMMARY" in desc
    assert "VP of Sales at Acme Corp" in desc
    assert "Industry: SaaS" in desc
    assert "Company Size: 200-500" in desc

    assert "SDR RESEARCH" in desc
    assert "Company Insight:" in desc
    assert "Why They're a Fit:" in desc

    assert "OUTREACH STRATEGY" in desc
    assert "Opening Hook:" in desc
    assert "Preferred Channels: Email, LinkedIn" in desc

    assert "CALL HISTORY (2 calls)" in desc
    assert "Connected" in desc
    assert "Voicemail" in desc

    assert "SDR NOTES" in desc
    assert "(Jane):" in desc
    assert "Sent pricing deck" in desc

    assert "OPPORTUNITY CONTEXT" in desc
    assert "Status: Won" in desc
    assert "Closed $50K deal" in desc
    assert "Admin User" in desc


# ── Test 2: Minimal data — only company research ────────────────────────────

def test_minimal_research_only(db):
    lead = _make_lead(db, research_company="They sell widgets")

    desc = _build_lead_description(lead, db)

    assert desc is not None
    assert "SDR RESEARCH" in desc
    assert "Company Insight: They sell widgets" in desc

    # Lead summary should still appear (has company)
    assert "LEAD SUMMARY" in desc
    assert "Acme Corp" in desc

    # No calls, notes, opportunity, outreach
    assert "CALL HISTORY" not in desc
    assert "SDR NOTES" not in desc
    assert "OPPORTUNITY CONTEXT" not in desc
    assert "OUTREACH STRATEGY" not in desc


# ── Test 3: Empty lead — no data at all ─────────────────────────────────────

def test_empty_lead_returns_none(db):
    lead = _make_lead(db, company=None, title=None)

    desc = _build_lead_description(lead, db)

    assert desc is None


# ── Test 4: Calls only ──────────────────────────────────────────────────────

def test_calls_only(db):
    lead = _make_lead(db, company=None, title=None)
    call = models.CallLog(lead_id=lead.id, user_id=None, outcome="No Answer",
                          called_at=datetime(2026, 3, 15))
    db.add(call)
    db.commit()

    desc = _build_lead_description(lead, db)

    assert desc is not None
    assert "CALL HISTORY (1 call)" in desc
    assert "No Answer" in desc
    assert "SDR RESEARCH" not in desc


# ── Test 5: Notes only with author and date ─────────────────────────────────

def test_notes_only(db):
    lead = _make_lead(db, company=None, title=None)
    note = models.Note(lead_id=lead.id, content="Follow up tomorrow",
                       author="Alex", created_at=datetime(2026, 3, 21))
    db.add(note)
    db.commit()

    desc = _build_lead_description(lead, db)

    assert desc is not None
    assert "SDR NOTES" in desc
    assert "(Alex):" in desc
    assert "Follow up tomorrow" in desc
    assert "CALL HISTORY" not in desc


# ── Test 6: No db session — research fields only ───────────────────────────

def test_no_db_session_skips_calls_and_notes(db):
    """When db=None, calls and notes sections are skipped gracefully."""
    lead = _make_lead(db, research_hypothesis="Great fit for our product")

    # Add calls and notes that should NOT appear
    db.add(models.CallLog(lead_id=lead.id, user_id=None, outcome="Connected",
                          called_at=datetime(2026, 3, 18)))
    db.add(models.Note(lead_id=lead.id, content="Important note",
                       author="SDR", created_at=datetime(2026, 3, 19)))
    db.commit()

    desc = _build_lead_description(lead, db=None)

    assert desc is not None
    assert "SDR RESEARCH" in desc
    assert "CALL HISTORY" not in desc
    assert "SDR NOTES" not in desc
