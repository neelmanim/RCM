# ── routes/analytics_digest_routes.py — Daily Digest (Super Admin + Pod Admin) ─
"""
Daily Digest Route — /api/admin/analytics/daily-digest
======================================================
Leadership summary comparing a target day vs same weekday one week prior.
Super Admin sees org-wide data; Pod Admin sees only their own pod (always
scoped, no toggle — see _pod_scope_* helpers below). Includes KPI deltas,
pipeline flow, SDR snapshot, notable events, and status distribution.
"""

import hashlib
import json
import logging
import time
from datetime import datetime, timezone, timedelta, date as _date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from auth import check_export_access, require_admin, require_super_admin, require_export_access
import access_db
import models
from pydantic import BaseModel
from services import audit, daily_activity, digest_metrics, funnel, offboarding, segments
from routes._admin_helpers import get_conversation_min_seconds, _get_or_create_sync_settings

from routes.analytics_routes import _cache_key, _cache_get, _cache_set, _cache_invalidate_prefix

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics", tags=["analytics"])


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _delta_pct(today_val: int, compare_val: int):
    """Compute % change, handling division-by-zero edge cases."""
    if compare_val == 0 and today_val == 0:
        return None   # both zero → no change
    if compare_val == 0:
        return "new"  # went from 0 → something
    return round(((today_val - compare_val) / compare_val) * 100, 1)


# ─── Endpoint: Daily Digest ──────────────────────────────────────────────────

MAX_RANGE_DAYS = 92


def _parse_day(value, label):
    try:
        return _date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{label} must be YYYY-MM-DD.")


def _resolve_window(date, date_from, date_to, today_utc):
    """-> dict(mode, from_day, to_day, cmp_from, cmp_to, is_working_day, original, compare_label).
    One day compares with the same weekday a week earlier (weekends shift to Friday); a longer range compares with the
    range of the same length right before it. Everything must be strictly in the past."""
    if date_from or date_to:
        if not (date_from and date_to):
            raise HTTPException(status_code=400, detail="Give both a start and an end date.")
        f, t = _parse_day(date_from, "from"), _parse_day(date_to, "to")
        if f > t:
            raise HTTPException(status_code=400, detail="The start date must not be after the end date.")
        if t >= today_utc:
            raise HTTPException(status_code=400, detail="Date must be in the past.")
        span = (t - f).days + 1
        if span > MAX_RANGE_DAYS:
            raise HTTPException(status_code=400, detail=f"Pick a range of at most {MAX_RANGE_DAYS} days.")
        if span > 1:
            cmp_to = f - timedelta(days=1)
            return dict(mode="range", from_day=f, to_day=t, cmp_from=cmp_to - timedelta(days=span - 1), cmp_to=cmp_to,
                        is_working_day=True, original=t, compare_label=f"the previous {span} days")
        date = f.isoformat()          # a one-day range is just a day

    if date:
        digest_date = _parse_day(date, "Date")
    else:
        digest_date = today_utc - timedelta(days=1)  # default: yesterday
    if digest_date >= today_utc:
        raise HTTPException(status_code=400, detail="Date must be in the past.")

    # Working-day adjustment: a weekend day shifts to the most recent Friday; the comparison is the same weekday one
    # week prior, also adjusted to the nearest working day.
    def _prev_working_day(d):
        while d.weekday() >= 5:   # 5=Sat, 6=Sun
            d -= timedelta(days=1)
        return d

    original = digest_date
    digest_date = _prev_working_day(digest_date)
    compare_date = _prev_working_day(digest_date - timedelta(days=7))
    return dict(mode="day", from_day=digest_date, to_day=digest_date, cmp_from=compare_date, cmp_to=compare_date,
                is_working_day=(original == digest_date), original=original, compare_label="same weekday last week")


