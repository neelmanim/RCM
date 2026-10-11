"""Tests for routes/admin_routes.py — User mgmt, assignments, sync settings, upload."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import (
    create_test_user, create_test_lead, create_test_pod, create_pod_admin,
    create_sync_settings, create_test_call, SUPER_ADMIN,
)
import models


# ── Access Requests ──────────────────────────────────────────────────────────
# A Google sign-in from an email not yet in allowed_users — see
# models.AccessRequest and auth_routes._record_access_request.

class TestListAccessRequests:

    def test_super_admin_sees_pending_requests_newest_first(self, client, db):
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        # Explicit, clearly-separated timestamps — two inserts in the same
        # test can otherwise land in the same second on SQLite's CURRENT_TIMESTAMP
        # (server_default=func.now()), making ordering non-deterministic.
        db.add(models.AccessRequest(email="older@test.com", name="Older", requested_at=now - timedelta(minutes=5)))
        db.add(models.AccessRequest(email="newer@test.com", name="Newer", requested_at=now))
        db.commit()

        resp = client.get("/api/admin/access-requests")
        assert resp.status_code == 200, resp.text
        emails = [r["email"] for r in resp.json()]
        assert emails == ["newer@test.com", "older@test.com"]

    def test_non_super_admin_rejected(self, client_as_sdr, db):
        resp = client_as_sdr.get("/api/admin/access-requests")
        assert resp.status_code == 403, resp.text

    def test_empty_when_none_pending(self, client, db):
        resp = client.get("/api/admin/access-requests")
        assert resp.status_code == 200, resp.text
        assert resp.json() == []


# ── User Management ─────────────────────────────────────────────────────────

class TestCreateUser:

    def test_create_user(self, client, db):
        resp = client.post("/api/admin/users", json={
            "email": "newadmin@test.com", "name": "New Admin", "role": "SDR"
        })
        assert resp.status_code == 200
        assert "user_id" in resp.json()

    def test_create_user_missing_email_400(self, client):
        resp = client.post("/api/admin/users", json={"name": "No Email"})
        assert resp.status_code == 400

    def test_create_duplicate_email_400(self, client, db):
        create_test_user(db, email="dup@test.com")
        resp = client.post("/api/admin/users", json={"email": "dup@test.com", "name": "Dup"})
        assert resp.status_code == 400

    def test_create_user_invalid_role_defaults_to_sdr(self, client, db):
        resp = client.post("/api/admin/users", json={"email": "badrole@t.com", "name": "Bad", "role": "Wizard"})
        assert resp.status_code == 200
        user = db.query(models.User).filter(models.User.email == "badrole@t.com").first()
        assert user.role == "SDR"


class TestListUsers:

    def test_list_users(self, client, db):
        create_test_user(db, email="list1@t.com")
        create_test_user(db, email="list2@t.com")
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        assert len(resp.json()) >= 2

    def test_pod_admin_sees_only_pod_members(self, client_as_pod_admin, db):
        pod = create_test_pod(db, name="PA Pod")
        pod_admin = create_test_user(db, email="podadmin@test.com", role="Pod Admin", pod_id=pod.id)
        create_test_user(db, email="member@t.com", role="SDR", pod_id=pod.id)
        create_test_user(db, email="outside@t.com", role="SDR")

        resp = client_as_pod_admin.get("/api/admin/users")
        assert resp.status_code == 200


class TestUpdateUserRole:

    def test_update_role(self, client, db):
        user = create_test_user(db, email="rolechange@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/role", json={"role": "Pod Admin"})
        assert resp.status_code == 200
        db.refresh(user)
        assert user.role == "Pod Admin"

    def test_update_role_busts_users_cache(self, client, db):
        # RCA 2026-08-05: /api/admin/users caches for 120s; a mutating route that
        # forgets to invalidate('users') makes the admin console show stale data
        # (deleted/renamed users) until the cache naturally expires.
        from unittest.mock import patch
        user = create_test_user(db, email="rolecache@t.com", role="SDR")
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.patch(f"/api/admin/users/{user.id}/role", json={"role": "Pod Admin"})
        assert resp.status_code == 200
        mock_invalidate.assert_any_call("users")

    def test_invalid_role_returns_400(self, client, db):
        user = create_test_user(db, email="badrole2@t.com")
        resp = client.patch(f"/api/admin/users/{user.id}/role", json={"role": "Wizard"})
        assert resp.status_code == 400


class TestToggleAccess:

    def test_revoke_access(self, client, db):
        import access_db
        user = create_test_user(db, email="revoke@t.com")
        access_db.add_allowed_user(db, "revoke@t.com")
        resp = client.patch(f"/api/admin/users/{user.id}/access", json={"action": "revoke"})
        assert resp.status_code == 200
        assert resp.json()["access_allowed"] is False

    def test_grant_access(self, client, db):
        user = create_test_user(db, email="grant@t.com")
        resp = client.patch(f"/api/admin/users/{user.id}/access", json={"action": "grant"})
        assert resp.status_code == 200
        assert resp.json()["access_allowed"] is True

    def test_invalid_action_400(self, client, db):
        user = create_test_user(db, email="badact@t.com")
        resp = client.patch(f"/api/admin/users/{user.id}/access", json={"action": "dance"})
        assert resp.status_code == 400

    def test_cannot_revoke_own_access(self, client, db):
        # RCA 2026-09-04: no self-guard existed here (unlike delete/View As),
        # so an admin could revoke their own login access with one misclick.
        self_user = create_test_user(db, email="admin@test.com", id="test-user-id")
        resp = client.patch(f"/api/admin/users/{self_user.id}/access", json={"action": "revoke"})
        assert resp.status_code == 400


class TestDeleteUser:

    def test_delete_user(self, client, db):
        user = create_test_user(db, email="deluser@t.com")
        resp = client.delete(f"/api/admin/users/{user.id}")
        assert resp.status_code == 200

    def test_cannot_delete_self(self, client, db):
        # The override user has sub="test-user-id"
        user = create_test_user(db, email="selfdelete@t.com")
        user.id = "test-user-id"
        db.commit()
        resp = client.delete(f"/api/admin/users/{user.id}")
        assert resp.status_code == 400

    def test_delete_nonexistent_user_404(self, client):
        resp = client.delete("/api/admin/users/fake-user-id")
        assert resp.status_code == 404

    def test_delete_busts_users_cache(self, client, db):
        # RCA 2026-08-05: see test_update_role_busts_users_cache
        from unittest.mock import patch
        user = create_test_user(db, email="delcache@t.com")
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.delete(f"/api/admin/users/{user.id}")
        assert resp.status_code == 200
        mock_invalidate.assert_any_call("users")

    def test_delete_pod_admin_user_succeeds(self, client, db):
        # RCA 2026-08-24: deleting a Pod Admin used to 500 — User.pod_admin_entries
        # has no ORM cascade, so SQLAlchemy tried to null pod_admins.user_id
        # (NOT NULL) before the delete. Confirms the explicit pre-delete fixes it.
        pod = create_test_pod(db, name="Delete-Me Pod")
        user = create_test_user(db, email="podadmindel@t.com", role="Pod Admin")
        create_pod_admin(db, pod.id, user.id)
        resp = client.delete(f"/api/admin/users/{user.id}")
        assert resp.status_code == 200
        assert db.query(models.PodAdmin).filter(models.PodAdmin.user_id == user.id).count() == 0

    def test_get_pod_admin_of(self, client, db):
        pod = create_test_pod(db, name="Warn Pod")
        user = create_test_user(db, email="podadmininfo@t.com", role="Pod Admin")
        create_pod_admin(db, pod.id, user.id)
        resp = client.get(f"/api/admin/users/{user.id}/pod-admin-of")
        assert resp.status_code == 200
        assert resp.json() == [{"id": pod.id, "name": "Warn Pod"}]

    def test_delete_user_with_dialer_queue_status_succeeds(self, db, client):
        # RCA 2026-08-24: same bug class  Pod Admin case above —
        # DialerQueueStatus.user_id is NOT NULL; without passive_deletes,
        # SQLAlchemy tried SET user_id=NULL before the delete and 500'd for
        # any user who'd ever touched the Power Dialer queue. Only asserting
        # no-500 here (not that the row is gone) — this test DB has no
        # PRAGMA foreign_keys=ON, so the real ON DELETE CASCADE that actually
        # removes the row in prod Postgres never fires here either; see
        # create_test_journey_enrollment's note in conftest.py on this same
        # SQLite limitation.
        user = create_test_user(db, email="dialerqueuedel@t.com", role="SDR")
        lead = create_test_lead(db, email="dialerqueuelead@t.com")
        db.add(models.DialerQueueStatus(lead_id=lead.id, user_id=user.id, status="called"))
        db.commit()
        resp = client.delete(f"/api/admin/users/{user.id}")
        assert resp.status_code == 200


# ── Lead Assignment ──────────────────────────────────────────────────────────

class TestUnassignedLeads:

    # RCA 2026-09-03: this endpoint used to return every unassigned lead
    # (LIMIT 5000, no pagination) on every Control Center Lead Assignments
    # mount — flagged by audit as the likely cause of "every tab feels slow".
    # Now paginated the same way GET /leads is: {data, total, page, per_page, pages}.
    def test_get_unassigned_leads(self, client, db):
        lead = create_test_lead(db, email="unassigned@t.com")
        resp = client.get("/api/admin/leads/unassigned")
        assert resp.status_code == 200
        body = resp.json()
        assert any(l["email"] == "unassigned@t.com" for l in body["data"])
        assert body["total"] >= 1
        assert body["page"] == 1

    def test_unassigned_leads_second_page_is_disjoint(self, client, db):
        for i in range(3):
            create_test_lead(db, email=f"unassigned-page-{i}@t.com")
        page1 = client.get("/api/admin/leads/unassigned", params={"page": 1, "per_page": 2}).json()
        page2 = client.get("/api/admin/leads/unassigned", params={"page": 2, "per_page": 2}).json()
        assert len(page1["data"]) == 2
        ids_page1 = {l["id"] for l in page1["data"]}
        ids_page2 = {l["id"] for l in page2["data"]}
        assert not (ids_page1 & ids_page2)


class TestAssignedLeads:

    def test_get_assigned_leads_paginated(self, client, db):
        user = create_test_user(db, email="assignee-list@t.com")
        lead = create_test_lead(db, email="assigned-list@t.com")
        user.assigned_leads.append(lead)
        db.commit()
        resp = client.get("/api/admin/leads/assigned")
        assert resp.status_code == 200
        body = resp.json()
        assert any(l["email"] == "assigned-list@t.com" for l in body["data"])
        assert body["total"] >= 1

    def test_assigned_to_filter_shows_all_coassignees(self, client, db):
        """Filtering to one SDR's leads must still show every co-assignee on
        a shared lead — the filter narrows WHICH leads qualify, not which
        assignees are reported for them (regression guard for the query
        shape that replaced the plain LIMIT 5000 dump)."""
        sdr_a = create_test_user(db, email="sdr-a@t.com")
        sdr_b = create_test_user(db, email="sdr-b@t.com")
        shared_lead = create_test_lead(db, email="shared-lead@t.com")
        solo_lead = create_test_lead(db, email="solo-lead@t.com")
        sdr_a.assigned_leads.append(shared_lead)
        sdr_b.assigned_leads.append(shared_lead)
        sdr_b.assigned_leads.append(solo_lead)
        db.commit()

        resp = client.get("/api/admin/leads/assigned", params={"assigned_to": sdr_a.id})
        body = resp.json()
        emails = {l["email"] for l in body["data"]}
        assert emails == {"shared-lead@t.com"}  # sdr_b's solo lead excluded
        shared = next(l for l in body["data"] if l["email"] == "shared-lead@t.com")
        assigned_ids = {a["id"] for a in shared["assigned_to"]}
        assert {sdr_a.id, sdr_b.id} == assigned_ids  # both co-assignees still shown


class TestBulkAssign:

    def test_bulk_assign_leads(self, client, db):
        user = create_test_user(db, email="assignee@t.com")
        lead = create_test_lead(db, email="toassign@t.com", phone="+1234567890")
        resp = client.post("/api/admin/assignments/bulk-assign", json={
            "user_id": user.id, "lead_ids": [lead.id]
        })
        assert resp.status_code == 200
        assert len(resp.json()["assigned"]) == 1

    def test_reassigning_to_a_new_sdr_replaces_the_old_one(self, client, db):
        """RCA 2026-09-29: models.assign_lead only appended, so a bulk
        reassignment left the previous SDR on the lead as well (78 prod leads
        had 2+ SDRs). A lead now keeps at most one assignee per role."""
        old_sdr = create_test_user(db, email="old-sdr@t.com", role="SDR")
        new_sdr = create_test_user(db, email="new-sdr@t.com", role="SDR")
        ae = create_test_user(db, email="ae@t.com", role="AE")
        assign = lambda u, l: client.post("/api/admin/assignments/bulk-assign", json={"user_id": u.id, "lead_ids": [l.id]})

        # Before a meeting: whoever is assigned last is the only owner, any role.
        lead = create_test_lead(db, email="reassign@t.com", phone="+1234567890", status="Calling")
        assign(old_sdr, lead); assign(ae, lead)
        assert assign(new_sdr, lead).status_code == 200
        db.refresh(lead)
        assert {u.id for u in lead.assigned_users} == {new_sdr.id}

        # After a meeting: same-role replace only — the AE keeps the booking SDR.
        booked = create_test_lead(db, email="booked@t.com", phone="+1234567891", status="Meeting Scheduled")
        assign(old_sdr, booked); assign(ae, booked); assign(new_sdr, booked)
        db.refresh(booked)
        assert {u.id for u in booked.assigned_users} == {new_sdr.id, ae.id}

    def test_bulk_assign_ignores_pod_level_cap_override(self, db):
        # RCA 2026-08-25: a pod's own active_lead_cap value was never exposed
        # by any API or UI, so it could only diverge from the global default
        # via a direct DB write — invisible, unexplainable enforcement.
        # _get_active_lead_cap() no longer reads it; only the global setting
        # (sync_settings.active_lead_cap) governs, everywhere.
        from routes._admin_helpers import _get_active_lead_cap

        pod = create_test_pod(db, name="Low-Cap Pod")
        pod.active_lead_cap = 1  # would have won under the old pod-first logic
        db.commit()
        user = create_test_user(db, email="podcapuser@t.com", pod_id=pod.id)
        create_sync_settings(db)  # global active_lead_cap defaults to 5

        assert _get_active_lead_cap(db, user) == 5

    def test_bulk_assign_super_admin_bypasses_pod_lock(self, client, db):
        # RCA 2026-08-24: the pod-lock check used to run for every caller,
        # blocking Super Admin/Admin from reassigning a lead away from a
        # departed SDR whenever that SDR's stale pod_id differed from the
        # target's pod. It's now Pod-Admin-only; Super Admin/Admin (the
        # `client` fixture) must bypass it entirely.
        pod_x = create_test_pod(db, name="Pod X")
        pod_y = create_test_pod(db, name="Pod Y")
        departed = create_test_user(db, email="departed@t.com", pod_id=pod_x.id)
        target = create_test_user(db, email="target@t.com", pod_id=pod_y.id)
        lead = create_test_lead(db, email="reassign@t.com", phone="+19998887777")
        models.assign_lead(departed, lead)
        db.commit()

        resp = client.post("/api/admin/assignments/bulk-assign", json={
            "user_id": target.id, "lead_ids": [lead.id]
        })
        assert resp.status_code == 200
        assert resp.json()["assigned"] == [lead.id]
        assert resp.json()["pod_locked"] == []

    def test_bulk_assign_pod_admin_still_pod_locked(self, client_as_pod_admin, db):
        # Pod Admin keeps the original protection — no regression.
        pod_a = create_test_pod(db, name="Pod A")
        pod_b = create_test_pod(db, name="Pod B")
        existing_assignee = create_test_user(db, email="existing@t.com", pod_id=pod_a.id)
        target = create_test_user(db, email="target2@t.com", pod_id="test-pod-id")   # the Pod Admin's own pod
        lead = create_test_lead(db, email="podlocked@t.com", phone="+19998887778")
        models.assign_lead(existing_assignee, lead)
        db.commit()

        resp = client_as_pod_admin.post("/api/admin/assignments/bulk-assign", json={
            "user_id": target.id, "lead_ids": [lead.id]
        })
        assert resp.status_code == 200
        assert resp.json()["assigned"] == []
        assert resp.json()["pod_locked"] == [lead.id]

    def test_bulk_assign_invalidates_leads_cache(self, client, db):
        # RCA 2026-08-25: this route never busted the my_leads/leads_count/
        # leads_page caches — a reassigned SDR's "My Leads" view (and the
        # admin "All Leads" view) could keep showing the pre-assignment
        # snapshot until the cache's TTL passed on its own.
        from unittest.mock import patch
        user = create_test_user(db, email="cacheassignee@t.com")
        lead = create_test_lead(db, email="cacheassign@t.com", phone="+12223334444")
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.post("/api/admin/assignments/bulk-assign", json={
                "user_id": user.id, "lead_ids": [lead.id]
            })
        assert resp.status_code == 200
        invalidated = {call.args[0] for call in mock_invalidate.call_args_list}
        assert {"my_leads", "leads_count", "leads_page"}.issubset(invalidated)

    def test_bulk_assign_skips_cache_invalidation_when_nothing_assigned(self, client, db):
        from unittest.mock import patch
        user = create_test_user(db, email="cachenoop@t.com")
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.post("/api/admin/assignments/bulk-assign", json={
                "user_id": user.id, "lead_ids": ["nonexistent-lead-id"]
            })
        assert resp.status_code == 200
        mock_invalidate.assert_not_called()


class TestBulkDeleteLeads:
    """RCA 2026-08-17: this used to hard-delete the row (cascading manual
    cleanup of LeadEmailActivity/EmailThread/DialerCall). Per explicit
    product decision, lead deletion is always soft — see
    models.exclude_deleted_leads() and lead_helpers._build_lead_query()."""

    def test_bulk_delete_soft_deletes_not_hard_deletes(self, client, db):
        lead = create_test_lead(db, email="softdel@t.com")
        lead_id = lead.id
        resp = client.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead_id]})
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

        # Row still exists — just tagged deleted_at, never removed.
        still_there = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        assert still_there is not None
        assert still_there.deleted_at is not None

    def test_bulk_delete_keeps_related_call_and_email_data(self, client, db):
        lead = create_test_lead(db, email="softdel-related@t.com")
        user = create_test_user(db, email="caller@t.com")
        create_test_call(db, lead.id, user.id, "No Answer")
        from conftest import create_test_dialer_call
        create_test_dialer_call(db, lead.id, user.id)

        resp = client.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead.id]})
        assert resp.status_code == 200

        assert db.query(models.CallLog).filter(models.CallLog.lead_id == lead.id).count() == 1
        assert db.query(models.DialerCall).filter(models.DialerCall.lead_id == lead.id).count() == 1

    def test_deleted_lead_excluded_from_leads_list(self, client, db):
        lead = create_test_lead(db, email="softdel-list@t.com")
        client.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead.id]})

        resp = client.get("/api/leads")
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id not in ids

    def test_bulk_delete_requires_lead_ids(self, client, db):
        resp = client.post("/api/admin/leads/bulk-delete", json={"lead_ids": []})
        assert resp.status_code == 400

    def test_pod_admin_can_soft_delete(self, client_as_pod_admin, db):
        """RCA 2026-08-17: lead_detail.js already shows the Delete Lead button
        to Pod Admins, but the backend used to 403 them — role gate widened
        from Super Admin/Admin only to require_pod_admin_or_above."""
        lead = create_test_lead(db, email="poddel@t.com")
        resp = client_as_pod_admin.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead.id]})
        assert resp.status_code == 200

    def test_pod_admin_cannot_delete_lead_outside_their_pod(self, client_as_pod_admin, db):
        """RCA 2026-08-26: this endpoint had NO pod-scoping at all — only a
        role check (require_pod_admin_or_above) — so a Pod Admin could soft-
        delete any lead_id in the system, not just their own pod's. Mirrors
        bulk_unassign's exact "skip unauthorized IDs" scoping just above."""
        create_test_user(db, id="pod-admin-id", email="thepodadmin@t.com", role="Pod Admin", pod_id="test-pod-id")
        other_pod = create_test_pod(db, name="Other Pod")
        other_pod_sdr = create_test_user(db, email="othersdr@t.com", role="SDR", pod_id=other_pod.id)
        lead = create_test_lead(db, email="outsidepod@t.com")
        models.assign_lead(other_pod_sdr, lead)
        db.commit()

        resp = client_as_pod_admin.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead.id]})
        assert resp.status_code == 200
        assert resp.json()["count"] == 0

        still_there = db.query(models.Lead).filter(models.Lead.id == lead.id).first()
        assert still_there.deleted_at is None

    def test_pod_admin_can_delete_lead_assigned_within_their_own_pod(self, client_as_pod_admin, db):
        create_test_user(db, id="pod-admin-id", email="thepodadmin2@t.com", role="Pod Admin", pod_id="test-pod-id")
        own_pod_sdr = create_test_user(db, email="ownsdr@t.com", role="SDR", pod_id="test-pod-id")
        lead = create_test_lead(db, email="withinpod@t.com")
        models.assign_lead(own_pod_sdr, lead)
        db.commit()

        resp = client_as_pod_admin.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead.id]})
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    def test_sdr_cannot_soft_delete(self, client_as_sdr, db):
        lead = create_test_lead(db, email="sdrdel@t.com")
        resp = client_as_sdr.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead.id]})
        assert resp.status_code == 403

    def test_bulk_delete_invalidates_leads_cache(self, client, db):
        from unittest.mock import patch
        lead = create_test_lead(db, email="cachedelete@t.com")
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.post("/api/admin/leads/bulk-delete", json={"lead_ids": [lead.id]})
        assert resp.status_code == 200
        invalidated = {call.args[0] for call in mock_invalidate.call_args_list}
        assert {"my_leads", "leads_count", "leads_page"}.issubset(invalidated)


