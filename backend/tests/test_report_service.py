"""
Tests for report_service.py (v11.4.0 multi-report engine).

Covers:
  - clamp_day_of_month: Feb-31 style edge cases
  - resolve_date_range: previous_1_day / previous_7_days / previous_calendar_month, timezone-aware
  - is_due: weekly/monthly gating, timezone, already-run guard
  - next_run_at: forward-walk for daily/weekly/monthly
  - Component builders: key_metrics, sdr_performance
  - build_report_content: no-data message
  - send_report_email: mailbox/config guards, cc/bcc, csv attachment
  - execute_report: skipped (no recipients/sender), sent, failed
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

import models
from conftest import (
    create_test_lead,
    create_test_user,
    create_nylas_config,
    create_user_mailbox,
)
from report_service import (
    clamp_day_of_month,
    resolve_date_range,
    is_due,
    next_run_at,
    build_report_content,
    send_report_email,
    execute_report,
    COMPONENTS,
)


def _make_report(db, **overrides):
    report = models.ReportConfig(
        name=overrides.get("name", "Test Report"),
        enabled=overrides.get("enabled", True),
        components=overrides.get("components", '["key_metrics"]'),
        pod_id=overrides.get("pod_id"),
        upload_log_id=overrides.get("upload_log_id"),
        sdr_id=overrides.get("sdr_id"),
        date_range_rule=overrides.get("date_range_rule", "previous_7_days"),
        custom_start=overrides.get("custom_start"),
        custom_end=overrides.get("custom_end"),
        frequency=overrides.get("frequency", "weekly"),
        weekday=overrides.get("weekday", 0),
        day_of_month=overrides.get("day_of_month", 1),
        timezone=overrides.get("timezone", "UTC"),
        send_hour=overrides.get("send_hour", 9),
        send_minute=overrides.get("send_minute", 0),
        to_recipients=overrides.get("to_recipients", '["stake@t.com"]'),
        cc_recipients=overrides.get("cc_recipients"),
        bcc_recipients=overrides.get("bcc_recipients"),
        sender_user_id=overrides.get("sender_user_id"),
        include_csv=overrides.get("include_csv", True),
        last_run_at=overrides.get("last_run_at"),
        send_to_all_users=overrides.get("send_to_all_users", False),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


class TestClampDayOfMonth:

    def test_returns_day_when_it_exists(self):
        assert clamp_day_of_month(15, 2026, 3) == 15

    def test_clamps_31_in_february(self):
        assert clamp_day_of_month(31, 2026, 2) == 28

    def test_clamps_31_in_leap_february(self):
        assert clamp_day_of_month(31, 2028, 2) == 29

    def test_clamps_31_in_thirty_day_month(self):
        assert clamp_day_of_month(31, 2026, 4) == 30


class TestResolveDateRange:

    def test_previous_1_day(self):
        now = datetime(2026, 8, 17, 10, 0, tzinfo=timezone.utc)
        start, end = resolve_date_range("previous_1_day", "UTC", now)
        assert end == datetime(2026, 8, 17, 0, 0, tzinfo=timezone.utc)
        assert start == datetime(2026, 8, 16, 0, 0, tzinfo=timezone.utc)

    def test_previous_7_days(self):
        now = datetime(2026, 8, 17, 10, 0, tzinfo=timezone.utc)
        start, end = resolve_date_range("previous_7_days", "UTC", now)
        assert (end - start) == timedelta(days=7)
        assert end == datetime(2026, 8, 17, 0, 0, tzinfo=timezone.utc)

    def test_previous_calendar_month(self):
        now = datetime(2026, 8, 17, 10, 0, tzinfo=timezone.utc)
        start, end = resolve_date_range("previous_calendar_month", "UTC", now)
        assert start == datetime(2026, 7, 1, 0, 0, tzinfo=timezone.utc)
        assert end == datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)

    def test_previous_calendar_month_across_year_boundary(self):
        now = datetime(2026, 1, 10, 10, 0, tzinfo=timezone.utc)
        start, end = resolve_date_range("previous_calendar_month", "UTC", now)
        assert start == datetime(2025, 12, 1, 0, 0, tzinfo=timezone.utc)
        assert end == datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)

    def test_respects_non_utc_timezone(self):
        """10:00 UTC on Aug 17 is already Aug 17 15:30 in Asia/Kolkata (+05:30)
        — 'today' for a Kolkata-scheduled report must use ITS midnight, not UTC's."""
        now = datetime(2026, 8, 17, 20, 0, tzinfo=timezone.utc)  # 01:30 Aug 18 IST
        start, end = resolve_date_range("previous_1_day", "Asia/Kolkata", now)
        # IST local midnight for "today" (Aug 18 IST) is Aug 17 18:30 UTC
        assert end == datetime(2026, 8, 17, 18, 30, tzinfo=timezone.utc)


