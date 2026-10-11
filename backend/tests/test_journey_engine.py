"""
Phase 0 tests for the Sales Journey execution engine.
Full design: docs/SALES_JOURNEY_ARCHITECTURE.md.

Covers: claim-query concurrency (two simulated workers), the idempotency
check (duplicate claim doesn't double-send), wait-node timing, the
suppression gate (Gap 1), the runaway-loop cap (Gap 3), and auto-enrollment
entry triggers (Gap 4).
"""
import json
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

import pytest

# Must be a base64-encoded 32-byte key (matches crypto.py validation) — same
# test key convention as test_public_api.py / test_email_stage1.py.
os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

import models
from crypto import encrypt_token
from journey_engine import engine as je
from journey_engine.channels.email_channel import EmailChannelProvider

from conftest import create_test_lead, create_test_user, create_nylas_config, create_user_mailbox


LINEAR_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
        {"id": "n2", "type": "email", "data": {"subject": "Hi", "body": "Hello there"}},
        {"id": "n3", "type": "wait", "data": {"duration_hours": 72}},
    ],
    "edges": [
        {"id": "e1", "source": "n1", "target": "n2"},
        {"id": "e2", "source": "n2", "target": "n3"},
    ],
}


def _make_journey(db, graph=LINEAR_GRAPH, owner_id="owner-1"):
    journey = models.Journey(name="Test Journey", owner_id=owner_id, status="active")
    db.add(journey)
    db.flush()
    version = models.JourneyVersion(
        journey_id=journey.id, version_number=1, graph_definition=graph, status="published",
    )
    db.add(version)
    db.flush()
    journey.live_version_id = version.id
    db.commit()
    return journey, version


def _setup_email_infra(db, owner_id="owner-1"):
    create_test_user(db, email="owner@test.com", name="Owner", role="Pod Admin", id=owner_id)
    create_nylas_config(db, api_key_encrypted=encrypt_token("fake-nylas-key"))
    create_user_mailbox(db, user_id=owner_id)


def _setup_sms_infra(db, owner_id="owner-1", enabled=True, granted=True):
    owner = db.query(models.User).filter(models.User.id == owner_id).first()
    if not owner:
        owner = create_test_user(db, email="owner@test.com", name="Owner", role="Pod Admin", id=owner_id)
    # v11.10.0: sends resolve against the cadence owner's own SMS grant.
    owner.sms_enabled = granted
    settings = models.SyncSettings(
        id=1, messenger_enabled=enabled,
        messenger_api_key="fake-key" if enabled else None,
        messenger_user_id="355746" if enabled else None,
        messenger_account_id="80054247" if enabled else None,
        # Both channels now resolve one messaging sender; messenger_from_number
        # stays populated to prove the legacy fallback still works.
        messenger_from_number="+15550001111" if enabled else None,
    )
    db.add(settings)
    db.commit()
    return settings


class _FakeResp:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text

    def json(self):
        return self._json


def test_enroll_lead_creates_enrollment_and_queue_row(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")

    enrollment = je.enroll_lead(db, journey, lead)

    assert enrollment is not None
    assert enrollment.current_node_id == "n2"
    assert enrollment.status == "active"
    queue_rows = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).all()
    assert len(queue_rows) == 1
    assert queue_rows[0].node_id == "n2"
    assert queue_rows[0].status == "pending"


def test_enroll_lead_is_a_noop_if_already_active(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")

    first = je.enroll_lead(db, journey, lead)
    second = je.enroll_lead(db, journey, lead)

    assert first is not None
    assert second is None
    active_count = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.lead_id == lead.id,
        models.JourneyEnrollment.status == "active",
    ).count()
    assert active_count == 1


def test_log_status_change_wiring_auto_enrolls_a_real_lead(db):
    """Proves the actual production wiring: models.log_status_change (the one
    funnel ~12 route call sites already use) triggers auto-enrollment, not
    just the standalone check_entry_triggers() call used in other tests."""
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="Lead Assigned")

    models.log_status_change(db, lead.id, "Lead Assigned", "New", changed_by="test")
    db.commit()

    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.lead_id == lead.id,
        models.JourneyEnrollment.journey_id == journey.id,
    ).first()
    assert enrollment is not None
    assert enrollment.status == "active"


def test_log_status_change_wiring_never_raises_on_a_broken_trigger_check(db, monkeypatch):
    """A bug in the journey engine must never break a real status-change
    operation — this is the core reason the hook is wrapped in try/except."""
    lead = create_test_lead(db, status="Lead Assigned")

    def _boom(*a, **kw):
        raise RuntimeError("simulated journey engine failure")

    import journey_engine.engine as je_module
    monkeypatch.setattr(je_module, "check_entry_triggers", _boom)

    # Must not raise, even though the (lazily imported) check_entry_triggers is broken.
    entry = models.log_status_change(db, lead.id, "Lead Assigned", "New", changed_by="test")
    db.commit()
    assert entry is not None