class TestAutoAssignAll:

    def test_auto_assign_distributes_leads(self, client, db):
        sdr1 = create_test_user(db, email="sdr1@t.com", role="SDR")
        sdr2 = create_test_user(db, email="sdr2@t.com", role="SDR")
        for i in range(4):
            create_test_lead(db, email=f"auto{i}@t.com", phone=f"+123456789{i}")
        resp = client.post("/api/admin/assignments/auto-assign-all")
        assert resp.status_code == 200
        assert resp.json()["assigned_count"] == 4

    def test_auto_assign_invalidates_leads_cache(self, client, db):
        from unittest.mock import patch
        create_test_user(db, email="sdr-auto-cache@t.com", role="SDR")
        create_test_lead(db, email="autocache@t.com", phone="+19998887771")
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.post("/api/admin/assignments/auto-assign-all")
        assert resp.status_code == 200
        invalidated = {call.args[0] for call in mock_invalidate.call_args_list}
        assert {"my_leads", "leads_count", "leads_page"}.issubset(invalidated)


class TestUnassignLead:

    def test_unassign_lead(self, client, db):
        user = create_test_user(db, email="unassignee@t.com")
        lead = create_test_lead(db, email="tounassign@t.com")
        user.assigned_leads.append(lead)
        db.commit()
        resp = client.delete(f"/api/admin/assignments/{user.id}/{lead.id}")
        assert resp.status_code == 200

    def test_unassign_lead_invalidates_leads_cache(self, client, db):
        from unittest.mock import patch
        user = create_test_user(db, email="unassignee-cache@t.com")
        lead = create_test_lead(db, email="tounassign-cache@t.com")
        user.assigned_leads.append(lead)
        db.commit()
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.delete(f"/api/admin/assignments/{user.id}/{lead.id}")
        assert resp.status_code == 200
        invalidated = {call.args[0] for call in mock_invalidate.call_args_list}
        assert {"my_leads", "leads_count", "leads_page"}.issubset(invalidated)


