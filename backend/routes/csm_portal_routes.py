# ── routes/csm_portal_routes.py — CSM Portal Beta (Phase 2) ────────────────
#
# Account 360 / portfolio / playbooks for the CSM role. See
# `.claude/plans/i-was-working-on-idempotent-ritchie.md` (Phase 2 +
# launch-readiness gaps). Wired into main.py's app.include_router.
import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import require_admin_or_csm
from csm_health import compute_health_score, _aware
from access_notifications import notify_account_assigned_in_background
from routes.ae_pipeline_routes import (
    CallLogBody, CloseBody, UpdateBody, apply_opportunity_close, apply_opportunity_update, _writeback_enabled,
)
from salesforce import NEW_RENEWAL_STAGE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/csm-portal", tags=["csm-portal"])

# Weekly Digest's "time saved" figure is explicitly an estimate (per the
# plan) — one assumed constant, not a measured value.
_ASSUMED_MINUTES_PER_PLAYBOOK = 15
_VALID_TIERS = ("Critical", "At Risk", "Healthy")
# CSM feedback (2026-09-17): renewal risk was only visible by opening the
# Inbox and reading the health score — nothing surfaced it proactively.
# Digest now counts open opportunities closing within this window (overdue
# ones count too, they're the most urgent) so it shows up without a click.
_RENEWAL_REMINDER_DAYS = 30
_VALID_STAKEHOLDER_ROLES = ("POC", "Billing", "Champion", "Decision Maker")
# "Contact change alert" (CSM feedback item #7): flag a stakeholder as newly
# added using SF's own Contact.CreatedDate — same threshold shape as
# csm_health's silent-account window, no separate bookkeeping needed.
_RECENT_CONTACT_DAYS = 14
# CSM feedback item #8: engagement cadence timeline. Portal-native (no SF
# object backs this, see AccountMilestone's doc comment) — a fixed category
# list keeps the timeline groupable/iconable while `label` carries the
# specific instance name ("QBR 1", "QBR 2", ...).
_VALID_MILESTONE_TYPES = ("Onboarding", "Go-Live", "QBR", "Renewal", "Custom")
# _ADMIN_ROLES stays Super Admin/Admin only — full-org visibility and
# bulk-assign (bulk_assign_accounts checks this list explicitly) are not a
# Pod Admin power. Pod Admin gets its own, narrower tier in
# _effective_csm_scope below (decided 2026-09-17, see require_admin_or_csm's
# doc comment): oversight of their own pod's CSMs, not everyone.
_ADMIN_ROLES = ("Super Admin", "Admin")


# ── scope helpers ────────────────────────────────────────────────────────

def _pod_csm_ids(db: Session, user: dict) -> list:
    """Every CSM in this Pod Admin's own pod (User.pod_id) — same field
    leaderboard_routes/analytics_digest_routes read for Pod Admin scoping.
    Not the pod_admins join table, which only tracks who administers a pod
    for audit purposes, not who's a member of it."""
    pod_id = user.get("pod_id")
    if not pod_id:
        return []
    return [
        row[0] for row in
        db.query(models.User.id).filter(models.User.pod_id == pod_id, models.User.role == "CSM").all()
    ]


def _effective_csm_scope(db: Session, user: dict, csm_id: Optional[str] = None) -> Optional[list]:
    """Three tiers. Super Admin/Admin: None = everyone, or narrowed to the
    given ?csm_id. Pod Admin: every CSM in their own pod, optionally
    narrowed to ?csm_id if it's actually one of theirs (an id outside their
    pod yields an empty list, not everyone). CSM: always forced to their own
    id, ?csm_id is ignored."""
    role = user.get("role")
    if role in _ADMIN_ROLES:
        return [csm_id] if csm_id else None
    if role == "Pod Admin":
        pod_csm_ids = _pod_csm_ids(db, user)
        if csm_id:
            return [csm_id] if csm_id in pod_csm_ids else []
        return pod_csm_ids
    return [user.get("sub")]


def _scoped_accounts_query(db: Session, user: dict, csm_id: Optional[str] = None):
    q = db.query(models.Account)
    scope = _effective_csm_scope(db, user, csm_id)
    if scope is not None:
        q = q.filter(models.Account.assigned_csm_id.in_(scope))
    return q


