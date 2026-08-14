"""Smallest possible self-check for rcm_mcp.py — no server, no network.
Mocks httpx.get and asserts each tool hits the right path/params and returns
the parsed JSON untouched. The actual endpoint contract is covered end-to-end
by backend/tests/test_public_api.py (TestPublicLeadsSearch/TestPublicLeadCalls).

Run: python3 test_rcm_mcp.py
"""
import os
from unittest.mock import patch, MagicMock

os.environ.setdefault("RCM_BASE_URL", "https://example.test")
os.environ.setdefault("RCM_API_KEY", "test-key")

import rcm_mcp as m


def _fake_response(json_body):
    resp = MagicMock()
    resp.json.return_value = json_body
    resp.raise_for_status.return_value = None
    return resp


def test_search_leads_hits_expected_path():
    with patch("rcm_mcp.httpx.get", return_value=_fake_response({"leads": []})) as mock_get:
        result = m.search_leads("acme", limit=5)
        mock_get.assert_called_once_with(
            "https://example.test/api/public/leads/search",
            params={"q": "acme", "limit": 5},
            headers={"X-API-Key": "test-key"},
            timeout=15,
        )
        assert result == {"leads": []}


def test_get_lead_calls_hits_expected_path():
    with patch("rcm_mcp.httpx.get", return_value=_fake_response({"calls": [], "stats": {}})) as mock_get:
        result = m.get_lead_calls("lead-123", page=2, limit=10)
        mock_get.assert_called_once_with(
            "https://example.test/api/public/leads/lead-123/calls",
            params={"page": 2, "limit": 10},
            headers={"X-API-Key": "test-key"},
            timeout=15,
        )
        assert result == {"calls": [], "stats": {}}


if __name__ == "__main__":
    test_search_leads_hits_expected_path()
    test_get_lead_calls_hits_expected_path()
    print("OK — rcm_mcp tools call the expected endpoints.")
