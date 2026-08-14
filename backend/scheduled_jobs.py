"""
Lightweight scheduled jobs using threading.Timer loops.
Suitable for Render free tier (no cron, no Celery).
"""
import os
import threading
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


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


def _cleanup_old_error_logs():
    """
    Delete error logs older than ERROR_LOG_RETENTION_DAYS (default: 15).
    Runs nightly alongside the activity log cleanup.
    Logs success/failure to Render logs — NOT to error_logs (avoid recursion).
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
        try:
            provider = get_active_provider(db)
            if not provider or provider.provider_name != "aircall":
                return  # Aircall not configured — skip silently

            now = datetime.now(timezone.utc)
            from_dt = now - timedelta(hours=25)  # slightly over 24h to avoid edge gaps
            to_dt = now

            logger.info(f"[NightlySync] Running Aircall catch-up {from_dt.date()} – {to_dt.date()}")
            result = sync_historical_calls(db, from_dt=from_dt, to_dt=to_dt)

            # Persist last sync timestamp
            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if settings:
                settings.aircall_last_sync_at = now
                db.commit()

            logger.info(f"[NightlySync] Aircall sync complete: {result}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[NightlySync] Error: {e}")


def _rcm_nightly_sync():
    """
    Nightly RCM Contact Center catch-up: pulls the last 25 hours.
    Mirrors Aircall nightly sync but for the RCM provider.
    Fetches paginated call history and upserts into dialer_calls.

    EC-16 / Memory-leak fix:
    - Retry-with-backoff (3 attempts, exponential) on paginated fetch 502s so
      a transient RCM error doesn't abort the entire sync.
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
            provider = _instantiate_provider("rcm", settings)
            if not provider:
                return  # RCM not configured — skip silently

            now = datetime.now(timezone.utc)
            from_dt = now - timedelta(hours=25)
            from_date_str = from_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            to_date_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")

            logger.info(f"[NightlySync] Running RCM catch-up {from_dt.date()} \u2013 {now.date()}")

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
                            f"[NightlySync] RCM page={page} fetch attempt "
                            f"{attempt + 1}/{_MAX_RETRIES} failed: {exc} — "
                            f"{'retrying in ' + str(wait) + 's' if attempt < _MAX_RETRIES - 1 else 'giving up'}"
                        )
                        if attempt < _MAX_RETRIES - 1:
                            _time.sleep(wait)

                if last_exc is not None:
                    # All retries exhausted — skip this page and continue to next
                    logger.error(
                        f"[NightlySync] RCM page={page} permanently failed after "
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
                        models.DialerCall.provider == "rcm",
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
                                f"(was {existing.status!r}) \u2192 CALL_ENDED via RCM history"
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
                        provider="rcm",
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
                        source="rcm_sync",
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
                models.DialerCall.provider == "rcm",
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
                settings.rcm_last_sync_at = now
                db.commit()

            logger.info(
                f"[NightlySync] RCM sync complete: "
                f"imported={imported}, skipped_dup={skipped_dup}, healed_zombie={healed_zombie}"
            )

        finally:
            db.close()
    except Exception as e:
        logger.error(f"[NightlySync] RCM error: {e}")


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
    attributes every call to a RCM user by matching the call's own
    embedded "username" field — not by which username was requested.

    This is a temporary bridging integration (see docs/RELEASES.md) — SDRs
    place some calls through Klenty that never reach Aircall's own log or
    RCM otherwise.

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

            # RCA 2026-07-31: dialer_enabled is a per-SDR toggle for RCM's
            # own click-to-call dialer (RCM/Aircall) — unrelated to
            # Klenty, a separate pull-only integration. Reusing it here meant
            # any SDR who never needed RCM's own dialer (because they
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


# v10.9.5: Email sync had no scheduler and no inbound webhook at all — the
# only trigger was GET /lead/{id}/emails firing a background sync AFTER
# someone opened that specific lead's Email tab (email_routes.py). A reply
# — whether from the customer, or sent directly from the SDR's own Gmail
# app to the same thread — could sit unsynced indefinitely if nobody
# reopened the tab. This job is the missing trigger; the actual sync/match
# logic (_sync_full_mailbox, mailbox selection, dedup) is untouched and
# reused as-is.
_email_sync_lock = threading.Lock()


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
    if not _email_sync_lock.acquire(blocking=False):
        logger.warning("[EmailSync] Already running — skipping this invocation")
        return {"ran": False, "reason": "Email sync already running"}

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
    except Exception as e:
        logger.error(f"[EmailSync] error: {e}")
        return {"ran": False, "reason": str(e)}
    finally:
        _email_sync_lock.release()


# v10.9.13: RCM Built-in Messaging messaging (SMS + WhatsApp via the Converse
# Desk API) has no inbound webhook at all — same gap email had before
# _email_sync_job existed, same fix shape. A reply sent through the Widget's
# Message tab or an automated Cadence WhatsApp step previously had no way to
# reach our DB at all; this is that missing trigger.
_messaging_sync_lock = threading.Lock()


def _messaging_sync_job(count: int = 100):
    """Periodic inbound-message sync: reuses messaging_sync.sync_recent_conversations
    (account-wide conversation poll → per-thread inbound fetch → sms_logs) —
    the actual sync logic is untouched and reused as-is."""
    if not _messaging_sync_lock.acquire(blocking=False):
        logger.warning("[MessagingSync] Already running — skipping this invocation")
        return {"ran": False, "reason": "Messaging sync already running"}

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
    finally:
        _messaging_sync_lock.release()


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
            if not settings or not settings.aircall_last_sync_at:
                return True  # Never synced
            last = settings.aircall_last_sync_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - last).total_seconds() > 25 * 3600
        finally:
            db.close()
    except Exception:
        return False  # Don't crash startup if check fails


