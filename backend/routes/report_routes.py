# ── routes/report_routes.py — Automated Analytics Reports (v11.4.0) ─────────
"""
CRUD + preview + Run Now + execution logs for ReportConfig/ReportExecution.
Lives separately from analytics_routes.py — this is a report-management
surface, not an analytics query endpoint, even though it's mounted under the
same /api/admin/analytics prefix (the Reports tab lives in the Analytics Hub).

Run Now (POST /reports/{id}/run-now) calls report_service.execute_report()
directly — the exact same function scheduled_jobs._scheduled_report_job
calls — so there is only one send pipeline, never two to keep in sync.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
import access_db
from auth import require_admin, export_allowed, EXPORT_DENIED_MESSAGE
import models
import report_service
from routes._admin_helpers import _is_valid_email, resolve_sort

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/analytics", tags=["Reports"])


# ─── Serialization ────────────────────────────────────────────────────────────

def _report_to_dict(db, report):
    to_list = json.loads(report.to_recipients or "[]")
    cc_list = json.loads(report.cc_recipients or "[]")
    bcc_list = json.loads(report.bcc_recipients or "[]")
    sender = db.query(models.User).filter(models.User.id == report.sender_user_id).first() if report.sender_user_id else None
    last_execution = (
        db.query(models.ReportExecution)
        .filter(models.ReportExecution.report_id == report.id)
        .order_by(models.ReportExecution.started_at.desc())
        .first()
    )
    return {
        "id": report.id,
        "name": report.name,
        "enabled": report.enabled,
        "components": json.loads(report.components or "[]"),
        "pod_id": report.pod_id,
        "upload_log_id": report.upload_log_id,
        "sdr_id": report.sdr_id,
        "date_range_rule": report.date_range_rule,
        "custom_start": str(report.custom_start) if report.custom_start else None,
        "custom_end": str(report.custom_end) if report.custom_end else None,
        "frequency": report.frequency,
        "weekday": report.weekday,
        "day_of_month": report.day_of_month,
        "timezone": report.timezone,
        "send_hour": report.send_hour,
        "send_minute": report.send_minute,
        "to_recipients": to_list,
        "cc_recipients": cc_list,
        "bcc_recipients": bcc_list,
        "recipient_count": len(set(to_list) | set(cc_list) | set(bcc_list)),
        "sender_user_id": report.sender_user_id,
        "sender_user_name": sender.name if sender else None,
        "include_csv": report.include_csv,
        "last_run_at": str(report.last_run_at) if report.last_run_at else None,
        "last_status": last_execution.status if last_execution else None,
        "next_run_at": str(report_service.next_run_at(report)) if report.enabled else None,
        "created_at": str(report.created_at) if report.created_at else None,
    }


def _execution_to_dict(execution, report_name=None):
    return {
        "id": execution.id,
        "report_id": execution.report_id,
        "report_name": report_name,
        "status": execution.status,
        "triggered_by": execution.triggered_by,
        "started_at": str(execution.started_at) if execution.started_at else None,
        "completed_at": str(execution.completed_at) if execution.completed_at else None,
        "reporting_period_start": str(execution.reporting_period_start) if execution.reporting_period_start else None,
        "reporting_period_end": str(execution.reporting_period_end) if execution.reporting_period_end else None,
        "recipients": json.loads(execution.recipients_snapshot) if execution.recipients_snapshot else None,
        "failure_reason": execution.failure_reason,
    }


# ─── Validation ───────────────────────────────────────────────────────────────

def _validate_int_range(body, key, lo, hi, range_label=None):
    value = int(body[key])
    if not (lo <= value <= hi):
        raise HTTPException(status_code=422, detail=f"{key} must be {range_label or f'{lo}-{hi}'}")
    return value


def _is_pod_admin(admin):
    return admin.get("role") == "Pod Admin"


def _validate_and_apply(report, body, db, partial=False, admin=None):
    """Shared by create + update. `partial=True` (PATCH) only validates
    fields actually present in `body`; create requires the full set."""
    def _present(key):
        return key in body

    if not partial or _present("name"):
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="name is required")
        if len(name) > 100:
            raise HTTPException(status_code=422, detail="name must be 100 characters or fewer")
        report.name = name

    if not partial or _present("components"):
        components = body.get("components") or []
        if not components:
            raise HTTPException(status_code=422, detail="At least one component is required")
        invalid = [c for c in components if c not in report_service.COMPONENTS]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Unknown component(s): {', '.join(invalid)}")
        report.components = json.dumps(components)

    if _present("pod_id"):
        report.pod_id = body.get("pod_id") or None
    if _present("upload_log_id"):
        report.upload_log_id = body.get("upload_log_id") or None
    if _present("sdr_id"):
        report.sdr_id = body.get("sdr_id") or None
    if admin and _is_pod_admin(admin):
        # A Pod Admin's report is always about their own pod, and may only name a rep from it
        report.pod_id = access_db.pod_of(admin)
        if report.sdr_id and not db.query(models.User).filter(
                models.User.id == report.sdr_id, models.User.pod_id == access_db.pod_of(admin)).first():
            raise HTTPException(status_code=403, detail="You can only report on reps in your own POD.")

    if not partial or _present("date_range_rule"):
        rule = body.get("date_range_rule") or "previous_7_days"
        if rule not in report_service.DATE_RANGE_RULES:
            raise HTTPException(status_code=422, detail=f"date_range_rule must be one of {report_service.DATE_RANGE_RULES}")
        report.date_range_rule = rule
        if rule == "custom":
            start, end = body.get("custom_start"), body.get("custom_end")
            if not start or not end:
                raise HTTPException(status_code=422, detail="custom_start and custom_end are required for a custom date range")
            try:
                report.custom_start = datetime.fromisoformat(start.replace("Z", "+00:00"))
                report.custom_end = datetime.fromisoformat(end.replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(status_code=422, detail="custom_start/custom_end must be valid ISO datetimes")

    if not partial or _present("frequency"):
        frequency = body.get("frequency") or "weekly"
        if frequency not in report_service.FREQUENCIES:
            raise HTTPException(status_code=422, detail=f"frequency must be one of {report_service.FREQUENCIES}")
        report.frequency = frequency
    if _present("weekday"):
        report.weekday = _validate_int_range(body, "weekday", 0, 6, "0-6 (Monday-Sunday)")
    if _present("day_of_month"):
        report.day_of_month = _validate_int_range(body, "day_of_month", 1, 31)

    if not partial or _present("timezone"):
        tz_name = body.get("timezone") or "UTC"
        try:
            ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(status_code=422, detail=f"Unknown timezone: {tz_name}")
        report.timezone = tz_name
    if _present("send_hour"):
        report.send_hour = _validate_int_range(body, "send_hour", 0, 23)
    if _present("send_minute"):
        report.send_minute = _validate_int_range(body, "send_minute", 0, 59)

    if not partial or any(_present(k) for k in ("to_recipients", "cc_recipients", "bcc_recipients")):
        to_r = [e.strip() for e in (body.get("to_recipients") or []) if e and e.strip()]
        cc_r = [e.strip() for e in (body.get("cc_recipients") or []) if e and e.strip()]
        bcc_r = [e.strip() for e in (body.get("bcc_recipients") or []) if e and e.strip()]
        if not partial and not to_r:
            raise HTTPException(status_code=422, detail="At least one recipient (To) is required")
        all_recipients = to_r + cc_r + bcc_r
        invalid = [e for e in all_recipients if not _is_valid_email(e)]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Invalid recipient email(s): {', '.join(invalid)}")
        seen = set()
        for label, group in (("To", to_r), ("CC", cc_r), ("BCC", bcc_r)):
            for e in group:
                key = e.lower()
                if key in seen:
                    raise HTTPException(status_code=422, detail=f"{e} appears more than once across To/CC/BCC")
                seen.add(key)
        report.to_recipients = json.dumps(to_r)
        report.cc_recipients = json.dumps(cc_r)
        report.bcc_recipients = json.dumps(bcc_r)

    if _present("sender_user_id"):
        sender_id = body.get("sender_user_id") or None
        if sender_id and not db.query(models.User).filter(models.User.id == sender_id).first():
            raise HTTPException(status_code=404, detail="sender_user_id not found")
        report.sender_user_id = sender_id
    elif not partial:
        raise HTTPException(status_code=422, detail="sender_user_id is required")

    if _present("include_csv"):
        report.include_csv = bool(body["include_csv"])
    # A CSV attachment is a data export that leaves by e-mail, so it needs the same permission as a download.
    if not export_allowed(db, admin):
        if _present("include_csv") and body["include_csv"]:
            raise HTTPException(status_code=403, detail=EXPORT_DENIED_MESSAGE)
        if not partial:
            report.include_csv = False        # a new report that did not ask for it just goes out without the attachment
    if _present("enabled"):
        report.enabled = bool(body["enabled"])


# ─── Components / senders (registry introspection) ───────────────────────────

@router.get("/reports/components")
def list_report_components(admin: dict = Depends(require_admin)):
    return [{"id": k, "label": v["label"], "description": v["description"]} for k, v in report_service.COMPONENTS.items()]


@router.get("/reports/senders")
def list_report_senders(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Users with a connected mailbox — the only valid report senders (Nylas
    sends are always from a specific connected grant)."""
    rows = (
        db.query(models.User.id, models.User.name, models.User.email)
        .join(models.UserMailbox, models.UserMailbox.user_id == models.User.id)
        .filter(models.UserMailbox.status == "connected")
    )
    if _is_pod_admin(admin):
        rows = rows.filter(models.User.pod_id == access_db.pod_of(admin))
    rows = rows.all()
    return [{"id": r[0], "name": r[1], "email": r[2]} for r in rows]


