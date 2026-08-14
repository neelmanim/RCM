# ── routes/perf_routes.py — Performance monitoring endpoints (Phase 4) ──────
"""
Exposes two Super Admin-only endpoints:

  GET /api/admin/perf-summary
      Aggregates perf_metrics (last 24h) from DB + merges with in-memory
      rolling window stats.  Returns RAIL distribution, slowest endpoints,
      index health, and RCM API health.

  GET /api/admin/perf-index-health
      Queries pg_indexes to confirm all expected performance indexes exist.
      Returns a healthy/unhealthy flag + list of any missing indexes.
"""

import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from auth import require_super_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["Admin – Performance"])

# Indexes we require to be present for production performance
EXPECTED_INDEXES = [
    "idx_leads_status_pod",
    "idx_leads_status_created_at",
    "idx_leads_status_changed_at_status",
    "idx_leads_company_notnull",
    "idx_leads_company_trgm",
    "idx_leads_first_name_trgm",
    "idx_leads_last_name_trgm",
    "idx_leads_email_trgm",
    "idx_leads_company_lower_trim",
    "idx_leads_created_at",
    "idx_call_logs_lead_id",
    "idx_call_logs_user_called_at",
    "idx_dialer_calls_user_created",
    "idx_dialer_calls_user_dir_created",
    "idx_dialer_calls_created_at",
    "idx_lead_assignments_lead_id",
    # v8.9.9 additions
    "idx_leads_priority_score",
    "idx_lead_status_logs_changed_at",
    "idx_lead_assignments_user_id",
    "idx_leads_pod_id",
]


def _get_index_health(db: Session) -> dict:
    """Check pg_indexes for all expected indexes. Returns healthy flag + missing list."""
    try:
        rows = db.execute(text(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
        )).fetchall()
        present = {r[0] for r in rows}
        missing = [idx for idx in EXPECTED_INDEXES if idx not in present]
        return {
            "healthy": len(missing) == 0,
            "total_expected": len(EXPECTED_INDEXES),
            "total_present": len(EXPECTED_INDEXES) - len(missing),
            "missing_indexes": missing,
        }
    except Exception as e:
        logger.warning("[PerfRoutes] pg_indexes check failed (non-PostgreSQL?): %s", e)
        return {
            "healthy": None,
            "total_expected": len(EXPECTED_INDEXES),
            "total_present": None,
            "missing_indexes": [],
            "note": "Index health check unavailable (not PostgreSQL or insufficient permissions)",
        }


def _get_rcm_health(db: Session) -> dict:
    """Last RCM 502 timestamp + today's error count from perf context.
    Reads from error_logs table (where [RCM] 502 entries are stored)."""
    try:
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        row = db.execute(text("""
            SELECT COUNT(*) AS cnt, MAX(created_at) AS last_at
            FROM error_logs
            WHERE message LIKE '%RCM%502%'
              AND created_at >= :today_start
        """), {"today_start": today_start}).fetchone()
        if row:
            return {
                "errors_today": row[0] or 0,
                "last_502_at": row[1].isoformat() if row[1] else None,
                "healthy": (row[0] or 0) == 0,
            }
    except Exception:
        pass
    return {"errors_today": 0, "last_502_at": None, "healthy": True}


