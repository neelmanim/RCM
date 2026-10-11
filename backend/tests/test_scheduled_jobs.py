"""
tests/test_scheduled_jobs.py
────────────────────────────
Regression tests for background job correctness.

RCA-2026-05-29-sync: _messenger_nightly_sync() was importing
_normalize_phone from 'dialer_service' (wrong module — it lives in
routes.dialer_routes). This caused an ImportError at runtime, silently
killing the entire Alternate Messenger nightly catch-up every night.
"""

import pytest
from unittest.mock import patch, MagicMock


# ─────────────────────────────────────────────────────────────────────────────
# _timers leak regression
# ─────────────────────────────────────────────────────────────────────────────

class TestSchedulerTimerBookkeeping:
    """RCA 2026-08-24 (staging OOM): _schedule_recurring used to append every
    re-scheduled Timer to a module-level list that was only ever cleared on
    graceful shutdown — never on an OOM kill — so a 30s-interval job alone
    added ~2880 permanently-retained entries/day. Fixed by keying _timers by
    job name so each re-schedule replaces its own prior entry."""

    def test_repeated_reschedule_does_not_grow_timer_count(self):
        import scheduled_jobs

        # A stand-in for threading.Timer that "fires" synchronously on
        # start() instead of using a real background thread — this suite's
        # global daemon-thread-suppression fixture (conftest.py) isn't
        # compatible with real threading.Timer construction, and the point
        # of this test is _schedule_recurring's bookkeeping, not real timing.
        class FakeTimer:
            _live = 0
            _stopped = False

            def __init__(self, interval, fn):
                self.fn = fn
                self.cancelled = False
                FakeTimer._live += 1

            def start(self):
                if not self.cancelled and not FakeTimer._stopped:
                    self.fn()

            def cancel(self):
                self.cancelled = True

        scheduled_jobs._timers.clear()
        tick_count = {"n": 0}

        def fake_job():
            tick_count["n"] += 1
            if tick_count["n"] >= 5:
                FakeTimer._stopped = True  # stop the synchronous start()->fn() chain

        with patch.object(scheduled_jobs.threading, "Timer", FakeTimer):
            scheduled_jobs._schedule_recurring(fake_job, 0, "fake_job")

        # 6 FakeTimer instances were constructed (initial + 5 re-schedules
        # inside wrapper's recursive start() chain) — proving reschedule
        # really happened repeatedly — but _timers still holds exactly one.
        assert tick_count["n"] == 5
        assert FakeTimer._live == 6
        assert len(scheduled_jobs._timers) == 1
        assert "fake_job" in scheduled_jobs._timers

        scheduled_jobs._timers.pop("fake_job").cancel()


# ─────────────────────────────────────────────────────────────────────────────
# Scheduler leader election (cross-process dedup under --workers 2)
# ─────────────────────────────────────────────────────────────────────────────

class TestSchedulerLeaderElection:
    """RCA 2026-10-05 (staging OOM + likely duplicate campaign sends):
    Dockerfile moved to --workers 2 on 2026-10-01. Every job in this file
    except journey_engine_tick (which dedups via SELECT...FOR UPDATE SKIP
    LOCKED) has no cross-process guard, so both workers independently ran
    the full job suite — confirmed live via paired "[EmailSync] Synced
    50/50" log lines a few hundred ms apart on every tick. _is_scheduler_leader()
    uses a Postgres advisory lock so only one worker process ever registers
    anything."""

    def test_sqlite_is_always_leader(self):
        """No multi-process concern in local dev/tests — sqlite has no
        advisory locks, so this must short-circuit to True rather than
        attempt one."""
        import scheduled_jobs
        assert scheduled_jobs._is_scheduler_leader() is True

    def test_start_scheduled_jobs_noop_when_not_leader(self):
        """The worker that loses the election must register zero job
        timers — this is what actually prevents the double-run, not just
        the lock check existing. Patches time.sleep so the retry backoff
        (added 2026-10-05) doesn't make this test take ~15s real time, and
        patches the background-retry handoff (added the same day, see
        test_start_scheduled_jobs_falls_through_to_background_retry) so
        this test only asserts the immediate-registration half."""
        import scheduled_jobs

        scheduled_jobs._timers.clear()
        with patch.object(scheduled_jobs, "_is_scheduler_leader", return_value=False), \
             patch.object(scheduled_jobs.time, "sleep"), \
             patch.object(scheduled_jobs, "_retry_leader_election_in_background"):
            scheduled_jobs.start_scheduled_jobs()
        assert scheduled_jobs._timers == {}

    def test_start_scheduled_jobs_retries_before_giving_up(self):
        """RCA 2026-10-05: a new worker's one-shot leader check used to lose
        forever if it raced a moment too early against the old worker's
        shutdown — confirmed live, a redeploy left journey_engine_tick (and
        every other scheduled job) dead for the rest of that deploy's life.
        Retries with backoff instead of one immediate check. Patches
        _schedule_recurring itself (rather than asserting on _timers) so
        this only exercises the leader-retry logic, not real
        threading.Timer construction."""
        import scheduled_jobs

        # Fails the first 3 checks, succeeds on the 4th — must not give up early.
        with patch.object(scheduled_jobs, "_is_scheduler_leader", side_effect=[False, False, False, True]), \
             patch.object(scheduled_jobs.time, "sleep") as mock_sleep, \
             patch.object(scheduled_jobs, "_schedule_recurring") as mock_schedule:
            scheduled_jobs.start_scheduled_jobs()
        assert mock_sleep.call_count == 3
        assert mock_schedule.called  # proceeded to register jobs, didn't bail out

    def test_start_scheduled_jobs_falls_through_to_background_retry(self):
        """RCA 2026-10-05 (the real bug, found live hours after the first
        fix shipped): the ~15s fast-retry window only helps a crashed
        leader whose connection is already gone. On a normal Render
        zero-downtime deploy, the OLD container's lock-holding connection
        is *guaranteed* still alive for that entire window — Render only
        tears it down once the NEW container passes its health check, and
        this startup path gates that check. So the fast window always
        loses on a routine deploy, and simply returning afterward (the
        original fix's behavior) left the scheduler dead until the NEXT
        deploy — confirmed live on staging: a test enrollment sat
        unprocessed for 10+ minutes, every scheduled job silent. Falling
        through to _retry_leader_election_in_background() instead of just
        returning is what actually closes this gap."""
        import scheduled_jobs

        scheduled_jobs._timers.clear()
        with patch.object(scheduled_jobs, "_is_scheduler_leader", return_value=False), \
             patch.object(scheduled_jobs.time, "sleep") as mock_sleep, \
             patch.object(scheduled_jobs, "_retry_leader_election_in_background") as mock_retry:
            scheduled_jobs.start_scheduled_jobs()
        assert scheduled_jobs._timers == {}
        assert mock_sleep.call_count == len(scheduled_jobs._LEADER_ELECTION_RETRY_DELAYS)
        mock_retry.assert_called_once()

    def test_retry_leader_election_in_background_keeps_trying_until_it_wins(self):
        """Proves the background retry doesn't give up after one more try
        either — it keeps re-arming itself every
        _LEADER_ELECTION_BACKGROUND_RETRY_SECONDS until it wins, then
        registers jobs exactly once. A fake Timer that runs its target
        immediately (rather than after a real delay) keeps this
        synchronous and avoids constructing a real threading.Timer, which
        conftest's daemon-thread suppression fixture can't handle (a
        pre-existing test-harness gap, not a production concern — see
        test_start_scheduled_jobs_retries_before_giving_up's own note)."""
        import scheduled_jobs

        class ImmediateTimer:
            def __init__(self, interval, func):
                self.func = func

            def start(self):
                self.func()

        scheduled_jobs._timers.clear()
        try:
            with patch.object(scheduled_jobs, "_is_scheduler_leader", side_effect=[False, False, True]), \
                 patch.object(scheduled_jobs.threading, "Timer", ImmediateTimer), \
                 patch.object(scheduled_jobs, "_register_jobs") as mock_register:
                scheduled_jobs._retry_leader_election_in_background()
            mock_register.assert_called_once()
        finally:
            # The fake ImmediateTimer instances this stashes in _timers
            # have no .cancel() (real threading.Timer does) — clear them
            # so a later test's stop_scheduled_jobs() sweep doesn't crash.
            scheduled_jobs._timers.clear()

    def test_background_leader_retry_backs_off_to_a_cap(self):
        """Staging OOM RCA 2026-10-06: the non-leader worker retried every 20s
        forever (a new thread + PG connection each time). It now doubles the
        wait each miss, capped at _LEADER_ELECTION_BACKGROUND_RETRY_MAX_SECONDS."""
        import scheduled_jobs
        delays = []

        class ImmediateTimer:
            def __init__(self, interval, func):
                delays.append(interval)
                self.func = func

            def start(self):
                self.func()

        scheduled_jobs._timers.clear()
        try:
            with patch.object(scheduled_jobs, "_is_scheduler_leader", side_effect=[False] * 6 + [True]), \
                 patch.object(scheduled_jobs.threading, "Timer", ImmediateTimer), \
                 patch.object(scheduled_jobs, "_register_jobs"):
                scheduled_jobs._retry_leader_election_in_background()
            assert delays == [20, 40, 80, 160, 300, 300, 300]
        finally:
            scheduled_jobs._timers.clear()

    def test_stop_scheduled_jobs_releases_the_leader_connection(self):
        """RCA 2026-10-05: stop_scheduled_jobs() used to only cancel timers,
        never closing _scheduler_leader_conn — so a graceful shutdown left
        the advisory lock held until the OS socket eventually closed on its
        own, locking every worker in the NEXT deploy's container out of
        ever becoming leader (confirmed live: journey_engine_tick and every
        other scheduled job silently stopped running after a redeploy).
        Closing it here is what actually releases the lock immediately."""
        import scheduled_jobs

        fake_conn = MagicMock()
        scheduled_jobs._scheduler_leader_conn = fake_conn
        try:
            scheduled_jobs.stop_scheduled_jobs()
            fake_conn.close.assert_called_once()
            assert scheduled_jobs._scheduler_leader_conn is None
        finally:
            scheduled_jobs._scheduler_leader_conn = None

    def test_stop_scheduled_jobs_is_safe_when_never_elected_leader(self):
        """A worker that lost the election (never set _scheduler_leader_conn)
        must not blow up on shutdown."""
        import scheduled_jobs

        scheduled_jobs._scheduler_leader_conn = None
        scheduled_jobs.stop_scheduled_jobs()  # must not raise
        assert scheduled_jobs._scheduler_leader_conn is None


