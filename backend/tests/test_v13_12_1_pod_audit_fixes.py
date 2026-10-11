"""v13.12.1 — Pod Admin cross-pod audit fixes. Each test seeds pod A (the Pod Admin's) and pod B, and checks the Pod Admin
sees/changes only pod A while a Super Admin still sees both (and a pod-less Pod Admin sees nothing)."""
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import access_db
import models
from tests.conftest import _build_test_app, _make_user_payload, create_test_lead, create_test_user, ensure_pods


def _client(db, role, pod="pod-a", uid=None):
    from auth import get_current_user
    from database import get_db, get_ai_db
    app = _build_test_app()
    app.dependency_overrides[get_db] = app.dependency_overrides[get_ai_db] = lambda: db
    payload = _make_user_payload(role, uid or f"p-{role}", f"{(uid or role)[:3].lower()}@p.com", f"{role} P", pod_id=pod)
    app.dependency_overrides[get_current_user] = lambda: payload
    return TestClient(app)


@pytest.fixture()
def world(db):
    ensure_pods(db, "pod-a", "pod-b")
    a = create_test_user(db, email="a@t.com", id="rep-a", name="Rep A", role="SDR", pod_id="pod-a")
    b = create_test_user(db, email="b@t.com", id="rep-b", name="Rep B", role="SDR", pod_id="pod-b")
    for role in ("Pod Admin", "Super Admin"):
        create_test_user(db, email=f"{role[:3].lower()}@p.com", id=f"p-{role}", name=f"{role} P", role=role,
                         pod_id="pod-a" if role == "Pod Admin" else None)
    la = create_test_lead(db, email="la@l.com", pod_id="pod-a", first_name="Alpha", last_name="Lead", phone="+14155550101")
    lb = create_test_lead(db, email="lb@l.com", pod_id="pod-b", first_name="Bravo", last_name="Lead", phone="+14155550102")
    ua = create_test_lead(db, email="ua@l.com", pod_id="pod-a", first_name="Unas", last_name="A", phone="+14155550103")
    ub = create_test_lead(db, email="ub@l.com", pod_id="pod-b", first_name="Unas", last_name="B", phone="+14155550104")
    a.assigned_leads.append(la)
    b.assigned_leads.append(lb)
    db.commit()
    return dict(db=db, la=la, lb=lb, ua=ua, ub=ub)


# ── assignment lists / auto-assign / bulk-assign ─────────────────────────────────────────────────────────────────
def test_unassigned_and_assigned_lists_are_pod_scoped(world):
    db = world["db"]
    pa, sa = _client(db, "Pod Admin"), _client(db, "Super Admin")
    un = {r["email"] for r in pa.get("/api/admin/leads/unassigned").json()["data"]}
    assert "ua@l.com" in un and "ub@l.com" not in un
    assert {"ua@l.com", "ub@l.com"} <= {r["email"] for r in sa.get("/api/admin/leads/unassigned").json()["data"]}
    asg = {r["email"] for r in pa.get("/api/admin/leads/assigned").json()["data"]}
    assert "la@l.com" in asg and "lb@l.com" not in asg


def test_podless_pod_admin_sees_no_leads_in_assignment_lists(world):
    pa = _client(world["db"], "Pod Admin", pod=access_db.NO_POD)
    assert pa.get("/api/admin/leads/unassigned").json()["data"] == []
    assert pa.get("/api/admin/leads/assigned").json()["data"] == []


def test_auto_assign_all_for_a_pod_admin_only_touches_their_pool(world):
    db = world["db"]
    r = _client(db, "Pod Admin").post("/api/admin/assignments/auto-assign-all")
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(models.lead_assignments).filter_by(lead_id=world["ua"].id).count() == 1
    assert db.query(models.lead_assignments).filter_by(lead_id=world["ub"].id).count() == 0     # other pod's pool untouched
    owner = db.query(models.lead_assignments.c.user_id).filter_by(lead_id=world["ua"].id).scalar()
    assert owner == "rep-a"                                                                        # and only to their pod's rep


def test_bulk_assign_to_another_pods_rep_is_refused(world):
    r = _client(world["db"], "Pod Admin").post("/api/admin/assignments/bulk-assign", json={"user_id": "rep-b", "lead_ids": [world["ua"].id]})
    assert r.status_code == 403


