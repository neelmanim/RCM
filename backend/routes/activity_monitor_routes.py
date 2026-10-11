# ── routes/activity_monitor_routes.py — Activity Monitor: Email + Message tabs ──
# Companion to admin_routes.py's list_call_logs (the Calls tab, left as-is).
#
# Scoping note: all three Activity Monitor channels (Calls, Email, Messages)
# scope by _pod_scope_activity_query — the sender's pod only (v14.0.0) — the
# same dual check Calls already uses, not Analytics Hub's _pod_scope_lead_query
# (lead-only). This is a deliberate divergence, not an oversight: this feature
# answers "what is my team doing" (a Pod Admin monitoring their SDRs/AEs), a
# different question from Analytics Hub's "how are my pod's leads doing"
# (lead-anchored KPI reporting) — so a Pod Admin correctly sees an email sent
# by one of their own SDRs even about a lead currently owned by another pod.
# Using one scoping style across all three channels also keeps each channel's
# summary tile counting exactly the rows its own items list can page through
# — an email-logs summary scoped differently from its own items would show a
# "Sent" count that disagreed with what a Pod Admin can actually see, the
# same class  the shared registry's `known_caveats` warn about for
# Connect Rate/Conversations sharing one threshold.
import math
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, case, or_, and_, not_, distinct
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import require_admin, check_bulk_read
from routes.analytics_routes import _effective_pod_id, _pod_scope_activity_query, _sdr_dropdown
from routes._admin_helpers import resolve_sort
from routes.lead_helpers import lead_search_clause

router = APIRouter(prefix="/api/admin", tags=["Activity Monitor"])


def _lead_name(lead):
    if not lead:
        return None
    fn, ln = (lead.first_name or "").strip(), (lead.last_name or "").strip()
    return f"{fn} {ln}".strip() or lead.email or "Unknown"


# ── Email tab ─────────────────────────────────────────────────────────────────