def test_check_entry_triggers_auto_enrolls_on_matching_event(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")

    enrolled = je.check_entry_triggers(db, "status_changed", lead, to_status="New")

    assert len(enrolled) == 1
    assert enrolled[0].journey_id == journey.id


def _calling_graph(to_status="Calling"):
    g = {k: [dict(n) for n in v] for k, v in LINEAR_GRAPH.items()}
    g["nodes"][0] = {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": to_status}}
    return g


def _enrollments(db, lead):
    return db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.lead_id == lead.id).all()


def test_same_status_change_does_not_enroll(db):
    """AE report: a cadence starting at 'status changes to Calling' also took leads
    ALREADY in Calling. A Calling -> Calling 'change' is not a change."""
    _make_journey(db, graph=_calling_graph())
    lead = create_test_lead(db, status="Calling")

    models.log_status_change(db, lead.id, "Calling", "Calling", changed_by="test")
    db.commit()
    assert _enrollments(db, lead) == []
    # ... and the engine guards it for any other caller too
    assert je.check_entry_triggers(db, "status_changed", lead, to_status="Calling", from_status="Calling") == []


def test_real_transition_and_creation_still_enroll(db):
    _make_journey(db, graph=_calling_graph())
    moved = create_test_lead(db, status="New", email="moved@t.com")
    created = create_test_lead(db, status="Calling", email="created@t.com")

    models.log_status_change(db, moved.id, "New", "Calling", changed_by="test")
    models.log_status_change(db, created.id, None, "Calling", changed_by="test")  # creation: from None
    db.commit()

    assert len(_enrollments(db, moved)) == 1
    assert len(_enrollments(db, created)) == 1


def test_kanban_move_to_the_same_column_does_not_enroll(client, db):
    _make_journey(db, graph=_calling_graph())
    lead = create_test_lead(db, status="Calling")

    resp = client.patch("/api/leads/kanban/move", params={"lead_id": lead.id, "new_status": "Calling"})

    assert resp.status_code == 200
    assert _enrollments(db, lead) == []


def test_live_graph_with_a_blank_status_enrolls_nobody(db):
    """v13.9.0: a status trigger with no status used to mean "every status change" — enrolling leads the
    owner never meant. Publish rejects a blank one (v13.8.0); this stops an older live graph acting on it."""
    _make_journey(db, graph=_calling_graph(to_status=None))
    lead = create_test_lead(db, status="New")

    models.log_status_change(db, lead.id, "New", "Calling", changed_by="test")
    db.commit()

    assert _enrollments(db, lead) == []


def test_enrolled_via_is_recorded_in_the_audit_row(db):
    create_test_user(db, email="owner@test.com", name="Owner", role="Pod Admin", id="owner-1")
    journey, _ = _make_journey(db, graph=_calling_graph())
    auto, hand, box = (create_test_lead(db, status="New", email=f"{n}@t.com") for n in ("auto", "hand", "box"))

    models.log_status_change(db, auto.id, "New", "Calling", changed_by="test")
    db.commit()
    je.enroll_lead(db, journey, hand, via="manual")
    je.enroll_lead(db, journey, box, via="sandbox")

    via = {}
    for e in db.query(models.JourneyEnrollment).all():
        row = db.query(models.UserActivityLog).filter(
            models.UserActivityLog.action_type == "JOURNEY_ENROLLED", models.UserActivityLog.object_id == e.id).one()
        via[e.lead_id] = json.loads(row.metadata_json)["via"]
    assert via == {auto.id: "trigger:status_changed", hand.id: "manual", box.id: "sandbox"}


def test_check_entry_triggers_ignores_non_matching_status(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")

    enrolled = je.check_entry_triggers(db, "status_changed", lead, to_status="Calling")

    assert enrolled == []


EMAIL_RECEIVED_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "trigger", "data": {"event": "email_received"}},
        {"id": "n2", "type": "email", "data": {"subject": "Hi", "body": "Hello there"}},
    ],
    "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
}


def test_check_entry_triggers_auto_enrolls_on_email_received(db):
    journey, version = _make_journey(db, graph=EMAIL_RECEIVED_GRAPH)
    lead = create_test_lead(db, status="New")

    enrolled = je.check_entry_triggers(db, "email_received", lead)

    assert len(enrolled) == 1
    assert enrolled[0].journey_id == journey.id


def test_check_entry_triggers_pod_scoped_journey_enrolls_matching_pod(db):
    pod = models.Pod(name="POD-A")
    db.add(pod)
    db.flush()
    journey, version = _make_journey(db)
    journey.pod_id = pod.id
    db.commit()
    lead = create_test_lead(db, status="New", pod_id=pod.id)

    enrolled = je.check_entry_triggers(db, "status_changed", lead, to_status="New")

    assert len(enrolled) == 1


def test_check_entry_triggers_pod_scoped_journey_ignores_other_pod(db):
    pod_a = models.Pod(name="POD-A")
    pod_b = models.Pod(name="POD-B")
    db.add_all([pod_a, pod_b])
    db.flush()
    journey, version = _make_journey(db)
    journey.pod_id = pod_a.id
    db.commit()
    lead = create_test_lead(db, status="New", pod_id=pod_b.id)

    enrolled = je.check_entry_triggers(db, "status_changed", lead, to_status="New")

    assert enrolled == []


def test_check_entry_triggers_pod_scoped_journey_ignores_lead_with_no_pod(db):
    pod = models.Pod(name="POD-A")
    db.add(pod)
    db.flush()
    journey, version = _make_journey(db)
    journey.pod_id = pod.id
    db.commit()
    lead = create_test_lead(db, status="New", pod_id=None)

    enrolled = je.check_entry_triggers(db, "status_changed", lead, to_status="New")

    assert enrolled == []


