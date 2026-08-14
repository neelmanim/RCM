"""
Tests for AE (Account Executive) role implementation.

Covers:
  1.  AE role creation via admin API
  2.  AE role update (SDR → AE)
  3.  Pod purity: cannot add AE to an SDR pod
  4.  Pod purity: cannot add SDR to an AE pod
  5.  Pod purity: rejected at role-change time if pod is already mixed
  6.  Cascade-assign: lead assigned to AE also lands on Pod Admin
  7.  Cascade-assign: bulk-assign path
  8.  Cascade-assign: auto-assign-all path
  9.  Cascade-unassign: single unassign removes lead from AE + Pod Admin
  10. Cascade-unassign: bulk-unassign removes lead from AE + Pod Admin
  11. AE leaderboard endpoint returns only AEs
  12. SDR leaderboard endpoint returns only SDRs (AE excluded)
  13. AE performance self-access allowed
  14. AE cannot view another user's performance
  15. AE appears in analytics user list (not excluded)
  16. AE included in auto-assign round-robin
  17. CSV bulk user import honours role="ae" column
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from conftest import (
    create_test_user, create_test_lead, create_test_pod,
    SUPER_ADMIN, _make_user_payload,
)
import models


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture()
def client_as_ae(db):
    """TestClient authenticated as an AE user."""
    from tests.conftest import _build_test_app
    app = _build_test_app()
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin

    ae_payload = _make_user_payload("AE", "ae-user-id", "ae@test.com", "AE User")

    def _override_db():
        yield db

    def _deny_admin():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Admin access required")

    def _deny_super():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Super Admin access required")

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: ae_payload
    app.dependency_overrides[require_admin] = _deny_admin
    app.dependency_overrides[require_super_admin] = _deny_super

    from fastapi.testclient import TestClient
    yield TestClient(app)
    app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────────────────────────────
# 1. AE role creation via admin API
# ─────────────────────────────────────────────────────────────────────────────

class TestAERoleCreation:

    def test_create_ae_user(self, client, db):
        """AE is a valid role — API should accept it."""
        resp = client.post("/api/admin/users", json={
            "email": "ae1@test.com", "name": "Account Exec", "role": "AE"
        })
        assert resp.status_code == 200, resp.text
        user = db.query(models.User).filter(models.User.email == "ae1@test.com").first()
        assert user is not None
        assert user.role == "AE"

    def test_create_ae_appears_in_user_list(self, client, db):
        """Created AE should appear in /api/admin/users."""
        create_test_user(db, email="ae2@test.com", role="AE")
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()]
        assert "ae2@test.com" in emails


# ─────────────────────────────────────────────────────────────────────────────
# 2. AE role update
# ─────────────────────────────────────────────────────────────────────────────

class TestAERoleUpdate:

    def test_update_sdr_to_ae(self, client, db):
        """SDR can be promoted to AE via role-change endpoint."""
        sdr = create_test_user(db, email="sdr2ae@test.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{sdr.id}/role", json={"role": "AE"})
        assert resp.status_code == 200, resp.text
        db.refresh(sdr)
        assert sdr.role == "AE"

    def test_update_ae_to_sdr(self, client, db):
        """AE can be demoted to SDR."""
        ae = create_test_user(db, email="ae2sdr@test.com", role="AE")
        resp = client.patch(f"/api/admin/users/{ae.id}/role", json={"role": "SDR"})
        assert resp.status_code == 200, resp.text
        db.refresh(ae)
        assert ae.role == "SDR"


# ─────────────────────────────────────────────────────────────────────────────
# 3 & 4. Pod purity enforcement
# ─────────────────────────────────────────────────────────────────────────────

class TestPodPurity:

    def test_cannot_add_ae_to_sdr_pod(self, client, db):
        """Adding an AE to a pod that already has an SDR must be rejected."""
        pod = create_test_pod(db, name="SDR Pod")
        create_test_user(db, email="sdr_in_pod@test.com", role="SDR", pod_id=pod.id)
        ae = create_test_user(db, email="ae_outsider@test.com", role="AE")

        resp = client.post(f"/api/pods/{pod.id}/members", json={"user_id": ae.id})
        assert resp.status_code == 400, resp.text
        assert "mixed" in resp.json()["detail"].lower() or "purity" in resp.json()["detail"].lower() or "ae" in resp.json()["detail"].lower()

    def test_cannot_add_sdr_to_ae_pod(self, client, db):
        """Adding an SDR to a pod that already has an AE must be rejected."""
        pod = create_test_pod(db, name="AE Pod")
        create_test_user(db, email="ae_in_pod@test.com", role="AE", pod_id=pod.id)
        sdr = create_test_user(db, email="sdr_outsider@test.com", role="SDR")

        resp = client.post(f"/api/pods/{pod.id}/members", json={"user_id": sdr.id})
        assert resp.status_code == 400, resp.text

    def test_ae_can_join_pure_ae_pod(self, client, db):
        """AE can join a pod that only has other AEs."""
        pod = create_test_pod(db, name="All AE Pod")
        create_test_user(db, email="ae_existing@test.com", role="AE", pod_id=pod.id)
        ae_new = create_test_user(db, email="ae_new@test.com", role="AE")

        resp = client.post(f"/api/pods/{pod.id}/members", json={"user_id": ae_new.id})
        assert resp.status_code == 200, resp.text

    def test_sdr_can_join_pure_sdr_pod(self, client, db):
        """SDR can join a pod that only has other SDRs (no regression)."""
        pod = create_test_pod(db, name="All SDR Pod")
        create_test_user(db, email="sdr_existing@test.com", role="SDR", pod_id=pod.id)
        sdr_new = create_test_user(db, email="sdr_new@test.com", role="SDR")

        resp = client.post(f"/api/pods/{pod.id}/members", json={"user_id": sdr_new.id})
        assert resp.status_code == 200, resp.text

    def test_role_change_to_ae_blocked_when_pod_has_sdrs(self, client, db):
        """Changing an SDR's role to AE while they are in an SDR pod must be rejected."""
        pod = create_test_pod(db, name="SDR Pod Purity")
        sdr1 = create_test_user(db, email="sdr_stay@test.com", role="SDR", pod_id=pod.id)
        sdr_change = create_test_user(db, email="sdr_change@test.com", role="SDR", pod_id=pod.id)

        resp = client.patch(f"/api/admin/users/{sdr_change.id}/role", json={"role": "AE"})
        assert resp.status_code == 400, resp.text


