"""Data export is OFF unless a Super Admin switched it on for that person (users.export_enabled).

Covers every way to get a file out: the CSV/Excel download routes, the e-mailed report attachment, the admin switch itself, the
live-read capability the UI hides its buttons with, and a ratchet that fails the build for any NEW route that produces a
file without the guard."""
import inspect
import re

import pytest
from fastapi.testclient import TestClient

import models
from auth import EXPORT_DENIED_MESSAGE, create_jwt, export_allowed, export_allowed_for_user_id, require_export_access
from tests.conftest import _build_test_app, _make_user_payload, create_test_user, grant_export

# (path, needs the Pod Admin role to get past its own role check)
GUARDED = [
    "/api/admin/leads/export?date_from=2000-01-01",
    "/api/admin/analytics/export",
    "/api/exports/activity.xlsx?date_from=2026-02-10&date_to=2026-02-10",
    "/api/admin/analytics/daily-digest/export.xlsx?date=2026-02-10",
    "/api/admin/analytics/sales-funnel/export.xlsx",
    "/api/my-day/export",
    "/api/admin/sf-logs/export",
    "/api/journeys/some-journey/enrollments/export",
]


@pytest.mark.parametrize("path", GUARDED)
def test_without_the_flag_every_export_route_refuses_even_an_admin_role(client_as_pod_admin, path):
    r = client_as_pod_admin.get(path)
    assert r.status_code == 403 and r.json()["detail"] == EXPORT_DENIED_MESSAGE, (path, r.status_code, r.text[:120])


@pytest.mark.parametrize("path", GUARDED)
def test_with_the_flag_the_guard_lets_the_request_through(client_as_pod_admin, db, path):
    grant_export(db, "pod-admin-id", role="Pod Admin")
    r = client_as_pod_admin.get(path)
    assert r.json().get("detail") != EXPORT_DENIED_MESSAGE if r.headers.get("content-type", "").startswith("application/json") else True


@pytest.mark.parametrize("path", GUARDED)
def test_super_admin_always_may(client, path):
    r = client.get(path)
    assert not (r.headers.get("content-type", "").startswith("application/json") and r.json().get("detail") == EXPORT_DENIED_MESSAGE)


def test_an_sdr_without_the_flag_cannot_export_their_own_day(client_as_sdr):
    r = client_as_sdr.get("/api/my-day/export")
    assert r.status_code == 403 and r.json()["detail"] == EXPORT_DENIED_MESSAGE


def test_the_flag_does_not_widen_the_role_an_sdr_with_export_still_cannot_use_admin_exports(client_as_sdr, db):
    from tests.conftest import SDR_USER
    grant_export(db, SDR_USER["sub"])
    assert client_as_sdr.get("/api/my-day/export").status_code == 200                 # their own day: allowed now
    assert client_as_sdr.get("/api/admin/leads/export").status_code == 403            # org-wide export: still admin only
    assert client_as_sdr.get("/api/admin/leads/export").json()["detail"] != EXPORT_DENIED_MESSAGE


def test_a_revoke_bites_at_once(client_as_pod_admin, db):
    u = grant_export(db, "pod-admin-id", role="Pod Admin")
    assert client_as_pod_admin.get("/api/my-day/export").status_code == 200
    u.export_enabled = False
    db.commit()
    assert client_as_pod_admin.get("/api/my-day/export").status_code == 403


def test_view_as_never_downloads(db):
    grant_export(db, "someone", role="SDR")
    assert export_allowed(db, {"sub": "someone", "role": "SDR"}) is True
    assert export_allowed(db, {"sub": "someone", "role": "SDR", "view_as_read_only": True}) is False
    assert export_allowed(db, {"sub": "boss", "role": "Super Admin", "view_as_read_only": True}) is False


def test_an_unknown_user_is_refused(db):
    assert export_allowed(db, {"sub": "ghost", "role": "Pod Admin"}) is False


def test_metrics_export_checks_the_token_user_inside_the_route(db):
    from routes import metrics_routes  # noqa: F401  (route exists)
    app = _build_test_app()
    from database import get_db, get_ai_db
    app.dependency_overrides[get_db] = app.dependency_overrides[get_ai_db] = lambda: db
    c = TestClient(app)
    create_test_user(db, email="pa-m@t.com", id="pa-m", role="Pod Admin")
    from access_db import add_allowed_user, forget_identity
    forget_identity()
    add_allowed_user(db, "pa-m@t.com", "PA", "Pod Admin", "admin")
    tok = create_jwt({"sub": "pa-m", "email": "pa-m@t.com", "name": "PA", "role": "Pod Admin", "pod_id": None})
    r = c.get(f"/api/admin/metrics/export?token={tok}")
    assert r.status_code == 403 and r.json()["detail"] == EXPORT_DENIED_MESSAGE
    grant_export(db, "pa-m", role="Pod Admin")
    after = c.get(f"/api/admin/metrics/export?token={tok}")
    assert after.status_code == 200 and after.headers["content-type"].startswith("text/csv")


