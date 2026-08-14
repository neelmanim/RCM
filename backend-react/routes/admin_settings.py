"""Admin routes — Sync settings, SF connection, lead upload, pods."""
import os, json, csv, io, re, uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from database import get_db
from middleware import require_admin, require_super_admin
from models import Lead, User, Pod, SyncSettings, LeadUploadLog, lead_assignments, ACTIVE_STATUSES

router = APIRouter(prefix="/api/admin", tags=["Admin Settings"])


def _get_or_create_sync_settings(db):
    settings = db.query(SyncSettings).filter(SyncSettings.id == 1).first()
    if not settings:
        settings = SyncSettings(id=1, lead_limit=int(os.getenv("SF_LEAD_LIMIT", 1000)), record_type_ids=None)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

def _get_active_lead_cap(db, user):
    if user.pod_id:
        pod = user.pod if user.pod else db.query(Pod).filter(Pod.id == user.pod_id).first()
        if pod and pod.active_lead_cap is not None:
            return pod.active_lead_cap
    settings = db.query(SyncSettings).filter(SyncSettings.id == 1).first()
    return settings.active_lead_cap if settings and settings.active_lead_cap is not None else 500

def _active_lead_count(user):
    return len([l for l in user.assigned_leads if l.status in ACTIVE_STATUSES])


# ── Sync Settings ────────────────────────────────────────────────────────────

