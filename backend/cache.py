"""
cache.py — 3-layer TTL cache for expensive read-only endpoints.

Layer 1: Redis (Upstash REST) — shared across workers, survives deploys
Layer 2: In-memory dict       — per-worker, ~0ms, same as pre-v9.1.0
Layer 3: PostgreSQL            — source of truth, always works

CORE PRINCIPLE: Cache is a luxury, not a dependency.
  - If Redis is down → falls back to in-memory silently.
  - If Redis env vars are missing → in-memory only (no overhead).
  - If both miss → caller hits DB normally.
  - Redis failures NEVER cause a 500 error.

Environment separation:
  - Staging and prod can share the same Redis instance.
  - Keys are prefixed: ls:prod:users:key or ls:staging:users:key
  - Auto-detected from DATABASE_URL (contains "staging" → staging prefix).

Usage (unchanged from v9.0.x — no route modifications needed):
    from cache import get_cached, set_cached, invalidate

    cached = get_cached('dashboard', key)
    if cached is not None:
        return cached
    result = expensive_query(db)
    set_cached('dashboard', key, result)
    return result
"""

import json
import logging
import os
import threading
import time
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# ── TTL (seconds) per namespace ───────────────────────────────────────────────
TTL: Dict[str, int] = {
    "dashboard":          30,   # /api/leads/dashboard-stats
    "leaderboard":       120,   # /api/leaderboard — bumped 60→120s (stampede reduction)
    "users":             120,   # /api/admin/users — bumped 30→120s (stampede reduction)
    "leads_count":        30,   # COUNT(*) inside paginated /api/leads + /api/leads/my
    "leads_page":         15,   # /api/leads full page results (admin/pod-admin view)
    "my_leads":           20,   # /api/leads/my full page results (per SDR)
    "call_logs":          15,   # /api/admin/call-logs
    "activity":           20,   # /api/leads/activity-feed
    "growth_intelligence": 900, # /api/growth-intelligence — Groq AI + heavy DB metrics (RCA 2026-06-17)
    # NOTE: invalidate('leads_page') + invalidate('my_leads') must be called
    # in any route that creates, assigns, or changes status of a lead.
}
DEFAULT_TTL = 30

# ── Environment prefix ───────────────────────────────────────────────────────
# Auto-detect from DATABASE_URL so staging/prod keys never collide.
_ENV_PREFIX: str = "ls:staging" if "staging" in os.environ.get("DATABASE_URL", "") else "ls:prod"

# ── Internal stores ──────────────────────────────────────────────────────────
_stores:    Dict[str, Dict[str, Tuple[Any, float]]] = {}
_locks:     Dict[str, threading.RLock] = {}
# Stampede guard: tracks keys currently being populated by a query.
# Stays in-memory only (per-worker coordination, not shared state).
_inflight:      Dict[str, set] = {}   # namespace → set of keys being computed
_inflight_cond: threading.Condition = threading.Condition(threading.Lock())

# ── Redis (Upstash) — Layer 1 ────────────────────────────────────────────────
_redis_client = None  # Set once at module load; None = disabled
_redis_available = False


def _init_redis():
    """Connect to Upstash Redis if env vars are set. Returns client or None."""
    global _redis_client, _redis_available
    url = os.environ.get("UPSTASH_REDIS_REST_URL", "").strip()
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()

    if not url or not token:
        logger.info("[cache] Redis env vars not set — running in-memory only")
        return

    try:
        from upstash_redis import Redis
        client = Redis(url=url, token=token)
        client.ping()
        _redis_client = client
        _redis_available = True
        logger.info("[cache] ✅ Redis connected — %s (prefix: %s)", url.split("//")[1].split(".")[0], _ENV_PREFIX)
    except ImportError:
        logger.warning("[cache] upstash-redis package not installed — falling back to in-memory")
    except Exception as exc:
        logger.warning("[cache] Redis connection failed (%s) — falling back to in-memory", exc)


# Run at module load — safe to fail
_init_redis()


def _redis_key(namespace: str, key: str) -> str:
    """Build Redis key with environment prefix: ls:prod:users:all_super_admin"""
    return f"{_ENV_PREFIX}:{namespace}:{key}"


def _redis_pattern(namespace: str) -> str:
    """Build Redis scan pattern for namespace invalidation: ls:prod:users:*"""
    return f"{_ENV_PREFIX}:{namespace}:*"


# ── Internal store helpers ────────────────────────────────────────────────────

def _get_store(namespace: str):
    if namespace not in _stores:
        _stores[namespace] = {}
        _locks[namespace] = threading.RLock()
        _inflight[namespace] = set()
    return _stores[namespace], _locks[namespace]


# ── Public API ────────────────────────────────────────────────────────────────

def get_cached(namespace: str, key: str) -> Optional[Any]:
    """Return cached value or None if missing/expired.

    Checks Redis first (shared, survives deploys), then in-memory dict.
    Redis failures are silently caught — falls back to in-memory.
    """
    # Layer 1: Try Redis
    if _redis_available and _redis_client is not None:
        try:
            raw = _redis_client.get(_redis_key(namespace, key))
            if raw is not None:
                # Upstash returns str for string values
                value = json.loads(raw) if isinstance(raw, str) else raw
                # Also populate in-memory cache (warm the local worker)
                store, lock = _get_store(namespace)
                ttl = TTL.get(namespace, DEFAULT_TTL)
                with lock:
                    store[key] = (value, time.monotonic() + ttl)
                return value
        except Exception:
            pass  # Redis down or corrupt data — fall through

    # Layer 2: Try in-memory dict
    store, lock = _get_store(namespace)
    with lock:
        entry = store.get(key)
        if entry is None:
            return None
        value, expiry = entry
        if time.monotonic() > expiry:
            del store[key]
            return None
        return value


