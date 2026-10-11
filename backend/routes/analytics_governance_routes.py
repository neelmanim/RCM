# ── routes/analytics_governance_routes.py — Metric Governance (Phase 3) ─────
"""
Metric Registry governance — /api/admin/analytics/governance

Draft -> Preview -> Compare -> Publish for the descriptive/business-meaning
fields on a registered metric (analytics/registry.py's MetricDefinition).
Mirrors journey_routes.py's save_draft/publish shape. Only the fields in
registry._VERSIONABLE_FIELDS are editable here — a draft that needs different
calculation logic still needs a code change to the adapter, gated on version,
same as any other versioned business rule (no definition-to-SQL compiler).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from auth import require_metric_editor, require_metric_publisher
import models
from activity_logger import log_activity
from analytics import registry
from analytics.registry import _VERSIONABLE_FIELDS

router = APIRouter(prefix="/api/admin/analytics/governance", tags=["analytics-governance"])


def _serialize(v: models.MetricVersion) -> dict:
    return {
        "id": v.id,
        "metric_id": v.metric_id,
        "version_number": v.version_number,
        "status": v.status,
        "definition": v.definition_json,
        "published_at": v.published_at.isoformat() if v.published_at else None,
        "created_by": v.created_by,
        "updated_at": v.updated_at.isoformat() if v.updated_at else None,
    }


def _metric_or_404(metric_id: str):
    if not registry.metric_exists(metric_id):
        raise HTTPException(status_code=404, detail=f"Metric '{metric_id}' is not currently defined.")


@router.get("/metrics/{metric_id}/versions")
def list_versions(metric_id: str, db: Session = Depends(get_db), user: dict = Depends(require_metric_editor)):
    _metric_or_404(metric_id)
    rows = db.query(models.MetricVersion).filter(
        models.MetricVersion.metric_id == metric_id
    ).order_by(models.MetricVersion.version_number.desc()).all()
    return {"versions": [_serialize(v) for v in rows]}


@router.post("/metrics/{metric_id}/draft")
def create_draft(metric_id: str, db: Session = Depends(get_db), user: dict = Depends(require_metric_editor)):
    _metric_or_404(metric_id)

    existing_draft = db.query(models.MetricVersion).filter(
        models.MetricVersion.metric_id == metric_id,
        models.MetricVersion.status == "draft",
    ).first()
    if existing_draft:
        return _serialize(existing_draft)

    base = registry.get_metric(metric_id, db)
    latest = db.query(models.MetricVersion).filter(
        models.MetricVersion.metric_id == metric_id
    ).order_by(models.MetricVersion.version_number.desc()).first()
    next_version = (latest.version_number + 1) if latest else (base.version + 1)

    draft = models.MetricVersion(
        metric_id=metric_id,
        version_number=next_version,
        definition_json={f: getattr(base, f) for f in _VERSIONABLE_FIELDS},
        status="draft",
        created_by=user.get("sub"),
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return _serialize(draft)


@router.put("/drafts/{version_id}")
def edit_draft(version_id: str, body: dict, db: Session = Depends(get_db), user: dict = Depends(require_metric_editor)):
    draft = db.query(models.MetricVersion).filter(models.MetricVersion.id == version_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft version can be edited")

    definition = dict(draft.definition_json or {})
    for field in _VERSIONABLE_FIELDS:
        if field in body:
            definition[field] = body[field]
    draft.definition_json = definition
    db.commit()
    db.refresh(draft)
    return _serialize(draft)


@router.get("/drafts/{version_id}/preview")
def preview_draft(version_id: str, db: Session = Depends(get_db), user: dict = Depends(require_metric_editor)):
    """Resolves the metric normally (execution is unchanged by a metadata-only
    draft) and swaps the explanation text for the draft's definition, so the
    UI can show 'Try v{N}' without a second query path."""
    draft = db.query(models.MetricVersion).filter(models.MetricVersion.id == version_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    from analytics.semantic import resolve_metric, UnknownMetricError
    try:
        envelope = resolve_metric(draft.metric_id, db, user)
    except UnknownMetricError as exc:
        return {"error": "unknown_metric", "message": str(exc)}

    d = draft.definition_json or {}
    envelope["explanation"]["definition"] = d.get("description", envelope["explanation"]["definition"])
    envelope["explanation"]["formula"] = d.get("formula_description", envelope["explanation"]["formula"])
    envelope["explanation"]["numerator_label"] = d.get("numerator_description", envelope["explanation"]["numerator_label"])
    envelope["explanation"]["denominator_label"] = d.get("denominator_description", envelope["explanation"]["denominator_label"])
    envelope["explanation"]["date_basis"] = d.get("date_basis", envelope["explanation"]["date_basis"])
    envelope["explanation"]["known_caveats"] = d.get("known_caveats", envelope["explanation"]["known_caveats"])
    envelope["metric"]["version"] = draft.version_number
    envelope["metric"]["status"] = "draft"
    return envelope


@router.get("/metrics/{metric_id}/compare-versions")
def compare_versions(metric_id: str, db: Session = Depends(get_db), user: dict = Depends(require_metric_editor)):
    """Draft vs. currently published definition — text diff only, since
    execution doesn't change between them (same shape as the Phase 1
    old-vs-new legacy compare, applied to metadata instead of a value)."""
    _metric_or_404(metric_id)
    draft = db.query(models.MetricVersion).filter(
        models.MetricVersion.metric_id == metric_id,
        models.MetricVersion.status == "draft",
    ).order_by(models.MetricVersion.version_number.desc()).first()
    if not draft:
        raise HTTPException(status_code=409, detail="No draft version to compare")

    published = registry.get_metric(metric_id, db)
    d = draft.definition_json or {}
    published_fields = {f: getattr(published, f) for f in _VERSIONABLE_FIELDS}
    draft_fields = {f: d.get(f, published_fields[f]) for f in _VERSIONABLE_FIELDS}
    changed_fields = [f for f in _VERSIONABLE_FIELDS if draft_fields[f] != published_fields[f]]

    return {
        "metric_id": metric_id,
        "published_version": published.version,
        "draft_version": draft.version_number,
        "published": published_fields,
        "draft": draft_fields,
        "changed_fields": changed_fields,
    }


@router.post("/metrics/{metric_id}/publish")
def publish_metric(metric_id: str, db: Session = Depends(get_db), user: dict = Depends(require_metric_publisher)):
    _metric_or_404(metric_id)
    draft = db.query(models.MetricVersion).filter(
        models.MetricVersion.metric_id == metric_id,
        models.MetricVersion.status == "draft",
    ).order_by(models.MetricVersion.version_number.desc()).first()
    if not draft:
        raise HTTPException(status_code=409, detail="No draft version to publish")

    prior_published = db.query(models.MetricVersion).filter(
        models.MetricVersion.metric_id == metric_id,
        models.MetricVersion.status == "published",
    ).first()
    if prior_published:
        prior_published.status = "superseded"

    draft.status = "published"
    draft.published_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(draft)

    log_activity(user_id=user.get("sub"), action_type="METRIC_DEFINITION_PUBLISHED",
                 object_type="metric_version", object_id=draft.id,
                 metadata={"metric_id": metric_id, "version_number": draft.version_number})

    return _serialize(draft)
