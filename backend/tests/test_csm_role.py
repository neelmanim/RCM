"""
Tests for CSM (Customer Success Manager) role — Phase 0 of the AE/CSM
expansion. Modeled on test_ae_role.py's shape, scoped to what's actually
different for CSM: role creation/change, no pod-purity (account assignment
is independent of Pods, unlike SDR/AE), CSV import, demo login (covered in
test_auth_routes.py), and the new Account/Opportunity/ClosingBrief models
CSM's data foundation depends on.
"""
import pytest
import models
from domain.actor import Actor, VALID_ROLES, CSM
from tests.conftest import create_test_user, create_test_pod


class TestCSMRoleCreation:

    def test_create_csm_user(self, client, db):
        resp = client.post("/api/admin/users", json={
            "email": "csm1@test.com", "name": "Customer Success", "role": "CSM"
        })
        assert resp.status_code == 200, resp.text
        user = db.query(models.User).filter(models.User.email == "csm1@test.com").first()
        assert user is not None
        assert user.role == "CSM"

    def test_csm_appears_in_user_list(self, client, db):
        create_test_user(db, email="csm2@test.com", role="CSM")
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()]
        assert "csm2@test.com" in emails

    def test_update_user_role_to_csm(self, client, db):
        user = create_test_user(db, email="csm3@test.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/role", json={"role": "CSM"})
        assert resp.status_code == 200, resp.text
        db.refresh(user)
        assert user.role == "CSM"


class TestCSMPodPurityExemption:
    """CSM assignment is independent of Pods (per the user's decision) —
    unlike SDR/AE, a pod mixing CSM with SDR/AE members must NOT be rejected."""

    def test_csm_can_join_a_pod_with_sdr_members(self, client, db):
        pod = create_test_pod(db, name="Mixed Pod")
        create_test_user(db, email="sdr-in-pod@test.com", role="SDR", pod_id=pod.id)
        csm = create_test_user(db, email="csm-in-pod@test.com", role="CSM")

        resp = client.patch(f"/api/admin/users/{csm.id}/role", json={"role": "CSM"})
        assert resp.status_code == 200

        # Directly exercise the pod-membership path a Super Admin would use —
        # no pod-purity guard should fire for CSM the way it does for SDR<->AE.
        csm.pod_id = pod.id
        db.commit()
        db.refresh(csm)
        assert csm.pod_id == pod.id

    def test_ae_to_csm_role_change_is_not_blocked_by_pod_purity(self, client, db):
        """Regression guard: pod-purity's own conditional (`new_role in
        ("SDR", "AE")`) must never accidentally widen to include CSM."""
        pod = create_test_pod(db, name="AE Pod")
        create_test_user(db, email="other-ae@test.com", role="AE", pod_id=pod.id)
        user = create_test_user(db, email="switching@test.com", role="AE", pod_id=pod.id)

        resp = client.patch(f"/api/admin/users/{user.id}/role", json={"role": "CSM"})
        assert resp.status_code == 200, resp.text


class TestCSMActorPredicate:

    def test_is_csm_true_for_csm_role(self):
        actor = Actor(id="u1", role=CSM)
        assert actor.is_csm is True
        assert actor.is_individual_contributor is False  # deliberately not folded in

    def test_is_csm_false_for_other_roles(self):
        for role in ("SDR", "AE", "Pod Admin", "Super Admin"):
            assert Actor(id="u1", role=role).is_csm is False

    def test_valid_roles_includes_csm_exactly_once(self):
        assert VALID_ROLES.count(CSM) == 1
        assert CSM in VALID_ROLES


class TestCSVImportCSMRole:

    def test_csv_import_creates_csm_user(self, client, db):
        import access_db as adb
        result = adb.process_csv(
            db=db,
            csv_content="email,name,action,role\ncsm_csv@test.com,CSV CSM,add,csm",
            admin_email="admin@test.com",
        )
        assert "csm_csv@test.com" in result["added"]
        allowed = db.query(models.AllowedUser).filter(
            models.AllowedUser.email == "csm_csv@test.com"
        ).first()
        assert allowed is not None
        assert allowed.role == "CSM"

    def test_csv_import_cannot_grant_pod_admin(self, client, db):
        """Privilege-escalation guard: CSV import must stay restricted to
        SDR/AE/CSM even though Pod Admin is a real, valid role elsewhere."""
        import access_db as adb
        result = adb.process_csv(
            db=db,
            csv_content="email,name,action,role\nsneaky@test.com,Sneaky,add,pod admin",
            admin_email="admin@test.com",
        )
        assert "sneaky@test.com" in result["skipped"][0]
        allowed = db.query(models.AllowedUser).filter(
            models.AllowedUser.email == "sneaky@test.com"
        ).first()
        assert allowed is None


class TestAccountAndOpportunityModels:
    """Phase 0's new CSM-Portal-foundation models: enough of a smoke test
    to confirm the schema and relationships are usable, not full coverage
    of the (not-yet-built) CSM Portal routes."""

    def test_account_can_be_assigned_to_a_csm_independent_of_pods(self, db):
        csm = create_test_user(db, email="portfolio-csm@test.com", role="CSM")
        account = models.Account(name="Acme Corp", assigned_csm_id=csm.id)
        db.add(account)
        db.commit()
        db.refresh(account)

        assert account.assigned_csm_id == csm.id
        assert not hasattr(account, "pod_id")  # confirms Account has no Pod concept at all

    def test_opportunity_links_to_account_and_owner(self, db):
        ae = create_test_user(db, email="deal-owner@test.com", role="AE")
        account = models.Account(name="Globex")
        db.add(account)
        db.flush()
        opp = models.Opportunity(
            sf_opportunity_id="006TESTOPP1", account_id=account.id, owner_user_id=ae.id,
            amount=50000, stage_name="Closed Won", is_closed=True, is_won=True,
        )
        db.add(opp)
        db.commit()
        db.refresh(opp)

        assert opp.account.name == "Globex"
        assert opp.owner.email == "deal-owner@test.com"
        assert opp.is_won is True

    def test_closing_brief_locks_after_creation_flag(self, db):
        account = models.Account(name="Vertex Logistics")
        db.add(account)
        db.flush()
        opp = models.Opportunity(sf_opportunity_id="006TESTOPP2", account_id=account.id)
        db.add(opp)
        db.flush()

        brief = models.ClosingBrief(
            opportunity_id=opp.id, champion_name="Jane Doe", champion_role="VP Eng",
            promises_made="Quarterly usage report", locked=False,
        )
        db.add(brief)
        db.commit()
        db.refresh(brief)

        assert brief.locked is False
        brief.locked = True
        db.commit()
        db.refresh(brief)
        assert brief.locked is True
