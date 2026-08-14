"""
Organization models: Pod, SyncSettings, LeadUploadLog.
"""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from models.base import generate_uuid


class Pod(Base):
    """A POD is a team of SDRs managed by a Pod Admin."""
    __tablename__ = "pods"

    id              = Column(String, primary_key=True, default=generate_uuid)
    name            = Column(String, nullable=False)
    admin_id        = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    active_lead_cap = Column(Integer, default=500, nullable=False)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    admin   = relationship("User", foreign_keys=[admin_id], backref="admin_of_pods")
    members = relationship("User", back_populates="pod", foreign_keys="User.pod_id")


class SyncSettings(Base):
    """Single-row configuration for Salesforce lead sync and global settings."""
    __tablename__ = "sync_settings"

    id               = Column(Integer, primary_key=True, default=1)
    lead_limit       = Column(Integer, default=1000, nullable=False)
    record_type_ids  = Column(Text, nullable=True)
    sf_push_stage    = Column(String, default="Meeting Scheduled")
    sync_direction   = Column(String, default="push_only")
    allow_multi_pod_sdr = Column(Boolean, default=False, nullable=False, server_default="false")

    # Configurable caps & attempt limits
    active_lead_cap                  = Column(Integer, default=5, nullable=False)
    max_call_attempts                = Column(Integer, default=5, nullable=False)
    min_call_attempts_for_unreachable = Column(Integer, default=3, nullable=False)
    sync_declined_to_salesforce      = Column(Boolean, default=False, nullable=False)
    sync_unreachable_to_salesforce   = Column(Boolean, default=False, nullable=False)
    terminal_lead_cooldown_days      = Column(Integer, default=30, nullable=False)

    # AI / LLM settings
    llm_provider    = Column(String, default="groq", nullable=False)
    llm_api_key     = Column(Text, nullable=True)
    llm_model       = Column(String, default="llama-3.3-70b-versatile", nullable=False)

    # Dialer settings
    dialer_provider      = Column(String, default="none", nullable=False)
    dialer_api_id        = Column(String, nullable=True)
    dialer_api_token     = Column(Text, nullable=True)
    dialer_webhook_token = Column(String, nullable=True)

    # RCM settings
    rcm_enabled     = Column(Boolean, default=False, nullable=False, server_default="false")
    rcm_base_url    = Column(String, default="https://app.rcm-messaging.com", nullable=True)
    rcm_api_key     = Column(String, nullable=True)
    rcm_user_id     = Column(String, nullable=True)
    rcm_access_token = Column(Text, nullable=True)

    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LeadUploadLog(Base):
    """Tracks every enriched lead sheet upload."""
    __tablename__ = "lead_upload_logs"

    id           = Column(String, primary_key=True, default=generate_uuid)
    uploaded_by  = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    filename     = Column(String, nullable=True)
    total_rows   = Column(Integer, default=0)
    created      = Column(Integer, default=0)
    skipped      = Column(Integer, default=0)
    updated      = Column(Integer, default=0)
    errors       = Column(Integer, default=0)
    error_detail = Column(Text, nullable=True)
    status       = Column(String, default="completed")
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    uploader = relationship("User", foreign_keys=[uploaded_by])
