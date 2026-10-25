"""
Database schema management module.
Initializes tables, partition structures, and performance indexes idempotently.
Compatible with SQLite (local development) and PostgreSQL (Railway production).
"""
import logging
from sqlalchemy import text, inspect
import models

logger = logging.getLogger(__name__)


def _table_exists(inspector, table_name: str) -> bool:
    """Check if a table exists."""
    try:
        return table_name in inspector.get_table_names()
    except Exception:
        return False


def _ensure_execution_log_partitions(engine):
    """
    Ensure execution_logs table partitions exist for the current month plus 2 months ahead.
    Idempotent (IF NOT EXISTS).
    No-op on SQLite.
    """
    if "postgresql" not in str(engine.url):
        return

    from datetime import datetime, timezone
    with engine.connect() as conn:
        try:
            insp = inspect(engine)
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
                    logger.debug(f"[Partitions] Partition {partition_name} check/create skipped: {e}")
                month = next_month
                year = next_year
        except Exception as e:
            logger.warning(f"[Partitions] Error verifying execution log partitions: {e}")


def _ensure_ownership_history(engine):
    """
    Install lead ownership history trigger if PostgreSQL and lead_ownership_periods exists.
    """
    if "postgresql" not in str(engine.url):
        return
    try:
        import ownership_history as oh
        with engine.begin() as conn:
            conn.execute(text("SELECT pg_advisory_xact_lock(727001)"))
            if not conn.execute(text("SELECT to_regclass('public.lead_ownership_periods')")).scalar():
                logger.warning("[ownership] lead_ownership_periods missing — skipping trigger install")
                return
            oh.install_trigger(conn)
            opened = oh.backfill_current_owners(conn)
            logger.info(f"[ownership] trigger installed; active periods: {opened}")
    except Exception as e:
        logger.error(f"[ownership] trigger installation error (non-fatal): {e}")


def run_schema_migrations(engine=None):
    """
    Idempotent schema initialization.
    Creates all defined models and ensures required Postgres indexes.
    """
    if engine is None:
        from database import engine as default_engine
        engine = default_engine

    # 1. Create all missing tables from SQLAlchemy models
    models.Base.metadata.create_all(bind=engine)
    logger.info("[Schema] Base.metadata.create_all completed")

    # 2. PostgreSQL specific optimizations and indexes
    is_postgres = "postgresql" in str(engine.url)
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
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as ac_conn:
                for stmt in trgm_stmts:
                    try:
                        ac_conn.execute(text(stmt))
                    except Exception as e:
                        logger.debug(f"[Schema] Index check/create skipped (non-fatal): {e}")
        except Exception as e:
            logger.debug(f"[Schema] Trigram indexing skipped: {e}")

        # GIN index for journey graph definitions
        try:
            with engine.connect() as conn:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_journey_versions_graph_gin "
                    "ON journey_versions USING GIN (graph_definition jsonb_path_ops)"
                ))
                conn.commit()
        except Exception as e:
            logger.debug(f"[Schema] GIN index skipped: {e}")

    # 3. Ensure execution log partitions and ownership tracking
    _ensure_execution_log_partitions(engine)
    _ensure_ownership_history(engine)
    logger.info("[Schema] Schema initialization completed successfully")
