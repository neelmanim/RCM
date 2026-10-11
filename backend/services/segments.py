"""Team Digest drill-downs: the window's activity grouped by who the lead is (ICP fit, industry, country, city, seniority,
function, company size, source), by account, and by call. The activity is the same as the Digest and the Funnel — the same
rep scoping, the same calls / conversations / meetings — only grouped differently, so the numbers always agree.

Seniority and function come from the job title with ordered keyword rules; a title no rule recognises is listed as "Other"
and the most common ones are returned, so the rules can be tuned from the real data.
"""
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

import models
from services import daily_activity, funnel

NOT_FILLED = "Not filled in"
NO_LEAD = "No lead on record"      # calls/emails/notes the Digest counts but that have no live lead (unlinked dialer call, deleted or test lead)
LAST = (NOT_FILLED, "Industry not filled in", NO_LEAD)
ROW_CAP = 50
# Healthcare today. "health" alone missed hospitals & physician clinics, dental offices, medical practices/devices and pharma (about 4,800 prod leads).
DEFAULT_ICP = ["health", "hospital", "dental", "medical", "clinic", "pharma", "physician"]

DIMENSIONS = {
    "icp": "ICP fit", "industry": "Industry", "country": "Country", "city": "City", "seniority": "Seniority",
    "function": "Function", "company_size": "Company size", "source": "Lead source", "batch": "Upload file",
}
MIN_SAMPLE = {"connect_rate": 30, "lead_to_conversation": 20, "booked_per_100_conversations": 20, "held_rate": 5}   # below this a rate is noise
SOURCE_NAMES = {"upload": "Uploaded file", "uploaded": "Uploaded file", "gsheet": "Google Sheet", "klenty_sync": "Klenty sync",
                "aircall_webhook": "Aircall (inbound)", "manual": "Manual", "csv_import": "CSV import", "salesforce": "Salesforce"}
_UPLOAD = re.compile(r"^upload:(.*?)(?::\d{4}-\d{2}-\d{2}T[\d:.+\-Z]*)?$")

# Values people typed into the title box that are not a job title (read from the real data: "india", "[not provided]", ...).
JUNK_TITLE = re.compile(r"^(?:\[?not provided\]?|n/?a|none|null|unknown|other|test|-+|\.+|no longer employed|no more poc|do not contact|not applicable|"
                        r"india|usa|us|uk|united states|canada)$")
# Ordered: the first rule that matches wins, so "vice president" is tested before "president".
SENIORITY_RULES = (
    ("VP", r"vice president|\bvp\b|\bsvp\b|\bevp\b|\bavp\b"),
    ("C-suite / Owner", r"\bchief\b|\bc[a-z]o\b|\bcmio\b|founder|\bowner\b|\bpresident\b|managing partner|proprietor|\bpartner\b|chairman|chairperson|board member"),
    ("Director / Head", r"director|\bhead\b"),
    ("Manager", r"manager|supervisor|team lead|\blead\b|principal|\bagm\b|deputy"),
    ("Individual contributor", r"analyst|engineer|specialist|associate|executive|coordinator|officer|nurse|physician|doctor|consultant|"
                               r"assistant|administrator|developer|representative|technician|advisor|therapist|pharmacist|surgeon|clerk|"
                               r"agent|broker|champion|navigator|advocate|scheduler|intern|member|architect|author|accountant|registrar|student|"
                               r"^(operations?|marketing|sales|it|technology|product)\\b"),
)
FUNCTION_RULES = (
    ("Operations / Admin", r"(practice|office|branch|clinic|center|centre|facility|facilities|clinical operations) manager|office administrator|clinical operations"),
    ("Patient services", r"patient (navigator|champion|advocate|care|access|scheduler|contact|financial|health|experience|services|coordinator|relations)|"
                         r"care (navigator|coordinator|advocate)|contact center|call center"),
    ("Clinical / Medical", r"medical|clinical|physician|doctor|nurse|nursing|surgeon|patient|pharmac|dental|dentist|clinic|behavioral|radiolog|patholog|therap|\bcare\b|health information|\bmd\b"),
    ("Sales / Marketing", r"sales|marketing|business development|growth|brand|account executive|account manager|customer success|chief revenue|revenue officer|"
                          r"commercial|chief business|business officer|territory"),
    ("Product / Strategy", r"product|strateg|partnership|innovation|transformation|development officer"),
    ("Procurement / Supply", r"procure|purchas|sourcing|vendor|supply|materials"),
    ("Finance", r"financ|accountant|accounting|accounts (payable|receivable)|\bcfo\b|billing|revenue cycle|controller|treasur"),
    ("HR", r"human resources|\bhr\b|talent|people|recruit"),
    ("IT / Digital", r"\bit\b|information technology|technology|digital|data|software|engineer|\bcio\b|\bcto\b|information officer|informatics|systems|security|analytics|salesforce"),
    ("Operations / Admin", r"operat|administrat|\bcoo\b|facilit|logistic|process|quality|compliance|risk|program|project"),
    ("General management", r"\bceo\b|founder|owner|president|managing director|general manager|chief executive|partner|principal|chairman|board member|executive director"),
)
SIZE_BANDS = ((10, "1-10"), (50, "11-50"), (200, "51-200"), (500, "201-500"), (1000, "501-1,000"), (5000, "1,001-5,000"))
SIZE_ORDER = [b for _n, b in SIZE_BANDS] + ["5,000+"]

