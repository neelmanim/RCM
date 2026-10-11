"""
v13.0.6 — cadence reporting gap remediation: SMS/WhatsApp engagement,
cross-cadence comparison, per-rep performance, opt-out rate, trend.
Each test targets one of the cross-cutting edge cases from the plan, not
just the happy path.
"""
from datetime import datetime, timedelta, timezone

import pytest

from conftest import create_test_lead, create_test_user
import models

# Mirrors test_analytics_routes.py's own convention: date_trunc is
# Postgres-only and raises OperationalError on SQLite (local test env). It
# WILL pass on staging (real Postgres DB) — not a new limitation introduced
# here, the existing analytics /trend endpoints have the same one.
_postgres_only = pytest.mark.xfail(
    reason="date_trunc is Postgres-only; SQLite raises OperationalError",
    strict=False,
)

LINEAR_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0},
         "data": {"event": "status_changed", "to_status": "New"}},
        {"id": "n2", "type": "email", "position": {"x": 200, "y": 0},
         "data": {"subject": "Hi", "body": "Hello"}},
    ],
    "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
}


def _publish_linear_journey(client, name="Test Journey"):
    created = client.post("/api/journeys", json={"name": name}).json()
    client.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
               json={"graph_definition": LINEAR_GRAPH})
    client.post(f"/api/journeys/{created['id']}/publish")
    return created["id"]


class TestInstantlyEngagementStats:
    """v13.3.0 — an instantly_sequence node's engagement must show up in the
    cadence's own Reporting tab, not only in Control Center's workspace-wide
    Instantly analytics (confirmed live on staging: without this, a cadence
    using Instantly had zero visibility in the one place a rep would
    actually look)."""

    INSTANTLY_GRAPH = {
        "nodes": [
            {"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0},
             "data": {"event": "status_changed", "to_status": "New"}},
            {"id": "n2", "type": "instantly_sequence", "position": {"x": 200, "y": 0},
             "data": {"steps": [{"subject": "s", "body": "b", "delay_days": 0}]}},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }

    def _publish(self, client):
        created = client.post("/api/journeys", json={"name": "Instantly Reporting Test"}).json()
        client.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
                   json={"graph_definition": self.INSTANTLY_GRAPH})
        client.post(f"/api/journeys/{created['id']}/publish")
        return created["id"]

    def test_sent_opened_clicked_replied_computed_for_an_instantly_step(self, client_as_pod_admin, db):
        journey_id = self._publish(client_as_pod_admin)
        campaign = models.JourneyInstantlyCampaign(
            journey_id=journey_id, node_id="n2", instantly_campaign_id="camp-1", content_hash="h1",
        )
        db.add(campaign); db.flush()

        lead1 = create_test_lead(db, status="New", email="inst1@t.com")
        lead2 = create_test_lead(db, status="New", email="inst2@t.com")
        version_id = db.query(models.Journey).get(journey_id).live_version_id
        e1 = models.JourneyEnrollment(journey_id=journey_id, version_id=version_id, lead_id=lead1.id,
                                       current_node_id="n2", status="active")
        e2 = models.JourneyEnrollment(journey_id=journey_id, version_id=version_id, lead_id=lead2.id,
                                       current_node_id="n2", status="active")
        db.add_all([e1, e2]); db.flush()
        db.add_all([
            models.JourneyInstantlyEnrollment(journey_enrollment_id=e1.id, node_id="n2",
                                               instantly_campaign_id="camp-1", status="active"),
            models.JourneyInstantlyEnrollment(journey_enrollment_id=e2.id, node_id="n2",
                                               instantly_campaign_id="camp-1", status="active"),
        ])
        # lead1: opened and clicked. lead2: replied (inbound row).
        db.add(models.LeadEmailActivity(
            lead_id=lead1.id, direction="outbound", source="instantly", instantly_campaign_id="camp-1",
            opened_at=datetime.now(timezone.utc), clicked_at=datetime.now(timezone.utc),
        ))
        db.add(models.LeadEmailActivity(
            lead_id=lead2.id, direction="inbound", source="instantly", instantly_campaign_id="camp-1",
        ))
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        assert resp.status_code == 200
        by_step = resp.json()["engagement"]["by_step"]
        assert by_step["n2"] == {
            "sent": 2, "opened": 1, "clicked": 1, "replied": 1,
            "open_rate": 0.5, "click_rate": 0.5, "reply_rate": 0.5,
        }
        # Rolls into overall engagement too, not just its own step bucket.
        overall = resp.json()["engagement"]["overall"]
        assert overall["sent"] == 2
        assert overall["replied"] == 1

    def test_a_journey_with_no_instantly_campaign_yet_has_no_instantly_step_entries(self, client_as_pod_admin):
        # No JourneyInstantlyCampaign row exists until the node actually
        # fires once — must not 500 or fabricate a zeroed entry for it.
        journey_id = self._publish(client_as_pod_admin)
        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        assert resp.status_code == 200
        assert "n2" not in resp.json()["engagement"]["by_step"]


