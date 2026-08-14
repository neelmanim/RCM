"""
Lead and related models: Lead, Note, Task, CallLog, LeadStatusLog.
"""
import enum
from sqlalchemy import Column, String, DateTime, ForeignKey, Table, Text, Boolean, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from models.base import generate_uuid


# ── Association Table ────────────────────────────────────────────────────────
lead_assignments = Table(
    'lead_assignments', Base.metadata,
    Column('user_id', String, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    Column('lead_id', String, ForeignKey('leads.id', ondelete='CASCADE'), primary_key=True),
    Column('assigned_at', DateTime(timezone=True), server_default=func.now()),
    extend_existing=True,
)


# ── Enums ────────────────────────────────────────────────────────────────────
class Status(str, enum.Enum):
    Lead_Assigned       = "Lead Assigned"
    Research            = "Research"
    Calling             = "Calling"
    Meeting_Scheduled   = "Meeting Scheduled"
    Disqualified        = "Disqualified"

TERMINAL_STATUSES = {"Meeting Scheduled", "Disqualified"}
ACTIVE_STATUSES   = {"Lead Assigned", "Research", "Calling"}
LEGACY_STATUSES   = {"Customer Declined", "Unreachable"}

class CallOutcome(str, enum.Enum):
    Call_Back_Later       = "Call Back Later"
    Meeting_Scheduled     = "Meeting Scheduled"
    Meeting_Confirmed     = "Meeting Confirmed"
    Text_Me               = "Text Me"
    Not_Right_Person      = "Not the Right Person"
    Referred_Someone_Else = "Referred Someone Else"
    No_Answer             = "No Answer"
    Left_Voicemail        = "Left Voicemail"
    Wrong_Number          = "Wrong Number"
    Not_Interested        = "Not Interested"
    Unreachable           = "Unreachable"

ANSWERED_OUTCOMES     = {"Call Back Later", "Meeting Scheduled", "Meeting Confirmed",
                         "Text Me", "Not the Right Person", "Referred Someone Else"}
NOT_ANSWERED_OUTCOMES = {"No Answer", "Left Voicemail", "Wrong Number"}
TERMINAL_OUTCOMES     = {"Not Interested", "Unreachable"}
ATTEMPT_OUTCOMES      = {"No Answer", "Left Voicemail", "Wrong Number", "Unreachable"}
COMPANY_RESOLVED_OUTCOMES = {"Meeting Scheduled", "Meeting Confirmed"}

LEGACY_OUTCOME_MAP = {
    "Call Completed":      "Meeting Scheduled",
    "Customer Declined":   "Not Interested",
    "Callback Scheduled":  "Call Back Later",
}

STATUS_ORDER = ["Lead Assigned", "Research", "Calling", "Meeting Scheduled"]

RESEARCH_FIELDS = [
    "research_company", "research_contact", "research_hypothesis", "research_personalization",
    "research_industry", "research_company_size", "research_services",
    "research_geo", "research_timezone", "research_hook", "research_channels",
]


# ── Lead Model ───────────────────────────────────────────────────────────────
class Lead(Base):
    __tablename__ = "leads"

    id              = Column(String, primary_key=True, default=generate_uuid)
    sf_lead_id      = Column(String, unique=True, index=True, nullable=True)
    first_name      = Column(String)
    last_name       = Column(String, nullable=False)
    email           = Column(String)
    phone           = Column(String)
    phone_secondary = Column(String, nullable=True)
    company         = Column(String)
    title           = Column(String)
    status          = Column(String, default="Lead Assigned")
    lead_source     = Column(String, default="salesforce")
    record_type_id  = Column(String, nullable=True)
    pod_id          = Column(String, ForeignKey("pods.id", ondelete="SET NULL"), nullable=True)

    # Enrichment fields
    linkedin_url         = Column(String, nullable=True)
    person_linkedin      = Column(String, nullable=True)
    website              = Column(String, nullable=True)
    city                 = Column(String, nullable=True)
    state                = Column(String, nullable=True)
    country              = Column(String, nullable=True)
    industry             = Column(String, nullable=True)
    employee_count       = Column(Integer, nullable=True)
    annual_revenue       = Column(String, nullable=True)
    total_funding        = Column(String, nullable=True)
    company_phone        = Column(String, nullable=True)
    company_linkedin     = Column(String, nullable=True)
    company_street       = Column(String, nullable=True)
    company_city         = Column(String, nullable=True)
    company_postal_code  = Column(String, nullable=True)
    company_state        = Column(String, nullable=True)
    company_country      = Column(String, nullable=True)
    company_founded      = Column(String, nullable=True)

    # Research fields
    research_company         = Column(Text, nullable=True)
    research_contact         = Column(Text, nullable=True)
    research_hypothesis      = Column(Text, nullable=True)
    research_personalization = Column(Text, nullable=True)
    research_industry        = Column(String, nullable=True)
    research_company_size    = Column(String, nullable=True)
    research_services        = Column(Text, nullable=True)
    research_geo             = Column(String, nullable=True)
    research_timezone        = Column(String, nullable=True)
    research_hook            = Column(Text, nullable=True)
    research_channels        = Column(Text, nullable=True)

    # Lifecycle tracking
    call_attempt_count  = Column(Integer, default=0, nullable=False)
    no_show_count       = Column(Integer, default=0, nullable=False)
    last_call_timestamp = Column(DateTime(timezone=True), nullable=True)
    lead_started_at     = Column(DateTime(timezone=True), nullable=True)
    priority_score      = Column(Integer, default=100, nullable=False, server_default="100")
    lead_closed_at      = Column(DateTime(timezone=True), nullable=True)
    closed_reason       = Column(String, nullable=True)

    # Audience Manager
    am_record_id        = Column(String, nullable=True)

    # Opportunity outcome
    opportunity_status     = Column(String, nullable=True)
    opportunity_notes      = Column(Text, nullable=True)
    opportunity_updated_at = Column(DateTime(timezone=True), nullable=True)
    opportunity_updated_by = Column(String, nullable=True)

    status_changed_at = Column(DateTime(timezone=True), server_default=func.now())
    last_synced_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    assigned_users = relationship("User", secondary=lead_assignments, back_populates="assigned_leads")
    notes          = relationship("Note", back_populates="lead", cascade="all, delete-orphan", order_by="Note.created_at.desc()")
    tasks          = relationship("Task", back_populates="lead", cascade="all, delete-orphan", order_by="Task.created_at.asc()")
    call_logs      = relationship("CallLog", back_populates="lead", cascade="all, delete-orphan", order_by="CallLog.called_at.desc()")
    status_logs    = relationship("LeadStatusLog", back_populates="lead", cascade="all, delete-orphan", order_by="LeadStatusLog.changed_at.desc()")
    attachments    = relationship("LeadAttachment", back_populates="lead", cascade="all, delete-orphan", order_by="LeadAttachment.created_at.desc()")


class Note(Base):
    __tablename__ = "notes"

    id         = Column(String, primary_key=True, default=generate_uuid)
    lead_id    = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    content    = Column(String, nullable=False)
    author     = Column(String, default="You")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="notes")


