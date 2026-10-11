#!/usr/bin/env python3
"""
probe_messaging_provider.py
─────────────────────────────
Diagnostic script to test every Alternate Messenger/Messaging Provider messaging API endpoint
we need for the widget Message tab.

Usage:
    python3 scripts/probe_messaging_provider.py \
        --base-url "https://app.alternatecrm.com" \
        --api-key  "YOUR_API_KEY" \
        --user-id  "YOUR_USER_ID" \
        --phone    "+1XXXXXXXXXX"   # A real phone number in your AM contacts

Output:
    A clear PASS/FAIL table for each endpoint with HTTP status + response snippet.
"""

import argparse
import json
import sys
import time
import requests

# ─── Colour helpers ──────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg):    print(f"  {GREEN}✅ PASS{RESET}  {msg}")
def fail(msg):  print(f"  {RED}❌ FAIL{RESET}  {msg}")
def warn(msg):  print(f"  {YELLOW}⚠️  WARN{RESET}  {msg}")
def section(t): print(f"\n{BOLD}{'─'*60}\n  {t}\n{'─'*60}{RESET}")

# ─── Request helpers ──────────────────────────────────────────────────────────
TIMEOUT = 15

def am_headers(api_key: str) -> dict:
    return {"apiKey": api_key, "Content-Type": "application/json", "Accept": "application/json"}

def get(url, headers, params=None):
    try:
        r = requests.get(url, headers=headers, params=params, timeout=TIMEOUT)
        return r.status_code, _safe_json(r)
    except Exception as e:
        return None, {"error": str(e)}

def post(url, headers, body=None, params=None):
    try:
        r = requests.post(url, headers=headers, json=body, params=params, timeout=TIMEOUT)
        return r.status_code, _safe_json(r)
    except Exception as e:
        return None, {"error": str(e)}

def _safe_json(r):
    try:
        return r.json()
    except Exception:
        return {"raw": r.text[:300]}

def snippet(d, max_chars=200):
    s = json.dumps(d, indent=2)
    return s[:max_chars] + "..." if len(s) > max_chars else s


# ─── Individual probe functions ───────────────────────────────────────────────

def probe_am_search(base, api_key, phone):
    """Test: Search contact by phone (Audience Manager)."""
    section("1. Audience Manager — Search Contact by Phone")
    url = f"{base}/api/v2/converse_integration/record/search_by_query"
    params = {
        "crm_name": "audience_manager",
        "limit": 5,
        "page": 1,
        "query": phone.lstrip("+"),
        "record_type": "contacts",
    }
    status, data = get(url, am_headers(api_key), params)
    print(f"  URL: GET {url}")
    print(f"  Status: {status}")
    if status == 200:
        records = data.get("records", [])
        if records:
            rid = records[0].get("record_id", "?")
            ok(f"Found {len(records)} contact(s). First record_id={rid}")
            return rid
        else:
            warn("200 OK but no records found for this phone. Try a different phone number.")
    else:
        fail(f"HTTP {status}\n  {snippet(data)}")
    return None


def probe_am_create(base, api_key, user_id, phone):
    """Test: Create a contact in Audience Manager."""
    section("2. Audience Manager — Create Contact")
    url = f"{base}/api/v1/audience-manager/contact"
    params = {"user_id": user_id}
    payload = {
        "first_name": "Widget",
        "last_name": "Probe",
        "mobile_number": phone,
        "source": "Alternate CRM",
        "create_consent": 1,
    }
    status, data = post(url, am_headers(api_key), body=payload, params=params)
    print(f"  URL: POST {url}")
    print(f"  Status: {status}")
    if status in (200, 201):
        rid = (
            data.get("record_id")
            or data.get("id")
            or data.get("contact_id")
            or data.get("data", {}).get("id")
        )
        ok(f"Contact created. record_id={rid}")
        return rid
    elif status == 409:
        warn("409 Conflict — contact already exists (this is fine).")
    else:
        fail(f"HTTP {status}\n  {snippet(data)}")
    return None


def probe_conversation_list(base, api_key, record_id):
    """Test: List conversations for a contact (inbox thread list)."""
    section("3. Conversations — List threads for contact")
    # Try the standard conversations search endpoint
    url = f"{base}/api/v2/converse_integration/record/search_by_query"
    params = {
        "crm_name": "audience_manager",
        "record_id": record_id,
        "record_type": "contacts",
        "limit": 10,
        "page": 1,
    }
    status, data = get(url, am_headers(api_key), params)
    print(f"  URL: GET {url} (with record_id filter)")
    print(f"  Status: {status}")
    print(f"  Response: {snippet(data)}")
    if status == 200:
        ok("Endpoint accessible.")
    else:
        fail(f"HTTP {status}")

    # Also try a direct conversations endpoint
    section("3b. Conversations — Direct /conversations endpoint")
    url2 = f"{base}/api/v1/conversations"
    params2 = {"record_id": record_id, "record_type": "contacts"}
    status2, data2 = get(url2, am_headers(api_key), params2)
    print(f"  URL: GET {url2}")
    print(f"  Status: {status2}")
    print(f"  Response: {snippet(data2)}")
    if status2 == 200:
        ok("Direct /conversations endpoint accessible!")
    elif status2 == 401:
        fail("401 Unauthorized — API key doesn't cover messaging read.")
    elif status2 == 403:
        fail("403 Forbidden — scope restriction.")
    elif status2 == 404:
        warn("404 — endpoint doesn't exist at this path.")
    else:
        warn(f"HTTP {status2} — unexpected.")


