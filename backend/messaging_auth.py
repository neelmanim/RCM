# ── messaging_auth.py — Shared HMAC auth + token cache for Alternate Messenger ───────
"""
Shared authentication module for both Alternate Messenger Conversations (messaging)
and Contact Center (dialer). Generates JWTs on-demand via HMAC-signed
authentication, with in-memory caching to minimize API calls.

Usage:
    from messaging_auth import AlternateMessengerAuthManager

    token = AlternateMessengerAuthManager.get_token(base_url, api_key, user_id)
    # Use token for API calls; on 401:
    AlternateMessengerAuthManager.clear_cache(base_url, api_key, user_id)
"""
import base64
import hashlib
import hmac
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Cache TTL: 90 minutes (JWT lasts 2 hours; refresh at 75% lifetime)
_CACHE_TTL_SECONDS = 90 * 60


class AlternateMessengerAuthManager:
    """Auto-generates and caches Alternate Messenger JWTs via HMAC authentication."""

    _lock = threading.Lock()
    _cache: dict = {}  # {(base_url, api_key, user_id): (token, expires_at)}

    @classmethod
    def get_token(cls, base_url: str, api_key: str, user_id: str) -> str:
        """
        Returns a valid JWT for the given Alternate Messenger credentials.
        Uses cached token if still fresh; otherwise authenticates via HMAC.

        Raises RuntimeError if authentication fails.
        """
        if not api_key or not user_id:
            raise RuntimeError("Alternate Messenger API Key and User ID are required. Configure them in Settings.")

        cache_key = (base_url.rstrip("/"), api_key, str(user_id))

        with cls._lock:
            cached = cls._cache.get(cache_key)
            if cached:
                token, expires_at = cached
                if time.time() < expires_at:
                    return token

        # Cache miss or expired — authenticate
        token, expires_at = cls._hmac_authenticate(base_url, api_key, user_id)

        with cls._lock:
            cls._cache[cache_key] = (token, expires_at)

        return token

    @classmethod
    def clear_cache(cls, base_url: str = None, api_key: str = None, user_id: str = None):
        """
        Invalidate cached token(s). Called on 401 or credential changes.
        If no args, clears ALL cached tokens.
        """
        with cls._lock:
            if base_url and api_key and user_id:
                cache_key = (base_url.rstrip("/"), api_key, str(user_id))
                cls._cache.pop(cache_key, None)
            else:
                cls._cache.clear()

    @classmethod
    def _sign(cls, api_key: str, user_id: str) -> dict:
        """HMAC signing step shared by _hmac_authenticate (server-side JWT
        fetch) and build_browser_auth_url (browser-facing redirect URL) —
        both hit the same /api/v2/crm/authenticate endpoint, just from a
        different caller."""
        now = datetime.now(timezone.utc)
        timestamp = now.strftime('%Y-%m-%dT%H:%M:%S.') + now.strftime('%f')[:3] + 'Z'
        message = f'userId={user_id}&timestamp={timestamp}&'
        signature = base64.b64encode(
            hmac.new(api_key.encode(), message.encode(), hashlib.sha256).digest()
        ).decode()
        return {"userId": str(user_id), "apiKey": api_key, "timestamp": timestamp, "signature": signature}

    @classmethod
    def build_browser_auth_url(cls, base_url: str, api_key: str, user_id: str, redirect_url: str) -> str:
        """
        Builds the /api/v2/crm/authenticate URL for the BROWSER to load
        directly (e.g. as an iframe src) — unlike get_token(), this makes no
        HTTP call itself. Alternate Messenger's full web app (/app/#/...) reads its
        session from the mAgIC_pAnDa cookie that this endpoint sets via
        Set-Cookie, then honors `redirect_url` to send the browser on to the
        real destination. get_token()'s server-side call reaches the same
        endpoint but the Set-Cookie response lands on our backend's process,
        never the end user's browser — fine for the simpler embeddable
        widget (/fastapp/desk/#/inbox, reads session_id straight off the
        URL — see lead_routes.py::get_messaging_config), not for the full
        SPA, which is why it fell back to its own login form.
        """
        if not api_key or not user_id:
            raise RuntimeError("Alternate Messenger API Key and User ID are required. Configure them in Settings.")
        base_url = base_url.rstrip("/")
        p = cls._sign(api_key, user_id)
        query = urllib.parse.urlencode({
            "crm": "audience_manager",
            "userId": p["userId"], "apiKey": p["apiKey"],
            "timestamp": p["timestamp"], "signature": p["signature"],
            "redirect_url": redirect_url,
        })
        return f"{base_url}/api/v2/crm/authenticate?{query}"

    @classmethod
    def _hmac_authenticate(cls, base_url: str, api_key: str, user_id: str) -> Tuple[str, float]:
        """
        Perform HMAC-signed authentication against the Alternate Messenger API.
        Returns (access_token, cache_expires_at_timestamp).
        """
        base_url = base_url.rstrip("/")
        p = cls._sign(api_key, user_id)

        params = urllib.parse.urlencode({
            "crm": "audience_manager",
            "userId": p["userId"], "apiKey": p["apiKey"],
            "timestamp": p["timestamp"], "signature": p["signature"],
        })

        url = f"{base_url}/api/v2/crm/authenticate?{params}"

        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())

            access_token = data.get("access_token")
            if not access_token:
                raise RuntimeError("Alternate Messenger auth returned no access_token")

            expires_at = time.time() + _CACHE_TTL_SECONDS
            logger.info(f"[AlternateMessenger] Fresh JWT obtained for user_id={user_id}")
            return access_token, expires_at

        except urllib.error.HTTPError as e:
            status = e.code
            error_body = ""
            try:
                error_body = e.read().decode()[:300]
            except Exception:
                pass

            if status == 401:
                logger.error(f"[AlternateMessenger] 401 — invalid credentials for user_id={user_id}")
                raise RuntimeError(
                    "Alternate Messenger authentication failed (401). "
                    "Check your API Key and User ID in Settings → Conversations."
                )
            elif status == 400:
                logger.error(f"[AlternateMessenger] 400 — bad request: {error_body}")
                raise RuntimeError(f"Alternate Messenger auth error: {error_body}")
            else:
                logger.error(f"[AlternateMessenger] HTTP {status}: {error_body}")
                raise RuntimeError(f"Alternate Messenger auth failed (HTTP {status})")

        except Exception as e:
            if isinstance(e, RuntimeError):
                raise
            logger.error(f"[AlternateMessenger] Request failed: {e}")
            raise RuntimeError(f"Failed to connect to Alternate Messenger for authentication: {str(e)[:100]}")

    @classmethod
    def test_connection(cls, base_url: str, api_key: str, user_id: str) -> dict:
        """
        Test credentials by attempting HMAC auth. Returns result dict.
        Used by the admin Test Connection button.
        """
        try:
            token, _ = cls._hmac_authenticate(base_url, api_key, user_id)
            # Decode JWT to get account info
            try:
                payload_b64 = token.split('.')[1]
                payload_b64 += '=' * (4 - len(payload_b64) % 4)
                claims = json.loads(base64.b64decode(payload_b64))
                identity = json.loads(claims.get("identity", "{}"))
                return {
                    "success": True,
                    "message": "Authentication successful",
                    "user_id": identity.get("user_id", user_id),
                    "token_expires_in": "2 hours",
                }
            except Exception:
                return {"success": True, "message": "Authentication successful"}
        except RuntimeError as e:
            return {"success": False, "error": str(e)}
        except Exception as e:
            return {"success": False, "error": f"Connection failed: {str(e)[:100]}"}
