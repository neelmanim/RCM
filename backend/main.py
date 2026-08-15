"""
RCM API — main.py
Slim app entry point: init, lifespan, middleware, and router registration.
All route logic lives in the routes/ package.
"""
from dotenv import load_dotenv
from pathlib import Path
import os
import logging

env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

import models
from database import engine, SessionLocal
from migrations import run_schema_migrations
from salesforce import get_sf_client, sync_leads_from_salesforce

logger = logging.getLogger(__name__)

# NOTE: Schema creation (create_all + migrations) runs in a background thread
# so it doesn't block uvicorn port binding. The schema is already in place
# from previous deployments, so if it hangs/fails, the app still works.


# ── SyncSettings helper ─────────────────────────────────────────────────────
def _get_or_create_sync_settings(db) -> models.SyncSettings:
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        default_limit = int(os.getenv("SF_LEAD_LIMIT", 1000))
        settings = models.SyncSettings(id=1, lead_limit=default_limit, record_type_ids=None)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _log_memory(label: str):
    """Log current process RSS memory in MB."""
    try:
        import resource
        rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports bytes, Linux reports KB
        import platform
        if platform.system() == "Darwin":
            rss_mb = rss_kb / (1024 * 1024)
        else:
            rss_mb = rss_kb / 1024
        logger.info(f"[Memory] {label}: {rss_mb:.1f} MB RSS")
    except Exception:
        pass

def _run_startup_tasks():
    """
    Heavy startup work (schema init, SF sync, scheduled jobs).
    Runs in a daemon thread so uvicorn can bind the port immediately.
    If any step fails, subsequent steps still execute — all are non-fatal.
    """
    import threading
    logger.info(f"[Startup] Background tasks starting on thread {threading.current_thread().name}")
    _log_memory("startup_begin")

    # 0. Create / migrate database tables
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("SELECT 1\n"))
        logger.info("[Startup] Database connection OK")

        # ── RCA Guard (2026-05-13): log DB type on every boot ───────────────
        db_url = str(engine.url)
        db_type = "sqlite" if "sqlite" in db_url else "postgresql"
        if db_type == "sqlite":
            logger.critical(
                "[Startup] ⚠️  RUNNING ON SQLITE — DATABASE_URL may be missing! "
                "All lead queries will return 0. Check Render env vars immediately."
            )
        else:
            safe_url = db_url.split("@")[-1] if "@" in db_url else db_url
            logger.info(f"[Startup] DB type: {db_type} | host: {safe_url}")

        # Run migrations FIRST — before any ORM query that SELECTs all columns.
        # If migrations run after an ORM query, a missing column (e.g. rcm_email)
        # will crash the sanity query and abort the whole try-block, preventing
        # the migration from ever executing. (RCA 2026-05-18)
        #
        # create_all() gets its OWN try/except (RCA 2026-08-04): brand-new
        # tables aren't safely idempotent under concurrent multi-worker boot —
        # two workers both seeing "table missing" via inspector, then racing
        # on the actual CREATE TABLE, throws a duplicate-key error on Postgres'
        # internal catalog for whichever worker loses the race. That's harmless
        # (the table exists either way) EXCEPT it used to abort this whole
        # try-block before run_schema_migrations() ever ran — permanently
        # blocking every column migration below on every subsequent boot,
        # since create_all() keeps hitting the same "already exists" error
        # forever once it's happened once. Sales Journey's 5 new tables hit
        # this in production on the first real Postgres deploy.
        try:
            models.Base.metadata.create_all(bind=engine)
        except Exception as create_all_e:
            logger.warning(f"[Startup] create_all() failed (non-fatal — tables likely already exist from a concurrent worker): {create_all_e}")

        run_schema_migrations(engine)
        logger.info("[Startup] Database schema ready")
        _log_memory("schema_ready")

        # Lead/user count sanity check — runs AFTER migrations so new columns exist.
        # Catches mass data loss or wrong DB connection string.
        try:
            with SessionLocal() as sanity_db:
                import models as _models
                lead_count = sanity_db.query(_models.Lead).count()
                user_count = sanity_db.query(_models.User).count()
                logger.info(f"[Startup] DB sanity: {lead_count} leads, {user_count} users")
                if lead_count == 0 and db_type == "postgresql":
                    logger.warning(
                        "[Startup] ⚠️  PostgreSQL has 0 leads — possible data loss or "
                        "wrong DATABASE_URL. Verify the connection string."
                    )
        except Exception as sanity_e:
            logger.warning(f"[Startup] DB sanity check failed (non-fatal): {sanity_e}")
        # ────────────────────────────────────────────────────────────────────

    except Exception as e:
        logger.error(f"[Startup] Schema creation failed (non-fatal): {e}")



    # 1. Salesforce lead sync (if 2-way sync enabled)
    db = SessionLocal()
    try:
        sf = get_sf_client()
        if sf:
            import json
            settings = _get_or_create_sync_settings(db)
            sync_direction = getattr(settings, 'sync_direction', 'push_only') or 'push_only'
            if sync_direction == "both":
                rtype_ids = json.loads(settings.record_type_ids) if settings.record_type_ids else None
                count = sync_leads_from_salesforce(db, sf, limit=settings.lead_limit, record_type_ids=rtype_ids)
                logger.info(f"Startup sync: {count} leads synced from Salesforce.")
            else:
                logger.info("Startup sync skipped: sync_direction is 'push_only'.")
        else:
            logger.warning("Startup sync skipped: Salesforce credentials not configured.")
    except Exception as e:
        logger.warning(f"Startup sync failed (non-fatal): {e}")
    finally:
        db.close()
    _log_memory("sf_sync_done")

    # 2. Start background scheduled jobs
    try:
        from scheduled_jobs import start_scheduled_jobs
        start_scheduled_jobs()
    except Exception as e:
        logger.warning(f"Failed to start scheduled jobs: {e}")

    _log_memory("startup_complete")
    import app_state
    app_state.startup_complete = True
    logger.info("[Startup] Background tasks complete — service fully ready")