class TestIsDue:

    def test_daily_due_after_send_time(self):
        report = MagicMock(frequency="daily", timezone="UTC", send_hour=9, send_minute=0, last_run_at=None)
        now = datetime(2026, 8, 17, 10, 0, tzinfo=timezone.utc)
        assert is_due(report, now) is True

    def test_daily_not_due_before_send_time(self):
        report = MagicMock(frequency="daily", timezone="UTC", send_hour=9, send_minute=0, last_run_at=None)
        now = datetime(2026, 8, 17, 8, 0, tzinfo=timezone.utc)
        assert is_due(report, now) is False

    def test_weekly_skips_wrong_weekday(self):
        # 2026-08-17 is a Monday (weekday 0); report configured for Wednesday (2)
        report = MagicMock(frequency="weekly", weekday=2, timezone="UTC", send_hour=9, send_minute=0, last_run_at=None)
        now = datetime(2026, 8, 17, 10, 0, tzinfo=timezone.utc)
        assert is_due(report, now) is False

    def test_weekly_due_on_correct_weekday(self):
        report = MagicMock(frequency="weekly", weekday=0, timezone="UTC", send_hour=9, send_minute=0, last_run_at=None)
        now = datetime(2026, 8, 17, 10, 0, tzinfo=timezone.utc)
        assert is_due(report, now) is True

    def test_monthly_clamps_to_last_day(self):
        report = MagicMock(frequency="monthly", day_of_month=31, timezone="UTC", send_hour=9, send_minute=0, last_run_at=None)
        now = datetime(2026, 2, 28, 10, 0, tzinfo=timezone.utc)
        assert is_due(report, now) is True

    def test_already_run_this_window_skips(self):
        report = MagicMock(
            frequency="daily", timezone="UTC", send_hour=9, send_minute=0,
            last_run_at=datetime(2026, 8, 17, 9, 5, tzinfo=timezone.utc),
        )
        now = datetime(2026, 8, 17, 11, 0, tzinfo=timezone.utc)
        assert is_due(report, now) is False

    def test_naive_last_run_at_treated_as_utc(self):
        report = MagicMock(
            frequency="daily", timezone="UTC", send_hour=9, send_minute=0,
            last_run_at=datetime(2026, 8, 17, 9, 5),  # naive
        )
        now = datetime(2026, 8, 17, 11, 0, tzinfo=timezone.utc)
        assert is_due(report, now) is False


class TestNextRunAt:

    def test_daily_next_run_is_tomorrow_if_today_passed(self):
        report = MagicMock(frequency="daily", timezone="UTC", send_hour=9, send_minute=0)
        now = datetime(2026, 8, 17, 10, 0, tzinfo=timezone.utc)
        result = next_run_at(report, now)
        assert result == datetime(2026, 8, 18, 9, 0, tzinfo=timezone.utc)

    def test_weekly_finds_next_matching_weekday(self):
        report = MagicMock(frequency="weekly", weekday=2, timezone="UTC", send_hour=9, send_minute=0)  # Wednesday
        now = datetime(2026, 8, 17, 10, 0, tzinfo=timezone.utc)  # Monday
        result = next_run_at(report, now)
        assert result.weekday() == 2
        assert result > now


