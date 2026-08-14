"""
Tests for rcm_conversations_service.py — previously zero coverage.

Covers the two Phase-0 bug fixes:
  1. get_session_state(channel="sms") now looks up a real conversation_id
     instead of hardcoding None.
  2. ConversationThread.all_messages sorts by parsed datetime when possible,
     falling back to the original plain-string sort if any entry doesn't parse.
"""
import io
import urllib.error
from unittest.mock import patch

import pytest

from rcm_conversations_service import (
    Conversation,
    ConversationMessage,
    ConversationThread,
    RCMConversationsService,
)


def _make_conversation(id, channel, modified_at, is_live=0, last_message_direction="OUT"):
    return Conversation(
        id=id, mobile_number="919876543210", contact_phone="919876543210",
        contact_name="Test Lead", channel=channel, status="open",
        last_message_text="hi", last_message_direction=last_message_direction,
        unread_message_count=0, modified_at=modified_at, sender_id="918956778474",
        owner_id=1, crm_name="audience_manager", is_session_expired=0, is_live=is_live,
    )


def _make_message(message_id, direction, created_on, channel="whatsapp"):
    return ConversationMessage(
        message_id=message_id, text=f"msg {message_id}", direction=direction,
        channel=channel, created_on=created_on, sender_id="918956778474",
        mobile_number="919876543210",
    )


def _make_service():
    return RCMConversationsService(api_key="k", user_id="1", account_id="1")


class TestGetSessionStateSms:
    """SMS branch previously hardcoded conversation_id=None instead of looking it up."""

    def test_conversation_id_populated_from_existing_sms_conversation(self):
        svc = _make_service()
        convs = [
            _make_conversation(1, "whatsapp", "2026-07-01T10:00:00Z"),
            _make_conversation(2, "sms", "2026-07-20T10:00:00Z"),
            _make_conversation(3, "sms", "2026-07-25T10:00:00Z"),  # most recent SMS
        ]
        with patch.object(svc, "get_conversations_for_lead", return_value=convs):
            state = svc.get_session_state(phone="919876543210", sender_id="918956778474", channel="sms")
        assert state.conversation_id == 3
        assert state.channel == "sms"

    def test_conversation_id_none_when_no_sms_conversations_exist(self):
        svc = _make_service()
        convs = [_make_conversation(1, "whatsapp", "2026-07-01T10:00:00Z")]
        with patch.object(svc, "get_conversations_for_lead", return_value=convs):
            state = svc.get_session_state(phone="919876543210", sender_id="918956778474", channel="sms")
        assert state.conversation_id is None

    def test_requires_template_and_is_live_unchanged_by_the_fix(self):
        """Regression guard — the fix must only change conversation_id, nothing else."""
        svc = _make_service()
        with patch.object(svc, "get_conversations_for_lead", return_value=[]):
            state = svc.get_session_state(phone="919876543210", sender_id="918956778474", channel="sms")
        assert state.requires_template is False
        assert state.is_live == 1
        assert state.last_direction == ""


class TestAllMessagesSort:
    def test_sorts_chronologically_when_out_of_order_across_outgoing_and_incoming(self):
        thread = ConversationThread(
            conversation_id=1,
            outgoing=[_make_message(3, "out", "2026-07-20T10:05:00Z")],
            incoming=[
                _make_message(1, "in", "2026-07-20T10:00:00Z"),
                _make_message(2, "in", "2026-07-20T10:02:00Z"),
            ],
        )
        ids = [m.message_id for m in thread.all_messages]
        assert ids == [1, 2, 3]

    def test_falls_back_to_string_sort_without_raising_on_unparseable_format(self):
        thread = ConversationThread(
            conversation_id=1,
            outgoing=[_make_message(1, "out", "not-a-real-timestamp")],
            incoming=[_make_message(2, "in", "also-not-a-timestamp")],
        )
        # Must not raise — falls back to comparing the raw strings.
        result = thread.all_messages
        assert len(result) == 2


class TestHttpErrorSurfacesResponseBody:
    """A RCM rejection previously surfaced only as 'HTTP Error 400: BAD
    REQUEST' — the actual reason (in the response body) was logged server-side
    but never reached the caller, making a live failure undiagnosable from the
    API response alone."""

    def _http_error(self, code, body: bytes):
        return urllib.error.HTTPError(url="x", code=code, msg="BAD REQUEST", hdrs=None, fp=io.BytesIO(body))

    def test_post_includes_response_body_in_raised_error(self):
        svc = _make_service()
        err = self._http_error(400, b'{"error": "Message details missing"}')
        with patch.object(svc, "_ensure_authenticated", return_value="tok"), \
             patch.object(svc._opener, "open", side_effect=err):
            with pytest.raises(RuntimeError, match="Message details missing"):
                svc._post("/api/v2/converse_desk/converse", {"a": 1})

    def test_get_includes_response_body_in_raised_error(self):
        svc = _make_service()
        err = self._http_error(403, b"Forbidden: sender not registered")
        with patch.object(svc, "_ensure_authenticated", return_value="tok"), \
             patch.object(svc._opener, "open", side_effect=err):
            with pytest.raises(RuntimeError, match="sender not registered"):
                svc._get("/api/v2/converse_desk/conversation", {})


class TestGetConversationsPhoneFilter:
    """Observed live on staging: RCM's own mobile_number/query filter
    does not reliably filter server-side — when a phone doesn't match
    cleanly, it silently returned unrelated conversations for the whole
    account instead of an empty list. get_session_state then picked one of
    those as if it belonged to the requested phone (wrong requires_template
    answer), and the /messages ownership check would have accepted it too —
    a real cross-contact data leak. Verified independently client-side."""

    def test_filters_out_conversations_for_other_phone_numbers(self):
        svc = _make_service()
        raw = {"conversations": [
            {"id": 1, "mobile_number": "919545455721", "channel": "whatsapp"},
            {"id": 2, "mobile_number": "919986945355", "channel": "whatsapp"},
        ]}
        with patch.object(svc, "_get", return_value=raw):
            result = svc.get_conversations(phone="9986945355", include_all_statuses=True)
        assert [c.id for c in result] == [2]

    def test_country_code_present_on_only_one_side_still_matches(self):
        svc = _make_service()
        raw = {"conversations": [{"id": 3, "mobile_number": "919986945355", "channel": "whatsapp"}]}
        with patch.object(svc, "_get", return_value=raw):
            result = svc.get_conversations(phone="9986945355", include_all_statuses=True)
        assert len(result) == 1

    def test_no_phone_requested_returns_everything_unfiltered(self):
        svc = _make_service()
        raw = {"conversations": [{"id": 1, "mobile_number": "919545455721", "channel": "whatsapp"}]}
        with patch.object(svc, "_get", return_value=raw):
            result = svc.get_conversations(include_all_statuses=True)  # no phone — account-wide list view
        assert len(result) == 1
