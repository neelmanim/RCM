# ── routes/lead_helpers.py — Shared lead utilities ─────────────────────────────
"""
Lead Helpers
============
Pure-logic helpers shared by lead_routes, call_routes, admin_routes, search_routes.
No FastAPI router — just functions.
"""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload, load_only
from sqlalchemy import func, or_, select, union_all

import models
from models import COMPANY_RESOLVED_OUTCOMES
from database import get_db
import logging

logger = logging.getLogger(__name__)

# ── Columns needed for list/table views (_lead_to_summary) ───────────────────
# Using load_only() with these columns prevents SQLAlchemy from loading large
# text fields (research_*, enrichment) that are never displayed in list views.
# Reduces memory per lead from ~4KB to ~1.5KB.
SUMMARY_COLUMNS = load_only(
    models.Lead.id, models.Lead.first_name, models.Lead.last_name,
    models.Lead.email, models.Lead.phone, models.Lead.phone_secondary,
    models.Lead.company, models.Lead.title, models.Lead.status,
    models.Lead.lead_source, models.Lead.company_phone, models.Lead.pod_id,
    models.Lead.upload_log_id,
    models.Lead.last_synced_at, models.Lead.status_changed_at,
    models.Lead.created_at, models.Lead.closed_reason, models.Lead.no_show_count,
    models.Lead.call_attempt_count, models.Lead.priority_score,
    models.Lead.opportunity_status, models.Lead.opportunity_notes,
    models.Lead.opportunity_updated_at, models.Lead.opportunity_updated_by,
    # RCA 2026-08-10: added to _lead_to_summary's output for Power Dialer's
    # DNC pre-filter but never added here — load_only() means any column
    # outside this list deferred-loads with its own SELECT per lead, so
    # every row in every page paid for 2 extra queries just to check these.
    models.Lead.do_not_contact, models.Lead.unsubscribed_at,
    # Power Dialer's lead-context strip (2026-08-10) — same N+1 trap as
    # above if these are read in _lead_to_summary without being loaded here.
    models.Lead.city, models.Lead.state, models.Lead.country,
    models.Lead.employee_count, models.Lead.research_company_size,
)

STATUS_ORDER = [
    "Lead Assigned", "Research", "Calling", "Meeting Scheduled",
    "1st Discovery Meeting", "Discovery Complete",
    "Demo Scheduled", "Demo Done", "Completed",
]

def _is_backward_move(old_status, new_status):
    """Return True if new_status is earlier in the pipeline than old_status."""
    try:
        return STATUS_ORDER.index(new_status) < STATUS_ORDER.index(old_status)
    except ValueError:
        return False  # Unknown statuses (terminal/legacy) — don't block


# ── Company Resolution ──────────────────────────────────────────────────────

def _get_company_resolution(db, lead):
    """Check if another lead at the same company has a successful meeting outcome.
    Returns resolver info dict or None.
    Checks: call_logs, dialer_calls (outcomes), and lead.status as fallback."""
    company = (lead.company or "").strip()
    if not company:
        return None

    company_lower = company.lower()

    # Find other leads at the same company (case-insensitive, trimmed)
    siblings = db.query(models.Lead).filter(
        func.lower(func.trim(models.Lead.company)) == company_lower,
        models.Lead.id != lead.id,
    ).all()

    if not siblings:
        return None

    for sib in siblings:
        # Check 1: call_logs with meeting outcome
        resolved_call = db.query(models.CallLog).filter(
            models.CallLog.lead_id == sib.id,
            models.CallLog.outcome.in_(COMPANY_RESOLVED_OUTCOMES),
        ).order_by(models.CallLog.called_at.desc()).first()

        if resolved_call:
            return {
                "resolved": True,
                "resolved_by": f"{sib.first_name or ''} {sib.last_name or ''}".strip(),
                "resolved_lead_id": sib.id,
                "resolved_outcome": resolved_call.outcome,
                "resolved_at": str(resolved_call.called_at) if resolved_call.called_at else None,
                "resolved_title": sib.title,
            }

        # Check 2: dialer_calls with meeting outcome
        resolved_dialer = db.query(models.DialerCall).filter(
            models.DialerCall.lead_id == sib.id,
            models.DialerCall.outcome.in_(COMPANY_RESOLVED_OUTCOMES),
        ).order_by(models.dialer_call_event_time().desc()).first()

        if resolved_dialer:
            return {
                "resolved": True,
                "resolved_by": f"{sib.first_name or ''} {sib.last_name or ''}".strip(),
                "resolved_lead_id": sib.id,
                "resolved_outcome": resolved_dialer.outcome,
                "resolved_at": str(resolved_dialer.started_at or resolved_dialer.created_at) if (resolved_dialer.started_at or resolved_dialer.created_at) else None,
                "resolved_title": sib.title,
            }

        # Check 3: lead status = Meeting Scheduled (manually set, no call log)
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


