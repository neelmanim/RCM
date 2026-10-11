"""Team Digest (the Daily Digest generalised): any range, campaigns, the metric catalog, and per-user saved views."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import models
from services import digest_metrics
from tests.conftest import (_build_test_app, _make_user_payload, create_test_booking, create_test_call, create_test_lead,
                            create_test_user, ensure_pods, grant_export)

D1 = datetime(2026, 2, 9, 10, 0, tzinfo=timezone.utc)      # Mon
D2 = datetime(2026, 2, 10, 10, 0, tzinfo=timezone.utc)     # Tue
PRIOR = datetime(2026, 2, 5, 10, 0, tzinfo=timezone.utc)   # Thu, inside the 3 days before Mon..Wed
RANGE = "from=2026-02-09&to=2026-02-11"


@pytest.fixture(autouse=True)
def _fresh_cache():
    from routes import analytics_routes
    analytics_routes._cache.clear()


def _as(db, payload):
    from auth import get_current_user, require_admin
    from database import get_db, get_ai_db
    app = _build_test_app()
    app.dependency_overrides[get_db] = app.dependency_overrides[get_ai_db] = lambda: db
    app.dependency_overrides[get_current_user] = app.dependency_overrides[require_admin] = lambda: payload
    return TestClient(app)


def _sa(db):
    return _as(db, _make_user_payload("Super Admin", "sa", "sa@t.com", "SA"))


def _tag(db, lead, name):
    tag = db.query(models.Tag).filter_by(name=name).first() or models.Tag(name=name)
    db.add(tag)
    db.flush()
    db.execute(models.lead_tags.insert().values(lead_id=lead.id, tag_id=tag.id))
    db.commit()


@pytest.fixture
def world(db):
    ensure_pods(db, "p1", "p2")
    create_test_user(db, email="a@t.com", id="a", name="Asha", role="SDR", pod_id="p1")
    create_test_user(db, email="z@t.com", id="z", name="Zed", role="SDR", pod_id="p2")
    l1 = create_test_lead(db, email="l1@acme.com", company="Acme", pod_id="p1")
    l2 = create_test_lead(db, email="l2@beta.com", company="Beta", pod_id="p1")
    l3 = create_test_lead(db, email="l3@other.com", company="Other", pod_id="p2")
    _tag(db, l1, "US-Partner-FY27Q3")
    create_test_call(db, l1.id, "a", outcome="Interested", called_at=D1)
    create_test_call(db, l1.id, "a", outcome="No Answer", called_at=D2)
    create_test_call(db, l2.id, "a", outcome="No Answer", called_at=D2)
    create_test_call(db, l3.id, "z", outcome="Interested", called_at=D2)
    create_test_call(db, l2.id, "a", outcome="No Answer", called_at=PRIOR)          # only in the comparison window
    m = create_test_booking(db, l1, "a", booked_at=D2)
    m.status, m.held_at = "held", D2
    db.commit()
    return db


# ── ranges ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_range_sums_its_days_and_compares_with_the_range_right_before(world):
    d = _sa(world).get(f"/api/admin/analytics/daily-digest?{RANGE}").json()
    assert (d["mode"], d["from"], d["to"], d["days"]) == ("range", "2026-02-09", "2026-02-11", 3)
    assert (d["compare_from"], d["compare_to"], d["compare_label"]) == ("2026-02-06", "2026-02-08", "the previous 3 days")
    assert d["kpi"]["calls_made"]["today"] == 4 and d["kpi"]["calls_made"]["compare"] == 0
    # the Feb 5 call is before the comparison window (Feb 6-8), so it counts in neither
    assert d["kpi"]["meetings_booked"]["today"] == 1 and d["kpi"]["conversations"]["today"] == 2


def test_the_comparison_window_is_the_same_length(world):
    d = _sa(world).get("/api/admin/analytics/daily-digest?from=2026-02-06&to=2026-02-08").json()      # Fri..Sun
    assert d["compare_from"] == "2026-02-03" and d["compare_to"] == "2026-02-05"
    assert d["kpi"]["calls_made"]["compare"] == 1                                    # the Thursday call


def test_a_single_day_still_compares_with_the_same_weekday_last_week(world):
    d = _sa(world).get("/api/admin/analytics/daily-digest?date=2026-02-10").json()
    assert d["mode"] == "day" and d["days"] == 1 and d["compare_label"] == "same weekday last week"
    one = _sa(world).get("/api/admin/analytics/daily-digest?from=2026-02-10&to=2026-02-10").json()
    assert one["mode"] == "day" and one["kpi"]["calls_made"]["today"] == d["kpi"]["calls_made"]["today"]


@pytest.mark.parametrize("qs", ["from=2026-02-09", "to=2026-02-09", "from=nope&to=2026-02-09", "from=2026-02-11&to=2026-02-09",
                                "from=2026-02-09&to=2999-01-01", "from=2025-01-01&to=2026-02-09"])
def test_bad_ranges_are_a_400(world, qs):
    assert _sa(world).get(f"/api/admin/analytics/daily-digest?{qs}").status_code == 400


def test_the_longest_range_is_92_days_and_today_is_not_allowed(world):
    c = _sa(world)
    assert c.get("/api/admin/analytics/daily-digest?from=2026-01-01&to=2026-04-02").status_code == 200      # 92 days
    assert c.get("/api/admin/analytics/daily-digest?from=2026-01-01&to=2026-04-03").status_code == 400      # 93
    today = datetime.now(timezone.utc).date().isoformat()
    assert c.get(f"/api/admin/analytics/daily-digest?from=2026-02-09&to={today}").status_code == 400


def test_a_pod_admin_only_ever_sees_their_pod_in_a_range(world):
    pa = _as(world, _make_user_payload("Pod Admin", "pa", "pa@t.com", "PA", pod_id="p1"))
    d = pa.get(f"/api/admin/analytics/daily-digest?{RANGE}&pod_id=p2").json()
    assert {r["user_id"] for r in d["sdr_snapshot"]} == {"a"}
    assert d["kpi"]["calls_made"]["today"] == 3


# ── the metric catalog ──────────────────────────────────────────────────────────────────────────────────────────
def test_every_catalog_metric_is_in_the_response_with_its_comparison(world):
    d = _sa(world).get(f"/api/admin/analytics/daily-digest?{RANGE}").json()
    assert [c["key"] for c in d["catalog"]] == digest_metrics.KEYS and d["default_kpis"] == digest_metrics.DEFAULT_KEYS
    for key in digest_metrics.KEYS:
        assert set(d["kpi"][key]) == {"today", "compare", "delta_pct"}, key
    k = d["kpi"]
    assert (k["meetings_held"]["today"], k["no_shows"]["today"], k["accounts_given"]["today"]) == (1, 0, 0)


def test_catalog_keys_are_unique_and_the_default_five_exist():
    assert len(set(digest_metrics.KEYS)) == len(digest_metrics.KEYS)
    assert set(digest_metrics.DEFAULT_KEYS) <= set(digest_metrics.KEYS)


# ── campaigns ───────────────────────────────────────────────────────────────────────────────────────────────────
def test_campaigns_say_what_was_worked_per_tag_and_never_hide_untagged_leads(world):
    d = _sa(world).get(f"/api/admin/analytics/daily-digest?{RANGE}").json()
    rows = {c["campaign"]: c for c in d["campaigns"]}
    assert rows["US-Partner-FY27Q3"]["leads_touched"] == 1 and rows["US-Partner-FY27Q3"]["calls"] == 2
    assert rows["US-Partner-FY27Q3"]["meetings_booked"] == 1
    assert rows["No campaign"]["leads_touched"] == 2                                  # l2 and l3
    assert "US-Partner-FY27Q3" in d["campaign_options"] and "No campaign" in d["campaign_options"]


def test_the_lead_list_carries_a_campaign_and_can_be_filtered_by_it(world):
    c = _sa(world)
    items = c.get(f"/api/admin/analytics/daily-digest/leads?{RANGE}&per_page=50").json()["items"]
    assert {i["campaign"] for i in items} == {"US-Partner-FY27Q3", "No campaign"}
    only = c.get(f"/api/admin/analytics/daily-digest/leads?{RANGE}&campaign=US-Partner-FY27Q3").json()
    assert only["total"] == 1 and only["items"][0]["campaign"] == "US-Partner-FY27Q3"
    none = c.get(f"/api/admin/analytics/daily-digest/leads?{RANGE}&campaign=No campaign").json()
    assert none["total"] == 2


# ── export ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_excel_export_follows_the_period_and_has_a_campaigns_sheet(world):
    import io
    import openpyxl
    r = _sa(world).get(f"/api/admin/analytics/daily-digest/export.xlsx?{RANGE}")
    assert r.status_code == 200 and "team-digest-2026-02-09-2026-02-11.xlsx" in r.headers["content-disposition"]
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Summary", "Team", "Campaigns", "Leads", "Pipeline movement"]
    assert [c.value for c in wb["Leads"][1]][3] == "Campaign"
    summary = {row[0].value: row[1].value for row in wb["Summary"].iter_rows(min_row=4) if row[0].value}
    assert summary["Calls"] == 4 and summary["Conversations"] == 2


# ── saved views ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_digest_views_are_kept_apart_from_leads_views_and_per_person(db):
    me = _as(db, _make_user_payload("Super Admin", "u1", "u1@t.com", "U1"))
    other = _as(db, _make_user_payload("Super Admin", "u2", "u2@t.com", "U2"))
    create_test_user(db, email="u1@t.com", id="u1")
    create_test_user(db, email="u2@t.com", id="u2")
    r = me.post("/api/me/saved-views", json={"scope": "digest", "name": "Mine", "keys": ["meetings_booked", "calls_made"], "filters": {"period": "last7"}})
    assert r.status_code == 200 and r.json()["keys"] == ["meetings_booked", "calls_made"] and r.json()["filters"] == {"period": "last7"}
    me.post("/api/me/saved-views", json={"name": "A leads view", "filters": {"status": ["Calling"]}, "keys": ["status"]})
    assert [v["name"] for v in me.get("/api/me/saved-views?scope=digest").json()["views"]] == ["Mine"]
    assert [v["name"] for v in me.get("/api/me/saved-views").json()["views"]] == ["A leads view"]          # default scope = leads
    assert other.get("/api/me/saved-views?scope=digest").json()["views"] == []


@pytest.mark.parametrize("body,status", [
    ({"scope": "digest", "name": "", "keys": ["calls_made"]}, 400),
    ({"scope": "digest", "name": "x", "keys": []}, 400),
    ({"scope": "digest", "name": "x", "keys": ["calls_made", "calls_made"]}, 400),
    ({"scope": "digest", "name": "x", "keys": ["not_a_metric"]}, 400),
    ({"scope": "digest", "name": "x", "keys": ["calls_made"], "filters": {"period": "forever"}}, 400),
    ({"scope": "weird", "name": "x", "keys": ["calls_made"]}, 400),
])
def test_bad_digest_views_are_refused(db, body, status):
    create_test_user(db, email="u1@t.com", id="u1")
    c = _as(db, _make_user_payload("Super Admin", "u1", "u1@t.com", "U1"))
    assert c.post("/api/me/saved-views", json=body).status_code == status


def test_a_digest_view_name_is_unique_per_person_and_capped(db):
    create_test_user(db, email="u1@t.com", id="u1")
    c = _as(db, _make_user_payload("Super Admin", "u1", "u1@t.com", "U1"))
    ok = {"scope": "digest", "name": "Same", "keys": ["calls_made"]}
    assert c.post("/api/me/saved-views", json=ok).status_code == 200
    assert c.post("/api/me/saved-views", json=ok).status_code == 409
    assert c.post("/api/me/saved-views", json={**ok, "scope": "leads", "filters": {"a": 1}, "keys": ["a"]}).status_code == 200   # same name, other kind
    for i in range(29):
        assert c.post("/api/me/saved-views", json={**ok, "name": f"v{i}"}).status_code == 200
    assert c.post("/api/me/saved-views", json={**ok, "name": "one too many"}).status_code == 400


def test_a_view_can_only_be_deleted_by_its_owner(db):
    create_test_user(db, email="u1@t.com", id="u1")
    create_test_user(db, email="u2@t.com", id="u2")
    me = _as(db, _make_user_payload("Super Admin", "u1", "u1@t.com", "U1"))
    other = _as(db, _make_user_payload("Super Admin", "u2", "u2@t.com", "U2"))
    vid = me.post("/api/me/saved-views", json={"scope": "digest", "name": "Mine", "keys": ["calls_made"]}).json()["id"]
    assert other.delete(f"/api/me/saved-views/{vid}").status_code == 404
    assert me.delete(f"/api/me/saved-views/{vid}").status_code == 200
