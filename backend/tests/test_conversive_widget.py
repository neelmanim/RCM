"""
TDD Test Suite — RCM Floating Widget
Written BEFORE production code. All tests start RED and are made GREEN
during implementation per AGENT_PROTOCOL.md § Rule 1.

Sections:
  1. SyncSettings model — widget fields (V33)
  2. GET /api/admin/sync-settings — exposes widget fields
  3. FAB gate — widget_enabled false by default
  4. PATCH /api/admin/sync-settings — persists widget fields
  5. rcm_sms_service — send_sms() unit tests
  6. POST /api/sms/send — route tests
  7. POST /api/webhooks/rcm-sms — delivery + incoming webhook
  8. Frontend static assets reachable
"""
import json
import os
import uuid
from unittest.mock import patch, MagicMock

import pytest


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: SyncSettings model — widget fields (V33 migration)
# ═══════════════════════════════════════════════════════════════════════════════

class TestSyncSettingsWidgetFields:
    """V33 adds widget_* columns to the single-row SyncSettings table."""

    def _get_or_create_settings(self, db):
        import models
        s = db.query(models.SyncSettings).first()
        if not s:
            s = models.SyncSettings(id=1)
            db.add(s)
            db.commit()
            db.refresh(s)
        return s

    def test_widget_enabled_field_exists(self, db):
        s = self._get_or_create_settings(db)
        assert hasattr(s, "widget_enabled"), "widget_enabled column missing from SyncSettings"

    def test_widget_enabled_defaults_false(self, db):
        s = self._get_or_create_settings(db)
        assert s.widget_enabled is False

    def test_widget_position_field_exists(self, db):
        s = self._get_or_create_settings(db)
        assert hasattr(s, "widget_position")

    def test_widget_position_defaults_bottom_right(self, db):
        s = self._get_or_create_settings(db)
        assert s.widget_position == "bottom-right"

    def test_widget_theme_defaults_dark(self, db):
        s = self._get_or_create_settings(db)
        assert s.widget_theme == "dark"

    def test_widget_allowed_domains_defaults_empty(self, db):
        s = self._get_or_create_settings(db)
        val = s.widget_allowed_domains
        assert val is None or val == "[]" or val == []

    def test_widget_enabled_can_be_set_true(self, db):
        import models
        s = models.SyncSettings(id=1)
        s.widget_enabled = True
        db.add(s)
        db.commit()
        db.refresh(s)
        assert s.widget_enabled is True

    def test_widget_allowed_domains_stores_json_string(self, db):
        import models
        s = models.SyncSettings(id=1)
        s.widget_allowed_domains = json.dumps(["example.com", "crm.acme.io"])
        db.add(s)
        db.commit()
        db.refresh(s)
        parsed = json.loads(s.widget_allowed_domains)
        assert "example.com" in parsed


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: GET /api/admin/sync-settings includes widget fields
# ═══════════════════════════════════════════════════════════════════════════════

class TestSyncSettingsEndpoint:
    """sync-settings must expose widget config to the frontend FAB gate."""

    def test_widget_enabled_in_response(self, client):
        resp = client.get("/api/admin/sync-settings")
        assert resp.status_code == 200
        assert "widget_enabled" in resp.json()

    def test_widget_enabled_is_bool(self, client):
        resp = client.get("/api/admin/sync-settings")
        assert isinstance(resp.json()["widget_enabled"], bool)

    def test_widget_position_in_response(self, client):
        resp = client.get("/api/admin/sync-settings")
        assert "widget_position" in resp.json()

    def test_widget_theme_in_response(self, client):
        resp = client.get("/api/admin/sync-settings")
        assert "widget_theme" in resp.json()


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: FAB gate — widget hidden by default
# ═══════════════════════════════════════════════════════════════════════════════

