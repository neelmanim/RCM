"""Tests for routes/auth_routes.py — Health, demo login, config, /me."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestHealth:

    def test_health_returns_ok(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["db_connected"] is True


class TestConfig:

    def test_config_returns_allow_demo(self, client):
        resp = client.get("/api/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "allow_demo" in data


class TestMe:

    def test_me_returns_current_user(self, client):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "admin@test.com"
        assert data["role"] == "Super Admin"


class TestDemoLogin:

    def test_demo_login_sdr(self, client, monkeypatch):
        monkeypatch.setenv("ALLOW_DEMO", "true")
        resp = client.get("/api/auth/demo?role=SDR")
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert data["user"]["role"] == "SDR"

    def test_demo_login_super_admin(self, client, monkeypatch):
        monkeypatch.setenv("ALLOW_DEMO", "true")
        resp = client.get("/api/auth/demo?role=Super Admin")
        assert resp.status_code == 200
        assert resp.json()["user"]["role"] == "Super Admin"

    def test_demo_login_legacy_admin_maps_to_super(self, client, monkeypatch):
        monkeypatch.setenv("ALLOW_DEMO", "true")
        resp = client.get("/api/auth/demo?role=Admin")
        assert resp.status_code == 200
        assert resp.json()["user"]["role"] == "Super Admin"

    def test_demo_login_invalid_role_defaults_to_sdr(self, client, monkeypatch):
        monkeypatch.setenv("ALLOW_DEMO", "true")
        resp = client.get("/api/auth/demo?role=InvalidRole")
        assert resp.status_code == 200
        assert resp.json()["user"]["role"] == "SDR"

    def test_demo_login_disabled_returns_403(self, client, monkeypatch):
        """When ALLOW_DEMO is not set, the endpoint must return 403."""
        monkeypatch.setenv("ALLOW_DEMO", "false")
        resp = client.get("/api/auth/demo?role=SDR")
        assert resp.status_code == 403

    def test_demo_login_creates_user_on_first_call(self, client, db, monkeypatch):
        import models
        monkeypatch.setenv("ALLOW_DEMO", "true")
        resp = client.get("/api/auth/demo?role=Pod Admin")
        assert resp.status_code == 200
        user = db.query(models.User).filter(models.User.email == "demo.podadmin@rcm.dev").first()
        assert user is not None
        assert user.role == "Pod Admin"

