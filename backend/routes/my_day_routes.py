# ── routes/my_day_routes.py — "My Day": what was given to me and what I did ──
# The Dashboard's status counts answer "what do I hold right now", never "what is new today" or "what did I do
# today". This is the personal answer, built only from rows we already record: lead_assignments.assigned_at,
# lead_status_logs, call_logs, dialer_calls, notes, lead_email_activity. Always the caller's own day (a "View as"
# token is the viewed person), so there is no scoping to get wrong.
import csv
import io
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from auth import get_current_user, require_export_access
from database import get_db

router = APIRouter(prefix="/api/my-day", tags=["My Day"])

CALLABLE = ("Lead Assigned", "Research", "Calling")
MEETING_STAGES = ("Meeting Scheduled", "1st Discovery Meeting", "Discovery Complete", "Demo Scheduled", "Demo Done")
KINDS = ("call", "note", "status", "email")
MAX_PER_PAGE = 50


def day_window(day: Optional[str], tz_offset_min: int):
    """[start, end) of a calendar day in the person's own timezone, as UTC. tz_offset_min is JavaScript's
    Date.getTimezoneOffset() (UTC minus local, in minutes: IST is -330)."""
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc - timedelta(minutes=tz_offset_min)
    if day:
        try:
            local_day = datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    else:
        local_day = local_now.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    start = (local_day + timedelta(minutes=tz_offset_min)).replace(tzinfo=timezone.utc)
    return start, start + timedelta(days=1), local_day.strftime("%Y-%m-%d")


def _name(lead):
    return f"{lead.first_name or ''} {lead.last_name or ''}".strip() or "(no name)"


def _mine(db, uid):
    """Live leads currently assigned to this person."""
    return models.exclude_test_and_deleted_leads(
        db.query(models.Lead).join(
            models.lead_assignments,
            (models.lead_assignments.c.lead_id == models.Lead.id) & (models.lead_assignments.c.user_id == uid),
        )
    )


def given_leads(db, uid, start, end):
    """lead_id -> {lead, reason, at} for what was given to this person in [start, end): a new assignment, or a status
    reset to Lead Assigned (the "start fresh" move). Shared with GET /api/leads?smart=given_today so the Dashboard's
    number and the list it opens can never disagree."""
    mine = _mine(db, uid)
    assigned_rows = (
        mine.add_columns(models.lead_assignments.c.assigned_at)
        .filter(models.lead_assignments.c.assigned_at >= start, models.lead_assignments.c.assigned_at < end)
        .all()
    )
    reset_at = dict(
        db.query(models.LeadStatusLog.lead_id, func.max(models.LeadStatusLog.changed_at))
        .filter(models.LeadStatusLog.to_status == "Lead Assigned",
                models.LeadStatusLog.changed_at >= start, models.LeadStatusLog.changed_at < end)
        .group_by(models.LeadStatusLog.lead_id).all()
    )
    reset_rows = [(l, reset_at[l.id]) for l in mine.filter(models.Lead.id.in_(list(reset_at))).all()] if reset_at else []
    given = {}
    for lead, at in reset_rows:
        given[lead.id] = {"lead": lead, "reason": "Reset to Lead Assigned", "at": at}
    for lead, at in assigned_rows:           # a real assignment wins over a reset for the same lead
        given[lead.id] = {"lead": lead, "reason": "Assigned to you", "at": at}
    return given


def ever_called_ids(db):
    """Query of every lead id that has ever had a call (manual call log or dialer call)."""
    return db.query(models.CallLog.lead_id).union(
        db.query(models.DialerCall.lead_id).filter(models.DialerCall.lead_id.isnot(None)))


def _build(db, user, date, tz_offset_min):
    """Everything for the day, uncut: the paginated endpoint slices it, the CSV export writes all of it."""
    uid = user["sub"]
    me = db.query(models.User).filter(models.User.id == uid).first()
    if not me:
        raise HTTPException(status_code=404, detail="User not found")
    start, end, local_date = day_window(date, tz_offset_min)
    names = [n for n in {me.name, me.email} if n]

    given = given_leads(db, uid, start, end)
    given_list = sorted(given.values(), key=lambda g: g["at"] or start, reverse=True)

    # ── What I did in the day ─────────────────────────────────────────────────────────────────────────────────
    call_logs = (db.query(models.CallLog, models.Lead).join(models.Lead, models.Lead.id == models.CallLog.lead_id)
                 .filter(models.CallLog.user_id == uid, models.CallLog.called_at >= start, models.CallLog.called_at < end)
                 .all())
    paired = db.query(models.CallLog.dialer_call_id).filter(models.CallLog.dialer_call_id.isnot(None))
    dialer = (db.query(models.DialerCall, models.Lead).join(models.Lead, models.Lead.id == models.DialerCall.lead_id)
              .filter(models.DialerCall.user_id == uid, models.DialerCall.direction == "outbound",
                      models.DialerCall.created_at >= start, models.DialerCall.created_at < end,
                      ~models.DialerCall.id.in_(paired))
              .all())
    notes = (db.query(models.Note, models.Lead).join(models.Lead, models.Lead.id == models.Note.lead_id)
             .filter(models.Note.author.in_(names), models.Note.created_at >= start, models.Note.created_at < end).all()
             ) if names else []
    moves = (db.query(models.LeadStatusLog, models.Lead).join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id)
             .filter(models.LeadStatusLog.changed_by.in_(names), models.LeadStatusLog.changed_at >= start,
                     models.LeadStatusLog.changed_at < end).all()) if names else []
    emails = (db.query(models.LeadEmailActivity, models.Lead).join(models.Lead, models.Lead.id == models.LeadEmailActivity.lead_id)
              .filter(models.LeadEmailActivity.user_id == uid, models.LeadEmailActivity.direction == "outbound",
                      models.LeadEmailActivity.timestamp >= start, models.LeadEmailActivity.timestamp < end).all())

    activity = []
    for c, l in call_logs:
        activity.append({"kind": "call", "at": c.called_at, "lead_id": l.id, "lead": _name(l), "company": l.company,
                         "text": f"Call — {c.outcome}"})
    for d, l in dialer:
        activity.append({"kind": "call", "at": d.created_at, "lead_id": l.id, "lead": _name(l), "company": l.company,
                         "text": f"Call — {d.outcome or d.status}"})
    for n, l in notes:
        activity.append({"kind": "note", "at": n.created_at, "lead_id": l.id, "lead": _name(l), "company": l.company,
                         "text": "Added a note"})
    for s, l in moves:
        activity.append({"kind": "status", "at": s.changed_at, "lead_id": l.id, "lead": _name(l), "company": l.company,
                         "text": f"{s.from_status or 'New'} → {s.to_status}"})
    for e, l in emails:
        activity.append({"kind": "email", "at": e.timestamp, "lead_id": l.id, "lead": _name(l), "company": l.company,
                         "text": "Sent an email"})
    activity.sort(key=lambda a: a["at"] or start, reverse=True)
    touched = {a["lead_id"] for a in activity}

    # ── Right now: callable leads nobody has ever called (the honest "untouched") ─────────────────────────────
    not_called = _mine(db, uid).filter(models.Lead.status.in_(CALLABLE), ~models.Lead.id.in_(ever_called_ids(db))).count()

    return {
        "date": local_date, "start": start, "end": end,
        "given_list": given_list, "activity": activity,
        "counts": {
            "calls": len(call_logs) + len(dialer), "notes": len(notes), "status_changes": len(moves),
            "meetings_booked": sum(1 for s_, _ in moves if s_.to_status in MEETING_STAGES),
            "emails": len(emails), "leads_worked": len(touched),
        },
        "not_called": not_called,
    }


