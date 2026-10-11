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


class TestChatHealth:
    """Mitigation: /api/chat/health's live-ping step called a method
    (list_conversations) that doesn't exist on AlternateMessenger
    (the real method is get_conversations) — every ping raised AttributeError
    and reported "unreachable" even with fully valid credentials."""

    def _configure(self, db):
        settings = _get_settings(db)
        settings.messenger_enabled = True
        settings.messenger_api_key = "encrypted-placeholder"
        settings.messenger_user_id = "user-1"
        settings.messenger_account_id = "acct-1"
        settings.messenger_sender_id = "15550001111"
        db.commit()
        return settings

    def test_all_configured_ping_succeeds(self, client, db):
        self._configure(db)
        with patch(
            "conversations_service.AlternateMessenger.get_conversations",
            return_value=[],
        ):
            resp = client.get("/api/chat/health")
        body = resp.json()
        assert body["status"] == "ok"
        assert body["checks"]["api_reachable"]["ok"] is True

    def test_missing_account_id_skips_ping(self, client, db):
        settings = self._configure(db)
        settings.messenger_account_id = None
        db.commit()

        resp = client.get("/api/chat/health")
        body = resp.json()
        assert body["status"] == "degraded"
        assert body["checks"]["account_id_present"]["ok"] is False
        assert body["checks"]["api_reachable"]["ok"] is False


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
        config.webhook_secret_encrypted = "encrypted-secret"
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


class TestNylasTrackingHealth:
    """RCA 2026-10-07: a prod cadence showed 0% opens/clicks/replies and nobody could tell a broken
    webhook from nobody opening. The health check now says which."""

    def _configured(self, db, secret=True):
        config = _get_nylas_config(db)
        config.client_id, config.api_key_encrypted = "cid", "enc"
        config.webhook_secret_encrypted = "enc-secret" if secret else None
        db.commit()

    def _sent(self, db, n, hours_ago=5, opened=0):
        from datetime import datetime, timedelta, timezone
        from conftest import create_test_lead
        lead = create_test_lead(db)
        for i in range(n):
            db.add(models.LeadEmailActivity(
                lead_id=lead.id, direction="outbound", source="nylas", nylas_message_id=f"m{i}",
                timestamp=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
                opened_at=datetime.now(timezone.utc) if i < opened else None))
        db.commit()

    def _health(self, client):
        with patch("crypto.decrypt_token", return_value="k"), \
             patch("httpx.get", return_value=type("R", (), {"status_code": 200})()):
            return client.get("/api/email/health").json()

    def test_a_missing_webhook_secret_is_flagged(self, client, db):
        self._configured(db, secret=False)
        body = self._health(client)
        assert body["status"] == "degraded" and body["checks"]["webhook_secret_present"]["ok"] is False

    def test_mail_sent_but_no_event_ever_arrived_is_flagged(self, client, db):
        self._configured(db)
        self._sent(db, 12)
        body = self._health(client)
        assert body["checks"]["tracking_events_arriving"]["ok"] is False and body["status"] == "degraded"
        assert "message.link_clicked" in body["checks"]["tracking_events_arriving"]["message"]

    def test_events_arriving_is_healthy(self, client, db):
        self._configured(db)
        self._sent(db, 12, opened=1)
        assert self._health(client)["status"] == "ok"

    def test_too_little_mail_to_judge_is_not_a_failure(self, client, db):
        self._configured(db)
        self._sent(db, 3)
        assert self._health(client)["checks"]["tracking_events_arriving"]["ok"] is True

    def test_mail_sent_in_the_last_hour_is_not_judged_yet(self, client, db):
        self._configured(db)
        self._sent(db, 12, hours_ago=0)
        assert self._health(client)["checks"]["tracking_events_arriving"]["ok"] is True
