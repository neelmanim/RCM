"""
Models package — re-exports all models for convenient imports.

Usage:
    from models import Lead, User, Pod, CallLog, ...
"""
from models.base import generate_uuid
from models.user import User, AllowedUser, Role, LoginLog, log_user_login
from models.lead import (
    Lead, Note, Task, CallLog, LeadStatusLog,
    lead_assignments, log_status_change,
    Status, CallOutcome,
    TERMINAL_STATUSES, ACTIVE_STATUSES, LEGACY_STATUSES,
    ANSWERED_OUTCOMES, NOT_ANSWERED_OUTCOMES, TERMINAL_OUTCOMES,
    ATTEMPT_OUTCOMES, COMPANY_RESOLVED_OUTCOMES, LEGACY_OUTCOME_MAP,
    STATUS_ORDER, RESEARCH_FIELDS,
)
from models.communication import (
    DialerCall, NylasConfig, UserMailbox, LeadEmailActivity, EmailThread,
)
from models.organization import Pod, SyncSettings, LeadUploadLog
from models.integration import SalesforceConnection, SalesforceIntegrationLog
from models.activity import (
    UserActivityLog, UserActivityDailySummary,
    Feedback, CompanyResearch, LeadAttachment,
)

__all__ = [
    # Base
    "generate_uuid",
    # User
    "User", "AllowedUser", "Role", "LoginLog", "log_user_login",
    # Lead
    "Lead", "Note", "Task", "CallLog", "LeadStatusLog",
    "lead_assignments", "log_status_change",
    "Status", "CallOutcome",
    "TERMINAL_STATUSES", "ACTIVE_STATUSES", "LEGACY_STATUSES",
    "ANSWERED_OUTCOMES", "NOT_ANSWERED_OUTCOMES", "TERMINAL_OUTCOMES",
    "ATTEMPT_OUTCOMES", "COMPANY_RESOLVED_OUTCOMES", "LEGACY_OUTCOME_MAP",
    "STATUS_ORDER", "RESEARCH_FIELDS",
    # Communication
    "DialerCall", "NylasConfig", "UserMailbox", "LeadEmailActivity", "EmailThread",
    # Organization
    "Pod", "SyncSettings", "LeadUploadLog",
    # Integration
    "SalesforceConnection", "SalesforceIntegrationLog",
    # Activity
    "UserActivityLog", "UserActivityDailySummary",
    "Feedback", "CompanyResearch", "LeadAttachment",
]
