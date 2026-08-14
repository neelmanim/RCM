"""
backend/tests/test_middleware.py
──────────────────────────────────────────────────────────────────────────────
Tests for Phase 1 performance observability middleware.
"""

import asyncio
import pytest
import httpx
from fastapi import FastAPI
from unittest.mock import MagicMock

from middleware.timing import (
    _endpoint_key,
    _should_skip,
    record_sample,
    get_percentiles,
    get_all_stats,
    MAX_SAMPLES,
    _samples,
    TimingMiddleware,
)


# ── Minimal ASGI app for header tests ─────────────────────────────────────────
def _make_app():
    app = FastAPI()
    app.add_middleware(TimingMiddleware)

    @app.get("/api/leads")
    def leads():
        return {"leads": []}

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/calls/events")
    def sse():
        return {"stream": "ok"}

    return app


def _hit(path: str, method: str = "GET") -> httpx.Response:
    """Make a real ASGI request through the full middleware stack."""
    app = _make_app()

    async def _run():
        async with httpx.AsyncClient(
            app=app, base_url="http://test"
        ) as client:
            return await client.request(method, path)

    return asyncio.get_event_loop().run_until_complete(_run())


# ── X-Response-Time header ─────────────────────────────────────────────────────
class TestXResponseTimeHeader:
    def test_header_present_on_leads(self):
        r = _hit("/api/leads")
        assert "x-response-time" in r.headers, \
            "X-Response-Time must be set on timed endpoints"

    def test_header_value_ends_with_ms(self):
        r = _hit("/api/leads")
        val = r.headers["x-response-time"]
        assert val.endswith("ms"), f"Expected '<N>ms', got: {val}"
        assert float(val.replace("ms", "")) >= 0

    def test_header_absent_on_health(self):
        r = _hit("/api/health")
        assert "x-response-time" not in r.headers, \
            "/api/health is excluded — should NOT get X-Response-Time"

    def test_header_absent_on_sse(self):
        r = _hit("/api/calls/events")
        assert "x-response-time" not in r.headers, \
            "SSE endpoint is excluded — should NOT get X-Response-Time"


# ── Endpoint key normalisation ─────────────────────────────────────────────────
class TestEndpointKey:
    def test_numeric_id_normalised(self):
        from middleware.timing import _endpoint_key
        assert _endpoint_key("GET", "/api/leads/12345") == "GET /api/leads/{id}"

    def test_uuid_normalised(self):
        from middleware.timing import _endpoint_key
        result = _endpoint_key("GET", "/api/leads/a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert result == "GET /api/leads/{id}"

    def test_non_numeric_not_normalised(self):
        from middleware.timing import _endpoint_key
        assert _endpoint_key("GET", "/api/admin/analytics/funnel") == \
            "GET /api/admin/analytics/funnel"

    def test_method_included_in_key(self):
        from middleware.timing import _endpoint_key
        assert _endpoint_key("POST", "/api/leads") != _endpoint_key("GET", "/api/leads")


# ── Rolling window + percentile functions ─────────────────────────────────────
class TestPercentiles:
    def test_no_data_returns_none(self):
        from middleware.timing import get_percentiles
        result = get_percentiles("GET", "/api/nonexistent-path-xyz")
        assert result is None

    def test_percentiles_after_samples(self):
        from middleware.timing import record_sample, get_percentiles
        # Inject known samples for a test-only path
        for ms in [10, 20, 30, 40, 50, 100, 200, 500, 800, 1000]:
            record_sample("GET", "/api/test-perf-path", ms)
        result = get_percentiles("GET", "/api/test-perf-path")
        assert result is not None
        assert "p50" in result
        assert "p95" in result
        assert "p99" in result
        assert "n" in result
        assert result["n"] >= 10
        assert result["p99"] >= result["p95"] >= result["p50"]

    def test_rolling_window_bounded(self):
        from middleware.timing import record_sample, get_percentiles, MAX_SAMPLES, _endpoint_key, _samples
        path = "/api/test-window-bound"
        for i in range(MAX_SAMPLES + 500):
            record_sample("GET", path, float(i))
        key = _endpoint_key("GET", path)
        from middleware.timing import _samples
        assert len(_samples[key]) == MAX_SAMPLES, \
            "Rolling window must be bounded at MAX_SAMPLES"


# ── get_all_stats ──────────────────────────────────────────────────────────────
class TestGetAllStats:
    def test_returns_list(self):
        from middleware.timing import get_all_stats
        result = get_all_stats()
        assert isinstance(result, list)

    def test_sorted_by_p95_desc(self):
        from middleware.timing import get_all_stats, record_sample
        # Inject a high-latency endpoint
        for _ in range(20):
            record_sample("GET", "/api/test-slow-endpoint", 999.0)
        result = get_all_stats()
        p95_values = [r["p95_ms"] for r in result]
        assert p95_values == sorted(p95_values, reverse=True), \
            "get_all_stats must be sorted by P95 descending"

    def test_each_entry_has_required_fields(self):
        from middleware.timing import get_all_stats
        for entry in get_all_stats():
            for field in ("endpoint", "p50_ms", "p95_ms", "p99_ms", "max_ms", "mean_ms", "samples"):
                assert field in entry, f"Missing field: {field}"
