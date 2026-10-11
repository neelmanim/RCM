"""v13.12.1 — every persona, every surface touched this release. Real role checks (only get_current_user is replaced),
two pods of seeded data, so a leak or a wrongly-open endpoint shows up for the role that would hit it."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import access_db
import models
from tests.conftest import (_build_test_app, _make_user_payload, create_test_booking, create_test_call, create_test_lead,
                            create_test_user, ensure_pods)

DAY = datetime(2026, 2, 10, 10, 0, 0, tzinfo=timezone.utc)
ROLES = ["Super Admin", "Admin", "Pod Admin", "AE", "SDR", "CSM"]
ADMINS = {"Super Admin", "Admin", "Pod Admin"}


@pytest.fixture(autouse=True)
def _fresh_digest_cache():
    from routes import analytics_routes
    analytics_routes._cache.clear()        # the digest is cached per day+pod; tests reuse the same day


EXPORT_ROLES = ("Super Admin", "Admin")        # everyone else needs users.export_enabled


@pytest.fixture()
def world(db):
    """Pod A (the personas' own pod) and Pod B, each with a rep, a lead, a call, an email, a note and a booking."""
    ensure_pods(db, "pod-a", "pod-b")
    mine = create_test_user(db, email="mine@t.com", id="mine", name="Mine Rep", role="SDR", pod_id="pod-a")
    theirs = create_test_user(db, email="theirs@t.com", id="theirs", name="Their Rep", role="SDR", pod_id="pod-b")
    for u, pod in ((mine, "pod-a"), (theirs, "pod-b")):
        lead = create_test_lead(db, email=f"{u.id}@lead.com", pod_id=pod, status="Calling")
        create_test_call(db, lead.id, u.id, called_at=DAY)
        db.add(models.LeadEmailActivity(lead_id=lead.id, user_id=u.id, direction="outbound", subject="s",
                                        timestamp=DAY, nylas_thread_id=f"t-{u.id}"))
        db.add(models.Note(lead_id=lead.id, content="research", author=u.name, created_at=DAY))
        create_test_booking(db, lead, u.id, booked_at=DAY)
    # the personas themselves: same ids the payloads carry, all in pod A
    for role in ROLES:
        create_test_user(db, email=f"{role[:2].lower()}-p@t.com", id=f"p-{role}", name=f"{role} Persona", role=role,
                         pod_id=None if role in ("Super Admin", "Admin") else "pod-a")
    db.commit()
    return db


def _client(db, role):
    from auth import get_current_user
    from database import get_db, get_ai_db
    app = _build_test_app()
    app.dependency_overrides[get_db] = app.dependency_overrides[get_ai_db] = lambda: db
    payload = _make_user_payload(role, f"p-{role}", f"{role[:2].lower()}-p@t.com", f"{role} Persona",
                                 pod_id=None if role in ("Super Admin", "Admin") else "pod-a")
    app.dependency_overrides[get_current_user] = lambda: payload
    return TestClient(app)


def _ids(rows, key):
    return {r[key] for r in rows}


@pytest.mark.parametrize("role", ROLES)
def test_daily_digest(world, role):
    r = _client(world, role).get("/api/admin/analytics/daily-digest?date=2026-02-10")
    if role not in ADMINS:
        assert r.status_code == 403
        for path in ("/leads", "/export.xlsx"):
            assert _client(world, role).get("/api/admin/analytics/daily-digest" + path + "?date=2026-02-10").status_code == 403
        return
    assert r.status_code == 200, r.text
    reps = _ids(r.json()["sdr_snapshot"], "user_id")
    assert "mine" in reps
    assert ("theirs" in reps) == (role != "Pod Admin")                     # a Pod Admin never sees the other pod
    k = r.json()["kpi"]
    expect = 1 if role == "Pod Admin" else 2
    assert k["calls_made"]["today"] == k["emails_sent"]["today"] == k["research_notes"]["today"] == k["meetings_booked"]["today"] == expect
    leads = _client(world, role).get("/api/admin/analytics/daily-digest/leads?date=2026-02-10").json()["items"]
    assert {x["rep_id"] for x in leads} == ({"mine"} if role == "Pod Admin" else {"mine", "theirs"})
    x = _client(world, role).get("/api/admin/analytics/daily-digest/export.xlsx?date=2026-02-10")
    if role in EXPORT_ROLES:
        assert x.status_code == 200 and x.content[:2] == b"PK"
    else:
        assert x.status_code == 403                                      # export is off until a Super Admin switches it on


def test_super_admin_can_narrow_the_digest_to_one_pod_but_a_pod_admin_cannot_widen_it(world):
    sa = _client(world, "Super Admin").get("/api/admin/analytics/daily-digest?date=2026-02-10&pod_id=pod-b").json()
    assert _ids(sa["sdr_snapshot"], "user_id") == {"theirs"}
    pa = _client(world, "Pod Admin").get("/api/admin/analytics/daily-digest?date=2026-02-10&pod_id=pod-b").json()
    assert _ids(pa["sdr_snapshot"], "user_id") == {"mine"}                  # the param is ignored for a Pod Admin


@pytest.mark.parametrize("role", ROLES)
def test_sdr_table(world, role):
    r = _client(world, role).get("/api/admin/analytics/sdr-table?preset=all&page_size=100")
    if role == "CSM":
        assert r.status_code == 403
        return
    assert r.status_code == 200, r.text
    reps = _ids(r.json()["sdrs"], "sdr_id") & {"mine", "theirs"}
    assert reps == {"Super Admin": {"mine", "theirs"}, "Admin": {"mine", "theirs"}, "Pod Admin": {"mine"},
                    "AE": set(), "SDR": set()}[role]                        # AE/SDR are scoped to themselves, never a colleague
    row = next((x for x in r.json()["sdrs"] if x["sdr_id"] == "mine"), None)
    if row:
        assert row["meetings"] == 1                                         # bookings by the booker


@pytest.mark.parametrize("role", ROLES)
def test_leaderboard(world, role):
    r = _client(world, role).get("/api/leaderboard")
    assert r.status_code == 200, r.text
    ids = _ids(r.json(), "id") & {"mine", "theirs"}
    if role == "Pod Admin":
        assert ids == {"mine"}
    else:
        assert "mine" in ids
    assert all(x["meetings_scheduled"] == 1 for x in r.json() if x["id"] in ("mine", "theirs"))


@pytest.mark.parametrize("role", ROLES)
def test_user_list(world, role):
    r = _client(world, role).get("/api/admin/users")
    if role not in ADMINS:
        assert r.status_code == 403
        return
    assert r.status_code == 200
    ids = _ids(r.json(), "id")
    assert ("theirs" in ids) == (role != "Pod Admin") and "mine" in ids


@pytest.mark.parametrize("role", ROLES)
def test_activity_monitor_email_logs(world, role):
    r = _client(world, role).get("/api/admin/email-logs")
    if role not in ADMINS:
        assert r.status_code == 403
        return
    assert r.status_code == 200
    seen = {i.get("user_id") or i.get("sdr_id") or i.get("user") for i in r.json()["items"]}
    assert r.json()["total"] == (1 if role == "Pod Admin" else 2), seen


@pytest.mark.parametrize("role", ROLES)
def test_raw_export(world, role):
    r = _client(world, role).get("/api/exports/activity.xlsx?date_from=2026-02-10&date_to=2026-02-10")
    assert r.status_code == (200 if role in EXPORT_ROLES else 403), r.text[:200]


@pytest.mark.parametrize("role", ROLES)
def test_my_day_lifecycle_is_available_to_everyone_for_their_own_leads(world, role):
    r = _client(world, role).get("/api/my-day/lifecycle")
    assert r.status_code == 200, r.text


# ── "View as": Super Admin anyone; Pod Admin only the SDRs/AEs of their own pod ─────────────────────────────────
@pytest.mark.parametrize("role", ROLES)
def test_view_as(world, role):
    get = lambda target: _client(world, role).get(f"/api/admin/users/{target}/token").status_code
    if role in ("AE", "SDR", "CSM"):
        assert get("mine") == 403
        return
    if role in ("Super Admin", "Admin"):
        assert get("mine") == get("theirs") == get("p-Pod Admin") == get("p-AE") == 200
        return
    assert get("mine") == 200 and get("p-AE") == 200                       # their own pod's SDR and AE
    assert get("theirs") == 403                                            # another pod's rep
    assert get("p-Super Admin") == 403 and get("p-Admin") == 403           # never an admin
    assert get("p-Pod Admin") == 400                                       # not yourself


def test_pod_admin_cannot_view_as_another_pod_admin_or_a_leaver(world):
    from services import offboarding
    db = world
    create_test_user(db, email="pa-other@t.com", id="pa-other", role="Pod Admin", pod_id="pod-a")
    assert _client(db, "Pod Admin").get("/api/admin/users/pa-other/token").status_code == 403
    left = db.query(models.User).filter_by(id="mine").first()
    offboarding.offboard(db, left, "p-Super Admin")
    assert _client(db, "Pod Admin").get("/api/admin/users/mine/token").status_code in (400, 403)


def test_view_as_works_for_a_pod_admin_whose_pod_comes_only_from_pod_admins(world):
    db = world
    from tests.conftest import create_pod_admin
    pa = db.query(models.User).filter_by(id="p-Pod Admin").first()
    pa.pod_id = None
    create_pod_admin(db, "pod-a", pa.id)
    db.commit()
    assert access_db.pod_for(db, pa) == "pod-a"
    c = _client(db, "Pod Admin")
    assert c.get("/api/admin/users/mine/token").status_code == 200           # own pod, via the pod_admins row
    assert c.get("/api/admin/users/theirs/token").status_code == 403
