# ── report_service.py — Automated Analytics reports ─────────────────────────
"""
v11.4.0: multi-report engine replacing the single org-wide schedule v11.3.0
shipped for one day. A ReportConfig is a named, saved report with its own
filters, component list, schedule, timezone, and recipients. Both the
scheduler (scheduled_jobs.py) and "Run Now" (routes/report_routes.py) call
the SAME execute_report() — one pipeline, no separate code paths to drift
apart. Sends via the same Nylas mailbox path Email Hub already uses.

Component registry (COMPONENTS): each entry's builder(db, report, start, end)
returns (title, html_fragment, csv_rows, has_data). New components register
here — the builder UI and the email renderer both introspect this dict, so
there's exactly one list to keep in sync, not two.
"""
from auth import export_allowed_for_user_id
import calendar
import csv
import io
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from sqlalchemy import func, case, and_

import models
from crypto import decrypt_token
from routes.analytics_routes import MEETING_REACHED_STATUSES, DISQUALIFIED_STATUSES, _lead_closed_date_expr

logger = logging.getLogger(__name__)

NYLAS_API_BASE = "https://api.us.nylas.com"

DATE_RANGE_RULES = ("previous_1_day", "previous_7_days", "previous_calendar_month", "custom")
FREQUENCIES = ("daily", "weekly", "monthly")


# ─── Timezone / date-range resolution ────────────────────────────────────────

def _tz(tz_name):
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def clamp_day_of_month(day, year, month):
    """Handles §6/§7's Feb-31 edge case: run on the last real day of a
    shorter month instead of erroring or silently skipping."""
    return min(day, calendar.monthrange(year, month)[1])


def resolve_date_range(rule, tz_name, now_utc):
    """A RULE ("previous_7_days"), resolved into an actual (start, end) UTC
    pair anchored to `now_utc` in the report's own timezone. Only the rule is
    stored on ReportConfig — the resolved period is written to
    ReportExecution so historical sends stay auditable as the rule keeps
    resolving to a different window every time it runs. Does not handle
    "custom" — the caller uses ReportConfig.custom_start/custom_end directly
    for that, since there's nothing to resolve."""
    tz = _tz(tz_name)
    local_now = now_utc.astimezone(tz)
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    if rule == "previous_1_day":
        end, start = local_midnight, local_midnight - timedelta(days=1)
    elif rule == "previous_calendar_month":
        first_of_this_month = local_midnight.replace(day=1)
        end = first_of_this_month
        start = (first_of_this_month.replace(year=first_of_this_month.year - 1, month=12)
                 if first_of_this_month.month == 1
                 else first_of_this_month.replace(month=first_of_this_month.month - 1))
    else:  # previous_7_days (default)
        end, start = local_midnight, local_midnight - timedelta(days=7)

    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _local_now(report, now_utc):
    return now_utc.astimezone(_tz(report.timezone))


def is_due(report, now_utc):
    """Checked every 15 min by the scheduler tick (see scheduled_jobs.py) —
    same 'has today's/this-week's/this-month's local send time passed, and
    have we not already sent since then' pattern _salesforce_auto_sync_job
    uses; no cron dependency in this codebase."""
    local_now = _local_now(report, now_utc)
    if report.frequency == "weekly" and local_now.weekday() != (report.weekday or 0):
        return False
    if report.frequency == "monthly":
        target_day = clamp_day_of_month(report.day_of_month or 1, local_now.year, local_now.month)
        if local_now.day != target_day:
            return False

    scheduled_local = local_now.replace(hour=report.send_hour, minute=report.send_minute or 0, second=0, microsecond=0)
    if local_now < scheduled_local:
        return False

    scheduled_utc = scheduled_local.astimezone(timezone.utc)
    last_run = report.last_run_at
    if last_run:
        if last_run.tzinfo is None:
            last_run = last_run.replace(tzinfo=timezone.utc)
        if last_run >= scheduled_utc:
            return False
    return True


def next_run_at(report, now_utc=None):
    """Best-effort next send time, for display only (My Reports list's
    "Next run" column) — walks forward up to 40 days to cover every
    monthly edge case. is_due() above, not this, is authoritative for
    whether the scheduler actually sends."""
    now_utc = now_utc or datetime.now(timezone.utc)
    local_now = _local_now(report, now_utc)
    candidate = local_now.replace(hour=report.send_hour, minute=report.send_minute or 0, second=0, microsecond=0)
    if candidate <= local_now:
        candidate += timedelta(days=1)
    for _ in range(40):
        if report.frequency == "daily":
            break
        if report.frequency == "weekly" and candidate.weekday() == (report.weekday or 0):
            break
        if report.frequency == "monthly" and candidate.day == clamp_day_of_month(report.day_of_month or 1, candidate.year, candidate.month):
            break
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc)