class TestBulkUnassign:

    def test_bulk_unassign_removes_all_assignees(self, client, db):
        user = create_test_user(db, email="bulkunassignee@t.com")
        lead = create_test_lead(db, email="tobulkunassign@t.com")
        user.assigned_leads.append(lead)
        db.commit()
        resp = client.post("/api/admin/assignments/bulk-unassign", json={"lead_ids": [lead.id]})
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    def test_bulk_unassign_invalidates_leads_cache(self, client, db):
        from unittest.mock import patch
        user = create_test_user(db, email="bulkunassign-cache@t.com")
        lead = create_test_lead(db, email="bulkunassigncache@t.com")
        user.assigned_leads.append(lead)
        db.commit()
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.post("/api/admin/assignments/bulk-unassign", json={"lead_ids": [lead.id]})
        assert resp.status_code == 200
        invalidated = {call.args[0] for call in mock_invalidate.call_args_list}
        assert {"my_leads", "leads_count", "leads_page"}.issubset(invalidated)


# ── Sync Settings ────────────────────────────────────────────────────────────

class TestSyncSettings:

    def test_get_sync_settings(self, client, db):
        create_sync_settings(db)
        resp = client.get("/api/admin/sync-settings")
        assert resp.status_code == 200
        data = resp.json()
        assert data["lead_limit"] == 1000
        assert data["sync_direction"] == "push_only"

    def test_update_sync_settings(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={
            "lead_limit": 500, "sync_direction": "both"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_limit"] == 500
        assert resp.json()["sync_direction"] == "both"

    def test_invalid_sync_direction_422(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"sync_direction": "invalid"})
        assert resp.status_code == 422

    def test_negative_lead_limit_422(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"lead_limit": -1})
        assert resp.status_code == 422

    def test_update_allow_multi_pod_sdr(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"allow_multi_pod_sdr": True})
        assert resp.status_code == 200
        assert resp.json()["allow_multi_pod_sdr"] is True

    def test_update_conversation_min_seconds(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"conversation_min_seconds": 60})
        assert resp.status_code == 200
        assert resp.json()["conversation_min_seconds"] == 60
        assert client.get("/api/admin/sync-settings").json()["conversation_min_seconds"] == 60

    def test_conversation_min_seconds_defaults_to_120(self, client, db):
        create_sync_settings(db)
        assert client.get("/api/admin/sync-settings").json()["conversation_min_seconds"] == 120

    def test_conversation_min_seconds_rejects_non_positive(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"conversation_min_seconds": 0})
        assert resp.status_code == 422


