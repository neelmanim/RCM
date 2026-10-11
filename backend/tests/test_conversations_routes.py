"""
Tests for routes/conversations_routes.py's lead-ownership authorization layer.

Previously every /api/conversations/* route only checked "is this user logged
in," not "does this phone/conversation belong to a lead they can access" — any
authenticated user could read/send against any phone or conversation_id.
These tests cover the fix: lead_id is now required everywhere, and each route
403s on an ownership or phone-mismatch violation, 404s on a nonexistent lead.
"""
from unittest.mock import patch, MagicMock

import pytest

import models
from routes._admin_helpers import _get_or_create_sync_settings
from routes.conversations_routes import (
    _lead_convs_cache,
    _phone_matches_lead,
    _get_conversations_for_lead_cached,
    _CACHE_SWEEP_THRESHOLD,
)
from tests.conftest import create_test_lead, create_test_pod, create_test_user


@pytest.fixture(autouse=True)
def _clear_lead_convs_cache():
    # Many tests below reuse the same phone number with different mocked
    # conversation lists — the route's ownership-check cache is keyed by
    # phone, so it must be cleared between tests to avoid cross-test leakage.
    _lead_convs_cache.clear()
    yield
    _lead_convs_cache.clear()


class TestLeadConvsCacheSweep:
    """RCA 2026-08-26 (staging OOM): keyed on every distinct lead phone
    number ever viewed (polled every 15s), values are full conversation
    payloads — must sweep expired entries once over threshold, same shape
    as the analytics caches fixed the same day."""

    def test_sweep_evicts_expired_entries_once_over_threshold(self):
        now = __import__("time").time()
        for i in range(_CACHE_SWEEP_THRESHOLD + 1):
            _lead_convs_cache[f"+1555000{i:04d}"] = (0.0, [f"stale-{i}"])  # long expired

        svc = MagicMock()
        svc.get_conversations_for_lead.return_value = ["fresh"]
        result = _get_conversations_for_lead_cached(svc, "+15559999999")

        assert result == ["fresh"]
        assert len(_lead_convs_cache) == 1
        assert _lead_convs_cache["+15559999999"][1] == ["fresh"]


class _FakeLead:
    def __init__(self, phone=None, phone_secondary=None, company_phone=None):
        self.phone = phone
        self.phone_secondary = phone_secondary
        self.company_phone = company_phone


class TestPhoneMatchesLead:
    def test_exact_match_on_primary_phone(self):
        lead = _FakeLead(phone="9198765 43210")
        assert _phone_matches_lead("919876543210", lead) is True

    def test_suffix_match_tolerates_country_code_difference(self):
        lead = _FakeLead(phone="9876543210")  # no country code stored
        assert _phone_matches_lead("+91 98765 43210", lead) is True

    def test_matches_secondary_or_company_phone(self):
        lead = _FakeLead(phone="111", phone_secondary="9876543210", company_phone=None)
        assert _phone_matches_lead("919876543210", lead) is True

    def test_no_match_returns_false(self):
        lead = _FakeLead(phone="9111111111")
        assert _phone_matches_lead("919876543210", lead) is False

    def test_blank_phone_param_returns_false(self):
        lead = _FakeLead(phone="9876543210")
        assert _phone_matches_lead("", lead) is False

    def test_lead_with_no_phone_fields_returns_false(self):
        lead = _FakeLead()
        assert _phone_matches_lead("919876543210", lead) is False


def _messaging_sdr(db, email="sdr@test.com", user_id="sdr-user-id", **flags):
    """The SDR the client_as_sdr fixture authenticates as, granted both
    messaging channels.

    v11.10.0: every route in conversations_routes.py now requires the caller to
    hold the channel (users.sms_enabled / whatsapp_enabled). Before that they
    only checked "is this user logged in", so any authenticated user could send
    WhatsApp — the grant is the point, so these tests have to establish it
    rather than assume it.
    """
    sdr = create_test_user(db, email=email, role="SDR", id=user_id)
    sdr.sms_enabled = True
    sdr.whatsapp_enabled = True
    for k, v in flags.items():
        setattr(sdr, k, v)
    db.commit()
    db.refresh(sdr)
    return sdr


def _sync_settings_with_messenger_creds(db):
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        settings = models.SyncSettings(id=1)
        db.add(settings)
    settings.messenger_api_key = "test-key"
    settings.messenger_user_id = "355746"
    settings.messenger_account_id = "80054247"
    db.commit()


