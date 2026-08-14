"""
test_activity_logger.py — Tests for the fire-and-forget activity logger.
Verifies that log_activity() creates rows for valid actions and swallows errors.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch, MagicMock

import models
from activity_logger import log_activity, ACTION_TYPES
from conftest import create_test_user, SUPER_ADMIN


class TestLogActivity:
    """Tests for activity_logger.log_activity()."""

    def test_log_valid_action_creates_row(self, db):
        """Known action type should create a UserActivityLog row."""
        log_activity(
            user_id="test-user-id",
            action_type="VIEW_LEAD",
            user_email="admin@test.com",
            user_name="Test Admin",
            object_type="lead",
            object_id="lead-123",
        )
        row = db.query(models.UserActivityLog).filter(
            models.UserActivityLog.action_type == "VIEW_LEAD"
        ).first()
        assert row is not None
        assert row.user_id == "test-user-id"
        assert row.object_id == "lead-123"

    def test_log_unknown_action_no_row(self, db):
        """Unknown action type should be skipped — no DB row created."""
        log_activity(
            user_id="test-user-id",
            action_type="FAKE_ACTION",
        )
        count = db.query(models.UserActivityLog).count()
        assert count == 0

    def test_metadata_stored_as_json(self, db):
        """Dict metadata should be serialized to metadata_json field."""
        meta = {"lead_name": "Acme Corp", "from_status": "Research", "to_status": "Calling"}
        log_activity(
            user_id="test-user-id",
            action_type="UPDATE_LEAD_STATUS",
            metadata=meta,
        )
        import json
        row = db.query(models.UserActivityLog).first()
        assert row is not None
        parsed = json.loads(row.metadata_json)
        assert parsed["lead_name"] == "Acme Corp"
        assert parsed["from_status"] == "Research"

    def test_null_metadata_stores_null(self, db):
        """None metadata should store null in DB."""
        log_activity(
            user_id="test-user-id",
            action_type="LOGIN",
        )
        row = db.query(models.UserActivityLog).first()
        assert row is not None
        assert row.metadata_json is None

    def test_db_error_swallowed(self, db):
        """DB failure should be caught, never raised to caller."""
        with patch("database.SessionLocal", side_effect=Exception("DB down")):
            # This should NOT raise
            log_activity(
                user_id="test-user-id",
                action_type="VIEW_LEAD",
            )

    def test_all_action_types_accepted(self, db):
        """Every key in ACTION_TYPES should be a valid action."""
        for action_type in ACTION_TYPES:
            log_activity(
                user_id="test-user-id",
                action_type=action_type,
                user_email="admin@test.com",
            )
        count = db.query(models.UserActivityLog).count()
        assert count == len(ACTION_TYPES)
