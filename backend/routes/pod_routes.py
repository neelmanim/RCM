# ── routes/pod_routes.py — POD team management ────────────────────────────────
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from models import ACTIVE_STATUSES
from database import get_db
from auth import require_admin, require_super_admin

# Statuses whose leads should follow the user on pod transfer
_TRANSFERABLE_STATUSES = ACTIVE_STATUSES | {"Meeting Scheduled"}

router = APIRouter(prefix="/api/pods", tags=["PODs"])


def _validate_timezone(tz):
    """None/'' = UTC (unset). Otherwise must be a real IANA zone name."""
    tz = tz or None
    if tz:
        try:
            ZoneInfo(tz)
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(status_code=422, detail=f"Unknown timezone: {tz}")
    return tz


def _pod_to_dict(pod, db):
    """Serialize a Pod with its admins (list) and member details."""
    members = db.query(models.User).filter(models.User.pod_id == pod.id).all()
    # Fetch all Pod Admins for this pod from the junction table
    pod_admin_rows = (
        db.query(models.PodAdmin, models.User)
        .join(models.User, models.User.id == models.PodAdmin.user_id)
        .filter(models.PodAdmin.pod_id == pod.id)
        .all()
    )
    admins = [
        {
            "id":          pa.user_id,
            "name":        u.name,
            "email":       u.email,
            "assigned_at": str(pa.assigned_at) if pa.assigned_at else None,
        }
        for pa, u in pod_admin_rows
    ]
    return {
        "id":           pod.id,
        "name":         pod.name,
        "timezone":     pod.timezone,
        "admins":       admins,
        "created_at":   str(pod.created_at) if pod.created_at else None,
        "members": [{
            "id":    m.id,
            "name":  m.name,
            "email": m.email,
            "role":  m.role,
            "assigned_leads": len(m.assigned_leads)
        } for m in members],
        "member_count": len(members)
    }


@router.get("")
def list_pods(user: dict = Depends(require_admin), db: Session = Depends(get_db)):
    """List all PODs. Super Admin sees all, Pod Admin sees only their pod."""
    if user.get("role") == "Super Admin":
        pods = db.query(models.Pod).all()
    else:
        # Pod Admin: find pods they admin via pod_admins table
        admin_pod_ids = [
            row.pod_id for row in
            db.query(models.PodAdmin.pod_id)
            .filter(models.PodAdmin.user_id == user["sub"])
            .all()
        ]
        # Also include their membership pod (users.pod_id)
        db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
        if db_user and db_user.pod_id and db_user.pod_id not in admin_pod_ids:
            admin_pod_ids.append(db_user.pod_id)
        if admin_pod_ids:
            pods = db.query(models.Pod).filter(models.Pod.id.in_(admin_pod_ids)).all()
        else:
            pods = []
    return [_pod_to_dict(p, db) for p in pods]