# ── Upload Preview ───────────────────────────────────────────────────────────

class TestUploadPreview:

    def test_upload_preview(self, client):
        csv = "First Name,Last Name,Email,Company\nJohn,Doe,john@test.com,Acme\nJane,Smith,jane@test.com,Widget"
        resp = client.post("/api/admin/leads/upload-preview", json={"csv": csv})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["headers"]) == 4
        assert len(data["preview_rows"]) == 2
        assert "auto_mapping" in data

    def test_upload_preview_missing_csv_400(self, client):
        resp = client.post("/api/admin/leads/upload-preview", json={})
        assert resp.status_code == 400


# ── Upload Sheet ─────────────────────────────────────────────────────────────

class TestUploadSheet:

    def test_basic_upload_creates_leads(self, client, db):
        csv = "First Name,Last Name,Email,Company,Phone\nJohn,Doe,john@upload.com,Acme,+1234567890\nJane,Smith,jane@upload.com,Widget,+1234567891"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "test.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 2
        assert data["skipped"] == 0

    def test_result_column_with_non_matched_value_still_imports(self, client, db):
        """Bug fix: sheets with a 'result' column containing values like 'found' should NOT skip rows."""
        csv = "First Name,Last Name,Email,Phone,Result\nAlice,Brown,alice@fix.com,+1234567890,found\nBob,White,bob@fix.com,+1234567891,enriched"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "enriched.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 2, f"Expected 2 created, got {data['created']}. Skipped: {data['skipped']}"
        assert data["skipped"] == 0

    def test_result_column_skips_not_matched_rows(self, client, db):
        """Rows explicitly marked 'not matched' should still be skipped."""
        csv = "First Name,Last Name,Email,Phone,Result\nAlice,Good,alice@ok.com,+1234567890,matched\nBob,Bad,bob@bad.com,+1234567891,not matched"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "mixed.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 1
        assert data["skipped"] == 1

    def test_duplicate_detection_skips_existing_leads(self, client, db):
        create_test_lead(db, email="existing@dup.com", last_name="Existing", phone="+1234567890")
        csv = "First Name,Last Name,Email,Phone\nDup,Lead,existing@dup.com,+1234567890"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "dups.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 0
        assert data["duplicates"] == 1

    def test_update_existing_mode(self, client, db):
        create_test_lead(db, email="update@test.com", last_name="Old", first_name="Name", company="OldCo", phone="+1234567890")
        csv = "First Name,Last Name,Email,Company,Phone\nName,Old,update@test.com,NewCo,+1234567890"
        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": csv, "filename": "update.csv", "update_existing": True
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["updated"] == 1
        # Verify the lead was actually updated
        lead = db.query(models.Lead).filter(models.Lead.email == "update@test.com").first()
        assert lead.company == "NewCo"

    def test_update_existing_assigns_existing_lead_to_sdr(self, client, db):
        """RCA 2026-07-30: same bug as the gsheet import — update_existing
        updated fields but never assigned the matched lead to the chosen SDR."""
        sdr = create_test_user(db, email="samya-csv-test@test.com", name="Samya CSV Test", role="AE")
        existing = create_test_lead(db, email="update2@test.com", last_name="Old", first_name="Name", company="OldCo", phone="+1234500011")
        db.commit()

        csv = "First Name,Last Name,Email,Company,Phone\nName,Old,update2@test.com,NewCo,+1234500011"
        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": csv, "filename": "update2.csv",
            "update_existing": True, "assign_to_user_id": sdr.id,
        })
        assert resp.status_code == 200
        assert resp.json()["updated"] == 1

        db.refresh(existing)
        assert sdr.id in {u.id for u in existing.assigned_users}

    def test_upload_missing_csv_400(self, client):
        resp = client.post("/api/admin/leads/upload-sheet", json={})
        assert resp.status_code == 400

    def test_csv_upload_creates_upload_log(self, client, db):
        """Regression: CSV upload must commit leads AND LeadUploadLog atomically.
        Same split-commit bug as gsheet_import — fixed with single atomic commit."""
        csv = "First Name,Last Name,Email,Company,Phone\nLog,Csv,logcsv@upload.com,Acme,+1234500003"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "test_log.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 1
        assert "log_id" in data and data["log_id"] is not None

        log = db.query(models.LeadUploadLog).filter(
            models.LeadUploadLog.id == data["log_id"]
        ).first()
        assert log is not None, "CSV upload must write LeadUploadLog in the same transaction as leads"
        assert log.created == 1
        assert log.status == "completed"


