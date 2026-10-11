"""
AE Pipeline Routes — /api/ae-pipeline

Phase 1 of the AE/CSM expansion: an AE's own view of their Opportunities
(synced pull-only from Salesforce, see salesforce.sync_opportunities_from_salesforce)
plus the "Close deal" action, which is bidirectional — it writes is_closed/
is_won/close_date/stage_name locally and pushes StageName + CloseDate back to
Salesforce via salesforce.push_opportunity_to_salesforce (fire-and-forget,
background thread, mirroring routes/lead_routes.py's _check_sf_push/_do_push
pattern). Only those two fields go out: SF derives IsClosed/IsWon from
StageName as read-only formula fields, so the stage carries the close.

Scoping mirrors leaderboard_routes.py's GET /leaderboard/ae and
analytics_routes.py's _effective_ae_sdr: an AE sees only Opportunities they
own, Super Admin/Admin/Pod Admin see all. require_admin_or_ae also admits
SDR (it's shared with Analytics Hub), so every handler here additionally
rejects role == "SDR" — AE Pipeline is not an SDR surface.
"""
import threading
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from auth import require_admin_or_ae
import access_db
import models
from salesforce import (
    _parse_sf_date, get_sf_client, get_opportunity_stage_options_from_salesforce,
    get_standard_product_options_from_salesforce, get_lost_reason_options_from_salesforce,
    CLOSED_WON_STAGE, CLOSED_LOST_STAGE,
)

router = APIRouter(prefix="/api/ae-pipeline", tags=["ae-pipeline"])

_ADMIN_ROLES = ("Super Admin", "Admin", "Pod Admin")


def _reject_sdr(user: dict):
    """require_admin_or_ae admits SDR (shared with Analytics Hub) — AE
    Pipeline must not, so every route rejects it explicitly."""
    if user.get("role") == "SDR":
        raise HTTPException(status_code=403, detail="AE Pipeline is not available to SDR")


def _pod_owner_ids(db: Session, user: dict):
    """Owners a Pod Admin may see: the AEs of their own pod (NO_POD matches nobody)."""
    return db.query(models.User.id).filter(models.User.pod_id == (access_db.pod_of(user)))


def _scoped_opportunity_query(db: Session, user: dict):
    q = db.query(models.Opportunity)
    if user.get("role") == "Pod Admin":        # v13.12.1: used to be every AE's deals org-wide
        q = q.filter(models.Opportunity.owner_user_id.in_(_pod_owner_ids(db, user)))
    elif user.get("role") not in _ADMIN_ROLES:
        # AE (the only remaining role after _reject_sdr): self-owned only.
        q = q.filter(models.Opportunity.owner_user_id == user.get("sub"))
    return q


