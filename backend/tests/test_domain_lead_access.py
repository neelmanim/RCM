"""domain/lead_access.py — the visibility rule, tested at the domain boundary.

These exist because the rule moved out of routes/lead_helpers.py. The 2,790
existing tests are the behaviour-preservation net (every list, export,
analytics and count endpoint runs through this query); these add the thing
that net never had — direct, transport-free coverage of each role's scope,
callable without constructing an HTTP request or a JWT.
"""
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import models
from domain.actor import Actor, SUPER_ADMIN, POD_ADMIN, SDR, AE
from domain.lead_access import visible_leads


# ── Actor ────────────────────────────────────────────────────────────────────

class TestActor:

    def test_normalises_the_v1_admin_spelling(self):
        """Old tokens and old rows say "Admin". The rule must not have to know."""
        assert Actor.from_claims({"role": "Admin"}).is_super_admin is True
        assert Actor.from_claims({"role": SUPER_ADMIN}).is_super_admin is True

    def test_is_admin_covers_both_admin_tiers_and_nothing_else(self):
        # 27 inline `role == "..."` comparisons across 12 route files is what
        # this predicate replaces; getting the tier wrong is how privilege
        # escalation ships.
        assert Actor.from_claims({"role": POD_ADMIN}).is_admin is True
        assert Actor.from_claims({"role": SUPER_ADMIN}).is_admin is True
        assert Actor.from_claims({"role": SDR}).is_admin is False
        assert Actor.from_claims({"role": AE}).is_admin is False

    def test_missing_or_unknown_role_grants_nothing(self):
        for claims in ({}, {"role": None}, {"role": ""}, {"role": "Intern"}):
            a = Actor.from_claims(claims)
            assert a.is_super_admin is False
            assert a.is_admin is False
            assert a.is_pod_admin is False

    def test_a_service_actor_is_distinguishable_from_a_real_super_admin(self):
        svc = Actor.service("public-api-key")
        assert svc.is_super_admin is True   # same reach
        assert svc.is_service is True       # but auditable as non-human
        assert Actor.from_claims({"role": SUPER_ADMIN, "sub": "u1"}).is_service is False

    def test_is_immutable_so_a_rule_cannot_widen_its_own_caller(self):
        a = Actor.from_claims({"role": SDR, "sub": "u1"})
        with pytest.raises(Exception):
            a.role = SUPER_ADMIN


# ── Visibility ───────────────────────────────────────────────────────────────

def _lead(db, **kw):
    lead = models.Lead(id=str(uuid.uuid4()), first_name="T", last_name="Lead", **kw)
    db.add(lead)
    return lead


def _user(db, role, pod_id=None):
    u = models.User(id=str(uuid.uuid4()), email=f"{uuid.uuid4().hex[:8]}@t.test",
                    name="T", role=role, pod_id=pod_id)
    db.add(u)
    return u


class TestVisibleLeads:

    def test_super_admin_sees_every_live_lead(self, db):
        a, b = _lead(db), _lead(db)
        db.commit()
        ids = {l.id for l in visible_leads(db, Actor.from_claims({"role": SUPER_ADMIN})).all()}
        assert {a.id, b.id} <= ids

    def test_soft_deleted_leads_are_hidden_from_every_role(self, db):
        live, gone = _lead(db), _lead(db)
        db.commit()
        gone.deleted_at = datetime.now(timezone.utc)
        db.commit()
        for role in (SUPER_ADMIN, POD_ADMIN, SDR, AE):
            ids = {l.id for l in visible_leads(
                db, Actor.from_claims({"role": role, "sub": "nobody", "pod_id": "p"})).all()}
            assert gone.id not in ids, f"{role} could see a soft-deleted lead"

    def test_an_sdr_sees_only_leads_assigned_to_them(self, db):
        mine, theirs = _lead(db), _lead(db)
        me, other = _user(db, SDR), _user(db, SDR)
        db.commit()
        db.execute(models.lead_assignments.insert().values(lead_id=mine.id, user_id=me.id))
        db.execute(models.lead_assignments.insert().values(lead_id=theirs.id, user_id=other.id))
        db.commit()
        ids = {l.id for l in visible_leads(
            db, Actor.from_claims({"role": SDR, "sub": me.id})).all()}
        assert mine.id in ids
        assert theirs.id not in ids

    def test_an_ae_is_scoped_the_same_way_as_an_sdr(self, db):
        """AE and SDR share the individual-contributor scope. Asserted because
        the rule branches on `is_pod_admin`/`is_super_admin` and lets everything
        else fall through — a new role would land here silently."""
        mine, theirs = _lead(db), _lead(db)
        me = _user(db, AE)
        db.commit()
        db.execute(models.lead_assignments.insert().values(lead_id=mine.id, user_id=me.id))
        db.commit()
        ids = {l.id for l in visible_leads(
            db, Actor.from_claims({"role": AE, "sub": me.id})).all()}
        assert ids == {mine.id}

    def test_pod_admin_sees_pod_members_leads_plus_the_unassigned_pool(self, db):
        pod = models.Pod(name=f"pod-{uuid.uuid4().hex[:6]}")
        db.add(pod)
        db.commit()
        member = _user(db, SDR, pod_id=pod.id)
        outsider = _user(db, SDR)
        assigned_in_pod, assigned_outside = _lead(db), _lead(db)
        pool = _lead(db, pod_id=pod.id)             # pod-tagged, unassigned
        unrelated = _lead(db)                        # neither
        db.commit()
        db.execute(models.lead_assignments.insert().values(
            lead_id=assigned_in_pod.id, user_id=member.id))
        db.execute(models.lead_assignments.insert().values(
            lead_id=assigned_outside.id, user_id=outsider.id))
        db.commit()

        ids = {l.id for l in visible_leads(
            db, Actor.from_claims({"role": POD_ADMIN, "sub": "pa", "pod_id": pod.id})).all()}
        assert assigned_in_pod.id in ids, "pod member's assigned lead must be visible"
        assert pool.id in ids, "pod-tagged unassigned lead must be visible"
        assert assigned_outside.id not in ids, "another pod's lead must not leak"
        assert unrelated.id not in ids

    def test_pod_admin_global_view_bypasses_pod_scoping(self, db):
        pod = models.Pod(name=f"pod-{uuid.uuid4().hex[:6]}")
        db.add(pod)
        db.commit()
        elsewhere = _lead(db)
        db.commit()
        actor = Actor.from_claims({"role": POD_ADMIN, "sub": "pa", "pod_id": pod.id})
        assert elsewhere.id not in {l.id for l in visible_leads(db, actor).all()}
        assert elsewhere.id in {l.id for l in visible_leads(db, actor, global_view=True).all()}

    def test_pod_admin_with_no_pod_sees_nothing_rather_than_everything(self, db):
        """A missing pod_id is a data error. Failing closed is the whole point —
        failing open would hand one pod's admin the entire lead database."""
        _lead(db)
        db.commit()
        actor = Actor.from_claims({"role": POD_ADMIN, "sub": "pa", "pod_id": None})
        assert visible_leads(db, actor).all() == []

    def test_an_unknown_role_falls_through_to_assignment_scoping_not_open_access(self, db):
        _lead(db)
        db.commit()
        actor = Actor.from_claims({"role": "Intern", "sub": "nobody"})
        assert visible_leads(db, actor).all() == []
