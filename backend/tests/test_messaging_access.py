"""
Per-SDR messaging access (v11.10.0).

Messaging used to have no gate of its own: the Message tab rode on
users.dialer_enabled plus a *Alternate Messenger dialer* provider, so an SDR on Aircall
for calling could never message however well messaging was configured, and
granting someone the dialer silently granted them WhatsApp. These tests pin the
gate that replaced that — messaging_service.resolve_messaging_for_user — plus
the three places whose behaviour depended on the old coupling.

Sections:
  1. resolve_messaging_for_user — the capability gate itself
  2. Provider + sender resolution (per-user override → org default)
  3. get_user_capabilities / GET /api/me/capabilities
  4. Conversations routes refuse a channel the SDR wasn't granted
  5. PATCH /api/dialer/toggle — self-disable yes, self-enable no
  6. Inbound webhook records channel + owner
"""
import os

import pytest
from unittest.mock import patch

# Building the Aircall provider decrypts the stored API token.
os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

from crypto import encrypt_token  # noqa: E402  (must follow the key above)
from tests.conftest import create_test_user, create_test_lead  # noqa: E402


def _settings(db, **overrides):
    """Fully-configured Alternate Messenger messaging org, unless overridden."""
    import models
    s = db.query(models.SyncSettings).first()
    if not s:
        s = models.SyncSettings(id=1)
        db.add(s)
    defaults = {
        "messenger_enabled": True,
        "messenger_api_key": "test-key",
        "messenger_user_id": "1128097",
        "messenger_account_id": "80054247",
        "messenger_sender_id": "918956778474",
        "messaging_provider": "messenger",
    }
    for k, v in {**defaults, **overrides}.items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s


# The client fixtures authenticate via a JWT payload with no matching DB row
# (conftest's SUPER_ADMIN / SDR_USER), but every gate here reads the live row —
# that's deliberate, so an admin's grant applies without a re-login. Tests that
# go through a client therefore have to materialise the row first.
def _me(db, user_id="test-user-id", email="admin@test.com", role="Super Admin", **flags):
    u = create_test_user(db, email=email, name="Fixture User", role=role, id=user_id)
    for k, v in flags.items():
        setattr(u, k, v)
    db.commit()
    db.refresh(u)
    return u


def _sdr(db, email="sdr@test.com", **flags):
    u = create_test_user(db, email=email, name="Test SDR", role="SDR")
    for k, v in flags.items():
        setattr(u, k, v)
    db.commit()
    db.refresh(u)
    return u


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 1: the capability gate
# ═════════════════════════════════════════════════════════════════════════════

class TestCapabilityGate:

    def test_denies_channel_the_user_was_not_granted(self, db):
        from messaging_service import resolve_messaging_for_user
        _settings(db)
        user = _sdr(db, sms_enabled=False, whatsapp_enabled=False)

        result = resolve_messaging_for_user(db, user, "whatsapp")

        assert result.provider is None
        assert "not enabled for WhatsApp" in result.error
        # A missing grant is a decision, not a transient fault — retrying it
        # would burn cadence attempts against something only an admin can fix.
        assert result.retryable is False

    def test_grants_are_per_channel(self, db):
        """SMS on does not imply WhatsApp on. This is the whole point of two
        columns — before v11.10.0 one dialer flag turned on everything."""
        from messaging_service import resolve_messaging_for_user
        _settings(db)
        user = _sdr(db, sms_enabled=True, whatsapp_enabled=False)

        assert resolve_messaging_for_user(db, user, "sms").provider is not None
        assert resolve_messaging_for_user(db, user, "whatsapp").provider is None

    def test_dialer_enabled_alone_grants_nothing(self, db):
        """The old implicit coupling must be gone: holding the dialer is no
        longer a way to send messages."""
        from messaging_service import resolve_messaging_for_user
        _settings(db)
        user = _sdr(db, dialer_enabled=True, sms_enabled=False, whatsapp_enabled=False)

        assert resolve_messaging_for_user(db, user, "sms").provider is None

    def test_admins_are_not_exempt(self, db):
        """Calling lets admins through without dialer_enabled. Messaging
        deliberately does not, so the UI's offer always matches the API."""
        from messaging_service import resolve_messaging_for_user
        _settings(db)
        admin = create_test_user(db, email="boss@test.com", role="Super Admin")

        assert resolve_messaging_for_user(db, admin, "whatsapp").provider is None

    def test_names_the_missing_org_field(self, db):
        """An admin has to be able to act on the failure. account_id blank is
        exactly the state prod was found in."""
        from messaging_service import resolve_messaging_for_user
        _settings(db, messenger_account_id="")
        user = _sdr(db, whatsapp_enabled=True)

        result = resolve_messaging_for_user(db, user, "whatsapp")

        assert result.provider is None
        assert "Account ID" in result.error
        # Config gaps are fixable without touching the cadence, so retry.
        assert result.retryable is True

    def test_requires_a_sender_number(self, db):
        from messaging_service import resolve_messaging_for_user
        _settings(db, messenger_sender_id="", messenger_from_number=None)
        user = _sdr(db, whatsapp_enabled=True)

        result = resolve_messaging_for_user(db, user, "whatsapp")

        assert result.provider is None
        assert "sender" in result.error.lower()

    def test_resolves_when_granted_and_configured(self, db):
        from messaging_service import resolve_messaging_for_user
        _settings(db)
        user = _sdr(db, whatsapp_enabled=True)

        result = resolve_messaging_for_user(db, user, "whatsapp")

        assert result.provider is not None
        assert result.error is None
        assert result.sender_id == "918956778474"

    def test_unknown_channel_is_rejected_permanently(self, db):
        from messaging_service import resolve_messaging_for_user
        _settings(db)
        user = _sdr(db, sms_enabled=True, whatsapp_enabled=True)

        result = resolve_messaging_for_user(db, user, "carrier-pigeon")

        assert result.provider is None
        assert result.retryable is False


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 2: provider + sender resolution
# ═════════════════════════════════════════════════════════════════════════════

