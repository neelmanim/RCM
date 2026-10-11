"""v13.3.0 — instantly_sequence cadence node: hands a lead off to a live
Instantly campaign instead of Alternate CRM sending it directly, then parks
until an external event (a later phase's webhook, or the poll job) resumes
it. Two-pass park/resume shape mirrors _handle_manual_email_node /
_handle_manual_sms_node (see test_manual_sms_cadence_step.py), except the
2nd pass is driven by resume_instantly_sequence_step instead of a rep's
approval.

Covers: first-time campaign creation, campaign reuse across leads on
unchanged content, a content edit minting a new campaign row (never
mutating the old one — leads already enrolled in it must not desync),
add_lead_to_campaign failure routing through the same dead-letter/backoff
path _handle_channel_node uses, resume_instantly_sequence_step for every
outcome (idempotent — a second call is a safe no-op), _exit_enrollment_early
telling Instantly to stop too, and the do_not_contact cross-call from
services.lead_service.
"""
import os
from unittest.mock import MagicMock, patch

os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

import models
from journey_engine import engine as je
from services import lead_service

from conftest import create_test_lead, create_test_user
from test_cadence_playbook import _journey, _edges, _run, TRIGGER, WAIT

STEPS = [{"subject": "Hi {{first_name}}", "body": "Following up.", "delay_days": 0}]


def _instantly_journey(db, steps=None, journey=None, node_overrides=None):
    node = {"id": "i", "type": "instantly_sequence", "data": {"steps": steps or STEPS, **(node_overrides or {})}}
    nodes, edges = [TRIGGER, node, WAIT], _edges(("t", "i"), ("i", "w"))
    if journey is None:
        return _journey(db, nodes, edges)
    # Republish onto the SAME journey/node id — this is the case the
    # content_hash versioning exists for (journey_id, node_id stays stable
    # across republishes; only the content_hash changes).
    v = models.JourneyVersion(journey_id=journey.id, version_number=2, status="published",
                               graph_definition={"nodes": nodes, "edges": edges})
    db.add(v)
    db.flush()
    journey.live_version_id = v.id
    db.commit()
    return journey


def _settings(db, api_key="test-key"):
    s = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not s:
        s = models.SyncSettings(id=1)
        db.add(s)
    s.instantly_api_key = api_key
    db.commit()
    return s


def _mock_provider(create_result=None, add_result=None, add_side_effect=None):
    provider = MagicMock()
    provider.create_campaign.return_value = create_result or {"id": "camp-1"}
    if add_side_effect:
        provider.add_lead_to_campaign.side_effect = add_side_effect
    else:
        provider.add_lead_to_campaign.return_value = add_result or {"id": "ilead-1"}
    return provider


def _patched(provider):
    return patch("instantly_provider.InstantlyProvider", return_value=provider)


def _lead(db, **kwargs):
    return create_test_lead(db, **kwargs)


def test_first_time_campaign_creation_parks_and_enrolls(db):
    _settings(db)
    lead = _lead(db, first_name="Paul", email="paul@example.com")
    journey = _instantly_journey(db)
    provider = _mock_provider()
    with _patched(provider):
        e = je.enroll_lead(db, journey, lead)
        e = _run(db, e)

    provider.create_campaign.assert_called_once()
    provider.add_lead_to_campaign.assert_called_once_with(
        "camp-1", "paul@example.com", first_name="Paul", last_name="Doe")

    campaign_row = db.query(models.JourneyInstantlyCampaign).filter(
        models.JourneyInstantlyCampaign.journey_id == journey.id, models.JourneyInstantlyCampaign.node_id == "i",
    ).one()
    assert campaign_row.instantly_campaign_id == "camp-1"

    jie = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id,
    ).one()
    assert jie.status == "active"
    assert jie.instantly_campaign_id == "camp-1"
    assert jie.instantly_lead_id == "ilead-1"

    # Parked — still active, still on the instantly_sequence node.
    assert e.status == "active" and e.current_node_id == "i"
    row = db.query(models.JourneyExecutionQueue).filter(models.JourneyExecutionQueue.enrollment_id == e.id).one()
    assert row.status == "pending"


def test_ineligible_lead_never_gets_enrolled(db):
    _settings(db)
    lead = _lead(db, email="dnc@example.com")
    lead.do_not_contact = True
    db.commit()
    journey = _instantly_journey(db)
    provider = _mock_provider()
    with _patched(provider):
        e = je.enroll_lead(db, journey, lead)
        e = _run(db, e)
    provider.create_campaign.assert_not_called()
    assert e.status == "exited_early" and e.exited_reason == "suppressed"


