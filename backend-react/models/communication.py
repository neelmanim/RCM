"""
Communication models: DialerCall, LeadEmailActivity, EmailThread, NylasConfig, UserMailbox.
"""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from models.base import generate_uuid


class DialerCall(Base):
    """Unified call record from any dialer provider (Aircall, RCM, etc.)."""
    __tablename__ = "dialer_calls"

    id               = Column(String, primary_key=True, default=generate_uuid)
    lead_id          = Column(String, ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    user_id          = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    provider         = Column(String, nullable=False)
    provider_call_id = Column(String, nullable=True, index=True)
    phone_number     = Column(String, nullable=True)
    status           = Column(String, nullable=False)
    direction        = Column(String, nullable=True)
    duration         = Column(Integer, nullable=True)
    recording_url    = Column(String, nullable=True)
    outcome          = Column(String, nullable=True)
    notes            = Column(Text, nullable=True)
    transcript       = Column(Text, nullable=True)
    started_at       = Column(DateTime(timezone=True), nullable=True)
    answered_at      = Column(DateTime(timezone=True), nullable=True)
    ended_at         = Column(DateTime(timezone=True), nullable=True)
    raw_payload      = Column(Text, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", backref="dialer_calls")
    user = relationship("User", backref="dialer_calls")


class NylasConfig(Base):
    """Single-row configuration for Nylas email integration."""
    __tablename__ = "nylas_config"

    id                       = Column(Integer, primary_key=True, default=1)
    client_id                = Column(String, nullable=True)
    api_key_encrypted        = Column(Text, nullable=True)
    redirect_uri             = Column(String, nullable=True)
    webhook_secret_encrypted = Column(Text, nullable=True)
    configured_by_user_id    = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    configured_by_name       = Column(String, nullable=True)
    configured_at            = Column(DateTime(timezone=True), nullable=True)
    is_active                = Column(Boolean, default=False, nullable=False)


class UserMailbox(Base):
    """One Nylas grant per user."""
    __tablename__ = "user_mailboxes"

    id             = Column(String, primary_key=True, default=generate_uuid)
    user_id        = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    email_address  = Column(String, nullable=False)
    provider       = Column(String, nullable=True)
    nylas_grant_id = Column(String, nullable=False)
    status         = Column(String, default="connected")
    connected_at   = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", backref="mailbox")


class LeadEmailActivity(Base):
    """Log of every email sent to or received from a lead."""
    __tablename__ = "lead_email_activity"

    id               = Column(String, primary_key=True, default=generate_uuid)
    lead_id          = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id          = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    direction        = Column(String, nullable=False)
    subject          = Column(String, nullable=True)
    body_preview     = Column(Text, nullable=True)
    from_email       = Column(String, nullable=True)
    to_email         = Column(String, nullable=True)
    nylas_message_id = Column(String, nullable=True, index=True)
    nylas_thread_id  = Column(String, nullable=True, index=True)
    timestamp        = Column(DateTime(timezone=True), server_default=func.now())
    opened_at        = Column(DateTime(timezone=True), nullable=True)
    open_count       = Column(Integer, nullable=True, default=0)
    attachments_json = Column(Text, nullable=True)

    lead = relationship("Lead", backref="email_activities")
    user = relationship("User")


class EmailThread(Base):
    """Maps a Nylas thread_id to a lead_id."""
    __tablename__ = "email_threads"

    id              = Column(String, primary_key=True, default=generate_uuid)
    nylas_thread_id = Column(String, nullable=False, unique=True, index=True)
    lead_id         = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead")
