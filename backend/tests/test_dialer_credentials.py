"""
test_dialer_credentials.py — V28 Credential Resolution & Caller ID Tests
=========================================================================
Tests covering:
  - _resolve_dialer_credentials: shared vs separate mode, base_url resolution
  - from_number fallback chain: SDR personal → global → omit
  - /dialer/my-phone GET and PATCH endpoints
  - initiate_call from_number override logic
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch, MagicMock, PropertyMock
from conftest import create_test_user, create_test_lead

import models


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_settings(**kwargs):
    """Create a mock SyncSettings object with given fields."""
    settings = MagicMock(spec=models.SyncSettings)
    defaults = {
        'rcm_base_url': 'https://app.bercm.com',
        'rcm_api_key': 'shared-key',
        'rcm_user_id': '300956',
        'rcm_from_number': None,
        'dialer_provider': 'rcm',
        'dialer_use_shared_creds': True,
        'dialer_base_url': None,
        'dialer_api_key': None,
        'dialer_user_id': None,
    }
    defaults.update(kwargs)
    for k, v in defaults.items():
        setattr(settings, k, v)
    return settings


def _make_dialer_app(db):
    """Build a minimal FastAPI app including the dialer router."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from database import get_db
    from auth import get_current_user
    from routes.dialer_routes import router as dialer_router
    from conftest import SUPER_ADMIN

    app = FastAPI()
    app.include_router(dialer_router)

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SUPER_ADMIN

    return TestClient(app)


# ── _resolve_dialer_credentials ──────────────────────────────────────────────

class TestResolveDialerCredentials:
    """Test _resolve_dialer_credentials from dialer_service."""

    def test_shared_mode_uses_messaging_credentials(self):
        """When dialer_use_shared_creds=True, uses Conversations tab credentials."""
        from dialer_service import _resolve_dialer_credentials
        settings = _make_settings(
            dialer_use_shared_creds=True,
            rcm_base_url='https://app.bercm.com',
            rcm_api_key='shared-key',
            rcm_user_id='300956',
        )
        base_url, api_key, user_id = _resolve_dialer_credentials(settings)
        assert base_url == 'https://app.bercm.com'
        assert api_key == 'shared-key'
        assert user_id == '300956'

    def test_shared_mode_fallback_to_default_url(self):
        """When rcm_base_url is empty, falls back to default."""
        from dialer_service import _resolve_dialer_credentials
        settings = _make_settings(
            dialer_use_shared_creds=True,
            rcm_base_url=None,
        )
        base_url, _, _ = _resolve_dialer_credentials(settings)
        assert base_url == 'https://app.bercm.com'

    @patch('crypto.decrypt_token', return_value='decrypted-key')
    def test_separate_mode_uses_own_credentials(self, mock_decrypt):
        """When dialer_use_shared_creds=False, uses separate dialer credentials."""
        from dialer_service import _resolve_dialer_credentials
        settings = _make_settings(
            dialer_use_shared_creds=False,
            dialer_base_url='https://qa-app.bercm.com',
            dialer_api_key='encrypted-key',
            dialer_user_id='1128097',
        )
        base_url, api_key, user_id = _resolve_dialer_credentials(settings)
        assert base_url == 'https://qa-app.bercm.com'
        assert api_key == 'decrypted-key'
        assert user_id == '1128097'

    @patch('crypto.decrypt_token', return_value='decrypted-key')
    def test_separate_mode_falls_back_to_messaging_url(self, mock_decrypt):
        """When dialer_base_url is None in separate mode, falls back to rcm_base_url."""
        from dialer_service import _resolve_dialer_credentials
        settings = _make_settings(
            dialer_use_shared_creds=False,
            dialer_base_url=None,
            dialer_api_key='encrypted-key',
            dialer_user_id='1128097',
            rcm_base_url='https://main.bercm.com',
        )
        base_url, _, _ = _resolve_dialer_credentials(settings)
        assert base_url == 'https://main.bercm.com'

    @patch('crypto.decrypt_token', side_effect=Exception('decrypt failed'))
    def test_separate_mode_decryption_failure(self, mock_decrypt):
        """When API key decryption fails, returns empty api_key."""
        from dialer_service import _resolve_dialer_credentials
        settings = _make_settings(
            dialer_use_shared_creds=False,
            dialer_api_key='bad-encrypted-key',
            dialer_user_id='1128097',
        )
        _, api_key, _ = _resolve_dialer_credentials(settings)
        assert api_key == ''

    def test_separate_mode_no_credentials_returns_empty(self):
        """When separate mode but no dialer credentials set."""
        from dialer_service import _resolve_dialer_credentials
        settings = _make_settings(
            dialer_use_shared_creds=False,
            dialer_api_key=None,
            dialer_user_id=None,
        )
        _, api_key, user_id = _resolve_dialer_credentials(settings)
        assert api_key == ''
        assert user_id == ''


# ── from_number Fallback Chain ────────────────────────────────────────────────

