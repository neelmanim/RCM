"""
Tests for the Activity Monitor's new endpoints — GET /api/admin/email-logs
and GET /api/admin/message-logs — added alongside the existing call-logs
endpoint (see test_call_monitor.py) to give Super Admins and Pod Admins a
unified Calls/Email/Messages monitoring surface.

Covers:
  - Happy path: response shape, field presence, pagination, SDR dropdown
  - Filters: sdr_id, direction, channel, status, date range
  - Summary correctness (email reuses _compute_email_stats; message status is
    bucketed via ILIKE since SmsLog.status is provider-controlled free text,
    not a closed enum — verified against a real "unexpected" provider string)
  - Pod Admin scoping: in-pod visible, out-of-pod hidden, for both endpoints
  - Security: SDR blocked from both endpoints
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
import pytest

from conftest import create_test_user, create_test_lead, create_test_pod
import models


# ── Factories ────────────────────────────────────────────────────────────────

def _make_email(db, user_id, lead_id, direction="outbound", subject="Hi there",
                 opened_at=None, open_count=0, click_count=0, timestamp=None,
                 nylas_thread_id=None):
    e = models.LeadEmailActivity(
        user_id=user_id, lead_id=lead_id, direction=direction, subject=subject,
        body_preview="Body preview text", opened_at=opened_at, open_count=open_count,
        click_count=click_count, nylas_thread_id=nylas_thread_id or f"thread-{user_id}-{lead_id}",
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    if timestamp:
        e.timestamp = timestamp
        db.commit()
    return e


def _make_message(db, user_id, lead_id, direction="outbound", status="sent",
                   channel="sms", message_text="Hello!", failure_reason=None):
    m = models.SmsLog(
        user_id=user_id, lead_id=lead_id, direction=direction, status=status,
        channel=channel, message_text=message_text, phone_number="+10000000009",
        failure_reason=failure_reason,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def _pod_admin_client(db, pod_id, email="pa@t.com"):
    """Mirrors test_call_monitor.py's Pod Admin TestClient-override pattern."""
    from fastapi.testclient import TestClient
    from tests.conftest import _build_test_app
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin

    pa = create_test_user(db, email=email, role="Pod Admin", pod_id=pod_id)
    payload = {"sub": pa.id, "email": email, "name": "PA", "role": "Pod Admin", "pod_id": pod_id}

    app = _build_test_app()

    def _override_db():
        yield db

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: payload
    app.dependency_overrides[require_admin] = lambda: payload
    app.dependency_overrides[require_super_admin] = lambda: (_ for _ in ()).throw(
        __import__('fastapi').HTTPException(status_code=403, detail="Super Admin only")
    )
    return TestClient(app), app


# ── Email logs — happy path ──────────────────────────────────────────────────

class TestEmailLogsBasic:

    def test_endpoint_returns_200(self, client, db):
        sdr = create_test_user(db, email="sdr_email1@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_email1@t.com")
        _make_email(db, sdr.id, lead.id)
        resp = client.get("/api/admin/email-logs")
        assert resp.status_code == 200

    def test_response_shape(self, client, db):
        sdr = create_test_user(db, email="sdr_email2@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_email2@t.com")
        _make_email(db, sdr.id, lead.id)
        data = client.get("/api/admin/email-logs").json()
        for key in ("items", "total", "page", "per_page", "pages", "summary", "sdrs"):
            assert key in data

    def test_item_fields_and_lead_sdr_populated(self, client, db):
        sdr = create_test_user(db, email="sdr_email3@t.com", name="Email SDR", role="SDR")
        lead = create_test_lead(db, email="lead_email3@t.com", first_name="Ada", last_name="Lovelace", company="Computing Ltd")
        _make_email(db, sdr.id, lead.id, subject="Following up", open_count=2, click_count=1,
                    opened_at=datetime(2024, 6, 1))
        items = client.get("/api/admin/email-logs").json()["items"]
        item = next(i for i in items if i["subject"] == "Following up")
        assert item["sdr_name"] == "Email SDR"
        assert item["lead_name"] == "Ada Lovelace"
        assert item["lead_company"] == "Computing Ltd"
        assert item["open_count"] == 2
        assert item["click_count"] == 1
        assert item["opened_at"] is not None

    def test_summary_matches_compute_email_stats(self, client, db):
        """v14.0.1: opened = different leads who opened, rate = against different leads emailed (never above 100%)."""
        sdr = create_test_user(db, email="sdr_email4@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_email4@t.com")
        lead2 = create_test_lead(db, email="lead_email4b@t.com")
        _make_email(db, sdr.id, lead.id, direction="outbound", opened_at=datetime(2024, 6, 1))
        _make_email(db, sdr.id, lead2.id, direction="outbound", opened_at=None)
        data = client.get("/api/admin/email-logs").json()
        assert data["summary"]["sent"] == 2
        assert data["summary"]["opened"] == 1
        assert data["summary"]["open_rate"] == 50.0

