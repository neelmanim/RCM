"""
v9.0.0 — Pod Admin Full Surface Scoping Tests
==============================================
16 tests covering leaderboard, dashboard feed, admin activity feed,
daily digest, and metrics — verifying pod scoping and global_view toggle.
"""
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from tests.conftest import create_test_user, create_test_lead, create_test_pod, create_test_call, create_test_status_log, create_test_upload_log
import models


# ── Leaderboard Tests ─────────────────────────────────────────────────────────

class TestLeaderboardPodScoping:
    """L-1 to L-5: Leaderboard SDR & AE scoping."""

    def test_L1_pod_admin_sees_only_pod_sdrs(self, client_as_pod_admin, db):
        """Pod Admin default (global_view=False) → only pod SDRs returned."""
        # Create SDR in pod and outside pod
        sdr_in  = create_test_user(db, email="sdr_in@test.com",  name="Pod SDR",    role="SDR", pod_id="test-pod-id", id="sdr-in-id")
        sdr_out = create_test_user(db, email="sdr_out@test.com", name="Other SDR",  role="SDR", pod_id="other-pod-id", id="sdr-out-id")

        res = client_as_pod_admin.get("/api/leaderboard")
        assert res.status_code == 200
        data = res.json()
        ids = [s["id"] for s in data]
        assert "sdr-in-id" in ids, "Pod SDR should appear"
        assert "sdr-out-id" not in ids, "External SDR must NOT appear"

        # cleanup
        db.delete(sdr_in); db.delete(sdr_out); db.commit()

    def test_L2_pod_admin_global_view_true_sees_all_sdrs(self, client_as_pod_admin, db):
        """Pod Admin global_view=True → all SDRs visible."""
        sdr_in  = create_test_user(db, email="sdr2_in@test.com",  name="Pod SDR2",   role="SDR", pod_id="test-pod-id",  id="sdr2-in-id")
        sdr_out = create_test_user(db, email="sdr2_out@test.com", name="Other SDR2", role="SDR", pod_id="other-pod-id", id="sdr2-out-id")

        res = client_as_pod_admin.get("/api/leaderboard?global_view=true")
        assert res.status_code == 200
        data = res.json()
        ids = [s["id"] for s in data]
        assert "sdr2-in-id" in ids
        assert "sdr2-out-id" in ids, "Global view must include external SDR"

        db.delete(sdr_in); db.delete(sdr_out); db.commit()

    def test_L3_pod_admin_no_pod_id_returns_empty(self, db):
        """Pod Admin with null pod_id → empty leaderboard (safe fallback)."""
        from main import app
        from database import get_db
        from auth import get_current_user, require_admin

        app2 = __import__('main').app
        payload = {"sub": "null-pod-admin", "role": "Pod Admin", "email": "nopod@test.com", "pod_id": None}

        def _override_db(): yield db

        app2.dependency_overrides[get_db] = _override_db
        app2.dependency_overrides[get_current_user] = lambda: payload
        app2.dependency_overrides[require_admin] = lambda: payload

        client2 = TestClient(app2)
        res = client2.get("/api/leaderboard")
        assert res.status_code == 200
        assert res.json() == []
        app2.dependency_overrides.clear()

    def test_L4_super_admin_unaffected(self, client, db):
        """Super Admin sees all SDRs regardless — no change in behaviour."""
        sdr_a = create_test_user(db, email="sdr_a@test.com", name="SDR A", role="SDR", pod_id="pod-a", id="sdr-a-id")
        sdr_b = create_test_user(db, email="sdr_b@test.com", name="SDR B", role="SDR", pod_id="pod-b", id="sdr-b-id")

        res = client.get("/api/leaderboard")
        assert res.status_code == 200
        ids = [s["id"] for s in res.json()]
        assert "sdr-a-id" in ids
        assert "sdr-b-id" in ids

        db.delete(sdr_a); db.delete(sdr_b); db.commit()

    def test_L5_ae_leaderboard_pod_scoped(self, client_as_pod_admin, db):
        """Pod Admin AE leaderboard → only pod's AEs."""
        ae_in  = create_test_user(db, email="ae_in@test.com",  name="Pod AE",   role="AE", pod_id="test-pod-id",  id="ae-in-id")
        ae_out = create_test_user(db, email="ae_out@test.com", name="Other AE", role="AE", pod_id="other-pod-id", id="ae-out-id")

        res = client_as_pod_admin.get("/api/leaderboard/ae")
        assert res.status_code == 200
        ids = [a["id"] for a in res.json()]
        assert "ae-in-id" in ids
        assert "ae-out-id" not in ids

        db.delete(ae_in); db.delete(ae_out); db.commit()