def _get_owned_opportunity_or_403(db: Session, user: dict, opportunity_id: str) -> models.Opportunity:
    opp = db.query(models.Opportunity).filter(models.Opportunity.id == opportunity_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    if user.get("role") not in _ADMIN_ROLES and opp.owner_user_id != user.get("sub"):
        raise HTTPException(status_code=403, detail="Not your opportunity")
    if user.get("role") == "Pod Admin" and not db.query(_pod_owner_ids(db, user).filter(
            models.User.id == opp.owner_user_id).exists()).scalar():
        raise HTTPException(status_code=403, detail="That opportunity belongs to another POD")
    return opp


def _require_write_access(user: dict, opp: models.Opportunity):
    """Reading org-wide is oversight; writing org-wide is impersonation.

    _get_owned_opportunity_or_403 lets _ADMIN_ROLES through so admins can
    *see* every AE's deals — the same oversight the AE leaderboard already
    gives them. Every write route reused that helper, which handed admins
    far more than oversight: closing someone else's deal writes a
    ClosingBrief stamped with the admin's user id, locks it against the AE
    who actually ran the deal, fires the CSM handover email and pushes
    Closed-Won to Salesforce. Logging a call is worse per click — CallLog
    feeds the AE leaderboard, so an admin browsing inflates a rep's numbers.

    Nobody decided that; it fell out of sharing one helper between reads and
    writes. An unowned deal (owner_user_id is nullable — ondelete="SET NULL",
    so a departed rep's deals land here) stays writable by an admin, which
    is the real "close out the leaver's pipeline" case. Taking over a deal
    that still belongs to someone means reassigning it first, which leaves a
    trail the way acting silently as them does not.
    """
    if opp.owner_user_id is None and user.get("role") in _ADMIN_ROLES:
        return
    if opp.owner_user_id != user.get("sub"):
        raise HTTPException(
            status_code=403,
            detail="This deal belongs to another AE. Reassign the owner first if you need to act on it.",
        )


def _opportunity_row(opp: models.Opportunity) -> dict:
    return {
        "id": opp.id,
        "sf_opportunity_id": opp.sf_opportunity_id,
        "name": opp.name,
        "account_id": opp.account_id,
        "account_name": opp.account.name if opp.account else None,
        "amount": opp.amount,
        "stage_name": opp.stage_name,
        "close_date": opp.close_date.isoformat() if opp.close_date else None,
        "is_closed": opp.is_closed,
        "is_won": opp.is_won,
        "owner_user_id": opp.owner_user_id,
        # Admins see every AE's deals through this same endpoint
        # (_scoped_opportunity_query), and owner_user_id alone is a UUID the
        # UI can't render. Same shape as account_name above.
        "owner_name": opp.owner.name if opp.owner else None,
        "sf_push_status": opp.sf_push_status,
        "sf_push_error": opp.sf_push_error,
        "sf_push_at": opp.sf_push_at.isoformat() if opp.sf_push_at else None,
    }


@router.get("/opportunities/stage-options")
def get_stage_options(user: dict = Depends(require_admin_or_ae), db: Session = Depends(get_db)):
    """This org's real Opportunity.StageName picklist, so the "Update deal"
    form can render a dropdown instead of free text. Empty list (200) when
    SF isn't configured — the field just stays free text in that case, since
    there's nothing to push to and so no pollution risk."""
    _reject_sdr(user)
    return get_opportunity_stage_options_from_salesforce(get_sf_client())


@router.get("/opportunities/close-field-options")
def get_close_field_options(user: dict = Depends(require_admin_or_ae), db: Session = Depends(get_db)):
    """This org's real Standard_Product_Name__c and Opportunity_Lost_Reason__c
    picklists (live finding, 2026-09-15/16: required by SF validation rules
    before any Closed-stage push — lost_reasons only on a Lost close — plus
    a free-text invoice number) — same shape as stage-options above."""
    _reject_sdr(user)
    sf = get_sf_client()
    return {
        "standard_product_names": get_standard_product_options_from_salesforce(sf),
        "lost_reasons": get_lost_reason_options_from_salesforce(sf),
    }


@router.get("/opportunities")
def list_opportunities(user: dict = Depends(require_admin_or_ae), db: Session = Depends(get_db)):
    _reject_sdr(user)
    opps = _scoped_opportunity_query(db, user).order_by(models.Opportunity.close_date.asc()).all()
    return [_opportunity_row(o) for o in opps]


@router.get("/opportunities/{opportunity_id}")
def get_opportunity(opportunity_id: str, user: dict = Depends(require_admin_or_ae), db: Session = Depends(get_db)):
    _reject_sdr(user)
    opp = _get_owned_opportunity_or_403(db, user, opportunity_id)

    brief = db.query(models.ClosingBrief).filter(models.ClosingBrief.opportunity_id == opp.id).first()
    calls = (
        db.query(models.OpportunityCall)
        .filter(models.OpportunityCall.opportunity_id == opp.id)
        .order_by(models.OpportunityCall.called_at.desc())
        .all()
    )

    return {
        **_opportunity_row(opp),
        "account": {
            "id": opp.account.id,
            "name": opp.account.name,
            "industry": opp.account.industry,
        } if opp.account else None,
        "closing_brief": {
            "id": brief.id,
            "champion_name": brief.champion_name,
            "champion_role": brief.champion_role,
            "champion_contact": brief.champion_contact,
            "promises_made": brief.promises_made,
            "handover_notes": brief.handover_notes,
            "locked": brief.locked,
            "champion_active": brief.champion_active,
        } if brief else None,
        "calls": [
            {
                "id": c.id,
                "user_id": c.user_id,
                "user_name": c.user.name if c.user else None,
                "outcome": c.outcome,
                "notes": c.notes,
                "called_at": c.called_at.isoformat() if c.called_at else None,
            }
            for c in calls
        ],
    }


class CallLogBody(BaseModel):
    outcome: str
    notes: Optional[str] = None


@router.post("/opportunities/{opportunity_id}/calls")
def log_opportunity_call(
    opportunity_id: str, body: CallLogBody,
    user: dict = Depends(require_admin_or_ae), db: Session = Depends(get_db),
):
    _reject_sdr(user)
    opp = _get_owned_opportunity_or_403(db, user, opportunity_id)
    _require_write_access(user, opp)

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
        "called_at": call.called_at.isoformat() if call.called_at else None,
    }