@router.get("/sync-settings")
def get_sync_settings(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    settings = _get_or_create_sync_settings(db)
    rtype_ids = json.loads(settings.record_type_ids) if settings.record_type_ids else []
    return {
        "lead_limit": settings.lead_limit, "record_type_ids": rtype_ids,
        "sf_push_stage": settings.sf_push_stage or "Meeting Scheduled",
        "sync_direction": getattr(settings, 'sync_direction', None) or "push_only",
        "allow_multi_pod_sdr": settings.allow_multi_pod_sdr,
        "active_lead_cap": settings.active_lead_cap if settings.active_lead_cap is not None else 5,
        "max_call_attempts": settings.max_call_attempts if settings.max_call_attempts is not None else 5,
        "min_call_attempts_for_unreachable": settings.min_call_attempts_for_unreachable if settings.min_call_attempts_for_unreachable is not None else 3,
        "sync_declined_to_salesforce": getattr(settings, 'sync_declined_to_salesforce', False),
        "sync_unreachable_to_salesforce": getattr(settings, 'sync_unreachable_to_salesforce', False),
        "terminal_lead_cooldown_days": settings.terminal_lead_cooldown_days if settings.terminal_lead_cooldown_days is not None else 30,
        "updated_at": str(settings.updated_at) if settings.updated_at else None,
        "rcm_enabled": getattr(settings, 'rcm_enabled', False) or False,
        "rcm_base_url": getattr(settings, 'rcm_base_url', '') or '',
        "rcm_api_key": getattr(settings, 'rcm_api_key', '') or '',
        "rcm_user_id": getattr(settings, 'rcm_user_id', '') or '',
        "rcm_access_token": "••••" if getattr(settings, 'rcm_access_token', None) else '',
    }


@router.patch("/sync-settings")
def update_sync_settings(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    settings = _get_or_create_sync_settings(db)
    int_fields = {"lead_limit": (0, None), "active_lead_cap": (0, None), "max_call_attempts": (1, None), "min_call_attempts_for_unreachable": (1, None), "terminal_lead_cooldown_days": (0, None)}
    for field, (min_val, _) in int_fields.items():
        if field in body:
            val = int(body[field])
            if val < min_val:
                raise HTTPException(status_code=422, detail=f"{field} must be >= {min_val}")
            setattr(settings, field, val)
    if "record_type_ids" in body:
        settings.record_type_ids = json.dumps(body["record_type_ids"]) if body["record_type_ids"] else None
    if "sf_push_stage" in body:
        settings.sf_push_stage = body["sf_push_stage"]
    if "sync_direction" in body:
        if body["sync_direction"] not in ("push_only", "both"):
            raise HTTPException(status_code=422, detail="sync_direction must be 'push_only' or 'both'")
        settings.sync_direction = body["sync_direction"]
    for bool_field in ["allow_multi_pod_sdr", "sync_declined_to_salesforce", "sync_unreachable_to_salesforce", "rcm_enabled"]:
        if bool_field in body:
            setattr(settings, bool_field, bool(body[bool_field]))
    for str_field in ["rcm_base_url", "rcm_api_key", "rcm_user_id", "rcm_access_token", "llm_provider", "llm_api_key", "llm_model"]:
        if str_field in body:
            setattr(settings, str_field, body[str_field])
    db.commit()
    db.refresh(settings)
    return {"message": "Settings updated", "updated_at": str(settings.updated_at) if settings.updated_at else None}


@router.get("/sf-connection-info")
def get_sf_connection_info(admin: dict = Depends(require_admin)):
    sf_username = os.getenv("SF_USERNAME", "")
    sf_domain = os.getenv("SF_DOMAIN", "login")
    return {"connected": bool(sf_username), "username": sf_username, "domain_type": "Sandbox" if sf_domain == "test" else "Production", "instance_url": f"https://{sf_domain}.salesforce.com"}


# ── Pods ─────────────────────────────────────────────────────────────────────

@router.get("/pods")
def list_pods(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    pods = db.query(Pod).all()
    result = []
    for pod in pods:
        members = db.query(User).filter(User.pod_id == pod.id).all()
        admin_user = db.query(User).filter(User.id == pod.admin_id).first() if pod.admin_id else None
        result.append({"id": pod.id, "name": pod.name, "admin_id": pod.admin_id, "admin_name": admin_user.name if admin_user else None, "active_lead_cap": pod.active_lead_cap, "member_count": len(members), "members": [{"id": m.id, "name": m.name, "email": m.email, "role": m.role} for m in members], "created_at": str(pod.created_at) if pod.created_at else None})
    return result


@router.post("/pods")
def create_pod(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Pod name is required")
    if db.query(Pod).filter(Pod.name == name).first():
        raise HTTPException(status_code=400, detail="Pod with this name already exists")
    pod = Pod(name=name, admin_id=body.get("admin_id"), active_lead_cap=body.get("active_lead_cap"))
    db.add(pod)
    db.commit()
    db.refresh(pod)
    member_ids = body.get("member_ids", [])
    for mid in member_ids:
        u = db.query(User).filter(User.id == mid).first()
        if u:
            u.pod_id = pod.id
    db.commit()
    return {"message": f"Pod '{name}' created", "pod_id": pod.id}


@router.patch("/pods/{pod_id}")
def update_pod(pod_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    pod = db.query(Pod).filter(Pod.id == pod_id).first()
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")
    if "name" in body:
        pod.name = body["name"]
    if "admin_id" in body:
        pod.admin_id = body["admin_id"]
    if "active_lead_cap" in body:
        pod.active_lead_cap = body["active_lead_cap"]
    if "member_ids" in body:
        current = db.query(User).filter(User.pod_id == pod_id).all()
        for u in current:
            u.pod_id = None
        for mid in body["member_ids"]:
            u = db.query(User).filter(User.id == mid).first()
            if u:
                u.pod_id = pod_id
    db.commit()
    return {"message": f"Pod '{pod.name}' updated"}


@router.delete("/pods/{pod_id}")
def delete_pod(pod_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    pod = db.query(Pod).filter(Pod.id == pod_id).first()
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")
    members = db.query(User).filter(User.pod_id == pod_id).all()
    for m in members:
        m.pod_id = None
    db.delete(pod)
    db.commit()
    return {"message": f"Pod '{pod.name}' deleted"}


# ── Lead Upload ──────────────────────────────────────────────────────────────

COLUMN_MAP = {
    "first name": "first_name", "firstname": "first_name", "last name": "last_name", "lastname": "last_name",
    "email": "email", "email address": "email", "phone": "phone", "mobile": "phone", "company": "company",
    "company name": "company", "job title": "title", "title": "title", "linkedin url": "linkedin_url",
    "linkedin": "linkedin_url", "person linkedin": "person_linkedin", "website": "website",
    "city": "city", "state": "state", "country": "country", "industry": "industry",
    "# employees": "employee_count", "employees": "employee_count",
    "annual revenue": "annual_revenue", "total funding": "total_funding",
}

def _is_valid_email(val):
    if not val or "@" not in val:
        return False
    local, _, domain = val.rpartition("@")
    return bool(local.strip()) and "." in domain


@router.post("/leads/upload-preview")
def upload_preview(body: dict, admin: dict = Depends(require_admin)):
    csv_content = body.get("csv")
    if not csv_content:
        raise HTTPException(status_code=400, detail="CSV content missing")
    reader = csv.DictReader(io.StringIO(csv_content))
    headers = reader.fieldnames or []
    rows = [row for i, row in zip(range(5), reader)]
    auto_mapping = {h: COLUMN_MAP[h.strip().lower()] for h in headers if h.strip().lower() in COLUMN_MAP}
    return {"headers": headers, "preview_rows": rows, "auto_mapping": auto_mapping, "available_fields": list(set(COLUMN_MAP.values()))}


@router.get("/leads/upload-logs")
def get_upload_logs(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    logs = db.query(LeadUploadLog).order_by(LeadUploadLog.created_at.desc()).limit(50).all()
    return [{"id": l.id, "filename": l.filename, "uploaded_by": (l.uploader.name or l.uploader.email) if l.uploader else "Unknown", "total_rows": l.total_rows, "created": l.created, "updated": getattr(l, 'updated', 0) or 0, "skipped": l.skipped, "errors": l.errors, "error_detail": json.loads(l.error_detail) if l.error_detail else [], "status": l.status, "created_at": str(l.created_at) if l.created_at else None} for l in logs]


@router.get("/debug-lead/{email}")
def debug_lead_by_email(email: str, db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.email == email).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"id": lead.id, "email": lead.email, "first_name": lead.first_name, "last_name": lead.last_name, "company": lead.company, "status": lead.status, "sf_lead_id": lead.sf_lead_id, "lead_source": lead.lead_source, "created_at": lead.created_at, "last_synced_at": lead.last_synced_at}