def _page(items, page, per_page):
    pages = max(1, math.ceil(len(items) / per_page))
    page = min(max(page, 1), pages)
    return items[(page - 1) * per_page: page * per_page], page, pages


def _iso(dt):
    return dt.isoformat() if dt else None


def _cell(v):
    """CSV cell safe to open in a spreadsheet: a lead name or note starting with = + - @ must not run as a formula."""
    v = "" if v is None else str(v)
    return "'" + v if v[:1] in ("=", "+", "-", "@") else v


@router.get("")
def my_day(
    date: Optional[str] = Query(None, description="YYYY-MM-DD in your timezone; default today"),
    tz_offset_min: int = Query(0, ge=-840, le=840, description="Date.getTimezoneOffset() of the browser"),
    kind: Optional[str] = Query(None, description="Only this kind of activity: call | note | status | email"),
    given_page: int = Query(1, ge=1),
    did_page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=MAX_PER_PAGE),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if kind and kind not in KINDS:
        raise HTTPException(status_code=400, detail="kind must be one of " + ", ".join(KINDS))
    d = _build(db, user, date, tz_offset_min)
    given_rows, g_page, g_pages = _page(d["given_list"], given_page, per_page)
    by_kind = {k: sum(1 for a in d["activity"] if a["kind"] == k) for k in KINDS}
    activity = [a for a in d["activity"] if not kind or a["kind"] == kind]
    act_rows, a_page, a_pages = _page(activity, did_page, per_page)
    return {
        "date": d["date"],
        "window": {"start": _iso(d["start"]), "end": _iso(d["end"])},
        "given": {
            "total": len(d["given_list"]),
            "assigned": sum(1 for g in d["given_list"] if g["reason"] == "Assigned to you"),
            "reset": sum(1 for g in d["given_list"] if g["reason"] != "Assigned to you"),
            "page": g_page, "pages": g_pages, "per_page": per_page,
            "leads": [{"id": g["lead"].id, "name": _name(g["lead"]), "company": g["lead"].company,
                       "status": g["lead"].status, "reason": g["reason"], "at": _iso(g["at"])} for g in given_rows],
        },
        "did": {
            **d["counts"],
            "by_kind": by_kind,
            "activity_total": len(activity), "page": a_page, "pages": a_pages, "per_page": per_page,
            "activity": [{**a, "at": _iso(a["at"])} for a in act_rows],
        },
        "now": {"not_yet_called": d["not_called"]},
    }


@router.get("/export", dependencies=[Depends(require_export_access)])
def export_my_day(
    date: Optional[str] = Query(None),
    tz_offset_min: int = Query(0, ge=-840, le=840),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The whole day as one CSV (every row, not a page) — to hand to a manager or paste into a sheet."""
    d = _build(db, user, date, tz_offset_min)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Section", "Time (UTC)", "Lead", "Company", "Detail", "Lead ID"])
    for g in d["given_list"]:
        w.writerow(["Given to me", _iso(g["at"]) or "", _cell(_name(g["lead"])), _cell(g["lead"].company),
                    _cell(f'{g["reason"]} (now {g["lead"].status})'), g["lead"].id])
    for a in d["activity"]:
        w.writerow(["What I did", _iso(a["at"]) or "", _cell(a["lead"]), _cell(a["company"]), _cell(a["text"]), a["lead_id"]])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="my-day-' + d["date"] + '.csv"'})


@router.get("/lifecycle")
def my_lifecycle(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """What I hold, split by what state it is in (services/lead_lifecycle.py) — 'Assigned to me' made meaningful."""
    from services import lead_lifecycle
    return {"counts": lead_lifecycle.summary_for_user(db, user["sub"])}