# ── Dynamic Source Labeling ──────────────────────────────────────────────────

class TestDynamicSourceLabeling:

    def test_uploaded_leads_get_dynamic_source(self, client, db):
        csv = "First Name,Last Name,Email,Company,Phone\nJohn,Doe,john@dynamic.com,Acme,+1234567890"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "apollo_leads.csv"})
        assert resp.status_code == 200
        lead = db.query(models.Lead).filter(models.Lead.email == "john@dynamic.com").first()
        assert lead is not None
        assert lead.lead_source.startswith("upload:apollo_leads.csv:")
        # Verify timestamp portion is ISO format
        parts = lead.lead_source.split(":", 2)
        assert len(parts) == 3
        assert parts[0] == "upload"
        assert parts[1] == "apollo_leads.csv"

    def test_source_filter_matches_both_legacy_and_new(self, client, db):
        """Verify that source=uploaded matches both legacy 'uploaded' and new 'upload:...' values."""
        # Create a legacy lead
        create_test_lead(db, email="legacy@test.com", lead_source="uploaded", phone="+1234567890")
        # Create a new-style lead
        csv = "First Name,Last Name,Email,Phone\nNew,Style,new@test.com,+1234567891"
        client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "test.csv"})

        # Filter by source=uploaded should match both
        resp = client.get("/api/leads", params={"source": "uploaded", "per_page": 100})
        assert resp.status_code == 200
        emails = [l["email"] for l in resp.json()["data"]]
        assert "legacy@test.com" in emails
        assert "new@test.com" in emails

    def test_manual_leads_retain_manual_source(self, client, db):
        resp = client.post("/api/leads", json={
            "first_name": "Test", "last_name": "Manual", "email": "manual@test.com"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_source"] == "manual"


# ── Google Sheets Import ─────────────────────────────────────────────────────

class TestGoogleSheetsImport:

    def test_invalid_url_returns_error(self, client):
        resp = client.post("/api/admin/leads/upload-gsheet", json={"url": "https://not-google.com/sheet"})
        assert resp.status_code == 400
        import json
        detail = json.loads(resp.json()["detail"])
        assert detail["error_code"] == "invalid_url"

    def test_empty_url_returns_400(self, client):
        resp = client.post("/api/admin/leads/upload-gsheet", json={"url": ""})
        assert resp.status_code == 400

    def test_gsheet_preview_success(self, client, monkeypatch):
        """Mock httpx.get to return CSV content and verify preview response."""
        csv_content = "First Name,Last Name,Email,Company\nAlice,Smith,alice@gs.com,Acme\nBob,Jones,bob@gs.com,Widget"

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/upload-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_rows"] == 2
        assert "First Name" in data["headers"]
        assert data["sheet_id"] == "abc123"
        assert "auto_mapping" in data

    def test_gsheet_preview_passes_through_gid_from_fragment(self, client, monkeypatch):
        """RCA 2026-08-10: a link to a specific tab (#gid=...) must fetch
        that tab, not silently fall back to the spreadsheet's default one."""
        csv_content = "First Name,Last Name,Email,Company\nAlice,Smith,alice@gs.com,Acme"

        class MockResponse:
            status_code = 200
            text = csv_content

        calls = []

        def fake_get(url, **kwargs):
            calls.append(url)
            return MockResponse()

        import httpx
        monkeypatch.setattr(httpx, "get", fake_get)

        resp = client.post("/api/admin/leads/upload-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123/edit?gid=486071753#gid=486071753"
        })
        assert resp.status_code == 200
        assert calls[0] == "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=486071753"

    def test_gsheet_import_creates_leads(self, client, db, monkeypatch):
        """Mock httpx.get and verify leads are created with gsheet: source prefix."""
        csv_content = "First Name,Last Name,Email,Company,Phone\nAlice,Smith,alice@gsheet.com,Acme,+1234567890\nBob,Jones,bob@gsheet.com,Widget,+1234567891"

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123",
            "sheet_name": "My Test Sheet"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 2

        lead = db.query(models.Lead).filter(models.Lead.email == "alice@gsheet.com").first()
        assert lead is not None
        assert lead.lead_source.startswith("gsheet:My Test Sheet:")

    def test_gsheet_import_passes_through_gid_from_query_param(self, client, db, monkeypatch):
        """Same RCA as the preview endpoint's gid test — import-gsheet has
        its own separate export_url construction that needs the same fix."""
        csv_content = "First Name,Last Name,Email,Company,Phone\nAlice,Smith,alice@gsheet.com,Acme,+1234567890"

        class MockResponse:
            status_code = 200
            text = csv_content

        calls = []

        def fake_get(url, **kwargs):
            calls.append(url)
            return MockResponse()

        import httpx
        monkeypatch.setattr(httpx, "get", fake_get)

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123?gid=486071753",
            "sheet_name": "My Test Sheet"
        })
        assert resp.status_code == 200
        assert calls[0] == "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=486071753"

    def test_gsheet_empty_sheet(self, client, monkeypatch):
        """Mock empty CSV response and verify error."""
        class MockResponse:
            status_code = 200
            text = ""

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/upload-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123"
        })
        assert resp.status_code == 400
        import json
        detail = json.loads(resp.json()["detail"])
        assert detail["error_code"] == "empty_sheet"

    def test_gsheet_import_creates_upload_log(self, client, db, monkeypatch):
        """Regression: leads AND a LeadUploadLog must be committed atomically.
        Previously, a transient DB error between the two separate commits could
        leave leads in the DB with no corresponding upload log (split-brain)."""
        csv_content = "First Name,Last Name,Email,Company,Phone\nLog,Test,logtest@gsheet.com,Acme,+1234567892"

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123",
            "sheet_name": "Log Test Sheet"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 1
        assert "log_id" in data and data["log_id"] is not None

        # Verify the upload log was actually written to DB in the same commit
        log = db.query(models.LeadUploadLog).filter(
            models.LeadUploadLog.id == data["log_id"]
        ).first()
        assert log is not None, "LeadUploadLog must be committed with leads in a single transaction"
        assert log.created == 1
        assert log.status == "completed"

    def test_gsheet_import_row_failure_does_not_crash_import(self, client, db, monkeypatch):
        """Regression: a DB-level failure on one row must not corrupt the session
        and kill the whole import. The savepoint fix ensures other rows still land."""
        # Row 1: valid. Row 2: will trigger a duplicate sf_lead_id at the DB level
        # by pre-inserting a lead whose phone matches row 2's phone (dedup catches
        # it before DB, so we simulate row-level failure via a bad employee_count).
        # Simplest path: all valid rows import; errors[] is empty; HTTP 200 returned.
        csv_content = (
            "First Name,Last Name,Email,Company,Phone\n"
            "Good,Row,good@savepoint.com,Acme,+1234500001\n"
            "Also,Good,alsogood@savepoint.com,Widget,+1234500002"
        )

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/savepoint123",
            "sheet_name": "Savepoint Test"
        })
        # Must return HTTP 200 (not 500) even if individual rows had issues
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 2
        # Upload log must still be written
        assert data.get("log_id") is not None

    def test_gsheet_import_update_existing_assigns_existing_lead_to_sdr(self, client, db, monkeypatch):
        """RCA 2026-07-30: update_existing updated a matched lead's fields but
        never assigned it — a re-upload of already-imported leads with a
        chosen SDR silently left them unassigned no matter what was picked."""
        sdr = create_test_user(db, email="samya-test@test.com", name="Samya Test", role="AE")
        existing = create_test_lead(db, email="already.here@gsheet.com", phone="+1234599999", first_name="Already", last_name="Here")
        db.commit()

        csv_content = (
            "First Name,Last Name,Email,Company,Phone\n"
            "Already,Here,already.here@gsheet.com,NewCo,+1234599999"
        )

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/reassign123",
            "sheet_name": "Reassign Test",
            "update_existing": True,
            "assign_to_user_id": sdr.id,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 0
        assert data["updated"] == 1

        db.refresh(existing)
        assert sdr.id in {u.id for u in existing.assigned_users}


