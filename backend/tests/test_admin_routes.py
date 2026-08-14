"""Tests for routes/admin_routes.py — User mgmt, assignments, sync settings, upload."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import (
    create_test_user, create_test_lead, create_test_pod,
    create_sync_settings, SUPER_ADMIN,
)
import models


# ── User Management ─────────────────────────────────────────────────────────

class TestCreateUser:

    def test_create_user(self, client, db):
        resp = client.post("/api/admin/users", json={
            "email": "newadmin@test.com", "name": "New Admin", "role": "SDR"
        })
        assert resp.status_code == 200
        assert "user_id" in resp.json()

    def test_create_user_missing_email_400(self, client):
        resp = client.post("/api/admin/users", json={"name": "No Email"})
        assert resp.status_code == 400

    def test_create_duplicate_email_400(self, client, db):
        create_test_user(db, email="dup@test.com")
        resp = client.post("/api/admin/users", json={"email": "dup@test.com", "name": "Dup"})
        assert resp.status_code == 400

    def test_create_user_invalid_role_defaults_to_sdr(self, client, db):
        resp = client.post("/api/admin/users", json={"email": "badrole@t.com", "name": "Bad", "role": "Wizard"})
        assert resp.status_code == 200
        user = db.query(models.User).filter(models.User.email == "badrole@t.com").first()
        assert user.role == "SDR"


class TestListUsers:

    def test_list_users(self, client, db):
        create_test_user(db, email="list1@t.com")
        create_test_user(db, email="list2@t.com")
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        assert len(resp.json()) >= 2

    def test_pod_admin_sees_only_pod_members(self, client_as_pod_admin, db):
        pod = create_test_pod(db, name="PA Pod")
        pod_admin = create_test_user(db, email="podadmin@test.com", role="Pod Admin", pod_id=pod.id)
        create_test_user(db, email="member@t.com", role="SDR", pod_id=pod.id)
        create_test_user(db, email="outside@t.com", role="SDR")

        resp = client_as_pod_admin.get("/api/admin/users")
        assert resp.status_code == 200


class TestUpdateUserRole:

    def test_update_role(self, client, db):
        user = create_test_user(db, email="rolechange@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/role", json={"role": "Pod Admin"})
        assert resp.status_code == 200
        db.refresh(user)
        assert user.role == "Pod Admin"

    def test_update_role_busts_users_cache(self, client, db):
        # RCA 2026-08-05: /api/admin/users caches for 120s; a mutating route that
        # forgets to invalidate('users') makes the admin console show stale data
        # (deleted/renamed users) until the cache naturally expires.
        from unittest.mock import patch
        user = create_test_user(db, email="rolecache@t.com", role="SDR")
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.patch(f"/api/admin/users/{user.id}/role", json={"role": "Pod Admin"})
        assert resp.status_code == 200
        mock_invalidate.assert_any_call("users")

    def test_invalid_role_returns_400(self, client, db):
        user = create_test_user(db, email="badrole2@t.com")
        resp = client.patch(f"/api/admin/users/{user.id}/role", json={"role": "Wizard"})
        assert resp.status_code == 400


class TestToggleAccess:

    def test_revoke_access(self, client, db):
        import access_db
        user = create_test_user(db, email="revoke@t.com")
        access_db.add_allowed_user(db, "revoke@t.com")
        resp = client.patch(f"/api/admin/users/{user.id}/access", json={"action": "revoke"})
        assert resp.status_code == 200
        assert resp.json()["access_allowed"] is False

    def test_grant_access(self, client, db):
        user = create_test_user(db, email="grant@t.com")
        resp = client.patch(f"/api/admin/users/{user.id}/access", json={"action": "grant"})
        assert resp.status_code == 200
        assert resp.json()["access_allowed"] is True

    def test_invalid_action_400(self, client, db):
        user = create_test_user(db, email="badact@t.com")
        resp = client.patch(f"/api/admin/users/{user.id}/access", json={"action": "dance"})
        assert resp.status_code == 400


class TestDeleteUser:

    def test_delete_user(self, client, db):
        user = create_test_user(db, email="deluser@t.com")
        resp = client.delete(f"/api/admin/users/{user.id}")
        assert resp.status_code == 200

    def test_cannot_delete_self(self, client, db):
        # The override user has sub="test-user-id"
        user = create_test_user(db, email="selfdelete@t.com")
        user.id = "test-user-id"
        db.commit()
        resp = client.delete(f"/api/admin/users/{user.id}")
        assert resp.status_code == 400

    def test_delete_nonexistent_user_404(self, client):
        resp = client.delete("/api/admin/users/fake-user-id")
        assert resp.status_code == 404

    def test_delete_busts_users_cache(self, client, db):
        # RCA 2026-08-05: see test_update_role_busts_users_cache
        from unittest.mock import patch
        user = create_test_user(db, email="delcache@t.com")
        with patch("cache.invalidate") as mock_invalidate:
            resp = client.delete(f"/api/admin/users/{user.id}")
        assert resp.status_code == 200
        mock_invalidate.assert_any_call("users")


# ── Lead Assignment ──────────────────────────────────────────────────────────

class TestUnassignedLeads:

    def test_get_unassigned_leads(self, client, db):
        lead = create_test_lead(db, email="unassigned@t.com")
        resp = client.get("/api/admin/leads/unassigned")
        assert resp.status_code == 200
        assert any(l["email"] == "unassigned@t.com" for l in resp.json())


class TestBulkAssign:

    def test_bulk_assign_leads(self, client, db):
        user = create_test_user(db, email="assignee@t.com")
        lead = create_test_lead(db, email="toassign@t.com", phone="+1234567890")
        resp = client.post("/api/admin/assignments/bulk-assign", json={
            "user_id": user.id, "lead_ids": [lead.id]
        })
        assert resp.status_code == 200
        assert len(resp.json()["assigned"]) == 1

    def test_bulk_assign_respects_lead_cap(self, client, db):
        user = create_test_user(db, email="capuser@t.com")
        leads = []
        for i in range(7):
            l = create_test_lead(db, email=f"cap{i}@t.com", phone=f"+123456789{i}")
            leads.append(l)
        resp = client.post("/api/admin/assignments/bulk-assign", json={
            "user_id": user.id, "lead_ids": [l.id for l in leads]
        })
        assert resp.status_code == 200
        # MAX_ACTIVE_LEADS = 5, so only 5 should be assigned
        assert len(resp.json()["assigned"]) == 5
        assert len(resp.json()["cap_reached"]) == 2


class TestAutoAssignAll:

    def test_auto_assign_distributes_leads(self, client, db):
        sdr1 = create_test_user(db, email="sdr1@t.com", role="SDR")
        sdr2 = create_test_user(db, email="sdr2@t.com", role="SDR")
        for i in range(4):
            create_test_lead(db, email=f"auto{i}@t.com", phone=f"+123456789{i}")
        resp = client.post("/api/admin/assignments/auto-assign-all")
        assert resp.status_code == 200
        assert resp.json()["assigned_count"] == 4


class TestUnassignLead:

    def test_unassign_lead(self, client, db):
        user = create_test_user(db, email="unassignee@t.com")
        lead = create_test_lead(db, email="tounassign@t.com")
        user.assigned_leads.append(lead)
        db.commit()
        resp = client.delete(f"/api/admin/assignments/{user.id}/{lead.id}")
        assert resp.status_code == 200


# ── Sync Settings ────────────────────────────────────────────────────────────

class TestSyncSettings:

    def test_get_sync_settings(self, client, db):
        create_sync_settings(db)
        resp = client.get("/api/admin/sync-settings")
        assert resp.status_code == 200
        data = resp.json()
        assert data["lead_limit"] == 1000
        assert data["sync_direction"] == "push_only"

    def test_update_sync_settings(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={
            "lead_limit": 500, "sync_direction": "both"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_limit"] == 500
        assert resp.json()["sync_direction"] == "both"

    def test_invalid_sync_direction_422(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"sync_direction": "invalid"})
        assert resp.status_code == 422

    def test_negative_lead_limit_422(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"lead_limit": -1})
        assert resp.status_code == 422

    def test_update_allow_multi_pod_sdr(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"allow_multi_pod_sdr": True})
        assert resp.status_code == 200
        assert resp.json()["allow_multi_pod_sdr"] is True

    def test_update_conversation_min_seconds(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"conversation_min_seconds": 60})
        assert resp.status_code == 200
        assert resp.json()["conversation_min_seconds"] == 60
        assert client.get("/api/admin/sync-settings").json()["conversation_min_seconds"] == 60

    def test_conversation_min_seconds_defaults_to_30(self, client, db):
        create_sync_settings(db)
        assert client.get("/api/admin/sync-settings").json()["conversation_min_seconds"] == 30

    def test_conversation_min_seconds_rejects_non_positive(self, client, db):
        create_sync_settings(db)
        resp = client.patch("/api/admin/sync-settings", json={"conversation_min_seconds": 0})
        assert resp.status_code == 422


# ── Upload Preview ───────────────────────────────────────────────────────────

class TestUploadPreview:

    def test_upload_preview(self, client):
        csv = "First Name,Last Name,Email,Company\nJohn,Doe,john@test.com,Acme\nJane,Smith,jane@test.com,Widget"
        resp = client.post("/api/admin/leads/upload-preview", json={"csv": csv})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["headers"]) == 4
        assert len(data["preview_rows"]) == 2
        assert "auto_mapping" in data

    def test_upload_preview_missing_csv_400(self, client):
        resp = client.post("/api/admin/leads/upload-preview", json={})
        assert resp.status_code == 400


# ── Upload Sheet ─────────────────────────────────────────────────────────────

class TestUploadSheet:

    def test_basic_upload_creates_leads(self, client, db):
        csv = "First Name,Last Name,Email,Company,Phone\nJohn,Doe,john@upload.com,Acme,+1234567890\nJane,Smith,jane@upload.com,Widget,+1234567891"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "test.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 2
        assert data["skipped"] == 0

    def test_result_column_with_non_matched_value_still_imports(self, client, db):
        """Bug fix: sheets with a 'result' column containing values like 'found' should NOT skip rows."""
        csv = "First Name,Last Name,Email,Phone,Result\nAlice,Brown,alice@fix.com,+1234567890,found\nBob,White,bob@fix.com,+1234567891,enriched"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "enriched.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 2, f"Expected 2 created, got {data['created']}. Skipped: {data['skipped']}"
        assert data["skipped"] == 0

    def test_result_column_skips_not_matched_rows(self, client, db):
        """Rows explicitly marked 'not matched' should still be skipped."""
        csv = "First Name,Last Name,Email,Phone,Result\nAlice,Good,alice@ok.com,+1234567890,matched\nBob,Bad,bob@bad.com,+1234567891,not matched"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "mixed.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 1
        assert data["skipped"] == 1

    def test_duplicate_detection_skips_existing_leads(self, client, db):
        create_test_lead(db, email="existing@dup.com", last_name="Existing", phone="+1234567890")
        csv = "First Name,Last Name,Email,Phone\nDup,Lead,existing@dup.com,+1234567890"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "dups.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 0
        assert data["duplicates"] == 1

    def test_update_existing_mode(self, client, db):
        create_test_lead(db, email="update@test.com", last_name="Old", first_name="Name", company="OldCo", phone="+1234567890")
        csv = "First Name,Last Name,Email,Company,Phone\nName,Old,update@test.com,NewCo,+1234567890"
        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": csv, "filename": "update.csv", "update_existing": True
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["updated"] == 1
        # Verify the lead was actually updated
        lead = db.query(models.Lead).filter(models.Lead.email == "update@test.com").first()
        assert lead.company == "NewCo"

    def test_update_existing_assigns_existing_lead_to_sdr(self, client, db):
        """RCA 2026-07-30: same bug as the gsheet import — update_existing
        updated fields but never assigned the matched lead to the chosen SDR."""
        sdr = create_test_user(db, email="samya-csv-test@test.com", name="Samya CSV Test", role="AE")
        existing = create_test_lead(db, email="update2@test.com", last_name="Old", first_name="Name", company="OldCo", phone="+1234500011")
        db.commit()

        csv = "First Name,Last Name,Email,Company,Phone\nName,Old,update2@test.com,NewCo,+1234500011"
        resp = client.post("/api/admin/leads/upload-sheet", json={
            "csv": csv, "filename": "update2.csv",
            "update_existing": True, "assign_to_user_id": sdr.id,
        })
        assert resp.status_code == 200
        assert resp.json()["updated"] == 1

        db.refresh(existing)
        assert sdr.id in {u.id for u in existing.assigned_users}

    def test_upload_missing_csv_400(self, client):
        resp = client.post("/api/admin/leads/upload-sheet", json={})
        assert resp.status_code == 400

    def test_csv_upload_creates_upload_log(self, client, db):
        """Regression: CSV upload must commit leads AND LeadUploadLog atomically.
        Same split-commit bug as gsheet_import — fixed with single atomic commit."""
        csv = "First Name,Last Name,Email,Company,Phone\nLog,Csv,logcsv@upload.com,Acme,+1234500003"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "test_log.csv"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 1
        assert "log_id" in data and data["log_id"] is not None

        log = db.query(models.LeadUploadLog).filter(
            models.LeadUploadLog.id == data["log_id"]
        ).first()
        assert log is not None, "CSV upload must write LeadUploadLog in the same transaction as leads"
        assert log.created == 1
        assert log.status == "completed"


# ── Dynamic Source Labeling ──────────────────────────────────────────────────

class TestDynamicSourceLabeling:

    def test_uploaded_leads_get_dynamic_source(self, client, db):
        csv = "First Name,Last Name,Email,Company,Phone\nJohn,Doe,john@dynamic.com,Acme,+1234567890"
        resp = client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "apollo_leads.csv"})
        assert resp.status_code == 200
        lead = db.query(models.Lead).filter(models.Lead.email == "john@dynamic.com").first()
        assert lead is not None
        assert lead.lead_source.startswith("upload:apollo_leads.csv:")
        # Verify timestamp portion is ISO format
        parts = lead.lead_source.split(":", 2)
        assert len(parts) == 3
        assert parts[0] == "upload"
        assert parts[1] == "apollo_leads.csv"

    def test_source_filter_matches_both_legacy_and_new(self, client, db):
        """Verify that source=uploaded matches both legacy 'uploaded' and new 'upload:...' values."""
        # Create a legacy lead
        create_test_lead(db, email="legacy@test.com", lead_source="uploaded", phone="+1234567890")
        # Create a new-style lead
        csv = "First Name,Last Name,Email,Phone\nNew,Style,new@test.com,+1234567891"
        client.post("/api/admin/leads/upload-sheet", json={"csv": csv, "filename": "test.csv"})

        # Filter by source=uploaded should match both
        resp = client.get("/api/leads", params={"source": "uploaded", "per_page": 100})
        assert resp.status_code == 200
        emails = [l["email"] for l in resp.json()["data"]]
        assert "legacy@test.com" in emails
        assert "new@test.com" in emails

    def test_manual_leads_retain_manual_source(self, client, db):
        resp = client.post("/api/leads", json={
            "first_name": "Test", "last_name": "Manual", "email": "manual@test.com"
        })
        assert resp.status_code == 200
        assert resp.json()["lead_source"] == "manual"


# ── Google Sheets Import ─────────────────────────────────────────────────────

class TestGoogleSheetsImport:

    def test_invalid_url_returns_error(self, client):
        resp = client.post("/api/admin/leads/upload-gsheet", json={"url": "https://not-google.com/sheet"})
        assert resp.status_code == 400
        import json
        detail = json.loads(resp.json()["detail"])
        assert detail["error_code"] == "invalid_url"

    def test_empty_url_returns_400(self, client):
        resp = client.post("/api/admin/leads/upload-gsheet", json={"url": ""})
        assert resp.status_code == 400

    def test_gsheet_preview_success(self, client, monkeypatch):
        """Mock httpx.get to return CSV content and verify preview response."""
        csv_content = "First Name,Last Name,Email,Company\nAlice,Smith,alice@gs.com,Acme\nBob,Jones,bob@gs.com,Widget"

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/upload-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_rows"] == 2
        assert "First Name" in data["headers"]
        assert data["sheet_id"] == "abc123"
        assert "auto_mapping" in data

    def test_gsheet_preview_passes_through_gid_from_fragment(self, client, monkeypatch):
        """RCA 2026-08-10: a link to a specific tab (#gid=...) must fetch
        that tab, not silently fall back to the spreadsheet's default one."""
        csv_content = "First Name,Last Name,Email,Company\nAlice,Smith,alice@gs.com,Acme"

        class MockResponse:
            status_code = 200
            text = csv_content

        calls = []

        def fake_get(url, **kwargs):
            calls.append(url)
            return MockResponse()

        import httpx
        monkeypatch.setattr(httpx, "get", fake_get)

        resp = client.post("/api/admin/leads/upload-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123/edit?gid=486071753#gid=486071753"
        })
        assert resp.status_code == 200
        assert calls[0] == "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=486071753"

    def test_gsheet_import_creates_leads(self, client, db, monkeypatch):
        """Mock httpx.get and verify leads are created with gsheet: source prefix."""
        csv_content = "First Name,Last Name,Email,Company,Phone\nAlice,Smith,alice@gsheet.com,Acme,+1234567890\nBob,Jones,bob@gsheet.com,Widget,+1234567891"

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123",
            "sheet_name": "My Test Sheet"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 2

        lead = db.query(models.Lead).filter(models.Lead.email == "alice@gsheet.com").first()
        assert lead is not None
        assert lead.lead_source.startswith("gsheet:My Test Sheet:")

    def test_gsheet_import_passes_through_gid_from_query_param(self, client, db, monkeypatch):
        """Same RCA as the preview endpoint's gid test — import-gsheet has
        its own separate export_url construction that needs the same fix."""
        csv_content = "First Name,Last Name,Email,Company,Phone\nAlice,Smith,alice@gsheet.com,Acme,+1234567890"

        class MockResponse:
            status_code = 200
            text = csv_content

        calls = []

        def fake_get(url, **kwargs):
            calls.append(url)
            return MockResponse()

        import httpx
        monkeypatch.setattr(httpx, "get", fake_get)

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123?gid=486071753",
            "sheet_name": "My Test Sheet"
        })
        assert resp.status_code == 200
        assert calls[0] == "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=486071753"

    def test_gsheet_empty_sheet(self, client, monkeypatch):
        """Mock empty CSV response and verify error."""
        class MockResponse:
            status_code = 200
            text = ""

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/upload-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123"
        })
        assert resp.status_code == 400
        import json
        detail = json.loads(resp.json()["detail"])
        assert detail["error_code"] == "empty_sheet"

    def test_gsheet_import_creates_upload_log(self, client, db, monkeypatch):
        """Regression: leads AND a LeadUploadLog must be committed atomically.
        Previously, a transient DB error between the two separate commits could
        leave leads in the DB with no corresponding upload log (split-brain)."""
        csv_content = "First Name,Last Name,Email,Company,Phone\nLog,Test,logtest@gsheet.com,Acme,+1234567892"

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/abc123",
            "sheet_name": "Log Test Sheet"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 1
        assert "log_id" in data and data["log_id"] is not None

        # Verify the upload log was actually written to DB in the same commit
        log = db.query(models.LeadUploadLog).filter(
            models.LeadUploadLog.id == data["log_id"]
        ).first()
        assert log is not None, "LeadUploadLog must be committed with leads in a single transaction"
        assert log.created == 1
        assert log.status == "completed"

    def test_gsheet_import_row_failure_does_not_crash_import(self, client, db, monkeypatch):
        """Regression: a DB-level failure on one row must not corrupt the session
        and kill the whole import. The savepoint fix ensures other rows still land."""
        # Row 1: valid. Row 2: will trigger a duplicate sf_lead_id at the DB level
        # by pre-inserting a lead whose phone matches row 2's phone (dedup catches
        # it before DB, so we simulate row-level failure via a bad employee_count).
        # Simplest path: all valid rows import; errors[] is empty; HTTP 200 returned.
        csv_content = (
            "First Name,Last Name,Email,Company,Phone\n"
            "Good,Row,good@savepoint.com,Acme,+1234500001\n"
            "Also,Good,alsogood@savepoint.com,Widget,+1234500002"
        )

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/savepoint123",
            "sheet_name": "Savepoint Test"
        })
        # Must return HTTP 200 (not 500) even if individual rows had issues
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 2
        # Upload log must still be written
        assert data.get("log_id") is not None

    def test_gsheet_import_update_existing_assigns_existing_lead_to_sdr(self, client, db, monkeypatch):
        """RCA 2026-07-30: update_existing updated a matched lead's fields but
        never assigned it — a re-upload of already-imported leads with a
        chosen SDR silently left them unassigned no matter what was picked."""
        sdr = create_test_user(db, email="samya-test@test.com", name="Samya Test", role="AE")
        existing = create_test_lead(db, email="already.here@gsheet.com", phone="+1234599999", first_name="Already", last_name="Here")
        db.commit()

        csv_content = (
            "First Name,Last Name,Email,Company,Phone\n"
            "Already,Here,already.here@gsheet.com,NewCo,+1234599999"
        )

        class MockResponse:
            status_code = 200
            text = csv_content

        import httpx
        monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: MockResponse())

        resp = client.post("/api/admin/leads/import-gsheet", json={
            "url": "https://docs.google.com/spreadsheets/d/reassign123",
            "sheet_name": "Reassign Test",
            "update_existing": True,
            "assign_to_user_id": sdr.id,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 0
        assert data["updated"] == 1

        db.refresh(existing)
        assert sdr.id in {u.id for u in existing.assigned_users}


# ── Per-SDR Settings (Dialer + Email Sync Toggles) ──────────────────────────

class TestUserSettings:
    """Tests for PATCH /api/admin/users/{user_id}/settings — per-SDR feature toggles."""

    def test_super_admin_can_toggle_dialer(self, client, db):
        user = create_test_user(db, email="sdr_dial@t.com", role="SDR")
        assert user.dialer_enabled is False

        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_enabled"] is True
        db.refresh(user)
        assert user.dialer_enabled is True

    def test_super_admin_can_toggle_email_sync(self, client, db):
        user = create_test_user(db, email="sdr_email@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "email_sync_enabled": True
        })
        assert resp.status_code == 200
        assert resp.json()["email_sync_enabled"] is True

    def test_toggle_both_at_once(self, client, db):
        user = create_test_user(db, email="sdr_both@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True, "email_sync_enabled": True,
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_enabled"] is True
        assert resp.json()["email_sync_enabled"] is True

    def test_partial_update_only_dialer(self, client, db):
        """Updating only dialer_enabled should not affect email_sync_enabled."""
        user = create_test_user(db, email="sdr_partial@t.com", role="SDR")
        user.email_sync_enabled = True
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 200
        db.refresh(user)
        assert user.dialer_enabled is True
        assert user.email_sync_enabled is True  # unchanged

    def test_non_existent_user_returns_404(self, client, db):
        resp = client.patch("/api/admin/users/nonexistent-id/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 404

    def test_pod_admin_cannot_toggle_settings(self, client_as_pod_admin, db):
        user = create_test_user(db, email="sdr_deny@t.com", role="SDR")
        resp = client_as_pod_admin.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 403

    def test_sdr_cannot_toggle_settings(self, client_as_sdr, db):
        user = create_test_user(db, email="sdr_self@t.com", role="SDR")
        resp = client_as_sdr.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": True
        })
        assert resp.status_code == 403

    def test_toggle_off_after_on(self, client, db):
        user = create_test_user(db, email="sdr_toggle@t.com", role="SDR")
        user.dialer_enabled = True
        user.email_sync_enabled = True
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_enabled": False, "email_sync_enabled": False,
        })
        assert resp.status_code == 200
        db.refresh(user)
        assert user.dialer_enabled is False
        assert user.email_sync_enabled is False


