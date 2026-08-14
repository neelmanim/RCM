# Release Notes — RCM

---

## v11.0.0 — 14 Aug 2026
### 🧪 Cadence/Messaging Sandbox, Aircall messaging, Analytics fixes

#### New Features

- **Cadence/Messaging Sandbox** — test an entire Sales Cadence end-to-end with real WhatsApp/SMS sends, safely. Playground's new "Cadence Test" tab lets you create a throwaway test lead, enroll it in any real published cadence, and force each step through immediately instead of waiting real days. Every send is redirected to a Sandbox Test Phone Number you configure — never a real lead — and test data never shows up in Analytics or activity feeds.
- **Aircall added as a second messaging provider** — pick RCM Built-in Messaging or Aircall for Sales Cadence and Widget messaging in Settings.
- **The "Conversations" threshold in Analytics is now configurable** (Settings → Call & Pipeline Settings), instead of a fixed 30 seconds.

#### Bug Fixes

- **Analytics Hub filters no longer reset when you switch tabs** — pod/date/batch selections now persist.
- **Fixed the SDR Performance table's search icon** not being vertically centered.

## v10.9.14 — 14 Aug 2026
### 💬 WhatsApp in Sales Cadences, and messages now tracked

#### New Features

- **WhatsApp is now available as a Sales Cadence step** — pick from your account's real approved templates right in the Journey Builder.
- **Messages sent or received through the RCM Widget are now tracked in RCM** — previously they left no record anywhere in the app.

#### Bug Fixes

- **Fixed the Leads Hub Source badge overflowing into other columns** for long file names — it now truncates with the full name on hover.

## v10.9.13 — 14 Aug 2026
### ✨ Redesigned Leads is now the default

#### New Features

- **The redesigned Leads experience is now on by default for everyone** — the classic view is still one click away via "Switch to classic view".

#### Changes

- **Removed phone-number masking** for non-admins — numbers no longer hide behind a "complete research first" gate; the feature it supported is retired.
- **Enroll in Cadence** is now available to Pod Admins and Admins, not just Super Admins.

---

## v10.9.12 — 14 Aug 2026
### 🐛 Redesigned Leads (beta) bug-fix pass, Analytics Hub scroll fix

#### Bug Fixes

- **Redesigned Leads experience (beta)**: fixed a stuck date filter, a filter combination that silently cancelled itself, Saved Views dropping your search text, inline edits and bulk actions failing with no warning, a lingering "Unknown" placeholder, and a company-connection badge that could reference a lead's own status.
- **Analytics Hub**: the SDR Performance table now scrolls within its own panel instead of growing past the page.

---

## v10.9.11 — 14 Aug 2026
### 📊 Analytics: Conversations Column & Per-Team Timezones

#### New Features

- **Conversations column** in Analytics Hub's SDR Performance table (and CSV export) — calls over 30 seconds that weren't a no-answer, wrong number, or voicemail.
- **Each team's date filter now uses that team's own timezone.** Set a timezone per POD in POD Management — a US team's late-night calls no longer land on the wrong on-screen date when viewed by an admin in a different timezone.

#### Bug Fixes

- **Fixed a lingering "Source: Salesforce" mislabel** on leads auto-created by the dialer — a follow-up gap the earlier fix didn't fully close.
- **Restyled the Sales Cadence Send Window's Timezone picker** — replaced the browser's own inconsistent-looking dropdown with one that matches the rest of the app.

---

## v10.9.10 — 13 Aug 2026
### 🚨 Hotfix: Dialer Widget Was Silently Blocking Clicks

#### Bug Fixes

- **Fixed an invisible click-blocking bug from the RCM dialer widget.** Since it became the default widget, its collapsed floating button was still reserving a much larger invisible area in the bottom-right corner of every page — silently swallowing clicks meant for whatever else was on screen there (e.g. merge-field chips in Sales Cadences). Clicks in that corner now reach the widget's button only, never the empty space around it.

#### New Features

- **Rename a cadence.** Click the name at the top of the Journey Builder to rename it.

---

## v10.9.9 — 13 Aug 2026
### 🔁 Sales Cadences: Engagement Tracking, A/B Testing, SMS, and More

#### New Features

- **See open/click/reply rates** for every cadence, overall and per email step.
- **Split-test an email (A/B).** Two subject/body variants, sent evenly — see which performs better per step.
- **Send SMS from a cadence.** New SMS step, sent via your existing RCM connection.
- **Restrict sends to business hours.** Pick a timezone, a daily window, and allowed weekdays.
- **Generate a first draft with AI.** A "Generate with AI" button on any email field.
- **Out-of-office replies no longer count as engagement** — a real reply and an auto-responder are now told apart.
- **New Activity view** — every email/SMS send and reply for a cadence, in one timeline.

---

## v10.9.8 — 13 Aug 2026
### 🔁 Sales Cadences: Pod Scoping & Email-Received Trigger

#### New Features

- **Scope a cadence to one pod.** Only leads in that pod get auto-enrolled — set it when creating a cadence, or any time after from the builder.
- **New trigger: "SDR/AE receives an email from the lead."** Start a cadence on an inbound email, not just a status change.

#### Bug Fixes

- Merge-field chips in the Email node now show a pointer cursor.
- Bulk-select no longer includes a cadence that's been filtered out of view.
- A partially-failed bulk delete now refreshes correctly and lets you retry just the failures.

---

## v10.9.7 — 13 Aug 2026
### 📞 React RCM Dialer Widget — Now Default

- **The modernized Call/Message widget is now on for everyone.** The old dialer widget is still there as an automatic fallback while we retire it in a follow-up.

---

## v10.9.6 — 13 Aug 2026
### 🔁 Sales Cadences Management & User Guide Gaps

#### New Features

- **Find and manage cadences easily.** Sales Cadences now has search, a status filter, pagination, and single/bulk delete — with a warning if leads are still enrolled before you delete.
- **New user guide sections** for Power Dialer, Analytics Hub, and Sales Cadences — including how to auto-schedule a call when a lead replies to a cadence email (this already works today).

#### Bug Fixes

- **Fixed a misleading "Salesforce" source label.** A lead created without an explicit source used to silently show up as "Salesforce" even when it had nothing to do with Salesforce.

---

## v10.9.5 — 13 Aug 2026
### 📧 Email Hub — Cc/Bcc, Signatures, Rich Text & Reliable Sync

#### New Features

- **Cc/Bcc on every email.** Loop in a manager or teammate when emailing a lead — on new emails and replies.
- **Personal email signature.** Add a signature with links and images (like a booking link or social icons) under My Settings — it's added automatically to every email you send.
- **Insert links and images in the email body.** Compose is no longer plain text only.
- **Analytics Hub for AEs.** AEs now get their own Analytics Hub, scoped to just their own leads and calls.

#### Bug Fixes

- **Email replies now sync in reliably.** Previously, a reply — whether from the lead or sent directly from your own Gmail — only synced in when you happened to reopen that lead's Email tab. It now syncs automatically on a regular schedule.
- **Power Dialer layout fix.** The "Today's Calls" panel could get cut off on the right side of the screen at some window widths, requiring a zoom-out to see it. Fixed.

---

## v10.9.4 — 13 Aug 2026
### 📊 Analytics Hub — Clearer Leads Assigned Label

#### Bug Fixes

- **"Leads Assigned" now explains itself.** The card counts leads created in your selected date range, not leads worked — a subtitle now says so directly, instead of only showing on hover.

---

## v10.9.3 — 12 Aug 2026
### 📞 Power Dialer — Call Log Fixes

#### Bug Fixes

- **No more "Unknown" with nothing else to go on.** A call that isn't matched to a real name now shows the phone number instead — much easier to recognize who actually called.
- **Call duration is now visible** on every logged call.
- **Download a recording** directly from the call log, next to the player.
- **Search and filter your call list** — by outcome, or by name/company/phone — and it's now paginated instead of one long unbroken list.

#### Known limitation (not a bug)

- Some SDRs see zero recordings even on calls they know were answered. We traced this to Aircall itself not generating a recording for those specific calls — confirmed by comparing raw call data between an SDR whose recordings work and one whose don't. This needs a check in Aircall's own settings, not a CRM fix.

---

## v10.9.2 — 12 Aug 2026
### 📊 Analytics Hub — Accuracy Fixes

#### Bug Fixes

- **The same number no longer disagrees with itself.** Calls, emails, and meeting counts could previously show differently depending on which pod or date filter you had selected — they now agree everywhere.
- **A call to a brand-new number is no longer lost.** If the phone number doesn't match an existing lead yet, one is created automatically instead of the call going untracked.
- **Connect Rate now counts a real answer as a real answer.** Previously it only counted a call as "connected" if someone manually logged an outcome — now it also recognizes when the call was genuinely answered.
- **Removed the Research metric** from Analytics Hub — it tracked something the team no longer manages this way, and mostly just added confusion.

#### Under the Hood

- `backend/models.py`: new shared `assign_lead()`/`disqualify_lead()` helpers so pod assignment and lead-closing fields can't drift out of sync at any call site again.
- `backend/dialer_service.py`: Aircall's live webhook and nightly historical sync now auto-create a lead on an unmatched number (mirroring the existing Klenty sync pattern), and both write a native "answered" signal for Connect Rate.
- `backend/routes/analytics_routes.py`: shared pod-scope and date-bucket helpers applied consistently across `/funnel`, `/trend`, `/email-breakdown`, and `/batch-summary`.
- Backfilled 2,578 leads' pod assignment and 80 leads' close date on production to match the fixed logic going forward.

---

## v10.9.1 — 12 Aug 2026
### 📞 Aircall Everywhere — Drawer Fixes

#### Bug Fixes

- **The drawer's own trigger button is no longer hidden behind the drawer** — it now sits above the panel, reachable at all times.
- **You can now close the drawer any time** (except mid-call) — a close button and Escape key both work, even before you've logged in. Previously there was no way to dismiss it until login finished.
- **Opting out of Aircall Everywhere no longer leaves a squeezed, half-empty page** — that was a real bug, not a cosmetic gap.
- **Visual polish**: a clearer header, a better-framed login screen, a properly separated "Prefer your Desktop app?" link.

---

## v10.9.0 — 11 Aug 2026
### 📞 Aircall Everywhere — Global Drawer

#### New Features

- **Log into Aircall right in your browser, from anywhere in the app.** A new drawer, opened from the icon next to your other topbar actions, lets you connect Aircall Everywhere once — after that, the ordinary Call button on any lead rings straight into your browser, no Desktop app required.
- **The page stays readable while you're on a call.** The drawer no longer covers or dims the rest of the screen — the page shrinks to make room, so you can keep reading the lead's details while you talk.
- **A quick one-time tip** explains the drawer the first time you see it, including the one thing that matters most: dial from the lead's own Call button, not the pad inside the drawer, so the call stays attached to the right lead.

#### Under the Hood

- `frontend-react/src/features/aircall-everywhere/`: new home for the login hook and drawer component, moved out of Power Dialer since this is no longer scoped to one page.
- `frontend-react/src/layout/NavTopbar.jsx` / `NavHub.css`: drawer trigger and panel, mounted in the persistent app shell so it survives navigating between pages.
- `frontend/css/style.css`: `.view-container` now shrinks (synced transition) instead of the drawer sitting on top of it.
- The pre-existing "Dial" (manual number) button now hides itself once the drawer is your real dialing path — still available if you're on RCM or haven't logged into the drawer yet.
- Backend: a real cross-agent call-matching bug fixed along the way — two SDRs dialing leads that share a phone number could have had their in-progress calls mixed up; now scoped correctly to each agent.

---

## v8.9.6 — 08 Jun 2026
### ⚡ Analytics Hub — Instant Navigation (No Reload on Return Visits)

#### Bug Fixes

- **Analytics Hub no longer reloads when you navigate back to it:** Previously, every time you left the Analytics Hub and returned (e.g. checked Leads, then came back), the entire hub re-initialised — destroying all loaded data and re-fetching every chart from scratch. This was a silent bug where the app was calling `unmount()` at the wrong time, wiping the React tree on every navigation. Fixed: the hub now stays alive when you leave and resumes instantly when you return.

#### Under the Hood

- `frontend/js/app.js`: `unmount()` now only fires when genuinely leaving analytics. Navigate-back calls the new `navigate()` method (no teardown, no API calls).
- `frontend-react/src/pages/Analytics/AnalyticsHub.jsx`: `onFiltersChange` now uses a stable `useCallback` reference — prevents a secondary data load triggered by React re-render prop diffing.
- No database changes. No new environment variables.

---

## v8.9.5 — 08 Jun 2026
### ⚡ Analytics Hub — 6× Fewer API Calls, Faster Load

#### Bug Fixes

- **Analytics Hub was making 6 duplicate API requests per visit — now it makes 1:** A Chrome DevTools audit revealed three separate bugs causing the funnel, SDR table, trend, and AI insight endpoints to fire up to 6 times per session. All three root causes are fixed:
  1. An async pod-list fetch was incorrectly making the filter state appear to change — triggering a second full data load every time the pod list arrived.
  2. The AI insight badge (e.g. "Low connect rate") was re-running its Groq AI request on every data refresh, not just when filters changed.
  3. The CSS stylesheet was missing a version string — browsers were serving a stale cached version after deploys.

- **AI insight badge updates at the right time:** The "Low connect rate" and "High effort" badges in the Analytics Hub now update only when you change a filter (POD, date range, or batch) — not on every background data refresh. Fewer unnecessary AI calls, faster updates when filters actually change.

#### Under the Hood

- 19 new backend edge case tests added (cross-user isolation, pin lifecycle, filter context injection, cache key isolation). Full suite: 1,574 passed, 0 failures.
- No database changes. No new environment variables.

---

## v7.2.0 — 27 May 2026
### 🛡️ Dialer Hardening — Smarter Phone Validation & Better Error Messages

#### Improvements

- **Phone numbers with extensions now work automatically:** If a lead's phone number includes an extension (e.g. `+1 800-887-8965 ext 288`), the extension is now automatically stripped before dialling. Previously this caused a silent failure — the call never went through. Now the call connects correctly and a log note records the stripped extension.

- **Dots in phone numbers handled correctly:** Phone numbers formatted with dots (e.g. `+1.212.555.1234`) are now cleaned automatically before dialling. No more manual cleanup needed.

- **Invalid numbers caught before dialling — with a clear message:** Numbers that can never connect (Indian toll-free 1800/1860 service lines, invalid US area codes like 011x/010x, numbers that are too short or too long) are now blocked immediately with a plain-English explanation. Previously these caused a raw API error that gave no useful information.

- **RCM error messages are now actionable:** When RCM rejects a call, you now see exactly why — e.g. *"RCM says: phone number not reachable"* or *"rate-limiting — wait a few seconds and try again"*. Every error type has a specific message and a suggested next step instead of a raw technical error code.

- **Consistent behaviour across both dialers:** Aircall and RCM now share the same phone validation logic — the same number that's caught on one dialer is caught on the other.

#### Under the Hood

- 91 new automated tests added — 1,273 tests total, 0 failures
- No database changes, no new environment variables, no migration steps required

---

## v6.8.1 — 25 May 2026
### 🚨 P1 Hotfix — Calls Broken for Ad-Hoc Numbers

#### Bug Fixes
- **Calls to unlisted numbers now work (P1 fix):** Dialling a number not already in the CRM caused a server error (HTTP 500) and the call never started. The system tries to create a temporary lead record for unrecognised numbers — this was failing because a required internal field (`sf_lead_id`) was left empty. Fixed: the field is now auto-populated with a unique internal ID so the call can proceed immediately.

---

## v6.8.0 — 25 May 2026
### 🛡️ Staging Stability & SDR UX Refinements

#### Bug Fixes
- **RCM Call Recordings Now Visible**: Recordings from RCM calls were never appearing in the lead Calls tab. The root cause was that the system was using the global Aircall provider to fetch recording URLs for RCM calls — a mismatch that silently returned no data. The recording refresh logic now uses the correct provider per call. Recordings will appear on the next page load for completed calls.
- **Test Suite Isolation & Reliability**: Refactored backend public API key auth to inject the request's DB session dynamically, fixing database connection bleed and making the full backend unit test suite completely stable. Mapped mock URL responses to prevent real network calls during testing.
- **Manual Dial Sync Active Hidden**: The Dial/Call buttons are now dynamically hidden on lead details and lists if a manual dial sync is actively running.
- **Clear Filter Page Reload**: Clicking the "Clear Filters" button on the lead list view now triggers a clean page reload to completely reset all filter inputs and pagination states.
- **SDR Settings Dialer Toggle**: SDRs can now toggle the RCM WebRTC dialer widget on or off directly within their Settings panel.
- **SDR Error Logs Resolve Cleaned**: Removed the redundant "Resolve" buttons from the System Error Logs view for SDR-role users, restricting resolution permissions to administrators.
- **Compact Call Log Modal UI**: Streamlined the call log details modal to occupy less screen space and improve visual hierarchy.

