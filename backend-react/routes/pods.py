"""POD team management routes."""
from collections import defaultdict, OrderedDict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from middleware import require_admin, require_super_admin
from models import Pod, User, Lead, SyncSettings, ACTIVE_STATUSES

_TRANSFERABLE_STATUSES = ACTIVE_STATUSES | {"Meeting Scheduled"}
router = APIRouter(prefix="/api/pods", tags=["PODs"])


def _pod_to_dict(pod, db):
    members = db.query(User).filter(User.pod_id == pod.id).all()
    return {"id": pod.id, "name": pod.name, "admin_id": pod.admin_id, "admin_name": pod.admin.name if pod.admin else None, "admin_email": pod.admin.email if pod.admin else None, "created_at": str(pod.created_at) if pod.created_at else None, "members": [{"id": m.id, "name": m.name, "email": m.email, "role": m.role, "assigned_leads": len(m.assigned_leads)} for m in members], "member_count": len(members)}


@router.get("")
def list_pods(user: dict = Depends(require_admin), db: Session = Depends(get_db)):
    if user.get("role") == "Super Admin":
        pods = db.query(Pod).all()
    else:
        db_user = db.query(User).filter(User.id == user["sub"]).first()
        pods = db.query(Pod).filter(Pod.id == db_user.pod_id).all() if db_user and db_user.pod_id else db.query(Pod).filter(Pod.admin_id == user["sub"]).all()
    return [_pod_to_dict(p, db) for p in pods]


