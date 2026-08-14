# ── journey_engine/channels/email_channel.py ─────────────────────────────────
"""
Email channel for Sales Journey — wraps the existing Nylas send path
(routes/email_routes.py) rather than reimplementing it. Uses a sync httpx
client (not AsyncClient) since journey_engine runs on a scheduled_jobs.py
threading.Timer thread, not inside an async FastAPI request.
"""
import hashlib
import logging

import httpx

import models
from email_utils import sanitize_preview as _sanitize_preview
from journey_engine.merge_fields import apply_merge_fields as _apply_merge_fields
from routes.email_routes import NYLAS_API_BASE, _get_nylas_config, _get_api_key, _plain_text_to_html

from .base import ChannelProvider, SendResult

logger = logging.getLogger(__name__)


def _pick_variant(node_data: dict, enrollment_id: str, node_id: str) -> dict:
    """v10.9.9 — A/B testing. node_data.variants (if present) is a list of
    {key, subject, body} — the plain subject/body fields are ignored when
    variants exist. Assignment is deterministic (hash of enrollment+node,
    not random) so a retried send always lands on the same variant as the
    first attempt — no separate "assigned variant" column to keep in sync.
    Falls back to node_data itself (equivalent to a single, un-keyed variant)
    when there's no variants array — existing single-subject cadences need
    no migration.
    """
    variants = node_data.get("variants")
    if not variants:
        return {"key": None, "subject": node_data.get("subject", ""), "body": node_data.get("body", "")}
    digest = hashlib.sha256(f"{enrollment_id}:{node_id}".encode()).hexdigest()
    idx = int(digest, 16) % len(variants)
    variant = variants[idx]
    return {"key": variant.get("key") or str(idx), "subject": variant.get("subject", ""), "body": variant.get("body", "")}


class EmailChannelProvider(ChannelProvider):
    channel_name = "email"

    def send(self, db, lead, journey, node_data: dict, enrollment=None, node_id: str = None) -> SendResult:
        if not lead.email:
            return SendResult(success=False, error="Lead has no email address", retryable=False)

        mailbox = db.query(models.UserMailbox).filter(
            models.UserMailbox.user_id == journey.owner_id,
            models.UserMailbox.status == "connected",
        ).first()
        if not mailbox:
            return SendResult(
                success=False,
                error=f"Journey owner ({journey.owner_id}) has no connected mailbox",
                retryable=False,
            )

        try:
            config = _get_nylas_config(db)
            api_key = _get_api_key(config)
        except Exception as e:
            # _get_nylas_config/_get_api_key raise HTTPException when meant for
            # a live request — here there's no request to return it to, so
            # normalize to a SendResult. Retryable: a misconfigured/inactive
            # Nylas integration can be fixed by an admin within the retry window.
            return SendResult(success=False, error=f"Nylas not available: {e}", retryable=True)
        variant = _pick_variant(node_data, enrollment.id if enrollment else "", node_id or "")
        subject = _apply_merge_fields(variant["subject"], lead)
        body = _apply_merge_fields(variant["body"], lead)
        html_body = _plain_text_to_html(body)

        message_payload = {
            "to": [{"email": lead.email}],
            "subject": subject,
            "body": html_body,
            "custom_headers": [{"name": "X-Mailer", "value": "RCM CRM / RCM"}],
            # Engagement tracking (Gap: cadence emails had zero open/click
            # visibility — the regular compose path already requests this,
            # this channel just never did). "label" lets Nylas-side reporting
            # correlate back to the lead independent of our own DB.
            "tracking_options": {"opens": True, "links": True, "thread_replies": True, "label": lead.id},
        }
        try:
            resp = httpx.post(
                f"{NYLAS_API_BASE}/v3/grants/{mailbox.nylas_grant_id}/messages/send",
                json=message_payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                timeout=30,
            )
        except httpx.HTTPError as e:
            return SendResult(success=False, error=str(e), retryable=True)

        if 200 <= resp.status_code < 300:
            try:
                data = resp.json()
                msg_data = data.get("data", {})
                provider_ref = msg_data.get("id")
                thread_id = msg_data.get("thread_id")
            except Exception:
                provider_ref = None
                thread_id = None
            # Log the send as LeadEmailActivity, linked back to the journey —
            # without this row, opened_at/click_count (set later by the same
            # Nylas webhook handler that already tracks regular email) have
            # nothing to attach to, so a cadence email was sent but its
            # engagement was invisible everywhere. nylas_thread_id lets the
            # stats endpoint correlate a later inbound reply on this thread
            # back to this specific journey/step.
            db.add(models.LeadEmailActivity(
                lead_id=lead.id,
                user_id=journey.owner_id,
                direction="outbound",
                subject=subject,
                body_preview=_sanitize_preview(body),
                from_email=mailbox.email_address,
                to_email=lead.email,
                nylas_message_id=provider_ref,
                nylas_thread_id=thread_id,
                journey_id=journey.id,
                enrollment_id=enrollment.id if enrollment else None,
                journey_node_id=node_id,
                variant_key=variant["key"],
            ))
            db.flush()
            return SendResult(success=True, provider_ref=provider_ref)

        if resp.status_code == 429:
            return SendResult(success=False, error=f"Rate limited: {resp.text[:200]}", retryable=True)
        if 400 <= resp.status_code < 500:
            return SendResult(success=False, error=f"Nylas {resp.status_code}: {resp.text[:200]}", retryable=False)
        return SendResult(success=False, error=f"Nylas {resp.status_code}: {resp.text[:200]}", retryable=True)