@router.get("/perf-summary")
def get_perf_summary(
    hours: int = 24,
    since_deploy: bool = False,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_super_admin),
):
    """
    Returns a performance snapshot for the given window:
    - RAIL tier distribution (OK / ACCEPTABLE / SLOW / CRITICAL)
    - Top 10 slowest endpoints by P95 (from DB + in-memory rolling window)
    - Index health (pg_indexes check)
    - RCM API health (502 error count today)

    Query params:
      hours       — lookback window in hours (default 24)
      since_deploy — if true, window starts from process startup_time (overrides hours)
    """
    import app_state
    if since_deploy:
        since = app_state.startup_time
        window_label = "since_deploy"
    else:
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        window_label = f"{hours}h"

    # ── DB aggregates ────────────────────────────────────────────────────────
    try:
        rail_rows = db.execute(text("""
            SELECT rail_tier, COUNT(*) AS cnt
            FROM perf_metrics
            WHERE recorded_at >= :since
            GROUP BY rail_tier
        """), {"since": since}).fetchall()
        rail_dist = {"OK": 0, "ACCEPTABLE": 0, "SLOW": 0, "CRITICAL": 0}
        for tier, cnt in rail_rows:
            if tier in rail_dist:
                rail_dist[tier] = cnt
        total_requests = sum(rail_dist.values())

        slowest_rows = db.execute(text("""
            SELECT
                endpoint,
                COUNT(*) AS cnt,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                MAX(duration_ms) AS max_ms,
                SUM(CASE WHEN rail_tier = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_count
            FROM perf_metrics
            WHERE recorded_at >= :since
            GROUP BY endpoint
            ORDER BY p95 DESC
            LIMIT 10
        """), {"since": since}).fetchall()

        slowest_endpoints = [
            {
                "endpoint": r[0],
                "count": r[1],
                "p50_ms": round(float(r[2]), 1) if r[2] else None,
                "p95_ms": round(float(r[3]), 1) if r[3] else None,
                "max_ms": r[4],
                "critical_count": r[5],
            }
            for r in slowest_rows
        ]
        db_available = True
    except Exception as e:
        logger.warning("[PerfRoutes] perf_metrics query failed (table may not exist yet): %s", e)
        # Fall back to in-memory rolling window only
        from middleware.timing import get_all_stats
        stats = get_all_stats()
        rail_dist = {"OK": 0, "ACCEPTABLE": 0, "SLOW": 0, "CRITICAL": 0}
        total_requests = sum(s["samples"] for s in stats)
        slowest_endpoints = [
            {
                "endpoint": s["endpoint"],
                "count": s["samples"],
                "p50_ms": s["p50_ms"],
                "p95_ms": s["p95_ms"],
                "max_ms": s["max_ms"],
                "critical_count": None,
            }
            for s in stats[:10]
        ]
        db_available = False

    # ── Supplement with in-memory stats (current session, not yet committed) ──
    if db_available:
        try:
            from middleware.timing import get_all_stats
            mem_stats = get_all_stats()
            # Merge: if an endpoint is in memory but not in DB, add it
            db_endpoints = {e["endpoint"] for e in slowest_endpoints}
            for s in mem_stats[:10]:
                if s["endpoint"] not in db_endpoints and len(slowest_endpoints) < 15:
                    slowest_endpoints.append({
                        "endpoint": s["endpoint"],
                        "count": s["samples"],
                        "p50_ms": s["p50_ms"],
                        "p95_ms": s["p95_ms"],
                        "max_ms": s["max_ms"],
                        "critical_count": None,
                        "_source": "in_memory",
                    })
            slowest_endpoints.sort(key=lambda x: x.get("p95_ms") or 0, reverse=True)
            slowest_endpoints = slowest_endpoints[:10]
        except Exception:
            pass

    index_health = _get_index_health(db)
    rcm_health = _get_rcm_health(db)

    return {
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
        "window_hours": hours,
        "window_label": window_label,
        "since_deploy": since_deploy,
        "deploy_time": app_state.startup_time.isoformat() if since_deploy else None,
        "total_requests": total_requests,
        "rail_distribution": rail_dist,
        "slowest_endpoints": slowest_endpoints,
        "index_health": index_health,
        "rcm_health": rcm_health,
        "data_source": "db" if db_available else "in_memory_only",
    }


@router.get("/perf-index-health")
def get_perf_index_health(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_super_admin),
):
    """
    Confirms all expected performance indexes are present in pg_indexes.
    Returns healthy=True when all indexes exist, False + list of missing ones otherwise.
    """
    return _get_index_health(db)
