"""
email_utils.py — Shared email utility functions.

Centralises helpers used by both email_routes.py and webhook_routes.py
to avoid code duplication and ensure consistent behaviour.
"""
import re as _re

# Max body size stored in DB — 64 KB is enough for any real email body.
# Previously this was 200 chars (too short, caused visible truncation).
_MAX_BODY_LEN = 65536


def sanitize_preview(text: str, max_len: int = _MAX_BODY_LEN) -> str:
    """
    Store a sanitised email body for display.

    Preserves HTML structure (so the frontend can render rich email bodies
    correctly) but removes dangerous tags (script, iframe, etc.).

    Previously stripped all HTML and limited to 200 chars — that caused
    truncated bodies and broken HTML entity rendering in the Email Hub.

    Args:
        text:    Input string (HTML or plain text from Nylas).
        max_len: Hard cap on stored length (default 64 KB).

    Returns:
        Sanitised string — HTML preserved, dangerous tags removed.
    """
    if not text:
        return ""

    raw = text.strip()

    # ── Sanitise HTML (preserve safe tags, strip dangerous ones) ──────────────
    try:
        import bleach
        from bleach.sanitizer import Cleaner

        ALLOWED_TAGS = [
            'a', 'abbr', 'acronym', 'b', 'blockquote', 'br', 'caption',
            'code', 'col', 'colgroup', 'dd', 'del', 'dfn', 'div', 'dl',
            'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
            'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
            's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'table',
            'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
            'var',
        ]
        ALLOWED_ATTRS = {
            '*':    ['class', 'style', 'id', 'dir', 'lang'],
            'a':    ['href', 'title', 'target', 'rel'],
            'img':  ['src', 'alt', 'width', 'height', 'style'],
            'td':   ['colspan', 'rowspan', 'align', 'valign', 'width', 'height'],
            'th':   ['colspan', 'rowspan', 'align', 'valign', 'width', 'height'],
            'col':  ['span', 'width'],
            'colgroup': ['span'],
            'table': ['border', 'cellpadding', 'cellspacing', 'width', 'align'],
        }
        clean = bleach.clean(
            raw,
            tags=ALLOWED_TAGS,
            attributes=ALLOWED_ATTRS,
            strip=True,
            strip_comments=True,
        )
    except (ImportError, Exception):
        # bleach not installed or failed — strip only the most dangerous tags
        # but leave safe HTML intact so entities render correctly.
        clean = _re.sub(
            r'<(script|style|iframe|object|embed|form|base|meta|link)[^>]*>.*?</\1>',
            '',
            raw,
            flags=_re.IGNORECASE | _re.DOTALL,
        )
        # Also strip self-closing dangerous tags
        clean = _re.sub(
            r'<(script|style|iframe|object|embed|form|base|meta|link)[^>]*/?>',
            '',
            clean,
            flags=_re.IGNORECASE,
        )

    return clean[:max_len] if max_len and len(clean) > max_len else clean


# ── Auto-reply / out-of-office detection ──────────────────────────────────────
# Header check first (RFC 3834's Auto-Submitted, plus the common non-standard
# X-Autoreply/X-Autorespond some providers send instead) — the reliable signal
# when Nylas includes raw headers on the message object. Subject-line heuristic
# is the fallback for the (common) case where it doesn't: no single signal is
# fully reliable for this, so this is best-effort, same as any OOO detector.
_AUTO_REPLY_SUBJECT_RE = _re.compile(
    r'\b(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|'
    r'automatic response|vacation (reply|responder)|away from (the )?office|'
    r'i(’|\'| a)?m (currently )?out of (the )?office)\b',
    _re.IGNORECASE,
)


def is_auto_reply(headers: list, subject: str) -> bool:
    """
    Args:
        headers: raw message headers as Nylas returns them, a list of
                 {"name": ..., "value": ...} dicts — may be empty/absent.
        subject: the message subject line.
    """
    for h in (headers or []):
        name = (h.get("name") or "").lower()
        value = (h.get("value") or "").lower()
        if name == "auto-submitted" and value not in ("", "no"):
            return True
        if name in ("x-autoreply", "x-autorespond"):
            return True
    return bool(_AUTO_REPLY_SUBJECT_RE.search(subject or ""))
