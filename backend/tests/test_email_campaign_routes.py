"""Tests for routes/email_campaign_routes.py — Email Campaigns (bulk send).

TestClient runs BackgroundTasks synchronously as part of the request/response
cycle, so patching httpx.post before calling client.post("/api/email-campaigns")
is enough to observe dispatch's outcome by the time the response returns —
no polling/sleeping needed in these tests.
"""
import os
os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

from unittest.mock import patch, MagicMock

from conftest import create_test_user, create_test_lead, create_nylas_config, create_user_mailbox
import models


class _FakeResp:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text

    def json(self):
        return self._json


def _setup_sender(db, user_id="test-user-id"):
    create_nylas_config(db)
    user = create_test_user(db, email="admin@test.com")
    user.id = user_id
    db.commit()
    create_user_mailbox(db, user_id=user_id, email_address="admin@test.com")
    return user


class TestCreateCampaign:

    def test_happy_path_sends_to_all_eligible_leads(self, client, db):
        _setup_sender(db)
        leads = [create_test_lead(db, email=f"lead{i}@test.com") for i in range(3)]

        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1", "thread_id": "thread-1"}})) as mock_post, \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={
                "name": "Q3 outreach",
                "subject": "Hi {{first_name}}",
                "body": "Following up, {{first_name}}.",
                "lead_ids": [l.id for l in leads],
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["requested"] == 3
        assert data["queued"] == 3
        assert data["skipped"] == []
        assert mock_post.call_count == 3

        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == data["campaign_id"]).first()
        assert campaign.status == "completed"
        assert campaign.sent_count == 3
        assert campaign.failed_count == 0

    def test_include_signature_defaults_true_and_is_appended(self, client, db):
        """v12.3: signature toggle defaults on (pre-existing manual-send
        behavior) and is actually threaded through to the sent body."""
        user = _setup_sender(db)
        user.email_signature_html = "<p>Jane Doe</p>"
        db.commit()
        lead = create_test_lead(db, email="lead@test.com")

        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1", "thread_id": "thread-1"}})) as mock_post, \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={
                "subject": "Hi", "body": "Hello", "lead_ids": [lead.id],
            })

        assert resp.status_code == 200
        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == resp.json()["campaign_id"]).first()
        assert campaign.include_signature is True
        assert "Jane Doe" in mock_post.call_args.kwargs["json"]["body"]

    def test_include_signature_false_omits_signature(self, client, db):
        user = _setup_sender(db)
        user.email_signature_html = "<p>Jane Doe</p>"
        db.commit()
        lead = create_test_lead(db, email="lead@test.com")

        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1", "thread_id": "thread-1"}})) as mock_post, \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={
                "subject": "Hi", "body": "Hello", "lead_ids": [lead.id], "include_signature": False,
            })

        assert resp.status_code == 200
        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == resp.json()["campaign_id"]).first()
        assert campaign.include_signature is False
        assert "Jane Doe" not in mock_post.call_args.kwargs["json"]["body"]

    def test_no_lead_ids_rejected(self, client, db):
        _setup_sender(db)
        resp = client.post("/api/email-campaigns", json={"subject": "Hi", "body": "Hello", "lead_ids": []})
        assert resp.status_code == 422

    def test_over_recipient_cap_rejected(self, client, db):
        _setup_sender(db)
        resp = client.post("/api/email-campaigns", json={
            "subject": "Hi", "body": "Hello",
            "lead_ids": [f"fake-{i}" for i in range(201)],
        })
        assert resp.status_code == 400

    def test_no_connected_mailbox_rejected(self, client, db):
        # No create_user_mailbox() call — sender has no connected mailbox.
        create_nylas_config(db)
        user = create_test_user(db, email="admin@test.com")
        user.id = "test-user-id"
        db.commit()
        lead = create_test_lead(db)

        resp = client.post("/api/email-campaigns", json={"subject": "Hi", "body": "Hello", "lead_ids": [lead.id]})
        assert resp.status_code == 400

    def test_dnc_and_no_email_leads_are_skipped_not_sent(self, client, db):
        _setup_sender(db)
        ok_lead = create_test_lead(db, email="ok@test.com")
        dnc_lead = create_test_lead(db, email="dnc@test.com")
        dnc_lead.do_not_contact = True
        db.commit()
        no_email_lead = create_test_lead(db, email=None)

        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})) as mock_post, \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={
                "subject": "Hi", "body": "Hello",
                "lead_ids": [ok_lead.id, dnc_lead.id, no_email_lead.id],
            })

        data = resp.json()
        assert data["requested"] == 3
        assert data["queued"] == 1
        reasons = {s["lead_id"]: s["reason"] for s in data["skipped"]}
        assert reasons[dnc_lead.id] == "skipped_dnc"
        assert reasons[no_email_lead.id] == "skipped_no_email"
        assert mock_post.call_count == 1  # only the eligible lead was actually sent to

        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == data["campaign_id"]).first()
        assert campaign.skipped_count == 2
        assert campaign.total_recipients == 3

    def test_all_recipients_filtered_out_completes_immediately(self, client, db):
        """No crash, no stuck 'running' state when nothing is eligible."""
        _setup_sender(db)
        lead = create_test_lead(db, email=None)

        resp = client.post("/api/email-campaigns", json={"subject": "Hi", "body": "Hello", "lead_ids": [lead.id]})
        assert resp.status_code == 200
        data = resp.json()
        assert data["queued"] == 0

        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == data["campaign_id"]).first()
        assert campaign.status == "completed"
        assert campaign.sent_count == 0

    def test_mailbox_disconnect_mid_campaign_fails_remaining_cleanly(self, client, db):
        """A 401 (grant expired) on one send must stop dispatch and mark every
        remaining pending recipient failed with a clear reason, instead of
        hammering the dead grant once per remaining lead."""
        _setup_sender(db)
        leads = [create_test_lead(db, email=f"lead{i}@test.com") for i in range(3)]

        with patch("httpx.post", return_value=_FakeResp(401, text="grant expired")) as mock_post, \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={
                "subject": "Hi", "body": "Hello",
                "lead_ids": [l.id for l in leads],
            })

        data = resp.json()
        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == data["campaign_id"]).first()
        assert campaign.status == "completed"
        assert campaign.failed_count == 3
        # Only the first send should have actually hit Nylas — the rest are
        # short-circuited as "remaining", not retried against the dead grant.
        assert mock_post.call_count == 1

    def test_template_used_when_no_inline_subject_body(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        tmpl = models.EmailTemplate(name="Intro", subject="Hello {{first_name}}", body="Nice to meet you.",
                                     created_by="test-user-id")
        db.add(tmpl)
        db.commit()

        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})), \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={"template_id": tmpl.id, "lead_ids": [lead.id]})

        assert resp.status_code == 200
        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == resp.json()["campaign_id"]).first()
        assert campaign.subject == "Hello {{first_name}}"

    def test_deleting_template_does_not_corrupt_past_campaign(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        tmpl = models.EmailTemplate(name="Intro", subject="Hello", body="Body text", created_by="test-user-id")
        db.add(tmpl)
        db.commit()
        tmpl_id = tmpl.id

        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})), \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={"template_id": tmpl_id, "lead_ids": [lead.id]})
        campaign_id = resp.json()["campaign_id"]

        client.delete(f"/api/email-templates/{tmpl_id}")

        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == campaign_id).first()
        assert campaign.subject == "Hello"
        assert campaign.body == "Body text"


