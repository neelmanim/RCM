"""One day of rep activity — what a team lead asks for every morning: calls, emails, research notes, meetings booked,
and which leads each rep touched with their follow-up status.

Same definitions as My Day and the raw Excel export (a dialer call paired to a call log counts once; a meeting is a
booking by the person who booked it), so the Daily Digest agrees with those screens for the same person and day.
Research = a note the rep wrote on a lead that day (the SDR records research and account insight in the lead's Notes).
"""
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import models
from services import lead_lifecycle

LEAD_ROWS_CAP = 5000          # one day of one team; the screen pages it, the Excel export carries all of it


def day_bounds(day, tz_name=None):
    """[start, end] of a calendar day in the team's own timezone (UTC when unset/unknown), as aware UTC datetimes."""
    tz = timezone.utc
    if tz_name:
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = timezone.utc
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start.astimezone(timezone.utc), (start + timedelta(days=1) - timedelta(microseconds=1)).astimezone(timezone.utc)


def pod_timezone(db, pod_id):
    if not pod_id:
        return None
    return db.query(models.Pod.timezone).filter(models.Pod.id == pod_id).scalar()


def _calls(db, uids, start, end):
    """[(user_id, lead_id, at)] — call logs plus dialer calls that have no call log."""
    out = [(u, l, a) for u, l, a in db.query(models.CallLog.user_id, models.CallLog.lead_id, models.CallLog.called_at).filter(
        models.CallLog.user_id.in_(uids), models.CallLog.called_at.between(start, end))]
    at = models.dialer_call_event_time()
    paired = db.query(models.CallLog.dialer_call_id).filter(models.CallLog.dialer_call_id.isnot(None))
    out += [(u, l, a) for u, l, a in db.query(models.DialerCall.user_id, models.DialerCall.lead_id, at).filter(
        models.DialerCall.user_id.in_(uids), models.DialerCall.direction == "outbound",
        at.between(start, end), ~models.DialerCall.id.in_(paired))]
    return out


def _emails(db, uids, start, end):
    return list(db.query(models.LeadEmailActivity.user_id, models.LeadEmailActivity.lead_id, models.LeadEmailActivity.timestamp).filter(
        models.LeadEmailActivity.user_id.in_(uids), models.LeadEmailActivity.direction == "outbound",
        models.LeadEmailActivity.timestamp.between(start, end)))


def _notes(db, names, start, end):
    """[(user_id, lead_id, at)] — notes are stored with the author's NAME; only an unambiguous name is attributed."""
    rows = db.query(models.Note.author, models.Note.lead_id, models.Note.created_at).filter(
        models.Note.created_at.between(start, end))
    return [(names[a.lower()], l, at) for a, l, at in rows if a and a.lower() in names]


def _bookings(db, uids, start, end):
    return list(db.query(models.LeadMeeting.booked_by_user_id, models.LeadMeeting.lead_id, models.LeadMeeting.booked_at).filter(
        models.LeadMeeting.booked_by_user_id.in_(uids), models.LeadMeeting.status != "cancelled",
        models.LeadMeeting.booked_at.between(start, end)))


def collect(db, uids, start, end):
    """{'calls'|'emails'|'notes'|'meetings': [(user_id, lead_id, at)]} for the given reps in [start, end]."""
    uids = list(uids)
    if not uids:
        return {k: [] for k in ("calls", "emails", "notes", "meetings")}
    names = lead_lifecycle._name_to_user_id(db)
    ours = set(uids)
    return {"calls": _calls(db, uids, start, end), "emails": _emails(db, uids, start, end),
            "notes": [r for r in _notes(db, names, start, end) if r[0] in ours],
            "meetings": _bookings(db, uids, start, end)}


def totals(events):
    """{user_id: {calls, emails, research_notes, meetings}} from collect()."""
    per = defaultdict(lambda: {"calls": 0, "emails": 0, "research_notes": 0, "meetings": 0})
    for key, field in (("calls", "calls"), ("emails", "emails"), ("notes", "research_notes"), ("meetings", "meetings")):
        for uid, _lead, _at in events[key]:
            per[uid][field] += 1
    return per


