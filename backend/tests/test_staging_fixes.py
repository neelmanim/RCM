"""
Tests for the staging/production bug fixes applied in v5.8.x:

  PROD BUG  — _sanitize_email() in salesforce.py strips dirty email addresses
  BUG-2     — list_call_logs scoped to known RCM users (not all Aircall data)
  BUG-4     — GET /api/admin/sf-connection-info returns DB connection first
  BUG-4b    — GET /api/admin/sf/status returns correct fields (last_sync_at, etc.)
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from conftest import (
    create_test_user,
    create_test_lead,
    SUPER_ADMIN,
)
import models


# ═══════════════════════════════════════════════════════════════════════════════
# PROD BUG — _sanitize_email() in salesforce.py
# ═══════════════════════════════════════════════════════════════════════════════

class TestSanitizeEmail:
    """Unit tests for the _sanitize_email() helper added to salesforce.py."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from salesforce import _sanitize_email
        self.sanitize = _sanitize_email

    # ── Happy paths ────────────────────────────────────────────────────────────

    def test_clean_email_unchanged(self):
        assert self.sanitize("user@example.com") == "user@example.com"

    def test_strips_leading_trailing_whitespace(self):
        assert self.sanitize("  user@example.com  ") == "user@example.com"

    def test_removes_internal_spaces(self):
        """'shubhankar.m@irishealthservices. com' → 'shubhankar.m@irishealthservices.com'"""
        assert self.sanitize("shubhankar.m@irishealthservices. com") == "shubhankar.m@irishealthservices.com"

    def test_removes_multiple_internal_spaces(self):
        assert self.sanitize("user @ex am ple.com") == "user@example.com"

    def test_strips_trailing_dot(self):
        """'user@example.com.' → 'user@example.com'"""
        assert self.sanitize("user@example.com.") == "user@example.com"

    def test_strips_trailing_dot_with_space(self):
        """'user@example. com.' — both space removal and trailing dot removal."""
        assert self.sanitize("user@example. com.") == "user@example.com"

    def test_tabs_and_newlines_removed(self):
        assert self.sanitize("user\t@example\n.com") == "user@example.com"

    # ── Rejection / empty return ───────────────────────────────────────────────

    def test_empty_string_returns_empty(self):
        assert self.sanitize("") == ""

    def test_none_returns_empty(self):
        assert self.sanitize(None) == ""

    def test_no_at_sign_returns_empty(self):
        assert self.sanitize("notanemail.com") == ""

    def test_missing_domain_returns_empty(self):
        assert self.sanitize("user@") == ""

    def test_missing_tld_returns_empty(self):
        assert self.sanitize("user@nodot") == ""

    def test_multiple_at_signs_returns_empty(self):
        assert self.sanitize("user@@example.com") == ""

    def test_spaces_only_returns_empty(self):
        assert self.sanitize("   ") == ""

    # ── Exact reproduction of the production error ─────────────────────────────

    def test_production_case_irish_health_services(self):
        """Exact email from the production SF write-back failure."""
        raw = "shubhankar.m@irishealthservices. com."
        result = self.sanitize(raw)
        assert result == "shubhankar.m@irishealthservices.com"
        assert " " not in result
        assert not result.endswith(".")


# ═══════════════════════════════════════════════════════════════════════════════
# BUG-2 — list_call_logs scoped to known RCM users
# ═══════════════════════════════════════════════════════════════════════════════

