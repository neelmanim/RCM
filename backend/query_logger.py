"""
backend/query_logger.py
──────────────────────────────────────────────────────────────────────────────
SQLAlchemy slow-query logger — Phase 1 (perf-benchmarking initiative).

Hooks into SQLAlchemy's engine event system to measure per-statement wall-clock
time. When a statement exceeds the slow-query threshold, it is logged with:
  - Duration (ms)
  - Truncated SQL text (first 400 chars — enough to identify the query)
  - Bind parameter summary (counts params, doesn't log values → no PII)
  - Per-request query count for N+1 detection

Activation:
  Automatically wired by middleware.attach_profiler() when SLOW_QUERY_LOG=true
  is set in the environment (or always-on in dev).

  Default prod behaviour: SLOW_QUERY_LOG is unset → query logger attaches
  but only logs queries that exceed SLOW_QUERY_THRESHOLD_MS (default 50ms).
  At low traffic this is near-zero overhead. For a 24-hour deep-dive, set
  SLOW_QUERY_LOG=true to also log per-request query counts and N+1 warnings.

Industry-standard OLTP slow-query thresholds:
  MySQL / PostgreSQL slow_query_log default: 1 000ms  (way too lenient for web)
  Datadog APM "slow" threshold:             500ms
  New Relic "slow" threshold:               200ms
  This implementation:                       50ms  (P95 target < 300ms API → DB
                                             should not take > 50ms on its own)

N+1 detection:
  If a single HTTP request triggers > N+1_QUERY_WARN queries, a WARNING is
  logged. This is correlated to the request via a threading.local context set
  by TimingMiddleware through the per-request query counter.

Thread safety:
  Uses threading.local() for per-request query count. Safe on Gunicorn
  sync workers (one thread per worker). Will not work correctly with async
  workers (uvicorn/asyncio) unless contextvars are used — tracked for Phase 3.
"""

import time
import logging
import os
import threading
from sqlalchemy import event

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
SLOW_QUERY_THRESHOLD_MS: float = float(
    os.getenv("SLOW_QUERY_THRESHOLD_MS", "50")
)
N1_QUERY_WARN_THRESHOLD: int = int(
    os.getenv("N1_QUERY_WARN_THRESHOLD", "8")
)
_VERBOSE: bool = os.getenv("SLOW_QUERY_LOG", "false").lower() in ("true", "1", "yes")

# ── Per-request state (threading.local) ───────────────────────────────────────
_local = threading.local()


def _get_query_count() -> int:
    return getattr(_local, "query_count", 0)


def _increment_query_count() -> int:
    _local.query_count = getattr(_local, "query_count", 0) + 1
    return _local.query_count


def reset_request_query_count() -> None:
    """Call at the START of each request to reset the per-request counter."""
    _local.query_count = 0
    _local.request_path = None


def set_request_path(path: str) -> None:
    _local.request_path = path


def get_slow_query_stats() -> list[dict]:
    """Return the accumulated slow-query log (in-memory ring buffer)."""
    with _slow_lock:
        return list(_slow_log)


# ── Slow-query ring buffer ────────────────────────────────────────────────────
# Stores the most recent MAX_SLOW_ENTRIES slow queries in memory.
# Consumed by Phase 4 GET /api/admin/perf/summary endpoint.
from collections import deque

MAX_SLOW_ENTRIES = 200
_slow_log: deque = deque(maxlen=MAX_SLOW_ENTRIES)
_slow_lock = threading.Lock()


def _record_slow_query(sql: str, duration_ms: float, path: str | None) -> None:
    entry = {
        "sql_preview": sql[:300].replace("\n", " ").strip(),
        "duration_ms": round(duration_ms, 1),
        "endpoint": path or "unknown",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with _slow_lock:
        _slow_log.appendleft(entry)


# ── SQLAlchemy event hooks ────────────────────────────────────────────────────
def attach_query_logger(engine) -> None:
    """
    Register before/after cursor_execute listeners on the SQLAlchemy engine.
    Call once at startup (via middleware.attach_profiler).
    """

    @event.listens_for(engine, "before_cursor_execute")
    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        conn.info.setdefault("query_start_time", []).append(time.perf_counter())

    @event.listens_for(engine, "after_cursor_execute")
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        # Pop the matching start time
        start_times = conn.info.get("query_start_time", [])
        if not start_times:
            return
        t0 = start_times.pop()
        duration_ms = (time.perf_counter() - t0) * 1_000

        # Track per-request query count
        count = _increment_query_count()
        path = getattr(_local, "request_path", None)

        # N+1 detection — only warn once per request (at the threshold crossing)
        if _VERBOSE and count == N1_QUERY_WARN_THRESHOLD:
            logger.warning(
                f"[N+1 RISK] {count} DB queries on single request "
                f"path={path or 'unknown'} — consider collapsing queries"
            )

        # Slow query logging
        if duration_ms >= SLOW_QUERY_THRESHOLD_MS:
            sql_preview = str(statement)[:400].replace("\n", " ").strip()
            param_count = (
                len(parameters) if isinstance(parameters, (list, tuple, dict)) else "?"
            )
            logger.warning(
                f"[SLOW SQL] {duration_ms:.1f}ms | params={param_count} "
                f"| path={path or 'unknown'} | sql={sql_preview}"
            )
            _record_slow_query(str(statement), duration_ms, path)

        elif _VERBOSE:
            # Full trace only when SLOW_QUERY_LOG=true (dev/24h prod window)
            logger.debug(
                f"[SQL] {duration_ms:.1f}ms | query_#{count} | path={path or '-'}"
            )