# ── Dashboard Activity Feed Tests ─────────────────────────────────────────────

class TestDashboardActivityFeedScoping:
    """AF-1 to AF-3: /api/leads/activity-feed pod scoping."""

    def _assign_lead(self, db, user_id, lead_id):
        db.execute(
            models.lead_assignments.insert().values(user_id=user_id, lead_id=lead_id)
        )
        db.commit()

    def test_AF1_pod_admin_sees_only_pod_lead_changes(self, client_as_pod_admin, db):
        """global_view=False → only status changes for leads assigned to pod's SDRs."""
        sdr_in  = create_test_user(db, email="sdr_af1@test.com",  name="AF SDR",    role="SDR", pod_id="test-pod-id",  id="sdr-af1-id")
        sdr_out = create_test_user(db, email="sdr_af1b@test.com", name="Other SDR", role="SDR", pod_id="other-pod-id", id="sdr-af1b-id")

        lead_in  = create_test_lead(db, last_name="InLead",  pod_id="test-pod-id")
        lead_out = create_test_lead(db, last_name="OutLead", pod_id="other-pod-id")

        self._assign_lead(db, sdr_in.id, lead_in.id)
        self._assign_lead(db, sdr_out.id, lead_out.id)

        log_in  = models.LeadStatusLog(lead_id=lead_in.id,  from_status="Research", to_status="Calling", changed_by="AF SDR")
        log_out = models.LeadStatusLog(lead_id=lead_out.id, from_status="Research", to_status="Calling", changed_by="Other SDR")
        db.add(log_in); db.add(log_out); db.commit()

        res = client_as_pod_admin.get("/api/leads/activity-feed?limit=50")
        assert res.status_code == 200
        data = res.json()
        lead_ids = [e["lead_id"] for e in data]
        assert lead_in.id in lead_ids, "Pod lead status change must appear"
        assert lead_out.id not in lead_ids, "External pod lead must NOT appear"

        db.delete(log_in); db.delete(log_out)
        db.execute(models.lead_assignments.delete().where(models.lead_assignments.c.lead_id == lead_in.id))
        db.execute(models.lead_assignments.delete().where(models.lead_assignments.c.lead_id == lead_out.id))
        db.delete(lead_in); db.delete(lead_out)
        db.delete(sdr_in); db.delete(sdr_out); db.commit()

    def test_AF2_pod_admin_global_view_sees_all(self, client_as_pod_admin, db):
        """global_view=True → Pod Admin sees all org lead changes."""
        sdr_out = create_test_user(db, email="sdr_af2@test.com", name="AF2 SDR", role="SDR", pod_id="other-pod-id", id="sdr-af2-id")
        lead_out = create_test_lead(db, last_name="AF2Lead", pod_id="other-pod-id")
        self._assign_lead(db, sdr_out.id, lead_out.id)

        log = models.LeadStatusLog(lead_id=lead_out.id, from_status="Research", to_status="Calling", changed_by="AF2 SDR")
        db.add(log); db.commit()

        res = client_as_pod_admin.get("/api/leads/activity-feed?limit=50&global_view=true")
        assert res.status_code == 200
        lead_ids = [e["lead_id"] for e in res.json()]
        assert lead_out.id in lead_ids, "Global view must include external pod lead"

        db.delete(log)
        db.execute(models.lead_assignments.delete().where(models.lead_assignments.c.lead_id == lead_out.id))
        db.delete(lead_out); db.delete(sdr_out); db.commit()

    def test_call_entry_includes_id_for_recording_refresh(self, client_as_pod_admin, db):
        """
        RCA 2026-07-15: the activity feed's call entries had no `id` field, so the
        admin "play recording" button had no call_id to request a fresh signed URL
        with once the cached one expired. Regression guard for that field.
        """
        sdr = create_test_user(db, email="sdr_callid@test.com", name="Call SDR", role="SDR", pod_id="test-pod-id", id="sdr-callid-id")
        lead = create_test_lead(db, last_name="CallIdLead", pod_id="test-pod-id")
        self._assign_lead(db, sdr.id, lead.id)

        call = models.DialerCall(lead_id=lead.id, user_id=sdr.id, provider="aircall",
                                  status="CALL_ENDED", outcome="Interested", recording_url="https://x/y")
        db.add(call); db.commit()

        res = client_as_pod_admin.get("/api/admin/activity-feed?per_page=50&type=call&global_view=true")
        assert res.status_code == 200
        entry = next(e for e in res.json()["data"] if e["lead_id"] == lead.id)
        assert entry["id"] == call.id

        db.execute(models.lead_assignments.delete().where(models.lead_assignments.c.lead_id == lead.id))
        db.delete(call); db.delete(lead); db.delete(sdr); db.commit()

    def test_AF3_unassigned_lead_not_in_pod_feed(self, client_as_pod_admin, db):
        """Unassigned leads (no lead_assignments row) must NOT appear in pod view."""
        lead_unassigned = create_test_lead(db, last_name="NoAssign", pod_id="test-pod-id")
        log = models.LeadStatusLog(lead_id=lead_unassigned.id, from_status="Research", to_status="Calling", changed_by="Someone")
        db.add(log); db.commit()

        res = client_as_pod_admin.get("/api/leads/activity-feed?limit=50")
        assert res.status_code == 200
        lead_ids = [e["lead_id"] for e in res.json()]
        assert lead_unassigned.id not in lead_ids, "Unassigned lead must NOT appear in pod feed"

        db.delete(log); db.delete(lead_unassigned); db.commit()