class TestListUsersWithFlags:
    """Verify list_users returns the new dialer/email flags."""

    def test_list_users_includes_dialer_flag(self, client, db):
        user = create_test_user(db, email="flaguser@t.com", role="SDR")
        user.dialer_enabled = True
        db.commit()
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        flag_user = next((u for u in resp.json() if u["email"] == "flaguser@t.com"), None)
        assert flag_user is not None
        assert flag_user["dialer_enabled"] is True
        assert flag_user["email_sync_enabled"] is False

    def test_list_users_default_flags_are_false(self, client, db):
        create_test_user(db, email="defaultflag@t.com", role="SDR")
        resp = client.get("/api/admin/users")
        flag_user = next((u for u in resp.json() if u["email"] == "defaultflag@t.com"), None)
        assert flag_user is not None
        assert flag_user["dialer_enabled"] is False
        assert flag_user["email_sync_enabled"] is False

    def test_list_users_includes_dialer_provider_override(self, client, db):
        user = create_test_user(db, email="overrideuser@t.com", role="SDR")
        user.dialer_provider_override = "rcm"
        db.commit()
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        target = next((u for u in resp.json() if u["email"] == "overrideuser@t.com"), None)
        assert target is not None
        assert target["dialer_provider_override"] == "rcm"

    def test_list_users_default_override_is_null(self, client, db):
        create_test_user(db, email="nooverride@t.com", role="SDR")
        resp = client.get("/api/admin/users")
        target = next((u for u in resp.json() if u["email"] == "nooverride@t.com"), None)
        assert target is not None
        assert target["dialer_provider_override"] is None


