"""RCA 2026-09-29 (prod): Aircall's "Answered – Discovery Call / Meeting Set" tag
was unmapped and the tag path never advanced status, so 39 leads sat in Calling
with a meeting booked. Tag must advance pre-meeting leads, and only those."""
from conftest import create_test_user, create_test_lead, create_test_dialer_call
import models
import dialer_service


def _tag(db, status, tag="Answered - Discovery Call / Meeting Set"):
    user = create_test_user(db, email=f"sdr-{status}@t.com")
    lead = create_test_lead(db, email=f"lead-{status}@t.com", status=status)
    dc = create_test_dialer_call(db, lead.id, user.id)
    out = dialer_service._auto_log_outcome(db, dc, [tag], models.SyncSettings())
    db.commit()
    db.refresh(lead)
    return out, lead


def test_meeting_tag_advances_calling_lead(db):
    out, lead = _tag(db, "Calling")  # hyphen variant still matches the en-dash key
    assert out == "Meeting Confirmed"
    assert lead.status == "Meeting Scheduled"
    assert lead.meeting_scheduled_at is not None
    log = db.query(models.LeadStatusLog).filter_by(lead_id=lead.id).one()
    assert (log.from_status, log.to_status) == ("Calling", "Meeting Scheduled")


def test_meeting_tag_never_moves_a_lead_backwards(db):
    _, lead = _tag(db, "Demo Scheduled")
    assert lead.status == "Demo Scheduled"


def test_non_meeting_tag_leaves_status(db):
    out, lead = _tag(db, "Calling", tag="Answered – Call Back Later")
    assert out == "Call Back Later"
    assert lead.status == "Calling"
