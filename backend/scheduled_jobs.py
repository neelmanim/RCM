"""
Lightweight scheduled jobs using threading.Timer loops.
Suitable for multi-worker container deployments.
"""
import os
import threading
import time
import logging
import ownership_history as oh
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# RCA 2026-10-05: Dockerfile moved to `--workers 2` on 2026-10-01 (safe for
# journey_engine.tick(), which claims rows via SELECT...FOR UPDATE SKIP
# LOCKED) but every OTHER job registered below has no cross-process dedup —
# each worker is a separate OS process that independently calls
# start_scheduled_jobs(), so every recurring job here (email sync, messaging
# sync, nightly syncs, scheduled campaigns/reports) has been silently
# running TWICE per tick since that change, each on its own full data set.
# Confirmed live via staging logs: paired "[EmailSync] Synced 50/50" lines
# a few hundred ms apart, every single 5-min tick, forever. The doubled
# Nylas-fetch + bleach-sanitize + DB-write churn is the primary driver
# behind staging's repeated OOM kills (512Mi ceiling) and prod's steady,
# still-climbing RSS on the same code (2Gi, hasn't hit the wall yet). Worse
# than the memory cost: scheduled_email_campaign and scheduled_report were
# almost certainly double-firing too, i.e. double-sending real campaign
# emails to real recipients.
#
# A Postgres advisory lock elects exactly one worker process as the
# "scheduler leader" — only that worker calls start_scheduled_jobs() at
# all. The lock is tied to the DB connection and held open for the life of
# this process; if the leader process dies, Postgres releases the lock the
# instant the connection drops, so the next boot (or the surviving worker,
# on its next retry) can claim it. SQLite (local dev/tests) has no
# advisory locks and no multi-process concern — always leader there.
_SCHEDULER_LEADER_LOCK_KEY = 72491001
_scheduler_leader_conn = None  # kept open deliberately — closing it releases the lock


def _is_scheduler_leader() -> bool:
    global _scheduler_leader_conn
    from database import engine as _db_engine
    from sqlalchemy import text

    if "sqlite" in str(_db_engine.url):
        return True

    conn = _db_engine.connect()
    # Pull this connection OUT of the shared QueuePool before using it. A
    # plain engine.connect() is a pooled connection — closing it later just
    # returns it to the pool for reuse by an unrelated request (confirmed
    # live against local Postgres: a "released" lock stayed held because
    # .close() didn't actually drop the session). detach() makes it ours
    # alone; the pool opens a replacement for itself immediately.
    conn.connection.detach()
    try:
        got_lock = conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": _SCHEDULER_LEADER_LOCK_KEY}
        ).scalar()
    except Exception as e:
        logger.error(f"[Scheduler] Leader-election check failed — not starting scheduled jobs on this worker: {e}")
        conn.close()
        return False

    if got_lock:
        _scheduler_leader_conn = conn  # keep open for the life of the process
        return True
    conn.close()
    return False


def _health_check_job():
    """Test active Salesforce connection, update status."""
    try:
        from database import SessionLocal
        import models
        from crypto import decrypt_token
        from simple_salesforce import Salesforce

        db = SessionLocal()
        try:
            conn = db.query(models.SalesforceConnection).filter(
                models.SalesforceConnection.is_active == True
            ).first()
            if not conn:
                return

            domain = "test" if conn.environment == "sandbox" else "login"
            try:
                sf = Salesforce(
                    username=conn.username,
                    password=decrypt_token(conn.password_encrypted),
                    security_token=decrypt_token(conn.security_token_encrypted),
                    domain=domain,
                )
                conn.connection_status = "connected"
                if hasattr(sf, "sf_instance"):
                    conn.instance_url = f"https://{sf.sf_instance}"
            except Exception as e:
                conn.connection_status = "auth_required"
                logger.warning(f"[Health Check] SF connection failed: {e}")

            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[Health Check] Error: {e}")


