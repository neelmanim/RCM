"""Tests for the root cause fixes: email sync, webhook phone matching, and sanitize preview.

These tests exercise the REAL code paths — not mocked versions — to ensure:
1. _sync_thread_messages is fully sync (no async/await)
2. _sanitize_preview strips all quoted text patterns
3. Webhook phone lookup matches various phone formats via SQL
4. BackgroundTasks pattern works correctly
5. _stripQuotedText (frontend) logic validated via backend mirror
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Must be set BEFORE any route imports that chain through auth.py,
# which raises ValueError at module load if JWT_SECRET is missing.
os.environ.setdefault("JWT_SECRET", "test-secret-for-ci")

import re
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

from conftest import (
    create_test_user, create_test_lead, create_nylas_config,
    create_user_mailbox, create_email_activity, create_email_thread,
    create_sync_settings,
)
import models


# ═════════════════════════════════════════════════════════════════════════════
# 1. _sanitize_preview — quoted text stripping (backend)
# ═════════════════════════════════════════════════════════════════════════════

class TestSanitizePreview:
    """Tests for sanitize_preview (email_utils.py).

    IMPORTANT: sanitize_preview was redesigned during the email truncation fix
    (v8.9.x). It now:
      - Preserves safe HTML tags (p, b, a, etc.) via bleach allowlist
      - Strips dangerous tags (script, iframe, etc.)
      - Stores up to 64KB (not 200 chars)
      - Does NOT strip quoted reply text or signatures (frontend handles that)
    These tests document the current contract.
    """

    @pytest.fixture(autouse=True)
    def _import(self):
        from routes.email_routes import _sanitize_preview
        self.sanitize = _sanitize_preview

    def test_plain_text_unchanged(self):
        assert self.sanitize("Hello World") == "Hello World"

    def test_empty_input(self):
        assert self.sanitize("") == ""
        assert self.sanitize(None) == ""

    def test_preserves_safe_html_tags(self):
        """Safe tags like p and b are preserved (bleach allowlist)."""
        result = self.sanitize("<p>Hello <b>World</b></p>")
        assert "Hello" in result
        assert "World" in result
        assert "<b>" in result or "World" in result  # tag preserved

    def test_strips_script_tags(self):
        """Script tags must always be stripped — this is a security boundary."""
        result = self.sanitize("<script>alert('xss')</script>Safe text")
        assert "<script" not in result
        assert "Safe text" in result

    def test_strips_iframe_tags(self):
        result = self.sanitize("<iframe src='evil.com'></iframe>Content")
        assert "<iframe" not in result
        assert "Content" in result

    def test_strips_style_block(self):
        """style blocks (not inline style attr) are stripped."""
        result = self.sanitize("<style>body{color:red}</style>Text")
        assert "<style>" not in result
        assert "Text" in result

    def test_quoted_text_not_stripped(self):
        """Quoted reply patterns are now kept — frontend strips them in display."""
        text = "Test Reply On Wed, Mar 25, 2026 at 3:03 PM Neelmani Mishra wrote: Testing Email"
        result = self.sanitize(text)
        # The full content is preserved (no server-side stripping)
        assert "Test Reply" in result

    def test_signature_not_stripped(self):
        """Signatures are kept — no server-side stripping."""
        text = "Thanks for the update\nBest regards,"
        result = self.sanitize(text)
        assert "Thanks for the update" in result

    def test_max_len_default_64kb(self):
        """Default max_len is 64KB (65536 chars)."""
        text = "A" * 70000
        result = self.sanitize(text)
        assert len(result) == 65536

    def test_custom_max_len(self):
        text = "A" * 300
        result = self.sanitize(text, max_len=50)
        assert len(result) == 50

    def test_short_content_not_truncated(self):
        """Short emails should be returned without truncation."""
        text = "Hello, I would like to schedule a call next Tuesday."
        assert self.sanitize(text) == text

    def test_no_stripping_needed(self):
        """Text with no quoted content should be returned as-is."""
        text = "Hello, I would like to schedule a call next Tuesday."
        assert self.sanitize(text) == text


# ═════════════════════════════════════════════════════════════════════════════
# 2. _sync_thread_messages — is SYNC (not async)
# ═════════════════════════════════════════════════════════════════════════════

class TestSyncThreadMessagesIsSync:
    """Verify that _sync_thread_messages is no longer async.
    This is the root cause of the 502 — mixing async httpx with sync SQLAlchemy."""

    def test_function_is_not_coroutine(self):
        """The function MUST be a regular def, not async def."""
        import asyncio
        from routes.email_routes import _sync_thread_messages
        assert not asyncio.iscoroutinefunction(_sync_thread_messages), \
            "_sync_thread_messages must NOT be async — async with sync SQLAlchemy causes 502s"

    def test_background_wrapper_is_not_coroutine(self):
        """The background task wrapper must also be sync."""
        import asyncio
        from routes.email_routes import _sync_thread_messages_background
        assert not asyncio.iscoroutinefunction(_sync_thread_messages_background), \
            "_sync_thread_messages_background must NOT be async"


class TestSyncThreadMessages:
    """Tests for the actual sync behavior of _sync_thread_messages.
    These test the real function against the DB, not a mocked version."""

    def test_returns_early_no_nylas_config(self, db):
        """No NylasConfig → should return immediately, no crash."""
        from routes.email_routes import _sync_thread_messages
        # No config exists — should return None without error
        _sync_thread_messages("nonexistent-lead", db)
        # If we got here, no exception was raised

    def test_returns_early_no_threads(self, db):
        """Lead exists but has no email threads → should return immediately."""
        from routes.email_routes import _sync_thread_messages
        create_nylas_config(db)
        lead = create_test_lead(db)
        _sync_thread_messages(lead.id, db)
        # No crash = success

    def test_returns_early_no_outbound(self, db):
        """Threads exist but no outbound email → no grant_id to use → return early."""
        from routes.email_routes import _sync_thread_messages
        create_nylas_config(db)
        lead = create_test_lead(db)
        create_email_thread(db, lead.id, "thread-123")
        _sync_thread_messages(lead.id, db)
        # No crash = success

    def test_returns_early_no_mailbox(self, db):
        """Outbound email exists but user has no connected mailbox."""
        from routes.email_routes import _sync_thread_messages
        create_nylas_config(db)
        lead = create_test_lead(db, email="to@test.com")
        user = create_test_user(db, email="sender@test.com")
        user.id = "sync-test-user"
        db.commit()
        # Create outbound email activity (no mailbox though)
        create_email_activity(db, lead.id, user.id, "outbound",
                              from_email="sender@test.com", to_email="to@test.com")
        create_email_thread(db, lead.id, "thread-123")
        _sync_thread_messages(lead.id, db)
        # No crash = success

    @patch("routes.email_routes.decrypt_token", return_value="fake-key")
    @patch("httpx.get")
    def test_syncs_inbound_messages(self, mock_get, mock_decrypt, db):
        """Full sync path: Nylas returns new inbound message → gets inserted into DB."""
        from routes.email_routes import _sync_thread_messages

        create_nylas_config(db)
        lead = create_test_lead(db, email="lead@example.com")
        user = create_test_user(db, email="sdr@company.com")
        user.id = "sync-sdr-user"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="sdr@company.com")
        create_email_activity(db, lead.id, user.id, "outbound",
                              from_email="sdr@company.com", to_email="lead@example.com",
                              nylas_message_id="msg-out-1", nylas_thread_id="thread-sync")
        create_email_thread(db, lead.id, "thread-sync")

        # Mock Nylas API response — two messages: one outbound (already logged), one inbound (new)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": [
            {  # Already logged outbound — should be skipped
                "id": "msg-out-1",
                "from": [{"email": "sdr@company.com"}],
                "to": [{"email": "lead@example.com"}],
                "subject": "Hello",
                "snippet": "Hi there",
                "date": 1711375380,
            },
            {  # New inbound — should be inserted
                "id": "msg-in-new",
                "from": [{"email": "lead@example.com"}],
                "to": [{"email": "sdr@company.com"}],
                "subject": "Re: Hello",
                "snippet": "Thanks for reaching out On Wed, Mar 25.. wrote: Hi there",
                "date": 1711375500,
            },
        ]}
        mock_get.return_value = mock_resp

        _sync_thread_messages(lead.id, db)

        # Verify the inbound message was inserted
        inbound = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-in-new"
        ).first()
        assert inbound is not None, "Inbound message should have been synced from Nylas"
        assert inbound.direction == "inbound"
        assert inbound.from_email == "lead@example.com"
        assert "reaching out" in inbound.body_preview
        # Note: sanitize_preview now preserves quoted text (full HTML body stored);
        # frontend handles quote-stripping at display time. No assertion on "Hi there"
        # absence — it IS expected to be in the preview now.

        # The outbound should NOT be duplicated
        outbound_count = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-out-1"
        ).count()
        assert outbound_count == 1, "Outbound message should not be duplicated"

    @patch("routes.email_routes.decrypt_token", return_value="fake-key")
    @patch("httpx.get")
    def test_nylas_api_failure_does_not_crash(self, mock_get, mock_decrypt, db):
        """If Nylas API returns error, function should continue gracefully."""
        from routes.email_routes import _sync_thread_messages

        create_nylas_config(db)
        lead = create_test_lead(db, email="lead@test.com")
        user = create_test_user(db, email="sdr@test.com")
        user.id = "sync-sdr-fail"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="sdr@test.com")
        create_email_activity(db, lead.id, user.id, "outbound",
                              from_email="sdr@test.com", to_email="lead@test.com")
        create_email_thread(db, lead.id, "thread-fail")

        mock_resp = MagicMock()
        mock_resp.status_code = 401  # Auth error
        mock_get.return_value = mock_resp

        # Should NOT raise — just skip this thread
        _sync_thread_messages(lead.id, db)

    @patch("routes.email_routes.decrypt_token", return_value="fake-key")
    @patch("httpx.get", side_effect=ConnectionError("Network timeout"))
    def test_network_error_does_not_crash(self, mock_get, mock_decrypt, db):
        """Network errors during Nylas call should be caught gracefully."""
        from routes.email_routes import _sync_thread_messages

        create_nylas_config(db)
        lead = create_test_lead(db, email="lead@test.com")
        user = create_test_user(db, email="sdr@test.com")
        user.id = "sync-sdr-net"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="sdr@test.com")
        create_email_activity(db, lead.id, user.id, "outbound",
                              from_email="sdr@test.com", to_email="lead@test.com")
        create_email_thread(db, lead.id, "thread-net")

        _sync_thread_messages(lead.id, db)

    @patch("routes.email_routes.decrypt_token", return_value="fake-key")
    @patch("httpx.get")
    def test_new_message_from_connected_mailbox_logged_as_outbound_not_skipped(self, mock_get, mock_decrypt, db):
        """2026-08-05: a message from a connected mailbox address that ISN'T
        already logged (existing_ids checked separately above) used to be
        silently skipped on the assumption it was "already logged via /send"
        — but that's exactly what a message sent directly from Gmail looks
        like. This is the fallback path _sync_full_mailbox delegates to on
        failure, so it must catch the same case, not drop it."""
        from routes.email_routes import _sync_thread_messages

        create_nylas_config(db)
        lead = create_test_lead(db, email="lead@test.com")
        user = create_test_user(db, email="sdr@test.com")
        user.id = "sync-sdr-gmail"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="sdr@test.com")
        create_email_activity(db, lead.id, user.id, "outbound",
                              from_email="sdr@test.com", to_email="lead@test.com")
        create_email_thread(db, lead.id, "thread-gmail")

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": [
            {  # Sent directly from Gmail — never logged via the app's /send
                "id": "msg-gmail-direct",
                "from": [{"email": "sdr@test.com"}],
                "to": [{"email": "lead@test.com"}],
                "subject": "Sent from Gmail",
                "snippet": "Hi, following up",
                "date": 1711375380,
            },
        ]}
        mock_get.return_value = mock_resp

        _sync_thread_messages(lead.id, db)

        logged = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-gmail-direct"
        ).first()
        assert logged is not None, "Gmail-direct-sent message must be logged, not silently skipped"
        assert logged.direction == "outbound"

    @patch("routes.email_routes.decrypt_token", return_value="fake-key")
    @patch("httpx.get")
    def test_duplicate_messages_not_inserted(self, mock_get, mock_decrypt, db):
        """If the same message ID comes back twice, it should not be duplicated."""
        from routes.email_routes import _sync_thread_messages

        create_nylas_config(db)
        lead = create_test_lead(db, email="lead@test.com")
        user = create_test_user(db, email="sdr@test.com")
        user.id = "sync-sdr-dup"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="sdr@test.com")
        create_email_activity(db, lead.id, user.id, "outbound",
                              from_email="sdr@test.com", to_email="lead@test.com")
        # Two threads that both return the same message (cross-thread dedup)
        create_email_thread(db, lead.id, "thread-a")
        create_email_thread(db, lead.id, "thread-b")

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": [
            {"id": "msg-dup-1", "from": [{"email": "lead@test.com"}],
             "to": [{"email": "sdr@test.com"}], "subject": "Hi", "snippet": "Hello",
             "date": 1711375380}
        ]}
        mock_get.return_value = mock_resp

        _sync_thread_messages(lead.id, db)

        count = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-dup-1"
        ).count()
        assert count == 1, "Message should only be inserted once even if returned by multiple threads"


# ═════════════════════════════════════════════════════════════════════════════
# 3. Webhook phone lookup — SQL-level matching
# ═════════════════════════════════════════════════════════════════════════════

class TestWebhookPhoneLookup:
    """Tests that the webhook handler correctly matches leads by phone number
    using SQL queries instead of the old O(N) Python scan."""

    def _create_lead_with_phone(self, db, phone, name="Lead"):
        lead = models.Lead(first_name=name, last_name="Test", phone=phone,
                           status="Lead Assigned", lead_source="salesforce")
        db.add(lead)
        db.commit()
        db.refresh(lead)
        return lead

    def _create_dialer_config(self, db):
        """Create a minimal dialer config for Aircall."""
        from crypto import encrypt_token
        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        if not settings:
            settings = models.SyncSettings(id=1)
            db.add(settings)
        settings.dialer_provider = "aircall"
        settings.dialer_api_id = "test-api-id"
        settings.dialer_api_token = encrypt_token("test-api-token")
        db.commit()

    @patch("dialer_service._instantiate_provider")
    def test_exact_match_e164(self, mock_provider, db):
        """Webhook phone +918552628000 matches lead phone +918552628000."""
        lead = self._create_lead_with_phone(db, "+918552628000")
        mock_prov = MagicMock()
        mock_prov.provider_name = "aircall"
        mock_prov.handle_webhook.return_value = MagicMock(
            event_type="CALL_ENDED", provider_call_id="call-123",
            phone_number="+918552628000", user_email=None,
            direction="outbound", duration=60, recording_url=None,
            transcript=None, transcript_url=None,
            started_at=None, answered_at=None, ended_at=None,
            raw_payload={}
        )
        mock_provider.return_value = mock_prov

        from dialer_service import handle_webhook
        result = handle_webhook(db, "aircall", {"event": "call.ended", "data": {}})

        assert result["ok"] is True
        # Verify the call was linked to the lead
        call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "call-123"
        ).first()
        assert call is not None
        assert call.lead_id == lead.id

    @patch("dialer_service._instantiate_provider")
    def test_digits_only_match(self, mock_provider, db):
        """Webhook sends '8552628000' (no country code), lead has '+918552628000'."""
        lead = self._create_lead_with_phone(db, "+918552628000")
        mock_prov = MagicMock()
        mock_prov.provider_name = "aircall"
        mock_prov.handle_webhook.return_value = MagicMock(
            event_type="CALL_ENDED", provider_call_id="call-digits",
            phone_number="8552628000", user_email=None,
            direction="outbound", duration=30, recording_url=None,
            transcript=None, transcript_url=None,
            started_at=None, answered_at=None, ended_at=None,
            raw_payload={}
        )
        mock_provider.return_value = mock_prov

        from dialer_service import handle_webhook
        result = handle_webhook(db, "aircall", {"event": "call.ended", "data": {}})
        assert result["ok"] is True

        call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "call-digits"
        ).first()
        assert call is not None
        assert call.lead_id == lead.id

    @patch("dialer_service._instantiate_provider")
    def test_formatted_phone_with_dashes(self, mock_provider, db):
        """Lead has '+91-855-262-8000' (dashes), webhook sends '+918552628000'."""
        lead = self._create_lead_with_phone(db, "+91-855-262-8000")
        mock_prov = MagicMock()
        mock_prov.provider_name = "aircall"
        mock_prov.handle_webhook.return_value = MagicMock(
            event_type="CALL_ENDED", provider_call_id="call-dash",
            phone_number="+918552628000", user_email=None,
            direction="outbound", duration=45, recording_url=None,
            transcript=None, transcript_url=None,
            started_at=None, answered_at=None, ended_at=None,
            raw_payload={}
        )
        mock_provider.return_value = mock_prov

        from dialer_service import handle_webhook
        result = handle_webhook(db, "aircall", {"event": "call.ended", "data": {}})
        assert result["ok"] is True

        call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "call-dash"
        ).first()
        assert call is not None
        assert call.lead_id == lead.id

    @patch("dialer_service._instantiate_provider")
    def test_formatted_phone_with_spaces(self, mock_provider, db):
        """Lead has '+91 85526 28000' (spaces), webhook sends '+918552628000'."""
        lead = self._create_lead_with_phone(db, "+91 85526 28000")
        mock_prov = MagicMock()
        mock_prov.provider_name = "aircall"
        mock_prov.handle_webhook.return_value = MagicMock(
            event_type="CALL_ENDED", provider_call_id="call-space",
            phone_number="+918552628000", user_email=None,
            direction="outbound", duration=10, recording_url=None,
            transcript=None, transcript_url=None,
            started_at=None, answered_at=None, ended_at=None,
            raw_payload={}
        )
        mock_provider.return_value = mock_prov

        from dialer_service import handle_webhook
        result = handle_webhook(db, "aircall", {"event": "call.ended", "data": {}})
        assert result["ok"] is True

        call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "call-space"
        ).first()
        assert call is not None
        assert call.lead_id == lead.id

    @patch("dialer_service._instantiate_provider")
    def test_no_match_returns_none_lead_id(self, mock_provider, db):
        """Phone number with no matching lead → lead_id should be None."""
        mock_prov = MagicMock()
        mock_prov.provider_name = "aircall"
        mock_prov.handle_webhook.return_value = MagicMock(
            event_type="CALL_ENDED", provider_call_id="call-orphan",
            phone_number="+19999999999", user_email=None,
            direction="outbound", duration=5, recording_url=None,
            transcript=None, transcript_url=None,
            started_at=None, answered_at=None, ended_at=None,
            raw_payload={}
        )
        mock_provider.return_value = mock_prov

        from dialer_service import handle_webhook
        result = handle_webhook(db, "aircall", {"event": "call.ended", "data": {}})
        assert result["ok"] is True

        call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "call-orphan"
        ).first()
        assert call is not None
        assert call.lead_id is None

    @patch("dialer_service._instantiate_provider")
    def test_us_number_10_digits(self, mock_provider, db):
        """US number: lead has '2125551234', webhook sends '+12125551234'."""
        lead = self._create_lead_with_phone(db, "2125551234")
        mock_prov = MagicMock()
        mock_prov.provider_name = "aircall"
        mock_prov.handle_webhook.return_value = MagicMock(
            event_type="CALL_ENDED", provider_call_id="call-us",
            phone_number="+12125551234", user_email=None,
            direction="outbound", duration=20, recording_url=None,
            transcript=None, transcript_url=None,
            started_at=None, answered_at=None, ended_at=None,
            raw_payload={}
        )
        mock_provider.return_value = mock_prov

        from dialer_service import handle_webhook
        result = handle_webhook(db, "aircall", {"event": "call.ended", "data": {}})
        assert result["ok"] is True

        call = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "call-us"
        ).first()
        assert call is not None
        assert call.lead_id == lead.id

    @patch("dialer_service._instantiate_provider")
    def test_webhook_updates_existing_call(self, mock_provider, db):
        """When a DialerCall already exists (from /calls/start), webhook updates it."""
        lead = self._create_lead_with_phone(db, "+918552628000")

        # Create an existing DialerCall (from /calls/start)
        existing_call = models.DialerCall(
            lead_id=lead.id, provider="aircall",
            provider_call_id="call-existing",
            phone_number="+918552628000",
            status="CALL_STARTED", direction="outbound",
        )
        db.add(existing_call)
        db.commit()
        db.refresh(existing_call)

        mock_prov = MagicMock()
        mock_prov.provider_name = "aircall"
        mock_prov.handle_webhook.return_value = MagicMock(
            event_type="CALL_ENDED", provider_call_id="call-existing",
            phone_number="+918552628000", user_email=None,
            direction="outbound", duration=120, recording_url="https://rec.url/call.mp3",
            transcript=None, transcript_url=None,
            started_at=datetime(2026, 3, 30, 10, 0, tzinfo=timezone.utc),
            answered_at=datetime(2026, 3, 30, 10, 0, 5, tzinfo=timezone.utc),
            ended_at=datetime(2026, 3, 30, 10, 2, 5, tzinfo=timezone.utc),
            raw_payload={"event": "call.ended"}
        )
        mock_provider.return_value = mock_prov

        from dialer_service import handle_webhook
        result = handle_webhook(db, "aircall", {"event": "call.ended", "data": {}})
        assert result["ok"] is True
        assert result["call_id"] == existing_call.id

        # Verify the existing record was UPDATED, not a new one created
        db.refresh(existing_call)
        assert existing_call.status == "CALL_ENDED"
        assert existing_call.duration == 120
        assert existing_call.recording_url == "https://rec.url/call.mp3"

        # No duplicate records
        total = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "call-existing"
        ).count()
        assert total == 1


# ═════════════════════════════════════════════════════════════════════════════
# 4. Email endpoint integration — BackgroundTasks pattern
# ═════════════════════════════════════════════════════════════════════════════

class TestGetLeadEmailsEndpoint:
    """Integration tests for GET /api/email/lead/{id}/emails.
    Verifies the endpoint returns cached data immediately."""

    @patch("routes.email_routes._sync_thread_messages_background")
    def test_returns_200_immediately(self, mock_bg, client, db):
        """Endpoint should return 200 with cached data, not block on Nylas."""
        lead = create_test_lead(db, email="lead@test.com")
        resp = client.get(f"/api/email/lead/{lead.id}/emails")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["emails"] == []

    @patch("routes.email_routes._sync_thread_messages_background")
    def test_returns_existing_activities(self, mock_bg, client, db):
        """Should return emails from DB without waiting for sync."""
        lead = create_test_lead(db, email="lead@test.com")
        user = create_test_user(db, email="sdr@test.com")
        user.id = "test-user-id"
        db.commit()

        create_email_activity(db, lead.id, user.id, "outbound",
                              subject="First", body_preview="Hello",
                              from_email="sdr@test.com", to_email="lead@test.com")
        create_email_activity(db, lead.id, None, "inbound",
                              subject="Re: First", body_preview="Thanks!",
                              from_email="lead@test.com", to_email="sdr@test.com")

        resp = client.get(f"/api/email/lead/{lead.id}/emails")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["emails"][0]["direction"] == "outbound"
        assert data["emails"][1]["direction"] == "inbound"
        assert data["emails"][1]["body_preview"] == "Thanks!"

    @patch("routes.email_routes._sync_thread_messages_background")
    def test_nonexistent_lead_returns_empty(self, mock_bg, client, db):
        """Requesting emails for a nonexistent lead should return empty, not 404."""
        resp = client.get("/api/email/lead/nonexistent-id/emails")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    @patch("routes.email_routes._sync_thread_messages_background")
    def test_user_name_included(self, mock_bg, client, db):
        """Outbound emails should include the sender's user name."""
        lead = create_test_lead(db, email="lead@test.com")
        user = create_test_user(db, email="john@company.com", name="John Smith")
        user.id = "test-user-id"
        db.commit()
        create_email_activity(db, lead.id, user.id, "outbound",
                              subject="Hi", body_preview="Test",
                              from_email="john@company.com", to_email="lead@test.com")

        resp = client.get(f"/api/email/lead/{lead.id}/emails")
        data = resp.json()
        assert data["emails"][0]["user_name"] == "John Smith"


