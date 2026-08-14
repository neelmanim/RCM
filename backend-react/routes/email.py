"""Full Nylas email routes: config, mailbox connect/disconnect, send, activity, attachments."""
import os, json, logging, urllib.parse, io
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy.orm import Session
import httpx

from database import get_db
from middleware import get_current_user, require_super_admin
from utils.crypto import encrypt_token, decrypt_token
from models import NylasConfig, UserMailbox, LeadEmailActivity, EmailThread, Lead, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/email", tags=["Email (Nylas)"])

NYLAS_API_BASE = "https://api.us.nylas.com"


def _get_nylas_config(db):
    config = db.query(NylasConfig).filter(NylasConfig.id == 1, NylasConfig.is_active == True).first()
    if not config or not config.client_id:
        raise HTTPException(status_code=503, detail="Nylas not configured.")
    return config


def _get_api_key(config):
    try: return decrypt_token(config.api_key_encrypted)
    except Exception: raise HTTPException(status_code=500, detail="Failed to decrypt Nylas API key")


def _plain_text_to_html(plain):
    import html as html_mod
    escaped = html_mod.escape(plain or "")
    body = escaped.replace("\n", "<br>")
    footer = '<div style="margin-top:24px;padding-top:6px;border-top:1px solid #f0f0f0;"><span style="font-size:9px;color:#c0c0c0;font-family:Arial,sans-serif;">RCM &middot; Powered by RCM</span></div>'
    return f'<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">{body}{footer}</div>'


def _sanitize_preview(html_body, max_len=0):
    import re
    try:
        import bleach
        text = bleach.clean(html_body or "", tags=[], strip=True)
    except ImportError:
        text = html_body or ""
    text = re.split(r'\s*On\s+(?:\w{3},\s+)?\w{3}\s+\d+,?\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?[\s\S]*?wrote:', text)[0]
    text = re.split(r'\s*-{3,}\s*(?:Forwarded|Original)\s+[Mm]essage', text)[0]
    lines = [l for l in text.split('\n') if not l.strip().startswith('>')]
    text = '\n'.join(lines).strip()
    return text[:max_len] if max_len and len(text) > max_len else text


# ── Nylas Config (Super Admin) ───────────────────────────────────────────────

