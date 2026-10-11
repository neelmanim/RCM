"""
Route-level tests for backend/routes/journey_routes.py.
Full design: docs/SALES_JOURNEY_ARCHITECTURE.md.
"""
import pytest
from conftest import create_test_lead, create_test_pod, create_user_mailbox
import models

LINEAR_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0},
         "data": {"event": "status_changed", "to_status": "New"}},
        {"id": "n2", "type": "email", "position": {"x": 200, "y": 0},
         "data": {"subject": "Hi", "body": "Hello"}},
    ],
    "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
}


def _publish_linear_journey(client, name="Test Journey"):
    created = client.post("/api/journeys", json={"name": name}).json()
    client.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
               json={"graph_definition": LINEAR_GRAPH})
    published = client.post(f"/api/journeys/{created['id']}/publish").json()
    return created["id"]


def test_create_journey_returns_a_draft_with_empty_graph(client_as_pod_admin):
    resp = client_as_pod_admin.post("/api/journeys", json={"name": "Onboarding Sequence"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Onboarding Sequence"
    assert body["status"] == "draft"
    assert body["draft_version_id"]


def test_ai_generate_email_requires_a_prompt(client_as_pod_admin):
    resp = client_as_pod_admin.post("/api/journeys/ai/generate-email", json={"prompt": "  "})
    assert resp.status_code == 422


def test_ai_generate_email_returns_422_when_llm_not_configured(client_as_pod_admin):
    resp = client_as_pod_admin.post("/api/journeys/ai/generate-email", json={"prompt": "A follow-up email"})
    assert resp.status_code == 422
    assert "Groq API key" in resp.json()["detail"]


def test_ai_generate_email_returns_the_generated_copy(client_as_pod_admin):
    from unittest.mock import patch
    with patch("routes.journey_routes.generate_email_copy", return_value={"subject": "Hi", "body": "Body"}):
        resp = client_as_pod_admin.post("/api/journeys/ai/generate-email", json={"prompt": "A follow-up email"})
    assert resp.status_code == 200
    assert resp.json() == {"subject": "Hi", "body": "Body"}


def test_create_journey_requires_a_name(client_as_pod_admin):
    resp = client_as_pod_admin.post("/api/journeys", json={"name": "  "})
    assert resp.status_code == 422


def test_create_journey_with_pod_id_scopes_it(client_as_pod_admin, db):
    pod = create_test_pod(db)
    resp = client_as_pod_admin.post("/api/journeys", json={"name": "Scoped Journey", "pod_id": pod.id})
    assert resp.status_code == 200
    assert resp.json()["pod_id"] == pod.id


def test_create_journey_rejects_unknown_pod_id(client_as_pod_admin):
    resp = client_as_pod_admin.post("/api/journeys", json={"name": "Bad Pod", "pod_id": "no-such-pod"})
    assert resp.status_code == 422


def test_update_journey_settings_sets_and_clears_pod_scope(client_as_pod_admin, db):
    pod = create_test_pod(db)
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Journey"}).json()

    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={"pod_id": pod.id})
    assert resp.status_code == 200
    assert resp.json()["pod_id"] == pod.id

    resp = client_as_pod_admin.get(f"/api/journeys/{created['id']}")
    assert resp.json()["pod_id"] == pod.id

    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={"pod_id": None})
    assert resp.status_code == 200
    assert resp.json()["pod_id"] is None


def test_update_journey_settings_rejects_unknown_pod_id(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Journey"}).json()
    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={"pod_id": "no-such-pod"})
    assert resp.status_code == 422


def test_update_journey_settings_renames_journey(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Old Name"}).json()
    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={"name": "  New Name  "})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"

    resp = client_as_pod_admin.get(f"/api/journeys/{created['id']}")
    assert resp.json()["name"] == "New Name"


def test_update_journey_settings_rejects_blank_name(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Old Name"}).json()
    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={"name": "   "})
    assert resp.status_code == 422

    resp = client_as_pod_admin.get(f"/api/journeys/{created['id']}")
    assert resp.json()["name"] == "Old Name"


