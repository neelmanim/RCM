"""
Tests for the persisted AM bulk-backfill progress tracker —
backend/routes/admin_sync_routes.py's _write_am_status / _read_am_status.

Why this file exists: the tracker used to be a module-level dict
(`_am_sync_status`), so a deploy mid-run took the worker AND the progress
with it, and the admin polling /sync-am-status saw a zeroed idle state with
no signal the run had been killed. These tests pin the three states that
distinction depends on: never-run, running-with-a-live-heartbeat, and
running-with-a-cold-heartbeat (= interrupted).

Run with: JWT_SECRET=test_secret .venv/bin/pytest backend/tests/test_am_sync_job_state.py -q
"""
from datetime import datetime, timedelta, timezone

import pytest

import models
from routes.admin_sync_routes import (
    AM_SYNC_JOB,
    _AM_HEARTBEAT_STALE_SECONDS,
    _EMPTY_AM_STATE,
    _read_am_status,
    _write_am_status,
)


def _set_heartbeat(db, *, seconds_ago):
    row = db.query(models.BackgroundJobState).filter(
        models.BackgroundJobState.job_name == AM_SYNC_JOB
    ).first()
    row.heartbeat_at = datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)
    db.commit()


class TestAmSyncJobState:
    def test_no_row_yet_reads_as_idle(self, db):
        status = _read_am_status(db)
        assert status["running"] is False
        assert status["synced"] == 0
        assert status["started_at"] is None

    def test_every_read_returns_the_same_key_set(self, db):
        """The never-run branch used to omit `interrupted`, so a poller saw a
        different shape depending on whether a run had ever happened and
        `status.interrupted` read as undefined instead of false. Found on
        staging, not by the assertions above — which is why this compares the
        whole key set rather than the keys one test happens to care about."""
        never_run = _read_am_status(db)

        _write_am_status(db, {**_EMPTY_AM_STATE, "total": 5, "synced": 1}, running=True,
                         started_at=datetime.now(timezone.utc))
        has_run = _read_am_status(db)

        assert set(never_run) == set(has_run)
        assert never_run["interrupted"] is False

    def test_write_then_read_round_trips_the_counters(self, db):
        started = datetime.now(timezone.utc)
        _write_am_status(
            db,
            {**_EMPTY_AM_STATE, "total": 120, "synced": 7, "failed": 1, "skipped": 2,
             "errors": ["Jane Doe (+15550001): no record_id"], "message": "Sync in progress..."},
            running=True,
            started_at=started,
        )

        status = _read_am_status(db)
        assert status["running"] is True
        assert status["interrupted"] is False
        assert (status["total"], status["synced"], status["failed"], status["skipped"]) == (120, 7, 1, 2)
        assert status["errors"] == ["Jane Doe (+15550001): no record_id"]
        assert status["started_at"] is not None

    def test_a_fresh_heartbeat_still_reads_as_running(self, db):
        _write_am_status(db, {**_EMPTY_AM_STATE, "total": 10, "synced": 3}, running=True,
                         started_at=datetime.now(timezone.utc))
        _set_heartbeat(db, seconds_ago=_AM_HEARTBEAT_STALE_SECONDS - 60)

        status = _read_am_status(db)
        assert status["running"] is True
        assert status["interrupted"] is False

    def test_a_cold_heartbeat_reads_as_interrupted_not_running(self, db):
        """The whole point: the process that owned the worker died mid-run, so
        a row still flagged running must not report a run that will never
        advance again."""
        _write_am_status(db, {**_EMPTY_AM_STATE, "total": 500, "synced": 120}, running=True,
                         started_at=datetime.now(timezone.utc))
        _set_heartbeat(db, seconds_ago=_AM_HEARTBEAT_STALE_SECONDS + 60)

        status = _read_am_status(db)
        assert status["running"] is False
        assert status["interrupted"] is True
        # Keeps the progress it did make, and says what happened.
        assert status["synced"] == 120
        assert "Interrupted after 120 synced" in status["message"]
        assert "re-run" in status["message"].lower()

    def test_a_finished_run_is_not_interrupted_however_old(self, db):
        _write_am_status(db, {**_EMPTY_AM_STATE, "total": 10, "synced": 10, "message": "Complete: 10 synced, 0 failed, 0 skipped"},
                         running=False, started_at=datetime.now(timezone.utc),
                         finished_at=datetime.now(timezone.utc))
        _set_heartbeat(db, seconds_ago=_AM_HEARTBEAT_STALE_SECONDS * 10)

        status = _read_am_status(db)
        assert status["running"] is False
        assert status["interrupted"] is False
        assert status["message"].startswith("Complete:")
        assert status["finished_at"] is not None

    def test_starting_a_new_run_clears_the_previous_finished_at(self, db):
        """A stale finished_at left over from the last run would make a live
        run look like it had already completed."""
        _write_am_status(db, {**_EMPTY_AM_STATE, "synced": 10}, running=False,
                         started_at=datetime.now(timezone.utc),
                         finished_at=datetime.now(timezone.utc))
        assert _read_am_status(db)["finished_at"] is not None

        _write_am_status(db, {**_EMPTY_AM_STATE, "total": 3, "message": "Sync in progress..."},
                         running=True, started_at=datetime.now(timezone.utc), finished_at=None)

        status = _read_am_status(db)
        assert status["running"] is True
        assert status["finished_at"] is None
        assert status["synced"] == 0  # counters reset, not carried over

    def test_only_one_row_per_job_however_many_writes(self, db):
        for i in range(4):
            _write_am_status(db, {**_EMPTY_AM_STATE, "synced": i}, running=True,
                             started_at=datetime.now(timezone.utc))

        rows = db.query(models.BackgroundJobState).filter(
            models.BackgroundJobState.job_name == AM_SYNC_JOB
        ).all()
        assert len(rows) == 1
        assert _read_am_status(db)["synced"] == 3

    def test_heartbeat_write_does_not_wipe_started_at(self, db):
        """The per-batch heartbeat passes no started_at — it must not blank
        out when the run actually began."""
        _write_am_status(db, {**_EMPTY_AM_STATE, "total": 50}, running=True,
                         started_at=datetime.now(timezone.utc))
        original_start = _read_am_status(db)["started_at"]

        _write_am_status(db, {**_EMPTY_AM_STATE, "total": 50, "synced": 25}, running=True)

        status = _read_am_status(db)
        assert status["started_at"] == original_start
        assert status["synced"] == 25
