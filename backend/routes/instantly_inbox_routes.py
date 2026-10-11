# ── routes/instantly_inbox_routes.py — Instantly replies inbox + report (v13.8.0) ──
"""A team-wide view of the emails Instantly sends and the replies it gets.

The rows come from `_instantly_mail_sync_job` (scheduled_jobs.py): one
`lead_email_activity` row per real Instantly email, keyed on Instantly's email
id. Opens/clicks live on separate counter rows (no email id) and are only
joined in for the report's open/click columns.

Visibility: every query is restricted IN SQL, before ordering/paging, to
`visible_leads(actor)` — Super Admin all, Pod Admin their pod, SDR/AE the
leads assigned to them. Never post-filter a page. CSM has no access.
"""
import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, distinct, exists, func, or_
from sqlalchemy.orm import Session, aliased

import models
from auth import require_admin_or_ae
from database import get_db
from domain.actor import Actor
from domain.lead_access import visible_leads
from routes.lead_helpers import lead_search_clause

router = APIRouter(prefix="/api/instantly", tags=["Instantly inbox"])

LEA = models.LeadEmailActivity
# Instantly lead labels that count as a positive reply (the lead's CURRENT
# label — it can change after the reply; the UI says so).
POSITIVE_LABELS = ("interested", "meeting booked", "meeting completed", "won")
MAX_PER_PAGE = 100
REPORT_GROUPS = ("cadence", "step", "mailbox", "rep")


# ── helpers ──────────────────────────────────────────────────────────────────

def _day_start(value: str):
    try:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"Invalid date: {value!r} (use YYYY-MM-DD)")


def _window(date_from, date_to):
    """(start, end) from optional YYYY-MM-DD dates; `end` is exclusive (the day after `date_to`)."""
    return (_day_start(date_from) if date_from else None,
            (_day_start(date_to) + timedelta(days=1)) if date_to else None)


def _campaigns_of(db, journey_id):
    return [r[0] for r in db.query(models.JourneyInstantlyCampaign.instantly_campaign_id).filter(
        models.JourneyInstantlyCampaign.journey_id == journey_id).all()]


def _base(db, actor, *entities, counters=False):
    """Instantly rows on leads the actor may see, joined to the lead: the real
    emails by default, or (counters=True) the open/click counter rows that
    have no email id."""
    q = db.query(*(entities or (LEA,))).select_from(LEA).join(models.Lead, LEA.lead_id == models.Lead.id).filter(
        LEA.source == "instantly",
        LEA.lead_id.in_(visible_leads(db, actor).with_entities(models.Lead.id).subquery()),
    )
    q = q.filter(LEA.instantly_email_id.is_(None), LEA.direction == "outbound") if counters \
        else q.filter(LEA.instantly_email_id.isnot(None))
    return models.exclude_test_leads(q, LEA)


def _apply_filters(db, q, *, journey_id=None, rep_id=None, mailbox=None, start=None, end=None):
    if journey_id:
        q = q.filter(LEA.instantly_campaign_id.in_(_campaigns_of(db, journey_id) or [""]))
    if rep_id:
        q = q.filter(LEA.lead_id.in_(
            db.query(models.lead_assignments.c.lead_id).filter(models.lead_assignments.c.user_id == rep_id)))
    if mailbox:
        q = q.filter(LEA.instantly_eaccount == mailbox)
    if start is not None:
        q = q.filter(LEA.timestamp >= start)
    if end is not None:
        q = q.filter(LEA.timestamp < end)
    return q


def _is_real_reply():
    return and_(LEA.direction == "inbound", or_(LEA.is_auto_reply.is_(None), LEA.is_auto_reply.is_(False)))


def _positive():
    return func.lower(func.coalesce(models.Lead.instantly_interest_label, "")).in_(POSITIVE_LABELS)


def _rate(num, den):
    return round(num / den * 100, 1) if den else None


