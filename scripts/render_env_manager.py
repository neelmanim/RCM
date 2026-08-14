#!/usr/bin/env python3
"""
Render Environment Variable Manager
====================================
SAFE wrapper for Render's /env-vars API.

⚠️  CRITICAL: Render's PUT /env-vars REPLACES ALL env vars.
    This script ALWAYS fetches first, merges, then PUTs.
    NEVER call the Render API directly for env var changes.

Usage:
    python3 scripts/render_env_manager.py list
    python3 scripts/render_env_manager.py set KEY VALUE
    python3 scripts/render_env_manager.py set-many path/to/file.env
    python3 scripts/render_env_manager.py delete KEY
    python3 scripts/render_env_manager.py restore path/to/file.env   # full restore (replaces all)
"""

import sys
import os
import json
import urllib.request
import urllib.error

# ── Configuration ─────────────────────────────────────────────────────────────
RENDER_API_KEY = os.getenv("RENDER_API_KEY", "rnd_uKpndOd3nQjnc2xiwsiuTxChVuyw")
SERVICE_ID     = os.getenv("RENDER_SERVICE_ID", "srv-d6ncc2p5pdvs73aacr6g")
BASE_URL       = f"https://api.render.com/v1/services/{SERVICE_ID}/env-vars"

HEADERS = {
    "Authorization": f"Bearer {RENDER_API_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

# ── Core API helpers ───────────────────────────────────────────────────────────

def _get_all() -> dict:
    """Fetch all current env vars. Returns {key: value} dict."""
    req = urllib.request.Request(f"{BASE_URL}?limit=100", headers=HEADERS)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            return {item["envVar"]["key"]: item["envVar"]["value"] for item in data}
    except urllib.error.HTTPError as e:
        print(f"❌ GET failed: {e.code} {e.read().decode()}")
        sys.exit(1)


def _put_all(env_dict: dict) -> bool:
    """PUT the full env var dict. Only call after merging with _get_all()."""
    payload = json.dumps([{"key": k, "value": v} for k, v in env_dict.items()]).encode()
    req = urllib.request.Request(BASE_URL, data=payload, headers=HEADERS, method="PUT")
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()
            return True
    except urllib.error.HTTPError as e:
        print(f"❌ PUT failed: {e.code} {e.read().decode()}")
        return False


def _safe_merge_put(updates: dict, delete_keys: list = None) -> dict:
    """
    The safe pattern: GET → merge updates → DELETE keys → PUT.
    Returns the final env dict that was applied.
    """
    current = _get_all()
    merged = {**current, **updates}
    if delete_keys:
        for k in delete_keys:
            merged.pop(k, None)
    if _put_all(merged):
        return merged
    return {}


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_list():
    """List all current env vars (values masked for secrets)."""
    env = _get_all()
    SECRET_KEYS = {"JWT_SECRET", "APP_ENCRYPTION_KEY", "SF_PASSWORD", "SF_SECURITY_TOKEN",
                   "GOOGLE_CLIENT_SECRET", "MONITORING_API_KEY", "DATABASE_URL"}
    print(f"\n{'KEY':<35} {'VALUE'}")
    print("─" * 80)
    for k, v in sorted(env.items()):
        display = "•••••••••" if k in SECRET_KEYS else v
        print(f"{k:<35} {display}")
    print(f"\n✅ {len(env)} env var(s) configured on {SERVICE_ID}\n")


def cmd_set(key: str, value: str):
    """Safely add or update a single env var."""
    print(f"🔄 Fetching current env vars...")
    result = _safe_merge_put({key: value})
    if result:
        print(f"✅ Set {key} successfully ({len(result)} total vars).")
    else:
        print(f"❌ Failed to set {key}.")
        sys.exit(1)


def cmd_set_many(filepath: str):
    """
    Safely add/update env vars from a .env file.
    Lines starting with # are ignored. Format: KEY=VALUE
    """
    if not os.path.exists(filepath):
        print(f"❌ File not found: {filepath}")
        sys.exit(1)

    updates = {}
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            # Strip surrounding quotes if present
            value = value.strip().strip('"').strip("'")
            updates[key.strip()] = value

    print(f"🔄 Merging {len(updates)} key(s) from {filepath}...")
    result = _safe_merge_put(updates)
    if result:
        print(f"✅ Updated {len(updates)} key(s). Total: {len(result)} vars.")
        for k in sorted(updates.keys()):
            print(f"   ✓ {k}")
    else:
        print("❌ Update failed.")
        sys.exit(1)


def cmd_delete(key: str):
    """Safely remove a single env var."""
    print(f"🔄 Fetching current env vars...")
    current = _get_all()
    if key not in current:
        print(f"⚠️  Key '{key}' not found — nothing to delete.")
        return
    result = _safe_merge_put({}, delete_keys=[key])
    if result is not None:
        print(f"✅ Deleted '{key}'. Total: {len(result)} vars remaining.")
    else:
        print(f"❌ Failed to delete '{key}'.")
        sys.exit(1)


def cmd_restore(filepath: str):
    """
    FULL RESTORE from a .env file — replaces ALL env vars.
    Use only for disaster recovery. Prompts for confirmation.
    """
    if not os.path.exists(filepath):
        print(f"❌ File not found: {filepath}")
        sys.exit(1)

    new_vars = {}
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            new_vars[key.strip()] = value.strip().strip('"').strip("'")

    current = _get_all()
    print(f"\n⚠️  FULL RESTORE: This will REPLACE all {len(current)} current env vars")
    print(f"   with {len(new_vars)} vars from {filepath}.")
    print(f"\nCurrent keys:  {sorted(current.keys())}")
    print(f"Restore keys:  {sorted(new_vars.keys())}")
    confirm = input("\nType 'yes' to confirm: ").strip().lower()
    if confirm != "yes":
        print("Aborted.")
        return

    if _put_all(new_vars):
        print(f"✅ Full restore complete. {len(new_vars)} vars set.")
    else:
        print("❌ Restore failed.")
        sys.exit(1)


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "list":
        cmd_list()
    elif cmd == "set":
        if len(sys.argv) < 4:
            print("Usage: render_env_manager.py set KEY VALUE")
            sys.exit(1)
        cmd_set(sys.argv[2], sys.argv[3])
    elif cmd == "set-many":
        if len(sys.argv) < 3:
            print("Usage: render_env_manager.py set-many path/to/file.env")
            sys.exit(1)
        cmd_set_many(sys.argv[2])
    elif cmd == "delete":
        if len(sys.argv) < 3:
            print("Usage: render_env_manager.py delete KEY")
            sys.exit(1)
        cmd_delete(sys.argv[2])
    elif cmd == "restore":
        if len(sys.argv) < 3:
            print("Usage: render_env_manager.py restore path/to/file.env")
            sys.exit(1)
        cmd_restore(sys.argv[2])
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