def _aggregate_daily_summaries():
    """
    Aggregate yesterday's activity logs + LoginLog sessions into daily summaries.
    LoginLog session durations provide the 'time_spent_minutes' metric.
    """
    try:
        from database import SessionLocal
        from sqlalchemy import func
        import models

        db = SessionLocal()
        try:
            yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
            yesterday_start = datetime.strptime(yesterday, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            yesterday_end = yesterday_start + timedelta(days=1)

            # Skip if already aggregated
            existing = db.query(models.UserActivityDailySummary).filter(
                models.UserActivityDailySummary.summary_date == yesterday
            ).first()
            if existing:
                return

            # Count activity logs by user and action type
            logs = db.query(
                models.UserActivityLog.user_id,
                models.UserActivityLog.user_email,
                models.UserActivityLog.user_name,
                models.UserActivityLog.action_type,
                func.count().label("cnt")
            ).filter(
                models.UserActivityLog.created_at >= yesterday_start,
                models.UserActivityLog.created_at < yesterday_end,
            ).group_by(
                models.UserActivityLog.user_id,
                models.UserActivityLog.user_email,
                models.UserActivityLog.user_name,
                models.UserActivityLog.action_type,
            ).all()

            # Group by user
            user_data = {}
            for log in logs:
                uid = log.user_id
                if uid not in user_data:
                    user_data[uid] = {
                        "user_email": log.user_email,
                        "user_name": log.user_name,
                        "login_count": 0, "lead_views": 0, "status_updates": 0,
                        "meetings_scheduled": 0, "calls_logged": 0,
                        "leads_assigned": 0, "exports": 0, "total_actions": 0,
                    }
                d = user_data[uid]
                d["total_actions"] += log.cnt
                if log.action_type == "LOGIN":
                    d["login_count"] += log.cnt
                elif log.action_type == "VIEW_LEAD":
                    d["lead_views"] += log.cnt
                elif log.action_type == "UPDATE_LEAD_STATUS":
                    d["status_updates"] += log.cnt
                elif log.action_type == "SCHEDULE_MEETING":
                    d["meetings_scheduled"] += log.cnt
                elif log.action_type == "LOG_CALL":
                    d["calls_logged"] += log.cnt
                elif log.action_type == "ASSIGN_LEAD":
                    d["leads_assigned"] += log.cnt
                elif log.action_type == "EXPORT_DATA":
                    d["exports"] += log.cnt

            # Calculate time spent from LoginLog sessions
            sessions = db.query(models.LoginLog).filter(
                models.LoginLog.login_at >= yesterday_start,
                models.LoginLog.login_at < yesterday_end,
                models.LoginLog.logout_at != None,
            ).all()

            for session in sessions:
                uid = session.user_id
                if uid not in user_data:
                    user = db.query(models.User).filter(models.User.id == uid).first()
                    user_data[uid] = {
                        "user_email": session.email,
                        "user_name": session.name or (user.name if user else None),
                        "login_count": 0, "lead_views": 0, "status_updates": 0,
                        "meetings_scheduled": 0, "calls_logged": 0,
                        "leads_assigned": 0, "exports": 0, "total_actions": 0,
                    }

                if session.logout_at and session.login_at:
                    login_naive = session.login_at.replace(tzinfo=None) if session.login_at.tzinfo else session.login_at
                    # Heartbeat-based active time
                    if session.last_heartbeat_at:
                        hb_naive = session.last_heartbeat_at.replace(tzinfo=None) if session.last_heartbeat_at.tzinfo else session.last_heartbeat_at
                        duration = (hb_naive - login_naive).total_seconds() / 60.0 + 5
                    else:
                        logout_naive = session.logout_at.replace(tzinfo=None) if session.logout_at.tzinfo else session.logout_at
                        duration = (logout_naive - login_naive).total_seconds() / 60.0
                        duration = min(duration, 30)  # Legacy: cap at 30 min
                    duration = max(0, min(duration, 120))  # Cap at 2h per session
                    if duration > 0:
                        user_data[uid].setdefault("time_spent_minutes", 0)
                        user_data[uid]["time_spent_minutes"] = int(
                            user_data[uid].get("time_spent_minutes", 0) + duration
                        )

            # Create summary records
            for uid, data in user_data.items():
                summary = models.UserActivityDailySummary(
                    summary_date=yesterday,
                    user_id=uid,
                    user_email=data.get("user_email"),
                    user_name=data.get("user_name"),
                    login_count=data.get("login_count", 0),
                    lead_views=data.get("lead_views", 0),
                    status_updates=data.get("status_updates", 0),
                    meetings_scheduled=data.get("meetings_scheduled", 0),
                    calls_logged=data.get("calls_logged", 0),
                    leads_assigned=data.get("leads_assigned", 0),
                    exports=data.get("exports", 0),
                    total_actions=data.get("total_actions", 0),
                    time_spent_minutes=data.get("time_spent_minutes", 0),
                )
                db.add(summary)

            db.commit()
            logger.info(f"[Aggregation] Created {len(user_data)} daily summaries for {yesterday}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[Aggregation] Error: {e}")


def _ownership_reconcile_job():
    """Nightly: compare lead_assignments with open ownership periods and heal any difference. A non-zero count means
    an ownership write happened without the trigger firing (trigger dropped, restored dump, SQLite) — it is logged
    loudly so it is investigated, not just healed."""
    try:
        from database import SessionLocal
        import ownership_history as _oh
        db = SessionLocal()
        try:
            r = _oh.reconcile(db, heal=True)
        finally:
            db.close()
        if r["missing_open_period"] or r["stale_open_period"]:
            logger.error(f"[ownership] reconcile found drift and healed it: {r}")
        else:
            logger.info("[ownership] reconcile clean: assignments match open ownership periods")
    except Exception as e:
        logger.error(f"[ownership] reconcile job failed: {e}")


def _cleanup_old_error_logs():
    """
    Delete error logs older than ERROR_LOG_RETENTION_DAYS (default: 15).
    Runs nightly alongside the activity log cleanup.
    Logs success/failure to standard logging — NOT to error_logs (avoid recursion).
    Emits a startup warning if the error_logs table has grown unusually large.
    """
    try:
        from database import SessionLocal
        import models

        retention_days = int(os.getenv("ERROR_LOG_RETENTION_DAYS", "15"))
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

        db = SessionLocal()
        try:
            deleted = db.query(models.ErrorLog).filter(
                models.ErrorLog.created_at < cutoff
            ).delete()
            db.commit()
            if deleted:
                logger.info(f"[Cleanup] Deleted {deleted} error logs older than {retention_days} days")

            # Health check: warn if table has grown abnormally large
            total = db.query(models.ErrorLog).count()
            if total > 10000:
                logger.warning(
                    f"[Cleanup] error_logs table has {total} rows — this is unusually high. "
                    "Check if the nightly purge is running or if an error storm occurred."
                )
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[Cleanup] Error log cleanup failed: {e}")


# Pure insert-only log tables — safe to delete whole rows past retention, same as
# ErrorLog/UserActivityLog above. Each entry: (model attr name, timestamp column,
# env var, default retention days).
_PRUNABLE_LOG_TABLES = [
    ("UserActivityLog",          "created_at", "ACTIVITY_LOG_RETENTION_DAYS",       90),
    ("LeadUploadLog",            "created_at", "LEAD_UPLOAD_LOG_RETENTION_DAYS",   180),
    ("SalesforceIntegrationLog", "timestamp",  "SF_INTEGRATION_LOG_RETENTION_DAYS", 90),
    ("LoginLog",                 "login_at",   "LOGIN_LOG_RETENTION_DAYS",          180),
    ("AnalyticsQueryHistory",    "created_at", "ANALYTICS_QUERY_LOG_RETENTION_DAYS", 90),
]


def _cleanup_old_log_tables():
    """Delete rows older than retention for each table in _PRUNABLE_LOG_TABLES."""
    try:
        from database import SessionLocal
        import models

        db = SessionLocal()
        try:
            # Each table is isolated — one table failing (e.g. a not-yet-migrated
            # column) must not abort the others, same as a failed statement would
            # otherwise poison the rest of this session's transaction.
            for model_name, ts_col, env_var, default_days in _PRUNABLE_LOG_TABLES:
                try:
                    model = getattr(models, model_name)
                    retention_days = int(os.getenv(env_var, str(default_days)))
                    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
                    deleted = db.query(model).filter(getattr(model, ts_col) < cutoff).delete()
                    db.commit()
                    if deleted:
                        logger.info(f"[Cleanup] Deleted {deleted} {model_name} rows older than {retention_days} days")
                except Exception as table_err:
                    db.rollback()
                    logger.error(f"[Cleanup] {model_name} cleanup failed: {table_err}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[Cleanup] Log table cleanup failed: {e}")


def _trim_old_dialer_call_payloads():
    """
    DialerCall rows are lead history (outcome, notes, recording_url) — never bulk-deleted.
    Only the heavy debug/raw Text columns (raw_payload, transcript) are nulled out past
    retention, to cap table size without losing call history.
    """
    try:
        from database import SessionLocal
        import models

        retention_days = int(os.getenv("DIALER_CALL_PAYLOAD_RETENTION_DAYS", "180"))
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

        db = SessionLocal()
        try:
            trimmed = db.query(models.DialerCall).filter(
                models.DialerCall.created_at < cutoff,
                (models.DialerCall.raw_payload.isnot(None)) | (models.DialerCall.transcript.isnot(None)),
            ).update({"raw_payload": None, "transcript": None}, synchronize_session=False)
            db.commit()
            if trimmed:
                logger.info(f"[Cleanup] Trimmed raw_payload/transcript on {trimmed} DialerCall rows older than {retention_days} days")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[Cleanup] DialerCall payload trim failed: {e}")


def _aircall_nightly_sync():
    """
    Nightly Aircall catch-up: pulls the last 25 hours from Aircall.
    Catches calls that the real-time webhook missed (server downtime, delivery failure).
    EC-11: On startup, if last sync was > 25 hours ago, runs immediately.
    """
    try:
        from database import SessionLocal
        from dialer_service import sync_historical_calls, get_active_provider
        import models

        db = SessionLocal()
        db.info["change_actor"] = "system:aircall_sync"  # see models.py::_record_lead_field_history
        try:
            provider = get_active_provider(db)
            if not provider or provider.provider_name != "aircall":
                return  # Aircall not configured — skip silently

            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if not settings or not settings.aircall_sync_enabled:
                logger.info("[NightlySync] Aircall sync disabled in Settings — skipping")
                return

            now = datetime.now(timezone.utc)
            from_dt = now - timedelta(hours=25)  # slightly over 24h to avoid edge gaps
            to_dt = now

            logger.info(f"[NightlySync] Running Aircall catch-up {from_dt.date()} – {to_dt.date()}")
            result = sync_historical_calls(db, from_dt=from_dt, to_dt=to_dt)

            # Persist last sync timestamp
            settings.aircall_last_sync_at = now
            db.commit()

            logger.info(f"[NightlySync] Aircall sync complete: {result}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[NightlySync] Error: {e}")


def _messenger_nightly_sync():
    """
    Nightly Alternate Messenger Contact Center catch-up: pulls the last 25 hours.
    Mirrors Aircall nightly sync but for the Alternate Messenger provider.
    Fetches paginated call history and upserts into dialer_calls.

    EC-16 / Memory-leak fix:
    - Retry-with-backoff (3 attempts, exponential) on paginated fetch 502s so
      a transient Alternate Messenger error doesn't abort the entire sync.
    - Proactive zombie-heal: after the paginated sync completes, any DialerCall
      in a non-terminal state that is older than 24 hours (and therefore was not
      covered by a live CALL_ENDED webhook) is force-closed to CALL_ENDED. This
      prevents the backend scheduler from retrying dead calls indefinitely and
      accumulating unreleased resources (the primary OOM cause).
    """
    import time as _time
    try:
        from database import SessionLocal
        from dialer_service import _get_settings, _instantiate_provider
        import models

        db = SessionLocal()
        try:
            settings = _get_settings(db)
            provider = _instantiate_provider("messenger", settings)
            if not provider:
                return  # Alternate Messenger not configured — skip silently

            now = datetime.now(timezone.utc)
            from_dt = now - timedelta(hours=25)
            from_date_str = from_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            to_date_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")

            logger.info(f"[NightlySync] Running Alternate Messenger catch-up {from_dt.date()} \u2013 {now.date()}")

            page = 1
            imported = 0
            skipped_dup = 0
            healed_zombie = 0

            # ── Max-retry helper ──────────────────────────────────────────────
            _MAX_RETRIES = 3

            while True:
                # Retry-with-backoff: 3 attempts, exponential (1s, 2s, 4s)
                result = None
                last_exc = None
                for attempt in range(_MAX_RETRIES):
                    try:
                        result = provider.fetch_calls_paginated(
                            page=page, page_size=50,
                            from_date=from_date_str, to_date=to_date_str,
                        )
                        last_exc = None
                        break  # Success — exit retry loop
                    except Exception as exc:
                        last_exc = exc
                        wait = 2 ** attempt  # 1s, 2s, 4s
                        logger.warning(
                            f"[NightlySync] Alternate Messenger page={page} fetch attempt "
                            f"{attempt + 1}/{_MAX_RETRIES} failed: {exc} — "
                            f"{'retrying in ' + str(wait) + 's' if attempt < _MAX_RETRIES - 1 else 'giving up'}"
                        )
                        if attempt < _MAX_RETRIES - 1:
                            _time.sleep(wait)

                if last_exc is not None:
                    # All retries exhausted — skip this page and continue to next
                    logger.error(
                        f"[NightlySync] Alternate Messenger page={page} permanently failed after "
                        f"{_MAX_RETRIES} retries: {last_exc} — skipping page"
                    )
                    page += 1
                    # Safety: if we've skipped 5 consecutive pages, stop the loop
                    # to avoid an infinite retry-skip spiral
                    if page > 20:  # 20 pages * 50 = 1000 calls max window
                        logger.error("[NightlySync] Too many failed pages — aborting paginated sync")
                        break
                    continue

                calls = result.get("calls", []) if result else []
                if not calls:
                    break

                for call_data in calls:
                    call_id = str(call_data.get("call_id") or call_data.get("id", ""))
                    if not call_id:
                        continue

                    # Normalize event first — needed for zombie-heal check below (EC-16)
                    event = provider.handle_webhook(call_data)
                    if not event:
                        continue

                    # Dedup by provider_call_id
                    # EC-16: If existing record is stuck in a non-terminal status but
                    # provider history shows CALL_ENDED, update it (zombie-heal) instead
                    # of silently skipping. This catches records whose CALL_ENDED webhook
                    # was never delivered.
                    existing = db.query(models.DialerCall).filter(
                        models.DialerCall.provider_call_id == call_id,
                        models.DialerCall.provider == "messenger",
                    ).first()
                    if existing:
                        _TERMINAL = {"CALL_ENDED", "CALL_FAILED", "FAILED"}
                        if (existing.status not in _TERMINAL
                                and event.event_type == "CALL_ENDED"):
                            # Zombie record — heal it
                            existing.status = "CALL_ENDED"
                            if event.ended_at and not existing.ended_at:
                                existing.ended_at = event.ended_at
                            if event.duration is not None and existing.duration is None:
                                existing.duration = event.duration
                            healed_zombie += 1
                            logger.info(
                                f"[NightlySync] EC-16: Healed zombie DialerCall {existing.id} "
                                f"(was {existing.status!r}) \u2192 CALL_ENDED via Alternate Messenger history"
                            )
                        else:
                            skipped_dup += 1
                        continue

                    # Resolve lead by phone
                    phone = event.phone_number
                    lead = None
                    if phone:
                        from routes.dialer_routes import _normalize_phone  # lives in dialer_routes, not dialer_service
                        norm = _normalize_phone(phone)
                        lead = db.query(models.Lead).filter(
                            (models.Lead.phone == norm) | (models.Lead.phone_secondary == norm)
                        ).first()

                    new_call = models.DialerCall(
                        provider="messenger",
                        provider_call_id=call_id,
                        phone_number=phone,
                        direction=event.direction or "outbound",
                        status=event.event_type,
                        duration=event.duration,
                        recording_url=event.recording_url,
                        transcript=event.transcript,
                        started_at=event.started_at,
                        ended_at=event.ended_at,
                        lead_id=lead.id if lead else None,
                        source="messenger_sync",
                    )
                    db.add(new_call)
                    imported += 1

                    # Commit in batches of 50
                    if imported % 50 == 0:
                        db.commit()

                page += 1

            db.commit()

            # ── Proactive zombie-heal ─────────────────────────────────────────
            # Any DialerCall older than 24h that is still non-terminal never got
            # its CALL_ENDED webhook. Mark it closed so the scheduler stops
            # accumulating retry state for dead calls (primary OOM source).
            _TERMINAL_STATUSES = ("CALL_ENDED", "CALL_FAILED", "FAILED")
            cutoff = now - timedelta(hours=24)
            zombies = db.query(models.DialerCall).filter(
                models.DialerCall.provider == "messenger",
                models.DialerCall.status.notin_(_TERMINAL_STATUSES),
                models.DialerCall.started_at < cutoff,
            ).all()
            for z in zombies:
                z.status   = "CALL_ENDED"
                z.ended_at = z.ended_at or cutoff  # preserve original if set
                healed_zombie += 1
                logger.warning(
                    f"[NightlySync] Proactive zombie-heal: DialerCall {z.id} "
                    f"provider_call_id={z.provider_call_id!r} age >24h "
                    f"\u2192 forced CALL_ENDED"
                )
            if zombies:
                db.commit()
                logger.info(f"[NightlySync] Proactive zombie-heal: {len(zombies)} call(s) force-closed")

            # Persist last sync timestamp
            if settings:
                settings.messenger_last_sync_at = now
                db.commit()

            logger.info(
                f"[NightlySync] Alternate Messenger sync complete: "
                f"imported={imported}, skipped_dup={skipped_dup}, healed_zombie={healed_zombie}"
            )

        finally:
            db.close()
    except Exception as e:
        logger.error(f"[NightlySync] Alternate Messenger error: {e}")


_KLENTY_RESEARCH_NOTE = "No research done – called directly via Klenty"

# RCA 2026-07-31 (LIVE): the recurring 24h job, the startup catch-up (fires
# after a deploy restart if the last sync was missed), and a manual
# admin-triggered backfill can all call _klenty_nightly_sync — with no
# lock, two overlapping runs raced on the same call_id and one crashed on
# the unique constraint after the other had already committed it. A single
# process-wide lock keeps only one run active at a time; a second caller
# gets an immediate "already running" instead of racing.
_klenty_sync_lock = threading.Lock()


def _klenty_nightly_sync(lookback_days: int = 10):
    """
    Nightly Klenty catch-up: pulls the last `lookback_days` of call history
    (default 10 — see RCA 2026-08-06 below for why this isn't 3).

    RCA 2026-08-06: a 3-day lookback silently stopped importing anything for
    6 days straight. LIVE-TESTED against the real API: any request whose
    startDate lands within ~6 days of the real current date gets rejected
    with K2002 "invalid date range" — even though the same calls ARE
    returned by a request starting further back. A 3-day lookback's
    startDate is permanently inside that broken window as "today" advances,
    so it can never succeed on its own. 10 days gives a safe margin past it;
    existing_ids/provider_call_id dedup already makes re-fetching older days
    harmless, so widening this costs nothing but a slightly larger response.

    `lookback_days` can be widened further (up to
    klenty_provider.MAX_SYNC_LOOKBACK_DAYS = 29, Klenty's own API limit) for
    a one-off manual backfill run — e.g. to recover a gap left by Klenty
    being disabled/misconfigured for a stretch of days. The recurring
    scheduled call always uses the default; only a manual invocation should
    pass a larger value.

    Klenty is pull-only (no webhooks). The `/user/{username}/calls` endpoint
    validates that the requested username is known to the account, but does
    NOT actually scope the returned calls to it — LIVE-TESTED 2026-07-29:
    two different accepted usernames returned byte-identical data for the
    same date window. So this fetches the feed exactly once (trying each
    configured SDR's username only until one is accepted by the API) and
    attributes every call to a Alternate CRM user by matching the call's own
    embedded "username" field — not by which username was requested.

    This is a temporary bridging integration (see docs/RELEASES.md) — SDRs
    place some calls through Klenty that never reach Aircall's own log or
    Alternate CRM otherwise.

    Unmatched contacts (no existing lead by phone or email) are auto-created
    as new leads, assigned directly to the calling SDR — same behavior as the
    one-time historical CSV backfill this integration follows on from.

    Klenty calls never carry an SDR-typed outcome (only a telephony-level
    `disposition`), so DialerCall.outcome is intentionally left NULL — these
    calls do not count toward Connect Rate analytics.
    """
    import time as _time
    import uuid as _uuid
    import json

    if not _klenty_sync_lock.acquire(blocking=False):
        logger.warning("[NightlySync] Klenty sync already running — skipping this invocation")
        return {"ran": False, "reason": "Klenty sync already running"}

    try:
        from database import SessionLocal
        from dialer_service import _get_settings
        from klenty_provider import KlentyDialerProvider
        from crypto import decrypt_token
        from routes.dialer_routes import _normalize_phone
        import models

        db = SessionLocal()
        db.info["change_actor"] = "system:klenty_sync"  # see models.py::_record_lead_field_history
        try:
            settings = _get_settings(db)
            if not settings or not settings.klenty_enabled or not settings.klenty_api_key:
                return {"ran": False, "reason": "Klenty sync not enabled"}

            provider = KlentyDialerProvider(api_key=decrypt_token(settings.klenty_api_key))

            now = datetime.now(timezone.utc)
            from_date_str = (now - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
            to_date_str = now.strftime("%Y-%m-%d")

            logger.info(f"[NightlySync] Running Klenty catch-up {from_date_str} – {to_date_str}")

            imported = 0
            skipped_dup = 0
            skipped_unattributed = 0
            new_leads = 0
            # RCA 2026-07-31: Klenty's own feed can return the same call_id
            # twice within one run (LIVE-CONFIRMED on a 29-day backfill) —
            # the DB existence check alone doesn't catch it since both
            # occurrences get queued before either is committed. Track
            # call_ids seen this run so the second occurrence is skipped as
            # a dup instead of crashing the whole sync on the unique
            # constraint at commit time.
            seen_this_run = set()

            _MAX_RETRIES = 3

            def _fetch_with_retries(username, page):
                """Fetch one page with retry-with-backoff. Returns None only
                after all retries are exhausted (a genuine failure) — an
                accepted-but-empty response is returned normally, not None."""
                last_exc = None
                for attempt in range(_MAX_RETRIES):
                    try:
                        return provider.fetch_calls_paginated(
                            username=username, from_date=from_date_str,
                            to_date=to_date_str, page=page,
                        )
                    except Exception as exc:
                        last_exc = exc
                        wait = 2 ** attempt
                        logger.warning(
                            f"[NightlySync] Klenty user={username!r} page={page} fetch attempt "
                            f"{attempt + 1}/{_MAX_RETRIES} failed: {exc} — "
                            f"{'retrying in ' + str(wait) + 's' if attempt < _MAX_RETRIES - 1 else 'giving up'}"
                        )
                        if attempt < _MAX_RETRIES - 1:
                            _time.sleep(wait)
                logger.error(
                    f"[NightlySync] Klenty user={username!r} page={page} permanently failed "
                    f"after {_MAX_RETRIES} retries: {last_exc}"
                )
                return None

            # RCA 2026-07-31: dialer_enabled is a per-SDR toggle for Alternate CRM's
            # own click-to-call dialer (Alternate Messenger/Aircall) — unrelated to
            # Klenty, a separate pull-only integration. Reusing it here meant
            # any SDR who never needed Alternate CRM's own dialer (because they
            # call through Klenty) had their real Klenty calls silently and
            # permanently discarded as "unattributed" on every sync. Roster
            # is just "is this an SDR/AE", matching the same pattern used for
            # attribution/roster elsewhere (e.g. analytics_routes.py).
            sdrs = db.query(models.User).filter(models.User.role.in_(["SDR", "AE"])).all()
            sdrs_by_email = {s.email.lower(): s for s in sdrs if s.email}

            working_username = None
            result = None
            for sdr in sdrs:
                candidate = sdr.klenty_username or sdr.email
                result = _fetch_with_retries(candidate, page=1)
                if result is not None:
                    working_username = candidate
                    break

            if not working_username:
                logger.error(
                    "[NightlySync] Klenty: no SDR/AE's username was accepted "
                    "by the API — aborting sync"
                )
                return {"ran": False, "reason": "No SDR/AE's username was accepted by the API"}

            page = 1
            while result is not None:
                calls = result.get("calls", [])
                for call_data in calls:
                    call_id = str(call_data.get("callSid") or "")
                    if not call_id:
                        continue

                    if call_id in seen_this_run:
                        skipped_dup += 1
                        continue
                    seen_this_run.add(call_id)

                    existing = db.query(models.DialerCall).filter(
                        models.DialerCall.provider_call_id == call_id,
                        models.DialerCall.provider == "klenty",
                    ).first()
                    if existing:
                        skipped_dup += 1
                        continue

                    sdr = sdrs_by_email.get((call_data.get("username") or "").lower())
                    if not sdr:
                        skipped_unattributed += 1
                        logger.warning(
                            f"[NightlySync] Klenty call {call_id} username="
                            f"{call_data.get('username')!r} doesn't match any "
                            "SDR/AE — skipping"
                        )
                        continue

                    event = provider._normalize_call(call_data)

                    # Resolve lead: phone first, then email (mirrors the
                    # one-time CSV backfill's matching strategy)
                    lead = None
                    phone = event.phone_number
                    if phone:
                        norm = _normalize_phone(phone)
                        lead = db.query(models.Lead).filter(
                            (models.Lead.phone == norm) | (models.Lead.phone_secondary == norm)
                        ).first()
                    email = call_data.get("email")
                    if not lead and email:
                        lead = db.query(models.Lead).filter(
                            models.Lead.email == email.lower()
                        ).first()

                    if not lead:
                        first = (call_data.get("firstName") or "").strip()
                        last = (call_data.get("lastName") or "").strip() or "Unknown"
                        lead = models.Lead(
                            sf_lead_id=f"klenty-{_uuid.uuid4().hex[:12]}",
                            first_name=first,
                            last_name=last,
                            email=email,
                            phone=phone,
                            company=call_data.get("company"),
                            status="Calling",
                            lead_source=f"klenty_sync:{now.date().isoformat()}",
                            pod_id=sdr.pod_id,
                            research_company=_KLENTY_RESEARCH_NOTE,
                            research_contact=_KLENTY_RESEARCH_NOTE,
                            research_hypothesis=_KLENTY_RESEARCH_NOTE,
                            research_personalization=_KLENTY_RESEARCH_NOTE,
                        )
                        db.add(lead)
                        db.flush()
                        oh.set_assignment_context(db, oh.R_KLENTY)
                        db.execute(
                            models.lead_assignments.insert().values(
                                user_id=sdr.id, lead_id=lead.id
                            )
                        )
                        new_leads += 1

                    db.add(models.DialerCall(
                        lead_id=lead.id,
                        user_id=sdr.id,
                        provider="klenty",
                        provider_call_id=call_id,
                        phone_number=phone,
                        status="CALL_ENDED",
                        direction=event.direction or "outbound",
                        duration=event.duration,
                        started_at=event.started_at,
                        ended_at=event.ended_at,
                        provider_disposition=call_data.get("disposition"),
                        raw_payload=json.dumps(call_data),
                        source="klenty_sync",
                    ))
                    imported += 1

                    if imported % 50 == 0:
                        db.commit()

                if not result.get("has_more") or not calls:
                    break
                page += 1
                result = _fetch_with_retries(working_username, page)

            db.commit()
            settings.klenty_last_sync_at = now
            db.commit()

            logger.info(
                f"[NightlySync] Klenty sync complete: username_used={working_username!r}, "
                f"imported={imported}, skipped_dup={skipped_dup}, "
                f"skipped_unattributed={skipped_unattributed}, new_leads={new_leads}"
            )
            return {
                "ran": True,
                "from_date": from_date_str,
                "to_date": to_date_str,
                "username_used": working_username,
                "imported": imported,
                "skipped_dup": skipped_dup,
                "skipped_unattributed": skipped_unattributed,
                "new_leads": new_leads,
            }
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[NightlySync] Klenty error: {e}")
        return {"ran": False, "reason": str(e)}
    finally:
        _klenty_sync_lock.release()


# Instantly.ai campaign/lead-engagement pull sync (polling-only v1, see
# docs/RELEASES.md). Same overlapping-caller hazard as Klenty (recurring 15m
# job + startup catch-up + manual admin trigger) — same single-process lock.
_instantly_sync_lock = threading.Lock()


def _record_instantly_engagement(db, lead, campaign_id, instantly_lead_id=None,
                                  new_open=None, new_click=None,
                                  open_count=None, click_count=None):
    """Shared dedup/write rule for an Instantly open/click signal, used by
    this job's per-lead loop and the real-time webhook handler
    (routes/webhook_routes.py POST /webhooks/instantly).

    A new LeadEmailActivity row is written only when a signal's timestamp
    has advanced past what's already stored for this lead — matched by
    instantly_lead_id when the caller has it (this job always does), else
    by instantly_campaign_id (the webhook payload has no Instantly lead id,
    only campaign_id + lead_email). That keeps a replayed webhook event, or
    the same static poll numbers seen again next cycle, from duplicating a
    row.

    Replies are NOT written here since v13.8.0: the webhook wrote a body-less
    row and the poll then wrote a second one for the same reply (the dedup
    keys differ), and the poll fetched `items[0]` of the lead's inbox — maybe
    the wrong reply. `_instantly_mail_sync_job` now stores every real email
    once, keyed on Instantly's own email id.

    Returns the written activity, or None if nothing advanced.
    """
    import models
    match_filters = [models.LeadEmailActivity.lead_id == lead.id]
    if instantly_lead_id:
        match_filters.append(models.LeadEmailActivity.instantly_lead_id == instantly_lead_id)
    else:
        match_filters.append(models.LeadEmailActivity.instantly_campaign_id == campaign_id)

    # Only counter rows: a real email row (instantly_email_id set) carries no
    # open/click state of its own, so it must not hide a first open.
    last_row = db.query(models.LeadEmailActivity).filter(
        *match_filters, models.LeadEmailActivity.instantly_email_id.is_(None),
        models.LeadEmailActivity.direction == "outbound",
    ).order_by(models.LeadEmailActivity.timestamp.desc()).first()

    # SQLite has no tz storage, so a row read back after expire-on-commit comes back naive even though it was
    # written aware — comparing it to an aware `new_*` raised a TypeError that this job's blanket try/except
    # swallowed (RCA, see git history). as_utc normalizes it.
    from time_utils import as_utc as _aware

    prev_open = _aware(last_row.opened_at) if last_row else None
    prev_click = _aware(last_row.clicked_at) if last_row else None

    open_advanced = bool(new_open and (not prev_open or new_open > prev_open))
    click_advanced = bool(new_click and (not prev_click or new_click > prev_click))

    if not (open_advanced or click_advanced):
        return None

    activity = models.LeadEmailActivity(
        lead_id=lead.id,
        direction="outbound",
        source="instantly",
        instantly_lead_id=instantly_lead_id,
        instantly_campaign_id=campaign_id,
        opened_at=new_open,
        open_count=open_count,
        clicked_at=new_click,
        click_count=click_count,
    )
    db.add(activity)
    db.commit()
    return activity


def _resume_stalled_instantly_enrollments(db, polled_lead_statuses: dict):
    """Webhook-miss safety net (plan section 3) — Instantly's webhook
    delivery isn't guaranteed, so a lead parked at an instantly_sequence
    node could otherwise wait forever if the one delivering event was
    dropped. Called after this job's per-lead poll above has refreshed each
    lead's engagement fields: for every still-active JourneyInstantlyEnrollment,
    infer whether what was just polled already implies an outcome and
    resume/exit it — a deliberately separate pass, not entangled with the
    main per-lead loop body above, so it reads as one clear addition.

    Idempotent by construction: resume_instantly_sequence_step and
    _exit_enrollment_early both no-op (or are safe to re-run) on an
    enrollment a webhook already resolved, so double-acting alongside a
    webhook that DID arrive is harmless.
    """
    import models
    from instantly_provider import LEAD_STATUS_LABELS
    from journey_engine.engine import resume_instantly_sequence_step, _exit_enrollment_early, exit_active_enrollments

    active = db.query(models.JourneyInstantlyEnrollment).filter(
        models.JourneyInstantlyEnrollment.status == "active",
    ).all()
    for jie in active:
        enrollment = db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.id == jie.journey_enrollment_id,
            models.JourneyEnrollment.status == "active",
        ).first()
        if not enrollment:
            continue
        lead = db.query(models.Lead).filter(models.Lead.id == enrollment.lead_id).first()
        if not lead:
            continue

        outcome = None
        reply = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.lead_id == lead.id,
            models.LeadEmailActivity.instantly_campaign_id == jie.instantly_campaign_id,
            models.LeadEmailActivity.direction == "inbound",
            models.LeadEmailActivity.is_auto_reply.isnot(True),     # an out-of-office is not a reply
            models.LeadEmailActivity.timestamp >= jie.enrolled_at,
        ).first()
        if reply:
            outcome = "replied"
        elif lead.instantly_interest_label == "Meeting Booked":
            outcome = "meeting_booked"
        elif lead.instantly_interest_label == "Interested":
            outcome = "interested"
        else:
            status_label = LEAD_STATUS_LABELS.get(polled_lead_statuses.get(lead.id))
            if status_label == "Completed":
                outcome = "completed"
            elif status_label == "Unsubscribed":
                outcome = "unsubscribed"
            elif status_label == "Bounced":
                outcome = "bounced"

        if not outcome:
            continue
        try:
            if outcome in ("unsubscribed", "bounced"):
                # Same hard-stop handling as the webhook path and
                # lead_service's do_not_contact path — a dropped unsubscribe/
                # bounce webhook is a compliance gap, not just a UX one, so
                # this ends the whole enrollment rather than just advancing
                # the instantly_sequence node's own branch_on_outcome.
                if outcome == "unsubscribed":
                    if not lead.unsubscribed_at:
                        lead.unsubscribed_at = datetime.now(timezone.utc)
                    exit_active_enrollments(db, lead.id, outcome)
                else:
                    _exit_enrollment_early(db, enrollment, reason=outcome)
                db.commit()
            else:
                resume_instantly_sequence_step(db, jie.journey_enrollment_id, jie.node_id, outcome=outcome)
        except Exception as e:
            logger.error(f"[NightlySync] Instantly fallback resume failed for enrollment "
                         f"{jie.journey_enrollment_id}: {e}")


