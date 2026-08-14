"""
Tests for routes/task_routes.py — Tasks CRUD + Notification endpoints.

Covers:
  - Basic CRUD (add, get, toggle, delete)
  - Notification endpoints: get_pending_tasks, snooze_task, dismiss_task
  - Edge cases: snoozed tasks hidden, dismissed tasks hidden, timezone handling,
    invalid snooze minutes clamped to default, ownership enforcement
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone, timedelta

import models
from conftest import (
    create_test_lead,
    create_test_task,
    create_test_user,
    _make_user_payload,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _sdr_client(db, app_builder, user_payload):
    """Return a TestClient wired to `db` and authenticated as `user_payload`."""
    from fastapi.testclient import TestClient
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin

    app = app_builder()

    def _override_db():
        yield db

    def _deny():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Forbidden")

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: user_payload
    app.dependency_overrides[require_admin] = _deny
    app.dependency_overrides[require_super_admin] = _deny

    return TestClient(app)


def _task_with_due_time(db, lead_id, user_id, minutes_from_now, dismissed="false", snoozed_until=None, done="false"):
    """Create a task whose due_time is `minutes_from_now` minutes from now (negative = past)."""
    due_time = datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)
    task = models.Task(
        lead_id=lead_id,
        user_id=user_id,
        title=f"Task due in {minutes_from_now}m",
        due_time=due_time,
        dismissed=dismissed,
        snoozed_until=snoozed_until,
        done=done,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


# ════════════════════════════════════════════════════════════════════════════════
# CRUD — Add / Get / Toggle / Delete
# ════════════════════════════════════════════════════════════════════════════════

class TestAddTask:

    def test_add_task_to_lead(self, client, db):
        lead = create_test_lead(db, email="task@t.com")
        resp = client.post(f"/api/leads/{lead.id}/tasks", json={
            "title": "Follow up call",
            "due_date": "2024-12-31"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Follow up call"
        assert data["done"] == "false"

    def test_add_task_stores_due_time_iso(self, client, db):
        lead = create_test_lead(db, email="tasktime@t.com")
        due_iso = "2030-06-15T09:00:00Z"
        resp = client.post(f"/api/leads/{lead.id}/tasks", json={
            "title": "Timed task",
            "due_time": due_iso,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["due_time"] is not None

    def test_add_task_lead_not_found(self, client):
        resp = client.post("/api/leads/fake-lead/tasks", json={"title": "Nope"})
        assert resp.status_code == 404

    def test_add_task_missing_title_defaults_empty(self, client, db):
        lead = create_test_lead(db, email="notitle@t.com")
        resp = client.post(f"/api/leads/{lead.id}/tasks", json={})
        assert resp.status_code == 200
        # title defaults to ""
        assert resp.json()["title"] == ""


class TestGetTasks:

    def test_get_tasks_for_lead(self, client, db):
        lead = create_test_lead(db, email="gettask@t.com")
        create_test_task(db, lead.id, "Task A")
        create_test_task(db, lead.id, "Task B")

        resp = client.get(f"/api/leads/{lead.id}/tasks")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_get_tasks_empty_list(self, client, db):
        lead = create_test_lead(db, email="emptytask@t.com")
        resp = client.get(f"/api/leads/{lead.id}/tasks")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_get_tasks_ordered_asc(self, client, db):
        lead = create_test_lead(db, email="ordertask@t.com")
        t1 = create_test_task(db, lead.id, "First")
        t2 = create_test_task(db, lead.id, "Second")
        tasks = client.get(f"/api/leads/{lead.id}/tasks").json()
        ids = [t["id"] for t in tasks]
        assert ids.index(t1.id) < ids.index(t2.id)


class TestToggleTask:

    def test_toggle_task_done(self, client, db):
        lead = create_test_lead(db, email="toggle@t.com")
        task = create_test_task(db, lead.id, "Toggle me")

        resp = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": True})
        assert resp.status_code == 200
        assert resp.json()["done"] == "true"

    def test_toggle_task_undone(self, client, db):
        lead = create_test_lead(db, email="undone@t.com")
        task = create_test_task(db, lead.id, "Undone me", done="true")

        resp = client.patch(f"/api/leads/{lead.id}/tasks/{task.id}", json={"done": False})
        assert resp.status_code == 200
        assert resp.json()["done"] == "false"

    def test_toggle_nonexistent_task_404(self, client, db):
        lead = create_test_lead(db, email="notask@t.com")
        resp = client.patch(f"/api/leads/{lead.id}/tasks/fake-id", json={"done": True})
        assert resp.status_code == 404


class TestDeleteTask:

    def test_delete_task(self, client, db):
        lead = create_test_lead(db, email="deltask@t.com")
        task = create_test_task(db, lead.id, "Delete me")

        resp = client.delete(f"/api/leads/{lead.id}/tasks/{task.id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_nonexistent_task_404(self, client, db):
        lead = create_test_lead(db, email="delno3@t.com")
        resp = client.delete(f"/api/leads/{lead.id}/tasks/fake-task-id")
        assert resp.status_code == 404

    def test_delete_removes_task_from_db(self, client, db):
        lead = create_test_lead(db, email="delcheck@t.com")
        task = create_test_task(db, lead.id, "Gone soon")
        client.delete(f"/api/leads/{lead.id}/tasks/{task.id}")

        remaining = client.get(f"/api/leads/{lead.id}/tasks").json()
        assert not any(t["id"] == task.id for t in remaining)


# ════════════════════════════════════════════════════════════════════════════════
# Notification — GET /api/my/tasks/pending
# ════════════════════════════════════════════════════════════════════════════════

class TestGetPendingTasks:

    def _sdr_user(self, db):
        return create_test_user(db, email="sdr_pending@test.com", name="SDR Pending", role="SDR", google_id="sdr-google-1")

    def test_returns_overdue_task(self, client_as_sdr, db):
        user = self._sdr_user(db)
        # Patch client to use this user's ID
        lead = create_test_lead(db, email="pending@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=10)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Overdue task", due_time=past, dismissed="false")
        db.add(task)
        db.commit()

        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        resp = tc.get("/api/my/tasks/pending")
        assert resp.status_code == 200
        ids = [t["id"] for t in resp.json()]
        assert task.id in ids

    def test_future_task_not_returned(self, db):
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="fut@test.com", role="SDR", google_id="fut-1")
        lead = create_test_lead(db, email="fut_lead@t.com")
        future = datetime.now(timezone.utc) + timedelta(minutes=60)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Future task", due_time=future, dismissed="false")
        db.add(task)
        db.commit()

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        resp = tc.get("/api/my/tasks/pending")
        assert resp.status_code == 200
        ids = [t["id"] for t in resp.json()]
        assert task.id not in ids

    def test_dismissed_task_excluded(self, db):
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="dismissed_pending@test.com", role="SDR", google_id="dis-2")
        lead = create_test_lead(db, email="dis2@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Dismissed", due_time=past, dismissed="true")
        db.add(task)
        db.commit()

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        resp = tc.get("/api/my/tasks/pending")
        assert resp.status_code == 200
        assert all(t["id"] != task.id for t in resp.json())

    def test_done_task_excluded(self, db):
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="done_pending@test.com", role="SDR", google_id="done-3")
        lead = create_test_lead(db, email="done3@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Done task", due_time=past, done="true", dismissed="false")
        db.add(task)
        db.commit()

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        resp = tc.get("/api/my/tasks/pending")
        assert resp.status_code == 200
        assert all(t["id"] != task.id for t in resp.json())

    def test_snoozed_task_hidden_while_snooze_active(self, db):
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="snooze_hidden@test.com", role="SDR", google_id="snz-4")
        lead = create_test_lead(db, email="snz4@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        future_snooze = datetime.now(timezone.utc) + timedelta(minutes=30)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Snoozed", due_time=past, dismissed="false",
                           snoozed_until=future_snooze)
        db.add(task)
        db.commit()

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        resp = tc.get("/api/my/tasks/pending")
        assert all(t["id"] != task.id for t in resp.json())

    def test_snoozed_task_visible_after_snooze_expires(self, db):
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="snooze_expired@test.com", role="SDR", google_id="snz-5")
        lead = create_test_lead(db, email="snz5@t.com")
        past = datetime.now(timezone.utc) - timedelta(hours=2)
        expired_snooze = datetime.now(timezone.utc) - timedelta(minutes=1)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Re-appearing", due_time=past, dismissed="false",
                           snoozed_until=expired_snooze)
        db.add(task)
        db.commit()

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        resp = tc.get("/api/my/tasks/pending")
        ids = [t["id"] for t in resp.json()]
        assert task.id in ids

    def test_pending_includes_lead_name(self, db):
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="leadname@test.com", role="SDR", google_id="ln-6")
        lead = create_test_lead(db, first_name="Alice", last_name="Smith", email="alice@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Name check", due_time=past, dismissed="false")
        db.add(task)
        db.commit()

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        tasks = tc.get("/api/my/tasks/pending").json()
        match = next((t for t in tasks if t["id"] == task.id), None)
        assert match is not None
        assert "Alice" in match["lead_name"]

    def test_pending_only_returns_own_tasks(self, db):
        """SDR A's pending tasks must not include SDR B's tasks."""
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user_a = create_test_user(db, email="a_pending@t.com", role="SDR", google_id="ua-7")
        user_b = create_test_user(db, email="b_pending@t.com", role="SDR", google_id="ub-7")
        lead = create_test_lead(db, email="shared_lead@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        task_b = models.Task(lead_id=lead.id, user_id=user_b.id,
                             title="B's task", due_time=past, dismissed="false")
        db.add(task_b)
        db.commit()

        payload_a = _make_user_payload("SDR", user_a.id, user_a.email, user_a.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload_a
        tc = TestClient(app)

        tasks = tc.get("/api/my/tasks/pending").json()
        assert all(t["id"] != task_b.id for t in tasks)


# ════════════════════════════════════════════════════════════════════════════════
# Notification — PATCH /api/my/tasks/{task_id}/snooze
# ════════════════════════════════════════════════════════════════════════════════

class TestSnoozeTask:

    def _setup(self, db):
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="snooze_sdr@t.com", role="SDR", google_id="snooze-sdr")
        lead = create_test_lead(db, email="snooze_lead@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Snooze me", due_time=past, dismissed="false")
        db.add(task)
        db.commit()

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload

        return TestClient(app), task

    def test_snooze_15_minutes(self, db):
        tc, task = self._setup(db)
        resp = tc.patch(f"/api/my/tasks/{task.id}/snooze", json={"minutes": 15})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "snoozed_until" in data

    def test_snooze_60_minutes(self, db):
        tc, task = self._setup(db)
        resp = tc.patch(f"/api/my/tasks/{task.id}/snooze", json={"minutes": 60})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_snooze_5_minutes(self, db):
        tc, task = self._setup(db)
        resp = tc.patch(f"/api/my/tasks/{task.id}/snooze", json={"minutes": 5})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_snooze_invalid_minutes_clamped_to_15(self, db):
        """Any value not in (5, 15, 30, 60) must be clamped to 15 by the backend."""
        tc, task = self._setup(db)
        resp = tc.patch(f"/api/my/tasks/{task.id}/snooze", json={"minutes": 999})
        assert resp.status_code == 200
        db.refresh(task)
        # SQLite stores datetimes without timezone info; normalise before comparison
        snoozed = task.snoozed_until
        if snoozed is not None and snoozed.tzinfo is None:
            snoozed = snoozed.replace(tzinfo=timezone.utc)
        diff = (snoozed - datetime.now(timezone.utc)).total_seconds()
        assert 14 * 60 < diff < 16 * 60, f"Expected ~15 min snooze, got {diff:.0f}s"

    def test_snooze_task_not_found(self, db):
        tc, _ = self._setup(db)
        resp = tc.patch("/api/my/tasks/nonexistent-task/snooze", json={"minutes": 15})
        assert resp.status_code == 404

    def test_snooze_hides_task_from_pending(self, db):
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="snooze_hides@t.com", role="SDR", google_id="sh-8")
        lead = create_test_lead(db, email="snhide@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Hide after snooze", due_time=past, dismissed="false")
        db.add(task)
        db.commit()

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        tc.patch(f"/api/my/tasks/{task.id}/snooze", json={"minutes": 60})

        pending = tc.get("/api/my/tasks/pending").json()
        assert all(t["id"] != task.id for t in pending)


# ════════════════════════════════════════════════════════════════════════════════
# Notification — PATCH /api/my/tasks/{task_id}/dismiss
# ════════════════════════════════════════════════════════════════════════════════

class TestDismissTask:

    def _setup(self, db):
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="dismiss_sdr@t.com", role="SDR", google_id="dis-sdr")
        lead = create_test_lead(db, email="dis_lead@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        task = models.Task(lead_id=lead.id, user_id=user.id,
                           title="Dismiss me", due_time=past, dismissed="false")
        db.add(task)
        db.commit()

        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload

        return TestClient(app), task

    def test_dismiss_returns_ok(self, db):
        tc, task = self._setup(db)
        resp = tc.patch(f"/api/my/tasks/{task.id}/dismiss")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_dismiss_sets_dismissed_true_in_db(self, db):
        tc, task = self._setup(db)
        tc.patch(f"/api/my/tasks/{task.id}/dismiss")
        db.refresh(task)
        assert task.dismissed == "true"

    def test_dismiss_task_remains_in_db(self, db):
        """Dismiss must NOT delete the task — it only hides the notification."""
        tc, task = self._setup(db)
        tc.patch(f"/api/my/tasks/{task.id}/dismiss")
        still_exists = db.query(models.Task).filter(models.Task.id == task.id).first()
        assert still_exists is not None

    def test_dismiss_hides_from_pending(self, db):
        tc, task = self._setup(db)
        tc.patch(f"/api/my/tasks/{task.id}/dismiss")

        # Re-fetch pending with same client (same user)
        pending = tc.get("/api/my/tasks/pending").json()
        assert all(t["id"] != task.id for t in pending)

    def test_dismiss_task_not_found(self, db):
        tc, _ = self._setup(db)
        resp = tc.patch("/api/my/tasks/nonexistent/dismiss")
        assert resp.status_code == 404

    def test_dismiss_other_users_task_404(self, db):
        """An SDR must not be able to dismiss another user's task."""
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        owner = create_test_user(db, email="owner_dis@t.com", role="SDR", google_id="own-9")
        attacker = create_test_user(db, email="attack_dis@t.com", role="SDR", google_id="atk-9")
        lead = create_test_lead(db, email="own_lead@t.com")
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        task = models.Task(lead_id=lead.id, user_id=owner.id,
                           title="Owner's task", due_time=past, dismissed="false")
        db.add(task)
        db.commit()

        attacker_payload = _make_user_payload("SDR", attacker.id, attacker.email, attacker.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: attacker_payload
        tc = TestClient(app)

        resp = tc.patch(f"/api/my/tasks/{task.id}/dismiss")
        assert resp.status_code == 404


# ════════════════════════════════════════════════════════════════════════════════
# RCA-2026-05-29 — DB connection timeout → 503, not 500
# ════════════════════════════════════════════════════════════════════════════════

class TestPendingTasksDBTimeout:
    """
    RCA-2026-05-29: Render Postgres briefly refused TCP connections at socket
    level (psycopg2.OperationalError) causing GET /api/my/tasks/pending to return
    HTTP 500. The fix wraps the query in an OperationalError guard that returns
    503 + Retry-After so the frontend can silently retry.
    """

    def test_db_operational_error_returns_503(self, db):
        """OperationalError from DB layer must map to HTTP 503, not 500."""
        from unittest.mock import patch
        from sqlalchemy.exc import OperationalError
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="rca_timeout@t.com", role="SDR", google_id="rca-1")
        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        # Simulate Postgres TCP connect timeout at the query level
        with patch("sqlalchemy.orm.Query.all", side_effect=OperationalError(
            "connection to server port 5432 failed: timeout expired", None, None
        )):
            resp = tc.get("/api/my/tasks/pending")

        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}"
        assert "Retry-After" in resp.headers
        assert resp.headers["Retry-After"] == "5"
        detail = resp.json().get("detail", "")
        assert "temporarily unavailable" in detail

    def test_normal_db_still_returns_200(self, db):
        """Ensure the guard does not break the happy path — 200 still returned normally."""
        from conftest import _build_test_app, _make_user_payload
        from fastapi.testclient import TestClient
        from database import get_db
        from auth import get_current_user

        user = create_test_user(db, email="rca_ok@t.com", role="SDR", google_id="rca-2")
        payload = _make_user_payload("SDR", user.id, user.email, user.name)
        app = _build_test_app()
        app.dependency_overrides[get_db] = lambda: (yield db)
        app.dependency_overrides[get_current_user] = lambda: payload
        tc = TestClient(app)

        resp = tc.get("/api/my/tasks/pending")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
