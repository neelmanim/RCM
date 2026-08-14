# ── tests/test_public_api.py ─────────────────────────────────────────────────
#
# Test suite for v4.13.0:
#   1. Public API — /api/public/health and /api/public/sf/account
#   2. Admin API Key management — generate / status / revoke
#   3. Upload company-ownership fix — cross-batch SDR assignment
#
# Run: cd backend && pytest tests/test_public_api.py -v
# ─────────────────────────────────────────────────────────────────────────────

import os
import io
import csv
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# ── Ensure APP_ENCRYPTION_KEY is set for all tests ───────────────────────────
# Must be a base64-encoded 32-byte key (matches crypto.py validation)
os.environ.setdefault(
    "APP_ENCRYPTION_KEY",
    "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ="   # 32-byte key for tests
)
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

from tests.conftest import (
    create_test_user, create_test_lead, create_test_pod, create_sync_settings
)
import models


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Public health endpoint (unauthenticated)
# ══════════════════════════════════════════════════════════════════════════════

class TestPublicHealth:
    def test_health_returns_ok(self, client):
        resp = client.get("/api/public/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "RCM" in data["api"]

    def test_health_requires_no_auth(self, client):
        """Health check must be reachable with no auth headers at all."""
        resp = client.get("/api/public/health")
        # Must NOT return 401 or 403
        assert resp.status_code not in (401, 403)


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Admin API Key management endpoints
# ══════════════════════════════════════════════════════════════════════════════

class TestAdminApiKeyManagement:
    def test_status_no_key(self, client, db):
        """Status endpoint returns configured=False when no key stored in SyncSettings."""
        resp = client.get("/api/admin/public-api-key/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is False

    def test_generate_key_returns_plaintext(self, client, db):
        """Generate returns a plaintext key (shown once) prefixed with 'rcm_'."""
        resp = client.post("/api/admin/public-api-key/generate")
        assert resp.status_code == 200
        data = resp.json()
        assert "api_key" in data
        assert data["api_key"].startswith("lsk_")
        assert len(data["api_key"]) > 20
        assert data["success"] is True

    def test_generate_key_status_active(self, client, db):
        """After generating, status endpoint reports configured=True."""
        client.post("/api/admin/public-api-key/generate")
        resp = client.get("/api/admin/public-api-key/status")
        assert resp.status_code == 200
        assert resp.json()["configured"] is True

    def test_revoke_key(self, client, db):
        """Revoking clears the key; status returns configured=False again."""
        client.post("/api/admin/public-api-key/generate")
        resp = client.delete("/api/admin/public-api-key")   # route is /public-api-key (no /revoke)
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        status = client.get("/api/admin/public-api-key/status")
        assert status.json()["configured"] is False

    def test_generate_replaces_existing_key(self, client, db):
        """Calling generate twice replaces the previous key (stored on SyncSettings row)."""
        r1 = client.post("/api/admin/public-api-key/generate")
        r2 = client.post("/api/admin/public-api-key/generate")
        assert r1.status_code == 200
        assert r2.status_code == 200
        key1 = r1.json()["api_key"]
        key2 = r2.json()["api_key"]
        assert key1 != key2
        # Still only 1 SyncSettings row (key stored on it, not in separate table)
        assert db.query(models.SyncSettings).count() == 1

    def test_generate_requires_admin(self, client_as_sdr):
        """SDRs cannot generate API keys."""
        resp = client_as_sdr.post("/api/admin/public-api-key/generate")
        assert resp.status_code == 403

    def test_revoke_requires_admin(self, client_as_sdr):
        """SDRs cannot revoke API keys."""
        resp = client_as_sdr.delete("/api/admin/public-api-key")
        assert resp.status_code == 403



# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Public API /sf/account  (Salesforce mocked)
# ══════════════════════════════════════════════════════════════════════════════

def _make_sf_mock(account_records=None, lead_records=None):
    """Build a minimal simple_salesforce-like mock."""
    sf = MagicMock()
    sf.sf_instance = "test-instance.salesforce.com"

    def _query(soql):
        soql_lower = soql.lower()
        if "from account" in soql_lower:
            return {"records": account_records or [], "totalSize": len(account_records or [])}
        if "from lead" in soql_lower:
            return {"records": lead_records or [], "totalSize": len(lead_records or [])}
        return {"records": [], "totalSize": 0}

    sf.query.side_effect = _query
    return sf


def _generate_key_and_headers(client, db):
    """Generate an API key via admin endpoint and return the X-API-Key header dict."""
    resp = client.post("/api/admin/public-api-key/generate")
    assert resp.status_code == 200, resp.text
    return {"X-API-Key": resp.json()["api_key"]}


class TestPublicApiSfAccount:
    def test_no_params_returns_400(self, client, db):
        headers = _generate_key_and_headers(client, db)
        with patch("routes.public_api_routes.get_sf_client", return_value=_make_sf_mock()):
            resp = client.get("/api/public/sf/account", headers=headers)
        assert resp.status_code == 400

    def test_missing_api_key_returns_401(self, client, db):
        resp = client.get("/api/public/sf/account", params={"company_name": "Acme"})
        assert resp.status_code == 401

    def test_wrong_api_key_returns_401(self, client, db):
        _generate_key_and_headers(client, db)  # ensure a key exists
        resp = client.get(
            "/api/public/sf/account",
            headers={"X-API-Key": "wrong-key"},
            params={"company_name": "Acme"},
        )
        assert resp.status_code == 401

    def test_sf_not_connected_returns_503(self, client, db):
        headers = _generate_key_and_headers(client, db)
        with patch("routes.public_api_routes.get_sf_client", return_value=None):
            resp = client.get(
                "/api/public/sf/account",
                headers=headers,
                params={"company_name": "Acme"},
            )
        assert resp.status_code == 503

    def test_account_found_by_company_name(self, client, db):
        headers = _generate_key_and_headers(client, db)
        sf = _make_sf_mock(account_records=[{"Id": "0011x00001AbCdE", "Name": "Acme Corp"}])
        with patch("routes.public_api_routes.get_sf_client", return_value=sf):
            resp = client.get(
                "/api/public/sf/account",
                headers=headers,
                params={"company_name": "Acme Corp"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is True
        assert data["type"] == "Account"
        assert data["sf_account_id"] == "0011x00001AbCdE"
        assert data["account_name"] == "Acme Corp"
        assert "sf_url" in data
        assert data["confidence"] == "exact"
        assert data["matched_by"] == "company_name"

    def test_account_found_by_rcm_messaging_id(self, client, db):
        headers = _generate_key_and_headers(client, db)
        sf = _make_sf_mock(account_records=[{"Id": "0011x00001AbCdF", "Name": "Test Hospital"}])
        with patch("routes.public_api_routes.get_sf_client", return_value=sf):
            resp = client.get(
                "/api/public/sf/account",
                headers=headers,
                params={"rcm_messaging_id": "SMS-001"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is True
        assert data["matched_by"] == "rcm_messaging_id"

    def test_lead_fallback_when_no_account(self, client, db):
        """When no Account is found, the endpoint falls back to Salesforce Lead."""
        headers = _generate_key_and_headers(client, db)
        lead_rec = {"Id": "00Q1x00001XyZaA", "FirstName": "Jane", "LastName": "Doe", "Company": "Acme"}
        sf = _make_sf_mock(account_records=[], lead_records=[lead_rec])
        with patch("routes.public_api_routes.get_sf_client", return_value=sf):
            resp = client.get(
                "/api/public/sf/account",
                headers=headers,
                params={"company_name": "Acme"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is True
        assert data["type"] == "Lead"
        assert data["sf_lead_id"] == "00Q1x00001XyZaA"
        assert "note" in data   # fallback note present

    def test_not_found_returns_found_false(self, client, db):
        headers = _generate_key_and_headers(client, db)
        sf = _make_sf_mock(account_records=[], lead_records=[])
        with patch("routes.public_api_routes.get_sf_client", return_value=sf):
            resp = client.get(
                "/api/public/sf/account",
                headers=headers,
                params={"company_name": "Nonexistent Corp"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is False
        assert "searched" in data

    def test_sf_url_is_lightning_format(self, client, db):
        headers = _generate_key_and_headers(client, db)
        sf = _make_sf_mock(account_records=[{"Id": "0011x00001AbCdG", "Name": "Org"}])
        with patch("routes.public_api_routes.get_sf_client", return_value=sf):
            resp = client.get(
                "/api/public/sf/account",
                headers=headers,
                params={"company_name": "Org"},
            )
        data = resp.json()
        assert data["sf_url"] is not None
        assert "/lightning/r/Account/" in data["sf_url"]

    def test_soql_injection_single_quote_escaped(self, client, db):
        """Company names with single quotes should not crash the SOQL query."""
        headers = _generate_key_and_headers(client, db)
        sf = _make_sf_mock(account_records=[], lead_records=[])
        with patch("routes.public_api_routes.get_sf_client", return_value=sf):
            resp = client.get(
                "/api/public/sf/account",
                headers=headers,
                params={"company_name": "O'Reilly Hospital"},
            )
        # Should NOT raise 500 — SOQL must be escaped
        assert resp.status_code == 200


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Upload company-ownership fix (cross-batch SDR assignment)
# ══════════════════════════════════════════════════════════════════════════════

def _make_csv(rows: list[dict]) -> str:
    """Build a minimal CSV string from a list of dicts."""
    if not rows:
        return ""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


class TestUploadCompanyOwnership:
    """
    Verifies that when a batch is uploaded to a pod, leads for companies that
    already have an assigned SDR go to that SDR — not to the next round-robin slot.
    """

    def _setup_pod_with_sdrs(self, db, n=3):
        """Create a pod with n SDR users, return (pod, [sdr1, sdr2, ...]."""
        pod = create_test_pod(db, name="India Pod")
        sdrs = []
        for i in range(n):
            sdr = create_test_user(
                db,
                email=f"sdr{i+1}@test.com",
                name=f"SDR {i+1}",
                role="SDR",
                pod_id=pod.id,
            )
            sdrs.append(sdr)
        create_sync_settings(db)
        return pod, sdrs

    def test_new_company_assigned_round_robin(self, client, db):
        """Completely new companies go through round-robin — not DB lookup."""
        pod, sdrs = self._setup_pod_with_sdrs(db, n=2)

        rows = [
            {"first name": "Alice", "last name": "A", "company": "NewCo Alpha", "phone": "1111111111"},
            {"first name": "Bob",   "last name": "B", "company": "NewCo Beta",  "phone": "2222222222"},
        ]
        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": _make_csv(rows),
            "mapping": {},
            "assign_to_pod_id": pod.id,
        })
        assert resp.status_code == 200
        assert resp.json()["created"] == 2

    def test_existing_company_respects_original_sdr(self, client, db):
        """
        If SDR-1 already owns 'Acme Hospital', a new lead for 'Acme Hospital'
        uploaded in a later batch must go to SDR-1, NOT to the next round-robin slot.
        """
        pod, sdrs = self._setup_pod_with_sdrs(db, n=2)
        sdr1, sdr2 = sdrs[0], sdrs[1]

        # Pre-existing lead assigned to sdr1
        existing = create_test_lead(db, first_name="Existing", last_name="Contact",
                                    company="Acme Hospital", lead_source="upload:batch1")
        sdr1.assigned_leads.append(existing)
        db.commit()

        # New batch import
        rows = [{"first name": "New", "last name": "Contact",
                 "company": "Acme Hospital", "phone": "9999999999"}]
        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": _make_csv(rows),
            "mapping": {},
            "assign_to_pod_id": pod.id,
        })
        assert resp.status_code == 200
        assert resp.json()["created"] == 1

        # Verify the new lead went to sdr1
        new_lead = db.query(models.Lead).filter(
            models.Lead.first_name == "New",
            models.Lead.company == "Acme Hospital"
        ).first()
        assert new_lead is not None
        assigned_user_ids = [u.id for u in new_lead.assigned_users]
        assert sdr1.id in assigned_user_ids, \
            f"Expected sdr1 ({sdr1.id}) to own 'Acme Hospital' lead, got {assigned_user_ids}"
        assert sdr2.id not in assigned_user_ids, \
            f"sdr2 ({sdr2.id}) incorrectly received 'Acme Hospital' lead"

    def test_multiple_companies_each_respect_owner(self, client, db):
        """
        When multiple existing companies are in the upload, each goes to its
        original SDR — no cross-SDR contamination.
        """
        pod, sdrs = self._setup_pod_with_sdrs(db, n=3)
        sdr1, sdr2, sdr3 = sdrs

        # sdr1 owns CompanyA, sdr2 owns CompanyB
        lead_a = create_test_lead(db, first_name="Old", last_name="A",
                                  company="CompanyA", lead_source="old:batch")
        lead_b = create_test_lead(db, first_name="Old", last_name="B",
                                  company="CompanyB", lead_source="old:batch")
        sdr1.assigned_leads.append(lead_a)
        sdr2.assigned_leads.append(lead_b)
        db.commit()

        rows = [
            {"first name": "New", "last name": "A2", "company": "CompanyA", "phone": "1000000001"},
            {"first name": "New", "last name": "B2", "company": "CompanyB", "phone": "1000000002"},
        ]
        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": _make_csv(rows),
            "mapping": {},
            "assign_to_pod_id": pod.id,
        })
        assert resp.status_code == 200
        assert resp.json()["created"] == 2

        new_a = db.query(models.Lead).filter(
            models.Lead.first_name == "New", models.Lead.company == "CompanyA"
        ).first()
        new_b = db.query(models.Lead).filter(
            models.Lead.first_name == "New", models.Lead.company == "CompanyB"
        ).first()

        assert sdr1.id in [u.id for u in new_a.assigned_users], \
            "CompanyA new lead should go to sdr1"
        assert sdr2.id in [u.id for u in new_b.assigned_users], \
            "CompanyB new lead should go to sdr2"

    def test_within_batch_company_grouping_still_works(self, client, db):
        """
        Multiple contacts for the same NEW company in a single batch
        should all land on the same SDR (within-batch grouping).
        """
        pod, sdrs = self._setup_pod_with_sdrs(db, n=2)

        rows = [
            {"first name": "Alice", "last name": "X", "company": "BrandNewCo", "phone": "8000000001"},
            {"first name": "Bob",   "last name": "Y", "company": "BrandNewCo", "phone": "8000000002"},
            {"first name": "Carol", "last name": "Z", "company": "BrandNewCo", "phone": "8000000003"},
        ]
        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": _make_csv(rows),
            "mapping": {},
            "assign_to_pod_id": pod.id,
        })
        assert resp.status_code == 200
        assert resp.json()["created"] == 3

        leads = db.query(models.Lead).filter(models.Lead.company == "BrandNewCo").all()
        assert len(leads) == 3

        # All 3 leads should have the SAME assigned SDR
        assigned_sets = [frozenset(u.id for u in l.assigned_users) for l in leads]
        assert len(set(assigned_sets)) == 1, \
            f"BrandNewCo contacts split across SDRs: {assigned_sets}"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — _escape_soql helper (unit tests, no DB/network needed)
# ══════════════════════════════════════════════════════════════════════════════

class TestEscapeSoql:
    def test_single_quote_escaped(self):
        from routes.public_api_routes import _escape_soql
        assert _escape_soql("O'Reilly") == "O\\'Reilly"

    def test_backslash_escaped(self):
        from routes.public_api_routes import _escape_soql
        assert _escape_soql("path\\name") == "path\\\\name"

    def test_clean_string_unchanged(self):
        from routes.public_api_routes import _escape_soql
        assert _escape_soql("Acme Hospital") == "Acme Hospital"

    def test_empty_string(self):
        from routes.public_api_routes import _escape_soql
        assert _escape_soql("") == ""


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6 — /leads/search and /leads/{id}/calls (RCM MCP data-access tools)
# ══════════════════════════════════════════════════════════════════════════════

class TestPublicLeadsSearch:
    def test_requires_api_key(self, client, db):
        resp = client.get("/api/public/leads/search", params={"q": "acme"})
        assert resp.status_code == 401

    def test_finds_lead_by_company(self, client, db):
        headers = _generate_key_and_headers(client, db)
        create_test_lead(db, first_name="Jane", last_name="Doe", company="Acme Corp")
        create_test_lead(db, first_name="Other", last_name="Person", company="Unrelated Inc",
                          email="other@unrelated.com")

        resp = client.get("/api/public/leads/search", params={"q": "Acme"}, headers=headers)
        assert resp.status_code == 200
        leads = resp.json()["leads"]
        assert len(leads) == 1
        assert leads[0]["company"] == "Acme Corp"
        assert leads[0]["name"] == "Jane Doe"

    def test_sees_leads_across_all_pods(self, client, db):
        """API key access is Super-Admin-equivalent — not scoped to one pod."""
        pod = create_test_pod(db, name="Pod A")
        create_test_lead(db, first_name="Pod", last_name="Lead", company="PodCo Ltd", pod_id=pod.id)
        headers = _generate_key_and_headers(client, db)

        resp = client.get("/api/public/leads/search", params={"q": "PodCo"}, headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()["leads"]) == 1


class TestPublicLeadCalls:
    def test_requires_api_key(self, client, db):
        lead = create_test_lead(db)
        resp = client.get(f"/api/public/leads/{lead.id}/calls")
        assert resp.status_code == 401

    def test_unknown_lead_returns_404(self, client, db):
        headers = _generate_key_and_headers(client, db)
        resp = client.get("/api/public/leads/does-not-exist/calls", headers=headers)
        assert resp.status_code == 404

    def test_returns_call_history_shape(self, client, db):
        headers = _generate_key_and_headers(client, db)
        lead = create_test_lead(db)
        resp = client.get(f"/api/public/leads/{lead.id}/calls", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "calls" in data
        assert "stats" in data
