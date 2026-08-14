"""
routes/conversations_routes.py
─────────────────────────────
Native RCM Converse Desk API routes.
No iframe required — full REST integration via RCMConversationsService.

Endpoints:
  GET  /api/conversations                   — list conversations (filter by phone)
  GET  /api/conversations/count             — total count
  GET  /api/conversations/templates         — WhatsApp MTM templates
  GET  /api/conversations/session-state     — session window check for a phone
  GET  /api/conversations/{id}/messages     — fetch message thread
  POST /api/conversations/send              — send message (auto-routes template vs free-text)

Rules:
  • Requires rcm_enabled = True, api_key, user_id, and account_id configured.
  • Credentials pulled from SyncSettings (DB) — same pattern as SMS routes.
  • Service is a singleton that preserves the HMAC session cookie jar across calls.
"""

import logging
import re
import time
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

import models
from database import get_db
from auth import get_current_user
from routes._admin_helpers import _get_or_create_sync_settings
from routes.lead_helpers import _can_modify_lead
from rcm_conversations_service import (
    get_conversations_service,
    WhatsAppTemplate,
    _phone_digits_match,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversations", tags=["Conversations – RCM"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_service(db: Session):
    """Resolve SyncSettings and return an initialised RCMConversationsService."""
    settings = _get_or_create_sync_settings(db)
    api_key    = getattr(settings, "rcm_api_key",    None) or ""
    user_id    = getattr(settings, "rcm_user_id",    None) or ""
    account_id = getattr(settings, "rcm_account_id", None) or ""

    if not all([api_key, user_id, account_id]):
        raise HTTPException(
            status_code=503,
            detail=(
                "RCM Conversations is not fully configured. "
                "Set rcm_api_key, rcm_user_id, and "
                "rcm_account_id in Settings."
            ),
        )
    try:
        return get_conversations_service(
            api_key=api_key,
            user_id=user_id,
            account_id=account_id,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


def _resolve_template_vars(text: str, first_name: str) -> str:
    """Replace ${contacts.first_name} in template text with actual value."""
    if not first_name:
        return text
    return re.sub(r"\$\{contacts\.first_name\}", first_name, text)


def _phone_matches_lead(phone: str, lead) -> bool:
    """Suffix-match on digits only — tolerates a leading country code present
    on only one side, the same class of mismatch already handled for dialer
    webhook matching in dialer_service.py."""
    return any(
        _phone_digits_match(phone, candidate)
        for candidate in (lead.phone, lead.phone_secondary, lead.company_phone)
    )


_LEAD_CONVS_CACHE_TTL = 20  # seconds — comfortably covers the 15s frontend history-poll interval
_lead_convs_cache: dict[str, tuple] = {}


def _get_conversations_for_lead_cached(svc, phone: str):
    """/{conversation_id}/messages has no phone param, so it re-verifies
    ownership via a full get_conversations_for_lead round-trip on every call.
    With the frontend polling this route every 15s, that doubled its real
    RCM API round-trips and pushed it into the P=CRITICAL perf tier
    (observed live on staging: 1143ms). Ownership doesn't change within a
    poll cycle, so a short cache removes the repeat round-trip.
    ponytail: single-process in-memory cache — fine at numInstances=1,
    move to a shared cache (e.g. redis) if this backend ever scales out."""
    now = time.time()
    cached = _lead_convs_cache.get(phone)
    if cached and now - cached[0] < _LEAD_CONVS_CACHE_TTL:
        return cached[1]
    convs = svc.get_conversations_for_lead(phone)
    _lead_convs_cache[phone] = (now, convs)
    return convs


def _authorize_conversation_access(db: Session, user: dict, lead_id: str, phone: Optional[str] = None):
    """Every /api/conversations/* route only checked "is this user logged in,"
    not "does this phone/conversation belong to a lead they can access" — any
    authenticated user could read/send against any phone or conversation_id.
    Reuses the same pod/SDR ownership check already used throughout
    lead_routes.py/call_routes.py. Raises 404/403 via _can_modify_lead, or 403
    if the requested phone doesn't match the lead's own phone fields."""
    lead = _can_modify_lead(db, user, lead_id)
    if phone is not None and not _phone_matches_lead(phone, lead):
        raise HTTPException(status_code=403, detail="Phone number does not match the specified lead.")
    return lead


# ── Request schemas ───────────────────────────────────────────────────────────

class SendMessageRequest(BaseModel):
    lead_id: str                    # Lead this send is scoped to — ownership is checked
    phone: str                      # Recipient phone e.g. "+919019280470" — must belong to lead_id
    sender_id: str                  # RCM sender number e.g. "918956778474"
    channel: str = "whatsapp"       # "whatsapp" | "sms"

    # Free-text (active session only)
    text: Optional[str] = None

    # Template send (required when session expired)
    template_name: Optional[str] = None    # name of the template to use

    # Contact context for variable substitution
    contact_first_name: Optional[str] = None
    conversation_id: Optional[int] = None  # If None, new thread is created
    reference_type: str = "contacts"
    reference_id: str = ""


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_conversations(
    lead_id: str = Query(..., description="Lead this listing is scoped to — ownership is checked"),
    phone: str = Query(..., description="Lead phone (E.164 or local) — must belong to lead_id"),
    status: str = Query("open", description="open | closed | all"),
    count: int = Query(20, ge=1, le=100),
    index: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    List Converse Desk conversations for a specific, access-checked lead.

    Query params:
      lead_id — the lead this listing is scoped to (required, ownership-checked)
      phone   — filter by lead phone (E.164 or local); must match lead_id
      status  — "open" | "closed" | "all" (default: open)
      count   — page size (default: 20, max: 100)
      index   — page offset (default: 0)
    """
    _authorize_conversation_access(db, current_user, lead_id, phone)
    svc = _get_service(db)
    try:
        conversations = svc.get_conversations(
            phone=phone,
            status=status,
            count=count,
            index=index,
            include_all_statuses=(status == "all"),
        )
        return {
            "conversations": [
                {
                    "id":                           c.id,
                    "mobile_number":                c.mobile_number,
                    "contact_name":                 c.contact_name,
                    "channel":                      c.channel,
                    "status":                       c.status,
                    "last_message_text":            c.last_message_text,
                    "last_message_direction":       c.last_message_direction,
                    "unread_message_count":         c.unread_message_count,
                    "modified_at":                  c.modified_at,
                    "is_live":                      c.is_live,
                    "last_message_delivery_status": c.last_message_delivery_status,
                    "sender_id":                    c.sender_id,
                }
                for c in conversations
            ],
            "total": len(conversations),
        }
    except Exception as e:
        logger.error("Failed to fetch conversations: %s", e)
        raise HTTPException(status_code=502, detail=f"RCM API error: {e}")


@router.get("/count")
def get_conversation_count(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return total conversation count for the configured owner."""
    svc = _get_service(db)
    try:
        total = svc.get_conversation_count()
        return {"total": total}
    except Exception as e:
        logger.error("Failed to fetch conversation count: %s", e)
        raise HTTPException(status_code=502, detail=f"RCM API error: {e}")


@router.get("/templates")
def get_whatsapp_templates(
    search: str = Query("", description="Filter by template name"),
    count: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Return all WhatsApp MTM (template) messages registered with the account.

    Used by the frontend template picker when sending the first message or
    when the 24-hour session window has expired.

    The `template_text` field contains raw text with ${contacts.first_name}
    placeholders. The caller should substitute these before display.
    """
    svc = _get_service(db)
    try:
        templates = svc.get_whatsapp_templates(search=search, count=count)
        return {
            "templates": [
                {
                    "id":            t.id,
                    "name":          t.name,
                    "template_text": t.template_text,
                    "channel":       t.channel,
                }
                for t in templates
            ],
            "total": len(templates),
        }
    except Exception as e:
        logger.error("Failed to fetch WhatsApp templates: %s", e)
        raise HTTPException(status_code=502, detail=f"RCM API error: {e}")


@router.get("/session-state")
def get_session_state(
    lead_id: str = Query(..., description="Lead this check is scoped to — ownership is checked"),
    phone: str = Query(..., description="Lead phone number (E.164 or local) — must belong to lead_id"),
    sender_id: str = Query(..., description="RCM sender number"),
    channel: str = Query("whatsapp", description="whatsapp | sms"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Check the session state for a lead phone number.

    Returns whether a WhatsApp template is required (24h window expired or
    no prior conversation), or free-text messaging is allowed.

    Response:
        requires_template: true  → show template picker (session expired or new contact)
        requires_template: false → free-text input enabled (session is live)
        conversation_id: int | null → existing conversation (null = new thread)
    """
    _authorize_conversation_access(db, current_user, lead_id, phone)
    svc = _get_service(db)
    try:
        state = svc.get_session_state(phone=phone, sender_id=sender_id, channel=channel)
        return {
            "phone":              phone,
            "channel":            state.channel,
            "requires_template":  state.requires_template,
            "is_live":            state.is_live,
            "last_direction":     state.last_direction,
            "conversation_id":    state.conversation_id,
            "sender_id":          state.sender_id,
        }
    except Exception as e:
        logger.error("Failed to get session state for %s: %s", phone, e)
        raise HTTPException(status_code=502, detail=f"RCM API error: {e}")


@router.get("/{conversation_id}/messages")
def get_conversation_thread(
    conversation_id: int,
    lead_id: str = Query(..., description="Lead this conversation must belong to — ownership is checked"),
    count: int = Query(50, ge=1, le=200),
    index: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Fetch full message thread for a conversation.
    Returns messages sorted chronologically (oldest first).
    """
    lead = _authorize_conversation_access(db, current_user, lead_id)
    svc = _get_service(db)
    try:
        # No phone param on this route, so ownership alone doesn't prove this
        # specific conversation_id belongs to lead_id — confirm it's actually
        # one of this lead's own conversations before returning its contents.
        lead_convs = _get_conversations_for_lead_cached(svc, lead.phone)
        if not any(c.id == conversation_id for c in lead_convs):
            raise HTTPException(status_code=403, detail="Conversation does not belong to the specified lead.")
        thread = svc.get_thread(conversation_id, count=count, index=index)
        return {
            "conversation_id": thread.conversation_id,
            "messages": [
                {
                    "message_id":      m.message_id,
                    "text":            m.text,
                    "direction":       m.direction,
                    "channel":         m.channel,
                    "created_on":      m.created_on,
                    "sender_id":       m.sender_id,
                    "mobile_number":   m.mobile_number,
                    "delivery_status": m.delivery_status,
                    "attach_url":      m.attach_url,
                    "user_name":       m.user_name,
                }
                for m in thread.all_messages
            ],
            "total": len(thread.all_messages),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to fetch thread for conversation %s: %s", conversation_id, e)
        raise HTTPException(status_code=502, detail=f"RCM API error: {e}")


@router.post("/send")
def send_conversation_message(
    body: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Send an outbound WhatsApp or SMS message.

    **Auto-routing logic:**
    - If `template_name` is provided → template send (required for expired sessions)
    - If only `text` is provided → free-text send (requires active session)

    The endpoint resolves ${contacts.first_name} using `contact_first_name`
    before sending. If omitted, the raw placeholder is sent (RCM resolves
    server-side when CRM contact is linked).

    Uses the live-captured endpoint:  POST /api/v2/converse_desk/converse
    """
    lead = _authorize_conversation_access(db, current_user, body.lead_id, body.phone)
    svc = _get_service(db)
    channel = body.channel.lower()
    message_text = body.text or ""

    try:
        if body.template_name:
            # ── Template send ──────────────────────────────────────────────
            templates = svc.get_whatsapp_templates()
            matched = next((t for t in templates if t.name == body.template_name), None)
            if not matched:
                raise HTTPException(
                    status_code=422,
                    detail=f"Template '{body.template_name}' not found or not registered with WhatsApp.",
                )
            message_text = matched.template_text
            if body.contact_first_name:
                message_text = re.sub(r"\$\{contacts\.first_name\}", body.contact_first_name, message_text)
            result = svc.send_whatsapp_template(
                phone=body.phone,
                sender_id=body.sender_id,
                template=matched,
                conversation_id=body.conversation_id,
                contact_first_name=body.contact_first_name or "",
                reference_type=body.reference_type,
                reference_id=body.reference_id,
            )
        elif body.text:
            # ── Free-text send ─────────────────────────────────────────────
            result = svc.send_text_message(
                phone=body.phone,
                sender_id=body.sender_id,
                text=body.text,
                conversation_id=body.conversation_id,
                channel=channel,
                reference_type=body.reference_type,
                reference_id=body.reference_id,
            )
        else:
            raise HTTPException(
                status_code=422,
                detail="Either 'template_name' or 'text' must be provided.",
            )

        # Widget sends previously left no trace in our own DB — every read was
        # a live proxy call to RCM. Log here the same way the Cadence
        # engine's automated sms_channel.py already does, so a manual Widget
        # send and an automated cadence send land in the same table/Activity
        # feed regardless of which triggered it.
        sent_conv_id = result.get("conversation_id") or body.conversation_id
        db.add(models.SmsLog(
            message_id=result.get("temp_unique_id"),
            lead_id=lead.id,
            user_id=current_user.get("sub"),
            direction="outbound",
            status="sent",
            phone_number=body.phone,
            message_text=message_text,
            channel=channel,
            provider="rcm",
            conversation_id=str(sent_conv_id) if sent_conv_id else None,
            template_name=body.template_name,
        ))
        db.commit()

        return {"success": True, "result": result}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to send conversation message: %s", e)
        db.add(models.SmsLog(
            lead_id=lead.id,
            user_id=current_user.get("sub"),
            direction="outbound",
            status="failed",
            phone_number=body.phone,
            message_text=message_text,
            channel=channel,
            provider="rcm",
            conversation_id=str(body.conversation_id) if body.conversation_id else None,
            template_name=body.template_name,
        ))
        db.commit()
        raise HTTPException(status_code=502, detail=f"RCM API error: {e}")
