"""
Route-level tests for backend/routes/analytics_governance_routes.py
(Phase 3 — Metric Governance + Versioning).
"""
import models


def test_draft_forks_next_version_from_static_v1(client):
    resp = client.post("/api/admin/analytics/governance/metrics/connect_rate/draft")
    assert resp.status_code == 200
    body = resp.json()
    assert body["metric_id"] == "connect_rate"
    assert body["version_number"] == 2
    assert body["status"] == "draft"
    assert body["definition"]["description"]


def test_draft_is_idempotent_when_one_already_exists(client):
    first = client.post("/api/admin/analytics/governance/metrics/connect_rate/draft").json()
    second = client.post("/api/admin/analytics/governance/metrics/connect_rate/draft").json()
    assert first["id"] == second["id"]


def test_draft_unknown_metric_404s(client):
    resp = client.post("/api/admin/analytics/governance/metrics/close_rate/draft")
    assert resp.status_code == 404


def test_pod_admin_can_draft_but_not_publish(client_as_pod_admin):
    draft = client_as_pod_admin.post("/api/admin/analytics/governance/metrics/connect_rate/draft")
    assert draft.status_code == 200
    publish = client_as_pod_admin.post("/api/admin/analytics/governance/metrics/connect_rate/publish")
    assert publish.status_code == 403


def test_sdr_cannot_draft(client_as_sdr):
    resp = client_as_sdr.post("/api/admin/analytics/governance/metrics/connect_rate/draft")
    assert resp.status_code == 403


def test_edit_draft_updates_only_provided_fields(client):
    draft = client.post("/api/admin/analytics/governance/metrics/connect_rate/draft").json()
    original_formula = draft["definition"]["formula_description"]

    resp = client.put(
        f"/api/admin/analytics/governance/drafts/{draft['id']}",
        json={"description": "New description text."},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["definition"]["description"] == "New description text."
    assert body["definition"]["formula_description"] == original_formula


def test_edit_published_version_is_rejected(client):
    draft = client.post("/api/admin/analytics/governance/metrics/connect_rate/draft").json()
    client.post("/api/admin/analytics/governance/metrics/connect_rate/publish")

    resp = client.put(
        f"/api/admin/analytics/governance/drafts/{draft['id']}",
        json={"description": "Too late."},
    )
    assert resp.status_code == 409


def test_publish_supersedes_prior_and_registry_reflects_it(client, db):
    draft = client.post("/api/admin/analytics/governance/metrics/connect_rate/draft").json()
    client.put(
        f"/api/admin/analytics/governance/drafts/{draft['id']}",
        json={"description": "v2 description."},
    )
    publish_resp = client.post("/api/admin/analytics/governance/metrics/connect_rate/publish")
    assert publish_resp.status_code == 200
    assert publish_resp.json()["status"] == "published"

    from analytics import registry
    metric = registry.get_metric("connect_rate", db)
    assert metric.version == 2
    assert metric.description == "v2 description."

    # Static (no-db) lookup is untouched — v1 stays the code default.
    assert registry.get_metric("connect_rate").version == 1


def test_publish_without_a_draft_409s(client):
    resp = client.post("/api/admin/analytics/governance/metrics/connect_rate/publish")
    assert resp.status_code == 409


def test_preview_draft_resolves_value_with_draft_explanation_text(client, db):
    from conftest import create_test_pod, create_test_user, create_test_lead, create_test_dialer_call
    pod = create_test_pod(db, name="P")
    sdr = create_test_user(db, email="s@t.com", role="SDR", pod_id=pod.id)
    lead = create_test_lead(db, email="l@t.com", pod_id=pod.id)
    create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested")

    draft = client.post("/api/admin/analytics/governance/metrics/connect_rate/draft").json()
    client.put(
        f"/api/admin/analytics/governance/drafts/{draft['id']}",
        json={"description": "Preview description."},
    )

    resp = client.get(f"/api/admin/analytics/governance/drafts/{draft['id']}/preview")
    assert resp.status_code == 200
    body = resp.json()
    assert body["value"] == 100.0  # execution is unchanged by a metadata-only draft
    assert body["explanation"]["definition"] == "Preview description."
    assert body["metric"]["status"] == "draft"
    assert body["metric"]["version"] == 2


def test_compare_versions_lists_changed_fields(client):
    draft = client.post("/api/admin/analytics/governance/metrics/connect_rate/draft").json()
    client.put(
        f"/api/admin/analytics/governance/drafts/{draft['id']}",
        json={"description": "Changed."},
    )
    resp = client.get("/api/admin/analytics/governance/metrics/connect_rate/compare-versions")
    assert resp.status_code == 200
    body = resp.json()
    assert body["changed_fields"] == ["description"]
    assert body["draft"]["description"] == "Changed."
    assert body["published_version"] == 1
    assert body["draft_version"] == 2


def test_compare_versions_without_a_draft_409s(client):
    resp = client.get("/api/admin/analytics/governance/metrics/connect_rate/compare-versions")
    assert resp.status_code == 409


def test_list_versions(client):
    client.post("/api/admin/analytics/governance/metrics/connect_rate/draft")
    resp = client.get("/api/admin/analytics/governance/metrics/connect_rate/versions")
    assert resp.status_code == 200
    versions = resp.json()["versions"]
    assert len(versions) == 1
    assert versions[0]["version_number"] == 2
    assert versions[0]["status"] == "draft"