class TestListAndGetCampaign:

    def test_super_admin_sees_org_wide_with_creator_attribution(self, client, db):
        """A Super Admin asked to see who ran which campaign — list_campaigns
        used to hard-filter to created_by == caller for every role, which
        made this literally impossible. Now Super Admin sees every campaign,
        each carrying created_by_name."""
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})), \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            client.post("/api/email-campaigns", json={"subject": "Hi", "body": "Hello", "lead_ids": [lead.id]})

        other_user = create_test_user(db, email="someone-else@test.com", name="Someone Else", id="someone-else")
        other = models.EmailCampaign(name="Someone else's", subject="x", body="y", created_by=other_user.id, status="completed")
        db.add(other)
        db.commit()

        resp = client.get("/api/email-campaigns")
        campaigns = resp.json()["campaigns"]
        names = [c["name"] for c in campaigns]
        assert "Someone else's" in names
        by_name = next(c for c in campaigns if c["name"] == "Someone else's")
        assert by_name["created_by_name"] == "Someone Else"
        assert by_name["is_mine"] is False

    def test_super_admin_mine_filter_narrows_to_own(self, client, db):
        _setup_sender(db)
        other_user = create_test_user(db, email="someone-else2@test.com", name="Someone Else 2", id="someone-else-2")
        db.add(models.EmailCampaign(name="Mine", subject="x", body="y", created_by="test-user-id", status="completed"))
        db.add(models.EmailCampaign(name="Not mine", subject="x", body="y", created_by=other_user.id, status="completed"))
        db.commit()

        resp = client.get("/api/email-campaigns?mine=true")
        names = [c["name"] for c in resp.json()["campaigns"]]
        assert names == ["Mine"]

    def test_pod_admin_sees_own_pod_only(self, client_as_pod_admin, db):
        in_pod_user = create_test_user(db, email="inpod@test.com", name="In Pod", id="in-pod-user", pod_id="test-pod-id")
        other_pod_user = create_test_user(db, email="otherpod@test.com", name="Other Pod", id="other-pod-user", pod_id="other-pod-id")
        db.add(models.EmailCampaign(name="In pod", subject="x", body="y", created_by=in_pod_user.id, status="completed"))
        db.add(models.EmailCampaign(name="Other pod", subject="x", body="y", created_by=other_pod_user.id, status="completed"))
        db.commit()

        resp = client_as_pod_admin.get("/api/email-campaigns")
        names = [c["name"] for c in resp.json()["campaigns"]]
        assert "In pod" in names
        assert "Other pod" not in names

    def test_sort_by_name_asc_and_desc(self, client, db):
        db.add(models.EmailCampaign(name="Bravo", subject="x", body="y", created_by="test-user-id", status="completed"))
        db.add(models.EmailCampaign(name="Alpha", subject="x", body="y", created_by="test-user-id", status="completed"))
        db.commit()

        asc = [c["name"] for c in client.get("/api/email-campaigns?sort_by=name").json()["campaigns"]]
        desc = [c["name"] for c in client.get("/api/email-campaigns?sort_by=-name").json()["campaigns"]]
        assert asc == ["Alpha", "Bravo"]
        assert desc == ["Bravo", "Alpha"]

    def test_sdr_stays_self_scoped(self, client_as_sdr, db):
        """Non-admin roles keep the original 'sent from your own mailbox'
        model — no expanded visibility was asked for or given to SDR/AE."""
        db.add(models.EmailCampaign(name="Mine", subject="x", body="y", created_by="sdr-user-id", status="completed"))
        db.add(models.EmailCampaign(name="Someone else's", subject="x", body="y", created_by="someone-else", status="completed"))
        db.commit()

        resp = client_as_sdr.get("/api/email-campaigns")
        names = [c["name"] for c in resp.json()["campaigns"]]
        assert names == ["Mine"]

    def test_get_campaign_includes_recipient_statuses(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})), \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={"subject": "Hi", "body": "Hello", "lead_ids": [lead.id]})
        campaign_id = resp.json()["campaign_id"]

        detail = client.get(f"/api/email-campaigns/{campaign_id}").json()
        assert len(detail["recipients"]) == 1
        assert detail["recipients"][0]["status"] == "sent"
        assert detail["recipients"][0]["lead_email"] == "lead@test.com"

    def test_engagement_counts_and_rates_from_lead_email_activity(self, client, db):
        """opened_count/click_count come from LeadEmailActivity.campaign_id —
        the same rows Activity Monitor's Email tab already reads per-message,
        aggregated per campaign here."""
        _setup_sender(db)
        leads = [create_test_lead(db, email=f"engage{i}@test.com") for i in range(4)]
        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})), \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={
                "subject": "Hi", "body": "Hello", "lead_ids": [l.id for l in leads],
            })
        campaign_id = resp.json()["campaign_id"]

        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        # 2 opened (1 of those also clicked), 2 never opened.
        db.add(models.LeadEmailActivity(lead_id=leads[0].id, campaign_id=campaign_id, direction="outbound", opened_at=now, clicked_at=now))
        db.add(models.LeadEmailActivity(lead_id=leads[1].id, campaign_id=campaign_id, direction="outbound", opened_at=now))
        db.add(models.LeadEmailActivity(lead_id=leads[2].id, campaign_id=campaign_id, direction="outbound"))
        db.commit()

        detail = client.get(f"/api/email-campaigns/{campaign_id}").json()
        assert detail["opened_count"] == 2
        assert detail["clicked_count"] == 1
        assert detail["open_rate"] == 50.0    # 2 of 4 sent
        assert detail["click_rate"] == 25.0   # 1 of 4 sent

        by_lead = {r["lead_id"]: r for r in detail["recipients"]}
        assert by_lead[leads[0].id]["opened"] is True and by_lead[leads[0].id]["clicked"] is True
        assert by_lead[leads[1].id]["opened"] is True and by_lead[leads[1].id]["clicked"] is False
        assert by_lead[leads[3].id]["opened"] is False   # never got a LeadEmailActivity row at all

        listed = client.get("/api/email-campaigns").json()["campaigns"]
        assert next(c for c in listed if c["id"] == campaign_id)["open_rate"] == 50.0

    def test_engagement_defaults_to_zero_with_no_open_rate_before_any_activity(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="no-engagement@test.com")
        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})), \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            resp = client.post("/api/email-campaigns", json={"subject": "Hi", "body": "Hello", "lead_ids": [lead.id]})
        campaign_id = resp.json()["campaign_id"]

        detail = client.get(f"/api/email-campaigns/{campaign_id}").json()
        assert detail["opened_count"] == 0
        assert detail["open_rate"] == 0.0   # sent_count > 0, 0 opens — a real rate, not "no data"

    def test_open_rate_is_none_when_nothing_has_sent_yet(self, db):
        """Dividing by a zero sent_count would be nonsensical, not zero —
        distinguishes 'nobody's opened it' from 'nobody could have yet'."""
        from routes.email_campaign_routes import _campaign_to_dict
        campaign = models.EmailCampaign(name="Scheduled", subject="x", body="y", created_by="u1", status="scheduled", sent_count=0)
        result = _campaign_to_dict(campaign, {"opened": 0, "clicked": 0})
        assert result["open_rate"] is None
        assert result["click_rate"] is None

    def test_list_is_paginated(self, client, db):
        _setup_sender(db)
        leads = [create_test_lead(db, email=f"page-lead{i}@test.com") for i in range(3)]
        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})), \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            for lead in leads:
                client.post("/api/email-campaigns", json={"subject": "Hi", "body": "Hello", "lead_ids": [lead.id]})

        page1 = client.get("/api/email-campaigns?page=1&per_page=2").json()
        assert page1["total"] == 3 and page1["pages"] == 2 and len(page1["campaigns"]) == 2
        page2 = client.get("/api/email-campaigns?page=2&per_page=2").json()
        assert len(page2["campaigns"]) == 1
        assert {c["id"] for c in page1["campaigns"]} != {c["id"] for c in page2["campaigns"]}

    def test_list_filters_by_status(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="status-filter@test.com")
        with patch("httpx.post", return_value=_FakeResp(200, {"data": {"id": "msg-1"}})), \
             patch("routes.email_routes.decrypt_token", return_value="fake-api-key"):
            client.post("/api/email-campaigns", json={"subject": "Hi", "body": "Hello", "lead_ids": [lead.id]})

        completed = client.get("/api/email-campaigns?status=completed").json()
        assert completed["total"] == 1
        scheduled = client.get("/api/email-campaigns?status=scheduled").json()
        assert scheduled["total"] == 0