def test_podless_pod_admin_cannot_bulk_assign_to_a_podless_user(world):
    db = world["db"]
    create_test_user(db, email="np@t.com", id="rep-np", role="SDR", pod_id=None)
    r = _client(db, "Pod Admin", pod=access_db.NO_POD).post("/api/admin/assignments/bulk-assign", json={"user_id": "rep-np", "lead_ids": [world["ua"].id]})
    assert r.status_code == 403


# ── uploads ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_pod_admin_cannot_seed_another_pod(world):
    r = _client(world["db"], "Pod Admin").post("/api/admin/leads/upload-sheet",
                                               json={"csv": "email\nx@y.com", "mapping": {"email": "email"}, "assign_to_pod_id": "pod-b"})
    assert r.status_code == 403


def test_upload_batches_and_rollback_are_pod_scoped(world):
    db = world["db"]
    log = models.LeadUploadLog(filename="b.csv", total_rows=1, status="completed", uploaded_by="rep-b")
    db.add(log)
    db.flush()
    world["lb"].upload_log_id = log.id
    db.commit()
    pa, sa = _client(db, "Pod Admin"), _client(db, "Super Admin")
    def ids(c):
        body = c.get("/api/admin/leads/upload-batch-metrics").json()
        rows = body if isinstance(body, list) else next((v for v in body.values() if isinstance(v, list)), [])
        return {x.get("id") for x in rows}
    assert log.id in ids(sa)
    assert log.id not in ids(pa)
    assert pa.post(f"/api/admin/leads/upload-logs/{log.id}/rollback").status_code == 404
    assert pa.get(f"/api/admin/leads/upload-batch-metrics/{log.id}/leads?pod_id=pod-b").json().get("total", 0) == 0


# ── users ────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_bulk_user_csv_is_not_for_pod_admins(world):
    csv = "email,name,action\nb@t.com,Rep B,remove\n"
    assert _client(world["db"], "Pod Admin").post("/api/admin/users/upload", json={"csv": csv}).status_code == 403
    assert world["db"].query(models.User).filter_by(id="rep-b").first().left_at is None


def test_pod_admin_cannot_add_an_admin_or_another_pods_rep_to_their_pod(world):
    db = world["db"]
    pa = _client(db, "Pod Admin")
    assert pa.post("/api/pods/pod-a/members", json={"user_id": "p-Super Admin"}).status_code == 403
    assert pa.post("/api/pods/pod-a/members", json={"user_id": "rep-b"}).status_code == 403


# ── activity feed ────────────────────────────────────────────────────────────────────────────────────────────────
def test_activity_feed_ignores_global_view_and_pod_id_for_a_pod_admin(world):
    db = world["db"]
    from tests.conftest import create_test_call
    create_test_call(db, world["la"].id, "rep-a")
    create_test_call(db, world["lb"].id, "rep-b")
    pa = _client(db, "Pod Admin")
    for q in ("", "?global_view=true", "?pod_id=pod-b", "?global_view=true&pod_id=pod-b"):
        body = pa.get("/api/admin/activity-feed" + q + ("&" if q else "?") + "date_range=all").json()
        names = {e["lead_name"] for e in body["data"]}
        assert "Alpha Lead" in names and "Bravo Lead" not in names, (q, names)
    both = _client(db, "Super Admin").get("/api/admin/activity-feed?date_range=all").json()
    assert {"Alpha Lead", "Bravo Lead"} <= {e["lead_name"] for e in both["data"]}


# ── search ───────────────────────────────────────────────────────────────────────────────────────────────────────
def test_search_is_pod_scoped_for_a_pod_admin(world):
    db = world["db"]
    pa, sa = _client(db, "Pod Admin"), _client(db, "Super Admin")
    r = pa.get("/api/search?q=Lead").json()
    assert {l["email"] for l in r["leads"]} == {"la@l.com"}
    assert "rep-b" not in {u["id"] for u in pa.get("/api/search?q=Rep").json()["users"]}
    assert {"rep-a", "rep-b"} <= {u["id"] for u in sa.get("/api/search?q=Rep").json()["users"]}
    assert {l["email"] for l in sa.get("/api/search?q=Lead").json()["leads"]} >= {"la@l.com", "lb@l.com"}


