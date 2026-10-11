"""
Unit tests for salesforce.py — client initialization, status mapping, sync,
push, and SDR functions.

All Salesforce API calls are mocked; no network access.
"""
import os
import sys
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime

_backend_dir = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _backend_dir)

from conftest import create_test_user, create_test_lead

import salesforce
from salesforce import (
    SF_TO_LOCAL_STATUS,
    LOCAL_TO_SF_STATUS,
    PIPELINE_ORDER,
    get_sf_client,
    get_record_types_from_salesforce,
    sync_leads_from_salesforce,
    sync_accounts_from_salesforce,
    sync_contacts_from_salesforce,
    sync_opportunities_from_salesforce,
    push_lead_to_salesforce,
    create_new_lead_in_salesforce,
    find_or_create_lead_in_salesforce,
    lead_push_info,
    _get_recreate_lock,
    create_sdr_in_salesforce,
    sync_sdrs_from_salesforce,
    push_sdr_metrics_to_salesforce,
    push_opportunity_to_salesforce,
)
import models


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _mock_sf():
    """Create a mock Salesforce client with common attributes."""
    sf = MagicMock()
    sf.sf_instance = "na1.salesforce.com"
    sf.Lead = MagicMock()
    sf.SDR__c = MagicMock()
    return sf


# ──────────────────────────────────────────────────────────────────────────────
# Status Mapping
# ──────────────────────────────────────────────────────────────────────────────

class TestStatusMappings:
    def test_sf_to_local_maps_open_to_assigned(self):
        assert SF_TO_LOCAL_STATUS["Open - Not Contacted"] == "Lead Assigned"

    def test_sf_to_local_maps_working_to_calling(self):
        assert SF_TO_LOCAL_STATUS["Working - Contacted"] == "Calling"

    def test_sf_to_local_maps_closed_to_meeting(self):
        assert SF_TO_LOCAL_STATUS["Closed - Converted"] == "Meeting Scheduled"

    def test_local_to_sf_maps_calling_to_new_lead(self):
        assert LOCAL_TO_SF_STATUS["Calling"] == "New Lead"

    def test_pipeline_order_monotonic(self):
        assert PIPELINE_ORDER["Lead Assigned"] < PIPELINE_ORDER["Research"]
        assert PIPELINE_ORDER["Research"] < PIPELINE_ORDER["Calling"]
        assert PIPELINE_ORDER["Calling"] < PIPELINE_ORDER["Meeting Scheduled"]


# ──────────────────────────────────────────────────────────────────────────────
# get_sf_client
# ──────────────────────────────────────────────────────────────────────────────

class TestGetSFClient:
    @patch("salesforce.Salesforce")
    @patch("salesforce.os.getenv")
    def test_env_var_fallback(self, mock_getenv, mock_sf_class):
        """When no DB connection exists, use env vars."""
        mock_getenv.side_effect = lambda k, *a: {
            "SF_USERNAME": "user@test.com",
            "SF_PASSWORD": "pass",
            "SF_SECURITY_TOKEN": "tok",
            "SF_DOMAIN": "login",
        }.get(k, a[0] if a else None)

        mock_sf_class.return_value = MagicMock()

        # Patch database.SessionLocal (imported locally inside get_sf_client)
        with patch("database.SessionLocal") as mock_session_cls:
            mock_db = MagicMock()
            mock_session_cls.return_value = mock_db
            mock_db.query.return_value.filter.return_value.first.return_value = None

            result = get_sf_client()

        assert result is not None
        mock_sf_class.assert_called()

    @patch("salesforce.Salesforce")
    def test_no_credentials_returns_none(self, mock_sf_class):
        """When no DB connection and no env vars, returns None."""
        with patch("database.SessionLocal") as mock_session_cls:
            mock_db = MagicMock()
            mock_session_cls.return_value = mock_db
            mock_db.query.return_value.filter.return_value.first.return_value = None

            with patch.dict(os.environ, {}, clear=True):
                # Remove specific SF vars
                for key in ["SF_USERNAME", "SF_PASSWORD", "SF_SECURITY_TOKEN"]:
                    os.environ.pop(key, None)
                result = get_sf_client()

        assert result is None


# ──────────────────────────────────────────────────────────────────────────────
# get_record_types_from_salesforce
# ──────────────────────────────────────────────────────────────────────────────

class TestGetRecordTypes:
    def test_returns_record_types(self):
        sf = _mock_sf()
        sf.query.return_value = {
            "records": [
                {"Id": "012xxx1", "Name": "Standard Lead"},
                {"Id": "012xxx2", "Name": "Enterprise Lead"},
            ]
        }
        result = get_record_types_from_salesforce(sf)
        assert len(result) == 2
        assert result[0]["id"] == "012xxx1"
        assert result[1]["name"] == "Enterprise Lead"

    def test_none_sf_returns_empty(self):
        assert get_record_types_from_salesforce(None) == []

    def test_exception_returns_empty(self):
        sf = _mock_sf()
        sf.query.side_effect = Exception("API error")
        assert get_record_types_from_salesforce(sf) == []


# ──────────────────────────────────────────────────────────────────────────────
# sync_leads_from_salesforce
# ──────────────────────────────────────────────────────────────────────────────

class TestSyncLeads:
    @patch("salesforce.log_sf_operation")
    @patch("audience_manager.sync_leads_to_am_background")
    def test_creates_new_leads(self, mock_am, mock_log, db):
        sf = _mock_sf()
        sf.query.return_value = {
            "records": [
                {
                    "Id": "00Qxx1",
                    "FirstName": "Alice",
                    "LastName": "Johnson",
                    "Email": "alice@example.com",
                    "Phone": "555-0100",
                    "Status": "New",
                    "Company": "TechCorp",
                    "RecordTypeId": "012xxx",
                    "LastModifiedDate": "2026-05-01T00:00:00Z",
                },
            ]
        }

        count = sync_leads_from_salesforce(db, sf, limit=100)

        assert count == 1
        lead = db.query(models.Lead).filter(models.Lead.sf_lead_id == "00Qxx1").first()
        assert lead is not None
        assert lead.first_name == "Alice"
        assert lead.company == "TechCorp"
        assert lead.status == "Lead Assigned"  # "New" maps to "Lead Assigned"
        mock_log.assert_called()

    @patch("salesforce.log_sf_operation")
    @patch("audience_manager.sync_leads_to_am_background")
    def test_upserts_existing_leads(self, mock_am, mock_log, db):
        """Existing lead matched by sf_lead_id gets updated, not duplicated."""
        sf = _mock_sf()
        # Pre-create a lead
        lead = create_test_lead(db, sf_lead_id="00Qxx2", first_name="Bob",
                                email="bob@example.com", status="Lead Assigned")

        sf.query.return_value = {
            "records": [
                {
                    "Id": "00Qxx2",
                    "FirstName": "Bob",
                    "LastName": "Updated",
                    "Email": "bob@example.com",
                    "Phone": "555-0200",
                    "Status": "Working - Contacted",
                    "Company": "NewCo",
                    "RecordTypeId": None,
                    "LastModifiedDate": "2026-05-01T00:00:00Z",
                },
            ]
        }

        count = sync_leads_from_salesforce(db, sf, limit=100)
        assert count == 1

        db.refresh(lead)
        assert lead.last_name == "Updated"
        assert lead.status == "Calling"  # Advanced from Lead Assigned → Calling

    @patch("salesforce.log_sf_operation")
    @patch("audience_manager.sync_leads_to_am_background")
    def test_does_not_regress_status(self, mock_am, mock_log, db):
        """If local lead is at a more advanced stage, don't regress."""
        sf = _mock_sf()
        lead = create_test_lead(db, sf_lead_id="00Qxx3", status="Meeting Scheduled")

        sf.query.return_value = {
            "records": [
                {
                    "Id": "00Qxx3",
                    "FirstName": "Carol",
                    "LastName": "Keep",
                    "Email": "carol@example.com",
                    "Phone": None,
                    "Status": "New",
                    "Company": None,
                    "RecordTypeId": None,
                    "LastModifiedDate": "2026-05-01T00:00:00Z",
                },
            ]
        }

        sync_leads_from_salesforce(db, sf, limit=100)
        db.refresh(lead)
        assert lead.status == "Meeting Scheduled"  # NOT regressed

    def test_none_sf_returns_zero(self, db):
        assert sync_leads_from_salesforce(db, None) == 0