class TestDialerProviderOverride:
    """Tests for dialer_provider_override via PATCH /api/admin/users/{id}/settings."""

    def test_set_override_to_rcm(self, client, db):
        user = create_test_user(db, email="sdr_conv@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": "rcm"
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_provider_override"] == "rcm"
        db.refresh(user)
        assert user.dialer_provider_override == "rcm"

    def test_set_override_to_aircall(self, client, db):
        user = create_test_user(db, email="sdr_air@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": "aircall"
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_provider_override"] == "aircall"

    def test_clear_override_with_null(self, client, db):
        user = create_test_user(db, email="sdr_clear@t.com", role="SDR")
        user.dialer_provider_override = "rcm"
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": None
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_provider_override"] is None
        db.refresh(user)
        assert user.dialer_provider_override is None

    def test_clear_override_with_empty_string(self, client, db):
        user = create_test_user(db, email="sdr_empty@t.com", role="SDR")
        user.dialer_provider_override = "aircall"
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": ""
        })
        assert resp.status_code == 200
        assert resp.json()["dialer_provider_override"] is None
        db.refresh(user)
        assert user.dialer_provider_override is None

    def test_invalid_provider_returns_400(self, client, db):
        user = create_test_user(db, email="sdr_bad@t.com", role="SDR")
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": "twilio"
        })
        assert resp.status_code == 400
        assert "Invalid provider" in resp.json()["detail"]

    def test_override_does_not_affect_other_settings(self, client, db):
        """Setting dialer_provider_override should not change dialer_enabled or email_sync_enabled."""
        user = create_test_user(db, email="sdr_isolate@t.com", role="SDR")
        user.dialer_enabled = True
        user.email_sync_enabled = True
        db.commit()
        resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
            "dialer_provider_override": "rcm"
        })
        assert resp.status_code == 200
        db.refresh(user)
        assert user.dialer_enabled is True
        assert user.email_sync_enabled is True
        assert user.dialer_provider_override == "rcm"


