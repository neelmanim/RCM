"""
error_logger.py — RCM System Error Logger

Fire-and-forget error logging that NEVER raises exceptions or blocks the caller.
Mirrors the pattern of activity_logger.py.

Key safety guarantees:
  - Entire function body wrapped in bare except → cannot crash the caller
  - Deduplication: same (category + endpoint + http_status + user_id) within
    5 minutes increments dedup_count instead of inserting a new row
  - PII stripping: emails, phone numbers, and Bearer tokens are redacted from
    raw_error before storage
  - Respects rate limit: max 10 writes per (user_id + minute) to resist storms

Usage:
    from error_logger import log_error

    log_error(
        db=db,
        severity="critical",
        source="backend",
        category="research",
        feature="AI Research",
        title="AI Research failed for {lead_name}",
        description="The AI provider returned an empty response. This can happen when the service is overloaded.",
        action_hint="Ask the SDR to click 'Run AI Research' again — it usually works on the second try.",
        http_status=503,
        endpoint="/api/ai-research",
        raw_error=str(exc),
        context_json=json.dumps({"lead_id": lead_id, "sdr_id": user_id}),
        user_id=user_id,
        user_email=user_email,
        user_name=user_name,
        user_role=user_role,
    )
"""

import hashlib
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# ── PII / secret patterns to strip from raw_error ─────────────────────────────
_REDACT_PATTERNS = [
    (re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"), "[email]"),
    (re.compile(r"\b\+?[\d\s\-().]{7,15}\b"), "[phone]"),
    (re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*"), "Bearer [token]"),
    (re.compile(r"(password|token|secret|api_key|access_token)\s*[:=]\s*\S+", re.I), r"\1=[redacted]"),
]

# ── Deduplication window (minutes) ────────────────────────────────────────────
_DEDUP_WINDOW_MINUTES = 5

# ── Per-user write rate limit (max writes per minute) ────────────────────────
_RATE_LIMIT_PER_MINUTE = 10
_rate_counters: Dict[str, Tuple[datetime, int]] = {}  # user_id → (window_start, count)


def _strip_pii(text: Optional[str]) -> Optional[str]:
    """Remove known PII patterns from a string before storing."""
    if not text:
        return text
    for pattern, replacement in _REDACT_PATTERNS:
        text = pattern.sub(replacement, text)
    return text[:4000]  # Hard cap at 4000 chars to keep DB rows lean


def _make_dedup_key(category: str, endpoint: Optional[str], http_status: Optional[int], user_id: Optional[str]) -> str:
    """Stable hash key for deduplication — does NOT include message text (too variable)."""
    raw = f"{category}|{endpoint or ''}|{http_status or ''}|{user_id or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _check_rate_limit(user_id: Optional[str]) -> bool:
    """Return True if the write is allowed (within rate limit), False if it should be dropped."""
    key = user_id or "_anon_"
    now = datetime.now(timezone.utc)
    if key in _rate_counters:
        window_start, count = _rate_counters[key]
        if (now - window_start).total_seconds() < 60:
            if count >= _RATE_LIMIT_PER_MINUTE:
                return False  # Rate limited
            _rate_counters[key] = (window_start, count + 1)
        else:
            _rate_counters[key] = (now, 1)  # New window
    else:
        _rate_counters[key] = (now, 1)
    return True


def log_error(
    db,
    *,
    severity: str = "warning",
    source: str = "backend",
    category: str = "general",
    feature: Optional[str] = None,
    title: str,
    description: Optional[str] = None,
    action_hint: Optional[str] = None,
    http_status: Optional[int] = None,
    endpoint: Optional[str] = None,
    raw_error: Optional[str] = None,
    context_json: Optional[str] = None,
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    user_name: Optional[str] = None,
    user_role: Optional[str] = None,
) -> None:
    """
    Log an error to the error_logs table.
    NEVER raises — all exceptions are swallowed silently.
    """
    try:
        import models
        from datetime import datetime, timezone

        # ── Rate limiting ──────────────────────────────────────────────────────
        if not _check_rate_limit(user_id):
            logger.debug(f"[ErrorLogger] Rate limit hit for user {user_id} — skipping log")
            return

        # ── Sanitise raw_error before storage ─────────────────────────────────
        safe_raw = _strip_pii(raw_error)

        # ── Deduplication ─────────────────────────────────────────────────────
        dedup_key = _make_dedup_key(category, endpoint, http_status, user_id)
        window_cutoff = datetime.now(timezone.utc) - timedelta(minutes=_DEDUP_WINDOW_MINUTES)

        existing = db.query(models.ErrorLog).filter(
            models.ErrorLog.dedup_key == dedup_key,
            models.ErrorLog.created_at >= window_cutoff,
            models.ErrorLog.resolved == False,
        ).order_by(models.ErrorLog.created_at.desc()).first()

        if existing:
            # Increment dedup count — don't create a new row
            existing.dedup_count = (existing.dedup_count or 1) + 1
            existing.last_seen_at = datetime.now(timezone.utc)
            db.commit()
            logger.debug(f"[ErrorLogger] Dedup hit for key={dedup_key}, count={existing.dedup_count}")
            return

        # ── Create new error log entry ─────────────────────────────────────────
        entry = models.ErrorLog(
            user_id=user_id,
            user_email=user_email,
            user_name=user_name,
            user_role=user_role,
            severity=severity,
            source=source,
            category=category,
            feature=feature,
            title=title[:512],
            description=description,
            action_hint=action_hint,
            http_status=http_status,
            endpoint=(endpoint or "")[:512],
            raw_error=safe_raw,
            context_json=context_json,
            dedup_key=dedup_key,
            dedup_count=1,
            last_seen_at=datetime.now(timezone.utc),
        )
        db.add(entry)
        db.commit()
        logger.info(f"[ErrorLogger] Logged {severity.upper()} [{category}]: {title[:80]}")

    except Exception:
        # Never let logging crash the caller — swallow everything silently
        pass


# ── Convenience wrappers ──────────────────────────────────────────────────────

def log_backend_exception(
    db,
    exc: Exception,
    *,
    category: str = "api",
    feature: Optional[str] = None,
    endpoint: Optional[str] = None,
    http_status: int = 500,
    context: Optional[dict] = None,
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    user_name: Optional[str] = None,
    user_role: Optional[str] = None,
) -> None:
    """
    Convenience wrapper for unhandled backend exceptions.
    Generates a plain-English title and description automatically.
    """
    exc_type = type(exc).__name__
    exc_msg = str(exc)

    # Map common exception types to plain English
    if "timeout" in exc_msg.lower() or "Timeout" in exc_type:
        title = f"A server operation timed out in {feature or 'the system'}"
        description = "The server took too long to respond to a request. This can happen during heavy load."
        action_hint = "This usually resolves on its own. If it keeps happening, contact your admin."
        severity = "warning"
    elif "connection" in exc_msg.lower():
        title = f"A database or network connection failed in {feature or 'the system'}"
        description = "The system couldn't connect to a required service. This is usually temporary."
        action_hint = "Wait a moment and try again. If the problem persists, contact support."
        severity = "critical"
    elif http_status == 429:
        title = f"The {feature or 'AI'} service is temporarily busy"
        description = "Too many requests were sent at once. The service needs a moment to recover."
        action_hint = "Wait 30 seconds and try again."
        severity = "warning"
    elif http_status and http_status >= 500:
        title = f"An unexpected server error occurred in {feature or 'the system'}"
        description = f"The server encountered an internal error ({exc_type}). The engineering team can review this in the technical details."
        action_hint = "Try refreshing and repeating the action. If it continues, contact support."
        severity = "critical"
    else:
        title = f"An error occurred in {feature or 'the system'}"
        description = f"Something went wrong: {exc_msg[:200]}"
        action_hint = "Try again. If the problem continues, contact your admin."
        severity = "warning"

    log_error(
        db=db,
        severity=severity,
        source="backend",
        category=category,
        feature=feature,
        title=title,
        description=description,
        action_hint=action_hint,
        http_status=http_status,
        endpoint=endpoint,
        raw_error=exc_msg,
        context_json=json.dumps(context) if context else None,
        user_id=user_id,
        user_email=user_email,
        user_name=user_name,
        user_role=user_role,
    )