def _instantly_text(value):
    """Instantly returns some email fields as objects ({"text", "html"}) or
    lists; our columns take plain text. A raw dict here crashed every prod
    sync run ("can't adapt type 'dict'")."""
    if isinstance(value, dict):
        value = value.get("text") or value.get("html")
    if isinstance(value, (list, tuple)):
        value = ", ".join(str(v) for v in value if v)
    return value if value is None or isinstance(value, str) else str(value)


def _instantly_sync_job():
    """
    Pulls Instantly.ai campaign/lead engagement every 15 minutes and mirrors
    it onto matching Alternate CRM leads — informational only (opens/clicks/
    replies/interest never write Lead.status; the SDR makes that call
    themselves via the existing kanban move).

    Instantly leads are always leads that already exist in Alternate CRM, pushed
    out for cold outreach — unlike Klenty, an unmatched email is logged and
    skipped, never auto-created as a new Lead (explicit user decision: an
    unmatched Instantly lead is unexpected and worth surfacing, not silently
    growing the lead list).

    Dedup: a new lead_email_activity row is written only when
    timestamp_last_open/_click/_reply has advanced since the most recently
    synced row for that lead+instantly_lead_id — otherwise the same static
    engagement numbers would duplicate a row every 15-minute cycle forever.
    Replies and sent emails are NOT handled here since v13.8.0 — see
    _instantly_mail_sync_job (one global incremental read of the Instantly
    inbox instead of one Unibox call per lead).
    """
    if not _instantly_sync_lock.acquire(blocking=False):
        logger.warning("[NightlySync] Instantly sync already running — skipping this invocation")
        return {"ran": False, "reason": "Instantly sync already running"}

    try:
        from database import SessionLocal
        from dialer_service import _get_settings
        from instantly_provider import InstantlyProvider, resolve_interest_label, build_lead_labels_cache, parse_ts
        import models

        db = SessionLocal()
        db.info["change_actor"] = "system:instantly_sync"
        try:
            settings = _get_settings(db)
            if not settings or not settings.instantly_enabled or not settings.instantly_api_key:
                return {"ran": False, "reason": "Instantly sync not enabled"}

            # The model property already decrypts transparently — no
            # call-site decrypt_token needed (the deliberate improvement
            # over Klenty's scattered encrypt/decrypt-at-call-site pattern).
            provider = InstantlyProvider(api_key=settings.instantly_api_key)

            now = datetime.now(timezone.utc)
            lead_labels_cache = None  # lazily fetched once per run, only if an unknown interest value is seen

            processed = 0
            matched = 0
            unmatched = 0
            activities_written = 0
            polled_lead_statuses = {}  # lead_id -> raw Instantly lead `status` int, for the fallback-resume pass below

            for campaign in provider.list_campaigns():
                campaign_id = campaign.get("id")
                starting_after = None
                while True:
                    page = provider.list_leads(campaign_id, starting_after=starting_after)
                    items = page.get("items") or []
                    for ilead in items:
                        processed += 1
                        email = (ilead.get("email") or "").strip().lower()
                        if not email:
                            unmatched += 1
                            continue

                        lead = db.query(models.Lead).filter(models.Lead.email == email).first()
                        if not lead:
                            unmatched += 1
                            logger.warning(
                                f"[NightlySync] Instantly lead has no Alternate CRM match: "
                                f"campaign_id={campaign_id!r} email={email!r} — skipping "
                                "(no auto-create, per user decision)"
                            )
                            continue
                        matched += 1

                        instantly_lead_id = ilead.get("id")
                        raw_interest = ilead.get("lt_interest_status")
                        if raw_interest is not None:
                            label = resolve_interest_label(raw_interest, lead_labels_cache or {})
                            if label is None and lead_labels_cache is None:
                                lead_labels_cache = build_lead_labels_cache(provider.list_lead_labels())
                                label = resolve_interest_label(raw_interest, lead_labels_cache)
                            lead.instantly_interest_status = raw_interest
                            lead.instantly_interest_label = label
                        lead.instantly_last_synced_at = now

                        new_open = parse_ts(ilead.get("timestamp_last_open"))
                        new_click = parse_ts(ilead.get("timestamp_last_click"))

                        # Opens/clicks only; replies are stored by _instantly_mail_sync_job.
                        activity = _record_instantly_engagement(
                            db, lead, campaign_id, instantly_lead_id=instantly_lead_id,
                            new_open=new_open, new_click=new_click,
                            open_count=ilead.get("email_open_count"),
                            click_count=ilead.get("email_click_count"),
                        )
                        if activity is not None:
                            activities_written += 1

                        # Webhook-miss safety net (plan section 3): captured here, acted
                        # on in _resume_stalled_instantly_enrollments after this loop —
                        # keeps that logic out of this already-dense per-lead body.
                        polled_lead_statuses[lead.id] = ilead.get("status")

                        if processed % 50 == 0:
                            db.commit()

                    starting_after = page.get("next_starting_after")
                    if not starting_after or not items:
                        break

            db.commit()
            settings.instantly_last_sync_at = now
            db.commit()

            try:
                _resume_stalled_instantly_enrollments(db, polled_lead_statuses)
            except Exception as e:
                logger.error(f"[NightlySync] Instantly fallback-resume pass failed: {e}")

            logger.info(
                f"[NightlySync] Instantly sync complete: processed={processed}, "
                f"matched={matched}, unmatched={unmatched}, activities_written={activities_written}"
            )
            return {
                "ran": True,
                "processed": processed,
                "matched": matched,
                "unmatched": unmatched,
                "activities_written": activities_written,
            }
        finally:
            db.close()
    except Exception as e:
        # Full detail (may include a raw Instantly error body) stays server-side
        # only — this dict is returned verbatim to the HTTP caller by the
        # /admin/instantly/sync route, so a third-party error string never
        # reaches an API response.
        logger.error(f"[NightlySync] Instantly error: {e}")
        return {"ran": False, "reason": "Instantly sync failed — see server logs for details"}
    finally:
        _instantly_sync_lock.release()


