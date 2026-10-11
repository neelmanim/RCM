"""Lead lifecycle state — a COMPUTED label, never stored, never a status (plan §5A).

"Assigned" used to mean three things: who owns a lead, whether anyone started on it, and the `Lead Assigned` status every
new lead is born with. This answers the first two from data we already record; statuses and Salesforce are untouched.

  Unassigned    nobody owns it                                      Closed        Disqualified / Completed
  New to me     owned, nobody has ever worked it                    On hold       No Phone - Parked / Pending Review
  Inherited     owned, someone ELSE worked it, owner hasn't yet     Meeting booked Meeting Scheduled … Demo Done
  In progress   owner has called / noted / emailed / moved it       Other         a status outside the app's list

Defaults awaiting sign-off (plan D11/D12): a reset to "Lead Assigned" with the SAME owner reads New to me (the owner's
earlier work doesn't count), with a NEW owner it reads Inherited; cadence/system email sends count as "worked" for
Inherited but never for In progress; Salesforce/system status moves count as neither.
"""
from collections import defaultdict

from sqlalchemy import func

import meeting_log
import models

UNASSIGNED, NEW, INHERITED, IN_PROGRESS = "Unassigned", "New to me", "Inherited", "In progress"
BOOKED, CLOSED, ON_HOLD, OTHER = "Meeting booked", "Closed", "On hold", "Other"
STATES = (UNASSIGNED, NEW, INHERITED, IN_PROGRESS, BOOKED, CLOSED, ON_HOLD, OTHER)
CLOSED_STATUSES = {"Disqualified", "Completed"}
_CHUNK = 500


def _status_state(status):
    """The state a status alone decides, or None when ownership/activity must decide."""
    if status in CLOSED_STATUSES:
        return CLOSED
    if status in models.PARKED_STATUSES:
        return ON_HOLD
    if status not in models.KNOWN_STATUSES:
        return OTHER
    if status in meeting_log.MEETING_REACHED:
        return BOOKED
    return None


def _name_to_user_id(db):
    """lower(name|email) -> user id, only where exactly one user has it (notes and old status logs store names)."""
    seen = defaultdict(set)
    for uid, name, email in db.query(models.User.id, models.User.name, models.User.email).all():
        for k in (name, email):
            if k:
                seen[k.lower()].add(uid)
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}


def _events(db, ids, names):
    """lead_id -> [(user_id | None, at)]: the work signals. Calls, outbound email, notes, and real status moves."""
    out = defaultdict(list)
    for lid, uid, at in db.query(models.CallLog.lead_id, models.CallLog.user_id, models.CallLog.called_at).filter(
            models.CallLog.lead_id.in_(ids)):
        out[lid].append((uid, at))
    paired = db.query(models.CallLog.dialer_call_id).filter(models.CallLog.dialer_call_id.isnot(None))
    for lid, uid, at in db.query(models.DialerCall.lead_id, models.DialerCall.user_id, models.dialer_call_event_time()).filter(
            models.DialerCall.lead_id.in_(ids), models.DialerCall.direction == "outbound", ~models.DialerCall.id.in_(paired)):
        out[lid].append((uid, at))
    for lid, uid, at in db.query(models.LeadEmailActivity.lead_id, models.LeadEmailActivity.user_id,
                                 models.LeadEmailActivity.timestamp).filter(
            models.LeadEmailActivity.lead_id.in_(ids), models.LeadEmailActivity.direction == "outbound"):
        out[lid].append((uid, at))
    for lid, author, at in db.query(models.Note.lead_id, models.Note.author, models.Note.created_at).filter(
            models.Note.lead_id.in_(ids)):
        out[lid].append((names.get((author or "").lower()), at))
    for lid, by, by_id, at in db.query(models.LeadStatusLog.lead_id, models.LeadStatusLog.changed_by,
                                       models.LeadStatusLog.changed_by_user_id, models.LeadStatusLog.changed_at).filter(
            models.LeadStatusLog.lead_id.in_(ids), models.LeadStatusLog.from_status.isnot(None),
            ~models.LeadStatusLog.to_status.like("Outcome:%"),
            models.LeadStatusLog.to_status != "Lead Assigned"):      # a reset is the start-fresh marker, not work
        uid = by_id or names.get((by or "").lower())
        if uid:                                   # a status move by "system"/Salesforce is not anyone working the lead
            out[lid].append((uid, at))
    return out


def states_for(db, leads):
    """{lead_id: state} for `leads` (Lead rows). Five grouped queries per 500 leads, no per-lead queries."""
    result, names = {}, None
    for i in range(0, len(leads), _CHUNK):
        chunk = leads[i:i + _CHUNK]
        pending = []
        for lead in chunk:
            s = _status_state(lead.status)
            if s:
                result[lead.id] = s
            else:
                pending.append(lead)
        if not pending:
            continue
        ids = [l.id for l in pending]
        owners = defaultdict(dict)                      # lead_id -> {user_id: assigned_at}
        for lid, uid, at in db.query(models.lead_assignments.c.lead_id, models.lead_assignments.c.user_id,
                                     models.lead_assignments.c.assigned_at).filter(models.lead_assignments.c.lead_id.in_(ids)):
            owners[lid][uid] = at
        owned = [l for l in pending if owners.get(l.id)]
        for l in pending:
            if not owners.get(l.id):
                result[l.id] = UNASSIGNED
        if not owned:
            continue
        names = names if names is not None else _name_to_user_id(db)
        oids = [l.id for l in owned]
        events = _events(db, oids, names)
        resets = dict(db.query(models.LeadStatusLog.lead_id, func.max(models.LeadStatusLog.changed_at)).filter(
            models.LeadStatusLog.lead_id.in_(oids), models.LeadStatusLog.to_status == "Lead Assigned",
            models.LeadStatusLog.from_status.isnot(None)).group_by(models.LeadStatusLog.lead_id).all())
        for lead in owned:
            result[lead.id] = _work_state(owners[lead.id], events.get(lead.id, []), resets.get(lead.id))
    return result


def _later(a, b):
    """a >= b, tolerant of NULLs and of naive-vs-aware datetimes (SQLite returns naive)."""
    if a is None or b is None:
        return b is None
    a, b = (a.replace(tzinfo=None) if a.tzinfo else a), (b.replace(tzinfo=None) if b.tzinfo else b)
    return a >= b


def _work_state(owners, events, reset_at):
    """owners {user_id: assigned_at}; events [(user_id|None, at)]; reset_at = last 'start fresh' move, if any."""
    owner_ids = set(owners)
    acted = False
    for uid, at in events:
        if uid in owner_ids and _later(at, owners[uid]) and (reset_at is None or _later(at, reset_at)):
            acted = True
            break
    if acted:
        return IN_PROGRESS
    # Someone else (a previous owner, an admin, a cadence send) worked it before this owner had it
    others = any(uid not in owner_ids for uid, _ in events)
    return INHERITED if others else NEW


def summary_for_user(db, user_id):
    """Counts of the leads this person owns today, by lifecycle state."""
    leads = (models.exclude_test_and_deleted_leads(db.query(models.Lead).join(
        models.lead_assignments, (models.lead_assignments.c.lead_id == models.Lead.id)
        & (models.lead_assignments.c.user_id == user_id))).all())
    counts = {s: 0 for s in STATES if s != UNASSIGNED}
    for state in states_for(db, leads).values():
        counts[state] += 1
    return counts
