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

    def test_uuid_starting_with_digits_normalised(self):
        """Most uuid4s start with digits; the numeric rule used to run first and
        cut them to "/{id}b8b-…", giving every lead its own stats key."""
        from middleware.timing import _endpoint_key
        assert _endpoint_key("GET", "/api/leads/16676b8b-265e-40eb-a27f-cd6a048367a8/tasks") == \
            "GET /api/leads/{id}/tasks"

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


# ── ASGI-level bypass for the SSE route (RCA 2026-08-19) ──────────────────────
# BaseHTTPMiddleware.call_next buffers the downstream ASGI response through an
# in-memory stream; a client disconnect mid-StreamingResponse (the SSE route)
# leaves it empty and Starlette raises "RuntimeError: No response returned."
# on every disconnect. The fix bypasses BaseHTTPMiddleware.__call__ entirely
# for the SSE path — verify that bypass actually fires, and only for that path.
class TestSSEBypass:
    def test_sse_path_calls_app_directly(self):
        calls = []

        async def dummy_app(scope, receive, send):
            calls.append(scope["path"])

        mw = TimingMiddleware(dummy_app)
        scope = {"type": "http", "path": "/api/calls/events"}
        asyncio.get_event_loop().run_until_complete(mw(scope, None, None))
        assert calls == ["/api/calls/events"], \
            "SSE path must bypass BaseHTTPMiddleware.__call__ via self.app directly"

    def test_other_paths_go_through_base_http_middleware(self):
        from unittest.mock import AsyncMock, patch

        async def dummy_app(scope, receive, send):
            pass

        mw = TimingMiddleware(dummy_app)
        scope = {"type": "http", "path": "/api/leads"}
        with patch(
            "starlette.middleware.base.BaseHTTPMiddleware.__call__",
            new_callable=AsyncMock,
        ) as mock_super_call:
            asyncio.get_event_loop().run_until_complete(mw(scope, None, None))
            mock_super_call.assert_awaited_once()

    def test_cache_header_middleware_bypasses_sse_path(self):
        from middleware_cache_headers import CacheHeaderMiddleware

        calls = []

        async def dummy_app(scope, receive, send):
            calls.append(scope["path"])

        mw = CacheHeaderMiddleware(dummy_app)
        scope = {"type": "http", "path": "/api/calls/events"}
        asyncio.get_event_loop().run_until_complete(mw(scope, None, None))
        assert calls == ["/api/calls/events"]


# ── GZip bypass for the SSE route (RCA 2026-08-21) ────────────────────────────
# Starlette's GZipMiddleware wraps every streamed chunk in a persistent zlib
# compressor with no explicit per-chunk flush, so a small SSE "data: {...}"
# event routinely produces zero compressed output bytes until enough data
# piles up — the outcome-modal SSE fast path was silently sitting behind this,
# always falling through to the 10-20s poll. Verify the SSE path skips
# GZipMiddleware entirely (gzip is applied to the raw app, not our responder),
# and that every other path still goes through gzip as before.
class TestSSEGZipBypass:
    def test_sse_path_bypasses_gzip(self):
        from main import _SSEAwareGZipMiddleware

        calls = []

        async def dummy_app(scope, receive, send):
            calls.append(scope["path"])

        mw = _SSEAwareGZipMiddleware(dummy_app, minimum_size=500)
        scope = {"type": "http", "path": "/api/calls/events", "headers": []}
        asyncio.get_event_loop().run_until_complete(mw(scope, None, None))
        assert calls == ["/api/calls/events"], \
            "SSE path must bypass GZipMiddleware entirely — small streamed " \
            "chunks get buffered indefinitely by zlib otherwise"

    def test_other_paths_still_go_through_gzip(self):
        from unittest.mock import AsyncMock, patch
        from main import _SSEAwareGZipMiddleware

        async def dummy_app(scope, receive, send):
            pass

        mw = _SSEAwareGZipMiddleware(dummy_app, minimum_size=500)
        scope = {"type": "http", "path": "/api/leads", "headers": []}
        with patch(
            "starlette.middleware.gzip.GZipMiddleware.__call__",
            new_callable=AsyncMock,
        ) as mock_super_call:
            asyncio.get_event_loop().run_until_complete(mw(scope, None, None))
            mock_super_call.assert_awaited_once()


class TestPerfWriter:
    def test_writes_go_to_the_shared_pool_and_skip_past_the_cap(self, monkeypatch):
        """RCA 2026-10-06: a new OS thread per request fed the staging OOM —
        writes now go to one long-lived pool, and are skipped (not queued
        without limit) once the cap of queued + running writes is reached."""
        import threading
        from middleware import timing
        submitted = []

        class Pool:
            def submit(self, fn, *args):
                submitted.append(args)

        monkeypatch.setattr(timing, "_perf_writer", Pool())
        monkeypatch.setattr(timing, "_perf_write_semaphore", threading.Semaphore(2))
        threads_before = threading.active_count()
        for i in range(3):
            timing._submit_perf_metric("GET /x", "GET", i, "OK", 200)
        assert len(submitted) == 2              # third skipped: cap reached, nothing released
        assert threading.active_count() == threads_before