# ─── Component registry ──────────────────────────────────────────────────────

def _sdr_qualified_disqualified_rows(db, report, start, end):
    # Phase 2 fix: was Lead.lead_closed_at.between(start, end) with no
    # fallback — an accidental partial copy of the Dashboard snapshot query
    # (_compute_meetings_booked_snapshot/_compute_disqualified_snapshot,
    # analytics_routes.py), missing the COALESCE(lead_closed_at,
    # status_changed_at) those use. A lead whose lead_closed_at was never
    # backfilled (historical rows, or any path predating that write) silently
    # vanished from this report while still counting on the Dashboard funnel
    # for the same period. Reusing _lead_closed_date_expr() closes that gap —
    # same status lists as before, same snapshot business meaning, just the
    # same date fallback every other Qualified/Disqualified count already uses.
    _close_date = _lead_closed_date_expr()
    q = (
        db.query(
            models.User.id,
            models.User.name,
            func.count(case((
                and_(models.Lead.status.in_(MEETING_REACHED_STATUSES), _close_date.between(start, end)),
                models.Lead.id
            ))).label("qualified"),
            func.count(case((
                and_(models.Lead.status.in_(DISQUALIFIED_STATUSES), _close_date.between(start, end)),
                models.Lead.id
            ))).label("disqualified"),
        )
        .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id)
        .join(models.User, models.User.id == models.lead_assignments.c.user_id)
    )
    if report.pod_id:
        q = q.filter(models.User.pod_id == report.pod_id)
    if report.sdr_id:
        q = q.filter(models.User.id == report.sdr_id)
    if report.upload_log_id:
        q = q.filter(models.Lead.upload_log_id == report.upload_log_id)
    q = models.exclude_test_and_deleted_leads(q)

    # RCA 2026-08-18: no longer skips zero-qualified/disqualified rows here —
    # an SDR with real calls but no qualifying outcome yet would otherwise
    # vanish from the table entirely. _build_sdr_performance applies the one
    # combined "any activity at all" filter after merging in call counts.
    return {
        uid: {"sdr_name": name or "Unknown", "qualified": qualified or 0, "disqualified": disqualified or 0}
        for uid, name, qualified, disqualified in q.group_by(models.User.id, models.User.name).all()
    }


_RELEASE_MD_RE = re.compile(r'\*\*(.+?)\*\*')
_RELEASE_CODE_RE = re.compile(r'`(.+?)`')


def _release_md_to_html(text):
    """Minimal **bold**/`code` -> HTML, same two tokens (and nothing more)
    that frontend-react/src/features/help-hub/markdown.jsx's
    renderInlineMarkdown supports for this exact same release-note content —
    kept in sync by convention (there's no shared code path between an
    email-sending Python service and a React component), not by import."""
    text = _RELEASE_MD_RE.sub(r'<strong>\1</strong>', text)
    text = _RELEASE_CODE_RE.sub(r'<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;">\1</code>', text)
    return text