class TestImportCorrectness:
    """
    Verify that _normalize_phone is importable from the correct module.
    These tests catch the exact class  that broke the Alternate Messenger nightly
    sync: a wrong-module import that only fails at runtime, not at parse time.
    """

    def test_normalize_phone_importable_from_dialer_routes(self):
        """_normalize_phone MUST be importable from routes.dialer_routes."""
        try:
            from routes.dialer_routes import _normalize_phone
        except ImportError as e:
            pytest.fail(
                f"_normalize_phone is not importable from routes.dialer_routes: {e}\n"
                "This breaks the Alternate Messenger nightly sync (RCA-2026-05-29-sync)."
            )

    def test_normalize_phone_not_in_dialer_service(self):
        """
        _normalize_phone must NOT be imported from dialer_service —
        that import will always fail and silently kill the nightly sync.
        Guard against anyone moving it back.
        """
        import dialer_service
        assert not hasattr(dialer_service, "_normalize_phone"), (
            "_normalize_phone must NOT be defined in dialer_service. "
            "scheduled_jobs.py imports it from routes.dialer_routes. "
            "If you move it, update the import in scheduled_jobs.py too."
        )

    def test_normalize_phone_works_correctly(self):
        """Smoke-test the function itself while we have it imported."""
        from routes.dialer_routes import _normalize_phone
        assert _normalize_phone("+91 98765 43210") == "919876543210"
        assert _normalize_phone("(123) 456-7890") == "1234567890"
        assert _normalize_phone("") == ""
        assert _normalize_phone(None) == ""


# ─────────────────────────────────────────────────────────────────────────────
# _messenger_nightly_sync regression
# ─────────────────────────────────────────────────────────────────────────────