def _get_scoped_account_or_404(db: Session, user: dict, account_id: str) -> models.Account:
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    scope = _effective_csm_scope(db, user, None)
    in_scope = scope is None or account.assigned_csm_id in scope
    if not in_scope:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def _require_account_write_access(user: dict, account: models.Account):
    """Same split as ae_pipeline_routes._require_write_access: admins read
    every portfolio (they need to — bulk-assign is Super-Admin-only), but
    acting on an account is the assigned CSM's job.

    Logging a touch is not a neutral read: the first CSM touch is what LOCKS
    the AE's ClosingBrief, and touch recency is half the relationship factor
    in csm_health's score. An admin clicking through accounts would silently
    lock briefs and make genuinely silent accounts look freshly tended.

    Deliberately NOT applied to health-override, which the plan specifies as
    "CSM or Super Admin can force… logged with who/when/why" — that one is a
    designed escape hatch with an audit trail, not an accident.

    An unassigned account stays writable by an admin: that's the day-one
    backfill case, where nobody owns it yet.

    Pod Admin falls through to the same 403 as any non-owning CSM would —
    `_ADMIN_ROLES` deliberately excludes it (see this file's top-level
    comment), so a Pod Admin's read access to their pod's accounts
    (_effective_csm_scope) never implies write access. Matches the decision:
    a CSM manager sees her team's account performance, she doesn't act on
    their behalf.
    """
    if account.assigned_csm_id is None and user.get("role") in _ADMIN_ROLES:
        return
    if account.assigned_csm_id != user.get("sub"):
        raise HTTPException(
            status_code=403,
            detail="This account is assigned to another CSM. Reassign it first if you need to act on it.",
        )


# ── data-bundling + serialization helpers (shared by portfolio + 360) ────

def _account_bundle(db: Session, account: models.Account):
    """One place that fetches everything compute_health_score needs, reused
    by /portfolio and /accounts/{id} instead of two ad-hoc query sets."""
    opportunities = (
        db.query(models.Opportunity)
        .filter(models.Opportunity.account_id == account.id)
        .all()
    )
    activities = (
        db.query(models.AccountActivity)
        .filter(models.AccountActivity.account_id == account.id)
        .order_by(models.AccountActivity.created_at.desc())
        .all()
    )
    opp_ids = [o.id for o in opportunities]
    closing_briefs = (
        db.query(models.ClosingBrief)
        .filter(models.ClosingBrief.opportunity_id.in_(opp_ids))
        .all()
        if opp_ids
        else []
    )
    stakeholders = (
        db.query(models.AccountStakeholder)
        .filter(models.AccountStakeholder.account_id == account.id)
        .all()
    )
    health = compute_health_score(account, opportunities, activities, closing_briefs, stakeholders)
    return opportunities, activities, closing_briefs, health


def _account_bundles_batch(db: Session, accounts):
    """Same shape as _account_bundle, but one query per table for the whole
    account list instead of three per account — /portfolio and /digest were
    doing N*3 queries and it showed up as "takes forever to load" on any
    CSM's real book of accounts. Returns {account_id: (opps, activities, briefs, health)}."""
    account_ids = [a.id for a in accounts]
    if not account_ids:
        return {}

    opps_by_account = {}
    for o in db.query(models.Opportunity).filter(models.Opportunity.account_id.in_(account_ids)).all():
        opps_by_account.setdefault(o.account_id, []).append(o)

    activities_by_account = {}
    for a in (
        db.query(models.AccountActivity)
        .filter(models.AccountActivity.account_id.in_(account_ids))
        .order_by(models.AccountActivity.created_at.desc())
        .all()
    ):
        activities_by_account.setdefault(a.account_id, []).append(a)

    all_opp_ids = [o.id for opps in opps_by_account.values() for o in opps]
    briefs_by_opp = {}
    if all_opp_ids:
        for b in db.query(models.ClosingBrief).filter(models.ClosingBrief.opportunity_id.in_(all_opp_ids)).all():
            briefs_by_opp.setdefault(b.opportunity_id, []).append(b)

    stakeholders_by_account = {}
    for s in db.query(models.AccountStakeholder).filter(models.AccountStakeholder.account_id.in_(account_ids)).all():
        stakeholders_by_account.setdefault(s.account_id, []).append(s)

    result = {}
    for account in accounts:
        opportunities = opps_by_account.get(account.id, [])
        activities = activities_by_account.get(account.id, [])
        closing_briefs = [b for o in opportunities for b in briefs_by_opp.get(o.id, [])]
        stakeholders = stakeholders_by_account.get(account.id, [])
        health = compute_health_score(account, opportunities, activities, closing_briefs, stakeholders)
        result[account.id] = (opportunities, activities, closing_briefs, health)
    return result


