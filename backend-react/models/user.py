"""
User and access control models.
"""
import enum
from sqlalchemy import Column, String, DateTime, ForeignKey, Boolean, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from models.base import generate_uuid


class AllowedUser(Base):
    """Access control table — source of truth for who can log into the CRM."""
    __tablename__ = "allowed_users"

    email    = Column(String, primary_key=True, index=True)
    name     = Column(String)
    role     = Column(String, default="SDR")
    added_at = Column(DateTime(timezone=True), server_default=func.now())
    added_by = Column(String, default="system")


class Role(str, enum.Enum):
    Super_Admin = "Super Admin"
    Pod_Admin   = "Pod Admin"
    SDR         = "SDR"


class User(Base):
    __tablename__ = "users"

    id           = Column(String, primary_key=True, default=generate_uuid)
    google_id    = Column(String, unique=True, index=True)
    email        = Column(String, unique=True, index=True, nullable=False)
    name         = Column(String)
    role         = Column(String, default="SDR")
    sf_sdr_id    = Column(String, unique=True, index=True)
    pod_id       = Column(String, ForeignKey("pods.id", ondelete="SET NULL"), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    dialer_user_id      = Column(String, nullable=True)
    rcm_user_id  = Column(String, nullable=True)
    dialer_enabled     = Column(Boolean, default=False, nullable=False, server_default="false")
    email_sync_enabled = Column(Boolean, default=False, nullable=False, server_default="false")

    # Relationships
    pod            = relationship("Pod", back_populates="members", foreign_keys=[pod_id])
    assigned_leads = relationship("Lead", secondary="lead_assignments", back_populates="assigned_users")
    call_logs      = relationship("CallLog", back_populates="user")


class LoginLog(Base):
    """Records every user login for audit trail with session duration tracking."""
    __tablename__ = "login_logs"

    id           = Column(String, primary_key=True, default=generate_uuid)
    user_id      = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    email        = Column(String, nullable=False)
    name         = Column(String, nullable=True)
    role         = Column(String, nullable=True)
    ip_address   = Column(String, nullable=True)
    user_agent   = Column(String, nullable=True)
    login_at     = Column(DateTime(timezone=True), server_default=func.now())
    logout_at    = Column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", backref="login_logs")


def log_user_login(db, user_id, email, name=None, role=None, ip_address=None, user_agent=None):
    """Record a login event. Also closes any previous open session."""
    from datetime import datetime, timezone as tz
    open_sessions = db.query(LoginLog).filter(
        LoginLog.user_id == user_id,
        LoginLog.logout_at == None
    ).all()
    for s in open_sessions:
        s.logout_at = datetime.now(tz.utc)

    entry = LoginLog(
        user_id=user_id,
        email=email,
        name=name,
        role=role,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(entry)
    return entry