def test_update_journey_settings_sets_send_window(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Journey"}).json()
    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={
        "send_tz": "America/New_York", "send_window_start_hour": 9,
        "send_window_end_hour": 18, "send_days": "0,1,2,3,4",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["send_tz"] == "America/New_York"
    assert body["send_window_start_hour"] == 9
    assert body["send_window_end_hour"] == 18
    assert body["send_days"] == "0,1,2,3,4"

    resp = client_as_pod_admin.get(f"/api/journeys/{created['id']}")
    assert resp.json()["send_window_start_hour"] == 9


def test_update_journey_settings_rejects_unknown_timezone(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Journey"}).json()
    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={"send_tz": "Not/A_Real_Zone"})
    assert resp.status_code == 422


def test_update_journey_settings_rejects_out_of_range_hour(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Journey"}).json()
    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={"send_window_start_hour": 24})
    assert resp.status_code == 422


def test_update_journey_settings_rejects_end_hour_before_start_hour(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Journey"}).json()
    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={
        "send_window_start_hour": 18, "send_window_end_hour": 9,
    })
    assert resp.status_code == 422


def test_update_journey_settings_rejects_malformed_send_days(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Journey"}).json()
    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={"send_days": "0,9,2"})
    assert resp.status_code == 422


def test_update_journey_settings_can_clear_send_window(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Journey"}).json()
    client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={
        "send_tz": "UTC", "send_window_start_hour": 9, "send_window_end_hour": 18,
    })
    resp = client_as_pod_admin.patch(f"/api/journeys/{created['id']}", json={
        "send_tz": None, "send_window_start_hour": None, "send_window_end_hour": None,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["send_tz"] is None
    assert body["send_window_start_hour"] is None


def test_list_journeys_returns_created_journeys(client_as_pod_admin):
    client_as_pod_admin.post("/api/journeys", json={"name": "Journey A"})
    client_as_pod_admin.post("/api/journeys", json={"name": "Journey B"})

    resp = client_as_pod_admin.get("/api/journeys")
    assert resp.status_code == 200
    names = [j["name"] for j in resp.json()]
    assert "Journey A" in names
    assert "Journey B" in names


def test_get_journey_returns_the_draft_graph(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()

    resp = client_as_pod_admin.get(f"/api/journeys/{created['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version_id"] == created["draft_version_id"]
    assert body["graph_definition"] == {"nodes": [], "edges": []}


def test_get_journey_404s_for_unknown_id(client_as_pod_admin):
    resp = client_as_pod_admin.get("/api/journeys/does-not-exist")
    assert resp.status_code == 404


def test_list_and_get_journey_are_open_to_a_non_admin_role_for_transparency(client_as_pod_admin, client_as_sdr):
    """Cadence visibility was relaxed from Pod Admin+ to every authenticated
    role — the frontend gives a non-admin a read-only builder view, so these
    two read routes must not 403 for them. Mutating routes stay owner-only
    (asserted below via publish of someone else's cadence)."""
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Visible To All"}).json()

    list_resp = client_as_sdr.get("/api/journeys")
    assert list_resp.status_code == 200
    assert any(j["name"] == "Visible To All" for j in list_resp.json())

    get_resp = client_as_sdr.get(f"/api/journeys/{created['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["graph_definition"] == {"nodes": [], "edges": []}

    # Mutating routes are unaffected by the relaxed GETs above.
    publish_resp = client_as_sdr.post(f"/api/journeys/{created['id']}/publish")
    assert publish_resp.status_code == 403


@pytest.mark.parametrize("rep_fixture", ["client_as_sdr", "client_as_ae"])
def test_rep_can_build_and_run_their_own_cadence(request, rep_fixture):
    """v13.1.3 opened cadence creation to every role, but save/publish/settings/
    pause/resume/archive stayed Pod Admin+ — a rep could create a cadence and
    then every autosave 403'd. Those routes are owner-guarded, so the owner of
    any role must be able to run the whole lifecycle."""
    rep = request.getfixturevalue(rep_fixture)
    created = rep.post("/api/journeys", json={"name": f"Rep cadence {rep_fixture}"}).json()
    jid = created["id"]
    graph = {"nodes": [
        {"id": "t", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"event": "status_changed", "to_status": "New"}},
        {"id": "e1", "type": "email", "position": {"x": 0, "y": 100}, "data": {"subject": "Hi", "body": "Hello"}},
    ], "edges": [{"id": "a", "source": "t", "target": "e1"}]}
    assert rep.put(f"/api/journeys/{jid}/versions/{created['draft_version_id']}",
                   json={"graph_definition": graph}).status_code == 200
    assert rep.patch(f"/api/journeys/{jid}", json={"name": "Renamed by rep"}).status_code == 200
    assert rep.post(f"/api/journeys/{jid}/publish").status_code == 200
    assert rep.post(f"/api/journeys/{jid}/pause").status_code == 200
    assert rep.post(f"/api/journeys/{jid}/resume").status_code == 200
    assert rep.post(f"/api/journeys/{jid}/archive", json={"confirm_exit_count": 0}).status_code == 200


def _failed_enrollment(db, client_as, name):
    """A published cadence owned by client_as, with one FAILED enrollment —
    inserted directly so the test doesn't depend on per-role lead edit rights."""
    jid = _publish_linear_journey(client_as, name)
    journey = db.query(models.Journey).filter(models.Journey.id == jid).first()
    lead = create_test_lead(db)
    enrollment = models.JourneyEnrollment(journey_id=jid, version_id=journey.live_version_id,
                                          lead_id=lead.id, current_node_id="n2", status="failed")
    db.add(enrollment)
    db.commit()
    return enrollment


def test_rep_owner_can_retry_and_skip_failed_enrollments_in_their_own_cadence(client_as_ae, db):
    """The builder shows Retry/Skip (FailedEnrollmentsPanel) to anyone who can
    edit the cadence — a rep owner included — so the routes must not 403 them."""
    enrollment = _failed_enrollment(db, client_as_ae, "AE's own cadence")
    assert client_as_ae.post(f"/api/journeys/enrollments/{enrollment.id}/retry").status_code != 403
    enrollment = _failed_enrollment(db, client_as_ae, "AE's other cadence")
    assert client_as_ae.post(f"/api/journeys/enrollments/{enrollment.id}/skip").status_code != 403


def test_rep_cannot_retry_or_skip_in_someone_elses_cadence(client_as_pod_admin, client_as_sdr, db):
    enrollment = _failed_enrollment(db, client_as_pod_admin, "Pod Admin's cadence")
    for action in ("retry", "skip", "force-next-step"):
        assert client_as_sdr.post(f"/api/journeys/enrollments/{enrollment.id}/{action}").status_code == 403


def test_rep_cannot_modify_someone_elses_cadence(client_as_pod_admin, client_as_ae):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Pod Admin's cadence"}).json()
    jid = created["id"]
    assert client_as_ae.put(f"/api/journeys/{jid}/versions/{created['draft_version_id']}",
                            json={"graph_definition": {"nodes": [], "edges": []}}).status_code == 403
    assert client_as_ae.patch(f"/api/journeys/{jid}", json={"name": "X"}).status_code == 403
    assert client_as_ae.post(f"/api/journeys/{jid}/archive", json={"confirm_exit_count": 0}).status_code == 403


def test_save_draft_updates_the_graph(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()
    graph = {"nodes": [{"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0},
                         "data": {"event": "status_changed", "to_status": "New"}}], "edges": []}

    resp = client_as_pod_admin.put(
        f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
        json={"graph_definition": graph},
    )
    assert resp.status_code == 200

    fetched = client_as_pod_admin.get(f"/api/journeys/{created['id']}").json()
    assert fetched["graph_definition"] == graph


def test_save_draft_409s_on_stale_expected_updated_at(client_as_pod_admin):
    """Optimistic concurrency (Gap 6): a stale expected_updated_at means
    someone else saved first — must 409, not silently overwrite."""
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()

    resp = client_as_pod_admin.put(
        f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
        json={"graph_definition": {"nodes": [], "edges": []},
              "expected_updated_at": "2020-01-01T00:00:00Z"},
    )
    assert resp.status_code == 409


def test_publish_requires_a_trigger_node(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()
    resp = client_as_pod_admin.post(f"/api/journeys/{created['id']}/publish")
    assert resp.status_code == 422


def _publish_with_trigger(client, trigger_data):
    created = client.post("/api/journeys", json={"name": "Test"}).json()
    graph = {**LINEAR_GRAPH, "nodes": [{**LINEAR_GRAPH["nodes"][0], "data": trigger_data}, LINEAR_GRAPH["nodes"][1]]}
    client.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
               json={"graph_definition": graph})
    return client.post(f"/api/journeys/{created['id']}/publish")


def test_publish_rejects_a_status_trigger_with_no_status(client_as_pod_admin):
    """A blank to_status matches EVERY status change, so it can't go live."""
    for data in ({"event": "status_changed"}, {"event": "status_changed", "to_status": "  "}):
        resp = _publish_with_trigger(client_as_pod_admin, data)
        assert resp.status_code == 422
        assert "needs a status" in resp.json()["detail"]


def test_publish_accepts_a_status_trigger_with_a_status_and_other_trigger_kinds(client_as_pod_admin):
    assert _publish_with_trigger(client_as_pod_admin, {"event": "status_changed", "to_status": "Calling"}).status_code == 200
    assert _publish_with_trigger(client_as_pod_admin, {"event": "manual"}).status_code == 200


def test_roster_reports_how_each_lead_was_enrolled(client_as_pod_admin, client, db):
    _ensure_pod_admin_user_row(db)
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="Lead Assigned")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    # read as Super Admin: a Pod Admin only sees their own pod's leads (v13.8.0)
    rows = client.get(f"/api/journeys/{journey_id}/enrollments").json()["enrollments"]

    assert [r["enrolled_via"] for r in rows] == ["manual"]


def test_publish_rejects_a_blank_email_node(client_as_pod_admin):
    """2026-08-05: publish previously only checked 'has a trigger' — a blank-
    subject/body email node could go live and actually send blank emails
    before anyone noticed. Must be rejected at publish time now."""
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()
    graph = {
        "nodes": [
            {"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0},
             "data": {"event": "status_changed", "to_status": "New"}},
            {"id": "n2", "type": "email", "position": {"x": 200, "y": 0}, "data": {"subject": "", "body": ""}},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }
    client_as_pod_admin.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
                             json={"graph_definition": graph})
    resp = client_as_pod_admin.post(f"/api/journeys/{created['id']}/publish")
    assert resp.status_code == 422
    assert "subject" in resp.json()["detail"]


def test_publish_rejects_an_ab_email_node_with_a_blank_variant(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()
    graph = {
        "nodes": [
            {"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0},
             "data": {"event": "status_changed", "to_status": "New"}},
            {"id": "n2", "type": "email", "position": {"x": 200, "y": 0}, "data": {
                "variants": [{"subject": "A", "body": "a"}, {"subject": "", "body": ""}],
            }},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }
    client_as_pod_admin.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
                             json={"graph_definition": graph})
    resp = client_as_pod_admin.post(f"/api/journeys/{created['id']}/publish")
    assert resp.status_code == 422
    assert "variant 2" in resp.json()["detail"].lower()


def test_publish_accepts_a_valid_ab_email_node(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()
    graph = {
        "nodes": [
            {"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0},
             "data": {"event": "status_changed", "to_status": "New"}},
            {"id": "n2", "type": "email", "position": {"x": 200, "y": 0}, "data": {
                "variants": [{"subject": "A", "body": "a"}, {"subject": "B", "body": "b"}],
            }},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }
    client_as_pod_admin.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
                             json={"graph_definition": graph})
    resp = client_as_pod_admin.post(f"/api/journeys/{created['id']}/publish")
    assert resp.status_code == 200


def _sms_graph(message):
    return {
        "nodes": [
            {"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0},
             "data": {"event": "status_changed", "to_status": "New"}},
            {"id": "n2", "type": "sms", "position": {"x": 200, "y": 0}, "data": {"message": message}},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }


def test_publish_rejects_a_blank_sms_node(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()
    client_as_pod_admin.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
                             json={"graph_definition": _sms_graph("")})
    resp = client_as_pod_admin.post(f"/api/journeys/{created['id']}/publish")
    assert resp.status_code == 422
    assert "message" in resp.json()["detail"]


def test_publish_rejects_an_sms_message_over_the_length_limit(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()
    client_as_pod_admin.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
                             json={"graph_definition": _sms_graph("x" * 1601)})
    resp = client_as_pod_admin.post(f"/api/journeys/{created['id']}/publish")
    assert resp.status_code == 422
    assert "too long" in resp.json()["detail"].lower()


def test_publish_accepts_a_valid_sms_node(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()
    client_as_pod_admin.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
                             json={"graph_definition": _sms_graph("Hi {{first_name}}")})
    resp = client_as_pod_admin.post(f"/api/journeys/{created['id']}/publish")
    assert resp.status_code == 200


def test_publish_rejects_an_unreachable_node(client_as_pod_admin):
    created = client_as_pod_admin.post("/api/journeys", json={"name": "Test"}).json()
    graph = {
        "nodes": [
            {"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0},
             "data": {"event": "status_changed", "to_status": "New"}},
            {"id": "n2", "type": "email", "position": {"x": 200, "y": 0},
             "data": {"subject": "Hi", "body": "Hello"}},
            {"id": "n3", "type": "email", "position": {"x": 400, "y": 0},
             "data": {"subject": "Orphan", "body": "Nothing links here"}},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }
    client_as_pod_admin.put(f"/api/journeys/{created['id']}/versions/{created['draft_version_id']}",
                             json={"graph_definition": graph})
    resp = client_as_pod_admin.post(f"/api/journeys/{created['id']}/publish")
    assert resp.status_code == 422
    assert "unreachable" in resp.json()["detail"]


def test_publish_forks_a_new_draft_so_the_journey_stays_editable(client_as_pod_admin):
    """2026-08-05: publish previously left the journey with zero draft
    versions (the just-published version became status='published' and
    nothing replaced it) — reopening the journey fell back to editing the
    live version directly, and every subsequent save 409'd with "Only the
    current draft version can be autosaved", making a published/active
    journey permanently uneditable."""
    journey_id = _publish_linear_journey(client_as_pod_admin)

    fetched = client_as_pod_admin.get(f"/api/journeys/{journey_id}").json()
    assert fetched["version_status"] == "draft"
    assert fetched["version_id"] != fetched["live_version_id"]

    resp = client_as_pod_admin.put(
        f"/api/journeys/{journey_id}/versions/{fetched['version_id']}",
        json={"graph_definition": LINEAR_GRAPH},
    )
    assert resp.status_code == 200


def _ensure_pod_admin_user_row(db):
    # sender_candidates() looks up the owner by a real User row, not the JWT
    # claims the test client fixtures use — same inner-join gotcha as
    # assigned_users elsewhere in this file.
    if not db.query(models.User).filter(models.User.id == "pod-admin-id").first():
        db.add(models.User(id="pod-admin-id", email="podadmin@test.com", name="Pod Admin", role="Pod Admin"))
        db.commit()


def test_enroll_check_warns_when_sender_has_no_mailbox(client_as_pod_admin, db):
    _ensure_pod_admin_user_row(db)
    journey_id = _publish_linear_journey(client_as_pod_admin)  # owner_id = pod-admin-id, no mailbox created
    lead = create_test_lead(db, status="New")

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/enroll-check?lead_ids={lead.id}")
    assert resp.status_code == 200
    warnings = resp.json()["warnings"]
    assert len(warnings) == 1
    assert warnings[0]["mailbox_status"] == "not_connected"
    assert warnings[0]["falls_back_to"] is None


def test_enroll_check_no_warning_when_sender_mailbox_is_connected(client_as_pod_admin, db):
    _ensure_pod_admin_user_row(db)
    create_user_mailbox(db, user_id="pod-admin-id", status="connected")
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/enroll-check?lead_ids={lead.id}")
    assert resp.json()["warnings"] == []


def test_enroll_check_reports_the_fallback_when_the_rep_mailbox_is_broken(client_as_pod_admin, db):
    _ensure_pod_admin_user_row(db)
    create_user_mailbox(db, user_id="pod-admin-id", status="connected")  # owner — the fallback
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    sdr_user = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR User", role="SDR")
    db.add(sdr_user)
    lead.assigned_users.append(sdr_user)
    db.commit()
    create_user_mailbox(db, user_id="sdr-user-id", status="error")  # the rep — broken

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/enroll-check?lead_ids={lead.id}")
    warnings = resp.json()["warnings"]
    assert len(warnings) == 1
    assert warnings[0]["sender_name"] == "SDR User"
    assert warnings[0]["mailbox_status"] == "error"
    assert warnings[0]["falls_back_to"] == "Pod Admin"


def test_enroll_check_warns_on_vertical_mismatch(client_as_pod_admin, db):
    create_user_mailbox(db, user_id="pod-admin-id", status="connected")
    _ensure_pod_admin_user_row(db)
    journey_id = _publish_linear_journey(client_as_pod_admin)
    client_as_pod_admin.patch(f"/api/journeys/{journey_id}", json={"vertical": "Patient Ops"})
    lead = create_test_lead(db, status="New")
    lead.vertical = "Sales/BD"
    db.commit()

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/enroll-check?lead_ids={lead.id}")
    warnings = resp.json()["warnings"]
    assert len(warnings) == 1
    assert warnings[0]["type"] == "vertical_mismatch"
    assert "Sales/BD" in warnings[0]["detail"] and "Patient Ops" in warnings[0]["detail"]


def test_enroll_check_no_vertical_warning_when_either_side_unset(client_as_pod_admin, db):
    create_user_mailbox(db, user_id="pod-admin-id", status="connected")
    _ensure_pod_admin_user_row(db)
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")  # no vertical set on either side

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/enroll-check?lead_ids={lead.id}")
    assert resp.json()["warnings"] == []


def test_enroll_check_no_vertical_warning_when_they_match(client_as_pod_admin, db):
    create_user_mailbox(db, user_id="pod-admin-id", status="connected")
    _ensure_pod_admin_user_row(db)
    journey_id = _publish_linear_journey(client_as_pod_admin)
    client_as_pod_admin.patch(f"/api/journeys/{journey_id}", json={"vertical": "Sales/BD"})
    lead = create_test_lead(db, status="New")
    lead.vertical = "Sales/BD"
    db.commit()

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/enroll-check?lead_ids={lead.id}")
    assert resp.json()["warnings"] == []


def test_journey_settings_roundtrips_vertical(client_as_pod_admin):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    resp = client_as_pod_admin.patch(f"/api/journeys/{journey_id}", json={"vertical": "Patient Ops"})
    assert resp.status_code == 200
    assert resp.json()["vertical"] == "Patient Ops"

    cleared = client_as_pod_admin.patch(f"/api/journeys/{journey_id}", json={"vertical": ""})
    assert cleared.json()["vertical"] is None


def test_enroll_check_skips_a_lead_the_caller_cannot_access(client_as_pod_admin, client_as_sdr, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")  # unassigned — SDR can't see it

    resp = client_as_sdr.get(f"/api/journeys/{journey_id}/enroll-check?lead_ids={lead.id}")
    assert resp.status_code == 200
    assert resp.json()["warnings"] == []  # hidden, not a 404/403 leak


def test_enroll_enrolls_leads_into_a_published_journey(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")

    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["enrolled"] == 1
    assert body["skipped"] == []


def test_enroll_allows_sdr_to_enroll_their_own_assigned_lead(client_as_pod_admin, client_as_sdr, db):
    # Enrollment opened to every role for assigned_rep cadences (the default)
    # — the real gate is per-lead edit rights (load_lead edit=True), not a
    # role/ownership check, since the lead's own rep sends, not the owner.
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    # assigned_users is an inner-joined relationship — a lead_assignments row
    # with no matching real User row would silently resolve to "unassigned".
    sdr_user = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR User", role="SDR")
    db.add(sdr_user)
    lead.assigned_users.append(sdr_user)
    db.commit()

    resp = client_as_sdr.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    assert resp.status_code == 200, resp.json()
    assert resp.json()["enrolled"] == 1


def test_enroll_rejects_sdr_for_a_lead_not_assigned_to_them(client_as_pod_admin, client_as_sdr, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")  # unassigned

    # load_lead hides existence of a lead the caller can't access (404, not
    # 403) — same "don't confirm it exists" pattern as everywhere else.
    resp = client_as_sdr.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    assert resp.status_code == 404


def test_remove_enrollment_exits_an_active_enrollment(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id, models.JourneyEnrollment.lead_id == lead.id).one()
    pending_row = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id, models.JourneyExecutionQueue.status == "pending").first()
    assert pending_row is not None

    resp = client_as_pod_admin.post(f"/api/journeys/enrollments/{enrollment.id}/remove")
    assert resp.status_code == 200, resp.json()
    assert resp.json() == {"enrollment_id": enrollment.id, "status": "exited_early", "exited_reason": "manually_removed"}
    db.expire_all()
    assert db.query(models.JourneyExecutionQueue).get(pending_row.id).status == "failed"


def test_remove_allows_sdr_to_remove_their_own_assigned_lead(client_as_pod_admin, client_as_sdr, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    sdr_user = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR User", role="SDR")
    db.add(sdr_user)
    lead.assigned_users.append(sdr_user)
    db.commit()
    client_as_sdr.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id, models.JourneyEnrollment.lead_id == lead.id).one()

    resp = client_as_sdr.post(f"/api/journeys/enrollments/{enrollment.id}/remove")
    assert resp.status_code == 200, resp.json()


def test_remove_rejects_a_non_owner_for_an_owner_send_cadence(client_as_pod_admin, client_as_sdr, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    sdr_user = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR User", role="SDR")
    db.add(sdr_user)
    lead.assigned_users.append(sdr_user)
    db.commit()
    # Enroll while still assigned_rep (open), THEN flip to owner-send — the
    # remove gate must still re-check send_as at removal time.
    client_as_sdr.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    client_as_pod_admin.patch(f"/api/journeys/{journey_id}", json={"send_as": "owner"})
    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id, models.JourneyEnrollment.lead_id == lead.id).one()

    resp = client_as_sdr.post(f"/api/journeys/enrollments/{enrollment.id}/remove")
    assert resp.status_code == 403


def test_remove_rejects_an_already_terminal_enrollment(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id, models.JourneyEnrollment.lead_id == lead.id).one()
    client_as_pod_admin.post(f"/api/journeys/enrollments/{enrollment.id}/remove")

    resp = client_as_pod_admin.post(f"/api/journeys/enrollments/{enrollment.id}/remove")
    assert resp.status_code == 409


def test_remove_enrollment_404_for_unknown_id(client_as_pod_admin):
    resp = client_as_pod_admin.post("/api/journeys/enrollments/does-not-exist/remove")
    assert resp.status_code == 404


def test_remove_then_reenroll_succeeds(client_as_pod_admin, db):
    """Feedback #13's whole point: pulling a lead out now must not block
    re-enrolling them later."""
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.journey_id == journey_id, models.JourneyEnrollment.lead_id == lead.id).one()
    client_as_pod_admin.post(f"/api/journeys/enrollments/{enrollment.id}/remove")

    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    assert resp.status_code == 200
    assert resp.json()["enrolled"] == 1


def test_enroll_skips_a_lead_already_actively_enrolled(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")

    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    body = resp.json()
    assert body["enrolled"] == 0
    assert body["skipped"][0]["reason"] == "already_active_in_journey_or_not_publishable"


def test_enroll_requires_lead_ids(client_as_pod_admin):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": []})
    assert resp.status_code == 422


def test_enroll_rejects_a_batch_over_200(client_as_pod_admin):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [f"l{i}" for i in range(201)]})
    assert resp.status_code == 400


def test_enroll_rate_cap_skips_leads_beyond_the_hourly_limit(client_as_pod_admin, db, monkeypatch):
    import routes.journey_routes as jr
    monkeypatch.setattr(jr, "ENROLLMENT_RATE_CAP_PER_HOUR", 2)  # tiny cap for the test

    journey_id = _publish_linear_journey(client_as_pod_admin)
    leads = [create_test_lead(db, status="New", email=f"l{i}@test.com") for i in range(3)]

    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [l.id for l in leads]})
    body = resp.json()
    assert body["enrolled"] == 2
    assert body["skipped"][0]["reason"] == "rate_cap_reached_try_again_later"
    # 2026-08-05: an admin bulk-enrolling had no idea if "later" meant 5
    # minutes or an hour — the rejection must include actual numbers.
    assert "2" in body["skipped"][0]["detail"]


def test_journey_stats_reports_counts_by_status(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert body["active"] == 1
    assert body["total"] == 1
    # 2026-08-05: "500 active" alone can't tell healthy from wedged.
    assert body["queue_depth"] == 1
    assert body["oldest_overdue_seconds"] >= 0


def test_journey_stats_reports_engagement_overall_and_by_step(client_as_pod_admin, db):
    import models
    from datetime import datetime, timezone

    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")

    def _outbound(node_id, thread_id, opened=False, clicked=False):
        db.add(models.LeadEmailActivity(
            lead_id=lead.id, direction="outbound", journey_id=journey_id,
            journey_node_id=node_id, nylas_thread_id=thread_id,
            opened_at=datetime.now(timezone.utc) if opened else None,
            clicked_at=datetime.now(timezone.utc) if clicked else None,
        ))

    # Step "n2": 2 sent, 1 opened, 1 of those clicked, 1 replied.
    _outbound("n2", "t1", opened=True, clicked=True)
    _outbound("n2", "t2", opened=False)
    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="inbound", nylas_thread_id="t1", is_auto_reply=False,
    ))
    # An auto-reply on the other thread must NOT count as a real reply.
    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="inbound", nylas_thread_id="t2", is_auto_reply=True,
    ))
    db.commit()

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
    assert resp.status_code == 200
    engagement = resp.json()["engagement"]

    assert engagement["overall"] == {
        "sent": 2, "opened": 1, "clicked": 1, "replied": 1,
        "open_rate": 0.5, "click_rate": 0.5, "reply_rate": 0.5,
    }
    assert engagement["by_step"]["n2"]["sent"] == 2
    assert engagement["by_step"]["n2"]["replied"] == 1


def test_journey_stats_reports_engagement_by_variant(client_as_pod_admin, db):
    import models
    from datetime import datetime, timezone

    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")

    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="outbound", journey_id=journey_id,
        journey_node_id="n2", variant_key="A", opened_at=datetime.now(timezone.utc),
    ))
    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="outbound", journey_id=journey_id,
        journey_node_id="n2", variant_key="B", opened_at=None,
    ))
    # A plain, non-A/B step — must not spuriously get a by_variant key.
    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="outbound", journey_id=journey_id,
        journey_node_id="n3", variant_key=None,
    ))
    db.commit()

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
    engagement = resp.json()["engagement"]

    by_variant = engagement["by_step"]["n2"]["by_variant"]
    assert by_variant["A"]["sent"] == 1
    assert by_variant["A"]["opened"] == 1
    assert by_variant["B"]["sent"] == 1
    assert by_variant["B"]["opened"] == 0
    assert "by_variant" not in engagement["by_step"]["n3"]