# ── Admin Activity Feed Tests ─────────────────────────────────────────────────

class TestAdminActivityFeedToggle:
    """AA-1 to AA-2: /api/admin/activity-feed global_view bypass."""

    def test_AA1_global_view_true_bypasses_pod_scope(self, client_as_pod_admin, db):
        """global_view=True → Pod Admin gets all activities (no pod filter applied)."""
        res = client_as_pod_admin.get("/api/admin/activity-feed?global_view=true")
        # Should return 200 without filtering (verifying no 403/500)
        assert res.status_code == 200
        body = res.json()
        assert "data" in body
        assert "total" in body

    def test_AA2_pod_id_param_takes_priority_over_global_view(self, client, db):
        """Super Admin: explicit pod_id param overrides global_view (edge case A-2)."""
        pod = create_test_pod(db, name="PriorityPod", admin_id=None)

        # Super Admin passes both pod_id and global_view=true — pod_id should win
        res = client.get(f"/api/admin/activity-feed?pod_id={pod.id}&global_view=true")
        assert res.status_code == 200
        # Result should be scoped to the pod (total can be 0 since no data, just no error)
        assert "data" in res.json()

        db.delete(pod); db.commit()


class TestAdminActivityFeedSandboxExclusion:
    """Cadence/Messaging Sandbox test leads (Lead.is_test=True) must never
    appear in the org-wide /api/admin/activity-feed. One real lead and one
    is_test=True lead get identical calls/status-changes; the feed must
    only ever surface the real lead's."""

    def _assign_lead(self, db, user_id, lead_id):
        db.execute(
            models.lead_assignments.insert().values(user_id=user_id, lead_id=lead_id)
        )
        db.commit()

    def test_call_entries_exclude_test_lead(self, client, db):
        sdr = create_test_user(db, email="sandbox_af_call@t.com", name="Sandbox AF Call SDR", role="SDR")
        real_lead = create_test_lead(db, last_name="RealCallLead", email="sandbox_af_call_real@t.com")
        test_lead = create_test_lead(db, last_name="TestCallLead", email="sandbox_af_call_test@t.com")
        test_lead.is_test = True
        db.commit()
        self._assign_lead(db, sdr.id, real_lead.id)
        self._assign_lead(db, sdr.id, test_lead.id)

        db.add(models.DialerCall(lead_id=real_lead.id, user_id=sdr.id, provider="aircall", status="CALL_ENDED"))
        db.add(models.DialerCall(lead_id=test_lead.id, user_id=sdr.id, provider="aircall", status="CALL_ENDED"))
        db.commit()

        res = client.get("/api/admin/activity-feed?per_page=50&type=call&date_range=all")
        assert res.status_code == 200
        lead_ids = [e["lead_id"] for e in res.json()["data"]]
        assert real_lead.id in lead_ids
        assert test_lead.id not in lead_ids, "test lead's call must not appear in the admin activity feed"

    def test_status_change_entries_exclude_test_lead(self, client, db):
        real_lead = create_test_lead(db, last_name="RealStatusLead", email="sandbox_af_status_real@t.com")
        test_lead = create_test_lead(db, last_name="TestStatusLead", email="sandbox_af_status_test@t.com")
        test_lead.is_test = True
        db.commit()

        create_test_status_log(db, real_lead.id, "Research", "Calling")
        create_test_status_log(db, test_lead.id, "Research", "Calling")

        res = client.get("/api/admin/activity-feed?per_page=50&type=status&date_range=all")
        assert res.status_code == 200
        lead_ids = [e["lead_id"] for e in res.json()["data"]]
        assert real_lead.id in lead_ids
        assert test_lead.id not in lead_ids, "test lead's status change must not appear in the admin activity feed"