def lead_rows(db, events, users, now=None, campaigns=None):
    """One row per (rep, lead) touched in the window, with what was done and the lead's follow-up status.
    Returns (rows, total) — rows capped at LEAD_ROWS_CAP and ordered for a team lead: overdue follow-ups first, then
    leads that booked a meeting, then the most worked."""
    per = defaultdict(lambda: {"calls": 0, "emails": 0, "notes": 0, "meeting": 0})
    for key, field in (("calls", "calls"), ("emails", "emails"), ("notes", "notes"), ("meetings", "meeting")):
        for uid, lid, _at in events[key]:
            if lid:
                per[(uid, lid)][field] += 1
    total = len(per)
    keys = sorted(per, key=lambda k: -sum(per[k].values()))[:LEAD_ROWS_CAP]
    lead_ids = {lid for _u, lid in keys}
    leads = {l.id: l for l in db.query(models.Lead).filter(models.Lead.id.in_(lead_ids))} if lead_ids else {}
    now = now or datetime.now(timezone.utc)
    follow = defaultdict(list)          # (user_id, lead_id) -> open task due times
    if lead_ids:
        for uid, lid, due, day in db.query(models.Task.user_id, models.Task.lead_id, models.Task.due_time, models.Task.due_date).filter(
                models.Task.lead_id.in_(lead_ids), models.Task.done != "true"):
            follow[(uid, lid)].append(due or _day(day))       # a task may carry only a date (no time)
    rows = []
    for uid, lid in keys:
        lead = leads.get(lid)
        if lead is None or lead.deleted_at is not None or lead.is_test:
            continue
        dues = sorted(d for d in follow.get((uid, lid), []) if d is not None)
        if not follow.get((uid, lid)):
            fu = "None set"
        elif dues and _aware(dues[0]) < now:
            fu = "Overdue"
        else:
            fu = "Scheduled"
        c = per[(uid, lid)]
        rows.append({"rep_id": uid, "rep": users[uid].name if uid in users else "", "lead_id": lid,
                     "lead": f"{lead.first_name or ''} {lead.last_name or ''}".strip() or (lead.email or ""),
                     "company": lead.company or "", "campaign": (campaigns or {}).get(lid) or "No campaign", "status": lead.status, "calls": c["calls"], "emails": c["emails"],
                     "notes": c["notes"], "meeting_booked": bool(c["meeting"]), "follow_up": fu,
                     "next_follow_up": dues[0].isoformat() if dues else None})
    rows.sort(key=lambda r: (r["follow_up"] != "Overdue", not r["meeting_booked"], -(r["calls"] + r["emails"] + r["notes"])))
    return rows, total


def campaign_rows(events, lead_campaign, none_label="No campaign"):
    """One row per campaign tag worked in the window: how many different leads, and what was done on them. A lead with no tag
    is "No campaign" — shown, never hidden. Sorted by leads worked."""
    per = defaultdict(lambda: {"leads": set(), "calls": 0, "emails": 0, "notes": 0, "meetings": 0})
    for key in ("calls", "emails", "notes", "meetings"):
        for _u, lid, _at in events[key]:
            if lid:
                c = per[lead_campaign.get(lid) or none_label]
                c["leads"].add(lid)
                c[key] += 1
    rows = [{"campaign": name, "leads_touched": len(c["leads"]), "calls": c["calls"], "emails": c["emails"], "notes": c["notes"],
             "meetings_booked": c["meetings"]} for name, c in per.items()]
    return sorted(rows, key=lambda r: (-r["leads_touched"], r["campaign"]))


def distinct_leads(events):
    """How many different leads were touched (call, email, note or booking) in a collect() result."""
    return len({lid for key in ("calls", "emails", "notes", "meetings") for _u, lid, _a in events[key] if lid})


ACTIVITY_FIELDS = {"calls": "calls", "emails": "emails", "notes": "notes", "meetings": "meeting_booked"}


def filter_rows(rows, rep_id=None, follow_up=None, activity=None, q=None, campaign=None):
    """The lead-wise list as the screen filters it: by rep, follow-up status, kind of activity, and a name/company search."""
    q = (q or "").strip().lower()
    out = []
    for r in rows:
        if rep_id and r["rep_id"] != rep_id:
            continue
        if follow_up and r["follow_up"] != follow_up:
            continue
        if activity in ACTIVITY_FIELDS and not r[ACTIVITY_FIELDS[activity]]:
            continue
        if campaign and r.get("campaign") != campaign:
            continue
        if q and q not in f"{r['lead']} {r['company']}".lower():
            continue
        out.append(r)
    return out


def _day(text):
    """A task's date-only 'YYYY-MM-DD' (or ISO) string as an aware datetime at end of that day; None if absent/unreadable."""
    try:
        return datetime.fromisoformat(str(text)[:10]).replace(hour=23, minute=59, tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _aware(d):
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
