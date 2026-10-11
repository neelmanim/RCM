"""Admin routes — Lead assignments, bulk operations, unassigned/assigned views."""
import json
from datetime import datetime, timezone
from collections import OrderedDict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from database import get_db
from middleware import require_admin, require_super_admin
from models import (
    Lead, User, Pod, CallLog, DialerCall, LeadStatusLog,
    LeadEmailActivity, EmailThread,
    lead_assignments, ACTIVE_STATUSES,
)
from services.lead_service import lead_to_dict

router = APIRouter(prefix="/api/admin", tags=["Admin Assignments"])


def _get_active_lead_cap(db, user):
    from models import SyncSettings
    if user.pod_id:
        pod = user.pod if user.pod else db.query(Pod).filter(Pod.id == user.pod_id).first()
        if pod and pod.active_lead_cap is not None:
            return pod.active_lead_cap
    settings = db.query(SyncSettings).filter(SyncSettings.id == 1).first()
    return settings.active_lead_cap if settings and settings.active_lead_cap is not None else 500


def _active_lead_count(user):
    return len([l for l in user.assigned_leads if l.status in ACTIVE_STATUSES])


@router.get("/leads/unassigned")
def get_unassigned_leads(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    assigned_ids = db.query(lead_assignments.c.lead_id).distinct()
    leads = db.query(Lead).filter(~Lead.id.in_(assigned_ids)).options(
        joinedload(Lead.assigned_users), joinedload(Lead.call_logs)
    ).all()
    return [lead_to_dict(l) for l in leads]


@router.get("/leads/assigned")
def get_assigned_leads(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    assigned_ids = db.query(lead_assignments.c.lead_id).distinct()
    leads = db.query(Lead).filter(Lead.id.in_(assigned_ids)).options(
        joinedload(Lead.assigned_users), joinedload(Lead.call_logs)
    ).all()
    return [lead_to_dict(l) for l in leads]


@router.post("/assignments/bulk-assign")
def bulk_assign(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    user_id = body.get("user_id")
    lead_ids = body.get("lead_ids", [])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if admin.get("role") == "Pod Admin":
        admin_user = db.query(User).filter(User.id == admin["sub"]).first()
        if admin_user and user.pod_id != admin_user.pod_id:
            raise HTTPException(status_code=403, detail="Pod Admin can only assign leads to SDRs within their POD")

    assigned, skipped_pod_lock, skipped_cap = [], [], []
    for lid in lead_ids:
        lead = db.query(Lead).filter(Lead.id == lid).first()
        if not lead:
            continue
        if lead.assigned_users:
            existing_pods = {u.pod_id for u in lead.assigned_users if u.pod_id}
            if existing_pods and user.pod_id not in existing_pods:
                skipped_pod_lock.append(lid)
                continue
        cap = _get_active_lead_cap(db, user)
        if cap == 0 or _active_lead_count(user) >= cap:
            skipped_cap.append(lid)
            continue
        if lead not in user.assigned_leads:
            user.assigned_leads.append(lead)
            if not lead.lead_started_at:
                lead.lead_started_at = datetime.now(timezone.utc)
            assigned.append(lid)
    db.commit()
    msg = f"{len(assigned)} leads assigned to {user.name}"
    if skipped_pod_lock:
        msg += f". {len(skipped_pod_lock)} skipped (assigned to another POD)."
    if skipped_cap:
        msg += f" {len(skipped_cap)} skipped (SDR at max active leads)."
    return {"message": msg, "assigned": assigned, "pod_locked": skipped_pod_lock, "cap_reached": skipped_cap}


@router.post("/assignments/auto-assign-all")
def auto_assign_all(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    assigned_ids_query = db.query(lead_assignments.c.lead_id).distinct()
    unassigned_leads = db.query(Lead).filter(~Lead.id.in_(assigned_ids_query)).all()
    if not unassigned_leads:
        return {"message": "No unassigned leads found"}

    if admin.get("role") == "Pod Admin":
        admin_user = db.query(User).filter(User.id == admin["sub"]).first()
        sdrs = db.query(User).filter(User.role == "SDR", User.pod_id == admin_user.pod_id).all() if admin_user else []
    else:
        sdrs = db.query(User).filter(User.role == "SDR").all()
    if not sdrs:
        sdrs = db.query(User).all()
    if not sdrs:
        raise HTTPException(status_code=400, detail="No users found to assign leads to")

    company_groups = OrderedDict()
    no_company = []
    for lead in unassigned_leads:
        ck = (lead.company or "").strip().lower()
        if ck:
            company_groups.setdefault(ck, []).append(lead)
        else:
            no_company.append(lead)
    batches = list(company_groups.values()) + [[l] for l in no_company]

    count, skipped, sdr_idx, full_sdrs = 0, 0, 0, set()
    for batch in batches:
        if len(full_sdrs) == len(sdrs):
            skipped += len(batch)
            continue
        placed = False
        for attempt in range(len(sdrs)):
            sdr = sdrs[(sdr_idx + attempt) % len(sdrs)]
            if sdr.id in full_sdrs:
                continue
            cap = _get_active_lead_cap(db, sdr)
            if cap == 0:
                full_sdrs.add(sdr.id)
                continue
            current = _active_lead_count(sdr)
            if current >= cap:
                full_sdrs.add(sdr.id)
                continue
            batch_assigned = 0
            for lead in batch:
                if cap > 0 and (current + batch_assigned) >= cap:
                    break
                if lead not in sdr.assigned_leads:
                    sdr.assigned_leads.append(lead)
                    if not lead.lead_started_at:
                        lead.lead_started_at = datetime.now(timezone.utc)
                    batch_assigned += 1
            count += batch_assigned
            skipped += len(batch) - batch_assigned
            sdr_idx = (sdr_idx + attempt + 1) % len(sdrs)
            placed = True
            break
        if not placed:
            skipped += len(batch)
    db.commit()
    msg = f"Successfully auto-assigned {count} leads across {len(sdrs)} users"
    if skipped:
        msg += f". {skipped} leads skipped (all SDRs at capacity)."
    return {"message": msg, "assigned_count": count, "skipped": skipped}


@router.delete("/assignments/{user_id}/{lead_id}")
def unassign_lead(user_id: str, lead_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    if admin.get("role") == "Pod Admin":
        target = db.query(User).filter(User.id == user_id).first()
        admin_user = db.query(User).filter(User.id == admin["sub"]).first()
        if target and admin_user and target.pod_id != admin_user.pod_id:
            raise HTTPException(status_code=403, detail="You can only unassign leads from SDRs in your POD.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if lead and lead in user.assigned_leads:
        user.assigned_leads.remove(lead)
        db.commit()
    return {"ok": True}


@router.post("/assignments/bulk-unassign")
def bulk_unassign(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    lead_ids = body.get("lead_ids", [])
    if not lead_ids:
        raise HTTPException(status_code=400, detail="No lead IDs provided")
    count = 0
    for lid in lead_ids:
        lead = db.query(Lead).options(joinedload(Lead.assigned_users)).filter(Lead.id == lid).first()
        if not lead or not lead.assigned_users:
            continue
        if admin.get("role") == "Pod Admin":
            admin_user = db.query(User).filter(User.id == admin["sub"]).first()
            pod_id = admin_user.pod_id if admin_user else None
            to_remove = [u for u in lead.assigned_users if u.pod_id == pod_id]
            for u in to_remove:
                lead.assigned_users.remove(u)
            if to_remove:
                count += 1
        else:
            lead.assigned_users.clear()
            count += 1
    db.commit()
    return {"message": f"{count} leads unassigned", "count": count}


@router.post("/leads/bulk-delete")
def bulk_delete_leads(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    lead_ids = body.get("lead_ids", [])
    if not lead_ids:
        raise HTTPException(status_code=400, detail="No lead IDs provided")
    if admin.get("role") not in ("Super Admin", "Admin"):
        raise HTTPException(status_code=403, detail="Only Super Admins can delete leads")
    count = 0
    for lid in lead_ids:
        lead = db.query(Lead).filter(Lead.id == lid).first()
        if lead:
            db.query(LeadEmailActivity).filter(LeadEmailActivity.lead_id == lid).delete()
            db.query(EmailThread).filter(EmailThread.lead_id == lid).delete()
            db.query(DialerCall).filter(DialerCall.lead_id == lid).delete()
            db.delete(lead)
            count += 1
    db.commit()
    return {"message": f"{count} leads permanently deleted", "count": count}
