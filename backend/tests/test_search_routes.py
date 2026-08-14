"""Tests for routes/search_routes.py — Global search with phone support."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import models
from conftest import create_test_user, create_test_lead


class TestGlobalSearchAdmin:

    def test_admin_search_returns_leads_and_users(self, client, db):
        create_test_lead(db, first_name="Findme", email="findme@t.com")
        create_test_user(db, name="Searchable User", email="searchable@t.com")
        resp = client.get("/api/search?q=Find")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1

    def test_admin_search_by_company(self, client, db):
        create_test_lead(db, company="UniqueCompanyXYZ", email="uc@t.com")
        resp = client.get("/api/search?q=UniqueCompanyXYZ")
        data = resp.json()
        assert len(data["leads"]) == 1

    def test_admin_search_returns_users(self, client, db):
        create_test_user(db, name="John Admin", email="johnadmin@t.com")
        resp = client.get("/api/search?q=johnadmin")
        data = resp.json()
        assert len(data["users"]) >= 1

    def test_search_no_results(self, client, db):
        resp = client.get("/api/search?q=xyznonexistent")
        data = resp.json()
        assert len(data["leads"]) == 0
        assert len(data["users"]) == 0

    # ── Phone search tests ────────────────────────────────────────────────────

    def test_admin_search_by_phone(self, client, db):
        """Search by primary phone number should return matching lead."""
        create_test_lead(db, phone="+919876543210", email="phone1@t.com",
                         first_name="PhoneTest", last_name="Primary")
        resp = client.get("/api/search?q=9876543210")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1
        assert any(l["phone"] == "+919876543210" for l in data["leads"])

    def test_admin_search_by_phone_secondary(self, client, db):
        """Search by secondary phone number should return matching lead."""
        create_test_lead(db, phone_secondary="+14155551234", email="phone2@t.com",
                         first_name="PhoneTest", last_name="Secondary")
        resp = client.get("/api/search?q=4155551234")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1
        assert any(l.get("phone_secondary") == "+14155551234" for l in data["leads"])

    def test_admin_search_phone_partial_match(self, client, db):
        """Partial phone number should match via ILIKE."""
        create_test_lead(db, phone="+918552628000", email="partial@t.com",
                         first_name="Partial", last_name="Phone")
        resp = client.get("/api/search?q=855262")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1

    def test_admin_search_phone_with_plus_prefix(self, client, db):
        """Search with + prefix (E.164 format) should match."""
        create_test_lead(db, phone="+442071234567", email="uk@t.com",
                         first_name="UK", last_name="Number")
        resp = client.get("/api/search?q=%2B442071234567")  # URL-encoded +
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1

    def test_admin_search_phone_with_dashes(self, client, db):
        """Phone stored with dashes should match substring search with dashes."""
        create_test_lead(db, phone="+1-555-987-6543", email="dashes@t.com",
                         first_name="Dash", last_name="Phone")
        resp = client.get("/api/search?q=555-987")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1

    def test_admin_search_phone_no_crash_on_null_phone(self, client, db):
        """Leads with NULL phone should not crash the search query."""
        create_test_lead(db, phone=None, phone_secondary=None, email="nophone@t.com",
                         first_name="NoPhone", last_name="Lead")
        resp = client.get("/api/search?q=NoPhone")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1  # Found by name, not phone

    def test_admin_search_returns_lead_with_phone_in_response(self, client, db):
        """Search response should include phone field for display."""
        create_test_lead(db, phone="+919999888877", email="resp@t.com",
                         first_name="ResponseCheck", last_name="Lead")
        resp = client.get("/api/search?q=ResponseCheck")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1
        lead = data["leads"][0]
        assert "phone" in lead
        assert lead["phone"] == "+919999888877"


class TestGlobalSearchSDR:

    def test_sdr_search_no_users(self, client_as_sdr, db):
        """SDR should not see user results in search."""
        create_test_user(db, name="Hidden Admin", email="hidden@t.com")
        resp = client_as_sdr.get("/api/search?q=Hidden")
        assert resp.status_code == 200
        data = resp.json()
        # SDR should not get user results
        assert len(data["users"]) == 0

    def test_sdr_search_by_phone_only_assigned(self, client_as_sdr, db):
        """SDR phone search should only return their assigned leads."""
        # Create SDR user in DB with explicit id matching fixture sub="sdr-user-id"
        sdr = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR User",
                          role="SDR", google_id="sdr-gid")
        db.add(sdr)
        db.commit()

        lead = create_test_lead(db, phone="+911234567890", email="sdrphone@t.com",
                                first_name="SDRPhone", last_name="Test")
        # Assign lead to SDR
        stmt = models.lead_assignments.insert().values(
            lead_id=lead.id, user_id=sdr.id
        )
        db.execute(stmt)
        db.commit()

        resp = client_as_sdr.get("/api/search?q=1234567890")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1
        assert data["leads"][0]["phone"] == "+911234567890"

    def test_sdr_search_phone_unassigned_hidden(self, client_as_sdr, db):
        """SDR should NOT see unassigned leads even if phone matches."""
        # Ensure SDR user exists in DB with matching id
        sdr = models.User(id="sdr-user-id", email="sdr3@test.com", name="SDR User 3",
                          role="SDR", google_id="sdr-gid-3")
        db.add(sdr)
        db.commit()

        create_test_lead(db, phone="+910000000000", email="unassigned@t.com",
                         first_name="Unassigned", last_name="PhoneLead")
        resp = client_as_sdr.get("/api/search?q=0000000000")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) == 0  # Not assigned to this SDR


class TestSearchEdgeCases:

    def test_search_empty_query_rejected(self, client):
        """Empty query should be rejected or return empty results."""
        resp = client.get("/api/search?q=")
        # At minimum, should not crash
        assert resp.status_code in (200, 422)

    def test_search_single_character(self, client, db):
        """Single character search should work without error."""
        resp = client.get("/api/search?q=a")
        assert resp.status_code == 200

    def test_search_special_characters(self, client, db):
        """Search with SQL-special characters should not cause injection."""
        resp = client.get("/api/search?q=%25DROP%20TABLE")
        assert resp.status_code == 200
        data = resp.json()
        assert "leads" in data
        assert "users" in data

    def test_search_very_long_query(self, client, db):
        """Very long search query should not crash."""
        long_q = "a" * 500
        resp = client.get(f"/api/search?q={long_q}")
        assert resp.status_code == 200

    def test_search_numeric_only(self, client, db):
        """Pure numeric search (like a phone number) should work."""
        create_test_lead(db, phone="+917777666655", email="numonly@t.com",
                         first_name="NumOnly", last_name="Test")
        resp = client.get("/api/search?q=7777666655")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) >= 1

    def test_search_result_limit(self, client, db):
        """Search should return at most 10 leads."""
        for i in range(15):
            create_test_lead(db, first_name=f"BulkSearch", last_name=f"Lead{i}",
                             email=f"bulk{i}@t.com", phone=f"+9100000000{i:02d}")
        resp = client.get("/api/search?q=BulkSearch")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["leads"]) <= 10