@router.post("")
def create_pod(body: dict, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    name = body.get("name")
    if not name: raise HTTPException(status_code=400, detail="Pod name required")
    admin_id = body.get("admin_id")
    if admin_id:
        au = db.query(User).filter(User.id == admin_id).first()
        if not au: raise HTTPException(status_code=404, detail="Admin user not found")
        au.role = "Pod Admin"; db.commit()
    pod = Pod(name=name, admin_id=admin_id); db.add(pod); db.commit(); db.refresh(pod)
    if admin_id:
        au = db.query(User).filter(User.id == admin_id).first()
        if au: au.pod_id = pod.id; db.commit()
    return _pod_to_dict(pod, db)


@router.patch("/{pod_id}")
def update_pod(pod_id: str, body: dict, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    pod = db.query(Pod).filter(Pod.id == pod_id).first()
    if not pod: raise HTTPException(status_code=404, detail="Pod not found")
    if "name" in body: pod.name = body["name"]
    if "admin_id" in body:
        nid = body["admin_id"]
        if nid:
            na = db.query(User).filter(User.id == nid).first()
            if not na: raise HTTPException(status_code=404, detail="New admin not found")
            na.role = "Pod Admin"; na.pod_id = pod.id
        pod.admin_id = nid
    db.commit(); db.refresh(pod)
    return _pod_to_dict(pod, db)


@router.delete("/{pod_id}")
def delete_pod(pod_id: str, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    pod = db.query(Pod).filter(Pod.id == pod_id).first()
    if not pod: raise HTTPException(status_code=404, detail="Pod not found")
    members = db.query(User).filter(User.pod_id == pod_id).all()
    for m in members: m.pod_id = None
    db.delete(pod); db.commit()
    return {"ok": True, "message": f"Pod '{pod.name}' deleted. {len(members)} members unassigned."}


@router.post("/{pod_id}/members")
def add_pod_member(pod_id: str, body: dict, user: dict = Depends(require_admin), db: Session = Depends(get_db)):
    pod = db.query(Pod).filter(Pod.id == pod_id).first()
    if not pod: raise HTTPException(status_code=404, detail="Pod not found")
    if user.get("role") == "Pod Admin":
        au = db.query(User).filter(User.id == user["sub"]).first()
        if not au or au.pod_id != pod_id: raise HTTPException(status_code=403, detail="Pod Admin can only manage own POD")
    member = db.query(User).filter(User.id == body.get("user_id")).first()
    if not member: raise HTTPException(status_code=404, detail="User not found")
    if member.pod_id and member.pod_id != pod_id:
        settings = db.query(SyncSettings).filter(SyncSettings.id == 1).first()
        if not (settings and settings.allow_multi_pod_sdr):
            ep = db.query(Pod).filter(Pod.id == member.pod_id).first()
            raise HTTPException(status_code=400, detail=f"{member.name} already in '{ep.name if ep else 'another pod'}'.")
    member.pod_id = pod_id
    moved = 0
    for lead in member.assigned_leads:
        if lead.status in _TRANSFERABLE_STATUSES: lead.pod_id = pod_id; moved += 1
    db.commit()
    msg = f"{member.name} added to pod '{pod.name}'"
    if moved: msg += f". {moved} active lead(s) moved."
    return {"message": msg}


@router.delete("/{pod_id}/members/{member_id}")
def remove_pod_member(pod_id: str, member_id: str, user: dict = Depends(require_admin), db: Session = Depends(get_db)):
    if user.get("role") == "Pod Admin":
        au = db.query(User).filter(User.id == user["sub"]).first()
        if not au or au.pod_id != pod_id: raise HTTPException(status_code=403, detail="Pod Admin can only manage own POD")
    member = db.query(User).filter(User.id == member_id, User.pod_id == pod_id).first()
    if not member: raise HTTPException(status_code=404, detail="User not in this pod")
    member.pod_id = None
    cleared = 0
    for lead in member.assigned_leads:
        if lead.status in _TRANSFERABLE_STATUSES: lead.pod_id = None; cleared += 1
    db.commit()
    msg = f"{member.name} removed from pod"
    if cleared: msg += f". {cleared} lead(s) unaffiliated."
    return {"message": msg}


@router.post("/{pod_id}/assign-leads")
def assign_leads_to_pod(pod_id: str, body: dict, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    pod = db.query(Pod).filter(Pod.id == pod_id).first()
    if not pod: raise HTTPException(status_code=404, detail="Pod not found")
    lead_ids = body.get("lead_ids", [])
    if not lead_ids: raise HTTPException(status_code=400, detail="No lead IDs")
    pod_sdrs = db.query(User).filter(User.pod_id == pod_id, User.role == "SDR").all()
    if not pod_sdrs: raise HTTPException(status_code=400, detail="No SDRs in pod")

    # Company-grouped round-robin
    company_groups = OrderedDict()
    no_company = []
    for lid in lead_ids:
        lead = db.query(Lead).filter(Lead.id == lid).first()
        if not lead: continue
        ck = (lead.company or "").strip().lower()
        if ck: company_groups.setdefault(ck, []).append(lead)
        else: no_company.append(lead)
    batches = list(company_groups.values()) + [[l] for l in no_company]

    assigned = skipped = sdr_idx = 0
    full_sdrs = set()
    for batch in batches:
        if len(full_sdrs) == len(pod_sdrs): skipped += len(batch); continue
        placed = False
        for attempt in range(len(pod_sdrs)):
            sdr = pod_sdrs[(sdr_idx + attempt) % len(pod_sdrs)]
            if sdr.id in full_sdrs: continue
            current = len([l for l in sdr.assigned_leads if l.status in ACTIVE_STATUSES])
            cap = getattr(sdr, 'active_lead_cap', 0) or 0
            if cap > 0 and current >= cap: full_sdrs.add(sdr.id); continue
            ba = 0
            for lead in batch:
                if cap > 0 and (current + ba) >= cap: break
                if lead not in sdr.assigned_leads: sdr.assigned_leads.append(lead); lead.pod_id = pod_id; ba += 1
            assigned += ba; skipped += len(batch) - ba
            sdr_idx = (sdr_idx + attempt + 1) % len(pod_sdrs); placed = True; break
        if not placed: skipped += len(batch)
    db.commit()
    return {"message": f"{assigned} leads assigned to '{pod.name}'", "assigned": assigned, "skipped": skipped}