class TestProviderAndSenderResolution:

    def test_per_user_sender_beats_org_default(self, db):
        from messaging_service import resolve_messaging_for_user
        _settings(db)
        user = _sdr(db, whatsapp_enabled=True, messenger_whatsapp_sender_id="919999900000")

        assert resolve_messaging_for_user(db, user, "whatsapp").sender_id == "919999900000"

    def test_sms_and_whatsapp_share_one_sender(self, db):
        """Cadence SMS used to read messenger_from_number (the *voice* caller
        ID) while WhatsApp read messenger_sender_id, so an org could have
        WhatsApp working and every SMS failing as unconfigured."""
        from messaging_service import resolve_messaging_for_user
        _settings(db)
        user = _sdr(db, sms_enabled=True, whatsapp_enabled=True)

        sms = resolve_messaging_for_user(db, user, "sms")
        wa = resolve_messaging_for_user(db, user, "whatsapp")

        assert sms.sender_id == wa.sender_id == "918956778474"

    def test_falls_back_to_legacy_from_number(self, db):
        """An org that only ever filled messenger_from_number keeps sending."""
        from messaging_service import resolve_messaging_for_user
        _settings(db, messenger_sender_id="", messenger_from_number="918800011111")
        user = _sdr(db, sms_enabled=True)

        assert resolve_messaging_for_user(db, user, "sms").sender_id == "918800011111"

    def test_per_user_provider_override_beats_org_default(self, db):
        from messaging_service import resolve_provider_name
        s = _settings(db, messaging_provider="messenger")
        user = _sdr(db, messaging_provider_override="aircall")

        assert resolve_provider_name(s, user) == "aircall"

    def test_messaging_provider_is_independent_of_dialer_provider(self, db):
        """Calling on Aircall while messaging on Alternate Messenger is a supported
        config — it's why these are two columns, not one."""
        from messaging_service import resolve_messaging_for_user
        _settings(db)
        user = _sdr(db, whatsapp_enabled=True, dialer_provider_override="aircall")

        result = resolve_messaging_for_user(db, user, "whatsapp")

        assert result.provider is not None
        assert result.provider.provider_name == "messenger"

    def test_aircall_needs_no_per_user_setup_or_number_id(self, db):
        """Aircall is asymmetric with Alternate Messenger on purpose: give it the org API
        ID and token once and every user who exists in Aircall works, matched on
        email — numbers included, because Aircall already knows which numbers
        each user owns. Requiring a hand-typed org-wide Number ID meant every
        SDR sent from the same number and nobody could send until an admin went
        and found that ID."""
        from messaging_service import resolve_messaging_for_user
        _settings(db, messaging_provider="aircall",
                  dialer_api_id="api-id", dialer_api_token=encrypt_token("tok"),
                  aircall_messaging_number_id="")
        user = _sdr(db, sms_enabled=True, email="air@test.com")

        with patch("aircall_messaging_provider.AircallMessagingProvider"
                   ".resolve_number_for_email", return_value="90210"):
            result = resolve_messaging_for_user(db, user, "sms")

        assert result.provider is not None, result.error
        assert result.sender_id == "90210"   # discovered, not configured

    def test_aircall_falls_back_to_the_org_number_when_lookup_finds_nothing(self, db):
        """An SDR who isn't in Aircall (or owns no numbers) still sends, from
        the org-wide number, rather than failing."""
        from messaging_service import resolve_messaging_for_user
        _settings(db, messaging_provider="aircall",
                  dialer_api_id="api-id", dialer_api_token=encrypt_token("tok"),
                  aircall_messaging_number_id="11111")
        user = _sdr(db, sms_enabled=True, email="ghost@test.com")

        with patch("aircall_messaging_provider.AircallMessagingProvider"
                   ".resolve_number_for_email", return_value=""):
            result = resolve_messaging_for_user(db, user, "sms")

        assert result.provider is not None, result.error
        assert result.sender_id == "11111"

    def test_aircall_still_needs_its_org_credentials(self, db):
        from messaging_service import resolve_messaging_for_user
        _settings(db, messaging_provider="aircall",
                  dialer_api_id="", dialer_api_token="")
        user = _sdr(db, sms_enabled=True)

        result = resolve_messaging_for_user(db, user, "sms")

        assert result.provider is None
        assert "Aircall API ID" in result.error

    def test_capabilities_never_calls_the_aircall_api(self, db):
        """get_user_capabilities runs on every page load; the Aircall number
        lookup behind it is a paginated /users scan, so that path resolves
        without it."""
        from messaging_service import get_user_capabilities
        _settings(db, messaging_provider="aircall",
                  dialer_api_id="api-id", dialer_api_token=encrypt_token("tok"),
                  aircall_messaging_number_id="11111")
        me = _me(db, sms_enabled=True, messaging_provider_override="aircall")

        with patch("aircall_messaging_provider.AircallMessagingProvider"
                   ".resolve_number_for_email") as mock_lookup:
            caps = get_user_capabilities(db, {"sub": me.id, "role": "Super Admin"})

        mock_lookup.assert_not_called()
        assert caps["sms"]["ready"] is True


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 3: capabilities endpoint
# ═════════════════════════════════════════════════════════════════════════════