@router.get("/config")
def get_config_status(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    config = db.query(NylasConfig).filter(NylasConfig.id == 1).first()
    if not config: return {"configured": False}
    return {"configured": bool(config.client_id and config.api_key_encrypted), "is_active": config.is_active, "client_id": config.client_id or "", "redirect_uri": config.redirect_uri or "", "has_api_key": bool(config.api_key_encrypted), "has_webhook_secret": bool(config.webhook_secret_encrypted), "configured_by": config.configured_by_name, "configured_at": str(config.configured_at) if config.configured_at else None}


@router.post("/config")
def save_config(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    client_id = body.get("client_id", "").strip()
    api_key = body.get("api_key", "").strip()
    redirect_uri = body.get("redirect_uri", "").strip()
    webhook_secret = body.get("webhook_secret", "").strip()
    if not client_id or not api_key: raise HTTPException(status_code=422, detail="Client ID and API Key required")
    api_key_enc = encrypt_token(api_key)
    ws_enc = encrypt_token(webhook_secret) if webhook_secret else None
    config = db.query(NylasConfig).filter(NylasConfig.id == 1).first()
    if config:
        config.client_id = client_id; config.api_key_encrypted = api_key_enc; config.redirect_uri = redirect_uri
        config.webhook_secret_encrypted = ws_enc; config.configured_by_user_id = admin.get("sub")
        config.configured_by_name = admin.get("name"); config.configured_at = datetime.now(timezone.utc); config.is_active = True
    else:
        config = NylasConfig(id=1, client_id=client_id, api_key_encrypted=api_key_enc, redirect_uri=redirect_uri, webhook_secret_encrypted=ws_enc, configured_by_user_id=admin.get("sub"), configured_by_name=admin.get("name"), configured_at=datetime.now(timezone.utc), is_active=True)
        db.add(config)
    db.commit()
    return {"message": "Nylas configuration saved", "is_active": True}


# ── Mailbox Connection ───────────────────────────────────────────────────────

@router.get("/auth-url")
def get_auth_url(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    config = _get_nylas_config(db)
    email = user.get("email", "")
    if not email: raise HTTPException(status_code=400, detail="User email not found")
    params = {"client_id": config.client_id, "redirect_uri": config.redirect_uri, "response_type": "code", "login_hint": email, "state": user.get("sub", ""), "access_type": "online"}
    return {"auth_url": f"{NYLAS_API_BASE}/v3/connect/auth?{urllib.parse.urlencode(params)}"}


@router.get("/callback")
async def nylas_callback(code: str, state: str = "", db: Session = Depends(get_db)):
    config = db.query(NylasConfig).filter(NylasConfig.id == 1, NylasConfig.is_active == True).first()
    if not config: raise HTTPException(status_code=503, detail="Nylas not configured")
    api_key = _get_api_key(config)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{NYLAS_API_BASE}/v3/connect/token", json={"client_id": config.client_id, "client_secret": api_key, "code": code, "redirect_uri": config.redirect_uri, "grant_type": "authorization_code"}, headers={"Content-Type": "application/json"}, timeout=30)
            if resp.status_code != 200: raise HTTPException(status_code=400, detail=f"Token exchange failed: {resp.text}")
            data = resp.json()
    except httpx.HTTPError as e: raise HTTPException(status_code=502, detail=f"Nylas unreachable: {e}")
    grant_id = data.get("grant_id", ""); email = data.get("email", "")
    if not grant_id: raise HTTPException(status_code=400, detail="No grant_id received")
    if not state: raise HTTPException(status_code=400, detail="Missing user context")
    u = db.query(User).filter(User.id == state).first()
    if not u: raise HTTPException(status_code=404, detail="User not found")
    if email.lower() != u.email.lower(): raise HTTPException(status_code=403, detail=f"Email mismatch. Connect {u.email} only.")
    existing = db.query(UserMailbox).filter(UserMailbox.user_id == state).first()
    if existing:
        existing.nylas_grant_id = grant_id; existing.email_address = email; existing.provider = data.get("provider", "unknown"); existing.status = "connected"; existing.connected_at = datetime.now(timezone.utc)
    else:
        db.add(UserMailbox(user_id=state, email_address=email, provider=data.get("provider", "unknown"), nylas_grant_id=grant_id, status="connected"))
    db.commit()
    target = "my-settings" if u.role == "SDR" else "settings"
    return RedirectResponse(url=f"/frontend/index.html?email_connected=true#{target}")


@router.get("/status")
def get_status(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    mb = db.query(UserMailbox).filter(UserMailbox.user_id == user.get("sub")).first()
    config = db.query(NylasConfig).filter(NylasConfig.id == 1, NylasConfig.is_active == True).first()
    return {"nylas_configured": bool(config), "connected": bool(mb and mb.status == "connected"), "email": mb.email_address if mb else None, "provider": mb.provider if mb else None, "connected_at": str(mb.connected_at) if mb and mb.connected_at else None}


@router.post("/disconnect")
def disconnect_mailbox(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    mb = db.query(UserMailbox).filter(UserMailbox.user_id == user.get("sub")).first()
    if not mb: raise HTTPException(status_code=404, detail="No connected mailbox")
    db.delete(mb); db.commit()
    return {"message": "Email disconnected"}


# ── Send Email ───────────────────────────────────────────────────────────────

@router.post("/send")
async def send_email(request: Request, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    ct = request.headers.get("content-type", "")
    att_files = []
    if "multipart/form-data" in ct:
        form = await request.form()
        lead_id = (form.get("lead_id") or "").strip(); subject = (form.get("subject") or "").strip()
        email_body = (form.get("body") or "").strip(); reply_id = (form.get("reply_to_message_id") or "").strip()
        thread_param = (form.get("thread_id") or "").strip()
        for key in form:
            if key.startswith("attachment"):
                upload = form[key]
                if hasattr(upload, 'read'):
                    att_files.append({"filename": upload.filename, "content": await upload.read(), "content_type": upload.content_type or "application/octet-stream"})
    else:
        body = await request.json()
        lead_id = (body.get("lead_id") or "").strip(); subject = (body.get("subject") or "").strip()
        email_body = (body.get("body") or "").strip(); reply_id = (body.get("reply_to_message_id") or "").strip()
        thread_param = (body.get("thread_id") or "").strip()
    if not lead_id: raise HTTPException(status_code=422, detail="lead_id required")
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead: raise HTTPException(status_code=404, detail="Lead not found")
    if not lead.email: raise HTTPException(status_code=400, detail="Lead has no email")
    mb = db.query(UserMailbox).filter(UserMailbox.user_id == user.get("sub"), UserMailbox.status == "connected").first()
    if not mb: raise HTTPException(status_code=400, detail="No connected mailbox")
    config = _get_nylas_config(db); api_key = _get_api_key(config)
    payload = {"to": [{"email": lead.email}], "subject": subject, "body": _plain_text_to_html(email_body), "tracking_options": {"opens": True, "thread_replies": True, "label": lead_id}}
    if reply_id: payload["reply_to_message_id"] = reply_id
    try:
        async with httpx.AsyncClient() as client:
            if att_files:
                files = {"message": (None, json.dumps(payload), "application/json")}
                for i, af in enumerate(att_files): files[f"file{i}"] = (af["filename"], af["content"], af["content_type"])
                resp = await client.post(f"{NYLAS_API_BASE}/v3/grants/{mb.nylas_grant_id}/messages/send", files=files, headers={"Authorization": f"Bearer {api_key}"}, timeout=60)
            else:
                resp = await client.post(f"{NYLAS_API_BASE}/v3/grants/{mb.nylas_grant_id}/messages/send", json=payload, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, timeout=30)
            if resp.status_code == 401: mb.status = "error"; db.commit(); raise HTTPException(status_code=401, detail="Email connection expired.")
            if resp.status_code not in (200, 202): raise HTTPException(status_code=502, detail=f"Send failed: {resp.text}")
            send_data = resp.json()
    except httpx.HTTPError as e: raise HTTPException(status_code=502, detail=f"Nylas unreachable: {e}")
    msg_data = send_data.get("data", send_data)
    nylas_msg_id = msg_data.get("id", ""); nylas_thread_id = thread_param or msg_data.get("thread_id", "")
    db.add(LeadEmailActivity(lead_id=lead_id, user_id=user.get("sub"), direction="outbound", subject=subject, body_preview=_sanitize_preview(email_body), from_email=mb.email_address, to_email=lead.email, nylas_message_id=nylas_msg_id, nylas_thread_id=nylas_thread_id))
    if nylas_thread_id and not db.query(EmailThread).filter(EmailThread.nylas_thread_id == nylas_thread_id).first():
        db.add(EmailThread(nylas_thread_id=nylas_thread_id, lead_id=lead_id))
    db.commit()
    return {"message": "Email sent", "nylas_message_id": nylas_msg_id, "nylas_thread_id": nylas_thread_id}


# ── Email Activity ───────────────────────────────────────────────────────────

def _sync_thread_messages(lead_id, db):
    config = db.query(NylasConfig).filter(NylasConfig.id == 1, NylasConfig.is_active == True).first()
    if not config or not config.api_key_encrypted: return
    try: api_key = decrypt_token(config.api_key_encrypted)
    except Exception: return
    threads = db.query(EmailThread).filter(EmailThread.lead_id == lead_id).all()
    if not threads: return
    outbound = db.query(LeadEmailActivity).filter(LeadEmailActivity.lead_id == lead_id, LeadEmailActivity.direction == "outbound", LeadEmailActivity.user_id.isnot(None)).first()
    if not outbound or not outbound.user_id: return
    mb = db.query(UserMailbox).filter(UserMailbox.user_id == outbound.user_id, UserMailbox.status == "connected").first()
    if not mb: return
    existing_ids = set(r[0] for r in db.query(LeadEmailActivity.nylas_message_id).filter(LeadEmailActivity.lead_id == lead_id, LeadEmailActivity.nylas_message_id.isnot(None)).all())
    connected_emails = set(r[0].lower() for r in db.query(UserMailbox.email_address).filter(UserMailbox.status == "connected").all())
    for tm in threads:
        try:
            resp = httpx.get(f"{NYLAS_API_BASE}/v3/grants/{mb.nylas_grant_id}/messages", params={"thread_id": tm.nylas_thread_id, "limit": 50, "select": "id,body,snippet,from,to,subject,date,attachments,thread_id"}, headers={"Authorization": f"Bearer {api_key}"}, timeout=15)
            if resp.status_code != 200: continue
            for msg in resp.json().get("data", []):
                mid = msg.get("id", "")
                if mid in existing_ids: continue
                frm = msg.get("from", []); fe = frm[0].get("email", "") if frm else ""
                if fe.lower() in connected_emails: continue
                to_list = msg.get("to", []); te = to_list[0].get("email", "") if to_list else ""
                ts = None
                if msg.get("date"):
                    try: ts = datetime.fromtimestamp(msg["date"], tz=timezone.utc)
                    except Exception: ts = datetime.now(timezone.utc)
                atts = msg.get("attachments", [])
                att_json = json.dumps([{"id": a.get("id", ""), "filename": a.get("filename", ""), "content_type": a.get("content_type", ""), "size": a.get("size", 0)} for a in atts if a.get("content_disposition") != "inline"]) if atts else None
                if att_json == "[]": att_json = None
                db.add(LeadEmailActivity(lead_id=lead_id, user_id=None, direction="inbound", subject=msg.get("subject", ""), body_preview=_sanitize_preview(msg.get("body", msg.get("snippet", ""))), from_email=fe, to_email=te, nylas_message_id=mid, nylas_thread_id=tm.nylas_thread_id, timestamp=ts, attachments_json=att_json))
                existing_ids.add(mid)
        except Exception: continue
    try: db.commit()
    except Exception: db.rollback()


def _sync_bg(lead_id):
    from database import SessionLocal
    db = SessionLocal()
    try: _sync_thread_messages(lead_id, db)
    except Exception: pass
    finally: db.close()


@router.get("/lead/{lead_id}/emails")
def get_lead_emails(lead_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    activities = db.query(LeadEmailActivity).filter(LeadEmailActivity.lead_id == lead_id).order_by(LeadEmailActivity.timestamp.asc()).all()
    background_tasks.add_task(_sync_bg, lead_id)
    return {"emails": [{"id": a.id, "direction": a.direction, "subject": a.subject, "body_preview": a.body_preview, "from_email": a.from_email, "to_email": a.to_email, "timestamp": str(a.timestamp) if a.timestamp else None, "user_id": a.user_id, "user_name": a.user.name if a.user else None, "nylas_message_id": a.nylas_message_id, "opened_at": str(a.opened_at) if a.opened_at else None, "open_count": a.open_count or 0, "attachments": json.loads(a.attachments_json) if a.attachments_json else []} for a in activities], "total": len(activities)}


@router.get("/attachment/{attachment_id}/download")
async def download_email_attachment(attachment_id: str, message_id: str = "", db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    if not message_id: raise HTTPException(status_code=422, detail="message_id required")
    mb = db.query(UserMailbox).filter(UserMailbox.user_id == user.get("sub"), UserMailbox.status == "connected").first()
    if not mb: raise HTTPException(status_code=400, detail="No connected mailbox")
    config = _get_nylas_config(db); api_key = _get_api_key(config)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{NYLAS_API_BASE}/v3/grants/{mb.nylas_grant_id}/attachments/{attachment_id}/download", params={"message_id": message_id}, headers={"Authorization": f"Bearer {api_key}"}, timeout=30)
            if resp.status_code != 200: raise HTTPException(status_code=502, detail="Download failed")
            return StreamingResponse(io.BytesIO(resp.content), media_type=resp.headers.get("content-type", "application/octet-stream"), headers={"Content-Disposition": resp.headers.get("content-disposition", "attachment; filename=attachment")})
    except httpx.HTTPError as e: raise HTTPException(status_code=502, detail=f"Nylas unreachable: {e}")