class TestTemplates:

    def test_create_list_delete(self, client, db):
        create_test_user(db, email="admin@test.com").id = "test-user-id"
        db.commit()

        created = client.post("/api/email-templates", json={"name": "Intro", "subject": "Hi", "body": "Hello"}).json()
        listed = client.get("/api/email-templates").json()["templates"]
        assert any(t["id"] == created["id"] for t in listed)

        deleted = client.delete(f"/api/email-templates/{created['id']}")
        assert deleted.status_code == 200
        listed_after = client.get("/api/email-templates").json()["templates"]
        assert not any(t["id"] == created["id"] for t in listed_after)

    def test_update_changes_fields(self, client, db):
        created = client.post("/api/email-templates", json={"name": "Intro", "subject": "Hi", "body": "Hello"}).json()
        updated = client.put(f"/api/email-templates/{created['id']}", json={"name": "Intro v2", "subject": "Hi there", "body": "Hello again"})
        assert updated.status_code == 200
        assert updated.json()["name"] == "Intro v2"
        listed = client.get("/api/email-templates").json()["templates"]
        row = next(t for t in listed if t["id"] == created["id"])
        assert row["name"] == "Intro v2" and row["subject"] == "Hi there"

    def test_list_exposes_ownership_so_the_ui_can_gate_edit(self, client, db):
        """The UI offered an Edit button to everyone and only discovered the
        403 on save, because list_templates never returned created_by."""
        create_test_user(db, email="admin@test.com", name="Test Admin", id="test-user-id")
        db.commit()
        created = client.post("/api/email-templates",
                              json={"name": "Intro", "subject": "Hi", "body": "Hello"}).json()

        row = next(t for t in client.get("/api/email-templates").json()["templates"]
                   if t["id"] == created["id"])
        assert row["created_by"] == "test-user-id"
        assert row["created_by_name"] == "Test Admin"
        assert row["can_edit"] is True

    def test_a_non_owner_sees_can_edit_false_and_is_refused_both_ways(self, client, client_as_pod_admin, db):
        """Edit and Delete must agree — the reported bug was Delete refusing
        while Edit appeared allowed."""
        create_test_user(db, email="admin@test.com", name="Test Admin", id="test-user-id")
        db.commit()
        created = client.post("/api/email-templates",
                              json={"name": "Intro", "subject": "Hi", "body": "Hello"}).json()

        row = next(t for t in client_as_pod_admin.get("/api/email-templates").json()["templates"]
                   if t["id"] == created["id"])
        assert row["can_edit"] is False
        assert row["created_by_name"] == "Test Admin"

        assert client_as_pod_admin.put(f"/api/email-templates/{created['id']}",
                                        json={"name": "X", "subject": "Y", "body": "Z"}).status_code == 403
        assert client_as_pod_admin.delete(f"/api/email-templates/{created['id']}").status_code == 403

    def test_update_missing_template_404s(self, client, db):
        resp = client.put("/api/email-templates/does-not-exist", json={"name": "X", "subject": "Y", "body": ""})
        assert resp.status_code == 404

    def test_update_requires_name(self, client, db):
        created = client.post("/api/email-templates", json={"name": "Intro", "subject": "Hi", "body": "Hello"}).json()
        resp = client.put(f"/api/email-templates/{created['id']}", json={"name": "", "subject": "Hi", "body": "Hello"})
        assert resp.status_code == 422