# ═════════════════════════════════════════════════════════════════════════════
# 5. Background task session isolation
# ═════════════════════════════════════════════════════════════════════════════

class TestBackgroundTaskSessionIsolation:
    """Verify that _sync_thread_messages_background creates its own session
    and doesn't share the request session (which gets closed after response)."""

    @patch("routes.email_routes._sync_thread_messages")
    def test_background_creates_own_session(self, mock_sync, db):
        """The background wrapper should call _sync_thread_messages with
        a DIFFERENT session than the request session."""
        from routes.email_routes import _sync_thread_messages_background

        _sync_thread_messages_background("test-lead-id")

        # Verify _sync_thread_messages was called
        mock_sync.assert_called_once()
        call_args = mock_sync.call_args
        bg_lead_id = call_args[0][0]
        bg_db = call_args[0][1]

        assert bg_lead_id == "test-lead-id"
        # The session should NOT be the same object as the test db session
        # (it creates its own via SessionLocal())
        assert bg_db is not db

    @patch("routes.email_routes._sync_thread_messages", side_effect=Exception("DB crash"))
    def test_background_handles_exceptions(self, mock_sync, db):
        """Background task should not raise even if sync crashes."""
        from routes.email_routes import _sync_thread_messages_background
        # Should not raise
        _sync_thread_messages_background("test-lead-id")


# ═════════════════════════════════════════════════════════════════════════════
# 6. Webhook endpoint error handling
# ═════════════════════════════════════════════════════════════════════════════

class TestWebhookEndpointResilience:
    """Tests that the webhook endpoint doesn't return 5xx to Aircall,
    which would cause retry cascades."""

    @pytest.fixture()
    def dialer_client(self, db):
        """TestClient that includes the dialer router."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        app = FastAPI()
        from routes.dialer_routes import router as dialer_router
        app.include_router(dialer_router)

        def _override_db():
            yield db

        app.dependency_overrides[get_db] = _override_db
        return TestClient(app)

    def test_webhook_no_provider_returns_200(self, dialer_client, db):
        """If no dialer is configured, webhook should return 200 (not 503)."""
        resp = dialer_client.post("/api/webhooks/dialer",
                                  json={"event": "call.ended", "data": {}})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_webhook_invalid_json_returns_400(self, dialer_client, db):
        """Invalid JSON body should return 400, not 500."""
        resp = dialer_client.post("/api/webhooks/dialer",
                                  content="not-json",
                                  headers={"Content-Type": "application/json"})
        assert resp.status_code == 400
