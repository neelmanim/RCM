"""Tests for sf_logger.py — Salesforce integration logging."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import models
from sf_logger import log_sf_operation


class TestLogSfOperation:

    def test_writes_log_with_db_session(self, db):
        log_sf_operation(
            db=db,
            operation_type="create",
            sf_object="Lead",
            record_identifier="SF-001",
            first_name="John",
            last_name="Doe",
            email="john@test.com",
            fields_updated=["Status", "Email"],
            status="success",
            request_payload={"LastName": "Doe"},
            response_payload={"id": "SF-001"},
            source_system="test",
        )
        logs = db.query(models.SalesforceIntegrationLog).all()
        assert len(logs) == 1
        log = logs[0]
        assert log.operation_type == "create"
        assert log.sf_object == "Lead"
        assert log.status == "success"
        assert log.first_name == "John"
        assert "Status" in log.fields_updated

    def test_handles_none_payloads(self, db):
        log_sf_operation(
            db=db,
            operation_type="fetch",
            status="success",
            request_payload=None,
            response_payload=None,
        )
        logs = db.query(models.SalesforceIntegrationLog).all()
        assert len(logs) == 1
        assert logs[0].request_payload is None

    def test_handles_error_message(self, db):
        log_sf_operation(
            db=db,
            operation_type="create",
            status="failed",
            error_message="Connection timeout",
        )
        log = db.query(models.SalesforceIntegrationLog).first()
        assert log.status == "failed"
        assert log.error_message == "Connection timeout"

    def test_does_not_crash_on_db_error(self, db):
        """log_sf_operation should never raise — logging failures are non-fatal."""
        # Pass a closed session to force an error; should print warning but not crash
        db.close()
        try:
            log_sf_operation(
                db=db,
                operation_type="create",
                status="success",
            )
        except Exception:
            # If it raises, the test fails — it should swallow the error
            assert False, "log_sf_operation should not raise exceptions"

    def test_serializes_complex_payloads(self, db):
        from datetime import datetime
        log_sf_operation(
            db=db,
            operation_type="update",
            status="success",
            request_payload={"timestamp": datetime(2024, 1, 1), "nested": {"key": "val"}},
        )
        log = db.query(models.SalesforceIntegrationLog).first()
        assert log.request_payload is not None
        assert "nested" in log.request_payload
