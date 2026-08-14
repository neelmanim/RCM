# Lead Attachments — Backlog

**Feature Status**: Deferred — backlog  
**Original Conversation**: f7edf56b-db9b-4289-b1c0-9cad30ceaf94  
**Deferred Date**: 2026-04-09

---

## Overview

Allow SDRs to upload files to a lead's detail page for future reference (call scripts, company research documents, screenshots, proposals, etc.). All users with lead-view access can see and download attachments.

## What Was Built (Backend — Ready, Unused)

The full backend is already implemented and can be activated without any further backend work:

| File | Status |
|------|--------|
| `backend/models.py` | ✅ `LeadAttachment` model added (V22) |
| `backend/migrations.py` | ✅ `lead_attachments` table + `CREATE TABLE` migration added |
| `backend/routes/attachment_routes.py` | ✅ Fully implemented — upload, list, download, delete |
| `backend/main.py` | ✅ `attachment_router` registered |

### API Endpoints (live but unused)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/leads/{lead_id}/attachments` | List all attachments for a lead |
| `POST` | `/api/leads/{lead_id}/attachments` | Upload a file (multipart, max 25 MB) |
| `GET` | `/api/leads/{lead_id}/attachments/{id}/download` | Stream download |
| `DELETE` | `/api/leads/{lead_id}/attachments/{id}` | Delete attachment |

### Allowed File Types
PDF, DOCX, XLSX, CSV, TXT, RTF, PPTX, PNG, JPG, GIF, WEBP, ZIP, MP4, MOV

### Storage
Files stored at **`backend/uploads/lead_attachments/{lead_id}/{uuid}.ext`**  
Original filenames + metadata tracked in the `lead_attachments` DB table.

> **Note**: If cloud storage (S3, GCS) is preferred, only `attachment_routes.py` needs updating.

---

## What Remains (Frontend Only)

- [ ] `frontend/js/api.js` — `fetchLeadAttachments`, `uploadLeadAttachment`, `deleteLeadAttachment` 
- [ ] `frontend/js/views/lead_attachments_tab.js` — Tab rendering (drag-and-drop zone + file list)
- [ ] `frontend/js/views/lead_detail.js` — Add "Attachments" tab to the tab bar
- [ ] `frontend/css/style.css` — Attachment tab styles

---

## UX Design (Approved)

From the approved UI mockup (`ui_mockups.md`):

- **Tab location**: New "📎 Attachments" tab in Lead Detail, between "Calls" and "Research"
- **Upload zone**: Drag-and-drop area with a "Browse files" fallback button
- **File list**: Card-style rows showing file icon, name, size, uploader name + timestamp
- **Actions**: Download (↓) and Delete (🗑) per file
- **Access control**: All users who can view the lead can upload/download/delete

---

## Re-activation Checklist

When ready to build:

1. Confirm storage preference (local disk or cloud)
2. Build `lead_attachments_tab.js` (≈ 150 lines)
3. Add "📎 Attachments" tab to `lead_detail.js`
4. Add 3 API functions to `api.js`
5. Add CSS to `style.css`
6. Write Playwright tests

**Estimated effort**: ~2–3 hours of frontend work.