def test_journey_activity_merges_email_and_sms_events_chronologically(client_as_pod_admin, db):
    import models
    from datetime import datetime, timedelta, timezone

    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New", first_name="Priya", last_name="Shah")
    now = datetime.now(timezone.utc)

    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="outbound", journey_id=journey_id, journey_node_id="n2",
        subject="Welcome", nylas_thread_id="t1", timestamp=now - timedelta(hours=3),
    ))
    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="inbound", nylas_thread_id="t1",
        subject="Re: Welcome", is_auto_reply=False, timestamp=now - timedelta(hours=2),
    ))
    db.add(models.SmsLog(
        lead_id=lead.id, direction="outbound", journey_id=journey_id, journey_node_id="n3",
        message_text="Hi there", status="sent", sent_at=now - timedelta(hours=1),
    ))
    db.commit()

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/activity")
    assert resp.status_code == 200
    events = resp.json()

    types = [e["type"] for e in events]
    assert "email_sent" in types
    assert "email_reply" in types
    assert "sms_sent" in types
    # Most recent first.
    ats = [e["at"] for e in events]
    assert ats == sorted(ats, reverse=True)


def test_journey_activity_excludes_auto_replies_from_email_reply_but_still_shows_them(client_as_pod_admin, db):
    import models
    from datetime import datetime, timezone

    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")

    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="outbound", journey_id=journey_id, journey_node_id="n2",
        subject="Welcome", nylas_thread_id="t-ooo", timestamp=datetime.now(timezone.utc),
    ))
    db.add(models.LeadEmailActivity(
        lead_id=lead.id, direction="inbound", nylas_thread_id="t-ooo",
        subject="Automatic reply", is_auto_reply=True, timestamp=datetime.now(timezone.utc),
    ))
    db.commit()

    events = client_as_pod_admin.get(f"/api/journeys/{journey_id}/activity").json()
    auto_reply_events = [e for e in events if e["type"] == "email_auto_reply"]
    assert len(auto_reply_events) == 1
    assert not any(e["type"] == "email_reply" for e in events)