---

## v6.5.0 — 22 May 2026
### ⚡ Performance Hotfix + CORS Fix

#### Bug Fixes
- **Call Logs now load in under 300ms** (was 3–8 seconds): The System Logs → Call Logs page was loading all 11,000+ call records into memory to compute summary stats. Replaced with a direct SQL aggregation — load time dropped by ~95%.
- **CORS error fixed**: All API calls from the production app (`rcm.txtbox.in`) were being blocked by the browser with a CORS error. Fixed by updating the server's allowed-origins configuration.
- **Login speed improved**: On every login, the system fetched a user's entire lifetime call history just to count today's calls. Now queries only today's data directly from the database.
- **SDR Performance page faster**: Status counts on the SDR performance report were computed in Python by iterating all leads. Now computed as a single SQL query.

#### Infrastructure
- 3 new database indexes added on call tables — date-range filters and sort queries are now significantly faster as call volume grows.

---

## v6.4.8–v6.4.9 — 22 May 2026
### 🛡️ Edge Case Hardening + Test Infrastructure

#### Bug Fixes
- **Timer cross-call bleed fixed**: If a new call started within 1.5 seconds of the previous call's widget closing, the old 45s safety timer could accidentally fire against the new call. Each timer now locks to its specific call ID.
- **Calls tab retry window extended**: On slower networks the automatic Calls tab switch after logging an outcome could miss its timing window. Extended from 600ms → 1200ms.
- **Outcome modal shows correct lead name**: For ad-hoc (non-lead-page) dials, the outcome modal now always shows the correct lead name instead of a blank field.
- **Dialer phone field consistency**: `GET /api/dialer/my-phone` now returns `from_number` (canonical field name) matching all other dialer endpoints — prevents silent field-name mismatches.

#### Infrastructure
- 175 automated tests passing, 0 failures
- New `00-sanity.spec.js` pre-flight suite: 13 checks that validate frontend reachability, API auth, CORS, and database before running the full test suite

---

## v6.4.4–v6.4.7 — 22 May 2026

### 📞 RCM Dialer — Declined Call & UX Fixes

A targeted reliability sprint fixing three issues discovered during live testing.

#### Bug Fixes

- **Declined call stuck on "Ringing…" forever (v6.4.5 + v6.4.6):** When the recipient pressed Decline on their phone, the RCM dialer widget stayed frozen showing "Ringing…" indefinitely. Root cause: RCM's status API has a 7–30 second lag before reflecting the declined state. Fixed with two backend guards — Guard 1 immediately returns "Call Ended" if the call's end-time is already recorded, and Guard 2 auto-closes any RCM call that has been ringing for more than 50 seconds with no answer. A third 45-second client-side timeout was also added as a safety net.

- **Outcome modal appearing behind the dialer and vanishing (v6.4.7):** After a call ended, the "Log your call outcome" modal briefly flashed and then disappeared, hiding behind the RCM widget. Fixed — the outcome modal now always appears on top of everything.

- **Calls tab not refreshing after logging outcome (v6.4.7):** After submitting a call outcome, the app reloaded the lead but left the Overview tab open — the SDR had to manually click the Calls tab to see the new entry. Fixed — the app now automatically switches to the Calls tab after an outcome is logged.

- **Ad-hoc dial call not registered in history (v6.4.4):** When using the Ad-hoc Dial panel, the call was not appearing in call history because the call record was never created in the database. Fixed — manual dials now correctly create a call record and appear in the Calls tab.

#### Improvements

- **Calls tab auto-refresh (v6.4.4):** After a RCM call ends, the Calls tab now automatically reloads its data. If you were already on the Calls tab when the call ended, the new entry appears instantly — no page refresh or manual click required.

---

## v6.4.x – 21 May 2026


### 📞 RCM Dialer Reliability + Search Fix

A series of improvements and fixes to the RCM dialer integration and global search.

#### Bug Fixes

- **Ad-hoc dial was broken (v6.4.1):** Clicking "Phone Bridge" or "Browser Call" in the Ad-hoc Dial panel did nothing — the widget went blank. Fixed. The call now initiates correctly with a "Connecting…" spinner while the call is being set up.

- **Random lead name appearing in widget footer (v6.4.1):** When the ad-hoc dial panel was used, a previous lead's name (e.g. "Melanie Pratt / No Answer") appeared in the widget footer. Fixed — the footer no longer shows stale call history during an ad-hoc dial.

- **Full-name search not working (v6.4.2):** Searching "Melanie Pratt" in the top search bar returned no results, even though she was in the system. Fixed — the search now matches across both first and last name columns together, not just individually.

#### Improvements

- **Button clean-up for RCM users (v6.4.0):** The redundant "Call via RCM" and "Message" buttons no longer appear for SDRs using the RCM dialer — the floating widget handles both. Aircall users who also have RCM messaging enabled still see the Message button.

- **Call history pagination (v6.4.0):** The Calls tab on a lead now loads 10 records at a time. A "Load more" button appends the next page without resetting the view. Previously all calls loaded at once regardless of how many there were.

- **Search completeness (v6.4.3):** Search now checks 9 fields: first name, last name, full name (first+last), full name (last+first), email, company, primary phone, secondary phone, and company phone. Searching by company phone number now works.

- **Search performance (v6.4.3):** The search bar now waits for at least 2 characters before querying — prevents unnecessary server hits on single keystrokes.

---

## v5.16.0 – 20 May 2026

### 🎯 SDR UX Overhaul — Call Modal v2, Lead Navigation, Aircall Auto-Sync, Multi-Number Calling

The biggest SDR workflow upgrade since v5.0. Four high-impact improvements based on direct SDR feedback.

#### New Features

- **📞 Redesigned Call Outcome Modal (F1):** The call logging modal now works in three clear steps. Step 1 asks "Did the call connect?" — tap **No / Voicemail** or **Yes, Connected** to continue. Step 2 shows the right outcome chips for your answer. Step 3 (Yes branch) expands a meeting scheduler when you select Meeting Confirmed. No more scrolling through a long dropdown — the right options appear automatically. Keyboard shortcuts: `Y`/`N` for branch selection, `1`–`9` to pick a chip, `Enter` to submit.

- **⬅️ ➡️ Lead Navigation Bar (F2):** A sticky **Prev / Next** bar appears at the top of every lead detail page, letting you move through your lead list without going back to the table. Use `Alt+←` / `Alt+→` keyboard shortcuts. The bar shows your position (e.g. "Lead 3 of 47") and the name of the adjacent lead.

- **🤖 Aircall Auto-Sync (F3):** When you tag a call in Aircall with a standard tag (No Answer, Left Voicemail, Meeting Booked, etc.), RCM automatically logs the outcome — **no manual logging required**. If you prefer to log it yourself, your manual entry takes precedence (idempotent: the system never overwrites a manually logged outcome). Admins can customise the tag-to-outcome mapping in Settings → Dialer → Aircall.

- **📱 Multi-Number Split Button (F4):** When a lead has more than one phone number on file (e.g. mobile + company phone), the call button becomes a **split button** — click the arrow to pick which number to dial. The last-used number is remembered for the session.

#### Admin Notes

- Aircall Auto-Sync uses your existing Aircall webhook URL — no new configuration needed for standard tags.
- Custom tag mappings can be set in **Admin → Settings → Dialer → Aircall Tag Mapping** (UI in Phase 2 — default mapping is active from day one).

---

## v5.15.x – 15 May 2026

### 🔧 Outcome Gate, Dialer Hardening & Bug Fixes

A series of stability and UX improvements shipped across v5.15.0–v5.15.5.

#### New Features

- **Automated Outcome Gate (v5.15.0):** After every dialer-initiated call, a sticky banner + modal automatically prompts you to log the outcome. You cannot accidentally skip it. If you dismiss the banner, a note is automatically added to the lead's timeline.
- **Independent Dialer Test Buttons (v5.15.0):** Admins can now test Aircall and RCM credentials independently from Settings → Dialer — no need to toggle providers off/on.

#### Bug Fixes

- **Duplicate call log entries fixed (v5.15.1 & v5.15.2):** Calls are now matched by exact DB UUID — one call always produces exactly one log entry.
- **Discovery gate stuck "Log outcome first" (v5.15.3):** Fixed — the gate now clears immediately after logging an outcome without requiring a page refresh.
- **Call entry label stuck on "In Progress" (v5.15.3):** Fixed — shows "Outcome Logged" state correctly.
- **Meeting Complete / Demo Failed TypeError (v5.15.2):** Fixed — buttons work correctly without throwing an unhandled error.
- **Admin user deletion 500 error (v5.15.4):** Fixed — deleting a user no longer throws an IntegrityError.

---

## v5.13.0 – 13 May 2026


### 🔍 SDR Discovery Pipeline — Full Workflow Completion

Completes the end-to-end SDR discovery meeting lifecycle. SDRs can now log discovery calls, advance leads through structured discovery stages, and trigger the demo scheduling workflow — all from the lead detail page.

#### New Features

- **📞 Add Discovery Call:** "Add Discovery Call" button calls the real `POST /leads/{id}/add-discovery` API (was a client-side no-op). Increments `discovery_meeting_count` on the lead and logs the activity.
- **✅ Complete Discovery:** "Complete Discovery" button advances the lead to `Discovery Complete` stage. Requires at least one discovery meeting logged.
- **📅 Schedule Demo:** "Schedule Demo" button becomes visible at `Discovery Complete` stage, advancing the lead to `Demo Scheduled`.
- **⚠️ Max-Attempts Banner:** Warning banner rendered directly on the lead detail header when a lead has reached the maximum discovery meeting attempts.
- **📅 Meeting Confirmed Modal:** Call modal now shows a required datetime picker when "Meeting Confirmed" is selected as the outcome.

#### Backend

- **`backend/models.py`** — `discovery_meeting_count INTEGER DEFAULT 0` added to `Lead` model
- **`backend/migrations.py`** — V36 migration: `ADD COLUMN IF NOT EXISTS discovery_meeting_count` (raw `information_schema` check — bypasses SQLAlchemy inspector cache)
- **`backend/routes/lead_routes.py`** — New `POST /leads/{id}/add-discovery` endpoint; `_lead_to_dict` exposes `discovery_meeting_count`
- **`backend/routes/admin_routes.py`** — Emergency `/api/admin/force-add-column` endpoint for raw-SQL DDL when startup migration silently fails

#### E2E Tests

- **`tests/sdr-lead-page-p1.spec.js`** — P1 SDR workflow suite (15 tests)
- **`tests/sdr-lead-page-p2.spec.js`** — P2 Discovery Stage suite (selector fix: replaced `:has-text()` in `querySelector` with Playwright locator API)
- P3–P4 suites added for full lifecycle coverage

#### Migration Notes

`discovery_meeting_count` added via V36 migration. Auto-applied on startup. Migration uses raw `information_schema` check to avoid SQLAlchemy inspector caching issues on staging PostgreSQL. Force-apply endpoint available at `/api/admin/force-add-column` if startup migration is skipped.

#### Breaking Changes

None — all changes are additive and backward-compatible.

---

## v5.12.3 – 13 May 2026

### 🛡️ P1 Hardening — Import Route Resilience

Hardens the lead import pipeline against transient database failures to prevent split-brain data states.

#### Changes

- **`backend/routes/admin_routes.py`** — Every per-row lead creation loop now wraps each row in `db.begin_nested()` (savepoint). One constraint violation no longer corrupts the session (`PendingRollbackError`) and crashes the entire import.
- **`backend/routes/admin_routes.py`** — `LeadUploadLog` now added to session and committed in a single atomic `db.commit()` with the leads. Eliminates split-brain risk where leads land but the upload log is lost on transient DB error.
- **`docs/AGENT_PROTOCOL.md`** — Rule 11 added: bans separate `db.commit()` for lead write and upload log; mandates `db.begin_nested()` in import loops.
- **`docs/RELEASES.md`** — v5.12.3 entry added.

#### Migration Notes

No database schema changes. No manual steps required.

#### Breaking Changes

None.

---

## v5.11.0 – 12 May 2026

### 🩺 Integration Health Diagnostics — Dialer & Chat

Two new auth-protected endpoints let admins instantly diagnose integration failures without digging through logs or environment dashboards.

#### New Endpoints

**`GET /api/dialer/health`** — Checks the RCM Contact Center (calling) stack:
- Provider configured (`rcm` / `aircall` / `none`)
- API credentials present (shared or separate, safely masked)
- `from_number` (caller ID) set — the #1 cause of silent call failures
- Live API ping with real connectivity result

**`GET /api/chat/health`** — Checks the RCM Conversations (messaging) stack:
- `rcm_enabled` flag toggled on
- `api_key`, `user_id`, `account_id` all set
- `sender_id` (outbound WhatsApp/SMS number) present
- Live API ping via `list_conversations(page_size=1)`

Both return `{ "status": "ok" | "degraded", "checks": { key: { ok, message } } }`. No secrets are exposed — all credential values are masked (e.g. `abc***xyz`).

#### Files changed
- **`backend/routes/integration_health_routes.py`** [NEW] — Both diagnostic routes
- **`backend/main.py`** — Registered `integration_health_router` (V35)

#### Breaking changes
None — read-only diagnostic endpoints, no schema or data changes.

---

## v5.10.0 – 12 May 2026

### 💬 RCM Floating Widget — Unified Messaging Surface

The RCM messaging interface has been unified into a single floating widget. The old iframe-based Conversations tab is deprecated. SDRs can now message directly from any lead without a page reload.

#### What's new

- **💬 Message button** — A green **Message** button in the lead detail action row opens the floating RCM widget for that lead (name, phone pre-loaded).
- **🪟 Floating widget (unified surface)** — `RCMWidget` is now the only messaging interface. It floats over the page, supports active-call state (timer, disconnect), and exposes a no-phone guard for leads without a number.
- **📞 Timer sync** — Widget timer anchors to the exact call start time from the `rcm:call-started` event — no drift between dialer and messaging UI.
- **🚫 No-phone guard** — Widget shows a "No phone number" notice instead of a blank compose area when the lead has no valid number.
- **⚙️ Admin-controlled** — Super Admins enable this via **Settings → Sync → RCM Messaging**. SDRs without it enabled see no UI change.

#### Files changed

- **`frontend/js/rcm_widget.js`** — Dynamic header (lead name + phone), no-phone guard, timer anchoring, dialer suppression scoped to active calls, loading state for compose area
- **`frontend/js/app.js`** — Widget boot post-login; injects `rcm_sender_id` from SyncSettings; exposes `window._openMessagingWidget(lead)`
- **`frontend/js/views/lead_detail.js`** — Iframe tab deprecated; 💬 Message button + Conversations tab now invoke the floating widget
- **`frontend/js/views/dialer_widget.js`** — Added `startTime` to `rcm:call-started` event payload
- **`frontend/css/rcm_widget.css`** — Removed dead `.cw-powered-by` styles; added dynamic header lead-info styles
- **`frontend/index.html`** — Registered `rcm_widget.css` and `rcm_widget.js`

#### Breaking changes

Iframe-based Conversations tab is deprecated. The floating widget is now the canonical messaging surface.

#### Migration notes

No database changes required. Feature is opt-in via Settings → Sync → RCM Messaging toggle.

---

## v5.9.0 – 11 May 2026

### 🔍 Error Logs — System Health Visibility for Admins

RCM now automatically captures every frontend and backend error and surfaces it in plain English inside **Audit Logs → Error Logs**. No more digging through Render logs or browser consoles.

#### What's new

**Error Logs tab** inside Audit Logs shows a live feed of all system errors — translated from technical exceptions into plain-English descriptions any admin can understand. Each card shows:

- **Severity** — Critical (server crash) or Warning (failed API call, upload error, etc.)
- **Plain-English title and description** — e.g. "A background operation failed unexpectedly — an async task failed without being caught"
- **What to do** — actionable hint for the admin
- **Who triggered it** — user email and timestamp
- **Occurrence count** — if the same error fired 10 times, one card shows ×10 instead of 10 separate entries
- **Resolve** — one-click to mark as resolved; the card fades out and the badge clears