def _mock_service(get_conversations_for_lead=None, session_state=None):
    from conversations_service import SessionState
    svc = MagicMock()
    svc.get_conversations_for_lead.return_value = get_conversations_for_lead or []
    svc.get_session_state.return_value = session_state or SessionState(
        conversation_id=None, channel="whatsapp", requires_template=True,
        is_live=0, last_direction="", sender_id="918956778474",
    )
    return svc


class TestConversationsStatus:
    """GET /status must never 503 — it's the cheap pre-check the frontend
    widget uses to decide whether to poll the rest of this router at all."""

    def test_not_configured_by_default(self, client_as_sdr):
        resp = client_as_sdr.get("/api/conversations/status")
        assert resp.status_code == 200
        assert resp.json() == {"configured": False}

    def test_configured_once_all_three_settings_are_set(self, db, client_as_sdr):
        settings = _get_or_create_sync_settings(db)
        settings.messenger_api_key = "key"
        settings.messenger_user_id = "user"
        settings.messenger_account_id = "acct"
        db.commit()

        resp = client_as_sdr.get("/api/conversations/status")
        assert resp.status_code == 200
        assert resp.json() == {"configured": True}

    def test_not_configured_when_only_some_settings_are_set(self, db, client_as_sdr):
        settings = _get_or_create_sync_settings(db)
        settings.messenger_api_key = "key"
        db.commit()

        resp = client_as_sdr.get("/api/conversations/status")
        assert resp.json() == {"configured": False}


class TestEmbedUrl:
    """GET /embed-url — Sales Tools' SMS Campaigns tab. No lead scoping (not
    per-lead like the rest of this file); just needs Alternate Messenger enabled +
    configured, mirroring lead_routes.py::get_messaging_config's checks."""

    def _configure(self, db, user_id="org-wide-user"):
        settings = _get_or_create_sync_settings(db)
        settings.messenger_enabled = True
        settings.messenger_api_key = "key"
        settings.messenger_user_id = user_id
        # Model column default is the legacy "messaging_provider.com" domain; set the
        # real one explicitly so this test doesn't depend on that default.
        settings.messenger_base_url = "https://app.alternatecrm.com"
        db.commit()
        return settings

    def test_422_for_invalid_view(self, client_as_sdr):
        resp = client_as_sdr.get("/api/conversations/embed-url", params={"view": "not-a-real-view"})
        assert resp.status_code == 422

    def test_503_when_messenger_not_enabled(self, client_as_sdr):
        resp = client_as_sdr.get("/api/conversations/embed-url", params={"view": "campaigns"})
        assert resp.status_code == 503

    def test_returns_the_authenticate_url_not_the_destination_directly(self, db, client_as_sdr):
        # The browser must hit /api/v2/crm/authenticate itself (to receive
        # Alternate Messenger's session cookie) — NOT land on /app/#/campaigns
        # directly with a bare session_id, which is what showed Alternate Messenger's
        # own login form instead of the campaigns UI (v12.3 regression).
        self._configure(db)
        resp = client_as_sdr.get("/api/conversations/embed-url", params={"view": "campaigns"})
        assert resp.status_code == 200
        url = resp.json()["url"]
        assert url.startswith("https://app.alternatecrm.com/api/v2/crm/authenticate?")
        assert "userId=org-wide-user" in url
        assert "apiKey=key" in url
        assert "signature=" in url and "timestamp=" in url
        assert "redirect_url=https%3A%2F%2Fapp.alternatecrm.com%2Fapp%2F%23%2Fcampaigns%3Fcrm%3Daudience_manager" in url

    def test_converse_desk_view_redirects_to_its_own_destination(self, db, client_as_sdr):
        self._configure(db)
        resp = client_as_sdr.get("/api/conversations/embed-url", params={"view": "converse-desk"})
        assert resp.status_code == 200
        url = resp.json()["url"]
        assert url.startswith("https://app.alternatecrm.com/api/v2/crm/authenticate?")
        assert "redirect_url=https%3A%2F%2Fapp.alternatecrm.com%2Fapp%2F%23%2Fconverse-desk%3Fcrm%3Daudience_manager" in url

    def test_502_when_messaging_auth_fails(self, db, client_as_sdr):
        self._configure(db)
        with patch("messaging_auth.AlternateMessengerAuthManager.build_browser_auth_url", side_effect=RuntimeError("bad creds")):
            resp = client_as_sdr.get("/api/conversations/embed-url", params={"view": "campaigns"})
        assert resp.status_code == 502

    def test_503_when_no_messenger_user_id_anywhere(self, db, client_as_sdr):
        settings = _get_or_create_sync_settings(db)
        settings.messenger_enabled = True
        settings.messenger_api_key = "key"
        settings.messenger_user_id = None
        db.commit()

        resp = client_as_sdr.get("/api/conversations/embed-url", params={"view": "campaigns"})
        assert resp.status_code == 503


