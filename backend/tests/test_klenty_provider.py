"""
Unit tests for KlentyDialerProvider — the pull-only Klenty call-activity
provider (temporary bridging integration, see docs/RELEASES.md).
"""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pytest

from klenty_provider import KlentyDialerProvider
from dialer_provider import CallEventType


SAMPLE_CALL = {
    "username": "vanshika.koli@screen-magic.com",
    "status": "COMPLETED",
    "callSid": "CAabc123",
    "disposition": "ANSWERED",
    "type": "OUTBOUND",
    "duration": 87,
    "startTime": "2026-07-01T10:00:00.000Z",
    "endTime": "2026-07-01T10:01:27.000Z",
    "prospectPhoneNo": "+17135241010",
    "fromNumber": "+14159806499",
    "toNumber": "+17135241010",
    "firstName": "Jim",
    "lastName": "Slaton",
    "email": "jim@texasdwilaw.com",
    "company": "Trident University International",
    "tags": [],
    "list": "Q3 outreach",
    "prospectOwner": "vanshika.koli@screen-magic.com",
}


class TestNormalizeCall:
    def test_maps_core_fields(self):
        provider = KlentyDialerProvider(api_key="test-key")
        event = provider._normalize_call(SAMPLE_CALL)

        assert event.provider == "klenty"
        assert event.provider_call_id == "CAabc123"
        assert event.phone_number == "+17135241010"
        assert event.direction == "outbound"
        assert event.duration == 87
        assert event.event_type == CallEventType.CALL_ENDED

    def test_parses_timestamps_with_z_suffix(self):
        """Klenty timestamps end in 'Z' — must parse without the same bug
        found in call_routes.py's meeting_datetime handling (RCA-2026-07-17)."""
        provider = KlentyDialerProvider(api_key="test-key")
        event = provider._normalize_call(SAMPLE_CALL)

        assert event.started_at is not None
        assert event.started_at.year == 2026 and event.started_at.month == 7 and event.started_at.day == 1
        assert event.ended_at is not None

    def test_stores_full_raw_payload(self):
        provider = KlentyDialerProvider(api_key="test-key")
        event = provider._normalize_call(SAMPLE_CALL)
        assert event.raw_payload == SAMPLE_CALL
        assert event.raw_payload["disposition"] == "ANSWERED"

    def test_user_email_only_set_when_username_looks_like_email(self):
        provider = KlentyDialerProvider(api_key="test-key")
        event = provider._normalize_call(SAMPLE_CALL)
        assert event.user_email == "vanshika.koli@screen-magic.com"

        no_email = {**SAMPLE_CALL, "username": "not-an-email"}
        event2 = provider._normalize_call(no_email)
        assert event2.user_email is None

    def test_missing_call_sid_becomes_empty_string_not_crash(self):
        provider = KlentyDialerProvider(api_key="test-key")
        event = provider._normalize_call({**SAMPLE_CALL, "callSid": None})
        assert event.provider_call_id == ""

    def test_null_start_time_falls_back_to_end_time(self):
        """RCA 2026-08-03: some Klenty records have startTime: null (a call
        that errored before ever "starting") but a real endTime. Without this
        fallback, started_at ends up None and dialer_call_event_time() falls
        through to created_at (sync time) — misattributing the call to
        whatever day the backfill happened to run."""
        provider = KlentyDialerProvider(api_key="test-key")
        no_start = {**SAMPLE_CALL, "startTime": None}
        event = provider._normalize_call(no_start)
        assert event.started_at is not None
        assert event.started_at.year == 2026 and event.started_at.month == 7 and event.started_at.day == 1
        assert event.started_at == event.ended_at


