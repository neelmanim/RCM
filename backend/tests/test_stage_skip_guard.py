"""SDR one-stage-at-a-time guard (RCA 2026-09-29): legacy's stepper blocked
an SDR skipping a whole pipeline stage, but only client-side — the backend
never enforced it, so the React Lead Detail Hub's Change Stage let an SDR
jump Calling -> Demo Done. Both status endpoints now share _skips_stage()."""
from conftest import create_test_lead
from routes.lead_helpers import _skips_stage


def _lead(db, status, email):
    # SDR-created fixtures must be assigned to the SDR so _can_modify_lead allows the edit.
    import models
    lead = create_test_lead(db, email=email, status=status)
    sdr = db.query(models.User).filter(models.User.id == "sdr-user-id").first()
    if sdr is None:
        sdr = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR", role="SDR")
        db.add(sdr); db.commit()
    models.assign_lead(sdr, lead); db.commit()
    return lead


def test_skips_stage_rule():
    assert _skips_stage("Calling", "Demo Done")                 # 0 -> 3
    assert _skips_stage("Research", "1st Discovery Meeting")    # 0 -> 2
    assert not _skips_stage("Lead Assigned", "Calling")         # within a stage
    assert not _skips_stage("Calling", "Meeting Scheduled")     # +1 stage
    assert not _skips_stage("Discovery Complete", "Demo Scheduled")
    assert not _skips_stage("Pending Review", "Demo Scheduled")  # parked: exempt
    assert not _skips_stage("Calling", "Disqualified")           # terminal: exempt


def test_sdr_cannot_skip_a_stage_via_direct_update(client_as_sdr, db):
    lead = _lead(db, "Calling", "skip1@t.com")
    resp = client_as_sdr.patch(f"/api/leads/{lead.id}", json={"status": "Demo Done"})
    assert resp.status_code == 403
    assert "one stage at a time" in resp.json()["detail"]
    db.refresh(lead)
    assert lead.status == "Calling"


def test_sdr_cannot_skip_a_stage_via_kanban(client_as_sdr, db):
    lead = _lead(db, "Calling", "skip2@t.com")
    resp = client_as_sdr.patch("/api/leads/kanban/move", params={"lead_id": lead.id, "new_status": "Demo Scheduled"})
    assert resp.status_code == 403


def test_sdr_can_still_advance_one_stage(client_as_sdr, db):
    lead = _lead(db, "Discovery Complete", "skip3@t.com")
    resp = client_as_sdr.patch(f"/api/leads/{lead.id}", json={"status": "Demo Scheduled"})
    assert resp.status_code == 200, resp.text


def test_super_admin_can_skip_stages(client, db):
    lead = create_test_lead(db, email="skip4@t.com", status="Calling")
    resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Demo Done"})
    assert resp.status_code == 200, resp.text