class TestSessionStateAuth:
    def test_404_when_lead_does_not_exist(self, client_as_sdr):
        resp = client_as_sdr.get(
            "/api/conversations/session-state",
            params={"lead_id": 999999, "phone": "919876543210", "sender_id": "918956778474"},
        )
        assert resp.status_code == 404

    def test_403_when_sdr_does_not_own_the_lead(self, db, client_as_sdr):
        other_sdr = create_test_user(db, email="other@test.com", role="SDR", id="other-sdr-id")
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(other_sdr)
        db.commit()

        resp = client_as_sdr.get(
            "/api/conversations/session-state",
            params={"lead_id": lead.id, "phone": "919876543210", "sender_id": "918956778474"},
        )
        assert resp.status_code == 403

    def test_403_when_phone_does_not_match_the_leads_own_phone(self, db, client_as_sdr):
        sdr = _messaging_sdr(db)
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(sdr)
        db.commit()

        resp = client_as_sdr.get(
            "/api/conversations/session-state",
            params={"lead_id": lead.id, "phone": "911111111111", "sender_id": "918956778474"},
        )
        assert resp.status_code == 403

    def test_200_when_lead_owned_and_phone_matches(self, db, client_as_sdr):
        sdr = _messaging_sdr(db)
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(sdr)
        db.commit()
        _sync_settings_with_messenger_creds(db)

        with patch("routes.conversations_routes.get_conversations_service", return_value=_mock_service()):
            resp = client_as_sdr.get(
                "/api/conversations/session-state",
                params={"lead_id": lead.id, "phone": "919876543210", "sender_id": "918956778474"},
            )
        assert resp.status_code == 200
        assert resp.json()["conversation_id"] is None


class TestSendMessageAuth:
    def test_403_when_phone_does_not_match_lead(self, db, client_as_sdr):
        sdr = _messaging_sdr(db)
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(sdr)
        db.commit()

        resp = client_as_sdr.post(
            "/api/conversations/send",
            json={
                "lead_id": lead.id, "phone": "911111111111", "sender_id": "918956778474",
                "text": "hi",
            },
        )
        assert resp.status_code == 403

    def test_404_for_nonexistent_lead(self, client_as_sdr):
        resp = client_as_sdr.post(
            "/api/conversations/send",
            json={
                "lead_id": "nonexistent-lead-id", "phone": "919876543210", "sender_id": "918956778474",
                "text": "hi",
            },
        )
        assert resp.status_code == 404