COUNTRY_ALIASES = {
    "us": "United States", "usa": "United States", "u.s.": "United States", "u.s.a.": "United States", "united states of america": "United States",
    "america": "United States", "uk": "United Kingdom", "u.k.": "United Kingdom", "gb": "United Kingdom", "great britain": "United Kingdom",
    "england": "United Kingdom", "uae": "United Arab Emirates", "ae": "United Arab Emirates", "in": "India", "ind": "India", "ca": "Canada",
    "au": "Australia", "de": "Germany", "sg": "Singapore", "fr": "France", "nl": "Netherlands", "ie": "Ireland", "sa": "Saudi Arabia",
    "za": "South Africa", "nz": "New Zealand",
}


def _clean(text):
    return " ".join((text or "").split())


def seniority(title):
    t = _clean(title).lower()
    if not t or JUNK_TITLE.match(t):
        return NOT_FILLED
    return next((name for name, rx in SENIORITY_RULES if re.search(rx, t)), "Other")


def function(title):
    t = _clean(title).lower()
    if not t or JUNK_TITLE.match(t):
        return NOT_FILLED
    return next((name for name, rx in FUNCTION_RULES if re.search(rx, t)), "Other")


def company_size(count):
    if not count or count < 1:
        return NOT_FILLED
    return next((band for top, band in SIZE_BANDS if count <= top), "5,000+")


def country(value):
    v = _clean(value)
    if not v:
        return NOT_FILLED
    return COUNTRY_ALIASES.get(v.lower(), v.title() if v.islower() or v.isupper() else v)


def city(lead):
    c = _clean(lead.city or lead.company_city)
    if not c:
        return NOT_FILLED
    c = c.title() if c.islower() or c.isupper() else c
    k = country(lead.country or lead.company_country)
    return c if k == NOT_FILLED else f"{c}, {k}"


def industry(lead):
    v = _clean(lead.industry or lead.research_industry)
    return (v.title() if v.islower() or v.isupper() else v) if v else NOT_FILLED


def icp_keywords(db):
    """The words that make an industry 'ours' (Super Admin edits them; healthcare today)."""
    raw = db.query(models.SyncSettings.icp_keywords).filter(models.SyncSettings.id == 1).scalar()
    try:
        words = [w.strip().lower() for w in json.loads(raw) if isinstance(w, str) and w.strip()] if raw else []
    except (TypeError, ValueError):
        words = []
    return words or list(DEFAULT_ICP)