@router.post("")
def create_pod(body: dict, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Create a new POD (Super Admin only). Optionally specify initial admin_id."""
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Pod name is required")

    pod = models.Pod(name=name, timezone=_validate_timezone(body.get("timezone")))
    db.add(pod)
    db.commit()
    db.refresh(pod)

    # Optionally set initial admin
    admin_id = body.get("admin_id")
    if admin_id:
        admin_user = db.query(models.User).filter(models.User.id == admin_id).first()
        if not admin_user:
            raise HTTPException(status_code=404, detail="Admin user not found")
        _add_pod_admin(db, pod.id, admin_id, assigned_by=user["sub"])

    return _pod_to_dict(pod, db)


@router.patch("/{pod_id}")
def update_pod(pod_id: str, body: dict, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Update a POD's name (Super Admin only). Use /admins endpoints to manage admins."""
    pod = db.query(models.Pod).filter(models.Pod.id == pod_id).first()
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")

    if "name" in body:
        pod.name = body["name"]
    if "timezone" in body:
        pod.timezone = _validate_timezone(body["timezone"])

    db.commit()
    db.refresh(pod)
    return _pod_to_dict(pod, db)


@router.delete("/{pod_id}")
def delete_pod(pod_id: str, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Delete a POD (Super Admin only). Members become unassigned from pod."""
    pod = db.query(models.Pod).filter(models.Pod.id == pod_id).first()
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")

    # Unassign all members from pod
    members = db.query(models.User).filter(models.User.pod_id == pod_id).all()
    for m in members:
        m.pod_id = None
    # pod_admins rows auto-cascade-delete via FK ON DELETE CASCADE
    db.delete(pod)
    db.commit()
    return {"ok": True, "message": f"Pod '{pod.name}' deleted. {len(members)} members unassigned."}


# ── Pod Admin management ───────────────────────────────────────────────────────

def _add_pod_admin(db: Session, pod_id: str, user_id: str, assigned_by: str = None):
    """Add a user as Pod Admin of this pod. Idempotent. Sets user.role = 'Pod Admin'."""
    existing = db.query(models.PodAdmin).filter(
        models.PodAdmin.pod_id == pod_id,
        models.PodAdmin.user_id == user_id
    ).first()
    if existing:
        return  # Already an admin — idempotent

    admin_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not admin_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Set role to Pod Admin and assign to this pod if not already in one
    admin_user.role = "Pod Admin"
    if not admin_user.pod_id:
        admin_user.pod_id = pod_id

    pa = models.PodAdmin(pod_id=pod_id, user_id=user_id, assigned_by=assigned_by)
    db.add(pa)
    db.commit()

    # Bust the /api/admin/users cache — otherwise the role change is invisible
    # in the Users list for up to the cache TTL (RCA 2026-07-11, found during
    # v10 Pod Admin staging verification).
    from cache import invalidate
    invalidate('users')


@router.post("/{pod_id}/admins")
def add_pod_admin(pod_id: str, body: dict, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Add a Pod Admin to this pod (Super Admin only). One pod can have multiple admins."""
    pod = db.query(models.Pod).filter(models.Pod.id == pod_id).first()
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")

    target_user_id = body.get("user_id")
    if not target_user_id:
        raise HTTPException(status_code=400, detail="user_id is required")

    target_user = db.query(models.User).filter(models.User.id == target_user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    if target_user.role not in ("SDR", "AE", "Pod Admin"):
        raise HTTPException(status_code=400, detail="Only SDR, AE, or Pod Admin users can be made Pod Admins")

    _add_pod_admin(db, pod_id, target_user_id, assigned_by=user["sub"])
    return _pod_to_dict(pod, db)


@router.delete("/{pod_id}/admins/{target_user_id}")
def remove_pod_admin(pod_id: str, target_user_id: str, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Remove a Pod Admin from this pod (Super Admin only).
    If user is no longer admin of any pod, their role reverts to 'SDR'.
    """
    pa = db.query(models.PodAdmin).filter(
        models.PodAdmin.pod_id == pod_id,
        models.PodAdmin.user_id == target_user_id
    ).first()
    if not pa:
        raise HTTPException(status_code=404, detail="This user is not an admin of this pod")

    db.delete(pa)
    db.commit()

    # Check if user still admins any other pod
    remaining = db.query(models.PodAdmin).filter(
        models.PodAdmin.user_id == target_user_id
    ).count()

    if remaining == 0:
        # No more pod admin roles — revert to SDR
        target_user = db.query(models.User).filter(models.User.id == target_user_id).first()
        if target_user:
            target_user.role = "SDR"
            db.commit()

    from cache import invalidate
    invalidate('users')

    pod = db.query(models.Pod).filter(models.Pod.id == pod_id).first()
    return _pod_to_dict(pod, db)


# ── Member management (unchanged) ─────────────────────────────────────────────

@router.post("/{pod_id}/members")
def add_pod_member(pod_id: str, body: dict, user: dict = Depends(require_admin), db: Session = Depends(get_db)):
    """Add a member to a POD. AE pods and SDR pods cannot be mixed."""
    pod = db.query(models.Pod).filter(models.Pod.id == pod_id).first()
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")

    # Pod Admin can only manage their own pod
    if user.get("role") == "Pod Admin":
        admin_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
        if not admin_user or admin_user.pod_id != pod_id:
            raise HTTPException(status_code=403, detail="Pod Admin can only manage their own POD")

    user_id = body.get("user_id")
    member = db.query(models.User).filter(models.User.id == user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="User not found")

    # Pod purity enforcement: no mixed SDR+AE pods
    if member.role in ("SDR", "AE"):
        existing_roles = {
            m.role for m in db.query(models.User)
            .filter(models.User.pod_id == pod_id)
            .all()
        }
        conflicting_role = "AE" if member.role == "SDR" else "SDR"
        if conflicting_role in existing_roles:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot add an {member.role} to this pod: it already has {conflicting_role} members. "
                       f"Pods must be either SDR-only or AE-only."
            )

    # Check if multi-pod SDR/AE is allowed
    if member.pod_id and member.pod_id != pod_id:
        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        allow_multi = settings.allow_multi_pod_sdr if settings else False
        if not allow_multi:
            existing_pod = db.query(models.Pod).filter(models.Pod.id == member.pod_id).first()
            pod_name = existing_pod.name if existing_pod else "another pod"
            raise HTTPException(status_code=400, detail=f"{member.name} is already a member of '{pod_name}'. Remove them from that pod first.")

    member.pod_id = pod_id

    # Move active leads to the new pod (leads follow the user)
    moved = 0
    for lead in member.assigned_leads:
        if lead.status in _TRANSFERABLE_STATUSES:
            lead.pod_id = pod_id
            moved += 1

    db.commit()
    msg = f"{member.name} added to pod '{pod.name}'"
    if moved:
        msg += f". {moved} active lead(s) moved to this pod."
    return {"message": msg}


@router.delete("/{pod_id}/members/{member_id}")
def remove_pod_member(pod_id: str, member_id: str, user: dict = Depends(require_admin), db: Session = Depends(get_db)):
    """Remove an SDR from a POD."""
    # Pod Admin can only manage their own pod
    if user.get("role") == "Pod Admin":
        admin_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
        if not admin_user or admin_user.pod_id != pod_id:
            raise HTTPException(status_code=403, detail="Pod Admin can only manage their own POD")

    member = db.query(models.User).filter(models.User.id == member_id, models.User.pod_id == pod_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="User not found in this pod")

    member.pod_id = None

    # Clear pod_id on active leads (they stay with the user, just unaffiliated)
    cleared = 0
    for lead in member.assigned_leads:
        if lead.status in _TRANSFERABLE_STATUSES:
            lead.pod_id = None
            cleared += 1

    db.commit()
    msg = f"{member.name} removed from pod"
    if cleared:
        msg += f". {cleared} active lead(s) are now unaffiliated."
    return {"message": msg}


@router.post("/{pod_id}/assign-leads")
def assign_leads_to_pod(pod_id: str, body: dict, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Assign leads to a POD. Leads are distributed to POD members (SDRs or AEs) respecting lead cap."""
    from routes._admin_helpers import _active_lead_count, _get_active_lead_cap

    pod = db.query(models.Pod).filter(models.Pod.id == pod_id).first()
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")

    lead_ids = body.get("lead_ids", [])
    if not lead_ids:
        raise HTTPException(status_code=400, detail="No lead IDs provided")

    # Get pod members (SDRs or AEs — pods are pure, never mixed)
    pod_sdrs = db.query(models.User).filter(
        models.User.pod_id == pod_id,
        models.User.role.in_(["SDR", "AE"])
    ).all()
    if not pod_sdrs:
        raise HTTPException(status_code=400, detail="No SDRs or AEs in this pod")

    # ── Company-grouped round-robin assignment ──────────────────────────────
    from collections import OrderedDict
    company_groups = OrderedDict()
    no_company = []

    for lid in lead_ids:
        lead = db.query(models.Lead).filter(models.Lead.id == lid).first()
        if not lead:
            continue
        company_key = (lead.company or "").strip().lower()
        if company_key:
            company_groups.setdefault(company_key, []).append(lead)
        else:
            no_company.append(lead)

    assignment_batches = list(company_groups.values()) + [[l] for l in no_company]

    assigned = 0
    skipped = 0
    sdr_idx = 0
    sdr_count = len(pod_sdrs)
    full_sdrs = set()

    for batch in assignment_batches:
        if len(full_sdrs) == sdr_count:
            skipped += len(batch)
            continue

        placed = False
        for attempt in range(sdr_count):
            sdr = pod_sdrs[(sdr_idx + attempt) % sdr_count]
            if sdr.id in full_sdrs:
                continue
            cap = _get_active_lead_cap(db, sdr)
            current = _active_lead_count(sdr)
            if cap > 0 and current >= cap:
                full_sdrs.add(sdr.id)
                continue

            batch_assigned = 0
            for lead in batch:
                if cap > 0 and (current + batch_assigned) >= cap:
                    break
                if models.assign_lead(sdr, lead):
                    batch_assigned += 1
                    # NOTE: AE cascade to Pod Admin removed (v10).
                    # Pod Admins see AE leads via pod scoping in lead_helpers.py.

            assigned += batch_assigned
            skipped += len(batch) - batch_assigned
            sdr_idx = (sdr_idx + attempt + 1) % sdr_count
            placed = True
            break

        if not placed:
            skipped += len(batch)

    db.commit()
    msg = f"{assigned} leads assigned to pod '{pod.name}'"
    if skipped:
        msg += f". {skipped} skipped (members at capacity)."
    return {"message": msg, "assigned": assigned, "skipped": skipped}