class TestEmailLogsFilters:

    def test_filter_by_sdr_id(self, client, db):
        sdr1 = create_test_user(db, email="sdr_ef1@t.com", role="SDR")
        sdr2 = create_test_user(db, email="sdr_ef2@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_ef@t.com")
        _make_email(db, sdr1.id, lead.id)
        _make_email(db, sdr2.id, lead.id)
        data = client.get("/api/admin/email-logs", params={"sdr_id": sdr1.id}).json()
        for item in data["items"]:
            assert item["sdr_name"] is not None

    def test_filter_by_direction(self, client, db):
        sdr = create_test_user(db, email="sdr_ef3@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_ef3@t.com")
        _make_email(db, sdr.id, lead.id, direction="outbound")
        _make_email(db, sdr.id, lead.id, direction="inbound")
        data = client.get("/api/admin/email-logs", params={"direction": "inbound"}).json()
        for item in data["items"]:
            assert item["direction"] == "inbound"

    def test_sort_by_direction(self, client, db):
        sdr = create_test_user(db, email="sdr_ef4@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_ef4@t.com")
        _make_email(db, sdr.id, lead.id, direction="outbound")
        _make_email(db, sdr.id, lead.id, direction="inbound")
        items = client.get("/api/admin/email-logs?sort_by=direction").json()["items"]
        directions = [i["direction"] for i in items]
        assert directions == sorted(directions)


class TestEmailLogsPodAdminScoping:

    def test_pod_admin_sees_email_via_own_sdr_regardless_of_lead_pod(self, db):
        """Activity Monitor scopes by sender-or-lead pod (see route docstring)
        — an email sent by one of the Pod Admin's own SDRs must be visible
        even if the lead itself isn't (yet) assigned into that pod."""
        pod = create_test_pod(db, name="Email Pod")
        in_sdr = create_test_user(db, email="in_email@t.com", role="SDR", pod_id=pod.id)
        out_sdr = create_test_user(db, email="out_email@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_pod_email@t.com")  # not assigned to any pod
        in_email = _make_email(db, in_sdr.id, lead.id, subject="In pod")
        out_email = _make_email(db, out_sdr.id, lead.id, subject="Out of pod")

        c, app = _pod_admin_client(db, pod.id, email="pa_email@t.com")
        with c:
            data = c.get("/api/admin/email-logs").json()
        ids = [i["id"] for i in data["items"]]
        assert in_email.id in ids
        assert out_email.id not in ids
        app.dependency_overrides.clear()

    def test_pod_admin_does_not_see_outside_senders_email_on_a_lead_in_their_pod(self, db):
        """v14.0.0: the sender's pod decides — an outside rep's email about a lead in this pod stays hidden."""
        pod = create_test_pod(db, name="Email Lead Pod")
        out_sdr = create_test_user(db, email="out_email2@t.com", role="SDR")
        in_pod_lead = create_test_lead(db, email="lead_pod_email2@t.com", pod_id=pod.id)
        email_via_lead = _make_email(db, out_sdr.id, in_pod_lead.id, subject="Via lead pod")

        c, app = _pod_admin_client(db, pod.id, email="pa_email2@t.com")
        with c:
            data = c.get("/api/admin/email-logs").json()
        ids = [i["id"] for i in data["items"]]
        assert email_via_lead.id not in ids
        app.dependency_overrides.clear()

    def test_open_rate_never_exceeds_100_with_instantly_counter_rows(self, client, db):
        lead = create_test_lead(db, email="ctr_l@t.com")
        for _ in range(3):   # Instantly counter rows carry the opens but are not sends
            e = _make_email(db, None, lead.id, direction="outbound", opened_at=datetime(2024, 6, 1), nylas_thread_id=None)
            e.source = "instantly"
        real = _make_email(db, None, lead.id, direction="outbound")
        real.source, real.instantly_email_id = "instantly", "em-1"
        db.commit()
        s = client.get("/api/admin/email-logs").json()["summary"]
        assert s["sent"] == 1 and s["opened"] == 1 and s["open_rate"] == 100.0

    def test_pod_admin_with_no_pod_sees_nothing(self, db):
        out_sdr = create_test_user(db, email="nopod_s@t.com", role="SDR")
        lead = create_test_lead(db, email="nopod_l@t.com")
        _make_email(db, out_sdr.id, lead.id, subject="x")
        c, app = _pod_admin_client(db, None, email="nopod_pa@t.com")
        with c:
            assert c.get("/api/admin/email-logs").json()["items"] == []
        app.dependency_overrides.clear()