class TestApplySendWindow:
    """v10.9.9 — cadence-level business-hours + allowed-weekday scheduling
    for automated sends (email/sms). All-nullable: unconfigured behaves
    exactly as before this feature (send immediately)."""

    def _journey(self, **kwargs):
        defaults = dict(name="SW Test", owner_id="owner-1", status="active",
                         send_tz=None, send_window_start_hour=None,
                         send_window_end_hour=None, send_days=None)
        defaults.update(kwargs)
        return models.Journey(**defaults)

    def test_unconfigured_journey_leaves_run_at_unchanged(self):
        journey = self._journey()
        run_at = datetime(2026, 8, 15, 3, 0, tzinfo=timezone.utc)  # 3am, would be "outside hours" if a window existed
        assert je._apply_send_window(run_at, journey) == run_at

    def test_none_journey_leaves_run_at_unchanged(self):
        run_at = datetime(2026, 8, 15, 3, 0, tzinfo=timezone.utc)
        assert je._apply_send_window(run_at, None) == run_at

    def test_before_window_pushed_to_start_hour_same_day(self):
        journey = self._journey(send_tz="UTC", send_window_start_hour=9, send_window_end_hour=18)
        run_at = datetime(2026, 8, 12, 3, 0, tzinfo=timezone.utc)   # Wed 3am
        result = je._apply_send_window(run_at, journey)
        assert result == datetime(2026, 8, 12, 9, 0, tzinfo=timezone.utc)

    def test_after_window_pushed_to_start_hour_next_day(self):
        journey = self._journey(send_tz="UTC", send_window_start_hour=9, send_window_end_hour=18)
        run_at = datetime(2026, 8, 12, 20, 0, tzinfo=timezone.utc)  # Wed 8pm
        result = je._apply_send_window(run_at, journey)
        assert result == datetime(2026, 8, 13, 9, 0, tzinfo=timezone.utc)

    def test_inside_window_left_unchanged(self):
        journey = self._journey(send_tz="UTC", send_window_start_hour=9, send_window_end_hour=18)
        run_at = datetime(2026, 8, 12, 14, 30, tzinfo=timezone.utc)  # Wed 2:30pm
        assert je._apply_send_window(run_at, journey) == run_at

    def test_weekend_pushed_to_next_allowed_weekday(self):
        # Mon-Fri only (0-4). 2026-08-15 is a Saturday.
        journey = self._journey(send_tz="UTC", send_days="0,1,2,3,4")
        run_at = datetime(2026, 8, 15, 10, 0, tzinfo=timezone.utc)
        result = je._apply_send_window(run_at, journey)
        assert result.weekday() == 0   # Monday
        assert result.date() == datetime(2026, 8, 17).date()

    def test_window_and_weekday_combined(self):
        journey = self._journey(send_tz="UTC", send_window_start_hour=9, send_window_end_hour=18, send_days="0,1,2,3,4")
        run_at = datetime(2026, 8, 15, 23, 0, tzinfo=timezone.utc)  # Sat 11pm
        result = je._apply_send_window(run_at, journey)
        assert result == datetime(2026, 8, 17, 9, 0, tzinfo=timezone.utc)  # Monday 9am

    def test_respects_non_utc_timezone(self):
        # 9am UTC is 5am in America/New_York (UTC-4 in August, DST) — still before that tz's 9am start.
        journey = self._journey(send_tz="America/New_York", send_window_start_hour=9, send_window_end_hour=18)
        run_at = datetime(2026, 8, 12, 9, 0, tzinfo=timezone.utc)
        result = je._apply_send_window(run_at, journey)
        assert result.astimezone(ZoneInfo("America/New_York")).hour == 9

    def test_only_email_and_sms_node_types_get_the_window_applied(self, db):
        graph = {
            "nodes": [
                {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
                {"id": "n2", "type": "email", "data": {"subject": "Hi", "body": "..."}},
            ],
            "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
        }
        journey, version = _make_journey(db, graph=graph)
        journey.send_tz = "UTC"
        journey.send_window_start_hour = 9
        journey.send_window_end_hour = 18
        db.commit()

        wait_node = {"id": "w1", "type": "wait", "data": {"duration_hours": 1}}
        call_node = {"id": "c1", "type": "call", "data": {"title": "Call"}}
        email_node = {"id": "n2", "type": "email", "data": {}}

        # wait/call: unaffected by the window even when the journey has one configured.
        before = datetime.now(timezone.utc)
        wait_run_at = je._compute_run_at_for_node(wait_node, journey)
        assert abs((wait_run_at - before).total_seconds() - 3600) < 5
        call_run_at = je._compute_run_at_for_node(call_node, journey)
        assert abs((call_run_at - datetime.now(timezone.utc)).total_seconds()) < 5

        # email: does get pushed into the window if "now" falls outside it.
        email_run_at = je._compute_run_at_for_node(email_node, journey)
        local_hour = email_run_at.astimezone(ZoneInfo("UTC")).hour
        assert 9 <= local_hour < 18


def test_wait_node_schedules_next_step_in_the_future_not_immediately(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)

    # Fast-forward the enrollment past the email node directly onto the wait
    # node, to isolate wait-timing behavior from the send path.
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    queue_row.node_id = "n3"
    enrollment.current_node_id = "n3"
    db.commit()

    je._handle_wait_node(db, enrollment, journey, queue_row, version.graph_definition)
    db.commit()

    assert queue_row.status == "done"
    next_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id,
        models.JourneyExecutionQueue.status == "pending",
    ).first()
    # n3 has no outgoing edge -> the enrollment should complete, not enqueue further
    assert next_row is None
    db.refresh(enrollment)
    assert enrollment.status == "completed"


def test_wait_node_delay_applies_when_entering_it_not_when_leaving(db):
    """The delay lives on the node being ENTERED, not the one being left —
    entering a wait node schedules ITS OWN queue row ~duration_hours out;
    processing it (when that row becomes due) advances to the next node
    immediately, with no further delay added on top."""
    graph = {
        "nodes": [
            {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
            {"id": "n2", "type": "wait", "data": {"duration_hours": 3}},
            {"id": "n3", "type": "email", "data": {"subject": "Follow up", "body": "..."}},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}, {"id": "e2", "source": "n2", "target": "n3"}],
    }
    journey, version = _make_journey(db, graph=graph)
    lead = create_test_lead(db, status="New")
    before_enroll = datetime.now(timezone.utc)
    enrollment = je.enroll_lead(db, journey, lead)
    assert enrollment.current_node_id == "n2"

    wait_queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    def _naive(dt):
        return dt.replace(tzinfo=None)  # SQLite doesn't round-trip tzinfo — test-only quirk

    # Entering the wait node scheduled ITS OWN row ~3 hours out, right away.
    assert _naive(wait_queue_row.next_run_at) > _naive(before_enroll) + timedelta(hours=2, minutes=55)
    assert _naive(wait_queue_row.next_run_at) < _naive(before_enroll) + timedelta(hours=3, minutes=5)

    # Processing it (as if that time has now arrived) advances to n3 immediately —
    # not another 3 hours further out.
    before_process = datetime.now(timezone.utc)
    je._handle_wait_node(db, enrollment, journey, wait_queue_row, graph)
    db.commit()

    next_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id,
        models.JourneyExecutionQueue.node_id == "n3",
    ).first()
    assert next_row is not None
    assert _naive(next_row.next_run_at) < _naive(before_process) + timedelta(minutes=1)


def test_suppressed_lead_exits_early_instead_of_being_emailed(db):
    _setup_email_infra(db)
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    lead.do_not_contact = True
    db.commit()

    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    with patch("httpx.post") as mock_post:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email", {"subject": "x", "body": "y"})
        db.commit()
        mock_post.assert_not_called()

    db.refresh(enrollment)
    assert enrollment.status == "exited_early"
    assert enrollment.exited_reason == "suppressed"


def test_successful_send_advances_to_next_node_and_logs_execution(db):
    _setup_email_infra(db)
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-123"}})):
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello there"})
        db.commit()

    assert queue_row.status == "done"
    db.refresh(enrollment)
    assert enrollment.current_node_id == "n3"

    log = db.query(models.ExecutionLog).filter(
        models.ExecutionLog.enrollment_id == enrollment.id,
        models.ExecutionLog.event_type == "send_attempted",
    ).first()
    assert log is not None
    assert log.status == "success"
    assert log.idempotency_key == queue_row.idempotency_key


def test_email_merge_fields_are_substituted_before_sending(db):
    """2026-08-05: the builder's body placeholder ("Hi {{first_name}}, …")
    always implied this worked — there was no substitution anywhere. A
    recipient literally seeing "{{first_name}}" is a real bug, not cosmetic."""
    _setup_email_infra(db)
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New", first_name="Priya", last_name="Shah", company="Acme Corp")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})) as mock_post:
        je._handle_channel_node(
            db, enrollment, journey, queue_row, version.graph_definition, "email",
            {"subject": "Hi {{first_name}}", "body": "Hello {{first_name}} {{last_name}} from {{company}}. {{unknown_field}}"},
        )
        db.commit()

    sent_payload = mock_post.call_args.kwargs["json"]
    assert sent_payload["subject"] == "Hi Priya"
    assert "Priya" in sent_payload["body"] and "Shah" in sent_payload["body"] and "Acme Corp" in sent_payload["body"]
    assert "{{" not in sent_payload["subject"] and "{{" not in sent_payload["body"]