# ── v13.8.0 Instantly mail sync ─────────────────────────────────────────────
# One global, incremental read of the Instantly inbox (GET /api/v2/emails,
# oldest first from a per-direction watermark) instead of one Unibox call per
# lead. Every real email — replies AND sent — is stored once, keyed on
# Instantly's own email id (partial unique index), so the replies inbox and
# report have trustworthy rows. Cost: one request per 100 emails, paced under
# Instantly's 20 req/min cap. Memory: page by page, nothing accumulates.
_instantly_mail_sync_lock = threading.Lock()
_INSTANTLY_MAIL_LOOKBACK_DAYS = 30                 # first run: how far back to backfill
_INSTANTLY_MAIL_OVERLAP = timedelta(minutes=5)     # re-read this much each run; the unique id makes it safe
_INSTANTLY_MAIL_MAX_PAGES = 15                     # per direction per run (1,500 emails); the cursor resumes next run
_INSTANTLY_MAIL_PAGE_PAUSE_SECONDS = 3
_INSTANTLY_MAIL_BODY_MAX = 8000
_INSTANTLY_STALE_REPLY = timedelta(hours=48)       # older replies are stored already-read: backfill must not flood the bell
_instantly_plan_tier_logged = False


def _instantly_html_to_text(html_str):
    import html as _html
    import re as _re
    if not html_str:
        return ""
    t = _re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</tr>", "\n", str(html_str))
    t = _re.sub(r"(?s)<(script|style)\b.*?</\1>", "", t, flags=_re.I)
    t = _html.unescape(_re.sub(r"<[^>]+>", "", t))
    return _re.sub(r"\n{3,}", "\n\n", t).strip()