class TestSendMessagePersistence:
    """The Widget's send previously left no trace in our own DB — every
    conversation view was a live proxy call to Alternate Messenger, so a message sent
    an hour ago had no row anywhere. These tests cover the fix: every send
    attempt (success or failure) now writes a models.SmsLog row, the same
    convention journey_engine/channels/sms_channel.py already uses for
    automated cadence sends."""

    def test_free_text_send_logs_an_sms_log_row(self, db, client_as_sdr):
        sdr = _messaging_sdr(db)
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(sdr)
        db.commit()
        _sync_settings_with_messenger_creds(db)

        svc = MagicMock()
        svc.send_text_message.return_value = {"temp_unique_id": "abc-123", "conversation_id": 42}

        with patch("routes.conversations_routes.get_conversations_service", return_value=svc):
            resp = client_as_sdr.post(
                "/api/conversations/send",
                json={
                    "lead_id": lead.id, "phone": "919876543210", "sender_id": "918956778474",
                    "channel": "sms", "text": "Following up on your demo",
                },
            )
        assert resp.status_code == 200

        log = db.query(models.SmsLog).filter(models.SmsLog.lead_id == lead.id).one()
        assert log.status == "sent"
        assert log.channel == "sms"
        assert log.provider == "messenger"
        assert log.message_id == "abc-123"
        assert log.conversation_id == "42"
        assert log.message_text == "Following up on your demo"
        assert log.user_id == "sdr-user-id"

    def test_whatsapp_template_send_logs_resolved_text_and_template_name(self, db, client_as_sdr):
        from conversations_service import WhatsAppTemplate

        sdr = _messaging_sdr(db)
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(sdr)
        db.commit()
        _sync_settings_with_messenger_creds(db)

        template = WhatsAppTemplate(
            id=1, name="lead_followup_attempt",
            template_text="Hi ${contacts.first_name}, following up!",
            content={"components": []},
        )
        svc = MagicMock()
        svc.get_whatsapp_templates.return_value = [template]
        svc.send_whatsapp_template.return_value = {"temp_unique_id": "wa-1", "conversation_id": 7}

        with patch("routes.conversations_routes.get_conversations_service", return_value=svc):
            resp = client_as_sdr.post(
                "/api/conversations/send",
                json={
                    "lead_id": lead.id, "phone": "919876543210", "sender_id": "918956778474",
                    "channel": "whatsapp", "template_name": "lead_followup_attempt",
                    "contact_first_name": "Jane",
                },
            )
        assert resp.status_code == 200

        log = db.query(models.SmsLog).filter(models.SmsLog.lead_id == lead.id).one()
        assert log.channel == "whatsapp"
        assert log.template_name == "lead_followup_attempt"
        assert log.message_text == "Hi Jane, following up!"

    def test_failed_send_still_logs_a_failed_row(self, db, client_as_sdr):
        sdr = _messaging_sdr(db)
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(sdr)
        db.commit()
        _sync_settings_with_messenger_creds(db)

        svc = MagicMock()
        svc.send_text_message.side_effect = RuntimeError("HTTP 500: upstream error")

        with patch("routes.conversations_routes.get_conversations_service", return_value=svc):
            resp = client_as_sdr.post(
                "/api/conversations/send",
                json={
                    "lead_id": lead.id, "phone": "919876543210", "sender_id": "918956778474",
                    "channel": "sms", "text": "hi",
                },
            )
        assert resp.status_code == 502

        log = db.query(models.SmsLog).filter(models.SmsLog.lead_id == lead.id).one()
        assert log.status == "failed"
        assert log.message_text == "hi"


class TestConversationThreadAuth:
    def test_403_when_conversation_does_not_belong_to_the_lead(self, db, client_as_sdr):
        sdr = _messaging_sdr(db)
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(sdr)
        db.commit()
        _sync_settings_with_messenger_creds(db)

        # get_conversations_for_lead returns conversations that don't include id=42
        svc = _mock_service(get_conversations_for_lead=[])
        with patch("routes.conversations_routes.get_conversations_service", return_value=svc):
            resp = client_as_sdr.get(
                f"/api/conversations/42/messages",
                params={"lead_id": lead.id},
            )
        assert resp.status_code == 403

    def test_403_when_lead_not_owned_by_sdr(self, db, client_as_sdr):
        other_sdr = create_test_user(db, email="other2@test.com", role="SDR", id="other-sdr-id-2")
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(other_sdr)
        db.commit()

        resp = client_as_sdr.get("/api/conversations/42/messages", params={"lead_id": lead.id})
        assert resp.status_code == 403

    def test_repeated_polls_within_ttl_reuse_the_cached_ownership_check(self, db, client_as_sdr):
        """The frontend polls this route every 15s; the ownership check
        (get_conversations_for_lead) previously re-ran on every single poll,
        doubling this endpoint's real Alternate Messenger API round-trips."""
        sdr = _messaging_sdr(db)
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(sdr)
        db.commit()
        _sync_settings_with_messenger_creds(db)

        svc = _mock_service(get_conversations_for_lead=[MagicMock(id=42)])
        svc.get_thread.return_value = MagicMock(conversation_id=42, all_messages=[])
        with patch("routes.conversations_routes.get_conversations_service", return_value=svc):
            r1 = client_as_sdr.get("/api/conversations/42/messages", params={"lead_id": lead.id})
            r2 = client_as_sdr.get("/api/conversations/42/messages", params={"lead_id": lead.id})

        assert r1.status_code == 200
        assert r2.status_code == 200
        svc.get_conversations_for_lead.assert_called_once()


class TestListConversationsAuth:
    def test_lead_id_and_phone_are_required(self, client_as_sdr):
        resp = client_as_sdr.get("/api/conversations")
        assert resp.status_code == 422

    def test_403_when_phone_does_not_match_lead(self, db, client_as_sdr):
        sdr = _messaging_sdr(db)
        lead = create_test_lead(db, phone="919876543210")
        lead.assigned_users.append(sdr)
        db.commit()

        resp = client_as_sdr.get(
            "/api/conversations",
            params={"lead_id": lead.id, "phone": "911111111111"},
        )
        assert resp.status_code == 403
