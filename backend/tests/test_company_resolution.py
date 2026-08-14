"""
E2E tests for Company-Level Call Resolution + SDR Metrics Meeting Count Fix.

Covers:
1. Company resolution detection logic (single lead, batch, edge cases)
2. API integration (list, detail, call log endpoints)
3. SCHEDULE_MEETING activity log emission from call outcome path
4. Leaderboard accuracy
"""
import pytest
from datetime import datetime, timezone

# Reuse conftest factories
from conftest import (
    create_test_user, create_test_lead, create_test_call,
    create_sync_settings, SUPER_ADMIN, SDR_USER,
)


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _assign_lead_to_user(db, lead, user):
    """Assign a lead to a user via the lead_assignments table."""
    import models
    db.execute(models.lead_assignments.insert().values(lead_id=lead.id, user_id=user.id))
    db.commit()


def _create_company_scenario(db):
    """
    Create a standard company resolution scenario:
    - 3 leads at "Acme Corp" assigned to SDR
    - 1 lead has Meeting Scheduled status
    - 2 leads are in Calling status
    Returns (sdr, lead_meeting, lead_calling_1, lead_calling_2)
    """
    sdr = create_test_user(db, email="sdr@test.com", name="SDR User", role="SDR")
    settings = create_sync_settings(db)

    lead_meeting = create_test_lead(db, first_name="Alice", last_name="Smith",
                                     company="Acme Corp", status="Meeting Scheduled",
                                     email="alice@acme.com")
    lead_calling_1 = create_test_lead(db, first_name="Bob", last_name="Jones",
                                       company="Acme Corp", status="Calling",
                                       email="bob@acme.com")
    lead_calling_2 = create_test_lead(db, first_name="Charlie", last_name="Brown",
                                       company="Acme Corp", status="Calling",
                                       email="charlie@acme.com")

    for lead in [lead_meeting, lead_calling_1, lead_calling_2]:
        _assign_lead_to_user(db, lead, sdr)

    return sdr, lead_meeting, lead_calling_1, lead_calling_2


# ════════════════════════════════════════════════════════════════════════════
# 1. Company Resolution Detection
# ════════════════════════════════════════════════════════════════════════════