def icp_fit(lead, keywords):
    ind = _clean(lead.industry or lead.research_industry).lower()
    if not ind:
        return "Industry not filled in"
    return "In ICP" if any(k in ind for k in keywords) else "Outside ICP"


def source_type(value):
    """lead_source holds "upload:<file>:<timestamp>" - a different timestamp on almost every lead - so group by its kind."""
    v = _clean(value)
    if not v:
        return NOT_FILLED
    head = v.split(":", 1)[0]
    return SOURCE_NAMES.get(head.lower(), head)


def upload_file(value):
    """The file (or sheet / sync) a lead came from: "upload:US Finance - Oct 5.csv:2026-10-05T16:00" -> "US Finance - Oct 5.csv"."""
    v = _clean(value)
    m = _UPLOAD.match(v)
    if m and v.startswith("upload:"):
        return m.group(1) or NOT_FILLED
    return source_type(v)


def segment_of(dimension, lead, keywords):
    if dimension == "icp":
        return icp_fit(lead, keywords)
    if dimension == "industry":
        return industry(lead)
    if dimension == "country":
        return country(lead.country or lead.company_country)
    if dimension == "city":
        return city(lead)
    if dimension == "seniority":
        return seniority(lead.title)
    if dimension == "function":
        return function(lead.title)
    if dimension == "company_size":
        return company_size(lead.employee_count)
    if dimension == "batch":
        return upload_file(lead.lead_source)
    return source_type(lead.lead_source)


def _leads(db, lead_ids):
    """{lead_id: Lead columns} for live, non-test leads."""
    out = {}
    ids = list(lead_ids)
    L = models.Lead
    for i in range(0, len(ids), 5000):
        for r in db.query(L.id, L.first_name, L.last_name, L.status, L.company, L.website, L.email, L.title, L.city, L.company_city, L.country, L.company_country, L.industry,
                          L.research_industry, L.employee_count, L.lead_source, L.deleted_at, L.is_test).filter(L.id.in_(ids[i:i + 5000])):
            if r.deleted_at is None and not r.is_test:
                out[r.id] = r
    return out


def _events(db, uids, start, end, min_seconds):
    """Everything the window did, as {kind: [lead_id]} (one entry per event, so counts add up like the Digest's)."""
    act = daily_activity.collect(db, uids, start, end)
    fun = funnel.collect(db, uids, start, end, min_seconds)
    ev = {k: [l for _u, l, _a in act[k]] for k in ("calls", "emails", "notes")}      # a None lead is kept: the Digest counts it
    for k in ("conversations", "booked", "held", "no_show"):
        ev[k] = [l for _u, l in fun[k] if l]
    return ev


def _row(label, c, prev=None):
    """One segment line. Conversion: share of the leads worked that were spoken to, bookings per 100 conversations, and how many
    bookings were held / no-show. `prev` (the same segment in the comparison period) adds the last-period figure and the change."""
    r = {"label": label, "leads": len(c["leads"]), "accounts": len(c["accounts"]), "calls": c["calls"], "conversations": c["conversations"],
         "connect_rate": round(100 * c["conversations"] / c["calls"], 1) if c["calls"] else 0, "emails": c["emails"], "notes": c["notes"],
         "booked": c["booked"], "held": c["held"], "no_show": c["no_show"],
         "leads_spoken_to": len(c["spoke"]), "lead_to_conversation": round(100 * len(c["spoke"]) / len(c["leads"]), 1) if c["leads"] else 0,
         "booked_per_100_conversations": round(100 * c["booked"] / c["conversations"], 1) if c["conversations"] else 0,
         "held_rate": round(100 * c["held"] / c["booked"], 1) if c["booked"] else 0,
         "no_show_rate": round(100 * c["no_show"] / c["booked"], 1) if c["booked"] else 0}
    r["thin"] = {"connect_rate": c["calls"] < MIN_SAMPLE["connect_rate"], "lead_to_conversation": len(c["leads"]) < MIN_SAMPLE["lead_to_conversation"],
                 "booked_per_100_conversations": c["conversations"] < MIN_SAMPLE["booked_per_100_conversations"], "held_rate": c["booked"] < MIN_SAMPLE["held_rate"]}
    if prev is not None:
        before = {"leads": len(prev["leads"]), "calls": prev["calls"], "conversations": prev["conversations"], "booked": prev["booked"]}
        r["prev"] = before
        r["delta"] = {k: delta_pct(r[k], before[k]) for k in before}
    return r


