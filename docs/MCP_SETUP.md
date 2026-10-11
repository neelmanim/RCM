# MCP setup for new team members

Two separate MCP servers exist in this project. Most people only need #1.

## 1. `code-review-graph` — automatic, do nothing

Every Claude Code agent working in this repo uses this to explore code
instead of grepping. It's already registered in the repo's own
`.mcp.json`, so there is no URL, key, or JSON to configure.

**Setup (one-time, per machine):**

```bash
pip install code-review-graph
# or: pipx install code-review-graph
# or: nothing — uvx (bundled with uv) fetches it on first run
```

Then just open this project in Claude Code. The server starts itself. If
it doesn't start, confirm `uvx` (or `code-review-graph`) is on your
`PATH`: `which uvx`.

That's it — skip section 2 unless you specifically need to query lead/call
data from Claude.

## 2. `alternatecrm` Public API MCP — optional, personal

Lets you ask Claude things like "find the lead named Acme Corp" or "show
call history for lead 123" without pinging engineering. This is **not**
auto-configured — it needs a personal API key, so it must never go in the
shared, git-committed `.mcp.json`.

### Step 1 — get an API key (Super Admin only)

1. Log into Alternate CRM.
2. Go to **Control Center → Integrations** tab.
3. Find the **"Public API — CMT ↔ Salesforce Bridge"** card.
4. Click **Generate New Key**.
5. Copy the key immediately — it's shown once (`alternatecrm_<48 hex chars>`).
   Store it somewhere private (1Password, etc.), not in Slack or a repo file.

If you don't see the Integrations tab, you're not a Super Admin — ask
someone who is to generate a key for you (the key itself isn't
role-scoped once issued, so any key works for any consumer).

### Step 2 — set up the server locally

The MCP SDK needs Python 3.10+; the rest of this repo runs on 3.9, so use
a separate venv:

```bash
cd mcp_server
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

### Step 3 — register it in YOUR OWN client config, never this repo's `.mcp.json`

Add this to your personal Claude Code / Claude Desktop MCP config (not
any file inside this git repo):

```json
{
  "mcpServers": {
    "alternatecrm": {
      "command": "/absolute/path/to/mcp_server/.venv/bin/python",
      "args": ["/absolute/path/to/mcp_server/alternatecrm_mcp.py"],
      "env": {
        "ALTERNATE_CRM_BASE_URL": "https://api.alternatecrm.staging.in",
        "ALTERNATE_CRM_API_KEY": "<the key from step 1>"
      }
    }
  }
}
```

Replace both `/absolute/path/to/...` with `$(pwd)`-style real paths (run
`pwd` inside `mcp_server/` to get the base, then append `.venv/bin/python`
and `alternatecrm_mcp.py`).

Use `https://messenger-crm-staging.onrender.com` instead of
`api.alternatecrm.staging.in` if you want to query staging data instead of
production — same routes, different host.

### Step 4 — verify

Restart your MCP client, then ask Claude to search for a lead by name. If
it can't find the server, double check the two absolute paths in step 3
actually exist (`ls` them) and that the key was pasted without extra
whitespace.

### Tools available

- `search_leads(query, limit=20)` — find leads by name, email, or company.
- `get_lead_calls(lead_id, page=1, limit=10)` — call history for one lead.

Full reference (access model, adding new tools): `mcp_server/README.md`.
