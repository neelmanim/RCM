# ── routes/data_quality_routes.py — is the history behind our reports complete? ──
# Super Admin only. Read-only: counts that tell you whether ownership history, statuses and bookings can be trusted.
from fastapi import APIRouter, Depends
from sqlalchemy import func, text
from sqlalchemy.orm import Session

import models
import ownership_history as oh
from auth import require_super_admin
from database import get_db

router = APIRouter(prefix="/api/admin/data-quality", tags=["Data quality"])


@router.get("/ownership")
def ownership_quality(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Ownership-history health: is the trigger installed, do periods match assignments, who is unowned, and how
    many recent ownership writes arrived with no context (scripts / manual SQL show up as 'script/unknown')."""
    live = models.exclude_test_and_deleted_leads(db.query(models.Lead))
    P = models.LeadOwnershipPeriod
    owned = db.query(models.lead_assignments.c.lead_id).distinct().subquery()
    unowned = live.filter(~models.Lead.id.in_(db.query(owned.c.lead_id))).count()
    since7 = func.now() - text("interval '7 days'") if oh.is_postgres(db.get_bind()) else None
    by_reason = []
    if since7 is not None:
        by_reason = [{"reason": r or "(none)", "n": n} for r, n in
                     db.query(P.reason, func.count()).filter(P.valid_from >= since7).group_by(P.reason)
                     .order_by(func.count().desc()).all()]
    trigger = None
    if oh.is_postgres(db.get_bind()):
        trigger = bool(db.execute(text("SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lead_assignments_track'")).scalar())
    first_real = (db.query(func.min(P.valid_from)).filter(P.reason != oh.R_BACKFILL).scalar())
    other_status = [{"status": s, "n": n} for s, n in
                    live.with_entities(models.Lead.status, func.count()).group_by(models.Lead.status).all()
                    if s not in models.KNOWN_STATUSES]
    return {
        "trigger_installed": trigger,
        "history_accurate_from": first_real.isoformat() if first_real else None,
        "periods_total": db.query(func.count(P.id)).scalar(),
        "periods_open": db.query(func.count(P.id)).filter(P.valid_to.is_(None)).scalar(),
        "reconcile": oh.reconcile(db, heal=False),
        "unowned_live_leads": unowned,
        "new_periods_last_7d_by_reason": by_reason,
        "statuses_outside_the_app_list": other_status,
    }


@router.get("/ownership/{lead_id}")
def lead_ownership_history(lead_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Who owned this lead, from when to when, and why — oldest first. 'script/unknown' = written without app context."""
    P = models.LeadOwnershipPeriod
    names = {u.id: (u.name or u.email) for u in db.query(models.User).all()}
    rows = db.query(P).filter(P.lead_id == lead_id).order_by(P.valid_from.asc(), P.valid_to.asc().nullslast()).all()
    return {"lead_id": lead_id, "periods": [{
        "user_id": r.user_id, "user": names.get(r.user_id, "(deleted user)"),
        "from": r.valid_from.isoformat() if r.valid_from else None,
        "to": r.valid_to.isoformat() if r.valid_to else None,
        "reason": r.reason, "assigned_by": names.get(r.assigned_by, r.assigned_by),
        "ended_reason": r.ended_reason, "ended_by": names.get(r.ended_by, r.ended_by),
    } for r in rows]}


@router.get("/meetings")
def meetings_quality(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Is the meeting record complete? Booking records by source/state, how many have an identified booker, live leads
    sitting in a meeting stage with no record or no lead_closed_at, and how many recent status moves carry a user id."""
    import meeting_log
    M, L, S = models.LeadMeeting, models.Lead, models.LeadStatusLog
    live = models.exclude_test_and_deleted_leads(db.query(L))
    in_stage = live.filter(L.status.in_(meeting_log.MEETING_REACHED))
    have = db.query(M.lead_id)
    since = func.now() - text("interval '7 days'") if oh.is_postgres(db.get_bind()) else None
    recent = db.query(S).filter(S.changed_at >= since) if since is not None else db.query(S)
    recent = recent.filter(S.from_status.isnot(None), ~S.to_status.like("Outcome:%"), S.changed_by != "system")
    return {
        "bookings_total": db.query(func.count(M.id)).scalar(),
        "by_source": {s or "(none)": n for s, n in db.query(M.source, func.count()).group_by(M.source).all()},
        "by_state": {s: n for s, n in db.query(M.status, func.count()).group_by(M.status).all()},
        "with_identified_booker": db.query(func.count(M.id)).filter(M.booked_by_user_id.isnot(None)).scalar(),
        "without_identified_booker": db.query(func.count(M.id)).filter(M.booked_by_user_id.is_(None)).scalar(),
        "meeting_stage_leads": in_stage.count(),
        "meeting_stage_leads_without_a_booking_record": in_stage.filter(~L.id.in_(have)).count(),
        "meeting_stage_leads_without_lead_closed_at": in_stage.filter(L.lead_closed_at.is_(None)).count(),
        "status_moves_last_7d": recent.count(),
        "status_moves_last_7d_with_user_id": recent.filter(S.changed_by_user_id.isnot(None)).count(),
    }