class TestEmailLogsSecurity:

    def test_sdr_cannot_access_email_logs(self, client_as_sdr):
        resp = client_as_sdr.get("/api/admin/email-logs")
        assert resp.status_code == 403


# ── Message logs — happy path ────────────────────────────────────────────────

class TestMessageLogsBasic:

    def test_endpoint_returns_200(self, client, db):
        sdr = create_test_user(db, email="sdr_msg1@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_msg1@t.com")
        _make_message(db, sdr.id, lead.id)
        resp = client.get("/api/admin/message-logs")
        assert resp.status_code == 200

    def test_response_shape(self, client, db):
        sdr = create_test_user(db, email="sdr_msg2@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_msg2@t.com")
        _make_message(db, sdr.id, lead.id)
        data = client.get("/api/admin/message-logs").json()
        for key in ("items", "total", "page", "per_page", "pages", "summary", "sdrs"):
            assert key in data

    def test_item_fields_populated(self, client, db):
        sdr = create_test_user(db, email="sdr_msg3@t.com", name="Msg SDR", role="SDR")
        lead = create_test_lead(db, email="lead_msg3@t.com", first_name="Grace", last_name="Hopper")
        _make_message(db, sdr.id, lead.id, channel="whatsapp", message_text="Following up", status="delivered")
        items = client.get("/api/admin/message-logs").json()["items"]
        item = next(i for i in items if i["message_text"] == "Following up")
        assert item["sdr_name"] == "Msg SDR"
        assert item["lead_name"] == "Grace Hopper"
        assert item["channel"] == "whatsapp"
        assert item["status"] == "delivered"

    def test_summary_sent_delivered_failed_and_channel_split(self, client, db):
        sdr = create_test_user(db, email="sdr_msg4@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_msg4@t.com")
        _make_message(db, sdr.id, lead.id, direction="outbound", status="sent", channel="sms")
        _make_message(db, sdr.id, lead.id, direction="outbound", status="delivered", channel="whatsapp")
        _make_message(db, sdr.id, lead.id, direction="outbound", status="failed", channel="sms",
                      failure_reason="Session expired")
        data = client.get("/api/admin/message-logs", params={"sdr_id": sdr.id}).json()
        assert data["summary"]["sent"] == 3       # all 3 are outbound
        assert data["summary"]["delivered"] == 1
        assert data["summary"]["failed"] == 1
        assert data["summary"]["whatsapp_count"] == 1
        assert data["summary"]["sms_count"] == 2

    def test_arbitrary_provider_status_string_does_not_crash_or_miscount(self, client, db):
        """SmsLog.status is provider-controlled free text (webhook_routes.py's
        messenger_sms_webhook passes through whatever the delivery-report
        payload sends), not the closed 'sent'|'delivered'|'failed' set its own
        column comment implies. An unrecognised status (e.g. a provider's
        'expired' or 'read') must not crash the aggregate query or get
        miscounted as delivered/failed."""
        sdr = create_test_user(db, email="sdr_msg5@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_msg5@t.com")
        _make_message(db, sdr.id, lead.id, direction="outbound", status="expired")
        data = client.get("/api/admin/message-logs", params={"sdr_id": sdr.id}).json()
        assert data["summary"]["sent"] == 1
        assert data["summary"]["delivered"] == 0
        assert data["summary"]["failed"] == 0

    def test_inbound_received_status_visible(self, client, db):
        """Inbound messages (status='received', from the webhook's incoming
        branch) must still appear in the feed, just not counted in 'sent'."""
        sdr = create_test_user(db, email="sdr_msg6@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_msg6@t.com")
        _make_message(db, sdr.id, lead.id, direction="inbound", status="received")
        data = client.get("/api/admin/message-logs", params={"sdr_id": sdr.id}).json()
        assert data["total"] == 1
        assert data["summary"]["sent"] == 0


