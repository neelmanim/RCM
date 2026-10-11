"""
Tests for middleware/timing.py — perf-metric write concurrency cap.

RCA 2026-08-26 (staging OOM): _write_perf_metric fired an unbounded
threading.Thread on every non-excluded request. Same shape as the Nylas
full-mailbox-sync leak (56ce657), but this one fires on ALL traffic —
bounded here with a threading.Semaphore(8), same skip-over-cap pattern.
"""
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from middleware import timing


class _InlinePool:
    """Runs a submitted write immediately — the real pool's threads are kept
    out of tests (conftest), so this is how a write actually runs here."""
    def submit(self, fn, *args):
        fn(*args)


class TestPerfWriteConcurrencyCap:
    """Queued + running perf writes are capped (8); over the cap a write is
    skipped at submit time, and every write that ran gives its permit back."""

    def test_skips_when_over_concurrency_cap(self):
        held = [timing._perf_write_semaphore.acquire(blocking=False) for _ in range(8)]
        assert all(held), "expected exactly 8 permits available"
        try:
            with patch.object(timing, "_perf_writer", _InlinePool()), \
                    patch("database.SessionLocal") as mock_session_local:
                timing._submit_perf_metric("GET /api/leads/{id}", "GET", 42, "OK", 200)
                mock_session_local.assert_not_called()
        finally:
            for _ in held:
                timing._perf_write_semaphore.release()

    def test_releases_permit_after_run_so_next_call_is_not_blocked(self):
        with patch.object(timing, "_perf_writer", _InlinePool()):
            for _ in range(10):   # more than the cap: each run must give its permit back
                with patch("database.SessionLocal") as mock_session_local:
                    timing._submit_perf_metric("GET /api/leads/{id}", "GET", 42, "OK", 200)
                    mock_session_local.return_value.close.assert_called_once()


class TestCriticalTierLogLevel:
    """A slow response and a broken one are not the same event.

    Every request over 1 000 ms was logged at ERROR regardless of outcome, so
    Render's error view filled up with successful 200s — /api/growth-
    intelligence takes ~3 s because it calls an LLM, by design. That noise is
    what a real burst of 17 /api/calls/start 500s sat inside, unnoticed, for
    four days. The CRITICAL tier still goes to perf_metrics either way; only
    the log level follows the status code.
    """

    @staticmethod
    def _dispatch(status: int, duration_s: float = 2.0):
        import asyncio
        from starlette.responses import Response as StarletteResponse

        mw = timing.TimingMiddleware(app=lambda *a, **k: None)

        request = type("Req", (), {
            "method": "GET",
            "url": type("U", (), {"path": "/api/leads/dashboard-stats"})(),
            "headers": {},
            "state": type("S", (), {})(),
        })()

        async def call_next(_req):
            return StarletteResponse(status_code=status)

        # perf_counter is read once before and once after call_next.
        clock = iter([0.0, duration_s])
        with patch("middleware.timing.time.perf_counter", lambda: next(clock)), \
             patch("middleware.timing.threading.Thread"), \
             patch.object(timing.logger, "error") as mock_error, \
             patch.object(timing.logger, "warning") as mock_warning:
            asyncio.run(mw.dispatch(request, call_next))
        return mock_error, mock_warning

    def test_slow_but_successful_request_is_a_warning_not_an_error(self):
        mock_error, mock_warning = self._dispatch(200)
        mock_error.assert_not_called()
        assert mock_warning.call_count == 1
        assert "P=CRITICAL" in mock_warning.call_args[0][0]

    def test_slow_server_error_is_still_an_error(self):
        mock_error, mock_warning = self._dispatch(500)
        mock_warning.assert_not_called()
        assert mock_error.call_count == 1
        assert "P=CRITICAL" in mock_error.call_args[0][0]

    def test_a_slow_4xx_is_the_clients_problem_not_an_outage(self):
        mock_error, _ = self._dispatch(404)
        mock_error.assert_not_called()