class TestFromNumberFallback:
    """Test that from_number resolution follows: SDR personal → global → omit."""

    @patch('dialer_service.RCMDialerProvider')
    @patch('dialer_service._resolve_dialer_credentials')
    @patch('dialer_service._get_settings')
    def test_sdr_number_overrides_global(self, mock_settings, mock_resolve, mock_provider_cls, db):
        """SDR's personal number should override the global default."""
        from dialer_service import initiate_call

        settings = _make_settings(rcm_from_number='+1_GLOBAL')
        mock_settings.return_value = settings
        mock_resolve.return_value = ('https://app.bercm.com', 'key', 'uid')

        # Create a mock provider with proper return values
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.provider_call_id = 'call-123'
        mock_result.livekit_token = None
        mock_result.livekit_url = None
        mock_result.room_name = None
        mock_result.error = None
        mock_result.agent_join_via_phone = False
        mock_result.provider = 'rcm'

        mock_provider = MagicMock()
        mock_provider.from_number = '+1_GLOBAL'
        mock_provider.provider_name = 'rcm'
        mock_provider.initiate_call.return_value = mock_result
        mock_provider_cls.return_value = mock_provider

        user_obj = create_test_user(db, email="sdr-test@example.com")
        user_obj.rcm_from_number = '+1_SDR_PERSONAL'
        db.commit()

        lead = create_test_lead(db)

        user_dict = {"sub": user_obj.id, "email": user_obj.email, "role": "sdr"}

        with patch('dialer_service.get_provider_for_user', return_value=mock_provider):
            initiate_call(db, user_dict, str(lead.id), '+919876543210')

        # The provider's from_number should have been overridden to SDR's number
        assert mock_provider.from_number == '+1_SDR_PERSONAL'

    @patch('dialer_service.RCMDialerProvider')
    @patch('dialer_service._resolve_dialer_credentials')
    @patch('dialer_service._get_settings')
    def test_global_number_used_when_sdr_not_set(self, mock_settings, mock_resolve, mock_provider_cls, db):
        """When SDR hasn't set a number, global default is used."""
        from dialer_service import initiate_call

        settings = _make_settings(rcm_from_number='+1_GLOBAL')
        mock_settings.return_value = settings
        mock_resolve.return_value = ('https://app.bercm.com', 'key', 'uid')

        mock_result = MagicMock()
        mock_result.success = True
        mock_result.provider_call_id = 'call-456'
        mock_result.livekit_token = None
        mock_result.livekit_url = None
        mock_result.room_name = None
        mock_result.error = None
        mock_result.agent_join_via_phone = False
        mock_result.provider = 'rcm'

        mock_provider = MagicMock()
        mock_provider.from_number = '+1_GLOBAL'
        mock_provider.provider_name = 'rcm'
        mock_provider.initiate_call.return_value = mock_result
        mock_provider_cls.return_value = mock_provider

        user_obj = create_test_user(db, email="sdr-nonum@example.com")
        user_obj.rcm_from_number = None
        db.commit()

        lead = create_test_lead(db, email="nonum@lead.com")
        user_dict = {"sub": user_obj.id, "email": user_obj.email, "role": "sdr"}

        with patch('dialer_service.get_provider_for_user', return_value=mock_provider):
            initiate_call(db, user_dict, str(lead.id), '+919876543210')

        # Global number should remain
        assert mock_provider.from_number == '+1_GLOBAL'

    @patch('dialer_service.RCMDialerProvider')
    @patch('dialer_service._resolve_dialer_credentials')
    @patch('dialer_service._get_settings')
    def test_no_number_at_all(self, mock_settings, mock_resolve, mock_provider_cls, db):
        """When neither SDR nor global number is set, from_number stays empty."""
        from dialer_service import initiate_call

        settings = _make_settings(rcm_from_number=None)
        mock_settings.return_value = settings
        mock_resolve.return_value = ('https://app.bercm.com', 'key', 'uid')

        mock_result = MagicMock()
        mock_result.success = True
        mock_result.provider_call_id = 'call-789'
        mock_result.livekit_token = None
        mock_result.livekit_url = None
        mock_result.room_name = None
        mock_result.error = None
        mock_result.agent_join_via_phone = False
        mock_result.provider = 'rcm'

        mock_provider = MagicMock()
        mock_provider.from_number = ''  # No global number
        mock_provider.provider_name = 'rcm'
        mock_provider.initiate_call.return_value = mock_result
        mock_provider_cls.return_value = mock_provider

        user_obj = create_test_user(db, email="sdr-empty@example.com")
        db.commit()

        lead = create_test_lead(db, email="empty@lead.com")
        user_dict = {"sub": user_obj.id, "email": user_obj.email, "role": "sdr"}

        with patch('dialer_service.get_provider_for_user', return_value=mock_provider):
            initiate_call(db, user_dict, str(lead.id), '+919876543210')

        # from_number stays empty
        assert mock_provider.from_number == ''


# ── RCM Provider from_number in Payload ────────────────────────────────