def _build_release_digest(db, report, start, end):
    """v11.5.6: weekly "what shipped" digest — feedback was that release
    notes get written every week but nobody's ever told a week's worth
    happened. Auto-picked strictly by date from the same releases.json the
    in-app Help & User Guide already reads (see help-hub/data/releases.json)
    — no separate curation step to forget. An entry with `items` (i.e. not
    tagged kind:"minor") gets the full write-up as a "hero"; a `summary`-
    only entry gets one compact line — the exact same full-card/one-liner
    split ReleaseNotesSection.jsx already uses in-app (see its RCA
    2026-08-19 fix: branch on `items` presence, not the `kind` string)."""
    releases_path = os.path.join(
        os.path.dirname(__file__), "..", "frontend-react", "src",
        "features", "help-hub", "data", "releases.json",
    )
    try:
        with open(releases_path) as f:
            releases = json.load(f)
    except Exception as e:
        logger.error(f"[ReleaseDigest] Failed to read releases.json: {e}")
        return "What Shipped This Week", '<p style="margin:0;color:#999;">Release notes unavailable.</p>', [], False

    start_date, end_date = start.date(), end.date()

    def _parse_release_date(s):
        try:
            return datetime.strptime(s, "%d %b %Y").date()
        except (ValueError, TypeError):
            return None

    in_range = []
    for e in releases:
        d = _parse_release_date(e.get("date", ""))
        if d and start_date <= d <= end_date:
            in_range.append(e)
    has_data = bool(in_range)

    hero_html, minor_lines = "", []
    for entry in in_range:
        version = entry.get("version", "")
        if entry.get("items"):
            title = entry.get("title")
            items_html = "".join(f'<li style="margin-bottom:4px;">{_release_md_to_html(i)}</li>' for i in entry["items"])
            hero_html += (
                '<div style="margin-bottom:14px;padding:12px 16px;background:#f8fafc;'
                'border-radius:8px;border:1px solid #e2e8f0;">'
                f'<strong>{version}</strong>{f" — {title}" if title else ""}'
                f'<ul style="margin:8px 0 0;padding-left:18px;">{items_html}</ul></div>'
            )
        else:
            minor_lines.append(
                f'<li style="margin-bottom:4px;"><strong>{version}</strong> — {_release_md_to_html(entry.get("summary", ""))}</li>'
            )
    minor_html = f'<ul style="margin:8px 0 0;padding-left:18px;color:#555;">{"".join(minor_lines)}</ul>' if minor_lines else ""

    fe_url = os.getenv("FRONTEND_URL", "").strip()
    help_link = f'{fe_url}/index.html#user-guide' if fe_url else None

    body = hero_html + minor_html if has_data else '<p style="margin:0;color:#999;">Nothing shipped this period.</p>'
    link_html = f'<p style="margin:12px 0 0;"><a href="{help_link}">See full details in the Help &amp; User Guide →</a></p>' if (has_data and help_link) else ""
    html = (
        '<div style="margin:0 0 20px;">'
        '<h3 style="margin:0 0 8px;font-size:15px;">What Shipped This Week</h3>'
        f'{body}{link_html}</div>'
    )

    csv_rows = [
        {"version": e.get("version", ""), "date": e.get("date", ""),
         "summary": e.get("summary") or e.get("title") or ""}
        for e in in_range
    ]
    return "What Shipped This Week", html, csv_rows, has_data


def _build_key_metrics(db, report, start, end):
    from routes.analytics_routes import _compute_sdr_rows
    rows = _compute_sdr_rows(
        db, report.pod_id, start.date().isoformat(), end.date().isoformat(), None,
        report.upload_log_id, effective_sdr=report.sdr_id,
    )
    leads_assigned = sum(r["leads_assigned"] for r in rows)
    calls_made = sum(r["calls_made"] for r in rows)
    calls_connected = sum(r["calls_connected"] for r in rows)
    meetings = sum(r["meetings"] for r in rows)
    connect_rate = round(calls_connected / calls_made * 100, 1) if calls_made else None
    has_data = bool(leads_assigned or calls_made or meetings)

    html = (
        '<div style="margin:0 0 20px;">'
        '<h3 style="margin:0 0 8px;font-size:15px;">Key Metrics</h3>'
        f'<p style="margin:0;">{leads_assigned} leads assigned &middot; {calls_made} calls made &middot; '
        f'{connect_rate if connect_rate is not None else "—"}% connect rate &middot; {meetings} meetings</p>'
        '</div>'
    )
    csv_rows = [
        {"metric": "Leads Assigned", "value": leads_assigned},
        {"metric": "Calls Made", "value": calls_made},
        {"metric": "Connect Rate %", "value": connect_rate if connect_rate is not None else ""},
        {"metric": "Meetings", "value": meetings},
    ]
    return "Key Metrics", html, csv_rows, has_data


