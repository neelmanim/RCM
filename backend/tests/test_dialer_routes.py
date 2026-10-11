"""
Tests for routes/dialer_routes.py — dialer webhook, call initiation, config endpoints.
All external dialer provider calls are mocked.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch, MagicMock

from conftest import create_test_user, create_test_lead, create_test_pod


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_dialer_app(db):
    """Build a minimal FastAPI app including the dialer router."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin
    from routes.dialer_routes import router as dialer_router
    from routes.call_routes import router as call_router  # needed for DialerCall model queries

    from conftest import SUPER_ADMIN

    app = FastAPI()
    app.include_router(dialer_router)
    app.include_router(call_router)

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SUPER_ADMIN
    app.dependency_overrides[require_admin] = lambda: SUPER_ADMIN
    app.dependency_overrides[require_super_admin] = lambda: SUPER_ADMIN

    return TestClient(app)


# ─────────────────────────────────────────────────────────────────────────────
# Dialer Webhook Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestDialerWebhook:
    """Tests for POST /api/webhooks/dialer."""

    def test_returns_ok_when_no_provider_configured(self, db):
        """Webhook should return 200 + a message when no dialer is configured."""
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_dialer_config") as mock_config:
            mock_config.return_value = {"provider": "none", "has_credentials": False}
            resp = client.post("/api/webhooks/dialer", json={"event": "call.ended", "id": "123"})

        assert resp.status_code == 200
        data = resp.json()
        assert data.get("ok") is True
        assert "No provider" in data.get("message", "")

    def test_rejects_invalid_json(self, db):
        """Webhook with non-JSON body should return 400."""
        client = _make_dialer_app(db)
        resp = client.post(
            "/api/webhooks/dialer",
            content=b"not-json",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 400

    def test_rejects_invalid_webhook_token(self, db, monkeypatch):
        """If a webhook_token is configured, mismatched token should return 401."""
        monkeypatch.setenv("SECURITY_WEBHOOK_MODE", "enforce")
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_dialer_config") as mock_config:
            mock_config.return_value = {
                "provider": "aircall",
                "has_credentials": True,
                "webhook_token": "correct-secret",
            }
            resp = client.post(
                "/api/webhooks/dialer",
                json={"token": "wrong-token", "event": "call.ended"},
            )

        assert resp.status_code == 401

    def test_accepts_valid_webhook_token(self, db):
        """Webhook with correct token should be processed (not rejected)."""
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_dialer_config") as mock_config, \
             patch("routes.dialer_routes.dialer_service.handle_webhook") as mock_handle:
            mock_config.return_value = {
                "provider": "aircall",
                "has_credentials": True,
                "webhook_token": "correct-secret",
            }
            mock_handle.return_value = {"ok": True, "processed": True}

            resp = client.post(
                "/api/webhooks/dialer",
                json={"token": "correct-secret", "event": "call.ended"},
            )

        assert resp.status_code == 200
        mock_handle.assert_called_once()

    def test_refuses_webhook_when_no_token_is_configured(self, db, monkeypatch):
        """RCA 2026-09-29: no configured token used to mean "accept anything"."""
        monkeypatch.setenv("SECURITY_WEBHOOK_MODE", "enforce")
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_dialer_config") as mock_config, \
             patch("routes.dialer_routes.dialer_service.handle_webhook") as mock_handle:
            mock_config.return_value = {
                "provider": "aircall",
                "has_credentials": True,
                "webhook_token": None,
            }
            resp = client.post(
                "/api/webhooks/dialer",
                json={"event": "call.answered", "call_id": "abc-123"},
            )

        assert resp.status_code == 401
        mock_handle.assert_not_called()

    def test_returns_200_even_on_handler_exception(self, db):
        """
        Webhook handler exceptions must not cause a 5xx or a non-200 response.
        Since handle_webhook now runs in a BackgroundTask, the HTTP response
        is always {"ok": True} (returned before the task runs). Errors are
        logged via logger.error in _process_dialer_webhook_bg but never surface
        to the provider — which is the correct behaviour to suppress retries.
        """
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_dialer_config") as mock_config, \
             patch("routes.dialer_routes.dialer_service.handle_webhook") as mock_handle:
            mock_config.return_value = {
                "provider": "aircall",
                "has_credentials": True,
                "webhook_token": None,
            }
            mock_handle.side_effect = RuntimeError("DB connection failed")

            resp = client.post(
                "/api/webhooks/dialer",
                json={"event": "call.ended"},
            )

        # Must return 200 to suppress provider retries
        assert resp.status_code == 200
        data = resp.json()
        # New contract: async offload — always ok:True immediately.
        # Error handling happens in the background task (logged, not surfaced).
        assert data.get("ok") is True

    def test_messenger_payload_routes_correctly_even_when_global_default_is_aircall(self, db):
        """
        RCA 2026-07-10: Aircall and Alternate Messenger are independent providers — a
        Alternate Messenger-shaped payload ({"call_id":..., "status":...}, no "event"/"data")
        must route to the Alternate Messenger handler even when the global `dialer_provider`
        setting is "aircall" (per-user overrides mean both can be active at once).
        Previously this payload was silently handed to the Aircall parser and
        dropped, so Alternate Messenger calls never got status updates from webhooks.
        """
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_dialer_config") as mock_config, \
             patch("routes.dialer_routes.dialer_service.handle_webhook") as mock_handle:
            mock_config.return_value = {
                "provider": "aircall",  # global default — must NOT determine routing
                "has_credentials": True,
                "has_messenger_credentials": True,
                "webhook_token": None,
            }
            mock_handle.return_value = {"ok": True}

            resp = client.post(
                "/api/webhooks/dialer",
                json={"call_id": "767", "status": "failed"},
            )

        assert resp.status_code == 200
        assert mock_handle.call_args[0][1] == "messenger"

    def test_aircall_payload_routes_correctly_even_when_global_default_is_messenger(self, db):
        """Mirror of the above: Aircall's own shape must still route to aircall."""
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_dialer_config") as mock_config, \
             patch("routes.dialer_routes.dialer_service.handle_webhook") as mock_handle:
            mock_config.return_value = {
                "provider": "messenger",  # global default flipped — must still not matter
                "has_credentials": True,
                "has_messenger_credentials": True,
                "webhook_token": None,
            }
            mock_handle.return_value = {"ok": True}

            resp = client.post(
                "/api/webhooks/dialer",
                json={"event": "call.ended", "data": {"id": 123}},
            )

        assert resp.status_code == 200
        assert mock_handle.call_args[0][1] == "aircall"


class TestDialerWebhookBackgroundProcessor:
    """Tests for _process_dialer_webhook_bg — the SSE publish wiring fix.

    RCA 2026-08-20: both Aircall and Alternate Messenger actually hit this generic
    endpoint in production (confirmed live — zero traffic on the
    provider-specific /webhooks/aircall or /webhooks/messenger endpoints
    over a 7-day window), but the background processor never called
    _publish_call_status(), so no dialer call ever reached the browser via
    SSE — every SDR relied entirely on client-side polling.
    """

    @pytest.mark.asyncio
    async def test_publishes_call_status_after_handling_webhook(self, db):
        from routes import dialer_routes

        fake_result = {"user_id": "test-user-id", "call_id": "call-abc", "status": "CALL_ENDED"}

        with patch("routes.dialer_routes.dialer_service.handle_webhook", return_value=fake_result), \
             patch("routes.dialer_routes._publish_call_status") as mock_publish:
            await dialer_routes._process_dialer_webhook_bg("aircall", {"event": "call.ended"})

        mock_publish.assert_awaited_once_with(fake_result)

    @pytest.mark.asyncio
    async def test_does_not_publish_if_handle_webhook_raises(self, db):
        """A handler exception must not crash the background task (already
        caught + logged) and must not call publish with no result."""
        from routes import dialer_routes

        with patch("routes.dialer_routes.dialer_service.handle_webhook", side_effect=RuntimeError("boom")), \
             patch("routes.dialer_routes._publish_call_status") as mock_publish:
            await dialer_routes._process_dialer_webhook_bg("aircall", {"event": "call.ended"})

        mock_publish.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# Dialer Status Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestDialerStatus:
    """Tests for GET /api/dialer/status."""

    def test_returns_inactive_when_no_provider(self, db):
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_provider_for_user") as mock_prov, \
             patch("routes.dialer_routes.dialer_service.get_dialer_config") as mock_config:
            mock_prov.return_value = None
            mock_config.return_value = {"provider": "none", "has_credentials": False}
            resp = client.get("/api/dialer/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is False
        assert data["provider"] == "none"

    def test_returns_active_when_configured(self, db):
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_provider_for_user") as mock_prov:
            provider_mock = MagicMock()
            provider_mock.provider_name = "aircall"
            mock_prov.return_value = provider_mock
            resp = client.get("/api/dialer/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is True
        assert data["provider"] == "aircall"

    # ── new: live-DB dialer_enabled gate ──────────────────────────────────────

    def test_returns_inactive_when_user_dialer_disabled_in_db(self, db):
        """
        When dialer_enabled=False in the DB, get_provider_for_user returns None
        even if global credentials exist.  Status endpoint must return active:False.
        This is the fix for Aditya's 'Call via Aircall' bug — the JWT claim is
        ignored; only the live DB value matters.
        """
        import dialer_service as ds
        from conftest import create_sync_settings, create_test_user

        # Global provider is configured
        settings = create_sync_settings(db)
        settings.dialer_provider = "aircall"
        settings.dialer_api_id = "test-id"
        settings.dialer_api_token = "test-tok"
        db.commit()

        # SDR has dialer_enabled=False  ← the flag the admin toggled
        sdr = create_test_user(db, email="aditya@test.com", role="SDR")
        sdr.dialer_enabled = False
        db.commit()

        sdr_identity = {"sub": sdr.id, "email": sdr.email, "role": "SDR"}
        result = ds.get_provider_for_user(db, sdr_identity)
        assert result is None, "Should return None when dialer_enabled=False in DB"

    def test_returns_active_when_user_dialer_enabled_in_db(self, db):
        """
        Complementary: when dialer_enabled=True in the DB and credentials exist,
        get_provider_for_user should return a provider (not None).
        """
        import dialer_service as ds
        from conftest import create_sync_settings, create_test_user
        from unittest.mock import patch

        settings = create_sync_settings(db)
        settings.dialer_provider = "aircall"
        settings.dialer_api_id = "test-id"
        settings.dialer_api_token = "encrypted-tok"
        db.commit()

        sdr = create_test_user(db, email="enabled_sdr@test.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()

        sdr_identity = {"sub": sdr.id, "email": sdr.email, "role": "SDR"}

        with patch("crypto.decrypt_token", return_value="plain-tok"):
            result = ds.get_provider_for_user(db, sdr_identity)

        assert result is not None, "Should return a provider when dialer_enabled=True in DB"
        assert result.provider_name == "aircall"


# ─────────────────────────────────────────────────────────────────────────────
# Call Initiation Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestStartCall:
    """Tests for POST /api/calls/start."""

    def test_requires_lead_id_and_phone(self, db):
        client = _make_dialer_app(db)
        # Missing phone_number
        resp = client.post("/api/calls/start", json={"lead_id": "some-id"})
        assert resp.status_code == 400

    def test_requires_phone_number(self, db):
        """BUG-04: lead_id is now optional, but phone_number is still required."""
        client = _make_dialer_app(db)
        # Missing phone_number entirely — must still return 400
        resp = client.post("/api/calls/start", json={})
        assert resp.status_code == 400

    def test_no_phone_returns_400(self, db):
        """Sending a lead_id but no phone_number must return 400."""
        client = _make_dialer_app(db)
        resp = client.post("/api/calls/start", json={"lead_id": "some-id"})
        assert resp.status_code == 400

    def test_no_lead_id_creates_anonymous_lead(self, db):
        """BUG-04: When lead_id is absent, /calls/start auto-creates an anonymous lead."""
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call:
            mock_call.return_value = {
                "success": True,
                "provider": "messenger",
                "call_id": "cv-manual-123",
            }
            resp = client.post("/api/calls/start", json={
                "phone_number": "+919876543210",
                # no lead_id — should auto-create anonymous lead
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "messenger"
        # lead_id must be returned (either matched or created)
        assert "lead_id" in data and data["lead_id"]
        mock_call.assert_called_once()

    def test_anonymous_lead_gets_callers_pod_id(self, db):
        """RCA 2026-08-06: the auto-created anonymous lead never had pod_id
        set, unlike the equivalent Klenty auto-lead-creation path (which
        sets pod_id=sdr.pod_id). The call still counted toward the SDR's
        pod in analytics (scoped by caller, not lead), but the lead itself
        was an orphan in no pod's own lead list — a real, confusing
        mismatch surfaced via a live "Unknown Caller" example with
        pod_id=NULL despite being called by a US-Team SDR."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user
        from routes.dialer_routes import router as dialer_router
        from routes.call_routes import router as call_router
        import models

        caller = {"sub": "caller-1", "email": "caller@test.com", "name": "Caller",
                  "role": "SDR", "pod_id": "pod-xyz"}

        app = FastAPI()
        app.include_router(dialer_router)
        app.include_router(call_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: caller
        client = TestClient(app)

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call:
            mock_call.return_value = {"success": True, "provider": "messenger", "call_id": "cv-1"}
            resp = client.post("/api/calls/start", json={"phone_number": "+919876500000"})

        assert resp.status_code == 200
        lead_id = resp.json()["lead_id"]
        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        assert lead.pod_id == "pod-xyz"

    def test_successful_call_initiation(self, db):
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="dialtest@t.com")

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call:
            mock_call.return_value = {
                "success": True,
                "provider": "aircall",
                "call_id": "ac-123",
            }
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "aircall"
        mock_call.assert_called_once()

    def test_propagates_provider_error_as_422(self, db):
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="dialfail@t.com")

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call:
            mock_call.return_value = {
                "success": False,
                "error": "No available agents",
            }
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
            })

        assert resp.status_code == 422
        assert "No available agents" in resp.json()["detail"]


class TestEligibilityGate:
    """Power Dialer prep: a do-not-contact/unsubscribed lead must never reach
    the provider, regardless of entry point. Exercises the real
    dialer_service.initiate_call() (not mocked) so the gate itself is tested,
    only get_provider_for_user is mocked to avoid a real Aircall/Alternate Messenger call."""

    def test_do_not_contact_lead_blocked_before_provider_called(self, db):
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="dnc@t.com")
        lead.do_not_contact = True
        db.commit()

        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        with patch("routes.dialer_routes.dialer_service.get_provider_for_user", return_value=provider_mock):
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
            })

        assert resp.status_code == 422
        assert "opted out" in resp.json()["detail"]
        provider_mock.initiate_call.assert_not_called()

    def test_unsubscribed_lead_blocked_before_provider_called(self, db):
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="unsub@t.com")
        from datetime import datetime, timezone
        lead.unsubscribed_at = datetime.now(timezone.utc)
        db.commit()

        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        with patch("routes.dialer_routes.dialer_service.get_provider_for_user", return_value=provider_mock):
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
            })

        assert resp.status_code == 422
        assert "opted out" in resp.json()["detail"]
        provider_mock.initiate_call.assert_not_called()

    def test_eligible_lead_still_reaches_provider(self, db):
        """Regression guard — the gate must not block an ordinary lead."""
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="eligible@t.com")

        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.initiate_call.return_value = MagicMock(
            success=True, provider_call_id="ac-999", error=None,
            livekit_token=None, livekit_url=None, room_name=None, agent_join_via_phone=None,
        )
        with patch("routes.dialer_routes.dialer_service.get_provider_for_user", return_value=provider_mock):
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
            })

        assert resp.status_code == 200
        provider_mock.initiate_call.assert_called_once()

    def test_405_message_mentions_everywhere_drawer_when_enabled(self, db):
        """RCA 2026-08-18: this message predates Aircall Everywhere and only
        ever told the SDR to open the Desktop app — actively wrong guidance
        once Everywhere is enabled org-wide."""
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="everywhere_405@t.com")
        import models
        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        if not settings:
            settings = models.SyncSettings(id=1)
            db.add(settings)
        settings.aircall_everywhere_enabled = True
        db.commit()

        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.initiate_call.return_value = MagicMock(
            success=False, provider_call_id=None, error=(
                "Test SDR could not receive the call. Please ensure their "
                "Aircall Desktop app is open and status is set to Available, then try again."
            ),
            livekit_token=None, livekit_url=None, room_name=None, agent_join_via_phone=None,
        )
        with patch("routes.dialer_routes.dialer_service.get_provider_for_user", return_value=provider_mock):
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
            })

        assert "Aircall drawer in Alternate CRM" in resp.json()["detail"]

    def test_405_message_unchanged_when_everywhere_disabled(self, db):
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="no_everywhere_405@t.com")
        import models
        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        if not settings:
            settings = models.SyncSettings(id=1)
            db.add(settings)
        settings.aircall_everywhere_enabled = False
        db.commit()

        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        original_error = (
            "Test SDR could not receive the call. Please ensure their "
            "Aircall Desktop app is open and status is set to Available, then try again."
        )
        provider_mock.initiate_call.return_value = MagicMock(
            success=False, provider_call_id=None, error=original_error,
            livekit_token=None, livekit_url=None, room_name=None, agent_join_via_phone=None,
        )
        with patch("routes.dialer_routes.dialer_service.get_provider_for_user", return_value=provider_mock):
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
            })

        assert resp.json()["detail"] == original_error

    def test_suppressed_skip_does_not_write_an_error_log(self, db):
        """A DNC skip is policy working as designed — must not fill Error Logs
        with noise proportional to Power Dialer usage."""
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="dnc-noise@t.com")

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call, \
             patch("routes.dialer_routes.log_error") as mock_log_error:
            mock_call.return_value = {"success": False, "error": "opted out", "suppressed": True}
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
            })

        assert resp.status_code == 422
        mock_log_error.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# Phone normalisation helper test
# ─────────────────────────────────────────────────────────────────────────────

class TestNormalizePhone:
    """Unit tests for the _normalize_phone helper."""

    def test_strips_all_non_digits(self):
        from routes.dialer_routes import _normalize_phone
        assert _normalize_phone("+91 98765 43210") == "919876543210"
        assert _normalize_phone("(123) 456-7890") == "1234567890"

    def test_empty_string_returns_empty(self):
        from routes.dialer_routes import _normalize_phone
        assert _normalize_phone("") == ""
        assert _normalize_phone(None) == ""

    def test_pure_digits_unchanged(self):
        from routes.dialer_routes import _normalize_phone
        assert _normalize_phone("9876543210") == "9876543210"


# ─────────────────────────────────────────────────────────────────────────────
# get_dialer_config edge cases
# ─────────────────────────────────────────────────────────────────────────────

class TestGetDialerConfig:
    """Unit tests for dialer_service.get_dialer_config — credential flags & from_number."""

    def test_messenger_creds_only_needs_access_token(self, db):
        """has_messenger_credentials should be True with api_key + user_id (HMAC auth)."""
        from conftest import create_sync_settings
        settings = create_sync_settings(db)
        settings.dialer_provider = "messenger"
        settings.messenger_api_key = "test-api-key"
        settings.messenger_user_id = "300956"
        db.commit()

        import dialer_service
        config = dialer_service.get_dialer_config(db)
        assert config["has_messenger_credentials"] is True
        assert config["provider"] == "messenger"

    def test_messenger_creds_false_without_api_key(self, db):
        """has_messenger_credentials should be False when api_key is missing."""
        from conftest import create_sync_settings
        settings = create_sync_settings(db)
        settings.dialer_provider = "messenger"
        settings.messenger_api_key = None
        settings.messenger_user_id = "300956"
        db.commit()

        import dialer_service
        config = dialer_service.get_dialer_config(db)
        assert config["has_messenger_credentials"] is False

    def test_from_number_returned_in_config(self, db):
        """get_dialer_config should return the saved from_number."""
        from conftest import create_sync_settings
        settings = create_sync_settings(db)
        settings.dialer_provider = "messenger"
        settings.messenger_from_number = "+14155551234"
        db.commit()

        import dialer_service
        config = dialer_service.get_dialer_config(db)
        assert config["from_number"] == "+14155551234"

    def test_from_number_defaults_empty(self, db):
        """from_number should default to empty string when not set."""
        from conftest import create_sync_settings
        settings = create_sync_settings(db)
        settings.dialer_provider = "messenger"
        settings.messenger_from_number = None
        db.commit()

        import dialer_service
        config = dialer_service.get_dialer_config(db)
        assert config["from_number"] == ""

    def test_save_dialer_config_persists_from_number(self, db):
        """save_dialer_config should persist the from_number field."""
        from conftest import create_sync_settings
        create_sync_settings(db)

        import dialer_service
        dialer_service.save_dialer_config(db, {
            "provider": "messenger",
            "from_number": "+919876543210",
        })
        config = dialer_service.get_dialer_config(db)
        assert config["from_number"] == "+919876543210"

    def test_save_dialer_config_clears_from_number(self, db):
        """Sending from_number as empty string should clear it (store as None)."""
        from conftest import create_sync_settings
        settings = create_sync_settings(db)
        settings.messenger_from_number = "+14155551234"
        db.commit()

        import dialer_service
        dialer_service.save_dialer_config(db, {
            "provider": "messenger",
            "from_number": "",
        })
        config = dialer_service.get_dialer_config(db)
        assert config["from_number"] == ""  # empty string return (stored as None, returned as "")

    def test_aircall_sync_enabled_defaults_true(self, db):
        """v11.5.3: default must be True — existing nightly sync behavior
        unchanged until an admin explicitly opts out."""
        from conftest import create_sync_settings
        create_sync_settings(db)

        import dialer_service
        config = dialer_service.get_dialer_config(db)
        assert config["aircall_sync_enabled"] is True

    def test_save_dialer_config_disables_aircall_sync(self, db):
        from conftest import create_sync_settings
        create_sync_settings(db)

        import dialer_service
        dialer_service.save_dialer_config(db, {"aircall_sync_enabled": False})
        config = dialer_service.get_dialer_config(db)
        assert config["aircall_sync_enabled"] is False

    def test_save_dialer_config_reenables_aircall_sync(self, db):
        from conftest import create_sync_settings
        settings = create_sync_settings(db)
        settings.aircall_sync_enabled = False
        db.commit()

        import dialer_service
        dialer_service.save_dialer_config(db, {"aircall_sync_enabled": True})
        config = dialer_service.get_dialer_config(db)
        assert config["aircall_sync_enabled"] is True


# ─────────────────────────────────────────────────────────────────────────────
# v6.2.0 — Call Mode (bridge vs browser) Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestCallMode:
    """
    v6.2.0: MessengerWidget passes call_mode='bridge' or 'browser' when the
    SDR picks how the call should be connected. Verify the param flows through.
    """

    def test_call_mode_bridge_accepted(self, db):
        """call_mode='bridge' should be forwarded to initiate_call."""
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="bridge@t.com")

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call:
            mock_call.return_value = {
                "success": True, "provider": "messenger",
                "call_id": "cv-bridge-001", "call_mode": "bridge",
            }
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
                "call_mode": "bridge",
            })

        assert resp.status_code == 200
        assert resp.json()["provider"] == "messenger"
        mock_call.assert_called_once()

    def test_call_mode_browser_accepted(self, db):
        """call_mode='browser' should be accepted and forwarded."""
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="browser@t.com")

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call:
            mock_call.return_value = {
                "success": True, "provider": "messenger",
                "call_id": "cv-browser-001", "call_mode": "browser",
            }
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+919876543210",
                "call_mode": "browser",
            })

        assert resp.status_code == 200
        mock_call.assert_called_once()

    def test_call_mode_defaults_when_absent(self, db):
        """When call_mode is omitted, service must still be called."""
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="nomode@t.com")

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call:
            mock_call.return_value = {
                "success": True, "provider": "messenger", "call_id": "cv-default-001",
            }
            resp = client.post("/api/calls/start", json={
                "lead_id": lead.id, "phone_number": "+919876543210",
            })

        assert resp.status_code == 200
        mock_call.assert_called_once()

    def test_invalid_call_mode_returns_400(self, db):
        """call_mode values other than 'bridge'/'browser' should return 400."""
        client = _make_dialer_app(db)
        lead = create_test_lead(db, email="badmode@t.com")

        resp = client.post("/api/calls/start", json={
            "lead_id": lead.id,
            "phone_number": "+919876543210",
            "call_mode": "fax",
        })
        assert resp.status_code == 400


class TestWebhookPendingMatchUserScoping:
    """
    V48: the pending-row webhook match (EC-14) now scopes to the resolved
    CRM user (by Aircall's own event.user_email) when known. Before this
    fix, two SDRs calling leads that share a phone number could have their
    pending rows cross-matched — Aircall Everywhere widens the exposure
    window for this (seconds of pending state per call, vs. bridge mode's
    near-instant provider_call_id assignment), so this needed a real test.
    """

    def test_webhook_matches_the_correct_users_pending_row(self, db):
        from conftest import create_test_user
        import dialer_service
        import models
        from datetime import datetime, timezone

        user_a = create_test_user(db, email="agent.a@t.com", role="SDR")
        user_b = create_test_user(db, email="agent.b@t.com", role="SDR")
        shared_phone = "+919876500000"

        # Both SDRs happen to be mid-dial to leads sharing the same phone number.
        pending_a = models.DialerCall(
            lead_id=None, user_id=user_a.id, provider="aircall", provider_call_id="",
            phone_number=shared_phone, status="CALL_STARTED", direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        pending_b = models.DialerCall(
            lead_id=None, user_id=user_b.id, provider="aircall", provider_call_id="",
            phone_number=shared_phone, status="CALL_STARTED", direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        db.add(pending_a)
        db.add(pending_b)
        db.commit()

        from dialer_provider import NormalizedCallEvent, CallEventType
        event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ANSWERED,
            provider="aircall",
            provider_call_id="ac-webhook-999",
            phone_number=shared_phone,
            user_email="agent.b@t.com",  # this webhook belongs to agent B
        )
        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.handle_webhook.return_value = event

        with patch("dialer_service._instantiate_provider", return_value=provider_mock):
            result = dialer_service.handle_webhook(db, "aircall", {})

        assert result["ok"] is True
        db.refresh(pending_a)
        db.refresh(pending_b)
        # Agent B's row must be the one reconciled — not agent A's.
        assert pending_b.provider_call_id == "ac-webhook-999"
        assert pending_a.provider_call_id == ""

    def test_webhook_matches_the_correct_users_pending_row_messenger(self, db):
        """
        Same fix, same handle_webhook() — Alternate Messenger's own webhook also sets
        user_email (messaging_provider.py:735), so the user_id scope applies
        to it too, not just Aircall. Alternate Messenger's initiate_call() normally
        returns its call_id synchronously, so its real calls rarely land in
        this fallback branch — but the branch is shared code, so it needs the
        same proof of correctness Aircall got, not just an assumption.
        """
        from conftest import create_test_user
        import dialer_service
        import models
        from datetime import datetime, timezone

        user_a = create_test_user(db, email="agent.a@t.com", role="SDR")
        user_b = create_test_user(db, email="agent.b@t.com", role="SDR")
        shared_phone = "+919876500000"

        pending_a = models.DialerCall(
            lead_id=None, user_id=user_a.id, provider="messenger", provider_call_id="",
            phone_number=shared_phone, status="CALL_STARTED", direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        pending_b = models.DialerCall(
            lead_id=None, user_id=user_b.id, provider="messenger", provider_call_id="",
            phone_number=shared_phone, status="CALL_STARTED", direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        db.add(pending_a)
        db.add(pending_b)
        db.commit()

        from dialer_provider import NormalizedCallEvent, CallEventType
        event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ANSWERED,
            provider="messenger",
            provider_call_id="cv-webhook-999",
            phone_number=shared_phone,
            user_email="agent.b@t.com",  # this webhook belongs to agent B
        )
        provider_mock = MagicMock()
        provider_mock.provider_name = "messenger"
        provider_mock.handle_webhook.return_value = event

        with patch("dialer_service._instantiate_provider", return_value=provider_mock):
            result = dialer_service.handle_webhook(db, "messenger", {})

        assert result["ok"] is True
        db.refresh(pending_a)
        db.refresh(pending_b)
        assert pending_b.provider_call_id == "cv-webhook-999"
        assert pending_a.provider_call_id == ""


class TestWebhookLeadAutoCreation:
    """
    Aircall's live webhook previously left lead_id=None on any call to a
    number that didn't already match a lead — even when the calling SDR was
    a known Alternate CRM user. _find_or_create_lead_by_phone (mirroring the
    Klenty nightly sync's own create-on-miss logic) now auto-creates and
    assigns a lead in that case, per policy: tracking is mandatory for any
    call made by a user who exists in Alternate CRM, whether or not the dialed
    lead already exists.
    """

    def _webhook_event(self, phone, user_email, provider_call_id="ac-autolead-1"):
        from dialer_provider import NormalizedCallEvent, CallEventType
        return NormalizedCallEvent(
            event_type=CallEventType.CALL_STARTED,
            provider="aircall",
            provider_call_id=provider_call_id,
            phone_number=phone,
            user_email=user_email,
        )

    def test_creates_and_assigns_lead_when_sdr_is_known(self, db):
        import dialer_service
        import models
        pod = create_test_pod(db)
        sdr = create_test_user(db, email="autolead-sdr@t.com", role="SDR", pod_id=pod.id)
        phone = "+919876511111"

        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.handle_webhook.return_value = self._webhook_event(phone, "autolead-sdr@t.com")

        with patch("dialer_service._instantiate_provider", return_value=provider_mock):
            result = dialer_service.handle_webhook(db, "aircall", {})

        assert result["ok"] is True
        dialer_call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "ac-autolead-1"
        ).first()
        assert dialer_call.lead_id is not None

        lead = db.query(models.Lead).filter(models.Lead.id == dialer_call.lead_id).first()
        assert lead is not None
        assert lead.phone == phone
        assert lead.pod_id == pod.id
        assert sdr in lead.assigned_users

    def test_does_not_create_lead_when_sdr_is_unknown(self, db):
        """A call from a user who isn't in Alternate CRM at all — no lead should
        be created; tracking is mandatory only for Alternate CRM users."""
        import dialer_service
        import models
        phone = "+919876522222"

        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.handle_webhook.return_value = self._webhook_event(
            phone, "not-a-alternatecrm-user@t.com", provider_call_id="ac-autolead-2"
        )

        with patch("dialer_service._instantiate_provider", return_value=provider_mock):
            result = dialer_service.handle_webhook(db, "aircall", {})

        assert result["ok"] is True
        dialer_call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "ac-autolead-2"
        ).first()
        assert dialer_call.lead_id is None
        assert db.query(models.Lead).filter(models.Lead.phone == phone).first() is None

    def test_matches_existing_lead_instead_of_creating_a_duplicate(self, db):
        import dialer_service
        import models
        sdr = create_test_user(db, email="autolead-sdr2@t.com", role="SDR")
        phone = "+919876533333"
        existing = create_test_lead(db, email="existing-phone-lead@t.com", phone=phone)
        db.commit()

        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.handle_webhook.return_value = self._webhook_event(
            phone, "autolead-sdr2@t.com", provider_call_id="ac-autolead-3"
        )

        with patch("dialer_service._instantiate_provider", return_value=provider_mock):
            dialer_service.handle_webhook(db, "aircall", {})

        assert db.query(models.Lead).filter(models.Lead.phone == phone).count() == 1
        dialer_call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "ac-autolead-3"
        ).first()
        assert dialer_call.lead_id == existing.id


class TestWebhookProviderDisposition:
    """
    provider_disposition is the only connect signal Aircall/Alternate Messenger calls
    get when no SDR ever manually logs an outcome — previously only Klenty's
    sync populated it, so those calls always read as 0% connected regardless
    of whether the callee actually answered. The webhook now writes
    provider_disposition="ANSWERED" whenever answered_at is present, the same
    value/field Klenty already uses, so dialer_call_connected() picks it up
    for free.
    """

    def test_sets_answered_disposition_when_answered_at_present(self, db):
        import dialer_service
        import models
        from datetime import datetime, timezone
        from dialer_provider import NormalizedCallEvent, CallEventType

        event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ANSWERED,
            provider="aircall",
            provider_call_id="ac-disp-1",
            phone_number="+919876544444",
            answered_at=datetime.now(timezone.utc),
        )
        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.handle_webhook.return_value = event

        with patch("dialer_service._instantiate_provider", return_value=provider_mock):
            dialer_service.handle_webhook(db, "aircall", {})

        dialer_call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "ac-disp-1"
        ).first()
        assert dialer_call.provider_disposition == "ANSWERED"

    def test_no_disposition_when_never_answered(self, db):
        import dialer_service
        import models
        from dialer_provider import NormalizedCallEvent, CallEventType

        event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ENDED,
            provider="aircall",
            provider_call_id="ac-disp-2",
            phone_number="+919876555555",
        )
        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.handle_webhook.return_value = event

        with patch("dialer_service._instantiate_provider", return_value=provider_mock):
            dialer_service.handle_webhook(db, "aircall", {})

        dialer_call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "ac-disp-2"
        ).first()
        assert dialer_call.provider_disposition is None


# ─────────────────────────────────────────────────────────────────────────────
# v6.2.0 — Ad-hoc Manual Dial Tests (no lead_id)
# ─────────────────────────────────────────────────────────────────────────────

class TestAdHocDial:
    """
    MessengerWidget.openForManualDial() lets SDRs dial without navigating to
    a lead first. The API must handle missing lead_id gracefully.
    """

    def test_adhoc_bridge_call_creates_anonymous_lead(self, db):
        """Ad-hoc bridge call with no lead_id must create an anonymous lead."""
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call:
            mock_call.return_value = {
                "success": True, "provider": "messenger",
                "call_id": "cv-adhoc-bridge", "call_mode": "bridge",
            }
            resp = client.post("/api/calls/start", json={
                "phone_number": "+919876543210",
                "call_mode": "bridge",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "messenger"
        assert data.get("lead_id"), "Anonymous lead must be created and returned"
        mock_call.assert_called_once()

    def test_adhoc_browser_call_creates_anonymous_lead(self, db):
        """Ad-hoc browser call with no lead_id must create an anonymous lead."""
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call:
            mock_call.return_value = {
                "success": True, "provider": "messenger",
                "call_id": "cv-adhoc-browser", "call_mode": "browser",
            }
            resp = client.post("/api/calls/start", json={
                "phone_number": "+918800001111",
                "call_mode": "browser",
            })

        assert resp.status_code == 200
        assert resp.json().get("lead_id"), "Anonymous lead must be created and returned"

    def test_adhoc_call_missing_phone_returns_400(self, db):
        """Ad-hoc call with no phone_number must return 400."""
        client = _make_dialer_app(db)
        resp = client.post("/api/calls/start", json={"call_mode": "bridge"})
        assert resp.status_code == 400


# ─────────────────────────────────────────────────────────────────────────────
# v6.2.0 — Alternate Messenger Per-SDR Config & Widget Init
# ─────────────────────────────────────────────────────────────────────────────

class TestMessengerPerSDRConfig:
    """
    GET /api/dialer/status must return sender_id and from_number for Alternate Messenger
    SDRs so MessengerWidget.init() can set them without a second API call.
    """

    def test_status_includes_sender_id_for_messenger_user(self, db):
        client = _make_dialer_app(db)

        # Create a test user so the DB query in the route finds someone
        user = create_test_user(db, email="conv_sdr@t.com", role="SDR")
        user.messenger_from_number = "+14155551234"
        db.commit()

        mock_settings = MagicMock()
        mock_settings.messenger_sender_id = "cv-sender-42"

        with patch("routes.dialer_routes.dialer_service.get_provider_for_user") as mock_prov, \
             patch("routes.dialer_routes.dialer_service._get_settings", return_value=mock_settings):
            provider_mock = MagicMock()
            provider_mock.provider_name = "messenger"
            mock_prov.return_value = provider_mock
            resp = client.get("/api/dialer/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is True
        assert data["provider"] == "messenger"
        assert data.get("sender_id") == "cv-sender-42"

    def test_status_returns_from_number_for_messenger(self, db):
        """from_number is required for PSTN bridge calls."""
        client = _make_dialer_app(db)

        # The route reads from_number via user["sub"] = SUPER_ADMIN["sub"] = "test-user-id"
        # So we must set messenger_from_number on that exact DB user.
        import models as _m
        admin_user = db.query(_m.User).filter(_m.User.id == "test-user-id").first()
        if admin_user:
            admin_user.messenger_from_number = "+14155551234"
            db.commit()

        mock_settings = MagicMock()
        mock_settings.messenger_sender_id = "cv-sender-42"

        with patch("routes.dialer_routes.dialer_service.get_provider_for_user") as mock_prov, \
             patch("routes.dialer_routes.dialer_service._get_settings", return_value=mock_settings):
            provider_mock = MagicMock()
            provider_mock.provider_name = "messenger"
            mock_prov.return_value = provider_mock
            resp = client.get("/api/dialer/status")

        data = resp.json()
        # from_number is present; value depends on whether test-user-id exists in DB
        assert "from_number" in data

    def test_aircall_status_has_no_sender_id(self, db):
        """Aircall status should not include a Alternate Messenger sender_id."""
        client = _make_dialer_app(db)

        with patch("routes.dialer_routes.dialer_service.get_provider_for_user") as mock_prov, \
             patch("routes.dialer_routes.dialer_service.get_dialer_config") as mock_config:
            provider_mock = MagicMock()
            provider_mock.provider_name = "aircall"
            mock_prov.return_value = provider_mock
            mock_config.return_value = {
                "provider": "aircall", "active": True, "has_credentials": True,
            }
            resp = client.get("/api/dialer/status")

        data = resp.json()
        assert data["provider"] == "aircall"
        assert not data.get("sender_id")


# ─────────────────────────────────────────────────────────────────────────────
# v6.4.7 — Alternate Messenger Declined Call: ended_at Guard + Ringing Timeout
# ─────────────────────────────────────────────────────────────────────────────

class TestCallStatusGuards:
    """
    v6.4.7: Two backend guards to prevent the dialer UI from freezing on
    'Ringing...' when a Alternate Messenger call is declined:

    Guard 1 — ended_at override:
        If ended_at is already set on the DialerCall (written by the
        disconnect endpoint or a Alternate Messenger webhook) but effective_status
        is still CALL_STARTED (Alternate Messenger REST API returning stale 'ringing'),
        the status endpoint must return CALL_ENDED immediately.

    Guard 2 — Ringing timeout:
        If a Alternate Messenger call has been in CALL_STARTED for >50 seconds with
        no ended_at, it should be auto-ended (declined/no-answer scenario).
    """

    def _make_messenger_call(self, db, status="CALL_STARTED",
                               started_at=None, ended_at=None, outcome=None):
        """Create a DialerCall row for testing."""
        import models
        from datetime import datetime, timezone
        user_id = "test-user-id"  # matches SUPER_ADMIN in conftest
        call = models.DialerCall(
            user_id=user_id,
            provider="messenger",
            phone_number="+919876543210",
            status=status,
            direction="outbound",
            started_at=started_at or datetime.now(timezone.utc),
            ended_at=ended_at,
            outcome=outcome,
        )
        db.add(call)
        db.commit()
        db.refresh(call)
        return call

    # ── Guard 1: ended_at override ────────────────────────────────────────────

    def test_guard1_ended_at_set_returns_call_ended(self, db):
        """
        Guard 1: If ended_at is set on the DB record but the Alternate Messenger
        REST API is still returning 'ringing', the status endpoint must
        return CALL_ENDED (not CALL_STARTED).

        This is the primary fix for the 'Ringing forever after decline' bug.
        """
        from datetime import datetime, timezone, timedelta

        client = _make_dialer_app(db)
        call = self._make_messenger_call(
            db,
            status="CALL_STARTED",
            started_at=datetime.now(timezone.utc) - timedelta(seconds=35),
            ended_at=datetime.now(timezone.utc),   # ended_at already set
        )

        # Provider API still returns stale 'ringing' — simulates Alternate Messenger lag
        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"
        mock_provider.get_call_status = MagicMock(return_value={
            "status": "ringing",   # stale — Alternate Messenger API hasn't caught up
            "raw": {"status": "ringing"},
        })

        with patch("routes.dialer_routes.dialer_service.get_active_provider",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        assert resp.status_code == 200
        data = resp.json()
        # Guard 1 must override stale 'ringing' with CALL_ENDED
        assert data["status"] == "CALL_ENDED", (
            f"Guard 1 failed: expected CALL_ENDED but got {data['status']}. "
            "The ended_at field was set but status endpoint returned stale CALL_STARTED."
        )

    def test_guard1_not_triggered_when_ended_at_absent(self, db):
        """
        Guard 1 must NOT fire when ended_at is None — the call is genuinely
        still ringing and Guard 1 would incorrectly end it.
        """
        from datetime import datetime, timezone, timedelta

        client = _make_dialer_app(db)
        call = self._make_messenger_call(
            db,
            status="CALL_STARTED",
            started_at=datetime.now(timezone.utc) - timedelta(seconds=10),
            ended_at=None,    # not ended yet
        )

        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"
        mock_provider.get_call_status = MagicMock(return_value={
            "status": "ringing",
            "raw": {"status": "ringing"},
        })

        with patch("routes.dialer_routes.dialer_service.get_active_provider",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        assert resp.status_code == 200
        data = resp.json()
        # Should still be CALL_STARTED — call is genuinely ringing
        assert data["status"] == "CALL_STARTED", (
            f"Guard 1 should not fire when ended_at is None, got {data['status']}"
        )

    def test_guard1_already_ended_status_unchanged(self, db):
        """
        Guard 1 must not double-apply: if status is already CALL_ENDED in
        DB, it should remain CALL_ENDED (no change needed).
        """
        from datetime import datetime, timezone

        client = _make_dialer_app(db)
        call = self._make_messenger_call(
            db,
            status="CALL_ENDED",
            ended_at=datetime.now(timezone.utc),
            outcome="No Answer",
        )

        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"

        with patch("routes.dialer_routes.dialer_service.get_active_provider",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        assert resp.status_code == 200
        assert resp.json()["status"] == "CALL_ENDED"

    # ── Guard 2: Ringing timeout ───────────────────────────────────────────────

    def test_guard2_auto_ends_stuck_ringing_call(self, db):
        """
        Guard 2: A Alternate Messenger call stuck in CALL_STARTED for >50s with no
        ended_at must be auto-ended. Simulates a declined call where the
        Alternate Messenger webhook never arrives.
        """
        from datetime import datetime, timezone, timedelta
        import models

        client = _make_dialer_app(db)
        call = self._make_messenger_call(
            db,
            status="CALL_STARTED",
            started_at=datetime.now(timezone.utc) - timedelta(seconds=55),  # >50s
            ended_at=None,
        )

        # Alternate Messenger API still returns ringing (webhook hasn't fired)
        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"
        mock_provider.get_call_status = MagicMock(return_value={
            "status": "ringing",
            "raw": {"status": "ringing"},
        })

        with patch("routes.dialer_routes.dialer_service.get_active_provider",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "CALL_ENDED", (
            f"Guard 2 failed: call stuck >50s should auto-end but got {data['status']}"
        )

        # DB must also be updated (ended_at written, status set to CALL_ENDED)
        db.refresh(call)
        assert call.status == "CALL_ENDED", "Guard 2 must persist CALL_ENDED to DB"
        assert call.ended_at is not None, "Guard 2 must set ended_at on the DB record"

    def test_guard2_does_not_fire_before_50s(self, db):
        """
        Guard 2 must NOT fire for calls that have been ringing <50s —
        they may still be legitimately ringing.
        """
        from datetime import datetime, timezone, timedelta

        client = _make_dialer_app(db)
        call = self._make_messenger_call(
            db,
            status="CALL_STARTED",
            started_at=datetime.now(timezone.utc) - timedelta(seconds=30),  # only 30s
            ended_at=None,
        )

        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"
        mock_provider.get_call_status = MagicMock(return_value={
            "status": "ringing",
            "raw": {"status": "ringing"},
        })

        with patch("routes.dialer_routes.dialer_service.get_active_provider",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        assert resp.status_code == 200
        data = resp.json()
        # Should still be CALL_STARTED — call has only been ringing 30s
        assert data["status"] == "CALL_STARTED", (
            f"Guard 2 should not fire at 30s, got {data['status']}"
        )

    def test_guard2_only_applies_to_messenger(self, db):
        """
        Guard 2 must NOT auto-end non-Alternate Messenger (Aircall) calls that are
        stuck in CALL_STARTED — different providers have different behaviour.
        """
        from datetime import datetime, timezone, timedelta
        import models

        client = _make_dialer_app(db)
        # Aircall call stuck for >50s — guard must NOT fire
        call = models.DialerCall(
            user_id="test-user-id",
            provider="aircall",
            phone_number="+919876543210",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc) - timedelta(seconds=55),
            ended_at=None,
        )
        db.add(call)
        db.commit()
        db.refresh(call)

        mock_provider = MagicMock()
        mock_provider.provider_name = "aircall"
        mock_provider.get_call_status = MagicMock(return_value={
            "status": "ringing",
            "raw": {"status": "ringing"},
        })

        with patch("routes.dialer_routes.dialer_service.get_active_provider",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        assert resp.status_code == 200
        # Aircall call should NOT be auto-ended by Guard 2
        data = resp.json()
        # Status may change from provider mapping but Guard 2 specifically
        # should not have fired (check DB record)
        db.refresh(call)
        # The DB record's ended_at should NOT be set by Guard 2
        # (Guard 2 only applies to Alternate Messenger)
        # If provider returned 'ringing', the status stays CALL_STARTED
        assert call.ended_at is None or call.provider != "messenger", (
            "Guard 2 must not fire for non-Alternate Messenger providers"
        )

    # ── Phone-match fallback when no provider_call_id was ever recorded ───────

    def test_aircall_status_poll_heals_via_phone_match_when_id_never_recorded(self, db):
        """RCA 2026-09-03: this is the poll that drives the frontend's
        outcome-modal (app.js's _startAircallOutcomePolling calls this every
        10s). Before this fix, a bridge-mode Aircall call whose
        provider_call_id stayed empty (and whose webhook never arrived)
        could never progress past CALL_STARTED here — the SDR would be
        stuck until the 10-minute client-side timeout forced the modal open
        anyway. Falls back to the same phone+recency lookup used by the
        pre-dial self-heal guard."""
        from datetime import datetime, timezone, timedelta
        import models

        client = _make_dialer_app(db)
        owner = db.query(models.User).filter(models.User.id == "test-user-id").first()
        if not owner:
            owner = models.User(id="test-user-id", email="admin@test.com", role="Super Admin")
            db.add(owner)
            db.commit()
        call = models.DialerCall(
            user_id="test-user-id",
            provider="aircall",
            provider_call_id="",
            phone_number="1-800-263-3394",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc) - timedelta(seconds=90),
        )
        db.add(call)
        db.commit()
        db.refresh(call)

        mock_provider = MagicMock()
        mock_provider.provider_name = "aircall"
        mock_provider.find_recent_call_by_phone = MagicMock(
            return_value={"id": "ac-poll-backfilled", "ended": True, "duration": 17}
        )

        with patch("routes.dialer_routes.dialer_service.get_provider_for_user",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "CALL_ENDED"
        mock_provider.find_recent_call_by_phone.assert_called_once()
        # Scoped to the call's owner: Aircall's call log is company-wide, so an
        # unscoped lookup can match a teammate's call to the same number.
        assert "admin@test.com" in mock_provider.find_recent_call_by_phone.call_args.args
        db.refresh(call)
        assert call.status == "CALL_ENDED"
        assert call.provider_call_id == "ac-poll-backfilled"
        assert call.duration == 17

    def test_aircall_status_poll_stays_started_when_phone_match_reports_still_active(self, db):
        from datetime import datetime, timezone, timedelta
        import models

        client = _make_dialer_app(db)
        owner = db.query(models.User).filter(models.User.id == "test-user-id").first()
        if not owner:
            owner = models.User(id="test-user-id", email="admin@test.com", role="Super Admin")
            db.add(owner)
            db.commit()
        call = models.DialerCall(
            user_id="test-user-id",
            provider="aircall",
            provider_call_id="",
            phone_number="1-800-263-3394",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc) - timedelta(seconds=20),
        )
        db.add(call)
        db.commit()
        db.refresh(call)

        mock_provider = MagicMock()
        mock_provider.provider_name = "aircall"
        mock_provider.find_recent_call_by_phone = MagicMock(
            return_value={"id": "ac-poll-active", "ended": False, "duration": None}
        )

        with patch("routes.dialer_routes.dialer_service.get_provider_for_user",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        assert resp.status_code == 200
        assert resp.json()["status"] == "CALL_STARTED"
        db.refresh(call)
        assert call.status == "CALL_STARTED"
        assert call.provider_call_id == ""

    # ── Combined scenario: real E2E declined call ─────────────────────────────

    def test_declined_call_complete_lifecycle(self, db):
        """
        Integration: simulate the full declined call scenario that was broken.

        Timeline:
        1. Call created (CALL_STARTED, no ended_at)
        2. User declines on their phone
        3. Disconnect endpoint sets ended_at (call.ended_at = now)
        4. Status poll runs — Alternate Messenger still returns 'ringing'
        5. Guard 1 sees ended_at → returns CALL_ENDED immediately ✅
        """
        from datetime import datetime, timezone, timedelta
        import models

        client = _make_dialer_app(db)

        # Step 1: call starts
        call = self._make_messenger_call(
            db,
            status="CALL_STARTED",
            started_at=datetime.now(timezone.utc) - timedelta(seconds=37),
            ended_at=None,
        )

        # Step 2-3: user declines → disconnect endpoint writes ended_at
        call.ended_at = datetime.now(timezone.utc)
        db.commit()

        # Step 4: status poll with stale Alternate Messenger response
        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"
        mock_provider.get_call_status = MagicMock(return_value={
            "status": "ringing",  # Alternate Messenger still reports ringing
            "raw": {"status": "ringing"},
        })

        with patch("routes.dialer_routes.dialer_service.get_active_provider",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        # Step 5: Guard 1 catches it
        assert resp.status_code == 200
        assert resp.json()["status"] == "CALL_ENDED", (
            "Declined call (ended_at set, Alternate Messenger still ringing) "
            "must return CALL_ENDED via Guard 1"
        )
        assert resp.json()["ended_at"] is not None


# ─────────────────────────────────────────────────────────────────────────────
# Test Dialer Toggle
# ─────────────────────────────────────────────────────────────────────────────

class TestDialerToggle:
    """Tests for PATCH /api/dialer/toggle and dialer_enabled flag in status."""

    def test_toggle_dialer_enabled_status(self, db):
        client = _make_dialer_app(db)
        import models
        
        # Ensure user exists and is disabled
        user = db.query(models.User).filter(models.User.id == "test-user-id").first()
        if not user:
            user = models.User(id="test-user-id", email="admin@test.com", role="Super Admin")
            db.add(user)
        user.dialer_enabled = False
        db.commit()

        # Toggle on
        resp = client.patch("/api/dialer/toggle", json={"dialer_enabled": True})
        assert resp.status_code == 200
        assert resp.json()["dialer_enabled"] is True

        # Verify DB
        db.refresh(user)
        assert user.dialer_enabled is True

        # Toggle off
        resp = client.patch("/api/dialer/toggle", json={"dialer_enabled": False})
        assert resp.status_code == 200
        assert resp.json()["dialer_enabled"] is False

        # Verify DB
        db.refresh(user)
        assert user.dialer_enabled is False

    def test_toggle_dialer_missing_param_returns_400(self, db):
        client = _make_dialer_app(db)
        import models
        user = db.query(models.User).filter(models.User.id == "test-user-id").first()
        if not user:
            user = models.User(id="test-user-id", email="admin@test.com", role="Super Admin")
            db.add(user)
            db.commit()
        resp = client.patch("/api/dialer/toggle", json={})
        assert resp.status_code == 400
        assert "Missing dialer_enabled" in resp.json()["detail"]

    def test_dialer_status_includes_dialer_enabled(self, db):
        client = _make_dialer_app(db)
        import models
        
        user = db.query(models.User).filter(models.User.id == "test-user-id").first()
        if not user:
            user = models.User(id="test-user-id", email="admin@test.com", role="Super Admin")
            db.add(user)
        user.dialer_enabled = True
        db.commit()

        with patch("routes.dialer_routes.dialer_service.get_provider_for_user") as mock_prov:
            provider_mock = MagicMock()
            provider_mock.provider_name = "aircall"
            mock_prov.return_value = provider_mock
            
            resp = client.get("/api/dialer/status")
            assert resp.status_code == 200
            assert resp.json()["dialer_enabled"] is True

        user.dialer_enabled = False
        db.commit()
        
        with patch("routes.dialer_routes.dialer_service.get_provider_for_user") as mock_prov:
            provider_mock = MagicMock()
            provider_mock.provider_name = "aircall"
            mock_prov.return_value = provider_mock
            
            resp = client.get("/api/dialer/status")
            assert resp.status_code == 200
            assert resp.json()["dialer_enabled"] is False

    def test_everywhere_login_stamps_timestamp(self, db):
        """RCA 2026-08-18: the org-wide flag can't tell us who actually adopted
        Everywhere — this endpoint is the only server-side adoption signal."""
        client = _make_dialer_app(db)
        import models
        user = db.query(models.User).filter(models.User.id == "test-user-id").first()
        if not user:
            user = models.User(id="test-user-id", email="admin@test.com", role="Super Admin")
            db.add(user)
        user.aircall_everywhere_last_login_at = None
        db.commit()

        resp = client.post("/api/dialer/everywhere-login")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

        db.refresh(user)
        assert user.aircall_everywhere_last_login_at is not None

    def test_toggle_dialer_non_existent_user_returns_404(self, db):
        client = _make_dialer_app(db)
        import models
        # Delete user if exists
        user = db.query(models.User).filter(models.User.id == "test-user-id").first()
        if user:
            db.delete(user)
            db.commit()
        resp = client.patch("/api/dialer/toggle", json={"dialer_enabled": True})
        assert resp.status_code == 404
        assert "User not found" in resp.json()["detail"]

    def test_toggle_dialer_non_boolean_returns_400(self, db):
        client = _make_dialer_app(db)
        import models
        user = db.query(models.User).filter(models.User.id == "test-user-id").first()
        if not user:
            user = models.User(id="test-user-id", email="admin@test.com", role="Super Admin")
            db.add(user)
            db.commit()
        
        # Test with integer
        resp = client.patch("/api/dialer/toggle", json={"dialer_enabled": 1})
        assert resp.status_code == 400
        assert "must be a boolean" in resp.json()["detail"]

        # Test with string
        # Test with string
        resp = client.patch("/api/dialer/toggle", json={"dialer_enabled": "true"})
        assert resp.status_code == 400
        assert "must be a boolean" in resp.json()["detail"]


# ─────────────────────────────────────────────────────────────────────────────
# Auto-move Lead Assigned / Research → Calling on dial
# ─────────────────────────────────────────────────────────────────────────────

class TestAutoMoveOnDial:
    """
    Tests for the auto Lead Assigned / Research → Calling transition
    introduced in dialer_service.initiate_call().

    All provider calls are mocked — only the DB status transition is tested.
    """

    def _make_provider_mock(self):
        from unittest.mock import MagicMock
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.provider_call_id = "cv-auto-001"
        mock_result.error = None
        for attr in ("livekit_token", "livekit_url", "room_name", "agent_join_via_phone"):
            setattr(mock_result, attr, None)
        provider = MagicMock()
        provider.provider_name = "messenger"
        provider.initiate_call = MagicMock(return_value=mock_result)
        provider.from_number = ""
        return provider, mock_result

    def _do_call(self, db, user, provider, lead_id):
        import dialer_service as ds
        from unittest.mock import patch
        with patch.object(ds, "get_provider_for_user", return_value=provider):
            return ds.initiate_call(
                db,
                {"sub": user.id, "email": user.email, "role": "SDR"},
                lead_id,
                "+919876543210",
                call_mode="browser",
            )

    def test_am1_lead_assigned_moves_to_calling(self, db):
        """AM-1: Lead Assigned → Calling on dial."""
        from conftest import create_test_lead, create_test_user
        user = create_test_user(db, email="am1@auto.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="lead_am1@auto.com")
        lead.status = "Lead Assigned"
        db.commit()
        provider, _ = self._make_provider_mock()
        self._do_call(db, user, provider, lead.id)
        db.refresh(lead)
        assert lead.status == "Calling", f"Expected Calling, got {lead.status}"

    def test_am2_research_moves_to_calling(self, db):
        """AM-2: Research → Calling on dial."""
        from conftest import create_test_lead, create_test_user
        user = create_test_user(db, email="am2@auto.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="lead_am2@auto.com")
        lead.status = "Research"
        db.commit()
        provider, _ = self._make_provider_mock()
        self._do_call(db, user, provider, lead.id)
        db.refresh(lead)
        assert lead.status == "Calling", f"Expected Calling, got {lead.status}"

    def test_am3_already_calling_no_double_move(self, db):
        """AM-3: Already in Calling — FORWARD_LOCKED prevents any change."""
        from conftest import create_test_lead, create_test_user
        user = create_test_user(db, email="am3@auto.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="lead_am3@auto.com")
        lead.status = "Calling"
        db.commit()
        provider, _ = self._make_provider_mock()
        self._do_call(db, user, provider, lead.id)
        db.refresh(lead)
        assert lead.status == "Calling"

    def test_am4_meeting_scheduled_not_regressed(self, db):
        """AM-4: Meeting Scheduled must NOT move backward to Calling."""
        from conftest import create_test_lead, create_test_user
        user = create_test_user(db, email="am4@auto.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="lead_am4@auto.com")
        lead.status = "Meeting Scheduled"
        db.commit()
        provider, _ = self._make_provider_mock()
        self._do_call(db, user, provider, lead.id)
        db.refresh(lead)
        assert lead.status == "Meeting Scheduled", f"Regressed to {lead.status}"

    def test_am5_discovery_meeting_not_regressed(self, db):
        """AM-5: 1st Discovery Meeting must NOT move backward (FORWARD_LOCKED fix)."""
        from conftest import create_test_lead, create_test_user
        user = create_test_user(db, email="am5@auto.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="lead_am5@auto.com")
        lead.status = "1st Discovery Meeting"
        db.commit()
        provider, _ = self._make_provider_mock()
        self._do_call(db, user, provider, lead.id)
        db.refresh(lead)
        assert lead.status == "1st Discovery Meeting", f"Regressed to {lead.status}"

    def test_am6_status_history_written_on_auto_move(self, db):
        """AM-6: Status history entry created with SDR email as changed_by."""
        import models
        from conftest import create_test_lead, create_test_user
        user = create_test_user(db, email="am6@auto.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="lead_am6@auto.com")
        lead.status = "Lead Assigned"
        db.commit()
        provider, _ = self._make_provider_mock()
        self._do_call(db, user, provider, lead.id)
        entry = db.query(models.LeadStatusLog).filter(
            models.LeadStatusLog.lead_id == lead.id,
            models.LeadStatusLog.to_status == "Calling",
        ).first()
        assert entry is not None, "No LeadStatusLog entry written for auto-move"
        assert entry.changed_by == user.email

    def test_am7_call_fail_lead_stays_in_calling(self, db):
        """AM-7: Provider fails — lead remains in Calling (no rollback by design)."""
        from conftest import create_test_lead, create_test_user
        user = create_test_user(db, email="am7@auto.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="lead_am7@auto.com")
        lead.status = "Lead Assigned"
        db.commit()
        provider, mock_result = self._make_provider_mock()
        mock_result.success = False
        mock_result.error = "No agents available"
        mock_result.provider_call_id = None
        self._do_call(db, user, provider, lead.id)
        db.refresh(lead)
        assert lead.status == "Calling", "Status should have auto-moved even on call failure"

    def test_am8_disqualified_not_moved(self, db):
        """AM-8: Disqualified lead must NOT move to Calling."""
        from conftest import create_test_lead, create_test_user
        user = create_test_user(db, email="am8@auto.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="lead_am8@auto.com")
        lead.status = "Disqualified"
        db.commit()
        provider, _ = self._make_provider_mock()
        self._do_call(db, user, provider, lead.id)
        db.refresh(lead)
        assert lead.status == "Disqualified", f"Regressed to {lead.status}"


# ─────────────────────────────────────────────────────────────────────────────
# RCA-2026-05-29 — Aircall 405 (user unavailable) → "warning", not "critical"
# ─────────────────────────────────────────────────────────────────────────────

class TestCallStartSeverityLogging:
    """
    RCA-2026-05-29: Aircall 405 failures (SDR Desktop offline/unavailable)
    were being logged as severity='critical'. They are operational events
    ('warning'). True failures (unexpected errors) must remain 'critical'.
    """

    def _make_failing_call(self, db, error_msg):
        """Helper: mock initiate_call to return a failure with a given error message."""
        from unittest.mock import patch, MagicMock
        client = _make_dialer_app(db)
        from conftest import create_test_lead
        lead = create_test_lead(db, email=f"severity_test_{abs(hash(error_msg)) % 99999}@t.com")

        with patch("routes.dialer_routes.dialer_service.initiate_call") as mock_call, \
             patch("routes.dialer_routes.log_error") as mock_log:
            mock_call.return_value = {
                "success": False,
                "error": error_msg,
                "provider": "aircall",
            }
            client.post("/api/calls/start", json={
                "lead_id": lead.id,
                "phone_number": "+19173973623",
            })
            return mock_log

    def test_aircall_desktop_offline_logs_as_warning(self, db):
        """405-type 'could not receive the call' must log severity='warning'."""
        mock_log = self._make_failing_call(
            db,
            "Mayukh Pattanayak could not receive the call. Please ensure their "
            "Aircall Desktop app is open and status is set to Available, then try again."
        )
        assert mock_log.called, "log_error must be called on call failure"
        call_kwargs = mock_log.call_args[1]
        assert call_kwargs["severity"] == "warning", (
            f"Expected severity='warning' for 405/unavailable error, got '{call_kwargs['severity']}'"
        )

    # (removed) test_aircall_dnd_status_logs_as_warning — asserted the severity
    # downgrade for the "is currently marked as 'do_not_disturb'" message, which
    # no longer exists anywhere: the availability pre-check that produced it was
    # dead code Aircall could never trigger (RCA 2026-09-03) and was deleted
    # along with the matching phrase in dialer_routes' severity list.

    def test_aircall_no_number_assigned_logs_as_warning(self, db):
        """'not assigned to any phone number' must log severity='warning'."""
        mock_log = self._make_failing_call(
            db,
            "Aircall user 'Rahul Mehta' is not assigned to any phone number. "
            "In Aircall Dashboard → Numbers → select a number → add this user."
        )
        call_kwargs = mock_log.call_args[1]
        assert call_kwargs["severity"] == "warning"

    def test_active_call_in_progress_logs_as_warning(self, db):
        """RCA 2026-09-07: 'You already have an active call in progress' is the
        same operational category as the two phrases above and must also log
        severity='warning', not 'critical'."""
        mock_log = self._make_failing_call(
            db,
            "You already have an active call in progress. "
            "Please hang up the current call before starting a new one."
        )
        call_kwargs = mock_log.call_args[1]
        assert call_kwargs["severity"] == "warning"

    def test_unexpected_aircall_error_logs_as_critical(self, db):
        """Unexpected Aircall errors (not 405-type) must remain severity='critical'."""
        mock_log = self._make_failing_call(
            db,
            "Aircall error: 500 Internal Server Error from api.aircall.io"
        )
        call_kwargs = mock_log.call_args[1]
        assert call_kwargs["severity"] == "critical", (
            f"Unexpected errors must stay 'critical', got '{call_kwargs['severity']}'"
        )

    def test_credential_failure_logs_as_critical(self, db):
        """Auth/credential failures must remain severity='critical'."""
        mock_log = self._make_failing_call(
            db,
            "No Aircall user found matching email 'ghost@example.com'. "
            "Ensure the SDR's email matches their Aircall account."
        )
        call_kwargs = mock_log.call_args[1]
        assert call_kwargs["severity"] == "critical"

# ─────────────────────────────────────────────────────────────────────────────
# Gap 1 — Duplicate webhook idempotency
# ─────────────────────────────────────────────────────────────────────────────

class TestWebhookIdempotency:
    """
    Gap 1: Alternate Messenger retries webhook delivery if our endpoint is slow (>5s).
    A second CALL_ENDED for the same call must not overwrite ended_at or duration.

    Pre-condition: ended_at and status=CALL_ENDED already set by first webhook.
    Post-condition: second identical webhook leaves ended_at and duration unchanged.
    """

    def _make_messenger_settings(self, db):
        from conftest import create_sync_settings
        s = create_sync_settings(db)
        s.dialer_provider = "messenger"
        s.messenger_api_key = "test-key"
        s.messenger_user_id = "300956"
        db.commit()
        return s

    def test_duplicate_call_ended_does_not_overwrite_ended_at(self, db):
        """
        Second CALL_ENDED webhook for the same call must not update ended_at.
        The original ended_at (from the first webhook) must be preserved.
        """
        from datetime import datetime, timezone, timedelta
        import models, dialer_service
        from unittest.mock import patch, MagicMock

        self._make_messenger_settings(db)
        lead = create_test_lead(db, email="idempotent@test.com")
        first_ended_at = datetime(2026, 5, 29, 8, 0, 0, tzinfo=timezone.utc)

        # Call already ended (first webhook already processed)
        call = models.DialerCall(
            lead_id=lead.id,
            provider="messenger",
            provider_call_id="cv-idem-001",
            phone_number="+919876543210",
            status="CALL_ENDED",
            direction="outbound",
            started_at=datetime(2026, 5, 29, 7, 59, 0, tzinfo=timezone.utc),
            ended_at=first_ended_at,
            duration=60,
        )
        db.add(call)
        db.commit()

        # Second CALL_ENDED webhook (Alternate Messenger retry, 5s later)
        second_ended_at = first_ended_at + timedelta(seconds=5)
        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"
        from messaging_provider import NormalizedCallEvent
        from dialer_service import CallEventType
        mock_event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ENDED,
            provider="messenger",
            provider_call_id="cv-idem-001",
            phone_number="+919876543210",
            ended_at=second_ended_at,
            duration=999,  # wrong duration from retry
        )
        mock_provider.handle_webhook.return_value = mock_event

        with patch("dialer_service._instantiate_provider", return_value=mock_provider):
            dialer_service.handle_webhook(db, "messenger", {})

        db.refresh(call)
        # SQLite strips tzinfo on round-trip — compare naive timestamps
        assert call.ended_at.replace(tzinfo=None) == first_ended_at.replace(tzinfo=None), (
            f"ended_at overwritten: expected {first_ended_at}, got {call.ended_at}"
        )
        assert call.duration == 60, (
            f"duration overwritten: expected 60, got {call.duration}"
        )

    def test_duplicate_call_ended_does_not_double_count_times_called(self, db):
        """RCA 2026-08-21 (live): a redelivered CALL_ENDED webhook (Alternate Messenger/
        Aircall retry a real call.ended once) must not increment
        lead.times_called a second time -- ended_at itself already had this
        exact guard, but the times_called side-effect two lines below it
        never did, so every retried delivery double-counted independent of
        any SDR action."""
        from datetime import datetime, timezone, timedelta
        import models, dialer_service
        from unittest.mock import patch, MagicMock

        self._make_messenger_settings(db)
        lead = create_test_lead(db, email="idempotent-times-called@test.com")
        lead.times_called = 1  # first webhook already counted this call
        db.commit()
        first_ended_at = datetime(2026, 5, 29, 8, 0, 0, tzinfo=timezone.utc)

        call = models.DialerCall(
            lead_id=lead.id,
            provider="messenger",
            provider_call_id="cv-idem-times-called",
            phone_number="+919876543210",
            status="CALL_ENDED",
            direction="outbound",
            started_at=datetime(2026, 5, 29, 7, 59, 0, tzinfo=timezone.utc),
            ended_at=first_ended_at,
            duration=60,
        )
        db.add(call)
        db.commit()

        second_ended_at = first_ended_at + timedelta(seconds=5)
        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"
        from messaging_provider import NormalizedCallEvent
        from dialer_service import CallEventType
        mock_event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ENDED,
            provider="messenger",
            provider_call_id="cv-idem-times-called",
            phone_number="+919876543210",
            direction="outbound",
            ended_at=second_ended_at,
            duration=60,
        )
        mock_provider.handle_webhook.return_value = mock_event

        with patch("dialer_service._instantiate_provider", return_value=mock_provider):
            dialer_service.handle_webhook(db, "messenger", {})

        db.refresh(lead)
        assert lead.times_called == 1, f"times_called double-counted on retry: {lead.times_called}"

    def test_duplicate_call_ended_status_stays_call_ended(self, db):
        """Status must remain CALL_ENDED after duplicate webhook — not regress."""
        from datetime import datetime, timezone
        import models, dialer_service
        from unittest.mock import patch, MagicMock

        self._make_messenger_settings(db)
        lead = create_test_lead(db, email="idempotent2@test.com")

        call = models.DialerCall(
            lead_id=lead.id,
            provider="messenger",
            provider_call_id="cv-idem-002",
            phone_number="+919876543210",
            status="CALL_ENDED",
            direction="outbound",
            ended_at=datetime(2026, 5, 29, 8, 0, 0, tzinfo=timezone.utc),
            duration=30,
        )
        db.add(call)
        db.commit()

        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"
        from messaging_provider import NormalizedCallEvent
        from dialer_service import CallEventType
        mock_event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ENDED,
            provider="messenger",
            provider_call_id="cv-idem-002",
            phone_number="+919876543210",
        )
        mock_provider.handle_webhook.return_value = mock_event

        with patch("dialer_service._instantiate_provider", return_value=mock_provider):
            result = dialer_service.handle_webhook(db, "messenger", {})

        db.refresh(call)
        assert call.status == "CALL_ENDED"
        assert result.get("ok") is True

    def test_ec17_late_answered_webhook_cannot_reopen_ended_call(self, db):
        """
        EC-17 regression: Alternate Messenger sends a late 'call.answered' webhook ~50s
        after the SDR clicked Disconnect. Without the terminal-state guard this
        overwrites CALL_ENDED → CALL_ANSWERED, recreating a ghost active call
        that blocks all future dials for up to 90 minutes.

        Post-condition: status stays CALL_ENDED; late CALL_ANSWERED is silently
        dropped.
        """
        from datetime import datetime, timezone, timedelta
        import models, dialer_service
        from unittest.mock import patch, MagicMock

        self._make_messenger_settings(db)
        lead = create_test_lead(db, email="ec17@test.com")
        ended_at = datetime(2026, 6, 12, 7, 44, 22, tzinfo=timezone.utc)

        # Disconnect already ran — call is CALL_ENDED with ended_at set
        call = models.DialerCall(
            lead_id=lead.id,
            provider="messenger",
            provider_call_id="cv-ec17-001",
            phone_number="+919876543210",
            status="CALL_ENDED",
            direction="outbound",
            started_at=datetime(2026, 6, 12, 7, 44, 7, tzinfo=timezone.utc),
            ended_at=ended_at,
            duration=15,
        )
        db.add(call)
        db.commit()

        # Late Alternate Messenger webhook: 'call.answered' arrives 50s after disconnect
        mock_provider = MagicMock()
        mock_provider.provider_name = "messenger"
        from messaging_provider import NormalizedCallEvent
        from dialer_service import CallEventType
        late_answered = NormalizedCallEvent(
            event_type=CallEventType.CALL_ANSWERED,
            provider="messenger",
            provider_call_id="cv-ec17-001",
            phone_number="+919876543210",
            answered_at=ended_at + timedelta(seconds=50),  # arrived after disconnect
        )
        mock_provider.handle_webhook.return_value = late_answered

        with patch("dialer_service._instantiate_provider", return_value=mock_provider):
            dialer_service.handle_webhook(db, "messenger", {})

        db.refresh(call)
        # EC-17: status must NOT have been downgraded
        assert call.status == "CALL_ENDED", (
            f"EC-17 violated: late CALL_ANSWERED webhook rewrote status to {call.status!r}. "
            f"This creates a ghost active call that blocks future dials."
        )
        # ended_at must be untouched
        assert call.ended_at.replace(tzinfo=None) == ended_at.replace(tzinfo=None)

    def test_race_duplicate_insert_recovers_via_refetch(self, db):
        """
        RCA 2026-07-27: two near-simultaneous webhooks for a call placed
        directly in Aircall (no matching Alternate CRM-initiated pending record)
        can both miss the initial provider_call_id lookup and both try to
        INSERT a new DialerCall — the second one hits the
        idx_dialer_calls_dedup unique constraint. Before the fix, this
        crashed the whole webhook and silently dropped the event (often the
        terminal CALL_ENDED), leaving the call stuck at CALL_STARTED/
        CALL_ANSWERED ("Pending") forever. It must instead recover by
        re-fetching the row the "other" webhook already created and applying
        the event to it.
        """
        import models, dialer_service
        from dialer_provider import NormalizedCallEvent
        from dialer_service import CallEventType
        from sqlalchemy.exc import IntegrityError

        lead = create_test_lead(db, phone="+919876543210")
        # No pre-existing DialerCall row for "race-001" — the initial lookup
        # in handle_webhook must genuinely miss, exactly as it would for a
        # brand-new call, so this call reaches the "not found" create branch.

        mock_provider = MagicMock()
        mock_provider.provider_name = "aircall"
        event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ENDED,
            provider="aircall",
            provider_call_id="race-001",
            phone_number="+919876543210",
            duration=42,
        )
        mock_provider.handle_webhook.return_value = event

        real_flush = db.flush
        state = {"raised": False}

        def flush_once_then_real(*a, **kw):
            # Fires only on the flush that's inserting the "loser" (our own
            # not-found branch's new row) — any other flush (e.g. inside
            # _get_settings) must pass through untouched.
            loser = next(
                (obj for obj in db.new
                 if isinstance(obj, models.DialerCall) and obj.provider_call_id == "race-001"),
                None,
            )
            if loser and not state["raised"]:
                state["raised"] = True
                # Simulate the concurrent webhook's INSERT landing and
                # committing first — durably, in its own transaction, exactly
                # as a second DB connection would in production.
                db.expunge(loser)
                winner = models.DialerCall(
                    lead_id=loser.lead_id,
                    provider="aircall",
                    provider_call_id="race-001",
                    phone_number="+919876543210",
                    status="CALL_ANSWERED",
                    direction="outbound",
                    source="aircall_direct",
                )
                db.add(winner)
                db.commit()
                db.add(loser)  # restore our own pending insert, which now conflicts
                raise IntegrityError(
                    "INSERT INTO dialer_calls ...", {},
                    Exception('duplicate key value violates unique constraint "idx_dialer_calls_dedup"'),
                )
            return real_flush(*a, **kw)

        with patch("dialer_service._instantiate_provider", return_value=mock_provider), \
             patch.object(db, "flush", side_effect=flush_once_then_real):
            dialer_service.handle_webhook(db, "aircall", {})

        rows = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "race-001"
        ).all()
        assert len(rows) == 1, (
            f"Expected exactly one DialerCall row for race-001 after recovery, found {len(rows)}."
        )
        assert rows[0].status == "CALL_ENDED", (
            f"Race recovery failed: expected the pre-existing row to be updated to "
            f"CALL_ENDED, got {rows[0].status!r} — the terminal event was dropped "
            f"instead of applied to the winning row."
        )
        assert rows[0].duration == 42

    def test_pending_match_tolerates_country_code_mismatch(self, db):
        """
        RCA 2026-07-29: the Alternate CRM-initiated placeholder stores the
        lead's phone as dialed ("(720) 974-7591", no country code), but
        Aircall's webhook reports the same call with a country code
        ("+1 720-974-7591"). A strict digit-equality match ("7209747591" !=
        "17209747591") missed this every time, so the webhook fell through
        to the "not found" branch and created an orphan DialerCall row
        instead of updating the placeholder — leaving the placeholder stuck
        at CALL_STARTED and blocking the SDR's next call until the 5-minute
        staleness heal (confirmed live against 24/28 sampled production
        blocking incidents). The match must be suffix-tolerant so the real
        webhook actually attaches to the placeholder.
        """
        import models, dialer_service
        from dialer_provider import NormalizedCallEvent
        from dialer_service import CallEventType

        lead = create_test_lead(db, phone="(720) 974-7591")
        placeholder = models.DialerCall(
            lead_id=lead.id,
            provider="aircall",
            provider_call_id="",
            phone_number="(720) 974-7591",
            status="CALL_STARTED",
            direction="outbound",
            source="alternatecrm",
        )
        db.add(placeholder)
        db.commit()
        placeholder_id = placeholder.id

        mock_provider = MagicMock()
        mock_provider.provider_name = "aircall"
        event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ANSWERED,
            provider="aircall",
            provider_call_id="3997171575",
            phone_number="+1 720-974-7591",
        )
        mock_provider.handle_webhook.return_value = event

        with patch("dialer_service._instantiate_provider", return_value=mock_provider):
            dialer_service.handle_webhook(db, "aircall", {})

        rows = db.query(models.DialerCall).filter(models.DialerCall.lead_id == lead.id).all()
        assert len(rows) == 1, (
            f"Expected the webhook to update the placeholder in place, not spawn "
            f"an orphan row — found {len(rows)} DialerCall rows for this lead."
        )
        assert rows[0].id == placeholder_id
        assert rows[0].provider_call_id == "3997171575"
        assert rows[0].status == "CALL_ANSWERED"


# ─────────────────────────────────────────────────────────────────────────────
# Gap 2 — Concurrent call start guard
# ─────────────────────────────────────────────────────────────────────────────

class TestConcurrentCallGuard:
    """
    Gap 2: Two POST /calls/start in quick succession for the same user.
    If CALL_STARTED record already exists for that user, second call must fail.
    Prevents two simultaneous LiveKit sessions (zombie calls).
    """

    def _make_provider_mock(self):
        from unittest.mock import MagicMock
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.provider_call_id = "cv-concurrent-001"
        mock_result.error = None
        for attr in ("livekit_token", "livekit_url", "room_name", "agent_join_via_phone"):
            setattr(mock_result, attr, None)
        provider = MagicMock()
        provider.provider_name = "messenger"
        provider.initiate_call = MagicMock(return_value=mock_result)
        provider.from_number = ""
        return provider, mock_result

    def test_second_call_rejected_when_active_call_exists(self, db):
        """
        If user already has a CALL_STARTED record, second call must fail with
        success=False and a clear message. Provider must NOT be called.
        """
        import models, dialer_service
        from conftest import create_sync_settings
        from datetime import datetime, timezone

        s = create_sync_settings(db)
        s.dialer_provider = "messenger"
        s.messenger_api_key = "test-key"
        s.messenger_user_id = "300956"
        db.commit()

        user = create_test_user(db, email="concurrent@test.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="clead@test.com")
        db.commit()

        # Existing active call for this user
        existing_call = models.DialerCall(
            lead_id=lead.id,
            user_id=user.id,
            provider="messenger",
            provider_call_id="cv-existing-001",
            phone_number="+919876543210",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        db.add(existing_call)
        db.commit()

        provider, _ = self._make_provider_mock()

        # RCA 2026-08-19: _get_active_call_for_user now does a live self-heal
        # status check via get_provider_by_name before blocking — mock it to
        # None (provider unavailable) so this test stays hermetic instead of
        # making a real HTTP call to Alternate Messenger.
        with patch.object(dialer_service, "get_provider_for_user", return_value=provider), \
             patch.object(dialer_service, "get_provider_by_name", return_value=None):
            result = dialer_service.initiate_call(
                db,
                {"sub": user.id, "email": user.email, "role": "SDR"},
                lead.id,
                "+918888888888",
                call_mode="browser",
            )

        assert result["success"] is False, (
            "Expected second call rejected, got success=True"
        )
        assert any(w in result["error"].lower() for w in ("active call", "already", "in progress")), (
            f"Expected active-call error, got: {result['error']}"
        )
        provider.initiate_call.assert_not_called()

    def test_initiate_call_creates_exactly_one_dialer_call_row(self, db):
        """RCA 2026-09-04: the DialerCall row used to be created only *after*
        provider.initiate_call() returned, leaving the whole external round-trip
        inside the window where the concurrent-call guard sees no active call —
        confirmed in prod as 38 same-lead dial pairs under 5s apart over 14 days.
        The fix reserves the row *before* calling the provider and fills it in
        after, rather than creating a second row — this pins that down."""
        import models, dialer_service
        from conftest import create_sync_settings

        s = create_sync_settings(db)
        s.dialer_provider = "aircall"
        db.commit()

        user = create_test_user(db, email="onerow@test.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="onerow_lead@test.com")
        db.commit()

        provider, _ = self._make_provider_mock()
        provider.provider_name = "aircall"

        with patch.object(dialer_service, "get_provider_for_user", return_value=provider):
            result = dialer_service.initiate_call(
                db,
                {"sub": user.id, "email": user.email, "role": "SDR"},
                lead.id,
                "+18008888888",
                call_mode="bridge",
            )

        assert result["success"] is True
        rows = db.query(models.DialerCall).filter(models.DialerCall.lead_id == lead.id).all()
        assert len(rows) == 1, f"Expected exactly one DialerCall row, got {len(rows)}"
        assert rows[0].id == result["call_id"]
        assert rows[0].provider_call_id == "cv-concurrent-001"

    def test_aircall_self_heal_unblocks_when_provider_reports_call_ended(self, db):
        """RCA 2026-08-19: an Aircall call the SDR already hung up on, whose
        CALL_ENDED webhook hasn't arrived yet, must not block the next dial —
        Aircall's own live status (checked directly, since its status API is
        documented reliable, unlike Alternate Messenger's) should self-heal it."""
        import models, dialer_service
        from conftest import create_sync_settings
        from datetime import datetime, timezone

        s = create_sync_settings(db)
        s.dialer_provider = "aircall"
        db.commit()

        user = create_test_user(db, email="selfheal@test.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="selfheal_lead@test.com")
        db.commit()

        stale_local_record = models.DialerCall(
            lead_id=lead.id,
            user_id=user.id,
            provider="aircall",
            provider_call_id="ac-selfheal-001",
            phone_number="+919876543210",
            status="CALL_ANSWERED",
            direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        db.add(stale_local_record)
        db.commit()

        provider, _ = self._make_provider_mock()
        aircall_provider = MagicMock()
        aircall_provider.get_call_status = MagicMock(return_value={"status": "completed"})

        with patch.object(dialer_service, "get_provider_for_user", return_value=provider), \
             patch.object(dialer_service, "get_provider_by_name", return_value=aircall_provider):
            result = dialer_service.initiate_call(
                db,
                {"sub": user.id, "email": user.email, "role": "SDR"},
                lead.id,
                "+918888888888",
                call_mode="browser",
            )

        assert result["success"] is True, (
            f"Self-heal should have unblocked the dial, got: {result.get('error')}"
        )
        aircall_provider.get_call_status.assert_called_once_with("ac-selfheal-001", fast=True)
        db.refresh(stale_local_record)
        assert stale_local_record.status == "CALL_ENDED"

    def test_aircall_self_heal_by_phone_when_no_provider_call_id_was_ever_recorded(self, db):
        """RCA 2026-09-03 (staging test session, real DB evidence): every
        Aircall call placed that session had provider_call_id == "" — a
        bridge-mode dial whose synchronous POST response never carried an id
        (expected) and whose webhook never arrived to backfill it (a
        separate, environment-specific gap). The old self-heal bailed out
        the instant provider_call_id was falsy, leaving the SDR blocked for
        the full EC-16 window. It must now fall back to a phone+recency
        lookup instead of giving up."""
        import models, dialer_service
        from conftest import create_sync_settings
        from datetime import datetime, timezone

        s = create_sync_settings(db)
        s.dialer_provider = "aircall"
        db.commit()

        user = create_test_user(db, email="selfheal2@test.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="selfheal2_lead@test.com")
        db.commit()

        stuck_local_record = models.DialerCall(
            lead_id=lead.id,
            user_id=user.id,
            provider="aircall",
            provider_call_id="",
            phone_number="1-800-263-3394",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        db.add(stuck_local_record)
        db.commit()

        provider, _ = self._make_provider_mock()
        aircall_provider = MagicMock()
        aircall_provider.find_recent_call_by_phone = MagicMock(
            return_value={"id": "ac-backfilled-002", "ended": True, "duration": 42}
        )
        _expected_owner_email = user.email

        with patch.object(dialer_service, "get_provider_for_user", return_value=provider), \
             patch.object(dialer_service, "get_provider_by_name", return_value=aircall_provider):
            result = dialer_service.initiate_call(
                db,
                {"sub": user.id, "email": user.email, "role": "SDR"},
                lead.id,
                "+918888888888",
                call_mode="browser",
            )

        assert result["success"] is True, (
            f"Phone-match self-heal should have unblocked the dial, got: {result.get('error')}"
        )
        aircall_provider.find_recent_call_by_phone.assert_called_once()
        assert _expected_owner_email in aircall_provider.find_recent_call_by_phone.call_args.args
        db.refresh(stuck_local_record)
        assert stuck_local_record.status == "CALL_ENDED"
        assert stuck_local_record.provider_call_id == "ac-backfilled-002"
        assert stuck_local_record.duration == 42

    def test_aircall_self_heal_by_phone_stays_blocked_when_aircall_reports_still_active(self, db):
        """The phone-match fallback must not heal a call that's genuinely
        still in progress — only an explicit ended=True unblocks the dial."""
        import models, dialer_service
        from conftest import create_sync_settings
        from datetime import datetime, timezone

        s = create_sync_settings(db)
        s.dialer_provider = "aircall"
        db.commit()

        user = create_test_user(db, email="selfheal3@test.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="selfheal3_lead@test.com")
        db.commit()

        stuck_local_record = models.DialerCall(
            lead_id=lead.id,
            user_id=user.id,
            provider="aircall",
            provider_call_id="",
            phone_number="1-800-263-3394",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        db.add(stuck_local_record)
        db.commit()

        provider, _ = self._make_provider_mock()
        aircall_provider = MagicMock()
        aircall_provider.find_recent_call_by_phone = MagicMock(
            return_value={"id": "ac-still-active-003", "ended": False, "duration": None}
        )

        with patch.object(dialer_service, "get_provider_for_user", return_value=provider), \
             patch.object(dialer_service, "get_provider_by_name", return_value=aircall_provider):
            result = dialer_service.initiate_call(
                db,
                {"sub": user.id, "email": user.email, "role": "SDR"},
                lead.id,
                "+918888888888",
                call_mode="browser",
            )

        assert result["success"] is False
        db.refresh(stuck_local_record)
        assert stuck_local_record.status == "CALL_STARTED"
        assert stuck_local_record.provider_call_id == ""

    def test_self_heal_skipped_for_messenger_calls(self, db):
        """RCA 2026-06-11: Alternate Messenger's /status endpoint returns 502s under
        polling load and is deliberately not polled live anywhere else in this
        codebase — the self-heal check must not reintroduce that, even though
        it would otherwise be free to try since a blocking call exists."""
        import models, dialer_service
        from conftest import create_sync_settings
        from datetime import datetime, timezone

        s = create_sync_settings(db)
        s.dialer_provider = "messenger"
        s.messenger_api_key = "test-key"
        s.messenger_user_id = "300956"
        db.commit()

        user = create_test_user(db, email="convselfheal@test.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="convselfheal_lead@test.com")
        db.commit()

        active_call = models.DialerCall(
            lead_id=lead.id,
            user_id=user.id,
            provider="messenger",
            provider_call_id="cv-noselfheal-001",
            phone_number="+919876543210",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        db.add(active_call)
        db.commit()

        with patch.object(dialer_service, "get_provider_by_name") as mock_get_provider:
            healed = dialer_service._try_live_self_heal(db, active_call)

        assert healed is False
        mock_get_provider.assert_not_called()  # never even looks up a Alternate Messenger provider

    def test_call_allowed_when_previous_call_ended(self, db):
        """
        CALL_ENDED previous call must NOT block a new call.
        Only CALL_STARTED (and CALL_ANSWERED) block.
        """
        import models, dialer_service
        from conftest import create_sync_settings
        from datetime import datetime, timezone

        s = create_sync_settings(db)
        s.dialer_provider = "messenger"
        s.messenger_api_key = "test-key"
        s.messenger_user_id = "300956"
        db.commit()

        user = create_test_user(db, email="concurrent2@test.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="clead2@test.com")
        db.commit()

        # Previous call already ended
        ended_call = models.DialerCall(
            lead_id=lead.id,
            user_id=user.id,
            provider="messenger",
            provider_call_id="cv-ended-001",
            phone_number="+919876543210",
            status="CALL_ENDED",
            direction="outbound",
            started_at=datetime.now(timezone.utc),
            ended_at=datetime.now(timezone.utc),
        )
        db.add(ended_call)
        db.commit()

        provider, _ = self._make_provider_mock()

        with patch.object(dialer_service, "get_provider_for_user", return_value=provider):
            result = dialer_service.initiate_call(
                db,
                {"sub": user.id, "email": user.email, "role": "SDR"},
                lead.id,
                "+918888888888",
                call_mode="browser",
            )

        assert result["success"] is True, (
            f"New call should succeed after previous ended, got: {result.get('error')}"
        )
        provider.initiate_call.assert_called_once()



# ─────────────────────────────────────────────────────────────────────────────
# EC-16 — Stale CALL_STARTED guard + nightly sync zombie-heal + sweeper
# ─────────────────────────────────────────────────────────────────────────────

class TestEC16StaleCallGuard:
    """
    EC-16: The double-call guard must NOT permanently block an SDR when a
    CALL_STARTED record is older than 90 minutes.  Such records are zombies —
    the CALL_ENDED webhook was never delivered (browser closed mid-call,
    provider outage, etc.).

    Tests:
      EC16-1: Stale CALL_STARTED (>90 min) → new call allowed, zombie healed
      EC16-2: Fresh CALL_STARTED (<90 min) → new call still blocked (existing behaviour)
      EC16-3: Nightly sync heals zombie CALL_STARTED via provider history
      EC16-4: Sweeper auto-heals stale CALL_STARTED; leaves fresh ones alone
    """

    def _make_provider_mock(self):
        from unittest.mock import MagicMock
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.provider_call_id = "cv-ec16-001"
        mock_result.error = None
        for attr in ("livekit_token", "livekit_url", "room_name", "agent_join_via_phone"):
            setattr(mock_result, attr, None)
        provider = MagicMock()
        provider.provider_name = "messenger"
        provider.initiate_call = MagicMock(return_value=mock_result)
        provider.from_number = ""
        return provider, mock_result

    def _setup_messenger(self, db):
        from conftest import create_sync_settings
        s = create_sync_settings(db)
        s.dialer_provider = "messenger"
        s.messenger_api_key = "test-key"
        s.messenger_user_id = "300956"
        db.commit()
        return s

    def test_ec16_1_stale_call_unblocks_sdr(self, db):
        """
        EC16-1: A CALL_STARTED record >90 min old must NOT block a new call.
        The zombie record must be auto-healed to CALL_ENDED and the new call must
        be allowed to proceed.
        """
        import models, dialer_service
        from datetime import datetime, timezone, timedelta

        self._setup_messenger(db)
        user = create_test_user(db, email="ec16_stale@test.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="ec16_stale_lead@test.com")
        db.commit()

        # Zombie — started 2 hours ago, webhook never arrived
        zombie_call = models.DialerCall(
            lead_id=lead.id,
            user_id=user.id,
            provider="messenger",
            provider_call_id="cv-zombie-001",
            phone_number="+919876543210",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        db.add(zombie_call)
        db.commit()

        provider, _ = self._make_provider_mock()

        with patch.object(dialer_service, "get_provider_for_user", return_value=provider):
            result = dialer_service.initiate_call(
                db,
                {"sub": user.id, "email": user.email, "role": "SDR"},
                lead.id,
                "+918888888888",
                call_mode="browser",
            )

        # New call must succeed — zombie should not block
        assert result["success"] is True, (
            f"EC16-1: Stale zombie call should not block new call, got: {result.get('error')}"
        )
        provider.initiate_call.assert_called_once()

        # Zombie record must be healed to CALL_ENDED
        db.refresh(zombie_call)
        assert zombie_call.status == "CALL_ENDED", (
            f"EC16-1: Zombie record must be auto-healed to CALL_ENDED, got {zombie_call.status!r}"
        )
        assert zombie_call.ended_at is not None, (
            "EC16-1: Zombie record must have ended_at set after auto-heal"
        )

    def test_ec16_2_fresh_call_still_blocks(self, db):
        """
        EC16-2: A CALL_STARTED record <90 min old must still block a new call.
        The staleness window must NOT affect fresh active calls.
        """
        import models, dialer_service
        from datetime import datetime, timezone, timedelta

        self._setup_messenger(db)
        user = create_test_user(db, email="ec16_fresh@test.com", role="SDR")
        user.dialer_enabled = True
        lead = create_test_lead(db, email="ec16_fresh_lead@test.com")
        db.commit()

        # Fresh — started 2 minutes ago, genuinely in progress
        # NOTE: threshold is _STALE_STARTED_MINUTES=5. Use 2 min to stay safely
        # below it — timedelta(minutes=5) hits the boundary and is flaky with >=.
        fresh_call = models.DialerCall(
            lead_id=lead.id,
            user_id=user.id,
            provider="messenger",
            provider_call_id="cv-fresh-001",
            phone_number="+919876543210",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=2),
        )
        db.add(fresh_call)
        db.commit()

        provider, _ = self._make_provider_mock()

        # See TestConcurrentCallGuard's note above — mock the self-heal's
        # provider lookup to None so this test stays hermetic.
        with patch.object(dialer_service, "get_provider_for_user", return_value=provider), \
             patch.object(dialer_service, "get_provider_by_name", return_value=None):
            result = dialer_service.initiate_call(
                db,
                {"sub": user.id, "email": user.email, "role": "SDR"},
                lead.id,
                "+918888888888",
                call_mode="browser",
            )

        # Must still be blocked — this is a real concurrent call
        assert result["success"] is False, (
            "EC16-2: Fresh CALL_STARTED (<90 min) must still block a new call"
        )
        assert any(w in result["error"].lower() for w in ("active call", "already", "in progress")), (
            f"EC16-2: Expected active-call error, got: {result['error']}"
        )
        provider.initiate_call.assert_not_called()

        # Fresh record must NOT be touched
        db.refresh(fresh_call)
        assert fresh_call.status == "CALL_STARTED", (
            "EC16-2: Fresh call must not be auto-healed"
        )

    def test_ec16_3_nightly_sync_heals_zombie_call_started(self, db):
        """
        EC16-3: Nightly Alternate Messenger sync must update a zombie CALL_STARTED record
        to CALL_ENDED when provider history shows the call ended.
        Previously it was silently skipped (skipped_dup += 1).
        """
        import models, dialer_service
        from datetime import datetime, timezone, timedelta
        from unittest.mock import MagicMock, patch
        from scheduled_jobs import _messenger_nightly_sync

        # Ensure Alternate Messenger provider is configured
        self._setup_messenger(db)
        lead = create_test_lead(db, email="ec16_sync@test.com")
        db.commit()

        # Zombie in DB — stuck in CALL_STARTED, no webhook
        zombie = models.DialerCall(
            lead_id=lead.id,
            user_id="test-user-id",
            provider="messenger",
            provider_call_id="cv-sync-zombie-001",
            phone_number="+919876543210",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc) - timedelta(hours=3),
        )
        db.add(zombie)
        db.commit()
        db.close()

        # Provider history shows it ended
        from dialer_provider import NormalizedCallEvent, CallEventType
        ended_event = NormalizedCallEvent(
            event_type=CallEventType.CALL_ENDED,
            provider="messenger",
            provider_call_id="cv-sync-zombie-001",
            phone_number="+919876543210",
            ended_at=datetime.now(timezone.utc) - timedelta(hours=2, minutes=55),
            duration=30,
        )

        mock_provider = MagicMock()
        mock_provider.fetch_calls_paginated = MagicMock(side_effect=[
            {"calls": [{"call_id": "cv-sync-zombie-001", "status": "completed"}]},
            {"calls": []},  # terminate pagination
        ])
        mock_provider.handle_webhook = MagicMock(return_value=ended_event)

        with patch("dialer_service._get_settings"), \
             patch("dialer_service._instantiate_provider", return_value=mock_provider):
            _messenger_nightly_sync()

        # Re-open DB and verify healing
        from database import SessionLocal
        db2 = SessionLocal()
        try:
            healed = db2.query(models.DialerCall).filter(
                models.DialerCall.provider_call_id == "cv-sync-zombie-001"
            ).first()
            assert healed is not None, "EC16-3: DialerCall record not found after sync"
            assert healed.status == "CALL_ENDED", (
                f"EC16-3: Nightly sync must heal zombie CALL_STARTED → CALL_ENDED, got {healed.status!r}"
            )
            assert healed.ended_at is not None, (
                "EC16-3: Nightly sync must set ended_at on healed zombie"
            )
            assert healed.duration == 30, (
                f"EC16-3: Nightly sync must set duration on healed zombie, got {healed.duration}"
            )
        finally:
            db2.close()

    def test_ec16_4_sweeper_heals_stale_leaves_fresh(self, db):
        """
        EC16-4: _sweep_stale_calls() must heal CALL_STARTED records >90 min old
        and leave fresh CALL_STARTED records (< 90 min) untouched.
        """
        import models
        from datetime import datetime, timezone, timedelta
        from scheduled_jobs import _sweep_stale_calls

        lead = create_test_lead(db, email="ec16_sweeper@test.com")
        db.commit()

        # Stale zombie — 2 hours old
        stale_call = models.DialerCall(
            lead_id=lead.id,
            user_id="test-user-id",
            provider="messenger",
            provider_call_id="cv-sweep-stale-001",
            phone_number="+919876543210",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        # Fresh call — 10 minutes old
        fresh_call = models.DialerCall(
            lead_id=lead.id,
            user_id="test-user-id-2",
            provider="messenger",
            provider_call_id="cv-sweep-fresh-001",
            phone_number="+918888888888",
            status="CALL_STARTED",
            direction="outbound",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        )
        db.add_all([stale_call, fresh_call])
        db.commit()
        db.close()

        # Run sweeper
        _sweep_stale_calls()

        # Verify results
        from database import SessionLocal
        db2 = SessionLocal()
        try:
            stale = db2.query(models.DialerCall).filter(
                models.DialerCall.provider_call_id == "cv-sweep-stale-001"
            ).first()
            fresh = db2.query(models.DialerCall).filter(
                models.DialerCall.provider_call_id == "cv-sweep-fresh-001"
            ).first()

            assert stale.status == "CALL_ENDED", (
                f"EC16-4: Sweeper must heal stale call, got {stale.status!r}"
            )
            assert stale.ended_at is not None, (
                "EC16-4: Sweeper must set ended_at on stale call"
            )
            assert fresh.status == "CALL_STARTED", (
                f"EC16-4: Sweeper must NOT touch fresh call (<90 min), got {fresh.status!r}"
            )
            assert fresh.ended_at is None, (
                "EC16-4: Sweeper must not set ended_at on fresh call"
            )
        finally:
            db2.close()



# ─────────────────────────────────────────────────────────────────────────────
# T1A — GET /api/calls/my-active
# ─────────────────────────────────────────────────────────────────────────────

class TestMyActiveCall:
    """Tests for GET /api/calls/my-active (ghost call recovery endpoint)."""

    USER_ID = "sdr-user-id"

    def _make_dc(self, db, status="CALL_ANSWERED", minutes_ago=1, lead=None):
        """Create a DialerCall for self.USER_ID."""
        from datetime import datetime, timezone, timedelta
        import models
        started = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
        dc = models.DialerCall(
            user_id=self.USER_ID,
            provider="messenger",
            provider_call_id="cv-test-123",
            phone_number="+910000000001",
            status=status,
            started_at=started,
            answered_at=started if status == "CALL_ANSWERED" else None,
            lead_id=lead.id if lead else None,
        )
        db.add(dc)
        db.commit()
        db.refresh(dc)
        return dc

    def _client(self, db):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user
        from routes.dialer_routes import router as dialer_router
        from conftest import _make_user_payload

        app = FastAPI()
        app.include_router(dialer_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: _make_user_payload(
            "SDR", self.USER_ID, "sdr@test.com", "SDR User"
        )
        return TestClient(app)

    def test_returns_false_when_no_calls(self, db):
        """Clean state: no DialerCall rows → { active: false }."""
        client = self._client(db)
        resp = client.get("/api/calls/my-active")
        assert resp.status_code == 200
        assert resp.json() == {"active": False}

    def test_returns_call_when_answered(self, db):
        """Fresh CALL_ANSWERED within threshold → { active: true } with all fields."""
        self._make_dc(db, status="CALL_ANSWERED", minutes_ago=2)
        client = self._client(db)
        resp = client.get("/api/calls/my-active")
        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is True
        assert data["status"] == "CALL_ANSWERED"
        assert data["phone"] == "+910000000001"

    def test_returns_call_when_started(self, db):
        """Fresh CALL_STARTED within 5-min threshold → { active: true }."""
        self._make_dc(db, status="CALL_STARTED", minutes_ago=1)
        client = self._client(db)
        resp = client.get("/api/calls/my-active")
        assert resp.status_code == 200
        assert resp.json()["active"] is True

    def test_returns_false_when_stale_started(self, db):
        """CALL_STARTED older than 5 min → EC-16 auto-heals → { active: false }."""
        self._make_dc(db, status="CALL_STARTED", minutes_ago=10)
        client = self._client(db)
        resp = client.get("/api/calls/my-active")
        assert resp.status_code == 200
        assert resp.json() == {"active": False}

    def test_returns_false_when_stale_answered(self, db):
        """CALL_ANSWERED older than 90 min → EC-16 auto-heals → { active: false }."""
        self._make_dc(db, status="CALL_ANSWERED", minutes_ago=95)
        client = self._client(db)
        resp = client.get("/api/calls/my-active")
        assert resp.status_code == 200
        assert resp.json() == {"active": False}

    def test_null_lead_id_handled(self, db):
        """Anonymous call (lead_id=None) → lead_name null, not a 500."""
        self._make_dc(db, status="CALL_ANSWERED", minutes_ago=1, lead=None)
        client = self._client(db)
        resp = client.get("/api/calls/my-active")
        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is True
        assert data["lead_id"] is None
        assert data["lead_name"] is None


# ─────────────────────────────────────────────────────────────────────────────
# T1B — POST /api/calls/force-end
# ─────────────────────────────────────────────────────────────────────────────

class TestForceEnd:
    """Tests for POST /api/calls/force-end (escape hatch + sendBeacon target)."""

    USER_ID = "sdr-user-id"

    def _make_dc(self, db, status="CALL_ANSWERED"):
        from datetime import datetime, timezone
        import models
        dc = models.DialerCall(
            user_id=self.USER_ID,
            provider="messenger",
            provider_call_id="cv-force-123",
            phone_number="+910000000099",
            status=status,
            started_at=datetime.now(timezone.utc),
        )
        db.add(dc)
        db.commit()
        db.refresh(dc)
        return dc

    def _client_with_token(self, db):
        """Client that passes a real JWT in the request header."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import create_jwt
        from routes.dialer_routes import router as dialer_router

        app = FastAPI()
        app.include_router(dialer_router)
        app.dependency_overrides[get_db] = lambda: db

        # A real token is now checked against the DB (auth.authenticate):
        # the user must exist and still be on the allowed list.
        import access_db, models
        if not db.query(models.User).filter(models.User.id == self.USER_ID).first():
            db.add(models.User(id=self.USER_ID, email="sdr@test.com", name="SDR", role="SDR"))
            db.commit()
        access_db.add_allowed_user(db, "sdr@test.com", "SDR", "SDR")
        token = create_jwt({"sub": self.USER_ID, "role": "SDR", "email": "sdr@test.com"})
        client = TestClient(app, headers={"Authorization": f"Bearer {token}"})
        return client

    def test_marks_call_ended_in_db(self, db):
        """Happy path: valid call_id → DB status=CALL_ENDED, returns {ok: true}."""
        import models
        dc = self._make_dc(db)
        client = self._client_with_token(db)

        with patch("routes.dialer_routes.dialer_service._instantiate_provider") as mock_prov:
            mock_provider = MagicMock()
            mock_provider.disconnect_call.return_value = {"ok": True}
            mock_prov.return_value = mock_provider

            resp = client.post("/api/calls/force-end", json={"call_id": dc.id})

        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

        db.refresh(dc)
        assert dc.status == "CALL_ENDED"
        assert dc.ended_at is not None

    def test_succeeds_when_provider_errors(self, db):
        """Provider disconnect raises → DB still marked CALL_ENDED, returns {ok: true}."""
        import models
        dc = self._make_dc(db)
        client = self._client_with_token(db)

        with patch("routes.dialer_routes.dialer_service._instantiate_provider") as mock_prov:
            mock_provider = MagicMock()
            mock_provider.disconnect_call.side_effect = Exception("Alternate Messenger unavailable")
            mock_prov.return_value = mock_provider

            resp = client.post("/api/calls/force-end", json={"call_id": dc.id})

        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

        db.refresh(dc)
        assert dc.status == "CALL_ENDED"

    def test_idempotent_on_already_ended(self, db):
        """Calling force-end on a CALL_ENDED call → 200, no-op."""
        dc = self._make_dc(db, status="CALL_ENDED")
        client = self._client_with_token(db)

        resp = client.post("/api/calls/force-end", json={"call_id": dc.id})

        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_404_for_missing_call(self, db):
        """call_id not in DB → 404."""
        client = self._client_with_token(db)
        resp = client.post("/api/calls/force-end", json={"call_id": "nonexistent-uuid"})
        assert resp.status_code == 404

    def test_400_when_no_call_id(self, db):
        """Body missing call_id → 400."""
        client = self._client_with_token(db)
        resp = client.post("/api/calls/force-end", json={})
        assert resp.status_code == 400


# ─────────────────────────────────────────────────────────────────────────────
# Klenty Manual Backfill Trigger Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestKlentySyncTrigger:
    """Tests for POST /api/admin/dialer/sync-klenty."""

    def test_super_admin_only(self, db):
        """Non-Super-Admin gets 403."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user
        from routes.dialer_routes import router as dialer_router
        from conftest import _make_user_payload

        app = FastAPI()
        app.include_router(dialer_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: _make_user_payload("Pod Admin")
        client = TestClient(app)

        resp = client.post("/api/admin/dialer/sync-klenty", json={})
        assert resp.status_code == 403

    def test_returns_not_ran_when_klenty_disabled(self, db):
        """Klenty not enabled (default test DB state) → ran: False, no external call attempted."""
        client = _make_dialer_app(db)
        resp = client.post("/api/admin/dialer/sync-klenty", json={"lookback_days": 29})
        assert resp.status_code == 200
        body = resp.json()
        assert body["ran"] is False
        assert "not enabled" in body["reason"]

    def test_lookback_days_capped_at_provider_max(self, db):
        """A lookback_days above Klenty's own API limit is silently capped, not rejected."""
        from klenty_provider import MAX_SYNC_LOOKBACK_DAYS
        client = _make_dialer_app(db)
        with patch("scheduled_jobs._klenty_nightly_sync") as mock_sync:
            mock_sync.return_value = {"ran": True}
            resp = client.post("/api/admin/dialer/sync-klenty", json={"lookback_days": 9999})
        assert resp.status_code == 200
        mock_sync.assert_called_once_with(lookback_days=MAX_SYNC_LOOKBACK_DAYS)


# ─────────────────────────────────────────────────────────────────────────────
# Instantly.ai Manual Sync Trigger + Campaign Analytics Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestInstantlySyncTrigger:
    """Tests for POST /api/admin/instantly/sync."""

    def test_super_admin_only(self, db):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user
        from routes.dialer_routes import router as dialer_router
        from conftest import _make_user_payload

        app = FastAPI()
        app.include_router(dialer_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: _make_user_payload("Pod Admin")
        client = TestClient(app)

        resp = client.post("/api/admin/instantly/sync")
        assert resp.status_code == 403

    def test_returns_not_ran_when_instantly_disabled(self, db):
        """Instantly not enabled (default test DB state) → ran: False, no external call attempted."""
        client = _make_dialer_app(db)
        resp = client.post("/api/admin/instantly/sync")
        assert resp.status_code == 200
        body = resp.json()
        assert body["ran"] is False

    def test_error_reason_does_not_leak_raw_provider_error(self, db):
        """_instantly_sync_job's own generic failure reason (not a raw
        exception string, which could carry a raw third-party error body —
        the one MUST-FIX from this feature's security review) must reach the
        HTTP caller unchanged, i.e. the route doesn't need to sanitize it
        again because the job already does."""
        client = _make_dialer_app(db)
        with patch("scheduled_jobs._instantly_sync_job") as mock_sync:
            mock_sync.return_value = {"ran": False, "reason": "Instantly sync failed — see server logs for details"}
            resp = client.post("/api/admin/instantly/sync")
        assert resp.status_code == 200
        assert resp.json()["reason"] == "Instantly sync failed — see server logs for details"


class TestInstantlyCampaignAnalytics:
    """Tests for GET /api/admin/instantly/analytics."""

    def test_super_admin_only(self, db):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user
        from routes.dialer_routes import router as dialer_router
        from conftest import _make_user_payload

        app = FastAPI()
        app.include_router(dialer_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: _make_user_payload("Pod Admin")
        client = TestClient(app)

        resp = client.get("/api/admin/instantly/analytics")
        assert resp.status_code == 403

    def test_400_when_not_configured(self, db):
        """Default test DB state has Instantly disabled — reject before any external call."""
        client = _make_dialer_app(db)
        resp = client.get("/api/admin/instantly/analytics")
        assert resp.status_code == 400

    def test_returns_live_data_and_caches_it(self, db):
        import dialer_service
        settings = dialer_service._get_settings(db)
        settings.instantly_enabled = True
        settings.instantly_api_key = "real-key"
        db.commit()

        client = _make_dialer_app(db)
        with patch("instantly_provider.InstantlyProvider.get_campaign_step_analytics") as mock_fetch:
            mock_fetch.return_value = [{"step": 1, "sent": 100, "opened": 40}]
            resp1 = client.get("/api/admin/instantly/analytics?campaign_id=cache-test")
            resp2 = client.get("/api/admin/instantly/analytics?campaign_id=cache-test")
        assert resp1.status_code == 200
        assert resp1.json() == [{"step": 1, "sent": 100, "opened": 40}]
        assert resp2.json() == resp1.json()
        mock_fetch.assert_called_once()  # second call served from cache

    def test_plan_tier_error_returns_402(self, db):
        import dialer_service
        settings = dialer_service._get_settings(db)
        settings.instantly_enabled = True
        settings.instantly_api_key = "real-key"
        db.commit()

        from instantly_provider import InstantlyPlanTierError
        client = _make_dialer_app(db)
        with patch("instantly_provider.InstantlyProvider.get_campaign_step_analytics") as mock_fetch:
            mock_fetch.side_effect = InstantlyPlanTierError("plan tier too low")
            # Distinct campaign_id so this doesn't read the success-case
            # response cached under the default "all" key by another test.
            resp = client.get("/api/admin/instantly/analytics?campaign_id=plan-tier-test")
        assert resp.status_code == 402

    def test_provider_error_does_not_leak_raw_message(self, db):
        """A raw exception from the HTTP layer must not reach the response body."""
        import dialer_service
        settings = dialer_service._get_settings(db)
        settings.instantly_enabled = True
        settings.instantly_api_key = "real-key"
        db.commit()

        client = _make_dialer_app(db)
        with patch("instantly_provider.InstantlyProvider.get_campaign_step_analytics") as mock_fetch:
            mock_fetch.side_effect = RuntimeError("Instantly API error 500: {'secret': 'leaked-internal-detail'}")
            resp = client.get("/api/admin/instantly/analytics?campaign_id=provider-error-test")
        assert resp.status_code == 502
        assert "leaked-internal-detail" not in resp.text


class TestEnabledInstantlyAccounts:
    """GET /api/instantly/sending-accounts — the cadence step's "Send from"
    picker: any cadence author, but only Super-Admin-enabled mailboxes."""

    def _client_as(self, db, role):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user
        from routes.dialer_routes import router as dialer_router
        from conftest import _make_user_payload
        app = FastAPI()
        app.include_router(dialer_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: _make_user_payload(role)
        return TestClient(app)

    def _workspace(self, db, enabled):
        import dialer_service
        s = dialer_service._get_settings(db)
        s.instantly_enabled, s.instantly_api_key, s.instantly_sending_accounts = True, "real-key", enabled
        db.commit()
        return {"items": [{"email": "a@one.com", "daily_limit": 30}, {"email": "b@two.io", "daily_limit": 40}],
                "next_starting_after": None}

    def test_a_rep_sees_only_the_enabled_mailboxes_with_their_domain(self, db):
        page = self._workspace(db, '["b@two.io"]')
        with patch("instantly_provider.InstantlyProvider._request", return_value=page):
            resp = self._client_as(db, "SDR").get("/api/instantly/sending-accounts")
        assert resp.status_code == 200
        assert resp.json() == [{"email": "b@two.io", "domain": "two.io", "daily_limit": 40}]

    def test_nothing_enabled_means_every_mailbox(self, db):
        page = self._workspace(db, None)
        with patch("instantly_provider.InstantlyProvider._request", return_value=page):
            resp = self._client_as(db, "AE").get("/api/instantly/sending-accounts")
        assert [a["email"] for a in resp.json()] == ["a@one.com", "b@two.io"]


class TestInstantlyAccounts:
    """Tests for GET /api/admin/instantly/accounts (sending-accounts picker, v13.3.0)."""

    def test_super_admin_only(self, db):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user
        from routes.dialer_routes import router as dialer_router
        from conftest import _make_user_payload

        app = FastAPI()
        app.include_router(dialer_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: _make_user_payload("Pod Admin")
        client = TestClient(app)

        resp = client.get("/api/admin/instantly/accounts")
        assert resp.status_code == 403

    def test_400_when_not_configured(self, db):
        client = _make_dialer_app(db)
        resp = client.get("/api/admin/instantly/accounts")
        assert resp.status_code == 400

    def test_returns_email_and_daily_limit_paginated(self, db):
        """Mirrors list_campaigns' starting_after pagination — only email +
        daily_limit reach the response, not the full account payload."""
        import dialer_service
        settings = dialer_service._get_settings(db)
        settings.instantly_enabled = True
        settings.instantly_api_key = "real-key"
        db.commit()

        pages = [
            {"items": [{"email": "a@pool.com", "daily_limit": 50, "is_managed_account": True}],
             "next_starting_after": "cursor1"},
            {"items": [{"email": "b@pool.com", "daily_limit": 50, "is_managed_account": True}],
             "next_starting_after": None},
        ]
        client = _make_dialer_app(db)
        with patch("instantly_provider.InstantlyProvider._request") as mock_request:
            mock_request.side_effect = pages
            resp = client.get("/api/admin/instantly/accounts")
        assert resp.status_code == 200
        assert resp.json() == [
            {"email": "a@pool.com", "domain": "pool.com", "daily_limit": 50},
            {"email": "b@pool.com", "domain": "pool.com", "daily_limit": 50},
        ]
        assert mock_request.call_count == 2

    def test_provider_error_does_not_leak_raw_message(self, db):
        import dialer_service
        settings = dialer_service._get_settings(db)
        settings.instantly_enabled = True
        settings.instantly_api_key = "real-key"
        db.commit()

        client = _make_dialer_app(db)
        with patch("instantly_provider.InstantlyProvider._request") as mock_request:
            mock_request.side_effect = RuntimeError("Instantly API error 500: {'secret': 'leaked'}")
            resp = client.get("/api/admin/instantly/accounts")
        assert resp.status_code == 502
        assert "leaked" not in resp.text


class TestInstantlySendingAccountsConfig:
    """Tests for instantly_sending_accounts read/write via GET/PATCH /dialer/config."""

    def test_defaults_to_null(self, db):
        client = _make_dialer_app(db)
        resp = client.get("/api/dialer/config")
        assert resp.status_code == 200
        assert resp.json()["instantly_sending_accounts"] is None

    def test_save_and_read_back(self, db):
        client = _make_dialer_app(db)
        resp = client.patch("/api/dialer/config", json={"instantly_sending_accounts": ["a@pool.com", "b@pool.com"]})
        assert resp.status_code == 200

        resp2 = client.get("/api/dialer/config")
        assert resp2.json()["instantly_sending_accounts"] == ["a@pool.com", "b@pool.com"]

    def test_empty_list_clears_to_null(self, db):
        """Empty selection means 'all active accounts' (NULL), not an empty-list
        JSON string that would mean 'send from nothing' — see plan default."""
        client = _make_dialer_app(db)
        client.patch("/api/dialer/config", json={"instantly_sending_accounts": ["a@pool.com"]})
        resp = client.patch("/api/dialer/config", json={"instantly_sending_accounts": []})
        assert resp.status_code == 200

        resp2 = client.get("/api/dialer/config")
        assert resp2.json()["instantly_sending_accounts"] is None


# ─────────────────────────────────────────────────────────────────────────────
# Instantly.ai real-time webhook register/disable (v13.3.0 Phase 3, plan section 4/5)
# ─────────────────────────────────────────────────────────────────────────────

class TestInstantlyWebhookRegister:
    def _settings(self, db, api_key="test-key", webhook_secret=None, webhook_id=None):
        import models
        s = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        if not s:
            s = models.SyncSettings(id=1)
            db.add(s)
        s.instantly_api_key = api_key
        if webhook_secret:
            s.instantly_webhook_secret = webhook_secret
        s.instantly_webhook_id = webhook_id
        db.commit()
        return s

    def test_super_admin_only(self, db):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user
        from routes.dialer_routes import router as dialer_router
        from conftest import _make_user_payload

        app = FastAPI()
        app.include_router(dialer_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: _make_user_payload("Pod Admin")
        client = TestClient(app)

        assert client.post("/api/admin/instantly/webhook/register").status_code == 403
        assert client.post("/api/admin/instantly/webhook/disable").status_code == 403

    def test_requires_instantly_configured(self, db):
        client = _make_dialer_app(db)
        resp = client.post("/api/admin/instantly/webhook/register")
        assert resp.status_code == 400

    def test_register_generates_secret_and_stores_ids(self, db, monkeypatch):
        import models
        monkeypatch.setenv("BACKEND_URL", "https://crm.example.com")
        self._settings(db)
        client = _make_dialer_app(db)

        provider = MagicMock()
        provider.create_webhook.return_value = {"items": [{"id": "wh-1"}, {"id": "wh-2"}]}
        with patch("instantly_provider.InstantlyProvider", return_value=provider):
            resp = client.post("/api/admin/instantly/webhook/register")

        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert set(body["webhook_ids"]) == {"wh-1", "wh-2"}
        assert "webhook_secret" in body  # one-time reveal, first generation

        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        assert settings.instantly_webhook_secret  # persisted
        import json as _json
        assert set(_json.loads(settings.instantly_webhook_id)) == {"wh-1", "wh-2"}

        provider.create_webhook.assert_called_once()
        _, kwargs = provider.create_webhook.call_args
        assert kwargs["target_url"] == "https://crm.example.com/webhooks/instantly"

    def test_register_does_not_return_secret_once_already_set(self, db, monkeypatch):
        monkeypatch.setenv("BACKEND_URL", "https://crm.example.com")
        self._settings(db, webhook_secret="already-set-secret")
        client = _make_dialer_app(db)

        provider = MagicMock()
        provider.create_webhook.return_value = {"items": [{"id": "wh-1"}]}
        with patch("instantly_provider.InstantlyProvider", return_value=provider):
            resp = client.post("/api/admin/instantly/webhook/register")

        assert resp.status_code == 200
        assert "webhook_secret" not in resp.json()

    def test_register_is_idempotent_when_already_registered(self, db, monkeypatch):
        monkeypatch.setenv("BACKEND_URL", "https://crm.example.com")
        import json as _json
        self._settings(db, webhook_secret="sec", webhook_id=_json.dumps(["wh-1", "wh-2"]))
        client = _make_dialer_app(db)

        provider = MagicMock()
        provider.list_webhooks.return_value = {"items": [{"id": "wh-1"}, {"id": "wh-2"}]}
        with patch("instantly_provider.InstantlyProvider", return_value=provider):
            resp = client.post("/api/admin/instantly/webhook/register")

        assert resp.status_code == 200
        assert resp.json()["already_registered"] is True
        provider.create_webhook.assert_not_called()

    def test_disable_deletes_every_registered_id_and_clears_stored_id(self, db):
        import models
        import json as _json
        self._settings(db, webhook_secret="sec", webhook_id=_json.dumps(["wh-1", "wh-2"]))
        client = _make_dialer_app(db)

        provider = MagicMock()
        with patch("instantly_provider.InstantlyProvider", return_value=provider):
            resp = client.post("/api/admin/instantly/webhook/disable")

        assert resp.status_code == 200
        assert provider.delete_webhook.call_count == 2
        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        assert settings.instantly_webhook_id is None

    def test_dialer_config_reflects_registered_and_disabled_state(self, db, monkeypatch):
        """The admin UI's 'Real-time webhook' toggle reads instantly_webhook_id
        off GET /dialer/config — register must make it show up there, disable
        must clear it, with no separate route needed just to check state."""
        monkeypatch.setenv("BACKEND_URL", "https://crm.example.com")
        self._settings(db)
        client = _make_dialer_app(db)

        assert client.get("/api/dialer/config").json()["instantly_webhook_id"] is None

        provider = MagicMock()
        provider.create_webhook.return_value = {"items": [{"id": "wh-1"}]}
        with patch("instantly_provider.InstantlyProvider", return_value=provider):
            client.post("/api/admin/instantly/webhook/register")
        assert client.get("/api/dialer/config").json()["instantly_webhook_id"] == ["wh-1"]

        with patch("instantly_provider.InstantlyProvider", return_value=provider):
            client.post("/api/admin/instantly/webhook/disable")
        assert client.get("/api/dialer/config").json()["instantly_webhook_id"] is None


# ─────────────────────────────────────────────────────────────────────────────
# Caller-ID (v11.3.0): handle_webhook() surfaces lead identity, and the
# Aircall-specific webhook endpoint fans it out over SSE (previously the only
# endpoint that fanned out NOTHING to SSE — Alternate Messenger's did, Aircall's didn't).
# ─────────────────────────────────────────────────────────────────────────────

class TestCallerIdLookup:

    def _webhook_event(self, phone, user_email, provider_call_id="ac-callerid-1", direction="inbound"):
        from dialer_provider import NormalizedCallEvent, CallEventType
        return NormalizedCallEvent(
            event_type=CallEventType.CALL_STARTED,
            provider="aircall",
            provider_call_id=provider_call_id,
            phone_number=phone,
            user_email=user_email,
            direction=direction,
        )

    def test_handle_webhook_returns_identified_lead(self, db):
        import dialer_service
        sdr = create_test_user(db, email="callerid-sdr@t.com", role="SDR")
        phone = "+919876544444"
        lead = create_test_lead(db, email="identified@t.com", phone=phone,
                                 first_name="Priya", last_name="Sharma", company="Acme Corp")
        db.commit()

        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.handle_webhook.return_value = self._webhook_event(phone, "callerid-sdr@t.com")

        with patch("dialer_service._instantiate_provider", return_value=provider_mock):
            result = dialer_service.handle_webhook(db, "aircall", {})

        assert result["lead_name"] == "Priya Sharma"
        assert result["lead_company"] == "Acme Corp"
        assert result["direction"] == "inbound"

    def test_handle_webhook_unmatched_number_returns_none_identity(self, db):
        """No resolvable SDR — per policy, no lead is created (see
        TestWebhookLeadAutoCreation), so identity fields are None, not an error."""
        import dialer_service
        provider_mock = MagicMock()
        provider_mock.provider_name = "aircall"
        provider_mock.handle_webhook.return_value = self._webhook_event(
            "+919876555555", "not-a-alternatecrm-user@t.com", provider_call_id="ac-callerid-2"
        )

        with patch("dialer_service._instantiate_provider", return_value=provider_mock):
            result = dialer_service.handle_webhook(db, "aircall", {})

        assert result["lead_name"] is None
        assert result["lead_company"] is None

    def test_aircall_webhook_endpoint_publishes_sse_with_caller_id(self, db):
        """RCA 2026-08-17: /webhooks/aircall never called sse_broker.publish at
        all (only /webhooks/messenger did) — an Aircall call never reached
        the browser in real time. Now publishes CALL_STATUS with the same
        caller-ID fields handle_webhook returns."""
        client = _make_dialer_app(db)
        sdr = create_test_user(db, email="sse-sdr@t.com", role="SDR")

        fake_result = {
            "ok": True, "call_id": "dc-1", "user_id": sdr.id, "status": "CALL_STARTED",
            "duration": None, "direction": "inbound",
            "lead_name": "Priya Sharma", "lead_company": "Acme Corp",
        }
        with patch("routes.dialer_routes.dialer_service.handle_webhook", return_value=fake_result), \
             patch("routes.dialer_routes.sse_broker.publish") as mock_publish:
            resp = client.post("/api/webhooks/aircall", json={"event": "call.created", "data": {}})

        assert resp.status_code == 200
        mock_publish.assert_called_once()
        published_user_id, published_payload = mock_publish.call_args[0]
        assert published_user_id == sdr.id
        assert published_payload["lead_name"] == "Priya Sharma"
        assert published_payload["lead_company"] == "Acme Corp"
        assert published_payload["direction"] == "inbound"

    def test_aircall_webhook_endpoint_skips_publish_without_user(self, db):
        """No resolvable user_id (e.g. call from an unknown SDR) — nothing to
        publish to, and sse_broker.publish must not be called with None."""
        client = _make_dialer_app(db)
        fake_result = {"ok": True, "call_id": "dc-2", "user_id": None, "status": "CALL_STARTED"}
        with patch("routes.dialer_routes.dialer_service.handle_webhook", return_value=fake_result), \
             patch("routes.dialer_routes.sse_broker.publish") as mock_publish:
            resp = client.post("/api/webhooks/aircall", json={"event": "call.created", "data": {}})

        assert resp.status_code == 200
        mock_publish.assert_not_called()


class TestPhoneMatchThrottle:
    """RCA 2026-09-03 (pre-prod review): the frontend polls GET
    /calls/{id}/status every 10s for up to 10 minutes, and the phone-match
    self-heal fired on EVERY poll for any Aircall call with an empty
    provider_call_id — up to 60 extra Aircall GET /calls per call. In prod
    762 of 7,122 Aircall calls (10.7%) are in that state and Aircall's ceiling
    is 60 requests/min for the entire company, so unbounded this could throttle
    dialling for all 23 SDRs — the very symptom the self-heal exists to fix.
    Invisible on staging, where one caller never approaches the limit."""

    def setup_method(self):
        from routes.dialer_routes import _phone_match_last_attempt
        _phone_match_last_attempt.clear()

    def test_young_call_is_not_looked_up_at_all(self, db):
        """The webhook wins this race almost always — a typical call is ~20s
        end to end. Spending an Aircall request before giving it a chance is
        pure waste, multiplied by every 10s poll."""
        from routes.dialer_routes import _should_try_phone_match
        assert _should_try_phone_match("call-young", 10) is False
        assert _should_try_phone_match("call-young", 44) is False

    def test_first_attempt_allowed_once_past_the_grace_period(self, db):
        from routes.dialer_routes import _should_try_phone_match
        assert _should_try_phone_match("call-old", 46) is True

    def test_subsequent_polls_within_the_cooldown_are_suppressed(self, db):
        """Six polls a minute must not become six Aircall requests a minute."""
        from routes.dialer_routes import _should_try_phone_match
        assert _should_try_phone_match("call-x", 60) is True
        for _ in range(6):
            assert _should_try_phone_match("call-x", 70) is False

    def test_a_new_attempt_is_allowed_once_the_cooldown_elapses(self, db):
        import routes.dialer_routes as dr
        assert dr._should_try_phone_match("call-y", 60) is True
        assert dr._should_try_phone_match("call-y", 70) is False
        # Age the bookkeeping past the cooldown rather than sleeping.
        dr._phone_match_last_attempt["call-y"] -= (dr._PHONE_MATCH_COOLDOWN_S + 1)
        assert dr._should_try_phone_match("call-y", 130) is True

    def test_calls_are_throttled_independently(self, db):
        from routes.dialer_routes import _should_try_phone_match
        assert _should_try_phone_match("call-a", 60) is True
        assert _should_try_phone_match("call-b", 60) is True, "one call must not throttle another"

    def test_bookkeeping_does_not_grow_without_bound(self, db):
        import routes.dialer_routes as dr
        for i in range(600):
            dr._should_try_phone_match(f"stale-{i}", 60)
        # Age everything, then one more call triggers the prune.
        for k in list(dr._phone_match_last_attempt):
            dr._phone_match_last_attempt[k] -= 1000
        dr._should_try_phone_match("fresh", 60)
        assert len(dr._phone_match_last_attempt) < 600, "old entries must be pruned"

    def test_status_poll_does_not_hit_aircall_for_a_fresh_call(self, db):
        """Route-level: a call only seconds old must not trigger a lookup."""
        from datetime import datetime, timezone, timedelta
        import models

        client = _make_dialer_app(db)
        owner = db.query(models.User).filter(models.User.id == "test-user-id").first()
        if not owner:
            owner = models.User(id="test-user-id", email="admin@test.com", role="Super Admin")
            db.add(owner)
            db.commit()
        call = models.DialerCall(
            user_id="test-user-id", provider="aircall", provider_call_id="",
            phone_number="1-800-263-3394", status="CALL_STARTED", direction="outbound",
            started_at=datetime.now(timezone.utc) - timedelta(seconds=5),
        )
        db.add(call)
        db.commit()
        db.refresh(call)

        mock_provider = MagicMock()
        mock_provider.provider_name = "aircall"
        mock_provider.find_recent_call_by_phone = MagicMock(
            return_value={"id": "should-not-be-used", "ended": True, "duration": 1}
        )
        with patch("routes.dialer_routes.dialer_service.get_provider_for_user",
                   return_value=mock_provider):
            resp = client.get(f"/api/calls/{call.id}/status")

        assert resp.status_code == 200
        mock_provider.find_recent_call_by_phone.assert_not_called()
        assert resp.json()["status"] == "CALL_STARTED"


class TestPhoneMatchIdCollision:
    """RCA 2026-09-08 (live prod: 17 unhandled 500s on POST /api/calls/start
    across 4 bursts, first on 2026-09-04 — all with the identical failing
    UPDATE and the same idx_dialer_calls_dedup violation).

    801 prod phone numbers are shared by more than one lead — usually the
    same line stored once bare ("+1 845-770-1949") and once with an
    extension ("(845) 770-1949 ext. 6807"). Aircall's call log is keyed on
    the number, so find_recent_call_by_phone can only answer "the recent
    call to this number by this SDR" — which may be the call already
    recorded against the *other* lead's DialerCall row. Both phone-match
    sites then wrote that id blind, tripping idx_dialer_calls_dedup.

    The prod chain, reproduced below against the real index: the heal's
    flush raises UniqueViolation → the `except` logged it without a
    db.rollback() → the session stayed in a failed-flush state → the
    request's next write (dialer_routes' log_error for the "already have an
    active call" result) raised PendingRollbackError → GlobalHandler 500.
    Meanwhile the stuck row never healed, so the SDR stayed blocked for the
    full EC-16 window (6 minutes, measured on prod row 55e4bd01).
    """

    def _setup(self, db):
        """Aircall settings + the real partial unique index. Verbatim from
        migrations.py's index_creates — without it these tests would assert
        against a DB that cannot produce the failure at all (the engine
        fixture builds a fresh in-memory DB per test, so this is local)."""
        from sqlalchemy import text
        from conftest import create_sync_settings
        s = create_sync_settings(db)
        s.dialer_provider = "aircall"
        db.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_calls_dedup "
            "ON dialer_calls (provider, provider_call_id) "
            "WHERE provider_call_id IS NOT NULL AND provider_call_id != ''"
        ))
        db.commit()

    @staticmethod
    def _aircall_mock(returns):
        aircall = MagicMock()
        aircall.find_recent_call_by_phone = MagicMock(return_value=returns)
        return aircall

    def test_heal_skips_an_id_another_row_already_owns_and_still_unblocks(self, db):
        """The exact prod shape (rows 9bf08b51 / 4c65a098). Healing must not
        write the contended id, must not fabricate that other call's
        duration onto this row, and must still clear the SDR's blocked slot
        — the whole point of the self-heal."""
        import models, dialer_service
        from datetime import datetime, timezone

        self._setup(db)
        user = create_test_user(db, email="collide@test.com", role="SDR")
        user.dialer_enabled = True
        ext_lead  = create_test_lead(db, email="collide_ext@test.com")
        bare_lead = create_test_lead(db, email="collide_bare@test.com")
        db.commit()

        # The row the SDR is blocked behind: bridge dial, no id ever returned.
        stuck = models.DialerCall(
            lead_id=ext_lead.id, user_id=user.id, provider="aircall",
            provider_call_id="", phone_number="(845) 770-1949 ext. 6807",
            status="CALL_STARTED", direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        # The same underlying number reached via a second lead — this row
        # already owns the Aircall call the phone-match will return.
        owner_row = models.DialerCall(
            lead_id=bare_lead.id, user_id=user.id, provider="aircall",
            provider_call_id="4124255981", phone_number="+1 845-770-1949",
            status="CALL_ENDED", direction="outbound",
            started_at=datetime.now(timezone.utc), duration=11,
        )
        db.add_all([stuck, owner_row])
        db.commit()

        _result = MagicMock(success=True, provider_call_id="ac-new-001", error=None)
        for attr in ("livekit_token", "livekit_url", "room_name", "agent_join_via_phone"):
            setattr(_result, attr, None)
        provider = MagicMock()
        provider.provider_name = "aircall"
        provider.initiate_call = MagicMock(return_value=_result)
        # id arrives as an int from Aircall's JSON — must still be compared
        # against the String column as text, or the claim check misses.
        aircall = self._aircall_mock({"id": 4124255981, "ended": True, "duration": 11})

        with patch.object(dialer_service, "get_provider_for_user", return_value=provider), \
             patch.object(dialer_service, "get_provider_by_name", return_value=aircall):
            result = dialer_service.initiate_call(
                db, {"sub": user.id, "email": user.email, "role": "SDR"},
                ext_lead.id, "(845) 770-1949 ext. 6807", call_mode="browser",
            )

        assert result["success"] is True, (
            f"SDR left blocked behind an un-healable row — the prod symptom. "
            f"Got: {result.get('error')!r}"
        )
        db.refresh(stuck)
        assert stuck.status == "CALL_ENDED"
        assert stuck.provider_call_id == "", (
            f"Wrote a provider_call_id another row already owns "
            f"({stuck.provider_call_id!r}) — the UniqueViolation on "
            f"idx_dialer_calls_dedup that took prod down."
        )
        assert stuck.duration is None, (
            f"Copied the other call's duration ({stuck.duration}) onto a call "
            f"we never actually identified — fabricated data."
        )
        db.refresh(owner_row)
        assert owner_row.provider_call_id == "4124255981"
        assert owner_row.duration == 11

    def test_calls_start_returns_handled_422_not_an_unhandled_500(self, db):
        """The reported symptom, end to end. Even when the heal genuinely
        cannot record the id, the route must still reach its own log_error +
        HTTPException — pre-fix the swallowed IntegrityError poisoned the
        session and log_error raised PendingRollbackError instead."""
        import models, dialer_service
        from datetime import datetime, timezone
        from conftest import SUPER_ADMIN

        self._setup(db)
        client = _make_dialer_app(db)
        if not db.query(models.User).filter(models.User.id == SUPER_ADMIN["sub"]).first():
            db.add(models.User(id=SUPER_ADMIN["sub"], email=SUPER_ADMIN["email"],
                               role="Super Admin"))
        ext_lead  = create_test_lead(db, email="e2e_ext@test.com")
        bare_lead = create_test_lead(db, email="e2e_bare@test.com")
        db.commit()

        stuck = models.DialerCall(
            lead_id=ext_lead.id, user_id=SUPER_ADMIN["sub"], provider="aircall",
            provider_call_id="", phone_number="(408) 364-6799 ext. 6688",
            status="CALL_STARTED", direction="outbound",
            started_at=datetime.now(timezone.utc),
        )
        owner_row = models.DialerCall(
            lead_id=bare_lead.id, user_id=SUPER_ADMIN["sub"], provider="aircall",
            provider_call_id="4124296516", phone_number="+1 408-364-6799",
            status="CALL_ENDED", direction="outbound",
            started_at=datetime.now(timezone.utc), duration=93,
        )
        db.add_all([stuck, owner_row])
        db.commit()

        provider = MagicMock()
        provider.provider_name = "aircall"
        # Provider-side failure so the route takes its log_error path — the
        # DB write that surfaced the poisoned session as a 500 in prod.
        provider.initiate_call = MagicMock(return_value=MagicMock(
            success=False, provider_call_id=None, error="Aircall unavailable",
            livekit_token=None, livekit_url=None, room_name=None,
            agent_join_via_phone=None,
        ))
        aircall = self._aircall_mock({"id": "4124296516", "ended": True, "duration": 93})

        with patch.object(dialer_service, "get_provider_for_user", return_value=provider), \
             patch.object(dialer_service, "get_provider_by_name", return_value=aircall):
            resp = client.post("/api/calls/start", json={
                "lead_id": ext_lead.id, "phone_number": "(408) 364-6799 ext. 6688",
            })

        assert resp.status_code == 422, (
            f"Expected the handled 422, got {resp.status_code}. Pre-fix this "
            f"request died inside log_error with PendingRollbackError — the "
            f"opaque 500 prod actually served."
        )
        # The error log itself must have landed, on a session that survived.
        assert db.query(models.ErrorLog).filter(
            models.ErrorLog.endpoint == "/api/calls/start"
        ).count() >= 1, "log_error never committed — the session was still poisoned."
