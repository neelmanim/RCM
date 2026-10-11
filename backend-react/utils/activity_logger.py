"""
Fire-and-forget activity logger for SDR/admin actions.
All errors are swallowed — never blocks the caller.
"""
import json
import logging

logger = logging.getLogger(__name__)

ACTION_TYPES = {
    "LOGIN":                 ["ip_address", "user_agent"],
    "VIEW_LEAD":             ["lead_name"],
    "UPDATE_LEAD_STATUS":    ["lead_name", "from_status", "to_status"],
    "SCHEDULE_MEETING":      ["lead_name"],
    "ASSIGN_LEAD":           ["lead_name", "sdr_name"],
    "LOG_CALL":              ["lead_name", "outcome"],
    "MANUAL_SYNC_TRIGGERED": [],
    "EXPORT_DATA":           ["format", "record_count"],
}


def log_activity(user_id: str, action_type: str,
                 user_email: str = None, user_name: str = None,
                 object_type: str = None, object_id: str = None,
                 metadata: dict = None):
    """Log a user activity. Fire-and-forget — never raises."""
    try:
        from database import SessionLocal
        from models import UserActivityLog

        if action_type not in ACTION_TYPES:
            logger.warning(f"[Activity] Unknown action_type: {action_type}")
            return

        metadata_json = json.dumps(metadata) if metadata else None

        db = SessionLocal()
        try:
            entry = UserActivityLog(
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
        logger.error(f"[Activity] Critical logging failure: {e}")
