"""Tests for routes/sf_log_routes.py — SF integration log listing, detail, export."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_sf_log


class TestListSfLogs:

    def test_paginated_list(self, client, db):
        for i in range(5):
            create_test_sf_log(db, operation_type="create", status="success", email=f"log{i}@t.com")
        resp = client.get("/api/admin/sf-logs?per_page=3")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["logs"]) == 3
        assert data["total"] == 5
        assert data["total_pages"] == 2

    def test_filter_by_status(self, client, db):
        create_test_sf_log(db, status="success")
        create_test_sf_log(db, status="failed")
        resp = client.get("/api/admin/sf-logs?status=failed")
        data = resp.json()
        assert data["total"] == 1
        assert data["logs"][0]["status"] == "failed"

    def test_filter_by_operation_type(self, client, db):
        create_test_sf_log(db, operation_type="create")
        create_test_sf_log(db, operation_type="update")
        resp = client.get("/api/admin/sf-logs?operation_type=update")
        data = resp.json()
        assert data["total"] == 1

    def test_search_by_email(self, client, db):
        create_test_sf_log(db, email="unique-sf@t.com")
        create_test_sf_log(db, email="other@t.com")
        resp = client.get("/api/admin/sf-logs?search=unique-sf")
        assert resp.json()["total"] == 1


class TestSfLogDetail:

    def test_get_log_detail(self, client, db):
        log = create_test_sf_log(db, operation_type="create", email="detail@t.com")
        resp = client.get(f"/api/admin/sf-logs/{log.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["operation_type"] == "create"
        assert data["email"] == "detail@t.com"

    def test_get_nonexistent_log_404(self, client):
        resp = client.get("/api/admin/sf-logs/fake-log-id")
        assert resp.status_code == 404


class TestExportSfLogs:

    def test_export_csv(self, client, db):
        create_test_sf_log(db, operation_type="fetch", email="export@t.com")
        resp = client.get("/api/admin/sf-logs/export")
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        content = resp.text
        assert "export@t.com" in content
        assert "Timestamp" in content  # header row