def delta_pct(now, before):
    """Change versus the comparison period, the Digest's way: None = nothing in either, "new" = nothing before, else a percentage."""
    if not now and not before:
        return None
    if not before:
        return "new"
    return round(100 * (now - before) / before, 1)


def _blank():
    return {"leads": set(), "accounts": set(), "spoke": set(), "calls": 0, "conversations": 0, "emails": 0, "notes": 0, "booked": 0, "held": 0, "no_show": 0}


def _order(rows, dimension):
    if dimension == "company_size":
        pos = {b: i for i, b in enumerate(SIZE_ORDER + [NOT_FILLED])}
        return sorted(rows, key=lambda r: pos.get(r["label"], 99))
    # most worked first; "not filled in" always last so the gap is visible but never on top
    return sorted(rows, key=lambda r: (r["label"] in LAST, -r["leads"], -r["calls"], r["label"]))


def _load(db, uids, start, end, min_seconds, memo=None):
    """(events, leads) for one window. `memo(key, make)` (given by the route) lets a screen that flips between breakdowns reuse the
    expensive part for a few minutes; without it everything is read fresh."""
    def make():
        ev = _events(db, uids, start, end, min_seconds)
        return ev, _leads(db, {l for v in ev.values() for l in v if l})
    return memo((tuple(sorted(uids)), start, end, min_seconds), make) if memo else make()


def _group(db, uids, start, end, min_seconds, dimension, keywords, memo=None):
    """({segment: counts}, {lead_id: segment}) for one window."""
    ev, leads = _load(db, uids, start, end, min_seconds, memo)
    seg = {l: segment_of(dimension, r, keywords) for l, r in leads.items()}
    groups = defaultdict(_blank)
    for kind, ids in ev.items():
        for l in ids:
            if l not in leads:
                if kind in ("calls", "emails", "notes"):
                    groups[NO_LEAD][kind] += 1
                continue
            g = groups[seg[l]]
            g[kind] += 1
            g["leads"].add(l)
            if kind == "conversations":
                g["spoke"].add(l)
            r = leads[l]
            g["accounts"].add(funnel.account_key(r.company, r.website, r.email) or f"{funnel.UNMATCHED}{l}")
    return groups, seg, leads


def _sum(groups):
    total = _blank()
    for g in groups.values():
        for f in ("calls", "conversations", "emails", "notes", "booked", "held", "no_show"):
            total[f] += g[f]
        for f in ("leads", "accounts", "spoke"):
            total[f] |= g[f]
    return total


