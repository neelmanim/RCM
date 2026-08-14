"""
Lead routes — CRUD, kanban, status transitions, research, no-show, messaging.
"""
import threading
import hmac
import hashlib
import base64
import uuid as _uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, selectinload, lazyload
from sqlalchemy import func
from typing import Optional

from database import get_db
from middleware import get_current_user, require_admin
from models import (
    Lead, User, Note, CallLog, DialerCall, LeadStatusLog, SyncSettings, Pod,
    lead_assignments, log_status_change,
    TERMINAL_STATUSES, ACTIVE_STATUSES, RESEARCH_FIELDS,
)
from services.lead_service import (
    lead_to_summary, lead_to_dict, build_lead_query, can_modify_lead,
    apply_filters, batch_latest_activity, batch_company_resolutions,
    get_company_resolution, is_backward_move,
    PER_PAGE_DEFAULT, PER_PAGE_MAX, ALL_STATUSES,
)
from utils.activity_logger import log_activity

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Leads"])


# ── Paginated list (admin) ───────────────────────────────────────────────────

@router.get("/leads")
def get_leads(
    page: int = Query(1, ge=1),
    per_page: int = Query(PER_PAGE_DEFAULT, ge=1, le=PER_PAGE_MAX),
    search: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    company: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    outcome: Optional[str] = None,
    assigned_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    base = build_lead_query(db, user)
    if user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    base = apply_filters(base, search, status, source, date_from, date_to, company=company, outcome=outcome)

    if assigned_to == 'unassigned':
        assigned_ids = db.query(lead_assignments.c.lead_id).distinct()
        base = base.filter(~Lead.id.in_(assigned_ids))
    elif assigned_to:
        base = base.filter(Lead.assigned_users.any(User.id == assigned_to))

    total = base.count()
    leads = (
        base.options(selectinload(Lead.assigned_users), lazyload(Lead.notes), lazyload(Lead.call_logs))
        .order_by(func.lower(func.coalesce(Lead.company, '')).asc(), Lead.created_at.desc())
        .offset((page - 1) * per_page).limit(per_page).all()
    )

    latest_notes, latest_calls = batch_latest_activity(db, leads)
    resolutions = batch_company_resolutions(db, leads)
    data = []
    for l in leads:
        summary = lead_to_summary(l, prefetched_note=latest_notes.get(l.id), prefetched_call=latest_calls.get(l.id))
        summary["company_resolved"] = resolutions.get(l.id)
        data.append(summary)

    return {"data": data, "total": total, "page": page, "per_page": per_page, "pages": max(1, (total + per_page - 1) // per_page)}


# ── Company list ─────────────────────────────────────────────────────────────

@router.get("/leads/companies")
def get_lead_companies(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    base = build_lead_query(db, user)
    rows = base.with_entities(Lead.company).filter(Lead.company != None, Lead.company != "").distinct().all()
    companies = sorted(set(r[0].strip() for r in rows if r[0] and r[0].strip()), key=str.lower)
    return {"companies": companies}


# ── My Leads ─────────────────────────────────────────────────────────────────

@router.get("/leads/my")
def get_my_leads(
    page: int = Query(1, ge=1),
    per_page: int = Query(PER_PAGE_DEFAULT, ge=1, le=PER_PAGE_MAX),
    search: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    company: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    outcome: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    base = build_lead_query(db, user)
    base = apply_filters(base, search, status, source, date_from, date_to, company=company, outcome=outcome)
    total = base.count()
    leads = (
        base.options(selectinload(Lead.assigned_users), lazyload(Lead.notes), lazyload(Lead.call_logs))
        .order_by(Lead.priority_score.desc(), func.lower(func.coalesce(Lead.company, '')).asc(), Lead.created_at.desc())
        .offset((page - 1) * per_page).limit(per_page).all()
    )

    latest_notes, latest_calls = batch_latest_activity(db, leads)
    resolutions = batch_company_resolutions(db, leads)
    data = []
    for l in leads:
        summary = lead_to_summary(l, prefetched_note=latest_notes.get(l.id), prefetched_call=latest_calls.get(l.id))
        summary["company_resolved"] = resolutions.get(l.id)
        data.append(summary)

    return {"data": data, "total": total, "page": page, "per_page": per_page, "pages": max(1, (total + per_page - 1) // per_page)}


# ── Dashboard Stats ──────────────────────────────────────────────────────────

@router.get("/leads/dashboard-stats")
def get_dashboard_stats(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    base = build_lead_query(db, user)
    total = base.count()
    status_counts = {}
    for s in ALL_STATUSES:
        status_counts[s] = base.filter(Lead.status == s).count()

    recent = (
        base.options(joinedload(Lead.assigned_users), joinedload(Lead.call_logs))
        .order_by(Lead.created_at.desc()).limit(8).all()
    )
    return {"total": total, "status_counts": status_counts, "recent_leads": [lead_to_summary(l) for l in recent]}


# ── Kanban ───────────────────────────────────────────────────────────────────

@router.get("/leads/kanban")
def get_kanban_leads(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    base = build_lead_query(db, user)
    leads = base.options(joinedload(Lead.assigned_users), joinedload(Lead.call_logs)).all()
    return [lead_to_summary(l) for l in leads]


# ── Activity Feed ────────────────────────────────────────────────────────────

@router.get("/leads/activity-feed")
def get_activity_feed(limit: int = Query(50, ge=1, le=200), user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    logs = (
        db.query(LeadStatusLog).join(Lead, LeadStatusLog.lead_id == Lead.id)
        .order_by(LeadStatusLog.changed_at.desc()).limit(limit).all()
    )
    return [{
        "id": l.id, "lead_id": l.lead_id,
        "lead_name": f"{l.lead.first_name or ''} {l.lead.last_name or ''}".strip() if l.lead else "Unknown",
        "company": l.lead.company if l.lead else None,
        "from_status": l.from_status, "to_status": l.to_status,
        "changed_by": l.changed_by,
        "changed_at": str(l.changed_at) if l.changed_at else None,
    } for l in logs]


# ── Create Lead ──────────────────────────────────────────────────────────────

@router.post("/leads")
def create_lead(lead_data: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        requested_status = lead_data.get("status", "Lead Assigned")
        if requested_status not in {"Lead Assigned", "Research"}:
            requested_status = "Lead Assigned"

        new_lead = Lead(
            sf_lead_id=f"manual-{_uuid.uuid4().hex[:8]}",
            first_name=lead_data.get("first_name", ""),
            last_name=lead_data.get("last_name", "Unknown"),
            email=lead_data.get("email"),
            phone=lead_data.get("phone"),
            phone_secondary=lead_data.get("phone_secondary"),
            company=lead_data.get("company"),
            title=lead_data.get("title"),
            linkedin_url=lead_data.get("linkedin_url"),
            person_linkedin=lead_data.get("person_linkedin"),
            status=requested_status,
            lead_source="manual",
            lead_started_at=datetime.now(timezone.utc),
        )

        db_user = db.query(User).filter(User.id == user["sub"]).first()
        if db_user and db_user.pod_id:
            new_lead.pod_id = db_user.pod_id

        db.add(new_lead)
        db.flush()

        if db_user:
            new_lead.assigned_users.append(db_user)

        log_status_change(db, new_lead.id, None, requested_status, user.get("name") or user.get("email", "unknown"))
        db.commit()
        db.refresh(new_lead)

        try:
            lead_name = f"{new_lead.first_name or ''} {new_lead.last_name or ''}".strip()
            log_activity(user["sub"], "CREATE_LEAD",
                         user_email=user.get("email"), user_name=user.get("name"),
                         object_type="lead", object_id=new_lead.id,
                         metadata={"lead_name": lead_name, "company": new_lead.company, "status": requested_status})
        except Exception:
            pass

        return lead_to_dict(new_lead)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Single Lead Detail ───────────────────────────────────────────────────────

@router.get("/leads/{lead_id}")
def get_lead(lead_id: str, db: Session = Depends(get_db)):
    lead = db.query(Lead).options(
        joinedload(Lead.assigned_users), joinedload(Lead.call_logs), joinedload(Lead.dialer_calls)
    ).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    detail = lead_to_dict(lead)
    detail["company_resolved"] = get_company_resolution(db, lead)
    return detail


# ── Update Lead ──────────────────────────────────────────────────────────────

@router.patch("/leads/{lead_id}")
def update_lead(lead_id: str, updates: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = can_modify_lead(db, user, lead_id)
    allowed = {"first_name", "last_name", "email", "phone", "phone_secondary", "company", "title", "status"}
    filtered = {k: v for k, v in updates.items() if k in allowed}

    if "status" in filtered and filtered["status"] != lead.status:
        if is_backward_move(lead.status, filtered["status"]) and user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
            raise HTTPException(status_code=403, detail="SDRs cannot move leads to a previous status.")
        if filtered["status"] == "Meeting Scheduled":
            call_count = db.query(CallLog).filter(CallLog.lead_id == lead_id).count()
            if call_count == 0:
                raise HTTPException(status_code=422, detail="At least 1 call must be logged before Moving to Meeting Scheduled.")
        old_status = lead.status
        lead.status_changed_at = datetime.now(timezone.utc)
        log_status_change(db, lead.id, old_status, filtered["status"], user.get("name") or user.get("email", "unknown"))

    for key, val in filtered.items():
        setattr(lead, key, val)
    db.commit()
    db.refresh(lead)
    return lead_to_dict(lead)


# ── Priority ─────────────────────────────────────────────────────────────────

@router.patch("/leads/{lead_id}/priority")
def update_lead_priority(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = can_modify_lead(db, user, lead_id)
    score = body.get("priority_score", 100)
    try:
        score = int(score)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="priority_score must be an integer.")
    lead.priority_score = max(0, min(100, score))
    db.commit()
    db.refresh(lead)
    return {"ok": True, "priority_score": lead.priority_score}


# ── Research ─────────────────────────────────────────────────────────────────

@router.patch("/leads/{lead_id}/research")
def update_research(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = can_modify_lead(db, user, lead_id)
    for field in RESEARCH_FIELDS:
        if field in body:
            setattr(lead, field, body[field])
    db.commit()
    db.refresh(lead)
    return lead_to_dict(lead)


# ── Kanban Move ──────────────────────────────────────────────────────────────

@router.patch("/leads/kanban/move")
def move_lead_kanban(lead_id: str, new_status: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = can_modify_lead(db, user, lead_id)

    if new_status == "Disqualified":
        raise HTTPException(status_code=422, detail="Use the 'Close Lead' action to disqualify a lead.")
    if lead.status == "Disqualified":
        raise HTTPException(status_code=422, detail="Cannot move a disqualified lead.")
    if is_backward_move(lead.status, new_status) and user.get("role") not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="SDRs cannot move leads to a previous status.")

    CORE_RESEARCH = ["research_company", "research_contact", "research_hypothesis", "research_personalization"]
    if new_status in ("Calling", "Meeting Scheduled"):
        missing = [f for f in CORE_RESEARCH if not getattr(lead, f, None)]
        if missing:
            field_labels = {
                "research_company": "What does this company do?",
                "research_contact": "Contact Context",
                "research_hypothesis": "Pitch Angle / Hypothesis",
                "research_personalization": "Personalization Note"
            }
            missing_labels = [field_labels.get(f, f) for f in missing]
            raise HTTPException(status_code=422, detail=f"Complete these required fields: {', '.join(missing_labels)}")

    if new_status == "Meeting Scheduled":
        call_count = db.query(CallLog).filter(CallLog.lead_id == lead_id).count()
        if call_count == 0:
            raise HTTPException(status_code=422, detail="At least 1 call must be logged before moving to Meeting Scheduled.")

    old_status = lead.status
    lead.status = new_status
    lead.status_changed_at = datetime.now(timezone.utc)
    log_status_change(db, lead.id, old_status, new_status, user.get("name") or user.get("email", "unknown"))

    if new_status in TERMINAL_STATUSES:
        lead.lead_closed_at = datetime.now(timezone.utc)
        lead.closed_reason = new_status

    db.commit()
    db.refresh(lead)

    try:
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        log_activity(user["sub"], "UPDATE_LEAD_STATUS",
                     user_email=user.get("email"), user_name=user.get("name"),
                     object_type="lead", object_id=lead_id,
                     metadata={"lead_name": lead_name, "from_status": old_status, "to_status": new_status})
        if new_status == "Meeting Scheduled":
            log_activity(user["sub"], "SCHEDULE_MEETING",
                         user_email=user.get("email"), user_name=user.get("name"),
                         object_type="lead", object_id=lead_id,
                         metadata={"lead_name": lead_name})
    except Exception:
        pass

    return {"message": f"Lead {lead_id} status updated to {new_status}", "lead": lead_to_dict(lead)}


# ── Status History ───────────────────────────────────────────────────────────

@router.get("/leads/{lead_id}/status-history")
def get_lead_status_history(lead_id: str, db: Session = Depends(get_db)):
    logs = db.query(LeadStatusLog).filter(LeadStatusLog.lead_id == lead_id).order_by(LeadStatusLog.changed_at.desc()).all()
    return [{"id": l.id, "from_status": l.from_status, "to_status": l.to_status, "changed_by": l.changed_by, "changed_at": str(l.changed_at) if l.changed_at else None} for l in logs]


# ── Lead Outcome ─────────────────────────────────────────────────────────────

@router.patch("/leads/{lead_id}/outcome")
def update_lead_outcome(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    role = user.get("role")
    if role not in ("Super Admin", "Admin", "Pod Admin"):
        raise HTTPException(status_code=403, detail="Only Pod Admins and Super Admins can update lead outcomes.")

    lead = db.query(Lead).options(joinedload(Lead.assigned_users)).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if role == "Pod Admin":
        pod_id = user.get("pod_id")
        lead_pod_ids = [u.pod_id for u in lead.assigned_users if u.pod_id]
        if pod_id not in lead_pod_ids and lead.pod_id != pod_id:
            raise HTTPException(status_code=403, detail="You can only update outcomes for leads in your POD.")

    opp_status = body.get("status", "").strip()
    if opp_status not in ("Won", "Lost"):
        raise HTTPException(status_code=400, detail="Status must be 'Won' or 'Lost'.")
    if lead.status not in ("Meeting Scheduled", "Disqualified"):
        raise HTTPException(status_code=400, detail="Outcome can only be set for leads in Meeting Scheduled or Disqualified status.")

    lead.opportunity_status = opp_status
    lead.opportunity_notes = body.get("notes", "").strip() or None
    lead.opportunity_updated_at = datetime.now(timezone.utc)
    lead.opportunity_updated_by = user.get("name", "Admin")
    log_status_change(db, lead.id, f"Outcome: {opp_status}", f"Outcome: {opp_status}", changed_by=user.get("name", "Admin"))
    db.commit()
    db.refresh(lead)
    return {"message": f"Lead outcome updated to {opp_status}", "lead": lead_to_dict(lead)}


# ── No Show ──────────────────────────────────────────────────────────────────

@router.post("/leads/{lead_id}/no-show")
def mark_no_show(lead_id: str, body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = can_modify_lead(db, user, lead_id)
    if lead.status != "Meeting Scheduled":
        raise HTTPException(status_code=422, detail=f"No-show can only be marked for leads in 'Meeting Scheduled' status. Current: {lead.status}")

    reason = body.get("reason", "").strip()
    if len(reason) < 10:
        raise HTTPException(status_code=422, detail="Reason must be at least 10 characters.")

    old_status = lead.status
    lead.status = "Calling"
    lead.status_changed_at = datetime.now(timezone.utc)
    lead.no_show_count = (lead.no_show_count or 0) + 1
    lead.lead_closed_at = None
    lead.closed_reason = None

    log_status_change(db, lead.id, old_status, "Calling", changed_by=f"{user.get('name', 'SDR')} (No Show: {reason[:50]})")
    db.commit()
    db.refresh(lead)

    try:
        lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
        log_activity(user["sub"], "UPDATE_LEAD_STATUS",
                     user_email=user.get("email"), user_name=user.get("name"),
                     object_type="lead", object_id=lead_id,
                     metadata={"lead_name": lead_name, "from_status": old_status, "to_status": "Calling", "reason": reason})
    except Exception:
        pass

    return {"message": "No-show recorded. Lead moved back to Calling.", "lead": lead_to_dict(lead), "no_show_count": lead.no_show_count}


# ── Messaging Config ─────────────────────────────────────────────────────────

@router.get("/leads/{lead_id}/messaging/config")
def get_messaging_config(lead_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    settings = db.query(SyncSettings).first()
    if not settings or not settings.rcm_enabled:
        return {"enabled": False, "reason": "Conversations not enabled."}
    if not settings.rcm_api_key:
        return {"enabled": False, "reason": "Conversations API key not configured."}

    phone = (lead.phone or "").strip() or (lead.phone_secondary or "").strip()
    if not phone:
        return {"enabled": True, "has_phone": False, "reason": "No phone number on this lead."}

    base_url = (settings.rcm_base_url or "https://app.bercm.com").rstrip("/")
    api_key = settings.rcm_api_key

    current_user = db.query(User).filter(User.id == user["sub"]).first()
    user_id = (getattr(current_user, 'rcm_user_id', None) or "").strip() or (settings.rcm_user_id or "")
    record_id = lead.am_record_id

    if not record_id:
        # Try to search/create in Audience Manager
        try:
            from integrations.audience_manager import ensure_contact
            record_id = ensure_contact(
                base_url=base_url, api_key=api_key, user_id=user_id,
                first_name=lead.first_name or "", last_name=lead.last_name or "",
                phone=phone, email=lead.email or "",
            )
            if record_id:
                lead.am_record_id = record_id
                db.commit()
        except Exception:
            pass

    if not record_id:
        return {"enabled": True, "has_phone": True, "synced": False, "reason": "Could not sync contact to Audience Manager."}

    iframe_url = f"{base_url}/fastapp/desk/#/inbox?crm=audience_manager&record_id={record_id}&record_type=contacts"

    # Server-side auth
    auth_ok = False
    auth_error = None
    try:
        import requests as _req
        now = datetime.now(timezone.utc)
        timestamp = now.strftime('%Y-%m-%dT%H:%M:%S.') + now.strftime('%f')[:3] + 'Z'
        message = f'userId={user_id}&timestamp={timestamp}&'
        signature = base64.b64encode(hmac.new(api_key.encode(), message.encode(), hashlib.sha256).digest()).decode()

        auth_resp = _req.get(f"{base_url}/api/v2/crm/authenticate", params={
            "crm": "audience_manager", "userId": user_id, "apiKey": api_key,
            "timestamp": timestamp, "signature": signature,
        }, timeout=15)
        if auth_resp.ok:
            auth_data = auth_resp.json()
            access_token = auth_data.get("access_token", "")
            refresh_token = auth_data.get("refresh_token", "")
            if access_token:
                iframe_url += f"&session_id={access_token}"
                auth_ok = True
            if refresh_token:
                iframe_url += f"&refresh_token={refresh_token}"
        else:
            auth_error = f"Authentication failed (HTTP {auth_resp.status_code})"
    except Exception as e:
        auth_error = f"Authentication request failed: {str(e)[:100]}"

    return {"enabled": True, "has_phone": True, "synced": True, "iframe_url": iframe_url, "phone": phone, "record_id": record_id, "auth_ok": auth_ok, "auth_error": auth_error}


@router.post("/leads/{lead_id}/messaging/sync")
def sync_messaging_contact(lead_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    settings = db.query(SyncSettings).first()
    if not settings or not settings.rcm_enabled or not settings.rcm_api_key:
        raise HTTPException(status_code=400, detail="Conversations not configured")

    phone = (lead.phone or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Lead has no phone number")

    try:
        from integrations.audience_manager import ensure_contact
        base_url = (settings.rcm_base_url or "https://app.bercm.com").rstrip("/")
        record_id = ensure_contact(
            base_url=base_url, api_key=settings.rcm_api_key,
            user_id=settings.rcm_user_id or "",
            first_name=lead.first_name or "", last_name=lead.last_name or "",
            phone=phone, email=lead.email or "",
        )
        if record_id:
            lead.am_record_id = record_id
            db.commit()
            return {"synced": True, "record_id": record_id}
    except Exception:
        pass
    raise HTTPException(status_code=502, detail="Failed to sync contact to Audience Manager")
