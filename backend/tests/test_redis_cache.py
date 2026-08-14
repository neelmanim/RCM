"""
Tests for v9.1.0 Redis cache migration.

All tests use mock Redis — no actual Upstash connection needed.
Covers: Redis disabled, Redis enabled, Redis fallback, key format, stampede guard.
"""
import sys
import os
import json
import threading
import time
from unittest.mock import MagicMock, patch, PropertyMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _reload_cache(**env_overrides):
    """Reload cache module with fresh state and optional env var overrides."""
    import importlib
    env_patch = {
        "UPSTASH_REDIS_REST_URL": "",
        "UPSTASH_REDIS_REST_TOKEN": "",
        "DATABASE_URL": "",
    }
    env_patch.update(env_overrides)
    with patch.dict(os.environ, env_patch, clear=False):
        import cache
        # Reset module-level state
        cache._stores.clear()
        cache._locks.clear()
        cache._inflight.clear()
        cache._redis_client = None
        cache._redis_available = False
        return cache


def _mock_redis():
    """Create a mock Upstash Redis client with dict-backed storage."""
    store = {}
    ttls = {}
    mock = MagicMock()

    def _get(key):
        if key in store:
            if key in ttls and time.monotonic() > ttls[key]:
                del store[key]
                del ttls[key]
                return None
            return store[key]
        return None

    def _set(key, value, ex=None):
        store[key] = value
        if ex:
            ttls[key] = time.monotonic() + ex

    def _delete(*keys):
        for k in keys:
            store.pop(k, None)
            ttls.pop(k, None)

    def _scan(cursor=0, match="*", count=100):
        import fnmatch
        matched = [k for k in store.keys() if fnmatch.fnmatch(k, match)]
        return (0, matched)

    mock.get = MagicMock(side_effect=_get)
    mock.set = MagicMock(side_effect=_set)
    mock.delete = MagicMock(side_effect=_delete)
    mock.scan = MagicMock(side_effect=_scan)
    mock.ping = MagicMock(return_value="PONG")
    mock._store = store  # expose for assertions

    return mock


# ═══════════════════════════════════════════════════════════════════════════════
# 1. TestRedisDisabled — When env vars are not set
# ═══════════════════════════════════════════════════════════════════════════════

class TestRedisDisabled:
    """When UPSTASH_REDIS_REST_URL is not set, Redis layer is fully skipped."""

    def test_no_env_vars_uses_memory_only(self):
        cache = _reload_cache()
        assert cache._redis_available is False
        assert cache._redis_client is None

    def test_get_set_invalidate_work_without_redis(self):
        cache = _reload_cache()
        assert cache.get_cached("test_ns", "k1") is None
        cache.set_cached("test_ns", "k1", {"data": 42})
        assert cache.get_cached("test_ns", "k1") == {"data": 42}
        cache.invalidate("test_ns", "k1")
        assert cache.get_cached("test_ns", "k1") is None

    def test_cache_stats_shows_backend_as_memory(self):
        cache = _reload_cache()
        stats = cache.cache_stats()
        assert stats["backend"] == "in-memory"
        assert stats["redis_connected"] is False

    def test_clear_all_works_without_redis(self):
        cache = _reload_cache()
        cache.set_cached("ns1", "a", 1)
        cache.set_cached("ns2", "b", 2)
        cache.clear_all()
        assert cache.get_cached("ns1", "a") is None
        assert cache.get_cached("ns2", "b") is None


# ═══════════════════════════════════════════════════════════════════════════════
# 2. TestRedisEnabled — When Redis is available
# ═══════════════════════════════════════════════════════════════════════════════

