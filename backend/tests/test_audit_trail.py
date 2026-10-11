"""The permanent audit trail: exports, changes to who may export, Salesforce mapping edits (models.AuditEvent)."""
from unittest.mock import MagicMock, patch

import pytest

import models
from tests.conftest import create_test_lead, create_test_user, grant_export


def _events(db, category=None):
    q = db.query(models.AuditEvent).order_by(models.AuditEvent.created_at, models.AuditEvent.id)
    return [e for e in q if category is None or e.category == category]


def _sf(extra=None):
    sf = MagicMock()
    sf.Lead.describe.return_value = {"fields": [{"name": n, "type": "string", "createable": True, "updateable": True}
                                                 for n in ["Title", "Budget__c", "Job_Title__c", "Website", "Industry", "Notes__c"] + (extra or [])]}
    return sf


# ── exports ─────────────────────────────────────────────────────────────────────────────────────────────────────
def test_an_allowed_download_is_recorded_with_who_what_and_when(client, db):
    create_test_user(db, email="admin@test.com", id="test-user-id", role="Super Admin")
    assert client.get("/api/my-day/export").status_code == 200
    (e,) = _events(db, "export")
    assert (e.actor_id, e.actor_email, e.actor_role, e.action, e.summary) == ("test-user-id", "admin@test.com", "Super Admin", "DOWNLOAD", "My Day CSV")
    assert e.created_at is not None


def test_a_refused_download_leaves_no_export_record(client_as_pod_admin, db):
    assert client_as_pod_admin.get("/api/my-day/export").status_code == 403
    assert _events(db, "export") == []


def test_a_bulk_list_read_is_recorded_with_its_size(client_as_pod_admin, db):
    create_test_user(db, email="pa@t.com", id="pod-admin-id", role="Pod Admin")
    grant_export(db, "pod-admin-id", role="Pod Admin")
    client_as_pod_admin.get("/api/admin/email-logs?per_page=500")
    ev = _events(db, "export")
    assert ev and ev[-1].action == "BULK_READ" and "per_page=500" in ev[-1].detail_json


def test_no_record_no_download(client, db):
    create_test_user(db, email="admin@test.com", id="test-user-id", role="Super Admin")
    with patch("services.audit.record_now", side_effect=RuntimeError("db down")):
        r = client.get("/api/my-day/export")
    assert r.status_code == 503 and "could not be recorded" in r.json()["detail"]


def test_a_csv_built_in_the_browser_is_recorded_and_refused_without_access(client, client_as_pod_admin, db):
    create_test_user(db, email="admin@test.com", id="test-user-id", role="Super Admin")
    assert client_as_pod_admin.post("/api/me/export-event", json={"what": "email-log", "rows": 5}).status_code == 403
    assert _events(db, "export") == []
    assert client.post("/api/me/export-event", json={"what": "email-log", "rows": 1200}).status_code == 200
    (e,) = _events(db, "export")
    assert e.action == "BROWSER_CSV" and "email-log" in e.summary and '"rows": 1200' in e.detail_json


# ── who may export ──────────────────────────────────────────────────────────────────────────────────────────────
def test_changing_export_access_is_recorded_once_per_real_change(client, db):
    create_test_user(db, email="admin@test.com", id="test-user-id", role="Super Admin")
    create_test_user(db, email="rep@t.com", id="rep-1", name="Rita Rep", role="SDR")
    client.patch("/api/admin/users/rep-1/settings", json={"export_enabled": True})
    client.patch("/api/admin/users/rep-1/settings", json={"export_enabled": True})        # no change: not an event
    client.patch("/api/admin/users/rep-1/settings", json={"export_enabled": False})
    ev = _events(db, "export_access")
    assert [e.action for e in ev] == ["ALLOWED", "BLOCKED"]
    assert ev[0].summary == "Allowed data export for Rita Rep (rep@t.com)" and ev[1].summary == "Switched off data export for Rita Rep (rep@t.com)"
    assert '"target_email": "rep@t.com"' in ev[0].detail_json and ev[0].actor_email == "admin@test.com"


# ── the viewer ──────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_log_is_super_admin_only(client_as_pod_admin, client_as_sdr):
    assert client_as_pod_admin.get("/api/admin/audit-log").status_code == 403
    assert client_as_sdr.get("/api/admin/audit-log").status_code == 403


