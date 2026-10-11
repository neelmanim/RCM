"""config.backend_base_url() — the app's own public origin.

RCA 2026-09-09: neither prod nor staging had BACKEND_URL set, so
_scheduled_email_campaign_job logged "BACKEND_URL not set — skipping this
tick" every 15 minutes and would never have sent a scheduled campaign. The
same missing var silently blanked the Alternate Messenger dialer's webhook notify_url.
RENDER_EXTERNAL_URL is injected by the platform and was already trusted
elsewhere in this codebase (keep-alive ping, signature logo URLs, staging
detection) — so the default now needs nobody to configure anything, and
BACKEND_URL stays as the override for a custom API domain.
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
            "RENDER_EXTERNAL_URL": "https://svc-abc.onrender.com",
        }):
            assert config.backend_base_url() == "https://api.alternatecrm.example"

    def test_falls_back_to_the_platform_injected_url(self):
        with patch.dict(os.environ, {"BACKEND_URL": "", "RENDER_EXTERNAL_URL": "https://svc-abc.onrender.com"}):
            assert config.backend_base_url() == "https://svc-abc.onrender.com"

    def test_strips_a_trailing_slash_so_callers_can_concatenate_paths(self):
        with patch.dict(os.environ, {"BACKEND_URL": "https://api.example/"}):
            assert config.backend_base_url() + "/api/public/unsubscribe" == \
                "https://api.example/api/public/unsubscribe"

    def test_empty_when_neither_is_set_so_callers_can_still_refuse(self):
        with patch.dict(os.environ, {"BACKEND_URL": "", "RENDER_EXTERNAL_URL": ""}):
            assert config.backend_base_url() == ""


class TestScheduledCampaignJobUsesIt:

    def test_render_external_url_alone_is_enough_to_stop_skipping_ticks(self):
        """The prod symptom, inverted: with only the platform var present the
        job must get past its guard. Before the fix it read BACKEND_URL
        directly and returned early on every tick."""
        from scheduled_jobs import _scheduled_email_campaign_job

        with patch.dict(os.environ, {"BACKEND_URL": "", "RENDER_EXTERNAL_URL": "https://svc-abc.onrender.com"}), \
             patch("database.SessionLocal") as mock_session_local:
            mock_db = mock_session_local.return_value
            mock_db.query.return_value.filter.return_value.all.return_value = []
            _scheduled_email_campaign_job()

        # Reached the DB — i.e. it did not bail at the missing-base-url guard.
        mock_session_local.assert_called_once()