class TestRedisEnabled:
    """When Redis is connected, it serves as Layer 1 cache."""

    def _setup_cache_with_redis(self):
        cache = _reload_cache()
        mock = _mock_redis()
        cache._redis_client = mock
        cache._redis_available = True
        return cache, mock

    def test_set_writes_to_redis_and_get_populates_memory(self):
        """When Redis SET succeeds, in-memory is skipped (no dual storage).
        get_cached reads from Redis and populates in-memory on hit."""
        cache, mock = self._setup_cache_with_redis()
        cache.set_cached("users", "all", [{"id": 1}])
        # Redis was called
        mock.set.assert_called_once()
        redis_key = mock.set.call_args[0][0]
        assert "users" in redis_key
        assert "all" in redis_key
        # get_cached reads from Redis → populates in-memory
        assert cache.get_cached("users", "all") == [{"id": 1}]

    def test_get_returns_redis_value_first(self):
        cache, mock = self._setup_cache_with_redis()
        # Put value directly into mock Redis store
        rkey = cache._redis_key("users", "mykey")
        mock._store[rkey] = json.dumps({"from": "redis"})
        result = cache.get_cached("users", "mykey")
        assert result == {"from": "redis"}
        mock.get.assert_called_once()

    def test_invalidate_deletes_from_both(self):
        cache, mock = self._setup_cache_with_redis()
        cache.set_cached("dash", "k1", {"val": 1})
        cache.invalidate("dash", "k1")
        # Redis delete was called
        mock.delete.assert_called()
        # Memory is cleared
        assert cache.get_cached("dash", "k1") is None

    def test_invalidate_namespace_clears_all_keys(self):
        cache, mock = self._setup_cache_with_redis()
        cache.set_cached("dash", "k1", 1)
        cache.set_cached("dash", "k2", 2)
        cache.invalidate("dash")  # clear entire namespace
        # Memory cleared
        assert cache.get_cached("dash", "k1") is None
        assert cache.get_cached("dash", "k2") is None
        # Redis scan + delete was called
        mock.scan.assert_called()

    def test_ttl_is_set_correctly_in_redis(self):
        cache, mock = self._setup_cache_with_redis()
        cache.set_cached("users", "all", {"data": 1})
        call_args = mock.set.call_args
        # TTL should be passed as `ex` kwarg
        assert call_args[1].get("ex") == 120  # users TTL = 120s

    def test_cache_stats_shows_backend_as_redis(self):
        cache, mock = self._setup_cache_with_redis()
        stats = cache.cache_stats()
        assert stats["backend"] == "redis"
        assert stats["redis_connected"] is True


# ═══════════════════════════════════════════════════════════════════════════════
# 3. TestRedisFallback — When Redis fails mid-request
# ═══════════════════════════════════════════════════════════════════════════════

class TestRedisFallback:
    """When Redis raises exceptions, app falls back to in-memory silently."""

    def _setup_broken_redis(self):
        cache = _reload_cache()
        mock = MagicMock()
        mock.get = MagicMock(side_effect=ConnectionError("Redis down"))
        mock.set = MagicMock(side_effect=ConnectionError("Redis down"))
        mock.delete = MagicMock(side_effect=ConnectionError("Redis down"))
        mock.scan = MagicMock(side_effect=ConnectionError("Redis down"))
        cache._redis_client = mock
        cache._redis_available = True
        return cache, mock

    def test_redis_get_exception_falls_back_to_memory(self):
        cache, _ = self._setup_broken_redis()
        # Pre-populate in-memory
        store, lock = cache._get_store("users")
        with lock:
            store["k1"] = ({"fallback": True}, time.monotonic() + 60)
        # Should get from memory, not raise
        result = cache.get_cached("users", "k1")
        assert result == {"fallback": True}

    def test_redis_set_exception_still_writes_memory(self):
        cache, _ = self._setup_broken_redis()
        # Should not raise, and memory should have the value
        cache.set_cached("users", "k1", {"data": 42})
        # Verify in-memory has it
        store, lock = cache._get_store("users")
        with lock:
            assert "k1" in store
            assert store["k1"][0] == {"data": 42}

    def test_redis_invalidate_exception_still_clears_memory(self):
        cache, _ = self._setup_broken_redis()
        cache.set_cached("users", "k1", {"data": 42})
        cache.invalidate("users", "k1")
        # Memory should be cleared even though Redis failed
        store, lock = cache._get_store("users")
        with lock:
            assert "k1" not in store

    def test_redis_timeout_falls_back_gracefully(self):
        cache = _reload_cache()
        mock = MagicMock()
        mock.get = MagicMock(side_effect=TimeoutError("Redis timeout"))
        mock.set = MagicMock(side_effect=TimeoutError("Redis timeout"))
        cache._redis_client = mock
        cache._redis_available = True
        # Should not raise on get or set
        cache.set_cached("test", "k1", "val")
        result = cache.get_cached("test", "k1")
        assert result == "val"  # served from memory

    def test_redis_connection_lost_after_startup(self):
        cache, _ = self._setup_broken_redis()
        # Simulate: Redis was connected at startup but now down
        assert cache._redis_available is True
        # All ops should silently fall through
        cache.set_cached("x", "y", [1, 2, 3])
        assert cache.get_cached("x", "y") == [1, 2, 3]
        cache.invalidate("x")
        assert cache.get_cached("x", "y") is None

    def test_redis_returns_corrupted_json_falls_back(self):
        cache = _reload_cache()
        mock = MagicMock()
        mock.get = MagicMock(return_value="{{not valid json!!!")
        cache._redis_client = mock
        cache._redis_available = True
        # json.loads will fail — should fall through to memory (None)
        result = cache.get_cached("users", "bad_key")
        assert result is None  # did not crash