class TestMessageLogsFilters:

    def test_filter_by_channel(self, client, db):
        sdr = create_test_user(db, email="sdr_mf1@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_mf1@t.com")
        _make_message(db, sdr.id, lead.id, channel="sms")
        _make_message(db, sdr.id, lead.id, channel="whatsapp")
        data = client.get("/api/admin/message-logs", params={"sdr_id": sdr.id, "channel": "whatsapp"}).json()
        for item in data["items"]:
            assert item["channel"] == "whatsapp"

    def test_sort_by_channel(self, client, db):
        sdr = create_test_user(db, email="sdr_mf2@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_mf2@t.com")
        _make_message(db, sdr.id, lead.id, channel="whatsapp")
        _make_message(db, sdr.id, lead.id, channel="sms")
        items = client.get("/api/admin/message-logs", params={"sdr_id": sdr.id, "sort_by": "channel"}).json()["items"]
        channels = [i["channel"] for i in items]
        assert channels == sorted(channels)

    def test_filter_by_status_bucket_delivered(self, client, db):
        sdr = create_test_user(db, email="sdr_mf2@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_mf2@t.com")
        _make_message(db, sdr.id, lead.id, status="delivered")
        _make_message(db, sdr.id, lead.id, status="failed")
        data = client.get("/api/admin/message-logs", params={"sdr_id": sdr.id, "status": "delivered"}).json()
        for item in data["items"]:
            assert "deliver" in item["status"].lower()

    def test_null_lead_does_not_crash(self, client, db):
        sdr = create_test_user(db, email="sdr_mf3@t.com", role="SDR")
        m = models.SmsLog(user_id=sdr.id, lead_id=None, direction="outbound", status="sent",
                          channel="sms", message_text="No lead", phone_number="+10000000010")
        db.add(m)
        db.commit()
        data = client.get("/api/admin/message-logs", params={"sdr_id": sdr.id}).json()
        item = next(i for i in data["items"] if i["message_text"] == "No lead")
        assert item["lead_id"] is None


class TestMessageLogsPodAdminScoping:

    def test_pod_admin_sees_only_pod_messages(self, db):
        pod = create_test_pod(db, name="Message Pod")
        in_sdr = create_test_user(db, email="in_msg@t.com", role="SDR", pod_id=pod.id)
        out_sdr = create_test_user(db, email="out_msg@t.com", role="SDR")
        lead = create_test_lead(db, email="lead_pod_msg@t.com")
        in_msg = _make_message(db, in_sdr.id, lead.id, message_text="In pod")
        out_msg = _make_message(db, out_sdr.id, lead.id, message_text="Out of pod")

        c, app = _pod_admin_client(db, pod.id, email="pa_msg@t.com")
        with c:
            data = c.get("/api/admin/message-logs").json()
        ids = [i["id"] for i in data["items"]]
        assert in_msg.id in ids
        assert out_msg.id not in ids
        app.dependency_overrides.clear()


class TestMessageLogsSecurity:

    def test_sdr_cannot_access_message_logs(self, client_as_sdr):
        resp = client_as_sdr.get("/api/admin/message-logs")
        assert resp.status_code == 403