@asynccontextmanager
async def lifespan(app):
    """
    FastAPI lifespan handler.
    Yields IMMEDIATELY so uvicorn binds the port right away,
    then kicks off heavy startup tasks in a background thread.
    This prevents Render's 'port scan timeout' error.
    """
    import threading
    startup_thread = threading.Thread(
        target=_run_startup_tasks,
        daemon=True,
        name="startup_tasks",
    )
    startup_thread.start()
    logger.info("[Startup] Server ready — background tasks running in thread")

    yield

    # Shutdown: stop scheduled jobs
    try:
        from scheduled_jobs import stop_scheduled_jobs
        stop_scheduled_jobs()
    except Exception:
        pass


# ── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="RCM API",
    description="SDR-focused lightweight CRM with POD teams and enriched lead management",
    version="2.0.0",
    lifespan=lifespan
)

# ── CORS — allow configured frontend origin(s) ──────────────────────────────
# FRONTEND_URLS: comma-separated list of allowed origins (e.g. staging + develop)
# Falls back to FRONTEND_URL (single), then wildcard for co-hosted mode.
_frontend_url = os.getenv("FRONTEND_URL", "").strip()
_frontend_urls_raw = os.getenv("FRONTEND_URLS", "").strip()
if _frontend_urls_raw:
    _cors_origins = [u.strip() for u in _frontend_urls_raw.split(",") if u.strip()]
elif _frontend_url:
    _cors_origins = [_frontend_url]
else:
    _cors_origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)  # Compress responses > 500 bytes (70-80% smaller JSON)

# ── Cache-Control headers (SWR pattern for instant repeat page loads) ────────
from middleware_cache_headers import CacheHeaderMiddleware
app.add_middleware(CacheHeaderMiddleware)

# ── Startup readiness gate — REMOVED ─────────────────────────────────────────
# Previously gated API requests until schema migration completed. Removed
# because create_all() consistently hangs on the remote DB connection during
# cold starts, causing 45+ seconds of 503 errors. The schema is already in
# place from previous deployments, so gating provides no benefit.
# See: RCA prod incident 2026-05-06