# ──────────────────────────────────────────────────────────────────────────────
# Account / Opportunity sync — CSM Portal foundation (Phase 0)
# ──────────────────────────────────────────────────────────────────────────────

class TestSyncAccounts:
    @patch("salesforce.log_sf_operation")
    def test_creates_new_account(self, mock_log, db):
        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {"Id": "001AAA1", "Name": "Cascade Robotics", "Industry": "Manufacturing"},
        ]}
        count = sync_accounts_from_salesforce(db, sf)
        assert count == 1
        account = db.query(models.Account).filter(models.Account.sf_account_id == "001AAA1").first()
        assert account is not None
        assert account.name == "Cascade Robotics"
        assert account.industry == "Manufacturing"
        mock_log.assert_called()

    @patch("salesforce.log_sf_operation")
    def test_upsert_never_touches_assigned_csm(self, mock_log, db):
        """assigned_csm_id is local-only — a pull must never reset it."""
        csm = create_test_user(db, email="csm-owner@test.com", role="CSM")
        account = models.Account(sf_account_id="001AAA2", name="Old Name", assigned_csm_id=csm.id)
        db.add(account)
        db.commit()

        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {"Id": "001AAA2", "Name": "Renamed Inc", "Industry": None},
        ]}
        sync_accounts_from_salesforce(db, sf)
        db.refresh(account)
        assert account.name == "Renamed Inc"
        assert account.assigned_csm_id == csm.id  # untouched

    def test_none_sf_returns_zero(self, db):
        assert sync_accounts_from_salesforce(db, None) == 0

    @patch("salesforce.log_sf_operation")
    def test_pull_fills_customer_since_and_assigned_csm_by_email(self, mock_log, db):
        """Health score's relationship factor needs customer_since, and an
        unassigned account should pick up SF's own CSM field (matched by
        email, same as Opportunity Owner) — both were previously never read."""
        csm = create_test_user(db, email="csm-real@test.com", role="CSM")
        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {
                "Id": "001AAA3", "Name": "Unassigned Co", "Industry": "Retail",
                "CreatedDate": "2024-03-15T00:00:00.000+0000",
                "Account_Manager_Lookup__r": {"Email": "csm-real@test.com"},
            },
        ]}
        sync_accounts_from_salesforce(db, sf)
        account = db.query(models.Account).filter(models.Account.sf_account_id == "001AAA3").first()
        assert account.customer_since.date().isoformat() == "2024-03-15"
        assert account.assigned_csm_id == csm.id

    @patch("salesforce.log_sf_operation")
    def test_pull_fills_owner_by_email_as_a_fallback_identity(self, mock_log, db):
        """Owner is a standard, always-populated SF field — unlike the
        custom CSM lookup, useful to show even when that one is empty."""
        owner = create_test_user(db, email="owner-real@test.com", role="AE")
        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {
                "Id": "001AAA5", "Name": "Owned Co", "Industry": "Retail",
                "Owner": {"Email": "owner-real@test.com"},
            },
        ]}
        sync_accounts_from_salesforce(db, sf)
        account = db.query(models.Account).filter(models.Account.sf_account_id == "001AAA5").first()
        assert account.owner_user_id == owner.id

    @patch("salesforce.log_sf_operation")
    def test_pull_skips_csm_match_with_no_email_or_no_matching_user(self, mock_log, db):
        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {"Id": "001AAA4", "Name": "No Match Co", "Industry": None,
             "Account_Manager_Lookup__r": {"Email": "nobody@nowhere.test"}},
        ]}
        sync_accounts_from_salesforce(db, sf)
        account = db.query(models.Account).filter(models.Account.sf_account_id == "001AAA4").first()
        assert account.assigned_csm_id is None

    @patch("salesforce.log_sf_operation")
    def test_stores_raw_owner_and_csm_identity_even_with_no_alternatecrm_user(self, mock_log, db):
        """Most SF Account Owners/CSM lookups won't have a Alternate CRM login
        yet — the UI still needs a name to show, not just a blank column."""
        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {
                "Id": "001AAA6", "Name": "No Login Yet Co", "Industry": None,
                "Account_Manager_Lookup__r": {"Email": "kanika@sf-only.test", "Name": "Kanika Sharma"},
                "Owner": {"Email": "raj@sf-only.test", "Name": "Raj Mehta"},
            },
        ]}
        sync_accounts_from_salesforce(db, sf)
        account = db.query(models.Account).filter(models.Account.sf_account_id == "001AAA6").first()
        assert account.owner_user_id is None
        assert account.sf_owner_email == "raj@sf-only.test"
        assert account.sf_owner_name == "Raj Mehta"
        assert account.assigned_csm_id is None
        assert account.sf_csm_email == "kanika@sf-only.test"
        assert account.sf_csm_name == "Kanika Sharma"

    @patch("salesforce.log_sf_operation")
    def test_owner_and_csm_email_match_is_case_insensitive(self, mock_log, db):
        owner = create_test_user(db, email="raj@test.com", role="AE")
        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {"Id": "001AAA7", "Name": "Case Mismatch Co", "Industry": None,
             "Owner": {"Email": "Raj@Test.com"}},
        ]}
        sync_accounts_from_salesforce(db, sf)
        account = db.query(models.Account).filter(models.Account.sf_account_id == "001AAA7").first()
        assert account.owner_user_id == owner.id

    @patch("salesforce.log_sf_operation")
    def test_backfill_links_accounts_once_matching_user_registers(self, mock_log, db):
        """The exact scenario this was built for: sync runs before Kanika
        has a Alternate CRM login, so the account is stuck with a raw email and
        no owner_user_id/assigned_csm_id — then she registers."""
        from salesforce import backfill_sf_identity_links

        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {
                "Id": "001AAA8", "Name": "Pending Link Co", "Industry": None,
                "Account_Manager_Lookup__r": {"Email": "kanika@test.com", "Name": "Kanika"},
                "Owner": {"Email": "kanika@test.com", "Name": "Kanika"},
            },
        ]}
        sync_accounts_from_salesforce(db, sf)
        account = db.query(models.Account).filter(models.Account.sf_account_id == "001AAA8").first()
        assert account.owner_user_id is None
        assert account.assigned_csm_id is None

        kanika = create_test_user(db, email="kanika@test.com", role="CSM")
        updated = backfill_sf_identity_links(db, kanika)
        assert updated == 2  # one owner link + one CSM link, same account
        db.refresh(account)
        assert account.owner_user_id == kanika.id
        assert account.assigned_csm_id == kanika.id


