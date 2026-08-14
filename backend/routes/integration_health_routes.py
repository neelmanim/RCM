# ── routes/integration_health_routes.py — Integration health diagnostics ──────
"""
Lightweight, auth-protected health endpoints for RCM integrations.
No secrets are exposed — only presence/validity status is returned.

GET /api/dialer/health  — Check RCM Contact Center (calling) config
GET /api/chat/health    — Check RCM Conversations (messaging) config

Both endpoints perform live API pings so you get real connectivity status,
not just "are credentials stored?" — useful for debugging staging vs prod.
"""
import logging
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from auth import get_current_user
import models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Health"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _masked(value: str) -> str:
    """Return a safely masked version of a credential for display."""
    if not value:
        return ""
    if len(value) <= 6:
        return "***"
    return value[:3] + "***" + value[-3:]


def _check(condition: bool, ok_msg: str, fail_msg: str) -> dict:
    return {"ok": condition, "message": ok_msg if condition else fail_msg}


# ── GET /api/dialer/health ────────────────────────────────────────────────────

@router.get("/dialer/health")
def dialer_health(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Diagnose the RCM Contact Center (calling) integration end-to-end.
    Checks: provider config → credentials → from_number → live API ping.
    Safe: no secrets in response. Requires auth (any role).
    """
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        return {"status": "error", "message": "SyncSettings row missing — run migrations"}

    checks = {}
    overall_ok = True

    # 1. Provider configured
    provider = (settings.dialer_provider or "none").lower()
    checks["provider_configured"] = _check(
        provider not in ("none", ""),
        f"Provider set to '{provider}'",
        "No dialer provider configured (Settings → Contact Center → Provider)",
    )
    if not checks["provider_configured"]["ok"]:
        return {"status": "misconfigured", "checks": checks}

    # 2. Credentials present
    if provider == "rcm":
        use_shared = getattr(settings, "dialer_use_shared_creds", True)
        if use_shared:
            api_key = settings.rcm_api_key or ""
            user_id = settings.rcm_user_id or ""
            source = "shared (Conversations tab)"
        else:
            api_key = settings.dialer_api_key or ""
            user_id = settings.dialer_user_id or ""
            source = "separate (Contact Center tab)"

        checks["credentials_source"] = {"ok": True, "message": f"Using {source} credentials"}
        checks["api_key_present"] = _check(
            bool(api_key),
            f"API Key present ({_masked(api_key)})",
            "API Key missing — set rcm_api_key in Settings",
        )
        checks["user_id_present"] = _check(
            bool(user_id),
            f"User ID present ({_masked(user_id)})",
            "User ID missing — set rcm_user_id in Settings",
        )
        checks["from_number_present"] = _check(
            bool(settings.rcm_from_number),
            f"Caller ID (from_number) set to '{settings.rcm_from_number}'",
            "No caller ID set — calls will fail. Set Default Caller ID in Settings → Contact Center",
        )

        for k in ("api_key_present", "user_id_present", "from_number_present"):
            if not checks[k]["ok"]:
                overall_ok = False

        # 3. Live API ping (only if credentials exist)
        if api_key and user_id:
            try:
                from rcm_provider import RCMDialerProvider
                base_url = (
                    getattr(settings, "dialer_base_url", None)
                    or settings.rcm_base_url
                    or "https://app.bercm.com"
                )
                provider_inst = RCMDialerProvider(
                    base_url=base_url,
                    api_key=api_key,
                    user_id=user_id,
                    from_number=settings.rcm_from_number or "",
                )
                result = provider_inst.test_connection()
                checks["api_reachable"] = _check(
                    result.get("success", False),
                    f"API reachable — {result.get('message', 'OK')}",
                    f"API unreachable — {result.get('message', 'Unknown error')}",
                )
                if not checks["api_reachable"]["ok"]:
                    overall_ok = False
            except Exception as e:
                checks["api_reachable"] = {"ok": False, "message": f"API ping failed: {e}"}
                overall_ok = False
        else:
            checks["api_reachable"] = {"ok": False, "message": "Skipped — credentials missing"}
            overall_ok = False

    elif provider == "aircall":
        has_id = bool(settings.dialer_api_id)
        has_token = bool(settings.dialer_api_token)
        checks["aircall_api_id"] = _check(has_id, "API ID present", "Aircall API ID missing")
        checks["aircall_api_token"] = _check(has_token, "API Token present", "Aircall API Token missing")
        if not (has_id and has_token):
            overall_ok = False

        if has_id and has_token:
            try:
                import dialer_service
                provider_inst = dialer_service.get_active_provider(db)
                result = provider_inst.test_connection() if provider_inst else {"success": False, "message": "Could not instantiate provider"}
                checks["api_reachable"] = _check(
                    result.get("success", False),
                    result.get("message", "OK"),
                    result.get("message", "API unreachable"),
                )
                if not checks["api_reachable"]["ok"]:
                    overall_ok = False
            except Exception as e:
                checks["api_reachable"] = {"ok": False, "message": f"API ping failed: {e}"}
                overall_ok = False

    return {
        "status": "ok" if overall_ok else "degraded",
        "provider": provider,
        "checks": checks,
    }


# ── GET /api/chat/health ─────────────────────────────────────────────────────

@router.get("/chat/health")
def chat_health(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Diagnose the RCM Conversations (messaging/SMS/WhatsApp) integration.
    Checks: enabled flag → api_key → user_id → account_id → sender_id → live API ping.
    Safe: no secrets in response. Requires auth (any role).
    """
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        return {"status": "error", "message": "SyncSettings row missing — run migrations"}

    checks = {}
    overall_ok = True

    # 1. Feature enabled
    enabled = getattr(settings, "rcm_enabled", False)
    checks["feature_enabled"] = _check(
        enabled,
        "RCM messaging is enabled",
        "RCM messaging is disabled (Settings → Conversations → Enable toggle)",
    )
    if not enabled:
        overall_ok = False

    # 2. API Key
    api_key = settings.rcm_api_key or ""
    checks["api_key_present"] = _check(
        bool(api_key),
        f"API Key present ({_masked(api_key)})",
        "API Key missing — set rcm_api_key in Settings → Conversations",
    )
    if not api_key:
        overall_ok = False

    # 3. User ID
    user_id = settings.rcm_user_id or ""
    checks["user_id_present"] = _check(
        bool(user_id),
        f"User ID present ({_masked(user_id)})",
        "User ID missing — set rcm_user_id in Settings → Conversations",
    )
    if not user_id:
        overall_ok = False

    # 4. Account ID
    account_id = getattr(settings, "rcm_account_id", None) or ""
    checks["account_id_present"] = _check(
        bool(account_id),
        f"Account ID present ({_masked(account_id)})",
        "Account ID missing — set rcm_account_id in Settings → Conversations",
    )
    if not account_id:
        overall_ok = False

    # 5. Sender ID (outbound number)
    sender_id = getattr(settings, "rcm_sender_id", None) or ""
    checks["sender_id_present"] = _check(
        bool(sender_id),
        f"Sender ID (outbound number) set to '{sender_id}'",
        "Sender ID missing — outbound messages will fail. Set rcm_sender_id in Settings → Conversations",
    )
    if not sender_id:
        overall_ok = False

    # 6. Live API ping (only if all credentials are present)
    if api_key and user_id and account_id:
        try:
            from rcm_conversations_service import RCMConversationsService
            svc = RCMConversationsService(
                api_key=api_key,
                user_id=user_id,
                account_id=account_id,
            )
            # Ping: list conversations with page_size=1 — lightest possible request
            result = svc.list_conversations(page=1, page_size=1)
            reachable = result is not None
            checks["api_reachable"] = _check(
                reachable,
                "Conversations API reachable — credentials valid",
                "Conversations API returned no response — check credentials",
            )
            if not reachable:
                overall_ok = False
        except Exception as e:
            checks["api_reachable"] = {"ok": False, "message": f"API ping failed: {e}"}
            overall_ok = False
    else:
        checks["api_reachable"] = {
            "ok": False,
            "message": "Skipped — one or more credentials missing (api_key, user_id, account_id)",
        }
        overall_ok = False

    return {
        "status": "ok" if overall_ok else "degraded",
        "checks": checks,
    }


# ── GET /api/email/health ────────────────────────────────────────────────────

@router.get("/email/health")
def email_health(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Diagnose the Nylas email/calendar integration. Checks: config present →
    API key decryptable → live API ping. Lets an admin verify the stored key
    actually works right after saving it, instead of only finding out when
    an SDR's mailbox connect fails (RCA: 2026-07-24 — stale-key mismatch
    surfaced silently at OAuth callback time).
    Safe: no secrets in response. Requires auth (any role).
    """
    config = db.query(models.NylasConfig).filter(models.NylasConfig.id == 1).first()
    if not config:
        return {"status": "error", "checks": {}, "message": "Nylas is not configured"}

    checks = {}
    overall_ok = True

    checks["client_id_present"] = _check(
        bool(config.client_id),
        f"Client ID present ({_masked(config.client_id)})",
        "Client ID missing — set it in Settings → Nylas Email Integration",
    )
    checks["api_key_present"] = _check(
        bool(config.api_key_encrypted),
        "API Key present",
        "API Key missing — set it in Settings → Nylas Email Integration",
    )
    if not (config.client_id and config.api_key_encrypted):
        checks["api_reachable"] = {"ok": False, "message": "Skipped — client ID or API key missing"}
        return {"status": "degraded", "checks": checks}

    try:
        from crypto import decrypt_token
        import httpx
        api_key = decrypt_token(config.api_key_encrypted)
        resp = httpx.get(
            "https://api.us.nylas.com/v3/applications",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        reachable = resp.status_code == 200
        checks["api_reachable"] = _check(
            reachable,
            "Nylas API reachable — key is valid",
            f"Nylas API rejected the key — HTTP {resp.status_code}",
        )
        if not reachable:
            overall_ok = False
    except Exception as e:
        checks["api_reachable"] = {"ok": False, "message": f"Could not decrypt or reach Nylas API — {e}"}
        overall_ok = False

    return {
        "status": "ok" if overall_ok else "degraded",
        "checks": checks,
    }


# ── GET /api/klenty/health ───────────────────────────────────────────────────

@router.get("/klenty/health")
def klenty_health(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Diagnose the Klenty call-activity sync integration (temporary bridge —
    see docs/RELEASES.md v10.5.0). Checks: enabled flag → api_key → live
    API ping. Lets an admin verify a real Klenty API key BEFORE flipping
    klenty_enabled on, instead of only finding out via a silent nightly
    job failure in the logs.
    Safe: no secrets in response. Requires auth (any role).
    """
    settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
    if not settings:
        return {"status": "error", "message": "SyncSettings row missing — run migrations"}

    checks = {}
    overall_ok = True

    enabled = getattr(settings, "klenty_enabled", False)
    checks["feature_enabled"] = _check(
        enabled,
        "Klenty sync is enabled",
        "Klenty sync is disabled (Settings → Klenty Sync → Enable toggle)",
    )
    if not enabled:
        overall_ok = False

    encrypted_key = getattr(settings, "klenty_api_key", None)
    checks["api_key_present"] = _check(
        bool(encrypted_key),
        "API Key present",
        "API Key missing — set the Klenty API Key in Settings → Klenty Sync",
    )
    if not encrypted_key:
        overall_ok = False

    if encrypted_key:
        try:
            from crypto import decrypt_token
            from klenty_provider import KlentyDialerProvider
            # Klenty has no account-level self-check — every call is scoped to a
            # real username. Test against the requesting admin's own Klenty
            # identity (same fallback convention the nightly sync uses per-SDR).
            db_user = db.query(models.User).filter(models.User.id == user.get("sub")).first()
            test_username = (getattr(db_user, "klenty_username", None) or user.get("email")) if db_user else user.get("email")
            provider_inst = KlentyDialerProvider(api_key=decrypt_token(encrypted_key))
            result = provider_inst.test_connection(test_username)
            checks["api_reachable"] = _check(
                result.get("success", False),
                f"Klenty API reachable — {result.get('message', 'OK')}",
                f"Klenty API unreachable — {result.get('message', 'Unknown error')}",
            )
            if not checks["api_reachable"]["ok"]:
                overall_ok = False
        except Exception as e:
            checks["api_reachable"] = {"ok": False, "message": f"API ping failed: {e}"}
            overall_ok = False
    else:
        checks["api_reachable"] = {"ok": False, "message": "Skipped — API key missing"}

    return {
        "status": "ok" if overall_ok else "degraded",
        "checks": checks,
    }
