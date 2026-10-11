"""v13.10.0 — lead ownership history (lead_ownership_periods).

The trigger tests need real Postgres (SQLite has no triggers):
    TEST_DATABASE_URL=postgresql:///crm_test .venv/bin/pytest -n0 backend/tests/test_ownership_history.py
They are skipped on the default SQLite run; the reconcile/context tests run on both.
"""
import os

import pytest
from sqlalchemy import text

import models
import ownership_history as oh
from conftest import create_test_lead, create_test_user

PG = bool(os.environ.get("TEST_DATABASE_URL"))
needs_pg = pytest.mark.skipif(not PG, reason="trigger tests need TEST_DATABASE_URL=postgresql:///crm_test")


@pytest.fixture()
def pg(engine, db):
    """Postgres with the trigger installed (create_all makes the tables; migrations install the trigger)."""
    with engine.begin() as conn:
        oh.install_trigger(conn)
    return db


def _periods(db, lead_id):
    db.expire_all()
    rows = db.execute(text(
        "SELECT user_id, valid_to IS NULL AS open, reason, assigned_by, ended_reason FROM lead_ownership_periods "
        "WHERE lead_id = :l ORDER BY valid_from, valid_to NULLS LAST"), {"l": lead_id}).fetchall()
    return [dict(r._mapping) for r in rows]


# ── trigger (Postgres) ──────────────────────────────────────────────────────────────────────────────────────────
@needs_pg
def test_assign_opens_a_period_with_reason_and_actor(pg):
    a = create_test_user(pg, email="a@t.com", id="user-a")
    lead = create_test_lead(pg, email="l1@t.com")
    models.assign_lead(a, lead, reason=oh.R_BULK, actor_id="admin-1")
    pg.commit()
    [p] = _periods(pg, lead.id)
    assert p["user_id"] == "user-a" and p["open"] and p["reason"] == oh.R_BULK and p["assigned_by"] == "admin-1"


@needs_pg
def test_reassign_closes_the_old_period_and_opens_the_new_one(pg):
    a = create_test_user(pg, email="a@t.com", id="user-a")
    b = create_test_user(pg, email="b@t.com", id="user-b")
    lead = create_test_lead(pg, email="l2@t.com")
    models.assign_lead(a, lead, reason=oh.R_UPLOAD)
    pg.commit()
    models.assign_lead(b, lead, reason=oh.R_REASSIGN, actor_id="admin-2")
    pg.commit()
    rows = _periods(pg, lead.id)
    by_user = {r["user_id"]: r for r in rows}
    assert not by_user["user-a"]["open"] and by_user["user-a"]["ended_reason"] == oh.R_REASSIGN
    assert by_user["user-b"]["open"] and by_user["user-b"]["reason"] == oh.R_REASSIGN
    assert sum(r["open"] for r in rows) == 1                      # exactly one current owner


@needs_pg
def test_raw_sql_without_context_is_stamped_script_unknown(pg):
    a = create_test_user(pg, email="a@t.com", id="user-a")
    lead = create_test_lead(pg, email="l3@t.com")
    pg.execute(text("INSERT INTO lead_assignments (user_id, lead_id) VALUES (:u, :l)"), {"u": a.id, "l": lead.id})
    pg.commit()
    [p] = _periods(pg, lead.id)
    assert p["reason"] == oh.R_UNKNOWN and p["assigned_by"] is None and p["open"]
    pg.execute(text("DELETE FROM lead_assignments WHERE lead_id = :l"), {"l": lead.id})
    pg.commit()
    [p] = _periods(pg, lead.id)
    assert not p["open"] and p["ended_reason"] == oh.R_UNKNOWN


@needs_pg
def test_wiping_a_users_portfolio_is_recorded_not_silent(pg):
    a = create_test_user(pg, email="a@t.com", id="user-a")
    leads = [create_test_lead(pg, email=f"w{i}@t.com") for i in range(3)]
    for l in leads:
        models.assign_lead(a, l, reason=oh.R_BULK)
    pg.commit()
    oh.set_assignment_context(pg, oh.R_USER_REMOVED, "admin-9")
    a.assigned_leads = []                                          # what admin_user_routes does on removal/deletion
    pg.commit()
    for l in leads:
        [p] = _periods(pg, l.id)
        assert not p["open"] and p["ended_reason"] == oh.R_USER_REMOVED


@needs_pg
def test_a_history_failure_never_blocks_the_assignment(pg):
    a = create_test_user(pg, email="a@t.com", id="user-a")
    lead = create_test_lead(pg, email="l4@t.com")
    pg.execute(text("ALTER TABLE lead_ownership_periods RENAME TO lop_gone"))
    pg.commit()
    try:
        pg.execute(text("INSERT INTO lead_assignments (user_id, lead_id) VALUES (:u, :l)"), {"u": a.id, "l": lead.id})
        pg.commit()
        assert pg.execute(text("SELECT count(*) FROM lead_assignments WHERE lead_id = :l"), {"l": lead.id}).scalar() == 1
    finally:
        pg.execute(text("ALTER TABLE lop_gone RENAME TO lead_ownership_periods"))
        pg.commit()