class TestMessengerNightlySync:
    """
    RCA-2026-05-29-sync: _messenger_nightly_sync() silently failed every night
    because line 340 of scheduled_jobs.py imported _normalize_phone from
    'dialer_service' instead of 'routes.dialer_routes'.

    These tests confirm:
    1. The sync function runs to completion without an ImportError.
    2. Calls are upserted when provider returns data.
    3. Duplicate calls are skipped.
    4. Calls with no phone are handled gracefully (no crash).
    """

    def _make_mock_event(self, phone="+919876543210", call_id="cv-001"):
        event = MagicMock()
        event.phone_number = phone
        event.direction = "outbound"
        event.event_type = "CALL_ENDED"
        event.duration = 45
        event.recording_url = None
        event.transcript = None
        event.started_at = None
        event.ended_at = None
        return event

    def _run_sync(self, db, provider_mock, calls_data):
        """Helper: patch all external deps and run _messenger_nightly_sync."""
        from scheduled_jobs import _messenger_nightly_sync

        provider_mock.fetch_calls_paginated.side_effect = [
            {"calls": calls_data},
            {"calls": []},            # second page → stop
        ]

        with patch("scheduled_jobs.SessionLocal", return_value=db), \
             patch("scheduled_jobs._get_settings", return_value=MagicMock(messenger_last_sync_at=None)), \
             patch("scheduled_jobs._instantiate_provider", return_value=provider_mock):
            _messenger_nightly_sync()

    def test_sync_runs_without_import_error(self, db):
        """
        Core regression: _messenger_nightly_sync must NOT raise ImportError.
        Before the fix, this always crashed at 'from dialer_service import _normalize_phone'.
        """
        from scheduled_jobs import _messenger_nightly_sync

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {"calls": []}

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=MagicMock(messenger_last_sync_at=None)), \
             patch("dialer_service._instantiate_provider", return_value=provider):
            try:
                _messenger_nightly_sync()
            except ImportError as e:
                pytest.fail(
                    f"_messenger_nightly_sync raised ImportError: {e}\n"
                    "Check the _normalize_phone import at line 340 of scheduled_jobs.py."
                )

    def test_sync_skips_duplicate_calls(self, db):
        """Calls already in dialer_calls (by provider_call_id) must be skipped."""
        import models
        from scheduled_jobs import _messenger_nightly_sync

        # Pre-insert a call with the same call_id
        existing = models.DialerCall(
            provider="messenger",
            provider_call_id="cv-dup-001",
            phone_number="+919876543210",
            direction="outbound",
            status="CALL_ENDED",
        )
        db.add(existing)
        db.commit()

        provider = MagicMock()
        event = self._make_mock_event(call_id="cv-dup-001")
        provider.handle_webhook.return_value = event
        provider.fetch_calls_paginated.side_effect = [
            {"calls": [{"call_id": "cv-dup-001"}]},
            {"calls": []},
        ]

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=MagicMock(messenger_last_sync_at=None)), \
             patch("dialer_service._instantiate_provider", return_value=provider):
            _messenger_nightly_sync()

        # Should still be exactly 1 row (no duplicate written)
        count = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "cv-dup-001"
        ).count()
        assert count == 1, f"Duplicate call was inserted (count={count}), dedup guard broken"

    def test_sync_handles_call_with_no_phone(self, db):
        """Calls with no phone_number must not crash the sync."""
        import models
        from scheduled_jobs import _messenger_nightly_sync

        provider = MagicMock()
        event = self._make_mock_event(phone=None, call_id="cv-nophone-001")
        provider.handle_webhook.return_value = event
        provider.fetch_calls_paginated.side_effect = [
            {"calls": [{"call_id": "cv-nophone-001"}]},
            {"calls": []},
        ]

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=MagicMock(messenger_last_sync_at=None)), \
             patch("dialer_service._instantiate_provider", return_value=provider):
            try:
                _messenger_nightly_sync()
            except Exception as e:
                pytest.fail(f"Sync crashed on call with no phone: {e}")

    def test_sync_skips_when_messenger_not_configured(self, db):
        """If _instantiate_provider returns None, sync must exit silently — no crash."""
        from scheduled_jobs import _messenger_nightly_sync

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=MagicMock()), \
             patch("dialer_service._instantiate_provider", return_value=None):
            try:
                _messenger_nightly_sync()
            except Exception as e:
                pytest.fail(f"Sync should exit silently when provider is None, got: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# _klenty_nightly_sync — temporary bridging integration (docs/RELEASES.md)
# ─────────────────────────────────────────────────────────────────────────────

class TestKlentyNightlySync:
    """
    Klenty is pull-only. The /user/{username}/calls endpoint validates the
    requested username but does NOT scope results to it (LIVE-TESTED
    2026-07-29: two different accepted usernames returned byte-identical
    data) — so the sync fetches once (trying each SDR's username only until
    one is accepted) and attributes every call by its own embedded
    "username" field. These tests confirm:
    1. The job no-ops cleanly when klenty_enabled=False or the API key is unset.
    2. Calls are matched to existing leads by phone, then by email.
    3. Unmatched contacts auto-create a new lead, assigned to the calling SDR.
    4. Duplicate calls (by provider_call_id) are skipped.
    5. Klenty calls never get an SDR-typed outcome (stays NULL — no Connect
       Rate tie-in, per the plan's decision).
    6. A rejected username falls back to the next SDR's; a fully rejected
       set aborts cleanly without marking the run as synced.
    7. Attribution follows the call's own "username" field, not whichever
       username happened to make the successful request.
    """

    def _settings_mock(self, enabled=True, api_key="encrypted-key"):
        s = MagicMock()
        s.klenty_enabled = enabled
        s.klenty_api_key = api_key
        s.klenty_last_sync_at = None
        return s

    def _sample_call(self, call_sid="CA-1", phone="+17135241010", email="jim@test.com"):
        return {
            "callSid": call_sid,
            "username": "sdr@screen-magic.com",
            "type": "OUTBOUND",
            "duration": 60,
            "startTime": "2026-07-01T10:00:00.000Z",
            "endTime": "2026-07-01T10:01:00.000Z",
            "prospectPhoneNo": phone,
            "email": email,
            "firstName": "Jim",
            "lastName": "Slaton",
            "company": "Acme",
            "disposition": "ANSWERED",
        }

    def test_noop_when_klenty_disabled(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock(enabled=False)):
            _klenty_nightly_sync()

        assert db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").count() == 0

    def test_second_concurrent_call_does_not_run(self, db):
        """
        RCA 2026-07-31 (LIVE): the recurring 24h job, the startup catch-up,
        and a manual admin-triggered backfill can all invoke this function.
        With no lock, two overlapping runs raced on the same call_id and one
        crashed after the other had already committed it. A held lock must
        make a second concurrent call return immediately, untouched.
        """
        import scheduled_jobs

        assert scheduled_jobs._klenty_sync_lock.acquire(blocking=False)
        try:
            result = scheduled_jobs._klenty_nightly_sync()
        finally:
            scheduled_jobs._klenty_sync_lock.release()

        assert result == {"ran": False, "reason": "Klenty sync already running"}

    def test_noop_when_api_key_missing(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock(api_key=None)):
            _klenty_nightly_sync()

        assert db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").count() == 0

    def test_matches_existing_lead_by_phone(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user, create_test_lead

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()
        lead = create_test_lead(db, email="jim@test.com", phone="7135241010")
        sdr_id, lead_id = sdr.id, lead.id  # capture before the sync closes this session

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call()], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call is not None
        assert call.lead_id == lead_id
        assert call.user_id == sdr_id
        assert call.outcome is None  # never SDR-tagged — no CRM outcome for a batch-synced call
        assert call.provider_disposition == "ANSWERED"  # raw telephony signal IS captured (RCA 2026-08-03)
        assert call.source == "klenty_sync"
        # No new lead should have been created — it matched the existing one
        assert db.query(models.Lead).count() == 1

    def test_matches_existing_lead_by_email_when_phone_unmatched(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user, create_test_lead

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()
        lead = create_test_lead(db, email="jim@test.com", phone=None)
        lead_id = lead.id  # capture before the sync closes this session

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call(phone="+19999999999")], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call.lead_id == lead_id
        assert db.query(models.Lead).count() == 1

    def test_creates_new_lead_for_unmatched_contact(self, db):
        """Unmatched contacts auto-create a lead, assigned to the calling SDR —
        matches the one-time CSV backfill's behavior (per user decision)."""
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR", pod_id="pod-1")
        sdr.dialer_enabled = True
        db.commit()
        sdr_id = sdr.id  # capture before the sync closes this session

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call(phone="+15551234567", email="new-contact@test.com")],
            "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        new_lead = db.query(models.Lead).filter(models.Lead.email == "new-contact@test.com").first()
        assert new_lead is not None
        assert new_lead.first_name == "Jim"
        assert new_lead.last_name == "Slaton"
        assert new_lead.status == "Calling"
        assert new_lead.lead_source.startswith("klenty_sync:")
        assert new_lead.pod_id == "pod-1"
        assert new_lead.research_company is not None

        assignment = db.execute(
            models.lead_assignments.select().where(models.lead_assignments.c.lead_id == new_lead.id)
        ).first()
        assert assignment is not None
        assert assignment.user_id == sdr_id

    def test_skips_duplicate_calls(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()

        existing = models.DialerCall(provider="klenty", provider_call_id="CA-1", status="CALL_ENDED", direction="outbound")
        db.add(existing)
        db.commit()

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call(call_sid="CA-1")], "has_more": False, "page": 1,
        }

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        count = db.query(models.DialerCall).filter(models.DialerCall.provider_call_id == "CA-1").count()
        assert count == 1, f"Duplicate Klenty call was inserted (count={count})"

    def test_skips_duplicate_within_same_run(self, db):
        """
        RCA 2026-07-31 (LIVE, on a 29-day manual backfill): Klenty's own feed
        returned the same call_id twice in one run. Neither occurrence was
        committed yet when the second was processed, so the DB existence
        check alone didn't catch it — the second insert hit the
        (provider, provider_call_id) unique constraint and crashed the whole
        sync. Must be caught in-memory instead.
        """
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call(call_sid="CA-DUP"), self._sample_call(call_sid="CA-DUP")],
            "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            result = _klenty_nightly_sync()

        assert result["ran"] is True
        count = db.query(models.DialerCall).filter(models.DialerCall.provider_call_id == "CA-DUP").count()
        assert count == 1, f"Same-run duplicate was inserted twice (count={count})"

    def test_persists_last_sync_timestamp(self, db):
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()

        settings = self._settings_mock()
        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {"calls": [], "has_more": False, "page": 1}

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=settings), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        assert settings.klenty_last_sync_at is not None

    # ── LIVE-TESTED 2026-07-29: /user/{username}/calls validates the requested
    # username but does not scope results to it — two different accepted
    # usernames returned byte-identical data. These tests cover the corrected
    # behavior: try each SDR's username only until one is accepted, then
    # attribute every call by its own embedded "username" field.

    def test_falls_back_to_next_sdrs_username_if_first_is_rejected(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        create_test_user(db, email="rejected@screen-magic.com", role="SDR").dialer_enabled = True
        create_test_user(db, email="sdr@screen-magic.com", role="SDR").dialer_enabled = True
        db.commit()

        provider = MagicMock()
        # _MAX_RETRIES=3 exhausts on the first (rejected) username, then the
        # second username's first attempt succeeds.
        provider.fetch_calls_paginated.side_effect = [
            RuntimeError("Klenty API error 403: Invalid user"),
            RuntimeError("Klenty API error 403: Invalid user"),
            RuntimeError("Klenty API error 403: Invalid user"),
            {"calls": [self._sample_call()], "has_more": False, "page": 1},
        ]
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"), \
             patch("time.sleep"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call is not None, "should still import once a later SDR's username is accepted"

    def test_aborts_cleanly_when_no_sdr_username_is_accepted(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        create_test_user(db, email="sdr@screen-magic.com", role="SDR").dialer_enabled = True
        db.commit()

        settings = self._settings_mock()
        provider = MagicMock()
        provider.fetch_calls_paginated.side_effect = RuntimeError("Klenty API error 403: Invalid user")

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=settings), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"), \
             patch("time.sleep"):
            _klenty_nightly_sync()  # must not raise

        assert db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").count() == 0
        assert settings.klenty_last_sync_at is None, "a fully-failed run must not be marked as synced"

    def test_attributes_call_to_sdr_by_embedded_username_not_requested_username(self, db):
        """The core fix: even though sdr1's username is the one that made the
        successful API call, a returned call whose own "username" field
        matches sdr2 must be attributed to sdr2, not sdr1."""
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr1 = create_test_user(db, email="sdr1@screen-magic.com", role="SDR")
        sdr1.dialer_enabled = True
        sdr2 = create_test_user(db, email="sdr2@screen-magic.com", role="SDR")
        sdr2.dialer_enabled = True
        db.commit()
        sdr2_id = sdr2.id

        klenty_call = self._sample_call(email="new-contact@test.com")
        klenty_call["username"] = "sdr2@screen-magic.com"

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [klenty_call], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call is not None
        assert call.user_id == sdr2_id, "must attribute by the call's own username field, not the requested one"

    def test_skips_call_whose_username_matches_no_sdr(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        db.commit()

        provider = MagicMock()
        unattributed_call = self._sample_call()
        unattributed_call["username"] = "someone-not-tracked@screen-magic.com"
        provider.fetch_calls_paginated.return_value = {
            "calls": [unattributed_call], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()  # must not raise or misattribute

        assert db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").count() == 0

    def test_attributes_call_even_when_sdr_has_alternatecrm_dialer_disabled(self, db):
        """
        RCA 2026-07-31 (LIVE): the roster query used to filter on
        dialer_enabled — a toggle for Alternate CRM's OWN click-to-call dialer
        (Alternate Messenger/Aircall), unrelated to Klenty. Any SDR who never needed
        Alternate CRM's own dialer (because they call through Klenty) had
        dialer_enabled=False and their real Klenty calls were silently and
        permanently discarded as "unattributed" on every sync. Roster is now
        just role SDR/AE, independent of that toggle.
        """
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user, create_test_lead

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = False  # Alternate CRM's own dialer OFF — Klenty is unaffected
        db.commit()
        lead = create_test_lead(db, email="jim@test.com", phone="7135241010")
        sdr_id, lead_id = sdr.id, lead.id

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call()], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call is not None, "Klenty call was discarded because dialer_enabled=False"
        assert call.lead_id == lead_id
        assert call.user_id == sdr_id


def KlentyRealNormalize(raw):
    """Use the real KlentyDialerProvider._normalize_call logic in tests that mock
    the provider instance itself — avoids re-declaring the mapping in every test.
    Built from the unpatched class (imported at module load, before any test
    patches klenty_provider.KlentyDialerProvider) to avoid infinite recursion."""
    return _REAL_KLENTY_PROVIDER._normalize_call(raw)


from klenty_provider import KlentyDialerProvider as _RealKlentyDialerProvider
_REAL_KLENTY_PROVIDER = _RealKlentyDialerProvider(api_key="unused")


# ─────────────────────────────────────────────────────────────────────────────
# _instantly_sync_job — Instantly.ai campaign/lead-engagement pull sync
# (polling-only v1, informational only — never writes Lead.status)
# ─────────────────────────────────────────────────────────────────────────────

class TestInstantlySyncJob:
    """
    Instantly leads are always leads that already exist in Alternate CRM. Unlike
    Klenty, an unmatched email is logged and skipped — never auto-created as
    a new Lead (explicit user decision). These tests confirm:
    1. The job no-ops cleanly when instantly_enabled=False or the API key is unset.
    2. A second concurrent call is rejected by the lock.
    3. An Instantly lead matching an existing Alternate CRM lead by email (case-
       insensitive) updates its interest cache columns and writes an activity row.
    4. An unmatched email is logged and skipped — does NOT create a new Lead.
    5. A second run with unchanged engagement numbers does not duplicate the
       activity row (dedup).
    6. instantly_last_sync_at only updates after a full clean pass.
    """

    def _settings_mock(self, enabled=True, api_key="decrypted-key", last_sync_at=None):
        s = MagicMock()
        s.instantly_enabled = enabled
        s.instantly_api_key = api_key
        s.instantly_last_sync_at = last_sync_at
        return s

    def _sample_instantly_lead(self, email="jim@test.com", lead_id="il-1",
                                interest=1, open_ts="2026-07-01T10:00:00Z",
                                click_ts=None, reply_ts=None):
        return {
            "id": lead_id,
            "email": email,
            "lt_interest_status": interest,
            "email_open_count": 1,
            "timestamp_last_open": open_ts,
            "email_click_count": 1 if click_ts else 0,
            "timestamp_last_click": click_ts,
            "timestamp_last_reply": reply_ts,
        }

    def _provider_mock(self, leads, campaign_id="camp-1"):
        provider = MagicMock()
        provider.list_campaigns.return_value = [{"id": campaign_id, "status": 1}]
        provider.list_leads.return_value = {"items": leads, "next_starting_after": None}
        provider.list_lead_labels.return_value = {"items": []}
        return provider

    def test_the_poll_no_longer_writes_reply_rows_or_calls_unibox(self, db):
        """v13.8.0: replies are stored by _instantly_mail_sync_job (one global
        read, keyed on Instantly's email id). The per-lead poll used to write a
        second row for every webhook reply and copied `items[0]` of the lead's
        inbox, which could be the wrong reply."""
        import models
        from scheduled_jobs import _instantly_sync_job
        from conftest import create_test_lead

        lead = create_test_lead(db, email="jim@test.com")
        lead_id = lead.id
        provider = self._provider_mock([self._sample_instantly_lead(reply_ts="2026-07-02T10:00:00Z")])
        settings = self._settings_mock()

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=settings), \
             patch("instantly_provider.InstantlyProvider", return_value=provider):
            result = _instantly_sync_job()

        assert result["ran"] is True and settings.instantly_last_sync_at is not None
        provider.list_unibox_emails.assert_not_called()
        assert db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.lead_id == lead_id, models.LeadEmailActivity.direction == "inbound").count() == 0

    def test_noop_when_instantly_disabled(self, db):
        import models
        from scheduled_jobs import _instantly_sync_job

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock(enabled=False)):
            result = _instantly_sync_job()

        assert result == {"ran": False, "reason": "Instantly sync not enabled"}
        assert db.query(models.LeadEmailActivity).filter(models.LeadEmailActivity.source == "instantly").count() == 0

    def test_noop_when_api_key_missing(self, db):
        import models
        from scheduled_jobs import _instantly_sync_job

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock(api_key=None)):
            result = _instantly_sync_job()

        assert result == {"ran": False, "reason": "Instantly sync not enabled"}
        assert db.query(models.LeadEmailActivity).count() == 0

    def test_second_concurrent_call_does_not_run(self, db):
        import scheduled_jobs

        assert scheduled_jobs._instantly_sync_lock.acquire(blocking=False)
        try:
            result = scheduled_jobs._instantly_sync_job()
        finally:
            scheduled_jobs._instantly_sync_lock.release()

        assert result == {"ran": False, "reason": "Instantly sync already running"}

    def test_matches_existing_lead_by_email_case_insensitive_and_updates_cache(self, db):
        import models
        from scheduled_jobs import _instantly_sync_job
        from conftest import create_test_lead

        lead = create_test_lead(db, email="jim@test.com")
        lead_id = lead.id

        ilead = self._sample_instantly_lead(email="Jim@Test.com")  # mixed case, like Instantly might return
        provider = self._provider_mock([ilead])

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("instantly_provider.InstantlyProvider", return_value=provider):
            result = _instantly_sync_job()

        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        assert result["ran"] is True
        assert result["matched"] == 1
        assert lead.instantly_interest_status == 1
        assert lead.instantly_interest_label == "Interested"
        assert lead.instantly_last_synced_at is not None

        activity = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.lead_id == lead_id,
            models.LeadEmailActivity.source == "instantly",
        ).first()
        assert activity is not None
        assert activity.instantly_lead_id == "il-1"
        assert activity.instantly_campaign_id == "camp-1"
        assert activity.open_count == 1

    def test_unmatched_email_is_logged_and_skipped_not_created_as_new_lead(self, db):
        """The one behavior that diverges from Klenty: no email match must
        never create a new Lead."""
        import models
        from scheduled_jobs import _instantly_sync_job

        ilead = self._sample_instantly_lead(email="no-match@test.com")
        provider = self._provider_mock([ilead])

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("instantly_provider.InstantlyProvider", return_value=provider):
            result = _instantly_sync_job()

        assert result["ran"] is True
        assert result["unmatched"] == 1
        assert db.query(models.Lead).count() == 0
        assert db.query(models.LeadEmailActivity).count() == 0

    def test_dedup_skips_unchanged_engagement_numbers_on_second_run(self, db):
        import models
        from scheduled_jobs import _instantly_sync_job
        from conftest import create_test_lead

        lead = create_test_lead(db, email="jim@test.com")
        lead_id = lead.id

        ilead = self._sample_instantly_lead(email="jim@test.com")
        provider = self._provider_mock([ilead])

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("instantly_provider.InstantlyProvider", return_value=provider):
            _instantly_sync_job()
            _instantly_sync_job()

        count = db.query(models.LeadEmailActivity).filter(
            models.LeadEmailActivity.lead_id == lead_id,
            models.LeadEmailActivity.source == "instantly",
        ).count()
        assert count == 1, f"unchanged engagement numbers must not duplicate a row on re-sync (count={count})"

    def test_last_sync_at_only_updates_after_clean_pass(self, db):
        from scheduled_jobs import _instantly_sync_job

        settings = self._settings_mock()
        provider = self._provider_mock([self._sample_instantly_lead()])

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=settings), \
             patch("instantly_provider.InstantlyProvider", return_value=provider):
            _instantly_sync_job()

        assert settings.instantly_last_sync_at is not None

    def test_last_sync_at_not_updated_on_unhandled_exception(self, db):
        from scheduled_jobs import _instantly_sync_job

        settings = self._settings_mock()
        provider = MagicMock()
        provider.list_campaigns.side_effect = RuntimeError("Instantly API exploded")

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=settings), \
             patch("instantly_provider.InstantlyProvider", return_value=provider):
            result = _instantly_sync_job()

        assert result["ran"] is False
        assert settings.instantly_last_sync_at is None