class TestUnsubscribe:

    def test_valid_token_unsubscribes_lead(self, client, db):
        from auth import create_jwt
        lead = create_test_lead(db, email="lead@test.com")
        token = create_jwt({"purpose": "campaign_unsubscribe", "lead_id": lead.id}, expires_hours=24)

        resp = client.post(f"/api/public/unsubscribe?token={token}")
        assert resp.status_code == 200
        db.refresh(lead)
        assert lead.unsubscribed_at is not None

    def test_second_click_is_a_harmless_noop(self, client, db):
        from auth import create_jwt
        lead = create_test_lead(db, email="lead@test.com")
        token = create_jwt({"purpose": "campaign_unsubscribe", "lead_id": lead.id}, expires_hours=24)

        client.post(f"/api/public/unsubscribe?token={token}")
        first_ts = db.query(models.Lead).filter(models.Lead.id == lead.id).first().unsubscribed_at

        resp = client.post(f"/api/public/unsubscribe?token={token}")
        assert resp.status_code == 200
        second_ts = db.query(models.Lead).filter(models.Lead.id == lead.id).first().unsubscribed_at
        assert first_ts == second_ts

    def test_tampered_token_rejected_cleanly(self, client, db):
        resp = client.get("/api/public/unsubscribe?token=not-a-real-token")
        assert resp.status_code == 400

    def test_wrong_purpose_token_rejected(self, client, db):
        """A JWT signed for something else entirely must not double as an
        unsubscribe token just because it's validly signed."""
        from auth import create_jwt
        lead = create_test_lead(db, email="lead@test.com")
        token = create_jwt({"purpose": "something_else", "lead_id": lead.id}, expires_hours=24)
        resp = client.post(f"/api/public/unsubscribe?token={token}")
        assert resp.status_code == 400