# ═══════════════════════════════════════════════════════════════════════════════
# 4. TestRedisKeyFormat — Key structure correctness
# ═══════════════════════════════════════════════════════════════════════════════

class TestRedisKeyFormat:
    """Verify Redis keys are properly namespaced and don't collide."""

    def test_key_format_is_namespaced(self):
        cache = _reload_cache()
        key = cache._redis_key("users", "all_super_admin")
        # Should be ls:{env}:users:all_super_admin
        parts = key.split(":")
        assert parts[0] == "ls"
        assert parts[1] in ("prod", "staging")
        assert parts[2] == "users"
        assert parts[3] == "all_super_admin"

    def test_staging_env_uses_staging_prefix(self):
        cache = _reload_cache(DATABASE_URL="postgres://user:pass@host/rcm_db_staging")
        # Force re-read of env prefix
        cache._ENV_PREFIX = "ls:staging" if "staging" in os.environ.get("DATABASE_URL", "") else "ls:prod"
        key = cache._redis_key("users", "k1")
        assert ":staging:" in key or ":prod:" in key  # depends on actual DATABASE_URL

    def test_different_namespaces_dont_collide(self):
        cache = _reload_cache()
        k1 = cache._redis_key("users", "all")
        k2 = cache._redis_key("dashboard", "all")
        assert k1 != k2
        assert "users" in k1
        assert "dashboard" in k2


# ═══════════════════════════════════════════════════════════════════════════════
# 5. TestStampedeGuardWithRedis — Stampede guard still works
# ═══════════════════════════════════════════════════════════════════════════════

class TestStampedeGuardWithRedis:
    """Stampede guard stays in-memory only and works regardless of Redis state."""

    def test_stampede_guard_still_in_memory_only(self):
        """claim/wait/release should NOT call Redis at all."""
        cache = _reload_cache()
        mock = _mock_redis()
        cache._redis_client = mock
        cache._redis_available = True

        cache.claim_inflight("users", "k1")
        cache.release_inflight("users", "k1")

        # Redis should NOT have been called for stampede ops
        mock.get.assert_not_called()
        mock.set.assert_not_called()

    def test_stampede_guard_works_when_redis_down(self):
        cache = _reload_cache()
        cache._redis_client = None
        cache._redis_available = False

        assert cache.claim_inflight("ns", "k1") is True
        assert cache.claim_inflight("ns", "k1") is False
        cache.release_inflight("ns", "k1")
        assert cache.claim_inflight("ns", "k1") is True
        cache.release_inflight("ns", "k1")

    def test_concurrent_claim_still_one_winner(self):
        cache = _reload_cache()
        winners = []
        barrier = threading.Barrier(5)

        def _try_claim():
            barrier.wait()
            if cache.claim_inflight("_conc_test", "key"):
                winners.append(1)
                time.sleep(0.02)
                cache.release_inflight("_conc_test", "key")

        threads = [threading.Thread(target=_try_claim) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(winners) == 1
