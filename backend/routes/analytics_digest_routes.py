# ── routes/analytics_digest_routes.py — Daily Digest (Super Admin + Pod Admin) ─
"""
Daily Digest Route — /api/admin/analytics/daily-digest
======================================================
Leadership summary comparing a target day vs same weekday one week prior.
Super Admin sees org-wide data; Pod Admin sees only their own pod (always
scoped, no toggle — see _pod_scope_* helpers below). Includes KPI deltas,
pipeline flow, SDR snapshot, notable events, and status distribution.
"""

import logging
from datetime import datetime, timezone, timedelta, date as _date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from auth import require_admin
import models

from routes.analytics_routes import _cache_key, _cache_get, _cache_set

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics", tags=["analytics"])


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _day_bounds(d: _date):
    """Return (start_of_day_utc, end_of_day_utc) as timezone-aware datetimes."""
    start = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=timezone.utc)
    end = datetime(d.year, d.month, d.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
    return start, end


def _delta_pct(today_val: int, compare_val: int):
    """Compute % change, handling division-by-zero edge cases."""
    if compare_val == 0 and today_val == 0:
        return None   # both zero → no change
    if compare_val == 0:
        return "new"  # went from 0 → something
    return round(((today_val - compare_val) / compare_val) * 100, 1)


# ─── Endpoint: Daily Digest ──────────────────────────────────────────────────

@router.get("/daily-digest")
def get_daily_digest(
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format. Defaults to yesterday."),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Daily Digest — compares a target day vs the same weekday one week prior.
    Pod Admins see only their pod's SDRs and pod-tagged leads (always scoped, no toggle).
    Super Admins see org-wide data.
    """
    # ── Resolve dates ────────────────────────────────────────────────────
    today_utc = datetime.now(timezone.utc).date()

    if date:
        try:
            digest_date = _date.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    else:
        digest_date = today_utc - timedelta(days=1)  # default: yesterday

    if digest_date >= today_utc:
        raise HTTPException(status_code=400, detail="Date must be in the past.")

    # ── Working-day adjustment ────────────────────────────────────────────
    # If digest_date falls on a weekend, shift to the most recent Friday.
    # Comparison date is always the same weekday one week prior, also
    # adjusted to the nearest working day if it lands on a weekend.
    def _prev_working_day(d):
        """Step back to the nearest Mon-Fri."""
        while d.weekday() >= 5:   # 5=Sat, 6=Sun
            d -= timedelta(days=1)
        return d

    original_digest_date = digest_date
    digest_date = _prev_working_day(digest_date)
    compare_date = _prev_working_day(digest_date - timedelta(days=7))
    is_working_day = (original_digest_date == digest_date)

    d_start, d_end = _day_bounds(digest_date)
    c_start, c_end = _day_bounds(compare_date)

    # ── Pod scoping for Pod Admin (always scoped, no toggle) ────────────────
    # RCA 2026-07-27: every query below except new_leads/stuck_leads/sdr_q was
    # unscoped — a Pod Admin's digest showed org-wide totals mislabeled as
    # their own (calls, meetings, pipeline moved, researched, demos, and the
    # whole status snapshot). Applied unconditionally whenever _is_pod_admin
    # (even if _pod_id is missing/None) so a misconfigured Pod Admin account
    # never silently falls back to seeing the entire org's data.
    _is_pod_admin = admin.get("role") == "Pod Admin"
    _pod_id = admin.get("pod_id") if _is_pod_admin else None

    pod_user_subq = None
    if _is_pod_admin:
        pod_user_subq = db.query(models.User.id).filter(models.User.pod_id == _pod_id).subquery()

    def _pod_scope_leads(q):
        """Scope a query selecting/filtering on Lead directly."""
        return q.filter(models.Lead.pod_id == _pod_id) if _is_pod_admin else q

    def _pod_scope_calls(q):
        """Scope a query selecting/filtering on CallLog (by the calling user's pod)."""
        return q.filter(models.CallLog.user_id.in_(pod_user_subq)) if _is_pod_admin else q

    def _pod_scope_status_log(q):
        """Scope a query selecting/filtering on LeadStatusLog (via a join to its Lead)."""
        if _is_pod_admin:
            q = q.join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id) \
                 .filter(models.Lead.pod_id == _pod_id)
        return q

    # ── Check cache ──────────────────────────────────────────────────────
    # Key includes both the adjusted digest_date AND the original requested
    # date, so Saturday and Sunday requests (which both resolve to the same
    # Friday) return their own original_date in the response.
    ckey = _cache_key("daily-digest", f"{digest_date}_{original_digest_date}_{_pod_id or 'all'}")
    cached = _cache_get(ckey)
    if cached:
        return cached

    # ── Q1: New leads created ────────────────────────────────────────────
    # RCA 2026-07-27: excluding by the lead's CURRENT status made this number
    # drift after the fact — a lead disqualified weeks later would silently
    # vanish from that day's historical count the next time it was viewed
    # (cache TTL is only 10 min). Instead, exclude only leads that had
    # ALREADY become parked by the end of that specific day — a fact that
    # never changes no matter when the digest is re-viewed.
    def _parked_by_end_of_day(cutoff):
        return db.query(models.LeadStatusLog.id).filter(
            models.LeadStatusLog.lead_id == models.Lead.id,
            models.LeadStatusLog.to_status.in_(models.PARKED_STATUSES),
            models.LeadStatusLog.changed_at <= cutoff,
        ).exists()

    new_leads_q = _pod_scope_leads(db.query(func.count(models.Lead.id)).filter(
        models.Lead.created_at.between(d_start, d_end),
        ~_parked_by_end_of_day(d_end),
    ))
    new_leads_compare_q = _pod_scope_leads(db.query(func.count(models.Lead.id)).filter(
        models.Lead.created_at.between(c_start, c_end),
        ~_parked_by_end_of_day(c_end),
    ))
    new_leads_today = new_leads_q.scalar() or 0
    new_leads_compare = new_leads_compare_q.scalar() or 0

    # ── Q2: Calls made (grouped by user) ─────────────────────────────────
    calls_today_rows = _pod_scope_calls(db.query(
        models.CallLog.user_id,
        func.count(models.CallLog.id)
    ).filter(
        models.CallLog.called_at.between(d_start, d_end)
    )).group_by(models.CallLog.user_id).all()

    calls_compare_rows = _pod_scope_calls(db.query(
        models.CallLog.user_id,
        func.count(models.CallLog.id)
    ).filter(
        models.CallLog.called_at.between(c_start, c_end)
    )).group_by(models.CallLog.user_id).all()

    calls_today_by_user = dict(calls_today_rows)
    calls_compare_by_user = dict(calls_compare_rows)
    total_calls_today = sum(calls_today_by_user.values())
    total_calls_compare = sum(calls_compare_by_user.values())

    # ── Q3: Pipeline transitions ─────────────────────────────────────────
    transitions_today = _pod_scope_status_log(db.query(
        models.LeadStatusLog.from_status,
        models.LeadStatusLog.to_status,
        func.count(models.LeadStatusLog.id)
    ).filter(
        models.LeadStatusLog.changed_at.between(d_start, d_end)
    )).group_by(
        models.LeadStatusLog.from_status,
        models.LeadStatusLog.to_status
    ).all()

    pipeline_flow = [
        {
            "from_status": row[0] or "New Lead",
            "to_status": row[1],
            "count": row[2]
        }
        for row in transitions_today
    ]
    total_pipeline_moved = sum(row[2] for row in transitions_today)

    transitions_compare = _pod_scope_status_log(db.query(
        func.count(models.LeadStatusLog.id)
    ).filter(
        models.LeadStatusLog.changed_at.between(c_start, c_end)
    )).scalar() or 0

    # ── Q4: Meetings booked (subset of transitions) ──────────────────────
    meetings_today = _pod_scope_status_log(db.query(func.count(models.LeadStatusLog.id)).filter(
        models.LeadStatusLog.changed_at.between(d_start, d_end),
        models.LeadStatusLog.to_status == "Meeting Scheduled"
    )).scalar() or 0

    meetings_compare = _pod_scope_status_log(db.query(func.count(models.LeadStatusLog.id)).filter(
        models.LeadStatusLog.changed_at.between(c_start, c_end),
        models.LeadStatusLog.to_status == "Meeting Scheduled"
    )).scalar() or 0

    # ── Leads researched (moved to or past Calling from Research) ────────
    researched_today = _pod_scope_status_log(db.query(func.count(models.LeadStatusLog.id)).filter(
        models.LeadStatusLog.changed_at.between(d_start, d_end),
        models.LeadStatusLog.from_status == "Research",
        models.LeadStatusLog.to_status == "Calling"
    )).scalar() or 0

    researched_compare = _pod_scope_status_log(db.query(func.count(models.LeadStatusLog.id)).filter(
        models.LeadStatusLog.changed_at.between(c_start, c_end),
        models.LeadStatusLog.from_status == "Research",
        models.LeadStatusLog.to_status == "Calling"
    )).scalar() or 0

    # ── Demos completed ──────────────────────────────────────────────────
    demos_today = _pod_scope_status_log(db.query(func.count(models.LeadStatusLog.id)).filter(
        models.LeadStatusLog.changed_at.between(d_start, d_end),
        models.LeadStatusLog.to_status == "Demo Done"
    )).scalar() or 0

    demos_compare = _pod_scope_status_log(db.query(func.count(models.LeadStatusLog.id)).filter(
        models.LeadStatusLog.changed_at.between(c_start, c_end),
        models.LeadStatusLog.to_status == "Demo Done"
    )).scalar() or 0

    # ── Q5: Stuck leads (in Research or Calling > 5 days) ────────────────
    stuck_threshold = d_start - timedelta(days=5)
    stuck_leads_q = _pod_scope_leads(db.query(func.count(models.Lead.id)).filter(
        models.Lead.status.in_(["Research", "Calling"]),
        models.Lead.status_changed_at < stuck_threshold
    ))
    stuck_leads_count = stuck_leads_q.scalar() or 0

    # ── Q6: Batch uploads ────────────────────────────────────────────────
    # RCA 2026-07-27: missed in the original pod-scoping pass — a Pod Admin
    # saw every org-wide upload as a "notable event". LeadUploadLog has no
    # pod_id of its own, so scope by the uploader's pod (uploaded_by).
    uploads_today_q = db.query(
        models.LeadUploadLog.filename,
        models.LeadUploadLog.total_rows,
        models.LeadUploadLog.created_at
    ).filter(
        models.LeadUploadLog.created_at.between(d_start, d_end)
    )
    if _is_pod_admin:
        uploads_today_q = uploads_today_q.filter(models.LeadUploadLog.uploaded_by.in_(pod_user_subq))
    uploads_today = uploads_today_q.all()

    # ── SDR Performance Snapshot (sorted by most active) ─────────────────
    # changed_by is a free-text field — some call sites append context, e.g.
    # "Jane Doe (No Show: patient rescheduled)" (lead_routes.py, intentionally
    # shown as-is in the lead's status-history timeline). An exact dict-key
    # match against sdr.name silently dropped those rows from this SDR's
    # snapshot. _sum_for_user matches an exact name OR "<name> (" prefix.
    def _sum_for_user(rows, name):
        return sum(count for changed_by, count in rows if changed_by == name or (changed_by or "").startswith(f"{name} ("))

    meetings_rows_today = _pod_scope_status_log(db.query(
        models.LeadStatusLog.changed_by,
        func.count(models.LeadStatusLog.id)
    ).filter(
        models.LeadStatusLog.changed_at.between(d_start, d_end),
        models.LeadStatusLog.to_status == "Meeting Scheduled"
    )).group_by(models.LeadStatusLog.changed_by).all()

    # Leads progressed per user (any status change) on digest date
    progressed_rows_today = _pod_scope_status_log(db.query(
        models.LeadStatusLog.changed_by,
        func.count(models.LeadStatusLog.id)
    ).filter(
        models.LeadStatusLog.changed_at.between(d_start, d_end)
    )).group_by(models.LeadStatusLog.changed_by).all()

    # Meetings and calls for compare date (for delta)
    meetings_rows_compare = _pod_scope_status_log(db.query(
        models.LeadStatusLog.changed_by,
        func.count(models.LeadStatusLog.id)
    ).filter(
        models.LeadStatusLog.changed_at.between(c_start, c_end),
        models.LeadStatusLog.to_status == "Meeting Scheduled"
    )).group_by(models.LeadStatusLog.changed_by).all()

    # Build SDR list — pod-scoped for Pod Admin (DD-1: filter at query level)
    sdr_q = db.query(models.User).filter(
        models.User.role.in_(["SDR", "AE"])
    )
    if _is_pod_admin:
        sdr_q = sdr_q.filter(models.User.pod_id == _pod_id)
    sdrs = sdr_q.all()

    sdr_snapshot = []
    for sdr in sdrs:
        calls = calls_today_by_user.get(sdr.id, 0)
        meetings = _sum_for_user(meetings_rows_today, sdr.name)
        progressed = _sum_for_user(progressed_rows_today, sdr.name)
        calls_lw = calls_compare_by_user.get(sdr.id, 0)
        meetings_lw = _sum_for_user(meetings_rows_compare, sdr.name)
        total_activity = calls + meetings + progressed

        # Skip SDRs with zero activity on both days
        if total_activity == 0 and calls_lw == 0 and meetings_lw == 0:
            continue

        sdr_snapshot.append({
            "user_id": sdr.id,
            "name": sdr.name or sdr.email,
            "calls": calls,
            "meetings": meetings,
            "leads_progressed": progressed,
            "calls_last_week": calls_lw,
            "meetings_last_week": meetings_lw,
            "total_activity": total_activity,
        })

    # Sort by most active first
    sdr_snapshot.sort(key=lambda x: x["total_activity"], reverse=True)

    # ── Notable Events (auto-generated) ──────────────────────────────────
    notable_events = []

    # Top performer
    if sdr_snapshot:
        top = sdr_snapshot[0]
        if top["meetings"] > 0:
            notable_events.append({
                "type": "achievement",
                "message": f"🏆 {top['name']} booked {top['meetings']} meeting{'s' if top['meetings'] != 1 else ''}"
            })
        elif top["calls"] > 0:
            notable_events.append({
                "type": "achievement",
                "message": f"📞 {top['name']} made {top['calls']} calls (most active)"
            })

    # Stuck leads warning
    if stuck_leads_count > 0:
        notable_events.append({
            "type": "warning",
            "message": f"⚠️ {stuck_leads_count} lead{'s' if stuck_leads_count != 1 else ''} stuck in Research/Calling > 5 days"
        })

    # Batch uploads
    for upload in uploads_today:
        notable_events.append({
            "type": "info",
            "message": f"📥 Batch uploaded: {upload.total_rows} leads ({upload.filename or 'Sheet'})"
        })

    # Zero activity warning
    if total_calls_today == 0 and total_pipeline_moved == 0:
        notable_events.append({
            "type": "warning",
            "message": "😶 No calling or pipeline activity recorded for this day"
        })

    # ── Status snapshot (current pipeline counts — org-wide for Super Admin,
    #    pod-scoped for Pod Admin) ──────────────────────────────────────────
    status_rows = _pod_scope_leads(db.query(
        models.Lead.status, func.count(models.Lead.id)
    )).group_by(models.Lead.status).all()
    status_snapshot = dict(status_rows)

    # ── Assemble response ────────────────────────────────────────────────
    result = {
        "digest_date": str(digest_date),
        "comparison_date": str(compare_date),
        "original_date": str(original_digest_date),
        "is_working_day": is_working_day,

        "kpi": {
            "new_leads":        {"today": new_leads_today,      "compare": new_leads_compare,      "delta_pct": _delta_pct(new_leads_today, new_leads_compare)},
            "calls_made":       {"today": total_calls_today,    "compare": total_calls_compare,    "delta_pct": _delta_pct(total_calls_today, total_calls_compare)},
            "meetings_booked":  {"today": meetings_today,       "compare": meetings_compare,       "delta_pct": _delta_pct(meetings_today, meetings_compare)},
            "pipeline_moved":   {"today": total_pipeline_moved, "compare": transitions_compare,    "delta_pct": _delta_pct(total_pipeline_moved, transitions_compare)},
            "leads_researched": {"today": researched_today,     "compare": researched_compare,     "delta_pct": _delta_pct(researched_today, researched_compare)},
            "demos_completed":  {"today": demos_today,          "compare": demos_compare,          "delta_pct": _delta_pct(demos_today, demos_compare)},
        },

        "pipeline_flow": sorted(pipeline_flow, key=lambda x: x["count"], reverse=True),
        "sdr_snapshot": sdr_snapshot,
        "notable_events": notable_events,
        "status_snapshot": status_snapshot,
    }

    _cache_set(ckey, result)
    return result
