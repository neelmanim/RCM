# ── csm_health.py — CSM Portal health-score helper ─────────────────────────
#
# Pure function, no DB access — callers (csm_portal_routes.py) fetch the
# rows and pass them in. Weighted average over a list of (name, weight,
# value) factors rather than a hardcoded 2-term formula, so adding
# Usage/Support later (see the plan's launch-readiness gaps) is "append to
# the list", not "rewrite the function".
from datetime import datetime, timezone

# Only 2 factors exist today (see _MISSING_FACTORS below for why). Equal
# weighting until product tells us otherwise — the weights are normalised,
# so adding a factor here needs no rebalancing of the existing ones.
_FACTOR_WEIGHTS = {"commercial": 0.5, "relationship": 0.5}

# ponytail: 30-day silent-account threshold, matches the plan's own
# "no touch in 30+ days = low" language and the Silent Account playbook.
_SILENT_DAYS = 30
_CHAMPION_DEPARTED_PENALTY = 30.0
# CSM feedback (2026-09-17): a CSM-tagged AccountStakeholder.role == "Champion"
# is a broader, always-available signal than ClosingBrief.champion_active
# (which only exists for accounts with an AE handover on a Closed-Won deal) —
# a small bonus rewards accounts where a champion is actually identified,
# without replacing the departure penalty logic below.
_CHAMPION_PRESENT_BONUS = 10.0
_NO_OPEN_OPP_SCORE = 15.0
_NO_TOUCH_EVER_SCORE = 20.0
# ponytail: a cleanly Closed-Won account with nothing currently open is a
# stable state (the deal is done, nothing pending), not a red flag — it
# used to score the same _NO_OPEN_OPP_SCORE as an account with no track
# record at all, which is what made every happily-closed customer read
# "Critical". Only "no open opp AND never won anything" keeps the low score.
_STABLE_NO_OPEN_OPP_SCORE = 70.0
# ponytail: same root cause on the relationship side — a brand-new account
# scored identically to a genuinely silent one just because no CSM had
# gotten to it yet. A grace window (same length as the silent-account
# threshold) gives a new account a neutral score instead of an alarming one
# until enough time has actually passed to call it "silent".
_ONBOARDING_GRACE_DAYS = _SILENT_DAYS
_NEUTRAL_NEW_ACCOUNT_SCORE = 60.0

# Factors product wants but that have no data source at the company yet: no
# helpdesk tool (Support), no product-usage analytics (Usage), no billing
# integration (Payment), no NPS/CSAT (Sentiment) — see the plan's Phase 3+.
# This drives BOTH the `partial` flag and its label, so landing a real
# factor is "add it to _FACTOR_WEIGHTS, drop the name from here" and
# nothing else in this file or the UI needs touching. It used to be a
# hardcoded `"partial": True` plus a frozen prose string, which would have
# gone on claiming Usage/Support were missing forever.
_MISSING_FACTORS = ("Usage", "Support", "Payment", "Sentiment")


def _partial_label(missing) -> str:
    have = " + ".join(name.capitalize() for name in _FACTOR_WEIGHTS)
    return f"Based on {have} — {'/'.join(missing)} not yet available"


from time_utils import as_utc as _aware   # SQLite hands back naive datetimes; assume UTC


def _clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


def _commercial_factor(opportunities, now):
    """Higher = further-out renewal and/or bigger deal. No open opportunity
    at all is only concerning if there's also no track record of ever
    winning one (closed-lost, or nothing in the pipeline at all) — an
    account that's cleanly Closed-Won with nothing currently pending is a
    stable state, not a low-commercial one."""
    open_opps = [o for o in opportunities if not o.is_closed]
    if not open_opps:
        if any(o.is_won for o in opportunities):
            return _STABLE_NO_OPEN_OPP_SCORE
        return _NO_OPEN_OPP_SCORE

    def _sort_key(o):
        cd = _aware(o.close_date)
        return cd or datetime.max.replace(tzinfo=timezone.utc)

    primary = sorted(open_opps, key=_sort_key)[0]
    close_date = _aware(primary.close_date)
    days_out = (close_date - now).days if close_date else 180  # unknown date = neutral-ish
    date_score = _clamp((days_out / 365.0) * 100)
    amount_score = _clamp(((primary.amount or 0) / 100000.0) * 100)
    # Renewal runway is the dominant signal; deal size is a secondary nudge.
    return round(0.7 * date_score + 0.3 * amount_score, 1)


def _relationship_factor(account, activities, closing_briefs, stakeholders, now):
    """Higher = recently touched and champion still active. No touch ever,
    or a departed champion, both pull this down — matches the Silent
    Account / Champion Departure playbook logic. A brand-new account gets a
    grace window before "never touched" is held against it, same reasoning
    as the commercial factor's stable-closed-won case."""
    touches = [a for a in activities if a.kind == "csm_touch" and a.created_at]
    if touches:
        last_touch = max(_aware(a.created_at) for a in touches)
        days_since = (now - last_touch).days
        recency_score = _clamp(100 - (days_since / _SILENT_DAYS) * 100)
    else:
        # ponytail: customer_since only, not created_at — created_at is "when
        # this row was synced into Alternate CRM", which for a bulk historical
        # backfill would grace-period every account at once regardless of
        # how long they've actually been a customer. No customer_since known
        # at all -> no grace, same as before this fix.
        since = _aware(getattr(account, "customer_since", None))
        if since and (now - since).days < _ONBOARDING_GRACE_DAYS:
            recency_score = _NEUTRAL_NEW_ACCOUNT_SCORE
        else:
            recency_score = _NO_TOUCH_EVER_SCORE

    champion_departed = any(cb.champion_active is False for cb in closing_briefs)
    penalty = _CHAMPION_DEPARTED_PENALTY if champion_departed else 0.0
    champion_tagged = any(getattr(s, "role", None) == "Champion" for s in stakeholders)
    bonus = _CHAMPION_PRESENT_BONUS if (champion_tagged and not champion_departed) else 0.0
    return round(_clamp(recency_score - penalty + bonus), 1)


def compute_health_score(account, opportunities, activities, closing_briefs=(), stakeholders=()) -> dict:
    """score/tier are always the computed value; displayed_tier is the
    manual override (Account.manual_health_tier, launch-readiness gap #5)
    when set, else the computed tier — the override never replaces the
    number, only sits alongside it."""
    now = datetime.now(timezone.utc)

    commercial = _commercial_factor(opportunities, now)
    relationship = _relationship_factor(account, activities, closing_briefs, stakeholders, now)

    factors = [
        ("commercial", _FACTOR_WEIGHTS["commercial"], commercial),
        ("relationship", _FACTOR_WEIGHTS["relationship"], relationship),
    ]
    total_weight = sum(w for _, w, _ in factors) or 1.0
    score = round(sum(w * v for _, w, v in factors) / total_weight, 1)

    if score >= 70:
        tier = "Healthy"
    elif score >= 40:
        tier = "At Risk"
    else:
        tier = "Critical"

    override = getattr(account, "manual_health_tier", None)

    return {
        "score": score,
        "tier": tier,
        "displayed_tier": override or tier,
        "factors": {name: value for name, _, value in factors},
        "partial": bool(_MISSING_FACTORS),
        "partial_label": _partial_label(_MISSING_FACTORS) if _MISSING_FACTORS else "",
    }
