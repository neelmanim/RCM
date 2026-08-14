"""Nylas webhook routes and email send/thread routes."""
import hashlib, hmac, json, logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from database import get_db
from middleware import get_current_user
from utils.crypto import decrypt_token
from models import NylasConfig, UserMailbox, LeadEmailActivity, EmailThread, Lead, User

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Webhooks & Email"])


def _verify_signature(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _sanitize_preview(text: str, max_len: int = 0) -> str:
    try:
        import bleach
        clean = bleach.clean(text or "", tags=[], strip=True)
    except ImportError:
        clean = text or ""
    return clean[:max_len] if max_len and len(clean) > max_len else clean


# ── Nylas Webhook ────────────────────────────────────────────────────────────

@router.get("/webhooks/nylas")
def nylas_webhook_challenge(challenge: str = Query(...)):
    return PlainTextResponse(content=challenge)


@router.post("/webhooks/nylas")
async def nylas_webhook_event(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    signature = request.headers.get("x-nylas-signature", "")
    config = db.query(NylasConfig).filter(NylasConfig.id == 1, NylasConfig.is_active == True).first()
    if config and config.webhook_secret_encrypted:
        try:
            secret = decrypt_token(config.webhook_secret_encrypted)
            if signature and not _verify_signature(body, signature, secret):
                raise HTTPException(status_code=401, detail="Invalid webhook signature")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Signature verification error: {e}")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    deltas = payload.get("data", [])
    if isinstance(deltas, dict):
        deltas = [deltas]

    for delta in deltas:
        event_type = delta.get("type", payload.get("type", ""))
        obj_data = delta.get("object_data", delta.get("data", delta))

        if event_type not in ("message.created", "message.updated", "message.send_success", "message.opened"):
            continue

        # Handle open tracking
        if event_type == "message.opened":
            nested = obj_data.get("object", {}) if isinstance(obj_data.get("object"), dict) else {}
            msg_id = obj_data.get("message_id") or nested.get("message_id") or obj_data.get("id") or nested.get("id") or ""
            if msg_id:
                activity = db.query(LeadEmailActivity).filter(LeadEmailActivity.nylas_message_id == msg_id).first()
                if activity:
                    raw = (activity.open_count or 0) + 1
                    if activity.direction == "outbound" and raw <= 1:
                        activity.open_count = 0; db.commit(); continue
                    if not activity.opened_at:
                        activity.opened_at = datetime.now(timezone.utc)
                    activity.open_count = raw - 1 if activity.direction == "outbound" else raw
                    db.commit()
            continue

        # Process message events
        thread_id = obj_data.get("thread_id", "")
        message_id = obj_data.get("id", obj_data.get("message_id", ""))
        from_list = obj_data.get("from", [])
        to_list = obj_data.get("to", [])
        subject = obj_data.get("subject", "")
        body_text = obj_data.get("body", obj_data.get("snippet", ""))
        from_email = from_list[0].get("email", "") if from_list else ""

        if not thread_id:
            continue

        mapping = db.query(EmailThread).filter(EmailThread.nylas_thread_id == thread_id).first()
        if not mapping:
            continue

        sender_mailbox = db.query(UserMailbox).filter(UserMailbox.email_address == from_email.lower(), UserMailbox.status == "connected").first()
        if sender_mailbox:
            continue

        if message_id:
            if db.query(LeadEmailActivity).filter(LeadEmailActivity.nylas_message_id == message_id).first():
                continue

        to_email = to_list[0].get("email", "") if to_list else ""
        raw_attachments = obj_data.get("attachments", [])
        att_meta = None
        if raw_attachments:
            att_meta = json.dumps([{"id": a.get("id", ""), "filename": a.get("filename", "attachment"), "content_type": a.get("content_type", "application/octet-stream"), "size": a.get("size", 0)} for a in raw_attachments if a.get("content_disposition") != "inline"])
            if att_meta == "[]":
                att_meta = None

        act = LeadEmailActivity(lead_id=mapping.lead_id, user_id=None, direction="inbound", subject=subject, body_preview=_sanitize_preview(body_text), from_email=from_email, to_email=to_email, nylas_message_id=message_id, nylas_thread_id=thread_id, attachments_json=att_meta)
        db.add(act); db.commit()

    return {"status": "ok"}


# ── Email Routes ─────────────────────────────────────────────────────────────

@router.get("/api/email/mailbox")
def get_mailbox(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    mailbox = db.query(UserMailbox).filter(UserMailbox.user_id == user["sub"], UserMailbox.status == "connected").first()
    if not mailbox:
        return {"connected": False}
    return {"connected": True, "email_address": mailbox.email_address, "provider": mailbox.provider, "status": mailbox.status, "connected_at": str(mailbox.connected_at) if mailbox.connected_at else None}


@router.get("/api/leads/{lead_id}/emails")
def get_lead_emails(lead_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    emails = db.query(LeadEmailActivity).filter(LeadEmailActivity.lead_id == lead_id).order_by(LeadEmailActivity.timestamp.desc()).all()
    return [{"id": e.id, "direction": e.direction, "subject": e.subject, "body_preview": e.body_preview, "from_email": e.from_email, "to_email": e.to_email, "timestamp": e.timestamp.isoformat() if e.timestamp else None, "open_count": e.open_count or 0, "opened_at": e.opened_at.isoformat() if e.opened_at else None, "nylas_message_id": e.nylas_message_id, "nylas_thread_id": e.nylas_thread_id, "attachments": json.loads(e.attachments_json) if e.attachments_json else []} for e in emails]


@router.get("/api/leads/{lead_id}/email-stats")
def get_lead_email_stats(lead_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    emails = db.query(LeadEmailActivity).filter(LeadEmailActivity.lead_id == lead_id).all()
    sent = sum(1 for e in emails if e.direction == "outbound")
    received = sum(1 for e in emails if e.direction == "inbound")
    opened = sum(1 for e in emails if (e.open_count or 0) > 0)
    total_opens = sum(e.open_count or 0 for e in emails)
    last = max((e.timestamp for e in emails if e.timestamp), default=None)
    return {"total": len(emails), "sent": sent, "received": received, "opened": opened, "total_opens": total_opens, "last_activity": last.isoformat() if last else None}
