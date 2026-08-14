"""Tests for nylas_calendar.py — Nylas v3 Calendar API helpers."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, MagicMock

from nylas_calendar import get_primary_calendar_id, check_free_busy, create_event, NylasCalendarError


def _resp(status_code, json_data):
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = json_data
    r.text = str(json_data)
    return r


class TestGetPrimaryCalendarId:

    @patch("nylas_calendar.httpx.get")
    def test_picks_primary_flagged_calendar(self, mock_get):
        mock_get.return_value = _resp(200, {"data": [
            {"id": "cal-1", "is_primary": False},
            {"id": "cal-2", "is_primary": True},
        ]})
        assert get_primary_calendar_id("grant-1", "key") == "cal-2"

    @patch("nylas_calendar.httpx.get")
    def test_falls_back_to_first_when_none_primary(self, mock_get):
        mock_get.return_value = _resp(200, {"data": [{"id": "cal-1"}, {"id": "cal-2"}]})
        assert get_primary_calendar_id("grant-1", "key") == "cal-1"

    @patch("nylas_calendar.httpx.get")
    def test_no_calendars_returns_none(self, mock_get):
        mock_get.return_value = _resp(200, {"data": []})
        assert get_primary_calendar_id("grant-1", "key") is None

    @patch("nylas_calendar.httpx.get")
    def test_error_status_raises_with_code(self, mock_get):
        mock_get.return_value = _resp(401, {"error": "invalid grant"})
        try:
            get_primary_calendar_id("grant-1", "key")
            assert False, "expected NylasCalendarError"
        except NylasCalendarError as e:
            assert e.status_code == 401


class TestCheckFreeBusy:

    @patch("nylas_calendar.httpx.post")
    def test_returns_busy_slots_for_matching_email(self, mock_post):
        mock_post.return_value = _resp(200, {"data": [
            {"email": "sdr@t.com", "object": "free_busy",
             "time_slots": [{"status": "busy", "start_time": 100, "end_time": 200}]},
        ]})
        slots = check_free_busy("grant-1", "key", "sdr@t.com", 0, 1000)
        assert slots == [{"status": "busy", "start_time": 100, "end_time": 200}]

    @patch("nylas_calendar.httpx.post")
    def test_no_conflict_returns_empty(self, mock_post):
        mock_post.return_value = _resp(200, {"data": [
            {"email": "sdr@t.com", "object": "free_busy", "time_slots": []},
        ]})
        assert check_free_busy("grant-1", "key", "sdr@t.com", 0, 1000) == []

    @patch("nylas_calendar.httpx.post")
    def test_per_email_error_object_treated_as_unknown_not_raised(self, mock_post):
        """A calendar we can't read must never block the booking flow —
        only skip the warning (see docstring)."""
        mock_post.return_value = _resp(200, {"data": [
            {"email": "sdr@t.com", "object": "error", "message": "not accessible"},
        ]})
        assert check_free_busy("grant-1", "key", "sdr@t.com", 0, 1000) == []

    @patch("nylas_calendar.httpx.post")
    def test_non_200_raises(self, mock_post):
        mock_post.return_value = _resp(500, {"error": "oops"})
        try:
            check_free_busy("grant-1", "key", "sdr@t.com", 0, 1000)
            assert False, "expected NylasCalendarError"
        except NylasCalendarError:
            pass


class TestCreateEvent:

    @patch("nylas_calendar.httpx.post")
    def test_creates_with_participant(self, mock_post):
        mock_post.return_value = _resp(200, {"data": {"id": "evt-1", "html_link": "https://cal.example/evt-1"}})
        event = create_event(
            "grant-1", "key", "cal-1", "Meeting: Jane Doe (Acme)", "Booked via RCM",
            1000, 2800, participant_email="jane@acme.com", participant_name="Jane Doe",
        )
        assert event["id"] == "evt-1"
        assert event["html_link"] == "https://cal.example/evt-1"
        sent_body = mock_post.call_args.kwargs["json"]
        assert sent_body["participants"] == [{"email": "jane@acme.com", "name": "Jane Doe"}]

    @patch("nylas_calendar.httpx.post")
    def test_creates_without_participant_when_no_email(self, mock_post):
        mock_post.return_value = _resp(200, {"data": {"id": "evt-2"}})
        event = create_event(
            "grant-1", "key", "cal-1", "Meeting: Jane Doe (Acme)", "Booked via RCM",
            1000, 2800, participant_email=None, participant_name="Jane Doe",
        )
        assert event["id"] == "evt-2"
        sent_body = mock_post.call_args.kwargs["json"]
        assert sent_body["participants"] == []

    @patch("nylas_calendar.httpx.post")
    def test_extra_emails_appended_after_participant(self, mock_post):
        mock_post.return_value = _resp(200, {"data": {"id": "evt-3"}})
        create_event(
            "grant-1", "key", "cal-1", "t", "d", 1000, 2800,
            participant_email="jane@acme.com", participant_name="Jane Doe",
            extra_emails=["guest1@x.com", "guest2@x.com"],
        )
        sent_body = mock_post.call_args.kwargs["json"]
        assert sent_body["participants"] == [
            {"email": "jane@acme.com", "name": "Jane Doe"},
            {"email": "guest1@x.com"},
            {"email": "guest2@x.com"},
        ]

    @patch("nylas_calendar.httpx.post")
    def test_extra_emails_dedupes_against_participant(self, mock_post):
        mock_post.return_value = _resp(200, {"data": {"id": "evt-4"}})
        create_event(
            "grant-1", "key", "cal-1", "t", "d", 1000, 2800,
            participant_email="jane@acme.com",
            extra_emails=["jane@acme.com", "guest@x.com"],
        )
        sent_body = mock_post.call_args.kwargs["json"]
        assert sent_body["participants"] == [{"email": "jane@acme.com"}, {"email": "guest@x.com"}]

    @patch("nylas_calendar.httpx.post")
    def test_non_2xx_raises_with_status_code(self, mock_post):
        mock_post.return_value = _resp(403, {"error": "missing scope"})
        try:
            create_event("grant-1", "key", "cal-1", "t", "d", 1000, 2800)
            assert False, "expected NylasCalendarError"
        except NylasCalendarError as e:
            assert e.status_code == 403
