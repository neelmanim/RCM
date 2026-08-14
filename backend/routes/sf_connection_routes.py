"""
Salesforce Connection Management Routes (Super Admin only).
Direct credential input — no OAuth.
"""
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from simple_salesforce import Salesforce

from database import get_db
from auth import require_super_admin, require_admin
from crypto import encrypt_token, decrypt_token
import models

router = APIRouter(prefix="/api/admin/sf", tags=["Salesforce Connection"])


@router.get("/status")
def get_sf_connection_status(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Return active SF connection details. Never returns decrypted credentials."""
    conn = db.query(models.SalesforceConnection).filter(
        models.SalesforceConnection.is_active == True
    ).first()

    if not conn:
        # Check if env vars are configured as fallback
        sf_username = os.getenv("SF_USERNAME", "")
        sf_domain = os.getenv("SF_DOMAIN", "login")
        return {
            "connected": bool(sf_username),
            "source": "env_vars" if sf_username else None,
            "username": sf_username,
            "environment": "Production" if sf_domain == "login" else "Sandbox",
            "instance_url": f"https://{sf_domain}.salesforce.com",
            "connection_status": "connected" if sf_username else "disconnected",
            "org_id": None,
            "org_name": None,
            "connected_by": None,
            "connected_at": None,
            "last_sync_at": None,
            "last_sync_status": None,
            "last_sync_error": None,
            "records_synced_last_run": 0,
        }

    return {
        "connected": True,
        "source": "ui",
        "username": conn.username,
        "environment": "Production" if conn.environment == "production" else "Sandbox",
        "instance_url": conn.instance_url,
        "connection_status": conn.connection_status,
        "org_id": conn.org_id,
        "org_name": conn.org_name,
        "connected_by": conn.connected_by_name,
        "connected_at": str(conn.connected_at) if conn.connected_at else None,
        "last_sync_at": str(conn.last_sync_at) if conn.last_sync_at else None,
        "last_sync_status": conn.last_sync_status,
        "last_sync_error": conn.last_sync_error,
        "records_synced_last_run": conn.records_synced_last_run or 0,
    }


@router.post("/connect")
def connect_salesforce(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """
    Connect to Salesforce using direct credentials.
    Validates credentials by creating a test client.
    Encrypts and stores credentials.
    """
    username = body.get("username", "").strip()
    password = body.get("password", "")
    security_token = body.get("security_token", "")
    environment = body.get("environment", "sandbox")

    if not username or not password or not security_token:
        raise HTTPException(status_code=422, detail="Username, password, and security token are required")

    if environment not in ("sandbox", "production"):
        raise HTTPException(status_code=422, detail="Environment must be 'sandbox' or 'production'")

    domain = "test" if environment == "sandbox" else "login"

    # ── Validate credentials by connecting ────────────────────────────────
    try:
        sf = Salesforce(
            username=username,
            password=password,
            security_token=security_token,
            domain=domain,
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to connect to Salesforce: {str(e)}"
        )

    # ── Fetch org info ────────────────────────────────────────────────────
    instance_url = f"https://{sf.sf_instance}" if hasattr(sf, "sf_instance") else None
    org_id = None
    org_name = None
    try:
        org_info = sf.query("SELECT Id, Name FROM Organization LIMIT 1")
        if org_info.get("records"):
            org_id = org_info["records"][0].get("Id")
            org_name = org_info["records"][0].get("Name")
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"[SF Connect] Could not fetch org info: {e}")

    # ── Deactivate existing connections ───────────────────────────────────
    existing = db.query(models.SalesforceConnection).filter(
        models.SalesforceConnection.is_active == True
    ).all()
    for ex in existing:
        ex.is_active = False
        ex.connection_status = "disconnected"

    # ── Encrypt and store ─────────────────────────────────────────────────
    try:
        encrypted_password = encrypt_token(password)
        encrypted_token = encrypt_token(security_token) if security_token else encrypt_token("")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Encryption error: {str(e)}")

    new_conn = models.SalesforceConnection(
        instance_url=instance_url,
        environment=environment,
        username=username,
        password_encrypted=encrypted_password,
        security_token_encrypted=encrypted_token,
        org_id=org_id,
        org_name=org_name,
        connected_by_user_id=admin.get("sub"),
        connected_by_name=admin.get("name"),
        connection_status="connected",
        is_active=True,
    )
    db.add(new_conn)
    db.commit()
    db.refresh(new_conn)

    return {
        "message": "Successfully connected to Salesforce",
        "connection": {
            "id": new_conn.id,
            "username": new_conn.username,
            "environment": environment,
            "instance_url": instance_url,
            "org_id": org_id,
            "org_name": org_name,
            "connected_by": admin.get("name"),
        }
    }


@router.post("/disconnect")
def disconnect_salesforce(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Deactivate the current Salesforce connection."""
    conn = db.query(models.SalesforceConnection).filter(
        models.SalesforceConnection.is_active == True
    ).first()

    if not conn:
        raise HTTPException(status_code=404, detail="No active Salesforce connection")

    conn.is_active = False
    conn.connection_status = "disconnected"
    db.commit()

    return {"message": "Salesforce connection disconnected. System will fall back to environment variables if configured."}


@router.post("/reconnect")
def reconnect_salesforce(db: Session = Depends(get_db), admin: dict = Depends(require_super_admin)):
    """Re-validate stored credentials and update connection status."""
    conn = db.query(models.SalesforceConnection).filter(
        models.SalesforceConnection.is_active == True
    ).first()

    if not conn:
        raise HTTPException(status_code=404, detail="No active Salesforce connection to reconnect")

    try:
        domain = "test" if conn.environment == "sandbox" else "login"
        sf = Salesforce(
            username=conn.username,
            password=decrypt_token(conn.password_encrypted),
            security_token=decrypt_token(conn.security_token_encrypted),
            domain=domain,
        )
        conn.connection_status = "connected"
        if hasattr(sf, "sf_instance"):
            conn.instance_url = f"https://{sf.sf_instance}"
        db.commit()
        return {"message": "Salesforce connection re-validated successfully", "status": "connected"}
    except Exception as e:
        conn.connection_status = "auth_required"
        db.commit()
        raise HTTPException(status_code=400, detail=f"Reconnection failed: {str(e)}")