def _load_digest(date, pod_id, admin, db, date_from=None, date_to=None):
    """
    Team Digest — a day (vs the same weekday a week earlier) or any range up to 92 days (vs the range right before it).
    Pod Admins see only their pod's SDRs and pod-tagged leads (always scoped, no toggle).
    Super Admins see org-wide data, or one pod when they pick it.
    """
    today_utc = datetime.now(timezone.utc).date()
    w = _resolve_window(date, date_from, date_to, today_utc)
    digest_date, compare_date, original_digest_date = w["to_day"], w["cmp_to"], w["original"]
    is_working_day = w["is_working_day"]

    # ── Pod scoping for Pod Admin (always scoped, no toggle) ────────────────
    # RCA 2026-07-27: every query below except new_leads/stuck_leads/sdr_q was
    # unscoped — a Pod Admin's digest showed org-wide totals mislabeled as
    # their own (calls, meetings, pipeline moved, researched, demos, and the
    # whole status snapshot). Applied unconditionally whenever _is_pod_admin
    # (even if _pod_id is missing/None) so a misconfigured Pod Admin account
    # never silently falls back to seeing the entire org's data.
    # v13.12.1: a Super Admin may also pick one pod (pod_id) — same scoping path, and that pod's own calendar day.
    _is_pod_admin = admin.get("role") == "Pod Admin"
    _pod_id = (access_db.pod_of(admin)) if _is_pod_admin else (pod_id or None)
    _scoped = _pod_id is not None
    _tz = daily_activity.pod_timezone(db, _pod_id) if _scoped else None
    d_start, d_end = funnel.window(w["from_day"], w["to_day"], _tz)      # the team's own days, not UTC
    c_start, c_end = funnel.window(w["cmp_from"], w["cmp_to"], _tz)

    pod_user_subq = None
    if _scoped:
        pod_user_subq = db.query(models.User.id).filter(models.User.pod_id == _pod_id).subquery()

    def _pod_scope_leads(q):
        """Scope a query selecting/filtering on Lead directly."""
        return q.filter(models.Lead.pod_id == _pod_id) if _scoped else q

    def _pod_scope_status_log(q):
        """Scope a query selecting/filtering on LeadStatusLog (via a join to its Lead)."""
        if _scoped:
            q = q.join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id) \
                 .filter(models.Lead.pod_id == _pod_id)
        return q

    # ── Check cache ──────────────────────────────────────────────────────
    # Key includes both the adjusted digest_date AND the original requested
    # date, so Saturday and Sunday requests (which both resolve to the same
    # Friday) return their own original_date in the response.
    ckey = _cache_key("daily-digest", f"{w['from_day']}_{digest_date}_{original_digest_date}_{_pod_id or 'all'}_{admin.get('role')}")
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

    # ── Rep activity for the day (calls, emails, research notes, meetings booked) — one shared definition ─────
    # (a dialer call paired to a call log counts once; a meeting is a booking by the person who booked it).
    rep_q = db.query(models.User).filter(models.User.role.in_(["SDR", "AE"]))
    if _scoped:
        rep_q = rep_q.filter(models.User.pod_id == _pod_id)
    reps = rep_q.all()
    rep_ids = [u.id for u in reps]
    events_today = daily_activity.collect(db, rep_ids, d_start, d_end)
    events_compare = daily_activity.collect(db, rep_ids, c_start, c_end)
    per_today = daily_activity.totals(events_today)
    per_compare = daily_activity.totals(events_compare)
    total_calls_today = sum(v["calls"] for v in per_today.values())
    total_calls_compare = sum(v["calls"] for v in per_compare.values())
    emails_today = sum(v["emails"] for v in per_today.values())
    emails_compare = sum(v["emails"] for v in per_compare.values())
    notes_today = sum(v["research_notes"] for v in per_today.values())
    notes_compare = sum(v["research_notes"] for v in per_compare.values())
    meetings_today = sum(v["meetings"] for v in per_today.values())
    meetings_compare = sum(v["meetings"] for v in per_compare.values())

    # ── Meetings held / no-shows / SAL / accounts given: same definitions as the Funnel (services/funnel.py) ──
    min_seconds = get_conversation_min_seconds(db)
    fun_now = funnel.build(db, rep_ids, d_start, d_end, min_seconds)[1]
    fun_cmp = funnel.build(db, rep_ids, c_start, c_end, min_seconds)[1]

    # ── Campaigns: the lead's campaign tag, for every lead worked in the period ──
    work_lead_ids = {lid for key in ("calls", "emails", "notes", "meetings") for _u, lid, _a in events_today[key] if lid}
    lead_campaign = funnel._campaigns(db, work_lead_ids)

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

    # ── Campaigns sent (Email Campaigns feature, v12.0.0) ────────────────
    # Pod-scoped via the campaign's creator (EmailCampaign.created_by), same
    # convention as every other digest KPI (scope by the acting entity's
    # pod, not by a lead-side field).
    campaigns_sent_q = db.query(func.count(models.EmailCampaignRecipient.id)).join(
        models.EmailCampaign, models.EmailCampaign.id == models.EmailCampaignRecipient.campaign_id
    ).filter(
        models.EmailCampaignRecipient.status == "sent",
        models.EmailCampaignRecipient.sent_at.between(d_start, d_end),
    )
    if _scoped:
        campaigns_sent_q = campaigns_sent_q.filter(models.EmailCampaign.created_by.in_(pod_user_subq))
    campaigns_sent_today = campaigns_sent_q.scalar() or 0

    campaigns_sent_compare_q = db.query(func.count(models.EmailCampaignRecipient.id)).join(
        models.EmailCampaign, models.EmailCampaign.id == models.EmailCampaignRecipient.campaign_id
    ).filter(
        models.EmailCampaignRecipient.status == "sent",
        models.EmailCampaignRecipient.sent_at.between(c_start, c_end),
    )
    if _scoped:
        campaigns_sent_compare_q = campaigns_sent_compare_q.filter(models.EmailCampaign.created_by.in_(pod_user_subq))
    campaigns_sent_compare = campaigns_sent_compare_q.scalar() or 0

    # ── Cadence enrollments (Sales Journey) ──────────────────────────────
    # Pod-scoped via the enrolled lead's pod (matches _pod_scope_status_log's
    # join-to-Lead convention) — NOT Journey.pod_id, which restricts
    # auto-enroll eligibility rather than meaning "owning pod."
    enrollments_q = db.query(func.count(models.JourneyEnrollment.id)).filter(
        models.JourneyEnrollment.enrolled_at.between(d_start, d_end)
    )
    if _scoped:
        enrollments_q = enrollments_q.join(models.Lead, models.Lead.id == models.JourneyEnrollment.lead_id) \
            .filter(models.Lead.pod_id == _pod_id)
    cadence_enrollments_today = enrollments_q.scalar() or 0

    enrollments_compare_q = db.query(func.count(models.JourneyEnrollment.id)).filter(
        models.JourneyEnrollment.enrolled_at.between(c_start, c_end)
    )
    if _scoped:
        enrollments_compare_q = enrollments_compare_q.join(models.Lead, models.Lead.id == models.JourneyEnrollment.lead_id) \
            .filter(models.Lead.pod_id == _pod_id)
    cadence_enrollments_compare = enrollments_compare_q.scalar() or 0

    # ── Q5: Stuck leads (in Research or Calling > 5 days) ────────────────
    stuck_threshold = (d_start if w["mode"] == "day" else d_end) - timedelta(days=5)
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
    if _scoped:
        uploads_today_q = uploads_today_q.filter(models.LeadUploadLog.uploaded_by.in_(pod_user_subq))
    uploads_today = uploads_today_q.all()

    # ── SDR Performance Snapshot (sorted by most active) ─────────────────
    # Leads progressed per rep (any status change that day). changed_by is free text — sometimes "Jane Doe (No Show: …)" —
    # so match the exact name or "<name> (" prefix.
    progressed_rows = _pod_scope_status_log(db.query(
        models.LeadStatusLog.changed_by, func.count(models.LeadStatusLog.id)
    ).filter(models.LeadStatusLog.changed_at.between(d_start, d_end))).group_by(models.LeadStatusLog.changed_by).all()

    def _progressed(name):
        return sum(n for by, n in progressed_rows if by == name or (by or "").startswith(f"{name} ("))

    left = offboarding.left_ids(db, reps)
    sdr_snapshot = []
    for sdr in reps:
        t, lw = per_today.get(sdr.id, {}), per_compare.get(sdr.id, {})
        calls, emails, notes, meetings = (t.get("calls", 0), t.get("emails", 0), t.get("research_notes", 0), t.get("meetings", 0))
        progressed = _progressed(sdr.name)
        total_activity = calls + emails + notes + meetings + progressed
        # An active rep with no activity stays in the table (that is exactly who a team lead looks for);
        # a leaver with nothing on either day is not a row.
        if total_activity == 0 and not any(lw.values()) and (sdr.id in left or sdr.left_at is not None):
            continue
        sdr_snapshot.append({
            "user_id": sdr.id,
            "name": sdr.name or sdr.email,
            "left": sdr.id in left,
            "calls": calls,
            "emails": emails,
            "research_notes": notes,
            "meetings": meetings,
            "leads_progressed": progressed,
            "calls_last_week": lw.get("calls", 0),
            "emails_last_week": lw.get("emails", 0),
            "research_notes_last_week": lw.get("research_notes", 0),
            "meetings_last_week": lw.get("meetings", 0),
            "total_activity": total_activity,
            "no_activity": total_activity == 0,
        })
    sdr_snapshot.sort(key=lambda x: x["total_activity"], reverse=True)
    lead_activity, lead_activity_total = daily_activity.lead_rows(db, events_today, {u.id: u for u in reps}, campaigns=lead_campaign)
    campaigns = daily_activity.campaign_rows(events_today, lead_campaign, funnel.NO_CAMPAIGN)
    touched, overdue = {}, {}
    for r in lead_activity:
        touched[r["rep_id"]] = touched.get(r["rep_id"], 0) + 1
        overdue[r["rep_id"]] = overdue.get(r["rep_id"], 0) + (r["follow_up"] == "Overdue")
    for row in sdr_snapshot:
        row["leads_touched"] = touched.get(row["user_id"], 0)
        row["overdue_follow_ups"] = overdue.get(row["user_id"], 0)
    lead_summary = {
        "total": lead_activity_total,
        "overdue": sum(r["follow_up"] == "Overdue" for r in lead_activity),
        "scheduled": sum(r["follow_up"] == "Scheduled" for r in lead_activity),
        "none_set": sum(r["follow_up"] == "None set" for r in lead_activity),
        "meetings": sum(r["meeting_booked"] for r in lead_activity),
    }
    idle_reps = [r["user_id"] for r in sdr_snapshot if r["no_activity"] and not r["left"]]
    attention = [a for a in (
        {"key": "idle_reps", "count": len(idle_reps), "label": "rep with no activity" if len(idle_reps) == 1 else "reps with no activity", "rep_ids": idle_reps},
        {"key": "overdue", "count": lead_summary["overdue"], "label": "lead with an overdue follow-up" if lead_summary["overdue"] == 1 else "leads with an overdue follow-up"},
        {"key": "stuck", "count": stuck_leads_count, "label": "lead stuck in Research/Calling for over 5 days" if stuck_leads_count == 1 else "leads stuck in Research/Calling for over 5 days"},
    ) if a["count"]]
    leads_touched_today = daily_activity.distinct_leads(events_today)
    leads_touched_compare = daily_activity.distinct_leads(events_compare)

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
            "message": "😶 No calling or pipeline activity recorded for this period"
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
            "emails_sent":      {"today": emails_today,         "compare": emails_compare,         "delta_pct": _delta_pct(emails_today, emails_compare)},
            "leads_touched":    {"today": leads_touched_today,  "compare": leads_touched_compare,  "delta_pct": _delta_pct(leads_touched_today, leads_touched_compare)},
            "research_notes":   {"today": notes_today,          "compare": notes_compare,          "delta_pct": _delta_pct(notes_today, notes_compare)},
            "meetings_booked":  {"today": meetings_today,       "compare": meetings_compare,       "delta_pct": _delta_pct(meetings_today, meetings_compare)},
            "pipeline_moved":   {"today": total_pipeline_moved, "compare": transitions_compare,    "delta_pct": _delta_pct(total_pipeline_moved, transitions_compare)},
            "leads_researched": {"today": researched_today,     "compare": researched_compare,     "delta_pct": _delta_pct(researched_today, researched_compare)},
            "demos_completed":  {"today": demos_today,          "compare": demos_compare,          "delta_pct": _delta_pct(demos_today, demos_compare)},
            "campaigns_sent":      {"today": campaigns_sent_today,     "compare": campaigns_sent_compare,     "delta_pct": _delta_pct(campaigns_sent_today, campaigns_sent_compare)},
            "cadence_enrollments": {"today": cadence_enrollments_today, "compare": cadence_enrollments_compare, "delta_pct": _delta_pct(cadence_enrollments_today, cadence_enrollments_compare)},
            **{key: {"today": fun_now[src], "compare": fun_cmp[src], "delta_pct": _delta_pct(fun_now[src], fun_cmp[src])}
               for key, src in (("conversations", "conversations"), ("meetings_held", "held"), ("no_shows", "no_show"),
                                ("sal_meetings", "sal"), ("accounts_given", "accounts"), ("contacts_given", "contacts"))},
        },
        "catalog": digest_metrics.catalog(),
        "default_kpis": digest_metrics.DEFAULT_KEYS,
        "campaigns": campaigns,
        "campaign_options": sorted({c for c in lead_campaign.values()} | {funnel.NO_CAMPAIGN}),
        "mode": w["mode"], "from": str(w["from_day"]), "to": str(w["to_day"]), "days": (w["to_day"] - w["from_day"]).days + 1,
        "compare_from": str(w["cmp_from"]), "compare_to": str(w["cmp_to"]), "compare_label": w["compare_label"],

        "pipeline_flow": sorted(pipeline_flow, key=lambda x: x["count"], reverse=True),
        "sdr_snapshot": sdr_snapshot,
        "lead_summary": lead_summary,
        "attention": attention,
        "_leads": lead_activity,          # cached with the digest, served paged by /daily-digest/leads and in full by the export
        "timezone": _tz or "UTC",
        "notable_events": notable_events,
        "status_snapshot": status_snapshot,
    }

    _cache_set(ckey, result)
    return result