# ── e-mailed report attachments ─────────────────────────────────────────────────────────────────────────────────
def _body(**kw):
    b = {"name": "R", "components": ["key_metrics"], "date_range_rule": "previous_7_days", "frequency": "weekly", "weekday": 0,
         "timezone": "UTC", "send_hour": 9, "send_minute": 0, "to_recipients": ["a@b.com"], "sender_user_id": "sender-1"}
    b.update(kw)
    return b


def test_a_pod_admin_without_export_cannot_ask_for_a_csv_attachment_and_gets_none_by_default(client_as_pod_admin, db):
    create_test_user(db, email="s@t.com", id="sender-1", role="SDR")
    db.add(models.Pod(id="test-pod-id", name="Test Pod"))
    db.commit()
    create_test_user(db, email="pa@t.com", id="pod-admin-id", role="Pod Admin", pod_id="test-pod-id")      # real foreign keys on Postgres
    assert client_as_pod_admin.post("/api/admin/analytics/reports", json=_body(include_csv=True)).status_code == 403
    r = client_as_pod_admin.post("/api/admin/analytics/reports", json=_body())
    assert r.status_code in (200, 201) and r.json()["include_csv"] is False


def test_a_report_only_attaches_the_csv_when_its_owner_may_export(db):
    import report_service
    from unittest.mock import patch
    create_test_user(db, email="own@t.com", id="owner-1", role="Pod Admin")
    sender = create_test_user(db, email="snd@t.com", id="sender-2", role="SDR")
    rep = models.ReportConfig(name="R", enabled=True, components='["key_metrics"]', date_range_rule="previous_7_days", frequency="weekly",
                              weekday=0, timezone="UTC", send_hour=9, send_minute=0, to_recipients='["a@b.com"]',
                              sender_user_id=sender.id, include_csv=True, owner_id="owner-1")
    db.add(rep)
    db.commit()
    with patch.object(report_service, "send_report_email", return_value=True) as send, \
         patch.object(report_service, "build_report_content", return_value=("<p/>", "a,b\n1,2")):
        report_service.execute_report(db, rep)
        assert send.call_args.kwargs["csv_attachment"] is None
        grant_export(db, "owner-1", role="Pod Admin")
        report_service.execute_report(db, rep)
        assert send.call_args.kwargs["csv_attachment"] == "a,b\n1,2"


# ── the switch, the live capability and offboarding ─────────────────────────────────────────────────────────────
def test_only_a_super_admin_can_switch_export_on_for_someone(client, client_as_pod_admin, db):
    u = create_test_user(db, email="x@t.com", id="target", role="SDR")
    assert client_as_pod_admin.patch("/api/admin/users/target/settings", json={"export_enabled": True}).status_code == 403
    r = client.patch("/api/admin/users/target/settings", json={"export_enabled": True})
    assert r.status_code == 200 and r.json()["export_enabled"] is True
    db.refresh(u)
    assert u.export_enabled is True
    assert any(x["export_enabled"] for x in client.get("/api/admin/users").json() if x["id"] == "target")


def test_a_super_admin_can_be_blocked_and_unblocked_and_it_bites_at_once(client, db):
    create_test_user(db, email="sa2@t.com", id="sa-two", role="Super Admin")
    assert export_allowed(db, {"sub": "sa-two", "role": "Super Admin"}) is True
    r = client.patch("/api/admin/users/sa-two/settings", json={"export_enabled": False})
    assert r.status_code == 200 and r.json()["export_enabled"] is False
    assert export_allowed(db, {"sub": "sa-two", "role": "Super Admin"}) is False
    row = next(x for x in client.get("/api/admin/users").json() if x["id"] == "sa-two")
    assert row["export_enabled"] is False and row["export_always"] is True
    assert client.patch("/api/admin/users/sa-two/settings", json={"export_enabled": True}).status_code == 200
    assert export_allowed(db, {"sub": "sa-two", "role": "Super Admin"}) is True


def test_a_blocked_super_admin_is_refused_by_the_guard(db):
    u = create_test_user(db, email="sa3@t.com", id="sa-three", role="Super Admin")
    u.export_blocked = True
    db.commit()
    assert export_allowed_for_user_id(db, "sa-three") is False
    from auth import check_export_access
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        check_export_access(db, {"sub": "sa-three", "role": "Super Admin"}, "/x")
    assert e.value.status_code == 403


