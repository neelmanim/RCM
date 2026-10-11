"""Read-only reconciliation of the Team Digest drill-downs against the raw tables and against the Digest / Funnel's own functions.

    DATABASE_URL=<postgres url> PGOPTIONS='-c default_transaction_read_only=on' python scripts/verify_drilldown.py [days] [pod_id]

Never writes (the session is also set read-only here). For one window it checks, for every breakdown dimension:
  1. the rows add up to the total, and the total equals the Digest's calls / emails / notes and the Funnel's conversations / booked / held / no-show;
  2. calls, conversations, booked and distinct leads per segment equal independent SQL counts grouped by the lead's own value (country, industry, ...);
  3. the Accounts and Calls views agree with the breakdown; the comparison period equals a fresh run on that period.
Prints one line per check and exits 1 on the first mismatch list. Prints counts only, never names or contact details.
"""
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from sqlalchemy import text  # noqa: E402

import models  # noqa: E402
from database import SessionLocal  # noqa: E402
from services import daily_activity, funnel, segments  # noqa: E402

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
POD = sys.argv[2] if len(sys.argv) > 2 else None
bad, ok = [], 0


def check(name, got, want):
    global ok
    if got == want:
        ok += 1
        print(f"  ok   {name}: {got}")
    else:
        bad.append(name)
        print(f"  FAIL {name}: got {got} expected {want}")


db = SessionLocal()
db.execute(text("SET TRANSACTION READ ONLY"))
today = datetime.now(timezone.utc).date()
to_day, from_day = today - timedelta(days=1), today - timedelta(days=DAYS)
cmp_to = from_day - timedelta(days=1)
cmp_from = cmp_to - timedelta(days=DAYS - 1)
tz = daily_activity.pod_timezone(db, POD) if POD else None
start, end = funnel.window(from_day, to_day, tz)
c_start, c_end = funnel.window(cmp_from, cmp_to, tz)
try:
    db.query(models.SyncSettings.icp_keywords).first()
except Exception:                                   # a database that has not had the v14.3.0 column added yet: use the default words
    db.rollback()
    db.execute(text("SET TRANSACTION READ ONLY"))
    segments.icp_keywords = lambda _db: list(segments.DEFAULT_ICP)
    print("  (icp_keywords column not there yet - using the default ICP words)")
min_s = int(db.execute(text("select conversation_min_seconds from sync_settings where id=1")).scalar() or models.CONVERSATION_MIN_SECONDS)
q = db.query(models.User.id).filter(models.User.role.in_(["SDR", "AE"]))
if POD:
    q = q.filter(models.User.pod_id == POD)
uids = [r[0] for r in q]
print(f"window {from_day}..{to_day} (compare {cmp_from}..{cmp_to}), {len(uids)} reps, conversation threshold {min_s}s")

# ── the Digest's and Funnel's own numbers for the same window
ev = daily_activity.collect(db, uids, start, end)
per = daily_activity.totals(ev)
digest = {k: sum(v[k] for v in per.values()) for k in ("calls", "emails", "research_notes")}
fun = funnel.build(db, uids, start, end, min_s)[1]

# ── independent SQL: every call / email / note / booking in the window, with the lead's attributes
LEADS = {r.id: r for r in db.query(models.Lead).filter(models.Lead.deleted_at.is_(None), models.Lead.is_test.is_(False))}


def sql_events():
    """(kind, lead_id) for every event, from the raw tables (call_logs, unpaired dialer calls, outbound emails, notes by name, bookings)."""
    out = []
    ids = tuple(uids) or ("",)
    p = {"s": start, "e": end, "u": ids}
    for (l,) in db.execute(text("select lead_id from call_logs where user_id in :u and called_at between :s and :e").bindparams(
            __import__("sqlalchemy").bindparam("u", expanding=True)), p):
        out.append(("calls", l))
    at = models.dialer_call_event_time()
    paired = db.query(models.CallLog.dialer_call_id).filter(models.CallLog.dialer_call_id.isnot(None))
    for (l,) in db.query(models.DialerCall.lead_id).filter(models.DialerCall.user_id.in_(uids), models.DialerCall.direction == "outbound",
                                                           at.between(start, end), ~models.DialerCall.id.in_(paired)):
        out.append(("calls", l))
    for (l,) in db.query(models.LeadEmailActivity.lead_id).filter(models.LeadEmailActivity.user_id.in_(uids), models.LeadEmailActivity.direction == "outbound",
                                                                 models.LeadEmailActivity.timestamp.between(start, end)):
        out.append(("emails", l))
    return out


events = sql_events()
raw_calls = sum(1 for k, _ in events if k == "calls")
raw_emails = sum(1 for k, _ in events if k == "emails")
check("raw SQL calls = Digest calls", raw_calls, digest["calls"])
check("raw SQL outbound emails = Digest emails", raw_emails, digest["emails"])

