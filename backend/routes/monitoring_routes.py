"""
Monitoring health endpoint — UptimeRobot authenticated polling.

Secured by a static MONITORING_API_KEY env var (not a JWT).
This allows UptimeRobot to poll with ?key=<secret> without a full login flow.

GET /api/monitoring/health?key=<MONITORING_API_KEY>

Returns a rich JSON payload that covers everything a JWT-protected endpoint would,
including:
    - DB connectivity and table-level access
    - Scheduler/background job state
    - Lead and user row counts (to detect mass data loss)
    - Last Salesforce sync timestamp
    - Memory and startup state

UptimeRobot keyword monitor should match: "status":"ok"
(keyword_type = 2 = "alert when NOT found")
"""

import os
import time
import platform
import resource
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

import app_state
import models
from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])

# ── Auth helper ────────────────────────────────────────────────────────────────

def _verify_key(key: str) -> None:
    """Constant-time key check against MONITORING_API_KEY env var."""
    expected = os.getenv("MONITORING_API_KEY", "")
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="MONITORING_API_KEY not configured on this server.",
        )
    # Constant-time comparison to prevent timing attacks
    import hmac
    if not hmac.compare_digest(expected.encode(), key.encode()):
        raise HTTPException(status_code=403, detail="Invalid monitoring key.")


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.get("/health")
def monitoring_health(
    key: str = Query(..., description="Monitoring API key (set via MONITORING_API_KEY env var)"),
    db: Session = Depends(get_db),
):
    """
    Rich health check for UptimeRobot authenticated monitoring.
    Returns an aggregated status across DB, tables, scheduler, data integrity.

    Configure in UptimeRobot as a Keyword monitor:
        URL: https://api.alternatecrm.com/api/monitoring/health?key=<KEY>
        keyword_type: 2  (alert when keyword is NOT found)
        keyword_value: "status":"ok"
    """
    _verify_key(key)

    # ── Memory ─────────────────────────────────────────────────────────────────
    usage = resource.getrusage(resource.RUSAGE_SELF)
    if platform.system() == "Linux":
        memory_mb = round(usage.ru_maxrss / 1024, 1)
    else:
        memory_mb = round(usage.ru_maxrss / (1024 * 1024), 1)

    # ── DB: shallow ping ───────────────────────────────────────────────────────
    db_connected = False
    db_latency_ms = -1
    db_url_type = "unknown"
    try:
        from database import engine as _engine
        _url = str(_engine.url)
        db_url_type = "sqlite" if "sqlite" in _url else "postgresql"
    except Exception:
        pass

    try:
        t0 = time.monotonic()
        db.execute(text("SELECT 1"))
        db_latency_ms = round((time.monotonic() - t0) * 1000, 2)
        db_connected = True
    except Exception:
        pass

    # ── DB: table-level read (leads + users) ───────────────────────────────────
    db_tables_accessible = False
    leads_total = None
    users_total = None
    last_sf_sync_at = None

    if db_connected:
        try:
            # SET LOCAL statement_timeout is PostgreSQL-only — skip for SQLite
            if db_url_type == "postgresql":
                db.execute(text("SET LOCAL statement_timeout = '2000'"))  # 2s max

            # Row counts — abnormal drop signals mass data loss
            leads_row = db.execute(text("SELECT COUNT(*) FROM leads")).scalar()
            leads_total = int(leads_row)

            users_row = db.execute(text("SELECT COUNT(*) FROM users")).scalar()
            users_total = int(users_row)

            # Last Salesforce sync (most recent completed sync log entry)
            try:
                sf_row = db.execute(text(
                    """
                    SELECT MAX(completed_at)
                    FROM sync_logs
                    WHERE status = 'completed'
                    """
                )).scalar()
                if sf_row:
                    last_sf_sync_at = sf_row.isoformat() if hasattr(sf_row, "isoformat") else str(sf_row)
            except Exception:
                # sync_logs may not exist in all envs — but on Postgres, a failed
                # statement leaves the whole transaction aborted until rolled
                # back, silently failing every db.execute() after this point in
                # the same request (discovered via the journey_* queries below
                # failing with psycopg2.errors.InFailedSqlTransaction).
                db.rollback()

            db_tables_accessible = True
        except Exception:
            db.rollback()

    # ── Scheduler: detect if background thread is alive ────────────────────────
    import threading
    scheduler_alive = any(
        t.is_alive() and ("scheduled" in t.name.lower() or "timer" in t.name.lower())
        for t in threading.enumerate()
    )

    # ── Sales Journey engine health (2026-08-05) ────────────────────────────────
    # scheduler_alive above only proves *some* timer thread is alive — it can't
    # tell "busy" from "stuck." These are the 4 signals docs/SALES_JOURNEY_
    # ARCHITECTURE.md always specified for this endpoint but were never wired up;
    # without them, the journey engine could silently stop advancing every
    # cadence in the system and this check would still say "ok."
    journey_last_tick_at = None
    journey_last_tick_age_seconds = None
    journey_queue_depth = None
    journey_oldest_overdue_seconds = None
    journey_failed_enrollments_24h = None
    if db_tables_accessible:
        try:
            db.rollback()   # belt-and-suspenders: guarantee a clean transaction
                             # regardless of what happened earlier in this request
            import app_state as _app_state
            if _app_state.last_journey_tick_at:
                journey_last_tick_at = _app_state.last_journey_tick_at.isoformat()
                journey_last_tick_age_seconds = round(
                    (datetime.now(timezone.utc) - _app_state.last_journey_tick_at).total_seconds(), 1
                )

            journey_queue_depth = db.execute(text(
                "SELECT COUNT(*) FROM journey_execution_queue WHERE status IN ('pending', 'claimed')"
            )).scalar()

            oldest_overdue = db.execute(text(
                "SELECT MIN(next_run_at) FROM journey_execution_queue WHERE status = 'pending'"
            )).scalar()
            if oldest_overdue:
                now_utc = datetime.now(timezone.utc)
                oldest_dt = oldest_overdue if oldest_overdue.tzinfo else oldest_overdue.replace(tzinfo=timezone.utc)
                journey_oldest_overdue_seconds = max(0, round((now_utc - oldest_dt).total_seconds(), 1))

            journey_failed_enrollments_24h = db.execute(text(
                "SELECT COUNT(*) FROM journey_enrollments "
                "WHERE status = 'failed' AND completed_at >= NOW() - INTERVAL '24 hours'"
            ) if db_url_type == "postgresql" else text(
                "SELECT COUNT(*) FROM journey_enrollments "
                "WHERE status = 'failed' AND completed_at >= datetime('now', '-24 hours')"
            )).scalar()
        except Exception as e:
            db.rollback()   # journey_* tables may not exist in every env — non-fatal
            logger.warning(f"[Monitoring] journey health signals failed: {e}")

    # ── Klenty sync health (2026-08-06) ─────────────────────────────────────────
    # klenty_last_sync_at only advances on a genuine successful run since the
    # RCA 2026-08-06 fix (klenty_provider now raises on a real API rejection
    # instead of silently resolving it as "0 calls" — the abort path returns
    # before this timestamp is touched). Before that fix this signal would
    # have stayed "healthy" through the entire 6-day gap it's meant to catch.
    klenty_enabled = None
    klenty_last_sync_at = None
    klenty_last_sync_age_seconds = None
    if db_tables_accessible:
        try:
            db.rollback()
            settings_row = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if settings_row:
                klenty_enabled = bool(settings_row.klenty_enabled)
                if settings_row.klenty_last_sync_at:
                    last_sync = settings_row.klenty_last_sync_at
                    if last_sync.tzinfo is None:
                        last_sync = last_sync.replace(tzinfo=timezone.utc)
                    klenty_last_sync_at = last_sync.isoformat()
                    klenty_last_sync_age_seconds = round(
                        (datetime.now(timezone.utc) - last_sync).total_seconds(), 1
                    )
        except Exception as e:
            db.rollback()
            logger.warning(f"[Monitoring] klenty health signal failed: {e}")

    # ── RCA Guard: data loss detection (2026-05-13) ────────────────────────────
    # Flags if PostgreSQL has 0 leads — indicates wrong DB or mass data loss.
    # SQLite with 0 leads is always suspicious (SQLite = missing DATABASE_URL).
    data_loss_risk = False
    if db_url_type == "sqlite":
        data_loss_risk = True  # SQLite in prod = misconfiguration
    elif leads_total is not None and leads_total == 0:
        data_loss_risk = True  # PostgreSQL with 0 leads = possible data loss

    # ── Overall status ─────────────────────────────────────────────────────────
    if data_loss_risk:
        overall = "critical"
    elif not (db_connected and db_tables_accessible and app_state.startup_complete):
        overall = "degraded"
    else:
        overall = "ok"

    # ── Cache backend status ─────────────────────────────────────────────────────
    try:
        import cache as _cache_mod
        cache_backend = "redis" if _cache_mod._redis_available else "in-memory"
        cache_keys_in_memory = sum(len(s) for s in _cache_mod._stores.values())
    except Exception:
        cache_backend = "unknown"
        cache_keys_in_memory = -1

    return {
        "status": overall,                          # ← UptimeRobot keyword target
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "startup_complete": app_state.startup_complete,
        "db_connected": db_connected,
        "db_url_type": db_url_type,                 # ← 'postgresql' or 'sqlite' (sqlite = alert!)
        "db_tables_accessible": db_tables_accessible,
        "db_latency_ms": db_latency_ms,
        "leads_total": leads_total,
        "users_total": users_total,
        "data_loss_risk": data_loss_risk,           # ← True = immediate action needed
        "last_sf_sync_at": last_sf_sync_at,
        "scheduler_alive": scheduler_alive,
        "memory_mb": memory_mb,
        "cache_backend": cache_backend,             # ← 'redis' or 'in-memory'
        "cache_keys_in_memory": cache_keys_in_memory,
        "journey_last_tick_at": journey_last_tick_at,
        "journey_last_tick_age_seconds": journey_last_tick_age_seconds,   # ← alert if >> tick interval (30s)
        "journey_queue_depth": journey_queue_depth,                       # ← healthy stays near 0
        "journey_oldest_overdue_seconds": journey_oldest_overdue_seconds, # ← "busy" vs "stuck"
        "journey_failed_enrollments_24h": journey_failed_enrollments_24h,
        "klenty_enabled": klenty_enabled,
        "klenty_last_sync_at": klenty_last_sync_at,
        "klenty_last_sync_age_seconds": klenty_last_sync_age_seconds,  # ← alert if stale >48h while enabled
    }
