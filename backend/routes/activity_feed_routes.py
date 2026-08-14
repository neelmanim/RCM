# ── routes/activity_feed_routes.py — Unified Activity Feed (Admin/Leadership) ─
"""
Activity Feed Route — /api/admin/activity-feed
===============================================
Aggregates calls, emails, status changes, and research events across all
leads into a paginated, filterable feed for Admin/Leadership view.
"""

import logging
import threading
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from database import get_db, SessionLocal
from auth import require_admin

from routes.call_routes import _is_signed_url_expired, _fetch_call_update_data, _apply_call_update_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Calls"])


@router.get("/admin/activity-feed")
def get_admin_activity_feed(
    page: int = 1,
    per_page: int = 25,
    type: str = "",          # "call" | "email" | "status" | "research" | "" (all)
    sdr: str = "",           # user_id filter
    pod_id: str = "",        # pod filter (Super Admin: explicit pod; overrides global_view)
    outcome: str = "",       # call outcome filter
    date_range: str = "7d",  # "today" | "yesterday" | "7d" | "30d" | "quarter" | "all"
    search: str = "",        # search by lead name / company
    upload_log_id: str = "", # batch filter (resolves to lead time window)
    global_view: bool = False,  # Pod Admin toggle: True = bypass pod scope
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Unified, paginated activity feed aggregating calls, emails, status changes,
    and research events across all leads. Admin-only; Pod Admin sees only their pod
    unless global_view=True. pod_id param (Super Admin feature) takes priority."""
    from datetime import date, timedelta

    try:
        return _build_activity_feed(db, user, page, per_page, type, sdr, pod_id, outcome, date_range, search, upload_log_id, global_view=global_view)
    except Exception as e:
        logger.exception("Activity feed error: %s", e)
        raise HTTPException(status_code=500, detail=f"Activity feed error: {str(e)}")


def _build_activity_feed(db, user, page, per_page, type, sdr, pod_id, outcome, date_range, search, upload_log_id="", global_view=False):
    from datetime import date, timedelta

    # ── Batch (upload_log_id) → lead time window ─────────────────────────
    batch_lead_window = None  # (window_start, window_end) or None
    if upload_log_id:
        try:
            batch = db.query(models.LeadUploadLog).filter(
                models.LeadUploadLog.id == upload_log_id
            ).first()
            if batch and batch.created_at:
                from datetime import timedelta as _td
                batch_lead_window = (
                    batch.created_at - _td(minutes=5),
                    batch.created_at + _td(hours=2),
                )
        except Exception:
            pass  # bad batch id — ignore filter

    # ── Date range filter ────────────────────────────────────────────────
    # When search is active, ignore date range to search across all time
    if search:
        date_from = None
    else:
        now = datetime.now(timezone.utc)
        date_from = None
        if date_range == "today":
            date_from = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
        elif date_range == "yesterday":
            yesterday = date.today() - timedelta(days=1)
            date_from = datetime.combine(yesterday, datetime.min.time()).replace(tzinfo=timezone.utc)
        elif date_range == "7d":
            date_from = now - timedelta(days=7)
        elif date_range == "30d":
            date_from = now - timedelta(days=30)
        elif date_range == "quarter":
            date_from = now - timedelta(days=90)
        # "all" → date_from stays None

    # ── Pod scoping for Pod Admin ────────────────────────────────────────
    user_role = user.get("role", "")
    pod_scope_ids = None  # None = no pod filter (Super Admin)
    if user_role == "Pod Admin" and not global_view:
        # Pod Admin scoped to their pod unless global_view bypasses it
        db_user = db.query(models.User).filter(models.User.id == user["sub"]).first()
        if db_user and db_user.pod_id:
            pod_scope_ids = [db_user.pod_id]
        else:
            pod_scope_ids = []  # no pod = no access
    # global_view=True for Pod Admin → pod_scope_ids stays None (all events)

    # pod_id URL param takes priority over global_view (edge case A-2)
    if pod_id:
        pod_scope_ids = [pod_id]

    # Get SDR user IDs in the scoped pod(s)
    pod_sdr_ids = None  # None = all SDRs
    if pod_scope_ids is not None:
        pod_sdrs = db.query(models.User.id).filter(
            models.User.pod_id.in_(pod_scope_ids)
        ).all()
        pod_sdr_ids = {u.id for u in pod_sdrs}

    # ── Pre-load user name map (kills N+1 queries for sdr_name lookups) ──
    all_users = db.query(models.User.id, models.User.name).all()
    user_map = {u.id: u.name for u in all_users}

    # ── Active dialer provider (for recording URL refresh) ─────────────
    import dialer_service as _ds
    _af_provider = _ds.get_active_provider(db)

    # ── Collect activities ───────────────────────────────────────────────
    activities = []

    # Helper: check if a lead matches search
    def _match_search(lead, q):
        if not q:
            return True
        q = q.lower()
        name = f"{lead.first_name or ''} {lead.last_name or ''}".lower()
        company = (lead.company or "").lower()
        return q in name or q in company

    # Helper: get lead's pod name
    pod_cache = {}
    def _pod_name(lead):
        if not lead.pod_id:
            return None
        if lead.pod_id not in pod_cache:
            pod = db.query(models.Pod).filter(models.Pod.id == lead.pod_id).first()
            pod_cache[lead.pod_id] = pod.name if pod else None
        return pod_cache[lead.pod_id]

    # 1️⃣ CALLS (manual CallLog + DialerCall)
    if type in ("", "call"):
        # Manual call logs
        call_q = db.query(models.CallLog).join(models.Lead).join(models.User, models.CallLog.user_id == models.User.id, isouter=True)
        # Cadence/Messaging Sandbox test leads must never appear in this admin-wide feed.
        call_q = call_q.filter(models.Lead.is_test.is_(False))
        if date_from:
            call_q = call_q.filter(models.CallLog.called_at >= date_from)
        if sdr:
            call_q = call_q.filter(models.CallLog.user_id == sdr)
        if pod_sdr_ids is not None:
            call_q = call_q.filter(models.CallLog.user_id.in_(pod_sdr_ids))
        if outcome:
            call_q = call_q.filter(models.CallLog.outcome == outcome)
        if batch_lead_window:
            call_q = call_q.filter(
                models.Lead.created_at >= batch_lead_window[0],
                models.Lead.created_at <= batch_lead_window[1],
                models.Lead.lead_source == "uploaded",
            )

        # Hard cap: fetch only the most recent 500 rows; we only show 25/page.
        # ORDER BY pushes date sort to DB so Python sort is over ≤500 rows.
        for c in call_q.order_by(models.CallLog.called_at.desc()).limit(500).all():
            if search and not _match_search(c.lead, search):
                continue
            activities.append({
                "type": "call",
                "timestamp": c.called_at.isoformat() if c.called_at else None,
                "_sort_ts": c.called_at,
                "lead_id": c.lead_id,
                "lead_name": f"{c.lead.first_name or ''} {c.lead.last_name or ''}".strip(),
                "lead_title": c.lead.title,
                "lead_status": c.lead.status,
                "company": c.lead.company,
                "pod_name": _pod_name(c.lead),
                "sdr_id": c.user_id,
                "sdr_name": user_map.get(c.user_id) or "Unknown",
                "outcome": c.outcome if isinstance(c.outcome, str) else (c.outcome.value if c.outcome else None),
                "notes": c.notes,
                "duration": 0,
                "recording_url": None,
                "transcript": None,
                "research_hook": c.lead.research_hook,
                "research_hypothesis": c.lead.research_hypothesis,
                "research_personalization": c.lead.research_personalization,
            })

        # Dialer calls (lead_id is nullable, use outerjoin)
        dialer_q = db.query(models.DialerCall).join(
            models.Lead, models.DialerCall.lead_id == models.Lead.id, isouter=True
        ).filter(
            models.DialerCall.lead_id.isnot(None),
            models.DialerCall.status != "FAILED",
            models.Lead.is_test.is_(False),
        )
        if date_from:
            dialer_q = dialer_q.filter(
                models.dialer_call_event_time() >= date_from
            )
        if sdr:
            dialer_q = dialer_q.filter(models.DialerCall.user_id == sdr)
        if pod_sdr_ids is not None:
            dialer_q = dialer_q.filter(models.DialerCall.user_id.in_(pod_sdr_ids))
        if outcome:
            dialer_q = dialer_q.filter(models.DialerCall.outcome == outcome)
        if batch_lead_window:
            dialer_q = dialer_q.filter(
                models.Lead.created_at >= batch_lead_window[0],
                models.Lead.created_at <= batch_lead_window[1],
                models.Lead.lead_source == "uploaded",
            )

        # Fetch only recent 500 rows; refresh expired URLs in background after.
        _dialer_rows = dialer_q.order_by(models.dialer_call_event_time().desc()).limit(500).all()

        # Background-refresh any expired recording URLs (non-blocking)
        _calls_to_refresh = [c for c in _dialer_rows if c.recording_url and _is_signed_url_expired(c.recording_url)]
        if _calls_to_refresh and _af_provider:
            def _bg_refresh_urls(calls, provider):
                # RCA 2026-07-27: this used to hold one DB session (a pooled
                # connection) for the whole batch while calling the provider API
                # for each call — RCM's 502-retry backoff can take several
                # seconds per call, so during a RCM brownout this tied up
                # a connection for the entire batch and starved the pool enough
                # to make unrelated requests (e.g. dashboard-stats) time out.
                # Fetch everything first with no DB session open, then write
                # results in one short-lived session.
                updates = {}
                for _c in calls:
                    data = _fetch_call_update_data(_c, provider)
                    if data:
                        updates[_c.id] = data
                if not updates:
                    return
                bg_db = SessionLocal()
                try:
                    for call_id, data in updates.items():
                        _fresh = bg_db.query(models.DialerCall).filter(models.DialerCall.id == call_id).first()
                        if _fresh:
                            _apply_call_update_data(_fresh, data, bg_db)
                finally:
                    bg_db.close()
            threading.Thread(target=_bg_refresh_urls, args=(_calls_to_refresh, _af_provider), daemon=True).start()

        for c in _dialer_rows:
            if search and not _match_search(c.lead, search):
                continue
            sdr_name = user_map.get(c.user_id) or "Unknown"
            ts = c.started_at or c.created_at
            activities.append({
                "type": "call",
                "id": c.id,
                "timestamp": ts.isoformat() if ts else None,
                "_sort_ts": ts,
                "lead_id": c.lead_id,
                "lead_name": f"{c.lead.first_name or ''} {c.lead.last_name or ''}".strip(),
                "lead_title": c.lead.title,
                "lead_status": c.lead.status,
                "company": c.lead.company,
                "pod_name": _pod_name(c.lead),
                "sdr_id": c.user_id,
                "sdr_name": sdr_name,
                "outcome": c.outcome,
                "notes": c.notes,
                "duration": c.duration or 0,
                "recording_url": c.recording_url,
                "transcript": c.transcript,
                "research_hook": c.lead.research_hook,
                "research_hypothesis": c.lead.research_hypothesis,
                "research_personalization": c.lead.research_personalization,
            })

    # 2️⃣ EMAILS
    if type in ("", "email"):
        email_q = db.query(models.LeadEmailActivity).join(
            models.Lead, models.LeadEmailActivity.lead_id == models.Lead.id, isouter=True
        ).filter(
            models.LeadEmailActivity.lead_id.isnot(None),
            models.Lead.is_test.is_(False),
        )
        if date_from:
            email_q = email_q.filter(models.LeadEmailActivity.timestamp >= date_from)
        if sdr:
            email_q = email_q.filter(models.LeadEmailActivity.user_id == sdr)
        if pod_sdr_ids is not None:
            email_q = email_q.filter(models.LeadEmailActivity.user_id.in_(pod_sdr_ids))
        if batch_lead_window:
            email_q = email_q.filter(
                models.Lead.created_at >= batch_lead_window[0],
                models.Lead.created_at <= batch_lead_window[1],
                models.Lead.lead_source == "uploaded",
            )

        for e in email_q.order_by(models.LeadEmailActivity.timestamp.desc()).limit(500).all():
            if search and not _match_search(e.lead, search):
                continue
            sdr_name = user_map.get(e.user_id) or "System"
            activities.append({
                "type": "email",
                "timestamp": e.timestamp.isoformat() if e.timestamp else None,
                "_sort_ts": e.timestamp,
                "lead_id": e.lead_id,
                "lead_name": f"{e.lead.first_name or ''} {e.lead.last_name or ''}".strip(),
                "lead_title": e.lead.title,
                "lead_status": e.lead.status,
                "company": e.lead.company,
                "pod_name": _pod_name(e.lead),
                "sdr_id": e.user_id,
                "sdr_name": sdr_name or "System",
                "outcome": f"Email {'Sent' if e.direction == 'outbound' else 'Received'}",
                "notes": None,
                "subject": e.subject,
                "body_preview": e.body_preview,
                "direction": e.direction,
                "open_count": e.open_count or 0,
                "research_hook": e.lead.research_hook,
            })

    # 3️⃣ STATUS CHANGES
    if type in ("", "status"):
        status_q = db.query(models.LeadStatusLog).join(models.Lead)
        # Cadence/Messaging Sandbox test leads must never appear in this admin-wide feed.
        status_q = status_q.filter(models.Lead.is_test.is_(False))
        if date_from:
            status_q = status_q.filter(models.LeadStatusLog.changed_at >= date_from)
        # Push pod/sdr scoping into DB (was post-filter in Python — loaded all rows)
        if sdr:
            # Filter by leads assigned to this SDR (via lead assignment table)
            from sqlalchemy import exists
            status_q = status_q.filter(
                exists().where(
                    (models.lead_assignments.c.lead_id == models.LeadStatusLog.lead_id) &
                    (models.lead_assignments.c.user_id == sdr)
                )
            )
        elif pod_sdr_ids is not None:
            from sqlalchemy import exists
            status_q = status_q.filter(
                exists().where(
                    (models.lead_assignments.c.lead_id == models.LeadStatusLog.lead_id) &
                    (models.lead_assignments.c.user_id.in_(pod_sdr_ids))
                )
            )

        # Pre-fetch lead→sdr mapping for this batch to avoid assigned_users N+1
        if batch_lead_window:
            status_q = status_q.filter(
                models.Lead.created_at >= batch_lead_window[0],
                models.Lead.created_at <= batch_lead_window[1],
                models.Lead.lead_source == "uploaded",
            )
        _status_rows = status_q.order_by(models.LeadStatusLog.changed_at.desc()).limit(500).all()
        _lead_ids_s = [s.lead_id for s in _status_rows]
        _lead_sdr_map = {}  # lead_id -> (sdr_id, sdr_name)
        if _lead_ids_s:
            # Plain ORM .in_() rather than raw "IN :ids" text() — a text()
            # bindparam isn't expanding by default, so passing a tuple
            # compiles to invalid "IN ?" SQL on SQLite (pre-existing bug,
            # just never exercised by a prior test with real status-log rows).
            _assignments = db.query(
                models.lead_assignments.c.lead_id, models.lead_assignments.c.user_id
            ).filter(models.lead_assignments.c.lead_id.in_(_lead_ids_s)).all()
            for row in _assignments:
                if row.lead_id not in _lead_sdr_map:
                    _lead_sdr_map[row.lead_id] = (row.user_id, user_map.get(row.user_id, "System"))

        for s in _status_rows:
            if search and not _match_search(s.lead, search):
                continue
            sdr_id, _sdr_name = _lead_sdr_map.get(s.lead_id, (None, s.changed_by or "System"))
            sdr_name = s.changed_by or _sdr_name
            activities.append({
                "type": "status",
                "timestamp": s.changed_at.isoformat() if s.changed_at else None,
                "_sort_ts": s.changed_at,
                "lead_id": s.lead_id,
                "lead_name": f"{s.lead.first_name or ''} {s.lead.last_name or ''}".strip(),
                "lead_title": s.lead.title,
                "lead_status": s.lead.status,
                "company": s.lead.company,
                "pod_name": _pod_name(s.lead),
                "sdr_id": sdr_id,
                "sdr_name": sdr_name,
                "outcome": f"{s.from_status or 'New'} → {s.to_status}",
                "from_status": s.from_status,
                "to_status": s.to_status,
                "research_hook": None,
            })

    # 4️⃣ RESEARCH (leads with research completed recently)
    if type in ("", "research"):
        # Research doesn't have its own log table — use leads that have research data
        # and were updated recently. We use status_changed_at as a proxy.
        research_q = db.query(models.Lead).filter(
            models.Lead.research_hypothesis.isnot(None),
            models.Lead.research_hypothesis != "",
            models.Lead.is_test.is_(False),
        )
        if date_from:
            research_q = research_q.filter(models.Lead.status_changed_at >= date_from)
        # Push pod/sdr scoping into DB
        if sdr or pod_sdr_ids is not None:
            from sqlalchemy import exists
            sdr_filter_ids = [sdr] if sdr else list(pod_sdr_ids)
            if sdr_filter_ids:
                research_q = research_q.filter(
                    exists().where(
                        (models.lead_assignments.c.lead_id == models.Lead.id) &
                        (models.lead_assignments.c.user_id.in_(sdr_filter_ids))
                    )
                )

        if batch_lead_window:
            research_q = research_q.filter(
                models.Lead.created_at >= batch_lead_window[0],
                models.Lead.created_at <= batch_lead_window[1],
                models.Lead.lead_source == "uploaded",
            )
        _research_rows = research_q.order_by(models.Lead.status_changed_at.desc()).limit(300).all()
        _lead_ids_r = [lead.id for lead in _research_rows]
        _research_sdr_map = {}
        if _lead_ids_r:
            # Plain ORM .in_() — see the same fix above for why raw "IN :ids" broke.
            _r_assignments = db.query(
                models.lead_assignments.c.lead_id, models.lead_assignments.c.user_id
            ).filter(models.lead_assignments.c.lead_id.in_(_lead_ids_r)).all()
            for row in _r_assignments:
                if row.lead_id not in _research_sdr_map:
                    _research_sdr_map[row.lead_id] = (row.user_id, user_map.get(row.user_id, "AI Research"))

        for lead in _research_rows:
            if search and not _match_search(lead, search):
                continue
            sdr_id, sdr_name = _research_sdr_map.get(lead.id, (None, "AI Research"))
            activities.append({
                "type": "research",
                "timestamp": lead.status_changed_at.isoformat() if lead.status_changed_at else None,
                "_sort_ts": lead.status_changed_at,
                "lead_id": lead.id,
                "lead_name": f"{lead.first_name or ''} {lead.last_name or ''}".strip(),
                "lead_title": lead.title,
                "lead_status": lead.status,
                "company": lead.company,
                "pod_name": _pod_name(lead),
                "sdr_id": sdr_id,
                "sdr_name": sdr_name or "AI Research",
                "outcome": "Research Complete",
                "research_company": lead.research_company,
                "research_hook": lead.research_hook,
                "research_hypothesis": lead.research_hypothesis,
                "research_personalization": lead.research_personalization,
            })

    # ── Sort all activities by timestamp descending ──────────────────────
    _epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    def _sort_key(x):
        ts = x.get("_sort_ts")
        if ts is None:
            return _epoch
        # Normalize naive datetimes to UTC-aware
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts
    activities.sort(key=_sort_key, reverse=True)

    # Remove internal sort key
    for a in activities:
        a.pop("_sort_ts", None)

    # ── Compute summary stats (BEFORE dedup, so counts are accurate) ─────
    type_counts = {}
    meetings_booked = 0
    total_calls = 0
    connected_calls = 0
    total_emails = 0
    for a in activities:
        t = a.get("type", "other")
        type_counts[t] = type_counts.get(t, 0) + 1
        if t == "call":
            total_calls += 1
            if a.get("outcome") in ("Meeting Scheduled", "Meeting Confirmed",
                                     "Call Back Later", "Text Me",
                                     "Not the Right Person", "Referred Someone Else"):
                connected_calls += 1
            if a.get("outcome") in ("Meeting Scheduled", "Meeting Confirmed"):
                meetings_booked += 1
        elif t == "email":
            total_emails += 1

    connect_rate = round((connected_calls / total_calls * 100), 1) if total_calls else 0

    # ── Deduplicate: keep only latest activity per lead per type ─────────
    seen = set()
    deduped = []
    for a in activities:
        key = (a.get("lead_id"), a.get("type"))
        if key not in seen:
            seen.add(key)
            deduped.append(a)
    activities = deduped

    # Stats already computed above (pre-dedup)
    total_count = len(activities)  # count after dedup (for pagination)

    # ── Paginate ─────────────────────────────────────────────────────────
    start = (page - 1) * per_page
    end = start + per_page
    page_data = activities[start:end]
    total_pages = max(1, -(-total_count // per_page))  # ceil division

    return {
        "data": page_data,
        "total": total_count,
        "page": page,
        "per_page": per_page,
        "pages": total_pages,
        "stats": {
            "total_activities": total_count,
            "meetings_booked": meetings_booked,
            "connect_rate": connect_rate,
            "total_emails": total_emails,
            "type_counts": type_counts,
        },
    }
