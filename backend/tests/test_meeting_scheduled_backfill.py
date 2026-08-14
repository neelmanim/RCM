"""Tests the meeting_scheduled_at backfill data migration (migrations.py),
which runs the REAL migration path (not Base.metadata.create_all) since only
that path exercises data_migrations. See risk mitigation discussion,
2026-07-14 pre-prod-promotion review.
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timezone
from unittest.mock import patch

from sqlalchemy import create_engine, text
from sqlalchemy.engine.base import Connection
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base
import models
from migrations import run_schema_migrations


def _make_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return engine


def test_backfills_meeting_scheduled_leads_missing_the_new_column():
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    changed_at = datetime(2026, 6, 1, 9, 30, tzinfo=timezone.utc)
    meeting_lead = models.Lead(last_name="Meeting Lead", status="Meeting Scheduled", status_changed_at=changed_at)
    other_lead = models.Lead(last_name="Other Lead", status="Calling", status_changed_at=changed_at)
    db.add_all([meeting_lead, other_lead])
    db.commit()
    meeting_id, other_id = meeting_lead.id, other_lead.id
    db.close()

    run_schema_migrations(engine)

    db = Session()
    try:
        refreshed = db.query(models.Lead).get(meeting_id)
        assert refreshed.meeting_scheduled_at.replace(tzinfo=timezone.utc) == changed_at

        refreshed_other = db.query(models.Lead).get(other_id)
        assert refreshed_other.meeting_scheduled_at is None
    finally:
        db.close()


def test_does_not_overwrite_an_already_populated_value():
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    real_meeting_time = datetime(2026, 8, 1, 15, 0, tzinfo=timezone.utc)
    lead = models.Lead(
        last_name="Already Set",
        status="Meeting Scheduled",
        status_changed_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        meeting_scheduled_at=real_meeting_time,
    )
    db.add(lead)
    db.commit()
    lead_id = lead.id
    db.close()

    run_schema_migrations(engine)

    db = Session()
    try:
        refreshed = db.query(models.Lead).get(lead_id)
        assert refreshed.meeting_scheduled_at.replace(tzinfo=timezone.utc) == real_meeting_time
    finally:
        db.close()


def test_concurrent_add_column_race_does_not_crash_the_app():
    """Simulates a second instance winning the race to add the column first
    (Render briefly runs old+new instances during a rolling deploy — see the
    2026-07-14 mitigation). run_schema_migrations must treat "column already
    exists" as a benign outcome, not crash the app on boot."""
    engine = _make_engine()
    orig_execute = Connection.execute

    def racy_execute(self, stmt, *args, **kwargs):
        sql = str(getattr(stmt, "text", stmt))
        if "ADD COLUMN meeting_scheduled_at" in sql:
            raise Exception('duplicate column name: meeting_scheduled_at')
        return orig_execute(self, stmt, *args, **kwargs)

    with patch.object(Connection, "execute", racy_execute):
        run_schema_migrations(engine)  # must not raise
