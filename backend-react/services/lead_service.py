"""
Lead service — business logic for lead CRUD, serialization, and queries.
"""
import threading
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session, joinedload, selectinload, lazyload
from sqlalchemy import func, or_, select, union_all

from models import (
    Lead, User, Note, Task, CallLog, LeadStatusLog, DialerCall,
    SyncSettings, lead_assignments,
    TERMINAL_STATUSES, ACTIVE_STATUSES, COMPANY_RESOLVED_OUTCOMES,
    STATUS_ORDER, RESEARCH_FIELDS, log_status_change,
)

logger = logging.getLogger(__name__)

PER_PAGE_DEFAULT = 20
PER_PAGE_MAX = 100
ALL_STATUSES = ["Lead Assigned", "Research", "Calling", "Meeting Scheduled", "Disqualified"]


# ── Status Helpers ───────────────────────────────────────────────────────────

def is_backward_move(old_status, new_status):
    try:
        return STATUS_ORDER.index(new_status) < STATUS_ORDER.index(old_status)
    except ValueError:
        return False


# ── Settings Cache ───────────────────────────────────────────────────────────

_settings_cache = {"data": None, "ts": 0}

def get_cached_settings():
    import time
    now = time.time()
    if _settings_cache["data"] is None or now - _settings_cache["ts"] > 30:
        try:
            from database import SessionLocal
            with SessionLocal() as s:
                settings = s.query(SyncSettings).filter(SyncSettings.id == 1).first()
                if settings:
                    _settings_cache["data"] = {
                        "max_call_attempts": settings.max_call_attempts or 5,
                        "min_call_attempts_for_unreachable": settings.min_call_attempts_for_unreachable or 3,
                    }
                else:
                    _settings_cache["data"] = {"max_call_attempts": 5, "min_call_attempts_for_unreachable": 3}
        except Exception:
            _settings_cache["data"] = {"max_call_attempts": 5, "min_call_attempts_for_unreachable": 3}
        _settings_cache["ts"] = now
    return _settings_cache["data"]


# ── Company Resolution ──────────────────────────────────────────────────────

def get_company_resolution(db, lead):
    company = (lead.company or "").strip()
    if not company:
        return None
    company_lower = company.lower()
    siblings = db.query(Lead).filter(
        func.lower(func.trim(Lead.company)) == company_lower,
        Lead.id != lead.id,
    ).all()
    if not siblings:
        return None

    for sib in siblings:
        resolved_call = db.query(CallLog).filter(
            CallLog.lead_id == sib.id,
            CallLog.outcome.in_(COMPANY_RESOLVED_OUTCOMES),
        ).order_by(CallLog.called_at.desc()).first()
        if resolved_call:
            return {
                "resolved": True,
                "resolved_by": f"{sib.first_name or ''} {sib.last_name or ''}".strip(),
                "resolved_lead_id": sib.id,
                "resolved_outcome": resolved_call.outcome,
                "resolved_at": str(resolved_call.called_at) if resolved_call.called_at else None,
                "resolved_title": sib.title,
            }
        resolved_dialer = db.query(DialerCall).filter(
            DialerCall.lead_id == sib.id,
            DialerCall.outcome.in_(COMPANY_RESOLVED_OUTCOMES),
        ).order_by(DialerCall.created_at.desc()).first()
        if resolved_dialer:
            return {
                "resolved": True,
                "resolved_by": f"{sib.first_name or ''} {sib.last_name or ''}".strip(),
                "resolved_lead_id": sib.id,
                "resolved_outcome": resolved_dialer.outcome,
                "resolved_at": str(resolved_dialer.started_at or resolved_dialer.created_at) if (resolved_dialer.started_at or resolved_dialer.created_at) else None,
                "resolved_title": sib.title,
            }
        if sib.status == "Meeting Scheduled":
            return {
                "resolved": True,
                "resolved_by": f"{sib.first_name or ''} {sib.last_name or ''}".strip(),
                "resolved_lead_id": sib.id,
                "resolved_outcome": "Meeting Scheduled",
                "resolved_at": str(sib.status_changed_at) if sib.status_changed_at else None,
                "resolved_title": sib.title,
            }
    return None


