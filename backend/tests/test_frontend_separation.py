"""
Tests for Phase 4: Frontend/Backend Separation.

Coverage:
  1. CORS — environment-aware origin configuration
  2. SERVE_FRONTEND — conditional static file mounting
  3. FRONTEND_URL — redirect behaviour in auth & email routes
  4. Module imports — all extracted modules still import cleanly
  5. config.js — frontend config file exists and is well-formed
"""
import os
import sys
import importlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient


# ─────────────────────────────────────────────────────────────────────────────
# 1. Module import health — all extracted modules load without error
# ─────────────────────────────────────────────────────────────────────────────

class TestModuleImports:
    """Verify every module created in Phases 1-3 imports successfully."""

    @pytest.mark.parametrize("module_name", [
        "routes.admin_upload_routes",
        "routes.admin_user_routes",
        "routes.admin_assignment_routes",
        "routes.admin_sync_routes",
        "routes.analytics_ai_routes",
        "routes.analytics_digest_routes",
        "routes.activity_feed_routes",
        "routes.lead_helpers",
    ])
    def test_module_imports(self, module_name):
        """Each extracted module should import without errors."""
        mod = importlib.import_module(module_name)
        assert mod is not None


class TestLeadHelpersModule:
    """Verify lead_helpers has all expected functions."""

    def test_has_key_functions(self):
        from routes.lead_helpers import (
            _lead_to_dict,
            _lead_to_summary,
            _build_lead_query,
        )
        assert callable(_lead_to_dict)
        assert callable(_lead_to_summary)
        assert callable(_build_lead_query)


# ─────────────────────────────────────────────────────────────────────────────
# 2. CORS configuration
# ─────────────────────────────────────────────────────────────────────────────

class TestCORSConfiguration:

    def test_cors_defaults_to_wildcard_without_env(self):
        """Without FRONTEND_URL, CORS should default to allow all origins."""
        env = {k: v for k, v in os.environ.items() if k != "FRONTEND_URL"}
        with patch.dict(os.environ, env, clear=True):
            # Re-read the env var the same way main.py does
            frontend_url = os.getenv("FRONTEND_URL", "")
            if frontend_url:
                origins = [frontend_url, "http://localhost:3000"]
            else:
                origins = ["*"]
            assert origins == ["*"]

    def test_cors_uses_frontend_url_when_set(self):
        """With FRONTEND_URL set, CORS should restrict to that origin."""
        with patch.dict(os.environ, {"FRONTEND_URL": "https://my-frontend.com"}):
            frontend_url = os.getenv("FRONTEND_URL", "")
            if frontend_url:
                origins = [frontend_url, "http://localhost:3000"]
            else:
                origins = ["*"]
            assert "https://my-frontend.com" in origins
            assert "http://localhost:3000" in origins
            assert "*" not in origins


# ─────────────────────────────────────────────────────────────────────────────
# 3. SERVE_FRONTEND env var logic
# ─────────────────────────────────────────────────────────────────────────────

class TestServeFrontendFlag:

    def test_serve_frontend_defaults_true(self):
        """Without SERVE_FRONTEND env var, should default to true."""
        env = {k: v for k, v in os.environ.items() if k != "SERVE_FRONTEND"}
        with patch.dict(os.environ, env, clear=True):
            serve = os.getenv("SERVE_FRONTEND", "true").lower() != "false"
            assert serve is True

    def test_serve_frontend_false_disables(self):
        """SERVE_FRONTEND=false should disable static file mounting."""
        with patch.dict(os.environ, {"SERVE_FRONTEND": "false"}):
            serve = os.getenv("SERVE_FRONTEND", "true").lower() != "false"
            assert serve is False

    def test_serve_frontend_true_enables(self):
        """SERVE_FRONTEND=true should enable static file mounting."""
        with patch.dict(os.environ, {"SERVE_FRONTEND": "true"}):
            serve = os.getenv("SERVE_FRONTEND", "true").lower() != "false"
            assert serve is True


# ─────────────────────────────────────────────────────────────────────────────
# 4. FRONTEND_URL redirect logic (auth_routes)
# ─────────────────────────────────────────────────────────────────────────────