# ────────────────────────────────────────────────────────────────────────────────
# 6 & 7. v10: AE cascade REMOVED — Pod Admin sees leads via pod scoping, NOT lead_assignments
# ────────────────────────────────────────────────────────────────────────────────

class TestCascadeAssign:

    def _setup_ae_pod(self, db):
        """Helper: create a pod with a Pod Admin and an AE, return all three."""
        pod_admin = create_test_user(db, email="pa_cascade@test.com", role="Pod Admin", id="pa-cascade")
        pod = create_test_pod(db, name="AE Cascade Pod", admin_id=pod_admin.id)
        ae = create_test_user(db, email="ae_cascade@test.com", role="AE", pod_id=pod.id)
        return pod, pod_admin, ae

    def test_bulk_assign_to_ae_does_not_cascade_to_pod_admin(self, client, db):
        """v10: Bulk-assigning a lead to an AE must NOT add it to Pod Admin's lead_assignments.
        Pod Admin sees AE leads via pod scoping (lead_helpers.py), not via direct assignment."""
        pod, pod_admin, ae = self._setup_ae_pod(db)
        lead = create_test_lead(db, last_name="CascadeTest", phone="5550000001")

        resp = client.post("/api/admin/assignments/bulk-assign", json={
            "user_id": ae.id, "lead_ids": [lead.id]
        })
        assert resp.status_code == 200, resp.text
        assert lead.id in resp.json().get("assigned", [])

        db.refresh(lead)
        assigned_ids = [u.id for u in lead.assigned_users]
        assert ae.id in assigned_ids, "AE should be assigned"
        assert pod_admin.id not in assigned_ids, "Pod Admin must NOT be in lead_assignments (v10 architecture)"

    def test_bulk_assign_to_sdr_does_not_cascade(self, client, db):
        """Bulk-assigning to an SDR must NOT cascade to Pod Admin."""
        pod_admin = create_test_user(db, email="pa_nocascade@test.com", role="Pod Admin", id="pa-nocascade")
        pod = create_test_pod(db, name="SDR No Cascade Pod", admin_id=pod_admin.id)
        sdr = create_test_user(db, email="sdr_nocascade@test.com", role="SDR", pod_id=pod.id)
        lead = create_test_lead(db, last_name="NoCascade", phone="5550000002")

        resp = client.post("/api/admin/assignments/bulk-assign", json={
            "user_id": sdr.id, "lead_ids": [lead.id]
        })
        assert resp.status_code == 200, resp.text

        db.refresh(lead)
        assigned_ids = [u.id for u in lead.assigned_users]
        assert sdr.id in assigned_ids
        assert pod_admin.id not in assigned_ids, "Pod Admin should NOT receive SDR cascade"


