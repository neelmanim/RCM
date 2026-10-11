"""Lead ownership history — who owned which lead, from when to when.

`lead_assignments` only holds the CURRENT owner (reassigning deletes the old row), so nothing could answer "who owned
this lead when that call was made?". `lead_ownership_periods` keeps one row per stretch of ownership.

It is written by a POSTGRES TRIGGER on `lead_assignments`, not by app code, on purpose: ≥8 code paths and every
manual SQL reshuffle write that table directly (see docs/plans/PLAN_reporting_funnel_and_lead_states.md §15). A trigger
cannot be bypassed; app hooks can. The app only ADDS CONTEXT (reason + who) through `set_assignment_context`; when a
write comes without context (a script, manual SQL) the period is stamped reason='script/unknown' so it is visible.

A nightly reconciliation (`reconcile`) compares assignments with open periods and heals any difference, so a missed path
becomes a counted, visible event instead of a silent hole.

SQLite (local tests/dev) has no trigger: periods are not written there. Trigger behaviour is tested on the local
Postgres:  TEST_DATABASE_URL=postgresql:///crm_test pytest -n0 backend/tests/test_ownership_history.py
"""
import logging

from sqlalchemy import text

logger = logging.getLogger(__name__)

# Reasons the app stamps (anything else arrives as 'script/unknown')
R_BULK = "bulk-assign"
R_AUTO = "auto-assign"
R_UNASSIGN = "unassign"
R_BULK_UNASSIGN = "bulk-unassign"
R_UPLOAD = "upload"
R_REASSIGN = "reassign-approved"
R_POD = "pod-assign"
R_ADMIN = "admin-assign"
R_LEAD_CREATE = "lead-create"
R_DUPLICATE = "duplicate-claim"
R_PHONE_ADDED = "phone-added"
R_USER_REMOVED = "user-access-removed"
R_USER_DELETED = "user-deleted"
R_KLENTY = "klenty-import"
R_DIALER_INBOUND = "dialer-inbound"
R_UNKNOWN = "script/unknown"
R_RECONCILED = "reconciled"
R_BACKFILL = "backfill-current-owner"

_NEW_ID = "md5(random()::text || clock_timestamp()::text)"

_FUNCTION_SQL = f"""
CREATE OR REPLACE FUNCTION lead_assignments_track() RETURNS trigger AS $$
DECLARE
  v_reason text := COALESCE(NULLIF(current_setting('app.assign_reason', true), ''), '{R_UNKNOWN}');
  v_actor  text := NULLIF(current_setting('app.actor_id', true), '');
BEGIN
  -- History must never block an ownership change: on any error warn and let the write through (reconcile heals).
  BEGIN
    IF TG_OP = 'INSERT' THEN
      UPDATE lead_ownership_periods SET valid_to = now(), ended_reason = 'superseded'
       WHERE lead_id = NEW.lead_id AND user_id = NEW.user_id AND valid_to IS NULL;
      INSERT INTO lead_ownership_periods (id, lead_id, user_id, valid_from, reason, assigned_by)
      VALUES ({_NEW_ID}, NEW.lead_id, NEW.user_id, COALESCE(NEW.assigned_at, now()), v_reason, v_actor);
    ELSIF TG_OP = 'DELETE' THEN
      UPDATE lead_ownership_periods
         SET valid_to = now(), ended_reason = v_reason, ended_by = v_actor
       WHERE lead_id = OLD.lead_id AND user_id = OLD.user_id AND valid_to IS NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
        UPDATE lead_ownership_periods
           SET valid_to = now(), ended_reason = v_reason, ended_by = v_actor
         WHERE lead_id = OLD.lead_id AND user_id = OLD.user_id AND valid_to IS NULL;
        INSERT INTO lead_ownership_periods (id, lead_id, user_id, valid_from, reason, assigned_by)
        VALUES ({_NEW_ID}, NEW.lead_id, NEW.user_id, COALESCE(NEW.assigned_at, now()), v_reason, v_actor);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_assignments_track failed (%): %', TG_OP, SQLERRM;
  END;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
"""

_BACKFILL_SQL = f"""
INSERT INTO lead_ownership_periods (id, lead_id, user_id, valid_from, reason)
SELECT md5(random()::text || clock_timestamp()::text || la.lead_id || la.user_id),
       la.lead_id, la.user_id, COALESCE(la.assigned_at, now()), :reason
  FROM lead_assignments la
 WHERE NOT EXISTS (SELECT 1 FROM lead_ownership_periods p
                    WHERE p.lead_id = la.lead_id AND p.user_id = la.user_id AND p.valid_to IS NULL)
"""