def test_successful_email_send_creates_a_linked_lead_email_activity_row(db):
    """v10.9.9 — without this row, opened_at/click_count (set later by the
    Nylas webhook handler) have nothing to attach to, so a cadence email's
    engagement was invisible everywhere. Also requests Nylas tracking."""
    _setup_email_infra(db)
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-track-1", "thread_id": "thread-track-1"}})) as mock_post:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello there"})
        db.commit()

    sent_payload = mock_post.call_args.kwargs["json"]
    assert sent_payload["tracking_options"] == {"opens": True, "links": True, "thread_replies": True, "label": lead.id}

    activity = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.nylas_message_id == "msg-track-1"
    ).first()
    assert activity is not None
    assert activity.direction == "outbound"
    assert activity.journey_id == journey.id
    assert activity.enrollment_id == enrollment.id
    assert activity.journey_node_id == "n2"
    assert activity.nylas_thread_id == "thread-track-1"


def test_ab_test_variant_is_used_and_recorded(db):
    """v10.9.9 — A/B testing. When variants are present, the plain
    subject/body fields are ignored and one variant is picked and sent
    instead, with its key recorded on the activity row for reporting."""
    _setup_email_infra(db)
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    node_data = {
        "subject": "Ignored plain subject", "body": "Ignored plain body",
        "variants": [
            {"key": "A", "subject": "Subject A", "body": "Body A"},
            {"key": "B", "subject": "Subject B", "body": "Body B"},
        ],
    }
    with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-ab-1"}})) as mock_post:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email", node_data)
        db.commit()

    sent_payload = mock_post.call_args.kwargs["json"]
    assert sent_payload["subject"] in ("Subject A", "Subject B")
    assert sent_payload["subject"] != "Ignored plain subject"

    activity = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.nylas_message_id == "msg-ab-1"
    ).first()
    assert activity.variant_key in ("A", "B")
    assert activity.subject == sent_payload["subject"]


def test_ab_test_variant_assignment_is_deterministic_for_the_same_enrollment_and_node(db):
    """A retried send (e.g. after a transient failure) must land on the
    same variant as the first attempt — no separate 'assigned variant'
    state is persisted, it's derived fresh each time from enrollment+node."""
    from journey_engine.channels.email_channel import _pick_variant
    node_data = {"variants": [{"key": "A", "subject": "A", "body": "a"}, {"key": "B", "subject": "B", "body": "b"}]}
    first = _pick_variant(node_data, "enrollment-123", "n2")
    second = _pick_variant(node_data, "enrollment-123", "n2")
    assert first == second


def test_no_variants_falls_back_to_plain_subject_and_body(db):
    from journey_engine.channels.email_channel import _pick_variant
    node_data = {"subject": "Plain subject", "body": "Plain body"}
    result = _pick_variant(node_data, "enrollment-123", "n2")
    assert result == {"key": None, "subject": "Plain subject", "body": "Plain body"}


SMS_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
        {"id": "n2", "type": "sms", "data": {"message": "Hi {{first_name}}, following up."}},
    ],
    "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
}


