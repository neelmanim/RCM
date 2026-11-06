"""Authenticated messaging routes reserved for a future provider."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/conversations", tags=["Conversations"])


def _unavailable():
    raise HTTPException(status_code=503, detail="Connect a messaging provider to use SMS or WhatsApp.")


class SendMessageRequest(BaseModel):
    lead_id: str                    # Lead this send is scoped to — ownership is checked
    phone: str                      # Recipient phone e.g. "+919019280470" — must belong to lead_id
    sender_id: str                  # Alternate Messenger sender number e.g. "918956778474"
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


@router.get("/embed-url")
def get_embed_url(current_user: dict = Depends(get_current_user)):
    _unavailable()


@router.get("/status")
def get_conversations_status(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    return {"configured": False}


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
    _unavailable()


@router.get("/count")
def get_conversation_count(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    _unavailable()


@router.get("/templates")
def get_whatsapp_templates(
    search: str = Query("", description="Filter by template name"),
    count: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    _unavailable()


@router.get("/session-state")
def get_session_state(
    lead_id: str = Query(..., description="Lead this check is scoped to — ownership is checked"),
    phone: str = Query(..., description="Lead phone number (E.164 or local) — must belong to lead_id"),
    sender_id: str = Query(..., description="Alternate Messenger sender number"),
    channel: str = Query("whatsapp", description="whatsapp | sms"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    _unavailable()


@router.get("/{conversation_id}/messages")
def get_conversation_thread(
    conversation_id: int,
    lead_id: str = Query(..., description="Lead this conversation must belong to — ownership is checked"),
    count: int = Query(50, ge=1, le=200),
    index: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    _unavailable()


@router.post("/send")
def send_conversation_message(
    body: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    _unavailable()
