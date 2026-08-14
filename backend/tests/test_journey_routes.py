"""
Route-level tests for backend/routes/journey_routes.py.
Full design: docs/SALES_JOURNEY_ARCHITECTURE.md.
"""
from conftest import create_test_lead, create_test_pod

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


def test_enroll_enrolls_leads_into_a_published_journey(client_as_pod_admin, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")

    resp = client_as_pod_admin.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["enrolled"] == 1
    assert body["skipped"] == []


def test_enroll_rejects_sdr_during_the_super_admin_only_soft_launch(client_as_pod_admin, client_as_sdr, db):
    journey_id = _publish_linear_journey(client_as_pod_admin)
    lead = create_test_lead(db, status="New")

    resp = client_as_sdr.post(f"/api/journeys/{journey_id}/enroll", json={"lead_ids": [lead.id]})
    assert resp.status_code == 403


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
