"""
RCA 2026-08-26 (staging OOM): main._run_startup_tasks() was observed running
twice within a single process (confirmed via Render boot logs — every
startup step, including all 15 scheduler registrations, logged twice). Since
_schedule_recurring's timers don't dedupe by name across independent calls,
this silently doubled the rate of every periodic job forever — most
damagingly _email_sync_job's per-tick Nylas full-mailbox sync (100 leads
instead of 50 every 5 minutes), a real contributing factor to the OOM.

_run_startup_tasks() is now guarded by a one-shot threading.Lock so a second
invocation, however it's triggered, is a no-op instead of re-registering
every scheduled job.
"""
import os
import sys
from unittest.mock import patch, MagicMock

_backend_dir = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _backend_dir)

os.environ.setdefault("APP_ENCRYPTION_KEY", "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXRlc3Q=")
os.environ.setdefault("JWT_SECRET", "test_secret")

import main


class TestStartupTasksIdempotency:
    def test_second_call_is_a_no_op_when_lock_already_held(self):
        assert main._startup_lock.acquire(blocking=False), "expected the lock to be free at test start"
        try:
            with patch("main.SessionLocal") as mock_session_local:
                main._run_startup_tasks()
                mock_session_local.assert_not_called()
        finally:
            main._startup_lock.release()

    def test_scheduler_only_registered_once_across_two_real_calls(self):
        # Simulate the exact failure mode: _run_startup_tasks invoked twice
        # in one process. Every heavy dependency is mocked so the first call
        # is fast and side-effect-free except for the one thing under test.
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__.return_value = MagicMock()
        mock_session = MagicMock()
        mock_session.__enter__.return_value.query.return_value.count.return_value = 0

        with patch("main.engine", mock_engine), \
             patch("main.SessionLocal", return_value=mock_session), \
             patch("main.models.Base.metadata.create_all"), \
             patch("main.run_schema_migrations"), \
             patch("main.get_sf_client", return_value=None), \
             patch("scheduled_jobs.start_scheduled_jobs") as mock_start_jobs:
            try:
                main._run_startup_tasks()
                main._run_startup_tasks()
                mock_start_jobs.assert_called_once()
            finally:
                # Release the one-shot latch so other tests in this module/
                # process aren't affected by this test having claimed it.
                if main._startup_lock.locked():
                    main._startup_lock.release()


if __name__ == "__main__":
    # ponytail: smallest runnable check — a plain assert-based smoke test,
    # for a quick sanity run outside pytest.
    t = TestStartupTasksIdempotency()
    t.test_second_call_is_a_no_op_when_lock_already_held()
    t.test_scheduler_only_registered_once_across_two_real_calls()
    print("OK")
