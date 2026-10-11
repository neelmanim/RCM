"""Who may use the v14.3 drill-down, the ICP setting, the drill-down Excel and the audit log - every role, the real role checks
(only the login is faked, so require_admin / require_super_admin / the export rule run exactly as in production)."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import models
from tests.conftest import _build_test_app, _make_user_payload, create_test_booking, create_test_call, create_test_lead, create_test_user, ensure_pods, grant_export

D = datetime(2026, 2, 10, 10, 0, tzinfo=timezone.utc)
Q = "?from=2026-02-09&to=2026-02-11"
B = "/api/admin/analytics/daily-digest"
ROLES = ("Super Admin", "Admin", "Pod Admin", "SDR", "AE", "CSM")


def _as(db, role):
    from auth import get_current_user
    from database import get_db, get_ai_db
    app = _build_test_app()
    app.dependency_overrides[get_db] = app.dependency_overrides[get_ai_db] = lambda: db
    payload = _make_user_payload(role, f"mx-{role}".replace(" ", "-"), f"{role}@t.com".replace(" ", ""), role, pod_id="p1" if role == "Pod Admin" else None)
    app.dependency_overrides[get_current_user] = lambda: payload
    return TestClient(app)


@pytest.fixture
def data(db):
    ensure_pods(db, "p1", "p2")
    create_test_user(db, email="a@t.com", id="a", role="SDR", pod_id="p1")
    create_test_user(db, email="c@t.com", id="c", role="SDR", pod_id="p2")
    mine = create_test_lead(db, email="m@mine.org", company="Mine Co", pod_id="p1")
    theirs = create_test_lead(db, email="t@theirs.org", company="Theirs Co", pod_id="p2")
    mine.industry = theirs.industry = "Healthcare"
    db.commit()
    create_test_call(db, mine.id, "a", outcome="Interested", called_at=D)
    create_test_call(db, theirs.id, "c", outcome="Interested", called_at=D)
    create_test_booking(db, mine, "a", booked_at=D)
    return {"mine": mine, "theirs": theirs}


READS = {"breakdown": f"{B}/breakdown{Q}&dimension=icp", "accounts": f"{B}/accounts{Q}", "calls": f"{B}/calls{Q}",
         "leads behind a row": f"{B}/drilldown/leads{Q}&dimension=icp&segment=In ICP", "ICP words": "/api/admin/analytics/icp"}


@pytest.mark.parametrize("role,ok", [("Super Admin", True), ("Admin", True), ("Pod Admin", True), ("SDR", False), ("AE", False), ("CSM", False)])
@pytest.mark.parametrize("name", list(READS))
def test_who_may_read_the_drilldown(db, data, role, ok, name):
    r = _as(db, role).get(READS[name])
    assert (r.status_code == 200) is ok, f"{role} {name}: {r.status_code}"
    if not ok:
        assert r.status_code == 403


@pytest.mark.parametrize("role,expected", [("Super Admin", 200), ("Admin", 200), ("Pod Admin", 403), ("SDR", 403), ("AE", 403), ("CSM", 403)])
def test_only_a_super_admin_changes_the_icp(db, data, role, expected):
    assert _as(db, role).put("/api/admin/analytics/icp", json={"keywords": ["health"]}).status_code == expected


@pytest.mark.parametrize("role,expected", [("Super Admin", 200), ("Admin", 200), ("Pod Admin", 403), ("SDR", 403), ("AE", 403), ("CSM", 403)])
def test_only_a_super_admin_reads_the_audit_log(db, data, role, expected):
    assert _as(db, role).get("/api/admin/audit-log?category=export,export_access,sf_mapping,setting").status_code == expected


@pytest.mark.parametrize("role", ["Pod Admin", "SDR", "AE", "CSM"])
def test_the_excel_needs_the_export_switch_for_everyone_but_super_admins(db, data, role):
    c = _as(db, role)
    assert c.get(f"{B}/drilldown.xlsx{Q}").status_code == 403                    # export is off by default
    if role == "Pod Admin":
        grant_export(db, f"mx-{role}".replace(" ", "-"), role="Pod Admin")
        assert c.get(f"{B}/drilldown.xlsx{Q}").status_code == 200                # a Super Admin switching it on is enough for a Pod Admin
    else:
        grant_export(db, f"mx-{role}", role=role)
        assert c.get(f"{B}/drilldown.xlsx{Q}").status_code == 403                # the page is admin-only whatever the export switch says


@pytest.mark.parametrize("role", ["Super Admin", "Admin"])
def test_super_admins_download_without_a_switch_unless_blocked(db, data, role):
    c = _as(db, role)
    assert c.get(f"{B}/drilldown.xlsx{Q}").status_code == 200
    u = models.User(id=f"mx-{role}".replace(" ", "-"), email=f"{role}@t.com".replace(" ", ""), name=role, role=role, export_blocked=True)
    db.add(u)
    db.commit()
    assert c.get(f"{B}/drilldown.xlsx{Q}").status_code == 403                    # an explicit block beats even a Super Admin


def test_a_pod_admin_sees_only_their_own_pod_in_every_view_and_cannot_widen_it(db, data):
    sa, pa = _as(db, "Super Admin"), _as(db, "Pod Admin")
    whole = sa.get(f"{B}/breakdown{Q}&dimension=icp").json()["total"]["calls"]
    mine = pa.get(f"{B}/breakdown{Q}&dimension=icp&pod_id=p2").json()["total"]["calls"]          # asking for the other pod changes nothing
    assert (whole, mine) == (2, 1)
    assert pa.get(f"{B}/accounts{Q}&pod_id=p2").json()["summary"]["accounts"] == 1
    assert pa.get(f"{B}/calls{Q}&pod_id=p2").json()["total"] == 1
    assert [x["company"] for x in pa.get(f"{B}/drilldown/leads{Q}&dimension=icp&segment=In ICP&pod_id=p2").json()["rows"]] == ["Mine Co"]
    assert pa.get(f"{B}/drilldown/leads{Q}&account=theirs.org").json()["total"] == 0              # the other pod's company is invisible even by key


def test_a_pod_admin_with_no_pod_sees_nothing_not_everything(db, data):
    from auth import get_current_user
    from database import get_db, get_ai_db
    import access_db
    app = _build_test_app()
    app.dependency_overrides[get_db] = app.dependency_overrides[get_ai_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: _make_user_payload("Pod Admin", "pa0", "pa0@t.com", "PA0", pod_id=access_db.NO_POD)
    c = TestClient(app)
    assert c.get(f"{B}/breakdown{Q}&dimension=icp").json()["total"]["calls"] == 0
    assert c.get(f"{B}/accounts{Q}").json()["rows"] == []
    assert c.get(f"{B}/drilldown/leads{Q}&dimension=icp&segment=In ICP").json()["total"] == 0