def test_journey_activity_includes_inbound_sms_from_an_enrolled_lead(client_as_pod_admin, db):
    import models

    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    db.add(models.SmsLog(lead_id=lead.id, direction="inbound", message_text="Sounds good"))
    db.commit()

    events = client_as_pod_admin.get(f"/api/journeys/{journey_id}/activity").json()
    assert any(e["type"] == "sms_reply" and e["lead_id"] == lead.id for e in events)


def test_archive_requires_the_correct_confirm_exit_count(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/archive", json={"confirm_exit_count": 0})
    assert resp.status_code == 409


def test_archive_force_exits_active_enrollments(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/archive", json={"confirm_exit_count": 1})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "archived"
    assert body["enrollments_exited"] == 1

    import models
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.lead_id == lead.id).first()
    assert enrollment.status == "exited_early"
    assert enrollment.exited_reason == "journey_archived"


def test_archive_with_zero_active_enrollments_succeeds(client_as_pod_admin):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/archive", json={"confirm_exit_count": 0})
    assert resp.status_code == 200
    assert resp.json()["enrollments_exited"] == 0


def test_get_lead_journey_enrollments_returns_empty_list_for_an_unenrolled_lead(client_as_pod_admin, db):
    lead = create_test_lead(db, status="New")
    resp = client_as_pod_admin.get(f"/api/journeys/by-lead/{lead.id}")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_lead_journey_enrollments_includes_the_journey_name(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin, name="Onboarding Sequence")
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    resp = client_as_pod_admin.get(f"/api/journeys/by-lead/{lead.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["journey_name"] == "Onboarding Sequence"
    assert body[0]["status"] == "active"
    assert body[0]["current_node_id"] == "n2"
    # 2026-08-05: this is the exact field the lead-detail "Sales Journey" card
    # renders to SDRs — a raw id like "n2" is meaningless to a non-builder user.
    assert body[0]["current_node_label"] == "Email"
    assert "reason" in body[0]["pending_status"]


def test_get_lead_journey_enrollments_includes_last_error(client_as_pod_admin, db):
    # RCA 2026-08-25: this card only ever showed the generic reason code
    # ("Send failed") — the real cause (already captured in
    # JourneyEnrollment.last_error by the engine) was never returned here,
    # unlike the admin FailedEnrollmentsPanel endpoint.
    journey_id = _publish_linear_journey(client_as_pod_admin, name="Failing Sequence")
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    enrollment = db.query(models.JourneyEnrollment).filter(
        models.JourneyEnrollment.lead_id == lead.id
    ).first()
    enrollment.status = "failed"
    enrollment.exited_reason = "send_failed"
    enrollment.last_error = "Template 'lead_followup_attempt' rejected: params mismatch"
    db.commit()

    resp = client_as_pod_admin.get(f"/api/journeys/by-lead/{lead.id}")
    assert resp.status_code == 200
    body = resp.json()[0]
    assert body["exited_reason"] == "send_failed"
    assert body["last_error"] == "Template 'lead_followup_attempt' rejected: params mismatch"


def test_pause_requires_an_active_journey(client_as_pod_admin):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/pause")

    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/pause")
    assert resp.status_code == 409


def test_pause_then_resume_round_trip(client_as_pod_admin):
    journey_id = _publish_linear_journey(client_as_pod_admin)

    paused = client_as_pod_admin.post(f"/api/journeys/{journey_id}/pause").json()
    assert paused["status"] == "paused"

    resumed = client_as_pod_admin.post(f"/api/journeys/{journey_id}/resume").json()
    assert resumed["status"] == "active"


def test_resume_requires_a_paused_journey(client_as_pod_admin):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/resume")
    assert resp.status_code == 409


def test_failed_enrollments_lists_failed_and_exited_but_not_active(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead1 = create_test_lead(db, status="New", email="l1@test.com", last_name="One")
    lead2 = create_test_lead(db, status="New", email="l2@test.com", last_name="Two")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead1.id, lead2.id]})

    import models
    enrollment1 = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.lead_id == lead1.id).first()
    enrollment1.status = "failed"
    enrollment1.exited_reason = "send_failed"
    enrollment1.last_error = "Nylas 500"
    db.commit()

    resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/failed-enrollments")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["lead_name"] == "John One"
    assert body[0]["last_error"] == "Nylas 500"


