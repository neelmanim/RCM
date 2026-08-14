"""
tests/test_log_retention_cleanup.py
────────────────────────────────────
RCA 2026-07-15: several insert-only tables (LeadUploadLog, SalesforceIntegrationLog,
LoginLog, AnalyticsQueryHistory, DialerCall) had no retention/cleanup job — only
UserActivityLog and ErrorLog were pruned. Confirms the new cleanup jobs in
scheduled_jobs.py actually prune old rows, keep recent ones, and that DialerCall
rows are trimmed (raw_payload/transcript nulled) rather than deleted.

UserActivityLog's previously-standalone `_cleanup_old_logs` was folded into the
same data-driven `_PRUNABLE_LOG_TABLES` loop (ponytail-review 2026-07-15) — kept
covered here so the fold didn't silently drop its retention behavior.
"""
from datetime import datetime, timedelta, timezone
from conftest import create_test_user
import models
import scheduled_jobs


def _old(days=200):
    return datetime.now(timezone.utc) - timedelta(days=days)


class TestCleanupOldLogTables:
    def test_prunes_old_rows_keeps_recent(self, db):
        user = create_test_user(db)
        old_login = models.LoginLog(user_id=user.id, email=user.email, login_at=_old())
        recent_login = models.LoginLog(user_id=user.id, email=user.email, login_at=datetime.now(timezone.utc))
        db.add_all([old_login, recent_login])
        db.commit()
        old_id, recent_id = old_login.id, recent_login.id  # capture before the row is deleted out from under us

        scheduled_jobs._cleanup_old_log_tables()
        db.expire_all()  # job runs in its own session; drop this session's stale identity map

        remaining_ids = {r.id for r in db.query(models.LoginLog).all()}
        assert old_id not in remaining_ids
        assert recent_id in remaining_ids

    def test_respects_env_var_override(self, db, monkeypatch):
        user = create_test_user(db)
        row = models.LoginLog(user_id=user.id, email=user.email, login_at=_old(days=10))
        db.add(row)
        db.commit()
        row_id = row.id

        monkeypatch.setenv("LOGIN_LOG_RETENTION_DAYS", "5")
        scheduled_jobs._cleanup_old_log_tables()
        db.expire_all()

        assert db.query(models.LoginLog).filter(models.LoginLog.id == row_id).first() is None

    def test_prunes_user_activity_log_folded_from_cleanup_old_logs(self, db):
        user = create_test_user(db)
        old_row = models.UserActivityLog(user_id=user.id, action_type="LOGIN", created_at=_old())
        recent_row = models.UserActivityLog(user_id=user.id, action_type="LOGIN", created_at=datetime.now(timezone.utc))
        db.add_all([old_row, recent_row])
        db.commit()
        old_id, recent_id = old_row.id, recent_row.id

        scheduled_jobs._cleanup_old_log_tables()
        db.expire_all()

        remaining_ids = {r.id for r in db.query(models.UserActivityLog).all()}
        assert old_id not in remaining_ids
        assert recent_id in remaining_ids


class TestTrimDialerCallPayloads:
    def test_trims_payload_keeps_row_and_metadata(self, db):
        call = models.DialerCall(
            provider="aircall", status="CALL_ENDED",
            outcome="Interested", notes="good chat", recording_url="https://x/y",
            raw_payload='{"big": "json"}', transcript='[{"speaker":"SDR","text":"hi"}]',
            created_at=_old(),
        )
        db.add(call)
        db.commit()
        call_id = call.id

        scheduled_jobs._trim_old_dialer_call_payloads()
        db.expire_all()

        refreshed = db.query(models.DialerCall).filter(models.DialerCall.id == call_id).first()
        assert refreshed is not None  # row is NOT deleted
        assert refreshed.raw_payload is None
        assert refreshed.transcript is None
        assert refreshed.outcome == "Interested"       # lead history preserved
        assert refreshed.recording_url == "https://x/y"

    def test_does_not_trim_recent_calls(self, db):
        call = models.DialerCall(
            provider="aircall", status="CALL_ENDED",
            raw_payload='{"big": "json"}', created_at=datetime.now(timezone.utc),
        )
        db.add(call)
        db.commit()

        scheduled_jobs._trim_old_dialer_call_payloads()
        db.expire_all()

        refreshed = db.query(models.DialerCall).filter(models.DialerCall.id == call.id).first()
        assert refreshed.raw_payload == '{"big": "json"}'
