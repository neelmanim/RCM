"""Sales funnel for a window: Accounts -> Conversations -> Meetings booked -> SAL -> Held, plus No-show and Closed.

Definitions are the ones in docs/definitions/METRICS_GLOSSARY.md and docs/definitions/CAMPAIGN.md:
- Accounts / contacts: leads that STARTED an ownership period for a rep in the window (lead_ownership_periods), so a
  reassigned lead counts for the new rep on the day it moved, and the old rep keeps their earlier window.
  An account is the lead's website domain (the vendor's key), else a company e-mail domain, else the normalised company
  name. A lead with none of these stands alone as its own account, so it is counted, never merged or dropped.
- Conversations: a call by the rep with a real outcome, or a measured duration over the org threshold (same helpers as Analytics).
- Booked / Held / No-show: lead_meetings rows by the person who booked them, in the window of booked_at / held_at / no_show_at.
- SAL: a booking in the window whose lead exists in Salesforce (real sf_lead_id).
- Closed: leads booked in the window that Salesforce now reports as Won / Lost (only as good as the SF sync).
- Campaign: the lead's tag (first alphabetically when several), else "No campaign" - never hidden.
"""
import re
from collections import defaultdict

import models
from services import daily_activity

NO_CAMPAIGN = "No campaign"
UNMATCHED = "__unmatched__"
FIELDS = ("accounts", "contacts", "conversations", "booked", "sal", "held", "no_show", "won", "lost")


def _domain(url):
    d = re.sub(r"^[a-z]+://", "", (url or "").strip().lower()).split("/")[0].split("@")[-1]
    d = d[4:] if d.startswith("www.") else d
    return d if "." in d else None


def account_key(company, website=None, email=None):
    """Website domain, else non-public e-mail domain, else normalised company name (case, spacing and legal suffix
    ignored). None when the lead has none of them."""
    from email_utils import _PUBLIC_MAIL
    d = _domain(website)
    if not d and email and "@" in email:
        d = _domain(email.rsplit("@", 1)[1])
        d = None if d in _PUBLIC_MAIL else d
    if d:
        return d
    k = re.sub(r"[^a-z0-9 ]", " ", (company or "").lower())
    k = re.sub(r"\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|company|gmbh|plc)\b", " ", k)
    return " ".join(k.split()) or None


def _real_sf(sf_id):
    from salesforce import _is_sentinel_sf_id
    return bool(sf_id) and not _is_sentinel_sf_id(sf_id)


def _campaigns(db, lead_ids):
    """lead_id -> campaign name (first tag alphabetically), for the given leads."""
    out = {}
    ids = list(lead_ids)
    for i in range(0, len(ids), 5000):
        for lid, name in db.query(models.lead_tags.c.lead_id, models.Tag.name).join(
                models.Tag, models.Tag.id == models.lead_tags.c.tag_id).filter(
                models.lead_tags.c.lead_id.in_(ids[i:i + 5000])).order_by(models.Tag.name.desc()):
            out[lid] = name          # descending order, last write wins -> alphabetically first
    return out


def _conversations(db, uids, start, end, min_seconds):
    out = [(u, l) for u, l in db.query(models.CallLog.user_id, models.CallLog.lead_id).filter(
        models.CallLog.user_id.in_(uids), models.CallLog.called_at.between(start, end),
        models.call_log_is_conversation())]
    at = models.dialer_call_event_time()
    paired = db.query(models.CallLog.dialer_call_id).filter(models.CallLog.dialer_call_id.isnot(None))
    out += [(u, l) for u, l in db.query(models.DialerCall.user_id, models.DialerCall.lead_id).filter(
        models.DialerCall.user_id.in_(uids), models.DialerCall.direction == "outbound", at.between(start, end),
        ~models.DialerCall.id.in_(paired), models.dialer_call_is_conversation(min_seconds))]
    return out


