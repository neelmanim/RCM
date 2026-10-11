
import re
import time
import logging
import statistics
import threading
import uuid
from collections import deque, defaultdict
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from typing import Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

# ── Threshold tiers (ms) ──────────────────────────────────────────────────────
_TIER_OK_FAST_MS = 100      # < 100ms   → OK / fast   (DEBUG)
_TIER_OK_SLOW_MS = 300      # 100–300ms → OK / acceptable (INFO)
_TIER_WARN_MS    = 1_000    # 300ms–1s  → WARNING
                             # > 1 000ms → ERROR

# ── Rolling window ────────────────────────────────────────────────────────────
MAX_SAMPLES = 1_000          # Per-endpoint sample cap

_samples: dict[str, deque] = defaultdict(lambda: deque(maxlen=MAX_SAMPLES))
_samples_lock = Lock()

# ── Excluded paths ─────────────────────────────────────────────────────────────
# NOTE: Do NOT include bare "/" here — every URL path starts with "/",
#       which would cause all endpoints to be skipped.
_SKIP_PREFIXES = ("/api/calls/events", "/api/health", "/health", "/api/admin/perf")
_SKIP_EXACT    = {"/"}


def _should_skip(path: str) -> bool:
    if path in _SKIP_EXACT:
        return True
    return any(path.startswith(p) for p in _SKIP_PREFIXES)


def _endpoint_key(method: str, path: str) -> str:
    """
    Normalise path to a stable key — replace numeric / UUID segments with {id}
    so per-endpoint stats don't fragment across thousands of lead IDs.
    e.g.  GET /api/leads/12345  →  'GET /api/leads/{id}'
    """
    # UUIDs first: a UUID that starts with digits ("16676b8b-…") was cut by
    # the numeric rule into "/{id}b8b-…", so every lead got its own key here.
    normalised = re.sub(
        r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        "/{id}",
        path,
        flags=re.IGNORECASE,
    )
    normalised = re.sub(r"/\d+", "/{id}", normalised)
    return f"{method} {normalised}"


def record_sample(method: str, path: str, duration_ms: float) -> None:
    key = _endpoint_key(method, path)
    with _samples_lock:
        _samples[key].append(duration_ms)


def get_percentiles(method: str, path: str) -> Optional[dict]:
    """Return P50 / P95 / P99 for the given endpoint, or None if no data."""
    key = _endpoint_key(method, path)
    with _samples_lock:
        data = list(_samples[key])
    if not data:
        return None
    data.sort()
    n = len(data)

    def pct(p):
        return round(data[max(0, int(n * p / 100) - 1)], 1)

    return {"p50": pct(50), "p95": pct(95), "p99": pct(99), "n": n}


def get_all_stats() -> list[dict]:
    """Return stats for all endpoints, sorted by P95 descending."""
    results = []
    with _samples_lock:
        snapshot = {k: list(v) for k, v in _samples.items()}
    for key, data in snapshot.items():
        if not data:
            continue
        data.sort()
        n = len(data)

        def pct(p, d=data, ln=n):
            return round(d[max(0, int(ln * p / 100) - 1)], 1)

        results.append({
            "endpoint": key,
            "p50_ms":   pct(50),
            "p95_ms":   pct(95),
            "p99_ms":   pct(99),
            "max_ms":   round(max(data), 1),
            "mean_ms":  round(statistics.mean(data), 1),
            "samples":  n,
        })
    results.sort(key=lambda r: r["p95_ms"], reverse=True)
    return results


# RCA 2026-08-26 (staging OOM): every non-excluded request spawns a thread
# here with no concurrency cap — same shape as the Nylas full-mailbox-sync
# leak (56ce657), but this one fires on ALL traffic, not one endpoint. A
# request burst (E2E suite, real traffic spike) can spawn dozens of
# concurrent threads, each holding a thread stack + a pooled DB connection.
# Bounded here the same way: skip (best-effort, already non-blocking) rather
# than queue over the cap.
#
# RCA 2026-10-06 (staging OOM again): the cap bounded concurrency but every
# request still started a brand-new OS thread — with Aircall webhooks every
# few seconds that is thousands of short-lived threads an hour, each one a
# fresh malloc arena glibc keeps. Two long-lived pool threads now do the
# writes; the semaphore caps queued + running writes, skipping beyond it.
_perf_write_semaphore = threading.Semaphore(8)
_perf_writer = ThreadPoolExecutor(max_workers=2, thread_name_prefix="perf_writer")


def _submit_perf_metric(*args) -> None:
    """Queue one perf_metrics write; best-effort, never blocks the request."""
    if not _perf_write_semaphore.acquire(blocking=False):
        return  # skip under heavy load rather than pile up work
    _perf_writer.submit(_write_perf_metric, *args)


