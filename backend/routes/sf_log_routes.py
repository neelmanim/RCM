# ── routes/sf_log_routes.py — Salesforce Integration Logs API ─────────────────
import json
import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc

import models
from database import get_db
from auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["SF Logs"])


@router.get("/sf-logs")
def list_sf_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: str = None,
    operation_type: str = None,
    sf_object: str = None,
    date_from: str = None,
    date_to: str = None,
    search: str = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """List SF integration logs with filters and pagination."""
    query = db.query(models.SalesforceIntegrationLog).order_by(
        desc(models.SalesforceIntegrationLog.timestamp)
    )

    if status:
        query = query.filter(models.SalesforceIntegrationLog.status == status)
    if operation_type:
        query = query.filter(models.SalesforceIntegrationLog.operation_type == operation_type)
    if sf_object:
        query = query.filter(models.SalesforceIntegrationLog.sf_object == sf_object)
    if date_from:
        query = query.filter(models.SalesforceIntegrationLog.timestamp >= date_from)
    if date_to:
        query = query.filter(models.SalesforceIntegrationLog.timestamp <= date_to)
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            (models.SalesforceIntegrationLog.record_identifier.ilike(search_pattern)) |
            (models.SalesforceIntegrationLog.email.ilike(search_pattern)) |
            (models.SalesforceIntegrationLog.first_name.ilike(search_pattern)) |
            (models.SalesforceIntegrationLog.last_name.ilike(search_pattern))
        )

    total = query.count()
    logs = query.offset((page - 1) * per_page).limit(per_page).all()

    return {
        "logs": [_log_to_summary(log) for log in logs],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": max(1, (total + per_page - 1) // per_page),
    }


@router.get("/sf-logs/export")
def export_sf_logs_csv(
    status: str = None,
    operation_type: str = None,
    sf_object: str = None,
    date_from: str = None,
    date_to: str = None,
    search: str = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Export filtered SF logs as CSV download."""
    query = db.query(models.SalesforceIntegrationLog).order_by(
        desc(models.SalesforceIntegrationLog.timestamp)
    )

    if status:
        query = query.filter(models.SalesforceIntegrationLog.status == status)
    if operation_type:
        query = query.filter(models.SalesforceIntegrationLog.operation_type == operation_type)
    if sf_object:
        query = query.filter(models.SalesforceIntegrationLog.sf_object == sf_object)
    if date_from:
        query = query.filter(models.SalesforceIntegrationLog.timestamp >= date_from)
    if date_to:
        query = query.filter(models.SalesforceIntegrationLog.timestamp <= date_to)
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            (models.SalesforceIntegrationLog.record_identifier.ilike(search_pattern)) |
            (models.SalesforceIntegrationLog.email.ilike(search_pattern))
        )

    logs = query.limit(5000).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Timestamp", "Operation", "Object", "Record ID", "First Name", "Last Name", "Email",
                     "Fields Updated", "Status", "Error Message", "Source", "Request Payload", "Response Payload"])
    for log in logs:
        writer.writerow([
            str(log.timestamp) if log.timestamp else "",
            log.operation_type, log.sf_object, log.record_identifier,
            log.first_name, log.last_name, log.email,
            log.fields_updated, log.status, log.error_message or "",
            log.source_system, log.request_payload, log.response_payload,
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sf_integration_logs.csv"},
    )


@router.get("/sf-logs/{log_id}")
def get_sf_log_detail(
    log_id: str,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Get full details of a single SF integration log."""
    log = db.query(models.SalesforceIntegrationLog).filter(
        models.SalesforceIntegrationLog.id == log_id
    ).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    return _log_to_detail(log)


def _log_to_summary(log):
    """Lightweight dict for list view."""
    return {
        "id": log.id,
        "timestamp": str(log.timestamp) if log.timestamp else None,
        "operation_type": log.operation_type,
        "sf_object": log.sf_object,
        "record_identifier": log.record_identifier,
        "first_name": log.first_name,
        "last_name": log.last_name,
        "email": log.email,
        "fields_updated": log.fields_updated,
        "status": log.status,
        "error_message": log.error_message,
        "source_system": log.source_system,
    }


def _log_to_detail(log):
    """Full dict for detail view with payloads."""
    def _parse_json(s):
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            return s

    return {
        "id": log.id,
        "timestamp": str(log.timestamp) if log.timestamp else None,
        "operation_type": log.operation_type,
        "sf_object": log.sf_object,
        "record_identifier": log.record_identifier,
        "first_name": log.first_name,
        "last_name": log.last_name,
        "email": log.email,
        "fields_updated": _parse_json(log.fields_updated),
        "status": log.status,
        "error_message": log.error_message,
        "request_payload": _parse_json(log.request_payload),
        "response_payload": _parse_json(log.response_payload),
        "source_system": log.source_system,
    }
