# ── sf_logger.py — Centralized Salesforce integration logging ─────────────────
import json
from datetime import datetime, timezone
from database import SessionLocal
import models


def log_sf_operation(
    db=None,
    operation_type: str = "unknown",
    sf_object: str = "Lead",
    record_identifier: str = None,
    first_name: str = None,
    last_name: str = None,
    email: str = None,
    fields_updated: list = None,
    status: str = "success",
    error_message: str = None,
    request_payload: dict = None,
    response_payload: dict = None,
    source_system: str = "api",
):
    """
    Create a log entry for a Salesforce API operation.
    
    Can be called from request threads (pass db) or background threads (db=None → uses SessionLocal).
    """
    def _safe_json(obj):
        if obj is None:
            return None
        try:
            return json.dumps(obj, default=str)
        except Exception:
            return str(obj)

    entry = models.SalesforceIntegrationLog(
        operation_type=operation_type,
        sf_object=sf_object,
        record_identifier=record_identifier,
        first_name=first_name,
        last_name=last_name,
        email=email,
        fields_updated=_safe_json(fields_updated),
        status=status,
        error_message=str(error_message) if error_message else None,
        request_payload=_safe_json(request_payload),
        response_payload=_safe_json(response_payload),
        source_system=source_system,
    )

    try:
        if db:
            db.add(entry)
            db.commit()
        else:
            # Background thread — create own session
            with SessionLocal() as thread_db:
                thread_db.add(entry)
                thread_db.commit()
    except Exception as e:
        # Logging should never crash the main application
        print(f"[SF Logger] Failed to write log: {e}")
