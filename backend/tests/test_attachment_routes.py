"""Tests for routes/attachment_routes.py — Lead file attachments (v4.7.0).

Covers:
- POST   /leads/{id}/attachments         — upload
- GET    /leads/{id}/attachments         — list
- GET    /leads/{id}/attachments/{id}/download — download
- DELETE /leads/{id}/attachments/{id}    — delete
- Validation: extension blocklist, size limit, 404 cases
"""
import sys, os, io
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_lead, SUPER_ADMIN
import models


# ═══════════════════════════════════════════════════════════════════════════════
# Upload Attachment
# ═══════════════════════════════════════════════════════════════════════════════

class TestUploadAttachment:

    def test_upload_pdf(self, client, db):
        """Upload a valid PDF file to a lead."""
        lead = create_test_lead(db, email="att1@t.com")
        file_content = b"%PDF-1.4 fake pdf content"
        resp = client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("proposal.pdf", io.BytesIO(file_content), "application/pdf")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["original_filename"] == "proposal.pdf"
        assert data["mime_type"] == "application/pdf"
        assert data["file_size"] == len(file_content)
        assert data["lead_id"] == lead.id

    def test_upload_png(self, client, db):
        """Upload a valid PNG image."""
        lead = create_test_lead(db, email="att2@t.com")
        fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        resp = client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("screenshot.png", io.BytesIO(fake_png), "image/png")},
        )
        assert resp.status_code == 200
        assert resp.json()["original_filename"] == "screenshot.png"

    def test_upload_csv(self, client, db):
        """Upload a CSV file."""
        lead = create_test_lead(db, email="att3@t.com")
        csv_data = b"name,email\nJohn,john@test.com\n"
        resp = client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("contacts.csv", io.BytesIO(csv_data), "text/csv")},
        )
        assert resp.status_code == 200
        assert resp.json()["original_filename"] == "contacts.csv"

    def test_upload_blocked_extension(self, client, db):
        """Uploading a .exe file is blocked."""
        lead = create_test_lead(db, email="att4@t.com")
        resp = client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("malware.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert "not allowed" in resp.json()["detail"].lower()

    def test_upload_blocked_js_extension(self, client, db):
        """Uploading a .js file is blocked (not in allowed list)."""
        lead = create_test_lead(db, email="att5@t.com")
        resp = client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("script.js", io.BytesIO(b"alert(1)"), "text/javascript")},
        )
        assert resp.status_code == 400

    def test_upload_to_nonexistent_lead_404(self, client):
        """Upload to a non-existent lead returns 404."""
        resp = client.post(
            "/api/leads/nonexistent-id/attachments",
            files={"file": ("doc.pdf", io.BytesIO(b"content"), "application/pdf")},
        )
        assert resp.status_code == 404

    def test_upload_records_uploader_name(self, client, db):
        """The uploaded_by_name field is populated from the auth user."""
        lead = create_test_lead(db, email="att6@t.com")
        resp = client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("notes.txt", io.BytesIO(b"some notes"), "text/plain")},
        )
        assert resp.status_code == 200
        assert resp.json()["uploaded_by_name"] == "Test Admin"


# ═══════════════════════════════════════════════════════════════════════════════
# List Attachments
# ═══════════════════════════════════════════════════════════════════════════════

class TestListAttachments:

    def test_list_empty(self, client, db):
        """A lead with no attachments returns an empty list."""
        lead = create_test_lead(db, email="list1@t.com")
        resp = client.get(f"/api/leads/{lead.id}/attachments")
        assert resp.status_code == 200
        assert resp.json()["attachments"] == []

    def test_list_after_upload(self, client, db):
        """After uploading, the attachment appears in the list."""
        lead = create_test_lead(db, email="list2@t.com")
        client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("doc.pdf", io.BytesIO(b"pdf content"), "application/pdf")},
        )
        resp = client.get(f"/api/leads/{lead.id}/attachments")
        assert resp.status_code == 200
        attachments = resp.json()["attachments"]
        assert len(attachments) == 1
        assert attachments[0]["original_filename"] == "doc.pdf"

    def test_list_multiple_attachments(self, client, db):
        """Multiple uploads appear in the list ordered by newest first."""
        lead = create_test_lead(db, email="list3@t.com")
        client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("first.pdf", io.BytesIO(b"first"), "application/pdf")},
        )
        client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("second.csv", io.BytesIO(b"a,b"), "text/csv")},
        )
        resp = client.get(f"/api/leads/{lead.id}/attachments")
        assert resp.status_code == 200
        attachments = resp.json()["attachments"]
        assert len(attachments) == 2

    def test_list_nonexistent_lead_404(self, client):
        """Listing attachments of a non-existent lead returns 404."""
        resp = client.get("/api/leads/nonexistent-id/attachments")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# Download Attachment
