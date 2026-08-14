#!/usr/bin/env python3
"""
UptimeRobot Monitor Setup — RCM CRM (PRODUCTION ONLY)
============================================================
Provisions all critical production monitors via the UptimeRobot v2 API.
Idempotent: skips monitors that already exist (matched by URL).

Usage:
    python3 scripts/setup_uptimerobot.py              # provision/fix all prod monitors
    python3 scripts/setup_uptimerobot.py --dry-run    # preview, no API writes
    python3 scripts/setup_uptimerobot.py --list       # list all + current status
    python3 scripts/setup_uptimerobot.py --fix        # patch keyword_type on existing monitors
    python3 scripts/setup_uptimerobot.py --cleanup    # remove staging monitors
    python3 scripts/setup_uptimerobot.py --delete-all # ⚠ delete everything

keyword_type semantics (UptimeRobot v2):
    keyword_type: 1 = "alert when keyword IS found"   ← DOWN when keyword present
    keyword_type: 2 = "alert when keyword NOT found"  ← DOWN when keyword absent  ✅ use this

We always use keyword_type=2 so that the monitor is UP when the keyword
IS in the response body, and DOWN when it's missing (e.g. degraded status).

5-tier monitoring strategy:
    T1 — Availability    : Is the surface reachable? (HTTP 200)
    T2 — DB health       : Can we query the leads table?
    T3 — Startup         : Has the app finished initializing?
    T4 — Auth            : Can users log in?
    T5 — Public API      : Is the CMT↔SF bridge operational?
    T6 — Authenticated   : Rich deep check via monitoring API key (leads/users/sync)
"""

import json
import sys
import time
import argparse
import urllib.request
import urllib.parse

# ── Config ─────────────────────────────────────────────────────────────────────
API_KEY        = "u3486919-d589aa2cc8ccc819ddc3bd2d"
BASE_URL       = "https://api.uptimerobot.com/v2"
PROD_BASE      = "https://api.alternatecrm.com"
FRONTEND_URL   = "https://rcm.txtbox.in"

# UptimeRobot monitor type constants
TYPE_HTTP    = 1   # HTTP(s) — alerts on non-2xx or connection failure
TYPE_KEYWORD = 2   # HTTP(s) + body keyword check

# keyword_type values
KW_ALERT_WHEN_FOUND     = 1  # ← DOWN when keyword IS found   (we do NOT want this)
KW_ALERT_WHEN_NOT_FOUND = 2  # ← DOWN when keyword NOT found  ✅ always use this

# Free plan: 5-minute minimum interval (300 seconds)
INTERVAL = 300

# Staging URL fragments — used to identify monitors to remove
STAGING_PATTERNS = [
    "staging.onrender.com",
    "rcm-frontend-staging",
    "rcm-crm-staging",
]

# ── Monitoring API key ─────────────────────────────────────────────────────────
# This key is stored in Render's environment as MONITORING_API_KEY.
# It gates the /api/monitoring/health endpoint so UptimeRobot can call it
# without a JWT, while keeping the data private.
#
# To rotate: update MONITORING_API_KEY in Render, then run --fix to reprovision.
import os
MONITORING_KEY = os.getenv("MONITORING_API_KEY", "ls-monitor-v1-2026")

