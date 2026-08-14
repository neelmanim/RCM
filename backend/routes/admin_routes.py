# ── routes/admin_routes.py — Admin user mgmt, lead upload, sync, settings ──────
import os
import logging
import math

logger = logging.getLogger(__name__)
import uuid
import json
import csv
import io
import re
import threading
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

import models
import access_db
from database import get_db
from auth import (
    create_jwt, require_admin, require_super_admin
)
from salesforce import (
    get_sf_client, sync_leads_from_salesforce,
    get_record_types_from_salesforce,
    create_new_lead_in_salesforce,
    push_pending_leads_to_salesforce
)
from models import TERMINAL_STATUSES, ACTIVE_STATUSES
from routes.lead_helpers import _lead_to_dict, _lead_to_summary

router = APIRouter(prefix="/api/admin", tags=["Admin"])


# ── Helpers (shared functions moved to _admin_helpers.py) ────────────────────
# User mgmt routes → admin_user_routes.py
# Assignment routes → admin_assignment_routes.py
# Sync routes → admin_sync_routes.py
# Upload/GSheet/Log routes → admin_upload_routes.py

from routes._admin_helpers import _get_or_create_sync_settings

# ── Seed Test Data ───────────────────────────────────────────────────────────

@router.post("/seed-test-data")
def seed_test_data(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Create test pods, pod admins, and SDRs for testing. Super Admin only."""
    results = []

    def ensure_user(email, name, role, pod_id=None):
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            user = models.User(email=email, name=name, role=role, pod_id=pod_id)
            db.add(user)
            db.commit()
            db.refresh(user)
            access_db.add_allowed_user(db, email, name, role, admin.get("email", "admin"))
            results.append(f"✅ Created {role}: {name} ({email})")
        else:
            changed = False
            if user.role != role:
                user.role = role
                changed = True
            if pod_id and user.pod_id != pod_id:
                user.pod_id = pod_id
                changed = True
            if changed:
                db.commit()
                results.append(f"🔄 Updated {name}: role={role}, pod_id={pod_id}")
            else:
                results.append(f"⏭️ {role} '{name}' already exists")
        return user

    # Create pods
    pod_alpha = db.query(models.Pod).filter(models.Pod.name == "Alpha Team").first()
    if not pod_alpha:
        pod_alpha = models.Pod(name="Alpha Team")
        db.add(pod_alpha)
        db.commit()
        db.refresh(pod_alpha)
        results.append(f"✅ Created Pod: Alpha Team")
    else:
        results.append("⏭️ Pod 'Alpha Team' exists")

    pod_beta = db.query(models.Pod).filter(models.Pod.name == "Beta Team").first()
    if not pod_beta:
        pod_beta = models.Pod(name="Beta Team")
        db.add(pod_beta)
        db.commit()
        db.refresh(pod_beta)
        results.append(f"✅ Created Pod: Beta Team")
    else:
        results.append("⏭️ Pod 'Beta Team' exists")

    # Pod Admins
    alpha_admin = ensure_user("alpha.admin@test.rcm.com", "Riya Sharma (Alpha Lead)", "Pod Admin", pod_alpha.id)
    pod_alpha.admin_id = alpha_admin.id
    db.commit()

    beta_admin = ensure_user("beta.admin@test.rcm.com", "Arjun Patel (Beta Lead)", "Pod Admin", pod_beta.id)
    pod_beta.admin_id = beta_admin.id
    db.commit()

    # SDRs for Alpha
    ensure_user("priya.alpha@test.rcm.com", "Priya Verma", "SDR", pod_alpha.id)
    ensure_user("rahul.alpha@test.rcm.com", "Rahul Singh", "SDR", pod_alpha.id)
    ensure_user("ananya.alpha@test.rcm.com", "Ananya Gupta", "SDR", pod_alpha.id)

    # SDRs for Beta
    ensure_user("karan.beta@test.rcm.com", "Karan Mehta", "SDR", pod_beta.id)
    ensure_user("sneha.beta@test.rcm.com", "Sneha Joshi", "SDR", pod_beta.id)
    ensure_user("dev.beta@test.rcm.com", "Dev Kapoor", "SDR", pod_beta.id)

    # ── Seed lead assignments + status history ──────────────────────────────
    from datetime import datetime, timezone, timedelta
    from models import log_status_change

    # Get SDRs and unassigned leads
    all_sdrs = db.query(models.User).filter(models.User.role == "SDR").all()
    assigned_ids = db.query(models.lead_assignments.c.lead_id).distinct()
    unassigned = db.query(models.Lead).filter(~models.Lead.id.in_(assigned_ids)).limit(15).all()

    # Assign up to 5 leads per SDR (round robin)
    if unassigned and all_sdrs:
        assigned_count = 0
        for i, lead in enumerate(unassigned):
            sdr = all_sdrs[i % len(all_sdrs)]
            active = len([l for l in sdr.assigned_leads if l.status != "Meeting Scheduled"])
            if active >= 5:
                continue
            if models.assign_lead(sdr, lead):
                assigned_count += 1
        db.commit()
        results.append(f"📌 Assigned {assigned_count} leads to {len(all_sdrs)} SDRs")

    # Seed status change history for first 10 leads (simulate pipeline movement)
    leads_for_history = db.query(models.Lead).limit(10).all()
    existing_logs = db.query(models.LeadStatusLog).count()
    if existing_logs == 0:
        now = datetime.now(timezone.utc)
        sdr_names = ["Priya Verma", "Rahul Singh", "Karan Mehta", "Sneha Joshi", "Demo SDR"]
        statuses = ["Lead Assigned", "Research", "Calling", "Meeting Scheduled"]
        for i, lead in enumerate(leads_for_history):
            # Create 2-3 status transitions per lead at different times
            transitions = min(statuses.index(lead.status) + 1 if lead.status in statuses else 1, 3)
            for t in range(transitions):
                from_s = statuses[t] if t > 0 else None
                to_s = statuses[t] if t == 0 else statuses[t]
                log_status_change(
                    db, lead.id,
                    from_s,
                    to_s,
                    sdr_names[i % len(sdr_names)]
                )
                # Set changed_at to staggered times in the past
                log = db.query(models.LeadStatusLog).filter(
                    models.LeadStatusLog.lead_id == lead.id
                ).order_by(models.LeadStatusLog.changed_at.desc()).first()
                if log:
                    log.changed_at = now - timedelta(hours=(transitions - t) * 2, minutes=i * 7)
        db.commit()
        results.append(f"📊 Created status history for {len(leads_for_history)} leads")
    else:
        results.append("⏭️ Status history already exists, skipping")

    return {
        "message": "Test data seeded successfully",
        "details": results,
        "pods": {
            "alpha": {"id": pod_alpha.id, "admin": alpha_admin.email},
            "beta":  {"id": pod_beta.id, "admin": beta_admin.email},
        }
    }


@router.get("/debug-lead/{email}")
def debug_lead_by_email(email: str, db: Session = Depends(get_db)):
    """Diagnostic tool to check a lead's raw state."""
    lead = db.query(models.Lead).filter(models.Lead.email == email).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    return {
        "id": lead.id,
        "email": lead.email,
        "first_name": lead.first_name,
        "last_name": lead.last_name,
        "company": lead.company,
        "status": lead.status,
        "sf_lead_id": lead.sf_lead_id,
        "lead_source": lead.lead_source,
        "created_at": lead.created_at,
        "last_synced_at": lead.last_synced_at,
        "status_changed_at": lead.status_changed_at,
    }


# ── Login Logs (Super Admin) ────────────────────────────────────────────────

@router.get("/login-logs")
def get_login_logs(
    page: int = 1,
    per_page: int = 20,
    search: str = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_super_admin)
):
    """Paginated login history with session duration. Super Admin only."""
    from sqlalchemy import or_
    query = db.query(models.LoginLog).order_by(models.LoginLog.login_at.desc())

    if search:
        term = f"%{search}%"
        query = query.filter(or_(
            models.LoginLog.email.ilike(term),
            models.LoginLog.name.ilike(term),
        ))

    total = query.count()
    logs = query.offset((page - 1) * per_page).limit(per_page).all()

    result = []
    for l in logs:
        duration = None
        if l.login_at and l.logout_at:
            delta = l.logout_at - l.login_at
            total_secs = int(delta.total_seconds())
            hours, remainder = divmod(total_secs, 3600)
            minutes, _ = divmod(remainder, 60)
            duration = f"{hours}h {minutes}m" if hours else f"{minutes}m"

        result.append({
            "id":          l.id,
            "user_id":     l.user_id,
            "email":       l.email,
            "name":        l.name,
            "role":        l.role,
            "ip_address":  l.ip_address,
            "user_agent":  l.user_agent,
            "login_at":    str(l.login_at) if l.login_at else None,
            "logout_at":   str(l.logout_at) if l.logout_at else None,
            "duration":    duration,
        })

    return {
        "data":     result,
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, (total + per_page - 1) // per_page),
    }