_CLOSE_STALE_SQL = """
UPDATE lead_ownership_periods
   SET valid_to = CURRENT_TIMESTAMP, ended_reason = :reason
 WHERE valid_to IS NULL
   AND NOT EXISTS (SELECT 1 FROM lead_assignments la
                    WHERE la.lead_id = lead_ownership_periods.lead_id AND la.user_id = lead_ownership_periods.user_id)
"""

_COUNT_MISSING_SQL = """
SELECT count(*) FROM lead_assignments la
 WHERE NOT EXISTS (SELECT 1 FROM lead_ownership_periods p
                    WHERE p.lead_id = la.lead_id AND p.user_id = la.user_id AND p.valid_to IS NULL)
"""

_COUNT_STALE_SQL = """
SELECT count(*) FROM lead_ownership_periods p
 WHERE p.valid_to IS NULL
   AND NOT EXISTS (SELECT 1 FROM lead_assignments la WHERE la.lead_id = p.lead_id AND la.user_id = p.user_id)
"""


def is_postgres(bind) -> bool:
    return bind.dialect.name == "postgresql"


def install_trigger(conn) -> None:
    """Create/replace the trigger function and (re)attach the trigger. Idempotent. Postgres only."""
    conn.execute(text(_FUNCTION_SQL))
    conn.execute(text("DROP TRIGGER IF EXISTS trg_lead_assignments_track ON lead_assignments"))
    conn.execute(text(
        "CREATE TRIGGER trg_lead_assignments_track AFTER INSERT OR UPDATE OR DELETE ON lead_assignments "
        "FOR EACH ROW EXECUTE PROCEDURE lead_assignments_track()"))


def backfill_current_owners(conn, reason: str = R_BACKFILL) -> int:
    """Open a period for every current assignment that has none. Idempotent. Valid on Postgres and SQLite."""
    if is_postgres(conn):
        return conn.execute(text(_BACKFILL_SQL), {"reason": reason}).rowcount or 0
    # SQLite: no md5()/random() — generate ids in Python
    import uuid
    rows = conn.execute(text(
        "SELECT la.lead_id, la.user_id, COALESCE(la.assigned_at, CURRENT_TIMESTAMP) FROM lead_assignments la "
        "WHERE NOT EXISTS (SELECT 1 FROM lead_ownership_periods p WHERE p.lead_id=la.lead_id AND p.user_id=la.user_id "
        "AND p.valid_to IS NULL)")).fetchall()
    for lead_id, user_id, at in rows:
        conn.execute(text(
            "INSERT INTO lead_ownership_periods (id, lead_id, user_id, valid_from, reason) "
            "VALUES (:id, :l, :u, :at, :r)"), {"id": str(uuid.uuid4()), "l": lead_id, "u": user_id, "at": at, "r": reason})
    return len(rows)


def set_assignment_context(db, reason: str, actor_id=None) -> None:
    """Tell the trigger WHY and BY WHOM the next ownership writes in this transaction happen.
    Transaction-local (set_config(..., true)); a no-op on SQLite; set once per transaction+reason+actor so a bulk
    loop over thousands of leads costs one statement. Never raises into the caller's flow."""
    try:
        if not is_postgres(db.get_bind()):
            return
        txn = db.get_transaction()
        key = (txn, reason, str(actor_id) if actor_id else "")
        last = db.info.get("_own_ctx")
        # Inside a SAVEPOINT the setting dies with a rollback while the cache would still say 'set' — always re-set there.
        if (not db.in_nested_transaction()) and txn is not None and last and last[0] is key[0] and last[1:] == key[1:]:
            return
        db.execute(text("SELECT set_config('app.assign_reason', :r, true), set_config('app.actor_id', :a, true)"),
                   {"r": reason or "", "a": key[2]})
        db.info["_own_ctx"] = (db.get_transaction(), key[1], key[2])
    except Exception as e:  # context is metadata; the ownership write itself must still go through
        logger.warning(f"[ownership] could not set assignment context ({reason}): {e}")


def reconcile(db, heal: bool = True) -> dict:
    """Compare current assignments with open periods. Returns counts; with heal=True also fixes the difference
    (reason='reconciled'). A non-zero 'missing'/'stale' means some path wrote ownership without the trigger firing
    (e.g. trigger dropped, or SQLite) — investigate, don't just heal."""
    conn = db.connection()
    missing = conn.execute(text(_COUNT_MISSING_SQL)).scalar() or 0
    stale = conn.execute(text(_COUNT_STALE_SQL)).scalar() or 0
    healed = {"opened": 0, "closed": 0}
    if heal and (missing or stale):
        healed["closed"] = conn.execute(text(_CLOSE_STALE_SQL), {"reason": R_RECONCILED}).rowcount or 0
        healed["opened"] = backfill_current_owners(conn, reason=R_RECONCILED)
        db.commit()
    return {"missing_open_period": missing, "stale_open_period": stale, "healed": healed}
