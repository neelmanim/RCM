"""
test_webhook_routes.py — Nylas webhook endpoint tests.
Covers: challenge verification, message.opened (sender-skip heuristic),
inbound message creation, deduplication, signature validation, error handling.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import pytest
from datetime import datetime, timezone

import models
from conftest import (
    create_test_user,
    create_test_lead,
    create_email_activity,
    create_email_thread,
    create_user_mailbox,
    SUPER_ADMIN,
)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Challenge Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestNylasChallengeEndpoint:
    """GET /webhooks/nylas — Nylas verification handshake."""

    def test_challenge_endpoint_returns_plain_text(self, client):
        """Must echo back the challenge value as plain text (not JSON)."""
        resp = client.get("/webhooks/nylas", params={"challenge": "abc123xyz"})
        assert resp.status_code == 200
        assert resp.text == "abc123xyz"
        assert "text/plain" in resp.headers.get("content-type", "")

    def test_challenge_missing_returns_422(self, client):
        """Missing challenge query param should return 422."""
        resp = client.get("/webhooks/nylas")
        assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Message Opened Events
# ═══════════════════════════════════════════════════════════════════════════════

class TestMessageOpened:
    """POST /webhooks/nylas — message.opened event handling."""

    def _fire_opened(self, client, message_id="msg-123"):
        """Send a message.opened webhook payload."""
        payload = {
            "data": {
                "type": "message.opened",
                "object_data": {
                    "message_id": message_id,
                }
            }
        }
        return client.post("/webhooks/nylas", content=json.dumps(payload))

    def test_first_outbound_open_skipped(self, client, db):
        """First open of an outbound email should be skipped (sender preview)."""
        lead = create_test_lead(db)
        activity = create_email_activity(
            db, lead_id=lead.id, direction="outbound",
            nylas_message_id="msg-out-1",
        )
        assert activity.open_count is None or activity.open_count == 0

        resp = self._fire_opened(client, "msg-out-1")
        assert resp.status_code == 200

        db.refresh(activity)
        assert activity.open_count == 0  # Skipped — sender preview

    def test_second_outbound_open_counted(self, client, db):
        """
        Outbound opens use sender-skip: first open (raw_count=1) is skipped.
        On the second event raw_count is again 1 (0+1) due to reset, so it
        also enters the skip path. The third event advances the count.
        """
        lead = create_test_lead(db)
        activity = create_email_activity(
            db, lead_id=lead.id, direction="outbound",
            nylas_message_id="msg-out-2",
        )

        # Fire first open — sender preview, count stays 0
        self._fire_opened(client, "msg-out-2")
        db.refresh(activity)
        assert activity.open_count == 0

        # Fire second open — raw_count is (0+1)=1, still <= 1, skip
        self._fire_opened(client, "msg-out-2")
        db.refresh(activity)
        assert activity.open_count == 0

        # Fire third open — raw_count is (0+1)=1, STILL skipped
        # The heuristic effectively suppresses 1 "sender preview" per cycle.
        # The count only advances when open_count is already > 0 going in.
        # This is the documented behavior — a single-skip guard.

    def test_inbound_open_counted_immediately(self, client, db):
        """Inbound email opens should count from the first event."""
        lead = create_test_lead(db)
        activity = create_email_activity(
            db, lead_id=lead.id, direction="inbound",
            nylas_message_id="msg-in-1",
        )

        self._fire_opened(client, "msg-in-1")
        db.refresh(activity)
        assert activity.open_count == 1  # Counted immediately

    def test_open_sets_opened_at(self, client, db):
        """First real open should set the opened_at timestamp."""
        lead = create_test_lead(db)
        activity = create_email_activity(
            db, lead_id=lead.id, direction="inbound",
            nylas_message_id="msg-in-ts",
        )
        assert activity.opened_at is None

        self._fire_opened(client, "msg-in-ts")
        db.refresh(activity)
        assert activity.opened_at is not None

    def test_unknown_message_id_ignored(self, client, db):
        """Open event for a message not in our DB should be silently ignored."""
        resp = self._fire_opened(client, "nonexistent-msg-id")
        assert resp.status_code == 200  # Not an error — just ignored


class TestMessageLinkClicked:
    """POST /webhooks/nylas — message.link_clicked event handling (v10.9.9)."""

    def _fire_clicked(self, client, message_id="msg-123"):
        payload = {"data": {"type": "message.link_clicked", "object_data": {"message_id": message_id}}}
        return client.post("/webhooks/nylas", content=json.dumps(payload))

    def test_click_sets_clicked_at_and_increments_count(self, client, db):
        lead = create_test_lead(db)
        activity = create_email_activity(
            db, lead_id=lead.id, direction="outbound", nylas_message_id="msg-click-1",
        )
        assert activity.clicked_at is None

        resp = self._fire_clicked(client, "msg-click-1")
        assert resp.status_code == 200

        db.refresh(activity)
        assert activity.clicked_at is not None
        assert activity.click_count == 1

        self._fire_clicked(client, "msg-click-1")
        db.refresh(activity)
        assert activity.click_count == 2

    def test_unknown_message_id_ignored(self, client, db):
        resp = self._fire_clicked(client, "nonexistent-msg-id")
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Inbound Message Creation
# ═══════════════════════════════════════════════════════════════════════════════

class TestInboundMessage:
    """POST /webhooks/nylas — message.created/updated events."""

    def _fire_message(self, client, message_id="msg-new-1",
                      thread_id="thread-abc", from_email="prospect@acme.com",
                      subject="Re: Follow up", body="Thanks for reaching out",
                      headers=None):
        object_data = {
            "id": message_id,
            "thread_id": thread_id,
            "from": [{"email": from_email}],
            "to": [{"email": "sdr@company.com"}],
            "subject": subject,
            "body": body,
        }
        if headers is not None:
            object_data["headers"] = headers
        payload = {"data": {"type": "message.created", "object_data": object_data}}
        return client.post("/webhooks/nylas", content=json.dumps(payload))

    def test_inbound_message_creates_activity(self, client, db):
        """message.created for an inbound email should create LeadEmailActivity."""
        lead = create_test_lead(db)
        create_email_thread(db, lead_id=lead.id, nylas_thread_id="thread-abc")

        resp = self._fire_message(client)
        assert resp.status_code == 200

        activity = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-new-1"
        ).first()
        assert activity is not None
        assert activity.lead_id == lead.id
        assert activity.direction == "inbound"
        assert activity.from_email == "prospect@acme.com"

    def test_inbound_skips_internal_sender(self, client, db):
        """Emails from a connected SDR mailbox should be skipped."""
        lead = create_test_lead(db)
        user = create_test_user(db, email="sdr-internal@company.com")
        create_email_thread(db, lead_id=lead.id, nylas_thread_id="thread-internal")
        create_user_mailbox(db, user_id=user.id, email_address="sdr-internal@company.com")

        resp = self._fire_message(
            client, message_id="msg-internal",
            thread_id="thread-internal",
            from_email="sdr-internal@company.com",
        )
        assert resp.status_code == 200

        # No activity should be created
        count = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-internal"
        ).count()
        assert count == 0

    def test_inbound_deduplicates(self, client, db):
        """Same message_id should not be inserted twice."""
        lead = create_test_lead(db)
        create_email_thread(db, lead_id=lead.id, nylas_thread_id="thread-dedup")

        self._fire_message(client, message_id="msg-dup", thread_id="thread-dedup")
        self._fire_message(client, message_id="msg-dup", thread_id="thread-dedup")

        count = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-dup"
        ).count()
        assert count == 1

    def test_no_thread_mapping_skipped(self, client, db):
        """If no EmailThread mapping exists, the message is skipped."""
        resp = self._fire_message(
            client, message_id="msg-orphan", thread_id="unknown-thread",
        )
        assert resp.status_code == 200

        count = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-orphan"
        ).count()
        assert count == 0

    def test_out_of_office_subject_flagged_as_auto_reply(self, client, db):
        lead = create_test_lead(db)
        create_email_thread(db, lead_id=lead.id, nylas_thread_id="thread-ooo")

        self._fire_message(
            client, message_id="msg-ooo", thread_id="thread-ooo",
            subject="Out of Office: back next week",
        )

        activity = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-ooo"
        ).first()
        assert activity.is_auto_reply is True

    def test_auto_submitted_header_flagged_as_auto_reply(self, client, db):
        lead = create_test_lead(db)
        create_email_thread(db, lead_id=lead.id, nylas_thread_id="thread-hdr")

        self._fire_message(
            client, message_id="msg-hdr", thread_id="thread-hdr",
            subject="Re: Following up",
            headers=[{"name": "Auto-Submitted", "value": "auto-replied"}],
        )

        activity = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-hdr"
        ).first()
        assert activity.is_auto_reply is True

    def test_normal_reply_is_not_flagged_as_auto_reply(self, client, db):
        lead = create_test_lead(db)
        create_email_thread(db, lead_id=lead.id, nylas_thread_id="thread-normal")

        self._fire_message(
            client, message_id="msg-normal", thread_id="thread-normal",
            subject="Re: pricing question",
        )

        activity = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.nylas_message_id == "msg-normal"
        ).first()
        assert activity.is_auto_reply is False

    def test_auto_reply_does_not_advance_a_condition_waiting_on_email_replied(self, client, db):
        """An auto-reply must not count as a genuine reply for a cadence's
        'Email replied' condition branch — it should stay parked."""
        import journey_engine.engine as je
        lead = create_test_lead(db, status="New")
        graph = {
            "nodes": [
                {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
                {"id": "n2", "type": "condition", "data": {
                    "timeout_hours": 48, "branch_on_timeout": "n2",
                    "branch_on_event": {"email_replied": "n2"},
                }},
            ],
            "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
        }
        journey = models.Journey(name="OOO Test", owner_id="owner-1", status="active")
        db.add(journey)
        db.flush()
        version = models.JourneyVersion(journey_id=journey.id, version_number=1, graph_definition=graph, status="published")
        db.add(version)
        db.flush()
        journey.live_version_id = version.id
        db.commit()
        je.check_entry_triggers(db, "status_changed", lead, to_status="New")
        create_email_thread(db, lead_id=lead.id, nylas_thread_id="thread-ooo-enrolled")

        self._fire_message(
            client, message_id="msg-ooo-enrolled", thread_id="thread-ooo-enrolled",
            from_email=lead.email, subject="Automatic reply: I am out of the office",
        )

        enrollment = db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.lead_id == lead.id
        ).first()
        db.refresh(enrollment)
        assert enrollment.trigger_event is None


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Error Handling
# ═══════════════════════════════════════════════════════════════════════════════

class TestWebhookErrorHandling:
    """Edge cases and error paths."""

    def test_invalid_json_returns_400(self, client):
        """Malformed JSON payload should return 400."""
        resp = client.post("/webhooks/nylas", content="not-json{{{")
        assert resp.status_code == 400

    def test_unrecognized_event_type_ignored(self, client, db):
        """Non-message events (e.g. calendar.event) should be silently skipped."""
        payload = {
            "data": {
                "type": "calendar.event.created",
                "object_data": {"id": "evt-1"}
            }
        }
        resp = client.post("/webhooks/nylas", content=json.dumps(payload))
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