class TestProviderPayloadFromNumber:
    """Test that the provider only includes from_number in API payload when set."""

    @patch('rcm_provider.RCMAuthManager.get_token', return_value='test-jwt')
    @patch('rcm_provider.urllib.request.urlopen')
    def test_from_number_included_when_set(self, mock_urlopen, mock_token):
        """When from_number is set, it should be in the payload."""
        import json
        from rcm_provider import RCMDialerProvider

        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"call_id": "C1"}).encode()
        mock_resp.status = 200
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        provider = RCMDialerProvider(
            base_url="https://test.com", api_key="k", user_id="1",
            from_number="+14155551234",
        )
        provider.initiate_call("+919876543210", "sdr@test.com", "lead-1")

        # Inspect the request body
        call_args = mock_urlopen.call_args
        request_obj = call_args[0][0]
        body = json.loads(request_obj.data.decode())
        assert "from_number" in body
        assert body["from_number"] == "+14155551234"  # verbatim pass-through (v9.5.1): only whitespace/parens/dashes stripped


    @patch('rcm_provider.RCMAuthManager.get_token', return_value='test-jwt')
    def test_from_number_empty_returns_error(self, mock_token):
        """When from_number is empty, initiate_call should fail with a clear error."""
        from rcm_provider import RCMDialerProvider

        provider = RCMDialerProvider(
            base_url="https://test.com", api_key="k", user_id="1",
            from_number="",
        )
        result = provider.initiate_call("+919876543210", "sdr@test.com", "lead-1", use_agent_phone=True)

        assert result.success is False
        assert "caller id" in result.error.lower() or "from_number" in result.error.lower()


# ── /dialer/my-phone Endpoints ───────────────────────────────────────────────

class TestMyPhoneEndpoints:
    """Test GET and PATCH /api/dialer/my-phone."""

    def _make_app_with_user(self, db):
        """Build app with a real user in the DB for my-phone endpoints."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user
        from routes.dialer_routes import router as dialer_router

        # Create a user in DB
        user_obj = create_test_user(db, email="myphone-user@test.com")
        user_dict = {"sub": user_obj.id, "email": user_obj.email, "role": "SDR"}

        app = FastAPI()
        app.include_router(dialer_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: user_dict

        return TestClient(app), user_obj

    def test_get_my_phone_returns_empty_initially(self, db):
        """GET /dialer/my-phone returns empty when user hasn't set a number."""
        client, _ = self._make_app_with_user(db)
        resp = client.get("/api/dialer/my-phone")
        assert resp.status_code == 200
        data = resp.json()
        assert data["phone_number"] == ""

    def test_patch_my_phone_saves_number(self, db):
        """PATCH /dialer/my-phone saves the phone number."""
        client, _ = self._make_app_with_user(db)
        resp = client.patch(
            "/api/dialer/my-phone",
            json={"phone_number": "+919876543210"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "updated" in data.get("message", "").lower()

    def test_patch_then_get_returns_saved_number(self, db):
        """After PATCH, GET should return the saved number."""
        client, _ = self._make_app_with_user(db)
        client.patch("/api/dialer/my-phone", json={"phone_number": "+14155559999"})
        resp = client.get("/api/dialer/my-phone")
        assert resp.status_code == 200
        assert resp.json()["phone_number"] == "+14155559999"

    def test_patch_clear_number(self, db):
        """PATCH with empty string should clear the number."""
        client, _ = self._make_app_with_user(db)
        # Set first
        client.patch("/api/dialer/my-phone", json={"phone_number": "+14155559999"})
        # Clear
        resp = client.patch("/api/dialer/my-phone", json={"phone_number": ""})
        assert resp.status_code == 200
        # Verify cleared
        resp = client.get("/api/dialer/my-phone")
        assert resp.json()["phone_number"] == ""


# ── Dialer Config (get/save) ─────────────────────────────────────────────────

class TestDialerConfig:
    """Test get_dialer_config and save_dialer_config include new fields."""

    def test_get_config_includes_from_number(self, db):
        """get_dialer_config should include from_number field."""
        from dialer_service import get_dialer_config
        config = get_dialer_config(db)
        assert "from_number" in config

    def test_get_config_includes_base_url(self, db):
        """get_dialer_config should include dialer_base_url field."""
        from dialer_service import get_dialer_config
        config = get_dialer_config(db)
        assert "dialer_base_url" in config

    def test_save_config_saves_from_number(self, db):
        """save_dialer_config should save from_number."""
        from dialer_service import save_dialer_config, get_dialer_config
        save_dialer_config(db, {"from_number": "+14155551234"})
        config = get_dialer_config(db)
        assert config["from_number"] == "+14155551234"

    def test_save_config_saves_base_url(self, db):
        """save_dialer_config should save dialer_base_url."""
        from dialer_service import save_dialer_config, get_dialer_config
        save_dialer_config(db, {"dialer_base_url": "https://qa-app.bercm.com"})
        config = get_dialer_config(db)
        assert config["dialer_base_url"] == "https://qa-app.bercm.com"

    def test_save_config_clears_from_number(self, db):
        """save_dialer_config should clear from_number when empty string."""
        from dialer_service import save_dialer_config, get_dialer_config
        save_dialer_config(db, {"from_number": "+14155551234"})
        save_dialer_config(db, {"from_number": ""})
        config = get_dialer_config(db)
        assert config["from_number"] == ""