def _instantly_body_text(email: dict):
    body = email.get("body")
    if isinstance(body, dict):
        text_ = body.get("text") or _instantly_html_to_text(body.get("html"))
    elif isinstance(body, str):
        text_ = body
    else:
        text_ = None
    text_ = (text_ or email.get("content_preview") or "").strip()
    return text_[:_INSTANTLY_MAIL_BODY_MAX] or None


def _instantly_email_direction(email: dict, pass_type: str):
    """inbound / outbound / None (a scheduled email that hasn't gone out)."""
    ue = email.get("ue_type")        # 1 campaign, 2 received, 3 sent, 4 scheduled
    if ue == 2:
        return "inbound"
    if ue == 4:
        return None
    if ue in (1, 3):
        return "outbound"
    return "inbound" if pass_type == "received" else "outbound"


def _instantly_step_number(value):
    try:
        return int(str(value).split("_")[0])
    except (TypeError, ValueError):
        return None


def _instantly_lead_email(email: dict, direction: str):
    lead_email = email.get("lead")
    if not lead_email:
        if direction == "inbound":
            lead_email = email.get("from_address_email")
        else:
            to = email.get("to_address_email_list")
            lead_email = to[0] if isinstance(to, (list, tuple)) and to else str(to or "").split(",")[0]
    lead_email = (lead_email or "").strip().lower()
    return lead_email or None


def _reconcile_legacy_instantly_replies(db, lead_ids):
    """Drop the pre-v13.8.0 reply rows (webhook stubs + poll duplicates, no
    instantly_email_id) once the real email for the same reply is stored —
    matched by lead and a 24 h window. A reply the rep already cleared from
    the bell stays cleared."""
    import models
    LEA = models.LeadEmailActivity
    legacy = db.query(LEA).filter(
        LEA.lead_id.in_(lead_ids), LEA.source == "instantly", LEA.direction == "inbound",
        LEA.instantly_email_id.is_(None),
    ).all()
    if not legacy:
        return 0
    real_by_lead = {}
    for r in db.query(LEA).filter(
        LEA.lead_id.in_(lead_ids), LEA.source == "instantly", LEA.direction == "inbound",
        LEA.instantly_email_id.isnot(None),
    ).all():
        real_by_lead.setdefault(r.lead_id, []).append(r)

    def aware(dt):
        return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt

    removed = 0
    for old in legacy:
        old_ts = aware(old.timestamp)
        match = next((r for r in real_by_lead.get(old.lead_id, [])
                      if old_ts is not None and aware(r.timestamp) is not None
                      and abs(aware(r.timestamp) - old_ts) <= timedelta(hours=24)), None)
        if match is None:
            continue
        if old.read_at and not match.read_at:
            match.read_at = old.read_at
        db.delete(old)
        removed += 1
    db.commit()
    return removed