def set_cached(namespace: str, key: str, value: Any, ttl: Optional[int] = None) -> None:
    """Store value with TTL seconds. Writes to both Redis and in-memory.

    Redis failure is silently caught — in-memory is always updated.
    """
    ttl = ttl if ttl is not None else TTL.get(namespace, DEFAULT_TTL)

    # Layer 1: Write to Redis (fire-and-forget on failure)
    _redis_write_ok = False
    if _redis_available and _redis_client is not None:
        try:
            serialized = json.dumps(value, default=str)
            _redis_client.set(_redis_key(namespace, key), serialized, ex=ttl)
            _redis_write_ok = True
        except Exception:
            pass  # Redis down — fall through to in-memory

    # Layer 2: Write to in-memory dict
    # When Redis write succeeded, skip in-memory to prevent dual-storage
    # memory bloat. get_cached() already populates in-memory on Redis hit
    # (warm-on-read pattern), so actively accessed keys still get local speed.
    # When Redis is down/unavailable OR write failed → always write in-memory.
    if not _redis_write_ok:
        store, lock = _get_store(namespace)
        with lock:
            store[key] = (value, time.monotonic() + ttl)


def invalidate(namespace: str, key: Optional[str] = None) -> None:
    """Bust a specific key or the entire namespace from both layers.

    Redis failure is silently caught — in-memory is always cleared.
    """
    # Layer 1: Clear from Redis
    if _redis_available and _redis_client is not None:
        try:
            if key is not None:
                _redis_client.delete(_redis_key(namespace, key))
            else:
                # Clear entire namespace: scan for matching keys
                pattern = _redis_pattern(namespace)
                cursor = 0
                while True:
                    cursor, keys = _redis_client.scan(cursor=cursor, match=pattern, count=100)
                    if keys:
                        _redis_client.delete(*keys)
                    if cursor == 0:
                        break
        except Exception:
            pass  # Redis down — in-memory still cleared

    # Layer 2: Clear from in-memory dict (always succeeds)
    store, lock = _get_store(namespace)
    with lock:
        if key is not None:
            store.pop(key, None)
        else:
            store.clear()


def clear_all() -> None:
    """Clear every namespace from both layers (test teardown / admin reset)."""
    # Layer 1: Flush our prefixed keys from Redis
    if _redis_available and _redis_client is not None:
        try:
            pattern = f"{_ENV_PREFIX}:*"
            cursor = 0
            while True:
                cursor, keys = _redis_client.scan(cursor=cursor, match=pattern, count=100)
                if keys:
                    _redis_client.delete(*keys)
                if cursor == 0:
                    break
        except Exception:
            pass

    # Layer 2: Clear in-memory
    for ns_store in _stores.values():
        ns_store.clear()


# ── Stampede guard (in-memory only — per-worker coordination) ─────────────────

def claim_inflight(namespace: str, key: str) -> bool:
    """Claim the right to populate a cache key.

    Returns True if this caller should compute the value (it is the first to
    claim the key).  Returns False if another thread is already computing it
    (the caller should call wait_inflight() and then retry get_cached()).

    Usage pattern in route handlers::

        cached = get_cached('users', cache_key)
        if cached is not None:
            return cached
        if not claim_inflight('users', cache_key):
            wait_inflight('users', cache_key)          # blocks briefly
            cached = get_cached('users', cache_key)    # should now be warm
            if cached is not None:
                return cached
        try:
            result = expensive_query(db)
            set_cached('users', cache_key, result)
        finally:
            release_inflight('users', cache_key)
        return result
    """
    _get_store(namespace)  # ensure _inflight[namespace] exists
    with _inflight_cond:
        if key in _inflight[namespace]:
            return False  # another thread is computing this key
        _inflight[namespace].add(key)
        return True


def wait_inflight(namespace: str, key: str, timeout: float = 3.0) -> None:
    """Block until the inflight key is released (or timeout expires)."""
    _get_store(namespace)
    deadline = time.monotonic() + timeout
    with _inflight_cond:
        while key in _inflight.get(namespace, set()):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            _inflight_cond.wait(timeout=remaining)


def release_inflight(namespace: str, key: str) -> None:
    """Release the inflight claim and wake any waiting threads."""
    _get_store(namespace)
    with _inflight_cond:
        _inflight[namespace].discard(key)
        _inflight_cond.notify_all()


# ── Diagnostics ──────────────────────────────────────────────────────────────

def cache_stats() -> Dict[str, Any]:
    """Debug: live entry count per namespace + Redis status."""
    now = time.monotonic()
    stats: Dict[str, Any] = {
        "backend": "redis" if _redis_available else "in-memory",
        "redis_connected": _redis_available,
        "env_prefix": _ENV_PREFIX,
        "namespaces": {
            ns: sum(1 for _, (_, exp) in store.items() if now <= exp)
            for ns, store in _stores.items()
        }
    }

    # Add Redis key count if connected
    if _redis_available and _redis_client is not None:
        try:
            cursor, keys = _redis_client.scan(cursor=0, match=f"{_ENV_PREFIX}:*", count=1000)
            stats["redis_key_count"] = len(keys)
        except Exception:
            stats["redis_key_count"] = "unavailable"

    return stats


def _is_test_db(db) -> bool:
    """Return True when running against SQLite (test mode) — skip caching."""
    try:
        return "sqlite" in str(db.bind.dialect.name)
    except Exception:
        return False
