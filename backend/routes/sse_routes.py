"""
sse_routes.py — Server-Sent Events endpoint for real-time call status
======================================================================

GET /api/calls/events
  - Authenticated (JWT Bearer, same as all other routes)
  - Streams JSON events to the SDR's browser via SSE
  - Replaces 2-second polling in dialer_widget.js
  - Sends a keepalive comment every 25s to prevent proxy/load-balancer
    timeouts (Render, nginx, etc. typically have 30s idle timeouts)

Event format (newline-delimited SSE):
  data: {"type": "CALL_STATUS", "call_id": "...", "status": "CALL_ANSWERED",
         "duration": 42, "ts": 1234567890}

  data: {"type": "CALL_ENDED", "call_id": "...", "status": "CALL_ENDED",
         "duration": 93}

  data: {"type": "KEEPALIVE"}

Browser usage (dialer_widget.js):
  const es = new EventSource('/api/calls/events', { ... })
  es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      window.DialerMachine.send('POLL_UPDATE', {
          rawStatus: event.status,
          duration: event.duration ?? null,
      })
  }
"""

import asyncio
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from auth import get_current_user, decode_jwt
from database import get_db
import sse_broker

logger = logging.getLogger(__name__)
router = APIRouter(tags=["SSE"])

KEEPALIVE_INTERVAL_S = 25  # seconds between SSE keepalive pings


def _get_sse_user(
    request: Request,
    token: str = Query(default=None, description="JWT for EventSource (cannot send headers)"),
):
    """
    Auth dependency for the SSE endpoint.

    EventSource (browser) cannot send Authorization headers, so the JWT
    must be passed as ?token=<jwt>.  As a fallback, the standard Bearer
    header is also accepted (e.g. server-side consumers, curl testing).

    Security note: the token is short-lived (8h) and validated with the
    same HMAC-SHA256 decode_jwt() used for all other API routes.
    """
    # 1. Try query-string token first (EventSource path)
    if token:
        return decode_jwt(token)
    # 2. Fall back to Authorization: Bearer header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return decode_jwt(auth_header[7:])
    from fastapi import HTTPException
    raise HTTPException(status_code=401, detail="Not authenticated")


async def _event_stream(
    user_id: int,
    request: Request,
) -> AsyncGenerator[str, None]:
    """
    Generator that yields SSE-formatted strings.

    Subscribes to the broker, then alternates between:
      - Waiting for the next event from the broker queue
      - Sending a keepalive comment if 25s elapse with no event
    Terminates when the HTTP connection closes (client disconnects).
    """
    queue = sse_broker.subscribe(user_id)
    logger.info(
        "[SSE] Stream opened for user_id=%s  active_streams=%s",
        user_id, sse_broker.subscriber_count(user_id)
    )
    try:
        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            try:
                event = await asyncio.wait_for(
                    queue.get(),
                    timeout=KEEPALIVE_INTERVAL_S,
                )
                payload = json.dumps(event)
                logger.debug("[SSE] → user_id=%s  %s", user_id, payload[:120])
                yield f"data: {payload}\n\n"
            except asyncio.TimeoutError:
                # No event within keepalive window — send a comment to
                # keep the connection alive through proxies.
                yield ": keepalive\n\n"

    except asyncio.CancelledError:
        # Client closed the connection
        pass
    finally:
        sse_broker.unsubscribe(user_id, queue)
        logger.info(
            "[SSE] Stream closed for user_id=%s  remaining=%s",
            user_id, sse_broker.subscriber_count(user_id)
        )


@router.get("/api/calls/events")
async def call_events_stream(
    request: Request,
    user: dict = Depends(_get_sse_user),
    db: Session = Depends(get_db),
):
    """
    SSE endpoint — streams real-time call status events to the SDR's browser.

    Replaces the 2-second polling loop in dialer_widget.js.
    Events are published by:
      - dialer_routes.py webhook handler (RCM push)
      - dialer_routes.py start_call (CALL_STARTED synthetic event)
      - dialer_routes.py disconnect_call (CALL_ENDED synthetic event)

    Authentication: JWT Bearer (same as all other API routes).
    The user_id from the JWT is used to route events to the correct stream.
    """
    user_id = user["id"]

    return StreamingResponse(
        _event_stream(user_id, request),
        media_type="text/event-stream",
        headers={
            # Prevent buffering at every layer
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",      # nginx proxy
            "Connection": "keep-alive",
        },
    )