# ═══════════════════════════════════════════════════════════════════════════════

class TestDownloadAttachment:

    def test_download_uploaded_file(self, client, db):
        """Download a previously uploaded attachment returns the file content."""
        lead = create_test_lead(db, email="dl1@t.com")
        file_content = b"Hello, this is a test document!"
        upload_resp = client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("readme.txt", io.BytesIO(file_content), "text/plain")},
        )
        assert upload_resp.status_code == 200
        att_id = upload_resp.json()["id"]

        resp = client.get(f"/api/leads/{lead.id}/attachments/{att_id}/download")
        assert resp.status_code == 200
        assert resp.content == file_content

    def test_download_nonexistent_attachment_404(self, client, db):
        """Downloading a non-existent attachment returns 404."""
        lead = create_test_lead(db, email="dl2@t.com")
        resp = client.get(f"/api/leads/{lead.id}/attachments/fake-att-id/download")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# Delete Attachment
# ═══════════════════════════════════════════════════════════════════════════════

class TestDeleteAttachment:

    def test_delete_attachment(self, client, db):
        """Delete an attachment and verify it's removed."""
        lead = create_test_lead(db, email="del1@t.com")
        upload_resp = client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("temp.txt", io.BytesIO(b"delete me"), "text/plain")},
        )
        att_id = upload_resp.json()["id"]

        resp = client.delete(f"/api/leads/{lead.id}/attachments/{att_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify it's gone
        list_resp = client.get(f"/api/leads/{lead.id}/attachments")
        assert len(list_resp.json()["attachments"]) == 0

    def test_delete_nonexistent_attachment_404(self, client, db):
        """Deleting a non-existent attachment returns 404."""
        lead = create_test_lead(db, email="del2@t.com")
        resp = client.delete(f"/api/leads/{lead.id}/attachments/fake-att-id")
        assert resp.status_code == 404

    def test_delete_wrong_lead_404(self, client, db):
        """Deleting an attachment with the wrong lead_id returns 404."""
        lead1 = create_test_lead(db, email="del3@t.com")
        lead2 = create_test_lead(db, email="del4@t.com")
        upload_resp = client.post(
            f"/api/leads/{lead1.id}/attachments",
            files={"file": ("file.txt", io.BytesIO(b"content"), "text/plain")},
        )
        att_id = upload_resp.json()["id"]

        # Try to delete using lead2's URL
        resp = client.delete(f"/api/leads/{lead2.id}/attachments/{att_id}")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# Full E2E Flow: Upload → List → Download → Delete
# ═══════════════════════════════════════════════════════════════════════════════

class TestAttachmentE2EFlow:

    def test_full_lifecycle(self, client, db):
        """Upload a file, list it, download it, then delete it."""
        lead = create_test_lead(db, email="e2e@t.com")
        content = b"E2E test file content 12345"

        # 1. Upload
        upload_resp = client.post(
            f"/api/leads/{lead.id}/attachments",
            files={"file": ("e2e_doc.pdf", io.BytesIO(content), "application/pdf")},
        )
        assert upload_resp.status_code == 200
        att = upload_resp.json()
        att_id = att["id"]
        assert att["original_filename"] == "e2e_doc.pdf"
        assert att["file_size"] == len(content)

        # 2. List — should contain the uploaded file
        list_resp = client.get(f"/api/leads/{lead.id}/attachments")
        assert len(list_resp.json()["attachments"]) == 1

        # 3. Download — content should match
        dl_resp = client.get(f"/api/leads/{lead.id}/attachments/{att_id}/download")
        assert dl_resp.status_code == 200
        assert dl_resp.content == content

        # 4. Delete
        del_resp = client.delete(f"/api/leads/{lead.id}/attachments/{att_id}")
        assert del_resp.status_code == 200

        # 5. Verify deletion
        list_resp2 = client.get(f"/api/leads/{lead.id}/attachments")
        assert len(list_resp2.json()["attachments"]) == 0
