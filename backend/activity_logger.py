"""
Fire-and-forget activity logger for SDR/admin actions.
All errors are swallowed and logged to console — never blocks the caller.
"""
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Valid action types and their expected metadata fields
ACTION_TYPES = {
    "LOGIN":                 ["ip_address", "user_agent"],
    "VIEW_LEAD":             ["lead_name"],
    "CREATE_LEAD":           ["lead_name"],
    "UPDATE_LEAD_STATUS":    ["lead_name", "from_status", "to_status"],
    "SCHEDULE_MEETING":      ["lead_name"],
    "ASSIGN_LEAD":           ["lead_name", "sdr_name"],
    "LOG_CALL":              ["lead_name", "outcome"],
    "DIALER_CALL":           ["lead_id", "provider", "phone"],
    "ADD_DISCOVERY":         ["lead_name", "discovery_count"],
    "MANUAL_SYNC_TRIGGERED": [],
    "EXPORT_DATA":           ["format", "record_count"],
    # Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md)
    "JOURNEY_CREATED":       ["journey_name"],
    "JOURNEY_PUBLISHED":     ["journey_name", "version_number"],
    "JOURNEY_ENROLLED":      ["journey_id", "lead_id"],
    "JOURNEY_ARCHIVED":      ["journey_name", "enrollments_exited"],
    "JOURNEY_PAUSED":        ["journey_name"],
    "JOURNEY_RESUMED":       ["journey_name"],
    "JOURNEY_ENROLLMENT_RETRIED": ["journey_id", "enrollment_id"],
    "JOURNEY_ENROLLMENT_SKIPPED": ["journey_id", "enrollment_id"],
}


def log_activity(user_id: str, action_type: str,
                 user_email: str = None, user_name: str = None,
                 object_type: str = None, object_id: str = None,
                 metadata: dict = None):
    """
    Log a user activity. Fire-and-forget — never raises.

    Args:
        user_id: The acting user's ID
        action_type: One of ACTION_TYPES keys
        user_email: Optional user email for denormalized lookup
        user_name: Optional user name
        object_type: e.g. "lead", "call", "sync"
        object_id: e.g. lead ID
        metadata: Additional context dict (validated against ACTION_TYPES schema)
    """
    try:
        from database import SessionLocal
        import models

        if action_type not in ACTION_TYPES:
            logger.warning(f"[Activity] Unknown action_type: {action_type}")
            return

        metadata_json = json.dumps(metadata) if metadata else None

        db = SessionLocal()
        try:
            entry = models.UserActivityLog(
                user_id=user_id,
                user_email=user_email,
                user_name=user_name,
                action_type=action_type,
                object_type=object_type,
                object_id=object_id,
                metadata_json=metadata_json,
            )
            db.add(entry)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"[Activity] Failed to log {action_type}: {e}")
        finally:
            db.close()
    except Exception as e:
        # Absolutely never let logging failures propagate
        logger.error(f"[Activity] Critical logging failure: {e}")