class CloseBody(BaseModel):
    won: bool
    close_date: str
    champion_name: Optional[str] = None
    champion_role: Optional[str] = None
    champion_contact: Optional[str] = None
    promises_made: Optional[str] = None
    handover_notes: Optional[str] = None
    # Live finding, 2026-09-15: this org rejects any Closed-stage push
    # without both — see apply_opportunity_close for when they're actually
    # required (only when a push to SF will actually happen).
    standard_product_names: Optional[List[str]] = None
    invoice_number: Optional[str] = None
    lost_reason: Optional[str] = None


class UpdateBody(BaseModel):
    """Deliberately narrow — stage_name + close_date only, matching the
    existing bidirectional SF sync contract (salesforce.py's
    push_opportunity_to_salesforce never pushes Amount; the plan scoped the
    push/pull sync to "stage + close_date only" to keep it auditable). Amount
    stays SF-sourced-only; adding local Amount edits here would silently
    widen that contract without the SF-side half being built to match."""
    stage_name: Optional[str] = None
    close_date: Optional[str] = None


_BRIEF_FIELDS = ("champion_name", "champion_role", "champion_contact", "promises_made", "handover_notes")


def _push_opportunity_change_to_salesforce(opportunity_id: str):
    """Background-thread entry point — mirrors lead_routes._do_push /
    audience_manager.sync_lead_update_to_am: opens its own DB session since
    the request's session will be gone by the time this runs. Shared by both
    the close and update actions — both just need "push current DB state"."""
    from database import SessionLocal
    from salesforce import get_sf_client, push_opportunity_to_salesforce

    thread_db = SessionLocal()
    try:
        opp = thread_db.query(models.Opportunity).filter(models.Opportunity.id == opportunity_id).first()
        if not opp:
            return
        sf = get_sf_client()
        push_opportunity_to_salesforce(thread_db, sf, opp)
    finally:
        thread_db.close()


def _writeback_enabled(db: Session) -> bool:
    """Master off switch for AE/CSM action-triggered pushes (close/update/
    renewal-create) — separate from SyncSettings.opportunity_sync_direction,
    which only ever gated the scheduled bulk pull. Defaults False: a fresh
    org gets zero Salesforce write-back from these actions until an admin
    verifies the field mapping and turns it on in Control Center."""
    settings = db.query(models.SyncSettings).first()
    return bool(settings and settings.opportunity_writeback_enabled)


def _maybe_push_opportunity_change(db: Session, opportunity_id: str):
    if _writeback_enabled(db):
        threading.Thread(target=_push_opportunity_change_to_salesforce, args=(opportunity_id,), daemon=True).start()


def _log_account_activity(db: Session, opp: models.Opportunity, kind: str, note: str, actor_user_id: str):
    """Best-effort Sales-side timeline entry — a Salesforce-synced Opportunity
    with no account link (account_id nullable) simply gets no entry."""
    if not opp.account_id:
        return
    db.add(models.AccountActivity(account_id=opp.account_id, kind=kind, note=note, created_by=actor_user_id))