def _store_instantly_email_page(db, items, pass_type, now):
    """Store one page of Instantly emails. Returns (stored, unmatched, newest
    timestamp_created seen on the page, lead ids that got a new reply)."""
    import models
    from email_utils import is_auto_reply
    from instantly_provider import parse_ts

    LEA = models.LeadEmailActivity
    ids = [e.get("id") for e in items if e.get("id")]
    existing = {r[0] for r in db.query(LEA.instantly_email_id).filter(LEA.instantly_email_id.in_(ids)).all()} if ids else set()
    wanted = {_instantly_lead_email(e, _instantly_email_direction(e, pass_type) or "outbound") for e in items}
    wanted.discard(None)
    lead_id_by_email = {r.email: r.id for r in db.query(models.Lead.id, models.Lead.email).filter(models.Lead.email.in_(wanted)).all()} if wanted else {}

    rows, newest, unmatched, seen = [], None, 0, set()
    for e in items:
        created = parse_ts(e.get("timestamp_created"))
        if created and (newest is None or created > newest):
            newest = created
        eid = e.get("id")
        if not eid or eid in existing or eid in seen:
            continue
        direction = _instantly_email_direction(e, pass_type)
        if direction is None:
            continue
        lead_id = lead_id_by_email.get(_instantly_lead_email(e, direction))
        if not lead_id:
            unmatched += 1
            continue
        seen.add(eid)
        subject = _instantly_text(e.get("subject"))
        ts = parse_ts(e.get("timestamp_email")) or created or now
        auto = read_at = None
        if direction == "inbound":
            auto = bool(e.get("is_auto_reply")) or bool(is_auto_reply([], subject or ""))
            if ts < now - _INSTANTLY_STALE_REPLY:
                read_at = now
        rows.append(LEA(
            lead_id=lead_id, direction=direction, source="instantly", subject=subject,
            body_preview=_instantly_body_text(e),
            from_email=_instantly_text(e.get("from_address_email")),
            to_email=_instantly_text(e.get("to_address_email_list")),
            timestamp=ts, is_auto_reply=auto, read_at=read_at,
            instantly_email_id=eid, instantly_thread_id=e.get("thread_id"),
            instantly_lead_id=e.get("lead_id"), instantly_campaign_id=e.get("campaign_id"),
            instantly_step=_instantly_step_number(e.get("step")),
            instantly_eaccount=_instantly_text(e.get("eaccount")),
        ))

    if rows:
        # The sync is single-flight (leader + lock) and the unique index backs it up: on a
        # conflict the job's outer handler rolls back and the next run re-reads the overlap.
        db.add_all(rows)
        db.commit()
    reply_leads = {r.lead_id for r in rows if r.direction == "inbound"}
    if reply_leads:
        _reconcile_legacy_instantly_replies(db, list(reply_leads))
    return len(rows), unmatched, newest, reply_leads


def _instantly_mail_sync_job():
    """Every 5 minutes: store new Instantly emails (replies + sent). See the
    block comment above. No-ops when Instantly isn't enabled in Settings."""
    import json
    import time as _time
    global _instantly_plan_tier_logged

    if not _instantly_mail_sync_lock.acquire(blocking=False):
        return {"ran": False, "reason": "Instantly mail sync already running"}
    try:
        from database import SessionLocal
        from dialer_service import _get_settings
        from instantly_provider import InstantlyProvider, InstantlyPlanTierError, parse_ts

        db = SessionLocal()
        db.info["change_actor"] = "system:instantly_mail_sync"
        try:
            settings = _get_settings(db)
            if not settings or not settings.instantly_enabled or not settings.instantly_api_key:
                return {"ran": False, "reason": "Instantly sync not enabled"}
            try:
                cursor = json.loads(settings.instantly_mail_cursor or "{}")
            except ValueError:
                cursor = {}
            provider = InstantlyProvider(api_key=settings.instantly_api_key)
            now = datetime.now(timezone.utc)
            stats = {"stored": 0, "unmatched": 0, "pages": 0}
            first_call = True
            try:
                for pass_type in ("received", "sent"):
                    watermark = parse_ts(cursor.get(pass_type))
                    since = (watermark - _INSTANTLY_MAIL_OVERLAP) if watermark else now - timedelta(days=_INSTANTLY_MAIL_LOOKBACK_DAYS)
                    starting_after = None
                    for _ in range(_INSTANTLY_MAIL_MAX_PAGES):
                        if not first_call:
                            _time.sleep(_INSTANTLY_MAIL_PAGE_PAUSE_SECONDS)
                        first_call = False
                        page = provider.list_unibox_emails(
                            email_type=pass_type, sort_order="asc", limit=100, starting_after=starting_after,
                            min_timestamp_created=since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                        )
                        items = page.get("items") or []
                        stored, unmatched, newest, _ = _store_instantly_email_page(db, items, pass_type, now)
                        stats["stored"] += stored
                        stats["unmatched"] += unmatched
                        stats["pages"] += 1
                        # Advance the watermark only after the page is safely stored.
                        if newest and (not watermark or newest > watermark):
                            watermark = newest
                            cursor[pass_type] = newest.astimezone(timezone.utc).isoformat()
                            settings.instantly_mail_cursor = json.dumps(cursor)
                            db.commit()
                        starting_after = page.get("next_starting_after")
                        if not starting_after or not items:
                            break
            except InstantlyPlanTierError:
                if not _instantly_plan_tier_logged:
                    logger.warning("[InstantlyMail] Instantly plan does not include the emails API — mail sync disabled until restart")
                    _instantly_plan_tier_logged = True
                return {"ran": False, "reason": "Instantly plan does not include the emails API"}
            logger.info(f"[InstantlyMail] stored={stats['stored']} unmatched={stats['unmatched']} pages={stats['pages']}")
            return {"ran": True, **stats}
        except Exception as e:
            db.rollback()
            logger.error(f"[InstantlyMail] sync failed: {e}")
            return {"ran": False, "reason": "Instantly mail sync failed — see server logs for details"}
        finally:
            db.close()
    finally:
        _release_freed_memory()
        _instantly_mail_sync_lock.release()


# v10.9.5: Email sync had no scheduler and no inbound webhook at all — the
# only trigger was GET /lead/{id}/emails firing a background sync AFTER
# someone opened that specific lead's Email tab (email_routes.py). A reply
# — whether from the customer, or sent directly from the SDR's own Gmail
# app to the same thread — could sit unsynced indefinitely if nobody
# reopened the tab. This job is the missing trigger; the actual sync/match
# logic (_sync_full_mailbox, mailbox selection, dedup) is untouched and
# reused as-is.
def _release_freed_memory():
    """Give heap Python already freed back to the OS (glibc malloc_trim).
    Staging OOM RCA 2026-10-06: the 5-minute email sync handles thousands of
    large mail bodies; glibc kept the freed memory, so the worker's RSS
    climbed ~2 MB/min to the 512 MB limit. Measured on staging, one trim
    returned 23 of the 39 MB gained. Best-effort and Linux-only — a no-op
    elsewhere (macOS dev, tests)."""
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass


def _email_sync_job(batch_size: int = 50):
    """Periodic email sync: reuses email_routes._sync_full_mailbox (the
    per-lead Nylas any_email search + dedup logic) across the leads most
    likely to have new activity, instead of waiting for a page view.

    Scoped to non-parked leads with a known email, most-recently-active
    first, capped at batch_size per tick to stay cheap and rate-limit-safe
    against Nylas — this trades "every lead synced every tick" for
    "active-pipeline leads synced regularly", which is the actual gap
    reported (a customer/Gmail reply not showing up for a lead someone is
    still working).
    """
    try:
        from database import SessionLocal
        from routes.email_routes import _sync_full_mailbox
        import models

        db = SessionLocal()
        try:
            config = db.query(models.NylasConfig).filter(
                models.NylasConfig.id == 1,
                models.NylasConfig.is_active == True,
            ).first()
            if not config or not config.api_key_encrypted:
                return {"ran": False, "reason": "Nylas not configured"}

            if not db.query(models.UserMailbox).filter(models.UserMailbox.status == "connected").first():
                return {"ran": False, "reason": "No connected mailboxes"}

            leads = (
                db.query(models.Lead)
                .filter(~models.Lead.status.in_(models.PARKED_STATUSES))
                .filter(models.Lead.email.isnot(None))
                .order_by(models.Lead.status_changed_at.desc())
                .limit(batch_size)
                .all()
            )

            synced = 0
            for lead in leads:
                try:
                    _sync_full_mailbox(lead.id, db)
                    synced += 1
                except Exception as e:
                    logger.warning(f"[EmailSync] Sync failed for lead={lead.id}: {e}")

            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if settings:
                settings.email_sync_last_run_at = datetime.now(timezone.utc)
                db.commit()

            logger.info(f"[EmailSync] Synced {synced}/{len(leads)} active leads")
            return {"ran": True, "synced": synced, "considered": len(leads)}
        finally:
            db.close()
            _release_freed_memory()
    except Exception as e:
        logger.error(f"[EmailSync] error: {e}")
        return {"ran": False, "reason": str(e)}


# v10.9.13: Alternate Messenger/Messaging Provider messaging (SMS + WhatsApp via the Converse
# Desk API) has no inbound webhook at all — same gap email had before
# _email_sync_job existed, same fix shape. A reply sent through the Widget's
# Message tab or an automated Cadence WhatsApp step previously had no way to
# reach our DB at all; this is that missing trigger.
def _messaging_sync_job(count: int = 100):
    """Periodic inbound-message sync: reuses messaging_sync.sync_recent_conversations
    (account-wide conversation poll → per-thread inbound fetch → sms_logs) —
    the actual sync logic is untouched and reused as-is."""
    try:
        from database import SessionLocal
        from messaging_sync import sync_recent_conversations

        db = SessionLocal()
        try:
            stats = sync_recent_conversations(db, count=count)
            return {"ran": True, **stats}
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[MessagingSync] error: {e}")
        return {"ran": False, "reason": str(e)}


def _should_run_aircall_sync_on_startup() -> bool:
    """
    EC-11: Check if the Aircall nightly sync was skipped due to server restart.
    Returns True if last sync was more than 25 hours ago (or never run).
    """
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if not settings or not settings.aircall_sync_enabled:
                return False  # Disabled in Settings — _aircall_nightly_sync would no-op anyway
            if not settings.aircall_last_sync_at:
                return True  # Never synced
            last = settings.aircall_last_sync_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - last).total_seconds() > 25 * 3600
        finally:
            db.close()
    except Exception:
        return False  # Don't crash startup if check fails


def _should_run_messenger_sync_on_startup() -> bool:
    """
    Check if the Alternate Messenger nightly sync was skipped (same logic as Aircall).
    Returns True if last sync was more than 25 hours ago (or never run).
    """
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if not settings or not settings.messenger_last_sync_at:
                return True  # Never synced
            last = settings.messenger_last_sync_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - last).total_seconds() > 25 * 3600
        finally:
            db.close()
    except Exception:
        return False


def _should_run_klenty_sync_on_startup() -> bool:
    """
    Check if the Klenty nightly sync was skipped (same logic as Alternate Messenger).
    Returns False if Klenty sync isn't enabled at all — no point catching up
    on a job the admin hasn't turned on.
    """
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if not settings or not settings.klenty_enabled or not settings.klenty_api_key:
                return False
            if not settings.klenty_last_sync_at:
                return True  # Never synced
            last = settings.klenty_last_sync_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - last).total_seconds() > 25 * 3600
        finally:
            db.close()
    except Exception:
        return False


