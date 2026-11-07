# ── access_notifications.py — "you've been granted access" email ──────────────
#
# Fires when a Super Admin flips a user's calling/messaging capability on via
# PATCH /api/admin/users/{id}/settings (admin_user_routes.py). Reuses
# report_service.py's existing Nylas-backed send path — no new email infra.
# See .claude/plans/i-was-working-on-idempotent-ritchie.md ("Phase 1.5").
import logging
import os

import models
from report_service import send_report_email

logger = logging.getLogger(__name__)

CAPABILITY_LABELS = {
    "dialer_enabled": "Calling",
    "sms_enabled": "SMS messaging",
    "whatsapp_enabled": "WhatsApp messaging",
    "messenger_user_id": "Alternate Messenger agent access",
}


def notify_access_granted(db, admin_user_id, target_user, capability_keys):
    """Sends target_user one email listing every capability just granted.

    No-ops (logs a warning, returns False) if the admin has no connected
    mailbox or Nylas isn't configured — that's send_report_email's existing
    behavior, not new error handling here.
    """
    if not capability_keys:
        return False
    if not target_user.email:
        logger.warning("[AccessNotify] Target user %s has no email — skipped", target_user.id)
        return False

    labels = [CAPABILITY_LABELS.get(k, k) for k in capability_keys]
    fe_url = os.getenv("FRONTEND_URL", "").strip()
    link = f"{fe_url}/index.html#my-settings" if fe_url else None

    items_html = "".join(f"<li>{label}</li>" for label in labels)
    body = f"<p>You've been granted the following access in Alternate CRM:</p><ul>{items_html}</ul>"
    if link:
        body += f'<p><a href="{link}">Open Alternate CRM &rarr;</a></p>'

    sent = send_report_email(db, admin_user_id, [target_user.email], body, "You've been granted new access in Alternate CRM")
    if not sent:
        logger.warning(
            "[AccessNotify] Could not send access-granted email to %s "
            "(admin has no connected mailbox, or Nylas not configured)",
            target_user.email,
        )
    return sent


def notify_access_granted_in_background(admin_user_id, target_user_id, capability_keys) -> None:
    """Schedule-safe wrapper: own DB session, never raises.

    RCA 2026-09-03 (pre-prod review): the grant endpoint called
    notify_access_granted() inline, unguarded, after its db.commit().
    send_report_email() POSTs to Nylas with a 30s timeout and no try/except of
    its own, so on prod this would have (a) added up to 30s to every access
    grant and (b) turned any Nylas connection error into a 500 handed to the
    admin *after* the change had already been committed — they'd see failure,
    retry, and send the user a second email. Never let a notification decide
    whether the operation it describes appears to have succeeded.

    The session here does span the Nylas POST, unlike the batch-refresh path
    in call_routes. That's a deliberate, bounded exception: grants are
    admin-initiated and rare (single digits per day), so one connection for
    the duration of one send is not pool pressure — and it avoids reshaping
    send_report_email, which the scheduled-reports path also depends on.
    """
    if not capability_keys:
        return
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            target = db.query(models.User).filter(models.User.id == target_user_id).first()
            if target:
                notify_access_granted(db, admin_user_id, target, capability_keys)
            else:
                logger.warning("[AccessNotify] Target user %s vanished before send", target_user_id)
        finally:
            db.close()
    except Exception as e:
        logger.warning("[AccessNotify] Access-granted email failed: %s", e, exc_info=True)


def notify_account_assigned(db, admin_user_id, csm_user, account) -> bool:
    """CSM Portal launch-readiness gap #4: a CSM has no reason to check the
    portal when their first account lands unless something tells them.
    Reuses send_report_email exactly like notify_access_granted above —
    same no-op-on-no-mailbox behavior, no new email infra."""
    if not csm_user.email:
        logger.warning("[AccessNotify] CSM %s has no email — skipped", csm_user.id)
        return False

    fe_url = os.getenv("FRONTEND_URL", "").strip()
    link = f"{fe_url}/index.html#csm-portal" if fe_url else None
    body = f"<p><strong>{account.name}</strong> has been assigned to you in Alternate CRM's CSM Portal.</p>"
    if link:
        body += f'<p><a href="{link}">Open CSM Portal &rarr;</a></p>'

    sent = send_report_email(db, admin_user_id, [csm_user.email], body, f"{account.name} assigned to you in Alternate CRM")
    if not sent:
        logger.warning("[AccessNotify] Could not send account-assigned email to %s", csm_user.email)
    return sent


def notify_new_access_request(db, requester_email, requester_name) -> bool:
    """A Google sign-in attempt from an email not yet in allowed_users — see
    models.AccessRequest's docstring for why this is the whole "request
    access" flow rather than a separate public form.

    RCA 2026-09-22: this used to CC every Super Admin (11 recipients on this
    org) on every single request — noisy, and nobody in particular owned
    acting on it. Sent to just the one Super Admin whose connected mailbox
    relays it; that's already the person the code has to pick to send from,
    so this is one email to one owner instead of a broadcast."""
    sender = (
        db.query(models.User)
        .join(models.UserMailbox, models.UserMailbox.user_id == models.User.id)
        .filter(models.User.role == "Super Admin", models.UserMailbox.status == "connected")
        .first()
    )
    if not sender or not sender.email:
        logger.warning(
            "[AccessNotify] No Super Admin with a connected mailbox — access request "
            "from %s recorded but not emailed", requester_email,
        )
        return False

    fe_url = os.getenv("FRONTEND_URL", "").strip()
    link = f"{fe_url}/index.html#admin" if fe_url else None
    who = requester_name or requester_email
    body = f"<p><strong>{who}</strong> ({requester_email}) just tried to sign in to Alternate CRM and isn't provisioned yet.</p>"
    if link:
        body += f'<p><a href="{link}">Add them in Team &amp; Access &rarr;</a></p>'

    sent = send_report_email(db, sender.id, [sender.email], body, f"Alternate CRM access request: {requester_email}")
    if not sent:
        logger.warning("[AccessNotify] Could not send access-request email for %s", requester_email)
    return sent


