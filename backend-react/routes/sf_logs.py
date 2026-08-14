"""Salesforce integration logs — list, detail, CSV export."""
import csv, io, json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database import get_db
from middleware import require_admin
from models import SalesforceIntegrationLog

router = APIRouter(prefix="/api/admin", tags=["SF Logs"])


def _to_summary(log):
    return {"id": log.id, "timestamp": str(log.timestamp) if log.timestamp else None, "operation_type": log.operation_type, "sf_object": log.sf_object, "record_identifier": log.record_identifier, "first_name": log.first_name, "last_name": log.last_name, "email": log.email, "fields_updated": log.fields_updated, "status": log.status, "error_message": log.error_message, "source_system": log.source_system}


def _to_detail(log):
    def _pj(s):
        if not s: return None
        try: return json.loads(s)
        except Exception: return s
    return {**_to_summary(log), "fields_updated": _pj(log.fields_updated), "request_payload": _pj(log.request_payload), "response_payload": _pj(log.response_payload)}


@router.get("/sf-logs")
def list_sf_logs(page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=100), status: str = None, operation_type: str = None, sf_object: str = None, date_from: str = None, date_to: str = None, search: str = None, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    q = db.query(SalesforceIntegrationLog).order_by(desc(SalesforceIntegrationLog.timestamp))
    if status: q = q.filter(SalesforceIntegrationLog.status == status)
    if operation_type: q = q.filter(SalesforceIntegrationLog.operation_type == operation_type)
    if sf_object: q = q.filter(SalesforceIntegrationLog.sf_object == sf_object)
    if date_from: q = q.filter(SalesforceIntegrationLog.timestamp >= date_from)
    if date_to: q = q.filter(SalesforceIntegrationLog.timestamp <= date_to)
    if search:
        p = f"%{search}%"
        q = q.filter((SalesforceIntegrationLog.record_identifier.ilike(p)) | (SalesforceIntegrationLog.email.ilike(p)) | (SalesforceIntegrationLog.first_name.ilike(p)) | (SalesforceIntegrationLog.last_name.ilike(p)))
    total = q.count()
    logs = q.offset((page - 1) * per_page).limit(per_page).all()
    return {"logs": [_to_summary(l) for l in logs], "total": total, "page": page, "per_page": per_page, "total_pages": max(1, (total + per_page - 1) // per_page)}


@router.get("/sf-logs/export")
def export_sf_logs_csv(status: str = None, operation_type: str = None, sf_object: str = None, date_from: str = None, date_to: str = None, search: str = None, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    q = db.query(SalesforceIntegrationLog).order_by(desc(SalesforceIntegrationLog.timestamp))
    if status: q = q.filter(SalesforceIntegrationLog.status == status)
    if operation_type: q = q.filter(SalesforceIntegrationLog.operation_type == operation_type)
    if sf_object: q = q.filter(SalesforceIntegrationLog.sf_object == sf_object)
    if date_from: q = q.filter(SalesforceIntegrationLog.timestamp >= date_from)
    if date_to: q = q.filter(SalesforceIntegrationLog.timestamp <= date_to)
    if search:
        p = f"%{search}%"
        q = q.filter((SalesforceIntegrationLog.record_identifier.ilike(p)) | (SalesforceIntegrationLog.email.ilike(p)))
    logs = q.limit(5000).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Timestamp", "Operation", "Object", "Record ID", "First Name", "Last Name", "Email", "Fields Updated", "Status", "Error Message", "Source", "Request", "Response"])
    for l in logs:
        writer.writerow([str(l.timestamp) if l.timestamp else "", l.operation_type, l.sf_object, l.record_identifier, l.first_name, l.last_name, l.email, l.fields_updated, l.status, l.error_message or "", l.source_system, l.request_payload, l.response_payload])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=sf_logs.csv"})


@router.get("/sf-logs/{log_id}")
def get_sf_log_detail(log_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    log = db.query(SalesforceIntegrationLog).filter(SalesforceIntegrationLog.id == log_id).first()
    if not log: raise HTTPException(status_code=404, detail="Log not found")
    return _to_detail(log)
