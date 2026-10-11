"""
Tests for Smart Analytics — backend/tests/test_smart_analytics.py
=================================================================
Target: 90%+ coverage of services/smart_analytics.py and routes/smart_analytics_routes.py

Covers:
  - DSL validation (all metrics, dimensions, periods, edge cases)
  - Period resolution
  - Chart type mapping
  - Permission enforcement (Pod Admin scoping, Super Admin all-access)
  - Saved reports CRUD
  - Query history
  - Malformed LLM output handling
  - Caching logic
  - Pod-only comparison enforcement
  - Empty result sets
  - Unknown metrics rejection
"""

import json
import time
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

import models
from conftest import create_test_user, create_test_lead, create_test_pod
from services.smart_analytics import (
    validate_dsl,
    _resolve_period,
    _chart_type_for,
    _extract_funnel_metric,
    _sdr_table_column,
    _trend_column,
    _normalise_query,
    _q_conversion_rate,
    SmartAnalyticsError,
    SUPPORTED_METRICS,
    SUPPORTED_DIMENSIONS,
    SUPPORTED_PERIODS,
    _fetch_best_groq_model,
    _resolve_groq_model,
    parse_nl_to_dsl,
)


# ─── _fetch_best_groq_model ───────────────────────────────────────────────────

class TestFetchBestGroqModel:
    """RCA 2026-08-20: every entry in _GROQ_MODEL_PREFERENCE had been
    deprecated on a real account, so the fallback ran for real and its bare
    "llama" in mid substring check picked meta-llama/llama-prompt-guard-2-22m
    -- a safety classifier, not a chat model -- silently breaking every
    ai-research and analytics call that resolved through it."""

    def _mock_models_response(self, ids):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"data": [{"id": mid} for mid in ids]}
        return resp

    def test_picks_a_preferred_model_when_available(self):
        with patch("services.smart_analytics.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.get.return_value = \
                self._mock_models_response(["llama-3.1-8b-instant", "meta-llama/llama-prompt-guard-2-22m"])
            assert _fetch_best_groq_model("sk-fake") == "llama-3.1-8b-instant"

    def test_excludes_a_guard_model_from_the_fallback(self):
        # None of _GROQ_MODEL_PREFERENCE's entries are available -- only a
        # guard model and a genuine (unlisted) chat model are.
        with patch("services.smart_analytics.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.get.return_value = \
                self._mock_models_response(["meta-llama/llama-prompt-guard-2-22m", "llama-4-scout-17b"])
            assert _fetch_best_groq_model("sk-fake") == "llama-4-scout-17b"

    def test_returns_none_when_only_a_guard_model_is_available(self):
        with patch("services.smart_analytics.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.get.return_value = \
                self._mock_models_response(["meta-llama/llama-prompt-guard-2-22m"])
            assert _fetch_best_groq_model("sk-fake") is None

    def test_exclude_skips_a_model_confirmed_dead_this_request(self):
        # RCA 2026-08-20 (live): Groq's /models listing can claim a model is
        # available when it's actually already been pulled from inference --
        # confirmed with llama-3.3-70b-versatile, which kept showing up here
        # and 404ing on every actual completion call. Without `exclude`,
        # retrying after that 404 just re-picks the same broken entry.
        with patch("services.smart_analytics.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.get.return_value = \
                self._mock_models_response(["llama-3.3-70b-versatile", "llama-3.1-70b-versatile"])
            assert _fetch_best_groq_model("sk-fake") == "llama-3.3-70b-versatile"
            assert _fetch_best_groq_model("sk-fake", exclude=frozenset({"llama-3.3-70b-versatile"})) == "llama-3.1-70b-versatile"

    def test_stops_trusting_the_preference_order_once_something_already_failed(self):
        # 2026-09-01 (live): llama-3.1-8b-instant, llama3-8b-8192, and
        # llama-3.3-70b-versatile all showed up in /models as "available"
        # and then ALL THREE 404'd as decommissioned on the real completions
        # endpoint, one after another -- exhausting the caller's entire
        # 3-attempt retry budget without ever reaching a model outside the
        # curated preference list. Once `exclude` is non-empty (something
        # already failed for real this request), the curated order must
        # stop being authoritative -- a genuinely live model outside the
        # list should be reachable after just ONE exclude, not after
        # exhausting every remaining preference entry first.
        with patch("services.smart_analytics.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.get.return_value = \
                self._mock_models_response([
                    "llama-3.1-8b-instant",   # still in the preference list, Groq still lists it
                    "llama3-8b-8192",         # ditto
                    "brand-new-groq-model",   # not in the curated preference list at all
                ])
            result = _fetch_best_groq_model("sk-fake", exclude=frozenset({"llama-3.3-70b-versatile"}))
        assert result == "brand-new-groq-model"


# ─── _resolve_groq_model ──────────────────────────────────────────────────────

class TestResolveGroqModelFallback:
    """RCA 2026-08-20 (live, round 2): the last-resort fallback used to
    hardcode a single model name, reintroducing the exact model `exclude`
    was just told to avoid whenever live discovery found nothing else --
    so a retry after a decommissioned-model error got the same model back
    and silently gave up instead of retrying with something new."""

    def test_fallback_skips_an_excluded_model_and_picks_the_next_preferred(self):
        db = MagicMock()
        db.query.return_value.first.return_value = None
        with patch("services.smart_analytics._fetch_best_groq_model", return_value=None):
            model = _resolve_groq_model(
                "sk-fake", db, force_refresh=True, exclude=frozenset({"gemma2-9b-it"}),
            )
        assert model is not None
        assert model != "gemma2-9b-it"

    def test_fallback_returns_none_when_every_preference_entry_is_excluded(self):
        from services.smart_analytics import _GROQ_MODEL_PREFERENCE
        db = MagicMock()
        db.query.return_value.first.return_value = None
        with patch("services.smart_analytics._fetch_best_groq_model", return_value=None):
            model = _resolve_groq_model(
                "sk-fake", db, force_refresh=True, exclude=frozenset(_GROQ_MODEL_PREFERENCE),
            )
        assert model is None


class TestParseNlToDslModelRetry:
    """RCA 2026-08-20 (live, round 2): mirrors ai_research_routes.py's fix --
    a single one-shot retry after a decommissioned/not-found 400 wasn't
    enough live, when Groq's /models listing offered a second stale name
    right after the first swap."""

    def test_retries_through_two_stale_models_before_succeeding(self):
        db = MagicMock()
        settings = MagicMock(llm_api_key="sk-fake-key", llm_model="model_1")
        db.query.return_value.first.return_value = settings

        dead_resp_1 = MagicMock(status_code=400, text='{"error":{"message":"model_1 does not exist"}}')
        dead_resp_2 = MagicMock(status_code=400, text='{"error":{"message":"model_2 has been decommissioned"}}')
        success_resp = MagicMock(status_code=200)
        success_resp.json.return_value = {
            "choices": [{"message": {"content": '{"metric": "connect_rate", "dimension": "sdr", "period": "last_7_days"}'}}]
        }

        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.post.side_effect = [dead_resp_1, dead_resp_2, success_resp]

        with patch("services.smart_analytics.httpx.Client", return_value=mock_client), \
             patch("services.smart_analytics._resolve_groq_model", side_effect=["model_2", "model_3"]) as mock_resolve, \
             patch("services.smart_analytics._dsl_get", return_value=None), \
             patch("services.smart_analytics._dsl_set"):
            result = parse_nl_to_dsl("show me connect rate by sdr", db)

        assert result["metric"] == "connect_rate"
        assert mock_resolve.call_count == 2
        assert mock_resolve.call_args_list[0].kwargs["exclude"] == frozenset({"model_1"})
        assert mock_resolve.call_args_list[1].kwargs["exclude"] == frozenset({"model_1", "model_2"})
        assert mock_client.post.call_count == 3


# ─── Fixtures ─────────────────────────────────────────────────────────────────

SUPER_ADMIN_USER = {
    "sub":   "user-super-1",
    "id":    "user-super-1",
    "email": "admin@test.com",
    "name":  "Super Admin",
    "role":  "Super Admin",
    "pod_id": None,
}

POD_ADMIN_USER = {
    "sub":   "user-pod-1",
    "id":    "user-pod-1",
    "email": "podadmin@test.com",
    "name":  "Pod Admin",
    "role":  "Pod Admin",
    "pod_id": "pod-001",
}


# ─── DSL Validation Tests ─────────────────────────────────────────────────────

class TestValidateDsl:
    def test_valid_full_dsl(self):
        """All fields valid — should not raise."""
        validate_dsl({
            "metric": "meetings_scheduled",
            "group_by": "sdr",
            "period": "this_month",
            "sort": "desc",
            "limit": 10,
        })

    def test_valid_minimal_dsl(self):
        """Only metric required."""
        validate_dsl({"metric": "calls_made"})

    def test_all_supported_metrics(self):
        """Every supported metric should pass validation."""
        for metric in SUPPORTED_METRICS:
            validate_dsl({"metric": metric})

    def test_all_supported_dimensions(self):
        """Every supported dimension should pass validation."""
        for dim in SUPPORTED_DIMENSIONS:
            validate_dsl({"metric": "calls_made", "group_by": dim})

    def test_all_supported_periods(self):
        """Every supported period should pass validation."""
        for period in SUPPORTED_PERIODS:
            validate_dsl({"metric": "calls_made", "period": period})

    def test_missing_metric_converts_to_clarify(self):
        """validate_dsl is lenient — missing metric becomes a clarify action, not a 422."""
        dsl = {"group_by": "sdr"}
        validate_dsl(dsl)
        assert dsl.get("action") == "clarify"

    def test_unsupported_metric_converts_to_clarify(self):
        """Unknown metric becomes clarify, not a raise."""
        dsl = {"metric": "churn_rate"}
        validate_dsl(dsl)
        assert dsl.get("action") == "clarify"

    def test_unsupported_dimension_silently_dropped(self):
        """Unknown group_by is silently removed — no raise."""
        dsl = {"metric": "calls_made", "group_by": "country"}
        validate_dsl(dsl)
        assert "group_by" not in dsl

    def test_unsupported_period_silently_dropped(self):
        """Unknown period is silently removed — no raise."""
        dsl = {"metric": "calls_made", "period": "last_year"}
        validate_dsl(dsl)
        assert "period" not in dsl

    def test_invalid_sort_defaults_to_desc(self):
        """Invalid sort value is defaulted to 'desc' — no raise."""
        dsl = {"metric": "calls_made", "sort": "random"}
        validate_dsl(dsl)
        assert dsl["sort"] == "desc"

    def test_clarify_action_passes_through(self):
        """Clarify actions bypass allowlist validation."""
        validate_dsl({"action": "clarify", "question": "What period?"})

    def test_unsupported_action_passes_through(self):
        """Unsupported actions bypass allowlist validation."""
        validate_dsl({"action": "unsupported", "message": "Churn is not tracked."})


# ─── Period Resolution Tests ──────────────────────────────────────────────────

class TestResolvePeriod:
    def test_last_7_days(self):
        from datetime import timedelta
        result = _resolve_period("last_7_days")   # (start, end) tuple
        start, end = result
        assert (end - start).days >= 6

    def test_last_30_days(self):
        from datetime import timedelta
        start, end = _resolve_period("last_30_days")
        assert (end - start).days >= 29

    def test_today_returns_same_from_to(self):
        start, end = _resolve_period("today")
        assert start.date() == end.date()

    def test_yesterday(self):
        from datetime import datetime, timezone, timedelta
        start, end = _resolve_period("yesterday")
        expected = (datetime.now(timezone.utc) - timedelta(days=1)).date()
        assert start.date() == expected
        assert end.date() == expected

    def test_this_month_starts_on_first(self):
        start, end = _resolve_period("this_month")
        assert start.day == 1

    def test_this_week_starts_on_monday(self):
        from datetime import datetime, timezone, timedelta
        start, end = _resolve_period("this_week")
        assert start.weekday() == 0   # Monday

    def test_this_year_starts_on_jan_1(self):
        start, end = _resolve_period("this_year")
        assert start.month == 1 and start.day == 1

    def test_this_quarter_valid(self):
        start, end = _resolve_period("this_quarter")
        assert start is not None and end is not None
        assert start < end

    def test_none_period_returns_last_30_days(self):
        """None period now defaults to last_30_days."""
        from datetime import timedelta
        start, end = _resolve_period(None)
        assert (end - start).days >= 29


# ─── Chart Type Tests ─────────────────────────────────────────────────────────

class TestChartType:
    def test_sdr_group_is_bar(self):
        assert _chart_type_for({"metric": "calls_made", "group_by": "sdr"}) == "bar"

    def test_pod_group_is_bar(self):
        assert _chart_type_for({"metric": "calls_made", "group_by": "pod"}) == "bar"

    def test_day_group_is_line(self):
        assert _chart_type_for({"metric": "calls_made", "group_by": "day"}) == "line"

    def test_week_group_is_line(self):
        assert _chart_type_for({"metric": "calls_made", "group_by": "week"}) == "line"

    def test_month_group_is_line(self):
        assert _chart_type_for({"metric": "calls_made", "group_by": "month"}) == "line"

    def test_no_group_is_table(self):
        assert _chart_type_for({"metric": "calls_made"}) == "table"

    def test_source_group_is_bar(self):
        assert _chart_type_for({"metric": "leads_created", "group_by": "source"}) == "bar"


# ─── Funnel Metric Extraction ─────────────────────────────────────────────────

class TestExtractFunnelMetric:
    def _sample_funnel(self):
        return {
            "leads_assigned": 150,
            "research": {"complete": 80, "complete_pct": 53.3},
            "emails": {"sent": 200, "opened": 50},
            "calls": {"made": 300, "connected": 60},
            "connect_rate": 20.0,
            "meetings": {"booked": 25, "no_shows": 3, "conversion_pct": 16.7},
            "disqualified": 10,
            "opportunity": {"won": 5, "lost": 2},
        }

    def test_leads_created(self):
        assert _extract_funnel_metric(self._sample_funnel(), "leads_created") == 150

    def test_meetings_scheduled(self):
        assert _extract_funnel_metric(self._sample_funnel(), "meetings_scheduled") == 25

    def test_calls_made(self):
        assert _extract_funnel_metric(self._sample_funnel(), "calls_made") == 300

    def test_emails_sent(self):
        assert _extract_funnel_metric(self._sample_funnel(), "emails_sent") == 200

    def test_conversion_rate(self):
        assert _extract_funnel_metric(self._sample_funnel(), "conversion_rate") == 16.7

    def test_research_completed(self):
        assert _extract_funnel_metric(self._sample_funnel(), "research_completed") == 80

    def test_no_shows(self):
        assert _extract_funnel_metric(self._sample_funnel(), "no_shows") == 3

    def test_disqualified(self):
        assert _extract_funnel_metric(self._sample_funnel(), "disqualified") == 10


# ─── Column Mappers ───────────────────────────────────────────────────────────

class TestColumnMappers:
    def test_sdr_table_meetings(self):
        assert _sdr_table_column("meetings_scheduled") == "meetings"

    def test_sdr_table_calls(self):
        assert _sdr_table_column("calls_made") == "calls"

    def test_sdr_table_emails(self):
        assert _sdr_table_column("emails_sent") == "emails_sent"

    def test_trend_calls(self):
        assert _trend_column("calls_made") == "calls"

    def test_trend_meetings(self):
        assert _trend_column("meetings_scheduled") == "meetings"

    def test_trend_emails(self):
        assert _trend_column("emails_sent") == "emails"


# ─── Query Normalisation ──────────────────────────────────────────────────────

class TestNormaliseQuery:
    def test_lowercases(self):
        assert _normalise_query("Show Meetings") == "show meetings"

    def test_collapses_whitespace(self):
        assert _normalise_query("show   meetings  by  sdr") == "show meetings by sdr"

    def test_strips(self):
        assert _normalise_query("  show meetings  ") == "show meetings"


# ─── API Route Tests (with TestClient) ───────────────────────────────────────

@pytest.fixture
def client(db):
    """TestClient wired to in-memory DB, auth overridden to Super Admin."""
    from tests.conftest import _build_test_app
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin, require_pod_admin_or_above

    app = _build_test_app()

    def _override_db():
        yield db

    app.dependency_overrides[get_db]                       = _override_db
    app.dependency_overrides[get_current_user]             = lambda: SUPER_ADMIN_USER
    app.dependency_overrides[require_admin]                = lambda: SUPER_ADMIN_USER
    app.dependency_overrides[require_super_admin]          = lambda: SUPER_ADMIN_USER
    app.dependency_overrides[require_pod_admin_or_above]   = lambda: SUPER_ADMIN_USER

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture
def pod_admin_client(db):
    """TestClient wired to in-memory DB, auth overridden to Pod Admin."""
    from tests.conftest import _build_test_app
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin, require_pod_admin_or_above

    app = _build_test_app()

    def _override_db():
        yield db

    def _deny_super():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Super Admin access required")

    app.dependency_overrides[get_db]                       = _override_db
    app.dependency_overrides[get_current_user]             = lambda: POD_ADMIN_USER
    app.dependency_overrides[require_admin]                = lambda: POD_ADMIN_USER
    app.dependency_overrides[require_super_admin]          = _deny_super
    app.dependency_overrides[require_pod_admin_or_above]   = lambda: POD_ADMIN_USER

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c

    app.dependency_overrides.clear()


class TestQueryEndpoint:
    def test_empty_query_rejected(self, client):
        resp = client.post("/api/admin/smart-analytics/query", json={"query": ""})
        assert resp.status_code == 400

    def test_query_too_long_rejected(self, client):
        resp = client.post("/api/admin/smart-analytics/query", json={"query": "x" * 501})
        assert resp.status_code == 400

    @patch("routes.smart_analytics_routes.parse_nl_to_dsl")
    def test_clarify_response_returned_as_is(self, mock_parse, client):
        mock_parse.return_value = {"action": "clarify", "question": "What time period?"}
        resp = client.post("/api/admin/smart-analytics/query", json={"query": "show meetings"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "clarify"
        assert "time period" in data["question"].lower()

    @patch("routes.smart_analytics_routes.parse_nl_to_dsl")
    def test_unsupported_response_returned_as_is(self, mock_parse, client):
        mock_parse.return_value = {"action": "unsupported", "message": "Churn is not tracked."}
        resp = client.post("/api/admin/smart-analytics/query", json={"query": "show churn"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "unsupported"

    @patch("routes.smart_analytics_routes.parse_nl_to_dsl")
    def test_invalid_metric_in_dsl_clarified(self, mock_parse, client):
        """validate_dsl is lenient — unknown metric becomes clarify, route returns 200."""
        mock_parse.return_value = {"metric": "sql_injection_attempt"}
        resp = client.post("/api/admin/smart-analytics/query", json={"query": "show sql"})
        assert resp.status_code == 200
        assert resp.json().get("action") == "clarify"

    @patch("routes.smart_analytics_routes.parse_nl_to_dsl")
    @patch("routes.smart_analytics_routes.execute_dsl")
    def test_successful_query_returns_result(self, mock_execute, mock_parse, client):
        mock_parse.return_value = {"metric": "calls_made", "period": "this_month"}
        mock_execute.return_value = {
            "data": [{"label": "calls_made", "value": 300}],
            "chart_type": "table",
            "metric": "calls_made",
            "period": "this_month",
            "group_by": None,
            "meta": {"cached": False},
        }
        resp = client.post("/api/admin/smart-analytics/query",
                           json={"query": "how many calls this month"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["metric"] == "calls_made"
        assert data["chart_type"] == "table"
        assert len(data["data"]) == 1

    @patch("routes.smart_analytics_routes.parse_nl_to_dsl")
    def test_llm_not_configured_returns_422(self, mock_parse, client):
        mock_parse.side_effect = SmartAnalyticsError(
            "AI query parsing is not configured.", code="llm_not_configured"
        )
        resp = client.post("/api/admin/smart-analytics/query",
                           json={"query": "show meetings"})
        assert resp.status_code == 422
        assert resp.json()["detail"]["error"] == "llm_not_configured"

    @patch("routes.smart_analytics_routes.parse_nl_to_dsl")
    def test_malformed_llm_response_returns_422(self, mock_parse, client):
        mock_parse.side_effect = SmartAnalyticsError(
            "Could not parse the AI response.", code="invalid_llm_response"
        )
        resp = client.post("/api/admin/smart-analytics/query",
                           json={"query": "gibberish xyz 123"})
        assert resp.status_code == 422


class TestSavedReports:
    def test_save_report_success(self, client):
        resp = client.post("/api/admin/smart-analytics/reports", json={
            "name": "Monthly Meetings by SDR",
            "natural_language_query": "Show meetings by SDR this month",
            "dsl_json": json.dumps({"metric": "meetings_scheduled", "group_by": "sdr", "period": "this_month"}),
            "chart_type": "bar",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Monthly Meetings by SDR"
        assert "id" in data

    def test_save_report_empty_name_rejected(self, client):
        resp = client.post("/api/admin/smart-analytics/reports", json={
            "name": "",
            "natural_language_query": "Show meetings",
            "dsl_json": json.dumps({"metric": "meetings_scheduled"}),
        })
        assert resp.status_code == 400

    def test_save_report_invalid_dsl_json_rejected(self, client):
        resp = client.post("/api/admin/smart-analytics/reports", json={
            "name": "Bad Report",
            "natural_language_query": "Show meetings",
            "dsl_json": "not-json-at-all",
        })
        assert resp.status_code == 400

    def test_save_report_invalid_metric_in_dsl_rejected(self, client):
        """Save route validates DSL strictly — invalid metric DSL must be rejected."""
        resp = client.post("/api/admin/smart-analytics/reports", json={
            "name": "SQL Report",
            "natural_language_query": "show sql",
            "dsl_json": json.dumps({"metric": "DROP TABLE users"}),
        })
        # validate_dsl converts bad metric to clarify — save route must reject clarify DSLs
        assert resp.status_code == 400

    def test_list_reports_returns_array(self, client):
        resp = client.get("/api/admin/smart-analytics/reports")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_delete_nonexistent_report_404(self, client):
        resp = client.delete("/api/admin/smart-analytics/reports/nonexistent-id")
        assert resp.status_code == 404

    def test_run_nonexistent_report_404(self, client):
        resp = client.post("/api/admin/smart-analytics/reports/nonexistent-id/run")
        assert resp.status_code == 404


class TestQueryHistory:
    def test_history_returns_array(self, client):
        resp = client.get("/api/admin/smart-analytics/history")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert len(resp.json()) <= 5


class TestPermissions:
    @patch("routes.smart_analytics_routes.parse_nl_to_dsl")
    def test_pod_admin_cannot_request_cross_pod(self, mock_parse, pod_admin_client):
        """Pod Admin requesting group_by=pod should get permission error."""
        mock_parse.return_value = {"metric": "calls_made", "group_by": "pod"}
        resp = pod_admin_client.post("/api/admin/smart-analytics/query",
                                     json={"query": "compare pods"})
        # Should fail with 422 permission denied
        assert resp.status_code == 422
        assert "Super Admin" in resp.json()["detail"]["message"]

    def test_pod_admin_list_reports_only_sees_own(self, pod_admin_client):
        """Pod Admin should only see their own reports."""
        resp = pod_admin_client.get("/api/admin/smart-analytics/reports")
        assert resp.status_code == 200
        # All returned reports should belong to the pod admin
        for r in resp.json():
            assert r["own"] is True


class TestConversionRatePodScoping:
    """Phase 2 security fix: _q_conversion_rate's scalar (no group_by) branch
    used to make pod and sdr_id mutually exclusive instead of conjunctive when
    sdr_id was set — a Pod Admin naming an SDR from a DIFFERENT pod got that
    SDR's true, unscoped conversion rate instead of an empty/zero result."""

    def test_sdr_from_other_pod_does_not_leak_true_numbers(self, db):
        pod_a = create_test_pod(db, name="Pod A")
        pod_b = create_test_pod(db, name="Pod B")
        sdr_b = create_test_user(db, email="sdrb@test.com", name="SDR B", role="SDR", pod_id=pod_b.id)

        # SDR B has real leads/meetings in Pod B — a Pod Admin of Pod A must
        # never see these numbers by naming SDR B directly.
        lead = create_test_lead(db, email="leakcheck@example.com", pod_id=pod_b.id)
        db.execute(models.lead_assignments.insert().values(user_id=sdr_b.id, lead_id=lead.id))
        db.commit()

        result = _q_conversion_rate(
            db, group_by=None, pod=pod_a.id, sdr_id=sdr_b.id, batch_id=None,
            start=None, end=None, reverse=False, limit=10,
        )
        # Conjunctive pod+sdr filter: SDR B has zero leads in Pod A, so this
        # must be 0%, not SDR B's real (nonzero) org-wide rate.
        assert result == [{"label": "Conversion Rate", "value": 0.0}]

    def test_sdr_from_own_pod_still_works(self, db):
        pod_a = create_test_pod(db, name="Pod A")
        sdr_a = create_test_user(db, email="sdra@test.com", name="SDR A", role="SDR", pod_id=pod_a.id)
        lead = create_test_lead(db, email="ownpod@example.com", pod_id=pod_a.id)
        db.execute(models.lead_assignments.insert().values(user_id=sdr_a.id, lead_id=lead.id))
        db.commit()

        result = _q_conversion_rate(
            db, group_by=None, pod=pod_a.id, sdr_id=sdr_a.id, batch_id=None,
            start=None, end=None, reverse=False, limit=10,
        )
        # 1 lead in scope, 0 meetings — 0%, but must not error/leak on the
        # conjunctive filter for the ordinary same-pod case.
        assert result == [{"label": "Conversion Rate", "value": 0.0}]


class TestSmartAnalyticsError:
    def test_error_has_code_and_message(self):
        err = SmartAnalyticsError("Test message", code="test_code")
        assert err.code == "test_code"
        assert err.user_message == "Test message"
        assert str(err) == "Test message"

    def test_default_code(self):
        err = SmartAnalyticsError("Generic error")
        assert err.code == "invalid_query"


# ─── Pinned Reports Tests ─────────────────────────────────────────────────────

VALID_DSL_JSON = json.dumps({"metric": "meetings_scheduled", "group_by": "sdr", "period": "this_month"})

PINNABLE_REPORT = {
    "name": "Top SDRs by Meetings",
    "natural_language_query": "Top SDRs by meetings this month",
    "dsl_json": VALID_DSL_JSON,
    "chart_type": "bar",
}


class TestPinnedReports:
    """
    Tests for PATCH /reports/{id}/pin and GET /reports/pinned.
    Covers all pin/unpin backend test cases from the implementation plan.
    """

    def _create_report(self, client, overrides=None):
        """Helper: create a saved report and return its id."""
        payload = {**PINNABLE_REPORT, **(overrides or {})}
        resp = client.post("/api/admin/smart-analytics/reports", json=payload)
        assert resp.status_code == 200, f"Failed to create report: {resp.text}"
        return resp.json()["id"]

    def test_pin_own_report(self, client):
        """PATCH /pin {pinned: true} should set is_pinned=True and return 200."""
        report_id = self._create_report(client)
        resp = client.patch(
            f"/api/admin/smart-analytics/reports/{report_id}/pin",
            json={"pinned": True},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_pinned"] is True
        assert data["id"] == report_id

    def test_unpin_own_report(self, client):
        """PATCH /pin {pinned: false} should set is_pinned=False and return 200."""
        report_id = self._create_report(client)
        client.patch(f"/api/admin/smart-analytics/reports/{report_id}/pin", json={"pinned": True})
        resp = client.patch(
            f"/api/admin/smart-analytics/reports/{report_id}/pin",
            json={"pinned": False},
        )
        assert resp.status_code == 200
        assert resp.json()["is_pinned"] is False

    def test_pin_nonexistent_report_returns_404(self, client):
        """Pinning a non-existent report ID returns 404."""
        resp = client.patch(
            "/api/admin/smart-analytics/reports/does-not-exist/pin",
            json={"pinned": True},
        )
        assert resp.status_code == 404

    def test_pin_idempotent(self, client):
        """Pinning an already-pinned report returns 200, no error (EC-6)."""
        report_id = self._create_report(client)
        client.patch(f"/api/admin/smart-analytics/reports/{report_id}/pin", json={"pinned": True})
        resp = client.patch(
            f"/api/admin/smart-analytics/reports/{report_id}/pin",
            json={"pinned": True},
        )
        assert resp.status_code == 200
        assert resp.json()["is_pinned"] is True

    def test_unpin_already_unpinned_idempotent(self, client):
        """Unpinning an already-unpinned report is idempotent (EC-6)."""
        report_id = self._create_report(client)
        resp = client.patch(
            f"/api/admin/smart-analytics/reports/{report_id}/pin",
            json={"pinned": False},
        )
        assert resp.status_code == 200
        assert resp.json()["is_pinned"] is False

    def test_pin_cap_enforced(self, client):
        """Pinning a 6th report returns 400 pin_limit_exceeded (EC-4)."""
        from routes.smart_analytics_routes import PIN_LIMIT
        for i in range(PIN_LIMIT):
            rid = self._create_report(client, {"name": f"Report {i}"})
            r = client.patch(
                f"/api/admin/smart-analytics/reports/{rid}/pin",
                json={"pinned": True},
            )
            assert r.status_code == 200, f"Pinning report {i} failed: {r.text}"

        extra_id = self._create_report(client, {"name": "Report overflow"})
        resp = client.patch(
            f"/api/admin/smart-analytics/reports/{extra_id}/pin",
            json={"pinned": True},
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["error"] == "pin_limit_exceeded"

    def test_get_pinned_reports_empty(self, client):
        """GET /reports/pinned returns empty list when nothing is pinned."""
        resp = client.get("/api/admin/smart-analytics/reports/pinned")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_get_pinned_reports_after_pin(self, client):
        """GET /reports/pinned returns the report after pinning."""
        report_id = self._create_report(client)
        client.patch(f"/api/admin/smart-analytics/reports/{report_id}/pin", json={"pinned": True})
        resp = client.get("/api/admin/smart-analytics/reports/pinned")
        assert resp.status_code == 200
        ids = [r["id"] for r in resp.json()]
        assert report_id in ids

    def test_get_pinned_reports_disappears_after_unpin(self, client):
        """Report no longer appears in pinned list after unpinning."""
        report_id = self._create_report(client)
        client.patch(f"/api/admin/smart-analytics/reports/{report_id}/pin", json={"pinned": True})
        client.patch(f"/api/admin/smart-analytics/reports/{report_id}/pin", json={"pinned": False})
        resp = client.get("/api/admin/smart-analytics/reports/pinned")
        ids = [r["id"] for r in resp.json()]
        assert report_id not in ids

    def test_delete_report_clears_from_pinned_list(self, client):
        """Deleting a pinned report removes it from the pinned list (EC-1)."""
        report_id = self._create_report(client)
        client.patch(f"/api/admin/smart-analytics/reports/{report_id}/pin", json={"pinned": True})
        client.delete(f"/api/admin/smart-analytics/reports/{report_id}")
        resp = client.get("/api/admin/smart-analytics/reports/pinned")
        ids = [r["id"] for r in resp.json()]
        assert report_id not in ids

    def test_pinned_list_ordered_by_pin_order(self, client):
        """Pinned reports are returned in pin_order ASC."""
        for i in range(3):
            rid = self._create_report(client, {"name": f"Ordered Report {i}"})
            client.patch(f"/api/admin/smart-analytics/reports/{rid}/pin", json={"pinned": True})
        resp = client.get("/api/admin/smart-analytics/reports/pinned")
        assert resp.status_code == 200
        orders = [r["pin_order"] for r in resp.json()]
        assert orders == sorted(orders)

    def test_list_reports_includes_is_pinned(self, client):
        """GET /reports returns is_pinned field on every item."""
        self._create_report(client)
        resp = client.get("/api/admin/smart-analytics/reports")
        assert resp.status_code == 200
        for r in resp.json():
            assert "is_pinned" in r

    def test_list_reports_includes_pin_order(self, client):
        """GET /reports returns pin_order field on every item."""
        self._create_report(client)
        resp = client.get("/api/admin/smart-analytics/reports")
        assert resp.status_code == 200
        for r in resp.json():
            assert "pin_order" in r

    def test_new_report_is_not_pinned_by_default(self, client):
        """A freshly saved report has is_pinned=False."""
        report_id = self._create_report(client)
        resp = client.get("/api/admin/smart-analytics/reports")
        reports = {r["id"]: r for r in resp.json()}
        assert reports[report_id]["is_pinned"] is False

    @patch("routes.smart_analytics_routes.execute_dsl")
    def test_rerun_pinned_report_returns_fresh_data(self, mock_execute, client):
        """POST /reports/{id}/run returns current data — used by pinned card refresh."""
        mock_execute.return_value = {
            "data": [{"sdr": "Alice", "value": 12}],
            "chart_type": "bar",
            "metric": "meetings_scheduled",
        }
        report_id = self._create_report(client)
        client.patch(f"/api/admin/smart-analytics/reports/{report_id}/pin", json={"pinned": True})
        resp = client.post(f"/api/admin/smart-analytics/reports/{report_id}/run")
        assert resp.status_code == 200
        assert resp.json()["metric"] == "meetings_scheduled"


class TestCacheSweep:
    """RCA 2026-08-26 (staging OOM): _dsl_cache/_result_cache are keyed on
    high-cardinality inputs (free-text NL queries, dsl+pod+sdr+batch hashes)
    that are rarely re-read after expiry — _cache_get's lazy delete-on-read
    never frees them. _cache_set must sweep expired entries once the store
    crosses the threshold, same shape as cache.py's existing fix."""

    def test_sweep_evicts_expired_entries_once_over_threshold(self):
        from services import smart_analytics as sa

        store, lock = {}, sa.Lock()
        # Fill past the threshold with already-expired entries.
        for i in range(sa._CACHE_SWEEP_THRESHOLD + 1):
            store[f"k{i}"] = (f"v{i}", 0.0)  # expires_at=0 → already expired

        sa._cache_set(store, lock, "new_key", "new_val", ttl=60)

        assert len(store) == 1
        assert store["new_key"][0] == "new_val"

    def test_sweep_keeps_unexpired_entries(self):
        from services import smart_analytics as sa

        store, lock = {}, sa.Lock()
        store["fresh"] = ("still_good", time.time() + 3600)
        for i in range(sa._CACHE_SWEEP_THRESHOLD + 1):
            store[f"k{i}"] = (f"v{i}", 0.0)

        sa._cache_set(store, lock, "new_key", "new_val", ttl=60)

        assert "fresh" in store
        assert store["fresh"][0] == "still_good"
