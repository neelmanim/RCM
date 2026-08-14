"""
Live API validation for RCM Converse Desk integration.
Run directly: python3 tests/test_rcm_api_live.py

Tests (in order):
  1. Auth  — HMAC authenticate, get JWT + session cookies
  2. Templates — POST /filter_templates (correct payload)
  3. Session state — GET /converse_desk/conversation for lead phone
  4. Send (DRY RUN) — build the payload but skip actual send
  5. Send (LIVE) — POST /converse_desk/converse (opt-in via --send flag)
"""

import sys
import argparse
import json
sys.path.insert(0, ".")

from rcm_conversations_service import RCMConversationsService

# ── Credentials ───────────────────────────────────────────────────────────────
API_KEY    = "c05bd8bbe2f3acc636fa86cbc6933d7a"
USER_ID    = "355746"
ACCOUNT_ID = "80054247"

# Test lead — use the Neelmani conversation (ourselves) so we can see results in UI
TEST_PHONE     = "919545455721"
TEST_SENDER_ID = "918956778474"


def sep(title: str):
    print(f"\n{'─'*60}")
    print(f"  {title}")
    print('─'*60)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--send", action="store_true",
                        help="Actually send a message (default: dry-run only)")
    args = parser.parse_args()

    svc = RCMConversationsService(API_KEY, USER_ID, ACCOUNT_ID)

    # ── 1. AUTH ───────────────────────────────────────────────────────────────
    sep("TEST 1 — Authentication")
    try:
        token = svc._authenticate()
        print(f"✅ JWT obtained: {token[:40]}...")
        print(f"   Cookies set: {[c.name for c in svc._jar]}")
    except Exception as e:
        print(f"❌ Auth failed: {e}")
        sys.exit(1)

    # ── 2. LIST CONVERSATIONS ─────────────────────────────────────────────────
    sep("TEST 2 — List conversations (all statuses)")
    try:
        convs = svc.get_conversations_for_lead(TEST_PHONE)
        print(f"✅ Found {len(convs)} conversation(s) for {TEST_PHONE}")
        for c in convs:
            print(f"   id={c.id} channel={c.channel} status={c.status} "
                  f"is_live={c.is_live} last_dir={c.last_message_direction}")
    except Exception as e:
        print(f"❌ List conversations failed: {e}")

    # ── 3. SESSION STATE ──────────────────────────────────────────────────────
    sep("TEST 3 — Session state check")
    try:
        state = svc.get_session_state(TEST_PHONE, TEST_SENDER_ID, channel="whatsapp")
        print(f"✅ Session state resolved:")
        print(f"   conversation_id  = {state.conversation_id}")
        print(f"   requires_template = {state.requires_template}")
        print(f"   is_live           = {state.is_live}")
        print(f"   last_direction    = {state.last_direction!r}")
    except Exception as e:
        print(f"❌ Session state failed: {e}")

    # ── 4. TEMPLATES ──────────────────────────────────────────────────────────
    sep("TEST 4 — Fetch WhatsApp templates")
    templates = []
    try:
        templates = svc.get_whatsapp_templates()
        print(f"✅ Found {len(templates)} WhatsApp MTM template(s):")
        for t in templates:
            print(f"   [{t.id}] {t.name}")
            print(f"         {t.template_text[:80]}...")
    except Exception as e:
        print(f"❌ Template fetch failed: {e}")

    # ── 5. SEND (dry-run or live) ─────────────────────────────────────────────
    sep(f"TEST 5 — Send via /converse_desk/converse ({'LIVE' if args.send else 'DRY RUN'})")

    if not templates:
        print("⚠️  No templates available — skipping send test.")
    else:
        template = next((t for t in templates if t.name == "lead_followup_attempt"), templates[0])
        print(f"   Using template: {template.name}")

        # Show the payload we'd send
        import re, uuid
        resolved_text = re.sub(r"\$\{contacts\.first_name\}", "Neelmani", template.template_text)
        u = uuid.uuid4().hex
        temp_id = f"{u[:6]}-{u[6:9]}-{u[9:13]}-{u[13:16]}-{u[16:28]}"

        payload = {
            "channel": "whatsapp",
            "message_text": resolved_text,
            "phone_number": TEST_PHONE,
            "owner_id": int(USER_ID),
            "media_url": "",
            "country_id": "-1",
            "sender_id": TEST_SENDER_ID,
            "conversation_id": state.conversation_id,
            "content": template.content,
            "temp_unique_id": temp_id,
            "reference_type": "contacts",
        }
        print(f"\n   Payload preview:")
        preview = {k: (v[:80] + "..." if isinstance(v, str) and len(v) > 80 else v)
                   for k, v in payload.items() if k != "content"}
        print(json.dumps(preview, indent=4, ensure_ascii=False))

        if args.send:
            try:
                result = svc.send_whatsapp_template(
                    phone=TEST_PHONE,
                    sender_id=TEST_SENDER_ID,
                    template=template,
                    conversation_id=state.conversation_id,
                    contact_first_name="Neelmani",
                )
                print(f"\n✅ Message sent! Response: {json.dumps(result, indent=2)}")
            except Exception as e:
                print(f"\n❌ Send failed: {e}")
        else:
            print(f"\n⚠️  DRY RUN — not sending. Re-run with --send to actually send.")


if __name__ == "__main__":
    main()