class TestCompanyResolutionDetection:
    """Test the _get_company_resolution helper logic."""

    def test_resolved_when_sibling_has_meeting_status(self, db):
        """When a sibling lead at the same company has Meeting Scheduled, resolution should be detected."""
        sdr, lead_meeting, lead_calling_1, _ = _create_company_scenario(db)

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead_calling_1)
        assert result is not None
        assert result["resolved"] is True
        assert result["resolved_by"] == "Alice Smith"

    def test_not_resolved_for_lead_with_meeting_itself(self, db):
        """The lead that HAS the meeting should not flag itself as resolved
        (the function returns None when no OTHER sibling has a meeting,
        or the resolved lead is itself excluded via id != check)."""
        sdr = create_test_user(db, email="sdr@test.com", name="SDR", role="SDR")
        create_sync_settings(db)
        # Only 1 lead at this company
        lead_solo = create_test_lead(db, first_name="Solo", last_name="Person",
                                      company="SoloCo", status="Meeting Scheduled",
                                      email="solo@soloco.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead_solo)
        # No siblings exist, so no resolution
        assert result is None

    def test_meeting_lead_resolved_when_sibling_also_has_meeting(self, db):
        """When TWO leads at a company both have Meeting Scheduled,
        each should see the OTHER as resolved."""
        create_sync_settings(db)
        lead_m1 = create_test_lead(db, first_name="Tom", last_name="A",
                                    company="DualMeet", status="Meeting Scheduled",
                                    email="tom@dual.com")
        lead_m2 = create_test_lead(db, first_name="Uma", last_name="B",
                                    company="DualMeet", status="Meeting Scheduled",
                                    email="uma@dual.com")

        from routes.lead_routes import _get_company_resolution
        r1 = _get_company_resolution(db, lead_m1)
        r2 = _get_company_resolution(db, lead_m2)
        assert r1 is not None and r1["resolved"] is True
        assert r2 is not None and r2["resolved"] is True

    def test_not_resolved_when_no_meeting_at_company(self, db):
        """No resolution when no sibling has a meeting."""
        create_sync_settings(db)
        lead1 = create_test_lead(db, first_name="Dan", company="NoMeeting Inc", status="Calling", email="dan@test.com")
        lead2 = create_test_lead(db, first_name="Eve", company="NoMeeting Inc", status="Calling", email="eve@test.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead1)
        assert result is None

    def test_not_resolved_when_company_is_empty(self, db):
        """Leads with empty company should never resolve."""
        create_sync_settings(db)
        lead = create_test_lead(db, first_name="Frank", company="", status="Calling", email="frank@test.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead)
        assert result is None

    def test_not_resolved_when_company_is_none(self, db):
        """Leads with None company should never resolve."""
        create_sync_settings(db)
        lead = create_test_lead(db, first_name="Grace", company="placeholder", status="Calling", email="grace@test.com")
        lead.company = None
        db.commit()

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead)
        assert result is None

    def test_case_insensitive_company_match(self, db):
        """Company matching should be case-insensitive."""
        create_sync_settings(db)
        lead_meeting = create_test_lead(db, first_name="Hank", last_name="M",
                                         company="ACME CORP",
                                         status="Meeting Scheduled", email="hank@acme.com")
        lead_calling = create_test_lead(db, first_name="Iris", last_name="N",
                                         company="acme corp",
                                         status="Calling", email="iris@acme.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead_calling)
        assert result is not None
        assert result["resolved"] is True
        assert "Hank" in result["resolved_by"]

    def test_resolved_via_call_log_outcome(self, db):
        """Resolution via call log outcome even if lead status is not Meeting Scheduled."""
        import models
        sdr = create_test_user(db, email="sdr@test.com", name="SDR", role="SDR")
        create_sync_settings(db)

        lead1 = create_test_lead(db, first_name="Jack", last_name="K",
                                  company="CallCo", status="Calling", email="jack@callco.com")
        call = models.CallLog(lead_id=lead1.id, user_id=sdr.id,
                              outcome="Meeting Scheduled", notes="booked via call")
        db.add(call)
        db.commit()

        lead2 = create_test_lead(db, first_name="Kate", last_name="L",
                                  company="CallCo", status="Calling", email="kate@callco.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead2)
        assert result is not None
        assert result["resolved"] is True

    def test_different_company_not_resolved(self, db):
        """Leads at different companies should not affect each other."""
        create_sync_settings(db)
        lead_meeting = create_test_lead(db, first_name="Leo", company="CompanyA",
                                         status="Meeting Scheduled", email="leo@a.com")
        lead_calling = create_test_lead(db, first_name="Mia", company="CompanyB",
                                         status="Calling", email="mia@b.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead_calling)
        assert result is None


# ════════════════════════════════════════════════════════════════════════════
# 2. Batch Company Resolution
# ════════════════════════════════════════════════════════════════════════════

class TestBatchCompanyResolution:
    """Test the _batch_company_resolutions helper for list views."""

    def test_batch_returns_resolution_for_calling_leads(self, db):
        """Batch should return resolution data for calling leads (not the meeting lead)."""
        sdr, lead_m, lead_c1, lead_c2 = _create_company_scenario(db)

        from routes.lead_routes import _batch_company_resolutions
        # Only pass the calling leads — the batch function calls _get_company_resolution
        # which correctly finds lead_m as a sibling
        results = _batch_company_resolutions(db, [lead_c1, lead_c2])

        assert lead_c1.id in results
        assert results[lead_c1.id] is not None
        assert results[lead_c1.id]["resolved"] is True
        assert lead_c2.id in results
        assert results[lead_c2.id] is not None
        assert results[lead_c2.id]["resolved"] is True

    def test_batch_empty_list(self, db):
        """Batch with empty list returns empty dict."""
        from routes.lead_routes import _batch_company_resolutions
        results = _batch_company_resolutions(db, [])
        assert results == {}

    def test_batch_caches_per_company(self, db):
        """Two leads at same company should share the same resolution result."""
        sdr, lead_m, lead_c1, lead_c2 = _create_company_scenario(db)

        from routes.lead_routes import _batch_company_resolutions
        results = _batch_company_resolutions(db, [lead_c1, lead_c2])

        assert results[lead_c1.id]["resolved_by"] == "Alice Smith"
        assert results[lead_c2.id]["resolved_by"] == "Alice Smith"

    def test_batch_never_shows_a_lead_connected_via_itself(self, db):
        """Regression: a company with a SOLE lead already at Meeting Scheduled
        must not show that lead's own row as "connected via" itself — Q1/Q2
        resolve per-company (not per-lead), so passing the resolving lead's
        own row through the batch used to attach its own resolved_lead_id
        back to itself."""
        sdr, lead_m, _, _ = _create_company_scenario(db)

        from routes.lead_routes import _batch_company_resolutions
        results = _batch_company_resolutions(db, [lead_m])

        assert results[lead_m.id] is None


# ════════════════════════════════════════════════════════════════════════════
# 3. API Integration — Lead Detail
# ════════════════════════════════════════════════════════════════════════════

class TestCompanyResolutionAPI:
    """Test that resolution data appears in API responses."""

    def test_lead_detail_includes_company_resolved(self, client, db):
        """GET /api/leads/{id} should include company_resolved."""
        sdr, lead_m, lead_c1, _ = _create_company_scenario(db)

        resp = client.get(f"/api/leads/{lead_c1.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "company_resolved" in data
        assert data["company_resolved"]["resolved"] is True
        assert data["company_resolved"]["resolved_by"] == "Alice Smith"

    def test_lead_detail_not_resolved_when_different_company(self, client, db):
        """Lead at unique company should not be resolved."""
        create_sync_settings(db)
        lead = create_test_lead(db, first_name="Solo", company="UniqueCompany",
                                 status="Calling", email="solo@unique.com")

        resp = client.get(f"/api/leads/{lead.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "company_resolved" in data
        # Since no siblings, should be None or have resolved=False
        cr = data["company_resolved"]
        assert cr is None or cr.get("resolved") is False

    def test_lead_detail_resolved_info_fields(self, client, db):
        """Resolution info should include resolved_by, resolved_lead_id, etc."""
        sdr, lead_m, lead_c1, _ = _create_company_scenario(db)

        resp = client.get(f"/api/leads/{lead_c1.id}")
        data = resp.json()
        cr = data["company_resolved"]

        assert "resolved_by" in cr
        assert "resolved_lead_id" in cr
        assert "resolved_outcome" in cr
        assert cr["resolved_lead_id"] == lead_m.id


# ════════════════════════════════════════════════════════════════════════════
# 4. SCHEDULE_MEETING Activity Log Emission
# ════════════════════════════════════════════════════════════════════════════

class TestScheduleMeetingActivityLog:
    """Test that SCHEDULE_MEETING activity is emitted from all code paths."""

    def _prepare_lead_for_meeting(self, db, client, first_name, company, email):
        """Create a lead ready for Meeting Scheduled (research done + call logged)."""
        import models
        lead = create_test_lead(db, first_name=first_name, company=company,
                                 status="Research", email=email)
        # Fill core research fields
        lead.research_company = "They do software"
        lead.research_contact = "VP of Sales"
        lead.research_hypothesis = "Could use our product"
        lead.research_personalization = "Saw their post"
        lead.status = "Calling"
        db.commit()
        db.refresh(lead)

        # Log at least 1 call (required for Meeting Scheduled)
        call = models.CallLog(lead_id=lead.id, user_id="test-user-id",
                              outcome="Call Back Later", notes="")
        db.add(call)
        db.commit()
        return lead

    def test_kanban_move_to_meeting_scheduled_emits_activity(self, client, db):
        """Kanban move to Meeting Scheduled should emit SCHEDULE_MEETING."""
        import models
        create_sync_settings(db)
        lead = self._prepare_lead_for_meeting(db, client, "Fay", "DirectCo", "fay@direct.com")

        resp = client.patch("/api/leads/kanban/move",
                            params={"lead_id": lead.id, "new_status": "Meeting Scheduled"})
        assert resp.status_code == 200

        logs = db.query(models.UserActivityLog).filter(
            models.UserActivityLog.action_type == "SCHEDULE_MEETING"
        ).all()
        assert len(logs) >= 1

    def test_kanban_move_to_non_meeting_no_activity(self, client, db):
        """Kanban move to non-meeting status should NOT emit SCHEDULE_MEETING."""
        import models
        create_sync_settings(db)
        lead = create_test_lead(db, first_name="Gus", company="NormalCo",
                                 status="Lead Assigned", email="gus@normal.com")

        resp = client.patch("/api/leads/kanban/move",
                            params={"lead_id": lead.id, "new_status": "Research"})
        assert resp.status_code == 200

        logs = db.query(models.UserActivityLog).filter(
            models.UserActivityLog.action_type == "SCHEDULE_MEETING"
        ).all()
        assert len(logs) == 0

    def test_repeated_meeting_scheduled_creates_multiple_activities(self, client, db):
        """Setting status to Meeting Scheduled twice should create two events."""
        import models
        create_sync_settings(db)
        lead = self._prepare_lead_for_meeting(db, client, "Hal", "RepeatCo", "hal@repeat.com")

        client.patch("/api/leads/kanban/move",
                     params={"lead_id": lead.id, "new_status": "Meeting Scheduled"})
        # Move back to Calling (admin can do backward moves)
        client.patch("/api/leads/kanban/move",
                     params={"lead_id": lead.id, "new_status": "Calling"})
        client.patch("/api/leads/kanban/move",
                     params={"lead_id": lead.id, "new_status": "Meeting Scheduled"})

        logs = db.query(models.UserActivityLog).filter(
            models.UserActivityLog.action_type == "SCHEDULE_MEETING"
        ).all()
        assert len(logs) == 2  # Two transitions to Meeting Scheduled


# ════════════════════════════════════════════════════════════════════════════
# 5. Leaderboard Accuracy
# ════════════════════════════════════════════════════════════════════════════

class TestLeaderboardMeetingCount:
    """Test leaderboard counts meetings correctly."""

    def test_leaderboard_counts_meeting_scheduled_leads(self, client, db):
        """Leaderboard should count leads with Meeting Scheduled status per SDR."""
        sdr1 = create_test_user(db, email="sdr1@test.com", name="SDR One", role="SDR")
        sdr2 = create_test_user(db, email="sdr2@test.com", name="SDR Two", role="SDR")

        l1 = create_test_lead(db, first_name="A", company="Co1", status="Meeting Scheduled", email="a@test.com")
        l2 = create_test_lead(db, first_name="B", company="Co2", status="Meeting Scheduled", email="b@test.com")
        _assign_lead_to_user(db, l1, sdr1)
        _assign_lead_to_user(db, l2, sdr1)

        l3 = create_test_lead(db, first_name="C", company="Co3", status="Meeting Scheduled", email="c@test.com")
        _assign_lead_to_user(db, l3, sdr2)

        resp = client.get("/api/leaderboard?range=0")
        assert resp.status_code == 200
        data = resp.json()

        sdr1_data = next((s for s in data if s["email"] == "sdr1@test.com"), None)
        sdr2_data = next((s for s in data if s["email"] == "sdr2@test.com"), None)

        assert sdr1_data is not None
        assert sdr1_data["meetings_scheduled"] == 2
        assert sdr2_data is not None
        assert sdr2_data["meetings_scheduled"] == 1

    def test_leaderboard_sorted_by_meetings_desc(self, client, db):
        """Leaderboard should be sorted by meetings descending."""
        sdr1 = create_test_user(db, email="sdr1@test.com", name="SDR One", role="SDR")
        sdr2 = create_test_user(db, email="sdr2@test.com", name="SDR Two", role="SDR")

        l1 = create_test_lead(db, first_name="X", company="CoX", status="Meeting Scheduled", email="x@test.com")
        l2 = create_test_lead(db, first_name="Y", company="CoY", status="Meeting Scheduled", email="y@test.com")
        _assign_lead_to_user(db, l1, sdr2)
        _assign_lead_to_user(db, l2, sdr2)

        l3 = create_test_lead(db, first_name="Z", company="CoZ", status="Calling", email="z@test.com")
        _assign_lead_to_user(db, l3, sdr1)

        resp = client.get("/api/leaderboard?range=0")
        data = resp.json()

        assert data[0]["email"] == "sdr2@test.com"
        assert data[0]["meetings_scheduled"] == 2

    def test_leaderboard_only_counts_sdr_role(self, client, db):
        """Only SDR-role users should appear on leaderboard."""
        sdr = create_test_user(db, email="sdr@test.com", name="SDR", role="SDR")
        admin = create_test_user(db, email="admin2@test.com", name="Admin", role="Super Admin")

        l1 = create_test_lead(db, first_name="D", company="Co4", status="Meeting Scheduled", email="d@test.com")
        _assign_lead_to_user(db, l1, admin)

        resp = client.get("/api/leaderboard?range=0")
        data = resp.json()

        # Admin should not appear
        admin_data = next((s for s in data if s["email"] == "admin2@test.com"), None)
        assert admin_data is None


# ════════════════════════════════════════════════════════════════════════════
# 6. Edge Cases
# ════════════════════════════════════════════════════════════════════════════

class TestEdgeCases:
    """Edge case scenarios for company resolution."""

    def test_whitespace_company_normalization(self, db):
        """Company names with extra whitespace should still match."""
        create_sync_settings(db)
        lead_meeting = create_test_lead(db, first_name="Pat", last_name="W",
                                         company="  Acme Corp  ",
                                         status="Meeting Scheduled", email="pat@acme.com")
        lead_calling = create_test_lead(db, first_name="Quinn", last_name="X",
                                         company="Acme Corp",
                                         status="Calling", email="quinn@acme.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead_calling)
        assert result is not None
        assert result["resolved"] is True

    def test_single_lead_at_company_not_resolved(self, db):
        """A single lead at a company should never resolve (no siblings)."""
        create_sync_settings(db)
        lead = create_test_lead(db, first_name="Solo", company="OnlyOneCo",
                                 status="Meeting Scheduled", email="solo@only.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead)
        assert result is None

    def test_disqualified_lead_still_sees_resolution(self, db):
        """Disqualified leads should still see company resolution from sibling meetings."""
        create_sync_settings(db)
        lead_meeting = create_test_lead(db, first_name="Rex", last_name="Y",
                                         company="MixedCo",
                                         status="Meeting Scheduled", email="rex@mixed.com")
        lead_dq = create_test_lead(db, first_name="Sam", last_name="Z",
                                    company="MixedCo",
                                    status="Disqualified", email="sam@mixed.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead_dq)
        assert result is not None
        assert result["resolved"] is True

    def test_multiple_meetings_at_company(self, db):
        """When multiple siblings have meetings, resolution should reference one of them."""
        create_sync_settings(db)
        lead_m1 = create_test_lead(db, first_name="Tom", last_name="A",
                                    company="MultiMeetCo",
                                    status="Meeting Scheduled", email="tom@multi.com")
        lead_m2 = create_test_lead(db, first_name="Uma", last_name="B",
                                    company="MultiMeetCo",
                                    status="Meeting Scheduled", email="uma@multi.com")
        lead_c = create_test_lead(db, first_name="Val", last_name="C",
                                   company="MultiMeetCo",
                                   status="Calling", email="val@multi.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead_c)
        assert result is not None
        assert result["resolved"] is True
        assert result["resolved_by"] in ["Tom A", "Uma B"]

    def test_meeting_confirmed_outcome_also_resolves(self, db):
        """Meeting Confirmed call outcome should also trigger resolution."""
        import models
        sdr = create_test_user(db, email="sdr@test.com", name="SDR", role="SDR")
        create_sync_settings(db)

        lead1 = create_test_lead(db, first_name="Vic", last_name="D",
                                  company="ConfirmCo", status="Calling", email="vic@confirm.com")
        call = models.CallLog(lead_id=lead1.id, user_id=sdr.id,
                              outcome="Meeting Confirmed", notes="confirmed")
        db.add(call)
        db.commit()

        lead2 = create_test_lead(db, first_name="Wes", last_name="E",
                                  company="ConfirmCo", status="Calling", email="wes@confirm.com")

        from routes.lead_routes import _get_company_resolution
        result = _get_company_resolution(db, lead2)
        assert result is not None
        assert result["resolved"] is True
        assert result["resolved_outcome"] == "Meeting Confirmed"
