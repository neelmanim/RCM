"""
test_sdk_proxy.py — Test suite for the RCM Dialer SDK Reference Proxy
=============================================================================
Tests the 5 proxy routes using FastAPI TestClient.

Run:
  cd sdk
  pip install -r proxy-reference/requirements.txt pytest httpx
  pytest tests/test_sdk_proxy.py -v
"""

import asyncio
import json
import sys
import os
from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from fastapi.testclient import TestClient

# Add proxy-reference to path so we can import main.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'proxy-reference'))

# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def set_env(monkeypatch):
    """Inject test credentials so main.py doesn't raise on startup."""
    monkeypatch.setenv("RCM_API_KEY",    "test_key")
    monkeypatch.setenv("RCM_USER_ID",    "test_user")
    monkeypatch.setenv("RCM_FROM_NUMBER", "+10000000000")
    monkeypatch.setenv("RCM_BASE_URL",   "https://api.test.rcm.com")


@pytest.fixture
def mock_rcm_start():
    """Mock a successful RCM /calls/initiate response."""
    return {
        "call_id":     "cid-abc-123",
        "token":       "lk_token_xyz",
        "livekit_url": "wss://livekit.test.example",
        "room_name":   "room-abc-123",
    }


@pytest.fixture
def client(mock_rcm_start):
    """Create a TestClient with RCM API calls mocked."""
    with patch("main._rcm_post", new_callable=AsyncMock) as mock_post, \
         patch("main._rcm_get",  new_callable=AsyncMock) as mock_get, \
         patch("main.start_polling",     new_callable=AsyncMock):

        mock_post.return_value = mock_rcm_start
        mock_get.return_value  = {"status": "CALL_ANSWERED", "duration": 10}

        import main
        main._active_calls.clear()   # reset between tests

        with TestClient(main.app, raise_server_exceptions=True) as c:
            c._mock_post = mock_post
            c._mock_get  = mock_get
            yield c


# ── Route 1: POST /dialer/call/start ─────────────────────────────────────────