class TestSmsChannel:
    """v10.9.9 — SMS cadence step, wired to the existing Alternate Messenger SMS send
    path (routes/sms_routes.py / sms_service.py) rather than a
    new vendor integration."""

    def test_successful_sms_send_creates_a_linked_sms_log_row(self, db):
        _setup_sms_infra(db)
        journey, version = _make_journey(db, graph=SMS_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210", first_name="Priya")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        from messaging_provider import SendMessageResult
        fake_result = SendMessageResult(
            success=True, provider="messenger", channel="sms", message_id="alternatecrm-sms-1",
        )
        with patch("messaging_service.resolve_messaging_for_user") as mock_resolve:
            mock_provider = MagicMock()
            mock_provider.send.return_value = fake_result
            mock_resolve.return_value = SimpleNamespace(
                provider=mock_provider, sender_id="918956778474",
                provider_name="messenger", error=None, retryable=True,
            )
            je._handle_channel_node(db, enrollment, journey, queue_row, SMS_GRAPH, "sms", SMS_GRAPH["nodes"][1]["data"])
            db.commit()

        # Merge fields substituted before the SMS provider is called.
        assert mock_provider.send.call_args.kwargs["text"] == "Hi Priya, following up."

        log = db.query(models.SmsLog).filter(models.SmsLog.message_id == "alternatecrm-sms-1").first()
        assert log is not None
        assert log.direction == "outbound"
        assert log.journey_id == journey.id
        assert log.enrollment_id == enrollment.id
        assert log.journey_node_id == "n2"

        db.refresh(enrollment)
        assert enrollment.status == "completed"   # advanced past the only real node

    def test_sms_not_configured_fails_retryable_without_calling_the_provider(self, db):
        _setup_sms_infra(db, enabled=False)
        journey, version = _make_journey(db, graph=SMS_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        with patch("messaging_provider_provider.AlternateMessenger.send") as mock_send:
            je._handle_channel_node(db, enrollment, journey, queue_row, SMS_GRAPH, "sms", SMS_GRAPH["nodes"][1]["data"])
            db.commit()

        mock_send.assert_not_called()
        # Retryable failure — the queue row is released to retry, not the enrollment failed outright,
        # since an admin could enable Alternate Messenger within the retry window.
        assert queue_row.status == "pending"

    def test_owner_without_the_sms_grant_cannot_send(self, db):
        """The SMS half of the same gate — see the WhatsApp equivalent."""
        _setup_sms_infra(db, granted=False)
        journey, version = _make_journey(db, graph=SMS_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        with patch("messaging_provider_provider.AlternateMessenger.send") as mock_send:
            je._handle_channel_node(db, enrollment, journey, queue_row, SMS_GRAPH, "sms", SMS_GRAPH["nodes"][1]["data"])
            db.commit()

        mock_send.assert_not_called()
        assert queue_row.status == "failed"

    def test_lead_with_no_phone_skips_the_step(self, db):
        """v13.0.0: "text only once a number exists" — used to fail the whole
        enrollment; now the step is logged as skipped and the journey moves on."""
        _setup_sms_infra(db)
        journey, version = _make_journey(db, graph=SMS_GRAPH)
        lead = create_test_lead(db, status="New", phone=None)
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        je._handle_channel_node(db, enrollment, journey, queue_row, SMS_GRAPH, "sms", SMS_GRAPH["nodes"][1]["data"])
        db.commit()

        assert queue_row.status == "done"
        db.refresh(enrollment)
        assert enrollment.status in ("active", "completed")

    def test_sms_send_failure_logs_a_failed_sms_log_row(self, db):
        _setup_sms_infra(db)
        journey, version = _make_journey(db, graph=SMS_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        from messaging_provider import SendMessageResult
        with patch("messaging_service.resolve_messaging_for_user") as mock_resolve:
            mock_provider = MagicMock()
            mock_provider.send.return_value = SendMessageResult(
                success=False, provider="messenger", channel="sms", error="FORBIDDEN-API-KEY",
            )
            mock_resolve.return_value = SimpleNamespace(
                provider=mock_provider, sender_id="918956778474",
                provider_name="messenger", error=None, retryable=True,
            )
            je._handle_channel_node(db, enrollment, journey, queue_row, SMS_GRAPH, "sms", SMS_GRAPH["nodes"][1]["data"])
            db.commit()

        log = db.query(models.SmsLog).filter(models.SmsLog.enrollment_id == enrollment.id).first()
        assert log.status == "failed"


def _setup_whatsapp_infra(db, owner_id="owner-1", enabled=True, granted=True):
    owner = db.query(models.User).filter(models.User.id == owner_id).first()
    if not owner:
        owner = create_test_user(db, email="owner@test.com", name="Owner", role="Pod Admin", id=owner_id)
    owner.whatsapp_enabled = granted
    settings = models.SyncSettings(
        id=1, messenger_enabled=enabled,
        messenger_api_key="fake-key" if enabled else None,
        messenger_user_id="355746" if enabled else None,
        messenger_account_id="80054247" if enabled else None,
        messenger_sender_id="918956778474" if enabled else None,
    )
    db.add(settings)
    db.commit()
    return settings


WHATSAPP_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
        {"id": "n2", "type": "whatsapp", "data": {"template_name": "lead_followup_attempt"}},
    ],
    "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
}


class TestWhatsAppChannel:
    """WhatsApp cadence step — goes through the provider-agnostic
    messaging_service resolver (Alternate Messenger today) rather than a hardcoded
    vendor import, so a second provider can be added without touching this
    channel or engine.py."""

    def test_successful_template_send_creates_a_linked_sms_log_row(self, db):
        from messaging_provider import SendMessageResult

        _setup_whatsapp_infra(db)
        journey, version = _make_journey(db, graph=WHATSAPP_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210", first_name="Priya")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        fake_result = SendMessageResult(
            success=True, provider="messenger", channel="whatsapp",
            message_id="wa-temp-1", conversation_id="42",
        )
        with patch("messaging_service.resolve_messaging_for_user") as mock_resolve:
            mock_provider = MagicMock()
            mock_provider.send.return_value = fake_result
            mock_resolve.return_value = SimpleNamespace(
                provider=mock_provider, sender_id="918956778474",
                provider_name="messenger", error=None, retryable=True,
            )
            je._handle_channel_node(db, enrollment, journey, queue_row, WHATSAPP_GRAPH, "whatsapp", WHATSAPP_GRAPH["nodes"][1]["data"])
            db.commit()

        mock_provider.send.assert_called_once()
        call_kwargs = mock_provider.send.call_args.kwargs
        assert call_kwargs["template_name"] == "lead_followup_attempt"
        assert call_kwargs["contact_first_name"] == "Priya"

        log = db.query(models.SmsLog).filter(models.SmsLog.message_id == "wa-temp-1").first()
        assert log is not None
        assert log.channel == "whatsapp"
        assert log.provider == "messenger"
        assert log.conversation_id == "42"
        assert log.template_name == "lead_followup_attempt"
        assert log.journey_id == journey.id
        assert log.enrollment_id == enrollment.id

        db.refresh(enrollment)
        assert enrollment.status == "completed"

    def test_whatsapp_not_configured_fails_retryable_without_calling_the_provider(self, db):
        _setup_whatsapp_infra(db, enabled=False)
        journey, version = _make_journey(db, graph=WHATSAPP_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        with patch("messaging_provider_provider.AlternateMessenger.send") as mock_get:
            je._handle_channel_node(db, enrollment, journey, queue_row, WHATSAPP_GRAPH, "whatsapp", WHATSAPP_GRAPH["nodes"][1]["data"])
            db.commit()

        mock_get.assert_not_called()
        assert queue_row.status == "pending"

    def test_lead_with_no_phone_skips_the_step(self, db):
        """v13.0.0: skipped, not a failed enrollment (see the SMS test above)."""
        _setup_whatsapp_infra(db)
        journey, version = _make_journey(db, graph=WHATSAPP_GRAPH)
        lead = create_test_lead(db, status="New", phone=None)
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        je._handle_channel_node(db, enrollment, journey, queue_row, WHATSAPP_GRAPH, "whatsapp", WHATSAPP_GRAPH["nodes"][1]["data"])
        db.commit()

        assert queue_row.status == "done"
        db.refresh(enrollment)
        assert enrollment.status in ("active", "completed")

    def test_send_failure_logs_a_failed_sms_log_row(self, db):
        from messaging_provider import SendMessageResult

        _setup_whatsapp_infra(db)
        journey, version = _make_journey(db, graph=WHATSAPP_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        fake_result = SendMessageResult(
            success=False, provider="messenger", channel="whatsapp",
            error="Template 'lead_followup_attempt' not found",
        )
        with patch("messaging_service.resolve_messaging_for_user") as mock_resolve:
            mock_provider = MagicMock()
            mock_provider.send.return_value = fake_result
            mock_resolve.return_value = SimpleNamespace(
                provider=mock_provider, sender_id="918956778474",
                provider_name="messenger", error=None, retryable=True,
            )
            je._handle_channel_node(db, enrollment, journey, queue_row, WHATSAPP_GRAPH, "whatsapp", WHATSAPP_GRAPH["nodes"][1]["data"])
            db.commit()

        log = db.query(models.SmsLog).filter(models.SmsLog.enrollment_id == enrollment.id).first()
        assert log.status == "failed"
        assert log.channel == "whatsapp"
        # RCA 2026-08-25: every failed send used to collapse to a bare
        # status="failed" — the real reason was computed but discarded.
        assert log.failure_reason == "Template 'lead_followup_attempt' not found"

    def test_owner_whatsapp_sender_override_takes_priority_over_org_default(self, db):
        # RCA 2026-08-25: WhatsApp used one org-wide sender for every SDR,
        # unlike calling (which already assigns each SDR their own Alternate Messenger
        # number) — this asserts the owner's own sender wins once assigned.
        from messaging_provider import SendMessageResult

        settings = _setup_whatsapp_infra(db)
        owner = db.query(models.User).filter(models.User.id == "owner-1").first()
        owner.messenger_whatsapp_sender_id = "911111111111"
        db.commit()
        journey, version = _make_journey(db, graph=WHATSAPP_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210", first_name="Priya")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        fake_result = SendMessageResult(success=True, provider="messenger", channel="whatsapp", message_id="wa-2")
        with patch("messaging_provider_provider.AlternateMessenger.send",
                    return_value=fake_result) as mock_send:
            je._handle_channel_node(db, enrollment, journey, queue_row, WHATSAPP_GRAPH, "whatsapp", WHATSAPP_GRAPH["nodes"][1]["data"])
            db.commit()

        assert mock_send.call_args.kwargs["sender_id"] == "911111111111"

    def test_falls_back_to_org_default_sender_when_owner_has_no_override(self, db):
        settings = _setup_whatsapp_infra(db)
        journey, version = _make_journey(db, graph=WHATSAPP_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        from messaging_provider import SendMessageResult
        fake_result = SendMessageResult(success=True, provider="messenger", channel="whatsapp", message_id="wa-3")
        with patch("messaging_provider_provider.AlternateMessenger.send",
                    return_value=fake_result) as mock_send:
            je._handle_channel_node(db, enrollment, journey, queue_row, WHATSAPP_GRAPH, "whatsapp", WHATSAPP_GRAPH["nodes"][1]["data"])
            db.commit()

        assert mock_send.call_args.kwargs["sender_id"] == settings.messenger_sender_id

    def test_owner_without_the_whatsapp_grant_cannot_send(self, db):
        """v11.10.0: before the per-SDR gate, any cadence sent WhatsApp as long
        as the *org* was configured — the owner's own access was never checked,
        so a cadence could message on behalf of someone never granted it."""
        _setup_whatsapp_infra(db, granted=False)
        journey, version = _make_journey(db, graph=WHATSAPP_GRAPH)
        lead = create_test_lead(db, status="New", phone="+919876543210")
        enrollment = je.enroll_lead(db, journey, lead)
        queue_row = db.query(models.JourneyExecutionQueue).filter(
            models.JourneyExecutionQueue.enrollment_id == enrollment.id
        ).first()

        with patch("messaging_provider_provider.AlternateMessenger.send") as mock_send:
            je._handle_channel_node(db, enrollment, journey, queue_row, WHATSAPP_GRAPH, "whatsapp", WHATSAPP_GRAPH["nodes"][1]["data"])
            db.commit()

        mock_send.assert_not_called()
        # A missing grant is permanent until an admin acts, so the enrollment
        # fails outright rather than retrying against an unchanged decision.
        assert queue_row.status == "failed"


def test_duplicate_claim_does_not_double_send(db):
    """The core idempotency guarantee: if a queue row is somehow processed
    twice (e.g. a crash after send-success but before the row was marked
    done), the second pass must NOT call the provider again."""
    _setup_email_infra(db)
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-123"}})) as mock_post:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello there"})
        db.commit()
        assert mock_post.call_count == 1

    # Simulate the queue row never having been marked done (crash before commit) —
    # re-run the exact same handler against the same row/idempotency_key.
    queue_row.status = "claimed"
    db.commit()
    with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-456"}})) as mock_post_again:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello there"})
        db.commit()
        mock_post_again.assert_not_called()   # already-sent check short-circuited it


def test_retryable_failure_reschedules_with_backoff_not_immediately(db):
    _setup_email_infra(db)
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    queue_row.attempt_count = 1

    before = datetime.now(timezone.utc)
    with patch("httpx.post", return_value=_FakeResp(429, text="rate limited")):
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello there"})
        db.commit()

    assert queue_row.status == "pending"   # released, not stuck claimed
    # SQLite doesn't round-trip tzinfo — strip it from both sides (test-only quirk).
    assert queue_row.next_run_at.replace(tzinfo=None) > before.replace(tzinfo=None) + timedelta(seconds=50)   # backoff[0] = 60s
    db.refresh(enrollment)
    assert enrollment.status == "active"   # not failed yet — still has attempts left


def test_non_retryable_failure_fails_enrollment_immediately(db):
    _setup_email_infra(db)
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New", email=None)   # no email -> non-retryable
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                             {"subject": "Hi", "body": "Hello there"})
    db.commit()

    assert queue_row.status == "failed"
    db.refresh(enrollment)
    assert enrollment.status == "failed"
    assert enrollment.exited_reason == "send_failed"


def test_runaway_loop_cap_force_fails_enrollment(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    enrollment.node_pass = je.MAX_NODE_PASSES  # one more transition should trip the cap

    je._advance_to_node(db, enrollment, journey, "n3", datetime.now(timezone.utc))
    db.commit()

    assert enrollment.status == "failed"
    assert enrollment.exited_reason == "exceeded_max_node_passes"


def test_claim_due_rows_only_claims_due_and_unclaimed_rows(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    # Not due yet
    queue_row.next_run_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db.commit()

    claimed = je._claim_due_rows(db, "worker-1")
    assert claimed == []

    queue_row.next_run_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    claimed = je._claim_due_rows(db, "worker-1")
    assert claimed == [queue_row.id]
    db.refresh(queue_row)
    assert queue_row.status == "claimed"
    assert queue_row.claimed_by == "worker-1"


def test_claim_due_rows_reclaims_after_lease_expires_simulating_a_crashed_worker(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    queue_row.next_run_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    queue_row.status = "claimed"
    queue_row.claimed_by = "dead-worker"
    queue_row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)  # already expired
    db.commit()

    claimed = je._claim_due_rows(db, "worker-2")
    assert claimed == [queue_row.id]
    db.refresh(queue_row)
    assert queue_row.claimed_by == "worker-2"


def test_claim_due_rows_does_not_reclaim_an_active_lease(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    queue_row.next_run_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    queue_row.status = "claimed"
    queue_row.claimed_by = "worker-1"
    queue_row.lease_expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)  # still leased
    db.commit()

    claimed = je._claim_due_rows(db, "worker-2")
    assert claimed == []


# ── Phase 1: conditional branching, call channel, cross-journey cooldown ────

CONDITION_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
        {"id": "n2", "type": "condition", "data": {
            "timeout_hours": 48,
            "branch_on_event": {"email_replied": "n3"},
            "branch_on_timeout": "n4",
        }},
        {"id": "n3", "type": "wait", "data": {"duration_hours": 1}},   # "replied" branch
        {"id": "n4", "type": "wait", "data": {"duration_hours": 2}},   # "no reply" branch
    ],
    "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
}


def test_condition_node_takes_timeout_branch_when_no_event_arrived(db):
    journey, version = _make_journey(db, graph=CONDITION_GRAPH)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    assert enrollment.current_node_id == "n2"
    assert enrollment.trigger_event is None

    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    je._handle_condition_node(db, enrollment, journey, queue_row, CONDITION_GRAPH, CONDITION_GRAPH["nodes"][1]["data"])
    db.commit()

    assert enrollment.current_node_id == "n4"   # branch_on_timeout


def test_condition_node_takes_event_branch_when_trigger_event_is_set(db):
    journey, version = _make_journey(db, graph=CONDITION_GRAPH)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    # Simulate what check_exit_triggers does: set trigger_event, force due now.
    enrollment.trigger_event = {"type": "email_replied"}
    db.commit()

    je._handle_condition_node(db, enrollment, journey, queue_row, CONDITION_GRAPH, CONDITION_GRAPH["nodes"][1]["data"])
    db.commit()

    assert enrollment.current_node_id == "n3"   # branch_on_event["email_replied"]
    assert enrollment.trigger_event is None     # consumed by the transition


def test_check_exit_triggers_finds_and_forces_a_matching_condition_node(db):
    journey, version = _make_journey(db, graph=CONDITION_GRAPH)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)

    triggered_ids = je.check_exit_triggers(db, "email_replied", lead, commit=False)

    assert len(triggered_ids) == 1
    db.refresh(enrollment)
    assert enrollment.trigger_event == {"type": "email_replied"}
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.id == triggered_ids[0]
    ).first()
    assert queue_row.next_run_at.replace(tzinfo=None) <= datetime.now(timezone.utc).replace(tzinfo=None)