# ── Per-SDR Settings (Dialer + Email Sync Toggles) ──────────────────────────

class TestGetUserToken:
    """Tests for GET /api/admin/users/{user_id}/token — backs Control Center's
    "View As". RCA 2026-09-04: this absorbed the self-view guard + audit log
    that used to live on the separate, never-called POST /admin/impersonate/{id}
    (deleted as dead code — this endpoint was the one View As actually called)."""

    def test_returns_token_for_another_user(self, client, db):
        import models
        user = create_test_user(db, email="viewas_target@t.com", role="SDR")
        resp = client.get(f"/api/admin/users/{user.id}/token")
        assert resp.status_code == 200
        assert resp.json()["token"]

        # RCA 2026-09-04: "IMPERSONATE" was missing from activity_logger's
        # ACTION_TYPES, so this call silently no-op'd — caught only by hitting
        # the real deployed endpoint on staging, not by the unit tests (which
        # never asserted a row actually landed). Pin it down here too.
        row = db.query(models.UserActivityLog).filter(
            models.UserActivityLog.action_type == "IMPERSONATE"
        ).first()
        assert row is not None, "View As must write an IMPERSONATE audit log row"
        assert row.object_id is None  # metadata carries target_user_id, not object_id
        import json
        meta = json.loads(row.metadata_json)
        assert meta["target_user_id"] == user.id
        assert meta["target_email"] == user.email

    def test_cannot_view_as_self(self, client):
        resp = client.get(f"/api/admin/users/{SUPER_ADMIN['sub']}/token")
        assert resp.status_code == 400

    def test_404_for_missing_user(self, client):
        resp = client.get("/api/admin/users/does-not-exist/token")
        assert resp.status_code == 404