def breakdown(db, uids, start, end, min_seconds, dimension, prev_window=None, memo=None):
    """{rows, total, coverage, unclassified_titles, more} for one dimension. `prev_window` = (start, end) of the comparison period:
    every row then carries the same segment's figures from that period (and a segment that only had activity then is listed too)."""
    keywords = icp_keywords(db) if dimension == "icp" else None
    groups, seg, leads = _group(db, uids, start, end, min_seconds, dimension, keywords, memo)
    before = _group(db, uids, *prev_window, min_seconds, dimension, keywords, memo)[0] if prev_window else None
    labels = set(groups) | (set(before) if before else set())
    rows = _order([_row(k, groups.get(k) or _blank(), (before.get(k) or _blank()) if before is not None else None) for k in labels], dimension)
    total = _row("Total", _sum(groups), _sum(before) if before is not None else None)
    missing = sum(1 for v in seg.values() if v in (NOT_FILLED, "Industry not filled in"))
    unclassified = []
    if dimension in ("seniority", "function"):
        rule = seniority if dimension == "seniority" else function
        titles = Counter(_clean(r.title).lower() for r in leads.values() if r.title and rule(r.title) == "Other")
        unclassified = [{"title": t, "leads": n} for t, n in titles.most_common(10)]
    return {"dimension": dimension, "label": DIMENSIONS[dimension], "rows": rows[:ROW_CAP], "more": max(0, len(rows) - ROW_CAP), "total": total,
            "compared": bool(prev_window), "min_sample": MIN_SAMPLE,
            "coverage": {"leads": len(seg), "filled": len(seg) - missing, "pct": round(100 * (len(seg) - missing) / len(seg)) if seg else 0},
            "unclassified_titles": unclassified, "icp_keywords": keywords}


STAGES = ("Meeting booked", "Spoke, no meeting", "Tried, not reached", "Email / notes only")
PEOPLE_CAP = 100


def accounts(db, uids, start, end, min_seconds, memo=None, stage=None):
    """Companies worked in the window: how many people were tried, how many spoke, and where each one stands. `stage` lists only the
    accounts at that stage (the summary still counts them all)."""
    ev, leads = _load(db, uids, start, end, min_seconds, memo)
    per = defaultdict(lambda: {"names": Counter(), "people": set(), "spoke": set(), "calls": 0, "emails": 0, "conversations": 0, "booked": 0, "held": 0})
    key_of = {l: funnel.account_key(r.company, r.website, r.email) or f"{funnel.UNMATCHED}{l}" for l, r in leads.items()}
    for kind, ids in ev.items():
        for l in ids:
            if l not in leads:
                continue
            a = per[key_of[l]]
            if kind in a:
                a[kind] += 1
            if kind == "conversations":
                a["spoke"].add(l)
            if kind in ("calls", "emails", "conversations", "booked"):
                a["people"].add(l)
            a["names"][_clean(leads[l].company) or "(no company)"] += 1
    rows = []
    for k, a in per.items():
        if a["booked"]:
            st = "Meeting booked"
        elif a["conversations"]:
            st = "Spoke, no meeting"
        elif a["calls"]:
            st = "Tried, not reached"
        else:
            st = "Email / notes only"
        rows.append({"key": k, "account": a["names"].most_common(1)[0][0], "people_tried": len(a["people"]), "people_spoke": len(a["spoke"]),
                     "calls": a["calls"], "conversations": a["conversations"], "emails": a["emails"], "booked": a["booked"], "held": a["held"], "stage": st})
    rows.sort(key=lambda r: (-r["booked"], -r["conversations"], -r["calls"], r["account"]))
    stages = Counter(r["stage"] for r in rows)
    multi = sum(1 for r in rows if r["people_spoke"] >= 2)
    shown = [r for r in rows if not stage or r["stage"] == stage]
    return {"rows": shown[:ROW_CAP], "more": max(0, len(shown) - ROW_CAP), "stage": stage or "",
            "summary": {"accounts": len(rows), "people_per_account": round(sum(r["people_tried"] for r in rows) / len(rows), 1) if rows else 0,
                        "spoke_to_two_or_more": multi, "stages": {s: stages.get(s, 0) for s in STAGES}}}


