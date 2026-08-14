"""
Stage 1 Email Hotfix Tests.

Covers:
  1. Open tracking time-gate (_handle_message_opened)
  2. Full mailbox sync (_sync_full_mailbox)
  3. Webhook inbound fallback (_handle_inbound_message with no thread mapping)
"""
import os
import sys
import json
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

import pytest

_backend_dir = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _backend_dir)

# Set encryption key before importing crypto-dependent modules
os.environ.setdefault("APP_ENCRYPTION_KEY", "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXRlc3Q=")

import models
from crypto import encrypt_token


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_lead(db, email="lead@example.com"):
    lead = models.Lead(
        id=str(uuid.uuid4()),
        first_name="Test",
        last_name="Lead",
        email=email,
        status="Lead Assigned",
        lead_source="uploaded",
    )
    db.add(lead)
    db.flush()
    return lead


def _make_user(db, email="sdr@company.com", role="SDR"):
    user = models.User(
        id=str(uuid.uuid4()),
        name="Test SDR",
        email=email,
        role=role,
        email_sync_enabled=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_mailbox(db, user_id, email="sdr@company.com", grant_id="grant-abc123"):
    mailbox = models.UserMailbox(
        user_id=user_id,
        email_address=email,
        provider="google",
        nylas_grant_id=grant_id,
        status="connected",
    )
    db.add(mailbox)
    db.flush()
    return mailbox


def _make_nylas_config(db):
    cfg = models.NylasConfig(
        id=1,
        client_id="client-123",
        api_key_encrypted=encrypt_token("api-key-xyz"),
        is_active=True,
    )
    db.add(cfg)
    db.flush()
    return cfg


def _make_email_activity(
    db,
    lead_id,
    user_id=None,
    direction="outbound",
    nylas_message_id="msg-001",
    open_count=0,
    opened_at=None,
    timestamp=None,
):
    activity = models.LeadEmailActivity(
        lead_id=lead_id,
        user_id=user_id,
        direction=direction,
        subject="Test Subject",
        body_preview="Test body",
        from_email="sdr@company.com" if direction == "outbound" else "lead@example.com",
        to_email="lead@example.com" if direction == "outbound" else "sdr@company.com",
        nylas_message_id=nylas_message_id,
        nylas_thread_id="thread-001",
        timestamp=timestamp or datetime.now(timezone.utc),
        open_count=open_count,
        opened_at=opened_at,
    )
    db.add(activity)
    db.flush()
    return activity


def _make_thread(db, lead_id, nylas_thread_id="thread-001"):
    t = models.EmailThread(nylas_thread_id=nylas_thread_id, lead_id=lead_id)
    db.add(t)
    db.flush()
    return t


# ══════════════════════════════════════════════════════════════════════════════
# 1. Open Tracking Time-Gate Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestOpenTrackingTimeGate:
    """_handle_message_opened — 10-second time-gate heuristic."""

    def _call_handler(self, obj_data, db):
        from routes.webhook_routes import _handle_message_opened
        _handle_message_opened(obj_data, db)
        db.commit()

    def test_first_open_within_10s_is_skipped(self, db):
        """Open within 10s of send → skipped (sender preview)."""
        lead = _make_lead(db)
        # Sent 5 seconds ago
        sent_at = datetime.now(timezone.utc) - timedelta(seconds=5)
        activity = _make_email_activity(db, lead.id, timestamp=sent_at)
        db.commit()

        self._call_handler({"message_id": activity.nylas_message_id}, db)
        db.refresh(activity)

        assert activity.open_count == 0
        assert activity.opened_at is None

    def test_first_open_after_10s_is_counted(self, db):
        """Open >10s after send → counted as genuine lead open."""
        lead = _make_lead(db)
        sent_at = datetime.now(timezone.utc) - timedelta(seconds=60)
        activity = _make_email_activity(db, lead.id, timestamp=sent_at)
        db.commit()

        self._call_handler({"message_id": activity.nylas_message_id}, db)
        db.refresh(activity)

        assert activity.open_count >= 1
        assert activity.opened_at is not None

    def test_second_open_always_counted(self, db):
        """Second open always increments regardless of timing."""
        lead = _make_lead(db)
        sent_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        # Already has one counted open
        activity = _make_email_activity(
            db, lead.id, timestamp=sent_at, open_count=1,
            opened_at=datetime.now(timezone.utc) - timedelta(minutes=3)
        )
        db.commit()

        self._call_handler({"message_id": activity.nylas_message_id}, db)
        db.refresh(activity)

        assert activity.open_count >= 2

    def test_null_timestamp_first_open_counted(self, db):
        """No timestamp on record → skip time-gate, count the open."""
        lead = _make_lead(db)
        activity = _make_email_activity(db, lead.id, timestamp=None)
        activity.timestamp = None  # explicitly null
        db.commit()

        self._call_handler({"message_id": activity.nylas_message_id}, db)
        db.refresh(activity)

        # Should count (no timestamp = can't determine elapsed, count it)
        assert activity.open_count >= 1

    def test_inbound_email_open_counted_immediately(self, db):
        """Inbound emails have no sender heuristic — always count from first open."""
        lead = _make_lead(db)
        sent_at = datetime.now(timezone.utc) - timedelta(seconds=2)
        activity = _make_email_activity(
            db, lead.id, direction="inbound",
            nylas_message_id="msg-inbound-001", timestamp=sent_at
        )
        db.commit()

        self._call_handler({"message_id": activity.nylas_message_id}, db)
        db.refresh(activity)

        assert activity.open_count == 1
        assert activity.opened_at is not None

    def test_open_for_unknown_message_id_ignored(self, db):
        """Unknown message_id → no crash, no DB mutation."""
        self._call_handler({"message_id": "non-existent-msg-id"}, db)
        # No error raised — test passes

    def test_open_count_increments_correctly_on_multiple_opens(self, db):
        """Multiple open events increment counter each time."""
        lead = _make_lead(db)
        sent_at = datetime.now(timezone.utc) - timedelta(hours=2)
        activity = _make_email_activity(db, lead.id, timestamp=sent_at, open_count=1,
                                        opened_at=datetime.now(timezone.utc) - timedelta(hours=1))
        db.commit()

        # Fire 3 more open events
        for _ in range(3):
            self._call_handler({"message_id": activity.nylas_message_id}, db)

        db.refresh(activity)
        assert activity.open_count >= 3

    def test_opened_at_set_on_first_counted_open(self, db):
        """opened_at is set on the first counted open and not overwritten on subsequent opens."""
        lead = _make_lead(db)
        sent_at = datetime.now(timezone.utc) - timedelta(hours=1)
        activity = _make_email_activity(db, lead.id, timestamp=sent_at)
        db.commit()

        self._call_handler({"message_id": activity.nylas_message_id}, db)
        db.refresh(activity)
        first_opened_at = activity.opened_at

        # Second open
        self._call_handler({"message_id": activity.nylas_message_id}, db)
        db.refresh(activity)

        # opened_at should not change after first set
        assert activity.opened_at == first_opened_at


# ══════════════════════════════════════════════════════════════════════════════
# 2. Full Mailbox Sync Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestFullMailboxSync:
    """_sync_full_mailbox — Gmail/direct-send capture."""

    def _make_nylas_message(self, msg_id="msg-gmail-001", from_email="sdr@company.com",
                             to_email="lead@example.com", subject="Gmail Email",
                             body="Hello from Gmail", thread_id="thread-gmail-001",
                             date_offset_hours=-2):
        import time
        return {
            "id": msg_id,
            "from": [{"email": from_email, "name": "SDR"}],
            "to": [{"email": to_email, "name": "Lead"}],
            "subject": subject,
            "body": body,
            "snippet": body[:100],
            "thread_id": thread_id,
            "date": int(time.time()) + int(date_offset_hours * 3600),
            "attachments": [],
        }

    def _run_sync(self, lead_id, db, nylas_messages=None, status_code=200):
        from routes.email_routes import _sync_full_mailbox

        mock_resp = MagicMock()
        mock_resp.status_code = status_code
        mock_resp.json.return_value = {"data": nylas_messages or []}

        with patch("routes.email_routes.httpx.get", return_value=mock_resp):
            _sync_full_mailbox(lead_id, db)

    def test_gmail_sent_email_appears_after_sync(self, db):
        """Outbound email sent directly from Gmail is captured by full sync."""
        lead = _make_lead(db, email="lead@example.com")
        user = _make_user(db)
        _make_mailbox(db, user.id, email="sdr@company.com")
        _make_nylas_config(db)
        db.commit()

        msg = self._make_nylas_message(
            msg_id="msg-gmail-new",
            from_email="sdr@company.com",
            to_email="lead@example.com",
        )
        self._run_sync(lead.id, db, nylas_messages=[msg])

        activity = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-gmail-new"
        ).first()
        assert activity is not None
        assert activity.direction == "outbound"
        assert activity.lead_id == lead.id

    def test_picks_assigned_sdrs_mailbox_when_no_prior_outbound(self, db):
        """2026-08-05: a lead only ever contacted via native Gmail (never
        through RCM's own compose) has no outbound activity with a
        user_id yet, so the mailbox fallback used to pick "any connected
        mailbox" — in a multi-SDR org that's frequently the WRONG SDR's
        grant, so the Nylas call searches the wrong inbox and finds nothing.
        Must prefer the lead's actually-assigned SDR's mailbox instead."""
        lead = _make_lead(db, email="lead@example.com")
        other_sdr = _make_user(db, email="other-sdr@company.com")
        _make_mailbox(db, other_sdr.id, email="other-sdr@company.com", grant_id="grant-other")
        assigned_sdr = _make_user(db, email="assigned-sdr@company.com")
        _make_mailbox(db, assigned_sdr.id, email="assigned-sdr@company.com", grant_id="grant-assigned")
        lead.assigned_users.append(assigned_sdr)
        _make_nylas_config(db)
        db.commit()

        from routes.email_routes import _sync_full_mailbox
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": []}
        with patch("routes.email_routes.httpx.get", return_value=mock_resp) as mock_get:
            _sync_full_mailbox(lead.id, db)

        called_url = mock_get.call_args[0][0]
        assert "grant-assigned" in called_url, (
            f"expected the sync to use the assigned SDR's mailbox grant, got: {called_url}"
        )

    def test_no_duplicate_on_resync(self, db):
        """Running sync twice does not create duplicate email records."""
        lead = _make_lead(db)
        user = _make_user(db)
        _make_mailbox(db, user.id)
        _make_nylas_config(db)
        # Pre-existing record
        _make_email_activity(db, lead.id, nylas_message_id="msg-existing")
        db.commit()

        msg = self._make_nylas_message(msg_id="msg-existing")
        self._run_sync(lead.id, db, nylas_messages=[msg])
        self._run_sync(lead.id, db, nylas_messages=[msg])

        count = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-existing"
        ).count()
        assert count == 1

    def test_inbound_email_captured_without_prior_thread(self, db):
        """Inbound email matching lead email captured even without existing thread mapping."""
        lead = _make_lead(db, email="lead@example.com")
        user = _make_user(db)
        _make_mailbox(db, user.id)
        _make_nylas_config(db)
        db.commit()

        msg = self._make_nylas_message(
            msg_id="msg-inbound-new",
            from_email="lead@example.com",  # inbound from lead
            to_email="sdr@company.com",
            thread_id="thread-brand-new",
        )
        self._run_sync(lead.id, db, nylas_messages=[msg])

        activity = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-inbound-new"
        ).first()
        assert activity is not None
        assert activity.direction == "inbound"

    def test_grant_expired_marks_mailbox_error(self, db):
        """Nylas 401 response marks the mailbox as error status."""
        lead = _make_lead(db)
        user = _make_user(db)
        mailbox = _make_mailbox(db, user.id)
        _make_nylas_config(db)
        db.commit()

        self._run_sync(lead.id, db, nylas_messages=[], status_code=401)

        db.refresh(mailbox)
        assert mailbox.status == "error"

    def test_lead_with_no_email_skips_sync(self, db):
        """Lead with no email address causes sync to exit gracefully."""
        lead = _make_lead(db, email=None)
        lead.email = None
        db.commit()

        # Should not raise
        from routes.email_routes import _sync_full_mailbox
        _sync_full_mailbox(lead.id, db)  # No mock needed — returns before Nylas call

    def test_no_connected_mailbox_falls_back_to_thread_sync(self, db):
        """When no connected mailbox exists, falls back to thread-level sync gracefully."""
        lead = _make_lead(db)
        _make_nylas_config(db)
        # No mailbox created
        db.commit()

        # Should not raise
        with patch("routes.email_routes._sync_thread_messages") as mock_thread_sync:
            from routes.email_routes import _sync_full_mailbox
            _sync_full_mailbox(lead.id, db)
            mock_thread_sync.assert_called_once_with(lead.id, db)

    def test_thread_mapping_created_for_new_gmail_thread(self, db):
        """A new EmailThread row is created when a Gmail-sent email has an unknown thread_id."""
        lead = _make_lead(db)
        user = _make_user(db)
        _make_mailbox(db, user.id)
        _make_nylas_config(db)
        db.commit()

        msg = self._make_nylas_message(
            msg_id="msg-new-thread",
            thread_id="brand-new-thread-xyz",
        )
        self._run_sync(lead.id, db, nylas_messages=[msg])

        thread = db.query(models.EmailThread).filter(
            models.EmailThread.nylas_thread_id == "brand-new-thread-xyz"
        ).first()
        assert thread is not None
        assert thread.lead_id == lead.id

    def test_nylas_rate_limit_skips_gracefully(self, db):
        """429 from Nylas — logs warning, no crash, no mutation."""
        lead = _make_lead(db)
        user = _make_user(db)
        _make_mailbox(db, user.id)
        _make_nylas_config(db)
        db.commit()

        before_count = db.query(models.LeadEmailActivity).count()
        self._run_sync(lead.id, db, nylas_messages=[], status_code=429)
        after_count = db.query(models.LeadEmailActivity).count()
        assert before_count == after_count

    def test_all_connected_mailboxes_checked_for_direction(self, db):
        """Outbound detection works even for secondary SDR mailboxes."""
        lead = _make_lead(db)
        user1 = _make_user(db, email="sdr1@company.com")
        user2 = _make_user(db, email="sdr2@company.com")
        _make_mailbox(db, user1.id, email="sdr1@company.com")
        _make_mailbox(db, user2.id, email="sdr2@company.com")
        _make_nylas_config(db)
        db.commit()

        # Email sent by sdr2 (secondary mailbox) should be detected as outbound
        msg = self._make_nylas_message(
            msg_id="msg-from-sdr2",
            from_email="sdr2@company.com",
            to_email="lead@example.com",
        )
        self._run_sync(lead.id, db, nylas_messages=[msg])

        activity = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-from-sdr2"
        ).first()
        assert activity is not None
        assert activity.direction == "outbound"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Webhook Inbound Fallback Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestWebhookInboundFallback:
    """_handle_inbound_message — lead-email fallback when no thread mapping."""

    def _call_handler(self, obj_data, thread_id, db):
        from routes.webhook_routes import _handle_inbound_message
        _handle_inbound_message(obj_data, thread_id, db)
        db.commit()

    def test_inbound_without_thread_matched_via_lead_email(self, db):
        """Inbound email with no thread mapping is captured by matching lead email."""
        lead = _make_lead(db, email="lead@example.com")
        user = _make_user(db)
        _make_mailbox(db, user.id)
        db.commit()

        obj_data = {
            "id": "msg-no-thread-001",
            "from": [{"email": "lead@example.com"}],
            "to": [{"email": "sdr@company.com"}],
            "subject": "Reply from Gmail",
            "body": "Here is my reply",
            "thread_id": "thread-new-from-gmail",
            "attachments": [],
        }
        self._call_handler(obj_data, "thread-new-from-gmail", db)

        activity = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-no-thread-001"
        ).first()
        assert activity is not None
        assert activity.lead_id == lead.id
        assert activity.direction == "inbound"

    def test_inbound_without_thread_no_lead_match_skipped(self, db):
        """Unknown from_email with no thread mapping → silently skipped."""
        db.commit()

        obj_data = {
            "id": "msg-unknown-sender",
            "from": [{"email": "stranger@nowhere.com"}],
            "to": [{"email": "sdr@company.com"}],
            "subject": "Spam",
            "body": "Buy now!",
            "thread_id": "thread-unknown",
            "attachments": [],
        }
        self._call_handler(obj_data, "thread-unknown", db)

        count = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-unknown-sender"
        ).count()
        assert count == 0

    def test_thread_mapping_created_on_webhook_fallback(self, db):
        """When webhook creates activity via fallback, EmailThread row is also created."""
        lead = _make_lead(db, email="lead@example.com")
        user = _make_user(db)
        _make_mailbox(db, user.id)
        db.commit()

        obj_data = {
            "id": "msg-fallback-thread",
            "from": [{"email": "lead@example.com"}],
            "to": [{"email": "sdr@company.com"}],
            "subject": "Fallback Test",
            "body": "Test body",
            "thread_id": "thread-fallback-created",
            "attachments": [],
        }
        self._call_handler(obj_data, "thread-fallback-created", db)

        thread = db.query(models.EmailThread).filter(
            models.EmailThread.nylas_thread_id == "thread-fallback-created"
        ).first()
        assert thread is not None
        assert thread.lead_id == lead.id

    def test_duplicate_webhook_event_deduplicated(self, db):
        """Same message_id arriving twice via webhook → only one activity row."""
        lead = _make_lead(db, email="lead@example.com")
        user = _make_user(db)
        _make_mailbox(db, user.id)
        _make_thread(db, lead.id, nylas_thread_id="thread-dup")
        db.commit()

        obj_data = {
            "id": "msg-dup-webhook",
            "from": [{"email": "lead@example.com"}],
            "to": [{"email": "sdr@company.com"}],
            "subject": "Duplicate",
            "body": "Test",
            "thread_id": "thread-dup",
            "attachments": [],
        }
        self._call_handler(obj_data, "thread-dup", db)
        self._call_handler(obj_data, "thread-dup", db)

        count = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-dup-webhook"
        ).count()
        assert count == 1
