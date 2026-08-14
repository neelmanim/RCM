"""
Tests for the provider-agnostic messaging abstraction: messaging_provider.py's
MessagingProvider ABC, rcm_messaging_provider.py's concrete RCM
implementation, and messaging_service.py's resolver.

No real RCM API calls here — rcm_conversations_service's own
test suite already covers the real HTTP/auth behavior this wraps; these
tests only prove the adapter translates correctly between the two shapes.
"""
from unittest.mock import MagicMock, patch

import models
from rcm_messaging_provider import RCMMessagingProvider
from messaging_service import get_messaging_provider_for_org
from tests.conftest import create_test_lead  # noqa: F401 (fixture side-effect import parity with other test files)


def _fake_provider(mock_svc):
    with patch("rcm_messaging_provider.get_conversations_service", return_value=mock_svc):
        return RCMMessagingProvider(api_key="k", user_id="u", account_id="a")


class TestRCMMessagingProviderSend:
    def test_template_send_resolves_the_named_template_and_returns_a_normalized_result(self):
        from rcm_conversations_service import WhatsAppTemplate

        template = WhatsAppTemplate(id=1, name="lead_followup_attempt", template_text="Hi!", content={})
        svc = MagicMock()
        svc.get_whatsapp_templates.return_value = [template]
        svc.send_whatsapp_template.return_value = {"temp_unique_id": "wa-1", "conversation_id": 7}
        provider = _fake_provider(svc)

        result = provider.send(
            phone="919876543210", channel="whatsapp", sender_id="918956778474",
            template_name="lead_followup_attempt", contact_first_name="Jane",
        )

        assert result.success is True
        assert result.provider == "rcm"
        assert result.message_id == "wa-1"
        assert result.conversation_id == "7"
        svc.send_whatsapp_template.assert_called_once_with(
            phone="919876543210", sender_id="918956778474", template=template,
            conversation_id=None, contact_first_name="Jane",
        )

    def test_unknown_template_name_fails_without_calling_send(self):
        svc = MagicMock()
        svc.get_whatsapp_templates.return_value = []
        provider = _fake_provider(svc)

        result = provider.send(
            phone="919876543210", channel="whatsapp", sender_id="918956778474",
            template_name="does_not_exist",
        )

        assert result.success is False
        assert "not found" in result.error
        svc.send_whatsapp_template.assert_not_called()

    def test_free_text_send(self):
        svc = MagicMock()
        svc.send_text_message.return_value = {"temp_unique_id": "sms-1"}
        provider = _fake_provider(svc)

        result = provider.send(phone="919876543210", channel="sms", sender_id="918956778474", text="hi")

        assert result.success is True
        assert result.message_id == "sms-1"

    def test_neither_text_nor_template_fails(self):
        provider = _fake_provider(MagicMock())
        result = provider.send(phone="919876543210", channel="sms", sender_id="918956778474")
        assert result.success is False

    def test_provider_exception_is_caught_and_returned_as_a_failed_result(self):
        svc = MagicMock()
        svc.send_text_message.side_effect = RuntimeError("HTTP 500")
        provider = _fake_provider(svc)

        result = provider.send(phone="919876543210", channel="sms", sender_id="918956778474", text="hi")

        assert result.success is False
        assert "HTTP 500" in result.error


class TestGetMessagingProviderForOrg:
    def test_returns_none_when_rcm_is_disabled(self, db):
        db.add(models.SyncSettings(id=1, rcm_enabled=False))
        db.commit()
        assert get_messaging_provider_for_org(db) is None

    def test_returns_none_when_credentials_are_incomplete(self, db):
        db.add(models.SyncSettings(id=1, rcm_enabled=True, rcm_api_key="k"))
        db.commit()
        assert get_messaging_provider_for_org(db) is None

    def test_returns_a_rcm_provider_when_fully_configured(self, db):
        db.add(models.SyncSettings(
            id=1, rcm_enabled=True, rcm_api_key="k",
            rcm_user_id="355746", rcm_account_id="80054247",
        ))
        db.commit()
        provider = get_messaging_provider_for_org(db)
        assert isinstance(provider, RCMMessagingProvider)
        assert provider.provider_name == "rcm"
