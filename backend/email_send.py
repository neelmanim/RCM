# ── email_send.py — shared "send one email via a connected Nylas mailbox" ───
"""
Extracted from journey_engine/channels/email_channel.py so Email Campaigns
doesn't become a third near-identical copy of this POST-and-log block (the
existing copy already differs from routes/email_routes.py's async /email/send
only in being sync httpx — both now share this one function). /email/send
itself stays separate: it has real extra requirements (attachments, cc/bcc,
reply-threading, async) that would only complicate this one.
"""
import logging

import httpx

import models
from email_utils import sanitize_preview as _sanitize_preview
from journey_engine.channels.base import SendResult
from routes.email_routes import (
    NYLAS_API_BASE, _get_nylas_config, _get_api_key,
    _plain_text_to_html, _compose_body_to_html,
)

logger = logging.getLogger(__name__)


def send_email(db, mailbox, subject: str, body: str, lead, *, extra_log_fields: dict = None,
               body_is_html: bool = False, include_signature: bool = True) -> SendResult:
    """Send a subject/body (already merge-field-substituted by the caller) to
    `lead.email` from `mailbox`'s connected Nylas grant. Logs a
    LeadEmailActivity row on success — `extra_log_fields` lets a caller attach
    its own linkage (journey_id/enrollment_id for Journey, campaign_id for
    Campaigns) without this function knowing about either concept. Reuses
    journey_engine's SendResult shape (success/provider_ref/error/retryable) —
    generic enough to not warrant a parallel class  own.

    `body_is_html` picks the HTML policy, and callers MUST set it to match
    where their body came from:
      - False (default): genuinely plain text, e.g. a Sales Journey cadence
        email node (a plain <textarea>). Escaped, newlines -> <br>.
      - True: real HTML from a rich-text editor, e.g. an Email Campaign body
        (RichTextEditor). Sanitized against the same allowlist inbound mail
        uses — NOT escaped.
    Getting this wrong is silently ugly rather than loud: escaping real HTML
    mails literal "<p>" tags to the recipient (the v12.2 campaign bug), and
    sanitizing plain text drops any line breaks a bare \\n was carrying.

    `include_signature` (default True) appends `mailbox.user`'s saved email
    signature (My Settings) via the same _wrap_email_body path /email/send
    already used — this shared function used to skip it entirely, so neither
    Sales Journey cadences nor Email Campaigns ever sent it. A caller (e.g.
    Email Campaigns' per-campaign toggle) can opt out; branding-footer
    suppression (User.hide_branding_in_email) is independent and always
    honored regardless of this flag."""
    if not lead.email:
        return SendResult(success=False, error="Lead has no email address", retryable=False)

    try:
        config = _get_nylas_config(db)
        api_key = _get_api_key(config)
    except Exception as e:
        # _get_nylas_config/_get_api_key raise HTTPException when meant for a
        # live request — here there's no request to return it to, so normalize
        # to a result. Retryable: a misconfigured/inactive Nylas integration
        # can be fixed by an admin within the retry window.
        return SendResult(success=False, error=f"Nylas not available: {e}", retryable=True)

    sender = mailbox.user
    hide_branding = sender.hide_branding_in_email if sender else False
    signature_html = (sender.email_signature_html or "") if (sender and include_signature) else ""

    html_body = (
        _compose_body_to_html(body, hide_branding=hide_branding, signature_html=signature_html)
        if body_is_html
        else _plain_text_to_html(body, hide_branding=hide_branding, signature_html=signature_html)
    )
    message_payload = {
        "to": [{"email": lead.email}],
        "subject": subject,
        "body": html_body,
        "custom_headers": [{"name": "X-Mailer", "value": "Alternate CRM CRM / Alternate Messenger"}],
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
        # nylas_thread_id is stored on the LeadEmailActivity row itself (not
        # returned here — no caller has needed it back from this function so
        # far); read it off that row if a future caller does.
        activity_kwargs = dict(
            lead_id=lead.id,
            user_id=mailbox.user_id,
            direction="outbound",
            subject=subject,
            body_preview=_sanitize_preview(body),
            from_email=mailbox.email_address,
            to_email=lead.email,
            nylas_message_id=provider_ref,
            nylas_thread_id=thread_id,
        )
        activity_kwargs.update(extra_log_fields or {})
        db.add(models.LeadEmailActivity(**activity_kwargs))
        db.flush()
        return SendResult(success=True, provider_ref=provider_ref)

    if resp.status_code in (401, 403):
        # Grant-level failures: mark the mailbox unhealthy so My Settings
        # stops showing "Connected" for a mailbox that cannot send.
        # email_routes' own /email/send always did this; this shared path
        # (Campaigns + cadences) never did. flush, not commit — each caller
        # commits its own per-recipient row and carries this with it.
        mailbox.status = "error"
        db.flush()
        logger.error(
            f"Nylas send {resp.status_code} for mailbox {mailbox.id} "
            f"(marked status=error): {resp.text[:300]}"
        )
        # Non-retryable: every remaining send in the batch fails identically
        # against a dead or unscoped grant, so dispatch loops stop early.
        if resp.status_code == 401:
            return SendResult(success=False, error="Mailbox connection expired — reconnect email in Settings.", retryable=False)
        return SendResult(success=False, error="Mailbox is connected but not authorized to send — reconnect email in Settings.", retryable=False)
    if resp.status_code == 429:
        return SendResult(success=False, error=f"Rate limited: {resp.text[:200]}", retryable=True)
    if 400 <= resp.status_code < 500:
        return SendResult(success=False, error=f"Nylas {resp.status_code}: {resp.text[:200]}", retryable=False)
    return SendResult(success=False, error=f"Nylas {resp.status_code}: {resp.text[:200]}", retryable=True)