def _contacted_in_window(start, end):
    """The reply's lead was emailed in the same campaign inside the window — so
    a reply rate is "of the leads we contacted, how many replied" and can never
    pass 100% (a lead emailed 40 days ago who replies today is not in a 30-day cohort)."""
    sent = aliased(LEA)
    cond = [sent.lead_id == LEA.lead_id, sent.direction == "outbound", sent.instantly_email_id.isnot(None),
            sent.instantly_campaign_id == LEA.instantly_campaign_id]
    if start is not None:
        cond.append(sent.timestamp >= start)
    if end is not None:
        cond.append(sent.timestamp < end)
    return exists().where(and_(*cond))


def _aggregates(db, actor, group_cols=(), outer=None, **filters):
    """sent / contacted / replied / positive per group (one row when no groups).
    `outer` = (selectable, onclause) to outer-join for a group column that lives elsewhere."""
    replied = and_(_is_real_reply(), _contacted_in_window(filters.get("start"), filters.get("end")))
    cols = [
        func.count(case((LEA.direction == "outbound", 1))).label("sent"),
        func.count(distinct(case((LEA.direction == "outbound", LEA.lead_id)))).label("contacted"),
        func.count(distinct(case((replied, LEA.lead_id)))).label("replied"),
        func.count(distinct(case((and_(replied, _positive()), LEA.lead_id)))).label("positive"),
    ]
    q = _base(db, actor, *group_cols, *cols)
    if outer is not None:
        q = q.outerjoin(*outer)
    q = _apply_filters(db, q, **filters)
    return q.group_by(*group_cols).all() if group_cols else q.all()


def _engagement(db, actor, group_col=None, outer=None, **filters):
    """Opens/clicks from the counter rows: distinct leads per group. Counter rows
    carry no mailbox, so a mailbox filter can't apply to them."""
    cols = [
        func.count(distinct(case((LEA.opened_at.isnot(None), LEA.lead_id)))).label("opens"),
        func.count(distinct(case((LEA.clicked_at.isnot(None), LEA.lead_id)))).label("clicks"),
    ]
    q = _base(db, actor, *([group_col] if group_col is not None else []), *cols, counters=True)
    if outer is not None:
        q = q.outerjoin(*outer)
    q = _apply_filters(db, q, **{k: v for k, v in filters.items() if k != "mailbox"})
    return q.group_by(group_col).all() if group_col is not None else q.all()


def _totals(db, actor, **filters):
    a = _aggregates(db, actor, **filters)[0]
    e = _engagement(db, actor, **filters)[0] if not filters.get("mailbox") else None
    return {
        "sent": a.sent or 0, "contacted": a.contacted or 0, "replied": a.replied or 0, "positive": a.positive or 0,
        "reply_rate": _rate(a.replied or 0, a.contacted or 0), "positive_rate": _rate(a.positive or 0, a.replied or 0),
        "opens": e.opens if e else None, "clicks": e.clicks if e else None,
    }


def _journey_by_campaign(db, campaign_ids):
    ids = [c for c in set(campaign_ids) if c]
    if not ids:
        return {}, {}
    mapping = {r.instantly_campaign_id: r.journey_id for r in db.query(models.JourneyInstantlyCampaign).filter(
        models.JourneyInstantlyCampaign.instantly_campaign_id.in_(ids)).all()}
    names = {j.id: j.name for j in db.query(models.Journey.id, models.Journey.name).filter(
        models.Journey.id.in_(set(mapping.values()))).all()} if mapping else {}
    return mapping, names


def _reps_by_lead(db, lead_ids):
    """One rep per lead (lowest user id, so it is stable): {lead_id: (id, name)}."""
    ids = list(set(lead_ids))
    if not ids:
        return {}
    rows = db.query(models.lead_assignments.c.lead_id, models.User.id, models.User.name, models.User.email).join(
        models.User, models.User.id == models.lead_assignments.c.user_id).filter(
        models.lead_assignments.c.lead_id.in_(ids)).order_by(models.User.id).all()
    out = {}
    for lead_id, uid, name, email in rows:
        out.setdefault(lead_id, (uid, name or email))
    return out