def test_campaign_reused_on_second_lead_unchanged_content(db):
    _settings(db)
    journey = _instantly_journey(db)
    provider = _mock_provider()
    with _patched(provider):
        l1 = _lead(db, email="one@example.com")
        e1 = je.enroll_lead(db, journey, l1)
        _run(db, e1)

        l2 = _lead(db, email="two@example.com")
        e2 = je.enroll_lead(db, journey, l2)
        _run(db, e2)

    # Same content_hash -> reused campaign, only one campaign row, one create call.
    provider.create_campaign.assert_called_once()
    assert provider.add_lead_to_campaign.call_count == 2
    assert db.query(models.JourneyInstantlyCampaign).filter(
        models.JourneyInstantlyCampaign.journey_id == journey.id
    ).count() == 1


def test_content_edit_mints_a_new_campaign_row_not_an_update(db):
    _settings(db)
    journey = _instantly_journey(db)
    provider = _mock_provider(create_result={"id": "camp-1"})
    with _patched(provider):
        l1 = _lead(db, email="one@example.com")
        e1 = je.enroll_lead(db, journey, l1)
        _run(db, e1)

    # Republish the same journey/node with edited step content.
    edited_steps = [{"subject": "New subject", "body": "Different body.", "delay_days": 1}]
    journey = _instantly_journey(db, steps=edited_steps, journey=journey)
    provider2 = _mock_provider(create_result={"id": "camp-2"})
    with _patched(provider2):
        l2 = _lead(db, email="two@example.com")
        e2 = je.enroll_lead(db, journey, l2)
        _run(db, e2)

    provider2.create_campaign.assert_called_once()
    rows = db.query(models.JourneyInstantlyCampaign).filter(
        models.JourneyInstantlyCampaign.journey_id == journey.id
    ).order_by(models.JourneyInstantlyCampaign.created_at).all()
    assert len(rows) == 2
    assert rows[0].instantly_campaign_id == "camp-1" and rows[1].instantly_campaign_id == "camp-2"
    assert rows[0].content_hash != rows[1].content_hash

    # The first lead's enrollment still points at the OLD campaign — never mutated.
    jie1 = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == e1.id
    ).one()
    assert jie1.instantly_campaign_id == "camp-1"


def test_add_lead_failure_backs_off_instead_of_sticking_forever(db):
    # attempt_count is normally incremented by _claim_due_rows at claim time
    # (see test_journey_engine.py's test_retryable_failure_reschedules_with_
    # backoff_not_immediately) — set it directly here since this test calls
    # the handler without going through the real claim step.
    _settings(db)
    lead = _lead(db, email="fail@example.com")
    journey = _instantly_journey(db)
    provider = _mock_provider(add_side_effect=RuntimeError("Instantly API error 500: boom"))
    with _patched(provider):
        e = je.enroll_lead(db, journey, lead)
    row = db.query(models.JourneyExecutionQueue).filter(models.JourneyExecutionQueue.enrollment_id == e.id).one()
    row.attempt_count = 1
    db.commit()

    before = je.datetime.now(je.timezone.utc)
    with _patched(provider):
        je._handle_instantly_sequence_node(db, e, journey, row, journey.live_version.graph_definition,
                                            {"steps": STEPS})
        db.commit()

    # Not dead-lettered yet (attempt_count below MAX_SEND_ATTEMPTS) — rescheduled.
    assert row.status == "pending"
    assert row.next_run_at.replace(tzinfo=None) > before.replace(tzinfo=None) + je.timedelta(seconds=50)
    db.refresh(e)
    assert e.status == "active"
    assert db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id
    ).count() == 0

    # Push attempt_count to the ceiling — now it must dead-letter the enrollment.
    row.attempt_count = je.MAX_SEND_ATTEMPTS
    db.commit()
    with _patched(provider):
        je._handle_instantly_sequence_node(db, e, journey, row, journey.live_version.graph_definition,
                                            {"steps": STEPS})
        db.commit()
    db.refresh(e)
    assert e.status == "failed" and e.exited_reason == "send_failed"


def _parked(db):
    _settings(db)
    lead = _lead(db, email="parked@example.com")
    journey = _instantly_journey(db)
    provider = _mock_provider()
    with _patched(provider):
        e = je.enroll_lead(db, journey, lead)
        e = _run(db, e)
    return e, lead, provider


def test_resume_each_outcome_advances_and_ends_the_instantly_enrollment(db):
    for outcome, expected_status in [
        ("replied", "completed"), ("interested", "completed"),
        ("meeting_booked", "completed"), ("completed", "completed"),
        ("unsubscribed", "exited"), ("bounced", "exited"),
    ]:
        e, lead, provider = _parked(db)
        with _patched(provider):
            resumed = je.resume_instantly_sequence_step(db, e.id, "i", outcome)
        assert resumed is True
        db.expire_all()
        jie = db.query(models.JourneyInstantlyEnrollment).filter(
            models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id
        ).one()
        assert jie.status == expected_status and jie.end_reason == outcome and jie.ended_at is not None
        e2 = db.query(models.JourneyEnrollment).get(e.id)
        # No branch_on_outcome configured -> falls through to the plain next edge (wait node).
        assert e2.current_node_id == "w"


