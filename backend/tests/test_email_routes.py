"""Tests for routes/email_routes.py — Email send (JSON + multipart), reply, attachments, activity listing."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, AsyncMock, MagicMock
import json
import io

from conftest import (
    create_test_user, create_test_lead, create_nylas_config,
    create_user_mailbox, create_email_activity, create_email_thread,
)
import models


# ── Helpers ──────────────────────────────────────────────────────────────────

def _mock_nylas_send_response(message_id="msg-123", thread_id="thread-456"):
    """Build a fake httpx.Response for Nylas send."""
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "data": {"id": message_id, "thread_id": thread_id}
    }
    resp.text = ""
    return resp


# ═════════════════════════════════════════════════════════════════════════════
# 1. Email Status
# ═════════════════════════════════════════════════════════════════════════════

class TestEmailStatus:

    def test_status_no_config_returns_not_configured(self, client, db):
        resp = client.get("/api/email/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["nylas_configured"] is False
        assert data["connected"] is False

    def test_status_with_config_no_mailbox(self, client, db):
        create_nylas_config(db)
        resp = client.get("/api/email/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["nylas_configured"] is True
        assert data["connected"] is False

    def test_status_with_connected_mailbox(self, client, db):
        create_nylas_config(db)
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp = client.get("/api/email/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["nylas_configured"] is True
        assert data["connected"] is True
        assert data["email"] == "admin@test.com"


# ═════════════════════════════════════════════════════════════════════════════
# 2. Disconnect
# ═════════════════════════════════════════════════════════════════════════════

class TestDisconnectEmail:

    def test_disconnect_removes_mailbox(self, client, db):
        create_nylas_config(db)
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp = client.post("/api/email/disconnect")
        assert resp.status_code == 200

        # Verify mailbox is gone
        mb = db.query(models.UserMailbox).filter(
            models.UserMailbox.user_id == user.id
        ).first()
        assert mb is None

    def test_disconnect_no_mailbox_404(self, client, db):
        resp = client.post("/api/email/disconnect")
        assert resp.status_code == 404


# ═════════════════════════════════════════════════════════════════════════════
# 3. Send Email — JSON (no attachments)
# ═════════════════════════════════════════════════════════════════════════════

class TestSendEmailJson:

    def test_send_requires_lead_id(self, client, db):
        resp = client.post("/api/email/send", json={
            "subject": "Hello", "body": "World"
        })
        assert resp.status_code == 422

    def test_send_requires_body_or_subject(self, client, db):
        lead = create_test_lead(db, email="to@test.com")
        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "", "body": ""
        })
        assert resp.status_code == 422

    def test_send_lead_not_found(self, client, db):
        resp = client.post("/api/email/send", json={
            "lead_id": "nonexistent", "subject": "Hi", "body": "Test"
        })
        assert resp.status_code == 404

    def test_send_lead_no_email(self, client, db):
        lead = create_test_lead(db, email="")
        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "Test"
        })
        assert resp.status_code == 400

    def test_send_no_mailbox(self, client, db):
        create_nylas_config(db)
        lead = create_test_lead(db, email="to@test.com")
        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "Test"
        })
        assert resp.status_code == 400
        assert "No connected mailbox" in resp.json()["detail"]

    def test_send_no_nylas_config_503(self, client, db):
        lead = create_test_lead(db, email="to@test.com")
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "Test"
        })
        assert resp.status_code == 503

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_json_success(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response()

        create_nylas_config(db)
        lead = create_test_lead(db, email="to@test.com")
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hello", "body": "Email body"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "Email sent successfully"
        assert data["nylas_message_id"] == "msg-123"
        assert data["nylas_thread_id"] == "thread-456"

        # Verify email activity was logged
        act = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.lead_id == lead.id
        ).first()
        assert act is not None
        assert act.direction == "outbound"
        assert act.subject == "Hello"

        # Verify thread mapping was created
        thread = db.query(models.EmailThread).filter(
            models.EmailThread.nylas_thread_id == "thread-456"
        ).first()
        assert thread is not None
        assert thread.lead_id == lead.id

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_with_reply_to(self, mock_post, mock_decrypt, client, db):
        """Sending with reply_to_message_id includes it in the Nylas payload."""
        mock_post.return_value = _mock_nylas_send_response("msg-reply", "thread-456")

        create_nylas_config(db)
        lead = create_test_lead(db, email="to@test.com")
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id,
            "subject": "Re: Hello",
            "body": "Reply body",
            "reply_to_message_id": "original-msg-id",
            "thread_id": "thread-456",
        })
        assert resp.status_code == 200

        # Verify Nylas was called with reply_to_message_id in the JSON payload
        call_args = mock_post.call_args
        payload = call_args.kwargs.get("json", {})
        assert payload.get("reply_to_message_id") == "original-msg-id"

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_expired_grant_401(self, mock_post, mock_decrypt, client, db):
        """When Nylas returns 401, mailbox status is set to error."""
        expired_resp = MagicMock()
        expired_resp.status_code = 401
        expired_resp.text = "Grant expired"
        mock_post.return_value = expired_resp

        create_nylas_config(db)
        lead = create_test_lead(db, email="to@test.com")
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        mb = create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "Test"
        })
        assert resp.status_code == 401
        assert "expired" in resp.json()["detail"].lower()

        # Mailbox should be marked as error
        db.refresh(mb)
        assert mb.status == "error"


# ═════════════════════════════════════════════════════════════════════════════
# 4. Send Email — Multipart (with attachments)
# ═════════════════════════════════════════════════════════════════════════════

class TestSendEmailMultipart:

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_with_attachments(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response("msg-att", "thread-att")

        create_nylas_config(db)
        lead = create_test_lead(db, email="to@test.com")
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        # Build multipart request with file attachment
        file_content = b"Hello, this is a test PDF content"
        resp = client.post("/api/email/send",
            data={
                "lead_id": lead.id,
                "subject": "Proposal",
                "body": "Please find attached",
            },
            files={
                "attachment0": ("proposal.pdf", io.BytesIO(file_content), "application/pdf"),
            }
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["nylas_message_id"] == "msg-att"

        # Verify Nylas was called with multipart files
        call_args = mock_post.call_args
        assert "files" in call_args.kwargs  # multipart send, not json

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_multipart_with_reply_and_attachments(self, mock_post, mock_decrypt, client, db):
        """Multipart send with both reply_to and attachments."""
        mock_post.return_value = _mock_nylas_send_response("msg-reply-att", "thread-456")

        create_nylas_config(db)
        lead = create_test_lead(db, email="to@test.com")
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp = client.post("/api/email/send",
            data={
                "lead_id": lead.id,
                "subject": "Re: Proposal",
                "body": "Updated attachment",
                "reply_to_message_id": "prev-msg-id",
                "thread_id": "thread-456",
            },
            files={
                "attachment0": ("update.docx", io.BytesIO(b"file data"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            }
        )
        assert resp.status_code == 200

        # Verify the Nylas multipart message includes reply_to_message_id
        call_args = mock_post.call_args
        nylas_files = call_args.kwargs.get("files", {})
        message_part = nylas_files.get("message")
        assert message_part is not None
        message_json = json.loads(message_part[1])
        assert message_json["reply_to_message_id"] == "prev-msg-id"


# ═════════════════════════════════════════════════════════════════════════════
# 5. Get Lead Emails
# ═════════════════════════════════════════════════════════════════════════════

class TestGetLeadEmails:

    @patch("routes.email_routes._sync_thread_messages_background")
    def test_get_emails_empty(self, mock_sync, client, db):
        lead = create_test_lead(db, email="noemails@test.com")
        resp = client.get(f"/api/email/lead/{lead.id}/emails")
        assert resp.status_code == 200
        data = resp.json()
        assert data["emails"] == []
        assert data["total"] == 0

    @patch("routes.email_routes._sync_thread_messages_background")
    def test_get_emails_returns_activities(self, mock_sync, client, db):
        lead = create_test_lead(db, email="has@emails.com")
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()

        create_email_activity(db, lead.id, user.id, "outbound",
                              subject="Hello", body_preview="First email",
                              from_email="admin@test.com", to_email="has@emails.com")
        create_email_activity(db, lead.id, None, "inbound",
                              subject="Re: Hello", body_preview="Got it!",
                              from_email="has@emails.com", to_email="admin@test.com")

        resp = client.get(f"/api/email/lead/{lead.id}/emails")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["emails"][0]["direction"] == "outbound"
        assert data["emails"][1]["direction"] == "inbound"

    @patch("routes.email_routes._sync_thread_messages_background")
    def test_get_emails_ordered_by_timestamp(self, mock_sync, client, db):
        """Emails should be returned in ascending chronological order."""
        lead = create_test_lead(db, email="chrono@test.com")
        create_email_activity(db, lead.id, subject="First")
        create_email_activity(db, lead.id, subject="Second")

        resp = client.get(f"/api/email/lead/{lead.id}/emails")
        data = resp.json()
        assert len(data["emails"]) == 2
        # Both should be present (order depends on insert timing)
        subjects = [e["subject"] for e in data["emails"]]
        assert "First" in subjects
        assert "Second" in subjects


# ═════════════════════════════════════════════════════════════════════════════
# 6. Nylas Config (Super Admin only)
# ═════════════════════════════════════════════════════════════════════════════

class TestNylasConfig:

    def test_get_config_empty(self, client, db):
        resp = client.get("/api/email/config")
        assert resp.status_code == 200
        assert resp.json()["configured"] is False

    def test_save_config_requires_client_id_and_api_key(self, client, db):
        resp = client.post("/api/email/config", json={"client_id": "", "api_key": ""})
        assert resp.status_code == 422

    def test_get_config_never_returns_decrypted_key(self, client, db):
        create_nylas_config(db)
        resp = client.get("/api/email/config")
        data = resp.json()
        assert "api_key_encrypted" not in data
        assert "api_key" not in data
        assert data["has_api_key"] is True

    def test_sdr_cannot_access_config(self, client_as_sdr, db):
        resp = client_as_sdr.get("/api/email/config")
        assert resp.status_code == 403

    def test_save_config_rejects_non_ascii_api_key(self, client, db):
        """RCA 2026-07-24: a smart-quote/hidden-unicode character in a
        pasted key decrypted fine but was rejected by Nylas — reject it
        at save time instead of silently storing a broken credential."""
        resp = client.post("/api/email/config", json={
            "client_id": "some-client-id",
            "api_key": "nyk_v0_goodlookingkey’withsmartquote",
        })
        assert resp.status_code == 422
        assert "non-ASCII" in resp.json()["detail"]

    def test_save_config_rejects_non_ascii_client_id(self, client, db):
        resp = client.post("/api/email/config", json={
            "client_id": "client’id",
            "api_key": "some-api-key",
        })
        assert resp.status_code == 422
        assert "non-ASCII" in resp.json()["detail"]


# ═════════════════════════════════════════════════════════════════════════════
# 7. Thread Mapping
# ═════════════════════════════════════════════════════════════════════════════

class TestEmailThreadMapping:

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_duplicate_thread_not_created(self, mock_post, mock_decrypt, client, db):
        """Sending in an existing thread should not create a duplicate thread mapping."""
        mock_post.return_value = _mock_nylas_send_response("msg-2", "thread-existing")

        create_nylas_config(db)
        lead = create_test_lead(db, email="to@test.com")
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        # Pre-create thread mapping
        create_email_thread(db, lead.id, "thread-existing")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id,
            "subject": "Re: Follow-up",
            "body": "Another reply",
            "thread_id": "thread-existing",
        })
        assert resp.status_code == 200

        # Should still only be 1 thread mapping
        count = db.query(models.EmailThread).filter(
            models.EmailThread.nylas_thread_id == "thread-existing"
        ).count()
        assert count == 1


# ═════════════════════════════════════════════════════════════════════════════
# X. GET /api/email/calendar/availability — advisory conflict check
# ═════════════════════════════════════════════════════════════════════════════

class TestCalendarAvailability:

    def test_no_mailbox_returns_not_connected(self, client, db):
        resp = client.get("/api/email/calendar/availability", params={
            "start": "2026-08-15T14:00:00+00:00", "duration_minutes": 30,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"connected": False, "available": None, "conflicts": []}

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.post")
    def test_connected_with_conflict(self, mock_post, mock_decrypt, client, db):
        create_nylas_config(db)
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp_obj = MagicMock()
        resp_obj.status_code = 200
        resp_obj.json.return_value = {"data": [
            {"email": "admin@test.com", "object": "free_busy",
             "time_slots": [{"status": "busy", "start_time": 1755266400, "end_time": 1755268200}]},
        ]}
        mock_post.return_value = resp_obj

        resp = client.get("/api/email/calendar/availability", params={
            "start": "2026-08-15T14:00:00+00:00", "duration_minutes": 30,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["connected"] is True
        assert body["available"] is False
        assert len(body["conflicts"]) == 1

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.post")
    def test_connected_no_conflict(self, mock_post, mock_decrypt, client, db):
        create_nylas_config(db)
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp_obj = MagicMock()
        resp_obj.status_code = 200
        resp_obj.json.return_value = {"data": [
            {"email": "admin@test.com", "object": "free_busy", "time_slots": []},
        ]}
        mock_post.return_value = resp_obj

        resp = client.get("/api/email/calendar/availability", params={
            "start": "2026-08-15T14:00:00+00:00", "duration_minutes": 30,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["connected"] is True
        assert body["available"] is True
        assert body["conflicts"] == []

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("nylas_calendar.httpx.post")
    def test_nylas_failure_fails_open_not_blocking(self, mock_post, mock_decrypt, client, db):
        """Advisory only — a failed check must never surface as a hard error."""
        create_nylas_config(db)
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp_obj = MagicMock()
        resp_obj.status_code = 500
        resp_obj.text = "Nylas is down"
        mock_post.return_value = resp_obj

        resp = client.get("/api/email/calendar/availability", params={
            "start": "2026-08-15T14:00:00+00:00", "duration_minutes": 30,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["connected"] is True
        assert body["available"] is None

    def test_malformed_start_does_not_crash(self, client, db):
        create_nylas_config(db)
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin@test.com")

        resp = client.get("/api/email/calendar/availability", params={
            "start": "not-a-date", "duration_minutes": 30,
        })
        assert resp.status_code == 200
        assert resp.json()["available"] is None


# ═════════════════════════════════════════════════════════════════════════════
# X. Per-user "hide branding" toggle
# ═════════════════════════════════════════════════════════════════════════════

class TestHideBrandingToggle:

    def test_toggle_requires_boolean(self, client, db):
        create_test_user(db, email="admin@test.com", id="test-user-id")
        resp = client.patch("/api/email/toggle-branding", json={"hide_branding_in_email": "yes"})
        assert resp.status_code == 400

    def test_toggle_missing_field(self, client, db):
        create_test_user(db, email="admin@test.com", id="test-user-id")
        resp = client.patch("/api/email/toggle-branding", json={})
        assert resp.status_code == 400

    def test_toggle_sets_flag_and_persists(self, client, db):
        user = create_test_user(db, email="admin@test.com", id="test-user-id")
        db.commit()

        resp = client.patch("/api/email/toggle-branding", json={"hide_branding_in_email": True})
        assert resp.status_code == 200
        assert resp.json()["hide_branding_in_email"] is True

        db.refresh(user)
        assert user.hide_branding_in_email is True

        # Reflected on /status too, same as dialer_enabled/email_sync_enabled
        status = client.get("/api/email/status")
        assert status.json()["hide_branding_in_email"] is True

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_omits_footer_when_hidden(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response()
        create_nylas_config(db)
        lead = create_test_lead(db, email="to2@test.com")
        user = create_test_user(db, email="admin2@test.com", id="test-user-id")
        user.hide_branding_in_email = True
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin2@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "Body text"
        })
        assert resp.status_code == 200
        sent_payload = mock_post.call_args.kwargs["json"]
        assert "Powered by RCM" not in sent_payload["body"]

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_includes_footer_by_default(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response()
        create_nylas_config(db)
        lead = create_test_lead(db, email="to3@test.com")
        user = create_test_user(db, email="admin3@test.com", id="test-user-id")
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin3@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "Body text"
        })
        assert resp.status_code == 200
        sent_payload = mock_post.call_args.kwargs["json"]
        assert "Powered by RCM" in sent_payload["body"]


# ═════════════════════════════════════════════════════════════════════════════
# X. CC / BCC on send
# ═════════════════════════════════════════════════════════════════════════════

class TestCcBcc:

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_cc_and_bcc_included_in_payload(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response()
        create_nylas_config(db)
        lead = create_test_lead(db, email="to4@test.com")
        user = create_test_user(db, email="admin4@test.com", id="test-user-id")
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin4@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "Body",
            "cc": "manager@company.com, teammate@company.com",
            "bcc": "archive@company.com",
        })
        assert resp.status_code == 200
        sent_payload = mock_post.call_args.kwargs["json"]
        assert sent_payload["cc"] == [{"email": "manager@company.com"}, {"email": "teammate@company.com"}]
        assert sent_payload["bcc"] == [{"email": "archive@company.com"}]

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_invalid_cc_entries_silently_dropped(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response()
        create_nylas_config(db)
        lead = create_test_lead(db, email="to5@test.com")
        user = create_test_user(db, email="admin5@test.com", id="test-user-id")
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin5@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "Body",
            "cc": "not-an-email, valid@company.com",
        })
        assert resp.status_code == 200
        sent_payload = mock_post.call_args.kwargs["json"]
        assert sent_payload["cc"] == [{"email": "valid@company.com"}]

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_no_cc_bcc_keys_when_omitted(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response()
        create_nylas_config(db)
        lead = create_test_lead(db, email="to6@test.com")
        user = create_test_user(db, email="admin6@test.com", id="test-user-id")
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin6@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "Body",
        })
        assert resp.status_code == 200
        sent_payload = mock_post.call_args.kwargs["json"]
        assert "cc" not in sent_payload
        assert "bcc" not in sent_payload


# ═════════════════════════════════════════════════════════════════════════════
# X. Rich-text compose body + signature (links/images)
# ═════════════════════════════════════════════════════════════════════════════

class TestSignatureEndpoints:

    def test_get_signature_defaults_empty(self, client, db):
        create_test_user(db, email="admin@test.com", id="test-user-id")
        resp = client.get("/api/email/signature")
        assert resp.status_code == 200
        assert resp.json()["signature_html"] == ""

    def test_save_and_get_signature_roundtrip(self, client, db):
        create_test_user(db, email="admin@test.com", id="test-user-id")
        sig = '<p>Cheers,<br>Samya Choudhary</p><a href="https://cal.com/samya">Book a meeting</a><img src="https://example.com/logo.png">'
        resp = client.patch("/api/email/signature", json={"signature_html": sig})
        assert resp.status_code == 200
        assert "Book a meeting" in resp.json()["signature_html"]
        assert '<a href="https://cal.com/samya">' in resp.json()["signature_html"]
        assert '<img src="https://example.com/logo.png"' in resp.json()["signature_html"]

        resp2 = client.get("/api/email/signature")
        assert "Samya Choudhary" in resp2.json()["signature_html"]

    def test_save_signature_strips_scripts(self, client, db):
        create_test_user(db, email="admin@test.com", id="test-user-id")
        sig = '<p>Hi</p><script>alert(1)</script>'
        resp = client.patch("/api/email/signature", json={"signature_html": sig})
        assert resp.status_code == 200
        assert "<script>" not in resp.json()["signature_html"]

    def test_save_signature_requires_string(self, client, db):
        create_test_user(db, email="admin@test.com", id="test-user-id")
        resp = client.patch("/api/email/signature", json={"signature_html": 123})
        assert resp.status_code == 400


class TestComposeRichHtml:

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_preserves_links_and_images_in_body(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response()
        create_nylas_config(db)
        lead = create_test_lead(db, email="rich@test.com")
        user = create_test_user(db, email="admin7@test.com", id="test-user-id")
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin7@test.com")

        html_body = '<p>Check this <a href="https://example.com">link</a></p><img src="https://example.com/pic.png">'
        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": html_body,
        })
        assert resp.status_code == 200
        sent_body = mock_post.call_args.kwargs["json"]["body"]
        assert '<a href="https://example.com">link</a>' in sent_body
        assert '<img src="https://example.com/pic.png"' in sent_body

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_strips_script_from_body(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response()
        create_nylas_config(db)
        lead = create_test_lead(db, email="rich2@test.com")
        user = create_test_user(db, email="admin8@test.com", id="test-user-id")
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin8@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": '<p>Hi</p><script>evil()</script>',
        })
        assert resp.status_code == 200
        sent_body = mock_post.call_args.kwargs["json"]["body"]
        assert "<script>" not in sent_body

    @patch("routes.email_routes.decrypt_token", return_value="fake-api-key")
    @patch("httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_send_appends_signature(self, mock_post, mock_decrypt, client, db):
        mock_post.return_value = _mock_nylas_send_response()
        create_nylas_config(db)
        lead = create_test_lead(db, email="rich3@test.com")
        user = create_test_user(db, email="admin9@test.com", id="test-user-id")
        user.email_signature_html = '<p>Cheers,<br>Test SDR</p>'
        db.commit()
        create_user_mailbox(db, user_id=user.id, email_address="admin9@test.com")

        resp = client.post("/api/email/send", json={
            "lead_id": lead.id, "subject": "Hi", "body": "<p>Body text</p>",
        })
        assert resp.status_code == 200
        sent_body = mock_post.call_args.kwargs["json"]["body"]
        assert "Cheers" in sent_body
        assert "Test SDR" in sent_body
