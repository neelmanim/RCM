# ── routes/analytics_vnext_routes.py — Analytics Hub vNext (parallel beta) ───
"""
Analytics Hub vNext — /api/admin/analytics/vnext
==================================================
Phase 1 (Analytics Transformation). Serves the Metric Registry + Semantic
Layer to the new, parallel Analytics Hub vNext experience. The existing
Analytics Hub (analytics_routes.py) is untouched and remains the default —
this router is purely additive.

Same RBAC as the existing Dashboard (require_admin_or_ae) plus a
Super-Admin-only gate on the entry link itself (enforced in the frontend
per the Phase 1 plan; this router still double-checks per-endpoint scope
server-side, since frontend gating is never authorization).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, get_ai_db
from auth import require_admin_or_ae

from analytics import registry
from analytics.semantic import resolve_metric, UnknownMetricError
from routes.analytics_routes import (
    _effective_pod_id,
    _effective_ae_sdr,
    _resolve_analytics_date_range,
    _compute_meetings_booked_snapshot,
    _compute_disqualified_snapshot,
    _compute_calls_and_connect_rate,
    _compute_leads_assigned_count,
)
from routes._admin_helpers import get_conversation_min_seconds

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics/vnext", tags=["analytics-vnext"])

_IS_ADMIN_ROLES = ("Super Admin", "Admin")

# Legacy-value getter for each metric that has a comparable existing Dashboard
# number — used by /compare. disqualified/meetings_scheduled compare against
# the legacy snapshot definitions extracted from get_funnel(); the other 3
# reuse the same helper the canonical adapter itself calls (parity is
# expected to be exact for those — they're the same query).
def _legacy_value(metric_id, db, effective_pod, effective_sdr, date_start, date_end,
                   date_from, date_to, preset, upload_log_id, lead_source, conversation_min_seconds):
    if metric_id == "meetings_scheduled":
        booked, _ = _compute_meetings_booked_snapshot(
            db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id
        )
        return booked
    if metric_id == "disqualified":
        return _compute_disqualified_snapshot(
            db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id
        )
    if metric_id == "connect_rate":
        return _compute_calls_and_connect_rate(
            db, effective_pod, effective_sdr, date_start, date_end,
            lead_source, upload_log_id, conversation_min_seconds
        )["connect_rate"]
    if metric_id == "leads_assigned":
        return _compute_leads_assigned_count(
            db, effective_pod, effective_sdr, date_start, date_end, lead_source, upload_log_id
        )
    if metric_id == "account_connect_rate":
        from analytics.adapters import _account_connect_rate, MetricContext
        ctx = MetricContext(
            db=db, effective_pod=effective_pod, effective_sdr=effective_sdr,
            date_start=date_start, date_end=date_end,
            date_from_raw=date_from, date_to_raw=date_to, preset_raw=preset,
            lead_source=lead_source, upload_log_id=upload_log_id,
            conversation_min_seconds=conversation_min_seconds,
        )
        value, _ = _account_connect_rate(ctx)
        return value
    return None


@router.get("/metrics")
def list_metrics(admin: dict = Depends(require_admin_or_ae), db: Session = Depends(get_db)):
    """Registry catalog — descriptive metadata, no query execution. Reflects
    any published MetricVersion override (Phase 3), falling back to the
    static v1 definition."""
    return {
        "metrics": [
            {
                "id": m.id, "name": m.name, "description": m.description,
                "category": m.category, "unit": m.unit,
                "date_basis": m.date_basis, "supported_dimensions": m.supported_dimensions,
                "status": m.status, "version": m.version, "owner": m.owner,
                "known_caveats": m.known_caveats,
            }
            for m in registry.list_metrics(db)
        ]
    }


@router.get("/metrics/{metric_id}")
def resolve_metric_endpoint(
    metric_id: str,
    pod_id: Optional[str] = Query(None),
    upload_log_id: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    preset: Optional[str] = Query(None),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """Resolve one metric + return the Inspect envelope. This IS the Inspect
    endpoint — the frontend's [Inspect] action calls this same route."""
    try:
        envelope = resolve_metric(
            metric_id, db, admin,
            pod_id_param=pod_id, upload_log_id=upload_log_id, lead_source=lead_source,
            date_from=date_from, date_to=date_to, preset=preset,
        )
    except UnknownMetricError as exc:
        return {"error": "unknown_metric", "message": str(exc)}

    # SQL visibility (docs §14/§36): admins get a pointer to the implementing
    # function; nobody gets raw SQL text or an editable query in Phase 1.
    if admin.get("role") in _IS_ADMIN_ROLES:
        envelope["explanation"]["query_implementation"] = (
            f"backend/analytics/adapters.py:_{metric_id}()"
        )
    return envelope


@router.get("/compare/{metric_id}")
def compare_metric(
    metric_id: str,
    pod_id: Optional[str] = Query(None),
    upload_log_id: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    preset: Optional[str] = Query(None),
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_db),
):
    """Old-vs-new comparison (docs §20/Phase 1 §Old vs. new comparison) — never
    switch a consumer to the new value without this being visible first."""
    try:
        new_envelope = resolve_metric(
            metric_id, db, admin,
            pod_id_param=pod_id, upload_log_id=upload_log_id, lead_source=lead_source,
            date_from=date_from, date_to=date_to, preset=preset,
        )
    except UnknownMetricError as exc:
        return {"error": "unknown_metric", "message": str(exc)}

    effective_pod = _effective_pod_id(admin, pod_id)
    effective_sdr = _effective_ae_sdr(admin)
    if effective_sdr:
        effective_pod = None
    date_start, date_end = _resolve_analytics_date_range(db, effective_pod, effective_sdr, date_from, date_to, preset)
    conversation_min_seconds = get_conversation_min_seconds(db)

    legacy_value = _legacy_value(
        metric_id, db, effective_pod, effective_sdr, date_start, date_end,
        date_from, date_to, preset, upload_log_id, lead_source, conversation_min_seconds,
    )
    new_value = new_envelope["value"]
    match = (legacy_value == new_value)

    return {
        "metric_id": metric_id,
        "legacy_value": legacy_value,
        "vnext_value": new_value,
        "match": match,
        "note": None if legacy_value is not None else "No comparable legacy value for this metric.",
    }


