"""Tests for routes/admin_assignment_routes.py's Control Center 'Export Leads' endpoint."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_user, create_test_lead, create_test_upload_log


class TestExportLeadsBySdr:

    def test_exports_only_that_sdrs_leads_as_csv(self, client, db):
        sdr_a = create_test_user(db, email="a@t.com", name="SDR A")
        sdr_b = create_test_user(db, email="b@t.com", name="SDR B")
        lead_a = create_test_lead(db, first_name="Alice", last_name="A", email="alice@t.com", company="Acme")
        lead_b = create_test_lead(db, first_name="Bob", last_name="B", email="bob@t.com", company="Beta")
        sdr_a.assigned_leads.append(lead_a)
        sdr_b.assigned_leads.append(lead_b)
        db.commit()

        resp = client.get(f"/api/admin/leads/export?assigned_to={sdr_a.id}")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        body = resp.text
        assert "Alice" in body
        assert "Bob" not in body

    def test_404_for_missing_user(self, client):
        resp = client.get("/api/admin/leads/export?assigned_to=does-not-exist")
        assert resp.status_code == 404

    def test_header_only_csv_when_sdr_has_no_leads(self, client, db):
        sdr = create_test_user(db, email="empty@t.com", name="Empty SDR")
        resp = client.get(f"/api/admin/leads/export?assigned_to={sdr.id}")
        assert resp.status_code == 200
        lines = [l for l in resp.text.strip().split("\n") if l]
        assert len(lines) == 1  # header row only
        assert "first_name" in lines[0]

    def test_400_when_no_filter_given(self, client):
        resp = client.get("/api/admin/leads/export")
        assert resp.status_code == 400

    def test_exports_by_upload_batch_alone(self, db, client):
        log_a = create_test_upload_log(db, filename="batch_a.csv")
        log_b = create_test_upload_log(db, filename="batch_b.csv")
        lead_a = create_test_lead(db, first_name="Alice", last_name="A", email="alice2@t.com")
        lead_b = create_test_lead(db, first_name="Bob", last_name="B", email="bob2@t.com")
        lead_a.upload_log_id = log_a.id
        lead_b.upload_log_id = log_b.id
        db.commit()

        resp = client.get(f"/api/admin/leads/export?upload_log_id={log_a.id}")
        assert resp.status_code == 200
        body = resp.text
        assert "Alice" in body
        assert "Bob" not in body

    def test_exports_by_date_range_alone(self, db, client):
        from datetime import datetime, timezone
        old_lead = create_test_lead(db, first_name="Old", last_name="Lead", email="old@t.com",
                                     created_at=datetime(2020, 1, 1, tzinfo=timezone.utc))
        new_lead = create_test_lead(db, first_name="New", last_name="Lead", email="new@t.com",
                                     created_at=datetime(2026, 6, 15, tzinfo=timezone.utc))

        resp = client.get("/api/admin/leads/export?date_from=2026-01-01&date_to=2026-12-31")
        assert resp.status_code == 200
        body = resp.text
        assert "New" in body
        assert "Old" not in body

    def test_combines_sdr_and_upload_batch_filters(self, db, client):
        sdr = create_test_user(db, email="combo@t.com", name="Combo SDR")
        log = create_test_upload_log(db, filename="batch.csv")
        matching = create_test_lead(db, first_name="Match", last_name="Ing", email="match@t.com")
        other_batch = create_test_lead(db, first_name="Other", last_name="Batch", email="otherbatch@t.com")
        sdr.assigned_leads.append(matching)
        sdr.assigned_leads.append(other_batch)
        matching.upload_log_id = log.id
        db.commit()

        resp = client.get(f"/api/admin/leads/export?assigned_to={sdr.id}&upload_log_id={log.id}")
        assert resp.status_code == 200
        body = resp.text
        assert "Match" in body
        assert "Other" not in body

    def test_exports_multiple_sdrs_leads_at_once(self, db, client):
        sdr_a = create_test_user(db, email="multi_a@t.com", name="Multi A")
        sdr_b = create_test_user(db, email="multi_b@t.com", name="Multi B")
        sdr_c = create_test_user(db, email="multi_c@t.com", name="Multi C")
        lead_a = create_test_lead(db, first_name="Alice", last_name="A", email="multi-alice@t.com")
        lead_b = create_test_lead(db, first_name="Bob", last_name="B", email="multi-bob@t.com")
        lead_c = create_test_lead(db, first_name="Carl", last_name="C", email="multi-carl@t.com")
        sdr_a.assigned_leads.append(lead_a)
        sdr_b.assigned_leads.append(lead_b)
        sdr_c.assigned_leads.append(lead_c)
        db.commit()

        resp = client.get(f"/api/admin/leads/export?assigned_to={sdr_a.id}&assigned_to={sdr_b.id}")
        assert resp.status_code == 200
        body = resp.text
        assert "Alice" in body
        assert "Bob" in body
        assert "Carl" not in body
        cd = resp.headers["content-disposition"]
        assert "Multi A" in cd and "Multi B" in cd
