"""Dialer integration routes: call initiation, config, webhooks, debug."""
import logging, re
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from middleware import get_current_user
from models import DialerCall, Lead

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Dialer"])


def _require_super_admin(user: dict):
    if user.get("role") != "Super Admin":
        raise HTTPException(status_code=403, detail="Only Super Admins can manage dialer settings")


# Lazy-import helper for dialer_service (may not be present yet)
def _get_dialer_service():
    try:
        from integrations import dialer_service
        return dialer_service
    except ImportError:
        return None


@router.post("/calls/start")
def start_call(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    ds = _get_dialer_service()
    if not ds:
        raise HTTPException(status_code=501, detail="Dialer service not configured")
    lead_id = body.get("lead_id")
    phone_number = body.get("phone_number")
    if not lead_id or not phone_number:
        raise HTTPException(status_code=400, detail="lead_id and phone_number are required")
    result = ds.initiate_call(db, user, lead_id, phone_number)
    if not result.get("success"):
        raise HTTPException(status_code=422, detail=result.get("error", "Call initiation failed"))
    return result


@router.post("/webhooks/dialer")
async def dialer_webhook(request: Request, db: Session = Depends(get_db)):
    ds = _get_dialer_service()
    if not ds:
        return {"ok": True, "message": "Dialer service not configured"}
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    config = ds.get_dialer_config(db)
    if config.get("provider", "none") == "none":
        return {"ok": True, "message": "No provider configured"}
    # Same fix as backend/routes/dialer_routes.py (RCA 2026-07-10): identify the
    # provider from payload shape, not the single global "provider" setting —
    # Aircall always sends {"event":..., "data":...}, RCM never does.
    provider_name = "aircall" if "event" in payload and "data" in payload else "rcm"
    webhook_token = config.get("webhook_token")
    if webhook_token:
        incoming = payload.get("token") or request.headers.get("X-Webhook-Token", "")
        if incoming != webhook_token:
            raise HTTPException(status_code=401, detail="Invalid webhook token")
    try:
        result = ds.handle_webhook(db, provider_name, payload)
        return result
    except Exception as e:
        logger.error(f"[Dialer Webhook] Error: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@router.get("/dialer/status")
def dialer_status(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    ds = _get_dialer_service()
    if not ds:
        return {"active": False, "provider": "none", "has_credentials": False}
    config = ds.get_dialer_config(db)
    return {"active": config.get("provider", "none") != "none" and config.get("has_credentials", False), "provider": config.get("provider", "none"), "has_credentials": config.get("has_credentials", False)}


@router.get("/dialer/config")
def get_config(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_super_admin(user)
    ds = _get_dialer_service()
    if not ds:
        return {"provider": "none", "has_credentials": False}
    return ds.get_dialer_config(db)


@router.patch("/dialer/config")
def update_config(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_super_admin(user)
    ds = _get_dialer_service()
    if not ds:
        raise HTTPException(status_code=501, detail="Dialer service not configured")
    result = ds.save_dialer_config(db, body)
    if not result.get("success"):
        raise HTTPException(status_code=422, detail=result.get("message", "Failed"))
    return result


@router.post("/dialer/test")
def test_connection(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_super_admin(user)
    ds = _get_dialer_service()
    if not ds:
        raise HTTPException(status_code=501, detail="Dialer service not configured")
    return ds.test_provider_connection(db)


@router.get("/dialer/users")
def list_provider_users(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_super_admin(user)
    ds = _get_dialer_service()
    if not ds:
        return {"users": []}
    return {"users": ds.get_provider_users(db)}


@router.get("/dialer/numbers")
def list_provider_numbers(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_super_admin(user)
    ds = _get_dialer_service()
    if not ds:
        return {"numbers": []}
    return {"numbers": ds.get_provider_numbers(db)}


@router.patch("/calls/{call_id}/outcome")
def update_call_outcome(call_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    call = db.query(DialerCall).filter(DialerCall.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if body.get("outcome"):
        call.outcome = body["outcome"]
    if body.get("notes") is not None:
        call.notes = body["notes"]
    db.commit()
    return {"success": True, "call_id": call_id, "outcome": call.outcome, "notes": call.notes}