def test_the_log_filters_searches_pages_and_lists_newest_first(client, db):
    create_test_user(db, email="admin@test.com", id="test-user-id", role="Super Admin")
    for i in range(7):
        client.get("/api/my-day/export")
    create_test_user(db, email="rep@t.com", id="rep-1", name="Rita Rep", role="SDR")
    client.patch("/api/admin/users/rep-1/settings", json={"export_enabled": True})
    everything = client.get("/api/admin/audit-log?per_page=5").json()
    assert everything["total"] == 8 and everything["pages"] == 2 and len(everything["items"]) == 5
    assert everything["items"][0]["category"] == "export_access"                          # newest first
    assert client.get("/api/admin/audit-log?category=export").json()["total"] == 7
    assert client.get("/api/admin/audit-log?q=rita").json()["total"] == 1
    assert client.get("/api/admin/audit-log?q=rep@t.com").json()["total"] == 1          # the person it was done to can be found by email
    assert client.get("/api/admin/audit-log?q=nobody").json()["total"] == 0
    assert client.get("/api/admin/audit-log?date_from=2999-01-01").json()["total"] == 0
    assert client.get("/api/admin/audit-log?date_to=2000-01-01").json()["total"] == 0
    assert client.get("/api/admin/audit-log?date_from=2000-01-01&date_to=2999-01-01").json()["total"] == 8
    assert client.get("/api/admin/audit-log?category=bogus").status_code == 400
    assert client.get("/api/admin/audit-log?date_from=yesterday").status_code == 400


def test_a_record_outlives_the_user_who_made_it(client, db):
    create_test_user(db, email="gone@t.com", id="gone-1", name="Gone Person", role="Super Admin")
    models_event = models.AuditEvent(actor_id="gone-1", actor_email="gone@t.com", actor_name="Gone Person", actor_role="Super Admin",
                                     category="export", action="DOWNLOAD", summary="Leads export")
    db.add(models_event)
    db.commit()
    db.query(models.User).filter(models.User.id == "gone-1").delete()
    db.commit()
    items = client.get("/api/admin/audit-log").json()["items"]
    assert items and items[0]["actor_name"] == "Gone Person"


# ── Salesforce mapping edits ────────────────────────────────────────────────────────────────────────────────────
def test_adding_changing_and_removing_a_mapping_each_leave_a_dated_record(client, db):
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        m = client.post("/api/admin/sf-field-mappings", json={"lead_field": "total_funding", "sf_field": "Budget__c"}).json()
        client.patch(f"/api/admin/sf-field-mappings/{m['id']}", json={"enabled": False})
        client.patch(f"/api/admin/sf-field-mappings/{m['id']}", json={"enabled": False})         # no change
    client.delete(f"/api/admin/sf-field-mappings/{m['id']}")
    ev = _events(db, "sf_mapping")
    assert [e.action for e in ev] == ["ADDED", "CHANGED", "REMOVED"]
    assert "Total funding" in ev[0].summary and "Budget__c" in ev[0].summary and ev[0].actor_email == "admin@test.com"
    assert "switched off" in ev[1].summary
    assert '"sf_object": "Lead"' in ev[2].detail_json
    assert client.get("/api/admin/sf-field-mappings").json()["custom"] == []


def test_the_mapping_list_says_who_added_it_and_when(client, db):
    create_test_user(db, email="admin@test.com", id="test-user-id", name="Test Admin", role="Super Admin")
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        client.post("/api/admin/sf-field-mappings", json={"lead_field": "total_funding", "sf_field": "Budget__c"})
    row = client.get("/api/admin/sf-field-mappings").json()["custom"][0]
    assert row["created_by"] == "Test Admin" and row["created_at"]


# ── built-in mappings: everything but the five locked ones is editable ───────────────────────────────────────────
def test_the_built_in_list_says_which_are_locked(client):
    rows = {b["lead_field"]: b for b in client.get("/api/admin/sf-field-mappings").json()["builtin"]}
    assert {k for k, b in rows.items() if b["locked"]} == {"first_name", "last_name", "email", "phone", "status"}
    assert rows["title"]["sf_field"] == rows["title"]["default_sf_field"] == "Job_Title__c" and rows["title"]["overridden"] is False


@pytest.mark.parametrize("key", ["first_name", "last_name", "email", "phone", "status"])
def test_locked_built_ins_cannot_be_changed_or_switched_off(client, key):
    assert client.patch(f"/api/admin/sf-field-mappings/builtin/{key}", json={"enabled": False}).status_code == 400
    assert client.patch(f"/api/admin/sf-field-mappings/builtin/{key}", json={"sf_field": "Other__c"}).status_code == 400