@needs_pg
def test_context_is_per_transaction_and_set_once_for_a_bulk_loop(pg):
    a = create_test_user(pg, email="a@t.com", id="user-a")
    leads = [create_test_lead(pg, email=f"b{i}@t.com") for i in range(5)]
    calls = []
    orig = pg.execute
    pg.execute = lambda stmt, *a_, **k: (calls.append(str(stmt)) or orig(stmt, *a_, **k))
    try:
        for l in leads:
            models.assign_lead(a, l, reason=oh.R_BULK, actor_id="admin-1")
        pg.flush()
    finally:
        pg.execute = orig
    assert sum("set_config" in c for c in calls) == 1             # not once per lead
    pg.commit()
    # a new transaction starts without the previous context
    lead = create_test_lead(pg, email="after@t.com")
    pg.execute(text("INSERT INTO lead_assignments (user_id, lead_id) VALUES (:u, :l)"), {"u": a.id, "l": lead.id})
    pg.commit()
    assert _periods(pg, lead.id)[0]["reason"] == oh.R_UNKNOWN


@needs_pg
def test_backfill_is_idempotent_and_reconcile_detects_a_missing_trigger(pg):
    a = create_test_user(pg, email="a@t.com", id="user-a")
    lead = create_test_lead(pg, email="l5@t.com")
    pg.execute(text("DROP TRIGGER trg_lead_assignments_track ON lead_assignments"))
    pg.execute(text("INSERT INTO lead_assignments (user_id, lead_id) VALUES (:u, :l)"), {"u": a.id, "l": lead.id})
    pg.commit()
    assert _periods(pg, lead.id) == []                            # trigger gone → hole
    result = oh.reconcile(pg, heal=False)
    assert result["missing_open_period"] == 1 and result["healed"] == {"opened": 0, "closed": 0}
    result = oh.reconcile(pg)
    assert result["healed"]["opened"] == 1
    [p] = _periods(pg, lead.id)
    assert p["reason"] == oh.R_RECONCILED
    assert oh.reconcile(pg)["missing_open_period"] == 0           # healed
    assert oh.backfill_current_owners(pg.connection()) == 0       # idempotent


@needs_pg
def test_context_survives_a_rolled_back_savepoint(pg):
    """Uploads run each row in a SAVEPOINT; a failed row rolls back its context too — the next row must still be stamped."""
    a = create_test_user(pg, email="a@t.com", id="user-a")
    l1 = create_test_lead(pg, email="sp1@t.com")
    l2 = create_test_lead(pg, email="sp2@t.com")
    pg.commit()
    sp = pg.begin_nested()
    oh.set_assignment_context(pg, oh.R_UPLOAD, "admin-1")
    pg.execute(models.lead_assignments.insert().values(user_id=a.id, lead_id=l1.id))
    sp.rollback()                                             # row failed → context rolled back with it
    sp = pg.begin_nested()
    oh.set_assignment_context(pg, oh.R_UPLOAD, "admin-1")     # must NOT be skipped by the per-transaction cache
    pg.execute(models.lead_assignments.insert().values(user_id=a.id, lead_id=l2.id))
    sp.commit()
    pg.commit()
    assert _periods(pg, l1.id) == []                           # rolled back with the row
    [p] = _periods(pg, l2.id)
    assert p["reason"] == oh.R_UPLOAD and p["assigned_by"] == "admin-1"


# ── both dialects ───────────────────────────────────────────────────────────────────────────────────────────────
def test_reconcile_opens_missing_and_closes_stale_periods(db):
    a = create_test_user(db, email="a@t.com", id="user-a")
    lead = create_test_lead(db, email="r1@t.com")
    ghost = create_test_lead(db, email="r2@t.com")
    a.assigned_leads.append(lead)                                  # assignment, but no period (SQLite has no trigger)
    db.add(models.LeadOwnershipPeriod(lead_id=ghost.id, user_id="user-a"))   # period, but no assignment
    db.commit()
    dry = oh.reconcile(db, heal=False)
    assert dry["missing_open_period"] >= 1 and dry["stale_open_period"] == 1
    healed = oh.reconcile(db)
    assert healed["healed"]["opened"] >= 1 and healed["healed"]["closed"] == 1
    clean = oh.reconcile(db)
    assert clean["missing_open_period"] == 0 and clean["stale_open_period"] == 0


def test_assign_lead_with_a_reason_is_harmless_without_a_trigger(db):
    a = create_test_user(db, email="a@t.com", id="user-a")
    lead = create_test_lead(db, email="r3@t.com")
    assert models.assign_lead(a, lead, reason=oh.R_BULK, actor_id="admin-1") is True
    db.commit()
    assert lead in a.assigned_leads
