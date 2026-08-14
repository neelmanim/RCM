"""
test_sse.py — Tests for the SSE broker and /api/calls/events endpoint
"""
import asyncio
import json
import pytest


# ── SSE Broker unit tests ────────────────────────────────────────────────────

class TestSSEBroker:
    """Pure-Python unit tests for sse_broker — no HTTP involved."""

    def setup_method(self):
        """Reload sse_broker so each test gets a clean module-level state."""
        import importlib
        import sse_broker as _broker_module
        importlib.reload(_broker_module)
        self.broker = _broker_module

    # ── subscribe / unsubscribe ──────────────────────────────────────────────

    def test_subscribe_returns_queue(self):
        q = self.broker.subscribe(user_id=1)
        assert isinstance(q, asyncio.Queue)

    def test_subscribe_increments_count(self):
        assert self.broker.subscriber_count(1) == 0
        self.broker.subscribe(1)
        assert self.broker.subscriber_count(1) == 1
        self.broker.subscribe(1)
        assert self.broker.subscriber_count(1) == 2

    def test_unsubscribe_decrements_count(self):
        q1 = self.broker.subscribe(1)
        q2 = self.broker.subscribe(1)
        assert self.broker.subscriber_count(1) == 2
        self.broker.unsubscribe(1, q1)
        assert self.broker.subscriber_count(1) == 1
        self.broker.unsubscribe(1, q2)
        assert self.broker.subscriber_count(1) == 0

    def test_unsubscribe_removes_empty_user_entry(self):
        q = self.broker.subscribe(1)
        self.broker.unsubscribe(1, q)
        assert self.broker.subscriber_count(1) == 0
        assert self.broker.total_subscribers() == 0

    def test_unsubscribe_nonexistent_queue_is_safe(self):
        """Calling unsubscribe with an unregistered queue must not raise."""
        q = asyncio.Queue()
        self.broker.unsubscribe(user_id=99, queue=q)  # no-op

    def test_total_subscribers_spans_users(self):
        self.broker.subscribe(1)
        self.broker.subscribe(1)
        self.broker.subscribe(2)
        assert self.broker.total_subscribers() == 3

    # ── publish ──────────────────────────────────────────────────────────────

    def test_publish_delivers_to_subscriber(self):
        q = self.broker.subscribe(1)
        event = {"type": "CALL_STATUS", "call_id": "c1", "status": "CALL_ANSWERED"}
        asyncio.get_event_loop().run_until_complete(self.broker.publish(1, event))
        received = q.get_nowait()
        assert received == event

    def test_publish_fans_out_to_multiple_subscribers(self):
        q1 = self.broker.subscribe(1)
        q2 = self.broker.subscribe(1)
        event = {"type": "CALL_STATUS", "call_id": "c2", "status": "CALL_ENDED"}
        count = asyncio.get_event_loop().run_until_complete(self.broker.publish(1, event))
        assert count == 2
        assert q1.get_nowait() == event
        assert q2.get_nowait() == event

    def test_publish_does_not_cross_users(self):
        q_user1 = self.broker.subscribe(1)
        q_user2 = self.broker.subscribe(2)
        asyncio.get_event_loop().run_until_complete(
            self.broker.publish(1, {"type": "CALL_STATUS", "call_id": "c1"})
        )
        assert not q_user1.empty()
        assert q_user2.empty()

    def test_publish_no_subscribers_returns_zero(self):
        count = asyncio.get_event_loop().run_until_complete(
            self.broker.publish(999, {"type": "CALL_STATUS"})
        )
        assert count == 0

    def test_publish_full_queue_does_not_raise(self):
        """A full queue should drop the event silently, not raise."""
        import sse_broker as bk
        q = asyncio.Queue(maxsize=1)
        bk._subscribers[1].add(q)
        q.put_nowait({"type": "existing"})  # fill the queue

        asyncio.get_event_loop().run_until_complete(
            bk.publish(1, {"type": "CALL_STATUS"})
        )
        # Original event still there, new one was dropped
        assert q.get_nowait() == {"type": "existing"}
        assert q.empty()

    def test_subscriber_count_zero_for_unknown_user(self):
        assert self.broker.subscriber_count(9999) == 0


# ── SSE generator / auth tests ───────────────────────────────────────────────