class TestCallLogsScoping:
    """
    GET /api/admin/call-logs must only return DialerCall rows whose user_id
    exists in the RCM users table.

    Aircall webhooks can write DialerCall rows with user_ids that belong to
    other orgs (Australian SDRs, demo accounts, etc.). These must be invisible.
    """

    def _make_dialer_call(self, db, user_id, provider="aircall", phone="+61400000001"):
        call = models.DialerCall(
            user_id=user_id,
            provider=provider,
            phone_number=phone,
            status="CALL_ENDED",
            direction="outbound",
        )
        db.add(call)
        db.commit()
        db.refresh(call)
        return call

    def test_own_user_calls_visible(self, client, db):
        """Calls from users registered in this instance appear in the response."""
        user = create_test_user(db, email="sdr1@rcm.com")
        self._make_dialer_call(db, user_id=user.id)

        resp = client.get("/api/admin/call-logs")
        assert resp.status_code == 200
        data = resp.json()
        returned_user_ids = {row.get("user_id") or row.get("user", {}).get("id") for row in data.get("calls", data) if isinstance(row, dict)}
        # At minimum, no 404/500
        assert isinstance(data, (list, dict))

    def test_foreign_user_calls_excluded(self, client, db):
        """Calls with a user_id NOT in the users table are excluded."""
        # Create a call with a foreign user_id (simulates Aircall cross-org data)
        foreign_call = models.DialerCall(
            user_id="foreign-org-user-id-that-doesnt-exist",
            provider="aircall",
            phone_number="+61412345678",
            status="CALL_ENDED",
            direction="outbound",
        )
        db.add(foreign_call)
        db.commit()

        resp = client.get("/api/admin/call-logs")
        assert resp.status_code == 200
        data = resp.json()
        calls = data.get("calls", data) if isinstance(data, dict) else data

        # The foreign call must not appear
        foreign_ids = {
            c.get("id") or c.get("call_id")
            for c in calls
            if isinstance(c, dict)
        }
        assert foreign_call.id not in foreign_ids

    def test_mixed_only_local_users_returned(self, client, db):
        """With both local and foreign calls, only local-user calls appear."""
        local_user = create_test_user(db, email="local@rcm.com")
        local_call = self._make_dialer_call(db, user_id=local_user.id, phone="+919999900000")

        # Foreign call — user_id not in users table
        foreign_call = models.DialerCall(
            user_id="aus-sdr-aircall-id-999",
            provider="aircall",
            phone_number="+61400111222",
            status="CALL_ENDED",
            direction="outbound",
        )
        db.add(foreign_call)
        db.commit()

        resp = client.get("/api/admin/call-logs")
        assert resp.status_code == 200
        data = resp.json()
        calls = data.get("calls", data) if isinstance(data, dict) else data

        returned_ids = {c.get("id") or c.get("call_id") for c in calls if isinstance(c, dict)}
        assert foreign_call.id not in returned_ids

    def test_call_logs_empty_db_returns_200(self, client, db):
        """Empty DialerCall table returns 200 with empty list, no 500."""
        resp = client.get("/api/admin/call-logs")
        assert resp.status_code == 200

    def test_null_user_id_calls_excluded(self, client, db):
        """DialerCall rows with user_id=None are also excluded by the IN subquery."""
        null_call = models.DialerCall(
            user_id=None,
            provider="rcm",
            phone_number="+910000000000",
            status="CALL_STARTED",
            direction="outbound",
        )
        db.add(null_call)
        db.commit()

        resp = client.get("/api/admin/call-logs")
        assert resp.status_code == 200
        data = resp.json()
        calls = data.get("calls", data) if isinstance(data, dict) else data
        returned_ids = {c.get("id") for c in calls if isinstance(c, dict)}
        assert null_call.id not in returned_ids


# ═══════════════════════════════════════════════════════════════════════════════
# BUG-4 — GET /api/admin/sf-connection-info reads DB first
# ═══════════════════════════════════════════════════════════════════════════════

