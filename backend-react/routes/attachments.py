"""Lead file attachment routes — upload, download, list, delete."""
import uuid, mimetypes, logging
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from middleware import get_current_user
from models import Lead, LeadAttachment

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Attachments"])

_BACKEND_DIR = Path(__file__).parent.parent
UPLOAD_ROOT = _BACKEND_DIR / "uploads" / "lead_attachments"
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".rtf", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".mp4", ".mov"}
MAX_FILE_SIZE = 25 * 1024 * 1024


def _ensure_dir(lead_id):
    d = UPLOAD_ROOT / lead_id; d.mkdir(parents=True, exist_ok=True); return d


def _to_dict(a):
    return {"id": a.id, "lead_id": a.lead_id, "original_filename": a.original_filename, "file_size": a.file_size, "mime_type": a.mime_type, "uploaded_by_name": a.uploaded_by_name or "Unknown", "created_at": str(a.created_at) if a.created_at else None}


@router.get("/leads/{lead_id}/attachments")
def list_attachments(lead_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead: raise HTTPException(status_code=404, detail="Lead not found")
    return {"attachments": [_to_dict(a) for a in db.query(LeadAttachment).filter(LeadAttachment.lead_id == lead_id).order_by(LeadAttachment.created_at.desc()).all()]}


@router.post("/leads/{lead_id}/attachments")
async def upload_attachment(lead_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead: raise HTTPException(status_code=404, detail="Lead not found")
    name = file.filename or "file"
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type '{ext}' not allowed.")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 25 MB limit.")
    mime = file.content_type or mimetypes.guess_type(name)[0] or "application/octet-stream"
    stored = f"{uuid.uuid4().hex}{ext}"
    (_ensure_dir(lead_id) / stored).write_bytes(content)
    att = LeadAttachment(lead_id=lead_id, user_id=user.get("sub"), original_filename=name, stored_filename=stored, file_size=len(content), mime_type=mime, uploaded_by_name=user.get("name") or user.get("email", "Unknown"))
    db.add(att); db.commit(); db.refresh(att)
    return _to_dict(att)


@router.get("/leads/{lead_id}/attachments/{attachment_id}/download")
def download_attachment(lead_id: str, attachment_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    att = db.query(LeadAttachment).filter(LeadAttachment.id == attachment_id, LeadAttachment.lead_id == lead_id).first()
    if not att: raise HTTPException(status_code=404, detail="Attachment not found")
    path = UPLOAD_ROOT / lead_id / att.stored_filename
    if not path.exists(): raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(path=str(path), filename=att.original_filename, media_type=att.mime_type or "application/octet-stream")


@router.delete("/leads/{lead_id}/attachments/{attachment_id}")
def delete_attachment(lead_id: str, attachment_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    att = db.query(LeadAttachment).filter(LeadAttachment.id == attachment_id, LeadAttachment.lead_id == lead_id).first()
    if not att: raise HTTPException(status_code=404, detail="Attachment not found")
    try: (UPLOAD_ROOT / lead_id / att.stored_filename).unlink(missing_ok=True)
    except Exception: pass
    db.delete(att); db.commit()
    return {"ok": True}
