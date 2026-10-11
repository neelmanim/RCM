"""Configurable Salesforce field mapping (v14.1.0): validation, what gets sent on update/create, the safety nets, and who may edit."""
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

import models
from salesforce import create_new_lead_in_salesforce, lead_push_info, push_lead_to_salesforce
from services import sf_field_mapping as sfm
from tests.conftest import create_test_lead


def _sf(fields=None):
    sf = MagicMock()
    sf.Lead.describe.return_value = {"fields": fields if fields is not None else [
        {"name": "Budget__c", "type": "currency", "createable": True, "updateable": True},
        {"name": "Notes__c", "type": "string", "createable": True, "updateable": True},
        {"name": "Score__c", "type": "double", "createable": False, "updateable": False},
    ]}
    sf.Lead.create.return_value = {"id": "00Q" + "Z" * 15}
    return sf


def _map(db, lead_field, sf_field, sf_type=None, enabled=True):
    m = models.SfFieldMapping(lead_field=lead_field, sf_field=sf_field, sf_type=sf_type, enabled=enabled)
    db.add(m)
    db.commit()
    return m


# ── validation ──────────────────────────────────────────────────────────────────────────────────────────────────
def test_valid_mapping_is_checked_against_salesforce_and_takes_its_spelling(db):
    assert sfm.check_new(db, "total_funding", "budget__c", _sf()) == ("Budget__c", "currency", True)


@pytest.mark.parametrize("lead_field,sf_field,fragment", [
    ("nope", "Budget__c", "can't be mapped"),
    ("total_funding", "Budget c;", "API name"),
    ("total_funding", "Email", "already managed"),
    ("total_funding", "OwnerId", "already managed"),
    ("total_funding", "Country", 'built-in "Country" mapping'),
    ("total_funding", "Missing__c", "Lead object has no field"),
    ("total_funding", "Score__c", "read-only"),
])
def test_bad_mappings_are_refused_with_a_plain_message(db, lead_field, sf_field, fragment):
    with pytest.raises(sfm.MappingError, match=fragment):
        sfm.check_new(db, lead_field, sf_field, _sf())


def test_duplicates_are_refused_either_way_round(db):
    _map(db, "total_funding", "Budget__c")
    with pytest.raises(sfm.MappingError, match="already mapped"):
        sfm.check_new(db, "total_funding", "Other__c", _sf())
    with pytest.raises(sfm.MappingError, match="another Alternate CRM field"):
        sfm.check_new(db, "vertical", "budget__c", _sf())


def test_without_a_salesforce_connection_the_row_saves_unverified(db):
    assert sfm.check_new(db, "vertical", "Vertical__c", None) == ("Vertical__c", None, False)


def test_salesforce_unreachable_refuses_instead_of_saving_unchecked(db):
    sf = MagicMock()
    sf.Lead.describe.side_effect = RuntimeError("timeout")
    with pytest.raises(sfm.MappingError, match="Couldn't read"):
        sfm.check_new(db, "vertical", "Vertical__c", sf)


# ── what is sent ────────────────────────────────────────────────────────────────────────────────────────────────
def test_custom_payload_coerces_by_salesforce_type_and_skips_empty_and_disabled(db):
    lead = create_test_lead(db)
    lead.total_funding, lead.vertical, lead.times_called, lead.research_heat = "$1,500", "Health", 3, None
    lead.meeting_scheduled_at = datetime(2026, 2, 10, 9, 30)
    db.commit()
    _map(db, "total_funding", "Budget__c", "currency")
    _map(db, "vertical", "Vertical__c", "string")
    _map(db, "times_called", "Calls__c", "int")
    _map(db, "research_heat", "Heat__c", "string")                      # empty on the lead: not sent
    _map(db, "meeting_scheduled_at", "Meet__c", "date")
    _map(db, "no_show_count", "NoShow__c", "double", enabled=False)       # switched off: not sent
    assert sfm.custom_payload(db, lead) == {"Budget__c": 1500.0, "Vertical__c": "Health", "Calls__c": 3, "Meet__c": "2026-02-10"}


def test_campaign_is_the_first_tag_alphabetically(db):
    lead = create_test_lead(db)
    for name in ("Zeta", "Alpha"):
        lead.tags.append(models.Tag(name=name))
    db.commit()
    _map(db, "campaign", "Campaign__c", "string")
    assert sfm.custom_payload(db, lead) == {"Campaign__c": "Alpha"}


def test_update_sends_the_extra_fields_with_the_normal_ones(db):
    lead = create_test_lead(db, sf_lead_id="00Q" + "A" * 15)
    lead.vertical = "Health"
    db.commit()
    _map(db, "vertical", "Vertical__c", "string")
    sf = _sf()
    with patch("salesforce.log_sf_operation"):
        assert push_lead_to_salesforce(sf, lead.sf_lead_id, {"status": "Calling"}, lead_info=lead_push_info(lead, db))
    sent = sf.Lead.update.call_args[0][1]
    assert sent["Vertical__c"] == "Health" and "Lead_Status__c" in sent