def test_resume_is_idempotent_double_call_is_safe_no_op(db):
    e, lead, provider = _parked(db)
    with _patched(provider):
        assert je.resume_instantly_sequence_step(db, e.id, "i", "replied") is True
        # Second call: the JourneyInstantlyEnrollment is no longer active -> no-op.
        assert je.resume_instantly_sequence_step(db, e.id, "i", "replied") is False
    db.expire_all()
    jie = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id
    ).one()
    assert jie.status == "completed"   # unchanged by the second call


def test_exit_enrollment_early_removes_lead_from_campaign(db):
    e, lead, provider = _parked(db)
    with _patched(provider):
        je._exit_enrollment_early(db, db.query(models.JourneyEnrollment).get(e.id), reason="replied")
        db.commit()
    provider.remove_lead_from_campaign.assert_called_once_with("camp-1", "parked@example.com")
    jie = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id
    ).one()
    assert jie.status == "exited" and jie.end_reason == "replied"


def test_do_not_contact_exits_active_instantly_enrollment_immediately(db):
    e, lead, provider = _parked(db)
    user = {"sub": "owner-1", "role": "SDR", "name": "Tester", "email": "t@test.com"}
    with _patched(provider):
        lead_service.update_lead_fields(db, lead, {"do_not_contact": True}, user)
        db.commit()
    provider.remove_lead_from_campaign.assert_called_once_with("camp-1", "parked@example.com")
    db.expire_all()
    lead = db.query(models.Lead).get(lead.id)
    assert lead.do_not_contact is True and lead.unsubscribed_at is not None
    e2 = db.query(models.JourneyEnrollment).get(e.id)
    assert e2.status == "exited_early" and e2.exited_reason == "do_not_contact"
    jie = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id
    ).one()
    assert jie.status == "exited" and jie.end_reason == "do_not_contact"


# ── "Send from": a step's own mailbox pick, limited to what a Super Admin enabled ──

def _sent_from(provider):
    return provider.create_campaign.call_args.kwargs["sending_accounts"]


def test_a_step_sends_only_from_its_own_pick_within_the_enabled_mailboxes(db):
    s = _settings(db)
    s.instantly_sending_accounts = '["a@one.com", "b@one.com", "c@two.com"]'
    db.commit()
    journey = _instantly_journey(db, node_overrides={"sending_accounts": ["c@two.com", "x@disabled.com"]})
    provider = _mock_provider()
    with _patched(provider):
        _run(db, je.enroll_lead(db, journey, _lead(db, email="p@example.com")))
    assert _sent_from(provider) == ["c@two.com"]          # the disabled one is dropped server-side


def test_no_pick_uses_every_enabled_mailbox(db):
    s = _settings(db)
    s.instantly_sending_accounts = '["a@one.com", "b@one.com"]'
    db.commit()
    journey = _instantly_journey(db)
    provider = _mock_provider()
    with _patched(provider):
        _run(db, je.enroll_lead(db, journey, _lead(db, email="p@example.com")))
    assert _sent_from(provider) == ["a@one.com", "b@one.com"]


def test_a_pick_whose_mailboxes_were_all_switched_off_stops_with_a_clear_message(db):
    s = _settings(db)
    s.instantly_sending_accounts = '["a@one.com"]'
    db.commit()
    journey = _instantly_journey(db, node_overrides={"sending_accounts": ["c@two.com"]})
    provider = _mock_provider()
    with _patched(provider):
        e = _run(db, je.enroll_lead(db, journey, _lead(db, email="p@example.com")))
    provider.create_campaign.assert_not_called()
    assert e.status == "failed" and "Send from" in (e.last_error or "")


def test_changing_the_pick_mints_a_new_campaign_but_no_pick_keeps_the_old_hash(db):
    _settings(db)
    journey = _instantly_journey(db)
    provider = _mock_provider()
    with _patched(provider):
        _run(db, je.enroll_lead(db, journey, _lead(db, email="one@example.com")))
    assert db.query(models.JourneyInstantlyCampaign).one().content_hash == je._instantly_content_hash(STEPS)

    _instantly_journey(db, journey=journey, node_overrides={"sending_accounts": ["c@two.com"]})
    provider2 = _mock_provider(create_result={"id": "camp-2"})
    with _patched(provider2):
        _run(db, je.enroll_lead(db, journey, _lead(db, email="two@example.com")))
    provider2.create_campaign.assert_called_once()
    assert _sent_from(provider2) == ["c@two.com"]
    assert db.query(models.JourneyInstantlyCampaign).count() == 2
