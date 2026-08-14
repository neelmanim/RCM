"""
Tests for aircall_messaging_provider.py's AircallMessagingProvider (the
provider-agnostic MessagingProvider's Aircall implementation) and
messaging_service.py's "aircall" branch.

No real Aircall API calls — requests.post/get are mocked. The exact request
shape is unverified against a live account (see the ponytail note in
aircall_messaging_provider.py); these tests only prove the adapter behaves
correctly against the shape it's built for.
"""
from unittest.mock import MagicMock, patch

import models
from aircall_messaging_provider import AircallMessagingProvider
from messaging_service import get_messaging_provider_for_org


def _provider():
    return AircallMessagingProvider(api_id="id1", api_token="tok1", number_id="999")


class TestAircallMessagingProviderSend:
    @patch("aircall_messaging_provider.requests.post")
    def test_sms_send_posts_to_numbers_messages(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200, content=b'{"id": 42}', json=lambda: {"id": 42})
        result = _provider().send(phone="+15551234567", channel="sms", sender_id="999", text="hi")

        assert result.success is True
        assert result.provider == "aircall"
        assert result.message_id == "42"
        url = mock_post.call_args[0][0]
        assert url == "https://api.aircall.io/v1/numbers/999/messages"
        assert mock_post.call_args[1]["json"] == {"to": "+15551234567", "body": "hi"}

    @patch("aircall_messaging_provider.requests.post")
    def test_whatsapp_send_posts_to_numbers_whatsapp_messages(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200, content=b'{"id": 7}', json=lambda: {"id": 7})
        result = _provider().send(phone="+15551234567", channel="whatsapp", sender_id="999", template_name="tmpl_1")

        assert result.success is True
        url = mock_post.call_args[0][0]
        assert url == "https://api.aircall.io/v1/numbers/999/whatsapp_messages"
        assert mock_post.call_args[1]["json"] == {"to": "+15551234567", "template_id": "tmpl_1"}

    def test_neither_text_nor_template_fails_without_a_request(self):
        with patch("aircall_messaging_provider.requests.post") as mock_post:
            result = _provider().send(phone="+15551234567", channel="sms", sender_id="999")
            assert result.success is False
            mock_post.assert_not_called()

    @patch("aircall_messaging_provider.requests.post")
    def test_http_error_is_caught_and_returned_as_a_failed_result(self, mock_post):
        mock_post.side_effect = Exception("HTTP 429")
        result = _provider().send(phone="+15551234567", channel="sms", sender_id="999", text="hi")
        assert result.success is False
        assert "HTTP 429" in result.error


class TestAircallMessagingProviderInbound:
    @patch("aircall_messaging_provider.requests.get")
    def test_list_recent_conversations_groups_by_counterpart_phone(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, content=b'{}', json=lambda: {"messages": [
            {"id": 1, "direction": "inbound", "from": "+15550000001", "to": "999"},
            {"id": 2, "direction": "outbound", "from": "999", "to": "+15550000002"},
        ]})
        convos = _provider().list_recent_conversations()
        phones = {c.phone_number: c.last_message_direction for c in convos}
        assert phones == {"+15550000001": "inbound", "+15550000002": "outbound"}

    @patch("aircall_messaging_provider.requests.get")
    def test_get_inbound_messages_returns_empty_for_outbound_message(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, content=b'{}', json=lambda: {
            "message": {"id": 1, "direction": "outbound", "from": "999", "body": "hi"}
        })
        assert _provider().get_inbound_messages("1") == []

    @patch("aircall_messaging_provider.requests.get")
    def test_get_inbound_messages_returns_normalized_record_for_inbound(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, content=b'{}', json=lambda: {
            "message": {"id": 1, "direction": "inbound", "from": "+15550000001", "body": "hello", "type": "whatsapp"}
        })
        records = _provider().get_inbound_messages("1")
        assert len(records) == 1
        assert records[0].phone_number == "+15550000001"
        assert records[0].text == "hello"
        assert records[0].channel == "whatsapp"


class TestGetMessagingProviderForOrgAircall:
    def test_returns_none_when_credentials_incomplete(self, db):
        db.add(models.SyncSettings(id=1, messaging_provider="aircall", dialer_api_id="id1"))
        db.commit()
        assert get_messaging_provider_for_org(db) is None

    def test_returns_an_aircall_provider_when_fully_configured(self, db):
        db.add(models.SyncSettings(
            id=1, messaging_provider="aircall",
            dialer_api_id="id1", dialer_api_token="encrypted-tok",
            aircall_messaging_number_id="999",
        ))
        db.commit()
        with patch("crypto.decrypt_token", return_value="plain-tok"):
            provider = get_messaging_provider_for_org(db)
        assert isinstance(provider, AircallMessagingProvider)
        assert provider.provider_name == "aircall"

    def test_rcm_stays_the_default_when_messaging_provider_unset(self, db):
        from rcm_messaging_provider import RCMMessagingProvider
        db.add(models.SyncSettings(
            id=1, rcm_enabled=True, rcm_api_key="k",
            rcm_user_id="u", rcm_account_id="a",
        ))
        db.commit()
        provider = get_messaging_provider_for_org(db)
        assert isinstance(provider, RCMMessagingProvider)