# ─────────────────────────────────────────────────────────────────────────────
# _resume_stalled_instantly_enrollments — v13.3.0 webhook-miss safety net
# (plan section 3): called after _instantly_sync_job's per-lead poll above.
# ─────────────────────────────────────────────────────────────────────────────

class TestResumeStalledInstantlyEnrollments:
    """A lead parked at an instantly_sequence node whose Instantly webhook
    was dropped must not wait forever — the 15-min poll's engagement data
    (reply/interest/campaign status) is checked for an outcome
    resume_instantly_sequence_step hasn't already been told about."""

    def _setup(self, db, stop_on_reply=False):
        import os
        os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")
        import models
        from unittest.mock import MagicMock, patch as _patch
        from journey_engine import engine as je
        from conftest import create_test_lead
        from test_cadence_playbook import _journey, _edges, _run, TRIGGER, WAIT

        settings = models.SyncSettings(id=1, instantly_api_key="test-key")
        db.add(settings)
        db.commit()

        node = {"id": "i", "type": "instantly_sequence",
                "data": {"steps": [{"subject": "Hi", "body": "Following up.", "delay_days": 0}]}}
        journey = _journey(db, [TRIGGER, node, WAIT], _edges(("t", "i"), ("i", "w")),
                           **({"stop_on_reply": True} if stop_on_reply else {}))
        lead = create_test_lead(db, email="stalled@example.com")

        provider = MagicMock()
        provider.create_campaign.return_value = {"id": "camp-1"}
        provider.add_lead_to_campaign.return_value = {"id": "ilead-1"}
        with _patch("instantly_provider.InstantlyProvider", return_value=provider):
            e = je.enroll_lead(db, journey, lead)
            e = _run(db, e)
        assert e.status == "active" and e.current_node_id == "i"
        return e, lead

    def test_a_reply_logged_since_enrollment_resumes_it(self, db):
        import models
        from datetime import datetime, timezone
        from scheduled_jobs import _resume_stalled_instantly_enrollments

        e, lead = self._setup(db)
        jie = db.query(models.JourneyInstantlyEnrollment).filter(
            models.JourneyInstantlyEnrollment.journey_enrollment_id == e.id).one()

        # The poll already wrote this inbound activity row this cycle (or an
        # earlier one) — the webhook that should have resumed it never arrived.
        db.add(models.LeadEmailActivity(
            lead_id=lead.id, direction="inbound", source="instantly",
            instantly_campaign_id=jie.instantly_campaign_id,
            timestamp=datetime.now(timezone.utc),
        ))
        db.commit()

        _resume_stalled_instantly_enrollments(db, {})

        db.expire_all()
        jie = db.query(models.JourneyInstantlyEnrollment).get(jie.id)
        e = db.query(models.JourneyEnrollment).get(e.id)
        assert jie.status == "completed" and jie.end_reason == "replied"
        assert e.current_node_id == "w"

    def test_polled_unsubscribed_status_hard_stops_the_enrollment(self, db):
        import models
        from unittest.mock import patch as _patch
        from instantly_provider import LEAD_STATUS_LABELS
        from scheduled_jobs import _resume_stalled_instantly_enrollments

        e, lead = self._setup(db)
        unsubscribed_code = next(k for k, v in LEAD_STATUS_LABELS.items() if v == "Unsubscribed")

        with _patch("instantly_provider.InstantlyProvider") as MockProvider:
            MockProvider.return_value.remove_lead_from_campaign.return_value = {}
            _resume_stalled_instantly_enrollments(db, {lead.id: unsubscribed_code})

        db.expire_all()
        e = db.query(models.JourneyEnrollment).get(e.id)
        lead = db.query(models.Lead).get(lead.id)
        assert e.status == "exited_early" and e.exited_reason == "unsubscribed"
        assert lead.unsubscribed_at is not None

    def test_no_signal_leaves_the_enrollment_parked(self, db):
        import models
        from scheduled_jobs import _resume_stalled_instantly_enrollments

        e, lead = self._setup(db)
        _resume_stalled_instantly_enrollments(db, {})

        db.expire_all()
        e = db.query(models.JourneyEnrollment).get(e.id)
        assert e.status == "active" and e.current_node_id == "i"