def apply_opportunity_close(db: Session, opp: models.Opportunity, body: CloseBody, actor_user_id: str) -> models.Opportunity:
    """Core close logic, shared by AE Pipeline's own route and CSM Portal's
    close-my-renewal route (a CSM can only reach this for an Opportunity
    already scoped to one of their accounts — see csm_portal_routes.py)."""
    if opp.is_closed:
        raise HTTPException(status_code=409, detail="Opportunity is already closed")

    parsed_close_date = _parse_sf_date(body.close_date)
    if not parsed_close_date:
        raise HTTPException(status_code=400, detail="close_date must be in YYYY-MM-DD format")

    existing_brief = db.query(models.ClosingBrief).filter(models.ClosingBrief.opportunity_id == opp.id).first()

    if body.won:
        missing = [f for f in _BRIEF_FIELDS if not getattr(body, f)]
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing required field(s) for a Won close: {', '.join(missing)}")
        if existing_brief and existing_brief.locked:
            raise HTTPException(status_code=409, detail="Closing brief is locked and cannot be overwritten")

    # Live finding, 2026-09-15: only enforce these when a push to SF will
    # actually happen (a synced Opportunity, with writeback on) — a
    # Alternate CRM-native deal, or one with pushes turned off, has nothing
    # to satisfy this org's SF validation rule for.
    if opp.sf_opportunity_id and _writeback_enabled(db):
        missing_sf = []
        if not body.standard_product_names:
            missing_sf.append("standard_product_names")
        if not body.invoice_number:
            missing_sf.append("invoice_number")
        if not body.won and not body.lost_reason:
            missing_sf.append("lost_reason")
        if missing_sf:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required field(s) for Salesforce to accept this close: {', '.join(missing_sf)}",
            )

    opp.is_closed = True
    opp.is_won = body.won
    opp.close_date = parsed_close_date
    if body.standard_product_names:
        opp.standard_product_names = ";".join(body.standard_product_names)
    if body.invoice_number:
        opp.invoice_number = body.invoice_number
    if body.lost_reason:
        opp.lost_reason = body.lost_reason
    # Not cosmetic. Salesforce derives IsClosed/IsWon from StageName as
    # read-only formula fields, so leaving stage_name on the open stage here
    # made push_opportunity_to_salesforce's payload self-contradictory — it
    # said "closed won" in two fields SF won't accept and "Qualification" in
    # the one field SF actually reads. Locally it also rendered a Closed Won
    # deal as still sitting in Discovery.
    opp.stage_name = CLOSED_WON_STAGE if body.won else CLOSED_LOST_STAGE

    if body.won:
        brief = existing_brief or models.ClosingBrief(opportunity_id=opp.id, created_by=actor_user_id)
        brief.champion_name = body.champion_name
        brief.champion_role = body.champion_role
        brief.champion_contact = body.champion_contact
        brief.promises_made = body.promises_made
        brief.handover_notes = body.handover_notes
        if not existing_brief:
            db.add(brief)
        _log_account_activity(db, opp, "playbook_deal_closed", f"Closed Won — {opp.name or 'Opportunity'}", actor_user_id)
    else:
        _log_account_activity(db, opp, "deal_closed_lost", f"Closed Lost — {opp.name or 'Opportunity'}", actor_user_id)

    db.commit()
    db.refresh(opp)

    _maybe_push_opportunity_change(db, opp.id)
    return opp


def apply_opportunity_update(db: Session, opp: models.Opportunity, body: UpdateBody, actor_user_id: str) -> models.Opportunity:
    """Core update logic — the actual "work the deal without opening
    Salesforce" gap: progress stage / push out the close date on an open
    Opportunity. Shared by AE Pipeline and CSM Portal (a CSM's own renewal)."""
    if opp.is_closed:
        raise HTTPException(status_code=409, detail="Cannot update a closed opportunity")

    changes = []
    if body.stage_name is not None and body.stage_name != opp.stage_name:
        changes.append(f"stage → {body.stage_name}")
        opp.stage_name = body.stage_name
    if body.close_date is not None:
        parsed = _parse_sf_date(body.close_date)
        if not parsed:
            raise HTTPException(status_code=400, detail="close_date must be in YYYY-MM-DD format")
        if parsed != opp.close_date:
            changes.append(f"close date → {body.close_date}")
        opp.close_date = parsed

    if changes:
        _log_account_activity(db, opp, "opportunity_updated", "; ".join(changes), actor_user_id)
        db.commit()
        db.refresh(opp)
        _maybe_push_opportunity_change(db, opp.id)

    return opp


@router.patch("/opportunities/{opportunity_id}")
def update_opportunity(
    opportunity_id: str, body: UpdateBody,
    user: dict = Depends(require_admin_or_ae), db: Session = Depends(get_db),
):
    _reject_sdr(user)
    opp = _get_owned_opportunity_or_403(db, user, opportunity_id)
    _require_write_access(user, opp)
    opp = apply_opportunity_update(db, opp, body, user.get("sub"))
    return _opportunity_row(opp)


@router.post("/opportunities/{opportunity_id}/close")
def close_opportunity(
    opportunity_id: str, body: CloseBody,
    user: dict = Depends(require_admin_or_ae), db: Session = Depends(get_db),
):
    _reject_sdr(user)
    opp = _get_owned_opportunity_or_403(db, user, opportunity_id)
    _require_write_access(user, opp)
    opp = apply_opportunity_close(db, opp, body, user.get("sub"))
    return _opportunity_row(opp)