def test_retry_reactivates_a_failed_enrollment_and_enqueues_it(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    import models
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.lead_id == lead.id).first()
    enrollment.status = "failed"
    enrollment.exited_reason = "send_failed"
    db.commit()

    resp = client_as_pod_admin.post(f"/api/journeys/enrollments/{enrollment.id}/retry")
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"

    db.refresh(enrollment)
    assert enrollment.status == "active"
    assert enrollment.exited_reason is None
    pending = db.query(models.JourneyExecutionQueue).filter(
        models.JourneyExecutionQueue.enrollment_id == enrollment.id,
        models.JourneyExecutionQueue.status == "pending",
    ).count()
    assert pending >= 1


def test_retry_rejects_an_active_enrollment(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    import models
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.lead_id == lead.id).first()
    resp = client_as_pod_admin.post(f"/api/journeys/enrollments/{enrollment.id}/retry")
    assert resp.status_code == 409


def test_skip_marks_an_enrollment_manually_skipped(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")
    client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})

    import models
    enrollment = db.query(models.JourneyEnrollment).filter(models.JourneyEnrollment.lead_id == lead.id).first()
    enrollment.status = "failed"
    db.commit()

    resp = client_as_pod_admin.post(f"/api/journeys/enrollments/{enrollment.id}/skip")
    assert resp.status_code == 200
    assert resp.json()["exited_reason"] == "manually_skipped"