# ─────────────────────────────────────────────────────────────────────────────
# _salesforce_auto_sync_job — V44: admin-configurable daily UTC schedule
# ─────────────────────────────────────────────────────────────────────────────

class TestSalesforceAutoSync:
    """
    _salesforce_auto_sync_job() ticks every 15 min (see start_scheduled_jobs)
    and must only actually run the sync once per UTC calendar day, at or after
    the admin-configured hour:minute — never before, and never twice.
    """

    def _make_settings(self, db, **overrides):
        import models
        settings = models.SyncSettings(
            id=1,
            sf_auto_sync_enabled=overrides.get("sf_auto_sync_enabled", True),
            sf_auto_sync_hour_utc=overrides.get("sf_auto_sync_hour_utc", 2),
            sf_auto_sync_minute_utc=overrides.get("sf_auto_sync_minute_utc", 0),
            sf_auto_sync_last_run_at=overrides.get("sf_auto_sync_last_run_at", None),
            sync_direction=overrides.get("sync_direction", "push_only"),
            sf_push_stage="Meeting Scheduled",
            lead_limit=1000,
        )
        db.add(settings)
        db.commit()
        return settings

    def test_noop_when_disabled(self, db):
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        self._make_settings(db, sf_auto_sync_enabled=False)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client") as mock_get_client, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_get_client.assert_not_called()

    def test_noop_when_hour_not_configured(self, db):
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        self._make_settings(db, sf_auto_sync_hour_utc=None)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client") as mock_get_client, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_get_client.assert_not_called()

    def test_noop_before_scheduled_time_today(self, db):
        """Configured for 2am UTC — a 1am tick must not run yet."""
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        self._make_settings(db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.run_full_salesforce_sync") as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 1, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_sync.assert_not_called()

    def test_runs_after_scheduled_time_and_records_last_run(self, db):
        """A tick after 2am, never synced before → runs once, stamps last_run_at."""
        import models
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        settings = self._make_settings(db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0)
        sf_client = MagicMock()
        now = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client", return_value=sf_client), \
             patch("salesforce.run_full_salesforce_sync", return_value={"leads_pushed_to_sf": 3, "leads_synced": 0}) as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = now
            _salesforce_auto_sync_job()

        mock_sync.assert_called_once()
        refreshed = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        stored = refreshed.sf_auto_sync_last_run_at
        if stored.tzinfo is None:
            stored = stored.replace(tzinfo=timezone.utc)
        assert stored == now

    def test_noop_if_already_run_today(self, db):
        """Already synced at 2:05am today — a later 3am tick must not re-run."""
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        already_ran_at = datetime(2026, 7, 20, 2, 5, tzinfo=timezone.utc)
        self._make_settings(
            db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0,
            sf_auto_sync_last_run_at=already_ran_at,
        )

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.run_full_salesforce_sync") as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_sync.assert_not_called()

    def test_runs_again_next_day_after_previous_run(self, db):
        """Ran yesterday at 2am — today's 3am tick must run again (new calendar day)."""
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        ran_yesterday = datetime(2026, 7, 19, 2, 0, tzinfo=timezone.utc)
        self._make_settings(
            db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0,
            sf_auto_sync_last_run_at=ran_yesterday,
        )
        sf_client = MagicMock()

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client", return_value=sf_client), \
             patch("salesforce.run_full_salesforce_sync", return_value={"leads_pushed_to_sf": 0, "leads_synced": 0}) as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_sync.assert_called_once()

    def test_noop_when_sf_client_unavailable(self, db):
        """Scheduled window has passed but Salesforce isn't configured — must not crash."""
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        self._make_settings(db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client", return_value=None), \
             patch("salesforce.run_full_salesforce_sync") as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            try:
                _salesforce_auto_sync_job()
            except Exception as e:
                pytest.fail(f"Job should exit quietly when SF client is unavailable, got: {e}")

        mock_sync.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# _email_sync_job — v10.9.5 (see scheduled_jobs.py docstring for the RCA:
# email sync had no scheduler and no webhook at all before this — only ran
# as a side-effect of a user opening a lead's Email tab).
# ─────────────────────────────────────────────────────────────────────────────

class TestEmailSyncJob:

    def test_noop_when_nylas_not_configured(self, db):
        from scheduled_jobs import _email_sync_job

        with patch("database.SessionLocal", return_value=db):
            result = _email_sync_job()

        assert result["ran"] is False
        assert "not configured" in result["reason"].lower()

    def test_noop_when_no_connected_mailbox(self, db):
        from scheduled_jobs import _email_sync_job
        from conftest import create_nylas_config

        create_nylas_config(db)

        with patch("database.SessionLocal", return_value=db):
            result = _email_sync_job()

        assert result["ran"] is False
        assert "no connected mailbox" in result["reason"].lower()

    def test_syncs_active_leads_and_records_last_run(self, db):
        import models
        from scheduled_jobs import _email_sync_job
        from conftest import create_nylas_config, create_user_mailbox, create_test_user, create_test_lead

        create_nylas_config(db)
        sdr = create_test_user(db, email="sdr@test.com", role="SDR")
        create_user_mailbox(db, user_id=sdr.id, email_address="sdr@test.com")
        lead = create_test_lead(db, email="active@test.com")
        lead_id = lead.id

        settings = models.SyncSettings(id=1)
        db.add(settings)
        db.commit()

        with patch("database.SessionLocal", return_value=db), \
             patch("routes.email_routes._sync_full_mailbox") as mock_sync:
            result = _email_sync_job()

        assert result["ran"] is True
        assert result["synced"] == 1
        mock_sync.assert_called_once()
        assert mock_sync.call_args[0][0] == lead_id

        refreshed = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        assert refreshed.email_sync_last_run_at is not None

    def test_skips_parked_leads(self, db):
        import models
        from scheduled_jobs import _email_sync_job
        from conftest import create_nylas_config, create_user_mailbox, create_test_user, create_test_lead

        create_nylas_config(db)
        sdr = create_test_user(db, email="sdr2@test.com", role="SDR")
        create_user_mailbox(db, user_id=sdr.id, email_address="sdr2@test.com")
        create_test_lead(db, email="parked@test.com", status="No Phone - Parked")

        with patch("database.SessionLocal", return_value=db), \
             patch("routes.email_routes._sync_full_mailbox") as mock_sync:
            result = _email_sync_job()

        assert result["ran"] is True
        assert result["synced"] == 0
        mock_sync.assert_not_called()

    def test_one_lead_failing_does_not_block_the_rest(self, db):
        import models
        from scheduled_jobs import _email_sync_job
        from conftest import create_nylas_config, create_user_mailbox, create_test_user, create_test_lead

        create_nylas_config(db)
        sdr = create_test_user(db, email="sdr3@test.com", role="SDR")
        create_user_mailbox(db, user_id=sdr.id, email_address="sdr3@test.com")
        create_test_lead(db, email="a@test.com")
        create_test_lead(db, email="b@test.com")

        with patch("database.SessionLocal", return_value=db), \
             patch("routes.email_routes._sync_full_mailbox", side_effect=[Exception("boom"), None]):
            result = _email_sync_job()

        assert result["ran"] is True
        assert result["synced"] == 1
        assert result["considered"] == 2


# ─────────────────────────────────────────────────────────────────────────────
# _scheduled_report_job — v11.4.0: per-report schedule, multiple reports
# ─────────────────────────────────────────────────────────────────────────────

class TestScheduledReportJob:
    """Ticks every 15 min; each enabled ReportConfig is checked independently
    via report_service.is_due(). One report's failure must not block others."""

    def _make_report(self, db, **overrides):
        import models
        report = models.ReportConfig(
            name=overrides.get("name", "Weekly Report"),
            enabled=overrides.get("enabled", True),
            components='["key_metrics"]',
            frequency=overrides.get("frequency", "daily"),
            timezone=overrides.get("timezone", "UTC"),
            send_hour=overrides.get("send_hour", 9),
            send_minute=overrides.get("send_minute", 0),
            weekday=overrides.get("weekday", 0),
            day_of_month=overrides.get("day_of_month", 1),
            date_range_rule="previous_7_days",
            to_recipients='["stake@t.com"]',
            sender_user_id=overrides.get("sender_user_id", "sender-id"),
            last_run_at=overrides.get("last_run_at", None),
        )
        db.add(report)
        db.commit()
        db.refresh(report)
        return report

    def test_noop_when_disabled(self, db):
        from datetime import datetime, timezone
        from scheduled_jobs import _scheduled_report_job

        self._make_report(db, enabled=False, send_hour=9)

        with patch("database.SessionLocal", return_value=db), \
             patch("report_service.execute_report") as mock_execute, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 10, 0, tzinfo=timezone.utc)
            _scheduled_report_job()

        mock_execute.assert_not_called()

    def test_runs_due_report(self, db):
        from datetime import datetime, timezone
        from scheduled_jobs import _scheduled_report_job

        self._make_report(db, send_hour=9)
        now = datetime(2026, 7, 20, 10, 0, tzinfo=timezone.utc)

        with patch("database.SessionLocal", return_value=db), \
             patch("report_service.execute_report") as mock_execute, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = now
            _scheduled_report_job()

        mock_execute.assert_called_once()

    def test_skips_not_yet_due_report(self, db):
        from datetime import datetime, timezone
        from scheduled_jobs import _scheduled_report_job

        self._make_report(db, send_hour=9)
        now = datetime(2026, 7, 20, 8, 0, tzinfo=timezone.utc)

        with patch("database.SessionLocal", return_value=db), \
             patch("report_service.execute_report") as mock_execute, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = now
            _scheduled_report_job()

        mock_execute.assert_not_called()

    def test_multiple_reports_independent(self, db):
        """One due, one not — only the due one executes; both are checked."""
        from datetime import datetime, timezone
        from scheduled_jobs import _scheduled_report_job

        due = self._make_report(db, name="Due Report", send_hour=9)
        not_due = self._make_report(db, name="Not Due Report", send_hour=15)
        now = datetime(2026, 7, 20, 10, 0, tzinfo=timezone.utc)

        with patch("database.SessionLocal", return_value=db), \
             patch("report_service.execute_report") as mock_execute, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = now
            _scheduled_report_job()

        assert mock_execute.call_count == 1
        called_report = mock_execute.call_args[0][1]
        assert called_report.id == due.id

    def test_one_report_failing_does_not_block_others(self, db):
        from datetime import datetime, timezone
        from scheduled_jobs import _scheduled_report_job

        r1 = self._make_report(db, name="Report 1", send_hour=9)
        r2 = self._make_report(db, name="Report 2", send_hour=9)
        now = datetime(2026, 7, 20, 10, 0, tzinfo=timezone.utc)

        with patch("database.SessionLocal", return_value=db), \
             patch("report_service.execute_report", side_effect=[Exception("boom"), MagicMock(status="sent")]) as mock_execute, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = now
            _scheduled_report_job()

        assert mock_execute.call_count == 2



# ─────────────────────────────────────────────────────────────────────────────
# _scheduled_email_campaign_job — v12: scheduled_once + daily/weekly/monthly
# recurring Email Campaigns, reusing report_service.is_due() for the latter.
# ─────────────────────────────────────────────────────────────────────────────

class TestScheduledEmailCampaignJob:

    def _make_campaign(self, db, **overrides):
        import models
        campaign = models.EmailCampaign(
            name=overrides.get("name", "Test Campaign"),
            subject="Hi {{first_name}}", body="Hello",
            created_by=overrides.get("created_by", "sender-id"),
            status=overrides.get("status", "scheduled"),
            total_recipients=1,
            frequency=overrides.get("frequency", "scheduled_once"),
            scheduled_send_at=overrides.get("scheduled_send_at"),
            weekday=overrides.get("weekday"),
            day_of_month=overrides.get("day_of_month"),
            timezone=overrides.get("timezone", "UTC"),
            send_hour=overrides.get("send_hour"),
            send_minute=overrides.get("send_minute", 0),
            last_run_at=overrides.get("last_run_at"),
        )
        db.add(campaign)
        db.commit()
        db.refresh(campaign)
        return campaign

    def _make_recipient(self, db, campaign, **overrides):
        import models
        from conftest import create_test_lead
        lead = overrides.get("lead") or create_test_lead(db, email="lead@test.com")
        recipient = models.EmailCampaignRecipient(
            campaign_id=campaign.id, lead_id=lead.id,
            status=overrides.get("status", "pending"),
            error=overrides.get("error"), sent_at=overrides.get("sent_at"),
        )
        db.add(recipient)
        db.commit()
        return recipient

    def test_backend_url_missing_skips_entirely(self, db):
        from unittest.mock import patch as _patch
        from scheduled_jobs import _scheduled_email_campaign_job
        from datetime import datetime, timedelta, timezone
        campaign = self._make_campaign(db, scheduled_send_at=datetime.now(timezone.utc) - timedelta(hours=1))

        with _patch("database.SessionLocal", return_value=db), \
             _patch.dict("os.environ", {"BACKEND_URL": "", "RENDER_EXTERNAL_URL": ""}), \
             _patch("routes.email_campaign_routes._dispatch_campaign") as mock_dispatch:
            _scheduled_email_campaign_job()

        mock_dispatch.assert_not_called()
        import models
        refreshed = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == campaign.id).first()
        assert refreshed.status == "scheduled"  # untouched

    def test_scheduled_once_due_dispatches_and_leaves_dispatch_to_finalize_status(self, db):
        from unittest.mock import patch as _patch
        from scheduled_jobs import _scheduled_email_campaign_job
        from datetime import datetime, timedelta, timezone
        campaign = self._make_campaign(db, scheduled_send_at=datetime.now(timezone.utc) - timedelta(hours=1))
        self._make_recipient(db, campaign)

        with _patch("database.SessionLocal", return_value=db), \
             _patch.dict("os.environ", {"BACKEND_URL": "https://test.example.com", "RENDER_EXTERNAL_URL": ""}), \
             _patch("routes.email_campaign_routes._dispatch_campaign") as mock_dispatch:
            _scheduled_email_campaign_job()

        mock_dispatch.assert_called_once_with(campaign_id=campaign.id, backend_base_url="https://test.example.com")
        import models
        refreshed = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == campaign.id).first()
        assert refreshed.last_run_at is not None

    def test_scheduled_once_not_yet_due_skipped(self, db):
        from unittest.mock import patch as _patch
        from scheduled_jobs import _scheduled_email_campaign_job
        from datetime import datetime, timedelta, timezone
        self._make_campaign(db, scheduled_send_at=datetime.now(timezone.utc) + timedelta(hours=1))

        with _patch("database.SessionLocal", return_value=db), \
             _patch.dict("os.environ", {"BACKEND_URL": "https://test.example.com", "RENDER_EXTERNAL_URL": ""}), \
             _patch("routes.email_campaign_routes._dispatch_campaign") as mock_dispatch:
            _scheduled_email_campaign_job()

        mock_dispatch.assert_not_called()

    def test_recurring_due_resets_stale_recipients_before_dispatch(self, db):
        """A daily campaign re-firing must not replay last run's stale
        'sent'/'failed' status — _reset_recipients_for_rerun clears every
        recipient back to pending before _dispatch_campaign runs, so its own
        live DNC/email re-check decides each one fresh."""
        from unittest.mock import patch as _patch
        from datetime import datetime, timezone
        campaign = self._make_campaign(
            db, frequency="daily", send_hour=9, send_minute=0,
            last_run_at=None,
        )
        campaign.sent_count = 5
        db.commit()
        campaign_id = campaign.id
        recipient = self._make_recipient(db, campaign, status="sent", sent_at=datetime.now(timezone.utc))
        recipient_id = recipient.id

        from scheduled_jobs import _scheduled_email_campaign_job
        now = datetime(2026, 7, 20, 9, 30, tzinfo=timezone.utc)
        with _patch("database.SessionLocal", return_value=db), \
             _patch.dict("os.environ", {"BACKEND_URL": "https://test.example.com", "RENDER_EXTERNAL_URL": ""}), \
             _patch("scheduled_jobs.datetime") as mock_dt, \
             _patch("routes.email_campaign_routes._dispatch_campaign") as mock_dispatch:
            mock_dt.now.return_value = now
            _scheduled_email_campaign_job()

        mock_dispatch.assert_called_once()
        import models
        refreshed_campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == campaign_id).first()
        refreshed_recipient = db.query(models.EmailCampaignRecipient).filter(models.EmailCampaignRecipient.id == recipient_id).first()
        assert refreshed_recipient.status == "pending"
        assert refreshed_campaign.sent_count == 0
        assert refreshed_campaign.status == "scheduled"  # stays eligible for tomorrow — never marked "completed"

    def test_recurring_not_due_skipped_and_not_reset(self, db):
        from unittest.mock import patch as _patch
        from datetime import datetime, timezone
        campaign = self._make_campaign(db, frequency="daily", send_hour=20, send_minute=0)
        recipient = self._make_recipient(db, campaign, status="sent")
        recipient_id = recipient.id

        from scheduled_jobs import _scheduled_email_campaign_job
        now = datetime(2026, 7, 20, 9, 30, tzinfo=timezone.utc)
        with _patch("database.SessionLocal", return_value=db), \
             _patch.dict("os.environ", {"BACKEND_URL": "https://test.example.com", "RENDER_EXTERNAL_URL": ""}), \
             _patch("scheduled_jobs.datetime") as mock_dt, \
             _patch("routes.email_campaign_routes._dispatch_campaign") as mock_dispatch:
            mock_dt.now.return_value = now
            _scheduled_email_campaign_job()

        mock_dispatch.assert_not_called()
        import models
        refreshed = db.query(models.EmailCampaignRecipient).filter(models.EmailCampaignRecipient.id == recipient_id).first()
        assert refreshed.status == "sent"  # untouched — not due, so no reset either

    def test_one_campaign_failing_does_not_block_others(self, db):
        from unittest.mock import patch as _patch
        from datetime import datetime, timedelta, timezone
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        c1 = self._make_campaign(db, scheduled_send_at=past)
        c2 = self._make_campaign(db, scheduled_send_at=past)

        from scheduled_jobs import _scheduled_email_campaign_job

        def _side_effect(campaign_id, backend_base_url):
            if campaign_id == c1.id:
                raise RuntimeError("boom")

        with _patch("database.SessionLocal", return_value=db), \
             _patch.dict("os.environ", {"BACKEND_URL": "https://test.example.com", "RENDER_EXTERNAL_URL": ""}), \
             _patch("routes.email_campaign_routes._dispatch_campaign", side_effect=_side_effect) as mock_dispatch:
            _scheduled_email_campaign_job()

        assert mock_dispatch.call_count == 2
