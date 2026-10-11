# ── routes/email_campaign_routes.py — Email Campaigns (bulk send) ───────────
"""
API routes for Email Campaigns — "send this email to this list of leads,
right now" bursts. Lives inside the Sales Tools surface alongside Sales
Cadence on the frontend (frontend-react/src/features/sales-tools/), but is
its own lightweight feature on the backend: NOT routed through
journey_engine.engine (see .claude/plans/i-was-working-on-idempotent-ritchie.md
for why — that engine is built for sequenced, stateful cadences, not one-shot
fan-out). Sends reuse email_send.send_email(), the same Nylas path
journey_engine's email channel uses.

- POST   /api/email-campaigns              — create + dispatch a campaign
- GET    /api/email-campaigns               — list my campaigns (paginated, optional ?status=)
- GET    /api/email-campaigns/{id}          — one campaign + its recipients
- GET    /api/email-templates                — list saved templates (org-wide, like Call Lists)
- POST   /api/email-templates                — save a template
- PUT    /api/email-templates/{id}           — edit a template (creator or Super Admin)
- DELETE /api/email-templates/{id}           — delete a template (creator or Super Admin)
- GET    /api/public/unsubscribe             — no-auth link a lead clicks in a campaign email
"""
from routes.lead_helpers import lead_allowed
import html
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import database as _database_module   # module reference, not `from database import SessionLocal` —
                                        # tests monkey-patch database.SessionLocal (see conftest.py),
                                        # and a direct name-import would bind the pre-patch object.
                                        # Mirrors journey_engine/engine.py's exact same pattern.
from database import get_db
from auth import get_current_user, create_jwt, decode_jwt, public_endpoint
from routes._admin_helpers import resolve_sort
from journey_engine.merge_fields import apply_merge_fields
from email_send import send_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Email Campaigns"])

# Matches the existing "Enroll in Cadence" bulk-action cap (journey_routes.py
# enroll(), BulkActionBar.jsx) — one learned limit for "how many leads can a
# single bulk action touch in this app," not a new number to remember.
MAX_CAMPAIGN_RECIPIENTS = 200

# A flat pacing delay between individual sends — cheap protection for the
# sender's own mailbox reputation without building journey_engine's full
# per-domain-per-hour cadence tracker for a problem this scale doesn't have
# yet (see the plan doc). Revisit only if that becomes a real need.
_SEND_PACING_SECONDS = 1.5

# Unsubscribe links never expire — a lead should always be able to opt out.
_UNSUBSCRIBE_TOKEN_EXPIRE_HOURS = 24 * 3650


# ── Helpers ───────────────────────────────────────────────────────────────────

def _skip_reason(lead) -> str:
    """The recipient status a lead should be skipped with, or None if
    eligible. Checked both at campaign creation (create_campaign) and again
    at actual dispatch time (_dispatch_campaign) — a scheduled/recurring
    campaign can sit for days before it runs, so a lead may have
    unsubscribed or lost its email in the meantime; an immediate campaign's
    recipients were just filtered a moment ago, so the second check is
    normally a no-op there."""
    if not lead.email:
        return "skipped_no_email"
    if lead.do_not_contact or lead.unsubscribed_at is not None:
        return "skipped_dnc"
    return None


def _unsubscribe_footer(lead_id: str, backend_base_url: str) -> str:
    token = create_jwt({"purpose": "campaign_unsubscribe", "lead_id": lead_id},
                        expires_hours=_UNSUBSCRIBE_TOKEN_EXPIRE_HOURS)
    link = f"{backend_base_url}/api/public/unsubscribe?token={token}"
    # HTML, not plain text: a campaign body is real rich-text HTML and is sent
    # down the sanitize (not escape) path, so a "\n\n---\n" separator here would
    # collapse to nothing and the bare URL would sit unlinked in the markup.
    return (
        '<div style="margin-top:24px;padding-top:8px;border-top:1px solid #e5e5e5;'
        'font-size:12px;color:#888;">'
        f'Don\'t want these emails? <a href="{link}">Unsubscribe</a>'
        '</div>'
    )