def _primary_closing_brief(opportunities, closing_briefs):
    """The brief that matters for display/champion-departure: prefer the one
    tied to the account's Closed-Won opportunity (the handover moment), fall
    back to whichever brief exists if that link is ambiguous."""
    if not closing_briefs:
        return None
    won_ids = {o.id for o in opportunities if o.is_won}
    return next((b for b in closing_briefs if b.opportunity_id in won_ids), closing_briefs[0])


def _iso(dt):
    return dt.isoformat() if dt else None


def _serialize_opportunity(o: models.Opportunity) -> dict:
    return {
        "id": o.id,
        "sf_opportunity_id": o.sf_opportunity_id,
        "name": o.name,
        "amount": o.amount,
        "close_date": _iso(o.close_date),
        "stage_name": o.stage_name,
        "is_closed": o.is_closed,
        "is_won": o.is_won,
        "owner_user_id": o.owner_user_id,
        "sf_push_status": o.sf_push_status,
        "sf_push_error": o.sf_push_error,
        "sf_push_at": _iso(o.sf_push_at),
    }


def _serialize_closing_brief(b: models.ClosingBrief) -> dict:
    return {
        "id": b.id,
        "opportunity_id": b.opportunity_id,
        "champion_name": b.champion_name,
        "champion_role": b.champion_role,
        "champion_contact": b.champion_contact,
        "promises_made": b.promises_made,
        "handover_notes": b.handover_notes,
        "locked": b.locked,
        "champion_active": b.champion_active,
    }


def _serialize_stakeholder(s: models.AccountStakeholder) -> dict:
    is_new = bool(s.sf_created_at and (datetime.now(timezone.utc) - _aware(s.sf_created_at)).days <= _RECENT_CONTACT_DAYS)
    return {
        "id": s.id,
        "name": s.name,
        "email": s.email,
        "phone": s.phone,
        "title": s.title,
        "role": s.role,
        "is_new": is_new,
    }


def _serialize_milestone(m: models.AccountMilestone) -> dict:
    return {
        "id": m.id,
        "milestone_type": m.milestone_type,
        "label": m.label,
        "milestone_date": _iso(m.milestone_date),
        "ae_name": m.ae_name,
        "use_cases": m.use_cases,
        "cs_name": m.cs_name,
        "summary": m.summary,
        "action_items": m.action_items,
        "poc_stakeholder_ids": [sid for sid in (m.poc_stakeholder_ids or "").split(",") if sid],
        "created_at": _iso(m.created_at),
    }


def _serialize_activity(a: models.AccountActivity) -> dict:
    return {
        "id": a.id,
        "kind": a.kind,
        "note": a.note,
        "created_by": a.created_by,
        "created_at": _iso(a.created_at),
    }


def _serialize_account_summary(account: models.Account, opportunities, activities, closing_briefs, health: dict) -> dict:
    """Portfolio/Inbox row shape. Also carries the few extra fields
    (last_touch_at, closing_brief_locked, champion_active) the Playbooks tab
    needs to triage which of the 4 cards are actionable per-account — pulled
    from data _account_bundle already fetched, no extra queries."""
    # ponytail: deterministic pick when an account somehow has 2+ open
    # opportunities at once (e.g. an upsell in flight during a renewal) —
    # soonest close date first, matching csm_health's own urgency ordering.
    open_opps = [o for o in opportunities if not o.is_closed]
    open_opp = min(open_opps, key=lambda o: _aware(o.close_date) or datetime.max.replace(tzinfo=timezone.utc)) if open_opps else None
    touches = [a for a in activities if a.kind == "csm_touch" and a.created_at]
    last_touch_at = max((a.created_at for a in touches), default=None)
    brief = _primary_closing_brief(opportunities, closing_briefs)
    return {
        "id": account.id,
        "name": account.name,
        "industry": account.industry,
        "assigned_csm_id": account.assigned_csm_id,
        "assigned_csm_name": account.assigned_csm.name if account.assigned_csm else account.sf_csm_name,
        "owner_name": account.owner.name if account.owner else account.sf_owner_name,
        "open_opportunity": _serialize_opportunity(open_opp) if open_opp else None,
        "health": health,
        "last_touch_at": _iso(last_touch_at),
        "closing_brief_locked": brief.locked if brief else None,
        "champion_active": brief.champion_active if brief else None,
    }


# ── request bodies ────────────────────────────────────────────────────────

class _TouchBody(BaseModel):
    note: str