#### Filters
Filter by **Severity** (All / Critical / Warning), **Category** (API, Dialer, Research, Upload, Salesforce, Auth), and **Status** (All / Unresolved / Resolved).

#### Role-based visibility
- **Super Admin** — sees all errors across all users
- **Pod Admin** — sees errors from their pod SDRs only
- **SDR** — sees their own errors only

#### Automatic housekeeping
Error logs older than **15 days** are automatically purged nightly — the list stays clean without manual intervention.

#### Performance impact
Zero. All error capturing is fire-and-forget — errors are logged in a background thread and never block or slow down the page.

---

## v5.8.2 – 11 May 2026

### 🐛 Bug Fix: Research → Calling Gate Always Blocking

Fixed a critical SDR workflow blocker where the "Complete AI research first" guard prevented lead status transitions to **Calling** even when all four required research fields were fully populated.

### Root Cause

The frontend validation in `lead_detail.js` was querying DOM elements by ID (`document.getElementById('research-company')` etc.) to check field values. These IDs do not exist in the DOM — research fields are rendered as read-only `<div>` elements, not `<input>` elements. As a result, all four lookups returned `null`, and the gate always evaluated fields as empty, permanently blocking the transition.

### Fix

Replaced DOM element lookups with direct checks against the in-memory `lead` JavaScript object — the same source used by the existing `countResearchFilled()` function. The four fields validated are:

- `lead.research_company`
- `lead.research_contact`
- `lead.research_hypothesis`
- `lead.research_personalization`

The gate now correctly reflects the backend data state: if all four fields are non-empty strings, the transition to Calling is permitted.

### Files Changed

- **`frontend/js/views/lead_detail.js`** (lines 1037–1056) — Validation logic refactored to use `lead` object instead of DOM queries

### Testing

- 22/22 backend tests passing
- No test coverage existed for the frontend gate (gap noted for future Playwright spec)
- Manually verified against backend `move_lead_kanban` gate at `lead_routes.py` — both now consistently require all 4 research fields

### Breaking Changes

None — no API or schema changes. Pure frontend logic fix.

---

## v5.8.0 – 8 May 2026

### 🤖 AI Research Prompt Editor (Super Admin)

Super Admins can now view, customize, and reset the AI research prompt used to generate lead intelligence. The editor lives in **Settings → AI Settings** and gives full control over what context the AI focuses on.

### New Features

- **✍️ Prompt Editor (Settings → AI Settings):** A new card allows Super Admins to write a custom research prompt. The editor includes:
  - Live character counter with color thresholds (green → amber → red)
  - Click-to-insert `{lead_context}` variable chip — injects all lead fields into the prompt automatically
  - **Custom** badge when a prompt is active; **Default** badge when using the system prompt
  - Save and Reset to Default buttons
- **🔄 Dynamic Prompt Injection:** The AI research backend now reads the custom prompt from the database and injects `{lead_context}` at runtime. If no custom prompt is configured, the system default is used seamlessly.

### Bug Fixes

- **🧪 Sandbox Tab Rendering:** Fixed the "Loading sandbox configuration..." placeholder persisting below the rendered sandbox UI in Settings → Sync.
- **⚡ Sandbox Refresh Timeout (Critical):** The "Refresh from Production" flow was failing with a request timeout because the entire database was being exported in a single HTTP response (~10–50MB). Fixed by splitting into per-table requests:
  - `GET /api/admin/sandbox/export/tables` → returns table list + row counts (fast, <1s)
  - `GET /api/admin/sandbox/export/table/{name}` → exports one table at a time (30s max each)
  - The refresh worker now loops table-by-table — each request stays well within Render's 30s timeout

### Backend

- **`backend/models.py`** — `research_prompt` (TEXT, nullable) added to `SyncSettings`
- **`backend/migrations.py`** — V31: idempotent `ADD COLUMN IF NOT EXISTS research_prompt`
- **`backend/routes/admin_sync_routes.py`** — `research_prompt` exposed in GET/PATCH sync-settings API
- **`backend/routes/ai_research_routes.py`** — `_build_prompt()` injects custom template; `_get_llm_config()` reads from DB
- **`backend/routes/sandbox_routes.py`** — New `/export/tables` + `/export/table/{name}` endpoints; `_do_refresh` refactored to per-table loop

### Frontend

- **`frontend/js/views/settings_ai_dialer.js`** — Prompt Editor card with char counter, variable chip, save/reset
- **`frontend/js/views/settings.js`** — Sandbox tab loading placeholder cleanup fix

### Migration Notes

- V31 migration runs automatically on startup — idempotent, no manual steps
- `research_prompt = NULL` → system default prompt is used (fully backward compatible)

### Breaking Changes

None — all changes are additive and backward-compatible.

---

## v5.7.6 – 8 May 2026

### 🐛 Bug Fixes

- **AI Research broken in prod (P1)** — The 🤖 AI Research button showed `"Unexpected end of JSON input"` for all SDRs. Root cause: the fetch URL used a relative path (`/api/leads/.../ai-research`) which hit the static frontend server (HTML 404) instead of the backend API in the decoupled production setup. Fixed to use `${API_BASE}` consistent with all other API calls.
- **Research save silently failed** — `patchLeadResearch` in `api.js` called `res.json()` without checking `res.ok`, so HTTP 4xx/5xx errors returned silently as plain objects instead of throwing. The Save button showed ✅ even when the save failed, leaving research fields empty in the DB and blocking the move to Calling.
- **Progress ring misleading** — Sub-text said "11 more to unlock Calling" but only 4 core fields are actually required by the backend. Updated to say "X required fields left to unlock Calling" and "✅ Core research done — you can move to Calling" once the 4 required fields are filled.
- **Null-safe field collection** — Save handler now uses `?.value ?? null` to skip fields not present in the DOM, preventing previously-saved values from being overwritten with blank strings on partial page load.

### Breaking Changes

None — frontend-only change, no migration required.

---

## v5.7.5 – 7 May 2026

### ⚙️ Deployment Process Hardening

Enforced disciplined, error-proof production deployment protocols following two consecutive P1 outages. All operational rules consolidated into a single canonical file; automated safety gates introduced.

### Process & Tooling

- **`docs/AGENT_PROTOCOL.md`** — Created single source of truth merging `MYAGENT.md`, `Dev_Protocol.md`, and `DEPLOYMENT_PROTOCOL.md`. Eliminated conflicting rules across 5 overlapping docs.
- **`docs/command.txt`** — Shrunk to 5-line startup pointer to `AGENT_PROTOCOL.md`
- **`scripts/pre-deploy-check.sh`** — New interactive pre-deploy gatekeeper: validates branch, tests, migration safety, staging health, and release note presence. **Mandatory before any merge to `main`.**
- **`.gitmessage`** — New commit message template enforcing `<type>(<scope>): <summary>` format with mandatory `What / Why / Risk / Testing` fields
- **`docs/RELEASES.md`** — New deploy-time release tracker; backfilled entries for v5.6.x through v5.7.4
- **`scripts/close_day.sh`** — Added EOD gate: warns if commits landed on `main` today without a corresponding release note entry

### Rules Enforced (new in AGENT_PROTOCOL.md)

- `git merge --no-edit` is **forbidden** — all merges to `main` require a human-readable message
- AI agent must **never** push to `main` without explicit user approval — even during an active incident
- One RCA → one new checklist item within 24h
- `/api/health/deep` must return `db_tables_accessible: true` before any merge to `main`

### Breaking Changes

None — documentation and scripting only. No application code changed.

### Commit

`497168c` — `process: enforce deployment discipline — commit template, pre-deploy script, release notes`

---

## v5.7.4 – 7 May 2026

### 🛡️ Migration Safety & Deep Health Check

Full infrastructure hardening following the 7 May P1 deadlock outage. Ensures data migrations run exactly once and health checks accurately reflect database accessibility.

### Infrastructure

- **`migrations.py`** — `_applied_migrations` tracker table created on first startup. All 14 historical data migrations now idempotent — each runs exactly once, tracked by name. Subsequent restarts skip all 14 instantly (zero DB scans).
- **`migrations.py`** — `SET LOCAL lock_timeout = '10s'` added to all `ADD COLUMN` DDL. Unguarded `ALTER TABLE` on hot tables is now impossible.
- **`app_state.py`** — New module. `startup_complete` boolean flag set `True` when all migrations finish.
- **`main.py`** — Sets `app_state.startup_complete = True` at end of startup thread. Prevents false "ready" signals.
- **`auth_routes.py` `/api/health`** — Exposes `startup_complete` field. Always returns HTTP 200 to prevent Render restart loops during long migrations.
- **`auth_routes.py` `/api/health/deep`** — New endpoint. Runs `SELECT 1 FROM leads LIMIT 1` with `statement_timeout = '2s'`. Returns `db_tables_accessible: true/false`. Detects lock outages before users notice.

### Migration Notes

- Creates `_applied_migrations` table on first deploy (`CREATE TABLE IF NOT EXISTS` — fully idempotent)
- All 14 historical migrations backfilled and recorded on first startup
- No manual intervention required

### Verified on staging

No — hotfix deployed directly to production during P1 recovery (staging was also affected)

### Rollback commit

`637dfa4`

### Commit

`09ded47` — `hardening: migration tracker, lock_timeout, improved health checks`

---

## v5.7.3 – 7 May 2026

### 🚨 P1 Hotfix — DB Deadlock on Startup

Emergency fix for production outage caused by unconditional `ALTER TABLE leads` on every startup conflicting with a running data migration on a large production table.

### Root Cause

`ALTER TABLE leads ALTER COLUMN status TYPE VARCHAR(255)` ran unconditionally on every startup. On 7 May deploy, it took `AccessExclusiveLock` on the `leads` table at the same time the V24 migration `UPDATE leads SET times_called = 0` was still running — blocking all API traffic behind an indefinite lock.

### Fix

- **`migrations.py`** — ENUM→VARCHAR conversion now checks `information_schema.columns` first. Skips `ALTER TABLE` if column is already `character varying`. Idempotent.
- **`migrations.py`** — Added `SET LOCAL lock_timeout = '5s'` on ENUM conversion DDL as a hard ceiling even if the guard fails.

### Impact

- Production down ~15–20 min (Render health check restarts + lock hold)
- All authenticated API calls returning 503
- Fix deployed and verified by monitoring `/api/health/deep` response

### Verified on staging

No — emergency hotfix during active P1 outage. Staging also affected.

### Rollback commit

`d4e61ef` (prior deploy — note: this commit caused the deadlock, do not redeploy)

### Commit

`ace5361` — `fix: skip ALTER TABLE if column already VARCHAR to prevent startup deadlock`

---

## v5.7.2 – 6 May 2026

### 🏗️ Full Production Frontend Decoupling

Separated frontend static assets from the backend API service. Frontend is now served via a dedicated Render static site with a global CDN; backend serves JSON API only.

### Infrastructure

- **`render.yaml`** — Added `rcm-frontend-prod` static site service for production
- **`render.yaml`** — Set `SERVE_FRONTEND=false` on `rcm-crm-prod` backend
- **`render.yaml`** — Added `FRONTEND_URL` and `FRONTEND_URLS` env vars for CORS and Google SSO redirects
- **`frontend/js/views/settings_ai_dialer.js`** — Webhook URL now uses `API_BASE` instead of `window.location.origin` — required for decoupled architecture
- **`frontend/js/config.js`** — `window.__APP_CONFIG__` injected at build time via Render build command

### Known Issue — Triggered P1 Outage

This deploy triggered the 7 May DB deadlock. The V24 migration `UPDATE leads SET times_called = 0` ran for the first time on production data (large table), overlapping with the unconditional `ALTER TABLE leads ALTER COLUMN status` from the same startup. Both held conflicting locks → all API traffic blocked.

**Root cause fixed in v5.7.3.**

### Verified on staging

Partial — CORS and login flow tested; DB migration interaction on large tables not tested

### Rollback commit

Previous working commit before decoupling

### Commit

`d3bb151` — `feat: full production decoupling — render.yaml + dialer webhook + docs`

---

## v5.7.1 – 6 May 2026

### 🛡️ System Hardening & Upload Center Fixes

Post-incident infrastructure hardening and three Upload Center bug fixes addressing wizard crashes, rollback dialog instability, and column auto-detection failures.

### Infrastructure

- **🧠 OOM Prevention:** Added `MAX_CSV_ROWS = 5000` server-side cap to reject oversized uploads before they exhaust memory. Returns a clear 400 error with the row count and limit.
- **🏥 Deep Health Check:** `/health` endpoint now runs a live `SELECT 1` against the database and reports pool utilization (`pool_size`, `checked_in`, `checked_out`, `overflow`). Returns `"db": "ok"` or `"db": "unreachable"` with HTTP 503 on failure.
- **⚙️ Pool Hardening:** Tightened connection pool settings — `pool_pre_ping=True`, `pool_recycle=1800`, and `max_overflow=5` to prevent stale connections and connection storms.

### Bug Fixes

- **💥 Upload Wizard Crash Fix:** Fixed `ReferenceError: currentStep is not defined` crash in the CSV upload wizard caused by undeclared variables in `upload_csv.js`. Added proper `let` declarations for `currentStep`, `csvData`, `headers`, and `columnMap`.
- **🔄 Rollback Dialog Auto-Dismiss Fix:** Replaced the native `confirm()` dialog in the batch rollback flow with a custom async modal. The native dialog was auto-dismissing on some browsers due to rapid re-renders, causing accidental rollbacks. The custom modal uses a Promise-based pattern with explicit Accept/Cancel buttons.
- **🗺️ COLUMN_MAP Auto-Detection Fix:** Fixed `first_name` and `last_name` columns not being auto-detected during CSV upload. Root cause: `COLUMN_MAP` only included the space-separated variants (`first name`, `last name`) but not the underscore variants. Added `first_name` → `first_name` and `last_name` → `last_name` mappings.

### Backend

- **`backend/main.py`** — `MAX_CSV_ROWS` constant, pool config hardening, deep health check endpoint
- **`backend/routes/admin_routes.py`** — Row cap enforcement in upload route

### Frontend

- **`frontend/js/views/upload_csv.js`** — Variable declarations fix
- **`frontend/js/views/upload.js`** — Custom rollback confirmation modal, COLUMN_MAP underscore variants

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.
- Uploads exceeding 5,000 rows will now be rejected — users must split large files.

---

## v5.7.0 – 6 May 2026

### 🎯 Dynamic Call Outcomes — Config-Driven Outcome Management

Replaces hardcoded call outcomes with a fully dynamic, admin-configurable system. Super Admins can now enable/disable outcomes, create custom outcomes, require notes, and assign outcomes to behavioral groups — all from a new Sync tab in Settings, with zero code changes or redeployment needed.

### New Features

- **⚙️ Admin Outcome Configuration (Settings → Sync):** A new "Call Outcomes" card in the Sync settings tab provides full CRUD management of call outcomes:
  - Toggle any outcome enabled/disabled via switches
  - Create up to 10 custom outcomes with name, group, and action assignment
  - "Notes Required" checkbox per outcome — forces SDRs to provide notes when selecting that outcome
  - Custom outcomes display a ✦ badge and can be deleted; builtin outcomes cannot
  - Visual counter shows custom outcome slots used (X/10)
  - Save persists the full configuration to the database as JSON

- **🏷️ Outcome Groups & Actions:** Each outcome belongs to a behavioral group (`positive`, `negative`, `neutral`, `not_answered`, `terminal`) and has an associated action (`continue`, `schedule_callback`, `disqualify`, `no_action`). The `disqualify` action is restricted to the `terminal` group, enforced both client-side and server-side.

- **🚪 "Left the Company" Auto-Disqualification:** A new builtin outcome "Left the Company" (terminal group, disqualify action) automatically moves leads to "Disqualified" status when selected, streamlining the data hygiene workflow.

- **📝 Notes-Required Enforcement:** Outcomes flagged with `notes_required: true` block call logging until the SDR provides notes. The call logging modal dynamically renders the notes textarea and validation based on the selected outcome's configuration.

### Bug Fixes

- **📞 RCM API 400 "Invalid call_id" Fix:** Fixed HTTP 400 errors from the RCM API caused by legacy `DialerCall` records that stored phone numbers (e.g. `3634040093`) in the `provider_call_id` field instead of actual RCM call IDs. Added validation guards to `fetch_call()`, `get_call_status()`, and `get_recording_url()` that skip API calls when `provider_call_id` looks like a phone number (pure 7-15 digit string).

