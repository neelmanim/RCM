# RCM MCP server

Read-only lead/call data access for internal teams, via Claude — no more asking
engineering for one-off data pulls. Wraps `backend/routes/public_api_routes.py`;
it has no query logic of its own.

## Setup

Requires Python 3.10+ (the `mcp` SDK's minimum — the rest of this repo runs 3.9,
so use a separate venv, e.g. via `uv`):

```bash
cd mcp_server
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

Get an API key: Admin Settings -> Public API tab in RCM (generates one if
none exists yet).

Register with your MCP client (e.g. Claude Code's `.mcp.json`, or Claude
Desktop's config):

```json
{
  "mcpServers": {
    "rcm": {
      "command": "/absolute/path/to/mcp_server/.venv/bin/python",
      "args": ["/absolute/path/to/mcp_server/rcm_mcp.py"],
      "env": {
        "RCM_BASE_URL": "https://api.alternatecrm.com",
        "RCM_API_KEY": "<your key>"
      }
    }
  }
}
```

## Tools

- `search_leads(query, limit=20)` — find leads by name, email, or company.
- `get_lead_calls(lead_id, page=1, limit=10)` — call history for one lead.

## Access model

An API key is Super-Admin-equivalent read access — there's no per-key user
identity or role scoping (same trust model as the existing `sf/account`
endpoint). Treat the key as the access boundary: one key per consumer, and
only for read-only internal tooling. Don't paste it into a shared channel.

## Adding more tools

Add a new thin endpoint to `public_api_routes.py` (reusing existing query
logic — e.g. `_build_lead_query`, or a route function like `get_lead_calls`
imported and called directly) before adding a new tool here. Keep the MCP
server itself a pure wrapper; scoping/correctness belongs in the backend.