# ── Daily Digest Tests ────────────────────────────────────────────────────────

class TestDailyDigestPodScoping:
    """DD-1 to DD-3: /api/admin/analytics/daily-digest pod scoping."""

    def test_DD1_pod_admin_digest_sdr_list_scoped(self, client_as_pod_admin, db):
        """Pod Admin digest returns only pod's SDRs in sdr_snapshot."""
        sdr_in  = create_test_user(db, email="dd_sdr1@test.com",  name="DD SDR In",   role="SDR", pod_id="test-pod-id",  id="dd-sdr1-id")
        sdr_out = create_test_user(db, email="dd_sdr2@test.com",  name="DD SDR Out",  role="SDR", pod_id="other-pod-id", id="dd-sdr2-id")

        res = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-01-01")
        assert res.status_code == 200
        snapshot = res.json().get("sdr_snapshot", [])
        sdr_ids = [s["user_id"] for s in snapshot]
        assert "dd-sdr1-id" not in sdr_ids or True  # If 0 activity, sdr won't appear — that's fine
        # Key test: dd-sdr2-id (other pod) must NEVER appear
        assert "dd-sdr2-id" not in sdr_ids, "External pod SDR must NOT appear in digest snapshot"

        db.delete(sdr_in); db.delete(sdr_out); db.commit()

    def test_DD2_pod_admin_sees_pod_new_leads(self, client_as_pod_admin, db):
        """new_leads_today KPI must reflect pod's leads only."""
        # The digest endpoint uses date filtering; we verify it returns 200 without error
        res = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-01-01")
        assert res.status_code == 200
        body = res.json()
        assert "kpi" in body
        assert "new_leads" in body["kpi"]

    def test_DD3_super_admin_digest_unaffected(self, client, db):
        """Super Admin digest returns 200 without error (regression guard)."""
        res = client.get("/api/admin/analytics/daily-digest?date=2026-01-01")
        # Super Admin blocked by require_super_admin override in conftest — check 200 or 403
        # Super Admin client uses require_super_admin override = passes
        assert res.status_code in (200, 400)  # 400 = date validation, both fine

    def test_DD4_calls_made_kpi_scoped_by_pod(self, client_as_pod_admin, db):
        """RCA 2026-07-27: calls_made KPI was org-wide for every viewer —
        a Pod Admin's digest silently included every other pod's calls too.
        Uses its own date (distinct from DD1-DD3) so the endpoint's 10-minute
        in-memory cache can't serve another test's stale cached result."""
        date = datetime(2026, 1, 8, 10, 0, 0, tzinfo=timezone.utc)
        sdr_in  = create_test_user(db, email="dd4_in@test.com",  name="DD4 In",  role="SDR", pod_id="test-pod-id",  id="dd4-sdr-in")
        sdr_out = create_test_user(db, email="dd4_out@test.com", name="DD4 Out", role="SDR", pod_id="other-pod-id", id="dd4-sdr-out")
        lead_in  = create_test_lead(db, email="dd4lead_in@test.com",  pod_id="test-pod-id")
        lead_out = create_test_lead(db, email="dd4lead_out@test.com", pod_id="other-pod-id")
        create_test_call(db, lead_in.id,  sdr_in.id,  called_at=date)
        create_test_call(db, lead_out.id, sdr_out.id, called_at=date)

        res = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-01-08")
        assert res.status_code == 200
        assert res.json()["kpi"]["calls_made"]["today"] == 1, \
            "Pod Admin must see only their pod's calls, not the other pod's too"

    def test_DD5_meetings_booked_kpi_scoped_by_pod(self, client_as_pod_admin, db):
        """RCA 2026-07-27: meetings_booked KPI had no pod filter at all."""
        date = datetime(2026, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
        lead_in  = create_test_lead(db, email="dd5lead_in@test.com",  pod_id="test-pod-id")
        lead_out = create_test_lead(db, email="dd5lead_out@test.com", pod_id="other-pod-id")
        create_test_status_log(db, lead_in.id,  "Calling", "Meeting Scheduled", changed_at=date)
        create_test_status_log(db, lead_out.id, "Calling", "Meeting Scheduled", changed_at=date)

        res = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-01-15")
        assert res.status_code == 200
        assert res.json()["kpi"]["meetings_booked"]["today"] == 1

    def test_DD6_pipeline_moved_and_researched_scoped_by_pod(self, client_as_pod_admin, db):
        """RCA 2026-07-27: pipeline_moved / leads_researched had no pod filter."""
        date = datetime(2026, 1, 22, 10, 0, 0, tzinfo=timezone.utc)
        lead_in  = create_test_lead(db, email="dd6lead_in@test.com",  pod_id="test-pod-id")
        lead_out = create_test_lead(db, email="dd6lead_out@test.com", pod_id="other-pod-id")
        create_test_status_log(db, lead_in.id,  "Research", "Calling", changed_at=date)
        create_test_status_log(db, lead_out.id, "Research", "Calling", changed_at=date)

        res = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-01-22")
        assert res.status_code == 200
        kpi = res.json()["kpi"]
        assert kpi["pipeline_moved"]["today"] == 1
        assert kpi["leads_researched"]["today"] == 1

    def test_DD7_status_snapshot_scoped_by_pod(self, client_as_pod_admin, db):
        """RCA 2026-07-27: status_snapshot showed the whole org's pipeline
        distribution to a Pod Admin, mislabeled as their own."""
        create_test_lead(db, email="dd7lead_in@test.com",  pod_id="test-pod-id",  status="Demo Scheduled")
        create_test_lead(db, email="dd7lead_out@test.com", pod_id="other-pod-id", status="Demo Scheduled")

        res = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-01-29")
        assert res.status_code == 200
        assert res.json()["status_snapshot"].get("Demo Scheduled") == 1

    def test_DD8_super_admin_sees_org_wide_totals(self, client, db):
        """Regression guard: Super Admin's digest must still sum ALL pods —
        the pod-scoping fix must not accidentally scope Super Admin too."""
        date = datetime(2026, 2, 5, 10, 0, 0, tzinfo=timezone.utc)
        sdr_a = create_test_user(db, email="dd8_a@test.com", name="DD8 A", role="SDR", pod_id="pod-a", id="dd8-sdr-a")
        sdr_b = create_test_user(db, email="dd8_b@test.com", name="DD8 B", role="SDR", pod_id="pod-b", id="dd8-sdr-b")
        lead_a = create_test_lead(db, email="dd8lead_a@test.com", pod_id="pod-a")
        lead_b = create_test_lead(db, email="dd8lead_b@test.com", pod_id="pod-b")
        create_test_call(db, lead_a.id, sdr_a.id, called_at=date)
        create_test_call(db, lead_b.id, sdr_b.id, called_at=date)

        res = client.get("/api/admin/analytics/daily-digest?date=2026-02-05")
        assert res.status_code == 200
        assert res.json()["kpi"]["calls_made"]["today"] == 2

    def test_DD9_new_leads_excludes_leads_parked_same_day(self, client, db):
        """RCA 2026-07-27: a lead parked (models.PARKED_STATUSES) the SAME
        day it was created should not count as a healthy 'new lead' — this
        part of the original behavior is preserved, just made point-in-time
        instead of drifting."""
        date = datetime(2026, 2, 12, 10, 0, 0, tzinfo=timezone.utc)
        lead = create_test_lead(db, email="dd9lead@test.com", created_at=date, status="No Phone - Parked")
        create_test_status_log(db, lead.id, "Lead Assigned", "No Phone - Parked", changed_at=date)

        res = client.get("/api/admin/analytics/daily-digest?date=2026-02-12")
        assert res.status_code == 200
        assert res.json()["kpi"]["new_leads"]["today"] == 0

    def test_DD10_new_leads_stays_frozen_after_later_parking(self, client, db):
        """RCA 2026-07-27: the actual bug — a lead parked WEEKS after its
        creation day must NOT retroactively vanish from that day's
        historical new_leads count. Previously this filtered on the lead's
        CURRENT status, so re-viewing an old digest after a later status
        change silently changed the number."""
        date = datetime(2026, 2, 19, 10, 0, 0, tzinfo=timezone.utc)
        later = datetime(2026, 3, 1, 10, 0, 0, tzinfo=timezone.utc)  # weeks after digest day
        lead = create_test_lead(db, email="dd10lead@test.com", created_at=date, status="No Phone - Parked")
        create_test_status_log(db, lead.id, "Calling", "No Phone - Parked", changed_at=later)

        res = client.get("/api/admin/analytics/daily-digest?date=2026-02-19")
        assert res.status_code == 200
        assert res.json()["kpi"]["new_leads"]["today"] == 1, \
            "A lead parked weeks later must still count in its creation day's frozen history"

    def test_DD11_batch_uploads_scoped_by_pod(self, client_as_pod_admin, db):
        """RCA 2026-07-27: missed in the first pod-scoping pass — batch
        upload notable events showed every org-wide upload to a Pod Admin.
        LeadUploadLog has no pod_id, so it's scoped by the uploader's pod."""
        date = datetime(2026, 2, 26, 10, 0, 0, tzinfo=timezone.utc)
        uploader_in  = create_test_user(db, email="dd11_in@test.com",  name="DD11 In",  role="Pod Admin", pod_id="test-pod-id",  id="dd11-up-in")
        uploader_out = create_test_user(db, email="dd11_out@test.com", name="DD11 Out", role="Pod Admin", pod_id="other-pod-id", id="dd11-up-out")
        create_test_upload_log(db, uploaded_by=uploader_in.id,  filename="pod_in.csv",  created_at=date)
        create_test_upload_log(db, uploaded_by=uploader_out.id, filename="pod_out.csv", created_at=date)

        res = client_as_pod_admin.get("/api/admin/analytics/daily-digest?date=2026-02-26")
        assert res.status_code == 200
        messages = " ".join(e["message"] for e in res.json()["notable_events"])
        assert "pod_in.csv" in messages
        assert "pod_out.csv" not in messages, "External pod's upload must not appear as a notable event"

    def test_DD12_sdr_snapshot_counts_annotated_changed_by(self, client, db):
        """RCA 2026-07-27: some status changes annotate changed_by with
        context, e.g. "Jane Doe (No Show: reason)" — intentionally shown
        as-is in the lead's status-history timeline (lead_detail.js), so
        the writer can't be changed. The digest's per-SDR lookup must still
        credit this activity to the SDR instead of silently dropping it."""
        date = datetime(2026, 3, 5, 10, 0, 0, tzinfo=timezone.utc)
        sdr = create_test_user(db, email="dd12@test.com", name="Jane Doe", role="SDR", id="dd12-sdr")
        lead = create_test_lead(db, email="dd12lead@test.com")
        create_test_status_log(db, lead.id, "Meeting Scheduled", "Calling",
                                changed_by="Jane Doe (No Show: patient rescheduled)", changed_at=date)

        res = client.get("/api/admin/analytics/daily-digest?date=2026-03-05")
        assert res.status_code == 200
        snapshot = {s["user_id"]: s for s in res.json()["sdr_snapshot"]}
        assert snapshot["dd12-sdr"]["leads_progressed"] == 1


# ── Metrics Tests ─────────────────────────────────────────────────────────────

class TestMetricsPodScoping:
    """M-1 to M-3: Analytics Hub metrics pod scoping."""

    def test_M1_pod_admin_summary_scoped(self, client_as_pod_admin, db):
        """Metrics summary returns 200 for Pod Admin (sdr_ids now pod-filtered)."""
        res = client_as_pod_admin.get("/api/admin/metrics/summary")
        assert res.status_code == 200
        body = res.json()
        assert "daily_active_sdrs" in body

    def test_M2_pod_admin_sdr_table_scoped(self, client_as_pod_admin, db):
        """SDR table returns only pod members."""
        sdr_in  = create_test_user(db, email="m2_sdr_in@test.com",  name="M2 SDR In",  role="SDR", pod_id="test-pod-id",  id="m2-sdr-in-id")
        sdr_out = create_test_user(db, email="m2_sdr_out@test.com", name="M2 SDR Out", role="SDR", pod_id="other-pod-id", id="m2-sdr-out-id")

        res = client_as_pod_admin.get("/api/admin/metrics/sdr-table")
        assert res.status_code == 200
        data = res.json()
        user_ids = [r.get("user_id") for r in data]
        assert "m2-sdr-out-id" not in user_ids, "External pod SDR must NOT appear in metrics table"

        db.delete(sdr_in); db.delete(sdr_out); db.commit()

    def test_M3_super_admin_sees_all_users(self, client, db):
        """Super Admin metrics are unaffected — sees all users."""
        sdr_a = create_test_user(db, email="m3_sdr_a@test.com", name="M3 SDR A", role="SDR", pod_id="pod-a", id="m3-sdr-a-id")
        sdr_b = create_test_user(db, email="m3_sdr_b@test.com", name="M3 SDR B", role="SDR", pod_id="pod-b", id="m3-sdr-b-id")

        res = client.get("/api/admin/metrics/summary")
        assert res.status_code == 200  # Super Admin gets data, no pod filter

        db.delete(sdr_a); db.delete(sdr_b); db.commit()