class TestSyncContacts:
    @patch("salesforce.log_sf_operation")
    def test_creates_stakeholder_on_synced_account(self, mock_log, db):
        account = models.Account(sf_account_id="001ACC1", name="Acme")
        db.add(account)
        db.commit()

        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {"Id": "003CON1", "Name": "Jane POC", "Email": "jane@acme.com", "Phone": "555-1234",
             "Title": "VP Ops", "CreatedDate": "2026-09-01", "AccountId": "001ACC1"},
        ]}
        count = sync_contacts_from_salesforce(db, sf)
        assert count == 1
        stakeholder = db.query(models.AccountStakeholder).filter(models.AccountStakeholder.sf_contact_id == "003CON1").first()
        assert stakeholder is not None
        assert stakeholder.account_id == account.id
        assert stakeholder.name == "Jane POC"
        assert stakeholder.email == "jane@acme.com"
        assert stakeholder.role is None  # never auto-set, see AccountStakeholder's doc comment
        mock_log.assert_called()

    def test_skips_contact_whose_account_isnt_synced_locally(self, db):
        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {"Id": "003CON2", "Name": "Orphan Contact", "Email": None, "Phone": None,
             "Title": None, "CreatedDate": None, "AccountId": "001UNKNOWN"},
        ]}
        count = sync_contacts_from_salesforce(db, sf)
        assert count == 0
        assert db.query(models.AccountStakeholder).count() == 0

    @patch("salesforce.log_sf_operation")
    def test_upsert_never_touches_manually_set_role(self, mock_log, db):
        """role is a CSM-only tag — a re-sync must never wipe it."""
        account = models.Account(sf_account_id="001ACC2", name="Beta Co")
        db.add(account)
        db.commit()
        stakeholder = models.AccountStakeholder(
            sf_contact_id="003CON3", account_id=account.id, name="Old Name", role="Champion",
        )
        db.add(stakeholder)
        db.commit()

        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {"Id": "003CON3", "Name": "Renamed Contact", "Email": "new@beta.com", "Phone": None,
             "Title": None, "CreatedDate": None, "AccountId": "001ACC2"},
        ]}
        sync_contacts_from_salesforce(db, sf)
        db.refresh(stakeholder)
        assert stakeholder.name == "Renamed Contact"
        assert stakeholder.email == "new@beta.com"
        assert stakeholder.role == "Champion"  # untouched

    def test_none_sf_returns_zero(self, db):
        assert sync_contacts_from_salesforce(db, None) == 0


class TestSyncOpportunities:
    @patch("salesforce.log_sf_operation")
    def test_creates_new_opportunity_linked_to_account(self, mock_log, db):
        account = models.Account(sf_account_id="001BBB1", name="Northwind Traders")
        db.add(account)
        owner = create_test_user(db, email="owner@test.com", role="AE")
        db.commit()

        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {
                "Id": "006CCC1", "Name": "Northwind Renewal", "Amount": 132000,
                "CloseDate": "2026-09-08", "StageName": "Closed Won",
                "IsClosed": True, "IsWon": True, "AccountId": "001BBB1",
                "Owner": {"Email": "owner@test.com"},
            },
        ]}
        count = sync_opportunities_from_salesforce(db, sf, direction="both")
        assert count == 1
        opp = db.query(models.Opportunity).filter(models.Opportunity.sf_opportunity_id == "006CCC1").first()
        assert opp.account_id == account.id
        assert opp.owner_user_id == owner.id
        assert opp.amount == 132000
        assert opp.is_won is True

    @patch("salesforce.log_sf_operation")
    def test_push_only_mode_never_lets_pull_change_stage(self, mock_log, db):
        """In push_only mode, a local Closed-Won must survive a pull that
        (implausibly, e.g. a stale SF cache) still reports the deal open."""
        opp = models.Opportunity(sf_opportunity_id="006CCC2", is_closed=True, is_won=True, stage_name="Closed Won")
        db.add(opp)
        db.commit()

        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {
                "Id": "006CCC2", "Name": "Still shows open in SF", "Amount": 5000,
                "CloseDate": None, "StageName": "Negotiation/Review",
                "IsClosed": False, "IsWon": False, "AccountId": None, "Owner": None,
            },
        ]}
        sync_opportunities_from_salesforce(db, sf, direction="push_only")
        db.refresh(opp)
        assert opp.is_closed is True
        assert opp.is_won is True
        # Display fields still refresh even though stage didn't move
        assert opp.name == "Still shows open in SF"

    @patch("salesforce.log_sf_operation")
    def test_both_mode_never_regresses_closed_won(self, mock_log, db):
        """Even in "both" mode, a pull can never move a closed-won deal
        backward — only advance it further (which closed-won already is)."""
        opp = models.Opportunity(sf_opportunity_id="006CCC3", is_closed=True, is_won=True)
        db.add(opp)
        db.commit()

        sf = _mock_sf()
        sf.query.return_value = {"records": [
            {
                "Id": "006CCC3", "Name": "X", "Amount": None, "CloseDate": None,
                "StageName": "Prospecting", "IsClosed": False, "IsWon": False,
                "AccountId": None, "Owner": None,
            },
        ]}
        sync_opportunities_from_salesforce(db, sf, direction="both")
        db.refresh(opp)
        assert opp.is_closed is True
        assert opp.is_won is True

    def test_none_sf_returns_zero(self, db):
        assert sync_opportunities_from_salesforce(db, None) == 0


# ──────────────────────────────────────────────────────────────────────────────
# push_pending_leads_to_salesforce — RCA-2026-07-20
#
# The batch used to commit once at the very end. If one lead's write-back hit
# the unique constraint on sf_lead_id (two local leads sharing an email both
# resolving to the same existing SF Lead Id), that single failure silently
# rolled back EVERY other lead's already-succeeded Salesforce create/link from
# the same sync run — the remote SF creates can't be undone, so every
# subsequent sync re-created the same leads as brand-new SF Leads forever.
# ──────────────────────────────────────────────────────────────────────────────

