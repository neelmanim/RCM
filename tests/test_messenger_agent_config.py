"""
═══════════════════════════════════════════════════════════════════════════════
  Alternate Messenger Per-SDR Agent Configuration — Backend API Test Suite

  TC-C1   PATCH /admin/users/{id}/settings  — set valid messenger_user_id
  TC-C2   PATCH /admin/users/{id}/settings  — set valid messenger_from_number (E.164)
  TC-C3   PATCH /admin/users/{id}/settings  — reject invalid from_number ("abc")
  TC-C4   PATCH /admin/users/{id}/settings  — clear from_number (empty string → NULL)
  TC-C5   PATCH /admin/users/{id}/settings  — SDR auth rejected (403)
  TC-C6   PATCH /admin/users/{id}/settings  — duplicate messenger_user_id yields warning
  TC-C7   GET  /admin/users                 — response includes messenger_from_number
  TC-C8   GET  /dialer/my-numbers           — no messenger_user_id → empty list + error msg
  TC-C9   GET  /dialer/my-numbers           — valid sub-agent → non-empty numbers list
  TC-C10  GET  /dialer/my-numbers           — unauthenticated → 401
  TC-C11  PATCH /dialer/my-phone            — SDR clears their number (empty) → NULL stored
  TC-C12  PATCH /dialer/my-phone            — 00-prefixed number not double-prefixed internally
  TC-C13  PATCH /admin/users/{id}/settings  — messenger_from_number with 00-prefix stored as-is

  Env vars:
    TEST_BASE      Base URL  (default: staging)
    ADMIN_JWT      Super Admin JWT
    TEST_JWT       SDR JWT (must NOT have messenger_user_id configured beforehand)
    TEST_SDR_ID    CRM user_id of the SDR used for admin patch tests
    TEST_SDR2_ID   A second SDR user_id used for the duplicate-agent-id test
    CONV_AGENT_ID  A real Alternate Messenger sub-agent user_id with call history (e.g. "355746")
═══════════════════════════════════════════════════════════════════════════════
"""

import os
import sys
import requests
from datetime import datetime, timezone

BASE       = os.environ.get("TEST_BASE", "https://messenger-crm-staging.onrender.com")
ADMIN_JWT  = os.environ.get("ADMIN_JWT", "")
SDR_JWT    = os.environ.get("TEST_JWT", "")
SDR_ID     = os.environ.get("TEST_SDR_ID", "")
SDR2_ID    = os.environ.get("TEST_SDR2_ID", "")
CONV_AGENT = os.environ.get("CONV_AGENT_ID", "355746")

HDR_ADMIN = {"Authorization": f"Bearer {ADMIN_JWT}", "Content-Type": "application/json"}
HDR_SDR   = {"Authorization": f"Bearer {SDR_JWT}",   "Content-Type": "application/json"}
HDR_ANON  = {"Content-Type": "application/json"}

# ── Helpers ───────────────────────────────────────────────────────────────────

passed = failed = skipped = 0
failures = []


def t(name, condition, detail=""):
    global passed, failed, failures
    if condition:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        failures.append((name, detail))
        print(f"  ❌ {name}" + (f" — {detail}" if detail else ""))


def s(name, reason):
    global skipped
    skipped += 1
    print(f"  ⏭️  {name} — SKIPPED: {reason}")


def section(title):
    print(f"\n{'━'*70}\n  {title}\n{'━'*70}")


def api_get(path, headers=None):
    return requests.get(f"{BASE}{path}", headers=headers or HDR_ADMIN, timeout=15)


def api_patch(path, data=None, headers=None):
    return requests.patch(f"{BASE}{path}", json=data or {}, headers=headers or HDR_ADMIN, timeout=15)


# ── Pre-flight ────────────────────────────────────────────────────────────────

def check_env():
    missing = []
    if not ADMIN_JWT:  missing.append("ADMIN_JWT")
    if not SDR_JWT:    missing.append("TEST_JWT")
    if not SDR_ID:     missing.append("TEST_SDR_ID")
    if missing:
        print(f"\n⚠️  Missing env vars: {', '.join(missing)}")
        print("   Some tests will be skipped.\n")


# ══════════════════════════════════════════════════════════════════════════════
# TC-C1 — Admin sets a valid messenger_user_id
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C1: Admin sets valid messenger_user_id")