def test_a_built_in_can_point_at_another_field_and_the_push_follows(client, db):
    lead = create_test_lead(db, sf_lead_id="00Q" + "A" * 15)
    lead.title = "CTO"
    lead.website = "x.com"
    db.commit()
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        r = client.patch("/api/admin/sf-field-mappings/builtin/title", json={"sf_field": "title"})
    assert r.status_code == 200 and r.json()["sf_field"] == "Title" and r.json()["overridden"] is True
    from salesforce import lead_push_info, push_lead_to_salesforce
    sf = MagicMock()
    with patch("salesforce.log_sf_operation"):
        push_lead_to_salesforce(sf, lead.sf_lead_id, {"title": "CTO", "website": "x.com"}, lead_info=lead_push_info(lead, db))
    sent = sf.Lead.update.call_args[0][1]
    assert sent == {"Title": "CTO", "Website": "x.com"}
    ev = _events(db, "sf_mapping")
    assert ev[-1].action == "CHANGED" and "Job_Title__c" in ev[-1].summary and "built-in" in ev[-1].summary


def test_a_switched_off_built_in_is_not_sent_on_update_or_create(client, db):
    lead = create_test_lead(db, sf_lead_id="00Q" + "B" * 15)
    lead.industry = "Health"
    lead.website = "x.com"
    lead.employee_count = 40
    db.commit()
    for key in ("industry", "employee_count"):
        assert client.patch(f"/api/admin/sf-field-mappings/builtin/{key}", json={"enabled": False}).json()["enabled"] is False
    from salesforce import create_new_lead_in_salesforce, lead_push_info, push_lead_to_salesforce
    sf = MagicMock()
    sf.Lead.create.return_value = {"id": "00Q" + "Z" * 15}
    with patch("salesforce.log_sf_operation"):
        push_lead_to_salesforce(sf, lead.sf_lead_id, {"industry": "Health", "website": "x.com", "employee_count": 40}, lead_info=lead_push_info(lead, db))
        create_new_lead_in_salesforce(sf, lead_push_info(lead, db))
    assert sf.Lead.update.call_args[0][1] == {"Website": "x.com"}
    created = sf.Lead.create.call_args[0][0]
    assert "Industry" not in created and "NumberOfEmployees" not in created and created["Website"] == "x.com"


def test_reset_puts_a_built_in_back_and_clears_the_override(client, db):
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        client.patch("/api/admin/sf-field-mappings/builtin/title", json={"sf_field": "Title"})
    r = client.delete("/api/admin/sf-field-mappings/builtin/title")
    assert r.status_code == 200 and r.json()["overridden"] is False and r.json()["sf_field"] == "Job_Title__c"
    assert db.query(models.SfFieldMapping).filter_by(builtin=True).count() == 0
    client.patch("/api/admin/sf-field-mappings/builtin/industry", json={"enabled": False})
    assert client.patch("/api/admin/sf-field-mappings/builtin/industry", json={"enabled": True}).json()["overridden"] is False


def test_built_in_targets_are_checked(client, db):
    with patch("routes.admin_sync_routes.get_sf_client", return_value=_sf()):
        assert client.patch("/api/admin/sf-field-mappings/builtin/title", json={"sf_field": "OwnerId"}).status_code == 400
        assert client.patch("/api/admin/sf-field-mappings/builtin/title", json={"sf_field": "Email"}).status_code == 400       # written by a locked field
        taken = client.patch("/api/admin/sf-field-mappings/builtin/title", json={"sf_field": "Website"})                        # another built-in's field
        assert taken.status_code == 400 and "already filled" in taken.json()["detail"]
        assert client.patch("/api/admin/sf-field-mappings/builtin/title", json={"sf_field": "Nope__c"}).status_code == 400      # not in Salesforce
        assert client.patch("/api/admin/sf-field-mappings/builtin/nonsense", json={"enabled": False}).status_code == 404
    assert db.query(models.SfFieldMapping).filter_by(builtin=True).count() == 0                                                 # refused edits change nothing


def test_built_in_overrides_do_not_leak_into_the_custom_list_or_payload(client, db):
    lead = create_test_lead(db)
    lead.title = "CTO"
    db.commit()
    client.patch("/api/admin/sf-field-mappings/builtin/industry", json={"enabled": False})
    assert client.get("/api/admin/sf-field-mappings").json()["custom"] == []
    from salesforce import lead_push_info
    info = lead_push_info(lead, db)
    assert info["custom_sf_fields"] == {} and info["builtin_overrides"] == {"industry": None}


def test_only_a_super_admin_may_edit_built_ins(client_as_sdr, client_as_pod_admin):
    for c in (client_as_sdr, client_as_pod_admin):
        assert c.patch("/api/admin/sf-field-mappings/builtin/title", json={"enabled": False}).status_code == 403
        assert c.delete("/api/admin/sf-field-mappings/builtin/title").status_code == 403