def _lead_name(lead):
    return f"{lead.first_name or ''} {lead.last_name or ''}".strip() or lead.email or "Unknown"


def _iso(dt):
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def _item(row, lead, journey_by_campaign, journey_names, reps):
    jid = journey_by_campaign.get(row.instantly_campaign_id)
    rep = reps.get(row.lead_id)
    label = lead.instantly_interest_label
    return {
        "id": row.id, "lead_id": row.lead_id, "lead_name": _lead_name(lead), "lead_company": lead.company,
        "subject": row.subject, "snippet": " ".join((row.body_preview or "").split())[:160],
        "from_email": row.from_email, "mailbox": row.instantly_eaccount or row.to_email,
        "timestamp": _iso(row.timestamp), "unread": row.read_at is None, "is_auto_reply": bool(row.is_auto_reply),
        "intent_label": label, "positive": (label or "").lower() in POSITIVE_LABELS,
        "journey_id": jid, "journey_name": journey_names.get(jid), "step": None if row.instantly_step is None else row.instantly_step + 1,
        "rep_id": rep[0] if rep else None, "rep_name": rep[1] if rep else None,
    }


def _filter_options(db, actor):
    if actor.is_super_admin:
        users = db.query(models.User).filter(models.User.role.in_(["SDR", "AE", "Pod Admin"]))
    elif actor.is_pod_admin and actor.pod_id:
        users = db.query(models.User).filter(models.User.pod_id == actor.pod_id)
    else:
        users = db.query(models.User).filter(models.User.id == actor.id)
    return [{"id": u.id, "name": u.name or u.email} for u in users.order_by(models.User.name).limit(500).all()]


# ── routes ───────────────────────────────────────────────────────────────────

@router.get("/filters")
def reply_filters(db: Session = Depends(get_db), user: dict = Depends(require_admin_or_ae)):
    actor = Actor.from_claims(user)
    journeys = db.query(models.Journey.id, models.Journey.name).filter(models.Journey.id.in_(
        db.query(models.JourneyInstantlyCampaign.journey_id))).order_by(models.Journey.name).all()
    mailboxes = [r[0] for r in _base(db, actor, LEA.instantly_eaccount).filter(
        LEA.instantly_eaccount.isnot(None)).distinct().order_by(LEA.instantly_eaccount).limit(200).all()]
    intents = [r[0] for r in _base(db, actor, models.Lead.instantly_interest_label).filter(
        _is_real_reply(), models.Lead.instantly_interest_label.isnot(None)).distinct().limit(50).all()]
    return {"journeys": [{"id": j.id, "name": j.name} for j in journeys], "reps": _filter_options(db, actor),
            "mailboxes": mailboxes, "intents": sorted(intents)}


@router.get("/replies")
def list_replies(
    page: int = 1, per_page: int = 25, journey_id: str = None, rep_id: str = None, mailbox: str = None,
    intent: str = None, status: str = None, search: str = None, sort: str = "newest",
    include_auto: bool = False, date_from: str = Query(None, alias="from"), date_to: str = Query(None, alias="to"),
    db: Session = Depends(get_db), user: dict = Depends(require_admin_or_ae),
):
    actor = Actor.from_claims(user)
    page = max(page, 1)
    per_page = min(max(per_page, 1), MAX_PER_PAGE)
    start, end = _window(date_from, date_to)
    filters = dict(journey_id=journey_id, rep_id=rep_id, mailbox=mailbox, start=start, end=end)

    def scoped(*entities):
        q = _apply_filters(db, _base(db, actor, *entities).filter(LEA.direction == "inbound"), **filters)
        if not include_auto:
            q = q.filter(_is_real_reply())
        if intent:
            q = q.filter(models.Lead.instantly_interest_label == intent)
        if search:
            q = q.filter(lead_search_clause(search.strip(), extra_cols=(LEA.subject,)))
        return q

    listing = scoped(LEA, models.Lead)
    if status == "unread":
        listing = listing.filter(LEA.read_at.is_(None))
    elif status == "read":
        listing = listing.filter(LEA.read_at.isnot(None))
    total = listing.count()
    order = LEA.timestamp.asc() if sort == "oldest" else LEA.timestamp.desc()
    rows = listing.order_by(order, LEA.id).offset((page - 1) * per_page).limit(per_page).all()

    mapping, names = _journey_by_campaign(db, [r.instantly_campaign_id for r, _ in rows])
    reps = _reps_by_lead(db, [r.lead_id for r, _ in rows])
    totals = _totals(db, actor, **filters)
    summary = {
        "replies": total, "sent": totals["sent"], "reply_rate": totals["reply_rate"],
        "positive": scoped(func.count(distinct(LEA.lead_id))).filter(_positive()).scalar() or 0,
        "unread": scoped(func.count(LEA.id)).filter(LEA.read_at.is_(None)).scalar() or 0,
    }
    return {
        "items": [_item(r, lead, mapping, names, reps) for r, lead in rows],
        "total": total, "page": page, "per_page": per_page, "pages": max(1, math.ceil(total / per_page)),
        "summary": summary,
    }


