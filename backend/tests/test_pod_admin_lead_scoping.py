"""
test_pod_admin_lead_scoping.py

Verifies that after the pod-scoping change, Pod Admins see ONLY:
  1. Leads assigned to members of their pod (via lead_assignments JOIN)
  2. Unassigned leads tagged to their pod (lead.pod_id set, no lead_assignments row)

All other roles (Super Admin, SDR) must remain unaffected.

v8.9.11 — Pod Admin Lead Scoping
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from fastapi import HTTPException

from conftest import (
    create_test_user, create_test_lead, create_test_pod,
    _make_user_payload, _build_test_app,
)
import models


# ── Shared helpers ────────────────────────────────────────────────────────────

def _make_pod_admin_client(db, pod_id):
    """Return a TestClient authenticated as Pod Admin with the given pod_id."""
    app = _build_test_app()
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin

    pod_admin = _make_user_payload(
        "Pod Admin", "pa-test-id", "pa@test.com", "PA", pod_id=pod_id
    )

    def _override_db():
        yield db

    def _deny_super():
        raise HTTPException(status_code=403, detail="Super Admin only")

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: pod_admin
    app.dependency_overrides[require_admin] = lambda: pod_admin
    app.dependency_overrides[require_super_admin] = _deny_super
    return TestClient(app)


def _assign_lead(db, lead_id, user_id):
    """Insert a row into lead_assignments (simulates SDR/AE assignment)."""
    db.execute(
        models.lead_assignments.insert().values(lead_id=lead_id, user_id=user_id)
    )
    db.commit()


# ── Group A: Core Scoping ─────────────────────────────────────────────────────

class TestPodAdminCoreScoping:

    def test_a1_sees_lead_assigned_to_pod_member(self, client_as_pod_admin, db):
        """[A-1] Lead assigned to a user in Pod Admin's pod appears in list."""
        pod_member = create_test_user(
            db, email="a1m@t.com", role="SDR", pod_id="test-pod-id"
        )
        lead = create_test_lead(db, email="a1l@t.com")
        _assign_lead(db, lead.id, pod_member.id)

        resp = client_as_pod_admin.get("/api/leads")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id in ids, "Pod member's assigned lead must be visible to Pod Admin"

    def test_a2_cannot_see_lead_from_other_pod(self, client_as_pod_admin, db):
        """[A-2] Lead assigned to a user in a DIFFERENT pod is hidden."""
        other_member = create_test_user(
            db, email="a2m@t.com", role="SDR", pod_id="other-pod-id"
        )
        lead = create_test_lead(db, email="a2l@t.com")
        _assign_lead(db, lead.id, other_member.id)

        resp = client_as_pod_admin.get("/api/leads")
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id not in ids, "Other pod's lead must NOT be visible to this Pod Admin"

    def test_a3_sees_unassigned_lead_tagged_to_own_pod(self, client_as_pod_admin, db):
        """[A-3] Unassigned lead with lead.pod_id = own pod IS visible (round-robin pool)."""
        lead = create_test_lead(db, email="a3l@t.com", pod_id="test-pod-id")
        # No lead_assignments row — this is an unassigned but pod-tagged lead

        resp = client_as_pod_admin.get("/api/leads")
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id in ids, "Unassigned but pod-tagged lead must be in Pod Admin's view"

    def test_a4_cannot_see_unassigned_lead_with_null_pod(self, client_as_pod_admin, db):
        """[A-4] Unassigned lead with lead.pod_id = NULL is NOT visible to any Pod Admin."""
        lead = create_test_lead(db, email="a4l@t.com")
        # pod_id = NULL, no assignment — Super Admin pool only

        resp = client_as_pod_admin.get("/api/leads")
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id not in ids, "NULL-pod unassigned lead must NOT appear for Pod Admin"

    def test_a5_pod_admin_with_no_pod_sees_zero_leads(self, db):
        """[A-5] Safety: Pod Admin with pod_id=None sees 0 leads (data error state)."""
        client = _make_pod_admin_client(db, pod_id=None)
        create_test_lead(db, email="a5l@t.com")  # untagged lead

        resp = client.get("/api/leads")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0, "Pod Admin with no pod must see 0 leads"


# ── Group B: Cross-Role Isolation ─────────────────────────────────────────────

