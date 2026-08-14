"""
Tests the real migration SQL path (run_schema_migrations) for the V47 Klenty
backfill — not just the ORM/provider logic. RCA 2026-08-03: existing Klenty
dialer_calls rows synced before klenty_provider.py's startTime→endTime
fallback shipped are stuck with started_at=NULL (misattributed to
created_at/sync-time), and provider_disposition is a brand-new column that
starts NULL for every pre-existing Klenty row. Both need a one-time backfill
from the row's own already-stored raw_payload.
"""
import json
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
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


def test_backfills_started_at_and_disposition_from_raw_payload():
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    lead = models.Lead(last_name="Backfill Lead")
    db.add(lead)
    db.commit()
    db.refresh(lead)

    raw_payload = {
        "callSid": "CA-legacy-1",
        "disposition": "ANSWERED",
        "startTime": None,
        "endTime": "2026-07-29T21:07:27.650Z",
    }
    call = models.DialerCall(
        lead_id=lead.id,
        provider="klenty",
        provider_call_id="CA-legacy-1",
        status="CALL_ENDED",
        direction="outbound",
        started_at=None,
        raw_payload=json.dumps(raw_payload),
    )
    db.add(call)
    db.commit()
    db.refresh(call)
    call_id = call.id
    db.close()

    run_schema_migrations(engine)

    db2 = Session()
    fixed = db2.query(models.DialerCall).filter(models.DialerCall.id == call_id).first()
    assert fixed.started_at is not None
    assert fixed.started_at.year == 2026 and fixed.started_at.month == 7 and fixed.started_at.day == 29
    assert fixed.provider_disposition == "ANSWERED"


def test_backfills_disposition_only_when_started_at_already_set():
    """A row with a real started_at (not the NULL-fallback case) still needs
    provider_disposition backfilled — it's a brand-new column, NULL on every
    row synced before this fix, regardless of the started_at bug."""
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    lead = models.Lead(last_name="Backfill Lead 2")
    db.add(lead)
    db.commit()
    db.refresh(lead)

    from datetime import datetime, timezone
    raw_payload = {"callSid": "CA-legacy-2", "disposition": "NOT_ANSWERED"}
    call = models.DialerCall(
        lead_id=lead.id,
        provider="klenty",
        provider_call_id="CA-legacy-2",
        status="CALL_ENDED",
        direction="outbound",
        started_at=datetime(2026, 7, 30, 10, 0, 0, tzinfo=timezone.utc),
        raw_payload=json.dumps(raw_payload),
    )
    db.add(call)
    db.commit()
    db.refresh(call)
    call_id = call.id
    original_started_at = call.started_at
    db.close()

    run_schema_migrations(engine)

    db2 = Session()
    fixed = db2.query(models.DialerCall).filter(models.DialerCall.id == call_id).first()
    assert fixed.started_at == original_started_at  # untouched — was never NULL
    assert fixed.provider_disposition == "NOT_ANSWERED"


def test_non_klenty_rows_untouched():
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    lead = models.Lead(last_name="Aircall Lead")
    db.add(lead)
    db.commit()
    db.refresh(lead)

    call = models.DialerCall(
        lead_id=lead.id,
        provider="aircall",
        provider_call_id="AC-1",
        status="CALL_ENDED",
        direction="outbound",
        started_at=None,
        raw_payload=json.dumps({"disposition": "should-not-be-read"}),
    )
    db.add(call)
    db.commit()
    db.refresh(call)
    call_id = call.id
    db.close()

    run_schema_migrations(engine)

    db2 = Session()
    untouched = db2.query(models.DialerCall).filter(models.DialerCall.id == call_id).first()
    assert untouched.started_at is None
    assert untouched.provider_disposition is None