class TestCapabilitiesEndpoint:

    def test_returns_per_channel_state(self, client, db):
        _settings(db)
        resp = client.get("/api/me/capabilities")

        assert resp.status_code == 200
        body = resp.json()
        for key in ("calling", "sms", "whatsapp"):
            assert key in body
        assert set(body["sms"]) == {"enabled", "ready", "reason"}

    def test_reports_reason_when_not_granted(self, client, db):
        _settings(db)
        body = client.get("/api/me/capabilities").json()

        assert body["whatsapp"]["enabled"] is False
        assert body["whatsapp"]["reason"]

    def test_ready_is_true_once_granted_and_configured(self, client, db):
        """`ready` is what the widget mounts and gates its tabs on."""
        _settings(db)
        _me(db, whatsapp_enabled=True)

        body = client.get("/api/me/capabilities").json()

        assert body["whatsapp"]["ready"] is True
        assert body["whatsapp"]["reason"] is None


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 4: conversations routes respect the grant
# ═════════════════════════════════════════════════════════════════════════════

class TestConversationsRoutesGate:

    def test_send_is_refused_without_the_channel(self, client, db):
        _settings(db)
        lead = create_test_lead(db, phone="+919876543210")

        resp = client.post("/api/conversations/send", json={
            "lead_id": lead.id,
            "phone": "+919876543210",
            "sender_id": "918956778474",
            "channel": "whatsapp",
            "text": "hello",
        })

        assert resp.status_code == 403
        assert "not enabled for WhatsApp" in resp.json()["detail"]

    def test_templates_are_refused_without_whatsapp(self, client, db):
        _settings(db)
        assert client.get("/api/conversations/templates").status_code == 403

    def test_refuses_when_user_is_on_the_aircall_vendor(self, client, db):
        """Every route in conversations_routes.py is Converse Desk-specific, so
        proxying an Aircall user's send through the org's Alternate Messenger account
        would send from the wrong place."""
        _settings(db)
        _me(db, whatsapp_enabled=True, messaging_provider_override="aircall")

        resp = client.get("/api/conversations/templates")

        assert resp.status_code == 409
        assert "Aircall" in resp.json()["detail"]


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 5: self-service dialer toggle
# ═════════════════════════════════════════════════════════════════════════════