class TestSandboxTestLeadExclusion:
    """Cadence/Messaging Sandbox test leads (Lead.is_test=True) must never
    pollute a journey's real stats/activity feed. Each test enrolls one real
    lead and one is_test=True lead (both via the plain /enroll endpoint —
    the exclusion must hold regardless of how the lead ended up enrolled)
    with otherwise-identical activity, and asserts the journey-level number
    reflects only the real lead."""

    def test_journey_stats_excludes_test_lead_enrollment_and_queue_counts(self, client_as_pod_admin, db):
        import models

        journey_id = _publish_linear_journey(client_as_pod_admin)
        real_lead = create_test_lead(db, status="New", email="sandbox_stats_real@t.com")
        test_lead = create_test_lead(db, status="New", email="sandbox_stats_test@t.com")
        test_lead.is_test = True
        db.commit()
        client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [real_lead.id, test_lead.id]})

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        assert resp.status_code == 200
        body = resp.json()
        assert body["active"] == 1, "test lead's enrollment must not count as active"
        assert body["total"] == 1
        assert body["queue_depth"] == 1, "test lead's queued step must not count toward queue_depth"

    def test_journey_stats_excludes_test_lead_engagement(self, client_as_pod_admin, db):
        import models
        from datetime import datetime, timezone

        journey_id = _publish_linear_journey(client_as_pod_admin)
        real_lead = create_test_lead(db, status="New", email="sandbox_engage_real@t.com")
        test_lead = create_test_lead(db, status="New", email="sandbox_engage_test@t.com")
        test_lead.is_test = True
        db.commit()

        for lead, thread_id in ((real_lead, "t-real"), (test_lead, "t-test")):
            db.add(models.LeadEmailActivity(
                lead_id=lead.id, direction="outbound", journey_id=journey_id,
                journey_node_id="n2", nylas_thread_id=thread_id,
                opened_at=datetime.now(timezone.utc),
            ))
            db.add(models.LeadEmailActivity(
                lead_id=lead.id, direction="inbound", nylas_thread_id=thread_id, is_auto_reply=False,
            ))
        db.commit()

        resp = client_as_pod_admin.get(f"/api/journeys/{journey_id}/stats")
        assert resp.status_code == 200
        engagement = resp.json()["engagement"]["overall"]
        assert engagement["sent"] == 1, "test lead's email must not count toward engagement sent"
        assert engagement["opened"] == 1
        assert engagement["replied"] == 1

    def test_journey_activity_excludes_test_lead_email_and_sms_events(self, client_as_pod_admin, db):
        import models
        from datetime import datetime, timezone

        journey_id = _publish_linear_journey(client_as_pod_admin)
        real_lead = create_test_lead(db, status="New", first_name="Real", last_name="Lead", email="sandbox_activity_real@t.com")
        test_lead = create_test_lead(db, status="New", first_name="Sandbox", last_name="Test", email="sandbox_activity_test@t.com")
        test_lead.is_test = True
        db.commit()

        db.add(models.LeadEmailActivity(
            lead_id=real_lead.id, direction="outbound", journey_id=journey_id, journey_node_id="n2",
            subject="Welcome Real",
        ))
        db.add(models.LeadEmailActivity(
            lead_id=test_lead.id, direction="outbound", journey_id=journey_id, journey_node_id="n2",
            subject="Welcome Test",
        ))
        db.add(models.SmsLog(lead_id=real_lead.id, direction="outbound", journey_id=journey_id, message_text="hi real"))
        db.add(models.SmsLog(lead_id=test_lead.id, direction="outbound", journey_id=journey_id, message_text="hi test"))
        db.commit()

        events = client_as_pod_admin.get(f"/api/journeys/{journey_id}/activity").json()
        lead_ids = {e["lead_id"] for e in events}
        assert real_lead.id in lead_ids
        assert test_lead.id not in lead_ids, "test lead's activity must not appear in the journey activity feed"