def _write_perf_metric(endpoint: str, method: str, duration_ms: int, rail_tier: str, status_code: int) -> None:
    """Write a single perf_metrics row on the perf writer pool."""
    try:
        from database import SessionLocal
        db = SessionLocal()
        try:
            from sqlalchemy import text as _t
            db.execute(_t(
                "INSERT INTO perf_metrics (id, endpoint, method, duration_ms, rail_tier, status_code) "
                "VALUES (:id, :ep, :m, :d, :t, :s)"
            ), {
                "id": str(uuid.uuid4()),
                "ep": endpoint,
                "m": method,
                "d": duration_ms,
                "t": rail_tier,
                "s": status_code,
            })
            db.commit()
        finally:
            db.close()
    except Exception:
        pass  # perf write is best-effort — never crash the request
    finally:
        _perf_write_semaphore.release()


# ── TimingMiddleware ───────────────────────────────────────────────────────────
class TimingMiddleware(BaseHTTPMiddleware):
    """
    Wraps every HTTP request:
    - Measures wall-clock duration via time.perf_counter()
    - Sets query_logger context (path + reset query count) for N+1 tracking
    - Adds X-Response-Time header (ms, 1 decimal)
    - Logs at the appropriate RAIL-model severity tier
    - Records sample in the rolling window for Phase 4 perf summary
    - Writes to perf_metrics DB table (background thread, non-blocking)
    """

    async def __call__(self, scope, receive, send):
        # RCA 2026-08-19: BaseHTTPMiddleware.call_next buffers the downstream
        # ASGI messages through an in-memory stream. For a long-lived
        # StreamingResponse (the SSE endpoint), a client disconnect mid-stream
        # leaves that buffer empty, and Starlette raises "RuntimeError: No
        # response returned." on every disconnect (dialer widget reload/nav/
        # close reopens this constantly). _should_skip's dispatch-level check
        # doesn't prevent it — call_next itself is what's unsafe. Bypass
        # BaseHTTPMiddleware entirely for this path instead of going through
        # dispatch()/call_next() at all.
        if scope.get("type") == "http" and _should_skip(scope.get("path", "")):
            return await self.app(scope, receive, send)
        return await super().__call__(scope, receive, send)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path

        if _should_skip(path):
            return await call_next(request)

        # ── Arm query logger for this request ─────────────────────────────────
        try:
            from query_logger import reset_request_query_count, set_request_path
            reset_request_query_count()
            set_request_path(path)
        except Exception:
            pass  # query_logger not loaded — non-fatal

        t0 = time.perf_counter()
        response: Response = await call_next(request)
        duration_ms = (time.perf_counter() - t0) * 1_000

        method = request.method
        status = response.status_code

        # Add X-Response-Time header
        response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"

        # User identity hint for log lines
        user_hint = ""
        try:
            email = getattr(request.state, "user_email", None)
            if email:
                user_hint = f" user={email}"
        except Exception:
            pass

        # RAIL-model tier classification + logging
        if duration_ms < _TIER_OK_FAST_MS:
            rail_tier = "OK"
            logger.debug(
                f"[PERF] {method} {path} {status} {duration_ms:.1f}ms P=OK{user_hint}"
            )
        elif duration_ms < _TIER_OK_SLOW_MS:
            rail_tier = "ACCEPTABLE"
            logger.info(
                f"[PERF] {method} {path} {status} {duration_ms:.1f}ms P=OK{user_hint}"
            )
        elif duration_ms < _TIER_WARN_MS:
            rail_tier = "SLOW"
            logger.warning(
                f"[PERF] {method} {path} {status} {duration_ms:.1f}ms P=SLOW{user_hint}"
            )
        else:
            rail_tier = "CRITICAL"
            # The tier still records CRITICAL in perf_metrics / the rolling
            # window — but the LOG LEVEL follows the response, not the clock.
            # A 200 that took 3s is a performance datum (the Perf Health tab
            # is where it belongs); logging it at ERROR filled Render's error
            # view with successful requests and helped hide 17 real
            # /api/calls/start 500s for four days. ERROR is for things that
            # broke.
            (logger.error if status >= 500 else logger.warning)(
                f"[PERF] {method} {path} {status} {duration_ms:.1f}ms P=CRITICAL{user_hint}"
            )

        # Record in rolling window (in-memory, instant)
        record_sample(method, path, duration_ms)

        # Persist to perf_metrics DB table (background thread — non-blocking)
        endpoint_key = _endpoint_key(method, path)
        _submit_perf_metric(endpoint_key, method, int(duration_ms), rail_tier, status)

        return response
