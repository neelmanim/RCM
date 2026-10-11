# ── routes/attachment_routes.py — Lead file attachments (V22) ─────────────────
import os
import uuid
import mimetypes
import logging
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import get_current_user
from routes.lead_helpers import load_lead, child_of_lead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Attachments"])

# ── Storage config ────────────────────────────────────────────────────────────
# Files stored in backend/uploads/lead_attachments/{lead_id}/
_BACKEND_DIR = Path(__file__).parent.parent
UPLOAD_ROOT = _BACKEND_DIR / "uploads" / "lead_attachments"

ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv",
    ".txt", ".rtf", ".ppt", ".pptx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".zip", ".mp4", ".mov",
}
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB


def _ensure_dir(lead_id: str) -> Path:
    d = UPLOAD_ROOT / lead_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _attachment_to_dict(a: models.LeadAttachment) -> dict:
    return {
        "id":                a.id,
        "lead_id":           a.lead_id,
        "original_filename": a.original_filename,
        "file_size":         a.file_size,
        "mime_type":         a.mime_type,
        "uploaded_by_name":  a.uploaded_by_name or "Unknown",
        "created_at":        str(a.created_at) if a.created_at else None,
    }


# ── List attachments ──────────────────────────────────────────────────────────

@router.get("/leads/{lead_id}/attachments")
def list_attachments(
    lead_id: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all attachments for a lead, visible to all users who can see the lead."""
    load_lead(db, user, lead_id)

    attachments = (
        db.query(models.LeadAttachment)
        .filter(models.LeadAttachment.lead_id == lead_id)
        .order_by(models.LeadAttachment.created_at.desc())
        .all()
    )
    return {"attachments": [_attachment_to_dict(a) for a in attachments]}


# ── Upload attachment ─────────────────────────────────────────────────────────

@router.post("/leads/{lead_id}/attachments")
async def upload_attachment(
    lead_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a file attachment to a lead. Max 25 MB. Allowed: PDF, DOCX, XLSX, PNG, JPG, etc."""
    load_lead(db, user, lead_id, edit=True)

    # Validate extension
    original_name = file.filename or "file"
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{ext}' is not allowed. Permitted: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # Read content & check size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 25 MB limit.")

    # Determine MIME type
    # From the (allow-listed) extension, never the client's claimed Content-Type.
    mime_type = mimetypes.guess_type(original_name)[0] or "application/octet-stream"

    # Store file on disk with a UUID name to avoid collisions
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest_dir = _ensure_dir(lead_id)
    dest_path = dest_dir / stored_name
    dest_path.write_bytes(content)

    # Persist record
    attachment = models.LeadAttachment(
        lead_id=lead_id,
        user_id=user.get("sub"),
        original_filename=original_name,
        stored_filename=stored_name,
        file_size=len(content),
        mime_type=mime_type,
        uploaded_by_name=user.get("name") or user.get("email", "Unknown"),
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    logger.info(f"[Attachment] Uploaded '{original_name}' for lead {lead_id} by {user.get('email')}")
    return _attachment_to_dict(attachment)


# ── Download attachment ───────────────────────────────────────────────────────

@router.get("/leads/{lead_id}/attachments/{attachment_id}/download")
def download_attachment(
    lead_id: str,
    attachment_id: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream a file download for a lead attachment."""
    load_lead(db, user, lead_id)
    attachment = child_of_lead(
        db.query(models.LeadAttachment).filter(models.LeadAttachment.id == attachment_id).first(),
        lead_id, "Attachment")

    file_path = UPLOAD_ROOT / lead_id / attachment.stored_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
        filename=attachment.original_filename,
        media_type=attachment.mime_type or "application/octet-stream",
        # filename= already forces Content-Disposition: attachment; nosniff
        # stops a browser second-guessing the type.
        headers={"X-Content-Type-Options": "nosniff"},
    )


# ── Delete attachment ─────────────────────────────────────────────────────────

@router.delete("/leads/{lead_id}/attachments/{attachment_id}")
def delete_attachment(
    lead_id: str,
    attachment_id: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a lead attachment. Needs edit access to the lead."""
    load_lead(db, user, lead_id, edit=True)
    attachment = child_of_lead(
        db.query(models.LeadAttachment).filter(models.LeadAttachment.id == attachment_id).first(),
        lead_id, "Attachment")

    # Remove from disk (best-effort)
    file_path = UPLOAD_ROOT / lead_id / attachment.stored_filename
    try:
        if file_path.exists():
            file_path.unlink()
    except Exception as e:
        logger.warning(f"[Attachment] Could not delete file from disk: {e}")

    db.delete(attachment)
    db.commit()
    logger.info(f"[Attachment] Deleted '{attachment.original_filename}' from lead {lead_id}")
    return {"ok": True}
