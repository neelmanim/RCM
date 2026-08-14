"""
main.py — RCM Dialer SDK Reference Proxy
================================================
Copy-paste this file and adapt it for your own backend.
This FastAPI app acts as the proxy between the SDK (browser) and RCM's API.

5 routes:
  POST /dialer/call/start      → RCM /calls/initiate
  POST /dialer/call/action     → RCM /calls/{id}/action  (mute/hold)
  POST /dialer/call/end        → RCM /calls/disconnect
  POST /dialer/webhook         → Validate RCM signature → SSE fan-out
  GET  /dialer/events          → SSE stream (browser subscribes here)

Run:
  pip install -r requirements.txt
  cp .env.example .env            # fill in your credentials
  uvicorn main:app --reload
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import sse_broker
from poller import start_polling, stop_polling

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
RCM_BASE_URL  = os.getenv("RCM_BASE_URL", "https://api.bercm.com")
RCM_API_KEY   = os.getenv("RCM_API_KEY", "")
RCM_USER_ID   = os.getenv("RCM_USER_ID", "")
RCM_FROM_NUM  = os.getenv("RCM_FROM_NUMBER", "")

# Optional: shared secret to validate incoming RCM webhook signatures.
# Leave empty if RCM support has not configured a secret for your account.
RCM_WEBHOOK_SECRET = os.getenv("RCM_WEBHOOK_SECRET", "")

# CORS — set to your customer's frontend origin in production
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

# ── RCM HTTP client ────────────────────────────────────────────────────
def _rcm_headers() -> dict:
    return {
        "Authorization": f"Token {RCM_API_KEY}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }

async def _rcm_post(path: str, body: dict) -> dict:
    url = f"{RCM_BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=body, headers=_rcm_headers())
    if not resp.is_success:
        logger.error("[Proxy] RCM %s → %s: %s", path, resp.status_code, resp.text)
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    try:
        return resp.json()
    except Exception:
        return {}

async def _rcm_get(path: str, params: dict = None) -> dict:
    url = f"{RCM_BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params or {}, headers=_rcm_headers())
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()

# ── Lifespan — start/stop background poller ───────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background polling task (polls RCM every 2s for active calls)
    poll_task = asyncio.create_task(start_polling(_rcm_get, sse_broker))
    logger.info("[Proxy] Background poller started")
    yield
    poll_task.cancel()
    try:
        await poll_task
    except asyncio.CancelledError:
        pass
    logger.info("[Proxy] Background poller stopped")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="RCM Dialer SDK Proxy",
    version="1.0.0",
    description="Reference proxy for the RCM Dialer SDK",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Schemas ───────────────────────────────────────────────────────────────────
class CallStartRequest(BaseModel):
    phone: str
    contact_name: Optional[str] = ""
    call_mode: Optional[str] = "browser"   # 'browser' | 'bridge'

class CallActionRequest(BaseModel):
    call_id: str
    action: str                             # 'mute' | 'unmute' | 'hold' | 'resume' | 'hangup'
    room_name: Optional[str] = None

class CallEndRequest(BaseModel):
    call_id: Optional[str] = None

# ── Active calls registry (call_id → metadata) ───────────────────────────────
# Used by the poller to know which calls to track.
# In production, use Redis or a database instead.
_active_calls: dict[str, dict] = {}

# ── Route 1: Start call ───────────────────────────────────────────────────────
@app.post("/dialer/call/start")
async def call_start(req: CallStartRequest):
    """
    POST /dialer/call/start
    Proxies to RCM /calls/initiate.
    Returns { call_id, livekit_token, livekit_url, room_name } to the browser SDK.
    """
    if not RCM_API_KEY:
        raise HTTPException(status_code=500, detail="RCM_API_KEY not configured")

    # Format phone to 00-prefixed international format
    phone = req.phone.strip().replace(" ", "").replace("-", "")
    if phone.startswith("+"):
        phone = "00" + phone[1:]
    elif not phone.startswith("00"):
        phone = "00" + phone

    payload: dict = {
        "phone_number":  phone,
        "user_id":       RCM_USER_ID,
        "from_number":   RCM_FROM_NUM,
        "call_mode":     req.call_mode,
    }

    result = await _rcm_post("/calls/initiate", payload)

    call_id       = str(result.get("call_id") or result.get("id", ""))
    livekit_token = result.get("token")
    livekit_url   = result.get("livekit_url")
    room_name     = result.get("room_name")

    if not call_id:
        raise HTTPException(status_code=502, detail="RCM did not return a call_id")

    # Register with poller
    _active_calls[call_id] = {
        "call_id":   call_id,
        "room_name": room_name,
        "phone":     req.phone,
    }

    logger.info("[Proxy] Call started: %s → %s", req.phone, call_id)

    return {
        "call_id":       call_id,
        "livekit_token": livekit_token,
        "livekit_url":   livekit_url,
        "room_name":     room_name,
        "contact_name":  req.contact_name,
    }

# ── Route 2: Call action (mute / hold / resume) ───────────────────────────────
@app.post("/dialer/call/action")
async def call_action(req: CallActionRequest):
    """
    POST /dialer/call/action
    Proxies to RCM /calls/{call_id}/action.
    Gap-3 guard: room_name is ONLY sent if non-null (RCM returns 400 otherwise).
    """
    body: dict = {
        "call_id": req.call_id,
        "action":  req.action,
    }
    if req.room_name:          # Guard-3: omit room_name entirely if null/empty
        body["room_name"] = req.room_name

    result = await _rcm_post(f"/calls/{req.call_id}/action", body)
    logger.info("[Proxy] Call action %s on %s", req.action, req.call_id)
    return result

# ── Route 3: End call ─────────────────────────────────────────────────────────
@app.post("/dialer/call/end")
async def call_end(req: CallEndRequest):
    """
    POST /dialer/call/end
    Proxies to RCM /calls/disconnect.
    Also removes call from the active-calls registry.
    """
    body: dict = {}
    if req.call_id:
        body["call_id"] = req.call_id
        _active_calls.pop(req.call_id, None)

    result = await _rcm_post("/calls/disconnect", body)
    logger.info("[Proxy] Call ended: %s", req.call_id)
    return result

# ── Route 4: Webhook receiver ─────────────────────────────────────────────────
@app.post("/dialer/webhook")
async def dialer_webhook(
    request: Request,
    x_rcm_signature: Optional[str] = Header(default=None, alias="x-rcm-signature"),
):
    """
    POST /dialer/webhook
    Receives call status events from RCM (if configured during onboarding).
    Validates the signature (if RCM_WEBHOOK_SECRET is set) and fans the
    event into the SSE broker so the browser SDK receives it instantly.

    NOTE: RCM webhook configuration is done manually by their support team
    during customer onboarding. If not configured, the background poller provides
    equivalent status delivery via polling.
    """
    raw_body = await request.body()

    # Optional signature validation
    if RCM_WEBHOOK_SECRET and x_rcm_signature:
        import hmac, hashlib
        expected = "sha256=" + hmac.new(
            RCM_WEBHOOK_SECRET.encode(),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, x_rcm_signature):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    call_id    = str(payload.get("call_id") or payload.get("id") or "")
    raw_status = str(payload.get("status") or payload.get("event") or "")
    duration   = int(payload.get("duration") or 0)

    if not call_id:
        return {"ok": True, "ignored": "no call_id"}

    # Remove from active calls if terminal
    TERMINAL = {"CALL_ENDED","CALL_FAILED","CALL_MISSED","disconnected","ended","failed","completed"}
    if raw_status in TERMINAL:
        _active_calls.pop(call_id, None)

    # Fan into SSE broker — all subscribers get the event
    event = {"type": "CALL_STATUS", "call_id": call_id, "status": raw_status, "duration": duration}
    await sse_broker.publish_all(event)

    logger.info("[Proxy] Webhook: %s → %s", call_id, raw_status)
    return {"ok": True}

# ── Route 5: SSE stream ───────────────────────────────────────────────────────
KEEPALIVE_S = 25

@app.get("/dialer/events")
async def dialer_events(
    call_id: Optional[str] = Query(default=None),
):
    """
    GET /dialer/events
    SSE stream — browser subscribes here to receive real-time call status.
    Events format: data: {"type": "CALL_STATUS", "call_id": "...", "status": "...", "duration": N}
    """
    async def _stream() -> AsyncGenerator[str, None]:
        queue = sse_broker.subscribe(call_id or "global")
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_S)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Keepalive comment to prevent proxy/nginx 30s idle timeout
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            sse_broker.unsubscribe(call_id or "global", queue)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # nginx: disable proxy buffering
        },
    )

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"ok": True, "active_calls": len(_active_calls)}
