"""Provider-neutral SMS endpoint. Sending is unavailable without a provider."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Union

from database import get_db
from auth import get_current_user
from routes.lead_helpers import load_lead

router = APIRouter(prefix="/api/sms", tags=["SMS"])


class SmsSendRequest(BaseModel):
    lead_id: Union[str, int]   # Accept both; will be converted to str internally
    message: str


@router.post("/send")
def send_sms_to_lead(
    body: SmsSendRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    load_lead(db, current_user, str(body.lead_id), edit=True)
    raise HTTPException(status_code=503, detail="Connect a messaging provider to send SMS.")
