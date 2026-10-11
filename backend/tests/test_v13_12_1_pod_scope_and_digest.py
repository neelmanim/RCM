"""v13.12.1 — a Pod Admin with no pod must see nothing (not everything); per-rep meetings = bookings; the Daily Digest
carries what a team lead asks for every morning (calls, emails, research notes, meetings, lead-wise follow-up)."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import access_db
import models
from tests.conftest import (_build_test_app, _make_user_payload, create_test_booking, create_test_call, create_test_lead, grant_export,
                            create_test_pod, create_test_user, create_pod_admin, ensure_pods)

DAY = datetime(2026, 2, 10, 10, 0, 0, tzinfo=timezone.utc)      # 15:30 IST


@pytest.fixture(autouse=True)
def _fresh_digest_cache():
    from routes import analytics_routes
    analytics_routes._cache.clear()        # the digest is cached per day+pod; tests reuse the same day


def _as(db, payload):
    from auth import get_current_user, require_admin
    from database import get_db, get_ai_db
    app = _build_test_app()
    app.dependency_overrides[get_db] = app.dependency_overrides[get_ai_db] = lambda: db
    app.dependency_overrides[get_current_user] = app.dependency_overrides[require_admin] = lambda: payload
    return TestClient(app)


# ── identity: a Pod Admin without a pod never widens to the whole org ───────────────────────────────────────────
def test_pod_admin_without_a_pod_resolves_to_a_pod_that_matches_nothing(db):
    access_db.forget_identity()
    u = create_test_user(db, email="np@t.com", id="np", role="Pod Admin")
    u.pod_id = None
    access_db.add_allowed_user(db, "np@t.com", "NP", "Pod Admin", "admin")
    db.commit()
    assert access_db.active_identity(db, "np")[2] == access_db.NO_POD


def test_pod_admin_pod_falls_back_to_the_pod_admins_table(db):
    access_db.forget_identity()
    pod = create_test_pod(db, name="India")
    u = create_test_user(db, email="pa@t.com", id="pa", role="Pod Admin")
    u.pod_id = None
    create_pod_admin(db, pod.id, "pa")
    access_db.add_allowed_user(db, "pa@t.com", "PA", "Pod Admin", "admin")
    db.commit()
    assert access_db.active_identity(db, "pa")[2] == pod.id


def test_podless_pod_admin_sees_no_one_in_the_digest_or_activity_monitor(db):
    ensure_pods(db, "some-pod")
    rep = create_test_user(db, email="r@t.com", id="rep", role="SDR", pod_id="some-pod")
    lead = create_test_lead(db, email="l@t.com", pod_id="some-pod")
    create_test_call(db, lead.id, "rep")
    db.add(models.LeadEmailActivity(lead_id=lead.id, user_id="rep", direction="outbound", subject="hi", nylas_thread_id="t1"))
    db.commit()
    c = _as(db, _make_user_payload("Pod Admin", "pa-x", "pax@t.com", "Pod Admin", pod_id=access_db.NO_POD))
    digest = c.get("/api/admin/analytics/daily-digest?date=2026-02-12").json()
    assert digest.get("sdr_snapshot", []) == [] and digest["lead_summary"]["total"] == 0
    r = c.get("/api/admin/email-logs")
    assert r.status_code == 200 and r.json()["items"] == []


# ── digest ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_digest_carries_calls_emails_research_notes_meetings_and_lead_follow_up(client_as_pod_admin, db):
    ensure_pods(db, "test-pod-id", "other-pod-id")
    rep = create_test_user(db, email="in@t.com", id="in-rep", name="Asha Rep", role="SDR", pod_id="test-pod-id")
    other = create_test_user(db, email="out@t.com", id="out-rep", name="Other Rep", role="SDR", pod_id="other-pod-id")
    lead = create_test_lead(db, email="dl@t.com", pod_id="test-pod-id", status="Calling")
    olead = create_test_lead(db, email="ol@t.com", pod_id="other-pod-id")
    create_test_call(db, lead.id, "in-rep", called_at=DAY)
    create_test_call(db, olead.id, "out-rep", called_at=DAY)
    db.add(models.LeadEmailActivity(lead_id=lead.id, user_id="in-rep", direction="outbound", timestamp=DAY))
    db.add(models.Note(lead_id=lead.id, content="Researched: 40 agents, uses Zendesk", author="Asha Rep", created_at=DAY))
    db.add(models.Task(lead_id=lead.id, user_id="in-rep", title="Follow up", done="false",
                       due_time=datetime(2026, 2, 1, tzinfo=timezone.utc)))
    create_test_booking(db, lead, "in-rep", booked_at=DAY)
    db.commit()

    body = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-02-10").json()
    [row] = [r for r in body["sdr_snapshot"] if r["user_id"] == "in-rep"]
    assert (row["calls"], row["emails"], row["research_notes"], row["meetings"]) == (1, 1, 1, 1)
    assert "out-rep" not in {r["user_id"] for r in body["sdr_snapshot"]}
    assert body["kpi"]["calls_made"]["today"] == 1 and body["kpi"]["emails_sent"]["today"] == 1
    assert body["kpi"]["research_notes"]["today"] == 1 and body["kpi"]["meetings_booked"]["today"] == 1
    [la] = client_as_pod_admin.get("/api/admin/analytics/daily-digest/leads?date=2026-02-10").json()["items"]
    assert la["rep"] == "Asha Rep" and la["follow_up"] == "Overdue" and la["meeting_booked"] is True
    assert body["lead_summary"]["total"] == 1 and body["lead_summary"]["overdue"] == 1


def test_digest_day_is_the_pods_own_calendar_day(client_as_pod_admin, db):
    ensure_pods(db, "test-pod-id")
    pod = db.query(models.Pod).filter_by(id="test-pod-id").first()
    pod.timezone = "Asia/Kolkata"
    db.add(pod)
    create_test_user(db, email="ist@t.com", id="ist-rep", role="SDR", pod_id="test-pod-id")
    lead = create_test_lead(db, email="istl@t.com", pod_id="test-pod-id")
    # 22:00 UTC on the 10th is 03:30 IST on the 11th -> belongs to the 11th for an India team
    create_test_call(db, lead.id, "ist-rep", called_at=datetime(2026, 2, 10, 22, 0, tzinfo=timezone.utc))
    db.commit()
    body = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-02-11").json()
    assert body["kpi"]["calls_made"]["today"] == 1 and body["timezone"] == "Asia/Kolkata"


# ── analytics per-rep meetings: the booker, not whoever holds the lead now ──────────────────────────────────────
def test_pod_admin_user_list_includes_their_pods_reps_via_the_pod_admins_table(db):
    pod = create_test_pod(db, name="India")
    create_test_user(db, email="pa2@t.com", id="pa2", role="Pod Admin", pod_id=pod.id)
    create_test_user(db, email="m1@t.com", id="m1", role="SDR", pod_id=pod.id)
    ensure_pods(db, "elsewhere")
    create_test_user(db, email="m2@t.com", id="m2", role="SDR", pod_id="elsewhere")
    c = _as(db, _make_user_payload("Pod Admin", "pa2", "pa2@t.com", "Pod Admin", pod_id=pod.id))
    ids = {u["id"] for u in c.get("/api/admin/users").json()}
    assert "m1" in ids and "m2" not in ids


# ── digest: what a team lead acts on ─────────────────────────────────────────────────────────────────────────────
def _team(db):
    ensure_pods(db, "test-pod-id")
    busy = create_test_user(db, email="busy@t.com", id="busy", name="Busy Rep", role="SDR", pod_id="test-pod-id")
    idle = create_test_user(db, email="idle@t.com", id="idle", name="Idle Rep", role="SDR", pod_id="test-pod-id")
    for u in (busy, idle):                                  # an active person has a sign-in entry; a leaver doesn't
        access_db.add_allowed_user(db, u.email, u.name, "SDR", "admin")
    leads = [create_test_lead(db, email=f"d{i}@t.com", pod_id="test-pod-id", first_name=f"Lead{i}", company=f"Co{i}") for i in range(12)]
    for i, lead in enumerate(leads):
        create_test_call(db, lead.id, "busy", called_at=DAY)
        if i < 3:                                          # three leads have an open follow-up that is already late
            db.add(models.Task(lead_id=lead.id, user_id="busy", title="f", done="false", due_time=datetime(2026, 2, 1, tzinfo=timezone.utc)))
    db.add(models.LeadEmailActivity(lead_id=leads[5].id, user_id="busy", direction="outbound", timestamp=DAY))
    db.commit()
    return leads


def test_digest_keeps_an_idle_rep_and_says_who_needs_attention(client_as_pod_admin, db):
    _team(db)
    body = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-02-10").json()
    rows = {r["user_id"]: r for r in body["sdr_snapshot"]}
    assert rows["idle"]["no_activity"] is True and rows["busy"]["leads_touched"] == 12 and rows["busy"]["overdue_follow_ups"] == 3
    keys = {a["key"]: a for a in body["attention"]}
    assert keys["idle_reps"]["rep_ids"] == ["idle"] and keys["overdue"]["count"] == 3
    assert body["kpi"]["leads_touched"]["today"] == 12 and body["lead_summary"]["overdue"] == 3


def test_digest_leads_page_filter_and_order(client_as_pod_admin, db):
    _team(db)
    get = lambda q="": client_as_pod_admin.get("/api/admin/analytics/daily-digest/leads?date=2026-02-10&per_page=5" + q).json()
    p1, p3 = get("&page=1"), get("&page=3")
    assert p1["total"] == 12 and p1["pages"] == 3 and len(p1["items"]) == 5 and len(p3["items"]) == 2
    assert [r["follow_up"] for r in p1["items"][:3]] == ["Overdue"] * 3                   # overdue first
    assert get("&follow_up=Overdue")["total"] == 3 and get("&activity=emails")["total"] == 1
    assert get("&rep_id=idle")["total"] == 0 and get("&q=lead7")["total"] == 1 and get("&q=co11")["total"] == 1


def test_digest_export_is_one_workbook_with_every_part(client_as_pod_admin, db):
    import io
    import openpyxl
    _team(db)
    grant_export(db, "pod-admin-id", role="Pod Admin")
    r = client_as_pod_admin.get("/api/admin/analytics/daily-digest/export.xlsx?date=2026-02-10")
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Summary", "Team", "Campaigns", "Leads", "Pipeline movement"]
    assert wb["Leads"].max_row == 13 and wb["Team"].max_row == 3                           # header + 12 leads / header + 2 reps


def test_a_date_only_follow_up_task_is_still_judged_overdue(client_as_pod_admin, db):
    ensure_pods(db, "test-pod-id")
    create_test_user(db, email="d1@t.com", id="d1", role="SDR", pod_id="test-pod-id")
    lead = create_test_lead(db, email="dd1@t.com", pod_id="test-pod-id")
    create_test_call(db, lead.id, "d1", called_at=DAY)
    db.add(models.Task(lead_id=lead.id, user_id="d1", title="f", done="false", due_date="2026-02-01"))      # no due_time
    db.commit()
    [row] = client_as_pod_admin.get("/api/admin/analytics/daily-digest/leads?date=2026-02-10").json()["items"]
    assert row["follow_up"] == "Overdue"