class TestGdprPurgeLeadJourneyData:
    """Gap 8 (models.py's ExecutionLog docstring): ExecutionLog has no FK on
    lead_id (by design, at billions-of-rows insert volume), so it never
    cascades on lead deletion — this endpoint is the only way to purge it."""

    def test_purge_deletes_only_the_named_leads_execution_logs(self, client, db):
        import models
        lead = create_test_lead(db, email="purge-me@t.com")
        other_lead = create_test_lead(db, email="keep-me@t.com")
        db.add(models.ExecutionLog(enrollment_id="e1", journey_id="j1", lead_id=lead.id,
                                    node_id="n1", event_type="node_entered", status="success"))
        db.add(models.ExecutionLog(enrollment_id="e2", journey_id="j1", lead_id=lead.id,
                                    node_id="n2", event_type="node_completed", status="success"))
        db.add(models.ExecutionLog(enrollment_id="e3", journey_id="j1", lead_id=other_lead.id,
                                    node_id="n1", event_type="node_entered", status="success"))
        db.commit()

        resp = client.delete(f"/api/journeys/gdpr/purge-lead/{lead.id}")
        assert resp.status_code == 200
        assert resp.json()["execution_logs_deleted"] == 2

        remaining = db.query(models.ExecutionLog).filter(models.ExecutionLog.lead_id == lead.id).count()
        assert remaining == 0
        other_remaining = db.query(models.ExecutionLog).filter(models.ExecutionLog.lead_id == other_lead.id).count()
        assert other_remaining == 1, "unrelated lead's execution logs must survive the purge"

    def test_purge_is_idempotent_when_no_logs_exist(self, client):
        resp = client.delete("/api/journeys/gdpr/purge-lead/nonexistent-lead-id")
        assert resp.status_code == 200
        assert resp.json()["execution_logs_deleted"] == 0

    def test_purge_requires_super_admin(self, client_as_pod_admin):
        resp = client_as_pod_admin.delete("/api/journeys/gdpr/purge-lead/some-lead-id")
        assert resp.status_code == 403


# ── v12.2: cadence ownership scoping ────────────────────────────────────────
# Before v12.2 every mutating route was gated on require_pod_admin_or_above
# alone, so ANY Pod Admin could rename, re-point, publish, pause, resume or
# archive a cadence owned by a different Pod Admin. These assert the
# owner-or-Super-Admin rule _require_journey_owner now enforces.

import pytest
from fastapi.testclient import TestClient
from conftest import _build_test_app, _make_user_payload


@pytest.fixture()
def client_as_other_pod_admin(db):
    """A second, different Pod Admin — the whole point of these tests is that
    Pod Admin rights alone are not enough to touch someone else's cadence."""
    app = _build_test_app()
    from database import get_db, get_ai_db
    from auth import get_current_user, require_admin, require_super_admin

    other = _make_user_payload("Pod Admin", "other-pod-admin-id",
                               "other@test.com", "Other Pod Admin", pod_id="test-pod-id")

    def _override_db():
        yield db

    def _deny_super():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Super Admin access required")

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_ai_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: other
    app.dependency_overrides[require_admin] = lambda: other
    app.dependency_overrides[require_super_admin] = _deny_super

    yield TestClient(app)
    app.dependency_overrides.clear()


