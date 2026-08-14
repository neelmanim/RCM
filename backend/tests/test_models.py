"""Tests for models.py — helpers, enums, relationships."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import uuid
import models
from conftest import create_test_user, create_test_lead, create_test_pod


# ── generate_uuid ────────────────────────────────────────────────────────────

class TestGenerateUuid:

    def test_returns_valid_uuid_string(self):
        result = models.generate_uuid()
        parsed = uuid.UUID(result)
        assert str(parsed) == result

    def test_returns_unique_values(self):
        a = models.generate_uuid()
        b = models.generate_uuid()
        assert a != b


# ── Enums ────────────────────────────────────────────────────────────────────

class TestEnums:

    def test_role_values(self):
        assert models.Role.Super_Admin.value == "Super Admin"
        assert models.Role.Pod_Admin.value == "Pod Admin"
        assert models.Role.SDR.value == "SDR"

    def test_status_values(self):
        expected = {"Lead Assigned", "Research", "Calling", "Meeting Scheduled",
                    "1st Discovery Meeting", "Discovery Complete", "Demo Scheduled",
                    "Demo Done", "Completed", "Disqualified",
                    "Pending Review"}  # v5.5: failed-demo holding state
        actual = {s.value for s in models.Status}
        assert actual == expected

    def test_terminal_statuses(self):
        assert "Demo Done" in models.TERMINAL_STATUSES
        assert "Completed" in models.TERMINAL_STATUSES
        assert "Disqualified" in models.TERMINAL_STATUSES
        assert "Meeting Scheduled" not in models.TERMINAL_STATUSES
        assert "Calling" not in models.TERMINAL_STATUSES

    def test_active_statuses(self):
        assert "Lead Assigned" in models.ACTIVE_STATUSES
        assert "Research" in models.ACTIVE_STATUSES
        assert "Calling" in models.ACTIVE_STATUSES
        assert "Meeting Scheduled" in models.ACTIVE_STATUSES
        assert "1st Discovery Meeting" in models.ACTIVE_STATUSES
        assert "Discovery Complete" in models.ACTIVE_STATUSES
        assert "Demo Scheduled" in models.ACTIVE_STATUSES
        assert "Disqualified" not in models.ACTIVE_STATUSES

    def test_attempt_outcomes(self):
        assert "No Answer" in models.ATTEMPT_OUTCOMES
        assert "Left Voicemail" in models.ATTEMPT_OUTCOMES
        assert "Wrong Number" in models.ATTEMPT_OUTCOMES
        assert "Unreachable" in models.ATTEMPT_OUTCOMES
        # These should NOT be attempt outcomes
        assert "Meeting Scheduled" not in models.ATTEMPT_OUTCOMES
        assert "Meeting Confirmed" not in models.ATTEMPT_OUTCOMES
        assert "Not Interested" not in models.ATTEMPT_OUTCOMES

    def test_call_outcome_values(self):
        expected = {
            "Call Back Later", "Meeting Scheduled", "Meeting Confirmed",
            "Text Me", "Not the Right Person", "Referred Someone Else",
            "No Answer", "Left Voicemail", "Wrong Number",
            "Not Interested", "Unreachable", "Left the Company",
            "Meeting Complete",  # v5.5: SDR confirms meeting actually happened
            "Demo Failed",       # v5.5: triggers Pending Review workflow
        }
        actual = {o.value for o in models.CallOutcome}
        assert actual == expected

    def test_outcome_groups(self):
        assert "Meeting Scheduled" in models.ANSWERED_OUTCOMES
        assert "Meeting Confirmed" in models.ANSWERED_OUTCOMES
        assert "No Answer" in models.NOT_ANSWERED_OUTCOMES
        assert "Not Interested" in models.TERMINAL_OUTCOMES
        assert "Unreachable" in models.TERMINAL_OUTCOMES
        assert "Left the Company" in models.TERMINAL_OUTCOMES

    def test_configurable_outcome_sets(self):
        """Verify config-driven outcome action sets."""
        assert "Left the Company" in models.DISQUALIFYING_OUTCOMES
        assert "Meeting Confirmed" in models.MEETING_OUTCOMES
        assert "Meeting Confirmed" in models.NOTES_REQUIRED_OUTCOMES
        assert "Not Interested" in models.NOTES_REQUIRED_OUTCOMES

    def test_get_outcome_config(self):
        """Verify outcome config helpers return correct structure."""
        config = models.get_outcome_config()
        assert len(config) > 0
        for item in config:
            assert "value" in item
            assert "group" in item
            assert "action" in item
            assert "enabled" in item
            assert "notes_required" in item

        # Check specific outcomes
        valid = models.get_valid_outcomes()
        assert "Left the Company" in valid
        assert "Meeting Confirmed" in valid

        enabled = models.get_enabled_outcomes()
        enabled_values = {o["value"] for o in enabled}
        assert "No Answer" in enabled_values

        ltc = models.get_outcome_by_value("Left the Company")
        assert ltc is not None
        assert ltc["action"] == "disqualify"
        assert ltc["group"] == "terminal"

        mc = models.get_outcome_by_value("Meeting Confirmed")
        assert mc is not None
        assert mc["action"] == "meeting_scheduled"
        assert mc["notes_required"] is True

    def test_legacy_outcome_mapping(self):
        assert models.LEGACY_OUTCOME_MAP["Call Completed"] == "Meeting Scheduled"
        assert models.LEGACY_OUTCOME_MAP["Customer Declined"] == "Not Interested"
        assert models.LEGACY_OUTCOME_MAP["Callback Scheduled"] == "Call Back Later"


# ── Phase 2: DB-aware outcome config ─────────────────────────────────────────

class TestOutcomeConfigFromDB:
    """Phase 2 tests: get_outcome_config(db) reads from SyncSettings.outcome_config
    with merge logic and graceful fallback."""

    def test_get_outcome_config_with_db_null_falls_back_to_default(self, db):
        """When SyncSettings.outcome_config is NULL, return DEFAULT_OUTCOME_CONFIG."""
        from conftest import create_sync_settings
        create_sync_settings(db)
        config = models.get_outcome_config(db)
        default = models.DEFAULT_OUTCOME_CONFIG
        assert len(config) == len(default)
        # All default values present
        default_values = {o["value"] for o in default}
        config_values = {o["value"] for o in config}
        assert config_values == default_values

    def test_get_outcome_config_reads_from_db(self, db):
        """When SyncSettings.outcome_config has JSON, use it."""
        import json
        from conftest import create_sync_settings
        custom_config = [
            {"value": "No Answer", "group": "not_answered", "action": "none",
             "notes_required": False, "builtin": True, "enabled": False},
            {"value": "Meeting Confirmed", "group": "answered", "action": "meeting_scheduled",
             "notes_required": True, "builtin": True, "enabled": True},
        ]
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        config = models.get_outcome_config(db)
        # Should include the DB entries
        no_answer = next((o for o in config if o["value"] == "No Answer"), None)
        assert no_answer is not None
        assert no_answer["enabled"] is False  # DB override

    def test_get_outcome_config_merges_missing_builtins(self, db):
        """If DB config is missing a builtin from DEFAULT, it gets auto-appended."""
        import json
        from conftest import create_sync_settings
        # Only store 2 builtins — the remaining 10 should be auto-merged
        partial_config = [
            {"value": "No Answer", "group": "not_answered", "action": "none",
             "notes_required": False, "builtin": True, "enabled": True},
        ]
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(partial_config)
        db.commit()

        config = models.get_outcome_config(db)
        config_values = {o["value"] for o in config}
        # ALL default builtins must be present via merge
        for default_item in models.DEFAULT_OUTCOME_CONFIG:
            assert default_item["value"] in config_values, \
                f"Builtin '{default_item['value']}' missing after merge"

    def test_get_outcome_config_corrupted_json_falls_back(self, db):
        """Corrupted JSON should not crash — fall back to DEFAULT_OUTCOME_CONFIG."""
        from conftest import create_sync_settings
        settings = create_sync_settings(db)
        settings.outcome_config = "THIS IS NOT JSON {{{}"
        db.commit()

        config = models.get_outcome_config(db)
        assert len(config) == len(models.DEFAULT_OUTCOME_CONFIG)

    def test_get_outcome_config_includes_custom_outcomes(self, db):
        """Custom (non-builtin) outcomes stored in DB should be returned."""
        import json
        from conftest import create_sync_settings
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Competitor Using", "group": "terminal", "action": "none",
             "notes_required": True, "builtin": False, "enabled": True},
        ]
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        config = models.get_outcome_config(db)
        custom = next((o for o in config if o["value"] == "Competitor Using"), None)
        assert custom is not None
        assert custom["builtin"] is False
        assert custom["notes_required"] is True

    def test_get_outcome_config_no_db_returns_default(self):
        """When called without db arg, should return DEFAULT_OUTCOME_CONFIG."""
        config = models.get_outcome_config()
        assert config == models.DEFAULT_OUTCOME_CONFIG

    def test_get_valid_outcomes_with_db(self, db):
        """get_valid_outcomes(db) should include custom outcomes from DB."""
        import json
        from conftest import create_sync_settings
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Budget Freeze", "group": "terminal", "action": "none",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        valid = models.get_valid_outcomes(db)
        assert "Budget Freeze" in valid
        assert "No Answer" in valid  # builtins still present

    def test_get_enabled_outcomes_with_db(self, db):
        """get_enabled_outcomes(db) should respect DB enabled flag."""
        import json
        from conftest import create_sync_settings
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG)
        # Disable 'No Answer' in DB
        for o in custom_config:
            if o["value"] == "No Answer":
                o["enabled"] = False
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        enabled = models.get_enabled_outcomes(db)
        enabled_values = {o["value"] for o in enabled}
        assert "No Answer" not in enabled_values
        assert "Meeting Confirmed" in enabled_values  # others still enabled

    def test_get_outcome_by_value_with_db(self, db):
        """get_outcome_by_value should check DB config when db is provided."""
        import json
        from conftest import create_sync_settings
        custom_config = list(models.DEFAULT_OUTCOME_CONFIG) + [
            {"value": "Do Not Contact", "group": "terminal", "action": "disqualify",
             "notes_required": False, "builtin": False, "enabled": True},
        ]
        settings = create_sync_settings(db)
        settings.outcome_config = json.dumps(custom_config)
        db.commit()

        result = models.get_outcome_by_value("Do Not Contact", db)
        assert result is not None
        assert result["action"] == "disqualify"

        # Non-existent outcome returns None
        assert models.get_outcome_by_value("Nonexistent", db) is None


# ── log_status_change ────────────────────────────────────────────────────────

class TestLogStatusChange:

    def test_creates_status_log_entry(self, db):
        lead = create_test_lead(db)
        entry = models.log_status_change(db, lead.id, "Lead Assigned", "Calling", "tester@test.com")
        db.commit()
        assert entry.lead_id == lead.id
        assert entry.from_status == "Lead Assigned"
        assert entry.to_status == "Calling"
        assert entry.changed_by == "tester@test.com"

    def test_null_from_status_for_initial(self, db):
        lead = create_test_lead(db)
        entry = models.log_status_change(db, lead.id, None, "Lead Assigned", "system")
        db.commit()
        assert entry.from_status is None
        assert entry.to_status == "Lead Assigned"


# ── assign_lead ──────────────────────────────────────────────────────────────

class TestAssignLead:

    def test_assigns_lead_and_syncs_pod_id(self, db):
        pod = create_test_pod(db)
        sdr = create_test_user(db, email="assign-sdr@t.com", role="SDR", pod_id=pod.id)
        lead = create_test_lead(db, email="assign-lead@t.com")
        assert lead.pod_id is None

        result = models.assign_lead(sdr, lead)
        db.commit()

        assert result is True
        assert lead in sdr.assigned_leads
        assert lead.pod_id == pod.id

    def test_returns_false_and_noop_when_already_assigned(self, db):
        pod = create_test_pod(db)
        sdr = create_test_user(db, email="assign-sdr2@t.com", role="SDR", pod_id=pod.id)
        lead = create_test_lead(db, email="assign-lead2@t.com")
        sdr.assigned_leads.append(lead)
        lead.pod_id = pod.id
        db.commit()

        result = models.assign_lead(sdr, lead)

        assert result is False
        assert len([u for u in lead.assigned_users if u.id == sdr.id]) == 1

    def test_assignee_with_no_pod_leaves_lead_pod_none(self, db):
        sdr = create_test_user(db, email="assign-sdr3@t.com", role="SDR", pod_id=None)
        lead = create_test_lead(db, email="assign-lead3@t.com")

        result = models.assign_lead(sdr, lead)
        db.commit()

        assert result is True
        assert lead.pod_id is None


# ── disqualify_lead ──────────────────────────────────────────────────────────

class TestDisqualifyLead:

    def test_sets_status_closed_at_and_reason(self, db):
        lead = create_test_lead(db)
        lead.status = "Calling"
        db.commit()

        models.disqualify_lead(db, lead, "ICP mismatch", "admin@test.com")
        db.commit()

        assert lead.status == "Disqualified"
        assert lead.lead_closed_at is not None
        assert lead.closed_reason == "ICP mismatch"

    def test_logs_status_change_entry(self, db):
        lead = create_test_lead(db)
        lead.status = "Calling"
        db.commit()

        models.disqualify_lead(db, lead, "Not Interested", "admin@test.com")
        db.commit()

        entry = db.query(models.LeadStatusLog).filter(
            models.LeadStatusLog.lead_id == lead.id
        ).order_by(models.LeadStatusLog.changed_at.desc()).first()
        assert entry is not None
        assert entry.from_status == "Calling"
        assert entry.to_status == "Disqualified"
        assert entry.changed_by == "admin@test.com"

    def test_defaults_actor_name_to_system(self, db):
        lead = create_test_lead(db)
        models.disqualify_lead(db, lead, "No Phone Number")
        db.commit()

        entry = db.query(models.LeadStatusLog).filter(
            models.LeadStatusLog.lead_id == lead.id
        ).order_by(models.LeadStatusLog.changed_at.desc()).first()
        assert entry.changed_by == "system"


# ── Model relationships ─────────────────────────────────────────────────────

class TestRelationships:

    def test_user_lead_assignment(self, db):
        user = create_test_user(db, email="rel@test.com")
        lead = create_test_lead(db, email="relead@test.com")
        user.assigned_leads.append(lead)
        db.commit()
        db.refresh(user)
        assert len(user.assigned_leads) == 1
        assert lead in user.assigned_leads

    def test_lead_notes_relationship(self, db):
        lead = create_test_lead(db, email="notes@test.com")
        note = models.Note(lead_id=lead.id, content="Test note")
        db.add(note)
        db.commit()
        db.refresh(lead)
        assert len(lead.notes) == 1

    def test_lead_tasks_relationship(self, db):
        lead = create_test_lead(db, email="tasks@test.com")
        task = models.Task(lead_id=lead.id, title="Follow up")
        db.add(task)
        db.commit()
        db.refresh(lead)
        assert len(lead.tasks) == 1

    def test_lead_call_logs_relationship(self, db):
        user = create_test_user(db, email="caller@test.com")
        lead = create_test_lead(db, email="called@test.com")
        call = models.CallLog(lead_id=lead.id, user_id=user.id, outcome="No Answer")
        db.add(call)
        db.commit()
        db.refresh(lead)
        assert len(lead.call_logs) == 1

    def test_pod_members_relationship(self, db):
        from conftest import create_test_pod
        pod = create_test_pod(db, name="Rel Pod")
        user = create_test_user(db, email="podmember@test.com", pod_id=pod.id)
        db.refresh(pod)
        assert len(pod.members) == 1
        assert pod.members[0].email == "podmember@test.com"


# ── No Show tracking ────────────────────────────────────────────────────────

class TestNoShowTracking:

    def test_no_show_count_defaults_to_zero(self, db):
        lead = create_test_lead(db, email="noshow@test.com")
        assert lead.no_show_count == 0

    def test_no_show_count_increment(self, db):
        lead = create_test_lead(db, email="noshow2@test.com")
        lead.no_show_count = (lead.no_show_count or 0) + 1
        db.commit()
        db.refresh(lead)
        assert lead.no_show_count == 1
        lead.no_show_count += 1
        db.commit()
        db.refresh(lead)
        assert lead.no_show_count == 2


# ── User Feature Flags (v4) ─────────────────────────────────────────────────

class TestUserFeatureFlags:
    """Tests for the new dialer_enabled and email_sync_enabled columns."""

    def test_defaults_are_false(self, db):
        user = create_test_user(db, email="flags@test.com")
        assert user.dialer_enabled is False
        assert user.email_sync_enabled is False

    def test_can_set_dialer_enabled(self, db):
        user = create_test_user(db, email="dialer@test.com")
        user.dialer_enabled = True
        db.commit()
        db.refresh(user)
        assert user.dialer_enabled is True

    def test_can_set_email_sync_enabled(self, db):
        user = create_test_user(db, email="emailsync@test.com")
        user.email_sync_enabled = True
        db.commit()
        db.refresh(user)
        assert user.email_sync_enabled is True

    def test_getattr_fallback(self, db):
        """Verify getattr with default works as used in auth routes."""
        user = create_test_user(db, email="getattr@test.com")
        assert bool(getattr(user, 'dialer_enabled', False)) is False
        assert bool(getattr(user, 'email_sync_enabled', False)) is False


# ── Email Models ─────────────────────────────────────────────────────────────

class TestEmailModels:
    """Tests for NylasConfig, UserMailbox, LeadEmailActivity, EmailThread."""

    def test_nylas_config_defaults(self, db):
        from conftest import create_nylas_config
        config = create_nylas_config(db)
        assert config.is_active is True
        assert config.client_id == "test-client-id"

    def test_user_mailbox_relationship(self, db):
        from conftest import create_user_mailbox
        user = create_test_user(db, email="mailbox@test.com")
        mb = create_user_mailbox(db, user_id=user.id, email_address="mailbox@test.com")
        assert mb.status == "connected"
        assert mb.provider == "google"
        db.refresh(user)
        assert len(user.mailbox) == 1

    def test_email_activity_belongs_to_lead(self, db):
        from conftest import create_email_activity
        lead = create_test_lead(db, email="actlead@test.com")
        user = create_test_user(db, email="actuser@test.com")
        act = create_email_activity(db, lead.id, user.id, "outbound",
                                     subject="Test", from_email="actuser@test.com")
        assert act.direction == "outbound"
        assert act.lead_id == lead.id
        db.refresh(lead)
        assert len(lead.email_activities) == 1

    def test_email_thread_belongs_to_lead(self, db):
        from conftest import create_email_thread
        lead = create_test_lead(db, email="threadlead@test.com")
        thread = create_email_thread(db, lead.id, "thread-xyz")
        assert thread.nylas_thread_id == "thread-xyz"
        assert thread.lead_id == lead.id


class TestLeadSourceNoMisleadingDefault:
    """A Lead created without an explicit lead_source used to silently default
    to "salesforce" (models.Lead.lead_source's old column default) — mislabeling
    any non-Salesforce-origin lead (e.g. a path that forgot to set it) as if
    it came from a live Salesforce sync. Every real creation path sets it
    explicitly (salesforce.py, dialer_service.py, admin_upload_routes.py,
    scheduled_jobs.py, sandbox_routes.py) — this just guards the column
    itself never silently reintroduces the mislabel."""

    def test_lead_source_is_none_when_not_provided(self, db):
        import models
        lead = models.Lead(first_name="Jane", last_name="Doe")
        db.add(lead)
        db.commit()
        db.refresh(lead)
        assert lead.lead_source is None