def _link_error(message: str) -> HTMLResponse:
    return HTMLResponse(
        f"<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h3>{message}</h3></body></html>",
        status_code=400,
    )


_EMPTY_ENGAGEMENT = {"opened": 0, "clicked": 0}


def _batch_campaign_engagement(db: Session, campaign_ids: list) -> dict:
    """Open/click counts per campaign, keyed off LeadEmailActivity.campaign_id
    (populated by webhook_routes.py's message.opened / message.link_clicked
    handlers — the same Nylas tracking Activity Monitor's Email tab already
    surfaces per-message; this just aggregates it per campaign). One GROUP BY
    query for the whole page rather than one query per campaign row."""
    if not campaign_ids:
        return {}
    rows = (
        db.query(
            models.LeadEmailActivity.campaign_id,
            func.count(models.LeadEmailActivity.opened_at).label("opened"),
            func.count(models.LeadEmailActivity.clicked_at).label("clicked"),
        )
        .filter(models.LeadEmailActivity.campaign_id.in_(campaign_ids))
        .group_by(models.LeadEmailActivity.campaign_id)
        .all()
    )
    return {r.campaign_id: {"opened": r.opened, "clicked": r.clicked} for r in rows}


def _campaign_to_dict(c: models.EmailCampaign, engagement: dict = None) -> dict:
    engagement = engagement or _EMPTY_ENGAGEMENT
    opened, clicked = engagement.get("opened", 0), engagement.get("clicked", 0)
    # Rate is against sent_count, not total_recipients — an unsent/failed/
    # skipped row was never a chance to be opened, so it would understate
    # engagement to divide by the whole recipient list.
    open_rate = round(opened / c.sent_count * 100, 1) if c.sent_count else None
    click_rate = round(clicked / c.sent_count * 100, 1) if c.sent_count else None
    return {
        "id": c.id, "name": c.name, "subject": c.subject, "body": c.body,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "status": c.status,
        "total_recipients": c.total_recipients,
        "sent_count": c.sent_count, "failed_count": c.failed_count, "skipped_count": c.skipped_count,
        "opened_count": opened, "open_rate": open_rate,
        "clicked_count": clicked, "click_rate": click_rate,
        "frequency": c.frequency,
        "scheduled_send_at": c.scheduled_send_at.isoformat() if c.scheduled_send_at else None,
        "weekday": c.weekday, "day_of_month": c.day_of_month, "timezone": c.timezone,
        "send_hour": c.send_hour, "send_minute": c.send_minute,
        "last_run_at": c.last_run_at.isoformat() if c.last_run_at else None,
    }


_RECURRING_FREQUENCIES = ("daily", "weekly", "monthly")


def _validate_schedule(schedule: dict) -> dict:
    """Validates the optional `schedule` block on POST /email-campaigns and
    returns the EmailCampaign column values to set. Raises HTTPException on
    anything invalid — a malformed schedule should never silently become
    "send immediately" or "never sends"."""
    frequency = schedule.get("frequency")
    if frequency not in ("scheduled_once",) + _RECURRING_FREQUENCIES:
        raise HTTPException(status_code=422, detail="schedule.frequency must be one of: scheduled_once, daily, weekly, monthly")

    fields = {"frequency": frequency, "timezone": schedule.get("timezone") or "UTC"}

    if frequency == "scheduled_once":
        raw = schedule.get("scheduled_send_at")
        try:
            dt = datetime.fromisoformat((raw or "").replace("Z", "+00:00"))
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="schedule.scheduled_send_at must be a valid ISO datetime")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt <= datetime.now(timezone.utc):
            raise HTTPException(status_code=422, detail="schedule.scheduled_send_at must be in the future")
        fields["scheduled_send_at"] = dt
        return fields

    # daily/weekly/monthly all need a local send time-of-day.
    send_hour = schedule.get("send_hour")
    if not isinstance(send_hour, int) or not (0 <= send_hour <= 23):
        raise HTTPException(status_code=422, detail="schedule.send_hour must be an integer 0-23")
    fields["send_hour"] = send_hour
    send_minute = schedule.get("send_minute", 0)
    if not isinstance(send_minute, int) or not (0 <= send_minute <= 59):
        raise HTTPException(status_code=422, detail="schedule.send_minute must be an integer 0-59")
    fields["send_minute"] = send_minute

    if frequency == "weekly":
        weekday = schedule.get("weekday")
        if not isinstance(weekday, int) or not (0 <= weekday <= 6):
            raise HTTPException(status_code=422, detail="schedule.weekday must be an integer 0 (Mon) - 6 (Sun)")
        fields["weekday"] = weekday
    elif frequency == "monthly":
        day_of_month = schedule.get("day_of_month")
        if not isinstance(day_of_month, int) or not (1 <= day_of_month <= 31):
            raise HTTPException(status_code=422, detail="schedule.day_of_month must be an integer 1-31")
        fields["day_of_month"] = day_of_month

    return fields


