"""App-wide constants that aren't secrets (see AGENT_PROTOCOL.md Rule 15).

APP_VERSION mirrors the repo-root VERSION file — bump both together.
Python can't import the JS-side generated version module (see
scripts/sync-version.mjs), so this is the one manual line on the backend side.
"""
import os

APP_VERSION = "14.3.0"
BRAND_TAGLINE = "Alternate CRM · Powered by Alternate Messenger"


def backend_base_url() -> str:
    """This service's own public origin, for links other systems fetch back:
    campaign unsubscribe pages, signature logos in sent mail, dialer webhooks.

    BACKEND_URL is the override for a custom API domain; RENDER_EXTERNAL_URL is
    injected by the platform, so the default needs nobody to set anything.
    Neither was set on prod or staging, which is why the scheduled email
    campaign job logged "BACKEND_URL not set" and skipped every 15-minute tick
    (v12.2.3). Returns "" only in local dev — callers that need a reachable
    URL must still check.
    """
    return (os.getenv("BACKEND_URL") or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")

# Shown to an SDR whose "add lead" hit a lead another rep owns (who to ask for a reassignment).
# Set LEAD_OWNERSHIP_CONTACT on Render (e.g. "Neelmani Mishra, +91 …"); blank = no contact line.
LEAD_OWNERSHIP_CONTACT = os.getenv("LEAD_OWNERSHIP_CONTACT", "").strip()