@router.get("/email-logs")
def list_email_logs(
    page:      int = 1,
    per_page:  int = 20,
    sdr_id:    str = None,
    direction: str = None,
    date_from: str = None,
    date_to:   str = None,
    search:    str = None,
    sort_by:   str = None,  # time | direction (prefix '-' for descending)
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Paginated email-activity view for the Activity Monitor's Email tab."""
    check_bulk_read(db, admin, per_page, "/api/admin/email-logs")
    effective_pod = _effective_pod_id(admin, None)

    # base_filters apply to BOTH the items list and every summary metric —
    # direction is deliberately kept separate (see below) since the summary's
    # sent/opened/replied each pin their own direction internally, and pinning
    # the endpoint's own `direction` display-filter into base_filters would
    # make e.g. "sent" always read 0 whenever a caller filtered to inbound.
    LEA = models.LeadEmailActivity
    base_filters = []
    if sdr_id:
        # Instantly rows have no sender (user_id NULL): attribute them to the
        # lead's assigned rep, so filtering by rep doesn't drop them.
        base_filters.append(or_(
            LEA.user_id == sdr_id,
            and_(LEA.source == "instantly", LEA.lead_id.in_(
                db.query(models.lead_assignments.c.lead_id).filter(models.lead_assignments.c.user_id == sdr_id))),
        ))
    # An Instantly open/click counter row is engagement state, not an email
    # (the real emails now have their own rows) — keep it out of the list and
    # out of "sent", but keep it in "opened".
    not_counter = not_(and_(LEA.source == "instantly", LEA.instantly_email_id.is_(None), LEA.direction == "outbound"))
    # One conversation key across providers, so Instantly replies count.
    thread_key = func.coalesce(LEA.nylas_thread_id, LEA.instantly_thread_id)

    date_start = datetime.fromisoformat(date_from).replace(tzinfo=None) if date_from else None
    date_end = datetime.fromisoformat(date_to + "T23:59:59").replace(tzinfo=None) if date_to else None
    if date_start: base_filters.append(models.LeadEmailActivity.timestamp >= date_start)
    if date_end: base_filters.append(models.LeadEmailActivity.timestamp <= date_end)

    if search:
        base_filters.append(lead_search_clause(search.strip(), extra_cols=(models.LeadEmailActivity.subject,)))

    item_filters = list(base_filters) + [not_counter]
    if direction: item_filters.append(models.LeadEmailActivity.direction == direction)

    def _scope(q, extra_filters):
        q = (
            q.outerjoin(models.Lead, models.LeadEmailActivity.lead_id == models.Lead.id)
             .outerjoin(models.User, models.LeadEmailActivity.user_id == models.User.id)
             .filter(*extra_filters, models.Lead.deleted_at.is_(None))
        )
        return _pod_scope_activity_query(q, effective_pod)

    total = _scope(db.query(func.count(models.LeadEmailActivity.id)), item_filters).scalar() or 0

    sort_columns = {"time": models.LeadEmailActivity.timestamp, "direction": models.LeadEmailActivity.direction}
    sort_col, sort_desc = resolve_sort(sort_by, sort_columns, models.LeadEmailActivity.timestamp)
    rows = (
        _scope(db.query(models.LeadEmailActivity, models.Lead, models.User), item_filters)
        .order_by(sort_col.desc() if sort_desc else sort_col.asc())
        .offset((page - 1) * per_page).limit(per_page).all()
    )

    items = []
    for email, lead, sdr in rows:
        items.append({
            "id": email.id,
            "timestamp": str(email.timestamp) if email.timestamp else None,
            "sdr_name": sdr.name if sdr else None,
            "lead_id": email.lead_id,
            "lead_name": _lead_name(lead),
            "lead_company": (lead.company or "") if lead else "",
            "direction": email.direction,
            "subject": email.subject,
            "body_preview": email.body_preview,
            "from_email": email.from_email,
            "to_email": email.to_email,
            "opened_at": email.opened_at.isoformat() if email.opened_at else None,
            "open_count": email.open_count or 0,
            "clicked_at": email.clicked_at.isoformat() if email.clicked_at else None,
            "click_count": email.click_count or 0,
            "is_auto_reply": bool(email.is_auto_reply),
            "nylas_thread_id": email.nylas_thread_id,
            "source": email.source,
        })

    # Summary — same formulas as analytics_routes.py's _compute_email_stats()
    # (sent/opened counted only on outbound rows; reply rate's denominator is
    # distinct outbound THREADS, not raw rows, so one thread with 3 outbound
    # touches and 1 reply is a 100% reply rate, not 33%), recomputed against
    # THIS endpoint's own sender-or-lead scoping so it always describes
    # exactly the population `items`/`total` above can page through.
    sent = _scope(
        db.query(func.count(models.LeadEmailActivity.id)),
        base_filters + [models.LeadEmailActivity.direction == "outbound", not_counter],
    ).scalar() or 0
    # Opens are recorded per lead (Instantly keeps them on a counter row, not on each send), so "opened" is the number
    # of different leads who opened and the rate is against the different leads emailed — never more than 100%.
    opened = _scope(db.query(func.count(distinct(LEA.lead_id))), base_filters + [LEA.direction == "outbound", LEA.opened_at.isnot(None)]).scalar() or 0
    contacted = _scope(db.query(func.count(distinct(LEA.lead_id))), base_filters + [LEA.direction == "outbound"]).scalar() or 0

    replied = _scope(
        db.query(func.count(distinct(thread_key))),
        base_filters + [models.LeadEmailActivity.direction == "inbound"],
    ).scalar() or 0

    sent_threads = _scope(
        db.query(func.count(distinct(thread_key))),
        base_filters + [models.LeadEmailActivity.direction == "outbound", not_counter],
    ).scalar() or 0

    open_rate = round(opened / contacted * 100, 1) if contacted > 0 else None
    reply_rate = round(replied / sent_threads * 100, 1) if sent_threads > 0 else None

    return {
        "items":    items,
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, math.ceil(total / per_page)) if total else 1,
        "sdrs":     _sdr_dropdown(db, effective_pod),
        "summary": {
            "sent":       sent,
            "opened":     opened,
            "replied":    replied,
            "open_rate":  open_rate,
            "reply_rate": reply_rate,
        },
    }


# ── Messages tab (SMS + WhatsApp) ────────────────────────────────────────────

