"""
Tests for Call Lists (Power Dialer selectable dial lists) — models.CallList /
models.call_list_leads, routes/call_list_routes.py, and the GET /leads
call_list_id filter in routes/lead_routes.py.
"""
import models
from conftest import create_test_user, create_test_lead, create_test_pod, SDR_USER


class TestCallListCrud:

    def test_create_and_list_org_wide_visible(self, client, db):
        resp = client.post("/api/call-lists", json={"name": "Q3 Follow-ups"})
        assert resp.status_code == 200
        call_list_id = resp.json()["id"]

        # Created by one user (super admin, via the `client` fixture), but
        # visible to any other authenticated user — org-wide, no ownership
        # filter on the list endpoint.
        other = create_test_user(db, email="other-viewer@t.com", role="SDR")
        resp2 = client.get("/api/call-lists")
        assert resp2.status_code == 200
        ids = [cl["id"] for cl in resp2.json()["call_lists"]]
        assert call_list_id in ids

    def test_create_on_use_dedups_by_name(self, client, db):
        r1 = client.post("/api/call-lists", json={"name": "Renewals"})
        r2 = client.post("/api/call-lists", json={"name": "Renewals"})
        assert r1.json()["id"] == r2.json()["id"], (
            "Posting an existing name must reuse the list, not create a duplicate"
        )
        count = db.query(models.CallList).filter(models.CallList.name == "Renewals").count()
        assert count == 1

    def test_create_requires_name(self, client):
        resp = client.post("/api/call-lists", json={"name": "  "})
        assert resp.status_code == 400

    def test_bulk_add_leads_and_duplicate_is_noop(self, client, db):
        call_list = client.post("/api/call-lists", json={"name": "Bulk Test"}).json()
        lead1 = create_test_lead(db, email="bulk1@t.com")
        lead2 = create_test_lead(db, email="bulk2@t.com")

        resp = client.post(f"/api/call-lists/{call_list['id']}/leads", json={"lead_ids": [lead1.id, lead2.id]})
        assert resp.status_code == 200
        assert resp.json()["added"] == 2

        # Re-posting the same lead_ids (simulating a concurrent duplicate
        # bulk-add) must be a no-op, not an error or a duplicate row.
        resp2 = client.post(f"/api/call-lists/{call_list['id']}/leads", json={"lead_ids": [lead1.id, lead2.id]})
        assert resp2.status_code == 200
        assert resp2.json()["added"] == 0
        assert resp2.json()["already_present"] == 2

        member_count = db.query(models.call_list_leads).filter(
            models.call_list_leads.c.call_list_id == call_list["id"]
        ).count()
        assert member_count == 2

    def test_bulk_add_requires_lead_ids(self, client, db):
        call_list = client.post("/api/call-lists", json={"name": "Empty Add Test"}).json()
        resp = client.post(f"/api/call-lists/{call_list['id']}/leads", json={"lead_ids": []})
        assert resp.status_code == 400

    def test_bulk_add_404_for_unknown_call_list(self, client):
        resp = client.post("/api/call-lists/does-not-exist/leads", json={"lead_ids": ["x"]})
        assert resp.status_code == 404

    def test_delete_by_creator_allowed(self, client_as_sdr, db):
        call_list = models.CallList(name="SDR's own list", created_by=SDR_USER["sub"])
        db.add(call_list)
        db.commit()
        resp = client_as_sdr.delete(f"/api/call-lists/{call_list.id}")
        assert resp.status_code == 200
        assert db.query(models.CallList).filter(models.CallList.id == call_list.id).first() is None

    def test_delete_by_non_creator_non_admin_forbidden(self, client_as_sdr, db):
        call_list = models.CallList(name="Someone else's list", created_by="a-different-user-id")
        db.add(call_list)
        db.commit()
        resp = client_as_sdr.delete(f"/api/call-lists/{call_list.id}")
        assert resp.status_code == 403
        assert db.query(models.CallList).filter(models.CallList.id == call_list.id).first() is not None

    def test_delete_by_pod_admin_allowed_even_if_not_creator(self, client_as_pod_admin, db):
        call_list = models.CallList(name="Someone else's list 2", created_by="a-different-user-id")
        db.add(call_list)
        db.commit()
        resp = client_as_pod_admin.delete(f"/api/call-lists/{call_list.id}")
        assert resp.status_code == 200

    def test_delete_404_for_unknown_call_list(self, client):
        resp = client.delete("/api/call-lists/does-not-exist")
        assert resp.status_code == 404

    def test_lead_count_excludes_soft_deleted_leads(self, client, db):
        call_list = client.post("/api/call-lists", json={"name": "Count Test"}).json()
        active_lead = create_test_lead(db, email="count-active@t.com")
        deleted_lead = create_test_lead(db, email="count-deleted@t.com")
        from datetime import datetime, timezone
        deleted_lead.deleted_at = datetime.now(timezone.utc)
        db.commit()

        client.post(f"/api/call-lists/{call_list['id']}/leads", json={"lead_ids": [active_lead.id, deleted_lead.id]})

        resp = client.get("/api/call-lists")
        found = next(cl for cl in resp.json()["call_lists"] if cl["id"] == call_list["id"])
        assert found["lead_count"] == 1, "lead_count must exclude soft-deleted leads"

    def test_lead_count_is_scoped_to_the_viewing_sdr(self, client, client_as_sdr, db):
        """Regression: lead_count used to be a flat, unscoped count of every
        lead in the list — an SDR/AE would see e.g. "Outbound (6)" in the
        Call List dropdown, then an empty Power Dialer queue for that same
        list, because GET /leads?call_list_id= is scoped to the rep's own
        assigned leads. The badge must match what picking the list actually
        shows this viewer, not the org-wide total."""
        call_list = client.post("/api/call-lists", json={"name": "Scoped Count Test"}).json()
        mine = create_test_lead(db, email="mine@t.com")
        someone_elses = create_test_lead(db, email="someone-elses@t.com")
        client.post(f"/api/call-lists/{call_list['id']}/leads", json={"lead_ids": [mine.id, someone_elses.id]})

        mine.assigned_users.append(create_test_user(db, email="an-sdr@t.com", role="SDR", id=SDR_USER["sub"]))
        db.commit()

        # Super Admin (unscoped) still sees the true total.
        resp_admin = client.get("/api/call-lists")
        found_admin = next(cl for cl in resp_admin.json()["call_lists"] if cl["id"] == call_list["id"])
        assert found_admin["lead_count"] == 2

        # The SDR only has one of the two assigned — the badge they see must
        # say 1, matching what GET /leads?call_list_id= will actually return
        # them (per TestCallListLeadsFilter below).
        resp_sdr = client_as_sdr.get("/api/call-lists")
        found_sdr = next(cl for cl in resp_sdr.json()["call_lists"] if cl["id"] == call_list["id"])
        assert found_sdr["lead_count"] == 1

        queue_resp = client_as_sdr.get(f"/api/leads?call_list_id={call_list['id']}")
        assert len(queue_resp.json()["data"]) == found_sdr["lead_count"]