- **🧭 Navigation Test Stabilization:** Fixed 8 pre-existing Playwright test regressions caused by past navigation restructuring:
  - Lead Detail (#9): Fixed company group header rows interfering with row selectors
  - Analytics (#15, #23): Fixed ambiguous nav selectors when multiple "analytics" items exist
  - Assignments (#16): Adjusted tab detection selectors
  - Lead Filter (#17): Increased staging API timeouts for cold-start latency
  - Kanban (#10): Intentionally skipped (deprecated feature)
  - Admin Panel (#4): Increased `navigateTo()` wait from 1200ms → 2500ms for slow staging cold-starts
  - Assignments SDR Filter (#13): Corrected `#sdr-filter` → `#assigned-sdr-filter` (wrong element ID from pre-v4.8.1 rename)

### Backend

- **`backend/models.py`** — New `get_outcome_config(db)`, `get_valid_outcomes(db)`, `get_enabled_outcomes(db)`, `get_outcome_by_value(value, db)` helpers; DB-backed config with graceful fallback to defaults
- **`backend/routes/call_routes.py`** — `VALID_REASONS` and `DEFINITIVE_OUTCOMES` now derived from config at runtime; notes-required enforcement in `log_call`
- **`backend/routes/admin_routes.py`** — Full PATCH validation for `outcome_config`: required fields, duplicate detection, group/action compatibility, 10-outcome cap
- **`backend/rcm_provider.py`** — Phone-like `provider_call_id` guard on all API-calling methods
- **`scripts/migration/add_outcome_config_column.py`** — Idempotent migration to add `outcome_config` TEXT column to `SyncSettings`

### Frontend

- **`frontend/js/views/settings_sync.js`** — Interactive outcome configuration UI with toggle switches, group/action dropdowns, notes-required checkboxes, add/delete custom outcomes, and save with validation
- **`frontend/js/views/modals.js`** — Dynamic outcome dropdown and notes-required validation in the call logging modal
- **`frontend/index.html`** — Navigation restructured; Sync tab settings consolidated

### Testing

- **🧪 29 New API Tests:** `test_models.py` (9 tests), `test_call_routes.py` (7 tests), `test_admin_routes.py` (11 tests) — covering DB-backed config, runtime validation, PATCH validation, and edge cases
- **🧪 29 New Playwright E2E Tests:** `outcome-config-admin.spec.js` (12 tests) and `call-outcome-flow.spec.js` (8 tests) for admin UI and SDR flow; 9 additional tests in `super-admin-flow.spec.js` for previously uncovered Settings tabs and Metrics page
- **✅ 827 Backend Tests Collected** (51 RCM provider tests pass)
- **✅ 86/86 Playwright Tests Pass** (11 skipped — deprecated features)

### Database Migration

- **`outcome_config`** TEXT column added to `SyncSettings` table
- Migration script: `scripts/migration/add_outcome_config_column.py` (idempotent, safe to re-run)
- Must be run on production before deployment: `DATABASE_URL=<prod_url> python scripts/migration/add_outcome_config_column.py`

### Breaking Changes

- None. All existing outcomes continue to work. Default configuration matches the previous hardcoded behavior exactly.

---

## v5.6.0 – 4 May 2026

### 📞 RCM Dialer — WebRTC Browser Calling & Call Mode Selector

Stabilizes the RCM Contact Center browser-based calling experience with LiveKit WebRTC integration. SDRs now hear and speak through the browser directly — no external phone bridge required. A new in-dialer Call Mode Selector lets SDRs toggle between Browser Call and Phone Bridge modes before each call.

### New Features

- **🌐 LiveKit WebRTC Integration:** Calls via the RCM dialer now use the LiveKit WebRTC SDK (`livekit-client` v2.9.1) for real-time browser audio. When a call is initiated, the dialer widget automatically joins the LiveKit room, activates the microphone, and attaches remote audio streams — delivering sub-second voice connection with no external app
- **📞 Call Mode Selector:** Before placing a call, a new "How would you like to call?" dialog lets the SDR choose:
  - **🌐 Browser Call** (default) — call happens in-browser via WebRTC
  - **📱 Phone Bridge** — call is bridged to the SDR's registered phone number (requires admin configuration)
- **🔒 HMAC Authentication:** All RCM API calls now use the `RCMAuthManager` for secure HMAC token generation, replacing the previous credential-based approach
- **📦 Payload Alignment:** Removed legacy/unsupported fields (`senderId`, `callMode`) from the `initiate_call` API payload, ensuring strict alignment with the RCM API v2 specification

### Backend

- **`backend/rcm_provider.py`** — HMAC auth via `RCMAuthManager.get_token()`; cleaned `initiate_call` payload
- **`backend/dialer_service.py`** — Updated provider factory with `call_mode` → `use_agent_phone` mapping
- **`backend/routes/dialer_routes.py`** — Added `call_mode` parameter propagation from frontend to provider

### Frontend

- **`frontend/index.html`** — Added `livekit-client` v2.9.1 CDN script for WebRTC support
- **`frontend/js/app.js`** — `handleCallAction()` passes selected `call_mode` through to the API layer
- **`frontend/js/views/dialer_widget.js`** — Complete WebRTC lifecycle: Room join → microphone activation → remote audio attachment → graceful disconnect. Call Mode Selector UI with radio buttons and mode descriptions

### Testing

- **🧪 773 Tests Passing (0 Failed):** Updated `test_rcm_floating_button.py` edge case tests to correctly mock `RCMAuthManager` HMAC auth and the updated payload structure
- **✅ 18 Edge Cases Verified:** Duplicate prevention, null/empty IDs, special characters, concurrent calls, and WebRTC cleanup scenarios

### Known Limitations

- Phone Bridge mode requires admin-configured SDR phone numbers (not yet available in production)
- Hold action and recording playback await further backend webhook integration
- Network reconnection during WebRTC calls relies on default LiveKit SDK behavior

### Breaking Changes

- None. Aircall integration is fully preserved. Default call mode is Browser Call. SDRs must be explicitly assigned to `rcm` to see the new dialer.

### Migration Notes

- No database migrations required for this release.
- WebRTC requires HTTPS and microphone permissions in the browser.

---

## v5.5.0 – 4 May 2026

### 🐛 Bug Fix: "15 Unassigned" in Upload History

Fixed a UI bug where all rows in the Upload Center batch detail showed "15 Unassigned" regardless of actual SDR assignments. Root cause was a hardcoded `per_page: 15` limit and the frontend reading the wrong field name (`sdr_name` instead of `assigned_to`).

### 🏷️ Feature: Upload Tagging System

Added an optional free-text **Tag** field to the upload wizard. Users can tag uploads with a source label (e.g. "Apollo", "Lusha", "Hunter") to track where enriched lead lists originated.

- Tag input available in both **CSV Upload** and **Google Sheets Import** wizards
- Tags are displayed as a 🏷️ chip next to the filename in the upload history table
- Tags are stored in the database and exposed via API for future filtering/reporting
- Empty or whitespace-only tags are stored as NULL (no tag)

### 📊 Daily Digest: Working-Day Comparisons

The Daily Digest now intelligently skips weekends when computing trend comparisons. Previously, requesting a Saturday or Sunday digest would compare against the previous Saturday/Sunday — which typically had no data, producing misleading "∞% change" metrics.

- **Weekend auto-shift**: Saturday/Sunday requests automatically shift to the previous Friday
- **Comparison date alignment**: The comparison date (last week) also shifts to the nearest working day
- **Adjustment banner**: A blue info banner appears in the digest header when a weekend date was auto-adjusted
- Response includes `is_working_day` and `original_date` metadata

### Tests

- 15 new test cases covering all three changes in `test_v26_upload_tag_digest.py`
- Full regression suite: 730 passed, 0 failures

### Backend

- **`backend/models.py`** — Added `tag` column (VARCHAR, nullable) to `LeadUploadLog`
- **`backend/migrations.py`** — V26 migration for `tag` column
- **`backend/routes/admin_routes.py`** — Tag ingestion/exposure in upload + batch APIs, `sdr_name` convenience field
- **`backend/routes/analytics_routes.py`** — `_prev_working_day()` helper, weekend adjustment logic

### Frontend

- **`frontend/js/api.js`** — Tag parameter added to `uploadLeadSheet()` and `importGoogleSheet()`
- **`frontend/js/views/upload.js`** — Tag UI inputs, tag chip in history, fixed field mapping
- **`frontend/js/views/upload_csv.js`** — Tag state management for CSV wizard
- **`frontend/js/views/upload_gsheet.js`** — Tag state management for GSheet wizard
- **`frontend/js/views/digest.js`** — Weekend adjustment info banner

---

## v5.4.0 – 29 April 2026

### 📞 RCM Contact Center Dialer — Dual-Dialer Architecture

Adds a second dialer provider (RCM Contact Center) alongside the existing Aircall integration. SDRs can now be individually assigned to either dialer, and calls via RCM happen directly in the browser using a LiveKit-based WebRTC widget.

### New Features

- **📞 RCM Contact Center Provider:** Full integration with the RCM Contact Center API for browser-based calling. Supports call initiation, hold, mute, disconnect, call status polling, recording retrieval, and transcript display
- **🌐 In-Browser Dialer Widget:** A floating, draggable WebRTC call widget powered by LiveKit. Includes real-time call duration timer, mute/hold/hangup controls, recording indicator, and glassmorphic styling with mobile-responsive layout
- **👤 Per-SDR Dialer Routing:** Each SDR can be assigned a dialer provider (`aircall` or `rcm`) via the `dialer_provider_override` column in user settings. The system dynamically resolves the correct provider at call time
- **🔄 Dual-Sync Architecture:** Nightly call sync and startup catch-up jobs now support both providers — each provider's sync runs independently, ensuring call history stays complete for all SDRs regardless of their dialer assignment
- **🔗 Webhook Support:** Dedicated webhook endpoint (`/api/webhooks/rcm`) for real-time call event processing — handles call started, answered, ended, and failed statuses with automatic call log updates
- **📋 Call History Provider Badge:** The Calls tab on lead detail now shows a "via RCM" badge for calls made through the RCM dialer, alongside the existing "via Aircall" badge

### Backend

- **`backend/rcm_provider.py`** — New file. Full `DialerProvider` implementation with retry/exponential backoff for API resilience
- **`backend/routes/dialer_routes.py`** — Added `/api/calls/{id}/action` (hold/mute) and `/api/calls/disconnect` endpoints, plus `/api/webhooks/rcm` webhook receiver
- **`backend/dialer_service.py`** — Updated provider factory to support `rcm` alongside `aircall`
- **`backend/scheduled_jobs.py`** — Dual-sync architecture for nightly and startup call synchronization
- **`backend/models.py`** — Added `dialer_provider_override` field to User model

### Frontend

- **`frontend/js/views/dialer_widget.js`** — New file. Complete in-browser dialer widget with call state management
- **`frontend/js/app.js`** — Integrated `handleCallAction()` to auto-launch widget when RCM call returns LiveKit credentials
- **`frontend/js/api.js`** — Added call action and disconnect API functions
- **`frontend/js/views/lead_calls_tab.js`** — Provider badge support for RCM calls
- **`frontend/css/style.css`** — ~200 lines of dialer widget CSS with glassmorphism and animations

### Testing

- **🧪 51 New Tests:** Comprehensive test suite (`test_rcm_provider.py`) covering constructor/URL normalization, auth headers, call initiation (browser + phone bridge), disconnect, hold/mute actions, status polling, recording retrieval, webhook parsing (all event types), pagination, timestamp parsing, and HTTP retry logic (429 backoff, 500 immediate fail)
- **✅ 701 Total Tests Passing:** Full regression suite green (0 failures)

### Breaking Changes

- None. Aircall integration is fully preserved. The default provider remains `aircall` — SDRs must be explicitly assigned to `rcm` to use the new dialer.

### Migration Notes

- No database migrations required for this deployment phase. The `dialer_provider_override` column can be set directly in the database or via a future admin UI.

---

## v5.3.0 – 28 April 2026

### 🔄 Batch Rollback, Data Alignment & UX Stability

This release introduces a 12-hour batch rollback feature for upload safety, aligns lead list counts with dashboard metrics by globally excluding parked leads, and improves the Upload History and sidebar UX for admins.

### New Features

- **🔄 12-Hour Batch Rollback:** Admins can undo an entire import batch (CSV or Google Sheet) within 12 hours of upload. Leads that have been worked (call history, status changes beyond initial assignment) are protected and excluded from rollback. A real-time countdown timer shows remaining rollback window in the Upload History UI
- **📋 Expandable Upload History:** Upload History rows now expand to show per-SDR assignment details — which SDR received which leads — directly in the row, without navigating away
- **⏱️ Rollback Countdown Timer:** A live countdown badge shows the remaining rollback window (e.g. "11h 42m remaining") for each eligible batch. Expired batches show an "Expired" badge

### Bug Fixes

- **📊 Lead Count Alignment:** Dashboard and Leads page now show identical counts. Leads with parked statuses (e.g., "No Phone - Parked") are globally excluded from list/kanban views to match dashboard metrics
- **🤖 AI Research Auto-Trigger Fix:** Relaxed the AI Research auto-trigger condition — now fires when fewer than 3 research fields are filled (previously required exactly 0), fixing cases where partial research blocked auto-population

### Improvements

- **📅 Sidebar Reorganization:** "Daily Digest" moved directly below "Dashboard" for better admin accessibility. "Today's Calls" restricted to SDR role only — hidden for Super Admin and Pod Admin
- **🔒 Rollback Safety Guards:** Protected leads with call history, status changes, or progressed statuses from accidental deletion during rollback. Uses row-level locking (`SELECT FOR UPDATE`) to prevent concurrent rollback conflicts

### Testing

- **🧪 26 New Stability Tests:** Comprehensive test suite (`test_stability_ux_fixes.py`) covering all rollback edge cases (expiry, protected leads, concurrent access), parked-lead filtering, and assignment detail queries
- **🔧 10 Pre-Existing Test Fixes:** Resolved admin test failures caused by missing phone numbers in test data — aligned test fixtures with the v5.2.0 phone validation business logic
- **✅ 104/104 Tests Passing:** Full regression suite green across admin, lead, and stability test suites

### Technical Details

- **Backend:**
  - `backend/routes/admin_routes.py` — New `POST /api/admin/leads/upload-logs/{log_id}/rollback` endpoint with 12h window, `FOR UPDATE` locking, cascading cleanup of `LeadStatusLog`, `DialerCall`, and associated metadata
  - `backend/routes/lead_routes.py` — Added `PARKED_STATUSES` exclusion to `get_leads`, `get_my_leads`, and `get_kanban_leads` endpoints
  - `backend/tests/test_stability_ux_fixes.py` — **New file.** 26 tests covering rollback, parked-lead filtering, and UX logic
  - `backend/tests/test_admin_routes.py` — Fixed 10 test failures by adding valid phone numbers to test fixtures

- **Frontend:**
  - `frontend/js/views/upload.js` — Overhauled Upload History: rollback buttons, expandable assignment rows, countdown timers, status indicators
  - `frontend/js/api.js` — Added `rollbackUploadBatch()` API function
  - `frontend/js/views/lead_detail.js` — Relaxed AI Research auto-trigger from `=== 0` to `< 3` fields
  - `frontend/js/app.js` — "Today's Calls" hidden for non-SDR roles
  - `frontend/index.html` — "Daily Digest" moved below "Dashboard" in sidebar

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.
- Rollback window is fixed at 12 hours from upload timestamp — not configurable in this release.

---

## v5.2.0 – 27 April 2026

### 📵 No-Phone Lead Quarantine — Data Quality & SDR Protection

Leads without valid phone numbers now automatically bypass SDR assignment and are quarantined into a "No Phone - Parked" status. This ensures SDRs only receive actionable leads and that analytics reflect accurate performance data.

### New Features

- **📵 Phone Validation on Upload:** CSV and Google Sheet imports now validate phone fields (`phone`, `phone_secondary`, `company_phone`). Rows without any valid phone number (≥7 digits) are skipped with a count reported in the upload response (`no_phone_skipped`)
- **🚫 Status Quarantine:** Phoneless leads are set to `"No Phone - Parked"` status — a new quarantine state that prevents assignment to SDRs
- **🔄 Auto-Revert on Phone Addition:** When a phone number is added to a parked lead, its status automatically changes to `"Lead Assigned"`. If an SDR adds the number, the lead is assigned to them; if an Admin/Pod Admin adds it, the lead stays unassigned
- **📊 Dashboard "No Phone" Card:** Admin dashboard now shows a red-accented 📵 card displaying the count of parked leads needing phone numbers
- **🔒 Assignment Guards:** Both `bulk-assign` and `auto-assign-all` endpoints now filter out parked leads, preventing accidental assignment

### Improvements

- **📈 Analytics Accuracy:** Parked leads are excluded from the analytics funnel, SDR performance table, and daily digest — ensuring metrics reflect only actionable pipeline
- **📋 Dashboard Stats Accuracy:** Total Leads count on the dashboard excludes parked leads to show actionable lead count only

### Technical Details

- **Backend:**
  - `backend/models.py` — Added `PARKED_STATUSES = {"No Phone - Parked"}` constant
  - `backend/routes/admin_routes.py` — `_has_valid_phone()` and `_lead_data_has_phone()` helpers; upload validation + assignment guards
  - `backend/routes/lead_routes.py` — Auto-revert logic in `update_lead`; parked exclusion in `get_dashboard_stats`
  - `backend/routes/analytics_routes.py` — Parked lead exclusion in funnel, SDR table, and daily digest queries

- **Frontend:**
  - `frontend/js/views/dashboard.js` — New "No Phone" stat card with red accent (admin-only, conditional)

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- One-time bulk cleanup required: existing phoneless leads must be migrated to "No Phone - Parked" status and unassigned. A cleanup script is provided at `backend/scripts/staging_cleanup_phoneless.py`.

---



### 📊 Daily Digest — Super Admin Leadership Summary

A new one-page operational summary designed for Super Admin leadership, providing high-signal visibility into daily SDR performance without navigating multiple screens.

### New Features

- **📊 Daily Digest Page (Super Admin Only):** A dedicated dashboard accessible from the sidebar with a single-page summary of the day's operational health:
  - **6 KPI Cards with Deltas:** Leads Assigned, Calls Made, Connect Rate, Meetings Booked, Emails Sent, and Disqualified — each showing a percentage delta comparison vs. the same weekday from the previous week
  - **Pipeline Flow Transitions:** Visual breakdown of leads moving between pipeline stages during the selected day
  - **SDR Performance Snapshot:** Activity-sorted table of all SDRs with their day's calls, emails, meetings, and research completions
  - **Notable Events:** Auto-detected highlights including top performer of the day, stuck leads (no activity in 7+ days), and batch uploads
  - **Date Picker:** Navigate to any historical date to review past digests (future dates blocked)
  - **PDF Export:** One-click download of the digest as a formatted PDF for sharing with stakeholders

### Performance Improvements

- **⚡ Assignment Endpoints Optimization:** Switched unassigned/assigned lead endpoints from full `_lead_to_dict` serialization to lightweight `_lead_to_summary` — reducing payload size and response time for admin assignment views
- **🔧 N+1 Query Fix:** Replaced `joinedload` with `subqueryload` for call_logs in assignment routes, eliminating redundant queries on large lead sets
- **📅 Chronological Sorting:** Added `created_at` field to summary serializer and applied descending sort by creation date for consistent lead ordering

### Technical Details

- **Backend:**
  - `backend/routes/analytics_routes.py` — New `GET /api/admin/analytics/daily-digest` endpoint with 6 optimized queries; Super Admin only; date-scoped with weekday-aware delta calculation
  - `backend/routes/_lead_helpers.py` — Added `created_at` to `_lead_to_summary()` output
  - `backend/routes/admin_assignment_routes.py` — `subqueryload` for call_logs, `order_by(created_at.desc())`, switched to `_lead_to_summary`
  - `backend/routes/admin_routes.py` — Same optimization applied to legacy assignment endpoints

- **Frontend:**
  - `frontend/js/views/digest.js` — New async digest view with skeleton-first loading
  - `frontend/css/digest.css` — Dedicated stylesheet (~566 lines) for digest layout, KPI cards, delta badges, and PDF export formatting
  - `frontend/index.html` — Digest CSS and nav item registered
  - `frontend/js/app.js` — Digest route registered with Super Admin guard

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.

---

## v5.0.1 – 22 April 2026

### 🔧 Post-Deploy Stabilization — Security, UX & UI Fixes

This patch release addresses three issues discovered during post-deployment verification of v5.0.0. All three were deployed same-day after validation on staging.

### Security Fix

- **🔒 View-As Token Isolation:** Fixed a critical bug where the "View As" feature (Super Admin impersonating another role) permanently overwrote the admin's own JWT token in `localStorage`, causing the admin's actual role to change after exiting View-As mode. The fix uses `sessionStorage` for the impersonated token, preserving the original token in `localStorage`. A visual amber banner now clearly indicates when View-As mode is active, with a one-click "Exit" button that restores the original session.

### New Features

- **⌨️ Search Hotkeys (⌘K / Ctrl+K):** Added keyboard shortcuts to instantly focus the global search bar. Press `⌘K` (Mac) or `Ctrl+K` (Windows/Linux) from anywhere in the app. Additionally, pressing `/` (forward slash) also focuses the search bar when not already in a text input. A subtle `⌘K` hint badge is now displayed inside the search bar placeholder.

### Bug Fixes

- **📦 POD Management — Add SDR Dropdown Overflow:** Fixed the "Add SDR" dropdown in POD Management being clipped/hidden behind the card boundary. Root cause: the parent `.pod-card` container had `overflow: hidden` which clipped the absolutely-positioned dropdown. Fixed by setting `overflow: visible` on pod cards and adding `z-index: 1000` to the dropdown to ensure it renders above adjacent cards.

### Technical Details

- **Frontend:**
  - `frontend/js/auth.js` — `parseJwt()` refactored to read from `sessionStorage` first (View-As token), falling back to `localStorage` (real token). New `enterViewAs()` / `exitViewAs()` helpers manage token lifecycle.
  - `frontend/js/app.js` — Added `⌘K` / `Ctrl+K` / `/` keyboard event listeners with `preventDefault()` to avoid browser address bar hijack. Search bar now displays a `⌘K` hint badge. Event listeners exclude focus when user is already in an input/textarea/contenteditable element.
  - `frontend/css/style.css` — Added `.pod-card { overflow: visible }` and `.add-sdr-dropdown { z-index: 1000 }` to fix dropdown clipping. Added View-As banner styling (`.view-as-banner`) with amber background and slide-down animation. Added `⌘K` hint badge styling.
  - `frontend/js/views/pods.js` — No logic changes; CSS-only fix for dropdown overflow.

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.
- Super Admins currently in View-As mode should log out and log back in to pick up the new token isolation behavior.

---

## v5.0.0 – 22 April 2026

### 🚀 Performance & UX Re-Engineering

This major release addresses critical user-reported workflow latency, navigation bugs, timezone discrepancies, and search limitations. All changes are targeted at reducing SDR friction and improving platform responsiveness.

### New Features

- **📞 Universal Search — Phone Number Support:** The global search bar now indexes `phone` and `phone_secondary` fields. SDRs can search leads by phone number (full or partial match), including E.164 format with `+` prefix. Search results display the phone number when matched.
- **💀 Skeleton-First Architecture:** All blocking spinner-based loading states in **Admin**, **Assignments**, and **Audit Logs** views have been replaced with animated skeleton loaders (`showLoader()`). This provides immediate visual feedback during API fetches, reducing perceived load time by 60-80%.

### Bug Fixes

- **🔄 Leads Tab State Persistence:** Fixed the issue where switching tabs (e.g. Leads → Dashboard → Leads) reset all filters, pagination, and sort settings to defaults. The `sessionStorage` state is now preserved across navigation and only clears naturally on browser tab close. Users can still use "Clear Filters" to reset manually.
- **⏰ Task Reminder Timezone Fix:** Fixed task reminders firing 5+ hours late (e.g. 11 AM reminder alerting at 4:30 PM). Root cause: frontend was sending naive ISO strings (`YYYY-MM-DDTHH:MM:SS`) without timezone offset, which the backend parsed as UTC. Now uses `toISOString()` to convert local time to UTC before submission.
- **📅 Notification Delay Fix:** Same timezone root cause as above — notifications set for morning were appearing the next day due to UTC/local time mismatch.
- **📊 Analytics Trend Chart 500 Error:** (v4.13.1 hotfix) Fixed `AttributeError: type object 'Lead' has no attribute 'updated_at'` by switching to `status_changed_at` in the trend query.

### Technical Details

- **Backend:**
  - `backend/routes/search_routes.py` — Added `models.Lead.phone.ilike()` and `models.Lead.phone_secondary.ilike()` to both admin and SDR search query paths
  - `backend/routes/analytics_routes.py` — Fixed `updated_at` → `status_changed_at` in trend endpoint
  - `backend/tests/test_search_routes.py` — **New file.** 18 comprehensive test cases covering phone search (primary, secondary, partial match, E.164 format, dashes, null phone edge case), SDR scope enforcement, SQL injection safety, result limits, and edge cases

- **Frontend:**
  - `frontend/js/views/admin.js` — Imported `showLoader`, replaced inline spinner
  - `frontend/js/views/assignments.js` — Imported `showLoader`, replaced inline spinner
  - `frontend/js/views/audit_logs.js` — Replaced inner `loadTab()` spinner with skeleton rows
  - `frontend/js/views/sdr_settings.js` — Imported `showLoader`, replaced inline spinner
  - `frontend/js/views/sf_logs.js` — Replaced table and detail modal spinners with skeleton rows
  - `frontend/js/views/audit_sf_logs.js` — Replaced detail modal spinner with skeleton rows
  - `frontend/js/app.js` — Removed aggressive `sessionStorage.removeItem('leads_view_state')` on navigation; added `sessionStorage.clear()` on logout to prevent state leaking between users; added phone display in search results with hover effects
  - `frontend/js/views/lead_detail.js` — Changed task `due_time` from `${date}T${time}:00` to `new Date(...).toISOString()` for correct timezone handling
  - `frontend/index.html` — Updated search placeholder to "Search leads, phone, SDRs..."

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.
- Existing task reminders created before this fix may still have incorrect UTC offsets. New tasks created after deployment will use correct timezone handling.

---

## v4.13.0 – 21 April 2026

### New Features

- **🔌 Public API — CMT ↔ Salesforce Bridge:** A new authenticated Public API allows external tools (e.g. CMT) to query RCM's configured Salesforce connection without requiring Google SSO.
  - **Endpoint:** `GET /api/public/sf/account` — looks up a Salesforce Account (or Lead fallback) by `rcm_messaging_id` or `company_name`
  - **Auth:** `X-API-Key: <key>` header — key generated and revoked by Super Admins in Settings → Public API tab
  - **Lookup Priority:** Account by RCMMessaging_AccountId__c → Account by Name (exact then LIKE) → Lead fallback (same logic)
  - **Response:** Returns `sf_account_id`, `account_name`, `sf_url` (Lightning deep-link), `confidence` (exact/like), `matched_by`, optional `candidates[]` when LIKE fallback returns multiple matches
  - **Health Check:** `GET /api/public/health` — unauthenticated liveness probe

- **⚙️ Public API Admin UI (Settings → Public API tab):**
  - Generate / Revoke API key with one click
  - Copy-to-clipboard key display (shown only once on generation)
  - Live status indicator (Active / Not configured)
  - Quick-reference API documentation inline

- **📖 Help Guide — APIs Section:** New "🔌 APIs" section in the Help guide (Super Admin only) documenting the Public API endpoints, request/response format, and auth requirements

### Bug Fixes

- **🔑 Public API 401 Fix:** Fixed 401 Unauthorized errors on the Public API admin tab caused by the frontend sending the wrong `localStorage` key (`rcm_token` instead of `crm_token`) when authenticating admin requests
- **🔧 Admin Routes 500 Fix:** Fixed 500 Internal Server Error on `POST /api/admin/public-api-key/generate` caused by a missing `logger` definition in `admin_routes.py` (NameError at runtime)
- **🏢 Company Ownership on Re-Upload (Critical Fix):** Fixed a lead assignment bug where uploading a new batch containing companies that already existed in a previous batch would split those companies across multiple SDRs. The `pod_company_sdr_map` was an in-memory dict re-initialized each upload, so cross-batch company ownership was invisible to the assignment logic. Now queries the DB before falling back to round-robin — if the company already has an SDR owner in the pod, new leads for that company go to the same SDR. Fix applied to both CSV upload and Google Sheets import routes.

### Technical Details

- **Backend:**
  - `backend/routes/public_api_routes.py` — New file. Public API router with `/health` and `/sf/account` endpoints; SOQL injection protection via `_escape_soql()`; SF URL builder handles both `sf_instance` and `base_url` attributes
  - `backend/auth.py` — Added `require_api_key` dependency: reads `X-API-Key` header, decrypts stored key using `APP_ENCRYPTION_KEY`, compares using `hmac.compare_digest` (timing-safe)
  - `backend/models.py` — Added `PublicApiKey` model (id, key_encrypted, created_at, created_by)
  - `backend/migrations.py` — Migration V23: creates `public_api_keys` table
  - `backend/main.py` — Registered `public_api_router`
  - `backend/routes/admin_routes.py` — Added `GET /api/admin/public-api-key/status` and `POST /api/admin/public-api-key/generate` and `DELETE /api/admin/public-api-key/revoke` endpoints; added missing `logging` import
  - `backend/routes/admin_upload_routes.py` — Added `_get_existing_company_sdr_in_pod()` helper; DB lookup injected before round-robin in both `upload-sheet` and `import-gsheet` routes
- **Frontend:**
  - `frontend/js/views/settings.js` — New Public API tab with key generation, revoke, copy, and status UI; fixed `localStorage` key from `rcm_token` → `crm_token`
  - `frontend/js/views/user_guide.js` — New APIs section (Super Admin only) with endpoint docs

### Security

- API key stored encrypted at rest using `Fernet` symmetric encryption (`APP_ENCRYPTION_KEY`)
- Key comparison uses `hmac.compare_digest` to prevent timing attacks
- Key is only shown once at generation — not recoverable from the UI after that point

### Breaking Changes
None — Public API is additive. All existing endpoints unchanged.

---

## v4.12.0 – 20 April 2026

### New Features

- **📊 Analytics Dashboard Redesign (Super Admin):** Full redesign of the Analytics Dashboard for the Super Admin persona — unified, hierarchical, and context-aware view of all SDR activity.

  **Filter Hierarchy (strict top-to-bottom):**
  - ① POD → ② Date Range → ③ Batch → ④ Date/Time Refinement
  - Step Pills guide the user through each stage; downstream filters are visually locked and disabled until their prerequisite is selected
  - Batch filter labels follow the format: `[Source] · [Date]` (e.g. `Upload · Apr 10`, `Google Sheet · Apr 14`)
  - Breadcrumb trail anchors the current filter context persistently at the top of the page

  **Insight Bar:**
  - Rule-based status tags (e.g. `🔴 No Calls Today`, `🟡 Low Connect Rate`, `🟢 On Track`)
  - Live AI Recommendation tag — Groq-backed, non-blocking load, 2-minute client cache

  **Funnel Strip:** Horizontal `Leads → Calls → Connects → Meetings` with conversion % between each stage

  **6 KPI Metric Cards:** Leads, Research, Emails, Calls, Connect %, Disqualified

  **Trend Chart:**
  - 5 metric toggles: Calls, Meetings, Research, Disqualified, Emails
  - Scrollable SDR pills to scope the chart to a single SDR without changing global filters

  **All Batches Mode:**
  - View toggle switches the SDR table to a full-width batch comparison table
  - Shows per-batch: Leads, Calls, Connect %, Meetings, Emails — with a totals row and source icons

### Technical Details

- **Backend (`analytics_routes.py`):** Extended `/filters` to accept `pod_id`, `date_from`, `date_to` for scoped batch retrieval; extended `/trend` with `research` and `disqualified` series and `sdr_id` scoping; added `POST /ai-recommendation` (Groq-backed, 2-min server-side cache); added `/batch-summary` for All Batches comparison table
- **API (`api.js`):** Added `fetchAnalyticsAiRecommendation()`, `fetchAnalyticsBatchSummary()`, updated `fetchAnalyticsFilters()` to accept scope params
- **Frontend (`analytics.js`):** Full rewrite — skeleton-first loading, module-level state, strict filter cascade, breadcrumb, insight bar, trend chart with toggles and SDR pills, All Batches table
- **CSS (`style.css`):** ~260 lines added — step pills, breadcrumb, insight bar AI skeleton, funnel strip, 6-col KPI grid, SDR pills, metric toggles, connect % badges, batch comparison table

### Breaking Changes
None — additive-only change. All existing analytics behavior preserved when no new filters are used.

---

## v4.12.0 (patch) – 20 April 2026

### Improvements

- **🔍 Searchable SDR Picker:** Replaced the horizontal scrollable SDR pill row with a compact, search-driven picker. Includes an "All SDRs" reset button, a search input that filters the full SDR list (not just pod-scoped), and a dismissable chip showing the selected SDR.
- **📐 Chart Layout Fix:** The trend chart panel and SDR performance panel are now independently sized (`align-items: start` on the grid). Previously the chart would stretch to match the tall SDR table, creating an oversized, empty chart area.
- **🗂 SDR Panel Scroll:** The SDR performance panel is capped at `max-height: 440px` with internal `overflow-y: auto`. The table scrolls inside the panel — no more whitespace below the chart when many SDRs are shown.
- **⏩ Compact Pagination:** Replaced large "Prev / Next" buttons with compact `←` / `→` icon buttons and a `N / M` page indicator to reduce vertical footprint.

### Bug Fixes

- Fixed SDR search returning "No SDRs found" when a pod filter was active (was searching the pod-filtered list instead of `_allSdrs`).
- Fixed "All SDRs" pill toggle not deselecting after clicking it while already selected.
- Fixed Y-axis scale resetting incorrectly when switching metric toggles.
- Fixed chart canvas overflowing its container on wide viewports (added `overflow: hidden` + `min-width: 0` to panel).

### Breaking Changes
None


## v4.11.2 – 19 April 2026

### Bug Fixes

- **📊 Batch Filter Fix (Critical):** Fixed the analytics dashboard showing 0 leads and incorrect metrics when a batch is selected. Root cause: the `leads` table has no `upload_log_id` column, and the previous fallback used `lead_source == "uploaded"` which excludes the majority of leads (which use `gsheet:` or `upload:` prefixes). New approach: resolves the batch UUID to the actual `lead_source` string (e.g., `gsheet:Google Sheet:2026-04-16T10:51:38`) via filename prefix matching and applies exact-match filtering across ALL analytics endpoints
- **📈 Consistent Batch Filtering Across All Endpoints:** Extended batch filter support to `/trend`, `/sdr-table`, and `/email-breakdown` endpoints — previously only `/funnel` attempted (broken) batch filtering
- **📧 Email Breakdown Source Filter:** Fixed the email-breakdown endpoint using exact-match instead of LIKE for prefix-based source filters (google_sheet, uploaded), ensuring correct email counts when filtering by source

### Technical Details

- New helper: `_resolve_batch_lead_source(db, upload_log_id)` — resolves batch UUID → exact `lead_source` string via filename prefix + time-window matching
- Removed broken `upload_log_id` column reference in `_apply_lead_filters()`
- All 4 analytics endpoints now accept `upload_log_id` query param and apply consistent batch filtering
- When no batch is selected, ALL behavior is 100% unchanged (additive-only fix)

### Verification

- **42 passed, 5 xfailed** (unchanged test results)
- Production DB verification: Apr 16 batch correctly resolves to 842 leads, 87 calls, 1 meeting
- Cross-verified all 3 production batches resolve correctly

### Breaking Changes
None

---

## v4.11.1 – 19 April 2026

### Bug Fixes

- **📊 Source Filter Normalization:** Cleaned up lead source dropdown in Analytics. Raw import strings like `gsheet:Google Sheet:2026-03-25` are now normalized to clean labels (Google Sheet, Uploaded, Salesforce, Manual). All 7 analytics endpoints use consistent prefix-based matching via a shared `_lead_source_filter()` helper
- **👥 Pod Filter Missing:** Fixed the Pod filter not rendering for Super Admins. Root cause: the code read from a non-existent `localStorage('crm_user')` key. Now imports `isSuperAdmin` directly from `auth.js` (decoded from the JWT)
- **🔗 Pod → SDR Cascading Filter:** Added `pod_id` to SDR objects in the `/filters` API. Selecting a Pod now dynamically filters the SDR dropdown to show only SDRs in that Pod
- **☑️ Inactive SDR Detection:** Overhauled the inactive SDR logic. SDRs are now flagged as inactive if they have `NULL last_login_at` AND zero activity (no calls + no emails). Previously, the 90-day threshold was never met on staging where all SDRs had NULL login timestamps
- **📅 Meetings Count Accuracy:** Fixed meetings count showing `0` for time-filtered views. Meetings are now counted from ALL leads assigned to an SDR regardless of lead creation date, since meetings reflect historical pipeline success
- **📡 Activity Feed Placement:** Moved the "Show Activity Feed" toggle from below all content to between the SDR Performance table and the Activity Trend chart for better visibility

### Testing

- **🧪 5 New Backend Tests:** Source normalization, SDR `pod_id` inclusion, meetings count accuracy, inactive SDR flag logic, and `{value, label}` filter response structure
- **42 passed, 5 xfailed** (Postgres `date_trunc` — expected on SQLite)

### Breaking Changes
None

---

## v4.11.0 – 18 April 2026

### New Features

- **Analytics Hub:** Unified dashboard replacing the separate "SDR Metrics" and "Activity Feed" nav items.
  - **4 KPI cards:** Leads Assigned, Research Complete (with 5-field breakdown), Emails Sent, Calls Made, Connect Rate, Avg Retries, Meetings Booked
  - **Research deep-dive:** Company / Contact / Hypothesis / Personalization / Hook each shown with fill-rate bar as a current snapshot
  - **Email funnel:** Sent → Opened → Replied broken down by sequence stage (Intro, Follow-up 1, Follow-up 2, Additional)
  - **Activity trend chart:** Auto-granularity (daily ≤14d / weekly ≤90d / monthly), stacked Chart.js line chart
  - **SDR performance table:** Sortable, paginated, optional inactive-SDR toggle; per-row calls, connect rate, emails, meetings
  - **Shared filter bar:** Period presets (7D / 30D / 90D / All) + custom date range + Pod (Super Admin only) + Lead Source + Upload Batch; all filters persist state via URL-safe state in memory
  - **CSV export:** Streaming download via authenticated fetch blob — no token-in-URL exposure
  - **Async skeleton-first loading:** All 4 sections load independently and simultaneously; no section blocks another; skeleton shimmer renders in <5ms
  - **Server-side TTL cache (2 min):** Near-instant warm loads for high-volume datasets; invalidated on filter change
  - **Access control:** Pod Admins auto-scoped server-side; Super Admins have full cross-pod visibility
  - **Edge-case safety:** Division-by-zero via `NULLIF`, NULL call outcomes excluded from connect-rate denominator, legacy outcome normalisation at query time

### Internal / Backend

- `backend/routes/analytics_routes.py` — 6 endpoints: `/funnel`, `/trend`, `/sdr-table`, `/email-breakdown`, `/filters`, `/export`
- `frontend/js/views/analytics.js` — new async analytics view
- `frontend/js/api.js` — 6 new export functions for Analytics Hub
- `frontend/css/style.css` — analytics component styles added
- `frontend/index.html` — new `analytics-nav-item` (visible to all Admins)
- `frontend/js/app.js` — analytics route registered; old `metrics` / `activity-feed` routes redirect to `analytics`
- `backend/main.py` — analytics router registered

### Removed

- "SDR Metrics" and "Activity Feed" sidebar items hidden; both routes redirect to the unified Analytics hub

---

## v4.10.3 – 16 April 2026 (Security Hotfix)


### Bug Fixes

- **🔒 Dashboard Priority Queue — Phone Masking (Hotfix):** Fixed a data-leakage bug where SDRs could see full phone numbers in the Dashboard Priority Queue before completing research. The `dashboard.js` render path was missing the `research_complete` gate that already existed in `lead_list.js`. SDRs now see a **🔒 Hidden** badge until research is complete. The **Call** button is also blocked for masked leads to prevent the number leaking via `data-phone`. Admins are unaffected.

### Breaking Changes
None

---

## v4.10.2 – 16 April 2026

### Improvements (Internal Architecture)

- **🏗️ Admin Route Modularization (Phase 2):** Split the monolithic `admin_routes.py` into focused sub-modules:
  - `admin_user_routes.py` — user management and access control
  - `admin_assignment_routes.py` — lead assignment and bulk operations
  - `admin_upload_routes.py` — lead import, preview, and log management
  - `_admin_helpers.py` — shared utilities (lead caps, sync settings, email validation)
  - `admin_routes.py` retained as a backward-compatible thin shim/coordinator
- **🧩 Circular Dependency Elimination:** Extracted shared logic into `_admin_helpers.py` to decouple modules and prevent import cycles
- **📧 Email Sanitizer Fix:** `email_utils.py` signature stripping now correctly handles `Best regards,` and `--` patterns. Default `max_len` set to 200

### Breaking Changes
None — existing imports continue to work via the shim

---

## v4.10.1 – 16 April 2026

### Testing

- **🧪 Test Suite Stabilization (448 passing, 2 xpassed):** Resolved all failing tests following the Phase 2 modularization:
  - `TestSanitizePreview` — updated assertions to match new signature-stripping and `max_len=200` defaults
  - `TestSyncThreadMessages` — fixed `ValueError` by ensuring `JWT_SECRET` is set at the module level in test files
  - Full 448-test suite green; no regressions

### Breaking Changes
None

---

## v4.10.0 – 16 April 2026

### New Features

- **📂 Batch Tracker in Upload Center (Admin Only):** Moved the Upload Batch Tracker out of the Activity Feed and into a dedicated **"📂 Batch Tracker"** tab inside the Upload Center for a cleaner, more intuitive workflow:
  - **Summary stat cards** — Total Batches, Total Leads in DB, Meetings Scheduled, Overall Conversion %
  - **Date range filter** — All Time / Today / Last 7 Days / Last 30 Days / This Quarter
  - **POD filter** — Scopes all metrics and lead counts to a selected POD
  - **Expandable batch cards** — Visual status bar (five statuses), legend, avg calls/lead, deleted-leads warning
  - **Per-lead drill-down** — Click any batch card to lazy-load a paginated table (50/page) showing every lead: name, company, status, assigned SDR, call count, last call outcome, and research completion flag
  - **Lead navigation** — Click a lead name to go directly to that lead's detail page
  - **GSheet & CSV batches** — Both import types appear correctly with their respective icons and type labels
  - **Legacy batch support** — Leads uploaded before batch tracking was introduced are grouped under "Legacy / Pre-tracked Uploads"

### Bug Fixes

- **🔗 Lead Link Fix in Batch Tracker:** Lead name links in the drill-down table now correctly navigate to the lead detail page using `window._navigateToDetail()`. The previous implementation dispatched a custom DOM event that was never consumed, causing clicks to silently fail.

### Improvements

- **🧹 Activity Feed Cleanup:** Removed ~485 lines of now-dead Upload Batch Tracker code from `activity_feed.js` (the code was moved to `upload.js` in the batch above). The Activity Feed tab is now exclusively focused on real-time call/email/status/research events.

### API Changes

- **`GET /api/admin/leads/upload-batch-metrics`** — Existing endpoint. Now exclusively consumed by Upload Center. Accepts `date_range` and `pod_id` query params.
- **`GET /api/admin/leads/upload-batch-metrics/{log_id}/leads`** — Existing endpoint. Accepts `pod_id`, `page`, `per_page`. Returns paginated per-lead drill-down for a specific batch (or `"legacy"` sentinel for pre-tracked uploads).

### Breaking Changes
None

---

## v4.9.0 – 13 April 2026

### New Features

- **🔒 Research-First Workflow:** Enforced a mandatory research-first workflow for SDRs. The `Phone` and `Secondary Phone` fields are now masked and hidden behind a "Hidden (Complete Research)" badge until all 11 research fields are filled.
- **🤖 AI Research Auto-Trigger:** Clicking any of the research accordions (`Company Basics`, `Call Strategy`, or `Customer Engagement`) automatically triggers the AI Research generation, provided no research has been started yet.
- **🎯 Auto-Expanded Call Strategy:** As soon as a lead is moved to the `Calling` status, the Call Strategy accordion automatically expands, making the Hook and Pitch Angle immediately visible for faster dialing context.

### Breaking Changes
None

---

## v4.8.2 – 13 April 2026

### Bug Fixes

- **📞 Aircall Empty Response Crash (Hotfix):** Fixed a production issue where the Aircall dialer integration would crash (`JSONDecodeError`) when the API returned an HTTP success code but an empty response body. Call initiation now handles empty responses gracefully and logs specific endpoint data for troubleshooting instead of failing silently.

### Breaking Changes
None

---

## v4.8.1 – 10 April 2026

### New Features

- **📵 No-Phone Disqualification:** Leads without phone numbers can now be disqualified directly using the "No Phone Number" reason — no call logging required. A yellow info banner appears on no-phone leads to guide users.
- **🗑️ Direct Lead Deletion:** Admin-only "Delete Lead" button on the lead detail page with confirmation modal — no need to navigate to the Assignments tab for single-lead deletion.
- **👤 SDR Filter for All Leads tab:** Admins can now filter leads by assigned SDR on the All Leads page. Date filters auto-clear when an SDR is selected to ensure all their leads are visible.

### Bug Fixes

- **🔧 Assignments SDR Filter:** Fixed the SDR filter on the Assignments tab not filtering results. Root cause: duplicate `id="sdr-filter"` across the All Leads and Assignments tabs caused `getElementById` to always target the wrong (hidden) element. Renamed to unique ID.
- **🔧 SDR Filter Date Collision:** Fixed SDR filter showing zero results when the default 6-month date range excluded older leads. Dates now auto-clear on both SDR selection and page reload with a persisted SDR filter.

### Breaking Changes
None

---

## v4.8.0 – 10 April 2026

### New Features

- **📡 Unified Activity Feed (Admin Only):** A centralized, real-time dashboard that aggregates all SDR interactions — calls, emails, status changes, and research — into a single filterable, paginated view for leadership:
  - **📊 Stats Cards:** Total Activities, Meetings Booked, Call Connect Rate, and Email count at the top
  - **🎯 Call Strategy View:** Expanded call detail shows personalization angle, research hypothesis, call notes, recording player, and transcript
  - **📧 Structured Email Section:** Email details display subject, direction, body preview, and open tracking stats in a professional grid layout
  - **📝 Notes / Summary Column:** Replaced "Research Hook" with an intelligent preview showing call notes, email subjects, or status transitions
  - **🔍 Cross-Time Search:** When searching by lead or company, date filters are automatically bypassed to search across all time
  - **🧹 Activity Deduplication:** Shows only the latest activity per lead per type — 5 calls to the same lead produce only 1 row
  - **🎙️ Recording & Transcript Access:** Call recordings and transcripts surfaced directly in the expanded detail panel
  - **📥 CSV Export:** Download all filtered activities as a spreadsheet with Call Strategy column
  - **🔒 Access Control:** Super Admins see all; Pod Admins see only their POD's SDRs; SDRs have no access

### API Changes

- **`GET /api/admin/activity-feed`** — New endpoint. Accepts `page`, `per_page`, `type`, `sdr`, `pod_id`, `outcome`, `date_range`, `search` query params. Returns paginated activity data with stats. Auth: `require_admin`.

### DB Changes
None — uses existing tables (CallLog, DialerCall, LeadEmailActivity, LeadStatusLog, Lead).

### Breaking Changes
None

---

## v4.7.0 – 9 April 2026

### New Features

- **⬇️ Lead Deprioritization (Post-Call Priority Queue):** SDR leads are now automatically deprioritized after calls are logged, keeping the My Leads table focused on fresh, unworked contacts:
  - **🔴 High** (score ≥ 75): Default. Fresh leads, never called today.
  - **🟡 Medium** (score 40–74): Lead was called once today. Amber "Called Today" badge shown.
  - **⬇️ Deprioritized** (score < 40): Lead was called 2+ times today. Row visually muted. "Deprioritized" badge shown.
  - My Leads table is ordered **priority_score DESC** first, so High leads always surface above Medium and Deprioritized ones.
  - **Re-prioritization is manual**: An **↑ Re-prioritize** button appears on Medium and Deprioritized rows. Clicking it resets the lead to High priority (score 100) and immediately refreshes the table.
  - An amber info banner at the top of My Leads explains the scoring logic to SDRs.
  - Admins are **not affected** — no priority badges appear in the All Leads view.

### API Changes

- **`PATCH /api/leads/{lead_id}/priority`** — New endpoint. Accepts `{ priority_score: 0–100 }`. Used by the Re-prioritize button to restore a lead to High (100). Auth-protected; follows same lead-access rules as other PATCH endpoints.
- **`GET /api/leads/my` response** — Now includes `priority_score` field on each lead summary.

### DB Changes

- **`leads.priority_score`** — New `INTEGER NOT NULL DEFAULT 100` column on the `leads` table. Added in migration V22. Existing leads receive `priority_score = 100` (High) on migration.

### Breaking Changes
None

---

## v4.6.2 – 8 April 2026

### Bug Fixes
- **🔍 Call Back Later Filter (Regression Fix):** Fixed critical data-integrity bug where leads with a *historical* "Call Back Later" call outcome were incorrectly surfacing in the filter, even if their *most recent* call had a different outcome (e.g. "Meeting Confirmed"). Root cause: the `_apply_filters` UNION subquery matched any historical call. Now uses a `ROW_NUMBER()` window function ranked subquery — only the **most recent call per lead** (across both `call_logs` and `dialer_calls`) is evaluated against the requested outcome filter
- **🕐 Task Time Picker Missing:** Fixed task creation form which was missing a time input field. SDRs can now set both a due date **and** a due time when creating a task on a lead

### Improvements
- **🛡️ Task Creation Error Handling:** The "Add Task" button now shows a loading state and restores itself on API failure, preventing silent crashes and ghost task UI entries. A toast notification is shown if the API call fails
- **🔗 API Update:** `addLeadTask()` now accepts and forwards an optional `due_time` parameter to the backend

### Testing
- **🧪 +4 Backend Regression Tests** in `test_outcome_filter.py`:
  - `test_historical_outcome_does_not_match_filter` — the Amy Miller regression case
  - `test_most_recent_dialer_call_overrides_older_call_log` — DialerCall ordering
  - `test_no_calls_lead_excluded_from_all_outcome_filters` — zero-call exclusion
  - `test_meeting_confirmed_filter_correct_after_escalation` — escalation correctness
- **🧪 16 Playwright E2E Tests** in `tests/task-and-outcome-filter.spec.js` covering outcome filter precision, task CRUD, time picker, error toast, snooze/dismiss state, and sessionStorage filter persistence

### Breaking Changes
None

---

## v4.6.1 – 8 April 2026

### Bug Fixes
- **🔍 Dialer Outcome Filter:** Fixed critical bug where leads contacted via Aircall or RCM dialer were silently excluded from outcome-based filters (e.g. clicking "Call Back Later" on the dashboard). Root cause: `_apply_filters` only queried the `call_logs` table. Now uses a `UNION` of both `call_logs` and `dialer_calls` tables, so all leads with a matching outcome appear regardless of which dialer was used
- **🔔 Task Notification Stability:** Fixed "ghost task" bug where snooze and dismiss buttons removed a task from the notification panel even when the API request failed (e.g. network drop). UI now only updates after a confirmed server response. On failure, the button re-enables with an error tooltip so the SDR can retry

### Testing
- **🧪 43 New Tests:** Comprehensive test coverage for task lifecycle and outcome filtering:
  - `test_task_routes.py` — 33 tests: task CRUD, pending task polling, snooze (5/15/30/60 min + clamping to 15 for invalid values), dismiss, and SDR ownership enforcement
  - `test_outcome_filter.py` — 10 tests: CallLog outcome filter, DialerCall-only filter regression test, UNION de-duplication, `/my` endpoint outcome filter, empty result, XSS escaping in `_lead_to_summary`

### Breaking Changes
None

---

## v4.6.0 – 8 April 2026

### New Features

- **🔔 Task Notification Bell:** A persistent bell icon in the SDR top bar surfaces task reminders in real time. Tasks appear in the panel when their due date **and** due time have been reached. Tasks without a due time are excluded from the notification system — time-based precision is intentional
- **📊 30-Second Background Polling:** The frontend polls `GET /api/my/tasks/pending` every 30 seconds. The endpoint returns all due, non-done, non-dismissed tasks for the authenticated user, respecting snooze windows server-side. Results are capped at 50 tasks per poll to prevent payload bloat
- **🌐 Browser Push Notifications:** On the first due task detected, the browser's Notification permission prompt is triggered. If granted, a native OS-level push notification fires with the count of pending tasks — works even when RCM is not the active tab. Uses `tag: "task-reminder"` to collapse repeated alerts into a single notification
- **🔔 In-App Chime:** A soft two-tone audio chime (Web Audio API oscillator) plays whenever the pending task count increases since the last poll. Operates independently of browser push permission
- **⏰ Snooze (15m / 1h):** Each notification item has two snooze buttons. The action calls `PATCH /api/my/tasks/{id}/snooze` with `{ minutes }`. The backend sets `snoozed_until` and the task is excluded from poll results until that timestamp passes. Invalid minute values are clamped to 15
- **✕ Dismiss:** Permanently removes a task from the notification panel by setting `dismissed = true` via `PATCH /api/my/tasks/{id}/dismiss`. The underlying task record on the lead is preserved — dismiss only silences the reminder
- **🔗 Open Lead shortcut:** Each notification item has an **Open Lead** button that closes the panel and navigates directly to the lead's detail page without any extra clicks

### Backend

- `GET /api/my/tasks/pending` — returns due, undismissed, unsnooze-expired tasks for the current user with lead name and company joined
- `PATCH /api/my/tasks/{id}/snooze` — sets `snoozed_until` offset by N minutes (allowed: 5, 15, 30, 60; clamped to 15 for invalid values)
- `PATCH /api/my/tasks/{id}/dismiss` — sets `dismissed = true`; task remains in DB

### Database

- **V21:** Added `dismissed` (string, default `"false"`) and `snoozed_until` (timestamp, nullable) columns to `tasks` table

### Scope

- Notification bell is **SDR-only** — admins are excluded at init time
- All snooze/dismiss actions are user-scoped — SDRs cannot affect each other's notifications

### Breaking Changes
None

---

## v4.5.0 – 7 April 2026

### New Features
- **🆕 Universal Lead Creation:** The "+ New Lead" button is now visible and functional for **all user roles** (SDR, Pod Admin, Super Admin). Previously limited to admins only
- **📝 Expanded Lead Form:** The creation form now includes: First Name, Last Name, Company, Title/Role, Phone, Secondary Phone, Email, LinkedIn URL, and Initial Status — organized in a clean two-column grid layout
- **🔗 Auto-Assign to Creator:** Newly created leads are automatically assigned to the creating user, so they appear immediately in "My Leads". Designed for the mid-call referral use case where an SDR gets a new contact during a conversation
- **🏢 Pod Scoping:** Leads created by SDRs automatically inherit the creator's Pod assignment for proper team scoping

### Security
- **🔒 Backend Auth Guard:** Added authentication requirement (`get_current_user`) to the `POST /api/leads` endpoint. Initial status is restricted to "Lead Assigned" or "Research" only to prevent data integrity issues

### Improvements
- **✅ Client-Side Validation:** Last Name and Company are required. Email format is validated. Toast notifications replace raw `alert()` dialogs
- **📊 Audit Trail:** Every manually created lead gets a `CREATE_LEAD` activity log entry and an initial status change record for full traceability

### Breaking Changes
None

---

## v4.4.1 – 7 April 2026

### Improvements
- **📐 Sidebar Toggle Relocated:** Moved the sidebar collapse/expand button from the bottom of the sidebar to a floating circular button at the top edge. The button now sits outside the sidebar container, on the boundary between the sidebar and main content area. Uses a subtle `‹`/`›` chevron with a white circle and drop shadow for a cleaner, more modern appearance

### Breaking Changes
None

---

## v4.4.0 – 7 April 2026

### New Features
- **📐 Collapsible Sidebar:** Toggle between a full 260px expanded sidebar (with labels) and a compact 72px icon-only mode. State persists via localStorage across sessions. Hover tooltips show navigation labels in collapsed mode. Works for all user roles and on mobile
- **📧 Email Origin Tagging:** All outbound emails sent via RCM now include a subtle footer — "RCM · Powered by RCM" (9px, light gray) — plus an invisible `X-Mailer: RCM CRM / RCM` header for programmatic tracking

### Bug Fixes
- **✉️ Email Formatting Preserved:** Emails typed with line breaks and paragraphs are now delivered with formatting intact. Plain-text body is converted to HTML (`\n` → `<br>`) before sending via Nylas — previously, all line breaks were collapsed into a single paragraph by email clients

### Improvements
- **🎨 Sidebar Scrollbar Hidden:** Removed visible scrollbar from sidebar navigation for a cleaner look (Firefox, Chrome, Safari, Edge)

### Breaking Changes
None

---

## v4.3.3 – 6 April 2026

### Bug Fixes
- **📊 SDR Metrics — Non-SDR Users Excluded:** SDR Metrics dashboard (KPIs, daily trends, per-SDR table, and CSV/XLSX export) now only includes users with the SDR role — Super Admins and Pod Admins are no longer counted in metrics, preventing inflated activity numbers
- **✉️ Email Connect Redirect Fix:** After connecting email via Nylas OAuth, SDRs are now correctly redirected to My Settings (`#my-settings`) instead of the admin Settings page (`#settings`) which caused a blank page
- **🔔 Email Connect Toast:** Success confirmation toast ("Email connected successfully!") now appears for both SDRs and admins after OAuth redirect — previously it was not visible due to the wrong route

### Breaking Changes
None

---

## v4.3.2 – 6 April 2026 (Hotfix)

### Bug Fixes
- **📧 Email Body Truncation:** Fixed emails being cut off at ~200 characters — the `_sanitize_preview()` function had a 500-character hard limit and an aggressive signature-stripping regex that was removing valid email content. Full email bodies (including sender name, company, and phone number) are now preserved
- **👁️ Open Count Inflation:** Fixed email open counts being inflated by the sender's own views — when an SDR viewed their sent email in Gmail's Sent folder, the tracking pixel fired and incremented the count. The webhook now skips the first open event for outbound emails (sender heuristic)
- **✂️ Signature Preservation:** Removed signature stripping from the email sanitizer — sign-offs like "Best, Aman" were being incorrectly removed, losing the sender's contact information
- **🔑 Multi-Grant Email Repair:** Fixed the startup email repair to try all connected Nylas mailbox grants (not just the first one) — emails sent by different SDRs are stored under different grants
- **🐛 Regex Syntax Error:** Fixed `re.error: unterminated character set` on production — the pattern `[^]*?` is valid in JavaScript but invalid in Python. Replaced with `[\s\S]*?`

### Data Fixes Applied
- Reset all inflated open counts to 0 — existing data was unreliable due to sender open tracking
- Re-fetched and re-processed all email bodies from Nylas API to restore truncated content

### Technical Details
- **Risk Score:** 0.75 (high) — changes scoped to email module only
- **Affected Flows:** 14 (email send, sync, webhook, repair, attachment download)
- **No impact on:** Salesforce sync, lead assignment, authentication, dialer

### Breaking Changes
None

---

## v4.3.0 – 6 April 2026

### New Features
- **✉️ Email UI Redesign:** Replaced gradient chat bubbles with a professional, enterprise-grade flat card layout — outbound emails have an amber left border, inbound emails have a blue left border
- **📎 Attachment Support:** Email cards now display attachment chips with download links — click to download directly from the email view
- **🔄 Auto-Refresh Tabs:** Email and Calls tabs auto-refresh content when switching between them, ensuring data is always current

### Improvements
- **📏 Smart Card Sizing:** Email cards use `min-width` and `fit-content` for responsive sizing — short emails no longer stretch to full width
- **🎨 Visual Consistency:** Unified email card styling with consistent padding, typography, and spacing across all email types

### Bug Fixes
- **📐 Short Content Fix:** Fixed email cards for brief messages (e.g., "Hi") expanding to full container width instead of fitting content
- **💬 Bubble Sizing Fix (V21):** Fixed email bubble sizing issues from the previous gradient-based design

### Breaking Changes
None

---

## v4.2.0 – 2 April 2026

### New Features
- **💬 Conversations Tab:** New lead detail tab that loads the RCM messaging component, enabling SDRs to message leads directly from RCM. Includes per-SDR `rcm_user_id` tagging, phone fallback (uses secondary phone when primary is missing), and graceful error handling when the service is unavailable
- **📧 Email Open Tracking:** Outbound emails now include Nylas tracking pixels. When a recipient opens an email, RCM records the first open timestamp and total open count. The Email tab shows a green "Opened" badge with view count and first-opened time, or a gray "Sent" badge for unread emails
- **👁️ Per-SDR Conversations Identity:** Each SDR can be assigned a unique `rcm_user_id` in the Admin panel, linking their RCM identity to the Conversations system for proper message attribution

### Improvements
- **📱 Phone Fallback:** Conversations tab uses `phone_secondary` when `phone` is missing, ensuring more leads can be messaged
- **🔒 Webhook Resilience:** The `message.opened` webhook handler gracefully handles unknown messages, empty payloads, missing fields, and rapid-fire duplicate events without crashing

### Database Migrations
- **V19:** Added `rcm_user_id` column to `users` table
- **V20:** Added `opened_at` (timestamp) and `open_count` (integer) columns to `lead_email_activity` table

### Breaking Changes
None

---

## v4.1.1 – 1 April 2026

### Improvements
- **🔒 Security Hardening:** Internal security improvements for production readiness — logging cleanup, authentication defaults tightened, credential handling improved
- **🔧 My Settings Navigation:** "My Settings" now only appears for SDR and Pod Admin users — Super Admins use the full Settings page instead

### Bug Fixes
- **🗑️ Lead Delete Fix:** Fixed bulk delete failing for leads with email activity or dialer call records (NotNullViolation on lead_email_activity)

### Breaking Changes
None

---

## v4.1.0 – 1 April 2026

### New Features
- **🏢 Company-Level Call Resolution:** When any lead at a company has a successful meeting outcome (Meeting Scheduled / Meeting Confirmed), all other leads at that company are flagged with a "Company Connected" indicator. This prevents redundant outreach to contacts at companies where a meeting is already booked
  - **Lead List:** "✅ Company Connected" badge in company group headers and subtle hint on individual lead rows
  - **Lead Detail:** Amber "Company Already Connected" banner with the name of the resolved contact
  - **Call Modal:** Warning banner when initiating a call to a lead at a resolved company
  - **Matching Logic:** Case-insensitive, whitespace-trimmed company name matching with database-level index for performance
  - **Batch Processing:** List views use optimized batch resolution to prevent N+1 query issues

### Bug Fixes
- **📊 SDR Metrics Meeting Count Fix:** Fixed critical discrepancy where SDR Metrics showed only 2 meetings instead of the actual 7. Root cause: the `SCHEDULE_MEETING` activity log event was only emitted from the UI status-change path, not from the call outcome auto-transition path (Meeting Confirmed → Meeting Scheduled). Now both paths emit the event correctly
- **📊 Historical Data Backfill:** Backfilled 5 missing `SCHEDULE_MEETING` activity events in production to correct historical SDR Metrics data

### Improvements
- **🧪 26 New Tests:** Comprehensive E2E test suite covering company resolution detection, batch processing, API integration, activity log emission, leaderboard accuracy, and edge cases (whitespace normalization, null companies, multiple meetings, case-insensitive matching)
- **📇 Database Index:** Added `LOWER(company)` index on leads table for optimized company-level queries

### Breaking Changes
None

---

## v4.0.2 – 31 March 2026

### Bug Fixes
- **📞 Aircall User Matching Fix:** Fixed critical pagination bug where only 50 of 92 Aircall users were fetched — users on page 2+ (including active SDRs) could not initiate calls from RCM. Root cause: Aircall API returns `total` and `per_page` in meta, not `total_pages`; code defaulted to 1 page
- **📋 Duplicate Call Entries Fix:** When an SDR logged a call outcome after an Aircall call, two separate entries were created (one manual, one Aircall). Now the outcome and notes are attached to the existing Aircall record — single unified entry with both call data (duration, recording, transcript) and SDR-logged outcome

### Improvements
- **📞 Meeting Scheduled Outcome Behavior:** "Meeting Scheduled" call outcome no longer auto-transitions the lead status. Lead stays in "Calling" for tentative bookings. Only "Meeting Scheduled (Confirmed)" transitions the lead to Meeting Scheduled status, triggers Salesforce sync, and initiates AE hand-off

### Breaking Changes
None

---

## v4.0.1 – 31 March 2026

### Bug Fixes
- **📊 Metrics Dashboard Fix:** Fixed production metrics showing zeros for active SDRs, leads, and meetings. Root cause: stale login-only rows in `user_activity_daily_summary` prevented fallback to real-time activity data
- **📈 Leads Processed Accuracy:** Changed leads processed calculation to count actual lead work (status updates + calls logged) instead of view events which were not being tracked
- **👤 User Activity Status Fix:** Activity badges (Active/Idle/Inactive) now use real heartbeat and interaction data instead of OAuth login timestamps — prevents silent Google SSO re-auth from inflating activity status
- **🧹 Stale Session Cleanup:** Sessions without a heartbeat for >30 minutes are now auto-closed, eliminating zombie sessions that accumulated when users closed their browser tab without logging out

### Improvements
- **✉️ Email Connect UX:** After connecting email via Nylas OAuth, users are now redirected back to the Settings page (instead of Leads) with a success toast notification confirming the connection
- **🔗 Same-Tab OAuth:** Email connect now navigates in the same browser tab instead of opening a popup, ensuring the callback redirect lands correctly

### Breaking Changes
None

---

## v4.0.0 – 30 March 2026

### Architecture Overhaul
- **⚡ Email Sync Rewrite (502 Fix):** Rewrote email sync from `async` to fully synchronous — eliminated session corruption caused by mixing async HTTP calls with sync SQLAlchemy. Emails now return instantly from cache while Nylas syncs in a background task with its own isolated DB session
- **🚀 Webhook Performance (503 Fix):** Replaced O(N) in-memory lead table scan with O(1) SQL-indexed phone lookup — webhook response time dropped from ~5s to <50ms, eliminating Aircall timeout cascades
- **🔄 Background Task Architecture:** Email sync now runs via FastAPI `BackgroundTasks` with dedicated DB sessions — request thread returns immediately, sync runs asynchronously without blocking the UI

### Improvements
- **📱 Phone Format Matching:** SQL-level candidate generation handles E.164 (+918552628000), digits-only (8552628000), dashes (+91-855-262-8000), and spaces (+91 85526 28000) — all matched via indexed query, not Python loops
- **✉️ Email Preview Cleanup:** Quoted text, forwarded messages, and signatures stripped from email previews using pattern-matched regex (On Date wrote, Forwarded message, Original Message, >, Best regards, --)
- **♿ Accessibility Fix:** Replaced invalid `<label for=FORM_ELEMENT>` wrappers with `<div role="button">` on email compose toggles

### Testing
- **🧪 40 New Root Cause Tests:** Dedicated test suite (`test_root_cause_fixes.py`) covering sanitize preview, sync function behavior, SQL phone matching, background task isolation, and webhook resilience
- **🧪 Total Test Coverage:** 237 tests across 13 test files — all passing

### Breaking Changes
None — all changes are backward compatible. Existing data and APIs unchanged.

---

## v3.10.0 – 27 March 2026

### New Features
- **📞 Aircall Dialer Integration:** Full click-to-call dialer integration with Aircall — one-click calling from lead detail, automatic call tracking, and call recording capture
- **🎙️ Call Recording Playback:** Embedded audio player on call cards — listen to recordings and download them directly from the lead's Calls tab
- **📄 Transcript Support:** Call transcripts display inline with expandable sections (requires Aircall transcription plan)
- **📊 Unified Calls Tab:** Merged manual call logs and Aircall dialer calls into a single, sorted Calls tab with stats (Total Calls, Connected, Avg Duration, Last Called)
- **✉️ Email Tab:** Emails moved to a dedicated tab alongside Overview and Calls — threaded view with quoted text stripping
- **⚙️ Dialer Configuration:** Super Admins can configure Aircall API credentials and select phone numbers in Settings → Dialer tab

### Improvements
- **🔒 Auto-Call Tracking:** When Aircall is enabled, calls are tracked automatically — manual call logging is disabled to prevent duplicates
- **📱 Phone Format Normalization:** Phone matching handles all formats (spaces, dashes, parentheses) using digits-only comparison
- **🔄 On-Demand Enrichment:** Calls with missing data (duration=0, no recording) are enriched from Aircall's API when viewed
- **⚡ Cache-Busting:** Frontend JS includes version parameter for reliable deployments

### Bug Fixes
- Fixed race condition where dialer config wasn't loaded when clicking the call button
- Fixed manual call modal appearing after dialer call initiation (even on error)
- Fixed orphaned Aircall records not linked to leads (phone format mismatch)
- Fixed FAILED initiation records showing as 0s ghost entries in the calls list
- Fixed email preview showing raw quoted/forwarded text

### Breaking Changes
None

---

## v3.9.2 – 27 March 2026

### New Features
- **🏢 Company Filter:** Added a company dropdown filter to All Leads / My Leads page — SDRs can filter leads by hospital/company to view all personas at once without switching pages
- **📌 Pagination Persistence:** Leads page now remembers current page, search query, and active filters when navigating to a lead detail and back — no more jumping back to page 1

### Improvements
- **📱 Phone Fallback:** Phone column now shows secondary phone number when primary phone is missing — "No Phone" only appears when both fields are empty (applies to leads table + dashboard Recent Leads)
- **🎨 Filter Bar Layout:** Restructured All Leads header — title pinned left, all filter controls (search, company, status, source, dates) in a single inline row that wraps cleanly
- **🏆 Leaderboard Cleanup:** SDRs without a POD assignment no longer show a stray "—" dash under their name

### Bug Fixes
- **📞 Secondary Phone Upload:** Fixed bug where `phone_secondary` was extracted from CSV mapping but never saved to the database — affected both file upload and Google Sheets import
- **🗺️ COLUMN_MAP Auto-Detect:** Added auto-detection for secondary phone column headers: "secondary phone", "other phone", "alternate phone", "home phone", "personal phone"

### Breaking Changes
None

---

## v3.9.1 – 27 March 2026

### New Features
- **👤 Auto-Assign SDR on Upload:** Upload Center now includes an "Assign to SDR" dropdown (File Upload + Google Sheets tabs). Select an SDR or Pod Admin to automatically assign all newly created leads during import. Default: No assignment (unassigned)

### Bug Fixes
- **⏱️ Time Spent Fix:** SDR Metrics "Time Spent" values now use activity-based heartbeats instead of raw login-logout duration — eliminates inflated idle-time metrics
- **✉️ Email Validation in Upload:** Company names in the Email column (e.g., "Vasan Eye Care") are no longer treated as email addresses for duplicate detection — was causing 70%+ false-positive skips
- **🔧 SDR Dropdown Filter:** Upload Center "Assign to SDR" dropdown now shows only SDR and Pod Admin roles (Super Admins excluded)

### Breaking Changes
None

---

## v3.9.0 – 26 March 2026

### New Features
- **🤖 AI Research Auto-Fill:** One-click AI-powered lead research using Groq LLM (Llama 3.3 70B). Populates 10+ research fields automatically with company-level caching to avoid redundant API calls
- **🏢 Company Grouping:** Leads table now groups leads by company with visual headers showing company name and lead count — SDRs can see all contacts from the same company at a glance
- **📵 No-Phone Highlighting:** Leads without phone numbers are visually highlighted (yellow row + red badge) so SDRs are not penalized for not calling them
- **📝 Notes Preview:** Latest note from each lead is shown directly in the leads table (content snippet, author, timestamp) — no need to click into each lead
- **⚙️ AI Settings (Admin):** Super Admins can configure LLM provider, API key, and model from the Settings page

### Improvements
- **🔄 Keep-Alive Ping:** Server now self-pings every 10 minutes to prevent Render free-tier cold starts
- **✨ Cold Start Overlay:** Friendly "RCM is waking up" overlay with auto-retry when server is starting (replaces raw 503 error)
- **🔒 XSS Prevention:** Note content is HTML-escaped server-side before rendering
- **🔍 Case-Insensitive Grouping:** Company groups are case-insensitive ("Acme" and "acme" merge together)
- **📱 Safari Compatibility:** Cold-start health check now works on Safari <16.4

### Bug Fixes
- Fixed empty-string phone ("" or whitespace) not being detected as no-phone
- Fixed potential row duplication in paginated leads with notes (switched to subqueryload)

### Breaking Changes
None

---

## v3.8.1 – 26 March 2026

### Bug Fixes
- **✉️ Email Name Display:** Inbound email replies in lead detail now show the lead's name instead of their email address
- **👤 Duplicate Name Cleanup:** Added admin endpoint to fix leads where full name was incorrectly imported into both `first_name` and `last_name` (e.g., "Arthur Lao Arthur Lao" → "Arthur Lao")
- **📊 SDR Metrics — Chart Stacking:** Fixed "No data yet" messages stacking up when switching date range filters
- **📊 SDR Metrics — KPI Accuracy:** Meetings Scheduled KPI now correctly counts from activity logs instead of always showing 0
- **📊 SDR Metrics — Per-SDR Table:** Added real-time data fallback so the Per-SDR Performance table shows data even before daily aggregation runs
- **📊 SDR Metrics — Daily Trend:** Charts now fall back to raw activity logs when no pre-aggregated daily summaries exist

### Improvements
- All three SDR Metrics endpoints (`/summary`, `/daily-trend`, `/sdr-table`) now consistently fall back to aggregating from raw `UserActivityLog` and `LoginLog` tables when `UserActivityDailySummary` is empty

### Breaking Changes
None

---

## v3.8.0 – 25 March 2026

### New Features
- **📞 Secondary Phone Field:** New editable "Secondary Phone" on lead detail page — auto-populated from sheet imports when multiple phone columns exist
- **🔗 LinkedIn Profile Link:** Clickable "View Profile" link on the lead detail Contact Information card
- **🏢 Company-Based Round Robin:** Auto-assign groups all contacts from the same company to a single SDR (both `pod_routes.py` and `admin_routes.py` endpoints)
- **✉️ Nylas Email Integration:** Full OAuth flow, email sending, activity logging, and HMAC-SHA256 webhook listener for inbound email tracking

### Improvements
- **📱 Broadened Phone Mapping:** Upload now recognizes 20+ phone column variants (e.g., "Enriched Mobile Phone", "Direct Phone", "Contact Number")
- **⚡ Assignments Tab Performance:** 5-10x faster load — cached per-lead settings query (1 DB hit instead of 400+) and added eager loading for relationships

### Bug Fixes
- Fixed company contacts being split across multiple SDRs during round-robin assignment (second endpoint in `admin_routes.py` was missing company grouping)
- Fixed timezone drift in `timeInStatus` metrics (5.5-hour offset on UTC timestamps)

### Breaking Changes
None

---

## v3.7.0 – 24 March 2026

### New Features
- **🔍 SDR Filter on Assignments:** Filter both Unassigned and Assigned leads tables by a specific SDR
- **📦 Bulk Unassign:** Select multiple assigned leads and unassign them in one click (Pod Admin + Super Admin)
- **🗑️ Bulk Delete:** Permanently delete selected leads with all associated data — Super Admin only
- **✅ Floating Action Bar:** Context-aware bulk action toolbar that appears when leads are selected, with Assign, Unassign, and Delete options

### Improvements
- **Lead Assigned Filter Fix:** Status filter for "Lead Assigned" now correctly shows matching leads
- **E2E Test Suite Expansion:** Expanded from 35 to 48 end-to-end tests covering Upload Center, Audit Logs, SDR Metrics, Assignments, and role-based nav restrictions

### Bug Fixes
- Fixed "Lead Assigned" status filter incorrectly hiding leads without assignees
- Fixed `ImportError` in pod routes (stale `MAX_ACTIVE_LEADS` constant)

### Breaking Changes
None

---

## v3.6.0 – 23 March 2026

### New Features
- **🚀 RCM Rebrand:** Renamed from "RCM CRM" to "RCM" across all user-facing surfaces
- **✨ Revamped Login Page:** New dark navy + amber/gold design with floating spark animations, feature cards (Lead Enrichment, Smart Deduplication, SDR Prioritization), and updated demo role buttons

### Improvements
- Updated tagline: "Turn raw leads into qualified prospects"
- Demo login buttons now match actual roles (Super Admin, Pod Admin, SDR)
- Responsive login layout for mobile screens

### Breaking Changes
None

---

## v3.5.2 – 23 March 2026

### Bug Fixes
- Fixed metrics export (CSV/XLSX) returning 401 Unauthorized — frontend was using wrong localStorage key for auth token
- Fixed backend export endpoint not accepting token from query parameter (required for browser-initiated downloads)

### Breaking Changes
None

---

## v3.5.1 – 23 March 2026

### Improvements
- **Enriched Salesforce Push:** When leads reach the push stage, we now send 19 fields instead of 7 — includes Title, Website, Industry, NumberOfEmployees, AnnualRevenue, City, State, Country, Street, PostalCode, and SDR research notes as Description
- Research hypothesis, personalization, company and contact notes are concatenated into the SF Description field

### Breaking Changes
None

---

## v3.5.0 – 23 March 2026

### New Features
- **🏆 Leaderboard Time-Periods:** Filter rankings by 7 Days, 30 Days, 90 Days, or All Time
- **SDR Self-Highlight:** Your row is highlighted with a "You" badge on the leaderboard, even if you're not in the top 3
- **📈 SDR Metrics UX:** Date range picker with presets (7D/30D/90D/180D), SDR name search filter, and pagination (10 rows/page) on the Per-SDR table
- **📸 User Guide Screenshots:** All 8 major sections now include embedded screenshots from the live app

### Improvements
- **⚙️ Settings Revamp:** Simplified to 2-tab layout (Connection + Sync Settings) — removed Profile tab, kept Data Summary sidebar
- **Settings hidden for SDRs:** Settings is now admin-only — SDRs no longer see the Settings nav item
- **Sync Settings restricted:** Only Super Admins can see/modify Sync Settings — Pod Admins see Connection tab only
- **Pod Admin SF view:** Pod Admins see read-only Salesforce connection status instead of credential form

### Bug Fixes
- Fixed Pod Admin Settings showing Salesforce credential form (should be read-only)
- Fixed Pod Admin seeing Sync Settings tab (should be Super Admin only)

### Breaking Changes
None

---

## v3.4.0 – 18 March 2026

### New Features
- **📤 Upload Center:** Dedicated page for importing enriched lead sheets — drag-and-drop file picker, smart field mapping, CSV/XLSX/XLS support, upload history and stats
- **Update Existing:** Toggle to update duplicate leads instead of skipping them during import

### Bug Fixes
- Fixed upload sheet skipping all entries when CSV contained a "result" column
- Removed duplicate Active Lead Cap from POD Settings

### Breaking Changes
None

---

## v3.3.0 – 18 March 2026

### New Features
- **Opportunity Outcome:** Pod Admin / Super Admin can mark leads as Won or Lost with optional notes
- **SDR Transparency:** SDRs see the outcome badge on lead detail and leads table (read-only)
- **Inline Badge:** Meeting Scheduled leads show Won/Lost/⏳ tag in the table

### Improvements
- Outcome changes logged in status history (audit trail)

### Breaking Changes
None

---

## v3.2.0 – 18 March 2026

### New Features
- **Admin Panel Overhaul:** Stats cards (Total / Active / Never Logged In / Revoked), search bar, POD filter, sortable columns, activity badges (🟢🟡🔴⚪), CSV export, pagination
- **Unified Audit Logs:** Merged SF Logs into a 4-tab view (Activity Log, Login History, Feedback, SF Logs) with date filters
- **Feedback System:** All users can submit bug reports, feature requests, and feedback via sidebar
- **Date Range Picker:** Added to All Leads table (default last 6 months)

### Bug Fixes
- Lead detail page now survives browser refresh (SPA fix)

### Breaking Changes
None

---

## v3.1.0 – 17 March 2026

### Bug Fixes
- SDRs can no longer move leads backward in the pipeline — only Pod Admins and Super Admins can
- Resolved `isTerminal` reference error on lead detail page

### Improvements
- Added frontend unit tests for `utils.js`, `auth.js`, and `api.js` using Vitest

### Breaking Changes
None

---

## v3.0.0 – 16 March 2026

### New Features
- **Three-Role System:** Super Admin, Pod Admin, SDR with role-based access
- **POD Management:** Create and manage PODs with team assignments
- **Salesforce Integration Logs:** Full SF API logging with filters, detail modal, and CSV export
- **Research Phase:** Guided research workflow before calling
- **SDR Performance:** Drill-down analytics per SDR
- **User Guide:** In-app searchable help guide with role-based content
- **Configurable Multi-POD:** Toggle to allow SDRs in multiple PODs

### Breaking Changes
- Role system changed from single-role to three-role hierarchy

---

## v2.0.0 – 11 March 2026

### New Features
- **Dashboard:** Stats tiles, recent leads, leaderboard widget
- **Lead Management:** Full lead lifecycle with Kanban board
- **Call Logging:** Log calls with outcomes, notes, and auto-status transitions
- **Salesforce Sync:** Two-way sync with configurable settings
- **Google SSO:** Single sign-on authentication
- **Lead Assignments:** Manual and Round Robin distribution

### Breaking Changes
None — initial release
