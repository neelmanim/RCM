# ── middleware/query_profiler.py — SQL query counter per request ──────────────
#
# Opt-in middleware that counts SQL statements per request and logs
# requests exceeding a configurable threshold.
#
# Enable via environment variable: QUERY_PROFILING=true
# Configure thresholds:
#   QUERY_WARN_COUNT=20   — warn when request exceeds this many queries
#   QUERY_WARN_MS=500     — warn when total SQL time exceeds this (ms)
#
# In staging, also adds response headers:
#   X-Query-Count: <n>
#   X-Query-Time-Ms: <ms>
#
# Usage:
#   from middleware.query_profiler import attach_profiler
#   attach_profiler(app, engine)

import os
import time
import logging
import threading
from contextlib import contextmanager

from sqlalchemy import event

logger = logging.getLogger("query_profiler")

# ── Per-request counter (thread-local) ───────────────────────────────────────
_local = threading.local()


def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    """SQLAlchemy event: fired before every SQL statement."""
    if not getattr(_local, "active", False):
        return
    _local.query_count = getattr(_local, "query_count", 0) + 1
    _local.query_start = time.perf_counter()


def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    """SQLAlchemy event: fired after every SQL statement."""
    if not getattr(_local, "active", False):
        return
    elapsed = (time.perf_counter() - getattr(_local, "query_start", time.perf_counter())) * 1000
    _local.query_time_ms = getattr(_local, "query_time_ms", 0.0) + elapsed


@contextmanager
def count_queries():
    """Context manager to count queries in a block."""
    _local.active = True
    _local.query_count = 0
    _local.query_time_ms = 0.0
    try:
        yield _local
    finally:
        _local.active = False


def attach_profiler(app, engine):
    """Wire timing + SQLAlchemy observability middleware.

    Always attached (Phase 1 — perf benchmarking initiative):
      • TimingMiddleware  — RAIL-model request timing, X-Response-Time header,
                           P50/P95/P99 rolling window per endpoint.
      • query_logger     — slow SQL logging (> 50ms) + N+1 detection.
                           Set SLOW_QUERY_LOG=true for full per-request trace.

    Opt-in (legacy — requires QUERY_PROFILING=true):
      • QueryProfilingMiddleware — X-Query-Count / X-Query-Time-Ms headers.
    """
    import logging as _logging
    _log = _logging.getLogger(__name__)

    # ── 1. RAIL-model timing (always on) ──────────────────────────────────────
    try:
        from middleware.timing import TimingMiddleware
        app.add_middleware(TimingMiddleware)
        _log.info("[Perf] TimingMiddleware attached — RAIL-model request timing active")
    except Exception as e:
        _log.warning(f"[Perf] TimingMiddleware not attached (non-fatal): {e}")

    # ── 2. Slow-query logger (always on, controlled by SLOW_QUERY_LOG env) ────
    if engine is not None:
        try:
            from query_logger import attach_query_logger
            attach_query_logger(engine)
            _log.info("[Perf] SQLAlchemy query logger attached (threshold=50ms)")
        except Exception as e:
            _log.debug(f"[Perf] Query logger not attached (non-fatal): {e}")

    # ── 3. Legacy QUERY_PROFILING opt-in profiler ─────────────────────────────
    if os.environ.get("QUERY_PROFILING", "").lower() != "true":
        return

    warn_count = int(os.environ.get("QUERY_WARN_COUNT", "20"))
    warn_ms = float(os.environ.get("QUERY_WARN_MS", "500"))
    add_headers = os.environ.get("QUERY_PROFILING_HEADERS", "true").lower() == "true"

    # Register SQLAlchemy event listeners
    event.listen(engine, "before_cursor_execute", _before_cursor_execute)
    event.listen(engine, "after_cursor_execute", _after_cursor_execute)

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request

    class QueryProfilingMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            _local.active = True
            _local.query_count = 0
            _local.query_time_ms = 0.0

            wall_start = time.perf_counter()
            response = await call_next(request)
            wall_ms = (time.perf_counter() - wall_start) * 1000

            count = getattr(_local, "query_count", 0)
            sql_ms = getattr(_local, "query_time_ms", 0.0)
            _local.active = False

            # Add headers (useful for staging debugging)
            if add_headers:
                response.headers["X-Query-Count"] = str(count)
                response.headers["X-Query-Time-Ms"] = f"{sql_ms:.1f}"
                response.headers["X-Wall-Time-Ms"] = f"{wall_ms:.1f}"

            # Log warning for slow/chatty requests
            path = request.url.path
            if count > warn_count or sql_ms > warn_ms:
                logger.warning(
                    "SLOW REQUEST: %s %s — %d queries, %.1f ms SQL, %.1f ms wall",
                    request.method, path, count, sql_ms, wall_ms,
                )

            return response

    app.add_middleware(QueryProfilingMiddleware)
    logger.info("Query profiling ENABLED (warn: >%d queries or >%.0f ms)", warn_count, warn_ms)
