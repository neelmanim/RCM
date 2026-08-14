# ── routes/dialer_routes.py — Dialer API endpoints ──────────────────────────
"""
API routes for the dialer integration:
- POST /calls/start       — Initiate outbound call via active provider
- POST /webhooks/dialer   — Receive provider webhook events
- GET  /dialer/status     — Check if dialer is active (any user)
- GET  /dialer/config     — Get dialer settings
- PATCH /dialer/config    — Update dialer settings (Super Admin)
- POST /dialer/test       — Test provider connection
- GET  /dialer/users      — List provider users
- GET  /dialer/numbers    — List provider phone numbers
"""
import logging
import json
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from database import get_db
from auth import get_current_user, require_admin
from error_logger import log_error
import dialer_service
import models
import sse_broker  # Phase 3: real-time SSE fan-out

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Dialer"])


# ── Call initiation ──────────────────────────────────────────────────────────

@router.post("/calls/start")
def start_call(request: Request, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Initiate an outbound call through the active dialer provider.
    Body: { "lead_id": "...", "phone_number": "+91..." }
    BUG-04: lead_id is now optional — if omitted, the system tries to find an
    existing lead by phone; if none found, creates a minimal anonymous lead.
    """
    lead_id = body.get("lead_id")
    phone_number = body.get("phone_number", "").strip()
    call_mode = body.get("call_mode", "browser")

    if not phone_number:
        raise HTTPException(status_code=400, detail="phone_number is required")

    # Validate call_mode
    if call_mode not in ("bridge", "browser"):
        raise HTTPException(status_code=400, detail="call_mode must be 'bridge' or 'browser'")

    # BUG-04: Auto-resolve lead when no lead_id is provided
    if not lead_id:
        import models as _m, uuid
        from datetime import datetime, timezone
        # Normalise: strip spaces/dashes for lookup
        def _norm(n): return (n or "").replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        _phone_norm = _norm(phone_number)

        # Search all phone fields
        candidate = None
        for lead in db.query(_m.Lead).all():
            if any(_norm(getattr(lead, f, "") or "") == _phone_norm
                   for f in ("phone", "phone_secondary", "company_phone")):
                candidate = lead
                break

        if candidate:
            lead_id = candidate.id
            logger.info(f"[ManualDial] Found existing lead {lead_id} for phone {phone_number}")
        else:
            # Create anonymous lead — only use real Column fields (notes is a relationship)
            # sf_lead_id: production DB has NOT NULL constraint at DB level (ORM says nullable=True
            # but schema was created before that migration). Use a MANUAL- sentinel so the row can
            # be created without a real Salesforce ID while still satisfying the unique constraint.
            anon = _m.Lead(
                id=str(uuid.uuid4()),
                sf_lead_id=f"MANUAL-{uuid.uuid4().hex[:16]}",   # unique sentinel, not a real SF ID
                first_name="Unknown",
                last_name="Caller",
                email=f"unknown.{uuid.uuid4().hex[:12]}@rcm.auto",
                phone=phone_number,
                status="Calling",
                lead_source="Manual Dial",
                # RCA 2026-08-06: left unset here (unlike the equivalent Klenty
                # auto-lead-creation path, which sets pod_id=sdr.pod_id) — the
                # call still counted toward the SDR's pod in analytics (scoped
                # by caller, not lead), but the lead itself was an orphan not
                # in any pod's own lead list, a real but confusing mismatch.
                pod_id=user.get("pod_id"),
            )
            db.add(anon)
            db.commit()
            db.refresh(anon)
            lead_id = anon.id
            logger.info(f"[ManualDial] Created anonymous lead {lead_id} for phone {phone_number}")

    result = dialer_service.initiate_call(
        db, user, lead_id, phone_number,
        call_mode=call_mode,
        request_base_url=str(request.base_url),
    )

    if not result.get("success"):
        error_msg = result.get("error", "Call initiation failed")
        # RCA-2026-05-29: 405-type failures (SDR's Aircall Desktop offline/unavailable)
        # are operational events — downgrade to "warning". True failures (credential
        # errors, unexpected API errors) stay "critical".
        _user_unavailable = any(phrase in error_msg for phrase in (
            "could not receive the call",
            "is currently marked as",
            "not assigned to any phone number",
        ))
        _log_severity = "warning" if _user_unavailable else "critical"
        # A DNC/unsubscribed skip is policy working as designed, not an
        # operational failure — logging it to Error Logs on every skip during
        # a Power Dialer session would be pure noise. Skip the log entirely
        # (not just downgrade severity) when the gate itself blocked the call.
        if not result.get("suppressed"):
            # Log to the Error Logs table so admins see it in System Logs → Error Logs
            log_error(
                db=db,
                severity=_log_severity,
                category="dialer",
                feature=f"{result.get('provider', 'Unknown')} Dialer",
                title=f"Outbound call failed for {phone_number}",
                description=error_msg,
                action_hint="Check dialer credentials in Settings → Dialer. Review Call Logs for full history.",
                endpoint="/api/calls/start",
                raw_error=error_msg,
                context_json=json.dumps({
                    "lead_id": lead_id,
                    "phone": phone_number,
                    "call_mode": call_mode,
                    "provider": result.get("provider"),
                }),
                user_id=user.get("sub"),
                user_email=user.get("email"),
                user_name=user.get("name"),
                user_role=user.get("role"),
            )
        raise HTTPException(status_code=422, detail=error_msg)

    # Activity log
    try:
        from activity_logger import log_activity
        log_activity(user["sub"], "DIALER_CALL",
                     user_email=user.get("email"), user_name=user.get("name"),
                     object_type="dialer_call", object_id=result.get("call_id"),
                     metadata={"lead_id": lead_id, "provider": result.get("provider"), "phone": phone_number})
    except Exception:
        pass

    # EC-8: include lead_name so frontend outcome modal shows the correct name
    # for both ad-hoc (anonymous) and lead-page-initiated calls.
    lead_name = None
    try:
        import models as _m2
        _lead = db.query(_m2.Lead).filter(_m2.Lead.id == lead_id).first()
        if _lead:
            lead_name = f"{_lead.first_name or ''} {_lead.last_name or ''}".strip() or None
    except Exception:
        pass
    return_val = {**result, "lead_id": lead_id, "lead_name": lead_name}

    # Phase 3: Publish CALL_STARTED event to SSE broker so the browser
    # receives the call_id immediately without waiting for the first poll.
    try:
        import asyncio
        asyncio.get_event_loop().create_task(
            sse_broker.publish(user["sub"], {
                "type":    "CALL_STARTED",
                "call_id": result.get("call_id"),
                "status":  "CALL_STARTED",
                "ts":      __import__("time").time(),
            })
        )
    except Exception:
        pass  # SSE fan-out is best-effort — never block the response

    return return_val


# ── Call status polling ──────────────────────────────────────────────────────

@router.get("/calls/{call_id}/status")
def get_call_status(call_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Get the current status of a call for frontend polling.

    For active calls (CALL_STARTED / CALL_ANSWERED) we poll the provider for
    real-time status and promote it as the authoritative top-level 'status'
    field.  We also persist any transition to the DB so the record stays current.

    Status values the frontend will see:
      "CALL_STARTED"   — ringing / connecting
      "CALL_ANSWERED"  — lead picked up, call is live  → triggers timer
      "CALL_ENDED"     — call completed / failed / no-answer / cancelled
    """
    import models
    dialer_call = db.query(models.DialerCall).filter(models.DialerCall.id == call_id).first()
    if not dialer_call:
        raise HTTPException(status_code=404, detail="Call not found")

    # Start with the DB status as a baseline
    effective_status = dialer_call.status
    provider_raw = None

    # ── Webhook-first architecture: no provider API polling for RCM ───────
    #
    # RCA 2026-06-11: RCM's POST /calls/{id}/status endpoint is an internal
    # endpoint not designed for repeated polling — it returns 502 "Internal API error"
    # consistently under load and cannot accept a notify_url per-call (returns 422).
    #
    # The correct architecture for RCM is:
    #   RCM platform → POST /api/webhooks/dialer (push, reliable, 200 OK)
    #                       → SSE broker fans out to the SDR's browser
    #                       → HTTP polling fallback reads DB (already webhook-updated)
    #
    # For Aircall: their status API IS reliable. Poll it only for Aircall calls
    # that are still in CALL_STARTED and have a numeric provider_call_id.
    _is_aircall = (dialer_call.provider or "").lower() == "aircall"
    if (
        _is_aircall
        and dialer_call.status == "CALL_STARTED"
        and dialer_call.provider_call_id
    ):
        try:
            provider = dialer_service.get_provider_for_user(db, user)
            if provider and hasattr(provider, "get_call_status"):
                provider_raw = provider.get_call_status(dialer_call.provider_call_id)
                logger.info(f"[DialerRoutes] Aircall status poll: {provider_raw}")
                raw_status = (provider_raw.get("status") or "").lower()
                _PRIORITY = {"CALL_STARTED": 0, "CALL_ANSWERED": 1, "CALL_ENDED": 2}
                _AIRCALL_MAP = {
                    "initial":    "CALL_STARTED",
                    "ringing":    "CALL_STARTED",
                    "answered":   "CALL_ANSWERED",
                    "in-progress": "CALL_ANSWERED",
                    "done":       "CALL_ENDED",
                }
                mapped = _AIRCALL_MAP.get(raw_status)
                if mapped:
                    current_priority = _PRIORITY.get(dialer_call.status, 0)
                    if _PRIORITY.get(mapped, 0) > current_priority:
                        effective_status = mapped
                        dialer_call.status = mapped
                        if mapped == "CALL_ANSWERED" and not dialer_call.answered_at:
                            from datetime import datetime, timezone
                            dialer_call.answered_at = datetime.now(timezone.utc)
                        if mapped == "CALL_ENDED" and not dialer_call.ended_at:
                            from datetime import datetime, timezone
                            dialer_call.ended_at = datetime.now(timezone.utc)
                            if provider_raw.get("duration"):
                                dialer_call.duration = provider_raw["duration"]
                        try:
                            db.commit()
                        except Exception as commit_err:
                            db.rollback()
                            logger.warning(f"[DialerRoutes] Aircall status commit failed: {commit_err}")
        except Exception as e:
            logger.warning(f"[DialerRoutes] Aircall status poll failed for call {call_id}: {e}")

    # RCM: DB is already authoritative — webhooks update it in real-time.
    # No provider API call needed. effective_status stays as DB status.


    # ── Guard 1: ended_at override ────────────────────────────────────────────
    # If ended_at is already set (by webhook or disconnect endpoint) but the
    # RCM REST API is still returning 'ringing', trust ended_at over
    # the stale provider response. This happens when a call is declined.
    #
    # EC-3: This guard intentionally applies to ALL providers (not just RCM).
    # For Aircall, ended_at and status=CALL_ENDED are written atomically by the
    # webhook, so Guard 1 never fires for a healthy Aircall call. It is retained
    # as a safety net for any provider where ended_at is set before status is updated.
    if dialer_call.ended_at and effective_status not in ("CALL_ENDED", "CALL_FAILED"):
        from datetime import datetime, timezone
        effective_status = "CALL_ENDED"
        if dialer_call.status not in ("CALL_ENDED", "CALL_FAILED"):
            dialer_call.status = "CALL_ENDED"
            try:
                db.commit()
            except Exception:
                db.rollback()
        logger.info(
            f"[DialerRoutes] Guard1: ended_at set but effective_status={effective_status!r} — "
            f"provider={dialer_call.provider!r}, overriding to CALL_ENDED"
        )

    # ── Guard 2: RCM ringing timeout ────────────────────────────────────
    # If a RCM call has been in CALL_STARTED for >50 seconds with no
    # answer and no ended_at, auto-end it. Declined calls ring for ~20-30s
    # max; 50s ensures legitimate long-ring scenarios still work.
    #
    # EC-7 (order dependency): Guard 2 checks effective_status == "CALL_STARTED"
    # which is already the *normalized* canonical status. This guard MUST run
    # AFTER the status normalizer block above — RCM returns raw strings
    # like "ringing" which are mapped to "CALL_STARTED" by that block.
    if (
        dialer_call.provider == "rcm"
        and effective_status == "CALL_STARTED"
        and dialer_call.started_at
        and not dialer_call.ended_at
    ):
        from datetime import datetime, timezone, timedelta
        # EC-1: safe for both tz-aware (PostgreSQL TIMESTAMPTZ) and tz-naive (SQLite)
        _started = dialer_call.started_at
        if _started.tzinfo is None:
            _started = _started.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - _started
        if age > timedelta(seconds=50):
            effective_status = "CALL_ENDED"
            dialer_call.status  = "CALL_ENDED"
            dialer_call.ended_at = datetime.now(timezone.utc)
            try:
                db.commit()
            except Exception:
                db.rollback()
            # EC-1: use total_seconds() not .seconds — .seconds is sub-minute only (0-59)
            logger.warning(
                f"[DialerRoutes] Guard2: RCM call {call_id} stuck in "
                f"CALL_STARTED for {int(age.total_seconds())}s — auto-ending (declined/no-answer)"
            )

    return {
        "call_id":      dialer_call.id,
        "status":       effective_status,           # authoritative — what frontend acts on
        "duration":     dialer_call.duration,
        "provider":     dialer_call.provider,
        "direction":    dialer_call.direction,
        "started_at":   dialer_call.started_at.isoformat() if dialer_call.started_at else None,
        "ended_at":     dialer_call.ended_at.isoformat() if dialer_call.ended_at else None,
        "provider_status": provider_raw,            # raw RCM response for debugging
    }


# ── Webhook background processor ──────────────────────────────────────────────

def _process_dialer_webhook_bg(provider_name: str, payload: dict) -> None:
    """
    Process a dialer webhook event in a FastAPI BackgroundTask.

    Uses its own DB session (never shares the request-scoped session) so
    the request can return 200 immediately — typically in <50ms — while
    this task runs the full handle_webhook() + db.commit() path.

    RCM's webhook retry threshold is ~3-5s. The old synchronous path
    took 1.4-2.3s, burning 50-75% of that budget. Offloading here stops
    RCM from sending duplicate webhook events.
    """
    from database import SessionLocal
    db = SessionLocal()
    try:
        result = dialer_service.handle_webhook(db, provider_name, payload)
        logger.info(f"[Dialer Webhook BG] Processed: {result}")
    except Exception as e:
        logger.error(f"[Dialer Webhook BG] Unhandled error: {e}", exc_info=True)
    finally:
        db.close()


# ── Webhooks ─────────────────────────────────────────────────────────────────

@router.post("/webhooks/dialer")
async def dialer_webhook(request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Receive webhook events from either dialer provider (Aircall or RCM).
    No auth required — webhooks come from provider servers. Aircall and RCM
    are independent and can both be live at once (per-user overrides), so the
    provider is identified from the payload shape, not a single "active" setting.

    Returns 200 immediately — heavy processing runs in a BackgroundTask
    to keep response time <50ms and prevent RCM retry storms.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    config = dialer_service.get_dialer_config(db)
    if not config.get("has_credentials") and not config.get("has_rcm_credentials"):
        logger.warning("[Dialer Webhook] Received webhook but no provider configured")
        return {"ok": True, "message": "No provider configured, event ignored"}

    # RCA 2026-07-10: routing used to trust the single global `dialer_provider`
    # setting, so every RCM webhook was silently misrouted to the Aircall
    # parser whenever that setting was "aircall" (and vice versa) — Aircall always
    # sends {"event": ..., "data": {...}}, RCM never does.
    # ponytail: shape-sniffing for 2 known providers; if a 3rd is added, give each
    # provider an explicit signature check instead of one more branch here.
    provider_name = "aircall" if "event" in payload and "data" in payload else "rcm"

    # Optional: Verify webhook token if configured (must run synchronously before returning)
    webhook_token = config.get("webhook_token")
    if webhook_token:
        incoming_token = payload.get("token") or request.headers.get("X-Webhook-Token", "")
        if incoming_token != webhook_token:
            logger.warning("[Dialer Webhook] Invalid webhook token")
            raise HTTPException(status_code=401, detail="Invalid webhook token")

    # Offload processing to background — return 200 immediately so RCM
    # receives a sub-50ms response and does not trigger webhook retries.
    background_tasks.add_task(_process_dialer_webhook_bg, provider_name, payload)
    return {"ok": True}


# ── Provider-specific webhook endpoints (for dual-provider support) ──────────

@router.post("/webhooks/aircall")
async def aircall_webhook(request: Request, db: Session = Depends(get_db)):
    """Receive webhook events from Aircall — routes directly, no mismatch check."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    try:
        result = dialer_service.handle_webhook(db, "aircall", payload)
        logger.info(f"[Aircall Webhook] Processed: {result}")
        return result
    except Exception as e:
        logger.error(f"[Aircall Webhook] Error: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@router.post("/webhooks/rcm")
async def rcm_webhook(request: Request, db: Session = Depends(get_db)):
    """Receive webhook events from RCM Contact Center."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    try:
        result = dialer_service.handle_webhook(db, "rcm", payload)
        logger.info(f"[RCM Webhook] Processed: {result}")

        # Phase 3: Fan-out call status to SSE broker
        # The broker routes the event to the SDR who owns this call.
        _user_id  = result.get("user_id")
        _call_id  = result.get("call_id")
        _status   = result.get("status")
        if _user_id and _call_id and _status:
            await sse_broker.publish(_user_id, {
                "type":     "CALL_STATUS",
                "call_id":  _call_id,
                "status":   _status,
                "duration": result.get("duration"),
                "ts":       __import__("time").time(),
            })

        return result
    except Exception as e:
        logger.error(f"[RCM Webhook] Error: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


# ── Dialer status (any authenticated user) ───────────────────────────────────

@router.get("/dialer/status")
def dialer_status(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Check if a dialer provider is active for the current user. Returns minimal info, no secrets.

    Uses a live DB check (not JWT) so admin toggles take effect immediately without
    requiring SDRs to re-login.  get_provider_for_user() returns None when the user's
    dialer_enabled flag is False in the users table.
    """
    # Per-SDR provider resolution — gates on live DB dialer_enabled (not JWT claim)
    provider = dialer_service.get_provider_for_user(db, user)
    # Read settings once for sender_id and per-SDR from_number
    settings = dialer_service._get_settings(db)
    sender_id = getattr(settings, 'rcm_sender_id', '') or ''
    # Per-SDR from_number (set by the SDR in Settings → Dialer)
    import models as _m
    db_user = db.query(_m.User).filter(_m.User.id == user["sub"]).first()
    from_number = (getattr(db_user, 'rcm_from_number', None) or '') if db_user else ''
    dialer_enabled = bool(getattr(db_user, 'dialer_enabled', False)) if db_user else False
    # V48: Aircall Everywhere org-wide kill switch — the React embed gates itself on this.
    aircall_everywhere_enabled = bool(getattr(settings, 'aircall_everywhere_enabled', False))
    if provider:
        return {
            "active": True,
            "provider": provider.provider_name,
            "has_credentials": True,
            "sender_id": sender_id,
            "from_number": from_number,
            "dialer_enabled": dialer_enabled,
            "aircall_everywhere_enabled": aircall_everywhere_enabled,
        }
    # No provider resolved (disabled, no credentials, or dialer_enabled=False)
    config = dialer_service.get_dialer_config(db)
    return {
        "active": False,
        "provider": config.get("provider", "none"),
        "has_credentials": config.get("has_credentials", False),
        "sender_id": "",
        "dialer_enabled": dialer_enabled,
        "aircall_everywhere_enabled": aircall_everywhere_enabled,
    }


# ── RCM call action endpoints ─────────────────────────────────────────

@router.post("/calls/{call_id}/action")
def call_action(call_id: str, request_body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Perform an in-call action (hold, mute, unmute, hangup).
    Only works with RCM provider.
    """
    from models import DialerCall
    dc = db.query(DialerCall).filter(DialerCall.id == call_id).first()
    if not dc:
        raise HTTPException(status_code=404, detail="Call not found")
    if dc.provider != "rcm":
        raise HTTPException(status_code=400, detail="Call actions only supported for RCM calls")

    provider = dialer_service.get_provider_for_user(db, user)
    if not provider or provider.provider_name != "rcm":
        raise HTTPException(status_code=400, detail="RCM provider not configured for your account")

    action = request_body.get("action", "")
    room_name = request_body.get("room_name")
    if action not in ("hold", "mute", "unmute", "hangup"):
        raise HTTPException(status_code=400, detail=f"Invalid action: {action}")

    result = provider.call_action(dc.provider_call_id, action, room_name=room_name)
    return {"ok": True, "result": result}


@router.post("/calls/disconnect")
def disconnect_call(request_body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Disconnect / end an active RCM call.
    """
    call_id = request_body.get("call_id")
    phone_number = request_body.get("phone_number")
    if not call_id and not phone_number:
        raise HTTPException(status_code=400, detail="Provide call_id or phone_number")

    provider = dialer_service.get_provider_for_user(db, user)
    if not provider or provider.provider_name != "rcm":
        raise HTTPException(status_code=400, detail="Disconnect only supported for RCM provider")

    # If we have a CRM call_id, resolve the provider_call_id
    provider_call_id = call_id
    if call_id:
        from models import DialerCall
        dc = db.query(DialerCall).filter(DialerCall.id == call_id).first()
        if dc:
            provider_call_id = dc.provider_call_id

    result = provider.disconnect_call(call_id=provider_call_id, phone_number=phone_number)

    # Immediately mark the call CALL_ENDED in DB so the SDR can place a new call
    # without being blocked by EC-16. The RCM CALL_ENDED webhook arrives 3-6s
    # later and is idempotent (no-op if status already CALL_ENDED).
    if call_id:
        from models import DialerCall
        from datetime import datetime, timezone
        dc_upd = db.query(DialerCall).filter(DialerCall.id == call_id).first()
        if dc_upd and dc_upd.status not in ("CALL_ENDED", "CALL_FAILED"):
            dc_upd.status   = "CALL_ENDED"
            dc_upd.ended_at = dc_upd.ended_at or datetime.now(timezone.utc)
            try:
                db.commit()
                logger.info(f"[DialerRoutes] disconnect: marked call {call_id} as CALL_ENDED in DB")
            except Exception as commit_err:
                db.rollback()
                logger.warning(f"[DialerRoutes] disconnect: DB commit failed: {commit_err}")

    return {"ok": True, "result": result}


# ── Active call lookup (used by page-load recovery + EC-16 monitoring) ────────

@router.get("/calls/my-active")
def get_my_active_call(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Return the calling SDR's current non-stale active DialerCall.

    Applies EC-16 staleness thresholds (5 min CALL_STARTED / 90 min CALL_ANSWERED).
    Stale calls are auto-healed to CALL_ENDED so the SDR can place a new call.

    Used by:
    - Page-load recovery in app.js to show the recovery widget when the SDR
      reloaded mid-call (ghost call prevention)
    - Future monitoring dashboards

    Returns:
        { "active": true, "call_id": "...", "status": "...", "lead_id": "...",
          "lead_name": "...", "phone": "...", "call_mode": "...",
          "started_at": "...", "answered_at": "..." }
        or { "active": false }
    """
    user_id = user.get("sub")
    active_call = dialer_service._get_active_call_for_user(db, user_id)
    if not active_call:
        return {"active": False}

    # Resolve call_mode from raw_payload (RCM stores it there) or fallback
    call_mode = "browser"
    if active_call.raw_payload:
        try:
            payload = json.loads(active_call.raw_payload)
            call_mode = payload.get("call_mode", "browser")
        except Exception:
            pass

    # Resolve lead name safely (lead_id can be null for anonymous dials)
    lead_name = None
    if active_call.lead:
        parts = [active_call.lead.first_name or "", active_call.lead.last_name or ""]
        lead_name = " ".join(p for p in parts if p).strip() or None

    return {
        "active":      True,
        "call_id":     active_call.id,
        "status":      active_call.status,
        "provider":    active_call.provider,
        "lead_id":     active_call.lead_id,
        "lead_name":   lead_name,
        "phone":       active_call.phone_number,
        "call_mode":   call_mode,
        "started_at":  active_call.started_at.isoformat()  if active_call.started_at  else None,
        "answered_at": active_call.answered_at.isoformat() if active_call.answered_at else None,
    }


# ── Force-end (SDR escape hatch + beforeunload sendBeacon target) ─────────────

@router.post("/calls/force-end")
def force_end_call(request: Request, body: dict, db: Session = Depends(get_db)):
    """
    Force-end a call and immediately mark it CALL_ENDED in DB.

    Unlike /calls/disconnect, this endpoint:
    1. Swallows provider errors — DB is always marked CALL_ENDED regardless
    2. Accepts the JWT in the body's '_token' field for navigator.sendBeacon
       (browser API cannot send Authorization headers on page unload)
    3. Validates user ownership — SDRs can only end their own calls

    Used by:
    - navigator.sendBeacon on beforeunload (ghost call prevention)
    - Recovery widget "End Call" button when widget state was restored from DB
    - Any future admin force-end flows
    """
    from datetime import datetime, timezone as tz
    from auth import decode_jwt as _decode_jwt

    # ── Auth: accept header token OR body _token (sendBeacon workaround) ───
    call_id = body.get("call_id")
    if not call_id:
        raise HTTPException(status_code=400, detail="call_id required")

    # Try Authorization header first (standard fetch calls)
    auth_header = request.headers.get("Authorization", "")
    user_payload = None
    if auth_header.startswith("Bearer "):
        try:
            user_payload = _decode_jwt(auth_header[7:])
        except Exception:
            pass

    # Fallback: token embedded in body (_token field — sendBeacon path)
    if not user_payload and body.get("_token"):
        try:
            user_payload = _decode_jwt(body["_token"])
        except Exception:
            pass


    if not user_payload:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # ── Load call and verify ownership ──────────────────────────────────────
    dc = db.query(models.DialerCall).filter(models.DialerCall.id == call_id).first()
    if not dc:
        raise HTTPException(status_code=404, detail="Call not found")

    caller_user_id = user_payload.get("sub")
    # Ownership check: SDRs can only force-end their own calls
    # (Super Admins bypass — role check)
    if dc.user_id and dc.user_id != caller_user_id:
        role = user_payload.get("role", "SDR")
        if role not in ("Super Admin", "Admin"):
            raise HTTPException(status_code=403, detail="Not your call")

    # ── Best-effort provider disconnect (errors are swallowed) ───────────────
    if dc.provider_call_id:
        try:
            settings   = dialer_service._get_settings(db)
            provider   = dialer_service._instantiate_provider(dc.provider, settings)
            if provider:
                provider.disconnect_call(call_id=dc.provider_call_id)
                logger.info(f"[DialerRoutes] force-end: provider.disconnect_call OK for {call_id}")
        except Exception as e:
            logger.warning(
                f"[DialerRoutes] force-end: provider.disconnect_call failed "
                f"(call may remain active on RCM servers): {e}"
            )

    # ── Always mark DB as ended ──────────────────────────────────────────────
    if dc.status not in ("CALL_ENDED", "CALL_FAILED"):
        dc.status   = "CALL_ENDED"
        dc.ended_at = dc.ended_at or datetime.now(tz.utc)
        try:
            db.commit()
            logger.info(f"[DialerRoutes] force-end: marked call {call_id} as CALL_ENDED")
        except Exception as commit_err:
            db.rollback()
            logger.warning(f"[DialerRoutes] force-end: DB commit failed: {commit_err}")

    return {"ok": True}


@router.get("/calls/{call_id}/recording-url")
def get_recording_url(call_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Get a fresh pre-signed recording URL for a call.
    Works with both Aircall and RCM providers.
    """
    from models import DialerCall
    dc = db.query(DialerCall).filter(DialerCall.id == call_id).first()
    if not dc:
        raise HTTPException(status_code=404, detail="Call not found")
    if not dc.provider_call_id:
        raise HTTPException(status_code=400, detail="No provider call ID")

    # Instantiate the correct provider based on the call's provider field
    settings = dialer_service._get_settings(db)
    provider = dialer_service._instantiate_provider(dc.provider, settings)
    if not provider:
        raise HTTPException(status_code=400, detail=f"Provider '{dc.provider}' not configured")

    url = provider.get_recording_url(dc.provider_call_id)
    if not url:
        raise HTTPException(status_code=404, detail="Recording not available")

    # Update the cached URL
    dc.recording_url = url
    db.commit()

    return {"recording_url": url, "call_id": call_id}


# ── Power Dialer queue status ────────────────────────────────────────────────
# Persists a rep's progress through their Power Dialer queue server-side —
# see models.DialerQueueStatus's docstring for why (2026-08-10 review: an
# ephemeral client-side session Map couldn't survive a reload, and forced an
# artificial cap on queue size since "done" leads never dropped off the list).

_QUEUE_STATUSES = {"called", "skipped", "skipped_dnc"}


@router.get("/dialer/queue-status")
def get_queue_status(
    lead_ids: str = Query(..., description="Comma-separated lead IDs"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Batch lookup — one round trip for the whole queue page, not one per lead."""
    ids = [i for i in lead_ids.split(",") if i]
    if not ids:
        return {}
    rows = db.query(models.DialerQueueStatus).filter(
        models.DialerQueueStatus.user_id == user["sub"],
        models.DialerQueueStatus.lead_id.in_(ids),
    ).all()
    return {
        r.lead_id: {
            "status": r.status,
            "skip_reason": r.skip_reason,
            "updated_at": str(r.updated_at) if r.updated_at else None,
        }
        for r in rows
    }


@router.post("/dialer/queue-status")
def set_queue_status(
    body: dict,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upsert this rep's status for one lead. skip_reason only makes sense for
    status="skipped" (a plain rep skip) — "skipped_dnc" is a system-detected,
    compliance-driven skip, kept as a distinct value so the two never blur
    together in any future audit/reporting (see DNC review notes)."""
    lead_id = body.get("lead_id")
    status = body.get("status")
    skip_reason = (body.get("skip_reason") or "").strip()[:200] or None

    if not lead_id or status not in _QUEUE_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(_QUEUE_STATUSES)}")

    row = db.query(models.DialerQueueStatus).filter(
        models.DialerQueueStatus.user_id == user["sub"],
        models.DialerQueueStatus.lead_id == lead_id,
    ).first()
    if row:
        row.status = status
        row.skip_reason = skip_reason if status == "skipped" else None
    else:
        row = models.DialerQueueStatus(
            lead_id=lead_id, user_id=user["sub"], status=status,
            skip_reason=skip_reason if status == "skipped" else None,
        )
        db.add(row)
    db.commit()
    return {"lead_id": lead_id, "status": status, "skip_reason": row.skip_reason}


@router.get("/admin/dialer/skip-summary")
def get_skip_summary(
    days: int = Query(7, ge=1, le=90),
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Aggregate skip reasons/DNC skips across all reps for the last N days —
    the read side of what POST /dialer/queue-status writes per-rep. Nothing
    surfaced this data anywhere before 2026-08-10; it just sat in the table."""
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.query(models.DialerQueueStatus).filter(
        models.DialerQueueStatus.status.in_(["skipped", "skipped_dnc"]),
        models.DialerQueueStatus.updated_at >= since,
    ).all()

    by_reason, by_rep_count = {}, {}
    dnc_count = 0
    for r in rows:
        if r.status == "skipped_dnc":
            dnc_count += 1
        else:
            reason = r.skip_reason or "No reason given"
            by_reason[reason] = by_reason.get(reason, 0) + 1
        by_rep_count[r.user_id] = by_rep_count.get(r.user_id, 0) + 1

    names = {}
    if by_rep_count:
        names = {u.id: (u.name or u.email) for u in db.query(models.User).filter(models.User.id.in_(by_rep_count.keys())).all()}

    return {
        "days": days,
        "total_skips": len(rows),
        "dnc_skips": dnc_count,
        "by_reason": sorted(
            [{"reason": k, "count": v} for k, v in by_reason.items()],
            key=lambda x: -x["count"],
        ),
        "by_rep": sorted(
            [{"user_id": uid, "name": names.get(uid, uid), "count": c} for uid, c in by_rep_count.items()],
            key=lambda x: -x["count"],
        ),
    }


@router.delete("/dialer/queue-status/{lead_id}")
def clear_queue_status(
    lead_id: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Requeue a lead — clears this rep's status row so it's 'untouched' again
    (see models.DialerQueueStatus's docstring). Nothing auto-expires a skip
    today; this is the only way a skipped lead becomes callable again."""
    db.query(models.DialerQueueStatus).filter(
        models.DialerQueueStatus.user_id == user["sub"],
        models.DialerQueueStatus.lead_id == lead_id,
    ).delete()
    db.commit()
    return {"lead_id": lead_id, "status": None}


# ── Debug: Test Aircall API directly ─────────────────────────────────────────

@router.get("/dialer/debug/calls")
def debug_list_aircall_calls(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """DEBUG: List recent calls from Aircall API + our DialerCall records."""
    provider = dialer_service.get_active_provider(db)
    if not provider:
        return {"error": "No active dialer provider"}

    # Fetch recent calls from Aircall API
    aircall_calls = []
    try:
        result = provider._get("/calls", params={"order": "desc", "per_page": 10})
        aircall_calls = result.get("calls", [])
    except Exception as e:
        aircall_calls = [{"error": str(e)}]

    # Our DB records
    from models import DialerCall
    db_calls = db.query(DialerCall).order_by(DialerCall.created_at.desc()).limit(10).all()
    db_records = [{
        "id": c.id,
        "lead_id": c.lead_id,
        "provider_call_id": c.provider_call_id,
        "phone_number": c.phone_number,
        "duration": c.duration,
        "recording_url": bool(c.recording_url),
        "transcript": c.transcript[:100] if c.transcript else None,
        "status": c.status,
        "direction": c.direction,
        "created_at": str(c.created_at) if c.created_at else None,
    } for c in db_calls]

    return {
        "aircall_api_calls": [{
            "id": c.get("id"),
            "duration": c.get("duration"),
            "direction": c.get("direction"),
            "recording": bool(c.get("recording")),
            "status": c.get("status"),
            "started_at": c.get("started_at"),
            "ended_at": c.get("ended_at"),
            "raw_digits": c.get("raw_digits"),
            "missed_call_reason": c.get("missed_call_reason"),
        } for c in aircall_calls if isinstance(c, dict) and "id" in c],
        "db_records": db_records,
        "aircall_raw_error": aircall_calls[0] if aircall_calls and isinstance(aircall_calls[0], dict) and "error" in aircall_calls[0] else None,
    }


@router.get("/dialer/debug/call/{call_id}")
def debug_fetch_aircall_call(call_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """DEBUG: Fetch a specific call from Aircall API — returns raw data."""
    provider = dialer_service.get_active_provider(db)
    if not provider:
        return {"error": "No active dialer provider"}

    # Fetch call details
    call_data = None
    try:
        call_data = provider._get(f"/calls/{call_id}")
    except Exception as e:
        call_data = {"error": str(e)}

    # Fetch transcript
    transcript_data = None
    try:
        transcript_data = provider._get(f"/calls/{call_id}/transcription")
    except Exception as e:
        transcript_data = {"error": str(e)}

    return {
        "call": call_data,
        "transcript": transcript_data,
    }


import re

def _normalize_phone(phone: str) -> str:
    """Strip all non-digit chars for comparison (keep leading +)."""
    if not phone:
        return ""
    return re.sub(r'[^\d]', '', phone)


@router.post("/dialer/debug/repair")
def debug_repair_orphaned_calls(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Repair orphaned DialerCall records — match them to leads by phone number."""
    from models import DialerCall, Lead

    # Find all DialerCall records with no lead_id
    orphans = db.query(DialerCall).filter(
        DialerCall.lead_id.is_(None),
        DialerCall.phone_number.isnot(None),
    ).all()

    # Get all leads with phone numbers — column-only select avoids hydrating
    # full Lead ORM objects (avoids loading all lead fields into Python)
    lead_rows = db.query(Lead.id, Lead.phone).filter(Lead.phone.isnot(None)).all()
    lead_phone_map = {}
    for lead_id, phone in lead_rows:
        normalized = _normalize_phone(phone)
        if normalized:
            lead_phone_map[normalized] = lead_id

    matched = 0
    results = []
    for c in orphans:
        normalized_call_phone = _normalize_phone(c.phone_number)
        if normalized_call_phone in lead_phone_map:
            c.lead_id = lead_phone_map[normalized_call_phone]
            matched += 1
            results.append({
                "call_id": c.id,
                "phone": c.phone_number,
                "matched_lead_id": c.lead_id,
                "status": c.status,
            })

    db.commit()
    return {
        "total_orphans": len(orphans),
        "matched": matched,
        "results": results,
    }


# ── Provider Configuration (Super Admin only) ───────────────────────────────

def _require_super_admin(user: dict):
    """Ensure the current user is a Super Admin."""
    if user.get("role") != "Super Admin":
        raise HTTPException(status_code=403, detail="Only Super Admins can manage dialer settings")


@router.get("/dialer/config")
def get_config(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get current dialer configuration (no secrets exposed)."""
    _require_super_admin(user)
    return dialer_service.get_dialer_config(db)


@router.patch("/dialer/config")
def update_config(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update dialer configuration. Super Admin only."""
    _require_super_admin(user)

    result = dialer_service.save_dialer_config(db, body)
    if not result.get("success"):
        raise HTTPException(status_code=422, detail=result.get("message", "Failed to save config"))

    logger.info(f"[Dialer Config] Updated by {user.get('email')}")
    return result


# ── SDR self-service: phone number for Contact Center ────────────────────────

@router.get("/dialer/my-phone")
def get_my_phone(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the current user's phone number used as caller ID for Contact Center.

    Returns from_number (canonical, consistent with /api/dialer/status EC-8) and
    phone_number (backwards compatibility alias).
    """
    import models
    db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
    number = (db_user.rcm_from_number or "") if db_user else ""
    return {
        "from_number": number,    # canonical — matches /api/dialer/status EC-8 field
        "phone_number": number,   # backwards-compat alias
    }


@router.patch("/dialer/my-phone")
def set_my_phone(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Set the current user's phone number for Contact Center caller ID."""
    import re, models
    db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    phone = (body.get("phone_number") or "").strip() or None

    # Validate format if a number is being set (empty = clear, which is allowed)
    if phone:
        # Strip whitespace, dashes, and parentheses for digit-count check
        digits_only = re.sub(r"[\s\-().]", "", phone)
        valid = (
            re.fullmatch(r"\+[1-9]\d{6,14}", digits_only)       # E.164: +919240915643
            or re.fullmatch(r"00[1-9]\d{6,14}", digits_only)    # 00-prefix: 00919240915643
            or re.fullmatch(r"[1-9]\d{9,14}", digits_only)      # bare national: 9240915643
        )
        if not valid:
            raise HTTPException(
                status_code=422,
                detail="Invalid phone number format. Use E.164 (e.g. +919240915643), "
                       "00-prefix (e.g. 00919240915643), or a 10+ digit number."
            )

    db_user.rcm_from_number = phone
    db.commit()
    logger.info(f"[Dialer] User {user.get('email')} set caller ID to {phone or '(cleared)'}")
    return {"phone_number": phone or "", "message": "Phone number updated"}


@router.patch("/dialer/toggle")
def toggle_my_dialer(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Allow any authenticated user (SDR/Admin/etc) to toggle their own dialer_enabled status."""
    import models
    db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    enabled = body.get("dialer_enabled")
    if enabled is None:
        raise HTTPException(status_code=400, detail="Missing dialer_enabled in body")
    if not isinstance(enabled, bool):
        raise HTTPException(status_code=400, detail="dialer_enabled must be a boolean")
        
    db_user.dialer_enabled = enabled
    db.commit()
    logger.info(f"[Dialer] User {user.get('email')} toggled dialer_enabled to {db_user.dialer_enabled}")
    return {"dialer_enabled": db_user.dialer_enabled, "message": "Dialer status updated"}


@router.get("/dialer/my-numbers")
def get_my_numbers(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Return distinct outgoing numbers this SDR's RCM sub-agent has used.

    Reads the SDR's rcm_user_id (set by Admin), authenticates to
    RCM as that sub-agent, and extracts unique outgoing_number values
    from call history. These are the only numbers valid for call initiation.
    """
    import models
    from rcm_provider import RCMDialerProvider
    from dialer_service import get_dialer_settings

    db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    sub_user_id = (getattr(db_user, "rcm_user_id", None) or "").strip()
    if not sub_user_id:
        return {
            "numbers": [],
            "error": (
                "RCM Agent ID not configured for your account. "
                "Ask a Super Admin to set it in the Admin panel."
            ),
        }

    settings = get_dialer_settings(db)
    api_key  = getattr(settings, "rcm_api_key", None) or ""
    base_url = getattr(settings, "rcm_base_url", None) or "https://app.bercm.com"

    if not api_key:
        return {
            "numbers": [],
            "error": "RCM API key not configured. Set it in Settings → Dialer.",
        }

    try:
        provider = RCMDialerProvider(
            base_url=base_url,
            api_key=api_key,
            user_id=sub_user_id,
            from_number="",
        )
        numbers = provider.get_numbers_for_user(sub_user_id)
    except Exception as e:
        logger.warning(f"[Dialer] get_my_numbers failed for {user.get('email')}: {e}")
        return {
            "numbers": [],
            "error": (
                "Could not reach RCM API. "
                "Check the API key in Settings or verify the Agent ID is correct."
            ),
        }

    if not numbers:
        return {
            "numbers": [],
            "warning": (
                "No call history found for your RCM account. "
                "Make at least one test call via the RCM dashboard first, "
                "then reload to see your valid caller IDs."
            ),
        }

    logger.info(f"[Dialer] my-numbers: {len(numbers)} for {user.get('email')} (agent={sub_user_id})")
    return {"numbers": numbers, "agent_id": sub_user_id, "count": len(numbers)}


@router.post("/dialer/test")
def test_connection(
    provider: Optional[str] = Query(None, description="Provider key: aircall | rcm_dialer | rcm_messaging"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Test a provider's connection.

    Optionally pass ?provider=aircall|rcm_dialer|rcm_messaging to
    test a specific provider regardless of which one is currently active.
    Omitting the param falls back to testing the active provider (backward-compatible).
    """
    _require_super_admin(user)
    if provider:
        return dialer_service.test_specific_provider(db, provider)
    return dialer_service.test_provider_connection(db)


# ── Provider data ────────────────────────────────────────────────────────────

@router.get("/dialer/users")
def list_provider_users(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """List users/agents from the active dialer provider."""
    _require_super_admin(user)
    users = dialer_service.get_provider_users(db)
    return {"users": users}


@router.get("/dialer/numbers")
def list_provider_numbers(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """List phone numbers from the active dialer provider."""
    _require_super_admin(user)
    numbers = dialer_service.get_provider_numbers(db)
    return {"numbers": numbers}


# NOTE: GET /leads/{lead_id}/calls is now unified in call_routes.py
# (merges manual CallLog + dialer DialerCall records)


@router.patch("/calls/{call_id}/outcome")
def update_call_outcome(call_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Update the outcome and notes for a specific call.
    Body: { "outcome": "Interested", "notes": "Wants a demo..." }
    """
    from models import DialerCall

    call = db.query(DialerCall).filter(DialerCall.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    outcome = body.get("outcome")
    notes = body.get("notes")

    if outcome:
        call.outcome = outcome
    if notes is not None:
        call.notes = notes

    db.commit()

    logger.info(f"[Call Outcome] Updated call {call_id}: outcome={outcome}")
    return {"success": True, "call_id": call_id, "outcome": call.outcome, "notes": call.notes}


# ── Admin: Aircall Historical Sync ──────────────────────────────────────────

@router.post("/admin/dialer/sync-aircall")
def trigger_aircall_sync(
    body: dict = None,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Super Admin only. Trigger a historical Aircall data sync in the background.

    Body (optional):
      { "from_date": "2025-03-01", "to_date": "2025-04-21" }
      Defaults to last 90 days. Max window: 90 days (processed in 7-day sub-batches).

    Returns immediately with job metadata; poll GET .../status for results.
    """
    if user.get("role") not in ("Super Admin",):
        raise HTTPException(status_code=403, detail="Super Admin access required")

    from datetime import datetime, timezone, timedelta
    body = body or {}

    from_dt = None
    to_dt = None
    try:
        if body.get("from_date"):
            from_dt = datetime.strptime(body["from_date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if body.get("to_date"):
            to_dt = datetime.strptime(body["to_date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            to_dt = to_dt + timedelta(days=1)  # inclusive end
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

    # Default window
    now = datetime.now(timezone.utc)
    to_dt = to_dt or now
    from_dt = from_dt or (now - timedelta(days=90))

    # Hard cap
    if (to_dt - from_dt).days > 90:
        raise HTTPException(status_code=400, detail="Date range cannot exceed 90 days")

    from database import SessionLocal
    started = dialer_service.run_sync_in_background(SessionLocal, from_dt=from_dt, to_dt=to_dt)
    if not started:
        return {
            "message": "A sync is already running. Check status at GET /api/admin/dialer/sync-aircall/status",
            "running": True,
        }

    logger.info(f"[Admin] Aircall sync triggered by {user.get('email')} for {from_dt.date()} – {to_dt.date()}")
    return {
        "message": "Aircall sync started in background",
        "from_date": from_dt.date().isoformat(),
        "to_date": to_dt.date().isoformat(),
        "running": True,
    }


@router.get("/admin/dialer/sync-aircall/status")
def get_aircall_sync_status(
    user: dict = Depends(get_current_user),
):
    """
    Super Admin only. Poll the status of the last / current Aircall sync job.
    """
    if user.get("role") not in ("Super Admin",):
        raise HTTPException(status_code=403, detail="Super Admin access required")

    return dialer_service.get_sync_job_status()


# ── Admin: Klenty Historical Sync ───────────────────────────────────────────

@router.post("/admin/dialer/sync-klenty")
def trigger_klenty_sync(
    body: dict = None,
    user: dict = Depends(get_current_user),
):
    """
    Super Admin only. Runs a one-off Klenty catch-up synchronously (Klenty is
    a single lightweight paginated feed per account, unlike Aircall's heavier
    historical sync — no background job/polling needed).

    Body (optional): { "lookback_days": 29 }
      Defaults to 3 (same as the nightly job). Capped at
      klenty_provider.MAX_SYNC_LOOKBACK_DAYS (Klenty's own API limit).
      Use a larger value to recover a gap left by Klenty being
      disabled/misconfigured for a stretch of days.
    """
    if user.get("role") not in ("Super Admin",):
        raise HTTPException(status_code=403, detail="Super Admin access required")

    from klenty_provider import MAX_SYNC_LOOKBACK_DAYS
    from scheduled_jobs import _klenty_nightly_sync

    body = body or {}
    lookback_days = min(int(body.get("lookback_days", 3)), MAX_SYNC_LOOKBACK_DAYS)

    logger.info(f"[Admin] Klenty sync triggered by {user.get('email')} — lookback_days={lookback_days}")
    result = _klenty_nightly_sync(lookback_days=lookback_days)
    return result or {"ran": False, "reason": "Unknown error — check server logs"}

# ── V39: Call outcome status polling (used by frontend to detect Aircall auto-sync) ──
@router.get("/dialer/call-outcome-status")
def get_call_outcome_status(
    call_id: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Frontend polls this every 5s while the outcome modal is open (Aircall SDRs only).
    Returns whether the call.tagged webhook has already auto-logged an outcome.

    Response:
      { "outcome_logged": false }
      { "outcome_logged": true, "outcome": "No Answer" }

    404 → call_id not found (unknown call, front-end should stop polling).
    """
    dialer_call = db.query(models.DialerCall).filter(
        models.DialerCall.id == call_id,
    ).first()

    if not dialer_call:
        raise HTTPException(status_code=404, detail="DialerCall not found")

    # Security: SDR can only poll their own calls; admins can poll any
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        if dialer_call.user_id != user.get("sub"):
            raise HTTPException(status_code=403, detail="Not your call")

    if dialer_call.outcome:
        return {"outcome_logged": True, "outcome": dialer_call.outcome}

    return {"outcome_logged": False}


# ── Dialer Playground (Admin only) ────────────────────────────────────────────

@router.get("/dialer/playground")
def dialer_playground_config(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    GET /api/dialer/playground
    Admin-only. Returns the saved global RCM credentials (unmasked)
    so the Playground form can be pre-populated. Admins can then override
    any field and test the widget without touching SDR settings.
    """
    role = user.get("role", "")
    if role not in ("Super Admin", "Admin"):
        raise HTTPException(
            status_code=403,
            detail="Playground is only accessible to Admins and Super Admins.",
        )

    settings = dialer_service._get_settings(db)
    provider  = (getattr(settings, "dialer_provider", None) or "none").lower()
    api_base  = getattr(settings, "rcm_base_url", None) or "https://api.bercm.com"

    return {
        "provider":        provider,
        "has_credentials": bool(
            getattr(settings, "rcm_api_key", None) and
            getattr(settings, "rcm_user_id", None)
        ),
        # Actual values for form pre-fill — admin-only route
        "api_key":         getattr(settings, "rcm_api_key",    "") or "",
        "user_id":         getattr(settings, "rcm_user_id",    "") or "",
        "from_number":     getattr(settings, "rcm_from_number","") or "",
        "sender_id":       getattr(settings, "rcm_sender_id",  "") or "",
        "api_base":        api_base,
        "admin_name":      user.get("name", "Admin"),
    }


@router.get("/dialer/playground/call-status")
def dialer_playground_call_status(
    call_id: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    GET /api/dialer/playground/call-status?call_id=<provider_call_id>
    Admin-only. Polls RCM directly for the status of a playground
    test call by provider_call_id. Returns a simplified status dict.
    Falls back gracefully — never raises (poll loops must be resilient).
    """
    role = user.get("role", "")
    if role not in ("Super Admin", "Admin"):
        raise HTTPException(status_code=403, detail="Playground is admin-only.")

    # Look up the DialerCall by provider_call_id so we can get status
    # from our DB (updated via webhooks) without extra RCM API calls.
    call = db.query(models.DialerCall).filter(
        models.DialerCall.provider_call_id == call_id
    ).order_by(models.DialerCall.created_at.desc()).first()

    if call:
        return {
            "call_id":  call_id,
            "status":   call.status,
            "duration": call.duration,
        }

    # No DB record (playground calls don't always create one) — return neutral
    return {"call_id": call_id, "status": "CALL_STARTED", "duration": None}


@router.post("/dialer/playground/test-call")
def dialer_playground_test_call(
    body: dict,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    POST /api/dialer/playground/test-call
    Admin-only. Initiates a real RCM call using credentials supplied
    directly in the request body — completely independent of the admin's own
    CRM dialer profile. No DialerCall record is written (test only).

    Body: { phone, api_key, user_id, from_number, api_base, call_mode }
    """
    role = user.get("role", "")
    if role not in ("Super Admin", "Admin"):
        raise HTTPException(status_code=403, detail="Playground is admin-only.")

    phone      = (body.get("phone")       or "").strip()
    api_key    = (body.get("api_key")     or "").strip()
    cv_user_id = (body.get("user_id")     or "").strip()
    from_num   = (body.get("from_number") or "").strip()
    api_base   = (body.get("api_base")    or "https://api.bercm.com").strip().rstrip("/")
    call_mode  = (body.get("call_mode")   or "browser").strip()

    if not phone:
        raise HTTPException(status_code=422, detail="phone is required")
    if not api_key or not cv_user_id:
        raise HTTPException(status_code=422, detail="api_key and user_id are required")
    if call_mode == "bridge" and not from_num:
        raise HTTPException(
            status_code=422,
            detail="from_number is required for bridge mode. Enter the DID exactly as shown in your RCM account (e.g. '00919240915643').",
        )

    try:
        from rcm_provider import RCMProvider
        provider = RCMProvider(
            base_url=api_base,
            api_key=api_key,
            user_id=cv_user_id,
            from_number=from_num,
        )
        use_agent_phone = (call_mode == "bridge")
        result = provider.initiate_call(
            phone_number=phone,
            user_email=user.get("email", "playground@rcm"),
            lead_id="playground-test",
            use_agent_phone=use_agent_phone,
        )
    except Exception as exc:
        logger.warning("[Playground] test-call exception: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))

    if not result.success:
        raise HTTPException(status_code=422, detail=result.error or "RCM call failed")

    return {
        "success":       True,
        "call_id":       result.provider_call_id or "",
        "livekit_token": result.livekit_token,
        "livekit_url":   result.livekit_url,
        "room_name":     result.room_name,
        "contact_name":  "Playground Test",
    }

