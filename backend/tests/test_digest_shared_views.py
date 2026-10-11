"""Team Digest views an admin shares with the whole team (saved_views.shared)."""
from services import digest_metrics
from tests.conftest import create_test_user


def _users(db):      # saved_views.user_id is a real foreign key on Postgres
    create_test_user(db, email="admin@test.com", id="test-user-id", role="Super Admin")
    create_test_user(db, email="sdr@test.com", id="sdr-user-id", role="SDR")


def _view(name="Weekly", shared=False, keys=tuple(digest_metrics.DEFAULT_KEYS)):
    return {"scope": "digest", "name": name, "keys": list(keys), "filters": {"period": "last7"}, "shared": shared}


def test_an_admin_shares_a_view_and_everyone_sees_it_read_only(client, client_as_sdr, db):
    _users(db)
    r = client.post("/api/me/saved-views", json=_view(shared=True))
    assert r.status_code == 200 and r.json()["shared"] is True and r.json()["mine"] is True
    vid = r.json()["id"]
    seen = client_as_sdr.get("/api/me/saved-views?scope=digest").json()["views"]
    assert [v["id"] for v in seen] == [vid] and seen[0]["mine"] is False
    assert client_as_sdr.delete(f"/api/me/saved-views/{vid}").status_code == 404        # not theirs to remove
    assert client.delete(f"/api/me/saved-views/{vid}").status_code == 200


def test_an_sdr_cannot_share_and_private_views_stay_private(client, client_as_sdr, db):
    _users(db)
    assert client_as_sdr.post("/api/me/saved-views", json=_view(shared=True)).status_code == 403
    assert client_as_sdr.post("/api/me/saved-views", json=_view(name="Mine")).status_code == 200
    assert client.get("/api/me/saved-views?scope=digest").json()["views"] == []


def test_sharing_only_applies_to_digest_views(client, client_as_sdr, db):
    _users(db)
    r = client.post("/api/me/saved-views", json={"name": "L", "filters": {"status": "New"}, "keys": ["status"], "shared": True})
    assert r.status_code == 200 and r.json()["shared"] is False
    assert client_as_sdr.get("/api/me/saved-views?scope=leads").json()["views"] == []
