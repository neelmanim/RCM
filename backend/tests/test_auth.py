"""Tests for auth.py — JWT helpers, role guards, Google OAuth URL."""
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from auth import (
    create_jwt, decode_jwt, get_current_user,
    require_admin, require_super_admin, require_pod_admin_or_above,
    google_auth_url, JWT_SECRET, JWT_ALGORITHM,
)
from fastapi import HTTPException


# ── JWT round-trip ───────────────────────────────────────────────────────────

class TestJWT:

    def test_create_and_decode_roundtrip(self):
        data = {"sub": "user-1", "email": "a@b.com", "role": "SDR"}
        token = create_jwt(data)
        decoded = decode_jwt(token)
        assert decoded["sub"] == "user-1"
        assert decoded["email"] == "a@b.com"
        assert decoded["role"] == "SDR"
        assert "exp" in decoded

    def test_decode_invalid_token_raises_401(self):
        with pytest.raises(HTTPException) as exc:
            decode_jwt("not-a-real-token")
        assert exc.value.status_code == 401

    def test_decode_expired_token_raises_401(self):
        from jose import jwt as _jwt
        payload = {"sub": "x", "exp": datetime.utcnow() - timedelta(hours=1)}
        expired_token = _jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        with pytest.raises(HTTPException) as exc:
            decode_jwt(expired_token)
        assert exc.value.status_code == 401


# ── get_current_user ─────────────────────────────────────────────────────────

class TestGetCurrentUser:

    def test_no_credentials_raises_401(self):
        with pytest.raises(HTTPException) as exc:
            get_current_user(credentials=None)
        assert exc.value.status_code == 401

    def test_valid_credentials(self):
        from unittest.mock import MagicMock
        token = create_jwt({"sub": "u1", "email": "u@t.com", "role": "SDR"})
        creds = MagicMock()
        creds.credentials = token
        result = get_current_user(credentials=creds)
        assert result["sub"] == "u1"


# ── Role guards ──────────────────────────────────────────────────────────────

class TestRoleGuards:

    def test_require_admin_allows_super_admin(self):
        user = {"role": "Super Admin", "sub": "1"}
        result = require_admin(user=user)
        assert result["role"] == "Super Admin"

    def test_require_admin_allows_pod_admin(self):
        user = {"role": "Pod Admin", "sub": "2"}
        result = require_admin(user=user)
        assert result["role"] == "Pod Admin"

    def test_require_admin_denies_sdr(self):
        user = {"role": "SDR", "sub": "3"}
        with pytest.raises(HTTPException) as exc:
            require_admin(user=user)
        assert exc.value.status_code == 403

    def test_require_super_admin_allows_super_admin(self):
        user = {"role": "Super Admin", "sub": "1"}
        result = require_super_admin(user=user)
        assert result["role"] == "Super Admin"

    def test_require_super_admin_allows_legacy_admin(self):
        user = {"role": "Admin", "sub": "1"}
        result = require_super_admin(user=user)
        assert result["role"] == "Admin"

    def test_require_super_admin_denies_pod_admin(self):
        user = {"role": "Pod Admin", "sub": "2"}
        with pytest.raises(HTTPException) as exc:
            require_super_admin(user=user)
        assert exc.value.status_code == 403

    def test_require_super_admin_denies_sdr(self):
        user = {"role": "SDR", "sub": "3"}
        with pytest.raises(HTTPException) as exc:
            require_super_admin(user=user)
        assert exc.value.status_code == 403

    def test_require_pod_admin_or_above_allows_super_admin(self):
        user = {"role": "Super Admin", "sub": "1"}
        assert require_pod_admin_or_above(user=user)["role"] == "Super Admin"

    def test_require_pod_admin_or_above_allows_pod_admin(self):
        user = {"role": "Pod Admin", "sub": "2"}
        assert require_pod_admin_or_above(user=user)["role"] == "Pod Admin"

    def test_require_pod_admin_or_above_denies_sdr(self):
        user = {"role": "SDR", "sub": "3"}
        with pytest.raises(HTTPException) as exc:
            require_pod_admin_or_above(user=user)
        assert exc.value.status_code == 403


# ── Google OAuth URL ─────────────────────────────────────────────────────────

class TestGoogleAuthUrl:

    def test_url_contains_required_params(self):
        url = google_auth_url(state="test-state")
        assert "accounts.google.com" in url
        assert "response_type=code" in url
        assert "scope=openid" in url
        assert "state=test-state" in url
