---
name: Settings & Admin Architecture Map
description: Map of every settings/admin/config surface in the CRM (legacy JS views + backend routes) — load before touching Settings, Admin, Sync, Sandbox, Public API, SDR Settings, POD Management, Upload Center, or System Logs, or before continuing the Settings → Control Center React modernization consolidation.
---

## Purpose

This repo's admin/config surface grew as separate legacy views, each bolted on
independently. There is no single "Settings" concept today — there are at
least 9 top-level nav entries that are really configuration or admin-facing,
plus a wrongly-labeled tab. This skill is the map, kept current, so nobody has
to re-derive it from scratch every time. **Update this file whenever you
revise/re-explore any of the surfaces below** — that's the whole point of it
existing.

## Current surface map (as of 2026-09-02, v11.10.5)

### `#settings` — Admin Settings page (`frontend/js/views/settings.js`, 1526 lines)
Orchestrator shell: renders the tab strip + panel containers, delegates each
tab's real logic to a sibling file. Tabs (`.settings-tab-panel[data-panel=...]`):

| Tab (`data-panel`) | Who sees it | Actual content | Bound by |
|---|---|---|---|
| `connection` | Admin+ | Salesforce OAuth connect/status, Data Summary (lead counts by stage), **Nylas Email Integration** | `settings_connection.js` (`bindConnectionTab`) |
| `sync` | Super Admin | **Mislabeled** — "🔄 Sync Settings" tab actually contains 4 unrelated cards: Salesforce Sync Settings, POD Settings, Call & Pipeline Settings, Call Outcomes Configuration | `settings_sync.js` (`bindSyncTab`, `renderCallOutcomesConfig`) |
| `ai` | Super Admin | AI Research Configuration (LLM provider/key/model), Research Prompt Editor, Research Gate toggle, Bulk Research Pre-Population | **markup only** in `settings.js` (~346-532) — the actual bind logic (save/test handlers, the dynamic gate label, bulk-research polling) lives in `settings_ai_dialer.js:46-360`, not inline as this row previously claimed |
| `channels` | Super Admin | "📞 Calling & Messaging" — Aircall Configuration, Alternate Messenger Conversations, **User Access** (per-user calling/messaging capability grid, added v11.10.4 with pagination+filters+drawer), New Agent Assignment drawer | `settings_ai_dialer.js` (`bindAiDialerTab`) — despite the filename this is the calling/messaging tab, not just "AI dialer" |
| `publicapi` | Super Admin | Public API key generation/rotation ("Super-Admin-equivalent read access") | inline in `settings.js` |
| `sandbox` | Super Admin | Sandbox Data Refresh (clone prod→sandbox), env badge | inline in `settings.js` (`_initSandboxTab`) |

### `#my-settings` — SDR Settings (`frontend/js/views/sdr_settings.js`, 396 lines)
**Different audience**: every user (not admin-gated), their own prefs, not org
config. Cards: Email Sync (connect/disconnect own mailbox), Dialer (own
caller-ID display, dialer on/off toggle — read-only, admin-managed). This is
"my account", conceptually separate from org-wide Settings even in a merged
Control Center.

### Other admin-facing nav entries that are really config/admin surfaces, not merged with Settings today
- `#admin` (`frontend/js/views/admin.js`) — "Admin Panel"/"Team Management": users, roles, POD assignment.
- `#pods` — **Already React upgraded** (`PodsHub`, v11.5.7+), Team Roster tab.
- `#upload` (`upload.js`, `upload_csv.js`, `upload_gsheet.js`) — CSV/Google Sheet lead import. Operational workflow, arguably stays separate from "config".
- `#audit-logs` (`audit_logs.js`), `#sf-logs`/`audit_sf_logs.js` (`sf_logs.js`) — read-only audit trails. Nav label "System Logs".
- `#assignments` (`assignments.js`) — lead auto-assignment rules, admin-only.
- `#disqualify-requests` (`disqualify_requests.js`) — an operational queue/inbox, not config; likely stays out of Control Center.
- `#activity-monitor` — **Already React upgraded** (`ActivityMonitorHub`), consolidates the old Call Monitor + Activity Feed (see `/Users/neelmani-mishra/.claude/plans/i-was-working-on-idempotent-ritchie.md` for that update's plan — check whether it's marked done before assuming legacy `call_monitor.js`/`activity_feed.js` are gone).