class TestSelfServiceDialerToggle:

    def test_sdr_may_disable_their_own_dialer(self, client_as_sdr, db):
        me = _me(db, user_id="sdr-user-id", email="sdr@test.com", role="SDR",
                 dialer_enabled=True)

        resp = client_as_sdr.patch("/api/dialer/toggle", json={"dialer_enabled": False})

        assert resp.status_code == 200
        assert resp.json()["dialer_enabled"] is False

    def test_sdr_may_not_enable_their_own_dialer(self, client_as_sdr, db):
        """This was a self-grant hole: an SDR whose dialer an admin had
        switched off could re-grant it in one request — and, while messaging
        rode on dialer_enabled, hand themselves WhatsApp along with it."""
        me = _me(db, user_id="sdr-user-id", email="sdr@test.com", role="SDR",
                 dialer_enabled=False)

        resp = client_as_sdr.patch("/api/dialer/toggle", json={"dialer_enabled": True})

        assert resp.status_code == 403
        db.refresh(me)
        assert me.dialer_enabled is False

    def test_admin_may_still_enable(self, client, db):
        _me(db, dialer_enabled=False)
        resp = client.patch("/api/dialer/toggle", json={"dialer_enabled": True})
        assert resp.status_code == 200
        assert resp.json()["dialer_enabled"] is True


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 6: inbound webhook attribution
# ═════════════════════════════════════════════════════════════════════════════

class TestInboundWebhookAttribution:

    def test_whatsapp_reply_is_not_filed_as_sms(self, client, db):
        """The row was written with neither channel nor user_id, so every
        WhatsApp reply landed as channel="sms" (the column default) owned by
        nobody — the Activity Monitor's channel filter mis-bucketed all of it."""
        import models
        lead = create_test_lead(db, phone="+919876543210")

        resp = client.post("/api/webhooks/messenger-sms", json={
            "type": "incoming",
            "from": "+919876543210",
            "to": "918956778474",
            "message": "yes please",
            "channel": "whatsapp",
        })

        assert resp.status_code == 200
        log = db.query(models.SmsLog).filter(models.SmsLog.direction == "inbound").first()
        assert log is not None
        assert log.channel == "whatsapp"
        assert log.lead_id == lead.id

    def test_owner_resolves_from_the_replied_to_sender(self, db, client):
        """`to` is the number the lead replied to, which identifies the SDR. It
        was parsed and then thrown away."""
        import models
        owner = _sdr(db, email="owner@test.com", messenger_whatsapp_sender_id="919999900000")
        create_test_lead(db, phone="+919876543210")

        client.post("/api/webhooks/messenger-sms", json={
            "type": "incoming",
            "from": "+919876543210",
            "to": "919999900000",
            "message": "hi",
        })

        log = db.query(models.SmsLog).filter(models.SmsLog.direction == "inbound").first()
        assert log.user_id == owner.id

    def test_shared_number_reply_goes_to_the_lead_in_a_live_cadence(self, db, client):
        """Every sandbox test lead has the sandbox phone. A reply must land on
        the one currently in a cadence (the demo), not an arbitrary older one."""
        import models
        from datetime import datetime, timedelta, timezone
        old = create_test_lead(db, phone="14703271150", email="old@test.com")
        demo = create_test_lead(db, phone="14703271150", email="demo@test.com")
        newest = create_test_lead(db, phone="14703271150", email="newest@test.com")
        now = datetime.now(timezone.utc)
        old.created_at, demo.created_at, newest.created_at = now - timedelta(days=2), now - timedelta(days=1), now
        journey = models.Journey(name="Demo", status="active")
        db.add(journey)
        db.flush()
        version = models.JourneyVersion(journey_id=journey.id, version_number=1, graph_definition={"nodes": [], "edges": []})
        db.add(version)
        db.flush()
        db.add(models.JourneyEnrollment(journey_id=journey.id, version_id=version.id, lead_id=demo.id, current_node_id="wait", status="active"))
        db.commit()

        client.post("/api/webhooks/messenger-sms", json={"type": "incoming", "from": "14703271150", "to": "14702059963", "message": "yes"})
        log = db.query(models.SmsLog).filter(models.SmsLog.direction == "inbound").one()
        assert log.lead_id == demo.id

        db.query(models.JourneyEnrollment).delete()
        db.commit()
        client.post("/api/webhooks/messenger-sms", json={"type": "incoming", "from": "14703271150", "to": "14702059963", "message": "again"})
        latest = db.query(models.SmsLog).filter(models.SmsLog.message_text == "again").one()
        assert latest.lead_id == newest.id    # nobody in a cadence: the newest lead

    def test_unknown_channel_value_falls_back_to_sms(self, db, client):
        import models
        create_test_lead(db, phone="+919876543210")

        client.post("/api/webhooks/messenger-sms", json={
            "type": "incoming",
            "from": "+919876543210",
            "to": "918956778474",
            "message": "hi",
            "channel": "telepathy",
        })

        log = db.query(models.SmsLog).filter(models.SmsLog.direction == "inbound").first()
        assert log.channel == "sms"