def test_check_exit_triggers_ignores_a_non_matching_event_type(db):
    journey, version = _make_journey(db, graph=CONDITION_GRAPH)
    lead = create_test_lead(db, status="New")
    je.enroll_lead(db, journey, lead)

    triggered_ids = je.check_exit_triggers(db, "some_other_event", lead, commit=False)
    assert triggered_ids == []


CALL_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "trigger", "data": {"event": "status_changed", "to_status": "New"}},
        {"id": "n2", "type": "call", "data": {"title": "Follow-up call"}},
    ],
    "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
}


def test_call_node_creates_a_task_not_a_real_dial(db):
    """Confirms the deliberate design choice: call nodes create a Task
    reminder for the assigned SDR, never place an automated call."""
    sdr = create_test_user(db, email="sdr@test.com", name="Test SDR", role="SDR", id="sdr-1")
    journey, version = _make_journey(db, graph=CALL_GRAPH)
    lead = create_test_lead(db, status="New")
    lead.assigned_users.append(sdr)
    db.commit()

    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    je._handle_channel_node(db, enrollment, journey, queue_row, CALL_GRAPH, "call", {"title": "Follow-up call"})
    db.commit()

    task = db.query(models.Task).filter(models.Task.lead_id == lead.id).first()
    assert task is not None
    assert task.user_id == "sdr-1"
    assert "Follow-up call" in task.title
    # Due now (the bell shows it straight away), not at a 24h step deadline:
    # the cadence never waits on a call reminder.
    due = task.due_time if task.due_time.tzinfo else task.due_time.replace(tzinfo=timezone.utc)
    assert abs((due - datetime.now(timezone.utc)).total_seconds()) < 60
    db.refresh(enrollment)
    assert enrollment.status == "completed"