def people(db, uids, start, end, min_seconds, memo=None, dimension=None, segment=None, account=None):
    """The leads behind one row of a breakdown (`dimension` + `segment`) or one account (`account` = its key), with what was done on
    each in the window - so a number can be followed to the people. Best first: booked, then spoken to, then most called."""
    ev, leads = _load(db, uids, start, end, min_seconds, memo)
    keywords = icp_keywords(db) if dimension == "icp" else None
    if account is not None:
        keep = {l for l, r in leads.items() if (funnel.account_key(r.company, r.website, r.email) or f"{funnel.UNMATCHED}{l}") == account}
    else:
        keep = {l for l, r in leads.items() if segment_of(dimension, r, keywords) == segment}
    per = defaultdict(lambda: {"calls": 0, "emails": 0, "conversations": 0, "booked": 0, "held": 0})
    for kind, ids in ev.items():
        for l in ids:
            if l in keep and kind in per[l]:
                per[l][kind] += 1
            elif l in keep:
                per[l]            # notes: the lead was worked, nothing to count
    rows = [{"lead_id": l, "name": _clean(f"{leads[l].first_name or ''} {leads[l].last_name or ''}") or _clean(leads[l].email) or "(no name)",
             "company": _clean(leads[l].company), "title": _clean(leads[l].title), "status": leads[l].status, **c} for l, c in per.items()]
    rows.sort(key=lambda r: (-r["booked"], -r["conversations"], -r["calls"], r["name"].lower()))
    return {"rows": rows[:PEOPLE_CAP], "total": len(rows), "more": max(0, len(rows) - PEOPLE_CAP)}


DURATION_BANDS = ((30, "Under 30s"), (60, "30-60s"), (180, "1-3 min"), (600, "3-10 min"))


def valid_zone(name):
    """The time zone name if it is a real one, else None (it only labels hours, so a bad value is ignored, not an error)."""
    try:
        from zoneinfo import ZoneInfo
        return name if name and ZoneInfo(name) else None
    except Exception:
        return None


def _hour(at, zone):
    if at is None:
        return None
    return (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).astimezone(zone).hour


def calls(db, uids, start, end, min_seconds, tz_name=None):
    """What happened on the phone: outcomes, the hours that connect, and how long conversations last. Manual call logs have an
    outcome only; dialer calls also have a length."""
    try:
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(tz_name) if tz_name else timezone.utc
    except Exception:
        zone = timezone.utc
    uids = list(uids)
    outcomes, hours, lengths = Counter(), defaultdict(lambda: [0, 0]), Counter()
    tot = [0, 0]                                   # calls, conversations

    def tally(outcome, at, conv):
        outcomes[_clean(outcome) or "Not logged"] += 1
        tot[0] += 1
        tot[1] += bool(conv)
        h = _hour(at, zone)
        if h is not None:
            hours[h][0] += 1
            hours[h][1] += bool(conv)

    if uids:
        C, D = models.CallLog, models.DialerCall
        for outcome, at, conv in db.query(C.outcome, C.called_at, models.call_log_is_conversation()).filter(
                C.user_id.in_(uids), C.called_at.between(start, end)):
            tally(outcome, at, conv)
        at_col = models.dialer_call_event_time()
        paired = db.query(C.dialer_call_id).filter(C.dialer_call_id.isnot(None))
        for outcome, dur, at, conv in db.query(D.outcome, D.duration, at_col, models.dialer_call_is_conversation(min_seconds)).filter(
                D.user_id.in_(uids), D.direction == "outbound", at_col.between(start, end), ~D.id.in_(paired)):
            tally(outcome, at, conv)
            if conv and dur:
                lengths[next((b for top, b in DURATION_BANDS if dur <= top), "Over 10 min")] += 1
    total, spoke = tot
    order = [b for _n, b in DURATION_BANDS] + ["Over 10 min"]
    return {"total": total, "conversations": spoke, "connect_rate": round(100 * spoke / total, 1) if total else 0,
            "outcomes": [{"outcome": o, "calls": n} for o, n in outcomes.most_common()],
            "by_hour": [{"hour": h, "calls": hours[h][0], "conversations": hours[h][1],
                         "connect_rate": round(100 * hours[h][1] / hours[h][0], 1) if hours[h][0] else 0} for h in sorted(hours)],
            "conversation_lengths": [{"band": b, "conversations": lengths.get(b, 0)} for b in order],
            "timezone": tz_name or "UTC"}