class TestCrossRoleIsolation:

    def test_b1_super_admin_still_sees_all_leads(self, client, db):
        """[B-1] Super Admin is completely unaffected — sees all leads regardless of pod."""
        create_test_lead(db, email="b1a@t.com")  # no pod, no assignment
        m = create_test_user(db, email="b1m@t.com", pod_id="pod-x")
        pod_lead = create_test_lead(db, email="b1b@t.com")
        _assign_lead(db, pod_lead.id, m.id)

        resp = client.get("/api/leads")
        assert resp.json()["total"] >= 2, "Super Admin must see all leads"

    def test_b2_sdr_still_sees_only_assigned_leads(self, client_as_sdr, db):
        """[B-2] SDR scoping is completely unaffected by this change."""
        sdr = create_test_user(
            db, id="sdr-user-id", email="sdr@test.com", role="SDR"
        )
        lead = create_test_lead(db, email="b2a@t.com")
        _assign_lead(db, lead.id, sdr.id)
        other_lead = create_test_lead(db, email="b2b@t.com", last_name="Other")

        resp = client_as_sdr.get("/api/leads/my")
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id in ids
        assert other_lead.id not in ids

    def test_b3_cross_pod_lead_visible_to_both_pod_admins(self, db):
        """[B-3] Lead assigned to users in TWO pods — both Pod Admins see it."""
        m_a = create_test_user(db, email="b3a@t.com", role="SDR", pod_id="pod-alpha")
        m_b = create_test_user(db, email="b3b@t.com", role="AE", pod_id="pod-beta")
        lead = create_test_lead(db, email="b3l@t.com")
        _assign_lead(db, lead.id, m_a.id)
        _assign_lead(db, lead.id, m_b.id)

        client_a = _make_pod_admin_client(db, "pod-alpha")
        client_b = _make_pod_admin_client(db, "pod-beta")

        ids_a = [l["id"] for l in client_a.get("/api/leads").json()["data"]]
        ids_b = [l["id"] for l in client_b.get("/api/leads").json()["data"]]
        assert lead.id in ids_a, "Pod Alpha admin must see cross-pod lead"
        assert lead.id in ids_b, "Pod Beta admin must see cross-pod lead"


# ── Group C: Endpoint Coverage ────────────────────────────────────────────────

class TestEndpointCoverage:

    def _setup_pod_lead(self, db):
        """Helper: create SDR in test-pod-id and assign a lead to them."""
        sdr = create_test_user(
            db, email="ep_sdr@t.com", role="SDR", pod_id="test-pod-id"
        )
        lead = create_test_lead(db, email="ep_lead@t.com")
        _assign_lead(db, lead.id, sdr.id)
        return lead, sdr

    def test_c1_dashboard_stats_scoped_to_pod(self, client_as_pod_admin, db):
        """[C-1] /api/leads/dashboard-stats counts only pod leads."""
        self._setup_pod_lead(db)
        # Also create a lead in another pod — must NOT be counted
        other = create_test_user(db, email="c1oth@t.com", pod_id="other-pod")
        other_lead = create_test_lead(db, email="c1ol@t.com", last_name="Other")
        _assign_lead(db, other_lead.id, other.id)

        resp = client_as_pod_admin.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        data = resp.json()
        total = sum(data.get("status_counts", {}).values())
        assert total == 1, "Dashboard stats must count only pod's leads"

    def test_c2_kanban_scoped_to_pod(self, client_as_pod_admin, db):
        """[C-2] /api/leads/kanban returns only pod leads."""
        lead, _ = self._setup_pod_lead(db)
        non_pod = create_test_lead(db, email="c2np@t.com", last_name="NonPod")

        resp = client_as_pod_admin.get("/api/leads/kanban")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()]
        assert lead.id in ids, "Kanban must show pod lead"
        assert non_pod.id not in ids, "Kanban must not show non-pod lead"

    def test_c3_company_autocomplete_scoped_to_pod(self, client_as_pod_admin, db):
        """[C-3] /api/leads/companies returns only companies from pod's leads."""
        sdr = create_test_user(db, email="c3sdr@t.com", pod_id="test-pod-id")
        pod_lead = create_test_lead(db, email="c3pl@t.com", company="PodCorp")
        _assign_lead(db, pod_lead.id, sdr.id)
        # Non-pod lead with a different company
        create_test_lead(db, email="c3ol@t.com", company="OtherCorp", last_name="Z")

        resp = client_as_pod_admin.get("/api/leads/companies")
        assert resp.status_code == 200
        companies = resp.json().get("companies", resp.json())  # handles both {companies:[...]} and flat list
        assert "PodCorp" in companies, "Pod company must appear in autocomplete"
        assert "OtherCorp" not in companies, "Non-pod company must not appear"


    def test_c4_search_respects_pod_scope(self, client_as_pod_admin, db):
        """[C-4] Search is applied within pod scope — matching global lead is hidden."""
        sdr = create_test_user(db, email="c4sdr@t.com", pod_id="test-pod-id")
        pod_lead = create_test_lead(db, email="c4pl@t.com", company="TargetCorp")
        _assign_lead(db, pod_lead.id, sdr.id)
        # Same company, different pod — must NOT appear
        create_test_lead(db, email="c4gl@t.com", company="TargetCorp", last_name="Z")

        resp = client_as_pod_admin.get("/api/leads?search=TargetCorp")
        ids = [l["id"] for l in resp.json()["data"]]
        assert pod_lead.id in ids, "Pod's TargetCorp lead must appear in search"


# ── Group D: AE Pod Edge Cases ────────────────────────────────────────────────

