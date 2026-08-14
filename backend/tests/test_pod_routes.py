"""Tests for routes/pod_routes.py — POD CRUD, member management."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import (
    create_test_user, create_test_lead, create_test_pod, create_sync_settings,
)
import models


class TestCreatePod:

    def test_create_pod(self, client, db):
        resp = client.post("/api/pods", json={"name": "Alpha Pod"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Alpha Pod"

    def test_create_pod_missing_name_400(self, client):
        resp = client.post("/api/pods", json={})
        assert resp.status_code == 400

    def test_create_pod_with_admin(self, client, db):
        admin = create_test_user(db, email="newpodadmin@t.com", role="SDR")
        resp = client.post("/api/pods", json={"name": "Beta Pod", "admin_id": admin.id})
        assert resp.status_code == 200
        data = resp.json()
        assert data["admins"][0]["id"] == admin.id
        db.refresh(admin)
        assert admin.role == "Pod Admin"

    def test_create_pod_super_admin_only(self, client_as_pod_admin):
        resp = client_as_pod_admin.post("/api/pods", json={"name": "Denied"})
        assert resp.status_code == 403


class TestListPods:

    def test_list_pods(self, client, db):
        create_test_pod(db, "Pod A")
        create_test_pod(db, "Pod B")
        resp = client.get("/api/pods")
        assert resp.status_code == 200
        assert len(resp.json()) >= 2


class TestUpdatePod:

    def test_update_pod_name(self, client, db):
        pod = create_test_pod(db, "Old Name")
        resp = client.patch(f"/api/pods/{pod.id}", json={"name": "New Name"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    def test_update_nonexistent_pod_404(self, client):
        resp = client.patch("/api/pods/fake-pod-id", json={"name": "Nope"})
        assert resp.status_code == 404

    def test_create_pod_with_timezone(self, client, db):
        resp = client.post("/api/pods", json={"name": "US Pod", "timezone": "America/New_York"})
        assert resp.status_code == 200
        assert resp.json()["timezone"] == "America/New_York"

    def test_create_pod_rejects_unknown_timezone(self, client):
        resp = client.post("/api/pods", json={"name": "Bad TZ Pod", "timezone": "Not/AZone"})
        assert resp.status_code == 422

    def test_update_pod_sets_timezone(self, client, db):
        pod = create_test_pod(db, "TZ Pod")
        resp = client.patch(f"/api/pods/{pod.id}", json={"timezone": "Asia/Kolkata"})
        assert resp.status_code == 200
        assert resp.json()["timezone"] == "Asia/Kolkata"

    def test_update_pod_clears_timezone(self, client, db):
        pod = create_test_pod(db, "TZ Pod 2")
        client.patch(f"/api/pods/{pod.id}", json={"timezone": "Asia/Kolkata"})
        resp = client.patch(f"/api/pods/{pod.id}", json={"timezone": None})
        assert resp.status_code == 200
        assert resp.json()["timezone"] is None

    def test_update_pod_rejects_unknown_timezone(self, client, db):
        pod = create_test_pod(db, "TZ Pod 3")
        resp = client.patch(f"/api/pods/{pod.id}", json={"timezone": "Not/AZone"})
        assert resp.status_code == 422


class TestDeletePod:

    def test_delete_pod_unassigns_members(self, client, db):
        pod = create_test_pod(db, "Del Pod")
        member = create_test_user(db, email="delmem@t.com", pod_id=pod.id)
        resp = client.delete(f"/api/pods/{pod.id}")
        assert resp.status_code == 200
        db.refresh(member)
        assert member.pod_id is None

    def test_delete_nonexistent_pod_404(self, client):
        resp = client.delete("/api/pods/fake-id")
        assert resp.status_code == 404


class TestAddPodMember:

    def test_add_member_to_pod(self, client, db):
        pod = create_test_pod(db, "Add Pod")
        user = create_test_user(db, email="addmem@t.com")
        resp = client.post(f"/api/pods/{pod.id}/members", json={"user_id": user.id})
        assert resp.status_code == 200
        db.refresh(user)
        assert user.pod_id == pod.id

    def test_add_member_already_in_another_pod_blocked(self, client, db):
        pod1 = create_test_pod(db, "Pod1")
        pod2 = create_test_pod(db, "Pod2")
        create_sync_settings(db, allow_multi_pod_sdr=False)
        user = create_test_user(db, email="multi@t.com", pod_id=pod1.id)
        resp = client.post(f"/api/pods/{pod2.id}/members", json={"user_id": user.id})
        assert resp.status_code == 400

    def test_add_member_multi_pod_allowed(self, client, db):
        pod1 = create_test_pod(db, "MPod1")
        pod2 = create_test_pod(db, "MPod2")
        create_sync_settings(db, allow_multi_pod_sdr=True)
        user = create_test_user(db, email="multiy@t.com", pod_id=pod1.id)
        resp = client.post(f"/api/pods/{pod2.id}/members", json={"user_id": user.id})
        assert resp.status_code == 200

    def test_add_nonexistent_user_404(self, client, db):
        pod = create_test_pod(db, "Ghost Pod")
        resp = client.post(f"/api/pods/{pod.id}/members", json={"user_id": "fake-user"})
        assert resp.status_code == 404


class TestRemovePodMember:

    def test_remove_member(self, client, db):
        pod = create_test_pod(db, "RemPod")
        user = create_test_user(db, email="remmem@t.com", pod_id=pod.id)
        resp = client.delete(f"/api/pods/{pod.id}/members/{user.id}")
        assert resp.status_code == 200
        db.refresh(user)
        assert user.pod_id is None

    def test_remove_nonexistent_member_404(self, client, db):
        pod = create_test_pod(db, "RemNoPod")
        resp = client.delete(f"/api/pods/{pod.id}/members/fake-member")
        assert resp.status_code == 404


class TestAssignLeadsToPod:

    def test_assign_leads_to_pod(self, client, db):
        pod = create_test_pod(db, "AssignPod")
        sdr = create_test_user(db, email="podsdr@t.com", role="SDR", pod_id=pod.id)
        lead = create_test_lead(db, email="podlead@t.com")
        resp = client.post(f"/api/pods/{pod.id}/assign-leads", json={"lead_ids": [lead.id]})
        assert resp.status_code == 200
        assert resp.json()["assigned"] >= 1

    def test_assign_to_pod_no_sdrs_400(self, client, db):
        pod = create_test_pod(db, "EmptyPod")
        lead = create_test_lead(db, email="nopodlead@t.com")
        resp = client.post(f"/api/pods/{pod.id}/assign-leads", json={"lead_ids": [lead.id]})
        assert resp.status_code == 400

    def test_assign_empty_lead_ids_400(self, client, db):
        pod = create_test_pod(db, "EmptyLeads")
        resp = client.post(f"/api/pods/{pod.id}/assign-leads", json={"lead_ids": []})
        assert resp.status_code == 400