# ─── Weekly Changelog Digest (singleton, all-users toggle) ───────────────────
# A dedicated, deliberately tiny on/off switch — not the general Report
# Builder. There's exactly one of these per org (identified by
# send_to_all_users=True, not by name), it always sends "What Shipped This
# Week" to every current CRM user (resolved at send time, see
# report_service.execute_report), and it has no recipient list, POD/Batch/SDR
# scope, or CSV toggle to configure — those don't apply to "the whole org."

_CHANGELOG_DIGEST_NAME = "Weekly Changelog Digest (All Users)"


def _get_changelog_digest(db):
    return db.query(models.ReportConfig).filter(models.ReportConfig.send_to_all_users == True).first()  # noqa: E712


@router.get("/reports/changelog-digest")
def get_changelog_digest(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    report = _get_changelog_digest(db)
    return {"enabled": bool(report and report.enabled)}


@router.patch("/reports/changelog-digest")
def toggle_changelog_digest(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    enabled = bool(body.get("enabled"))
    report = _get_changelog_digest(db)

    if enabled and not report:
        sender_row = (
            db.query(models.User.id)
            .join(models.UserMailbox, models.UserMailbox.user_id == models.User.id)
            .filter(models.UserMailbox.status == "connected")
            .first()
        )
        if not sender_row:
            raise HTTPException(
                status_code=422,
                detail="No connected mailbox available to send from — connect one in Email Hub first.",
            )
        report = models.ReportConfig(
            owner_id=admin.get("sub"),
            name=_CHANGELOG_DIGEST_NAME,
            components=json.dumps(["release_digest"]),
            send_to_all_users=True,
            sender_user_id=sender_row[0],
            enabled=True,
        )
        db.add(report)
    elif report:
        report.enabled = enabled

    db.commit()
    return {"enabled": enabled}


# ─── Report CRUD ──────────────────────────────────────────────────────────────

@router.get("/reports")
def list_reports(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    # Excludes the singleton Changelog Digest (send_to_all_users=True) — that
    # one is managed by its own toggle above, not the general report list/
    # editor, which assumes a static recipient list this report doesn't have.
    reports = (
        db.query(models.ReportConfig)
        .filter(models.ReportConfig.send_to_all_users == False)  # noqa: E712
        .order_by(models.ReportConfig.created_at.desc())
    )
    if _is_pod_admin(admin):
        reports = reports.filter(models.ReportConfig.owner_id == admin.get("sub"))
    reports = reports.all()
    return [_report_to_dict(db, r) for r in reports]


@router.post("/reports")
def create_report(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    report = models.ReportConfig(owner_id=admin.get("sub"))
    _validate_and_apply(report, body, db, partial=False, admin=admin)
    report.enabled = bool(body.get("enabled", True))
    db.add(report)
    db.commit()
    db.refresh(report)
    return _report_to_dict(db, report)


def _get_report_or_404(db, report_id, admin):
    report = db.query(models.ReportConfig).filter(models.ReportConfig.id == report_id).first()
    # A Pod Admin works with their own reports only (v13.12.1 — they could open, run and delete anyone's)
    if not report or (_is_pod_admin(admin) and report.owner_id != admin.get("sub")):
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.get("/reports/{report_id}")
def get_report(report_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    return _report_to_dict(db, _get_report_or_404(db, report_id, admin))


@router.patch("/reports/{report_id}")
def update_report(report_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    report = _get_report_or_404(db, report_id, admin)
    _validate_and_apply(report, body, db, partial=True, admin=admin)
    db.commit()
    db.refresh(report)
    return _report_to_dict(db, report)


@router.delete("/reports/{report_id}")
def delete_report(report_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    report = _get_report_or_404(db, report_id, admin)
    db.delete(report)
    db.commit()
    return {"ok": True}


@router.patch("/reports/{report_id}/toggle")
def toggle_report(report_id: str, body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    report = _get_report_or_404(db, report_id, admin)
    if "enabled" not in body:
        raise HTTPException(status_code=400, detail="Missing enabled in body")
    report.enabled = bool(body["enabled"])
    db.commit()
    return _report_to_dict(db, report)


@router.post("/reports/{report_id}/duplicate")
def duplicate_report(report_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    original = _get_report_or_404(db, report_id, admin)
    copy = models.ReportConfig(
        owner_id=admin.get("sub"),
        name=f"{original.name} (Copy)",
        enabled=False,  # a duplicate starts disabled — avoid two live schedules sending the same report by accident
        components=original.components,
        pod_id=original.pod_id,
        upload_log_id=original.upload_log_id,
        sdr_id=original.sdr_id,
        date_range_rule=original.date_range_rule,
        custom_start=original.custom_start,
        custom_end=original.custom_end,
        frequency=original.frequency,
        weekday=original.weekday,
        day_of_month=original.day_of_month,
        timezone=original.timezone,
        send_hour=original.send_hour,
        send_minute=original.send_minute,
        to_recipients=original.to_recipients,
        cc_recipients=original.cc_recipients,
        bcc_recipients=original.bcc_recipients,
        sender_user_id=original.sender_user_id,
        include_csv=original.include_csv,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _report_to_dict(db, copy)


# ─── Preview / Run Now ────────────────────────────────────────────────────────

@router.get("/reports/{report_id}/preview")
def preview_report(report_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Renders the report with its saved configuration WITHOUT sending or
    logging an execution — same rendering pipeline
    (report_service.build_report_content) the real send uses, so preview
    can never drift from what actually gets emailed."""
    report = _get_report_or_404(db, report_id, admin)
    now = datetime.now(timezone.utc)
    if report.date_range_rule == "custom" and report.custom_start and report.custom_end:
        start, end = report.custom_start, report.custom_end
    else:
        start, end = report_service.resolve_date_range(report.date_range_rule, report.timezone, now)
    html, csv_text = report_service.build_report_content(db, report, json.loads(report.components or "[]"), start, end)
    return {
        "report_name": report.name,
        "reporting_period_start": str(start),
        "reporting_period_end": str(end),
        "html": html,
        "has_csv": bool(csv_text),
    }


@router.post("/reports/{report_id}/run-now")
def run_report_now(report_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Executes the exact same pipeline the scheduler uses
    (report_service.execute_report) — no separate 'manual send' code path."""
    report = _get_report_or_404(db, report_id, admin)
    execution = report_service.execute_report(db, report, triggered_by="manual")
    return _execution_to_dict(execution, report_name=report.name)


# ─── Report Logs ──────────────────────────────────────────────────────────────

@router.get("/report-executions")
def list_report_executions(
    report_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None, description="report_name | started_at | status (prefix '-' for descending)"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    q = db.query(models.ReportExecution).join(models.ReportConfig, models.ReportConfig.id == models.ReportExecution.report_id)
    if _is_pod_admin(admin):
        q = q.filter(models.ReportConfig.owner_id == admin.get("sub"))
    if report_id:
        q = q.filter(models.ReportExecution.report_id == report_id)
    if status:
        q = q.filter(models.ReportExecution.status == status)
    if date_from:
        try:
            q = q.filter(models.ReportExecution.started_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(models.ReportExecution.started_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    if search:
        q = q.filter(models.ReportConfig.name.ilike(f"%{search}%"))

    total = q.count()
    sort_columns = {
        "report_name": models.ReportConfig.name,
        "started_at": models.ReportExecution.started_at,
        "status": models.ReportExecution.status,
    }
    sort_col, sort_desc = resolve_sort(sort_by, sort_columns, models.ReportExecution.started_at)
    q = q.order_by(sort_col.desc() if sort_desc else sort_col.asc())
    rows = (
        q.offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    report_names = {r.id: r.name for r in db.query(models.ReportConfig).all()}
    return {
        "items": [_execution_to_dict(e, report_name=report_names.get(e.report_id)) for e in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }
