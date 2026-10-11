# ── routes/reassign_routes.py — Lead reassignment maker-checker ───────────────
# An SDR/AE who tries to add a contact another rep already owns (the duplicate
# 409 on POST /leads) can ask for that lead to be moved to them; Pod Admin (or
# above) approves/rejects. Mirrors routes/disqualify_routes.py.
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import ownership_history as oh
import access_db
import models
from database import get_db
from auth import get_current_user, require_pod_admin_or_above
from routes.lead_helpers import lead_allowed

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reassign-requests", tags=["Reassign Requests"])

ADMIN_ROLES = ("Super Admin", "Admin", "Pod Admin")


def _owner_names(lead) -> str:
    return ", ".join(sorted((u.name or u.email) for u in lead.assigned_users))


def _invalidate_lead_caches():
    from cache import invalidate
    for k in ("leads_page", "my_leads", "leads_count", "dashboard"):
        invalidate(k)


def _notify(db, lead_id, user_id, title):
    if user_id:
        db.add(models.Task(lead_id=lead_id, user_id=user_id, title=title, due_time=datetime.now(timezone.utc)))


@router.post("")
def create_request(body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Maker step — an SDR/AE asks for a lead someone else owns. Admins can assign directly."""
    if user.get("role") in ADMIN_ROLES:
        raise HTTPException(status_code=400, detail="Admins can assign leads directly — no request needed.")
    lead_id = (body.get("lead_id") or "").strip()
    note = (body.get("note") or "").strip()[:500] or None
    lead = models.exclude_deleted_leads(db.query(models.Lead)).filter(models.Lead.id == lead_id).first() if lead_id else None
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if any(u.id == user["sub"] for u in lead.assigned_users):
        raise HTTPException(status_code=409, detail="This lead is already assigned to you.")

    pending = db.query(models.ReassignRequest).filter(
        models.ReassignRequest.lead_id == lead.id,
        models.ReassignRequest.requested_by == user["sub"],
        models.ReassignRequest.status == "pending",
    ).first()
    if pending:
        raise HTTPException(status_code=409, detail="You already have a pending request for this lead.")

    req = models.ReassignRequest(lead_id=lead.id, requested_by=user["sub"], note=note)
    db.add(req)
    db.commit()
    db.refresh(req)
    return {"message": "Reassignment request sent for approval", "id": req.id}


def _serialize(req: models.ReassignRequest, db: Session) -> dict:
    requester = db.query(models.User).filter(models.User.id == req.requested_by).first()
    lead = db.query(models.Lead).filter(models.Lead.id == req.lead_id).first()
    return {
        "id": req.id,
        "lead_id": req.lead_id,
        "lead_name": f"{lead.first_name or ''} {lead.last_name or ''}".strip() if lead else None,
        "company": lead.company if lead else None,
        "lead_status": lead.status if lead else None,
        "current_owner": _owner_names(lead) if lead else None,
        "note": req.note,
        "requested_by": req.requested_by,
        "requested_by_name": (requester.name or requester.email) if requester else None,
        "requested_at": req.requested_at.isoformat() if req.requested_at else None,
        "status": req.status,
        "reviewed_by": req.reviewed_by,
        "reviewed_at": req.reviewed_at.isoformat() if req.reviewed_at else None,
        "rejection_reason": req.rejection_reason,
    }


@router.get("")
def list_requests(status: str = "pending", db: Session = Depends(get_db),
                  admin: dict = Depends(require_pod_admin_or_above)):
    """Checker step. A Pod Admin sees requests from their pod's reps or for their pod's leads."""
    q = db.query(models.ReassignRequest).filter(models.ReassignRequest.status == status)
    if admin.get("role") == "Pod Admin":
        me = db.query(models.User).filter(models.User.id == admin["sub"]).first()
        pod_id = me.pod_id if me else None
        if not pod_id:
            return {"requests": []}
        pod_users = [u.id for u in db.query(models.User).filter(models.User.pod_id == pod_id).all()]
        pod_leads = db.query(models.Lead.id).filter(models.Lead.pod_id == pod_id)
        q = q.filter(models.ReassignRequest.requested_by.in_(pod_users) | models.ReassignRequest.lead_id.in_(pod_leads))
    rows = q.order_by(models.ReassignRequest.requested_at.desc()).all()
    return {"requests": [_serialize(r, db) for r in rows]}


@router.post("/{req_id}/approve")
def approve_request(req_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_pod_admin_or_above)):
    req = db.query(models.ReassignRequest).filter(models.ReassignRequest.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request already {req.status}")
    lead = db.query(models.Lead).filter(models.Lead.id == req.lead_id).first()
    requester = db.query(models.User).filter(models.User.id == req.requested_by).first() if req.requested_by else None
    if not lead or not requester:
        raise HTTPException(status_code=409, detail="The lead or the requesting user no longer exists")
    if not lead_allowed(admin, lead, edit=True):
        raise HTTPException(status_code=403, detail="This lead belongs to another pod — a Super Admin must approve it")

    admin_name = admin.get("name") or admin.get("email") or admin["sub"]
    old_owners = list(lead.assigned_users)
    old_names = _owner_names(lead)
    # claim the request first: the conditional UPDATE is the race guard (two approvers)
    claimed = db.query(models.ReassignRequest).filter(
        models.ReassignRequest.id == req_id, models.ReassignRequest.status == "pending",
    ).update({"status": "approved", "reviewed_by": admin["sub"], "reviewed_at": datetime.now(timezone.utc)})
    if not claimed:
        db.rollback()
        raise HTTPException(status_code=409, detail="Request was already reviewed by someone else")

    models.assign_lead(requester, lead, reason=oh.R_REASSIGN, actor_id=admin["sub"])
    new_name = requester.name or requester.email
    models.record_lead_history(db, lead.id, "assigned_to", old_names or None, new_name,
                               f"{admin_name} (approved reassignment request)")
    lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or "the lead"
    _notify(db, lead.id, requester.id, f"Your request for {lead_name} was approved — it is now assigned to you")
    for o in old_owners:
        if o.id != requester.id:
            _notify(db, lead.id, o.id, f"{lead_name} was reassigned to {new_name}")
    db.commit()
    _invalidate_lead_caches()
    return {"message": f"{lead_name} reassigned to {new_name}"}


@router.post("/{req_id}/reject")
def reject_request(req_id: str, body: dict, db: Session = Depends(get_db),
                   admin: dict = Depends(require_pod_admin_or_above)):
    req = db.query(models.ReassignRequest).filter(
        models.ReassignRequest.id == req_id, models.ReassignRequest.status == "pending",
    ).first()
    if not req or (admin.get("role") == "Pod Admin" and not db.query(models.User.id).filter(
            models.User.id == req.requested_by, models.User.pod_id == (access_db.pod_of(admin))).first()):
        # v13.12.1: a Pod Admin may only review requests made by people in their own pod (reject had no such check)
        raise HTTPException(status_code=404, detail="Pending request not found (already reviewed?)")
    req.status = "rejected"
    req.reviewed_by = admin["sub"]
    req.reviewed_at = datetime.now(timezone.utc)
    req.rejection_reason = ((body or {}).get("rejection_reason") or "").strip() or None
    _notify(db, req.lead_id, req.requested_by,
            "Your reassignment request was rejected" + (f": {req.rejection_reason}" if req.rejection_reason else ""))
    db.commit()
    return {"message": "Request rejected"}
