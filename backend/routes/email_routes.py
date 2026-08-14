"""
Nylas Email Integration Routes.
Handles: Nylas config (Super Admin), mailbox connect/disconnect, send email, email activity.
"""
import os
import json
import logging
import hashlib
import hmac
import urllib.parse
from datetime import datetime, timezone

from email_utils import sanitize_preview as _sanitize_preview
from config import BRAND_TAGLINE
from routes._admin_helpers import _is_valid_email

import httpx
import bleach
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from auth import get_current_user, require_super_admin
from crypto import encrypt_token, decrypt_token
import models

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/email", tags=["Email (Nylas)"])

NYLAS_API_BASE = "https://api.us.nylas.com"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_nylas_config(db: Session):
    """Get active Nylas config or raise 503."""
    config = db.query(models.NylasConfig).filter(
        models.NylasConfig.id == 1,
        models.NylasConfig.is_active == True
    ).first()
    if not config or not config.client_id:
        raise HTTPException(status_code=503, detail="Nylas email integration is not configured. Contact your Super Admin.")
    return config


def _get_api_key(config: models.NylasConfig) -> str:
    """Decrypt the Nylas API key."""
    try:
        return decrypt_token(config.api_key_encrypted)
    except Exception as e:
        logger.error(f"Failed to decrypt Nylas API key: {e}")
        raise HTTPException(status_code=500, detail="Failed to decrypt Nylas API key")


def _wrap_email_body(html_body: str, hide_branding: bool = False, signature_html: str = "") -> str:
    """Shared footer/signature wrapping for both outbound paths below.
    `html_body` must already be safe HTML (sanitized or escaped by the caller)."""
    footer = ""
    if not hide_branding:
        # Subtle origin footer — barely visible, for internal identification
        footer = (
            '<div style="margin-top:24px;padding-top:6px;border-top:1px solid #f0f0f0;">'
            '<span style="font-size:9px;color:#c0c0c0;font-family:Arial,sans-serif;">'
            f'{BRAND_TAGLINE.replace("·", "&middot;")}'
            '</span>'
            '</div>'
        )
    signature_block = f'<div style="margin-top:16px;">{signature_html}</div>' if signature_html else ""
    return f'<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">{html_body}{signature_block}{footer}</div>'


def _compose_body_to_html(raw_body: str, hide_branding: bool = False, signature_html: str = "") -> str:
    """Prepare a compose body for outbound send, from the Email Hub's UI.

    The compose editor is a rich-text (contenteditable) field, so `raw_body`
    is real HTML (links, images) rather than plain text — sanitized here
    with the same allowlist email_utils.sanitize_preview uses for inbound
    mail, so outbound/inbound can't drift onto two different HTML policies.
    Plain '\\n' line breaks (e.g. from a non-UI API caller) are still
    honored for backward compatibility.

    Appends the sending user's signature (already sanitized at save time,
    see the /signature endpoints) and a subtle RCM origin footer,
    unless the user opted out (User.hide_branding_in_email).
    """
    html_body = _sanitize_preview(raw_body or "").replace("\n", "<br>")
    return _wrap_email_body(html_body, hide_branding, signature_html)


def _plain_text_to_html(plain_body: str, hide_branding: bool = False) -> str:
    """Convert a genuinely plain-text body (e.g. Sales Journey's templated
    cadence emails — see journey_engine/channels/email_channel.py) to HTML.
    Kept separate from _compose_body_to_html: that path's input is already
    real HTML from a rich-text editor and must not be re-escaped."""
    import html as html_mod
    html_body = html_mod.escape(plain_body or "").replace("\n", "<br>")
    return _wrap_email_body(html_body, hide_branding)


# _sanitize_preview is now imported from email_utils (see top of file).


def _parse_recipient_list(raw: str) -> list:
    """Comma/semicolon-separated recipient string -> validated, deduped
    Nylas-shaped [{"email": ...}] list. Invalid entries are silently dropped
    — a typo'd CC shouldn't block sending to the lead."""
    if not raw:
        return []
    seen = set()
    out = []
    for part in raw.replace(";", ",").split(","):
        addr = part.strip()
        if addr and _is_valid_email(addr) and addr.lower() not in seen:
            seen.add(addr.lower())
            out.append({"email": addr})
    return out