def _should_run_instantly_sync_on_startup() -> bool:
    """Check if the Instantly sync was skipped (same staleness shape as
    Klenty/Alternate Messenger). Returns False if Instantly sync isn't enabled at
    all — no point catching up on a job the admin hasn't turned on."""
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if not settings or not settings.instantly_enabled or not settings.instantly_api_key:
                return False
            if not settings.instantly_last_sync_at:
                return True  # Never synced
            last = settings.instantly_last_sync_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - last).total_seconds() > 25 * 3600
        finally:
            db.close()
    except Exception:
        return False


# ── Timer-based scheduling ───────────────────────────────────────────────────

# RCA 2026-08-24: was `_timers = []`, with every re-schedule appending a new
# Timer forever — the fastest job (journey_engine_tick, every 30s) alone added
# ~2880 never-freed entries/day, growing monotonically for the life of the
# process since stop_scheduled_jobs() (which used to .clear() the list) only
# runs on graceful shutdown, never on an OOM SIGKILL. Keyed by job name so
# each re-schedule replaces its own prior Timer instead of accumulating one.
_timers: dict[str, threading.Timer] = {}


def _schedule_recurring(func, interval_seconds, name):
    """Schedule a function to run repeatedly at a given interval."""
    def wrapper():
        try:
            func()
        except Exception as e:
            logger.error(f"[Scheduler] {name} failed: {e}")
        # Re-schedule
        timer = threading.Timer(interval_seconds, wrapper)
        timer.daemon = True
        timer.name = f"scheduler_{name}"
        _timers[name] = timer
        timer.start()

    timer = threading.Timer(interval_seconds, wrapper)
    timer.daemon = True
    timer.name = f"scheduler_{name}"
    _timers[name] = timer
    timer.start()
    logger.info(f"[Scheduler] {name} scheduled every {interval_seconds}s")


def _keep_alive_ping():
    """
    Self-ping to ensure backend health endpoints remain responsive.
    """
    try:
        import urllib.request
        from config import backend_base_url
        base_url = backend_base_url()
        if not base_url:
            return  # Local dev — skip
        url = f"{base_url}/api/health"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            logger.debug(f"[Keep-Alive] Ping OK: {resp.status}")
    except Exception as e:
        logger.warning(f"[Keep-Alive] Ping failed: {e}")


def _sweep_stale_calls():
    """
    EC-16: Proactively heal zombie DialerCall records stuck in CALL_STARTED or
    CALL_ANSWERED with no ended_at.

    Runs every 15 minutes. Any call older than 90 minutes with no CALL_ENDED
    status is auto-healed. This is the systemic safety net that covers:
      - SDRs who closed their browser mid-call (Guard 2 never fires)
      - Dropped CALL_ENDED webhooks from Alternate Messenger or Aircall
      - Any failure mode that leaves a DialerCall in a non-terminal state

    Without this, one missed webhook permanently blocks an SDR from dialling.
    """
    _THRESHOLD_MINUTES = 90
    try:
        from database import SessionLocal
        import models

        cutoff = datetime.now(timezone.utc) - timedelta(minutes=_THRESHOLD_MINUTES)

        db = SessionLocal()
        try:
            stale_calls = db.query(models.DialerCall).filter(
                models.DialerCall.status.in_(["CALL_STARTED", "CALL_ANSWERED"]),
                # BUG-FIX: Do NOT filter on ended_at IS NULL.
                # Records can have ended_at set but status still CALL_STARTED
                # (e.g. webhook delivered ended_at but crashed before updating status).
                # The age guard below (started_at > 90 min) is the correct gate.
            ).all()

            healed = 0
            for call in stale_calls:
                ref_time = call.started_at or call.created_at
                if not ref_time:
                    continue
                if ref_time.tzinfo is None:
                    ref_time = ref_time.replace(tzinfo=timezone.utc)
                if ref_time < cutoff:
                    age_min = int((datetime.now(timezone.utc) - ref_time).total_seconds() / 60)
                    logger.warning(
                        f"[StaleCallSweeper] EC-16: Healing zombie call {call.id} "
                        f"(user={call.user_id}, provider={call.provider}, "
                        f"status={call.status!r}, age={age_min}m) → CALL_ENDED"
                    )
                    call.status = "CALL_ENDED"
                    call.ended_at = datetime.now(timezone.utc)
                    healed += 1

            if healed:
                db.commit()
                logger.warning(
                    f"[StaleCallSweeper] EC-16: Healed {healed} zombie DialerCall record(s) "
                    f"(threshold={_THRESHOLD_MINUTES}m)"
                )
            else:
                logger.debug("[StaleCallSweeper] No stale calls found")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[StaleCallSweeper] Error: {e}")


def _salesforce_auto_sync_job():
    """
    V44: Runs the Salesforce sync (same pull(if 2-way)+push logic as the manual
    "Sync Salesforce" button) once per UTC calendar day, at the admin-configured
    SyncSettings.sf_auto_sync_hour_utc/minute_utc.

    Checked every 15 min (same tick as the stale-call sweeper) rather than using
    a wall-clock timer — there's no cron dependency in this codebase (see
    _schedule_recurring), so this job just asks "has today's scheduled time
    passed, and have we not already synced since then?" on every tick. A missed
    tick (e.g. a server restart right at the scheduled minute) self-heals on the
    next check within the same day, no separate startup catch-up thread needed.
    """
    try:
        from database import SessionLocal
        import models
        from salesforce import get_sf_client, run_full_salesforce_sync

        db = SessionLocal()
        try:
            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if not settings or not settings.sf_auto_sync_enabled or settings.sf_auto_sync_hour_utc is None:
                return

            now = datetime.now(timezone.utc)
            scheduled_today = now.replace(
                hour=settings.sf_auto_sync_hour_utc,
                minute=settings.sf_auto_sync_minute_utc or 0,
                second=0, microsecond=0,
            )
            if now < scheduled_today:
                return  # today's window hasn't arrived yet

            last_run = settings.sf_auto_sync_last_run_at
            if last_run and last_run.tzinfo is None:
                last_run = last_run.replace(tzinfo=timezone.utc)
            if last_run and last_run >= scheduled_today:
                return  # already synced for today's window

            sf = get_sf_client()
            if not sf:
                logger.warning("[SFAutoSync] Skipped — Salesforce client unavailable (missing/invalid credentials)")
                return

            result = run_full_salesforce_sync(db, sf, settings)
            settings.sf_auto_sync_last_run_at = now
            db.commit()
            logger.info(
                f"[SFAutoSync] Completed: {result.get('leads_pushed_to_sf')} pushed, "
                f"{result.get('leads_synced')} pulled"
            )
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[SFAutoSync] Error: {e}")


def _scheduled_report_job():
    """v11.4.0: ticks every 15 min, checks EVERY enabled ReportConfig's own
    timezone/frequency/send-time (report_service.is_due) — unlike the
    single-schedule jobs above, one tick can send zero, one, or several
    reports. Calls report_service.execute_report() (the exact function
    "Run Now" also calls, see routes/report_routes.py) so there's one send
    pipeline, not two. One report's failure must never block the rest —
    each iteration is wrapped individually."""
    try:
        from database import SessionLocal
        import models
        from report_service import is_due, execute_report

        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            reports = db.query(models.ReportConfig).filter(models.ReportConfig.enabled == True).all()
            for report in reports:
                try:
                    if is_due(report, now):
                        execution = execute_report(db, report, triggered_by="scheduler")
                        logger.info(f"[ScheduledReport] {report.id} ({report.name!r}) -> {execution.status}")
                except Exception as e:
                    logger.error(f"[ScheduledReport] Report {report.id} failed: {e}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[ScheduledReport] Error: {e}")


def _scheduled_email_campaign_job():
    """v12: ticks every 15 min, checks every EmailCampaign with
    status == 'scheduled'. Two kinds: a one-shot 'scheduled_once' (fires
    once its absolute scheduled_send_at has passed, then becomes
    'running'/'completed' like an immediate campaign) and a recurring
    daily/weekly/monthly one (reuses report_service.is_due() — its
    frequency/weekday/day_of_month/timezone/send_hour/send_minute/
    last_run_at fields are named to match ReportConfig exactly for this —
    stays 'scheduled' forever, re-firing on its own cadence). Sibling to
    _scheduled_report_job above rather than a shared generic dispatcher —
    the two features' actual send pipelines have nothing in common."""
    try:
        from database import SessionLocal
        import models
        from report_service import is_due
        from routes.email_campaign_routes import _dispatch_campaign, _reset_recipients_for_rerun

        from config import backend_base_url as _resolve_base_url
        backend_base_url = _resolve_base_url()
        if not backend_base_url:
            logger.error("[ScheduledEmailCampaign] no BACKEND_URL or public domain set — skipping this tick (unsubscribe links need it)")
            return

        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            campaigns = db.query(models.EmailCampaign).filter(models.EmailCampaign.status == "scheduled").all()
            for campaign in campaigns:
                try:
                    if campaign.frequency == "scheduled_once":
                        scheduled_at = campaign.scheduled_send_at
                        # SQLite round-trips DateTime(timezone=True) as naive
                        # (no native tz type) — same normalization is_due()
                        # already does below for last_run_at.
                        if scheduled_at is not None and scheduled_at.tzinfo is None:
                            scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
                        due = scheduled_at is not None and now >= scheduled_at
                    else:
                        due = is_due(campaign, now)
                    if not due:
                        continue
                    campaign.last_run_at = now
                    if campaign.frequency != "scheduled_once":
                        _reset_recipients_for_rerun(db, campaign)
                    db.commit()
                    _dispatch_campaign(campaign_id=campaign.id, backend_base_url=backend_base_url)
                    logger.info(f"[ScheduledEmailCampaign] Dispatched {campaign.id} ({campaign.name!r})")
                except Exception as e:
                    logger.error(f"[ScheduledEmailCampaign] Campaign {campaign.id} failed: {e}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[ScheduledEmailCampaign] Error: {e}")