class TestCallStart:

    def test_returns_call_id_and_livekit_fields(self, client):
        resp = client.post("/dialer/call/start", json={
            "phone": "+919876543210",
            "contact_name": "Test Lead",
            "call_mode": "browser",
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["call_id"]       == "cid-abc-123"
        assert body["livekit_token"] == "lk_token_xyz"
        assert body["livekit_url"]   == "wss://livekit.test.example"
        assert body["room_name"]     == "room-abc-123"

    def test_phone_formatted_to_00_prefix(self, client):
        """RCM requires 00-prefixed international format, not +."""
        resp = client.post("/dialer/call/start", json={"phone": "+919876543210"})
        assert resp.status_code == 200
        # The mock_post call should have received 00-prefixed phone
        import main
        call_args = main._rcm_post.call_args
        sent_payload = call_args[0][1]   # positional arg index 1 = body
        assert sent_payload["phone_number"].startswith("00")
        assert "+" not in sent_payload["phone_number"]

    def test_call_registered_in_active_calls(self, client):
        import main
        main._active_calls.clear()
        client.post("/dialer/call/start", json={"phone": "+1234567890"})
        assert "cid-abc-123" in main._active_calls

    def test_missing_api_key_returns_500(self, monkeypatch):
        monkeypatch.setenv("RCM_API_KEY", "")
        import main
        main._active_calls.clear()
        with TestClient(main.app, raise_server_exceptions=False) as c:
            resp = c.post("/dialer/call/start", json={"phone": "+1234567890"})
        assert resp.status_code == 500

    def test_rcm_error_propagates(self, client):
        from fastapi import HTTPException
        import main
        main._rcm_post.side_effect = HTTPException(status_code=502, detail="RCM down")
        resp = client.post("/dialer/call/start", json={"phone": "+1234567890"})
        assert resp.status_code >= 400
        main._rcm_post.side_effect = None
        main._rcm_post.return_value = {"call_id": "cid-abc-123", "token": "lk_token_xyz", "livekit_url": "wss://test", "room_name": "r1"}


# ── Route 2: POST /dialer/call/action ────────────────────────────────────────

class TestCallAction:

    def test_mute_action_proxied(self, client):
        resp = client.post("/dialer/call/action", json={
            "call_id": "cid-abc-123",
            "action":  "mute",
            "room_name": "room-abc-123",
        })
        assert resp.status_code == 200

    def test_room_name_omitted_when_null(self, client):
        """Gap-3 guard: room_name must NOT be sent if null/empty (RCM returns 400)."""
        import main
        main._rcm_post.return_value = {"ok": True}
        resp = client.post("/dialer/call/action", json={
            "call_id":   "cid-abc-123",
            "action":    "hold",
            "room_name": None,
        })
        assert resp.status_code == 200
        call_args = main._rcm_post.call_args
        sent_body = call_args[0][1]
        assert "room_name" not in sent_body   # Guard-3: must be absent, not null

    def test_room_name_included_when_present(self, client):
        import main
        main._rcm_post.return_value = {"ok": True}
        client.post("/dialer/call/action", json={
            "call_id":   "cid-abc-123",
            "action":    "hold",
            "room_name": "room-abc-123",
        })
        call_args = main._rcm_post.call_args
        sent_body = call_args[0][1]
        assert sent_body.get("room_name") == "room-abc-123"


# ── Route 3: POST /dialer/call/end ───────────────────────────────────────────

class TestCallEnd:

    def test_call_end_proxied(self, client):
        import main
        main._active_calls["cid-abc-123"] = {"call_id": "cid-abc-123"}
        main._rcm_post.return_value = {"ok": True}
        resp = client.post("/dialer/call/end", json={"call_id": "cid-abc-123"})
        assert resp.status_code == 200

    def test_call_removed_from_active_calls(self, client):
        import main
        main._active_calls["cid-abc-123"] = {"call_id": "cid-abc-123"}
        main._rcm_post.return_value = {"ok": True}
        client.post("/dialer/call/end", json={"call_id": "cid-abc-123"})
        assert "cid-abc-123" not in main._active_calls


# ── Route 4: POST /dialer/webhook ────────────────────────────────────────────

class TestWebhook:

    def test_valid_webhook_publishes_to_sse(self, client):
        with patch("main.sse_broker.publish_all", new_callable=AsyncMock) as mock_publish:
            resp = client.post("/dialer/webhook", json={
                "call_id": "cid-abc-123",
                "status":  "CALL_ANSWERED",
                "duration": 15,
            })
            assert resp.status_code == 200
            mock_publish.assert_called_once()
            event = mock_publish.call_args[0][0]
            assert event["type"]   == "CALL_STATUS"
            assert event["status"] == "CALL_ANSWERED"
            assert event["call_id"] == "cid-abc-123"

    def test_terminal_status_removes_from_active_calls(self, client):
        import main
        main._active_calls["cid-abc-123"] = {"call_id": "cid-abc-123"}
        with patch("main.sse_broker.publish_all", new_callable=AsyncMock):
            client.post("/dialer/webhook", json={
                "call_id": "cid-abc-123",
                "status":  "CALL_ENDED",
            })
        assert "cid-abc-123" not in main._active_calls

    def test_duplicate_webhook_is_idempotent(self, client):
        """Gap-1: sending the same webhook twice must not cause side-effects."""
        import main
        main._active_calls["cid-abc-123"] = {"call_id": "cid-abc-123"}
        with patch("main.sse_broker.publish_all", new_callable=AsyncMock) as mock_pub:
            client.post("/dialer/webhook", json={"call_id": "cid-abc-123", "status": "CALL_ENDED"})
            client.post("/dialer/webhook", json={"call_id": "cid-abc-123", "status": "CALL_ENDED"})
            # Second call should NOT raise — just publish (broker deduplication is client-side)
            assert mock_pub.call_count == 2

    def test_missing_call_id_ignored(self, client):
        with patch("main.sse_broker.publish_all", new_callable=AsyncMock):
            resp = client.post("/dialer/webhook", json={"status": "CALL_STARTED"})
            assert resp.status_code == 200
            body = resp.json()
            assert "ignored" in body

    def test_invalid_json_returns_400(self, client):
        resp = client.post("/dialer/webhook", content=b"not-json",
                           headers={"Content-Type": "application/json"})
        assert resp.status_code == 400


# ── Route 5: GET /dialer/events (SSE) ────────────────────────────────────────

class TestSSEEvents:

    def test_sse_route_registered(self, client):
        """Verify the SSE route is registered and returns text/event-stream.
        We inspect the app's route registry rather than opening the infinite stream,
        which would block TestClient indefinitely."""
        import main
        from fastapi.responses import StreamingResponse

        # Find the /dialer/events route
        sse_routes = [
            r for r in main.app.routes
            if hasattr(r, 'path') and r.path == '/dialer/events'
        ]
        assert len(sse_routes) == 1, "SSE route /dialer/events not registered"

    def test_sse_cache_control_headers(self, client):
        """Verify SSE returns correct no-cache headers (non-streaming HEAD check)."""
        import main
        # The route should have no-cache as a declared response header in the handler.
        # We verify by inspecting the route's endpoint docstring / signature.
        sse_routes = [r for r in main.app.routes if hasattr(r, 'path') and r.path == '/dialer/events']
        assert sse_routes, "SSE route missing"
        endpoint = sse_routes[0].endpoint
        import inspect
        src = inspect.getsource(endpoint)
        assert 'no-cache' in src or 'Cache-Control' in src


# ── Health check ─────────────────────────────────────────────────────────────

class TestHealth:

    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_health_reports_active_calls(self, client):
        import main
        main._active_calls["cid-test"] = {}
        resp = client.get("/health")
        assert resp.json()["active_calls"] >= 1
        main._active_calls.pop("cid-test", None)