def _batch_company_resolutions(db, leads):
    """Compute company resolution for a batch of leads using 2 fast queries max.

    Strategy (priority order, stops as soon as all companies are resolved):
      Q1: leads WHERE LOWER(TRIM(company)) IN (...) AND status='Meeting Scheduled'
          -> Uses idx_leads_company_lower. Most pages resolve here (1 query).
      Q2: call_logs + dialer_calls JOIN leads — only for still-unresolved companies.

    The previous UNION-with-6-subqueries approach was still ~1,400ms because the
    nested WHERE (company_lower, priority) IN (SELECT ...) couldn't use indexes well.
    This version is 2 simple parameterised queries at most.
    Returns: dict of lead_id -> resolution_info or None.
    """
    from sqlalchemy import text as sa_text

    companies = list({
        (lead.company or "").strip().lower()
        for lead in leads
        if (lead.company or "").strip()
    })
    if not companies:
        return {lead.id: None for lead in leads}

    is_postgres = "postgresql" in str(db.bind.dialect.name) if db.bind else False

    resolution_cache = {}  # lower_company -> resolution_info

    if is_postgres:
        placeholders = ", ".join(f":c{i}" for i in range(len(companies)))
        params = {f"c{i}": c for i, c in enumerate(companies)}

        # ── Q1: Leads with Meeting Scheduled (fastest path, uses idx_leads_company_lower) ──
        q1 = sa_text(f"""
            SELECT DISTINCT ON (LOWER(TRIM(company)))
                LOWER(TRIM(company))                      AS company_lower,
                TRIM(first_name || ' ' || last_name)      AS resolved_by,
                id                                         AS resolved_lead_id,
                'Meeting Scheduled'                        AS resolved_outcome,
                status_changed_at                          AS resolved_at,
                title                                      AS resolved_title
            FROM leads
            WHERE LOWER(TRIM(company)) IN ({placeholders})
              AND status = 'Meeting Scheduled'
            ORDER BY LOWER(TRIM(company)), status_changed_at DESC NULLS LAST
        """)
        try:
            for row in db.execute(q1, params).fetchall():
                resolution_cache[row[0]] = {
                    "resolved": True,
                    "resolved_by": row[1] or "",
                    "resolved_lead_id": row[2],
                    "resolved_outcome": row[3],
                    "resolved_at": str(row[4]) if row[4] else None,
                    "resolved_title": row[5],
                }
        except Exception:
            pass

        # ── Q2: Only for still-unresolved companies ──
        unresolved = [c for c in companies if c not in resolution_cache]
        if unresolved:
            ph2 = ", ".join(f":u{i}" for i in range(len(unresolved)))
            p2  = {f"u{i}": c for i, c in enumerate(unresolved)}
            q2  = sa_text(f"""
                SELECT company_lower, resolved_by, resolved_lead_id,
                       resolved_outcome, resolved_at, resolved_title
                FROM (
                    SELECT
                        LOWER(TRIM(l.company))                   AS company_lower,
                        TRIM(l.first_name || ' ' || l.last_name) AS resolved_by,
                        l.id                                      AS resolved_lead_id,
                        cl.outcome                                AS resolved_outcome,
                        cl.called_at                              AS resolved_at,
                        l.title                                   AS resolved_title,
                        ROW_NUMBER() OVER (
                            PARTITION BY LOWER(TRIM(l.company))
                            ORDER BY cl.called_at DESC NULLS LAST
                        ) AS rn
                    FROM call_logs cl
                    JOIN leads l ON l.id = cl.lead_id
                    WHERE LOWER(TRIM(l.company)) IN ({ph2})
                      AND cl.outcome IN ('Meeting Scheduled','Interested','Callback Requested','demo_scheduled')
                    UNION ALL
                    SELECT
                        LOWER(TRIM(l.company)),
                        TRIM(l.first_name || ' ' || l.last_name),
                        l.id,
                        dc.outcome,
                        COALESCE(dc.started_at, dc.created_at),
                        l.title,
                        ROW_NUMBER() OVER (
                            PARTITION BY LOWER(TRIM(l.company))
                            ORDER BY COALESCE(dc.started_at, dc.created_at) DESC NULLS LAST
                        )
                    FROM dialer_calls dc
                    JOIN leads l ON l.id = dc.lead_id
                    WHERE LOWER(TRIM(l.company)) IN ({ph2})
                      AND dc.outcome IN ('Meeting Scheduled','Interested','Callback Requested','demo_scheduled')
                ) sub WHERE rn = 1
            """)
            try:
                for row in db.execute(q2, p2).fetchall():
                    c = row[0]
                    if c not in resolution_cache:
                        resolution_cache[c] = {
                            "resolved": True,
                            "resolved_by": row[1] or "",
                            "resolved_lead_id": row[2],
                            "resolved_outcome": row[3],
                            "resolved_at": str(row[4]) if row[4] else None,
                            "resolved_title": row[5],
                        }
            except Exception:
                pass
    else:
        # SQLite fallback (tests): simple per-company ORM queries (test data is tiny)
        for company_lower in companies:
            rl = db.query(models.Lead).filter(
                func.lower(func.trim(models.Lead.company)) == company_lower,
                models.Lead.status == "Meeting Scheduled",
            ).first()
            if rl:
                resolution_cache[company_lower] = {
                    "resolved": True,
                    "resolved_by": f"{rl.first_name or ''} {rl.last_name or ''}".strip(),
                    "resolved_lead_id": rl.id,
                    "resolved_outcome": "Meeting Scheduled",
                    "resolved_at": str(rl.status_changed_at) if rl.status_changed_at else None,
                    "resolved_title": rl.title,
                }

    # Map back to lead IDs — a lead is never "connected via" itself. Q1/Q2
    # resolve per-company (not per-lead), so a company with a sole lead whose
    # own status is already "Meeting Scheduled" would otherwise attach that
    # lead's own resolution info to its own row, reading as if a DIFFERENT
    # lead/channel already booked the meeting. _get_company_resolution above
    # (the per-lead, non-batched path) already excludes the lead itself via
    # `models.Lead.id != lead.id` — this mirrors that same guard.
    result = {}
    for lead in leads:
        company = (lead.company or "").strip().lower()
        resolution = resolution_cache.get(company)
        if resolution and resolution.get("resolved_lead_id") == lead.id:
            resolution = None
        result[lead.id] = resolution
    return result