def _public(d):
    return {k: v for k, v in d.items() if not k.startswith("_")}


@router.get("/daily-digest")
def get_daily_digest(
    date: Optional[str] = Query(None, description="One day, YYYY-MM-DD. Defaults to yesterday."),
    date_from: Optional[str] = Query(None, alias="from", description="Start of a range (with `to`), up to 92 days, all in the past."),
    date_to: Optional[str] = Query(None, alias="to"),
    pod_id: Optional[str] = Query(None, description="Super Admin only: limit the digest to one pod (a Pod Admin is always their own pod)."),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Team Digest — what a team lead asks for: calls, emails, research notes, meetings, campaigns, who was idle, which
    follow-ups are overdue. A day compares with the same weekday a week earlier; a range with the range right before it.
    Pod Admins are always their own pod. (URL kept as /daily-digest; the screen is now "Team Digest".)"""
    return _public(_load_digest(date, pod_id, admin, db, date_from, date_to))


@router.get("/daily-digest/leads")
def get_daily_digest_leads(
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    pod_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=5, le=50),
    rep_id: Optional[str] = Query(None),
    follow_up: Optional[str] = Query(None, description="Overdue | Scheduled | None set"),
    activity: Optional[str] = Query(None, description="calls | emails | notes | meetings"),
    q: Optional[str] = Query(None),
    campaign: Optional[str] = Query(None, description="One campaign tag, or 'No campaign'"),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """The lead-wise list for the digest period, filtered and paged on the server (overdue first, then meetings, then most worked)."""
    rows = daily_activity.filter_rows(_load_digest(date, pod_id, admin, db, date_from, date_to)["_leads"], rep_id, follow_up, activity, q, campaign)
    total = len(rows)
    return {"items": rows[(page - 1) * per_page: page * per_page], "total": total, "page": page,
            "per_page": per_page, "pages": max(1, -(-total // per_page))}


def _drill_scope(date, date_from, date_to, pod_id, admin, db):
    """Who and when a drill-down covers: the same reps, pod rule and team-local days as the Digest itself."""
    w = _resolve_window(date, date_from, date_to, datetime.now(timezone.utc).date())
    pod = access_db.pod_of(admin) if admin.get("role") == "Pod Admin" else (pod_id or None)
    tz = daily_activity.pod_timezone(db, pod) if pod else None
    q = db.query(models.User.id).filter(models.User.role.in_(["SDR", "AE"]))
    if pod:
        q = q.filter(models.User.pod_id == pod)
    start, end = funnel.window(w["from_day"], w["to_day"], tz)
    return [r[0] for r in q], start, end, get_conversation_min_seconds(db), tz, funnel.window(w["cmp_from"], w["cmp_to"], tz), w


_BASE = {}              # (reps, window) -> (expires, (events, leads)): the heavy part of a drill-down, kept for a few minutes
_BASE_KEEP, _BASE_TTL = 2, 120           # two windows, two minutes (about 20-35 MB at prod size, measured) - an unbounded cache here is what ran staging out of memory once


def _base_memo(key, make):
    now = time.time()
    hit = _BASE.get(key)
    if hit and hit[0] > now:
        return hit[1]
    val = make()
    _BASE[key] = (now + _BASE_TTL, val)
    for k in sorted(_BASE, key=lambda k: _BASE[k][0])[:-_BASE_KEEP]:
        del _BASE[k]
    return val


def _drilled(kind, dimension, scope, compare, build):
    """A finished drill-down for one period and set of reps, kept in the Digest's own 10-minute cache."""
    uids, start, end, min_s, _tz, _prev, _w = scope
    key = _cache_key("drill", kind, dimension, start.isoformat(), end.isoformat(), compare, min_s, hashlib.md5(",".join(sorted(uids)).encode()).hexdigest())
    hit = _cache_get(key)
    if hit is None:
        hit = build()
        _cache_set(key, hit)
    return hit


@router.get("/daily-digest/breakdown")
def get_digest_breakdown(
    dimension: str = Query("icp", description="icp | industry | country | city | seniority | function | company_size | source"),
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    pod_id: Optional[str] = Query(None),
    compare: bool = Query(True, description="Add the same segment's figures from the comparison period (the Digest's own)."),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """The period's activity grouped by who the lead is. Same reps, days and definitions as the Team Digest."""
    if dimension not in segments.DIMENSIONS:
        raise HTTPException(status_code=400, detail="Unknown breakdown: " + ", ".join(segments.DIMENSIONS))
    scope = _drill_scope(date, date_from, date_to, pod_id, admin, db)
    uids, start, end, min_s, _tz, prev, w = scope

    def build():
        out = segments.breakdown(db, uids, start, end, min_s, dimension, prev if compare else None, _base_memo)
        out["compare_label"] = w["compare_label"] if compare else None
        return out
    return _drilled("breakdown", dimension, scope, compare, build)


@router.get("/daily-digest/accounts")
def get_digest_accounts(
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    pod_id: Optional[str] = Query(None),
    stage: Optional[str] = Query(None, description="Only accounts at this stage: " + " | ".join(segments.STAGES)),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Companies worked in the period: how many people were tried, how many spoke, and where each stands."""
    if stage and stage not in segments.STAGES:
        raise HTTPException(status_code=400, detail="Unknown stage: " + ", ".join(segments.STAGES))
    scope = _drill_scope(date, date_from, date_to, pod_id, admin, db)
    uids, start, end, min_s, *_ = scope
    return _drilled("accounts", stage or "", scope, False, lambda: segments.accounts(db, uids, start, end, min_s, _base_memo, stage))


@router.get("/daily-digest/calls")
def get_digest_calls(
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    pod_id: Optional[str] = Query(None),
    tz: Optional[str] = Query(None, description="Time zone for the hour-by-hour view when no pod is chosen (the browser's); a pod uses its own."),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Call outcomes, the hours that connect, and how long conversations last."""
    scope = _drill_scope(date, date_from, date_to, pod_id, admin, db)
    uids, start, end, min_s, pod_tz, *_ = scope
    zone = pod_tz or segments.valid_zone(tz)
    return _drilled("calls", zone or "UTC", scope, False, lambda: segments.calls(db, uids, start, end, min_s, zone))

@router.get("/daily-digest/drilldown/leads")
def get_digest_drilldown_leads(
    dimension: Optional[str] = Query(None, description="With `segment`: the breakdown the row belongs to"),
    segment: Optional[str] = Query(None),
    account: Optional[str] = Query(None, description="An account key from the Accounts view"),
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    pod_id: Optional[str] = Query(None),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """The leads behind one row of a breakdown (or one account), with what was done on each in the period."""
    if account is None and (dimension not in segments.DIMENSIONS or segment is None):
        raise HTTPException(status_code=400, detail="Give a breakdown and a row, or an account.")
    scope = _drill_scope(date, date_from, date_to, pod_id, admin, db)
    uids, start, end, min_s, *_ = scope
    return segments.people(db, uids, start, end, min_s, _base_memo, dimension, segment, account)


class IcpBody(BaseModel):
    keywords: list


@router.get("/icp")
def get_icp(admin: dict = Depends(require_admin), db: Session = Depends(get_db)):
    """The words that make an industry part of the ideal customer profile (a lead's industry containing one counts as ICP)."""
    return {"keywords": segments.icp_keywords(db), "default": segments.DEFAULT_ICP}


@router.put("/icp")
def set_icp(body: IcpBody, admin: dict = Depends(require_super_admin), db: Session = Depends(get_db)):
    words = []
    for w in body.keywords:
        w = " ".join(str(w).split()).lower()
        if w and w not in words:
            words.append(w)
    if not words or len(words) > 30 or any(len(w) > 40 for w in words):
        raise HTTPException(status_code=400, detail="Give between 1 and 30 industry words, each up to 40 letters.")
    row = _get_or_create_sync_settings(db)
    before = segments.icp_keywords(db)
    row.icp_keywords = json.dumps(words)
    _cache_invalidate_prefix("drill:breakdown:icp:")        # the ICP words changed: any cached ICP breakdown is now wrong
    if words != before:
        audit.record(db, admin, "setting", "CHANGED", "Changed the ideal customer profile to: " + ", ".join(words), {"before": before, "after": words})
    db.commit()
    return {"keywords": words, "default": segments.DEFAULT_ICP}


@router.get("/daily-digest/drilldown.xlsx")
def export_digest_drilldown(
    dimension: str = Query("icp"),
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    pod_id: Optional[str] = Query(None),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """The drill-down as one Excel file: the chosen breakdown (with the comparison period), Accounts, and Calls - the same numbers as the screen."""
    import io
    import openpyxl
    from fastapi.responses import StreamingResponse
    from routes.export_routes import _cell

    if dimension not in segments.DIMENSIONS:
        raise HTTPException(status_code=400, detail="Unknown breakdown: " + ", ".join(segments.DIMENSIONS))
    uids, start, end, min_s, tz, prev, w = _drill_scope(date, date_from, date_to, pod_id, admin, db)
    check_export_access(db, admin, "/api/admin/analytics/daily-digest/drilldown.xlsx")      # after the input is valid: a bad request leaves no export record
    seg = segments.breakdown(db, uids, start, end, min_s, dimension, prev, _base_memo)
    acc = segments.accounts(db, uids, start, end, min_s, _base_memo)
    call = segments.calls(db, uids, start, end, min_s, tz)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Breakdown"
    ws.append(["Period", f"{w['from_day']} to {w['to_day']}", "Compared with", f"{w['cmp_from']} to {w['cmp_to']}", "Broken down by", seg["label"]])
    ws.append(["Leads with this filled in", f"{seg['coverage']['filled']} of {seg['coverage']['leads']} ({seg['coverage']['pct']}%)"])
    ws.append([])
    ws.append([seg["label"], "Leads", "Accounts", "Calls", "Conversations", "Connect %", "Emails", "Notes", "Booked", "Held", "No-show", "Leads spoken to",
               "Spoke to % of leads", "Booked per 100 conversations", "Held %", "No-show %",
               "Leads before", "Calls before", "Conversations before", "Booked before", "Calls change %", "Conversations change %", "Booked change %"])
    for r in seg["rows"] + [seg["total"]]:
        p, d = r.get("prev", {}), r.get("delta", {})
        ws.append([_cell(r["label"]), r["leads"], r["accounts"], r["calls"], r["conversations"], r["connect_rate"], r["emails"], r["notes"], r["booked"],
                   r["held"], r["no_show"], r["leads_spoken_to"], r["lead_to_conversation"], r["booked_per_100_conversations"], r["held_rate"],
                   r["no_show_rate"], p.get("leads"), p.get("calls"), p.get("conversations"), p.get("booked"), d.get("calls"), d.get("conversations"), d.get("booked")])
    if seg["more"]:
        ws.append([f"{seg['more']} smaller groups are not listed (top {len(seg['rows'])} shown)."])
    a = wb.create_sheet("Accounts")
    a.append(["Account", "People tried", "People spoke to", "Calls", "Conversations", "Emails", "Booked", "Held", "Where it stands"])
    for r in acc["rows"]:
        a.append([_cell(r["account"]), r["people_tried"], r["people_spoke"], r["calls"], r["conversations"], r["emails"], r["booked"], r["held"], r["stage"]])
    c = wb.create_sheet("Calls")
    c.append(["Calls", call["total"], "Conversations", call["conversations"], "Connect %", call["connect_rate"], "Time zone", call["timezone"]])
    c.append([])
    c.append(["Outcome", "Calls"])
    for o in call["outcomes"]:
        c.append([_cell(o["outcome"]), o["calls"]])
    c.append([])
    c.append(["Hour", "Calls", "Conversations", "Connect %"])
    for h in call["by_hour"]:
        c.append([f"{h['hour']:02d}:00", h["calls"], h["conversations"], h["connect_rate"]])
    c.append([])
    c.append(["Conversation length", "Conversations"])
    for b in call["conversation_lengths"]:
        c.append([b["band"], b["conversations"]])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="team-digest-drilldown-{w["from_day"]}-{w["to_day"]}.xlsx"'})


@router.get("/daily-digest/export.xlsx", dependencies=[Depends(require_export_access)])
def export_daily_digest(
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    pod_id: Optional[str] = Query(None),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """The whole digest as one Excel file: Summary (with last week), Team, Leads, Pipeline movement."""
    import io
    import openpyxl
    from fastapi.responses import StreamingResponse
    from routes.export_routes import _cell

    d = _load_digest(date, pod_id, admin, db, date_from, date_to)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Period", f"{d['from']} to {d['to']}" if d["days"] > 1 else d["digest_date"], "Compared with",
               f"{d['compare_from']} to {d['compare_to']}" if d["days"] > 1 else d["comparison_date"], "Time zone", d["timezone"]])
    ws.append([])
    ws.append(["Measure", "This period", f"Compared with {d['compare_label']}", "Change %"])
    labels = {c["key"]: c["label"] for c in d["catalog"]}
    for key, v in d["kpi"].items():
        ws.append([labels.get(key, key.replace("_", " ").capitalize()), v["today"], v["compare"], v["delta_pct"]])
    ws.append([])
    ws.append(["Needs attention"])
    for a in d["attention"]:
        ws.append([f"{a['count']} {a['label']}"])
    t = wb.create_sheet("Team")
    t.append(["Rep", "Calls", "Emails", "Research notes", "Meetings booked", "Leads touched", "Overdue follow-ups",
              "Leads progressed", "Calls before", "Emails before", "Research notes before", "Meetings before", "Left"])
    for r in d["sdr_snapshot"]:
        t.append([_cell(r["name"]), r["calls"], r["emails"], r["research_notes"], r["meetings"], r["leads_touched"],
                  r["overdue_follow_ups"], r["leads_progressed"], r["calls_last_week"], r["emails_last_week"],
                  r["research_notes_last_week"], r["meetings_last_week"], "Yes" if r["left"] else ""])
    cs = wb.create_sheet("Campaigns")
    cs.append(["Campaign", "Leads touched", "Calls", "Emails", "Notes", "Meetings booked"])
    for r in d["campaigns"]:
        cs.append([_cell(r["campaign"]), r["leads_touched"], r["calls"], r["emails"], r["notes"], r["meetings_booked"]])
    ls = wb.create_sheet("Leads")
    ls.append(["Rep", "Lead", "Company", "Campaign", "Status", "Calls", "Emails", "Notes", "Meeting booked", "Follow-up", "Next follow-up"])
    for r in d["_leads"]:
        ls.append([_cell(r["rep"]), _cell(r["lead"]), _cell(r["company"]), _cell(r.get("campaign", "")), r["status"], r["calls"], r["emails"], r["notes"],
                   "Yes" if r["meeting_booked"] else "", r["follow_up"], r["next_follow_up"] or ""])
    pf = wb.create_sheet("Pipeline movement")
    pf.append(["From", "To", "Leads"])
    for r in d["pipeline_flow"]:
        pf.append([r["from_status"], r["to_status"], r["count"]])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="team-digest-{d["from"]}-{d["to"]}.xlsx"' if d["days"] > 1 else f'attachment; filename="team-digest-{d["digest_date"]}.xlsx"'})