class TestComponents:

    def test_key_metrics_registered(self):
        assert "key_metrics" in COMPONENTS
        assert "sdr_performance" in COMPONENTS
        assert "release_digest" in COMPONENTS

    def test_key_metrics_reflects_activity(self, db):
        sdr = create_test_user(db, email="km_sdr@t.com", role="SDR", google_id="km-1")
        lead = create_test_lead(db, email="km_lead@t.com")
        db.execute(models.lead_assignments.insert().values(user_id=sdr.id, lead_id=lead.id))
        db.commit()
        report = _make_report(db, sdr_id=sdr.id)
        now = datetime.now(timezone.utc)
        start, end = now - timedelta(days=7), now

        title, html, csv_rows, has_data = COMPONENTS["key_metrics"]["builder"](db, report, start, end)
        assert title == "Key Metrics"
        assert "leads assigned" in html
        assert has_data is True

    def test_sdr_performance_shows_qualified_disqualified(self, db):
        sdr = create_test_user(db, email="sp_sdr@t.com", role="SDR", google_id="sp-1")
        lead = create_test_lead(db, email="sp_lead@t.com")
        db.execute(models.lead_assignments.insert().values(user_id=sdr.id, lead_id=lead.id))
        db.commit()
        now = datetime.now(timezone.utc)
        lead.status = "Meeting Scheduled"
        lead.lead_closed_at = now - timedelta(hours=1)
        db.commit()
        report = _make_report(db, sdr_id=sdr.id)

        title, html, rows, has_data = COMPONENTS["sdr_performance"]["builder"](db, report, now - timedelta(days=1), now)
        assert title == "SDR Performance"
        assert has_data is True
        assert rows[0]["qualified"] == 1

    def test_sdr_performance_includes_calls_made_and_meetings(self, db):
        """RCA 2026-08-18 (customer-reported): the table only ever showed
        Qualified/Disqualified — calls made and meetings, already computed
        elsewhere in this file, never made it into the per-SDR table."""
        sdr = create_test_user(db, email="calls_sdr@t.com", role="SDR", google_id="calls-sdr-1")
        lead = create_test_lead(db, email="calls_lead@t.com")
        db.execute(models.lead_assignments.insert().values(user_id=sdr.id, lead_id=lead.id))
        now = datetime.now(timezone.utc)
        db.add(models.DialerCall(
            lead_id=lead.id, user_id=sdr.id, provider="aircall", status="CALL_ENDED",
            direction="outbound", started_at=now - timedelta(hours=1),
        ))
        db.commit()
        report = _make_report(db, sdr_id=sdr.id)

        title, html, rows, has_data = COMPONENTS["sdr_performance"]["builder"](db, report, now - timedelta(days=1), now)
        assert has_data is True
        assert rows[0]["calls_made"] == 1
        assert "Calls Made" in html
        assert "Meetings" in html

    def test_sdr_performance_includes_connect_rate_and_conversations(self, db):
        """Viren's feedback (2026-08-18): the SDR Performance table needed
        connect rate and conversations — both already computed by
        _compute_sdr_rows and used org-wide in Key Metrics, just never
        surfaced as per-SDR columns here."""
        sdr = create_test_user(db, email="cr_sdr@t.com", role="SDR", google_id="cr-sdr-1")
        lead = create_test_lead(db, email="cr_lead@t.com")
        db.execute(models.lead_assignments.insert().values(user_id=sdr.id, lead_id=lead.id))
        now = datetime.now(timezone.utc)
        db.add(models.DialerCall(
            lead_id=lead.id, user_id=sdr.id, provider="aircall", status="CALL_ENDED",
            direction="outbound", started_at=now - timedelta(hours=1),
            outcome="Meeting Scheduled", duration=90,
        ))
        db.commit()
        report = _make_report(db, sdr_id=sdr.id)

        title, html, rows, has_data = COMPONENTS["sdr_performance"]["builder"](db, report, now - timedelta(days=1), now)
        assert has_data is True
        assert rows[0]["connect_rate"] == 100.0
        assert rows[0]["conversations"] == 1
        assert "Connect Rate" in html
        assert "Conversations" in html
        assert "100.0%" in html