def batch_company_resolutions(db, leads):
    company_lead_map = {}
    company_name_map = {}
    for lead in leads:
        company = (lead.company or "").strip()
        if not company:
            continue
        lower = company.lower()
        company_lead_map.setdefault(lower, []).append(lead.id)
        company_name_map[lower] = company

    if not company_lead_map:
        return {}

    all_companies = list(company_name_map.values())
    resolution_cache = {}

    # Check leads with Meeting Scheduled status
    resolved_leads = db.query(Lead).filter(
        func.lower(func.trim(Lead.company)).in_([c.lower() for c in all_companies]),
        Lead.status == "Meeting Scheduled",
    ).order_by(Lead.status_changed_at.desc()).all()

    for rl in resolved_leads:
        lower = (rl.company or "").strip().lower()
        if lower not in resolution_cache:
            resolution_cache[lower] = {
                "resolved": True,
                "resolved_by": f"{rl.first_name or ''} {rl.last_name or ''}".strip(),
                "resolved_lead_id": rl.id,
                "resolved_outcome": "Meeting Scheduled",
                "resolved_at": str(rl.status_changed_at) if rl.status_changed_at else None,
                "resolved_title": rl.title,
            }

    # Check CallLogs
    unresolved = [c for c in all_companies if c.lower() not in resolution_cache]
    if unresolved:
        resolved_calls = db.query(CallLog, Lead).join(
            Lead, CallLog.lead_id == Lead.id
        ).filter(
            func.lower(func.trim(Lead.company)).in_([c.lower() for c in unresolved]),
            CallLog.outcome.in_(COMPANY_RESOLVED_OUTCOMES),
        ).order_by(CallLog.called_at.desc()).all()
        for cl, rl in resolved_calls:
            lower = (rl.company or "").strip().lower()
            if lower not in resolution_cache:
                resolution_cache[lower] = {
                    "resolved": True,
                    "resolved_by": f"{rl.first_name or ''} {rl.last_name or ''}".strip(),
                    "resolved_lead_id": rl.id,
                    "resolved_outcome": cl.outcome,
                    "resolved_at": str(cl.called_at) if cl.called_at else None,
                    "resolved_title": rl.title,
                }

    # Check DialerCalls
    still_unresolved = [c for c in unresolved if c.lower() not in resolution_cache]
    if still_unresolved:
        resolved_dialer = db.query(DialerCall, Lead).join(
            Lead, DialerCall.lead_id == Lead.id
        ).filter(
            func.lower(func.trim(Lead.company)).in_([c.lower() for c in still_unresolved]),
            DialerCall.outcome.in_(COMPANY_RESOLVED_OUTCOMES),
        ).order_by(DialerCall.created_at.desc()).all()
        for dc, rl in resolved_dialer:
            lower = (rl.company or "").strip().lower()
            if lower not in resolution_cache:
                resolution_cache[lower] = {
                    "resolved": True,
                    "resolved_by": f"{rl.first_name or ''} {rl.last_name or ''}".strip(),
                    "resolved_lead_id": rl.id,
                    "resolved_outcome": dc.outcome,
                    "resolved_at": str(dc.started_at or dc.created_at) if (dc.started_at or dc.created_at) else None,
                    "resolved_title": rl.title,
                }

    result = {}
    for lead in leads:
        company = (lead.company or "").strip()
        result[lead.id] = resolution_cache.get(company.lower()) if company else None
    return result


# ── Batch Activity Prefetch ─────────────────────────────────────────────────