class TestScheduling:
    """POST /email-campaigns' optional `schedule` block — validation, and
    that a scheduled/recurring campaign does NOT dispatch immediately."""

    def test_scheduled_once_stores_fields_and_does_not_dispatch(self, client, db):
        from datetime import datetime, timedelta, timezone
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

        with patch("httpx.post") as mock_post:
            resp = client.post("/api/email-campaigns", json={
                "subject": "Hi", "body": "Hello", "lead_ids": [lead.id],
                "schedule": {"frequency": "scheduled_once", "scheduled_send_at": future},
            })

        assert resp.status_code == 200
        mock_post.assert_not_called()
        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == resp.json()["campaign_id"]).first()
        assert campaign.status == "scheduled"
        assert campaign.frequency == "scheduled_once"
        assert campaign.scheduled_send_at is not None
        # Recipient rows are still built up front, same as an immediate send.
        recipient = db.query(models.EmailCampaignRecipient).filter(models.EmailCampaignRecipient.campaign_id == campaign.id).first()
        assert recipient.status == "pending"

    def test_scheduled_once_in_the_past_rejected(self, client, db):
        from datetime import datetime, timedelta, timezone
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        resp = client.post("/api/email-campaigns", json={
            "subject": "Hi", "body": "Hello", "lead_ids": [lead.id],
            "schedule": {"frequency": "scheduled_once", "scheduled_send_at": past},
        })
        assert resp.status_code == 422

    def test_scheduled_once_missing_datetime_rejected(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        resp = client.post("/api/email-campaigns", json={
            "subject": "Hi", "body": "Hello", "lead_ids": [lead.id],
            "schedule": {"frequency": "scheduled_once"},
        })
        assert resp.status_code == 422

    def test_weekly_requires_weekday(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        resp = client.post("/api/email-campaigns", json={
            "subject": "Hi", "body": "Hello", "lead_ids": [lead.id],
            "schedule": {"frequency": "weekly", "send_hour": 9},
        })
        assert resp.status_code == 422

    def test_monthly_requires_day_of_month(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        resp = client.post("/api/email-campaigns", json={
            "subject": "Hi", "body": "Hello", "lead_ids": [lead.id],
            "schedule": {"frequency": "monthly", "send_hour": 9},
        })
        assert resp.status_code == 422

    def test_daily_recurring_stores_send_time_and_stays_scheduled(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        with patch("httpx.post") as mock_post:
            resp = client.post("/api/email-campaigns", json={
                "subject": "Hi", "body": "Hello", "lead_ids": [lead.id],
                "schedule": {"frequency": "daily", "send_hour": 9, "send_minute": 30, "timezone": "Asia/Kolkata"},
            })
        assert resp.status_code == 200
        mock_post.assert_not_called()
        campaign = db.query(models.EmailCampaign).filter(models.EmailCampaign.id == resp.json()["campaign_id"]).first()
        assert campaign.status == "scheduled"
        assert campaign.frequency == "daily"
        assert campaign.send_hour == 9 and campaign.send_minute == 30
        assert campaign.timezone == "Asia/Kolkata"

    def test_invalid_frequency_rejected(self, client, db):
        _setup_sender(db)
        lead = create_test_lead(db, email="lead@test.com")
        resp = client.post("/api/email-campaigns", json={
            "subject": "Hi", "body": "Hello", "lead_ids": [lead.id],
            "schedule": {"frequency": "hourly", "send_hour": 9},
        })
        assert resp.status_code == 422


class TestRenameCampaign:
    """PATCH /api/email-campaigns/{id} — name only, mirrors update_template's
    creator-or-Super-Admin gate. Added so old auto-named campaigns (name
    fell back to subject[:80] before the compose form required a real name)
    can be fixed by hand."""

    def test_creator_can_rename_own_campaign(self, client_as_sdr, db):
        db.add(models.EmailCampaign(name="Old name", subject="x", body="y", created_by="sdr-user-id", status="completed", id="camp-1"))
        db.commit()

        resp = client_as_sdr.patch("/api/email-campaigns/camp-1", json={"name": "Better name"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Better name"
        assert db.query(models.EmailCampaign).filter(models.EmailCampaign.id == "camp-1").first().name == "Better name"

    def test_super_admin_can_rename_anyones_campaign(self, client, db):
        other_user = create_test_user(db, email="someone-else3@test.com", id="someone-else-3")
        db.add(models.EmailCampaign(name="Old name", subject="x", body="y", created_by=other_user.id, status="completed", id="camp-2"))
        db.commit()

        resp = client.patch("/api/email-campaigns/camp-2", json={"name": "Renamed by admin"})
        assert resp.status_code == 200
        assert db.query(models.EmailCampaign).filter(models.EmailCampaign.id == "camp-2").first().name == "Renamed by admin"

    def test_non_creator_non_admin_cannot_rename(self, client_as_sdr, db):
        other_user = create_test_user(db, email="someone-else4@test.com", id="someone-else-4")
        db.add(models.EmailCampaign(name="Not mine", subject="x", body="y", created_by=other_user.id, status="completed", id="camp-3"))
        db.commit()

        resp = client_as_sdr.patch("/api/email-campaigns/camp-3", json={"name": "Nope"})
        assert resp.status_code == 403
        assert db.query(models.EmailCampaign).filter(models.EmailCampaign.id == "camp-3").first().name == "Not mine"

    def test_empty_name_rejected(self, client, db):
        db.add(models.EmailCampaign(name="Old name", subject="x", body="y", created_by="test-user-id", status="completed", id="camp-4"))
        db.commit()

        resp = client.patch("/api/email-campaigns/camp-4", json={"name": "   "})
        assert resp.status_code == 422
        assert db.query(models.EmailCampaign).filter(models.EmailCampaign.id == "camp-4").first().name == "Old name"

    def test_rename_nonexistent_campaign_404(self, client, db):
        resp = client.patch("/api/email-campaigns/does-not-exist", json={"name": "Anything"})
        assert resp.status_code == 404