@router.get("/message-logs")
def list_message_logs(
    page:      int = 1,
    per_page:  int = 20,
    sdr_id:    str = None,
    channel:   str = None,   # "sms" | "whatsapp"
    status:    str = None,   # "sent" | "delivered" | "failed" (bucketed, see below)
    direction: str = None,
    date_from: str = None,
    date_to:   str = None,
    search:    str = None,
    sort_by:   str = None,  # time | status | channel | direction (prefix '-' for descending)
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Paginated SMS/WhatsApp view for the Activity Monitor's Messages tab.

    SmsLog.status is provider-controlled free text, not a closed enum — the
    inbound-webhook path alone writes "received" and passes through whatever
    string the delivery-report payload sends (`payload.get("status", "delivered")`,
    webhook_routes.py), so a bucketed ILIKE match is used here rather than an
    exact-equality filter, mirroring list_call_logs' own status-bucketing
    idiom for the same reason (free-text provider statuses, not a fixed set).
    """
    check_bulk_read(db, admin, per_page, "/api/admin/message-logs")
    effective_pod = _effective_pod_id(admin, None)

    filters = []
    if sdr_id: filters.append(models.SmsLog.user_id == sdr_id)
    if channel: filters.append(models.SmsLog.channel == channel)
    if direction: filters.append(models.SmsLog.direction == direction)
    if status:
        _status_map = {
            "sent":      ["sent"],
            "delivered": ["deliver"],
            "failed":    ["fail"],
        }
        patterns = _status_map.get(status, [status])
        filters.append(or_(*[models.SmsLog.status.ilike(f"%{p}%") for p in patterns]))

    if date_from: filters.append(models.SmsLog.sent_at >= datetime.fromisoformat(date_from).replace(tzinfo=None))
    if date_to: filters.append(models.SmsLog.sent_at <= datetime.fromisoformat(date_to + "T23:59:59").replace(tzinfo=None))

    if search:
        filters.append(lead_search_clause(search.strip(), extra_cols=(models.SmsLog.message_text,),
                                          phone_cols=(models.SmsLog.phone_number, models.Lead.phone)))

    def _scoped(q):
        q = (
            q.outerjoin(models.User, models.SmsLog.user_id == models.User.id)
             .outerjoin(models.Lead, models.SmsLog.lead_id == models.Lead.id)
             .filter(*filters)
        )
        return _pod_scope_activity_query(q, effective_pod)

    agg = _scoped(db.query(
        func.count(models.SmsLog.id).label("total"),
        func.sum(case((models.SmsLog.direction == "outbound", 1), else_=0)).label("sent"),
        func.sum(case((models.SmsLog.status.ilike("%deliver%"), 1), else_=0)).label("delivered"),
        func.sum(case((models.SmsLog.status.ilike("%fail%"), 1), else_=0)).label("failed"),
        func.sum(case((models.SmsLog.channel == "whatsapp", 1), else_=0)).label("whatsapp_count"),
    )).one()
    total = agg.total or 0

    sort_columns = {
        "time": models.SmsLog.sent_at,
        "status": models.SmsLog.status,
        "channel": models.SmsLog.channel,
        "direction": models.SmsLog.direction,
    }
    sort_col, sort_desc = resolve_sort(sort_by, sort_columns, models.SmsLog.sent_at)
    rows = (
        _scoped(db.query(models.SmsLog, models.Lead, models.User))
        .order_by(sort_col.desc() if sort_desc else sort_col.asc())
        .offset((page - 1) * per_page).limit(per_page).all()
    )

    items = []
    for msg, lead, sdr in rows:
        items.append({
            "id": msg.id,
            "sent_at": str(msg.sent_at) if msg.sent_at else None,
            "sdr_name": sdr.name if sdr else None,
            "lead_id": msg.lead_id,
            "lead_name": _lead_name(lead),
            "lead_company": (lead.company or "") if lead else "",
            "channel": msg.channel,
            "provider": msg.provider,
            "direction": msg.direction,
            "status": msg.status,
            "phone_number": msg.phone_number,
            "message_text": msg.message_text,
            "template_name": msg.template_name,
            "failure_reason": msg.failure_reason,
            "conversation_id": msg.conversation_id,
        })

    whatsapp_count = int(agg.whatsapp_count or 0)

    return {
        "items":    items,
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, math.ceil(total / per_page)) if total else 1,
        "sdrs":     _sdr_dropdown(db, effective_pod),
        "summary": {
            "sent":           int(agg.sent or 0),
            "delivered":      int(agg.delivered or 0),
            "failed":         int(agg.failed or 0),
            "whatsapp_count": whatsapp_count,
            "sms_count":      total - whatsapp_count,
        },
    }
