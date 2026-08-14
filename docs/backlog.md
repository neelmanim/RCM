# CRM Backlog

Planned features and improvements for future sprints.

---

## 🎮 Dialer Playground — Admin Onboarding Wizard
**Priority:** Medium
**Added:** 2026-06-01
**Status:** 🚫 Hidden (code complete, pending UX review before production)

**Summary:** A 3-step onboarding wizard for Admins to verify RCM credentials, place a live test call, and confirm widget connectivity — all without touching SDR settings.

**What's built (v8.4.0 — commit `704be3d`):**
- `GET /api/dialer/playground` — returns saved global RCM credentials (Admin-only, 403 for others)
- `POST /api/dialer/playground/test-call` — places a test call with overrideable credentials
- `frontend/js/views/playground.js` — full 3-step wizard UI (Step 1: credentials prefill, Step 2: test call, Step 3: confirm)
- Nav item `🎮 Playground` in `index.html` (hidden via `display:none`)

**Why hidden:**
- UX needs review before SDRs or Admins encounter it in production
- The open issue (ad-hoc dial UX — RCM widget panel confusion) should be resolved first

**To re-enable (3 changes in `frontend/js/app.js`):**
1. Uncomment line ~32: `import { renderPlayground } from './views/playground.js';`
2. Uncomment lines ~158–161: playground nav-item `display = 'block'` block
3. Uncomment lines ~278–280: `} else if (viewName === 'playground') { ... }` route

**Backend:** All endpoints are live on staging and production — no backend changes needed.

**Verification checklist (when re-enabling):**
- [ ] Log in as Admin on staging → 🎮 Playground nav visible
- [ ] Step 1: credentials pre-fill from saved settings
- [ ] Step 2: test call succeeds (real RCM dial)
- [ ] Step 3: widget confirmation renders correctly
- [ ] SDRs (non-admin) cannot access `/api/dialer/playground` (403)

---


## 🔔 Browser Notifications for Lead Assignment

**Priority:** Medium  
**Added:** March 23, 2026  
**Status:** Backlog  

**Summary:** Enable browser push notifications for SDRs when a lead is assigned to them (manual, bulk, or round-robin).

**Approach (drafted):**
- Polling-based architecture (30s interval) — fits existing REST stack
- New `Notification` DB model to persist read/unread state
- 🔔 Bell icon in top bar with unread count badge + dropdown panel
- Browser Notifications API for push popups — click to navigate to lead
- Trigger points: `bulk-assign`, `auto-assign-all`, pod assignment

**Detailed plan:** See `implementation_plan.md` from March 23 session.

---

## 📋 Enriched SF Description — Research, Calls & Notes Push
**Priority:** Medium  
**Added:** March 23, 2026  
**Status:** ✅ Deployed to Staging  

**Summary:** Push SDR research data, call history, and notes into the SF Lead `Description` field (standard, 32K chars) as a structured, business-readable summary for sales handoff.

**Approach:**
- Build structured Description with labelled sections: Lead Summary, SDR Research, Outreach Strategy, Call History, SDR Notes, Opportunity Context
- Only include sections that have data — no empty sections
- Structured fields (title, industry, location, etc.) stay in their own SF fields (already deployed in v3.5.1)
- Narrative data (research, calls, notes) consolidated into Description
- Research fields: hypothesis, personalization, company/contact insights, services, hook, channels
- Call history: date, outcome, and notes per call
- SDR notes: timestamped with author

**Reference:** See `sf_field_mapping.md` artifact for full visual breakdown.

---

## ✉️ Customer feedback round — cold-email personalization & tracking gaps
**Priority:** High
**Added:** 2026-08-07
**Status:** Items 1–3 fixed in v10.9.5 (2026-08-13); item 4 likely fixed as a side effect; item 5 remains open.

**Summary:** A batch of issues/requests from a customer actively running outbound campaigns on RCM. Grouped here since they came in as one piece of feedback.

1. ✅ **"RCM by RCM" footer toggle** — fixed in v10.9.5: per-user `hide_branding_in_email` toggle in My Settings, suppresses the footer on sent mail.
2. ✅ **Richer email formatting + hyperlinks** — fixed in v10.9.5: compose is now a rich-text editor (bold/italic/insert-link/insert-image), not a plain textarea.
3. ✅ **Signature images not rendering** — fixed in v10.9.5: a real per-user signature feature was built (didn't exist before at all), with the same allowlist as inbound mail — images and links both render.
4. **Lead record page needs a hard refresh to fully load email tab** — not independently re-verified, but the root cause this session's investigation found for the *related* "reply not showing up" complaint (item 4 below) was that email sync had no scheduler at all, only a page-view trigger — the same architectural gap could easily produce this symptom too. Worth a quick recheck now that v10.9.5's scheduled poller is live before assuming it's still broken.
5. **SMS texting** — both 1-on-1 conversational messaging and automated SMS campaigns. Note: `POST /api/sms/send` (RCM-backed, one-off send-to-lead) already exists (`backend/routes/sms_routes.py`) — the actual gap is automated/sequenced SMS campaigns, not SMS sending itself.

**Gmail-direct tracking — fixed and now live in production (2026-08-07):** rode into `main` along with the Sales Cadence v10.7.0 release (`backend/routes/email_routes.py` — `_sync_thread_messages` no longer skips connected-mailbox senders; `_sync_full_mailbox` mailbox-selection now prefers the lead's assigned SDR). Exercised live against ~40 of Samya Choudhary's real leads (the SDR the original complaint came from) post-deploy — zero errors, but none of her *currently assigned* leads showed a poller-captured message yet, so the fix isn't independently confirmed against her actual reported case. Awaiting either Samya checking her own specific lead directly, or a lead name to check with certainty.

**Update 2026-08-13:** the actual remaining gap was found — matching/mailbox-selection logic above was correct, but there was no scheduler or webhook triggering it at all, only a page-view side effect (`GET /lead/{id}/emails`). Fixed in v10.9.5 with `scheduled_jobs._email_sync_job` (every 5 min, reuses the existing `_sync_full_mailbox` logic unchanged). This should resolve both the original Gmail-direct complaint and item 4 above.

---

## 📞 Power-dialer / sequential-call queue (adoption driver)
**Priority:** High
**Added:** 2026-08-07
**Status:** Idea — not scoped yet

**Summary:** Recurring adoption feedback: SDRs/AEs want to work a list of leads and place calls one-by-one from a single view (à la Klenty's Prospects list — see the screenshot the user shared), instead of opening each lead individually to dial. The single-view tracking ("I placed this call, at this time") is the actual value, not just faster dialing.

**What already exists to build on:** calling today is strictly one-lead-at-a-time — `POST /api/dialer/calls/start` takes a single lead, with `/calls/{id}/action`, `/calls/disconnect`, `/calls/force-end` and Aircall webhooks signaling completion. There's no bulk/queue endpoint. Call Monitor (`frontend/js/views/call_monitor.js`) already has the "list of calls with status" rendering pattern this could visually borrow from.

**Likely shape (not yet designed):** a queue UI over the existing Leads list — select N leads, "Start Calling," which walks the existing single-call flow lead-by-lead, advancing automatically on disconnect/force-end, with the current+upcoming queue visible the whole time. Builds on existing single-call primitives rather than a new bulk-calling backend.

**Open question before scoping:** confirm with the user whether this is meant to replace the current per-lead dial flow or sit alongside it as a separate "power dial" mode.

---
