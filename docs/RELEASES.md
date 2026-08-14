# RCM CRM — Release Notes

## v11.0.0 — 2026-08-14 (Cadence/Messaging Sandbox, Aircall messaging, configurable Conversations threshold, Analytics Hub fixes)
**Deploy:** `develop → staging` (staging only this pass) | **Type:** Feature
**Branches:** `develop`, `staging`

### Context
A large batch versioned as a major release given its scope: a safe way to
test entire messaging/cadence flows end-to-end with real provider APIs
without touching production data (the recurring pain point this quarter —
"we'll test it on prod" was never an acceptable answer), Aircall added as a
genuine second messaging provider alongside RCM Built-in Messaging, an
admin-configurable Analytics threshold, and two live Analytics Hub bugs
fixed.

### New Features
- **Cadence/Messaging Sandbox.** A Super Admin can now create a throwaway
  test lead (`Lead.is_test`), enroll it in any real, published Sales
  Cadence, and step through it live from Playground's new "Cadence Test"
  tab — "Force Next Step" advances the enrollment immediately instead of
  waiting out its real wait/send-window delay. Every send from a test lead
  is redirected server-side to an admin-configured
  `sandbox_test_phone_number`, unconditionally, regardless of what's on the
  lead's own phone field — real provider APIs, zero risk to a real
  customer. Test leads (and every DialerCall/CallLog/SmsLog/enrollment they
  generate) are excluded from all analytics, reporting, and activity feeds
  — audited across ~35 query sites (funnel, trend, SDR table, CSV export,
  batch summary, per-journey and admin-wide activity feeds, the dashboard
  status-change widget). "Clear All Test Data" bulk-removes them when done.
- **Aircall as a second messaging provider.** `AircallMessagingProvider`
  implements the existing provider-agnostic `MessagingProvider` interface
  using Aircall's native Messaging API, reusing the same account credentials
  already stored for Aircall calling. An org picks its active messaging
  provider (RCM or Aircall) in Settings; both the Cadence engine and
  the RCM Widget resolve through the same abstraction either way.
  **Not yet verified against a live send** — Aircall's own documentation
  disagreed with itself on the exact request shape during implementation;
  this needs a real test message before enabling in production, same as the
  RCM WhatsApp verification still outstanding from v10.9.14.
- **Admin-configurable "Conversations" threshold.** The 30-second cutoff
  deciding whether a call counts as a real conversation in Analytics
  (previously hardcoded) is now a Super Admin setting.

### Bug Fixes
- **Analytics Hub: filters no longer reset when switching tabs.** The
  legacy shell unmounts the whole React root on every navigation away from
  Analytics — applied filters (pod/date/batch) are now persisted to
  `sessionStorage` and restored on remount.
- **Analytics Hub: SDR Performance table's search icon is now vertically
  centered.** Root cause: this bundle deliberately skips Tailwind's
  `@tailwind base` to avoid leaking resets into the legacy shell, but was
  missing the same compositional-utility custom-property defaults
  (transform/ring/gradient) already patched into `sales-journey-tailwind.css`
  and `help-tailwind.css` for the identical bug — any standalone `-translate`
  utility silently no-ops without them.

### Data model
- `leads` gained `is_test` (Cadence/Messaging Sandbox tagging).
- `sync_settings` gained `conversation_min_seconds`, `messaging_provider`,
  `aircall_messaging_number_id`, and `sandbox_test_phone_number`.

### Known gaps, deliberately not addressed this pass
- Aircall messaging's exact request shape is unverified against a live
  account (see above) — do not enable in production until confirmed.
- The RCM WhatsApp live-send verification from v10.9.14 remains
  outstanding.

## v10.9.14 — 2026-08-14 (Provider-agnostic SMS/WhatsApp messaging + Cadence WhatsApp channel)
**Deploy:** `develop → staging` (staging only this pass) | **Type:** Feature
**Branches:** `develop`, `staging`

### Context
First engineering pass on tracking Aircall/RCM (RCM Messaging) SMS and
WhatsApp messaging in RCM, ahead of a fuller rollout plan. RCM's
Widget (Call + Message tabs) previously left zero local trace of any message
it sent or received — every conversation view was a live proxy call to
RCM's API, nothing was queryable in our own database, and WhatsApp had
no path into the Sales Cadence engine at all. This release closes both gaps.

### New Features
- **WhatsApp is now a Sales Cadence channel.** A new node type in the Journey
  Builder, backed by a provider-agnostic `MessagingProvider` abstraction
  (mirrors the existing `DialerProvider` pattern used for voice calls) —
  the cadence engine resolves "send WhatsApp," not "send WhatsApp via
  RCM specifically," so a second provider can be added later without
  touching the channel or the engine. Cold-outbound WhatsApp requires a real,
  Meta-approved template (Meta's own platform rule, not a RCM
  restriction) — the node's config panel has a live template picker pulling
  from the account's actual approved templates.
- **Inbound message capture.** RCM's messaging API has no push
  webhook (unlike calls) — a new 5-minute polling job discovers recent
  conversations account-wide and persists any new inbound message, matched
  to a lead via the same phone-matching logic calls already use.

### Bug Fixes
- **The RCM Widget's manual sends (SMS and WhatsApp) are now
  persisted** — `POST /api/conversations/send` writes a log row on every
  attempt, success or failure. Previously a message sent through the Widget
  left no trace anywhere in our own database.
- **Per-journey Activity feed correctly labels WhatsApp activity** — was
  previously indistinguishable from plain SMS in the underlying log; the
  feed (API and UI) now tags `whatsapp_sent`/`whatsapp_reply` distinctly.
- **Leads Hub: a long Source badge (e.g. an upload filename) no longer
  overflows into adjacent table columns** — the table's `table-layout:
  fixed` meant overflowing content wasn't being clipped; the Source badge
  now truncates with an ellipsis and shows the full name on hover.

### Data model
- `sms_logs` gained `channel` (`sms`/`whatsapp`), `provider`
  (`rcm`/future `aircall`), `conversation_id`, and `template_name`
  columns — extends the existing table rather than introducing a parallel
  one, now that it's shared by the Widget's manual sends, the Cadence
  engine's automated sends, and inbound replies.

### Known gaps, deliberately not addressed this pass
- The live WhatsApp send path (`/converse_desk/converse`) has not yet been
  verified against a real send — flagged, verification deferred.
- The admin-wide Activity Feed still has no SMS/WhatsApp visibility at all
  (only the per-journey feed does) — a pre-existing gap, not introduced by
  this change.
- Aircall as a second messaging provider is not built — the abstraction has
  room for it, but nothing here forecloses or commits to that decision.

## v10.9.13 — 2026-08-14 (Leads Hub full rollout, phone-masking deprecation, Cadence permission widen)
**Deploy:** `develop → staging → main` | **Type:** Feature/Fix
**Branches:** `develop`, `staging`, `main`

### Context
Following the pre-migration bug-fix pass in v10.9.12, the redesigned Leads
experience is now the default for everyone — the classic view remains one
click away for anyone who wants it. Two smaller cleanups shipped alongside:
retiring a phone-number masking feature that outlived the research-gate it
was built for, and resolving a documented soft-launch permission gap on
Sales Cadences enrollment.

### Changes
- **Leads Hub is now the default view** — `localStorage.leadsBeta` flips
  meaning from opt-in to opt-out (`'false'` only, set when a user clicks
  "Switch to classic view"). The classic list now shows a "Switch to the new
  experience" banner instead of "Try it (Beta)".
- **Phone-number masking removed** — the research-completion gate that hid
  phone numbers from non-admins until `research_company`/`research_contact`/
  `research_hypothesis`/`research_personalization` were all filled in is
  gone; the backend already sends real numbers to non-admins regardless, and
  the underlying research-gate feature this existed for is no longer in use
  (research is populated by other means now). Removed from the classic Leads
  list, the classic Dashboard's Priority Queue table, and the shared React
  `PhoneCell` (used by both Leads Hub and Power Dialer). The now-dead
  `research_complete` API field and its dedicated `load_only` columns were
  removed from `_lead_to_summary` as well.
- **Enroll-in-Cadence widened to Pod Admin+** — the Sales Cadences nav item
  and LeadsHub's bulk "Enroll in Cadence" action were Super-Admin-only for a
  one-week soft launch (since 2026-08-07); the backend has allowed Pod
  Admin+ via `require_pod_admin_or_above` the whole time. Widened the UI to
  match, closing the gap between what the UI implied and what the API
  actually allowed.

## v10.9.12 — 2026-08-14 (Leads-hub pre-migration bug-fix pass, Analytics Hub SDR panel scroll fix)
**Deploy:** `develop → staging → main` | **Type:** Fix
**Branches:** `develop`, `staging`, `main`

### Context
Ahead of a planned full-traffic migration to the redesigned React Leads
experience (`frontend-react/src/features/leads-hub/`, currently opt-in via
`localStorage.leadsBeta`), ran a systematic pre-migration audit: a live
Playwright pass plus 5 parallel focused code reviews (filters, inline
editing, saved views/columns, bulk actions/disqualify, main orchestration).
Separately, a live report of the Analytics Hub's SDR Performance table not
being scrollable while searching led to a structural fix there too.

### Bug Fixes — Leads Hub (beta)
- **Legacy source badge** — `"uploaded"`/`"manual"` (pre-`upload:filename:
  timestamp` format) rendered as raw unstyled text instead of a proper
  badge; `formatLeadSource` now handles both, matching the classic view.
- **Stale `dateTo` survives removing the "Created" filter chip** — one UI
  chip backs two fields (`dateFrom`/`dateTo`); removing it only cleared
  `dateFrom`, silently leaving `dateTo` applied with no visible chip
  explaining why leads still looked filtered.
- **"Status: Unassigned" + a specific "Assigned to" SDR silently cancelled
  each other** — `assigned_to` can only carry one value server-side, so
  picking a real SDR made the Unassigned checkbox a no-op while both chips
  stayed visibly "active". They're now mutually exclusive — picking one
  clears the contradictory other.
- **Saved Views dropped search text** — search lives outside the `filters`
  object and was never captured when saving a view, nor reset when
  switching views, clicking "All Leads", or "Clear all" — a search typed
  before switching silently kept narrowing results with no visible
  indication why.
- **Inline status/assignee/priority edits failed completely silently** — no
  error handling anywhere in the chain; a failed save looked identical to a
  successful one, with no toast, no rollback, no signal to retry.
- **`displayName()` could still show the literal "Unknown"** — the
  no-phone-fallback path's own `|| raw` defeated the function's entire
  purpose in exactly the case it exists to guard against.
- **Bulk Delete/Assign/Unassign had no error handling** — inconsistent with
  Enroll's existing pattern in the same file; a failed bulk delete left the
  confirm dialog open with zero explanation.
- **Multiple popovers could stay open simultaneously** — every interactive
  cell stops click propagation (so the row's own click-to-open doesn't also
  fire), which meant a click-outside-only close mechanism never saw a click
  that landed on a *different* row's popover trigger. Added a shared
  broadcast (same CustomEvent-bus pattern as `rcm:toast`) so opening
  any popover closes every other one.
- **"Connected via X" badge could reference a lead's own status** — the
  batched company-resolution query (used by the paginated list, unlike the
  single-lead path which already excluded this) didn't exclude the lead
  itself, so a company with a sole lead already at "Meeting Scheduled"
  could show that lead "connected via" itself.
- **No request-ordering guard on the list fetch** — rapid filter/tag
  toggling could let a slower, now-stale response land after a newer one
  and silently overwrite the table (same `requestIdRef` pattern already
  used in Analytics Hub's `DashboardTab.jsx`).
- **Schema-drifted localStorage could crash the whole page with no
  recovery** — valid JSON in the wrong shape (a future schema change,
  manual tampering) for Saved Views or the column layout's `hidden`/
  `widths` fields had no shape validation, and no `ErrorBoundary` existed
  anywhere in `frontend-react/src` to catch the resulting crash. Added
  shape validation plus a new reusable `ErrorBoundary` wrapping the
  Leads Hub mount, with a "Switch to classic view" escape hatch.
- Small fixes: saved-view id collision risk (`Date.now()` → `crypto.
  randomUUID()`), Escape not closing the Priority re-prioritize menu.

**Investigated, deliberately not changed:**
- **Phone masking is client-side only** — the backend already sends the
  real phone number to non-admins regardless of `research_complete`; the
  masked display is cosmetic. Confirmed the classic (already-shipped) view
  has the identical architecture, and the quick-call feature genuinely
  needs the raw digits client-side to place a call — a real fix means
  redesigning the call-initiation flow itself (affecting both UIs and
  Power Dialer broadly), not a leads-hub-specific patch. Flagged as a
  cross-cutting security consideration for its own initiative, not treated
  as a migration blocker since the beta doesn't make this any worse than
  what's already shipped.
- **Enroll-in-Cadence's backend role gate** (Pod Admin+) is looser than the
  UI's Super-Admin-only intent — but the code's own comment documents this
  as a deliberate, temporary tradeoff for the soft launch, not an
  oversight. Left as-is rather than unilaterally tightening a documented
  decision.

### Bug Fix — Analytics Hub
- **SDR Performance table now scrolls within its own bounded panel** — it
  shared a CSS grid row with the fixed-height Activity Trend chart and had
  no vertical overflow handling of its own, so a pod with many SDRs (or a
  broad search match) just grew the whole card past the viewport with no
  reliable way to reach the rows below. Now bounded to 320px with its own
  scroll and a sticky header.

### Testing
Backend (2179+ passed) and frontend (360+ passed) suites green. New tests
for every fix above, including the corrected source-badge behavior,
mutual-exclusivity filter guard, Saved Views search capture/reset, inline-
edit and bulk-action error toasts, the shared popover-close broadcast, the
company-resolution self-reference guard, localStorage schema-drift
survival (both Saved Views and column layout), the new `ErrorBoundary`
component, and the SDR table's bounded-height scroll container.

## v10.9.11 — 2026-08-14 (Salesforce source-label follow-up fix, Analytics Conversations column, per-pod timezone bucketing)
**Deploy:** `develop → staging → main` | **Type:** Fix + Feature
**Branches:** `develop`, `staging`, `main`

### Context
A Super Admin flagged a live screenshot still showing "Source: Salesforce"
on leads that were never touched by Salesforce, despite the v10.9.6 fix.
Investigation found the DB-layer fix (removing `Lead.lead_source`'s column
default) was correct but incomplete — the classic frontend's own badge
renderer independently defaulted a falsy `lead_source` to `'salesforce'`,
and had no case at all for the dialer's own auto-create tags
(`aircall_webhook:*`, `aircall_sync:*`), so those fell through to the same
mislabel regardless of what the backend actually stored.

Separately, the same admin asked for two Analytics Hub changes off a
screenshot of the SDR Performance table: a "Conversations" metric (calls
over 30s, excluding voicemail/no-answer), and a fix for US-team calls
appearing on the wrong calendar date when viewed from IST — a UTC-anchored
day boundary doesn't line up with any real team's actual work day.

### Bug Fixes
- **"Source: Salesforce" mislabel, take 2** — `frontend/js/views/lead_helpers.js`'s
  `renderSourceBadge` no longer defaults an empty/unset `lead_source` to
  Salesforce (shows a neutral "— Unknown" badge instead), only shows the
  Salesforce badge on an exact `"salesforce"` match, adds a proper
  "📞 Aircall" badge for `aircall_webhook:*`/`aircall_sync:*`, and shows
  any other unrecognized tag verbatim instead of guessing. Same
  `aircall_webhook`/`aircall_sync` recognition added to the React
  leads-hub's `formatLeadSource` for consistency. The existing test that
  had locked in the old (buggy) "defaults to Salesforce" behavior was
  corrected along with it.

### New Features
- **Analytics Hub: Conversations column** — a call counts as a real
  conversation if its outcome isn't a not-answered one (no
  answer/wrong number/voicemail — reusing the existing
  `NOT_ANSWERED_OUTCOMES` set) and its duration is unknown or over 30
  seconds. Auto-synced dialer calls with no SDR-tagged outcome are judged
  on duration alone (accepted noise: a voicemail pickup can itself run
  20-30s, and there's no reliable signal to separate that from a short
  real answer without an explicit "Left Voicemail" tag); manually-logged
  calls (no duration data at all) are judged on outcome alone. Surfaced as
  a new column in the SDR Performance table and in the CSV export.
- **Per-Pod timezone + timezone-aware date bucketing** — `Pod.timezone`
  (IANA name, set in POD Management; unset = UTC). The SDR Performance
  table's custom date-range filter now resolves each SDR's "day" using
  their own pod's timezone rather than one shared UTC day — two SDRs in
  different-timezone pods can be querying different UTC windows under the
  same on-screen date, which is the whole point: a US team's actual work
  day doesn't get split across two dates (or merged with the wrong one)
  the way a UTC-anchored boundary did. Scoped to the custom date_from/
  date_to path only — the 7d/30d/90d presets are a rolling window ending
  at `now` (an exact instant), not a picked calendar day, so they're
  unaffected by this fix. Deliberately not touched: the funnel and trend
  endpoints' own date handling — this pass is scoped to the SDR
  Performance table specifically, the surface that was actually reported.
- **Sales Cadence Send Window: custom Timezone picker** — a second report
  off the same investigation flagged the Send Window modal's Timezone
  `<select>` looking visually inconsistent (a 17-zone native OS popup —
  checkmarks, hover highlight — none of which page CSS can style).
  Replaced with a portal-rendered custom listbox matching the rest of the
  modal, positioned via the trigger's own bounding rect rather than
  in-place absolute positioning — the Modal's body scrolls
  (`overflow-y-auto`) and its outer card clips (`overflow-hidden`), so an
  in-place panel would get cut off the moment it needed more room than the
  modal's own flow height. Closes on outside click, on scroll, and on
  Escape (which `stopPropagation`s so it doesn't also close the whole
  modal in the same keypress).

### Testing
- Backend: full suite green. New tests for Conversations counting
  (dialer-call duration+outcome combinations, call-log outcome-only),
  per-pod-timezone bucketing (a call crossing UTC midnight correctly
  attributed to its pod-local day in both directions, a no-timezone pod
  falling back to UTC, two differently-timezoned pods bucketed
  independently in the same request), and Pod timezone CRUD validation.
- Frontend: full suite green. New tests for the corrected source-badge
  behavior, the Conversations column, the POD Management timezone
  selector, and the custom Timezone listbox (open/select/close,
  Escape-doesn't-close-the-modal, click-outside, disabled state).

## v10.9.10 — 2026-08-13 (P1 hotfix: RCM widget invisible click-blocking bug + cadence rename)
**Deploy:** `develop → staging → main` | **Type:** Hotfix + small feature
**Branches:** `develop`, `staging`, `main`

### Context
Live-reproduced (real staging JWT, real browser via Playwright, not code
re-reading) a user report that Sales Cadence merge-field chips were still
unclickable despite the `cursor-pointer` fix shipped in v10.9.8. The chips'
`onClick` wiring was correct — `document.elementFromPoint()` at the chip's
coordinates returned `#rcm-widget-root` (the React RCM dialer
widget's outer container) instead, proving something else was eating the
click.

### Root Cause
`RCMWidgetRoot.jsx`'s outer wrapper (`position: fixed`, `z-[9998]`,
mounted globally on every page) has no explicit size — its rendered box is
the union of its in-flow children: a `w-[340px] h-[480px]` panel (collapsed
only via `opacity-0 scale-90`, which hides content but does not remove
layout space) plus the `w-14 h-14` FAB button, totaling ~340×560px. The
panel's `pointer-events-none` was only ever applied to the inner panel div,
never the outer wrapper — so the wrapper kept default `pointer-events: auto`
and, being the topmost painted element at that z-index, silently intercepted
every click in that ~340×560px bottom-right region across the entire app
regardless of whether the widget was open or collapsed. This has been live
in production since v10.9.7 made the widget default-on.

### Fix
- `RCMWidgetRoot.jsx`: outer wrapper now gets `pointer-events-none`
  when collapsed; the FAB button gets `pointer-events-auto` so it stays
  clickable. `ToastHost` (rendered as a sibling, reused by other features
  too) defensively gets `pointer-events-auto` on its own fixed container so
  a toast stays dismissible regardless of the widget's state.
- Audited the rest of `frontend-react/src/` for the same bug class
  (globally-mounted floating/overlay UI that collapses via opacity/transform
  without disabling pointer-events on the full ancestor box). No second
  instance found — the only other candidate, the Aircall Everywhere drawer,
  already applies the correct pattern.
- Also investigated a second user-reported issue (the Send Window
  timezone `<select>`'s dropdown popup looking visually broken) — confirmed
  this is native OS/browser `<select>` list rendering (outside page CSS
  control, e.g. macOS Chrome's own checkmark/highlight styling), not a code
  bug.

### New Feature
- **Rename a cadence** — click the cadence name in the Journey Builder
  header (pencil icon, disabled once archived) to rename it inline; saves
  immediately via the existing `PATCH /journeys/{id}` settings endpoint
  (now also accepts `name`).

### Testing
- New regression test proving the collapsed wrapper doesn't intercept
  clicks (`RCMWidgetRoot.test.jsx`).
- New rename tests (frontend `JourneyBuilder.test.jsx`, backend
  `test_journey_routes.py`).
- Full backend + frontend suites green (one pre-existing, unrelated flaky
  test in `ReplyComposer.test.jsx` confirmed to pass in isolation).

## v10.9.9 — 2026-08-13 (Sales Cadences: engagement tracking, A/B testing, SMS, send windows, AI copy, auto-reply detection, unified Activity view)
**Deploy:** `develop → staging → main` | **Type:** Feature
**Branches:** `develop`, `staging`, `main`

### Context
A Klenty feature-parity pass on Sales Cadences (research + gap analysis, then
user-directed build of 7 of the identified gaps). Built in priority order:
auto-reply detection (small, foundational), engagement tracking (foundation
for reporting), send-time intelligence, A/B testing, SMS (discovered this
codebase already has a real, working RCM SMS send path —
`routes/sms_routes.py` / `rcm_sms_service.py` — wired the cadence
step to that instead of building a new vendor integration), a unified
cross-channel activity view, and AI-generated copy (reusing the existing
Groq config from Smart Analytics).

### New Features
- **Auto-reply / out-of-office detection** (`email_utils.is_auto_reply`) —
  header check (RFC 3834 `Auto-Submitted`, `X-Autoreply`/`X-Autorespond`)
  first, subject-line heuristic fallback. An auto-reply no longer counts as
  a genuine "Email replied" for a condition branch or the `email_received`
  entry trigger; a new `email_auto_replied` event lets a condition branch
  react to it explicitly if wanted. `LeadEmailActivity.is_auto_reply` flags
  it for visibility.
- **Cadence engagement tracking** — `email_channel.py` now requests Nylas
  open/click/reply tracking and logs every send as `LeadEmailActivity`,
  linked to its journey/enrollment/node (previously: sent but invisible).
  New `message.link_clicked` webhook handler. `GET /journeys/{id}/stats`
  gained an `engagement` block (sent/opened/clicked/replied + rates,
  overall and per step) surfaced in a new builder panel.
- **Send-time window** — per-cadence business-hours window + allowed
  weekdays + a fixed IANA timezone (`Journey.send_tz`,
  `send_window_start_hour/end_hour`, `send_days`). Applied only to
  automated-send nodes (email/sms), not wait/condition/call. No true
  per-lead timezone detection — this backend has no phone/geo timezone
  resolution to make that reliable; documented as a deliberate scope cut.
- **A/B testing** — an email node's `data.variants` (2+ `{key, subject,
  body}`) replaces its plain subject/body when present. Variant assignment
  is deterministic (hash of enrollment+node), not random, so a retried send
  lands on the same variant. Stats break down per variant within a step.
- **SMS cadence step** — new `sms` node type, wired to the existing
  RCM SMS send path (not a new vendor). Honest failure (retryable)
  when RCM isn't enabled/configured — no fake send. Message body
  supports merge fields, 1600-char limit with a segment-count estimate.
- **AI-generated email copy** (`journey_engine/ai_copy.py`) — a "Generate
  with AI" button on any email field (plain or per-variant) drafts a
  subject/body from a short brief, reusing Smart Analytics' existing Groq
  config (no second AI provider/config surface).
- **Unified Activity view** — `GET /journeys/{id}/activity` merges every
  outbound email/SMS send and inbound reply for a cadence into one
  chronological feed (capped at 100 most-recent events). Deliberately
  excludes Call-node Task reminders (no journey linkage on `Task` today,
  and Tasks already have their own list elsewhere).

### Schema
- `Journey`: `send_tz`, `send_window_start_hour`, `send_window_end_hour`, `send_days`.
- `LeadEmailActivity`: `clicked_at`, `click_count`, `is_auto_reply`,
  `journey_id`, `enrollment_id`, `journey_node_id`, `variant_key`.
- `SmsLog`: `journey_id`, `enrollment_id`, `journey_node_id`.

### Testing
- Backend: full suite passes with new coverage for auto-reply detection,
  pod/timezone/window scheduling, A/B variant selection and stats, the SMS
  channel (success/failure/not-configured/no-phone), the activity feed, and
  the AI-copy generation endpoint.
- Frontend: full suite passes with new coverage for the send-window
  settings UI, per-variant editors, the SMS node fields, the Activity panel,
  and the AI-generate button (including a real bug it caught: filling
  subject+body from a generated result as two sequential updates lost the
  first field on an A/B variant due to a stale-closure overwrite — fixed to
  a single atomic update).
- Bundles rebuilt (`sales-journey-hub`, `help-hub`) and verified.

## v10.9.8 — 2026-08-13 (Sales Cadence pod scoping, email-received trigger, JourneyList bug fixes)
**Deploy:** `develop → staging → main` | **Type:** Feature + Fix
**Branches:** `develop`, `staging`, `main`

### Context
Follow-up from live staging testing of Sales Cadences: merge-field chips
in the Email node had no `cursor-pointer` affordance; there was no way to
trigger a cadence when an SDR/AE receives an email (only lead-status-change
existed); and the previously-recommended pod-level cadence scoping was
built at the user's request. A strict-critic pass over the cadence list UI
(`JourneyList.jsx`) while doing this work also surfaced two real bugs,
fixed here.

### New Features
- **Pod scoping for cadences.** A cadence can now be scoped to one pod —
  only leads in that pod get auto-enrolled by its trigger. Unscoped
  (default) behaves exactly as before: all pods. Settable at creation or
  any time after, from the cadence builder header. `journeys.pod_id`
  (nullable, `NULL` = all pods).
- **New entry trigger: "SDR/AE receives an email from the lead."** Wired
  into the same inbound-email webhook that already tracks cadence replies
  (`backend/routes/webhook_routes.py`) — a lead can now enter a cadence the
  moment an inbound email arrives, not just on a status change.

### Bug Fixes
- **Merge-field chips in the Email node body now show a pointer cursor** —
  they were always clickable, but looked inert (browser default `<button>`
  cursor).
- **Bulk-select in Sales Cadences no longer leaks across a filter change.**
  Selecting cadences, then changing the search/status filter so one drops
  out of view, used to leave it silently selected — a bulk delete could
  remove a cadence the user could no longer see.
- **Partial bulk-delete failure now reflects correctly.** A batch of
  archive calls that partially fails used to leave the list showing stale
  pre-delete state and blocked retrying just the failure. Now refreshes
  the list regardless, and re-opens the confirm dialog scoped to only the
  cadences that actually failed.

### Testing
- Backend: full suite (2110 tests) passes; new coverage for pod-scoped
  entry-trigger matching (matching pod, non-matching pod, lead with no
  pod) and the `email_received` trigger, plus route tests for the new
  `PATCH /journeys/{id}` pod-scope endpoint.
- Frontend: full suite (310 tests) passes; new coverage for the pod
  selector (save + revert-on-failure), the trigger event-type switch, and
  the two `JourneyList` bug fixes.
- Bundle rebuilt (`build:sales-journey`); verified the compiled output
  contains `email_received`, `All pods`, and `cursor-pointer`.

## v10.9.7 — 2026-08-13 (React RCM dialer widget default-on)
**Deploy:** `develop → staging → main` | **Type:** Feature (flag flip)
**Branches:** `develop`, `staging`, `main`

### Context
The React port of the RCM dialer widget (Call + Message tabs,
`frontend-react/src/features/rcm-widget/`) has been built and tested
for weeks but stayed dark behind an opt-in `localStorage` flag
(`rcmWidgetReact`), off by default for every SDR. User requested it
be enabled for everyone, with the old vanilla widget kept as a fallback
(deprecation of the old code deferred to a later pass, not this release).

### Changes
- `rcm-widget-entry.jsx` and `dialerEngine.js`: flipped the flag
  check from opt-in (`=== 'true'`) to opt-out (`!== 'false'`) — the React
  widget is now the default for every SDR session; setting
  `rcmWidgetReact` to `'false'` in a browser's localStorage remains
  a per-browser emergency kill switch back to the old vanilla widget.
- No backend changes. No removal of the old `frontend/js/rcm_widget.js`
  — kept in place as the fallback until the new widget is validated live.

### Testing
- Full `rcm-widget` frontend test suite (52 tests, 6 files) — passes.
- Bundle rebuilt (`build:rcm`); verified the compiled output contains
  the opt-out check at both flag-read sites.

## v10.9.6 — 2026-08-13 (Sales Cadences management UI, user guide gaps, Salesforce source-label bug, Mixpanel coverage)
**Deploy:** `develop → staging` | **Type:** Feature + Fix
**Branches:** `develop`, `staging`

### Context
Follow-up feedback after v10.9.5 shipped: a live production screenshot
showing a manually-created/auto-created lead mislabeled "Source:
Salesforce", the bare-bones Sales Cadences list (no way to find/manage
cadences once there are more than a couple), a question about whether
cadence replies are tracked (they already are — this just needed
documenting and confirming), a product question on cadence scoping
(answered, not built — see below), three undocumented recent features in
the user guide, and a request to add Mixpanel tracking to recent
untracked features.

### Bug Fixes
- **"Source: Salesforce" shown on leads that never came from Salesforce**
  — `models.Lead.lead_source` had a column-level default of `"salesforce"`,
  so any creation path that forgot to set it explicitly silently
  mislabeled the lead. Removed the default (now `None`/`"—"` when
  genuinely unset); `salesforce.py`'s real Salesforce-sync creation path
  now sets `lead_source="salesforce"` explicitly instead of relying on the
  implicit default. Every other creation path (manual, upload, Klenty,
  Aircall auto-create, sandbox) already set it explicitly — audited all 7
  `models.Lead(...)` construction sites to confirm.

### New Features
- **Sales Cadences list: search, status filter, pagination, delete** —
  `JourneyList.jsx` previously had no way to find a specific cadence or
  remove one once there were more than a handful. Added a name search, a
  status filter (Draft/Active/Paused/Archived), 10-per-page pagination,
  and single/bulk delete (reuses the existing `/archive` endpoint, which
  already safely force-exits any active enrollments with a confirmation
  count — the UI now surfaces that count in a warning dialog before
  deleting).
- **User guide gaps closed** — added dedicated sections for Power Dialer
  (queue + Today's Calls search/filter/pagination), Analytics Hub
  (including the new AE self-scoped view), and Sales Cadences (including
  how reply-tracking works and how to auto-schedule a call on reply — see
  below). None of these three shipped features had any user guide
  coverage before this.
- **Mixpanel tracking added** to the four most recently shipped,
  previously-untracked features: Email Hub sends (cc/bcc/attachment
  flags, reply vs. new), email branding toggle, email signature save,
  Power Dialer's Today's Calls outcome filter, Analytics Hub views
  (role + self-scoped flag), and the new Sales Cadences create/delete
  actions. Followed the existing convention exactly — `mp.track()` via
  `frontend/js/mp.js` on the vanilla side, inline
  `window.mixpanel?.track(...)` (matching `useLeadsList.js`/`Dashboard.jsx`)
  on the React side. No shared React tracking helper exists yet — every
  call site inlines the same try/catch pattern; that's the established
  convention, not an oversight.

### Investigated, no code change
- **Does a cadence track replies?** Yes, already — a lead's inbound
  email reply is recorded as `LeadEmailActivity` and immediately checked
  against every active enrollment (`webhook_routes.py` →
  `journey_engine.engine.check_exit_triggers(db, "email_replied", ...)`).
  A Condition node's "Email replied" branch can route to a **Call** node,
  which creates an immediate task for the lead's assigned SDR/AE — this
  is the existing, already-shipped mechanism for "reply → schedule a
  call." Documented in the new Sales Cadences user guide section instead
  of building anything new.
- **Cadence scoping to a lead subset** — product question, not a build
  request this pass. Recommendation given to the user: pod-level scoping
  (reusing the existing pod model already used everywhere else in the
  app) is worth building later; a fully custom lead-list/segment scope
  would be a much bigger feature and isn't justified yet.

### Verification
Backend suite green (2096 passed, up from 2095). Frontend suite green
(301 passed, up from 296) — 5 new tests for the Sales Cadences list
(search, status filter, pagination, single delete with active-enrollment
warning, bulk delete) plus 1 new backend regression test proving a Lead
created without an explicit `lead_source` is `None`, not `"salesforce"`.
Every touched bundle rebuilt and grep-verified for the new tracking event
names and user guide section titles in the compiled output.

### Breaking Changes
None.

---

## v10.9.5 — 2026-08-13 (Email Hub — CC/BCC, signatures, rich text, sync poller; Analytics Hub for AE; Power Dialer layout fix)
**Deploy:** `develop → staging` | **Type:** Feature + Fix
**Branches:** `develop`, `staging`

### Context
A batch of live feedback items reported by the user in one sitting, spanning
Email Hub, Analytics Hub, and Power Dialer. Investigated each before writing
any code — two turned out to require more than a bug patch (rich text/
signatures needed building from scratch; email sync needed an actual
scheduler, not a fix to existing logic), and two initial implementation
attempts (React `EmailTab.jsx`/`LeadDetail.jsx`, `Analytics.jsx`) had to be
redirected mid-flight after discovering those components are part of a
disconnected React-Router SPA track (`App.jsx`) that isn't the app users
actually run — the real compose UI is `pages/Email/ComposeDrawer.jsx` +
`ReplyComposer.jsx` (mounted via `email-hub.js`, loaded globally in
`index.html`), and the real Analytics Hub is `DashboardTab.jsx` (mounted via
`analytics-hub.js`). Confirmed by rebuilding bundles and checking the actual
compiled output for expected strings before trusting any "done" claim.

### New Features
- **Cc/Bcc on email compose and replies** — `backend/routes/email_routes.py`
  parses and validates comma-separated recipient lists
  (`_parse_recipient_list`), added to the Nylas send payload. UI added to
  both `ComposeDrawer.jsx` and `ReplyComposer.jsx` (collapsed behind a
  "Cc/Bcc" toggle to keep the common case uncluttered).
- **Per-user email signature** — new `User.email_signature_html` column,
  `GET`/`PATCH /api/email/signature`, sanitized with the same allowlist as
  inbound mail (`email_utils.sanitize_preview` — links and images allowed,
  scripts stripped). Auto-appended to every outbound send. Editor lives in
  the real "My Settings" page (`frontend/js/views/sdr_settings.js` — a
  plain contenteditable + toolbar, no new dependency).
- **Rich-text compose body** — `ComposeDrawer`/`ReplyComposer`'s plain
  `<textarea>` replaced with a contenteditable + toolbar
  (`richTextToolbar.jsx`, native `document.execCommand`: bold/italic/
  insert-link/insert-image-by-URL). Backend's `_compose_body_to_html`
  sanitizes the incoming HTML instead of escaping it as plain text;
  `_plain_text_to_html` kept separately, unchanged, for Sales Journey's
  genuinely-plain-text templated sends (`journey_engine/channels/
  email_channel.py`).
- **Scheduled email sync poller** — email sync previously had no scheduler
  and no webhook at all; the only trigger was a background task fired by
  `GET /lead/{id}/emails`, meaning a reply (from the customer, or sent
  directly from an SDR's own Gmail app to the same thread) could sit
  unsynced indefinitely if nobody reopened that lead's tab. New
  `scheduled_jobs._email_sync_job` (every 5 min) reuses the existing,
  already-tested `_sync_full_mailbox` per-lead sync/dedup logic across the
  most-recently-active non-parked leads (capped at 50/tick). New
  `SyncSettings.email_sync_last_run_at` health field, matching the
  `klenty_last_sync_at` pattern.
- **Analytics Hub for AE role** — self-scoped only (no pod-wide or
  cross-SDR visibility). New `require_admin_or_ae` auth dependency;
  `analytics_routes._effective_ae_sdr` forces every dashboard endpoint's
  scope to the AE's own `sdr_id`/lead-assignment, *ignoring* any
  `pod_id`/`sdr_id` query param — verified with a test that an AE passing
  another pod's `pod_id` still gets 0 results. Pod picker hidden in
  `DashboardTab.jsx` for this role (`isAE`); nav item and the vanilla
  `app.js` route guard (`viewName === 'analytics'`) both updated to admit
  the role.

### Bug Fixes
- **Power Dialer's "Today's Calls" panel could get cut off** on the right
  side of the screen at real laptop widths, requiring a browser zoom-out to
  see it — classic CSS grid `min-width: auto` overflow (a grid item won't
  shrink below its content's intrinsic width without explicit `min-w-0`).
  One-line fix on each of the two grid-column `div`s in
  `PowerDialerHub.jsx`.
- **Duplicated, drifted `_plain_text_to_html`/`BRAND_TAGLINE` footer logic**
  noted in an earlier release — left as-is in `backend-react/routes/
  email.py` this pass (confirmed dead: `backend-react` is part of the same
  disconnected SPA track, not deployed).

### Verification
Backend suite green (2095 passed, up from 2069 at session start — 26 new
tests added across AE self-scope, branding toggle, cc/bcc, signature/
rich-text sanitization, and the email sync poller, including a security
test proving an AE can't widen scope via a crafted `pod_id` param).
Frontend suite green (335 passed). Every bundle claimed fixed was rebuilt
and grep-verified for the actual expected string in the compiled output
(backtick-quoted by this project's minifier, not `"`/`'`) before being
treated as shipped — this caught two wrong-file mistakes (`EmailTab.jsx`,
`Analytics.jsx`) that would otherwise have shipped as silent no-ops.

### Breaking Changes
None.

### Known follow-ups (not done this pass, flagged not silently dropped)
- The disconnected React-Router SPA track (`App.jsx`, `LeadDetail.jsx`,
  `Sidebar.jsx`, and others only it imports) is a real, confirmed-dead
  cleanup candidate — full removal deferred as a separate, dedicated pass
  since tracing its full blast radius (versus this session's already-large
  scope) needs its own pass.
- `backend-react/routes/email.py`'s duplicated tagline function — same
  dead-tree reasoning, not fixed.

---

## v10.9.4 — 2026-08-13 (Analytics Hub — Leads Assigned subtitle + docs backport)
**Deploy:** `develop → staging` | **Type:** Fix
**Branches:** `develop`, `staging`

### Context
User flagged that "Leads Assigned: 0" reads as a bug when an SDR is
actively working an older lead batch outside the selected date window —
the metric counts leads *created* in the window, not leads *worked*.
Product decision: keep the metric definition, make it visibly clear
instead (subtitle already had a hover-only tooltip saying this).

### Bug Fixes
- **"Leads Assigned" KPI card** now shows a visible subtitle ("Leads
  created in this period") instead of relying on a hover-only tooltip.

### Docs
- Backported the `v10.6.41` entry into `docs/RELEASES.md` on `develop`
  (previously main-only; already present in `releases.json`/help-hub
  bundle since yesterday's fix, but the plain-text changelog was still
  missing it). `docs/release-notes.md` was checked and confirmed to
  never carry per-patch `v10.6.x` entries on any branch — nothing to
  backport there.

### Verification
Full frontend suite green (331/331). `build:analytics` and `build:help`
rebuilt and committed.

### Breaking Changes
None.

---

## v10.9.3 — 2026-08-12 (Power Dialer call log fixes)
**Deploy:** `develop → staging` | **Type:** Fix
**Branches:** `develop`, `staging`

### Context
Reported directly off two live SDR screens (Anway, Muktha) while reviewing
the day's call activity.

### Fixed
- **"Unknown" lead name** replaced with the dialed phone number as a
  fallback whenever there's no real name to show — this covers both
  genuinely lead-less calls and auto-created leads whose placeholder
  `last_name` is literally "Unknown" (see v10.9.2's Aircall auto-lead-
  creation fix). "Unknown" is now shown only when neither a name nor a
  phone number exists at all.
- **Call duration** now shown as a column — the backend already returned
  `duration_sec`, the table simply never rendered it.
- **Download link** added next to the recording player.
- **Search + outcome filter + pagination (15/page)** added to the day's
  call list — previously rendered as one unbounded table, unusable for a
  high-volume SDR (Muktha's screen had 59+ calls with no way to browse).

### Investigated, not a code fix
- Recording being empty for some SDRs' genuinely-answered calls (Muktha:
  508/508 answered calls with zero recordings; four other SDRs also at
  0% while the rest of the org sits at 70–95%) traces to Aircall's own
  webhook payload carrying `recording: null` for those specific calls —
  confirmed by diffing the raw payload against an SDR whose recordings
  work fine, same event shape, same fields, one has a real S3 URL and the
  other doesn't. This is an Aircall account/number setting (call
  recording enablement), not something a RCM code change can
  produce — needs action in Aircall's own admin console.

☑ VERSION bumped + scripts/sync-version.mjs run
☑ backend/config.py APP_VERSION updated (manifest.json does not mention the version)
☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated

## v10.9.2 — 2026-08-12 (Analytics Hub & calling-data pipeline audit)
**Deploy:** `develop → staging` | **Type:** Fix
**Branches:** `develop`, `staging`

### Context
A full audit of the calling/analytics data pipeline, prompted by a reported
discrepancy (Emails Sent showing 0 in one Analytics Hub view vs. 49 in the
per-SDR table). The audit traced this to several independent, compounding
gaps across lead assignment, call attribution, and Analytics Hub's query
layer — all root-caused before any fix was drafted, per the repo's own
proper-solution-over-patch standard.

### Fixed
- **Leads silently lost their pod scoping.** ~9 lead-assignment call sites
  (uploads, round-robin, manual assignment, duplicate-user merges) appended
  a lead to a user's `assigned_leads` without syncing `lead.pod_id` to the
  assignee's pod — the lead then silently fell out of every pod-scoped
  analytics view despite having an active SDR. Fixed with one shared
  `models.assign_lead()` helper used at every call site instead of 9
  separate patches. **Backfilled**: 2,578 existing leads' `pod_id` from
  their most-recently-assigned SDR's pod.
- **Disqualified leads via the Account Disqualify (maker-checker) flow never
  got a `lead_closed_at`** — a real, unintentional gap (confirmed via git
  history) since that feature predates the analytics fields it should have
  set. Fixed with a shared `models.disqualify_lead()` helper, used by both
  that flow and the existing single-lead close flow. **Backfilled**: 80
  affected leads' `lead_closed_at` from their approving `disqualify_request`'s
  review timestamp — an exact source, not an inferred one.
- **Aircall calls to a number with no matching lead were silently
  unattributable** — the live webhook left them lead-less, and the nightly
  historical sync dropped them entirely. Both now auto-create and assign a
  lead when the calling SDR is a known RCM user (mirroring the
  existing Klenty sync's own create-on-miss pattern), consistent with
  policy: tracking is mandatory only for calls made by users who exist in
  RCM.
- **Connect Rate read near-0% for Aircall/RCM calls that were never
  manually tagged with an outcome** — those calls had no way to register as
  "connected" even when genuinely answered. Both providers now write
  `provider_disposition="ANSWERED"` from their own `answered_at` signal,
  the same native-connect fallback Klenty's sync already had.
- **The same metric could disagree between Analytics Hub views** depending
  on which pod-scoping or date-bucketing approach that particular query
  happened to use. Unified via shared helpers applied consistently across
  `/funnel`, `/trend`, `/email-breakdown`, and `/batch-summary`.
- **Removed the Research metric from Analytics Hub** (KPI card, funnel bar,
  trend line) — redundant with the team's own research workflow and a
  source of confusion, per product decision.

### Not in this release
- Two small, low-priority RCM-sync gaps (a missing `user_id` on
  synced rows; ~99 historically orphaned sync-path calls) — real but
  negligible in practice since RCM can only be dialed through
  RCM itself, no bypass path exists.

☑ VERSION bumped + scripts/sync-version.mjs run
☑ backend/config.py APP_VERSION updated (manifest.json does not mention the version)
☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated

## v10.9.1 — 2026-08-12 (Aircall Everywhere — drawer fix pass)
**Deploy:** `develop → staging` | **Type:** Fix
**Branches:** `develop`, `staging`

### Context
v10.9.0 shipped to staging only (never promoted to production). A closer UI
review plus a live critique-and-test-matrix pass (adversarial review of the
planned fix, then live Playwright checks against staging for states not yet
covered) surfaced real bugs before this went anywhere near production.

### Fixed
- **The drawer covered its own trigger button** whenever it was forced open
  (pending/failed login) — confirmed via live DOM measurement, the drawer's
  rect fully enclosed the trigger's. It also had no close button in that
  state, so there was no way to dismiss it until login finished. Root cause:
  `top:0` on the drawer covered the 60px topbar row the trigger lives in;
  fixed by anchoring below the topbar (matches the existing Ask-AI overlay's
  own convention) plus a redesigned open/close boolean so the close button
  (and Escape, and the trigger itself) actually works in every state except
  mid-call.
- **Opting out or being ineligible still squeezed the page layout** by
  440px even though no drawer ever rendered in those states — a real,
  confirmed bug (not just the one above), found by the live test matrix.
- **The first-time onboarding tooltip visually collided** with the drawer's
  own header/hint text, since both showed at once — now only appears once
  the drawer naturally collapses to just the trigger.
- **Visual polish**: header now shows an icon instead of bare text, the
  embed's mount box is centered with a dark background matching Aircall's
  own splash screen (was an asymmetric light-gray gutter), the opt-out link
  is now a separated footer instead of sitting flush under the embed.
- **Added**: Escape-to-close, and focus restoration if the drawer
  auto-collapses while focus was still inside it (a real, reachable
  accessibility gap, not previously covered).

### Not in this release
- A pre-existing, unrelated mobile-shell layout bug (`.nh-sidebar
  min-height:100vh` vs. the app shell's column layout at ≤768px) that
  predates this feature and affects the whole app on mobile — flagged, not
  fixed here.
- At exactly ~1024px-wide viewports, sidebar + drawer still squeeze page
  content to ~364px. No fix shipped — the only real lever (shrinking the
  drawer) would clip Aircall's own fixed-size embed. Needs a product
  decision (overlay instead of push below some breakpoint), not a CSS
  tweak.

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated

## v10.9.0 — 2026-08-11 (Aircall Everywhere — global drawer)
**Deploy:** `develop → staging` | **Type:** Feature
**Branches:** `develop`, `staging`

### Context
Click-to-call from RCM had a known reliability problem — it opens the
Aircall Desktop app, which sometimes fails or is delayed, so SDRs had largely
stopped using it and dialed directly from the Desktop app instead, relying on
sync to backfill RCM afterward. Aircall Everywhere (an embedded browser
version of Aircall's own Workspace app) lets an SDR log in inside the browser
instead — the existing, unmodified click-to-call REST call already rings
whichever device is logged in, so once Everywhere is the logged-in device,
the ordinary Call button just works, no code path change. Validated via a
15-item sandbox audit (`frontend/aircall-everywhere-test.html`, not shipped)
before any of this touched production code — real trial data, not a single
anecdote.

### What shipped
- **Moved out of Power Dialer into a global drawer**, reachable from every
  page instead of only while on the Power Dialer view — a header pill
  scoped to one page made no sense once the intent became "the Desktop app
  retires once this works," which requires Everywhere to be reachable
  everywhere, not just one screen.
- **Real slide-out panel**, not a dropdown popover — triggered from the
  persistent NavHub topbar, which survives navigating between pages (the
  panel's own mount point is never torn down, only visually toggled — a
  conditionally-unmounted mount div was a real bug found and fixed twice
  this session already, once here and once in the audit sandbox).
- **The page's content shrinks instead of getting covered.** The drawer no
  longer dims/blocks the rest of the page with a backdrop; `.view-container`
  gets a synced `margin-right` while the drawer is open, so an SDR on a call
  can still read the lead's own page instead of it being hidden behind the
  call panel.
- **One-time callout** the first time the trigger appears, explaining it's
  a one-time login and that dialing should still happen via the lead's Call
  button, not the embed's own dial pad (dialing through the embed directly
  bypasses RCM's own call-to-lead reconciliation).
- **The pre-existing "Dial" (manual/ad-hoc number) button is hidden once
  Everywhere is actually active** — its own embedded dial pad covers that
  need better. Stays visible for orgs on RCM, or SDRs who've opted
  out / haven't logged in yet, since they have no other way to dial an
  ad-hoc number.
- Org-wide kill switch (`aircall_everywhere_enabled`, Settings → Dialer)
  gates the drawer's entire render — off by default, no deploy needed to
  disable. Per-SDR opt-out (localStorage) for anyone who'd rather keep
  using the Desktop app; bridge mode is fully unaffected either way.

### Also in this release
- Fixed a real webhook-matching gap found while investigating: two SDRs
  calling leads that share a phone number could have their pending call
  rows cross-attributed — the match is now scoped to the resolved agent,
  narrowing only, verified safe for both Aircall and RCM.
- `aircall-everywhere`'s own CJS build double-wraps its default export;
  unwrapped defensively so `new AircallWorkspace(...)` doesn't throw.

### Not in this release
Two known real gaps from the live audit, tracked, not silently dropped:
whether staging's Aircall credentials point at the same account as
production (flagged as a real business risk, not yet confirmed), and one
`DialerCall` row observed live that never received its webhook-driven
`CALL_ENDED` update. Neither blocks this drawer specifically — both are
backend/data-integrity questions independent of where the login UI lives.

## v10.8.1 — 2026-08-10 (Power Dialer — live feedback pass)
**Deploy:** `develop → staging → main` | **Type:** Feature follow-up + fixes
**Branches:** `develop`, `staging`, `main`

### Context
A full day of live staging click-through against v10.8.0, driven by direct
user feedback rather than a guessed backlog. Each item below traces to a
specific reported gap or screenshot, not speculative polish.

### Performance & correctness (root-caused, not patched)
- **Fixed the ~3s Power Dialer load.** Traced via real Render logs to three
  separate N+1 query sources in the shared lead-listing code (missing
  `dialer_calls` loader strategy, sentinel-fallback notes/calls, and a
  `call_count` computation) — none introduced by Power Dialer itself, all
  fixed at the shared `lead_helpers.py`/`lead_routes.py` level, so every
  other lead-listing caller benefits too.
- **Fixed the dead drag-and-drop reorder** at the UI-kit level: `TableRow`/
  `Card` weren't forwarding `draggable`/`onDrag*`/`onDrop` props to the
  underlying DOM node. Any future caller of these primitives gets this for
  free.
- **Fixed a border-visibility bug in the shared `Table` component** — its
  outer wrapper had a border but no background fill, nearly invisible
  against the app's near-white page background. Fixes every table in the
  app, not just Power Dialer's queue list.

### Queue: persistence, filters, pacing
- **Server-side queue progress** (`DialerQueueStatus`, new table) —
  called/skipped state now survives a reload instead of resetting the
  whole queue back to Pending. A "called" lead also now drops out of the
  next fetch (`exclude_dialer_done`), so the queue can actually run dry.
- **"Call back"** — requeues a skipped lead as the very next call,
  without leaving the hub (previously the only way was navigating to Lead
  Detail).
- **Real filters** — status checkboxes and a debounced name/company/phone
  search, both against `GET /leads`' existing filter params (no new
  backend surface). **Hide already-called** as a client-side toggle.
- **Real pace, not a fixed count** — calls actually logged this session
  projected against leads left in the fetched page, plus the server-side
  total remaining beyond the current page. Today's call-count headline
  sources from the same `GET /api/my/today-calls` total the stats panel
  already shows — deliberately not a session-local counter, which would
  read "0" after every refresh.
- **Queue pagination** (15/page, client-side) — a 50-lead queue no longer
  renders as one long scroll.

### Call experience
- **Keyboard shortcuts** — `C` call/advance, `S` skip, `N` add a note, `O`
  open in CRM.
- **Inline call flow** — the app's one shared call/outcome modal now docks
  inside the current-call card instead of floating as a page-covering
  overlay, while Power Dialer is open. Same DOM node, same vanilla-JS
  logic everywhere else — this only repositions it, and it's handed back
  to its normal spot the moment you navigate away.
- **The Call button says what it'll actually do** — "Call via Aircall",
  "Call via RCM", or "Call — log manually", mirroring the same
  provider check `app.js` uses at call time.
- **Local-time badge** (🟢/🟡/🔴) next to the phone number, reusing the
  existing phone→timezone lookup already used on Lead Detail.
- **Lead-context strip** — location, company size, and lead source
  (mapped to a real label, not a raw internal value) on the call card,
  plus an always-visible Last Contact / Last Outcome line.
- **Add Note** and **View in CRM**, both without leaving the queue.
- Removed the client-side call-duration timer added mid-week — Aircall and
  RCM both already show one; a second, client-side one just drifted
  out of sync with the real call.

### Reporting
- **Skip-reason breakdown** (`GET /admin/dialer/skip-summary`, admin-only)
  — the skip/DNC data every rep's queue already wrote had no reporting
  surface anywhere until now.

### UX polish (from live screenshots, not guesses)
- Fixed a title/company line that could grow past its intended width
  instead of truncating.
- Fixed the search box's icon sitting off-center (swapped an absolute-
  positioning trick for a plain flex row).
- Fixed the current-call card visibly disappearing and reappearing on
  every debounced search keystroke — it was gated on the same `loading`
  flag used for the very first page load, so any background re-fetch
  yanked it out of the DOM. It now renders off `currentLead` alone; the
  column dims instead of hard-swapping while a re-fetch is in flight.
  Search debounce also bumped 300ms → 450ms so it settles after a pause.

### Also in this release
- Groq AI research: cap `retry-after` honoring at 30s — an unbounded wait
  on a 429 could block a single-worker deployment for over 20 minutes.
- Google Sheets import: pass through the sheet's `gid` (tab) from the
  source URL — a link to a specific tab was silently importing the
  spreadsheet's default tab instead.
- Admin Panel Super Admins table: fixed `.view-container` CSS so vertical
  scroll no longer had to happen before horizontal scroll would engage.
- Help Hub release-note bullets: fixed stale icon prefixes.

## v10.8.0 — 2026-08-07 (Power Dialer — replaces "Today's Calls")
**Deploy:** `develop → staging` | **Type:** Feature
**Branches:** `develop`

### Context
Recurring adoption feedback: SDRs/AEs wanted to work a list of leads and
place calls one after another from a single view (Klenty-style), instead of
opening each lead individually to dial. Built as a thin orchestration layer
over the dialer infrastructure that already exists — no parallel call
path, no new backend calling mechanism.

### New Features
- **Power Dialer hub** — fully replaces the classic "Today's Calls" nav
  item/view for SDR/AE. A queue of callable leads (`Lead Assigned` /
  `Research` / `Calling`, same set the Leads Hub's own quick-call already
  uses) sits alongside today's call history/stats in one screen — "both
  things happen at once," per the explicit product ask.
- **Call / Call Next / Skip** — the current lead gets a "Call" button that
  drives the exact same global call flow used everywhere else in the app
  (`window._openCallModal` → Aircall/RCM mode-picker → EC-16
  concurrency guard → outcome modal). Once that lead's outcome is logged or
  dismissed, the button becomes "Call Next," which only advances the queue
  pointer — it never dials automatically. "Skip" is always available,
  independent of call state, for a call that never connects.
- **A new signal, the one real gap that didn't exist before**: nothing in
  the app previously signalled "the SDR just finished with this call" in a
  form anything else could listen for. Three dispatch points now fire
  `rcm:call-outcome-resolved` (Save, Aircall's own auto-sync, and
  dismiss) — the Power Dialer listens for this to re-enable "Call Next,"
  but the event is generic and available to any future feature that needs
  the same signal.

### Contact-suppression gate — added to calling for the first time
Calling had **zero** do-not-contact/unsubscribed enforcement anywhere —
only Sales Journey's automated sends checked those columns. A power dialer
meaningfully raises the stakes of that gap (one click working through many
leads in a row), so `dialer_service.initiate_call()` now blocks any
suppressed lead before it ever reaches the provider — the single choke
point every calling path (Leads Hub quick-call, Power Dialer, ad-hoc dial)
already routes through, closing the gap everywhere at once. The Power
Dialer queue also pre-filters client-side (skips a DNC lead with a visible
badge, no call attempt at all) — a UX nicety only; the backend gate is the
actual enforcement and is never bypassed even with stale client data.

### Notable Engineering Decisions
- Advancing to the next lead is **manual by design** — confirmed with the
  user rather than assumed. A timer-driven auto-dial was considered and
  explicitly rejected in favor of keeping the SDR in control of pacing.
- No new backend endpoint for the queue — reuses `GET /leads` with the
  existing callable-status filter; SDR/AE scoping to "my own leads" already
  happens server-side, no new query param needed.
- No persisted/server-side queue state in this phase — a page refresh mid-
  session resets the queue (re-fetches cleanly) rather than resuming; worth
  revisiting only if cross-device/resume-after-refresh becomes a real ask.
- The classic `frontend/js/views/my_calls.js` (and its test file) are
  deleted outright, not deprecated-in-place — its only functional export
  (`getNavLeads`, feeding Lead Detail's prev/next bar) had no callers left
  once the view it fed was gone, so `lead_detail.js` was updated to fall
  back to the Leads Hub's own nav list instead of carrying dead code.

### Testing
Backend: 2025 tests (5 new — the eligibility gate). Frontend: 232 tests (16
new — the queue hook, CurrentCallCard's Call/Call Next/Skip state machine,
and a PowerDialerHub smoke test). Both suites fully green, zero
regressions.

### Breaking Changes
None for end users beyond the intentional nav-item replacement (SDR/AE
"Today's Calls" → "Power Dialer"). No API contract changes — `GET /leads`
gained two additive response fields; no existing consumer's shape changed.

---

## v10.7.0 — 2026-08-07 (Sales Journey — visual workflow automation engine)
**Deploy:** `staging → main` | **Type:** Feature
**Branches:** `develop`, `staging`, `main`

### Context
New capability: a visual, drag-and-drop workflow builder for omnichannel
sales outreach (email, call-as-task-reminder, wait/delay, conditional
branching), built as a natural extension of RCM's actual stack rather
than a generic template — no new infrastructure (no Celery, no Redis
broker, no Temporal), reusing the existing `scheduled_jobs.py`
threading.Timer pattern, the `DialerProvider` ABC pattern, and the hub/IIFE
frontend architecture already established. Full design, decision log, and
gap analysis: `docs/SALES_JOURNEY_ARCHITECTURE.md`.

Shipped in 4 phases, each independently tested and deployed to `develop`,
then held there deliberately while v10.6.39–v10.6.41 shipped to production
via Cadence-free hotfix branches (see those entries below) — this is its
first production deploy.

### New Features
- **Workflow execution engine** — a Postgres-native poller (`SELECT ...
  FOR UPDATE SKIP LOCKED`), crash-safe via claim leases, idempotent sends
  (no duplicate emails on retry/crash), a runaway-loop safety cap, and a
  contact-suppression gate (`do_not_contact`/`unsubscribed_at`) checked
  fresh before every automated send — the first thing in this CRM that
  recontacts a lead with no human re-checking each time.
- **Visual builder** — React Flow + Zustand canvas, 5 node types (trigger,
  email, wait, condition, call), live client-side validation, autosave with
  real optimistic-concurrency conflict detection.
- **Auto-enrollment** — a lead enters a journey automatically when it
  matches the journey's trigger (e.g. a status change), wired into the one
  shared funnel (`log_status_change`) every status-changing route already
  passes through, rather than touching each of its ~12 call sites.
- **Conditional branching** — a "condition" node waits for either a
  timeout or a matching event (status change, call answered/ended, email
  reply) and branches accordingly; wired into all three real event
  sources, not just the status-change path.
- **Publish / Pause / Resume / Archive** — publish is a versioned,
  atomic swap (in-flight leads keep executing the graph they enrolled on,
  even after a later edit); pause actually freezes execution now (closed a
  real gap — the engine previously ignored the paused status entirely);
  archive force-exits active enrollments with a confirmation step so leads
  can't be silently orphaned.
- **Enrollment & deliverability guardrails** — a per-journey enrollment
  rate cap, a cross-journey per-lead cooldown, and a per-domain send
  cadence limit (protects sending-domain reputation, distinct from the
  per-lead cooldown) — all tunable via env vars without a redeploy.
- **Admin dead-letter view** — failed/exited enrollments listed inline in
  the builder with one-click retry or permanent skip.
- **Where you'll see it**: a new "Sales Cadences" nav item and "Enroll in
  Cadence" in the Leads bulk-action bar — both **Super Admin only** for this
  first production rollout (see Production Rollout below) — plus a "Journey
  Status" card on the Lead Detail page for any enrolled lead, visible to
  whichever SDR owns that lead.

### Production Rollout — Super-Admin-only soft launch (2026-08-07)
This is new infrastructure (5 new tables, a 30s poller, real outbound
sends) getting its first production traffic, so it ships gated rather than
open to every Pod Admin+ on day one:
- **UI gated to Super Admin**: the nav entry and the bulk "Enroll in
  Cadence" action are hidden from Admin/Pod Admin/SDR (`NavSidebar.jsx`,
  `BulkActionBar.jsx`). Widen back to Pod Admin+ once the engine has real
  production mileage.
- **`POST /api/journeys/{id}/enroll` tightened to Pod Admin+** (was any
  authenticated user) — the one write endpoint that triggers a real send,
  closed against a direct API call from an SDR bypassing the hidden UI.
  Revert to `get_current_user` when SDR self-enroll is actually exposed in
  the UI.
- **Kill switch**: `JOURNEY_ENGINE_ENABLED=false` stops the poller from
  claiming or advancing any enrollment on the next restart — existing rows
  just wait — without a code revert.
- Authoring routes (create/publish/pause/archive) were already Pod Admin+
  and are unchanged.

### Notable Engineering Decisions
- The "Call" node deliberately does **not** place an automated phone call —
  RCM's dialer is human-in-the-loop by design (rings the SDR's own
  phone). Auto-firing it from a workflow engine would ring an SDR
  unprompted at an arbitrary time with no context. It creates a Task
  reminder for the lead's assigned SDR instead.
- No live SSE-updating status — a deliberate scope cut. Manual refresh via
  the existing status endpoints is correct, just not push-updated; the
  `sse_broker` keying would need real work to widen beyond `user_id`-only
  for a nice-to-have.
- Two dead-code traps were caught via the code-review-graph before wasted
  effort: `frontend-react/src/pages/Leads/LeadDetail.jsx` and (in an
  earlier release) `Login.jsx` both have zero importers — leftover from an
  abandoned SPA-rewrite tree. The Journey Status card went into the real,
  live `frontend/js/views/lead_detail.js` instead.

### Testing
Backend: 2020 tests. Frontend: 216 tests. Both suites fully green, zero
regressions, across all four phases plus the production-rollout gating pass.

### Breaking Changes
None. New tables and routes only; no existing behavior changed except the
two files noted above (`activity_logger.py`'s ACTION_TYPES whitelist
extended, `dialer_service.py` and the Nylas inbound-webhook handler each
gained one best-effort, try/except-wrapped hook that cannot affect their
existing behavior on failure).

---

## v10.6.41 — 2026-08-06 (Call Monitor: Connected-tile fix, missed-status pattern fix, auto-refresh-collapse fix)
**Deploy:** `main (cherry-picked from a main-based hotfix branch, not staging)` | **Type:** Fix
**Branches:** `develop`, `staging`, `main`

### Context
Sales Cadences (v10.7.0) remains on `develop`/`staging` only — same pattern
as v10.6.39 and v10.6.40. Reported by the user off a live Call Monitor
screenshot; root-caused with direct production DB queries against the
same data shown in the screenshot before writing any fix.

### Bug Fixes
- **The "Connected" tile showed 97% when the real connect rate was 2.5%**
  — it read `summary.completed` (`status ILIKE '%ENDED%'`), which is true
  for any call that reached a normal terminal state whether or not anyone
  answered. Added a separate `connected` field using the same
  answered-call check (`outcome` in the existing answered-outcomes set, or
  `provider_disposition='ANSWERED'`) already used correctly elsewhere in
  Analytics Hub's own Connect Rate, and pointed the tile at it instead.
- **368 genuinely-unanswered calls were invisible in every summary tile**
  — the "missed" pattern matched `%no-answer%` (hyphenated) but the real
  `DialerCall.status` value is `NO_ANSWER` (underscore), so those calls
  never counted as completed, failed, or missed.
- **The expanded call detail (notes/transcript) kept closing on its own**
  — auto-refresh rebuilds the whole table every 30 seconds, which silently
  collapsed whatever row a user had open mid-read. Now re-opens the same
  row after each refresh if it's still on the current page.

### Verification
Confirmed the 97%→2.5% gap directly against the same production call data
shown in the reporting screenshot (24,401 calls) before writing the fix.
Full backend suite green on both `develop` (2019 passed) and this
`main`-based branch (1954 passed — lower count expected, `main` doesn't
have Sales Cadences' own tests). Call Monitor suite green (46/46) on both.

### Breaking Changes
None.

## v10.6.40 — 2026-08-06 (Analytics funnel unit mismatch + Klenty silent sync failure + Aircall pod_id fix)
**Deploy:** `main (cherry-picked from a main-based hotfix branch, not staging)` | **Type:** Fix
**Branches:** `develop`, `staging`, `main`

### Context
Sales Cadences (v10.7.0) remains on `develop`/`staging` only — deliberately
NOT included in this release, same pattern as v10.6.39. These 5 fixes were
built on `develop`, then re-applied onto a branch cut from `main` (not
merged from `staging`, which would have dragged in Sales Cadences) so they
could ship to production independently.

Investigated live, in production, after the user reported the Analytics
Hub's numbers looking wrong for specific days this week. Root-caused with
direct production DB queries and a live Klenty API probe (with the user's
own credentials) rather than guessing from code alone.

### Bug Fixes
- **Pipeline Funnel's Calling bar counted call attempts, not leads reached**
  — inconsistent with every other bar in the same chart (Assigned, Research,
  Meeting, Disqualified), which all count leads. A lead dialed 3 times
  looked like 3 leads reached the Calling stage.
- **Research Complete's subtitle implied it was scoped to the selected date
  range** — it's actually a live, all-time snapshot across the pod (by
  design, per the backend's own `research_note`), which is why it looked
  "frozen" when comparing two different days. Reworded, not re-scoped.
- **Klenty call sync silently treated a real API rejection identically to
  an ordinary empty day** — a K2002 "invalid date range" response and a
  K2003 "nothing found" response both resolved to "0 calls found," with no
  way to tell them apart in logs. This is exactly what let a genuine
  Klenty-side fault go unnoticed for 6 days while the nightly job kept
  reporting success. Now raises on any non-K2003 code; default lookback
  widened 3→10 days since a 3-day window's start date sat permanently
  inside the ~6-day window LIVE-TESTED to be affected.
- **No monitoring signal existed for Klenty sync health** — added
  `klenty_enabled` / `klenty_last_sync_at` / `klenty_last_sync_age_seconds`
  to `/api/monitoring/health`, meaningful now that the fix above makes the
  timestamp actually stop advancing on a real failure.
- **A manually-dialed unknown number's auto-created lead never got a
  `pod_id`** — unlike the equivalent Klenty auto-lead-creation path, which
  already sets `pod_id` from the calling SDR. The call still counted toward
  the SDR's pod in analytics, but the lead itself was an orphan in no pod's
  own lead list.

### Verification
Manually backfilled the real Aug 1–6 Klenty gap (86 calls, 42 new leads)
using the existing `/api/admin/dialer/sync-klenty` endpoint; confirmed via
direct DB query that the recovered numbers match Klenty's own API exactly
(78 calls on Aug 3, 5 on Aug 5, 0 on the other days). Full backend suite
green on both `develop` (2017 passed) and this `main`-based branch (1952
passed — lower count expected, `main` doesn't have Sales Cadences' tests).
Frontend suite green on both (215 / 172 passed, same reason for the gap).

### Breaking Changes
None.

## v10.6.39 — 2026-08-05 (Admin Users cache-invalidation fix + dialer FAB clearance fix)
**Deploy:** `main (cherry-picked from staging)` | **Type:** Fix
**Branches:** `develop`, `staging`, `main`

### Context
Two live bugs reported on Admin > Manage Users, in production. Note:
Sales Journey (v10.7.0) is on `develop`/`staging` but deliberately NOT
included in this release — these 2 fixes were cherry-picked directly onto
`main` ahead of it, since Sales Journey hasn't been approved for prod yet.

### Bug Fixes
- **`/api/admin/users` cache wasn't invalidated on delete, role change,
  access toggle, or settings update** — only user creation busted the
  120s cache. Deleting a user or changing their role committed correctly
  to the DB, but the Admin console could keep showing the stale
  pre-mutation list for up to 2 minutes, even after a hard refresh.
- **RCM dialer FAB (fixed, bottom-right, high z-index) was
  swallowing clicks on table content beneath it again** — the 07-31 fix
  (v10.6.x) reserved 100px of clearance, but real Admin Users rows with
  several columns (Dialer Override, RCM Agent, longer emails) can
  wrap on a laptop-width screen, eating that thin margin. Bumped to a
  real ~60-97px margin.

### Breaking Changes
None.

---

## v10.6.38 — 2026-08-04 (Help & User Guide + Feedback modal migrated to React; searchable release notes)
**Deploy:** `staging → main` | **Type:** Feature + Refactor
**Branches:** `develop`

### Context
The Help & User Guide page and the Send Feedback modal were the last
everyday-visible UI still off the React design system that leads-hub/
analytics-hub/dashboard-hub already migrated to. Also addressed two
related, previously-reported problems: the in-app footer's version
number had drifted stale (showed v8.2.0 while production was on
v10.6.37, with no protocol rule catching it), and the 159-entry release
notes list was an all-or-nothing scroll with no way to find a specific
past fix.

### New Features
- **Help Guide is now a React bundle (`help-hub`)** with real search —
  a fast client-side filter over every section and every release-note
  entry individually (not just "the whole What's New section matched").
  All 20 topics carried over faithfully (verified via an AST-based
  extraction script, not hand-retyped) plus the full release history,
  now structured JSON instead of hardcoded HTML.
- **Send Feedback modal redesigned** onto the shared design system
  (`ui/Modal` + `ui/Button`, lucide icons instead of emoji) — same
  behavior, same 3 feedback types, same submission flow.

### Improvements
- **Version/brand string consolidated to one source** (`VERSION` +
  `scripts/sync-version.mjs`) — was hardcoded independently in 8 places
  with two of them already drifted from each other and from reality.
  See `AGENT_PROTOCOL.md` Rule 15.
- Removed the "Pipeline (Kanban Board)" guide section — Kanban has been
  decommissioned.
- Removed now-fully-dead legacy vanilla feedback-modal wiring.

### Breaking Changes
None — same URLs, same nav entry, same feedback submission contract.
The classic `frontend/js/views/user_guide.js` is left on disk,
unreferenced (matches the existing `dashboard.js` precedent).

### Testing
Full backend suite green. Full frontend-react suite green (164+ passed
across 20 files), including new coverage for HelpHub (role filtering,
search-over-sections, search-over-individual-release-entries, Kanban
section absent) and the redesigned FeedbackModal. Verified via built-
bundle inspection that Tailwind CSS and all section/release-note
content are present in the shipped output.

## v10.6.37 — 2026-08-04 (Fix slow lead-detail and kanban loads found during DB-outage RCA)
**Deploy:** `staging → main` | **Type:** Performance fix
**Branches:** `develop`

### Context
While RCA'ing the 2026-08-03 production outage (DB plan upgraded from
256MB to 1GB to recover), found the outage's proximate trigger — request
latency, not just DB capacity — was itself caused by real query bugs:

1. `GET /api/leads/{id}` (lead detail) and `GET /api/leads/kanban` (kanban
   board) each `joinedload`ed 2-3 separate one-to-many collections
   (`assigned_users`, `call_logs`, `dialer_calls`) in a single query — a
   SQLAlchemy cartesian-product join that multiplies row count across all
   of them, worse the longer a lead has been worked. `[PERF]` logs showed
   the lead-detail endpoint at 1.7s-14.9s under load.
2. Kanban also never eager-loaded `tags` or `dialer_calls` at all — both
   were lazy-loaded per lead, unbounded across the entire active-lead board.
3. Lead detail and call-logging both used an unbatched company-resolution
   helper (full-table scan + a query-per-sibling-lead loop) when a
   2-query batched version already existed and was already used by the
   leads list/My Leads views.

### Bug Fixes
- `get_lead`, `get_kanban_leads`: `joinedload` → `selectinload` for the
  multi-collection relationships, eliminating the cartesian blowup.
- `get_kanban_leads`: added `selectinload` for `tags`/`dialer_calls` and
  the same batched note/call prefetch (`_batch_latest_activity`) the
  paginated leads list already uses — no more per-lead N+1 across the board.
- `get_lead`, `log_call`: switched to the existing `_batch_company_resolutions`
  helper instead of the unbatched, per-sibling-loop version.

### Breaking Changes
None — same response shape, same data, just fewer/cheaper queries to build it.

### Testing
Full backend suite (1947 tests) green, no regressions. Verified via
`code-review-graph` that no other multi-collection `joinedload` site exists
elsewhere in the codebase and that `get_kanban_leads` was the only other
unbounded (non-paginated) query with this pattern.

## v10.6.36 — 2026-08-03 (Salesforce field population: description, SDR name, LinkedIn, correct address/title fields, kept in sync on every push)
**Deploy:** `staging → main` | **Type:** Feature + Bug fixes
**Branches:** `develop`

### Context
Follow-up to the Salesforce sync-recovery work: the user asked why
Description wasn't being populated on recreated/newly-created Leads, and
to audit what other available local data wasn't reaching Salesforce.
Verified directly against a real Lead record in the org (screenshot of
its actual page layout, not a guess) and found several concrete gaps:

1. `push_lead_to_salesforce`'s new recreate-on-delete path (and 3 of its
   5 callers) never built a Description at all.
2. `SDR_Name__c` exists on the org's Lead layout (confirmed live) and was
   never populated from anywhere.
3. `LinkedIn_Profile__c` exists; we've had `linkedin_url`/`person_linkedin`
   locally the whole time and never pushed either.
4. The org's Lead layout has no standard `Title` field at all — only a
   custom `Job_Title__c` — so every Title we ever pushed was landing on a
   field nobody looks at.
5. City/State/Country are contact-level fields, almost always blank on a
   list-sourced lead — the real location data lives in the `company_*`
   enrichment fields, which were never used as a fallback.
6. `disqualification_reason` has always been passed to
   `push_lead_to_salesforce`, but had no entry in the field map at all —
   silently dropped on every single disqualification push.
7. Follow-up question from the user: `SDR_Name__c`/`LinkedIn_Profile__c`
   were only wired into the *creation* path — a lead reassigned to a
   different SDR, or given a LinkedIn URL after creation, would leave
   Salesforce showing a permanently stale value.

### Bug Fixes / Improvements
- **Description now populates on every push**, not just some — reuses the
  existing `_build_lead_description(lead, db=None)`, which already
  degrades gracefully (skips call-history/notes sections without a db
  session) rather than failing.
- **`SDR_Name__c`** now populated from the lead's assigned SDR(s).
- **`LinkedIn_Profile__c`** now populated from `linkedin_url`/`person_linkedin`.
- **Title now maps to `Job_Title__c`**, not the unused standard `Title` field.
- **City/State/Country now fall back to `company_city`/`company_state`/
  `company_country`** when the contact-level fields are blank.
- **`disqualification_reason` now maps to `Lead_Lost_Reason__c`** instead
  of being silently discarded.
- **`SDR_Name__c` and `LinkedIn_Profile__c` now re-sync on every push**,
  not just at creation — `push_lead_to_salesforce` pulls them from
  `lead_info` automatically unless a caller explicitly overrides them.

### Files Changed
- `backend/salesforce.py`
- `backend/routes/lead_routes.py`
- `backend/routes/call_routes.py`
- `backend/tests/test_salesforce_client.py` (11 new tests)

### Migration Notes
None — no schema change. Existing Leads pick up the corrected field
mapping the next time any push path touches them.

## v10.6.35 — 2026-08-03 (Guard against two push paths recreating the same deleted Salesforce Lead at once)
**Deploy:** `staging → main` | **Type:** Hardening
**Branches:** `develop`

### Context
Self-review after v10.6.34 shipped: 6 different push paths (Kanban move,
call outcome, no-show, disqualification, scheduled sync, status-reach)
can each independently detect the same lead's deleted `sf_lead_id` and
attempt to recreate it. Without a lock, two of those firing close
together — e.g. a Kanban move and a call outcome landing near-
simultaneously — could both find no existing match and both create a
duplicate Lead in Salesforce for the same local lead. Not yet observed in
production (this system has hit `ENTITY_IS_DELETED` exactly once so far),
but the same class of race this codebase already fixed once for Klenty's
sync job (v10.6.29).

### Bug Fixes
- **Added a per-`sf_lead_id` lock around the recreate step** in
  `push_lead_to_salesforce`. A second, near-simultaneous recovery attempt
  for the same stale id now skips immediately (matching the existing
  Klenty-sync lock's `acquire(blocking=False)` pattern) instead of racing
  the first — unrelated leads are unaffected, since the lock is scoped
  per-id, not global.

### Files Changed
- `backend/salesforce.py`
- `backend/tests/test_salesforce_client.py` (1 new test)

### Migration Notes
None.

## v10.6.34 — 2026-08-03 (v10.6.33's fix didn't actually recreate a deleted-in-Salesforce Lead)
**Deploy:** `staging → main` | **Type:** Bug fix (critical)
**Branches:** `develop`

### Context
User reported v10.6.33 "not working" — reopened Ajay Jagga's Sync Logs entry
and saw the same still-failing record. Verified directly against the
production DB: no new push attempt had happened since v10.6.33 deployed
(the screenshot was the same pre-fix failure, just viewed in local time,
which is why it looked new) — but re-checking the actual code path
surfaced a real, deeper gap in that release: clearing `sf_lead_id` on
`ENTITY_IS_DELETED` only helps if some *other* push path with "create if
missing" logic later runs for that same lead. Two of the six push call
sites have that fallback (the scheduled/manual Sync button, and the
one-time-per-status-reach `_check_sf_push`) — but both only fire while a
lead's status exactly equals the org's configured `sf_push_stage`
("Meeting Scheduled" here). Ajay Jagga's lead had already progressed past
that stage to "Demo Done," so neither would ever touch it again. The
*only* path that still fires for it — the Kanban status-move's direct
push — never had create-fallback logic at all, so clearing the stale id
left it permanently unlinked with no path back into Salesforce.

### Bug Fixes
- **`push_lead_to_salesforce` now recreates the Lead immediately**, right
  where it detects `ENTITY_IS_DELETED`, instead of only clearing the
  stale id and hoping some other push path re-links it later. New shared
  `find_or_create_lead_in_salesforce()` (email dedup-check, else create)
  used for this and available for reuse elsewhere. Falls back to a plain
  unlink (previous v10.6.33 behavior) only if the recreate attempt itself
  fails, so a lead is never left permanently stuck either way.
- **`lead_push_info()` now carries the fuller field set** (company, phone,
  title, industry, address, etc.) a real Lead creation needs, not just
  name/email — no caller changes needed, they already pass the full
  `lead` ORM object into this helper.

### Files Changed
- `backend/salesforce.py`
- `backend/tests/test_salesforce_client.py` (5 new/updated tests)

### Migration Notes
None — no schema change.

## v10.6.0 – v10.6.33 — 2026-07-23 to 2026-08-03 (consolidated release notes)
**Deploy:** `staging → main` | **Type:** Feature + Bug fixes (consolidated, 34 releases)
**Branches:** `develop`

### Context
This entry merges 34 individual point releases (v10.6.0 through v10.6.33,
shipped 2026-07-23 to 2026-08-03) into one consolidated write-up, at the
user's request, for a cleaner changelog. It covers five threads of work:
the React Leads Hub redesign and its rollout to every role, an Analytics
Hub reliability pass, Klenty/dialer sync integrity, a RCM widget
React rewrite (still flagged off by default), and Nylas Calendar booking.
The full commit-by-commit history remains in git (`git log --oneline
<tag-or-sha-for-v10.6.0>..<tag-or-sha-for-v10.6.33>`) for anyone who needs
the individual investigation write-ups this entry compresses.

### New Features
- **Nylas Calendar booking**: "Meeting Booked" now creates a real calendar
  event and sends a real invite (reusing the SDR's connected mailbox), with
  a custom title, an AI-drafted agenda ("✨ Draft with AI," built from
  public-safe facts only), a review-before-send confirmation step, a
  free-busy conflict warning, extra guest emails, and a hard block for
  SDRs with no connected mailbox. Calendar Hub shows the real event
  subject instead of a synthesized label.
- **Nylas Test Connection diagnostic** in Settings — verifies a saved API
  key actually works before an SDR's mailbox OAuth hits it live.
- **Klenty admin-triggerable backfill** (`POST /api/admin/dialer/sync-klenty`,
  Super Admin only) — a one-off catch-up sync with up to a 29-day lookback,
  to recover a sync gap without waiting on the nightly job's normal 3-day
  window.
- **React Leads Hub redesign, opened to every role**: bulk approve/reject
  and column sorting on Disqualify Requests; column customization
  (reorder/resize/show-hide); SDR daily-workflow parity (priority-tier
  default sort, phone-research gating until complete, a working quick-call
  button, a visible priority badge); SDR capacity (`active/max`) shown in
  the assign picker; the "Try it (Beta)" banner is now shown to every role,
  not just Super Admin/Admin/Pod Admin.
- **RCM Call/Message widget React rewrite** — real conversation
  history, live polling, and an unread badge for the Message tab (the
  actual fix for "No messages yet"); the Call tab's dialer engine ported
  1:1 in behavior. Still gated behind `rcmWidgetReact`, off by
  default — not yet promoted past internal testing.

### Bug Fixes — Analytics Hub
- Custom date-range picks could show wrong numbers from an out-of-order
  response race (filling "from" before "to" fired an incomplete, slower
  request that could land after the correct one and silently overwrite
  it) — the filter panel now requires an explicit "Apply Filters" click,
  plus a request-staleness guard.
- Calls synced in late by Klenty/Aircall's catch-up jobs were dated by
  ingestion time instead of real call time across every date-filtered
  analytics view — added one shared `dialer_call_event_time()` helper
  used everywhere reporting reads a call's date.
- Klenty-heavy pods structurally read ~0% Connect Rate (batch-synced
  calls never get a CRM-tagged outcome, only Klenty's own raw
  disposition); an SDR who dials entirely through Klenty was wrongly
  flagged "Inactive" from a stale login timestamp.
- The Activity Trend chart's metric-chip toggle was inverted (clicking to
  hide a metric showed it, and vice versa); the SDR filter didn't scope
  the chart's Disqualified line; the Lead Source filter didn't scope
  Calls/Connect Rate/Avg Retries/Emails Replied on the funnel cards; the
  batch comparison table ignored the date range for its per-batch
  metrics; CSV export was silently downloading the app's own `index.html`
  instead of real data (a relative fetch URL resolving against the wrong
  origin).
- The dashboard intermittently failed to load ("Failed to load dashboard
  metrics") during a calling-provider brownout — a background job was
  holding a DB connection for its whole batch instead of per-call,
  starving the pool for unrelated requests.

### Bug Fixes — Klenty / Dialer sync
- Klenty's nightly sync had been silently importing zero calls since
  launch (wrong response shape assumed, plus per-SDR scoping that didn't
  actually scope) — now correctly imports Klenty-placed calls into each
  SDR's history.
- The backfill crashed on a duplicate `call_id` returned twice within one
  run, and two sync invocations (the recurring job, a startup catch-up,
  and a manual admin trigger) could run concurrently and race on the same
  call insert — added within-run dedup and a process-wide lock so only
  one sync runs at a time.
- Klenty call attribution incorrectly depended on `dialer_enabled`, a
  toggle for RCM's own separate click-to-call dialer — any SDR who
  calls entirely through Klenty had their real call history silently and
  permanently discarded as "unattributed" on every sync. Now matches on
  role instead.
- SDRs could get blocked from dialing their next lead for a few minutes
  after a call — a phone-number country-code mismatch misattributed
  real-time call-answered/ended events to the wrong internal record.
- Aircall/RCM: two near-simultaneous webhooks for the same call
  (e.g. answered then ended, back-to-back) could both miss the existing-
  call lookup and crash on a duplicate insert, leaving the call stuck
  "Pending" forever — now recovers by re-fetching instead of crashing.
- The floating RCM dialer FAB was intercepting clicks on any
  table's last row rendered underneath its fixed screen position,
  app-wide — fixed with reserved bottom padding on the shared page
  container.
- **A Lead deleted directly in Salesforce now gets recreated on the next
  sync** instead of failing identically, forever, with no recovery path —
  `push_lead_to_salesforce` detects Salesforce's `ENTITY_IS_DELETED` error
  and clears the local link. A background push that failed no longer
  falsely marks a lead "synced." Sync failures are now always searchable
  by name/email in the Sync Logs page, not just by the exact Salesforce
  record ID.

### Bug Fixes — React Leads Hub
- SDR/AE couldn't see any leads at all on the redesigned page — a
  redundant admin-only gate rejected every request with a 403 that
  silently rendered as "no leads," not an error.
- Lead-import's "Update existing leads" toggle was physically unclickable
  (wrong markup broke the native label→checkbox click forwarding), and —
  separately — existing leads matched by email/phone weren't being
  assigned to the chosen SDR even when the toggle worked.
- Re-prioritizing a lead to Medium or Deprioritized silently reset it to
  High (the client sent `{ score }`, the backend read `{ priority_score
  }`); the quick-call button was a non-functional stub; admin-only
  controls (Round Robin, Assign mode, the "Assigned To" column) leaked to
  non-admin roles that would just get a 403 on click.
- The pinned Contact column overlapped the Status column at realistic
  window widths once column customization turned on fixed table layout;
  static reference data (tags, SDR roster, companies) was re-fetched from
  scratch on every navigation back into Leads.
- A long tail of design-system fixes across the redesign's rollout:
  invisible button text and native button chrome (missing Tailwind
  Preflight reset), inconsistent icons, missing/broken focus states, an
  unstyled native `<select>` for bulk-assign, a non-functional "delete
  saved view," Source/Last-outcome filters silently returning zero leads
  for most options, Klenty-created leads showing a raw "Unknown"
  placeholder name instead of their phone number, and native browser
  `confirm`/`prompt`/`alert` popups replaced with the app's own modal.

### Bug Fixes — Calendar / Email
- The Lead Detail stepper's "Meeting Scheduled" gate always blocked the
  move even with calls already logged — a progressive-loading refactor
  had left the gate reading a permanently-empty local variable instead of
  the real call list; the backend gate had a parallel bug for calls
  logged entirely through the in-app dialer.
- A pasted Nylas API key/Client ID/Webhook Secret with a hidden
  non-ASCII character (a smart quote from copy-paste) silently broke
  mailbox connections — now rejected at save time with a clear error
  instead of a broken save.

### Files Changed
Too broad to list per-file across 34 releases — see git history for the
exact diffs. Primary areas touched: `backend/routes/{analytics_routes,
lead_routes,call_routes,dialer_routes,admin_upload_routes}.py`,
`backend/{scheduled_jobs,klenty_provider,salesforce,models,migrations}.py`,
`backend/nylas_calendar.py` (new), `frontend-react/src/features/
leads-hub/**`, `frontend-react/src/pages/{Analytics,Calendar}/**`,
`frontend-react/src/features/rcm-widget/**` (new), `frontend/js/
views/**`.

### Migration Notes
- Additive schema changes across this range, all nullable, no backfill
  required unless noted: `leads.calendar_event_title`/`calendar_event_agenda`,
  `leads.nylas_event_id`/`calendar_event_url`, `dialer_calls.provider_disposition`.
- One one-time migration backfilled `started_at`/`provider_disposition`
  for ~7,000 existing Klenty rows from their own stored `raw_payload` —
  already run automatically on deploy, tracked in `_applied_migrations`.
- No destructive changes anywhere in this range.

## v10.5.9 — 2026-07-22 (Prod hotfix: US phone numbers misdialed as India)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix (live production, urgent)
**Branches:** `develop`, `staging`, `main`

### Bug Fixes
- **US phone numbers were being misdialed as Indian numbers** in both Aircall
  and RCM. A bare 10-digit number starting with 6–9 was assumed to be
  Indian and dialed with a `+91` prefix instead of `+1`. Root-caused via a
  live DB audit: 3,420/3,421 real Indian leads already self-identify with an
  explicit `+91`, while the heuristic was actively misfiring on confirmed US
  leads (173 found in one query). Removed the guessing branch — all bare
  10-digit numbers now default to `+1`.

### Files Changed
- `backend/aircall_provider.py`, `backend/rcm_provider.py`
- Tests: `backend/tests/test_aircall_sync.py`, `backend/tests/test_rcm_provider.py`

### Verified on staging
Yes

### Rollback commit
`31ca9c6`

---

## v10.5.8 — 2026-07-22 (Prod hotfix: Analytics Hub negative call count, recording playback cutoff)
**Deploy:** `develop → staging` | **Type:** Bug Fix (regressions found live in production)
**Branches:** `develop`, `staging`

### Bug Fixes
- **Analytics Hub showed a negative "Calls Made" count for some batches**
  (e.g. "-31" for the Klenty CSV backfill batch). The dialer_calls/call_logs
  overlap de-dupe count was computed org-wide, unscoped by batch or pod, then
  subtracted from a single batch's much smaller, correctly-scoped totals —
  going negative once real overlap existed anywhere else in the org. Scoped
  the overlap query the same way its sibling queries already were.
- **Call recordings longer than 30 seconds stopped playing partway through**
  in Call Monitor. The 30-second auto-refresh timer rebuilds the whole table
  unconditionally, destroying any in-progress `<audio>` element. Auto-refresh
  now skips its tick while a recording is actively playing.

### Files Changed
- `backend/routes/analytics_routes.py`, `frontend/js/views/call_monitor.js`
- Tests: `backend/tests/test_analytics_bugfixes.py`

---

## v10.5.7 — 2026-07-22 (Klenty health check fixed, call transcripts wired up end-to-end)
**Deploy:** `develop → staging` | **Type:** Bug Fix + Feature completion
**Branches:** `develop`, `staging`

### Bug Fixes
- **Klenty integration health check failed with "Invalid user: whoami".**
  Klenty has no account-level self-check endpoint — every call is scoped to
  a real username. `test_connection()` now tests against the requesting
  admin's real Klenty username (falling back to their email), the same
  convention the nightly Klenty sync already uses per-SDR.
- **Call transcripts never appeared anywhere, even when RCM/Deepgram
  had already generated one.** Two compounding gaps: the backend never
  read the provider's transcription field back into `DialerCall.transcript`
  once Deepgram finished processing, and all three views that render
  transcripts (Call Monitor, Lead Calls tab, Activity Feed) each assumed a
  different, wrong shape for the data. Both fixed — transcripts now backfill
  automatically and render correctly everywhere, via one shared parser.
- **Transcript speaker labels showed raw "Speaker 0"/"Speaker 1".** Deepgram's
  diarization can't identify who is the SDR vs the lead (single mixed-audio
  file, no channel split) — relabeled to human-friendly 1-indexed "Speaker 1"
  / "Speaker 2" rather than guessing an identity we can't verify.

### Files Changed
- `backend/klenty_provider.py`, `backend/routes/call_routes.py`,
  `backend/routes/integration_health_routes.py`
- `frontend/js/utils.js`, `frontend/js/views/activity_feed.js`,
  `frontend/js/views/call_monitor.js`, `frontend/js/views/lead_calls_tab.js`
- Tests: `backend/tests/test_call_routes.py`, `backend/tests/test_klenty_provider.py`

---

## v10.5.6 — 2026-07-22 (Dialer hotfix: stuck call-lock + disappearing widget mid-call)
**Deploy:** `develop → staging` | **Type:** Bug Fix
**Branches:** `develop`, `staging`

### Bug Fixes
- **Dialer permanently stuck on "connecting call" until a hard refresh.**
  `handleCallAction()` awaited the RCM widget's mode-selection promise
  with no timeout and no error handling — if the widget panel ever failed to
  mount, the promise hung forever and silently blocked every future call
  attempt. Added a 45s timeout and a try/catch so this can no longer brick
  the call button.
- **Dialer widget disappeared mid-call (Browser Call mode).** LiveKit's
  `Disconnected` event was treated as an instant, final hangup, but it also
  fires on transient network blips LiveKit then recovers from on its own.
  Added a 4-second grace window before treating it as final, cancelled if
  `Reconnecting`/`Reconnected` fires in time.

### Files Changed
- `frontend/js/app.js`, `frontend/js/rcm_dialer.js`

---

## v10.5.5 — 2026-07-22 (Bug fixes: disqualify flow, AI research, Analytics Hub calls, dialer identity, call recordings)
**Deploy:** `develop → staging` | **Type:** Bug Fix (multiple, batched from SDR-reported issues)
**Branches:** `develop`, `staging`

### Bug Fixes
- **Disqualify blocked by a stale disposition.** After logging "Wrong Number"
  through the in-app dialer, the lead detail page still showed the previous
  disposition, and disqualify could be blocked demanding "5 call attempts"
  even on a confirmed wrong number. Root cause: dialer-logged outcomes are
  stored on `DialerCall`, not `CallLog` (to avoid duplicate rows), but both
  the lead-detail serializer and the disqualify-eligibility check only ever
  looked at `CallLog`. Both now check both tables for the true latest/
  definitive outcome.
- **AI Research panel showed a different contact's info.** Switching from
  one lead to another at the same company could show the previous contact's
  persona-specific research (their name, their "why they need us" pitch).
  The company-level research cache was being reused across different
  contacts for fields that are tailored to one specific person. Now
  invalidates and regenerates when the cached contact doesn't match.
- **Analytics Hub "Calls Made" ignored the batch filter.** Selecting a
  specific batch still showed org/pod-wide call totals — a sibling gap to
  the v10.5.3 batch-filter fix, in the same funnel query but a different
  metric. Now correctly scoped to the selected batch, same as every other
  KPI on the page.
- **Some SDRs' calls failed with "Agent phone number is required" (RCM).**
  Per-SDR RCM identity fields already existed in Admin → Users →
  Dialer Override, but were never actually read when placing a call — every
  SDR's calls authenticated as one shared global RCM agent. Now wired
  into the real call-placement path.
- **Call recordings: "Play" failed almost immediately, and Refresh-then-play
  would cut off mid-recording.** Both dialers affected. Root cause: provider
  recording links are short-lived signed URLs; the standalone Call Monitor
  view lacked the auto-retry-with-fresh-URL logic already used elsewhere in
  the app, and the shared retry only ever attempted once. Now retries up to
  3 times and resumes playback from where it stopped, across all call-log
  views. Also added a genuine "Download" option (not just "open in a new
  tab") to every recording view, and fixed a UI bug where the audio player
  rendered squeezed/clipped inside a narrow table cell in Call Monitor.
- **Klenty API key showed "Access denied" (Cloudflare error 1010) even with
  a valid key.** Cloudflare blocks the default Python `urllib` User-Agent
  outright — added a normal browser-style header.
- **Settings: saving inside any tab bounced back to the Connection tab.**
  The settings page always fully re-rendered on save, defaulting back to
  tab 1. Now preserves and restores whichever tab was active.
- **Active-call modal blurred the entire lead-detail page behind it.** SDRs
  couldn't glance at lead info while on a call. Removed the blur/dim for
  this modal only.

### Files Changed
- `backend/dialer_service.py`, `backend/klenty_provider.py`,
  `backend/routes/ai_research_routes.py`, `backend/routes/analytics_routes.py`,
  `backend/routes/call_routes.py`, `backend/routes/lead_helpers.py`
- `frontend/css/style.css`, `frontend/js/utils.js`,
  `frontend/js/views/activity_feed.js`, `frontend/js/views/call_monitor.js`,
  `frontend/js/views/lead_calls_tab.js`, `frontend/js/views/my_calls.js`,
  `frontend/js/views/settings.js`
- Tests: `backend/tests/test_ai_research_routes.py`,
  `backend/tests/test_analytics_bugfixes.py`, `backend/tests/test_call_routes.py`,
  `backend/tests/test_lead_routes.py`

---

## v10.5.3 — 2026-07-21 (Fix: Analytics Hub batch filter unreliable)
**Deploy:** `develop → staging` | **Type:** Bug Fix (data quality)
**Branches:** `develop`, `staging`

### Bug Fix
- **The Batch filter in Analytics Hub could return "No lead data" for a
  batch that clearly had leads**, and the Batch dropdown itself was
  unreliable — it wasn't scoped to the selected POD/date range at all.
  Reported via a screenshot: POD=US Team, Batch="Klenty Backfill Q2-2026" →
  every KPI showed 0.
- **Root cause 1 — the Batch dropdown was wired to the wrong endpoint.**
  It called the admin upload-history endpoint (`/admin/leads/upload-logs`),
  which ignores POD/date entirely and only returns the 10 most recent
  uploads org-wide — not the purpose-built, already-scoped
  `/analytics/filters` endpoint the frontend was already fetching (its
  batch list was just being thrown away). Fixed: the dropdown now uses
  `/analytics/filters`'s batch list.
- **Root cause 2 — batch-to-lead linkage relied on a fragile heuristic
  that a real fix had already made obsolete.** `Lead.upload_log_id` is a
  real, indexed foreign key — populated at upload time and backfilled for
  historical leads — but the analytics code still reconstructed the link
  by matching upload filenames against `lead_source` strings within a time
  window, a guess that was flat-out broken for plain CSV uploads and any
  batch created outside the standard upload flow (e.g. the Klenty
  backfill). Fixed: every analytics endpoint (`/funnel`, `/trend`,
  `/sdr-table`, `/email-breakdown`, `/filters`, `/batch-summary`, and Ask
  AI) now filters directly on `Lead.upload_log_id` — no guessing. Batches
  with zero linked leads no longer appear in the dropdown at all.
- Along the way, found and fixed two related gaps: the Activity Trend
  chart's Calls series ignored the batch filter entirely (while every
  other series respected it), and the funnel's Won/Lost opportunity counts
  ignored both the source and batch filters.

### Files Changed
- `backend/routes/analytics_routes.py`, `backend/services/smart_analytics.py`,
  `frontend-react/src/pages/Analytics/DashboardTab.jsx`
- Tests: `backend/tests/test_analytics_bugfixes.py`,
  `backend/tests/test_analytics_routes.py`

---

## v10.5.2 — 2026-07-20 (Fix: duplicate Salesforce Lead records)
**Deploy:** `develop → staging` | **Type:** Bug Fix (data quality, critical)
**Branches:** `develop`, `staging`

### Bug Fix
- **The same contact could get pushed to Salesforce as a brand-new Lead on
  every single sync**, forever. Reported via a screenshot showing 5 separate
  Salesforce Lead records for one contact, spanning 7/1–7/20/2026. Confirmed
  live against prod: the actual local lead's Salesforce link was never
  persisted — 16 separate successful "create" calls were logged for this one
  contact since 2026-05-21, and 100 of 118 leads currently at "Meeting
  Scheduled" have never gotten a real Salesforce ID saved back locally.
- **Root cause 1 — batch commit swallowed successful write-backs:**
  `push_pending_leads_to_salesforce()` processed every pending lead in one
  loop but only called `db.commit()` once at the very end. If ANY lead in
  that batch hit the unique constraint on `sf_lead_id` (two local leads
  sharing an email both resolving to the same existing Salesforce Lead),
  the resulting `IntegrityError` silently rolled back *every* lead's
  successful write-back from that run — while their Salesforce creates had
  already happened remotely and couldn't be undone. Every subsequent sync
  saw the same leads as "never synced" and recreated them. Fixed: each
  lead's write-back now commits individually, so one bad lead only affects
  itself.
- **Root cause 2 — no dedup on manual lead creation:** `POST /leads` (the
  "New Lead" button) had zero duplicate detection, unlike the CSV/Google
  Sheet import paths (which already check Email → LinkedIn → Phone →
  Name+Company). This let the same contact get re-added by hand, each one
  feeding root cause 1. Fixed: `POST /leads` now runs the same dedup check
  and returns a clear error naming the existing lead instead of creating a
  duplicate.
- Verified every other path that creates a local lead (CSV, Google Sheet,
  the Klenty sync shipped earlier today, the Salesforce pull direction, the
  staging-only synthetic data generator) already has adequate duplicate
  protection — this was the one real gap.

### Files Changed
- `backend/salesforce.py`, `backend/routes/_admin_helpers.py` (new
  `_find_duplicate_lead`), `backend/routes/lead_routes.py`,
  `backend/tests/test_salesforce_client.py` (new
  `TestPushPendingLeadsToSalesforce`, 3 tests),
  `backend/tests/test_lead_routes.py` (4 new dedup tests)

### Migration Notes
- Code-only fix, no schema change.
- **Not included in this deploy:** the ~11 duplicate-email local-lead pairs
  already in prod (and their resulting Salesforce duplicates) are not
  cleaned up automatically — that was an explicit scope decision to stop
  new duplicates first. Those pairs will keep surfacing as isolated,
  non-cascading sync errors until manually merged.
- **Flagged, not fixed:** `sync_leads_from_salesforce` (the pull direction)
  has the same single-batch-commit shape. Currently dormant — this org
  runs `sync_direction=push_only` — but the same class of bug would apply
  if 2-way sync is ever enabled.

### Verified on staging
Full backend suite green (1789 passed) before merge. Root cause confirmed
against live production data (`salesforce_integration_logs`, direct lead
queries) before writing the fix, not just from code reading. `ponytail-review`
+ `ponytail-audit` run on the diff and touched files.

### Rollback
Code-only change, no migration — revert the merge commit on `staging` if
needed.

## v10.5.1 — 2026-07-20 (Salesforce auto-sync schedule)
**Deploy:** `develop → staging` | **Type:** Feature
**Branches:** `develop`, `staging`

### Feature
- **Salesforce sync can now run automatically every day**, in addition to the
  existing manual "Sync Salesforce" button. A new "Auto-Sync Schedule" toggle
  in Settings → Sync Settings lets an admin pick a daily UTC time; the sync
  then runs on its own (same pull(if 2-way)+push logic as the manual button,
  respecting all existing Sync Settings — record types, lead limit, push
  stage, etc.) without anyone needing to click the button.
- Manual sync stays exactly as-is — this is additive, not a replacement.
- The scheduler checks every 15 minutes whether today's configured time has
  passed and whether it already ran today; a missed check (e.g. a server
  restart right at the scheduled minute) self-heals on the next check within
  the same day, no separate catch-up thread needed.
- Time is entered in UTC (the app has no timezone concept anywhere else
  either, so this stays consistent with the rest of the system).

### Files Changed
- `backend/models.py`, `backend/migrations.py`, `backend/salesforce.py`
  (new shared `run_full_salesforce_sync`, extracted from the manual sync
  route so both paths behave identically), `backend/routes/admin_sync_routes.py`,
  `backend/scheduled_jobs.py`, `frontend/js/views/settings.js`,
  `frontend/js/views/settings_sync.js`, `backend/tests/test_scheduled_jobs.py`
  (new `TestSalesforceAutoSync`, 7 tests)

### Migration Notes
- Additive only: `sync_settings.sf_auto_sync_enabled/hour_utc/minute_utc/last_run_at`
  — all nullable/defaulted, applied automatically via `migrations.py`. Feature
  stays off (disabled) for everyone until an admin explicitly turns it on.

### Verified on staging
Full backend suite green (1782 passed) before merge. `ponytail-review` +
`ponytail-audit` run on the diff and touched files — no findings beyond one
trivial test-helper inline (applied).

### Rollback
Flip the toggle off in Settings (zero-code, next check no-ops), or revert the
merge commit — no destructive schema change either way.

## v10.5.0 — 2026-07-17 (Klenty call-activity sync — admin-configurable, temporary bridge)
**Deploy:** `develop → staging` | **Type:** Feature
**Branches:** `develop`, `staging`

### Feature
- **Klenty call history now pulls into RCM automatically.** SDRs place
  calls through Klenty (using an Aircall-owned number) that never reach
  Aircall's own call log or RCM — until now these calls were invisible
  to reporting entirely. A new nightly per-SDR sync job pulls each rep's last
  3 days of Klenty call activity via Klenty's REST API, records it as a
  `DialerCall` (`provider="klenty"`, `source="klenty_sync"`), and matches it
  to an existing lead by phone or email — auto-creating a new lead (assigned
  to the calling SDR) when no match is found, same behavior as the one-time
  historical backfill done earlier this session.
- **Admin-only Settings toggle:** Settings → Dialer now has a "Klenty Sync"
  card (enable/disable + API key) — no SDR-facing UI, this is purely an
  infra-level switch for admins.
- This is an explicitly **temporary bridge**, built fully isolated from the
  existing `DialerProvider` routing (Klenty is never selectable as the active
  dialer — it can't place outbound calls) so it can be cleanly removed once
  SDRs move fully onto RCM's own calling.
- **Does not affect Connect Rate** — Klenty calls are recorded with
  `outcome=NULL` and deliberately excluded from the `CONNECT_OUTCOMES`
  aggregation fixed in v10.4.8.

### Files Changed
- `backend/klenty_provider.py` (new), `backend/scheduled_jobs.py`,
  `backend/models.py`, `backend/migrations.py`, `backend/dialer_service.py`,
  `frontend-react/src/pages/Settings/SettingsDialer.jsx`,
  `backend/tests/test_klenty_provider.py` (new),
  `backend/tests/test_scheduled_jobs.py`

### Migration Notes
- Additive only: `sync_settings.klenty_enabled/klenty_api_key/klenty_last_sync_at`,
  `users.klenty_username` — all nullable/defaulted, applied automatically via
  `migrations.py` on next deploy. No backfill required.
- Feature stays fully inert until an admin enables it and supplies a Klenty
  API key in Settings — no behavior change for any existing user until then.

### Verified on staging
Full backend suite green (1775 passed, 4 skipped, 7 xfailed) on `develop`
before merge. `ponytail-review`/`ponytail-audit` run on the diff. Manual
verification against Klenty's live API still pending a real API key.

### Rollback
Flip `klenty_enabled` off in Settings (zero-code, next nightly run no-ops),
or revert the merge commit — no destructive schema change either way.

## v10.4.9 — 2026-07-17 (Calendar: meeting date/time now captured correctly)
**Deploy:** `staging → main` | **Type:** Bug Fix
**Branches:** `staging`, `main`

### Bug Fix
- **The Calendar was showing meetings on the day they were logged, not the
  actual scheduled meeting time** — and, more urgently, **any meeting
  confirmed since 2026-07-14 was invisible on the Calendar entirely.**
  Root cause: the frontend sends the SDR's chosen meeting time via JS's
  `Date.toISOString()`, which always ends in `"Z"`. `datetime.fromisoformat()`
  can't parse a trailing `"Z"` before Python 3.11 (prod runs 3.10), so this
  has always raised, been silently caught, and never actually written
  `meeting_scheduled_at`. Every meeting currently on the Calendar was dated
  by a one-time 2026-07-14 backfill that substituted `status_changed_at` as
  a stand-in — the exact "shows the day it was created" symptom reported.
  Same fix already shipped on the read side (`/leads/meetings`,
  RCA-2026-07-14) now applied to the write path in `call_routes.py`. New
  regression test uses the real `toISOString()` format the frontend sends
  (the existing test used an already-Python-parseable format and never
  caught this).

### Files Changed
- `backend/routes/call_routes.py`, `backend/tests/test_call_routes.py`

### Migration Notes
- None — code-only fix, no schema change. A small number of leads confirmed
  between 2026-07-14 and this deploy have `meeting_scheduled_at = NULL` and
  will need a manual one-time backfill (using `status_changed_at` as an
  approximation, same as the prior migration) to reappear on the Calendar —
  tracked separately, not included in this deploy.

### Verified on staging
Merged `develop → staging`, full backend suite green (1757 passed) before
and after merge, `/api/health/deep` confirmed healthy after redeploy.

### Rollback
Code-only change, no migration — revert the merge commit on `main`
(`git revert -m 1 <merge-sha> --no-edit && git push origin main`) if needed.

## v10.4.8 — 2026-07-17 (Analytics reliability fixes — Connect Rate, CSV export, Ask AI)
**Deploy:** `staging → main` | **Type:** Bug Fix
**Branches:** `staging`, `main`

### Bug Fix
- **Connect Rate showed 0% everywhere** (Funnel, SDR Table, CSV export, Batch
  Summary). Root cause: several queries checked `DialerCall.status ==
  'CALL_ANSWERED'` — a status value nothing in the system ever writes, since
  real completed calls always end up `CALL_ENDED` regardless of whether they
  connected (`CALL_ANSWERED` is only ever a transient in-progress marker).
  Switched every occurrence to the already-correct pattern used elsewhere in
  the same file: `outcome IN CONNECT_OUTCOMES`.
- **CSV export (`/api/admin/analytics/export`) ignored `dialer_calls`
  entirely** — it only queried the legacy manual `call_logs` table, so
  exported "Calls Made"/"Calls Connected" were undercounted by roughly
  90%+ versus the dashboard for the same SDR/period. It also divided by
  `calls_with_outcome` instead of total calls made (the same denominator
  bug fixed in the SDR table back in BUG-ANALYTICS-1, never ported to
  Export). Fixed by extracting one shared aggregate builder
  (`_compute_sdr_rows`) used by both `/sdr-table` and `/export`, so they
  can no longer drift apart.
- **`lead_source` filter was a silent no-op on `/sdr-table`** (accepted as a
  parameter, baked into the cache key, never applied to any query), and
  **only partially applied on `/trend`** (Emails series only, not
  Calls/Meetings/Research/Disqualified). Now applied consistently.
- **`/batch-summary`** ("All Batches" view) had the same `call_logs`-only
  gap and wrong-denominator bug, plus a "Total" row `connect_rate`
  hardcoded to `None` with a comment claiming it would be "recalculated
  below" — that recalculation was never implemented. Now includes
  `dialer_calls`, uses the correct denominator, and computes a real
  weighted total.
- **`smart_analytics.py` ("Ask AI")** used the same wrong `calls_with_outcome`
  denominator in two places, causing it to disagree with the SDR table for
  the same pod/period. Now matches.
- **`growth_intelligence_routes.py`** checked call outcomes against
  `["connected", "meeting_booked", "interested", "callback"]` — values that
  don't exist anywhere in real data (actual outcomes are Title Case, e.g.
  "Call Back Later", "Meeting Scheduled") — so this connect rate was always
  0%. It also only read `call_logs`, missing all dialer calls. Fixed to use
  `CONNECT_OUTCOMES` and include `dialer_calls`.

### Files Changed
- `backend/routes/analytics_routes.py`, `backend/routes/growth_intelligence_routes.py`,
  `backend/services/smart_analytics.py`
- `backend/tests/conftest.py`, `backend/tests/test_analytics_audit.py`,
  `backend/tests/test_analytics_routes.py`

### Migration Notes
- None — query-logic only, no schema changes, no data migration.

### Verified on staging
Merged `develop → staging`, full backend suite green (1756 passed, 4 skipped,
7 xfailed) both before and after merge, `/api/health/deep` confirmed
`db_tables_accessible: true`, authenticated staging endpoint check passed via
`pre-deploy-check.sh`.

### Rollback
Query-logic-only change with no migration — if needed, revert the merge commit
on `main` (`git revert -m 1 <merge-sha> --no-edit && git push origin main`) and
redeploy. No DB rollback required.

## v10.4.7 — 2026-07-16 (Leads Hub redesign + RCM recording-url fix)
**Deploy:** `staging → main` | **Type:** New Feature (opt-in) + Bug Fix
**Branches:** `staging`, `main`

### Bug Fix
- **RCM call recordings were unavailable for every SDR on that provider.**
  Root cause: RCM's `/calls/{id}/status` endpoint began returning `HTTP 500`
  ("Request object not found for payload validation") for effectively every call
  starting ~08:09 UTC on 2026-07-16 (confirmed live via Render logs — 30+ distinct
  call IDs over 4+ hours). `fetch_call()` wrapped that call and the independent
  `get_recording_url()` call in a single `try`/`except`, so the `/status` failure
  silently aborted the whole function before the recording URL was ever fetched —
  killing every recording regardless of whether the recording endpoint itself was
  healthy. Reported by Damini Kumari and Tanya Batra; reproduced against a real
  prod call (Tanya Batra / PRIMEGEN Healthcare Laboratories, `provider_call_id=1500`).
- `/status` failures are now caught independently and degrade to `status="unknown"`
  instead of aborting, so `get_recording_url()` and the paginated duration/`ended_at`
  fallback still run. New regression tests cover both the partial-failure and
  total-failure paths.

### New Feature (opt-in, beta)
- **Leads Hub — React redesign of the All Leads module.** A from-scratch rebuild
  (real component/hook composition, not a port of the legacy page) covering every
  legacy filter plus new capabilities: multi-select status/tag filters, saved views,
  bulk and single-lead reassignment, inline status/assignee/priority editing, a
  latest-note preview per row, per-upload-batch filtering, and an in-UI Disqualify
  Requests panel (maker/checker). New backend: `Tag`/`lead_tags` tables, `tag_routes.py`
  endpoints, `Lead.upload_log_id` column with a one-time backfill migration, and a
  multi-status filter on `GET /api/leads`. Ships fully behind a `localStorage`
  (`leadsBeta`) opt-in toggle — zero behavior change for existing users until they
  click "Try it (Beta)" on the legacy Leads page.

### Files Changed
- `backend/rcm_provider.py`, `backend/tests/test_rcm_provider.py`
- `backend/models.py`, `backend/migrations.py`, `backend/routes/{lead_routes,lead_helpers,
  admin_upload_routes,tag_routes}.py`, `backend/tests/{conftest,test_leads_redesign}.py`
- `frontend-react/src/features/leads-hub/**` (new), `frontend-react/src/leads-entry.jsx`,
  `frontend-react/vite.config.leads.js`, `frontend-react/src/services/api.js`
- `frontend/index.html`, `frontend/js/app.js`, `frontend/js/views/lead_list.js`,
  `frontend/js/leads-hub.{js,css}` (built artifacts)

### Migration Notes
- New tables/column are additive and nullable (`CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`) — no destructive changes.
- `_backfill_lead_upload_log_ids` is a one-time, Python-side timestamp-proximity
  match (tracked in `_applied_migrations`, runs exactly once). Assessed as safe at
  prod's ~13k lead scale before promotion.
- A one-time, non-fatal Postgres `pg_type_typname_nsp_index` duplicate-key warning
  is expected on the *first* boot with the new `tags`/`lead_tags` tables if the app
  starts with more than one worker (implicit row-type creation race) — self-resolves,
  won't recur on subsequent deploys since the tables then already exist.

### Verified on staging
Merged `develop → staging`, full backend suite green (1756 passed), frontend suite
green (55 passed), `/api/health/deep` confirmed `db_tables_accessible: true`,
authenticated Public API calls exercised against real staging/prod data (lead
search + call history) before and after promotion.

### Rollback
```
git revert -m 1 4d391e1 --no-edit
git push origin main
```
Non-destructive — no DB rollback needed, all schema changes are additive.

---

## v10.4.6 — 2026-07-16 (RCM Manual Dial: fix duplicate call UI / stale answered state)
**Deploy:** `develop → staging` | **Type:** Bug fix
**Branches:** `develop`, `staging`

### Bug fix
- **Manual Dial for RCM users showed two overlapping call widgets and could fail
  to reflect "call answered" state.** Root cause: `showManualDialWidget()` routed
  RCM calls through the legacy, Aircall-only `DialerMachine`/`showDialerWidget()`
  path (which renders its own `#dialer-widget` DOM and relies on a CSS class to hide it),
  instead of `RCMDialer` — the purpose-built, already-live-verified call manager
  already used for the normal lead "Call" button. Reproduced live on prod via an
  impersonation test (2026-07-15): two dialer UIs appeared, and picking up the call did
  not update the UI.
- Fixed `showManualDialWidget()` to call `window.RCMDialer.activate()` for
  RCM calls (same as `handleCallAction()` in `app.js`), and fixed its duplicate-call
  guard to check `RCMDialer.isActive()` for RCM instead of the Aircall-only
  `isWidgetActive()`.
- Removed a dead `_machine` (`window.DialerMachine`) fallback shim in
  `rcm_widget.js` left over from the same legacy coupling — confirmed unused
  anywhere in the file.
- **Aircall calling is unaffected** — its code path (`isWidgetActive()`/`showDialerWidget()`)
  is untouched; only the RCM branches were rewired.

### Files Changed
- `frontend/js/views/dialer_widget.js` — Manual Dial RCM routing + guard fix
- `frontend/js/rcm_widget.js` — removed dead `_machine` shim
- `tests/specs/manual-dial-rcm-routing.check.js` — new static regression check
  (`node tests/specs/manual-dial-rcm-routing.check.js`)

### Migration Notes
None — frontend-only, no schema/env changes.

### Verified on staging
Pending — awaiting user re-test of the same impersonation scenario on staging.

### Rollback commit
See `git log` for the commit immediately prior to this entry on `develop`.

---

## v10.4.5 — 2026-07-15 (RCM real-time call events + MCP UI docs)
**Deploy:** `develop → staging` | **Type:** Improvement + Docs
**Branches:** `develop`, `staging`

### Improvements
- **RCM calls now push real-time events instead of relying on polling** —
  `webhook_url` is forwarded in the `/calls/initiate` payload (when a webhook endpoint is
  configured), so RCM pushes call-started/answered/ended events to our existing
  `/api/webhooks/rcm` handler as they happen. This exact field was attempted twice
  before (2026-07-09, 2026-07-10) and both times the vendor's claim that it had shipped
  turned out to be wrong — a live call got a `422 Unknown field` both times. This time it
  was verified with an actual live call on staging (real `200`, `call_id` returned, test
  phone rang) before being kept enabled. See `docs/AGENT_PROTOCOL.md` §18 case study.
- **RCM MCP server setup instructions** now shown in-app under Admin Settings →
  Public API tab, alongside the existing Salesforce bridge docs.

### Files Changed
- `backend/rcm_provider.py` — `webhook_url` added to `/calls/initiate` payload
- `backend/tests/test_rcm_provider.py` — updated regression test
- `frontend/js/views/settings.js` — MCP server setup card in Public API tab
- `docs/AGENT_PROTOCOL.md` — Rule 18 case study

### Breaking Changes
None — `webhook_url` is only sent when a webhook endpoint is already configured;
zero behavior change otherwise.

☑ docs/RELEASES.md updated
☑ frontend/js/views/user_guide.js What's New section updated — N/A, backend-only
  change with no SDR/Admin-visible workflow change (call outcomes/notes still work
  identically; only the underlying event delivery mechanism changed)

---

## v10.4.4 — 2026-07-15 (Call recording playback fix + log retention + MCP server)
**Deploy:** `develop → staging` | **Type:** Bug Fix + Backend Hardening + New Internal Tool
**Branches:** `develop`, `staging`

### Bug Fixes
- **Call recordings no longer go dead mid-session** — every playback surface (lead Calls
  tab, My Calls, Activity Feed, the Calls page) now re-fetches a fresh signed recording
  URL on playback failure instead of only ever playing whatever URL was cached when the
  page loaded. Previously only the admin Call Monitor view did this; everywhere else, a
  provider's pre-signed URL expiring while a page just sat open meant the recording
  silently stopped playing with no recovery.

### Improvements (backend, not user-facing)
- **Log table retention** — `LeadUploadLog`, `SalesforceIntegrationLog`, `LoginLog`, and
  `AnalyticsQueryHistory` now get pruned on the same nightly schedule as the existing
  `UserActivityLog`/`ErrorLog` cleanup (configurable via env vars, defaults 90–180 days).
  `DialerCall` rows are never deleted (they're lead history) — only their heavy
  `raw_payload`/`transcript` debug columns get trimmed past 180 days.

### New Features
- **RCM MCP server** (`mcp_server/`) — read-only lead/call data access for internal
  non-engineering teams via Claude, so they don't have to ask engineering for one-off data
  pulls. Two tools: `search_leads`, `get_lead_calls`. Backed by two new
  `X-API-Key`-authenticated endpoints (`/api/public/leads/search`,
  `/api/public/leads/{id}/calls`) — reuses existing query logic, no new auth mechanism.
  Not part of the app's UI; see `mcp_server/README.md` for setup.

### Files Changed
- `frontend/js/utils.js`, `frontend/js/views/{activity_feed,lead_calls_tab,my_calls,call_monitor}.js`
- `frontend-react/src/hooks/useRecordingRetry.js` (new), `frontend-react/src/pages/Calls/Calls.jsx`,
  `frontend-react/src/components/leads/tabs/CallsTab.jsx`, `frontend-react/src/services/api.js`
- `backend/routes/activity_feed_routes.py` (added `id` to call entries)
- `backend/scheduled_jobs.py` — new retention cleanup jobs
- `backend/routes/public_api_routes.py` — new `/leads/search`, `/leads/{id}/calls` endpoints
- `mcp_server/` (new) — `rcm_mcp.py`, `README.md`, `requirements.txt`, `test_rcm_mcp.py`

### Breaking Changes
None.

☑ docs/RELEASES.md updated
☑ frontend/js/views/user_guide.js What's New section updated

---

## v10.4.3 — 2026-07-14 (Account Disqualify: frontend UI)
**Deploy:** `develop → staging` | **Type:** New Feature (completes v10.4.0's backend-only Disqualify feature)
**Branches:** `develop`

### New Features
- **Disqualify request UI (maker step)** — a "🚫 Disqualify Account" button now appears on each
  company group header in the Leads view (SDR/AE only), opening a modal that collects a reason
  (min 10 chars) and submits via the existing `POST /api/disqualify-requests` endpoint. The
  backend for this shipped in v10.4.0 but had no UI to trigger it until now.
- **Disqualify Requests screen (checker step)** — new nav item (Pod Admin / Super Admin only)
  listing pending requests with company, lead count, reason, requester, and Approve/Reject
  actions. Reject expands an inline reason field. Both actions call the existing, already-tested
  `/api/disqualify-requests/{id}/approve` and `/reject` endpoints — no backend changes.

### Files Changed
- `frontend/js/api.js` — `createDisqualifyRequest`, `fetchDisqualifyRequests`,
  `approveDisqualifyRequest`, `rejectDisqualifyRequest`
- `frontend/js/views/modals.js` — `openDisqualifyModal` + wiring
- `frontend/js/views/lead_list.js` — company-group header button
- `frontend/js/views/disqualify_requests.js` (new) — checker screen
- `frontend/js/app.js` — `disqualify-requests` route (Pod Admin+ gated)
- `frontend-react/src/layout/NavSidebar.jsx` — new nav item
- `frontend/index.html` — new modal markup, nav-hub cache-bust bump `20260714a`

☑ docs/RELEASES.md updated
☑ frontend/js/views/user_guide.js What's New section updated

---

## v10.4.2 — 2026-07-14 (Calendar: visual polish, live clock, detail panel)
**Deploy:** `develop → staging` | **Type:** Improvement
**Branches:** `develop`

### Improvements
- **Fixed invisible grid borders** — root cause: `calendar-tailwind.css` intentionally
  omits `@tailwind base` (to avoid leaking resets into the vanilla shell), which also
  drops Preflight's global border reset. Preflight actually does two things:
  `border-width: 0` (nothing has a border by default) AND `border-style: solid` (so a
  utility that adds a width renders as a visible line, not the browser default `none`).
  A first attempt only restored the `border-style` half, which exposed browser-default
  border-widths on buttons/badges as ugly black boxes. Fixed by mirroring Preflight's
  exact rule (`border-width: 0; border-style: solid; border-color: currentColor;`),
  scoped to `.calhub *`, placed *before* `@tailwind utilities` in source so real
  utility classes (`border-r`, `border-slate-200`, etc.) still win the cascade.
- **Live clock + timezone** in the header (`useNowClock`, native `Intl.DateTimeFormat`,
  updates once a minute).
- **Clicking a meeting no longer navigates away immediately** — opens a right-docked
  detail panel (lead name, company, phone, time) matching the existing
  `components/ui/Modal.jsx` visual language, with an explicit "Go to lead" action.
  Calendar range/cursor/scroll position is preserved until the user opts in to leave.
- **Detail panel now shows recent call history** (up to 5 most recent calls: outcome,
  rep name, date, notes) — reuses the existing `GET /leads/{lead_id}/calls` endpoint
  (same merged manual + dialer call log already powering the lead detail page's Calls
  tab), no new backend endpoint needed.
- General visual pass: shared `.calhub-card` surface token (white / slate-200 border /
  rounded-2xl / shadow-sm) applied consistently across header, grid, and list.

### Files Changed
- `frontend-react/src/pages/Calendar/CalendarHub.jsx`
- `frontend-react/src/calendar-tailwind.css`
- `frontend/index.html` (calendar-hub cache-bust bump `20260714d`)

☑ docs/RELEASES.md updated
☑ frontend/js/views/user_guide.js What's New section updated

---

## v10.4.1 — 2026-07-14 (Calendar: Day/Week/Month/List views + lead navigation)
**Deploy:** `develop → staging` | **Type:** Improvement
**Branches:** `develop`

### Improvements
- **Calendar now has Day/Week/Month views plus a List toggle** — the v10.4.0
  Calendar was month-grid-only. Added a Day ("Today")/Week/Month segmented
  control and a List display toggle that groups meetings by date, reusing the
  existing month grid for Month, a single-row grid for Week, and a shared
  `MeetingRow`/`MeetingList` for List and Day.
- **Meetings are now clickable** — every meeting (grid chip, week chip, list
  row) navigates to that lead's detail page, mirroring the existing
  `onLeadClick` pattern already used by the Dashboard Hub.
- Scoping is unchanged: `/api/meetings` role/pod-scoping (Super Admin: all,
  Pod Admin: own pod unless "All pods", SDR/AE: own assigned leads) applies
  identically across all four views — no backend changes required.

### Files Changed
- `frontend-react/src/pages/Calendar/CalendarHub.jsx`
- `frontend/js/app.js` (added `onLeadClick` to Calendar mount props)
- `frontend/index.html` (calendar-hub cache-bust bump `20260714a`)

☑ docs/RELEASES.md updated
☑ frontend/js/views/user_guide.js What's New section updated

---

## v10.4.0 — 2026-07-13 (Bell Notification Fix + Unified Calendar + Account Disqualify)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix / New Feature
**Branches:** `develop`

### Bug Fixes
- **Bell notifications broken for every SDR/AE since 2026-06-18** — the vanilla-JS
  notification bell (`task_notifications.js`) injected itself into `.topbar-actions`,
  which the NavHub React topbar migration removed from the DOM that day. The bell
  kept polling in the background and finding nowhere to render, silently, for
  every user — not just the one who reported it. Rebuilt as a real component in
  `NavTopbar.jsx` (the actual live topbar), wired to the existing
  `/my/tasks/pending` API. Also fixed silent error-swallowing in both frontends
  (`fetchPendingTasks` now surfaces failures instead of returning `[]`), so a
  future auth/DB hiccup is visible instead of looking identical to "no tasks."
- **Analytics custom date range silently ignored** — `_resolve_date_range_simple`
  checked `preset` before `date_from`/`date_to`, so any Custom range picked in
  the UI fell back to the last 30 days whenever the frontend omitted `preset`
  (several endpoints default it to `"30d"` via FastAPI `Query()`). Reordered so
  explicit dates always win — fixes all 6 endpoints that share this resolver.

### New Features
- **Account Disqualify (maker-checker)** — AEs/SDRs can request bulk-disqualifying
  every lead under an account that isn't the right ICP fit; a Pod Admin (or
  above) reviews and approves/rejects before anything actually changes. Guards
  against concurrent double-approval and validates every lead in the request
  actually belongs to the stated company. New `disqualify_requests` table.
- **Unified Calendar** — a new Calendar page (sidebar, all roles) shows every
  scheduled meeting on one month grid: SDR/AE see their own, Pod Admin their
  pod (with an "All pods" toggle), Super Admin everyone. Backed by a new
  `Lead.meeting_scheduled_at` field — previously the SDR-entered meeting
  date/time was only ever embedded as prose inside call notes, never stored
  structurally, so no calendar view was possible. The existing call-outcome
  modal now sends it as a real field in addition to the notes prefix.

### Files Changed
- `frontend-react/src/layout/NavTopbar.jsx` — new NotificationBell component
- `frontend/js/api.js`, `frontend/js/app.js` — bridge exposure, error surfacing, view routing
- `frontend/js/views/task_notifications.js` — deleted (dead since 2026-06-18)
- `backend/routes/analytics_routes.py` — `_resolve_date_range_simple` reorder
- `backend/models.py` — `DisqualifyRequest`, `Lead.meeting_scheduled_at`
- `backend/migrations.py` — new table + column
- `backend/routes/disqualify_routes.py` — new
- `backend/routes/call_routes.py` — captures `meeting_datetime`
- `backend/routes/lead_routes.py` — new `GET /api/meetings`
- `frontend-react/src/pages/Calendar/CalendarHub.jsx`, `calendar-entry.jsx`,
  `vite.config.calendar.js` — new React Calendar page (IIFE bundle, same
  pattern as Analytics/Dashboard/Nav hubs)
- `frontend-react/src/layout/NavSidebar.jsx` — Calendar nav item
- `frontend/js/views/modals.js` — sends `meeting_datetime` alongside notes

☑ docs/RELEASES.md updated
☑ frontend/js/views/user_guide.js — "What's New" entry added (v10.4.0)

## v10.3.1 — 2026-07-11 (Dialer Webhook Fix + Pod Admin Migration Hardening)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix / Migration Hardening
**Branches:** `develop`

### Bug Fixes
- **Dialer webhook misrouting (RCA 2026-07-10)** — the shared `/api/webhooks/dialer`
  endpoint used a single global `dialer_provider` setting to decide how to parse
  every incoming webhook. Any RCM webhook was silently misrouted to
  Aircall's parser whenever that setting was "aircall" (and vice versa), so
  RCM calls had no real-time status confirmation and relied solely on the
  reactive 50-second Guard2 timeout. Fixed by identifying the provider from
  payload shape instead (Aircall always sends `{"event":..., "data":...}`,
  RCM never does). Same fix applied to the equivalent (currently unused)
  code path in `backend-react/routes/dialer.py`.
- **Missing cache invalidation on Pod Admin role changes** — adding/removing a
  Pod Admin correctly updated the database immediately but the Users list cache
  didn't reflect it for up to 30 seconds. Found live during staging verification.

### Migration Hardening (v10.3.0's Pod Admin migration, not yet in production)
Live staging verification and a pre-flight check against real production data
(4 pods with `admin_id` set, 3 Pod Admin users, 5,117 `lead_assignments` rows)
surfaced 3 risks in the original migration, all fixed before this reaches prod:
- `DROP COLUMN pods.admin_id` (originally Step 4) is deliberately **removed from
  the automatic migration path** — it will ship as a separate, deliberate
  follow-up deploy once the backfill is confirmed correct in production. Nothing
  in this release touches or drops `pods.admin_id`.
- `column_additions` was unconditionally re-adding `pods.admin_id` on every boot
  if missing, which would have silently undone any future drop the moment it
  happened. Removed that entry.
- The destructive `DELETE FROM lead_assignments` (Step 3) now only runs if the
  `pod_admins` backfill has verifiably covered every pod with `admin_id` set —
  previously the two steps were independent with no dependency between them.
  Row count is now logged before the delete runs.
- Added `test_v10_pod_admin_migration.py` — exercises the actual migration SQL
  (`run_schema_migrations`) against a simulated legacy schema, not just
  `Base.metadata.create_all()` (which is all the existing test suite ever did).

### Data Fix (production, applied directly — not part of this deploy)
- One pre-existing pod (`APAC`) had its `admin_id` pointing to a user whose role
  was `AE`, not `Pod Admin` — a data inconsistency from before this migration
  existed. Confirmed with the team this user should genuinely be Pod Admin;
  synced `users.role` and `allowed_users.role` (the source of truth resynced on
  every login) to `Pod Admin` directly in the production DB.

### Files Changed
- `backend/routes/dialer_routes.py` — payload-shape webhook routing
- `backend/dialer_service.py` — notify_url points at dedicated RCM webhook endpoint
- `backend-react/routes/dialer.py` — same routing fix applied
- `backend/migrations.py` — deferred column drop, gated destructive delete, row-count logging
- `backend/routes/pod_routes.py` — cache invalidation on role change, dead legacy response fields removed
- `backend/tests/test_v10_pod_admin_migration.py` — new: exercises real migration SQL
- `backend/tests/test_dialer_routes.py`, `test_pod_routes.py` — updated/added coverage

☑ docs/RELEASES.md updated
☑ frontend/js/views/user_guide.js — not updated; this release is internal hardening
  and a bug fix with no new user-facing behavior (v10.3.0's original feature
  entry below already covers the Pod Admin UI)

---

## v10.3.0 — 2026-07-08 (Pod Admin Multi-Admin + Account-Level Connect %)
**Deploy:** `develop → staging → main` | **Type:** Feature / DB Migration  
**Branches:** `develop`

### New Features
- **Pod Admin: Multi-Admin support** — A pod can now have multiple Pod Admins.
  Replaced the single `pods.admin_id` FK with a new `pod_admins` junction table
  (pod_id, user_id, assigned_at, assigned_by). Super Admins can add and remove
  Pod Admins via the new `POST/DELETE /api/pods/{id}/admins` endpoints and the
  updated Pods UI (👤 Pod Admins section with per-admin remove buttons).
- **AE Cascade removed** — Pod Admins no longer appear in `lead_assignments`.
  They see AE leads via pod scoping (lead_helpers.py), not duplicate assignments.
  Existing cascade rows cleaned up by `v10_clean_lead_assignments_pod_admins` migration.
- **Analytics: Account-level Connect %** — New `Acct Connect %` column in the
  SDR Performance table. Counts distinct companies (LOWER-normalised) reached and
  connected, so one connection at a 3-lead account counts as "1 connected account".
  Both Aircall (dialer_calls) and manual/RCM (call_logs) calls are included.

### DB Migrations (run automatically on startup)
1. `CREATE TABLE pod_admins` — multi-admin junction table with unique constraint
2. `v10_backfill_pod_admins_from_admin_id` — backfills existing pods.admin_id → pod_admins
3. `v10_clean_lead_assignments_pod_admins` — removes Pod Admin rows from lead_assignments
   (gated on the backfill above actually covering every pod — see v10.3.1 below)
4. ~~`v10_drop_pods_admin_id`~~ — **deferred, see v10.3.1**: does NOT run automatically.
   `pods.admin_id` intentionally stays in the schema until dropped in a separate,
   deliberate follow-up deploy.

### Breaking Changes
- `pods.admin_id` column: **not** removed from DB in this release — deferred, see v10.3.1
- `GET /api/pods` response: `admin_id`/`admin_name`/`admin_email` legacy fields
  **removed** (as of v10.3.1 — confirmed zero frontend usage before removal);
  `admins: []` list is now the only way to read pod admin data
- AE cascade-assign removed: Pod Admins should no longer be in lead_assignments

### Files Changed
- `backend/models.py` — Pod model (admin_id removed), PodAdmin model added, User relationship updated
- `backend/migrations.py` — pod_admins table + 3 named data migrations
- `backend/routes/pod_routes.py` — full rewrite with multi-admin CRUD + AE cascade removed
- `backend/routes/admin_assignment_routes.py` — AE cascade removed (4 locations)
- `backend/routes/admin_upload_routes.py` — AE cascade removed from CSV upload
- `backend/routes/lead_routes.py` — no-show notification sends to all pod admins
- `backend/routes/analytics_routes.py` — Bulk Queries 5a/5b (account-level connect %)
- `backend/tests/conftest.py` — create_test_pod() updated, create_pod_admin() helper added
- `backend/tests/test_ae_role.py` — cascade tests updated to reflect v10 architecture
- `frontend/js/api.js` — addPodAdmin() + removePodAdmin() API functions added
- `frontend/js/views/pods.js` — multi-admin Pods UI with add/remove admin controls
- `frontend/js/views/analytics.js` — Acct Connect % column added to SDR table

☑ docs/RELEASES.md updated
☑ frontend/js/views/user_guide.js What's New section updated

---

## v10.2.0 — 2026-07-07 (UI/UX — Sidebar Expand + Mobile Login)
**Deploy:** `develop → staging → main` | **Type:** UI/UX Fix  
**Commits:** `2141703`, `f152f97`, `f3d0ef2` + merge commits

### Changes
- **Sidebar collapse expands main content:** `#nav-sidebar-root` now uses CSS
  `:has(.nh-sidebar--collapsed)` to shrink from `220px` to `72px` when the
  NavHub sidebar is collapsed. Main content area gains ~148px of horizontal space.
  Transition is smooth (inherited `0.22s ease` from existing rule).
- **Mobile login — portrait (≤480px):** Brand panel compresses to logo-only strip
  (`padding: 14px`). Headline and description hidden. Feature cards shown in a
  horizontal scroll row (140px per card, `overflow-x: auto`). Login form
  vertically centred in remaining `flex: 1` panel with `justify-content: center`.
- **Mobile login — landscape (`orientation: landscape, max-height: 520px`):**
  Side-by-side layout preserved. Brand panel fixed at 40% width with logo +
  headline + horizontal-scroll feature cards. Description hidden. Login form
  vertically centred in remaining 60%.
- **Feature cards always visible:** Lead Enrichment, Smart Deduplication,
  SDR Prioritization remain visible on all screen sizes via swipeable
  horizontal row.
- **Render Build Filters:** `frontend/**` added to Ignored Paths on both
  `rcm-crm-staging` and `rcm-crm-prod` via Render dashboard.
  Backend Docker rebuild now skipped on frontend-only commits.

### Files Changed
- `frontend/css/style.css` — sidebar `:has()` CSS rule
- `frontend/login.html` — responsive CSS for portrait + landscape

---

## v10.1.0 — 2026-07-07 (Production Stability + Memory Fix)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix / Performance / Hardening  
**Commits:** Fix batch — 6 code fixes + 3 admin fixes

### Bug Fixes
- **[CRITICAL] Memory leak / OOM restarts fixed:** RCM nightly sync
  `_rcm_nightly_sync` now uses retry-with-backoff (3 attempts, exponential:
  1s/2s/4s) on `fetch_calls_paginated` 502s instead of aborting. Added proactive
  zombie-heal: any DialerCall in a non-terminal state older than 24h is
  force-closed to CALL_ENDED on every nightly sync — eliminating the primary
  cause of the Render OOM restarts (3 forced restarts in 15 days).
- **[CRITICAL] Zombie bridge pollers terminated:** `_pollBridgeStatus` in
  `rcm_dialer.js` now treats HTTP 404 responses as terminal — clears the
  poll interval and triggers hangup. Previously, 404 was silently caught as a
  "network blip", keeping poll loops alive forever for stale calls.
- **[CRITICAL] Webhook latency fixed (1.4-2.3s → <50ms):** `POST /api/webhooks/dialer`
  now returns 200 immediately and offloads `handle_webhook()` processing to a
  FastAPI BackgroundTask with its own DB session. Prevents RCM webhook
  retry storms.
- **[CRITICAL] Stuck lead fixed via API:** Lead `ae2e70ce` (phone +919699702849)
  was stuck in "Calling" status — reset to "Assigned" via API.
- **[CRITICAL] Ankit Bakshi dialer enabled:** `ankit.bakshi@screen-magic.com` had
  `dialer_enabled=False` despite having a valid RCM agent ID (360347).
  Enabled via API — can now make calls.
- **[PERF] Error logs summary query optimised:** Added compound index
  `idx_error_logs_resolved_severity ON error_logs (resolved, severity, created_at DESC)`.
  Cuts 4× sequential COUNT(*) scans to index-only lookups: 1.5-3.6s → ~50ms.
- **[FIX] Assignments view null DOM guard:** `renderPaginated` and the action bar
  setup in `assignments.js` now guard against the case where the panel is closed
  before the async fetch completes — preventing `TypeError: Cannot read properties
  of null` crashes for Diwakar Varadharajan and others.

### Breaking Changes
None — all changes are backward compatible.

### Protocol Compliance
- develop → staging → main flow followed ✅
- All modified Python files py_compiled ✅  
- Full test suite passed ✅
- `docs/RELEASES.md` updated ✅
- `frontend/js/views/user_guide.js` What's New section updated ✅

---

## v10.0.0 — 2026-06-18 (NavHub Completion + Performance)
**Deploy:** `develop → staging → main` | **Type:** Feature / Performance / Bug Fix  
**Commits:** 30 commits since v9.8.0 (last prod release)

### New Features
- **Shimmer skeleton replaces "Loading...":** On first dashboard load, the plain
  "Loading..." text is replaced by a full animated shimmer skeleton that mirrors
  the real layout (welcome strip → 7 KPI cards → bento grid). GPU-composited
  `transform:translateX` animation — no layout involvement.
- **Structural CLS fix (Option C):** Eliminated the dual-skeleton architecture
  that was the root cause of the persistent 0.30 CLS score. The React mount point
  (`#dashboard-react-root`) now exists in HTML from parse time with its height
  pre-reserved in `style.css` (985px). Single skeleton, single source of truth.

### Improvements
- **Ask AI rebuilt as React overlay:** Ask AI opens as a full-screen overlay with
  smooth animation. Results render correctly — the previous blank-panel bug (caused
  by rendering into a detached/unmounted DOM node) is fixed.
- **Topbar buttons fully rewired:** New Lead, Dial, Search (⌘K), and Ask AI were
  all broken after the NavHub React migration due to missing event bridges. All
  four re-wired via `window.NavHub` callbacks.
- **Search spinner fix:** Search spinner no longer stays spinning when results are
  empty — correctly clears on zero-result responses.
- **Dashboard load time: 2,051ms → ~1,600ms LCP:**
  - Eliminated ForcedReflow insight (93ms main-thread reflow → 0ms)
  - Pre-reserved `#nav-sidebar-root` (220px) and `#nav-topbar-root` (60px) heights
    in `style.css` to eliminate the sidebar/topbar mount CLS shifts
  - Deferred Clarity.js to 2.8s — no longer blocks page paint
  - CLS reduced: 0.52 → 0.30 → targeting ~0.04 after v10.0.0
- **Mixpanel analytics hardened (v9.9.0):** Fixed double-initialisation bug
  causing duplicate events. Added 14 new tracked events: Search performed,
  Ask AI opened, KPI card clicked, New Lead opened, Dial button clicked, etc.
- **Dashboard responsive layout:** Dashboard adapts to tablet/phone viewports.
  Login page was made fully responsive in v9.7.12.
- **FeedbackModal in React:** The Send Feedback modal was rewritten in React,
  fixing a close-button bug in the vanilla implementation.
- **`contain: layout` on Dashboard root:** Scopes dashboard reflows to prevent
  cascading layout recalculations outside the dashboard container.

### Bug Fixes
- **Feedback button "not found" error:** Fixed — feedback modal now correctly
  mounts and shows the React FeedbackModal component.
- **Kanban/Pipeline removed from NavSidebar:** Deprecated views removed from nav.
- **db-dot-pulse animation:** Replaced `box-shadow` animation (non-compositable)
  with `transform:scale` on a pseudo-element — GPU-accelerated.
- **Dashboard 8s timeout race condition:** Added 5s bundle poll with 50ms interval
  (vs hard 8s wait) — faster detection when bundle is preloaded from cache.

### Breaking Changes
None. All changes are frontend-only. No backend, DB, or API changes in this release.

### Files Changed (major)
- `frontend/index.html` — single skeleton in `#dashboard-react-root`, GPU shimmer
- `frontend/js/app.js` — removed inline skeleton, kept React mount point
- `frontend/css/style.css` — `#dashboard-react-root { min-height: 985px }`
- `frontend/js/views/user_guide.js` — v10.0.0 What's New entry
- `frontend-react/src/layout/NavTopbar.jsx` — Ask AI overlay, all button bridges
- `frontend-react/src/pages/Dashboard.css` — layout contain, min-height calibration
- `frontend/js/dashboard-hub.css` + `.gz` — rebuilt

---

## v9.8.0 — 2026-06-18 (NavHub — React Sidebar + Topbar)
**Deploy:** `develop → staging → main` | **Type:** Architecture / Feature

### Features
- **React NavHub IIFE bundle shipped:** The sidebar and topbar have been migrated
  from Vanilla HTML/CSS/JS to a self-contained React IIFE bundle (`nav-hub.js` +
  `nav-hub.css`), following the same architecture as `DashboardHub` and `AnalyticsHub`.
  - `NavSidebar` — role-based nav visibility, collapse toggle (persisted to
    `localStorage`), fixed-position tooltips in collapsed mode (v9.7.11 approach),
    user avatar + logout button always visible in both states.
  - `NavTopbar` — glassmorphism topbar with Search (⌘K), Ask AI, Sync Salesforce,
    Dial, Live Call indicator, and New Lead; all actions bridged via `onAction()`
    callbacks so RCM dialer state remains in `app.js`.
  - `window.NavHub.update({ activeView })` called on every `loadView()` — React
    re-renders active nav highlight without remounting the tree.
- **Part 1 logout fix included:** Logout button now permanently visible in both
  expanded and collapsed sidebar states — no more disappearing sign-out action.

### Breaking Changes
None externally. The vanilla `<aside id="app-sidebar">` and `<header class="topbar">`
blocks have been removed from `index.html` and replaced with `#nav-sidebar-root` /
`#nav-topbar-root` React mount containers. All existing callback integrations
(RCM dialer, SF sync, New Lead modal, AI bar) are preserved via bridges.

---

## v9.7.12 — 2026-06-18 (Login Page Mobile Responsive)
**Deploy:** `develop → staging → main` | **Type:** UX

### Improvements
- **Login page fully responsive across all device sizes:**
  - **≤1024px (tablet):** Tighter padding, login panel narrows to 400px
  - **≤768px (small tablet):** Brand panel becomes a compact dark header strip,
    login form goes full-width below it; feature cards scroll horizontally
  - **≤480px (phone):** Brand headline, description, and feature cards hidden
    to save vertical space; mobile logo shown inside login panel instead;
    toast notification fixed to full-width with correct positioning

### Breaking Changes
None. Frontend `login.html` only — CSS + one new `.mobile-logo` element added.
No JS logic, auth flow, Google OAuth redirect, or backend changes.

---

## v9.7.11 — 2026-06-18 (Sidebar Tooltip Fix)
**Deploy:** `develop → staging → main` | **Type:** UX / Bug Fix

### Bug Fixes
- **Sidebar icon tooltips now visible:** When the sidebar is collapsed to icon-only mode,
  hovering over any nav icon now correctly shows a label tooltip. Root cause: the app
  container has `overflow: hidden` (required for layout), which silently clipped all
  CSS `::after` pseudo-element tooltips at the sidebar boundary. Fix: replaced the
  CSS-only pseudo-element approach with a single `#sidebar-tooltip` `<div>` using
  `position: fixed` — fixed elements bypass all overflow clipping. Tooltip is driven
  by a small JS `mouseenter` handler using `getBoundingClientRect()`.

### Breaking Changes
None. Frontend HTML/CSS/JS only. No backend, DB, or API changes.

---

## v9.7.10 — 2026-06-18 (POD Management Icon + Sidebar Tooltip Attempt)
**Deploy:** `develop → staging → main` | **Type:** UX

### Improvements
- **POD Management sidebar icon now distinct:** The POD Management nav icon was using
  the same SVG as Leads (a "two people / users" icon), making the two items visually
  indistinguishable when the sidebar is collapsed. Replaced with a 2×2 grid-of-squares
  icon that clearly communicates "teams / groups" at a glance.

### Breaking Changes
None. Frontend HTML only.

---

## v9.7.9 — 2026-06-18 (EC-17: RCM 502 Log Storm Fix)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix / Performance

### Bug Fixes
- **EC-17 — Calls tab no longer fires redundant RCM API requests:** Every
  `GET /leads/{id}/calls` was spawning one background thread per historical DialerCall
  to refresh recording URLs, even for calls that already had all their data. When
  RCM returned 502 for expired call IDs, the 3-attempt retry loop (1s + 2s
  backoff) filled Render logs with noise. Fix: added pre-flight guard before spawning
  the thread — only refreshes when the call is terminal AND at least one field is
  actually missing (recording URL expired/absent OR duration/ended_at is null).

### Breaking Changes
None. Backend-only guard logic, no API or schema changes.

---

## v9.7.8 — 2026-06-18 (Technical Handoff Bible Page)
**Deploy:** `develop → staging → main` | **Type:** Docs / Internal Tool

### New Features
- **Technical Handoff Bible** (`/technicalunderstanding.html`): Admin-only reference page
  covering the full system — architecture, environments, integrations, deployment flow,
  incident playbook, rollback procedure, database/migration system, cache layer,
  background scheduler jobs, open carry-forward items, known gotchas, utility scripts,
  and AI agent rules. Includes a live production status bar and auth gate (verifies
  Admin/Super Admin role via JWT before showing content). Intended as a single-URL
  operational reference for any engineer or AI agent picking up the project.

### Breaking Changes
None. Purely additive static HTML file. No backend, DB, or env var changes.

---

## v9.7.7 — 2026-06-17 (OOM Crash Fix + Dashboard API Staggering)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix / Reliability

### Problem Solved
Production instance `rcm-crm-prod` (Render Starter, 512MB) was running out of
memory and restarting. First observed at 4:02 PM on 2026-06-17, coinciding with the
Dashboard React migration.

### Root Causes
1. **API fan-out storm:** The React Dashboard fired 7 simultaneous API requests on every
   mount — all `useEffect`s running concurrently. Under 2–3 concurrent users loading the
   dashboard, the server exceeded 512MB RAM.
2. **Unbounded memory cache:** `growth_intelligence_routes.py` maintained a module-level
   `_cache: dict = {}` outside of `cache.py` — no size limit, no Redis backing, no TTL
   eviction. Stored one full Groq AI result per user indefinitely.

### Fixes
- **API request staggering (Dashboard.jsx):** Sub-components now delay their fetch by
  200–800ms after mount instead of firing simultaneously:
  - `MeetingsChart` → 200ms (chart data)
  - `LeaderboardMini` → 400ms (leaderboard)
  - `NeedsAttention` → 600ms (SDR table — below fold)
  - `PipelineIntelligence` (Groq AI) → 800ms (heaviest call, fires last)
- **Cache migration (`growth_intelligence_routes.py`):** Replaced `_cache: dict` with
  `cache.py` `get_cached` / `set_cached` (Redis → in-memory, 900s TTL, bounded, shared
  across workers). Added `growth_intelligence` namespace to `cache.py` TTL table.
- **Test updated (`test_growth_intelligence.py`):** Cache-clear calls updated from
  `_cache.clear()` to `cache.invalidate('growth_intelligence')`.

### Measured Impact
| Before | After |
|---|---|
| 7 API calls fire simultaneously on dashboard open | Calls stagger in at 200/400/600/800ms |
| Groq AI cache grows unbounded (1 dict entry/user, never evicted) | Redis-backed, 15-min TTL, bounded |
| OOM kill under ~3 concurrent users loading dashboard | Expected: stable under 10+ concurrent users |

### Files Changed
- `backend/routes/growth_intelligence_routes.py` — replaced `_cache` with `cache.py`
- `backend/cache.py` — added `growth_intelligence: 900` to TTL table
- `backend/tests/test_growth_intelligence.py` — updated cache-clear calls
- `frontend-react/src/pages/Dashboard.jsx` — staggered API call timing (4 components)
- `frontend/js/dashboard-hub.js` + `.gz` — rebuilt bundle with staggered timing
- `frontend/index.html` — cache-bust bumped `v=20260616k → v=20260617a`
- `frontend/js/views/user_guide.js` — What's New section updated

### Breaking Changes
None. Dashboard UX unchanged — skeletons show immediately, data fills in progressively.

---

## v9.7.6 — 2026-06-16 (Dashboard Load Performance)
**Deploy:** `develop → staging → main` | **Type:** Performance

### Improvements
- **Gzip pre-compression (70% bundle size reduction):** `dashboard-hub.js` now ships as `dashboard-hub.js.gz` (269 KB) alongside the original (871 KB). Render static site automatically serves the compressed file to browsers that send `Accept-Encoding: gzip` — no server config needed. Wire transfer reduced from 871 KB → 269 KB.
- **`rel=preload` for dashboard bundle:** Browser now starts fetching `dashboard-hub.js` immediately on page load (from the `<head>`) instead of waiting until the user clicks the Dashboard nav item. Eliminates the download gap entirely for return visits (bundle is cached) and overlaps download with navigation time for first visits.
- **Parallel API calls in Dashboard `load()`:** `getDashboardStats` and `getErrorLogSummary` now fire simultaneously via `Promise.all`. Previously they were sequential, adding ~640ms to the critical path for Super Admins on every dashboard open.
- **Faster bundle polling (100ms → 50ms):** `app.js` polling loop for `window.DashboardHub` now checks every 50ms instead of 100ms — halves the worst-case wait between bundle parse completing and React mount.

### Measured Impact (before → after)
| Metric | Before | After |
|---|---|---|
| Bundle wire size | 871 KB | 269 KB |
| Error log fetch (SA) | +643ms sequential | Parallel with stats |
| Bundle poll granularity | 100ms | 50ms |
| Time to first interactive | ~1.7s | ~1.1s (est.) |

### Files Changed
- `frontend-react/vite.config.dashboard.js` — added `vite-plugin-compression`
- `frontend-react/src/pages/Dashboard.jsx` — `Promise.all` for parallel API calls
- `frontend/js/dashboard-hub.js` + `.gz` — rebuilt bundle with gzip companion
- `frontend/index.html` — `rel=preload` hints + cache-bust `v=20260616k`
- `frontend/js/app.js` — polling interval 100ms → 50ms

### Breaking Changes
None.

---

## v9.7.4 — 2026-06-16 (Mixpanel + Clarity Analytics)
**Deploy:** `develop → staging → main` | **Type:** Feature

### New Features
- **Mixpanel analytics — 16 custom events:** Full event tracking now live across all surfaces using a safe `mp.js` wrapper (silent no-op if SDK fails). Events: `User Identified`, `Page Viewed`, `Logged Out`, `View-As Entered/Exited`, `Leads Searched`, `Leads Filtered`, `Lead Created`, `Lead Viewed`, `Lead Status Changed`, `Lead Closed`, `Call Logged` (with branch + source), `Outcome Card Clicked`. Autocapture + 100% session recording enabled.
- **Microsoft Clarity session recording:** Heatmaps and session replays now active on both `login.html` and `index.html` (main app).
- **Mixpanel CDN snippet added to `index.html`:** Previously only in `login.html` and the defer-loaded dashboard bundle — `window.mixpanel` was undefined when `app.js` ran, causing `mp.identify()` to silently no-op. Fixed by adding the official CDN stub to `<head>` before any JS executes. This resolves the "Users ❌ Replays ❌" state in the Mixpanel setup guide.

### Files Changed
- `frontend/js/mp.js` — new safe wrapper module
- `frontend/js/app.js` — identify + Page Viewed + Logged Out + View-As events
- `frontend/js/views/lead_list.js` — Leads Searched + Leads Filtered events
- `frontend/js/views/lead_detail.js` — Lead Viewed + Status Changed + Lead Closed events
- `frontend/js/views/modals.js` — Call Logged + Lead Created events
- `frontend-react/src/pages/Dashboard.jsx` — Outcome Card Clicked event
- `frontend/index.html` — Mixpanel CDN snippet (critical fix)
- `frontend/login.html` — Mixpanel CDN snippet (previously added)

### Breaking Changes
None.

---

## v9.7.3 — 2026-06-16 (SDR Call Summary Bug Fix)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix

### Bug Fixes
- **[CRITICAL] SDR Dashboard: Calls Today and Outcomes Today now count all call sources:** The `/api/sdr/call-summary` endpoint was querying only the `CallLog` table (manual calls), completely ignoring `DialerCall` records from RCM and Aircall. For SDRs using the dialer, their daily counts showed 0 even after a full day of calls. Fixed using the same `UNION` pattern as the analytics endpoint — both tables are now combined before counting.

### Files Changed
- `backend/routes/call_routes.py` — `get_sdr_call_summary()` rewritten with UNION query

### Breaking Changes
None.

---

## v9.7.0 — 2026-06-16 (Dashboard Hardening + Dialer Fixes)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix + Hardening

### Bug Fixes
- **[CRITICAL] View-As mode now sends correct user token:** `getToken()` in the React Dashboard's `auth.js` was reading only `crm_token` (the Super Admin's JWT) even when an admin was in View-As mode. As a result, all API calls from the React Dashboard were scoped to the Super Admin, not the impersonated user — so SDRs appeared to have 11,408 leads instead of their actual assigned count, and Pod Admin pod-scoping was bypassed entirely. Fixed by checking `sessionStorage` for `crm_view_as_token` first. Affects all roles (SDR, AE, Pod Admin).
- **Sidebar collapse: logo-only visible when collapsed:** When the sidebar was collapsed to 72px, the "Powered by RCM" tagline remained visible while the RCM logo icon disappeared. Fixed: in collapsed state, only the logo icon (centered, 36×36px) is shown; the text column is hidden entirely.
- **Scope toggle: right-side positioning + SVG icons:** The My Pod / Global toggle was floating loosely between the dashboard title and the Refresh button. Moved to a flex group on the right side of the header together with Refresh. Replaced emoji icons (🔒🌐) with clean SVG lock + globe icons matching the app's icon style.
- **Scope toggle: always defaults to My Pod on load:** Previously the toggle read `globalView` from `sessionStorage` on mount, which caused stale `Global` state to persist across sessions. Now always initialises to `My Pod` (false) on every page load.
- **getDashboardStats: cache-bust on toggle:** Added `?_ts=timestamp` query param to bust the browser's HTTP cache when toggling between My Pod and Global, ensuring a fresh API call is made on each toggle.
- **[Dialer] Zombie call blocking resolved (3 fixes):**
  - Reduced `CALL_ANSWERED` staleness threshold from 90 min → 15 min (RCM auto-terminates bridges after ~12 min)
  - Added Force Clear banner for SDRs stuck in zombie `CALL_ANSWERED` state — one-click escape hatch instead of a generic error toast
  - Extended `_activeSyncTimer` from 10 s → 25 s to handle slow `/api/calls/start` API latency (2.5–3.2 s consistently)

### Tooling
- Added `scripts/staging_redistribute_leads.py` — round-robin lead redistribution across active SDRs for staging data setup and QA verification

### Breaking Changes
None.

---

## v9.6.0 — 2026-06-16 (Dashboard Role Redesign + RCM Brand)
**Deploy:** `develop → staging → main` | **Type:** Feature + Brand

### New Features
- **Pod Admin: My Pod / Global toggle** — Pod Admins can now switch between their pod-scoped view and a full org-wide view directly from the dashboard header. Toggle state persists across navigation via sessionStorage.
- **RCM brand rollout** — New logo across all surfaces: browser favicon (`.ico` multi-res), Apple Touch icon (180×180), Android/PWA icons (192×512), Open Graph image, sidebar brand icon (28×28), login page logo. PWA `manifest.json` added. `scripts/generate_icons.py` created for future logo updates.

### Improvements
- **SDR/AE Dashboard: Call Outcomes clickable** — Each outcome card now navigates to the Leads view pre-filtered by that outcome. Zero-count outcomes are hidden to keep the view clean.
- **SDR/AE Dashboard: Meetings Booked chart removed** — The chart was hitting an admin-only endpoint (`/admin/analytics/trend`) that SDRs do not have access to. Replaced with a clean layout focused on personal KPIs and call outcomes.
- **AE role now treated identically to SDR** — `AE` role receives the same dashboard layout as `SDR` (confirmed by design intent).

### Bug Fixes
- Fixed: dashboard-hub IIFE bundle was not rebuilt after source changes — staging was serving the previous bundle.
- Fixed: `getDashboardStats` now accepts `globalView` param and passes `?global_view=true` to backend for Pod Admin global scope.

### Breaking Changes
None.

---

## v9.5.7 — 2026-06-15 (Playground Proper Fix — Form Credentials)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix

### Problem Solved
After v9.5.5, the Playground called `POST /api/calls/start` which ignores the
credentials entered in the form and uses the admin's CRM dialer profile instead.
If the admin has no `rcm_from_number` in their profile, RCM rejects
with `from_number: Missing data for required field` (HTTP 422).

### Root Cause
v9.5.5 was a patch — it removed the `RCMDialer.mount` crash but replaced
it with a fundamentally wrong approach. The Playground's purpose is to TEST
RCM credentials entered in the form, completely independent of any CRM
user profile.

Additionally, the existing `POST /api/dialer/playground/test-call` backend
endpoint was calling `provider.initiate_call(from_number=..., call_mode=...)` —
kwargs that don't exist on the method. This caused a Python exception before
ever reaching RCM.

### Fix
- **`frontend/js/views/playground.js`**: Make Call now POSTs to
  `/api/dialer/playground/test-call` with `{ phone, api_key, user_id, from_number,
  api_base, call_mode }` — directly from Step 2 form fields.
- **`backend/routes/dialer_routes.py`** (`POST /api/dialer/playground/test-call`):
  - Fixed `initiate_call()` call to use correct signature: `(phone_number, user_email, lead_id, use_agent_phone)`
  - Added early 422 guard: bridge mode with no `from_number` returns a clear message before touching RCM
  - Added `GET /api/dialer/playground/call-status` endpoint for Playground status polling

### Breaking Changes
None. Admin-only Playground feature.

---

## v9.5.6 — 2026-06-15 (Admin Dialer Override UI + Provider Log Fix)
**Deploy:** `develop → staging → main` | **Type:** Feature + Bug Fix

### Problem Solved
Admins (Super Admin / Pod Admin) had no UI to set their `dialer_provider_override`
or RCM agent credentials (agent ID, from_number, email). These required
a raw DB update. The "Dialer Override" dropdown and "RCM Agent" column
were only shown on SDR / AE tabs.

Additionally, the error log always said `[DialerService] RCM call initiation
failed` even when the actual failure was from the Aircall provider.

### Fix
- **`frontend/js/views/admin.js`**:
  - "Dialer Override" dropdown now shows on **all tabs** (Super Admins, Pod Admins,
    SDRs, AEs) — not just SDR/AE.
  - Saves via existing `patchUserSettings` → `PATCH /api/admin/users/{id}/settings`
    → takes effect immediately, no re-login needed.
- **`backend/dialer_service.py`**: Error log now uses `provider.provider_name`
  dynamically instead of hardcoded "RCM".

### Breaking Changes
None.

---

## v9.5.5 — 2026-06-15 (Dialer Playground — TypeError Crash Fix)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix

### Problem Solved
Opening the Dialer Playground (Admin only) and clicking "Launch Widget" crashed immediately
with two console errors:
```
TypeError: RCMDialer.mount is not a function  (playground.js:354)
TypeError: RCMDialer.mount is not a function  (playground.js:354)  [Unhandled rejection]
```
The Playground was completely unusable — the "Make Call" button never became interactive.

### Root Cause
`playground.js` was written expecting a third-party RCM SDK with methods
`RCMDialer.mount()`, `.call()`, `.on()`, `.unmount()`, `.hangup()` —
a design that was never implemented. Our `RCMDialer` module is a CRM-internal
state machine (`activate`, `destroy`, `isActive`) with no SDK surface.

### Fix
- **`frontend/js/views/playground.js`** (`_initStep3` rewrite):
  - Removed all `RCMDialer.mount/call/on/unmount/hangup` calls.
  - Step 3 now calls `POST /api/calls/start` directly (identical to a real SDR dialer call).
  - Polls `GET /api/calls/{id}/status` every 3 seconds to track `CALL_ANSWERED` /
    `CALL_ENDED` / `CALL_FAILED` and updates the event log + status badge accordingly.
  - Hang Up button calls `POST /api/calls/end` directly.
  - No third-party dependency — uses the same backend path as all production calls.

### Breaking Changes
None. Playground is Admin-only. No SDR-facing changes.

---

## v9.5.4 — 2026-06-15 (Ghost Call Auto-Heal)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix

### Problem Solved
When a RCM `CALL_ENDED` webhook was missed (network failure, RCM outage), the
SDR's `DialerCall` record stayed stuck in `CALL_STARTED` indefinitely. Every subsequent call
attempt showed: *"You already have an active call in progress. Please hang up the current call
before starting a new one."* — with no self-recovery path. SDR had to refresh the page and
hope the EC-16 auto-heal fired on the backend (which it does on page-load, but only if the
call is already > 5 min old at that point).

First reported by: **Damini Kumari** (damini.kumari@screen-magic.com), call stuck for 2.5h
(call_id `8739fac8`, to `+91 9501742024`, 2026-06-15 09:15 UTC).

### Root Cause
`_get_active_call_for_user()` applies EC-16 staleness thresholds and auto-heals stale
`CALL_STARTED` records (> 5 min = stale). However, this auto-heal only fires inside
`initiate_call()` on the server — meaning the SDR had to attempt a new call to trigger it.
When the attempt landed within the 5-min window (legitimate block), the error was shown
correctly. But if they retried after the 5-min window, the next `initiate_call` would have
auto-healed and succeeded. The gap was: the **frontend** never surfaced a "cleared, retry now"
message — it just showed the toast error regardless.

### Fix
- **`frontend/js/app.js`** (`handleCallAction` catch block): When the backend error message
  contains `'active call in progress'`, the frontend now immediately calls
  `GET /api/calls/my-active` (which runs EC-16 auto-heal on the server). If the ghost call
  was stale and gets cleared, the SDR sees:
  > ✅ *"Cleared a stuck call. Please try calling again."*
  instead of the blocking error. If the call is genuinely still active (real concurrent call),
  the original error is shown as before.

### Immediate Prod Fix
Damini's ghost call (`8739fac8`) was manually marked `CALL_ENDED` in prod DB at 09:54 UTC.
She was unblocked immediately.

### Breaking Changes
None. Frontend-only, additive catch-block logic.

---

## v9.5.3 — 2026-06-15 (Aircall Backfill Script Fixes + Settings UX)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix

### Bug Fixes
- **`backend/scripts/backfill_aircall_duration.py` — Path fix (EC-5):** `sys.path` was built as
  `PROJECT_ROOT/backend/backend` (one level too deep). Fixed by computing `BACKEND_DIR` directly
  as the parent of the script directory — imports of `database`, `models`, and `dialer_service` now
  resolve correctly.
- **`backend/scripts/backfill_aircall_duration.py` — Method name fix:** Script called
  `provider.get_call(id)` which does not exist on `AircallDialerProvider`. Correct method is
  `provider.fetch_call(id)`. All backfill calls were failing silently with `AttributeError`.
- **`frontend/js/views/settings_ai_dialer.js` — Stale banner cleanup:** After a successful or
  failed "Test Connection" attempt, the success/error banner persisted on screen even when the
  admin edited credential fields. Added `input` event listeners on all credential fields (Aircall:
  `api-id`, `api-token`; RCM: `api-key`, `user-id`, `base-url`, `account-id`, `sender-id`)
  to clear both banners immediately on edit — prevents stale results from misleading the admin.

### Notes
- The backfill script is a one-time recovery tool (not deployed to server). Run on a machine with
  `DATABASE_URL` + `APP_ENCRYPTION_KEY` set. Always dry-run first (`--dry-run` flag).
- 4,749 Aircall `DialerCall` records have `NULL` duration in prod and will be healed by this script.

### Breaking Changes
None. Script fixes only; settings change is purely additive (event listeners).

---

## v9.5.2 — 2026-06-15 (Frontend Stability — classList TypeError Fix)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix (Hotfix)

### Problem Solved
`TypeError: Cannot read properties of undefined (reading 'classList')` was hitting
5+ RCM SDRs repeatedly, appearing in error logs as "An unexpected JavaScript
error occurred". The error was also generating a secondary "A background operation
failed unexpectedly" log entry as an unhandled promise rejection downstream.

### Root Cause
`rcm_widget.js` holds 9 module-level DOM refs (`$channelWa`, `$channelSms`,
`$composeWrap`, `$noLeadNotice`, `$noPhoneNotice`, `$tplWrap`, `$tplPreview`,
`$sessionBanner`) that start as `undefined` at module parse time and are only
assigned inside `_buildDOM()`. Six functions that use these refs can be triggered
before or during widget init by async events (`rcm:call-started`, channel
clicks, tab switches), causing a crash.

### Changes
- **`frontend/js/rcm_widget.js`** (V35):
  - `_setChannel()`: `$channelWa?.classList` / `$channelSms?.classList` — optional chaining
  - `_updateComposeArea()`: `$composeWrap?.classList` (×3) — optional chaining
  - `_applyMsgPaneForState()`: `$noLeadNotice?.classList` / `$noPhoneNotice?.classList` (×4)
  - `_showTemplatePicker()`: early-return guard if `!$tplWrap || !$composeWrap`
  - `_renderTemplatePreview()`: early-return guard if `!$tplPreview`
  - `_setBanner()`: early-return guard if `!$sessionBanner`
  - `_switchTab()`: early-return guard if any tab/pane param is null/undefined
- **`frontend/index.html`**: cache-buster bumped `?v=20260612d` → `?v=20260615a`
  so all browsers immediately serve the patched file on next page load.

### Breaking Changes
None.

---

## v9.5.1 — 2026-06-12 (RCM Payload — Full Curl Alignment)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix (Hotfix)

### Problem Solved
After v9.5.0 landed, two further issues were found by comparing our payload against the
actual RCM browser network traffic (curl capture from developer):

1. **`from_number` format mismatch**: v9.5.0 converted stored DIDs to raw-digit format,
   stripping the `00` prefix. This caused `HTTP 400 "Invalid from_number for this user/account"`
   because Tata and other telecom providers register DIDs in different formats.
2. **Missing fields**: `use_agent_phone` and `contact_name` were removed in v9.5.0 based on
   an incorrect assumption — the 422 in our history was caused by `call_type`, not these fields.
   Without `use_agent_phone`, bridge mode could not work (RCM didn't know to ring the agent's phone).

### Root Cause (per RCM browser network traffic)
The exact wire format RCM's own UI uses:
```json
// Browser call
{"phone_number": "+919580440262", "contact_name": "", "use_agent_phone": false, "from_number": "<DID>"}

// Bridge call
{"phone_number": "+919580440262", "contact_name": "", "use_agent_phone": true, "from_number": "<DID>"}
```

### Changes
- **`backend/rcm_provider.py`**:
  - `phone_number` → normalized to E.164 (`+` prefix) using existing `_to_rcm_number()`
  - `from_number` → **sent verbatim from Settings** (only whitespace/dashes/parens stripped).
    No prefix transformation. Admins store the DID in whatever format their provider (Tata, Airtel,
    BSNL, etc.) requires. One format does not fit all.
  - `use_agent_phone` → restored. `false` for browser calls, `true` for bridge calls.
  - `contact_name` → restored as `""` (matches RCM's own wire format).
  - Added `_strip_to_digits()` helper (kept for reference — not used in payload).
  - `call_type` → still NOT sent (this was the real 422 culprit, never restored).

### Design Decision
> `from_number` is owned by the admin. They enter it in Settings in the exact format
> their RCM account expects. We are not in the business of guessing telecom formats.

### Breaking Changes
None. Admins must verify their DID in Settings → Contact Center → Default Caller ID
is stored in the exact format shown in their RCM account.

### Verified on Staging
Yes — call placed successfully on staging after deploy `bd3b62a`. No 400/422 errors.

---

## v9.5.0 — 2026-06-12 (RCM Call Trigger — Definitive Fix)
**Deploy:** `develop → staging` | **Commits:** `10a0b3e` | **Type:** Bug Fix (Hotfix)

### Problem Solved
Clicking the Call button on a RCM lead loaded the spinner but the call was never placed.
The UI appeared to be working but RCM's API returned HTTP 422 on every attempt.

### Root Cause (Verified via Live API Testing)
The `/calls/initiate` endpoint was receiving the wrong payload format. The previous code was
built on **incorrect assumptions** from developer curl examples, not the actual RCM API.

By querying `GET /calls` (44 real call records) and then live-testing payload combinations
against the RCM API, the true contract was discovered:

| Field | Wrong (what we sent) | Correct (RCM wire format) |
|-------|---------------------|-----------------------------------|
| `phone_number` | `+919545455721` (E.164) | `00919545455721` (00-prefix) |
| `from_number` | `919240915643` (stripped `00`) | `00919240915643` (keep `00` as-is) |
| Extra fields | `call_type`, `call_mode`, `contact_name` | **NOT accepted** — 422 "Unknown field" |

**The correct payload is exactly 2 fields:**
```json
{"phone_number": "00919545455721", "from_number": "00919240915643"}
```
This was verified by making a live test call to RCM (call_id=93 created & disconnected).

### Changes
- **`backend/rcm_provider.py`**:
  - Added `_to_00_prefix()` helper: converts any number format → RCM's `00`-prefix wire format
  - `initiate_call()` payload: now sends only `phone_number` + `from_number`, both in `00`-prefix format
  - Removed all incorrect extra fields (`call_type`, `call_mode`, `contact_name`)
  - Removed bad "skip from_number if ≥12 digits" logic — stored `00919240915643` is valid and correct
  - Clear error message if `from_number` is not configured in Settings

### Secondary Issues Fixed
- **SyntaxError crash** (during session): a `try:` keyword was accidentally dropped during an edit,
  causing the server to crash on deploy. Fixed with a separate commit (`769e751`) before the
  force-redeploy (`10a0b3e`). The `py_compile` check is now run before every commit.

### Rule Added (AGENT_PROTOCOL.md § 17)
> Never assume payload field formats from documentation or curl examples.
> Always verify against the real API (call history, live test) before coding.

### Breaking Changes
None. Backend only. `from_number` must be stored in `00`-prefix format in Settings → Contact Center.

### Verified on Staging
Yes — call placed successfully after deploy `10a0b3e`. Render logs confirm clean startup.

---

## v9.4.4 — 2026-06-11 (Browser Call Silent Failure Fix)
**Deploy:** `develop → staging` | **Type:** Bug Fix

### Bug Fixes
- **Browser call silent fallback bug (`rcm_dialer.js`):** When RCM's API is degraded and returns no `livekit_token`, the code previously fell silently into bridge polling — no phone rang, the call appeared stuck. Now shows an explicit toast ("RCM did not return audio credentials — try again or switch to Phone Bridge") and auto-hangs up to reset the widget to idle.
- **LiveKit `room.connect()` failure (`rcm_dialer.js`):** If LiveKit connection threw an error, the widget stayed stuck at "Ringing…" with non-functional Mute/Hold/End buttons. Now calls `RCMDialer.hangup()` after the error toast, resetting the widget to idle.
- **Browser mode ringing hint:** Widget now shows "🎧 Lead's phone is ringing — you'll hear them when they answer" during the ringing phase for browser calls (matching the bridge-mode "📱 Your phone will ring" hint added in v9.4.3).

### Breaking Changes
None. Frontend-only.

---

## v9.4.3 — 2026-06-11 (Bridge Mode Ringing UX)
**Deploy:** `develop → staging` | **Type:** UX Improvement

### Problem Solved
SDRs using Bridge mode were hitting End after 4 seconds because they didn't know their own phone would ring first. The widget showed "Ringing…" with no explanation.

### Changes
- **`frontend/js/rcm_widget.js` (`_renderCallActive`):** Bridge mode now shows a pulsing 📱 hint: "Your phone will ring — answer it to connect" during the ringing phase. Hint disappears when call is answered.
- **Recording badge** now shows "Dialling bridge…" during ringing instead of "Connecting…"; changes to "● Recording" once answered.
- **`frontend/css/rcm_widget.css`:** Added `.cw-call-ring-hint` styles and `cwPulse` keyframe animation.

### Root Cause Analysis
Render staging logs showed `POST /api/calls/disconnect 200` firing only 4 seconds after `POST /api/calls/start 200` on a bridge call — consistent with user immediately clicking End without realising they needed to answer their handset first.

### Breaking Changes
None. Frontend-only.

---

## v9.4.2 — 2026-06-11 (A6 Widget Theme + B Playground + C Duration-Heal)
**Deploy:** `develop → staging` | **Type:** Bug Fix + Feature

### Bug Fixes
- **A6 — RCM widget visibility (`app.js`, `rcm_widget.css`):** Widget was initialised with `theme: 'light'` but the light-theme CSS was incomplete — lead name, phone, status text, and Mute/Hold/End buttons all rendered as white text on a white background (invisible). Fixed by switching to `theme: 'dark'` (the fully-designed glassmorphism theme). Also added ~35 lines of complete light-theme overrides (`[data-widget-theme="light"]`) for future safety.
- **C1 — Aircall duration-heal in nightly sync (`dialer_service.py`):** The nightly Aircall sync previously skipped records that already existed in the DB. Now heals `duration`, `answered_at`, and `ended_at` on existing records when Aircall returns data that is missing in the DB (e.g. webhook fired before Aircall finalised billing).

### Features
- **B — Dialer Playground re-enabled (`app.js`):** Playground view is now accessible to Super Admins from the sidebar. Uncommented import, nav-item display, and route handler.
- **C2 — Aircall duration backfill script (`backend/scripts/backfill_aircall_duration.py`):** One-time script to heal existing DialerCall records with `duration=NULL` by fetching from Aircall's API. Dry-run mode, idempotent, rate-limited at ~2 req/s.

### Breaking Changes
None.

---

## v9.4.1 — 2026-06-11 (Bridge Call Polling + InFlight Guard)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix (Hotfix)

### Bug Fixes
- **`_pollBridgeStatus` in `rcm_dialer.js`:** Bridge-mode calls now poll `GET /api/calls/{id}/status` every 2 seconds. `CALL_ANSWERED` fires the timer; terminal statuses auto-hangup. Previously bridge calls never detected answer events.
- **`_callInFlight` reset on cancel (`app.js`):** If the user dismissed the mode selector (Cancel) without completing a call, `_callInFlight` was left as `true`, silently blocking all subsequent calls. Now resets on cancel.

### Breaking Changes
None. Frontend-only.

---

## v9.4.0 — 2026-06-11 (RCM Dialer Separation)

**Deploy:** `develop → staging → main` | **Type:** Architecture / Reliability

### Overview
The RCM dialer is now fully isolated from the Aircall-shared `dialer_machine.js`. A new self-contained `RCMDialer` module owns the entire RCM call lifecycle.

### Problem Solved
SDRs using the RCM dialer were frequently experiencing a "blank widget" or "stuck dialer" bug where placing a second call was blocked because the shared state machine was stuck in a transient state (`INITIATING`, `RINGING`, `CONNECTED`, or `ENDING`) from the previous call. A page refresh was required to recover. Root cause: both Aircall and RCM shared a single state machine designed for only one provider.

### Changes
- **`frontend/js/rcm_dialer.js`** [NEW]: Self-contained RCM call manager. State: `IDLE → INITIATING → ACTIVE → ENDING → IDLE`. Fires the same `rcm:call-started` / `rcm:call-ended` CustomEvents. No dependency on `dialer_machine.js`.
- **`frontend/js/app.js`**: `handleCallAction()` now calls `RCMDialer.activate()` for RCM calls instead of `showDialerWidget()`. Duplicate-dial guard now checks both `isWidgetActive() || RCMDialer.isActive()`.
- **`frontend/js/views/dialer_widget.js`**: `window.rcmDialer` global updated to proxy `isActive`, `getState`, `hangup`, `mute`, `hold` to `RCMDialer`. `rcm_widget.js` requires zero changes.

### Aircall Safety
Aircall never called `showDialerWidget()` — the machine was always IDLE for Aircall calls. The Aircall polling path (`_startAircallOutcomePolling`), outcome modal, and sticky banner flow are completely untouched.

### Breaking Changes
None. Frontend-only.

---

## v9.3.1 — 2026-06-11 (Hotfix — Outcome Modal on Failed Dial)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix (Hotfix)

### Bug Fix
- **Outcome modal appearing immediately on a failed Aircall dial** (`frontend/js/app.js`): When an Aircall call failed (e.g. SDR's Aircall Desktop was offline/not set to Available — HTTP 405 from Aircall), the outcome logging modal ("Did the call connect?") was appearing instantly on screen before the call even connected. Root cause: the `catch` block in `handleCallAction()` was missing a `return` statement — after showing the error toast it fell through to the `openCallModal()` call at the bottom of the function, which was intended only for non-dialer (manual log) SDRs. Fix: added `return` in the catch block. RCM flow is completely unaffected (it returns at `showDialerWidget()` before reaching this code path).

### Breaking Changes
None. Frontend-only, 1-line fix.

---

## v9.3.0 — 2026-06-10 (Analytics Data Audit — 6 Bug Fixes)

**Deploy:** `develop → staging → main` | **Type:** Bug Fix / Cleanup

### Bug Fixes
- **Aircall call duration always 0s** (`dialer_service.py`): Idempotency guard blocked `call.ended` webhook from overwriting `duration=0` (set by `call.created`). Guard now allows overwrite when `duration == 0`.
- **Research trend not filtered by SDR** (`analytics_routes.py`): Selecting an SDR in the Activity Trend chart filtered calls/emails/meetings but NOT research. Added `sdr_id` filter via `lead_assignments` join.
- **Duplicate trend dates** (`analytics_routes.py`): TZ-aware timestamps (`+00:00`) vs TZ-naive timestamps created duplicate X-axis labels. Added `_norm_period()` helper to strip timezone suffixes before merging.
- **Duplicate lead sources in filters** (`analytics_routes.py`): "Uploaded" appeared twice in the dropdown. Added `seen_values` deduplication set.
- **Dashboard "Research" card replaced** (`dashboard.js`): Research count is auto-populated and meaningless as a KPI. Replaced with "Demo Scheduled" card.
- **SDR table pagination at 7** (`api.js`): Frontend was sending no `page_size` (default 20). Now sends `page_size=7` — pagination controls already existed.

### Cleanup
- **Sunset `metrics.js` import** (`app.js`): Removed dead `import { renderMetrics }` — the `metrics` route already redirects to `analytics`.

### Breaking Changes
None.

### Note
Historical Aircall calls with `duration=0` need a backfill sync to update durations.

---

## v9.2.0 — 2026-06-10 (Code-Only Performance Optimizations)
**Deploy:** `develop → staging → main` | **Type:** Performance / Hardening

### Overview
Six code-only optimizations targeting RC-3 (heavy ORM queries) and RC-4 (no HTTP cache headers) from the performance RCA. No infrastructure changes — all improvements are backend code.

### Improvements
- **GZip compression** (`main.py`): Added `GZipMiddleware` — compresses JSON responses 70-80% (19KB → 3.4KB for `/api/admin/users`). Reduces transfer time on India→Ohio link.
- **Cache-Control + SWR headers** (`middleware_cache_headers.py`): New middleware adds `stale-while-revalidate` headers to cacheable GET endpoints. Browsers serve cached responses instantly on repeat page loads.
- **ORM column selection** (`lead_helpers.py`, `lead_routes.py`): List view queries now use `load_only()` — prevents loading ~20 unused text columns (research_*, enrichment) per lead. Reduces memory ~60% per request.
- **DB pool right-sizing** (`database.py`): `pool_size` 20→8, `max_overflow` 40→15. Saves ~24MB memory. Prepares for `WEB_CONCURRENCY=2` (23 per worker × 2 = 46 < 97 limit).
- **In-memory cache optimization** (`cache.py`): When Redis SET succeeds, skip redundant in-memory write. Prevents dual-storage memory bloat (204→360MB spike eliminated).
- **Cache monitoring** (`monitoring_routes.py`): `/api/monitoring/health` now reports `cache_backend` (redis/in-memory) and `cache_keys_in_memory` count.

### Graph Review
- `detect_changes`: Risk score 0.40 (low), 5 changed functions, 0 affected flows.

### Breaking Changes
- None

### Verified on staging
Yes — deployed to staging, memory verified (124.3MB → 127.0MB vs 204→360MB on v9.1.0). GZip confirmed working (83% compression).

---

## v9.1.0 — 2026-06-10 (Redis Cache Layer — Upstash)
**Deploy:** `develop → staging → main` | **Type:** Performance / Infrastructure

### Overview
Replaces the in-memory Python dict cache with a 3-layer architecture: **Upstash Redis → in-memory dict → PostgreSQL**. This is the permanent fix for deploy-time cache stampedes, multi-worker cache isolation, and cold-start latency.

### Improvements
- **3-layer cache** (`cache.py`): Redis (shared across workers, survives deploys) → in-memory dict (per-worker, ~0ms) → DB (always works). All Redis calls wrapped in `try/except` — app **never** breaks if Redis is unavailable.
- **Environment-prefixed keys**: Staging and prod share the same Redis instance safely. Keys use `ls:staging:` / `ls:prod:` prefix, auto-detected from `DATABASE_URL`.
- **Write-through**: `set_cached()` writes to both Redis and in-memory simultaneously. `invalidate()` clears both layers.
- **Graceful degradation**: If `UPSTASH_REDIS_REST_URL` is not set, Redis layer is fully disabled — app runs in memory-only mode (identical to v9.0.x).
- **22 new tests** (`test_redis_cache.py`): Redis disabled, enabled, 6 fallback scenarios (connection lost, timeout, corrupted data, bad credentials), key format, stampede guard compatibility.

### New Env Vars (Optional — app works without them)
| Key | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |

### New Dependency
- `upstash-redis>=1.1.0` (REST-based — no TCP socket needed)

### Breaking Changes
- None

---

## v9.0.1 — 2026-06-10 (Performance — Cache Stampede + Dashboard + Call Logs)
**Deploy:** `develop → staging → main` | **Type:** Performance / Hardening

### Improvements
- **Cache stampede protection** (`cache.py`): Added `claim_inflight / wait_inflight / release_inflight` guards to `/api/admin/users` and `/api/leaderboard`. Under concurrent load, only the first worker computes on a cache miss — others wait (max 3s) then get the warm value. Eliminates the 7s P95 spike caused by all workers firing parallel aggregate queries simultaneously after deployment.
- **Extended cache TTLs**: `users` namespace 30s → 120s; `leaderboard` 60s → 120s. Reduces stampede frequency 4× with no UX impact (write routes still invalidate immediately).
- **Dashboard double-scan eliminated** (`lead_routes.py`): `get_dashboard_stats` previously called `_build_lead_query()` twice — once for active status counts, once for `parked_count`. Now uses a single `GROUP BY status` over all leads and derives both active counts and parked count in Python. Removes one full 12,721-row table scan per dashboard load.
- **Call logs SQL refactor** (`admin_routes.py`): Replaced Python `known_user_ids` set (extra DB roundtrip + large `IN (...)` literal) with a SQL subquery. Removes 2 extra roundtrips on every call-logs page load.
- **New index** (`migrations.py`): `idx_call_logs_called_at ON call_logs (called_at DESC)` — enables index scan for Super Admin ORDER BY path that cannot use the composite `(user_id, called_at)` index.

### Bug Fixes
- None

### Breaking Changes
- None

---

## v9.0.0 — 2026-06-09 (Full Pod Admin Scoping — All Surfaces)

**Deploy:** `develop → staging → main` | **Commit:** `10fc5ab` | **Type:** Feature / Major

### Overview
Pod Admins previously saw all org-wide data on the Dashboard, Leaderboard, Activity Feed,
Daily Digest, and Analytics Metrics — creating confusion when managing their own pod pipeline.
This release extends the pod scoping pattern (introduced in v8.9.11 for the Leads page) to
ALL remaining surfaces. A Global/My Pod toggle is added to Dashboard, Leaderboard, and Activity
Feed. Daily Digest and Metrics are always auto-scoped (no toggle needed per product decision).

### New Features

#### Backend
- **`leaderboard_routes.py`** — `global_view` param + `pod_id` filter on SDR and AE leaderboard
  endpoints; cache key now includes `pod_id + global_view` to prevent cross-pod cache pollution
- **`lead_routes.py`** — Dashboard activity feed widget (`GET /api/leads/activity-feed`) pod-scoped
  via `EXISTS` subquery on `lead_assignments` table; `global_view=True` bypasses scoping
- **`activity_feed_routes.py`** — `global_view=True` param bypasses pod scope for full admin feed;
  `pod_id` URL param takes priority over `global_view` (edge case A-2 preserved)
- **`analytics_digest_routes.py`** — Auth changed from `require_super_admin` to `require_admin`
  (Pod Admin now has access); SDR list, `new_leads_today`, and `stuck_leads_count` all
  pod-filtered; cache key now includes `pod_id`
- **`metrics_routes.py`** — All 3 endpoints (summary, daily-trend, sdr-table) filter `sdr_ids`
  by pod when caller is Pod Admin; always auto-scoped (no toggle)

#### Frontend
- **`api.js`** — `global_view` param added to `fetchDashboardStats`, `fetchActivityFeed`,
  `fetchLeaderboard`, `fetchAELeaderboard`
- **`dashboard.js`** — 🔒 My Pod / 🌐 Global toggle pill (Pod Admin only); `dashboard_view_state`
  sessionStorage key (independent from leads page); all 3 async loaders pass `globalView`
- **`leaderboard.js`** — Toggle pill in controls bar; `leaderboard_view_state` sessionStorage key;
  empty pod shows friendly "No SDRs in your pod yet. Switch to Global" message
- **`activity_feed.js`** — Toggle pill in header row next to Export CSV; `global_view` added to
  `_state` (auto-serialized into API params via URLSearchParams loop); `activity_view_state` key

### Tests
- **`backend/tests/test_v9_pod_admin_scoping.py`** — 16 new tests:
  - L-1 to L-5: Leaderboard SDR/AE pod scoping and global_view toggle
  - AF-1 to AF-3: Dashboard activity feed pod scoping and unassigned lead edge case
  - AA-1 to AA-2: Admin activity feed global_view bypass and pod_id priority edge case
  - DD-1 to DD-3: Daily digest SDR list, KPI, and Super Admin regression guard
  - M-1 to M-3: Metrics summary, sdr-table, and Super Admin regression guard
- **Regression:** 1,627 passed, 0 failures, 4 skipped (expected)

### Design Decisions
- Daily Digest and Metrics are **always auto-scoped** for Pod Admins (no toggle) — product decision
- AE Pods: Pod Admin with `role=Pod Admin` and `pod_id` sees only AEs in their pod on AE leaderboard
- Pod Admin with `pod_id=NULL` → empty leaderboard (safe fallback, no 500)
- Each surface uses an **independent sessionStorage key** — toggling on Dashboard doesn't affect Leads

### Breaking Changes
None — Super Admin and SDR behaviour is unchanged.

---

## v8.9.11 — 2026-06-09 (Pod Admin Lead Scoping)
**Deploy:** `develop → staging → main` ✅ | **Commit:** `8125a93` | **Type:** Feature / UX

### Overview
Pod Admins previously saw all 12,666 leads org-wide, which was confusing as they only
need visibility into their own pod's pipeline. This release scopes their view to only
the leads relevant to their pod, using a hybrid UNION query that correctly handles both
SDR pods (assigned leads) and AE pods (leads assigned after creation, where `lead.pod_id`
still reflects the originating SDR pod).

A **Pod / Global toggle** is added to the leads filter bar so Pod Admins can optionally
switch to an org-wide view without logging in as Super Admin.

### Changes

#### Backend — `backend/routes/lead_helpers.py`
- `_build_lead_query()` Pod Admin branch replaced with hybrid UNION query:
  - **Branch 1**: leads assigned to any user in the pod via `lead_assignments` JOIN
  - **Branch 2**: unassigned leads tagged to this pod (`lead.pod_id`) — round-robin pool
- Safety fallback: Pod Admin with `pod_id=NULL` in JWT token sees 0 leads
- New `global_view: bool = False` param bypasses pod scoping for the toggle

#### Backend — `backend/routes/lead_routes.py`
- `GET /api/leads` — adds `global_view` query param
- `GET /api/leads/dashboard-stats` — adds `global_view` query param; cache key updated
- `GET /api/leads/kanban` — adds `global_view` query param
- Parked count in dashboard-stats also respects `global_view`

#### Frontend — `frontend/js/api.js`
- `fetchLeads()` accepts `global_view` param and appends `?global_view=true` when set

#### Frontend — `frontend/js/views/lead_list.js`
- `🔒 My Pod / 🌐 Global` pill toggle rendered in filter bar for Pod Admins only
- Toggle state persisted in `sessionStorage` across navigations
- Both paginated fetch and nav-preload fetch pass `global_view`

### Tests
- `backend/tests/conftest.py` — `create_test_lead()` factory now accepts `pod_id=None`
- **NEW**: `backend/tests/test_pod_admin_lead_scoping.py` — 18 tests across 5 groups:
  - **A — Core Scoping** (5): pod member's lead visible, other-pod lead hidden,
    unassigned pod-tagged lead visible, null-pod lead hidden, null-pod admin sees nothing
  - **B — Cross-Role Isolation** (3): Super Admin unaffected, SDR unaffected,
    cross-pod lead visible to both Pod Admins
  - **C — Endpoint Coverage** (4): dashboard-stats, kanban, company autocomplete, search
  - **D — AE Pod Edge Cases** (3): zero leads before assignment, lead visible after AE
    assigned (even if lead.pod_id = SDR pod), AE pod admin cannot see SDR pipeline
  - **E — Global Toggle** (3): true bypasses scope, false enforces scope, dashboard totals

**Test results**: 18 new tests pass. Full suite: **1,593 passed, 0 failures**.

### Edge Cases Verified
| Edge Case | Outcome |
|---|---|
| Lead re-assigned between pods | Old PA loses it, new PA gains it (cache TTL 30s) |
| Cross-pod lead (assigned to 2 pods) | Both Pod Admins see it via UNION/DISTINCT |
| AE Pod Admin before any assignments | Sees 0 leads ✅ |
| AE Pod Admin after AE gets a lead | Sees it via `lead_assignments` JOIN ✅ |
| Pod Admin with `pod_id=NULL` (misconfigured) | Sees 0 leads (safe fallback) ✅ |
| 682 NULL-pod unassigned leads | Not visible to any Pod Admin — Super Admin pool only ✅ |
| Direct URL `/api/leads/{id}` for out-of-pod lead | Still accessible (UX scoping, not security gate) |

### Indexes Used
- `idx_lead_assignments_user_id` — Branch 1 JOIN (in prod since v8.9.9)
- `idx_leads_pod_id` — Branch 2 filter (in prod since v8.9.9)
- No new migrations required.

---

## v8.9.9 — 2026-06-09 (Phase 3: TTL Caching Layer + Index Completions)

**Deploy:** `develop → staging → main` | **Commit:** `d5bce10` | **Type:** Performance / Infrastructure

### Overview
Phase 3 of the API & Query Performance initiative. Introduces an in-process TTL cache that
eliminates repeated database work for read-heavy endpoints. All 7 monitored endpoints now
meet their server-side P50 targets (measured via `perf_metrics` inside Render Ohio datacenter,
no network latency included).

### Server-Side P50 Results (staging verification — 09 Jun 2026)

| Endpoint | Before | After | Target | Result |
|---|---|---|---|---|
| `GET /api/leads/dashboard-stats` | 596ms | **2ms** | <150ms | ✅ 1% |
| `GET /api/leaderboard` | 528ms | **3ms** | <200ms | ✅ 1% |
| `GET /api/leads` | 1,326ms | **4ms** | <200ms | ✅ 2% |
| `GET /api/leads/my` | 866ms | **5ms** | <200ms | ✅ 2% |
| `GET /api/admin/users` | 907ms | **5ms** | <300ms | ✅ 1% |
| `GET /api/leads/activity-feed` | 351ms | **8ms** | <150ms | ✅ 5% |
| `GET /api/admin/call-logs` | 518ms | **20ms** | <250ms | ✅ 8% |

P95 spikes (up to 1s on `leads`) are the single cold request every 15-20s that warms the
cache. All subsequent requests within the TTL window return in 2-20ms server-side.

### New Files
- **`backend/cache.py`** — Thread-safe in-process TTL cache. Namespaces: `dashboard` (30s),
  `leaderboard` (60s), `users` (30s), `leads_page` (15s), `my_leads` (20s), `call_logs` (15s),
  `activity` (20s), `leads_count` (30s). Falls back gracefully in test mode (SQLite).

### Modified Files

#### `backend/routes/lead_routes.py`
- `GET /api/leads`: full-page result cached 15s keyed by user+role+pod+page+all filters.
  Cache check runs before `_batch_company_resolutions` + `_batch_latest_activity` (saves ~320ms).
- `GET /api/leads/my`: full-page result cached 20s per SDR+page+filters (saves ~480ms).
- `create_lead`, `update_lead`, `move_lead_kanban`: all invalidate `leads_page`, `my_leads`,
  `leads_count`, and `dashboard` caches immediately on mutation so stale data is never served.

#### `backend/routes/leaderboard_routes.py`
- 60s TTL cache on `GET /api/leaderboard` (keyed by date range).

#### `backend/routes/admin_user_routes.py`
- 30s TTL cache on `GET /api/admin/users`.

#### `backend/routes/call_routes.py`
- 15s TTL cache on `GET /api/admin/call-logs`.

#### `backend/migrations.py`
- Added **v8.9.9-perf2** section with 6 indexes that were applied to staging DB during load
  testing but were missing from `migrations.py` (production DB gap now closed):
  - Dropped old `idx_leads_company_lower` (used `lower(company)` — TRIM mismatch with all queries)
  - `idx_leads_company_lower_trim` — `lower(trim(company))` — fixes company resolution Q1
  - `idx_leads_status_company` — compound partial index for Meeting Scheduled lookup
  - `idx_notes_lead_id` — critical missing index for `_batch_latest_activity`
  - `idx_login_logs_stale` — partial index for stale session background query
  - `idx_leads_company_sort` — index-only sort for `ORDER BY lower(coalesce(company,''))`
  - `idx_lead_assignments_lead_created` — join table for count subquery

#### `Dockerfile`
- Single Uvicorn worker (`--workers` flag removed) — in-process cache requires shared memory.

#### `backend/requirements.txt`
- `cachetools` and `faker` fixed to separate lines (build failure root cause).

### Breaking Changes
None. Cache TTLs are short (15-60s). Mutations invalidate immediately. Tests use SQLite
which bypasses the cache — no test behaviour changes. 1,593 tests passing.

### Verified on Staging
Yes — `/api/health/deep` → `db_tables_accessible: true`, startup_complete: true ✅
Server-side P50 verified via `perf_metrics` table — all 7 targets met ✅

### Rollback commit
`9c434ef` (staging pre-perf, v8.9.8)

---

## v8.9.8 — 2026-06-09 (Phase 2: DB Index Optimisation + dashboard-stats Query Merge)
**Deploy:** `develop → staging → main` | **Commit:** `518252a` | **Type:** Performance / Infrastructure

### Overview
Phase 2 of the API & Query Performance initiative. Adds 13 zero-downtime database indexes
targeting the 5 highest-latency endpoints identified in Phase 1 (RAIL middleware data).
Also merges the redundant `base.count()` round-trip out of `dashboard-stats`.

### Indexes Added (`migrations/db_indexes.py`)

All indexes use `CREATE INDEX CONCURRENTLY IF NOT EXISTS` — zero table locks, idempotent on re-deploy.

#### B-tree composite indexes (9)
| Index | Table | Columns | Targets |
|-------|-------|---------|---------|
| `idx_leads_user_status` | `leads` | `(assigned_to, status)` | `dashboard-stats`, `leads/my` |
| `idx_leads_team_status` | `leads` | `(team_id, status)` | `dashboard-stats` (team view) |
| `idx_leads_created_at` | `leads` | `(created_at DESC)` | `GET /api/leads` pagination |
| `idx_leads_assigned_created` | `leads` | `(assigned_to, created_at DESC)` | SDR lead list |
| `idx_call_logs_user_created` | `call_logs` | `(user_id, created_at)` | `leaderboard` aggregation |
| `idx_call_logs_user_status_created` | `call_logs` | `(user_id, status, created_at)` | `analytics/sdr-table` |
| `idx_dialer_calls_user_created` | `dialer_calls` | `(user_id, created_at)` | `sdr/call-summary` |
| `idx_lead_assignments_lead` | `lead_assignments` | `(lead_id)` | Assignment lookups |
| `idx_lead_assignments_user` | `lead_assignments` | `(user_id, assigned_at DESC)` | SDR workload views |

#### GIN trigram indexes (4)
Requires `pg_trgm` extension (auto-created by migration).

| Index | Table | Column | Targets |
|-------|-------|--------|---------|
| `idx_leads_first_name_trgm` | `leads` | `first_name` | `GET /api/search` ILIKE |
| `idx_leads_last_name_trgm` | `leads` | `last_name` | `GET /api/search` ILIKE |
| `idx_leads_email_trgm` | `leads` | `email` | `GET /api/search` ILIKE |
| `idx_leads_company_trgm` | `leads` | `company` | `GET /api/search` ILIKE + `GET /api/leads/companies` |

### Query Optimisation
- **`routes/analytics_routes.py` — `dashboard-stats`:** Removed redundant `base.count()` call that
  fired a full table scan on every request before the paginated query. Saves 1 full-table scan per
  `dashboard-stats` call (the highest-volume endpoint: ~20 calls/session).

### Expected Latency Impact (vs Phase 1 baseline on prod)
| Endpoint | Before | Expected After |
|----------|--------|---------------|
| `GET /api/leads/dashboard-stats` | ~1,090ms | ~200–400ms |
| `GET /api/leaderboard` | ~1,034ms | ~300–500ms |
| `GET /api/leads/my` | ~1,827ms | ~400–700ms |
| `GET /api/search` | ~530ms | ~100–200ms |

### Breaking Changes
None. Index creation is fully online (`CONCURRENTLY`). No column changes, no data migrations.

### Test Results
1,593 passed, 0 failed. 13 stale `test_root_cause_fixes.py` tests updated to reflect the
redesigned `sanitize_preview` behaviour (removed 200-char truncation + quote stripping).

---

## v8.10.0 — 2026-06-08 (Email Hub — React Rebuild + Open Tracking Fix)
**Deploy:** `develop → staging` | **Commit:** `478fb6b` | **Type:** Feature + Bug Fix

### Overview
Complete overhaul of the Email tab in two stages:

**Stage 1 — Backend fixes:**
- Fixed unreliable open tracking: replaced `raw_count <= 1` skip heuristic with a
  10-second time-gate to correctly differentiate sender previews from real lead opens
- Full mailbox sync (`_sync_full_mailbox`, 30-day lookback) now captures Gmail-direct
  outbound emails that were never appearing in the Email tab
- Inbound fallback: auto-creates thread records for Gmail replies that bypassed
  the Nylas webhook thread mapping
- 21 new backend tests covering tracking, sync edge cases, and inbound fallback

**Stage 2 — React Email Hub (IIFE bundle, 207 KB):**
- Split-pane layout: thread sidebar (left) + message thread (right)
- Colour-coded bubbles: outbound blue / inbound grey with DOMParser HTML rendering
- Quoted-text expand/collapse toggle (strips "On ... wrote:" sections)
- TrackingBadge: `👁 Opened Nx · Xh ago` / `✓ Sent` pills
- AttachmentChip: download with file-type icons
- ReplyComposer: collapsed inline, auto-scrolls, body preserved on send failure
- ComposeDrawer: full new email form with attachments
- 30-second polling via `useEmails` hook with cleanup on unmount
- Edge cases: not configured, not connected, no lead email, empty state, API error
- `window.EmailHub.mount/navigate/unmount` contract (same as AnalyticsHub)

---

## v8.9.7 — 2026-06-08 (Analytics Hub — Export Download Fix)
**Deploy:** `develop → staging → main` | **Commit:** `bdefcb1` | **Type:** Bug Fix

### Overview
Clicking the Export button in the Analytics Hub was navigating the browser tab
**away** from the app to `/api/admin/analytics/export?...`, loading a raw CSV URL.
This caused all JS assets (app.js, analytics-hub.js, dialer_machine.js, etc.) to
404 because the browser's base path switched to `/api/admin/analytics/`. The app
was broken until the user manually navigated back.

### Root Cause
`downloadCsv` used `window.open(url, '_self')` which replaces the current SPA
context with the CSV URL. The old `?token=` query param approach also exposed
the JWT in server access logs and browser history.

### Fix
#### `frontend-react/src/services/api.js`
- Replaced `window.open('...', '_self')` with `fetch()` → Blob → `<a download>` click.
- Browser stays on the SPA; CSV downloads as a file.
- Auth now uses `Authorization: Bearer <token>` header (not `?token=` in URL).
- `Content-Disposition` filename from server response is used for the download filename.
- Error handling: shows `alert()` if the fetch fails (e.g. network error).

### Bundle Rebuilt
- `frontend/js/analytics-hub.js` 486 kB (fetch+Blob download included)

### Breaking Changes
None. Frontend-only change. Backend `/api/admin/analytics/export` endpoint unchanged.

---

## v8.9.6 — 2026-06-08 (Analytics Hub — Navigate Re-render Cascade Fix)
**Deploy:** `develop → staging → main` | **Commit:** `7a83b5a` | **Type:** Performance / Bug Fix

### Overview
Follow-up fix after Chrome DevTools live verification revealed one remaining extra API call
on navigate-back. Root cause: `navigate()` called `_root.render(<AnalyticsHub {...props} />)`,
which re-rendered `AnalyticsHub` and created a **new `setFilters` function reference** on every
call. `DashboardTab`'s `useEffect([filters, onFiltersChange])` saw a new `onFiltersChange` → fired
again → triggered a second `loadAll()`.

### Fix
#### `frontend-react/src/pages/Analytics/AnalyticsHub.jsx`
- Wrapped `setFilters` in `useCallback([], [])` as `stableSetFilters` — stable reference across
  all re-renders. Passed as `onFiltersChange={stableSetFilters}` to `DashboardTab`.
- `onFiltersChange` reference is now stable → `useEffect([filters, onFiltersChange])` in
  `DashboardTab` no longer fires on navigate-back.

### Bundle
- Rebuilt: `analytics-hub.js` 486 kB / `analytics-hub.css` 56 kB

### Verification (Chrome DevTools MCP — Live on Prod)
- Initial load: `/api/admin/analytics/funnel` = **1 call** ✅
- After 2× navigate-away + back: **0 additional funnel calls** ✅
- `hasNavigate: true`, `isMounted: true`, CSS `?v=20260608b` confirmed ✅

### Breaking Changes
None.

---

## v8.9.5 — 2026-06-08 (Analytics Hub — Double Load Elimination: R-3, D-2, D-5, C-3)
**Deploy:** `develop → staging → main` | **Commit:** `9a308ce` | **Type:** Performance / Bug Fix

### Overview
Chrome DevTools MCP audit (`performance.getEntriesByType('resource')`) confirmed the Analytics
Hub was making **6× funnel/sdr-table/trend/AI calls** per session. Three distinct root causes
identified by timestamp analysis and fixed simultaneously.

### Root Causes & Fixes

#### R-3 — Unconditional `unmount()` in `app.js` (navigate-back remount)
- **Before:** `window.AnalyticsHub?.unmount()` ran at the top of every `loadView()` call,
  including when navigating TO analytics. Every return visit destroyed the React tree and
  forced a full remount + all API calls.
- **Fix (`frontend/js/app.js`):** `unmount()` now only fires when `viewName !== 'analytics'`
  (i.e. when genuinely leaving). On navigate-back, calls the new `navigate()` method instead.

#### R-3 — `navigate(container, props)` method (analytics-entry.jsx)
- **New:** `window.AnalyticsHub.navigate(container, props)` — calls `_root.render()` on the
  existing root to update props without teardown. Falls back to `mount()` if not initialised.
- **New:** `window.AnalyticsHub.isMounted` getter — lets `app.js` check state without importing React.

#### D-5 — `pods` in `filters` useMemo deps (DashboardTab.jsx)
- **Before:** `filters` depended on `pods` (async-loaded after mount). When pods resolved,
  `filters` became a new object → `loadAll()` fired a second time per session.
- **Fix:** Removed `pods` from `filters` useMemo. Pod name resolved in a separate `podName`
  memo (stable, doesn't affect API filters). `breadcrumb` uses `podName` directly.

#### D-2 — AI recommendation fires on every filter change (DashboardTab.jsx)
- **Before:** `useEffect` dep was `[funnel]` — `funnel` is a new object reference on every
  `loadAll()` even with identical values → Groq AI POST fired on every data load.
- **Fix:** Deps changed to `[filterKey]` where `filterKey = JSON.stringify(filters)`.
  AI recommendation now fires only when filters actually change.

#### C-3 — No cache buster on CSS `<link>` (index.html)
- **Before:** `<link rel="stylesheet" href="js/analytics-hub.css">` — no versioning, browsers
  serve stale CSS after deploys.
- **Fix:** `?v=20260608b` added. JS bundle version also bumped to `20260608b`.

### Files Changed
| File | Change |
|---|---|
| `frontend/js/app.js` | Conditional `unmount()` + `navigate()` path |
| `frontend-react/src/analytics-entry.jsx` | `navigate()` method + `isMounted` getter |
| `frontend-react/src/pages/Analytics/DashboardTab.jsx` | D-5 pods dep + D-2 filterKey dep |
| `frontend/index.html` | CSS cache buster `?v=20260608b` |
| `frontend/js/analytics-hub.js` | Rebuilt bundle (486 kB) |
| `frontend/js/analytics-hub.css` | Rebuilt CSS (56 kB) with cache buster |

### API Call Reduction
| Endpoint | Before | After |
|---|---|---|
| `/api/admin/analytics/funnel` | 6× | 1× |
| `/api/admin/analytics/sdr-table` | 6× | 1× |
| `/api/admin/analytics/trend` | 6× | 1× |
| `/api/admin/analytics/ai-recommendation` | 4× | 1× per filter change |

### Breaking Changes
None.

---

## v8.9.5-test — 2026-06-08 (Analytics Hub — Edge Case Test Suite)
**Deploy:** `develop → staging → main` | **Commit:** `d246b36` | **Type:** Tests

### Overview
New test file `backend/tests/test_analytics_hub_edge_cases.py` (636 lines, 19 tests) covering
gaps identified during the full Analytics Hub security and performance audit.

### New Tests (19)

| ID | Category | What it tests |
|---|---|---|
| CU-1 | Cross-user isolation | Pod Admin cannot pin another user's report (403) |
| CU-2 | Cross-user isolation | Pod Admin cannot delete another user's report (403) |
| CU-3 | Cross-user isolation | Pod Admin cannot run another user's saved report (403) |
| CU-4 | Cross-user isolation | Super Admin CAN pin any user's report (positive case) |
| CU-5 | Cross-user isolation | Pinned list only shows requesting user's own pins |
| PL-1 | Pin lifecycle | Unpin → re-pin gets a fresh `pin_order` |
| PL-2 | Pin lifecycle | PIN_LIMIT slot freed after unpin allows new pin |
| PL-3 | Pin lifecycle | PIN_LIMIT slot freed after delete allows new pin |
| PL-4 | Pin lifecycle | Re-pinned report ordering documented (known count-based limitation) |
| PL-5 | Pin lifecycle | Pinned list is stable ascending by `pin_order` |
| FC-1 | Filter context | `filter_pod` injected into DSL when LLM omits it |
| FC-2 | Filter context | LLM's `filter_pod` not overwritten by UI value |
| FC-3 | Filter context | `filter_batch` injected into DSL when LLM omits it |
| FC-4 | Filter context | Both `filter_pod` and `filter_batch` injected together |
| SD-1 | skip_dsl_validation | `skip=True` + valid DSL saves successfully |
| SD-2 | skip_dsl_validation | `skip=False` rejects bad/unknown metric DSL |
| SD-3 | skip_dsl_validation | `skip=True` + empty DSL `{}` saves (auto-pin use case) |
| CA-1 | Cache key isolation | 30D returns ≥ count vs 7D (no cache collision) |
| CA-2 | Cache key isolation | `preset=all` and no preset return identical counts |

### Test Count
- **Before:** 117 passing, 2 xfailed
- **After:** 136 passing, 2 xfailed (+19)

### Breaking Changes
None. Tests only.

---

## v8.9.4 — 2026-06-08 (Phase 1: API & Query Performance Observability)
**Deploy:** `develop → staging → main` | **Branch:** `develop` | **Type:** Infrastructure / Internal

### Overview
Phase 1 of the API & Query Performance Benchmarking initiative. Adds production-grade
observability to every HTTP request and SQL statement with zero behaviour change to
existing API logic. Data collected over the next 3–5 days will drive Phase 2 (DB indexes)
and Phase 3 (query rewrites).

### New Files
- **`backend/middleware/timing.py`** — `TimingMiddleware`: wraps every request, logs duration
  using Google RAIL-model tiers (`< 100ms OK`, `100–300ms acceptable`, `300ms–1s SLOW WARNING`,
  `> 1s CRITICAL ERROR`). Adds `X-Response-Time` header to all responses. Maintains an
  in-process rolling window (1,000 samples/endpoint) for P50/P95/P99 percentile tracking.
  Excludes SSE (`/api/calls/events`) and health endpoints from timing.
- **`backend/query_logger.py`** — SQLAlchemy `before/after_cursor_execute` event hooks:
  logs any SQL statement taking `> 50ms` with full SQL preview and param count. Tracks
  per-request query count — emits `[N+1 RISK]` warning when `> 8 queries/request`.
  Keeps in-memory ring buffer of last 200 slow queries for the Phase 4 perf summary.
  Full trace mode enabled via `SLOW_QUERY_LOG=true` env var.

### Modified Files
- **`backend/middleware/__init__.py`** — Extended `attach_profiler()` (already called from
  `main.py`) to always wire `TimingMiddleware` and `query_logger` at startup. The legacy
  `QUERY_PROFILING=true` opt-in profiler path is preserved.

### Tests
- **`backend/tests/test_middleware.py`** — 14 new tests: header injection, skip logic,
  endpoint key normalisation (numeric/UUID path params → `{id}`), rolling window bounds,
  P95 sort order. Full suite: 1,555 passed, 0 failed.

### What to watch in Render logs
```
[PERF] GET /api/admin/analytics/funnel 200 1842ms P=CRITICAL
[PERF] POST /api/calls/start 200 87ms P=OK
[SLOW SQL] 63ms | path=/api/admin/analytics/sdr-table | sql=SELECT COUNT(*) ...
[N+1 RISK] 9 DB queries on single request path=/api/leads
```

### Breaking Changes
None. Pure instrumentation.

---

## v8.9.3 — 2026-06-08 (EC-17: Wrong Provider Label in Error Logs)
**Deploy:** `develop → staging → main` | **Branch:** `develop` | **Type:** Patch (Bug Fix)

### Overview
Aircall call failures were being logged as **"RCM Dialer"** in System Logs → Error Logs,
confusing admins into thinking RCM was the culprit. Root cause: the double-call prevention
guard returned early without a `"provider"` key in its result dict — the error logger then fell back
to the hardcoded default `'RCM'`.

### Bug Fix

#### Backend
- **`dialer_service.py`** — `initiate_call()` now captures `_provider_name = provider.provider_name`
  immediately after the provider is resolved. The double-call guard's early-return dict now includes
  `"provider": _provider_name` so callers always receive the correct label (EC-17 / RCA-2026-06-08).
- **`routes/dialer_routes.py`** — Hardcoded fallback in `log_error(feature=...)` changed from
  `'RCM'` → `'Unknown'` as belt-and-suspenders: if provider is ever absent from the result
  dict for any future reason, the error log is honest rather than misleading.

### Root Cause
The `initiate_call()` double-call guard (added in v8.9.2 EC-16) returned:
```python
{"success": False, "error": "You already have an active call in progress..."}
```
No `"provider"` key. The error logger at `dialer_routes.py:114` did:
```python
feature=f"{result.get('provider', 'RCM')} Dialer"
```
`result.get('provider')` → `None` → fell back to `'RCM'` → wrong label for every Aircall
double-call block event.

### Tests
- No new tests required — existing `TestCallStartSeverityLogging` and `TestEC16StaleCallGuard`
  suites cover the affected code paths. **68 + 40 = 108 tests passing, 0 failures** ✅

---

## v8.9.2 — 2026-06-04 (Dialer Reliability — EC-16 Zombie Call Guard)
**Deploy:** `develop → staging → main` | **Branch:** `develop` | **Type:** Patch (Bug Fix)

### Overview
Urgent patch for a false-positive double-call prevention block (EC-16). SDRs were hitting
_"You already have an active call in progress"_ when there was NO active call — caused by a
stale `CALL_STARTED` database record whose `CALL_ENDED` webhook was never delivered. Three
compounding system gaps were identified and fixed.

### Bug Fixes

#### Backend
- **`dialer_service.py`** — `initiate_call()` double-call guard now has a **90-minute staleness
  window**. If the existing `CALL_STARTED`/`CALL_ANSWERED` record is ≥ 90 min old (webhook never
  arrived), it is auto-healed to `CALL_ENDED` and the new call proceeds. Records < 90 min old
  still block (correct behaviour preserved). Previously one missed webhook permanently blocked
  the SDR from dialling from any future session.
- **`scheduled_jobs.py`** — `_rcm_nightly_sync()` dedup logic fixed. When the nightly
  RCM history sync found an existing record by `provider_call_id`, it was silently
  skipping it (`skipped_dup += 1; continue`) regardless of whether the DB status was stale.
  It now checks: if the DB record is non-terminal (`CALL_STARTED`/`CALL_ANSWERED`) but RCM
  history shows `CALL_ENDED` → update the record (zombie-heal). `healed_zombie` counter added
  to the sync completion log.
- **`scheduled_jobs.py`** — New `_sweep_stale_calls()` background job added. Runs every **15
  minutes**. Finds all `DialerCall` records with status `CALL_STARTED`/`CALL_ANSWERED` and no
  `ended_at` that are ≥ 90 min old → marks them `CALL_ENDED`. This proactively catches any
  future webhook delivery failures before the next call attempt. Logged at WARNING level so
  healing events are visible in Render logs.

### Root Cause
SDRs who close their browser mid-call, lose connectivity, or whose provider webhook is dropped
end up with a `DialerCall` stuck in `CALL_STARTED`. Guard 2 (50-second timeout) only fires
during active frontend polling — if the tab is closed, nothing clears the record. EC-16 hit
Vanshika Koli multiple times in one session (she had to switch to Klenty).

### Testing
- 4 new EC-16 regression tests added to `test_dialer_routes.py` (`TestEC16StaleCallGuard`)
- Full suite: **1541 passed, 0 failed** (was 1499+4 new EC-16 + 38 pre-existing additions)

---

## v8.9.1 — 2026-06-03 (Analytics Hub — Bug Fixes & Performance)

**Deploy:** `develop → staging → main` | **Branch:** `develop` | **Type:** Patch (Bug Fixes + Perf)

### Overview
Patch release resolving 5 bugs found in v8.9.0 Analytics Hub session testing, plus 3 targeted backend performance improvements that significantly reduce dashboard load time.

### Bug Fixes

#### Backend
- **`smart_analytics_routes.py`** — Query endpoint now returns `{...result, "dsl": dsl}` so the frontend captures the resolved DSL for save/pin; previously `data.dsl` was always `undefined` causing every pin attempt to fail with `400 "Invalid DSL"`.
- **`smart_analytics_routes.py`** — `SaveReportRequest` adds `skip_dsl_validation: bool = False`; the auto-pin save flow passes `skip_dsl_validation=true` so the NL query (source of truth for re-runs) is saved even when the DSL contains multi/compare/funnel structures that the strict validator would reject.
- **`analytics_routes.py`** — Research metrics query: 6 separate `.count()` round-trips collapsed into 1 SQL query using `COUNT(CASE WHEN ... THEN id END)` — eliminates 5 redundant DB queries per `/funnel` call.
- **`analytics_routes.py`** — Cache TTL increased from 2 min → 10 min (dashboard metrics are fine at 10-min staleness; frequent cache misses were causing every page reload to re-run all heavy queries).
- **`analytics_ai_routes.py`** — AI Recommendation endpoint made non-blocking: sync `httpx` Groq call (up to 12s) now runs in a daemon thread; endpoint returns `null` immediately on cache miss and warms the cache in background. Eliminates up to 12s blocking from the critical dashboard render path.

#### Frontend
- **`api.js`** — `saveReport()` accepts optional `skipDslValidation` parameter (5th arg, default `false`).
- **`AskAiTab.jsx`** — Multi-mode result parsing rewrite:
  - `mode: "multi"` → `multiSections[]` (per-metric chart + table), previously rendered as garbled flat table or "No data"
  - `mode: "compare"` → mapped `comparisons[]` to `[{sdr, value}]` rows
  - `mode: "funnel"` → `Object.entries(steps)` to `[{label, value}]` rows (steps is a dict, not array)
  - `mode: "pod_summary"` → `data.pods` array
  - No-data fallback now correctly guards on `multi_sections` presence
  - Backend `message` field (e.g. `batch_not_found`) rendered as amber banner
- **`AskAiTab.jsx`** — Button consistency: "Save Report" now has a proper outlined pill style (border, bg-white, px-3 py-1.5, rounded-lg) matching "Pin to Dashboard" in height and font-weight
- **`AskAiTab.jsx`** — `SavedReportItem` redesigned: title shows a human label (truncated to 40 chars if same as query); subtitle only rendered when it adds info; pinned badge shown; delete on hover only (cleaner sidebar)
- **`AskAiTab.jsx`** — `handlePinReport` passes `skipDslValidation=true` to auto-save so pin no longer fails with 400

### Performance Summary
| Metric | Before | After |
|--------|--------|-------|
| Research SQL queries | 6 | 1 |
| Analytics cache TTL | 2 min | 10 min |
| AI Rec response time | Up to 12s (blocking) | ~0ms (non-blocking, returns null) |

### Migration Notes
- No schema changes — pure code fixes

### Tests
- All backend tests pass (run `pytest backend/tests/ -x -q`)
- Staging health checks green

---

## v8.9.0 — 2026-06-03 (Pinned AI Reports — Customizable Dashboard)
**Deploy:** `develop → staging` | **Branch:** `develop` | **Type:** Feature (Frontend + Backend)

### Overview
Admins can now **pin any AI query result to the Dashboard tab**, turning it into a persistent live card. The Dashboard tab now shows personalized BI cards at the top — refreshable on demand and unpinnable in one click.

### Changes

#### Backend
- **`models.py`**: Added `is_pinned` (Boolean, default `false`) + `pin_order` (Integer, default `0`) to `AnalyticsSavedReport`
- **`migrations.py`**: V42 — 2 idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` entries; safe on SQLite (dev) and PostgreSQL (prod)
- **`smart_analytics_routes.py`**:
  - `PATCH /api/admin/smart-analytics/reports/{id}/pin` — toggle `is_pinned`; cap at 5 per user; idempotent; ownership enforced (403 on cross-user pin attempt)
  - `GET /api/admin/smart-analytics/reports/pinned` — list current user's pinned reports ordered by `pin_order ASC`
  - `GET /api/admin/smart-analytics/reports` — now includes `is_pinned` and `pin_order` in every item

#### Backend Tests
- 15 new tests in `TestPinnedReports` (pin, unpin, 404, 403, cap, idempotency, list, delete clearing pin, ordering)
- **80/80 pass — 0 regressions**

#### Frontend
- **`PinnedReports.jsx`** (new): Fetches pinned reports, re-runs each via `POST /reports/{id}/run` for fresh data, renders premium cards with Refresh (🔄) + Unpin (✕) per card; per-card error state; skeleton loader; renders nothing if 0 pins
- **`AskAiTab.jsx`**: Replaced "Show in Dashboard →" with "📌 Pin to Dashboard" button — auto-saves report if unsaved, calls PATCH /pin, shows inline toast; button shows "Pinned ✓" and disables after success; resets on new query
- **`DashboardTab.jsx`**: Imports and renders `<PinnedReports>` above the KPI cards section; re-mounts when `pinRefresh` counter changes
- **`AnalyticsHub.jsx`**: `onPinSuccess` callback from AskAiTab → bumps `pinRefresh` counter + switches to Dashboard tab so user sees their pinned card immediately
- **`api.js`**: `pinReport(id, pinned)` + `getPinnedReports()` added to `SmartAnalyticsService`
- **`analytics-tailwind.css`**: Full styles for `.pinned-reports-section`, `.pinned-card`, `.pinned-card-*` (hover lift, shimmer skeleton, error/empty states)

### Edge Cases Handled
- **EC-1**: Delete report → removed from pinned list automatically (no orphaned cards)
- **EC-2/3**: Re-run failure → per-card error state; stale data shown with warning
- **EC-4**: Max 5 pinned reports per user; 6th attempt returns `400 pin_limit_exceeded`
- **EC-5**: Pinned state is user-scoped; no cross-admin leakage
- **EC-6**: Pin/unpin is fully idempotent
- **EC-7**: Auto-save failure → error toast, no pin
- **EC-10**: 0 pinned reports → PinnedReports section renders nothing
- **EC-11/12**: `chart_type: null` or malformed data → table fallback; guard before chart render

### Migration Notes
- `is_pinned BOOLEAN DEFAULT false` — all existing rows get `false` (no data change)
- `pin_order INTEGER DEFAULT 0` — all existing rows get `0` (no data change)
- Runs automatically on backend startup; idempotent on re-deploy

### Verification Plan
```bash
cd backend && python3 -m pytest tests/test_smart_analytics.py -v -k "pin" --tb=short
# Expected: 15 passed, 0 failed
```
Manual: Pin a report from Ask AI → verify card appears on Dashboard → refresh → unpin → card gone

---

## v8.8.0 — 2026-06-03 (AE Role + Analytics Hub Feature Parity)
**Deploy:** `develop → staging` | **Branch:** `develop` | **Type:** Feature (Frontend + Backend)

### Changes

#### Backend — AE Role (all items from implementation plan completed)
- `admin_user_routes.py`: `valid_roles` includes `"AE"` (create + update); pod purity check on role change; dialer config scoped to `["SDR","AE"]`
- `admin_assignment_routes.py`: AE included in auto-assign + pod-assign round-robin; `_cascade_to_pod_admin()` called on every AE assignment; cascade-unassign on AE removal
- `pod_routes.py`: Pod purity enforced on `add_pod_member` (no SDR+AE mixing); AE included in `assign_leads` distribution
- `analytics_routes.py` L905, L1316, L1440: `role.in_(["SDR","AE"])` — AEs visible in all analytics
- `analytics_digest_routes.py` L245: AE included in digest
- `leaderboard_routes.py`: New `GET /api/leaderboard/ae` endpoint
- `sdr_performance_routes.py`, `growth_intelligence_routes.py`, `error_log_routes.py`, `email_routes.py`: AE role handled correctly in all

#### Frontend — AE Role
- `auth.js`: `isSDR` flag now includes AE — all SDR gates work for AE automatically
- `admin.js`: AE in role dropdown (Add User), AE users filter, dedicated AEs tab
- `pods.js`, `assignments.js`, `upload.js`, `lead_list.js`: AE visible in all user pickers
- `leaderboard.js`: SDR/AE tab toggle — AE tab calls `/api/leaderboard/ae`
- `index.html`: AE option in Add User modal

#### Frontend — Analytics Hub Dashboard (feature parity with legacy analytics.js)
- **Activity Trend chart**: Multi-line Chart.js chart (Calls, Meetings, Research, Disqualified, Emails) with metric toggles — was completely absent from the new Analytics Hub
- **6 rich KPI cards**: Research Complete (% of assigned), Calls Made (unique leads / avg per lead), Connect Rate (Low/Strong badge), Emails Sent (open/reply rates), Disqualified (% of assigned)
- **SDR Performance table**: Connect % column (was showing wrong Conv. Rate), Inactive toggle, SDR search filter
- **Insight rule pills**: Auto-surfaced actionable patterns above KPI cards
- **Proper `normalizeFunnel`**: Maps all `research.*`, `emails.*`, `calls.*` detail fields from backend

### Migration Notes
- No DB migrations required
- No new env vars

### Verified on staging
Pending — pushed to staging branch, Render auto-deploy in progress

### Rollback commit
`eb3f10b` (the commit before the AE role work)

---

## v8.6.0 — 2026-06-02 (Analytics Hub — Global AI Query Bar + Inline AI on Analytics Page)
**Deploy:** `develop → staging → main` | **Branch:** `develop` | **Type:** Feature (Frontend only)

### Changes

#### ✨ Global AI Query Bar — topbar (Admin only)
- `frontend/index.html`: Added `#ai-query-bar` — a `✦ Ask AI` input next to the global lead search bar, visible only to admins
- `frontend/js/app.js`: Wires up the AI bar on admin login; keyboard shortcut `⌘/` (Mac) / `Ctrl+/` focuses it from anywhere; `Esc` dismisses; submit shows compact dropdown result with "Open full Analytics Hub →" link
- `frontend/js/views/smart_analytics.js`: New `export async function runAiQuery(query, resultContainer, opts)` — self-contained AI query runner used by both the topbar and the analytics page. Returns compact card with chart + table. Also exports `injectSmartAnalyticsStyles()` for early style injection.

#### ✨ Analytics Hub — AI command bar on the Analytics page
- `frontend/js/views/analytics.js`: Renamed page to "Analytics Hub". AI command bar (`✦ Ask AI`) appears at top of page, above KPI cards. Submitting a query renders an inline result card (chart + table). "✕ Clear result" and "✦ Full AI Workspace →" actions appear below the result.
- `frontend/js/app.js`: If admin navigates from the topbar "Open full Analytics Hub →" link, the pending query is picked up from `sessionStorage('ls_ai_pending_query')` and auto-run when the analytics page loads.

#### 🔗 Smart Analytics nav item retired
- `frontend/index.html` + `frontend/js/app.js`: Sidebar now shows single "Analytics Hub" entry. The Smart Analytics + Analytics nav items are hidden. All legacy hashes (`#smart-analytics`, `#metrics`, `#activity-feed`) redirect automatically to `#analytics`.
- Full Smart Analytics workspace (saved reports, history, period switching, conversation mode) remains accessible via "✦ Full AI Workspace →" link inside the Analytics Hub page.

#### 🎨 CSS
- `frontend/css/style.css`: Added `.ai-bar-wrap`, `.ai-bar-input`, `.ai-bar-btn`, `.analytics-ai-bar`, `.analytics-ai-bar-input`, `.analytics-ai-bar-btn`, `.analytics-ai-result`. Responsive: topbar bar hides below 680px (accessible via `⌘/`).

### Migration Notes
- Zero backend changes — all `/api/admin/smart-analytics/*` and `/api/admin/analytics/*` endpoints untouched
- Zero DB migrations
- Old hashes redirect automatically — no broken bookmarks

### Test Results
- **1499 passed, 4 skipped, 7 xfailed, 0 failures** ✅ (178s — full backend suite, no regressions)
- Frontend-only change — no new backend tests required

### Verified on staging
Yes — `8a46ea9` on develop, `370caec` on staging
- `/api/health/deep` → `db_tables_accessible: true`, latency 2.1ms ✅
- `#ai-query-bar` confirmed in staging JS bundle ✅
- `analytics-hub-nav-item` confirmed in staging JS bundle ✅

### Rollback commit
`4b61b79` (v8.5.0)

---

## v8.5.0 — 2026-06-02 (Smart Analytics + SF Duplicate Fix)
**Deploy:** `develop → staging → main` | **Branch:** `main` | **Commit:** `ce61459`
**Type:** Feature + Bug Fix

### Changes

#### ✨ Smart Analytics — AI-powered pipeline Q&A (Admin only)
- `backend/services/smart_analytics.py`: New service — converts natural language questions into structured DSL queries executed against live pipeline data
- `backend/routes/smart_analytics_routes.py`: New endpoints — `/api/admin/smart-analytics/query`, `/reports`, `/history`
- Auto-discovers available Groq AI models at startup; retries automatically on 400 (model deprecated) and 429 (rate limit) errors
- System prompt optimised — 74% smaller (1,650 → 422 tokens per call), zero hallucination of filter_sdr/pod/batch fields
- `validate_dsl` is lenient: unknown metrics → clarify action, unknown dimension/period → silent drop, bad sort → default desc
- Post-validate clarify guard in route: gracefully returns clarify instead of crashing `execute_dsl`
- Save report route uses strict DSL validation — clarify-converted DSLs rejected with 400
- Supports metrics: calls_made, meetings_scheduled, emails_sent, leads_created, conversion_rate, connect_rate, research_completed, no_shows, disqualified
- Supports group_by: sdr, pod, day, week, month, source; period defaults to last_30_days
- Pod Admin scoped (own pod only); Super Admin sees all pods
- Query history (last 5), saved reports (CRUD), chart type auto-selected (bar/line/table)

#### 🐛 SF DUPLICATES_DETECTED — graceful recovery (was: crash + failed sync)
- `backend/salesforce.py`: New `_extract_duplicate_sf_id()` helper parses existing Lead ID from `DUPLICATES_DETECTED` error payload (`exc.content` from simple_salesforce, regex fallback)
- `create_new_lead_in_salesforce()`: on `DUPLICATES_DETECTED`, extracts existing SF ID and returns it as `linked_to_existing_duplicate` instead of raising
- Fixes case where SF's exact-match engine finds duplicates the pre-flight SOQL check misses (email case, whitespace, or leads without email)

### Migration Notes
- No new DB columns or env vars required
- `GROQ_API_KEY` must be set in prod (already configured)
- Analytics tables (`analytics_saved_reports`, `analytics_query_history`) added in earlier migration — already in prod DB

### Verified on staging
Yes — `/api/health` ✅ db_connected=true | `/api/health/deep` ✅ db_tables_accessible=true, latency=2.34ms

### Rollback commit
`704be3d` (v8.4.0)

---

## v8.4.0 — 2026-06-01 (RCM SDK Phase 4 — Playground, SSE, State Machine)
**Deploy:** `develop → staging → main` | **Branch:** `develop` | **Commit:** `704be3d`
**Type:** Feature + Hardening

### New Features
- **Dialer Playground (Admin/Super Admin only):** 3-step onboarding wizard at `GET /api/dialer/playground` lets admins verify RCM credentials, test a live call, and confirm widget connectivity — without touching SDR settings. Accessible via 🎮 Playground in the sidebar (Admin only, hidden from SDRs).
- **SSE Real-Time Call Events (`sse_broker.py` + `sse_routes.py`):** Replaces 2-second polling in `dialer_widget.js` with Server-Sent Events. Browser receives call state changes (`CALL_STARTED`, `CALL_ANSWERED`, `CALL_ENDED`) instantly via `GET /api/calls/events`. Falls back to polling automatically if SSE is unavailable — best-effort, never blocks the call.
- **DialerMachine State Machine (`dialer_machine.js`):** Owns call state, timer, polling lifecycle. Eliminates ad-hoc `setTimeout` hacks and race conditions in the call widget.
- **RCMDialerElement Custom Element (`rcm_dialer_element.js`):** Web Component shell for `<rcm-dialer>` — foundation for embedding the dialer widget in non-SPA contexts.
- **Light Theme Widget:** RCM widget now initialises in light theme (`rcm_widget.css` + `theme: 'light'` in app.js).

### Hardening
- **Concurrent call guard:** `dialer_service.py` now blocks a second call if the user already has an active `CALL_STARTED` or `CALL_ANSWERED` record. Returns a clear error: *"You already have an active call in progress."*
- **Webhook idempotency guard:** `ended_at` and `duration` are never overwritten once set. RCM webhook retries no longer corrupt the original timestamp/duration.

### Core Product Impact
- ✅ None. Aircall, Salesforce sync, lead management, auth, and analytics are completely untouched.
- Playground is Admin-only, gated behind a 403 for non-admins.
- SSE fan-out is `try/except pass` — never blocks the call response.

### Tests
- 1434 tests passing (no regressions)
- New: `test_dialer_routes.py` (+249 lines), `test_rcm_provider.py` (+113 lines — Gap 3 room_name payload tests)

---

## v8.3.2 — 2026-05-29 (Bug Fix: RCM Nightly Sync Import Error)
**Deploy:** `develop → staging → main` | **Branch:** `develop`
**Type:** Bug Fix

### Problem
`[NightlySync] RCM error: cannot import name '_normalize_phone' from 'dialer_service'`

`_rcm_nightly_sync()` in `scheduled_jobs.py` (line 340) was importing
`_normalize_phone` from `dialer_service` — the wrong module. The function is
defined in `routes/dialer_routes.py`. This caused an `ImportError` at runtime
every time the nightly catch-up ran, silently killing the entire sync. Any
RCM calls missed by real-time webhooks (server downtime, delivery failure)
were never recovered.

### Root Cause
Wrong module in a lazy inline import. The function was written in `routes/dialer_routes.py`
when it was first needed for route logic. When `scheduled_jobs.py` was extended to
re-use it, the wrong module path was assumed.

### Fix
- `backend/scheduled_jobs.py` line 340: `from dialer_service import _normalize_phone`
  → `from routes.dialer_routes import _normalize_phone`

### Tests Added (`test_scheduled_jobs.py` — new file, 7 tests)
- `test_normalize_phone_importable_from_dialer_routes` — import guard
- `test_normalize_phone_not_in_dialer_service` — negative guard (catches if someone moves it back)
- `test_normalize_phone_works_correctly` — smoke test
- `test_sync_runs_without_import_error` — core regression
- `test_sync_skips_duplicate_calls` — dedup guard
- `test_sync_handles_call_with_no_phone` — null-phone edge case
- `test_sync_skips_when_rcm_not_configured` — graceful skip when unconfigured

### No Migration Required
No schema changes. No Render env var changes.

---

## v8.3.1 — 2026-05-29 (RCA Patch: DB Timeout 503 + Aircall 405 Severity)
**Deploy:** `develop → staging → main` | **Commit:** `06c6cf6`
**Type:** Bug Fix / Hardening

### Problem (RCA-2026-05-29)
- `GET /api/my/tasks/pending` was returning HTTP 500 at 10:52 AM when Render Postgres briefly refused TCP connections under burst load. A full-second burst of simultaneous SDR polls hit the DB at the same moment, causing all to time out at the socket level (`psycopg2.OperationalError: timeout expired`). The query never ran.
- Aircall outbound call failures (405 — user Desktop offline) for `mayukh.pattanayak@screen-magic.com` were being logged at `severity="critical"`, polluting the error dashboard. These are operational/user-behaviour events, not system failures.

### Changes

#### Backend (`backend/routes/task_routes.py`)
- **Fix: DB connect timeout → HTTP 503 + Retry-After: 5** — `OperationalError` from the connection pool is now caught and returned as a clean 503 with `Retry-After: 5` so the frontend silently retries. Previously bubbled up as an unhandled 500.

#### Backend (`backend/routes/dialer_routes.py`)
- **Fix: Aircall 405-type failures log as `warning`, not `critical`** — Errors containing "could not receive the call", "is currently marked as", or "not assigned to any phone number" are now classified as `warning`. All other provider failures remain `critical`.

#### Frontend (`frontend/js/views/task_notifications.js`)
- **Fix: Task notification poll interval 30s → 60s** — Halved the poll frequency to reduce the simultaneous burst of DB connections that amplified the timeout storm.

### Tests
- `TestPendingTasksDBTimeout` (2 tests): 503 on `OperationalError`, 200 happy path
- `TestCallStartSeverityLogging` (5 tests): warning/critical severity split for all Aircall error types
- Total: **95 passed, 4 skipped** (up from 88 baseline)

### No Migration Required
No schema changes. No Render env var changes.

---

## v8.2.0 — 2026-05-28 (Call Recording — Bug Fix + SDR Listen Feature)
**Deploy:** `develop → staging → main` | **Commit:** `6babf7a`
**Type:** Bug Fix + Feature

### Problem
- **Call Monitor:** Clicking Play on a recording caused a progress bar that was invisible (clipped at 32px height). The Refresh button was a plain `↻` icon with no label — nearly impossible to find. After refreshing the URL, users had to click Play a second time manually.
- **Today's Calls (SDR):** The `/api/my/today-calls` endpoint was missing `recording_url` from the response — SDRs had no way to know a recording existed, let alone listen to it.

### Changes

#### Backend (`backend/routes/call_routes.py`)
- **Fix: `recording_url` missing from `/api/my/today-calls` response** — A single missing key `"recording_url": c.recording_url` in the dialer call dict was the root cause. Field now included for all dialer call sources (Aircall + RCM).

#### Frontend (`frontend/js/views/call_monitor.js`)
- **Fix: progress bar invisible** — Removed `height:32px` from audio element CSS. Native browser controls render at ~54px; 32px clipped the seek/progress bar entirely.
- **Fix: refresh button nearly invisible** — Changed from plain `↻` icon to a styled `🔄 Refresh link` button with label, border, and hover state.
- **Fix: manual re-click after refresh** — After `_refreshRecording()` updated the URL, user had to click Play again. Now auto-plays immediately after a successful URL refresh. Stale audio element and error hints are cleared first.

#### Frontend (`frontend/js/views/my_calls.js`)
- **Feat: SDR recording player in Today's Calls** — Added `_recordingToggle()` helper that renders a purple `🎙️ Listen` button on call cards when `recording_url` is present. Clicking toggles an inline `<audio controls>` player. Clicking again collapses and pauses. Expired link shows: *"⚠️ Link expired — open the lead to refresh the recording URL."*

#### Tests (`backend/tests/test_today_calls.py`) — NEW
- **22 new tests** (TC-01 to TC-17) — first ever coverage of `/api/my/today-calls`
- TC-02 is the direct regression guard for this bug: `recording_url must be present in the response when set on a DialerCall`
- Coverage: response shape, recording_url field (present/null/empty), user isolation, date boundary, date param, mixed sources, multi-provider, empty state, invalid date → 400, null started_at excluded, null lead graceful, null outcome → `"—"`, summary counts, sort order

### Migration Notes
- No DB schema changes
- No new env vars

### Verified on staging
- `/api/health/deep` → `{"db_tables_accessible": true, "startup_complete": true}` ✅
- 22/22 new tests pass, 128/128 regression tests pass (call monitor, call routes, bulk research)
- Graph review: risk score 0.60 (MEDIUM), no HIGH items

### Rollback commit
`f7ec36f` (v8.1.0)

---

## v8.1.0 — 2026-05-28 (Bulk Research Job — 5-Bug Fix)
**Deploy:** `staging → main` | **Commit:** `2285dc8`
**Type:** Bug Fix + Hardening

### Changes

#### Backend (`backend/routes/admin_routes.py`, `backend/routes/ai_research_routes.py`)
- **Fix: asyncio clock mismatch (7.5s sleep per Groq call)** — `_groq_last_call_time` initialised to `0.0` and compared against a new event loop's `time()` (also starts near 0) causing a 7.5s sleep before every API call. Fixed: replaced `_call_groq_single` (async) with `_call_groq_sync` (threading.Lock + time.monotonic wall clock). Net effect: 3-4 hour job instead of 20+ hours.
- **Fix: OOM silent crash (11k ORM objects loaded into RAM)** — `db.query(Lead).all()` on ~11,000 rows silently killed the background thread on Render's 512MB instance. Fixed: fetch IDs only first, then process in chunks of 100.
- **Fix: bulk research skip logic** — was skipping any lead with `research_company` filled (all ~6k v1 leads would be silently skipped). New: skip only if `research_heat` is filled (the v2 sentinel field).
- **New: startup log** — `logger.info("Bulk research background thread started")` fires immediately so we can confirm the thread is alive in Render logs.
- **New: `GET /api/admin/bulk-research/status`** — returns `{running, stats}` without triggering a new job. Used by the frontend init check.

#### Frontend (`frontend/js/views/settings_ai_dialer.js`)
- **Fix: relative URL → API_BASE** — `fetch('/api/admin/bulk-research')` hit the static site's `/* → /index.html` rewrite, returning 200 HTML. JSON.parse failed silently; UI showed fake success. Fixed: import `API_BASE` from `auth.js` and use it in all fetch calls.
- **Fix: wrong localStorage key** — fetches used `localStorage.getItem('token')` (always null); auth token is stored as `crm_token`. Fixed: use `localStorage.getItem('crm_token')`.
- **Fix: button stuck in disabled state** — after the first trigger, the button stayed permanently green/disabled across SPA navigation. Fixed: on every Settings page render, poll `/api/admin/bulk-research/status`; if `running: false` → reset button to default purple state.

#### Tests (`backend/tests/test_bulk_research_job.py`)
- 13 new tests (BR-00 through BR-11) covering: auth gate, 400 on no API key, 409 on already-running, skip logic, field persistence, failure isolation, resumability, running flag reset.

### Migration Notes
- No DB schema changes
- No new env vars required
- Groq API key must be set in `GROQ_API_KEY` env var (already present in prod)

### Verified on staging
Yes — `POST /api/admin/bulk-research?pod_id=<us_pod_id>` returned 200, Groq 429 (rate limit) confirmed real API call reached, logs showed `Groq 429 (sync) attempt 1/3`. `/api/health/deep` returns `db_tables_accessible: true`.

### Rollback commit
`a807de9` (v8.0.0)

---

## v8.0.0 — 2026-05-27 (Research v2 — Pre-Call Intelligence + Aircall Error Hardening)
**Deploy:** develop → staging → main | **Commits:** `13f7067` → `a807de9`
**Type:** Feature + Hardening

### New Features
- **Pre-Call Intelligence card (Research v2):** New 6-field AI research card on lead detail replaces the 4-field generic form. Shows heat score (🔥/🟡/🔵), opening line, persona signal, company description, pain points, and pitch angle. Auto-triggers on lead open for zero-research leads.
- **Bulk Research Pre-Population:** Admin Settings → AI Settings now includes a Bulk Research card. Super Admin can trigger a background job to upgrade all v1 leads to v2. Supports phased upgrade via pod filter (US Team first, India Team second).
- **Phased Pod Filter:** Bulk Research accepts optional `pod_id` query param. UI dropdown shows US Team (1,906 leads) and India Team (3,046 leads) as separate targets.

### Bug Fixes
- **Critical: Groq cache was never used** — `company_research` DB cache lookup was broken; every `/ai-research` call hit Groq regardless. Fixed: cache now actually returns early on hit, eliminating 100% of redundant Groq calls.
- **Groq rate limiter** — Added server-side `asyncio.Lock` + 8s minimum interval between Groq calls (based on 6,000 TPM limit). Added 3× exponential backoff retry on 429 responses.
- **Auto-trigger scope** — Auto-research now only fires for leads with zero research (`research_company IS NULL`). Previously fired for all leads including those with v1 data, causing unnecessary Groq calls.
- **Aircall 405 error** — Now matched on both `e.response.status_code == 405` AND `"405" in str(e)` (fallback for cases where `e.response` is None). SDRs now see: *"Please ensure Aircall Desktop is open and status is Available"* instead of raw HTTP error.
- **Aircall 400 error** — New explicit 400 handler: *"Aircall rejected phone number — check the lead's phone number"* instead of raw HTTP stack trace.
- **Double US country code** — `117187726564` (12-digit number starting with `11`) is now auto-corrected to `+17187726564` with a warning log, preventing silent 400 failures.
- **Dial button spam** — `window._callInFlight` guard prevents a second call attempt while the first API request is in-flight. Eliminates the 4× repeated FAILED call pattern seen in prod logs.
- **Bulk research skip logic** — Fixed: old code skipped any lead with `research_company` filled (all 6,035 v1 leads would be silently skipped). New logic: skip only if `research_heat` is filled (the v2 sentinel field).

### Migration Notes
- V40 DB migration: Adds `leads.research_heat` (VARCHAR), `leads.research_opening` (TEXT), `company_research.research_heat`, `company_research.research_opening`, `sync_settings.require_research_before_calling` (BOOLEAN). All additive — no column drops.
- Migration is idempotent and runs automatically on backend startup via `migrations.py`.
- Migration verified on prod DB via `information_schema.columns` query post-deploy.

### Post-Deploy Actions Required
1. Run phased bulk upgrade: Settings → AI Settings → Bulk Research → US Team first, then India Team
2. Change prod DB password on Render (credentials were briefly exposed in session)
3. Notify Mayukh: Aircall 405 errors require Aircall Desktop app to be open + status set to Available

### Verified on staging
Yes — 129/133 tests passed (4 skipped), 0 failures before merge to main.

### Rollback commit
`5f3ac21` (v7.2.0 — last stable)

---

## v7.2.0 — 2026-05-27 (Dialer Hardening — Phone Validation + Full Error Mapping)
**Deploy:** develop → staging → main
**Type:** Hardening — Aircall + RCM robustness, shared validation module, 91 new tests
**Commit:** `87463e4` (develop)

### Problem
SDRs reported calls failing silently or with unhelpful error messages (raw `RuntimeError` strings).
Root cause: both Aircall and RCM providers had no pre-call phone validation. Numbers with
extensions, dots, `None` values, or Indian service numbers (1860/1800) were passed directly to the
API, causing silent 422 errors or crashes. Error messages shown to SDRs were raw exception strings.

### Changes

**`backend/phone_utils.py`** (NEW — shared validation module)
- `strip_extension(phone)`: strips `ext NNN`, `xNNN`, `#NNN` suffixes; case-insensitive
- `validate_phone_dialable(e164, original)`: validates E.164 numbers — checks empty input,
  non-digit chars, length 7–15, NANP area code (can't start 0/1), Indian 1860/1800/1900 service
  numbers, US-stored Indian service numbers (`+11860...`)

**`backend/aircall_provider.py`** (Gaps A1–A5)
- A1: `_format_e164(None)` no longer crashes — returns `""` safely
- A2: Dots stripped in `_format_e164` (`+1.212.555.1234` now works)
- A4: `aircall_user["id"]` KeyError replaced with `.get("id")` + graceful error result
- A5: `_validate_phone_for_aircall` delegates to shared `phone_utils.validate_phone_dialable`

**`backend/rcm_provider.py`** (Gaps C1–C9)
- C1: `_to_rcm_number` strips extensions before formatting; logs warning when stripped
- C2: `_validate_phone_for_rcm()` static method added; called in `initiate_call` pre-API
- C3/C4: `None`/empty `phone_number` handled gracefully everywhere — no crashes
- C5: Dots stripped in `_to_rcm_number`
- C6: **Full 100% error mapping** — every RCM error code maps to a clear actionable message:
  - 422 + 400: friendly "invalid phone/caller ID" + `RCM says: "..."` body detail extracted
  - 429: rate-limit message
  - 403: authentication error + body detail
  - 401: auth failed message
  - 502/503/504: service unavailable
  - 500: server error
  - Timeout: request timed out message
  - Connection refused: connection error message
  - Non-JSON body: graceful fallback (no crash)
  - Unknown long errors: trimmed to 200 chars (no stack traces to users)
- C7/C8: Indian/NANP validation covered by shared module
- C9: `_to_rcm_number` now has full test coverage

### Test Results
- **1252 passed, 0 failed, 4 skipped, 7 xfailed** ✅
- 91 new tests added across 3 files:
  - `test_phone_utils.py` (NEW): 46 tests for shared validation utilities
  - `test_aircall_sync.py`: 1 assertion updated for improved error message ordering
  - `test_rcm_provider.py`: +35 tests (formatter, validator, C6 full battery)
  - `test_rcm_floating_button.py`: EC-9 assertion updated for dot-stripping behaviour

### Migration Notes
None — no schema changes, no new env vars, no migrations.

### Rollback commit
`04dc749` (v7.1.0 — last commit before this hardening)

---

**Deploy:** develop → staging → main
**Type:** Feature — New admin view + backend optimisations + comprehensive test coverage
**Commit:** TBD (develop)

### Problem
Admins had no unified way to monitor all dialer activity (Aircall + RCM + manual) across the org.
The existing System Logs → Call Logs tab was a basic table — no stats, no recording playback, no transcript
preview, no access scoping for Pod Admins, and no in-flight request deduplication.

### Changes

**`backend/routes/admin_routes.py`** — `GET /api/admin/call-logs`
- Optimised filter build: single `filters` list constructed once, shared by COUNT query, rows query, and stats query
  (previously stats query ignored `direction` and `has_recording` filters — could show inflated totals)
- COUNT now runs on `DialerCall` alone (`func.count(DialerCall.id)`) — no 3-table JOIN, index-friendly
- Added `direction` filter parameter (previously missing)
- Stats aggregation (`completed`, `failed`, `avg_duration`) now applies all active filters — stats cards always
  match the visible table rows

**`frontend/js/views/call_monitor.js`** — New view (Super Admin + Pod Admin)
- Full-page call monitor: stat cards (Total, Completed, Failed, Avg Duration), filter bar, sortable table
- Filters: SDR, Provider, Direction (↗ outbound / ↙ inbound), Outcome, Date From/To, Has Recording
- Inline date range validation (E13: blocks `date_from > date_to` before API call)
- `AbortController` on every fetch — cancels in-flight request when filters change (E12/E14 race prevention)
- `_perPage` default of 25 on frontend (backend default is 20); auto-refresh every 60s with manual 🔄 button
- Greyed-out transcript placeholder shown until transcript is available
- Pod Admin access scoped to their own pod's SDRs only (BUG-2 guard: cross-org Aircall rows excluded)
- `_stopAutoRefresh()` called on navigation away — no zombie intervals

**`backend/tests/test_call_monitor.py`** — New test file (44 tests)
- TestCallLogsBasic (9): response shape, field presence, lead/SDR names, recording_url, ordering, dropdown
- TestCallLogsFilters (11): SDR, provider, direction×2, outcome exact-match, has_recording×2, date_from, date_to, combined, AND-combined
- TestCallLogsStats (6): completed, failed, direction respected by stats, has_recording respected by stats, avg_duration=None, avg_duration calculated
- TestCallLogsEdgeCases (8): null lead, cross-org user_id (BUG-2), null duration, empty transcript, manual provider, zero results, FAILED→error_detail, non-FAILED→notes
- TestCallLogsPodAdminScoping (3): pod-scoped calls, pod-scoped dropdown, super-admin sees all
- TestCallLogsSecurity (3): SDR 403, unauthenticated 401/403, BUG-2 regression guard
- TestCallLogsPagination (3): per_page, page 2 ≠ page 1, pages calculation

### Test Results
- **116 passed, 0 failed** ✅ (44 new + 72 existing)
- All edge cases (E02–E14) covered by explicit test cases

### Migration Notes
None — no schema changes, no new env vars. All columns (`direction`, `recording_url`, `transcript`, `notes`) already
existed on `dialer_calls` from v6.0.0 (V39).

### Rollback commit
`4aa0841` (feat(call-monitor): last commit before this release)

---

## v7.0.0 — 2026-05-26 (Dialer Logging & Call Logs UI Overhaul)
**Deploy:** develop → staging → main (staging verified, main pending)
**Type:** Feature — Dialer observability: persistent error logging + Call Logs UI enhancements
**Commit:** `4d93f40` (develop/staging)

### Problem
SDRs were reporting RCM calling issues but no errors were surfacing in any log. Silent failures across:
- `rcm_provider.py` — network retries and unknown webhook statuses swallowed silently
- `dialer_service.py` — call initiation failures logged at `INFO` level, not `ERROR`
- `dialer_routes.py` — failed calls never written to the `error_logs` table → invisible in System Logs UI
- `audit_logs.js` — Call Logs tab showed raw status strings (`CALL_ENDED`, `CALL_STARTED`) with no error reasons, no provider distinction, no direction column

### Changes

**`backend/rcm_provider.py`**
- Retry attempts now log `WARNING` with attempt number, error type, and endpoint path
- Unknown webhook event types promoted from `debug` → `warning` with full payload dump

**`backend/dialer_service.py`**
- Failed call error message now stored in `DialerCall.notes` column (DB-persisted, visible in Call Logs API)
- Call initiation failures now logged at `ERROR` level with user identity and error message
- Provider instantiation errors (decryption/credential failures) no longer swallowed by bare `except`

**`backend/routes/dialer_routes.py`**
- `POST /api/calls/start`: on failure, calls `log_error()` → failure written to `error_logs` table with `category="dialer"`, `severity="critical"`, action hint, and context JSON
- Admin can now see every failed call attempt in **System Logs → Error Logs → Dialer** filter

**`backend/routes/admin_routes.py`**
- `GET /api/admin/call-logs`: new `provider` query filter (RCM / Aircall)
- Response now includes `error_detail` (from `notes` on FAILED rows), `provider_call_id`, and `direction` per item
- Provider filter also applied to summary stats aggregation

**`frontend/js/views/audit_logs.js`**
- **Provider filter** added to Call Logs tab (All / 📞 RCM / ✈️ Aircall)
- **Direction column** with colour-coded ↗ outbound / ↙ inbound badges
- **Provider badges** replace plain text provider names
- **FAILED rows** highlighted in red background with inline `⚠️ error_detail` banner — no need to check Render logs
- **Provider call ID** shown as subtitle under status badge (first 18 chars + ellipsis)
- **Status badge** now correctly parses raw values: `CALL_ENDED`, `CALL_ANSWERED`, `FAILED`, `CALL_STARTED`
- **Red badge** on the 📞 Call Logs tab button showing live count of FAILED calls (polls every 60s, matching Error Logs badge behaviour)

**`frontend/js/views/dialer_widget.js`**
- Polling error logs now include HTTP status code and response detail
- Manual dial API failures logged with `console.error` and full error context
- LiveKit disconnect reason now captured in logs

### Test Results
- No new backend tests required (observability-only change — no logic changes)
- Existing test suite unaffected — `DialerCall.notes` column existed from v6.0.0 (V39 migration)

### Migration Notes
None — `notes` column on `dialer_calls` already exists (added in v6.0.0 / V39). `error_logs` table already exists. No schema changes.

### Verified on staging
Pending — staging deployed at commit `fd1f517`. Verify:
1. System Logs → Error Logs → filter by "Dialer" — failed calls should appear
2. System Logs → Call Logs → FAILED rows should show red background + error banner
3. Provider filter (RCM / Aircall) should correctly scope the table

### Rollback commit
`ef093ed` (end-of-day capture 2026-05-25)

---

## v6.9.0 — 2026-05-25 (RCM Data Integrity + Leaderboard Fix)
**Deploy:** develop → staging → main
**Type:** Bug Fix — 4 production bugs found via live API probe + DB inspection
**Commits:** `44bbac7`, `744619b`, `5ad1545`, `bcf9bac`

### Root Causes & Changes

**Bug 1 — `call_routes.py`: null duration coerced to `0` before API response**
`c.duration or 0` converted every null DB value to `0` → frontend always saw `0s`, not `—`.
Also `avg_duration` used `sum(or 0) // total` → `0` instead of `null` when all durations unknown.
- **Fix:** `c.duration` (pass null through); `avg_duration` skips null-duration calls, returns `null` when none known.
- File: `backend/routes/call_routes.py`

**Bug 2 — Frontend: `0s` display + audio-derived duration**
`_fmtDur` now returns `'—'` for null. Audio player uses `preload="metadata"` and `onloadedmetadata` to read the actual recording duration and update the card header live — critical for calls where the RCM disconnect webhook was missed.
- File: `frontend/js/views/lead_calls_tab.js`

**Bug 3 — RCM field name mismatches (critical — discovered via live API probe)**
Direct inspection of `https://app.bercm.com/contact-center/v1/calls` revealed:
| Assumed | Actual |
|---|---|
| `duration` | **`duration_seconds`** |
| `calls` / `data` (response key) | **`items`** |
| `/calls/{id}/status` returns full data | Returns only `{call_id, status}` |

Three fixes in `rcm_provider.py`:
1. `handle_webhook`: reads `duration_seconds` first, falls back to `duration`
2. `fetch_calls_paginated`: uses `items` key; maps `duration_seconds → duration`, `recording_link → recording_url`
3. `fetch_call`: now searches paginated `/calls` list (up to 5 pages) to backfill `duration_seconds`, `ended_at`, `recording_link` for calls whose disconnect webhook was missed
- File: `backend/rcm_provider.py`

**Bug 4 — Leaderboard: RCM/Aircall dials not counted**
`leaderboard_routes.py` only queried `call_logs` (manual calls). All RCM + Aircall dials live in `dialer_calls` — a different table — making SDR dial counts show 0.
- **Fix:** Union `dialer_calls` (outbound, date-filtered) + `call_logs` for both `calls_today` and `total_calls`. Mirrors the same pattern in `analytics/sdr-table`.
- File: `backend/routes/leaderboard_routes.py`

### On Transcription
RCM returns `"transcription": {}, "transcription_status": "skipped"` for all calls.
Transcription is **not enabled** on this RCM account. Needs activation in the RCM dashboard (AI/transcription settings). CRM already has the UI to display transcripts once enabled.

### Test Results
- **1105 passed, 4 skipped, 7 xfailed, 0 failures** ✅
- Leaderboard: 11/11 · RCM provider: 64/64 · Aircall: 52/52

### DB State After Deploy
| Provider | 7-day calls | With duration |
|---|---|---|
| Aircall | 1,034 | 100% ✅ |
| RCM | 51 | On-demand backfill via `fetch_call` paginated search |

### Rollback commit
`af52af5` (v6.8.1)

---

## v6.8.1 — 2026-05-25 (P1 Hotfix — /api/calls/start IntegrityError)
**Deploy:** develop → staging → main (pending user approval)
**Type:** Hotfix — production P1
**Commit:** `af52af5`

### Problem
Production DB has `sf_lead_id NOT NULL` at the database level (ORM model marks it `nullable=True` but the column constraint was never migrated). Ad-hoc RCM calls that matched no existing lead triggered anonymous lead creation without `sf_lead_id` → `psycopg2.errors.NotNullViolation` → HTTP 500 on every call attempt.

### Changes
- **hotfix(dialer) `dialer_routes.py`:**
  - Populate `sf_lead_id` with unique `MANUAL-{uuid16}` sentinel on anonymous lead rows. Satisfies `NOT NULL` + `UNIQUE` constraints. `MANUAL-` prefix is easily filterable in any SF sync query.
  - Harden `email` field: replaced `int(timestamp())` (seconds precision, collision risk on rapid retry) with `uuid4().hex[:12]` — guaranteed unique.

### Test Results
- 1105 passed, 0 new failures, 4 skipped, 7 xfailed.

### Follow-up (staging-verified before prod)
- `ALTER TABLE leads ALTER COLUMN sf_lead_id DROP NOT NULL` — aligns production DB schema with ORM model so future anonymous rows don't need the sentinel.

---

## v6.8.0 — 2026-05-25 (Staging Stability & UX Refinements)
**Deploy:** develop → staging → main
**Type:** Feature / Bug Fixes / UX Enhancements

### Changes
- **fix(backend) `dialer_service.py` + `call_routes.py`:** RCM call recordings were never appearing in the lead Calls tab. Root cause: `get_lead_calls()` used `get_active_provider(db)` (the global provider — Aircall) to refresh recording URLs for ALL `DialerCall` rows. RCM calls were silently refreshed via the Aircall HTTP client → wrong provider → recording_url always stayed NULL. Fix: added `get_provider_by_name(name, db)` to `dialer_service.py` and rewrote the refresh loop in `call_routes.py` to use a per-call provider cache keyed by `DialerCall.provider`. RCM calls now get the RCM provider; Aircall calls get Aircall. Added `logger.debug` for missing-credential cases to surface issues in Render logs. 3 new tests in `TestGetProviderByName`.
- **fix(backend) `test_rcm_provider.py`:** Mocked urlopen calls in `TestUserNumbers` unit tests to isolate test execution from real network activity.
- **fix(backend) `test_dialer_credentials.py`:** Added `use_agent_phone=True` parameter to RCM caller ID assertions.
- **feat(frontend/backend) UX Refinements:**
  - **Manual Dial Sync Active Hidden**: Dial buttons are hidden on lead lists/details when manual dial sync is active.
  - **Filter Clear Button Reload**: Clear filters action triggers a clean page reload to completely reset all UI state.
  - **SDR Settings Dialer Toggle**: SDRs can toggle the RCM WebRTC dialer widget on/off in their Settings panel.
  - **Remove Resolve Button from Error Logs**: Hidden the "Resolve" button on System Error Logs for SDR-role users.
  - **Compact Call Log Modal UI**: Made the call log modal visual interface more compact.

### Test Results
- All 1105 backend unit tests passing (1105 passed, 4 skipped, 7 xfailed).

---

## v6.7.0 — 2026-05-25 (Cross-Page Lead Traversal & Today's Calls Navigation)
**Deploy:** develop → staging → main
**Type:** Feature — non-paginated lead list navigation + Today's Calls traversal

### Goal
1. Support sequential lead traversal (Prev/Next buttons) across all filtered leads in the list view instead of just the current page's subset.
2. Add this sequential traversal capability to the Today's Calls view (`my-calls`) as well.

### Changes
- **feat(backend) `lead_routes.py` / `lead_helpers.py`:** Modified `get_leads()` and `get_my_leads()` endpoints to accept an optional `ids_only: bool = Query(False)` query parameter. When `ids_only` is true, pagination is bypassed and a lightweight list containing `id`, `first_name`, `last_name`, `company`, `phone`, `phone_secondary`, and `assigned_to` is returned immediately with eager loading to prevent N+1 queries.
- **feat(frontend) `api.js`:** Updated `fetchLeads()` to support passing the `ids_only` parameter.
- **feat(frontend) `lead_list.js`:** Modified list view to run a background asynchronous `ids_only` query matching current search/filters on page load or filter changes, updating the global navigation list `_navLeads` with the full matched dataset.
- **feat(frontend) `my_calls.js`:** Defining and exporting `getNavLeads()` containing unique leads called today, built by deduplicating today's call logs.
- **feat(frontend) `lead_detail.js`:** Updated header Prev/Next button resolving logic to conditionally use `my_calls.getNavLeads()` or `lead_list.getNavLeads()` depending on whether the user entered from the Today's Calls view (`backView === 'my-calls'`).
- **test(backend) conftest.py / test_lead_routes.py:**
  - Expanded `create_test_user` to accept a custom `id` so that SDR user assignments can be accurately verified against `"sdr-user-id"` used by FastAPI TestClient's SDR auth context.
  - Added unit test cases `test_get_leads_ids_only`, `test_get_my_leads_ids_only`, and `test_get_leads_ids_only_with_filters` to verify correctness of the `ids_only` behavior under various filtering/search conditions.
- **test(backend) test_ai_research_routes.py:** Updated `test_cache_hit_returns_cached_data` to properly mock contact-level `_call_groq` call and assert it is called exactly once, matching the production contact-level LLM cache-hit behavior.

### Test Results
- All 1107 backend unit tests passing successfully.

---

## v6.6.0 — 2026-05-22 (Analytics Call Count Fix + DB Orphan Repair)
**Deploy:** develop → staging → main | **Commit:** `c92826c`
**Type:** Bug Fix — analytics undercounting + data integrity repair

### Root Cause (RCA-2026-05-22)
Analytics funnel (`GET /api/admin/analytics/funnel`) read `call_logs` for all call metrics. US Team uses Aircall exclusively — all 10,315 calls are in `dialer_calls`. `call_logs` had only 19 rows for US Team (manual entries), causing the dashboard to show **19 calls instead of ~10,315**.

### Changes
- **fix(analytics) `analytics_routes.py`:** Replaced `call_logs`-only call counting with a **UNION strategy**:
  - `dialer_calls` (outbound) → covers all Aircall/RCM calls
  - `call_logs` WHERE no matching `dialer_call` for same user+lead+date → covers India Team manual calls (4,969 pure-manual entries)
  - Only 1 overlap found org-wide — excluded to prevent double-counting
  - Same fix applied to trend endpoint and SDR table (BULK QUERY 3)
  - Connect rate now uses `CALL_ANSWERED` status (Aircall live answer signal)
- **fix(db) orphan repair:** 1,474 orphaned `dialer_calls` linked to leads via phone-match (last-10-digit normalization across primary, secondary, company phone fields)
  - Root cause: historical Aircall sync stored phones as `+1 XXX-XXX-XXXX`, leads stored `XXXXXXXXXX`
  - Remaining 4,215 orphans are genuinely not in RCM (calls to external numbers or deleted leads)

### Expected UI Impact
| Pod | Before | After |
|-----|--------|-------|
| US Team calls_made | 19 | ~10,315 |
| India Team calls_made | ~4,969 | ~4,969 (unchanged) |
| Org total | ~4,988 | ~15,284 |

### Test Results
- 65 analytics tests passing, 7 xfailed (SQLite/postgres-only tests, pre-existing)
- `test_ai_research_routes.py::test_cache_hit_returns_cached_data` — pre-existing failure, unrelated to this change

### Verified on staging
Pending — deploy to staging before main

### Rollback commit
`1863602` (v6.5.0)

---



## v6.5.0 — 2026-05-22 (Performance Hotfix + CORS Fix)
**Deploy:** Render auto-deploy | **Commit:** `1107674`
**Type:** Hotfix — 5 query anti-patterns + 3 DB indexes + CORS

### Changes
- **fix(CORS):** Production `api.alternatecrm.com` was blocking all requests from `rcm.txtbox.in` — `FRONTEND_URLS` env var on Render production backend did not include the production frontend URL. Fixed via Render env var update (no code change).
- **perf(P0) `admin_routes.py`:** `GET /api/admin/call-logs` was calling `q.all()` loading ALL 11,371 DialerCall+User+Lead joined rows into Python memory just to count 3 status types (completed/failed/missed). Replaced with `func.sum(case(...))` SQL aggregates — runs in <10ms vs 3–8s.
- **perf(P1) `auth_routes.py`:** `_push_user_metrics_to_sf()` fetched ALL lifetime `CallLog` rows per user then filtered today's calls in Python. Replaced with SQL `COUNT` with `called_at >= today_start` filter + `.first()` for `last_call`.
- **perf(P1) `call_routes.py`:** Exact duplicate of the `auth_routes` bug. Same fix applied.
- **perf(P2) `sdr_performance_routes.py`:** Status counts used N Python list comprehensions over all leads in period. Replaced with SQL `GROUP BY status COUNT(*)`.
- **perf(P2) `dialer_routes.py`:** Orphan-link route loaded full Lead ORM objects (all columns) just to build a phone→id map. Changed to column-only `SELECT id, phone`.
- **indexes `migrations.py`:** Added 3 composite indexes applied automatically on startup:
  - `idx_dialer_calls_user_created (user_id, created_at DESC)` — call-log page filter+sort
  - `idx_dialer_calls_created_at (created_at DESC)` — admin ordered view
  - `idx_call_logs_user_called_at (user_id, called_at DESC)` — SDR login metrics

### Test Results
- All 175 Playwright tests still passing / 0 failed
- Syntax-validated all 6 changed files before push

### Verified on staging
Yes — CORS header confirmed: `access-control-allow-origin: https://rcm.txtbox.in`

### Rollback commit
`987e771` (v6.4.9)

---

## v6.4.9 — 2026-05-22 (Test Infrastructure + Bug Fix)
**Deploy:** Render auto-deploy | **Commit:** `12682cb` → merged `987e771`
**Type:** Fix + Test Hardening

### Changes
- **fix(backend):** `GET /api/dialer/my-phone` was returning `{phone_number: ...}` but `GET /api/dialer/status` returns `{from_number: ...}` (EC-8 canonical field). Now returns both `from_number` (canonical) and `phone_number` (backwards-compat alias) so all callers work without breaking.
- **fix(tests):** Root cause of most Playwright UI test failures: `navigateTo()` helper was using plain path routing (`/settings`) instead of hash routing (`/#settings`). Vanilla JS SPA routes via `location.hash` — plain paths all served `index.html` (homepage), so every view-specific test was unknowingly testing the dashboard instead of its target view.
- **fix(tests):** `specs/10-navigation.spec.js` route paths updated from `/dashboard` → `/#dashboard` etc.
- **fix(tests):** `specs/14-call-outcome-flow.spec.js` SDR call-logs path reverted to correct `/api/admin/call-logs` (was incorrectly changed to `/api/admin/analytics/call-logs` which 404s).
- **fix(tests):** Outcome modal selector changed from `.call-outcome-picker` (class) to `#call-outcome-picker` (ID) — per `modals.js` source.
- **fix(tests):** Admin action icon selector updated to `button.view-user-btn` (per `admin.js` source, `title="View As"`).
- **fix(tests):** Lead row click selector updated to `tr.lead-row[data-id]` (per `lead_list.js` source); URL check updated to `#lead-detail` hash pattern.
- **fix(tests):** `hasFilters()` helper updated to catch emoji-prefixed search inputs (`🔍 Search...`) and class-based selects (`.filter-select`).
- **fix(tests):** SDR Performance table row count scoped to `#an-sdr-section .analytics-table` (was counting all tables on analytics page).
- **fix(tests):** Sandbox `findGenerateBtn()` removed broad `button:has-text("🔑 Generate")` which was incorrectly matching the unrelated Public API button.
- **fix(tests):** SF Logs timezone test soft-passes when staging has no SF connection (no data to check).
- **test:** Added `00-sanity.spec.js` — 13 pre-flight checks that run first and catch infra issues before wasting a 20-min suite run: frontend reachability, vanilla JS identity, hash routing, JWT expiry, API auth, CORS, PostgreSQL.

### Test Results
- **175 passed, 7 skipped (staging-data), 0 failed** ✅
- Sanity spec: **13/13 passed**

### Verified on staging
Yes — full Playwright suite run against `rcm-frontend-staging.onrender.com` + `rcm-crm-staging.onrender.com`

### Rollback commit
`0087f4e` (v6.4.8)

---

## v6.4.8 — 2026-05-22 (Pre-deploy Edge Case Hardening)
**Deploy:** Render auto-deploy | **Commit:** `0087f4e`
**Type:** Fix — 8 edge cases found during pre-deploy code review

### Changes
- **EC-1 (backend):** Guard 2 log used `timedelta.seconds` (only 0–59) — fixed to `int(age.total_seconds())`. Added tz-safe `started_at` handling (PostgreSQL TIMESTAMPTZ is already tz-aware; SQLite returns naive — both paths now handled without a `TypeError`).
- **EC-2 (frontend):** Guard 3 (45s) and the 60s answered-fallback timer were unscoped — if a new call started within the 1500ms widget-close animation, the old timer could fire against the new call's state. Both timers now capture `callId` at creation and bail if `_callState.callId` differs.
- **EC-3 (backend):** Guard 1 (ended_at override) correctly applies to all providers. Added explicit comment documenting why this is safe for Aircall (webhook writes `ended_at` + `CALL_ENDED` atomically — Guard 1 never fires for healthy Aircall calls).
- **EC-4 (frontend):** Calls tab auto-switch retry window extended from 600ms → 1200ms to tolerate slow-network lead-detail render latency.
- **EC-5 (frontend):** Calls tab click now captures `targetLeadId` before the timeout and exits early if the SDR navigated to a different lead within the window — prevents clicking the wrong lead's Calls tab.
- **EC-6 (CSS):** Added z-index budget reference table to `style.css` documenting the full stacking order.
- **EC-7 (backend):** Added comment to Guard 2 documenting its order dependency on the status normalizer.
- **EC-8 (backend):** `POST /calls/start` now always returns `lead_name` in the response so the outcome modal shows the correct name for both ad-hoc and lead-page-initiated calls.

### Tests
- 42 dialer tests pass (0 new failures, 0 regressions)

---

## v6.4.7 — 2026-05-22 (Hotfix + UX)
**Deploy:** Render auto-deploy | **Commit:** `3e8b596`
**Type:** Hotfix — RCM Declined Call + Calls Tab UX

### Changes
- `frontend/css/style.css`: `#call-log-modal { z-index: 100000 }` — outcome modal was buried behind RCM widget (z-index 99,999) and instantly disappearing on call end. Now always renders on top.
- `frontend/js/views/modals.js`: After outcome submitted → auto-switches to Calls tab. Previously lead-detail reloaded with Overview tab active; SDR had to manually find and click Calls tab to see new entry.
- `frontend/js/views/user_guide.js`: Fixed release notes ordering (v6.4.0 was incorrectly top card; v6.4.1–v6.4.3 were sub-cards; v6.4.4–v6.4.7 were missing). Correct descending order now. Footer updated to v6.4.7.
- `backend/tests/test_dialer_routes.py`: 7 new `TestCallStatusGuards` tests (Guard 1 × 3, Guard 2 × 3, E2E lifecycle × 1).

### Migration Notes
None — no schema changes, no new env vars.

### Verified on staging
Yes — DB cleanup ran: 52 legacy stuck `CALL_STARTED` records fixed to `CALL_ENDED`. Zero stuck calls remaining.

### Rollback commit
`4b6d590`

---

## v6.4.6 — 2026-05-22 (Hotfix)
**Deploy:** Render auto-deploy | **Commit:** `4b6d590`
**Type:** Hotfix — RCM Ringing Timeout (Backend Guard 2)

### Changes
- `backend/routes/dialer_routes.py`: Guard 2 — if a RCM call has been in `CALL_STARTED` for >50 seconds with no `ended_at`, auto-set `status=CALL_ENDED` and `ended_at=NOW()`. Prevents zombie calls blocking the UI when recipient declines and RCM webhook is delayed.

### Migration Notes
None.

### Verified on staging
Yes — Guard 2 confirmed firing for calls >50s. DB records updated correctly.

### Rollback commit
`a3c1ee4`

---

## v6.4.5 — 2026-05-22 (Hotfix)
**Deploy:** Render auto-deploy | **Commit:** `a3c1ee4`
**Type:** Hotfix — RCM Declined Call Stuck on Ringing (Backend Guard 1 + Client Timeout)

### Changes
- `backend/routes/dialer_routes.py`: Guard 1 — if `ended_at` is already set on `DialerCall` but RCM REST API still returns `"ringing"`, immediately return `CALL_ENDED`. Fixes lag where RCM API took 7–30s to reflect call state change.
- `frontend/js/views/dialer_widget.js`: Client-side 45s timeout for RCM `connecting/ringing` state — fires `_handleHangup()` automatically if no answer received. Third safety layer after Guard 1 + Guard 2.

### Root Cause
Call `df84927b` — `ended_at` written at 07:51:11 by user pressing Disconnect. RCM webhook arrived at 07:51:18 (7s lag). Between those 7s, status poll returned stale `CALL_STARTED` — UI frozen on "Ringing…" indefinitely.

### Migration Notes
None — no schema changes.

### Verified on staging
Yes — call `3f6157e6` transitioned correctly 37s after start via Guard 1.

### Rollback commit
`a1a4198`

---

## v6.4.4 — 2026-05-22 (Feature)
**Deploy:** Render auto-deploy | **Commit:** `a1a4198`
**Type:** Feature — Calls Tab Auto-Refresh + Manual Dial Promise Fix

### Changes
- `frontend/js/views/lead_detail.js`: `window._refreshCallsTab(leadId)` exposed globally. After a call ends, hook fires — if Calls tab is active, immediately re-fetches; otherwise resets `callsLoaded=false` so next click fetches fresh data.
- `frontend/js/app.js`: `rcm:call-ended` handler calls `_refreshCallsTab` so Calls tab is always current after dialer use.
- `frontend/js/app.js` (line 652): Manual dial button click now routes through `showManualDialWidget()` — previously called `openForManualDial()` directly, dropping the Promise result silently so `POST /api/calls/start` was never hit.

### Migration Notes
None.

### Verified on staging
Yes — live test: manual dial → call answered → `POST /api/calls/start` 200 confirmed in logs.

### Rollback commit
`be6f17a` (v6.4.0 tag)

---

## v6.3.6 — 2026-05-21 (Hotfix)
**Deploy:** Render auto-deploy | **Commit:** `be6f17a`
**Type:** Hotfix — Status Polling No-Downgrade Guard

### Changes
- `backend/routes/dialer_routes.py`: Added status priority system: `CALL_STARTED=0`, `CALL_ANSWERED=1`, `CALL_ENDED=2`. Polling can only advance status forward — a webhook that set `CALL_ENDED` can no longer be overwritten by a subsequent poll returning `CALL_STARTED`.

### Verified on staging
Yes.

### Rollback commit
`e7e9c24`

---

## v6.3.5 — 2026-05-21 (Hotfix)
**Deploy:** Render auto-deploy | **Commit:** `e7e9c24`
**Type:** Hotfix — RCM Call Initiation 422 Error

### Changes
- `backend/rcm_provider.py`: Removed `agent_email` and `notify_url` from `/calls/initiate` payload. Both fields caused 422 "Unknown field" responses from RCM API, silently preventing all calls from going through.

### Root Cause
v6.3.3 added these fields speculatively — neither is accepted by the RCM `/calls/initiate` endpoint.

### Verified on staging
Yes — calls initiate correctly after removal.

### Rollback commit
`3289edc`

---

## v6.3.4 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `3289edc`
**Type:** Fix — RCM Webhook notify_url Dynamic Resolution

### Changes
- `backend/rcm_provider.py`: `notify_url` now derived from live request URL instead of env var — eliminates environment-specific configuration.

### Rollback commit
`26c742b`

---

## v6.3.3 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `26c742b`
**Type:** Fix — RCM Call Initiation Fields (reverted in v6.3.5)

### Changes
- `backend/rcm_provider.py`: Added `agent_email` + `notify_url` to call payload. Both later found to cause 422 — reverted in v6.3.5.

---

## v6.3.2 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `8397e59`
**Type:** Fix — Call History Text Visibility + Faster Decline Detection

### Changes
- `frontend/css/rcm_widget.css`: Fixed text color contrast in call history panel.
- `frontend/js/views/dialer_widget.js`: Reduced decline detection polling interval from 5s → 2s.

---

## v6.3.0 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `0281a51`
**Type:** Fix — Call Status Polling Root Cause Fixes

### Changes
- `backend/routes/dialer_routes.py`: Rewrote status normalization — RCM raw status strings mapped to canonical `CALL_STARTED/CALL_ANSWERED/CALL_ENDED`.
- `frontend/js/views/dialer_widget.js`: Timer anchored to `started_at` from server (not local JS `Date.now()`) for accurate call duration display.
- `frontend/js/views/lead_calls_tab.js`: Call history timestamps use server-side `started_at`, not client clock.

---

## v6.2.9 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `f28c4f0`
**Type:** Fix — Call History Auth + Timer

### Changes
- `frontend/js/rcm_widget.js`: Call history fetch now uses authenticated `apiFetch()` instead of bare `fetch()` — was returning 401 for all SDRs.
- Timer start anchored to `call_started_at` event timestamp.

---

## v6.2.8 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `b60b89e`
**Type:** Fix — END Call Clears Widget

### Changes
- `frontend/js/rcm_widget.js`: `_handleHangup()` now correctly resets widget to idle state after END CALL pressed. Previously widget stayed frozen in active-call UI.

---

## v6.2.7 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `57dbab3`
**Type:** Fix — END Call Works Even if RCM API Fails

### Changes
- `frontend/js/views/dialer_widget.js`: Wrapped RCM disconnect API call in try/catch — UI always transitions to ended state even if API returns error.

---

## v6.2.6 — 2026-05-21 (Feature)
**Deploy:** Render auto-deploy | **Commit:** `dc52613`
**Type:** Feature — Call History in Widget Idle Pane

### Changes
- `frontend/js/rcm_widget.js`: Idle pane now shows call history — lead-specific calls if on a lead page, today's SDR calls otherwise. Uses `GET /api/leads/{id}/calls` or `GET /api/calls/my-calls`.

---

## v6.2.5 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `87a444f`
**Type:** Fix — Timer Shows Ringing Until Answered; End Call Works in Embedded Widget

### Changes
- `frontend/js/rcm_widget.js`: Timer shows `Ringing…` label until `CALL_ANSWERED`; counts up from 0 only after connection confirmed.
- End Call button wired correctly in embedded (non-detached) widget mode.

---

## v6.2.0 — 2026-05-21 (Feature)
**Deploy:** Render auto-deploy | **Commit:** `1c17b80`
**Type:** Feature — Unified RCM Dialer in RCMWidget

### Changes
- `frontend/js/rcm_widget.js`: Full rewrite — widget now handles both messaging AND calling. Call tab added with dial pad, mode selector, live call controls, call history.
- `frontend/js/views/user_guide.js`: Conversations tab removed; messaging moved into RCMWidget.
- `frontend/js/app.js`: Manual dial button routes through `showManualDialWidget()`.
- `backend/tests/test_dialer_routes.py`: v6.2.0 backend test suite + call_mode validation added.

### Migration Notes
None — no schema changes.

### Rollback commit
`95cf6c1`

---

## v6.1.0 — 2026-05-21 (Staging QA + Production Fix)
**Deploy:** Render auto-deploy | **Commit:** `95cf6c1`
**Type:** Bug Fix — Staging QA (SS1–SS4) + Production Email Sanitization

### Changes
- `backend/salesforce.py`: `_sanitize_email()` — strips internal spaces, trailing dots from SF emails. Fixes `INVALID_EMAIL_ADDRESS` write-back failures on production.
- `backend/routes/admin_routes.py`: `list_call_logs` scoped to known RCM users — cross-org Aircall data excluded.
- `backend/routes/admin_sync_routes.py`: `get_sf_connection_info` reads DB-stored connection first (staging uses DB creds, not env vars).
- `frontend/js/views/settings_connection.js`: Fixed `sfInfo.last_synced` → `sfInfo.last_sync_at` field name mismatch (Last Sync always showed "Never").
- `frontend/js/app.js`: SS1 FAB suppression removed (was hiding RCMWidget); `_showCallModeSelector` exposed globally (SS3).
- 34 new backend tests (34/34 passing, 1059 total).

### Rollback commit
`f09718e`

---

## v6.0.0 — 2026-05-20 (Major Feature)
**Deploy:** Render auto-deploy (staging branch) | **Commit:** `9195dbf` + `e66eb2f` + `86ad3ea` + `fa951d6`
**Type:** Major Feature — Calling Overhaul (13 bugs + 3 enhancements)

### Changes
- **BUG-01–BUG-13**: Fixed all critical calling bugs including: duplicate call entries (EC-14), RCM widget drag conflict (CSS transform vs fixed positioning), mode selector routing, call history auth 401s, discovery gate stuck state, call modal timer anchor, Aircall auto-sync tag mapping.
- **ENH-01**: Phone timezone badges — displays local time for lead's phone number area code.
- **ENH-02**: Esc keyboard shortcut closes call mode selector modal.
- **ENH-03**: System Logs + Call Logs tab in admin audit area.
- **BUG-04**: Manual Dial button — anonymous lead auto-created when dialing without navigating to a lead first.
- **BUG-05**: Widget drag fix — `transform: translate()` conflicted with `position: fixed`. Replaced with absolute mouse position tracking.
- `backend/models.py`: `DialerCall` model — added `call_mode`, `outcome`, `notes` columns (V39).
- `backend/migrations.py`: V39 migration — idempotent column additions.

### Migration Notes
- V39: 3 new columns on `dialer_calls` table (`call_mode`, `outcome`, `notes`) — auto-applied on startup.

### Verified on staging
Yes — 1005 tests passing. Browser QA completed (see `docs/qa_*.png` screenshots).

### Rollback commit
`ef21028`

---

## v6.4.3 — 2026-05-21 (Hardening)
**Deploy:** Render auto-deploy | **Commit:** `a94aa58`
**Type:** Hardening — Global Search Completeness Audit

### Changes
- `backend/routes/search_routes.py`: Added `company_phone` to search filter (existed in Lead model, never searched)
- `backend/routes/search_routes.py`: Added reverse-name concat (`last + first`) so "Pratt Melanie" also matches
- `frontend/js/app.js`: Added 2-character minimum before firing search API — prevents single-keystroke hits on 11k-row table
- Search now covers 9 match paths: `first_name`, `last_name`, `first+last`, `last+first`, `email`, `company`, `phone`, `phone_secondary`, `company_phone`

### Migration Notes
None — no schema changes.

### Verified on staging
Yes — `GET /api/search?q=melanie+pratt` returns correct lead after fix; `?q=a` no longer fires DB query.

### Rollback commit
`ae98389`

---

## v6.4.2 — 2026-05-21 (Bug Fix)
**Deploy:** Render auto-deploy | **Commit:** `ae98389`
**Type:** Bug Fix — Global Search Full-Name Match

### Changes
- `backend/routes/search_routes.py`: Added `func.concat(first_name, ' ', last_name).ilike(q_filter)` — searching "Melanie Pratt" (full name) now works even though first/last are stored in separate columns. Previously returned 0 results.
- `backend/routes/search_routes.py`: Refactored into `_lead_name_filter()` helper shared by admin and SDR paths

### Migration Notes
None — no schema changes, no new env vars.

### Verified on staging
Yes — confirmed full-name search returns correct results on staging.

### Rollback commit
`e54d097`

---

## v6.4.1 — 2026-05-21 (Hot Fix)
**Deploy:** Render auto-deploy | **Commit:** `e54d097`
**Type:** Hot Fix — RCM Ad-hoc Dial Broken + Random Lead in Footer

### Changes
- `frontend/js/rcm_widget.js`: Fixed critical promise-kill bug in `_renderCallIdleManual._dial()`.
  `_renderCallIdle()` was called BEFORE `_resolvePendingMode()` — but `_renderCallIdle` internally
  calls `_resolvePendingMode(null)`, destroying the promise before the real `{phone, callMode}` could
  be delivered. API call never fired. Fix: capture resolve fn, null `_pendingModeResolve`, render
  "Connecting…" spinner, then invoke resolve fn.
- `frontend/js/rcm_widget.js`: As a side-effect, "random lead" (Melanie Pratt) no longer appears
  in the widget footer during ad-hoc dial — the idle-state call history was being loaded because
  `_renderCallIdle()` was incorrectly called.

### Migration Notes
None — frontend-only fix.

### Verified on staging
Yes — ad-hoc dial triggers correctly; "Connecting…" spinner shows; widget advances to active call state.

### Rollback commit
`b3100cc`

---

## v6.4.0 — 2026-05-21 (Feature + Hardening)
**Deploy:** Render auto-deploy | **Commit:** `b3100cc`
**Type:** Feature — RCM Dialer Reliability, Button UX, Pagination

### Changes
- `frontend/js/views/lead_detail.js`: RCM users — hide "Call via RCM" and "Message" buttons (widget handles both). Aircall users with RCM messaging — keep Message button.
- `backend/routes/call_routes.py`: `GET /leads/{id}/calls` now accepts `page` + `limit` query params (default 1/10). Stats computed from full dataset. Returns `has_more`, `total_count`, `page`, `limit`.
- `frontend/js/api.js`: `fetchLeadCalls(leadId, page, limit)` updated to pass pagination params.
- `frontend/js/views/lead_calls_tab.js`: Full rewrite — async "Load more" pagination. First 10 load on tab open; subsequent pages append on demand. Filter preserved across pages.
- `frontend/js/views/user_guide.js`: Release Notes section moved to top (index 0). All sections start collapsed. v6.4.0 entry added. Footer version updated `v5.13.0 → v6.4.0`.

### Migration Notes
None — no schema changes, no new env vars.

### Verified on staging
Yes — button visibility, pagination, call history, and user guide all verified on staging.

### Rollback commit
`be6f17a`

---

## v5.16.0 — 2026-05-20 (Feature)
**Deploy:** Render auto-deploy (staging branch) | **Commit:** `49dff4c` (develop)
**Type:** Feature — SDR UX Overhaul (Call Modal v2, Lead Nav, Aircall Auto-Sync, Multi-Number Split Button)

### Changes
- `frontend/index.html`: Restructured `#call-log-modal` — new 3-state inline-reveal design (lead bar, binary question, chip grid, footer)
- `frontend/js/views/modals.js`: Full state machine rewrite — `_showState1()`, `_pickBranch()`, chip grid renderer, Aircall polling with Page Visibility API, keyboard shortcuts (Y/N/1-9/Enter), meeting date expand
- `frontend/js/api.js`: Added `fetchCallOutcomeStatus(callId)` for Aircall auto-sync polling
- `frontend/js/app.js`: All 3 `openCallModal` call sites now pass `_dialerConfig.provider`
- `frontend/js/views/lead_detail.js`: Prev/Next lead nav bar (Alt+←/→ keyboard shortcuts), multi-number split call button with phone picker dropdown
- `frontend/js/views/lead_list.js`: Exports `getNavLeads()` — ordered lead list for Prev/Next navigation
- `backend/models.py`: Added `SyncSettings.aircall_tag_mapping` column (V39)
- `backend/migrations.py`: V39 ADD COLUMN migration for `aircall_tag_mapping`
- `backend/dialer_provider.py`: Added `CallEventType.CALL_TAGGED`, `NormalizedCallEvent.tags` field
- `backend/aircall_provider.py`: Added `call.tagged` to webhook event_map, tags extraction + `tags=tags` passed to `NormalizedCallEvent` (bug fix in same commit)
- `backend/dialer_service.py`: Added `_auto_log_outcome()` — maps Aircall tags → RCM outcomes, idempotent (EC-4 guard), writes CallLog + increments attempt count
- `backend/routes/dialer_routes.py`: Added `GET /api/dialer/call-outcome-status` endpoint for frontend polling
- `docs/user-guide.md`: Updated Logging a Call, Aircall Dialer, added Lead Navigation and Multi-Number sections
- `docs/release-notes.md`: Added v5.16.0 and v5.15.x entries

### Migration Notes
- V39: `ALTER TABLE sync_settings ADD COLUMN aircall_tag_mapping TEXT` (auto-runs on startup via `migrations.py`)
- Default Aircall tag mapping pre-seeded in `_DEFAULT_TAG_MAPPING` (no admin action required for basic operation)
- Admin can override per-tag mapping in Settings → Dialer → Aircall (UI pending — Phase 2)

### Unit Tests
12/12 backend unit tests passed (in-memory SQLite): idempotency, unmapped tags, first-match-wins, custom admin mapping, empty tags list.

### Verified on staging
Partial — new endpoints (`/api/dialer/call-outcome-status`) confirmed live on staging. `call.tagged` webhook handler verified locally. Frontend F1 modal verified visually on dev frontend with staging token.

### Rollback commit
`379d4eb` (develop commit before v5.16.0 feature work)

---

> One entry per production deploy. Add BEFORE merging to `main`.
> Format: version, deploy ID, commit hash, changes, migration notes, rollback commit.

---

## v5.15.5 — 2026-05-15 (Hotfix)
**Deploy:** Render auto-deploy | **Commit:** `a96d0ba` (develop) → `d1a965b` (staging) → `bb011e2` (main)
**Type:** Hotfix — Frontend Console Error Elimination (2 Issues)

### Root Causes & Changes

**Bug A — `Cannot read properties of null (reading 'replaceChild')`: `frontend/js/views/lead_detail.js:1640`**
Editable field click handler captured `parent = field.parentElement` at click time.
If the user navigated away before the click resolved (or during the async `patchLead` save on blur),
`field` and `input` were detached from the DOM — both `parent.replaceChild(input, field)` and
`parent.replaceChild(newEl, input)` threw `TypeError: Cannot read properties of null`.
Fix: added `!parent || !parent.contains(child)` guards before **both** `replaceChild` calls.
Also added `.catch(() => {})` to the `patchLead` call inside `save()` so a failed PATCH does not
surface as an additional unhandled rejection.

**Bug B — `A background operation failed unexpectedly` (unhandled rejections): `frontend/js/app.js` + `frontend/js/error_reporter.js`**
Two fire-and-forget `loadView()` calls inside legacy redirect branches (`sf-logs`, `metrics`/`activity-feed`)
had no `.catch()`, causing any view-render failure to surface as an unhandled promise rejection.
Auth-related 401/403 rejections were also being reported as genuine background-op failures.
Fix: added `.catch(() => {})` to both redirect `loadView()` calls; updated `error_reporter.js`
`unhandledrejection` handler to suppress strings containing `401` or `403`.

### Migration Notes
None — frontend-only change. No schema changes, no new env vars.

### Rollback Commit
`da9a951` (develop before this patch)

---

## v5.15.4 — 2026-05-15 (P1 Hotfix)
**Deploy:** Render auto-deploy | **Commit:** `f38d269` (main)
**Type:** P1 Hotfix — Admin User Deletion `IntegrityError` (NotNullViolation)

### Root Cause & Change

**`DELETE /api/admin/users/{id}` → HTTP 500 `IntegrityError: NOT NULL constraint on user_id`**
`UserMailbox` has a non-nullable `user_id` FK (`NOT NULL`, `ON DELETE CASCADE` in PostgreSQL).
SQLAlchemy's default relationship behaviour attempts to `SET user_id = NULL` on child rows **before**
firing the DB-level `DELETE` — but the `NOT NULL` constraint rejects that `UPDATE`, raising
`psycopg2.errors.NotNullViolation` before the cascade can run.
Fix: added `passive_deletes=True` to the `user` backref on `UserMailbox.user_id` in `backend/models.py`
(line 690). This instructs SQLAlchemy to trust the database's own `ON DELETE CASCADE` and skip the
ORM-managed nullification step — matching the pattern already applied to `LoginLog` (line 540).

### Migration Notes
None — no schema changes. Relationship-level ORM hint only.

### Verified on Staging
✅ Admin → Users → Delete User: no 500, user and mailbox rows removed cleanly via DB CASCADE.

### Rollback Commit
`6f0339b` (staging before this patch)

---

## v5.15.3 — 2026-05-15 (Bug Fix)
**Deploy:** Render auto-deploy (staging `164d322`) | **Commits:** `0edfa22`, `ab01aed` (develop)
**Type:** Bug Fix — Discovery Call UI Cosmetics & Re-render (2 Issues)

### Root Causes & Changes

**Bug 5 — Discovery gate stays open after logging outcome: `frontend/js/views/modals.js`**
After submitting the call outcome modal, the post-success re-render was gated on
`vc.querySelector('#calls-list')` being in the DOM — a check that **never passes** on the
lead-detail page. The fallback `loadView(getCurrentView())` reloaded the view without a
`leadId`, so `renderLeadDetail` received stale `last_call_timestamp` data and the gate
condition evaluated incorrectly (still showing the yellow warning banner and "Log Outcome"
button). Fix: always call `loadView('lead-detail', callLeadId)` when `callLeadId` is set.

**Bug 6 — Discovery call label stuck on "In Progress" after outcome logged: `frontend/js/views/lead_detail.js`**
The call entry label (`Call N — In Progress / Completed`) had no awareness of
`hasOutcomeForCurrentCall`. A call stayed labelled "In Progress" and kept the amber
`pending-call` highlight even after the outcome was logged, because `isDone` only becomes
`true` when there is a next call or the status is `Discovery Complete`.
Fix: added a third label state — `"— Outcome Logged"` — shown when `isCurrent &&
hasOutcomeForCurrentCall`. The amber `pending-call` CSS class is also suppressed in this
state.

### Migration Notes
None — no schema changes, no new env vars.

### Verified on Staging
✅ Confirmed: after logging an outcome from the discovery gate, the yellow banner clears
immediately, the call entry reads "Call 1 — Outcome Logged", and "+ Add Discovery Call" /
"✓ Complete Discovery" buttons become active. No page refresh required.

### Rollback Commit
`518987d` (staging before this patch — post v5.15.2)

---

## v5.15.2 — 2026-05-15 (Bug Fix)
**Deploy:** Render auto-deploy (staging `1c38943`) | **Commit:** `ca27e0f` (develop)
**Type:** Bug Fix — SDR Staging QA Batch (4 Issues)

### Root Causes & Changes

**Bug 1 — Duplicate call log entries (EC-14 Phase 2): `backend/dialer_service.py`**
Aircall formats the phone number differently between `CALL_STARTED` (`+91 8109730301`) and
`CALL_ENDED` (`+91 81097 30301`). The fallback DialerCall match used raw string equality,
so `CALL_ENDED` couldn't match the `CALL_STARTED` record — creating a second row.
Fix: added a digits-only normalization loop (using existing `_normalize_digits()`) as a
second-pass fallback when the exact string match fails.

**Bug 2 & 4 — `TypeError: res.json is not a function` on Meeting Complete / Demo Failed:
`frontend/js/views/lead_detail.js`**
`api.logCall()` already performs `response.json()` internally and **throws** on HTTP errors.
The button handlers were incorrectly treating the return value as a raw `fetch` Response
and calling `.ok`/`.json()` on it. Fixed: all four discovery-stage handlers
(`meetingCompleteBtn`, `demo-fail-confirm`, `demoSuccessBtn`, `completeDiscoveryBtn`)
now use a simple `try/catch` on the already-resolved API result.

**Bug 3 — Discovery gate stuck "Log outcome first"**
Side-effect of Bug 2: `logCall` crashed before the status transition could complete, leaving
the outcome gate open. Resolved by the Bug 2 fix — no separate code change needed.

### Migration Notes
None — no schema changes, no new env vars.

### Verified on Staging
✅ Fully verified: Meeting Complete → Discovery transition, Demo Failed → Pending Review,
and single call log per Aircall call all confirmed. Staging commit `ca27e0f`.

### Rollback Commit
`cff7c29` (staging before this patch)

---

## v5.15.1 — 2026-05-15 (Bug Fix)
**Deploy:** Render auto-deploy (staging `c13bbf0`) | **Commit:** `ad336c4` (develop) → `c13bbf0` (staging merge)
**Type:** Bug Fix — Duplicate Dialer Call Log Entries (EC-14)

### Root Cause
`log_call` used a 10-minute time-window heuristic to find the matching `DialerCall` record when an SDR submitted the outcome gate modal. If a call lasted >10 minutes, or the Aircall/RCM webhook was delayed, no `DialerCall` was found within the window — causing a new `CallLog` to be created in addition to the existing `DialerCall`. Both entries appeared in lead history, making one call appear as two.

### Changes
- **`backend/routes/call_routes.py`**: `log_call` now accepts optional `dialer_call_id` in the JSON body. If present, performs exact `DialerCall` lookup by UUID (idempotency guard: skips if outcome already set and logs a warning instead). Fallback time-window extended 10 → 30 min for manual callers / older clients.
- **`frontend/js/app.js`**: `callId` (DB UUID from `startDialerCall()` response) now threaded through the entire outcome gate chain: `startDialerCall` → `_setPendingOutcome` → `_onDialerCallEnded` → `_openPendingOutcomeModal`. Both Aircall polling timeout path and RCM `rcm:call-ended` event now pass `callId`.
- **`frontend/js/views/modals.js`**: `openCallModal()` accepts new optional `dialerCallId` param. Stored as `activeDialerCallId` and included in the `logCall` payload when present. Cleared on submit, close (X button), and backdrop click.

### Behaviour After Fix
| Call type | dialer_call_id in payload | Backend action |
|---|---|---|
| Dialer (Aircall/RCM) | ✅ Present | Exact DialerCall lookup → outcome attached → no CallLog created |
| Dialer (very old client, no callId) | ❌ Missing | 30-min window fallback → attach if found, else CallLog |
| Manual (no dialer) | ❌ Missing | No DialerCall lookup → CallLog created as normal |

### Migration Notes
None — no schema changes, no new env vars.

### Verified on Staging
Pending QA — Render deploy triggered on staging branch. Verify: make a dialer call, log outcome via gate modal, confirm exactly one entry in lead history.

### Rollback Commit
`b9d7195` (staging before this merge)

---

## v5.15.0 — 2026-05-15 (Feature)
**Deploy:** Render auto-deploy (staging `b9d7195`) | **Commit:** `c680ba9` (develop)
**Type:** Feature — Automated Dialer Outcome Gate + Independent Provider Test Buttons

### Changes
- **`frontend/js/app.js`**: Added outcome gate system — sticky banner + modal auto-opens after every dialer-initiated call. SDRs cannot skip logging an outcome. Dismissing auto-adds a note to the lead. Persists across page refresh via `localStorage`. Aircall polling: 60 × 10s polls for terminal status (ended/done/missed) — opens modal automatically when call ends.
- **`frontend/js/views/modals.js`**: Hooked modal close handlers (dismiss and successful log) into gate cleanup (`_clearPendingOutcome`, `_onCallModalDismissed`).
- **`frontend/js/views/dialer_widget.js`**: `call-ended` event payload enriched with `leadName` and `phone` to support gate context.
- **`frontend/css/style.css`**: `slideDown` keyframe + sticky outcome banner styling.
- **`backend/routes/dialer_routes.py`**: `/api/dialer/test` accepts optional `?provider=aircall|rcm` for independent credential testing.
- **`backend/dialer_service.py`**: `test_specific_provider()` — validates Aircall and RCM credentials independently.
- **`frontend/js/api.js`**: `testDialerConnection()` accepts optional `providerKey` query param.
- **`frontend/js/views/settings_ai_dialer.js`**: Test buttons for Aircall and RCM wired to their respective providers.

### Migration Notes
None — no schema changes, no new env vars.

### Verified on Staging
Partial — outcome gate sticky banner and modal trigger confirmed. Aircall modal-not-opening edge case (missing `provider_call_id`) fixed and tested.

### Rollback Commit
`d4e8816` (staging before v5.15.0)

---

## v5.13.1 — 2026-05-13 (P2 Hotfix)
**Deploy:** Render auto-deploy (`d15a1bc` → main) | **Commit:** `d15a1bc`
**Type:** P2 Hotfix — Silent Migration Failure / Dashboard 500s

### Root Cause
V36 migration (`discovery_meeting_count`) silently skipped on production cold start.
`SET LOCAL lock_timeout = '10s'` fired while Render had connection pressure on the leads
table. `ALTER TABLE` timed out. Exception was caught as a `logger.warning`, not re-raised.
App booted "healthy" (`/api/health` → 200) but every ORM `SELECT *` on `Lead` threw
`ProgrammingError` — dashboard-stats and activity-feed 500'd for all users.
Leaderboard remained up because it uses a separate query that doesn't load Lead columns.

### Changes
- **`backend/migrations.py`**: Removed `SET LOCAL lock_timeout` from ADD COLUMN path.
  Failures now raise `RuntimeError` instead of logging a warning — app fails loudly at
  startup rather than booting into a broken state.
- **`scripts/.prod.env`**: Removed deprecated `rcm.rcm.ai` from `FRONTEND_URLS`.
- **Render env**: `FRONTEND_URLS` updated to `https://rcm.txtbox.in` only.

### Emergency Fix Applied
`discovery_meeting_count INTEGER DEFAULT 0` added directly to production DB via psycopg2
(bypassing startup migration). All 12,035 existing leads backfilled with default `0`.
Dashboard recovered within 1 minute of patch.

### Migration Notes
Column now present in prod DB — subsequent startup will skip V36 (`information_schema`
check confirms existence). No manual SQL needed on future deploys.

### Verified on Production ✅
- `dashboard-stats`: HTTP 200 restored ✅
- `activity-feed`: HTTP 200 restored ✅
- `information_schema` confirms `discovery_meeting_count INTEGER DEFAULT 0` present ✅
- Non-null row count: 12,035 ✅

### Rollback Commit
`cd427a4` (v5.13.0 — note: restores silent migration behavior, not recommended)

### Protocol Updates
- `AGENT_PROTOCOL.md` Rule 12 added: column migration failures must raise, never warn
- Post-deploy checklist: `dashboard-stats` endpoint verification added (`[RCA-2026-05-13-P2]`)

---

## v5.13.0 — 2026-05-13 (SDR Discovery Pipeline)
**Deploy:** Render auto-deploy (staging branch) | **Commit:** (develop → staging merge)
**Type:** feat — SDR workflow product bug fixes

### Changes
- Backend: Added `discovery_meeting_count` to `Lead` model + V36 migration (auto-applies at startup)
- Backend: New `POST /leads/{id}/add-discovery` endpoint — persists discovery meetings, advances stage
- Backend: `_lead_to_dict` now exposes `discovery_meeting_count` to frontend
- Frontend: "Add Discovery Call" button now calls real API (was a client-side no-op)
- Frontend: "Complete Discovery" button — advances lead to `Discovery Complete` stage
- Frontend: "Schedule Demo" button — visible at `Discovery Complete`, advances to `Demo Scheduled`
- Frontend: Max-attempts warning banner rendered directly on lead detail page header
- Frontend: Call modal now shows required datetime picker when "Meeting Confirmed" is selected
- E2E: Added P1–P4 SDR workflow spec files to `tests/`

### Migration Notes
`discovery_meeting_count INTEGER DEFAULT 0` added to `leads` table via V36 migration. Auto-applied on startup — no manual SQL needed.

### Rollback Commit
Previous: `eaaba2f` (v5.12.3)

---

## v5.12.3 — 2026-05-13 (P1 Hardening)
**Deploy:** Render auto-deploy (staging: `b4097de`) | **Commit:** `d77eaeb` (develop)
**Type:** P1 Hardening — Import Route Resilience

### Root Cause
Two concurrent bugs caused "Failed to fetch" HTTP 500 errors and data loss on GSheet/CSV imports:

**Bug 1 — Split-commit split-brain:** Two separate `db.commit()` calls (leads → log). A transient DB connection issue between the two commits let leads land silently while the `LeadUploadLog` was never written. The user saw HTTP 500 and assumed failure; the import had actually partially succeeded.

**Bug 2 — Session corruption on per-row failure:** Per-row `try/except` in the import loop caught exceptions but never called `db.rollback()`. One failed row left the SQLAlchemy session in `PendingRollbackError` state — all subsequent rows and the final commit crashed.

Also fixed separately (`6ea8046`): per-row `regexp_replace()` full-table-scan ran once per imported row (182 rows × 11,721 leads = 2.1M regex ops, >30s timeout → "Failed to fetch" from browser timeout, not HTTP error).

### Changes
- **`backend/routes/admin_upload_routes.py`** — GSheet path (`gsheet_import`):
  - Wrap per-row lead creation in `db.begin_nested()` savepoint. Constraint violation rolls back only that row; session stays clean.
  - Move `LeadUploadLog` creation before `db.commit()` — single atomic commit (leads + log together).
  - Move `sync_leads_to_am_background` to after commit (no behavior change, correctness).
  - Add `exc_info=True` logging per failed row for full stack traces in Render logs.
  - Pre-fetch all existing phone digit suffixes in one query before the loop; O(1) set lookup per row replaces per-row `regexp_replace` full-table-scan.
- **`backend/routes/admin_upload_routes.py`** — CSV path (`upload_enriched_sheet`): same four fixes applied identically.
- **`backend/tests/test_admin_routes.py`**: 3 new regression tests:
  - `test_gsheet_import_creates_upload_log` — verifies atomic commit (log exists after import)
  - `test_gsheet_import_row_failure_does_not_crash_import` — verifies savepoint isolation
  - `test_csv_upload_creates_upload_log` — verifies CSV path atomicity

### Migration Notes
None — no schema changes, no new env vars, no model changes.

### Verified on Staging
Pending — staging deployed at `b4097de`. Key check: do a test import and confirm Upload Center shows the log entry immediately.

### Rollback commit
`96778e8` (staging before this merge) / `6ea8046` (develop — reverts only hardening, keeps N+1 fix)

---

## v5.12.2 — 2026-05-12 (Hotfix)
**Deploy:** Render auto-deploy triggered | **Commit:** `379f3f7` (main)
**Type:** Hotfix — Dialer Edge-Case Hardening (5 bugs)

### Changes
- **`backend/routes/dialer_routes.py`**: `/api/dialer/status` now returns `sender_id` (the RCM outbound number) directly. Eliminates the 403-generating `/api/admin/sync-settings` call that all SDRs were previously hitting on every page load.
- **`frontend/js/app.js`**: Added `_rcmWidgetReady` flag (local + `window.`) — set to `true` only after `RCMWidget.init()` completes successfully. Replaces the faulty `typeof RCMWidget` guard, which was always `true` because the UMD script loads regardless of whether init ran.
- **`frontend/js/app.js`**: `RCMWidget.init()` now uses `_dialerConfig.sender_id` from the per-user status API instead of fetching from the admin endpoint.
- **`frontend/js/app.js`**: Default `_dialerConfig` now includes `active: false` and `sender_id: ''` to prevent race conditions during initial page load before the API response arrives.
- **`frontend/js/app.js`**: `isDialerActive` now requires `_dialerConfig.active === true` in addition to provider and credentials checks, preventing UI inconsistencies for SDRs with disabled-but-configured dialers.
- **`frontend/js/views/lead_detail.js`**: Call button label now requires `_dc.active === true` before showing "Call via Aircall" or "Call via RCM". Inactive SDRs correctly see "Log Call".
- **`frontend/js/views/lead_detail.js`**: Message button now gated on `window._rcmWidgetReady`. Hidden for Aircall and no-dialer users, preventing the `classList` null-pointer crash.

### Migration Notes
None — no schema changes, no new env vars. `sender_id` was already in `SyncSettings.rcm_sender_id`.

### Verification Matrix (pre-deploy checklist)
| Scenario | Call button | Message button |
|---|---|---|
| No dialer configured | Log Call | Hidden |
| Aircall active | Call via Aircall ✅ | Hidden ✅ |
| Aircall inactive (active=false) | Log Call ✅ | Hidden ✅ |
| RCM active | Call via RCM ✅ | Shown ✅ |
| RCM inactive | Log Call ✅ | Hidden ✅ |

### Verified on Staging ✅
- `/api/health/deep` → `status: ok, db_tables_accessible: true, db_latency_ms: 4.0ms`
- `/api/dialer/status` response includes `sender_id` field ✅
- Lead detail page loads without console errors — no `classList` crash ✅
- Call button shows correct label per dialer state ✅
- Message button hidden for non-RCM users ✅

---

## v5.12.0 — 2026-05-12 (Hotfix)

**Deploy:** pending | **Commit:** `1b20725` (develop)
**Type:** Hotfix — Aircall Routing & RCM Widget Gate

### Changes
- `frontend/js/app.js`: Added provider-based guard — `RCMWidget.init()` is now skipped entirely for SDRs whose resolved dialer provider is `aircall`. This prevents the RCM FAB (floating messaging button) from appearing for Aircall users and causing routing confusion.
- `frontend/js/app.js`: Exposed `window._dialerConfig` so `lead_detail.js` can read provider config without additional API calls.
- `frontend/js/views/lead_detail.js`: "Log Call" button now dynamically labels itself as "📞 Call via Aircall" (green) or "💬 Call via RCM" (purple) based on the user's resolved dialer provider.
- `backend/tests/test_hardening.py`: Relaxed `test_deep_health_returns_status` to accept `degraded` as a valid response — external integrations (Salesforce, Aircall) are not configured in the local test environment.

### Migration Notes
None — frontend-only UX change + test fix. No schema changes, no new env vars.

### Verified
- Full backend test suite: **1021 passed, 7 xfailed, 0 failures** ✅
- Staging `/api/health/deep`: status=ok, db_tables_accessible=true ✅
- **Production `/api/health`**: status=ok, db_connected=true, startup_complete=true ✅
- **Production `/api/health/deep`**: status=ok, db_tables_accessible=true, db_latency_ms=3.48ms ✅
- Auth gates: /api/admin/sync-settings → 401, /api/leads/activity-feed → 401 ✅

### Rollback commit
`f130323`

---

## v5.11.0 — 2026-05-12 (Feature)
**Deploy:** staging commit `ed0d0ee` | **Commit:** `b70a67f` (develop), `ed0d0ee` (staging)
**Type:** Feature — Integration Health Diagnostics

### Changes
- `backend/routes/integration_health_routes.py` [NEW]: Two auth-protected diagnostic endpoints:
  - `GET /api/dialer/health` — checks dialer provider config, API key/user_id/from_number presence, live API ping
  - `GET /api/chat/health` — checks `rcm_enabled`, api_key/user_id/account_id/sender_id, live API ping via `list_conversations`
- `backend/main.py`: Registered `integration_health_router` (V35)

### Migration Notes
None — read-only diagnostic endpoints. No schema changes, no new env vars.

### Verified on staging
Pending — staging deploy in progress (commit `ed0d0ee`)

### Rollback commit
`588d9bc`

---

## v5.10.0 — 2026-05-12 (Feature)
**Deploy:** staging commit `588d9bc` | **Commit:** `588d9bc` (staging)
**Type:** Feature — RCM Floating Widget (Unified Messaging Surface)

### Changes
- `frontend/js/rcm_widget.js`: Floating widget — dynamic header (lead name + phone), no-phone guard, timer anchoring to call start time, loading state for compose area, dialer suppression scoped to active calls only
- `frontend/js/app.js`: Boot `RCMWidget` post-login; injects `rcm_sender_id` from SyncSettings; exposes `window._openMessagingWidget(lead)`
- `frontend/js/views/lead_detail.js`: Deprecated iframe conversations tab; rewired 💬 Message button and Conversations tab to open floating widget via `window._openMessagingWidget`
- `frontend/js/views/dialer_widget.js`: Added `startTime` to `rcm:call-started` event payload for accurate timer sync
- `frontend/css/rcm_widget.css`: Removed dead `.cw-powered-by` styles; added dynamic header lead-info component styles
- `frontend/index.html`: Registered `rcm_widget.css` + `rcm_widget.js` globally

### Migration Notes
None — no database or schema changes. Feature is opt-in via Settings → Sync → RCM Messaging toggle. Iframe-based tab is deprecated.

### Verified on staging
Partially verified — widget opens and sends messages. Call initiation under investigation (from_number / credentials may need staging DB setup).

### Rollback commit
`dfe3acb`

---

## v5.9.0 — 2026-05-11 (Feature)
**Deploy:** a881a43 | **Commit:** `a881a43`
**Type:** Feature — Global Error Auditing System

### Changes
- `backend/error_logger.py` [NEW]: Fire-and-forget error logger. Deduplication (5-min window), PII redaction, per-user rate limiting (10 writes/min). Never raises — swallows all exceptions silently.
- `backend/routes/error_log_routes.py` [NEW]: Role-scoped REST API (dict-based JWT access, matching `get_current_user` pattern). GET paginated list (SDR sees own, Pod Admin sees pod, Super Admin sees all), POST ingest from frontend, PATCH resolve (with resolver_name), GET summary badge count.
- `backend/models.py`: Added `ErrorLog` table — severity, category, feature, plain-English title/description/action_hint, dedup_key, dedup_count, last_seen_at, resolved.
- `backend/migrations.py`: Added `error_logs` table to V32 `table_creates` — guarantees schema exists before first HTTP request on cold-start Render deploys.
- `backend/main.py`: Registered `error_log_router`. Added global FastAPI `@app.exception_handler(Exception)` to capture unhandled 500s and log via `log_backend_exception`.
- `backend/scheduled_jobs.py`: Added `_cleanup_old_error_logs()` — daily purge of error logs older than 15 days.
- `frontend/js/error_reporter.js` [NEW]: Global frontend error reporter. Captures `apiFetch` failures, `window.onerror`, `unhandledrejection`. Translates HTTP status + endpoints into plain English. Guards: loop prevention, 30s client-side dedup, localhost excluded, 401/403 silenced, AbortError silenced.
- `frontend/js/app.js`: Imports `initErrorReporter` + `flushPendingErrors`. Reporter initialised before any view loads.
- `frontend/js/views/audit_logs.js`: Added Error Logs tab — stats banner, severity-coloured cards, dedup badge (×N), one-click Resolve with resolver_name from JWT, 60s badge polling, filters.

### Migration Notes
- New table `error_logs` created via V32 synchronous migration — no downtime. Foreign key `user_id` uses SET NULL (error history preserved if user deleted).
- No existing tables modified. No env var changes.

### Verified on staging
Yes — error card captured via `Promise.reject()` console test. Resolve button confirmed working (resolver name from JWT). Role-scoped visibility confirmed (Super Admin sees all).

### Rollback commit
`dfe3acb` — `git revert a881a43` safely removes all error auditing files.

---

## v5.8.2 — 2026-05-11 (Bug Fix)

**Deploy:** pending staging → main merge | **Commit:** on `develop`
**Type:** Bug Fix — Research Gate Validation

### Changes
- `frontend/js/views/lead_detail.js`: Fixed Research → Calling status gate. Was querying non-existent DOM input elements (`document.getElementById('research-company')` etc.) — always returned null → gate always blocked. Now reads directly from the `lead` JS object (same source as `countResearchFilled()`).

### Migration Notes
None — frontend-only change, no schema or API changes

### Verified on staging
No — pending staging deploy

### Rollback commit
Previous `develop` commit before this fix

---

## v5.8.1 — 2026-05-08 (Infrastructure + Bug Fixes)
**Deploy:** auto-triggered | **Commit:** `f9364bc` (staging → main)
**Type:** Infrastructure — Custom domain canonicalization + Sandbox reliability fixes

### Changes
- `render.yaml`: Updated `FRONTEND_URL`, `FRONTEND_URLS`, buildCommand, and comments to use canonical custom domains (`rcm.rcm.ai` / `api.alternatecrm.com`)
- `docs/Public_API.md`: Replaced placeholder `your-rcm-domain.com` with real production API domain across all curl/Python/JS examples
- `docs/AGENT_PROTOCOL.md`: Updated production backend URL reference
- `backend/scripts/monitor_staging.sh`: `PROD_URL` now points to `api.alternatecrm.com`
- `scripts/migration/phase1_download_and_map.py`: `RCM_PROD` constant updated
- `backend/routes/sandbox_routes.py`: **Bug fix** — per-table transaction isolation in `_do_refresh`: each table TRUNCATE+INSERT now runs in its own transaction boundary with `db.commit()` on success and `db.rollback()` on failure, preventing one failed table from poisoning the entire session (`InFailedSqlTransaction`)
- `frontend/js/views/settings.js`: **Bug fix** — progress poller re-initialises sandbox tab on completion so "Last refresh" stats block updates with real lead count; hides progress container after done/failed; uses `??` for nullish lead count; polls every 2s

### Infrastructure Notes
- Cloudflare CDN cache for `config.js` manually purged — `API_BASE` now resolves to `api.alternatecrm.com` across all edge nodes
- `GOOGLE_REDIRECT_URI` intentionally kept as `.onrender.com` — must match registered OAuth redirect URI in Google Console exactly
- CI/test runner URLs (`playwright.config.js`) kept as `.onrender.com` to bypass Cloudflare for direct origin connectivity

### Migration Notes
None — no schema changes

### Verified on staging
Yes — sandbox refresh tested with new API domain; transaction isolation fix confirmed working (leads populated successfully); UI poller fix deployed to staging

### Rollback commit
`8ba15d5` (main before this release)

---

## v5.8.0 — 2026-05-08 (Feature + Fix)
**Deploy:** auto-triggered | **Commit:** `7e758e5` (merge of staging → main)
**Type:** Feature — AI Research Prompt Editor + Sandbox Export Fix

### Changes
- `backend/models.py`: Added `research_prompt` (TEXT, nullable) to `SyncSettings`
- `backend/migrations.py`: V31 migration — idempotent `ADD COLUMN research_prompt`
- `backend/routes/admin_sync_routes.py`: Expose `research_prompt` in GET/PATCH sync-settings
- `backend/routes/ai_research_routes.py`: Dynamic prompt injection — `{lead_context}` placeholder; falls back to system default if no custom prompt set
- `frontend/js/views/settings_ai_dialer.js`: New Prompt Editor card — live char count, `{lead_context}` chip, Save + Reset to Default
- `frontend/js/views/settings.js`: Fixed sandbox tab rendering bug — "Loading..." placeholder now correctly removed after UI loads
- `backend/routes/sandbox_routes.py`: **Critical fix** — replaced monolithic `/export` (30s timeout) with:
  - `GET /export/tables` → table list + row counts (fast, <1s)
  - `GET /export/table/{name}` → single table export (30s per table, bounded)
  - `_do_refresh` now loops table-by-table — no more timeout on large DBs

### Migration Notes
- V31: `ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS research_prompt TEXT` — fully idempotent, runs automatically on startup
- No manual intervention required
- Existing research data unaffected; `research_prompt = NULL` means system default is used

### Verified on staging
Yes — staged on `rcm-crm-staging.onrender.com`; sandbox refresh tested. Custom domain `rcm.rcm.ai` activated in prod post-merge.

### Rollback commit
`bca0640` (prior commit before AI research changes; sandbox fix also reverts)

---

## v5.7.5 — 2026-05-07 (Process Hardening)
**Deploy:** `497168c` on develop (not yet merged to main) | **Commit:** `497168c`
**Type:** Process / Documentation — no app code changed

### Changes
- `docs/AGENT_PROTOCOL.md`: Single source of truth — merged MYAGENT.md, Dev_Protocol.md, DEPLOYMENT_PROTOCOL.md
- `docs/command.txt`: Shrunk to 5-line pointer to AGENT_PROTOCOL.md
- `scripts/pre-deploy-check.sh`: New mandatory pre-deploy gatekeeper script
- `.gitmessage`: New commit message template enforcing type/scope/summary format
- `docs/RELEASES.md`: New deploy-time release tracker (this file), backfilled v5.6.x–v5.7.4
- `scripts/close_day.sh`: Added EOD gate — warns if main commits have no release note

### Migration Notes
None — documentation and scripting only

### Verified on staging
N/A — process changes only, no application code

### Rollback commit
N/A

---

## v5.7.4 — 2026-05-07 (Infrastructure Hardening)
**Deploy:** `033d1ab` auto-triggered | **Commit:** `09ded47` + merge `033d1ab`
**Type:** Infrastructure Hardening — migration safety + health check

### Changes
- `migrations.py`: Added `_applied_migrations` tracker — all 14 data migrations now idempotent, run exactly once
- `migrations.py`: `SET LOCAL lock_timeout = '10s'` on all `ADD COLUMN` DDL
- `app_state.py`: New module — `startup_complete` boolean flag
- `main.py`: Sets `startup_complete = True` at end of startup thread
- `auth_routes.py /api/health`: Exposes `startup_complete`; always returns 200 (prevents Render restart loops)
- `auth_routes.py /api/health/deep`: New endpoint — `SELECT 1 FROM leads LIMIT 1` with `statement_timeout=2s`; returns `db_tables_accessible: true/false`

### Migration Notes
- Creates `_applied_migrations` table on first deploy (idempotent)
- All 14 historical migrations backfilled; subsequent restarts skip all instantly

### Verified on staging
No — P1 recovery; staging also affected at the time

### Rollback commit
`637dfa4`

---

## v5.7.3 — 2026-05-07 (P1 Hotfix)
**Deploy:** `637dfa4` auto-triggered | **Commit:** `ace5361` + merge `637dfa4`
**Type:** P1 Hotfix — DB Deadlock

### Changes
- `migrations.py`: ENUM→VARCHAR conversion now checks `information_schema.columns` first — skips `ALTER TABLE` if column already `character varying`
- `migrations.py`: Added `SET LOCAL lock_timeout = '5s'` on ENUM conversion DDL as safety net

### Root Cause Fixed
`ALTER TABLE leads ALTER COLUMN status TYPE VARCHAR(255)` was running unconditionally every startup, taking `AccessExclusiveLock` on `leads` table even when column was already VARCHAR. Conflicted with concurrent `UPDATE leads SET times_called` → all API traffic blocked.

### Verified on staging
No — emergency hotfix during active P1 outage

### Rollback commit
`d4e61ef` (⚠️ this commit caused the deadlock — do not redeploy)

---

## v5.7.2 — 2026-05-06 (Infrastructure)
**Deploy:** `dep-d7u8kpppo60c73e8dukg` | **Commit:** `d4e61ef` (merge of `d3bb151`)
**Type:** Infrastructure — Production Frontend Decoupling

### Changes
- `render.yaml`: Added `rcm-frontend-prod` static site service
- `render.yaml`: Set `SERVE_FRONTEND=false` on `rcm-crm-prod` backend
- `render.yaml`: Added `FRONTEND_URL` and `FRONTEND_URLS` env vars for CORS and Google SSO redirects
- `frontend/js/views/settings_ai_dialer.js`: Webhook URL now uses `API_BASE` instead of `window.location.origin`
- `frontend/js/config.js`: `window.__APP_CONFIG__` injected at build time

### ⚠️ Known Issue — Triggered P1 Outage
This deploy triggered the 7 May DB deadlock. V24 migration `UPDATE leads SET times_called` ran on production data for the first time, conflicting with unconditional `ALTER TABLE leads ALTER COLUMN status` → all API traffic blocked. Fixed in v5.7.3.

### Verified on staging
Partial — CORS and login flow verified; DB migration interaction on large tables not tested

### Rollback commit
Previous working commit before decoupling

---

## v5.7.0 — 2026-05-06 (Infrastructure)
**Deploy:** manual via Render Dashboard | **Commit:** `main` at time of deploy
**Type:** Infrastructure — Staging Decoupling

### Changes
- Decoupled staging environment: `rcm-frontend-staging` static site created
- Backend staging: `SERVE_FRONTEND=false` set
- `frontend/js/config.js`: Added `window.__APP_CONFIG__` injection via build command
- `frontend/js/auth.js`: Updated to read `API_BASE` from injected config

### ⚠️ Known Issue — Caused P1 Outage
CORS origin mismatch: backend `FRONTEND_URLS` env var not updated to match new static site domain. Staging frontend received 401/CORS errors on all authenticated endpoints.

### Rollback
Re-added CORS origins to `FRONTEND_URLS` env var via Render Dashboard

---

## v5.6.x — 2026-05-04 (Dialer Integration)
**Deploy:** auto-triggered | **Commit:** `develop` merge
**Type:** Feature — RCM Dialer Hardening

### Changes
- RCM Contact Center dual-dialer architecture (V25)
- Per-SDR RCM caller ID / `senderId` override (V27)
- Separate dialer credentials — Contact Center can use different RCM account (V28)
- Dynamic call outcome configuration Phase 2 (V29)
- Sandbox Refresh — API-to-API tokenized export (V30)
- Upload Center: batch lead assignment time-scoped query filters
- FastAPI port binding fix — heavy startup work moved to daemon threads

### Verified on staging
Yes — RCM QA API connectivity tested, outbound call flow verified

---

## How to Add a Release Note

Copy this template and fill it in **before** merging to `main`:

```markdown
## vX.Y.Z — YYYY-MM-DD (<type>)
**Deploy:** dep-xxx | **Commit:** `xxxxxxx`
**Type:** Feature | Hotfix | Infrastructure | Hardening

### Changes
- <file>: <what changed>

### Migration Notes
- <any DB schema changes, new env vars, data migrations>

### Verified on staging
Yes / No (reason if No)

### Rollback commit
`xxxxxxx`
```