class TestPushPendingLeadsToSalesforce:

    @patch("salesforce.log_sf_operation")
    def test_new_lead_creation_persists_sf_id(self, mock_log, db):
        from salesforce import push_pending_leads_to_salesforce
        lead = create_test_lead(db, email=None, phone="+911111111111",
                                 sf_lead_id="manual-aaa111", status="Meeting Scheduled")
        sf = _mock_sf()
        sf.Lead.create.return_value = {"id": "00Q000000CCCCC3"}

        result = push_pending_leads_to_salesforce(db, sf, "Meeting Scheduled")

        db.refresh(lead)
        assert lead.sf_lead_id == "00Q000000CCCCC3"
        assert result["pushed"] == 1

    @patch("salesforce.log_sf_operation")
    def test_status_update_path_still_commits(self, mock_log, db):
        """Sanity check for the already-linked-lead path after the per-lead commit refactor."""
        from salesforce import push_pending_leads_to_salesforce
        lead = create_test_lead(db, sf_lead_id="00Q000000BBBBB2", status="Meeting Scheduled")
        lead.status_changed_at = datetime.now()
        db.commit()

        sf = _mock_sf()
        with patch("salesforce.push_lead_to_salesforce", return_value=True):
            result = push_pending_leads_to_salesforce(db, sf, "Meeting Scheduled")

        db.refresh(lead)
        assert result["pushed"] == 1
        assert lead.last_synced_at is not None

    @patch("salesforce.log_sf_operation")
    def test_email_collision_does_not_roll_back_other_leads(self, mock_log, db):
        """
        Two local leads share an email (the exact scenario found in prod, e.g.
        'drbasile@sindhuhospitals.com'): lead_a is already linked to a real SF
        Id from an earlier sync; lead_b is a stale duplicate that would resolve
        to that SAME Id via the 'link by email' path. lead_b's collision must
        be reported as an error, not silently swallowed — and, critically, a
        THIRD unrelated lead's fresh creation in the same run must still
        persist despite lead_b's failure.
        """
        from salesforce import push_pending_leads_to_salesforce

        lead_a = create_test_lead(db, first_name="Existing", last_name="Linked",
                                   email="dup@example.com", sf_lead_id="00Q000000AAAAA1",
                                   status="Meeting Scheduled")
        lead_b = create_test_lead(db, first_name="Duplicate", last_name="Copy",
                                   email="dup@example.com", sf_lead_id="upload-abc123",
                                   status="Meeting Scheduled")
        lead_c = create_test_lead(db, first_name="Clean", last_name="NewLead",
                                   email=None, phone="+911234567890", sf_lead_id="manual-xyz987",
                                   status="Meeting Scheduled")

        sf = _mock_sf()
        sf.query.return_value = {"totalSize": 1, "records": [{"Id": "00Q000000AAAAA1"}]}
        sf.Lead.create.return_value = {"id": "00Q000000NEWNEW"}

        result = push_pending_leads_to_salesforce(db, sf, "Meeting Scheduled")

        db.refresh(lead_a)
        db.refresh(lead_b)
        db.refresh(lead_c)

        assert any("Duplicate local lead" in e["error"] for e in result["errors"])
        assert lead_b.sf_lead_id == "upload-abc123"  # left untouched, not silently overwritten
        assert lead_c.sf_lead_id == "00Q000000NEWNEW"  # unaffected by lead_b's failure

    @patch("salesforce.log_sf_operation")
    def test_phone_match_links_lead_instead_of_creating(self, mock_log, db):
        """No email match, but the phone matches an existing SF Lead that
        predates Alternate CRM (or has a different email) — link, don't create.
        Same root cause as the Aircall direct-dial dedup fix."""
        from salesforce import push_pending_leads_to_salesforce
        lead = create_test_lead(db, email=None, phone="+15550001111",
                                 sf_lead_id="upload-abc123", status="Meeting Scheduled")
        sf = _mock_sf()
        with patch("salesforce.find_sf_match_by_phone", return_value={"type": "Lead", "id": "00Q000000PHONE1"}):
            result = push_pending_leads_to_salesforce(db, sf, "Meeting Scheduled")

        db.refresh(lead)
        assert lead.sf_lead_id == "00Q000000PHONE1"
        assert result["pushed"] == 1
        sf.Lead.create.assert_not_called()

    @patch("salesforce.log_sf_operation")
    def test_phone_match_on_opportunity_sets_sf_opportunity_id(self, mock_log, db):
        from salesforce import push_pending_leads_to_salesforce
        lead = create_test_lead(db, email=None, phone="+15550002222",
                                 sf_lead_id="upload-def456", status="Meeting Scheduled")
        sf = _mock_sf()
        with patch("salesforce.find_sf_match_by_phone", return_value={"type": "Opportunity", "id": "0061x000000OPP1"}):
            result = push_pending_leads_to_salesforce(db, sf, "Meeting Scheduled")

        db.refresh(lead)
        assert lead.sf_opportunity_id == "0061x000000OPP1"
        assert lead.sf_lead_id == "upload-def456"  # unchanged — no Lead id to set
        sf.Lead.create.assert_not_called()

    @patch("salesforce.log_sf_operation")
    def test_no_phone_match_still_creates_as_before(self, mock_log, db):
        from salesforce import push_pending_leads_to_salesforce
        create_test_lead(db, email=None, phone="+15550003333",
                          sf_lead_id="upload-ghi789", status="Meeting Scheduled")
        sf = _mock_sf()
        sf.Lead.create.return_value = {"id": "00Q000000NEWNEW"}
        with patch("salesforce.find_sf_match_by_phone", return_value=None):
            result = push_pending_leads_to_salesforce(db, sf, "Meeting Scheduled")

        assert result["created"][0]["sf_id"] == "00Q000000NEWNEW"


class TestFindSfMatchByPhone:

    def test_no_phone_returns_none(self, db):
        from salesforce import find_sf_match_by_phone
        assert find_sf_match_by_phone(db, _mock_sf(), None) is None

    def test_lead_match_with_no_conflict_is_returned(self, db):
        from salesforce import find_sf_match_by_phone
        with patch("salesforce.find_lead_or_opportunity_by_phone",
                   return_value={"type": "Lead", "id": "00Q1x0000000009"}):
            result = find_sf_match_by_phone(db, _mock_sf(), "+15550001111")
        assert result == {"type": "Lead", "id": "00Q1x0000000009"}

    def test_lead_match_already_linked_to_a_different_lead_is_treated_as_no_match(self, db):
        from salesforce import find_sf_match_by_phone
        other = create_test_lead(db, sf_lead_id="00Q1x0000000009", phone="+15550009999")
        with patch("salesforce.find_lead_or_opportunity_by_phone",
                   return_value={"type": "Lead", "id": "00Q1x0000000009"}):
            result = find_sf_match_by_phone(db, _mock_sf(), "+15550001111", exclude_lead_id="some-other-id")
        assert result is None

    def test_opportunity_match_is_never_conflict_checked(self, db):
        from salesforce import find_sf_match_by_phone
        with patch("salesforce.find_lead_or_opportunity_by_phone",
                   return_value={"type": "Opportunity", "id": "0061x000000OPP1"}):
            result = find_sf_match_by_phone(db, _mock_sf(), "+15550001111")
        assert result == {"type": "Opportunity", "id": "0061x000000OPP1"}


# ──────────────────────────────────────────────────────────────────────────────
# push_lead_to_salesforce
# ──────────────────────────────────────────────────────────────────────────────