def test_call_node_script_carries_onto_the_task_description(db):
    """The Power Dialer card's cadence-default script comes from
    Task.description — a call node with a script filled in (NodeConfigPanel's
    CallFields) must land there, not just the title."""
    sdr = create_test_user(db, email="sdr-script@test.com", role="SDR", id="sdr-script")
    journey, version = _make_journey(db, graph=CALL_GRAPH)
    lead = create_test_lead(db, status="New")
    lead.assigned_users.append(sdr)
    db.commit()

    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    je._handle_channel_node(
        db, enrollment, journey, queue_row, CALL_GRAPH, "call",
        {"title": "Follow-up call", "script": "Lead in with the renewal discount."},
    )
    db.commit()

    task = db.query(models.Task).filter(models.Task.lead_id == lead.id).first()
    assert task.description == "Lead in with the renewal discount."


def test_call_node_with_no_script_leaves_description_blank(db):
    """Most call nodes won't set a script — must not become an empty string
    (which the dialer card would then have to distinguish from 'no script')."""
    sdr = create_test_user(db, email="sdr-noscript@test.com", role="SDR", id="sdr-noscript")
    journey, version = _make_journey(db, graph=CALL_GRAPH)
    lead = create_test_lead(db, status="New")
    lead.assigned_users.append(sdr)
    db.commit()

    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    je._handle_channel_node(db, enrollment, journey, queue_row, CALL_GRAPH, "call", {"title": "Follow-up call"})
    db.commit()

    task = db.query(models.Task).filter(models.Task.lead_id == lead.id).first()
    assert task.description is None


def test_call_node_with_no_assigned_sdr_fails_non_retryably(db):
    journey, version = _make_journey(db, graph=CALL_GRAPH)
    lead = create_test_lead(db, status="New")   # no assigned SDR
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    je._handle_channel_node(db, enrollment, journey, queue_row, CALL_GRAPH, "call", {"title": "x"})
    db.commit()

    assert queue_row.status == "failed"
    db.refresh(enrollment)
    assert enrollment.status == "failed"


def test_cross_journey_cooldown_blocks_a_second_email_within_24h(db):
    """Gap 2: two DIFFERENT journeys both touching the same lead's email
    channel within 24h — the second must be blocked, not sent."""
    _setup_email_infra(db)
    lead = create_test_lead(db, status="New")

    # First journey already sent an email to this lead (log it directly,
    # simpler than a full second enrollment).
    db.add(models.ExecutionLog(
        enrollment_id="other-enrollment", journey_id="other-journey", lead_id=lead.id,
        node_id="nX", event_type="send_attempted", channel="email", status="success",
        idempotency_key="other-enrollment:nX:0",
    ))
    db.commit()

    journey, version = _make_journey(db)
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    with patch("httpx.post") as mock_post:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello there"})
        db.commit()
        mock_post.assert_not_called()   # cooldown blocked it before any send attempt

    assert queue_row.status == "pending"   # rescheduled, not failed
    assert queue_row.next_run_at.replace(tzinfo=None) > datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=2)
    db.refresh(enrollment)
    assert enrollment.status == "active"   # not suppressed/failed — just a timing conflict

    # 2026-08-05: previously a cooldown block left zero trace anywhere —
    # indistinguishable from a lead progressing normally. Must be logged.
    cooldown_log = db.query(models.ExecutionLog).filter(
        models.ExecutionLog.enrollment_id == enrollment.id,
        models.ExecutionLog.event_type == "cooldown_blocked",
    ).first()
    assert cooldown_log is not None
    assert cooldown_log.status == "skipped"