class TestCadenceOwnershipScoping:
    def _make_journey(self, client, name="Owned Cadence"):
        return client.post("/api/journeys", json={"name": name}).json()

    def test_owner_can_change_its_own_cadence_settings(self, client_as_pod_admin):
        j = self._make_journey(client_as_pod_admin)
        resp = client_as_pod_admin.patch(f"/api/journeys/{j['id']}", json={"name": "Renamed"})
        assert resp.status_code == 200

    def test_a_different_pod_admin_cannot_change_settings(self, client_as_pod_admin, client_as_other_pod_admin):
        j = self._make_journey(client_as_pod_admin)
        resp = client_as_other_pod_admin.patch(f"/api/journeys/{j['id']}", json={"name": "Hijacked"})
        assert resp.status_code == 403
        assert "owner" in resp.json()["detail"].lower()

    def test_a_different_pod_admin_cannot_save_the_draft_graph(self, client_as_pod_admin, client_as_other_pod_admin):
        j = self._make_journey(client_as_pod_admin)
        resp = client_as_other_pod_admin.put(
            f"/api/journeys/{j['id']}/versions/{j['draft_version_id']}",
            json={"graph_definition": LINEAR_GRAPH},
        )
        assert resp.status_code == 403

    def test_a_different_pod_admin_cannot_publish(self, client_as_pod_admin, client_as_other_pod_admin):
        j = self._make_journey(client_as_pod_admin)
        client_as_pod_admin.put(f"/api/journeys/{j['id']}/versions/{j['draft_version_id']}",
                                 json={"graph_definition": LINEAR_GRAPH})
        resp = client_as_other_pod_admin.post(f"/api/journeys/{j['id']}/publish")
        assert resp.status_code == 403

    def test_a_different_pod_admin_cannot_archive(self, client_as_pod_admin, client_as_other_pod_admin):
        j = self._make_journey(client_as_pod_admin)
        resp = client_as_other_pod_admin.post(f"/api/journeys/{j['id']}/archive",
                                               json={"confirm_exit_count": 0})
        assert resp.status_code == 403

    def test_a_different_pod_admin_cannot_pause_or_resume(self, client_as_pod_admin, client_as_other_pod_admin):
        jid = _publish_linear_journey(client_as_pod_admin, "Live One")
        assert client_as_other_pod_admin.post(f"/api/journeys/{jid}/pause").status_code == 403
        # Pause it as the owner so resume has a paused cadence to act on —
        # otherwise a 409 would mask the 403 we're actually asserting.
        assert client_as_pod_admin.post(f"/api/journeys/{jid}/pause").status_code == 200
        assert client_as_other_pod_admin.post(f"/api/journeys/{jid}/resume").status_code == 403

    # ── Enrollment-side ownership (v12.2, narrowed in v13.1.1) ───────────
    # Originally owner-or-Super-Admin only, because enrolling caused a send
    # from the owner's mailbox (email_channel sends as journey.owner_id) —
    # an unguarded enroll let a Pod Admin put mail out under another user's
    # name. v13.1.1 opened enrollment to any role for "assigned_rep" cadences
    # (the default since v13.0.0), where the lead's own rep sends instead —
    # the owner-impersonation risk doesn't apply there. The strict check
    # still applies to "owner always sends" cadences (send_as="owner").
    def test_a_different_pod_admin_cannot_enroll_into_someone_elses_owner_send_cadence(
            self, client_as_pod_admin, client_as_other_pod_admin, db):
        jid = _publish_linear_journey(client_as_pod_admin, "Not Yours")
        client_as_pod_admin.patch(f"/api/journeys/{jid}", json={"send_as": "owner"})
        lead = create_test_lead(db)
        resp = client_as_other_pod_admin.post(f"/api/journeys/{jid}/enroll",
                                               json={"lead_ids": [lead.id]})
        assert resp.status_code == 403
        assert "owner" in resp.json()["detail"].lower()

    def test_a_different_pod_admin_can_enroll_into_an_assigned_rep_cadence_they_dont_own(
            self, client_as_pod_admin, client_as_other_pod_admin, db):
        jid = _publish_linear_journey(client_as_pod_admin, "Not Yours")  # send_as="assigned_rep" by default
        lead = create_test_lead(db)  # unassigned — a Pod Admin may edit any unassigned lead
        resp = client_as_other_pod_admin.post(f"/api/journeys/{jid}/enroll",
                                               json={"lead_ids": [lead.id]})
        assert resp.status_code == 200, resp.json()
        assert resp.json()["enrolled"] == 1

    def test_owner_can_still_enroll_into_their_own_cadence(self, client_as_pod_admin, db):
        jid = _publish_linear_journey(client_as_pod_admin, "Mine To Enroll")
        lead = create_test_lead(db)
        resp = client_as_pod_admin.post(f"/api/journeys/{jid}/enroll",
                                         json={"lead_ids": [lead.id]})
        assert resp.status_code == 200
        assert resp.json()["enrolled"] == 1

    def test_a_different_pod_admin_cannot_test_enroll_into_someone_elses_cadence(
            self, client_as_pod_admin, client_as_other_pod_admin):
        jid = _publish_linear_journey(client_as_pod_admin, "Sandbox Target")
        resp = client_as_other_pod_admin.post(
            f"/api/journeys/{jid}/sandbox/enroll-test-lead", json={"label": "x"})
        # 403 from the owner guard — not the 422 a missing sandbox phone gives.
        assert resp.status_code == 403

    def test_a_different_pod_admin_cannot_touch_an_enrollment_in_someone_elses_cadence(
            self, client_as_pod_admin, client_as_other_pod_admin, db):
        jid = _publish_linear_journey(client_as_pod_admin, "Enrolled Cadence")
        lead = create_test_lead(db)
        client_as_pod_admin.post(f"/api/journeys/{jid}/enroll", json={"lead_ids": [lead.id]})
        enrollment = db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.journey_id == jid).first()
        assert enrollment is not None
        for action in ("retry", "force-next-step", "skip"):
            resp = client_as_other_pod_admin.post(
                f"/api/journeys/enrollments/{enrollment.id}/{action}")
            assert resp.status_code == 403, f"{action} was not owner-guarded"

    def test_super_admin_can_still_act_on_any_enrollment(self, client_as_pod_admin, client, db):
        jid = _publish_linear_journey(client_as_pod_admin, "Super Reachable")
        lead = create_test_lead(db)
        client_as_pod_admin.post(f"/api/journeys/{jid}/enroll", json={"lead_ids": [lead.id]})
        enrollment = db.query(models.JourneyEnrollment).filter(
            models.JourneyEnrollment.journey_id == jid).first()
        # Active (not failed), so skip answers 409 — the point is it is NOT 403.
        assert client.post(f"/api/journeys/enrollments/{enrollment.id}/skip").status_code != 403

    def test_super_admin_can_still_modify_anyone_s_cadence(self, client_as_pod_admin, client):
        j = self._make_journey(client_as_pod_admin)
        resp = client.patch(f"/api/journeys/{j['id']}", json={"name": "Super Renamed"})
        assert resp.status_code == 200

    def test_an_orphaned_cadence_is_super_admin_only(self, client_as_pod_admin, client_as_other_pod_admin, db):
        j = self._make_journey(client_as_pod_admin)
        # Owner's user row deleted -> owner_id NULL (ondelete="SET NULL").
        # Nobody inherits it; only a Super Admin can clean it up.
        db.query(models.Journey).filter(models.Journey.id == j["id"]).update({"owner_id": None})
        db.commit()
        assert client_as_pod_admin.patch(f"/api/journeys/{j['id']}", json={"name": "X"}).status_code == 403
        assert client_as_other_pod_admin.patch(f"/api/journeys/{j['id']}", json={"name": "X"}).status_code == 403

    def test_list_attributes_each_cadence_to_its_owner(self, client_as_pod_admin, client_as_other_pod_admin, db):
        from conftest import create_test_user
        create_test_user(db, email="podadmin@test.com", name="Pod Admin",
                         role="Pod Admin", id="pod-admin-id")
        self._make_journey(client_as_pod_admin, "Mine")

        mine = client_as_pod_admin.get("/api/journeys").json()[0]
        assert mine["owner_name"] == "Pod Admin"
        assert mine["is_mine"] is True
        assert mine["can_edit"] is True

        # Same cadence, seen by someone else: attributed, but not editable.
        theirs = client_as_other_pod_admin.get("/api/journeys").json()[0]
        assert theirs["owner_name"] == "Pod Admin"
        assert theirs["is_mine"] is False
        assert theirs["can_edit"] is False

    def test_get_journey_carries_ownership_for_the_builder(self, client_as_pod_admin, client_as_other_pod_admin):
        j = self._make_journey(client_as_pod_admin)
        theirs = client_as_other_pod_admin.get(f"/api/journeys/{j['id']}").json()
        assert theirs["can_edit"] is False
        assert theirs["is_mine"] is False
        # Still readable — v12.1's org-wide read-only transparency is intact.
        assert theirs["name"] == "Owned Cadence"


def test_every_builder_step_type_has_a_friendly_label():
    """The cadence lead list showed the raw "instantly_sequence" — every step
    type the builder offers (nodeDefaults.js NODE_TYPES) needs a label."""
    import re
    from pathlib import Path
    from routes.journey_routes import _NODE_LABELS
    src = (Path(__file__).parents[2] / "frontend-react/src/features/sales-journey/nodeDefaults.js").read_text()
    types = re.findall(r"'(\w+)'", re.search(r"NODE_TYPES = \[(.*?)\]", src).group(1))
    assert "instantly_sequence" in types
    assert [t for t in types if t not in _NODE_LABELS] == []