class TestAEPodEdgeCases:

    def test_d1_ae_pod_admin_sees_zero_before_any_assignments(self, db):
        """[D-1] AE Pod Admin with no leads assigned sees empty list — correct behaviour."""
        ae_pod = create_test_pod(db, name="AE Pod D1")
        # AE exists but has no lead assignments
        create_test_user(db, email="d1ae@t.com", role="AE", pod_id=ae_pod.id)
        # SDR pod lead — must NOT appear for AE Pod Admin
        sdr = create_test_user(db, email="d1sdr@t.com", pod_id="sdr-pod")
        lead = create_test_lead(db, email="d1l@t.com")
        _assign_lead(db, lead.id, sdr.id)

        client = _make_pod_admin_client(db, ae_pod.id)
        resp = client.get("/api/leads")
        assert resp.json()["total"] == 0, "AE Pod Admin with no assignments must see 0 leads"

    def test_d2_ae_pod_admin_sees_lead_after_ae_assigned(self, db):
        """[D-2] After assigning lead to AE, Pod Admin sees it — even if lead.pod_id != AE pod."""
        ae_pod = create_test_pod(db, name="AE Pod D2")
        ae = create_test_user(db, email="d2ae@t.com", role="AE", pod_id=ae_pod.id)
        # Lead was originally in an SDR pod — lead.pod_id stays as sdr-pod
        lead = create_test_lead(db, email="d2l@t.com", pod_id="sdr-pod")
        _assign_lead(db, lead.id, ae.id)

        client = _make_pod_admin_client(db, ae_pod.id)
        resp = client.get("/api/leads")
        ids = [l["id"] for l in resp.json()["data"]]
        assert lead.id in ids, "AE Pod Admin must see lead assigned to their AE via lead_assignments JOIN"

    def test_d3_ae_pod_admin_does_not_see_sdr_leads(self, db):
        """[D-3] AE Pod Admin cannot see SDR pipeline leads from other pods."""
        ae_pod = create_test_pod(db, name="AE Only Pod")
        sdr = create_test_user(db, email="d3sdr@t.com", role="SDR", pod_id="us-team")
        sdr_lead = create_test_lead(db, email="d3l@t.com")
        _assign_lead(db, sdr_lead.id, sdr.id)

        client = _make_pod_admin_client(db, ae_pod.id)
        resp = client.get("/api/leads")
        ids = [l["id"] for l in resp.json()["data"]]
        assert sdr_lead.id not in ids, "AE Pod Admin must not see SDR pipeline"


# ── Group E: Global View Toggle ───────────────────────────────────────────────

class TestGlobalViewToggle:

    def test_e1_global_view_true_returns_all_leads(self, client_as_pod_admin, db):
        """[E-1] global_view=true bypasses pod scope — Pod Admin sees all leads."""
        other_sdr = create_test_user(db, email="e1sdr@t.com", pod_id="other-pod")
        other_lead = create_test_lead(db, email="e1l@t.com")
        _assign_lead(db, other_lead.id, other_sdr.id)

        resp = client_as_pod_admin.get("/api/leads?global_view=true")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert other_lead.id in ids, "global_view=true must show leads from all pods"

    def test_e2_global_view_false_enforces_pod_scope(self, client_as_pod_admin, db):
        """[E-2] global_view=false (default) enforces pod scope."""
        other_sdr = create_test_user(db, email="e2sdr@t.com", pod_id="other-pod")
        other_lead = create_test_lead(db, email="e2l@t.com")
        _assign_lead(db, other_lead.id, other_sdr.id)

        resp = client_as_pod_admin.get("/api/leads?global_view=false")
        assert resp.status_code == 200
        ids = [l["id"] for l in resp.json()["data"]]
        assert other_lead.id not in ids, "global_view=false must enforce pod scope"

    def test_e3_global_view_dashboard_stats(self, client_as_pod_admin, db):
        """[E-3] global_view=true on dashboard-stats shows org-wide counts."""
        # Pod lead
        sdr = create_test_user(db, email="e3ps@t.com", pod_id="test-pod-id")
        pod_lead = create_test_lead(db, email="e3pl@t.com")
        _assign_lead(db, pod_lead.id, sdr.id)
        # Non-pod lead
        other_sdr = create_test_user(db, email="e3os@t.com", pod_id="other-pod")
        other_lead = create_test_lead(db, email="e3ol@t.com", last_name="Other")
        _assign_lead(db, other_lead.id, other_sdr.id)

        scoped = client_as_pod_admin.get("/api/leads/dashboard-stats")
        global_ = client_as_pod_admin.get("/api/leads/dashboard-stats?global_view=true")

        scoped_total = sum(scoped.json().get("status_counts", {}).values())
        global_total = sum(global_.json().get("status_counts", {}).values())

        assert scoped_total == 1, "Scoped view must count only pod lead"
        assert global_total == 2, "Global view must count all leads"