class TestFABGate:

    def test_widget_enabled_false_by_default(self, client):
        resp = client.get("/api/admin/sync-settings")
        assert resp.json()["widget_enabled"] is False

    def test_fab_gate_rcm_disabled_implies_widget_off(self, db, client):
        import models
        s = db.query(models.SyncSettings).first()
        if not s:
            s = models.SyncSettings(id=1)
            db.add(s)
            db.commit()
        s.rcm_enabled = False
        s.widget_enabled = False
        db.commit()

        resp = client.get("/api/admin/sync-settings")
        data = resp.json()
        assert data.get("rcm_enabled") is False or data.get("widget_enabled") is False


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: PATCH /api/admin/sync-settings — persists widget fields
# ═══════════════════════════════════════════════════════════════════════════════

class TestPatchWidgetSettings:

    def test_patch_widget_enabled_true_returns_200(self, client):
        resp = client.patch("/api/admin/sync-settings", json={"widget_enabled": True})
        assert resp.status_code == 200

    def test_patch_widget_position_returns_200(self, client):
        resp = client.patch("/api/admin/sync-settings", json={"widget_position": "bottom-left"})
        assert resp.status_code == 200

    def test_patch_widget_theme_returns_200(self, client):
        resp = client.patch("/api/admin/sync-settings", json={"widget_theme": "light"})
        assert resp.status_code == 200

    def test_patch_widget_allowed_domains_returns_200(self, client):
        resp = client.patch("/api/admin/sync-settings",
                            json={"widget_allowed_domains": ["acme.com"]})
        assert resp.status_code == 200

    def test_patch_widget_enabled_persists(self, client):
        client.patch("/api/admin/sync-settings", json={"widget_enabled": True})
        resp = client.get("/api/admin/sync-settings")
        assert resp.json()["widget_enabled"] is True

    def test_patch_widget_position_persists(self, client):
        client.patch("/api/admin/sync-settings", json={"widget_position": "bottom-left"})
        resp = client.get("/api/admin/sync-settings")
        assert resp.json()["widget_position"] == "bottom-left"

    def test_patch_non_admin_rejected(self, client_as_sdr):
        resp = client_as_sdr.patch("/api/admin/sync-settings",
                                    json={"widget_enabled": True})
        assert resp.status_code in (401, 403)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: rcm_sms_service — send_sms() unit tests
# ═══════════════════════════════════════════════════════════════════════════════

def _mock_sms_response(body: dict):
    mock = MagicMock()
    mock.__enter__ = lambda s: s
    mock.__exit__ = MagicMock(return_value=False)
    mock.read.return_value = json.dumps(body).encode()
    mock.status = 200
    return mock


class TestRCMSmsService:

    def test_calls_correct_base_url(self):
        import rcm_sms_service as svc
        with patch("rcm_sms_service.urllib.request.urlopen") as mock_open:
            mock_open.return_value = _mock_sms_response(
                {"response": {"vstatus": "success", "responseText": "ok"}}
            )
            svc.send_sms("key", "+11111111111", "+12222222222", "Hello")
            req = mock_open.call_args[0][0]
            assert "api.bercm.com" in req.full_url
            assert "/api/v2/message/send" in req.full_url

    def test_payload_structure(self):
        import rcm_sms_service as svc
        with patch("rcm_sms_service.urllib.request.urlopen") as mock_open:
            mock_open.return_value = _mock_sms_response(
                {"response": {"vstatus": "success", "responseText": "ok"}}
            )
            svc.send_sms("mykey", "+11111111111", "+12222222222", "Test msg")
            body = json.loads(mock_open.call_args[0][0].data.decode())

        assert body["userPayload"]["type"] == "api"
        assert body["userPayload"]["apiKey"] == "mykey"
        d = body["messageDetails"][0]
        assert d["source"] == "8001"
        assert d["sender"]["channelType"] == "SMS"
        assert d["recipient"][0]["phone"] == "+12222222222"
        assert d["recipient"][0]["channelType"] == "SMS"
        assert d["message"]["type"] == "text"
        assert "Test msg" in d["message"]["content"]["messageText"]

    def test_message_id_prefixed_rcm(self):
        import rcm_sms_service as svc
        with patch("rcm_sms_service.urllib.request.urlopen") as mock_open:
            mock_open.return_value = _mock_sms_response(
                {"response": {"vstatus": "success", "responseText": "ok"}}
            )
            svc.send_sms("k", "+1", "+2", "hi")
            body = json.loads(mock_open.call_args[0][0].data.decode())
        assert body["messageDetails"][0]["messageId"].startswith("rcm-")

    def test_returns_success_dict(self):
        import rcm_sms_service as svc
        with patch("rcm_sms_service.urllib.request.urlopen") as mock_open:
            mock_open.return_value = _mock_sms_response(
                {"response": {"vstatus": "success", "responseText": "ok"}}
            )
            result = svc.send_sms("k", "+1", "+2", "hi")
        assert result["success"] is True
        assert "message_id" in result

    def test_returns_error_dict_on_forbidden(self):
        import rcm_sms_service as svc
        with patch("rcm_sms_service.urllib.request.urlopen") as mock_open:
            mock_open.return_value = _mock_sms_response(
                {"response": {"vstatus": "failed", "responseText": "FORBIDDEN-API-KEY"}}
            )
            result = svc.send_sms("bad-key", "+1", "+2", "hi")
        assert result["success"] is False
        assert "error" in result

    def test_network_error_handled_gracefully(self):
        import rcm_sms_service as svc
        import urllib.error
        with patch("rcm_sms_service.urllib.request.urlopen",
                   side_effect=urllib.error.URLError("timeout")):
            result = svc.send_sms("k", "+1", "+2", "hi")
        assert result["success"] is False
        assert "error" in result

    def test_http_500_handled_gracefully(self):
        import rcm_sms_service as svc
        import urllib.error
        with patch("rcm_sms_service.urllib.request.urlopen",
                   side_effect=urllib.error.HTTPError("", 500, "Server Error", {}, None)):
            result = svc.send_sms("k", "+1", "+2", "hi")
        assert result["success"] is False


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: POST /api/sms/send — route tests
# ═══════════════════════════════════════════════════════════════════════════════

