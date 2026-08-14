"""
RCM MCP server — read-only lead/call data access for internal teams.

Wraps the existing X-API-Key-authenticated endpoints in
backend/routes/public_api_routes.py. Adds no query logic of its own — every
tool is a thin HTTP call to RCM's own API, so role/data scoping and
correctness live in one place (the backend), not duplicated here.

Config (env vars):
  RCM_BASE_URL  e.g. https://api.alternatecrm.com  (required)
  RCM_API_KEY   generated in Admin Settings -> Public API tab (required)

Run: python3 rcm_mcp.py   (stdio transport — register in your MCP client)
"""
import os
import httpx
from mcp.server.fastmcp import FastMCP

BASE_URL = os.environ["RCM_BASE_URL"].rstrip("/")
API_KEY = os.environ["RCM_API_KEY"]

mcp = FastMCP("rcm")


def _get(path: str, params: dict) -> dict:
    resp = httpx.get(
        f"{BASE_URL}{path}",
        params=params,
        headers={"X-API-Key": API_KEY},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


@mcp.tool()
def search_leads(query: str, limit: int = 20) -> dict:
    """Search RCM leads by name, email, or company. Returns id, name,
    company, status, and assigned SDR for each match."""
    return _get("/api/public/leads/search", {"q": query, "limit": limit})


@mcp.tool()
def get_lead_calls(lead_id: str, page: int = 1, limit: int = 10) -> dict:
    """Get call history (outcomes, notes, durations, recording links) for one
    RCM lead, given its lead_id (from search_leads)."""
    return _get(f"/api/public/leads/{lead_id}/calls", {"page": page, "limit": limit})


if __name__ == "__main__":
    mcp.run()