def notify_new_access_request_in_background(requester_email, requester_name) -> None:
    """Schedule-safe wrapper, same shape as the two above — own DB session,
    never raises, never blocks the OAuth redirect it's fired from."""
    try:
        from database import SessionLocal
        db = SessionLocal()
        try:
            notify_new_access_request(db, requester_email, requester_name)
        finally:
            db.close()
    except Exception as e:
        logger.warning("[AccessNotify] Access-request email failed: %s", e, exc_info=True)


def notify_account_assigned_in_background(admin_user_id, csm_user_id, account_id) -> None:
    """Schedule-safe wrapper, same shape as notify_access_granted_in_background
    — own DB session, never raises, never blocks the assignment request."""
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            csm_user = db.query(models.User).filter(models.User.id == csm_user_id).first()
            account = db.query(models.Account).filter(models.Account.id == account_id).first()
            if csm_user and account:
                notify_account_assigned(db, admin_user_id, csm_user, account)
            else:
                logger.warning("[AccessNotify] CSM %s or account %s vanished before send", csm_user_id, account_id)
        finally:
            db.close()
    except Exception as e:
        logger.warning("[AccessNotify] Account-assigned email failed: %s", e, exc_info=True)


def notify_new_inbound_lead(db, lead, is_repeat: bool = False, attribution: dict = None) -> bool:
    """Dispatches owner and team alerts for new inbound marketing inquiries (LI07).
    Fires in background after successful database commit.
    Supports email relay via connected Super Admin mailbox, plus optional Telegram bot alert
    if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are configured in environment.
    Never raises; failures do not disrupt intake acceptance.
    """
    if not lead:
        return False

    success = False
    lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or "Prospect"
    company = lead.company or "Unknown Company"
    subject = f"[{'Repeat Inquiry' if is_repeat else 'New Inbound Lead'}] {lead_name} ({company})"

    fe_url = os.getenv("FRONTEND_URL", "").strip()
    link = f"{fe_url}/index.html#leads" if fe_url else ""

    # 1. Telegram Alert (if configured)
    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    telegram_chat = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if telegram_token and telegram_chat:
        try:
            import requests
            tg_text = (
                f"🚨 *{'Repeat Website Inquiry' if is_repeat else 'New Website Lead'}*\n"
                f"• *Contact:* {lead_name}\n"
                f"• *Company:* {company}\n"
                f"• *Email:* {lead.email}\n"
                f"• *Source:* {lead.lead_source or 'Website'}\n"
            )
            if link:
                tg_text += f"• [Open in CRM]({link})\n"
            resp = requests.post(
                f"https://api.telegram.org/bot{telegram_token}/sendMessage",
                json={"chat_id": telegram_chat, "text": tg_text, "parse_mode": "Markdown"},
                timeout=5
            )
            if resp.status_code == 200:
                success = True
                logger.info(f"[InboundNotify] Dispatched Telegram alert for lead {lead.id}")
            else:
                logger.warning(f"[InboundNotify] Telegram alert responded with status {resp.status_code}")
        except Exception as tg_err:
            logger.warning(f"[InboundNotify] Telegram alert failed: {tg_err}")

    # 2. Internal Email Alert to Admin with connected mailbox
    sender = (
        db.query(models.User)
        .join(models.UserMailbox, models.UserMailbox.user_id == models.User.id)
        .filter(models.User.role.in_(["Super Admin", "Admin"]), models.UserMailbox.status == "connected")
        .first()
    )
    if sender and sender.email:
        body = (
            f"<p>A {'repeat website inquiry' if is_repeat else 'new inbound lead'} has been captured in Alternate CRM:</p>"
            f"<ul>"
            f"<li><strong>Name:</strong> {lead_name}</li>"
            f"<li><strong>Email:</strong> {lead.email}</li>"
            f"<li><strong>Company:</strong> {company}</li>"
            f"<li><strong>Source:</strong> {lead.lead_source or 'Website'}</li>"
            f"</ul>"
        )
        if link:
            body += f'<p><a href="{link}">Open Leads in Alternate CRM &rarr;</a></p>'
        try:
            sent = send_report_email(db, sender.id, [sender.email], body, subject)
            if sent:
                success = True
                logger.info(f"[InboundNotify] Sent inbound lead email alert to {sender.email}")
        except Exception as mail_err:
            logger.warning(f"[InboundNotify] Email alert failed: {mail_err}")

    return success


def notify_new_inbound_lead_in_background(lead_id: str, is_repeat: bool = False, attribution: dict = None) -> None:
    """Schedule-safe wrapper: own DB session, runs in background thread or async task."""
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
            if lead:
                notify_new_inbound_lead(db, lead, is_repeat=is_repeat, attribution=attribution)
            else:
                logger.warning("[InboundNotify] Lead %s not found for notification", lead_id)
        finally:
            db.close()
    except Exception as e:
        logger.warning("[InboundNotify] Failed to dispatch inbound notification in background: %s", e)