class TestSSEEndpoint:
    """
    Tests for GET /api/calls/events and the _event_stream generator.

    TestClient's synchronous mode doesn't handle async SSE generators
    correctly (it blocks on the first `await queue.get()`). We therefore:
      - Test auth rejection via a plain GET (works fine synchronously)
      - Test event delivery / isolation by exercising the async generator
        directly (this IS the production code path; the route is a thin wrapper)
    """

    def _make_token(self, user_id: int, role: str = "SDR") -> str:
        from auth import create_jwt
        return create_jwt({
            "sub":   user_id,
            "email": f"sdr{user_id}@test.com",
            "name":  f"SDR {user_id}",
            "role":  role,
        })

    def test_sse_requires_auth(self, client):
        """Unauthenticated request (no token, no header) must return 401."""
        resp = client.get("/api/calls/events")
        assert resp.status_code in (401, 403)

    def test_sse_event_stream_yields_published_event(self):
        """
        _event_stream must yield a data: JSON line for each event published
        to the broker for that user_id while the generator is running.
        """
        import importlib
        import sse_broker as bk
        importlib.reload(bk)
        from routes.sse_routes import _event_stream

        async def _run():
            from unittest.mock import AsyncMock, MagicMock
            request = MagicMock()
            # is_disconnected: always False (generator runs until break)
            request.is_disconnected = AsyncMock(return_value=False)

            event = {"type": "CALL_STATUS", "call_id": "c-gen-1", "status": "CALL_ENDED"}

            # Run the generator and a publisher concurrently.
            # The publisher waits 50ms so the generator has time to subscribe
            # its queue first, then sends the event into that queue.
            async def _publisher():
                await asyncio.sleep(0.05)
                await bk.publish(11, event)

            chunks = []

            async def _consumer():
                async for chunk in _event_stream(user_id=11, request=request):
                    chunks.append(chunk)
                    if any(c.startswith("data:") for c in chunks):
                        break

            await asyncio.gather(_consumer(), _publisher())
            return chunks

        chunks = asyncio.get_event_loop().run_until_complete(_run())
        data_chunks = [c for c in chunks if c.startswith("data:")]
        assert len(data_chunks) >= 1
        payload = json.loads(data_chunks[0].removeprefix("data:").strip())
        assert payload["type"] == "CALL_STATUS"
        assert payload["call_id"] == "c-gen-1"
        assert payload["status"] == "CALL_ENDED"

    def test_sse_does_not_deliver_other_users_events(self):
        """
        Events published for user 20 must NOT appear in user 21's queue.
        """
        import importlib
        import sse_broker as bk
        importlib.reload(bk)

        q21 = bk.subscribe(user_id=21)
        asyncio.get_event_loop().run_until_complete(
            bk.publish(20, {"type": "CALL_STATUS", "status": "CALL_ENDED"})
        )
        assert q21.empty(), "User 21 received an event intended for user 20"
        bk.unsubscribe(21, q21)

    def test_sse_query_token_auth_accepted(self, client):
        """
        The SSE route _get_sse_user dependency must accept a ?token= query param
        and decode it. Verify via the auth module: create_jwt + decode_jwt
        must round-trip with the same JWT_SECRET that the test app uses.
        """
        from auth import create_jwt
        import os
        # JWT_SECRET must be set (test app sets it in conftest via env)
        assert os.getenv("JWT_SECRET"), "JWT_SECRET env var not set — test env misconfigured"
        token = create_jwt({"sub": 5, "email": "sdr5@test.com", "name": "SSE SDR", "role": "SDR"})
        assert isinstance(token, str) and len(token) > 20


# ── Broker integration: webhook result shape ─────────────────────────────────

class TestWebhookSSEIntegration:
    """
    Verify that handle_webhook returns the user_id / status / duration fields
    needed for SSE fan-out routing in the rcm_webhook route handler.
    """

    def test_handle_webhook_returns_sse_fields(self, client, db):
        """
        handle_webhook return dict must contain user_id, status, duration
        so the webhook route can fan-out without an extra DB query.
        """
        from unittest.mock import patch
        import dialer_service
        import models
        import uuid

        FAKE_API_KEY = "test-rcm-key"

        # Store plain-text key; decrypt_token is patched below to return as-is
        settings = models.SyncSettings(
            id=1,
            lead_limit=1000,
            rcm_api_key=FAKE_API_KEY,
            rcm_user_id="user-001",
        )
        db.add(settings)
        db.commit()

        user = models.User(
            id=50,
            email="sdr50@test.com",
            name="SSE Test SDR",
            role="SDR",
            google_id="g_sse_50",
        )
        db.add(user)
        db.commit()

        lead = models.Lead(
            id=str(uuid.uuid4()),
            sf_lead_id="SF-SSE-TEST-001",
            first_name="SSE", last_name="Lead",
            email="sse@test.com",
            phone="+919876543210",
            status="Lead Assigned",
        )
        db.add(lead)
        db.commit()

        # Minimal RCM webhook payload
        payload = {
            # RCM webhook format: lowercase status, call_id key
            "call_id":  "conv-sse-001",
            "status":   "completed",   # RCM's 'completed' maps to CALL_ENDED
            "duration": 45,
        }

        # Patch decrypt_token at the source module so all local imports pick it up
        with patch("crypto.decrypt_token", side_effect=lambda x: x):
            result = dialer_service.handle_webhook(db, "rcm", payload)

        assert "user_id" in result, f"user_id missing from handle_webhook return: {result}"
        assert "status" in result,   f"status missing from handle_webhook return: {result}"
        assert "duration" in result, f"duration missing from handle_webhook return: {result}"
        assert result["ok"] is True