# ── Dispatch (runs as a BackgroundTask, after the response is sent) ─────────

def _dispatch_campaign(campaign_id: str, backend_base_url: str):
    """Opens its own DB session — the request's session is already closed by
    the time a BackgroundTask runs. Known limitation (see plan doc): this is
    in-process, not a durable queue — a server restart mid-campaign leaves
    remaining rows 'pending' with no automatic resume."""
    db = _database_module.SessionLocal()
    try:
        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == campaign_id).first()
        if not campaign:
            return
        mailbox = db.query(models.UserMailbox).filter(
            models.UserMailbox.user_id == campaign.created_by,
            models.UserMailbox.status == "connected",
        ).first()
        if not mailbox:
            _fail_remaining(db, campaign, "Mailbox disconnected before send could start")
            return

        pending = db.query(models.EmailCampaignRecipient).filter(
            models.EmailCampaignRecipient.campaign_id == campaign_id,
            models.EmailCampaignRecipient.status == "pending",
        ).all()

        for i, recipient in enumerate(pending):
            lead = db.query(models.Lead).filter(models.Lead.id == recipient.lead_id).first()
            if not lead:
                recipient.status = "failed"
                recipient.error = "Lead no longer exists"
                campaign.failed_count += 1
                db.commit()
                continue
            reason = _skip_reason(lead)  # re-checked live — see _skip_reason's own docstring
            if reason:
                recipient.status = reason
                campaign.skipped_count += 1
                db.commit()
                continue

            subject = apply_merge_fields(campaign.subject, lead)
            # escape_html on the body only: it is injected into real HTML, so a
            # lead whose company is "Smith & Sons <Ltd>" would otherwise emit
            # broken markup. The subject is a plain header — escaping it there
            # would mail a literal "&amp;" to the recipient.
            body = apply_merge_fields(campaign.body, lead, escape_html=True) \
                + _unsubscribe_footer(lead.id, backend_base_url)
            result = send_email(db, mailbox, subject, body, lead, body_is_html=True,
                                 include_signature=campaign.include_signature,
                                 extra_log_fields={"campaign_id": campaign.id})

            if result.success:
                recipient.status = "sent"
                recipient.sent_at = datetime.now(timezone.utc)
                campaign.sent_count += 1
            else:
                recipient.status = "failed"
                recipient.error = result.error
                campaign.failed_count += 1
            db.commit()

            if not result.success and not result.retryable and result.error and "expired" in result.error.lower():
                # Grant died mid-campaign (401) — every remaining send would
                # fail the same way against a dead grant. Stop and mark the
                # rest failed with a clear, shared reason rather than
                # hammering Nylas once per remaining recipient.
                _fail_remaining(db, campaign, "Mailbox connection expired mid-campaign — reconnect email in Settings.")
                return

            if i < len(pending) - 1:
                time.sleep(_SEND_PACING_SECONDS)

        _finalize_status(campaign)
        db.commit()
    except Exception:
        logger.exception(f"[EmailCampaign] Dispatch failed for campaign {campaign_id}")
    finally:
        db.close()


def _finalize_status(campaign: models.EmailCampaign):
    """A recurring campaign (daily/weekly/monthly) goes back to 'scheduled'
    so it stays eligible for its next occurrence — everything else
    (immediate or scheduled_once) is done for good once it completes."""
    campaign.status = "scheduled" if campaign.frequency in _RECURRING_FREQUENCIES else "completed"


