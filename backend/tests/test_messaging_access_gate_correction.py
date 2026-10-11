"""Tests the v11_10_5_correct_messaging_access_gate data migration
(migrations.py), which corrects the v11_10_0_backfill_messaging_access
migration's wrong proxy. That earlier migration granted/withheld
sms_enabled/whatsapp_enabled based on dialer_enabled; confirmed against real
prod data (2026-09-02) that dialer_enabled reflects calling access on
whatever vendor is configured, not messaging, and produced exactly the two
real incidents this migration exists to fix: Aircall-only callers with no
Alternate Messenger identity wrongly granted messaging, and real Alternate Messenger agents
with dialer_enabled=false wrongly denied it.

Runs the REAL migration path (not Base.metadata.create_all) since only that
path exercises data_migrations — same pattern as
test_meeting_scheduled_backfill.py.
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
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


def test_grants_messaging_to_a_real_messenger_agent_with_dialer_disabled():
    """The under-grant bug: a real agent (has a Alternate Messenger user id) whose
    dialer_enabled happens to be false must end up sms/whatsapp enabled."""
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    agent = models.User(
        email="real.agent@test.com", name="Real Agent",
        messenger_user_id="359160", dialer_enabled=False,
        sms_enabled=False, whatsapp_enabled=False,
    )
    db.add(agent)
    db.commit()
    agent_id = agent.id
    db.close()

    run_schema_migrations(engine)

    db = Session()
    try:
        refreshed = db.query(models.User).get(agent_id)
        assert refreshed.sms_enabled is True
        assert refreshed.whatsapp_enabled is True
    finally:
        db.close()


def test_revokes_messaging_from_an_aircall_only_caller_with_no_messenger_identity():
    """The over-grant bug: a pure Aircall caller (dialer_enabled=true, no
    Alternate Messenger user id) must NOT end up sms/whatsapp enabled, even though the
    earlier buggy migration granted it based on dialer_enabled alone."""
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    caller = models.User(
        email="aircall.only@test.com", name="Aircall Only",
        messenger_user_id=None, dialer_enabled=True,
        # Simulates the state the buggy v11_10_0 backfill already produced.
        sms_enabled=True, whatsapp_enabled=True,
    )
    db.add(caller)
    db.commit()
    caller_id = caller.id
    db.close()

    run_schema_migrations(engine)

    db = Session()
    try:
        refreshed = db.query(models.User).get(caller_id)
        assert refreshed.sms_enabled is False
        assert refreshed.whatsapp_enabled is False
        # Calling access itself is untouched by this migration.
        assert refreshed.dialer_enabled is True
    finally:
        db.close()


def test_leaves_an_already_correct_user_unchanged():
    """A Alternate Messenger-calling agent who already has dialer_enabled=true and a
    real Alternate Messenger id (e.g. Damini kumari in the real prod incident) must
    stay granted — the correction shouldn't just flip everyone."""
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    agent = models.User(
        email="already.correct@test.com", name="Already Correct",
        messenger_user_id="359159", dialer_enabled=True,
        sms_enabled=True, whatsapp_enabled=True,
    )
    db.add(agent)
    db.commit()
    agent_id = agent.id
    db.close()

    run_schema_migrations(engine)

    db = Session()
    try:
        refreshed = db.query(models.User).get(agent_id)
        assert refreshed.sms_enabled is True
        assert refreshed.whatsapp_enabled is True
    finally:
        db.close()
