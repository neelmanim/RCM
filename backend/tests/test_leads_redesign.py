"""Tests for the Leads redesign backend additions (Phase B).

Covers:
- GET /api/leads multi-select `status` filter
- Tags: model, CRUD endpoints, filter on GET /api/leads, attach/detach
- Lead.upload_log_id filter on GET /api/leads
- GET /api/leads response includes tags / pod_id / upload_log_id
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_user, create_test_lead
import models


class TestMultiStatusFilter:

    def test_single_status_still_works(self, client, db):
        create_test_lead(db, email="a@t.com", status="Calling")
        create_test_lead(db, email="b@t.com", status="Research")
        resp = client.get("/api/leads", params={"status": "Calling"})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) == 1
        assert data[0]["status"] == "Calling"

    def test_multi_status_ors_across_values(self, client, db):
        create_test_lead(db, email="a@t.com", status="Calling")
        create_test_lead(db, email="b@t.com", status="Research")
        create_test_lead(db, email="c@t.com", status="Demo Scheduled")
        resp = client.get("/api/leads", params=[("status", "Calling"), ("status", "Research")])
        assert resp.status_code == 200
        statuses = {l["status"] for l in resp.json()["data"]}
        assert statuses == {"Calling", "Research"}

    def test_multi_status_excludes_parked_unless_requested(self, client, db):
        create_test_lead(db, email="a@t.com", status="Disqualified")
        create_test_lead(db, email="b@t.com", status="Calling")
        resp = client.get("/api/leads", params=[("status", "Calling")])
        statuses = {l["status"] for l in resp.json()["data"]}
        assert "Disqualified" not in statuses

        resp2 = client.get("/api/leads", params=[("status", "Disqualified")])
        statuses2 = {l["status"] for l in resp2.json()["data"]}
        assert statuses2 == {"Disqualified"}


class TestTags:

    def test_create_tag_and_list(self, client, db):
        resp = client.post("/api/tags", json={"name": "APAC"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "APAC"

        resp2 = client.get("/api/tags")
        assert resp2.status_code == 200
        names = [t["name"] for t in resp2.json()["tags"]]
        assert "APAC" in names

    def test_create_tag_is_idempotent_by_name(self, client, db):
        client.post("/api/tags", json={"name": "Warm Intro"})
        client.post("/api/tags", json={"name": "Warm Intro"})
        resp = client.get("/api/tags")
        names = [t["name"] for t in resp.json()["tags"]]
        assert names.count("Warm Intro") == 1

    def test_attach_and_detach_tag(self, client, db):
        lead = create_test_lead(db, email="tagme@t.com")
        tag_resp = client.post("/api/tags", json={"name": "Enterprise"})
        tag_id = tag_resp.json()["id"]

        attach = client.post(f"/api/leads/{lead.id}/tags/{tag_id}")
        assert attach.status_code == 200
        assert "Enterprise" in [t["name"] for t in attach.json()["tags"]]

        detach = client.delete(f"/api/leads/{lead.id}/tags/{tag_id}")
        assert detach.status_code == 200
        assert detach.json()["tags"] == []

    def test_tag_filter_on_leads_list(self, client, db):
        lead_a = create_test_lead(db, email="a@t.com")
        create_test_lead(db, email="b@t.com")
        tag_resp = client.post("/api/tags", json={"name": "Q3 Outbound"})
        tag_id = tag_resp.json()["id"]
        client.post(f"/api/leads/{lead_a.id}/tags/{tag_id}")

        resp = client.get("/api/leads", params={"tag": "Q3 Outbound"})
        data = resp.json()["data"]
        assert len(data) == 1
        assert data[0]["id"] == lead_a.id
        assert data[0]["tags"] == ["Q3 Outbound"]

    def test_multi_tag_filter_ors_across_values(self, client, db):
        lead_a = create_test_lead(db, email="a@t.com")
        lead_b = create_test_lead(db, email="b@t.com")
        create_test_lead(db, email="c@t.com")
        tag1 = client.post("/api/tags", json={"name": "APAC"}).json()["id"]
        tag2 = client.post("/api/tags", json={"name": "EU Fintech"}).json()["id"]
        client.post(f"/api/leads/{lead_a.id}/tags/{tag1}")
        client.post(f"/api/leads/{lead_b.id}/tags/{tag2}")

        resp = client.get("/api/leads", params=[("tag", "APAC"), ("tag", "EU Fintech")])
        ids = {l["id"] for l in resp.json()["data"]}
        assert ids == {lead_a.id, lead_b.id}

    def test_leads_list_includes_pod_and_upload_log_fields(self, client, db):
        lead = create_test_lead(db, email="fields@t.com", pod_id="pod-1")
        resp = client.get("/api/leads")
        row = next(l for l in resp.json()["data"] if l["id"] == lead.id)
        assert row["pod_id"] == "pod-1"
        assert row["upload_log_id"] is None
        assert row["tags"] == []


class TestUploadLogFilter:

    def test_filter_by_upload_log_id(self, client, db):
        log = models.LeadUploadLog(filename="apac.csv", total_rows=1, created=1, status="completed")
        db.add(log)
        db.commit()
        db.refresh(log)

        matching = create_test_lead(db, email="matched@t.com")
        matching.upload_log_id = log.id
        create_test_lead(db, email="unmatched@t.com")
        db.commit()

        resp = client.get("/api/leads", params={"upload_log_id": log.id})
        data = resp.json()["data"]
        assert len(data) == 1
        assert data[0]["id"] == matching.id
        assert data[0]["upload_log_id"] == log.id
