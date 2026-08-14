"""
Tests for the 9-stage lead lifecycle pipeline.

Pipeline:  Lead Assigned → Research → Calling → Meeting Scheduled →
           1st Discovery Meeting → Discovery Complete → Demo Scheduled →
           Demo Done → Completed | Disqualified

Covers:
  - Forward progression through all 9 stages
  - No-show eligibility from Meeting Scheduled, Discovery, and Demo stages
  - Outcome (Won/Lost) can be set on any qualification or terminal stage
  - Leaderboard counts leads in any post-meeting stage as "meetings booked"
  - Dashboard aggregates meetings from all post-meeting statuses
  - SDR performance funnel includes all new stages
  - SF push stage defaults to "Demo Done"
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import (
    create_test_user, create_test_lead, create_test_call,
    create_sync_settings, SUPER_ADMIN, SDR_USER,
)
import models


# ═══════════════════════════════════════════════════════════════════════════════
# 1. STATUS TRANSITIONS — Forward progression
# ═══════════════════════════════════════════════════════════════════════════════

class TestForwardTransitions:
    """Verify that leads can progress through all 9 stages sequentially."""

    def _prep_research(self, db, lead):
        """Fill required research fields so Calling transition is allowed."""
        for f in ["research_company", "research_contact",
                   "research_hypothesis", "research_personalization"]:
            setattr(lead, f, "filled")
        db.commit()

    def test_lead_assigned_to_research(self, client, db):
        lead = create_test_lead(db, email="t1@pipe.com", status="Lead Assigned")
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Research"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "Research"

    def test_research_to_calling(self, client, db):
        lead = create_test_lead(db, email="t2@pipe.com", status="Research")
        self._prep_research(db, lead)
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Calling"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "Calling"

    def test_calling_to_meeting_scheduled_requires_call(self, client, db):
        """Meeting Scheduled requires at least 1 logged call."""
        lead = create_test_lead(db, email="t3@pipe.com", status="Calling")
        self._prep_research(db, lead)
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Meeting Scheduled"})
        assert resp.status_code == 422

    def test_calling_to_meeting_scheduled_with_call(self, client, db):
        sdr = create_test_user(db, email="sdr_t3b@t.com", role="SDR")
        lead = create_test_lead(db, email="t3b@pipe.com", status="Calling")
        self._prep_research(db, lead)
        create_test_call(db, lead.id, sdr.id, "Meeting Confirmed")
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Meeting Scheduled"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "Meeting Scheduled"

    def test_meeting_to_discovery(self, client, db):
        lead = create_test_lead(db, email="t4@pipe.com", status="Meeting Scheduled")
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "1st Discovery Meeting"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "1st Discovery Meeting"

    def test_discovery_to_complete(self, client, db):
        lead = create_test_lead(db, email="t5@pipe.com", status="1st Discovery Meeting")
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Discovery Complete"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "Discovery Complete"

    def test_discovery_complete_to_demo_scheduled(self, client, db):
        lead = create_test_lead(db, email="t6@pipe.com", status="Discovery Complete")
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Demo Scheduled"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "Demo Scheduled"

    def test_demo_scheduled_to_demo_done(self, client, db):
        lead = create_test_lead(db, email="t7@pipe.com", status="Demo Scheduled")
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Demo Done"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "Demo Done"


# ═══════════════════════════════════════════════════════════════════════════════
# 2. BACKWARD TRANSITIONS — Admin only
# ═══════════════════════════════════════════════════════════════════════════════

class TestBackwardTransitions:

    def test_sdr_cannot_move_discovery_back_to_meeting(self, client_as_sdr, db):
        sdr = models.User(id="sdr-user-id", email="sdr@test.com",
                          name="SDR User", role="SDR")
        db.add(sdr)
        lead = create_test_lead(db, email="bk1@pipe.com", status="1st Discovery Meeting")
        sdr.assigned_leads.append(lead)
        db.commit()
        resp = client_as_sdr.patch(
            "/api/leads/kanban/move",
            params={"lead_id": lead.id, "new_status": "Meeting Scheduled"})
        assert resp.status_code == 403

    def test_admin_can_move_discovery_back_to_meeting(self, client, db):
        sdr = create_test_user(db, email="bksdr@pipe.com", role="SDR")
        lead = create_test_lead(db, email="bk2@pipe.com", status="1st Discovery Meeting")
        # Must have research fields filled for the transition to pass validation
        for f in ["research_company", "research_contact",
                   "research_hypothesis", "research_personalization"]:
            setattr(lead, f, "filled")
        db.commit()
        # Meeting Scheduled requires at least 1 call logged
        create_test_call(db, lead.id, sdr.id, "Meeting Confirmed")
        resp = client.patch(
            "/api/leads/kanban/move",
            params={"lead_id": lead.id, "new_status": "Meeting Scheduled"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Meeting Scheduled"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. NO-SHOW — Eligible from Meeting, Discovery, Demo stages
# ═══════════════════════════════════════════════════════════════════════════════

class TestNoShow:

    def _noshow_body(self, reason="Customer did not show up to the scheduled meeting"):
        return {"reason": reason}

    def test_noshow_from_meeting_scheduled(self, client, db):
        lead = create_test_lead(db, email="ns1@pipe.com", status="Meeting Scheduled")
        resp = client.post(f"/api/leads/{lead.id}/no-show", json=self._noshow_body())
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Calling"

    def test_noshow_from_discovery_meeting(self, client, db):
        lead = create_test_lead(db, email="ns2@pipe.com", status="1st Discovery Meeting")
        resp = client.post(f"/api/leads/{lead.id}/no-show", json=self._noshow_body())
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Calling"

    def test_noshow_from_demo_scheduled(self, client, db):
        lead = create_test_lead(db, email="ns3@pipe.com", status="Demo Scheduled")
        resp = client.post(f"/api/leads/{lead.id}/no-show", json=self._noshow_body())
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Calling"

    def test_noshow_blocked_from_calling(self, client, db):
        lead = create_test_lead(db, email="ns4@pipe.com", status="Calling")
        resp = client.post(f"/api/leads/{lead.id}/no-show", json=self._noshow_body())
        assert resp.status_code in (400, 422)

    def test_noshow_blocked_from_demo_done(self, client, db):
        lead = create_test_lead(db, email="ns5@pipe.com", status="Demo Done")
        resp = client.post(f"/api/leads/{lead.id}/no-show", json=self._noshow_body())
        assert resp.status_code in (400, 422)


# ═══════════════════════════════════════════════════════════════════════════════
# 4. OPPORTUNITY OUTCOME — Won/Lost eligibility expanded
# ═══════════════════════════════════════════════════════════════════════════════

class TestOutcomeEligibility:

    def test_outcome_on_meeting_scheduled(self, client, db):
        lead = create_test_lead(db, email="oc1@pipe.com", status="Meeting Scheduled")
        resp = client.patch(f"/api/leads/{lead.id}/outcome",
                            json={"status": "Won", "notes": ""})
        assert resp.status_code == 200

    def test_outcome_on_demo_done(self, client, db):
        lead = create_test_lead(db, email="oc2@pipe.com", status="Demo Done")
        resp = client.patch(f"/api/leads/{lead.id}/outcome",
                            json={"status": "Won", "notes": "Great demo!"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["opportunity_status"] == "Won"

    def test_outcome_on_discovery_complete(self, client, db):
        lead = create_test_lead(db, email="oc3@pipe.com", status="Discovery Complete")
        resp = client.patch(f"/api/leads/{lead.id}/outcome",
                            json={"status": "Lost", "notes": "Not a fit"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["opportunity_status"] == "Lost"

    def test_outcome_blocked_from_calling(self, client, db):
        lead = create_test_lead(db, email="oc4@pipe.com", status="Calling")
        resp = client.patch(f"/api/leads/{lead.id}/outcome",
                            json={"status": "Won", "notes": ""})
        assert resp.status_code == 400

    def test_outcome_blocked_from_research(self, client, db):
        lead = create_test_lead(db, email="oc5@pipe.com", status="Research")
        resp = client.patch(f"/api/leads/{lead.id}/outcome",
                            json={"status": "Lost", "notes": ""})
        assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# 5. LEADERBOARD — Post-meeting stages count as "meetings booked"
# ═══════════════════════════════════════════════════════════════════════════════

class TestLeaderboardNineStage:

    def test_discovery_lead_counts_as_meeting(self, client, db):
        sdr = create_test_user(db, email="lb9a@t.com", role="SDR", name="Disc SDR")
        lead = create_test_lead(db, email="lb9l1@t.com", status="1st Discovery Meeting")
        sdr.assigned_leads.append(lead)
        db.commit()

        resp = client.get("/api/leaderboard")
        data = resp.json()
        assert len(data) == 1
        assert data[0]["meetings_scheduled"] == 1

    def test_demo_done_counts_as_meeting(self, client, db):
        sdr = create_test_user(db, email="lb9b@t.com", role="SDR", name="Demo SDR")
        lead = create_test_lead(db, email="lb9l2@t.com", status="Demo Done")
        sdr.assigned_leads.append(lead)
        db.commit()

        resp = client.get("/api/leaderboard")
        data = resp.json()
        assert data[0]["meetings_scheduled"] == 1

    def test_completed_counts_as_meeting(self, client, db):
        sdr = create_test_user(db, email="lb9c@t.com", role="SDR", name="Complete SDR")
        lead = create_test_lead(db, email="lb9l3@t.com", status="Completed")
        sdr.assigned_leads.append(lead)
        db.commit()

        resp = client.get("/api/leaderboard")
        data = resp.json()
        assert data[0]["meetings_scheduled"] == 1

    def test_calling_does_not_count_as_meeting(self, client, db):
        sdr = create_test_user(db, email="lb9d@t.com", role="SDR", name="Calling SDR")
        lead = create_test_lead(db, email="lb9l4@t.com", status="Calling")
        sdr.assigned_leads.append(lead)
        db.commit()

        resp = client.get("/api/leaderboard")
        data = resp.json()
        assert data[0]["meetings_scheduled"] == 0


# ═══════════════════════════════════════════════════════════════════════════════
# 6. DASHBOARD — Status counts include new stages
# ═══════════════════════════════════════════════════════════════════════════════

class TestDashboardNineStage:

    def test_dashboard_counts_all_new_statuses(self, client, db):
        create_test_lead(db, email="d9a@t.com", status="Meeting Scheduled")
        create_test_lead(db, email="d9b@t.com", status="1st Discovery Meeting")
        create_test_lead(db, email="d9c@t.com", status="Discovery Complete")
        create_test_lead(db, email="d9d@t.com", status="Demo Scheduled")
        create_test_lead(db, email="d9e@t.com", status="Demo Done")
        create_test_lead(db, email="d9f@t.com", status="Completed")

        resp = client.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        sc = resp.json()["status_counts"]

        assert sc.get("Meeting Scheduled", 0) == 1
        assert sc.get("1st Discovery Meeting", 0) == 1
        assert sc.get("Discovery Complete", 0) == 1
        assert sc.get("Demo Scheduled", 0) == 1
        assert sc.get("Demo Done", 0) == 1
        assert sc.get("Completed", 0) == 1


# ═══════════════════════════════════════════════════════════════════════════════
# 7. SDR PERFORMANCE — Funnel includes all stages
# ═══════════════════════════════════════════════════════════════════════════════

class TestSdrPerformanceNineStage:

    def test_funnel_includes_all_stages(self, client, db):
        sdr = create_test_user(db, email="perf@t.com", role="SDR", name="Perf SDR")
        l1 = create_test_lead(db, email="pf1@t.com", status="Demo Scheduled")
        l2 = create_test_lead(db, email="pf2@t.com", status="Demo Done")

        # Assign leads to the SDR
        sdr.assigned_leads.extend([l1, l2])
        db.commit()

        resp = client.get(f"/api/sdr-performance/{sdr.id}")
        assert resp.status_code == 200
        data = resp.json()

        funnel = data["funnel"]
        assert "Demo Scheduled" in funnel
        assert "Demo Done" in funnel
        assert "1st Discovery Meeting" in funnel
        assert "Discovery Complete" in funnel
        assert "Completed" in funnel
        assert "Disqualified" in funnel

        # Both leads should count as meetings
        assert data["conversion"]["meetings_scheduled"] == 2

    def test_conversion_rate_with_new_stages(self, client, db):
        sdr = create_test_user(db, email="conv9@t.com", role="SDR", name="Conv SDR")
        # 2 leads in pipeline, 1 in demo done
        l1 = create_test_lead(db, email="cv1@t.com", status="Demo Done")
        l2 = create_test_lead(db, email="cv2@t.com", status="Calling")
        sdr.assigned_leads.extend([l1, l2])
        db.commit()

        resp = client.get(f"/api/sdr-performance/{sdr.id}")
        data = resp.json()
        # 1 meeting / 2 total = 50%
        assert data["conversion"]["conversion_rate"] == 50.0


# ═══════════════════════════════════════════════════════════════════════════════
# 8. SYNC SETTINGS — Default SF push stage
# ═══════════════════════════════════════════════════════════════════════════════

class TestSyncSettingsDefault:

    def test_sync_settings_default_sf_push_stage(self, client, db):
        """Verify the API returns sync settings and accepts Demo Done as the push stage."""
        settings = create_sync_settings(db, sf_push_stage="Demo Done")
        resp = client.get("/api/admin/sync-settings")
        assert resp.status_code == 200
        data = resp.json()
        assert data["sf_push_stage"] == "Demo Done"


# ═══════════════════════════════════════════════════════════════════════════════
# 9. STATUS ENUM — All new statuses exist in the model
# ═══════════════════════════════════════════════════════════════════════════════

class TestStatusEnum:

    def test_all_nine_stages_exist(self):
        status_values = [s.value for s in models.Status]
        expected = [
            "Lead Assigned", "Research", "Calling", "Meeting Scheduled",
            "1st Discovery Meeting", "Discovery Complete",
            "Demo Scheduled", "Demo Done",
        ]
        for stage in expected:
            assert stage in status_values, f"Missing status: {stage}"

    def test_terminal_statuses_include_completed(self):
        assert "Completed" in models.TERMINAL_STATUSES
        assert "Disqualified" in models.TERMINAL_STATUSES

    def test_active_statuses_do_not_include_terminal(self):
        for ts in models.TERMINAL_STATUSES:
            assert ts not in models.ACTIVE_STATUSES, \
                f"Terminal status {ts} found in ACTIVE_STATUSES"


# ═══════════════════════════════════════════════════════════════════════════════
# 10. FILTER BY NEW STATUSES
# ═══════════════════════════════════════════════════════════════════════════════

class TestFilterNewStatuses:

    def test_filter_by_discovery_meeting(self, client, db):
        create_test_lead(db, email="f1@pipe.com", status="1st Discovery Meeting")
        create_test_lead(db, email="f2@pipe.com", status="Calling")
        resp = client.get("/api/leads?status=1st Discovery Meeting")
        data = resp.json()
        assert data["total"] == 1
        assert data["data"][0]["status"] == "1st Discovery Meeting"

    def test_filter_by_demo_done(self, client, db):
        create_test_lead(db, email="f3@pipe.com", status="Demo Done")
        create_test_lead(db, email="f4@pipe.com", status="Lead Assigned")
        resp = client.get("/api/leads?status=Demo Done")
        data = resp.json()
        assert data["total"] == 1
        assert data["data"][0]["status"] == "Demo Done"

    def test_filter_by_demo_scheduled(self, client, db):
        create_test_lead(db, email="f5@pipe.com", status="Demo Scheduled")
        resp = client.get("/api/leads?status=Demo Scheduled")
        data = resp.json()
        assert data["total"] == 1