class TestReleaseDigest:
    """v11.5.6: the weekly 'What Shipped This Week' report component.
    Uses a fixture releases.json (mocked open()) instead of the real file
    so these tests don't drift every time a new version ships."""

    FIXTURE = [
        {"version": "v9.0.2", "date": "01 Jan 2026", "summary": "Too early, must not appear."},
        {"version": "v10.0.0", "date": "12 Aug 2026", "family": "10.0", "kind": "major",
         "title": "Big feature", "tags": [], "items": ["**Full detail** for the release"]},
        {"version": "v10.0.1", "date": "13 Aug 2026", "family": "10.0", "kind": "minor",
         "tags": [], "summary": "A small **fix** shipped the next day."},
        {"version": "v11.0.0", "date": "20 Aug 2026", "summary": "Too late, must not appear."},
    ]

    def _run(self, db, monkeypatch, start, end, fixture=None, frontend_url=None):
        import report_service
        from unittest.mock import mock_open, patch

        m = mock_open(read_data=json.dumps(fixture if fixture is not None else self.FIXTURE))
        if frontend_url is not None:
            monkeypatch.setenv("FRONTEND_URL", frontend_url)
        report = _make_report(db, components='["release_digest"]')
        with patch("builtins.open", m):
            return COMPONENTS["release_digest"]["builder"](db, report, start, end)

    def test_only_entries_within_the_date_range_are_included(self, db, monkeypatch):
        start = datetime(2026, 8, 12, tzinfo=timezone.utc)
        end = datetime(2026, 8, 13, tzinfo=timezone.utc)
        title, html, rows, has_data = self._run(db, monkeypatch, start, end)

        assert title == "What Shipped This Week"
        assert has_data is True
        versions = [r["version"] for r in rows]
        assert versions == ["v10.0.0", "v10.0.1"]
        assert "v9.0.2" not in html
        assert "v11.0.0" not in html

    def test_hero_entry_gets_full_item_list_minor_gets_one_line(self, db, monkeypatch):
        start = datetime(2026, 8, 12, tzinfo=timezone.utc)
        end = datetime(2026, 8, 13, tzinfo=timezone.utc)
        _, html, _, _ = self._run(db, monkeypatch, start, end)

        assert "Full detail" in html and "Big feature" in html  # hero: title + items
        assert "<strong>fix</strong>" in html  # minor: **bold** converted to HTML

    def test_no_releases_in_range_reports_no_data(self, db, monkeypatch):
        start = datetime(2026, 2, 1, tzinfo=timezone.utc)
        end = datetime(2026, 2, 7, tzinfo=timezone.utc)
        title, html, rows, has_data = self._run(db, monkeypatch, start, end)

        assert has_data is False
        assert rows == []
        assert "Nothing shipped" in html

    def test_includes_help_hub_link_when_frontend_url_configured(self, db, monkeypatch):
        start = datetime(2026, 8, 12, tzinfo=timezone.utc)
        end = datetime(2026, 8, 13, tzinfo=timezone.utc)
        _, html, _, _ = self._run(db, monkeypatch, start, end, frontend_url="https://alternatecrm.staging.in")

        assert "https://alternatecrm.staging.in/index.html#user-guide" in html

    def test_omits_link_when_frontend_url_not_configured(self, db, monkeypatch):
        monkeypatch.delenv("FRONTEND_URL", raising=False)
        start = datetime(2026, 8, 12, tzinfo=timezone.utc)
        end = datetime(2026, 8, 13, tzinfo=timezone.utc)
        _, html, _, _ = self._run(db, monkeypatch, start, end)

        assert "user-guide" not in html

    def test_unparseable_date_entries_are_skipped_not_crashed_on(self, db, monkeypatch):
        fixture = [{"version": "v1.0.0", "date": "not-a-date", "summary": "bad date"}]
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        end = datetime(2026, 12, 31, tzinfo=timezone.utc)
        title, html, rows, has_data = self._run(db, monkeypatch, start, end, fixture=fixture)

        assert has_data is False
        assert rows == []


class TestBuildReportContent:

    def test_no_data_message_when_nothing_happened(self, db):
        report = _make_report(db)
        now = datetime.now(timezone.utc)
        html, csv_text = build_report_content(db, report, ["key_metrics"], now - timedelta(days=7), now)
        assert "No activity found" in html