def test_you_cannot_switch_off_your_own_export(client, db):
    me = _make_user_payload("Super Admin")["sub"]      # the id the `client` fixture acts as
    create_test_user(db, email="me@t.com", id=me, role="Super Admin")
    r = client.patch(f"/api/admin/users/{me}/settings", json={"export_enabled": False})
    assert r.status_code == 400


def test_granting_an_sdr_clears_nothing_else_and_a_block_on_a_demoted_user_is_lifted_by_granting(client, db):
    u = create_test_user(db, email="d@t.com", id="demoted", role="SDR")
    u.export_blocked = True
    db.commit()
    assert export_allowed(db, {"sub": "demoted", "role": "SDR"}) is False
    assert client.patch("/api/admin/users/demoted/settings", json={"export_enabled": True}).status_code == 200
    assert export_allowed(db, {"sub": "demoted", "role": "SDR"}) is True


def test_an_old_report_with_no_owner_is_judged_by_its_sender(db):
    import report_service
    from unittest.mock import patch
    sender = create_test_user(db, email="snd9@t.com", id="sender-9", role="Pod Admin")
    rep = models.ReportConfig(name="Old", enabled=True, components='["key_metrics"]', date_range_rule="previous_7_days", frequency="weekly",
                              weekday=0, timezone="UTC", send_hour=9, send_minute=0, to_recipients='["a@b.com"]',
                              sender_user_id=sender.id, include_csv=True, owner_id=None)
    db.add(rep)
    db.commit()
    with patch.object(report_service, "send_report_email", return_value=True) as send, \
         patch.object(report_service, "build_report_content", return_value=("<p/>", "a,b\n1,2")):
        report_service.execute_report(db, rep)
        assert send.call_args.kwargs["csv_attachment"] is None
        grant_export(db, "sender-9", role="Pod Admin")
        report_service.execute_report(db, rep)
        assert send.call_args.kwargs["csv_attachment"] == "a,b\n1,2"


def test_the_capability_endpoint_tells_the_ui_live(client_as_pod_admin, db):
    assert client_as_pod_admin.get("/api/me/capabilities").json()["export"] is False
    grant_export(db, "pod-admin-id", role="Pod Admin")
    assert client_as_pod_admin.get("/api/me/capabilities").json()["export"] is True


def test_offboarding_switches_export_off(db):
    from services import offboarding
    u = create_test_user(db, email="gone@t.com", id="gone", role="SDR")
    grant_export(db, "gone")
    offboarding.offboard(db, u, "actor")
    db.refresh(u)
    assert u.export_enabled is False


# ── ratchet: no route may hand out a file without the guard ─────────────────────────────────────────────────────
FILE_MARKERS = re.compile(r"Content-Disposition|text/csv|spreadsheetml")
# Not data exports: a file someone attached to a lead / an e-mail (own access checks), served back as-is.
NOT_AN_EXPORT = ("/attachments/{attachment_id}/download", "/attachment/{attachment_id}/download")


def _walk(dep):
    for d in dep.dependencies:
        yield d
        yield from _walk(d)


def _all_routes():
    """Every route of every router module in routes/ — read from the modules, not from main.py (importing main starts the
    app's background schema thread, which fights the test database)."""
    import importlib
    import os
    here = os.path.join(os.path.dirname(os.path.dirname(__file__)), "routes")
    for name in sorted(os.listdir(here)):
        if name.endswith(".py") and not name.startswith("_"):
            mod = importlib.import_module(f"routes.{name[:-3]}")
            router = getattr(mod, "router", None)
            for route in getattr(router, "routes", []):
                yield route


def test_every_route_that_produces_a_file_is_guarded():
    unguarded, seen = [], 0
    for route in _all_routes():
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None or getattr(route, "path", "").endswith(NOT_AN_EXPORT):
            continue
        try:
            src = inspect.getsource(endpoint)
        except (OSError, TypeError):
            continue
        if not FILE_MARKERS.search(src):
            continue
        seen += 1
        guarded = any(d.call is require_export_access for d in _walk(route.dependant)) or "check_export_access" in src
        if not guarded:
            unguarded.append(f"{sorted(route.methods)} {route.path}")
    assert seen >= 8, "the scan found too few file-producing routes — it is probably not looking in the right place"
    assert not unguarded, "these routes produce a CSV/Excel file without require_export_access:\n" + "\n".join(unguarded)