def _build_sdr_performance(db, report, start, end):
    # RCA 2026-08-18 (customer-reported): this table only ever showed
    # Qualified/Disqualified — the exact complaint was "where's the calling
    # data: how many calls, how many meetings, per SDR." That data was already
    # being computed (and summed org-wide) one function above in
    # _build_key_metrics — reuse the same call instead of a second query.
    from routes.analytics_routes import _compute_sdr_rows
    call_rows = _compute_sdr_rows(
        db, report.pod_id, start.date().isoformat(), end.date().isoformat(), None,
        report.upload_log_id, effective_sdr=report.sdr_id,
    )
    qd = _sdr_qualified_disqualified_rows(db, report, start, end)

    merged = {}
    for r in call_rows:
        merged[r["sdr_id"]] = {
            "sdr_name": r["sdr_name"], "calls_made": r["calls_made"],
            "connect_rate": r["connect_rate"], "conversations": r["conversations"],
            "meetings": r["meetings"], "qualified": 0, "disqualified": 0,
        }
    for uid, q in qd.items():
        merged.setdefault(uid, {
            "sdr_name": q["sdr_name"], "calls_made": 0, "connect_rate": None, "conversations": 0,
            "meetings": 0, "qualified": 0, "disqualified": 0,
        })
        merged[uid]["qualified"] = q["qualified"]
        merged[uid]["disqualified"] = q["disqualified"]

    rows = [
        {"sdr_id": uid, **r} for uid, r in merged.items()
        if r["calls_made"] or r["meetings"] or r["qualified"] or r["disqualified"]  # skip the noise, not the signal
    ]
    rows.sort(key=lambda r: r["calls_made"], reverse=True)

    def _pct(v):
        return f'{v}%' if v is not None else '—'

    table_rows = "".join(
        f'<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">{r["sdr_name"]}</td>'
        f'<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">{r["calls_made"]}</td>'
        f'<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">{_pct(r["connect_rate"])}</td>'
        f'<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">{r["conversations"]}</td>'
        f'<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">{r["meetings"]}</td>'
        f'<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">{r["qualified"]}</td>'
        f'<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">{r["disqualified"]}</td></tr>'
        for r in rows
    ) or '<tr><td colspan="7" style="padding:12px;color:#999;">No activity this period.</td></tr>'
    html = (
        '<div style="margin:0 0 20px;">'
        '<h3 style="margin:0 0 8px;font-size:15px;">SDR Performance</h3>'
        '<table style="border-collapse:collapse;width:100%;max-width:560px;">'
        '<tr><th style="text-align:left;padding:6px 12px;border-bottom:2px solid #ccc;">SDR</th>'
        '<th style="text-align:right;padding:6px 12px;border-bottom:2px solid #ccc;">Calls Made</th>'
        '<th style="text-align:right;padding:6px 12px;border-bottom:2px solid #ccc;">Connect Rate</th>'
        '<th style="text-align:right;padding:6px 12px;border-bottom:2px solid #ccc;">Conversations</th>'
        '<th style="text-align:right;padding:6px 12px;border-bottom:2px solid #ccc;">Meetings</th>'
        '<th style="text-align:right;padding:6px 12px;border-bottom:2px solid #ccc;">Qualified</th>'
        '<th style="text-align:right;padding:6px 12px;border-bottom:2px solid #ccc;">Disqualified</th></tr>'
        f'{table_rows}</table></div>'
    )
    return "SDR Performance", html, rows, bool(rows)


COMPONENTS = {
    "key_metrics": {
        "label": "Key Metrics",
        "description": "Leads assigned, calls made, connect rate, and meetings for the period.",
        "builder": _build_key_metrics,
    },
    "sdr_performance": {
        "label": "SDR Performance",
        "description": "Calls, connect rate, conversations, meetings, qualified and disqualified per SDR.",
        "builder": _build_sdr_performance,
    },
    "release_digest": {
        "label": "What Shipped This Week",
        "description": "Auto-picked from the release notes for the report's date range — bigger items get the full write-up, small fixes get one line, with a link to the full Help & User Guide.",
        "builder": _build_release_digest,
    },
}


# ─── Content + CSV rendering ──────────────────────────────────────────────────

