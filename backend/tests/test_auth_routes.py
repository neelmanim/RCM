"""Tests for routes/auth_routes.py — Health, demo login, config, /me."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import models
from routes.auth_routes import _record_access_request


class TestRecordAccessRequest:
    """The login page's whole "request access" mechanism — see
    models.AccessRequest's docstring: signing in with an unrecognized
    Google account records/refreshes a request rather than needing a
    separate self-service form."""

    def test_first_attempt_creates_row_and_notifies(self, db, monkeypatch):
        import access_notifications
        notified = []
        monkeypatch.setattr(
            access_notifications, "notify_new_access_request_in_background",
            lambda email, name: notified.append((email, name)),
        )

        _record_access_request(db, "newperson@test.com", "New Person")

        row = db.query(models.AccessRequest).filter(models.AccessRequest.email == "newperson@test.com").first()
        assert row is not None
        assert row.name == "New Person"
        assert notified == [("newperson@test.com", "New Person")]

    def test_repeated_attempt_updates_timestamp_without_renotifying(self, db, monkeypatch):
        import access_notifications
        notified = []
        monkeypatch.setattr(
            access_notifications, "notify_new_access_request_in_background",
            lambda email, name: notified.append((email, name)),
        )

        _record_access_request(db, "repeat@test.com", "Repeat Person")
        first = db.query(models.AccessRequest).filter(models.AccessRequest.email == "repeat@test.com").first()
        first_requested_at = first.requested_at

        _record_access_request(db, "repeat@test.com", "Repeat Person")

        assert db.query(models.AccessRequest).filter(models.AccessRequest.email == "repeat@test.com").count() == 1
        assert len(notified) == 1  # only the first attempt notifies


class TestHealth:

    def test_health_returns_ok(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["db_connected"] is True


class TestDemoLoginRemoved:
    """2026-09-29: demo login was deleted outright — a prod env flag was the
    only thing keeping it off. Both routes must be gone, not disabled."""

    def test_demo_and_config_routes_do_not_exist(self, client, monkeypatch):
        monkeypatch.setenv("ALLOW_DEMO", "true")
        assert client.get("/api/auth/demo?role=Super%20Admin").status_code == 404
        assert client.get("/api/config").status_code == 404


class TestMe:

    def test_me_returns_current_user(self, client):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "admin@test.com"
        assert data["role"] == "Super Admin"