@router.patch("/toggle-branding")
def toggle_my_email_branding(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Allow any authenticated user to opt out of the "RCM · Powered by
    RCM" footer on their own sent mail. Mirrors /api/dialer/toggle's
    self-service pattern (dialer_routes.py)."""
    db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    hide = body.get("hide_branding_in_email")
    if hide is None:
        raise HTTPException(status_code=400, detail="Missing hide_branding_in_email in body")
    if not isinstance(hide, bool):
        raise HTTPException(status_code=400, detail="hide_branding_in_email must be a boolean")

    db_user.hide_branding_in_email = hide
    db.commit()
    return {"hide_branding_in_email": db_user.hide_branding_in_email}


@router.get("/signature")
def get_my_signature(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return the current user's saved email signature (raw HTML, already
    sanitized at save time — safe to render directly in the editor)."""
    db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
    return {"signature_html": (db_user.email_signature_html or "") if db_user else ""}


@router.patch("/signature")
def save_my_signature(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Save the current user's email signature. Sanitized with the same
    allowlist as inbound mail (links and images allowed, scripts/iframes
    etc. stripped) — untrusted rich-text input from the signature editor."""
    db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    raw_html = body.get("signature_html")
    if raw_html is None:
        raise HTTPException(status_code=400, detail="Missing signature_html in body")
    if not isinstance(raw_html, str):
        raise HTTPException(status_code=400, detail="signature_html must be a string")

    db_user.email_signature_html = _sanitize_preview(raw_html, max_len=200_000) if raw_html.strip() else ""
    db.commit()
    return {"signature_html": db_user.email_signature_html}


# ═════════════════════════════════════════════════════════════════════════════
# 1. Nylas Config — Super Admin
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/config")
def get_nylas_config(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Get Nylas config status. Never returns decrypted keys."""
    config = db.query(models.NylasConfig).filter(models.NylasConfig.id == 1).first()
    if not config:
        return {"configured": False}
    return {
        "configured": bool(config.client_id and config.api_key_encrypted),
        "is_active": config.is_active,
        "client_id": config.client_id or "",
        "redirect_uri": config.redirect_uri or "",
        "has_api_key": bool(config.api_key_encrypted),
        "has_webhook_secret": bool(config.webhook_secret_encrypted),
        "configured_by": config.configured_by_name,
        "configured_at": str(config.configured_at) if config.configured_at else None,
    }


@router.post("/config")
def save_nylas_config(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Save/update Nylas config. Encrypts API key and webhook secret.
    If api_key is omitted or empty, the existing encrypted key is preserved
    (allows updating client_id / redirect_uri without re-entering the API key).
    """
    client_id = body.get("client_id", "").strip()
    api_key = body.get("api_key", "").strip()
    redirect_uri = body.get("redirect_uri", "").strip()
    webhook_secret = body.get("webhook_secret", "").strip()

    if not client_id:
        raise HTTPException(status_code=422, detail="Client ID is required")

    # RCA 2026-07-24: a pasted API key with a hidden non-ASCII character
    # (smart quote, invisible unicode) decrypts fine but fails at Nylas —
    # reject it here instead of storing a silently-broken credential.
    for field_name, value in (("Client ID", client_id), ("API Key", api_key), ("Webhook Secret", webhook_secret)):
        if value and not value.isascii():
            raise HTTPException(
                status_code=422,
                detail=f"{field_name} contains a non-ASCII character (often a smart quote or hidden character from copy-paste). Re-type it or paste from a plain-text source.",
            )

    config = db.query(models.NylasConfig).filter(models.NylasConfig.id == 1).first()

    # api_key is required only when there is no existing saved key
    if not api_key and not (config and config.api_key_encrypted):
        raise HTTPException(status_code=422, detail="API Key is required")

    # Encrypt sensitive values — only when a new value was provided
    try:
        api_key_enc = encrypt_token(api_key) if api_key else None
        webhook_secret_enc = encrypt_token(webhook_secret) if webhook_secret else None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Encryption error: {str(e)}")

    if config:
        config.client_id = client_id
        if api_key_enc:                          # only overwrite if a new key was supplied
            config.api_key_encrypted = api_key_enc
        config.redirect_uri = redirect_uri
        if webhook_secret_enc:                   # only overwrite if a new secret was supplied
            config.webhook_secret_encrypted = webhook_secret_enc
        config.configured_by_user_id = admin.get("sub")
        config.configured_by_name = admin.get("name")
        config.configured_at = datetime.now(timezone.utc)
        config.is_active = True
    else:
        config = models.NylasConfig(
            id=1,
            client_id=client_id,
            api_key_encrypted=api_key_enc,
            redirect_uri=redirect_uri,
            webhook_secret_encrypted=webhook_secret_enc,
            configured_by_user_id=admin.get("sub"),
            configured_by_name=admin.get("name"),
            configured_at=datetime.now(timezone.utc),
            is_active=True,
        )
        db.add(config)

    db.commit()
    return {"message": "Nylas configuration saved successfully", "is_active": True}


# ═════════════════════════════════════════════════════════════════════════════
# 2. Mailbox Connection (Nylas Hosted Auth)
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/auth-url")
def get_auth_url(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Generate Nylas Hosted Auth URL. login_hint enforces SSO email."""
    config = _get_nylas_config(db)
    user_email = user.get("email", "")

    if not user_email:
        raise HTTPException(status_code=400, detail="User email not found in session")

    # Build Nylas Hosted Auth URL
    params = {
        "client_id": config.client_id,
        "redirect_uri": config.redirect_uri,
        "response_type": "code",
        "login_hint": user_email,
        "state": user.get("sub", ""),  # user_id as state for callback
        "access_type": "online",
    }
    auth_url = f"{NYLAS_API_BASE}/v3/connect/auth?{urllib.parse.urlencode(params)}"
    return {"auth_url": auth_url}


@router.get("/callback")
async def nylas_callback(code: str, state: str = "", db: Session = Depends(get_db)):
    """
    Handle Nylas OAuth callback.
    Exchanges code for grant, validates email matches SSO,
    stores grant_id in user_mailboxes.
    """
    config = db.query(models.NylasConfig).filter(
        models.NylasConfig.id == 1,
        models.NylasConfig.is_active == True
    ).first()
    if not config:
        raise HTTPException(status_code=503, detail="Nylas not configured")

    api_key = _get_api_key(config)

    # Exchange code for grant
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{NYLAS_API_BASE}/v3/connect/token",
                json={
                    "client_id": config.client_id,
                    "client_secret": api_key,
                    "code": code,
                    "redirect_uri": config.redirect_uri,
                    "grant_type": "authorization_code",
                },
                headers={"Content-Type": "application/json"},
                timeout=30,
            )
            if resp.status_code != 200:
                logger.error(f"Nylas token exchange failed: {resp.status_code} - {resp.text}")
                raise HTTPException(status_code=400, detail=f"Nylas token exchange failed: {resp.text}")
            token_data = resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Nylas: {str(e)}")

    grant_id = token_data.get("grant_id", "")
    email_address = token_data.get("email", "")

    if not grant_id:
        raise HTTPException(status_code=400, detail="No grant_id received from Nylas")

    # Validate: grant email must match user's SSO email
    user_id = state  # We passed user_id as state
    if not user_id:
        raise HTTPException(status_code=400, detail="Missing user context")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if email_address.lower() != user.email.lower():
        logger.warning(f"Email mismatch: grant={email_address}, sso={user.email}")
        raise HTTPException(
            status_code=403,
            detail=f"Email mismatch. You can only connect {user.email}."
        )

    # Upsert user_mailboxes
    existing = db.query(models.UserMailbox).filter(models.UserMailbox.user_id == user_id).first()
    if existing:
        existing.nylas_grant_id = grant_id
        existing.email_address = email_address
        existing.provider = token_data.get("provider", "unknown")
        existing.status = "connected"
        existing.connected_at = datetime.now(timezone.utc)
    else:
        mailbox = models.UserMailbox(
            user_id=user_id,
            email_address=email_address,
            provider=token_data.get("provider", "unknown"),
            nylas_grant_id=grant_id,
            status="connected",
        )
        db.add(mailbox)

    db.commit()
    logger.info(f"Mailbox connected: {email_address} (grant={grant_id[:8]}...)")

    # Redirect to frontend — SDRs use #my-settings, admins use #settings
    from fastapi.responses import RedirectResponse
    target_hash = "my-settings" if user.role in ("SDR", "AE") else "settings"
    _fe = os.getenv("FRONTEND_URL", "").strip()
    if _fe:
        return RedirectResponse(url=f"{_fe}/index.html?email_connected=true#{target_hash}")
    return RedirectResponse(url=f"/frontend/index.html?email_connected=true#{target_hash}")


@router.get("/status")
def get_mailbox_status(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Check if current user has a connected mailbox."""
    mailbox = db.query(models.UserMailbox).filter(
        models.UserMailbox.user_id == user.get("sub")
    ).first()

    # Also check if Nylas is configured at all
    config = db.query(models.NylasConfig).filter(
        models.NylasConfig.id == 1,
        models.NylasConfig.is_active == True
    ).first()

    db_user = db.query(models.User).filter(models.User.id == user.get("sub")).first()

    return {
        "nylas_configured": bool(config),
        "connected": bool(mailbox and mailbox.status == "connected"),
        "email": mailbox.email_address if mailbox else None,
        "provider": mailbox.provider if mailbox else None,
        "connected_at": str(mailbox.connected_at) if mailbox and mailbox.connected_at else None,
        "hide_branding_in_email": bool(db_user and db_user.hide_branding_in_email),
    }


@router.get("/calendar/availability")
def get_calendar_availability(start: str, duration_minutes: int = 30,
                               db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Free-busy check for the "Meeting Booked" modal's conflict warning —
    purely advisory (see call_routes.py's hard-block for the real
    enforcement). Plain sync `def`, not `async def` like this file's other
    endpoints, because it calls the sync nylas_calendar.py helpers shared
    with call_routes.py::log_call (also sync) — FastAPI runs both in a
    worker thread either way.
    """
    from datetime import datetime, timedelta
    from nylas_calendar import check_free_busy, NylasCalendarError

    mailbox = db.query(models.UserMailbox).filter(
        models.UserMailbox.user_id == user.get("sub"),
        models.UserMailbox.status == "connected",
    ).first()
    if not mailbox:
        return {"connected": False, "available": None, "conflicts": []}

    try:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return {"connected": True, "available": None, "conflicts": []}
    end_dt = start_dt + timedelta(minutes=duration_minutes)

    try:
        config = _get_nylas_config(db)
        api_key = _get_api_key(config)
        slots = check_free_busy(
            mailbox.nylas_grant_id, api_key, mailbox.email_address,
            int(start_dt.timestamp()), int(end_dt.timestamp()),
        )
    except (NylasCalendarError, HTTPException):
        # Advisory only — a failed check must never block the modal.
        return {"connected": True, "available": None, "conflicts": []}

    conflicts = [
        {"start": s.get("start_time"), "end": s.get("end_time")}
        for s in slots if s.get("status") == "busy"
    ]
    return {"connected": True, "available": len(conflicts) == 0, "conflicts": conflicts}


@router.post("/disconnect")
def disconnect_mailbox(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Remove the current user's mailbox connection."""
    mailbox = db.query(models.UserMailbox).filter(
        models.UserMailbox.user_id == user.get("sub")
    ).first()
    if not mailbox:
        raise HTTPException(status_code=404, detail="No connected mailbox found")

    db.delete(mailbox)
    db.commit()
    logger.info(f"Mailbox disconnected: user={user.get('email')}")
    return {"message": "Email disconnected successfully"}


# ═════════════════════════════════════════════════════════════════════════════
# 3. Send Email
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/send")
async def send_email(request: Request, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """
    Send email via Nylas from the user's connected mailbox.
    Supports JSON body (no attachments) or multipart/form-data (with attachments).
    Optional: reply_to_message_id for threading replies.
    """
    content_type = request.headers.get("content-type", "")
    attachment_files = []

    if "multipart/form-data" in content_type:
        form = await request.form()
        lead_id = (form.get("lead_id") or "").strip()
        subject = (form.get("subject") or "").strip()
        email_body = (form.get("body") or "").strip()
        reply_to_message_id = (form.get("reply_to_message_id") or "").strip()
        thread_id_param = (form.get("thread_id") or "").strip()
        cc_list = _parse_recipient_list((form.get("cc") or "").strip())
        bcc_list = _parse_recipient_list((form.get("bcc") or "").strip())
        # Collect file attachments (keys: attachment0, attachment1, ...)
        for key in form:
            if key.startswith("attachment"):
                upload = form[key]
                if hasattr(upload, 'read'):
                    file_content = await upload.read()
                    attachment_files.append({
                        "filename": upload.filename,
                        "content": file_content,
                        "content_type": upload.content_type or "application/octet-stream",
                    })
    else:
        body = await request.json()
        lead_id = (body.get("lead_id") or "").strip()
        subject = (body.get("subject") or "").strip()
        email_body = (body.get("body") or "").strip()
        reply_to_message_id = (body.get("reply_to_message_id") or "").strip()
        thread_id_param = (body.get("thread_id") or "").strip()
        cc_list = _parse_recipient_list(body.get("cc") or "")
        bcc_list = _parse_recipient_list(body.get("bcc") or "")

    if not lead_id:
        raise HTTPException(status_code=422, detail="lead_id is required")
    if not subject and not email_body:
        raise HTTPException(status_code=422, detail="Subject or body is required")

    # Get lead
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not lead.email:
        raise HTTPException(status_code=400, detail="Lead has no email address")

    # Get user's mailbox
    mailbox = db.query(models.UserMailbox).filter(
        models.UserMailbox.user_id == user.get("sub"),
        models.UserMailbox.status == "connected"
    ).first()
    if not mailbox:
        raise HTTPException(status_code=400, detail="No connected mailbox. Please connect your email first.")

    # Get Nylas config
    config = _get_nylas_config(db)
    api_key = _get_api_key(config)

    # Sanitize compose HTML, append signature + branding footer per sender prefs
    sending_user = db.query(models.User).filter(models.User.id == user.get("sub")).first()
    hide_branding = bool(sending_user and sending_user.hide_branding_in_email)
    signature_html = (sending_user.email_signature_html or "") if sending_user else ""
    html_body = _compose_body_to_html(email_body, hide_branding=hide_branding, signature_html=signature_html)

    # Build Nylas message payload
    message_payload = {
        "to": [{"email": lead.email}],
        "subject": subject,
        "body": html_body,
        "custom_headers": [
            {"name": "X-Mailer", "value": "RCM CRM / RCM"},
        ],
        "tracking_options": {
            "opens": True,
            "thread_replies": True,
            "label": lead_id,
        },
    }
    if cc_list:
        message_payload["cc"] = cc_list
    if bcc_list:
        message_payload["bcc"] = bcc_list
    if reply_to_message_id:
        message_payload["reply_to_message_id"] = reply_to_message_id

    # Send via Nylas API
    try:
        async with httpx.AsyncClient() as client:
            if attachment_files:
                # Multipart send with attachments
                nylas_files = {
                    "message": (None, json.dumps(message_payload), "application/json"),
                }
                for i, af in enumerate(attachment_files):
                    nylas_files[f"file{i}"] = (af["filename"], af["content"], af["content_type"])

                resp = await client.post(
                    f"{NYLAS_API_BASE}/v3/grants/{mailbox.nylas_grant_id}/messages/send",
                    files=nylas_files,
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=60,  # longer timeout for file uploads
                )
            else:
                # JSON send (no attachments)
                resp = await client.post(
                    f"{NYLAS_API_BASE}/v3/grants/{mailbox.nylas_grant_id}/messages/send",
                    json=message_payload,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=30,
                )

            if resp.status_code == 401:
                # Grant expired
                mailbox.status = "error"
                db.commit()
                raise HTTPException(
                    status_code=401,
                    detail="Email connection expired. Please reconnect your email."
                )

            if resp.status_code not in (200, 202):
                logger.error(f"Nylas send failed: {resp.status_code} - {resp.text}")
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to send email: {resp.text}"
                )

            send_data = resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Nylas: {str(e)}")

    # Extract message/thread IDs from response
    msg_data = send_data.get("data", send_data)
    nylas_message_id = msg_data.get("id", "")
    nylas_thread_id = thread_id_param or msg_data.get("thread_id", "")

    # Log email activity
    activity = models.LeadEmailActivity(
        lead_id=lead_id,
        user_id=user.get("sub"),
        direction="outbound",
        subject=subject,
        body_preview=_sanitize_preview(email_body),
        from_email=mailbox.email_address,
        to_email=lead.email,
        nylas_message_id=nylas_message_id,
        nylas_thread_id=nylas_thread_id,
    )
    db.add(activity)

    # Create thread mapping (if we got a thread_id)
    if nylas_thread_id:
        existing_thread = db.query(models.EmailThread).filter(
            models.EmailThread.nylas_thread_id == nylas_thread_id
        ).first()
        if not existing_thread:
            thread = models.EmailThread(
                nylas_thread_id=nylas_thread_id,
                lead_id=lead_id,
            )
            db.add(thread)

    db.commit()
    att_info = f", attachments={len(attachment_files)}" if attachment_files else ""
    reply_info = f", reply_to={reply_to_message_id[:12]}" if reply_to_message_id else ""
    logger.info(f"Email sent: user={user.get('email')} -> lead={lead.email}, subject={subject[:50]}{att_info}{reply_info}")

    return {
        "message": "Email sent successfully",
        "nylas_message_id": nylas_message_id,
        "nylas_thread_id": nylas_thread_id,
    }



# ═════════════════════════════════════════════════════════════════════════════
# 4. Lead Email Activity
# ═════════════════════════════════════════════════════════════════════════════

def _sync_thread_messages(lead_id: str, db: Session):
    """
    Poll Nylas API for new messages in threads linked to this lead.
    Inserts any inbound messages not yet logged (supplements webhook).
    Fully synchronous — uses httpx sync client to avoid async/sync session issues.
    """
    # Get Nylas config
    config = db.query(models.NylasConfig).filter(
        models.NylasConfig.id == 1,
        models.NylasConfig.is_active == True
    ).first()
    if not config or not config.api_key_encrypted:
        return

    try:
        api_key = decrypt_token(config.api_key_encrypted)
    except Exception:
        return

    # Get all thread mappings for this lead
    thread_mappings = db.query(models.EmailThread).filter(
        models.EmailThread.lead_id == lead_id
    ).all()

    if not thread_mappings:
        return

    # Get the grant_id from any connected mailbox (pick the sender of the outbound email)
    outbound = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.lead_id == lead_id,
        models.LeadEmailActivity.direction == "outbound",
        models.LeadEmailActivity.user_id.isnot(None)
    ).first()

    if not outbound or not outbound.user_id:
        return

    mailbox = db.query(models.UserMailbox).filter(
        models.UserMailbox.user_id == outbound.user_id,
        models.UserMailbox.status == "connected"
    ).first()
    if not mailbox:
        return

    # Pre-fetch existing message IDs and connected emails once (not per-thread)
    existing_ids = set(
        r[0] for r in db.query(models.LeadEmailActivity.nylas_message_id).filter(
            models.LeadEmailActivity.lead_id == lead_id,
            models.LeadEmailActivity.nylas_message_id.isnot(None)
        ).all()
    )
    connected_emails = set(
        r[0].lower() for r in db.query(models.UserMailbox.email_address).filter(
            models.UserMailbox.status == "connected"
        ).all()
    )

    # Fetch messages from each thread using sync httpx
    for tm in thread_mappings:
        try:
            resp = httpx.get(
                f"{NYLAS_API_BASE}/v3/grants/{mailbox.nylas_grant_id}/messages",
                params={"thread_id": tm.nylas_thread_id, "limit": 50, "select": "id,body,snippet,from,to,subject,date,attachments,thread_id"},
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=15,
            )
            if resp.status_code != 200:
                logger.debug(f"Nylas thread fetch failed: {resp.status_code}")
                continue

            messages = resp.json().get("data", [])
        except Exception as e:
            logger.debug(f"Thread poll error: {e}")
            continue

        for msg in messages:
            msg_id = msg.get("id", "")
            if msg_id in existing_ids:
                # Repair: if existing body was truncated (old 500-char limit), update with full body
                snippet = msg.get("body", msg.get("snippet", ""))
                if snippet:
                    existing = db.query(models.LeadEmailActivity).filter(
                        models.LeadEmailActivity.nylas_message_id == msg_id
                    ).first()
                    if existing:
                        new_body = _sanitize_preview(snippet)
                        # Repair if: body is missing, looks truncated (<= 200 chars old limit),
                        # or the new sanitized version is meaningfully longer (HTML now preserved)
                        should_repair = (
                            not existing.body_preview
                            or len(existing.body_preview) <= 200
                            or len(new_body) > len(existing.body_preview) + 50
                        )
                        if should_repair and new_body:
                            existing.body_preview = new_body
                            logger.debug(f"Repaired body: msg_id={msg_id[:12]}, old={len(existing.body_preview or '')}→new={len(new_body)}")
                continue

            from_list = msg.get("from", [])
            from_email = from_list[0].get("email", "") if from_list else ""
            # A connected-mailbox sender here is NOT necessarily "already logged
            # via /send" (that case was already filtered out above via
            # existing_ids) — it can also be a message sent directly from
            # Gmail/Outlook, never logged anywhere. _sync_full_mailbox handles
            # this same case on the happy path; this poller is the fallback
            # when that call fails, so it needs the same handling, not a skip.
            direction = "outbound" if from_email.lower() in connected_emails else "inbound"

            to_list = msg.get("to", [])
            to_email = to_list[0].get("email", "") if to_list else ""
            subject = msg.get("subject", "")
            snippet = msg.get("body", msg.get("snippet", ""))

            # Extract attachment metadata
            attachments_meta = None
            raw_attachments = msg.get("attachments", [])
            if raw_attachments:
                attachments_meta = json.dumps([
                    {
                        "id": att.get("id", ""),
                        "filename": att.get("filename", "attachment"),
                        "content_type": att.get("content_type", "application/octet-stream"),
                        "size": att.get("size", 0),
                    }
                    for att in raw_attachments
                    if att.get("content_disposition") != "inline"  # Skip inline images (signatures, etc.)
                ])
                # If all attachments were inline, set to None
                if attachments_meta == "[]":
                    attachments_meta = None

            # Parse timestamp
            msg_date = msg.get("date")
            timestamp = None
            if msg_date:
                try:
                    timestamp = datetime.fromtimestamp(msg_date, tz=timezone.utc)
                except Exception:
                    timestamp = datetime.now(timezone.utc)

            activity = models.LeadEmailActivity(
                lead_id=lead_id,
                user_id=None,
                direction=direction,
                subject=subject,
                body_preview=_sanitize_preview(snippet),
                from_email=from_email,
                to_email=to_email,
                nylas_message_id=msg_id,
                nylas_thread_id=tm.nylas_thread_id,
                timestamp=timestamp,
                attachments_json=attachments_meta,
            )
            db.add(activity)
            existing_ids.add(msg_id)  # Prevent duplicates within same batch
            logger.info(f"Polled {direction} email: from={from_email}, lead_id={lead_id}, subject={subject[:50]}{', attachments=' + str(len(raw_attachments)) if raw_attachments else ''}")

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to commit polled emails: {e}")


@router.get("/lead/{lead_id}/emails")
def get_lead_emails(lead_id: str, background_tasks: BackgroundTasks,
                    db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Get all email activity for a lead. Syncs new messages from Nylas in background."""

    # Return cached emails immediately — no blocking on external API calls
    activities = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.lead_id == lead_id
    ).order_by(models.LeadEmailActivity.timestamp.asc()).all()

    # Schedule Nylas sync to run AFTER the response is sent
    # Uses its own DB session to avoid session lifecycle issues
    background_tasks.add_task(_sync_full_mailbox_background, lead_id)

    return {
        "emails": [
            {
                "id": a.id,
                "direction": a.direction,
                "subject": a.subject,
                "body_preview": a.body_preview,
                "from_email": a.from_email,
                "to_email": a.to_email,
                "timestamp": str(a.timestamp) if a.timestamp else None,
                "user_id": a.user_id,
                "user_name": a.user.name if a.user else None,
                "nylas_message_id": a.nylas_message_id,
                "opened_at": str(a.opened_at) if a.opened_at else None,
                "open_count": a.open_count or 0,
                "attachments": json.loads(a.attachments_json) if a.attachments_json else [],
            }
            for a in activities
        ],
        "total": len(activities),
    }


def _sync_thread_messages_background(lead_id: str):
    """Wrapper that creates its own DB session for thread-level background sync (kept for compat)."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        _sync_thread_messages(lead_id, db)
    except Exception as e:
        logger.error(f"[Email] Background sync failed for lead {lead_id}: {e}")
    finally:
        db.close()


def _sync_full_mailbox(lead_id: str, db: Session):
    """
    Full mailbox sync — catches emails sent directly from Gmail/Outlook.

    Unlike _sync_thread_messages (which only polls known threads), this function
    fetches ALL recent messages (30-day lookback) from Nylas where any_email
    matches the lead's email address. This captures:
      - Outbound emails sent from Gmail directly (never logged via /send)
      - Inbound replies to those Gmail-sent emails
      - CC'd emails to the lead

    After processing, also runs _sync_thread_messages for body-repair on
    existing threads.
    """
    import time as _time

    # ── 1. Setup ──────────────────────────────────────────────────────────
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead or not lead.email:
        return

    config = db.query(models.NylasConfig).filter(
        models.NylasConfig.id == 1,
        models.NylasConfig.is_active == True
    ).first()
    if not config or not config.api_key_encrypted:
        return

    try:
        api_key = decrypt_token(config.api_key_encrypted)
    except Exception:
        return

    # Find any connected mailbox (prefer the one that sent to this lead)
    outbound = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.lead_id == lead_id,
        models.LeadEmailActivity.direction == "outbound",
        models.LeadEmailActivity.user_id.isnot(None)
    ).first()

    if outbound and outbound.user_id:
        mailbox = db.query(models.UserMailbox).filter(
            models.UserMailbox.user_id == outbound.user_id,
            models.UserMailbox.status == "connected"
        ).first()
    else:
        # No app-sent email logged yet for this lead — the exact case this
        # function exists for (a lead only ever contacted via native Gmail).
        # Falling back to "any connected mailbox" picked an arbitrary SDR's
        # grant in a multi-SDR org, which searches the wrong inbox entirely
        # and finds nothing. Prefer the lead's actually-assigned SDR(s).
        assigned_user_ids = [u.id for u in (lead.assigned_users or [])]
        mailbox = db.query(models.UserMailbox).filter(
            models.UserMailbox.user_id.in_(assigned_user_ids),
            models.UserMailbox.status == "connected"
        ).first()
        if not mailbox:
            mailbox = db.query(models.UserMailbox).filter(
                models.UserMailbox.status == "connected"
            ).first()

    if not mailbox:
        _sync_thread_messages(lead_id, db)
        return

    # ── 2. Pre-fetch existing state ───────────────────────────────────────
    existing_ids = set(
        r[0] for r in db.query(models.LeadEmailActivity.nylas_message_id).filter(
            models.LeadEmailActivity.lead_id == lead_id,
            models.LeadEmailActivity.nylas_message_id.isnot(None)
        ).all()
    )
    connected_emails = set(
        r[0].lower() for r in db.query(models.UserMailbox.email_address).filter(
            models.UserMailbox.status == "connected"
        ).all()
    )
    known_thread_ids = set(
        r[0] for r in db.query(models.EmailThread.nylas_thread_id).filter(
            models.EmailThread.lead_id == lead_id
        ).all()
    )

    # ── 3. Fetch from Nylas — 30-day lookback ─────────────────────────────
    lookback_secs = int(_time.time()) - (30 * 24 * 3600)
    try:
        resp = httpx.get(
            f"{NYLAS_API_BASE}/v3/grants/{mailbox.nylas_grant_id}/messages",
            params={
                "any_email": lead.email,
                "limit": 100,
                "start_after": lookback_secs,
                "select": "id,body,snippet,from,to,subject,date,attachments,thread_id",
            },
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=20,
        )
    except httpx.HTTPError as e:
        logger.warning(f"[FullMailboxSync] Nylas request failed: {e}")
        _sync_thread_messages(lead_id, db)
        return

    if resp.status_code == 401:
        mailbox.status = "error"
        db.commit()
        logger.warning(f"[FullMailboxSync] Grant expired for mailbox={mailbox.email_address}")
        return

    if resp.status_code == 429:
        logger.warning(f"[FullMailboxSync] Rate limited by Nylas for lead={lead_id}")
        return

    if resp.status_code != 200:
        logger.debug(f"[FullMailboxSync] Nylas returned {resp.status_code} for lead={lead_id}")
        _sync_thread_messages(lead_id, db)
        return

    messages = resp.json().get("data", [])
    new_outbound = 0
    new_inbound = 0

    for msg in messages:
        msg_id = msg.get("id", "")
        if not msg_id or msg_id in existing_ids:
            continue

        from_list = msg.get("from", [])
        from_email_addr = from_list[0].get("email", "").lower() if from_list else ""
        to_list = msg.get("to", [])
        to_email_addr = to_list[0].get("email", "").lower() if to_list else ""
        subject = msg.get("subject", "")
        body_text = msg.get("body", msg.get("snippet", ""))
        nylas_thread_id = msg.get("thread_id", "")

        is_outbound = from_email_addr in connected_emails
        direction = "outbound" if is_outbound else "inbound"

        msg_date = msg.get("date")
        timestamp = None
        if msg_date:
            try:
                timestamp = datetime.fromtimestamp(msg_date, tz=timezone.utc)
            except Exception:
                timestamp = datetime.now(timezone.utc)

        attachments_meta = None
        raw_attachments = msg.get("attachments", [])
        if raw_attachments:
            attachments_meta = json.dumps([
                {
                    "id": att.get("id", ""),
                    "filename": att.get("filename", "attachment"),
                    "content_type": att.get("content_type", "application/octet-stream"),
                    "size": att.get("size", 0),
                }
                for att in raw_attachments
                if att.get("content_disposition") != "inline"
            ])
            if attachments_meta == "[]":
                attachments_meta = None

        if nylas_thread_id and nylas_thread_id not in known_thread_ids:
            thread = models.EmailThread(
                nylas_thread_id=nylas_thread_id,
                lead_id=lead_id,
            )
            db.add(thread)
            known_thread_ids.add(nylas_thread_id)
            logger.info(
                f"[FullMailboxSync] New thread mapped: thread_id={nylas_thread_id}, lead_id={lead_id}"
            )

        activity = models.LeadEmailActivity(
            lead_id=lead_id,
            user_id=None,
            direction=direction,
            subject=subject,
            body_preview=_sanitize_preview(body_text),
            from_email=from_email_addr,
            to_email=to_email_addr,
            nylas_message_id=msg_id,
            nylas_thread_id=nylas_thread_id or None,
            timestamp=timestamp,
            attachments_json=attachments_meta,
        )
        db.add(activity)
        existing_ids.add(msg_id)

        if is_outbound:
            new_outbound += 1
        else:
            new_inbound += 1

    try:
        db.commit()
        if new_outbound or new_inbound:
            logger.info(
                f"[FullMailboxSync] lead={lead_id}: +{new_outbound} outbound, "
                f"+{new_inbound} inbound (Gmail/direct)"
            )
    except Exception as e:
        db.rollback()
        logger.error(f"[FullMailboxSync] Commit failed for lead={lead_id}: {e}")
        return

    # Also run thread-level sync for body repair on existing threads
    _sync_thread_messages(lead_id, db)


def _sync_full_mailbox_background(lead_id: str):
    """Wrapper that creates its own DB session for full mailbox background sync."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        _sync_full_mailbox(lead_id, db)
    except Exception as e:
        logger.error(f"[Email] Full mailbox sync failed for lead {lead_id}: {e}")
    finally:
        db.close()



# ── repair_truncated_emails endpoint removed (dead code) ─────────────────────



@router.get("/attachment/{attachment_id}/download")
async def download_attachment(
    attachment_id: str,
    message_id: str = "",
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Proxy-download an attachment from Nylas. Avoids exposing API keys to the frontend."""
    from fastapi.responses import StreamingResponse
    import io

    if not message_id:
        raise HTTPException(status_code=422, detail="message_id query param is required")

    # Get user's mailbox for grant_id
    mailbox = db.query(models.UserMailbox).filter(
        models.UserMailbox.user_id == user.get("sub"),
        models.UserMailbox.status == "connected"
    ).first()
    if not mailbox:
        raise HTTPException(status_code=400, detail="No connected mailbox")

    config = _get_nylas_config(db)
    api_key = _get_api_key(config)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{NYLAS_API_BASE}/v3/grants/{mailbox.nylas_grant_id}/attachments/{attachment_id}/download",
                params={"message_id": message_id},
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=30,
            )
            if resp.status_code != 200:
                logger.error(f"Attachment download failed: {resp.status_code} - {resp.text}")
                raise HTTPException(status_code=502, detail="Failed to download attachment")

            content_type = resp.headers.get("content-type", "application/octet-stream")
            content_disposition = resp.headers.get("content-disposition", "")

            return StreamingResponse(
                io.BytesIO(resp.content),
                media_type=content_type,
                headers={
                    "Content-Disposition": content_disposition or f"attachment; filename=attachment",
                },
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Nylas: {str(e)}")