def _render_csv(sections):
    """One CSV, sections clearly separated by a title row + blank row —
    chosen over a single flat table since components have unrelated
    columns (§25); simplest of the two acceptable shapes."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    for title, rows in sections:
        writer.writerow([title])
        if rows:
            writer.writerow(list(rows[0].keys()))
            for r in rows:
                writer.writerow(list(r.values()))
        writer.writerow([])
    return buf.getvalue()


def build_report_content(db, report, component_ids, start, end):
    period_label = f"{start.strftime('%b %d')} – {end.strftime('%b %d, %Y')}"
    sections_html = []
    csv_sections = []
    any_data = False

    for cid in component_ids:
        comp = COMPONENTS.get(cid)
        if not comp:
            continue
        title, html_fragment, rows, has_data = comp["builder"](db, report, start, end)
        any_data = any_data or has_data
        sections_html.append(html_fragment)
        if rows:
            csv_sections.append((title, rows))

    body = f'<h2 style="margin:0 0 4px;">{report.name}</h2><p style="margin:0 0 16px;color:#666;">{period_label}</p>'
    if not any_data:
        body += '<p style="margin:0 0 16px;color:#999;">No activity found for this period.</p>'
    body += "".join(sections_html)

    csv_text = _render_csv(csv_sections) if csv_sections else None
    return body, csv_text


# ─── Delivery ─────────────────────────────────────────────────────────────────

def send_report_email(db, sender_user_id, to_list, html_body, subject, cc=None, bcc=None, csv_attachment=None):
    """Sync send (runs outside any FastAPI request/event loop, so a plain
    `requests` call is used here instead of email_routes.py's async httpx
    one) — same Nylas send shape, now with cc/bcc and an optional CSV."""
    mailbox = db.query(models.UserMailbox).filter(
        models.UserMailbox.user_id == sender_user_id,
        models.UserMailbox.status == "connected",
    ).first()
    if not mailbox:
        logger.warning(f"[ReportExecution] Sender {sender_user_id} has no connected mailbox — skipped")
        return False

    config = db.query(models.NylasConfig).filter(models.NylasConfig.id == 1, models.NylasConfig.is_active == True).first()
    if not config or not config.client_id:
        logger.warning("[ReportExecution] Nylas not configured — skipped")
        return False
    api_key = decrypt_token(config.api_key_encrypted)

    from routes.email_routes import _wrap_email_body
    message_payload = {
        "to": [{"email": e} for e in to_list],
        "subject": subject,
        "body": _wrap_email_body(html_body),
    }
    if cc:
        message_payload["cc"] = [{"email": e} for e in cc]
    if bcc:
        message_payload["bcc"] = [{"email": e} for e in bcc]

    if csv_attachment:
        files = {
            "message": (None, json.dumps(message_payload), "application/json"),
            "file0": ("report.csv", csv_attachment.encode("utf-8"), "text/csv"),
        }
        resp = requests.post(
            f"{NYLAS_API_BASE}/v3/grants/{mailbox.nylas_grant_id}/messages/send",
            files=files, headers={"Authorization": f"Bearer {api_key}"}, timeout=60,
        )
    else:
        resp = requests.post(
            f"{NYLAS_API_BASE}/v3/grants/{mailbox.nylas_grant_id}/messages/send",
            json=message_payload,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=30,
        )
    if resp.status_code not in (200, 202):
        logger.error(f"[ReportExecution] Nylas send failed: {resp.status_code} - {resp.text}")
        return False
    return True


# ─── Execution pipeline ───────────────────────────────────────────────────────

def execute_report(db, report, triggered_by="scheduler"):
    """The single pipeline both the scheduler and Run Now call — resolves
    the period, builds each selected component, sends the email, and
    records a ReportExecution row (§15/§16). Distinguishes SKIPPED
    (nothing configured to send to/from) from FAILED (something broke)."""
    now = datetime.now(timezone.utc)
    if report.date_range_rule == "custom" and report.custom_start and report.custom_end:
        period_start, period_end = report.custom_start, report.custom_end
    else:
        period_start, period_end = resolve_date_range(report.date_range_rule, report.timezone, now)

    if report.send_to_all_users:
        # Resolved fresh on every send, not a stored snapshot — so someone
        # who joined after this was turned on still gets next week's email
        # without anyone having to remember to add them.
        to_list = [e for (e,) in db.query(models.User.email).all() if e]
    else:
        to_list = json.loads(report.to_recipients or "[]")
    cc_list = json.loads(report.cc_recipients or "[]")
    bcc_list = json.loads(report.bcc_recipients or "[]")

    execution = models.ReportExecution(
        report_id=report.id, status="processing", triggered_by=triggered_by,
        reporting_period_start=period_start, reporting_period_end=period_end,
        recipients_snapshot=json.dumps({"to": to_list, "cc": cc_list, "bcc": bcc_list}),
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)

    try:
        if not to_list:
            execution.status, execution.failure_reason = "skipped", "No recipients configured"
        elif not report.sender_user_id:
            execution.status, execution.failure_reason = "skipped", "No sender mailbox configured"
        else:
            component_ids = json.loads(report.components or "[]")
            html, csv_text = build_report_content(db, report, component_ids, period_start, period_end)
            subject = f"{report.name} — {period_start.strftime('%b %d')} to {period_end.strftime('%b %d, %Y')}"
            sent = send_report_email(
                db, report.sender_user_id, to_list, html, subject,
                cc=cc_list, bcc=bcc_list,
                csv_attachment=(csv_text if report.include_csv and export_allowed_for_user_id(db, report.owner_id or report.sender_user_id) else None),   # no export permission, no attachment; an old report with no owner is judged by whoever sends it
            )
            if sent:
                execution.status = "sent"
                report.last_run_at = now
            else:
                execution.status, execution.failure_reason = "failed", "Email send failed — see server logs"
    except Exception as e:
        logger.error(f"[ReportExecution] {report.id} failed: {e}")
        execution.status, execution.failure_reason = "failed", str(e)[:2000]

    execution.completed_at = datetime.now(timezone.utc)
    db.commit()
    return execution
