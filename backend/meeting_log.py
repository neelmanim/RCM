"""Meetings as their own record (lead_meetings) — who booked, was it held, did they no-show.

Booking happens on four paths (call outcome, status update/kanban, Aircall-tag auto-log, Salesforce pull); all of them
call models.log_status_change, which calls `on_status_change` here, so no path can skip it. Counting rules:
  booked  = rows (a lead that booked, missed and rebooked counts twice — two real bookings)
  held    = status 'held'      no-show = status 'no_show'
Same hook stamps leads.lead_closed_at when a lead first reaches a meeting stage (the call-outcome and Aircall-tag paths
never did, so the per-SDR Analytics column undercounted).
"""
import logging
from datetime import datetime, timezone

import models

logger = logging.getLogger(__name__)

BOOKED_STATUS = "Meeting Scheduled"
HELD_STATUSES = ("1st Discovery Meeting", "Discovery Complete", "Demo Scheduled", "Demo Done", "Completed")
MEETING_REACHED = (BOOKED_STATUS,) + HELD_STATUSES   # same set as analytics_routes.MEETING_REACHED_STATUSES (tested)


def _source(changed_by):
    c = changed_by or ""
    return "aircall-tag" if c.startswith("Aircall tag") else "salesforce-sync" if c == "Salesforce sync" else "app"


def open_booking(db, lead_id):
    return (db.query(models.LeadMeeting)
            .filter(models.LeadMeeting.lead_id == lead_id, models.LeadMeeting.status == "booked")
            .order_by(models.LeadMeeting.booked_at.desc()).first())


def on_status_change(db, lead, from_status, to_status, changed_by=None, user_id=None):
    """Called for every real status move. Caller owns the transaction (and a SAVEPOINT around this)."""
    now = datetime.now(timezone.utc)
    reaching = to_status in MEETING_REACHED and from_status not in MEETING_REACHED
    if to_status in MEETING_REACHED and lead.lead_closed_at is None:
        lead.lead_closed_at = now
    if to_status == "Disqualified":
        m = open_booking(db, lead.id)
        if m:
            m.status = "cancelled"
    elif to_status == BOOKED_STATUS and reaching:
        db.add(models.LeadMeeting(lead_id=lead.id, booked_at=now, booked_by_user_id=user_id,
                                  meeting_at=lead.meeting_scheduled_at, status="booked", source=_source(changed_by)))
    elif to_status in HELD_STATUSES:
        m = open_booking(db, lead.id)
        if m:
            m.status, m.held_at = "held", now
        elif reaching:   # skipped the booking step (straight into a discovery/demo stage): still a held meeting
            db.add(models.LeadMeeting(lead_id=lead.id, booked_at=now, booked_by_user_id=user_id,
                                      meeting_at=lead.meeting_scheduled_at, status="held", held_at=now,
                                      source=_source(changed_by)))


def set_meeting_time(db, lead):
    """The call-outcome path learns the real meeting time after the status move — copy it onto the open booking."""
    m = open_booking(db, lead.id)
    if m and lead.meeting_scheduled_at:
        m.meeting_at = lead.meeting_scheduled_at


def mark_no_show(db, lead):
    """The lead missed the meeting it had booked. No-op when there is no open booking (nothing to mark)."""
    m = open_booking(db, lead.id)
    if m:
        m.status, m.no_show_at = "no_show", datetime.now(timezone.utc)