class TestSmsEngagementStats:
    def test_delivered_and_reply_rate_computed_for_sms_steps(self, client_as_pod_admin, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        lead = create_test_lead(db, status="New", email="sms_engage@t.com")
        enrollment = models.JourneyEnrollment(
            journey_id=journey_id, version_id=db.query(models.Journey).get(journey_id).live_version_id,
            lead_id=lead.id, current_node_id="n2", status="active",
            enrolled_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        db.add(enrollment)
        db.commit()

        db.add(models.SmsLog(
            lead_id=lead.id, direction="outbound", status="delivered", channel="sms",
            journey_id=journey_id, enrollment_id=enrollment.id, journey_node_id="n2",
            sent_at=datetime.now(timezone.utc) - timedelta(minutes=50),
        ))
        # Reply within the enrollment window — should count.
        db.add(models.SmsLog(
            lead_id=lead.id, direction="inbound", status="received", channel="sms",
            sent_at=datetime.now(timezone.utc) - timedelta(minutes=30),
        ))
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        assert resp.status_code == 200
        sms = resp.json()["sms_engagement"]["overall"]
        assert sms["sent"] == 1
        assert sms["delivered"] == 1
        assert sms["delivery_rate"] == 1.0
        assert sms["replied"] == 1
        assert sms["reply_rate"] == 1.0

    def test_unexpected_provider_status_does_not_count_as_delivered(self, client_as_pod_admin, db):
        """Cross-cutting edge case #3 — SmsLog.status is an unvalidated
        pass-through from the provider webhook; an unexpected string must
        not silently count toward the delivery rate."""
        journey_id = _publish_linear_journey(client_as_pod_admin)
        lead = create_test_lead(db, status="New", email="sms_weird_status@t.com")
        enrollment = models.JourneyEnrollment(
            journey_id=journey_id, version_id=db.query(models.Journey).get(journey_id).live_version_id,
            lead_id=lead.id, current_node_id="n2", status="active",
        )
        db.add(enrollment)
        db.commit()
        db.add(models.SmsLog(
            lead_id=lead.id, direction="outbound", status="some_unexpected_vendor_string",
            channel="sms", journey_id=journey_id, enrollment_id=enrollment.id, journey_node_id="n2",
        ))
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        sms = resp.json()["sms_engagement"]["overall"]
        assert sms["sent"] == 1
        assert sms["delivered"] == 0, "an unrecognized status string must not count as delivered"

    def test_reply_outside_enrollment_window_does_not_count(self, client_as_pod_admin, db):
        """A reply that arrives after the enrollment already ended must not
        be attributed to it."""
        journey_id = _publish_linear_journey(client_as_pod_admin)
        lead = create_test_lead(db, status="New", email="sms_late_reply@t.com")
        enrollment = models.JourneyEnrollment(
            journey_id=journey_id, version_id=db.query(models.Journey).get(journey_id).live_version_id,
            lead_id=lead.id, current_node_id="n2", status="completed",
            enrolled_at=datetime.now(timezone.utc) - timedelta(days=2),
            completed_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
        db.add(enrollment)
        db.commit()
        db.add(models.SmsLog(
            lead_id=lead.id, direction="outbound", status="sent", channel="sms",
            journey_id=journey_id, enrollment_id=enrollment.id, journey_node_id="n2",
            sent_at=datetime.now(timezone.utc) - timedelta(days=2),
        ))
        # Reply arrives well after this enrollment completed.
        db.add(models.SmsLog(
            lead_id=lead.id, direction="inbound", status="received", channel="sms",
            sent_at=datetime.now(timezone.utc),
        ))
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        sms = resp.json()["sms_engagement"]["overall"]
        assert sms["replied"] == 0, "a reply after the enrollment ended must not count toward its reply rate"

    def test_no_sms_activity_returns_zeroed_rates_not_a_crash(self, client_as_pod_admin):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        assert resp.status_code == 200
        sms = resp.json()["sms_engagement"]["overall"]
        assert sms == {"sent": 0, "delivered": 0, "replied": 0,
                        "delivery_rate": 0.0, "reply_rate": 0.0}

    def test_sandbox_test_lead_sms_excluded(self, client_as_pod_admin, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        test_lead = create_test_lead(db, status="New", email="sms_sandbox@t.com")
        test_lead.is_test = True
        db.commit()
        enrollment = models.JourneyEnrollment(
            journey_id=journey_id, version_id=db.query(models.Journey).get(journey_id).live_version_id,
            lead_id=test_lead.id, current_node_id="n2", status="active",
        )
        db.add(enrollment)
        db.commit()
        db.add(models.SmsLog(
            lead_id=test_lead.id, direction="outbound", status="delivered", channel="sms",
            journey_id=journey_id, enrollment_id=enrollment.id, journey_node_id="n2",
        ))
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        sms = resp.json()["sms_engagement"]["overall"]
        assert sms["sent"] == 0, "a sandbox/test lead's SMS must not appear in real reporting"


class TestCrossCadenceBulkStats:
    def test_bulk_stats_returns_per_journey_breakdown(self, client_as_pod_admin, db):
        j1 = _publish_linear_journey(client_as_pod_admin, name="Cadence One")
        j2 = _publish_linear_journey(client_as_pod_admin, name="Cadence Two")
        lead1 = create_test_lead(db, status="New", email="bulk1@t.com")
        lead2 = create_test_lead(db, status="New", email="bulk2@t.com")
        client_as_pod_admin.post(f"/api/journeys/{j1}/enroll", json={"lead_ids": [lead1.id]})
        client_as_pod_admin.post(f"/api/journeys/{j2}/enroll", json={"lead_ids": [lead2.id]})

        resp = client_as_pod_admin.get(f"/api/journeys/stats-bulk?ids={j1},{j2}")
        assert resp.status_code == 200
        journeys = resp.json()["journeys"]
        assert journeys[j1]["active"] == 1
        assert journeys[j2]["active"] == 1

    def test_bulk_stats_silently_drops_nonexistent_ids(self, client_as_pod_admin, db):
        j1 = _publish_linear_journey(client_as_pod_admin)
        resp = client_as_pod_admin.get(f"/api/journeys/stats-bulk?ids={j1},not-a-real-id")
        assert resp.status_code == 200
        assert "not-a-real-id" not in resp.json()["journeys"]
        assert j1 in resp.json()["journeys"]

    def test_bulk_stats_empty_ids_returns_empty_dict_not_an_error(self, client_as_pod_admin):
        resp = client_as_pod_admin.get("/api/journeys/stats-bulk?ids=")
        assert resp.status_code == 200
        assert resp.json() == {"journeys": {}}


class TestPerRepCadencePerformance:
    def test_rep_breakdown_attributes_by_actual_sender(self, client_as_pod_admin, db):
        """Cross-cutting edge case #6 — attribution must reflect who
        actually sent, not whoever owns the lead now."""
        journey_id = _publish_linear_journey(client_as_pod_admin)
        rep_a = create_test_user(db, email="repa@t.com", name="Rep A", id="rep-a-id")
        rep_b = create_test_user(db, email="repb@t.com", name="Rep B", id="rep-b-id")
        lead = create_test_lead(db, status="New", email="rep_attr@t.com")

        # Rep A actually sent this email while they owned the lead...
        db.add(models.LeadEmailActivity(
            lead_id=lead.id, user_id=rep_a.id, direction="outbound",
            journey_id=journey_id, journey_node_id="n2", nylas_thread_id="th-1",
            opened_at=datetime.now(timezone.utc),
        ))
        db.commit()
        # ...then the lead got reassigned to Rep B. Historical attribution
        # must still credit Rep A, not Rep B.
        lead.assigned_users = [rep_b]
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats/by-rep")
        assert resp.status_code == 200
        reps = {r["user_id"]: r for r in resp.json()["reps"]}
        assert reps["rep-a-id"]["sent"] == 1
        assert reps["rep-a-id"]["opened"] == 1
        assert "rep-b-id" not in reps, "the new owner never sent anything and must not appear"

    def test_no_activity_returns_empty_list_not_a_crash(self, client_as_pod_admin):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats/by-rep")
        assert resp.status_code == 200
        assert resp.json() == {"reps": []}


class TestOptOutRate:
    def test_suppressed_exit_reason_surfaces_in_exit_reasons(self, client_as_pod_admin, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        lead = create_test_lead(db, status="New", email="optout@t.com")
        client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
        enrollment = db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.lead_id == lead.id
        ).first()
        enrollment.status = "exited_early"
        enrollment.exited_reason = "suppressed"
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        assert resp.json()["exit_reasons"].get("suppressed") == 1

    def test_opted_out_count_and_rate_are_computed_against_total_enrolled(self, client_as_pod_admin, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        suppressed_lead = create_test_lead(db, status="New", email="optout_rate@t.com")
        active_lead = create_test_lead(db, status="New", email="optout_rate_active@t.com")
        client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll",
                                  json={"lead_ids": [suppressed_lead.id, active_lead.id]})
        enrollment = db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.lead_id == suppressed_lead.id
        ).first()
        enrollment.status = "exited_early"
        enrollment.exited_reason = "suppressed"
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        body = resp.json()
        assert body["opted_out"]["count"] == 1
        assert body["opted_out"]["rate"] == 0.5

    def test_opted_out_rate_is_zero_not_a_crash_with_no_enrollments(self, client_as_pod_admin):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        assert resp.json()["opted_out"] == {"count": 0, "rate": 0.0}


class TestStepActivityManualParity:
    """v13.1.5 fix: _journey_step_activity never recognized a manual email/
    SMS approval step's own ExecutionLog events — every such step showed
    permanently zero sent/completed/missed. Drives the real engine (not
    hand-crafted ExecutionLog rows) through park → approve/timeout, exactly
    like test_manual_email_cadence_step.py / test_manual_sms_cadence_step.py
    do, then asserts on the stats endpoint a real UI would call."""

    def test_manual_email_step_reports_sent_and_completed(self, client, db):
        from journey_engine import engine as je
        from test_cadence_playbook import _journey, _edges, _run, _rep_lead, TRIGGER, WAIT
        from unittest.mock import patch
        from types import SimpleNamespace
        from crypto import encrypt_token
        from conftest import create_nylas_config, create_user_mailbox

        _, rep, lead = _rep_lead(db, first_name="Paul")
        create_nylas_config(db, api_key_encrypted=encrypt_token("k"))
        create_user_mailbox(db, user_id="owner-1")
        create_user_mailbox(db, user_id=rep.id, email_address="rep@test.com")
        email_node = {"id": "m", "type": "email", "data": {
            "subject": "Hi {{first_name}}", "body": "Following up.", "send_mode": "manual"}}
        j = _journey(db, [TRIGGER, email_node, WAIT], _edges(("t", "m"), ("m", "w")))
        e = je.enroll_lead(db, j, lead)
        _run(db, e)  # parks, creates the draft

        task = db.query(models.Task).filter(models.Task.journey_node_id == "m").one()
        with patch("email_send.send_email", side_effect=lambda *a, **kw: SimpleNamespace(
                success=True, error=None, retryable=False, provider_ref="msg-1")):
            je.complete_manual_email_step(db, task)

        resp = client.get(f"/api/journeys/{j.id}/stats")
        step = resp.json()["step_activity"]["m"]
        assert step == {"channel": "email", "sent": 1, "skipped": 0, "completed": 1,
                         "missed": 0, "outcomes": {}, "is_manual": True}

    def test_manual_sms_step_reports_missed_on_timeout(self, client, db):
        from journey_engine import engine as je
        from test_cadence_playbook import _journey, _edges, _run, _rep_lead, TRIGGER, WAIT
        from test_journey_engine import _setup_sms_infra

        _, rep, lead = _rep_lead(db, phone="+919876543210")
        _setup_sms_infra(db)
        sms_node = {"id": "m", "type": "sms", "data": {
            "message": "Hi there", "send_mode": "manual", "branch_on_timeout": "w"}}
        j = _journey(db, [TRIGGER, sms_node, WAIT], _edges(("t", "m"), ("m", "w")))
        e = je.enroll_lead(db, j, lead)
        _run(db, e)  # parks

        row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == e.id).first()
        from datetime import datetime, timezone
        row.next_run_at = datetime.now(timezone.utc)
        db.commit()
        _run(db, e)  # deadline reached, nobody approved it

        resp = client.get(f"/api/journeys/{j.id}/stats")
        step = resp.json()["step_activity"]["m"]
        assert step["channel"] == "sms"
        assert step["is_manual"] is True
        assert step["sent"] == 1
        assert step["missed"] == 1
        assert step["completed"] == 0

    def test_automated_email_step_never_appears_in_step_activity(self, client, db):
        """Automated email already has its own full stats via
        _journey_engagement_stats — it must not also show up here even
        after a real send, or the new unified cadence-steps UI would
        double-list the same step."""
        from journey_engine import engine as je
        from test_cadence_playbook import _email_journey, _run, _rep_lead, _capture_send
        from crypto import encrypt_token
        from conftest import create_nylas_config, create_user_mailbox

        _, rep, lead = _rep_lead(db, first_name="Paul")
        create_nylas_config(db, api_key_encrypted=encrypt_token("k"))
        create_user_mailbox(db, user_id="owner-1")
        j = _email_journey(db)
        e = je.enroll_lead(db, j, lead)
        sent, p = _capture_send()
        with p:
            _run(db, e)  # sends automatically, no approval step involved

        resp = client.get(f"/api/journeys/{j.id}/stats")
        assert sent  # sanity: the send actually happened
        assert resp.json()["step_activity"] == {}


class TestStatsTrend:
    @_postgres_only
    def test_trend_buckets_sends_by_week_with_open_rate(self, client_as_pod_admin, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        lead = create_test_lead(db, status="New", email="trend@t.com")
        db.add(models.LeadEmailActivity(
            lead_id=lead.id, direction="outbound", journey_id=journey_id,
            journey_node_id="n2", nylas_thread_id="trend-1",
            opened_at=datetime.now(timezone.utc),
            timestamp=datetime.now(timezone.utc),
        ))
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats/trend")
        assert resp.status_code == 200
        body = resp.json()
        assert body["bucket"] == "week"
        assert len(body["points"]) == 1
        assert body["points"][0]["sent"] == 1
        assert body["points"][0]["open_rate"] == 1.0

    @_postgres_only
    def test_no_data_returns_empty_points_not_a_crash(self, client_as_pod_admin):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats/trend")
        assert resp.status_code == 200
        assert resp.json()["points"] == []


class TestEnrollmentRoster:
    # Reads the roster as Super Admin: a Pod Admin only sees their own pod's leads (v13.8.0,
    # test_roster_access_v13_8.py), and these leads belong to no pod.
    """Feedback #8/#9: a per-lead roster — /stats only has status counts,
    this answers "which leads, specifically, and where are they right now."""

    def test_roster_lists_each_enrollment_with_current_step_or_exit_reason(self, client_as_pod_admin, client, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        active_lead = create_test_lead(db, status="New", first_name="Ann", last_name="", email="ann@t.com")
        exited_lead = create_test_lead(db, status="New", first_name="Bob", last_name="", email="bob@t.com")
        client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [active_lead.id, exited_lead.id]})
        exited = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.lead_id == exited_lead.id).one()
        exited.status, exited.exited_reason = "exited_early", "replied"
        db.commit()

        resp = client.get(f"/api/journeys/{journey_id}/enrollments")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        by_lead = {e["lead_name"]: e for e in body["enrollments"]}
        assert by_lead["Ann"]["status"] == "active"
        assert by_lead["Ann"]["current_node_label"]
        assert by_lead["Bob"]["status"] == "exited_early"
        assert by_lead["Bob"]["exited_reason"] == "replied"

    def test_roster_excludes_test_leads(self, client_as_pod_admin, client, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        lead = create_test_lead(db, status="New", email="realroster@t.com")
        test_lead = create_test_lead(db, status="New", email="testroster@t.com")
        test_lead.is_test = True
        db.commit()
        client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id, test_lead.id]})

        resp = client.get(f"/api/journeys/{journey_id}/enrollments")
        assert resp.json()["total"] == 1

    def test_roster_404s_for_an_unknown_journey(self, client_as_pod_admin):
        resp = client_as_pod_admin.get("/api/journeys/does-not-exist/enrollments")
        assert resp.status_code == 404

    def test_roster_includes_status_counts_and_stage_breakdown(self, client_as_pod_admin, client, db):
        """Live-demo feedback: stakeholders asked "what happened to those
        leads, what stage are they at" — these are the true-total aggregates
        (not just the current page) a roster view needs to answer that
        without scrolling every row."""
        journey_id = _publish_linear_journey(client_as_pod_admin)
        active_lead = create_test_lead(db, status="New", first_name="Ann", email="ann_stage@t.com")
        exited_lead = create_test_lead(db, status="New", first_name="Bob", email="bob_stage@t.com")
        client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [active_lead.id, exited_lead.id]})
        exited = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.lead_id == exited_lead.id).one()
        exited.status, exited.exited_reason = "exited_early", "replied"
        db.commit()

        resp = client.get(f"/api/journeys/{journey_id}/enrollments")
        body = resp.json()
        assert body["status_counts"] == {"active": 1, "exited_early": 1}
        assert len(body["stage_breakdown"]) == 1

    def test_roster_paginates_past_the_page_limit_and_aggregates_stay_true_totals(self, client_as_pod_admin, client, db):
        """A cadence with more leads than fit on one page — direct DB insert
        (not the real /enroll flow) since this only needs 501 rows to exist,
        not 501 real engine runs. status_counts/stage_breakdown must reflect
        every enrollment, not just the first page, and offset must actually
        move the window."""
        journey_id = _publish_linear_journey(client_as_pod_admin)
        version_id = db.query(models.Journey).get(journey_id).live_version_id
        total_leads = 501
        for i in range(total_leads):
            lead = create_test_lead(db, status="New", email=f"roster_scale_{i}@t.com")
            status = "active" if i < 500 else "completed"
            db.add(models.JourneyEnrollment(
                journey_id=journey_id, version_id=version_id, lead_id=lead.id,
                current_node_id="n2", status=status,
            ))
        db.commit()

        page1 = client.get(f"/api/journeys/{journey_id}/enrollments").json()
        assert page1["total"] == total_leads
        assert len(page1["enrollments"]) == 500
        assert page1["status_counts"] == {"active": 500, "completed": 1}
        assert len(page1["stage_breakdown"]) == 1
        assert page1["stage_breakdown"][0]["node_id"] == "n2"
        assert page1["stage_breakdown"][0]["count"] == 500

        page2 = client.get(f"/api/journeys/{journey_id}/enrollments?offset=500").json()
        assert len(page2["enrollments"]) == 1
        assert page2["total"] == total_leads
        assert page2["status_counts"] == page1["status_counts"]  # true totals, not page-scoped
        assert page2["stage_breakdown"] == page1["stage_breakdown"]

    def test_stage_breakdown_excludes_test_leads(self, client_as_pod_admin, client, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        test_lead = create_test_lead(db, status="New", email="stage_test_lead@t.com")
        test_lead.is_test = True
        db.commit()
        client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [test_lead.id]})

        resp = client.get(f"/api/journeys/{journey_id}/enrollments")
        body = resp.json()
        assert body["status_counts"] == {}
        assert body["stage_breakdown"] == []


class TestEnrollmentExport:
    """Feedback #10: a raw downloadable report instead of only the in-UI roster."""

    def test_export_returns_a_csv_with_one_row_per_enrollment(self, client_as_pod_admin, client, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        lead = create_test_lead(db, status="New", first_name="Carl", email="carl@t.com")
        client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

        resp = client.get(f"/api/journeys/{journey_id}/enrollments/export")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        assert "attachment" in resp.headers["content-disposition"]
        lines = resp.text.strip().splitlines()
        assert lines[0] == "lead_name,lead_email,lead_company,status,current_step,enrolled_at,completed_at,exited_reason"
        assert len(lines) == 2
        assert "Carl" in lines[1]

    def test_export_excludes_test_leads(self, client_as_pod_admin, client, db):
        journey_id = _publish_linear_journey(client_as_pod_admin)
        test_lead = create_test_lead(db, status="New", email="exporttest@t.com")
        test_lead.is_test = True
        db.commit()
        client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [test_lead.id]})

        resp = client.get(f"/api/journeys/{journey_id}/enrollments/export")
        assert len(resp.text.strip().splitlines()) == 1  # header only