class TestPushLead:
    @patch("salesforce.log_sf_operation")
    def test_push_maps_fields_correctly(self, mock_log):
        sf = _mock_sf()
        result = push_lead_to_salesforce(
            sf, "00Qxx1",
            {"status": "Meeting Scheduled", "description": "Test desc"},
            lead_info={"first_name": "A", "last_name": "B", "email": "a@b.com"},
        )

        assert result is True
        sf.Lead.update.assert_called_once()
        payload = sf.Lead.update.call_args[0][1]
        assert payload["Lead_Status__c"] == "New Lead"  # LOCAL_TO_SF_STATUS mapping
        assert payload["Description"] == "Test desc"

    @patch("salesforce.log_sf_operation")
    def test_push_empty_payload_returns_true(self, mock_log):
        """Nothing to push → still True (no-op)."""
        sf = _mock_sf()
        result = push_lead_to_salesforce(sf, "00Qxx1", {})
        assert result is True
        sf.Lead.update.assert_not_called()

    def test_push_none_sf_returns_false(self):
        assert push_lead_to_salesforce(None, "00Qxx1", {"status": "Calling"}) is False

    def test_push_none_sf_lead_id_returns_false(self):
        sf = _mock_sf()
        assert push_lead_to_salesforce(sf, None, {"status": "Calling"}) is False

    @patch("salesforce.log_sf_operation")
    def test_push_api_error_returns_false(self, mock_log):
        sf = _mock_sf()
        sf.Lead.update.side_effect = Exception("INVALID_FIELD_FOR_INSERT")
        result = push_lead_to_salesforce(
            sf, "00Qxx1", {"status": "Calling"},
            lead_info={"first_name": "X"},
        )
        assert result is False
        # Should log the failure
        mock_log.assert_called()
        assert mock_log.call_args[1]["status"] == "failed"

    @patch("salesforce.log_sf_operation")
    def test_push_employee_count_converts_to_int(self, mock_log):
        sf = _mock_sf()
        push_lead_to_salesforce(sf, "00Qxx1", {"employee_count": "250"})
        payload = sf.Lead.update.call_args[0][1]
        assert payload["NumberOfEmployees"] == 250

    @patch("salesforce.log_sf_operation")
    def test_push_entity_deleted_recreates_the_lead(self, mock_log, db):
        """RCA 2026-08-03: a Lead deleted directly in Salesforce kept its
        sf_lead_id locally forever, so every future push failed the same
        way. Some push paths (a Kanban status move) only ever fire once,
        right when a status changes — a lead already past that point would
        never get touched again if all we did was clear the stale id, so
        this recreates the Lead immediately instead."""
        lead = create_test_lead(db, first_name="Ajay", last_name="Jagga",
                                 email="ajay@example.com", sf_lead_id="00Qxx1",
                                 status="Demo Done")
        lead.last_synced_at = datetime.now()
        db.commit()

        sf = _mock_sf()
        sf.Lead.update.side_effect = Exception(
            "Resource Lead Not Found. Response content: "
            "[{'message': 'entity is deleted', 'errorCode': 'ENTITY_IS_DELETED', 'fields': []}]"
        )
        sf.query.return_value = {"totalSize": 0, "records": []}
        sf.Lead.create.return_value = {"id": "00QNEWNEW1"}

        result = push_lead_to_salesforce(
            sf, "00Qxx1", {"status": "Calling"},
            lead_info={"first_name": "Ajay", "last_name": "Jagga", "email": "ajay@example.com"},
        )

        assert result is False
        db.refresh(lead)
        assert lead.sf_lead_id == "00QNEWNEW1"
        assert lead.last_synced_at is None

    @patch("salesforce.log_sf_operation")
    def test_push_merged_lead_404_relinks_by_email(self, mock_log, db):
        """RCA 2026-09-29: a merged/hard-deleted Lead returns a 404 with
        INVALID_CROSS_REFERENCE_KEY, not ENTITY_IS_DELETED — it kept the dead
        id and every push failed. It now re-links to the Lead found by email."""
        from simple_salesforce.exceptions import SalesforceResourceNotFound
        lead = create_test_lead(db, email="saravanan@example.com", sf_lead_id="00Qdead1", status="Discovery Complete")
        db.commit()

        sf = _mock_sf()
        sf.Lead.update.side_effect = SalesforceResourceNotFound(
            "https://x/sobjects/Lead/00Qdead1", 404, "Lead",
            [{"message": "invalid cross reference id", "errorCode": "INVALID_CROSS_REFERENCE_KEY", "fields": []}],
        )
        sf.query.return_value = {"totalSize": 1, "records": [{"Id": "00Qmaster"}]}

        push_lead_to_salesforce(sf, "00Qdead1", {"status": "Discovery Complete"},
                                lead_info={"email": "saravanan@example.com"})

        db.refresh(lead)
        assert lead.sf_lead_id == "00Qmaster"
        sf.Lead.create.assert_not_called()

    @patch("salesforce.log_sf_operation")
    def test_push_bad_owner_400_does_not_unlink(self, mock_log, db):
        """A 400 INVALID_CROSS_REFERENCE_KEY (e.g. bad OwnerId) is not a missing record."""
        from simple_salesforce.exceptions import SalesforceMalformedRequest
        lead = create_test_lead(db, sf_lead_id="00Qlive1", status="Calling")
        db.commit()
        sf = _mock_sf()
        sf.Lead.update.side_effect = SalesforceMalformedRequest(
            "https://x/sobjects/Lead/00Qlive1", 400, "Lead",
            [{"message": "invalid cross reference id", "errorCode": "INVALID_CROSS_REFERENCE_KEY", "fields": ["OwnerId"]}],
        )
        push_lead_to_salesforce(sf, "00Qlive1", {"status": "Calling"})
        db.refresh(lead)
        assert lead.sf_lead_id == "00Qlive1"

    @patch("salesforce.log_sf_operation")
    def test_push_entity_deleted_falls_back_to_unlink_when_recreate_fails(self, mock_log, db):
        """If the deleted Lead can't be recreated either, still clear the
        stale id rather than leaving it pointing at a dead record forever."""
        lead = create_test_lead(db, sf_lead_id="00Qxx1", status="Demo Done")
        lead.last_synced_at = datetime.now()
        db.commit()

        sf = _mock_sf()
        sf.Lead.update.side_effect = Exception(
            "Resource Lead Not Found. Response content: "
            "[{'message': 'entity is deleted', 'errorCode': 'ENTITY_IS_DELETED', 'fields': []}]"
        )
        sf.query.return_value = {"totalSize": 0, "records": []}
        sf.Lead.create.side_effect = Exception("UNABLE_TO_LOCK_ROW")

        push_lead_to_salesforce(sf, "00Qxx1", {"status": "Calling"})

        db.refresh(lead)
        assert lead.sf_lead_id is None
        assert lead.last_synced_at is None

    @patch("salesforce.log_sf_operation")
    def test_push_entity_deleted_skips_recreate_if_already_in_progress(self, mock_log, db):
        """RCA 2026-08-03: 6 different push paths can all detect the same
        deleted sf_lead_id close together (e.g. a Kanban move and a call
        outcome firing near-simultaneously) — without a per-lead lock, both
        could find no existing match and both create a duplicate Lead."""
        lead = create_test_lead(db, sf_lead_id="00Qxx1", status="Demo Done")
        db.commit()

        sf = _mock_sf()
        sf.Lead.update.side_effect = Exception(
            "Resource Lead Not Found. Response content: "
            "[{'message': 'entity is deleted', 'errorCode': 'ENTITY_IS_DELETED', 'fields': []}]"
        )

        # Simulate another thread already mid-recovery for this exact sf_lead_id.
        lock = _get_recreate_lock("00Qxx1")
        lock.acquire()
        try:
            result = push_lead_to_salesforce(sf, "00Qxx1", {"status": "Calling"})
        finally:
            lock.release()

        assert result is False
        sf.query.assert_not_called()
        sf.Lead.create.assert_not_called()
        db.refresh(lead)
        assert lead.sf_lead_id == "00Qxx1"  # untouched — the in-progress thread owns recovery

    @patch("salesforce.log_sf_operation")
    def test_push_other_api_error_leaves_sf_lead_id_untouched(self, mock_log, db):
        """A generic failure (not a deletion) must not unlink the lead."""
        lead = create_test_lead(db, sf_lead_id="00Qxx1", status="Demo Done")

        sf = _mock_sf()
        sf.Lead.update.side_effect = Exception("INVALID_FIELD_FOR_INSERT")
        push_lead_to_salesforce(sf, "00Qxx1", {"status": "Calling"})

        db.refresh(lead)
        assert lead.sf_lead_id == "00Qxx1"

    @patch("salesforce.log_sf_operation")
    def test_push_maps_title_to_job_title_field(self, mock_log):
        """RCA 2026-08-03: this org uses a custom Job_Title__c field on the
        page layout, not the standard Title field — confirmed live against
        the org's actual Lead record, which showed Job_Title__c empty
        despite us pushing a real title to the (unused) standard field."""
        sf = _mock_sf()
        push_lead_to_salesforce(sf, "00Qxx1", {"title": "CEO"})
        payload = sf.Lead.update.call_args[0][1]
        assert payload["Job_Title__c"] == "CEO"
        assert "Title" not in payload

    @patch("salesforce.log_sf_operation")
    def test_push_maps_linkedin_sdr_name_and_disqualification_reason(self, mock_log):
        sf = _mock_sf()
        push_lead_to_salesforce(sf, "00Qxx1", {
            "linkedin_url": "https://linkedin.com/in/x",
            "sdr_name": "Tanya Batra",
            "disqualification_reason": "Not Interested",
        })
        payload = sf.Lead.update.call_args[0][1]
        assert payload["LinkedIn_Profile__c"] == "https://linkedin.com/in/x"
        assert payload["SDR_Name__c"] == "Tanya Batra"
        assert payload["Lead_Lost_Reason__c"] == "Not Interested"

    @patch("salesforce.log_sf_operation")
    def test_push_resyncs_sdr_name_and_linkedin_on_a_plain_status_update(self, mock_log):
        """RCA 2026-08-03: these must not go stale after the Lead's first
        sync — a reassigned lead, or a LinkedIn URL added later, should
        reach Salesforce on the very next push, not just at creation."""
        sf = _mock_sf()
        push_lead_to_salesforce(
            sf, "00Qxx1", {"status": "Calling"},
            lead_info={"sdr_name": "New SDR", "linkedin_url": "https://linkedin.com/in/new"},
        )
        payload = sf.Lead.update.call_args[0][1]
        assert payload["SDR_Name__c"] == "New SDR"
        assert payload["LinkedIn_Profile__c"] == "https://linkedin.com/in/new"

    @patch("salesforce.log_sf_operation")
    def test_push_does_not_override_an_explicit_sdr_name_in_updates(self, mock_log):
        sf = _mock_sf()
        push_lead_to_salesforce(
            sf, "00Qxx1", {"status": "Calling", "sdr_name": "Explicit Override"},
            lead_info={"sdr_name": "From Lead Info"},
        )
        payload = sf.Lead.update.call_args[0][1]
        assert payload["SDR_Name__c"] == "Explicit Override"

    @patch("salesforce.log_sf_operation")
    def test_push_without_lead_info_does_not_resync_sdr_name(self, mock_log):
        """No lead_info at all (some callers still don't pass one) must not
        crash and must not invent a value."""
        sf = _mock_sf()
        push_lead_to_salesforce(sf, "00Qxx1", {"status": "Calling"})
        payload = sf.Lead.update.call_args[0][1]
        assert "SDR_Name__c" not in payload

    @patch("salesforce.log_sf_operation")
    def test_push_retries_without_sdr_name_on_restricted_picklist_rejection(self, mock_log):
        """Live finding, 2026-09-15: a connected org's SDR_Name__c picklist
        can lag behind Alternate CRM's real SDR roster — SF then rejects the
        *whole* update, not just that field. Retry once without it rather
        than losing every other field in the push."""
        sf = _mock_sf()
        sf.Lead.update.side_effect = [
            Exception(
                "Malformed request. Response content: [{'message': 'bad value for "
                "restricted picklist field: New SDR', 'errorCode': "
                "'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', 'fields': ['SDR_Name__c']}]"
            ),
            None,
        ]
        result = push_lead_to_salesforce(sf, "00Qxx1", {"status": "Calling", "sdr_name": "New SDR"})
        assert result is True
        assert sf.Lead.update.call_count == 2
        retry_payload = sf.Lead.update.call_args_list[1][0][1]
        assert "SDR_Name__c" not in retry_payload
        assert retry_payload["Lead_Status__c"]  # rest of the update still went through

    @patch("salesforce.log_sf_operation")
    def test_create_retries_without_sdr_name_on_restricted_picklist_rejection(self, mock_log):
        sf = _mock_sf()
        sf.Lead.create.side_effect = [
            Exception(
                "Malformed request. Response content: [{'message': 'bad value for "
                "restricted picklist field: New SDR', 'errorCode': "
                "'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', 'fields': ['SDR_Name__c']}]"
            ),
            {"id": "00QNEW1"},
        ]
        sf_id = create_new_lead_in_salesforce(sf, {
            "first_name": "A", "last_name": "B", "company": "C", "sdr_name": "New SDR",
        })
        assert sf_id == "00QNEW1"
        assert sf.Lead.create.call_count == 2
        retry_payload = sf.Lead.create.call_args_list[1][0][0]
        assert "SDR_Name__c" not in retry_payload

    @patch("salesforce.log_sf_operation")
    def test_push_resolves_owner_email_to_owner_id(self, mock_log):
        """AE ownership goes to Lead Owner (a plain lookup, resolved by
        Email), not the SDR-only SDR_Name__c picklist."""
        sf = _mock_sf()
        sf.query.return_value = {"records": [{"Id": "005AE0001"}]}
        push_lead_to_salesforce(sf, "00Qxx1", {"owner_email": "ae@test.com"})
        payload = sf.Lead.update.call_args[0][1]
        assert payload["OwnerId"] == "005AE0001"
        assert "owner_email" not in payload

    @patch("salesforce.log_sf_operation")
    def test_push_resyncs_owner_email_on_a_plain_status_update(self, mock_log):
        sf = _mock_sf()
        sf.query.return_value = {"records": [{"Id": "005AE0002"}]}
        push_lead_to_salesforce(
            sf, "00Qxx1", {"status": "Calling"}, lead_info={"owner_email": "ae@test.com"},
        )
        payload = sf.Lead.update.call_args[0][1]
        assert payload["OwnerId"] == "005AE0002"

    @patch("salesforce.log_sf_operation")
    def test_push_skips_owner_id_when_no_matching_sf_user(self, mock_log):
        """A lookup miss (or a query error) must skip OwnerId, never crash
        the whole push — here it leaves nothing else to push, so the update
        call itself is skipped rather than sent with an empty payload."""
        sf = _mock_sf()
        sf.query.return_value = {"records": []}
        push_lead_to_salesforce(sf, "00Qxx1", {"owner_email": "ghost@test.com"})
        sf.Lead.update.assert_not_called()

    @patch("salesforce.log_sf_operation")
    def test_push_skips_only_owner_id_when_no_matching_sf_user_but_other_fields_push(self, mock_log):
        sf = _mock_sf()
        sf.query.return_value = {"records": []}
        push_lead_to_salesforce(sf, "00Qxx1", {"status": "Calling", "owner_email": "ghost@test.com"})
        payload = sf.Lead.update.call_args[0][1]
        assert "OwnerId" not in payload
        assert payload["Lead_Status__c"] == "New Lead"