class Task(Base):
    __tablename__ = "tasks"

    id            = Column(String, primary_key=True, default=generate_uuid)
    lead_id       = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    user_id       = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title         = Column(String, nullable=False)
    done          = Column(String, default="false")
    due_date      = Column(String)
    due_time      = Column(DateTime(timezone=True), nullable=True)
    snoozed_until = Column(DateTime(timezone=True), nullable=True)
    dismissed     = Column(String, default="false")
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="tasks")
    user = relationship("User", foreign_keys=[user_id])


class CallLog(Base):
    """Records every call attempt an SDR makes on a lead."""
    __tablename__ = "call_logs"

    id         = Column(String, primary_key=True, default=generate_uuid)
    lead_id    = Column(String, ForeignKey("leads.id",  ondelete="CASCADE"), nullable=False)
    user_id    = Column(String, ForeignKey("users.id",  ondelete="SET NULL"), nullable=True)
    outcome    = Column(String, nullable=False)
    notes      = Column(Text)
    called_at  = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="call_logs")
    user = relationship("User", back_populates="call_logs")


class LeadStatusLog(Base):
    """Audit trail for every lead status transition."""
    __tablename__ = "lead_status_logs"

    id          = Column(String, primary_key=True, default=generate_uuid)
    lead_id     = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    from_status = Column(String, nullable=True)
    to_status   = Column(String, nullable=False)
    changed_by  = Column(String, nullable=True)
    changed_at  = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="status_logs")


def log_status_change(db, lead_id, from_status, to_status, changed_by="system"):
    """Reusable helper — call from any service to record a status transition."""
    entry = LeadStatusLog(
        lead_id=lead_id,
        from_status=from_status,
        to_status=to_status,
        changed_by=changed_by,
    )
    db.add(entry)
    return entry
