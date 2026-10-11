"""Tests for /api/admin/analytics/vnext (Phase 1 Analytics Hub vNext)."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from conftest import (
    create_test_pod,
    create_test_user,
    create_test_lead,
    create_test_dialer_call,
)


def _set(db, obj, **fields):
    for k, v in fields.items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


def test_list_metrics(client):
    resp = client.get("/api/admin/analytics/vnext/metrics")
    assert resp.status_code == 200
    ids = {m["id"] for m in resp.json()["metrics"]}
    assert {
        "connect_rate", "leads_assigned", "account_connect_rate",
        "disqualified", "meetings_scheduled",
    }.issubset(ids)


def test_resolve_known_metric(client, db):
    pod = create_test_pod(db, name="P")
    sdr = create_test_user(db, email="s@t.com", role="SDR", pod_id=pod.id)
    lead = create_test_lead(db, email="l@t.com", pod_id=pod.id)
    create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested")

    resp = client.get("/api/admin/analytics/vnext/metrics/connect_rate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["metric"]["id"] == "connect_rate"
    assert body["value"] == 100.0
    # Super Admin (the default `client` fixture identity) gets the
    # query-implementation pointer; non-admins don't (asserted separately).
    assert "query_implementation" in body["explanation"]


def test_resolve_unknown_metric_returns_error_not_500(client):
    resp = client.get("/api/admin/analytics/vnext/metrics/close_rate")
    assert resp.status_code == 200
    assert resp.json()["error"] == "unknown_metric"


def test_compare_connect_rate_matches_when_no_manual_calls(client, db):
    """With only DialerCall (Aircall) traffic and no manual CallLog rows, the
    legacy scalar and the canonical adapter compute the identical population
    — this is the expected-parity case (docs §20)."""
    pod = create_test_pod(db, name="P")
    sdr = create_test_user(db, email="s@t.com", role="SDR", pod_id=pod.id)
    lead = create_test_lead(db, email="l@t.com", pod_id=pod.id)
    create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested")
    create_test_dialer_call(db, lead.id, sdr.id, outcome="No Answer")

    resp = client.get("/api/admin/analytics/vnext/compare/connect_rate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["match"] is True
    assert body["legacy_value"] == body["vnext_value"] == 50.0


def test_compare_disqualified_shows_expected_difference(client, db):
    """A lead with a legacy outcome-as-status value counts in the legacy
    snapshot but not the canonical event metric — the docs require this
    difference to be surfaced, not hidden."""
    pod = create_test_pod(db, name="P")
    now = datetime.now(timezone.utc)
    legacy_only = create_test_lead(db, email="lo@t.com", pod_id=pod.id, status="Not Interested")
    _set(db, legacy_only, lead_closed_at=now)

    resp = client.get("/api/admin/analytics/vnext/compare/disqualified")
    assert resp.status_code == 200
    body = resp.json()
    assert body["legacy_value"] == 1
    assert body["vnext_value"] == 0
    assert body["match"] is False


def test_pod_admin_scoped_on_vnext_metric_endpoint(client_as_pod_admin, db):
    pod_a = create_test_pod(db, name="A")
    pod_b = create_test_pod(db, name="B")
    _set(db, pod_a, id="test-pod-id")  # matches client_as_pod_admin's pod_id fixture
    sdr_a = create_test_user(db, email="sa@t.com", role="SDR", pod_id=pod_a.id)
    sdr_b = create_test_user(db, email="sb@t.com", role="SDR", pod_id=pod_b.id)
    lead_a = create_test_lead(db, email="la@t.com", pod_id=pod_a.id)
    lead_b = create_test_lead(db, email="lb@t.com", pod_id=pod_b.id)
    create_test_dialer_call(db, lead_a.id, sdr_a.id, outcome="Interested")
    create_test_dialer_call(db, lead_b.id, sdr_b.id, outcome="Interested")

    resp = client_as_pod_admin.get("/api/admin/analytics/vnext/metrics/connect_rate")
    assert resp.status_code == 200
    assert resp.json()["explanation"]["denominator"] == 1


# ─── Ask Analytics ────────────────────────────────────────────────────────

@patch("services.smart_analytics.parse_nl_to_dsl")
def test_ask_rejects_undefined_metric_by_name(mock_parse, client):
    # Simulates the LLM correctly reporting the concept isn't in its metric
    # list, rather than silently substituting a close match (docs §17).
    mock_parse.return_value = {"action": "unsupported", "message": "Close rate is not currently defined."}
    resp = client.post("/api/admin/analytics/vnext/ask", json={"query": "which SDR has the best close rate?"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["unsupported"] is True
    assert body["result"] is None


@patch("services.smart_analytics.parse_nl_to_dsl")
def test_ask_rejects_dimensional_request_explicitly(mock_parse, client):
    mock_parse.return_value = {"mode": "standard", "metric": "connect_rate", "group_by": "pod"}
    resp = client.post("/api/admin/analytics/vnext/ask", json={"query": "connect rate by pod"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["unsupported"] is True


@patch("services.smart_analytics.parse_nl_to_dsl")
def test_ask_resolves_scalar_connect_rate_with_interpretation(mock_parse, client, db):
    pod = create_test_pod(db, name="P")
    sdr = create_test_user(db, email="s@t.com", role="SDR", pod_id=pod.id)
    lead = create_test_lead(db, email="l@t.com", pod_id=pod.id)
    create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested")

    mock_parse.return_value = {"mode": "standard", "metric": "connect_rate", "period": "last_30_days"}
    resp = client.post("/api/admin/analytics/vnext/ask", json={"query": "what's our connect rate?"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["unsupported"] is False
    assert body["interpretation"]["metric"] == "Connect Rate"
    assert body["result"]["value"] == 100.0


# ─── Ask Analytics: Trend (Phase 6) ──────────────────────────────────────────

@patch("services.smart_analytics.parse_nl_to_dsl")
def test_ask_trend_allows_day_week_month_breakdown(mock_parse, client, db):
    pod = create_test_pod(db, name="P")
    sdr = create_test_user(db, email="s@t.com", role="SDR", pod_id=pod.id)
    lead = create_test_lead(db, email="l@t.com", pod_id=pod.id)
    create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested")

    mock_parse.return_value = {"mode": "standard", "metric": "calls_made", "group_by": "day", "period": "last_30_days"}
    resp = client.post("/api/admin/analytics/vnext/ask", json={"query": "calls made per day"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["unsupported"] is False
    assert body["interpretation"]["group_by"] == "day"
    assert body["result"]["data"]  # at least one bucket
    assert body["result"]["data"][0]["value"] == 1


@patch("services.smart_analytics.parse_nl_to_dsl")
def test_ask_trend_still_rejects_dimensional_group_by(mock_parse, client):
    # sdr/pod/source/status stay rejected — only day/week/month get the carve-out.
    mock_parse.return_value = {"mode": "standard", "metric": "calls_made", "group_by": "sdr"}
    resp = client.post("/api/admin/analytics/vnext/ask", json={"query": "calls made by sdr"})
    assert resp.status_code == 200
    assert resp.json()["unsupported"] is True


@patch("services.smart_analytics.parse_nl_to_dsl")
def test_ask_trend_rejects_metrics_without_a_time_series_branch(mock_parse, client):
    # connect_rate's group_by support is {"sdr"} only — no day/week/month branch exists.
    mock_parse.return_value = {"mode": "standard", "metric": "connect_rate", "group_by": "day"}
    resp = client.post("/api/admin/analytics/vnext/ask", json={"query": "connect rate per day"})
    assert resp.status_code == 200
    assert resp.json()["unsupported"] is True