_LEADER_ELECTION_RETRY_DELAYS = (1, 2, 4, 4, 4)  # ~15s total — handles a crashed leader whose connection is already gone
_LEADER_ELECTION_BACKGROUND_RETRY_SECONDS = 20  # keep trying after that — see RCA below
# ...doubling each miss up to this cap: the non-leader worker in a healthy
# container never wins, and a new thread + PG connection every 20s forever
# was steady churn (staging OOM RCA 2026-10-06). A deploy's old container
# exits within the first few (20/40/80s) tries; a crashed leader is picked
# up within 5 minutes at worst.
_LEADER_ELECTION_BACKGROUND_RETRY_MAX_SECONDS = 300


def start_scheduled_jobs():
    """Start all background jobs. Called once per worker process on app
    startup — but only the worker that wins _is_scheduler_leader()'s
    advisory lock actually registers anything (see module docstring above:
    with --workers 2, every worker calls this, and most jobs here have no
    other cross-process dedup).

    RCA 2026-10-05: this used to check the lock exactly once and give up
    for the rest of the process's life on a loss. The ~15s retry below
    handles a crashed/SIGKILL'd leader (its connection may take a few
    seconds to be recognized as dead). During zero-downtime rolling deploys,
    the old container is alive until the new container passes health checks.
    Continuing to retry in the background ensures the scheduler starts as soon
    as the previous instance exits.
    job (including journey_engine_tick) dead until the NEXT deploy —
    discovered only because a test enrollment sat unprocessed for 10+
    minutes. Falling through to _retry_leader_election_in_background()
    instead of just returning is the actual fix."""
    for delay in (0,) + _LEADER_ELECTION_RETRY_DELAYS:
        if delay:
            time.sleep(delay)
        if _is_scheduler_leader():
            _register_jobs()
            return
    logger.info("[Scheduler] Another worker/instance holds the scheduler lock — will keep retrying in the background")
    _retry_leader_election_in_background()


def _retry_leader_election_in_background():
    """Cheap (one pg_try_advisory_lock call) periodic re-check so a worker
    that lost the startup race still picks up leadership the moment the old
    container's connection actually closes, instead of staying dark until
    the next deploy. Stops re-arming itself as soon as it wins; cancelled
    like every other timer by stop_scheduled_jobs()'s sweep of _timers."""
    def arm(delay):
        timer = threading.Timer(delay, lambda: attempt(delay))
        timer.daemon = True
        timer.name = "scheduler_leader_retry"
        _timers["_leader_retry"] = timer
        timer.start()

    def attempt(delay):
        if _is_scheduler_leader():
            _register_jobs()
        else:
            arm(min(delay * 2, _LEADER_ELECTION_BACKGROUND_RETRY_MAX_SECONDS))

    arm(_LEADER_ELECTION_BACKGROUND_RETRY_SECONDS)


def _register_jobs():
    """Actually register every recurring job. Only ever called once per
    process — by whichever caller (the fast retry loop or the background
    retry) first wins the scheduler-leader lock."""
    health_check_interval = int(os.getenv("SF_HEALTH_CHECK_INTERVAL_MINUTES", "30")) * 60

    _schedule_recurring(_health_check_job, health_check_interval, "sf_health_check")

    # Kill switch for the first production rollout — flipping an env var and
    # restarting is much faster than a code revert if the poller misbehaves
    # against real leads. Default on; set JOURNEY_ENGINE_ENABLED=false to stop
    # it from claiming/advancing any enrollment (existing rows just wait).
    if os.getenv("JOURNEY_ENGINE_ENABLED", "true").lower() != "false":
        from journey_engine.engine import tick as _journey_engine_tick
        _schedule_recurring(_journey_engine_tick, 30, "journey_engine_tick")  # Sales Journey Phase 0
    else:
        logger.warning("[Startup] Journey engine tick disabled via JOURNEY_ENGINE_ENABLED=false")

    # Phase 4: execution_logs partitions are also created at startup
    # (database.py::_ensure_execution_log_partitions), but a long-lived
    # instance that never restarts would eventually run out of the "current
    # + 2 months ahead" window created at boot — recurring daily keeps it
    # topped up regardless of deploy cadence.
    def _journey_partition_upkeep():
        from database import engine as _db_engine, _ensure_execution_log_partitions
        _ensure_execution_log_partitions(_db_engine)
    _schedule_recurring(_journey_partition_upkeep, 86400, "journey_partition_upkeep")   # 24h
    _schedule_recurring(_aggregate_daily_summaries, 86400, "daily_aggregation")     # 24h
    _schedule_recurring(_cleanup_old_error_logs, 86400, "error_log_cleanup")        # 24h
    _schedule_recurring(_ownership_reconcile_job, 86400, "ownership_reconcile")      # 24h
    _schedule_recurring(_cleanup_old_log_tables, 86400, "log_table_cleanup")        # 24h
    _schedule_recurring(_trim_old_dialer_call_payloads, 86400, "dialer_call_payload_trim")  # 24h
    _schedule_recurring(_keep_alive_ping, 600, "keep_alive_ping")                   # 10 min

    # Aircall nightly catch-up (runs every 24h at approximately 2am)
    # EC-11: If startup happens after a missed window, run immediately then schedule
    if _should_run_aircall_sync_on_startup():
        t = threading.Thread(target=_aircall_nightly_sync, daemon=True, name="aircall_startup_sync")
        t.start()
        logger.info("[Scheduler] Aircall startup catch-up triggered (missed window detected)")
    _schedule_recurring(_aircall_nightly_sync, 86400, "aircall_nightly_sync")       # 24h

    # Alternate Messenger nightly catch-up (runs every 24h, offset 30 min from Aircall)
    if _should_run_messenger_sync_on_startup():
        t = threading.Thread(target=_messenger_nightly_sync, daemon=True, name="messenger_startup_sync")
        t.start()
        logger.info("[Scheduler] Alternate Messenger startup catch-up triggered (missed window detected)")
    _schedule_recurring(_messenger_nightly_sync, 86400, "messenger_nightly_sync") # 24h

    # Klenty nightly catch-up (temporary bridging integration — no-ops if not
    # enabled in Settings; see docs/RELEASES.md)
    if _should_run_klenty_sync_on_startup():
        t = threading.Thread(target=_klenty_nightly_sync, daemon=True, name="klenty_startup_sync")
        t.start()
        logger.info("[Scheduler] Klenty startup catch-up triggered (missed window detected)")
    _schedule_recurring(_klenty_nightly_sync, 86400, "klenty_nightly_sync")         # 24h

    # Instantly.ai campaign/lead-engagement pull sync (polling-only v1 — see
    # docs/RELEASES.md). No-ops if not enabled in Settings.
    if _should_run_instantly_sync_on_startup():
        t = threading.Thread(target=_instantly_sync_job, daemon=True, name="instantly_startup_sync")
        t.start()
        logger.info("[Scheduler] Instantly startup catch-up triggered (missed window detected)")
    _schedule_recurring(_instantly_sync_job, 900, "instantly_sync")                 # 15 min
    _schedule_recurring(_instantly_mail_sync_job, 300, "instantly_mail_sync")       # 5 min — replies + sent (v13.8.0)

    # v10.9.5: Email sync — previously page-view-triggered only (see
    # _email_sync_job docstring). No enable/disable toggle: it's a no-op
    # already when Nylas isn't configured or no mailbox is connected.
    _schedule_recurring(_email_sync_job, 300, "email_sync")                        # 5 min

    # v10.9.13: Messaging (SMS/WhatsApp) inbound sync — same shape as email
    # sync above. No enable/disable toggle: no-ops already when Alternate Messenger
    # isn't configured (messaging_service.get_messaging_provider_for_org
    # returns None).
    _schedule_recurring(_messaging_sync_job, 300, "messaging_sync")                # 5 min

    # EC-16: Stale call sweeper — heals zombie CALL_STARTED / CALL_ANSWERED records
    # that never received a CALL_ENDED webhook (browser closed mid-call, webhook drop).
    # Runs every 15 min; auto-heals records older than 90 min.
    _schedule_recurring(_sweep_stale_calls, 900, "stale_call_sweeper")              # 15 min

    # V44: Salesforce auto-sync — checks every 15 min whether today's
    # admin-configured UTC time has passed; no-ops if not enabled in Settings.
    _schedule_recurring(_salesforce_auto_sync_job, 900, "sf_auto_sync")             # 15 min

    # v11.3.0: Automated Analytics reporting — checks every 15 min whether
    # today's/this-week's/this-month's admin-configured send window has
    # passed; no-ops if not enabled in the Analytics Hub Reports tab.
    _schedule_recurring(_scheduled_report_job, 900, "scheduled_report")             # 15 min

    # v12: Email Campaigns scheduling/recurrence — checks every 15 min for
    # any campaign whose scheduled_once time has passed, or whose
    # daily/weekly/monthly send window is due; no-ops if none are.
    _schedule_recurring(_scheduled_email_campaign_job, 900, "scheduled_email_campaign")  # 15 min

    logger.info("[Scheduler] All scheduled jobs started")



def stop_scheduled_jobs():
    """Cancel all scheduled timers (for graceful shutdown).

    RCA 2026-10-05 (staging): this never released the scheduler-leader
    advisory lock, only cancelled timers. The lock-holding connection
    (_scheduler_leader_conn, deliberately detached from the pool so a plain
    .close() actually drops the session — see _is_scheduler_leader) stayed
    open until the OS process itself fully died and the TCP socket closed,
    which a container redeploy doesn't reliably do promptly. A new
    container's worker would then find "another worker already holds the
    scheduler lock" and skip registering every scheduled job — including
    journey_engine_tick — silently, for as long as the old connection
    lingered. Confirmed live: a redeploy left the new leader locked out and
    nothing in the journey engine advanced for 10+ minutes. Closing it here
    makes a graceful shutdown (SIGTERM via FastAPI's lifespan handler)
    release the lock immediately instead of depending on the socket
    eventually timing out.
    """
    global _scheduler_leader_conn
    for timer in _timers.values():
        timer.cancel()
    _timers.clear()
    if _scheduler_leader_conn is not None:
        try:
            _scheduler_leader_conn.close()
        except Exception:
            pass
        _scheduler_leader_conn = None
    logger.info("[Scheduler] All scheduled jobs stopped")
