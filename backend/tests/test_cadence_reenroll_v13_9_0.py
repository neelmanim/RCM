"""v13.9.0 — re-enrollment setting (allow_reenroll / reenroll_cooloff_days) and the
blank-status-trigger guard. NULL allow_reenroll = a pre-v13.9.0 cadence = unchanged."""
from datetime import datetime, timedelta, timezone

import models
from journey_engine import engine as je
from conftest import create_test_lead
from test_cadence_playbook import _journey, _edges, WAIT


def _past_run(db, journey, lead, status="completed", days_ago=3):
    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    e = models.JourneyEnrollment(journey_id=journey.id, version_id=journey.live_version_id, lead_id=lead.id,
                                 current_node_id="w", status=status, enrolled_at=when, completed_at=when)
    db.add(e); db.commit()
    return e


def _live(db, **settings):
    trigger = {"id": "t", "type": "trigger", "data": {"event": "manual"}}
    j = _journey(db, [trigger, WAIT], _edges(("t", "w")))
    for k, v in settings.items():
        setattr(j, k, v)
    db.commit()
    return j


class TestReenrollRule:
    def test_legacy_cadence_null_setting_still_allows_reenroll(self, db):
        j = _live(db); lead = create_test_lead(db)
        _past_run(db, j, lead)
        assert j.allow_reenroll is None
        assert je.reenroll_block_reason(db, j, lead) is None
        assert je.enroll_lead(db, j, lead) is not None

    def test_off_blocks_after_completed_exited_and_paused(self, db):
        j = _live(db, allow_reenroll=False)
        for st in ("completed", "exited_early", "paused"):
            lead = create_test_lead(db, email=f"{st}@x.com")
            _past_run(db, j, lead, status=st)
            assert "re-enrollment is off" in je.reenroll_block_reason(db, j, lead)
            assert je.enroll_lead(db, j, lead) is None

    def test_a_lead_removed_by_hand_can_always_be_added_back(self, db):
        j = _live(db, allow_reenroll=False)
        lead = create_test_lead(db)
        e = _past_run(db, j, lead, status="exited_early")
        e.exited_reason = "manually_removed"; db.commit()
        assert je.reenroll_block_reason(db, j, lead) is None
        assert je.enroll_lead(db, j, lead) is not None

    def test_off_still_allows_a_first_enrollment_and_a_retry_after_failure(self, db):
        j = _live(db, allow_reenroll=False)
        fresh = create_test_lead(db, email="fresh@x.com")
        assert je.enroll_lead(db, j, fresh) is not None
        failed = create_test_lead(db, email="failed@x.com")
        _past_run(db, j, failed, status="failed")
        assert je.reenroll_block_reason(db, j, failed) is None

    def test_cooloff_blocks_until_it_has_passed(self, db):
        j = _live(db, allow_reenroll=True, reenroll_cooloff_days=30)
        recent = create_test_lead(db, email="recent@x.com"); _past_run(db, j, recent, days_ago=5)
        old = create_test_lead(db, email="old@x.com"); _past_run(db, j, old, days_ago=45)
        assert "waits 30 days" in je.reenroll_block_reason(db, j, recent)
        assert je.enroll_lead(db, j, recent) is None
        assert je.reenroll_block_reason(db, j, old) is None
        assert je.enroll_lead(db, j, old) is not None

    def test_other_cadences_history_does_not_count(self, db):
        a = _live(db, allow_reenroll=False)
        b = _live(db, allow_reenroll=False)
        lead = create_test_lead(db)
        _past_run(db, a, lead)
        assert je.reenroll_block_reason(db, b, lead) is None

    def test_status_trigger_respects_the_rule(self, db):
        trigger = {"id": "t", "type": "trigger", "data": {"event": "status_changed", "to_status": "Calling"}}
        j = _journey(db, [trigger, WAIT], _edges(("t", "w")))
        j.allow_reenroll = False; db.commit()
        lead = create_test_lead(db)
        _past_run(db, j, lead)
        je.check_entry_triggers(db, "status_changed", lead, from_status="Lead Assigned", to_status="Calling")
        assert db.query(models.JourneyEnrollment).filter_by(journey_id=j.id, lead_id=lead.id, status="active").count() == 0


