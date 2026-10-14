# ── audience_manager.py — (RETIRED) Audience Manager contact sync ───────────
"""
Audience Manager and Converse Integration APIs have been retired.
All external network calls to Audience Manager / converse_integration are disabled.
Stub functions return safe defaults to ensure existing code paths do not fail.
"""
import logging
from typing import Optional, List

logger = logging.getLogger(__name__)


def search_contact(base_url: str, api_key: str, phone: str) -> Optional[dict]:
    """Retired — no-op."""
    return None


def create_contact(base_url: str, api_key: str, user_id: str,
                   first_name: str, last_name: str, phone: str,
                   email: str = "", extra_fields: dict = None) -> Optional[str]:
    """Retired — no-op."""
    return None


def ensure_contact(base_url: str, api_key: str, user_id: str,
                   first_name: str, last_name: str, phone: str,
                   email: str = "", extra_fields: dict = None) -> Optional[str]:
    """Retired — no-op."""
    return None


def update_contact(base_url: str, api_key: str, record_id: str, record_data: dict) -> bool:
    """Retired — no-op."""
    return True


def sync_lead_update_to_am(lead_id):
    """Retired — no-op."""
    return


_STATUS_TO_STAGE = {
    "Lead Assigned": "New",
    "Research": "New",
    "Calling": "Working",
    "Pending Review": "Working",
    "Meeting Scheduled": "Meeting Scheduled",
    "1st Discovery Meeting": "Meeting Scheduled",
    "Discovery Complete": "Meeting Scheduled",
    "Demo Scheduled": "Meeting Scheduled",
    "Demo Done": "Demo Done",
    "Completed": "Won",
    "Disqualified": "Lost",
    "Customer Declined": "Lost",
    "Unreachable": "Lost",
    "No Phone - Parked": "Lost",
}


def lifecycle_stage_for_status(status: str) -> str:
    return _STATUS_TO_STAGE.get(status, "New")


def owner_names(lead) -> str:
    return ", ".join(u.name for u in getattr(lead, "assigned_users", []) if u.name)


def lead_extra_fields(lead, db=None) -> dict:
    group = None
    if db and getattr(lead, "pod_id", None):
        import models
        pod = db.query(models.Pod).filter(models.Pod.id == lead.pod_id).first()
        if pod:
            group = pod.name
    return {
        "unique_id": getattr(lead, "id", None),
        "status": getattr(lead, "status", None),
        "lifecycle_stage": lifecycle_stage_for_status(getattr(lead, "status", "")),
        "owner": owner_names(lead) or None,
        "group": group,
        "state": getattr(lead, "state", None) or None,
        "country": getattr(lead, "country", None) or None,
        "city": getattr(lead, "city", None) or None,
    }


def sync_leads_to_am_background(lead_ids: List[int]):
    """Retired — no-op."""
    return