class TestSendReportEmail:

    def test_no_mailbox_returns_false(self, db):
        user = create_test_user(db, email="no_mailbox2@t.com", role="SDR", google_id="nomb2-1")
        sent = send_report_email(db, user.id, ["stake@t.com"], "<p>hi</p>", "Subject")
        assert sent is False

    def test_no_nylas_config_returns_false(self, db):
        user = create_test_user(db, email="has_mailbox2@t.com", role="SDR", google_id="hasmb2-1")
        create_user_mailbox(db, user.id)
        sent = send_report_email(db, user.id, ["stake@t.com"], "<p>hi</p>", "Subject")
        assert sent is False

    @patch("report_service.decrypt_token", return_value="fake-api-key")
    @patch("report_service.requests.post")
    def test_sends_with_cc_bcc_and_csv(self, mock_post, mock_decrypt, db):
        user = create_test_user(db, email="sender3@t.com", role="SDR", google_id="sender-3")
        create_user_mailbox(db, user.id, nylas_grant_id="grant-report-2")
        create_nylas_config(db)
        mock_post.return_value = MagicMock(status_code=200)

        sent = send_report_email(
            db, user.id, ["to@t.com"], "<p>hi</p>", "Subject",
            cc=["cc@t.com"], bcc=["bcc@t.com"], csv_attachment="a,b\n1,2\n",
        )
        assert sent is True
        assert "grant-report-2" in mock_post.call_args[0][0]
        assert "files" in mock_post.call_args[1]


class TestExecuteReport:

    def test_skipped_when_no_recipients(self, db):
        report = _make_report(db, to_recipients="[]", sender_user_id="sender-id")
        execution = execute_report(db, report)
        assert execution.status == "skipped"
        assert "recipients" in execution.failure_reason.lower()

    def test_skipped_when_no_sender(self, db):
        report = _make_report(db, sender_user_id=None)
        execution = execute_report(db, report)
        assert execution.status == "skipped"
        assert "sender" in execution.failure_reason.lower()

    @patch("report_service.send_report_email", return_value=True)
    def test_sent_updates_last_run_at(self, mock_send, db):
        user = create_test_user(db, email="exec_sender@t.com", role="SDR", google_id="exec-1")
        report = _make_report(db, sender_user_id=user.id)
        assert report.last_run_at is None

        execution = execute_report(db, report)
        assert execution.status == "sent"
        db.refresh(report)
        assert report.last_run_at is not None

    @patch("report_service.send_report_email", return_value=False)
    def test_failed_when_send_returns_false(self, mock_send, db):
        user = create_test_user(db, email="exec_sender2@t.com", role="SDR", google_id="exec-2")
        report = _make_report(db, sender_user_id=user.id)
        execution = execute_report(db, report)
        assert execution.status == "failed"

    def test_records_reporting_period(self, db):
        user = create_test_user(db, email="exec_sender3@t.com", role="SDR", google_id="exec-3")
        report = _make_report(db, sender_user_id=user.id, date_range_rule="previous_1_day")
        with patch("report_service.send_report_email", return_value=True):
            execution = execute_report(db, report)
        assert execution.reporting_period_start is not None
        assert execution.reporting_period_end is not None
        assert execution.reporting_period_end > execution.reporting_period_start

    def test_custom_range_uses_stored_dates(self, db):
        user = create_test_user(db, email="exec_sender4@t.com", role="SDR", google_id="exec-4")
        custom_start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        custom_end = datetime(2026, 1, 15, tzinfo=timezone.utc)
        report = _make_report(
            db, sender_user_id=user.id, date_range_rule="custom",
            custom_start=custom_start, custom_end=custom_end,
        )
        with patch("report_service.send_report_email", return_value=True):
            execution = execute_report(db, report)
        assert execution.reporting_period_start.replace(tzinfo=timezone.utc) == custom_start
        assert execution.reporting_period_end.replace(tzinfo=timezone.utc) == custom_end

    @patch("report_service.send_report_email", return_value=True)
    def test_send_to_all_users_resolves_recipients_dynamically_ignoring_to_recipients(self, mock_send, db):
        sender = create_test_user(db, email="exec_sender5@t.com", role="SDR", google_id="exec-5")
        create_test_user(db, email="teammate@t.com", role="SDR", google_id="exec-6")
        report = _make_report(
            db, sender_user_id=sender.id, to_recipients="[]",
            components='["release_digest"]', send_to_all_users=True,
        )
        execution = execute_report(db, report)
        assert execution.status == "sent"
        sent_to = mock_send.call_args.args[2]
        assert set(sent_to) == {"exec_sender5@t.com", "teammate@t.com"}