# ──────────────────────────────────────────────────────────────────────────────
# lead_push_info
# ──────────────────────────────────────────────────────────────────────────────

class TestLeadPushInfo:
    def test_city_state_country_fall_back_to_company_fields(self, db):
        """RCA 2026-08-03: City/State/Country are contact-level fields,
        almost always blank on an uploaded/list-sourced lead — the real
        location data lives in the company_* enrichment fields."""
        lead = create_test_lead(db)
        lead.city = None
        lead.state = None
        lead.country = None
        lead.company_city = "New Delhi"
        lead.company_state = "Delhi"
        lead.company_country = "India"
        db.commit()

        info = lead_push_info(lead)
        assert info["city"] == "New Delhi"
        assert info["state"] == "Delhi"
        assert info["country"] == "India"

    def test_contact_level_location_wins_when_present(self, db):
        lead = create_test_lead(db)
        lead.city = "Austin"
        lead.company_city = "New Delhi"
        db.commit()

        assert lead_push_info(lead)["city"] == "Austin"

    def test_sdr_name_joins_assigned_users(self, db):
        lead = create_test_lead(db)
        sdr = create_test_user(db, email="tanya@test.com", name="Tanya Batra")
        lead.assigned_users.append(sdr)
        db.commit()

        assert lead_push_info(lead)["sdr_name"] == "Tanya Batra"

    def test_sdr_name_none_when_unassigned(self, db):
        lead = create_test_lead(db)
        assert lead_push_info(lead)["sdr_name"] is None

    def test_sdr_name_excludes_ae_assignees(self, db):
        """SDR_Name__c is a Salesforce restricted picklist of real SDR names
        only — an AE's name is not a valid value there and Salesforce
        rejects the whole write (INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST),
        live-reproduced for an AE-only lead. Only SDR-role assignees should
        ever reach this field."""
        lead = create_test_lead(db)
        ae = create_test_user(db, email="ae@test.com", name="Samya Choudhary", role="AE")
        lead.assigned_users.append(ae)
        db.commit()

        assert lead_push_info(lead)["sdr_name"] is None

    def test_sdr_name_includes_only_sdrs_when_mixed_with_an_ae(self, db):
        lead = create_test_lead(db)
        sdr = create_test_user(db, email="tanya@test.com", name="Tanya Batra", role="SDR")
        ae = create_test_user(db, email="ae@test.com", name="Samya Choudhary", role="AE")
        lead.assigned_users.append(sdr)
        lead.assigned_users.append(ae)
        db.commit()

        assert lead_push_info(lead)["sdr_name"] == "Tanya Batra"

    def test_owner_email_is_the_assigned_ae(self, db):
        lead = create_test_lead(db)
        ae = create_test_user(db, email="ae@test.com", name="Samya Choudhary", role="AE")
        lead.assigned_users.append(ae)
        db.commit()

        assert lead_push_info(lead)["owner_email"] == "ae@test.com"

    def test_owner_email_none_when_no_ae_assigned(self, db):
        lead = create_test_lead(db)
        sdr = create_test_user(db, email="tanya@test.com", name="Tanya Batra", role="SDR")
        lead.assigned_users.append(sdr)
        db.commit()

        assert lead_push_info(lead)["owner_email"] is None

    def test_linkedin_url_falls_back_to_person_linkedin(self, db):
        lead = create_test_lead(db)
        lead.linkedin_url = None
        lead.person_linkedin = "https://linkedin.com/in/fallback"
        db.commit()

        assert lead_push_info(lead)["linkedin_url"] == "https://linkedin.com/in/fallback"

    def test_description_included_without_db_session(self, db):
        """_build_lead_description(lead, db=None) still returns the
        lead-only sections (no call history/notes) — confirms lead_push_info
        works from a background thread with no db session available."""
        lead = create_test_lead(db, company="Acme", first_name="A")
        lead.title = "CEO"
        db.commit()

        assert "Acme" in lead_push_info(lead)["description"]