_SMS_OK   = {"success": True,  "message_id": "rcm-abc-123"}
_SMS_FAIL = {"success": False, "error": "FORBIDDEN-API-KEY"}


class TestSmsRoutes:

    def test_requires_auth(self, db):
        """Unauthenticated client should get 401."""
        from fastapi.testclient import TestClient
        from conftest import _build_test_app
        from database import get_db

        app = _build_test_app()
        def _override_db():
            yield db
        app.dependency_overrides[get_db] = _override_db

        anon = TestClient(app, raise_server_exceptions=False)
        resp = anon.post("/api/sms/send", json={"lead_id": 1, "message": "hi"})
        assert resp.status_code == 401

    def test_requires_lead_id(self, client):
        resp = client.post("/api/sms/send", json={"message": "hi"})
        assert resp.status_code == 422

    def test_requires_message(self, client):
        resp = client.post("/api/sms/send", json={"lead_id": 1})
        assert resp.status_code == 422

    def test_success_returns_200_and_message_id(self, db, client):
        from conftest import create_test_lead
        lead = create_test_lead(db, email="sms-ok@test.com", phone="+919876543210")

        with patch("routes.sms_routes.sms_service.send_sms", return_value=_SMS_OK):
            resp = client.post("/api/sms/send",
                               json={"lead_id": lead.id, "message": "Hello"})

        assert resp.status_code == 200
        assert resp.json()["success"] is True
        assert "message_id" in resp.json()

    def test_send_failure_returns_400(self, db, client):
        from conftest import create_test_lead
        lead = create_test_lead(db, email="sms-fail@test.com", phone="+919876543210")

        with patch("routes.sms_routes.sms_service.send_sms", return_value=_SMS_FAIL):
            resp = client.post("/api/sms/send",
                               json={"lead_id": lead.id, "message": "test"})

        assert resp.status_code == 400
        assert "error" in resp.json()

    def test_send_creates_sms_log(self, db, client):
        import models
        from conftest import create_test_lead
        lead = create_test_lead(db, email="sms-log@test.com", phone="+919876543210")

        with patch("routes.sms_routes.sms_service.send_sms", return_value=_SMS_OK):
            client.post("/api/sms/send",
                        json={"lead_id": lead.id, "message": "logged msg"})

        logs = db.query(models.SmsLog).filter_by(lead_id=lead.id).all()
        assert len(logs) >= 1

    def test_unknown_lead_returns_404(self, client):
        resp = client.post("/api/sms/send",
                           json={"lead_id": 999999, "message": "test"})
        assert resp.status_code == 404

    def test_uses_lead_phone_number(self, db, client):
        from conftest import create_test_lead
        lead = create_test_lead(db, email="sms-phone@test.com", phone="+919998887777")

        captured = {}
        def _capture(api_key, from_number, to_number, message, **kw):
            captured["to"] = to_number
            return _SMS_OK

        with patch("routes.sms_routes.sms_service.send_sms", side_effect=_capture):
            client.post("/api/sms/send",
                        json={"lead_id": lead.id, "message": "phone test"})

        assert captured.get("to") == "+919998887777"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7: POST /api/webhooks/rcm-sms
