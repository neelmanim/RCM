"""
Semantic Layer — Phase 1.

One function, resolve_metric(), not a class  generic query
engine (per both governing docs: "initially the semantic layer can simply
wrap existing tested functions"). It:

  1. resolves scope (pod/SDR) and date range exactly the way the Dashboard
     already does — reusing _effective_pod_id / _effective_ae_sdr /
     _resolve_analytics_date_range from analytics_routes.py, not
     reimplementing them (Phase 1 goal: centralize data scoping in one path).
  2. dispatches to the one registered adapter for the metric.
  3. wraps the result in the inspection/explanation envelope every migrated
     metric must provide.
  4. logs one structured line per call (existing logging idiom — no new
     observability table).

Dimensional (group-by SDR/POD/time) execution is out of scope for Phase 1 —
resolve_metric() always returns a single scalar for the resolved scope.
"""
import logging
import time
from typing import Optional

from sqlalchemy.orm import Session

from . import registry
from .adapters import ADAPTERS, MetricContext
from routes.analytics_routes import _effective_pod_id, _effective_ae_sdr, _resolve_analytics_date_range
from routes._admin_helpers import get_conversation_min_seconds

logger = logging.getLogger(__name__)


class UnknownMetricError(Exception):
    """Raised when metric_id isn't in the registry. Ask AI must surface this
    as 'metric not currently defined', never silently substitute another
    metric (master doc §Phase 6 / Phase-1-doc §17)."""
    def __init__(self, metric_id: str):
        self.metric_id = metric_id
        super().__init__(f"Metric '{metric_id}' is not currently defined.")


def resolve_metric(
    metric_id: str,
    db: Session,
    admin: dict,
    pod_id_param: Optional[str] = None,
    upload_log_id: Optional[str] = None,
    lead_source: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    preset: Optional[str] = None,
) -> dict:
    """Entry point for callers that only have an admin dict + raw date params
    (Dashboard vNext, the vNext Ask Analytics endpoint). Resolves scope and
    date range the way get_funnel() does, then delegates to
    resolve_metric_scoped()."""
    effective_pod = _effective_pod_id(admin, pod_id_param)
    effective_sdr = _effective_ae_sdr(admin)
    if effective_sdr:
        effective_pod = None  # AE: self-scope only, matches get_funnel's own rule
    date_start, date_end = _resolve_analytics_date_range(
        db, effective_pod, effective_sdr, date_from, date_to, preset
    )
    return resolve_metric_scoped(
        metric_id, db,
        effective_pod=effective_pod, effective_sdr=effective_sdr,
        date_start=date_start, date_end=date_end,
        upload_log_id=upload_log_id, lead_source=lead_source,
        date_from_raw=date_from, date_to_raw=date_to, preset_raw=preset,
        user_id_for_log=admin.get("sub") or admin.get("email"),
    )


def resolve_metric_scoped(
    metric_id: str,
    db: Session,
    effective_pod: Optional[str],
    effective_sdr: Optional[str],
    date_start,
    date_end,
    upload_log_id: Optional[str] = None,
    lead_source: Optional[str] = None,
    date_from_raw: Optional[str] = None,
    date_to_raw: Optional[str] = None,
    preset_raw: Optional[str] = None,
    user_id_for_log: Optional[str] = None,
) -> dict:
    """Entry point for callers that already resolved scope/dates themselves
    (Ask AI's DSL pipeline has its own — deliberately untouched — resolver).
    Skips straight to adapter dispatch + envelope + logging so both entry
    points share exactly one implementation of each metric."""
    metric = registry.get_metric(metric_id, db)
    if metric is None:
        raise UnknownMetricError(metric_id)

    started = time.monotonic()
    conversation_min_seconds = get_conversation_min_seconds(db)

    ctx = MetricContext(
        db=db,
        effective_pod=effective_pod,
        effective_sdr=effective_sdr,
        date_start=date_start,
        date_end=date_end,
        date_from_raw=date_from_raw,
        date_to_raw=date_to_raw,
        preset_raw=preset_raw,
        lead_source=lead_source,
        upload_log_id=upload_log_id,
        conversation_min_seconds=conversation_min_seconds,
    )

    adapter = ADAPTERS[metric_id]
    result_status = "ok"
    try:
        value, extra = adapter(ctx)
    except Exception:
        result_status = "error"
        logger.exception(
            "[SemanticLayer] resolve_metric failed metric=%s version=%s user=%s",
            metric_id, metric.version, user_id_for_log,
        )
        raise
    finally:
        execution_ms = round((time.monotonic() - started) * 1000, 1)

    filters_applied = {
        "pod_id": effective_pod,
        "sdr_id": effective_sdr,
        "batch_id": upload_log_id,
        "lead_source": lead_source,
    }

    warnings = extra.get("warnings") or []
    logger.info(
        "[SemanticLayer] user=%s metric=%s version=%s pod=%s sdr=%s batch=%s "
        "date_from=%s date_to=%s preset=%s status=%s execution_ms=%s warning_count=%s",
        user_id_for_log, metric_id, metric.version,
        effective_pod, effective_sdr, upload_log_id, date_from_raw, date_to_raw, preset_raw,
        result_status, execution_ms, len(warnings),
    )

    return {
        "metric": {
            "id": metric.id,
            "name": metric.name,
            "version": metric.version,
            "status": metric.status,
            "unit": metric.unit,
        },
        "value": value,
        "explanation": {
            "definition": metric.description,
            "formula": metric.formula_description,
            "numerator": extra.get("numerator"),
            "denominator": extra.get("denominator"),
            # Registry text describing what the raw numbers above mean (e.g.
            # "connected calls" / "calls made") — ponytail-audit flagged these
            # registry fields as written but never read anywhere; wiring them
            # through here is what actually answers "what does this number
            # count", not just showing two bare integers.
            "numerator_label": metric.numerator_description,
            "denominator_label": metric.denominator_description,
            "date_basis": metric.date_basis,
            "filters_applied": filters_applied,
            "date_range": {
                "start": date_start.isoformat() if date_start else None,
                "end": date_end.isoformat() if date_end else None,
            },
            "execution_ms": execution_ms,
            "known_caveats": metric.known_caveats,
            "warnings": warnings,
        },
    }