# ──────────────────────────────────────────────────────────────────────────────
# create_new_lead_in_salesforce
# ──────────────────────────────────────────────────────────────────────────────

class TestCreateLead:
    @patch("salesforce.log_sf_operation")
    def test_create_returns_sf_id(self, mock_log):
        sf = _mock_sf()
        sf.Lead.create.return_value = {"id": "00Qnew1", "success": True}
        result = create_new_lead_in_salesforce(sf, {
            "first_name": "Dan",
            "last_name": "Test",
            "company": "NewCo",
            "email": "dan@newco.com",
        })
        assert result == "00Qnew1"
        sf.Lead.create.assert_called_once()

    @patch("salesforce.log_sf_operation")
    def test_create_sets_defaults(self, mock_log):
        sf = _mock_sf()
        sf.Lead.create.return_value = {"id": "00Qnew2"}
        create_new_lead_in_salesforce(sf, {"last_name": "Only"})
        payload = sf.Lead.create.call_args[0][0]
        assert payload["LastName"] == "Only"
        assert payload["Company"] == "Unknown"
        assert payload["Lead_Status__c"] == "New Lead"
        assert payload["Lead_Source_New__c"] == "SDR Generated"

    @patch("salesforce.log_sf_operation")
    def test_create_sets_owner_id_for_an_ae_assigned_lead(self, mock_log):
        sf = _mock_sf()
        sf.Lead.create.return_value = {"id": "00Qnew3"}
        sf.query.return_value = {"records": [{"Id": "005AE0003"}]}
        create_new_lead_in_salesforce(sf, {"last_name": "X", "owner_email": "ae@test.com"})
        payload = sf.Lead.create.call_args[0][0]
        assert payload["OwnerId"] == "005AE0003"

    def test_create_none_sf_raises(self):
        with pytest.raises(Exception, match="Salesforce client not found"):
            create_new_lead_in_salesforce(None, {"last_name": "X"})

    @patch("salesforce.log_sf_operation")
    def test_create_api_error_raises(self, mock_log):
        sf = _mock_sf()
        sf.Lead.create.side_effect = Exception("REQUIRED_FIELD_MISSING")
        with pytest.raises(Exception, match="REQUIRED_FIELD_MISSING"):
            create_new_lead_in_salesforce(sf, {"last_name": "X"})
        mock_log.assert_called()
        assert mock_log.call_args[1]["status"] == "failed"


# ──────────────────────────────────────────────────────────────────────────────
# find_or_create_lead_in_salesforce
# ──────────────────────────────────────────────────────────────────────────────

class TestFindOrCreateLead:
    @patch("salesforce.log_sf_operation")
    def test_finds_existing_lead_by_email(self, mock_log):
        sf = _mock_sf()
        sf.query.return_value = {"totalSize": 1, "records": [{"Id": "00QEXIST1"}]}
        result = find_or_create_lead_in_salesforce(
            sf, {"email": "a@b.com", "first_name": "A", "last_name": "B"}
        )
        assert result == "00QEXIST1"
        sf.Lead.create.assert_not_called()

    @patch("salesforce.log_sf_operation")
    def test_creates_when_no_email_match(self, mock_log):
        sf = _mock_sf()
        sf.query.return_value = {"totalSize": 0, "records": []}
        sf.Lead.create.return_value = {"id": "00QNEW1"}
        result = find_or_create_lead_in_salesforce(
            sf, {"email": "a@b.com", "last_name": "B", "company": "Acme"}
        )
        assert result == "00QNEW1"

    @patch("salesforce.log_sf_operation")
    def test_creates_when_no_email_given(self, mock_log):
        sf = _mock_sf()
        sf.Lead.create.return_value = {"id": "00QNEW2"}
        result = find_or_create_lead_in_salesforce(sf, {"last_name": "B"})
        assert result == "00QNEW2"
        sf.query.assert_not_called()


# ──────────────────────────────────────────────────────────────────────────────
# sync_sdrs_from_salesforce
# ──────────────────────────────────────────────────────────────────────────────