# ── Production monitors ────────────────────────────────────────────────────────
MONITORS = [
    # ── T1: Surface availability ────────────────────────────────────────────
    {
        "friendly_name": "RCM — Frontend",
        "url": FRONTEND_URL,
        "type": TYPE_HTTP,
        "tier": "T1",
        "rationale": "Entry point for all SDRs. Down = 100% of users locked out.",
    },
    {
        "friendly_name": "RCM — Backend reachable (/api/health)",
        "url": f"{PROD_BASE}/api/health",
        "type": TYPE_KEYWORD,
        "keyword_type": KW_ALERT_WHEN_NOT_FOUND,
        "keyword_value": "ok",
        "tier": "T1",
        "rationale": "Shallow check — DB connected. Returns {status:'ok'} when healthy.",
    },

    # ── T2: Database health ─────────────────────────────────────────────────
    {
        "friendly_name": "RCM — DB table accessible (/api/health/deep)",
        "url": f"{PROD_BASE}/api/health/deep",
        "type": TYPE_KEYWORD,
        "keyword_type": KW_ALERT_WHEN_NOT_FOUND,
        "keyword_value": "true",  # db_tables_accessible: true
        "tier": "T2",
        "rationale": "Deep check with 2s query timeout — catches DB locks returning HTTP 200.",
    },

    # ── T3: Application startup ─────────────────────────────────────────────
    {
        "friendly_name": "RCM — App config endpoint (/api/config)",
        "url": f"{PROD_BASE}/api/config",
        "type": TYPE_HTTP,
        "tier": "T3",
        "rationale": "Served only after startup_complete=True. Proxy for 'app fully initialized'.",
    },

    # ── T4: Auth ────────────────────────────────────────────────────────────
    {
        "friendly_name": "RCM — Login page reachable (/api/auth/login)",
        "url": f"{PROD_BASE}/api/auth/login",
        "type": TYPE_HTTP,
        "tier": "T4",
        "rationale": "Auth entry point. Down = no one can log in (302 redirect to Google).",
    },

    # ── T5: Public API (CMT↔SF bridge) ─────────────────────────────────────
    {
        "friendly_name": "RCM — Public API health (/api/public/health)",
        "url": f"{PROD_BASE}/api/public/health",
        "type": TYPE_KEYWORD,
        "keyword_type": KW_ALERT_WHEN_NOT_FOUND,
        "keyword_value": "ok",
        "tier": "T5",
        "rationale": "CMT→SF bridge. Down = incoming lead data stops flowing silently.",
    },

    # ── T6: Authenticated deep health (via monitoring API key) ──────────────
    {
        "friendly_name": "RCM — Authenticated deep health (/api/monitoring/health)",
        "url": f"{PROD_BASE}/api/monitoring/health?key={MONITORING_KEY}",
        "type": TYPE_KEYWORD,
        "keyword_type": KW_ALERT_WHEN_NOT_FOUND,
        "keyword_value": '"status":"ok"',  # exact JSON fragment
        "tier": "T6",
        "rationale": (
            "Full-stack check behind monitoring key: DB, leads count, users count, "
            "last SF sync timestamp, scheduler thread alive. Catches data-loss events "
            "and scheduler crashes that surface/DB checks miss."
        ),
    },
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def _post(endpoint: str, payload: dict) -> dict:
    """POST to UptimeRobot v2 API and return parsed JSON."""
    payload["api_key"] = API_KEY
    payload["format"]  = "json"
    data = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/{endpoint}",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def get_existing_monitors() -> dict[str, dict]:
    """Return {url: monitor_dict} for all monitors in account."""
    result = _post("getMonitors", {"offset": 0, "limit": 50})
    if result.get("stat") != "ok":
        print(f"❌  getMonitors failed: {result}")
        sys.exit(1)
    return {m["url"]: m for m in result.get("monitors", [])}


def create_monitor(cfg: dict, dry_run: bool) -> bool:
    tier      = cfg.get("tier", "")
    rationale = cfg.get("rationale", "")
    payload: dict = {
        "friendly_name": cfg["friendly_name"],
        "url":           cfg["url"],
        "type":          cfg["type"],
        "interval":      INTERVAL,
    }
    if cfg["type"] == TYPE_KEYWORD:
        payload["keyword_type"]  = cfg["keyword_type"]
        payload["keyword_value"] = cfg["keyword_value"]

    if dry_run:
        kw = f" keyword='{cfg.get('keyword_value','')}' (kw_type={cfg.get('keyword_type','')})," if cfg["type"] == TYPE_KEYWORD else ""
        print(f"  [{tier}] Would create:{kw} {cfg['friendly_name']}")
        if rationale:
            print(f"         → {rationale[:110]}")
        return True

    result = _post("newMonitor", payload)
    if result.get("stat") == "ok":
        mid = result.get("monitor", {}).get("id", "?")
        print(f"  [{tier}] ✅  id={mid}: {cfg['friendly_name']}")
        return True
    else:
        err = result.get("error", result)
        print(f"  [{tier}] ❌  Failed: {cfg['friendly_name']} → {err}")
        return False


def patch_keyword_type(monitor_id: int, name: str, current_kw_type: int, dry_run: bool) -> bool:
    """Fix keyword_type from 1 (wrong) → 2 (correct) on existing monitors."""
    if current_kw_type == KW_ALERT_WHEN_NOT_FOUND:
        return False  # already correct
    if dry_run:
        print(f"  [FIX] Would patch id={monitor_id}: {name}  keyword_type: {current_kw_type} → 2")
        return True
    result = _post("editMonitor", {"id": monitor_id, "keyword_type": KW_ALERT_WHEN_NOT_FOUND})
    if result.get("stat") == "ok":
        print(f"  ✅  Fixed id={monitor_id}: {name}  keyword_type: {current_kw_type} → 2")
        return True
    else:
        print(f"  ❌  Patch failed id={monitor_id}: {name} → {result}")
        return False


def delete_monitor(monitor_id: int, name: str) -> None:
    result = _post("deleteMonitor", {"id": monitor_id})
    if result.get("stat") == "ok":
        print(f"  🗑   Deleted id={monitor_id}: {name}")
    else:
        print(f"  ❌  Delete failed id={monitor_id}: {name} → {result}")


# ── Status display ─────────────────────────────────────────────────────────────

STATUS_MAP = {
    0: "🔴 Down",
    1: "⏸  Paused",
    2: "⏳ Starting",
    8: "✅ Up",
    9: "⚠️  KW Error (keyword_type wrong or keyword missing)",
}

def _status_label(code: int) -> str:
    return STATUS_MAP.get(code, f"? ({code})")


# ── Commands ───────────────────────────────────────────────────────────────────

def cmd_list() -> None:
    print("\n📋  UptimeRobot monitors:\n")
    existing = get_existing_monitors()
    if not existing:
        print("  (none)\n")
        return
    prod, staging, other = [], [], []
    for url, m in existing.items():
        if any(p in url for p in STAGING_PATTERNS):
            staging.append((url, m))
        elif "rcm" in url:
            prod.append((url, m))
        else:
            other.append((url, m))

    def _print_group(label, items):
        if not items:
            return
        print(f"  {label}")
        for url, m in items:
            kw_flag = ""
            if m.get("type") == TYPE_KEYWORD:
                kw_flag = f"  [kw_type={m.get('keyword_type','?')} val='{m.get('keyword_value','')}']"
            print(f"    [{m['id']}] {_status_label(m.get('status', -1))}{kw_flag}")
            print(f"             {m['friendly_name']}")
            print(f"             {url}")
        print()

    _print_group("── PRODUCTION ──────────────────────────────", prod)
    _print_group("── STAGING (remove with --cleanup) ─────────", staging)
    _print_group("── OTHER ───────────────────────────────────", other)


def cmd_setup(dry_run: bool) -> None:
    label = "(DRY RUN) " if dry_run else ""
    print(f"\n🔧  {label}Provisioning RCM PRODUCTION monitors...\n")
    existing = get_existing_monitors()
    existing_urls = set(existing.keys())

    tier_groups: dict[str, list] = {}
    for m in MONITORS:
        tier_groups.setdefault(m.get("tier", ""), []).append(m)

    tier_labels = {
        "T1": "T1 — Surface availability",
        "T2": "T2 — Database health",
        "T3": "T3 — Application startup",
        "T4": "T4 — Auth",
        "T5": "T5 — Public API (CMT↔SF bridge)",
        "T6": "T6 — Authenticated deep health",
    }
    created = skipped = failed = 0
    for tier, monitors in sorted(tier_groups.items()):
        print(f"  {tier_labels.get(tier, tier)}")
        for cfg in monitors:
            url = cfg["url"]
            if url in existing_urls:
                print(f"  ⏭   Already exists: {cfg['friendly_name']}")
                skipped += 1
                continue
            ok = create_monitor(cfg, dry_run=dry_run)
            if ok:
                created += 1
            else:
                failed += 1
            if not dry_run:
                time.sleep(7)  # Free plan: max 10 req/min
        print()

    prefix = "[DRY-RUN] " if dry_run else ""
    print(f"{prefix}Done — created: {created}, skipped: {skipped}, failed: {failed}\n")


def cmd_fix(dry_run: bool = False) -> None:
    """
    Patch keyword_type on all existing keyword monitors that have the wrong value.
    Fixes the bug where keyword_type=1 ('alert when found') was used instead of
    keyword_type=2 ('alert when NOT found').
    """
    label = "(DRY RUN) " if dry_run else ""
    print(f"\n🔨  {label}Patching keyword_type on all keyword monitors...\n")
    existing = get_existing_monitors()
    fixed = already_ok = 0
    for url, m in existing.items():
        if m.get("type") != TYPE_KEYWORD:
            continue
        kw_type = m.get("keyword_type", -1)
        patched = patch_keyword_type(m["id"], m["friendly_name"], kw_type, dry_run)
        if patched:
            fixed += 1
            if not dry_run:
                time.sleep(7)
        else:
            already_ok += 1
    prefix = "[DRY-RUN] " if dry_run else ""
    print(f"\n{prefix}Patched: {fixed}, already correct: {already_ok}\n")


def cmd_cleanup() -> None:
    print("\n🧹  Removing staging monitors...\n")
    existing = get_existing_monitors()
    to_delete = [(url, m) for url, m in existing.items() if any(p in url for p in STAGING_PATTERNS)]
    if not to_delete:
        print("  No staging monitors found.\n")
        return
    for url, m in to_delete:
        delete_monitor(m["id"], m["friendly_name"])
        time.sleep(7)
    print()


def cmd_delete_all() -> None:
    print("\n⚠️   Deleting ALL monitors (Ctrl-C within 5s to abort)...")
    time.sleep(5)
    existing = get_existing_monitors()
    for url, m in existing.items():
        delete_monitor(m["id"], m["friendly_name"])
        time.sleep(7)
    print()


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="RCM production monitor provisioner (UptimeRobot v2)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--list",       action="store_true", help="List all monitors + status")
    group.add_argument("--dry-run",    action="store_true", help="Preview without API writes")
    group.add_argument("--fix",        action="store_true", help="Patch keyword_type=1→2 on existing monitors")
    group.add_argument("--cleanup",    action="store_true", help="Remove staging monitors")
    group.add_argument("--delete-all", action="store_true", help="⚠ Delete ALL monitors")
    args = parser.parse_args()

    if args.list:
        cmd_list()
    elif args.fix:
        cmd_fix()
    elif args.cleanup:
        cmd_cleanup()
    elif args.delete_all:
        cmd_delete_all()
    else:
        cmd_setup(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
