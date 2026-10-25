import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# ── DATABASE_URL guard (RCA: 2026-05-13 — silent SQLite fallback caused P1 outage) ──
# DATABASE_URL MUST be explicitly set. We no longer fall back to SQLite silently.
# For local development, set DATABASE_URL=sqlite:///./crm.db in your .env file.
# If DATABASE_URL is missing in production, the deploy will fail immediately with a
# clear error rather than serving empty data for hours.
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

if not SQLALCHEMY_DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is not set. "
        "For production: set it to your PostgreSQL connection string. "
        "For local dev: set DATABASE_URL=sqlite:///./crm.db in your .env file. "
        "NEVER leave it unset — the app will not start."
    )

# Railway/cloud providers sometimes inject postgres://, but SQLAlchemy requires postgresql://
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite needs connect_args={"check_same_thread": False}, otherwise omit for Postgres
if "sqlite" in SQLALCHEMY_DATABASE_URL:
    connect_args = {"check_same_thread": False}
else:
    # connect_timeout prevents startup hangs when DB is unreachable (RCA: May 6 incident)
    connect_args = {"connect_timeout": 10}

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
    # Paid-tier Postgres supports 97 connections.
    # pool_size + max_overflow = 23 per worker. With WEB_CONCURRENCY=2 → 46 total,
    # leaving headroom for admin. Right-sized for 33 active users.
    pool_size=8,            # base persistent connections
    max_overflow=15,        # burst connections (total max = 23 per worker)
    pool_recycle=1800,      # recycle stale connections every 30 min
    pool_pre_ping=True,     # test connections before use (prevents stale conn errors)
    pool_timeout=30,        # seconds to wait for a connection from pool
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── AI-route bulkhead pool (RCA: 2026-09-01) ────────────────────────────────
# A request that calls an LLM provider (Groq) holds its DB connection open,
# idle, for however long that provider takes to answer — including retries
# and a rate-limit backoff sleep. Confirmed live: a Groq outage made
# ai-research requests take 16-93s each; enough of those in flight
# simultaneously (routine — ai-research auto-fires on every lead-detail
# page view) exhausted the shared pool, and a COMPLETELY UNRELATED request
# (GET /api/leads/{id}) then queued for pool_timeout and failed with
# "Couldn't load this lead" — an AI-provider outage taking down an
# unrelated, non-AI feature. A dedicated, separate pool for every
# LLM-calling route means an AI-provider outage, however long or however
# concurrent, can never take a connection away from the rest of the app.
ai_engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
    pool_size=3,
    max_overflow=5,
    pool_recycle=1800,
    pool_pre_ping=True,
    pool_timeout=30,
)
AiSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=ai_engine)

def get_ai_db():
    db = AiSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _table_exists(inspector, table_name: str) -> bool:
    """Check if a table exists."""
    try:
        return table_name in inspector.get_table_names()
    except Exception:
        return False


def _ensure_execution_log_partitions(target_engine):
    """
    Ensure execution_logs table partitions exist for the current month plus 2 months ahead.
    Idempotent (IF NOT EXISTS).
    No-op on SQLite.
    """
    if "postgresql" not in str(target_engine.url):
        return

    from datetime import datetime, timezone
    from sqlalchemy import inspect, text
    import logging
    _log = logging.getLogger(__name__)

    with target_engine.connect() as conn:
        try:
            insp = inspect(target_engine)
            if not _table_exists(insp, "execution_logs"):
                return
            now = datetime.now(timezone.utc)
            year, month = now.year, now.month
            for _ in range(3):
                start = f"{year:04d}-{month:02d}-01"
                next_month = month + 1
                next_year = year
                if next_month > 12:
                    next_month = 1
                    next_year += 1
                end = f"{next_year:04d}-{next_month:02d}-01"
                partition_name = f"execution_logs_{year:04d}_{month:02d}"
                try:
                    conn.execute(text(f"""
                        CREATE TABLE IF NOT EXISTS {partition_name}
                        PARTITION OF execution_logs
                        FOR VALUES FROM ('{start}') TO ('{end}')
                    """))
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    _log.debug(f"[Partitions] Partition {partition_name} check/create skipped: {e}")
                month = next_month
                year = next_year
        except Exception as e:
            _log.warning(f"[Partitions] Error verifying execution log partitions: {e}")


def _ensure_ownership_history(target_engine):
    """
    Install lead ownership history trigger if PostgreSQL and lead_ownership_periods exists.
    """
    if "postgresql" not in str(target_engine.url):
        return
    import logging
    from sqlalchemy import text
    _log = logging.getLogger(__name__)
    try:
        import ownership_history as oh
        with target_engine.begin() as conn:
            conn.execute(text("SELECT pg_advisory_xact_lock(727001)"))
            if not conn.execute(text("SELECT to_regclass('public.lead_ownership_periods')")).scalar():
                _log.warning("[ownership] lead_ownership_periods missing — skipping trigger install")
                return
            oh.install_trigger(conn)
            opened = oh.backfill_current_owners(conn)
            _log.info(f"[ownership] trigger installed; active periods: {opened}")
    except Exception as e:
        _log.error(f"[ownership] trigger installation error (non-fatal): {e}")


def init_database(target_engine=None):
    """
    Idempotent database schema initialization.
    Creates all defined models and ensures required Postgres indexes and partition tables.
    """
    if target_engine is None:
        target_engine = engine

    import logging
    from sqlalchemy import text
    _log = logging.getLogger(__name__)

    # 1. Create all missing tables from SQLAlchemy models
    import models
    models.Base.metadata.create_all(bind=target_engine)
    _log.info("[Schema] Base.metadata.create_all completed")

    # 2. PostgreSQL specific optimizations and indexes
    is_postgres = "postgresql" in str(target_engine.url)
    if is_postgres:
        trgm_stmts = [
            "CREATE EXTENSION IF NOT EXISTS pg_trgm",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_first_name_trgm ON leads USING gin (first_name gin_trgm_ops)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_last_name_trgm ON leads USING gin (last_name gin_trgm_ops)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_email_trgm ON leads USING gin (email gin_trgm_ops)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_company_trgm ON leads USING gin (company gin_trgm_ops)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_phone_trgm ON leads USING gin (phone gin_trgm_ops)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_phone_secondary_trgm ON leads USING gin (phone_secondary gin_trgm_ops)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_company_phone_trgm ON leads USING gin (company_phone gin_trgm_ops)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_status_meeting_scheduled_at ON leads (status, meeting_scheduled_at)",
        ]
        try:
            with target_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as ac_conn:
                for stmt in trgm_stmts:
                    try:
                        ac_conn.execute(text(stmt))
                    except Exception as e:
                        _log.debug(f"[Schema] Index check/create skipped (non-fatal): {e}")
        except Exception as e:
            _log.debug(f"[Schema] Trigram indexing skipped: {e}")

        try:
            with target_engine.connect() as conn:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_journey_versions_graph_gin "
                    "ON journey_versions USING GIN (graph_definition jsonb_path_ops)"
                ))
                conn.commit()
        except Exception as e:
            _log.debug(f"[Schema] GIN index skipped: {e}")

    # 3. Ensure execution log partitions and ownership tracking
    _ensure_execution_log_partitions(target_engine)
    _ensure_ownership_history(target_engine)
    _log.info("[Schema] Schema initialization completed successfully")

