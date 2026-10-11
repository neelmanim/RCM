"""Tests the v12_6_5_correct_sf_log_direction_backfill data migration
(migrations.py), which corrects the direction column's own ADD COLUMN
DEFAULT backfill: adding `direction VARCHAR DEFAULT 'outbound'` set every
pre-existing row to 'outbound', including the historical Account/Opportunity
pull logs that caused the original Sync Log data-pollution scare this
column exists to disambiguate. Confirmed live in production (2026-09-16):
an Opportunity log from before this fix showed "Pushed to SF" despite being
a pull-created row.

Runs the REAL migration path — same pattern as
test_messaging_access_gate_correction.py.
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


def _make_log(db, **kwargs):
    log = models.SalesforceIntegrationLog(status="success", **kwargs)
    db.add(log)
    db.commit()
    return log.id


def test_corrects_account_and_opportunity_pulls_mislabeled_outbound():
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    account_id = _make_log(
        db, operation_type="create", sf_object="Account",
        source_system="sync_button", fields_updated='["Name", "Industry"]',
    )
    opp_id = _make_log(
        db, operation_type="upsert", sf_object="Opportunity",
        source_system="sync_button",
        fields_updated='["Name", "Amount", "CloseDate", "StageName", "IsClosed", "IsWon"]',
    )
    db.close()

    run_schema_migrations(engine)

    db = Session()
    try:
        assert db.get(models.SalesforceIntegrationLog, account_id).direction == "inbound"
        assert db.get(models.SalesforceIntegrationLog, opp_id).direction == "inbound"
    finally:
        db.close()


def test_lead_pull_corrected_but_lead_push_during_sync_left_outbound():
    """Lead is the genuinely ambiguous object — 'sync_button' covers both a
    pull and a push-during-manual-sync path. Distinguish by fields_updated."""
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    pull_id = _make_log(
        db, operation_type="upsert", sf_object="Lead", source_system="sync_button",
        fields_updated='["FirstName", "LastName", "Email", "Phone", "Company", "Status"]',
    )
    push_linked_id = _make_log(
        db, operation_type="upsert", sf_object="Lead", source_system="sync_button",
        fields_updated='["sf_lead_id"]',
    )
    push_created_id = _make_log(
        db, operation_type="create", sf_object="Lead", source_system="sync_button",
        fields_updated=None,
    )
    db.close()

    run_schema_migrations(engine)

    db = Session()
    try:
        assert db.get(models.SalesforceIntegrationLog, pull_id).direction == "inbound"
        assert db.get(models.SalesforceIntegrationLog, push_linked_id).direction == "outbound"
        assert db.get(models.SalesforceIntegrationLog, push_created_id).direction == "outbound"
    finally:
        db.close()


def test_real_outbound_pushes_are_left_alone():
    engine = _make_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    opp_update_id = _make_log(
        db, operation_type="update", sf_object="Opportunity", source_system="ae_pipeline",
        fields_updated='["StageName", "Amount"]',
    )
    lead_create_id = _make_log(
        db, operation_type="create", sf_object="Lead", source_system="api",
        fields_updated='["FirstName", "LastName", "Email"]',
    )
    db.close()

    run_schema_migrations(engine)

    db = Session()
    try:
        assert db.get(models.SalesforceIntegrationLog, opp_update_id).direction == "outbound"
        assert db.get(models.SalesforceIntegrationLog, lead_create_id).direction == "outbound"
    finally:
        db.close()