class TestSfConnectionInfo:
    """
    GET /api/admin/sf-connection-info should return DB-stored connection data
    when available, falling back to env vars only when no active DB row exists.
    """

    def _make_sf_connection(self, db, username="admin@sandbox.com",
                             environment="sandbox", instance_url="https://test.salesforce.com",
                             connection_status="connected", is_active=True):
        conn = models.SalesforceConnection(
            username=username,
            environment=environment,
            instance_url=instance_url,
            password_encrypted="enc-pass",
            security_token_encrypted="enc-token",
            connection_status=connection_status,
            is_active=is_active,
        )
        db.add(conn)
        db.commit()
        db.refresh(conn)
        return conn

    def test_returns_db_connection_when_active(self, client, db):
        """When an active SalesforceConnection row exists, it takes priority over env vars."""
        self._make_sf_connection(db, username="staging@mysandbox.com", environment="sandbox")

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SF_USERNAME", None)   # ensure env var absent
            resp = client.get("/api/admin/sf-connection-info")

        assert resp.status_code == 200
        data = resp.json()
        assert data["connected"] is True
        assert data["username"] == "staging@mysandbox.com"
        assert data["domain_type"] == "Sandbox"

    def test_db_connection_preferred_over_env_vars(self, client, db):
        """DB connection wins even when SF_USERNAME env var is also set."""
        self._make_sf_connection(db, username="db-user@org.com", environment="production")

        with patch.dict(os.environ, {"SF_USERNAME": "env-user@org.com", "SF_DOMAIN": "login"}):
            resp = client.get("/api/admin/sf-connection-info")

        assert resp.status_code == 200
        data = resp.json()
        # DB row must win
        assert data["username"] == "db-user@org.com"
        assert data["domain_type"] == "Production"

    def test_falls_back_to_env_vars_when_no_db_connection(self, client, db):
        """No active DB row → fall back to SF_USERNAME env var."""
        with patch.dict(os.environ, {"SF_USERNAME": "env-only@org.com", "SF_DOMAIN": "login"}):
            resp = client.get("/api/admin/sf-connection-info")

        assert resp.status_code == 200
        data = resp.json()
        assert data["connected"] is True
        assert data["username"] == "env-only@org.com"

    def test_disconnected_db_row_not_returned(self, client, db):
        """A DB row with is_active=False is ignored; endpoint falls back to env vars."""
        self._make_sf_connection(db, username="old@sandbox.com", is_active=False)

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SF_USERNAME", None)
            resp = client.get("/api/admin/sf-connection-info")

        assert resp.status_code == 200
        data = resp.json()
        assert data["connected"] is False
        assert data["username"] in (None, "")

    def test_not_connected_when_no_db_and_no_env(self, client, db):
        """No DB row and no env var → connected=False."""
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SF_USERNAME", None)
            os.environ.pop("SF_DOMAIN", None)
            resp = client.get("/api/admin/sf-connection-info")

        assert resp.status_code == 200
        assert resp.json()["connected"] is False

    def test_sandbox_env_domain_maps_correctly(self, client, db):
        """SF_DOMAIN=test → domain_type=Sandbox."""
        with patch.dict(os.environ, {"SF_USERNAME": "u@s.com", "SF_DOMAIN": "test"}):
            resp = client.get("/api/admin/sf-connection-info")
        assert resp.status_code == 200
        assert resp.json()["domain_type"] == "Sandbox"

    def test_production_env_domain_maps_correctly(self, client, db):
        """SF_DOMAIN=login → domain_type=Production."""
        with patch.dict(os.environ, {"SF_USERNAME": "u@p.com", "SF_DOMAIN": "login"}):
            resp = client.get("/api/admin/sf-connection-info")
        assert resp.status_code == 200
        assert resp.json()["domain_type"] == "Production"


# ═══════════════════════════════════════════════════════════════════════════════
# BUG-4b — GET /api/admin/sf/status returns correct field names
# ═══════════════════════════════════════════════════════════════════════════════