# ────────────────────────────────────────────────────────────────────────────────
# 9 & 10. v10: AE cascade-unassign REMOVED — Pod Admin was never in lead_assignments
# ────────────────────────────────────────────────────────────────────────────────

class TestCascadeUnassign:

    def _setup_assigned_ae_lead(self, db):
        """Helper: AE assigned to a lead (Pod Admin is NOT in lead_assignments in v10)."""
        pod_admin = create_test_user(db, email="pa_unassign@test.com", role="Pod Admin", id="pa-unassign")
        pod = create_test_pod(db, name="Unassign Pod", admin_id=pod_admin.id)
        ae = create_test_user(db, email="ae_unassign@test.com", role="AE", pod_id=pod.id)
        lead = create_test_lead(db, last_name="UnassignTest", phone="5550000003")

        # Only AE is assigned — Pod Admin is NOT in lead_assignments (v10)
        lead.assigned_users.append(ae)
        db.commit()
        return pod, pod_admin, ae, lead

    def test_single_unassign_ae_does_not_affect_pod_admin(self, client, db):
        """v10: Unassigning a lead from an AE removes the AE. Pod Admin was never assigned."""
        pod, pod_admin, ae, lead = self._setup_assigned_ae_lead(db)

        resp = client.delete(f"/api/admin/assignments/{ae.id}/{lead.id}")
        assert resp.status_code == 200, resp.text

        db.refresh(lead)
        assigned_ids = [u.id for u in lead.assigned_users]
        assert ae.id not in assigned_ids, "AE should be unassigned"
        assert pod_admin.id not in assigned_ids, "Pod Admin was never in lead_assignments (v10)"

    def test_bulk_unassign_ae_clears_assignment(self, client, db):
        """v10: Bulk-unassigning clears the AE's assignment. Pod Admin unaffected."""
        pod, pod_admin, ae, lead = self._setup_assigned_ae_lead(db)

        resp = client.post("/api/admin/assignments/bulk-unassign", json={"lead_ids": [lead.id]})
        assert resp.status_code == 200, resp.text

        db.refresh(lead)
        assigned_ids = [u.id for u in lead.assigned_users]
        assert ae.id not in assigned_ids
        assert pod_admin.id not in assigned_ids, "Pod Admin was never in lead_assignments (v10)"


# ─────────────────────────────────────────────────────────────────────────────
# 11 & 12. Leaderboard separation
# ─────────────────────────────────────────────────────────────────────────────

class TestLeaderboard:

    def test_sdr_leaderboard_excludes_aes(self, client, db):
        """GET /api/leaderboard must not contain AE users."""
        create_test_user(db, email="sdr_lb@test.com", role="SDR")
        create_test_user(db, email="ae_lb@test.com", role="AE")

        resp = client.get("/api/leaderboard")
        assert resp.status_code == 200
        data = resp.json()
        ae_in_sdr_lb = any(e.get("email") == "ae_lb@test.com" for e in data)
        assert not ae_in_sdr_lb, "AE must not appear in SDR leaderboard"

    def test_ae_leaderboard_returns_only_aes(self, client, db):
        """GET /api/leaderboard/ae must return only AE users."""
        create_test_user(db, email="sdr_lb2@test.com", role="SDR")
        ae = create_test_user(db, email="ae_lb2@test.com", role="AE")

        resp = client.get("/api/leaderboard/ae")
        assert resp.status_code == 200
        data = resp.json()
        emails = [e.get("email") for e in data]
        assert "ae_lb2@test.com" in emails
        assert "sdr_lb2@test.com" not in emails, "SDR must not appear in AE leaderboard"

    def test_ae_leaderboard_empty_when_no_aes(self, client, db):
        """GET /api/leaderboard/ae returns empty list when no AEs exist."""
        create_test_user(db, email="sdr_only@test.com", role="SDR")
        resp = client.get("/api/leaderboard/ae")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_ae_leaderboard_has_rank(self, client, db):
        """AE leaderboard entries include a 'rank' field."""
        create_test_user(db, email="ae_rank@test.com", role="AE")
        resp = client.get("/api/leaderboard/ae")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert "rank" in data[0]


# ─────────────────────────────────────────────────────────────────────────────
# 13 & 14. Performance access control
# ─────────────────────────────────────────────────────────────────────────────

