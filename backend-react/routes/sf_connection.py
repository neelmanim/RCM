"""Salesforce connection management routes (Super Admin only)."""
import os, logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from middleware import require_super_admin, require_admin
from utils.crypto import encrypt_token, decrypt_token
from models import SalesforceConnection

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/sf", tags=["Salesforce Connection"])


@router.get("/status")
def get_sf_status(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    conn = db.query(SalesforceConnection).filter(SalesforceConnection.is_active == True).first()
    if not conn:
        sf_user = os.getenv("SF_USERNAME", "")
        sf_domain = os.getenv("SF_DOMAIN", "login")
        return {"connected": bool(sf_user), "source": "env_vars" if sf_user else None, "username": sf_user, "environment": "Production" if sf_domain == "login" else "Sandbox", "instance_url": f"https://{sf_domain}.salesforce.com", "connection_status": "connected" if sf_user else "disconnected", "org_id": None, "org_name": None, "connected_by": None, "connected_at": None, "last_sync_at": None, "last_sync_status": None, "last_sync_error": None, "records_synced_last_run": 0}
    return {"connected": True, "source": "ui", "username": conn.username, "environment": "Production" if conn.environment == "production" else "Sandbox", "instance_url": conn.instance_url, "connection_status": conn.connection_status, "org_id": conn.org_id, "org_name": conn.org_name, "connected_by": conn.connected_by_name, "connected_at": str(conn.connected_at) if conn.connected_at else None, "last_sync_at": str(conn.last_sync_at) if conn.last_sync_at else None, "last_sync_status": conn.last_sync_status, "last_sync_error": conn.last_sync_error, "records_synced_last_run": conn.records_synced_last_run or 0}


@router.post("/connect")
def connect_salesforce(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    username = body.get("username", "").strip()
    password = body.get("password", "")
    security_token = body.get("security_token", "")
    environment = body.get("environment", "sandbox")
    if not username or not password or not security_token:
        raise HTTPException(status_code=422, detail="Username, password, and security token required")
    if environment not in ("sandbox", "production"):
        raise HTTPException(status_code=422, detail="Environment must be 'sandbox' or 'production'")
    domain = "test" if environment == "sandbox" else "login"
    try:
        from simple_salesforce import Salesforce
        sf = Salesforce(username=username, password=password, security_token=security_token, domain=domain)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to connect: {e}")
    instance_url = f"https://{sf.sf_instance}" if hasattr(sf, "sf_instance") else None
    org_id = org_name = None
    try:
        info = sf.query("SELECT Id, Name FROM Organization LIMIT 1")
        if info.get("records"):
            org_id = info["records"][0].get("Id"); org_name = info["records"][0].get("Name")
    except Exception: pass

    for ex in db.query(SalesforceConnection).filter(SalesforceConnection.is_active == True).all():
        ex.is_active = False; ex.connection_status = "disconnected"
    conn = SalesforceConnection(instance_url=instance_url, environment=environment, username=username, password_encrypted=encrypt_token(password), security_token_encrypted=encrypt_token(security_token or ""), org_id=org_id, org_name=org_name, connected_by_user_id=admin.get("sub"), connected_by_name=admin.get("name"), connection_status="connected", is_active=True)
    db.add(conn); db.commit(); db.refresh(conn)
    return {"message": "Connected to Salesforce", "connection": {"id": conn.id, "username": conn.username, "environment": environment, "instance_url": instance_url, "org_id": org_id, "org_name": org_name}}


@router.post("/disconnect")
def disconnect_salesforce(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    conn = db.query(SalesforceConnection).filter(SalesforceConnection.is_active == True).first()
    if not conn: raise HTTPException(status_code=404, detail="No active connection")
    conn.is_active = False; conn.connection_status = "disconnected"; db.commit()
    return {"message": "Salesforce disconnected."}


@router.post("/reconnect")
def reconnect_salesforce(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    conn = db.query(SalesforceConnection).filter(SalesforceConnection.is_active == True).first()
    if not conn: raise HTTPException(status_code=404, detail="No active connection to reconnect")
    try:
        from simple_salesforce import Salesforce
        domain = "test" if conn.environment == "sandbox" else "login"
        sf = Salesforce(username=conn.username, password=decrypt_token(conn.password_encrypted), security_token=decrypt_token(conn.security_token_encrypted), domain=domain)
        conn.connection_status = "connected"
        if hasattr(sf, "sf_instance"): conn.instance_url = f"https://{sf.sf_instance}"
        db.commit()
        return {"message": "Re-validated successfully", "status": "connected"}
    except Exception as e:
        conn.connection_status = "auth_required"; db.commit()
        raise HTTPException(status_code=400, detail=f"Reconnection failed: {e}")
