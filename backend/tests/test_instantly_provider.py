"""
Unit tests for InstantlyProvider — the pull-only Instantly.ai
campaign/lead-engagement provider (polling-only v1, see docs/RELEASES.md).
"""
import urllib.error
from unittest.mock import patch, MagicMock, call

import pytest

from instantly_provider import (
    InstantlyProvider,
    InstantlyPlanTierError,
    resolve_interest_label,
    build_lead_labels_cache,
    INTEREST_STATUS_LABELS,
)


def _http_error(code, body=b"{}"):
    resp = MagicMock()
    resp.read.return_value = body
    return urllib.error.HTTPError(url="https://api.instantly.ai/x", code=code, msg="err", hdrs=None, fp=resp)


class TestRequestRetryBackoff:
    def test_429_retries_with_exponential_backoff_then_succeeds(self):
        provider = InstantlyProvider(api_key="test-key")
        responses = [_http_error(429), _http_error(429), MagicMock()]

        call_count = {"n": 0}

        def fake_urlopen(req, timeout=30):
            call_count["n"] += 1
            if call_count["n"] < 3:
                raise _http_error(429)
            cm = MagicMock()
            cm.__enter__.return_value.read.return_value = b'{"ok": true}'
            return cm

        with patch("urllib.request.urlopen", side_effect=fake_urlopen), \
             patch("time.sleep") as mock_sleep:
            result = provider._request("GET", "/api/v2/campaigns")

        assert result == {"ok": True}
        assert call_count["n"] == 3
        # 2^(attempt+1) for attempts 0 and 1 → waits of 2s, 4s
        assert mock_sleep.call_args_list[0][0][0] == 2
        assert mock_sleep.call_args_list[1][0][0] == 4

    def test_429_exhausts_retries_and_raises(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch("urllib.request.urlopen", side_effect=_http_error(429)), \
             patch("time.sleep"):
            with pytest.raises(RuntimeError, match="429"):
                provider._request("GET", "/api/v2/campaigns", retries=3)

    def test_402_raises_plan_tier_error_without_retrying(self):
        provider = InstantlyProvider(api_key="test-key")
        call_count = {"n": 0}

        def fake_urlopen(req, timeout=30):
            call_count["n"] += 1
            raise _http_error(402, b'{"message": "no active paid plan"}')

        with patch("urllib.request.urlopen", side_effect=fake_urlopen), \
             patch("time.sleep") as mock_sleep:
            with pytest.raises(InstantlyPlanTierError):
                provider._request("GET", "/api/v2/emails", retries=3)

        assert call_count["n"] == 1, "402 must not be retried"
        mock_sleep.assert_not_called()

    def test_other_4xx_raises_generically_after_retries_exhausted(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch("urllib.request.urlopen", side_effect=_http_error(401)), \
             patch("time.sleep"):
            with pytest.raises(RuntimeError, match="401"):
                provider._request("GET", "/api/v2/campaigns", retries=2)


class TestPagination:
    def test_list_campaigns_follows_starting_after_cursor(self):
        provider = InstantlyProvider(api_key="test-key")
        pages = [
            {"items": [{"id": "c1", "status": 1}], "next_starting_after": "cursor-1"},
            {"items": [{"id": "c2", "status": 3}], "next_starting_after": None},
        ]
        with patch.object(provider, "_request", side_effect=pages) as mock_req:
            campaigns = list(provider.list_campaigns())

        assert [c["id"] for c in campaigns] == ["c1", "c2"]
        assert mock_req.call_count == 2
        # second call should carry the cursor from the first page
        assert mock_req.call_args_list[1].kwargs["params"]["starting_after"] == "cursor-1"

    def test_list_campaigns_filters_out_draft_status_by_default(self):
        provider = InstantlyProvider(api_key="test-key")
        page = {"items": [{"id": "draft", "status": 0}, {"id": "active", "status": 1}], "next_starting_after": None}
        with patch.object(provider, "_request", return_value=page):
            campaigns = list(provider.list_campaigns())
        assert [c["id"] for c in campaigns] == ["active"]

    def test_list_accounts_follows_starting_after_cursor(self):
        """Same cursor shape as list_campaigns — the admin accounts picker
        (routes/dialer_routes.py) needs every mailbox, not just page one."""
        provider = InstantlyProvider(api_key="test-key")
        pages = [
            {"items": [{"email": "a@pool.com", "daily_limit": 50}], "next_starting_after": "cursor-1"},
            {"items": [{"email": "b@pool.com", "daily_limit": 50}], "next_starting_after": None},
        ]
        with patch.object(provider, "_request", side_effect=pages) as mock_req:
            accounts = list(provider.list_accounts())

        assert [a["email"] for a in accounts] == ["a@pool.com", "b@pool.com"]
        assert mock_req.call_count == 2
        assert mock_req.call_args_list[0].args[:2] == ("GET", "/api/v2/accounts")

    def test_list_leads_returns_items_and_next_cursor(self):
        provider = InstantlyProvider(api_key="test-key")
        api_response = {"items": [{"email": "a@test.com"}], "next_starting_after": "cursor-x"}
        with patch.object(provider, "_request", return_value=api_response) as mock_req:
            result = provider.list_leads("campaign-1", starting_after="cursor-0")

        assert result == {"items": [{"email": "a@test.com"}], "next_starting_after": "cursor-x"}
        mock_req.assert_called_once_with(
            "POST", "/api/v2/leads/list",
            json_body={"campaign": "campaign-1", "limit": 100, "starting_after": "cursor-0"},
        )


class TestCreateCampaign:
    def test_translates_steps_into_sequences_shape(self):
        provider = InstantlyProvider(api_key="test-key")
        steps = [
            {"subject": "Hi {{firstName}}", "body": "<p>body 1</p>", "delay_days": 0},
            {"subject": "Follow up", "body": "<p>body 2</p>", "delay_days": 3},
        ]
        with patch.object(provider, "_request", return_value={"id": "camp-1"}) as mock_req:
            result = provider.create_campaign("My Cadence", steps)

        assert result == {"id": "camp-1"}
        create_call = mock_req.call_args_list[0]
        args, kwargs = create_call
        assert args == ("POST", "/api/v2/campaigns")
        body = kwargs["json_body"]
        assert body["name"] == "My Cadence"
        assert body["sequences"] == [{"steps": [
            {"type": "email", "delay": 0, "delay_unit": "days",
             "variants": [{"subject": "Hi {{firstName}}", "body": "<p>body 1</p>"}]},
            {"type": "email", "delay": 3, "delay_unit": "days",
             "variants": [{"subject": "Follow up", "body": "<p>body 2</p>"}]},
        ]}]
        # No explicit schedule passed -> falls back to a default, not omitted
        # (campaign_schedule is required on Instantly's side).
        assert "campaign_schedule" in body
        assert "email_list" not in body

    def test_passes_through_explicit_schedule_and_sending_accounts(self):
        provider = InstantlyProvider(api_key="test-key")
        schedule = {"schedules": [{"name": "W", "timing": {"from": "09:00", "to": "17:00"},
                                    "days": {"1": True}, "timezone": "Asia/Kolkata"}]}
        with patch.object(provider, "_request", return_value={"id": "camp-1"}) as mock_req:
            provider.create_campaign(
                "C", [{"subject": "s", "body": "b", "delay_days": 1}],
                schedule=schedule, sending_accounts=["a@x.com", "b@x.com"],
            )
        body = mock_req.call_args_list[0].kwargs["json_body"]
        assert body["campaign_schedule"] == schedule
        assert body["email_list"] == ["a@x.com", "b@x.com"]

    def test_activates_the_campaign_immediately_after_creating_it(self):
        # RCA 2026-10-05: a created campaign starts in status 0 (draft) and
        # Instantly never sends anything until it's explicitly activated —
        # without this call the whole send-side feature silently never sends.
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "_request", return_value={"id": "camp-1"}) as mock_req:
            provider.create_campaign("C", [{"subject": "s", "body": "b", "delay_days": 0}])

        assert mock_req.call_args_list[1] == call("POST", "/api/v2/campaigns/camp-1/activate")

    def test_does_not_call_activate_when_create_returns_no_campaign_id(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "_request", return_value={"error": "boom"}) as mock_req:
            provider.create_campaign("C", [{"subject": "s", "body": "b", "delay_days": 0}])

        assert mock_req.call_count == 1


class TestUpdateCampaignSequence:
    def test_patches_campaign_with_new_sequence(self):
        provider = InstantlyProvider(api_key="test-key")
        steps = [{"subject": "New subject", "body": "New body", "delay_days": 2}]
        with patch.object(provider, "_request", return_value={"id": "camp-1"}) as mock_req:
            result = provider.update_campaign_sequence("camp-1", steps)

        assert result == {"id": "camp-1"}
        mock_req.assert_called_once_with(
            "PATCH", "/api/v2/campaigns/camp-1",
            json_body={"sequences": [{"steps": [
                {"type": "email", "delay": 2, "delay_unit": "days",
                 "variants": [{"subject": "New subject", "body": "New body"}]},
            ]}]},
        )


class TestAddLeadToCampaign:
    def test_sends_minimal_body_without_optional_names(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "_request", return_value={"id": "lead-1"}) as mock_req:
            result = provider.add_lead_to_campaign("camp-1", "a@test.com")

        assert result == {"id": "lead-1"}
        mock_req.assert_called_once_with(
            "POST", "/api/v2/leads",
            json_body={"campaign": "camp-1", "email": "a@test.com"},
        )

    def test_includes_first_and_last_name_when_given(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "_request", return_value={}) as mock_req:
            provider.add_lead_to_campaign("camp-1", "a@test.com", first_name="A", last_name="B")

        mock_req.assert_called_once_with(
            "POST", "/api/v2/leads",
            json_body={"campaign": "camp-1", "email": "a@test.com", "first_name": "A", "last_name": "B"},
        )


class TestRemoveLeadFromCampaign:
    def test_looks_up_lead_by_email_then_deletes_by_id(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "list_leads",
                           return_value={"items": [{"id": "lead-1", "email": "a@test.com"}],
                                         "next_starting_after": None}), \
             patch.object(provider, "_request", return_value={"id": "lead-1"}) as mock_req:
            result = provider.remove_lead_from_campaign("camp-1", "a@test.com")

        assert result == {"id": "lead-1"}
        mock_req.assert_called_once_with("DELETE", "/api/v2/leads/lead-1")

    def test_noop_when_lead_not_found_in_campaign(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "list_leads",
                           return_value={"items": [], "next_starting_after": None}), \
             patch.object(provider, "_request") as mock_req:
            result = provider.remove_lead_from_campaign("camp-1", "missing@test.com")

        assert result == {}
        mock_req.assert_not_called()


class TestWebhooks:
    def test_create_webhook_single_event_type(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "_request", return_value={"id": "wh-1"}) as mock_req:
            result = provider.create_webhook(
                "https://example.com/webhooks/instantly", "reply_received", "secret-123",
            )

        assert result == {"id": "wh-1"}
        mock_req.assert_called_once_with(
            "POST", "/api/v2/webhooks",
            json_body={
                "target_hook_url": "https://example.com/webhooks/instantly",
                "event_type": "reply_received",
                "headers": {"X-Webhook-Secret": "secret-123"},
            },
        )

    def test_create_webhook_multiple_event_types_registers_one_each(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "_request",
                           side_effect=[{"id": "wh-1"}, {"id": "wh-2"}]) as mock_req:
            result = provider.create_webhook(
                "https://example.com/webhooks/instantly",
                ["reply_received", "lead_unsubscribed"], "secret-123",
            )

        assert result == {"items": [{"id": "wh-1"}, {"id": "wh-2"}]}
        assert mock_req.call_count == 2
        assert mock_req.call_args_list[0].kwargs["json_body"]["event_type"] == "reply_received"
        assert mock_req.call_args_list[1].kwargs["json_body"]["event_type"] == "lead_unsubscribed"

    def test_list_webhooks(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "_request", return_value={"items": []}) as mock_req:
            result = provider.list_webhooks()

        assert result == {"items": []}
        mock_req.assert_called_once_with("GET", "/api/v2/webhooks")

    def test_delete_webhook(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch.object(provider, "_request", return_value={}) as mock_req:
            provider.delete_webhook("wh-1")

        mock_req.assert_called_once_with("DELETE", "/api/v2/webhooks/wh-1")


class TestReadErrorBodyHelper:
    def test_shared_helper_used_by_both_402_and_generic_error_branches(self):
        provider = InstantlyProvider(api_key="test-key")
        with patch("urllib.request.urlopen", side_effect=_http_error(402, b'{"message": "no plan"}')), \
             patch("time.sleep"):
            with pytest.raises(InstantlyPlanTierError, match="no plan"):
                provider._request("GET", "/api/v2/emails")

        with patch("urllib.request.urlopen", side_effect=_http_error(401, b'{"message": "bad auth"}')), \
             patch("time.sleep"):
            with pytest.raises(RuntimeError, match="bad auth"):
                provider._request("GET", "/api/v2/campaigns", retries=1)


class TestResolveInterestLabel:
    def test_known_value_resolves_without_cache(self):
        assert resolve_interest_label(1, {}) == "Interested"
        assert resolve_interest_label(-4, {}) == "No Show"

    def test_custom_label_falls_back_to_cache(self):
        cache = {42: "Referral Partner"}
        assert resolve_interest_label(42, cache) == "Referral Partner"

    def test_unknown_value_with_no_cache_match_returns_none(self):
        assert resolve_interest_label(999, {"42": "Something"}) is None
        assert resolve_interest_label(None, {}) is None

    def test_build_lead_labels_cache_from_items_shape(self):
        raw = {"items": [{"id": "lbl1", "interest_status": 42, "label": "Referral Partner"}]}
        cache = build_lead_labels_cache(raw)
        assert cache == {42: "Referral Partner"}
