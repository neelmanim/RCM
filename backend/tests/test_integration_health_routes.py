"""
Tests for routes/integration_health_routes.py — /api/klenty/health.

Mitigation for the "Klenty API key never verified against the live API"
risk flagged before the v10.5.3 prod promotion — an admin can now confirm
a saved key actually works instead of only finding out via a silent
nightly job failure in the logs.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch
import models


def _get_settings(db):
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        settings = models.SyncSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


class TestKlentyHealth:

    def test_disabled_and_no_key(self, client, db):
        _get_settings(db)
        resp = client.get("/api/klenty/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "degraded"
        assert body["checks"]["feature_enabled"]["ok"] is False
        assert body["checks"]["api_key_present"]["ok"] is False
        assert body["checks"]["api_reachable"]["ok"] is False

    def test_enabled_but_no_key(self, client, db):
        settings = _get_settings(db)
        settings.klenty_enabled = True
        db.commit()

        resp = client.get("/api/klenty/health")
        body = resp.json()
        assert body["status"] == "degraded"
        assert body["checks"]["feature_enabled"]["ok"] is True
        assert body["checks"]["api_key_present"]["ok"] is False

    def test_key_present_connection_succeeds(self, client, db):
        settings = _get_settings(db)
        settings.klenty_enabled = True
        settings.klenty_api_key = "encrypted-placeholder"
        db.commit()

        with patch("crypto.decrypt_token", return_value="real-klenty-key"), \
             patch("klenty_provider.KlentyDialerProvider.test_connection",
                   return_value={"success": True, "message": "Klenty API key accepted"}):
            resp = client.get("/api/klenty/health")
        body = resp.json()
        assert body["status"] == "ok"
        assert body["checks"]["api_reachable"]["ok"] is True

    def test_key_present_connection_fails(self, client, db):
        """The exact scenario this endpoint exists to catch: a bad/expired
        key must be surfaced clearly, not silently accepted."""
        settings = _get_settings(db)
        settings.klenty_enabled = True
        settings.klenty_api_key = "encrypted-placeholder"
        db.commit()

        with patch("crypto.decrypt_token", return_value="bad-key"), \
             patch("klenty_provider.KlentyDialerProvider.test_connection",
                   return_value={"success": False, "message": "401 Unauthorized"}):
            resp = client.get("/api/klenty/health")
        body = resp.json()
        assert body["status"] == "degraded"
        assert body["checks"]["api_reachable"]["ok"] is False
        assert "401" in body["checks"]["api_reachable"]["message"]


def _get_nylas_config(db):
    config = db.query(models.NylasConfig).filter(models.NylasConfig.id == 1).first()
    if not config:
        config = models.NylasConfig(id=1, is_active=True)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


class TestNylasHealth:
    """Mitigation for the 2026-07-24 prod incident: a stored Nylas API key
    that could no longer be decrypted (stale key mismatch) only surfaced
    when an SDR's mailbox OAuth callback failed. An admin can now verify
    the saved key actually decrypts and works right after saving it."""

    def test_not_configured(self, client, db):
        resp = client.get("/api/email/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "error"

    def test_configured_but_no_key(self, client, db):
        config = _get_nylas_config(db)
        config.client_id = "some-client-id"
        db.commit()

        resp = client.get("/api/email/health")
        body = resp.json()
        assert body["status"] == "degraded"
        assert body["checks"]["api_key_present"]["ok"] is False

    def test_key_present_connection_succeeds(self, client, db):
        config = _get_nylas_config(db)
        config.client_id = "some-client-id"
        config.api_key_encrypted = "encrypted-placeholder"
        db.commit()

        with patch("crypto.decrypt_token", return_value="real-nylas-key"), \
             patch("httpx.get", return_value=type("R", (), {"status_code": 200})()):
            resp = client.get("/api/email/health")
        body = resp.json()
        assert body["status"] == "ok"
        assert body["checks"]["api_reachable"]["ok"] is True

    def test_stale_key_fails_to_decrypt(self, client, db):
        """The exact scenario this endpoint exists to catch: a key that no
        longer decrypts under the current APP_ENCRYPTION_KEY must be
        surfaced clearly, not silently accepted."""
        config = _get_nylas_config(db)
        config.client_id = "some-client-id"
        config.api_key_encrypted = "encrypted-under-a-different-key"
        db.commit()

        with patch("crypto.decrypt_token", side_effect=Exception("decryption failed")):
            resp = client.get("/api/email/health")
        body = resp.json()
        assert body["status"] == "degraded"
        assert body["checks"]["api_reachable"]["ok"] is False
        assert "decrypt" in body["checks"]["api_reachable"]["message"].lower()