def _visible_email(db, actor, activity_id):
    row = _base(db, actor, LEA, models.Lead).filter(LEA.id == activity_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Reply not found")   # same answer whether it exists or not
    return row


@router.get("/replies/{activity_id}")
def get_reply(activity_id: str, db: Session = Depends(get_db), user: dict = Depends(require_admin_or_ae)):
    actor = Actor.from_claims(user)
    row, lead = _visible_email(db, actor, activity_id)
    mapping, names = _journey_by_campaign(db, [row.instantly_campaign_id])
    reps = _reps_by_lead(db, [row.lead_id])
    earlier = db.query(LEA).filter(
        LEA.lead_id == row.lead_id, LEA.source == "instantly", LEA.instantly_email_id.isnot(None), LEA.id != row.id,
        LEA.timestamp <= row.timestamp,
        (LEA.instantly_thread_id == row.instantly_thread_id) if row.instantly_thread_id
        else (LEA.instantly_campaign_id == row.instantly_campaign_id),
    ).order_by(LEA.timestamp.desc()).limit(20).all()[::-1]
    return {
        **_item(row, lead, mapping, names, reps), "body": row.body_preview or "", "to_email": row.to_email,
        "thread": [{"id": m.id, "direction": m.direction, "subject": m.subject, "body": m.body_preview or "",
                    "timestamp": _iso(m.timestamp), "from_email": m.from_email, "to_email": m.to_email} for m in earlier],
    }


@router.patch("/replies/{activity_id}/read")
def mark_reply_read(activity_id: str, body: dict, db: Session = Depends(get_db), user: dict = Depends(require_admin_or_ae)):
    """`read_at` is one column per row, shared with the notification bell — so it
    is the lead's rep's state. A manager just opening a reply in the team inbox
    (`implicit`) must not clear it from the rep's bell; only the rep's own open,
    or an explicit Mark read / Mark unread click, changes it."""
    actor = Actor.from_claims(user)
    row, _ = _visible_email(db, actor, activity_id)
    read = body.get("read", True)
    is_rep = db.query(models.lead_assignments).filter(
        models.lead_assignments.c.lead_id == row.lead_id, models.lead_assignments.c.user_id == actor.id).first() is not None
    if body.get("implicit") and not is_rep:
        return {"id": row.id, "read_at": _iso(row.read_at)}
    row.read_at = datetime.now(timezone.utc) if read else None
    db.commit()
    return {"id": row.id, "read_at": _iso(row.read_at)}


@router.get("/report")
def report(group_by: str = "cadence", date_from: str = Query(None, alias="from"), date_to: str = Query(None, alias="to"),
           db: Session = Depends(get_db), user: dict = Depends(require_admin_or_ae)):
    if group_by not in REPORT_GROUPS:
        raise HTTPException(status_code=422, detail=f"group_by must be one of {', '.join(REPORT_GROUPS)}")
    actor = Actor.from_claims(user)
    start, end = _window(date_from, date_to)
    filters = dict(start=start or datetime.now(timezone.utc) - timedelta(days=30), end=end)

    JIC = models.JourneyInstantlyCampaign
    outer, label_of, eng_col = None, None, None
    if group_by in ("cadence", "step"):
        # One cadence can have several Instantly campaigns (a content change makes a new one):
        # group by the journey in SQL so a lead in two of them is counted once.
        outer = (JIC, JIC.instantly_campaign_id == LEA.instantly_campaign_id)
        eng_col = func.coalesce(JIC.journey_id, LEA.instantly_campaign_id).label("grp")
        group = (eng_col,) + ((LEA.instantly_step,) if group_by == "step" else ())
    elif group_by == "mailbox":
        group = (LEA.instantly_eaccount.label("grp"),)
    else:  # rep — the lead's assigned rep (lowest user id when a lead has several)
        rep_sq = db.query(models.lead_assignments.c.lead_id.label("lead_id"),
                          func.min(models.lead_assignments.c.user_id).label("rep_id")
                          ).group_by(models.lead_assignments.c.lead_id).subquery()
        outer = (rep_sq, rep_sq.c.lead_id == LEA.lead_id)
        eng_col = rep_sq.c.rep_id.label("grp")
        group = (eng_col,)

    agg = _aggregates(db, actor, group, outer=outer, **filters)
    eng = {}
    if group_by in ("cadence", "rep"):      # counter rows carry no step or mailbox
        eng = {e.grp: e for e in _engagement(db, actor, eng_col, outer=outer, **filters)}

    keys = [a.grp for a in agg if a.grp]
    if group_by in ("cadence", "step"):
        names = {j.id: j.name for j in db.query(models.Journey.id, models.Journey.name).filter(models.Journey.id.in_(keys)).all()}
    elif group_by == "rep":
        names = {u.id: (u.name or u.email) for u in db.query(models.User).filter(models.User.id.in_(keys)).all()}
    else:
        names = {}
    unknown = {"cadence": "Unknown campaign", "step": "Unknown campaign", "mailbox": "Unknown mailbox", "rep": "Unassigned"}[group_by]

    rows = []
    for a in agg:
        label = a.grp if group_by == "mailbox" and a.grp else \
            names.get(a.grp) or (f"Campaign {a.grp[:8]}" if group_by in ("cadence", "step") and a.grp else unknown)
        if group_by == "step":
            label += f" · step {a.instantly_step + 1 if a.instantly_step is not None else '?'}"
        e = eng.get(a.grp)
        has_eng = group_by in ("cadence", "rep")
        rows.append({
            "key": f"{a.grp or 'none'}" + (f":{a.instantly_step}" if group_by == "step" else ""), "label": label,
            "sent": a.sent or 0, "contacted": a.contacted or 0, "replied": a.replied or 0, "positive": a.positive or 0,
            "reply_rate": _rate(a.replied or 0, a.contacted or 0), "positive_rate": _rate(a.positive or 0, a.replied or 0),
            "opens": (e.opens if e else 0) if has_eng else None, "clicks": (e.clicks if e else 0) if has_eng else None,
        })
    rows.sort(key=lambda r: (-r["sent"], r["label"]))
    return {"group_by": group_by, "rows": rows, "totals": _totals(db, actor, **filters)}


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: dict = Depends(require_admin_or_ae)):
    """Dashboard tile: the last 7 days, plus everything still unread."""
    actor = Actor.from_claims(user)
    start = datetime.now(timezone.utc) - timedelta(days=7)
    totals = _totals(db, actor, start=start)
    unread = _base(db, actor, func.count(LEA.id)).filter(_is_real_reply(), LEA.read_at.is_(None)).scalar() or 0
    return {"days": 7, "replies": totals["replied"], "positive": totals["positive"],
            "reply_rate": totals["reply_rate"], "unread": unread, "sent": totals["sent"]}