# ── UndefinedColumn race handler ─────────────────────────────────────────────
# RCA 2026-07-24: because the gate above stays removed (a blocking gate caused
# the worse 45s regression), a deploy that adds a column a hot-path SELECT
# touches has a brief window where new code serves traffic before its own
# ALTER TABLE commits (7 requests, ~1s, self-healed — /admin/call-logs and
# /my/tasks/pending both `SELECT *`-join leads for calendar_event_agenda).
# Shared with the test app (conftest.py) so behavior matches in tests.
from exception_handlers import register_exception_handlers
register_exception_handlers(app)

# ── Query profiling (opt-in via QUERY_PROFILING=true env var) ────────────────
try:
    from middleware import attach_profiler
    attach_profiler(app, engine)
except Exception as e:
    logger.debug(f"Query profiler not attached: {e}")

# ── Serve frontend (opt-in via SERVE_FRONTEND=true, default: always) ─────────
# When frontend is deployed as a separate static site, set SERVE_FRONTEND=false
# to stop the backend from serving static files and free memory.
_serve_frontend = os.getenv("SERVE_FRONTEND", "true").lower() in ("true", "1", "yes")
if _serve_frontend:
    _frontend_path = Path(__file__).parent.parent / "frontend"
    if _frontend_path.exists():
        app.mount("/frontend", StaticFiles(directory=str(_frontend_path), html=True), name="frontend")


# ── Register route modules ──────────────────────────────────────────────────
from routes.auth_routes import router as auth_router
from routes.lead_routes import router as lead_router
from routes.call_routes import router as call_router
from routes.note_routes import router as note_router
from routes.task_routes import router as task_router
from routes.search_routes import router as search_router
from routes.admin_routes import router as admin_router
from routes.pod_routes import router as pod_router
from routes.leaderboard_routes import router as leaderboard_router
from routes.sf_log_routes import router as sf_log_router
from routes.sdr_performance_routes import router as sdr_performance_router
from routes.sf_connection_routes import router as sf_connection_router
from routes.metrics_routes import router as metrics_router
from routes.email_routes import router as email_router
from routes.webhook_routes import router as webhook_router
from routes.ai_research_routes import router as ai_research_router
from routes.dialer_routes import router as dialer_router
from routes.attachment_routes import router as attachment_router
from routes.public_api_routes import router as public_api_router
from routes.analytics_routes import router as analytics_router
from routes.growth_intelligence_routes import router as growth_intelligence_router
from routes.admin_user_routes import router as admin_user_router
from routes.admin_assignment_routes import router as admin_assignment_router
from routes.disqualify_routes import router as disqualify_router
from routes.admin_sync_routes import router as admin_sync_router
from routes.admin_upload_routes import router as admin_upload_router
from routes.analytics_ai_routes import router as analytics_ai_router
from routes.analytics_digest_routes import router as analytics_digest_router
from routes.activity_feed_routes import router as activity_feed_router
from routes.sandbox_routes import router as sandbox_router
from routes.error_log_routes import router as error_log_router
from routes.monitoring_routes import router as monitoring_router
from routes.sms_routes import router as sms_router  # V33: RCM Floating Widget
from routes.conversations_routes import router as conversations_router  # V34: Native Converse Desk
from routes.integration_health_routes import router as integration_health_router  # V35: Dialer + Chat health diagnostics
from routes.sse_routes import router as sse_router  # V36: SSE real-time call events
from routes.smart_analytics_routes import router as smart_analytics_router  # V41: Smart Analytics NL queries
from routes.perf_routes import router as perf_router  # v8.9.9: Phase 4 performance monitoring
from routes.tag_routes import router as tag_router  # Leads redesign: per-lead tags
from routes.journey_routes import router as journey_router  # Sales Journey Phase 0