def _fail_remaining(db: Session, campaign: models.EmailCampaign, reason: str):
    remaining = db.query(models.EmailCampaignRecipient).filter(
        models.EmailCampaignRecipient.campaign_id == campaign.id,
        models.EmailCampaignRecipient.status == "pending",
    ).all()
    for r in remaining:
        r.status = "failed"
        r.error = reason
        campaign.failed_count += 1
    _finalize_status(campaign)
    db.commit()


def _reset_recipients_for_rerun(db: Session, campaign: models.EmailCampaign):
    """Called by the scheduler right before a recurring campaign's next
    occurrence fires — every past occurrence's recipient rows go back to
    'pending' so _dispatch_campaign's live DNC/email re-check (above)
    decides each one fresh, rather than replaying a stale skip/sent/failed
    reason from a previous run."""
    db.query(models.EmailCampaignRecipient).filter(
        models.EmailCampaignRecipient.campaign_id == campaign.id,
    ).update({"status": "pending", "error": None, "sent_at": None})
    campaign.sent_count = 0
    campaign.failed_count = 0
    campaign.skipped_count = 0
    db.commit()


# ── Campaigns ─────────────────────────────────────────────────────────────────

@router.post("/email-campaigns")
def create_campaign(request: Request, body: dict, background_tasks: BackgroundTasks,
                     db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    name = (body.get("name") or "").strip()
    lead_ids = body.get("lead_ids") or []
    template_id = body.get("template_id")
    subject = (body.get("subject") or "").strip()
    email_body = (body.get("body") or "").strip()

    if not lead_ids:
        raise HTTPException(status_code=422, detail="lead_ids is required")
    if len(lead_ids) > MAX_CAMPAIGN_RECIPIENTS:
        raise HTTPException(status_code=400,
                             detail=f"A single campaign supports up to {MAX_CAMPAIGN_RECIPIENTS} leads — narrow your selection and send another.")

    if template_id:
        template = db.query(models.EmailTemplate).filter(models.EmailTemplate.id == template_id).first()
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        subject = subject or template.subject
        email_body = email_body or template.body
    if not subject and not email_body:
        raise HTTPException(status_code=422, detail="Subject or body is required")
    if not name:
        name = subject[:80] or "Untitled campaign"

    mailbox = db.query(models.UserMailbox).filter(
        models.UserMailbox.user_id == user.get("sub"),
        models.UserMailbox.status == "connected",
    ).first()
    if not mailbox:
        raise HTTPException(status_code=400, detail="No connected mailbox. Please connect your email first.")

    # Absent -> immediate send (existing v1 behavior, unchanged). Present ->
    # the scheduler (scheduled_jobs.py::_scheduled_email_campaign_job) picks
    # this up later; recipient rows are still built now, same as immediate.
    schedule = body.get("schedule")
    schedule_fields = _validate_schedule(schedule) if schedule else {}

    include_signature = body.get("include_signature")
    if include_signature is None:
        include_signature = True
    elif not isinstance(include_signature, bool):
        raise HTTPException(status_code=422, detail="include_signature must be a boolean")

    campaign = models.EmailCampaign(
        name=name, subject=subject, body=email_body,
        created_by=user.get("sub"), status="scheduled" if schedule else "running",
        include_signature=include_signature,
        **schedule_fields,
    )
    db.add(campaign)
    db.flush()

    skipped = []
    queued_leads = []
    for lead_id in lead_ids:
        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
        # Emailing a lead is a change to it; a lead the sender may not change
        # is skipped exactly like a missing one (don't confirm it exists).
        if not lead or not lead_allowed(user, lead, edit=True):
            skipped.append({"lead_id": lead_id, "reason": "lead_not_found"})
            continue
        reason = _skip_reason(lead)
        if reason:
            db.add(models.EmailCampaignRecipient(campaign_id=campaign.id, lead_id=lead_id, status=reason))
            skipped.append({"lead_id": lead_id, "reason": reason})
            continue
        db.add(models.EmailCampaignRecipient(campaign_id=campaign.id, lead_id=lead_id, status="pending"))
        queued_leads.append(lead_id)

    campaign.total_recipients = len(lead_ids)
    campaign.skipped_count = len(skipped)
    if not queued_leads:
        campaign.status = "completed"  # nothing eligible to send — don't leave it stuck "scheduled"/"running"
    db.commit()

    if queued_leads and not schedule:
        backend_base_url = str(request.base_url).rstrip("/")
        background_tasks.add_task(_dispatch_campaign, campaign_id=campaign.id, backend_base_url=backend_base_url)

    return {
        "campaign_id": campaign.id,
        "requested": len(lead_ids),
        "queued": len(queued_leads),
        "skipped": skipped,
    }


def _scope_campaigns_query(query, user: dict, mine: bool, created_by: Optional[str], db: Session):
    """Who can see whose campaigns. Non-admins keep the original "sent from
    your own mailbox" model (you can't see another SDR's compose history
    either) — always self-scoped, `mine`/`created_by` are admin-only knobs.
    Pod Admin defaults to their own pod's reps, org-wide only on request
    (there's no per-pod ambiguity to reject the way Analytics' rep filter
    does — `created_by` here is validated against the same pod query, not
    trusted blindly)."""
    role = user.get("role")
    my_id = user.get("sub")
    if role not in ("Super Admin", "Pod Admin"):
        return query.filter(models.EmailCampaign.created_by == my_id)
    if mine:
        return query.filter(models.EmailCampaign.created_by == my_id)
    if role == "Pod Admin":
        pod_id = user.get("pod_id")
        pod_user_ids = [
            u.id for u in db.query(models.User.id).filter(models.User.pod_id == pod_id).all()
        ] if pod_id else []
        if created_by:
            return query.filter(
                models.EmailCampaign.created_by == created_by,
                models.EmailCampaign.created_by.in_(pod_user_ids),
            )
        return query.filter(models.EmailCampaign.created_by.in_(pod_user_ids))
    # Super Admin, no mine/created_by: org-wide.
    if created_by:
        return query.filter(models.EmailCampaign.created_by == created_by)
    return query


def _creator_names(db: Session, campaigns) -> dict:
    creator_ids = {c.created_by for c in campaigns if c.created_by}
    if not creator_ids:
        return {}
    return {
        u.id: (u.name or u.email or "")
        for u in db.query(models.User).filter(models.User.id.in_(creator_ids)).all()
    }


@router.get("/email-campaigns")
def list_campaigns(
    status: str = None, page: int = 1, per_page: int = 20,
    mine: bool = Query(False, description="Admins only: narrow to campaigns you created yourself"),
    created_by: Optional[str] = Query(None, description="Admins only: campaigns created by this user"),
    sort_by: Optional[str] = Query(
        None, description="name | created_at | sent | failed | skipped (prefix '-' for descending)"
    ),
    db: Session = Depends(get_db), user: dict = Depends(get_current_user),
):
    query = _scope_campaigns_query(db.query(models.EmailCampaign), user, mine, created_by, db)
    if status:
        query = query.filter(models.EmailCampaign.status == status)
    # Opens/clicks are computed post-pagination from a separate engagement
    # bulk query (below) — not sortable without restructuring the whole
    # query, same lazy-but-correct call as Lead Activity's own sort_by.
    sort_columns = {
        "name": models.EmailCampaign.name,
        "created_at": models.EmailCampaign.created_at,
        "sent": models.EmailCampaign.sent_count,
        "failed": models.EmailCampaign.failed_count,
        "skipped": models.EmailCampaign.skipped_count,
    }
    sort_col, sort_desc = resolve_sort(sort_by, sort_columns, models.EmailCampaign.created_at)
    query = query.order_by(sort_col.desc() if sort_desc else sort_col.asc())

    total = query.count()
    per_page = max(1, min(per_page, 100))
    pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, pages))
    campaigns = query.offset((page - 1) * per_page).limit(per_page).all()
    engagement = _batch_campaign_engagement(db, [c.id for c in campaigns])
    creator_names = _creator_names(db, campaigns)

    return {
        "campaigns": [
            {
                **_campaign_to_dict(c, engagement.get(c.id)),
                "created_by": c.created_by,
                "created_by_name": creator_names.get(c.created_by) or "Unknown",
                "is_mine": c.created_by == user.get("sub"),
            }
            for c in campaigns
        ],
        "total": total, "page": page, "pages": pages, "per_page": per_page,
    }


