"""
Tests for the Cadence/Messaging Sandbox feature: Lead.is_test, the
destination-override guard in whatsapp_channel.py/sms_channel.py,
force_next_step(), and the sandbox enroll/clear endpoints
(routes/journey_routes.py). Analytics-exclusion tests live alongside their
respective endpoints in test_analytics_routes.py / test_journey_routes.py.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import models
import journey_engine.engine as je
from conftest import create_test_lead
from journey_engine.engine import force_next_step
from tests.test_journey_engine import _make_journey, _setup_whatsapp_infra, _setup_sms_infra, WHATSAPP_GRAPH


class TestDestinationOverrideGuard:
    """The core safety mechanism: an is_test lead's own phone field is never
    the real send target — every cadence send is redirected to
    SyncSettings.sandbox_test_phone_number, unconditionally."""

    def test_whatsapp_send_to_test_lead_targets_sandbox_number_not_lead_phone(self, db):
        from messaging_provider import SendMessageResult

        settings = _setup_whatsapp_infra(db)
        settings.sandbox_test_phone_number = "911111111111"
        db.commit()
        journey, version = _make_journey(db, graph=WHATSAPP_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        lead.is_test = True
        db.commit()
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        fake_result = SendMessageResult(success=True, provider="rcm", channel="whatsapp", message_id="wa-1")
        with patch("journey_engine.channels.whatsapp_channel.get_messaging_provider_for_org") as mock_get:
            mock_provider = MagicMock()
            mock_provider.send.return_value = fake_result
            mock_get.return_value = mock_provider
            je._handle_channel_node(db, enrollment, journey, queue_row, WHATSAPP_GRAPH, "whatsapp", WHATSAPP_GRAPH["nodes"][1]["data"])
            db.commit()

        call_kwargs = mock_provider.send.call_args.kwargs
        assert call_kwargs["phone"] == "911111111111"
        assert call_kwargs["phone"] != lead.phone

        log = db.query(models.SmsLog).filter(models.SmsLog.message_id == "wa-1").first()
        assert log.phone_number == "911111111111"

    def test_whatsapp_send_to_test_lead_fails_closed_without_a_sandbox_number(self, db):
        _setup_whatsapp_infra(db)  # sandbox_test_phone_number left unset
        journey, version = _make_journey(db, graph=WHATSAPP_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        lead.is_test = True
        db.commit()
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        with patch("journey_engine.channels.whatsapp_channel.get_messaging_provider_for_org") as mock_get:
            je._handle_channel_node(db, enrollment, journey, queue_row, WHATSAPP_GRAPH, "whatsapp", WHATSAPP_GRAPH["nodes"][1]["data"])
            db.commit()

        mock_get.assert_not_called()
        assert queue_row.status == "failed"

    def test_sms_send_to_test_lead_targets_sandbox_number_not_lead_phone(self, db):
        SMS_GRAPH = {
            "nodes": [
                {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
                {"id": "n2", "type": "sms", "data": {"message": "hi"}},
            ],
            "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
        }
        settings = _setup_sms_infra(db)
        settings.sandbox_test_phone_number = "922222222222"
        db.commit()
        journey, version = _make_journey(db, graph=SMS_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        lead.is_test = True
        db.commit()
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        with patch("journey_engine.channels.sms_channel.sms_service.send_sms") as mock_send:
            mock_send.return_value = {"success": True, "message_id": "sms-1"}
            je._handle_channel_node(db, enrollment, journey, queue_row, SMS_GRAPH, "sms", SMS_GRAPH["nodes"][1]["data"])
            db.commit()

        assert mock_send.call_args[0][2] == "922222222222"


FORCE_STEP_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
        {"id": "n2", "type": "wait", "data": {"duration_hours": 24}},
        {"id": "n3", "type": "wait", "data": {"duration_hours": 1}},
    ],
    "edges": [{"id": "e1", "source": "n1", "target": "n2"}, {"id": "e2", "source": "n2", "target": "n3"}],
}


class TestForceNextStep:
    def test_advances_an_active_enrollment_immediately(self, db):
        journey, version = _make_journey(db, graph=FORCE_STEP_GRAPH)
        lead = create_test_lead(db, status="New")
        enrollment = je.enroll_lead(db, journey, lead)
        assert enrollment.status == "active"
        assert enrollment.current_node_id == "n2"

        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id,
            models.JourneyExecutionQueue.status == "pending",
        ).first()
        # SQLite (this test DB) returns naive datetimes regardless of how
        # they were stored — normalize before comparing.
        next_run_at = queue_row.next_run_at
        if next_run_at.tzinfo is None:
            next_run_at = next_run_at.replace(tzinfo=timezone.utc)
        assert next_run_at > datetime.now(timezone.utc) + timedelta(hours=1)

        qid = force_next_step(db, enrollment.id)
        assert qid == queue_row.id

        db.refresh(enrollment)
        assert enrollment.current_node_id == "n3"

    def test_raises_for_a_non_active_enrollment(self, db):
        journey, version = _make_journey(db, graph=FORCE_STEP_GRAPH)
        lead = create_test_lead(db, status="New")
        enrollment = je.enroll_lead(db, journey, lead)
        enrollment.status = "completed"
        db.commit()

        try:
            force_next_step(db, enrollment.id)
            assert False, "expected ValueError"
        except ValueError:
            pass

    def test_raises_for_an_unknown_enrollment(self, db):
        try:
            force_next_step(db, "does-not-exist")
            assert False, "expected ValueError"
        except ValueError:
            pass


class TestSandboxEndpoints:
    def _publish(self, client, graph):
        created = client.post("/api/journeys", json={"name": "Sandbox Test Journey"}).json()
        client.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
                   json={"graph_definition": graph})
        client.post(f"/api/journeys/{created['id']}/publish")
        return created["id"]

    def test_enroll_test_lead_requires_a_sandbox_number_configured(self, client_as_pod_admin, db):
        journey_id = self._publish(client_as_pod_admin, FORCE_STEP_GRAPH)
        resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/sandbox/enroll-test-lead", json={})
        assert resp.status_code == 422

    def test_enroll_test_lead_creates_a_tagged_lead_and_enrolls_it(self, client_as_pod_admin, db):
        settings = models.SyncSettings(id=1, sandbox_test_phone_number="911111111111")
        db.add(settings)
        db.commit()

        journey_id = self._publish(client_as_pod_admin, FORCE_STEP_GRAPH)
        resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/sandbox/enroll-test-lead", json={"label": "My Test"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["phone"] == "911111111111"

        lead = db.query(models.Lead).filter(models.Lead.id == body["lead_id"]).first()
        assert lead.is_test is True
        assert lead.phone == "911111111111"

        enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.id == body["enrollment_id"]).first()
        assert enrollment is not None
        assert enrollment.lead_id == lead.id

    def test_enroll_test_lead_ignores_any_phone_the_caller_passes(self, client_as_pod_admin, db):
        settings = models.SyncSettings(id=1, sandbox_test_phone_number="911111111111")
        db.add(settings)
        db.commit()
        journey_id = self._publish(client_as_pod_admin, FORCE_STEP_GRAPH)

        resp = client_as_pod_admin.post(
            f"/api/journeys/{journey_id}/sandbox/enroll-test-lead",
            json={"label": "x", "phone": "918888888888"},
        )
        lead = db.query(models.Lead).filter(models.Lead.id == resp.json()["lead_id"]).first()
        assert lead.phone == "911111111111"

    def test_clear_test_leads_deletes_only_is_test_leads(self, client_as_pod_admin, db):
        real_lead = create_test_lead(db, email="real@t.com")
        test_lead = create_test_lead(db, email="test@t.com")
        test_lead.is_test = True
        db.commit()
        real_lead_id, test_lead_id = real_lead.id, test_lead.id

        resp = client_as_pod_admin.delete("/api/journeys/sandbox/test-leads")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 1

        assert db.query(models.Lead).filter(models.Lead.id == real_lead_id).first() is not None
        assert db.query(models.Lead).filter(models.Lead.id == test_lead_id).first() is None

    def test_clear_test_leads_cascades_enrollments(self, client_as_pod_admin, db):
        settings = models.SyncSettings(id=1, sandbox_test_phone_number="911111111111")
        db.add(settings)
        db.commit()
        journey_id = self._publish(client_as_pod_admin, FORCE_STEP_GRAPH)
        body = client_as_pod_admin.post(f"/api/journeys/{journey_id}/sandbox/enroll-test-lead", json={}).json()

        client_as_pod_admin.delete("/api/journeys/sandbox/test-leads")

        assert db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.id == body["enrollment_id"]).first() is None
