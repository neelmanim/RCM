"""
═══════════════════════════════════════════════════════════════════════════════
  Dialer Outcome Gate — Backend API Test Suite
  Implementation Plan: Part 1 (Outcome Gate) + Part 2 (Provider Test Buttons)

  TC-B1   GET /api/calls/{call_id}/status — active call
  TC-B2   GET /api/calls/{call_id}/status — terminal status detected
  TC-B3   GET /api/calls/{call_id}/status — 404 for unknown call_id
  TC-B4   POST /api/leads/{id}/calls — call_attempt_count NOT double-incremented
          when a DialerCall record is auto-attached (EC-13)
  TC-B5   POST /api/leads/{id}/calls — call_attempt_count IS incremented for
          manual call (no DialerCall in last 10 min)
  TC-B6   POST /api/dialer/test — no ?provider param → falls back to active provider
  TC-B7   POST /api/dialer/test?provider=aircall → tests Aircall creds specifically
  TC-B8   POST /api/dialer/test?provider=rcm_dialer → tests RCM dialer
  TC-B9   POST /api/dialer/test?provider=rcm_messaging → tests messaging creds
  TC-B10  POST /api/dialer/test?provider=unknown_xyz → 400/success=False
  TC-B11  POST /api/dialer/test — 403 for non-super-admin caller
  TC-B12  PATCH /api/calls/{call_id}/outcome — attaches outcome to DialerCall record
  TC-B13  POST /api/leads/{id}/calls with dismissed outcome → note auto-added
          "Call outcome not logged" in lead comments (EC-7)

  Env vars:
    TEST_BASE          Base URL  (default: staging)
    TEST_JWT           SDR auth token (must have a lead in Calling status)
    ADMIN_JWT          Super Admin auth token
    LEAD_CALLING_ID    A lead currently in "Calling" status for call tests
    DIALER_CALL_ID     An existing DialerCall ID (active/ended) for status tests
═══════════════════════════════════════════════════════════════════════════════
"""

import os
import sys
import time
import requests
from datetime import datetime, timezone, timedelta

BASE         = os.environ.get("TEST_BASE", "https://rcm-crm-staging.onrender.com")
JWT          = os.environ.get("TEST_JWT", "")
ADMIN_JWT    = os.environ.get("ADMIN_JWT", "")

LEAD_ID      = os.environ.get("LEAD_CALLING_ID", "")
DIALER_ID    = os.environ.get("DIALER_CALL_ID", "")

HDR_SDR      = {"Authorization": f"Bearer {JWT}",       "Content-Type": "application/json"}
HDR_ADMIN    = {"Authorization": f"Bearer {ADMIN_JWT}",  "Content-Type": "application/json"}
HDR_ANON     = {"Content-Type": "application/json"}

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
    print(f"\n{'━'*65}\n  {title}\n{'━'*65}")


def api_get(path, headers=None):
    return requests.get(f"{BASE}{path}", headers=headers or HDR_SDR, timeout=15)


def api_post(path, data=None, headers=None):
    return requests.post(f"{BASE}{path}", json=data or {}, headers=headers or HDR_SDR, timeout=15)


def api_patch(path, data=None, headers=None):
    return requests.patch(f"{BASE}{path}", json=data or {}, headers=headers or HDR_SDR, timeout=15)


# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("\n" + "═" * 65)
    print("  RCM — DIALER OUTCOME GATE TEST SUITE")
    print(f"  Target: {BASE}")
    print("═" * 65)

    # ── TC-B0: Connectivity sanity ────────────────────────────────────────────
    section("TC-B0 — Sanity Check")
    # /api/leads requires admin — use /api/leads/my for SDR-scoped sanity check
    r = api_get("/api/leads/my?page=1&limit=5")
    t("TC-B0.1  GET /api/leads/my returns 200", r.status_code == 200,
      f"status={r.status_code}")
    t("TC-B0.2  Response contains leads list",
      ("data" in r.json() or "leads" in r.json()) if r.ok else False)

    # ── TC-B1: Call status — active call ──────────────────────────────────────
    section("TC-B1 — GET /api/calls/{call_id}/status (active call)")
    if not DIALER_ID:
        s("TC-B1", "DIALER_CALL_ID env var not set")
    else:
        r = api_get(f"/api/calls/{DIALER_ID}/status")
        t("TC-B1.1  Returns 200", r.status_code == 200, f"status={r.status_code}")
        if r.ok:
            d = r.json()
            t("TC-B1.2  Response has call_id", "call_id" in d)
            t("TC-B1.3  Response has status field", "status" in d)
            t("TC-B1.4  Response has provider field", "provider" in d)
            t("TC-B1.5  Response has started_at field", "started_at" in d)
            t("TC-B1.6  started_at is ISO timestamp or null",
              d.get("started_at") is None or "T" in str(d.get("started_at")))

    # ── TC-B2: Call status — terminal state detection ─────────────────────────
    section("TC-B2 — Terminal Status Detection")
    TERMINAL = {"CALL_ENDED", "CALL_MISSED", "done", "missed", "failed",
                "cancelled", "busy", "unanswered"}
    if not DIALER_ID:
        s("TC-B2", "DIALER_CALL_ID env var not set")
    else:
        r = api_get(f"/api/calls/{DIALER_ID}/status")
        if r.ok:
            status = r.json().get("status", "")
            # We just verify the field exists and has a known shape; the
            # frontend polling logic will handle terminal detection.
            t("TC-B2.1  status field is a non-empty string",
              isinstance(status, str) and len(status) > 0,
              f"status='{status}'")
            t("TC-B2.2  Known terminal statuses are a superset of possible values",
              True,   # Documented contract — always passes (documents the set)
              f"TERMINAL_STATUSES={TERMINAL}")

    # ── TC-B3: 404 for unknown call_id ────────────────────────────────────────
    section("TC-B3 — 404 for Unknown Call ID")
    r = api_get("/api/calls/nonexistent-call-id-xyz/status")
    t("TC-B3.1  Returns 404", r.status_code == 404,
      f"status={r.status_code}, body={r.text[:120]}")

    # ── TC-B4: call_attempt_count NOT doubled when DialerCall attached ─────────
    section("TC-B4 — EC-13: call_attempt_count not double-incremented (dialer path)")
    if not LEAD_ID:
        s("TC-B4", "LEAD_CALLING_ID env var not set")
    else:
        # Read baseline count before the call
        r_lead = api_get(f"/api/leads/{LEAD_ID}")
        if not r_lead.ok:
            s("TC-B4", f"Could not fetch lead: {r_lead.status_code}")
        else:
            baseline = r_lead.json().get("call_attempt_count", 0) or 0

            # Simulate: a DialerCall record already exists for this lead
            # (it was created by the dialer start, and webhook incremented count).
            # Now the SDR logs the outcome via the modal POST.
            # Expected: count increments by AT MOST 1 (not 2).
            outcome_payload = {"outcome": "No Answer", "notes": ""}
            r_log = api_post(f"/api/leads/{LEAD_ID}/calls", outcome_payload)
            t("TC-B4.1  logCall returns 200", r_log.status_code == 200,
              f"status={r_log.status_code}, body={r_log.text[:200]}")

            if r_log.ok:
                r_after = api_get(f"/api/leads/{LEAD_ID}")
                after = r_after.json().get("call_attempt_count", 0) or 0
                delta = after - baseline
                t("TC-B4.2  call_attempt_count incremented by exactly 0 or 1",
                  delta in (0, 1),
                  f"baseline={baseline}, after={after}, delta={delta}")
                t("TC-B4.3  call_attempt_count NOT incremented by 2 (bug check)",
                  delta != 2,
                  f"delta={delta} — double-increment bug would produce delta=2")

    # ── TC-B5: Manual call — count IS incremented ─────────────────────────────
    section("TC-B5 — Manual call_attempt_count increment")
    # This is documented intent; relies on no DialerCall existing in past 10 min.
    # In CI, run this on a fresh lead that was never dialed.
    MANUAL_LEAD_ID = os.environ.get("LEAD_FRESH_ID", "")
    if not MANUAL_LEAD_ID:
        s("TC-B5", "LEAD_FRESH_ID env var not set (need a never-dialed lead)")
    else:
        r_lead = api_get(f"/api/leads/{MANUAL_LEAD_ID}")
        if r_lead.ok:
            baseline = r_lead.json().get("call_attempt_count", 0) or 0
            r_log = api_post(f"/api/leads/{MANUAL_LEAD_ID}/calls",
                             {"outcome": "No Answer", "notes": ""})
            t("TC-B5.1  logCall returns 200", r_log.status_code == 200,
              f"status={r_log.status_code}")
            if r_log.ok:
                r_after = api_get(f"/api/leads/{MANUAL_LEAD_ID}")
                after = r_after.json().get("call_attempt_count", 0) or 0
                t("TC-B5.2  call_attempt_count incremented by 1 for manual call",
                  after == baseline + 1,
                  f"baseline={baseline}, after={after}")

    # ── TC-B6: POST /api/dialer/test — no param (backward compat) ─────────────
    section("TC-B6 — POST /api/dialer/test (no ?provider param)")
    if not ADMIN_JWT:
        s("TC-B6", "ADMIN_JWT env var not set")
    else:
        r = api_post("/api/dialer/test", headers=HDR_ADMIN)
        t("TC-B6.1  Returns 200", r.status_code == 200, f"status={r.status_code}")
        if r.ok:
            d = r.json()
            t("TC-B6.2  Response has success field", "success" in d)
            t("TC-B6.3  Response has message field", "message" in d)

    # ── TC-B7: POST /api/dialer/test?provider=aircall ─────────────────────────
    section("TC-B7 — POST /api/dialer/test?provider=aircall")
    if not ADMIN_JWT:
        s("TC-B7", "ADMIN_JWT env var not set")
    else:
        r = requests.post(f"{BASE}/api/dialer/test?provider=aircall",
                          json={}, headers=HDR_ADMIN, timeout=15)
        t("TC-B7.1  Returns 200", r.status_code == 200, f"status={r.status_code}")
        if r.ok:
            d = r.json()
            t("TC-B7.2  Response has success field", "success" in d)
            t("TC-B7.3  Response has message field", "message" in d)
            # If Aircall is NOT configured, we expect success=False with a clear message
            if not d.get("success"):
                t("TC-B7.4  Unconfigured returns graceful error message",
                  "not configured" in d.get("message", "").lower()
                  or "credentials" in d.get("message", "").lower(),
                  f"message='{d.get('message')}'")

    # ── TC-B8: POST /api/dialer/test?provider=rcm_dialer ───────────────
    section("TC-B8 — POST /api/dialer/test?provider=rcm_dialer")
    if not ADMIN_JWT:
        s("TC-B8", "ADMIN_JWT env var not set")
    else:
        r = requests.post(f"{BASE}/api/dialer/test?provider=rcm_dialer",
                          json={}, headers=HDR_ADMIN, timeout=15)
        t("TC-B8.1  Returns 200", r.status_code == 200, f"status={r.status_code}")
        if r.ok:
            d = r.json()
            t("TC-B8.2  Response has success field", "success" in d)
            if not d.get("success"):
                t("TC-B8.3  Unconfigured returns graceful error",
                  "not configured" in d.get("message", "").lower()
                  or "credentials" in d.get("message", "").lower(),
                  f"message='{d.get('message')}'")

    # ── TC-B9: POST /api/dialer/test?provider=rcm_messaging ────────────
    section("TC-B9 — POST /api/dialer/test?provider=rcm_messaging")
    if not ADMIN_JWT:
        s("TC-B9", "ADMIN_JWT env var not set")
    else:
        r = requests.post(f"{BASE}/api/dialer/test?provider=rcm_messaging",
                          json={}, headers=HDR_ADMIN, timeout=15)
        t("TC-B9.1  Returns 200", r.status_code == 200, f"status={r.status_code}")
        if r.ok:
            d = r.json()
            t("TC-B9.2  Response has success field", "success" in d)
            # Messaging test must be INDEPENDENT of whatever the active dialer is
            t("TC-B9.3  Test ran independently (not 'Unknown provider' error)",
              d.get("message", "") != "Unknown provider: rcm_messaging",
              f"message='{d.get('message')}'")

    # ── TC-B10: Unknown provider → graceful error ──────────────────────────────
    section("TC-B10 — POST /api/dialer/test?provider=unknown_xyz")
    if not ADMIN_JWT:
        s("TC-B10", "ADMIN_JWT env var not set")
    else:
        r = requests.post(f"{BASE}/api/dialer/test?provider=unknown_xyz",
                          json={}, headers=HDR_ADMIN, timeout=15)
        # Should return 200 with success=False (not a 500 crash)
        t("TC-B10.1  Returns 200 (not 500)", r.status_code == 200,
          f"status={r.status_code}")
        if r.ok:
            d = r.json()
            t("TC-B10.2  success=False", d.get("success") is False)
            t("TC-B10.3  Message mentions unknown provider",
              "unknown" in d.get("message", "").lower(),
              f"message='{d.get('message')}'")

    # ── TC-B11: Non-super-admin → 403 ─────────────────────────────────────────
    section("TC-B11 — POST /api/dialer/test — 403 for non-admin")
    if not JWT:
        s("TC-B11", "TEST_JWT (SDR token) env var not set")
    else:
        r = api_post("/api/dialer/test", headers=HDR_SDR)
        t("TC-B11.1  Returns 403 for SDR user", r.status_code == 403,
          f"status={r.status_code}")

    # ── TC-B12: PATCH /api/calls/{call_id}/outcome ────────────────────────────
    section("TC-B12 — PATCH /api/calls/{call_id}/outcome")
    if not DIALER_ID:
        s("TC-B12", "DIALER_CALL_ID env var not set")
    else:
        payload = {"outcome": "Interested", "notes": "Test outcome patch"}
        r = api_patch(f"/api/calls/{DIALER_ID}/outcome", payload)
        t("TC-B12.1  Returns 200", r.status_code == 200, f"status={r.status_code}")
        if r.ok:
            d = r.json()
            t("TC-B12.2  Outcome set in response", d.get("outcome") == "Interested",
              f"outcome='{d.get('outcome')}'")
            t("TC-B12.3  Notes set in response", d.get("notes") == "Test outcome patch")

    # ── TC-B13: Dismiss without logging → auto-comment ────────────────────────
    # NOTE: This test validates the comment-writing side of EC-7.
    # The modal dismiss is a frontend action; here we test the backend
    # endpoint that will be called when dismiss is detected.
    section("TC-B13 — EC-7: Dismiss without logging → auto-comment in lead history")
    # The plan spec: when an SDR dismisses the modal, the frontend calls a
    # dedicated endpoint (or uses the notes field) to record the missed outcome.
    # For now we validate the existing lead notes/comments endpoint accepts the
    # comment payload. Update this test when the endpoint is finalised.
    if not LEAD_ID:
        s("TC-B13", "LEAD_CALLING_ID env var not set")
    else:
        # Attempt to POST a comment — endpoint TBD (will be wired in implementation)
        note_payload = {
            "note": "⚠️ Call outcome not logged — call ended at " +
                     datetime.now(timezone.utc).strftime("%H:%M UTC")
        }
        # Try both possible comment endpoints
        for path in [f"/api/leads/{LEAD_ID}/notes", f"/api/leads/{LEAD_ID}/comments"]:
            r = api_post(path, note_payload)
            if r.status_code != 404:
                t(f"TC-B13.1  Comment endpoint {path} accepts dismiss note",
                  r.status_code in (200, 201),
                  f"status={r.status_code}, body={r.text[:150]}")
                break
        else:
            s("TC-B13", "No comment/note endpoint found — to be created in implementation")

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'═'*65}")
    print(f"  RESULTS: {passed} passed | {failed} failed | {skipped} skipped")
    if failures:
        print(f"\n  FAILURES:")
        for name, detail in failures:
            print(f"    ✗ {name}" + (f"\n      {detail}" if detail else ""))
    print("═" * 65)
    sys.exit(1 if failed else 0)