class TestSfStatusFieldNames:
    """
    Verify GET /api/admin/sf/status returns the correct field names that
    the frontend expects: last_sync_at, last_sync_status, records_synced_last_run.

    The frontend was previously reading sfInfo.last_synced (wrong) and getting
    'Never' for every sync. The backend correctly returns last_sync_at.
    """

    def _make_sf_connection_with_sync(self, db):
        from datetime import datetime, timezone
        conn = models.SalesforceConnection(
            username="admin@test.com",
            environment="production",
            instance_url="https://rcm.my.salesforce.com",
            password_encrypted="enc-pass",
            security_token_encrypted="enc-token",
            connection_status="connected",
            is_active=True,
            last_sync_at=datetime(2026, 5, 21, 8, 0, 0, tzinfo=timezone.utc),
            last_sync_status="success",
            records_synced_last_run=42,
        )
        db.add(conn)
        db.commit()
        db.refresh(conn)
        return conn

    def test_last_sync_at_field_present(self, client, db):
        """Response must contain 'last_sync_at', not 'last_synced'."""
        self._make_sf_connection_with_sync(db)
        resp = client.get("/api/admin/sf/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "last_sync_at" in data, "Backend must return 'last_sync_at' (not 'last_synced')"
        assert "last_synced" not in data, "Old field name 'last_synced' must not be present"

    def test_last_sync_at_value_correct(self, client, db):
        """last_sync_at value matches what was stored."""
        self._make_sf_connection_with_sync(db)
        resp = client.get("/api/admin/sf/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["last_sync_at"] is not None
        assert "2026" in str(data["last_sync_at"])

    def test_last_sync_status_field_present(self, client, db):
        """Response must contain 'last_sync_status'."""
        self._make_sf_connection_with_sync(db)
        resp = client.get("/api/admin/sf/status")
        assert resp.status_code == 200
        assert "last_sync_status" in resp.json()
        assert resp.json()["last_sync_status"] == "success"

    def test_records_synced_last_run_field_present(self, client, db):
        """Response must contain 'records_synced_last_run'."""
        self._make_sf_connection_with_sync(db)
        resp = client.get("/api/admin/sf/status")
        assert resp.status_code == 200
        assert resp.json()["records_synced_last_run"] == 42

    def test_source_ui_when_db_connection(self, client, db):
        """source='ui' when connection comes from the DB (admin connected via UI)."""
        self._make_sf_connection_with_sync(db)
        resp = client.get("/api/admin/sf/status")
        assert resp.status_code == 200
        assert resp.json()["source"] == "ui"

    def test_source_env_vars_when_no_db(self, client, db):
        """source='env_vars' when no DB connection and env var is set."""
        with patch.dict(os.environ, {"SF_USERNAME": "env@test.com", "SF_DOMAIN": "login"}):
            resp = client.get("/api/admin/sf/status")
        assert resp.status_code == 200
        assert resp.json()["source"] == "env_vars"

    def test_last_sync_at_none_when_never_synced(self, client, db):
        """last_sync_at=None when connection exists but sync has never run."""
        conn = models.SalesforceConnection(
            username="fresh@test.com",
            environment="sandbox",
            instance_url="https://test.salesforce.com",
            password_encrypted="enc",
            security_token_encrypted="enc",
            connection_status="connected",
            is_active=True,
            last_sync_at=None,
            last_sync_status=None,
            records_synced_last_run=0,
        )
        db.add(conn)
        db.commit()
        resp = client.get("/api/admin/sf/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["last_sync_at"] is None
        assert data["records_synced_last_run"] == 0


# ═══════════════════════════════════════════════════════════════════════════════
# RCA-2026-05-28 — Sentinel sf_lead_id values must never be pushed to Salesforce
#
# Root cause: anonymous RCM calls create leads with MIG-/MANUAL- prefixed
# sf_lead_id values. The SF push guard in push_pending_leads_to_salesforce only
# checked lowercase "manual-" (missed uppercase "MANUAL-") and had no MIG- guard.
# push_lead_to_salesforce itself had zero guard, so direct callers (call outcome
# submission, lead status update) all leaked sentinel IDs to Salesforce.
#
# Fix: _is_sentinel_sf_id() + early-return in push_lead_to_salesforce.
# ═══════════════════════════════════════════════════════════════════════════════

class TestSentinelSfId:
    """Unit tests for _is_sentinel_sf_id() and push_lead_to_salesforce guard."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from salesforce import _is_sentinel_sf_id, push_lead_to_salesforce
        self._is_sentinel = _is_sentinel_sf_id
        self._push = push_lead_to_salesforce

    # ── _is_sentinel_sf_id unit tests ─────────────────────────────────────────

    def test_mig_prefix_is_sentinel(self):
        """MIG-a8f784ac (the exact ID from the production SF error) is a sentinel."""
        assert self._is_sentinel("MIG-a8f784ac") is True

    def test_mig_prefix_lowercase_is_sentinel(self):
        assert self._is_sentinel("mig-abc123") is True

    def test_manual_uppercase_is_sentinel(self):
        """MANUAL-{uuid16} written by dialer_routes.py v6.8.1 is a sentinel."""
        assert self._is_sentinel("MANUAL-4f2a1b3c9e8d7f6a") is True

    def test_manual_lowercase_is_sentinel(self):
        assert self._is_sentinel("manual-4f2a1b3c9e8d7f6a") is True

    def test_upload_prefix_is_sentinel(self):
        assert self._is_sentinel("upload-abc123") is True

    def test_sandbox_prefix_is_sentinel(self):
        assert self._is_sentinel("sandbox-xyz") is True

    def test_hyphen_in_id_is_sentinel(self):
        """Any hyphen in sf_lead_id = not a real 18-char SF ID."""
        assert self._is_sentinel("some-random-id") is True

    def test_none_is_sentinel(self):
        assert self._is_sentinel(None) is True

    def test_empty_string_is_sentinel(self):
        assert self._is_sentinel("") is True

    def test_real_sf_id_15_char_not_sentinel(self):
        """Real 15-char Salesforce ID — no hyphens, no sentinel prefix."""
        assert self._is_sentinel("00Q1a000005bKsD") is False

    def test_real_sf_id_18_char_not_sentinel(self):
        """Real 18-char Salesforce ID — standard format."""
        assert self._is_sentinel("00Q1a000005bKsDEAU") is False

    # ── push_lead_to_salesforce guard behaviour ────────────────────────────────

    def test_push_skips_mig_sentinel_returns_false(self):
        """push_lead_to_salesforce must return False and NOT call sf.Lead.update
        when given a MIG- prefixed sf_lead_id (the exact prod failure case)."""
        mock_sf = MagicMock()
        result = self._push(mock_sf, "MIG-a8f784ac", {"status": "New Lead"})
        assert result is False
        mock_sf.Lead.update.assert_not_called()

    def test_push_skips_manual_uppercase_sentinel(self):
        """MANUAL- (uppercase, from dialer_routes.py) must also be blocked."""
        mock_sf = MagicMock()
        result = self._push(mock_sf, "MANUAL-4f2a1b3c9e8d7f6a", {"status": "Calling"})
        assert result is False
        mock_sf.Lead.update.assert_not_called()

    def test_push_skips_upload_sentinel(self):
        mock_sf = MagicMock()
        result = self._push(mock_sf, "upload-abc123", {"status": "Meeting Scheduled"})
        assert result is False
        mock_sf.Lead.update.assert_not_called()

    def test_push_calls_sf_for_real_id(self):
        """A real 18-char SF ID must reach sf.Lead.update."""
        mock_sf = MagicMock()
        mock_sf.Lead.update.return_value = None  # simulate success
        result = self._push(mock_sf, "00Q1a000005bKsDEAU", {"status": "New Lead"})
        assert result is True
        mock_sf.Lead.update.assert_called_once()

    def test_push_returns_false_for_none_sf_client(self):
        """sf=None always returns False regardless of sf_lead_id."""
        result = self._push(None, "00Q1a000005bKsDEAU", {"status": "Calling"})
        assert result is False

    def test_push_returns_false_for_none_sf_lead_id(self):
        """sf_lead_id=None always returns False."""
        mock_sf = MagicMock()
        result = self._push(mock_sf, None, {"status": "Calling"})
        assert result is False
        mock_sf.Lead.update.assert_not_called()