# ═══════════════════════════════════════════════════════════════════════════════

_SECRET = "test-webhook-secret"
_SECRET_HEADER = {"X-RCM-Webhook-Secret": _SECRET}

_DELIVERY = {
    "type": "delivery",
    "messageId": "rcm-abc-123",
    "status": "delivered",
    "to": "+919876543210",
}
_INCOMING = {
    "type": "incoming",
    "from": "+919876543210",
    "to": "+11234567890",
    "message": "Hi there!",
    "receivedAt": "2026-05-11T18:00:00Z",
}


class TestRCMSmsWebhook:

    def test_accepts_delivery_report(self, client):
        with patch("routes.webhook_routes.os.getenv", return_value=_SECRET):
            resp = client.post("/api/webhooks/rcm-sms",
                               json=_DELIVERY, headers=_SECRET_HEADER)
        assert resp.status_code == 200

    def test_accepts_incoming_sms(self, client):
        with patch("routes.webhook_routes.os.getenv", return_value=_SECRET):
            resp = client.post("/api/webhooks/rcm-sms",
                               json=_INCOMING, headers=_SECRET_HEADER)
        assert resp.status_code == 200

    def test_rejects_bad_secret(self, client):
        with patch("routes.webhook_routes.os.getenv", return_value=_SECRET):
            resp = client.post("/api/webhooks/rcm-sms",
                               json=_DELIVERY,
                               headers={"X-RCM-Webhook-Secret": "wrong"})
        assert resp.status_code in (401, 403)

    def test_unknown_message_id_returns_200(self, client):
        payload = {**_DELIVERY, "messageId": "unknown-000"}
        with patch("routes.webhook_routes.os.getenv", return_value=_SECRET):
            resp = client.post("/api/webhooks/rcm-sms",
                               json=payload, headers=_SECRET_HEADER)
        assert resp.status_code == 200

    def test_delivery_updates_sms_log_status(self, db, client):
        import models
        log = models.SmsLog(
            message_id="rcm-abc-123",
            direction="outbound",
            status="sent",
            message_text="Hello",
            phone_number="+919876543210",
        )
        db.add(log)
        db.commit()

        with patch("routes.webhook_routes.os.getenv", return_value=_SECRET):
            client.post("/api/webhooks/rcm-sms",
                        json=_DELIVERY, headers=_SECRET_HEADER)

        db.refresh(log)
        assert log.status == "delivered"

    def test_incoming_sms_creates_inbound_log(self, db, client):
        import models
        with patch("routes.webhook_routes.os.getenv", return_value=_SECRET):
            client.post("/api/webhooks/rcm-sms",
                        json=_INCOMING, headers=_SECRET_HEADER)

        logs = db.query(models.SmsLog).filter_by(
            direction="inbound", phone_number="+919876543210"
        ).all()
        assert len(logs) >= 1


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8: Frontend static assets exist
# ═══════════════════════════════════════════════════════════════════════════════

class TestWidgetStaticAssets:

    def test_widget_js_exists(self):
        path = os.path.join(
            os.path.dirname(__file__), "../../frontend/js/rcm_widget.js"
        )
        assert os.path.exists(path), "rcm_widget.js not created yet"

    def test_widget_css_exists(self):
        path = os.path.join(
            os.path.dirname(__file__), "../../frontend/css/rcm_widget.css"
        )
        assert os.path.exists(path), "rcm_widget.css not created yet"