def probe_messages_send(base, api_key, user_id, record_id, phone):
    """Test: Send an SMS message via Alternate Messenger API."""
    section("4. Messaging — Send SMS (dry test with dummy text)")
    url = f"{base}/api/v1/messages/send"
    payload = {
        "record_id": record_id,
        "record_type": "contacts",
        "to": phone,
        "message": "[Alternate CRM Widget Probe] API connectivity test — ignore.",
        "user_id": user_id,
    }
    status, data = post(url, am_headers(api_key), body=payload)
    print(f"  URL: POST {url}")
    print(f"  Status: {status}")
    print(f"  Response: {snippet(data)}")
    if status in (200, 201):
        ok("Send SMS works!")
    elif status == 401:
        fail("401 — API key doesn't have messaging send scope.")
    elif status == 403:
        fail("403 — Forbidden. Need additional permissions.")
    elif status == 404:
        warn("404 — /api/v1/messages/send doesn't exist. Try a different path.")
        # Try alternate path
        alt_url = f"{base}/api/v2/messages/send"
        s2, d2 = post(alt_url, am_headers(api_key), body=payload)
        print(f"\n  Trying: POST {alt_url} → HTTP {s2}")
        print(f"  Response: {snippet(d2)}")
    elif status == 422:
        warn(f"422 Validation error — endpoint exists but payload needs adjustment.\n  {snippet(data)}")
    else:
        warn(f"HTTP {status}")


def probe_webhook_subscription(base, api_key):
    """Test: Check if we can subscribe to inbound message webhooks."""
    section("5. Webhooks — Check webhook subscription API")
    url = f"{base}/api/v1/webhooks"
    status, data = get(url, am_headers(api_key))
    print(f"  URL: GET {url}")
    print(f"  Status: {status}")
    print(f"  Response: {snippet(data)}")
    if status == 200:
        ok("Webhook API accessible — real-time messaging push is possible!")
    elif status == 404:
        warn("No webhook API at this path. Polling fallback will be needed.")
    else:
        warn(f"HTTP {status}")


def probe_auth_login(base, api_key, user_id):
    """Test: Replicate our messaging_auth.py JWT login."""
    section("6. Auth — Test JWT login (used by iframe auth flow)")
    # This mirrors what messaging_auth.py does
    url = f"{base}/api/v1/auth/login"
    payload = {"apiKey": api_key, "userId": user_id}
    status, data = post(url, {"Content-Type": "application/json", "Accept": "application/json"}, body=payload)
    print(f"  URL: POST {url}")
    print(f"  Status: {status}")
    if status == 200:
        token = data.get("token") or data.get("access_token") or data.get("session_id")
        ok(f"Auth login works. Token present: {bool(token)}")
    else:
        fail(f"HTTP {status}\n  {snippet(data)}")


# ─── Summary ──────────────────────────────────────────────────────────────────

def print_summary(results: dict):
    print(f"\n{BOLD}{'═'*60}")
    print("  MESSAGING API PROBE SUMMARY")
    print(f"{'═'*60}{RESET}")
    for name, passed in results.items():
        icon = f"{GREEN}✅{RESET}" if passed else f"{RED}❌{RESET}"
        print(f"  {icon}  {name}")
    print()


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Probe Alternate Messenger messaging APIs")
    parser.add_argument("--base-url", required=True, help="e.g. https://app.alternatecrm.com")
    parser.add_argument("--api-key",  required=True, help="messenger_api_key from SyncSettings")
    parser.add_argument("--user-id",  required=True, help="messenger_user_id from SyncSettings")
    parser.add_argument("--phone",    required=True, help="Phone number to test with e.g. +1XXXXXXXXXX")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    print(f"\n{BOLD}Alternate Messenger Messaging API Probe{RESET}")
    print(f"  Base URL : {base}")
    print(f"  User ID  : {args.user_id}")
    print(f"  Phone    : {args.phone}")
    print(f"  Time     : {time.strftime('%Y-%m-%d %H:%M:%S')}")

    results = {}

    # 1. AM Contact Search
    record_id = probe_am_search(base, args.api_key, args.phone)
    results["AM Contact Search"] = record_id is not None

    # 2. AM Contact Create (only if not found)
    if not record_id:
        record_id = probe_am_create(base, args.api_key, args.user_id, args.phone)
        results["AM Contact Create"] = record_id is not None
    else:
        results["AM Contact Create"] = None  # Skipped (already exists)

    # 3. Conversation list / thread read
    if record_id:
        probe_conversation_list(base, args.api_key, record_id)
        results["Conversation Thread Read"] = None  # Manual review of output needed

    # 4. Send SMS
    if record_id:
        probe_messages_send(base, args.api_key, args.user_id, record_id, args.phone)
        results["Send SMS"] = None  # Manual review of output needed

    # 5. Webhooks
    probe_webhook_subscription(base, args.api_key)
    results["Webhook Subscription API"] = None  # Manual review

    # 6. Auth
    probe_auth_login(base, args.api_key, args.user_id)
    results["JWT Auth Login"] = None  # Manual review

    print_summary(results)
    print(f"{YELLOW}Note: For endpoints marked ❌ FAIL, we will use fallback strategies in the widget.{RESET}\n")


if __name__ == "__main__":
    main()