def batch_latest_activity(db, leads):
    lead_ids = [l.id for l in leads]
    if not lead_ids:
        return {}, {}

    latest_notes = {}
    notes_rows = db.query(Note).filter(Note.lead_id.in_(lead_ids)).order_by(Note.lead_id, Note.created_at.desc()).all()

    seen_note_leads = set()
    note_counts = {}
    for n in notes_rows:
        note_counts[n.lead_id] = note_counts.get(n.lead_id, 0) + 1
        if n.lead_id not in seen_note_leads:
            seen_note_leads.add(n.lead_id)
            safe_content = (n.content or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
            truncated = safe_content[:150] + ('…' if len(safe_content) > 150 else '')
            latest_notes[n.lead_id] = {
                "content": truncated,
                "author": n.author or 'SDR',
                "created_at": str(n.created_at) if n.created_at else None,
                "_count": 0,
            }
    for lid, note_data in latest_notes.items():
        note_data["_count"] = note_counts.get(lid, 0)

    latest_calls = {}
    call_rows = db.query(CallLog).filter(CallLog.lead_id.in_(lead_ids)).order_by(CallLog.lead_id, CallLog.called_at.desc()).all()

    seen_call_leads = set()
    call_counts = {}
    for cl in call_rows:
        call_counts[cl.lead_id] = call_counts.get(cl.lead_id, 0) + 1
        if cl.lead_id not in seen_call_leads:
            seen_call_leads.add(cl.lead_id)
            latest_calls[cl.lead_id] = {
                "outcome": cl.outcome,
                "called_at": cl.called_at,
                "_count": 0,
            }
    for lid, call_data in latest_calls.items():
        call_data["_count"] = call_counts.get(lid, 0)

    return latest_notes, latest_calls


# ── Serialization ────────────────────────────────────────────────────────────

def lead_to_summary(lead, prefetched_note=None, prefetched_call=None):
    """Lightweight dict for list/table views."""
    lead_pod_ids = list(set(u.pod_id for u in lead.assigned_users if u.pod_id)) if lead.assigned_users else []

    latest_note = None
    note_count = 0
    if prefetched_note:
        latest_note = {"content": prefetched_note["content"], "author": prefetched_note["author"], "created_at": prefetched_note["created_at"]}
        note_count = prefetched_note.get("_count", 0)
    elif hasattr(lead, 'notes') and lead.notes:
        note_count = len(lead.notes)
        n = lead.notes[0]
        safe_content = (n.content or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
        truncated = safe_content[:150] + ('…' if len(safe_content) > 150 else '')
        latest_note = {"content": truncated, "author": n.author or 'SDR', "created_at": str(n.created_at) if n.created_at else None}

    last_call_outcome = None
    last_call_at = None
    if prefetched_call:
        last_call_outcome = prefetched_call["outcome"]
        last_call_at = prefetched_call["called_at"]
    elif hasattr(lead, 'call_logs') and lead.call_logs:
        cl = lead.call_logs[0]
        if cl.outcome:
            last_call_outcome = cl.outcome
            last_call_at = cl.called_at

    if hasattr(lead, 'dialer_calls') and lead.dialer_calls:
        dc = max(lead.dialer_calls, key=lambda d: d.created_at or datetime.min.replace(tzinfo=timezone.utc))
        dc_time = dc.started_at or dc.created_at
        if dc.outcome and (last_call_at is None or (dc_time and dc_time > last_call_at)):
            last_call_outcome = dc.outcome
            last_call_at = dc_time

    time_in_status = None
    time_in_status_hours = None
    if lead.status_changed_at:
        try:
            sca = lead.status_changed_at.replace(tzinfo=timezone.utc) if lead.status_changed_at.tzinfo is None else lead.status_changed_at
            delta = datetime.now(timezone.utc) - sca
            total_hours = delta.total_seconds() / 3600
            time_in_status_hours = round(total_hours, 1)
            if total_hours < 1:
                time_in_status = f"{int(delta.total_seconds() / 60)}m"
            elif total_hours < 24:
                time_in_status = f"{int(total_hours)}h"
            elif total_hours < 720:
                days = int(total_hours / 24)
                remaining_hrs = int(total_hours % 24)
                time_in_status = f"{days}d {remaining_hrs}h" if remaining_hrs else f"{days}d"
            else:
                time_in_status = f"{int(total_hours / 720)}mo"
        except Exception:
            pass

    last_activity = None
    activity_candidates = []
    if latest_note:
        activity_candidates.append({"type": "note", "summary": latest_note["content"], "timestamp": latest_note["created_at"], "author": latest_note["author"]})
    if last_call_at:
        outcome_str = last_call_outcome.value if hasattr(last_call_outcome, 'value') else (last_call_outcome or 'Called')
        activity_candidates.append({"type": "call", "summary": f"Call — {outcome_str}", "timestamp": str(last_call_at) if last_call_at else None, "author": None})
    if lead.status_changed_at:
        activity_candidates.append({"type": "status_change", "summary": f"Status → {lead.status}", "timestamp": str(lead.status_changed_at), "author": None})
    if activity_candidates:
        last_activity = max(activity_candidates, key=lambda a: a["timestamp"] or "")

    return {
        "id": lead.id,
        "first_name": lead.first_name,
        "last_name": lead.last_name,
        "email": lead.email,
        "phone": lead.phone,
        "phone_secondary": lead.phone_secondary,
        "company": lead.company,
        "title": lead.title,
        "status": lead.status,
        "lead_source": lead.lead_source or "salesforce",
        "call_count": (prefetched_call.get("_count", 0) if prefetched_call else (len(lead.call_logs) if hasattr(lead, 'call_logs') and lead.call_logs else 0)),
        "call_attempt_count": lead.call_attempt_count or 0,
        "assigned_to": [{"id": u.id, "name": u.name} for u in lead.assigned_users] if lead.assigned_users else [],
        "assigned_to_name": ", ".join(u.name for u in lead.assigned_users if u.name) if lead.assigned_users else None,
        "lead_pod_ids": lead_pod_ids,
        "last_synced_at": str(lead.last_synced_at) if lead.last_synced_at else None,
        "status_changed_at": str(lead.status_changed_at) if lead.status_changed_at else None,
        "created_at": str(lead.created_at) if lead.created_at else None,
        "closed_reason": lead.closed_reason,
        "no_show_count": lead.no_show_count or 0,
        "last_call_outcome": last_call_outcome,
        "last_call_at": str(last_call_at) if last_call_at else None,
        "time_in_status": time_in_status,
        "time_in_status_hours": time_in_status_hours,
        "last_activity": last_activity,
        "priority_score": lead.priority_score if hasattr(lead, 'priority_score') and lead.priority_score is not None else 100,
        "opportunity_status": lead.opportunity_status,
        "opportunity_notes": lead.opportunity_notes,
        "opportunity_updated_at": str(lead.opportunity_updated_at) if lead.opportunity_updated_at else None,
        "opportunity_updated_by": lead.opportunity_updated_by,
        "latest_note": latest_note,
        "note_count": note_count,
    }


def lead_to_dict(lead):
    """Full dict for detail view."""
    settings_info = get_cached_settings()
    current_attempts = lead.call_attempt_count or 0
    max_attempts = settings_info.get("max_call_attempts", 5)

    return {
        "id": lead.id,
        "sf_lead_id": lead.sf_lead_id,
        "first_name": lead.first_name,
        "last_name": lead.last_name,
        "email": lead.email,
        "phone": lead.phone,
        "phone_secondary": lead.phone_secondary,
        "company": lead.company,
        "title": lead.title,
        "status": lead.status,
        "lead_source": lead.lead_source or "salesforce",
        "last_synced_at": str(lead.last_synced_at) if lead.last_synced_at else None,
        "created_at": str(lead.created_at) if lead.created_at else None,
        "assigned_to": [{"id": u.id, "name": u.name, "email": u.email, "pod_id": u.pod_id} for u in lead.assigned_users],
        "lead_pod_ids": list(set(u.pod_id for u in lead.assigned_users if u.pod_id)),
        "call_count": len(lead.call_logs),
        "last_call_outcome": lead.call_logs[0].outcome if lead.call_logs else None,
        "status_changed_at": str(lead.status_changed_at) if lead.status_changed_at else None,
        "call_attempt_count": current_attempts,
        "max_call_attempts": max_attempts,
        "max_attempts_reached": current_attempts >= max_attempts,
        "min_call_attempts_for_unreachable": settings_info.get("min_call_attempts_for_unreachable", 3),
        "lead_started_at": str(lead.lead_started_at) if lead.lead_started_at else None,
        "lead_closed_at": str(lead.lead_closed_at) if lead.lead_closed_at else None,
        "closed_reason": lead.closed_reason,
        "no_show_count": lead.no_show_count or 0,
        "last_call_timestamp": str(lead.last_call_timestamp) if lead.last_call_timestamp else None,
        "linkedin_url": lead.linkedin_url,
        "person_linkedin": lead.person_linkedin,
        "website": lead.website,
        "city": lead.city,
        "state": lead.state,
        "country": lead.country,
        "industry": lead.industry,
        "employee_count": lead.employee_count,
        "annual_revenue": lead.annual_revenue,
        "total_funding": lead.total_funding,
        "company_phone": lead.company_phone,
        "company_linkedin": lead.company_linkedin,
        "company_street": lead.company_street,
        "company_city": lead.company_city,
        "company_postal_code": lead.company_postal_code,
        "company_state": lead.company_state,
        "company_country": lead.company_country,
        "company_founded": lead.company_founded,
        "research_company": lead.research_company,
        "research_contact": lead.research_contact,
        "research_hypothesis": lead.research_hypothesis,
        "research_personalization": lead.research_personalization,
        "research_industry": lead.research_industry,
        "research_company_size": lead.research_company_size,
        "research_services": lead.research_services,
        "research_geo": lead.research_geo,
        "research_timezone": lead.research_timezone,
        "research_hook": lead.research_hook,
        "research_channels": lead.research_channels,
        "opportunity_status": lead.opportunity_status,
        "opportunity_notes": lead.opportunity_notes,
        "opportunity_updated_at": str(lead.opportunity_updated_at) if lead.opportunity_updated_at else None,
        "opportunity_updated_by": lead.opportunity_updated_by,
        "dialer_calls": [
            {
                "id": c.id, "provider": c.provider, "status": c.status, "direction": c.direction,
                "duration": c.duration, "recording_url": c.recording_url, "outcome": c.outcome,
                "notes": c.notes,
                "created_at": str(c.created_at) if c.created_at else None,
                "started_at": str(c.started_at) if c.started_at else None,
            } for c in lead.dialer_calls
        ] if hasattr(lead, 'dialer_calls') else [],
        "call_logs": [
            {
                "id": c.id,
                "outcome": c.outcome.value if hasattr(c.outcome, 'value') else c.outcome,
                "notes": c.notes, "user_id": c.user_id,
                "user_name": c.user.name if c.user else "Unknown",
                "called_at": str(c.called_at) if c.called_at else None,
                "timestamp": str(c.called_at) if c.called_at else None,
            } for c in lead.call_logs
        ] if hasattr(lead, 'call_logs') else [],
        "assigned_to_name": lead.assigned_users[0].name if lead.assigned_users else None,
        "last_activity_at": str(lead.updated_at) if hasattr(lead, 'updated_at') and lead.updated_at else None,
        "updated_at": str(lead.updated_at) if hasattr(lead, 'updated_at') and lead.updated_at else None,
    }


# ── Query Builders ───────────────────────────────────────────────────────────

def build_lead_query(db, user):
    """Build a base query scoped by user role."""
    role = user.get("role")
    if role in ("Super Admin", "Admin"):
        return db.query(Lead)
    elif role == "Pod Admin":
        return db.query(Lead)
    else:
        db_user = db.query(User).filter(User.id == user["sub"]).first()
        if not db_user:
            return db.query(Lead).filter(Lead.id == None)
        assigned_ids = [l.id for l in db_user.assigned_leads]
        return db.query(Lead).filter(Lead.id.in_(assigned_ids)) if assigned_ids else db.query(Lead).filter(Lead.id == None)


def can_modify_lead(db, user, lead_id):
    """Check if user is allowed to modify this lead. Returns lead or raises."""
    from fastapi import HTTPException
    role = user.get("role")
    lead = db.query(Lead).options(joinedload(Lead.assigned_users)).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if role in ("Super Admin", "Admin"):
        return lead
    if role == "Pod Admin":
        if not lead.assigned_users:
            return lead
        user_pod_id = user.get("pod_id")
        if user_pod_id:
            for u in lead.assigned_users:
                if u.pod_id == user_pod_id:
                    return lead
        raise HTTPException(status_code=403, detail="You can only modify leads assigned to your POD.")

    user_id = user.get("sub")
    if any(u.id == user_id for u in lead.assigned_users):
        return lead
    raise HTTPException(status_code=403, detail="You can only modify your assigned leads.")


def apply_filters(query, search=None, status=None, source=None, date_from=None, date_to=None, company=None, outcome=None):
    """Apply optional filters to a lead query."""
    if status:
        query = query.filter(Lead.status == status)
    if source:
        if source == "uploaded":
            query = query.filter((Lead.lead_source == "uploaded") | (Lead.lead_source.like("upload:%")))
        elif source == "gsheet":
            query = query.filter(Lead.lead_source.like("gsheet:%"))
        else:
            query = query.filter(Lead.lead_source == source)
    if company:
        if company == "__none__":
            query = query.filter((Lead.company == None) | (Lead.company == ""))
        else:
            query = query.filter(Lead.company.ilike(company))
    if date_from:
        try:
            dt = datetime.fromisoformat(date_from)
            query = query.filter(Lead.created_at >= dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            dt = dt.replace(hour=23, minute=59, second=59)
            query = query.filter(Lead.created_at <= dt)
        except ValueError:
            pass
    if search:
        search_term = f"%{search}%"
        query = query.filter(or_(
            Lead.first_name.ilike(search_term),
            Lead.last_name.ilike(search_term),
            Lead.email.ilike(search_term),
            Lead.company.ilike(search_term),
            Lead.phone.ilike(search_term),
        ))
    if outcome:
        from sqlalchemy import func as sa_func
        cl_sub = select(CallLog.lead_id.label("lead_id"), CallLog.outcome.label("outcome"), CallLog.called_at.label("ts")).where(CallLog.lead_id != None)
        dc_sub = select(DialerCall.lead_id.label("lead_id"), DialerCall.outcome.label("outcome"), sa_func.coalesce(DialerCall.started_at, DialerCall.created_at).label("ts")).where(DialerCall.lead_id != None)
        all_calls = union_all(cl_sub, dc_sub).subquery("all_calls")
        ranked = select(
            all_calls.c.lead_id, all_calls.c.outcome,
            sa_func.row_number().over(partition_by=all_calls.c.lead_id, order_by=all_calls.c.ts.desc()).label("rn"),
        ).subquery("ranked_calls")
        matching_lead_ids = select(ranked.c.lead_id).where(ranked.c.rn == 1).where(ranked.c.outcome == outcome)
        query = query.filter(Lead.id.in_(matching_lead_ids))
    return query