# ── Batch prefetch for latest notes/calls (avoids loading ALL per lead) ──────

def _batch_latest_activity(db, leads):
    """Batch fetch latest note and latest call per lead in 2 queries.
    Uses PostgreSQL DISTINCT ON to fetch exactly 1 row per lead_id — avoids
    loading all notes/calls and deduplicating in Python.
    Returns dicts: latest_notes[lead_id], latest_calls[lead_id]."""
    lead_ids = [l.id for l in leads]
    if not lead_ids:
        return {}, {}

    # ── Latest note per lead: DISTINCT ON (lead_id) ORDER BY lead_id, created_at DESC ──
    # Fetches exactly 1 row per lead_id — PostgreSQL handles the dedup at the DB level.
    # SQLite (used in tests) doesn't support DISTINCT ON — fall back to Python dedup.
    from sqlalchemy import text as sa_text
    latest_notes = {}
    note_counts = {}

    # Count query (still needed for UI display)
    count_rows = db.query(
        models.Note.lead_id,
        func.count(models.Note.id).label("cnt")
    ).filter(
        models.Note.lead_id.in_(lead_ids)
    ).group_by(models.Note.lead_id).all()
    for lid, cnt in count_rows:
        note_counts[lid] = cnt

    is_postgres = "postgresql" in str(db.bind.dialect.name) if db.bind else False

    if is_postgres and lead_ids:
        # PostgreSQL fast path: DISTINCT ON fetches exactly 1 row per lead
        placeholders = ", ".join(f"'{lid}'" for lid in lead_ids)
        note_sql = sa_text(f"""
            SELECT DISTINCT ON (lead_id) lead_id, content, author, created_at
            FROM notes
            WHERE lead_id IN ({placeholders})
            ORDER BY lead_id, created_at DESC
        """)
        for row in db.execute(note_sql):
            safe_content = (row.content or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
            truncated = safe_content[:150] + ('…' if len(safe_content) > 150 else '')
            latest_notes[row.lead_id] = {
                "content": truncated,
                "author": row.author or 'SDR',
                "created_at": str(row.created_at) if row.created_at else None,
                "_count": note_counts.get(row.lead_id, 0),
            }
    else:
        # SQLite fallback (tests/dev): fetch all then dedup in Python
        notes_rows = db.query(models.Note).filter(
            models.Note.lead_id.in_(lead_ids)
        ).order_by(models.Note.lead_id, models.Note.created_at.desc()).all()
        seen_note_leads: set = set()
        for n in notes_rows:
            if n.lead_id not in seen_note_leads:
                seen_note_leads.add(n.lead_id)
                safe_content = (n.content or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
                truncated = safe_content[:150] + ('…' if len(safe_content) > 150 else '')
                latest_notes[n.lead_id] = {
                    "content": truncated,
                    "author": n.author or 'SDR',
                    "created_at": str(n.created_at) if n.created_at else None,
                    "_count": note_counts.get(n.lead_id, 0),
                }

    # ── Latest call_log per lead: DISTINCT ON (lead_id) ORDER BY lead_id, called_at DESC ──
    latest_calls = {}
    call_counts = {}

    count_call_rows = db.query(
        models.CallLog.lead_id,
        func.count(models.CallLog.id).label("cnt")
    ).filter(
        models.CallLog.lead_id.in_(lead_ids)
    ).group_by(models.CallLog.lead_id).all()
    for lid, cnt in count_call_rows:
        call_counts[lid] = cnt

    if is_postgres and lead_ids:
        placeholders = ", ".join(f"'{lid}'" for lid in lead_ids)
        call_sql = sa_text(f"""
            SELECT DISTINCT ON (lead_id) lead_id, outcome, called_at
            FROM call_logs
            WHERE lead_id IN ({placeholders})
            ORDER BY lead_id, called_at DESC
        """)
        for row in db.execute(call_sql):
            latest_calls[row.lead_id] = {
                "outcome": row.outcome,
                "called_at": row.called_at,
                "_count": call_counts.get(row.lead_id, 0),
            }
    else:
        call_rows = db.query(models.CallLog).filter(
            models.CallLog.lead_id.in_(lead_ids)
        ).order_by(models.CallLog.lead_id, models.CallLog.called_at.desc()).all()
        seen_call_leads: set = set()
        for cl in call_rows:
            if cl.lead_id not in seen_call_leads:
                seen_call_leads.add(cl.lead_id)
                latest_calls[cl.lead_id] = {
                    "outcome": cl.outcome,
                    "called_at": cl.called_at,
                    "_count": call_counts.get(cl.lead_id, 0),
                }

    return latest_notes, latest_calls


def _batch_last_outbound_email(db, leads):
    """Batch fetch each lead's most recent outbound email timestamp, 1 query
    for the whole page — mailbox sync (LeadEmailActivity) means this is now
    meaningful for every lead, not just ones an SDR happened to note down.
    Returns dict: lead_id -> datetime or None."""
    lead_ids = [l.id for l in leads]
    if not lead_ids:
        return {}
    rows = db.query(
        models.LeadEmailActivity.lead_id,
        func.max(models.LeadEmailActivity.timestamp),
    ).filter(
        models.LeadEmailActivity.lead_id.in_(lead_ids),
        models.LeadEmailActivity.direction == "outbound",
    ).group_by(models.LeadEmailActivity.lead_id).all()
    return dict(rows)


# ── Serialization ────────────────────────────────────────────────────────────

def _latest_call_outcome(lead):
    """Most recent outcome across CallLog + DialerCall (dialer-logged outcomes
    never create a CallLog row — see call_routes.py:176 — so CallLog alone is
    stale for leads called via the in-app dialer)."""
    last_call_outcome = None
    last_call_at = None
    if hasattr(lead, 'call_logs') and lead.call_logs:
        cl = lead.call_logs[0]
        if cl.outcome:
            last_call_outcome = cl.outcome
            last_call_at = cl.called_at
    if hasattr(lead, 'dialer_calls') and lead.dialer_calls:
        dc = max(lead.dialer_calls, key=lambda d: d.created_at or datetime.min.replace(tzinfo=timezone.utc))
        dc_time = dc.started_at or dc.created_at
        if dc.outcome and (last_call_at is None or (dc_time and dc_time > last_call_at)):
            last_call_outcome = dc.outcome
    return last_call_outcome


# Distinct from `None`, which _batch_latest_activity legitimately returns for
# a lead with zero notes/calls — that's a real "no data" answer, not "nobody
# checked". Without this, every lead with no note/call fell through to a
# lazy relationship access (one extra query per row) to independently
# rediscover what the batch call had already confirmed.
_NOT_PREFETCHED = object()


def _lead_to_summary(lead, prefetched_note=_NOT_PREFETCHED, prefetched_call=_NOT_PREFETCHED, last_email_sent_at=None):
    """Lightweight dict for list/table views — no enrichment or research data."""
    lead_pod_ids = list(set(u.pod_id for u in lead.assigned_users if u.pod_id)) if lead.assigned_users else []
    # Latest note preview — use prefetched data if available
    latest_note = None
    note_count = 0
    if prefetched_note is not _NOT_PREFETCHED:
        if prefetched_note:
            latest_note = {
                "content": prefetched_note["content"],
                "author": prefetched_note["author"],
                "created_at": prefetched_note["created_at"],
            }
            note_count = prefetched_note.get("_count", 0)
        # else: batch confirmed no note — nothing to fall back to.
    elif hasattr(lead, 'notes') and lead.notes:
        note_count = len(lead.notes)
        n = lead.notes[0]  # ordered desc by created_at
        safe_content = (n.content or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
        truncated = safe_content[:150] + ('…' if len(safe_content) > 150 else '')
        latest_note = {
            "content": truncated,
            "author": n.author or 'SDR',
            "created_at": str(n.created_at) if n.created_at else None,
        }
    # ── Last call outcome (most recent across CallLog + DialerCall) ──
    last_call_outcome = None
    last_call_at = None
    # Use prefetched call data if available
    if prefetched_call is not _NOT_PREFETCHED:
        if prefetched_call:
            last_call_outcome = prefetched_call["outcome"]
            last_call_at = prefetched_call["called_at"]
        # else: batch confirmed no CallLog — dialer_calls check below still runs.
    elif hasattr(lead, 'call_logs') and lead.call_logs:
        cl = lead.call_logs[0]
        if cl.outcome:
            last_call_outcome = cl.outcome
            last_call_at = cl.called_at
    # Check dialer_calls — use whichever is newer
    if hasattr(lead, 'dialer_calls') and lead.dialer_calls:
        dc = max(lead.dialer_calls, key=lambda d: d.created_at or datetime.min.replace(tzinfo=timezone.utc))
        dc_time = dc.started_at or dc.created_at
        if dc.outcome and (last_call_at is None or (dc_time and dc_time > last_call_at)):
            last_call_outcome = dc.outcome
            last_call_at = dc_time

    # ── Compute time-in-status ──────────────────────────────────────
    time_in_status = None
    time_in_status_hours = None
    if lead.status_changed_at:
        try:
            delta = datetime.now(timezone.utc) - lead.status_changed_at.replace(tzinfo=timezone.utc) if lead.status_changed_at.tzinfo is None else datetime.now(timezone.utc) - lead.status_changed_at
            total_hours = delta.total_seconds() / 3600
            time_in_status_hours = round(total_hours, 1)
            if total_hours < 1:
                time_in_status = f"{int(delta.total_seconds() / 60)}m"
            elif total_hours < 24:
                time_in_status = f"{int(total_hours)}h"
            elif total_hours < 720:  # 30 days
                days = int(total_hours / 24)
                remaining_hrs = int(total_hours % 24)
                time_in_status = f"{days}d {remaining_hrs}h" if remaining_hrs else f"{days}d"
            else:
                time_in_status = f"{int(total_hours / 720)}mo"
        except Exception:
            pass

    # ── Last activity (most recent across notes, calls, status changes) ──
    last_activity = None
    activity_candidates = []

    # Latest note
    if latest_note:
        activity_candidates.append({
            "type": "note",
            "summary": latest_note["content"],
            "timestamp": latest_note["created_at"],
            "author": latest_note["author"],
        })

    # Latest call
    if last_call_at:
        outcome_str = last_call_outcome.value if hasattr(last_call_outcome, 'value') else (last_call_outcome or 'Called')
        activity_candidates.append({
            "type": "call",
            "summary": f"Call — {outcome_str}",
            "timestamp": str(last_call_at) if last_call_at else None,
            "author": None,
        })

    # Status change
    if lead.status_changed_at:
        activity_candidates.append({
            "type": "status_change",
            "summary": f"Status → {lead.status}",
            "timestamp": str(lead.status_changed_at),
            "author": None,
        })

    if activity_candidates:
        # Pick the most recent
        last_activity = max(activity_candidates, key=lambda a: a["timestamp"] or "")

    if prefetched_call is not _NOT_PREFETCHED:
        call_count = prefetched_call.get("_count", 0) if prefetched_call else 0
    else:
        # No batch was attempted for this call (non-list callers) — fall
        # back to the lazy relationship, same as the note/call blocks above.
        call_count = len(lead.call_logs) if hasattr(lead, 'call_logs') and lead.call_logs else 0

    return {
        "id":             lead.id,
        "first_name":     lead.first_name,
        "last_name":      lead.last_name,
        "email":          lead.email,
        "phone":          lead.phone,
        "phone_secondary": lead.phone_secondary,
        "company_phone":  lead.company_phone,
        "company":        lead.company,
        "title":          lead.title,
        "status":         lead.status,
        "lead_source":    lead.lead_source or "salesforce",
        "call_count":     call_count,
        "call_attempt_count": lead.call_attempt_count or 0,
        "assigned_to":    [{"id": u.id, "name": u.name} for u in lead.assigned_users] if lead.assigned_users else [],
        "assigned_to_name": ", ".join(u.name for u in lead.assigned_users if u.name) if lead.assigned_users else None,
        "lead_pod_ids":   lead_pod_ids,
        "pod_id":         lead.pod_id,
        "upload_log_id":  lead.upload_log_id,
        "tags":           [t.name for t in lead.tags] if lead.tags else [],
        "last_synced_at":      str(lead.last_synced_at) if lead.last_synced_at else None,
        "status_changed_at":   str(lead.status_changed_at) if lead.status_changed_at else None,
        "created_at":          str(lead.created_at) if lead.created_at else None,
        "closed_reason":       lead.closed_reason,
        "no_show_count":       lead.no_show_count or 0,
        # Contact-suppression flags (Power Dialer client-side pre-filter — the
        # actual enforcement is the backend gate in dialer_service.initiate_call)
        "do_not_contact":      lead.do_not_contact,
        "unsubscribed_at":     str(lead.unsubscribed_at) if lead.unsubscribed_at else None,
        # Power Dialer's lead-context strip — raw fields only, display
        # formatting (bucketing employee_count, mapping lead_source to a
        # label, etc.) happens client-side, same convention as `status`.
        "city":                lead.city,
        "state":               lead.state,
        "country":             lead.country,
        "employee_count":      lead.employee_count,
        "research_company_size": lead.research_company_size,
        # Last call outcome
        "last_call_outcome":   last_call_outcome,
        "last_call_at":        str(last_call_at) if last_call_at else None,
        # Last outbound email sent (mailbox sync) — None if never/not computed by this caller
        "last_email_sent_at":  str(last_email_sent_at) if last_email_sent_at else None,
        # Time in current status
        "time_in_status":       time_in_status,
        "time_in_status_hours": time_in_status_hours,
        # Last activity preview
        "last_activity":  last_activity,
        # Priority (deprioritization)
        "priority_score":      lead.priority_score if hasattr(lead, 'priority_score') and lead.priority_score is not None else 100,
        # Opportunity outcome
        "opportunity_status":     lead.opportunity_status,
        "opportunity_notes":      lead.opportunity_notes,
        "opportunity_updated_at": str(lead.opportunity_updated_at) if lead.opportunity_updated_at else None,
        "opportunity_updated_by": lead.opportunity_updated_by,
        # Notes preview
        "latest_note": latest_note,
        "note_count":  note_count,
    }


# ── Cached settings to avoid per-lead DB roundtrips ──────────────────────────
_settings_cache = {"data": None, "ts": 0}

def _get_cached_settings():
    """Return call-attempt settings, cached for 30 seconds."""
    import time
    now = time.time()
    if _settings_cache["data"] is None or now - _settings_cache["ts"] > 30:
        try:
            from database import SessionLocal
            with SessionLocal() as s:
                settings = s.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
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


def _lead_to_dict(lead):
    """Full dict for detail view — includes enrichment, research, lifecycle."""
    # Fetch global settings (cached at module level to avoid per-lead DB hits)
    settings_info = _get_cached_settings()

    current_attempts = lead.call_attempt_count or 0
    max_attempts = settings_info.get("max_call_attempts", 5)

    return {
        "id":             lead.id,
        "sf_lead_id":     lead.sf_lead_id,
        "first_name":     lead.first_name,
        "last_name":      lead.last_name,
        "email":          lead.email,
        "phone":          lead.phone,
        "phone_secondary": lead.phone_secondary,
        "company":        lead.company,
        "title":          lead.title,
        "status":         lead.status,
        "lead_source":    lead.lead_source or "salesforce",
        "last_synced_at": str(lead.last_synced_at) if lead.last_synced_at else None,
        "created_at":     str(lead.created_at) if lead.created_at else None,
        "assigned_to":    [{"id": u.id, "name": u.name, "email": u.email, "pod_id": u.pod_id} for u in lead.assigned_users],
        "lead_pod_ids":   list(set(u.pod_id for u in lead.assigned_users if u.pod_id)),
        "call_count":     len(lead.call_logs),
        "last_call_outcome": _latest_call_outcome(lead),
        "status_changed_at": str(lead.status_changed_at) if lead.status_changed_at else None,
        # Phase 3: Lifecycle & attempt tracking
        "call_attempt_count":     current_attempts,
        "max_call_attempts":      max_attempts,
        "max_attempts_reached":   current_attempts >= max_attempts,
        "min_call_attempts_for_unreachable": settings_info.get("min_call_attempts_for_unreachable", 3),
        "lead_started_at":   str(lead.lead_started_at) if lead.lead_started_at else None,
        "lead_closed_at":    str(lead.lead_closed_at) if lead.lead_closed_at else None,
        "closed_reason":     lead.closed_reason,
        "no_show_count":     lead.no_show_count or 0,
        "discovery_meeting_count": getattr(lead, "discovery_meeting_count", 0) or 0,
        "last_call_timestamp": str(lead.last_call_timestamp) if lead.last_call_timestamp else None,
        # Enrichment
        "linkedin_url":        lead.linkedin_url,
        "person_linkedin":     lead.person_linkedin,
        "website":             lead.website,
        "city":                lead.city,
        "state":               lead.state,
        "country":             lead.country,
        "industry":            lead.industry,
        "employee_count":      lead.employee_count,
        "annual_revenue":      lead.annual_revenue,
        "total_funding":       lead.total_funding,
        "company_phone":       lead.company_phone,
        "company_linkedin":    lead.company_linkedin,
        "company_street":      lead.company_street,
        "company_city":        lead.company_city,
        "company_postal_code": lead.company_postal_code,
        "company_state":       lead.company_state,
        "company_country":     lead.company_country,
        "company_founded":     lead.company_founded,
        # Research
        "research_company":         lead.research_company,
        "research_contact":         lead.research_contact,
        "research_hypothesis":      lead.research_hypothesis,
        "research_personalization": lead.research_personalization,
        "research_industry":        lead.research_industry,
        "research_company_size":    lead.research_company_size,
        "research_services":        lead.research_services,
        "research_geo":             lead.research_geo,
        "research_timezone":        lead.research_timezone,
        "research_hook":            lead.research_hook,
        "research_channels":        lead.research_channels,
        "research_heat":            lead.research_heat,      # v2: hot|warm|cold
        "research_opening":         lead.research_opening,   # v2: ready-to-say opening line

        # Opportunity outcome
        "opportunity_status":     lead.opportunity_status,
        "opportunity_notes":      lead.opportunity_notes,
        "opportunity_updated_at": str(lead.opportunity_updated_at) if lead.opportunity_updated_at else None,
        "opportunity_updated_by": lead.opportunity_updated_by,
        "dialer_calls": [
            {
                "id": c.id,
                "provider": c.provider,
                "status": c.status,
                "direction": c.direction,
                "duration": c.duration,
                "recording_url": c.recording_url,
                "outcome": c.outcome,
                "notes": c.notes,
                "created_at": str(c.created_at) if c.created_at else None,
                "started_at": str(c.started_at) if c.started_at else None,
            } for c in lead.dialer_calls
        ] if hasattr(lead, 'dialer_calls') else [],
        "call_logs": [
            {
                "id": c.id,
                "outcome": c.outcome.value if hasattr(c.outcome, 'value') else c.outcome,
                "notes": c.notes,
                "user_id": c.user_id,
                "user_name": c.user.name if c.user else "Unknown",
                "called_at": str(c.called_at) if c.called_at else None,
                "timestamp": str(c.called_at) if c.called_at else None,
            } for c in lead.call_logs
        ] if hasattr(lead, 'call_logs') else [],
        # Convenience fields for the detail header
        "assigned_to_name": lead.assigned_users[0].name if lead.assigned_users else None,
        "last_activity_at": str(lead.updated_at) if hasattr(lead, 'updated_at') and lead.updated_at else None,
        "updated_at": str(lead.updated_at) if hasattr(lead, 'updated_at') and lead.updated_at else None,
    }


# ── Query builder ────────────────────────────────────────────────────────────

def _build_lead_query(db, user, global_view: bool = False):
    """Build a base query scoped by user role (Super Admin / Pod Admin / SDR).

    global_view=True (Pod Admin only): bypass pod scoping and return all leads.
    This powers the Pod/Global toggle pill in the UI.
    """
    role = user.get("role")
    if role in ("Super Admin", "Admin"):  # Admin = V1 Super Admin
        return db.query(models.Lead)
    elif role == "Pod Admin":
        if global_view:
            # Pod Admin explicitly switched to global view — return everything
            return db.query(models.Lead)

        pod_id = user.get("pod_id")
        if pod_id:
            # ── Hybrid query (Option B) ───────────────────────────────────────
            # Branch 1: leads assigned to ANY user who belongs to this pod.
            # Uses lead_assignments JOIN — correctly handles AE pods where
            # lead.pod_id still points to the originating SDR pod.
            pod_user_ids = (
                db.query(models.User.id)
                .filter(models.User.pod_id == pod_id)
                .subquery()
            )
            assigned_lead_ids = (
                db.query(models.lead_assignments.c.lead_id)
                .filter(models.lead_assignments.c.user_id.in_(pod_user_ids))
            )

            # Branch 2: pod-tagged leads with NO assignment yet (round-robin pool).
            # These are managed by the Pod Admin for upcoming assignment.
            any_assigned_ids = db.query(models.lead_assignments.c.lead_id)
            unassigned_pod_lead_ids = (
                db.query(models.Lead.id)
                .filter(
                    models.Lead.pod_id == pod_id,
                    ~models.Lead.id.in_(any_assigned_ids),
                )
            )

            visible_ids = assigned_lead_ids.union(unassigned_pod_lead_ids).subquery()
            return db.query(models.Lead).filter(models.Lead.id.in_(visible_ids))

        # Pod Admin with no pod_id in token — data error, show nothing safely
        return db.query(models.Lead).filter(models.Lead.id == None)  # noqa: E711
    else:
        # SDR: only their assigned leads.
        # Use a direct JOIN on lead_assignments — lets PostgreSQL use idx_lead_assignments_user_id
        # instead of the double-subquery pattern (IN (SELECT id FROM (SELECT lead_id...)))
        # which the query planner couldn't optimize.
        return (
            db.query(models.Lead)
            .join(
                models.lead_assignments,
                (models.lead_assignments.c.lead_id == models.Lead.id) &
                (models.lead_assignments.c.user_id == user["sub"])
            )
        )



def _can_modify_lead(db, user, lead_id):
    """Check if the current user is allowed to modify this lead.
    Super Admins can modify any lead.
    Pod Admins can only modify leads that are unassigned or assigned to their pod's members.
    SDRs can only modify their own assigned leads.
    Returns the lead or raises 403."""
    role = user.get("role")
    lead = db.query(models.Lead).options(
        joinedload(models.Lead.assigned_users)
    ).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if role in ("Super Admin", "Admin"):
        return lead  # unrestricted

    if role == "Pod Admin":
        # Unassigned leads — Pod Admin can modify
        if not lead.assigned_users:
            return lead
        # Check if any assigned user belongs to Pod Admin's pod
        user_pod_id = user.get("pod_id")
        if user_pod_id:
            for u in lead.assigned_users:
                if u.pod_id == user_pod_id:
                    return lead
        raise HTTPException(status_code=403, detail="You can only modify leads assigned to your POD.")

    # SDR — only their assigned leads
    user_id = user.get("sub")
    if any(u.id == user_id for u in lead.assigned_users):
        return lead
    raise HTTPException(status_code=403, detail="You can only modify your assigned leads.")


def _apply_filters(query, search=None, status=None, source=None, date_from=None, date_to=None, company=None, outcome=None):
    """Apply optional filters to a lead query."""
    if status:
        if isinstance(status, (list, tuple)):
            query = query.filter(models.Lead.status.in_(status))
        else:
            query = query.filter(models.Lead.status == status)
    if source:
        if source == "uploaded":
            # Match both legacy "uploaded" and new "upload:filename:timestamp" values
            query = query.filter(
                (models.Lead.lead_source == "uploaded") | (models.Lead.lead_source.like("upload:%"))
            )
        elif source == "gsheet":
            query = query.filter(models.Lead.lead_source.like("gsheet:%"))
        else:
            query = query.filter(models.Lead.lead_source == source)
    if company:
        if company == "__none__":
            query = query.filter((models.Lead.company == None) | (models.Lead.company == ""))
        else:
            query = query.filter(models.Lead.company.ilike(company))
    if date_from:
        try:
            dt = datetime.fromisoformat(date_from)
            query = query.filter(models.Lead.created_at >= dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            # Include the full end day
            dt = dt.replace(hour=23, minute=59, second=59)
            query = query.filter(models.Lead.created_at <= dt)
        except ValueError:
            pass
    if search:
        search_term = f"%{search}%"
        query = query.filter(or_(
            models.Lead.first_name.ilike(search_term),
            models.Lead.last_name.ilike(search_term),
            models.Lead.email.ilike(search_term),
            models.Lead.company.ilike(search_term),
            models.Lead.phone.ilike(search_term),
        ))
    # Filter by MOST RECENT call outcome only.
    # We build a correlated subquery that finds the latest call time per lead
    # across both CallLog and DialerCall, then checks that the call at that
    # timestamp has the requested outcome.  This prevents historical outcomes
    # (e.g. an old "Call Back Later") from surfacing when the latest call was
    # "Meeting Confirmed".
    if outcome:
        from sqlalchemy import select, union_all, literal_column, func as sa_func

        # Latest outcome per lead from CallLog
        cl_sub = (
            select(
                models.CallLog.lead_id.label("lead_id"),
                models.CallLog.outcome.label("outcome"),
                models.CallLog.called_at.label("ts"),
            )
            .where(models.CallLog.lead_id != None)
        )
        # Latest outcome per lead from DialerCall (use started_at, fall back to created_at)
        dc_sub = (
            select(
                models.DialerCall.lead_id.label("lead_id"),
                models.DialerCall.outcome.label("outcome"),
                models.dialer_call_event_time().label("ts"),
            )
            .where(models.DialerCall.lead_id != None)
        )

        # Union both sources into a single ranked set
        all_calls = union_all(cl_sub, dc_sub).subquery("all_calls")

        # Rank calls per lead by ts descending so rank=1 is the latest
        from sqlalchemy import over
        from sqlalchemy.sql.functions import rank as sql_rank

        ranked = (
            select(
                all_calls.c.lead_id,
                all_calls.c.outcome,
                sa_func.row_number()
                .over(
                    partition_by=all_calls.c.lead_id,
                    order_by=all_calls.c.ts.desc(),
                )
                .label("rn"),
            )
        ).subquery("ranked_calls")

        # Only keep the most-recent call per lead, and only if outcome matches
        matching_lead_ids = (
            select(ranked.c.lead_id)
            .where(ranked.c.rn == 1)
            .where(ranked.c.outcome == outcome)
        )

        query = query.filter(models.Lead.id.in_(matching_lead_ids))
    return query