def _should_run_rcm_sync_on_startup() -> bool:
    """
    Check if the RCM nightly sync was skipped (same logic as Aircall).
    Returns True if last sync was more than 25 hours ago (or never run).
    """
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
            if not settings or not settings.rcm_last_sync_at:
                return True  # Never synced
            last = settings.rcm_last_sync_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - last).total_seconds() > 25 * 3600
        finally:
            db.close()
    except Exception:
        return False


def _should_run_klenty_sync_on_startup() -> bool:
    """
    Check if the Klenty nightly sync was skipped (same logic as RCM).
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


# ── Timer-based scheduling ───────────────────────────────────────────────────

_timers = []


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
        _timers.append(timer)
        timer.start()

    timer = threading.Timer(interval_seconds, wrapper)
    timer.daemon = True
    timer.name = f"scheduler_{name}"
    _timers.append(timer)
    timer.start()
    logger.info(f"[Scheduler] {name} scheduled every {interval_seconds}s")


def _keep_alive_ping():
    """
    Self-ping to prevent Render free tier from spinning down.
    Render spins down after ~15 min of inactivity; we ping every 10 min.
    """
    try:
        import urllib.request
        base_url = os.getenv("RENDER_EXTERNAL_URL", "").rstrip("/")
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
      - Dropped CALL_ENDED webhooks from RCM or Aircall
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


def start_scheduled_jobs():
    """Start all background jobs. Called once on app startup."""
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
    # (migrations.py::_ensure_execution_log_partitions), but a long-lived
    # instance that never restarts would eventually run out of the "current
    # + 2 months ahead" window created at boot — recurring daily keeps it
    # topped up regardless of deploy cadence.
    def _journey_partition_upkeep():
        from database import engine as _db_engine
        from migrations import _ensure_execution_log_partitions
        _ensure_execution_log_partitions(_db_engine)
    _schedule_recurring(_journey_partition_upkeep, 86400, "journey_partition_upkeep")   # 24h
    _schedule_recurring(_aggregate_daily_summaries, 86400, "daily_aggregation")     # 24h
    _schedule_recurring(_cleanup_old_error_logs, 86400, "error_log_cleanup")        # 24h
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

    # RCM nightly catch-up (runs every 24h, offset 30 min from Aircall)
    if _should_run_rcm_sync_on_startup():
        t = threading.Thread(target=_rcm_nightly_sync, daemon=True, name="rcm_startup_sync")
        t.start()
        logger.info("[Scheduler] RCM startup catch-up triggered (missed window detected)")
    _schedule_recurring(_rcm_nightly_sync, 86400, "rcm_nightly_sync") # 24h

    # Klenty nightly catch-up (temporary bridging integration — no-ops if not
    # enabled in Settings; see docs/RELEASES.md)
    if _should_run_klenty_sync_on_startup():
        t = threading.Thread(target=_klenty_nightly_sync, daemon=True, name="klenty_startup_sync")
        t.start()
        logger.info("[Scheduler] Klenty startup catch-up triggered (missed window detected)")
    _schedule_recurring(_klenty_nightly_sync, 86400, "klenty_nightly_sync")         # 24h

    # v10.9.5: Email sync — previously page-view-triggered only (see
    # _email_sync_job docstring). No enable/disable toggle: it's a no-op
    # already when Nylas isn't configured or no mailbox is connected.
    _schedule_recurring(_email_sync_job, 300, "email_sync")                        # 5 min

    # v10.9.13: Messaging (SMS/WhatsApp) inbound sync — same shape as email
    # sync above. No enable/disable toggle: no-ops already when RCM
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

    logger.info("[Scheduler] All scheduled jobs started")



def stop_scheduled_jobs():
    """Cancel all scheduled timers (for graceful shutdown)."""
    for timer in _timers:
        timer.cancel()
    _timers.clear()
    logger.info("[Scheduler] All scheduled jobs stopped")
