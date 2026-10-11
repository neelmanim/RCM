"""
Reassign-request maker-checker (routes/reassign_routes.py), the structured duplicate-lead
409 on POST /leads, and the tag audit rows. Flow: SDR hits "lead already exists" ->
requests reassignment -> Pod Admin (or above) approves/rejects.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_user, create_test_lead
import models


def _owned_lead(db, owner, **kw):
    lead = create_test_lead(db, **kw)
    owner.assigned_leads.append(lead)
    db.commit()
    return lead


def _req(db, lead, requester_id="sdr-user-id", **kw):
    r = models.ReassignRequest(lead_id=lead.id, requested_by=requester_id, **kw)
    db.add(r); db.commit(); db.refresh(r)
    return r


class TestDuplicateLeadResponse:
    def _payload(self, **kw):
        return {"first_name": "Ann", "last_name": "Lee", "company": "Zeta", "email": "ann@zeta.com", **kw}

    def test_409_names_field_status_and_owner(self, client_as_sdr, db):
        owner = create_test_user(db, email="ankit@t.com", name="Ankit Bakshi", id="ankit-id")
        lead = _owned_lead(db, owner, email="ann@zeta.com", first_name="Ann", last_name="Lee", company="Zeta", status="Calling")
        r = client_as_sdr.post("/api/leads", json=self._payload())
        assert r.status_code == 409
        body = r.json()
        assert "email" in body["detail"] and "Ankit Bakshi" in body["detail"] and "Calling" in body["detail"]
        ex = body["existing_lead"]
        assert ex["id"] == lead.id and ex["owners"] == ["Ankit Bakshi"]
        assert ex["owned_by_you"] is False and ex["can_request_reassignment"] is True and ex["matched_on"] == "email"

    def test_409_when_you_already_own_it(self, client_as_sdr, db):
        me = create_test_user(db, email="sdr@test.com", name="SDR User", id="sdr-user-id")
        _owned_lead(db, me, email="ann@zeta.com", first_name="Ann", last_name="Lee", company="Zeta")
        body = client_as_sdr.post("/api/leads", json=self._payload()).json()
        assert "already assigned to you" in body["detail"]
        assert body["existing_lead"]["owned_by_you"] is True and body["existing_lead"]["can_request_reassignment"] is False

    def test_409_unowned_lead_says_ask_admin(self, client_as_sdr, db):
        create_test_lead(db, email="ann@zeta.com", first_name="Ann", last_name="Lee", company="Zeta")
        body = client_as_sdr.post("/api/leads", json=self._payload()).json()
        assert "no owner" in body["detail"] and body["existing_lead"]["owners"] == []

    def test_admin_is_not_offered_a_request(self, client, db):
        owner = create_test_user(db, email="ankit@t.com", name="Ankit Bakshi", id="ankit-id")
        _owned_lead(db, owner, email="ann@zeta.com", first_name="Ann", last_name="Lee", company="Zeta")
        ex = client.post("/api/leads", json=self._payload()).json()["existing_lead"]
        assert ex["can_request_reassignment"] is False

    def test_phone_match_is_labelled(self, client_as_sdr, db):
        create_test_lead(db, email="other@x.com", first_name="Bo", last_name="Kay", company="Q", phone="+91 98765 43210")
        r = client_as_sdr.post("/api/leads", json={"first_name": "New", "last_name": "Person", "company": "Z", "phone": "9876543210"})
        assert r.status_code == 409 and r.json()["existing_lead"]["matched_on"] == "phone number"

    def test_contact_line_appears_when_configured(self, client_as_sdr, db, monkeypatch):
        import config
        monkeypatch.setattr(config, "LEAD_OWNERSHIP_CONTACT", "Neelmani, 99999")
        owner = create_test_user(db, email="ankit@t.com", name="Ankit Bakshi", id="ankit-id")
        _owned_lead(db, owner, email="ann@zeta.com", first_name="Ann", last_name="Lee", company="Zeta")
        assert "Contact: Neelmani, 99999." in client_as_sdr.post("/api/leads", json=self._payload()).json()["detail"]


class TestCreateRequest:
    def test_sdr_can_request_a_lead_someone_else_owns(self, client_as_sdr, db):
        owner = create_test_user(db, email="ankit@t.com", name="Ankit Bakshi", id="ankit-id")
        lead = _owned_lead(db, owner)
        r = client_as_sdr.post("/api/reassign-requests", json={"lead_id": lead.id, "note": "my account"})
        assert r.status_code == 200
        req = db.query(models.ReassignRequest).one()
        assert req.status == "pending" and req.note == "my account"

    def test_duplicate_pending_request_is_409(self, client_as_sdr, db):
        lead = create_test_lead(db)
        assert client_as_sdr.post("/api/reassign-requests", json={"lead_id": lead.id}).status_code == 200
        assert client_as_sdr.post("/api/reassign-requests", json={"lead_id": lead.id}).status_code == 409

    def test_cannot_request_own_lead(self, client_as_sdr, db):
        me = create_test_user(db, email="sdr@test.com", name="SDR User", id="sdr-user-id")
        lead = _owned_lead(db, me)
        assert client_as_sdr.post("/api/reassign-requests", json={"lead_id": lead.id}).status_code == 409

    def test_unknown_or_deleted_lead_is_404(self, client_as_sdr, db):
        assert client_as_sdr.post("/api/reassign-requests", json={"lead_id": "nope"}).status_code == 404
        assert client_as_sdr.post("/api/reassign-requests", json={}).status_code == 404

    def test_admin_is_told_to_assign_directly(self, client, db):
        lead = create_test_lead(db)
        assert client.post("/api/reassign-requests", json={"lead_id": lead.id}).status_code == 400


class TestReview:
    def test_sdr_cannot_list_or_approve(self, client_as_sdr, db):
        lead = create_test_lead(db)
        req = _req(db, lead)
        assert client_as_sdr.get("/api/reassign-requests").status_code in (401, 403)
        assert client_as_sdr.post(f"/api/reassign-requests/{req.id}/approve").status_code in (401, 403)
        assert client_as_sdr.post(f"/api/reassign-requests/{req.id}/reject", json={}).status_code in (401, 403)

    def test_approve_moves_lead_keeps_history_and_notifies(self, client, db):
        old = create_test_user(db, email="ankit@t.com", name="Ankit Bakshi", id="ankit-id")
        new = create_test_user(db, email="sdr@test.com", name="SDR User", id="sdr-user-id")
        lead = _owned_lead(db, old, status="Calling")
        db.add(models.CallLog(lead_id=lead.id, user_id=old.id, outcome="No Answer")); db.commit()
        req = _req(db, lead)

        r = client.post(f"/api/reassign-requests/{req.id}/approve")
        assert r.status_code == 200
        db.refresh(lead); db.refresh(req)
        assert [u.id for u in lead.assigned_users] == [new.id]
        assert lead.status == "Calling"                                   # status untouched
        assert db.query(models.CallLog).filter_by(lead_id=lead.id).count() == 1   # activity kept
        assert req.status == "approved" and req.reviewed_at is not None
        h = db.query(models.LeadFieldHistory).filter_by(lead_id=lead.id, field_name="assigned_to").one()
        assert h.old_value == "Ankit Bakshi" and h.new_value == "SDR User"
        tasks = {t.user_id for t in db.query(models.Task).filter_by(lead_id=lead.id).all()}
        assert tasks == {new.id, old.id}                                  # both told

    def test_double_approve_is_409(self, client, db):
        create_test_user(db, email="sdr@test.com", name="SDR User", id="sdr-user-id")
        req = _req(db, create_test_lead(db))
        assert client.post(f"/api/reassign-requests/{req.id}/approve").status_code == 200
        assert client.post(f"/api/reassign-requests/{req.id}/approve").status_code == 409

    def test_approve_when_requester_deleted_is_409_and_stays_pending(self, client, db):
        req = _req(db, create_test_lead(db), requester_id="ghost")
        assert client.post(f"/api/reassign-requests/{req.id}/approve").status_code == 409
        db.refresh(req); assert req.status == "pending"

    def test_reject_records_reason_and_notifies(self, client, db):
        lead = create_test_lead(db)
        req = _req(db, lead)
        assert client.post(f"/api/reassign-requests/{req.id}/reject", json={"rejection_reason": "Ankit is working it"}).status_code == 200
        db.refresh(req)
        assert req.status == "rejected" and req.rejection_reason == "Ankit is working it"
        assert "Ankit is working it" in db.query(models.Task).filter_by(lead_id=lead.id, user_id="sdr-user-id").one().title
        assert client.post(f"/api/reassign-requests/{req.id}/reject", json={}).status_code == 404   # already reviewed

    def test_list_filters_by_status(self, client, db):
        lead = create_test_lead(db)
        _req(db, lead)
        done = _req(db, create_test_lead(db, email="d@x.com"), requester_id="r2")
        done.status = "approved"; db.commit()
        assert len(client.get("/api/reassign-requests").json()["requests"]) == 1
        assert len(client.get("/api/reassign-requests?status=approved").json()["requests"]) == 1


class TestTagAudit:
    def test_attach_and_detach_write_history(self, client, db):
        lead = create_test_lead(db)
        tag = client.post("/api/tags", json={"name": "India Healthcare"}).json()
        client.post(f"/api/leads/{lead.id}/tags/{tag['id']}")
        client.post(f"/api/leads/{lead.id}/tags/{tag['id']}")           # second attach is a no-op, no second row
        client.delete(f"/api/leads/{lead.id}/tags/{tag['id']}")
        rows = db.query(models.LeadFieldHistory).filter_by(lead_id=lead.id, field_name="tags").order_by(models.LeadFieldHistory.changed_at).all()
        assert [(r.old_value, r.new_value) for r in rows] == [(None, "India Healthcare"), ("India Healthcare", None)]


class TestPodAdminScope:
    def test_pod_admin_sees_only_own_pod_requests(self, client_as_pod_admin, db):
        from conftest import create_test_pod
        pod = create_test_pod(db, name="Mine")
        other = create_test_pod(db, name="Other")
        create_test_user(db, email="pa@t.com", name="PA", role="Pod Admin", id="pod-admin-id", pod_id=pod.id)
        create_test_user(db, email="mine@t.com", name="Mine SDR", id="mine-sdr", pod_id=pod.id)
        create_test_user(db, email="oth@t.com", name="Other SDR", id="other-sdr", pod_id=other.id)
        in_pod = _req(db, create_test_lead(db, email="a@x.com", pod_id=other.id), requester_id="mine-sdr")   # my rep
        mine_lead = _req(db, create_test_lead(db, email="b@x.com", pod_id=pod.id), requester_id="other-sdr")  # my lead
        _req(db, create_test_lead(db, email="c@x.com", pod_id=other.id), requester_id="other-sdr")           # not mine
        ids = {r["id"] for r in client_as_pod_admin.get("/api/reassign-requests").json()["requests"]}
        assert ids == {in_pod.id, mine_lead.id}

    def test_pod_admin_without_pod_sees_nothing(self, client_as_pod_admin, db):
        create_test_user(db, email="pa@t.com", name="PA", role="Pod Admin", id="pod-admin-id")
        _req(db, create_test_lead(db))
        assert client_as_pod_admin.get("/api/reassign-requests").json()["requests"] == []


class TestLeadSearchFullName:
    def test_first_and_last_typed_together_finds_the_lead(self, client, db):
        create_test_lead(db, first_name="Gopala", last_name="Tale", email="g@x.com")
        create_test_lead(db, first_name="Gopal", last_name="Other", email="o@x.com")
        def names(q):
            body = client.get("/api/leads", params={"search": q, "per_page": 20}).json()
            return {(l["first_name"], l["last_name"]) for l in (body if isinstance(body, list) else body["data"])}
        assert names("Gopala Tale") == {("Gopala", "Tale")}
        assert names("gopala tale") == {("Gopala", "Tale")}          # case-insensitive
        assert names("Gopala") == {("Gopala", "Tale")}               # single-word search unchanged
        assert names("Tale") == {("Gopala", "Tale")}
        assert names("Nobody Here") == set()
        assert names("Tale Gopala") == {("Gopala", "Tale")}          # any word order
        assert names("  Gopala   Tale ") == {("Gopala", "Tale")}      # stray spaces

    def test_each_word_can_hit_a_different_column(self, client, db):
        create_test_lead(db, first_name="Ann", last_name="Lee", email="ann@zeta.com", company="Zeta Corp")
        create_test_lead(db, first_name="Ann", last_name="Ray", email="ann@other.com", company="Other")
        body = client.get("/api/leads", params={"search": "Ann Zeta", "per_page": 20}).json()
        rows = body if isinstance(body, list) else body["data"]
        assert {(l["first_name"], l["last_name"]) for l in rows} == {("Ann", "Lee")}

    def test_phone_search_still_works_with_digits_and_is_skipped_for_names(self, client, db):
        create_test_lead(db, first_name="Bo", last_name="Kay", email="b@x.com", phone="+91 98765 43210")
        def n(q):
            body = client.get("/api/leads", params={"search": q, "per_page": 20}).json()
            return len(body if isinstance(body, list) else body["data"])
        assert n("98765") == 1
        assert n("+91 98765 43210") == 1
        assert n("Bo") == 1