# ─── Ask Analytics — reuses the existing safe DSL parser, scalar-only ───────

class _AskRequest(BaseModel):
    query: str


# vNext DSL metric name → registry metric_id. Only metrics with a canonical
# Phase 1 definition are answerable here; everything else gets the explicit
# "not currently defined" response (docs §17 — never silently substitute).
_DSL_METRIC_TO_REGISTRY = {
    "connect_rate": "connect_rate",
    "disqualified": "disqualified",
    "meetings_scheduled": "meetings_scheduled",
    "leads_created": "leads_assigned",  # Ask AI's existing alias for this concept
}


@router.post("/ask")
def ask_analytics(
    body: _AskRequest,
    admin: dict = Depends(require_admin_or_ae),
    db: Session = Depends(get_ai_db),
):
    """Natural language → existing DSL parser → semantic layer, scalar only.
    No ranking/grouping/multi-metric in Phase 1 vNext — those stay on the
    existing Ask AI tab. Named SDR/POD/batch filters in the question are not
    resolved here (a Phase 1 scope limit); scope comes from the requesting
    admin's own role, same as the rest of vNext."""
    from services.smart_analytics import parse_nl_to_dsl, validate_dsl, SmartAnalyticsError, _resolve_period

    try:
        dsl = parse_nl_to_dsl(body.query, db)
    except SmartAnalyticsError as exc:
        return {"interpretation": None, "result": None, "unsupported": True, "message": exc.user_message}

    validate_dsl(dsl)

    if dsl.get("action") in ("clarify", "unsupported"):
        return {
            "interpretation": None, "result": None, "unsupported": True,
            "message": dsl.get("question") or dsl.get("message") or "Could not understand that question.",
        }

    mode = dsl.get("mode", "standard")
    dsl_metric = dsl.get("metric")
    group_by = dsl.get("group_by")
    metric_id = _DSL_METRIC_TO_REGISTRY.get(dsl_metric)

    # Phase 6 "Trend" — a narrow carve-out from the blanket group_by rejection
    # below: time-bucket breakdowns only (day/week/month), everything else
    # (sdr/pod/source/status) still routes to the "try the existing Ask AI
    # tab" message. This reuses execute_dsl's mode="standard" dispatch
    # unchanged — _q_time_series() already backs day/week/month for these
    # metrics (proven by the legacy Ask AI's own system prompt already
    # advertising day/week/month as group_by values), so there's no separate
    # "trend" execution path to build; adding one would just be a second,
    # redundant implementation of the same query. No dimensional resolution
    # was added to the semantic layer — this bypasses it entirely, the same
    # way the existing scalar Ask Analytics path below does not.
    from services.smart_analytics import SUPPORTED_DIMENSIONS_BY_METRIC
    trend_capable = {m for m, dims in SUPPORTED_DIMENSIONS_BY_METRIC.items() if dims & {"day", "week", "month"}}
    if mode == "standard" and group_by in ("day", "week", "month") and dsl_metric in trend_capable:
        from services.smart_analytics import execute_dsl, SmartAnalyticsError as _SAError
        try:
            trend_result = execute_dsl(dsl, admin, db)
        except _SAError as exc:
            return {"interpretation": None, "result": None, "unsupported": True, "message": exc.user_message}
        return {
            "interpretation": {
                "metric": dsl_metric.replace("_", " ").title(),
                "group_by": group_by,
                "period": dsl.get("period") or "last_30_days",
            },
            "result": {"data": trend_result["data"], "group_by": group_by, "metric": dsl_metric},
            "unsupported": False,
            "message": None,
        }

    if mode != "standard" or group_by or not metric_id:
        label = (dsl_metric or "that").replace("_", " ")
        return {
            "interpretation": {
                "metric": label, "breakdown": group_by, "period": dsl.get("period"),
            },
            "result": None,
            "unsupported": True,
            "message": (
                f"Analytics Hub vNext currently answers single-metric questions for "
                f"Connect Rate, Disqualified, Meetings Scheduled, and Leads Assigned only "
                f"— no breakdowns or rankings yet, aside from day/week/month trends for "
                f"Calls Made, Meetings Scheduled, Emails Sent, Demos Scheduled, and Demos "
                f"Completed. Try the existing Ask AI tab for anything else."
            ),
        }

    period = dsl.get("period")
    date_start, date_end = _resolve_period(period)
    metric = registry.get_metric(metric_id)

    interpretation = {
        "metric": metric.name,
        "period": period or "last_30_days",
        "date_range": {"start": date_start.isoformat(), "end": date_end.isoformat()},
    }

    effective_pod = _effective_pod_id(admin, None)
    effective_sdr = _effective_ae_sdr(admin)
    if effective_sdr:
        effective_pod = None

    from analytics.semantic import resolve_metric_scoped
    envelope = resolve_metric_scoped(
        metric_id, db,
        effective_pod=effective_pod, effective_sdr=effective_sdr,
        date_start=date_start, date_end=date_end,
        user_id_for_log=admin.get("sub") or admin.get("email"),
    )
    return {"interpretation": interpretation, "result": envelope, "unsupported": False, "message": None}