def test_cooldown_dead_letters_after_max_consecutive_rechecks(db):
    """2026-08-05: previously a step blocked by cooldown/domain-cadence
    rescheduled forever with no ceiling if two journeys kept colliding on
    the same lead/channel. Must dead-letter instead, same runaway-safety-
    valve philosophy as MAX_NODE_PASSES."""
    _setup_email_infra(db)
    lead = create_test_lead(db, status="New")
    db.add(models.ExecutionLog(
        enrollment_id="other-enrollment", journey_id="other-journey", lead_id=lead.id,
        node_id="nX", event_type="send_attempted", channel="email", status="success",
        idempotency_key="other-enrollment:nX:0",
    ))
    db.commit()

    journey, version = _make_journey(db)
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    queue_row.attempt_count = je.MAX_BLOCKED_RECHECKS
    db.commit()

    with patch("httpx.post") as mock_post:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello there"})
        db.commit()
        mock_post.assert_not_called()

    db.refresh(enrollment)
    db.refresh(queue_row)
    assert queue_row.status == "failed"
    assert enrollment.status == "failed"
    assert enrollment.exited_reason == "cooldown_stalled"


def test_cooldown_does_not_block_when_last_send_was_over_24h_ago(db):
    _setup_email_infra(db)
    lead = create_test_lead(db, status="New")

    old_time = datetime.now(timezone.utc) - timedelta(hours=25)
    db.add(models.ExecutionLog(
        enrollment_id="other-enrollment", journey_id="other-journey", lead_id=lead.id,
        node_id="nX", event_type="send_attempted", channel="email", status="success",
        idempotency_key="other-enrollment:nX:0", created_at=old_time,
    ))
    db.commit()

    journey, version = _make_journey(db)
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})) as mock_post:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello there"})
        db.commit()
        mock_post.assert_called_once()


# ── Phase 4: pause/resume, domain deliverability cadence ────────────────────

def test_paused_journey_rows_are_not_claimed(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    queue_row.next_run_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    journey.status = "paused"
    db.commit()

    claimed = je._claim_due_rows(db, "worker-1")
    assert claimed == []


def test_resuming_a_journey_makes_its_rows_claimable_again(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    queue_row.next_run_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    journey.status = "paused"
    db.commit()
    assert je._claim_due_rows(db, "worker-1") == []

    journey.status = "active"
    db.commit()
    assert je._claim_due_rows(db, "worker-1") == [queue_row.id]


def test_domain_cadence_blocks_a_send_once_the_hourly_limit_is_hit(db, monkeypatch):
    monkeypatch.setattr(je, "EMAIL_DOMAIN_CADENCE_LIMIT_PER_HOUR", 1)
    _setup_email_infra(db)
    lead_a = create_test_lead(db, status="New", email="a@sharedcorp.com")
    lead_b = create_test_lead(db, status="New", email="b@sharedcorp.com")

    # lead_a already got a successful send to the shared domain this hour.
    db.add(models.ExecutionLog(
        enrollment_id="other", journey_id="other", lead_id=lead_a.id,
        node_id="nX", event_type="send_attempted", channel="email", status="success",
        idempotency_key="other:nX:0",
    ))
    db.commit()

    journey, version = _make_journey(db)
    enrollment = je.enroll_lead(db, journey, lead_b)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    with patch("httpx.post") as mock_post:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello"})
        db.commit()
        mock_post.assert_not_called()

    assert queue_row.status == "pending"
    db.refresh(enrollment)
    assert enrollment.status == "active"


def test_domain_cadence_does_not_block_a_different_domain(db, monkeypatch):
    monkeypatch.setattr(je, "EMAIL_DOMAIN_CADENCE_LIMIT_PER_HOUR", 1)
    _setup_email_infra(db)
    lead_a = create_test_lead(db, status="New", email="a@corpone.com")
    lead_b = create_test_lead(db, status="New", email="b@corptwo.com")

    db.add(models.ExecutionLog(
        enrollment_id="other", journey_id="other", lead_id=lead_a.id,
        node_id="nX", event_type="send_attempted", channel="email", status="success",
        idempotency_key="other:nX:0",
    ))
    db.commit()

    journey, version = _make_journey(db)
    enrollment = je.enroll_lead(db, journey, lead_b)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()

    with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})) as mock_post:
        je._handle_channel_node(db, enrollment, journey, queue_row, version.graph_definition, "email",
                                 {"subject": "Hi", "body": "Hello"})
        db.commit()
        mock_post.assert_called_once()


# ── 2026-08-05 hardening: an unexpected exception in execute_step() must not
#    leave the queue row claimed forever (bypassing MAX_SEND_ATTEMPTS entirely,
#    invisible everywhere but a logger.error line) ───────────────────────────

def test_execute_step_dead_letters_after_max_unexpected_errors(db):
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    # Simulate this row having already been claimed+thrown MAX_UNEXPECTED_ERRORS
    # times (attempt_count already increments on every claim, in _claim_due_rows).
    queue_row.attempt_count = je.MAX_UNEXPECTED_ERRORS
    queue_row.status = "claimed"
    # Force execute_step to hit its catch-all: point the enrollment at a
    # version that doesn't exist, so `graph = version.graph_definition` raises.
    enrollment.version_id = "does-not-exist"
    db.commit()

    je.execute_step(queue_row.id)

    db.refresh(enrollment)
    db.refresh(queue_row)
    assert queue_row.status == "failed"
    assert enrollment.status == "failed"
    assert enrollment.exited_reason == "unexpected_error"


def test_execute_step_does_not_dead_letter_below_the_error_ceiling(db):
    """A transient/first-time exception must NOT be dead-lettered — it
    should stay 'claimed' so the lease-expiry backstop can retry it."""
    journey, version = _make_journey(db)
    lead = create_test_lead(db, status="New")
    enrollment = je.enroll_lead(db, journey, lead)
    queue_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id
    ).first()
    queue_row.attempt_count = 1
    queue_row.status = "claimed"
    enrollment.version_id = "does-not-exist"
    db.commit()

    je.execute_step(queue_row.id)

    db.refresh(enrollment)
    db.refresh(queue_row)
    assert queue_row.status == "claimed"   # untouched — left for the lease to expire and retry
    assert enrollment.status == "active"