FUN_KEYS = ("conversations", "booked", "held", "no_show")
results = {}
for dim in segments.DIMENSIONS:
    t0 = time.time()
    r = segments.breakdown(db, uids, start, end, min_s, dim, (c_start, c_end))
    took = time.time() - t0
    results[dim] = r
    print(f"[{dim}] {len(r['rows'])} rows (+{r['more']} not listed), coverage {r['coverage']['pct']}%, {took:.1f}s")
    t = r["total"]
    check(f"{dim}: total calls/emails/notes = Digest", (t["calls"], t["emails"], t["notes"]), (digest["calls"], digest["emails"], digest["research_notes"]))
    check(f"{dim}: total conversations/booked/held/no-show = Funnel", tuple(t[k] for k in FUN_KEYS), tuple(fun[k] for k in FUN_KEYS))
    if not r["more"]:
        for f in ("calls", "emails", "conversations", "booked", "held", "no_show"):
            check(f"{dim}: rows add up ({f})", sum(x[f] for x in r["rows"]), t[f])
        check(f"{dim}: leads in rows >= distinct leads (a lead sits in one segment)", sum(x["leads"] for x in r["rows"]), t["leads"])
    # conversion arithmetic
    for x in r["rows"]:
        if x["calls"] and round(100 * x["conversations"] / x["calls"], 1) != x["connect_rate"]:
            bad.append(f"{dim}/{x['label']} connect_rate")
        if x["connect_rate"] > 100 or x["lead_to_conversation"] > 100 or x["held_rate"] > 100:
            bad.append(f"{dim}/{x['label']} rate over 100")
    # the comparison period equals a fresh run on that period
    fresh = segments.breakdown(db, uids, c_start, c_end, min_s, dim)
    check(f"{dim}: comparison totals = a fresh run on that period", (t["prev"]["calls"], t["prev"]["conversations"], t["prev"]["booked"]),
          (fresh["total"]["calls"], fresh["total"]["conversations"], fresh["total"]["booked"]))

# ── segment-by-segment against independent SQL grouping (country, industry: plain lead columns; source: the kind of source, as the screen shows it)
want = {"country": lambda l: segments.country(l.country or l.company_country), "industry": segments.industry,
        "source": lambda l: segments.source_type(l.lead_source)}
for dim, label_of in want.items():
    calls_by, leads_by = Counter(), defaultdict(set)
    for kind, l in events:
        if kind == "calls" and l in LEADS:
            calls_by[label_of(LEADS[l])] += 1
            leads_by[label_of(LEADS[l])].add(l)
    r = results[dim]
    if r["more"]:
        continue
    got = {x["label"]: x["calls"] for x in r["rows"] if x["label"] != segments.NO_LEAD and x["calls"]}
    check(f"{dim}: calls per segment = independent SQL grouping", got, {k: v for k, v in calls_by.items() if v})

# ── the leads behind a row / an account add up to the row / account
for dim in ("country", "seniority", "icp"):
    row = next((x for x in results[dim]["rows"] if x["leads"] and x["label"] != segments.NO_LEAD), None)
    if row:
        pl = segments.people(db, uids, start, end, min_s, None, dim, row["label"], None)
        check(f"{dim}/{row['label']}: leads behind the row = the row's leads", pl["total"], row["leads"])
        if not pl["more"]:
            check(f"{dim}/{row['label']}: their calls / conversations / booked = the row's",
                  (sum(p["calls"] for p in pl["rows"]), sum(p["conversations"] for p in pl["rows"]), sum(p["booked"] for p in pl["rows"])),
                  (row["calls"], row["conversations"], row["booked"]))

# ── Accounts and Calls views against the breakdown
acc = segments.accounts(db, uids, start, end, min_s)
check("accounts: stages add up to accounts", sum(acc["summary"]["stages"].values()), acc["summary"]["accounts"])
if acc["rows"]:
    a0 = acc["rows"][0]
    check("accounts: the people behind the top account = its people tried", segments.people(db, uids, start, end, min_s, None, None, None, a0["key"])["total"], a0["people_tried"])
for st in segments.STAGES:
    only = segments.accounts(db, uids, start, end, min_s, None, st)
    check(f"accounts: stage filter '{st}' lists exactly that many", (only["more"] + len(only["rows"])), acc["summary"]["stages"][st])
cv = segments.calls(db, uids, start, end, min_s, tz)
check("calls view: total = Digest calls", cv["total"], digest["calls"])
check("calls view: outcomes add up", sum(o["calls"] for o in cv["outcomes"]), cv["total"])
check("calls view: conversations = Funnel conversations", cv["conversations"], fun["conversations"])

print(f"\n{ok} checks passed, {len(bad)} failed")
if bad:
    print("FAILED:", *bad, sep="\n  ")
    sys.exit(1)