# ── Feedback ─────────────────────────────────────────────────────────────────

from auth import get_current_user as _get_current_user

@router.post("/feedback", dependencies=[])
def submit_feedback(body: dict, db: Session = Depends(get_db), user: dict = Depends(_get_current_user)):
    """Any authenticated user can submit feedback."""
    fb_type = body.get("type", "general")
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    if fb_type not in ("bug", "feature", "general"):
        fb_type = "general"

    entry = models.Feedback(
        user_id=user.get("sub"),
        user_email=user.get("email"),
        user_name=user.get("name"),
        type=fb_type,
        message=message,
    )
    db.add(entry)
    db.commit()
    return {"message": "Thank you for your feedback!", "id": entry.id}


@router.get("/feedback")
def list_feedback(
    page: int = 1,
    per_page: int = 20,
    status: str = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_super_admin)
):
    """List all feedback. Super Admin only."""
    query = db.query(models.Feedback).order_by(models.Feedback.created_at.desc())
    if status:
        query = query.filter(models.Feedback.status == status)
    total = query.count()
    items = query.offset((page - 1) * per_page).limit(per_page).all()

    return {
        "data": [{
            "id":         f.id,
            "user_email": f.user_email,
            "user_name":  f.user_name,
            "type":       f.type,
            "message":    f.message,
            "status":     f.status,
            "created_at": str(f.created_at) if f.created_at else None,
        } for f in items],
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, (total + per_page - 1) // per_page),
    }


