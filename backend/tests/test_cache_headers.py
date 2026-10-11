"""Browser caching of API GETs (middleware_cache_headers). The users list feeds settings screens, so the browser must never keep it."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware_cache_headers import CacheHeaderMiddleware


def _client():
    app = FastAPI()
    app.add_middleware(CacheHeaderMiddleware)
    for path in ("/api/admin/users", "/api/leaderboard", "/api/admin/users/abc/settings"):
        app.add_api_route(path, lambda: {"ok": True}, methods=["GET"])
    return TestClient(app)


def test_the_users_list_is_never_kept_by_the_browser_so_a_changed_setting_shows_at_once():
    for url in ("/api/admin/users", "/api/admin/users?fresh=true", "/api/admin/users?include_left=true"):
        assert _client().get(url).headers["Cache-Control"] == "no-store"


def test_other_stable_lists_keep_their_short_browser_cache():
    h = _client().get("/api/leaderboard").headers
    assert "max-age=30" in h["Cache-Control"] and "stale-while-revalidate" in h["Cache-Control"]


def test_a_per_user_settings_route_is_not_given_a_cache_policy():
    assert "max-age" not in _client().get("/api/admin/users/abc/settings").headers.get("Cache-Control", "")
