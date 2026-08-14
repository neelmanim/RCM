# ── routes/disqualify_routes.py — Account disqualify maker-checker ────────────
# AE/SDR requests disqualifying every lead under an account (ICP mismatch);
# Pod Admin (or above) approves/rejects. Mirrors the bulk-mutation pattern in
# admin_assignment_routes.py (role-gate → loop → single commit → {message, count}).
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import get_current_user, require_pod_admin_or_above

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/disqualify-requests", tags=["Disqualify Requests"])


@router.post("")
def create_request(body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Maker step — any authenticated user can request disqualifying an account's leads."""
    company = (body.get("company") or "").strip()
    lead_ids = body.get("lead_ids") or []
    reason = (body.get("reason") or "").strip()

    if not company:
        raise HTTPException(status_code=400, detail="company is required")
    if not lead_ids:
        raise HTTPException(status_code=400, detail="lead_ids must be a non-empty list")
    if not reason:
        raise HTTPException(status_code=400, detail="reason is required")

    # Validate every lead actually belongs to the stated company — a request
    # can't be used to disqualify leads from an unrelated account.
    leads = db.query(models.Lead).filter(models.Lead.id.in_(lead_ids)).all()
    found_ids = {l.id for l in leads}
    missing = set(lead_ids) - found_ids
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown lead_ids: {sorted(missing)}")
    mismatched = [l.id for l in leads if l.company != company]
    if mismatched:
        raise HTTPException(status_code=400, detail=f"Leads not in company '{company}': {mismatched}")

    req = models.DisqualifyRequest(
        company=company,
        lead_ids=json.dumps(lead_ids),
        reason=reason,
        requested_by=user["sub"],
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return {"message": "Disqualify request submitted", "id": req.id}


def _serialize(req: models.DisqualifyRequest, db: Session) -> dict:
    requester = db.query(models.User).filter(models.User.id == req.requested_by).first()
    return {
        "id": req.id,
        "company": req.company,
        "lead_ids": json.loads(req.lead_ids),
        "reason": req.reason,
        "requested_by": req.requested_by,
        "requested_by_name": (requester.name or requester.email) if requester else None,
        "requested_at": str(req.requested_at) if req.requested_at else None,
        "status": req.status,
        "reviewed_by": req.reviewed_by,
        "reviewed_at": str(req.reviewed_at) if req.reviewed_at else None,
        "rejection_reason": req.rejection_reason,
    }


@router.get("/mine")
def list_my_requests(
    status: str = "pending",
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Maker step — the requester's own view of their requests (any role), so
    the Leads view can show a pending/rejected badge without checker access."""
    q = db.query(models.DisqualifyRequest).filter(
        models.DisqualifyRequest.requested_by == user["sub"],
        models.DisqualifyRequest.status == status,
    )
    requests = q.order_by(models.DisqualifyRequest.requested_at.desc()).all()
    return {"requests": [_serialize(r, db) for r in requests]}


@router.get("")
def list_requests(
    status: str = "pending",
    db: Session = Depends(get_db),
    admin: dict = Depends(require_pod_admin_or_above),
):
    """Checker step — list requests awaiting review. Pod Admins only see
    requests made by SDRs/AEs in their own pod; Super Admins see everything."""
    q = db.query(models.DisqualifyRequest).filter(models.DisqualifyRequest.status == status)

    if admin.get("role") == "Pod Admin":
        admin_user = db.query(models.User).filter(models.User.id == admin["sub"]).first()
        pod_id = admin_user.pod_id if admin_user else None
        pod_user_ids = {
            u.id for u in db.query(models.User).filter(models.User.pod_id == pod_id).all()
        } if pod_id else set()
        q = q.filter(models.DisqualifyRequest.requested_by.in_(pod_user_ids)) if pod_user_ids else q.filter(False)

    requests = q.order_by(models.DisqualifyRequest.requested_at.desc()).all()
    return {"requests": [_serialize(r, db) for r in requests]}


@router.post("/{req_id}/approve")
def approve_request(req_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_pod_admin_or_above)):
    req = db.query(models.DisqualifyRequest).filter(models.DisqualifyRequest.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request already {req.status}")

    admin_name = admin.get("name") or admin.get("email") or admin["sub"]
    lead_ids = json.loads(req.lead_ids)
    count = 0
    for lid in lead_ids:
        lead = db.query(models.Lead).filter(models.Lead.id == lid).first()
        if not lead or lead.status in models.TERMINAL_STATUSES:
            continue  # already terminal (e.g. a prior overlapping request already disqualified it)
        models.disqualify_lead(db, lead, req.reason, admin_name)
        count += 1

    # Re-check status hasn't changed since we loaded it (race: two approvers).
    req = db.query(models.DisqualifyRequest).filter(
        models.DisqualifyRequest.id == req_id, models.DisqualifyRequest.status == "pending"
    ).first()
    if not req:
        db.rollback()
        raise HTTPException(status_code=409, detail="Request was already reviewed by someone else")

    req.status = "approved"
    req.reviewed_by = admin["sub"]
    req.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"{count} leads disqualified", "count": count}


@router.post("/{req_id}/reject")
def reject_request(req_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_pod_admin_or_above)):
    req = db.query(models.DisqualifyRequest).filter(
        models.DisqualifyRequest.id == req_id, models.DisqualifyRequest.status == "pending"
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Pending request not found (already reviewed?)")

    req.status = "rejected"
    req.reviewed_by = admin["sub"]
    req.reviewed_at = datetime.now(timezone.utc)
    req.rejection_reason = (body or {}).get("rejection_reason")

    # Notify the maker via the existing Task/notification bell mechanism.
    if req.requested_by:
        db.add(models.Task(
            lead_id=json.loads(req.lead_ids)[0],
            user_id=req.requested_by,
            title=f"Disqualify request for '{req.company}' was rejected"
                  + (f": {req.rejection_reason}" if req.rejection_reason else ""),
            due_time=datetime.now(timezone.utc),
        ))
    db.commit()
    return {"message": "Request rejected"}
