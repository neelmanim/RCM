"""
Schema migrations module.
Runs idempotent ALTER TABLE / UPDATE statements to patch existing databases.
Works with both SQLite (local dev) and PostgreSQL (Render production).

Migration tracking: data migrations are recorded in _applied_migrations so each
runs exactly once — never on restart/redeploy. This prevents full-table UPDATE
scans from competing with DDL locks on startup.
"""
from sqlalchemy import text, inspect
import logging

logger = logging.getLogger(__name__)


# ── Migration tracker helpers ─────────────────────────────────────────────────

def _ensure_migration_tracker(conn):
    """Create the one-time migration log table if it doesn't exist."""
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS _applied_migrations (
            name VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.commit()


def _migration_applied(conn, name: str) -> bool:
    """Return True if a named migration has already been recorded."""
    try:
        row = conn.execute(
            text("SELECT 1 FROM _applied_migrations WHERE name = :name"),
            {"name": name}
        ).fetchone()
        return row is not None
    except Exception:
        return False  # Table may not exist yet — safe to run the migration


def _mark_migration_applied(conn, name: str):
    """Record a migration as applied (idempotent via ON CONFLICT DO NOTHING)."""
    conn.execute(
        text("INSERT INTO _applied_migrations (name, applied_at) VALUES (:name, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING"),
        {"name": name}
    )
    conn.commit()


def _column_exists(inspector, table_name, column_name):
    """Check if a column exists in a table (works for SQLite and PostgreSQL)."""
    try:
        columns = [col["name"] for col in inspector.get_columns(table_name)]
        return column_name in columns
    except Exception:
        return False


def _table_exists(inspector, table_name):
    """Check if a table exists."""
    return table_name in inspector.get_table_names()


def _backfill_lead_upload_log_ids(engine):
    """One-time backfill: link pre-existing leads to the LeadUploadLog batch they
    likely came from. lead_source (e.g. "gsheet:Google Sheet:2026-07-14T10:29:04...")
    has no reliably machine-parseable filename (the name itself may contain colons),
    so this matches on created_at proximity instead — done in Python, not a single
    raw SQL UPDATE, since timestamp arithmetic differs too much between SQLite and
    Postgres to express safely as one portable statement. Leads with no confident
    match within the window are left NULL — acceptable, "All uploads" is a valid
    default in the Upload filter.
    """
    from datetime import datetime, timezone, timedelta
    migration_name = "leads_backfill_upload_log_id"
    with engine.connect() as conn:
        _ensure_migration_tracker(conn)
        if _migration_applied(conn, migration_name):
            return
        try:
            logs = conn.execute(text(
                "SELECT id, created_at FROM lead_upload_logs ORDER BY created_at"
            )).fetchall()
            if not logs:
                _mark_migration_applied(conn, migration_name)
                return
            leads = conn.execute(text(
                "SELECT id, created_at FROM leads WHERE upload_log_id IS NULL "
                "AND (lead_source LIKE 'upload:%' OR lead_source LIKE 'gsheet:%')"
            )).fetchall()

            def _parse(ts):
                if ts is None:
                    return None
                if isinstance(ts, datetime):
                    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
                try:
                    return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                except ValueError:
                    return None

            window = timedelta(minutes=10)
            parsed_logs = [(lid, _parse(created)) for lid, created in logs]
            parsed_logs = [(lid, created) for lid, created in parsed_logs if created]

            matched = 0
            for lead_id, lead_created in leads:
                lc = _parse(lead_created)
                if not lc:
                    continue
                best_id, best_delta = None, window
                for log_id, log_created in parsed_logs:
                    delta = abs(lc - log_created)
                    if delta <= best_delta:
                        best_delta, best_id = delta, log_id
                if best_id:
                    conn.execute(
                        text("UPDATE leads SET upload_log_id = :log_id WHERE id = :lead_id"),
                        {"log_id": best_id, "lead_id": lead_id},
                    )
                    matched += 1
            conn.commit()
            _mark_migration_applied(conn, migration_name)
            logger.info(f"[Migration] {migration_name}: linked {matched}/{len(leads)} candidate leads")
        except Exception as e:
            conn.rollback()
            logger.warning(f"[Migration] {migration_name} failed (non-fatal): {e}")


def _backfill_klenty_started_at_and_disposition(engine):
    """One-time backfill for existing Klenty dialer_calls rows (V47).

    Two independent fixes, both sourced from the row's own already-stored
    raw_payload (no API calls needed):
    1. started_at IS NULL rows were misattributed to created_at (sync time)
       instead of the real call time — backfill from raw_payload's endTime,
       the same fallback klenty_provider.py now applies for new syncs.
    2. provider_disposition is a brand-new column — backfill it from
       raw_payload's own "disposition" field for every existing Klenty row,
       not just the started_at-NULL ones, so Connect Rate reflects real
       telephony connects for calls already synced before this fix shipped.
    """
    import json as _json
    from klenty_provider import _parse_ts

    migration_name = "klenty_backfill_started_at_and_disposition"
    with engine.connect() as conn:
        _ensure_migration_tracker(conn)
        if _migration_applied(conn, migration_name):
            return
        try:
            rows = conn.execute(text("""
                SELECT id, started_at, raw_payload FROM dialer_calls
                WHERE provider = 'klenty' AND raw_payload IS NOT NULL
            """)).fetchall()
            fixed_started_at = 0
            fixed_disposition = 0
            for row_id, started_at, raw_payload in rows:
                try:
                    payload = _json.loads(raw_payload)
                except (TypeError, ValueError):
                    continue
                disposition = payload.get("disposition") or None
                end_time = _parse_ts(payload.get("endTime"))
                if started_at is None and end_time:
                    conn.execute(
                        text("UPDATE dialer_calls SET started_at = :ts, provider_disposition = :disp WHERE id = :id"),
                        {"ts": end_time, "disp": disposition, "id": row_id},
                    )
                    fixed_started_at += 1
                    if disposition:
                        fixed_disposition += 1
                elif disposition:
                    conn.execute(
                        text("UPDATE dialer_calls SET provider_disposition = :disp WHERE id = :id"),
                        {"disp": disposition, "id": row_id},
                    )
                    fixed_disposition += 1
            conn.commit()
            _mark_migration_applied(conn, migration_name)
            logger.info(
                f"[Migration] {migration_name}: fixed started_at on {fixed_started_at} rows, "
                f"backfilled provider_disposition on {fixed_disposition}/{len(rows)} rows"
            )
        except Exception as e:
            conn.rollback()
            logger.warning(f"[Migration] {migration_name} failed (non-fatal): {e}")


def _ensure_execution_log_partitions(engine):
    """Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md): execution_logs is
    range-partitioned by created_at on Postgres — a partitioned table with zero
    partitions rejects every INSERT, so at least the current month's partition
    must exist before the app can write to it. Creates the current month plus
    2 months ahead, idempotently (IF NOT EXISTS), every boot — cheap, and self-
    heals if a future monthly partition-creation job (Phase 4) is ever delayed.
    No-op on SQLite (dev/test) — partitioning doesn't apply there; the plain
    table created by create_all() already accepts inserts directly.
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
            for _ in range(3):  # current month + 2 ahead
                start = f"{year:04d}-{month:02d}-01"
                next_month = month + 1
                next_year = year
                if next_month > 12:
                    next_month = 1
                    next_year += 1
                end = f"{next_year:04d}-{next_month:02d}-01"
                partition_name = f"execution_logs_{year:04d}_{month:02d}"
                try:
                    conn.execute(text(
                        f"CREATE TABLE IF NOT EXISTS {partition_name} "
                        f"PARTITION OF execution_logs FOR VALUES FROM ('{start}') TO ('{end}')"
                    ))
                    conn.commit()
                    logger.info(f"[Migration] Partition ready: {partition_name}")
                except Exception as e:
                    conn.rollback()
                    logger.warning(f"[Migration] Partition {partition_name} skipped (non-fatal): {e}")
                year, month = next_year, next_month
        except Exception as e:
            logger.warning(f"[Migration] execution_logs partition setup failed (non-fatal): {e}")


def run_schema_migrations(engine):
    """Add new columns and migrate data for V2 features."""

    # Column migrations: (table, column, sql_type, default)
    column_additions = [
        # V1
        ("users", "last_login_at", "TIMESTAMP", None),
        ("leads", "record_type_id", "VARCHAR", None),
        # V2: User pod membership
        ("users", "pod_id", "VARCHAR", None),
        ("users", "sf_sdr_id", "VARCHAR", None),
        # V2: Lead source & enrichment
        ("leads", "lead_source", "VARCHAR", "'salesforce'"),
        ("leads", "pod_id", "VARCHAR", None),
        ("leads", "linkedin_url", "VARCHAR", None),
        ("leads", "person_linkedin", "VARCHAR", None),
        ("leads", "website", "VARCHAR", None),
        ("leads", "city", "VARCHAR", None),
        ("leads", "state", "VARCHAR", None),
        ("leads", "country", "VARCHAR", None),
        ("leads", "industry", "VARCHAR", None),
        ("leads", "employee_count", "INTEGER", None),
        ("leads", "annual_revenue", "VARCHAR", None),
        ("leads", "total_funding", "VARCHAR", None),
        ("leads", "company_phone", "VARCHAR", None),
        ("leads", "company_linkedin", "VARCHAR", None),
        ("leads", "company_street", "VARCHAR", None),
        ("leads", "company_city", "VARCHAR", None),
        ("leads", "company_postal_code", "VARCHAR", None),
        ("leads", "company_state", "VARCHAR", None),
        ("leads", "company_country", "VARCHAR", None),
        ("leads", "company_founded", "VARCHAR", None),
        # V2: Research fields
        ("leads", "research_company", "TEXT", None),
        ("leads", "research_contact", "TEXT", None),
        ("leads", "research_hypothesis", "TEXT", None),
        ("leads", "research_personalization", "TEXT", None),
        # V2: Sync settings
        ("sync_settings", "sf_push_stage", "VARCHAR", "'Meeting Scheduled'"),
        # V3: Status time tracking
        ("leads", "status_changed_at", "TIMESTAMP", None),
        # V3: Extended research fields (guided form)
        ("leads", "research_industry", "VARCHAR", None),
        ("leads", "research_company_size", "VARCHAR", None),
        ("leads", "research_services", "TEXT", None),
        ("leads", "research_geo", "VARCHAR", None),
        ("leads", "research_timezone", "VARCHAR", None),
        ("leads", "research_hook", "TEXT", None),
        ("leads", "research_channels", "TEXT", None),
        # V3: POD settings
        ("sync_settings", "allow_multi_pod_sdr", "BOOLEAN", "false"),
        # V4: One-way sync direction
        ("sync_settings", "sync_direction", "VARCHAR", "'push_only'"),
        # V5 Phase 3: Lead lifecycle & attempt tracking
        ("leads", "call_attempt_count", "INTEGER", "0"),
        ("leads", "last_call_timestamp", "TIMESTAMP", None),
        ("leads", "lead_started_at", "TIMESTAMP", None),
        ("leads", "lead_closed_at", "TIMESTAMP", None),
        ("leads", "closed_reason", "VARCHAR", None),
        # V5 Phase 3: Configurable caps & attempt limits
        ("sync_settings", "active_lead_cap", "INTEGER", "5"),
        ("sync_settings", "max_call_attempts", "INTEGER", "5"),
        ("sync_settings", "min_call_attempts_for_unreachable", "INTEGER", "3"),
        ("sync_settings", "sync_declined_to_salesforce", "BOOLEAN", "false"),
        ("sync_settings", "sync_unreachable_to_salesforce", "BOOLEAN", "false"),
        ("sync_settings", "terminal_lead_cooldown_days", "INTEGER", "30"),
        ("sync_settings", "conversation_min_seconds", "INTEGER", "30"),
        # V5 Phase 3: Per-POD lead cap + admin assignment
        # NOTE (2026-07-11): "pods.admin_id" entry deliberately removed from this list.
        # It was unconditionally re-adding the column on every boot (this list runs
        # BEFORE data_migrations), which silently undid v10_drop_pods_admin_id the
        # very first time it ran — the column came right back on the next restart
        # before anyone noticed. New DBs still get admin_id via the CREATE TABLE
        # statement below; existing DBs already have it. Do not re-add this entry —
        # it's what makes the deferred DROP COLUMN (see data_migrations) stick permanently.
        ("pods", "active_lead_cap", "INTEGER", "5"),
        # V8: Opportunity outcome tracking
        ("leads", "opportunity_status", "VARCHAR", None),
        ("leads", "opportunity_notes", "TEXT", None),
        ("leads", "opportunity_updated_at", "TIMESTAMP", None),
        ("leads", "opportunity_updated_by", "VARCHAR", None),
        # V9: Upload Center – "update existing" mode
        ("lead_upload_logs", "updated", "INTEGER", "0"),
        # V12: AI Research – LLM settings on SyncSettings
        ("sync_settings", "llm_provider", "VARCHAR", "'groq'"),
        ("sync_settings", "llm_api_key", "TEXT", None),
        ("sync_settings", "llm_model", "VARCHAR", "'gemma2-9b-it'"),
        # V13: Activity-based session tracking
        ("login_logs", "last_heartbeat_at", "TIMESTAMP", None),
        # V14: Dialer provider integration
        ("users", "dialer_user_id", "VARCHAR", None),
        ("sync_settings", "dialer_provider", "VARCHAR", "'none'"),
        ("sync_settings", "dialer_api_id", "VARCHAR", None),
        ("sync_settings", "dialer_api_token", "TEXT", None),
        ("sync_settings", "dialer_webhook_token", "VARCHAR", None),
        # V15: Dialer call outcome & transcript
        ("dialer_calls", "outcome", "VARCHAR", None),
        ("dialer_calls", "notes", "TEXT", None),
        ("dialer_calls", "transcript", "TEXT", None),
        # V16: No-show tracking
        ("leads", "no_show_count", "INTEGER", "0"),
        # V17: Per-SDR dialer & email sync access toggles
        ("users", "dialer_enabled", "BOOLEAN", "false"),
        ("users", "email_sync_enabled", "BOOLEAN", "false"),
        # V18: RCM / RCM Messaging messaging integration
        ("sync_settings", "rcm_enabled", "BOOLEAN", "false"),
        ("sync_settings", "rcm_base_url", "VARCHAR", "'https://app.bercm.com'"),
        ("sync_settings", "rcm_api_key", "VARCHAR", None),
        ("sync_settings", "rcm_user_id", "VARCHAR", None),
        ("sync_settings", "rcm_access_token", "TEXT", None),
        # V18: Audience Manager contact reference on leads
        ("leads", "am_record_id", "VARCHAR", None),
        # V19: Per-SDR RCM user ID for conversation tagging
        ("users", "rcm_user_id", "VARCHAR", None),
        # V20: Email open tracking
        ("lead_email_activity", "opened_at", "TIMESTAMPTZ", None),
        ("lead_email_activity", "open_count", "INTEGER", "0"),
        # V21: Email attachment metadata
        ("lead_email_activity", "attachments_json", "TEXT", None),
        # V22: Lead deprioritization
        ("leads", "priority_score", "INTEGER", "100"),
        # V22: Task notification columns (user ownership + scheduling)
        ("tasks", "user_id", "VARCHAR", None),
        ("tasks", "due_time", "TIMESTAMPTZ", None),
        ("tasks", "snoozed_until", "TIMESTAMPTZ", None),
        ("tasks", "dismissed", "VARCHAR", "'false'"),
        # V23: Public API key for CMT ↔ SF bridge (encrypted, managed via Settings UI)
        ("sync_settings", "public_api_key", "TEXT", None),
        # V24: Aircall headless sync
        ("leads",         "times_called",         "INTEGER",   "0"),
        ("dialer_calls",  "source",                "VARCHAR",   "'rcm'"),
        ("sync_settings", "aircall_last_sync_at",  "TIMESTAMP", None),
        # V25: RCM Contact Center dialer (dual-dialer architecture)
        ("users",          "dialer_provider_override", "VARCHAR",   None),
        ("sync_settings",  "rcm_from_number",   "VARCHAR",   None),
        ("sync_settings",  "rcm_last_sync_at",  "TIMESTAMP", None),
        # V26: Upload tag — optional source label (e.g. "Apollo", "Lusha")
        ("lead_upload_logs", "tag", "VARCHAR", None),
        # V27: Per-SDR RCM caller ID (senderId) — each SDR can override the global from_number
        ("users", "rcm_from_number", "VARCHAR", None),
        # V28: Separate dialer credentials — Contact Center may use different RCM account
        ("sync_settings", "dialer_use_shared_creds", "BOOLEAN", "true"),
        ("sync_settings", "dialer_base_url", "VARCHAR", None),
        ("sync_settings", "dialer_api_key", "TEXT", None),
        ("sync_settings", "dialer_user_id", "VARCHAR", None),
        # V29: Dynamic call outcome configuration (Phase 2)
        ("sync_settings", "outcome_config", "TEXT", None),
        # V30: Sandbox Refresh — API-to-API tokenized export
        ("sync_settings", "sandbox_token", "TEXT", None),
        ("sync_settings", "sandbox_prod_url", "TEXT", None),
        ("sync_settings", "sandbox_prod_token", "TEXT", None),
        ("sync_settings", "sandbox_last_refresh_at", "TIMESTAMP", None),
        ("sync_settings", "sandbox_last_refresh_status", "VARCHAR", None),
        ("sync_settings", "sandbox_refresh_lead_count", "INTEGER", None),
        # V31: Custom AI Research Prompt template (Super Admin configurable)
        ("sync_settings", "research_prompt", "TEXT", None),
        # V34: RCM Converse Desk account ID (for native Conversations API)
        ("sync_settings", "rcm_account_id", "VARCHAR", None),
        # V35: RCM sender number (WhatsApp/SMS sender ID e.g. "918956778474")
        ("sync_settings",  "rcm_sender_id",   "VARCHAR",   None),
        # Messaging provider selection — "rcm" (default) or "aircall"
        ("sync_settings", "messaging_provider", "VARCHAR", "'rcm'"),
        ("sync_settings", "aircall_messaging_number_id", "VARCHAR", None),
        # V36: Discovery meeting tracking
        ("leads", "discovery_meeting_count", "INTEGER", "0"),
        # Cadence/Messaging Sandbox
        ("leads", "is_test", "BOOLEAN", "false"),
        ("sync_settings", "sandbox_test_phone_number", "VARCHAR", None),
        # V37: Pending-review meeting lifecycle state (placeholder — no new columns)
        # V38: Per-SDR RCM login email (audit/display only; not used in API calls)
        ("users", "rcm_email", "VARCHAR", None),
        # V39: Aircall tag → outcome mapping (admin-configurable JSON)
        ("sync_settings", "aircall_tag_mapping", "TEXT", None),
        # V40 (Research v2): Pre-Call Intelligence Card
        ("leads",             "research_heat",                    "VARCHAR",  None),
        ("leads",             "research_opening",                 "TEXT",     None),
        ("sync_settings",     "require_research_before_calling",  "BOOLEAN",  "false"),
        ("company_research",  "research_heat",                    "VARCHAR",  None),
        ("company_research",  "research_opening",                 "TEXT",     None),
        # V42: Pinned AI Reports — customizable Dashboard cards (v8.9.0)
        ("analytics_saved_reports", "is_pinned", "BOOLEAN", "false"),
        ("analytics_saved_reports", "pin_order",  "INTEGER", "0"),
        # Unified calendar: actual scheduled meeting datetime (matches models.Lead)
        ("leads", "meeting_scheduled_at", "TIMESTAMP", None),
        # Leads redesign: link a lead back to the specific import batch it came from
        # (matches models.Lead.upload_log_id) — powers the per-file Upload filter.
        ("leads", "upload_log_id", "VARCHAR", None),
        # V43: Klenty call-activity pull sync (temporary bridge — matches models.py)
        ("sync_settings", "klenty_enabled",      "BOOLEAN",   "false"),
        ("sync_settings", "klenty_api_key",      "TEXT",      None),
        ("sync_settings", "klenty_last_sync_at", "TIMESTAMP", None),
        ("users",         "klenty_username",     "VARCHAR",   None),
        # V44: Salesforce auto-sync schedule (matches models.py)
        ("sync_settings", "sf_auto_sync_enabled",     "BOOLEAN",   "false"),
        ("sync_settings", "sf_auto_sync_hour_utc",    "INTEGER",   None),
        ("sync_settings", "sf_auto_sync_minute_utc",  "INTEGER",   "0"),
        ("sync_settings", "sf_auto_sync_last_run_at", "TIMESTAMP", None),
        # V45: Real Nylas calendar event on "Meeting Confirmed" (matches models.py)
        ("leads", "nylas_event_id",     "VARCHAR", None),
        ("leads", "calendar_event_url", "VARCHAR", None),
        # V46: Persist resolved meeting title/agenda for Calendar Hub visibility (matches models.py)
        ("leads", "calendar_event_title",  "VARCHAR", None),
        ("leads", "calendar_event_agenda", "TEXT",    None),
        # V47: Raw provider telephony disposition (Klenty's ANSWERED/NOT_ANSWERED/etc.) —
        # distinct from dialer_calls.outcome, which batch-synced calls never get.
        ("dialer_calls", "provider_disposition", "VARCHAR", None),
        # Sales Journey Phase 0 (docs/SALES_JOURNEY_ARCHITECTURE.md, Gap 1):
        # contact-suppression gate, checked before every automated send.
        ("leads", "do_not_contact",  "BOOLEAN",   "false"),
        ("leads", "unsubscribed_at", "TIMESTAMP", None),
        # V48: Aircall Everywhere (embedded browser softphone) — org-wide kill switch
        # (matches models.py). Default off until piloted.
        ("sync_settings", "aircall_everywhere_enabled", "BOOLEAN", "false"),
        # v10.9.4: per-user opt-out of the "RCM · Powered by RCM"
        # footer on sent mail (matches models.py).
        ("users", "hide_branding_in_email", "BOOLEAN", "false"),
        # v10.9.4: per-user rich-text email signature (matches models.py).
        ("users", "email_signature_html", "TEXT", None),
        # v10.9.5: email sync health field (matches models.py).
        ("sync_settings", "email_sync_last_run_at", "TIMESTAMP", None),
        # v10.9.8: Sales Cadence pod scoping (matches models.py). NULL = all pods.
        ("journeys", "pod_id", "VARCHAR", None),
        # v10.9.9: Sales Cadence send-time window + engagement tracking (matches models.py).
        ("journeys", "send_tz", "VARCHAR", None),
        ("journeys", "send_window_start_hour", "INTEGER", None),
        ("journeys", "send_window_end_hour", "INTEGER", None),
        ("journeys", "send_days", "VARCHAR", None),
        ("lead_email_activity", "clicked_at", "TIMESTAMP", None),
        ("lead_email_activity", "click_count", "INTEGER", "0"),
        ("lead_email_activity", "is_auto_reply", "BOOLEAN", "false"),
        ("lead_email_activity", "journey_id", "VARCHAR", None),
        ("lead_email_activity", "enrollment_id", "VARCHAR", None),
        ("lead_email_activity", "journey_node_id", "VARCHAR", None),
        ("lead_email_activity", "variant_key", "VARCHAR", None),
        # v10.9.9: SMS cadence step — journey linkage on the existing sms_logs table.
        ("sms_logs", "journey_id", "VARCHAR", None),
        ("sms_logs", "enrollment_id", "VARCHAR", None),
        ("sms_logs", "journey_node_id", "VARCHAR", None),
        # v10.9.13: give the RCM Widget's manual sends the same persistence
        # the Cadence engine already had — sms_logs now covers both, distinguished
        # by channel/provider so a future second provider (e.g. Aircall) fits the
        # same table instead of a parallel one.
        ("sms_logs", "channel", "VARCHAR", "'sms'"),
        ("sms_logs", "provider", "VARCHAR", "'rcm'"),
        ("sms_logs", "conversation_id", "VARCHAR", None),
        ("sms_logs", "template_name", "VARCHAR", None),
        # v10.9.11: per-pod timezone for Analytics day-boundary bucketing (matches models.py). NULL = UTC.
        ("pods", "timezone", "VARCHAR", None),
    ]

    table_creates = [
        # V2: PODs table (complete — matches models.Pod)
        """CREATE TABLE IF NOT EXISTS pods (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            admin_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            active_lead_cap INTEGER DEFAULT 5,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V10: Pod Admins junction table — supports multiple Pod Admins per pod
        """CREATE TABLE IF NOT EXISTS pod_admins (
            id VARCHAR PRIMARY KEY,
            pod_id VARCHAR NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
            user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            assigned_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT uq_pod_admins_pod_user UNIQUE (pod_id, user_id)
        )""",
        """CREATE INDEX IF NOT EXISTS idx_pod_admins_pod_id ON pod_admins (pod_id)""",
        """CREATE INDEX IF NOT EXISTS idx_pod_admins_user_id ON pod_admins (user_id)""",

        # V2: Upload logs table (complete — matches models.LeadUploadLog)
        """CREATE TABLE IF NOT EXISTS lead_upload_logs (
            id VARCHAR PRIMARY KEY,
            uploaded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            filename VARCHAR,
            total_rows INTEGER DEFAULT 0,
            created INTEGER DEFAULT 0,
            skipped INTEGER DEFAULT 0,
            updated INTEGER DEFAULT 0,
            errors INTEGER DEFAULT 0,
            error_detail TEXT,
            status VARCHAR DEFAULT 'completed',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V5: Salesforce integration logs (complete — matches models.SalesforceIntegrationLog)
        """CREATE TABLE IF NOT EXISTS salesforce_integration_logs (
            id VARCHAR PRIMARY KEY,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            operation_type VARCHAR NOT NULL,
            sf_object VARCHAR DEFAULT 'Lead',
            record_identifier VARCHAR,
            first_name VARCHAR,
            last_name VARCHAR,
            email VARCHAR,
            fields_updated TEXT,
            status VARCHAR NOT NULL,
            error_message TEXT,
            request_payload TEXT,
            response_payload TEXT,
            source_system VARCHAR DEFAULT 'api'
        )""",
        # V7: Login audit logs (complete — matches models.LoginLog)
        """CREATE TABLE IF NOT EXISTS login_logs (
            id VARCHAR PRIMARY KEY,
            user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR NOT NULL,
            name VARCHAR,
            role VARCHAR,
            ip_address VARCHAR,
            user_agent VARCHAR,
            login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            logout_at TIMESTAMP,
            last_heartbeat_at TIMESTAMP
        )""",
        # V7: User feedback (complete — matches models.Feedback)
        """CREATE TABLE IF NOT EXISTS feedback (
            id VARCHAR PRIMARY KEY,
            user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            user_email VARCHAR,
            user_name VARCHAR,
            type VARCHAR DEFAULT 'general',
            message TEXT NOT NULL,
            status VARCHAR DEFAULT 'new',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V10: Salesforce UI connection management (complete — matches models.SalesforceConnection)
        """CREATE TABLE IF NOT EXISTS salesforce_connections (
            id VARCHAR PRIMARY KEY,
            instance_url VARCHAR,
            environment VARCHAR DEFAULT 'sandbox',
            username VARCHAR NOT NULL,
            password_encrypted TEXT NOT NULL,
            security_token_encrypted TEXT NOT NULL,
            org_id VARCHAR,
            org_name VARCHAR,
            connected_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            connected_by_name VARCHAR,
            connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_sync_at TIMESTAMP,
            last_sync_status VARCHAR,
            last_sync_error TEXT,
            records_synced_last_run INTEGER DEFAULT 0,
            connection_status VARCHAR DEFAULT 'connected',
            is_active BOOLEAN DEFAULT true
        )""",
        # V10: SDR activity logging (complete — matches models.UserActivityLog)
        """CREATE TABLE IF NOT EXISTS user_activity_logs (
            id VARCHAR PRIMARY KEY,
            user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
            user_email VARCHAR,
            user_name VARCHAR,
            action_type VARCHAR NOT NULL,
            object_type VARCHAR,
            object_id VARCHAR,
            metadata_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V10: Pre-aggregated daily user metrics (complete — matches models.UserActivityDailySummary)
        """CREATE TABLE IF NOT EXISTS user_activity_daily_summary (
            id VARCHAR PRIMARY KEY,
            summary_date VARCHAR NOT NULL,
            user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
            user_email VARCHAR,
            user_name VARCHAR,
            login_count INTEGER DEFAULT 0,
            lead_views INTEGER DEFAULT 0,
            status_updates INTEGER DEFAULT 0,
            meetings_scheduled INTEGER DEFAULT 0,
            calls_logged INTEGER DEFAULT 0,
            leads_assigned INTEGER DEFAULT 0,
            exports INTEGER DEFAULT 0,
            total_actions INTEGER DEFAULT 0,
            time_spent_minutes INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V11: Nylas email integration (complete — matches models.NylasConfig)
        """CREATE TABLE IF NOT EXISTS nylas_config (
            id INTEGER PRIMARY KEY,
            client_id VARCHAR,
            api_key_encrypted TEXT,
            redirect_uri VARCHAR,
            webhook_secret_encrypted TEXT,
            configured_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            configured_by_name VARCHAR,
            configured_at TIMESTAMP,
            is_active BOOLEAN DEFAULT false
        )""",
        # V11: User mailboxes (complete — matches models.UserMailbox)
        """CREATE TABLE IF NOT EXISTS user_mailboxes (
            id VARCHAR PRIMARY KEY,
            user_id VARCHAR NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            email_address VARCHAR NOT NULL,
            provider VARCHAR,
            nylas_grant_id VARCHAR NOT NULL,
            status VARCHAR DEFAULT 'connected',
            connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V14: Dialer calls (complete — matches models.DialerCall)
        """CREATE TABLE IF NOT EXISTS dialer_calls (
            id VARCHAR PRIMARY KEY,
            lead_id VARCHAR REFERENCES leads(id) ON DELETE SET NULL,
            user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            provider VARCHAR NOT NULL,
            provider_call_id VARCHAR,
            phone_number VARCHAR,
            status VARCHAR NOT NULL,
            direction VARCHAR,
            duration INTEGER,
            recording_url VARCHAR,
            outcome VARCHAR,
            notes TEXT,
            transcript TEXT,
            started_at TIMESTAMP,
            answered_at TIMESTAMP,
            ended_at TIMESTAMP,
            raw_payload TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V11: Lead email activity (complete — matches models.LeadEmailActivity)
        """CREATE TABLE IF NOT EXISTS lead_email_activity (
            id VARCHAR PRIMARY KEY,
            lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            direction VARCHAR NOT NULL,
            subject VARCHAR,
            body_preview TEXT,
            from_email VARCHAR,
            to_email VARCHAR,
            nylas_message_id VARCHAR,
            nylas_thread_id VARCHAR,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            opened_at TIMESTAMP,
            open_count INTEGER DEFAULT 0,
            attachments_json TEXT
        )""",
        # V11: Email threads (complete — matches models.EmailThread)
        """CREATE TABLE IF NOT EXISTS email_threads (
            id VARCHAR PRIMARY KEY,
            nylas_thread_id VARCHAR NOT NULL UNIQUE,
            lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V12: AI Research – Company-level cache (complete — matches models.CompanyResearch)
        """CREATE TABLE IF NOT EXISTS company_research (
            id VARCHAR PRIMARY KEY,
            company_name VARCHAR NOT NULL UNIQUE,
            research_company TEXT,
            research_industry VARCHAR,
            research_company_size VARCHAR,
            research_services TEXT,
            research_geo VARCHAR,
            research_timezone VARCHAR,
            research_hook TEXT,
            research_hypothesis TEXT,
            research_personalization TEXT,
            research_contact TEXT,
            research_channels TEXT,
            raw_ai_response TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V22: Lead file attachments (complete — matches models.LeadAttachment)
        """CREATE TABLE IF NOT EXISTS lead_attachments (
            id VARCHAR PRIMARY KEY,
            lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            original_filename VARCHAR NOT NULL,
            stored_filename VARCHAR NOT NULL,
            file_size BIGINT DEFAULT 0,
            mime_type VARCHAR,
            uploaded_by_name VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        # V32: Global error audit log (complete — matches models.ErrorLog)
        """CREATE TABLE IF NOT EXISTS error_logs (
            id VARCHAR PRIMARY KEY,
            user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            user_email VARCHAR,
            user_name VARCHAR,
            user_role VARCHAR,
            severity VARCHAR NOT NULL DEFAULT 'warning',
            source VARCHAR NOT NULL DEFAULT 'backend',
            category VARCHAR NOT NULL DEFAULT 'general',
            feature VARCHAR,
            title VARCHAR NOT NULL,
            description TEXT,
            action_hint VARCHAR,
            http_status INTEGER,
            endpoint VARCHAR,
            raw_error TEXT,
            context_json TEXT,
            dedup_key VARCHAR,
            dedup_count INTEGER NOT NULL DEFAULT 1,
            last_seen_at TIMESTAMPTZ,
            resolved BOOLEAN NOT NULL DEFAULT false,
            resolved_by VARCHAR,
            resolved_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )""",
        # V33: RCM Floating Widget — widget fields on sync_settings + sms_logs table
        "ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS widget_enabled BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS widget_position VARCHAR DEFAULT 'bottom-right'",
        "ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS widget_theme VARCHAR DEFAULT 'dark'",
        "ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS widget_allowed_domains TEXT",
        """CREATE TABLE IF NOT EXISTS sms_logs (
            id VARCHAR PRIMARY KEY,
            message_id VARCHAR,
            lead_id VARCHAR REFERENCES leads(id) ON DELETE SET NULL,
            user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            direction VARCHAR NOT NULL,
            status VARCHAR NOT NULL DEFAULT 'sent',
            phone_number VARCHAR,
            message_text TEXT,
            sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_sms_logs_message_id ON sms_logs(message_id)",
        "CREATE INDEX IF NOT EXISTS ix_sms_logs_lead_id ON sms_logs(lead_id)",
        # V41: Smart Analytics — saved reports + query history (v8.5.0)
        """CREATE TABLE IF NOT EXISTS analytics_saved_reports (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            created_by VARCHAR REFERENCES users(id) ON DELETE CASCADE,
            role_scope VARCHAR,
            natural_language_query TEXT NOT NULL,
            dsl_json TEXT NOT NULL,
            chart_type VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS analytics_query_history (
            id VARCHAR PRIMARY KEY,
            user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
            natural_language_query TEXT NOT NULL,
            dsl_json TEXT,
            success BOOLEAN NOT NULL DEFAULT false,
            execution_time_ms INTEGER,
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS idx_analytics_saved_reports_created_by ON analytics_saved_reports(created_by)",
        "CREATE INDEX IF NOT EXISTS idx_analytics_query_history_user_id ON analytics_query_history(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_analytics_query_history_created_at ON analytics_query_history(created_at DESC)",

        # ── v8.9.9: Performance metrics table (Phase 4) ──────────────────────────────
        # Stores RAIL-tier data for every API request (rolling 24h window).
        # Persists across deploys (unlike in-memory buffer). Purged by scheduled_jobs.
        """CREATE TABLE IF NOT EXISTS perf_metrics (
            id VARCHAR PRIMARY KEY,
            endpoint VARCHAR NOT NULL,
            method VARCHAR(10) NOT NULL,
            duration_ms INTEGER NOT NULL,
            rail_tier VARCHAR(20) NOT NULL,
            status_code INTEGER,
            recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS idx_perf_metrics_recorded_at ON perf_metrics (recorded_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_perf_metrics_endpoint ON perf_metrics (endpoint, recorded_at DESC)",

        # ── Leads redesign: Tags (matches models.Tag / models.lead_tags) ────────
        """CREATE TABLE IF NOT EXISTS tags (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS lead_tags (
            lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            tag_id VARCHAR NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (lead_id, tag_id)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_lead_tags_tag_id ON lead_tags (tag_id)",

        # ── Account disqualify maker-checker (matches models.DisqualifyRequest) ──
        """CREATE TABLE IF NOT EXISTS disqualify_requests (
            id VARCHAR PRIMARY KEY,
            company VARCHAR NOT NULL,
            lead_ids TEXT NOT NULL,
            reason VARCHAR NOT NULL,
            requested_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR NOT NULL DEFAULT 'pending',
            reviewed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMP,
            rejection_reason VARCHAR
        )""",
        "CREATE INDEX IF NOT EXISTS idx_disqualify_requests_company ON disqualify_requests (company)",
        "CREATE INDEX IF NOT EXISTS idx_disqualify_requests_status ON disqualify_requests (status)",
    ]


    # Each entry is (unique_name, sql). The name is recorded in _applied_migrations
    # after first successful execution — preventing repeated full-table scans on
    # every restart/redeploy. Add new migrations at the END; never rename existing ones.
    data_migrations = [
        ("v2_status_new_to_assigned",
         "UPDATE leads SET status = 'Lead Assigned' WHERE status IN ('New', 'Closed Lost')"),
        ("v2_status_contacted_to_calling",
         "UPDATE leads SET status = 'Calling' WHERE status IN ('Contacted', 'No Answer', 'Left Voicemail', 'Callback Scheduled')"),
        ("v2_status_qualified_to_meeting",
         "UPDATE leads SET status = 'Meeting Scheduled' WHERE status IN ('Qualified', 'Closed Won')"),
        ("v2_role_normalize_users",
         "UPDATE users SET role = 'Super Admin' WHERE role IN ('Admin', 'admin', 'Super_Admin')"),
        ("v2_role_normalize_allowed",
         "UPDATE allowed_users SET role = 'Super Admin' WHERE role IN ('Admin', 'admin', 'Super_Admin')"),
        ("v2_primary_admin_users",
         "UPDATE users SET role = 'Super Admin' WHERE email = 'neelmani.mishra@screen-magic.com'"),
        ("v2_primary_admin_allowed",
         "UPDATE allowed_users SET role = 'Super Admin' WHERE email = 'neelmani.mishra@screen-magic.com'"),
        ("v2_call_outcomes_normalize",
         "UPDATE call_logs SET outcome = 'No Answer' WHERE outcome IN ('Answered', 'Do Not Call')"),
        ("v3_backfill_status_changed_at",
         "UPDATE leads SET status_changed_at = created_at WHERE status_changed_at IS NULL"),
        ("v5_backfill_lead_started_at",
         "UPDATE leads SET lead_started_at = created_at WHERE lead_started_at IS NULL"),
        ("v5_backfill_call_attempt_count",
         "UPDATE leads SET call_attempt_count = 0 WHERE call_attempt_count IS NULL"),
        ("v6_migrate_declined_unreachable",
         "UPDATE leads SET closed_reason = status, status = 'Disqualified' WHERE status IN ('Customer Declined', 'Unreachable')"),
        ("v16_backfill_no_show_count",
         "UPDATE leads SET no_show_count = 0 WHERE no_show_count IS NULL"),
        ("v24_backfill_times_called", """
            UPDATE leads
            SET times_called = (
                SELECT COUNT(*) FROM dialer_calls
                WHERE dialer_calls.lead_id = leads.id
                AND dialer_calls.direction = 'outbound'
                AND dialer_calls.status = 'CALL_ENDED'
            )
            WHERE times_called IS NULL OR times_called = 0
        """),
        ("v24_backfill_dialer_source",
         "UPDATE dialer_calls SET source = 'rcm' WHERE source IS NULL"),
        # V10: Pod Admin multi-admin architecture
        # Step 1 — backfill pod_admins from pods.admin_id (runs once, idempotent via INSERT ... ON CONFLICT)
        ("v10_backfill_pod_admins_from_admin_id", """
            INSERT INTO pod_admins (id, pod_id, user_id, assigned_at)
            SELECT
                CONCAT('pa_', pods.id) AS id,
                pods.id AS pod_id,
                pods.admin_id AS user_id,
                CURRENT_TIMESTAMP AS assigned_at
            FROM pods
            WHERE pods.admin_id IS NOT NULL
            ON CONFLICT (pod_id, user_id) DO NOTHING
        """),
        # Step 2 — clean up Pod Admin rows from lead_assignments (they see leads via pod scoping now).
        # Row count is logged before this runs — see the special-cased handling below.
        ("v10_clean_lead_assignments_pod_admins", """
            DELETE FROM lead_assignments
            WHERE user_id IN (
                SELECT id FROM users WHERE role = 'Pod Admin'
            )
        """),
        # Step 3 (DROP COLUMN pods.admin_id) is intentionally NOT here.
        # Splitting it into a separate deploy so it can only run after Step 1's backfill
        # has been verified in prod — dropping the column in the same deploy as the
        # migration that depends on it having succeeded is a one-way door if Step 1
        # silently failed. Ship this in a follow-up migrations.py change once
        # `SELECT COUNT(*) FROM pods WHERE admin_id IS NOT NULL` and the corresponding
        # `pod_admins` backfill have been confirmed to match in prod:
        #   ("v10_drop_pods_admin_id", "ALTER TABLE pods DROP COLUMN IF EXISTS admin_id"),

        # Unified calendar: leads already sitting in "Meeting Scheduled" status
        # before this release have no meeting_scheduled_at (it's only set going
        # forward, on new call-outcome logging — see call_routes.py) and would
        # otherwise be invisible on the calendar despite having a real meeting
        # booked. status_changed_at is the best available proxy for "when this
        # was scheduled" — not exact, but far better than absent.
        ("v_backfill_meeting_scheduled_at", """
            UPDATE leads SET meeting_scheduled_at = status_changed_at
            WHERE status = 'Meeting Scheduled' AND meeting_scheduled_at IS NULL
        """),
    ]

    with engine.connect() as conn:
        insp = inspect(engine)

        # 0. Ensure migration tracker table exists (idempotent)
        try:
            _ensure_migration_tracker(conn)
        except Exception as e:
            logger.warning(f"Migration tracker setup failed (non-fatal): {e}")

        # 1. Create new tables first
        for stmt in table_creates:
            try:
                conn.execute(text(stmt))
                conn.commit()
                logger.info("Table created (or already exists)")
            except Exception as e:
                conn.rollback()
                logger.warning(f"Table create skipped: {e}")

        # 2. Add columns — use raw information_schema query (NOT inspector) to
        #    bypass SQLAlchemy's cached schema reflection, which was silently
        #    returning True for columns that didn't exist yet on PostgreSQL.
        is_postgres = "postgresql" in str(engine.url)
        for table, column, col_type, default in column_additions:
            if not _table_exists(insp, table):
                logger.info(f"Skipping column {table}.{column} — table doesn't exist yet")
                continue
            # Use raw SQL check to avoid inspector cache issues on PostgreSQL
            if is_postgres:
                exists_row = conn.execute(text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = :t AND column_name = :c"
                ), {"t": table, "c": column}).fetchone()
                col_already_exists = exists_row is not None
            else:
                col_already_exists = _column_exists(insp, table, column)
            if col_already_exists:
                continue  # Already exists, skip silently
            default_clause = f" DEFAULT {default}" if default else ""
            stmt = f"ALTER TABLE {table} ADD COLUMN {column} {col_type}{default_clause}"
            try:
                # No lock_timeout here — a cold-start lock caused a silent failure
                # on production (2026-05-13 incident). We'd rather wait than skip.
                conn.execute(text(stmt))
                conn.commit()
                logger.info(f"Added column {table}.{column}")
            except Exception as e:
                conn.rollback()
                msg = str(e).lower()
                if "already exists" in msg or "duplicate column" in msg:
                    # Benign: a concurrent instance (Render briefly runs old+new
                    # together during a rolling deploy) won the race and added this
                    # column first. The column now exists — the end state we wanted,
                    # not a real failure. RCA 2026-07-14: two instances overlapping
                    # during a deploy.
                    logger.info(f"Column {table}.{column} added by a concurrent instance — continuing")
                    continue
                # Re-raise so the app fails loudly instead of booting into a broken
                # state where ORM SELECT * queries crash (ProgrammingError).
                # RCA: 2026-05-13 — lock_timeout silently skipped discovery_meeting_count
                raise RuntimeError(
                    f"CRITICAL: Column migration failed for {table}.{column} — "
                    f"app cannot start safely. Fix the DB manually or check locks. "
                    f"Original error: {e}"
                ) from e
        # 3. Convert ENUM columns to VARCHAR (PostgreSQL only)
        #    V1 used SQLAlchemy Enum types; V2 uses plain String/VARCHAR
        #    ONLY run if the column is still an ENUM type — ALTER TYPE on an
        #    already-VARCHAR column takes an AccessExclusiveLock and blocks all
        #    reads. Checking pg_attribute first avoids the deadlock entirely.
        is_postgres = "postgresql" in str(engine.url)
        if is_postgres:
            enum_conversions = [
                ("users", "role"),
                ("allowed_users", "role"),
                ("leads", "status"),
                ("call_logs", "outcome"),
            ]
            for table, column in enum_conversions:
                try:
                    # Check current data type — skip if already character varying
                    result = conn.execute(text(
                        "SELECT data_type FROM information_schema.columns "
                        "WHERE table_name = :t AND column_name = :c"
                    ), {"t": table, "c": column}).fetchone()
                    if result and result[0] in ("character varying", "text", "varchar"):
                        logger.info(f"Skipping {table}.{column} — already {result[0]}")
                        continue
                    # Set a short lock timeout so we never block the whole app
                    conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                    conn.execute(text(
                        f"ALTER TABLE {table} ALTER COLUMN {column} TYPE VARCHAR(255) USING {column}::text"
                    ))
                    conn.commit()
                    logger.info(f"Converted {table}.{column} to VARCHAR")
                except Exception as e:
                    conn.rollback()
                    logger.warning(f"Enum conversion {table}.{column}: {e}")

        # 4. Data migrations — each runs EXACTLY ONCE (tracked in _applied_migrations)
        for migration_name, stmt in data_migrations:
            try:
                if _migration_applied(conn, migration_name):
                    logger.debug(f"[Migration] {migration_name} already applied, skipping")
                    continue
                # Destructive migration — gated on Step 1 (backfill) having actually
                # succeeded, and logged, so a prod incident has an audit trail instead
                # of "some rows vanished" (RCA 2026-07-11). Without this gate, Step 1
                # silently failing (e.g. a transient FK/lock issue) would still let
                # this DELETE run — losing lead_assignments with no pod_admins
                # safety net created to replace them.
                if migration_name == "v10_clean_lead_assignments_pod_admins":
                    unbackfilled = conn.execute(text("""
                        SELECT COUNT(*) FROM pods p
                        WHERE p.admin_id IS NOT NULL
                        AND NOT EXISTS (
                            SELECT 1 FROM pod_admins pa
                            WHERE pa.pod_id = p.id AND pa.user_id = p.admin_id
                        )
                    """)).fetchone()[0]
                    if unbackfilled > 0:
                        logger.warning(
                            f"[Migration] {migration_name}: SKIPPED — {unbackfilled} "
                            f"pod(s) with admin_id not yet backfilled into pod_admins. "
                            f"Will retry on next boot once the backfill catches up."
                        )
                        continue
                    count_row = conn.execute(text("""
                        SELECT COUNT(*) FROM lead_assignments
                        WHERE user_id IN (SELECT id FROM users WHERE role = 'Pod Admin')
                    """)).fetchone()
                    logger.info(
                        f"[Migration] {migration_name}: about to delete "
                        f"{count_row[0] if count_row else 0} lead_assignments rows"
                    )
                conn.execute(text(stmt))
                conn.commit()
                _mark_migration_applied(conn, migration_name)
                logger.info(f"[Migration] Applied: {migration_name}")
            except Exception as e:
                conn.rollback()
                logger.warning(f"[Migration] {migration_name} failed (non-fatal): {e}")

        # 5. Index migrations (idempotent)
        index_creates = [
            # V18: Company resolution — efficient same-company lookups
            "CREATE INDEX IF NOT EXISTS idx_leads_company_lower ON leads (LOWER(company))",
            # V24: Deduplicate dialer calls by provider + external call ID
            # Partial index: only index non-empty provider_call_id values
            """CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_calls_dedup
               ON dialer_calls (provider, provider_call_id)
               WHERE provider_call_id IS NOT NULL AND provider_call_id != ''""",
            # V25: CRITICAL — lead_assignments composite PK is (user_id, lead_id),
            # meaning lead_id lookups (used by ALL assignment JOINs) do a full scan.
            "CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead_id ON lead_assignments (lead_id)",
            # V26: call-logs admin view — ORDER BY created_at DESC + user_id filter
            # Without this, every page load does a full 11k+ row scan on dialer_calls.
            "CREATE INDEX IF NOT EXISTS idx_dialer_calls_user_created ON dialer_calls (user_id, created_at DESC)",
            # V27: dialer_calls ordered view — ORDER BY created_at DESC (no user filter)
            "CREATE INDEX IF NOT EXISTS idx_dialer_calls_created_at ON dialer_calls (created_at DESC)",
            # V28: SDR daily metrics — call_logs filtered by user_id + called_at (auth + SF push)
            # Without this, every login fetches all call logs for the user.
            "CREATE INDEX IF NOT EXISTS idx_call_logs_user_called_at ON call_logs (user_id, called_at DESC)",

            # ── v8.9.5-perf: Phase 2 performance indexes (from RAIL monitoring data) ──
            # call_logs lead_id — missing on staging; present on prod; used by _batch_latest_activity
            "CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id ON call_logs (lead_id)",

            # dashboard-stats (570ms, 20 calls/session): GROUP BY status scoped to pod_id
            # Eliminates full-table scan on the most-called endpoint in the app
            "CREATE INDEX IF NOT EXISTS idx_leads_status_pod ON leads (status, pod_id)",

            # dashboard-stats + admin analytics: date-filtered status counts
            "CREATE INDEX IF NOT EXISTS idx_leads_status_created_at ON leads (status, created_at DESC)",

            # analytics trend/sdr-table (764–963ms): time-window GROUP BY with status filter
            """CREATE INDEX IF NOT EXISTS idx_leads_status_changed_at_status
               ON leads (status_changed_at DESC, status)
               WHERE status_changed_at IS NOT NULL""",

            # companies DISTINCT (812ms): partial index skips NULL/empty rows
            """CREATE INDEX IF NOT EXISTS idx_leads_company_notnull
               ON leads (company)
               WHERE company IS NOT NULL AND company <> ''""",

            # leaderboard (469ms): outbound filter + date range on dialer_calls
            "CREATE INDEX IF NOT EXISTS idx_dialer_calls_user_dir_created ON dialer_calls (user_id, direction, created_at DESC)",

            # ── v8.9.9-perf: Phase 2 remediation — 4 indexes confirmed missing from prod ──
            # leads/my (2,735ms): ORDER BY priority_score DESC, created_at DESC — full table sort
            # without this index every SDR page load sorts 12k+ rows in memory
            "CREATE INDEX IF NOT EXISTS idx_leads_priority_score ON leads (priority_score DESC, created_at DESC)",

            # activity-feed (1,665ms): ORDER BY changed_at DESC LIMIT 50 — full scan of lead_status_logs
            "CREATE INDEX IF NOT EXISTS idx_lead_status_logs_changed_at ON lead_status_logs (changed_at DESC)",

            # Leads redesign: Upload filter — GET /leads?upload_log_id=... lookups
            "CREATE INDEX IF NOT EXISTS idx_leads_upload_log_id ON leads (upload_log_id)",

            # leads/my SDR path: _build_lead_query filters lead_assignments WHERE user_id = ?
            # The join table has a PK on (user_id, lead_id) but the existing idx is on lead_id only.
            # Adding user_id index makes the SDR-scoped subquery use an index scan instead of seq scan.
            "CREATE INDEX IF NOT EXISTS idx_lead_assignments_user_id ON lead_assignments (user_id)",

            # dashboard-stats team-scoped queries: WHERE pod_id = ? — partial index skips NULLs
            """CREATE INDEX IF NOT EXISTS idx_leads_pod_id
               ON leads (pod_id)
               WHERE pod_id IS NOT NULL""",

            # general-purpose created_at ordering — used by dashboard-stats ORDER BY created_at,
            # leaderboard, and any time-range filtered lead queries
            "CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at DESC)",

            # ── v8.9.9-perf2: 6 indexes identified via EXPLAIN + RAIL load testing ──────

            # Fix TRIM mismatch: old index used lower(company) but every query uses
            # lower(trim(company)). PostgreSQL couldn't use the old index at all.
            # DROP+recreate is idempotent via IF NOT EXISTS on the new name.
            "DROP INDEX IF EXISTS idx_leads_company_lower",
            "CREATE INDEX IF NOT EXISTS idx_leads_company_lower_trim ON leads (lower(trim(company)))",

            # Company resolution Q1: WHERE status='Meeting Scheduled' AND lower(trim(company)) IN (...)
            # Compound index covers both the status filter and the company lookup in one scan.
            """CREATE INDEX IF NOT EXISTS idx_leads_status_company
               ON leads (status, lower(trim(company)))
               WHERE status = 'Meeting Scheduled'""",

            # _batch_latest_activity: SELECT DISTINCT ON (lead_id) FROM notes WHERE lead_id IN (...)
            # Full table scan on every leads page load — missing index was catastrophic at 50k+ notes.
            "CREATE INDEX IF NOT EXISTS idx_notes_lead_id ON notes (lead_id, created_at DESC)",

            # /api/admin/users stale-session background query:
            # WHERE logout_at IS NULL AND login_at < cutoff — partial index skips all logged-out rows.
            """CREATE INDEX IF NOT EXISTS idx_login_logs_stale
               ON login_logs (login_at)
               WHERE logout_at IS NULL""",

            # ORDER BY lower(coalesce(company,'')) on /api/leads list — enables index-only sort.
            "CREATE INDEX IF NOT EXISTS idx_leads_company_sort ON leads (lower(coalesce(company, '')), created_at DESC)",

            # lead_assignments join table — idx_lead_assignments_lead_id exists but not lead_id alone
            # for the paginated count subquery used in get_leads.
            "CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead_created ON lead_assignments (lead_id)",

            # ── v9.0.1-perf: call_logs standalone called_at index ────────────────────
            # The Super Admin /api/admin/call-logs path uses ORDER BY called_at DESC with
            # no user_id filter (sees all SDRs). The composite (user_id, called_at) index
            # can only be used when user_id is in the WHERE clause, so Super Admin path
            # falls back to a Seq Scan + full in-memory sort of all 6,091 rows.
            # This standalone index enables an index scan for the unfiltered ORDER BY path.
            "CREATE INDEX IF NOT EXISTS idx_call_logs_called_at ON call_logs (called_at DESC)",

            # ── error-logs summary fix (RCA: 2026-07-07) ─────────────────────────────
            # /api/admin/error-logs/summary runs 4 sequential COUNT(*) queries with
            # WHERE resolved = false AND severity = '...' AND created_at >= cutoff.
            # Without an index covering (resolved, severity, created_at), each count
            # is a full sequential scan → 1.5–3.6s per page load.
            # This composite index satisfies all 4 counts with index-only scans.
            "CREATE INDEX IF NOT EXISTS idx_error_logs_resolved_severity "
            "ON error_logs (resolved, severity, created_at DESC)",
        ]
        if is_postgres:
            for stmt in index_creates:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    logger.info(f"Index created (or already exists)")
                except Exception as e:
                    conn.rollback()
                    logger.warning(f"Index creation failed: {e}")

            # ── pg_trgm + trigram indexes (search 530ms): require AUTOCOMMIT for CONCURRENTLY ──
            # These cannot run inside a transaction block, so we use a separate connection
            # with AUTOCOMMIT isolation. IF NOT EXISTS makes them safe to re-run.
            trgm_stmts = [
                # Extension: available on Render managed Postgres 18 (confirmed via MCP query)
                "CREATE EXTENSION IF NOT EXISTS pg_trgm",
                # search ILIKE '%q%' across name/email/company — B-tree cannot do this
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_first_name_trgm ON leads USING gin (first_name gin_trgm_ops)",
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_last_name_trgm ON leads USING gin (last_name gin_trgm_ops)",
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_email_trgm ON leads USING gin (email gin_trgm_ops)",
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_company_trgm ON leads USING gin (company gin_trgm_ops)",
            ]
            try:
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as ac_conn:
                    for stmt in trgm_stmts:
                        try:
                            ac_conn.execute(text(stmt))
                            logger.info(f"Trigram index/extension applied (or already exists)")
                        except Exception as e:
                            logger.warning(f"Trigram index skipped (non-fatal): {e}")
            except Exception as e:
                logger.warning(f"Trigram index block skipped (non-fatal): {e}")

            # ── GET /api/meetings (unified calendar) — same CONCURRENTLY/AUTOCOMMIT
            # need as the trigram indexes above: a plain CREATE INDEX takes a lock
            # that blocks writes to `leads` for the build's duration, which matters
            # once this table has real production volume. WHERE status =
            # 'Meeting Scheduled' AND meeting_scheduled_at BETWEEN ... would
            # otherwise fall back to the (status, created_at) index's status
            # prefix only, filtering meeting_scheduled_at per matching row.
            try:
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as ac_conn:
                    ac_conn.execute(text(
                        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_status_meeting_scheduled_at "
                        "ON leads (status, meeting_scheduled_at)"
                    ))
                    logger.info("idx_leads_status_meeting_scheduled_at created (or already exists)")
            except Exception as e:
                logger.warning(f"idx_leads_status_meeting_scheduled_at skipped (non-fatal): {e}")

            # Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md): GIN index for
            # "which journeys use node type X" containment queries. Table is
            # brand new / near-empty, so a plain (non-CONCURRENTLY) build is fine.
            try:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_journey_versions_graph_gin "
                    "ON journey_versions USING GIN (graph_definition jsonb_path_ops)"
                ))
                conn.commit()
                logger.info("ix_journey_versions_graph_gin created (or already exists)")
            except Exception as e:
                conn.rollback()
                logger.warning(f"ix_journey_versions_graph_gin skipped (non-fatal): {e}")

    # Runs after the column/table migrations above so `leads.upload_log_id` and
    # `lead_upload_logs` are guaranteed to exist first.
    _backfill_lead_upload_log_ids(engine)

    # Runs after dialer_calls.provider_disposition is guaranteed to exist (V47 above).
    _backfill_klenty_started_at_and_disposition(engine)

    # Runs after execution_logs is guaranteed to exist (create_all, main.py).
    _ensure_execution_log_partitions(engine)
