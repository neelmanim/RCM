"""A Pod Admin's View As token is read-only; a Super Admin's is unchanged."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import create_jwt, decode_jwt
from middleware_view_as import ViewAsReadOnlyMiddleware
from tests.test_v13_12_1_personas import _client, world  # noqa: F401


def _app():
    app = FastAPI()

    @app.get("/x")
    def r():
        return {"ok": 1}

    @app.post("/x")
    def w():
        return {"ok": 1}

    app.add_middleware(ViewAsReadOnlyMiddleware)
    return TestClient(app)


def test_read_only_token_can_read_but_not_write():
    c = _app()
    h = {"Authorization": "Bearer " + create_jwt({"sub": "u", "view_as_read_only": True})}
    assert c.get("/x", headers=h).status_code == 200
    for m in ("post", "put", "patch", "delete"):
        assert getattr(c, m)("/x", headers=h).status_code == 403


def test_normal_and_missing_tokens_unaffected():
    c = _app()
    assert c.post("/x", headers={"Authorization": "Bearer " + create_jwt({"sub": "u"})}).status_code == 200
    assert c.post("/x").status_code == 200            # no token: the auth layer decides, not this one
    assert c.post("/x", headers={"Authorization": "Bearer junk"}).status_code == 200


def test_only_pod_admin_view_as_tokens_are_read_only(world):
    claim = lambda role, target: decode_jwt(_client(world, role).get(f"/api/admin/users/{target}/token").json()["token"]).get("view_as_read_only")
    assert claim("Pod Admin", "mine") is True
    assert claim("Super Admin", "mine") is None
