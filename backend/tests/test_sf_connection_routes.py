"""
test_sf_connection_routes.py — Salesforce connection management tests.
Covers: /status, /connect, /disconnect, /reconnect with mocked SF client.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

import models
from conftest import SUPER_ADMIN


def _create_sf_connection(db, is_active=True, environment="sandbox",
                          username="sf-user@test.com", status="connected"):
    """Create a SalesforceConnection row in the test DB."""
    conn = models.SalesforceConnection(
        instance_url="https://test.salesforce.com",
        environment=environment,
        username=username,
        password_encrypted="enc-password",
        security_token_encrypted="enc-token",
        org_id="00D000000000001",
        org_name="Test Org",
        connected_by_user_id="test-user-id",
        connected_by_name="Test Admin",
        connection_status=status,
        is_active=is_active,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Status Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestSFConnectionStatus:
    """GET /api/admin/sf/status — connection status check."""

    def test_status_no_connection_returns_env_fallback(self, client, db):
        """With no DB connection, should return env var fallback."""
        with patch.dict(os.environ, {"SF_USERNAME": "", "SF_DOMAIN": "login"}, clear=False):
            resp = client.get("/api/admin/sf/status")
            assert resp.status_code == 200
            data = resp.json()
            assert "connected" in data
            assert data["source"] is None or data["source"] == "env_vars"

    def test_status_with_active_connection(self, client, db):
        """With an active DB connection, should return full details."""
        _create_sf_connection(db)

        resp = client.get("/api/admin/sf/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["connected"] is True
        assert data["source"] == "ui"
        assert data["username"] == "sf-user@test.com"
        assert data["connection_status"] == "connected"
        assert data["org_name"] == "Test Org"


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Connect Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestSFConnect:
    """POST /api/admin/sf/connect — connect with credentials."""

    def test_connect_missing_fields_returns_422(self, client, db):
        """Missing username/password/token should return 422."""
        resp = client.post("/api/admin/sf/connect", json={
            "username": "user@test.com",
            # Missing password and security_token
        })
        assert resp.status_code == 422

    def test_connect_missing_password_returns_422(self, client, db):
        """Missing password should return 422."""
        resp = client.post("/api/admin/sf/connect", json={
            "username": "user@test.com",
            "password": "",
            "security_token": "tok123",
        })
        assert resp.status_code == 422

    def test_connect_invalid_environment_returns_422(self, client, db):
        """Invalid environment value should return 422."""
        resp = client.post("/api/admin/sf/connect", json={
            "username": "user@test.com",
            "password": "pass123",
            "security_token": "tok123",
            "environment": "staging",  # Invalid — must be sandbox or production
        })
        assert resp.status_code == 422

    @patch("routes.sf_connection_routes.Salesforce", side_effect=Exception("Auth failed"))
    def test_connect_bad_credentials_returns_400(self, mock_sf, client, db):
        """SF login failure should return 400."""
        resp = client.post("/api/admin/sf/connect", json={
            "username": "user@test.com",
            "password": "wrong-pass",
            "security_token": "tok123",
            "environment": "sandbox",
        })
        assert resp.status_code == 400
        assert "Failed to connect" in resp.json()["detail"]

    @patch("routes.sf_connection_routes.encrypt_token", return_value="enc-value")
    @patch("routes.sf_connection_routes.Salesforce")
    def test_connect_success_stores_encrypted(self, mock_sf_cls, mock_encrypt, client, db):
        """Successful connection should store encrypted credentials in DB."""
        mock_sf = MagicMock()
        mock_sf.sf_instance = "na1.salesforce.com"
        mock_sf.query.return_value = {
            "records": [{"Id": "00D12345", "Name": "Acme Corp"}]
        }
        mock_sf_cls.return_value = mock_sf

        resp = client.post("/api/admin/sf/connect", json={
            "username": "admin@acme.com",
            "password": "securepass",
            "security_token": "tok456",
            "environment": "production",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "Successfully connected to Salesforce"
        assert data["connection"]["username"] == "admin@acme.com"
        assert data["connection"]["org_name"] == "Acme Corp"

        # Verify DB row
        conn = db.query(models.SalesforceConnection).filter(
            models.SalesforceConnection.is_active == True
        ).first()
        assert conn is not None
        assert conn.username == "admin@acme.com"
        assert conn.password_encrypted == "enc-value"

    @patch("routes.sf_connection_routes.encrypt_token", return_value="enc-value")
    @patch("routes.sf_connection_routes.Salesforce")
    def test_connect_deactivates_existing(self, mock_sf_cls, mock_encrypt, client, db):
        """New connection should deactivate existing active connections."""
        old_conn = _create_sf_connection(db, username="old@test.com")

        mock_sf = MagicMock()
        mock_sf.sf_instance = "na2.salesforce.com"
        mock_sf.query.return_value = {"records": []}
        mock_sf_cls.return_value = mock_sf

        resp = client.post("/api/admin/sf/connect", json={
            "username": "new@test.com",
            "password": "pass",
            "security_token": "tok",
            "environment": "sandbox",
        })
        assert resp.status_code == 200

        db.refresh(old_conn)
        assert old_conn.is_active is False
        assert old_conn.connection_status == "disconnected"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Disconnect Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestSFDisconnect:
    """POST /api/admin/sf/disconnect — deactivate connection."""

    def test_disconnect_active_connection(self, client, db):
        """Should deactivate the current active connection."""
        conn = _create_sf_connection(db)

        resp = client.post("/api/admin/sf/disconnect")
        assert resp.status_code == 200

        db.refresh(conn)
        assert conn.is_active is False
        assert conn.connection_status == "disconnected"

    def test_disconnect_no_connection_returns_404(self, client, db):
        """With no active connection, should return 404."""
        resp = client.post("/api/admin/sf/disconnect")
        assert resp.status_code == 404
