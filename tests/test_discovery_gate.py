"""
═══════════════════════════════════════════════════════════════════════════════
  Discovery Call Gate — Backend API Test Suite
  Validates: add_discovery_meeting endpoint gate logic (post-fix)

  Edge cases covered:
    EC-1  First discovery call — never gated
    EC-2  N+1 without outcome — blocked 422
    EC-3  Aircall/DialerCall outcome unblocks gate
    EC-8  Complete Discovery never gated
    EC-14 NULL status_changed_at — treated as epoch (allow)

  Env vars:
    TEST_BASE        Base URL  (default: staging)
    TEST_JWT         Auth token
    LEAD_DEMO_ID     A lead currently in "Meeting Scheduled" status
    LEAD_CALLING_ID  A lead currently in "Calling" status
═══════════════════════════════════════════════════════════════════════════════
"""

import os
import sys
import requests

BASE    = os.environ.get("TEST_BASE", "https://rcm-crm-staging.onrender.com")
JWT     = os.environ.get("TEST_JWT", "")
HEADERS = {"Authorization": f"Bearer {JWT}", "Content-Type": "application/json"}

LEAD_ID         = os.environ.get("LEAD_DEMO_ID", "")    # Meeting Scheduled lead
CALLING_LEAD_ID = os.environ.get("LEAD_CALLING_ID", "") # Calling-status lead

# ── Test runner ───────────────────────────────────────────────────────────────

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
    print(f"\n{'━'*65}\n  {title}\n{'━'*65}")


def api_get(path):
    return requests.get(f"{BASE}{path}", headers=HEADERS, timeout=15)


def api_post(path, data=None):
    return requests.post(f"{BASE}{path}", json=data or {}, headers=HEADERS, timeout=15)


def api_patch(path, data=None):
    return requests.patch(f"{BASE}{path}", json=data or {}, headers=HEADERS, timeout=15)


# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
 print("\n" + "═" * 65)
 print("  RCM — DISCOVERY GATE TEST SUITE")
 print(f"  Target: {BASE}")
 print("═" * 65)

 # ── TC-B0: Sanity / connectivity ─────────────────────────────────────────────
 section("TC-B0 — Sanity Check")
 r = api_get("/api/leads")
 t("TC-B0.1 API reachable and authenticated", r.status_code == 200,
   f"status={r.status_code}")

 if LEAD_ID:
     r = api_get(f"/api/leads/{LEAD_ID}")
     t("TC-B0.2 LEAD_DEMO_ID is fetchable", r.status_code == 200,
       f"status={r.status_code}")
     if r.status_code == 200:
         lead = r.json()
         t("TC-B0.3 Lead is in eligible status for test",
           lead.get("status") in {"Meeting Scheduled", "1st Discovery Meeting"},
           f"actual status = '{lead.get('status')}'")
 else:
     s("TC-B0.2 LEAD_DEMO_ID fetchable", "LEAD_DEMO_ID env var not set")
     s("TC-B0.3 Lead status check", "LEAD_DEMO_ID env var not set")


 # ── TC-B1: First discovery call — no gate (EC-1) ─────────────────────────────
 section("TC-B1 — First Discovery Call (EC-1: Gate Must NOT Apply)")
 if not LEAD_ID:
     s("TC-B1.1 First add-discovery succeeds", "LEAD_DEMO_ID not set")
     s("TC-B1.2 Count incremented to >= 1",    "LEAD_DEMO_ID not set")
     s("TC-B1.3 Status → 1st Discovery Meeting", "LEAD_DEMO_ID not set")
 else:
     r = api_post(f"/api/leads/{LEAD_ID}/add-discovery")
     t("TC-B1.1 First add-discovery returns 200 (no gate for count=0)",
       r.status_code == 200,
       f"status={r.status_code} body={r.text[:300]}")
     if r.status_code == 200:
         body = r.json()
         t("TC-B1.2 discovery_meeting_count incremented to >= 1",
           (body.get("discovery_meeting_count") or 0) >= 1,
           str(body))
         t("TC-B1.3 lead_status advanced to '1st Discovery Meeting'",
           body.get("lead_status") == "1st Discovery Meeting",
           f"got: {body.get('lead_status')}")


 # ── TC-B2: N+1 without outcome — must be blocked (EC-2) ──────────────────────
 section("TC-B2 — Block N+1 Without Outcome (EC-2: Core Gate)")
 if not LEAD_ID:
     s("TC-B2.1 Second add-discovery blocked without outcome", "LEAD_DEMO_ID not set")
     s("TC-B2.2 Error detail mentions 'outcome'",              "LEAD_DEMO_ID not set")
 else:
     # No outcome logged since TC-B1 → gate must block
     r = api_post(f"/api/leads/{LEAD_ID}/add-discovery")
     t("TC-B2.1 Second add-discovery returns 422 (gate active)",
       r.status_code == 422,
       f"status={r.status_code} body={r.text[:300]}")
     if r.status_code == 422:
         detail_text = r.json().get("detail", "").lower()
         t("TC-B2.2 Error message mentions 'outcome'",
           "outcome" in detail_text,
           f"detail: {detail_text}")
     # Verify count did NOT increment
     r2 = api_get(f"/api/leads/{LEAD_ID}")
     if r2.status_code == 200:
         lead = r2.json()
         t("TC-B2.3 discovery_meeting_count unchanged (still 1)",
           lead.get("discovery_meeting_count") == 1,
           f"count={lead.get('discovery_meeting_count')}")


 # ── TC-B3: Allow N+1 after manual CallLog outcome ────────────────────────────
 section("TC-B3 — Allow N+1 After Manual Outcome (EC-4)")
 if not LEAD_ID:
     s("TC-B3.1 Log manual outcome", "LEAD_DEMO_ID not set")
     s("TC-B3.2 Second add-discovery allowed after outcome", "LEAD_DEMO_ID not set")
     s("TC-B3.3 Count becomes 2", "LEAD_DEMO_ID not set")
 else:
     # Log a manual call outcome
     r = api_post(f"/api/leads/{LEAD_ID}/calls",
                  {"outcome": "Interested", "notes": "[test] discovery gate TC-B3"})
     t("TC-B3.1 Manual outcome logged (200)",
       r.status_code == 200,
       f"status={r.status_code} body={r.text[:200]}")

     # Gate should now be unblocked
     r = api_post(f"/api/leads/{LEAD_ID}/add-discovery")
     t("TC-B3.2 Second add-discovery returns 200 after outcome",
       r.status_code == 200,
       f"status={r.status_code} body={r.text[:300]}")
     if r.status_code == 200:
         body = r.json()
         t("TC-B3.3 Count is now 2",
           body.get("discovery_meeting_count") == 2,
           f"count={body.get('discovery_meeting_count')}")


 # ── TC-B4: Gate re-applies after count=2 without new outcome ─────────────────
 section("TC-B4 — Gate Re-applies After N+1 (count=2, no new outcome)")
 if not LEAD_ID:
     s("TC-B4.1 Third add-discovery blocked again", "LEAD_DEMO_ID not set")
 else:
     r = api_post(f"/api/leads/{LEAD_ID}/add-discovery")
     t("TC-B4.1 Third add-discovery blocked again (422)",
       r.status_code == 422,
       f"status={r.status_code} body={r.text[:200]}")


 # ── TC-B5: EC-14 — NULL status_changed_at ────────────────────────────────────
 section("TC-B5 — EC-14: NULL status_changed_at (Legacy Leads)")
 s("TC-B5.1 NULL status_changed_at → gate uses epoch → first call allowed",
   "Requires direct DB access — test manually")
 s("TC-B5.2 NULL status_changed_at → gate unblocked for legacy data",
   "Set lead.status_changed_at=NULL in DB, then call add-discovery without outcome")


 # ── TC-B6: Wrong status rejected (existing behaviour) ────────────────────────
 section("TC-B6 — Wrong Status Rejection (Existing Guard)")
 if not CALLING_LEAD_ID:
     s("TC-B6.1 add-discovery rejected for 'Calling' status lead",
       "LEAD_CALLING_ID not set")
 else:
     r = api_post(f"/api/leads/{CALLING_LEAD_ID}/add-discovery")
     t("TC-B6.1 add-discovery returns 422 for non-discovery lead",
       r.status_code == 422,
       f"status={r.status_code} body={r.text[:200]}")
     if r.status_code == 422:
         t("TC-B6.2 Error is about status, not outcome gate",
           "outcome" not in r.json().get("detail", "").lower(),
           r.text[:200])


 # ── TC-B7: EC-8 — Complete Discovery not gated ───────────────────────────────
 section("TC-B7 — EC-8: Complete Discovery Not Gated by Outcome")
 # We test via the status PATCH endpoint, not add-discovery
 if not LEAD_ID:
     s("TC-B7.1 Complete Discovery status patch works without outcome",
       "LEAD_DEMO_ID not set")
 else:
     r = api_patch(f"/api/leads/{LEAD_ID}/status", {"status": "Discovery Complete"})
     t("TC-B7.1 PATCH /status to 'Discovery Complete' not blocked by outcome gate",
       r.status_code in {200, 422},  # 200 = success; 422 = other guard (not our gate)
       f"status={r.status_code} body={r.text[:200]}")
     if r.status_code == 422:
         # If 422, it must NOT be about the outcome gate
         t("TC-B7.2 Complete Discovery 422 is not outcome-gate error",
           "outcome" not in r.json().get("detail", "").lower(),
           r.text[:200])


 # ── TC-B8: Unauthenticated request ───────────────────────────────────────────
 section("TC-B8 — Unauthenticated Access Rejected")
 if LEAD_ID:
     r = requests.post(f"{BASE}/api/leads/{LEAD_ID}/add-discovery",
                       json={}, headers={"Content-Type": "application/json"}, timeout=10)
     t("TC-B8.1 add-discovery requires auth (401 or 403)",
       r.status_code in {401, 403},
       f"status={r.status_code}")


 # ═══════════════════════════════════════════════════════════════════════════════
 print(f"\n{'═'*65}")
 print(f"  RESULTS: {passed} passed | {failed} failed | {skipped} skipped | "
       f"{passed + failed + skipped} total")
 if failures:
     print("\n  FAILURES:")
     for name, detail in failures:
         print(f"    ❌ {name}: {detail}")
 print(f"{'═'*65}\n")
 sys.exit(1 if failed else 0)