@router.get("/email-campaigns/{campaign_id}")
def get_campaign(campaign_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    campaign = _scope_campaigns_query(
        db.query(models.EmailCampaign).filter(models.EmailCampaign.id == campaign_id),
        user, mine=False, created_by=None, db=db,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    recipients = db.query(models.EmailCampaignRecipient).filter(
        models.EmailCampaignRecipient.campaign_id == campaign_id
    ).all()
    lead_ids = [r.lead_id for r in recipients]
    leads_by_id = {l.id: l for l in db.query(models.Lead).filter(models.Lead.id.in_(lead_ids)).all()} if lead_ids else {}

    # Per-recipient open/click, keyed by lead_id — a rerun (_reset_recipients_
    # for_rerun) can leave more than one LeadEmailActivity row per lead for
    # this campaign, so take the most recently sent one rather than summing;
    # summing would double-count a lead who was legitimately re-sent to.
    activities = db.query(models.LeadEmailActivity).filter(
        models.LeadEmailActivity.campaign_id == campaign_id
    ).order_by(models.LeadEmailActivity.timestamp.desc()).all() if lead_ids else []
    activity_by_lead = {}
    for a in activities:
        activity_by_lead.setdefault(a.lead_id, a)

    engagement = _batch_campaign_engagement(db, [campaign_id]).get(campaign_id)
    creator_name = _creator_names(db, [campaign]).get(campaign.created_by) or "Unknown"

    return {
        **_campaign_to_dict(campaign, engagement),
        "created_by": campaign.created_by,
        "created_by_name": creator_name,
        "is_mine": campaign.created_by == user.get("sub"),
        "recipients": [
            {
                "lead_id": r.lead_id,
                "lead_name": f"{leads_by_id[r.lead_id].first_name or ''} {leads_by_id[r.lead_id].last_name or ''}".strip()
                             if r.lead_id in leads_by_id else None,
                "lead_email": leads_by_id[r.lead_id].email if r.lead_id in leads_by_id else None,
                "status": r.status, "error": r.error,
                "sent_at": r.sent_at.isoformat() if r.sent_at else None,
                "opened": bool(activity_by_lead[r.lead_id].opened_at) if r.lead_id in activity_by_lead else False,
                "clicked": bool(activity_by_lead[r.lead_id].clicked_at) if r.lead_id in activity_by_lead else False,
            }
            for r in recipients
        ],
    }


def _require_owner_or_super_admin(created_by: str, user: dict, action: str):
    """Creator-or-Super-Admin gate, shared by every write on a
    user-authored EmailCampaign/EmailTemplate row (rename_campaign,
    update_template, delete_template) — previously copy-pasted at each
    call site."""
    if created_by != user.get("sub") and user.get("role") != "Super Admin":
        raise HTTPException(status_code=403, detail=f"Only the creator or a Super Admin can {action} this")


@router.patch("/email-campaigns/{campaign_id}")
def rename_campaign(campaign_id: str, body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Rename only — subject/body/recipients are a historical record of what
    was actually sent (see EmailCampaign's docstring) and stay immutable."""
    campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    _require_owner_or_super_admin(campaign.created_by, user, "rename")

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")

    campaign.name = name
    db.commit()
    return {"id": campaign.id, "name": campaign.name}


# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/email-templates")
def list_templates(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    # Org-wide-visible, same idiom as Call Lists (models.CallList) — a
    # template is a shared shortcut for the team, not a private draft.
    templates = db.query(models.EmailTemplate).order_by(models.EmailTemplate.created_at.desc()).all()

    # created_by/created_by_name are returned so the UI can gate Edit the same
    # way Delete is gated (both are creator-or-Super-Admin below) and show who
    # owns a shared template. Without them the frontend offered everyone an
    # Edit button that 403'd only on save. One batched lookup, not per-row.
    owner_ids = {t.created_by for t in templates if t.created_by}
    owner_names = {}
    if owner_ids:
        owner_names = {
            u.id: (u.name or u.email or "")
            for u in db.query(models.User).filter(models.User.id.in_(owner_ids)).all()
        }

    return {"templates": [
        {"id": t.id, "name": t.name, "subject": t.subject, "body": t.body,
         "created_at": t.created_at.isoformat() if t.created_at else None,
         "created_by": t.created_by,
         "created_by_name": owner_names.get(t.created_by) or "Unknown",
         # The one place this rule lives for the UI — it must stay in step with
         # the identical checks in update_template/delete_template below.
         "can_edit": t.created_by == user.get("sub") or user.get("role") == "Super Admin"}
        for t in templates
    ]}


@router.post("/email-templates")
def create_template(body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    name = (body.get("name") or "").strip()
    subject = (body.get("subject") or "").strip()
    email_body = (body.get("body") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")
    if not subject and not email_body:
        raise HTTPException(status_code=422, detail="Subject or body is required")

    template = models.EmailTemplate(name=name, subject=subject, body=email_body, created_by=user.get("sub"))
    db.add(template)
    db.commit()
    return {"id": template.id, "name": template.name, "subject": template.subject, "body": template.body}


@router.put("/email-templates/{template_id}")
def update_template(template_id: str, body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    template = db.query(models.EmailTemplate).filter(models.EmailTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    _require_owner_or_super_admin(template.created_by, user, "edit")

    name = (body.get("name") or "").strip()
    subject = (body.get("subject") or "").strip()
    email_body = (body.get("body") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")
    if not subject and not email_body:
        raise HTTPException(status_code=422, detail="Subject or body is required")

    template.name, template.subject, template.body = name, subject, email_body
    db.commit()
    return {"id": template.id, "name": template.name, "subject": template.subject, "body": template.body}


@router.delete("/email-templates/{template_id}")
def delete_template(template_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    template = db.query(models.EmailTemplate).filter(models.EmailTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    _require_owner_or_super_admin(template.created_by, user, "delete")
    db.delete(template)
    db.commit()
    return {"message": "Template deleted"}


# ── Public unsubscribe link (no auth — clicked from inside a sent email) ────

def _unsubscribe_lead(token: str):
    """Decode the unsubscribe token -> (lead_id, None) or (None, error response)."""
    try:
        payload = decode_jwt(token)
    except HTTPException:
        return None, _link_error("This unsubscribe link is invalid or has expired.")
    if payload.get("purpose") != "campaign_unsubscribe" or not payload.get("lead_id"):
        return None, _link_error("This unsubscribe link is invalid.")
    return payload["lead_id"], None


@router.get("/public/unsubscribe", dependencies=[Depends(public_endpoint)])
def unsubscribe_confirm(token: str):
    """The link in the email. It only ASKS: mail-security scanners and link previewers
    follow every link with a GET, and when this GET unsubscribed the lead, they
    unsubscribed people (and took them out of cadences) seconds after delivery."""
    _, error = _unsubscribe_lead(token)
    if error:
        return error
    return HTMLResponse(
        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'>"
        "<h3>Unsubscribe from these emails?</h3>"
        f"<form method='post' action='/api/public/unsubscribe?token={html.escape(token, quote=True)}'>"
        "<button type='submit' style='font-size:16px;padding:10px 24px;cursor:pointer'>Yes, unsubscribe me</button>"
        "</form></body></html>"
    )


@router.post("/public/unsubscribe", dependencies=[Depends(public_endpoint)])
def unsubscribe(token: str, db: Session = Depends(get_db)):
    lead_id, error = _unsubscribe_lead(token)
    if error:
        return error
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if lead and lead.unsubscribed_at is None:
        lead.unsubscribed_at = datetime.now(timezone.utc)
        from journey_engine.engine import exit_active_enrollments
        exit_active_enrollments(db, lead.id, "unsubscribed")
        db.commit()

    # Second click on an already-used link, or a lead that no longer exists,
    # is a harmless no-op — always show the same confirmation, never an error.
    return HTMLResponse(
        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'>"
        "<h3>You've been unsubscribed and won't receive further emails from us.</h3></body></html>"
    )
