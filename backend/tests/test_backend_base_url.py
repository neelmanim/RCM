"""config.backend_base_url() — the app's own public origin.

Resolves BACKEND_URL or RAILWAY_PUBLIC_DOMAIN for webhooks, signature logos,
and campaign links.
"""
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config


class TestBackendBaseUrl:

    def test_prefers_backend_url_when_both_are_set(self):
        with patch.dict(os.environ, {
            "BACKEND_URL": "https://api.alternatecrm.example",
            "RAILWAY_PUBLIC_DOMAIN": "backend-production.up.railway.app",
        }):
            assert config.backend_base_url() == "https://api.alternatecrm.example"

    def test_falls_back_to_the_platform_injected_url(self):
        with patch.dict(os.environ, {"BACKEND_URL": "", "RAILWAY_PUBLIC_DOMAIN": "backend-production.up.railway.app"}):
            assert config.backend_base_url() == "https://backend-production.up.railway.app"

    def test_strips_a_trailing_slash_so_callers_can_concatenate_paths(self):
        with patch.dict(os.environ, {"BACKEND_URL": "https://api.example/"}):
            assert config.backend_base_url() + "/api/public/unsubscribe" == \
                "https://api.example/api/public/unsubscribe"

    def test_empty_when_neither_is_set_so_callers_can_still_refuse(self):
        with patch.dict(os.environ, {"BACKEND_URL": "", "RAILWAY_PUBLIC_DOMAIN": ""}):
            assert config.backend_base_url() == ""


class TestScheduledCampaignJobUsesIt:

    def test_railway_domain_alone_is_enough_to_stop_skipping_ticks(self):
        from scheduled_jobs import _scheduled_email_campaign_job

        with patch.dict(os.environ, {"BACKEND_URL": "", "RAILWAY_PUBLIC_DOMAIN": "backend-production.up.railway.app"}), \
             patch("database.SessionLocal") as mock_session_local:
            mock_db = mock_session_local.return_value
            mock_db.query.return_value.filter.return_value.all.return_value = []
            _scheduled_email_campaign_job()

        # Reached the DB — i.e. it did not bail at the missing-base-url guard.
        mock_session_local.assert_called_once()
