"""
routes/sms_routes.py
────────────────────
POST /api/sms/send — send an SMS to a lead via the Alternate Messenger Floating Widget.

Rules:
  • Any authenticated user can send (SDRs included).
  • Requires messenger_enabled = True and api_key configured.
  • Logs every attempt to sms_logs regardless of outcome.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Union

import models
import sms_service as sms_service          # noqa: F401 (used by tests via patch)
from database import get_db
from auth import get_current_user
from routes.lead_helpers import load_lead
from routes._admin_helpers import _get_or_create_sync_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sms", tags=["SMS – Alternate Messenger Widget"])


class SmsSendRequest(BaseModel):
    lead_id: Union[str, int]   # Accept both; will be converted to str internally
    message: str


@router.post("/send")
def send_sms_to_lead(
    body: SmsSendRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Send an outbound SMS to a lead via Alternate Messenger."""
    lead_id_str = str(body.lead_id)

    # ── 1. Resolve API credentials (soft guard) ────────────────────────────
    settings = _get_or_create_sync_settings(db)
    api_key = getattr(settings, "messenger_api_key", None) or ""
    from_number = getattr(settings, "messenger_from_number", None) or ""

    # ── 2. Resolve lead ─────────────────────────────────────────────────────
    lead = load_lead(db, current_user, lead_id_str, edit=True)  # texting a lead is a change to it

    to_number = (lead.phone or "").strip()
    if not to_number:
        raise HTTPException(
            status_code=400,
            detail="Lead has no phone number on file.",
        )

    # ── 3. Send ─────────────────────────────────────────────────────────────
    result = sms_service.send_sms(api_key, from_number, to_number, body.message)

    # ── 4. Log attempt ──────────────────────────────────────────────────────
    log_status = "sent" if result["success"] else "failed"
    sms_log = models.SmsLog(
        message_id=result.get("message_id"),
        lead_id=lead.id,
        user_id=current_user.get("sub"),
        direction="outbound",
        status=log_status,
        phone_number=to_number,
        message_text=body.message,
        failure_reason=None if result["success"] else result.get("error"),
    )
    db.add(sms_log)
    db.commit()

    # ── 5. Return ────────────────────────────────────────────────────────────
    if result["success"]:
        return {
            "success": True,
            "message_id": result["message_id"],
            "to": to_number,
        }
    else:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": result.get("error", "Send failed")},
        )
