"""
Tests for the CSM Portal Beta (Phase 2) routes — backend/routes/csm_portal_routes.py.

Not yet wired into main.py (orchestrator does that after both parallel Phase
1/Phase 2 builds land), so this file builds its own minimal FastAPI app with
just the csm-portal router, rather than touching conftest.py's shared
_build_test_app (which the parallel Phase 1 — AE Pipeline build may also be
touching). Reuses conftest's `db`/`engine`/`create_test_user` fixtures —
those are already shared, stable infrastructure, not route wiring.

Run with: JWT_SECRET=test_secret .venv/bin/pytest backend/tests/test_csm_portal.py -q
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import models
from tests.conftest import create_test_user

import routes.csm_portal_routes as csm_portal_routes


def _build_app():
    app = FastAPI(title="CSM Portal Test")
    app.include_router(csm_portal_routes.router)
    return app


def _user_payload(sub, role, email=None, name=None, pod_id=None):
    return {"sub": sub, "email": email or f"{sub}@test.com", "name": name or sub, "role": role, "pod_id": pod_id}


@pytest.fixture()
def client_as(db):
    """Factory: client_as(payload) -> TestClient authenticated as that user.
    Does NOT override require_admin_or_csm — the real role check runs, same
    as the rest of the suite lets require_admin_or_ae etc. run for real."""
    def _make(user_payload):
        app = _build_app()
        from database import get_db
        from auth import get_current_user

        def _override_db():
            yield db

        app.dependency_overrides[get_db] = _override_db
        app.dependency_overrides[get_current_user] = lambda: user_payload
        return TestClient(app)

    return _make


def _make_account(db, csm_id=None, name="Acme Corp", sf_account_id=None):
    account = models.Account(name=name, assigned_csm_id=csm_id, sf_account_id=sf_account_id)
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def _make_open_opportunity(db, account_id, days_out=300, amount=80000, is_won=False, is_closed=False):
    opp = models.Opportunity(
        account_id=account_id,
        name="Renewal",
        amount=amount,
        close_date=datetime.now(timezone.utc) + timedelta(days=days_out),
        is_closed=is_closed,
        is_won=is_won,
        stage_name="Negotiation",
    )
    db.add(opp)
    db.commit()
    db.refresh(opp)
    return opp


def _make_touch(db, account_id, created_by=None, when=None):
    activity = models.AccountActivity(
        account_id=account_id, kind="csm_touch", note="talked to champion",
        created_by=created_by, created_at=when or datetime.now(timezone.utc),
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


class TestPortfolioScoping:
    def test_csm_sees_only_own_portfolio_admin_sees_all(self, db, client_as):
        csm_a = create_test_user(db, id="csm-a", email="csm-a@test.com", role="CSM")
        csm_b = create_test_user(db, id="csm-b", email="csm-b@test.com", role="CSM")
        _make_account(db, csm_id=csm_a.id, name="A1")
        _make_account(db, csm_id=csm_a.id, name="A2")
        _make_account(db, csm_id=csm_b.id, name="B1")

        resp_a = client_as(_user_payload(csm_a.id, "CSM")).get("/api/csm-portal/portfolio")
        assert resp_a.status_code == 200, resp_a.text
        body_a = resp_a.json()
        assert body_a["count"] == 2
        assert all(item["assigned_csm_id"] == csm_a.id for item in body_a["accounts"])

        resp_admin = client_as(_user_payload("super-1", "Super Admin")).get("/api/csm-portal/portfolio")
        assert resp_admin.status_code == 200
        assert resp_admin.json()["count"] == 3


class TestPodAdminCsmPortalScope:
    """Decided 2026-09-17: a CSM manager (e.g. Kanika) with reportee CSMs
    gets a Pod for her team and is made that pod's Pod Admin — she can then
    see (not edit) her team's combined portfolio here. Previously Pod Admin
    was excluded from the CSM Portal entirely."""

    def _pod(self, db, name="Kanika's Team"):
        pod = models.Pod(name=name)
        db.add(pod)
        db.commit()
        return pod

    def test_pod_admin_sees_her_pods_csms_but_not_other_pods(self, db, client_as):
        pod_a = self._pod(db, "Pod A")
        pod_b = self._pod(db, "Pod B")
        kanika = create_test_user(db, id="kanika", email="kanika@test.com", role="Pod Admin", pod_id=pod_a.id)
        csm_in_pod = create_test_user(db, id="csm-in-pod", email="csm-in-pod@test.com", role="CSM", pod_id=pod_a.id)
        csm_other_pod = create_test_user(db, id="csm-other-pod", email="csm-other@test.com", role="CSM", pod_id=pod_b.id)
        _make_account(db, csm_id=csm_in_pod.id, name="In Pod Co")
        _make_account(db, csm_id=csm_other_pod.id, name="Other Pod Co")

        resp = client_as(_user_payload(kanika.id, "Pod Admin", pod_id=pod_a.id)).get("/api/csm-portal/portfolio")
        assert resp.status_code == 200, resp.text
        names = {a["name"] for a in resp.json()["accounts"]}
        assert names == {"In Pod Co"}

    def test_pod_admin_with_no_pod_sees_nothing(self, db, client_as):
        kanika = create_test_user(db, id="kanika-2", email="kanika2@test.com", role="Pod Admin", pod_id=None)
        csm = create_test_user(db, id="csm-x", email="csm-x@test.com", role="CSM")
        _make_account(db, csm_id=csm.id, name="Some Co")

        resp = client_as(_user_payload(kanika.id, "Pod Admin", pod_id=None)).get("/api/csm-portal/portfolio")
        assert resp.status_code == 200, resp.text
        assert resp.json()["count"] == 0

    def test_pod_admin_can_open_an_account_360_for_her_pods_csm(self, db, client_as):
        pod = self._pod(db)
        kanika = create_test_user(db, id="kanika-3", email="kanika3@test.com", role="Pod Admin", pod_id=pod.id)
        csm = create_test_user(db, id="csm-y", email="csm-y@test.com", role="CSM", pod_id=pod.id)
        account = _make_account(db, csm_id=csm.id, name="Viewable Co")

        resp = client_as(_user_payload(kanika.id, "Pod Admin", pod_id=pod.id)).get(f"/api/csm-portal/accounts/{account.id}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["account"]["name"] == "Viewable Co"

    def test_pod_admin_gets_404_for_an_account_outside_her_pod(self, db, client_as):
        pod_a = self._pod(db, "Pod A")
        pod_b = self._pod(db, "Pod B")
        kanika = create_test_user(db, id="kanika-4", email="kanika4@test.com", role="Pod Admin", pod_id=pod_a.id)
        outside_csm = create_test_user(db, id="csm-outside", email="csm-outside@test.com", role="CSM", pod_id=pod_b.id)
        account = _make_account(db, csm_id=outside_csm.id, name="Outside Co")

        resp = client_as(_user_payload(kanika.id, "Pod Admin", pod_id=pod_a.id)).get(f"/api/csm-portal/accounts/{account.id}")
        assert resp.status_code == 404, resp.text

    def test_pod_admin_cannot_log_a_touch_read_only_oversight(self, db, client_as):
        pod = self._pod(db)
        kanika = create_test_user(db, id="kanika-5", email="kanika5@test.com", role="Pod Admin", pod_id=pod.id)
        csm = create_test_user(db, id="csm-z", email="csm-z@test.com", role="CSM", pod_id=pod.id)
        account = _make_account(db, csm_id=csm.id, name="Read Only Co")

        resp = client_as(_user_payload(kanika.id, "Pod Admin", pod_id=pod.id)).post(
            f"/api/csm-portal/accounts/{account.id}/touches", json={"note": "checking in on my team"}
        )
        assert resp.status_code == 403, resp.text

    def test_pod_admin_cannot_override_health_either(self, db, client_as):
        """Health-override is a documented CSM/Super-Admin escape hatch with
        no _require_account_write_access gate — Pod Admin needs its own
        explicit block so oversight doesn't accidentally include this."""
        pod = self._pod(db)
        kanika = create_test_user(db, id="kanika-6", email="kanika6@test.com", role="Pod Admin", pod_id=pod.id)
        csm = create_test_user(db, id="csm-w", email="csm-w@test.com", role="CSM", pod_id=pod.id)
        account = _make_account(db, csm_id=csm.id, name="No Override Co")

        resp = client_as(_user_payload(kanika.id, "Pod Admin", pod_id=pod.id)).post(
            f"/api/csm-portal/accounts/{account.id}/health-override", json={"tier": "Healthy", "reason": "looks fine"}
        )
        assert resp.status_code == 403, resp.text

    def test_pod_admin_cannot_bulk_assign(self, db, client_as):
        pod = self._pod(db)
        kanika = create_test_user(db, id="kanika-7", email="kanika7@test.com", role="Pod Admin", pod_id=pod.id)
        csm = create_test_user(db, id="csm-v", email="csm-v@test.com", role="CSM", pod_id=pod.id)
        account = _make_account(db, csm_id=None, name="Unassigned Co")

        resp = client_as(_user_payload(kanika.id, "Pod Admin", pod_id=pod.id)).post(
            "/api/csm-portal/accounts/assign", json={"account_ids": [account.id], "csm_id": csm.id}
        )
        assert resp.status_code == 403, resp.text

    def test_pod_admin_csm_id_filter_narrowed_to_her_own_pod(self, db, client_as):
        """?csm_id narrows Super Admin's view to one CSM; for a Pod Admin it
        must only work for a CSM actually in her pod, not any csm_id."""
        pod_a = self._pod(db, "Pod A")
        pod_b = self._pod(db, "Pod B")
        kanika = create_test_user(db, id="kanika-8", email="kanika8@test.com", role="Pod Admin", pod_id=pod_a.id)
        csm_in_pod = create_test_user(db, id="csm-in-pod-2", email="csm-in-pod-2@test.com", role="CSM", pod_id=pod_a.id)
        csm_other_pod = create_test_user(db, id="csm-other-pod-2", email="csm-other-2@test.com", role="CSM", pod_id=pod_b.id)
        _make_account(db, csm_id=csm_in_pod.id, name="In Pod Co 2")
        _make_account(db, csm_id=csm_other_pod.id, name="Other Pod Co 2")

        client = client_as(_user_payload(kanika.id, "Pod Admin", pod_id=pod_a.id))
        resp_own = client.get(f"/api/csm-portal/portfolio?csm_id={csm_in_pod.id}")
        assert resp_own.json()["count"] == 1

        resp_outside = client.get(f"/api/csm-portal/portfolio?csm_id={csm_other_pod.id}")
        assert resp_outside.json()["count"] == 0