def test_create_sends_the_extra_fields(db):
    lead = create_test_lead(db)
    lead.vertical = "Health"
    lead.no_show_count = 0                      # a real zero is still sent
    db.commit()
    _map(db, "vertical", "Vertical__c", "string")
    _map(db, "no_show_count", "NoShow__c", "double")
    sf = _sf()
    with patch("salesforce.log_sf_operation"):
        create_new_lead_in_salesforce(sf, lead_push_info(lead, db))
    sent = sf.Lead.create.call_args[0][0]
    assert sent["Vertical__c"] == "Health" and sent["NoShow__c"] == 0.0


def test_no_mappings_means_nothing_extra_is_sent(db):
    lead = create_test_lead(db, sf_lead_id="00Q" + "B" * 15)
    assert lead_push_info(lead, db)["custom_sf_fields"] == {}


def test_a_picklist_that_rejects_a_mapped_value_drops_only_that_field(db):
    lead = create_test_lead(db, sf_lead_id="00Q" + "C" * 15)
    lead.vertical = "Nope"
    db.commit()
    _map(db, "vertical", "Vertical__c", "string")
    err = Exception("INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST Vertical__c")
    err.content = [{"errorCode": "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST", "fields": ["Vertical__c"]}]
    sf = _sf()
    sf.Lead.update.side_effect = [err, None]
    with patch("salesforce.log_sf_operation"):
        assert push_lead_to_salesforce(sf, lead.sf_lead_id, {"status": "Calling"}, lead_info=lead_push_info(lead, db))
    assert "Vertical__c" not in sf.Lead.update.call_args_list[1][0][1]
    assert "Lead_Status__c" in sf.Lead.update.call_args_list[1][0][1]


@pytest.mark.parametrize("code,fields,msg", [
    ("INVALID_FIELD", [], "No such column 'Vertical__c' on sobject of type Lead"),      # deleted/renamed in Salesforce
    ("STRING_TOO_LONG", ["Vertical__c"], "Vertical: data value too large"),
    ("INVALID_TYPE_ON_FIELD_IN_RECORD", ["Vertical__c"], "value not of required type"),
])
def test_a_mapped_field_salesforce_refuses_is_dropped_and_the_rest_still_saves(db, code, fields, msg):
    lead = create_test_lead(db, sf_lead_id="00Q" + "D" * 15)
    lead.vertical = "Health"
    db.commit()
    _map(db, "vertical", "Vertical__c", "string")
    err = Exception(f"{code}: {msg}")
    err.content = [{"errorCode": code, "message": msg, "fields": fields}]
    sf = _sf()
    sf.Lead.update.side_effect = [err, None]
    with patch("salesforce.log_sf_operation"):
        assert push_lead_to_salesforce(sf, lead.sf_lead_id, {"status": "Calling"}, lead_info=lead_push_info(lead, db))
    assert sf.Lead.update.call_count == 2 and "Vertical__c" not in sf.Lead.update.call_args[0][1]


def test_an_error_about_a_different_field_is_not_swallowed(db):
    lead = create_test_lead(db, sf_lead_id="00Q" + "E" * 15)
    _map(db, "vertical", "Vertical__c", "string")
    lead.vertical = "Health"
    db.commit()
    err = Exception("REQUIRED_FIELD_MISSING: Company")
    err.content = [{"errorCode": "REQUIRED_FIELD_MISSING", "message": "Company", "fields": ["Company"]}]
    sf = _sf()
    sf.Lead.update.side_effect = err
    with patch("salesforce.log_sf_operation"):
        assert push_lead_to_salesforce(sf, lead.sf_lead_id, {"status": "Calling"}, lead_info=lead_push_info(lead, db)) is False
    assert sf.Lead.update.call_count == 1


def test_a_duplicate_add_that_races_past_the_check_is_a_400(client, db):
    with patch("routes.admin_sync_routes.get_sf_client", return_value=None), \
         patch("routes.admin_sync_routes.sf_field_mapping.check_new", return_value=("Vertical__c", None, False)):
        assert client.post("/api/admin/sf-field-mappings", json={"lead_field": "vertical", "sf_field": "Vertical__c"}).status_code == 200
        r = client.post("/api/admin/sf-field-mappings", json={"lead_field": "vertical", "sf_field": "Vertical__c"})
    assert r.status_code == 400 and "already mapped" in r.json()["detail"]


# ── the admin endpoints ─────────────────────────────────────────────────────────────────────────────────────────
def test_crud_round_trip(client, db):
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        r = client.post("/api/admin/sf-field-mappings", json={"lead_field": "total_funding", "sf_field": "budget__c"})
    assert r.status_code == 200 and r.json()["sf_field"] == "Budget__c" and r.json()["verified"] is True
    listing = client.get("/api/admin/sf-field-mappings").json()
    assert [m["sf_field"] for m in listing["custom"]] == ["Budget__c"]
    assert "total_funding" not in [a["value"] for a in listing["available"]]
    assert any(b["sf_field"] == "Email" for b in listing["builtin"])
    mid = r.json()["id"]
    assert client.patch(f"/api/admin/sf-field-mappings/{mid}", json={"enabled": False}).json()["enabled"] is False
    assert client.delete(f"/api/admin/sf-field-mappings/{mid}").status_code == 200
    assert client.delete(f"/api/admin/sf-field-mappings/{mid}").status_code == 404