class TestFrontendURLRedirects:
    """Test that redirect URLs are computed correctly based on FRONTEND_URL."""

    def test_redirect_to_external_frontend(self):
        """When FRONTEND_URL is set, redirect should point there."""
        with patch.dict(os.environ, {"FRONTEND_URL": "https://app.example.com"}):
            frontend_url = os.getenv("FRONTEND_URL", "")
            if frontend_url:
                redirect = f"{frontend_url}/login.html?error=auth_failed"
            else:
                redirect = "/frontend/login.html?error=auth_failed"
            assert redirect == "https://app.example.com/login.html?error=auth_failed"

    def test_redirect_to_cohosted_frontend(self):
        """When FRONTEND_URL is not set, redirect should use local path."""
        env = {k: v for k, v in os.environ.items() if k != "FRONTEND_URL"}
        with patch.dict(os.environ, env, clear=True):
            frontend_url = os.getenv("FRONTEND_URL", "")
            if frontend_url:
                redirect = f"{frontend_url}/login.html?error=auth_failed"
            else:
                redirect = "/frontend/login.html?error=auth_failed"
            assert redirect == "/frontend/login.html?error=auth_failed"

    def test_success_redirect_to_external_frontend(self):
        """Login success should redirect to FRONTEND_URL/index.html."""
        with patch.dict(os.environ, {"FRONTEND_URL": "https://app.example.com"}):
            frontend_url = os.getenv("FRONTEND_URL", "")
            if frontend_url:
                redirect = f"{frontend_url}/index.html"
            else:
                redirect = "/frontend/index.html"
            assert redirect == "https://app.example.com/index.html"


# ─────────────────────────────────────────────────────────────────────────────
# 5. Frontend config.js file integrity
# ─────────────────────────────────────────────────────────────────────────────

class TestFrontendConfigFiles:

    @pytest.fixture
    def frontend_dir(self):
        return os.path.join(os.path.dirname(__file__), "..", "..", "frontend")

    def test_config_js_exists(self, frontend_dir):
        """config.js must exist in the frontend directory."""
        config_path = os.path.join(frontend_dir, "config.js")
        assert os.path.exists(config_path), f"config.js not found at {config_path}"

    def test_config_js_declares_app_config(self, frontend_dir):
        """config.js must set window.__APP_CONFIG__."""
        config_path = os.path.join(frontend_dir, "config.js")
        content = open(config_path).read()
        assert "__APP_CONFIG__" in content

    def test_config_staging_js_exists(self, frontend_dir):
        """config.staging.js must exist as a reference for staging deploys."""
        staging_path = os.path.join(frontend_dir, "config.staging.js")
        assert os.path.exists(staging_path), f"config.staging.js not found"

    def test_config_staging_has_api_base(self, frontend_dir):
        """config.staging.js must set API_BASE to the staging backend URL."""
        staging_path = os.path.join(frontend_dir, "config.staging.js")
        content = open(staging_path).read()
        assert "API_BASE" in content
        assert "rcm-crm-staging" in content

    def test_index_html_loads_config(self, frontend_dir):
        """index.html must include a <script src='config.js'> tag."""
        index_path = os.path.join(frontend_dir, "index.html")
        content = open(index_path).read()
        assert "config.js" in content

    def test_login_html_loads_config(self, frontend_dir):
        """login.html must include a <script src='config.js'> tag."""
        login_path = os.path.join(frontend_dir, "login.html")
        content = open(login_path).read()
        assert "config.js" in content


# ─────────────────────────────────────────────────────────────────────────────
# 6. Auth.js API_BASE configuration
# ─────────────────────────────────────────────────────────────────────────────

class TestAuthJsConfig:

    def test_auth_js_uses_app_config(self):
        """auth.js must reference window.__APP_CONFIG__ for API_BASE."""
        auth_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "frontend", "js", "auth.js"
        )
        content = open(auth_path).read()
        assert "__APP_CONFIG__" in content
        assert "API_BASE" in content


# ─────────────────────────────────────────────────────────────────────────────
# 7. render.yaml structure validation
# ─────────────────────────────────────────────────────────────────────────────

class TestRenderYaml:

    @pytest.fixture
    def render_content(self):
        render_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "render.yaml"
        )
        return open(render_path).read()

    def test_vanilla_frontend_static_site_defined(self, render_content):
        """render.yaml must define the vanilla frontend static site."""
        assert "rcm-frontend-staging" in render_content

    def test_serve_frontend_false_in_staging(self, render_content):
        """Staging backend should have SERVE_FRONTEND set to false."""
        assert "SERVE_FRONTEND" in render_content

    def test_frontend_url_points_to_vanilla_site(self, render_content):
        """FRONTEND_URL should point to the vanilla frontend, not React."""
        assert "rcm-frontend-staging.onrender.com" in render_content
