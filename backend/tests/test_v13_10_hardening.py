"""v13.10.0 — small hardening that goes with ownership history (statuses themselves are unchanged)."""
from unittest.mock import MagicMock, patch

import models
from conftest import create_test_lead
from salesforce import sync_leads_from_salesforce


def _sf(records):
    sf = MagicMock()
    sf.query.return_value = {"records": records}
    return sf


def _rec(sf_id, status):
    return {"Id": sf_id, "FirstName": "A", "LastName": "B", "Email": f"{sf_id}@x.com", "Phone": "555-0100",
            "Status": status, "Company": "Co", "RecordTypeId": None, "LastModifiedDate": "2026-05-01T00:00:00Z"}


# ── status values are validated ─────────────────────────────────────────────────────────────────────────────────
def test_update_endpoint_rejects_a_status_the_app_does_not_have(client, db):
    lead = create_test_lead(db, email="v1@x.com", status="Calling")
    r = client.patch(f"/api/leads/{lead.id}", json={"status": "Meeting Booked"})
    assert r.status_code == 422 and "not a lead status" in r.text
    db.refresh(lead)
    assert lead.status == "Calling"


def test_kanban_move_rejects_a_status_the_app_does_not_have(client, db):
    lead = create_test_lead(db, email="v2@x.com", status="Calling")
    r = client.patch("/api/leads/kanban/move", params={"lead_id": lead.id, "new_status": "Assigned"})
    assert r.status_code == 422 and "not a lead status" in r.text


def test_known_statuses_cover_everything_the_app_writes():
    for s in ("Lead Assigned", "Research", "Calling", "Meeting Scheduled", "1st Discovery Meeting", "Discovery Complete",
              "Demo Scheduled", "Demo Done", "Completed", "Disqualified", "Pending Review", "No Phone - Parked"):
        assert s in models.KNOWN_STATUSES
    assert "Meeting Booked" not in models.KNOWN_STATUSES and "Assigned" not in models.KNOWN_STATUSES


# ── Salesforce status moves are logged ──────────────────────────────────────────────────────────────────────────
@patch("salesforce.log_sf_operation")
@patch("audience_manager.sync_leads_to_am_background")
def test_salesforce_pull_logs_the_status_it_sets(mock_am, mock_log, db):
    sync_leads_from_salesforce(db, _sf([_rec("00Qnew", "New")]), limit=10)
    new = db.query(models.Lead).filter(models.Lead.sf_lead_id == "00Qnew").one()
    logs = db.query(models.LeadStatusLog).filter(models.LeadStatusLog.lead_id == new.id).all()
    assert [(l.from_status, l.to_status, l.changed_by) for l in logs] == [(None, "Lead Assigned", "Salesforce sync")]
    assert new.status_changed_at is not None


@patch("salesforce.log_sf_operation")
@patch("audience_manager.sync_leads_to_am_background")
def test_salesforce_advance_is_logged_and_no_change_is_not(mock_am, mock_log, db):
    lead = create_test_lead(db, sf_lead_id="00Qadv", email="adv@x.com", status="Lead Assigned")
    sync_leads_from_salesforce(db, _sf([_rec("00Qadv", "Working - Contacted")]), limit=10)
    db.refresh(lead)
    assert lead.status == "Calling"
    n = db.query(models.LeadStatusLog).filter(models.LeadStatusLog.lead_id == lead.id).count()
    assert n == 1
    sync_leads_from_salesforce(db, _sf([_rec("00Qadv", "Working - Contacted")]), limit=10)   # nothing new
    assert db.query(models.LeadStatusLog).filter(models.LeadStatusLog.lead_id == lead.id).count() == 1


# ── data-quality endpoint ───────────────────────────────────────────────────────────────────────────────────────
def test_data_quality_ownership_reports_unowned_and_odd_statuses(client, db):
    create_test_lead(db, email="dq1@x.com", status="Calling")
    create_test_lead(db, email="dq2@x.com", status="Meeting Booked")
    r = client.get("/api/admin/data-quality/ownership")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["unowned_live_leads"] == 2
    assert body["statuses_outside_the_app_list"] == [{"status": "Meeting Booked", "n": 1}]
    assert set(body["reconcile"]) == {"missing_open_period", "stale_open_period", "healed"}


def test_data_quality_is_not_open_to_reps(client_as_sdr):
    assert client_as_sdr.get("/api/admin/data-quality/ownership").status_code in (401, 403)


def test_lead_ownership_history_endpoint_lists_periods(client, db):
    from conftest import create_test_user
    a = create_test_user(db, email="own@x.com", name="Owner A", id="own-a")
    lead = create_test_lead(db, email="own1@x.com")
    db.add(models.LeadOwnershipPeriod(lead_id=lead.id, user_id="own-a", reason="upload"))
    db.commit()
    r = client.get(f"/api/admin/data-quality/ownership/{lead.id}")
    assert r.status_code == 200, r.text
    [p] = r.json()["periods"]
    assert p["user"] == "Owner A" and p["reason"] == "upload" and p["to"] is None
