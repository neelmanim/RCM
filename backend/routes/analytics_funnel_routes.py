# ── routes/analytics_funnel_routes.py — Sales funnel (Super Admin + Pod Admin) ─
"""Funnel report: Accounts -> Conversations -> Meetings booked -> SAL -> Held, with No-show and Closed.
Definitions live in services/funnel.py. A Pod Admin is always their own pod; a Super Admin may pick one."""
import io
from datetime import date as _date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import access_db
import models
from auth import require_admin, require_export_access
from database import get_db
from routes._admin_helpers import get_conversation_min_seconds
from services import daily_activity, funnel

router = APIRouter(prefix="/api/admin/analytics", tags=["analytics"])

MAX_DAYS = 366
COLUMNS = [("accounts", "Accounts"), ("contacts", "Contacts"), ("contacts_per_account", "Contacts / account"),
           ("conversations", "Conversations"), ("booked", "Meetings booked"), ("sal", "SAL (in Salesforce)"),
           ("held", "Meetings held"), ("no_show", "No-shows"), ("won", "Won"), ("lost", "Lost"),
           ("booked_per_100_conversations", "Booked per 100 conversations"), ("held_rate", "Held % of booked"),
           ("no_show_rate", "No-show % of booked")]


def _parse(d, label):
    try:
        return _date.fromisoformat(d)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{label} must be YYYY-MM-DD.")


def _run(admin, db, date_from, date_to, pod_id, group_by, campaign, rep_id):
    today = datetime.now(timezone.utc).date()
    end_day = _parse(date_to, "to") if date_to else today
    start_day = _parse(date_from, "from") if date_from else end_day - timedelta(days=29)
    if start_day > end_day:
        raise HTTPException(status_code=400, detail="'from' must not be after 'to'.")
    if (end_day - start_day).days >= MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Pick a range of at most {MAX_DAYS} days.")
    if group_by not in ("none", "sdr", "campaign"):
        raise HTTPException(status_code=400, detail="group_by must be none, sdr or campaign.")

    pod = access_db.pod_of(admin) if admin.get("role") == "Pod Admin" else (pod_id or None)
    users = db.query(models.User.id, models.User.name, models.User.left_at).filter(models.User.role.in_(("SDR", "AE")))
    if pod:
        users = users.filter_by(pod_id=pod)
    users = users.all()
    if rep_id and rep_id not in {u.id for u in users}:
        raise HTTPException(status_code=404, detail="Rep not found in this view.")
    uids = [rep_id] if rep_id else [u.id for u in users]
    names = {u.id: u.name for u in users}

    start, end = funnel.window(start_day, end_day, daily_activity.pod_timezone(db, pod))
    rows, total, camp = funnel.build(db, uids, start, end, get_conversation_min_seconds(db), group_by, campaign, names)
    return {"from": start_day.isoformat(), "to": end_day.isoformat(), "group_by": group_by, "pod_id": pod,
            "rows": rows, "total": total, "campaigns": sorted(set(camp.values()) | {funnel.NO_CAMPAIGN}),
            "reps": sorted(({"id": u.id, "name": u.name, "left": bool(u.left_at)} for u in users), key=lambda r: r["name"] or "")}


@router.get("/sales-funnel")
def get_funnel(
    date_from: Optional[str] = Query(None, alias="from", description="YYYY-MM-DD; default 30 days back"),
    date_to: Optional[str] = Query(None, alias="to", description="YYYY-MM-DD; default today"),
    pod_id: Optional[str] = Query(None, description="Super Admin only: one pod. A Pod Admin is always their own pod."),
    group_by: str = Query("none", description="none | sdr | campaign"),
    campaign: Optional[str] = Query(None, description="One campaign tag, or 'No campaign'"),
    rep_id: Optional[str] = Query(None),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return _run(admin, db, date_from, date_to, pod_id, group_by, campaign, rep_id)


@router.get("/sales-funnel/export.xlsx", dependencies=[Depends(require_export_access)])
def export_funnel(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    pod_id: Optional[str] = Query(None),
    group_by: str = Query("none"),
    campaign: Optional[str] = Query(None),
    rep_id: Optional[str] = Query(None),
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    import openpyxl
    from fastapi.responses import StreamingResponse
    from routes.export_routes import _cell

    d = _run(admin, db, date_from, date_to, pod_id, group_by, campaign, rep_id)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Funnel"
    ws.append(["From", d["from"], "To", d["to"], "Grouped by", d["group_by"]])
    ws.append([])
    ws.append(["Group"] + [label for _k, label in COLUMNS])
    for r in d["rows"] + [d["total"]]:
        ws.append([_cell(r["label"])] + [r[k] for k, _l in COLUMNS])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="funnel-{d["from"]}-{d["to"]}.xlsx"'})
