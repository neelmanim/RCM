# ── routes/call_list_routes.py — Call Lists (Power Dialer selectable lists) ──
# A Call List is a user-curated, org-wide-visible dial list: any SDR/AE/Admin
# can create one and add leads to it (bulk-select or "save current filter as
# a list" from the Leads Hub), then dial from it in the Power Dialer. Unlike
# Tag (admin-curated, applied at upload time), this is deliberately open to
# every role — see models.CallList's docstring and CLAUDE.md's plan notes.
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import get_current_user
from routes.lead_helpers import _build_lead_query

router = APIRouter(prefix="/api", tags=["Call Lists"])


@router.get("/call-lists")
def list_call_lists(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """All call lists, org-wide — anyone can see any list (confirmed decision:
    org-wide visibility). lead_count is scoped to what THIS viewer can
    actually dial from it, though: it used to be a flat, unscoped count of
    every lead in the list, so an SDR/AE would see e.g. "Outbound (6)" and
    then an empty Power Dialer queue for that same list, because the queue
    (GET /leads?call_list_id=...) is scoped through _build_lead_query to
    that rep's own assigned leads. Counting through the same scope here
    means the badge always matches what picking the list will show."""
    lists = db.query(models.CallList).order_by(models.CallList.created_at.desc()).all()
    scoped = _build_lead_query(db, user)
    return {
        "call_lists": [
            {
                "id": cl.id,
                "name": cl.name,
                "created_by": cl.created_by,
                "created_by_name": cl.creator.name if cl.creator else None,
                "created_at": cl.created_at.isoformat() if cl.created_at else None,
                "lead_count": scoped.filter(models.Lead.call_lists.any(models.CallList.id == cl.id)).count(),
            }
            for cl in lists
        ]
    }


@router.post("/call-lists")
def create_call_list(body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Create-on-use, same idiom as tags — a POST with a name that already
    exists reuses that list rather than creating a duplicate. Org-wide
    visibility makes silent duplicate lists confusing otherwise."""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    call_list = db.query(models.CallList).filter(models.CallList.name == name).first()
    if not call_list:
        call_list = models.CallList(name=name, created_by=user.get("sub"))
        db.add(call_list)
        db.commit()
        db.refresh(call_list)
    return {"id": call_list.id, "name": call_list.name, "created_by": call_list.created_by}


@router.post("/call-lists/{call_list_id}/leads")
def add_leads_to_call_list(call_list_id: str, body: dict, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Bulk-add — any authenticated user, no ownership check on adding TO a
    list (matches "org-wide visible, anyone can curate" decision). Re-adding
    an already-listed lead is a no-op: only the leads not already in the
    list get inserted, so concurrent bulk-adds from two reps naturally
    resolve without a duplicate-key error."""
    call_list = db.query(models.CallList).filter(models.CallList.id == call_list_id).first()
    if not call_list:
        raise HTTPException(status_code=404, detail="Call List not found")

    lead_ids = body.get("lead_ids", [])
    if not lead_ids:
        raise HTTPException(status_code=400, detail="No lead IDs provided")

    already = {
        row.lead_id for row in db.query(models.call_list_leads.c.lead_id).filter(
            models.call_list_leads.c.call_list_id == call_list_id,
            models.call_list_leads.c.lead_id.in_(lead_ids),
        )
    }
    new_ids = [lid for lid in set(lead_ids) if lid not in already]
    if new_ids:
        db.execute(
            models.call_list_leads.insert(),
            [{"call_list_id": call_list_id, "lead_id": lid} for lid in new_ids],
        )
        db.commit()
    return {"message": f"{len(new_ids)} lead(s) added", "added": len(new_ids), "already_present": len(already)}


@router.delete("/call-lists/{call_list_id}")
def delete_call_list(call_list_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Creator or Pod Admin+ (any pod — lists are org-wide, so pod-scoping
    the delete permission would be inconsistent with the visibility model).
    Everyone else gets 403 to prevent an accidental delete of a list other
    reps are actively using."""
    call_list = db.query(models.CallList).filter(models.CallList.id == call_list_id).first()
    if not call_list:
        raise HTTPException(status_code=404, detail="Call List not found")
    is_creator = call_list.created_by == user.get("sub")
    is_pod_admin_plus = user.get("role") in ("Super Admin", "Admin", "Pod Admin")
    if not is_creator and not is_pod_admin_plus:
        raise HTTPException(status_code=403, detail="Only the creator or a Pod Admin can delete this Call List")
    db.delete(call_list)
    db.commit()
    return {"message": "Call List deleted"}