# ── reports ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_reports_are_limited_to_the_pod_admins_own(world):
    db = world["db"]
    mine = models.ReportConfig(name="Mine", components=json.dumps(["kpis"]), owner_id="p-Pod Admin", pod_id="pod-a")
    other = models.ReportConfig(name="Other", components=json.dumps(["kpis"]), owner_id="rep-b", pod_id=None)
    db.add_all([mine, other])
    db.commit()
    pa, sa = _client(db, "Pod Admin"), _client(db, "Super Admin")
    assert {r["name"] for r in pa.get("/api/admin/analytics/reports").json()} == {"Mine"}
    assert {r["name"] for r in sa.get("/api/admin/analytics/reports").json()} >= {"Mine", "Other"}
    for call in (pa.get(f"/api/admin/analytics/reports/{other.id}"), pa.post(f"/api/admin/analytics/reports/{other.id}/run-now"),
                 pa.delete(f"/api/admin/analytics/reports/{other.id}"), pa.get(f"/api/admin/analytics/reports/{other.id}/preview")):
        assert call.status_code == 404
    assert pa.get(f"/api/admin/analytics/reports/{mine.id}").status_code == 200


# ── review queues / errors / performance ────────────────────────────────────────────────────────────────────────
def test_pod_admin_cannot_reject_another_pods_requests(world):
    db = world["db"]
    req = models.DisqualifyRequest(company="B Co", lead_ids=json.dumps([world["lb"].id]), reason="x", requested_by="rep-b", status="pending")
    db.add(req)
    db.commit()
    assert _client(db, "Pod Admin").post(f"/api/disqualify-requests/{req.id}/reject", json={}).status_code == 404
    assert _client(db, "Super Admin").post(f"/api/disqualify-requests/{req.id}/reject", json={}).status_code == 200


def test_sdr_performance_of_a_user_in_another_pod_is_refused(world):
    db = world["db"]
    assert _client(db, "Pod Admin").get("/api/sdr-performance/rep-b").status_code == 403
    assert _client(db, "Pod Admin", pod=access_db.NO_POD).get("/api/sdr-performance/rep-a").status_code == 403


def test_csm_cannot_resolve_error_logs(world):
    db = world["db"]
    err = models.ErrorLog(user_id="rep-b", title="boom")
    db.add(err)
    db.commit()
    assert _client(db, "CSM", uid="csm-1").patch(f"/api/admin/error-logs/{err.id}/resolve", json={}).status_code == 403
    assert _client(db, "Pod Admin").patch(f"/api/admin/error-logs/{err.id}/resolve", json={}).status_code == 404
    assert _client(db, "Super Admin").patch(f"/api/admin/error-logs/{err.id}/resolve", json={}).status_code == 200


def test_ae_pipeline_for_a_pod_admin_shows_only_their_pods_aes(world):
    db = world["db"]
    ae_a = create_test_user(db, email="aea@t.com", id="ae-a", role="AE", pod_id="pod-a")
    ae_b = create_test_user(db, email="aeb@t.com", id="ae-b", role="AE", pod_id="pod-b")
    db.add_all([models.Opportunity(name="Deal A", owner_user_id="ae-a"), models.Opportunity(name="Deal B", owner_user_id="ae-b")])
    db.commit()
    names = lambda role: {o["name"] for o in _client(db, role).get("/api/ae-pipeline/opportunities").json()}
    assert names("Pod Admin") == {"Deal A"} and names("Super Admin") >= {"Deal A", "Deal B"}


def test_update_existing_never_overwrites_another_pods_lead(world):
    db = world["db"]
    csv = "email,first_name\nlb@l.com,Hijacked\n"
    r = _client(db, "Pod Admin").post("/api/admin/leads/upload-sheet", json={
        "csv": csv, "mapping": {"email": "email", "first_name": "first_name"}, "update_existing": True, "filename": "x.csv"})
    assert r.status_code in (200, 400), r.text
    db.expire_all()
    assert db.query(models.Lead).filter_by(id=world["lb"].id).first().first_name == "Bravo"


def test_dialer_skip_summary_is_pod_scoped(world):
    db = world["db"]
    for uid, lead in (("rep-a", world["la"]), ("rep-b", world["lb"])):
        db.add(models.DialerQueueStatus(lead_id=lead.id, user_id=uid, status="skipped", skip_reason="r"))
    db.commit()
    assert {r["user_id"] for r in _client(db, "Pod Admin").get("/api/admin/dialer/skip-summary").json()["by_rep"]} == {"rep-a"}
    assert {r["user_id"] for r in _client(db, "Super Admin").get("/api/admin/dialer/skip-summary").json()["by_rep"]} == {"rep-a", "rep-b"}


def test_search_returns_only_what_the_dropdown_shows(world):
    hit = _client(world["db"], "Super Admin").get("/api/search?q=Alpha").json()["leads"][0]
    assert set(hit) == {"id", "first_name", "last_name", "company", "email", "phone", "phone_secondary", "company_phone"}
