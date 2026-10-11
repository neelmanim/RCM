"""
Tests for the AE Pipeline (Phase 1 — AE/CSM expansion): opportunity
visibility scoping, the "Close deal" action (Won creates a ClosingBrief,
Lost doesn't, a locked brief blocks a re-close), and call logging.

Modeled on test_csm_role.py's / test_ae_role.py's fixture conventions
(`client`, `client_as_ae`, `client_as_sdr` from tests.conftest — `client` is
Super Admin by default, sub="test-user-id"; `client_as_ae`'s AE_USER has
sub="ae-user-id", so any Opportunity meant to be "this AE's own" must be
created with owner_user_id="ae-user-id" to match).
"""
import models
from tests.conftest import create_test_user


def _make_opportunity(db, owner_user_id=None, is_closed=False, is_won=False, id=None):
    opp = models.Opportunity(
        id=id, sf_opportunity_id=f"006TEST{id or owner_user_id or 'X'}",
        name="Test Deal", amount=10000, owner_user_id=owner_user_id,
        is_closed=is_closed, is_won=is_won, stage_name="Negotiation",
    )
    db.add(opp)
    db.commit()
    db.refresh(opp)
    return opp


class TestOpportunityVisibilityScoping:

    def test_ae_sees_only_own_opportunities(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        create_test_user(db, email="other-ae@test.com", role="AE", id="other-ae-id")
        mine = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-mine")
        _make_opportunity(db, owner_user_id="other-ae-id", id="opp-other")

        resp = client_as_ae.get("/api/ae-pipeline/opportunities")
        assert resp.status_code == 200, resp.text
        ids = [o["id"] for o in resp.json()]
        assert ids == [mine.id]

    def test_super_admin_sees_all_opportunities(self, client, db):
        create_test_user(db, email="ae1@test.com", role="AE", id="ae-1")
        create_test_user(db, email="ae2@test.com", role="AE", id="ae-2")
        _make_opportunity(db, owner_user_id="ae-1", id="opp-1")
        _make_opportunity(db, owner_user_id="ae-2", id="opp-2")

        resp = client.get("/api/ae-pipeline/opportunities")
        assert resp.status_code == 200, resp.text
        ids = {o["id"] for o in resp.json()}
        assert ids == {"opp-1", "opp-2"}

    def test_rows_carry_the_owning_ae_name_not_just_the_id(self, client, db):
        """An admin sees every AE's deals through this endpoint, so the row has
        to say whose deal it is. owner_user_id alone is a UUID the UI can't
        render, which is what left the table's new AE column blank."""
        create_test_user(db, email="rohan@test.com", role="AE", id="ae-1", name="Rohan Pillai")
        _make_opportunity(db, owner_user_id="ae-1", id="opp-owned")
        _make_opportunity(db, owner_user_id=None, id="opp-unowned")

        resp = client.get("/api/ae-pipeline/opportunities")
        assert resp.status_code == 200, resp.text
        by_id = {o["id"]: o for o in resp.json()}
        assert by_id["opp-owned"]["owner_name"] == "Rohan Pillai"
        # Nullable FK (ondelete="SET NULL"), so the key must still be present.
        assert by_id["opp-unowned"]["owner_name"] is None

    def test_sdr_rejected_with_403(self, client_as_sdr, db):
        create_test_user(db, email="sdr@test.com", role="SDR", id="sdr-user-id")
        resp = client_as_sdr.get("/api/ae-pipeline/opportunities")
        assert resp.status_code == 403, resp.text


class TestCloseDeal:

    def test_close_as_won_creates_closing_brief_and_flips_flags(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-won")

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": True, "close_date": "2026-09-11",
            "champion_name": "Jane Doe", "champion_role": "VP Eng",
            "champion_contact": "jane@acme.com",
            "promises_made": "Quarterly usage report",
            "handover_notes": "Champion is bought in, watch renewal timing.",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["is_closed"] is True
        assert body["is_won"] is True

        db.refresh(opp)
        assert opp.is_closed is True
        assert opp.is_won is True
        # Salesforce derives IsClosed/IsWon from StageName, so the stage has to
        # move off "Negotiation" or the write-back payload contradicts itself
        # (and the UI shows a Closed Won deal still sitting in Negotiation).
        assert opp.stage_name == "Closed Won"
        brief = db.query(models.ClosingBrief).filter(models.ClosingBrief.opportunity_id == opp.id).first()
        assert brief is not None
        assert brief.champion_name == "Jane Doe"
        assert brief.promises_made == "Quarterly usage report"

    def test_close_as_lost_does_not_create_closing_brief(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-lost")

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": False, "close_date": "2026-09-11",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["is_closed"] is True
        assert body["is_won"] is False

        db.refresh(opp)
        assert opp.stage_name == "Closed Lost"
        brief = db.query(models.ClosingBrief).filter(models.ClosingBrief.opportunity_id == opp.id).first()
        assert brief is None

    def test_close_requires_sf_close_fields_when_synced_and_writeback_is_on(self, client_as_ae, db):
        """Live finding, 2026-09-15: this org rejects any Closed-stage push
        without Standard_Product_Name__c + Invoice_Number__c. Only enforced
        when a push will actually happen — synced (has sf_opportunity_id)
        and writeback on."""
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        db.add(models.SyncSettings(opportunity_writeback_enabled=True))
        db.commit()
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-needs-sf-fields")

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": False, "close_date": "2026-09-11",
        })
        assert resp.status_code == 400, resp.text
        assert "standard_product_names" in resp.json()["detail"]
        assert "invoice_number" in resp.json()["detail"]

    def test_close_stores_and_pushes_sf_close_fields_when_provided(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        db.add(models.SyncSettings(opportunity_writeback_enabled=True))
        db.commit()
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-with-sf-fields")

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": False, "close_date": "2026-09-11",
            "standard_product_names": ["SMS Pack - Regal", "Long code"],
            "invoice_number": "INV-1001",
            "lost_reason": "Budget",
        })
        assert resp.status_code == 200, resp.text

        db.refresh(opp)
        assert opp.standard_product_names == "SMS Pack - Regal;Long code"
        assert opp.invoice_number == "INV-1001"
        assert opp.lost_reason == "Budget"

    def test_close_requires_lost_reason_for_a_lost_close_when_synced(self, client_as_ae, db):
        """Live finding, 2026-09-16: this org also requires
        Opportunity_Lost_Reason__c on a Closed Lost push, on top of the
        Standard Product/Invoice fields required for any Closed push."""
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        db.add(models.SyncSettings(opportunity_writeback_enabled=True))
        db.commit()
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-needs-lost-reason")

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": False, "close_date": "2026-09-11",
            "standard_product_names": ["SMS Pack - Regal"], "invoice_number": "INV-1002",
        })
        assert resp.status_code == 400, resp.text
        assert "lost_reason" in resp.json()["detail"]

    def test_close_does_not_require_lost_reason_for_a_won_close(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        db.add(models.SyncSettings(opportunity_writeback_enabled=True))
        db.commit()
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-won-no-lost-reason")

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": True, "close_date": "2026-09-11",
            "standard_product_names": ["SMS Pack - Regal"], "invoice_number": "INV-1003",
            "champion_name": "Lucius Fox", "champion_role": "VP Ops",
            "champion_contact": "lucius@wayne.com", "promises_made": "QBR",
            "handover_notes": "Handled",
        })
        assert resp.status_code == 200, resp.text

    def test_close_does_not_require_sf_fields_when_not_synced_to_sf(self, client_as_ae, db):
        """A Alternate CRM-native Opportunity (no sf_opportunity_id) has nothing
        for this org's SF validation rule to reject — must not be blocked."""
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        db.add(models.SyncSettings(opportunity_writeback_enabled=True))
        db.commit()
        opp = models.Opportunity(
            id="opp-local-only", owner_user_id="ae-user-id", sf_opportunity_id=None,
            name="Local Deal", amount=5000, stage_name="Negotiation",
        )
        db.add(opp)
        db.commit()

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": False, "close_date": "2026-09-11",
        })
        assert resp.status_code == 200, resp.text

    def test_closing_a_locked_brief_opportunity_returns_409(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-locked", is_closed=True, is_won=True)
        brief = models.ClosingBrief(
            opportunity_id=opp.id, champion_name="Existing Champion",
            promises_made="Already handed over", locked=True,
        )
        db.add(brief)
        db.commit()

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": True, "close_date": "2026-09-11",
            "champion_name": "New Name", "champion_role": "CTO",
            "champion_contact": "new@acme.com",
            "promises_made": "Different promise", "handover_notes": "Different notes",
        })
        assert resp.status_code == 409, resp.text

    def test_reclosing_an_already_closed_opportunity_with_no_brief_returns_409(self, client_as_ae, db):
        """Regression test: a historical Closed-Won opportunity with no brief
        (e.g. backfilled before this feature existed) used to be silently
        re-closable — overwriting close_date and fabricating a brand-new
        handover brief for an already-final deal. Confirmed live on staging."""
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-historical", is_closed=True, is_won=True)
        assert db.query(models.ClosingBrief).filter(models.ClosingBrief.opportunity_id == opp.id).first() is None

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": True, "close_date": "2026-09-11",
            "champion_name": "Injected", "champion_role": "Test",
            "champion_contact": "test@test.com",
            "promises_made": "test", "handover_notes": "test",
        })
        assert resp.status_code == 409, resp.text
        assert db.query(models.ClosingBrief).filter(models.ClosingBrief.opportunity_id == opp.id).first() is None

    def test_close_as_won_logs_account_activity(self, client_as_ae, db):
        account = models.Account(id="acct-close-log", name="Close Log Co")
        db.add(account)
        db.commit()
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = models.Opportunity(
            id="opp-close-log", account_id=account.id, owner_user_id="ae-user-id",
            name="Deal", amount=5000, is_closed=False, is_won=False,
        )
        db.add(opp)
        db.commit()

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/close", json={
            "won": True, "close_date": "2026-09-11",
            "champion_name": "Jane", "champion_role": "VP",
            "champion_contact": "jane@test.com",
            "promises_made": "x", "handover_notes": "y",
        })
        assert resp.status_code == 200, resp.text
        activity = db.query(models.AccountActivity).filter(models.AccountActivity.account_id == account.id).first()
        assert activity is not None
        assert activity.kind == "playbook_deal_closed"


