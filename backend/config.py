"""App-wide constants that aren't secrets (see AGENT_PROTOCOL.md Rule 15).

APP_VERSION mirrors the repo-root VERSION file — bump both together.
Python can't import the JS-side generated version module (see
scripts/sync-version.mjs), so this is the one manual line on the backend side.
"""
APP_VERSION = "11.0.0"
BRAND_TAGLINE = "RCM · Powered by RCM"