class _HealthOverrideBody(BaseModel):
    tier: Optional[str] = None
    reason: str


class _RenewalOpportunityBody(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    close_date: Optional[str] = None  # "YYYY-MM-DD"


class _AssignBody(BaseModel):
    account_ids: list
    csm_id: str


class _StakeholderRoleBody(BaseModel):
    role: Optional[str] = None  # one of _VALID_STAKEHOLDER_ROLES, or None to clear


class _MilestoneBody(BaseModel):
    milestone_type: str
    label: str
    milestone_date: str  # "YYYY-MM-DD"
    ae_name: Optional[str] = None
    use_cases: Optional[str] = None
    cs_name: Optional[str] = None
    summary: Optional[str] = None
    action_items: Optional[str] = None
    poc_stakeholder_ids: Optional[list] = None


# ── endpoints ──────────────────────────────────────────────────────────────

@router.get("/stage-options")
def get_stage_options(user: dict = Depends(require_admin_or_csm), db: Session = Depends(get_db)):
    """Same picklist AE Pipeline exposes — see that module's docstring on
    get_stage_options for why this exists instead of free text."""
    from salesforce import get_sf_client, get_opportunity_stage_options_from_salesforce
    return get_opportunity_stage_options_from_salesforce(get_sf_client())


@router.get("/close-field-options")
def get_close_field_options(user: dict = Depends(require_admin_or_csm), db: Session = Depends(get_db)):
    """Same picklists AE Pipeline's own close-field-options exposes — a CSM
    closing their own renewal opportunity hits the same SF validation rules."""
    from salesforce import get_sf_client, get_standard_product_options_from_salesforce, get_lost_reason_options_from_salesforce
    sf = get_sf_client()
    return {
        "standard_product_names": get_standard_product_options_from_salesforce(sf),
        "lost_reasons": get_lost_reason_options_from_salesforce(sf),
    }


@router.get("/portfolio")
def get_portfolio(
    sort: Optional[str] = None,
    csm_id: Optional[str] = None,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    """Serves both the Portfolio tab (full list) and the Inbox tab
    (?sort=at_risk — worst computed score first) off one endpoint."""
    accounts = _scoped_accounts_query(db, user, csm_id).all()
    bundles = _account_bundles_batch(db, accounts)
    items = [
        _serialize_account_summary(account, *bundles[account.id])
        for account in accounts
    ]

    if sort == "at_risk":
        items.sort(key=lambda i: i["health"]["score"])

    return {"accounts": items, "count": len(items)}


@router.get("/accounts/{account_id}")
def get_account_360(
    account_id: str,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    account = _get_scoped_account_or_404(db, user, account_id)
    opportunities, activities, closing_briefs, health = _account_bundle(db, account)
    stakeholders = (
        db.query(models.AccountStakeholder)
        .filter(models.AccountStakeholder.account_id == account.id)
        .order_by(models.AccountStakeholder.name)
        .all()
    )
    milestones = (
        db.query(models.AccountMilestone)
        .filter(models.AccountMilestone.account_id == account.id)
        .order_by(models.AccountMilestone.milestone_date)
        .all()
    )

    brief = _primary_closing_brief(opportunities, closing_briefs)
    closing_brief = _serialize_closing_brief(brief) if brief else None
    closing_brief_reason = None if brief else "closed_before_handover_tracking"

    opp_ids = [o.id for o in opportunities]
    calls = (
        db.query(models.OpportunityCall)
        .filter(models.OpportunityCall.opportunity_id.in_(opp_ids))
        .order_by(models.OpportunityCall.called_at.desc())
        .all()
        if opp_ids
        else []
    )

    return {
        "account": {
            "id": account.id,
            "name": account.name,
            "industry": account.industry,
            "customer_since": _iso(account.customer_since),
            "assigned_csm_id": account.assigned_csm_id,
            "assigned_csm_name": account.assigned_csm.name if account.assigned_csm else None,
        },
        "opportunities": [_serialize_opportunity(o) for o in opportunities],
        "closing_brief": closing_brief,
        "closing_brief_reason": closing_brief_reason,
        "opportunity_calls": [
            {
                "id": c.id,
                "opportunity_id": c.opportunity_id,
                "user_id": c.user_id,
                "outcome": c.outcome,
                "notes": c.notes,
                "called_at": _iso(c.called_at),
            }
            for c in calls
        ],
        "activities": [_serialize_activity(a) for a in activities],
        "stakeholders": [_serialize_stakeholder(s) for s in stakeholders],
        "milestones": [_serialize_milestone(m) for m in milestones],
        "health": health,
    }


def _validate_milestone_body(body: _MilestoneBody) -> datetime:
    if body.milestone_type not in _VALID_MILESTONE_TYPES:
        raise HTTPException(status_code=400, detail=f"milestone_type must be one of {_VALID_MILESTONE_TYPES}")
    try:
        return datetime.strptime(body.milestone_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="milestone_date must be YYYY-MM-DD")


@router.post("/accounts/{account_id}/milestones")
def create_milestone(
    account_id: str,
    body: _MilestoneBody,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    account = _get_scoped_account_or_404(db, user, account_id)
    _require_account_write_access(user, account)
    milestone_date = _validate_milestone_body(body)

    milestone = models.AccountMilestone(
        account_id=account.id,
        milestone_type=body.milestone_type,
        label=body.label,
        milestone_date=milestone_date,
        ae_name=body.ae_name,
        use_cases=body.use_cases,
        cs_name=body.cs_name,
        summary=body.summary,
        action_items=body.action_items,
        poc_stakeholder_ids=",".join(body.poc_stakeholder_ids) if body.poc_stakeholder_ids else None,
        created_by=user.get("sub"),
    )
    db.add(milestone)
    db.commit()
    return _serialize_milestone(milestone)


@router.patch("/accounts/{account_id}/milestones/{milestone_id}")
def update_milestone(
    account_id: str,
    milestone_id: str,
    body: _MilestoneBody,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    account = _get_scoped_account_or_404(db, user, account_id)
    _require_account_write_access(user, account)
    milestone_date = _validate_milestone_body(body)

    milestone = db.query(models.AccountMilestone).filter(
        models.AccountMilestone.id == milestone_id,
        models.AccountMilestone.account_id == account.id,
    ).first()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")

    milestone.milestone_type = body.milestone_type
    milestone.label = body.label
    milestone.milestone_date = milestone_date
    milestone.ae_name = body.ae_name
    milestone.use_cases = body.use_cases
    milestone.cs_name = body.cs_name
    milestone.summary = body.summary
    milestone.action_items = body.action_items
    milestone.poc_stakeholder_ids = ",".join(body.poc_stakeholder_ids) if body.poc_stakeholder_ids else None
    db.commit()
    return _serialize_milestone(milestone)


@router.patch("/accounts/{account_id}/stakeholders/{stakeholder_id}")
def set_stakeholder_role(
    account_id: str,
    stakeholder_id: str,
    body: _StakeholderRoleBody,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    """CSM-set-only role tag (POC/Billing/Champion/Decision Maker) — SF has
    no field for this, see AccountStakeholder's doc comment."""
    account = _get_scoped_account_or_404(db, user, account_id)
    _require_account_write_access(user, account)
    if body.role is not None and body.role not in _VALID_STAKEHOLDER_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {_VALID_STAKEHOLDER_ROLES} or null")

    stakeholder = db.query(models.AccountStakeholder).filter(
        models.AccountStakeholder.id == stakeholder_id,
        models.AccountStakeholder.account_id == account.id,
    ).first()
    if not stakeholder:
        raise HTTPException(status_code=404, detail="Stakeholder not found")

    stakeholder.role = body.role
    db.commit()
    return _serialize_stakeholder(stakeholder)


@router.post("/accounts/{account_id}/touches")
def log_touch(
    account_id: str,
    body: _TouchBody,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    account = _get_scoped_account_or_404(db, user, account_id)
    _require_account_write_access(user, account)

    is_first_touch = (
        db.query(models.AccountActivity)
        .filter(
            models.AccountActivity.account_id == account.id,
            models.AccountActivity.kind == "csm_touch",
        )
        .count()
        == 0
    )

    activity = models.AccountActivity(
        account_id=account.id, kind="csm_touch", note=body.note, created_by=user.get("sub")
    )
    db.add(activity)

    brief_locked = False
    if is_first_touch:
        # Launch-readiness item 0c: the brief a CSM is acting on shouldn't
        # shift under them once they've started working the account.
        opp_ids = [
            o.id
            for o in db.query(models.Opportunity).filter(models.Opportunity.account_id == account.id).all()
        ]
        if opp_ids:
            briefs = (
                db.query(models.ClosingBrief)
                .filter(models.ClosingBrief.opportunity_id.in_(opp_ids), models.ClosingBrief.locked.is_(False))
                .all()
            )
            for b in briefs:
                b.locked = True
            brief_locked = len(briefs) > 0

    db.commit()
    db.refresh(activity)
    return {"activity": _serialize_activity(activity), "first_touch": is_first_touch, "brief_locked": brief_locked}


@router.post("/accounts/{account_id}/champion-departed")
def champion_departed(
    account_id: str,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    account = _get_scoped_account_or_404(db, user, account_id)
    _require_account_write_access(user, account)
    opportunities, _activities, closing_briefs, _health = _account_bundle(db, account)
    brief = _primary_closing_brief(opportunities, closing_briefs)
    if not brief:
        raise HTTPException(status_code=404, detail="No closing brief on this account to flag")

    brief.champion_active = False
    activity = models.AccountActivity(
        account_id=account.id,
        kind="playbook_champion_departure",
        note=f"Champion ({brief.champion_name or 'unknown'}) marked as departed",
        created_by=user.get("sub"),
    )
    db.add(activity)
    db.commit()
    db.refresh(brief)
    return {"closing_brief": _serialize_closing_brief(brief), "activity": _serialize_activity(activity)}


@router.post("/accounts/{account_id}/health-override")
def set_health_override(
    account_id: str,
    body: _HealthOverrideBody,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    if body.tier is not None and body.tier not in _VALID_TIERS:
        raise HTTPException(status_code=400, detail=f"tier must be one of {_VALID_TIERS} or null")
    # Deliberately not gated by _require_account_write_access (see its doc
    # comment — this is a designed CSM/Super-Admin escape hatch), but Pod
    # Admin's oversight is read-only by design (2026-09-17 decision), so it
    # gets an explicit block here rather than inheriting the broader hatch.
    if user.get("role") == "Pod Admin":
        raise HTTPException(status_code=403, detail="Pod Admin has read-only access to their team's accounts.")

    account = _get_scoped_account_or_404(db, user, account_id)

    account.manual_health_tier = body.tier
    account.health_override_by = user.get("sub") if body.tier else None
    account.health_override_at = datetime.now(timezone.utc) if body.tier else None
    account.health_override_reason = body.reason

    activity = models.AccountActivity(
        account_id=account.id,
        kind="health_override",
        note=body.reason,
        created_by=user.get("sub"),
    )
    db.add(activity)
    db.commit()
    db.refresh(account)

    _, _, _, health = _account_bundle(db, account)
    return {"health": health}


@router.post("/accounts/{account_id}/renewal-opportunity")
def create_renewal_opportunity(
    account_id: str,
    body: _RenewalOpportunityBody,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    account = _get_scoped_account_or_404(db, user, account_id)
    _require_account_write_access(user, account)

    close_date = None
    if body.close_date:
        try:
            close_date = datetime.strptime(body.close_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="close_date must be YYYY-MM-DD")

    opportunity = models.Opportunity(
        account_id=account.id,
        name=body.name or f"{account.name} — Renewal",
        amount=body.amount,
        close_date=close_date,
        stage_name=NEW_RENEWAL_STAGE,
        is_closed=False,
        is_won=False,
        owner_user_id=user.get("sub"),
    )
    db.add(opportunity)
    db.add(models.AccountActivity(
        account_id=account.id, kind="playbook_renewal_created",
        note=f"Renewal opportunity created — {opportunity.name}", created_by=user.get("sub"),
    ))
    # Local create must survive regardless of what happens next — commit
    # BEFORE attempting the SF push (same principle as
    # notify_*_in_background: a notification/side-effect never decides
    # whether the operation it describes succeeded).
    db.commit()
    db.refresh(opportunity)

    if _writeback_enabled(db):
        _push_new_opportunity_to_salesforce(
            opportunity_id=opportunity.id,
            sf_account_id=account.sf_account_id,
            name=opportunity.name,
            amount=opportunity.amount,
            close_date=opportunity.close_date,
        )

    return {"opportunity": _serialize_opportunity(opportunity)}


def _get_scoped_opportunity_or_404(db: Session, user: dict, account_id: str, opportunity_id: str) -> models.Opportunity:
    """A CSM can act on any Opportunity tied to one of their assigned
    accounts — not just ones they personally created — matching how the
    rest of CSM Portal scopes by account rather than by who owns the row.

    Both callers (update + close) are writes, so the write guard lives here
    rather than being repeated at each one."""
    account = _get_scoped_account_or_404(db, user, account_id)
    _require_account_write_access(user, account)
    opp = (
        db.query(models.Opportunity)
        .filter(models.Opportunity.id == opportunity_id, models.Opportunity.account_id == account.id)
        .first()
    )
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found on this account")
    return opp


@router.patch("/accounts/{account_id}/opportunities/{opportunity_id}")
def update_account_opportunity(
    account_id: str, opportunity_id: str, body: UpdateBody,
    user: dict = Depends(require_admin_or_csm), db: Session = Depends(get_db),
):
    """Lets a CSM progress their own renewal (stage / close date) without
    opening Salesforce — same core logic as AE Pipeline's update endpoint,
    reused via apply_opportunity_update."""
    opp = _get_scoped_opportunity_or_404(db, user, account_id, opportunity_id)
    opp = apply_opportunity_update(db, opp, body, user.get("sub"))
    return _serialize_opportunity(opp)


@router.post("/accounts/{account_id}/opportunities/{opportunity_id}/close")
def close_account_opportunity(
    account_id: str, opportunity_id: str, body: CloseBody,
    user: dict = Depends(require_admin_or_csm), db: Session = Depends(get_db),
):
    """Closes the point AE Pipeline's own close endpoint (require_admin_or_ae)
    doesn't cover: a CSM's own renewal Opportunity would otherwise dead-end —
    created here, but only an AE/Admin could ever mark it Won/Lost. Same core
    logic as AE Pipeline's close, reused via apply_opportunity_close."""
    opp = _get_scoped_opportunity_or_404(db, user, account_id, opportunity_id)
    opp = apply_opportunity_close(db, opp, body, user.get("sub"))
    return _serialize_opportunity(opp)


@router.post("/accounts/{account_id}/opportunities/{opportunity_id}/calls")
def log_account_opportunity_call(
    account_id: str, opportunity_id: str, body: CallLogBody,
    user: dict = Depends(require_admin_or_csm), db: Session = Depends(get_db),
):
    """CSM Portal's counterpart to AE Pipeline's log_opportunity_call — a CSM
    has no Lead to place a call against, but calling a champion/contact on
    an account they own is a normal action. Logs against the account's own
    Opportunity so it shows up in Account 360's call history exactly like an
    AE-logged call does."""
    opp = _get_scoped_opportunity_or_404(db, user, account_id, opportunity_id)
    call = models.OpportunityCall(
        opportunity_id=opp.id, user_id=user.get("sub"),
        outcome=body.outcome, notes=body.notes,
    )
    db.add(call)
    db.commit()
    db.refresh(call)
    return {
        "id": call.id,
        "opportunity_id": call.opportunity_id,
        "user_id": call.user_id,
        "outcome": call.outcome,
        "notes": call.notes,
        "called_at": _iso(call.called_at),
    }


def _push_opportunity_to_sf(opportunity_id, payload):
    """The actual SF call + local sf_opportunity_id write-back. Extracted
    from _push_new_opportunity_to_salesforce so it's a plain callable —
    tests can invoke it directly to exercise the error path without needing
    a real thread (daemon threads are no-ops under pytest, see conftest's
    _suppress_daemon_threads)."""
    from salesforce import get_sf_client
    from database import SessionLocal

    try:
        sf = get_sf_client()
        if not sf:
            logger.warning("[CSM Portal] No SF client available for opportunity %s", opportunity_id)
            return
        response = sf.Opportunity.create(payload)
        sf_id = response.get("id")
        with SessionLocal() as thread_db:
            opp = thread_db.query(models.Opportunity).filter(models.Opportunity.id == opportunity_id).first()
            if opp:
                opp.sf_opportunity_id = sf_id
                opp.last_synced_at = datetime.now(timezone.utc)
                opp.sf_push_status = "success"
                opp.sf_push_error = None
                opp.sf_push_at = datetime.now(timezone.utc)
                thread_db.commit()
    except Exception as e:
        logger.error("[CSM Portal] Failed to push new Opportunity %s to SF: %s", opportunity_id, e)
        # Same push-failure visibility as push_opportunity_to_salesforce (the
        # close/update path) — otherwise a renewal-creation failure was only
        # ever visible in this server log, never to the CSM who created it.
        with SessionLocal() as thread_db:
            opp = thread_db.query(models.Opportunity).filter(models.Opportunity.id == opportunity_id).first()
            if opp:
                opp.sf_push_status = "failed"
                opp.sf_push_error = str(e)[:2000]
                opp.sf_push_at = datetime.now(timezone.utc)
                thread_db.commit()


def _push_new_opportunity_to_salesforce(opportunity_id, sf_account_id, name, amount, close_date):
    """Mirrors lead_routes._check_sf_push's CREATE path: build the payload on
    the calling thread (while we still have plain values, no ORM/session
    dependency), then do the actual SF call + local write-back on a
    background thread so the request never waits on SF."""
    if not sf_account_id:
        logger.warning(
            "[CSM Portal] Skipping SF push for opportunity %s — account has no sf_account_id", opportunity_id
        )
        return

    payload = {
        "Name": name,
        "AccountId": sf_account_id,
        "StageName": NEW_RENEWAL_STAGE,
        "CloseDate": (close_date or (datetime.now(timezone.utc) + timedelta(days=90))).strftime("%Y-%m-%d"),
    }
    if amount:
        payload["Amount"] = amount

    threading.Thread(target=_push_opportunity_to_sf, args=(opportunity_id, payload), daemon=True).start()


@router.post("/accounts/assign")
def bulk_assign_accounts(
    body: _AssignBody,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    """Super Admin only — require_admin_or_csm alone also admits CSM, so
    check role explicitly here (launch-readiness gap #1's remaining piece).
    Plain synchronous bulk UPDATE: this is a local DB write with no external
    API call, unlike the AM bulk-backfill job that needed a background
    thread + progress poll because its per-record calls are slow/rate-limited."""
    if user.get("role") not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Super Admin access required")

    csm = db.query(models.User).filter(models.User.id == body.csm_id).first()
    if not csm:
        raise HTTPException(status_code=404, detail="CSM user not found")

    accounts = db.query(models.Account).filter(models.Account.id.in_(body.account_ids)).all()
    changed_account_ids = []
    for account in accounts:
        if account.assigned_csm_id != body.csm_id:
            changed_account_ids.append(account.id)
        account.assigned_csm_id = body.csm_id
    db.commit()

    for account_id in changed_account_ids:
        background_tasks.add_task(notify_account_assigned_in_background, user.get("sub"), body.csm_id, account_id)

    return {"updated": len(accounts), "notified": len(changed_account_ids)}


@router.get("/digest")
def get_digest(
    csm_id: Optional[str] = None,
    user: dict = Depends(require_admin_or_csm),
    db: Session = Depends(get_db),
):
    accounts = _scoped_accounts_query(db, user, csm_id).all()
    account_ids = [a.id for a in accounts]
    bundles = _account_bundles_batch(db, accounts)

    critical_count = 0
    at_risk_count = 0
    for account in accounts:
        _opps, _acts, _briefs, health = bundles[account.id]
        tier = health["displayed_tier"]
        if tier == "Critical":
            critical_count += 1
        elif tier == "At Risk":
            at_risk_count += 1

    now = datetime.now(timezone.utc)
    renewals_due_soon_count = 0
    for account in accounts:
        opportunities, _acts, _briefs, _health = bundles[account.id]
        open_opps = [o for o in opportunities if not o.is_closed]
        close_dates = [_aware(o.close_date) for o in open_opps if o.close_date]
        if close_dates and (min(close_dates) - now).days <= _RENEWAL_REMINDER_DAYS:
            renewals_due_soon_count += 1

    week_ago = now - timedelta(days=7)
    playbook_count = 0
    if account_ids:
        # csm_touch counts too — logging a touch IS the Silent Account
        # playbook's execution, it just predates the "playbook_" naming
        # convention (touches also drive the health-score recency factor,
        # so its kind can't be renamed without breaking that lookup).
        playbook_count = (
            db.query(models.AccountActivity)
            .filter(
                models.AccountActivity.account_id.in_(account_ids),
                (models.AccountActivity.kind.like("playbook_%") | (models.AccountActivity.kind == "csm_touch")),
                models.AccountActivity.created_at >= week_ago,
            )
            .count()
        )

    return {
        "total_accounts": len(accounts),
        "critical_count": critical_count,
        "at_risk_count": at_risk_count,
        "renewals_due_soon_count": renewals_due_soon_count,
        "renewals_due_soon_label": f"Closing within {_RENEWAL_REMINDER_DAYS} days (or overdue)",
        "playbook_executions_this_week": playbook_count,
        "estimated_minutes_saved": playbook_count * _ASSUMED_MINUTES_PER_PLAYBOOK,
        "estimate_label": (
            f"Estimated — {playbook_count} playbook execution(s) this week "
            f"× {_ASSUMED_MINUTES_PER_PLAYBOOK} assumed minutes each"
        ),
    }