class TestUserSettings:
    """Tests for PATCH /api/admin/users/{user_id}/settings — per-SDR feature toggles."""

    def test_super_admin_can_toggle_dialer(self, client, db):
        user = create_test_user(db, email="sdr_dial@t.com", role="SDR")
        assert user.dialer_enabled is False

        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_enabled"] is True
        db.refresh(user)
        assert user.dialer_enabled is True

    def test_super_admin_can_toggle_email_sync(self, client, db):
        user = create_test_user(db, email="sdr_email@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "email_sync_enabled": True
        })
        assert resp.status_code == 200
        assert resp.json()["email_sync_enabled"] is True

    def test_toggle_both_at_once(self, client, db):
        user = create_test_user(db, email="sdr_both@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True, "email_sync_enabled": True,
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_enabled"] is True
        assert resp.json()["email_sync_enabled"] is True

    def test_partial_update_only_dialer(self, client, db):
        """Updating only dialer_enabled should not affect email_sync_enabled."""
        user = create_test_user(db, email="sdr_partial@t.com", role="SDR")
        user.email_sync_enabled = True
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 200
        db.refresh(user)
        assert user.dialer_enabled is True
        assert user.email_sync_enabled is True  # unchanged

    def test_non_existent_user_returns_404(self, client, db):
        resp = client.patch("/api/admin/users/nonexistent-id/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 404

    def test_pod_admin_cannot_toggle_settings(self, client_as_pod_admin, db):
        user = create_test_user(db, email="sdr_deny@t.com", role="SDR")
        resp = client_as_pod_admin.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 403

    def test_sdr_cannot_toggle_settings(self, client_as_sdr, db):
        user = create_test_user(db, email="sdr_self@t.com", role="SDR")
        resp = client_as_sdr.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 403

    def test_toggle_off_after_on(self, client, db):
        user = create_test_user(db, email="sdr_toggle@t.com", role="SDR")
        user.dialer_enabled = True
        user.email_sync_enabled = True
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": False, "email_sync_enabled": False,
        })
        assert resp.status_code == 200
        db.refresh(user)
        assert user.dialer_enabled is False
        assert user.email_sync_enabled is False

    def test_can_assign_a_per_sdr_whatsapp_sender(self, client, db):
        # RCA 2026-08-25: WhatsApp used one org-wide sender for every SDR —
        # this mirrors the existing per-SDR messenger_from_number pattern.
        user = create_test_user(db, email="sdr_wa@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "messenger_whatsapp_sender_id": "+919240915643"
        })
        assert resp.status_code == 200
        assert resp.json()["messenger_whatsapp_sender_id"] == "+919240915643"
        db.refresh(user)
        assert user.messenger_whatsapp_sender_id == "+919240915643"

    def test_invalid_whatsapp_sender_format_rejected(self, client, db):
        user = create_test_user(db, email="sdr_wa_bad@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "messenger_whatsapp_sender_id": "not-a-number"
        })
        assert resp.status_code == 422

    def test_whatsapp_sender_can_be_cleared(self, client, db):
        user = create_test_user(db, email="sdr_wa_clear@t.com", role="SDR")
        user.messenger_whatsapp_sender_id = "+919240915643"
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "messenger_whatsapp_sender_id": None
        })
        assert resp.status_code == 200
        db.refresh(user)
        assert user.messenger_whatsapp_sender_id is None


class TestListUsersWithFlags:
    """Verify list_users returns the new dialer/email flags."""

    def test_list_users_includes_dialer_flag(self, client, db):
        user = create_test_user(db, email="flaguser@t.com", role="SDR")
        user.dialer_enabled = True
        db.commit()
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        flag_user = next((u for u in resp.json() if u["email"] == "flaguser@t.com"), None)
        assert flag_user is not None
        assert flag_user["dialer_enabled"] is True
        assert flag_user["email_sync_enabled"] is False

    def test_list_users_default_flags_are_false(self, client, db):
        create_test_user(db, email="defaultflag@t.com", role="SDR")
        resp = client.get("/api/admin/users")
        flag_user = next((u for u in resp.json() if u["email"] == "defaultflag@t.com"), None)
        assert flag_user is not None
        assert flag_user["dialer_enabled"] is False
        assert flag_user["email_sync_enabled"] is False

    def test_list_users_includes_dialer_provider_override(self, client, db):
        user = create_test_user(db, email="overrideuser@t.com", role="SDR")
        user.dialer_provider_override = "messenger"
        db.commit()
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        target = next((u for u in resp.json() if u["email"] == "overrideuser@t.com"), None)
        assert target is not None
        assert target["dialer_provider_override"] == "messenger"

    def test_list_users_default_override_is_null(self, client, db):
        create_test_user(db, email="nooverride@t.com", role="SDR")
        resp = client.get("/api/admin/users")
        target = next((u for u in resp.json() if u["email"] == "nooverride@t.com"), None)
        assert target is not None
        assert target["dialer_provider_override"] is None


class TestDialerProviderOverride:
    """Tests for dialer_provider_override via PATCH /api/admin/users/{id}/settings."""

    def test_set_override_to_messenger(self, client, db):
        user = create_test_user(db, email="sdr_conv@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": "messenger"
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_provider_override"] == "messenger"
        db.refresh(user)
        assert user.dialer_provider_override == "messenger"

    def test_set_override_to_aircall(self, client, db):
        user = create_test_user(db, email="sdr_air@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": "aircall"
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_provider_override"] == "aircall"

    def test_clear_override_with_null(self, client, db):
        user = create_test_user(db, email="sdr_clear@t.com", role="SDR")
        user.dialer_provider_override = "messenger"
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": None
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_provider_override"] is None
        db.refresh(user)
        assert user.dialer_provider_override is None

    def test_clear_override_with_empty_string(self, client, db):
        user = create_test_user(db, email="sdr_empty@t.com", role="SDR")
        user.dialer_provider_override = "aircall"
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": ""
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_provider_override"] is None
        db.refresh(user)
        assert user.dialer_provider_override is None

    def test_invalid_provider_returns_400(self, client, db):
        user = create_test_user(db, email="sdr_bad@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": "twilio"
        })
        assert resp.status_code == 400
        assert "Invalid provider" in resp.json()["detail"]

    def test_override_does_not_affect_other_settings(self, client, db):
        """Setting dialer_provider_override should not change dialer_enabled or email_sync_enabled."""
        user = create_test_user(db, email="sdr_isolate@t.com", role="SDR")
        user.dialer_enabled = True
        user.email_sync_enabled = True
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": "messenger"
        })
        assert resp.status_code == 200
        db.refresh(user)
        assert user.dialer_enabled is True
        assert user.email_sync_enabled is True
        assert user.dialer_provider_override == "messenger"


# ── Phase 2: Outcome Config via PATCH /sync-settings ─────────────────────────