def collect(db, uids, start, end, min_seconds):
    """{field: [(user_id, lead_id)]} — raw events for the reps in [start, end]."""
    uids = list(uids)
    ev = {f: [] for f in FIELDS}
    if not uids:
        return ev
    ev["conversations"] = _conversations(db, uids, start, end, min_seconds)
    ev["contacts"] = list(db.query(models.LeadOwnershipPeriod.user_id, models.LeadOwnershipPeriod.lead_id).filter(
        models.LeadOwnershipPeriod.user_id.in_(uids), models.LeadOwnershipPeriod.valid_from.between(start, end)))
    M = models.LeadMeeting
    booked = db.query(M.booked_by_user_id, M.lead_id).filter(
        M.booked_by_user_id.in_(uids), M.status != "cancelled", M.booked_at.between(start, end))
    ev["booked"] = list(booked)
    ev["held"] = list(db.query(M.booked_by_user_id, M.lead_id).filter(
        M.booked_by_user_id.in_(uids), M.held_at.between(start, end)))
    ev["no_show"] = list(db.query(M.booked_by_user_id, M.lead_id).filter(
        M.booked_by_user_id.in_(uids), M.no_show_at.between(start, end)))
    return ev


def build(db, uids, start, end, min_seconds, group_by="none", campaign=None, names=None):
    """Funnel rows (one per group, or one 'All') plus a total. group_by: none | sdr | campaign."""
    ev = collect(db, uids, start, end, min_seconds)
    lead_ids = {l for f in ev.values() for _u, l in f if l}
    leads = {}
    ids = list(lead_ids)
    for i in range(0, len(ids), 5000):
        for lead in db.query(models.Lead.id, models.Lead.company, models.Lead.website, models.Lead.email, models.Lead.sf_lead_id, models.Lead.opportunity_status,
                             models.Lead.deleted_at, models.Lead.is_test).filter(models.Lead.id.in_(ids[i:i + 5000])):
            if lead.deleted_at is None and not lead.is_test:
                leads[lead.id] = lead
    camp = _campaigns(db, leads)

    # SAL / closed are properties of the booked lead
    ev["sal"] = [(u, l) for u, l in ev["booked"] if l in leads and _real_sf(leads[l].sf_lead_id)]
    status = lambda l: (leads[l].opportunity_status or "").strip().lower()
    ev["won"] = [(u, l) for u, l in ev["booked"] if l in leads and status(l) == "won"]
    ev["lost"] = [(u, l) for u, l in ev["booked"] if l in leads and status(l) == "lost"]

    def group_of(u, l):
        if group_by == "sdr":
            return u
        if group_by == "campaign":
            return camp.get(l, NO_CAMPAIGN)
        return "all"

    groups = defaultdict(lambda: {f: 0 for f in FIELDS})
    accts = defaultdict(set)
    contacts = defaultdict(set)
    for field in FIELDS:
        if field == "accounts":
            continue
        seen = set()
        for u, l in ev[field]:
            if l not in leads or (campaign and camp.get(l, NO_CAMPAIGN) != campaign):
                continue
            g = group_of(u, l)
            if field == "contacts":
                if (g, l) in seen:      # re-assigned twice in the window = one contact
                    continue
                seen.add((g, l))
                contacts[g].add(l)
                k = account_key(leads[l].company, leads[l].website, leads[l].email)
                accts[g].add(k or f"{UNMATCHED}{l}")      # no company: each lead stands alone, never merged
            groups[g][field] += 1
    for g in list(groups) + list(contacts):
        groups[g]["accounts"] = len(accts[g])
        groups[g]["contacts"] = len(contacts[g])

    def row(key, label, c):
        c = dict(c)
        c.update(key=key, label=label,
                 contacts_per_account=round(c["contacts"] / c["accounts"], 1) if c["accounts"] else 0,
                 booked_per_100_conversations=round(100 * c["booked"] / c["conversations"], 1) if c["conversations"] else 0,
                 held_rate=round(100 * c["held"] / c["booked"], 1) if c["booked"] else 0,
                 no_show_rate=round(100 * c["no_show"] / c["booked"], 1) if c["booked"] else 0)
        return c

    names = names or {}
    rows = [row(k, names.get(k, k) if group_by == "sdr" else ("All" if k == "all" else k), v) for k, v in groups.items()]
    rows.sort(key=lambda r: (-r["booked"], -r["conversations"], r["label"] or ""))
    total = {f: sum(r[f] for r in rows) for f in FIELDS if f not in ("accounts", "contacts")}
    all_accts, all_contacts = set(), set()
    for g in accts:
        all_accts |= accts[g]
        all_contacts |= contacts[g]
    total["accounts"], total["contacts"] = len(all_accts), len(all_contacts)
    return rows, row("total", "Total", total), camp


def window(start_day, end_day, tz_name):
    s, _ = daily_activity.day_bounds(start_day, tz_name)
    _, e = daily_activity.day_bounds(end_day, tz_name)
    return s, e