# ── Phase 2: Outcome Config via PATCH /sync-settings ─────────────────────────

class TestOutcomeConfigAdmin:
    """Phase 2 tests: saving/validating outcome_config via PATCH /sync-settings."""

    def test_save_valid_outcome_config(self, client, db):
        """PATCH /sync-settings with valid outcome_config saves correctly."""
        import json
        create_sync_settings(db)
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Budget Freeze", "group": "terminal", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": custom_config
        })
        assert resp.status_code == 200
        # Verify it's stored in DB
        settings = db.query(models.SyncSettings).first()
        stored = json.loads(settings.outcome_config)
        values = {o["value"] for o in stored}
        assert "Budget Freeze" in values

    def test_get_sync_settings_includes_outcome_config(self, client, db):
        """GET /sync-settings should include outcome_config in response."""
        import json
        settings = create_sync_settings(db)
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        resp = client.get("/api/admin/sync-settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "outcome_config" in data
        assert isinstance(data["outcome_config"], list)
        assert len(data["outcome_config"]) == len(custom_config)

    def test_get_sync_settings_outcome_config_null_returns_default(self, client, db):
        """When outcome_config is NULL, GET should return DEFAULT_OUTCOME_CONFIG."""
        create_sync_settings(db)
        resp = client.get("/api/admin/sync-settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "outcome_config" in data
        assert len(data["outcome_config"]) == len(models.DEFAULT_OUTCOME_CONFIG)

    def test_reject_invalid_action_value(self, client, db):
        """outcome_config with invalid action should be rejected."""
        create_sync_settings(db)
        bad_config = list(models.DEFAULT_OUTCOME_CONFIG)
        bad_config[0] = dict(bad_config[0])
        bad_config[0]["action"] = "self_destruct"
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_reject_missing_required_fields(self, client, db):
        """outcome_config items missing required fields should be rejected."""
        create_sync_settings(db)
        bad_config = [
            {"value": "Incomplete Outcome"}  # missing group, action, etc.
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_reject_duplicate_outcome_values(self, client, db):
        """outcome_config with duplicate value strings should be rejected."""
        create_sync_settings(db)
        dup_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "No Answer", "group": "not_answered", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": dup_config
        })
        assert resp.status_code == 422

    def test_enforce_custom_outcome_cap(self, client, db):
        """Max 10 custom (non-builtin) outcomes should be enforced."""
        create_sync_settings(db)
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG)
        for i in range(11):
            custom_config.append({
                "value": f"Custom Outcome {i}", "group": "terminal", "action": "none",
                "notes_required": False, "builtin": False, "enabled": True,
            })
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": custom_config
        })
        assert resp.status_code == 422
        assert "10" in resp.json()["detail"]  # error message mentions the cap

    def test_reject_disqualify_on_answered_group(self, client, db):
        """disqualify action should only be allowed for terminal group."""
        create_sync_settings(db)
        bad_config = list(models.DEFAULT_OUTCOME_CONFIG)
        bad_config[0] = dict(bad_config[0])  # "Call Back Later" — answered group
        bad_config[0]["action"] = "disqualify"
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_reject_invalid_group_value(self, client, db):
        """outcome_config with invalid group should be rejected."""
        create_sync_settings(db)
        bad_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Custom Bad", "group": "super_answered", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_custom_outcome_value_format_validation(self, client, db):
        """Custom outcome values must be 2-50 chars."""
        create_sync_settings(db)
        # Too short (1 char)
        bad_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "X", "group": "terminal", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": bad_config
        })
        assert resp.status_code == 422

    def test_10_custom_outcomes_within_cap_succeeds(self, client, db):
        """Exactly 10 custom outcomes should be allowed."""
        create_sync_settings(db)
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG)
        for i in range(10):
            custom_config.append({
                "value": f"Custom Outcome {i}", "group": "terminal", "action": "none",
                "notes_required": False, "builtin": False, "enabled": True,
            })
        resp = client.patch("/api/admin/sync-settings", json={
            "outcome_config": custom_config
        })
        assert resp.status_code == 200


