"""
Tests for audience_manager.py's v12.3 expansion: create_contact's
extra_fields, lifecycle_stage_for_status, owner_names, and lead_extra_fields
— the fields Audience Manager Segments will actually be built on (state,
status, lifecycle_stage, owner, group), not just name/phone/email.
"""
import models
from unittest.mock import patch, MagicMock

from audience_manager import (
    create_contact,
    update_contact,
    sync_lead_update_to_am,
    lifecycle_stage_for_status,
    owner_names,
    lead_extra_fields,
)
from tests.conftest import create_test_lead, create_test_pod, create_test_user


class TestLifecycleStageForStatus:
    def test_maps_each_real_status_to_one_of_the_six_configured_stages(self):
        VALID = {"New", "Working", "Meeting Scheduled", "Demo Done", "Won", "Lost"}
        cases = {
            "Lead Assigned": "New", "Research": "New",
            "Calling": "Working", "Pending Review": "Working",
            "Meeting Scheduled": "Meeting Scheduled",
            "1st Discovery Meeting": "Meeting Scheduled",
            "Discovery Complete": "Meeting Scheduled",
            "Demo Scheduled": "Meeting Scheduled",
            "Demo Done": "Demo Done",
            "Completed": "Won",
            "Disqualified": "Lost", "Customer Declined": "Lost", "Unreachable": "Lost",
            "No Phone - Parked": "Lost",
        }
        for status, expected in cases.items():
            assert lifecycle_stage_for_status(status) == expected
            assert expected in VALID

    def test_unknown_status_falls_back_to_new_not_a_crash(self):
        assert lifecycle_stage_for_status("Some Future Status") == "New"


class TestOwnerNames:
    def test_joins_all_assigned_users_sdr_and_ae(self, db):
        sdr = create_test_user(db, email="sdr@test.com", name="SDR One", role="SDR")
        ae = create_test_user(db, email="ae@test.com", name="AE One", role="AE")
        lead = create_test_lead(db, phone="+15550001111")
        lead.assigned_users.append(sdr)
        lead.assigned_users.append(ae)
        db.commit()

        result = owner_names(lead)
        assert "SDR One" in result and "AE One" in result

    def test_empty_string_when_unassigned(self, db):
        lead = create_test_lead(db, phone="+15550002222")
        assert owner_names(lead) == ""


class TestLeadExtraFields:
    def test_builds_full_segmentable_field_set(self, db):
        pod = create_test_pod(db, name="Growth Pod")
        sdr = create_test_user(db, email="sdr2@test.com", name="Jane SDR", role="SDR")
        lead = create_test_lead(db, phone="+15550003333", pod_id=pod.id, status="Demo Scheduled")
        lead.country, lead.state, lead.city = "US", "CA", "San Francisco"
        lead.assigned_users.append(sdr)
        db.commit()

        fields = lead_extra_fields(lead, db=db)
        assert fields["status"] == "Demo Scheduled"
        assert fields["country"] == "US"
        assert fields["state"] == "CA"
        assert fields["city"] == "San Francisco"
        assert fields["unique_id"] == lead.id
        assert fields["owner"] == "Jane SDR"
        assert fields["group"] == "Growth Pod"
        assert fields["lifecycle_stage"] == "Meeting Scheduled"

    def test_group_omitted_without_a_db_session(self, db):
        pod = create_test_pod(db, name="Growth Pod")
        lead = create_test_lead(db, phone="+15550004444", pod_id=pod.id)
        fields = lead_extra_fields(lead)  # no db passed
        assert fields["group"] is None


class TestCreateContactExtraFields:
    def test_create_contact_is_retired_safe_noop(self):
        res = create_contact(
            "https://app.alternatecrm.com", "key", "user1",
            "John", "Doe", "+15551234567", email="john@test.com",
            extra_fields={"status": "Lead Assigned", "state": "CA"},
        )
        assert res is None


class TestUpdateContact:
    def test_update_contact_is_retired_safe_noop(self):
        ok = update_contact(
            "https://app.alternatecrm.com", "key", "rec123",
            {"first_name": "Janet", "status": "Calling"},
        )
        assert ok is True


class TestSyncLeadUpdateToAM:
    def test_pushes_current_fields_for_an_already_synced_lead(self, db):
        db.add(models.SyncSettings(
            id=1, messenger_enabled=True, messenger_api_key="key",
            messenger_user_id="u1", messenger_base_url="https://app.alternatecrm.com",
        ))
        db.commit()
        lead = create_test_lead(db, phone="+15550009999", first_name="Jane", last_name="Roe")
        lead.am_record_id = "rec999"
        db.commit()

        # sync_lead_update_to_am is now a retired no-op, completes without raising
        sync_lead_update_to_am(lead.id)

    def test_skips_a_lead_that_was_never_synced(self, db):
        db.add(models.SyncSettings(
            id=1, messenger_enabled=True, messenger_api_key="key", messenger_user_id="u1",
        ))
        db.commit()
        lead = create_test_lead(db, phone="+15550008888")
        assert lead.am_record_id is None

        with patch("audience_manager.update_contact") as mock_update:
            sync_lead_update_to_am(lead.id)
            mock_update.assert_not_called()

    def test_skips_when_messenger_disabled(self, db):
        db.add(models.SyncSettings(id=1, messenger_enabled=False))
        db.commit()
        lead = create_test_lead(db, phone="+15550007777")
        lead.am_record_id = "rec111"
        db.commit()

        with patch("audience_manager.update_contact") as mock_update:
            sync_lead_update_to_am(lead.id)
            mock_update.assert_not_called()
