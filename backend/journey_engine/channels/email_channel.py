# ── journey_engine/channels/email_channel.py ─────────────────────────────────
"""
Email channel for Sales Journey — sends via email_send.send_email(),
the shared Nylas send path also used by Email Campaigns (email_send.py),
rather than reimplementing it. That helper runs sync httpx (not AsyncClient)
since journey_engine runs on a scheduled_jobs.py threading.Timer thread, not
inside an async FastAPI request.
"""
import hashlib
import logging

import models
from journey_engine.merge_fields import apply_merge_fields as _apply_merge_fields

from .base import ChannelProvider, SendResult, sender_candidates

logger = logging.getLogger(__name__)


def _pick_variant(node_data: dict, enrollment_id: str, node_id: str) -> dict:
    """v10.9.9 — A/B testing. node_data.variants (if present) is a list of
    {key, subject, body} — the plain subject/body fields are ignored when
    variants exist. Assignment is deterministic (hash of enrollment+node,
    not random) so a retried send always lands on the same variant as the
    first attempt — no separate "assigned variant" column to keep in sync.
    Falls back to node_data itself (equivalent to a single, un-keyed variant)
    when there's no variants array for seamless backward compatibility.
    """
    variants = node_data.get("variants")
    if not variants:
        return {"key": None, "subject": node_data.get("subject", ""), "body": node_data.get("body", "")}
    digest = hashlib.sha256(f"{enrollment_id}:{node_id}".encode()).hexdigest()
    idx = int(digest, 16) % len(variants)
    variant = variants[idx]
    return {"key": variant.get("key") or str(idx), "subject": variant.get("subject", ""), "body": variant.get("body", "")}


def resolve_subject_body(node_data: dict, lead, enrollment_id: str, node_id: str, sender=None) -> dict:
    """Pure merge-field resolution, no send — shared by EmailChannelProvider.send
    (automated) and journey_engine.engine._handle_manual_email_node's 1st pass
    (manual: resolves the draft a rep reviews before approving). Variant
    assignment stays deterministic either way, so a manual step's draft and
    its eventual send never disagree on which A/B variant was shown.
    Returns {"subject", "body", "is_html", "variant_key"}."""
    variant = _pick_variant(node_data, enrollment_id, node_id or "")
    is_html = node_data.get("body_format") == "html"
    return {
        "subject": _apply_merge_fields(variant["subject"], lead, sender=sender),
        "body": _apply_merge_fields(variant["body"], lead, escape_html=is_html, sender=sender),
        "is_html": is_html,
        "variant_key": variant["key"],
    }


def _find_sender_mailbox(db, lead, journey):
    """(sender, mailbox, None) for the first sender candidate with a connected
    mailbox — the lead's rep, else the cadence owner (base.sender_candidates)
    — or (None, None, error) when nobody can send."""
    candidates = sender_candidates(db, lead, journey)
    for user in candidates:
        mailbox = db.query(models.UserMailbox).filter(
            models.UserMailbox.user_id == user.id,
            models.UserMailbox.status == "connected",
        ).first()
        if mailbox:
            if user.id != candidates[0].id:
                logger.info(f"[Cadence] {candidates[0].email} has no connected mailbox — sent as {user.email}")
            return user, mailbox, None
    names = ", ".join(u.name or u.email for u in candidates) or "the cadence owner"
    return None, None, f"No connected mailbox for {names}"


class EmailChannelProvider(ChannelProvider):
    channel_name = "email"

    def preflight(self, db, lead, journey):
        if not lead.email:
            return "Lead has no email address"
        return _find_sender_mailbox(db, lead, journey)[2]

    def send(self, db, lead, journey, node_data: dict, enrollment=None, node_id: str = None) -> SendResult:
        # Deferred, not top-level: email_send.py itself imports
        # journey_engine.channels.base.SendResult, and importing ANY submodule
        # of a package first runs that package's __init__.py — which imports
        # this file. A top-level `from email_send import send_email`
        # here closes that into a real circular import (surfaces as an
        # ImportError the moment something imports email_send.py before
        # journey_engine.channels has fully loaded, e.g. scheduled_jobs.py's
        # email-campaign scheduler in isolation). Deferring it to call time
        # breaks the cycle without changing behavior.
        from email_send import send_email

        if not lead.email:
            return SendResult(success=False, error="Lead has no email address", retryable=False)

        sender, mailbox, err = _find_sender_mailbox(db, lead, journey)
        if err:
            return SendResult(success=False, error=err, retryable=False)

        # body_format "html" = authored in the rich-text editor (v13.0.0) — merge
        # values are HTML-escaped into it and it's sent as HTML (sanitized by
        # send_email). Anything else is the original plain-text body.
        resolved = resolve_subject_body(node_data, lead, enrollment.id if enrollment else "", node_id, sender=sender)
        subject, body, is_html = resolved["subject"], resolved["body"], resolved["is_html"]

        # Engagement tracking (opens/links/thread_replies) and the
        # LeadEmailActivity write both happen inside send_email — linked
        # back to this journey/step via extra_log_fields so opened_at/
        # click_count (set later by the same Nylas webhook that already
        # tracks regular email) and reply-correlation have somewhere to land.
        # body_is_html follows the node's body_format (see above): plain text is
        # escaped, rich-text HTML is sanitized — never the other way round.
        result = send_email(db, mailbox, subject, body, lead, body_is_html=is_html, extra_log_fields={
            "journey_id": journey.id,
            "enrollment_id": enrollment.id if enrollment else None,
            "journey_node_id": node_id,
            "variant_key": resolved["variant_key"],
        })
        return SendResult(success=result.success, error=result.error, retryable=result.retryable, provider_ref=result.provider_ref)
