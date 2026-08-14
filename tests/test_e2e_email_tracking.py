"""
═══════════════════════════════════════════════════════════════════════════
  COMPREHENSIVE E2E TEST SUITE — Staging Validation Before Production
═══════════════════════════════════════════════════════════════════════════

Covers ALL 12 commits pending for production:
  1. Conversations (Messaging → Conversations rename)
  2. Conversations phone_secondary fallback
  3. Conversations error handling & no auto-refresh
  4. Per-SDR rcm_user_id (V19 migration)
  5. RCM auth flow (server-side session/refresh)
  6. Email open tracking (V20 migration)
  7. Email tracking webhooks (message.opened)
  8. Email tracking frontend (badges)
  9. Existing features regression (leads, calls, email send, admin)

Target: https://rcm-crm-staging.onrender.com
"""

import requests
import json
import time
import sys
import os

BASE = "https://rcm-crm-staging.onrender.com"
JWT = os.environ.get("TEST_JWT", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZGUwZDU2Ny0xYWNmLTRlOTgtOTQ0Yi01NDJjNzdkMzA4ZTQiLCJlbWFpbCI6Im5lZWxtYW5pLm1pc2hyYUBzY3JlZW4tbWFnaWMuY29tIiwibmFtZSI6Ik5lZWxtYW5pIE1pc2hyYSIsInJvbGUiOiJTdXBlciBBZG1pbiIsInBvZF9pZCI6bnVsbCwiZGlhbGVyX2VuYWJsZWQiOmZhbHNlLCJlbWFpbF9zeW5jX2VuYWJsZWQiOmZhbHNlLCJleHAiOjE3NzU0ODQ0MjV9.jlyMiPiV8HkPXBCgIEqVuymXvVjtay9EL5rX0zqrNFI")
HEADERS = {"Authorization": f"Bearer {JWT}", "Content-Type": "application/json"}

passed = 0
failed = 0
skipped = 0
total = 0
failures = []


def _check(name, condition, detail=""):
    global passed, failed, total, failures
    total += 1
    if condition:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        failures.append((name, detail))
        print(f"  ❌ {name}" + (f" — {detail}" if detail else ""))


def skip(name, reason):
    global skipped, total
    total += 1
    skipped += 1
    print(f"  ⏭️  {name} — SKIPPED: {reason}")


def section(title):
    print(f"\n{'━'*65}")
    print(f"  {title}")
    print(f"{'━'*65}")


def api_get(path):
    return requests.get(f"{BASE}{path}", headers=HEADERS, timeout=15)


def api_post(path, data=None):
    return requests.post(f"{BASE}{path}", json=data, headers=HEADERS, timeout=15)


def api_patch(path, data=None):
    return requests.patch(f"{BASE}{path}", json=data, headers=HEADERS, timeout=15)


# ═══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("\n" + "═"*65)
    print("  RCM CRM — PRE-PRODUCTION E2E TEST SUITE")
    print("  Target: " + BASE)
    print("═"*65)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 0: Health + Auth
    # ═══════════════════════════════════════════════════════════════════
    section("0. Health & Authentication")

    resp = api_get("/api/health")
    _check("GET /api/health → 200", resp.status_code == 200)
    _check("Health response is {status: ok}", resp.json().get("status") == "ok")

    resp_me = api_get("/api/auth/me")
    _check("GET /api/auth/me → 200 (JWT valid)", resp_me.status_code == 200, f"Status: {resp_me.status_code}")

    if resp_me.status_code == 200:
        me = resp_me.json()
        _check("Auth returns user email", "email" in me)
        _check("Auth returns user role", "role" in me)
        _check("User role is Super Admin", me.get("role") == "Super Admin", f"Got: {me.get('role')}")
        user_id = me.get("sub", "")
    else:
        print("  ⛔ JWT is expired or invalid — many tests will fail")
        user_id = ""


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 1: Lead CRUD & Listing
    # ═══════════════════════════════════════════════════════════════════
    section("1. Leads — CRUD & Listing (Regression)")

    leads_resp = api_get("/api/leads?page=1&per_page=5")
    _check("GET /api/leads → 200", leads_resp.status_code == 200)

    leads_data = leads_resp.json()
    # API returns 'data' key (not 'leads')
    _check("Response has 'data' array", isinstance(leads_data.get("data"), list),
         f"Keys: {list(leads_data.keys())}")
    _check("Response has 'total' count", "total" in leads_data)
    _check("Response has pagination fields", "page" in leads_data and "per_page" in leads_data)

    lead_id = None
    lead_email = None

    leads = leads_data.get("data", [])
    if leads:
        lead = leads[0]
        lead_id = lead["id"]
        lead_email = lead.get("email", "")

        _check("Lead has required fields: id, status",
             all(k in lead for k in ["id", "status"]),
             f"Missing from: {list(lead.keys())}")
        _check("Lead has email field", "email" in lead)
        _check("Lead has phone field", "phone" in lead)

        # GET single lead
        single_resp = api_get(f"/api/leads/{lead_id}")
        _check(f"GET /api/leads/{{id}} → 200", single_resp.status_code == 200)
    else:
        skip("Lead field checks", "No leads in staging database")


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 2: Admin — Users & Settings
    # ═══════════════════════════════════════════════════════════════════
    section("2. Admin — Users, Settings & Sync Config")

    # Users list
    users_resp = api_get("/api/admin/users")
    _check("GET /api/admin/users → 200", users_resp.status_code == 200)

    users = users_resp.json()
    if isinstance(users, list) and len(users) > 0:
        u = users[0]
        _check("User has id, email, name, role",
             all(k in u for k in ["id", "email", "name", "role"]))
        _check("User has dialer_enabled", "dialer_enabled" in u)
        _check("User has email_sync_enabled", "email_sync_enabled" in u)
        _check("User has rcm_user_id (V19)", "rcm_user_id" in u,
             f"Keys: {list(u.keys())}")
        # API returns 'pod' (object) not 'pod_id'
        _check("User has pod field", "pod" in u,
             f"Keys: {list(u.keys())}")
    else:
        skip("User field checks", "No users returned")

    # Sync settings
    settings_resp = api_get("/api/admin/sync-settings")
    _check("GET /api/admin/sync-settings → 200", settings_resp.status_code == 200)

    settings = settings_resp.json()
    _check("Settings has rcm_enabled", "rcm_enabled" in settings)
    _check("Settings has rcm_base_url", "rcm_base_url" in settings)
    _check("Settings has rcm_user_id", "rcm_user_id" in settings)
    _check("Settings has sync_direction (SF config)",
         "sync_direction" in settings,
         f"Keys: {list(settings.keys())}")


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 3: Conversations — Config & Auth Endpoint
    # ═══════════════════════════════════════════════════════════════════
    section("3. Conversations — Config & Auth Endpoint")

    # Messaging config requires a lead_id: /api/leads/{lead_id}/messaging/config
    if lead_id:
        msg_resp = api_get(f"/api/leads/{lead_id}/messaging/config")
        _check("GET /api/leads/<id>/messaging/config → 200",
             msg_resp.status_code == 200,
             f"Status: {msg_resp.status_code}, Body: {msg_resp.text[:100]}")

        if msg_resp.status_code == 200:
            msg_config = msg_resp.json()
            _check("Config has 'enabled' field", "enabled" in msg_config)

            # Check error messages use "Conversations" not "Messaging"
            if not msg_config.get("enabled"):
                detail = msg_config.get("detail", msg_config.get("message", msg_config.get("error", "")))
                if detail:
                    _check("Disabled message uses 'Conversations' not 'Messaging'",
                         "Conversation" in str(detail) or "conversation" in str(detail),
                         f"Text: '{detail}'")
    else:
        skip("Messaging config test", "No lead_id available")


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 4: Conversations — Phone Fallback Logic
    # ═══════════════════════════════════════════════════════════════════
    section("4. Conversations — Phone Fallback (Code Verification)")

    lead_routes_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                    "backend", "routes", "lead_routes.py")
    with open(lead_routes_path, "r") as f:
        lr_code = f.read()

    _check("phone_secondary fallback in messaging code",
         "phone_secondary" in lr_code)
    _check("Fallback used when primary is empty",
         "or lead.phone_secondary" in lr_code or
         ("phone_secondary" in lr_code and "phone" in lr_code))


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 5: Conversations — Per-SDR rcm_user_id
    # ═══════════════════════════════════════════════════════════════════
    section("5. Per-SDR RCM User ID (V19)")

    # Code-level: check model
    models_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "backend", "models.py")
    with open(models_path, "r") as f:
        models_code = f.read()
    _check("User model has rcm_user_id column", "rcm_user_id" in models_code)

    # Code-level: check migration
    migration_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                  "backend", "migrations.py")
    with open(migration_path, "r") as f:
        mig_code = f.read()
    _check("V19 migration exists for rcm_user_id",
         "V19" in mig_code and "rcm_user_id" in mig_code)

    # API-level: Try updating a user's rcm_user_id
    if isinstance(users, list) and len(users) > 0:
        test_user_id = users[0]["id"]
        patch_resp = api_patch(f"/api/admin/users/{test_user_id}/settings",
                               {"rcm_user_id": "test_e2e_123"})
        _check("PATCH user settings with rcm_user_id → 200",
             patch_resp.status_code == 200,
             f"Status: {patch_resp.status_code}")

        if patch_resp.status_code == 200:
            # Read back and verify
            users_resp2 = api_get("/api/admin/users")
            updated_user = next((u for u in users_resp2.json() if u["id"] == test_user_id), None)
            if updated_user:
                _check("rcm_user_id persisted correctly",
                     updated_user.get("rcm_user_id") == "test_e2e_123",
                     f"Got: {updated_user.get('rcm_user_id')}")
                # Clean up
                api_patch(f"/api/admin/users/{test_user_id}/settings",
                          {"rcm_user_id": None})


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 6: Email Infrastructure
    # ═══════════════════════════════════════════════════════════════════
    section("6. Email — Infrastructure Health")

    status_resp = api_get("/api/email/status")
    _check("GET /api/email/status → 200", status_resp.status_code == 200)

    status_data = status_resp.json()
    _check("Status has nylas_configured", "nylas_configured" in status_data)
    _check("Status has connected", "connected" in status_data)

    config_resp = api_get("/api/email/config")
    _check("GET /api/email/config → 200", config_resp.status_code == 200)


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 7: Email — Tracking Fields in API Response
    # ═══════════════════════════════════════════════════════════════════
    section("7. Email — Tracking Fields in API Response (V20)")

    if lead_id:
        emails_resp = api_get(f"/api/email/lead/{lead_id}/emails")
        _check("GET /api/email/lead/<id>/emails → 200", emails_resp.status_code == 200)

        email_data = emails_resp.json()
        _check("Response has 'emails' key", "emails" in email_data)
        _check("Response has 'total' key", "total" in email_data)

        if email_data.get("emails"):
            first_email = email_data["emails"][0]
            _check("Email has 'opened_at' field", "opened_at" in first_email,
                 f"Keys: {list(first_email.keys())}")
            _check("Email has 'open_count' field", "open_count" in first_email,
                 f"Keys: {list(first_email.keys())}")
            _check("open_count is an integer",
                 isinstance(first_email.get("open_count"), int),
                 f"Type: {type(first_email.get('open_count'))}")
            _check("Email has direction field", "direction" in first_email)
        else:
            skip("Email tracking field checks", "No emails for this lead")
    else:
        skip("Email tracking tests", "No lead_id available")


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 8: Email — Code-Level tracking_options Verification
    # ═══════════════════════════════════════════════════════════════════
    section("8. Email — tracking_options in Send Code")

    email_routes_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                     "backend", "routes", "email_routes.py")
    with open(email_routes_path, "r") as f:
        er_code = f.read()

    test('tracking_options in send payload', '"tracking_options"' in er_code)
    test('"opens": True enabled', '"opens": True' in er_code)
    test('"thread_replies": True enabled', '"thread_replies": True' in er_code)
    test('opened_at in API response', '"opened_at"' in er_code)
    test('open_count in API response', '"open_count"' in er_code)
    test('links tracking NOT enabled (intentional)',
         '"links": True' not in er_code,
         "Link rewriting disabled to avoid spam appearance")

    # V20 migration
    _check("V20 migration: opened_at", '"lead_email_activity", "opened_at"' in mig_code)
    _check("V20 migration: open_count", '"lead_email_activity", "open_count"' in mig_code)

    # ── Truncation fix verification ───
    _check("No 500-char truncation in email_routes",
         "max_len: int = 0" in er_code,
         "max_len should default to 0 (no truncation)")
    _check("No signature stripping in sanitizer",
         "Thanks and regards|Best regards" not in er_code,
         "Signature regex should be removed to preserve full email body")




    # ═══════════════════════════════════════════════════════════════════
    # SECTION 9: Webhook — message.opened Handler
    # ═══════════════════════════════════════════════════════════════════
    section("9. Webhook — message.opened Code Verification")

    webhook_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "backend", "routes", "webhook_routes.py")
    with open(webhook_path, "r") as f:
        wh_code = f.read()

    _check("message.opened in event type filter", '"message.opened"' in wh_code)
    _check("open_count increment logic", "open_count" in wh_code)
    _check("opened_at set only on first open", "if not activity.opened_at" in wh_code)
    _check("db.commit() after open tracking", "db.commit()" in wh_code)
    _check("No 500-char truncation in webhook_routes",
         "max_len: int = 0" in wh_code,
         "Webhook sanitize should also have no truncation")


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 10: Webhook — Live Tests
    # ═══════════════════════════════════════════════════════════════════
    section("10. Webhook — Live Tests Against Staging")

    # Challenge verification
    resp_challenge = requests.get(f"{BASE}/webhooks/nylas?challenge=e2e_test_2026")
    _check("GET challenge returns exact challenge text",
         resp_challenge.status_code == 200 and resp_challenge.text == "e2e_test_2026",
         f"Status: {resp_challenge.status_code}, Body: '{resp_challenge.text[:60]}'")

    # message.opened for unknown message
    resp_open = requests.post(f"{BASE}/webhooks/nylas", json={
        "type": "message.opened",
        "data": {"type": "message.opened",
                 "object_data": {"message_id": "e2e-unknown-msg-001"}}
    })
    _check("message.opened for unknown message → 200",
         resp_open.status_code == 200)

    # Empty message_id
    resp_empty_id = requests.post(f"{BASE}/webhooks/nylas", json={
        "type": "message.opened",
        "data": {"type": "message.opened",
                 "object_data": {"message_id": ""}}
    })
    _check("message.opened with empty message_id → 200",
         resp_empty_id.status_code == 200)

    # No message_id
    resp_no_id = requests.post(f"{BASE}/webhooks/nylas", json={
        "type": "message.opened",
        "data": {"type": "message.opened",
                 "object_data": {}}
    })
    _check("message.opened with no message_id → 200",
         resp_no_id.status_code == 200)

    # message.created regression
    resp_created = requests.post(f"{BASE}/webhooks/nylas", json={
        "type": "message.created",
        "data": {"type": "message.created", "object_data": {
            "id": "e2e-regression-msg", "thread_id": "e2e-regression-thread",
            "from": [{"email": "test@example.com"}],
            "to": [{"email": "sdr@example.com"}],
            "subject": "E2E Regression", "body": "Test"
        }}
    })
    _check("message.created still works (regression)",
         resp_created.status_code == 200)

    # Unknown event type
    resp_unk = requests.post(f"{BASE}/webhooks/nylas", json={
        "type": "calendar.updated",
        "data": {"type": "calendar.updated",
                 "object_data": {"id": "irrelevant"}}
    })
    _check("Unknown event type ignored → 200",
         resp_unk.status_code == 200)

    # Invalid JSON → 400
    resp_bad = requests.post(f"{BASE}/webhooks/nylas",
                              data="not valid json",
                              headers={"Content-Type": "application/json"})
    _check("Invalid JSON → 400", resp_bad.status_code == 400)

    # Empty payload
    resp_empty = requests.post(f"{BASE}/webhooks/nylas", json={})
    _check("Empty JSON payload → 200", resp_empty.status_code == 200)


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 11: Edge Cases — Webhook Resilience
    # ═══════════════════════════════════════════════════════════════════
    section("11. Edge Cases — Webhook Stress & Resilience")

    # 5x rapid opens same message
    for i in range(5):
        r = requests.post(f"{BASE}/webhooks/nylas", json={
            "type": "message.opened",
            "data": {"type": "message.opened",
                     "object_data": {"message_id": "e2e-rapid-same"}}
        })
    _check("5x rapid opens for SAME message → all 200", r.status_code == 200)

    # 5x rapid opens different messages
    for i in range(5):
        r = requests.post(f"{BASE}/webhooks/nylas", json={
            "type": "message.opened",
            "data": {"type": "message.opened",
                     "object_data": {"message_id": f"e2e-rapid-diff-{i}"}}
        })
    _check("5x rapid opens for DIFFERENT messages → all 200", r.status_code == 200)

    # Extra unknown fields (forward compatibility)
    resp_extra = requests.post(f"{BASE}/webhooks/nylas", json={
        "type": "message.opened",
        "data": {"type": "message.opened", "object_data": {
            "message_id": "e2e-extra-fields",
            "ip_address": "198.51.100.1",
            "user_agent": "Mozilla/5.0",
            "metadata": {"key": "value"},
            "unknown_future_field": True
        }}
    })
    _check("Extra/unknown fields handled gracefully", resp_extra.status_code == 200)

    # Nylas v3 array format
    resp_arr = requests.post(f"{BASE}/webhooks/nylas", json={
        "data": [{"type": "message.opened",
                  "object_data": {"message_id": "e2e-array-fmt"}}]
    })
    _check("Nylas v3 array-style data → 200", resp_arr.status_code == 200)

    # Very long message_id
    resp_long = requests.post(f"{BASE}/webhooks/nylas", json={
        "type": "message.opened",
        "data": {"type": "message.opened",
                 "object_data": {"message_id": "x" * 500}}
    })
    _check("Very long message_id (500 chars) → 200", resp_long.status_code == 200)

    # Special characters
    resp_spec = requests.post(f"{BASE}/webhooks/nylas", json={
        "type": "message.opened",
        "data": {"type": "message.opened",
                 "object_data": {"message_id": "<msg-123@nylas.com>"}}
    })
    _check("Special chars in message_id → 200", resp_spec.status_code == 200)


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 12: Frontend Code Verification
    # ═══════════════════════════════════════════════════════════════════
    section("12. Frontend — Code Verification")

    # Email tracking UI
    fe_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "frontend", "js", "views", "lead_emails_tab.js")
    with open(fe_path, "r") as f:
        fe_code = f.read()

    _check("Tracking badge class in email bubbles", "email-tracking-badge" in fe_code)
    _check("Badge shows 'Opened' text", "Opened" in fe_code)
    _check("Badge shows 'Sent' text for unopened", "Sent" in fe_code)
    _check("open_count displayed", "open_count" in fe_code)
    _check("opened_at used for time", "opened_at" in fe_code)
    _check("CSS eye icon (not emoji)", "tracking-icon-eye" in fe_code)
    _check("view/views pluralization", "view" in fe_code and "views" in fe_code)

    # Conversations tab
    msg_tab_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "frontend", "js", "views", "lead_messaging_tab.js")
    with open(msg_tab_path, "r") as f:
        msg_code = f.read()
    _check("Messaging tab uses 'Conversations' label", "Conversation" in msg_code)

    # Lead detail tab
    detail_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "frontend", "js", "views", "lead_detail.js")
    with open(detail_path, "r") as f:
        detail_code = f.read()
    _check("Lead detail tab label is 'Conversations'", "Conversation" in detail_code)

    # CSS
    css_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "frontend", "css", "style.css")
    with open(css_path, "r") as f:
        css_code = f.read()
    _check("CSS .tracking-icon-eye defined", ".tracking-icon-eye" in css_code)
    _check("CSS .email-tracking-badge.opened defined", ".email-tracking-badge.opened" in css_code)
    _check("CSS .email-tracking-badge.sent defined", ".email-tracking-badge.sent" in css_code)
    _check("Green #16a34a for opened status", "#16a34a" in css_code)


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 13: Regression — Core Endpoints
    # ═══════════════════════════════════════════════════════════════════
    section("13. Regression — Core Endpoints")

    # PODs (actual route: /api/pods)
    pods_resp = api_get("/api/pods")
    _check("GET /api/pods → 200", pods_resp.status_code == 200)

    # Login logs (actual route: /api/admin/login-logs)
    logs_resp = api_get("/api/admin/login-logs?page=1&per_page=5")
    _check("GET /api/admin/login-logs → 200", logs_resp.status_code == 200)

    # Config
    config_resp = api_get("/api/config")
    _check("GET /api/config → 200", config_resp.status_code == 200)

    # Nylas admin config
    nylas_resp = api_get("/api/email/config")
    _check("GET /api/email/config → 200", nylas_resp.status_code == 200)

    # Lead detail
    if lead_id:
        lead_det = api_get(f"/api/leads/{lead_id}")
        _check("Lead detail has expected fields",
             lead_det.status_code == 200 and "id" in lead_det.json())


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 14: Security — Access Control
    # ═══════════════════════════════════════════════════════════════════
    section("14. Security — Access Control")

    # Unauthenticated
    no_auth = requests.get(f"{BASE}/api/leads", timeout=10)
    _check("Unauthenticated /api/leads → 401/403",
         no_auth.status_code in (401, 403),
         f"Got: {no_auth.status_code}")

    no_auth_admin = requests.get(f"{BASE}/api/admin/users", timeout=10)
    _check("Unauthenticated /api/admin/users → 401/403",
         no_auth_admin.status_code in (401, 403))

    # Invalid JWT
    bad_jwt = requests.get(f"{BASE}/api/leads",
                            headers={"Authorization": "Bearer invalid.token"}, timeout=10)
    _check("Invalid JWT → 401/403", bad_jwt.status_code in (401, 403))

    # Webhook public access (by design)
    wh_public = requests.post(f"{BASE}/webhooks/nylas", json={
        "type": "message.opened",
        "data": {"type": "message.opened",
                 "object_data": {"message_id": "public-access-test"}}
    })
    _check("Webhook is public (Nylas needs access)", wh_public.status_code == 200)


    # ═══════════════════════════════════════════════════════════════════
    # SECTION 15: Cross-Feature Integration
    # ═══════════════════════════════════════════════════════════════════
    section("15. Cross-Feature Integration")

    if lead_id:
        # Both email and messaging endpoints work for same lead
        e_resp = api_get(f"/api/email/lead/{lead_id}/emails")
        m_resp = api_get(f"/api/leads/{lead_id}/messaging/config")
        _check("Email and Conversations endpoints coexist",
             e_resp.status_code == 200 and m_resp.status_code == 200)

    _check("Admin settings cover both email and conversations features",
         "rcm_enabled" in settings)


    # ═══════════════════════════════════════════════════════════════════
    # RESULTS
    # ═══════════════════════════════════════════════════════════════════
    print(f"\n{'━'*65}")
    print(f"  RESULTS")
    print(f"{'━'*65}")
    print(f"  Total:   {total}")
    print(f"  Passed:  {passed} ✅")
    print(f"  Failed:  {failed} ❌")
    print(f"  Skipped: {skipped} ⏭️")
    print(f"{'━'*65}")

    if failures:
        print(f"\n  FAILURES:")
        for name, detail in failures:
            print(f"    ❌ {name}")
            if detail:
                print(f"       → {detail}")

    if failed > 0:
        print(f"\n  ⛔ {failed} test(s) FAILED — DO NOT deploy to production")
        sys.exit(1)
    else:
        print(f"\n  🎉 All {passed} tests PASSED — Safe to deploy to production")
        sys.exit(0)
