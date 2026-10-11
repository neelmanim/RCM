"""
Activity and miscellaneous models: UserActivityLog, Feedback, CompanyResearch, LeadAttachment.
"""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, Integer, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from models.base import generate_uuid


class UserActivityLog(Base):
    """Fire-and-forget activity log for SDR/admin actions."""
    __tablename__ = "user_activity_logs"

    id          = Column(String, primary_key=True, default=generate_uuid)
    user_id     = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email  = Column(String, nullable=True)
    user_name   = Column(String, nullable=True)
    action_type = Column(String, nullable=False, index=True)
    object_type = Column(String, nullable=True)
    object_id   = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class UserActivityDailySummary(Base):
    """Pre-aggregated daily metrics per user."""
    __tablename__ = "user_activity_daily_summary"

    id              = Column(String, primary_key=True, default=generate_uuid)
    summary_date    = Column(String, nullable=False, index=True)
    user_id         = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email      = Column(String, nullable=True)
    user_name       = Column(String, nullable=True)
    login_count     = Column(Integer, default=0)
    lead_views      = Column(Integer, default=0)
    status_updates  = Column(Integer, default=0)
    meetings_scheduled = Column(Integer, default=0)
    calls_logged    = Column(Integer, default=0)
    leads_assigned  = Column(Integer, default=0)
    exports         = Column(Integer, default=0)
    total_actions   = Column(Integer, default=0)
    time_spent_minutes = Column(Integer, default=0)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())


class Feedback(Base):
    """Stores user-submitted feedback, bug reports, and feature requests."""
    __tablename__ = "feedback"

    id         = Column(String, primary_key=True, default=generate_uuid)
    user_id    = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_email = Column(String, nullable=True)
    user_name  = Column(String, nullable=True)
    type       = Column(String, nullable=False, default="general")
    message    = Column(Text, nullable=False)
    status     = Column(String, default="new")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", backref="feedback_entries")


class CompanyResearch(Base):
    """Caches AI-generated research per company name."""
    __tablename__ = "company_research"

    id                = Column(String, primary_key=True, default=generate_uuid)
    company_name      = Column(String, nullable=False, unique=True, index=True)
    research_company  = Column(Text, nullable=True)
    research_industry = Column(String, nullable=True)
    research_company_size = Column(String, nullable=True)
    research_services = Column(Text, nullable=True)
    research_geo      = Column(String, nullable=True)
    research_timezone = Column(String, nullable=True)
    research_hook     = Column(Text, nullable=True)
    research_hypothesis = Column(Text, nullable=True)
    research_personalization = Column(Text, nullable=True)
    research_contact  = Column(Text, nullable=True)
    research_channels = Column(Text, nullable=True)
    raw_ai_response   = Column(Text, nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LeadAttachment(Base):
    """File attachments uploaded by SDRs for a lead."""
    __tablename__ = "lead_attachments"

    id               = Column(String, primary_key=True, default=generate_uuid)
    lead_id          = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id          = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    original_filename = Column(String, nullable=False)
    stored_filename  = Column(String, nullable=False)
    file_size        = Column(BigInteger, default=0)
    mime_type        = Column(String, nullable=True)
    uploaded_by_name = Column(String, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="attachments")
    user = relationship("User")