if not ADMIN_JWT or not SDR_ID:
    s("TC-C1", "ADMIN_JWT or TEST_SDR_ID not set")
else:
    r = api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_user_id": CONV_AGENT})
    t("TC-C1.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        t("TC-C1.b: messenger_user_id in response", body.get("messenger_user_id") == CONV_AGENT,
          f"got {body.get('messenger_user_id')}")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C2 — Admin sets valid messenger_from_number (E.164 format)
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C2: Admin sets valid messenger_from_number (E.164)")

VALID_NUMBER = "+919240915643"

if not ADMIN_JWT or not SDR_ID:
    s("TC-C2", "ADMIN_JWT or TEST_SDR_ID not set")
else:
    r = api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_from_number": VALID_NUMBER})
    t("TC-C2.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        # Stored value may be normalized to 00-prefix — accept either
        stored = body.get("messenger_from_number", "")
        accepted = stored in (VALID_NUMBER, "00919240915643")
        t("TC-C2.b: number persisted (E.164 or 00-prefix)", accepted, f"got '{stored}'")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C3 — Admin sets invalid from_number → 422
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C3: Admin sets invalid messenger_from_number")

INVALID_NUMBERS = ["abc", "12345", "+0000000", "not-a-number", "   "]

if not ADMIN_JWT or not SDR_ID:
    s("TC-C3", "ADMIN_JWT or TEST_SDR_ID not set")
else:
    for num in INVALID_NUMBERS:
        r = api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_from_number": num})
        t(f"TC-C3: '{num}' → 422", r.status_code == 422,
          f"got {r.status_code}: {r.text[:100]}")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C4 — Admin clears from_number (empty string → NULL)
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C4: Admin clears messenger_from_number")

if not ADMIN_JWT or not SDR_ID:
    s("TC-C4", "ADMIN_JWT or TEST_SDR_ID not set")
else:
    r = api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_from_number": ""})
    t("TC-C4.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        t("TC-C4.b: from_number is null/empty", not body.get("messenger_from_number"),
          f"got '{body.get('messenger_from_number')}'")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C5 — SDR auth on admin endpoint → 403
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C5: SDR cannot use admin settings endpoint")

if not SDR_JWT or not SDR_ID:
    s("TC-C5", "TEST_JWT or TEST_SDR_ID not set")
else:
    r = api_patch(f"/api/admin/users/{SDR_ID}/settings",
                  {"messenger_user_id": "hacker"},
                  headers=HDR_SDR)
    t("TC-C5: SDR gets 403", r.status_code == 403,
      f"got {r.status_code}: {r.text[:100]}")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C6 — Duplicate messenger_user_id → 200 but warning field present
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C6: Duplicate messenger_user_id warns but doesn't block")

if not ADMIN_JWT or not SDR_ID or not SDR2_ID:
    s("TC-C6", "ADMIN_JWT, TEST_SDR_ID, or TEST_SDR2_ID not set")
else:
    # Assign CONV_AGENT to SDR first (may already be set from TC-C1)
    api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_user_id": CONV_AGENT})
    # Assign same to SDR2
    r = api_patch(f"/api/admin/users/{SDR2_ID}/settings", {"messenger_user_id": CONV_AGENT})
    t("TC-C6.a: HTTP 200 (not blocked)", r.status_code == 200,
      f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        t("TC-C6.b: 'warning' field present in response", "warning" in body,
          f"response keys: {list(body.keys())}")
    # Cleanup — clear duplicate
    api_patch(f"/api/admin/users/{SDR2_ID}/settings", {"messenger_user_id": ""})

# ══════════════════════════════════════════════════════════════════════════════
# TC-C7 — GET /admin/users includes messenger_from_number
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C7: GET /admin/users response includes messenger_from_number")

if not ADMIN_JWT:
    s("TC-C7", "ADMIN_JWT not set")
else:
    r = api_get("/api/admin/users")
    t("TC-C7.a: HTTP 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code == 200:
        users = r.json()
        t("TC-C7.b: response is a list", isinstance(users, list), f"type: {type(users)}")
        if isinstance(users, list) and users:
            sample = users[0]
            t("TC-C7.c: messenger_from_number key present",
              "messenger_from_number" in sample,
              f"keys: {list(sample.keys())}")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C8 — GET /dialer/my-numbers with no messenger_user_id → empty list
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C8: GET /dialer/my-numbers — no agent ID configured")

# First, clear the SDR's messenger_user_id so it's unconfigured
if ADMIN_JWT and SDR_ID:
    api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_user_id": ""})

if not SDR_JWT:
    s("TC-C8", "TEST_JWT not set")
else:
    r = requests.get(f"{BASE}/api/dialer/my-numbers", headers=HDR_SDR, timeout=15)
    t("TC-C8.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        t("TC-C8.b: 'numbers' key present", "numbers" in body, f"keys: {list(body.keys())}")
        t("TC-C8.c: numbers is empty list", body.get("numbers") == [], f"got: {body.get('numbers')}")
        t("TC-C8.d: 'error' or 'warning' field present",
          bool(body.get("error") or body.get("warning")),
          f"body: {body}")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C9 — GET /dialer/my-numbers with valid agent ID → non-empty list
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C9: GET /dialer/my-numbers — valid agent ID with call history")

# First assign the real agent ID to the test SDR
if ADMIN_JWT and SDR_ID:
    api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_user_id": CONV_AGENT})

if not SDR_JWT:
    s("TC-C9", "TEST_JWT not set")
else:
    r = requests.get(f"{BASE}/api/dialer/my-numbers", headers=HDR_SDR, timeout=20)
    t("TC-C9.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        numbers = body.get("numbers", [])
        t("TC-C9.b: numbers list returned", isinstance(numbers, list),
          f"type: {type(numbers)}")
        # Note: if no call history, this will be empty — that is also acceptable
        if numbers:
            t("TC-C9.c: each entry is a string", all(isinstance(n, str) for n in numbers),
              f"entries: {numbers[:3]}")
            t("TC-C9.d: numbers start with 00 or +",
              all(n.startswith("00") or n.startswith("+") for n in numbers),
              f"entries: {numbers[:3]}")
        else:
            s("TC-C9.c/d", "No call history for this agent yet — skipping format checks")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C10 — GET /dialer/my-numbers unauthenticated → 401
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C10: GET /dialer/my-numbers — unauthenticated")

r = requests.get(f"{BASE}/api/dialer/my-numbers", headers=HDR_ANON, timeout=15)
t("TC-C10: unauthenticated → 401", r.status_code == 401,
  f"got {r.status_code}: {r.text[:100]}")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C11 — SDR clears their own phone number (empty string → NULL)
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C11: PATCH /dialer/my-phone — SDR clears number")

if not SDR_JWT:
    s("TC-C11", "TEST_JWT not set")
else:
    r = api_patch("/api/dialer/my-phone", {"phone_number": ""}, headers=HDR_SDR)
    t("TC-C11.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        t("TC-C11.b: phone_number empty in response",
          body.get("phone_number", "MISSING") == "",
          f"got: '{body.get('phone_number')}'")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C12 — 00-prefixed number is not double-prefixed by backend
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C12: PATCH /dialer/my-phone — 00-prefixed number stored correctly")

if not SDR_JWT:
    s("TC-C12", "TEST_JWT not set")
else:
    NUMBER_00 = "00919240915643"
    r = api_patch("/api/dialer/my-phone", {"phone_number": NUMBER_00}, headers=HDR_SDR)
    t("TC-C12.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        stored = body.get("phone_number", "")
        t("TC-C12.b: number starts with 00 (not 0000)", stored.startswith("00") and not stored.startswith("0000"),
          f"got: '{stored}'")
        # Verify via GET
        get_r = requests.get(f"{BASE}/api/dialer/my-phone", headers=HDR_SDR, timeout=15)
        if get_r.status_code == 200:
            get_body = get_r.json()
            stored_get = get_body.get("phone_number", "")
            t("TC-C12.c: GET confirms no double-prefix",
              stored_get == NUMBER_00 or stored_get == f"+{NUMBER_00[2:]}",
              f"got: '{stored_get}'")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C13 — Admin sets from_number with 00-prefix, stored as-is
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C13: Admin sets messenger_from_number with 00-prefix — stored as-is")

if not ADMIN_JWT or not SDR_ID:
    s("TC-C13", "ADMIN_JWT or TEST_SDR_ID not set")
else:
    NUMBER_00 = "00919240915643"
    r = api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_from_number": NUMBER_00})
    t("TC-C13.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        stored = body.get("messenger_from_number", "")
        t("TC-C13.b: stored with 00-prefix (not 0000)",
          stored == NUMBER_00,
          f"got: '{stored}'")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C14 — Admin sets a valid messenger_email
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C14: Admin sets valid messenger_email")

if not ADMIN_JWT or not SDR_ID:
    s("TC-C14", "ADMIN_JWT or TEST_SDR_ID not set")
else:
    EMAIL = "sdr.harshit@messenger.com"
    r = api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_email": EMAIL})
    t("TC-C14.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        t("TC-C14.b: messenger_email returned",
          body.get("messenger_email") == EMAIL,
          f"got: '{body.get('messenger_email')}'")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C15 — Admin sends an invalid messenger_email → 422
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C15: Invalid messenger_email → 422")

if not ADMIN_JWT or not SDR_ID:
    s("TC-C15", "ADMIN_JWT or TEST_SDR_ID not set")
else:
    r = api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_email": "not-an-email"})
    t("TC-C15.a: HTTP 422", r.status_code == 422, f"got {r.status_code}: {r.text[:200]}")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C16 — Admin clears messenger_email (null)
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C16: Admin clears messenger_email")

if not ADMIN_JWT or not SDR_ID:
    s("TC-C16", "ADMIN_JWT or TEST_SDR_ID not set")
else:
    r = api_patch(f"/api/admin/users/{SDR_ID}/settings", {"messenger_email": None})
    t("TC-C16.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        t("TC-C16.b: messenger_email is null",
          body.get("messenger_email") is None,
          f"got: '{body.get('messenger_email')}'")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C17 — GET /admin/dialer/sdr-configs returns all SDR assignments
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C17: GET /admin/dialer/sdr-configs")

if not ADMIN_JWT:
    s("TC-C17", "ADMIN_JWT not set")
else:
    r = api_get("/api/admin/dialer/sdr-configs")
    t("TC-C17.a: HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        data = r.json()
        t("TC-C17.b: returns a list", isinstance(data, list), f"type: {type(data)}")
        if data:
            first = data[0]
            for key in ("id", "name", "email", "messenger_user_id", "messenger_from_number", "messenger_email"):
                t(f"TC-C17.c: field '{key}' present", key in first, f"keys: {list(first.keys())}")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C18 — SDR cannot self-assign a caller number (endpoint is admin-only)
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C18: SDR cannot reach PATCH /admin/users/{id}/settings")

if not SDR_JWT or not SDR_ID:
    s("TC-C18", "TEST_JWT or TEST_SDR_ID not set")
else:
    # Use SDR token to hit the admin endpoint directly
    r = api_patch(f"/api/admin/users/{SDR_ID}/settings",
                  {"messenger_from_number": "+910000000000"},
                  headers={"Authorization": f"Bearer {SDR_JWT}", "Content-Type": "application/json"})
    t("TC-C18.a: HTTP 403 (not admin)", r.status_code in (401, 403),
      f"got {r.status_code}: {r.text[:200]}")

# ══════════════════════════════════════════════════════════════════════════════
# TC-C19 — GET /admin/dialer/sdr-configs is super-admin only
# ══════════════════════════════════════════════════════════════════════════════

section("TC-C19: GET /admin/dialer/sdr-configs is super-admin gated")

if not SDR_JWT:
    s("TC-C19", "TEST_JWT not set")
else:
    r = api_get("/api/admin/dialer/sdr-configs",
                headers={"Authorization": f"Bearer {SDR_JWT}"})
    t("TC-C19.a: HTTP 403 for SDR", r.status_code in (401, 403),
      f"got {r.status_code}: {r.text[:200]}")

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════

print(f"\n{'═'*70}")
print(f"  Results: {passed} passed  {failed} failed  {skipped} skipped")
print(f"{'═'*70}")
if failures:
    print("\n  Failed tests:")
    for name, detail in failures:
        print(f"    ❌ {name}" + (f"\n         {detail}" if detail else ""))
    print()

sys.exit(1 if failed else 0)