@router.patch("/feedback/{feedback_id}")
def update_feedback_status(feedback_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Mark feedback as reviewed/resolved. Super Admin only."""
    fb = db.query(models.Feedback).filter(models.Feedback.id == feedback_id).first()
    if not fb:
        raise HTTPException(status_code=404, detail="Feedback not found")
    new_status = body.get("status")
    if new_status not in ("new", "reviewed", "resolved"):
        raise HTTPException(status_code=400, detail="Invalid status")
    fb.status = new_status
    db.commit()
    return {"message": f"Feedback marked as {new_status}"}


# ── Temporary one-time cleanup: fix duplicate names ───────────────────────────
@router.post("/cleanup-duplicate-names")
def cleanup_duplicate_names(db: Session = Depends(get_db), admin = Depends(require_super_admin)):
    """
    Fix leads where first_name contains the full name AND last_name duplicates it.
    E.g. first_name="Arthur Lao", last_name="Arthur Lao" → first_name="Arthur", last_name="Lao"
    Also handles: first_name="Cheryl Austein Casnoff", last_name="Cheryl Austein Casnoff"
    Super Admin only. Safe to run multiple times (idempotent).
    """
    # Find leads where first_name has a space AND last_name equals first_name
    leads = db.query(models.Lead).filter(
        models.Lead.first_name.isnot(None),
        models.Lead.last_name.isnot(None),
        models.Lead.first_name != "",
        models.Lead.last_name != "",
    ).all()

    fixed = []
    for lead in leads:
        fn = (lead.first_name or "").strip()
        ln = (lead.last_name or "").strip()

        if not fn or not ln:
            continue

        # Case 1: first_name == last_name (exact duplicate)
        if fn.lower() == ln.lower() and " " in fn:
            parts = fn.split(" ", 1)
            lead.first_name = parts[0]
            lead.last_name = parts[1] if len(parts) > 1 else ""
            fixed.append({"id": lead.id, "before": f"{fn} {ln}", "after": f"{lead.first_name} {lead.last_name}"})

        # Case 2: first_name contains a full name and last_name is same full name
        # (catches multi-word names like "Cheryl Austein Casnoff")
        elif fn.lower() == ln.lower():
            # Single word duplicated — just clear last_name
            lead.last_name = ""
            fixed.append({"id": lead.id, "before": f"{fn} {ln}", "after": f"{lead.first_name} {lead.last_name}"})

    if fixed:
        db.commit()

    return {
        "message": f"Fixed {len(fixed)} leads with duplicate names",
        "fixed_count": len(fixed),
        "examples": fixed[:20]
    }



# ── View As / Impersonate ────────────────────────────────────────────────────


@router.post("/impersonate/{user_id}")
def impersonate_user(user_id: str, admin: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    """Generate a short-lived JWT to view the app as another user.
    Only Super Admins can use this. Returns a token + the original admin token
    so the frontend can show a banner and switch back.
    """
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Don't allow impersonating yourself
    if target.id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="Cannot impersonate yourself")

    # Log the impersonation event
    from activity_logger import log_activity
    log_activity(admin["sub"], "IMPERSONATE", user_email=admin.get("email"),
                 user_name=admin.get("name"),
                 metadata={"target_user_id": target.id, "target_email": target.email})

    # Create a short-lived token (1 hour) for the target user with impersonation flag
    impersonate_token = create_jwt({
        "sub": target.id,
        "email": target.email,
        "name": target.name,
        "role": target.role,
        "pod_id": target.pod_id,
        "dialer_enabled": bool(getattr(target, 'dialer_enabled', False)),
        "email_sync_enabled": bool(getattr(target, 'email_sync_enabled', False)),
        "impersonated_by": admin.get("sub"),
        "impersonator_name": admin.get("name"),
    })

    return {
        "token": impersonate_token,
        "target_user": {
            "id": target.id,
            "name": target.name,
            "email": target.email,
            "role": target.role,
        }
    }


# ── Public API Key Management ────────────────────────────────────────────────

@router.get("/public-api-key/status")
def public_api_key_status(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_super_admin),
):
    """Check if a public API key is configured."""
    settings = _get_or_create_sync_settings(db)
    return {"configured": bool(settings.public_api_key)}


@router.post("/public-api-key/generate")
def generate_public_api_key(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_super_admin),
):
    """Generate a new public API key. Replaces any existing key."""
    import secrets
    from crypto import encrypt_token

    # Generate a cryptographically secure key
    raw_key = f"lsk_{secrets.token_urlsafe(32)}"

    # Encrypt and store
    settings = _get_or_create_sync_settings(db)
    settings.public_api_key = encrypt_token(raw_key)
    db.commit()

    return {"success": True, "api_key": raw_key}


@router.delete("/public-api-key")
def revoke_public_api_key(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_super_admin),
):
    """Revoke (delete) the public API key."""
    settings = _get_or_create_sync_settings(db)
    settings.public_api_key = None
    db.commit()

    return {"success": True, "message": "Public API key revoked."}


# ── Emergency Column Migration (Super Admin) ─────────────────────────────────

@router.post("/force-add-column")
def force_add_column(
    body: dict,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_super_admin),
):
    """Force-add a column via raw SQL, bypassing SQLAlchemy ORM/inspector.
    Use when the startup migration silently skips a column.
    Body: { "table": "leads", "column": "discovery_meeting_count", "type": "INTEGER DEFAULT 0" }
    Super Admin only.
    """
    from sqlalchemy import text
    import re
    table    = body.get("table", "").strip()
    column   = body.get("column", "").strip()
    col_type = body.get("type", "TEXT").strip()

    if not table or not column:
        raise HTTPException(status_code=400, detail="table and column are required")

    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table) or \
       not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', column):
        raise HTTPException(status_code=400, detail="Invalid table or column name")

    conn = db.connection()
    exists = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = :t AND column_name = :c"
    ), {"t": table, "c": column}).fetchone()

    if exists:
        return {"ok": True, "message": f"{table}.{column} already exists — no action taken"}

    try:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
        db.commit()
        return {"ok": True, "message": f"Added {table}.{column} ({col_type}) successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"ALTER TABLE failed: {str(e)}")


# ── ENH-03: Admin Call Logs ───────────────────────────────────────────────────

@router.get("/call-logs")
def list_call_logs(
    page:      int = 1,
    per_page:  int = 20,
    sdr_id:       str  = None,
    outcome:      str  = None,
    status:       str  = None,
    provider:     str  = None,
    direction:    str  = None,
    date_from:    str  = None,
    date_to:      str  = None,
    has_recording: bool = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """
    Paginated call log view for Admin / Super Admin.
    Includes stats summary and SDR list for the filter dropdown.
    """
    from sqlalchemy import or_, and_, case, func, exists
    from sqlalchemy.orm import aliased

    # ── Filter Building ──────────────────────────────────────────────────────
    # Use SQL EXISTS subquery instead of fetching all user IDs into Python.
    # This avoids 2 extra DB roundtrips and prevents the query planner receiving
    # a large literal IN (...) list that bypasses join-path optimisation.
    known_user_subq = db.query(models.User.id).subquery()
    filters = [models.DialerCall.user_id.in_(known_user_subq)]

    if admin.get("role") == "Pod Admin":
        pod_id = admin.get("pod_id")
        if pod_id:
            pod_user_subq = db.query(models.User.id).filter(
                models.User.pod_id == pod_id
            ).subquery()
            filters.append(models.DialerCall.user_id.in_(pod_user_subq))

    if sdr_id: filters.append(models.DialerCall.user_id == sdr_id)
    if outcome: filters.append(models.DialerCall.outcome == outcome)
    if provider: filters.append(models.DialerCall.provider.ilike(provider))
    if direction: filters.append(models.DialerCall.direction.ilike(direction))
    if status:
        _status_map = {
            "completed": ["CALL_ENDED", "CALL_ANSWERED", "completed"],
            "failed":    ["CALL_FAILED", "FAILED", "failed"],
            "missed":    ["CALL_MISSED", "no-answer", "missed"],
        }
        patterns = _status_map.get(status, [status])
        filters.append(or_(*[models.DialerCall.status.ilike(f"%{p}%") for p in patterns]))
    if date_from:
        filters.append(models.dialer_call_event_time() >= datetime.fromisoformat(date_from).replace(tzinfo=None))
    if date_to:
        filters.append(models.dialer_call_event_time() <= datetime.fromisoformat(date_to + "T23:59:59").replace(tzinfo=None))
    if has_recording is True:
        filters.append(and_(models.DialerCall.recording_url.isnot(None), models.DialerCall.recording_url != ""))
    elif has_recording is False:
        filters.append(or_(models.DialerCall.recording_url.is_(None), models.DialerCall.recording_url == ""))

    # ── Single aggregate query: total + stats in one pass ───────────────────
    # RCA 2026-08-06: the Call Monitor UI's "Connected" tile read `completed`
    # (status ILIKE '%ENDED%') as if it meant "answered" — CALL_ENDED just
    # means the call session terminated normally, true for both an answered
    # call and one that rang out with no pickup. On real prod data this
    # showed "97% Connected" when the real connect rate (outcome set OR
    # provider_disposition='ANSWERED' — same check analytics_routes.py's
    # Connect Rate already uses correctly) was 15.0%. `completed` is kept
    # as-is (it's also a legitimate `status` filter value below), `connected`
    # is the new, correct field the UI's Connected tile should read instead.
    # Also: the "missed" pattern matched '%no-answer%' (hyphenated) but the
    # real status value is NO_ANSWER (underscore) — those calls silently
    # never counted as completed, failed, OR missed.
    agg = (
        db.query(
            func.count(models.DialerCall.id).label("total"),
            func.sum(case((models.DialerCall.status.ilike("%ENDED%"), 1), else_=0)).label("completed"),
            func.sum(case((models.dialer_call_connected(list(models.ANSWERED_OUTCOMES)), 1), else_=0)).label("connected"),
            func.sum(case((models.DialerCall.status.ilike("%FAIL%"), 1), else_=0)).label("failed"),
            func.sum(case((or_(models.DialerCall.status.ilike("%MISS%"), models.DialerCall.status.ilike("%NO_ANSWER%")), 1), else_=0)).label("missed"),
            func.avg(models.DialerCall.duration).label("avg_duration"),
        )
        .filter(*filters)
        .one()
    )
    total = agg.total or 0

    rows = (
        db.query(models.DialerCall, models.User, models.Lead)
        .outerjoin(models.User, models.DialerCall.user_id == models.User.id)
        .outerjoin(models.Lead, models.DialerCall.lead_id == models.Lead.id)
        .filter(*filters)
        .order_by(models.dialer_call_event_time().desc())
        .offset((page - 1) * per_page).limit(per_page).all()
    )

    items = []
    for call, sdr, lead in rows:
        lead_name = None
        if lead:
            fn, ln = (lead.first_name or "").strip(), (lead.last_name or "").strip()
            lead_name = f"{fn} {ln}".strip() or lead.email or "Unknown"
        items.append({
            "id": call.id, "sdr_name": sdr.name if sdr else None, "user_email": sdr.email if sdr else None,
            "lead_name": lead_name, "lead_company": (lead.company or "") if lead else "",
            "phone_number": call.phone_number,
            "provider": call.provider, "provider_call_id": call.provider_call_id, "outcome": call.outcome,
            "status": call.status, "direction": call.direction, "duration": call.duration,
            "recording_url": call.recording_url, "transcript": call.transcript,
            "error_detail": call.notes if call.status and "FAIL" in call.status.upper() else None,
            "notes": call.notes if call.status and "FAIL" not in call.status.upper() else None,
            "created_at": str(call.created_at) if call.created_at else None,
            "started_at": str(call.started_at) if call.started_at else None,
            "answered_at": str(call.answered_at) if call.answered_at else None,
            "ended_at": str(call.ended_at) if call.ended_at else None,
            "lead_id": call.lead_id,
        })

    sdrs_q = (
        db.query(models.User)
        .filter(models.User.role.in_(["SDR", "Pod Admin", "Admin"]))
        .order_by(models.User.name)
    )
    if admin.get("role") == "Pod Admin":
        pod_id = admin.get("pod_id")
        if pod_id:
            sdrs_q = sdrs_q.filter(models.User.pod_id == pod_id)
    sdr_list = [{"id": u.id, "name": u.name, "email": u.email} for u in sdrs_q.all()]

    return {
        "items":    items,
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, math.ceil(total / per_page)),
        "sdrs":     sdr_list,
        "summary": {
            "completed":    int(agg.completed   or 0),
            "connected":    int(agg.connected   or 0),   # ← actually answered; see RCA above
            "failed":       int(agg.failed      or 0),
            "missed":       int(agg.missed      or 0),
            "avg_duration": int(agg.avg_duration) if agg.avg_duration else None,
        },
    }


# ── Research v2: Bulk Research Job (B6) ──────────────────────────────────────

# Module-level imports so test mocks can patch them correctly
from routes.ai_research_routes import (
    _build_prompt_v2, _call_groq_sync, _sanitize_research_v2,
    _normalise_company_key, _update_company_cache,
)

# In-memory flag to prevent duplicate concurrent jobs (EC-18)
_bulk_research_running = False
_bulk_research_stats   = {"processed": 0, "skipped": 0, "failed": 0, "total": 0, "started_at": None}


@router.get("/bulk-research/status")
async def get_bulk_research_status(
    admin: dict = Depends(require_super_admin),
):
    """Check bulk research job status without triggering a new one."""
    return {
        "running":    _bulk_research_running,
        "stats":      _bulk_research_stats,
    }


@router.post("/bulk-research")
async def trigger_bulk_research(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_super_admin),
    pod_id: str = None,
):
    """Trigger bulk research job for all unresearched / v1 leads.

    Runs as a background thread — responds immediately with 202.

    pod_id (optional): if supplied, only processes leads in that pod.
                       Use this for phased upgrades (US Team first, India Team second).

    EC-18: Returns 409 if a job is already running.
    BR-2:  Super Admin only (enforced via require_super_admin).
    BR-11: Only processes active pipeline statuses (not Disqualified/terminal).
    Skip logic: skips leads that already have research_heat (= already v2).
                v1 leads (research_company filled but research_heat NULL) ARE processed.
    """
    global _bulk_research_running

    if _bulk_research_running:
        raise HTTPException(
            status_code=409,
            detail="A bulk research job is already running. Check error logs for progress."
        )

    ACTIVE_STATUSES_LIST = ["Lead Assigned", "Research", "Calling", "Meeting Scheduled",
                            "1st Discovery Meeting", "Discovery Complete", "Demo Scheduled"]

    base_q = db.query(models.Lead).filter(models.Lead.status.in_(ACTIVE_STATUSES_LIST))
    if pod_id:
        base_q = base_q.filter(models.Lead.pod_id == pod_id)

    total_leads = base_q.count()

    # A lead is "already v2" if research_heat is filled (the new v2 sentinel field)
    already_v2 = base_q.filter(
        models.Lead.research_heat.isnot(None),
        models.Lead.research_heat != "",
    ).count()

    will_process = total_leads - already_v2

    # Get LLM config BEFORE spawning thread (db session not safe to share across threads)
    settings = _get_or_create_sync_settings(db)
    llm_config = {
        "api_key": (getattr(settings, "llm_api_key", None) or "").strip() or os.environ.get("GROQ_API_KEY", ""),
        "model":   getattr(settings, "llm_model", None) or "gemma2-9b-it",
        "research_prompt": getattr(settings, "research_prompt", None),
        "pod_id": pod_id,  # pass through to background thread
    }

    if not llm_config["api_key"]:
        raise HTTPException(
            status_code=400,
            detail="AI API key not configured. Go to Settings → AI Settings to add your Groq API key first."
        )

    import threading
    thread = threading.Thread(
        target=_run_bulk_research_background,
        args=(llm_config,),
        daemon=True,
    )
    thread.start()

    pod_label = f"pod {pod_id}" if pod_id else "all pods"
    logger.info(
        f"Bulk research job started by {admin.get('email')} ({pod_label}) — "
        f"total={total_leads}, already_v2={already_v2}, will_process={will_process}"
    )

    return {
        "message":      f"Bulk research job started ({pod_label}).",
        "total_leads":  total_leads,
        "already_v2":   already_v2,
        "will_process": will_process,
        "pod_id":       pod_id,
    }


def _run_bulk_research_background(llm_config: dict):
    """Background thread: runs bulk research for all unresearched active leads.

    Uses its own DB session (thread-safe).
    Uses _call_groq_sync (threading.Lock + time.monotonic) — NOT the async
    _call_groq_single which uses asyncio.Lock + event-loop monotonic time.
    The async version caused an 8s sleep before every call because
    asyncio.new_event_loop().time() starts at ~0, same as _groq_last_call_time.

    BR-4:  Skips leads that already have research_heat (v2 sentinel)
    BR-6:  Exponential backoff on 429 (handled inside _call_groq_sync)
    BR-8:  Per-lead try/except — one failure never kills the whole batch
    BR-9:  Resumable — re-running safely skips already-researched leads
    BR-10: Progress logged every 100 leads
    BR-12: Batch of 20 leads with 2-second sleep between batches (~30 req/min)
    """
    global _bulk_research_running, _bulk_research_stats
    import time
    from database import SessionLocal

    _bulk_research_running = True
    _bulk_research_stats   = {"processed": 0, "skipped": 0, "failed": 0, "total": 0, "started_at": None}
    db = None

    try:
        import datetime
        _bulk_research_stats["started_at"] = datetime.datetime.utcnow().isoformat()
        logger.info("Bulk research background thread started — opening DB session")
        db = SessionLocal()
        ACTIVE_STATUSES_LIST = [
            "Lead Assigned", "Research", "Calling", "Meeting Scheduled",
            "1st Discovery Meeting", "Discovery Complete", "Demo Scheduled"
        ]

        q = db.query(models.Lead.id).filter(models.Lead.status.in_(ACTIVE_STATUSES_LIST))
        pod_id = llm_config.get("pod_id")
        if pod_id:
            q = q.filter(models.Lead.pod_id == pod_id)

        # Fetch IDs only — avoids loading 11k ORM objects into RAM at once
        lead_ids = [row[0] for row in q.all()]
        _bulk_research_stats["total"] = len(lead_ids)
        logger.info(f"Bulk research: {len(lead_ids)} candidate leads found, starting processing")

        processed = skipped = failed = 0
        BATCH_SIZE = 20
        CHUNK_SIZE = 100  # fetch leads in chunks to avoid RAM spike

        for chunk_start in range(0, len(lead_ids), CHUNK_SIZE):
            chunk_ids = lead_ids[chunk_start:chunk_start + CHUNK_SIZE]
            leads_chunk = db.query(models.Lead).filter(models.Lead.id.in_(chunk_ids)).all()

            for i_in_chunk, lead in enumerate(leads_chunk):
                i = chunk_start + i_in_chunk  # global index

                # Skip only if already upgraded to v2 (research_heat filled)
                if getattr(lead, "research_heat", None) and lead.research_heat.strip():
                    skipped += 1
                    _bulk_research_stats["skipped"] = skipped
                    continue

                # BR-10: progress log every 100 leads processed
                if processed > 0 and processed % 100 == 0:
                    logger.info(
                        f"Bulk research progress: {processed} processed, "
                        f"{skipped} skipped, {failed} failed / {len(lead_ids)} total"
                    )

                # BR-8: per-lead try/except
                try:
                    prompt     = _build_prompt_v2(lead, custom_prompt=llm_config.get("research_prompt"))
                    result_raw = _call_groq_sync(prompt, llm_config["api_key"], llm_config["model"])
                    result     = _sanitize_research_v2(result_raw)

                    for field in [
                        "research_company", "research_contact", "research_hypothesis",
                        "research_personalization", "research_hook",
                        "research_heat", "research_opening",
                    ]:
                        val = result.get(field)
                        if val is not None:
                            setattr(lead, field, val)
                    db.commit()

                    company_key = _normalise_company_key(lead.company or "")
                    if company_key:
                        _update_company_cache(db, company_key, result, result_raw)

                    processed += 1
                    _bulk_research_stats["processed"] = processed

                except Exception as e:
                    err_str = str(e)
                    logger.error(f"Bulk research failed for lead {lead.id} ({lead.company}): {err_str}")
                    failed += 1
                    _bulk_research_stats["failed"] = failed

                # BR-12: batch sleep every BATCH_SIZE leads
                if (i + 1) % BATCH_SIZE == 0:
                    time.sleep(2)

        logger.info(
            f"Bulk research COMPLETE — "
            f"processed={processed}, skipped={skipped}, failed={failed}, total={len(lead_ids)}"
        )

    except Exception as e:
        logger.error(f"Bulk research background job crashed: {e}")
    finally:
        _bulk_research_running = False
        if db:
            db.close()

# ── One-time backfill: set lead_closed_at for meeting-reached leads ──────────
@router.post("/backfill-meeting-closed-at")
def backfill_meeting_closed_at(
    admin: dict = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Idempotent: sets lead_closed_at = status_changed_at for meetings missing it."""
    MEETING_STATUSES = ["Meeting Scheduled", "Demo Scheduled", "Demo Done", "Completed"]
    result = db.execute(
        models.Lead.__table__.update()
        .where(models.Lead.status.in_(MEETING_STATUSES))
        .where(models.Lead.lead_closed_at == None)
        .values(lead_closed_at=models.Lead.status_changed_at)
    )
    db.commit()
    return {"updated": result.rowcount, "note": "lead_closed_at backfilled from status_changed_at"}
