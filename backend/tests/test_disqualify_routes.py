"""
Tests for account disqualify maker-checker (routes/disqualify_routes.py).

Flow: AE/SDR creates a request -> Pod Admin (or above) approves/rejects.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
from conftest import create_test_user, create_test_lead, create_test_pod
import models


def _make_leads(db, n=3, company="Acme", pod_id=None):
    return [create_test_lead(db, email=f"lead{i}@acme.com", company=company, pod_id=pod_id) for i in range(n)]


class TestCreateRequest:
    def test_create_request_success(self, client_as_sdr, db):
        leads = _make_leads(db, 3)
        resp = client_as_sdr.post("/api/disqualify-requests", json={
            "company": "Acme", "lead_ids": [l.id for l in leads], "reason": "Not ICP fit",
        })
        assert resp.status_code == 200
        assert resp.json()["id"]

    def test_reject_empty_lead_ids(self, client_as_sdr):
        resp = client_as_sdr.post("/api/disqualify-requests", json={
            "company": "Acme", "lead_ids": [], "reason": "x",
        })
        assert resp.status_code == 400

    def test_reject_mismatched_company(self, client_as_sdr, db):
        leads = _make_leads(db, 2, company="Acme")
        resp = client_as_sdr.post("/api/disqualify-requests", json={
            "company": "Globex", "lead_ids": [l.id for l in leads], "reason": "x",
        })
        assert resp.status_code == 400

    def test_reject_unknown_lead_id(self, client_as_sdr):
        resp = client_as_sdr.post("/api/disqualify-requests", json={
            "company": "Acme", "lead_ids": ["does-not-exist"], "reason": "x",
        })
        assert resp.status_code == 400


class TestApproveReject:
    def test_approve_disqualifies_all_leads(self, client_as_pod_admin, db):
        leads = _make_leads(db, 3)
        req = models.DisqualifyRequest(
            company="Acme", lead_ids=json.dumps([l.id for l in leads]),
            reason="Not ICP", requested_by="sdr-user-id",
        )
        db.add(req); db.commit(); db.refresh(req)

        resp = client_as_pod_admin.post(f"/api/disqualify-requests/{req.id}/approve")
        assert resp.status_code == 200
        assert resp.json()["count"] == 3

        for l in leads:
            db.refresh(l)
            assert l.status == "Disqualified"

        db.refresh(req)
        assert req.status == "approved"

        # Audit trail recorded for each lead
        logs = db.query(models.LeadStatusLog).filter(models.LeadStatusLog.to_status == "Disqualified").all()
        assert len(logs) == 3

    def test_double_approve_is_rejected(self, client_as_pod_admin, db):
        leads = _make_leads(db, 1)
        req = models.DisqualifyRequest(
            company="Acme", lead_ids=json.dumps([leads[0].id]),
            reason="x", requested_by="sdr-user-id",
        )
        db.add(req); db.commit(); db.refresh(req)

        first = client_as_pod_admin.post(f"/api/disqualify-requests/{req.id}/approve")
        assert first.status_code == 200
        second = client_as_pod_admin.post(f"/api/disqualify-requests/{req.id}/approve")
        assert second.status_code == 409

    def test_already_terminal_lead_is_skipped_not_double_counted(self, client_as_pod_admin, db):
        """Overlapping requests: a lead already disqualified by another approval
        is skipped (not re-processed) rather than erroring the whole batch."""
        leads = _make_leads(db, 2)
        leads[0].status = "Disqualified"
        db.commit()

        req = models.DisqualifyRequest(
            company="Acme", lead_ids=json.dumps([l.id for l in leads]),
            reason="x", requested_by="sdr-user-id",
        )
        db.add(req); db.commit(); db.refresh(req)

        resp = client_as_pod_admin.post(f"/api/disqualify-requests/{req.id}/approve")
        assert resp.status_code == 200
        assert resp.json()["count"] == 1  # only the non-terminal lead counted

    def test_reject_records_reason(self, client_as_pod_admin, db):
        leads = _make_leads(db, 1)
        req = models.DisqualifyRequest(
            company="Acme", lead_ids=json.dumps([leads[0].id]),
            reason="x", requested_by="sdr-user-id",
        )
        db.add(req); db.commit(); db.refresh(req)

        resp = client_as_pod_admin.post(f"/api/disqualify-requests/{req.id}/reject",
                                        json={"rejection_reason": "Actually a good fit"})
        assert resp.status_code == 200
        db.refresh(req)
        assert req.status == "rejected"
        assert req.rejection_reason == "Actually a good fit"
        assert leads[0].status != "Disqualified"

    def test_sdr_cannot_approve(self, client_as_sdr, db):
        leads = _make_leads(db, 1)
        req = models.DisqualifyRequest(
            company="Acme", lead_ids=json.dumps([leads[0].id]),
            reason="x", requested_by="sdr-user-id",
        )
        db.add(req); db.commit(); db.refresh(req)

        resp = client_as_sdr.post(f"/api/disqualify-requests/{req.id}/approve")
        assert resp.status_code == 403


class TestListMyRequests:
    def test_sdr_sees_own_pending_request(self, client_as_sdr, db):
        leads = _make_leads(db, 1)
        req = models.DisqualifyRequest(
            company="Acme", lead_ids=json.dumps([leads[0].id]),
            reason="x", requested_by="sdr-user-id",
        )
        other = models.DisqualifyRequest(
            company="Other Co", lead_ids=json.dumps([leads[0].id]),
            reason="x", requested_by="some-other-user-id",
        )
        db.add_all([req, other]); db.commit()

        resp = client_as_sdr.get("/api/disqualify-requests/mine")
        assert resp.status_code == 200
        companies = {r["company"] for r in resp.json()["requests"]}
        assert companies == {"Acme"}


class TestListRequests:
    def test_pod_admin_only_sees_own_pod_requests(self, client_as_pod_admin, db):
        pod = create_test_pod(db, name="Pod A")
        # Overwrite the pod_admin fixture's pod_id expectation ("test-pod-id")
        create_test_user(db, id="pod-admin-id", email="podadmin@test.com", role="Pod Admin", pod_id="test-pod-id")
        in_pod_sdr = create_test_user(db, id="in-pod-sdr", email="inpod@test.com", role="SDR", pod_id="test-pod-id")
        other_pod_sdr = create_test_user(db, id="other-pod-sdr", email="otherpod@test.com", role="SDR", pod_id=pod.id)

        leads = _make_leads(db, 2)
        req_in_pod = models.DisqualifyRequest(company="Acme", lead_ids=json.dumps([leads[0].id]),
                                               reason="x", requested_by=in_pod_sdr.id)
        req_other_pod = models.DisqualifyRequest(company="Acme", lead_ids=json.dumps([leads[1].id]),
                                                  reason="x", requested_by=other_pod_sdr.id)
        db.add_all([req_in_pod, req_other_pod]); db.commit()

        resp = client_as_pod_admin.get("/api/disqualify-requests")
        assert resp.status_code == 200
        ids = {r["id"] for r in resp.json()["requests"]}
        assert req_in_pod.id in ids
        assert req_other_pod.id not in ids