class TestBlankStatusTrigger:
    def _status_journey(self, db, to_status):
        data = {"event": "status_changed"}
        if to_status is not None:
            data["to_status"] = to_status
        return _journey(db, [{"id": "t", "type": "trigger", "data": data}, WAIT], _edges(("t", "w")))

    def test_blank_or_missing_status_matches_nothing(self, db):
        for blank in (None, "", "   "):
            j = self._status_journey(db, blank)
            lead = create_test_lead(db, email=f"b{abs(hash(str(blank)))}@x.com")
            je.check_entry_triggers(db, "status_changed", lead, from_status="Lead Assigned", to_status="Calling")
            assert db.query(models.JourneyEnrollment).filter_by(journey_id=j.id).count() == 0

    def test_a_set_status_still_matches_only_that_status(self, db):
        j = self._status_journey(db, "Calling")
        hit = create_test_lead(db, email="hit@x.com"); miss = create_test_lead(db, email="miss@x.com")
        je.check_entry_triggers(db, "status_changed", hit, from_status="Lead Assigned", to_status="Calling")
        je.check_entry_triggers(db, "status_changed", miss, from_status="Lead Assigned", to_status="Research")
        assert db.query(models.JourneyEnrollment).filter_by(journey_id=j.id, lead_id=hit.id).count() == 1
        assert db.query(models.JourneyEnrollment).filter_by(journey_id=j.id, lead_id=miss.id).count() == 0


class TestSettingsApi:
    def test_new_cadence_defaults_to_off_and_settings_roundtrip(self, client, db):
        j = client.post("/api/journeys", json={"name": "Fresh"}).json()
        got = client.get(f"/api/journeys/{j['id']}").json()
        assert got["allow_reenroll"] is False
        r = client.patch(f"/api/journeys/{j['id']}", json={"allow_reenroll": True, "reenroll_cooloff_days": 14})
        assert r.status_code == 200
        got = client.get(f"/api/journeys/{j['id']}").json()
        assert got["allow_reenroll"] is True and got["reenroll_cooloff_days"] == 14

    def test_validation(self, client, db):
        j = client.post("/api/journeys", json={"name": "V"}).json()
        assert client.patch(f"/api/journeys/{j['id']}", json={"allow_reenroll": "yes"}).status_code == 422
        assert client.patch(f"/api/journeys/{j['id']}", json={"reenroll_cooloff_days": 0}).status_code == 422

    def test_legacy_journey_reports_allowed(self, client, db):
        j = _live(db)
        assert client.get(f"/api/journeys/{j.id}").json()["allow_reenroll"] is True

    def test_manual_enroll_reports_why_it_was_skipped(self, client, db):
        j = _live(db, allow_reenroll=False, send_as="assigned_rep")
        lead = create_test_lead(db)
        _past_run(db, j, lead)
        r = client.post(f"/api/journeys/{j.id}/enroll", json={"lead_ids": [lead.id]}).json()
        assert r["enrolled"] == 0
        assert r["skipped"][0]["reason"] == "reenrollment_not_allowed" and "re-enrollment is off" in r["skipped"][0]["detail"]

    def test_duplicate_copies_the_setting(self, client, db):
        j = client.post("/api/journeys", json={"name": "Src"}).json()
        client.patch(f"/api/journeys/{j['id']}", json={"allow_reenroll": True, "reenroll_cooloff_days": 7})
        copy = client.post(f"/api/journeys/{j['id']}/duplicate").json()
        got = client.get(f"/api/journeys/{copy['id']}").json()
        assert got["allow_reenroll"] is True and got["reenroll_cooloff_days"] == 7