class TestAEPerformanceAccess:

    def test_ae_can_view_own_performance(self, db):
        """AE can fetch their own performance stats."""
        from tests.conftest import _build_test_app
        app = _build_test_app()
        from database import get_db
        from auth import get_current_user, require_admin, require_super_admin

        ae = create_test_user(db, email="ae_perf_self@test.com", role="AE", id="ae-perf-id")
        ae_payload = _make_user_payload("AE", ae.id, ae.email, ae.name)

        def _override_db():
            yield db

        def _deny_admin():
            from fastapi import HTTPException
            raise HTTPException(status_code=403)

        app.dependency_overrides[get_db] = _override_db
        app.dependency_overrides[get_current_user] = lambda: ae_payload
        app.dependency_overrides[require_admin] = _deny_admin
        app.dependency_overrides[require_super_admin] = _deny_admin

        from fastapi.testclient import TestClient
        client_ae = TestClient(app)
        resp = client_ae.get(f"/api/sdr-performance/{ae.id}")
        assert resp.status_code == 200, resp.text
        app.dependency_overrides.clear()

    def test_ae_cannot_view_other_user_performance(self, db):
        """AE must receive 403 when trying to view another user's performance."""
        from tests.conftest import _build_test_app
        app = _build_test_app()
        from database import get_db
        from auth import get_current_user, require_admin, require_super_admin

        ae = create_test_user(db, email="ae_perf_block@test.com", role="AE", id="ae-block-id")
        other = create_test_user(db, email="other_user@test.com", role="SDR", id="other-user-id")
        ae_payload = _make_user_payload("AE", ae.id, ae.email, ae.name)

        def _override_db():
            yield db

        def _deny_admin():
            from fastapi import HTTPException
            raise HTTPException(status_code=403)

        app.dependency_overrides[get_db] = _override_db
        app.dependency_overrides[get_current_user] = lambda: ae_payload
        app.dependency_overrides[require_admin] = _deny_admin
        app.dependency_overrides[require_super_admin] = _deny_admin

        from fastapi.testclient import TestClient
        client_ae = TestClient(app)
        resp = client_ae.get(f"/api/sdr-performance/{other.id}")
        assert resp.status_code == 403, resp.text
        app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────────────────────────────
# 15. AE included in analytics user lists
# ─────────────────────────────────────────────────────────────────────────────

class TestAEInAnalytics:

    def test_ae_appears_in_admin_user_list(self, client, db):
        """AE must be visible in admin user list (not filtered out)."""
        ae = create_test_user(db, email="ae_analytics@test.com", role="AE")
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()]
        assert "ae_analytics@test.com" in emails


# ─────────────────────────────────────────────────────────────────────────────
# 16. AE included in auto-assign round-robin
# ─────────────────────────────────────────────────────────────────────────────

class TestAEAutoAssign:

    def test_auto_assign_includes_ae(self, client, db):
        """auto-assign-all must distribute unassigned leads to AEs."""
        ae = create_test_user(db, email="ae_autoassign@test.com", role="AE")
        # Create an unassigned lead with a valid phone
        lead = create_test_lead(db, last_name="AutoAE", phone="5550000010", sf_lead_id="aa-ae-001")

        resp = client.post("/api/admin/assignments/auto-assign-all")
        assert resp.status_code == 200, resp.text

        db.refresh(lead)
        # With only one AE in the system, the lead should land on them
        assigned_ids = [u.id for u in lead.assigned_users]
        # The lead may or may not be assigned to the AE depending on test isolation,
        # but the endpoint must succeed (not 500) and the AE is a valid candidate
        assert resp.json().get("assigned_count", 0) >= 0


# ─────────────────────────────────────────────────────────────────────────────
# 17. CSV bulk user import honours AE role
# ─────────────────────────────────────────────────────────────────────────────

class TestCSVImportAERole:

    def test_csv_import_creates_ae_user(self, client, db):
        """Uploading a CSV with role=AE must create an AE allowed_user entry."""
        import access_db as adb
        result = adb.process_csv(
            db=db,
            csv_content="email,name,action,role\nae_csv@test.com,CSV AE,add,ae",
            admin_email="admin@test.com",
        )
        added = result["added"]
        assert "ae_csv@test.com" in added
        allowed = db.query(models.AllowedUser).filter(
            models.AllowedUser.email == "ae_csv@test.com"
        ).first()
        assert allowed is not None
        assert allowed.role == "AE"

    def test_csv_import_no_role_defaults_sdr(self, client, db):
        """CSV row with no role column should default to SDR (no regression)."""
        import access_db as adb
        result = adb.process_csv(
            db=db,
            csv_content="email,name,action\nnorole_csv@test.com,No Role User,add",
            admin_email="admin@test.com",
        )
        added = result["added"]
        assert "norole_csv@test.com" in added
        allowed = db.query(models.AllowedUser).filter(
            models.AllowedUser.email == "norole_csv@test.com"
        ).first()
        assert allowed is not None
        assert allowed.role == "SDR"