class TestCallListLeadsFilter:
    """GET /leads?call_list_id= — the actual Power Dialer/Leads Hub dial source."""

    def test_call_list_id_filters_leads(self, client, db):
        call_list = client.post("/api/call-lists", json={"name": "Filter Test"}).json()
        in_list = create_test_lead(db, email="in-list@t.com", status="Calling")
        not_in_list = create_test_lead(db, email="not-in-list@t.com", status="Calling")
        client.post(f"/api/call-lists/{call_list['id']}/leads", json={"lead_ids": [in_list.id]})

        resp = client.get(f"/api/leads?call_list_id={call_list['id']}")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert in_list.id in ids
        assert not_in_list.id not in ids

    def test_call_list_id_ands_with_status_filter(self, client, db):
        """A list member whose status is a parked stage (models.PARKED_STATUSES)
        must not show up as a dialable candidate by default — call_list_id is
        a source of candidates, not an override of what's safe to dial, same
        as journey_id's existing behavior."""
        call_list = client.post("/api/call-lists", json={"name": "Status AND Test"}).json()
        callable_lead = create_test_lead(db, email="callable@t.com", status="Calling")
        parked_lead = create_test_lead(db, email="parked@t.com", status="No Phone - Parked")
        client.post(
            f"/api/call-lists/{call_list['id']}/leads",
            json={"lead_ids": [callable_lead.id, parked_lead.id]},
        )

        resp = client.get(f"/api/leads?call_list_id={call_list['id']}")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert callable_lead.id in ids
        assert parked_lead.id not in ids, (
            "A parked-status lead must be excluded by default even though "
            "it's a member of the requested call list"
        )

    def test_call_list_id_excludes_soft_deleted_leads(self, client, db):
        call_list = client.post("/api/call-lists", json={"name": "Soft Delete Test"}).json()
        active_lead = create_test_lead(db, email="sd-active@t.com", status="Calling")
        deleted_lead = create_test_lead(db, email="sd-deleted@t.com", status="Calling")
        from datetime import datetime, timezone
        deleted_lead.deleted_at = datetime.now(timezone.utc)
        db.commit()
        client.post(
            f"/api/call-lists/{call_list['id']}/leads",
            json={"lead_ids": [active_lead.id, deleted_lead.id]},
        )

        resp = client.get(f"/api/leads?call_list_id={call_list['id']}")
        ids = [l["id"] for l in resp.json()["data"]]
        assert active_lead.id in ids
        assert deleted_lead.id not in ids
