"""App-wide constants that aren't secrets (see AGENT_PROTOCOL.md Rule 15).

APP_VERSION mirrors the repo-root VERSION file — bump both together.
Python can't import the JS-side generated version module (see
scripts/sync-version.mjs), so this is the one manual line on the backend side.
"""
import os

APP_VERSION = "14.4.0"
BRAND_TAGLINE = "Alternate CRM · Powered by Alternate Messenger"


def backend_base_url() -> str:
    """This service's own public origin, for links other systems fetch back:
    campaign unsubscribe pages, signature logos in sent mail, dialer webhooks.

    BACKEND_URL is the primary override for a custom API domain (e.g. https://api.alternatecrm.com).
    RAILWAY_PUBLIC_DOMAIN is injected by Railway platform.
    """
    if os.getenv("BACKEND_URL"):
        return os.getenv("BACKEND_URL").rstrip("/")
    railway_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if railway_domain:
        if not railway_domain.startswith("http"):
            railway_domain = f"https://{railway_domain}"
        return railway_domain.rstrip("/")
    return ""


# Shown to an SDR whose "add lead" hit a lead another rep owns (who to ask for a reassignment).
# Set LEAD_OWNERSHIP_CONTACT in Railway environment (e.g. "Neelmani Mishra, +91 …"); blank = no contact line.
LEAD_OWNERSHIP_CONTACT = os.getenv("LEAD_OWNERSHIP_CONTACT", "").strip()
