"""
Tests for routes/report_routes.py — Automated Analytics Reports CRUD,
preview, Run Now, and execution logs (v11.4.0).
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
from unittest.mock import patch, MagicMock

import models
from conftest import create_test_user, create_user_mailbox


def _valid_report_body(**overrides):
    body = {
        "name": "Weekly SDR Report",
        "components": ["key_metrics"],
        "date_range_rule": "previous_7_days",
        "frequency": "weekly",
        "weekday": 0,
        "timezone": "UTC",
        "send_hour": 9,
        "send_minute": 0,
        "to_recipients": ["stake@t.com"],
        "sender_user_id": "sender-1",
    }
    body.update(overrides)
    return body


class TestListComponentsAndSenders:

    def test_list_components(self, client, db):
        resp = client.get("/api/admin/analytics/reports/components")
        assert resp.status_code == 200
        ids = [c["id"] for c in resp.json()]
        assert "key_metrics" in ids
        assert "sdr_performance" in ids

    def test_list_senders_only_connected(self, client, db):
        connected = create_test_user(db, email="conn_sender@t.com", role="SDR", google_id="cs-1")
        create_user_mailbox(db, connected.id)
        create_test_user(db, email="unconn_sender@t.com", role="SDR", google_id="us-1")

        resp = client.get("/api/admin/analytics/reports/senders")
        emails = [s["email"] for s in resp.json()]
        assert "conn_sender@t.com" in emails
        assert "unconn_sender@t.com" not in emails


class TestChangelogDigestToggle:

    def test_disabled_by_default(self, client, db):
        resp = client.get("/api/admin/analytics/reports/changelog-digest")
        assert resp.status_code == 200
        assert resp.json() == {"enabled": False}

    def test_enable_requires_a_connected_mailbox(self, client, db):
        resp = client.patch("/api/admin/analytics/reports/changelog-digest", json={"enabled": True})
        assert resp.status_code == 422

    def test_enable_creates_a_singleton_release_digest_report(self, client, db):
        sender = create_test_user(db, email="cd_sender@t.com", role="SDR", google_id="cd-1")
        create_user_mailbox(db, sender.id)

        resp = client.patch("/api/admin/analytics/reports/changelog-digest", json={"enabled": True})
        assert resp.status_code == 200
        assert resp.json() == {"enabled": True}

        report = db.query(models.ReportConfig).filter(models.ReportConfig.send_to_all_users == True).first()
        assert report is not None
        assert report.enabled is True
        assert json.loads(report.components) == ["release_digest"]

    def test_toggling_off_disables_without_deleting(self, client, db):
        sender = create_test_user(db, email="cd_sender2@t.com", role="SDR", google_id="cd-2")
        create_user_mailbox(db, sender.id)
        client.patch("/api/admin/analytics/reports/changelog-digest", json={"enabled": True})

        resp = client.patch("/api/admin/analytics/reports/changelog-digest", json={"enabled": False})
        assert resp.json() == {"enabled": False}

        report = db.query(models.ReportConfig).filter(models.ReportConfig.send_to_all_users == True).first()
        assert report is not None and report.enabled is False

    def test_re_enabling_reuses_the_same_row_instead_of_duplicating(self, client, db):
        sender = create_test_user(db, email="cd_sender3@t.com", role="SDR", google_id="cd-3")
        create_user_mailbox(db, sender.id)
        client.patch("/api/admin/analytics/reports/changelog-digest", json={"enabled": True})
        client.patch("/api/admin/analytics/reports/changelog-digest", json={"enabled": False})
        client.patch("/api/admin/analytics/reports/changelog-digest", json={"enabled": True})

        rows = db.query(models.ReportConfig).filter(models.ReportConfig.send_to_all_users == True).all()
        assert len(rows) == 1

    def test_excluded_from_the_general_reports_list(self, client, db):
        sender = create_test_user(db, email="cd_sender4@t.com", role="SDR", google_id="cd-4")
        create_user_mailbox(db, sender.id)
        client.patch("/api/admin/analytics/reports/changelog-digest", json={"enabled": True})

        resp = client.get("/api/admin/analytics/reports")
        names = [r["name"] for r in resp.json()]
        assert "Weekly Changelog Digest (All Users)" not in names


class TestCreateReport:

    def test_create_requires_name(self, client, db):
        sender = create_test_user(db, email="cr_sender@t.com", role="SDR", google_id="cr-1")
        body = _valid_report_body(name="", sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_rejects_name_over_100_chars(self, client, db):
        sender = create_test_user(db, email="cr_sender2@t.com", role="SDR", google_id="cr-2")
        body = _valid_report_body(name="x" * 101, sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_requires_at_least_one_component(self, client, db):
        sender = create_test_user(db, email="cr_sender3@t.com", role="SDR", google_id="cr-3")
        body = _valid_report_body(components=[], sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_rejects_unknown_component(self, client, db):
        sender = create_test_user(db, email="cr_sender4@t.com", role="SDR", google_id="cr-4")
        body = _valid_report_body(components=["not_a_real_component"], sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_requires_at_least_one_recipient(self, client, db):
        sender = create_test_user(db, email="cr_sender5@t.com", role="SDR", google_id="cr-5")
        body = _valid_report_body(to_recipients=[], sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_rejects_invalid_recipient_email(self, client, db):
        sender = create_test_user(db, email="cr_sender6@t.com", role="SDR", google_id="cr-6")
        body = _valid_report_body(to_recipients=["not-an-email"], sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_rejects_duplicate_recipient_across_to_and_cc(self, client, db):
        sender = create_test_user(db, email="cr_sender7@t.com", role="SDR", google_id="cr-7")
        body = _valid_report_body(to_recipients=["dup@t.com"], cc_recipients=["dup@t.com"], sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_rejects_invalid_timezone(self, client, db):
        sender = create_test_user(db, email="cr_sender8@t.com", role="SDR", google_id="cr-8")
        body = _valid_report_body(timezone="Not/AZone", sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_requires_sender(self, client, db):
        body = _valid_report_body()
        del body["sender_user_id"]
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_rejects_unknown_sender(self, client, db):
        body = _valid_report_body(sender_user_id="no-such-user")
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 404

    def test_custom_range_requires_dates(self, client, db):
        sender = create_test_user(db, email="cr_sender9@t.com", role="SDR", google_id="cr-9")
        body = _valid_report_body(date_range_rule="custom", sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 422

    def test_create_succeeds_and_defaults_enabled(self, client, db):
        sender = create_test_user(db, email="cr_sender10@t.com", role="SDR", google_id="cr-10")
        body = _valid_report_body(sender_user_id=sender.id)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"] is True
        assert data["name"] == "Weekly SDR Report"
        assert data["recipient_count"] == 1
        assert data["sender_user_name"] == sender.name


class TestReportCrud:

    def _create(self, client, db, **overrides):
        sender = create_test_user(db, email=f"crud_sender_{overrides.get('_n', 1)}@t.com", role="SDR", google_id=f"crud-{overrides.get('_n', 1)}")
        overrides.pop("_n", None)
        body = _valid_report_body(sender_user_id=sender.id, **overrides)
        resp = client.post("/api/admin/analytics/reports", json=body)
        assert resp.status_code == 200
        return resp.json()

    def test_list_reports(self, client, db):
        self._create(client, db, _n=1)
        self._create(client, db, _n=2, name="Second Report")
        resp = client.get("/api/admin/analytics/reports")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_get_report_404(self, client, db):
        resp = client.get("/api/admin/analytics/reports/no-such-id")
        assert resp.status_code == 404

    def test_partial_update_only_touches_given_fields(self, client, db):
        created = self._create(client, db, _n=3)
        resp = client.patch(f"/api/admin/analytics/reports/{created['id']}", json={"name": "Renamed Report"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Renamed Report"
        assert data["frequency"] == "weekly"  # unchanged

    def test_update_rejects_invalid_frequency(self, client, db):
        created = self._create(client, db, _n=4)
        resp = client.patch(f"/api/admin/analytics/reports/{created['id']}", json={"frequency": "hourly"})
        assert resp.status_code == 422

    def test_toggle_enabled(self, client, db):
        created = self._create(client, db, _n=5)
        resp = client.patch(f"/api/admin/analytics/reports/{created['id']}/toggle", json={"enabled": False})
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

    def test_duplicate_creates_disabled_copy(self, client, db):
        created = self._create(client, db, _n=6)
        resp = client.post(f"/api/admin/analytics/reports/{created['id']}/duplicate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] != created["id"]
        assert data["enabled"] is False
        assert "(Copy)" in data["name"]

    def test_delete_report(self, client, db):
        created = self._create(client, db, _n=7)
        resp = client.delete(f"/api/admin/analytics/reports/{created['id']}")
        assert resp.status_code == 200
        assert client.get(f"/api/admin/analytics/reports/{created['id']}").status_code == 404


class TestPreviewAndRunNow:

    def _create(self, client, db, n=1, **overrides):
        sender = create_test_user(db, email=f"pv_sender_{n}@t.com", role="SDR", google_id=f"pv-{n}")
        create_user_mailbox(db, sender.id, nylas_grant_id=f"grant-pv-{n}")
        body = _valid_report_body(sender_user_id=sender.id, **overrides)
        resp = client.post("/api/admin/analytics/reports", json=body)
        return resp.json(), sender

    def test_preview_does_not_create_execution(self, client, db):
        created, _ = self._create(client, db, n=1)
        resp = client.get(f"/api/admin/analytics/reports/{created['id']}/preview")
        assert resp.status_code == 200
        data = resp.json()
        assert "html" in data
        assert data["report_name"] == "Weekly SDR Report"
        assert db.query(models.ReportExecution).filter(models.ReportExecution.report_id == created["id"]).count() == 0

    @patch("report_service.send_report_email", return_value=True)
    def test_run_now_creates_execution_and_marks_sent(self, mock_send, client, db):
        created, _ = self._create(client, db, n=2)
        resp = client.post(f"/api/admin/analytics/reports/{created['id']}/run-now")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "sent"
        assert data["triggered_by"] == "manual"
        assert db.query(models.ReportExecution).filter(models.ReportExecution.report_id == created["id"]).count() == 1

    def test_run_now_404_for_unknown_report(self, client, db):
        resp = client.post("/api/admin/analytics/reports/no-such-id/run-now")
        assert resp.status_code == 404


class TestReportExecutionLogs:

    @patch("report_service.send_report_email", return_value=True)
    def test_logs_list_and_filter_by_status(self, mock_send, client, db):
        sender = create_test_user(db, email="log_sender@t.com", role="SDR", google_id="log-1")
        create_user_mailbox(db, sender.id)
        body = _valid_report_body(sender_user_id=sender.id, name="Log Test Report")
        created = client.post("/api/admin/analytics/reports", json=body).json()
        client.post(f"/api/admin/analytics/reports/{created['id']}/run-now")

        resp = client.get("/api/admin/analytics/report-executions")
        assert resp.status_code == 200
        body = resp.json()
        rows = body["items"]
        assert body["total"] == 1
        assert len(rows) == 1
        assert rows[0]["report_name"] == "Log Test Report"
        assert rows[0]["status"] == "sent"

        resp2 = client.get("/api/admin/analytics/report-executions?status=failed")
        assert resp2.json()["items"] == []
        assert resp2.json()["total"] == 0

    @patch("report_service.send_report_email", return_value=True)
    def test_sort_by_report_name(self, mock_send, client, db):
        sender = create_test_user(db, email="log_sender2@t.com", role="SDR", google_id="log-2")
        create_user_mailbox(db, sender.id)
        for name in ["Zeta Report", "Alpha Report"]:
            body = _valid_report_body(sender_user_id=sender.id, name=name)
            created = client.post("/api/admin/analytics/reports", json=body).json()
            client.post(f"/api/admin/analytics/reports/{created['id']}/run-now")

        asc = [r["report_name"] for r in client.get("/api/admin/analytics/report-executions?sort_by=report_name").json()["items"]]
        assert asc == ["Alpha Report", "Zeta Report"]