### Nav reality check (`frontend-react/src/layout/NavSidebar.jsx`)
Today's top-level items include, separately: Settings, Admin, Upload Center,
System Logs, Activity Monitor, POD Management, My Settings — 7 different nav
entries for what is conceptually one "manage the org" concern, at varying
modernization states (Pods Hub and Activity Monitor already React islands;
Settings/Admin/Upload/Logs still legacy `innerHTML` views).

## Known problems (root-caused, not guessed)

1. **The `sync` tab is a grab-bag.** Its label promises Salesforce sync only; it silently also holds POD settings, call/pipeline settings, and call outcomes config. Anyone looking for "how do I change call outcomes" won't think to click "Sync Settings".
2. **`settings_ai_dialer.js`'s name lies about its scope.** It binds the entire Calling & Messaging tab (Aircall, Alternate Messenger, per-user capability grid) — not just "AI dialer" — because it grew from an AI-dialer-only origin (see `[[project_messaging_access_incident]]`-style history: this file predates the Alternate Messenger multi-provider work).
3. **No single "org configuration" concept.** A Super Admin managing the org today bounces across Settings (6 tabs), Admin (users/roles), Upload Center, System Logs, and POD Management — 5 separate top-level surfaces, each with its own header/layout conventions, none sharing the React `components/ui/` primitives that Leads Hub, Pods Hub, Power Dialer Hub, Activity Monitor already standardized on (see `168058d` "standardize UI patterns onto components/ui/ across the whole React app").
4. **My Settings vs Settings** is the one split that's actually correct (different audience) — don't merge these into one page in the Control Center plan, just make sure the Control Center doesn't accidentally absorb personal-prefs UX.

## Consolidation direction (React consolidation target — "Control Center")

Discussed with the user 2026-09-02, no code written yet. Target shape:
one React-mounted `ControlCenterHub` (same pattern as PodsHub/ActivityMonitorHub:
`*-entry.jsx` + `vite.config.*.js` + mount block in `app.js` + nav entry),
replacing the Settings/Admin/Upload/System-Logs/POD-Management nav sprawl with
one entry and an internal section nav, structured by function instead of by
which legacy file happened to render it:

- **Integrations** — Salesforce (connection + sync, correctly separated this time), Nylas Email, Aircall, Alternate Messenger, Public API keys.
- **Team & Access** — Users/roles/PODs (today's `admin.js` + `pods` roster), per-user calling/messaging capability grid (today's User Access grid), lead auto-assignment rules (today's `assignments.js`).
- **AI & Automation** — AI Research config/prompt/gate, Call Outcomes Configuration, Sales Cadence send-window settings (`SendWindowSettings.jsx`, already React).
- **Data** — Upload Center, Sandbox refresh.
- **Monitoring** — System Logs (audit + SF logs), read-only.

`My Settings` stays a separate, lightweight "my account" surface — not folded
into Control Center.

This is a large multi-phase frontend-react effort; do not start implementing
without a proper phased plan reviewed with the user first (mirror the phasing
style used for the Activity Monitor modernization plan: backend-first where an
endpoint reshape is needed, one section at a time, legacy kept as fallback
until parity is verified, ponytail-review + ponytail-audit before any
staging→main promotion per this repo's `CLAUDE.md`).

## Maintenance

This file is a living map, not a one-time snapshot. Whenever you go back into
any file listed above to fix a bug, add a field, or re-verify behavior against
real data — update the relevant row/section here before moving on. If a
consolidation phase ships, replace the "Current surface map" section (or the
relevant rows) with the new reality rather than leaving it stale, and record
what shipped under a dated line in this Maintenance section so future reads
know which parts of the plan above are done vs. still aspirational.

- 2026-09-02: Initial map written (no code changes). Confirmed `activity-monitor` and `pods` nav entries already exist and route to React hubs — verify against `/Users/neelmani-mishra/.claude/plans/i-was-working-on-idempotent-ritchie.md` before assuming that consolidation is fully complete (legacy `call_monitor.js`/`activity_feed.js` may still be present as fallback).
- 2026-09-02: Control Center Phases 0-5 all built (scaffold, Integrations, Team & Access, AI & Automation, Data, Monitoring — see the plan file) plus Phase 1.5 (access-granted email on `PATCH /admin/users/{id}/settings`). This is a **new, additive, personal-only surface** (`frontend-react/src/features/control-center/`) — every legacy page/row in the table above is still the one real users and every other admin actually see and use; nothing in this skill's "Current surface map" changed as a result. Corrected the `ai` tab row above (bind logic is in `settings_ai_dialer.js`, not inline) — caught while porting it.
- 2026-09-03 (v11.11.1): Monitoring section extended to full parity with `audit_logs.js` — added Login History, Feedback (the section's one write action), Error Logs, Call Logs, and Perf Health (Super Admin only, matching legacy's own gate) tabs. All 5 reuse existing, already-gated backend endpoints; no backend changes. `audit_logs.js` itself remains completely untouched and is still what everyone else uses — this only closes the parity gap on the Control Center side.
- 2026-09-04 (v11.12.3+): Closed the last real parity gaps and widened access:
  - Data section gained Upload History + Rollback (was deliberately deferred, per the section's own comment) — reused the already-existing but unused `getBatchMetrics`/`getBatchDetail` endpoints, and fixed a real bug where they (plus `getLogs`) all silently pointed at the wrong endpoint.
  - Integrations gained the 9 sync settings that were left behind when only Sync Direction + Call Outcomes were ported from `settings_sync.js` (Lead Sync Limit, SF Push Stage, Record Types filter, declined/unreachable sync toggles, Auto-Sync Schedule, POD multi-pod toggle, 5 Call & Pipeline fields) — also fixed `SettingsService.getRecordTypes` calling the wrong endpoint. Monitoring's SF Sync Log tab gained the stats row, auto-refresh, and CSV export it was missing.
  - **Visibility gate widened from a single owner email to `role === 'Super Admin'`** (`app.js`, `NavSidebar.jsx`, `ControlCenterHub.jsx`, `constants.js` — `CONTROL_CENTER_OWNER_EMAIL` removed entirely). Deliberately NOT widened to Pod Admin — Data and most of Monitoring have no internal role sub-gating and are Super-Admin-only in legacy.
  - **Legacy nav changed**: `upload` (Upload Center) and `audit-logs` (System Logs) removed entirely — both were Super-Admin-only in legacy with full Control Center parity now, zero regression for anyone. `settings` and `admin` role-scoped from `['Super Admin', 'Pod Admin']` down to `['Pod Admin']` only — Super Admins now use Control Center, Pod Admins are unaffected (Control Center doesn't admit them yet). `pods` (POD Management) untouched — not covered by Control Center at all.
  - **`assignments.js` ("Lead Assignments") disconnected from `admin.js`/`app.js`'s `#assignments` route** — verified it was already 100% unreachable dead code there (no button/link anywhere ever called it) and that `frontend-react/src/features/leads-hub/` already has full functional parity (bulk assign/unassign/delete, per-row unassign, Round Robin auto-assign, matching role gating) as ordinary actions on the main Leads page — more discoverable than the old buried page ever was. The file itself is untouched and still has one real caller left: the classic (pre-React) Leads page's own "Assignments" tab (`lead_list.js`).
  - Added a Control Center section to the in-app User Guide (`help-hub/data/sections.js`), plus pointer notes in the old Admin Panel/Settings/Audit Logs sections for Super Admins.
- 2026-09-09 (v12.2.2): Copy and structure fixes on two of the surfaces above, driven by staging validation.
  - **Control Center's subtitle was stale for every role.** It read "additive alongside the existing Settings, Admin, Upload Center and System Logs pages" — Upload Center and System Logs were removed in v11.12.3, Settings and Admin in v12.2.1, so it named four pages nobody has. It read worst for a Pod Admin, who sees exactly one tab (Team & Access). Now derived from the sections actually visible: POD-scoped copy when Team & Access is the only one, generic org copy otherwise (`ControlCenterHub.jsx`).
  - **My Settings merged "Email Branding" and "Email Signature" into one "Email Sign-off" card** — they were two cards for one decision (what gets appended to the foot of your outgoing mail), with the branding switch now sitting under the signature it applies to. `MySettingsTour`'s two consecutive steps collapsed to one. Its page subtitle also pointed at "Settings" for org-wide config; replaced. The **"one split that's correct"** note above still holds — this is internal tidying of My Settings, not a merge into Control Center.
  - **My Settings' Email Sync card gained a third state.** `GET /api/email/status` now returns `needs_reconnect`, so a mailbox that is linked but cannot send (Nylas 401/403 → `UserMailbox.status = "error"`) shows "Reconnect needed" instead of being collapsed into "Not connected". `email_send.py` (the shared Campaigns + cadences path) now marks that status, which `routes/email_routes.py`'s own `/email/send` always did — that gap is why a failed campaign left a green "Connected" badge.
  - **`PATCH /api/admin/sync-settings` moved from `require_admin` to `require_super_admin`.** `require_admin` admits Pod Admin, and that route writes the whole org-wide config this skill maps (Salesforce sync, Aircall/Alternate Messenger credentials and provider, POD and call-outcome settings). `GET` stays on `require_admin` (masked secrets, legacy read-only callers). Worth knowing when reading the "Who sees it" column above: the legacy `settings.js` tabs were already Super-Admin-only in the UI, so this only closed the API gap.
  - **`app.js`'s legacy role-based nav gating is gone** — all 21 `getElementById('<name>-nav-item')` toggles, plus the ~97-line Global AI Query Bar block whose four ids are likewise absent from `index.html`. `NavSidebar.jsx`'s per-entry `roles` list is now the only place nav visibility is decided; `injectSmartAnalyticsStyles()` and `window._runAiQuery` stay, because the React topbar Ask AI uses both.
- 2026-09-16 (v12.6.x, guardrails on the Opportunity/Account sync toggle in production): a Super Admin turning the Integrations "Pull" toggle on saw the Sync Log fill with hundreds of `create` entries against Opportunity/Account and (reasonably) feared real Salesforce records were being created — false alarm, but the UI gave no way to tell inbound from outbound at a glance.
  - **`SalesforceIntegrationLog` gained a `direction` column** (`outbound`/`inbound`), tagged at all 3 pull call sites in `salesforce.py` (Lead/Account/Opportunity sync-from-SF); every push site defaults to `outbound`. Surfaced as a column + filter in Monitoring's SF Sync Log tab and in the detail modal; `Object` (already collected, `sf_object`) was likewise only ever shown in the detail modal — now a table column too, and `OBJECT_OPTIONS`' filter dropdown (never updated since Account/Opportunity sync shipped) gained both.
  - **Integrations' Opportunity Sync toggle reworded and gated behind a `ConfirmDialog`.** The old copy ("Push Only" / "Two-Way Sync") never said which direction was being turned on; now always "Pull Opportunities & Accounts from Salesforce" with copy stating explicitly that turning it on only reads from Salesforce and never writes. Confirm-on-enable only — turning it back off needs no confirmation.
  - No new backend routes or settings keys — `opportunity_sync_direction`/`opportunity_writeback_enabled` are unchanged, this was a logging/copy/guardrail pass on the existing toggle.
- 2026-10-10 (v14.1.0 / v14.2.0): Control Center → **Team & Access** now has Users & PODs (Data Export switch per person, Super Admins can be switched off too), User Access, and **Export History** (Super Admin; `AuditLogPanel`, permanent record of downloads and export-access changes). **Integrations → Salesforce** is one tab (overview, what syncs, schedule/volume, record types, field mapping with built-in rows editable except first/last name, email, phone, status, and a History dialog). Settings hooks (`useUsersRolesData`, `useUserAccessData`) re-read silently after every change and the users list is requested with `fresh=true` — see the alternatecrm skill (v14.2.0) for why a cached list showed stale switches.
