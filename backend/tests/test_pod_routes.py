"""Tests for routes/pod_routes.py — POD CRUD, member management."""
import sys, os
from datetime import datetime, timedelta, timezone
import pytest
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


@pytest.mark.parametrize("action", ["add", "remove"])
def test_pod_membership_change_busts_users_cache(client, db, action):
    # RCA 2026-09-22: /api/admin/users caches for 120s "invalidated on any
    # user write" per its own docstring, but add/remove-member never busted
    # it — a POD reassignment stayed invisible in Control Center/Pods Hub
    # until the cache naturally expired, which is what a hard refresh
    # eventually caught by luck, not because it was actually fixed.
    from unittest.mock import patch
    pod = create_test_pod(db, f"Cache{action.title()}Pod")
    if action == "add":
        user = create_test_user(db, email=f"cache{action}@t.com")
        call = lambda: client.post(f"/api/pods/{pod.id}/members", json={"user_id": user.id})
    else:
        user = create_test_user(db, email=f"cache{action}@t.com", pod_id=pod.id)
        call = lambda: client.delete(f"/api/pods/{pod.id}/members/{user.id}")
    with patch("cache.invalidate") as mock_invalidate:
        resp = call()
    assert resp.status_code == 200
    mock_invalidate.assert_any_call("users")


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


class TestRosterActivityStats:
    """v11.5.7: each member dict now carries active_leads/stale_24h/stale_72h
    for the Pod Management Team Roster drilldown."""

    def test_active_and_stale_buckets(self, client, db):
        pod = create_test_pod(db, "RosterPod")
        sdr = create_test_user(db, email="rostersdr@t.com", role="SDR", pod_id=pod.id)

        fresh = create_test_lead(db, email="fresh@t.com", status="Calling")
        stale_24 = create_test_lead(db, email="stale24@t.com", status="Calling")
        stale_72 = create_test_lead(db, email="stale72@t.com", status="Calling")
        closed = create_test_lead(db, email="closed@t.com", status="Not Interested")

        for lead in (fresh, stale_24, stale_72, closed):
            models.assign_lead(sdr, lead)

        now = datetime.now(timezone.utc)
        stale_24.status_changed_at = now - timedelta(hours=30)
        stale_72.status_changed_at = now - timedelta(hours=90)
        closed.status_changed_at = now - timedelta(hours=200)
        db.commit()

        resp = client.get("/api/pods")
        assert resp.status_code == 200
        pod_data = next(p for p in resp.json() if p["id"] == pod.id)
        member = next(m for m in pod_data["members"] if m["id"] == sdr.id)

        # 3 active-status leads counted, terminal-status lead excluded
        assert member["active_leads"] == 3
        assert member["stale_24h"] == 1
        assert member["stale_72h"] == 1
        # assigned_leads (all-time, any status) is unchanged — still counts all 4
        assert member["assigned_leads"] == 4

    def test_no_members_returns_empty_stats(self, client, db):
        pod = create_test_pod(db, "EmptyRosterPod")
        resp = client.get("/api/pods")
        pod_data = next(p for p in resp.json() if p["id"] == pod.id)
        assert pod_data["members"] == []