class TestUpdateOpportunity:

    def test_ae_updates_stage_and_close_date_on_open_opportunity(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-update")

        resp = client_as_ae.patch(f"/api/ae-pipeline/opportunities/{opp.id}", json={
            "stage_name": "Proposal", "close_date": "2026-12-01",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["stage_name"] == "Proposal"
        assert body["close_date"].startswith("2026-12-01")

        db.refresh(opp)
        assert opp.stage_name == "Proposal"

    def test_update_rejected_on_already_closed_opportunity(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-closed-update", is_closed=True, is_won=True)

        resp = client_as_ae.patch(f"/api/ae-pipeline/opportunities/{opp.id}", json={"stage_name": "Proposal"})
        assert resp.status_code == 409, resp.text


class TestSalesforceWritebackGate:
    """opportunity_writeback_enabled — a master off-by-default switch for the
    AE/CSM action-triggered pushes, separate from opportunity_sync_direction
    (which only ever gated the scheduled bulk pull). Daemon threads are
    no-ops under pytest either way, so the only observable thing to test is
    whether a push thread gets constructed at all."""

    def test_disabled_by_default_no_sync_settings_row(self, db, monkeypatch):
        import routes.ae_pipeline_routes as ae_routes
        calls = []

        class _FakeThread:
            def __init__(self, *a, **kw):
                calls.append(kw)

            def start(self):
                pass

        monkeypatch.setattr(ae_routes.threading, "Thread", _FakeThread)
        ae_routes._maybe_push_opportunity_change(db, "some-opp-id")
        assert calls == []

    def test_enabled_via_sync_settings_starts_push_thread(self, db, monkeypatch):
        import routes.ae_pipeline_routes as ae_routes
        db.add(models.SyncSettings(opportunity_writeback_enabled=True))
        db.commit()

        calls = []

        class _FakeThread:
            def __init__(self, *a, **kw):
                calls.append(kw)

            def start(self):
                pass

        monkeypatch.setattr(ae_routes.threading, "Thread", _FakeThread)
        ae_routes._maybe_push_opportunity_change(db, "some-opp-id")
        assert len(calls) == 1


class TestStageOptionsAndPushVisibility:
    def test_stage_options_empty_list_when_sf_not_configured(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        resp = client_as_ae.get("/api/ae-pipeline/opportunities/stage-options")
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    def test_opportunity_row_reports_push_status_fields(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-push-fields")
        opp.sf_push_status = "failed"
        opp.sf_push_error = "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST"
        db.commit()

        resp = client_as_ae.get(f"/api/ae-pipeline/opportunities/{opp.id}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["sf_push_status"] == "failed"
        assert body["sf_push_error"] == "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST"


class TestCallLogging:

    def test_call_log_post_creates_opportunity_call_attributed_to_caller(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-call")

        resp = client_as_ae.post(f"/api/ae-pipeline/opportunities/{opp.id}/calls", json={
            "outcome": "Connected", "notes": "Discussed renewal timeline",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["outcome"] == "Connected"
        assert body["user_id"] == "ae-user-id"

        call = db.query(models.OpportunityCall).filter(models.OpportunityCall.opportunity_id == opp.id).first()
        assert call is not None
        assert call.user_id == "ae-user-id"
        assert call.outcome == "Connected"
        assert call.notes == "Discussed renewal timeline"


class TestAdminWriteBoundary:
    """Admins see every AE's deals (oversight, matching the AE leaderboard)
    but must not act as them. Originally every write reused
    _get_owned_opportunity_or_403, which returns early for admins — so a
    Super Admin could close another AE's deal, which writes a ClosingBrief
    stamped with the admin's id, locks it against the real owner, fires the
    CSM handover email and pushes Closed-Won to Salesforce.
    """

    def test_admin_can_still_read_another_aes_deal(self, client, db):
        create_test_user(db, email="ae1@test.com", role="AE", id="ae-1")
        opp = _make_opportunity(db, owner_user_id="ae-1", id="opp-read")

        resp = client.get(f"/api/ae-pipeline/opportunities/{opp.id}")
        assert resp.status_code == 200, resp.text

    def test_admin_cannot_close_another_aes_deal(self, client, db):
        create_test_user(db, email="ae1@test.com", role="AE", id="ae-1")
        opp = _make_opportunity(db, owner_user_id="ae-1", id="opp-close")

        resp = client.post(
            f"/api/ae-pipeline/opportunities/{opp.id}/close",
            json={"won": True, "close_date": "2026-10-01", "champion_name": "X",
                  "champion_role": "VP", "champion_contact": "x@y.com",
                  "promises_made": "p", "handover_notes": "h"},
        )
        assert resp.status_code == 403, resp.text
        db.refresh(opp)
        assert opp.is_closed is False
        # The brief is the real damage — it locks against the owning AE.
        assert db.query(models.ClosingBrief).filter(
            models.ClosingBrief.opportunity_id == opp.id
        ).first() is None

    def test_admin_cannot_log_a_call_on_another_aes_deal(self, client, db):
        """CallLog feeds the AE leaderboard, so this one inflates a rep's
        numbers rather than just editing their deal."""
        create_test_user(db, email="ae1@test.com", role="AE", id="ae-1")
        opp = _make_opportunity(db, owner_user_id="ae-1", id="opp-call")

        resp = client.post(
            f"/api/ae-pipeline/opportunities/{opp.id}/calls",
            json={"outcome": "Interested", "notes": "drive-by"},
        )
        assert resp.status_code == 403, resp.text

    def test_admin_cannot_update_another_aes_deal(self, client, db):
        create_test_user(db, email="ae1@test.com", role="AE", id="ae-1")
        opp = _make_opportunity(db, owner_user_id="ae-1", id="opp-update")

        resp = client.patch(
            f"/api/ae-pipeline/opportunities/{opp.id}", json={"stage_name": "Negotiation"}
        )
        assert resp.status_code == 403, resp.text

    def test_admin_may_act_on_an_unowned_deal(self, client, db):
        """owner_user_id is ondelete="SET NULL", so a departed rep's deals land
        here — this is the real "close out the leaver's pipeline" case, and it
        must stay open or those deals become permanently unclosable."""
        opp = _make_opportunity(db, owner_user_id=None, id="opp-orphan")

        resp = client.patch(
            f"/api/ae-pipeline/opportunities/{opp.id}", json={"stage_name": "Negotiation"}
        )
        assert resp.status_code == 200, resp.text

    def test_the_owning_ae_is_unaffected(self, client_as_ae, db):
        create_test_user(db, email="ae@test.com", role="AE", id="ae-user-id")
        opp = _make_opportunity(db, owner_user_id="ae-user-id", id="opp-mine-write")

        resp = client_as_ae.patch(
            f"/api/ae-pipeline/opportunities/{opp.id}", json={"stage_name": "Negotiation"}
        )
        assert resp.status_code == 200, resp.text
