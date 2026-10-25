# ── tests/test_inbound_lead_capture.py ──────────────────────────────────────────
#
# Comprehensive test suite for public inbound lead capture & dogfooding:
#   1. New inbound lead creation with tags, status, notes, assignment
#   2. Honeypot bot trapping
#   3. Email validation & normalization
#   4. Re-engagement and re-opening of terminal leads
#   5. String length boundary protection & phone sanitization
#
# Run: cd backend && pytest tests/test_inbound_lead_capture.py -v
# ─────────────────────────────────────────────────────────────────────────────

import os
import pytest
from unittest.mock import patch
from tests.conftest import create_test_user, create_test_lead
import models


@pytest.fixture(autouse=True)
def setup_env():
    os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")


class TestInboundLeadCapture:

    def test_inbound_lead_success(self, client, db):
        """Valid inbound lead submission should create Lead, Tags, Note, and assign to Admin."""
        admin = create_test_user(db, email="admin@alternatecrm.test", role="Super Admin")

        payload = {
            "first_name": "Elena",
            "last_name": "Rostova",
            "email": "elena.rostova@acmecorp.com",
            "company": "Acme Corporation",
            "phone": "+1 (415) 555-0199",
            "team_size": "11-50",
            "primary_interest": "AI Power Dialer & Cadences",
            "notes": "Looking to replace our legacy CRM tools.",
            "website_hp": ""
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["status"] == "created"
        assert data["lead_id"] is not None

        # Verify DB row
        lead = db.query(models.Lead).filter(models.Lead.email == "elena.rostova@acmecorp.com").first()
        assert lead is not None
        assert lead.first_name == "Elena"
        assert lead.last_name == "Rostova"
        assert lead.company == "Acme Corporation"
        assert lead.status == "Lead Assigned"
        assert lead.lead_source == "Website - Early Access Request"
        assert lead.priority_score == 100
        assert lead.phone == "+1 (415) 555-0199"

        # Verify Tags
        tag_names = [t.name for t in lead.tags]
        assert "Inbound" in tag_names
        assert "Website" in tag_names

        # Verify Note
        assert len(lead.notes) >= 1
        assert "AI Power Dialer & Cadences" in lead.notes[0].content
        assert "Acme Corporation" in lead.notes[0].content

        # Verify Assignment
        assert len(lead.assigned_users) == 1
        assert lead.assigned_users[0].id == admin.id

    def test_inbound_lead_honeypot_bot_filtered(self, client, db):
        """Bots that fill the honeypot field must be silently absorbed without DB pollution."""
        payload = {
            "first_name": "BotSpam",
            "email": "spam@spambot.xyz",
            "website_hp": "http://spamsite.com/phishing"
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "created"
        assert data["lead_id"] == "bot_filtered"

        # Must NOT exist in DB
        lead = db.query(models.Lead).filter(models.Lead.email == "spam@spambot.xyz").first()
        assert lead is None

    @pytest.mark.parametrize("bad_email", [
        "", "notanemail", "missingat.com", "user@", "@domain.com", "user@domain", "user@.com",
        "a" * 256 + "@test.com", "user@domain..com", ".user@domain.com", "user@domain.com.",
        "user@domain.c", "user@domain.123"
    ])
    def test_inbound_lead_invalid_email(self, client, bad_email):
        """Malformed emails must be rejected with 400 Bad Request."""
        payload = {
            "first_name": "John",
            "email": bad_email
        }
        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 400
        assert "valid work email" in resp.json()["detail"].lower()

    def test_inbound_lead_missing_first_name(self, client):
        """Missing or empty first name must return 400 Bad Request."""
        payload = {
            "first_name": "   ",
            "email": "valid@company.com"
        }
        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 400
        assert "first name is required" in resp.json()["detail"].lower()

    def test_inbound_lead_reengagement_dedup(self, client, db):
        """Duplicate submissions must update notes and preserve existing rep assignment."""
        sdr = create_test_user(db, email="sdr@alternatecrm.test", role="SDR")
        existing_lead = create_test_lead(
            db, email="marcus@figma.test", first_name="Marcus", last_name="Vance",
            company="Figma", status="Calling"
        )
        existing_lead.assigned_users.append(sdr)
        db.commit()

        payload = {
            "first_name": "Marcus",
            "last_name": "Vance",
            "email": "MARCUS@figma.test",  # Test case insensitivity
            "company": "Figma Inc",
            "team_size": "51-200",
            "primary_interest": "Conversation OS Migration",
            "notes": "Ready to move forward with enterprise demo"
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "existing_updated"
        assert data["lead_id"] == existing_lead.id

        # Must not create a second row
        count = db.query(models.Lead).filter(models.Lead.email == "marcus@figma.test").count()
        assert count == 1

        # Must preserve original SDR assignment
        db.refresh(existing_lead)
        assert len(existing_lead.assigned_users) == 1
        assert existing_lead.assigned_users[0].id == sdr.id

        # Must append re-engagement note
        notes_text = " ".join(n.content for n in existing_lead.notes)
        assert "Conversation OS Migration" in notes_text
        assert "Ready to move forward" in notes_text

    def test_inbound_lead_reopen_terminal_lead(self, client, db):
        """If a previously Disqualified lead submits an early access form, re-open to Lead Assigned."""
        lead = create_test_lead(db, email="revive@client.test", status="Disqualified")
        lead.closed_reason = "Not Interested"
        db.commit()

        payload = {
            "first_name": "Revived",
            "email": "revive@client.test",
            "company": "Revive Corp",
            "primary_interest": "New AI Features"
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200

        db.refresh(lead)
        assert lead.status == "Lead Assigned"
        assert lead.lead_closed_at is None
        assert lead.priority_score == 100

    def test_inbound_lead_boundary_protection(self, client, db):
        """Extremely large string payloads must be gracefully bounded without crashing DB."""
        payload = {
            "first_name": "A" * 500,
            "last_name": "B" * 500,
            "email": "boundary@test.com",
            "company": "C" * 1000,
            "phone": "invalid_phone_digits_xyz",
            "notes": "D" * 5000
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200

        lead = db.query(models.Lead).filter(models.Lead.email == "boundary@test.com").first()
        assert len(lead.first_name) <= 100
        assert len(lead.last_name) <= 100
        assert len(lead.company) <= 200
        assert lead.phone is None  # invalid phone discarded

    def test_inbound_lead_xss_sanitization(self, client, db):
        """HTML / script tags in names, company, and notes must be stripped to prevent stored XSS."""
        payload = {
            "first_name": "<script>alert('xss')</script>John",
            "last_name": "<b>Doe</b>",
            "email": "xss.clean@company.com",
            "company": "Acme <img src=x onerror=alert(1)> Corp",
            "notes": "<p>Interested in <em>AI dialer</em></p><script>evil()</script>"
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200

        lead = db.query(models.Lead).filter(models.Lead.email == "xss.clean@company.com").first()
        assert "<script>" not in lead.first_name
        assert "alert('xss')" in lead.first_name or "John" in lead.first_name
        assert "<b>" not in lead.last_name
        assert "Doe" in lead.last_name
        assert "<img" not in lead.company
        assert "Acme" in lead.company

        # Verify note has stripped tags
        note = lead.notes[0]
        assert "<script>" not in note.content
        assert "<p>" not in note.content

    def test_inbound_lead_sql_injection_safety(self, client, db):
        """SQL injection payloads must be safely treated as literal values without error."""
        payload = {
            "first_name": "Robert'); DROP TABLE leads; --",
            "last_name": "O'Connor",
            "email": "sqli.safe@company.com",
            "company": "' OR '1'='1",
            "notes": "Testing SQL injection: '; SELECT * FROM users; --"
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200

        # Leads table must still exist and record properly created
        lead = db.query(models.Lead).filter(models.Lead.email == "sqli.safe@company.com").first()
        assert lead is not None
        assert lead.last_name == "O'Connor"
        assert lead.company == "' OR '1'='1"

    def test_inbound_lead_international_unicode(self, client, db):
        """Accented, Umlaut, Cyrillic, and CJK characters must be preserved accurately."""
        payload = {
            "first_name": "François-Xavier",
            "last_name": "Müller",
            "email": "francois.muller@multinational.fr",
            "company": "グローバル株式会社",
            "phone": "+33 1 42 68 55 00",
            "notes": "Здравствуйте, nous voulons essayer Conversation OS."
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200

        lead = db.query(models.Lead).filter(models.Lead.email == "francois.muller@multinational.fr").first()
        assert lead is not None
        assert lead.first_name == "François-Xavier"
        assert lead.last_name == "Müller"
        assert lead.company == "グローバル株式会社"
        assert lead.phone == "+33 1 42 68 55 00"

    @pytest.mark.parametrize("valid_email", [
        "alex+tag@stripe.com",
        "sarah.o'neill@sub.domain.co.uk",
        "founder@superapp.ai",
        "developer@cloud.tech"
    ])
    def test_inbound_lead_valid_email_variations(self, client, db, valid_email):
        """Advanced RFC email variations including subaddressing and modern TLDs should succeed."""
        payload = {
            "first_name": "Valid",
            "email": valid_email
        }
        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_inbound_lead_company_domain_fallback(self, client, db):
        """When company is not provided, business email domain should be inferred as company name."""
        payload = {
            "first_name": "Maya",
            "email": "maya@datadoghq.com",
            "company": ""  # empty
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200

        lead = db.query(models.Lead).filter(models.Lead.email == "maya@datadoghq.com").first()
        assert lead.company == "Datadoghq"

        # Public provider should fallback to Unknown
        payload_public = {
            "first_name": "Dan",
            "email": "dan@gmail.com",
            "company": ""
        }
        resp_public = client.post("/api/public/leads/inbound", json=payload_public)
        assert resp_public.status_code == 200
        lead_public = db.query(models.Lead).filter(models.Lead.email == "dan@gmail.com").first()
        assert lead_public.company == "Unknown"

    def test_inbound_lead_zero_admins_fallback(self, client, db):
        """If there are no admins in the system, lead is saved as unassigned without crashing."""
        # Ensure no admins exist
        db.query(models.User).filter(models.User.role.in_(["Super Admin", "Admin", "Pod Admin"])).delete()
        db.commit()

        payload = {
            "first_name": "Solo",
            "email": "solo@founder.io"
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200
        lead = db.query(models.Lead).filter(models.Lead.email == "solo@founder.io").first()
        assert lead is not None
        assert len(lead.assigned_users) == 0

    def test_inbound_lead_reengagement_tag_and_assignment_backfill(self, client, db):
        """Re-engaging an existing unassigned lead must backfill tags and auto-assign to active admin."""
        admin = create_test_user(db, email="admin2@alternatecrm.test", role="Admin")
        existing_lead = create_test_lead(
            db, email="coldlead@target.com", first_name="Cold", status="Lead Assigned"
        )
        # Ensure lead has no tags and no assignees
        existing_lead.tags = []
        existing_lead.assigned_users = []
        db.commit()

        payload = {
            "first_name": "Cold",
            "email": "coldlead@target.com",
            "primary_interest": "AI Power Dialer"
        }

        resp = client.post("/api/public/leads/inbound", json=payload)
        assert resp.status_code == 200
        assert resp.json()["status"] == "existing_updated"

        db.refresh(existing_lead)
        # Verify tags added
        tag_names = [t.name for t in existing_lead.tags]
        assert "Inbound" in tag_names
        assert "Website" in tag_names

        # Verify assigned to active admin
        assert len(existing_lead.assigned_users) == 1
        assert existing_lead.assigned_users[0].id == admin.id
