"""
Tests for messaging_sync.py — the inbound-message reconciliation job.

RCM Built-in Messaging's Converse Desk API has no push webhook for inbound
messages, unlike calls or email — a lead's reply previously had no path into
our own DB at all. These tests cover the fix.
"""
from unittest.mock import MagicMock, patch

import models
from messaging_provider import ConversationSummary, InboundMessageRecord
from messaging_sync import sync_recent_conversations
from tests.conftest import create_test_lead


def _provider(conversations, messages_by_conversation=None):
    mock = MagicMock()
    mock.provider_name = "rcm"
    mock.list_recent_conversations.return_value = conversations
    mock.get_inbound_messages.side_effect = lambda conv_id: (messages_by_conversation or {}).get(conv_id, [])
    return mock


class TestSyncRecentConversations:
    def test_no_provider_configured_returns_zeroed_stats(self, db):
        with patch("messaging_sync.get_messaging_provider_for_org", return_value=None):
            stats = sync_recent_conversations(db)
        assert stats["conversations_checked"] == 0
        assert stats["messages_inserted"] == 0

    def test_inbound_message_on_a_matched_lead_is_persisted(self, db):
        lead = create_test_lead(db, phone="+919876543210")
        conv = ConversationSummary(
            conversation_id="42", phone_number="919876543210",
            last_message_direction="inbound",
        )
        msg = InboundMessageRecord(
            provider_message_id="msg-1", phone_number="919876543210",
            text="Sounds good, thanks!", channel="whatsapp",
        )
        provider = _provider([conv], {"42": [msg]})

        with patch("messaging_sync.get_messaging_provider_for_org", return_value=provider):
            stats = sync_recent_conversations(db)

        assert stats["conversations_with_inbound"] == 1
        assert stats["messages_inserted"] == 1
        log = db.query(models.SmsLog).filter(models.SmsLog.message_id == "msg-1").one()
        assert log.lead_id == lead.id
        assert log.direction == "inbound"
        assert log.status == "received"
        assert log.channel == "whatsapp"
        assert log.provider == "rcm"
        assert log.conversation_id == "42"
        assert log.message_text == "Sounds good, thanks!"

    def test_conversation_with_no_matching_lead_is_skipped(self, db):
        conv = ConversationSummary(
            conversation_id="99", phone_number="919999999999",
            last_message_direction="inbound",
        )
        provider = _provider([conv])

        with patch("messaging_sync.get_messaging_provider_for_org", return_value=provider):
            stats = sync_recent_conversations(db)

        assert stats["unmatched_phone"] == 1
        assert stats["messages_inserted"] == 0
        provider.get_inbound_messages.assert_not_called()

    def test_outbound_only_conversation_is_never_fetched(self, db):
        create_test_lead(db, phone="+919876543210")
        conv = ConversationSummary(
            conversation_id="7", phone_number="919876543210",
            last_message_direction="outbound",
        )
        provider = _provider([conv])

        with patch("messaging_sync.get_messaging_provider_for_org", return_value=provider):
            stats = sync_recent_conversations(db)

        assert stats["conversations_with_inbound"] == 0
        provider.get_inbound_messages.assert_not_called()

    def test_already_logged_message_is_not_duplicated(self, db):
        lead = create_test_lead(db, phone="+919876543210")
        db.add(models.SmsLog(
            message_id="msg-1", lead_id=lead.id, direction="inbound",
            status="received", phone_number="919876543210", channel="whatsapp",
            provider="rcm",
        ))
        db.commit()

        conv = ConversationSummary(
            conversation_id="42", phone_number="919876543210",
            last_message_direction="inbound",
        )
        msg = InboundMessageRecord(
            provider_message_id="msg-1", phone_number="919876543210",
            text="Sounds good, thanks!", channel="whatsapp",
        )
        provider = _provider([conv], {"42": [msg]})

        with patch("messaging_sync.get_messaging_provider_for_org", return_value=provider):
            stats = sync_recent_conversations(db)

        assert stats["messages_already_logged"] == 1
        assert stats["messages_inserted"] == 0
        assert db.query(models.SmsLog).filter(models.SmsLog.message_id == "msg-1").count() == 1

    def test_thread_fetch_failure_is_isolated_and_does_not_abort_the_whole_sync(self, db):
        create_test_lead(db, phone="+919876543210")
        lead2 = create_test_lead(db, phone="+911111111111")
        conv1 = ConversationSummary(
            conversation_id="1", phone_number="919876543210",
            last_message_direction="inbound",
        )
        conv2 = ConversationSummary(
            conversation_id="2", phone_number="911111111111",
            last_message_direction="inbound",
        )
        msg2 = InboundMessageRecord(
            provider_message_id="msg-2", phone_number="911111111111",
            text="hi", channel="sms",
        )
        provider = _provider([conv1, conv2], {"2": [msg2]})
        provider.get_inbound_messages.side_effect = [RuntimeError("HTTP 502"), [msg2]]

        with patch("messaging_sync.get_messaging_provider_for_org", return_value=provider):
            stats = sync_recent_conversations(db)

        assert stats["messages_inserted"] == 1
        log = db.query(models.SmsLog).filter(models.SmsLog.message_id == "msg-2").one()
        assert log.lead_id == lead2.id