app.include_router(auth_router)
app.include_router(growth_intelligence_router)  # Before lead_router to avoid /leads/{lead_id} shadowing
app.include_router(lead_router)
app.include_router(call_router)
app.include_router(note_router)
app.include_router(task_router)
app.include_router(search_router)
app.include_router(admin_router)
app.include_router(pod_router)
app.include_router(leaderboard_router)
app.include_router(sf_log_router)
app.include_router(sdr_performance_router)
app.include_router(sf_connection_router)
app.include_router(metrics_router)
app.include_router(analytics_router)
app.include_router(email_router)
app.include_router(webhook_router)
app.include_router(ai_research_router)
app.include_router(dialer_router)
app.include_router(attachment_router)
app.include_router(public_api_router)
app.include_router(admin_user_router)
app.include_router(admin_assignment_router)
app.include_router(disqualify_router)
app.include_router(admin_sync_router)
app.include_router(admin_upload_router)
app.include_router(analytics_ai_router)
app.include_router(analytics_digest_router)
app.include_router(activity_feed_router)
app.include_router(sandbox_router)
app.include_router(error_log_router)
app.include_router(monitoring_router)
app.include_router(sms_router)  # V33: RCM Floating Widget SMS
app.include_router(conversations_router)  # V34: Native Converse Desk conversations
app.include_router(integration_health_router)  # V35: Integration health diagnostics
app.include_router(sse_router)  # V36: SSE real-time call events
app.include_router(smart_analytics_router)  # V41: Smart Analytics NL queries
app.include_router(perf_router)  # v8.9.9: Phase 4 performance monitoring
app.include_router(tag_router)  # Leads redesign: per-lead tags
app.include_router(journey_router)  # Sales Journey Phase 0


# ── Global unhandled exception handler ───────────────────────────────────────
# Catches any unhandled 500 that slips past route-level try/except.
# Logs to error_logs in plain English, then returns the standard 500 JSON.
# IMPORTANT: This handler must NOT call log_error with its own db on failure
# (that would recurse). We open a fresh session and swallow all exceptions.
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    try:
        from database import SessionLocal
        from error_logger import log_backend_exception
        # Try to extract user info from request state (set by auth middleware if present)
        user_id    = getattr(getattr(request, 'state', None), 'user_id', None)
        user_email = getattr(getattr(request, 'state', None), 'user_email', None)
        user_name  = getattr(getattr(request, 'state', None), 'user_name', None)
        user_role  = getattr(getattr(request, 'state', None), 'user_role', None)
        db = SessionLocal()
        try:
            log_backend_exception(
                db=db,
                exc=exc,
                category="api",
                feature="API",
                endpoint=str(request.url.path),
                http_status=500,
                context={"method": request.method, "path": str(request.url.path)},
                user_id=user_id,
                user_email=user_email,
                user_name=user_name,
                user_role=user_role,
            )
        finally:
            db.close()
    except Exception:
        pass  # Never let the error handler crash
    logger.error(f"[GlobalHandler] Unhandled exception on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Our team has been notified."},
    )



@app.get("/")
def root():
    """Redirect root to the frontend application."""
    _fe_url = os.getenv("FRONTEND_URL", "").strip()
    if _fe_url:
        return RedirectResponse(url=_fe_url)
    return RedirectResponse(url="/frontend/index.html")

@app.get("/api/seed_demo_temp")
def seed_demo_temp():
    try:
        from database import SessionLocal
        from models import Lead
        from faker import Faker
        import random
        
        db = SessionLocal()
        fake = Faker()
        num_leads = 50
        
        # 1. Clean up existing demo data
        deleted = db.query(Lead).filter(Lead.lead_source == 'demo_seed').delete()
        
        # 2. Generate new leads
        lead_types = ['Insurance', 'Real Estate']
        
        leads_to_insert = []
        for _ in range(num_leads):
            lead_type = random.choice(lead_types)
            lead = Lead(
                first_name=fake.first_name(),
                last_name=fake.last_name(),
                email=fake.ascii_safe_email(),
                phone=fake.phone_number()[:20],
                company=fake.company(),
                title=fake.job()[:50],
                status="Lead Assigned",
                lead_source="demo_seed",
                is_test=True,
                city=fake.city(),
                state=fake.state(),
                industry=lead_type,
                employee_count=random.randint(10, 500),
                annual_revenue=f"${random.randint(1, 100)}M",
                research_company=f"Leading {lead_type} firm specializing in targeted growth.",
                research_contact="Key decision maker.",
                research_geo=fake.state(),
                research_heat=random.choice(["hot", "warm", "cold"])
            )
            leads_to_insert.append(lead)
            
        db.add_all(leads_to_insert)
        db.commit()
        db.close()
        return {"success": True, "message": f"Seeded {num_leads} leads! Deleted {deleted} old leads."}
    except Exception as e:
        return {"success": False, "error": str(e)}

