"""Tests for GET /api/meetings — unified calendar view."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timezone
from conftest import create_test_user, create_test_lead
import models


def _assign(db, lead, user):
    db.execute(models.lead_assignments.insert().values(user_id=user.id, lead_id=lead.id))
    db.commit()


class TestListMeetings:
    def test_returns_lead_with_active_meeting(self, client, db):
        lead = create_test_lead(db, status="Meeting Scheduled")
        lead.meeting_scheduled_at = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        db.commit()

        resp = client.get("/api/meetings")
        assert resp.status_code == 200
        meetings = resp.json()["meetings"]
        assert len(meetings) == 1
        assert meetings[0]["lead_id"] == lead.id

    def test_excludes_lead_that_moved_off_meeting_status(self, client, db):
        """A lead that had a meeting scheduled but has since moved on (won/lost/
        disqualified) must not linger on the calendar forever."""
        lead = create_test_lead(db, status="Disqualified")
        lead.meeting_scheduled_at = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        db.commit()

        resp = client.get("/api/meetings")
        assert resp.json()["meetings"] == []

    def test_excludes_lead_with_no_meeting_datetime(self, client, db):
        create_test_lead(db, status="Meeting Scheduled")  # meeting_scheduled_at left null
        resp = client.get("/api/meetings")
        assert resp.json()["meetings"] == []

    def test_date_range_filter(self, client, db):
        early = create_test_lead(db, email="early@t.com", status="Meeting Scheduled")
        early.meeting_scheduled_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        late = create_test_lead(db, email="late@t.com", status="Meeting Scheduled")
        late.meeting_scheduled_at = datetime(2026, 12, 1, tzinfo=timezone.utc)
        db.commit()

        resp = client.get("/api/meetings?date_from=2026-06-01&date_to=2026-12-31")
        ids = {m["lead_id"] for m in resp.json()["meetings"]}
        assert ids == {late.id}

    def test_includes_assigned_sdr_name_for_the_calendar_filter(self, client, db):
        sdr = create_test_user(db, id="calendar-sdr", email="calsdr@test.com", role="SDR", name="Cal SDR")
        lead = create_test_lead(db, status="Meeting Scheduled")
        lead.meeting_scheduled_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
        db.commit()
        _assign(db, lead, sdr)

        resp = client.get("/api/meetings")
        assert resp.json()["meetings"][0]["assigned_to_name"] == "Cal SDR"

    def test_date_range_filter_with_js_toisostring_format(self, client, db):
        """The frontend sends dates via JS's toISOString(), which always ends in
        "Z" (e.g. 2026-07-01T00:00:00.000Z) — datetime.fromisoformat() cannot
        parse a trailing "Z" and silently no-ops the filter on ValueError if not
        handled. RCA 2026-07-14: this shipped a filter that never actually
        filtered, invisible until real "Meeting Scheduled" leads existed."""
        early = create_test_lead(db, email="early2@t.com", status="Meeting Scheduled")
        early.meeting_scheduled_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
        late = create_test_lead(db, email="late2@t.com", status="Meeting Scheduled")
        late.meeting_scheduled_at = datetime(2026, 7, 20, tzinfo=timezone.utc)
        db.commit()

        resp = client.get(
            "/api/meetings"
            "?date_from=2026-07-01T00:00:00.000Z"
            "&date_to=2026-07-31T23:59:59.999Z"
        )
        ids = {m["lead_id"] for m in resp.json()["meetings"]}
        assert ids == {late.id}

    def test_includes_calendar_event_title_and_agenda(self, client, db):
        lead = create_test_lead(db, status="Meeting Scheduled")
        lead.meeting_scheduled_at = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        lead.calendar_event_title = "Discovery Call: Acme"
        lead.calendar_event_agenda = "Review current workflow."
        db.commit()

        resp = client.get("/api/meetings")
        meeting = resp.json()["meetings"][0]
        assert meeting["calendar_event_title"] == "Discovery Call: Acme"
        assert meeting["calendar_event_agenda"] == "Review current workflow."

    def test_calendar_event_title_and_agenda_null_when_not_set(self, client, db):
        """Meetings booked before this shipped (or without a real calendar
        event) — Calendar Hub falls back to its own synthesized label."""
        lead = create_test_lead(db, status="Meeting Scheduled")
        lead.meeting_scheduled_at = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        db.commit()

        resp = client.get("/api/meetings")
        meeting = resp.json()["meetings"][0]
        assert meeting["calendar_event_title"] is None
        assert meeting["calendar_event_agenda"] is None

    def test_sdr_only_sees_own_assigned_leads(self, client_as_sdr, db):
        sdr = create_test_user(db, id="sdr-user-id", email="sdr@test.com", role="SDR")
        other_sdr = create_test_user(db, id="other-sdr", email="other@test.com", role="SDR")

        mine = create_test_lead(db, email="mine@t.com", status="Meeting Scheduled")
        mine.meeting_scheduled_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
        not_mine = create_test_lead(db, email="notmine@t.com", status="Meeting Scheduled")
        not_mine.meeting_scheduled_at = datetime(2026, 8, 2, tzinfo=timezone.utc)
        db.commit()

        _assign(db, mine, sdr)
        _assign(db, not_mine, other_sdr)

        resp = client_as_sdr.get("/api/meetings")
        ids = {m["lead_id"] for m in resp.json()["meetings"]}
        assert ids == {mine.id}
