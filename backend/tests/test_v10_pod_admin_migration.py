"""
Tests the ACTUAL migration SQL path (run_schema_migrations), not just the ORM models.

Regular tests build their schema via Base.metadata.create_all(), which never
exercises migrations.py's data_migrations at all. This file specifically simulates
the pre-v10 legacy schema (pods.admin_id + a phantom Pod Admin lead_assignments row)
and runs the real migration to verify the backfill + cleanup behave correctly
end-to-end — see RCA 2026-07-11 (ponytail review of the Pod Admin redesign).
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base
import models
from migrations import run_schema_migrations


def _make_legacy_engine():
    """Fresh in-memory DB with current models PLUS the legacy pods.admin_id column,
    simulating a real prod database that hasn't run the v10 migration yet."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE pods ADD COLUMN admin_id VARCHAR"))
    return engine


def test_v10_migration_backfills_and_cleans_up_without_dropping_column():
    engine = _make_legacy_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    pod = models.Pod(name="Legacy Pod")
    db.add(pod)
    db.commit()
    db.refresh(pod)

    admin_user = models.User(email="legacy-admin@t.com", name="Legacy Admin", role="Pod Admin", pod_id=pod.id)
    db.add(admin_user)
    db.commit()
    db.refresh(admin_user)

    # Simulate the legacy state: pod.admin_id set directly via raw SQL (column no
    # longer exists on the ORM model, only on this deliberately-recreated legacy schema)
    db.execute(text("UPDATE pods SET admin_id = :uid WHERE id = :pid"), {"uid": admin_user.id, "pid": pod.id})
    db.commit()

    # Simulate the legacy phantom cascade-assignment row for this Pod Admin
    lead = models.Lead(last_name="Test Lead", pod_id=pod.id)
    db.add(lead)
    db.commit()
    db.refresh(lead)
    db.execute(text(
        "INSERT INTO lead_assignments (user_id, lead_id) VALUES (:uid, :lid)"
    ), {"uid": admin_user.id, "lid": lead.id})
    db.commit()
    pod_id, user_id = pod.id, admin_user.id  # capture before closing — session is about to expire these
    db.close()

    # Run the REAL migration path (not create_all)
    run_schema_migrations(engine)

    db = Session()
    try:
        # Step 1 — backfilled into pod_admins
        pa = db.query(models.PodAdmin).filter(
            models.PodAdmin.pod_id == pod_id,
            models.PodAdmin.user_id == user_id,
        ).first()
        assert pa is not None, "Pod Admin was not backfilled into pod_admins"

        # Step 2 — phantom lead_assignments row removed
        remaining = db.execute(text(
            "SELECT COUNT(*) FROM lead_assignments WHERE user_id = :uid"
        ), {"uid": user_id}).fetchone()[0]
        assert remaining == 0, "Pod Admin's phantom lead_assignments row was not cleaned up"

        # Step 3 — deliberately deferred: admin_id column must still exist after this migration
        col_names = [row[1] for row in db.execute(text("PRAGMA table_info(pods)")).fetchall()]
        assert "admin_id" in col_names, "admin_id was dropped — Step 3 must ship as a separate deploy, not here"
    finally:
        db.close()


def test_v10_migration_is_idempotent_on_rerun():
    """Re-running the migration (e.g. on redeploy) must not duplicate pod_admins rows
    or error on the already-cleaned lead_assignments table."""
    engine = _make_legacy_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    pod = models.Pod(name="Idempotent Pod")
    db.add(pod)
    db.commit()
    db.refresh(pod)

    admin_user = models.User(email="idempotent-admin@t.com", name="Idempotent Admin", role="Pod Admin", pod_id=pod.id)
    db.add(admin_user)
    db.commit()
    db.refresh(admin_user)

    db.execute(text("UPDATE pods SET admin_id = :uid WHERE id = :pid"), {"uid": admin_user.id, "pid": pod.id})
    db.commit()
    pod_id, user_id = pod.id, admin_user.id
    db.close()

    run_schema_migrations(engine)
    run_schema_migrations(engine)  # second run must be a no-op, not an error or a duplicate

    db = Session()
    try:
        count = db.query(models.PodAdmin).filter(
            models.PodAdmin.pod_id == pod_id,
            models.PodAdmin.user_id == user_id,
        ).count()
        assert count == 1, f"Expected exactly 1 pod_admins row after 2 runs, got {count}"
    finally:
        db.close()


def test_v10_delete_is_skipped_if_backfill_did_not_actually_cover_every_pod():
    """The DELETE (Step 2) must not run if a pod's admin_id was never backfilled
    into pod_admins — e.g. because Step 1 failed or was skipped for some reason.
    Simulated here by marking Step 1 as already-applied without actually running it,
    matching what a partial/failed backfill would look like on next boot."""
    engine = _make_legacy_engine()
    Session = sessionmaker(bind=engine)
    db = Session()

    pod = models.Pod(name="Ungated Pod")
    db.add(pod)
    db.commit()
    db.refresh(pod)

    admin_user = models.User(email="ungated-admin@t.com", name="Ungated Admin", role="Pod Admin", pod_id=pod.id)
    db.add(admin_user)
    db.commit()
    db.refresh(admin_user)

    db.execute(text("UPDATE pods SET admin_id = :uid WHERE id = :pid"), {"uid": admin_user.id, "pid": pod.id})
    db.commit()

    lead = models.Lead(last_name="Test Lead", pod_id=pod.id)
    db.add(lead)
    db.commit()
    db.refresh(lead)
    db.execute(text(
        "INSERT INTO lead_assignments (user_id, lead_id) VALUES (:uid, :lid)"
    ), {"uid": admin_user.id, "lid": lead.id})
    db.commit()

    # Simulate Step 1 having "run" (tracked as applied) without actually backfilling —
    # e.g. a transient failure that still got past the try/except non-fatal path.
    # Raw SQL, matching _ensure_migration_tracker/_mark_migration_applied's own
    # schema, to avoid importing them by name (see backend/migrations.py vs the
    # sibling backend/migrations/ package — a pre-existing, unrelated naming
    # collision that shadows private helper imports depending on collection order).
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS _applied_migrations (
                name VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text(
            "INSERT INTO _applied_migrations (name, applied_at) VALUES (:name, CURRENT_TIMESTAMP)"
        ), {"name": "v10_backfill_pod_admins_from_admin_id"})

    pod_id, user_id = pod.id, admin_user.id
    db.close()

    run_schema_migrations(engine)

    db = Session()
    try:
        # The gate must have skipped the DELETE — phantom row still present
        remaining = db.execute(text(
            "SELECT COUNT(*) FROM lead_assignments WHERE user_id = :uid"
        ), {"uid": user_id}).fetchone()[0]
        assert remaining == 1, "DELETE ran despite backfill never covering this pod — the gate did not hold"

        # And the delete migration itself must NOT be marked applied, so it retries later
        applied = db.execute(text(
            "SELECT 1 FROM _applied_migrations WHERE name = 'v10_clean_lead_assignments_pod_admins'"
        )).fetchone()
        assert applied is None, "Delete migration was marked applied despite being skipped"
    finally:
        db.close()


if __name__ == "__main__":
    test_v10_migration_backfills_and_cleans_up_without_dropping_column()
    test_v10_migration_is_idempotent_on_rerun()
    test_v10_delete_is_skipped_if_backfill_did_not_actually_cover_every_pod()
    print("OK — v10 Pod Admin migration self-check passed")
