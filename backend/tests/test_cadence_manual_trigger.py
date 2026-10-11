"""v13.6.0 — "Only when enrolled manually": a trigger that never matches an
engine event, so a status change (or an inbound email) never auto-enrols,
while enrolling by hand still works."""
import models
from journey_engine import engine as je
from conftest import create_test_lead
from test_cadence_playbook import _journey, _edges, WAIT


def test_a_manual_only_cadence_is_never_auto_enrolled_but_manual_enrol_works(db):
    trigger = {"id": "t", "type": "trigger", "data": {"event": "manual"}}
    journey = _journey(db, [trigger, WAIT], _edges(("t", "w")))
    lead = create_test_lead(db, email="m@example.com")

    for event in ("status_changed", "email_received"):
        je.check_entry_triggers(db, event, lead, to_status="Lead Assigned")
    assert db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.journey_id == journey.id).count() == 0

    e = je.enroll_lead(db, journey, lead)
    assert e is not None and e.status == "active"