class TestHealthScore:
    def test_healthy_account_vs_stale_touch_account(self, db, client_as):
        csm = create_test_user(db, id="csm-1", email="csm-1@test.com", role="CSM")

        healthy = _make_account(db, csm_id=csm.id, name="Healthy Co")
        _make_open_opportunity(db, healthy.id, days_out=300, amount=90000)
        _make_touch(db, healthy.id, created_by=csm.id, when=datetime.now(timezone.utc))

        stale = _make_account(db, csm_id=csm.id, name="Stale Co")
        # no open opportunity, no touch ever

        client = client_as(_user_payload(csm.id, "CSM"))

        resp_healthy = client.get(f"/api/csm-portal/accounts/{healthy.id}")
        assert resp_healthy.status_code == 200, resp_healthy.text
        health_healthy = resp_healthy.json()["health"]
        assert health_healthy["partial"] is True
        assert health_healthy["tier"] == "Healthy"

        resp_stale = client.get(f"/api/csm-portal/accounts/{stale.id}")
        health_stale = resp_stale.json()["health"]
        assert health_stale["partial"] is True
        assert health_stale["tier"] in ("Critical", "At Risk")
        assert health_stale["score"] < health_healthy["score"]

    def test_new_account_gets_grace_not_flagged_critical(self, db, client_as):
        """Regression test: a brand-new, cleanly Closed-Won account with
        nothing wrong used to score identically to a genuinely neglected one
        (Critical), purely because no CSM had touched it yet. Confirmed live
        on staging with a 10-day-old account."""
        csm = create_test_user(db, id="csm-new", email="csm-new@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Brand New Co")
        account.customer_since = datetime.now(timezone.utc) - timedelta(days=10)
        db.commit()
        opp = _make_open_opportunity(db, account.id, is_won=True, is_closed=True)  # closed-won, nothing pending

        resp = client_as(_user_payload(csm.id, "CSM")).get(f"/api/csm-portal/accounts/{account.id}")
        assert resp.status_code == 200, resp.text
        health = resp.json()["health"]
        assert health["tier"] != "Critical"

    def test_old_untouched_account_still_reads_low(self, db, client_as):
        """The fix must not blunt the real signal — an account that's been a
        customer for a long time with no open opportunity and no track
        record of ever winning one should still read low."""
        csm = create_test_user(db, id="csm-old", email="csm-old@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Old Untouched Co")
        account.customer_since = datetime.now(timezone.utc) - timedelta(days=400)
        db.commit()
        # no opportunities at all, no touch ever

        resp = client_as(_user_payload(csm.id, "CSM")).get(f"/api/csm-portal/accounts/{account.id}")
        health = resp.json()["health"]
        assert health["tier"] == "Critical"

    def test_account_360_reports_missing_closing_brief_reason(self, db, client_as):
        csm = create_test_user(db, id="csm-2", email="csm-2@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="No Brief Co")
        resp = client_as(_user_payload(csm.id, "CSM")).get(f"/api/csm-portal/accounts/{account.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["closing_brief"] is None
        assert body["closing_brief_reason"] == "closed_before_handover_tracking"


class TestTouchLogging:
    def test_first_touch_locks_brief_second_touch_does_not_retrigger(self, db, client_as):
        csm = create_test_user(db, id="csm-3", email="csm-3@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Handover Co")
        opp = _make_open_opportunity(db, account.id, is_won=True, is_closed=True)
        brief = models.ClosingBrief(opportunity_id=opp.id, champion_name="Jane", locked=False)
        db.add(brief)
        db.commit()

        client = client_as(_user_payload(csm.id, "CSM"))

        resp1 = client.post(f"/api/csm-portal/accounts/{account.id}/touches", json={"note": "first call"})
        assert resp1.status_code == 200, resp1.text
        body1 = resp1.json()
        assert body1["first_touch"] is True
        assert body1["brief_locked"] is True

        db.refresh(brief)
        assert brief.locked is True

        resp2 = client.post(f"/api/csm-portal/accounts/{account.id}/touches", json={"note": "second call"})
        assert resp2.status_code == 200, resp2.text
        body2 = resp2.json()
        assert body2["first_touch"] is False
        assert body2["brief_locked"] is False

        touches = db.query(models.AccountActivity).filter(
            models.AccountActivity.account_id == account.id, models.AccountActivity.kind == "csm_touch"
        ).count()
        assert touches == 2


class TestChampionDeparted:
    def test_champion_departed_flips_flag_and_logs_activity(self, db, client_as):
        csm = create_test_user(db, id="csm-4", email="csm-4@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Champion Co")
        opp = _make_open_opportunity(db, account.id, is_won=True, is_closed=True)
        brief = models.ClosingBrief(opportunity_id=opp.id, champion_name="Bob", champion_active=True)
        db.add(brief)
        db.commit()

        resp = client_as(_user_payload(csm.id, "CSM")).post(f"/api/csm-portal/accounts/{account.id}/champion-departed")
        assert resp.status_code == 200, resp.text
        assert resp.json()["closing_brief"]["champion_active"] is False

        db.refresh(brief)
        assert brief.champion_active is False

        activity = db.query(models.AccountActivity).filter(
            models.AccountActivity.account_id == account.id,
            models.AccountActivity.kind == "playbook_champion_departure",
        ).first()
        assert activity is not None


class TestHealthOverride:
    def test_override_sets_displayed_tier_and_clearing_reverts_to_computed(self, db, client_as):
        csm = create_test_user(db, id="csm-5", email="csm-5@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Override Co")
        # No open opp, no touch -> computed tier should be Critical/At Risk, not Healthy
        client = client_as(_user_payload(csm.id, "CSM"))

        resp1 = client.post(
            f"/api/csm-portal/accounts/{account.id}/health-override",
            json={"tier": "Healthy", "reason": "verbally confirmed renewal"},
        )
        assert resp1.status_code == 200, resp1.text
        health1 = resp1.json()["health"]
        computed_tier = health1["tier"]
        assert computed_tier != "Healthy"  # the computed number is untouched
        assert health1["displayed_tier"] == "Healthy"  # override is what's shown

        db.refresh(account)
        assert account.manual_health_tier == "Healthy"
        assert account.health_override_reason == "verbally confirmed renewal"

        resp2 = client.post(
            f"/api/csm-portal/accounts/{account.id}/health-override",
            json={"tier": None, "reason": "renewal fell through, clearing override"},
        )
        assert resp2.status_code == 200, resp2.text
        health2 = resp2.json()["health"]
        assert health2["displayed_tier"] == health2["tier"] == computed_tier

        db.refresh(account)
        assert account.manual_health_tier is None


class TestStakeholders:
    def test_account_360_lists_stakeholders_with_role_and_new_flag(self, db, client_as):
        csm = create_test_user(db, id="csm-stake-1", email="csm-stake-1@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Stakeholder Co")
        recent = models.AccountStakeholder(
            account_id=account.id, name="New Contact", role=None,
            sf_created_at=datetime.now(timezone.utc) - timedelta(days=2),
        )
        stale = models.AccountStakeholder(
            account_id=account.id, name="Old Contact", role="Champion",
            sf_created_at=datetime.now(timezone.utc) - timedelta(days=90),
        )
        db.add_all([recent, stale])
        db.commit()

        resp = client_as(_user_payload(csm.id, "CSM")).get(f"/api/csm-portal/accounts/{account.id}")
        assert resp.status_code == 200, resp.text
        by_name = {s["name"]: s for s in resp.json()["stakeholders"]}
        assert by_name["New Contact"]["is_new"] is True
        assert by_name["New Contact"]["role"] is None
        assert by_name["Old Contact"]["is_new"] is False
        assert by_name["Old Contact"]["role"] == "Champion"

    def test_csm_can_set_and_clear_stakeholder_role(self, db, client_as):
        csm = create_test_user(db, id="csm-stake-2", email="csm-stake-2@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Role Co")
        stakeholder = models.AccountStakeholder(account_id=account.id, name="Jane")
        db.add(stakeholder)
        db.commit()
        client = client_as(_user_payload(csm.id, "CSM"))

        resp1 = client.patch(
            f"/api/csm-portal/accounts/{account.id}/stakeholders/{stakeholder.id}", json={"role": "POC"}
        )
        assert resp1.status_code == 200, resp1.text
        assert resp1.json()["role"] == "POC"
        db.refresh(stakeholder)
        assert stakeholder.role == "POC"

        resp2 = client.patch(
            f"/api/csm-portal/accounts/{account.id}/stakeholders/{stakeholder.id}", json={"role": None}
        )
        assert resp2.status_code == 200, resp2.text
        assert resp2.json()["role"] is None

    def test_rejects_invalid_role(self, db, client_as):
        csm = create_test_user(db, id="csm-stake-3", email="csm-stake-3@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Bad Role Co")
        stakeholder = models.AccountStakeholder(account_id=account.id, name="Jane")
        db.add(stakeholder)
        db.commit()

        resp = client_as(_user_payload(csm.id, "CSM")).patch(
            f"/api/csm-portal/accounts/{account.id}/stakeholders/{stakeholder.id}", json={"role": "Not A Role"}
        )
        assert resp.status_code == 400, resp.text

    def test_admin_cannot_set_role_on_another_csms_account(self, db, client_as):
        csm = create_test_user(db, id="csm-stake-4", email="csm-stake-4@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Boundary Co")
        stakeholder = models.AccountStakeholder(account_id=account.id, name="Jane")
        db.add(stakeholder)
        db.commit()

        resp = client_as(_user_payload("super-1", "Super Admin")).patch(
            f"/api/csm-portal/accounts/{account.id}/stakeholders/{stakeholder.id}", json={"role": "POC"}
        )
        assert resp.status_code == 403, resp.text


class TestMilestones:
    def _body(self, **overrides):
        body = {"milestone_type": "QBR", "label": "QBR 1", "milestone_date": "2026-09-15"}
        body.update(overrides)
        return body

    def test_creates_a_milestone_and_lists_it_on_account_360(self, db, client_as):
        csm = create_test_user(db, id="csm-mile-1", email="csm-mile-1@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Milestone Co")
        client = client_as(_user_payload(csm.id, "CSM"))

        resp = client.post(
            f"/api/csm-portal/accounts/{account.id}/milestones",
            json=self._body(cs_name="Priya", summary="Good renewal signals", action_items="Send proposal"),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["label"] == "QBR 1"
        assert body["cs_name"] == "Priya"

        detail = client.get(f"/api/csm-portal/accounts/{account.id}")
        assert len(detail.json()["milestones"]) == 1
        assert detail.json()["milestones"][0]["label"] == "QBR 1"

    def test_milestones_ordered_by_date_oldest_first(self, db, client_as):
        csm = create_test_user(db, id="csm-mile-2", email="csm-mile-2@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Timeline Co")
        client = client_as(_user_payload(csm.id, "CSM"))

        client.post(f"/api/csm-portal/accounts/{account.id}/milestones",
                    json=self._body(milestone_type="Renewal", label="Renewal", milestone_date="2027-01-01"))
        client.post(f"/api/csm-portal/accounts/{account.id}/milestones",
                    json=self._body(milestone_type="Onboarding", label="OB", milestone_date="2026-05-15",
                                     ae_name="Sam AE", use_cases="Bulk SMS"))

        detail = client.get(f"/api/csm-portal/accounts/{account.id}")
        labels = [m["label"] for m in detail.json()["milestones"]]
        assert labels == ["OB", "Renewal"]

    def test_stores_poc_stakeholder_ids(self, db, client_as):
        csm = create_test_user(db, id="csm-mile-3", email="csm-mile-3@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="POC Co")
        s1 = models.AccountStakeholder(account_id=account.id, name="Jane")
        s2 = models.AccountStakeholder(account_id=account.id, name="Bob")
        db.add_all([s1, s2])
        db.commit()

        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/milestones",
            json=self._body(milestone_type="Onboarding", label="OB", poc_stakeholder_ids=[s1.id, s2.id]),
        )
        assert resp.status_code == 200, resp.text
        assert set(resp.json()["poc_stakeholder_ids"]) == {s1.id, s2.id}

    def test_updates_a_milestone(self, db, client_as):
        csm = create_test_user(db, id="csm-mile-4", email="csm-mile-4@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Edit Co")
        client = client_as(_user_payload(csm.id, "CSM"))
        created = client.post(f"/api/csm-portal/accounts/{account.id}/milestones", json=self._body()).json()

        resp = client.patch(
            f"/api/csm-portal/accounts/{account.id}/milestones/{created['id']}",
            json=self._body(summary="Updated summary"),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["summary"] == "Updated summary"

    def test_rejects_invalid_milestone_type(self, db, client_as):
        csm = create_test_user(db, id="csm-mile-5", email="csm-mile-5@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Bad Type Co")
        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/milestones", json=self._body(milestone_type="Not A Type"),
        )
        assert resp.status_code == 400, resp.text

    def test_rejects_bad_date_format(self, db, client_as):
        csm = create_test_user(db, id="csm-mile-6", email="csm-mile-6@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Bad Date Co")
        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/milestones", json=self._body(milestone_date="09/15/2026"),
        )
        assert resp.status_code == 400, resp.text

    def test_admin_cannot_create_a_milestone_on_another_csms_account(self, db, client_as):
        csm = create_test_user(db, id="csm-mile-7", email="csm-mile-7@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Boundary Milestone Co")
        resp = client_as(_user_payload("super-1", "Super Admin")).post(
            f"/api/csm-portal/accounts/{account.id}/milestones", json=self._body(),
        )
        assert resp.status_code == 403, resp.text


class TestBulkAssign:
    def test_bulk_assign_updates_and_notifies_only_changed_accounts(self, db, client_as, monkeypatch):
        csm_a = create_test_user(db, id="csm-a2", email="csm-a2@test.com", role="CSM")
        csm_b = create_test_user(db, id="csm-b2", email="csm-b2@test.com", role="CSM")

        acc_reassign = _make_account(db, csm_id=csm_a.id, name="Reassign Co")
        acc_unassigned = _make_account(db, csm_id=None, name="Fresh Co")
        acc_already_b = _make_account(db, csm_id=csm_b.id, name="Already Co")

        calls = []
        monkeypatch.setattr(
            csm_portal_routes, "notify_account_assigned_in_background",
            lambda admin_user_id, csm_user_id, account_id: calls.append((admin_user_id, csm_user_id, account_id)),
        )

        resp = client_as(_user_payload("super-2", "Super Admin")).post(
            "/api/csm-portal/accounts/assign",
            json={"account_ids": [acc_reassign.id, acc_unassigned.id, acc_already_b.id], "csm_id": csm_b.id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["updated"] == 3
        assert body["notified"] == 2

        db.refresh(acc_reassign)
        db.refresh(acc_unassigned)
        db.refresh(acc_already_b)
        assert acc_reassign.assigned_csm_id == csm_b.id
        assert acc_unassigned.assigned_csm_id == csm_b.id
        assert acc_already_b.assigned_csm_id == csm_b.id

        notified_account_ids = {c[2] for c in calls}
        assert notified_account_ids == {acc_reassign.id, acc_unassigned.id}

    def test_bulk_assign_rejects_non_super_admin(self, db, client_as):
        csm = create_test_user(db, id="csm-6", email="csm-6@test.com", role="CSM")
        account = _make_account(db, csm_id=None, name="Guarded Co")
        resp = client_as(_user_payload(csm.id, "CSM")).post(
            "/api/csm-portal/accounts/assign", json={"account_ids": [account.id], "csm_id": csm.id}
        )
        assert resp.status_code == 403


class TestRenewalOpportunity:
    def test_renewal_opportunity_created_locally_when_account_has_no_sf_link(self, db, client_as):
        """No sf_account_id at all -> _push_new_opportunity_to_salesforce
        short-circuits before ever touching the SF client. Local row must
        still exist."""
        csm = create_test_user(db, id="csm-7", email="csm-7@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="No SF Link Co", sf_account_id=None)

        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/renewal-opportunity",
            json={"amount": 25000, "close_date": "2027-01-15"},
        )
        assert resp.status_code == 200, resp.text
        opp_id = resp.json()["opportunity"]["id"]

        opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
        assert opp is not None
        assert opp.account_id == account.id
        assert opp.sf_opportunity_id is None

    def test_local_and_pushed_stage_match(self, db, client_as):
        """The local row and the SF create payload must open on the same stage.
        They used to differ — created locally as "Renewal", pushed as
        "Prospecting" — and sync_opportunities_from_salesforce overwrites
        stage_name from SF unconditionally, so the local label was guaranteed
        to flip on the next pull. Same defect class  close path sending
        IsClosed/IsWon alongside an open StageName."""
        from salesforce import NEW_RENEWAL_STAGE

        csm = create_test_user(db, id="csm-stage", email="csm-stage@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Stage Match Co", sf_account_id=None)

        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/renewal-opportunity",
            json={"amount": 1000, "close_date": "2027-01-15"},
        )
        assert resp.status_code == 200, resp.text
        opp = db.query(models.Opportunity).filter(
            models.Opportunity.id == resp.json()["opportunity"]["id"]
        ).first()
        assert opp.stage_name == NEW_RENEWAL_STAGE

    def test_renewal_opportunity_survives_sf_push_error(self, db, client_as, monkeypatch):
        """SF is linked (account has sf_account_id) but the push itself
        blows up — local commit must already have happened and must not be
        rolled back, and the failure must be recorded on the row so the CSM
        who created the renewal can see it (same visibility guarantee as
        push_opportunity_to_salesforce's close/update path). The endpoint
        call itself proves the local create survives (daemon threads are
        no-ops under pytest, so the push never even runs); a direct call to
        the extracted push helper below proves the error path itself is
        caught, doesn't corrupt sf_opportunity_id, and does write
        sf_push_status/sf_push_error."""
        csm = create_test_user(db, id="csm-8", email="csm-8@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="SF Linked Co", sf_account_id="001TESTSFID")

        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/renewal-opportunity",
            json={"amount": 40000, "close_date": "2027-02-01"},
        )
        assert resp.status_code == 200, resp.text
        opp_id = resp.json()["opportunity"]["id"]

        opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
        assert opp is not None  # local create survived
        assert opp.sf_opportunity_id is None  # background push never ran (no-op daemon thread)

        import salesforce

        def _boom():
            raise Exception("Salesforce is down")

        monkeypatch.setattr(salesforce, "get_sf_client", _boom)

        # Exercise the extracted push helper directly (what the background
        # thread would have run) — must not raise, must not touch the row.
        csm_portal_routes._push_opportunity_to_sf(
            opp_id, {"Name": "Renewal", "AccountId": "001TESTSFID", "StageName": "Prospecting", "CloseDate": "2027-02-01"}
        )

        db.refresh(opp)
        assert opp.sf_opportunity_id is None
        assert opp.sf_push_status == "failed"
        assert "Salesforce is down" in opp.sf_push_error


class TestDigest:
    def test_digest_counts_tiers_and_estimates_time_saved(self, db, client_as):
        csm = create_test_user(db, id="csm-9", email="csm-9@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Digest Co")
        db.add(models.AccountActivity(account_id=account.id, kind="playbook_champion_departure", created_by=csm.id))
        db.add(models.AccountActivity(account_id=account.id, kind="playbook_silent_account", created_by=csm.id))
        db.commit()

        resp = client_as(_user_payload(csm.id, "CSM")).get("/api/csm-portal/digest")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total_accounts"] == 1
        assert body["playbook_executions_this_week"] == 2
        assert body["estimated_minutes_saved"] == 2 * csm_portal_routes._ASSUMED_MINUTES_PER_PLAYBOOK

    def test_digest_counts_touches_and_renewal_creation_too(self, db, client_as):
        """Regression test: the KPI used to only recognize
        playbook_champion_departure — logging a touch (Silent Account
        playbook) and creating a renewal opportunity didn't count, so the
        metric chronically undercounted real CSM activity. Confirmed live."""
        csm = create_test_user(db, id="csm-10", email="csm-10@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Active Co", sf_account_id=None)
        client = client_as(_user_payload(csm.id, "CSM"))

        r1 = client.post(f"/api/csm-portal/accounts/{account.id}/touches", json={"note": "checked in"})
        assert r1.status_code == 200, r1.text
        r2 = client.post(f"/api/csm-portal/accounts/{account.id}/renewal-opportunity", json={"amount": 1000})
        assert r2.status_code == 200, r2.text

        resp = client.get("/api/csm-portal/digest")
        body = resp.json()
        assert body["playbook_executions_this_week"] == 2  # 1 touch + 1 renewal-created

    def test_digest_counts_renewals_due_soon_including_overdue(self, db, client_as):
        """CSM feedback (2026-09-17): renewal risk wasn't proactively
        surfaced anywhere outside the Inbox tab's health score. An open
        opportunity closing soon — or already overdue — should count, one
        closing far out should not."""
        csm = create_test_user(db, id="csm-11", email="csm-11@test.com", role="CSM")
        soon = _make_account(db, csm_id=csm.id, name="Soon Co", sf_account_id="001SOON")
        overdue = _make_account(db, csm_id=csm.id, name="Overdue Co", sf_account_id="001OVERDUE")
        far_out = _make_account(db, csm_id=csm.id, name="Far Out Co", sf_account_id="001FAROUT")
        db.add(models.Opportunity(account_id=soon.id, name="Renewal", is_closed=False,
                                   close_date=datetime.now(timezone.utc) + timedelta(days=10)))
        db.add(models.Opportunity(account_id=overdue.id, name="Renewal", is_closed=False,
                                   close_date=datetime.now(timezone.utc) - timedelta(days=5)))
        db.add(models.Opportunity(account_id=far_out.id, name="Renewal", is_closed=False,
                                   close_date=datetime.now(timezone.utc) + timedelta(days=200)))
        db.commit()

        resp = client_as(_user_payload(csm.id, "CSM")).get("/api/csm-portal/digest")
        assert resp.status_code == 200, resp.text
        assert resp.json()["renewals_due_soon_count"] == 2


class TestOpportunityLifecycleFromCsm:
    """The point AE Pipeline's own close endpoint (require_admin_or_ae)
    doesn't cover: a CSM's own renewal Opportunity would otherwise dead-end,
    reachable only by an AE/Admin or by going into Salesforce directly."""

    def test_csm_updates_own_renewal_stage_and_close_date(self, db, client_as):
        csm = create_test_user(db, id="csm-11", email="csm-11@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Update Co")
        opp = _make_open_opportunity(db, account.id, days_out=60)

        resp = client_as(_user_payload(csm.id, "CSM")).patch(
            f"/api/csm-portal/accounts/{account.id}/opportunities/{opp.id}",
            json={"stage_name": "Negotiation", "close_date": "2027-03-01"},
        )
        assert resp.status_code == 200, resp.text
        db.refresh(opp)
        assert opp.stage_name == "Negotiation"

    def test_csm_closes_own_renewal_opportunity(self, db, client_as):
        csm = create_test_user(db, id="csm-12", email="csm-12@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Close Co")
        opp = _make_open_opportunity(db, account.id, days_out=30)

        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/opportunities/{opp.id}/close",
            json={
                "won": True, "close_date": "2026-09-15",
                "champion_name": "Jane", "champion_role": "VP",
                "champion_contact": "jane@test.com",
                "promises_made": "x", "handover_notes": "y",
            },
        )
        assert resp.status_code == 200, resp.text
        db.refresh(opp)
        assert opp.is_closed is True
        assert opp.is_won is True
        brief = db.query(models.ClosingBrief).filter(models.ClosingBrief.opportunity_id == opp.id).first()
        assert brief is not None

    def test_csm_cannot_reach_opportunity_outside_their_scope(self, db, client_as):
        csm_a = create_test_user(db, id="csm-13", email="csm-13@test.com", role="CSM")
        csm_b = create_test_user(db, id="csm-14", email="csm-14@test.com", role="CSM")
        account_b = _make_account(db, csm_id=csm_b.id, name="Not Yours Co")
        opp = _make_open_opportunity(db, account_b.id, days_out=30)

        resp = client_as(_user_payload(csm_a.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account_b.id}/opportunities/{opp.id}/close",
            json={"won": False, "close_date": "2026-09-15"},
        )
        assert resp.status_code == 404, resp.text


class TestOpportunityCallLogging:
    """CSM Portal's counterpart to AE Pipeline's own call log — a CSM has no
    Lead to call against, so a call to a champion/contact on one of their
    accounts logs against the account's Opportunity instead. Read side
    (get_account_360's opportunity_calls) already existed; this is the write
    side that was missing."""

    def test_csm_logs_a_call_against_their_own_opportunity(self, db, client_as):
        csm = create_test_user(db, id="csm-20", email="csm-20@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Call Co")
        opp = _make_open_opportunity(db, account.id, days_out=30)

        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/opportunities/{opp.id}/calls",
            json={"outcome": "Connected", "notes": "Talked renewal terms"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["outcome"] == "Connected"
        assert body["notes"] == "Talked renewal terms"
        assert body["opportunity_id"] == opp.id

        call = db.query(models.OpportunityCall).filter(models.OpportunityCall.opportunity_id == opp.id).one()
        assert call.user_id == csm.id

        # And it now shows up in Account 360's call history.
        detail = client_as(_user_payload(csm.id, "CSM")).get(f"/api/csm-portal/accounts/{account.id}")
        assert detail.status_code == 200, detail.text
        assert any(c["id"] == call.id for c in detail.json()["opportunity_calls"])

    def test_csm_cannot_log_a_call_on_an_account_outside_their_scope(self, db, client_as):
        csm_a = create_test_user(db, id="csm-21", email="csm-21@test.com", role="CSM")
        csm_b = create_test_user(db, id="csm-22", email="csm-22@test.com", role="CSM")
        account_b = _make_account(db, csm_id=csm_b.id, name="Not Yours Call Co")
        opp = _make_open_opportunity(db, account_b.id, days_out=30)

        resp = client_as(_user_payload(csm_a.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account_b.id}/opportunities/{opp.id}/calls",
            json={"outcome": "Connected"},
        )
        assert resp.status_code == 404, resp.text


class TestSalesforceWriteback:
    def test_stage_options_empty_when_sf_not_configured(self, db, client_as):
        csm = create_test_user(db, id="csm-16", email="csm-16@test.com", role="CSM")
        resp = client_as(_user_payload(csm.id, "CSM")).get("/api/csm-portal/stage-options")
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    def test_renewal_creation_skips_sf_push_when_writeback_disabled(self, db, client_as, monkeypatch):
        """Default (no SyncSettings row -> writeback disabled): creating a
        renewal must never attempt an SF call at all, not even for an
        SF-linked account."""
        csm = create_test_user(db, id="csm-17", email="csm-17@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Writeback Off Co", sf_account_id="001TESTLINKED")

        called = []
        monkeypatch.setattr(
            csm_portal_routes, "_push_new_opportunity_to_salesforce",
            lambda **kwargs: called.append(kwargs),
        )

        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/renewal-opportunity", json={"amount": 5000},
        )
        assert resp.status_code == 200, resp.text
        assert called == []  # writeback off by default -> never even attempted

    def test_renewal_creation_pushes_when_writeback_enabled(self, db, client_as, monkeypatch):
        csm = create_test_user(db, id="csm-18", email="csm-18@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Writeback On Co", sf_account_id="001TESTLINKED2")
        db.add(models.SyncSettings(opportunity_writeback_enabled=True))
        db.commit()

        called = []
        monkeypatch.setattr(
            csm_portal_routes, "_push_new_opportunity_to_salesforce",
            lambda **kwargs: called.append(kwargs),
        )

        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/renewal-opportunity", json={"amount": 5000},
        )
        assert resp.status_code == 200, resp.text
        assert len(called) == 1


class TestPortfolioOpenOpportunityPick:
    def test_two_open_opportunities_picks_soonest_close_date_deterministically(self, db, client_as):
        csm = create_test_user(db, id="csm-15", email="csm-15@test.com", role="CSM")
        account = _make_account(db, csm_id=csm.id, name="Two Deals Co")
        _make_open_opportunity(db, account.id, days_out=200)  # farther out
        soonest = _make_open_opportunity(db, account.id, days_out=10)  # nearest

        resp = client_as(_user_payload(csm.id, "CSM")).get("/api/csm-portal/portfolio")
        assert resp.status_code == 200, resp.text
        row = next(a for a in resp.json()["accounts"] if a["id"] == account.id)
        assert row["open_opportunity"]["id"] == soonest.id


class TestAdminWriteBoundary:
    """Admins read every portfolio (they must — bulk-assign is Super-Admin-only)
    but acting on someone else's account is the assigned CSM's job. This split
    did not exist originally: every write reused _get_scoped_account_or_404,
    which lets admins straight through, so a Super Admin could log a touch on
    any account — silently locking the AE's ClosingBrief and refreshing the
    relationship half of the health score for a CSM who never called anyone.
    """

    def _admin(self, client_as):
        return client_as(_user_payload("super-1", "Super Admin"))

    def test_admin_can_still_read_another_csms_account(self, db, client_as):
        csm = create_test_user(db, email="csm@test.com", role="CSM", id="csm-1")
        account = _make_account(db, csm_id=csm.id)

        resp = self._admin(client_as).get(f"/api/csm-portal/accounts/{account.id}")
        assert resp.status_code == 200, resp.text

    def test_admin_cannot_log_a_touch_on_another_csms_account(self, db, client_as):
        csm = create_test_user(db, email="csm@test.com", role="CSM", id="csm-1")
        account = _make_account(db, csm_id=csm.id)

        resp = self._admin(client_as).post(
            f"/api/csm-portal/accounts/{account.id}/touches", json={"note": "drive-by"}
        )
        assert resp.status_code == 403, resp.text
        assert "another CSM" in resp.json()["detail"]
        # And nothing was written.
        assert db.query(models.AccountActivity).filter(
            models.AccountActivity.account_id == account.id,
            models.AccountActivity.kind == "csm_touch",
        ).count() == 0

    def test_admin_cannot_mark_another_csms_champion_departed(self, db, client_as):
        csm = create_test_user(db, email="csm@test.com", role="CSM", id="csm-1")
        account = _make_account(db, csm_id=csm.id)

        resp = self._admin(client_as).post(f"/api/csm-portal/accounts/{account.id}/champion-departed")
        assert resp.status_code == 403, resp.text

    def test_admin_may_still_act_on_an_unassigned_account(self, db, client_as):
        """The day-one backfill case — nobody owns it yet, so there is no one
        to impersonate."""
        account = _make_account(db, csm_id=None)

        resp = self._admin(client_as).post(
            f"/api/csm-portal/accounts/{account.id}/touches", json={"note": "first contact"}
        )
        assert resp.status_code == 200, resp.text

    def test_health_override_stays_open_to_admins(self, db, client_as):
        """Deliberate exception: the plan specifies the manual health-tier
        override as 'CSM or Super Admin can force ... logged with who/when/why'
        — a designed escape hatch, unlike the writes above."""
        csm = create_test_user(db, email="csm@test.com", role="CSM", id="csm-1")
        account = _make_account(db, csm_id=csm.id)

        resp = self._admin(client_as).post(
            f"/api/csm-portal/accounts/{account.id}/health-override",
            json={"tier": "Critical", "reason": "exec escalation"},
        )
        assert resp.status_code == 200, resp.text

    def test_the_assigned_csm_is_unaffected(self, db, client_as):
        csm = create_test_user(db, email="csm@test.com", role="CSM", id="csm-1")
        account = _make_account(db, csm_id=csm.id)

        resp = client_as(_user_payload(csm.id, "CSM")).post(
            f"/api/csm-portal/accounts/{account.id}/touches", json={"note": "QBR prep"}
        )
        assert resp.status_code == 200, resp.text
