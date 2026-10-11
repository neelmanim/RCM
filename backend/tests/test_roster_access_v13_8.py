"""v13.8.0 — the cadence roster, its counts and its CSV only list leads the
viewer may see. They used to return every enrolled lead's name, company and
email to any logged-in user."""
import models
from conftest import create_test_lead, grant_export, SDR_USER
from test_journey_routes import _publish_linear_journey, _ensure_pod_admin_user_row


def _setup(client_as_pod_admin, db):
    _ensure_pod_admin_user_row(db)      # the journey's owner row (a real FK on Postgres)
    journey_id = _publish_linear_journey(client_as_pod_admin)
    sdr = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR User", role="SDR")
    db.add(sdr)
    mine = create_test_lead(db, email="mine@test.com")
    theirs = create_test_lead(db, email="theirs@test.com")
    pod_lead = create_test_lead(db, email="pod@test.com")
    mine.assigned_users.append(sdr)
    db.add(models.Pod(id="test-pod-id", name="Test Pod"))
    db.flush()
    pod_lead.pod_id = "test-pod-id"
    db.commit()
    version_id = db.query(models.Journey).get(journey_id).live_version_id   # a real FK target on Postgres
    for lead in (mine, theirs, pod_lead):
        db.add(models.JourneyEnrollment(journey_id=journey_id, version_id=version_id, lead_id=lead.id,
                                        current_node_id="node-1", status="active"))
    db.commit()
    return journey_id


def _emails(resp):
    return sorted(e["lead_name"] for e in resp.json()["enrollments"])


def test_an_sdr_sees_only_their_own_leads_in_the_roster_and_its_counts(client_as_pod_admin, client_as_sdr, db):
    journey_id = _setup(client_as_pod_admin, db)
    r = client_as_sdr.get(f"/api/journeys/{journey_id}/enrollments")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1 and len(body["enrollments"]) == 1
    assert sum(body["status_counts"].values()) == 1
    assert sum(s["count"] for s in body["stage_breakdown"]) == 1


def test_an_sdrs_csv_export_has_only_their_leads(client_as_pod_admin, client_as_sdr, db):
    journey_id = _setup(client_as_pod_admin, db)
    grant_export(db, SDR_USER["sub"])
    csv_text = client_as_sdr.get(f"/api/journeys/{journey_id}/enrollments/export").text
    assert "mine@test.com" in csv_text
    assert "theirs@test.com" not in csv_text and "pod@test.com" not in csv_text


def test_a_pod_admin_sees_their_pods_leads_not_the_whole_org(client_as_pod_admin, db):
    journey_id = _setup(client_as_pod_admin, db)
    body = client_as_pod_admin.get(f"/api/journeys/{journey_id}/enrollments").json()
    assert body["total"] == 1                       # the pod-tagged unassigned lead only
    grant_export(db, "pod-admin-id", role="Pod Admin")
    assert "pod@test.com" in client_as_pod_admin.get(f"/api/journeys/{journey_id}/enrollments/export").text


def test_a_super_admin_sees_everyone(client_as_pod_admin, client, db):
    journey_id = _setup(client_as_pod_admin, db)
    assert client.get(f"/api/journeys/{journey_id}/enrollments").json()["total"] == 3
    assert client.get(f"/api/journeys/{journey_id}/enrollments/export").text.count("@test.com") == 3


def test_cadence_stats_stay_org_wide_aggregates(client_as_pod_admin, client_as_sdr, db):
    """/stats carries no lead data, so it keeps counting the whole cadence."""
    journey_id = _setup(client_as_pod_admin, db)
    stats = client_as_sdr.get(f"/api/journeys/{journey_id}/stats").json()
    assert stats["total"] == 3
