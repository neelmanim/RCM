"""
test_salesforce_lookup.py — v11.4.2 live Salesforce lookup on direct-dial miss
================================================================================
RCA: the org runs Salesforce sync push_only by design (Alternate CRM is a funnel
INTO Salesforce, not a mirror of it) — inbound Salesforce Leads/Opportunities
that never went through the outbound upload flow have no local row to match,
so a direct Aircall dial to one always created a placeholder "Unknown Caller"
lead instead of the real record.

Covers:
  - salesforce.find_lead_or_opportunity_by_phone: Lead match, Opportunity
    match (via Contact -> OpportunityContactRole), no match, exception safety
  - salesforce.salesforce_record_url: builds from instance_url, None when
    no active connection
  - dialer_service._find_or_create_lead_by_phone(try_salesforce_lookup=True):
    webhook path creates a real-data lead + links the SF record
  - Historical bulk-sync path (try_salesforce_lookup defaults False) never
    calls Salesforce, even when a match would be found
  - lead_helpers._sf_links / _lead_to_dict expose sf_lead_url/sf_opportunity_url,
    respecting sentinel-ID filtering
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, MagicMock

import models
from conftest import create_test_user, create_test_pod, create_sync_settings


# ── find_lead_or_opportunity_by_phone ────────────────────────────────────────

class TestFindLeadOrOpportunityByPhone:

    def test_no_sf_client_returns_none(self):
        from salesforce import find_lead_or_opportunity_by_phone
        assert find_lead_or_opportunity_by_phone(None, "+15550001111") is None

    def test_short_number_returns_none(self):
        from salesforce import find_lead_or_opportunity_by_phone
        sf = MagicMock()
        assert find_lead_or_opportunity_by_phone(sf, "123") is None
        sf.query.assert_not_called()

    def test_lead_match(self):
        from salesforce import find_lead_or_opportunity_by_phone
        sf = MagicMock()
        sf.query.return_value = {"records": [
            {"Id": "00Q1x0000000001", "FirstName": "Nishita", "LastName": "Test",
             "Company": "Acme Inc", "Email": "n@acme.com", "Phone": "+1 (555) 000-1111"},
        ]}
        result = find_lead_or_opportunity_by_phone(sf, "+15550001111")
        assert result == {
            "type": "Lead", "id": "00Q1x0000000001",
            "first_name": "Nishita", "last_name": "Test",
            "company": "Acme Inc", "email": "n@acme.com",
        }

    def test_opportunity_match_via_contact_role(self):
        from salesforce import find_lead_or_opportunity_by_phone
        sf = MagicMock()

        def _query(soql):
            if soql.startswith("SELECT Id, FirstName, LastName, Company"):
                return {"records": []}  # no Lead match
            if soql.startswith("SELECT Id, FirstName, LastName, Phone, MobilePhone"):
                return {"records": [{
                    "Id": "0031x000000ABCD", "FirstName": "Jordan", "LastName": "Buyer",
                    "Phone": None, "MobilePhone": "+15550002222",
                    "Account": {"Name": "Big Corp"},
                }]}
            if soql.startswith("SELECT OpportunityId"):
                return {"records": [{"OpportunityId": "0061x000000WXYZ"}]}
            return {"records": []}

        sf.query.side_effect = _query
        result = find_lead_or_opportunity_by_phone(sf, "+15550002222")
        assert result == {
            "type": "Opportunity", "id": "0061x000000WXYZ",
            "first_name": "Jordan", "last_name": "Buyer",
            "company": "Big Corp", "email": None,
        }

    def test_no_match_anywhere(self):
        from salesforce import find_lead_or_opportunity_by_phone
        sf = MagicMock()
        sf.query.return_value = {"records": []}
        assert find_lead_or_opportunity_by_phone(sf, "+15559999999") is None

    def test_query_exception_is_swallowed(self):
        """A lookup failure (bad creds, timeout, API error) must never bubble
        up and break webhook processing — it just means 'no match found'."""
        from salesforce import find_lead_or_opportunity_by_phone
        sf = MagicMock()
        sf.query.side_effect = Exception("SF API error")
        assert find_lead_or_opportunity_by_phone(sf, "+15550001111") is None


# ── salesforce_record_url ─────────────────────────────────────────────────────

class TestSalesforceRecordUrl:

    def test_no_record_id_returns_none(self, db):
        from salesforce import salesforce_record_url
        assert salesforce_record_url(db, "Opportunity", None) is None

    def test_no_active_connection_returns_none(self, db):
        from salesforce import salesforce_record_url
        assert salesforce_record_url(db, "Lead", "00Q1x0000000001") is None

    def test_builds_url_from_instance_url(self, db):
        from salesforce import salesforce_record_url
        db.add(models.SalesforceConnection(
            is_active=True, instance_url="https://acme.my.salesforce.com", username="test@sf.com", password_encrypted="enc-password", security_token_encrypted="enc-token",
        ))
        db.commit()
        url = salesforce_record_url(db, "Opportunity", "0061x000000WXYZ")
        assert url == "https://acme.my.salesforce.com/lightning/r/Opportunity/0061x000000WXYZ/view"


# ── _find_or_create_lead_by_phone(try_salesforce_lookup=True) via handle_webhook ──

class TestWebhookSalesforceLookup:

    def _fire(self, db, phone, user_email="sdr@test.com", provider_call_id="WH900", sync_direction="both"):
        from dialer_service import handle_webhook
        from dialer_provider import NormalizedCallEvent, CallEventType

        event = NormalizedCallEvent(
            event_type=CallEventType.CALL_STARTED,
            provider="aircall", provider_call_id=provider_call_id,
            phone_number=phone, direction="outbound",
            user_email=user_email, raw_payload={},
        )
        # RCA 2026-08-31: the live lookup itself is now gated on sync_direction
        # == "both" (a push_only org must never pull FROM Salesforce, even via
        # this per-call path) — default "both" here so the tests below keep
        # exercising the lookup mechanism; see
        # test_push_only_skips_the_lookup below for the gate itself.
        create_sync_settings(db, sync_direction=sync_direction)
        with patch("dialer_service._instantiate_provider") as mock_provider:
            provider_mock = MagicMock()
            provider_mock.provider_name = "aircall"
            provider_mock.handle_webhook.return_value = event
            mock_provider.return_value = provider_mock
            return handle_webhook(db, "aircall", {})

    def test_lead_match_creates_real_lead_not_placeholder(self, db):
        pod = create_test_pod(db)
        create_test_user(db, email="sdr@test.com", role="SDR", pod_id=pod.id)

        with patch("salesforce.get_sf_client", return_value=MagicMock()), \
             patch("salesforce.find_lead_or_opportunity_by_phone", return_value={
                 "type": "Lead", "id": "00Q1x0000000009",
                 "first_name": "Nishita", "last_name": "Real", "company": "Acme Inc", "email": "n@acme.com",
             }):
            self._fire(db, phone="+15550003333")

        lead = db.query(models.Lead).filter(models.Lead.phone == "+15550003333").first()
        assert lead is not None
        assert lead.sf_lead_id == "00Q1x0000000009"
        assert lead.sf_opportunity_id is None
        assert lead.first_name == "Nishita"
        assert lead.last_name == "Real"
        assert lead.company == "Acme Inc"
        assert "salesforce_match" in lead.lead_source

    def test_opportunity_match_sets_sf_opportunity_id(self, db):
        pod = create_test_pod(db)
        create_test_user(db, email="sdr@test.com", role="SDR", pod_id=pod.id)

        with patch("salesforce.get_sf_client", return_value=MagicMock()), \
             patch("salesforce.find_lead_or_opportunity_by_phone", return_value={
                 "type": "Opportunity", "id": "0061x000000WXYZ",
                 "first_name": "Jordan", "last_name": "Buyer", "company": "Big Corp", "email": None,
             }):
            self._fire(db, phone="+15550004444")

        lead = db.query(models.Lead).filter(models.Lead.phone == "+15550004444").first()
        assert lead is not None
        assert lead.sf_opportunity_id == "0061x000000WXYZ"
        assert lead.first_name == "Jordan"
        assert lead.company == "Big Corp"
        # sf_lead_id still gets the usual local sentinel — no real Lead match
        assert lead.sf_lead_id.startswith("aircall_webhook:")

    def test_no_sf_match_falls_back_to_placeholder_unchanged(self, db):
        """No Salesforce match at all -> exact pre-existing behavior."""
        pod = create_test_pod(db)
        create_test_user(db, email="sdr@test.com", role="SDR", pod_id=pod.id)

        with patch("salesforce.get_sf_client", return_value=MagicMock()), \
             patch("salesforce.find_lead_or_opportunity_by_phone", return_value=None):
            self._fire(db, phone="+15550005555")

        lead = db.query(models.Lead).filter(models.Lead.phone == "+15550005555").first()
        assert lead is not None
        assert lead.first_name == ""
        assert lead.last_name == "Unknown"
        assert lead.sf_opportunity_id is None

    def test_sf_not_configured_falls_back_gracefully(self, db):
        """get_sf_client() returning None (no SF connection at all) must not
        crash webhook processing — same placeholder-creation path as today."""
        pod = create_test_pod(db)
        create_test_user(db, email="sdr@test.com", role="SDR", pod_id=pod.id)

        with patch("salesforce.get_sf_client", return_value=None):
            self._fire(db, phone="+15550006666")

        lead = db.query(models.Lead).filter(models.Lead.phone == "+15550006666").first()
        assert lead is not None
        assert lead.last_name == "Unknown"

    def test_push_only_skips_the_lookup_creates_placeholder(self, db):
        """RCA 2026-08-31: a push_only org must never pull FROM Salesforce —
        this per-call path was the one place that ignored sync_direction,
        continuously creating real SF-sourced leads in Alternate CRM. With
        sync_direction=push_only, the live lookup must not even be
        attempted, regardless of what it would have matched."""
        pod = create_test_pod(db)
        create_test_user(db, email="sdr@test.com", role="SDR", pod_id=pod.id)

        with patch("salesforce.get_sf_client", return_value=MagicMock()) as mock_client, \
             patch("salesforce.find_lead_or_opportunity_by_phone", return_value={
                 "type": "Lead", "id": "00Q1x0000000009",
                 "first_name": "Nishita", "last_name": "Real", "company": "Acme Inc", "email": "n@acme.com",
             }) as mock_lookup:
            self._fire(db, phone="+15550007777", sync_direction="push_only")

        mock_client.assert_not_called()
        mock_lookup.assert_not_called()
        lead = db.query(models.Lead).filter(models.Lead.phone == "+15550007777").first()
        assert lead is not None
        assert lead.first_name == ""
        assert lead.last_name == "Unknown"
        assert "salesforce_match" not in lead.lead_source


# ── Historical bulk-sync must never trigger a live SF lookup ─────────────────

class TestHistoricalSyncNeverCallsSalesforce:

    def test_bulk_sync_miss_does_not_query_salesforce(self, db):
        """try_salesforce_lookup defaults False on the historical-sync call
        site — must stay that way even if a live match would be found, to
        avoid one SF API round-trip per miss in a large batch."""
        from dialer_service import _find_or_create_lead_by_phone

        pod = create_test_pod(db)
        sdr = create_test_user(db, email="bulk@test.com", role="SDR", pod_id=pod.id)

        with patch("salesforce.get_sf_client") as mock_get_client, \
             patch("salesforce.find_lead_or_opportunity_by_phone") as mock_lookup:
            lead = _find_or_create_lead_by_phone(db, "+15550007777", sdr.id, "aircall_sync:2026-08-18")

        assert lead is not None
        assert lead.last_name == "Unknown"  # placeholder, not enriched
        mock_get_client.assert_not_called()
        mock_lookup.assert_not_called()


# ── lead_helpers._sf_links / _lead_to_dict ───────────────────────────────────

class TestLeadDetailSalesforceLinks:

    def test_real_sf_lead_id_gets_a_link(self, db):
        from routes.lead_helpers import _lead_to_dict
        db.add(models.SalesforceConnection(is_active=True, instance_url="https://acme.my.salesforce.com", username="test@sf.com", password_encrypted="enc-password", security_token_encrypted="enc-token"))
        lead = models.Lead(sf_lead_id="00Q1x0000000009", first_name="A", last_name="B", phone="+1", status="Calling")
        db.add(lead)
        db.commit()

        result = _lead_to_dict(lead)
        assert result["sf_lead_url"] == "https://acme.my.salesforce.com/lightning/r/Lead/00Q1x0000000009/view"

    def test_sentinel_sf_lead_id_gets_no_link(self, db):
        from routes.lead_helpers import _lead_to_dict
        db.add(models.SalesforceConnection(is_active=True, instance_url="https://acme.my.salesforce.com", username="test@sf.com", password_encrypted="enc-password", security_token_encrypted="enc-token"))
        lead = models.Lead(sf_lead_id="upload-abc123", first_name="A", last_name="B", phone="+1", status="Calling")
        db.add(lead)
        db.commit()

        result = _lead_to_dict(lead)
        assert result["sf_lead_url"] is None

    def test_opportunity_id_gets_a_link(self, db):
        from routes.lead_helpers import _lead_to_dict
        db.add(models.SalesforceConnection(is_active=True, instance_url="https://acme.my.salesforce.com", username="test@sf.com", password_encrypted="enc-password", security_token_encrypted="enc-token"))
        lead = models.Lead(
            sf_lead_id="aircall_webhook:2026-08-18-abc", sf_opportunity_id="0061x000000WXYZ",
            first_name="A", last_name="B", phone="+1", status="Calling",
        )
        db.add(lead)
        db.commit()

        result = _lead_to_dict(lead)
        assert result["sf_opportunity_id"] == "0061x000000WXYZ"
        assert result["sf_opportunity_url"] == "https://acme.my.salesforce.com/lightning/r/Opportunity/0061x000000WXYZ/view"


# ── backfill_direct_dial_leads — cleanup for pre-v11.4.2 placeholder leads ────

def _placeholder_lead(db, phone="+15550001111", lead_source="aircall_webhook:2026-08-01", sf_lead_id=None):
    lead = models.Lead(
        first_name="", last_name="Unknown", phone=phone,
        status="Calling", lead_source=lead_source,
        sf_lead_id=sf_lead_id or f"{lead_source}-{phone.replace('+', '')}",
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


class TestBackfillDirectDialLeads:

    def test_no_sf_client_returns_zeroed_result(self, db):
        from salesforce import backfill_direct_dial_leads
        _placeholder_lead(db)
        result = backfill_direct_dial_leads(db, None)
        assert result == {"checked": 0, "matched": 0, "skipped_conflict": 0, "remaining": 0, "preview": []}

    def test_lead_match_enriches_in_place(self, db):
        from salesforce import backfill_direct_dial_leads
        lead = _placeholder_lead(db, phone="+15550001111")

        with patch("salesforce.find_lead_or_opportunity_by_phone", return_value={
            "type": "Lead", "id": "00Q1x0000000009",
            "first_name": "Nishita", "last_name": "Real", "company": "Acme Inc", "email": "n@acme.com",
        }):
            result = backfill_direct_dial_leads(db, MagicMock(), limit=10)

        assert result["checked"] == 1
        assert result["matched"] == 1
        assert result["remaining"] == 0
        db.refresh(lead)
        assert lead.sf_lead_id == "00Q1x0000000009"
        assert lead.first_name == "Nishita"
        assert lead.company == "Acme Inc"
        assert lead.lead_source.endswith("+salesforce_match")

    def test_opportunity_match_sets_sf_opportunity_id(self, db):
        from salesforce import backfill_direct_dial_leads
        lead = _placeholder_lead(db, phone="+15550002222")

        with patch("salesforce.find_lead_or_opportunity_by_phone", return_value={
            "type": "Opportunity", "id": "0061x000000WXYZ",
            "first_name": "Jordan", "last_name": "Buyer", "company": "Big Corp", "email": None,
        }):
            result = backfill_direct_dial_leads(db, MagicMock(), limit=10)

        assert result["matched"] == 1
        db.refresh(lead)
        assert lead.sf_opportunity_id == "0061x000000WXYZ"
        assert lead.first_name == "Jordan"

    def test_no_match_leaves_lead_untouched_and_still_remaining(self, db):
        from salesforce import backfill_direct_dial_leads
        lead = _placeholder_lead(db, phone="+15550003333")

        with patch("salesforce.find_lead_or_opportunity_by_phone", return_value=None):
            result = backfill_direct_dial_leads(db, MagicMock(), limit=10)

        assert result["matched"] == 0
        assert result["remaining"] == 1
        db.refresh(lead)
        assert lead.first_name == ""
        assert lead.last_name == "Unknown"

    def test_conflicting_sf_lead_id_is_skipped_not_overwritten(self, db):
        """Another local lead already legitimately holds this exact Salesforce
        Lead Id — must not violate the unique constraint or steal the link."""
        from salesforce import backfill_direct_dial_leads
        existing = models.Lead(
            sf_lead_id="00Q1x0000000009", first_name="Existing", last_name="Owner",
            phone="+15550009999", status="Lead Assigned", lead_source="upload-batch-1",
        )
        db.add(existing)
        placeholder = _placeholder_lead(db, phone="+15550004444")
        db.commit()

        with patch("salesforce.find_lead_or_opportunity_by_phone", return_value={
            "type": "Lead", "id": "00Q1x0000000009",
            "first_name": "Someone", "last_name": "Else", "company": None, "email": None,
        }):
            result = backfill_direct_dial_leads(db, MagicMock(), limit=10)

        assert result["matched"] == 0
        assert result["skipped_conflict"] == 1
        db.refresh(placeholder)
        assert placeholder.first_name == ""  # untouched, not overwritten with a stolen link
        assert placeholder.sf_lead_id != "00Q1x0000000009"

    def test_already_enriched_lead_is_not_a_candidate(self, db):
        """A lead an SDR has since researched/renamed by hand must never be
        re-touched, even if it still carries an old aircall_webhook: source tag."""
        from salesforce import backfill_direct_dial_leads
        lead = models.Lead(
            first_name="Real", last_name="Person", phone="+15550005555",
            status="Calling", lead_source="aircall_webhook:2026-08-01",
            sf_lead_id="aircall_webhook:2026-08-01-abc",
        )
        db.add(lead)
        db.commit()

        with patch("salesforce.find_lead_or_opportunity_by_phone") as mock_lookup:
            result = backfill_direct_dial_leads(db, MagicMock(), limit=10)

        assert result["checked"] == 0
        mock_lookup.assert_not_called()

    def test_upload_sourced_lead_is_not_a_candidate(self, db):
        """Only direct-dial-created placeholders are in scope — never touch
        a normal CSV-uploaded lead, even one still unnamed for other reasons."""
        from salesforce import backfill_direct_dial_leads
        lead = models.Lead(
            first_name="", last_name="Unknown", phone="+15550006666",
            status="Calling", lead_source="upload-batch-1", sf_lead_id="upload-abc123",
        )
        db.add(lead)
        db.commit()

        with patch("salesforce.find_lead_or_opportunity_by_phone") as mock_lookup:
            result = backfill_direct_dial_leads(db, MagicMock(), limit=10)

        assert result["checked"] == 0
        mock_lookup.assert_not_called()

    def test_phone_secondary_fallback(self, db):
        """Primary phone doesn't match anything in Salesforce, but the
        secondary one does — same dual-phone-field philosophy as
        dialer_service._find_lead_by_phone."""
        from salesforce import backfill_direct_dial_leads
        lead = _placeholder_lead(db, phone="+15550007777")
        lead.phone_secondary = "+15550008888"
        db.commit()

        def _lookup(sf, phone):
            return {
                "type": "Lead", "id": "00Q1x0000000099",
                "first_name": "Found", "last_name": "ViaSecondary", "company": None, "email": None,
            } if phone == "+15550008888" else None

        with patch("salesforce.find_lead_or_opportunity_by_phone", side_effect=_lookup):
            result = backfill_direct_dial_leads(db, MagicMock(), limit=10)

        assert result["matched"] == 1
        db.refresh(lead)
        assert lead.first_name == "Found"

    def test_matched_lead_is_idempotent_across_reruns(self, db):
        """Running the backfill twice must never re-process the same lead."""
        from salesforce import backfill_direct_dial_leads
        _placeholder_lead(db, phone="+15550001111")

        with patch("salesforce.find_lead_or_opportunity_by_phone", return_value={
            "type": "Lead", "id": "00Q1x0000000009",
            "first_name": "Nishita", "last_name": "Real", "company": "Acme Inc", "email": "n@acme.com",
        }) as mock_lookup:
            first = backfill_direct_dial_leads(db, MagicMock(), limit=10)
            second = backfill_direct_dial_leads(db, MagicMock(), limit=10)

        assert first["matched"] == 1
        assert second["checked"] == 0
        assert second["matched"] == 0
        assert mock_lookup.call_count == 1

    def test_limit_bounds_the_batch(self, db):
        from salesforce import backfill_direct_dial_leads
        for i in range(5):
            _placeholder_lead(db, phone=f"+1555000{i:04d}")

        with patch("salesforce.find_lead_or_opportunity_by_phone", return_value=None):
            result = backfill_direct_dial_leads(db, MagicMock(), limit=2)

        assert result["checked"] == 2
        assert result["remaining"] == 5  # none matched, so all 5 still remain

    def test_dry_run_matches_but_writes_nothing(self, db):
        from salesforce import backfill_direct_dial_leads
        lead = _placeholder_lead(db, phone="+15550001111")

        with patch("salesforce.find_lead_or_opportunity_by_phone", return_value={
            "type": "Lead", "id": "00Q1x0000000009",
            "first_name": "Nishita", "last_name": "Real", "company": "Acme Inc", "email": "n@acme.com",
        }):
            result = backfill_direct_dial_leads(db, MagicMock(), limit=10, dry_run=True)

        assert result["matched"] == 1
        assert result["remaining"] == 1  # nothing committed, still a candidate
        assert result["preview"] == [{
            "lead_id": lead.id, "phone": "+15550001111", "result": "matched",
            "sf_type": "Lead", "sf_id": "00Q1x0000000009",
            "before": {"first_name": "", "last_name": "Unknown", "company": None},
            "after": {"first_name": "Nishita", "last_name": "Real", "company": "Acme Inc"},
        }]
        db.refresh(lead)
        assert lead.sf_lead_id != "00Q1x0000000009"  # unchanged sentinel, not the real match
        assert lead.first_name == ""


class TestBackfillEndpoint:

    def test_no_sf_configured_returns_500(self, client):
        with patch("routes.admin_sync_routes.get_sf_client", return_value=None):
            resp = client.post("/api/admin/sync/backfill-direct-dial-leads")
        assert resp.status_code == 500

    def test_wired_through_to_the_real_function(self, client, db):
        _placeholder_lead(db, phone="+15550001111")
        with patch("routes.admin_sync_routes.get_sf_client", return_value=MagicMock()), \
             patch("salesforce.find_lead_or_opportunity_by_phone", return_value={
                 "type": "Lead", "id": "00Q1x0000000009",
                 "first_name": "Nishita", "last_name": "Real", "company": "Acme Inc", "email": None,
             }):
            resp = client.post("/api/admin/sync/backfill-direct-dial-leads?limit=10")
        assert resp.status_code == 200
        assert resp.json()["matched"] == 1

    def test_list_matched_endpoint_returns_only_backfilled_leads(self, client, db):
        untouched = _placeholder_lead(db, phone="+15550001111")
        backfilled = models.Lead(
            first_name="Nishita", last_name="Real", phone="+15550002222",
            status="Calling", lead_source="aircall_webhook:2026-08-01+salesforce_match",
            sf_lead_id="00Q1x0000000009",
        )
        db.add(backfilled)
        db.commit()

        resp = client.get("/api/admin/sync/backfill-direct-dial-leads/matched")
        assert resp.status_code == 200
        ids = [row["id"] for row in resp.json()]
        assert backfilled.id in ids
        assert untouched.id not in ids
