"""Team Digest drill-downs (services/segments.py + /daily-digest/breakdown|accounts|calls + /icp): the classification rules,
that the numbers add up to the Digest's own, who may see which pod, and the ICP setting with its audit line."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import models
from services import segments
from tests.conftest import (_build_test_app, _make_user_payload, create_test_booking, create_test_call, create_test_lead,
                            create_test_user, ensure_pods)

D = datetime(2026, 2, 10, 10, 0, tzinfo=timezone.utc)
Q = "?from=2026-02-09&to=2026-02-11"
B = "/api/admin/analytics/daily-digest"


@pytest.fixture(autouse=True)
def _fresh_caches():
    from routes import analytics_digest_routes as r, analytics_routes
    analytics_routes._cache.clear()
    r._BASE.clear()
    yield


def _as(db, payload):
    from auth import get_current_user, require_admin, require_super_admin
    from database import get_db, get_ai_db
    app = _build_test_app()
    app.dependency_overrides[get_db] = app.dependency_overrides[get_ai_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: payload
    app.dependency_overrides[require_admin] = lambda: payload
    if payload["role"] == "Super Admin":
        app.dependency_overrides[require_super_admin] = lambda: payload
    return TestClient(app)


def _super(db):
    return _as(db, _make_user_payload("Super Admin", "sa", "sa@t.com", "SA"))


def _lead(db, email, **cols):
    lead = create_test_lead(db, email=email, company=cols.pop("company", email))
    for k, v in cols.items():
        setattr(lead, k, v)
    db.commit()
    return lead


# ── the rules ───────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("title,level,fn", [
    ("Chief Medical Officer", "C-suite / Owner", "Clinical / Medical"),
    ("Vice President, Operations", "VP", "Operations / Admin"),
    ("Director of IT", "Director / Head", "IT / Digital"),
    ("Head of Revenue Cycle", "Director / Head", "Finance"),
    ("Nurse Manager", "Manager", "Clinical / Medical"),
    ("Account Executive", "Individual contributor", "Sales / Marketing"),
    ("Procurement Analyst", "Individual contributor", "Procurement / Supply"),
    ("Founder & CEO", "C-suite / Owner", "General management"),
    ("Wizard", "Other", "Other"),
    ("", segments.NOT_FILLED, segments.NOT_FILLED),
    (None, segments.NOT_FILLED, segments.NOT_FILLED),
])
def test_title_rules(title, level, fn):
    assert segments.seniority(title) == level and segments.function(title) == fn


def test_country_size_and_icp_rules():
    assert [segments.country(c) for c in ("USA", "us", "U.K.", "india", " Canada ", "", None)] == [
        "United States", "United States", "United Kingdom", "India", "Canada", segments.NOT_FILLED, segments.NOT_FILLED]
    assert [segments.company_size(n) for n in (None, 0, 5, 50, 51, 5000, 5001)] == [
        segments.NOT_FILLED, segments.NOT_FILLED, "1-10", "11-50", "51-200", "1,001-5,000", "5,000+"]

    class L:
        industry, research_industry = "Hospital & Health Care", None
    assert segments.icp_fit(L, ["health"]) == "In ICP" and segments.icp_fit(L, ["bank"]) == "Outside ICP"
    L.industry = None
    assert segments.icp_fit(L, ["health"]) == "Industry not filled in"


# ── the numbers ─────────────────────────────────────────────────────────────────────────────────────────────────
def _team(db):
    ensure_pods(db, "p1", "p2")
    create_test_user(db, email="a@t.com", id="a", role="SDR", pod_id="p1")
    create_test_user(db, email="c@t.com", id="c", role="SDR", pod_id="p2")
    hc = _lead(db, "h1@stmary.org", company="St Mary Hospital", industry="Hospital & Health Care", country="USA", city="boston", title="Chief Medical Officer", employee_count=800, pod_id="p1")
    hc2 = _lead(db, "h2@stmary.org", company="St Mary Hospital", industry="Healthcare", country="United States", city="Boston", title="Director of IT", pod_id="p1")
    bank = _lead(db, "b1@bigbank.com", company="Big Bank", industry="Banking", country="India", title="", pod_id="p1")
    other_pod = _lead(db, "o1@elsewhere.org", company="Elsewhere", industry="Healthcare", country="Canada", pod_id="p2")
    return hc, hc2, bank, other_pod


def _work(db, hc, hc2, bank, other_pod):
    create_test_call(db, hc.id, "a", outcome="Interested", called_at=D)
    create_test_call(db, hc.id, "a", outcome="No Answer", called_at=D)
    create_test_call(db, hc2.id, "a", outcome="No Answer", called_at=D)
    create_test_call(db, bank.id, "a", outcome="No Answer", called_at=D)
    create_test_call(db, other_pod.id, "c", outcome="Interested", called_at=D)
    create_test_booking(db, hc, "a", booked_at=D)


def test_breakdown_groups_the_same_activity_the_digest_counts(db):
    leads = _team(db)
    _work(db, *leads)
    c = _super(db)
    r = c.get(f"{B}/breakdown{Q}&dimension=icp").json()
    rows = {x["label"]: x for x in r["rows"]}
    assert rows["In ICP"]["leads"] == 3 and rows["In ICP"]["calls"] == 4 and rows["In ICP"]["conversations"] == 2 and rows["In ICP"]["booked"] == 1
    assert rows["Outside ICP"]["calls"] == 1
    assert r["total"]["calls"] == 5 and r["total"]["booked"] == 1          # the per-segment rows add up to the total
    assert sum(x["calls"] for x in r["rows"]) == r["total"]["calls"]
    cc = {x["label"]: x["leads"] for x in c.get(f"{B}/breakdown{Q}&dimension=country").json()["rows"]}
    assert cc == {"United States": 2, "India": 1, "Canada": 1}               # USA and United States are one country
    city = c.get(f"{B}/breakdown{Q}&dimension=city").json()["rows"]
    assert {x["label"] for x in city} >= {"Boston, United States"} and next(x for x in city if x["label"] == "Boston, United States")["leads"] == 2


def test_missing_values_are_shown_last_and_counted_in_coverage(db):
    _work(db, *_team(db))
    r = _super(db).get(f"{B}/breakdown{Q}&dimension=seniority").json()
    assert r["rows"][-1]["label"] == segments.NOT_FILLED
    assert r["coverage"]["leads"] == 4 and r["coverage"]["filled"] == 2 and r["coverage"]["pct"] == 50


def test_breakdown_rejects_an_unknown_dimension_and_a_future_day(db):
    c = _super(db)
    assert c.get(f"{B}/breakdown{Q}&dimension=shoe_size").status_code == 400
    assert c.get(f"{B}/breakdown?from=2099-01-01&to=2099-01-02").status_code == 400


def test_a_pod_admin_only_sees_their_own_pod(db):
    _work(db, *_team(db))
    pa = _as(db, _make_user_payload("Pod Admin", "pa", "pa@t.com", "PA", pod_id="p2"))
    r = pa.get(f"{B}/breakdown{Q}&dimension=country&pod_id=p1").json()          # asking for another pod changes nothing
    assert [x["label"] for x in r["rows"]] == ["Canada"]
    assert pa.get(f"{B}/accounts{Q}").json()["summary"]["accounts"] == 1
    assert pa.get(f"{B}/calls{Q}").json()["total"] == 1


def test_an_sdr_is_refused_everywhere(client_as_sdr):
    for path in ("breakdown", "accounts", "calls"):
        assert client_as_sdr.get(f"{B}/{path}{Q}").status_code == 403
    assert client_as_sdr.put("/api/admin/analytics/icp", json={"keywords": ["x"]}).status_code == 403


def test_accounts_group_people_under_one_company_and_name_where_it_stands(db):
    _work(db, *_team(db))
    r = _super(db).get(f"{B}/accounts{Q}").json()
    mary = next(x for x in r["rows"] if x["account"] == "St Mary Hospital")
    assert mary["people_tried"] == 2 and mary["people_spoke"] == 1 and mary["calls"] == 3 and mary["stage"] == "Meeting booked"
    assert r["summary"]["accounts"] == 3
    assert r["summary"]["stages"]["Tried, not reached"] == 1 and r["summary"]["stages"]["Meeting booked"] == 1


def test_calls_view_counts_outcomes_and_the_hours_that_connect(db):
    _work(db, *_team(db))
    r = _super(db).get(f"{B}/calls{Q}").json()
    assert r["total"] == 5 and r["conversations"] == 2 and r["connect_rate"] == 40.0
    assert {o["outcome"]: o["calls"] for o in r["outcomes"]} == {"Interested": 2, "No Answer": 3}
    assert r["by_hour"] == [{"hour": 10, "calls": 5, "conversations": 2, "connect_rate": 40.0}]


def test_an_empty_period_is_empty_not_an_error(db):
    c = _super(db)
    assert c.get(f"{B}/breakdown{Q}").json()["rows"] == []
    assert c.get(f"{B}/accounts{Q}").json()["rows"] == []
    assert c.get(f"{B}/calls{Q}").json()["total"] == 0


# ── the ICP setting ─────────────────────────────────────────────────────────────────────────────────────────────
def test_icp_defaults_to_healthcare_and_a_change_is_recorded(db):
    c = _super(db)
    assert c.get("/api/admin/analytics/icp").json()["keywords"] == segments.DEFAULT_ICP and "hospital" in segments.DEFAULT_ICP
    r = c.put("/api/admin/analytics/icp", json={"keywords": [" Fintech ", "bank", "BANK"]})
    assert r.status_code == 200 and r.json()["keywords"] == ["fintech", "bank"]
    assert c.get("/api/admin/analytics/icp").json()["keywords"] == ["fintech", "bank"]
    ev = db.query(models.AuditEvent).filter_by(category="setting").all()
    assert len(ev) == 1 and "fintech" in ev[0].summary
    shown = c.get("/api/admin/audit-log?category=setting").json()["items"]          # and the Super Admin can read it back
    assert len(shown) == 1 and "fintech" in shown[0]["summary"]
    c.put("/api/admin/analytics/icp", json={"keywords": ["fintech", "bank"]})        # no change, no new line
    assert db.query(models.AuditEvent).filter_by(category="setting").count() == 1


def test_icp_refuses_empty_or_silly_lists_and_changes_the_breakdown(db):
    _work(db, *_team(db))
    c = _super(db)
    assert c.put("/api/admin/analytics/icp", json={"keywords": []}).status_code == 400
    assert c.put("/api/admin/analytics/icp", json={"keywords": ["x" * 41]}).status_code == 400
    c.put("/api/admin/analytics/icp", json={"keywords": ["bank"]})
    rows = {x["label"]: x["leads"] for x in c.get(f"{B}/breakdown{Q}&dimension=icp").json()["rows"]}
    assert rows == {"In ICP": 1, "Outside ICP": 3}


def test_every_call_the_digest_counts_is_in_the_breakdown_even_without_a_live_lead(db):
    hc, hc2, bank, other = _team(db)
    _work(db, hc, hc2, bank, other)
    ghost = _lead(db, "t@test.org", company="Test Co", is_test=True, pod_id="p1")
    create_test_call(db, ghost.id, "a", outcome="No Answer", called_at=D)
    c = _super(db)
    digest_calls = c.get(f"/api/admin/analytics/daily-digest{Q}").json()["kpi"]["calls_made"]["today"]
    for dim in ("icp", "country", "seniority"):
        r = c.get(f"{B}/breakdown{Q}&dimension={dim}").json()
        assert r["total"]["calls"] == digest_calls == 6
        assert r["rows"][-1]["label"] == segments.NO_LEAD and r["rows"][-1]["leads"] == 0


# ── conversion, comparison, junk titles, the Excel file ────────────────────────────────────────────────────────
PREV = datetime(2026, 2, 7, 10, 0, tzinfo=timezone.utc)          # inside the 3 days right before Q (Feb 6-8)


def test_junk_values_in_the_title_box_are_not_job_titles():
    for t in ("india", "[Not provided]", "N/A", "other", "No longer employed", "do not contact"):
        assert segments.seniority(t) == segments.NOT_FILLED and segments.function(t) == segments.NOT_FILLED
    assert segments.function("Patient Navigator") == "Patient services"
    assert segments.function("Practice Manager") == "Operations / Admin"
    assert segments.function("Chief Information Officer") == "IT / Digital"
    assert segments.seniority("Chairman") == "C-suite / Owner"


def test_conversion_columns_are_computed_from_the_same_counts(db):
    hc, hc2, bank, other = _team(db)
    _work(db, hc, hc2, bank, other)
    create_test_call(db, hc2.id, "a", outcome="Interested", called_at=D)       # a second lead spoken to in ICP
    r = _super(db).get(f"{B}/breakdown{Q}&dimension=icp&compare=false").json()
    icp = next(x for x in r["rows"] if x["label"] == "In ICP")
    assert (icp["leads"], icp["leads_spoken_to"], icp["lead_to_conversation"]) == (3, 3, 100.0)        # hc, hc2 and the other pod's lead all spoke
    assert icp["conversations"] == 3 and icp["booked"] == 1 and icp["booked_per_100_conversations"] == round(100 / 3, 1)
    out = next(x for x in r["rows"] if x["label"] == "Outside ICP")
    assert out["leads_spoken_to"] == 0 and out["lead_to_conversation"] == 0 and out["booked_per_100_conversations"] == 0     # no divide-by-zero
    assert "prev" not in icp and r["compared"] is False


def test_previous_period_figures_sit_beside_each_segment(db):
    hc, hc2, bank, other = _team(db)
    _work(db, hc, hc2, bank, other)
    create_test_call(db, hc.id, "a", outcome="Interested", called_at=PREV)
    create_test_call(db, hc.id, "a", outcome="No Answer", called_at=PREV)
    create_test_call(db, bank.id, "a", outcome="No Answer", called_at=PREV)
    create_test_call(db, other.id, "c", outcome="No Answer", called_at=datetime(2026, 2, 7, 11, 0, tzinfo=timezone.utc))
    r = _super(db).get(f"{B}/breakdown{Q}&dimension=icp").json()
    assert r["compared"] is True and "previous 3 days" in r["compare_label"]
    rows = {x["label"]: x for x in r["rows"]}
    assert rows["In ICP"]["prev"]["calls"] == 3 and rows["In ICP"]["delta"]["calls"] == round(100 * (4 - 3) / 3, 1)      # other pod's lead is ICP too
    assert rows["Outside ICP"]["prev"]["calls"] == 1 and rows["Outside ICP"]["delta"]["calls"] == 0.0
    assert r["total"]["prev"]["calls"] == 4 and r["total"]["delta"]["calls"] == 25.0


def test_a_segment_that_only_had_activity_last_period_still_appears_and_a_new_one_says_new(db):
    hc, hc2, bank, other = _team(db)
    create_test_call(db, bank.id, "a", outcome="No Answer", called_at=PREV)           # Banking: before only
    create_test_call(db, hc.id, "a", outcome="No Answer", called_at=D)                 # Healthcare: now only
    r = _super(db).get(f"{B}/breakdown{Q}&dimension=industry").json()
    rows = {x["label"]: x for x in r["rows"]}
    assert rows["Banking"]["calls"] == 0 and rows["Banking"]["prev"]["calls"] == 1 and rows["Banking"]["delta"]["calls"] == -100.0
    assert rows["Hospital & Health Care"]["delta"]["calls"] == "new"
    assert rows["Banking"]["leads"] == 0 and rows["Banking"]["lead_to_conversation"] == 0          # an empty row never divides by zero


def test_nothing_in_either_period_gives_no_change_not_an_error(db):
    _team(db)
    r = _super(db).get(f"{B}/breakdown{Q}&dimension=icp").json()
    assert r["rows"] == [] and r["total"]["delta"]["calls"] is None and r["total"]["prev"]["calls"] == 0


def test_a_single_day_compares_with_the_same_weekday_last_week(db):
    hc, *_ = _team(db)
    create_test_call(db, hc.id, "a", outcome="No Answer", called_at=D)                                        # Tue 10 Feb
    create_test_call(db, hc.id, "a", outcome="No Answer", called_at=datetime(2026, 2, 3, 10, tzinfo=timezone.utc))   # Tue 3 Feb
    create_test_call(db, hc.id, "a", outcome="No Answer", called_at=datetime(2026, 2, 9, 10, tzinfo=timezone.utc))   # Mon: not the comparison
    r = _super(db).get(f"{B}/breakdown?date=2026-02-10&dimension=icp").json()
    assert r["total"]["calls"] == 1 and r["total"]["prev"]["calls"] == 1 and "same weekday" in r["compare_label"]


XL = f"{B}/drilldown.xlsx"


def _sheets(resp):
    import io
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    return {ws.title: [[c for c in row] for row in ws.iter_rows(values_only=True)] for ws in wb.worksheets}


def test_the_excel_file_holds_the_same_numbers_as_the_screen_and_is_recorded(db):
    _work(db, *_team(db))
    c = _super(db)
    screen = c.get(f"{B}/breakdown{Q}&dimension=icp").json()
    r = c.get(f"{XL}{Q}&dimension=icp")
    assert r.status_code == 200 and "spreadsheetml" in r.headers["content-type"] and "drilldown" in r.headers["content-disposition"]
    sheets = _sheets(r)
    assert list(sheets) == ["Breakdown", "Accounts", "Calls"]
    head = next(i for i, row in enumerate(sheets["Breakdown"]) if row[0] == "ICP fit")
    body = {row[0]: row for row in sheets["Breakdown"][head + 1:] if row[0]}
    for x in screen["rows"] + [screen["total"]]:
        assert body[x["label"]][1:5] == [x["leads"], x["accounts"], x["calls"], x["conversations"]]
        assert body[x["label"]][16] == x["prev"]["leads"]
    assert any(row[0] == "St Mary Hospital" for row in sheets["Accounts"])
    assert sheets["Calls"][0][1] == 5
    ev = db.query(models.AuditEvent).filter_by(category="export").all()
    assert len(ev) == 1 and ev[0].summary == "Team Digest drill-down (Excel)"


def test_the_excel_file_needs_export_access_and_a_valid_breakdown(db, client_as_sdr):
    assert client_as_sdr.get(f"{XL}{Q}").status_code == 403
    _team(db)
    pa = _as(db, _make_user_payload("Pod Admin", "pa", "pa@t.com", "PA", pod_id="p1"))
    assert pa.get(f"{XL}{Q}").status_code == 403                                  # a Pod Admin only after a Super Admin switches it on
    from tests.conftest import grant_export
    grant_export(db, "pa", role="Pod Admin")
    assert pa.get(f"{XL}{Q}").status_code == 200
    assert _super(db).get(f"{XL}{Q}&dimension=shoe").status_code == 400
    assert db.query(models.AuditEvent).filter_by(category="export").count() == 1       # only the file that was produced; the refusals and the bad request left no record


def test_text_that_looks_like_a_formula_is_neutralised_in_the_file(db):
    ensure_pods(db, "p1")
    lead = _lead(db, "f@evil.org", company="=HYPERLINK(\"http://evil\")", industry="=1+1", pod_id="p1")
    create_test_user(db, email="a@t.com", id="a", role="SDR", pod_id="p1")
    create_test_call(db, lead.id, "a", outcome="No Answer", called_at=D)
    sheets = _sheets(_super(db).get(f"{XL}{Q}&dimension=industry"))
    cells = [c for rows in sheets.values() for row in rows for c in row if isinstance(c, str)]
    assert not any(c.startswith(("=", "+", "-", "@")) for c in cells if c not in ("-",))


# ── the cache ─────────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_repeat_request_is_served_from_the_cache(db):
    hc, hc2, bank, other = _team(db)
    _work(db, hc, hc2, bank, other)
    c = _super(db)
    first = c.get(f"{B}/breakdown{Q}&dimension=country").json()
    create_test_call(db, hc.id, "a", outcome="No Answer", called_at=D)          # arrives after the first read
    assert c.get(f"{B}/breakdown{Q}&dimension=country").json() == first          # same answer inside the cache window, as the Digest does
    from routes import analytics_digest_routes, analytics_routes
    analytics_routes._cache.clear()
    assert c.get(f"{B}/breakdown{Q}&dimension=country").json()["total"]["calls"] == first["total"]["calls"]       # the heavy part is kept a few minutes too
    analytics_digest_routes._BASE.clear()
    analytics_routes._cache.clear()
    assert c.get(f"{B}/breakdown{Q}&dimension=country").json()["total"]["calls"] == first["total"]["calls"] + 1


def test_switching_breakdown_reuses_the_heavy_part_but_each_answer_is_its_own(db):
    _work(db, *_team(db))
    from routes import analytics_digest_routes as r
    c = _super(db)
    seen = []
    real = r._base_memo
    r._base_memo = lambda key, make: (seen.append(key), real(key, make))[1]
    try:
        icp = c.get(f"{B}/breakdown{Q}&dimension=icp").json()
        country = c.get(f"{B}/breakdown{Q}&dimension=country").json()
    finally:
        r._base_memo = real
    assert icp["dimension"] == "icp" and country["dimension"] == "country" and icp["total"] == country["total"]      # same period, same totals
    assert [x["label"] for x in country["rows"]] != [x["label"] for x in icp["rows"]]
    assert len(r._BASE) <= 2 and len(set(seen)) <= 2          # this window and its comparison window, nothing more


def test_the_heavy_cache_never_grows_past_two_windows(db):
    from routes import analytics_digest_routes as r
    _team(db)
    c = _super(db)
    for i in range(6):
        c.get(f"{B}/breakdown?from=2026-01-0{i + 1}&to=2026-01-0{i + 1}&dimension=icp&compare=false")
    assert len(r._BASE) <= r._BASE_KEEP


def test_an_icp_change_shows_at_once_even_though_answers_are_cached(db):
    _work(db, *_team(db))
    c = _super(db)
    before = {x["label"]: x["leads"] for x in c.get(f"{B}/breakdown{Q}&dimension=icp").json()["rows"]}
    assert before["In ICP"] == 3
    c.put("/api/admin/analytics/icp", json={"keywords": ["bank"]})
    after = {x["label"]: x["leads"] for x in c.get(f"{B}/breakdown{Q}&dimension=icp").json()["rows"]}
    assert after == {"In ICP": 1, "Outside ICP": 3}


def test_one_pods_cached_answer_is_never_handed_to_another(db):
    _work(db, *_team(db))
    sa = _super(db).get(f"{B}/breakdown{Q}&dimension=country").json()["total"]["calls"]
    p1 = _as(db, _make_user_payload("Pod Admin", "pa1", "pa1@t.com", "PA1", pod_id="p1")).get(f"{B}/breakdown{Q}&dimension=country").json()["total"]["calls"]
    p2 = _as(db, _make_user_payload("Pod Admin", "pa2", "pa2@t.com", "PA2", pod_id="p2")).get(f"{B}/breakdown{Q}&dimension=country").json()["total"]["calls"]
    again = _super(db).get(f"{B}/breakdown{Q}&dimension=country").json()["total"]["calls"]
    assert (sa, p1, p2, again) == (5, 4, 1, 5)


# ── critical-review additions: ICP words, lead source, thin samples, the leads behind a row, stage filter, time zone ──
@pytest.mark.parametrize("industry,expected", [
    ("Hospital & Health Care", "In ICP"), ("Hospitals & Physicians Clinics", "In ICP"), ("Dental Offices", "In ICP"), ("Medical Devices", "In ICP"),
    ("Medical Practice", "In ICP"), ("Pharmaceuticals", "In ICP"), ("Mental Health Care", "In ICP"), ("Healthcare & Life Sciences", "In ICP"),
    ("Finance", "Outside ICP"), ("Lending & Brokerage", "Outside ICP"), ("Real Estate", "Outside ICP"), ("", "Industry not filled in"),
])
def test_the_default_icp_recognises_the_healthcare_industries_seen_in_real_data(industry, expected):
    class L:
        research_industry = None
    L.industry = industry
    assert segments.icp_fit(L, segments.DEFAULT_ICP) == expected


@pytest.mark.parametrize("raw,kind,batch", [
    ("upload:US Finance - Oct 5 - Jemimah.csv:2026-10-05T16:00:59.984687+00:00", "Uploaded file", "US Finance - Oct 5 - Jemimah.csv"),
    ("upload:Dreamforce 2026 SDR Distribution.xlsx - Himanshu.csv:2026-08-31T14:56:01.630212+00:00", "Uploaded file", "Dreamforce 2026 SDR Distribution.xlsx - Himanshu.csv"),
    ("upload:Weird: name.csv:2026-01-02T03:04:05+00:00", "Uploaded file", "Weird: name.csv"),
    ("gsheet:Google Sheet:2026-04-20T12:04:46.661146+00:00", "Google Sheet", "Google Sheet"),
    ("klenty_sync:2026-07-31", "Klenty sync", "Klenty sync"),
    ("uploaded", "Uploaded file", "Uploaded file"), ("manual", "Manual", "Manual"), ("Manual Dial", "Manual Dial", "Manual Dial"),
    ("", segments.NOT_FILLED, segments.NOT_FILLED), (None, segments.NOT_FILLED, segments.NOT_FILLED),
])
def test_lead_source_groups_by_kind_and_by_file_not_by_timestamp(raw, kind, batch):
    assert segments.source_type(raw) == kind and segments.upload_file(raw) == batch


def test_two_uploads_with_different_timestamps_are_one_file_group(db):
    ensure_pods(db, "p1")
    create_test_user(db, email="a@t.com", id="a", role="SDR", pod_id="p1")
    for i, ts in enumerate(("2026-02-01T10:00:00+00:00", "2026-02-01T10:00:01+00:00")):
        lead = _lead(db, f"x{i}@co{i}.org", company=f"Co{i}", lead_source=f"upload:Finance Leads.csv:{ts}", pod_id="p1")
        create_test_call(db, lead.id, "a", outcome="No Answer", called_at=D)
    c = _super(db)
    assert [(x["label"], x["leads"]) for x in c.get(f"{B}/breakdown{Q}&dimension=batch").json()["rows"]] == [("Finance Leads.csv", 2)]
    assert [(x["label"], x["leads"]) for x in c.get(f"{B}/breakdown{Q}&dimension=source").json()["rows"]] == [("Uploaded file", 2)]


def test_small_samples_are_flagged_so_a_rate_is_not_over_read(db):
    _work(db, *_team(db))
    rows = {x["label"]: x for x in _super(db).get(f"{B}/breakdown{Q}&dimension=icp").json()["rows"]}
    assert rows["In ICP"]["thin"] == {"connect_rate": True, "lead_to_conversation": True, "booked_per_100_conversations": True, "held_rate": True}
    assert _super(db).get(f"{B}/breakdown{Q}&dimension=icp").json()["min_sample"]["connect_rate"] == 30
    ensure_pods(db, "p1")
    big = _lead(db, "big@big.org", company="Big", industry="Healthcare", pod_id="p1")
    for _ in range(31):
        create_test_call(db, big.id, "a", outcome="No Answer", called_at=D)
    from routes import analytics_digest_routes as r
    r._BASE.clear()
    from routes import analytics_routes
    analytics_routes._cache.clear()
    assert next(x for x in _super(db).get(f"{B}/breakdown{Q}&dimension=icp").json()["rows"] if x["label"] == "In ICP")["thin"]["connect_rate"] is False


def test_the_leads_behind_a_row_match_the_row(db):
    hc, hc2, bank, other = _team(db)
    _work(db, hc, hc2, bank, other)
    c = _super(db)
    row = next(x for x in c.get(f"{B}/breakdown{Q}&dimension=icp").json()["rows"] if x["label"] == "In ICP")
    r = c.get(f"{B}/drilldown/leads{Q}&dimension=icp&segment=In ICP").json()
    assert r["total"] == row["leads"] == 3 and r["more"] == 0
    assert (sum(x["calls"] for x in r["rows"]), sum(x["conversations"] for x in r["rows"]), sum(x["booked"] for x in r["rows"])) == (row["calls"], row["conversations"], row["booked"])
    assert r["rows"][0]["booked"] == 1 and r["rows"][0]["company"] == "St Mary Hospital"            # booked first, with its details
    assert {"lead_id", "name", "company", "title", "status"} <= set(r["rows"][0])


def test_the_leads_behind_an_account_and_the_edge_cases(db):
    hc, hc2, bank, other = _team(db)
    _work(db, hc, hc2, bank, other)
    c = _super(db)
    acc = next(x for x in c.get(f"{B}/accounts{Q}").json()["rows"] if x["account"] == "St Mary Hospital")
    r = c.get(f"{B}/drilldown/leads{Q}&account={acc['key']}").json()
    assert r["total"] == acc["people_tried"] == 2
    assert c.get(f"{B}/drilldown/leads{Q}&dimension=icp&segment=No lead on record").json() == {"rows": [], "total": 0, "more": 0}
    assert c.get(f"{B}/drilldown/leads{Q}&dimension=icp&segment=Nope").json()["total"] == 0
    assert c.get(f"{B}/drilldown/leads{Q}&account=nobody.example").json()["total"] == 0
    assert c.get(f"{B}/drilldown/leads{Q}").status_code == 400
    assert c.get(f"{B}/drilldown/leads{Q}&dimension=shoe&segment=x").status_code == 400
    assert c.get(f"{B}/drilldown/leads{Q}&dimension=icp").status_code == 400


def test_the_lead_list_is_capped_and_says_how_many_more(db):
    ensure_pods(db, "p1")
    create_test_user(db, email="a@t.com", id="a", role="SDR", pod_id="p1")
    for i in range(segments.PEOPLE_CAP + 5):
        lead = _lead(db, f"p{i}@co{i}.org", company=f"Co{i}", industry="Healthcare", pod_id="p1")
        create_test_call(db, lead.id, "a", outcome="No Answer", called_at=D)
    r = _super(db).get(f"{B}/drilldown/leads{Q}&dimension=icp&segment=In ICP").json()
    assert len(r["rows"]) == segments.PEOPLE_CAP and r["total"] == segments.PEOPLE_CAP + 5 and r["more"] == 5


def test_a_pod_admin_only_sees_the_leads_of_their_own_pod(db):
    _work(db, *_team(db))
    p2 = _as(db, _make_user_payload("Pod Admin", "pa2", "pa2@t.com", "PA2", pod_id="p2"))
    r = p2.get(f"{B}/drilldown/leads{Q}&dimension=icp&segment=In ICP&pod_id=p1").json()
    assert r["total"] == 1 and r["rows"][0]["company"] == "Elsewhere"
    assert p2.get(f"{B}/drilldown/leads{Q}&account=stmary.org").json()["total"] == 0


def test_an_sdr_cannot_open_the_leads_behind_a_row(client_as_sdr):
    assert client_as_sdr.get(f"{B}/drilldown/leads{Q}&dimension=icp&segment=In ICP").status_code == 403


def test_accounts_can_be_listed_by_stage_without_changing_the_summary(db):
    _work(db, *_team(db))
    c = _super(db)
    allr = c.get(f"{B}/accounts{Q}").json()
    only = c.get(f"{B}/accounts{Q}&stage=Tried, not reached").json()
    assert [x["account"] for x in only["rows"]] == ["Big Bank"] and only["stage"] == "Tried, not reached"
    assert only["summary"] == allr["summary"] and len(allr["rows"]) == 3
    assert [x["account"] for x in c.get(f"{B}/accounts{Q}&stage=Spoke, no meeting").json()["rows"]] == ["Elsewhere"]
    assert c.get(f"{B}/accounts{Q}&stage=Email / notes only").json()["rows"] == []
    assert c.get(f"{B}/accounts{Q}&stage=Nope").status_code == 400


def test_the_hour_view_uses_the_requested_zone_and_ignores_a_bad_one(db):
    _work(db, *_team(db))
    c = _super(db)
    ist = c.get(f"{B}/calls{Q}&tz=Asia/Kolkata").json()
    assert ist["timezone"] == "Asia/Kolkata" and [h["hour"] for h in ist["by_hour"]] == [15] and ist["by_hour"][0]["calls"] == 5     # 10:00 UTC = 15:30 IST
    assert c.get(f"{B}/calls{Q}&tz=Not/AZone").json()["timezone"] == "UTC"
    assert c.get(f"{B}/calls{Q}").json()["by_hour"][0]["hour"] == 10
    db.query(models.Pod).filter_by(id="p1").update({"timezone": "Asia/Tokyo"})
    db.commit()
    pod = _as(db, _make_user_payload("Pod Admin", "pa", "pa@t.com", "PA", pod_id="p1"))
    assert pod.get(f"{B}/calls{Q}&tz=Asia/Kolkata").json()["timezone"] == "Asia/Tokyo"          # a pod's own zone wins over the browser's