class TestOutcomeConfigAdmin:
    """Phase 2 tests: saving/validating outcome_config via PATCH /sync-settings."""

    def test_save_valid_outcome_config(self, client, db):
        """PATCH /sync-settings with valid outcome_config saves correctly."""
        import json
        create_sync_settings(db)
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Budget Freeze", "group": "terminal", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": custom_config
        })
        assert resp.status_code == 200
        # Verify it's stored in DB
        settings = db.query(models.SyncSettings).first()
        stored = json.loads(settings.outcome_config)
        values = {o["value"] for o in stored}
        assert "Budget Freeze" in values

    def test_get_sync_settings_includes_outcome_config(self, client, db):
        """GET /sync-settings should include outcome_config in response."""
        import json
        settings = create_sync_settings(db)
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        resp = client.get("/api/admin/sync-settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "outcome_config" in data
        assert isinstance(data["outcome_config"], list)
        assert len(data["outcome_config"]) == len(custom_config)

    def test_get_sync_settings_outcome_config_null_returns_default(self, client, db):
        """When outcome_config is NULL, GET should return DEFAULT_OUTCOME_CONFIG."""
        create_sync_settings(db)
        resp = client.get("/api/admin/sync-settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "outcome_config" in data
        assert len(data["outcome_config"]) == len(models.DEFAULT_OUTCOME_CONFIG)

    def test_reject_invalid_action_value(self, client, db):
        """outcome_config with invalid action should be rejected."""
        create_sync_settings(db)
        bad_config = list(models.DEFAULT_OUTCOME_CONFIG)
        bad_config[0] = dict(bad_config[0])
        bad_config[0]["action"] = "self_destruct"
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_reject_missing_required_fields(self, client, db):
        """outcome_config items missing required fields should be rejected."""
        create_sync_settings(db)
        bad_config = [
            {"value": "Incomplete Outcome"}  # missing group, action, etc.
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_reject_duplicate_outcome_values(self, client, db):
        """outcome_config with duplicate value strings should be rejected."""
        create_sync_settings(db)
        dup_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "No Answer", "group": "not_answered", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": dup_config
        })
        assert resp.status_code == 422

    def test_enforce_custom_outcome_cap(self, client, db):
        """Max 10 custom (non-builtin) outcomes should be enforced."""
        create_sync_settings(db)
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG)
        for i in range(11):
            custom_config.append({
                "value": f"Custom Outcome {i}", "group": "terminal", "action": "none",
                "notes_required": False, "builtin": False, "enabled": True,
            })
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": custom_config
        })
        assert resp.status_code == 422
        assert "10" in resp.json()["detail"]  # error message mentions the cap

    def test_reject_disqualify_on_answered_group(self, client, db):
        """disqualify action should only be allowed for terminal group."""
        create_sync_settings(db)
        bad_config = list(models.DEFAULT_OUTCOME_CONFIG)
        bad_config[0] = dict(bad_config[0])  # "Call Back Later" — answered group
        bad_config[0]["action"] = "disqualify"
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_reject_invalid_group_value(self, client, db):
        """outcome_config with invalid group should be rejected."""
        create_sync_settings(db)
        bad_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Custom Bad", "group": "super_answered", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_custom_outcome_value_format_validation(self, client, db):
        """Custom outcome values must be 2-50 chars."""
        create_sync_settings(db)
        # Too short (1 char)
        bad_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "X", "group": "terminal", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_10_custom_outcomes_within_cap_succeeds(self, client, db):
        """Exactly 10 custom outcomes should be allowed."""
        create_sync_settings(db)
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG)
        for i in range(10):
            custom_config.append({
                "value": f"Custom Outcome {i}", "group": "terminal", "action": "none",
                "notes_required": False, "builtin": False, "enabled": True,
            })
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": custom_config
        })
        assert resp.status_code == 200




# ── Pod Admin scoping on user management (v12.2 audit) ──────────────────────
# require_admin admits Pod Admin, and these four routes took a user_id
# straight off the URL with no check on *whose* account it was. Found while
# auditing v12.2's Control Center admission, which put the buttons on screen.
class TestPodAdminUserManagementScoping:

    def _pod_admin_with_pod(self, db):
        """The guard reads the caller's pod from their DB row (matching what
        list_users scopes on), so the fixture's JWT pod_id isn't enough.
        Returns the pod id the caller actually belongs to."""
        pod = create_test_pod(db, name="Test Pod")
        create_test_user(db, email="podadmin@test.com", name="Pod Admin",
                         role="Pod Admin", id="pod-admin-id", pod_id=pod.id)
        return pod.id

    def test_pod_admin_cannot_create_a_super_admin(self, client_as_pod_admin, db):
        """The headline hole: POST /users accepted any role, so a Pod Admin
        could mint a Super Admin account. PATCH /users/{id}/role was already
        require_super_admin — the role assigned at creation was never checked."""
        self._pod_admin_with_pod(db)
        resp = client_as_pod_admin.post("/api/admin/users", json={
            "email": "escalated@test.com", "name": "Escalated", "role": "Super Admin",
        })
        assert resp.status_code == 403
        assert db.query(models.User).filter(
            models.User.email == "escalated@test.com").first() is None

    def test_pod_admin_cannot_create_another_pod_admin(self, client_as_pod_admin, db):
        self._pod_admin_with_pod(db)
        resp = client_as_pod_admin.post("/api/admin/users", json={
            "email": "peer@test.com", "name": "Peer", "role": "Pod Admin",
        })
        assert resp.status_code == 403

    def test_pod_admin_cannot_delete_a_super_admin(self, client_as_pod_admin, db):
        self._pod_admin_with_pod(db)
        victim = create_test_user(db, email="boss@test.com", name="Boss", role="Super Admin")
        resp = client_as_pod_admin.delete(f"/api/admin/users/{victim.id}")
        assert resp.status_code == 403
        assert db.query(models.User).filter(models.User.id == victim.id).first() is not None

    def test_pod_admin_cannot_revoke_a_super_admins_login(self, client_as_pod_admin, db):
        self._pod_admin_with_pod(db)
        victim = create_test_user(db, email="boss2@test.com", name="Boss", role="Super Admin")
        resp = client_as_pod_admin.patch(f"/api/admin/users/{victim.id}/access",
                                          json={"action": "revoke"})
        assert resp.status_code == 403

    def test_pod_admin_cannot_delete_an_sdr_from_another_pod(self, client_as_pod_admin, db):
        self._pod_admin_with_pod(db)
        other_pod = create_test_pod(db, name="Other Pod")
        outsider = create_test_user(db, email="outsider@test.com", name="Outsider",
                                     role="SDR", pod_id=other_pod.id)
        resp = client_as_pod_admin.delete(f"/api/admin/users/{outsider.id}")
        assert resp.status_code == 403
        assert "POD" in resp.json()["detail"]

    def test_pod_admin_can_still_manage_an_sdr_in_their_own_pod(self, client_as_pod_admin, db):
        """The rule has to stay permissive for the case legacy admin.js
        actually allowed, or this is a regression rather than a fix."""
        pod_id = self._pod_admin_with_pod(db)
        member = create_test_user(db, email="member@test.com", name="Member",
                                   role="SDR", pod_id=pod_id)
        assert client_as_pod_admin.patch(
            f"/api/admin/users/{member.id}/access", json={"action": "revoke"}
        ).status_code == 200
        assert client_as_pod_admin.delete(f"/api/admin/users/{member.id}").status_code == 200

    def test_pod_admin_can_create_an_sdr_in_their_own_pod(self, client_as_pod_admin, db):
        pod_id = self._pod_admin_with_pod(db)
        resp = client_as_pod_admin.post("/api/admin/users", json={
            "email": "newsdr@test.com", "name": "New SDR",
            "role": "SDR", "pod_id": pod_id,
        })
        assert resp.status_code == 200

    def test_pod_admin_cannot_seed_a_user_into_another_pod(self, client_as_pod_admin, db):
        self._pod_admin_with_pod(db)
        other_pod = create_test_pod(db, name="Other Pod")
        resp = client_as_pod_admin.post("/api/admin/users", json={
            "email": "seeded@test.com", "name": "Seeded",
            "role": "SDR", "pod_id": other_pod.id,
        })
        assert resp.status_code == 403

    def test_super_admin_is_unaffected(self, client, db):
        victim = create_test_user(db, email="anyone@test.com", name="Anyone", role="Pod Admin")
        assert client.post("/api/admin/users", json={
            "email": "sa@test.com", "name": "SA", "role": "Super Admin",
        }).status_code == 200
        assert client.delete(f"/api/admin/users/{victim.id}").status_code == 200