def test_endpoint_reports_a_bad_mapping_as_400(client):
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        r = client.post("/api/admin/sf-field-mappings", json={"lead_field": "total_funding", "sf_field": "Email"})
    assert r.status_code == 400 and "already managed" in r.json()["detail"]


def test_only_a_super_admin_may_touch_mappings(client_as_sdr, client_as_pod_admin):
    for c in (client_as_sdr, client_as_pod_admin):
        assert c.get("/api/admin/sf-field-mappings").status_code == 403
        assert c.post("/api/admin/sf-field-mappings", json={"lead_field": "vertical", "sf_field": "V__c"}).status_code == 403
        assert c.delete("/api/admin/sf-field-mappings/x").status_code == 403


# ── editing a mapping, and the sync overview ────────────────────────────────────────────────────────────────────
def test_edit_changes_the_salesforce_field_and_rechecks_it(client, db):
    m = _map(db, "total_funding", "Budget__c", "currency")
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        r = client.patch(f"/api/admin/sf-field-mappings/{m.id}", json={"sf_field": "notes__c"})
    assert r.status_code == 200 and r.json()["sf_field"] == "Notes__c" and r.json()["sf_type"] == "string" and r.json()["verified"] is True
    assert r.json()["sf_object"] == "Lead"


def test_edit_may_keep_its_own_values_but_not_take_another_rows(client, db):
    a = _map(db, "total_funding", "Budget__c", "currency")
    _map(db, "vertical", "Vertical__c", "string")
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        assert client.patch(f"/api/admin/sf-field-mappings/{a.id}", json={"lead_field": "total_funding", "sf_field": "Budget__c"}).status_code == 200
        r = client.patch(f"/api/admin/sf-field-mappings/{a.id}", json={"lead_field": "vertical"})
    assert r.status_code == 400 and "already mapped" in r.json()["detail"]


def test_a_refused_edit_changes_nothing(client, db):
    m = _map(db, "total_funding", "Budget__c", "currency")
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        r = client.patch(f"/api/admin/sf-field-mappings/{m.id}", json={"sf_field": "Missing__c"})
    assert r.status_code == 400 and "Lead object has no field with the API name Missing__c" in r.json()["detail"]
    db.refresh(m)
    assert m.sf_field == "Budget__c"


def test_toggle_still_works_with_only_enabled(client, db):
    m = _map(db, "vertical", "Vertical__c", "string")
    assert client.patch(f"/api/admin/sf-field-mappings/{m.id}", json={"enabled": False}).json()["enabled"] is False


def test_errors_name_the_object(db):
    with pytest.raises(sfm.MappingError, match="Email on the Lead object is already managed"):
        sfm.check_new(db, "vertical", "Email", _sf())


def test_sync_overview_counts_only_live_real_leads(client, db):
    create_test_lead(db, email="a@t.com", sf_lead_id="00Q" + "1" * 15, status="Calling")              # in Salesforce
    create_test_lead(db, email="b@t.com", sf_lead_id="upload-123", status="Meeting Scheduled")         # placeholder id, waiting
    create_test_lead(db, email="c@t.com", sf_lead_id="MIG-9", status="Calling")                        # placeholder id
    create_test_lead(db, email="d@t.com", sf_lead_id="00Q" + "2" * 15, status="Meeting Scheduled")    # in SF, at stage
    gone = create_test_lead(db, email="e@t.com", sf_lead_id=None)
    gone.deleted_at = datetime(2026, 1, 1)
    fake = create_test_lead(db, email="f@t.com", sf_lead_id=None, status="Meeting Scheduled")
    fake.is_test = True
    db.commit()
    o = client.get("/api/admin/sf-sync-overview").json()
    assert o["total"] == 4 and o["in_salesforce"] == 2 and o["only_in_alternatecrm"] == 2
    assert o["push_stage"] and o["waiting_at_push_stage"] == (1 if o["push_stage"] == "Meeting Scheduled" else 0)


def test_sync_overview_is_super_admin_only(client_as_sdr, client_as_pod_admin):
    for c in (client_as_sdr, client_as_pod_admin):
        assert c.get("/api/admin/sf-sync-overview").status_code == 403


def test_the_built_in_mapping_shown_in_settings_is_the_one_the_push_uses(client):
    import salesforce
    built = client.get("/api/admin/sf-field-mappings").json()["builtin"]
    assert {(b["lead_field"], b["sf_field"]) for b in built} == set(salesforce.LEAD_FIELD_MAP.items())