class TestSyncSDRs:
    def test_creates_new_users(self, db):
        sf = _mock_sf()
        sf.query.return_value = {
            "records": [
                {"Id": "aSDR001", "Name": "Eve SDR", "Email__c": "eve-sdr-test@example.com",
                 "Role__c": "SDR", "Active__c": True},
            ]
        }
        count = sync_sdrs_from_salesforce(db, sf)
        assert count == 1
        user = db.query(models.User).filter(models.User.email == "eve-sdr-test@example.com").first()
        assert user is not None
        assert user.name == "Eve SDR"
        assert user.role == "SDR"
        assert user.sf_sdr_id == "aSDR001"

    def test_updates_existing_user(self, db):
        sf = _mock_sf()
        user = create_test_user(db, email="frank-sdr-test@example.com", name="Frank", role="SDR")

        sf.query.return_value = {
            "records": [
                {"Id": "aSDR002", "Name": "Frank Updated", "Email__c": "frank-sdr-test@example.com",
                 "Role__c": "Admin", "Active__c": True},
            ]
        }
        count = sync_sdrs_from_salesforce(db, sf)
        assert count == 1
        db.refresh(user)
        assert user.name == "Frank Updated"
        assert user.role == "Super Admin"  # "Admin" maps to "Super Admin"

    def test_none_sf_returns_zero(self, db):
        assert sync_sdrs_from_salesforce(db, None) == 0

    def test_skips_records_without_email(self, db):
        sf = _mock_sf()
        sf.query.return_value = {
            "records": [
                {"Id": "aSDR003", "Name": "No Email", "Email__c": None,
                 "Role__c": "SDR", "Active__c": True},
            ]
        }
        count = sync_sdrs_from_salesforce(db, sf)
        assert count == 0


# ──────────────────────────────────────────────────────────────────────────────
# create_sdr_in_salesforce
# ──────────────────────────────────────────────────────────────────────────────

class TestCreateSDR:
    def test_create_returns_id(self):
        sf = _mock_sf()
        sf.SDR__c.create.return_value = {"id": "aSDRnew1"}
        result = create_sdr_in_salesforce(sf, {
            "name": "Grace SDR",
            "email": "grace@example.com",
            "role": "SDR",
        })
        assert result == "aSDRnew1"

    def test_create_none_sf_raises(self):
        with pytest.raises(Exception, match="Salesforce client not found"):
            create_sdr_in_salesforce(None, {"name": "X"})

    def test_create_api_error_returns_none(self):
        sf = _mock_sf()
        sf.SDR__c.create.side_effect = Exception("SF error")
        result = create_sdr_in_salesforce(sf, {"name": "X", "email": "x@test.com"})
        assert result is None


# ──────────────────────────────────────────────────────────────────────────────
# push_sdr_metrics_to_salesforce
# ──────────────────────────────────────────────────────────────────────────────

class TestPushSDRMetrics:
    def test_push_metrics_success(self):
        sf = _mock_sf()
        user = MagicMock()
        user.sf_sdr_id = "aSDR001"
        user.email = "test@example.com"

        result = push_sdr_metrics_to_salesforce(sf, user, {
            "calls_today": 15,
            "total_leads": 42,
        })
        assert result is True
        sf.SDR__c.update.assert_called_once()
        payload = sf.SDR__c.update.call_args[0][1]
        assert payload["Calls_Today__c"] == 15
        assert payload["Total_Leads__c"] == 42

    def test_push_datetime_converted_to_iso(self):
        sf = _mock_sf()
        user = MagicMock()
        user.sf_sdr_id = "aSDR001"
        user.email = "test@example.com"

        dt = datetime(2026, 5, 1, 10, 30)
        push_sdr_metrics_to_salesforce(sf, user, {"last_login": dt})
        payload = sf.SDR__c.update.call_args[0][1]
        assert payload["Last_Login__c"] == dt.isoformat()

    def test_push_empty_metrics_returns_true(self):
        sf = _mock_sf()
        user = MagicMock()
        user.sf_sdr_id = "aSDR001"
        result = push_sdr_metrics_to_salesforce(sf, user, {})
        assert result is True
        sf.SDR__c.update.assert_not_called()

    def test_push_none_sf_returns_false(self):
        user = MagicMock()
        user.sf_sdr_id = "aSDR001"
        assert push_sdr_metrics_to_salesforce(None, user, {"calls_today": 1}) is False

    def test_push_no_sdr_id_returns_false(self):
        sf = _mock_sf()
        user = MagicMock()
        user.sf_sdr_id = None
        assert push_sdr_metrics_to_salesforce(sf, user, {"calls_today": 1}) is False

    def test_push_api_error_returns_false(self):
        sf = _mock_sf()
        sf.SDR__c.update.side_effect = Exception("SF error")
        user = MagicMock()
        user.sf_sdr_id = "aSDR001"
        user.email = "test@example.com"
        assert push_sdr_metrics_to_salesforce(sf, user, {"calls_today": 1}) is False


class TestPushOpportunity:
    """The close write-back half. These exist because the payload shipped for
    two releases in a shape Salesforce could never have accepted, and it was
    invisible: opportunity_writeback_enabled defaults False, so nothing ever
    called SF with it."""

    @patch("salesforce.log_sf_operation")
    def test_payload_omits_the_read_only_formula_fields(self, mock_log, db):
        """IsClosed/IsWon are read-only formula fields on SF's Opportunity,
        derived from StageName. Including them fails the whole update, so
        StageName has to carry the close on its own."""
        opp = models.Opportunity(
            sf_opportunity_id="006ZZZ1", name="Closed deal",
            stage_name="Closed Won", is_closed=True, is_won=True,
            close_date=datetime(2026, 9, 11),
        )
        db.add(opp)
        db.commit()

        sf = _mock_sf()
        sf.Opportunity = MagicMock()
        assert push_opportunity_to_salesforce(db, sf, opp) is True

        _, payload = sf.Opportunity.update.call_args[0]
        assert payload == {"StageName": "Closed Won", "CloseDate": "2026-09-11"}
        assert "IsClosed" not in payload
        assert "IsWon" not in payload

    @patch("salesforce.log_sf_operation")
    def test_payload_includes_standard_product_and_invoice_when_set(self, mock_log, db):
        """Live finding, 2026-09-15: this org rejects a Closed-stage push
        without these — see the AE close-deal form fields that collect them."""
        opp = models.Opportunity(
            sf_opportunity_id="006ZZZ2", name="Closed deal", stage_name="Closed Won",
            is_closed=True, is_won=True, close_date=datetime(2026, 9, 11),
            standard_product_names="SMS Pack - Regal;Long code", invoice_number="INV-1001",
        )
        db.add(opp)
        db.commit()

        sf = _mock_sf()
        sf.Opportunity = MagicMock()
        assert push_opportunity_to_salesforce(db, sf, opp) is True

        _, payload = sf.Opportunity.update.call_args[0]
        assert payload["Standard_Product_Name__c"] == "SMS Pack - Regal;Long code"
        assert payload["Invoice_Number__c"] == "INV-1001"

    @patch("salesforce.log_sf_operation")
    def test_payload_includes_lost_reason_when_set(self, mock_log, db):
        """Live finding, 2026-09-16: this org also requires
        Opportunity_Lost_Reason__c on a Closed Lost push."""
        opp = models.Opportunity(
            sf_opportunity_id="006ZZZ3", name="Lost deal", stage_name="Closed Lost",
            is_closed=True, is_won=False, close_date=datetime(2026, 9, 11),
            standard_product_names="SMS Pack - Regal", invoice_number="INV-1002",
            lost_reason="Budget",
        )
        db.add(opp)
        db.commit()

        sf = _mock_sf()
        sf.Opportunity = MagicMock()
        assert push_opportunity_to_salesforce(db, sf, opp) is True

        _, payload = sf.Opportunity.update.call_args[0]
        assert payload["Opportunity_Lost_Reason__c"] == "Budget"

    def test_no_sf_id_is_a_no_op(self, db):
        opp = models.Opportunity(name="Local only", stage_name="Discovery")
        db.add(opp)
        db.commit()
        sf = _mock_sf()
        sf.Opportunity = MagicMock()
        assert push_opportunity_to_salesforce(db, sf, opp) is False
        sf.Opportunity.update.assert_not_called()
