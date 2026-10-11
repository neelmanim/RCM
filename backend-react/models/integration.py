"""
Integration models: SalesforceConnection, SalesforceIntegrationLog.
"""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from models.base import generate_uuid


class SalesforceConnection(Base):
    """Stores Salesforce org connection details with encrypted credentials."""
    __tablename__ = "salesforce_connections"

    id                    = Column(String, primary_key=True, default=generate_uuid)
    instance_url          = Column(String, nullable=True)
    environment           = Column(String, default="sandbox")
    username              = Column(String, nullable=False)
    password_encrypted    = Column(Text, nullable=False)
    security_token_encrypted = Column(Text, nullable=False)
    org_id                = Column(String, nullable=True)
    org_name              = Column(String, nullable=True)
    connected_by_user_id  = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    connected_by_name     = Column(String, nullable=True)
    connected_at          = Column(DateTime(timezone=True), server_default=func.now())
    last_sync_at          = Column(DateTime(timezone=True), nullable=True)
    last_sync_status      = Column(String, nullable=True)
    last_sync_error       = Column(Text, nullable=True)
    records_synced_last_run = Column(Integer, default=0)
    connection_status     = Column(String, default="connected")
    is_active             = Column(Boolean, default=True, nullable=False)

    connected_by = relationship("User", foreign_keys=[connected_by_user_id])


class SalesforceIntegrationLog(Base):
    """Logs every Salesforce API interaction for admin diagnostics."""
    __tablename__ = "salesforce_integration_logs"

    id                = Column(String, primary_key=True, default=generate_uuid)
    timestamp         = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    operation_type    = Column(String, nullable=False)
    sf_object         = Column(String, default="Lead")
    record_identifier = Column(String, nullable=True)
    first_name        = Column(String, nullable=True)
    last_name         = Column(String, nullable=True)
    email             = Column(String, nullable=True)
    fields_updated    = Column(Text, nullable=True)
    status            = Column(String, nullable=False)
    error_message     = Column(Text, nullable=True)
    request_payload   = Column(Text, nullable=True)
    response_payload  = Column(Text, nullable=True)
    source_system     = Column(String, default="api")
