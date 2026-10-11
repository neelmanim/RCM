# ── routes/pod_routes.py — POD team management ────────────────────────────────
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import ownership_history as oh
import access_db
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


def _pod_activity_stats(db, member_ids):
    """Per-member active-lead count + staleness buckets, one bulk query for
    the whole pod (not a per-member relationship load) — feeds the roster
    drilldown a Pod Admin uses to see whose leads have gone untouched."""
    stats = {mid: {"active_leads": 0, "stale_24h": 0, "stale_72h": 0} for mid in member_ids}
    if not member_ids:
        return stats
    rows = (
        db.query(models.lead_assignments.c.user_id, models.Lead.status_changed_at)
        .join(models.Lead, models.Lead.id == models.lead_assignments.c.lead_id)
        .filter(models.lead_assignments.c.user_id.in_(member_ids))
        .filter(models.Lead.status.in_(ACTIVE_STATUSES))
        .filter(models.Lead.deleted_at.is_(None))
        .all()
    )
    now = datetime.now(timezone.utc)
    for user_id, status_changed_at in rows:
        s = stats[user_id]
        s["active_leads"] += 1
        if status_changed_at:
            changed = status_changed_at if status_changed_at.tzinfo else status_changed_at.replace(tzinfo=timezone.utc)
            hours = (now - changed).total_seconds() / 3600
            if hours >= 72:
                s["stale_72h"] += 1
            elif hours >= 24:
                s["stale_24h"] += 1
    return stats


def _bulk_assigned_lead_counts(db, member_ids):
    """All-time assigned-lead count (any status) per user, one query — was a
    per-member lazy relationship load (len(m.assigned_leads)) before."""
    if not member_ids:
        return {}
    rows = (
        db.query(models.lead_assignments.c.user_id, func.count(models.lead_assignments.c.lead_id))
        .filter(models.lead_assignments.c.user_id.in_(member_ids))
        .group_by(models.lead_assignments.c.user_id)
        .all()
    )
    return dict(rows)


def _pod_to_dict(pod, db, members=None, admins=None, activity=None, assigned_counts=None):
    """Serialize a Pod with its admins (list) and member details.

    The four optional params let a caller listing many pods (list_pods)
    precompute them ONCE across every pod instead of once per pod — the
    per-pod queries here were the actual cause of the Team Roster's slow
    load with more than a couple of pods. Single-pod call sites (create/
    update/delete/add-member/etc.) omit them and get the old, simpler
    one-pod-at-a-time behavior.
    """
    if members is None:
        members = db.query(models.User).filter(models.User.pod_id == pod.id).all()
    member_ids = [m.id for m in members]
    if activity is None:
        activity = _pod_activity_stats(db, member_ids)
    if assigned_counts is None:
        assigned_counts = _bulk_assigned_lead_counts(db, member_ids)
    if admins is None:
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
                "assigned_at": pa.assigned_at.isoformat() if pa.assigned_at else None,
            }
            for pa, u in pod_admin_rows
        ]
    return {
        "id":           pod.id,
        "name":         pod.name,
        "timezone":     pod.timezone,
        "admins":       admins,
        "created_at":   pod.created_at.isoformat() if pod.created_at else None,
        "members": [{
            "id":    m.id,
            "name":  m.name,
            "email": m.email,
            "role":  m.role,
            "assigned_leads": assigned_counts.get(m.id, 0),
            # Active (non-terminal) leads and how long they've sat untouched —
            # distinct from assigned_leads above, which counts every lead ever
            # assigned regardless of status.
            "active_leads": activity[m.id]["active_leads"],
            "stale_24h":    activity[m.id]["stale_24h"],
            "stale_72h":    activity[m.id]["stale_72h"],
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

    if not pods:
        return []

    pod_ids = [p.id for p in pods]
    all_members = db.query(models.User).filter(models.User.pod_id.in_(pod_ids)).all()
    members_by_pod = defaultdict(list)
    for m in all_members:
        members_by_pod[m.pod_id].append(m)
    member_ids = [m.id for m in all_members]
    activity = _pod_activity_stats(db, member_ids)
    assigned_counts = _bulk_assigned_lead_counts(db, member_ids)

    admin_rows = (
        db.query(models.PodAdmin, models.User)
        .join(models.User, models.User.id == models.PodAdmin.user_id)
        .filter(models.PodAdmin.pod_id.in_(pod_ids))
        .all()
    )
    admins_by_pod = defaultdict(list)
    for pa, u in admin_rows:
        admins_by_pod[pa.pod_id].append({
            "id":          pa.user_id,
            "name":        u.name,
            "email":       u.email,
            "assigned_at": pa.assigned_at.isoformat() if pa.assigned_at else None,
        })

    return [
        _pod_to_dict(p, db, members=members_by_pod[p.id], admins=admins_by_pod[p.id],
                     activity=activity, assigned_counts=assigned_counts)
        for p in pods
    ]


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
        if (access_db.pod_of(user)) != pod_id:
            raise HTTPException(status_code=403, detail="Pod Admin can only manage their own POD")

    user_id = body.get("user_id")
    member = db.query(models.User).filter(models.User.id == user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("role") == "Pod Admin" and (member.role not in ("SDR", "AE") or (member.pod_id and member.pod_id != pod_id)):
        # v13.12.1: a Pod Admin could pull in any user id — admins, or reps (and their leads) from another pod
        raise HTTPException(status_code=403, detail="Pod Admins can only add reps who aren't in another POD.")

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

    # Bust the /api/admin/users cache — otherwise the new POD is invisible in
    # the Users list for up to the cache TTL, same gap as add/remove Pod
    # Admin above (RCA 2026-07-11) but never applied here.
    from cache import invalidate
    invalidate('users')

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

    from cache import invalidate
    invalidate('users')

    msg = f"{member.name} removed from pod"
    if cleared:
        msg += f". {cleared} active lead(s) are now unaffiliated."
    return {"message": msg}


@router.post("/{pod_id}/assign-leads")
def assign_leads_to_pod(pod_id: str, body: dict, user: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Assign leads to a POD. Leads are distributed to POD members (SDRs or AEs) via round-robin."""
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
    sdr_count = len(pod_sdrs)

    for i, batch in enumerate(assignment_batches):
        sdr = pod_sdrs[i % sdr_count]
        batch_assigned = 0
        for lead in batch:
            if models.assign_lead(sdr, lead, reason=oh.R_POD, actor_id=user["sub"]):
                batch_assigned += 1
                # NOTE: AE cascade to Pod Admin removed (v10).
                # Pod Admins see AE leads via pod scoping in lead_helpers.py.
        assigned += batch_assigned
        skipped += len(batch) - batch_assigned

    db.commit()
    msg = f"{assigned} leads assigned to pod '{pod.name}'"
    return {"message": msg, "assigned": assigned, "skipped": skipped}