class TestFetchCallsPaginated:
    """
    LIVE-TESTED 2026-07-29 against the real Klenty API: the real constraint
    is "startDate can't be more than 29 days before today" (error K2002) —
    NOT a span limit between from_date/to_date as originally assumed. The
    real success shape is {"status": true, "data": {"callData": [...],
    "hasMore": bool}} — "calls"/"hasMore" nested under "data", not top-level.
    """

    def test_rejects_start_date_more_than_29_days_before_today(self):
        provider = KlentyDialerProvider(api_key="test-key")
        too_old = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with pytest.raises(ValueError, match="29 days"):
            provider.fetch_calls_paginated("vanshika.koli@screen-magic.com", too_old, today)

    def test_accepts_start_date_within_29_days(self):
        provider = KlentyDialerProvider(api_key="test-key")
        from_date = (datetime.now(timezone.utc) - timedelta(days=25)).strftime("%Y-%m-%d")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        api_response = {"status": True, "data": {"callData": [SAMPLE_CALL], "hasMore": True}}
        with patch.object(provider, "_get", return_value=api_response) as mock_get:
            result = provider.fetch_calls_paginated("vanshika.koli@screen-magic.com", from_date, today, page=2)

        assert result["calls"] == [SAMPLE_CALL]
        assert result["has_more"] is True
        assert result["page"] == 2
        called_path = mock_get.call_args[0][0]
        assert called_path == "/user/vanshika.koli@screen-magic.com/calls"
        called_params = mock_get.call_args.kwargs["params"]
        assert called_params == {"startDate": from_date, "endDate": today, "page": "2"}

    def test_has_more_false_when_no_more_pages(self):
        provider = KlentyDialerProvider(api_key="test-key")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        api_response = {"status": True, "data": {"callData": [], "hasMore": False}}
        with patch.object(provider, "_get", return_value=api_response):
            result = provider.fetch_calls_paginated("x@y.com", today, today)
        assert result["has_more"] is False
        assert result["calls"] == []

    def test_no_records_found_response_becomes_empty_not_a_crash(self):
        """Klenty's real 'nothing matched' shape is {"status": false,
        "errors": [{"code": "K2003", ...}]} with HTTP 200 — must resolve to
        an empty page, not crash trying to read "data" off a non-dict."""
        provider = KlentyDialerProvider(api_key="test-key")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        api_response = {"status": False, "errors": [{"code": "K2003", "errorMessage": "No record found using the current filter"}]}
        with patch.object(provider, "_get", return_value=api_response):
            result = provider.fetch_calls_paginated("x@y.com", today, today)
        assert result["calls"] == []
        assert result["has_more"] is False

    def test_non_k2003_error_code_raises_instead_of_resolving_empty(self):
        """RCA 2026-08-06: a K2002 ("invalid date range") response used to
        resolve to an empty page identically to a genuine K2003 ("nothing
        found") — indistinguishable from an ordinary quiet day. LIVE-TESTED:
        this is exactly what let the nightly sync "succeed" with imported=0
        for 6 straight days while real calls sat unsynced. Only K2003 means
        "valid request, no data" — anything else must raise so the caller's
        existing retry/abort path actually surfaces it."""
        provider = KlentyDialerProvider(api_key="test-key")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        api_response = {"status": False, "errors": [{"code": "K2002", "errorMessage": "Invalid date range , specify a date range within last 30 days"}]}
        with patch.object(provider, "_get", return_value=api_response):
            with pytest.raises(RuntimeError, match="K2002"):
                provider.fetch_calls_paginated("x@y.com", today, today)

    def test_same_day_range_widens_end_date_by_one_and_filters_back_down(self):
        """LIVE-TESTED 2026-08-03: Klenty's endDate filter is exclusive — a
        same-day range (startDate == endDate) always returns K2003 'no
        record found', even on a day with real calls. Widen the request by
        one day so real same-day calls aren't silently lost, but filter the
        response back down to just the requested day."""
        provider = KlentyDialerProvider(api_key="test-key")
        target_day = datetime.now(timezone.utc) - timedelta(days=5)
        day = target_day.strftime("%Y-%m-%d")
        next_day = (target_day + timedelta(days=1)).strftime("%Y-%m-%d")
        this_day_call = {**SAMPLE_CALL, "callSid": "CAthisday",
                          "startTime": target_day.strftime("%Y-%m-%dT10:00:00.000Z"),
                          "endTime": target_day.strftime("%Y-%m-%dT10:01:00.000Z")}
        next_day_call = {**SAMPLE_CALL, "callSid": "CAnextday",
                          "startTime": (target_day + timedelta(days=1)).strftime("%Y-%m-%dT01:00:00.000Z"),
                          "endTime": (target_day + timedelta(days=1)).strftime("%Y-%m-%dT01:01:00.000Z")}
        api_response = {"status": True, "data": {"callData": [this_day_call, next_day_call], "hasMore": False}}
        with patch.object(provider, "_get", return_value=api_response) as mock_get:
            result = provider.fetch_calls_paginated("vanshika.koli@screen-magic.com", day, day)

        called_params = mock_get.call_args.kwargs["params"]
        assert called_params["startDate"] == day
        assert called_params["endDate"] == next_day  # widened by one day
        # Only the call whose startTime actually falls on the requested day survives.
        assert [c["callSid"] for c in result["calls"]] == ["CAthisday"]

    def test_multi_day_range_unaffected_by_widening_logic(self):
        provider = KlentyDialerProvider(api_key="test-key")
        api_response = {"status": True, "data": {"callData": [SAMPLE_CALL], "hasMore": False}}
        with patch.object(provider, "_get", return_value=api_response) as mock_get:
            result = provider.fetch_calls_paginated("vanshika.koli@screen-magic.com", "2026-07-28", "2026-07-29")
        called_params = mock_get.call_args.kwargs["params"]
        assert called_params["endDate"] == "2026-07-29"  # untouched
        assert result["calls"] == [SAMPLE_CALL]


class TestNotOutboundCapable:
    def test_initiate_call_returns_clear_error(self):
        provider = KlentyDialerProvider(api_key="test-key")
        result = provider.initiate_call("+17135241010", "sdr@screen-magic.com", "lead-1")
        assert result.success is False
        assert "not supported" in result.error.lower()

    def test_handle_webhook_always_none(self):
        provider = KlentyDialerProvider(api_key="test-key")
        assert provider.handle_webhook({"anything": "here"}) is None

    def test_get_users_and_numbers_empty(self):
        provider = KlentyDialerProvider(api_key="test-key")
        assert provider.get_users() == []
        assert provider.get_numbers() == []


class TestConnection:
    def test_no_username_fails_without_calling_api(self):
        """RCA 2026-07-22: there is no account-level self-check endpoint —
        Klenty rejects a placeholder username outright ('Invalid user: whoami'),
        so a real username is required rather than a sentinel value."""
        provider = KlentyDialerProvider(api_key="test-key")
        with patch.object(provider, "_get") as mock_get:
            result = provider.test_connection("")
        assert result["success"] is False
        mock_get.assert_not_called()

    def test_real_username_hits_user_scoped_endpoint(self):
        provider = KlentyDialerProvider(api_key="test-key")
        with patch.object(provider, "_get", return_value={}) as mock_get:
            result = provider.test_connection("vanshika.koli@screen-magic.com")
        assert result["success"] is True
        called_path = mock_get.call_args[0][0]
        assert called_path == "/user/vanshika.koli@screen-magic.com/calls"
