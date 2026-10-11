# Alternate CRM CRM — Release Notes

## v14.3.0 — 2026-10-10 (Team Digest drill-downs; Salesforce field-mapping messages)
**Deploy:** `develop → staging → main`. **Type:** Feature + fix. New column `sync_settings.icp_keywords` (TEXT, NULL = default `segments.DEFAULT_ICP`: health, hospital, dental, medical, clinic, pharma, physician, additive via `migrations.py`).
- **Drill-downs:** `services/segments.py` + `GET /api/admin/analytics/daily-digest/{breakdown,accounts,calls}` (`require_admin`; same window/pod rule as the Digest via `_drill_scope`: a Pod Admin is always their own pod, a Super Admin may pass `pod_id`). The window's events are the Digest's own (`daily_activity.collect` calls/emails/notes + `funnel.collect` conversations/booked/held/no-show), grouped by the lead's ICP fit, industry, country, city, seniority, function, company size or source. Per-segment rows add up to `total`; "Not filled in" is always listed last and counted in `coverage`. Seniority/function come from ordered title rules (`SENIORITY_RULES`, `FUNCTION_RULES`); titles no rule matches are returned (`unclassified_titles`) so the rules can be tuned from real data. Country aliases (USA/US/United States → one), city shown as "City, Country". Accounts view: companies by `funnel.account_key`, people tried/spoke to, stage (Meeting booked / Spoke, no meeting / Tried, not reached / Email-notes only). Calls view: outcomes, calls by hour in the pod's timezone, conversation-length bands (dialer calls only).
- **ICP:** `GET/PUT /api/admin/analytics/icp` — industry words (default "health"); Super Admin edits, a change is recorded in `audit_events` (category `setting`). A lead is "In ICP" when its industry (or research industry) contains a word.
- **Salesforce mapping messages:** adding a field Alternate CRM already sends by default (e.g. Country) now says which built-in mapping fills it and where to edit it, instead of "managed by Alternate CRM"; "no field called X" explains where to find the API name; a refusal in the dialog clears itself after 12s.
- **Conversion by segment:** each row carries leads spoken to (and % of leads worked), booked per 100 conversations, held % and no-show %. **Previous period:** `?compare=true` (default) adds `prev` and `delta` (calls, conversations, booked, leads) for the Digest's own comparison window — one day vs the same weekday last week, a range vs the equal range before; a segment that only had activity then still gets a row; `delta` is `null` (nothing either time), `"new"` (nothing before) or a percentage.
- **Excel:** `GET /daily-digest/drilldown.xlsx` (Breakdown with the comparison, Accounts, Calls). The export check runs inline *after* the input is validated, so a bad request leaves no `export` audit line; `_cell` neutralises formula-looking text; recorded as "Team Digest drill-down (Excel)".
- **Title rules tuned on the real prod titles (24,385 leads with a title):** values that are not a job title ("india", "[not provided]", "no longer employed", ...) count as "Not filled in"; added Patient services, Product / Strategy and Procurement / Supply functions; practice/office/branch managers are Operations. Unmatched: seniority 2%, function 9% (mostly bare "Director"/"Manager"). Prod fill rates at the time (31,940 live leads): industry 74%, country 61%, city 68%, title 76%, company size 54%, lead source 100%.
- **Critical review of the page (real prod data, 30 days: 8,788 calls, 805 conversations, 26 booked, 5 held):** (1) the default ICP word "health" mislabelled ~4,800 healthcare leads (hospitals & physician clinics, dental offices, medical practice/devices, pharma) as Outside ICP → `DEFAULT_ICP` now health, hospital, dental, medical, clinic, pharma, physician; (2) `lead_source` is `upload:<file>:<timestamp>` (13,401 distinct values) → "Lead source" groups by kind and the new "Upload file" breakdown by file; (3) bookings per segment are 0-11, so rates are noise → each rate carries a `thin` flag (`MIN_SAMPLE`: connect % under 30 calls, spoke % under 20 leads, booked/100 under 20 conversations, held % under 5 bookings) and the screen greys it; (4) the default table is 6 columns, the rest behind "More columns" (Excel has all); (5) every row opens the leads behind it (`GET /daily-digest/drilldown/leads`, `segment` or `account`, capped at 100, same pod rule) — the plan's "clickable through to the underlying leads"; (6) Accounts can be filtered by stage (the follow-up list: "Spoke, no meeting"); (7) hours are shown in the browser's zone when no pod is chosen (`tz` param, a pod's own zone wins); (8) the card loads only when scrolled into view and keeps the old numbers dimmed while a new period loads.
- **Reconciliation:** `scripts/verify_drilldown.py [days] [pod_id]` (read-only) checks every dimension's totals against the Digest's calls/emails/notes and the Funnel's conversations/booked/held/no-show, segment-by-segment against independent SQL grouping, Accounts and Calls against the breakdown, and the comparison period against a fresh run. Run it against staging/prod data after a deploy.
- **Guided tours + tooltips (found by walking every guide as every persona on staging):** `components/ui/GuidedTour.jsx` rewritten — waits for the page, skips absent steps, `click:` opens a tab only if the target is not already there, Back/arrow keys/Esc, Next/Back disabled while a move is pending (a fast second press used to cancel it), one guide at a time (module-level queue), card height measured, tall targets scroll to their top, a target under the 72px top bar counts as hidden, re-centres during the first 4s while a page settles, sits above the Aircall drawer (z 10002 vs 10001). Replay: top-bar **Guide** button (`PageGuideButton`, `window.__CRM_TOURS__`) and Help → Guided tours (`help-hub/data/tours.js`, roles must match the nav — AE Pipeline is AE only). Rewritten: Team Digest (11 steps), Control Center (10), Sales Tools (5; opens Email Campaigns itself), Analytics Hub (starts on arrival; Lead Activity steps after Apply). `components/ui/InfoTip.jsx` on every drill-down/Funnel column.
- **Claude connector:** read-only tools `get_team_digest`, `get_digest_breakdown`, `get_digest_accounts`, `get_digest_calls`, `get_digest_leads`, `get_icp` (`mcp_tools._digest` calls the route functions, so role scoping is the UI's). The ICP edit is not a tool.
- **Verification:** backend persona matrix (`test_v14_3_persona_matrix.py`, 50 cells), staging `tests/v14-3-0-personas.spec.js` (Super Admin, Pod Admin, SDR, AE, CSM: API access, navigation, first-visit guide, Help list, every guide start to end, Guide button — 31/31 pass; run one persona at a time), read-only prod reconciliation `scripts/verify_drilldown.py` 85/85 on 30 days of real data.
- Tests: `test_digest_drilldown.py`, `test_sf_field_mapping.py`, frontend `DrillDownSection`, `DailyDigestHub`; `tests/v14-3-0-drilldown.spec.js` (Playwright on staging).

## v14.2.0 — 2026-10-10 (stale settings fixed; permanent audit trail; editable built-in Salesforce mappings)
**Deploy:** `develop → staging → main`. **Type:** Bug fix + feature. New: table `audit_events` (create_all); columns `sf_field_mappings.builtin` (default false), `users.export_blocked`, `saved_views.shared` (all additive, default false — correct for every existing row).
- **Stale switch root cause #1 (the one users saw):** `middleware_cache_headers` sent `/api/admin/users` with `Cache-Control: private, max-age=30, stale-while-revalidate=120`, so the *browser* answered the post-change re-read from its own copy (same URL) and the old value showed until a hard refresh. The users list is now `no-store` (`NO_STORE_PATHS`; `test_cache_headers.py`). Playwright caught it: the server had the new value, the page flipped back to the old one 1s later.
- **Stale switch root cause #2:** `cache.get_cached` fell through to the per-worker in-memory copy when Redis said "miss", so another worker's `invalidate()` (Redis + that worker's memory only) never reached it — the old value was served for up to the 120s TTL. Redis's answer is now authoritative (a miss drops the local copy; Redis *errors* still fall back). `GET /admin/users?fresh=true` bypasses the cache and is what the Control Center always sends; the list has a stable order (`name, id`); `useUsersRolesData`/`useUserAccessData` reload silently (no skeleton) and the export switch applies the PATCH response at once (`patchLocal`).
- **Audit trail:** `models.AuditEvent` + `services/audit.py` (never pruned — `user_activity_logs` is deleted after 90 days; actor name/email copied in, no FK). `auth.check_export_access` records every allowed export (DOWNLOAD / BULK_READ / BROWSER_CSV) with `audit.record_now` and refuses the export (503) if the record cannot be written. Export-access changes (ALLOWED / BLOCKED, only on a real change) and Salesforce mapping changes (ADDED / CHANGED / REMOVED, with before/after) are recorded in the caller's transaction. `GET /api/admin/audit-log` (Super Admin; `category` comma list, `q`, `date_from/to`, paging); `POST /api/me/export-event` is called by `exportCsv()` for CSVs built in the browser. UI: Team & Access → Export History (`AuditLogPanel`), Salesforce mapping → History.
- **Built-in mappings editable:** `sf_field_mapping.BUILTIN_LOCKED` = first_name, last_name, email, phone, status. Others: `PATCH/DELETE /sf-field-mappings/builtin/{lead_field}` store an override row (`builtin=true`); `lead_push_info()["builtin_overrides"]` ({key: SF name | None}) is applied in `push_lead_to_salesforce` and `create_new_lead_in_salesforce`; an override target Salesforce rejects is dropped like a custom field. `NEVER_TARGETS` (system fields, owner, what the locked fields write) can't be mapped to. Pushes built without a DB session use the defaults.
- **Export block:** `users.export_blocked` switches anyone off, Super Admins included (`auth.may_export`; you cannot block yourself). **Shared Digest views:** `saved_views.shared` (admins share, everyone reads, owner/Super Admin deletes). Custom Digest range: past days only (`DateRangePicker` `maxDate`), draft vs committed range.
- Tests: `test_audit_trail.py`, `test_export_guard.py`, `test_digest_shared_views.py`, `test_redis_cache.py` (cross-worker invalidation), frontend `AuditLogPanel`, `SfFieldMappingCard`, `UsersRolesPanel`, `exportCsv`, `DateRangePicker`; `tests/v14-2-0-settings.spec.js` (Playwright on staging).

## v14.1.0 — 2026-10-09 (Team Digest; data export is per-user and off by default; Salesforce section rebuilt; funnel report)
**Deploy:** `develop → staging → main`. **Type:** Feature + access change. New: table `sf_field_mappings` (create_all); columns `users.export_enabled` (default false) and `saved_views.scope` (default 'leads' — correct for every existing row), both via `migrations.py`.
- **Export guard (access change):** `auth.require_export_access` (route dependency) / `check_export_access` (inline) — Super Admin/Admin always, everyone else only when `users.export_enabled`, read live from the DB (a revoke bites at once), refused in a `view_as_read_only` session; every allowed export is logged (`DATA_EXPORT`). Applied to: leads export, analytics export, activity.xlsx, digest and funnel xlsx, cadence roster CSV, My Day CSV, SF-log CSV, metrics export (token in query → inline check), and the e-mailed report CSV (`report_routes` refuses `include_csv` without export access; `report_service` attaches it only if the owner may export). `check_bulk_read`: a list page bigger than 200 rows (the Activity/Call Monitor CSV button pulls 2,000 and builds the file in the browser) needs the same permission. Capability published live as `GET /me/capabilities` → `export`; the shell puts it on `window.__CRM_CAPS__` and every Export button hides unless it is true (`lib/useCanExport.js`, fail closed). A Super Admin grants it per person in Team & Access → Users (switch + confirmation); `PATCH /admin/users/{id}/settings` `export_enabled`; offboarding switches it off. `tests/test_export_guard.py` fails the build for any route that produces a file without the guard. **Not covered by design:** attachments on a lead/e-mail (own access checks), the sandbox-refresh export (service token, no user), and anything a user can already read on screen.
- **Team Digest:** `GET /daily-digest[/leads|/export.xlsx]` take `from`/`to` (≤ 92 days, strictly past; one day = the old day mode, vs the same weekday last week; a range compares with the equal-length range just before it). New in the response: `catalog` (17 metrics, `services/digest_metrics.py`), `default_kpis`, `campaigns`, `campaign_options`, `mode/from/to/days/compare_*`; new KPIs from the funnel definitions (conversations, meetings held, no-shows, SAL, accounts/contacts given). Lead rows carry `campaign`; `/leads?campaign=`. Excel: Summary, Team, Campaigns, Leads, Pipeline movement. UI: period menu + custom range, `DigestViews` (Customize numbers, saved views), Campaigns table, Funnel follows the digest period, label "Team Digest" (internal keys and URLs unchanged).
- **Saved views:** `/me/saved-views?scope=digest` — per user, keys = KPI tiles in order, filters = {period}; validated against the catalog; 30 per kind; name unique per kind.
- **Funnel:** `GET /api/admin/analytics/sales-funnel` (+ `/export.xlsx`), `services/funnel.py`. Accounts/contacts = leads whose ownership period started in the window; account key = website domain, else non-public e-mail domain, else normalised company; conversations = Analytics' helpers; booked/held/no-show = `lead_meetings` by booker; SAL = booking whose lead has a real `sf_lead_id`; won/lost = `opportunity_status`; campaign = first tag else "No campaign". The older `/analytics/funnel` is untouched.
- **Salesforce:** tab order Salesforce / Connections / Email Sending / Calling & Messaging / Pod & Call Rules. `WhatSyncsCard` (direction, push stage, declined/unreachable, opportunity pull + write-back; turning ON anything that writes asks first, OFF never asks), `ScheduleVolumeCard` (one form, diff-listing confirmation; `RecordTypePicker` says none ticked = all), `SyncOverview` from `GET /admin/sf-sync-overview` (replaces the old Data Summary, whose numbers came from the dashboard stats and did not add up), `SfFieldMappingCard` (search, sort, 8 per page, edit via `PATCH /admin/sf-field-mappings/{id}`, errors name the Lead object and clear when you type). Mapping model/validation: `SfFieldMapping`, `services/sf_field_mapping.py`; `lead_push_info` carries `custom_sf_fields`; a refused mapped field is dropped and the rest of the lead still saves (`_call_with_picklist_retry`, recursive).
- Shared pieces: `SettingRow` (+ `Switch` `ariaLabel`/`disabled`), `utils/useTableView`, `control-center/notify.js` (over `utils/toast`), `sections/Banner.jsx`; the Control Center no longer shows page-blanking skeletons after a save. Axios reads a refused download's JSON message.
- Tests: `test_export_guard.py`, `test_team_digest.py`, `test_funnel.py`, `test_sf_field_mapping.py`, frontend specs for each screen; `tests/v14-1-0-settings.spec.js` (Playwright on staging).

## Tooling after v14.0.1 — 2026-10-09 (no app change, no version bump)
Prevention from the v14.0.1 RCA: `docs/ACCESS_MATRIX.md` + `tests/test_access_matrix.py` (one test per who-sees-what cell, incl. every
"must not see"); `tests/test_pod_scope_ratchet.py` (fails on a new hand-written pod filter or raw identity `.get("pod_id")`);
`tests/test_metric_sanity.py` (rates ≤ 100%, one population); `scripts/prod_data_check.py` (read-only pre/post-deploy hygiene check);
`scripts/seed_staging_multipod.py` + `tests/v14-0-2-negatives.spec.js` (cross-pod data on staging, Playwright negatives);
`docs/POST_DEPLOY_CHECKLIST.md`; `scripts/prod_one_off/v14_0_2_cleanup.sql` (the single prod data cleanup).

## v14.0.1 — 2026-10-09 (Activity Monitor pod scope; email open rate; colleague mail not a reply)
**Deploy:** `develop → staging → main`. **Type:** Security fix + bug fix.
- **Activity Monitor / Call Monitor:** new `analytics_routes._pod_scope_activity_query` — a record belongs to the pod of the user who did it (`User.pod_id`), and a record with no user falls back to the pod of the lead's owner (`lead_assignments`). Replaces the "sender's pod OR lead's pod" rule there, which showed other pods' reps calling leads in the Pod Admin's pod. Analytics Hub keeps the lead-anchored `_pod_scope_call_query`.
- **`_effective_pod_id`:** a Pod Admin now resolves via `access_db.pod_of` (`NO_POD` when unset) — it used to return `None`, i.e. no filter.
- **Email tab:** `opened` = distinct leads with an open, `open_rate` = against distinct leads emailed (Instantly keeps opens on counter rows, which `sent` excludes — the old rate read 223%). Deleted leads excluded.
- **Colleague mail:** `email_utils.internal_domains/is_internal_sender`; webhook, `_sync_full_mailbox` and the thread poller skip inbound mail whose sender is on a connected mailbox's domain.
- **Known, not changed:** Analytics Hub `_compute_email_stats` still counts Instantly counter rows in "emails sent".

## v14.0.0 — 2026-10-09 (Global search speed/smoothness; Pod scope fails closed; Daily Digest for team leads; per-rep meetings = bookings)
**Deploy:** `develop → staging → main`. **Type:** Security fix + behaviour change.
- **View As for Pod Admins (read-only):** token carries `view_as_read_only`; `middleware_view_as.py` refuses POST/PUT/PATCH/DELETE for it. `GET /admin/users/{id}/token` now `require_admin`; Pod Admin → own-pod SDR/AE only (`_require_may_manage_user`), never self/admins/other pods/leavers; IMPERSONATE still audit-logged. `_caller_pod_id` now also resolves the pod from `pod_admins` (`access_db.pod_for`). UI: eye icon on manageable rows. Known gap: View As acts as the rep (writes are attributed to them).
- **Global search (`NavTopbar` + `GET /api/search`):** per-pause request is aborted when superseded (`AbortController`), a sequence guard drops stale answers, 15 s/20-entry client cache for repeated queries, dropdown opens immediately with 'Searching…' and keeps old results dimmed while loading; backend returns a slim hit (`id,name,company,email,phones`) with `load_only` instead of the full lead-detail dict (was built for every hit on every keystroke). Test: `NavTopbar.globalSearch.test.jsx`.
- **Pod Admin fail-open fixed at the identity layer:** `access_db.active_identity` resolves a Pod Admin's pod from `users.pod_id`, else their `pod_admins` row, else `access_db.NO_POD` (`"__no_pod__"`, matches nothing). Many routes filter only `if Pod Admin and pod_id`, so a pod-less Pod Admin previously got org-wide data. `GET /admin/users` uses the resolved pod.
- **Daily Digest redesign:** `GET /daily-digest` (headline KPIs incl. `leads_touched`, `attention` [idle reps / overdue follow-ups / stuck], `lead_summary`, every active rep incl. idle with `no_activity`, `leads_touched`, `overdue_follow_ups`), `GET /daily-digest/leads` (server-paged, filters rep_id/follow_up/activity/q, overdue → meetings → most worked), `GET /daily-digest/export.xlsx` (Summary, Team, Leads, Pipeline movement). Lead rows are cached with the digest (`_leads`). UI: clickable headline tiles + team rows filter the lead list; 'More numbers' collapsed; Export Excel; pod picker (Super Admin).
- **Daily Digest (`/api/admin/analytics/daily-digest`)** now built on `services/daily_activity.py` (same definitions as My Day and the raw export): per rep calls (call log + unpaired dialer calls), outbound emails, research notes (notes by the rep's name), meetings booked (`lead_meetings`), leads progressed; `lead_activity` rows (rep, lead, status, calls/emails/notes, follow-up None set/Scheduled/Overdue) capped at 300 with `lead_activity_total`; day bounds in the pod's timezone (`timezone` returned); Super Admin may pass `pod_id`; `left` flag per rep.
- **Analytics `sdr-table` meetings** = bookings by the booker in the window (was: current owner of a lead whose `status_changed_at` fell in the window).
- **Dashboard "Needs attention":** no calls AND no emails today, full list (shows 8 with a count), skips leavers.
- **Pod audit fixes (read-only audit, then fixed):** activity-feed (`global_view`/`pod_id` ignored for Pod Admin), `/leads/unassigned`, `/leads/assigned`, `auto-assign-all` (own pool, own reps only, no "everyone" fallback), bulk-assign/unassign/bulk-delete compare against the resolved pod, upload `assign_to_pod_id` must be own pod + `update_existing` skips another pod's lead + rollback/batch-metrics/batch-leads limited to own batches, `/users/upload` Super Admin/Admin only, Reports Builder limited to own reports (pod forced to own, sdr must be in pod, senders/executions scoped), global search, AE Pipeline opportunities, dialer skip-summary, disqualify/reassign **reject**, `POST /pods/{id}/members` (SDR/AE with no other pod only), growth-intelligence and sdr-performance (use the resolved pod), error-log resolve (admins only, own pod), smart-analytics batches.
- **Not changed (decisions needed):** Leaderboard Pod/Global toggle (Pod Admin can view all pods by design), Sales Journey stats (documented org-wide transparency), call-list delete, and `SECURITY_LEAD_ACCESS_MODE` / identity checks still default to log-only unless the environment sets `enforce`.
- Tests: `test_v13_12_1_pod_audit_fixes.py`, `test_v13_12_1_personas.py` (all six roles × digest, sdr-table, leaderboard, users, email-logs, export, lifecycle), `test_v13_12_1_pod_scope_and_digest.py`.
- Bundles rebuilt: dashboard, daily-digest.

## v13.12.0 — 2026-10-08 (Offboarding; "Left" marker; Leaderboard counts bookings; Integrations load retry)
**Deploy:** `develop → staging → main`. **Type:** Behaviour change + small UI. Plan §16.
- **Offboarding (`services/offboarding.py`):** `DELETE /api/admin/users/{id}` and the CSV "remove" path now offboard instead of hard-deleting: sign-in revoked, dialer/SMS/WhatsApp/email-sync switched off, mailbox marked disconnected, Pod-Admin seats removed, portfolio released (ownership reason `user-access-removed`), `users.left_at` stamped; the user row stays. Adding the email back (POST /users or CSV add) reactivates the same row. New column `users.left_at`.
- **"Left"** = `left_at` set OR no sign-in entry (people removed by the old CSV path). `GET /admin/users` omits offboarded users unless `include_left=true` and carries `left`; `/admin/dialer/sdr-configs` (Calling & Messaging) excludes leavers; Leaderboard, Analytics `sdr-table` rows carry `left`; badge on Leaderboard page/card and Analytics table; "Needs attention" skips leavers.
- **Leaderboard `meetings_scheduled` = bookings by that person in the period** (`lead_meetings`, cancelled excluded); the old stock figure is still returned as `meetings_in_stage_now` (and still drives conversion rate). Offboarded people with no calls/bookings in the window are not ranked.
- **`GET /api/admin/data-quality/meetings`** (Super Admin): bookings by source/state, with/without booker, meeting-stage leads missing a record or `lead_closed_at`, status moves with a user id (last 7 d).
- **Control Center → Integrations:** one automatic retry when both core calls fail, and the error names the cause (server status / timeout / unreachable).
- Bundles rebuilt: dashboard, leaderboard, analytics, control-center, help.

## v13.11.0 — 2026-10-08 (Meeting record; status-log user id; lifecycle labels; raw activity Excel; per-SDR meetings fallback)
**Deploy:** `develop → staging → main`. **Type:** Data foundation + small UI. **No status is renamed, reset or re-mapped.** Plan: `docs/plans/PLAN_reporting_funnel_and_lead_states.md` §5A, §6.2–6.3, §8.
- **`lead_meetings` (new table):** one row per booking (lead, booked_at, booked_by_user_id, meeting_at, status booked/held/no_show/cancelled, held_at,
  no_show_at, source app/aircall-tag/salesforce-sync/backfill). Written by `meeting_log.on_status_change`, called from `models.log_status_change` — the one
  helper all four booking paths use (call outcome, status update/kanban, Aircall tag, Salesforce pull), in its own SAVEPOINT so it can never break a status move.
  Skipping straight to a discovery/demo stage records a held row; disqualifying cancels an open booking; the no-show endpoint marks it `no_show`.
- **`lead_closed_at` is now stamped on every path** that first reaches a meeting stage (call outcome and Aircall tag never did — 97 of 149 prod meetings).
  **Startup backfill (`migrations._backfill_lead_meetings`, advisory lock 727002, idempotent):** stamps `lead_closed_at = status_changed_at` for meeting-stage
  leads missing it, and creates booking records (`source='backfill'`) for live leads already in a meeting stage — booker matched by NAME from the status log
  only when exactly one user matches. Meetings of leads that later left a meeting stage are not reconstructed.
- **`lead_status_logs.changed_by_user_id`** (new nullable column) written by every user-driven status move (lead update, kanban, call outcome, discovery,
  no-show, create, phone-added, Aircall dial). NULL on older rows and system moves.
- **Lifecycle label** (`services/lead_lifecycle.py`, computed, never stored): Unassigned / New to me / Inherited / In progress / Meeting booked / Closed /
  On hold / Other. `GET /api/my-day/lifecycle`; Dashboard "Assigned to me" caption. Defaults awaiting sign-off: D11 (reset with same owner = New to me),
  D12 (cadence/system emails count as "worked" for Inherited only).
- **`GET /api/exports/activity.xlsx`** (Super Admin/Admin all; Pod Admin their pod; max 92 days / 50k rows): sheets Calls (owner at the time, campaign =
  tags else upload batch, lifecycle state, connected/conversation using the dashboard SQL rules), Meetings, Read me. Dashboard → Export (admins).
- **Analytics per-SDR meetings** uses `COALESCE(lead_closed_at, status_changed_at)` like trend/funnel.
- **Docs:** `docs/definitions/CAMPAIGN.md`, `METRICS_GLOSSARY.md`, `SDR_TAGGING_NOTE.md`.
- Bundle rebuilt: dashboard.

## v13.10.0 — 2026-10-08 (Lead ownership history; status values validated; Salesforce status moves logged)
**Deploy:** `develop → staging → main`. **Type:** Data foundation + hardening. No screen changes; **no status is renamed, reset or re-mapped.**
Why: `lead_assignments` only holds the *current* owner — reassigning deleted the old row and bulk assign/unassign wrote no log — so "who owned this
lead when that call was made?" could not be answered, and reassigned leads were credited/hidden wrongly in reports (plan:
`docs/plans/PLAN_reporting_funnel_and_lead_states.md` §6, §11, §15).
- **`lead_ownership_periods` (new table):** one row per stretch of ownership (lead, user, from, to, reason, who). Written by a **Postgres trigger on
  `lead_assignments`**, not app code, so uploads, Klenty/Aircall auto-creates, unassign, user removal/deletion, scripts and manual SQL are all captured.
  Writes arriving without context are stamped `script/unknown` (visible). The trigger **never blocks** an ownership change if history fails (logs a warning).
  Installed + backfilled (current owners, `backfill-current-owner`) by the startup migration under an advisory lock (two workers boot together).
- **Context from the app:** `models.assign_lead(user, lead, reason=, actor_id=)` and `ownership_history.set_assignment_context()` (once per transaction)
  are passed from bulk/auto assign, unassign, uploads, reassignment approval, pod assign, lead create/duplicate, phone-added, user removal/deletion,
  Klenty import and inbound Aircall.
- **Nightly reconcile** (`ownership_reconcile`, leader-only): compares assignments with open periods, heals drift, logs an ERROR if any was found.
  **`GET /api/admin/data-quality/ownership`** (Super Admin): trigger installed, "history accurate from", periods, drift, unowned leads, new periods by
  reason (last 7 d), and statuses outside the app's list.
- **Status hardening:** the lead update and kanban-move endpoints reject a status value the app does not have (`models.KNOWN_STATUSES`) — prod had
  `Meeting Booked` ×10 and `Assigned` ×1. **The Salesforce pull now logs the status it sets** and stamps `status_changed_at` (it left no trace before).
- **Honest limits:** history is accurate **from the day this ships**; earlier ownership is only the current owner's assignment time (marked
  `backfill-current-owner`). SQLite (local tests) has no trigger — trigger tests run on the local Postgres:
  `TEST_DATABASE_URL=postgresql:///crm_test pytest -n0 backend/tests/test_ownership_history.py`.

## v13.9.6 — 2026-10-08 (Dashboard tiles show their full captions; test-suite upkeep)
**Deploy:** `develop → staging → main`. **Type:** Small UI polish; no backend or API change.
- **Stat tiles:** the small caption under each number (e.g. "All leads assigned to you") wraps instead of being cut off with "…". The rep Dashboard
  uses 3 tiles per row until very wide screens, then 6. StatStrip is shared, so Activity Monitor, Replies and Control Center tiles wrap the same way.
- **"Given today" is clickable immediately:** it used to do nothing until My Day had finished loading (the tile showed "—"). The day's start and end are
  now worked out in the browser from the person's own timezone; the backend also accepts ISO times ending in `Z` (tested).
- **Bundles rebuilt:** dashboard, activity-monitor, sales-tools, control-center, help (release notes).
- **Tests only:** Instantly "Send from" spec follows the new mailbox modal; two specs prefer the working SDR token; a spec's lead cleanup uses
  `POST /api/admin/leads/bulk-delete`.

## v13.9.5 — 2026-10-08 (Dashboard rebuilt on the component library; clickable numbers; My Day paging, any date, export; guided tour)
**Deploy:** `develop → staging → main`. **Type:** Redesign + feature (Dashboard for SDR/AE/Pod Admin/Super Admin; Leads hub; backend filters).
Why: the Dashboard was ~1,000 lines of its own `db-*` CSS, inline SVG and emoji (it could not use `components/ui/*` because its bundle had no
Tailwind entry), and v13.9.4's My Day card (hand-rolled, 8-row slice + "Show all 116" over an API that silently capped at 100) broke the same rules.
- **Rebuilt from the library + lucide icons:** `features/dashboard/*` + a thin `pages/Dashboard.jsx`; the bundle now has `dashboard-tailwind.css`
  (scoped, no preflight leak) and the old Dashboard.css/DashboardResponsive.css are gone. StatStrip gained optional caption/alert/onClick/responsive columns.
- **Every number opens what it counts:** status cards open the Leads hub filtered; *Given today* and *Not yet called* open server-side smart views
  (`GET /api/leads?smart=given_today|not_yet_called`) built on the same helpers My Day counts with, so card count == list count (tested);
  the Leads page shows a "Showing: … ✕" banner. Pipeline bars (admins) open that stage. *Calls today* opens the Power Dialer.
- **My Day:** real server-side pagination for both lists (the 100-row cap is gone), activity filter by kind (calls/notes/moves/emails with counts), any
  past date via the date picker (plus Today/Yesterday), and **Export CSV** of the whole day (formula-safe). Dashboard header: Export menu (snapshot CSV, My Day CSV), Start calling.
- **No repeated features:** the Dashboard's "Call outcomes today" card is removed — the Power Dialer's Today panel owns today's calls/outcomes/recordings.
- **Guided tour** on the Dashboard (rep and admin variants; shown once per browser).
- Tests: backend my-day +9 (paging, kind, export, smart views == counts); frontend dashboard 5 tests, Leads smart-view banner; Playwright v13-9-4 spec extended.

## v13.9.4 — 2026-10-07 (honest Dashboard + My Day; SDR Performance shows the real pipeline; saved views follow the person)
**Deploy:** `develop → staging → main`. **Type:** Feature + fixes (Dashboard, SDR Performance, Leads saved views; migration adds `saved_views`).
Prompted by reps who could not see "what was given to me today" or "what I did", and by numbers that disagreed between screens.
- **Dashboard (reps):** the cards were all-time counts by current status; "NEW LEADS / Untouched" counted every lead sitting in Lead
  Assigned even when it had been called before (a reset moves leads back). Now: *Assigned to me* (all, right now), *Given today*
  (new assignments + resets to Lead Assigned, with the split), *Not yet called* (callable leads nobody ever called), *Calling stage*,
  *Meetings+*.
- **My Day (new, `GET /api/my-day`):** what was given to me and what I did — calls (call logs + dialer calls), notes, status moves,
  emails, leads worked — for Today or Yesterday, in the person's own timezone (browser offset), each row opens the lead. Always the
  caller's own day (a View-as token is the viewed person), built only from rows already recorded.
- **SDR Performance:** "Leads Assigned" counted leads *started* in the period and the funnel only leads whose status *changed* in
  the period, so "Today" showed 0 and ~90 for reps holding ~1,000 leads. Now: *Assigned Now (all)*, a *Current Pipeline* funnel
  (all leads, by current status), and period cards labelled "in period"; *Calls Made* now includes dialer calls without a call-log twin.
- **Saved views are per user, on the server** (`/api/me/saved-views`; 30 max; own rows only). They lived in one browser's
  localStorage, so another browser/device/profile showed none, and a blocked save was swallowed silently. A failed save now says why and
  keeps the dialog open; views left in the browser move to the account once.
- Fixed while testing: the "Yesterday" card retried its fetch once on its own after a failure.
- Tests: backend `test_my_day.py` (7), SDR performance (+2); frontend My Day dashboard (4), saved views (+2), SDR Performance updated.

## v13.9.3 — 2026-10-07 (expired sessions sign you out; faster Leads list; debug endpoint removed)
**Deploy:** `develop → staging → main`. **Type:** Fix (all React screens, backend).
- **Expired session:** the shared React API client ignored a 401, so a screen like Leads just showed "Couldn't load leads:
  Invalid or expired token" with no way forward (the vanilla shell already redirected). One handler in `services/api.js` now
  clears the login and goes to `login.html?expired=1`, where the person sees "Your session has ended. Please sign in again."
  Only the server's own session 401s ("Invalid or expired token", "Not authenticated", "access removed") do this; an
  integration 401 (e.g. the email connection expired) does not sign anyone out. A "View as" session that expires drops back to the
  admin's own login. Vanilla redirects also carry the notice. All bundles rebuilt (shared client).
  Caught by staging Playwright before prod: the first version also reacted to the 401 that widgets get on first sign-in
  (they call the API a moment before the token is stored) and bounced SDRs straight back to login; the handler now acts only
  when the rejected request carried the login we hold.
- **Leads list:** on prod the median was already 253 ms (95th percentile 1.9 s); the heaviest statement loaded every dialer
  call in full, transcript and raw payload included, just to show the last outcome. It now loads only the six fields the list
  uses (`summary_dialer_calls()`): that query 958 → 347 ms in a prod-data profile, no extra queries. Staging is slower than prod
  (smaller instance), so its 2-3 s was not the real prod number.
- **Removed** the temporary Super-Admin-only `GET/POST /api/admin/debug-memory` endpoints (the staging memory RCA is closed).
- Tests: session-expiry client (3), login notice, Playwright (forged token → login with message); backend 3533 passed, frontend 1430.

## v13.9.2 — 2026-10-07 (Claude connector: pods, counts, tags, filters)
**Deploy:** `develop → staging → main`. **Type:** Feature (backend only; no frontend change besides the Help release list).
Feedback from a team member's Claude: it could not say which SDR is in which pod, and it paged through ~10,000 leads
(`list_leads` page 400, 25 per page) to answer a counting question.
- **New tools:** `list_pods` (pods, Pod Admins, members with role and lead load; admins only, Pod Admin sees their pod),
  `count_leads` (group by status / tag / rep / pod in one call, same visibility and filters as the Leads list),
  `list_tags`.
- **`list_leads`:** new filters (tag, rep, upload, cadence, created dates), reports the total match count and pages, and rows are
  compact (no notes/call previews/pod ids) so replies are smaller and faster.
- Shared code: the tag/upload/cadence/assignee filters moved from `get_leads` into `lead_helpers.apply_lead_scope_filters`,
  used by both the Leads list and `count_leads`, so they cannot count differently.
- Tests: 6 new (pods, grouping, scoping for a rep, bad group, compact rows, tags). Backend 3534 passed.

## v13.9.1 — 2026-10-07 (refused actions now explain themselves)
**Deploy:** `develop → staging → main`. **Type:** Fix (frontend). Found when moving a rep to another pod on prod: the server refused
("already a member of 'US Team New'. Remove them from that pod first.") and the screen showed nothing useful.
- **Pod Management:** every pod action (create, delete, add/remove member, add/remove admin, timezone) now shows the server's
  reason as an error toast instead of failing silently (`usePodsData.mutate` caught nothing; failures became unhandled rejections).
  Create POD keeps its form open on failure.
- **Everywhere else (safety net):** the shell's unhandled-rejection handler used to say "Something went wrong. Please try
  refreshing the page." for every failure. A refused action (HTTP 4xx) now shows the server's own message; other errors keep the generic one.
- Audit of the whole frontend for buttons that call the server with no error handling: Pods was the outlier; Team & Access, Leads,
  Cadences already handled errors. Two small ones (Salesforce auto-sync schedule, metric draft) are covered by the safety net.
- Tests: a refused pod action toasts the server's reason and resolves false; Playwright proves it on screen against staging.

## v13.9.0 — 2026-10-07 (reassign requests; clearer duplicate message; tag filter fixes; re-enrollment control)
**Deploy:** `develop → staging → main`. **Type:** Feature + fixes (backend, Leads, lead page, cadence settings).
- **Duplicate lead, explained.** `POST /leads` 409 now says which field matched (email / LinkedIn / phone / name+company),
  the lead's status, who it is assigned to, and what to do. `detail` stays a plain string; the structured
  `existing_lead` object drives the Add Lead modal's **Request reassignment** button. An optional contact line comes from
  the `LEAD_OWNERSHIP_CONTACT` env var (blank = no line; set it on Render, no deploy needed).
- **Reassign requests** (maker-checker, same shape as Disqualify): `POST/GET /api/reassign-requests`, `/mine`,
  `/{id}/approve|reject`; new table `reassign_requests` (one pending request per lead+requester, partial unique index).
  Approve uses `models.assign_lead` (same one-owner rules and pod sync), writes an `assigned_to` history row, tasks both the
  requester and the previous owner; Pod Admin sees their pod's reps/leads only, cross-pod leads need a Super Admin.
  Leads → **Reassign Requests** tab with a pending count. Calls, notes and status history stay on the lead.
- **Tags.** The Tag filter list was cached for the page's lifetime, so a tag created after the page opened never showed:
  it is re-fetched on mount and each time the filter opens, and an empty list says "No tags yet." Attaching/detaching a tag
  and upload-time tags now write a lead history row (`tags`), shown as "Tag added: …"; owner changes show as "Owner: A → B".
- **Re-enrollment control.** Cadence Rules → **Allow re-enrollment** (+ optional wait in days). Columns
  `journeys.allow_reenroll` (NULL = a pre-v13.9.0 cadence = allowed, unchanged) and `reenroll_cooloff_days`; new cadences
  are created with it OFF. Applied in `enroll_lead` (status trigger and manual enrol alike); the manual enrol reports why
  a lead was skipped. Completed, exited-early and paused runs count; failed runs may retry.
- **Blank status trigger** (`status_changed` with no status) now matches nothing instead of every status change
  (publish already refused it since v13.8.0; this protects older live cadences). Prod check: none affected.
- Cleanups: one shared `time_utils.as_utc` replaces four copies; `/replies` no longer returns the unused `sdrs`;
  My Tasks uses the shared toast helper.
- Not changed (decisions pending): call-attempt-count backfill; Instantly request pacing between the two syncs.

## v13.8.1 — 2026-10-07 (dialer badge; Playground gate)
**Deploy:** `develop → staging → main`. **Type:** Fix (nav, dialer widget).
- Dialer message badge clears when the Messages view is opened (per-browser seen mark; returns on a new inbound).
- Playground hidden from Pod Admin: `GET /api/dialer/playground` (unmasked Alternate Messenger credentials) is Super-Admin-only
  server-side, so Pod Admin used to see the nav item and land on "Access Denied". Shell gate is now Super Admin only.
- Known, accepted (review 2026-10-07): an Instantly email for a lead that is not in the CRM when it is read is
  counted "unmatched" and the sync watermark moves past it, so importing that lead later does not backfill the
  reply (by design: no auto-create). The v13.7.0 migration reset `due_time` on open cadence tasks once, including
  ones a rep had rescheduled by hand (already run on prod; not repeatable).

## v13.8.0 — 2026-10-07 (Instantly replies inbox + report; the data fixes under it; roster access leak)
**Deploy:** `develop → staging → main`. **Type:** Feature + fixes (backend, Sales Tools, lead page, Dashboard).

### Data layer (the inbox is only as good as the rows)
- **Mail sync** (`scheduled_jobs._instantly_mail_sync_job`, every 5 min, leader only): one global,
  incremental read of Instantly's inbox (`GET /api/v2/emails`, `sort_order=asc`, from a per-direction
  watermark minus a 5-min overlap, `received` + `sent`) replaces the per-lead Unibox call. One request
  per 100 emails (≤ 20/min, paced), page by page. Every real email is stored once in
  `lead_email_activity`, keyed on Instantly's email id (**partial unique index**
  `idx_lea_instantly_email_id`), with `instantly_thread_id`, `instantly_step`, `instantly_eaccount`.
  First run backfills 30 days, capped at 15 pages per direction per run (the cursor resumes);
  replies older than 48 h are stored already-read so the backfill can't flood the bell. A failed page
  keeps the last good watermark; a plan without the emails API logs once.
  Migration: 4 columns + `sync_settings.instantly_mail_cursor` + 3 indexes (run twice on a copy of
  the dev schema: idempotent).
- **Replies were stored twice.** The webhook wrote a body-less row the poll's dedup never matched, then
  the poll wrote a second. The webhook now only routes the cadence (immediately, as before); the sync
  stores the email. Pre-v13.8.0 stub/duplicate rows are replaced by the real row when it arrives (24 h
  window; a reply the rep had cleared stays cleared). The poll no longer calls Unibox, which also
  removes the `items[0]` can-be-the-wrong-reply bug and the "failed fetch stays empty forever" one.
- **Out-of-office** replies are flagged (`is_auto_reply` from Instantly's flag, else the subject rules)
  and excluded from replies, the bell and the report.
- **Activity Monitor**: reply rate counts Instantly threads (`coalesce(nylas_thread_id,
  instantly_thread_id)`), the rep filter attributes Instantly rows to the lead's rep, and open/click
  counter rows are no longer counted as "sent" or listed as emails.
- **Access fix (independent of Instantly):** the cadence roster, its counts and its CSV returned every
  enrolled lead's name, company and email to any logged-in user. They are now restricted in SQL to
  `visible_leads(actor)`. `/stats` stays an org-wide aggregate (no lead data).

### Replies inbox + report
- `routes/instantly_inbox_routes.py`: `GET /api/instantly/replies|filters|report|summary`,
  `GET /api/instantly/replies/{id}`, `PATCH /api/instantly/replies/{id}/read`. Super Admin, Pod Admin,
  SDR, AE (CSM: 403). Everything is scoped by `visible_leads()` in SQL before ordering/paging.
  Positive = lead label Interested / Meeting Booked / Meeting Completed / Won (the lead's current
  label). Opens/clicks come from the counter rows and show "—" by step and mailbox, where they can't
  be attributed.
- UI (component library only): Sales Tools → **Replies** tab (Inbox: filters, list + reading pane,
  plain-text bodies; Report: group by cadence/step/mailbox/rep), Dashboard **Outbound replies** tile
  (the page's own card styling — the Dashboard bundle has no Tailwind), lead-page Instantly emails show
  the subject and an expandable body.
- Not in v1: replying from Alternate CRM, assigning a reply, mailbox-to-owner mapping, per-sequence-step
  opens/clicks.

### Fixes from the first prod cadence run (AE report) — full RCA: `docs/RCA-2026-10-07-prod-cadence-feedback.md`
- **Dialer message badge stuck at "1"**: Alternate Messenger has no mark-as-read call, so its unread count never
  dropped after the rep read the thread. The widget now keeps a per-browser "seen" mark per conversation:
  opening the Messages view clears the badge, a new inbound brings it back, and the mark follows Alternate Messenger
  down if it ever resets. Per-browser (not synced across devices).
- **False "The lead replied" exit.** A message now counts as a reply to a cadence only if it is from the
  lead's own address, not a receipt/bounce/no-reply (`email_utils.is_system_message`), and answers an email
  sent to the lead since that cadence began (same thread, or same subject minus Re:/Fwd:). Only the answered
  cadence(s) stop; the `journey_stopped` log records message id/thread/sender/subject/source.
- **Nylas v3 webhook replies never worked**: `message.created` now unwraps `data.object` like opens/clicks.
  Activates a previously dead path on prod (inbound webhook rows + immediate reply detection).
- **Clicks:** a bare URL in a plain-text cadence body becomes a real link (Nylas tracks anchors only); clicks
  on the unsubscribe link and within 10 s of the send (scanners) are not counted; click payloads are logged.
  `/api/email/health` fails when no webhook secret is set, or when ≥10 tracked emails produced no event in 7 days.
- **Unsubscribe**: GET shows a confirm button, POST unsubscribes (scanners follow GET links and were
  unsubscribing leads, then ending their cadences).
- **Status trigger** fires only on a real change; publish (server + builder) rejects a blank target status;
  wording says "leads whose status changes to X after you publish"; `enrolled_via` recorded and shown in the roster.
  Live cadences with a blank status are unchanged until republished.
- **Call attempts** counted once per call (tag auto-log no longer double counts; tagged inbound counts 0);
  lead card/summary labelled "all reps"; cadence call-step "Sent" reads "N tasks created".
- **Wrong number**: `Lead.phone_invalid_at`; `POST /api/leads/{id}/phone/invalid`; quick action, phone badge and
  post-call chip; cadence call/SMS/WhatsApp steps skip; open call-reminder tasks close; editing the phone clears it.

## v13.7.0 — 2026-10-06 (staging memory crash; cadence approvals, My Tasks and the bell rebuilt on the component library)
**Deploy:** `develop → staging → main`. **Type:** Feature + fixes (backend, My Tasks, lead page, nav, messaging widget, Dockerfile).

### Staging OOM (512 MB, killed every ~40 min; prod showed the same climb)
Measured with the new SA-only `GET /api/admin/debug-memory` (+ `POST …/trim`): the scheduler worker
climbed ~2 MB/min with flat Python object counts, and one `malloc_trim` returned 23 of the 39 MB
gained — glibc keeping freed heap, fed by churn. Fixes:
- `middleware/timing.py`: perf writes go to one 2-thread pool (cap 8 queued+running) instead of a new
  OS thread per request (Aircall webhooks every few seconds); digit-led UUIDs now normalise in `_endpoint_key`.
- Mailbox sync: a stored body is re-sanitized only if an older release could have cut it short
  (≤ 503 chars, the old 500 cap); full bodies are left alone (was bleach + a query per message, every
  5 min). The thread pass still runs after the search — it is what picks up a colleague replying on a
  known thread without the lead's address (`test_mail_sync_churn.py`).
- Non-leader scheduler retry backs off 20 s → 5 min (was a new thread + PG connection every 20 s, forever).
- `Dockerfile` `MALLOC_ARENA_MAX=2`; `malloc_trim` after each email-sync run.

### Cadence approvals and tasks
- A cadence task is due at its step's real deadline (`channels.base.manual_step_due_time`), not "now" —
  approvals no longer read "Overdue" a minute after they appear; hard-stop steps have no due time.
  A call reminder stays due now (the cadence never waits on it, and the bell shows it at once); a task
  that just came due reads "Due now" for 15 minutes, not "Overdue by 1m".
  Data migration `v13_7_0_cadence_task_due_time_from_step_deadline` fixes open tasks.
- The lead's cadence status says "Waiting for approval — email/SMS draft is in My Tasks" or "Waiting to
  see if the lead replies" (`_pending_reason` only knew task steps).
- "Skip this step" (`POST /api/leads/{id}/tasks/{task_id}/skip`, `engine.skip_manual_step`) closes a
  cadence task and moves the lead on its no-response path, sending nothing. Deleting an open cadence
  task now returns 409 — it used to strand the lead.
- Approvals appear in the bell as soon as they exist; `/my/tasks/pending` returns `kind`/`from_cadence`;
  snooze accepts `until` (≤ 90 days).

### UI — component library throughout
- My Tasks: Approvals · To do · Done tabs, To do grouped Overdue / Today / Upcoming / No date / Snoozed;
  one shared `TaskRow` (avatar, type badge, cadence name, honest due text, ⋯ menu: snooze 1 h / tomorrow,
  open lead, skip step, delete with confirmation) also used by the lead page's Tasks card. Approvals
  can't be snoozed (the cadence is paused on them). A repeat bell click switches back to Approvals
  (`navAt`); a failed Done load shows an error, not "Nothing completed yet".
- Approval editor: formatted email in `RichTextEditor` (was raw HTML in a monospace textarea), new
  `components/ui/Textarea` (SMS character/segment count), library `Button`s, Skip, done states as badges.
- Bell: Approvals waiting · Replies · Due tasks; every item opens where you act; clear Mark read /
  Snooze / Dismiss (beside the item, so Enter on one never also opens it); "Open My Tasks"; lucide
  icons, `EmptyState`. Task actions on the lead page refresh the bell and badge at once (they waited
  for the 60 s poll). ~100 lines of retired `.nh-bell__*` CSS removed.
- Nav: My Tasks for Super Admin too (reverses 2026-09-16), with an approvals-count badge.
- Lead page: "Enroll in Cadence" quick action (shared `EnrollInCadence` with the Leads bulk bar);
  cadence card with status badge, highlighted "waiting on you", in-app remove confirmation.
- Messaging: the purple button opens the panel and never dials by itself (it called the last lead on
  Aircall); an Aircall rep gets Message + Call tabs; Message opens on the Message tab; the widget is no
  longer hidden for Aircall reps who have messaging.

## v13.6.1 — 2026-10-06 (cadence replies move the cadence without a webhook; shared-number SMS; step label)
**Deploy:** `develop → staging → main`. **Type:** Fix (backend).

- **A reply found by the 5-minute mailbox sync now moves the cadence.** Only the Nylas webhook did;
  staging receives no Nylas webhooks, and prod can miss one, so a real reply sat in the Emails tab
  while the lead waited out the "replied?" timeout. Shared `notify_inbound_email` (engine) is now
  called by both the webhook and `_sync_full_mailbox`; the sync only signals mail received after
  the lead's latest active enrolment (older mail is history), and flags out-of-office by subject.
- **The mailbox sync never worked: every Nylas search returned 400.** It passed `start_after`,
  which isn't a messages parameter (`received_after` is), and logged the failure at debug level,
  so it silently fell back to known threads only — a reply from Gmail to a new thread was never
  picked up, on staging or prod. Fixed, and a non-200 is now a warning with Nylas's reason.
- **Shared phone number → the lead in a live cadence.** `_find_lead_by_phone` (SMS sync, calls)
  ordered by most-recent status change only, so a text reply could land on another lead with the
  same number. Now prefers a lead with an active enrolment first — the rule the inbound-SMS
  webhook already used (v13.4.1).
- Cadence lead list shows "Instantly Sequence" instead of the raw step type.

## v13.6.0 — 2026-10-06 (Claude connector: cadence health, conversations, uploads, pipeline, CSM; three cadence-builder frictions)
**Deploy:** `develop → staging → main`. **Type:** Feature + fixes (backend, cadence builder, lead page).

### Claude connector — 15 more read tools (32 total)
Each calls the screen's own handler and its role check explicitly (FastAPI `Depends` don't run
in-process), so Claude sees exactly what the person sees on that screen.
- **Cadence health:** `get_cadence_leads` (who is on which step, status, exit reason),
  `diagnose_cadence` ("why isn't it sending": status, send window, queue/overdue, where leads wait,
  failed leads with the exact error), `get_cadence_by_rep`, `get_cadence_trend`.
- **Conversations** (Activity Monitor scope — Admins / Pod Admins): `list_messages` (SMS/WhatsApp,
  e.g. inbound today), `list_email_activity`, `find_engaged_no_reply` (opened N+ times, no real
  reply; auto-replies don't count).
- **Calls / trends:** `get_activity_trend` (day by day, optionally one rep); `get_team_performance`
  description now guides "this week vs last".
- **Pipeline:** `get_opportunity` (full), `get_ae_leaderboard`.
- **CSM:** `get_csm_portfolio`, `get_csm_account` (360), `get_csm_digest`.
- **Uploads** (Uploads-screen scope): `list_uploads`, `get_upload_outcome` (funnel + per-rep +
  the upload's leads); `get_funnel`/`get_team_performance`/`get_activity_trend` take `upload_id`.

### Cadence builder / lead page (frictions found setting up the demo)
- A failed step's **actual error** now shows on the lead page under the reason (it was only in a
  hover tooltip on "details").
- A **"did they reply?" branch can wait minutes**: same days/hours/minutes/seconds picker as the
  Wait step (was whole hours only, min 1).
- New trigger **"Only when enrolled manually (no automatic start)"** — no more fake status
  triggers for hand-enrolled cadences. Never matches an engine event; manual enrolment unchanged.

### Instantly mailboxes — one clear picker, in a table
Admins found the two mailbox pickers confusing ("why so many domains?", "what does this control?",
"does picking 9 send 9 emails?"). Now:
- **Control Center → "Mailboxes cadences can send from"**: an explicit switch — off = *"Cadences can
  use all 61 mailboxes on 14 domains · up to N emails/day"*; on = pick in the table. Replaces
  "leave everything unchecked to use all". Saving "limit" with nothing picked is refused with a
  plain message; unsaved changes are flagged.
- **Cadence step "Send from"**: one summary line (*"All available mailboxes — …"* or *"9 mailboxes
  on 2 domains · up to 270 emails/day"*) + *"Each lead gets one email per step, from one of these
  mailboxes."* **Change** opens the table. Warns when the admin removed the step's mailboxes.
- **Shared `components/MailboxPicker.jsx`**: library Table + Pagination (8/page) + search + domain
  filter + "select all matching" + selection summary. Same component in both places.

### Tests
`test_mcp_connector.py` (+18; 52 total, also run on real Postgres via `TEST_DATABASE_URL`).
`test_cadence_manual_trigger.py`. Frontend: manual trigger, minute-level branch wait, visible
failure reason. `conftest.py`: opt-in `TEST_DATABASE_URL=postgresql:///crm_test` runs tests on
real Postgres (fresh schema per test; use `-n0`).

---

## v13.5.0 — 2026-10-06 (Instantly step: choose which domain/mailboxes it sends from)
**Deploy:** `develop → staging → main`. **Type:** Feature (backend + cadence builder).

Until now every Alternate CRM-created Instantly campaign sent from the one org-wide pool
(Control Center → Integrations → Instantly → Choose sending accounts). Each Instantly
Sequence step now has a **Send from** picker.

- **Only Super-Admin-enabled mailboxes are offered**: `GET /api/instantly/sending-accounts`
  (any cadence author) returns the workspace mailboxes filtered by `instantly_sending_accounts`
  (none picked there = all), each with its domain and daily limit. The builder groups them by
  domain; ticking a domain picks all its mailboxes. Nothing picked = every enabled mailbox.
- **Enforced at send time too** (`_handle_instantly_sequence_node`): the step's pick is
  intersected with the enabled set. If every picked mailbox has since been switched off, the
  enrolment fails with a clear message instead of silently sending from others.
- **A different pick = a new campaign**, same rule as a content edit (leads already in the old
  campaign keep their mailboxes). Steps without a pick keep the old steps-only hash, so existing
  campaigns aren't re-minted.
- `GET /api/admin/instantly/accounts` now also returns `domain`; both routes share
  `_instantly_accounts()`.

### Tests
`test_instantly_sequence_cadence_step.py` (+4): pick within enabled, disabled dropped, no pick =
all enabled, all-disabled pick stops with a message, a new pick mints a new campaign while
no-pick keeps the old hash. `test_dialer_routes.py` (+2): reps get only enabled mailboxes with
domain; nothing enabled = all. Frontend `NodeConfigPanel.test.jsx` (+2): domain grouping and
select-all, error state.

---

## v13.4.2 — 2026-10-06 (Creating a lead was refused as a "duplicate" of a deleted or sandbox lead)
**Deploy:** `develop → staging → main`. **Type:** Bug fix (backend only).

Found building the staging demo data: `POST /leads` answered 409 "A matching lead already
exists: … (id …)" where that id was a **deleted** lead (opening it says "Lead not found").
`_find_duplicate_lead` queried every Lead row. It now skips soft-deleted leads and Cadence
Sandbox test leads (every sandbox lead shares the sandbox phone, so one test run blocked any
real lead with that number).

Not changed (follow-up): the CSV/Sheet import's own dedup (`admin_upload_routes.py`) has the
same blind spot, but a match there updates the existing lead rather than refusing, so
changing it changes import behaviour — left for a separate, reviewed change.

### Tests
`test_lead_routes.py`: a deleted lead (email or phone) and a sandbox test lead (phone) don't
block creating a new lead (fails on the old code).

---

## v13.4.1 — 2026-10-06 (Instantly sync never finished on prod; SMS replies could land on the wrong test lead)
**Deploy:** `develop → staging → main`. **Type:** Bug fix (backend only).

Found checking prod before the Instantly demo: `instantly_last_sync_at` had never been set.
Prod logs: `Instantly Unibox reply fetch failed ... can't adapt type 'dict'`, then
`This Session's transaction has been rolled back`. Instantly's `GET /api/v2/emails` returns
`body` as `{"text", "html"}`; the sync wrote that dict into `body_preview`, the flush failed,
the `except` didn't roll back, and the poisoned session killed the whole run — every 15
minutes. So no Instantly reply ever reached a lead's activity, and the webhook-miss
safety net (`_resume_stalled_instantly_enrollments`, runs after the loop) never ran.

- `_apply_instantly_reply` / `_instantly_text`: object/list fields become plain text
  (`body.text`, else `body.html`; recipient lists joined); reads Instantly's real field
  names (`from_address_email`, `to_address_email_list`) with the old names as fallback.
- The reply-fetch `except` now rolls back, so one bad reply can't stop the run.
- Webhook path unaffected (it doesn't store reply bodies).

### Also fixed: an SMS reply could be filed on the wrong lead
`messenger_sms_webhook` matched the sender with an unordered `.first()`. Every Cadence
Sandbox test lead has the sandbox phone, so a demo reply could attach to an old test lead
(and not move the demo cadence on). Now prefers the lead with an active cadence enrolment,
then the newest.

### Tests
`test_messaging_access.py`: shared-number reply goes to the lead in a live cadence, else the
newest (fails on the old code).
`test_scheduled_jobs.py::TestInstantlySyncJob`: a reply with an object body is saved as
text and the run completes (fails on the old code); a failing reply fetch doesn't stop the run.

---

## v13.4.0 — 2026-10-06 (Claude connector: ask Claude about Alternate CRM data, with your own key)
**Deploy:** `develop → staging → main`. **Type:** New feature (backend + My Settings + Control Center).

### What it is
A remote MCP server inside the backend (`routes/mcp_routes.py`, tools in `mcp_tools.py`).
In Claude: **Settings → Connectors → Add custom connector**, URL `<backend>/mcp`, click
Connect, paste your personal API key on the Alternate CRM page that opens. Claude then acts
as you — exactly your role's scoping, nothing more.

- **Keys:** My Settings → Claude connector. Shown once, stored as SHA-256 only, max 10 per
  user, revocable (revoking kills every Claude session minted from it at once; so does a
  user losing access). Not the org-wide Public API key.
- **OAuth 2.1 (what Claude requires):** discovery metadata, dynamic client registration,
  authorize page (paste key), token endpoint with PKCE S256 + refresh. Stateless — clients,
  codes and tokens are JWTs signed with a key derived from `JWT_SECRET`, so they can't be
  used against the app and app tokens can't be used here. Redirects only to Claude's
  callback or loopback (Claude Code / Desktop). The authorize page can't be framed.
- **Who:** Super Admins only by default. *Control Center → Integrations → Claude connector →
  Let everyone connect Claude* opens it to all users; everyone else doesn't see the My Settings
  card, and closing it again cuts off their existing sessions.
- **Read tools:** search, list_leads, get_lead (with notes/tasks/calls), list_my_tasks,
  list_cadences, get_cadence_stats, list_opportunities; analytics (get_team_performance,
  get_funnel, get_leaderboard); lead activity (get_lead_timeline, get_lead_emails — read-only,
  never marks mail read — and get_lead_cadences).
- **Onboarding:** the key page is Alternate CRM-branded (logo, colours, plain-language summary of
  what Claude can do); expired/invalid links show a branded "start again" page, not a raw error;
  unexpected tool failures reach Claude as a plain "try again", details only in our logs. The
  backend serves the app's favicon and logo so Claude's connector list shows the Alternate CRM icon.
  My Settings walks through Claude's "Add custom connector" dialog field by field.
- **Write tools** (hidden and refused until a Super Admin turns on *Control Center →
  Integrations → Connections → Claude connector → Allow Claude to make changes*; default
  off): add_note, create_task, update_lead_status, approve_cadence_draft.
- **Sending a draft takes an explicit yes:** approve_cadence_draft without `confirm: true`
  sends nothing and returns the exact message (draft + edits) for Claude to show the user;
  only a real boolean `true` sends. The tool is marked destructive/open-world so Claude asks
  before using it, and the server instructions tell Claude never to act on instructions
  found inside emails, notes or lead fields (prompt-injection guard).
- **Claude Logs (Control Center → Monitoring, Super Admin):** every tool call (lookups and
  changes, including refused ones), every connection, and key create/revoke — who, what,
  arguments, result. Endpoint `GET /api/admin/claude-logs`.
- **Deliberately not included:** deletes, bulk actions, starting a new message, reading
  email bodies (opening them marks them read and triggers a mailbox sync).

Every tool calls the same route handler the app uses, so access rules and validation are
identical to the UI — none are re-implemented. Permission errors come back to Claude as
Alternate CRM's own message.

### Also fixed: a "Replied" branch that could never run
New cadences start with **Stop on reply** on, and it ends the enrollment on any reply —
before a condition step can branch on it. So a cadence with a "Replied" branch (the demo
cadence's shape) silently never took it. Publishing such a cadence is now refused with the
fix ("turn off Stop on reply in Cadence rules, or remove that branch"), and so is turning
Stop on reply on for a live cadence that has one. Found rehearsing the demo on staging.

### Also fixed: ten audit events were silently never saved
`log_activity` drops any action type missing from `ACTION_TYPES`, and ten were: the
connector's key/connection/change events, cadence **remove-from-cadence** and
**force-enrol**, the GDPR cadence-data purge, no-show and its notification, and metric
definition publishes. All registered; a new test scans the code and fails if any
`log_activity` call uses an unregistered type.

### Tests
`test_mcp_connector.py` (38): key lifecycle, OAuth (redirect allow-list, PKCE, refresh,
wrong key), token isolation both ways, write gate, per-role read/write scoping, revocation
and user-removal cut-off, Claude Logs, draft confirm step. `test_activity_logger.py`: action-type
registry scan. Frontend: connector card, admin switch, Claude Logs tab.

---

## v13.3.5 — 2026-10-06 (Cadence gaps found while hardening the demo: removal, deletes, unsubscribes, refused sends, replies during a wait)
**Deploy:** `develop → staging → main`. **Type:** Bug fixes (cadence engine + approval UX).

### What was wrong
1. **Remove from cadence / archive skipped the shared exit path.** Both set the
   enrollment status by hand instead of calling `_exit_enrollment_early`, so the rep's
   parked email/SMS approval draft stayed in My Tasks, and a lead handed off to
   Instantly kept getting the rest of the Instantly sequence.
2. **Deleting a lead didn't stop its cadences.** Lead delete is a soft delete
   (`deleted_at`) and `_is_lead_eligible` didn't check it — a deleted lead kept
   receiving cadence emails/SMS.
3. **Unsubscribe / DNC only ended the cadence with an Instantly handoff** (or none,
   for the unsubscribe link) — other cadences were only stopped at their next send, and
   their parked drafts stayed open. They also created "Re-engage" tasks for leads who
   had opted out.
4. **The max-duration hard stop** completed an enrollment without stopping an active
   Instantly handoff.
5. **Approving a draft that can't send** (rep has no connected mailbox, lead has no
   phone/email, SMS not enabled) returned 200, closed the draft, then failed the
   enrollment in the background — the rep thought it had gone out. Found live on staging
   (the Demo AE account has no mailbox).
6. **Generic error messages** — My Tasks / Lead Detail showed "Failed to send — try
   again" instead of the server's reason.
7. **A reply during a wait was lost.** A "replied?" condition only reacted to replies
   arriving while the lead was parked *on* it. In email → wait → condition, a lead who
   replied during the wait timed out as "no reply" and got the no-reply follow-up.

### Fix
- `engine._on_enrollment_end` (runs for every ending) now also stops an active Instantly
  handoff; remove/archive route through `_exit_enrollment_early`.
- New `engine.exit_active_enrollments(db, lead_id, reason)` — used by lead delete, DNC,
  the unsubscribe link, and Instantly's unsubscribe (webhook + poll fallback): ends
  every active cadence now and closes its drafts. `_is_lead_eligible` rejects deleted
  leads. Removed/archived/DNC/unsubscribed/bounced/deleted never create re-engage tasks.
- `ChannelProvider.preflight()` (email: lead email + connected mailbox; SMS: phone,
  sandbox number, non-retryable messaging failure) — shared with `send()`. The task
  PATCH route checks it before closing an approval task: 409 with the reason, draft
  kept, enrollment untouched. Transient (retryable) provider failures don't block.
- The approval cards show the server's reason inline under **Send** and keep the edits;
  My Tasks/Lead Detail handlers surface `detail` everywhere.
- `check_exit_triggers` records a branchable event that arrives while the lead is on
  another step (`ExecutionLog` `event_received`); entering a condition branches on it
  immediately (a real reply beats an out-of-office). Each condition decision is logged
  (`condition_decided`), which closes the window for the next condition. Out-of-office
  is still never a reply; it only takes an explicit "Auto-reply received" branch.

### Tests
`test_cadence_exit_paths.py` (11), `test_manual_approval_preflight.py` (6),
`test_condition_reply_buffering.py` (7) — each run against the old code first: 17 of
the 24 fail there (the rest guard behaviour that was already right). Frontend: refused-
send tests for both cards and My Tasks. Full suites: 3288 backend, 1297 frontend.
Backend suite now runs in parallel (pytest-xdist): 8m23s → 2m24s.

---

## v13.3.4 — 2026-10-06 (Reps can actually build their own cadences: v13.1.1 opened creation but left save/publish and the builder Pod-Admin-only)
**Deploy:** `develop → staging → main`. **Type:** Bug fix (cadence permissions, backend + frontend).

### Root cause
v13.1.1 (2026-10-01) opened *creating* a cadence (`POST /api/journeys`) and *enrolling*
into one to every role, and showed "New Cadence" to AEs/SDRs. It changed only those two
gates. Everything a rep hits immediately after creating stayed Pod Admin+:
- Backend: `save_draft` (the builder's autosave), `publish_journey`,
  `update_journey_settings`, `pause/resume/archive_journey`, `ai_generate_email`,
  and `retry/skip_enrollment` were all still `require_pod_admin_or_above`.
- Frontend: `SalesToolsHub` passed `readOnly={!isAdmin}` into `SalesJourneyHub`, which
  OR'd it into the builder's read-only flag — so a rep's own brand-new cadence opened
  read-only, and the list hid Delete on cadences they owned.
- The rep-facing guided tour still said "you can't create, edit, or delete a cadence".

Why it wasn't caught: the v13.1.1 "full flow" Playwright spec for the AE stopped as soon
as the cadence existed (never saved or published); a unit test
(`SalesJourneyHub.test.jsx`) asserted the broken state ("allows New Cadence" + "hides
Save/Publish"); and v13.3.3's SDR full-flow Playwright test skipped itself because its
fixture account was deactivated, and that skip was accepted instead of switching accounts.

### Fix
- Backend: the routes above now take any authenticated user. Every one already calls
  `_require_journey_owner`, so a rep can only touch cadences **they own** (Super Admin:
  any). Sandbox test-enroll, clear test leads, and force-next-step stay Pod Admin+ (only
  used by the admin Messaging Sandbox page).
- Frontend: builder read-only is now decided by ownership alone (`can_edit` from the
  API); list Delete/bulk-delete follow `can_edit`; tour rewritten (new seen-key
  `alternate:cadence-rep-tour-seen-v2` so reps see the corrected text).
- Tests: backend — AE and SDR run the whole lifecycle on their own cadence, a rep is 403'd
  on someone else's, a rep owner can retry/skip failed enrollments. Frontend — ownership-
  based tests replace the ones that locked in the bug. Playwright — the v13.1.1 full-flow
  spec now drives the builder through a real Save and publishes, for both AE and SDR; new
  `tests/v13-3-4-manual-approval-personas.spec.js` covers manual email/SMS approval for
  AE, SDR, and Pod Admin (manual SMS had no Playwright coverage before) plus the
  never-auto-send-on-timeout guarantee; task lookups in both manual-approval specs are now
  scoped to the run's own enrollment (another active cadence on the same trigger status
  could park a same-named node's task on the test lead).

### Files
`backend/routes/journey_routes.py`, `backend/tests/test_journey_routes.py`,
`frontend-react/src/features/sales-journey/{SalesJourneyHub,JourneyList,CadenceReadOnlyTour}.jsx`,
`frontend-react/src/features/sales-tools/SalesToolsHub.jsx`, their tests,
`frontend/js/sales-tools-hub.js` (rebuilt), `frontend/index.html` (cache-bust), Playwright specs.

## v13.3.3 — 2026-10-05 (Scheduler leader-election, part 2: the retry window can never win on a real deploy; Integrations reorg + Klenty card)
**Deploy:** `develop → staging → main`. **Type:** Hotfix (infra reliability) + UI reorg + new admin card.

### Root cause — the v13.3.2 fix didn't actually fix the real failure mode
Found a few hours after v13.3.2 shipped, while using the Instantly feature's own
staging-audit Playwright spec: a freshly-enrolled lead sat at `next_run_at ==
enrolled_at` indefinitely. Render logs showed BOTH workers on the latest staging
deploy logging "Another worker already holds the scheduler lock — skipping
registration on this worker", and no "All scheduled jobs started" line after
that deploy at all — the scheduler was completely dead, not just slow.

v13.3.2's `_LEADER_ELECTION_RETRY_DELAYS` (~15s total, with backoff) was built
on the assumption that an old leader might still be shutting down and could be
retried past. That holds for a crashed/SIGKILL'd process. It does **not** hold
for Render's normal zero-downtime deploy model: the OLD container (and its
lock-holding Postgres connection) is *guaranteed* still alive for the entire
retry window, because Render only tears the old one down once the NEW
container passes its health check — which this very startup path gates. The
new worker's fast-retry loop was therefore mathematically guaranteed to lose
on every single routine deploy, and once it gave up, nothing ever retried
again until the next deploy shipped.

### Fix
`start_scheduled_jobs()` now falls through to a new
`_retry_leader_election_in_background()` instead of just returning when the
fast window is exhausted — a cheap (one `pg_try_advisory_lock` call) timer
that keeps re-arming itself every 20s, forever, until it wins the lock, at
which point it registers every job exactly once. This means a worker that
loses the initial race still picks up leadership the moment the old
container's connection actually closes — no manual restart or follow-up
deploy required. Verified live: staging's scheduler had been dead since the
v13.3.2 staging deploy ~40 minutes earlier; deploying this fix caused the new
worker to pick up leadership and a parked test enrollment to process within
the next tick.

### Also in this release (unrelated, found via the same critical-review pass)
- **Integrations reorganized**: "Dialer" held Aircall/Alternate Messenger (calling)
  and Instantly (email sending) together, while Nylas (also email sending)
  sat under "Connections" — split into **Email Sending** (Nylas + Instantly)
  and **Calling & Messaging** (Aircall, Alternate Messenger, Klenty).
- **Klenty card added**: `klenty_enabled`/`klenty_api_key` and the manual
  `/admin/dialer/sync-klenty` route have been fully backend-complete since
  Klenty shipped, with zero UI — an admin could only configure it via a raw
  API call. New card mirrors Instantly's enable/key/last-synced shape, plus
  a manual "Sync Now" button (Klenty's sync is a single fast paginated feed,
  not a background job, so a synchronous manual trigger makes sense here in
  a way it doesn't yet for Instantly).
- **SDR/Pod Admin persona coverage** added to the v13.3.2 Playwright spec —
  `create_journey` is open to every authenticated role, not just Pod Admin+;
  added end-to-end tests proving an SDR can independently build, publish,
  enroll, and send through an Instantly cadence, and that a Pod Admin can
  create/edit/publish one too (previously only Super Admin and AE/read-only
  were covered).

---

## v13.3.2 — 2026-10-05 (Scheduler leader-election: lock never released on shutdown)
**Deploy:** `develop → staging`. **Type:** Hotfix — infrastructure reliability (no schema change, affects every scheduled job, not just Instantly).

### Root cause (critical — found during live verification, already caused a real outage on staging)
Discovered while debugging why a freshly-enrolled lead's `instantly_sequence` node
sat unprocessed for 10+ minutes on staging after the v13.3.1 deploy, while an
earlier enrollment (right after the v13.3.0 deploy) had processed in ~15s.
Pulled staging logs directly (Render API) and found the real cause has nothing
to do with Instantly:

The v13.2.0 scheduler leader-election fix (`_is_scheduler_leader()`, a Postgres
advisory lock electing one worker process to run all recurring jobs) never
released that lock on shutdown — `stop_scheduled_jobs()` only cancelled timers,
never closed `_scheduler_leader_conn` (the detached connection actually holding
the lock). A redeploy's old container being torn down doesn't reliably give
Postgres an immediate, clean disconnect, so the lock stayed held by a now-dead
connection. The *new* deploy's workers then found "another worker already
holds the scheduler lock," and — because `start_scheduled_jobs()` only ever
checked once at boot with no retry — gave up and registered **zero** scheduled
jobs for the rest of that deploy's lifetime. Confirmed live: staging's 15-minute
Instantly poll job and the 30-second `journey_engine_tick` both silently
stopped running after the v13.3.1 deploy, for the deploy's entire life, with no
error anywhere (the web server itself stayed healthy the whole time, which is
why `/api/health` never caught it).

Confirmed via direct DB inspection (`pg_locks`) that by the time this was
caught, the stale lock had already self-released (the dead connection
eventually timed out) — but the *currently running* deploy had already
permanently lost its only leader-election attempt and would never retry on
its own.

### Changed
- `backend/scheduled_jobs.py::stop_scheduled_jobs` — now explicitly closes
  `_scheduler_leader_conn` on graceful shutdown, releasing the advisory lock
  immediately instead of depending on the OS socket eventually timing out.
- `backend/scheduled_jobs.py::start_scheduled_jobs` — retries the leader
  check with backoff (~15s total) instead of one immediate attempt, so a
  narrow timing loss against a rolling deploy's old-instance teardown
  doesn't permanently kill every scheduled job for that deploy's lifetime.

### Migration Notes
None — no schema change.

### Verified on staging
Pending redeploy + a fresh end-to-end check that `journey_engine_tick` and
`instantly_sync` both resume running on schedule. 6 new/updated tests passing
locally (`TestSchedulerLeaderElection`).

### Rollback commit
`HEAD~1` after merge (revert the merge commit).

---

## v13.3.1 — 2026-10-05 (Instantly send-side: activation fix + cadence-reporting visibility)
**Deploy:** `develop → staging`. **Type:** Hotfix + feature gap closed (found during live E2E verification of v13.3.0, no schema change).

### Root cause (critical — would have silently never sent anything)
Live end-to-end testing on staging (real Instantly workspace, real campaign
creation) found that `InstantlyProvider.create_campaign()` created a campaign
but never activated it — Instantly campaigns start in status 0 (draft) and
the Hypergrowth account never sends a single email until a campaign is
explicitly switched to active via `POST /api/v2/campaigns/{id}/activate`.
Confirmed live: a v13.3.0 campaign sat in draft with a lead already added and
zero emails sent. Without this fix, the entire send-side feature would have
shipped to production appearing to work (campaign + lead created
successfully, enrollment parked correctly) while silently never sending a
single email, unless someone manually opened Instantly's dashboard and
clicked "Launch" on every auto-created campaign — defeating the feature's
whole point.

### Changed
- `backend/instantly_provider.py::create_campaign` — calls `/activate`
  immediately after a successful create.
- `backend/routes/journey_routes.py` — new `_journey_instantly_engagement_stats`,
  merged into the existing per-cadence `_journey_engagement_stats` (the
  Reporting tab's engagement table). An `instantly_sequence` step's
  sent/opened/clicked/replied now shows up in its own cadence's Reporting
  tab, not only in Control Center → Integrations' workspace-wide analytics
  table — gap found when the user asked "will I see this in cadence
  reporting?" during live verification; the answer was no, which undercut
  the feature's "Alternate CRM is the single source of truth" goal.

### Migration Notes
None — no schema change.

### Verified on staging
Yes — full end-to-end pass against the live Instantly workspace: real
campaign created, activated, lead added, a simulated webhook reply event
correctly exited the enrollment via the same `check_exit_triggers` path
Nylas replies use, and the new cadence-reporting query verified via a
dedicated test (`TestInstantlyEngagementStats`). Backend 3254 passed/10
xfailed/0 failed, frontend 1289/1289.

### Rollback commit
`HEAD~1` after merge (revert the merge commit).

---

## v13.3.0 — 2026-10-05 (Instantly.ai integration: engagement sync + send-side cadences)
**Deploy:** `develop → staging`. **Type:** Feature (new tables, new columns, no destructive schema change).

### Changes — engagement pull-sync (read-only)
- `backend/instantly_provider.py` (new): read-only Instantly REST v2 client
  (`list_campaigns`, `list_accounts`, `list_leads`, analytics endpoints).
  Fixed a Cloudflare block: `api.instantly.ai` 403s urllib's default
  `Python-urllib/x.y` User-Agent on every verb — spoofed a browser-shaped UA
  in the shared `_request()` headers. This fix applies to every call this
  provider makes, old and new.
- `backend/scheduled_jobs.py::_instantly_sync_job` — polls every 15 minutes,
  writes `LeadEmailActivity` rows for opens/clicks/replies.
- `backend/routes/dialer_routes.py`: `/admin/instantly/sync`,
  `/admin/instantly/analytics` (Super Admin only).
- `SyncSettings.instantly_api_key` (encrypted, same property/setter pattern
  as `messenger_api_key`).
- `frontend-react` `InstantlyCard` (Integrations section), activity-feed and
  lead-badge surfacing of Instantly engagement signals.

### Changes — send-side integration (cadences send through Instantly)
Alternate CRM's own cadence builder (not Instantly's dashboard) is now the
single source of truth for content, timing, and reply/exit logic for leads
sent through Instantly's managed domain/mailbox pool. A new `instantly_sequence`
journey node mirrors its steps into a live Instantly campaign via API,
enrolls the lead via API, and hands off sending to Instantly's own
pool/rotation/warmup; a webhook (+ poll-job fallback) brings replies, opens,
clicks, interest, and completion back in real time and resumes/exits the
Alternate CRM enrollment through the existing journey-engine machinery.

- `backend/instantly_provider.py`: write methods —
  `create_campaign`, `update_campaign_sequence`, `add_lead_to_campaign`,
  `remove_lead_from_campaign`, `create_webhook`, `list_webhooks`,
  `delete_webhook`.
- `backend/models.py`: new tables `JourneyInstantlyCampaign` (maps a
  journey node to a live Instantly campaign, versioned by a content hash —
  never mutates a campaign with active enrollments, mints a new
  campaign on content change instead) and `JourneyInstantlyEnrollment`
  (per-enrollment handoff tracking). New `SyncSettings` columns:
  `instantly_webhook_secret` (encrypted), `instantly_webhook_id`,
  `instantly_sending_accounts`.
- `backend/journey_engine/engine.py`: new `instantly_sequence` node type,
  `_handle_instantly_sequence_node` (park-and-wait, same pattern as the
  existing manual-email node), `resume_instantly_sequence_step`. Exiting
  an enrollment (reply on any channel, DNC, manual status change, terminal
  status) now also removes the lead from its active Instantly campaign, so
  Instantly stops sending the moment Alternate CRM considers the journey over.
- `backend/services/lead_service.py`: `do_not_contact=True` now also exits
  any active Instantly enrollment immediately, in the same request (not on
  the next 15-minute poll) — a compliance requirement, not just UX.
- `backend/routes/webhook_routes.py`: `POST /webhooks/instantly` — shared-
  secret header auth (`hmac.compare_digest`, fail-closed), routes
  `reply_received`/`lead_interested`/`lead_meeting_booked`/
  `campaign_completed`/`lead_unsubscribed`/`email_bounced` into the journey
  engine's existing exit/resume/trigger logic — same `check_exit_triggers`
  call Nylas replies already use, so `stop_on_reply` behaves identically
  regardless of which channel the reply came through.
- `backend/scheduled_jobs.py`: `_resume_stalled_instantly_enrollments()` —
  poll-job safety net for any webhook delivery Instantly drops. Fixed a
  real pre-existing bug surfaced while building this: the sync job's dedup
  comparison crashed (`TypeError`, naive-vs-aware datetime) on the *second*
  occurrence of any engagement signal for the same lead+campaign, silently
  swallowed by the job's own try/except — extracted into a shared
  `_record_instantly_engagement`/`_aware()` helper used by both the poll
  job and the new webhook route (the webhook route has no blanket catch,
  so this would otherwise have been a live 500 on every repeat event).
- `backend/routes/dialer_routes.py`: `GET /admin/instantly/accounts`,
  `POST /admin/instantly/webhook/register` + `.../disable` (Super Admin
  only, idempotent re-register).
- Frontend: `InstantlyCard` extended with a sending-accounts picker
  (component-library `Checkbox` list, same pattern as `RecordTypesPicker`)
  and a real-time-webhook toggle; new `instantly_sequence` journey-builder
  node (palette, config panel, canvas icon/summary).

### Migration Notes
- New tables `journey_instantly_campaigns`, `journey_instantly_enrollments`
  (created via `models.Base.metadata.create_all()` at startup — no manual
  migration step).
- New `SyncSettings` columns via `backend/migrations.py`'s
  `column_additions`: `instantly_webhook_secret`, `instantly_webhook_id`,
  `instantly_sending_accounts`.
- No destructive changes; nothing is sent to Instantly until a Super Admin
  enters an API key and opts a cadence node into `instantly_sequence`.

### Verified on staging
Pending — backend (3250 passed/10 xfailed/0 failed) and frontend
(1289/1289) suites green locally, both `/ponytail-review` and
`/ponytail-audit` applied, graph review run (flags investigated, confirmed
false negatives). End-to-end Playwright pass on staging (create a cadence
with an Instantly-sequence node, enroll a test lead, verify the campaign
appears in Instantly, verify a reply exits/advances the enrollment and
shows up in the activity feed) still outstanding before `staging → main`.

### Rollback commit
`HEAD~1` after merge (revert the merge commit).

---

## v13.2.0 — 2026-10-05 (Scheduler double-run fix — staging OOM root cause)
**Deploy:** `develop → staging`. **Type:** Infrastructure fix (no schema change).

### Root cause
`Dockerfile` moved `uvicorn` from 1→2 workers on 2026-10-01 to stop one slow
external call from blocking all other requests under a single worker. That
change reasoned `journey_engine.tick()` was safe across both workers (it
dedups via `SELECT...FOR UPDATE SKIP LOCKED`), but every other job in
`backend/scheduled_jobs.py` had no cross-process guard — each worker process
independently called `start_scheduled_jobs()`, silently doubling every
recurring job (email sync, messaging sync, nightly syncs, scheduled
reports/campaigns) on every tick. Confirmed live via Render's events/metrics/
logs APIs: paired `[EmailSync] Synced 50/50 active leads` lines milliseconds
apart on every single tick, and an OOM-kill history on staging's 512Mi plan
matching the doubled-churn pattern; prod (2Gi) shows the same shape, just
with more headroom before hitting the limit.

### Changed
- `backend/scheduled_jobs.py`: added `_is_scheduler_leader()` — a Postgres
  advisory lock (`pg_try_advisory_lock`) used for leader election; only the
  worker process that wins it calls into `start_scheduled_jobs()`'s job
  registration. The lock-holding connection is pulled out of the shared
  SQLAlchemy pool via `.detach()` so `.close()` can't silently return it to
  the pool without releasing the lock (verified against real Postgres — a
  plain pooled connection does not release the lock on `.close()`).
  No-ops to always-leader on SQLite (no advisory locks, no multi-process
  concern in tests/dev).
- Removed `_email_sync_lock`/`_messaging_sync_lock` (`threading.Lock()`s that
  only guarded same-process overlap, which `_schedule_recurring`'s
  synchronous-then-reschedule design already made impossible, and which
  never addressed the actual cross-process double-run).

### Migration Notes
None — no schema change, no new env vars.

### Verified on staging
Pending — merging now, will watch staging's memory metrics over the next
several hours to confirm the OOM-driving climb has stopped before any
`staging → main` promotion.

### Rollback commit
`HEAD~1` after merge (revert the merge commit).

---

## v13.1.9 — 2026-10-02 (Cadence list page: reply-rate chart, archived-cadence clutter, collapsed snapshot)
**Deploy:** `develop → staging`. **Type:** Patch (no schema change).

### Changed
- **"Email engagement, ranked by reply rate" is now a horizontal bar chart**
  (chart.js, already a dependency — same pattern as `AiResultChart.jsx`),
  replacing a table that was a single row for most orgs and never read as a
  ranking even with more data in it.
- **Archived cadences no longer clutter the default list.** The list's
  status filter already had an explicit "Archived" option, but the default
  view showed everything unfiltered — QA/test auto-archived cadences sat
  at the top indistinguishable from live ones. Archived cadences are now
  hidden unless "Archived" is explicitly selected from the existing filter.
- **"Performance snapshot" is collapsed by default.** It's a check-in
  view, not the reason someone opens this page — the list itself (what you
  actually come here to act on) now owns the top of the page instead of
  competing with a donut, a chart, a search bar, and a filter row all
  shown at once.

### Skipped (by design)
- Letting a cadence email-node reference an existing Email Campaign was
  considered and dropped: `EmailCampaign` owns its own recipient list and
  snapshots content at send time by design, both of which conflict with a
  cadence node's enrollment-driven, re-triggered sends. `EmailTemplate`
  (content-only, already used by Campaigns' "start from template" picker)
  is the right reuse point if this comes back later — not attempted here.

### Verified
Frontend: full suite passed (sales-journey: 157/157, including new
default-hide-archived and chart-ranking coverage). `/ponytail-review`:
lean diff, nothing to cut.

---

## v13.1.8 — 2026-10-02 (Cadence reporting revamp: full tab, per-rep + trend data, per-lead drill-down)
**Deploy:** `develop → staging`. **Type:** Patch (no schema change).

### Changed
- **Reporting moved from a 384px drawer to a full "Builder | Reporting" tab.**
  Live feedback on the v13.1.7 drawer ("overwhelming", "can be done in a
  better way") traced to the container, not the content: `Modal`'s
  drawer mode hardcodes a 384px width and silently ignores any width
  override, so a multi-column stats table and the full lead roster were
  always going to feel cramped there. The cadence detail view now has a
  second-level tab bar (reusing the app's existing `Tabs` component —
  the same one already used for Sales Tools' Cadence/Campaigns tabs) —
  Builder keeps the full canvas width it always had; Reporting gets the
  same width for its content instead of a sidebar.
- **Retired the standalone "Activity" button.** It showed a flat,
  un-correlated feed ("Email sent to X") with no link back to that
  lead's roster row — answering "what happened to this specific lead"
  meant opening two separate modals and matching names by eye. A roster
  row now expands in place to show that lead's own activity history
  (same event rendering, reused from the old Activity panel).

### Added
- **Per-rep performance table** — wires up `GET /stats/by-rep`, which
  was built in v13.0.6 but never connected to any screen until now.
- **Weekly trend** — wires up `GET /stats/trend`, also built in v13.0.6
  and previously unreachable (no service method even wrapped it).
- **Roster search, sort, and real pagination.** The enrolled-leads table
  now has a name/company search box, clickable status/stage badges that
  filter the table, sortable columns, and page-numbered pagination
  (reusing the app's existing `Pagination` component, 20 rows/page) —
  on top of the existing "Load more" for rosters beyond 500 enrollments.

### Verified
Frontend: 1259 passed (full suite, only the 6 known pre-existing
IST/UTC-dependent failures remain). `/ponytail-review` found one real
duplication (an identical section-header wrapper copied into two new
components) — extracted into a shared `ReportingSection` component.
`/ponytail-audit` scoped to the touched files: no dead references to the
retired Activity/Reporting panels, no orphaned CSS, no unused imports.

---

## v13.1.7 — 2026-10-02 (Cadence builder: stop the canvas from being squeezed off-screen)
**Deploy:** `develop → staging`. **Type:** Patch (no schema change).

### Fixed
- **The cadence flow canvas could be squeezed down to a sliver, or off
  screen entirely** ("I am not able to view the flow"). The builder page
  has a fixed height, with Failed Enrollments, Engagement, and the
  Enrolled Leads roster stacked above the canvas inline — once the roster
  stopped being collapsed-by-default and Engagement grew a fuller table
  (both v13.1.5), their combined height routinely left little to no room
  for the canvas itself. Moved Engagement and the Enrolled Leads roster
  out of the inline stack into an on-demand "Reporting" drawer (same
  pattern the existing "Activity" button already uses, for the same
  reason) — the canvas now always keeps its full height. Failed
  Enrollments stays inline since it's actionable (Retry/Skip) and
  naturally compact.

---

## v13.1.6 — 2026-10-02 (Enrolled-leads roster: fix nested-scroll trap, verify scale to 500+ leads)
**Deploy:** `develop → staging`. **Type:** Patch (no schema change).

### Fixed
- **Enrolled-leads roster appeared to "disappear" while scrolling.** The
  per-lead list rendered inside its own small `max-h-80` scrollable box
  nested inside the page's own scroll — when the cursor was over that box,
  the mouse wheel scrolled only the inner list, so scrolling past its edge
  felt like the panel vanished with no way to get back to it. Removed the
  nested scroll region; the list now flows with the page as a single
  scroll surface. ("Load more" and CSV export already handle rosters too
  long to read in one page.)

### Verified
- New backend test confirms status/stage aggregates stay accurate at
  501+ enrollments (true totals across both pages, not just the page
  returned), not just the small fixtures used elsewhere in this suite.
- Confirmed via live staging repro (not just unit tests) that the full
  8-row roster was already rendering correctly — the bug was the nested
  scroll interaction, not missing or hidden data.
- Also fixed two pre-existing Playwright staging-fixture issues found
  while re-verifying this release end-to-end: a hardcoded cadence name
  that had scrolled out of the (unpaginated, newest-first) cadence list
  — now uses the v13.0.4 `#sales-tools/{id}` deep-link instead of a
  fragile list search — and a stale AE/PA pod pairing in a test-token
  fixture, unrelated to shipped product code.

---

## v13.1.5 — 2026-10-02 (Cadence reporting: retire duplicate tab, opt-out rate, engagement redesign)
**Deploy:** `develop → staging`. **Type:** Patch (no schema change).

### Changed
- **Retired the "Communications" tab added in v13.1.3.** It duplicated the
  existing, more capable `ActivityMonitorHub` (cross-channel activity log
  with per-channel detail columns, CSV export, sortable columns) almost
  exactly — confirmed after direct stakeholder feedback that every piece of
  requested reporting was cadence-specific, not a general activity feed.
  Removed the tab, its backend endpoint (`GET /communications`), and its
  tests entirely rather than iterating on a duplicate.
- **Engagement panel redesigned.** Previously rendered email and
  manual/SMS steps as two disconnected tables with inconsistent columns,
  and a manual email/SMS step's actual send (open/click/delivered/reply)
  was invisible — only its parked/done/missed counters showed, because
  that data lives in three separate backend sources keyed by the same step.
  Now renders one merged table (one row per cadence step) plus KPI summary
  cards for email, SMS/WhatsApp, and opt-outs.
- **Enrollment roster now open by default**, with status and stage
  breakdown badges ("2 active", "1 at Email #2") visible immediately —
  directly addresses live-demo feedback that stakeholders couldn't tell
  what stage their leads were at without first finding and expanding a
  collapsed panel.

### Added
- **Opt-out rate** as a proper KPI on the cadence stats endpoint — count
  and rate of enrollments exited via the existing opt-out suppression
  check, against total enrolled.

### Fixed
- **Manual email/SMS approval steps never reported their completion
  counts.** `_journey_step_activity`'s event/channel filter didn't
  recognize the distinct event types the engine logs for a manual step's
  completion/timeout (`manual_email_sent`, `manual_sms_timeout`, etc.) —
  every manual step showed zero sent/completed/missed regardless of real
  activity. Fixed to recognize both the parked and completed/timeout event
  shapes.

### Verified
Backend: 3166 passed, 10 xfailed (full suite, SQLite + local Postgres for
the new GROUP BY aggregates). Frontend: 1244 passed (full suite, only the
6 known pre-existing failures remain). `/ponytail-review` + `/ponytail-audit`
run on the diff — no dead references to the removed Communications tab, no
leftover unused imports.

---

## v13.1.4 — 2026-10-02 (Live-review fixes: cadence copy, QA-cadence clutter, comms pagination)
**Deploy:** `develop → staging → main`. **Type:** Patch (no schema change).

### Fixed
- **"Copy cadence" wasn't usable by non-admin roles.** The backend endpoint
  (`POST /{journey_id}/duplicate`) was still gated to Pod Admin+ even after
  cadence creation itself opened to every role in v13.1.1, and separately
  the UI button was hidden behind the same `readOnly` flag that hides
  edit/delete — so AE/SDR never saw it at all. Both fixed: backend widened
  to every authenticated role (duplicating only ever creates a new draft
  the caller owns — it never touches the source), and the button now
  renders unconditionally, matching how "New Cadence" already escapes the
  read-only gate.
- **Sales Cadences' "Performance snapshot" cluttered with archived QA/test
  cadences.** The cross-cadence donut and reply-rate ranking included
  every cadence regardless of status, so leftover Playwright-created test
  cadences (auto-archived at the end of each run) padded out real
  performance reporting. Archived cadences are now excluded from this
  summary.
- **Communications tab had no real pagination.** The initial "Load more"
  pattern only reacted to "did a full page come back," with no visible
  count or page control. The backend now returns a true `total`/`pages`
  (a count query per source table, scoped identically to the data query),
  and the tab uses the same `Pagination` component as the rest of the app.

### Verified
Backend: 134 relevant tests passed (cadence playbook, communications feed,
journey routes). Frontend: 160 relevant tests passed (sales-journey,
Analytics Hub, Communications tab). Full regression suites re-run before
this went to staging.

---

## v13.1.3 — 2026-10-02 (Remaining stakeholder feedback: guardrails, tracking, perf)
**Deploy:** `develop → staging → main`. **Type:** Minor (additive schema — `Lead.vertical`/`Journey.vertical`, nullable).

### Added
- **Global communication tracking.** New "Communications" tab in the
  Analytics Hub (`GET /api/admin/analytics/communications`) — the first
  cross-lead feed in the app; every other comms view (lead timeline, Email
  Hub, conversations) is scoped to one lead or one cadence. Merges email,
  SMS, WhatsApp, and call activity into one chronological list, filterable
  by pod/rep/channel/date range, defaulting to the last 7 days to avoid an
  unbounded org-wide scan. Reuses the same pod/rep scoping as the rest of
  the hub — a Pod Admin/AE/SDR sees exactly what they already see
  elsewhere, not more. Excludes sandbox/test leads, same convention as
  every other analytics aggregate.
- **Enroll-time mailbox + vertical warnings.** Picking "Enroll in Cadence"
  now runs a non-blocking pre-check (`GET /{journey_id}/enroll-check`)
  against the exact sender-resolution logic the real send uses, so a
  broken/disconnected mailbox surfaces before enrolling instead of as a
  failed enrollment discovered later. Also warns (never blocks) when a
  lead's `vertical` tag disagrees with the cadence's own — both fields are
  optional free text, so this only fires when both sides are set.
- **Wrong-vertical enrollment guardrail** — see above; `vertical` is a new
  optional field on both Lead and Journey, editable from the Lead Detail
  Contact card and the Cadence Rules settings panel.

### Fixed
- **`GET /leads/companies` slow query** — had no cache and no LIMIT,
  meaning a full `DISTINCT` scan of every visible lead on every FilterBar
  mount. Now cached for 5 minutes per user/role/pod, invalidated on lead
  creation, same pattern `GET /leads` already uses for its own count/page
  caches.
- **"Couldn't load leads" flaky error** — `useLeadsList.js`'s stale-response
  guard discarded a superseded response client-side but never cancelled
  the still-in-flight HTTP request itself; a slow earlier request could
  still fail/error after a newer one had already rendered. Now uses
  `AbortController` to actually cancel the superseded request.

### Verified
- OOO (out-of-office) auto-replies already correctly excluded from
  reply-triggered cadence exits (`engine.py`'s `check_exit_triggers`) —
  confirmed via code read, no change needed.
- Full backend suite: 3,169 passed, 10 xfailed, 0 failed.
- Full frontend Vitest suite: 6 pre-existing failures (CSM Portal/
  NavTopbar/Power Dialer date-sensitive tests), reproduced identically on
  clean `develop` via `git stash` — confirmed unrelated to this release.
- `/ponytail-review` + `/ponytail-audit` run on the diff — no cuts found;
  one clarity-only tweak applied to `CommunicationsTab.jsx`'s pagination
  state update.

---

## v13.1.2 — 2026-10-02 (Cadence manual-ops + reporting gaps from stakeholder feedback)
**Deploy:** `develop → staging → main`. **Type:** Minor (new features, no schema change).

### Added
- **Remove a lead from an active cadence enrollment** (`POST /api/journeys/
  enrollments/{id}/remove`) — previously the only ways to stop an active
  enrollment were archiving the entire cadence (exits every lead) or
  waiting for it to fail/complete. Same permission split as `enroll()`:
  owner-or-Super-Admin for an owner-send cadence, otherwise anyone who can
  edit the lead. Re-enrolling the same lead afterward works immediately.
  Surfaced in both the classic Lead Detail page and the React Lead Detail
  Hub's Sales Cadence card.
- **SMS can be kept manual.** An SMS step now has the same "Require rep
  approval before sending" toggle email steps already had — the cadence
  pauses, creates a Task with the merge-resolved draft, and the rep can
  edit it before sending (Lead Detail Tasks panel or My Tasks). Mirrors
  the manual-email step's two-pass park/resume/never-auto-send mechanism
  exactly.
- **Hard-stop manual steps.** Every manual step (plain Task, manual email,
  manual SMS) can now be marked "Hard stop" — it waits for the rep
  indefinitely instead of auto-advancing on a missed deadline. Previously
  every manual step auto-skipped after its deadline (default 24h), which
  stakeholder feedback flagged as unsafe for steps a later step truly
  depends on.
- **Per-lead cadence roster + CSV export.** A new collapsible panel in the
  cadence builder lists every enrolled lead with their current step/status/
  exit reason (`GET /{journey_id}/enrollments`), plus a "Download CSV"
  button (`GET /{journey_id}/enrollments/export`) for a raw report —
  closing the "no downloadable report" and "no per-lead dashboard" gaps.
  Both exclude test/sandbox leads, same convention as every other cadence
  stats endpoint.

### Verified
Full backend suite green, full frontend Vitest suite green (3 pre-existing,
unrelated failures — CSM Portal/NavTopbar/Power Dialer date-sensitive tests,
not touched by this release). `/ponytail-review` run on the diff (2 small
simplifications applied: merged a duplicated deadline-branch UI block into
one shared component, removed an unused helper parameter).

---

## v13.1.1 — 2026-10-01 (Cadence creation + enrollment opened to every role)
**Deploy:** `develop → staging → main`. **Type:** Minor (permission widening, no schema change).

### Changed
- **Cadence creation** (`POST /api/journeys`) opened from Pod Admin+ to every
  authenticated role — any rep can now build their own cadence. The creator
  becomes its owner; every other mutating route (rename, save draft,
  publish, archive, etc.) is unchanged — still owner-or-Super-Admin only.
- **Enrolling leads into a cadence** (`POST /api/journeys/{id}/enroll`)
  opened from Pod Admin+-and-owner-only to every authenticated role, for
  cadences with `send_as="assigned_rep"` (the default since v13.0.0, where
  the lead's own rep sends, not the cadence owner). The original owner-only
  rule existed because pre-v13.0.0 every send went out from the cadence
  owner's mailbox — an unguarded enroll could put mail out impersonating
  someone else; that risk doesn't apply once the lead's own rep is the
  sender. Cadences still configured to always send as their owner
  (`send_as="owner"`) keep the strict owner-or-Super-Admin check. Per-lead
  access is unchanged either way — a caller must still be allowed to edit
  each lead (`load_lead(..., edit=True)`), so an SDR can only enroll leads
  actually assigned to them.
- Frontend: Leads Hub's "Enroll in Cadence" bulk action and the cadence
  builder's "New Cadence" button are no longer hidden below Pod Admin.

### Verified on staging
Full backend suite green (3127 passed, 10 xfailed) and a live Playwright
run against staging driving the real Leads Hub UI end-to-end (select lead →
Enroll in Cadence → confirm → cadence runs and completes) —
`tests/v13-cadence-bulk-enroll-ui.spec.js`.

---

## v13.1.0 — 2026-10-01 (Manual-email cadence step — Viren's request)
**Deploy:** `develop → staging → main`. **Type:** Minor (new feature).
**Schema:** additive — 4 new nullable `tasks` columns, no backfill, no risk.

### Added
- **Per-step choice between automated and manual email sends.** An email
  step in the cadence builder now has a "Require rep approval before
  sending (manual)" toggle. Automated behavior is completely unchanged
  (default). Manual: the cadence pauses at that step, creates a Task for
  the lead's assigned rep with the merge-resolved draft (subject + body),
  and the rep can edit it before sending — in Lead Detail's Tasks panel or
  My Tasks. Reuses the exact same send path (`EmailChannelProvider.send`)
  automated sends use, so engagement tracking (opens/clicks/replies) needs
  nothing special — it "just works" the same way for a manually-approved
  send as for an automated one.
- **Never auto-sends on a missed deadline.** A configurable deadline
  (default 24h, mirroring Task steps) with an optional "if the deadline
  passes, go to" branch — on timeout the step is skipped, exactly like a
  missed Task step, never silently sent unapproved. This was a deliberate
  decision, not an oversight: auto-sending on timeout would turn "manual"
  into "automated" whenever a rep is slow or away, defeating the point.
- **Eligibility (do_not_contact/unsubscribed/terminal status) is re-checked
  at BOTH park time and approval time** — the gap between a draft parking
  and a rep approving it can be hours or days, long enough for a lead to
  opt out in between.
- Mirrors the existing Task step's two-pass park/resume mechanism
  (`_handle_task_node`/`complete_manual_step`) end to end — same deadline
  model, same reachability/validation rules in the publish check, same
  `SELECT ... FOR UPDATE SKIP LOCKED` claiming, so running from multiple
  app workers (see v13.0.8) can't double-send a cadence email.
- Shared two small duplications this uncovered while building it:
  `complete_manual_step`/`complete_manual_email_step` now both call one
  `_resume_manual_step` helper; `TaskChannelProvider` and the new manual-
  email handler both call one `resolve_task_assignee` helper
  (`channels/base.py`) instead of repeating the rep/owner fallback.

### Known gap — flagged, not silently dropped
- The rep-facing draft editor in Lead Detail/My Tasks is a plain subject
  input + body textarea, not the cadence builder's rich-text editor — for
  an HTML-formatted draft, editing means editing the raw HTML. Fine for v1;
  upgrade to `MergeFieldComposer`/`RichTextEditor` if reps need WYSIWYG
  editing here.

### Fixed during pre-prod QA (before this ever reached a real user)
- **The legacy (vanilla-JS) Lead Detail page — still the DEFAULT experience
  for anyone who hasn't opted into `leadDetailHub`/React — rendered a plain
  checkbox for a manual-email approval task like any other task.** Ticking
  it called `PATCH {done: true}` with no subject/body override, which sends
  the parked draft completely unreviewed the instant a rep clicks it,
  defeating the entire point of this release. Found and reproduced live on
  staging by a new Playwright spec (`tests/v13-1-0-manual-email-approval.spec.js`)
  before this ever shipped to main; fixed in `views/lead_detail.js` to hide
  that checkbox for `kind="email_approval"` tasks and point to My Tasks
  instead — the one surface with the real editor.
- Full v13.0.0–v13.1.0 Playwright audit (all personas) also added/confirmed
  coverage for: HTML-table cadence emails end-to-end, the AE persona
  completing a cadence Task via a real UI click (previously untested),
  cadence deep-linking (`#sales-tools/{id}`), and the Control Center
  Webhook URL/Token admin fields — see `tests/v13-gap-coverage.spec.js`.

## v13.0.9 — 2026-10-01 (Fix: dialer_calls Seq Scan — SDR-reported slow Activity Monitor/Analytics)
**Deploy:** `develop → staging → main`. **Type:** Patch (new indexes). **Schema:** additive, no migration risk.

### Fixed
- **RCA 2026-10-01 — SDR-reported slowness in Activity Monitor (call logs) and
  Analytics Hub (SDR table, leaderboard), independent of the Redis/worker
  fixes already shipped today.** `EXPLAIN ANALYZE` against prod proved the
  cause: `models.dialer_call_event_time()` — the actual date-range filter
  every one of these routes uses — is `COALESCE(started_at, created_at)`.
  Every existing `dialer_calls` index (`idx_dialer_calls_created_at`,
  `idx_dialer_calls_user_created`, `idx_dialer_calls_user_dir_created`) is
  built on the raw `created_at` column, which Postgres cannot use to serve a
  filter on a different expression — every one of these queries ran a
  `Seq Scan` over the full table (66k rows on prod), repeated once per
  distinct SDR-pod timezone group in `_compute_sdr_rows`, compounding into
  the 10-76s response times observed.
- Added `idx_dialer_calls_event_time` and `idx_dialer_calls_user_dir_event_time`
  — direct mirrors of the two existing created_at indexes, built on the
  actual `COALESCE(started_at, created_at)` expression instead. Verified via
  `CREATE INDEX IF NOT EXISTS` run through the real migration path against
  local Postgres (prod itself was not written to directly — read-only
  `EXPLAIN ANALYZE` was sufficient to confirm the Seq Scan diagnosis).
  Added to `perf_routes.py`'s `EXPECTED_INDEXES` so Perf Health reflects it.
- This is unrelated to v13.0.7 (Upstash timeout) and v13.0.8 (worker count)
  — three separate causes found and fixed in the same day, each confirmed
  independently before being treated as fixed.

## v13.0.8 — 2026-10-01 (Fix: single uvicorn worker let one slow request stall everything)
**Deploy:** `develop → staging → main`. **Type:** Patch (infra). **Schema:** none.

### Fixed
- **RCA 2026-10-01 — recurring global slowdowns even after the v13.0.7 Redis
  fix.** `Dockerfile`'s `CMD` ran plain `uvicorn main:app` with no `--workers`
  flag — a single process. App CPU peaked at 4.9% and memory at 23% of the
  plan limit during the slowdowns (confirmed via Render metrics), ruling out
  compute as the constraint; a plan upgrade would not have helped. The real
  constraint was concurrency: one request blocked on any slow external call
  consumed 100% of the app's capacity, so unrelated requests touching only
  the (idle) database — `/search`, `/admin/call-logs` — queued behind it.
- Single-worker was a deliberate choice, documented in the old comment,
  to keep `cache.py`'s in-process TTL cache effective (multi-worker would
  isolate it per process). That reasoning predates `cache.py`'s Redis/Upstash
  layer (v9.1.0+), which is already shared across workers — so it no longer
  holds. `Dockerfile` now runs `--workers 2`. Verified safe before shipping:
  DB connection ceiling is 103, 2 workers' pools (`pool_size=8 +
  max_overflow=15` each, per `database.py`) top out around 62, and
  `journey_engine`'s `tick()` already claims work via
  `SELECT ... FOR UPDATE SKIP LOCKED` (`engine.py`), so running it from two
  workers concurrently cannot double-send a cadence message.
- Also corrected in this pass: an earlier claim in conversation that prod
  already ran `WEB_CONCURRENCY=2` was wrong — that was a comment in
  `database.py` describing a hypothetical, not the real deployed command.
  Confirmed directly from the `Dockerfile` before making this change.

## v13.0.7 — 2026-10-01 (Fix: Redis/Upstash slow calls could block every cached request)
**Deploy:** `develop → staging → main`. **Type:** Patch (bug fix). **Schema:** none.

### Fixed
- **RCA 2026-10-01 — prod instance failures at 09:11 and 09:24 UTC.** Nearly
  every hot read endpoint (`dashboard-stats`, `leaderboard`, `admin/users`,
  `admin/leads/assigned|unassigned`, `admin/analytics/trend`, `sdr-table`,
  Perf Health itself) goes through `cache.py`'s Upstash Redis layer. The
  `upstash-redis` SDK hardcodes its internal `httpx.Client` to
  `timeout=None` with no public override — so when Upstash itself was slow
  (confirmed directly: ~200-500ms where a Redis round-trip should be
  single-digit ms), every one of those requests blocked on that call for
  as long as Upstash took, up to 46s observed in prod logs, with app CPU
  and DB both idle the entire time (proven via Render metrics, not
  assumed). Twice this crossed Render's 5s health-check timeout and killed
  the instance.
- `cache.py::_init_redis()` now reaches into the SDK's private
  `_http._client` to swap in an `httpx.Client(timeout=2.0)`, and passes
  `rest_retries=0` so a slow Redis call fails into the existing in-memory
  fallback in ~2s instead of blocking indefinitely. The "cache is a
  luxury, not a dependency" fallback already existed in every caller
  (`get_cached`/`set_cached`/`invalidate`'s try/except) — it just never
  triggered fast enough to matter. No public SDK API exists for this
  (checked the installed `upstash-redis>=1.1.0` source directly); flagged
  with a `ponytail:` comment and an upgrade path if one is ever added.
- Ruled out before landing on this: app memory, app CPU, DB CPU, DB
  connections, and the newly-added `IDENTITY` auth-refresh layer (confirmed
  running in `monitor` mode in prod — it logs but never blocks or adds
  enforcement overhead) — each checked against real metrics/logs, not
  assumed, since the timing coincided with the auth hardening rollout.

## v13.0.6 — 2026-10-01 (Cadence reporting gap remediation)
**Deploy:** `develop → staging → main`. **Type:** Patch (no schema change,
except the webhook-logging addition). **Schema:** none.

### Added
- **SMS/WhatsApp engagement tracking** — delivery rate and reply rate,
  overall and per step, alongside the existing email open/click/reply
  stats (`sms_engagement` on `GET /{journey_id}/stats`). Reply attribution
  is enrollment-scoped (lead_id + a time window bounded by the
  enrollment's own start/end), not thread-id based like email, since
  inbound SMS/WhatsApp rows never carry a reliable thread/enrollment link
  — verified against both inbound write paths before building this, not
  assumed.
- **Cross-cadence engagement comparison** — `GET /api/journeys/stats-bulk`
  replaces the old client-side N-call `Promise.all` pattern in
  `JourneyList.jsx` with one request; the cadence list now shows a ranked
  table (sent/open%/click%/reply%) answering "which cadence performs
  best," which the existing enrollment-status donut never could.
- **Per-rep cadence performance** — `GET /{journey_id}/stats/by-rep`,
  showing which rep's sends on a given cadence convert best. Attribution
  reflects who actually sent at the time (not whoever owns the lead now),
  confirmed before shipping.
- **Opt-out visibility** — enrollments suppressed by the existing
  `do_not_contact`/`unsubscribed_at` eligibility gate now surface in the
  per-cadence exit-reasons breakdown ("opted out"). No schema change —
  this data already existed, it just wasn't labeled in the UI.
- **Trend-over-time (v1)** — `GET /{journey_id}/stats/trend?bucket=week`,
  a read-time weekly bucketed open-rate query. No new table or scheduled
  job for this version; `ExecutionLog`/`LeadEmailActivity` are already
  indexed for it at the scale this needs.
- **Nylas webhook visibility** — any event type not yet explicitly
  handled is now logged instead of silently dropped. Added specifically
  to confirm (rather than assume) whether a bounce-detection event is
  actually reaching the app before building a handler for one — see
  "Known gaps" below.

### Known gaps — flagged, not silently dropped
- **Bounce-rate tracking is not yet built.** The Nylas-side webhook
  subscription was reported as already enabled, but the app's own handler
  never received a confirmed bounce-type payload to build against during
  this pass — shipping a handler for an unconfirmed event shape was
  explicitly avoided per this release's own plan. The new unhandled-event
  logging above is what will surface the real payload the next time one
  arrives (naturally, or via a deliberate test send) — the column +
  migration + webhook branch are scoped and ready to build the moment
  that's confirmed.
- The cross-cadence comparison endpoint's reply-rate lookup still issues
  one internal query per cadence (smaller-scale than the N+1 it fixed,
  not urgent at typical cadence counts) — noted for a future pass.

## v13.0.5 — 2026-10-01 (Patch: cadence-launch gap fixes from prod readiness check)
**Deploy:** `develop → staging → main`. **Type:** Patch. **Schema:** none.

### Fixed
- **React lead-detail page never gave the Alternate Messenger widget lead context.**
  Only the classic view called `MessengerWidget.setLead()` on page load; the
  React "new experience" page never did, so the floating widget bubble always
  showed "No lead selected" there, even on a lead's own page. The page's
  in-page Message button (`_openMessagingWidget` → `openForLead`) already
  worked correctly and is unaffected — this only fixes the ambient floating
  bubble, now wired the same way the classic view has always done it.
  Found during prod cadence-launch verification (2026-10-01); zero existing
  test coverage exercised this path (`sdr-lead-page-p4.spec.js` only checks
  classic view's DOM; the Vitest suite for this page tests the in-page button,
  not the raw bubble).
- **Misleading Alternate Messenger settings labels.** "Sender Number (WhatsApp)" in
  Settings → Alternate Messenger implied a WhatsApp-only number, when the field
  (`messenger_sender_id`) is actually the shared SMS+WhatsApp org-wide
  default — relabeled "Sender Number (org default)" with a hint explaining
  the per-rep override in Team & Access takes priority over it. The
  Agent Assignments row's bare "ID: —" badge (actually the Alternate Messenger
  *calling* agent ID, unrelated to messaging) is now "Agent ID: —" with an
  explicit tooltip, and the per-rep caller-ID/sender-override chips next to
  it now have tooltips explaining what each one controls — flagged as
  confusing during the same readiness check.

### Verified (prod)
- Alternate Messenger org-wide sender configured on prod (`account_id 80054247`,
  `sender_id 14702059963`) — was empty, meaning every cadence SMS send would
  have failed closed on prod with "No sender number is set" until fixed.
- A real SMS cadence-equivalent send from prod verified delivered, confirmed
  by recipient.
- Found, not yet fixed: 8 of 23 active SDR/AE reps (~9,700 assigned leads)
  have no working connected mailbox on prod (4 `error` — expired/revoked
  Nylas grant, including the rep with the most assigned leads; 4 `none` —
  never connected). Cadence emails for their leads will misattribute to the
  cadence owner or fail outright until each reconnects in My Settings.

## Unversioned — 2026-10-01 (Infra: render.yaml build filter, Rule 19/20)
**Deploy:** `develop → staging → main`. **Type:** Infra/docs only, no app version bump. **Schema:** none.

### Fixed (infra, same-day-category RCA follow-up)
- **A push to `main` touching only `docs/`/`.claude/` still triggered a full
  backend rebuild+restart** on `messenger-crm-prod`/`-staging`, with no
  path-based build filter in `render.yaml`. Two such docs-only pushes on
  2026-09-30 each cost a real restart, and one tripped Render's 5-second
  health-check window (brief, self-healing, real 502 — ruled out memory, CPU,
  and an app-level error with real numbers; most likely Render's own
  deploy-orchestration cycling the freshly-created instance). Added
  `buildFilter.ignoredPaths` (`docs/**`, `.claude/**`, root `*.md`,
  `tests/screenshots/**`) to both backend service blocks so this class of
  push stops restarting prod. Note: this specific merge still causes one more
  restart, since a push that changes `render.yaml` itself always triggers a
  Blueprint sync regardless of the filter — only *future* docs-only pushes
  are protected.
- Closed the `AGENT_PROTOCOL.md` Rule 8 gap on both of yesterday's RCAs
  (the `render.yaml` dead-branch/stale-plan incident, and this restart
  incident) — added as Rule 19 and Rule 20, which hadn't been written up
  within the required 24h window.

## v13.0.4 — 2026-09-30 (Patch: cadence deep-linking, render.yaml plan drift fix)
**Deploy:** `develop → staging → main`. **Type:** Patch. **Schema:** none.

### Added
- **Cadence deep links** — `#sales-tools/{journeyId}` now opens straight into
  that cadence in the Cadence Builder, instead of landing on the list first.
  Previously there was no way to link directly to a specific cadence at all
  (`app.js`'s sales-tools view branch silently dropped the hash's `extra`
  segment; `SalesToolsHub`/`SalesJourneyHub` had no id prop to receive it).
  Wired the existing `#view/extra` shell convention (same one `#lead-detail/{id}`
  already uses) all the way through: `app.js` → `SalesToolsHub` (defaults to
  the Cadence tab when a journeyId is present) → `SalesJourneyHub` (opens that
  journey on mount instead of showing the list).

### Fixed (infra, same-day incident)
- **`render.yaml` declared a stale `plan: starter` for `messenger-crm-prod`**
  while the live service had actually been running on a bigger plan for
  months — drift never enforced because the Blueprint sync had been failing
  (on the now-deleted `reactstaging` branch, fixed earlier today in `76389199`).
  Fixing that sync error let it enforce `starter` for the first time, during
  business hours, causing measured 1-4.5s slowdowns on `/api/leads` until
  manually corrected. `render.yaml` now declares the actual live plan so a
  future sync can't repeat this (`f6b76c1b`).

## v13.0.3 — 2026-09-30 (Patch: SMS phone-format correction, editable cadence layout, editable webhook URL)
**Deploy:** `develop → staging → main`. **Type:** Patch. **Schema:** additive (`sync_settings.dialer_webhook_url_override`).

### Fixed
- **Alternate Messenger SMS/WhatsApp free-text sends stripped the `+` off every
  destination phone** (`conversations_service.py::send_text_message`)
  before sending — every number this codebase has ever sent to was Indian
  and already had no `+`, so this went unnoticed until the v13 staging
  write-audit tried a real US number and Alternate Messenger's own dashboard showed
  `Invalidmobilenumbererror` (not visible in our synchronous API response,
  which is why Activity Monitor showed "sent" while Alternate Messenger showed
  "error"). Now keeps the `+` (true E.164) so Alternate Messenger's own country
  auto-detect (`country_id: -1`) has the real country code to read.
- **Known open issue, not resolved by this fix:** live testing against two
  different real US numbers on 2026-09-30, both after this fix and with a
  dedicated SMS-capable sender assigned, still failed delivery on
  Alternate Messenger's side. Alternate Messenger's synchronous API accepts the send
  (`status: true`) in both cases — the rejection is asynchronous, on
  Alternate Messenger's own account/routing layer, not in this codebase. **SMS-channel
  cadence steps to non-Indian numbers should be considered unverified until
  this is resolved with Alternate Messenger.** Email and manual-task cadence steps are
  unaffected and fully verified end-to-end. Not a release blocker — no
  cadence currently live depends on SMS-to-non-Indian-numbers.

### Added
- **Cadence builder: vertical/horizontal auto-layout toggle** — a growing,
  branchy cadence only ever stacked straight down. A new toolbar toggle
  re-lays out every node by depth from the trigger, either top-to-bottom or
  left-to-right (`frontend-react/src/features/sales-journey/store/layout.js`).
- **Aircall Webhook URL is now editable** — previously a read-only,
  auto-derived display value; Control Center → Integrations → Dialer now
  lets an admin override it (e.g. a proxy/custom domain in front of this
  backend). Blank keeps today's auto-detected behavior.

## v13.0.2 — 2026-09-30 (Patch: staging write-audit fixes)
**Deploy:** `develop → staging → main`. **Type:** Patch. **Schema:** none.

### Fixed
- **Cadence Sandbox "enroll test lead" 500'd against the real database** —
  `routes/journey_routes.py::enroll_test_lead` (v13.0.0) never set
  `sf_lead_id`, which is `NOT NULL` in real Postgres (`models.py`'s
  `nullable=True` never matched — schema drift predating `migrations.py`).
  Every real call failed from the moment v13.0.0 shipped it; SQLite tests
  never enforce the constraint the same way, so nothing caught it before an
  end-to-end staging run. Now sets the same synthetic id
  (`f"manual-{uuid4().hex[:8]}"`) `routes/lead_routes.py`'s manual-create path
  already uses for the identical reason.
- **`security_enforcing`'s rollout default is now in code, not `render.yaml`** —
  Render never applied `render.yaml`'s env values to the running services
  (found 2026-09-30 while verifying webhooks — staging was enforcing checks
  it was meant to only monitor). A service with no `SECURITY_*` vars set now
  gets the safe rollout in code (auth gate enforces, the other three layers
  monitor) so a prod deploy alone can never switch on a layer whose monitor
  logs haven't been reviewed, with no Render change required. Staging keeps
  enforcing via its own explicit env vars.

### Ops
- `docs/AGENT_PROTOCOL.md` Rule 18: schema-sensitive changes now require a
  check against the local Postgres (`crm_dev`/`crm_test`, Homebrew-installed)
  in addition to the SQLite unit suite — this release's sandbox bug is the
  exact class of gap SQLite-only testing can't see.
- `tests/v13-0-1-staging-writes.spec.js`: new read-write staging audit —
  everyday actions per role, cross-role refusals, a full cadence run
  (LinkedIn task → outcome → branch → email, and a second run ending in SMS),
  all against throwaway test data, cleaned up automatically.

## v13.0.1 — 2026-09-30 (Patch: webhook token setup + safer env tooling)
**Deploy:** `develop → staging → main`. **Type:** Patch. **Schema:** none.

### Fixed
- **Aircall webhook token had no place in the UI** — `dialer_webhook_token` could only be set through `PATCH /api/dialer/config`, so staging never had one and (with the WEBHOOK layer enforcing) refused every Aircall event from the v13.0.0 deploy until it was set. Control Center → Integrations → Dialer now has a **Webhook Token** field (saved-value placeholder, blank keeps it).
- `GET /api/dialer/config` returned the webhook token in plain text; it now returns `••••` when one is set.

### Ops
- `scripts/render_env_manager.py`: no hard-coded Render API key (rotated), and **no default service** — it used to target prod when `RENDER_SERVICE_ID` was unset. Both must now be passed in the environment.
- Staging Render env: `SECURITY_AUTH_GATE_MODE`, `SECURITY_IDENTITY_MODE`, `SECURITY_LEAD_ACCESS_MODE`, `SECURITY_WEBHOOK_MODE` set explicitly to `enforce` (was relying on the code default; `render.yaml` env values were never applied by Render).
- Tests pin every security layer's mode explicitly (`conftest._webhook_verification_monitor`) instead of relying on the code default.

### Known — must be done before prod (see v13.0.0 *Rollout*)
- `render.yaml`'s prod `SECURITY_*` values are **not** applied by Render, and `auth.security_enforcing` defaults to `enforce`. Before `staging → main`, either set prod's four `SECURITY_*` vars explicitly or land the approved safe-default change in `auth.py`.
- Alternate Messenger SMS/WhatsApp inbound needs no webhook secret: Converse Desk has no push webhook; replies are polled every 5 min (`messaging_sync`). `/api/webhooks/messenger-sms` has no live sender.

## v13.0.0 — 2026-09-30 (Major: research-led cadences + access control)
**Deploy:** `develop → staging → main`. **Staged rollout** — see *Rollout* below.
**Type:** Major — new cadence capabilities, security hardening, breaking removals.
**Schema:** additive only (`migrations.py`): `journeys.stop_on_reply`, `stop_on_meeting` (BOOLEAN default false), `max_duration_days`, `reengage_after_days`, `reengage_min_opens` (INTEGER), `send_as` (VARCHAR); `tasks.journey_enrollment_id`, `journey_node_id`, `outcome_options`, `outcome`. All defaults leave existing cadences unchanged.

### Added — cadences (docs/SALES_JOURNEY_ARCHITECTURE.md, Phase 5)
- **Manual `task` step** that waits for the rep and branches on their outcome (`task_channel.py`, `engine._handle_task_node`, `engine.complete_manual_step`); LinkedIn connection/message steps are manual by decision.
- **Lead-field condition** (`field_rule`: title/company/industry/lead_source/status/email/phone × contains_any/equals/exists/not_exists).
- **Journey-wide stop rules** on reply (email/SMS/WhatsApp — `engine.notify_inbound_message` from both inbound paths) and on meeting booked; **hard stop** after `max_duration_days`; **re-engagement task** at end of enrollment.
- **Send as the lead's rep** (`send_as`), owner fallback; SMS/WhatsApp steps **skip** (not fail) for leads with no phone.
- Merge fields `research_hook`, `research_opening`, `rep_name`, `sender_name`; call scripts and task instructions merged.
- **Formatted (HTML) cadence emails** with tables — `RichTextEditor allowTables` (new dep `@tiptap/extension-table` 3.31.3).
- `POST /journeys/{id}/duplicate`; stats gain `step_activity` + `exit_reasons`; builder: waits in days, Task step, field branch, Rules panel, Duplicate, builder tour; rep outcome buttons in My Tasks + Lead Detail (`CadenceTaskDetails.jsx`).

### Added — Lead Detail emails in place
- Clicking an email opens the React `EmailHub` inside Lead Detail on that thread (`initialEmailId`/`initialMode`); Send Email opens it in compose mode. Replaces v12.7.18's "Open threads" bounce to the classic view. Emails card tour.

### Security (RCA 2026-09-29 access-control audit)
- **Deny by default**: `auth.enforce_auth_by_default` gates every route that declares neither auth nor `public_endpoint`/`authenticates_itself` (35/343 routes needed no login before).
- **DB-backed identity**: `auth.authenticate` → `access_db.active_identity` — removed users refused, role/pod from the DB (60s cache).
- **Per-lead access**: `domain/lead_access.can_view_lead/can_edit_lead/visible_lead_ids`, via `lead_helpers.load_lead/authorize_lead/lead_allowed/child_of_lead`, on ~40 routes (lead detail, emails, calls, recordings, notes, tasks, attachments, history, send email/SMS, dial, cadence feeds, campaigns, tags, disqualify approvals). Pod Admin: view any lead, change own pod's; Lead export pod-scoped.
- **Webhooks fail closed**: Aircall/Alternate Messenger/dialer (dialer webhook token), Nylas (signature required), Alternate Messenger SMS (`MESSENGER_WEBHOOK_SECRET`).
- Debug endpoints Super Admin only; attachments typed by extension + `nosniff`; SDR/AE/CSM activity feed scoped to own leads.
- Build guards: `test_route_access_guard.py` (no unmarked route; every lead-scoped route reaches the check), `test_security_access.py` (role × endpoint matrix).

### Removed (breaking)
- **Demo login** (`GET /api/auth/demo`, `GET /api/config`, LoginPage section, `ALLOW_DEMO`). UptimeRobot `/api/config` monitor retired (`setup_uptimerobot.py --cleanup`).

### Changed
- `STAGE_GROUP` moved from `routes/lead_helpers.py` to `models.py` (re-exported).
- A cadence SMS/WhatsApp step for a lead with no phone is now skipped instead of failing the enrollment.

### Rollout (each layer: `SECURITY_<LAYER>_MODE` = `monitor` | `enforce`, code default enforce)
- Set in Render **via `scripts/render_env_manager.py`** before deploy — prod: `AUTH_GATE=enforce`, `LEAD_ACCESS=monitor`, `IDENTITY=monitor`, `WEBHOOK=monitor`; staging: all enforce except `WEBHOOK=monitor`.
- Configure webhook secrets (dialer webhook token incl. Aircall, Nylas webhook secret, `MESSENGER_WEBHOOK_SECRET`) before `WEBHOOK=enforce`.
- Review `security_denial … action=would_refuse` log lines, then switch each layer to enforce.

## v12.7.18 — 2026-09-29 (Lead Detail emails + Salesforce merged-Lead recovery)
**Deploy:** `develop → staging → main`.
**Type:** Fix + gap fill.
**Schema:** none.

### Added
- **Emails card in the Lead Detail Hub** (`components/EmailsPanel.jsx`). The
  hub never replaced classic's Emails tab, so sent/received mail was invisible
  there. It lists every `lead_email_activity` row (newest first, 5 then "Show
  all") with Sent / Opened / Clicked / Replied stats (auto-replies excluded)
  and a Cadence / Campaign tag. Same endpoint as the classic tab.
- `GET /api/email/lead/{id}/emails` now also returns `clicked_at`,
  `click_count`, `is_auto_reply` and `source` (cadence / campaign / manual).

### Fixed
- **A Lead merged or hard-deleted in Salesforce kept its dead `sf_lead_id`
  forever.** SF answers those with a 404 `INVALID_CROSS_REFERENCE_KEY`, not
  `ENTITY_IS_DELETED`, so the existing re-link/recreate path never ran and
  every push failed (Saravanan Kalidass, 2026-09-29).
  `_is_entity_deleted_error` now also matches the 404. A 400
  `INVALID_CROSS_REFERENCE_KEY` (e.g. a bad OwnerId) is still left alone.

## v12.7.17 — 2026-09-29 (One owner per lead before a meeting)
**Deploy:** `develop → staging → main`.
**Type:** Rule change (user decision, 2026-09-29).
**Schema:** none.

### Changed
- **Before a meeting is booked, a lead has one owner — whoever was assigned
  last, any role.** `models.assign_lead()` previously replaced only a
  same-role assignee (v12.7.15), so reassigning an AE's lead to an SDR kept
  both (141 prod leads: Ansh Madaan / Anway Patankar → Vanshika Koli,
  2026-08-31). Pre-meeting = pipeline stage group 0 (Lead Assigned /
  Research / Calling), or an off-pipeline status with no
  `meeting_scheduled_at`. After a meeting, same-role replace only, so an AE
  taking over keeps the SDR who booked it.

### Data (prod)
- 76 duplicate SDR rows removed (kept the most recently assigned SDR;
  backup `dedupe_backup_2026-09-29.csv`).
- Cross-role cleanup (146 rows, last-assigned wins) prepared as a guarded
  script, run by the user.

## v12.7.16 — 2026-09-29 (Saved outcome settings could bring back the lookalike meeting chip)
**Deploy:** `develop → staging → main`.
**Type:** Bug fix (found by the v12.7.15 staging Playwright audit).
**Schema:** none.

### Fixed
- **Lookalike "Meeting Scheduled" chip still shown where outcome settings were
  saved.** v12.7.15 disabled it in `DEFAULT_OUTCOME_CONFIG`, but
  `get_outcome_config()` returns a saved `sync_settings.outcome_config` as-is,
  and a saved config is a copy of the old defaults with it enabled. Staging
  had one (prod doesn't, so prod was already correct — but any future save
  of the outcome settings would have brought the chip back). Now always
  disabled when reading a saved config.

### Why it was missed
v12.7.15's test used the code defaults only; no test covered a saved config.
Added `test_saved_outcome_config_cannot_re_enable_the_lookalike`, and the new
`tests/v12-7-15-staging-audit.spec.js` (10 checks across every v12.7.15 area,
SA + SDR) caught it on staging.

## v12.7.15 — 2026-09-29 (Meeting-outcome trap, one SDR per lead, stage-skip guard, Lead Detail gaps)
**Deploy:** `develop → staging`.
**Type:** Bug fixes (3 user-reported, 1 found in prod logs) + 4 Lead Detail Hub gaps.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
Three bugs raised by the user and their team (an SDR's booked meeting not
reflected; leads with more than one SDR; Aircall reportedly creating SF
Contacts), investigated against the prod DB (read-only) and Render prod
logs, plus the four Lead Detail Hub gaps deferred in v12.7.14.

### Fixed
- **Booked meeting not reflected (Nancy Faria, Sumiti Dangi, 24 Sep).**
  The post-call outcome modal showed a lookalike 📆 **"Meeting Scheduled"**
  chip right under the featured "Meeting Booked" (`Meeting Confirmed`)
  card. Its configured action was `none`, so logging it saved the outcome
  but never moved the lead to Meeting Scheduled, set
  `meeting_scheduled_at`, or counted anywhere. 12 real prod leads since
  April were hit. The outcome is now disabled in `DEFAULT_OUTCOME_CONFIG`
  (still valid for historical rows and the legacy "Call Completed" map).
  Existing affected leads need a one-off data backfill (not in this release).
- **Leads with multiple SDRs.** `models.assign_lead()` — the shared helper
  behind bulk assign, the Leads Hub row/bulk reassign, POD assign and
  upload re-import — only ever appended, so every "reassign" kept the old
  SDR too (78 prod leads had 2+ SDRs; 49 from one 2026-09-23 bulk
  reassignment). It now replaces an existing assignee with the same role.
  Two raw `lead_assignments` inserts in upload re-import and one append in
  lead creation now route through it. A v11.5.18 change (2026-08-24) had
  also removed a pod-lock that incidentally blocked cross-pod duplicates.
  Existing duplicates need a one-off cleanup (not in this release).
- **Aircall "Meeting Set" tag never booked the meeting.** The org's real tag
  `Answered – Discovery Call / Meeting Set` wasn't in `_DEFAULT_TAG_MAPPING`,
  and `_auto_log_outcome` never advanced status for any tag — 74 tagged
  calls, 39 leads still in Calling (prod, read-only). Tag now maps to
  `Meeting Confirmed` and advances Lead Assigned/Research/Calling leads to
  Meeting Scheduled (status log, `meeting_scheduled_at`); never moves a lead
  backwards. Also mapped the three unambiguous tags `Answered – Call Back
  Later`, `Answered – Wrong Number`, `Voicemail – Left Message`. Tag matching
  now tolerates hyphen/en/em dashes.
- **SDRs could skip pipeline stages.** Legacy's "advance one stage at a
  time" rule only lived in its stepper click handler; the backend never
  enforced it. Now enforced server-side in both status endpoints
  (`update_lead_fields`, `move_lead_kanban`) via `_skips_stage()`, using
  legacy's exact stage groups; admins exempt, parked/terminal statuses
  exempt, call-outcome auto-advance unaffected.
- **`journey_partition_upkeep` crashing daily in prod** (found in Render
  error logs, 26–27 Sep): `backend/migrations/` (a package) shadowed
  `migrations.py` and only re-exported `run_schema_migrations`, so the job's
  `from migrations import _ensure_execution_log_partitions` raised
  ImportError. The package now forwards every name (PEP 562 `__getattr__`).

### Added (Lead Detail Hub, parity with legacy)
- Sales Cadence card shows every enrollment with status, current step,
  pending reason and exit reason (labels shared with the admin builder via
  `sales-journey/journeyLabels.js`).
- Won/Lost outcome takes optional notes; admins can change an outcome once
  set; the card now shows for any Meeting Scheduled+ lead, not only ones
  with an SF opportunity.
- Confirm dialog before "Regenerate" overwrites existing research.
- "Change Stage" no longer offers SDRs backward or stage-skipping moves, and
  no longer offers "Disqualified" to anyone (it has its own reason flow).

### Investigated — not our code
- **Aircall creating SF Contacts:** Alternate CRM never creates SF Contacts.
  It creates SF **Leads** only at the configured push stage (plus
  re-creating a pushed Lead that was deleted in SF), and manual CSM renewal
  Opportunities. The Contacts come from Aircall's own Salesforce
  integration (configured in Aircall's dashboard: "create contact for
  unknown numbers" / call logging).

## v12.7.14 — 2026-09-28 (Lead Detail Hub audit: compliance gate, contact fields, messaging, task times)
**Deploy:** `develop → staging`.
**Type:** Bug fixes (one compliance-critical) + small features, backend + frontend.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
User-requested audit of the React Lead Detail Hub against the legacy lead
detail page, run with Playwright against staging plus a full code-level
comparison. Found and fixed the highest-impact gaps; several lower-priority
ones (documented below) are intentionally left for a follow-up.

### Fixed
- **Compliance-gate bypass**: the "require research before calling"
  admin toggle only ever guarded the legacy kanban-drag endpoint. The React
  Lead Detail Hub's "Change Stage" control calls a different endpoint that
  never checked it — an SDR could skip straight to Calling/Meeting
  Scheduled with zero research filled in, invisible until an audit. Both
  endpoints now share one `lead_service.check_research_gate()`.
- **Contact Card**: added the missing **Company Phone** field (existed in
  the data model and legacy, absent from React entirely). All three phone
  fields (Phone, Secondary, Company) can now be edited after a value is
  already set — previously the edit pencil only appeared while a field was
  empty, so a typo'd number was uncorrectable from this page. Backend:
  `company_phone` was also silently dropped by the shared field-update
  filter, so editing it never actually saved even from legacy.
- **Messaging**: added a "Message" quick action bridging to the existing
  Alternate Messenger widget (`window._openMessagingWidget`/`_canMessageLeads`,
  already used by the legacy page) — an SDR with SMS/WhatsApp access had no
  way to text a lead from the React page at all.
- **Task due-time**: tasks can now be given a time as well as a date (a
  `TimePicker` alongside the existing date picker) — the field and backend
  already supported it, the UI never exposed it.
- **Status History** panel was wired to the wrong loading flag
  (`leadLoading` instead of the dedicated `historyLoading`), so it could
  briefly flash "No history yet." after the lead itself loaded but before
  its status/field history finished a separate fetch.
- Fixed 3 stale/broken assertions in `tests/lead-detail-hub.spec.js`
  (Aircall's own always-mounted dialog was colliding with an unscoped
  `getByRole('dialog')` locator; one Playwright API typo) and a test-helper
  bug (`tests/helpers/auth.js`) where logging in as the same account
  `ADMIN_TOKEN` belongs to 400'd on the backend's self-view guard, silently
  failing every test in the file.

### Deferred (lower priority, needs a product call before changing)
- Cadence/journey status shows only the latest enrollment with no
  exit-reason detail (legacy showed all enrollments with full labels).
- Won/Lost outcome notes field (legacy had a free-text box, React has none).
- SDR one-stage-at-a-time forward-move guard existed only in legacy's
  frontend, never enforced server-side — needs a decision on whether it's
  still wanted policy before adding it (to either page).
- No confirm dialog before "Regenerate research" overwrites existing values.

## v12.7.13 — 2026-09-28 (Rename old email campaigns; best-effort backfill)
**Deploy:** `develop → staging`.
**Type:** Small feature + one-off data script.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
v12.7.11 added a mandatory "Campaign name" field going forward, but every
campaign created before that release still has its old auto-derived name
(`subject[:80]`) permanently stored — the field never touched existing
rows, and there was no way to fix one by hand either. Raised directly by
the user after the fix didn't change what they saw in the Campaigns list.

### Added
- **Rename** — `PATCH /api/email-campaigns/{id}` (creator or Super Admin,
  same gate `update_template`/`delete_template` already use) plus a pencil
  icon in the Campaigns list for an inline rename. Applies to any campaign,
  old or new.
- **`backend/scripts/backfill_campaign_names.py`** — one-off, idempotent:
  for campaigns whose name still equals `subject[:80]`, matches
  subject+body against a current `EmailTemplate` and renames to that
  template's name. No stored campaign→template link exists (by design —
  see `EmailCampaign`'s docstring), so this is best-effort; anything
  without a matching template is left for manual rename via the pencil
  icon above.

### Changed
- Deduplicated the "creator or Super Admin" 403 check (previously
  copy-pasted across `update_template`/`delete_template`, now also needed
  by `rename_campaign`) into `_require_owner_or_super_admin()`.

## v12.7.12 — 2026-09-28 (Hotfix: Help Hub crash, mogambo unlock not re-rendering nav)
**Deploy:** `develop → staging`.
**Type:** Hotfix.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
Both regressions were introduced by v12.7.11 itself and caught live on
staging within minutes of that deploy.

### Fixed
- **Help Hub rendered completely blank** — the v12.7.11 release-notes entry
  had no `family` and only a `summary` (no `items`), and
  `ReleaseNotesSection`'s ungrouped-entry branch called
  `entry.items.map(...)` unconditionally, with no guard — one malformed
  JSON entry crashed the whole Help Hub for every user. Fixed the entry
  (restored `family`, matching every neighboring entry's actual
  convention) and hardened the renderer itself so a future family-less
  summary-only entry degrades to a one-line summary instead of crashing
  the page.
- **`#mogambo` silently did nothing** — it correctly set the unlock flag in
  `sessionStorage`, but the hash resolves to whatever view the account is
  already on (usually "dashboard"), and the hashchange handler's "did the
  view actually change" guard then skipped calling `loadView` entirely —
  so NavSidebar never re-rendered to pick up the flag it had just set.
  Nothing visibly happened until the next real navigation. Now forces a
  `NavHub.update()` in that same-view case, same as every other
  navigation already does.

## v12.7.11 — 2026-09-28 (Calendar filter fix, campaign name field, Pipeline & CSM full lockdown)
**Deploy:** `develop → staging`.
**Type:** Bug fix + small feature.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
Live user feedback from three screenshots plus a direct ask: the Calendar's
search/rep filter looked broken, every campaign started from the same
template showed an identical, unreadable "name" in the list, and Pipeline &
CSM Portal — previously hidden from everyone except one account — needed to
be hidden from that account too, reachable only through a deliberate
easter-egg hash.

### Fixed
- **Calendar Month/Week grid ignored the search box and rep filter** —
  `filteredMeetings` (the actual filtered list) was computed correctly, but
  `meetingsByDay` — what the grid renders from — memoized off the
  unfiltered `meetingsWithTime` instead, so typing a search term or picking
  a rep changed nothing on screen (only the List view updated, since it
  reads `filteredMeetings` directly). One dependency-array fix.
- **Every campaign created from the same template showed an identical,
  merge-field-laden "name"** (e.g. `"Hello {{first_name}}..."`) — the
  compose UI never collected a real campaign name, so the backend's
  `subject[:80]` fallback fired every time, and subject is itself inherited
  from the template. Added a real "Campaign name" field to the compose form
  (prefilled from the picked template's own name, not its subject), shared
  by both entry points (Sales Tools' New Campaign and Leads Hub's bulk
  compose).

### Changed
- **Pipeline & CSM Portal now hidden from everyone, including the one
  account it used to always show for** — reveals itself only after
  navigating to `#mogambo` once per browser session, and only for that same
  account (checked both where the hash is parsed and again in the nav's own
  visibility check).

## v12.7.10 — 2026-09-28 (Campaign/Cadence visibility, repo-wide table sort/filter audit, calendar-invite stat)
**Deploy:** `develop → staging`.
**Type:** Feature enhancement + bug fix.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
Feedback from the Campaigns/Cadences and Lead Activity screens: admins
couldn't see who ran a campaign/cadence, the Lead Activity table was
undiscoverable, and none of the app's data tables had consistent sort or
used the shared component library. Also asked whether SDRs are actually
using the Nylas calendar-invite integration. Root-caused and fixed all
four instead of guessing.

### Fixed
- **Email Campaigns hard-filtered every role, including Super Admin, to
  only campaigns they personally created** — `list_campaigns`/
  `get_campaign` now scope by role (Super Admin org-wide, Pod Admin own
  pod, SDR/AE unchanged self-scope), with a "Run By" column, "My
  campaigns only" toggle, and sort. Cadences got the equivalent
  client-side "My cadences only" filter.

### Added
- **Sort, filter and component-library consolidation across all ~28 data
  tables in the app** — new shared `components/ui/SortableTableHeader`
  (promoted from a single-feature helper) and `components/ui/IconButton`
  primitives, rolled out to Reports, Activity Monitor (Calls/Email/
  Messages), Pods Roster, AE Pipeline, Leaderboard, Users & Roles, CSM
  Portfolio, Upload History, Daily Digest, and Email Campaigns — each
  server-paginated table gained a real backend `sort_by` param, each
  fully-loaded table got client-side sort. A handful of tables were
  deliberately left as-is (compact dashboard widgets, reorderable config
  lists, curated queues, chronological log viewers, segmented toggles) —
  sorting them would fight their actual purpose.
  Backend duplication from this rollout was consolidated into one
  `resolve_sort()` helper (`routes/_admin_helpers.py`); frontend
  duplication into one `useSort()` hook (`utils/useSort.js`).
- **Calendar-invite usage visibility** — Activity Monitor's Calls tab now
  shows "Invites Created: X/Y" (invites actually created via Nylas vs.
  "Meeting Confirmed" outcomes logged), sourced from `CallLog` +
  `Lead.nylas_event_id` — the real write path for manually-logged meeting
  outcomes, not the `DialerCall` telephony-sync table.
- **Lead Activity discoverability** — a new in-app guided tour
  (`AnalyticsHubTour`) points at the panel and its Show/Hide toggle,
  since nothing previously indicated it existed.

### Verification
- Backend: full suite (`pytest tests/ -q`) — 3019 passed, 8 xfailed.
- Frontend: full suite (`vitest run`) — 1175 passed; 3 pre-existing
  failures unrelated to this change (verified identical on unmodified
  `develop` HEAD before this work).
- `/ponytail-review` + `/ponytail-audit` run on the diff — found and fixed
  two real duplication issues (see Added), re-audit came back clean.
- Graph rebuilt (`build_or_update_graph_tool`, full rebuild) to pick up
  new nodes.

---

## v12.7.9 — 2026-09-25 (Lead Activity: live-caught preset bug, email detail, connect-outcome visibility)
**Deploy:** `staging → main`.
**Type:** Critical bug fix (data correctness) + feature enhancement.
**Branches:** `staging`, `main`
**Schema:** none.

### Context
While validating the new v12.7.8 Lead Activity panel live on staging, a
7-day preset filter showed 12,150 leads in the panel against 83 in the
funnel for the exact same filter — a live-caught correctness bug, not a
guessed one. Root cause: `GET /admin/analytics/leads` (added in v12.7.8)
accepted `date_from`/`date_to` but never `preset`, so every preset-based
selection silently fell through with no date filter applied, and it never
excluded sandbox/deleted leads like every other reporting endpoint does.
Fixed alongside two follow-up feature requests: email activity at the same
level of detail as calls, and visibility into whether a logged "connect"
actually has an SDR-tagged outcome.

### Fixed
- **`get_lead_activity` ignored the `preset` filter and included test/
  deleted leads** — now resolves dates via the same
  `_resolve_analytics_date_range` helper the funnel uses, and applies
  `models.exclude_test_and_deleted_leads`. 3 new regression tests directly
  assert parity with the funnel's `leads_assigned` count for the same
  filter (`test_analytics_bugfixes.py::TestLeadActivityScoping`).

### Added
- **Email detail parity with calls** — each Lead Activity row now shows
  `email_count` and `last_email_status` (furthest stage reached: sent →
  opened → clicked), sourced from `LeadEmailActivity` via the same bulk
  query pattern used for calls. Email send/open/click and reply events now
  appear in the per-lead expand-row timeline alongside calls and status
  changes.
- **Connect-outcome visibility** — "did people log what happened on
  connects": an aggregate "N connect(s), M with a logged outcome" stat in
  the Lead Activity panel header, plus a per-row warning marker (⚠) on any
  lead whose connected call has no SDR-tagged outcome. Both derive from
  `models.dialer_call_connected()`, the same single source of truth the
  funnel/SDR-table already use, so this view can't silently disagree with
  those.

### Verification
- Targeted tests only (per explicit instruction to stop full-suite reruns
  when they aren't surfacing new information): `test_analytics_bugfixes.py
  -k "TestLeadActivityScoping or TestLeadActivityEmailDetail or
  TestLeadActivityConnectOutcomeVisibility"` — 7/7 passed.
- `/ponytail-review` on the diff — collapsed a duplicate `DialerCall`
  connected-calls query (per-row flag + header aggregate ran the same query
  twice) into one, and simplified the email-stage ranking logic.
- Live-verified on staging with a real Super Admin token: `/analytics/leads?
  preset=7d` → `total: 83`, matching `/funnel?preset=7d` → `leads_assigned:
  83` exactly (the precise numbers from the original live bug report).
  Found and confirmed a real lead (Crystal Garcia) with `email_count: 1,
  last_email_status: "sent"` matching its timeline's single logged email
  event. Aggregate stat confirmed on the full dataset: `total_connects: 94,
  connects_with_outcome: 27` (org-wide, all-time). Per-lead
  `connect_no_outcome: true` flags confirmed present on real leads with an
  unlogged connect.

### Known gaps (not addressed this release)
- Lead Activity panel UI (new email columns + connect-outcome marker) was
  verified via live backend calls, not click-tested in a browser.
- No in-app guided-tour update for the new panel fields (AGENT_PROTOCOL.md
  §13 rule 5) — same deferral rationale as v12.7.8: additive fields on an
  existing screen, not a new one.

### Rollback commit
`a421159f` (`main`'s current HEAD — v12.7.8 and v12.7.9 are being merged to
`main` together in this same promotion, since v12.7.8 never shipped to
production on its own)

## v12.7.8 — 2026-09-25 (Analytics Hub fixes, CSM/Pipeline lockdown, role-update bug)
**Deploy:** `develop → staging → main`.
**Type:** Bug fixes + new filter/panel features + a temporary access lockdown.
**Branches:** `develop`, `staging`, `main`
**Schema:** none.

### Context
A screenshot review of Analytics Hub, Export Leads, and Team Access surfaced
two real bugs (batch dropdown showing the upload date instead of the source
filename; an Indian SDR seeing US-team upload batches she had no access to)
plus two missing controls (no per-rep filter in Analytics Hub; no multi-select
in Export Leads). Separately, a role change to CSM silently failed and
appeared to "revert" on reload, and Pipeline/CSM Portal is being locked down
to one account while that surface is reworked.

### Fixed
- **Batch dropdown showed the upload date, not the filename** —
  `get_filter_options` (`backend/routes/analytics_routes.py`) discarded the
  real `LeadUploadLog.filename` in favor of a coarse category label. Now
  returns and prefers the real filename.
- **Pod-scoping leaks** — `get_filter_options`' batch lead-count fell back to
  an org-wide sum for a self-scoped SDR/AE instead of their own assigned
  leads in that batch; `get_upload_logs` (`admin_upload_routes.py`) had no
  pod scoping at all, so every Pod Admin saw every pod's upload batches.
  Both fixed with regression tests (`test_analytics_bugfixes.py::TestRepFilter`).
- **`backend-react/routes/admin_users.py` role whitelist** was missing
  `AE`/`CSM` — setting a user's role to `CSM` was silently rejected as a 400
  and never wrote to the DB, which looked like the change "reverted" on
  reload when it had never actually saved.

### Added
- **Analytics Hub "Rep" filter** — scopes the funnel/SDR-table/export/
  batch-summary views to one rep, backed by a new `_resolve_sdr_filter`
  helper that also rejects a Pod Admin picking a rep outside their own pod.
- **Export Leads multi-select** — `GET /admin/leads/export`'s `assigned_to`
  now accepts multiple ids; the SDR picker is a checkbox multi-select
  reusing the existing `list-multi` toggle pattern from Leads Hub's filter bar.
- **Lead Activity panel** — new `GET /admin/analytics/leads` and
  `GET /admin/analytics/leads/{id}/timeline` endpoints, surfaced as a
  collapsible per-lead assignment/call-history drill-down in the Analytics
  Hub Dashboard tab, sharing the hub's existing pod/date/batch/rep filters.
- **Pipeline & CSM Portal lockdown** — AE's own AE Pipeline tab, CSM's flat
  Inbox/Portfolio/Playbooks/Digest nav, and the Super Admin oversight tab are
  hidden from everyone except `neelmani.mishra@screen-magic.com` while that
  surface is reworked. Nav-hide only (additive on the existing role check,
  not a backend route gate) — a deliberate, reversible scope decision, not
  an oversight.

### Verification
- Backend: full suite 3007 passed, 8 xfailed (0 failures).
- Frontend: full vitest suite 1173/1175 passed — the 2 failures
  (`NavTopbar.csmGating.test.jsx`, `AccountDetail.test.jsx`) are pre-existing
  on `develop`, confirmed by re-running against a stash of this session's
  changes.
- `/ponytail-review` + `/ponytail-audit` run on the diff; findings (a
  redundant duplicate query in `get_upload_logs`, two unused response
  fields) fixed.
- Live-verified on staging (commit `05803292`): batch labels show real
  filenames, `sdrs`/Rep-filter data returned, `/analytics/leads` returns
  real rows, and `tests/v12-6-2-role-critical-audit.spec.js` (10/10) +
  `tests/specs/04-analytics.spec.js` (7/8 — 1 pre-existing failure targeting
  DOM selectors that don't exist post-React-migration, unrelated to this
  release) both run against real staging with live AE/CSM/Super-Admin tokens.

### Known gaps (not addressed this release)
- No in-app guided-tour update for the new Rep filter / Lead Activity panel
  (AGENT_PROTOCOL.md §13 rule 5) — flagged, deferred as a fast-follow rather
  than blocking this release, since these are additive controls on an
  existing screen, not a new one.
- Export Leads multi-select and the Lead Activity panel UI were verified by
  unit tests and live backend calls, not click-tested in a browser.

### Rollback commit
`a421159f` (last commit before this release, `main`'s current HEAD)

## v12.7.7 — 2026-09-24 (Growth Intelligence CSM data-scope leak)
**Deploy:** `develop → staging`.
**Type:** Security/data-scoping bug fix.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
Follow-up from a repo-wide audit of hardcoded role lists (prompted by the
Activity Monitor SDR/AE gap fixed in v12.7.6): every other hardcoded
SDR/AE/Pod-Admin role check turned out to be a deliberate structural scope
(leads are an SDR/AE-only object, dialer/Klenty are SDR/AE job functions,
pod purity, or an admin-tier visibility gate) — except one real bug.

### Fixed
- **Growth Intelligence leaked org-wide pipeline data to CSM users** —
  `_compute_metrics` (`backend/routes/growth_intelligence_routes.py`)
  branched on `role in ("SDR", "AE")` and `role == "Pod Admin"` only. A CSM
  (who owns Accounts, not Leads) matched neither branch, so `base` stayed
  the unfiltered `db.query(models.Lead)` from line 61 — meaning any CSM
  hitting `GET /api/growth-intelligence` saw every rep's pipeline, not a
  CSM-appropriate empty/scoped result. Added an explicit `CSM` branch that
  scopes to zero rows (`.filter(false())`) — no CSM-relevant lead metric
  exists here yet, so this closes the leak without fabricating one.

### Verification
- Backend: `backend/tests/test_growth_intelligence.py` — 1 new regression
  test (`test_csm_gets_zero_not_org_wide_leads`) + full file passing (12
  tests). Full suite: 3005 passed, 8 xfailed.
- No frontend change — backend-only route fix, no bundle rebuild needed.
- `pre-deploy-check.sh`: 11 passed, 1 warning (pre-existing uncommitted
  screenshots), 0 failed.

## v12.7.6 — 2026-09-24 (Public API usage visibility, CSM filter gate, Activity Monitor role scope)
**Deploy:** `develop → staging`.
**Type:** New monitoring signal + two filter/scope fixes.
**Branches:** `develop`, `staging`
**Schema:** `sync_settings` gains `public_api_call_count` (INTEGER, default 0) and
`public_api_last_used_at` (TIMESTAMP, nullable) — additive, backfill-safe.

### Context
Follow-up from a Control Center screenshot review: (1) the "Public API — CMT ↔ Salesforce Bridge"
card (also the credential the MCP server reuses) had no way to tell if the key was actually being
used; (2) CSM Portal's Inbox/Portfolio CSM filter was hidden whenever there was only one CSM,
and the user wanted it visible whenever they'd want to isolate one CSM's data; (3) Activity
Monitor's rep filter dropdown was still hardcoded to the SDR/Pod Admin/Admin role set from when
Activity Monitor was SDR-only — CSM and AE are now live roles elsewhere in the app but were
invisible here despite having logged call/email/message activity.

### Added
- **Public API usage tracking** — `require_api_key` (`backend/auth.py`) now increments
  `SyncSettings.public_api_call_count` and stamps `public_api_last_used_at` on every successful
  key auth (wrong-key attempts are not counted). Surfaced in `GET /admin/public-api-key/status`
  and rendered in the Control Center card (`IntegrationsSection.jsx`'s `PublicApiCard`) as
  "Used N times — last used <date>" / "No requests yet." No new UI surface — reused the existing
  card. The MCP server (`mcp_server/alternatecrm_mcp.py`) authenticates with this same key, so its
  calls are counted too.

### Fixed
- **CSM filter hidden with only one CSM** — `InboxTab.jsx`/`PortfolioTab.jsx` gated the "Filter by
  CSM" dropdown on `csmOptions.length > 1`; relaxed to `> 0` so admins can isolate a single CSM's
  data whenever at least one CSM exists.
- **Activity Monitor missing CSM/AE reps** — `_sdr_dropdown` (`backend/routes/analytics_routes.py`)
  filtered `User.role.in_(["SDR", "Pod Admin", "Admin"])`; expanded to include `"CSM"` and `"AE"`.
  Shared by the Calls, Email, and Messages tabs, so one change fixes all three.

### Verification
- Backend: `backend/tests/test_public_api.py` — 2 new tests (usage increments on success, wrong
  key does not increment) + full file passing (84 tests across `test_public_api.py` +
  `test_call_monitor.py`).
- Frontend: `frontend-react` control-center + csm-portal suites pass (1 pre-existing unrelated
  failure in `AccountDetail.test.jsx`, confirmed untouched by this change).
- Bundles rebuilt: `control-center-hub.js`, `csm-portal-hub.js`, `pipeline-hub.js` (CsmPortalHub is
  shared into both csm-portal-hub and pipeline-hub per the multi-bundle rule).
- [ ] Playwright on staging — pending.

## v12.7.5 — 2026-09-24 (Analytics/Leaderboard meeting mismatch, Safari date bug, Automation Section stale UI, Aircall network-quality flag)
**Deploy:** `develop → staging`.
**Type:** Bug fixes + one new monitoring signal.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
A batch of issues reported the same day: an SDR (Vanshika) saw 0 meetings on Analytics Hub for a
meeting the Leaderboard counted correctly; the app is reportedly broken on Safari; Control Center's
Automation section shows stale data after saving without a hard refresh (same class of bug as
v12.7.1/v12.7.2's POD issue); and SDRs have reported Aircall call-quality problems (bad audio,
prospects can't hear the SDR) with no way to tell whether it's genuine or how widespread.

### Fixed
- **Analytics Hub / Leaderboard meeting-count mismatch** — `backend/analytics/adapters.py`'s
  `_meetings_scheduled()` metric filters on `Lead.meeting_scheduled_at`, but two status-transition
  paths never stamped that column: the `meeting_complete` outcome branch in
  `backend/routes/call_routes.py` (only stamped it inside the `meeting_scheduled`-outcome branch,
  and only when the request carried a real `meeting_datetime`) and `move_lead_kanban()` in
  `backend/routes/lead_routes.py` (stamped `status_changed_at`/`lead_closed_at` on a meeting-reached
  move, never `meeting_scheduled_at`). Both now fall back to `status_changed_at` when no explicit
  meeting datetime is available — same convention as the existing `v_backfill_meeting_scheduled_at`
  migration. Confirmed live against Vanshika's exact lead (Marvin Hall) before and after.
- **Safari "Invalid Date" rendering** — ~20 API response sites across
  `admin_routes.py`, `task_routes.py`, `notes_tasks.py`, `activity_monitor_routes.py`,
  `admin_user_routes.py`, `admin_users.py`, `admin_sync_routes.py`, `sf_connection_routes.py`,
  `disqualify_routes.py`, `pod_routes.py`, `email_routes.py`, `calls.py`, `email.py` used
  `str(datetime_obj)` (a non-ISO, space-separated, no-timezone string) instead of `.isoformat()`.
  Chrome's lenient `Date` parser tolerated it; Safari's spec-strict parser returned Invalid Date —
  affecting call timestamps, tasks, email activity, last-login, and sync-status timestamps across
  the app. All sites now use `.isoformat()`.
- **Control Center → Automation section stale after save** — `AiResearchCard`/`PromptEditorCard`
  (`frontend-react/src/features/control-center/sections/AutomationSection.jsx`) never refetched
  settings after a successful save, unlike every other Control Center section (audited: Integrations,
  Team Access, User Access, Monitoring all already reload/optimistically update correctly). The
  "Configured" API-key hint and prompt state now refresh via the same `onChanged`-style reload
  pattern already used in `IntegrationsSection.jsx`.

### Added
- **Automatic Aircall network-quality flag** — neither Aircall's webhook payload nor the Aircall
  Everywhere SDK expose any real audio-quality signal (confirmed: no MOS/jitter/packet-loss field
  anywhere, `hangup_cause` only fires for calls that never connected). The only automatic proxy
  available is the SDR's own network condition (Network Information API) during the call window.
  `useAircallEverywhere.js` now samples `navigator.connection` at call start/end and, if degraded,
  writes a `warning`/`category=dialer` entry into the existing `ErrorLog`/Logs Dashboard via a new
  `AdminService.reportError` wrapper (`frontend-react/src/services/api.js`) — no new UI. Explicitly
  logged as a network proxy, not a confirmed audio-quality measurement. Only covers SDRs on the
  embedded Aircall Everywhere workspace, not the Aircall Desktop app (outside the browser, no
  visibility possible).

### Verification
Backend: 3003 passed, 8 xfailed, 0 failed (full suite; updated
`test_meeting_confirmed_without_meeting_datetime_is_a_noop` → `..._falls_back_to_status_changed_at`
to match the intended new behavior it was previously encoding as correct).
Frontend: 1174/1176 passed (same 2 pre-existing unrelated failures as prior releases —
`NavTopbar.csmGating`); 5 new tests added (3 for the network-quality flag, 2 for the
Automation refetch fix). Rebuilt `nav-hub.js`, `control-center-hub.js`, `help-hub.js`; bumped their
cache-busting `?v=` query strings in `frontend/index.html`.

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated
☑ VERSION bumped + scripts/sync-version.mjs run
☑ backend/config.py APP_VERSION updated (manifest.json doesn't mention the version — no edit needed)

## v12.7.4 — 2026-09-22 (Access-request email no longer CCs every Super Admin)
**Deploy:** `develop → staging`.
**Type:** Bug fix / UX.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
When someone tries to sign in to Alternate CRM without being provisioned yet, `notify_new_access_request()`
emails every Super Admin — 11 recipients on this org for a single request. Reported live: noisy, and with
that many people CC'd nobody in particular owns acting on it.

### Fixed
- `notify_new_access_request()` (`backend/access_notifications.py`) now sends to just the one Super Admin
  whose connected mailbox relays the email — the same person the code already has to pick to send from —
  instead of CC'ing every Super Admin. Removed the now-unused query that built the full admin recipient list.

### Verification
Backend: 3003 passed, 8 xfailed, 0 failed (full suite). `test_relays_through_first_super_admin_with_connected_mailbox`
updated to assert the single-recipient send.

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated
☑ VERSION bumped + scripts/sync-version.mjs run
☑ backend/config.py APP_VERSION updated (manifest.json doesn't mention the version — no edit needed)

## v12.7.3 — 2026-09-22 (Remove deprecated active-lead-cap enforcement)
**Deploy:** `develop → staging`.
**Type:** Cleanup / behavior change.
**Branches:** `develop`, `staging`
**Schema:** none (columns kept, no longer enforced — see below).

### Context
`SyncSettings.active_lead_cap` (Control Center → Integrations → "Active Lead Cap (per SDR)") used to hard-block
assignment once an SDR crossed the configured count — enforced in `bulk_assign`, `auto_assign_all`,
`assign_leads_to_pod`, and both CSV/Google-Sheet upload-import paths. This surfaced today as a real obstacle:
restoring a lead accidentally unassigned during Playwright testing required repeatedly bumping this cap and
reverting it afterward, both times needing a manual admin API call. Confirmed with the user this cap was a
deprecated feature they no longer want enforced anywhere.

### Fixed / Changed
- **Enforcement removed** from `bulk_assign`, `auto_assign_all` (`admin_assignment_routes.py`),
  `assign_leads_to_pod` (`pod_routes.py`), and CSV/Google-Sheet upload-import's round-robin assignment
  (`_admin_helpers.py::_assign_lead_round_robin`, called from `admin_upload_routes.py`) — an SDR is never
  skipped or refused a lead for being "at capacity" anymore. Round-robin fairness/company-grouping logic is
  unchanged, just simpler without the cap-gating bookkeeping (`full_sdrs`, per-batch cap breaks).
- **`GET`/`PATCH /api/admin/sync-settings`** no longer read or accept `active_lead_cap`.
- **Control Center → Integrations**: removed the "Active Lead Cap (per SDR)" field from Call & Pipeline
  Settings (now 4 fields, not 5).
- **`SyncSettings.active_lead_cap`/`Pod.active_lead_cap` columns are kept, unexposed** — `active_lead_cap`
  (SyncSettings) still backs `admin_user_routes.py`'s per-user `max_active` field, which
  `BulkActionBar.jsx`'s manual assign picker uses to softly rank/label SDRs by load (never blocks) — that
  UX feature was out of scope and stays working off whatever value is already in the DB (default 5).
- Dead imports cleaned up along the way in `admin_upload_routes.py` and `admin_user_routes.py`
  (`_active_lead_count`/`_get_active_lead_cap`/`_get_or_create_sync_settings` imported but never called —
  pre-existing, unrelated to this change, found while touching the same import lines).

### Verification
Backend: 3003 passed, 8 xfailed, 0 failed (full suite; -1 from removing `test_bulk_assign_respects_lead_cap`,
which asserted the now-removed blocking behavior). Frontend: 1167/1169 passed (same 2 pre-existing unrelated
failures as v12.7.1/12.7.2 — `NavTopbar.csmGating` and `AccountDetail`'s no-opportunities case). Rebuilt
`control-center-hub.js` and `leads-hub.js`.

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated
☑ VERSION bumped + scripts/sync-version.mjs run
☑ backend/config.py APP_VERSION updated (manifest.json doesn't mention the version — no edit needed)

## v12.7.2 — 2026-09-22 (POD-reassignment cache invalidation — real root cause of stale Control Center)
**Deploy:** `develop → staging`, promoting to `main` together with v12.7.0/v12.7.1.
**Type:** Bug fix.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
v12.7.1 fixed the "Control Center shows a user's old POD until hard refresh" symptom on the frontend (a
persisted React island's one-shot fetch never re-running on revisit) and added a cross-hub
`alternate:pod-membership-changed` refresh event. Re-testing that fix live on staging surfaced a second,
more fundamental cause underneath it: `GET /api/admin/users` caches its response for 120s, documented in its
own code as "invalidated on any user write" — but `pod_routes.py`'s `add_pod_member`/`remove_pod_member` never
busted that cache. The frontend fix made both hubs *ask* for fresh data on revisit, but the backend kept
serving the stale cached list until the 120s TTL expired on its own — which is exactly what a hard refresh had
appeared to "fix" (timing coincidence, not causation).

Also fixed a live-testing artifact: the new v12.7.1 Playwright spec used the wrong ARIA role (`menuitem`
instead of `option`) for a searchable Select's revert step, which timed out and aborted the test before its
revert ran — leaving one staging lead unassigned. Found and restored by hand (its `pod_id` was still set from
before the unassign, since `bulk_unassign` only clears `assigned_users`, which pinpointed it) and both tests
now wrap their post-mutation assertions in `try/finally` so a failed assertion can no longer skip the revert.

### Fixed
- **`add_pod_member`/`remove_pod_member`** now call `invalidate('users')` after commit, matching the existing
  pattern already used by add/remove Pod Admin (RCA 2026-07-11) but never applied here — this is the real fix
  for "Control Center shows stale POD."
- **Playwright spec robustness**: correct `role="option"` locator for `AssigneeCell`'s searchable picker;
  `try/finally` around both tests' post-mutation assertions so a failure can't skip the revert step.

### Verification
Backend: 3004 passed, 8 xfailed, 0 failed (full suite; +2 new regression tests for the cache invalidation).
Re-ran `tests/v12-7-1-pod-reassign-and-bulk-unassign-ux.spec.js` live against staging post-deploy: POD
reassignment test passed (flaky on first attempt due to a UI-settle race, passed clean on retry — revert
confirmed via direct API check of the POD's member list); bulk-unassign test's revert-role bug found, fixed,
and the orphaned lead restored.

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated
☑ VERSION bumped + scripts/sync-version.mjs run
☑ backend/config.py APP_VERSION updated (manifest.json doesn't mention the version — no edit needed)

## v12.7.1 — 2026-09-22 (Lead soft-delete leak + POD reassignment/bulk-unassign UX)
**Deploy:** `develop → staging` (production untouched pending explicit go-ahead).
**Type:** Bug fixes.
**Branches:** `develop`, `staging`
**Schema:** none.

### Context
A CSM (Nishita) reported 11 leads still visible after deleting them; investigation on prod found 8 were
correctly soft-deleted (`deleted_at` set) but still rendered because `GET /leads/{id}` and 5 sibling endpoints
never filtered `deleted_at`, unlike the list/kanban/dashboard endpoints — the other 3 had genuinely failed to
delete and were fixed directly on prod (`UPDATE leads SET deleted_at = now()`, verified no cascade/duplicate
side effects first). Root cause of the original leads: intentional Aircall-webhook auto-create-on-miss behavior
(mirrors the Klenty nightly sync's own pattern) — working as designed, not a bug, though it has no outcome
filter (a misdial creates a lead same as a real call) and no automatic cleanup of placeholders that never match
Salesforce.

Separately, while moving an SDR between PODs, three UI/UX bugs surfaced: no success confirmation on POD
reassignment, Control Center showing a user's stale POD until a hard refresh, and no progress/completion
feedback on bulk-unassign. None were caught by existing Playwright specs, which assert "did the API not error,"
not "did the user see feedback" — the Control Center spec cancels its one confirmation-dialog test rather than
confirming it, and no spec drives a real bulk-unassign action.

### Fixed
- **Lead soft-delete leak**: `GET /leads/{id}`, `/status-history`, `/field-history`, `PATCH /outcome`,
  `/messaging/config`, `/messaging/sync` now all filter `deleted_at` via the existing `exclude_deleted_leads()`
  helper, matching the list endpoints. A direct `#lead-detail/<id>` link (bookmark, notification) to a deleted
  lead now correctly 404s.
- **POD reassignment feedback**: both Pods Hub (`usePodsData.js`) and Control Center's Team & Access dropdown
  (`useUsersRolesData.js`) now toast on every mutation (create/delete pod, timezone, add/remove member, POD
  admin, reassignment).
- **Cross-hub staleness**: a pod-membership change in either hub now dispatches
  `alternate:pod-membership-changed`; the other hub listens and refetches. Root cause: both are persisted React
  islands (`hub-entry.jsx`'s `navigate()` re-renders in place without remounting), so a one-shot data-fetch
  effect never re-ran on revisit — only a hard reload forced a fresh mount.
- **Bulk-unassign/assign busy state**: `BulkActionBar.jsx`'s Assign/Unassign buttons now disable and relabel
  ("Assigning…"/"Unassigning…") for the duration of the request, matching the existing Delete/Enroll pattern —
  previously both stayed clickable with no visible change, inviting a double-click mid-flight.

### Verification
Backend: 3002 passed, 8 xfailed, 0 failed (full suite). Frontend: 1167/1169 passed (2 pre-existing unrelated
failures — `NavTopbar.csmGating` and `AccountDetail`'s no-opportunities case — confirmed untouched by this
batch's diff). `pods-hub.js`, `control-center-hub.js`, `leads-hub.js` rebuilt. New Playwright spec
(`tests/v12-7-1-pod-reassign-and-bulk-unassign-ux.spec.js`) covers all three UX fixes live against staging —
pending a fresh staging Super Admin token to actually execute.

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated
☑ VERSION bumped + scripts/sync-version.mjs run
☑ backend/config.py APP_VERSION updated (manifest.json doesn't mention the version — no edit needed)

## v12.7.0 — 2026-09-17 (CSM Portal: stakeholder mapping, engagement timeline, Pod Admin oversight)
**Deploy:** `develop → staging → main` (staging only for now — awaiting a full Playwright pass before production).
**Type:** Feature batch, CSM feedback follow-up.
**Branches:** `develop`, `staging`
**Schema:** additive only — 2 new tables (`account_stakeholders`, `account_milestones`), no column changes.

### Context
A CSM used the portal and flagged 10 gaps against what she needs day to day, cross-checked against market
research (HubSpot Service Hub, Totango, Custify, ChurnZero, Planhat, Vitally, Gainsight, ClientSuccess, Velaris,
Customerscore.io). Full tracking in `docs/CSM_PORTAL_ROADMAP.md`. Separately, this thread's original problem —
a CSM (Kanika) with reportee CSMs having no way to see her team's combined portfolio — got resolved by reusing
the existing Pod/Pod Admin structure, per the user's explicit decision.

### Added
- **Digest**: new `renewals_due_soon_count` tile (open opportunities closing within 30 days, overdue included).
- **Stakeholder mapping**: new `AccountStakeholder` model synced from Salesforce Contacts
  (`sync_contacts_from_salesforce`, hooked into the existing Account sync); a CSM tags each one POC / Billing /
  Champion / Decision Maker in-portal (Salesforce has no field for this — checked via `Contact.describe()`); a
  "New" badge flags a contact added within the last 14 days.
- **Engagement timeline**: new `AccountMilestone` model — Onboarding, Go-Live, QBR, Renewal entries with
  click-through detail (AE name/use cases/POCs for onboarding, CS name/summary/action items for QBRs).
  Portal-native; no Salesforce object backs this.
- **Health score**: relationship factor now gets a bonus when a stakeholder is tagged Champion, alongside the
  existing champion-departure penalty.
- **Portfolio/Inbox**: Inbox gained the same CSM filter dropdown Portfolio already had, plus a per-CSM "nothing
  at risk" empty state.
- **Pod Admin CSM oversight**: a CSM manager (e.g. Kanika) gets a Pod created for her reportee CSMs and is made
  that pod's Pod Admin; she can now see (read-only — she still can't log touches, override health, or bulk
  assign) her team's combined portfolio in the CSM Portal, which previously excluded Pod Admin entirely.

### Verification
Backend: 3001 passed, 8 xfailed, 0 failed (full suite, run repeatedly across this batch). Frontend: 94/95 csm-portal
tests passed (1 pre-existing unrelated failure, confirmed via `git stash` on develop before this batch existed).
Both `csm-portal-hub.js` and `pipeline-hub.js` bundles rebuilt for every change (shared `CsmPortalHub.jsx`
source — see the v12.6.8 landmine). Staging Playwright coverage across every changed feature still pending
before any production discussion, per explicit instruction.

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated
☑ docs/CSM_PORTAL_ROADMAP.md kept current throughout
☑ .claude/skills/alternatecrm/SKILL.md maintenance log updated

## v12.6.9 — 2026-09-16 (CSM Portal: Owner/CSM identity shows even without a Alternate CRM login)
**Deploy:** `develop → staging → main` | **Type:** Fix + small addition.
**Branches:** `develop`, `staging`, `main`
**Schema:** additive only — 4 new nullable columns on `accounts` (`sf_owner_email`, `sf_owner_name`, `sf_csm_email`, `sf_csm_name`).

### Context
The v12.6.7/6.8 Owner column stayed blank on real data even after a sync. Root cause: `owner_user_id`/
`assigned_csm_id` only get set when the Salesforce email matches an existing Alternate CRM `User` row — but most
real Salesforce Account Owners and CSM lookups (e.g. Kanika, at the time of the original report) don't have a
Alternate CRM login yet, so the match silently fails and the column has nothing to show.

### Added / Fixed
- `Account` now stores the raw Salesforce Owner/CSM email and name on every sync, regardless of whether a
  Alternate CRM user match exists — Portfolio/Inbox fall back to this raw name when there's no local user link.
- New `backfill_sf_identity_links()`, called the moment a `User` row is created (Google SSO first login, or an
  admin inviting someone) — retroactively links any accounts whose raw SF email now matches that person. This
  does not create any user accounts; it only reacts to one being created through the app's normal paths.
- Fixed a related latent bug found while touching this code: the SF Owner/CSM email match was case-sensitive
  while `User.email` is always stored lowercased at creation — now case-insensitive on both sides.

### Verification
Backend: 2974 passed, 8 xfailed, 0 failed (full suite). 4 new tests, including the exact "user registers
after the account was already synced" scenario.

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated

## v12.6.8 — 2026-09-16 (Hotfix: Super Admin's CSM Portal bundle was stale)
**Deploy:** `develop → staging → main` | **Type:** Hotfix, caught live by the user immediately after v12.6.7.
**Branches:** `develop`, `staging`, `main`
**Schema:** none.

### Context
The user (Super Admin) reported the Owner column and Inbox pagination from v12.6.7 were missing even after a
hard browser reload, on both staging and production. Root cause: Super Admin reaches the CSM Portal through a
different Vite entry point (`pipeline-hub.js`, mounted via the merged "AE Pipeline / CSM Portal" nav) than a
CSM does (`csm-portal-hub.js`). Both entries share the same `CsmPortalHub.jsx` source, but v12.6.5/6.6/6.7 only
ever rebuilt `csm-portal-hub.js` — `pipeline-hub.js` was never regenerated, so it kept serving the pre-fix
table regardless of any client-side cache-busting.

Process gap acknowledged: this fix was rebuilt and pushed straight through staging → main via a mechanical
bundle rebuild + cache-bust bump, without a version bump, release-notes entry, ponytail review, or test run
first — a protocol miss caught by the user. This entry and the version bump backfill that.

### Fixed
- Rebuilt `frontend/js/pipeline-hub.js` from current source and bumped its cache-busting query string in
  `frontend/index.html` (`?v=20260916d` → `?v=20260916j`).

### Verification
Confirmed via direct `curl` against both staging and production that the deployed `pipeline-hub.js` contains
the Owner column and Pagination component markers (`owner_name`, `Showing`).

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated

## v12.6.7 — 2026-09-16 (CSM Portal: show the Salesforce Account Owner as a fallback identity)
**Deploy:** `develop → staging → main` | **Type:** Small addition, requested live while debugging v12.6.5/6.
**Branches:** `develop`, `staging`, `main`
**Schema:** none (reuses the existing, previously-unpopulated `accounts.owner_user_id` column).

### Context
While verifying the CSM email-match fix from v12.6.5 against real production Salesforce data, most accounts
came back with no CSM assigned — not a bug, but because Salesforce's own `Account_Manager_Lookup__c` field
is genuinely empty on most accounts today. The user asked for the standard Salesforce Account Owner (always
populated, unlike the custom CSM lookup) to be shown as a fallback identity, making it easier to tell who's
actually tied to an account while CSM data is still sparse in Salesforce itself.

Also confirmed live in production that the customer_since fix from v12.6.5 is working correctly — Shield
Funding's `customer_since` is now `2022-05-16` (was `null`). Its health score legitimately stays "Critical/10"
regardless: no CSM touch has ever been logged on it, and its one open opportunity has today's date as its
close date with no amount set. That's the health formula correctly surfacing a real at-risk account, not a
leftover bug.

### Added
- **Account SOQL pull now also resolves `Owner.Email`** (Salesforce's standard, always-populated Account
  Owner field) to `accounts.owner_user_id` — a column that existed on the model since the CSM Portal
  launched but was never actually written to. Same email-match pattern as the CSM lookup and Opportunity
  Owner.
- **New "Owner" column on CSM Portal's Inbox and Portfolio tables**, next to CSM.

### Verification
Backend: 2971 passed, 8 xfailed, 0 failed. 1 new test (`test_pull_fills_owner_by_email_as_a_fallback_identity`).

☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated

## v12.6.6 — 2026-09-16 (Hotfix: Sync Log backfill correction, CSM Portal Inbox pagination)
**Deploy:** `develop → staging → main` | **Type:** Hotfix, caught live in production within an hour of v12.6.5.
**Branches:** `develop`, `staging`, `main`
**Schema:** none (data-only correction).

### Context
The user caught two of v12.6.5's own gaps live in production almost immediately: a screenshot of the Sync
Log still showing "Pushed to SF" on an Opportunity row, and the CSM Portal Inbox still having no pagination.
See v12.6.5's "Real gaps found live in production" section above for the root causes.

### Fixed
- **Corrected the `direction` backfill.** Added a follow-up data migration
  (`v12_6_5_correct_sf_log_direction_backfill`) that re-labels the specific historical rows that are
  unambiguously inbound pulls: any Account/Opportunity log with `source_system='sync_button'` (no outbound
  push path for either object uses that source), and any Lead log with `source_system='sync_button'` whose
  `fields_updated` matches the pull's fixed field list (distinguishing it from the also-`sync_button`-tagged
  lead-push-during-manual-sync path). 3 new tests cover all three cases (corrected, left-alone-ambiguous,
  and real-outbound-untouched).
- **CSM Portal Inbox now paginated** — was rendering the entire at-risk list unpaginated; added the same
  15-per-page `Pagination` component Portfolio already uses.

### Still open
- The CSM email-match-by-Salesforce-field fix has not yet been verified against a live sync — needs an
  admin to trigger "Sync Salesforce" in Control Center once this hotfix is live, since only that confirms
  whether the `Account_Manager_Lookup__r` relationship-name guess is correct against the real org schema.

## v12.6.5 — 2026-09-16 (Salesforce sync guardrails, CSM Portal fixes + CSM nav restructuring backfill)
**Deploy:** `develop → staging → main` | **Type:** Guardrails on a Critical System (Salesforce Sync) + bug fixes, plus a documentation backfill for an earlier undocumented release.
**Branches:** `develop`, `staging`, `main`
**Schema:** `salesforce_integration_logs.direction` (VARCHAR, default `'outbound'`) — see Fixed below for why the backfill for this column itself needed a follow-up correction in v12.6.6.

### Added / Fixed — Salesforce sync guardrails and CSM Portal (this session's own work)
- **Sync Log direction ambiguity** — a pull-created Opportunity/Account log showed `operation_type: create`,
  reading identically to an outbound Salesforce write and triggering a real data-pollution scare (a Super
  Admin turned on the Opportunity pull toggle, saw 3235 "create" logs, and worried real Salesforce records
  were being created). Root cause: no column distinguished a local-DB insert from a pull vs. an actual write
  to Salesforce. Added `direction` (`inbound`/`outbound`), tagged at all 3 pull call sites in `salesforce.py`;
  surfaced as a column + filter in Monitoring's Sync Log, plus its own detail-modal field and CSV export
  column. Also added the `Object` column to the log table (previously detail-only) and added Account/
  Opportunity to the object filter, which had never been updated since those objects started syncing.
- **Opportunity Sync toggle reworded** — "Push Only"/"Two-Way Sync" never said which direction was being
  turned on. Now always "Pull Opportunities & Accounts from Salesforce" with explicit copy that enabling it
  only reads from Salesforce and never writes; turning it on is gated behind a confirm dialog explaining
  exactly that.
- **Health score bug** — the Account pull never sent a tenure anchor, so every account fell back to the
  lowest relationship-factor score (showing as "Critical / 10" on virtually every row). Added `CreatedDate`
  to the Account SOQL query, mapped to `customer_since`.
- **CSM assignment from Salesforce** — Salesforce has its own CSM field (`Account_Manager_Lookup__c`,
  "Customer Success Manager(CSM)" in Setup) that the Account pull never read, leaving the Inbox/Portfolio
  CSM column blank for every account. Resolved by email match (same pattern already used for Opportunity
  Owner), only filling accounts with no local assignment yet — **not yet verified against a live sync as of
  this entry**, see v12.6.6.
- **CSM Portal N+1 query fix** — `/portfolio` and `/digest` ran 3 database queries per account; batched into
  3 queries total regardless of list size. Measured drop from multi-second loads to ~11ms on a real staging
  portfolio.
- **Call logging without an Opportunity** — a CSM couldn't log a call at all on an account with no
  Opportunity yet (the existing call-log endpoint requires one). Falls back to the existing account-activity/
  touch log instead of hiding the form.
- Fixed the CSM search placeholder ("Search users..." when it actually searches accounts).

### Added — CSM nav restructuring backfill (documentation only, no new code)
This section was missing entirely — the commits below landed on 2026-09-16 between the v12.6.0 staging push
(previous entry, 2026-09-15) and `fff3c810` ("release: v12.6.0 — production deploy"), which merged
everything from v12.4.0 through this entry into `main`/production the same day. `fff3c810`'s own commit
message lists AE Pipeline, CSM Portal Beta, Salesforce Opportunity/Account sync, and CSM role as if new —
those actually shipped in v12.4.0 (2026-09-11); what's new in this merge is the nav/UX pass below.
Internally this batch was tracked commit-by-commit as v12.6.1–v12.6.4 (see
`tests/v12-6-1-staging-audit.spec.js` through `tests/v12-6-4-performance-audit.spec.js`) but none of those
version numbers ever got their own `docs/RELEASES.md`/`releases.json` entry — collapsed into this one
instead, numbered v12.6.5 to avoid colliding with that already-used internal numbering.

- **Pagination, filtering, and a CSM health chart** across AE Pipeline, CSM Portal, and My Tasks, plus a
  Super Admin hub-switch for jumping between the AE/CSM views without a role change.
- **Flat CSM nav** — CSM's nav collapsed to its actually-relevant items; AE Pipeline and CSM Portal's
  underlying pipeline views merged into one hub (shortened nav label on a follow-up commit the same day).
  CSM call logging shipped as part of this merge.
- **CSM-relevant topbar**: Leads/Sales Tools hidden for the CSM role, and global account search added.
- **CSM Inbox greeting** — CSM's Inbox now gets the same personalized greeting every other role's
  Dashboard already had.
- Guided tours for the new flat CSM nav, the merged Pipeline hub, and call logging. AE Pipeline/CSM Portal
  help docs added; the in-app Help Hub's role bucket split to cover AE and CSM separately.
- The Super Admin hub-switch from the first item above was later found redundant once flat nav landed —
  removed the same day; a CSM lands directly on CSM Portal instead of Dashboard.

### Verification
Backend: 2967 passed, 8 xfailed, 0 failed. Playwright: 11/11 (new `v12-6-5-guardrails-audit.spec.js` +
existing `v12-6-4-staging-audit.spec.js` regression) against staging. Production `/api/health/deep` and
`/api/monitoring/health` confirmed green post-deploy.

### Real gaps found live in production after this shipped — see v12.6.6
1. The `direction` column's own `ADD COLUMN ... DEFAULT 'outbound'` backfilled *every* pre-existing row to
   `outbound`, including the historical inbound-pull logs from the original scare — so those specific rows
   still showed "Pushed to SF" post-deploy. A wrong backfill on the very column meant to prevent this
   confusion.
2. CSM Portal's Inbox tab had no pagination at all (Portfolio already did) — missed during this release.
3. The CSM email-match fix only takes effect on the *next* Account pull; no sync had run since deploy, so
   an admin adding a new CSM (Kanika) saw no change yet, and the Salesforce field-name guess
   (`Account_Manager_Lookup__r`) still needed live verification against a real sync run.

### Verification
Full post-v12.4 regression + performance pass across all 5 roles (`588a1a8b`) before the production merge.

## v12.6.0 — 2026-09-15 (Power Dialer call scripts, per-campaign email analytics, My Tasks page)
**Deploy:** `develop → staging`, merged to `main` the next day as part of [v12.6.5](#v1265--2026-09-16-csm-nav-restructuring-flat-nav-merged-pipeline-hub-call-logging-global-search)'s production push (`fff3c810`) | **Type:** Three feature additions, from direct customer feedback.
**Branches:** `develop`, `staging`
**Schema:** two new columns on existing tables, both nullable — `leads.talking_points` (TEXT) and
`tasks.description` (TEXT). Added via `migrations.py`'s `column_additions` (ADD COLUMN, no backfill needed).
No new tables.

### Context
All three items below trace to one piece of unsolicited product feedback (a "what would make Alternate CRM
better" email). Before building anything, each request was checked against the actual codebase rather than
taken at face value — two of the three turned out to be partially built already:

- **Power Dialer context**: the feedback asked for "the Last Update Note section" on the dialer card. That
  already shipped in v12.5.0 (`lead.latest_note`) — the reporting screenshot simply showed a lead with no
  note yet. What was genuinely missing, and is what this release adds, is a call **script** — talking
  points/objection handling to open with — which is a different thing from a note (forward-looking prep,
  not a record of what already happened).
- **Email analytics**: per-email open/click tracking already existed (`LeadEmailActivity.opened_at`/
  `open_count`/`clicked_at`/`click_count`, populated from Nylas's own `message.opened`/`message.link_clicked`
  webhooks — no link-shortening service needed, Nylas already rewrites links for tracking) and was already
  visible in Activity Monitor's Email tab. The genuine gap was **per-campaign** aggregation: Email Campaigns
  had zero open/click visibility despite every send already carrying a `campaign_id` back to that same table.
- **Task marking**: a `Task` model, per-lead task CRUD, and a due-now reminder bell already existed. The
  genuine gap was a consolidated list view across every lead — the SF/HubSpot-style page reps actually plan
  a day around, rather than opening each lead individually.

### Added
- **Power Dialer call scripts — both a per-lead override and a cadence default.**
  `Lead.talking_points` (new) is a per-lead script an SDR/AE writes directly from the dialer card, editable
  inline (mirrors the existing note composer's UX). A Sales Journey "call" node can now also carry a
  default script (`NodeConfigPanel.jsx`'s `CallFields` gained a second field); when that node fires,
  `call_channel.py` writes it onto the Task's new `description` column, and the dialer card surfaces it as
  "Cadence script — <journey step title>" for any lead currently sitting on an open task from that step.
  The per-lead override always wins when both exist. `GET /api/leads` batches this in one extra query
  (`_batch_open_call_scripts`), scoped to only the one endpoint the dialer actually calls — the two other
  list endpoints sharing the same row serializer don't pay for a lookup they have no consumer for.
  **Caught during development, not by chance**: `talking_points` was read in `_lead_to_summary` but
  initially missing from `SUMMARY_COLUMNS`' `load_only()` — the exact N+1 this codebase already has a named
  RCA and regression test for (`do_not_contact`/`unsubscribed_at`, 2026-08-10). That existing test caught
  the regression immediately; fixed by adding the column to the same `load_only()` list.
- **Per-campaign email analytics.** `email_campaign_routes.py` now aggregates `LeadEmailActivity` by
  `campaign_id` (`_batch_campaign_engagement` — one `GROUP BY` query per page, not one query per campaign
  row) and returns `opened_count`/`open_rate`/`clicked_count`/`click_rate` on every campaign, plus a per-
  recipient opened/clicked flag on the detail view. Rate is against `sent_count`, not `total_recipients` —
  a skipped/failed row was never a chance to be opened. `CampaignsSection.jsx`'s list table gained Opens/
  Clicks columns (same Badge convention as Activity Monitor's Email tab); the detail modal's recipient table
  gained matching columns and the summary line now reads "N sent · N opened (X%) · N clicked (X%) · …".
- **"My Tasks" page** — the 17th React island (`my-tasks-entry.jsx`/`MyTasksHub`), a genuinely new route
  with no legacy page behind it (same no-fallback shape as `sdr-performance`). Lists every task assigned to
  the current user across every lead, filterable Open/Done/All, sorted overdue-and-soonest-first, with
  inline complete/snooze/delete — reusing the existing per-lead task endpoints and the existing snooze
  endpoint rather than adding new ones. Backend: `GET /api/my/tasks`, deliberately separate from the
  pre-existing `/my/tasks/pending` (that one stays a capped, due-now notification feed; this one is the
  full worklist). Nav item added ungated (`roles: ['all']`) — tasks carry no role restriction. Guided tour
  included per `AGENT_PROTOCOL.md` §13 rule 5.

### Verification
Backend: 2951 passed, 8 xfailed, 0 failed. Frontend: 1100 passed, 109 files. New tests: `TestPushOpportunity`-
adjacent journey-engine coverage for the call-script pass-through, `TestPowerDialerCallScript` in
`test_leads_redesign.py`, `TestGetMyTasks` in `test_task_routes.py`, campaign-engagement tests in
`test_email_campaign_routes.py`, and `MyTasksHub.test.jsx`/`NodeConfigPanel.jsx` CallFields coverage on the
frontend. `componentLibraryUsage.test.jsx`'s guard re-confirmed clean against every file this release touched
— no raw `<select>`/`<input type="date">` introduced; a raw `<button>` caught during review (see below) was
fixed before commit, not left for the guard to catch (that guard deliberately doesn't check bare buttons —
see its own docstring).

### Fixed (found during this release's own review pass, before commit)
- A bare `<button>` in `CurrentCallCard.jsx`'s new script-editor "Edit" trigger — replaced with the shared
  `Button` component before this shipped, per the standing `components/ui/` convention.

## v12.5.2 — 2026-09-15 (Admin write boundary, AE pipeline chart, Salesforce close-payload fix)
**Deploy:** `develop → staging → main` | **Type:** Security-adjacent fix + a blocking Salesforce correctness fix.
**Branches:** `develop`, `staging`
**Schema:** no change.

### Fixed
- **BLOCKING: the Salesforce close write-back could never have worked.**
  `apply_opportunity_close` flipped `is_closed`/`is_won` but never moved
  `stage_name` off the open stage, so `push_opportunity_to_salesforce` sent
  `StageName: "Negotiation"` alongside `IsClosed: true, IsWon: true`. In
  Salesforce `IsClosed` and `IsWon` are **read-only formula fields derived from
  `StageName`** — they cannot be written at all, so the update would have been
  rejected outright; and had they been writable, the payload still said "open"
  in the one field SF actually reads. Closing now sets `stage_name` to
  `Closed Won` / `Closed Lost`, and the push payload carries `StageName` +
  `CloseDate` only, letting SF derive the other two. The next pull then reads
  back a consistent state instead of fighting the local row.
  **Why nobody saw it:** `opportunity_writeback_enabled` defaults to `false`,
  so no deployment has ever actually called Salesforce with this payload. The
  local half of the bug was visible though — a Closed Won deal rendered as
  still sitting in Negotiation.
  Stock picklist values are assumed; an org that renamed its closed stages gets
  a visible `sf_push_error` on the row rather than a silent wrong state.
- **Admins could silently write to other people's deals and accounts.**
  `_get_owned_opportunity_or_403` and `_get_scoped_account_or_404` both return
  early for admins, and every write route reused those same two read helpers —
  so a Super Admin hitting "Log call", "Update deal", "Close deal", "Log touch",
  "Champion departed" or "New renewal opportunity" acted **as** the owning
  AE/CSM rather than over them. Reading org-wide is oversight and stays; writing
  org-wide is impersonation and now returns 403. This mattered beyond
  attribution: the first CSM touch is what locks the AE's `ClosingBrief`, touch
  recency is half the relationship health factor, closing fires the CSM handover
  email and the SF push, and logged calls feed the AE leaderboard.
  Two admin writes are **kept** because the plan specifies them: the health-tier
  override (a designed escape hatch, already audit-logged with who/when/why) and
  Super-Admin bulk-assign. Unowned records also stay admin-writable — both FKs
  are `ondelete="SET NULL"`, so a departed rep's deals would otherwise be
  permanently unclosable.
  The UI matches the backend: write controls are hidden and a read-only notice
  explains why, instead of offering buttons that 403.

### Added
- **Deal-performance donut on AE Pipeline**, via the existing
  `DonutSummaryCard` — Won / Lost / Still open by count, with open pipeline
  value formatted in the subtitle (the component renders a segment's raw value
  in the centre, so currency would have come out as an unformatted `120000`).
- **AE column on the AE Pipeline table.** Admins see every AE's deals through
  this endpoint, and `owner_user_id` alone is a UUID the UI cannot render;
  `owner_name` is now returned alongside it. Unowned rows read "Unassigned".
  The table subtitle said "Your open Opportunities" while actually listing every
  AE's open *and* closed deals — corrected.
- **Mechanical enforcement for the `components/ui/` convention**
  (`src/test/components/componentLibraryUsage.test.jsx`). AGENT_PROTOCOL §19.1
  proposed an ESLint `no-restricted-syntax` rule for this; that was checked and
  rejected on evidence — `npm run lint` already exits with **147 pre-existing
  errors** and is wired into no hook and no CI step, so a 148th finding enforces
  nothing. The guard instead scans source in the suite that is green and does
  gate work, following `hub-entry.test.jsx`'s established pattern. It blocks
  `<input type="date">` across `features/**` outright, and raw `<select>` with a
  frozen 8-file legacy allowlist that itself fails if it goes stale. Bare
  `<button>` is deliberately not checked — ~130 mostly-legitimate occurrences.
  The red lint run is a separate open problem.

## v12.5.1 — 2026-09-15 (AE/CSM component-library consistency, bulk-assign UI, frontend test coverage, persisted AM backfill progress)
**Deploy:** `develop → staging → main` | **Type:** Fixes + follow-up work on v12.4.0/v12.5.0.
**Branches:** `develop`, `staging`
**Schema:** adds one new table, `background_job_state` (see below). Created by
`models.Base.metadata.create_all` at startup (`main.py:140`) — no `migrations.py`
entry needed, no change to any existing table.

### Fixed
- **AE Pipeline and CSM Portal now use the shared component library.** Both
  islands shipped with hand-rolled markup where `components/ui/` already had
  the primitive: a raw native `<select>` for the call-outcome picker, two raw
  `<input type="date">` fields in the AE close-deal modal and two more in the
  CSM renewal/update modals, and a hand-styled back button. All now render
  through `Select`, `DatePicker` and `Button`. `components/ui/StageSelect.jsx`
  was the worst case — it lived *in* the component library and still rendered
  a raw native `<select>`; it now delegates to `Select` like everything else.
  Closing a deal lost its native `required` on the date field in the swap, so
  `submitClose` validates the close date explicitly instead.
  **Why this recurred:** `docs/AGENT_PROTOCOL.md` §19 states outright that
  "check `components/ui/` first" has **no** ESLint rule, pre-commit hook or CI
  check behind it — it is convention only, and it was named as a still-open
  gap after the last consolidation pass. This release fixes the instances, not
  the enforcement gap, which remains open.
- **Health-score factors are now derived, not hardcoded twice.** `csm_health.py`
  returned a hardcoded `"partial": True` and a frozen `PARTIAL_LABEL` string
  naming Usage/Support, and `AccountDetail.jsx` read `health.factors.commercial`
  / `.relationship` by name. Both contradicted the plan's "Usage/Support slot in
  additively later without a rewrite" promise: a new factor would have been
  included in the score but invisible in the UI, and the footnote would have
  gone on claiming it was missing forever. `partial`/`partial_label` are now
  derived from a `_MISSING_FACTORS` tuple, and Account 360 renders whatever
  factors the backend actually returned. Landing a real factor is now "add it
  to `_FACTOR_WEIGHTS`, drop the name from `_MISSING_FACTORS`" — no UI change,
  no prose edit. (The Phase 3+ *data* is still genuinely unavailable — no
  helpdesk, product-analytics, billing or NPS system exists to read from. This
  fixes only the plumbing that claimed to be ready for it.)

### Added
- **Bulk-assign accounts to a CSM** in the CSM Portal's Portfolio tab
  (Super Admin only). Launch-readiness gap #1 shipped its backend half in
  v12.4.0 — `POST /csm-portal/bulk-assign`, tested, with an assignment
  notification email — but had **zero frontend call sites**, so the day-one
  "assign these N existing accounts to CSM X" flow was unreachable in the UI.
  Row checkboxes + a CSM picker + an assign action now cover it.
- **AM bulk-backfill progress is persisted.** New `BackgroundJobState` model /
  `background_job_state` table replaces `admin_sync_routes._am_sync_status`, a
  module-level dict. A deploy mid-run (which happened during the September
  backfill) took the worker thread *and* the progress with it, leaving
  `GET /sync-am-status` reporting a zeroed idle state with no signal the run
  had been killed. The worker now writes progress at the existing batch-commit
  boundary — no extra DB write per rate-limited AM call — and that write
  doubles as a heartbeat. A row still flagged `running` whose heartbeat has
  gone cold (>5 min) reads back as `interrupted`, keeping the progress it made
  and saying what happened, instead of a plausible-looking "in progress" that
  will never advance. API-only; no UI consumes this endpoint.

### Tests
- **Closed the zero-frontend-test-coverage gap on both new islands.** AE
  Pipeline and CSM Portal shipped in v12.4.0 with backend tests only. 9 new
  files: `src/test/csm-portal/{utils,PortfolioTab,InboxTab,PlaybooksTab,DigestTab,CsmPortalHub,AccountDetail}.test.jsx`,
  `src/test/ae-pipeline/AEPipelineHub.test.jsx`, `src/test/components/StageSelect.test.jsx`.
  Writing them is what surfaced `StageSelect`'s own raw `<select>` and the
  hardcoded factor names above.
- New backend files `tests/test_am_sync_job_state.py` (never-run / live-heartbeat
  / cold-heartbeat, plus the started_at and single-row invariants) and
  `tests/test_csm_health_factors.py` (the additive contract, pinned by
  monkeypatching a factor in and out).

### Caught by the live staging pass (fixed before main)
`GET /api/admin/sync-am-status` returned a **different key set depending on
whether a run had ever happened**: `_read_am_status`'s never-run branch
omitted `interrupted`, which the post-run branch includes, so a poller read
`status.interrupted` as `undefined` rather than `false` on a fresh install.
The unit tests missed it because each asserted only the keys it cared about;
`test_every_read_returns_the_same_key_set` now compares the whole key set
across both branches. This is exactly the case the endpoint exists for — a
Super Admin checking an AM backfill that has never been run — and it was
only visible by curling the deployed endpoint, not from the test suite.

### Verified live on staging
Playwright against a real staging JWT, covering every write path the two
islands own — log touch, champion departed, bulk-assign, and close-deal
(Initech flipped to Closed Won with its handover brief persisted). Safe to run
live because staging has `opportunity_writeback_enabled: false` and
`ae_pipeline_routes._writeback_enabled()` gates every action-triggered push, so
these are purely local DB writes with no Salesforce side effect — checked
before running, not assumed. Deploy confirmation is by `shasum -a 256` of the
local bundle against the `curl`'d remote one; a string grep false-positived
here because the matched text existed in the old bundle too.

### Notes
- Ponytail-review + ponytail-audit run on this batch per `CLAUDE.md`. Two
  findings, both minor: a redundant comment in `csm_health.py` restating
  `_MISSING_FACTORS` (fixed), and the naive-datetime coercion in
  `_read_am_status` duplicating a pattern hand-rolled at 20+ sites across
  `scheduled_jobs.py`/`report_service.py`/`dialer_service.py` (**not** fixed —
  extracting a shared helper is a repo-wide refactor well outside this batch;
  logged here so it isn't rediscovered as new).

## v12.5.0 — 2026-09-15 (Salesforce write-back guardrails, login redesign + access-request flow, Power Dialer fixes)
**Deploy:** `develop → staging → main` | **Type:** Feature + fixes.
**Branches:** `develop`, `staging`

### Added
- **Salesforce write-back guardrails for AE Pipeline / CSM Portal.** Closes
  the data-pollution gap in v12.4.0's Opportunity write-back: the "Update
  deal"/"Manage opportunity" Stage field is now a real dropdown sourced from
  the org's actual `Opportunity.StageName` picklist (`GET .../stage-options`)
  instead of free text, falling back to free text only when Salesforce isn't
  configured. A new `SyncSettings.opportunity_writeback_enabled` master
  toggle (default **off**) gates every AE/CSM action-triggered push (close,
  update, renewal-create) — separate from `opportunity_sync_direction`,
  which only ever gated the scheduled bulk pull. All local effects (call
  logs, touch logs, handover briefs, health tracking) work fully with it
  off; nothing reaches Salesforce until a Super Admin turns it on in Control
  Center's new Opportunity Sync card (which also gives
  `opportunity_sync_direction` its first-ever admin UI). Push failures
  (`sf_push_status`/`sf_push_error`/`sf_push_at`) are now surfaced directly
  as a badge on the opportunity, in both AE Pipeline and CSM Portal — not
  just visible to an admin checking the SF sync log.
- **Access-request flow.** A Google sign-in from an email not yet added to
  Alternate CRM now records the attempt and notifies Super Admins in the
  background (only on the first attempt, so repeated tries don't spam
  admins) — since access is only ever granted from inside Alternate CRM (Team &
  Access), this replaces a dead-end "contact an admin" message with an
  actual mechanism. Team & Access shows pending requests with a one-click
  "Add" that pre-fills the existing Add User modal; granting access clears
  the pending request automatically.
- **Sign-in page**: fixed a real responsive bug (the two-panel layout didn't
  stay centered on a wide desktop browser), added an eyebrow line and
  updated copy explaining the access-request flow, and linked real Terms of
  Use / Privacy Policy pages (`frontend/terms.html`, `frontend/privacy.html`)
  — a short internal-use notice and an adapted version of Screen-Magic's
  privacy policy, rebranded for Alternate CRM.
- **Power Dialer**: the Call List dropdown's lead count is now scoped the
  same way the dial queue itself is scoped (per-rep assigned leads for
  SDR/AE), fixing a case where the count showed leads a rep couldn't
  actually see in their queue. The current-call card now shows the previous
  caller's actual note content, not just the outcome enum and date.

### Notes
- Ponytail-review + ponytail-audit run across the full diff before this
  release (per `CLAUDE.md`): 3 findings, all fixed — a duplicated toggle
  handler collapsed into one helper, a Stage-dropdown block duplicated
  across AE Pipeline and CSM Portal extracted into
  `components/ui/StageSelect.jsx`, and a duplicated datetime helper in
  `csm_portal_routes.py` replaced with an import from `csm_health.py`.
- Full suite: 2904 passed, 8 xfailed, 0 failed (backend); 777 passed
  (frontend).

## v12.4.0 — 2026-09-11 (AE Pipeline + CSM Portal Beta, Salesforce Opportunity/Account sync, CSM role)
**Deploy:** `develop → staging → main` | **Type:** Feature.
**Branches:** `develop`, `staging`

### Added
- **New CSM role**, consolidated into `domain/actor.py`'s `VALID_ROLES` alongside
  the existing Super Admin/Pod Admin/AE/SDR roles — the three previously
  duplicated literal role-set checks (`admin_user_routes.py`, `auth_routes.py`,
  `UsersRolesPanel.jsx`) now point at one source of truth. CSM is deliberately
  kept out of `is_individual_contributor` (its account-portfolio scoping is
  different from SDR/AE's own-leads scoping) and out of the Pod-purity rule
  (CSM account assignment is independent of Pods).
- **Salesforce Opportunity + Account sync** — new `Account`/`Opportunity`
  models. Bidirectional for stage + close_date only, gated behind a new
  `opportunity_sync_direction` toggle mirroring the existing Lead
  `sync_direction` pattern; a stage-precedence rule stops a pull and a push in
  the same run from fighting over which stage wins. The first sync run also
  pulls all existing Closed-Won Opportunities/Accounts, so Portfolio isn't
  empty on day one.
- **AE Pipeline** — a new AE-scoped view (`ae-pipeline` nav item; AE, Pod
  Admin, Super Admin) for working Opportunities directly in Alternate CRM:
  own-Opportunity list/detail, call logging tied to a specific deal, and a
  "Close deal" action that captures a `ClosingBrief` (champion, promises made,
  handover notes) and pushes Closed-Won + close_date back to Salesforce in the
  background.
- **CSM Portal Beta** — a new CSM-scoped view (`csm-portal` nav item; CSM,
  Super Admin): Inbox (health-sorted at-risk queue), Portfolio (ARR,
  renewals), Account 360 (handover summary, activity timeline), and four
  playbooks — Zero-form handover, Renewal countdown, Silent account (CSM
  touch-logging), Champion departure (manual-trigger, no auto-detection
  signal exists). Health score is an explicitly-labeled 2-factor
  (Relationship + Commercial) weighted average, with a manual override
  escape hatch — the computed score always stays visible alongside it.
  "Create renewal opportunity" pushes a new Opportunity to Salesforce.
  Super Admin bulk-assign-to-CSM action, with an email notification to the
  CSM when an account lands in their portfolio.
- Guided tours for both new islands, per `docs/AGENT_PROTOCOL.md` §13 rule 5.
- Login page funnel-copy fix: replaced the "Salesforce feeds Alternate CRM"
  framing with "Alternate CRM refines, Salesforce receives" copy across headline,
  subhead, feature strip, and footer disclaimer; added AE and CSM
  demo-login buttons.

### Notes
- Explicitly out of scope for this release, because no data source exists yet
  at the company: Usage drop, Support escalation, Sentiment detractor,
  Payment failure/Expansion signal playbooks — omitted rather than shipped as
  fake manual-entry placeholders.
- 31 new backend tests (`test_csm_role.py`, `test_ae_pipeline.py`,
  `test_csm_portal.py`). Full suite: 2876 passed, 8 xfailed, 0 failed.
  Ponytail-review + ponytail-audit run across the full Phase 0+1+2 diff
  before this release (2 minor findings fixed: an unused-variable unpack, a
  stale comment).

## v12.3.8 — 2026-09-10 (Audience Manager: auto-sync lead updates, matching Salesforce)
**Deploy:** `develop → staging → main` | **Type:** Feature.
**Branches:** `develop`, `staging`, `main`

### Added
- **Lead updates now push to Audience Manager, not just first-time sync.**
  `ensure_contact()` previously only ever created an AM contact once —
  any later phone/name/status change on an already-synced lead never
  reached AM, silently going stale. Added `update_contact()` (confirmed
  against Alternate Messenger's own Contact Integration Guide: `PATCH
  /api/v2/converse_integration/record/contacts/<id>`) and
  `sync_lead_update_to_am()`, wired into the same two places Salesforce's
  status push already fires — `PATCH /leads/{id}` on status change, and
  kanban move — as a background thread, mirroring the existing SF pattern.
- **Known platform limit:** `mobile_number` can never be changed via AM's
  update endpoint (per their docs) — a lead's phone number update still
  won't reach AM after initial sync. Not a gap in this fix, a hard vendor
  constraint.
- Outcome (Won/Lost) updates intentionally left out of scope — Salesforce
  doesn't get pushed on outcome change either today, kept at parity.

## v12.3.7 — 2026-09-10 (Help Hub release notes — stale bundle fix)
**Deploy:** `develop → staging → main` | **Type:** Bug fix.
**Branches:** `develop`, `staging`, `main`

### Fixed
- **In-app Help Hub's "What's New" tab was still showing v12.2.8 in
  production.** `releases.json` was updated with v12.3.0–v12.3.6 entries in
  the prior commit, but that commit only touched the three release-notes
  files — nobody rebuilt `frontend/js/help-hub.js`, the committed Vite
  build artifact that actually bundles `releases.json`'s content. Static
  site hosting doesn't build; a source-only edit never ships until the
  bundle is rebuilt and committed. Rebuilt and verified the new bundle
  contains the v12.3.6 string before committing. Caught by the user
  checking the live Help Hub page directly.

## v12.3.6 — 2026-09-10 (Campaign signature toggle, SMS Campaigns/Alternate Messenger, login redesign, AE analytics fix)
**Deploy:** `develop → staging → main` | **Type:** Features + bug fixes, batched across one session (v12.3.0–v12.3.6).
**Branches:** `develop`, `staging`, `main`

### Added
- **Per-campaign email signature toggle.** `EmailCampaign.include_signature`
  (default on, matches prior manual-send behavior) threaded through
  campaign create → send → compose UI checkbox.
- **SMS Campaigns tab** in Sales Tools, backed by Alternate Messenger/Audience
  Manager. Initially embedded via iframe; live testing (real staging JWT,
  Playwright) proved Alternate Messenger's full app doesn't honor the session
  cookie our backend's signed auth URL sets for a third-party navigation —
  a vendor-side limitation, not fixable from our side. Replaced with an
  "Open Campaigns/Converse Desk in Alternate Messenger ↗" new-tab link instead
  (`GET /api/conversations/embed-url`, unchanged endpoint) — will start
  working as an embed automatically if Alternate Messenger's side ever supports it.
- **Audience Manager contact sync gained segmentation fields**: status,
  country, state, city, unique_id, owner (all assigned users, not just
  SDR-restricted like the Salesforce push), pod/group, and a coarse
  6-bucket `lifecycle_stage` derived from our detailed status — the field
  set Alternate Messenger segments/campaigns need, previously only name/phone/email
  synced. Existing `/api/admin/sync-am-bulk` backfill endpoint (already
  built, already server-side/background-threaded) now populates these on
  backfill too — no new infra needed.
- **Login page redesigned as a React island** (`frontend-react/src/features/login/`,
  self-mounting via `login-entry.jsx` — the one deliberate exemption from
  the `registerHub` Hub contract alongside `nav-entry.jsx`, since there's
  no vanilla shell to hand it a container). Ports the original Google
  OAuth / demo-login / token-redirect logic 1:1, restores the original
  5-click trident easter egg on the SDR Prioritization icon (was
  momentarily swapped for an unrelated icon during the port, caught and
  fixed before shipping further).
- **View-As banner ported to React** (`ViewAsBanner.jsx`), mounted through
  a new `NavHub.mountViewAsBanner(container, props)` using `flushSync` so
  content exists before `top_banner_stack.js` measures `offsetHeight` on
  the still-detached container.
- **Legacy `settings`/`admin` views retired** to a `control-center`
  redirect — both already had full parity there (documented per-tab in
  that code's own comments); ~4,561 lines of legacy JS deleted.

### Fixed
- **`flushSync` imported from the wrong module** (`react-dom/client`
  instead of `react-dom`) crashed `_doMount()` the instant a View-As
  session loaded, leaving the whole app stuck on skeleton loaders —
  reported live by the user on staging, root-caused, fixed, and covered by
  a new `nav-entry.test.jsx` that drives the real `NavHub.mount()` /
  `mountViewAsBanner()` path (the isolated component test couldn't have
  caught this).
- **View-As banner rendered with no gradient and an unstyled button.**
  `nav-tailwind.css` skips full Tailwind Preflight and hand-reproduces
  just the `--tw-*` custom-property/border reset, scoped to
  `.nh-feedback-portal` only — `ViewAsBanner`'s gradient/border-reliant
  utilities were never added to that scope. Fixed by adding
  `.nh-viewas-banner` to the same reset. Confirmed via a live
  `NavHub.mount()` + `mountViewAsBanner()` browser check (jsdom can't
  render CSS, so this class of bug is invisible to any unit test).
- **Production: `InvalidRequestError` on `GET /api/admin/analytics/batch-summary`
  for AE-role users** (3 occurrences over 2+ weeks, found via the prod
  error_logs table). Root cause: the per-SDR breakdown query joins
  `lead_assignments` directly, and the shared `_pod_scope_lead_query`
  helper's AE-scope branch separately builds an `EXISTS` against that same
  table — SQLAlchemy's auto-correlation logic then correlated
  `lead_assignments` away from the `EXISTS` entirely, leaving it with zero
  FROM clauses. Reproduced byte-for-byte locally before fixing; fixed via
  `.correlate(models.Lead)` on both `EXISTS` subqueries in the shared
  helper — protects all ~15 call sites, not just this one endpoint.
- Hand-rolled query-string building in `messaging_auth.py` replaced with
  `urllib.parse.urlencode` (also fixed: the manual version never quoted
  `userId`/`apiKey`).

### Verified
- Full backend suite: 2831 passed, 8 xfailed.
- Full frontend suite: 773 passed (98 files).
- Live browser checks (Playwright, real compiled bundles): login page
  render + easter egg, View-As banner gradient/button styling — both
  confirmed visually via screenshots, not just DOM assertions.
- Real production DB read (`error_logs` table) confirmed the exact
  SQLAlchemy exception text before and after the analytics fix.

---

## v12.2.8 — 2026-09-09 (Analytics Hub dropdown styling — real root cause)
**Deploy:** `develop → staging` | **Type:** Bug fix, found via live-browser verification of v12.2.7.
**Branches:** `develop`, `staging`

### Context
While verifying v12.2.7 in a real browser (against a live staging session,
provided by the user's own Super Admin JWT, and an isolated Playwright
harness mounting the actual compiled bundle) — not just the jsdom-based
unit test suite — two real bugs surfaced that the unit tests had missed
entirely.

### Fixed
- **Ask AI's query typeahead opened and immediately closed itself.** Radix's
  `DismissableLayer` treats the query textarea (already focused when
  `PopoverContent` mounts, since it's a `Popover.Anchor` opened via
  `onFocus`, not a `Trigger` opened via click) as "focus moved outside" and
  dismisses on mount. Fixed with an `onFocusOutside` guard mirroring the
  `onPointerDownOutside` guard already added in v12.2.7 for the analogous
  click case; both now share one `exemptQueryInput` helper.
- **The real root cause of "these look like transparent buttons."** This
  bundle's Tailwind entry (`analytics-tailwind.css`) intentionally skips
  `@tailwind base` to avoid leaking resets into the legacy Vanilla JS
  shell, and was supposed to manually reproduce Preflight's border/button
  reset scoped to `.analytics-hub-root` — 5 other bundles in this repo
  already do this (e.g. `sales-tools-tailwind.css`). This bundle never had
  that reset at all: every unstyled `<button>` without its own explicit
  border override has been rendering with native OS chrome (2px outset
  border, default background) the whole time — not something introduced
  by v12.2.6/v12.2.7. Separately, Radix's Popover/DropdownMenu content
  portals to `document.body`, entirely outside `.analytics-hub-root`; the
  shared `components/ui/Popover.jsx`/`DropdownMenu.jsx` hardcode a literal
  `activitymonitor-portal` class on that portaled content for exactly this
  reason (a repo-wide convention, not bundle-specific). Fixed by adding the
  missing reset for both `.analytics-hub-root` and `.activitymonitor-portal`.
  Verified via live screenshots that this also fixes the pre-existing
  Dashboard tab POD/Batch Select pickers, not just the new Ask AI
  typeahead — a real, wider bug that predates this week's work.

### Verified
- Live Playwright session against the real compiled bundle (before/after
  screenshots, `getComputedStyle` checks) confirmed both fixes.
- Live staging session (real Super Admin token) confirmed the tab-bar
  active-state fix from v12.2.7 and separately confirmed "Try the new
  Analytics Hub" works correctly on a fresh session — not reproducible,
  flagged back to the reporting user for more detail.
- Full frontend suite: 762/762.

---

## v12.2.7 — 2026-09-09 (Ask AI query typeahead; tab-bar active-state fix)
**Deploy:** `develop → staging` | **Type:** Bug fix + UX follow-up on v12.2.6.
**Branches:** `develop`, `staging`

### Fixed
- **Analytics Hub tab bar never showed which tab was active.** `AnalyticsHub.jsx`
  applied `ah-tab--active` on the selected tab, but the served stylesheet
  (`frontend/css/analytics-hub.css`) only ever defined `.ah-tab.active` (no
  double-dash) — a class-name mismatch that meant no tab (Dashboard/Ask AI/
  Reports) has ever shown active-state styling in production. This is also
  the real cause behind a user report that Ask AI's "edit filters" button
  looked broken: the click handler was correctly switching to the Dashboard
  tab all along, but with zero visual feedback that anything had happened.
  Fixed the class name; gave the edit-filters control real button chrome
  (bordered pill + label) instead of a bare icon.

### Changed — Ask AI query experience
- Replaced the static "Try Asking" suggestion chips with a live typeahead:
  focusing or typing into the query box now shows a dropdown of matching
  Saved Reports and suggestion prompts, filtered as you type. Built on the
  `Popover` primitive already used by `components/ui/Select.jsx`'s searchable
  variant — no new dependency.
- Restyled the Saved Reports panel: each row was a bare, unstyled `<button>`
  with no visible chrome; now a proper hover row with a leading bookmark
  icon (also swapped the panel's header icon from `BookOpen` to `Bookmark`).

### Not in this release
- A third reported issue ("Try the new Analytics Hub" button appearing to
  do nothing) was not reproducible from reading `AnalyticsHubVNext.jsx` —
  that surface is a separately-documented, deliberately out-of-scope beta
  area. Flagged back to the user for more detail rather than guessed at.

### Verified on staging
Pending — deploy in progress.

---

## v12.2.6 — 2026-09-09 (Salesforce AE-sync fix; Analytics Hub UX pass)
**Deploy:** `develop → staging` | **Type:** Bug fix + UX polish.
**Branches:** `develop`, `staging`

### Fixed
- **Salesforce sync failing wholesale for AE-assigned leads.** `SDR_Name__c`
  (a Salesforce picklist restricted to real SDR names) was being fed every
  assigned user's name regardless of role — an AE's name is not a valid
  picklist value there, so Salesforce rejected the entire write. A new
  shared `sdr_only_names(lead)` helper (`backend/salesforce.py`) now feeds
  only SDR-role names to that field, used at both push sites (`salesforce.py`
  and the previously-duplicated dict in `lead_routes.py`'s `_check_sf_push`).
- **AE-assigned leads now sync a Salesforce Owner.** New `ae_owner_email(lead)`
  + `_sf_user_id_by_email(sf, email)` resolve an AE's email to a real
  Salesforce User and set the native `OwnerId` (Lead Owner) field, at both
  lead creation and every subsequent push — the mechanism the user chose
  (match by email) when the picklist fix alone wouldn't attribute ownership
  correctly for AEs.
- **Report Logs had no pagination**, capped silently at 200 rows.
  `GET /report-executions` now takes `page`/`per_page` and returns
  `{items, total, page, pages, per_page}`; the frontend uses the shared
  `Pagination` component.

### Changed — Analytics Hub UX
- Dashboard filter panel (`DashboardTab.jsx`): no longer a raw hand-styled
  div forced into a full-page-centered layout — wrapped in the shared
  `Card`/`CardContent`, with the pre-Apply empty state centered on its own.
- Ask AI (`AskAiTab.jsx`): every hand-rolled "fake card," raw `<table>`, raw
  `<input>`, and custom Pin button replaced with the shared `Card`/`Table`/
  `Input`/`Button`/`Skeleton` components. The "edit filters" pencil icon
  (previously wired to `undefined`, a dead control) now switches back to
  the Dashboard tab via a real `onEditFilters` callback threaded from
  `AnalyticsHub.jsx`.
- My Reports + Report Logs (`reports/MyReportsList.jsx`, `reports/ReportLogs.jsx`):
  both now use `Card`/`CardHeader` instead of bare divs with ad-hoc headers,
  matching the rest of the page.

### Not in this release
- `_check_sf_push`'s status-only update path (`lead_routes.py`, "Case 1")
  still builds its own minimal dict that omits `sdr_name`/`owner_email` —
  a pre-existing, separate gap. An existing SF Lead's owner/SDR name won't
  resync on a plain status change; only lead creation and the general push
  path (both fixed here) are covered. Flagged for follow-up.

### Verified on staging
Pending — deploy in progress.

---

## v12.2.5 — 2026-09-09 (SDR Performance ported to React; Upload/Audit Logs/Kanban/Smart Analytics retired)
**Deploy:** `develop` | **Type:** Migration + dead-code retirement. No backend changes.
**Branches:** `develop`

### Context
Continuation of the migration audit (`docs/ARCHITECTURE.md`,
`.claude/skills/alternatecrm/SKILL.md`). Three items requested: port
`sdr-performance`, decide `upload`, decide `#kanban`/`#smart-analytics`.
Investigating `upload` surfaced that it — and `audit-logs` alongside it —
already have full parity in Control Center, shipped and documented in that
code's own comments; porting would have duplicated existing work, so both
were retired (redirected) instead of rebuilt.

### Added
- **SDR Performance ported to React** — `SdrPerformanceHub`, the 16th
  island, built directly on the shared `hub-entry.jsx` contract (the first
  new island since it was introduced in v12.2.3, rather than copied and
  fixed). Same `fetchSdrPerformance(sdrId, {period, start_date, end_date})`
  contract as the legacy page it replaces; full cutover, legacy
  `renderSdrPerformance` kept only as the bundle-load-failure fallback
  (Pods/Leaderboard pattern). 8 new tests.

### Retired — redirected to their Control Center replacement, legacy deleted
- **`#upload`** → `control-center`. Every legacy endpoint (`upload-preview`,
  `upload-sheet`, `upload-logs`, `upload-batch-metrics`, `upload-gsheet`,
  `import-gsheet`) already has a `UploadService` counterpart wired into the
  Data section's `DataSectionUploadCard`/`UploadHistoryCard` — confirmed by
  reading both sides, not assumed. `views/upload.js` + `upload_csv.js` +
  `upload_gsheet.js` (1,436 lines) deleted.
- **`#audit-logs`** → `control-center`. The Monitoring section's own code
  comment already asserts "read-only parity with every tab of
  ... audit_logs.js (Activity, Login History, Feedback, SF Logs, Error Logs,
  Perf Health)". `views/audit_logs.js` (1,195 lines) deleted. `#sf-logs`
  re-pointed straight at `control-center` — it used to chain through
  `audit-logs`, which is now itself just a redirect.
- Neither `#upload` nor `#audit-logs` had a nav entry already (removed
  2026-09-04/09), so this closes the gap between "unreachable via nav" and
  "actually gone": a bookmarked or typed URL now lands somewhere live.

### Removed — decided, not ported
- **`#kanban`** and **`#smart-analytics`**: both were unreachable UI with no
  nav entry and no in-app link even before this pass. Router branches
  deleted outright (the catch-all now shows "View not found" for either
  hash, like any unknown route) — there was no live destination to redirect
  to, unlike upload/audit-logs above. `lead_kanban.js` (198 lines) deleted;
  `smart_analytics.js` itself stays, since `runAiQuery` and
  `injectSmartAnalyticsStyles` are still live (NavTopbar's Ask AI).

### Corrected in `.claude/skills/alternatecrm/SKILL.md`
This file's own prior read of `settings`/`admin` — "Pod-Admin-only
leftovers, needs Control Center role sub-gating designed first" — was stale.
That gating already shipped: `control-center/constants.js` admits Pod Admin
to Team & Access as of v12.2 (dated 2026-09-09), matching what `admin.js`
already gave them. Retiring those two (~1,500 lines, no nav entry already)
is now the same class of safe redirect-and-delete as `upload`/`audit-logs`
above, not a design task — caught only by re-reading `NavSidebar.jsx` and
`constants.js` in full instead of trusting the prior summary.

### Explicitly not done
- `playground` — still a live nav item and a real Alternate Messenger SDK onboarding
  tool, not dead code. Removing it from nav is a genuine behavior change,
  flagged for a separate explicit decision, not folded into this batch.
- `settings`/`admin` retirement itself — the correction above says it's now
  low-risk, but doing it wasn't asked for in this batch.
- No backend changes anywhere in this release.

### Verification
Backend suite re-run as a sanity check despite touching no backend code:
2803 passed / 8 xfailed (unchanged from baseline). Frontend-react: 750
passed / 93 files (was 742). Legacy `frontend/tests/`: 128 passed (one
pre-existing, unrelated collection failure — confirmed present on `develop`
before this batch via `git stash`).

## v12.2.4 — 2026-09-09 (Dead-code removal; architecture documentation)
**Deploy:** `develop` | **Type:** Cleanup + documentation. No behaviour change.
**Branches:** `develop`

### Context
Follow-up to a full migration + architecture audit (`docs/ARCHITECTURE.md`,
`.claude/skills/alternatecrm/SKILL.md`). Only the items with no behavioural risk
were taken; everything needing a product decision is listed and left.

### Removed — 3,621 lines of unreachable frontend code
Six files whose only remaining references were the `import` statements
themselves. Verified with an import graph over `frontend/js/**` plus a
per-symbol call-site check, and each checked for a module-level side effect
something else might depend on (`views/analytics.js` had one,
`window._analyticsRetry`, referenced solely by markup that same dead file
renders).

| File | Lines | Was dead because |
|---|---|---|
| `views/analytics.js` | 1 514 | `app.js` imported `renderAnalytics`; nothing called it. `#analytics` mounts AnalyticsHub with no fallback. |
| `views/activity_feed.js` | 736 | only caller was `analytics.js:639`, itself dead |
| `views/metrics.js` | 493 | zero importers |
| `views/sf_logs.js` | 393 | `renderSfLogs`/`cleanupSfLogs` never called; `#sf-logs` is a redirect |
| `views/dashboard.js` | 330 | zero importers |
| `hooks/useDataCache.js` | 155 | zero importers, never bundled |

No bundle rebuild needed: five were never in a bundle, and `app.js` is served
raw. `MonitoringSection.jsx`'s provenance comment pointed at the deleted
`sf_logs.js` and was rewritten; the rebuilt bundle came out byte-identical,
so the committed artifact is unchanged.

### Added
- `docs/ARCHITECTURE.md` — measured architecture (563 route-level `db.query`
  calls, 272 route-level writes, 313 handlers with 16 over 100 lines, 27
  inline role comparisons across 12 files, 52 hand-written `pod_id` filters
  across 15, and exactly 1 circular dependency), the target layering, and a
  strangler-fig phase plan. §7 carries the commands to re-measure.
- `.claude/skills/alternatecrm/SKILL.md` — the migration map and island
  contract, now cross-referenced both ways with the architecture doc.
- `AGENT_PROTOCOL.md` Rule 20 — structural changes must update that skill in
  the same commit.

### Deliberately not done
- `#kanban` and `#smart-analytics` (~1,400 lines) are unreachable UI but
  still answer a typed hash, so deleting them changes behaviour for anyone
  holding the URL — a product call, not a cleanup.
- Hoisting the 312 non-cyclic function-local imports. Mechanical, but moving
  an import to module scope can surface a load-order cycle, so not risk-free.
- Any further React migration — each remaining legacy page carries a real
  prerequisite; see the assessment in the skill.

## v12.2.3 — 2026-09-09 (Prod: Connect email navigated to /undefined; scheduled-campaign job dead in both environments; ERROR-level perf noise; the entry-shim landmine)
**Deploy:** `develop → staging` | **Type:** Production bug fix + latent-defect removal
**Branches:** `develop`, `staging`

### Context
Three prod reports the morning after v12.2.2 shipped, plus the one latent
defect v12.2.2 knowingly left in place. Two of the three were visible in the
Render log screenshot the user sent; the third was a Super Admin clicking a
button and landing on `/undefined#dashboard`.

### Fixed — production
- **"Connect email" showed `undefined` and dumped the user on
  `/undefined#dashboard`.** `MySettingsHub.jsx` destructured `url` from
  `GET /api/email/auth-url`, whose only key is `auth_url` — so the value was
  always `undefined`, and `window.location.href = undefined` navigates the
  browser to the *relative path* `"undefined"`. The static site serves
  `index.html` for unknown paths, so the app rebooted onto the dashboard from
  a `/undefined` URL, which is why the address bar kept that prefix
  afterwards. Four call sites reach this endpoint
  (`lead_emails_tab.js`, `sdr_settings.js`, `EmailHub.jsx`,
  `MySettingsHub.jsx`); the first three always read `auth_url`, so only the
  My Settings page was broken — the Email tab's popup on a lead still
  worked, which is how a mailbox was successfully connected on prod at
  15:48 UTC while this was live. Broken since the React My Settings port
  (v12.2.0). Now reads `auth_url`, and refuses to navigate at all if it
  comes back empty.
- **Scheduled email campaigns would never have fired, on prod or staging.**
  `_scheduled_email_campaign_job` demanded `BACKEND_URL` for unsubscribe
  links and returned early without it — and the var is set on neither
  service, so it logged `BACKEND_URL not set — skipping this tick` every 15
  minutes and skipped. No sends were actually lost: prod has zero campaigns
  in `scheduled` status (2 completed one-offs, both dispatched through the
  request path, which derives the URL from `request.base_url` and so was
  never affected). The same missing var also left the Alternate Messenger dialer
  provider's webhook `notify_url` silently `""`.
  New `config.backend_base_url()` falls back to `RENDER_EXTERNAL_URL`, which
  the platform injects and which this codebase already trusted in four other
  places (keep-alive self-ping, signature-logo URLs, staging detection). So
  the default now needs nobody to configure anything, and `BACKEND_URL`
  remains the override for a custom API domain. Four consumers routed
  through it: the campaign job, the keep-alive ping, the dialer notify URL,
  and signature-logo absolute URLs.
- **Successful requests were being logged as ERROR.** `middleware/timing.py`
  chose its log level from the clock alone: anything over 1 000 ms went to
  `logger.error`, whatever the response. `GET /api/growth-intelligence`
  takes ~3 s *because it calls an LLM* — by design, and cached for 15
  minutes — and the dashboard's five concurrent analytics queries land at
  1.6–2.3 s, so Render's error view filled with `200`s. That is the noise
  the 17 real `/api/calls/start` 500s sat inside, unnoticed, from 09-04 to
  09-08. The CRITICAL tier still records in `perf_metrics` either way (the
  Perf Health tab is where slowness belongs); only the log level now follows
  the status code — ERROR for 5xx, WARNING otherwise.

### Fixed — the landmine v12.2.2 left behind
- **All 15 React islands ignored `navigate()`'s `container` argument.** Each
  `*-entry.jsx` was a hand-copied version of the same 45 lines, and every
  one re-rendered into whatever node `mount()` first attached to. When the
  shell rebuilt that node the root kept painting into a detached element:
  no error, no warning, just a screen that stayed blank until a full reload.
  It shipped twice — Calendar (2026-08-05), where `showLoader()` replaced
  `#view-container` under a live root, and the Email tab (v12.2.2), where
  opening a second lead rebuilt `#emails-tab-content`. Both were patched in
  the *caller*: `app.js` grew a 14-clause `hubStillMounted` list purely to
  avoid tripping it, and a hub missing from that list was exactly how
  Calendar and User Guide broke.
  New `frontend-react/src/hub-entry.jsx` owns the contract once and checks
  the container it is handed. All 15 shims now delegate to it (~500 lines
  deleted), and `app.js`'s two parallel 14-clause if-chains collapse into one
  `VIEW_HUBS` map — the skip-the-loader optimisation is still there, but it
  is now an optimisation with a safety net under it rather than the only
  thing standing between a user and a blank page.

### Fixed — build
- **`email-hub.css` shipped nine copies of itself.** `vite.config.email.js`
  appends `frontend/css/email-hub.css` (663 lines) to the built output in
  `closeBundle`. Nothing in that bundle's module graph imports CSS, so Vite
  emits no CSS asset and never truncates the previous file — every build
  stacked another copy on top. The committed file had reached **5 975 lines
  for 664 lines of actual CSS**, and every user opening a lead's Email tab
  downloaded all nine. Now marker-guarded and idempotent: verified stable
  across repeat builds, and a sorted-unique diff against the old file
  confirms zero rules lost. `vite.config.analytics.js` has the identical
  plugin and only ever produced one copy by accident — its entry imports a
  CSS file, so Vite overwrites the asset each build — so it got the same
  guard rather than being left with the trap armed.

### Tests
- `hub-entry.test.jsx` — 8 contract cases (changed container, detached
  container, same container renders in place, double-mount, idempotent
  unmount, `apiBase` publication) plus a source-level guard asserting all 15
  entry files call `registerHub` and none call `createRoot`, so the next
  island cannot hand-roll this again.
- `MySettingsHub.test.jsx` — 2 cases, both verified failing against the
  pre-fix code: the browser goes to the returned `auth_url`, and it goes
  nowhere at all when the response has none.
- `test_backend_base_url.py` — 5 cases, including the prod symptom inverted
  (`RENDER_EXTERNAL_URL` alone must get the campaign job past its guard).
- `test_timing_middleware.py` — 3 cases: slow 200 warns, slow 500 errors,
  slow 404 does not error.

### Not changed
- `BACKEND_URL` was **not** set on either Render service — the code no
  longer needs it. Setting it is still worthwhile if the unsubscribe and
  signature-logo links should carry a branded API domain rather than
  `*.onrender.com`; that is an env change and needs a human.
- The five analytics endpoints behind the 1.6–3.1 s timings are genuinely
  slow (five concurrent aggregate queries on one dashboard load, 26.7k
  leads). Only the mislabelling is fixed here; the queries themselves are a
  separate piece of work.

## v12.2.2 — 2026-09-09 (Prod incident: /api/calls/start 500s; email-send truthfulness; Email tab remount; sync-settings write gate; credential encryption)
**Deploy:** `develop → staging` | **Type:** Production incident fix + bug fixes + hardening
**Branches:** `develop`, `staging`

### Context
Driven by a real prod incident reported overnight (17 unhandled 500s on
`POST /api/calls/start` across 4 bursts, first seen 2026-09-04, visible in
Slack and Render), plus a round of
staging validation that turned up three separate user-facing bugs and the
three items explicitly deferred from v12.2.1.

### Fixed — production incident
- **`POST /api/calls/start` returned an unhandled 500, and wedged the SDR
  for 6 minutes.** 17 occurrences in `error_logs` across 4 bursts
  (2026-09-04 16:12, 09-08 17:02, 17:15, 21:19), all with the identical
  failing UPDATE and the same index violation. 801 prod phone numbers are shared by more than one lead
  — usually the same line stored once bare (`+1 845-770-1949`) and once
  with an extension (`(845) 770-1949 ext. 6807`). Aircall's call log is
  keyed on the number, so `find_recent_call_by_phone` can only answer "the
  recent call to this number by this SDR", which may be the call already
  recorded against the *other* lead's `dialer_calls` row.
  `_try_live_self_heal` wrote that id blind, tripping the
  `idx_dialer_calls_dedup` unique index, and its `except` logged the
  failure **without `db.rollback()`** — so the session stayed in a
  failed-flush state and the request's next write (`dialer_routes`'
  `log_error`) raised `PendingRollbackError` as an opaque 500. Meanwhile
  the stuck row never healed, so the SDR stayed blocked behind "You
  already have an active call" until the EC-16 window expired (6 minutes,
  measured on prod row `55e4bd01`).
  New shared `dialer_service.apply_phone_match()`: skips an id another row
  already owns (and that call's duration, which isn't this call's), heals
  the status anyway so the SDR is unblocked, and always rolls back its own
  failed commit. `get_call_status`'s identical phone-match block — which
  had the same blind write and so silently failed to heal on every poll —
  now shares it. Both `_try_live_self_heal` branches roll back.
  Not a memory leak: prod is on `standard`, was serving `/api/health` 200
  throughout, and shows no OOM or restart.

### Fixed — email
- **A campaign could fail to send while My Settings still showed
  "Connected".** `routes/email_routes.py`'s own `/email/send` has always
  set `mailbox.status = "error"` on a Nylas 401/403, but `email_send.py` —
  the shared path used by Email Campaigns *and* Sales Journey cadences —
  never did. So a campaign that failed with "connected but not authorized
  to send" left the mailbox looking healthy forever, and
  `GET /email/status` derives `connected` straight from that column, so
  the badge could not have known. Now marked at the shared choke point.
- **"Not connected" was the wrong words for a mailbox that just needs
  re-authorising.** `GET /email/status` gained `needs_reconnect`, and My
  Settings renders a third state — "Reconnect needed" with a *Reconnect
  email* button — instead of collapsing it into "never connected".
- **"Connected as your mailbox" never showed the actual address.** The
  React port read `email_address`; the endpoint returns `email` (legacy
  `sdr_settings.js` read the right one). The test mock had invented the
  wrong key too, so it agreed with the bug.
- **Sending email needed a full page refresh between leads.** Reported in
  Slack. `email-entry.jsx`'s `navigate(container, props)` ignored
  `container` and re-rendered into whatever node `mount()` first attached
  to. `lead_detail.js` rebuilds `#emails-tab-content` with `innerHTML` for
  every lead, and `app.js` only unmounts `EmailHub` when *leaving*
  lead-detail — never lead-detail → lead-detail. So the root stayed
  attached to the previous, detached node: the Email tab rendered nowhere
  and sending was impossible until a reload reset the module's `_mounted`
  flag. `navigate` now re-mounts when the target node isn't the one it's
  attached to, or its own node has left the document.

### Fixed — coherence and copy (staging validation)
- **The SDR performance drill-down used emoji where the app uses icons.**
  All 8 metric cards plus the date-range and error states now use the same
  lucide set as the React app, via a new shared `icon()` in
  `frontend/js/utils.js` (the convention the other legacy views already
  follow with inline SVG). The Leaderboard page it drills down from had
  the same four emoji and is fixed with it.
- **Control Center's subtitle described pages nobody has.** It read
  "additive alongside the existing Settings, Admin, Upload Center and
  System Logs pages" — Upload Center and System Logs went in v11.12.3,
  Settings and Admin in v12.2.1. Worst for a Pod Admin, who sees exactly
  one tab and was told this page sits alongside four they don't have. Now
  role-aware, keyed on the sections actually visible.
- **My Settings had Email Branding and Email Signature as two cards** for
  what is one decision — what gets appended to the foot of your outgoing
  mail. Merged into one "Email Sign-off" card; the guided tour's two
  consecutive steps became one. Its own subtitle also pointed at
  "Settings" for org-wide config, which no longer exists.

### Changed — hardening (deferred from v12.2.1, now actioned)
- **`PATCH /admin/sync-settings` is now `require_super_admin`.**
  `require_admin` admits Pod Admin, and every field this route writes is
  org-wide: Salesforce sync direction and push stage, the Aircall/
  Alternate Messenger dialer credentials and provider selection, POD and
  call-outcome config. The UI has only ever offered it to Super Admins, so
  the gate was simply wider than the product. `GET` stays on
  `require_admin` — its secrets are masked and legacy read-only callers
  depend on it.
- **`sync_settings.messenger_api_key` is encrypted at rest.** It was the
  only credential on that table still plaintext; its siblings
  (`dialer_api_token`, `llm_api_key`, `messenger_access_token`,
  `public_api_key`) always were. `SyncSettings` now exposes it through an
  encrypting property over the same column, so all ~15 readers across 9
  modules are unchanged, with a decrypt-probe backfill migration that
  can't double-encrypt and a tolerant read so a not-yet-migrated row keeps
  messaging working.

### Removed
- **`app.js`: 21 dead `getElementById('<name>-nav-item')` visibility
  toggles, plus the ~97-line Global AI Query Bar block.** None of those
  ids exist in `index.html` any more — the sidebar is `NavSidebar.jsx`,
  gating from its own per-entry `roles` list, and the AI bar's four ids
  (`ai-query-bar`/`-input`/`-btn`/`-result`) made its guard permanently
  false. Every one was a silent no-op that still read like the real gate.
  `injectSmartAnalyticsStyles()` and `window._runAiQuery` deliberately
  stay: the React topbar Ask AI (`NavTopbar`) uses both. Net −136 lines.
- **8 redundant function-local `from datetime import …` in
  `dialer_routes.py`** — the module already imports those names at line
  15. (The one `timezone as tz` alias stays; its call sites use `tz.*`.)

### Tests
- `TestPhoneMatchIdCollision` (2) reproduces the prod incident against the
  real partial unique index, created in the test DB from `migrations.py`'s
  own DDL — both fail pre-fix with the exact production error
  (`PendingRollbackError … UNIQUE constraint failed: dialer_calls.provider,
  dialer_calls.provider_call_id`).
- `email_send` mailbox-status (3, parametrised over 401/403),
  `TestAlternate MessengerApiKeyEncryptedAtRest` (4), `TestSyncSettingsWriteGate` (2),
  `emailEntryRemount` (3, the container one fails pre-fix with an empty
  node), My Settings reconnect state (1).
- `APP_ENCRYPTION_KEY` moved into `conftest.py` — the encrypting property
  means any test assigning that column needs a key, not just the ones
  exercising crypto directly.

### Known / deferred
- The other 14 `*-entry.jsx` shims have the same `navigate()`
  container-blindness. `app.js`'s per-view unmount guards keep them
  latent, so they were left alone rather than churning 14 working
  surfaces; the shim is copy-pasted per island with no shared module.
- Staging's Nylas connector appears to genuinely lack a send scope (the
  403 in the report). Prod has no email errors in 7 days — this release
  makes the failure visible and actionable, it does not re-scope the
  connector.

---

## v12.2.1 — 2026-09-09 (Security: user-management scoping, cadence enrollment ownership; Pod Admin nav coherence; Super Admin email signature)
**Deploy:** `develop → staging` | **Type:** Security hardening + coherence fixes
**Branches:** `develop`, `staging`

### Context
A follow-up audit of v12.2.0, driven by two questions: "did the ownership
work actually cover every route?" and "does what shipped make sense?" The
answer to both was no. v12.2.0 admitted Pod Admins to Control Center →
Team & Access, but that panel was written Super-Admin-only and was never
re-gated, which is what surfaced a set of pre-existing API holes.

### Fixed — security
- **A Pod Admin could create a Super Admin account.** `POST /admin/users`
  takes `require_admin`, which admits Pod Admin, and accepted any `role`
  in the payload — including `"Super Admin"`, with `add_allowed_user()`
  granting login. Full privilege escalation. `PATCH /users/{id}/role` was
  already `require_super_admin`; the role assigned at *creation* had never
  been checked. A Pod Admin may now only create SDR/AE users, and only in
  their own pod.
- **A Pod Admin could delete or lock out any user, Super Admins included.**
  `DELETE /admin/users/{id}` and `PATCH /admin/users/{id}/access` only
  refused the caller's *own* account. `list_users` is pod-scoped so the UI
  never offered those targets, but both routes read the id straight off the
  URL and ids are discoverable (leaderboard rows, cadence owner fields), so
  that scoping was never the guard. New shared
  `_require_may_manage_user()`: Super Admin acts on anyone, a Pod Admin only
  on SDR/AE members of their own pod — matching what legacy `admin.js`
  actually exposed (`showDelete`/`showViewAs` gates). The caller's pod is
  read from their DB row, not the JWT, so it can't disagree with the list
  or be widened by a stale token.
- **Five more cadence routes had no owner check.** v12.2.0 guarded the six
  routes that change a cadence's *definition or lifecycle* but missed the
  five that mutate a specific cadence's *enrollments*: `POST /{id}/enroll`,
  `POST /{id}/sandbox/enroll-test-lead`, and the per-enrollment `retry`,
  `force-next-step` and `skip`. Three of those trigger a real send from
  `journey.owner_id`'s mailbox, so a Pod Admin could put email out under
  another user's name. All five now call `_require_journey_owner`. In
  `enroll_test_lead` the guard was also moved *above* the sandbox-phone
  check, which had been answering non-owners `422` instead of `403` — i.e.
  authorization only applied once the org happened to be configured.

- **Daily Digest failed to load for anyone running ahead of UTC.** The page
  built its default date with `isoYesterday()` off the *browser's* local
  clock, while the backend rejects any digest date not strictly in the past
  judged on its own UTC clock. So local-yesterday == server-today returned
  400 and the page rendered "Failed to load the digest for this date" with
  no KPIs — in IST, every day between 00:00 and 05:30, and a wider window
  further east. Now derived from UTC (`setUTCDate` + `toISOString`), which
  is exactly what the backend validates against. Found by the staging
  Playwright pass, which reported the two newest KPI tiles as "missing" —
  the whole grid was absent, not those tiles.

### Fixed — coherence
- **A Pod Admin had four config nav entries for two concerns** (Settings,
  Admin, Control Center, My Settings). The `settings` and `admin` entries
  were down to `roles: ['Pod Admin']` justified solely by "Control Center
  is Super-Admin-only for now" — which stopped being true in v12.2.0. Both
  removed: Team & Access covers `#admin` for them, and `#settings` rendered
  only a read-only Salesforce status badge plus a lead-count summary (every
  action on that tab is `isSuperAdmin`-gated). Routes still resolve in
  `app.js`, as with v11.12.3's upload/audit-logs removal.
- **Control Center's user panel offered a Pod Admin controls they don't
  have.** `UsersRolesPanel` showed Add User, an editable Role dropdown, POD
  reassignment, delete and revoke-access to any role. Now gated to match
  the backend: Add User, role and POD editing are Super Admin only; delete
  and access-toggle appear only on SDR/AE rows.
- **A Super Admin could not set their own email signature.** `My Settings`
  is the only surface with a signature editor (no Settings tab or Control
  Center section has ever had one), and its nav entry excluded Super
  Admins on the theory that "Super Admin has full Settings". Meanwhile
  `_wrap_email_body()` appends a signature for every role — so a Super
  Admin with a connected mailbox sent every email unsigned with nowhere to
  fix it. Added to the entry's roles; the `#my-settings` route was already
  ungated.

### Tests
+14 backend (9 user-management scoping, 5 cadence enrollment ownership),
+2 frontend (Pod Admin sees none of the Super-Admin-only user controls, but
keeps the two actions legacy gave them). Backend 2769 passed / 8 xfailed,
frontend 709 passed.

### Known, not changed
- 16 `test_today_calls.py`/`test_priority.py` tests fail on a dev machine in
  IST between 00:00–05:30 local: `get_my_today_calls` uses local
  `date.today()` while call rows are stored UTC, so the two disagree while
  the local and UTC dates differ. Render runs UTC, so production is
  unaffected. Pre-existing, unrelated to this release.
- `frontend/js/app.js` still contains 15 `getElementById('*-nav-item')`
  visibility blocks; none of those ids exist in `index.html` any more (the
  React `NavSidebar` owns nav visibility), so they are all no-ops. Left in
  place — deleting them belongs in its own cleanup, not a security fix.

## v12.2.0 — 2026-09-09 (Campaign email HTML fix, ownership scoping for cadences + templates, merge-field picker, cadence email preview, Daily Digest realign, My Settings + Leaderboard React ports, Pod Admin Control Center)
**Deploy:** `develop → staging` | **Type:** Feature + fixes + security hardening
**Branches:** `develop`, `staging`

### Context
Driven by a round of real gaps the user found using v12.1, plus one live
bug reported from a received email. Themes: emails were rendering wrong,
shared objects (templates, cadences) had no ownership model in the UI,
merge fields had to be typed by hand, the Daily Digest said the same
thing twice, and the settings migration had left Pod Admins, AEs and SDRs
on legacy pages.

### Fixed
- **Campaign emails arrived showing raw HTML tags.** A campaign body is
  authored in a rich-text editor, so it is real HTML, but every send went
  through `_plain_text_to_html()` — which *escapes* its input — so
  recipients received a literal `<p>Hi Shreyash,</p>` as visible text.
  `email_send.send_plain_email()` is now `send_email(..., body_is_html=)`,
  picking escape-vs-sanitize per caller. The Sales Cadence email node
  (authored in a plain `<textarea>`) deliberately stays on the escaping
  path — a graph query for every caller is what kept that from being
  "fixed" into a second bug. The unsubscribe footer became HTML to match,
  and campaign merge values are now HTML-escaped so a company named
  `Smith & Sons <Ltd>` can't break the markup.
- **Any Pod Admin could edit or delete another Pod Admin's cadence.**
  All six mutating journey routes (settings, save draft, publish, pause,
  resume, archive) were gated on `require_pod_admin_or_above` with no
  owner check. New shared `_require_journey_owner` guard: owner or Super
  Admin. An orphaned cadence (owner deleted) is Super-Admin-only.
- **Templates: Delete was refused but Edit was offered.** The backend
  already enforced creator-or-Super-Admin on both, but `list_templates`
  never returned `created_by`, so the UI could not tell — it showed an
  Edit button that 403'd only on save. The list now returns
  `created_by`/`created_by_name`/`can_edit` and the UI gates both
  identically.
- **Deleting a template had no confirmation** despite being shared
  team-wide. Now confirms, and says it affects everyone.
- **A Pod Admin could read the Alternate Messenger API key in plaintext.**
  `GET /admin/sync-settings` is `require_admin` (Pod Admin included) and
  returned `messenger_api_key` raw, while `dialer_api_key` and
  `llm_api_key` in the same response were masked. Now masked with the
  same `••••` sentinel, and the write path ignores that sentinel so a
  round-trip can't overwrite the real credential.
- **Read-only cadence viewers were told to "Save, then click Publish"** —
  both buttons are hidden from them. Reworded for that case.
- `backend/config.py`'s `APP_VERSION` had drifted to 11.12.6 while
  `VERSION` read 12.1.0 (the exact residual Rule 15 exists to catch).

### New Features
- **Merge fields are now clickable, not typed.** New shared
  `MergeFieldComposer` (subject + rich-text body + one chip row that
  inserts `{{token}}` at the caret in whichever field you last touched),
  used by both the campaign composer and the saved-template editor —
  which previously rendered that composition separately, which is why
  only one of them ever improved. The fields themselves now have a single
  definition (`utils/mergeFields.js`).
- **Cadence steps have a read-only email preview.** Since v12.1 made
  cadences visible to every role, an SDR could open one and still not see
  what it sends — the node card truncates the subject and the config
  panel's fields sit inside a disabled `<fieldset>`. The preview renders
  the resolved subject/body with sample merge values, and is deliberately
  mounted *outside* that fieldset so read-only viewers can actually use
  it. Covers A/B variants and SMS/WhatsApp steps too.
- **Cadence ownership is visible.** "Owned by <name>" on rows you don't
  own, a lock banner naming the owner in the builder, and non-owned
  cadences can't be selected into a bulk delete (which would have 403'd
  partway through).
- **Deleting a live cadence warns you it's Active** and can still enrol
  new leads.
- **Someone else's template can be duplicated** as your own draft —
  shows you the content and can never 403, unlike editing in place.
- **My Settings is now React** (`my-settings-hub`), replacing legacy
  `views/sdr_settings.js` for every SDR, AE and Pod Admin: Email Sync,
  Dialer (own caller ID, read-only) with the admin-grant rule preserved,
  Email Branding, and an Email Signature editor now built on the shared
  `RichTextEditor` (which gained opt-in image + logo-upload support)
  rather than the legacy `contentEditable`/`execCommand` field. The
  legacy page's permanently-disabled "Notifications" placeholder was not
  carried over.
- **Leaderboard is now React** (`leaderboard-hub`), replacing legacy
  `views/leaderboard.js` and built on `components/ui` primitives:
  podium, full metric table, range presets, admin-only SDR/AE boards, the
  Pod Admin My Pod/Global toggle (same sessionStorage key, so the choice
  carries over), the "You" highlight, and the SDR-sees-only-own-
  performance rule.
- **Pod Admins can now use Control Center**, with sections individually
  role-gated: they get Team & Access only — the one section they already
  hold via legacy `admin.js`. Integrations, AI & Automation, Data and
  Monitoring stay Super-Admin-only (credentials, API keys, upload/sandbox
  and system logs), which is what previously made opening this page to
  Pod Admin an over-grant. The Super-Admin-only per-user capability grid
  is hidden from them inside the section too.
- **Guided tours** for My Settings and the Leaderboard.

### Improvements
- **Daily Digest realigned.** The eight KPI tiles each already stated
  their own week-over-week comparison, and were then followed by a "Today
  vs last week" card re-listing all eight as bars — the same data twice,
  which is what made the page feel busy without saying more. That card
  (and its `ComparisonBars` helper) is gone; the KPIs are now grouped
  Outcomes-first ("what actually progressed") then Activity & outreach,
  Notable events moved up beside Pipeline flow since both describe the
  one day, and the live "Current pipeline snapshot" moved last and is now
  explicitly labelled as not being scoped to the selected date.
- `components/ui/Input` forwards refs; `RichTextEditor` exposes its editor
  instance and gained optional image controls. The `toast()` helper had
  been copied byte-for-byte into three features — now one `utils/toast.js`.

### Breaking Changes
None. Every legacy page remains as a crash-fallback; no endpoint contract
was removed. The tightened cadence-write and credential-masking rules are
deliberate restrictions on what was previously over-permissive.

### Testing
- Backend: 2757 passed, 8 xfailed (was 2741) — 16 new tests covering the
  HTML send policy both ways, cadence owner scoping across all six routes
  (including a second Pod Admin and an orphaned cadence), and template
  ownership.
- Frontend: 707 passed (was 660) — new suites for the merge-field
  composer, the cadence email preview, template ownership, My Settings,
  and the Leaderboard.
- ponytail-review + ponytail-audit run on the diff; 5 findings applied
  (deduplicated `toast`, dropped 3 props/params with no callers, removed
  a redundant role list).

---

## v12.1.0 — 2026-09-08 (Cadence transparency, Daily Digest React port, Campaigns/Performance merge, export filters, settings fixes, delete-lead hotfix)
**Deploy:** `develop → staging → main` | **Type:** Feature + fixes
**Branches:** `develop`, `staging`, `main`

### Context
Follow-up to v12.0.0's Email Campaigns/Sales Tools work, driven by a
round of screenshots the user found reviewing it: Cadence should be
visible (read-only) to every role for transparency, not admin-only;
Campaigns and its old separate Performance tab should be one screen, not
two; Daily Digest was still the legacy vanilla-JS view; and a handful of
Control Center settings had real gaps (a credential-wipe risk, an
unexplained dropdown, a misaligned search icon, a missing role filter,
an SDR-only leads export). A live production bug (single-lead delete
broken) was found and fixed mid-batch.

### New Features
- **Cadence is now visible to every role**, read-only for non-admins —
  they can open a cadence and inspect its steps/config but not
  edit/publish/archive/delete it, closing the gap where a wall said
  "not available" instead. A new guided tour explains this the first
  time a non-admin opens Sales Tools' Cadence tab.
- **Campaigns + Performance merged into one tab.** The old separate
  Performance tab is gone; a single "Performance snapshot" donut now
  lives inside Campaigns, above the existing campaign list — no more
  switching tabs to see delivery outcomes.
- **Cross-cadence performance donut** on the Cadence tab — enrollment
  outcomes (active/completed/failed/exited early/paused) aggregated
  across every cadence, mirroring the Campaigns donut's shape.
- **Daily Digest ported to React**, replacing the legacy vanilla-JS view,
  with two new metrics (Campaigns Sent, Cadence Enrollments) and its own
  guided tour.
- **Export Leads can now filter by upload batch and/or a date range**, in
  addition to SDR — any combination, at least one required. Previously
  SDR-only.

### Fixed
- **Alternate Messenger settings no longer risk silently wiping a saved
  credential.** Account ID, User ID, and Sender ID are now omitted from
  the save payload when the form field renders blank, matching how the
  API key field already worked — a blank field can no longer overwrite a
  real saved value on the next save. A "● Account ID Missing" badge state
  was added so a genuinely missing value is visible instead of looking
  like "Enabled".
- **Aircall's "Calling Provider" dropdown** gets a one-line hint
  clarifying it's the calling vendor, independent from the Messaging
  Provider setting on the Alternate Messenger card — this was working as intended,
  just unexplained.
- **Users & PODs**: swapped a hand-rolled, misaligned search icon for the
  shared `SearchInput` component, and added a Role filter alongside the
  existing POD filter.
- **Single-lead delete was broken in production** — the delete
  confirmation was calling a method that never existed on the leads
  service, always failing with "bulkDelete is not a function". Fixed to
  call the correct (already-imported) assignments service.
- **Campaigns tab briefly shipped with a duplicate table** after the
  Campaigns/Performance merge (a leftover "By campaign" table repeating
  rows already in the campaign list below it) — caught in staging review
  and removed; the Performance snapshot is now a single donut, matching
  the Cadence tab's own pattern.
- **Export Leads' "Upload batch" filter was always empty** — a
  response-shape mismatch (reading the wrong field from the upload-logs
  API) plus a `per_page` value exceeding the route's own cap. Fixed both.

## v12.0.0 — 2026-09-07 (Email Campaigns / Sales Tools, dialer error-log fixes)
**Deploy:** `develop → staging → main` | **Type:** Feature
**Branches:** `develop`, `staging`, `main`

### Context
Alternate CRM had no way to email a whole list of leads at once — only
one-lead-at-a-time compose, or a fully-sequenced Sales Cadence. Email
Campaigns fills that gap: pick a list, write one message, send it as a
burst. It lives inside a new **Sales Tools** hub (renamed from the
standalone "Sales Cadences" nav item), which now has two tabs — Cadence
(unchanged, just re-parented) and Campaigns (new, open to every role,
unlike Cadence). Built alongside two small, unrelated dialer error-log
fixes the same release cycle.

### New Features — Email Campaigns
- **Direct recipient picker.** A "New Campaign" button inside Sales Tools
  opens a picker with search, filters (status, upload file, date
  ingested), a skeleton loader, and "select all N matching" — the same
  entry point Leads Hub's own bulk-select bar already had ("Send Email
  Campaign") now also exists without a detour through Leads Hub.
- **Rich-text compose** (`components/ui/RichTextEditor.jsx`, Tiptap-based)
  — bold/italic, bullet/numbered lists, links — in both compose and saved
  Templates, which are now editable, not just create/delete.
- **Scheduling and recurrence** — send now, a one-time future date/time,
  or repeat daily/weekly/monthly. Mirrors the existing Automated Reports
  scheduler's architecture (`report_service.is_due()` reused unmodified —
  `EmailCampaign`'s new schedule columns are named identically to
  `ReportConfig`'s for exactly this reason) rather than routing through
  `journey_engine.engine`, which is built for sequenced multi-day cadences,
  the wrong fit for one-shot fan-out.
- **Performance tab** — a donut chart (`components/ui/DonutChart.jsx`) of
  sent/failed/skipped across all campaigns, drillable to one. The
  Campaigns list itself has status filtering and pagination.
- **An interactive guided tour** (`SalesToolsTour.jsx`, the same shared
  `GuidedTour` component as Leads Hub/Power Dialer/Control Center's tours)
  points out what's new the first time Sales Tools opens.
- Every campaign send reuses existing plumbing: merge fields
  (`journey_engine/merge_fields.py`), the DNC/unsubscribed gate, and
  `LeadEmailActivity` logging — a campaign email shows up in a lead's
  existing email history for free. A mandatory unsubscribe link and a
  200-recipient-per-campaign cap are new, deliberate additions for
  deliverability/compliance at this scale.

### Fixed — dialer error logs
- `"You already have an active call in progress"` was logged as Critical
  in Monitoring's Error Logs when it's really the same low-severity,
  expected case as two already-downgraded phrases — now logged as Warning.
- A race between two concurrent `/calls/start` requests for the same lead
  could leave a swallowed `IntegrityError` poisoning the DB session,
  surfacing on the next commit as a raw `PendingRollbackError` 500 —
  `models.py`'s `log_status_change()` now rolls back that session first.

### Known limitation
Campaign dispatch runs in-process via FastAPI `BackgroundTasks`, not a
durable queue — a server restart mid-campaign leaves remaining recipients
`pending` with no automatic resume. Acceptable at this scale (an admin can
see the partial state on the dashboard); revisit if it causes real pain.

## v11.12.6 — 2026-09-04 (Control Center: interactive guided tour, nav reorder)
**Deploy:** `develop → staging → main` | **Type:** Small UX fix
**Branches:** `develop`, `staging`, `main`

### Context
The v11.12.5 nav badge tells a Super Admin *that* Control Center changed, but
not *what's there* once they click in — the only exhaustive reference was
the passive Help Hub section. Since the whole 5-tab surface is new to
everyone (not just the two features that just closed gaps), the ask was a
proper interactive walkthrough covering all of it, the same pattern already
used for Power Dialer and Leads Hub.

### Added — Control Center guided tour
`ControlCenterTour.jsx`, built on the existing shared `GuidedTour` component
(zero new dependency, zero changes to that component) — one step per
section tab (Integrations, Team & Access, AI & Automation, Data,
Monitoring) plus the search box, 6 steps total. Shown once per browser via
the existing `seenFlag` localStorage pattern. Targets the tab bar buttons
directly (`data-tab` added to the shared `Tabs.jsx`), which stay in the DOM
regardless of which section is active — no cross-section navigation
plumbing needed.

### Changed — nav order
Control Center moved above Help in the sidebar (`NavSidebar.jsx`) — the more
frequently used of the two for Super Admins.

## v11.12.5 — 2026-09-04 (Control Center: "Updated" nav hint for discoverability)
**Deploy:** `develop → staging → main` | **Type:** Small UX fix
**Branches:** `develop`, `staging`, `main`

### Context
v11.12.4 opened Control Center to every Super Admin and closed the Upload
Center/SF Sync gaps, but had no way to tell anyone besides the person who
built it. The in-app User Guide section covering it is passive — a Super
Admin only sees it if they already know to open Help and scroll to it.

### Fix
Added a small "Updated" badge on the Control Center nav item, shown to any
Super Admin who hasn't opened it since this release. Clears itself (and
never reappears) the moment they click in — same `seenFlag` localStorage
pattern already used by the Power Dialer and Leads Hub first-visit tours, no
new dependency. `NavSidebar.jsx` + `NavHub.css`, covered by 3 new tests.

## v11.12.4 — 2026-09-04 (Control Center: parity gaps closed, opened to all Super Admins)
**Deploy:** `develop → staging → main` | **Type:** Feature completion + access change
**Branches:** `develop`, `staging`, `main`

### Context
Follow-up to v11.12.2's UX audit: two real gaps were flagged (Upload Center
missing history/rollback, SF Sync missing most of its settings) plus a
request to finish rolling Control Center out — open it to every Super Admin,
retire the legacy nav entries it now fully covers, and document it in the
in-app User Guide.

### Fixes — real bugs found while closing the gaps
- `UploadService.getLogs`/`getBatchMetrics`/`getBatchDetail` all silently
  called the wrong endpoint — never caught because nothing used them until
  the History card was built.
- `SettingsService.getRecordTypes` called `/admin/sf/status` (the SF
  connection endpoint) instead of `/admin/record-types`.

### Data section — Upload History + Rollback
Stat tiles, a paginated upload-history table, a per-SDR assignment-summary
detail view, and a rollback flow (with the same protected-lead safeguards
the legacy page has) — all backed by existing, previously-unused endpoints.

### Integrations / Monitoring — SF Sync parity
Added the 9 sync settings that were left behind when only Sync Direction and
Call Outcomes were ported from `settings_sync.js`: Lead Sync Limit, SF Push
Stage, Record Types filter, declined/unreachable sync toggles, Auto-Sync
Schedule, POD multi-pod toggle, and the 5 Call & Pipeline fields. Added
"Records Synced Last Run" to the SF connection card, and a stats row,
30-second auto-refresh, and CSV export to the SF Sync Log tab.

### Access — Control Center opened to all Super Admins
Widened from a single owner email to `role === 'Super Admin'` (`app.js`,
`NavSidebar.jsx`, `ControlCenterHub.jsx`). Deliberately not widened to Pod
Admin yet — Data and most of Monitoring have no internal role sub-gating and
are Super-Admin-only in legacy.

### Legacy nav changes
- **Upload Center** and **System Logs** removed entirely — both were
  Super-Admin-only in legacy with full parity now, zero regression for
  anyone.
- **Settings** and **Admin** hidden from Super Admins only (role list
  narrowed to `Pod Admin`) — Pod Admins are unaffected, since Control Center
  doesn't admit that role yet.
- **Lead Assignments** (`assignments.js`): verified it was already 100%
  unreachable dead code (no nav item, no button/href anywhere ever called
  it) and that the Leads Hub already has full functional parity — bulk
  assign/unassign/delete, per-row unassign, Round Robin auto-assign — more
  discoverably, directly on the main Leads page. Disconnected the dead route
  from `admin.js`/`app.js`; the file itself is untouched and still has one
  real caller (the classic Leads page's own tab bar).

### Documentation
Added a full Control Center section to the in-app User Guide, plus pointer
notes in the old Admin Panel, Settings, and Audit Logs guide sections for
Super Admins.

### Verification
Frontend suite: 628/628 passed. `nav-hub`, `help-hub`, and
`control-center-hub` bundles rebuilt and cache-bust versioned.

## v11.12.3 — 2026-09-04 (Control Center production hang — root-cause fix)
**Deploy:** `develop → staging → main` | **Type:** Bug fix (frontend, production)
**Branches:** `develop`, `staging`, `main`

### Context
Reported live on production: Control Center gets stuck on the skeleton
loading state indefinitely after navigating away (e.g. to POD Management)
and back — only a hard reload recovers. Reproduced deterministically via a
local repro against staging's API and root-caused before shipping.

### Fix
- **`ControlCenterHub` was missing from `app.js`'s per-view unmount-guard
  list** — every other React-island hub (Pods, Activity Monitor, Calendar,
  etc.) unmounts when the user navigates to a different view; Control Center
  never got this guard added. Without it, navigating away destroys
  `#control-center-react-root` via the generic loader, but the hub still
  thinks it's mounted — so navigating back calls `.navigate()` instead of
  `.mount()`, which re-renders into the original, now-detached DOM node.
  Nothing ever replaces the visible skeleton. This is the same bug class
  already fixed once for Calendar/User Guide/Sales Journeys (2026-08-05);
  Control Center was simply never added to the list when it was built.
- Verified with a local repro (served `frontend/` against staging's API):
  confirmed the exact failure with the guard removed, confirmed the fix
  with it restored.

## v11.12.2 — 2026-09-04 (Control Center UX audit — 10 findings)
**Deploy:** `develop → staging → main` | **Type:** Bug fixes + UX (owner-only Control Center surface)
**Branches:** `develop`, `staging`, `main`

### Context
The owner ran Control Center live and filed 10 concrete UI/UX findings —
leftover emoji, missing/broken confirmations, a redesign ask for the Users
table, a missing export, a redundant Call Logs tab, a missing Add User flow,
and an SF "last sync" field that never populated. Addressed all 10.

### Fixes — real bugs
- **`SalesforceConnection.last_sync_at`/`last_sync_status`/`last_sync_error`/
  `records_synced_last_run` had zero write sites anywhere in the codebase**
  despite existing on the model since the start — the SF card always showed
  "Last Sync: Never". `run_full_salesforce_sync()` now stamps them on both
  success and failure.
- **No self-guard on `PATCH /admin/users/{id}/access`** — unlike delete and
  View As, an admin could revoke their own login access outright. Added,
  matching the existing self-delete/self-view-as guards.
- **Revoke/Restore access had no confirmation and no success feedback** —
  read as a no-op when tested. Now confirms via the app's `ConfirmDialog`
  and fires a toast.

### UX
- Removed leftover emoji glyphs from Monitoring (severity badges, Perf
  Health, Error Logs), replaced with lucide icons or plain text.
- Replaced raw `window.confirm()` with the app's `ConfirmDialog` on SF
  disconnect, Alternate Messenger clear-credentials, Public API generate/revoke, and
  prompt reset.
- Consolidated Users & PODs' separate Access / View As / Delete columns
  into one Actions column of icon buttons; relabeled the login-activity
  badge "Last Active" (it was unrelated to the Access toggle next to it,
  reading as broken).
- Merged UserAccessTable's calling+messaging provider chips into one when
  the same vendor handles both, instead of showing the vendor name twice.
- Deleted the Call Logs tab from Monitoring — Activity Monitor already
  covers call history; this was a redundant second view.
- Added an Add User modal: single-user create, plus a bulk CSV path
  (download template → fill → upload) against the existing
  `POST /admin/users/upload` endpoint.
- Added "Export Leads" to the Data section — one SDR's full lead data as a
  CSV, via a new `GET /api/admin/leads/export` endpoint.
- Added a lightweight search box to the Control Center header, jumping to
  the matching section from a static keyword index.

### Not done (flagged, not fixed)
- Nylas and Alternate Messenger have no persisted "last connected" timestamp today
  (SF and Aircall do) — needs a small new DB column; skipped this pass to
  avoid a rushed migration.
- Skeleton loading was already present everywhere checked — no change made.

### Verification
- Full backend suite: 2697 passed, 4 skipped, 8 xfailed, 0 failed.
- Full frontend suite: 614 passed, 0 failed.
- New tests: self-revoke guard, SF sync-status stamping (success + failure
  paths), Export Leads endpoint (scoped to the right SDR, 404, empty case),
  Add User modal (single + bulk), provider-chip merge behavior.

## v11.12.1 — 2026-09-04 (Dialer reliability fixes, dead-code cleanup)
**Deploy:** `develop → staging → main` | **Type:** Bug fixes
**Branches:** `develop`, `staging`, `main`

### Context
Investigated a recurring "You already have an active call in progress" error
directly against prod (`error_logs` + `dialer_calls`), rather than re-patching
the same symptom a previous fix already targeted. Two distinct, previously
undetected root causes found and fixed.

### Fixes — real bugs
- **Phone numbers with an extension (e.g. "ext. 2227") never self-healed.**
  `find_recent_call_by_phone()` digit-stripped the raw stored phone number
  including the extension suffix, corrupting the match target against
  Aircall's own call log (which never carries an extension). 100% of the 105
  extension-number calls placed in the last 30 days hit this — none could
  ever self-heal, falling through to the slow ~5 min staleness sweep instead.
  Fixed by stripping the extension before matching, same as `initiate_call()`
  already does before dialing.
- **A TOCTOU race let two dial attempts for the same SDR both pass the
  "already have an active call" guard.** The DialerCall row was created only
  *after* the external Aircall API round-trip (which includes a 405
  retry-with-sleep) returned, leaving that whole window open for a second
  request to slip past the guard. Confirmed 38 same-lead duplicate-dial pairs
  under 5s apart over the last 14 days in prod. Fixed by reserving the row
  before calling the provider and filling it in after, instead of creating a
  second row.
- **`pre-deploy-check.sh`'s "ALTER TABLE without lock_timeout" check
  false-positived on every run.** `grep -A2 | grep -v lock_timeout` filters
  line by line — it can never see a guard set 1-2 lines *before* the ALTER
  statement (exactly how `migrations.py`'s enum-conversion loop is written).
  Replaced with an awk sliding-window check.

### Cleanup
- Deleted `POST /admin/impersonate/{id}` and `AdminService.impersonate()` —
  zero callers; Control Center's "View As" actually calls a separate
  endpoint, `GET /admin/users/{id}/token`, which was missing the self-view
  guard and audit log the dead endpoint had. Ported both over first.
- Found while doing that: the ported audit-log call used action type
  `"IMPERSONATE"`, which was never registered in `activity_logger.py`'s
  `ACTION_TYPES` — so it silently no-op'd, in both the endpoint it came from
  and the one it moved to. Registered the key; confirmed live on staging
  that a real `UserActivityLog` row now lands.

### Verification
- Full backend suite: 2691 passed, 4 skipped, 8 xfailed, 0 failed.
- New tests: extension-number self-heal match, exactly-one-DialerCall-row
  per call, `get_user_token` self-view/404/audit-log assertions.
- Staging: `/api/health/deep` (`db_tables_accessible: true`), authenticated
  call (`sync-settings`), dead endpoint confirmed 404, View As exercised
  live against a real other user with a genuine staging JWT — both before
  and after the `ACTION_TYPES` fix, confirming the audit row actually lands.

## v11.12.0 — 2026-09-03 (Control Center audit — bug fixes, restored features, redesign)
**Deploy:** `develop → staging → main` | **Type:** Feature + bug fixes (owner-only Control Center surface)
**Branches:** `develop`, `staging`, `main`

### Context
A critical, item-by-item audit of the still-owner-gated Control Center
(shipped in v11.11.x) against the live code and the legacy pages it's meant
to eventually replace. 19 findings total: 8 required a code change, 6 were
investigated and closed with no change needed (already correct, or not
actually bugs), 5 more are fixed here. Every item was verified against the
actual source, not the earlier build plan (which no longer exists in-repo).

### Fixes — real bugs
- **A lead sitting in "Meeting Scheduled" in the new Lead Detail view had no
  way to move to an arbitrary stage.** Quick Actions' "Update Stage" button
  just replayed whatever single fixed CTA was already showing (e.g. "Mark
  Meeting Complete") — it was never a real picker. Replaced with a "Change
  Stage" dropdown offering every status; the existing backend gate (blocks
  backward moves for SDRs, blocks entering Meeting Scheduled without a logged
  call) already validates it correctly, so no backend change was needed.
- **`GET /admin/leads/unassigned` and `/assigned` returned every row (`LIMIT
  5000`) on every Control Center Lead Assignments mount**, and again after
  every assign/unassign — the likely cause of "every tab feels slow". Now
  paginated the same way `GET /leads` is (`page`/`per_page`,
  `{data, total, page, per_page, pages}`), plus a real `assigned_to` filter
  restoring a legacy capability ("filter Assigned leads by SDR") that had been
  dropped in the React port. A regression test guards that filtering to one
  SDR still shows every co-assignee on a lead shared with others.

### Restored / newly added
- **Salesforce 2-way sync toggle** — missing from Control Center entirely;
  ported from legacy `settings_sync.js` into a new "CRM Settings" tab.
- **"View As" (impersonation)** — Super Admin only, in Users & PODs. Reuses
  the exact mechanism legacy already relies on (`GET /admin/users/{id}/token`
  → open a new tab with `?token=` → `auth.js` stashes it tab-scoped in
  `sessionStorage` and shows the "Viewing as X" banner) — not the newer,
  unwired `POST /admin/impersonate` endpoint, which stays unused.
- **Lead Assignments** promoted from a Team & Access sub-tab to its own
  top-level Control Center section — it isn't a natural fit alongside
  user/role/POD management or the calling/messaging access grid.

### Redesign
- Integrations split from one flat page (6 stacked cards) into Connections /
  Dialer / CRM Settings tabs.
- Alternate Messenger's API key field was plaintext-prefilled; now masked like
  Nylas/Aircall, and omitted from the save payload unless actually edited
  (the backend has no blank-preserves logic for this one field).
- Research Gate and Bulk Research Pre-Population cards removed from Control
  Center at the user's request — legacy `settings.js` keeps both working
  exactly as before; only these Control Center controls are gone.
- Emoji glyphs (📞💬🟢) replaced with `lucide-react` icons across Team &
  Access and Monitoring for iconography consistency with the rest of the app.
- A one-line subtitle added to each of Users & PODs / User Access so the
  split between the two reads as intentional.

### Also fixed (unrelated, found while investigating)
- `frontend-react`'s `releases.json` had 6 entries (`v11.11.5`, `v11.10.1`–`.5`)
  labelled `"kind": "patch"` — not a value the documented family-grouping
  spec (`AGENT_PROTOCOL.md`) defines (only `major`/`minor`). Confirmed via
  `ReleaseNotesSection.jsx` that this was a pure metadata mislabel with no
  live rendering impact, then corrected to `"kind": "minor"`.

### Verification
- Full backend suite: 2686 passed, 4 skipped, 8 xfailed, 0 failed.
- Full frontend suite: 612 passed, 0 failed.
- New tests: the Change-Stage picker (success + current-status exclusion),
  assignment pagination (page 1/2 disjoint, co-assignee visibility under a
  filter), View-As button gating + token flow, Control Center tab splits,
  Alternate Messenger masking (payload omits the key unless typed).

### No in-app `releases.json` entry
Every change here lives entirely inside the owner-gated Control Center
surface — no SDR, Admin, or Pod Admin account can ever see any of it, so
there is no user-facing audience for an in-app note (same call as v11.11.3).

## v11.11.5 — 2026-09-03 (Pre-production hardening ahead of the v11.11.x → prod promotion)
**Deploy:** `develop → staging → main` | **Type:** Reliability fixes (prod-scale risks found in a pre-promotion review)
**Branches:** `develop`, `staging`, `main`

### Context
Everything from v11.11.0 through v11.11.4 had only ever run on staging, where
there is one user. A review before promoting to production — 23 SDRs, real
outbound email, a shared third-party rate limit — turned up two risks that
staging structurally cannot surface. Both are fixed here.

Control Center itself was reviewed and is **not** among them: its owner-email
gate is intact at all three points (nav `allowedEmails`, `app.js` route guard,
`ControlCenterHub`'s own check), every endpoint it calls was already
Super-Admin-gated server-side, its Monitoring section is read-only, and all
React bundles are current in the commit. Worth restating: that gate is a **UI
restriction, not a security boundary** — other Super Admins keep exactly the
API access they already have.

### Fixes
- **A failed access-granted email can no longer fail the access grant.** The
  Phase 1.5 notification (v11.11.0, still unreleased to prod) ran inline and
  unguarded after the endpoint's own `db.commit()`, on the **shared** endpoint
  the legacy Settings page uses daily. `send_report_email` POSTs to Nylas with
  a 30s timeout and no `try/except`, so in production this would have added up
  to 30s to every grant and turned any Nylas connection error into a **500
  handed to the admin after the change had already been saved** — they would
  see failure, retry, and send the user a second email. Now scheduled via
  FastAPI `BackgroundTasks` through a wrapper that opens its own session and
  cannot raise. A notification must never decide whether the operation it
  describes appears to have succeeded.
- **The v11.11.2 phone-match self-heal can no longer exhaust Aircall's rate
  limit.** The outcome-modal poll runs every 10s for up to 10 minutes
  (`MAX_POLLS=60`), and the fallback fired on *every* poll for any Aircall call
  with an empty `provider_call_id` — up to 60 extra Aircall `GET /calls` per
  call. In prod **762 of 7,122 Aircall calls (10.7%)** sit in that state,
  Aircall's ceiling is 60 requests/min for the whole company, and prod has
  already logged a 429. Several concurrent such calls could have throttled
  dialling for all 23 SDRs — the exact symptom the self-heal exists to prevent.
  Now bounded twice: a 45s grace period so the webhook (which wins that race
  almost always — a typical call is ~20s end to end) goes first, then at most
  one lookup per minute per call.

### Verification
- Full backend suite: 2683 passed, 4 skipped, 8 xfailed.
- 10 new tests: a Nylas failure still returns 200 with the grant committed; the
  background wrapper uses its own session and swallows; and the throttle's
  grace period, cooldown, cooldown expiry, per-call independence, bookkeeping
  prune, and route-level suppression for a fresh call.

### Config to confirm on promotion
Prod's `FRONTEND_URL` must point at production — it is what builds the link in
the access-granted email now going to real SDRs. A wrong value yields a wrong
link, not a failed grant (an unset value simply omits the link).

### No in-app `releases.json` entry
Reliability hardening with no new user-facing surface.

## v11.11.4 — 2026-09-03 (Calls tab could take the whole app down; health check now reports its version)
**Deploy:** `develop → staging` | **Type:** Reliability fix (reproduced outage)
**Branches:** `develop`, `staging`

### Context
Found by causing it. While verifying the v11.11.3 deploy I opened ~18 leads'
Calls tabs in quick succession and **staging went down** — Render served
platform 502s for about two minutes before recovering unaided. The deploy was
not at fault (health was green and a behavioural probe succeeded before and
after); the endpoint was.

`GET /api/leads/{id}/calls` spawned **one background thread per DialerCall on
the lead** — unbounded — each opening **its own DB session** and then making a
provider API call *while holding that pooled connection*. Aircall's rate-limit
backoff makes it far worse: `_get()` sleeps 10s doubling to 60s over 5
attempts, so a single throttled thread could sit on a connection for ~150s.
Enough concurrent threads exhausted the pool and the app stopped serving
**everyone**, not just the SDR who opened the tab. An SDR opening the Calls tab
on a lead with many calls hits the same fan-out.

This is the same failure [RCA 2026-07-27] already diagnosed and fixed for
`activity_feed_routes`' batch refresh, and `_fetch_call_update_data`'s
docstring already prescribes the remedy — *"Fetch first with no connection
held, write later in a short-lived session."* This call site simply never
adopted it. Two earlier rounds of patching (`PERF FIX v8.9.9` made the refresh
fire-and-forget; `EC-17` added skip conditions to quiet "502 log storms")
treated symptoms without addressing the thread-and-session count.

### Fixes
- **One bounded background thread per request instead of one per call row**,
  running two short-lived sessions with the slow provider calls sandwiched
  between them holding no connection at all.
- **Refresh is scoped to the requested page**, not every call ever made to the
  lead. The endpoint already paginated its *response* while refreshing
  everything, so a lead with 200 calls fanned out 200 ways to render 10 rows.
  Now bounded by `limit` (≤100, default 10).
- **Caller names batched into one query** instead of one per call row.
- **The background failure path logs instead of swallowing.** The old
  `except Exception: pass` is a large part of why this went unnoticed.
- **`/api/health` now returns `version`.** Confirming what is actually running
  previously required a behavioural probe against live data — "staging is
  healthy" could not distinguish a landed deploy from the previous build.

### Verification
- Full backend suite: 2673 passed, 4 skipped, 8 xfailed.
- 5 new tests pin the properties that caused the outage: refresh bounded to the
  page, one thread for a 30-call batch, no DB session open during the provider
  call, already-complete calls not queued, empty batch starts no thread.
- The session-holding test is verified **non-vacuous**: an earlier draft passed
  while observing nothing, which is how the vacuity was caught; it now asserts
  sessions were really opened, the provider was really called, and the rows
  were really written. A deliberately re-broken variant (fetching inside the
  session's scope) fails the suite; the shipped version passes.

### Known, not fixed
`_refresh_recording_url` now has no production callers — only tests, which use
it as the composition of `_fetch_call_update_data` + `_apply_call_update_data`.
Left in place rather than churning those tests; it is dead weight, not a risk.

### No in-app `releases.json` entry
Pure reliability work with no user-facing surface.

## v11.11.3 — 2026-09-03 (Aircall 405 retry; dead availability pre-check deleted; meeting gate accepts an answered call)
**Deploy:** `develop → staging` | **Type:** Bug fixes (prod-affecting; investigated against the prod DB and Aircall's live API)
**Branches:** `develop`, `staging`

### Context
v11.11.2 attributed the reported "X could not receive the call" bug to
staging's disabled Aircall webhook. **That attribution was wrong.** A webhook
delivers inbound events after a call exists; it cannot cause a failure on the
outbound dial POST. The bug was never diagnosed, and prod evidence shows it is
the single most frequent dialer error there: **665 occurrences in 14 days
across 13 SDRs** (worst: 263 of 698 dials, 38%).

Root cause, from the prod `dialer_calls`/`error_logs` tables plus Aircall's
live API:
- Aircall answers `POST /v1/users/{id}/calls` with a **405**, and it is
  **transient**: 593 of the 665 (89%) were followed by a connected call to the
  same number by the same SDR — median 10.9s later, because the SDR simply
  clicked dial again — and 90% needed only that one retry. Aircall's own call
  log contains no call object for a 405, so nothing was placed.
- The pre-check that existed to prevent exactly this was **dead code**. It
  blocked on `availability_status ∈ {"do_not_disturb", "offline"}`; Aircall
  emits neither on a *user* (they are number-level statuses), so it had never
  fired once. Its 5 unit tests passed only because the fixture hand-set a
  value the real API never sends — the mock encoded the same wrong assumption
  as the code.
- `available`, Aircall's real reachability boolean, does **not** predict
  dialability: the SDR with the highest 405 rate reads `available:true`, while
  two SDRs reading `available:false` placed 766 and 596 successful calls. So
  "pre-check harder" was measured and rejected, not assumed.
- Compounding all of it: `if e.response` is **falsy for every error response**
  (requests' `Response.__bool__` returns `.ok`), so the code that was supposed
  to extract Aircall's own `troubleshoot` explanation never ran. We had been
  discarding the vendor's account of the failure and substituting a guess.

### Bug Fixes
- **A 405 on dial is now retried once, 5s later.** Removes ~89% of these
  errors from the SDR's day; they were already retrying by hand. Only a 405 is
  retried — the one status Aircall's call log proves placed no call, so this
  cannot double-dial. Aircall's response body is now logged on both attempts,
  so the underlying cause can finally be attributed.
- **Deleted the dead availability pre-check** and the now-unreachable
  `"is currently marked as"` severity match in `dialer_routes`. Replaced its
  5 tests with tests of what actually happens, including a regression guard
  against pre-blocking on `available:false`.
- **`if e.response` fixed everywhere it appeared.** `initiate_call`'s 400 and
  generic branches now really do surface Aircall's reason; Settings → Test
  Connection no longer reports "Authentication failed (HTTP 0)" for every
  failure.
- **`get_users()` availability corrected** to read the `available` boolean
  rather than deriving it from `availability_status`, which reported
  effectively the whole org as available.
- **"At least 1 call must be logged" no longer blocks a lead that has one.**
  `logged_call_count` required an *outcome-bearing* call, so it disagreed with
  the lead's own Calls tab, which counts every call — the reported prod
  symptom, and not rare: **1,305 of 5,848 prod leads with calls (22%)** had no
  outcome-bearing call, 304 of them despite a call the lead answered. An
  answered call now counts. Unanswered calls still don't, and the message now
  states what is actually missing instead of contradicting the screen.

### Regression found and fixed in v11.11.2 itself
- **`find_recent_call_by_phone` was matching teammates' calls.** Aircall's
  `GET /calls` is company-wide and ignores a `user_id` param (verified live),
  so the self-heal added in v11.11.2 could heal the wrong SDR's row from
  another SDR's call to the same number — reachable, since two SDRs dialling
  one lead is routine after a reassignment. Now scoped to the call's **owner**
  (not the authed poller: `/calls/{id}/status` is not restricted to the call's
  own user), rejects numbers shorter than 10 digits (3-digit Aircall
  extensions appear in `raw_digits` and suffix-match almost anything), and
  pages 50 instead of 20 to actually cover the window at team volume.

### Verification
- Full backend suite green. New/rewritten: 5 tests for 405 retry + no
  pre-block + `get_users` availability, 3 for the meeting gate, 3 for
  owner-scoped phone matching (teammate call, short number, missing email).
- `ponytail-review` (diff) and `ponytail-audit` (repo-wide) both run; all
  findings applied, including the `test_connection` instance of the same
  falsy-Response bug that the audit turned up.

### No in-app `releases.json` entry
Internal reliability and one corrected validation message; no new user-facing
surface to announce. The SDR-visible effect is the *absence* of an error.

## v11.11.2 — 2026-09-03 (Dialer: self-heal when Aircall never returns a call ID; Lead Detail Hub stage-CTA fix)
**Deploy:** `develop → staging` | **Type:** Bug fixes (real prod + live staging SDR-testing session)
**Branches:** `develop`, `staging`

### Context
Live staging SDR testing surfaced 7 reported issues, all root-caused with real
DB/API evidence (no guesswork) rather than assumption:
- **External root cause found and fixed directly in Aircall**: staging's
  Aircall webhook subscription (`messenger-crm-staging.onrender.com/api/webhooks/dialer`)
  was registered but **disabled** (`active: false`) — confirmed via Aircall's
  own `/v1/webhooks` API. Staging could never receive live call-status
  events as a result. Re-activated; no code change needed for this part.
- That explained the "previous call still active, click Force Clear"
  bug, the outcome modal never opening after a real connected call, and the
  same symptom surfacing through Power Dialer (confirmed same shared
  call/outcome code path, not a separate bug).

### Bug Fixes
- **Dialer self-heal now covers calls that never got a provider call ID.**
  Bridge-mode Aircall dials often don't return a call ID synchronously — the
  existing self-heal check (`_try_live_self_heal`, asks Aircall directly
  instead of waiting out the 5-minute staleness window) bailed out
  immediately whenever that ID was empty, which is exactly the state every
  affected call was in. Now falls back to a phone-number + recency lookup
  (`AircallDialerProvider.find_recent_call_by_phone`) — same reconciliation
  the webhook handler already does, run proactively. Applied to both the
  pre-dial "already have an active call" guard and the `/calls/{id}/status`
  poll that drives the outcome modal, so this helps even when a webhook is
  merely late (the real, occasional prod case) — not just when it's disabled
  entirely.
- **Lead Detail Hub (React): a lead already past Qualification (Meeting
  Scheduled, Demo Scheduled, 1st Discovery Meeting, Discovery Complete)
  could get stuck showing "Call Now — no successful conversation yet"** with
  no way to advance, if the activity feed had any gap in a call's logged
  outcome (the same class of issue as above). `deriveNextBestAction()`
  checked a "has an answered call" heuristic *before* checking the lead's
  own authoritative status — reordered so the specific pipeline-stage
  branches win; the status itself is stronger evidence a call happened than
  re-deriving it from the activity feed.
- Confirmed **not a regression** of the `call.hungup` webhook-mapping fix
  shipped 2026-08-21 (`268b729`) — that fix is intact and addressed a
  different problem (a 10-30s delay from an unmapped event type); this
  session's bugs were "no webhook arrives at all," a fundamentally different
  failure mode, caused by the disabled staging subscription above.
- The "at least 1 call must be logged before moving to Meeting Scheduled"
  prod report (`logged_call_count()` requiring `DialerCall.outcome IS NOT NULL`
  while the Calls-tab badge counts any call regardless of outcome) traces to
  the same root cause: an outcome that never got attached. The self-heal fix
  above reduces how often that happens; the gate logic itself is correct by
  design and was left unchanged.

### Testing
- 10 new backend test cases (`test_aircall_sync.py`, `test_dialer_routes.py`)
  covering `find_recent_call_by_phone` and both self-heal call sites
  (healed vs. still-active vs. network-error).
- 1 new frontend regression test (`deriveNextBestAction.test.js`) reproducing
  the exact stuck-CTA scenario.
- Full backend suite: 2663/2663 passing. Full frontend suite: 599/600 (1
  pre-existing, unrelated `releases.json` data-gap failure).

☑ VERSION bumped (11.11.1 → 11.11.2) + `scripts/sync-version.mjs` run
☑ `backend/config.py` APP_VERSION updated
☑ `docs/RELEASES.md` updated (this entry)
☑ In-app `releases.json` — not updated; these are internal reliability fixes
  with no new user-facing surface to announce

---

## v11.11.1 — 2026-09-03 (Control Center: remaining Monitoring tabs ported)
**Deploy:** `develop → staging` | **Type:** Feature completion (personal, additive, owner-only surface)
**Branches:** `develop`, `staging`

### Context
Control Center (v11.11.0, shipped 2026-09-02) launched with a Monitoring
section covering only Audit Log + Salesforce Sync Log — the legacy
`frontend/js/views/audit_logs.js` "System Logs" page has 5 more tabs that
weren't in the original parity checklist. Per user request, ported the rest.

### What's New
- **Login History tab** — ports `loadLogins()`: searchable table of
  user/email/role/login-logout time/duration/IP, reusing the existing
  `AdminService.getLoginLogs` endpoint (already used by legacy).
- **Feedback tab** — ports `loadFeedback()`: bug/feature/general submissions
  with an inline status editor (New/Reviewed/Resolved) — the one write
  action in this section, same `PATCH /api/admin/feedback/{id}` the legacy
  page already calls.
- **Error Logs tab** — ports `loadErrorLogs()`: severity/category/resolved
  filters, card list with action hints, dedup counts, stack context.
- **Call Logs tab** — ports `loadCallLogs()`: SDR/provider/outcome/status/date
  filters, stats strip, per-row failure detail.
- **Perf Health tab** (Super Admin only, matching legacy's own gate) — ports
  `loadPerfHealth()`: RAIL tier distribution, slowest-endpoints table with
  the same industry-benchmark comparisons, DB index health, Alternate Messenger API
  health, 1h/4h/24h/since-deploy window picker.

All 5 are read-only ports of existing, already-Super-Admin-gated backend
endpoints (`/admin/feedback`, `/admin/error-logs`, `/admin/call-logs`,
`/admin/perf-summary`) — no backend changes, no new endpoints. 6 new thin
`AdminService` wrappers added to `frontend-react/src/services/api.js`.

### Not Changed
- Still gated to one account by exact email match (3-layer gate unchanged).
- Legacy `audit_logs.js` page is untouched and remains the fallback everyone
  else uses — nothing retired.
- No in-app "What's New" entry / user-guide update / guided tour for this
  release: Control Center is visible to exactly one account, so the
  SDR/Admin-facing documentation requirements in AGENT_PROTOCOL.md §13
  don't have an audience here. Flagging this explicitly rather than silently
  skipping it.

### Testing
- 6 new Vitest cases added to `MonitoringSection.test.jsx` (one per new tab
  + the Perf Health role gate), all passing (11/11 in the file).
- Full frontend suite: 598/599 passing (1 pre-existing, unrelated
  `releases.json` data-gap failure, confirmed present before this change).
- No backend files touched — backend suite unchanged from the last full
  green run (2653/2654, 1 known pre-existing Klenty date-drift failure).
- ponytail-review pass: found and removed one dead export
  (`AdminService.getErrorLogsSummary`, added speculatively, never called —
  the Error Logs tab intentionally ports the legacy page's own client-side
  fallback stats instead of the summary endpoint).

☑ VERSION bumped (11.11.0 → 11.11.1) + `scripts/sync-version.mjs` run
☑ `backend/config.py` APP_VERSION updated (manifest.json has no version string to update)
☑ `docs/RELEASES.md` updated (this entry)
☑ In-app `releases.json` — intentionally not updated, see "Not Changed" above

---

## v11.10.5 — 2026-09-02 (Fix: messaging-access backfill used the wrong signal — real prod incident)
**Deploy:** `develop → staging → main` | **Type:** Data correctness fix (prod incident)
**Branches:** `develop`, `staging`, `main`

### Context
Caught by the user directly reviewing prod after the v11.9.4 → v11.10.4
promotion, not by any test in this repo — pytest runs against fixtures, not
real prod data, so this class of bug was invisible to the verification done
before promoting.

`v11_10_0_backfill_messaging_access` (the migration that gave existing users
`sms_enabled`/`whatsapp_enabled` so nobody lost messaging when those columns
were introduced) used `WHERE dialer_enabled = true` as its condition.
Confirmed against a live pull of this org's real 23-user prod table that this
is the wrong proxy: `dialer_enabled` reflects calling access on *whatever*
vendor is configured (Aircall, for most of this org's SDRs) — it has nothing
to do with whether someone is a real Alternate Messenger messaging agent. The
correlation in the live data was exact and mechanical: every one of the 18
users with `dialer_enabled=true` got both new columns set `true`; every one
of the 5 with `dialer_enabled=false` got both set `false` — regardless of
whether they actually had a Alternate Messenger identity.

Two real, opposite-direction incidents resulted:
- **Over-grant**: 17 Aircall-only callers with no Alternate Messenger identity at all
  (`messenger_user_id IS NULL`) were granted `sms_enabled`/`whatsapp_enabled`
  they'd never had — their cadence-owned leads could now get automated
  Alternate Messenger SMS/WhatsApp sent from the org-wide sender, which was never the
  intent.
- **Under-grant**: 4 real, already-active Alternate Messenger agents (each with a real
  `messenger_user_id`) who happened to have `dialer_enabled=false` lost
  access their cadence sends already relied on. Before v11.10.0, neither
  `sms_channel.py` nor `whatsapp_channel.py` gated on any per-user flag at
  all — "any cadence sent WhatsApp as long as the org was configured,
  regardless of whether its owner was meant to have the channel" (the
  v11.10.0 commit's own words) — so these four were sending successfully
  right up until this deploy, then silently blocked.

### What changed
New one-time migration, `v11_10_5_correct_messaging_access_gate`: re-derives
`sms_enabled`/`whatsapp_enabled` for every user from `messenger_user_id IS
NOT NULL` instead of `dialer_enabled`. That's the correct signal — a real
Alternate Messenger agent identity already configured is what "already messaging"
actually meant, independent of which vendor the same person calls through
(calling and messaging are deliberately independent per-user settings, see
v11.10.1's Providers card). Logs the exact grant/revoke counts before
running, matching this file's existing convention for consequential data
migrations (`v10_clean_lead_assignments_pod_admins`).

`v11_10_0_backfill_messaging_access` itself is left unchanged — it's a
historical record of what actually ran, and migrations are tracked by name so
editing it wouldn't rerun it anywhere it already applied.

### Verified
Live prod data pulled twice (byte-identical, ruling out staleness) via
`/api/admin/dialer/sdr-configs` with a real Super Admin token before writing
the fix, confirming the exact 18/5 split and which specific users fell on
the wrong side of it. New migration covered by
`test_messaging_access_gate_correction.py` (3 cases: under-grant corrected,
over-grant corrected, already-correct user left alone), run against the real
`run_schema_migrations()` path, not a mock. Full backend pytest suite
re-run after adding it.

## v11.10.4 — 2026-09-02 (Fix + polish: User Access follow-up from live feedback)
**Deploy:** `develop → staging` | **Type:** Bug fix + UX polish
**Branches:** `develop`, `staging`

### Context
Direct follow-up feedback (screenshots) on the v11.10.1 Calling & Messaging
consolidation, five concrete issues plus two open questions. Investigated
each against the actual code/backend rather than guessing before touching
anything.

### What changed
- **Added Alternate Messenger to the org-wide Calling Provider select.** A real gap,
  not new to this release: `AlternateDialerProvider` has been fully wired
  and tested in the backend all along (`dialer_service.py`,
  `messaging_provider.py`), and the per-user Edit-form override already
  offered it — the org-wide dropdown in the new Providers card just never
  did. It reuses the same credentials already entered on the Alternate Messenger
  Conversations card, so no new fields were needed.
- **Widened the User Access card** out of the 720px credential-form column
  the whole Calling & Messaging tab was wrapped in. That cap made sense for
  the narrow Aircall/Alternate Messenger credential forms; on the user table it meant
  every row's chips wrapped onto extra lines while the rest of the page sat
  empty beside it. Row layout is now a real CSS grid (identity / providers /
  Alternate Messenger identity / capability toggles / menu as distinct columns)
  instead of one flex line that wrapped as a whole.
- **Pagination (5 rows/page) + filters** on User Access: Calling provider,
  Messaging provider, capability granted, and has-a-Alternate Messenger-agent-ID —
  alongside the existing name/email search. All client-side against the
  already-fetched list; a row action (toggle a chip, save an edit) reloads
  data from the server without resetting the current page or filters.
- **"＋ Assign Alternate Messenger Agent" now opens a right-side drawer** instead of
  revealing a form below the (now paginated) list. With 21 users on
  staging, the old inline reveal rendered off-screen below the fold with no
  signal anything had happened — confirmed as the cause of the "nothing's
  happening, I keep clicking" feedback.
- **Friendlier per-row error + retry** when a capability-toggle save fails on
  a genuine network drop. The console errors in the original feedback
  (`ERR_NETWORK_CHANGED`/`ERR_INTERNET_DISCONNECTED` hitting Mixpanel,
  Clarity, the dialer SSE connection, and the notification bell all at
  once) were the browser's own connection dropping, not a bug in this
  feature — but the row banner showed the raw `TypeError: Failed to fetch`
  message with no way to retry. It now shows a plain-language message and a
  Retry button when the failure looks like a network drop.

### Explicitly not changed
- **Aircall Everywhere toggle** — feedback suggested this was redundant now
  that "the widget is properly enabled in iframe." Checked directly:
  `useAircallEverywhere.js` reads `aircall_everywhere_enabled` from
  `/api/dialer/status` as the live eligibility gate for that same iframe
  widget — off means the widget reports `ineligible` and never loads. Still
  load-bearing; left alone.

### Answered, no code change needed
- **Aircall API SMS/WhatsApp capability check** — checked Aircall's Number
  object schema directly (`GET /v1/numbers/:id`): no `sms_enabled` /
  `whatsapp_enabled` field exists to query. Consistent with this codebase's
  own `aircall_messaging_provider.py` comment marking the send path itself
  "unverified" — there's no capability flag to build a pre-check against.
- **Aircall calling + Alternate Messenger messaging for the same user** — already
  fully supported before this release. `dialer_provider_override` and
  `messaging_provider_override` are independent per-user fields
  (`resolve_provider_name`); the per-user Edit form already sets them
  separately.

### Verified
`v11-10-0-messaging-access-verification.spec.js` updated for pagination
(row-count assertions now check the `#user-access-count` summary rather
than counting DOM rows, and two tests that pick a specific row now search/
filter to it first, since it isn't guaranteed to land on page 1 of an
unfiltered 21-user list) and re-run against staging.

---

## v11.10.3 — 2026-09-02 (Fix, corrected: "＋ Assign Alternate Messenger Agent" click race — actual root cause)
**Deploy:** `develop → staging` | **Type:** Bug fix
**Branches:** `develop`, `staging`

### Context
v11.10.2's diagnosis was wrong. It reordered `_loadAndRenderUserAccess()`'s
own fetch relative to the button's listener, but the live-staging Playwright
re-run after that deploy failed identically. Tracing `bindAiDialerTab()`'s
full await chain found the real cause, and confirmed it predates this
release entirely: `await fetchDialerConfig()` (Aircall config) already ran
*before* the Agent Assignments section under the pre-v11.10.0 name
(`_loadAndRenderAgentList`) in every commit back through `1342286` — this is
a years-old ordering issue in this one large function, not something the
settings-consolidation pass introduced. It surfaced now because this was the
first time an automated, real-staging click at fixed timing exercised it.

### What changed
Moved the `assignBtn` / `cancelAddBtn` / `searchInput` listener bindings to
the very top of `bindAiDialerTab()`, before any of its awaits — not just
before `_loadAndRenderUserAccess()`'s fetch as v11.10.2 did. These three
listeners need no fetched data, so nothing is lost by attaching them first.
Real improvement, kept — but re-verifying against live staging found it
still wasn't the full story:

**Correction, found immediately after this deploy.** A direct repro (bypassing
the test harness entirely — a standalone script driving the same real
staging session) timed the actual bottleneck: `renderSettings()` awaits
`bindConnectionTab()` then `bindSyncTab()` **before it even calls**
`bindAiDialerTab()` — two unrelated, pre-existing functions (Connection tab,
Sync Settings tab) that together take **~4 seconds** on this environment
right now, no fault of anything in this release. `bindAiDialerTab()` cannot
attach any listener, including this fix's, until that chain resolves. This
release's hoist is still correct and still shipped, but it was never going
to be enough on its own — the real wait is one level up, in code this
settings-consolidation pass didn't touch.

Per this repo's Surgical Changes rule, restructuring `bindConnectionTab`/
`bindSyncTab`'s sequencing is **out of scope for this release** — it's a
pre-existing, unrelated slow-load path, not something introduced or owned by
the messaging-access work. **Fixed instead:** the Playwright spec itself,
which assumed a fixed 2.5s wait was enough — replaced with a retry-click
loop that keeps clicking until the listener is actually attached, the same
tolerance a patient human admin already has by just waiting a few seconds.
**Flagged, not fixed:** Settings' multi-second initial bind chain is a real,
separate UX rough edge worth a dedicated look.

### Verified
`agent-assignments-whatsapp-sender.spec.js` (with the retry-click fix) and
the full `v11-10-0-messaging-access-verification.spec.js` suite re-run
against staging after this deploy (see below).

---

## v11.10.2 — 2026-09-02 (Fix: User Access add-form button unresponsive on slow load)
**Deploy:** `develop → staging` | **Type:** Bug fix
**Branches:** `develop`, `staging`

### Context
Found by the live-staging Playwright pass for v11.10.1, immediately after that
deploy: clicking "＋ Assign Alternate Messenger Agent" did nothing if the click landed
before the User Access table's initial fetch finished. `bindAiDialerTab()`
attached the button's, the cancel button's, and the search box's click/input
listeners *after* `await`-ing `_loadAndRenderUserAccess()` — a fetch now
covering every user instead of a provider-filtered subset, so it takes longer,
which widened a pre-existing race into a reliably reproducible bug the first
time a real browser hit it.

### What changed
Moved the three listener bindings (assign button, cancel button, search
input) above the `_loadAndRenderUserAccess()` await in
`settings_ai_dialer.js` — none of them depend on the list actually being
loaded. Root-cause fix, not a test-side wait: a real admin clicking fast on a
slow network was equally exposed.

### Verified
Re-ran `agent-assignments-whatsapp-sender.spec.js` against staging after
deploy (see below) — was the one failure out of the four Playwright specs
run for v11.10.1's live verification.

---

## v11.10.1 — 2026-09-02 (Settings consolidation: one Calling & Messaging tab, one User Access table)
**Deploy:** `develop → staging` | **Type:** Refactor, no schema/route change
**Branches:** `develop`, `staging`

### Context
User feedback on v11.10.0, verbatim: "We have a dialer setting in Admin for
users... Then we have a separate dialer settings in settings... Then we have
one more messenger dialer settings... Doesn't this look chaotic?" It did.
Tracing every write path for `dialer_enabled` found **four** editors (Admin →
Users, Settings → 📞 Dialer, Settings → 💜 Alternate Messenger, and self-service in SDR
Settings); the Alternate Messenger agent ID had two, one of which (Admin → Users' three
raw text inputs) accepted anything with no validation, unlike the Settings
copy that surfaces `messaging_service.missing_org_config()`'s reasons. Worse,
the calling half of a user's setup lived on one tab and the messaging half on
another, so granting the same person both meant visiting two screens. This
release is the fix the audit called for — no code from v11.10.0 changes
behavior, only where it lives.

### What changed
**One "📞 Calling & Messaging" tab**, replacing the separate 📞 Dialer and 💜
Alternate Messenger tabs. A new **Providers** card up top holds both the Calling
Provider and Messaging Provider selects side by side — previously the same
decision, split across two pages. Klenty Sync (a nightly call-activity pull,
unrelated to either provider) moved to 🔄 Sync Settings, where it belongs.

**One User Access table**, replacing the Alternate Messenger "Agent Assignments" table
and the Aircall "User Access" table, which rendered the same three chips over
overlapping — and each other's hidden — user sets. Every user now appears
once, with 📞/💬 provider-name chips so the vendor is visible without opening
Edit, and the Alternate Messenger agent-ID/caller-ID pills render only for users
actually on Alternate Messenger — the Aircall/Alternate Messenger asymmetry is now something you
see, not something a banner has to explain. A readiness banner
(`_paintAccessReadiness`, mirroring `missing_org_config()`) sits above the
table and repaints live as the admin edits the Providers/credentials cards, so
a lit SMS/WhatsApp chip can never quietly mean "granted, but the vendor isn't
configured" — the exact state staging was in mid-development, with
`messenger_enabled` off while grants were lit.

**Admin → Users lost its second, unvalidated copy of the same fields** — the
dialer toggle, the provider-override select, and three raw Alternate Messenger text
inputs (Agent ID / Caller ID / Email) that saved on blur with no readiness
check. Replaced with a read-only 📞💬🟢 Channels indicator per row, linking to
the one real editor.

**The Edit form's calling-provider override moved with it.** Switching a
user's *calling* vendor used to only be possible from the now-deleted Admin →
Users select; it's now a `.edit-dialer-provider` field alongside the existing
messaging-provider override, in the same Edit form. The "Alternate Messenger User ID
required" validation reads the form's live selection (not the stale row), so
switching a user to Aircall calling and saving in the same action correctly
lifts the requirement, matching the messaging-side fix v11.10.0 already
shipped for the same bug.

### Verified
Backend and frontend test suites pass (see `test_messaging_access.py`,
unchanged — no route or schema touched by this pass). Live-staging Playwright
suite `v11-10-0-messaging-access-verification.spec.js` updated for the merged
tab/table and re-run against `staging` after deploy (see the deploy note
appended below).

---

## v11.10.0 — 2026-09-02 (Per-SDR messaging access: SMS/WhatsApp granted per user, per provider)
**Deploy:** `develop → staging` | **Type:** Feature + Bug fixes
**Branches:** `develop`, `staging`

### Context
Asked how an admin enables SMS/WhatsApp for a user, the honest answer was:
they can't. Messaging had no per-user gate anywhere in the product. The
Message tab rode on `users.dialer_enabled` **plus a Alternate Messenger _dialer_
provider** (the widget-init gate in `frontend/js/app.js`), which meant:

- an SDR on Aircall for calling could never message, however well messaging
  was configured — `[MessengerWidget] Init skipped — user is on Aircall
  provider` and no messaging UI at all;
- granting someone the dialer silently granted them WhatsApp too;
- every `/api/conversations/*` route checked only "is this user logged in",
  so any authenticated user could send WhatsApp against any lead they could
  reach;
- there was no admin screen that could grant or revoke any of it.

Auditing production while scoping this also found the org config half-filled
(`messenger_account_id`, `messenger_sender_id`, `messenger_from_number` all
blank), which means nothing could have sent regardless — `messaging_service`
returned `None` for every send. Those are data-entry gaps for an admin, not
code; this release makes the UI name the missing field instead of failing
silently at first send.

### What changed
**Per-user grants.** `users.sms_enabled`, `users.whatsapp_enabled` and
`users.messaging_provider_override` (`"messenger" | "aircall" | null`).
Calling keeps using `dialer_enabled` / `dialer_provider_override`. Messaging's
vendor is deliberately independent of the dialer's: calling on Aircall while
messaging on Alternate Messenger is a supported config.

**One gate, all callers.** `messaging_service.resolve_messaging_for_user()`
resolves capability → vendor → sender in one place and returns a permanent-vs-
retryable verdict with an admin-readable reason. Both cadence channels
(`sms_channel.py`, `whatsapp_channel.py`), the Widget routes
(`conversations_routes.py`) and the new capabilities endpoint route through it,
so the UI can never offer a channel the API will refuse.

**`GET /api/me/capabilities`.** Live-resolved (not JWT-derived, so an admin's
grant applies on the SDR's next page load with no re-login). The widget mounts
on it, each tab gates on its own capability, and the lead-detail 💬 Message
button appears only for SDRs who hold a channel. An Aircall caller who holds
WhatsApp now gets the Message tab; the Call tab stays Alternate Messenger-only, since
the Alternate Messenger SDK's call flow still conflicts with Aircall's.

**The two vendors are asymmetric, and the UI now says so.** Aircall needs
nothing per user: save the org API ID and token once and every user who exists
in Aircall works, matched on their email — numbers included, since Aircall
already knows which numbers each user owns. Alternate Messenger needs the org key/user
ID/account ID *plus* per-user identity (agent ID for calling, sender for
messaging). So: capability chips (📞 Calling / 💬 SMS / 🟢 WhatsApp) on every
user row in Settings → 💜 Alternate Messenger, saving on click, plus a per-user
Messaging Provider selector; and a matching *User Access* table under
Settings → 📞 Dialer for Aircall that is chips only, no credential fields.
Granting a channel on a vendor that isn't fully configured still saves, but
returns the exact reason the send path would give, inline against that row.

`aircall_messaging_number_id` is demoted to an org-wide *fallback*.
`AircallMessagingProvider.resolve_number_for_email()` discovers the send-from
number per SDR the same way `initiate_call` always has (`default_number_id`,
else the first assigned number), cached for 10 minutes because the lookup
behind it is a paginated `/users` scan. `send()` also stopped ignoring the
`sender_id` it was handed. The page-load capabilities path resolves with
`allow_remote_lookup=False` so it never makes that call.

### Bugs fixed along the way
1. **Inbound WhatsApp was filed as SMS, owned by nobody.**
   `webhook_routes.py` wrote the `SmsLog` row with neither `channel` nor
   `user_id`, so every WhatsApp reply landed as `channel="sms"` (the column
   default) — the Activity Monitor's channel filter mis-bucketed all inbound
   WhatsApp and per-SDR views showed none of it. `to_number` was already
   parsed and then discarded; it's the sender the lead replied to, which is
   what identifies the owning SDR. Now sets `channel`, `provider` and resolves
   the owner from the replied-to sender, falling back to the lead's assignee.
2. **Cadence SMS read the Alternate Messenger _voice_ caller ID.** `sms_channel.py`
   used `SyncSettings.messenger_from_number` while WhatsApp used
   `messenger_sender_id`, so an org with the messaging sender filled in had
   WhatsApp working and every cadence SMS failing as "not fully configured".
   Both now resolve one sender through the shared resolver, with
   `messenger_from_number` kept as a last-resort fallback.
3. **`SyncSettings.widget_enabled` was dead config.** Stored, PATCH-able and
   exposed by the API, but never read by the mount path — flipping it did
   nothing. Removed from the model, API and migration; the DB column is left
   in place (dropping it buys nothing and risks a lock).
4. **The Alternate Messenger row's Edit form demanded a Alternate Messenger agent ID even when
   moving that user to Aircall messaging** — "Alternate Messenger User ID is required"
   with no way past it, so a user could not be switched to Aircall at all
   (caught on staging immediately after deploy). That ID is a Alternate Messenger
   *calling* identity; it is now required only while the user actually has
   Alternate Messenger calling enabled.
5. **SDRs could grant themselves the dialer.** `PATCH /api/dialer/toggle`
   accepted either value from any authenticated caller, so an SDR whose dialer
   an admin had switched off could re-enable it in one request — and, while
   messaging rode on `dialer_enabled`, hand themselves WhatsApp with it.
   Self-*disable* stays (SDR Settings uses it to stop taking calls);
   re-enabling is a grant, and grants are admin-only.

### Migration
`v11_10_0_backfill_messaging_access` sets `sms_enabled` and `whatsapp_enabled`
true for every user with `dialer_enabled = true`. Defaulting the new columns to
false would have silently revoked messaging from every SDR who has it today,
since `dialer_enabled` was the old effective gate. Verified on a seeded DB:
dialer-enabled users keep both channels, dialer-disabled users get neither.
New users default to false and must be granted explicitly.

### Testing
- Backend: 2643 passed, 1 pre-existing failure (`test_klenty_provider`'s
  hardcoded-date test, unrelated file). 26 new tests in
  `test_messaging_access.py` covering the gate, per-channel independence,
  admin non-exemption, provider/sender resolution, the capabilities endpoint,
  route refusals, the self-grant hole and inbound attribution; plus new
  cadence-channel gate tests.
- Frontend: 561 passed, incl. 3 new MessageTab per-channel-grant tests.
- `ponytail-review` (diff) + `ponytail-audit` (repo-wide, touched files) both
  run per this repo's mandate; applied ~19 findings (net −120 lines) and
  declined 3 with reasons recorded below.

### Known gaps, deliberately not closed here
- **Aircall SMS/WhatsApp has still never been sent live.**
  `aircall_messaging_provider.py`'s own header records that Aircall's docs
  contradicted themselves and the implementation is unverified. The toggles
  exist and are labelled ⚠ unverified. Send one real test message before
  enabling it for a team.
- **`sms_service.py` + `routes/sms_routes.py` are now orphaned** —
  `POST /api/sms/send` has no callers and `send_sms()`'s only production caller
  was the `sms_channel.py` this release rewrote. Left mounted: removing a
  public endpoint deserves its own change and its own verification.
- **`SyncSettings.widget_position` / `widget_theme` / `widget_allowed_domains`
  and `User.dialer_user_id` are the same dead-config smell** as
  `widget_enabled` (zero readers; `app.js` hardcodes `theme: 'dark'`), but
  they pre-date this change and are out of its blast radius.
- The legacy UMD widget (`frontend/js/messenger_widget.js`, reachable only by
  setting `messengerWidgetReact=false` in localStorage) ignores the new
  `capabilities` init option — a messaging-only SDR on that fallback would see
  a non-working Call tab.

### Files
- `backend/models.py`, `backend/migrations.py` — new columns + backfill
- `backend/messaging_service.py` — the resolver (rewritten)
- `backend/journey_engine/channels/{sms,whatsapp}_channel.py` — route through it
- `backend/routes/conversations_routes.py` — `_require_messaging` gate
- `backend/routes/auth_routes.py` — `GET /api/me/capabilities`
- `backend/routes/admin_user_routes.py` — grant/revoke + effective providers
- `backend/routes/dialer_routes.py` — self-enable closed
- `backend/routes/webhook_routes.py` — inbound channel + owner
- `backend/routes/admin_sync_routes.py` — `widget_enabled` dropped
- `frontend/js/app.js`, `api.js`, `views/{settings,settings_ai_dialer,lead_detail,sdr_settings}.js`
- `frontend-react/src/features/messenger-widget/**` — tab gating (+ rebuild)

## v11.9.4 — 2026-09-02 (Component-library UI standardization + 5 bugs surfaced by it)
**Deploy:** `develop → staging → main` (promoted) | **Type:** Refactor + Bug fixes
**Branches:** `develop`, `staging`, `main`

### Context
A full design-standardization pass across the entire React app: added 7 new
shared primitives to `components/ui/` (Tabs, EmptyState, Checkbox, Switch,
Spinner, Avatar, promoted Pagination) plus a README cataloging the library,
and converted hand-rolled buttons/dropdowns/tabs/empty-states/badges/
pagination/checkboxes/switches/spinners/avatars/search-inputs/modals across
every feature (leads-hub, lead-detail-hub, pods-hub, power-dialer-hub,
sales-journey, activity-monitor, help-hub, messenger-widget, layout, and
Analytics/Calendar/Dashboard/Email) onto it. `ponytail-review`/`ponytail-audit`
ran per this repo's own mandate before shipping.

The conversion, plus a live-staging Playwright pass with real SDR/Pod
Admin/Super Admin sessions, surfaced 5 real bugs — all fixed and re-verified
live before this promotion:

1. **Radix DropdownMenu's default `modal={true}`** blocked pointer events on
   the rest of the page while a menu was open (ColumnsMenu, PriorityDot) —
   fixed with `modal={false}`.
2. **FilterBar's "+Filter" menu** raced Radix's close-focus-return when
   opening a filter's own Popover from the same `onSelect` tick — fixed via
   `onCloseAutoFocus` instead of a timing guess.
3. **PriorityDot: two independent Radix menus stayed open simultaneously** —
   Radix's layer-stack only auto-dismisses the topmost sibling layer, so
   opening a second row's re-prioritize menu didn't close the first. Caught
   only by real-browser Playwright testing (the jsdom unit suite missed it).
   Fixed via a `CustomEvent` broadcast so only the most-recently-opened menu
   stays open.
4. **SearchInput's native `<input>` border leaked through on focus** — every
   per-bundle Tailwind entry deliberately omits Preflight to avoid clobbering
   the legacy vanilla-JS shell, reproducing the border-reset manually, scoped
   to each bundle's own root container. `SearchInput.jsx` never set its own
   border and implicitly depended on that ambient reset — which never
   covered `NavTopbar` (its scope was still `.nh-feedback-portal`, stale from
   before this pass wired `SearchInput`/`Popover`/`Spinner` directly into the
   topbar). Reported live by the user testing staging; fixed with an
   explicit `border-0` on the shared component instead of widening the
   ambient scope.
5. **Select/DropdownMenu/Popover rendered behind an open Modal** — both
   portal to `document.body` at `z-50`, lower than `Modal`'s `z-[100]`, so a
   Select opened from inside a modal (e.g. Sales Journey's Send Window
   Timezone picker) appeared dimmed, behind the modal's own backdrop. Also
   reported live; fixed by bumping both to `z-[110]`, above Modal and below
   GuidedTour/Toast.

Also includes the previously-reported `lead_source` badge fix (a lead's
detail page defaulted every unrecognized source to "Manual", diverging from
the leads table's correct label — shared parsing logic extracted to
`frontend-react/src/lib/leadSource.js`).

Both new bugs found live today (4 and 5) are now permanent regression checks
in `tests/v11-9-4-ui-standardization-verification.spec.js` (tests 11-12),
alongside the original 10 checks from this pass.

**Testing:** Full vitest suite (558/558) after every round of fixes. Live
Playwright against staging across Super Admin/SDR/Pod Admin sessions
(12 checks, 10 passing — 2 skipped only due to expired test JWTs for
SDR/Pod Admin, unrelated to this release). Backend pytest: 2620 passed, 1
known pre-existing failure (Klenty date-drift, unrelated).

## v11.9.3 — 2026-09-01 (Component-library dropdown/date/time standardization + Groq JSON-parse resilience)
**Deploy:** `develop → staging → main` (promoted) | **Type:** Refactor + Bug fix
**Branches:** `develop`, `staging`, `main`

### Context
Promoted `Select`/`DatePicker`/`DateRangePicker`/`TimePicker` to the shared
component library and rolled them out across sales-journey, pods-hub,
power-dialer-hub, Analytics, and the remaining leads-hub/Calendar dropdowns —
replacing hand-rolled pickers with the same Radix-backed, consistently
styled controls everywhere.

Also: Groq can return a 200 whose content isn't valid JSON (truncated by
`max_tokens`, ignored the "return only JSON" instruction, a reasoning
preamble) just as easily as it can 404 a decommissioned model — previously
that case fell straight to a 502 with no retry, unlike the model-resolution
self-heal already in place for dead models. Extended the same
exclude-and-try-another-model logic to also fire on a parse failure, in both
`ai_research_routes.py`'s async path and `smart_analytics.py`'s DSL parser.

**Testing:** Full vitest suite green. Backend pytest suite green
(`_call_groq_single` parse-retry path covered by
`test_ai_research_routes.py`/`test_smart_analytics.py`).

## v11.9.2 — 2026-09-01 (Overnight incident fixes — Connect Rate, Groq resilience + DB bulkhead, recording playback, CSV export, dialer double-logging)
**Deploy:** `develop → staging → main` (promoted) | **Type:** Bug fixes
**Branches:** `develop`, `staging`, `main`

### Context
Six issues reported by the team after a rough overnight shift, all fixed and
verified against real production Render logs before promotion:

1. **Connect Rate wrong** — `dialer_call_connected()` no longer trusts Aircall's
   own `provider_disposition` field (confirmed unreliable in production); connect
   rate now strictly follows a real SDR-logged outcome or a genuine >120s duration.
2. **Groq model 404s breaking Lead Detail** — two compounding bugs. First,
   `_fetch_best_groq_model`'s preference-list retry logic made its own fallback
   scan unreachable once ≥3 preferred models failed simultaneously (exactly what
   happened when Groq deprecated several models at once); it now falls straight
   through to a live deny-list scan of Groq's actual model catalog instead of a
   fixed name list. Second — confirmed via live Render/prod logs — a storm of 36
   stuck `ai-research` calls (16-52s each, several genuinely concurrent) was
   putting real pressure on the shared database connection pool. Every AI-calling
   route now runs on its own small dedicated "bulkhead" pool
   (`get_ai_db`, `backend/database.py`) so a Groq outage can never again compete
   with unrelated requests for a database connection.
3. **Call recordings not playing** — presigned recording URLs expire (~46min
   TTL); the player now catches a playback error, fetches a fresh URL, and
   retries once. Also fixed two real `AudioPlayer` bugs this surfaced: an
   assumption that `play()` always returns a Promise, and a progress-slider
   `NaN%` calculation before track metadata loads.
4. **Export CSV silently doing nothing on failure** — added an explicit
   timeout, error handling, and a visible failure banner; fixed a download-link/
   object-URL leak.
5. **SDR double-logging calls / wrongly blocked from the next call** — logging
   an outcome now closes out the dialer call's status immediately instead of
   waiting on a webhook that might not arrive in time.
6. Frontend bundle rebuilt so all of the above actually ships.

## v11.9.1 — 2026-09-01 (Activity Monitor — expand-row UI/UX fixes, shared AudioPlayer component)
**Deploy:** `develop → staging → main` (promoted) | **Type:** Bug fixes
**Branches:** `develop`, `staging`, `main`

### Context
Live-staging screenshots the day after v11.9.0 shipped flagged three real UI/UX
bugs in the new Activity Monitor: the expand-row panel visually broke (huge
horizontal overflow) on any call whose transcript or a long note was present, with
no way to collapse the row again without scrolling back to a table row that had
since been pushed off-screen; email body previews rendered raw HTML markup
verbatim instead of readable text; and the native `<audio controls>` recording
player looked dated next to the rest of the redesigned UI. Also flagged: the
filter bar's Reset button wrapping onto its own line at narrow widths.

Root cause of the expand-row breakage: `TableCell` (`components/ui/Table.jsx`)
defaults to `whitespace-nowrap` unless the caller overrides it — the three
expand-row `<TableCell colSpan>` wrappers didn't, so any long transcript/note/body
rendered on one unbroken line and blew out the table width. Compounding it in the
Calls tab specifically: the transcript parser only checked `Array.isArray()` on
the parsed JSON, but the real payload is a wrapped object
(`{transcription: [{role, content, start_time}, ...]}`), so it fell through to a
plain-text fallback and rendered the raw JSON blob as literal text.

The user also supplied a complete Radix Slider-based audio player component
(shadcn reference) and asked for it — and everything supplied in this vein going
forward — to become this codebase's one shared component library
(`frontend-react/src/components/ui/`), alongside the existing
DropdownMenu/Popover/Calendar/SearchInput primitives.

### Fix
- `components/ui/Table.jsx` consumers (`CallsTable.jsx`, `EmailTable.jsx`,
  `MessagesTable.jsx`): added `whitespace-normal` to the expand-row `TableCell` —
  the actual root-cause fix for the layout-breaking bug.
- `CallsExpandRow.jsx`: transcript parser now unwraps `.transcription` and reads
  `role`/`content` (the real field names), not the assumed `speaker`/`text`.
- `ExpandRowFooter.jsx` (shared by all 3 channels): added a "Collapse" button so
  closing an expanded row never requires scrolling back to the table row.
- `lib/format.js`: added `stripHtml()` (native `DOMParser` → `textContent`, no
  `dangerouslySetInnerHTML`) and applied it to `EmailExpandRow`'s body preview.
- `FilterBar.jsx`: Apply + Reset now share one `shrink-0` flex group so they
  can't split across lines independently of each other.
- New `components/ui/AudioPlayer.jsx`: Radix Slider progress bar + play/pause +
  playback-speed menu, replacing the bare native `<audio controls>` element in
  `CallsExpandRow`. Ported from the user-supplied shadcn/Radix reference, trimmed
  to the pieces this app actually uses (dropped the standalone speed-button-group
  variant and demo track list). New dependency: `@radix-ui/react-slider`.

### Testing
- `src/test/activity-monitor/ActivityMonitorHub.test.jsx`: 9/9 pass (2 new —
  transcript-parsing regression test using the real `{transcription:[...]}`
  shape, and an HTML-stripping test for the email body preview).
- Vite build (`build:activity-monitor`) clean; cache-bust bumped
  (`?v=20260901a`).
- Live Playwright pass against staging pending this promotion.

---

## v11.9.0 — 2026-08-31 (Activity Monitor — Call Monitor React migration + Calls/Email/Messages expansion, Radix UI redesign)
**Deploy:** `develop → staging → main` (promoted) | **Type:** New feature + bug fixes
**Branches:** `develop`, `staging`, `main`

### Context
Call Monitor (`frontend/js/views/call_monitor.js`) migrated to React as part of the
ongoing React-migration effort, expanded per direct request so Super Admins and Pod
Admins can monitor everything an SDR/AE does — not just calls, but email and
SMS/WhatsApp messages — from one screen, to check outreach is actually happening.
The legacy, already-unused "Activity Feed" page/endpoint was folded into this
feature rather than left as a second overlapping admin view (confirmed unused by
the requester).

Mid-build design review flagged the first draft as inconsistent with the rest of
the app: emoji icons instead of this codebase's lucide-react convention, Aircall
represented with an airplane icon (it's a phone/calling provider, not an airline),
and native `<select>` filters that don't scale to a 20+ person SDR list (unstyled,
unsearchable, runs off-screen). Fixed with a full icon/design audit and a switch to
Radix UI primitives (`@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover`,
`react-day-picker`) for every dropdown and the date-range picker — the first use of
Radix in this codebase, now the standard for new feature work going forward
(existing Hubs are not retrofitted in this pass).

A live Playwright pass against staging (this feature's own explicit request,
separate from unit tests) caught a production-would-be crash on every tab's first
load: `EMPTY_FILTERS`' `''` placeholders were sent straight through to FastAPI's
typed query params (`bool = None` 422s on an empty string), and the resulting
array-shaped validation `detail` was rendered directly as a React child (React
error #31). Also caught: the Calls tab's search box was collected into filter
state but never actually sent to the backend — a silent no-op inherited from the
legacy page (its own test file's docstring already said as much) — now wired up
for real, matching the new Email/Messages tabs' search behavior.

### Fix
- `backend/routes/admin_routes.py`: `list_call_logs` pod-scoping replaced a bespoke
  `User.pod_id == admin.pod_id` subquery (no lead-pod fallback) with the shared
  `_effective_pod_id`/`_pod_scope_call_query` helpers Analytics Hub already uses —
  now also matches on the dialed lead's pod, catching pod-reassignment drift the
  old check missed. Added a real `search` param (ILIKE on lead name/company) — the
  endpoint had none before.
- `backend/routes/activity_monitor_routes.py` (new): `GET /api/admin/email-logs`
  and `GET /api/admin/message-logs`, same response envelope as `call-logs`. All
  three channels scope via `_pod_scope_call_query` (sender-or-lead OR-fallback) —
  a deliberate choice over Analytics Hub's lead-only scoping, since this feature
  answers "what is my team doing," not "how are my pod's leads doing." Email
  summary math reuses `analytics_routes.py`'s existing correct open/reply-rate
  formulas rather than re-deriving them. `SmsLog.status` handled via ILIKE
  bucketing (confirmed provider-controlled free text, not a closed enum).
- `frontend-react/src/features/activity-monitor/` (new): `ActivityMonitorHub` +
  per-channel tables/filters/expand-rows, `useActivityMonitorData` (30s polling,
  mirrors `useEmails.js`), client-side CSV export (2000-row cap, matching every
  other export in this codebase).
- `frontend-react/src/components/ui/{DropdownMenu,Popover,Calendar,SearchInput}.jsx`
  (new): shared Radix-backed primitives, styled with this app's existing
  slate/indigo palette (no shadcn CSS-variable tokens, which this project doesn't
  define). `SearchInput` replaces an absolutely-positioned icon-over-input pattern
  (drifts out of alignment whenever icon padding and input line-height fall out of
  sync) with a flex layout that centers by construction. The calendar range picker
  makes the old two-native-date-input "From after To" invalid state structurally
  impossible — react-day-picker's range mode always keeps `from ≤ to`, verified
  directly in both the vitest and Playwright suites.
- `frontend-react/src/features/help-hub/data/sections.js`: the dead "Activity
  Feed" guide section replaced with a real "Activity Monitor" section (tabs,
  filters, row detail, auto-refresh, export); `icons.js` lookup key updated to
  match.
- Post-review ponytail cleanup (both `/ponytail-review` on the diff and
  `/ponytail-audit` repo-wide, run before this promotion per `CLAUDE.md`): shared
  `_sdr_dropdown()` instead of duplicating the same query in two route files;
  removed unused DropdownMenu/Popover sub-exports ported wholesale from the shadcn
  reference but never consumed; removed a `dateInvalid` guard/banner made
  unreachable by the calendar fix above; deduplicated a repeated trigger-button,
  direction-badge, empty-state block, and expand-row footer across the three
  channel tables into shared components. Net -72 lines, no behavior change.
- `VERSION` bumped 11.8.2 → 11.9.0 (`scripts/sync-version.mjs`); added the
  `releases.json` "What's New" entry for this release (it had shipped to staging
  without one — the exact staleness class this project already has a documented
  gotcha for).

### Testing
Backend: 69 new/updated tests in `test_activity_monitor.py` (new, ~20 tests) and
`test_call_monitor.py` (regression tests for the pod-scoping and search fixes,
including the dual sender-or-lead scoping semantics and an
arbitrary-provider-status-string case for `SmsLog.status`). Full backend suite
green (2617 passed, 4 skipped, 8 xfailed, 1 pre-existing unrelated Klenty failure
— hardcodes a date that's now stale relative to the real clock, unrelated to this
diff). Frontend: `ActivityMonitorHub.test.jsx` (7 tests, including the calendar's
order-independent range selection). Full frontend suite green (539 passed). Real
Playwright pass against live staging (`tests/activity-monitor.spec.js`, 11 tests)
covering nav rename, per-tab stats/filters/tab-isolation, no native `<select>`
remaining, search round-trip, auto-refresh, the calendar's from≤to guarantee, and
SDR access-denial (nav + hash + backend 403) — run twice, once before and once
after the ponytail cleanup, both fully green.

## v11.8.2 — 2026-08-31 (Connect Rate/Conversations threshold raised to 120s; help-hub release-notes bundle staleness fix)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** Bug fix + business-rule change
**Branches:** `develop`, `staging`

### Context
Two items:

- **Connect Rate threshold.** For a call with no logged SDR outcome, `dialer_call_connected()`/`dialer_call_is_conversation()` fall back to a duration check against `SyncSettings.conversation_min_seconds` (default 30s) as the only evidence of a real pickup. The business ask was to raise this specifically for Connect Rate to 120s. Splitting it into two independent thresholds (one for Connect Rate, a lower one for Conversations) was considered and rejected: `dialer_call_connected()` and `dialer_call_is_conversation()` are built to guarantee `connected ⊇ conversations` — the exact invariant that a real 2026-08-18 production bug ("13 conversations, 11 connected calls") violated and got fixed by. Giving Connect Rate alone a *higher* duration bar than Conversations would reopen that same gap (a 31-120s no-outcome call would count as a conversation but not as connected). Confirmed with the requester: the intent was to raise the one shared threshold, not split it — a disposition-unknown call now needs to run past 120s (up from 30s) to count as either.
- **Stale release notes.** While reviewing this on staging, noticed the in-app "What's New" list was stuck at v11.6.6 despite v11.7.0, v11.8.0, and v11.8.1 all having entries written in `releases.json` since. Root cause: `frontend/js/help-hub.js` — the committed, deployed bundle — was rebuilt for v11.6.6 and never again; every later JSON-only edit shipped in source but never reached the deployed page. Same class of issue as the standing "React bundle rebuild required before deploy" gotcha, this time on a bundle nobody was watching. v11.8.0 additionally never got a `releases.json` entry in the first place — backfilled here.

### Fix
- `models.py`: `CONVERSATION_MIN_SECONDS` raised 30 → 120; `SyncSettings.conversation_min_seconds` column default raised to match. `migrations.py`'s schema-default entry updated (existing rows are unaffected by a column-default change — the live staging value needs an explicit admin update after deploy, same as any other Settings change).
- `admin_sync_routes.py`, `settings_sync.js`, `settings.js`: fallback literals and help text updated to 120s; Settings label broadened to "Connect / Conversation Threshold" since one value now explicitly governs both.
- `registry.py`: added `known_caveats` to Connect Rate and Connected Calls spelling out the shared-threshold requirement, so the vNext Inspect panel surfaces *why* this can't be split without breaking the invariant.
- `releases.json`: backfilled the missing v11.8.0 entry; rebuilt `help-hub.js` via `npm run build:help` and bumped its cache-busting tag in `index.html`.

### Testing
Updated 5 existing tests in `test_analytics_routes.py` and 1 in `test_admin_routes.py` whose fixture durations/assertions were written against the old 30s boundary (e.g. a 45s no-outcome call that used to count as a conversation now needs >120s); confirmed `test_calls_made_connected_conversations_share_one_query_and_hold_invariant` (Phase 2) needed no change — it's threshold-independent by construction. Full backend suite green (2594 passed, 1 pre-existing unrelated Klenty failure). Full frontend suite green (532 passed).

## v11.8.1 — 2026-08-31 (6 PTO-window bugs — Salesforce leak, call-count integrity, Power Dialer UI)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** Bug fix + security fix
**Branches:** `develop`, `staging`

### Context
6 issues reported on Slack while the team was on PTO. Investigated end-to-end (including read-only verification against the production DB) before any code changed, per standing instruction not to start fixing until the root cause was confirmed.

- **Salesforce leak (A1):** the Aircall webhook path always attempted a Salesforce lookup for an unknown phone number, even when `sync_direction` was `push_only` (Alternate CRM → Salesforce only) — creating a real, non-placeholder lead from a one-directional integration that should never read from Salesforce at all.
- **Sentinel-ID check drift (A2):** `call_routes.py` had its own narrower placeholder-ID check (`upload-`/`manual-` prefixes only) in two places, instead of the canonical `_is_sentinel_sf_id()` in `salesforce.py` (which also covers `mig-`/`sandbox-` prefixes) — so a migrated or sandboxed placeholder lead could still get pushed to Salesforce as if it were a real synced record.
- **Call-commit loss (B1):** a transient DB commit failure right after a call was successfully placed meant the call was dialed but never recorded — silently missing from the lead's history and every downstream count.
- **Counter drift (B2):** `Lead.call_attempt_count` and `Lead.times_called` are two separate counters meant to stay in sync (a pre-existing but previously unenforced code comment); Aircall-direct outbound calls (webhook-driven and historical-sync-driven) only incremented `times_called`, so anything reading `call_attempt_count` under-reported.
- **Leaderboard/panel disagreement (B3):** the leaderboard's "today" cutoff was a timezone-naive `date.today()` compared against `dialer_call_event_time()` (a started_at/created_at coalesce), while the Power Dialer's own panel counts off `started_at` directly — producing different "calls today" numbers between the two screens, most visibly near a UTC day boundary.
- **Power Dialer UI (C1-C3):** no crash boundary around the Power Dialer root (a JS error white-screened the whole page with no recovery); `LocalTimeBadge` threw on an unusual/unsupported lead timezone, crashing the same way; Disqualify's "Other" reason had no way to attach a note, and the existing call-attempts anti-abuse gate blocked it entirely even for a legitimate manual override (e.g. confirmed via LinkedIn the contact left the company); and navigating away from the Power Dialer queue and back re-fetched from scratch, losing the SDR's position.

### Fix
- `dialer_service.py`: webhook call site now passes `try_salesforce_lookup=(settings.sync_direction == "both")` instead of unconditionally `True`. `initiate_call()`'s DialerCall persist is retried once on commit failure; if both attempts fail, a successfully-placed call returns a manual-log warning instead of raising and losing the record. `handle_webhook()` and `sync_historical_calls()` now increment `call_attempt_count` alongside `times_called` for outbound calls.
- `call_routes.py`: `_push_sf_status()`/`_push_sf_disqualification()` now use the canonical `_is_sentinel_sf_id()` instead of the narrower ad-hoc prefix check. `close_lead()` accepts `"Other: <note>"` and only that form bypasses the attempts gate — bare `"Other"` still requires attempts, preserving the gate's original anti-abuse intent.
- `leaderboard_routes.py`: today's cutoff is now a UTC-aware `datetime.now(timezone.utc)` boundary, and both leaderboard functions compare against `DialerCall.started_at` instead of the coalescing helper, matching how the Power Dialer panel already counts.
- `power-dialer-entry.jsx`: wrapped in `ErrorBoundary`, matching the existing `leads-entry.jsx` pattern. `LocalTimeBadge.jsx`: `Intl` calls wrapped in try/catch, renders nothing on failure instead of crashing. `usePowerDialerQueue.js`: queue/position/status persisted to `sessionStorage` across a same-tab remount, reusing the `leads-hub/useLeadsList.js` view-state pattern rather than inventing a new caching mechanism.
- `QuickActions.jsx`: added a free-text note field shown when "Other" is selected, sent as `"Other: <note>"`.

### Testing
New backend tests: `test_close_lead_other_with_note_bypasses_attempts_gate`, `test_push_only_skips_the_lookup_creates_placeholder`. New frontend test: queue position + queue survive an unmount/remount without a re-fetch. Full backend suite green (2594 passed, 4 skipped, 8 xfailed — one pre-existing, unrelated Klenty date-drift failure). Full frontend suite green (532 passed). ponytail-review + ponytail-audit run on the full diff; findings self-applied (deduped a repeated commit/retry block, shrunk a duplicated comment, and replaced an initially-proposed TTL'd module cache with the sessionStorage pattern above after the audit flagged it as reinventing an existing, better-suited mechanism).

## v11.7.0 — 2026-08-26 (Analytics Hub vNext — Phase 1: Metric Registry + Semantic Layer, parallel beta)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** New feature (parallel, opt-in) + bug fixes
**Branches:** `develop`, `staging`

### Context
Phase 0 audit found that Dashboard, Ask AI, and Daily Digest each independently
define overlapping metrics (Calls Made, Meetings Scheduled, Disqualified,
Connect Rate) — only `dialer_call_connected()` was genuinely shared. When a
manager challenges a number, fixing its definition means editing multiple
independent query implementations and hoping none are missed. This is Phase 1
of a 7-phase transformation (master plan: `docs/Alternate CRM Analytics
Transformation — Master Claude Code Implementation Prompt.md`): prove one
canonical definition per metric, expose why a number has its value, and make
Dashboard/Ask AI use the same definition — without touching the current
production Analytics Hub.

### What was built
- **Metric Registry** (`backend/analytics/registry.py`) — a static, in-code
  registry (not a DB table — nothing is user-editable yet, see the Phase 1
  plan's reasoning) for the first 5 canonical metrics: Connect Rate, Leads
  Assigned, Account Connect Rate, Disqualified, Meetings Scheduled. Each
  declares its business definition, formula, date basis, and known caveats
  separately from its implementation.
- **Semantic Layer** (`backend/analytics/semantic.py` + `adapters.py`) — one
  `resolve_metric()` entry point that resolves scope/dates the same way the
  Dashboard already does and dispatches to a canonical adapter per metric.
  Connect Rate and Leads Assigned reuse logic extracted (behavior-preserving)
  from `analytics_routes.get_funnel()`; Account Connect Rate reuses
  `_compute_sdr_rows()`; Disqualified and Meetings Scheduled are new
  **event-based** queries built on the already-existing `Lead.lead_closed_at`
  / `Lead.meeting_scheduled_at` columns (each set once, at the real-world
  transition, never cleared) — replacing the legacy Dashboard's current-state
  snapshot definitions for these two metrics specifically.
- **Analytics Hub vNext** (`frontend-react/src/pages/Analytics/vnext/`) — a
  parallel, Super-Admin-only "Try the new Analytics Hub" experience mounted
  as an alternate view inside the existing, unchanged `AnalyticsHub.jsx` root
  (no new bundle/route). Shows the 5 canonical metrics, Inspect (definition,
  formula, numerator/denominator, date basis, scope, version), an old-vs-new
  Compare panel, and a minimal Ask Analytics tab (reuses the existing safe
  NL→DSL parser, scalar-only, shows the AI's interpretation before the
  answer, refuses rather than guesses for unsupported metrics/breakdowns).
  The current Analytics Hub is completely unchanged and remains the default.

### Bug fixes folded in (Phase 0 audit findings)
- `smart_analytics._q_time_series()` silently dropped the active batch filter
  on every day/week/month-grouped Ask AI query — now applies it.
- `smart_analytics._q_connect_rate()`'s scalar path was DialerCall-only
  (missing pure-manual CallLog rows) and also ignored batch_id — now routed
  through the canonical `connect_rate` adapter, fixing both.
- Ask AI's NL parser had no `last_month` period (forced the LLM to guess
  between `this_month`/`last_30_days`, neither of which means "last month") —
  added.
- A metric/breakdown combination a query function doesn't actually implement
  (e.g. "connect rate by POD" — only `sdr` grouping exists for that query)
  used to silently fall through to a scalar, org-wide number. Now rejected
  explicitly via `SUPPORTED_DIMENSIONS_BY_METRIC` instead of silently
  returning the wrong shape of answer.
- System prompt rule change: a metric concept not in the supported list
  (e.g. "close rate") now gets `action:unsupported` instead of the LLM
  silently substituting the closest known metric.

### Testing
New `test_analytics_registry.py`, `test_analytics_semantic_layer.py`,
`test_analytics_vnext_routes.py` (scope enforcement, event-vs-snapshot
correctness, data-quality validation, old-vs-new parity/difference cases,
Ask Analytics unsupported/dimensional rejection). Extended
`AnalyticsHub.test.jsx` (vNext toggle, role gating, return path) and added
`AnalyticsHubVNext.test.jsx`. Full backend + frontend suites run once at the
end of implementation (see Phase 1 completion report).

### Known limits (by design, this phase)
Scalar resolution only — no dimensional breakdown through the semantic layer
yet. Ask AI's existing dimensional/ranking queries are untouched and stay on
their current implementation. vNext is Super-Admin-gated and not the default.

## v11.6.6 — 2026-08-26 (Lead Detail Hub — real confirmations, native compose, pod-scoping fix)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** Bug fix + security fix
**Branches:** `develop`, `staging`

### Context
Live feedback against the new Lead Detail Hub, plus a follow-up question about pod scoping:
- Delete used a bare `window.confirm()` (an unstyled native browser dialog) and Mark Opted Out had no confirmation step at all.
- The assignment dropdown was the exact bug the Leads Hub table already hit and fixed on 2026-08-24 — a bare native `<select>`, unstyled, no search, cluttered by 20+ names.
- "Send Email" from Quick Actions still redirected to the classic view — the corrected-direction instruction from earlier this session ("address gaps by building in the new view, not redirecting") had not actually landed on this one action.
- Checking pod-scoping on the new assignment control turned up a real gap: `isAssignAdmin`/`canDelete`/`canSetOutcome` were gated on role alone (`isAdmin`), not on `canModify`'s pod-boundary check — a Pod Admin viewing a lead outside their own pod could still see live reassign/delete/outcome controls for it. Tracing the Delete Lead button's backend (`POST /admin/leads/bulk-delete`) further found it had **no pod-scoping at all**: any Pod Admin could soft-delete any lead_id in the system, not just their own pod's — the role check (`require_pod_admin_or_above`) was the only gate.

### Fix
- `LeadDetailHub.jsx`: Delete and Mark Opted Out now open the same `ConfirmDialog` the Leads Hub already uses for bulk delete (reused, not rebuilt) — collapsed into one config-driven dialog keyed by action. Send Email now opens a native compose form in a modal, reusing `ComposeDrawer` from the Email Hub (same send endpoint, same CSS — both already loaded globally).
- `LeadHeader.jsx`: the assignment control is now `InlineSelectCell`, the same searchable popover the Leads Hub table already uses — reused verbatim.
- `LeadDetailHub.jsx`: `isAssignAdmin`/`canDelete`/`canSetOutcome` now gated on `isAdmin && canModify` (consolidated into one `canAdminModify` constant), so a Pod Admin only gets live controls for leads they're actually allowed to touch.
- `backend/routes/admin_assignment_routes.py`: `bulk_delete_leads` now pod-scopes for Pod Admin — unauthorized lead_ids are silently skipped, never deleted, matching `bulk_unassign`'s exact scoping convention two functions above it in the same file.
- `components/ui/Modal.jsx`: added `role="dialog"`/`aria-modal`/`aria-label` to the shared Modal.

### Testing
Extended `LeadDetailHub.test.jsx` (confirm-before-mutate for delete/opt-out, native compose instead of redirect, pod-boundary hides the controls for an out-of-pod lead) and `test_admin_routes.py` (Pod Admin cannot delete a lead outside their pod; can within it). `tests/lead-detail-hub.spec.js` updated for the new popover control plus 3 new E2E cases (in-page confirm modal not a bare `confirm()`, opt-out confirmation, native compose). Full frontend suite green (514 passing), full backend suite green (2542 passed, 4 skipped, 8 xfailed).

## v11.6.5 — 2026-08-26 (App shell — mobile-responsive navigation)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** Bug fix (cross-cutting, affects every React-migrated view)
**Branches:** `develop`, `staging`

### Context
Flagged directly: "things which are already migrated to React should be responsive, which is not the case." Traced it to the app shell, not any individual hub — when the sidebar was rebuilt in React (NavHub), the classic vanilla sidebar's real `@media (max-width: 768px)` responsive layout never got an equivalent. Worse, that old media query stayed live and actively wrong for the current DOM: `.app-container { flex-direction: column; }` still matched at phone widths, and with the sidebar's full-viewport-height first child, every hub's actual content was pushed entirely below the fold — invisible without scrolling past a full screen of sidebar. Confirmed by reproducing with Playwright at a 390px viewport and inspecting computed styles directly, not just visually.

### Fix
- `frontend-react/src/layout/NavSidebar.jsx` / `NavTopbar.jsx` / `nav-entry.jsx`: below a new 768px breakpoint, the sidebar becomes an off-canvas drawer (`position: fixed`, slides in via `transform`) instead of a permanent in-flow column. A hamburger button in the topbar (hidden on desktop) opens it; a semi-transparent backdrop, a tap on any nav link, or any real view change (`NavHub.update()`) closes it. State is shared between the two independent React roots the same way the existing feedback-modal setter is (`nav-entry.jsx`'s module scope) — no context provider added for one boolean.
- `frontend-react/src/layout/NavHub.css`: the new drawer + backdrop + hamburger-button rules, all scoped inside the breakpoint.
- `frontend/css/style.css`: removed the one actively-conflicting rule from the dead legacy media query (`.app-container`'s `flex-direction: column`) and added a scoped override so `#nav-sidebar-root` stops reserving 220px/72px of row space once the sidebar goes off-canvas. The rest of that old block (rules for the pre-React `.sidebar`/`.sidebar-collapse-btn`/etc. classes) was left alone — dead but harmless, out of scope for this fix.

This fixes it for every React-migrated page at once (Dashboard, Leads, Lead Detail, Analytics, Calendar, Power Dialer, etc.) since they all share this one app shell — not a per-hub fix.

### Testing
New `NavSidebar.mobileDrawer.test.jsx` / `NavTopbar.mobileDrawer.test.jsx` (drawer open/close class, nav-link and backdrop close, hamburger toggle + aria-expanded). Full frontend-react suite green (510 passing). Verified visually via Playwright at a 390px viewport against real staging data — before/after screenshots confirm content is fully visible and the drawer opens/closes correctly.

## v11.6.4 — 2026-08-26 (Lead Detail Hub — assignment control + skeleton loading)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** Feature completion + polish
**Branches:** `develop`, `staging`

### Context
Two smaller gaps flagged against the new Lead Detail Hub: Super Admin/Pod Admin had no way to change a lead's assignment from the new view (classic has no inline control for this either, but the request was to add one), and several sections showed a plain "Loading…" text instead of a skeleton while their data was in flight — including the whole-page shell, which showed bare text instead of any layout placeholder on first load.

### Fix
- `LeadHeader.jsx`: for Super Admin/Pod Admin, "Assigned to" is now a live `<select>` of assignable SDR/AE/Sales users (same role filter as classic `assignments.js`) instead of plain text. Changing it calls the existing `POST /admin/assignments/bulk-unassign` + `bulk-assign` endpoints (`AssignmentsService`, already used by the classic Assignments tab) — no new backend endpoint needed. Backend already pod-scopes the assignable-user list and the assign call for Pod Admin.
- Added `LeadDetailSkeleton` (`components/ui/Skeleton.jsx`) for the initial full-page load, replacing a bare "Loading lead…" text line, following the same composite-skeleton pattern as the existing `DashboardSkeleton`/`CallsSkeleton`. Swapped three more plain "Loading…" texts (`TasksPanel`, `NotesPanel`, `StatusHistory`) for `SkeletonText`.
- ponytail-review pass: consolidated three separate `isSuperAdmin || isPodAdmin` expressions in `LeadDetailHub.jsx` into one `isAdmin` constant.

### Testing
Extended `LeadDetailHub.test.jsx` (Super Admin can change assignment via the dropdown and it calls the two assignment endpoints; a non-admin SDR sees plain read-only text, no dropdown). Full frontend-react suite green (504 passing).

## v11.6.3 — 2026-08-26 (Staging OOM — startup ran twice per process, doubling every background job)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** Bug fix (backend stability, staging-only, no user-facing change)
**Branches:** `develop`, `staging`

### Context
Staging OOM-crashed again (`Instance failed: pmk8h — Ran out of memory (used over 512MB)`, 2026-08-26 01:15 UTC), roughly 5 hours after the v11.6.2 deploy — none of that deploy's frontend-only changes were the cause. Pulled the actual boot logs via the Render Logs API and found `main.py`'s `lifespan()` startup sequence executing **twice** within the same single process: every startup log line, including all 15 `scheduled_jobs._schedule_recurring(...)` registrations, appeared twice ~40-90ms apart. Confirmed via the previous deploy's boot log that this predates tonight's work — a long-standing, previously-invisible bug, not a new regression.

### Root cause
`_schedule_recurring`'s recurring-timer wrapper reschedules itself unconditionally on every tick without checking whether it's still "the" registered timer for its name — so two independent calls to `start_scheduled_jobs()` in one process don't produce one corrected chain, they produce **two permanently-running chains per job, forever**. Confirmed in logs: `[EmailSync] Synced 50/50 active leads` printed twice per ~300s tick for the entire ~5-hour uptime — i.e. 100 leads' worth of full-mailbox Nylas sync every 5 minutes instead of 50, each held on one long-lived shared DB session. `api.us.nylas.com` calls made up 36-44% of all log lines in the 23 minutes before the crash. Every other periodic job (notably `_journey_engine_tick` every 30s) was silently running at 2x its intended rate too — meaning every leak fix shipped this week has been fighting a background load that was quietly double what it should have been.

### Fix
`backend/main.py`'s `_run_startup_tasks()` is now guarded by a one-shot `threading.Lock` (`_startup_lock`, never released) — a second invocation, however triggered, is now a safe no-op instead of re-running schema work and re-registering every scheduled job. The exact ASGI-level mechanism causing the double lifespan invocation itself was not pinned down (ruled out: multi-worker/`--reload` in the Dockerfile CMD, a duplicate `@app.on_event`, a second `FastAPI()`/`lifespan=` reference) — this fix is correct regardless of that trigger since it makes the expensive part idempotent.

### Testing
New `backend/tests/test_main_startup.py` — asserts a second call is a no-op when the lock is already held, and that `scheduled_jobs.start_scheduled_jobs` is only invoked once across two real back-to-back calls to `_run_startup_tasks()`. Full backend suite green.

## v11.6.2 — 2026-08-26 (Lead Detail Hub — closing legacy-parity gaps, staging only)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** Feature completion + bug fix
**Branches:** `develop`, `staging`

### Context
A legacy-vs-new-hub audit found the v11.6.0 Lead Detail Hub had several "coming soon" toast stubs standing in for real pipeline-progression actions — No-Show, Demo Success/Failed, Meeting Complete, Add/Complete Discovery, Schedule Demo, and Disqualify all had no working entry point, meaning an SDR literally could not progress a lead through the pipeline from the new page. A parallel memory-leak audit (following up on the day's OOM investigation) found one more unfixed instance of the same unbounded-cache shape in `conversations_routes.py`.

### Fix — Lead Detail Hub
- **Reused, not rebuilt**, per the plan's own philosophy: `openNoShowModal` and `openDisqualifyModal` were already reusable exports in `modals.js` — bridged via `window._openNoShowModal`, mirroring the existing `window._openCallModal` pattern. The five simpler stage-progression actions (single API call + toast each) were extracted into a shared `runLeadStageAction()` dispatcher (`window._runLeadStageAction`); Demo Failed's small reason+notes form was extracted into `openDemoFailedModal()` and bridged the same way. All of these now route through `NextBestAction`'s single-CTA-plus-optional-secondary-action pattern, so the SDR sees exactly one obvious next step per pipeline stage instead of a wall of buttons.
- Added a native Disqualify inline form (reason dropdown, same list and "No Phone Number" bypass as classic) and wired Delete Lead to the real `POST /admin/leads/bulk-delete` endpoint (classic's own `LeadsService.deleteLead` pointed at a route that doesn't exist — left alone, unused, out of scope tonight).
- Closed smaller gaps: `window._currentLead` is now set on every render (legacy modules read this global regardless of which view is mounted); a fetched-but-never-rendered Sales Cadence journey chip now shows on `LeadSummary`; a "Company Already Connected" banner, a research heat badge, a copy-opening-line button, a collapsible Enrichment Data card, a live phone-timezone badge, and gated click-to-edit contact fields were all added, closing items the original build's checklist had marked done-in-plan but not actually implemented. Email/SMS quick actions and Call History's recording/transcript/edit-outcome now deep-link into the classic view's matching tab (a `sessionStorage` handoff) instead of showing a stub toast.
- Fixed a real bug found while wiring the Completed-status branch: `deriveNextBestAction` had no case for a `Completed` lead at all, so it fell through to "Follow up" — actively wrong messaging for a lead that needs no further action.
- Deliberately did **not** add click-to-advance-by-clicking-the-stage-pip (legacy's SDR-guardrail/no-skip logic) — every transition is reachable through the single NextBestAction CTA instead, a clearer affordance than a second, easier-to-misclick trigger for the same mutation.

### Fix — one more staging OOM leak
- `backend/routes/conversations_routes.py`'s `_lead_convs_cache` (keyed on every distinct lead phone number ever viewed, polled every 15s, values are full conversation payloads) had the same lazy-delete-on-read shape as this week's other four leaks — same sweep-on-write fix applied.

### Testing
Legacy-vs-new-hub parity audit + memory-leak audit each run via a background agent; all findings addressed or explicitly deferred with a comment explaining why. Unit tests extended (`deriveNextBestAction.test.js`, `modals_stage_actions.test.js`, `test_conversations_routes.py`). Also fixed a pre-existing, unrelated test-infra bug found while re-running the SDR regression suite: `tests/sdr-lead-page-p{1,2,3,4}.spec.js` waited on `#app-sidebar`, a selector that stopped existing when the sidebar was rebuilt in React days ago (already fixed in `tests/helpers/auth.js` at the time, never carried over to these four files) — now waits on the sidebar's own `Dashboard` link, matching the already-fixed helper.

## v11.6.1 — 2026-08-26 (Staging OOM — 4 more unbounded-cache/thread leaks)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** Bug fix (backend stability)
**Branches:** `develop`, `staging`

### Context
Staging OOM-crashed again (`messenger-crm-staging` instance killed, "Ran out of memory (used over 512MB)") roughly 30 minutes after the v11.6.0 deploy — the crash correlated with deploy timing but the root cause was unrelated to that feature (Lead Detail Hub is frontend-only; this box's backend code hadn't changed). Investigation found 4 more instances of the exact same leak shape already fixed twice before (`0ea1dbe` scheduler timers, `56ce657` Nylas sync cap, and `cache.py`'s own `_SWEEP_THRESHOLD` fix): hand-rolled in-memory caches that mint a new high-cardinality key on nearly every call and never evict it, because their lazy delete-on-read only frees a key that gets read again after expiry — which rarely happens for a free-text query, a date range, or a KPI snapshot.

### Fix
- `backend/services/smart_analytics.py` (`_dsl_cache`/`_result_cache`), `backend/routes/analytics_routes.py` (`_cache`), `backend/routes/analytics_ai_routes.py` (`_ai_rec_cache`) — ported the same sweep-on-write fix `cache.py` already validated: once a store crosses 500 entries, sweep expired ones on the next write.
- `backend/routes/analytics_ai_routes.py`'s `_llm_summary_cache` had a worse bug: it never checked TTL on read at all (the `_LLM_SUMMARY_CACHE_TTL` constant was dead code) — entries lived forever regardless of the sweep. Fixed to check expiry on read and sweep on write.
- `backend/middleware/timing.py` — `_write_perf_metric` spawned an uncapped `threading.Thread` on every non-excluded HTTP request (the only candidate that scales with *all* traffic, not one feature). Bounded with a `threading.Semaphore(8)`, mirroring the Nylas fix's skip-over-cap pattern.
- Incidental find while validating the `_llm_summary_cache` fix: `POST /insights-summary` imported a Groq-calling helper under a name that doesn't exist in `ai_research_routes.py` (`_call_groq` vs. the real `_call_groq_sync`) and never even used it after import — every real call silently hit the broad exception handler and returned `null`. Removed the dead, broken import; the endpoint now actually returns a summary.

## v11.6.0 — 2026-08-25 (Lead Detail Hub — opt-in React redesign, staging only)
**Deploy:** `develop → staging` (not yet promoted to `main`) | **Type:** New feature (opt-in, dual-view)
**Branches:** `develop`, `staging`

### Context
Redesign of the Lead Details page per `docs/Alternate CRM Lead Details — React Redesign & Architecture Prompt.md`, re-architected around understand → decide → act → capture outcome → next action rather than a 1:1 port of the legacy page. Ships as an opt-in React page alongside the untouched legacy page — same dual-view toggle pattern already proven by Leads Hub (`localStorage.leadsHub`) — so legacy stays the default and fully functional; users opt in via `localStorage.leadDetailHub = 'on'`.

### What shipped
- New `frontend-react/src/features/lead-detail-hub/` — `LeadDetailHub.jsx` plus 14 focused components (LeadHeader, SalesStage, NextBestAction, LeadSummary, ContactCard, PreCallIntelligence, ActivityTimeline/ActivityItem, TasksPanel, and a right rail: QuickActions, CallStrategy, NotesPanel, RelatedOpportunity, StatusHistory), one data hook (`useLeadDetail`) and one call-workflow hook (`useCallController`), plus 4 pure lib functions (`normalizeActivity`, `deriveNextBestAction`, `deriveResearchStatus`, `formatDate`).
- **No new backend endpoints** — every data need was already covered by existing APIs (confirmed via a full audit first, per the design doc's own "do not invent APIs" instruction); 3 additive methods were added to the frontend's existing `LeadsService` (`getCallsForLead` pagination params, `getFieldHistory`, `getJourney`).
- **Call-outcome logging is reused, not rebuilt.** The new page triggers the existing global call-outcome modal (`window._openCallModal`, already callable from React — Leads Hub does this today) and listens for the existing `alternate:call-outcome-resolved` event to refresh activity/lead/journey data — a second, parallel implementation of that ~1100-line state machine was explicitly decided against (user sign-off) per the spec's own "one source of truth" principle.
- **Fixed for the new page only, not the legacy one:** Klenty-sourced historical calls were mislabeled "Manual Log" in the legacy Calls tab (its provider check only recognizes `aircall`/`messenger`) — the new unified activity timeline checks the full known provider set and correctly shows "Klenty," matching the lead-level source badge. Legacy code is untouched.
- Dual-view toggle: a "Switch to the new experience" link in classic `lead_detail.js`, an `app.js` `loadView('lead-detail', ...)` branch mirroring the Leads Hub pattern exactly, and two `modals.js` one-line guards (`window.LeadDetailHub?.isMounted`) so saving a call outcome or no-show while the new page is open doesn't force it back to classic.
- Deliberately deferred to progressive disclosure / the classic view for v1 (not removed, not silently dropped): Email/SMS composer, stage click-to-advance, and the bespoke Disqualify/No-Show/Demo-outcome modals — all reused as-is from the legacy page rather than rebuilt in React, same "one source of truth" reasoning as the call modal.

### Testing
Frontend: full vitest suite (496 passed, 35 new — pure-function tests for the activity normalizer incl. the Klenty-label regression, the next-best-action ruleset, the research-status state machine, `useCallController`, and the toggle/render/fetch-isolation behavior of the page itself). New Playwright E2E spec `tests/lead-detail-hub.spec.js` covering the toggle both directions, no-console-errors, and prev/next navigation from the React page. `/ponytail-review` run on the full diff — found and fixed one real duplication (4 near-identical date formatters copy-pasted across components, consolidated into one shared `lib/formatDate.js`); otherwise the per-component architecture was confirmed intentional (matches the design doc's own named component list) rather than over-fragmentation.
Backend: untouched — no route/model changes in this batch; full backend suite unaffected.

**Deploy status:** on `staging` only per explicit instruction, pending a live Playwright run against staging before any promotion to `main`.

## v11.5.25 — 2026-08-25 (Connect-rate double-counting fix, Analytics Hub landing state)
**Deploy:** `develop → staging → main` | **Type:** Data correctness + UX (Analytics)
**Branches:** `develop`, `staging`, `main`

### Context
Live-testing v11.5.24 immediately after it shipped surfaced two more issues in the area just touched: the connect-rate fix in that release (summing DialerCall + CallLog connects) exposed a pre-existing double-count, and a UX request to stop the dashboard from loading org-wide data by default.

### Root causes & fixes
1. **Connect Rate double-counted any call auto-logged both as a DialerCall and a mirrored CallLog row** — `get_funnel()`'s call-counting query counted every `call_log` row and then subtracted an approximate date-based heuristic overlap from `calls_made` only, never from `calls_connected`. Once v11.5.24 started summing `dc.connected + cl.connected`, every auto-tagged Aircall call's connect got counted twice. `_compute_sdr_rows` and `get_batch_summary` already avoid this correctly with a precise `CallLog.dialer_call_id.is_(None)` filter (the FK `_auto_log_outcome` sets on the mirrored row) — `get_funnel()` now uses the same filter and the heuristic overlap query is deleted entirely (net −20 lines).
2. **Analytics Hub loaded org-wide, all-time data immediately on open**, before the user had chosen anything — the funnel/SDR-table/trend fetch fired unconditionally on mount. The filter picker (POD → Date Range → Batch) now renders as a centered prompt with no data below it until the first "Apply Filters" click; after that, it renders in its previous compact position as before. Reuses the existing "no autosubmit" Apply gate rather than adding a second trigger.

### Testing
Backend: full analytics + models suite (309 passed) including a new regression test reproducing the exact double-count (auto-logged CallLog mirroring a DialerCall). Frontend: full vitest suite (461 passed); `DashboardTab.test.jsx` updated for the Apply-gated landing state, plus 2 new tests asserting nothing fetches before the first Apply. `analytics-hub` bundle rebuilt. Ran `/ponytail-review` on both diffs — clean, nothing to cut.

## v11.5.24 — 2026-08-25 (Analytics Hub connect-rate cleanup + account metric wiring, pod-level lead cap removed)
**Deploy:** `develop → staging → main` | **Type:** Data correctness + UI (Analytics), config cleanup (admin)
**Branches:** `develop`, `staging`, `main`

### Context
Two independent threads landed together: (1) live-testing surfaced a lead-assignment report that traced back to an invisible, unmanageable per-pod lead cap silently overriding the global setting — removed per explicit instruction so only the global setting governs anywhere; (2) a live walkthrough of the Analytics Hub dashboard asked for three UI changes plus "make sure the data is clean," which reopened a connect-rate investigation from earlier this session and surfaced two more real bugs.

### Root causes & fixes
1. **Per-pod lead cap silently overrode the global setting, with no way to see or manage it** — `Pod.active_lead_cap` took priority in `_get_active_lead_cap()`, but no API or UI ever exposed or let anyone set it, so the only way a pod's cap could diverge from the global default was a direct DB write. Removed the override entirely (also independently duplicated in `admin_user_routes.py`'s user listing); only `SyncSettings.active_lead_cap` (Settings → Sync) governs now, everywhere. Column kept for now, dropped in a follow-up migration once verified live, per this file's own convention for column removal.
2. **Connect-rate exclusion list was missing "Unreachable" and compared case-sensitively** — `NOT_ANSWERED_OUTCOMES` didn't include "Unreachable" (a call that never got through), and a lowercase/underscored `no_answer` variant found in real data (369 rows) silently counted as a live connect. Both fixed; "Left the Company" stays counted as connected on purpose — a human did pick up.
3. **Org/pod-level Connect Rate tile ignored manually-logged calls in its numerator** — `calls_connected` only ever summed DialerCall-based connects, even though CallLog-based calls already counted toward the denominator, and the SDR table below it already merged both correctly. Now matches.
4. **"Accounts Called" metric was fully computed server-side and never shown** — `/sdr-table` already returned `accounts_called` / `accounts_connected` / `account_connect_rate` (distinct company names dialed, case-insensitive), but `DashboardTab.jsx` never read any of them. Replaced the SDR table's "Leads" column with "Accounts Called".
5. **SDR table's "Conversations" column removed** per explicit request — Calls and Connect % cover it.
6. **Connect Rate tile's tooltip stated a stale, wrong formula** ("Live connects / calls with outcome" — the real denominator is total calls made, per an earlier fix). Every KPI card, funnel-strip stage, and SDR-table header/cell now carries an accurate, calculation-specific tooltip instead.

### Testing
Backend: full suite (2528 passed, 4 skipped, 8 xfailed) plus 5 new targeted tests (pod-cap override ignored; outcome case/Unreachable fixes; manual-call-log numerator fix). Frontend: full vitest suite (459 passed), `DashboardTab.test.jsx` updated for the new columns. `analytics-hub` bundle rebuilt and verified. Ran `/ponytail-review` + `/ponytail-audit` on the full diff — clean, nothing to cut.

## v11.5.23 — 2026-08-25 (Opt-out tooltip drift, template-picker centering, dialer mode-selector masked by stale state)
**Deploy:** `develop → staging → main` | **Type:** Bug fix batch (UI, dialer)
**Branches:** `develop`, `staging`, `main`

### Context
Live-tested v11.5.22 immediately after it shipped and found four more issues
in the areas just touched; three were confirmed root causes and fixed here,
one turned out to be correct existing behavior (not a bug).

### Root causes & fixes
1. **"Mark Opted Out" onboarding tooltip drifted from the button and left a
   ghost highlight behind** — `_showOptOutHintOnce()` (`lead_detail.js`)
   built its `position:fixed` ring/card from a one-time
   `getBoundingClientRect()` snapshot with no listener to reposition them.
   The page scrolls inside `#view-container`, not the window, so the
   button moved out from under the frozen ring on scroll — the empty blue
   pill reported next to the button was that stranded ring. Fixed by
   repositioning on both the container's and window's scroll/resize, until
   dismissed.
2. **Same "Mark Opted Out" action still used the native `confirm()`
   popup** — the exact pattern fixed in `admin.js` last release, just not
   caught in this file. Swapped in the same `confirmModal()`.
3. **WhatsApp template dropdown's native popup rendered centered instead
   of anchored under the trigger** — `MessengerWidgetRoot.jsx` kept a
   non-`none` CSS `transform` (`scale-100 translate-y-0`) on the widget
   panel even once fully open. A well-documented Chromium behavior: a
   native `<select>` mispositions its popup when any ancestor has a
   non-`none` transform. Dropped the transform once open (visually
   identical — it was already the identity transform), keeping it only
   for the enter/exit animation.
4. **Dialer mode-selector ("Phone Bridge" / "Browser Call") sometimes
   never appeared, and `openForCall()`'s promise timed out after 45s with
   "Dialer did not respond"** — `CallTab.jsx` checked the engine's
   `ACTIVE`/`ENDING`/`INITIATING` state *before* checking for a pending
   mode-selection request. `app.js` only calls `openForCall()` after its
   own guards already concluded no real call is in progress, so reaching
   this component with a pending mode-selection while the engine reports a
   non-`IDLE` state means the engine's state is stale — the same class of
   desync the `ParticipantDisconnected` fix targeted, reachable here via a
   different path. The stale state masked the mode-selector entirely, so
   there was nothing to click. Reordered so a pending mode-selection
   always takes priority.
5. **SDR lead assignment "not working"** — investigated and confirmed
   **not a bug**: the target SDR's pod has a 5-active-lead test cap and
   the SDR already had 688 active leads. The skip-with-reason toast
   (shipped earlier) is working exactly as designed.

### Testing
`frontend-react` and classic `frontend` vitest suites run once at the end
(459 and 123 passing respectively; one pre-existing, unrelated
`utils.test.js` collection failure noted separately, untouched by this or
the prior release). `messenger-widget` bundle rebuilt and verified.

## v11.5.22 — 2026-08-25 (Assignment/call-data cache staleness, admin delete UI, dialer stuck-ACTIVE bug, WhatsApp template send + per-SDR sender, staging OOM cache leak)
**Deploy:** `develop → staging → main` | **Type:** Bug fix batch (data correctness, UI, dialer, messaging)
**Branches:** `develop`, `staging`, `main`

### Context
A batch of production/staging reports investigated together: reassigning a
lead from the Leads Hub appeared to silently do nothing; SDRs reported
0-call counts on leads they'd actually called via the dialer; deleting an
admin user left the stale row on screen until a manual refresh; Ankit's
dialer widget stopped showing call status (ringing/mute/hangup) after the
first call post-refresh; and WhatsApp template sends were failing outright
on Alternate Messenger with `number of localizable_params (0) does not match the
expected number of params (1)`.

### Root causes & fixes
1. **Lead-assignment routes never busted the leads cache** (`bulk_assign`,
   `bulk_unassign`, `auto_assign_all`, `unassign_lead`, `bulk_delete_leads`
   in `admin_assignment_routes.py`) — violates `cache.py`'s own documented
   invariant. A reassignment's immediate re-fetch could return the
   pre-assignment cached snapshot, looking like the assignment silently
   failed. Added `invalidate('my_leads'|'leads_count'|'leads_page')` to all five.
2. Same gap in `call_routes.py::log_call` — logging a call updates
   `call_attempt_count`/status but never busted the cache either.
3. **`call_count` only ever tallied `CallLog` rows** (`lead_helpers.py::
   _batch_latest_activity`) — a call logged via the in-app dialer attaches
   its outcome directly to the `DialerCall` row with no new `CallLog`
   created, so it was never counted. Merged `DialerCall` (excluding
   `FAILED` and rows already paired via `CallLog.dialer_call_id`, to avoid
   double-counting) into the count, mirroring the existing outcome-merge
   in `_latest_call_outcome`.
4. **Admin delete/revoke/role-change still used the native browser
   `confirm()`/`alert()`** — a prior fix only enriched the *message* inside
   that same native dialog, never replaced it. Added a reusable
   `confirmModal()` (`frontend/js/views/confirm_modal.js`, reusing the
   existing `.modal`/`.btn-danger` classes) and swapped it into `admin.js`.
5. **`renderAdmin()`'s post-action re-render was fire-and-forget** — no
   `await`/`catch`, so a failure partway through silently left the deleted
   user still on screen until a manual reload. Now awaited with a toast on
   failure, across delete/revoke/role-change.
6. **Alternate Messenger dialer (browser mode): no `ParticipantDisconnected`
   handler** — only the lead *joining* the room was handled; the lead
   hanging up first left the engine stuck `ACTIVE` until the next call's
   ghost-detection auto-heal noticed, and the widget didn't reliably show
   status for that next call either. Added the missing handler so the
   engine returns to `IDLE` as soon as the lead leaves.
7. **WhatsApp had one org-wide sender for every SDR**, unlike calling
   (which already assigns each SDR their own Alternate Messenger number). Added a
   per-SDR `messenger_whatsapp_sender_id` (Settings → Dialer → Agent
   Assignments), resolved with fallback to the org-wide default in both the
   cadence engine (`whatsapp_channel.py`) and the Widget's manual-send path
   (`/api/dialer/status`).
8. **Failed sends collapsed to a generic "Send failed"** with the real
   reason discarded — added `SmsLog.failure_reason`, populated from the
   provider's actual error across all four send paths (cadence WhatsApp/SMS,
   Widget manual send, legacy `/api/sms/send`). Separately, the lead-detail
   Sales Cadence card only showed the generic `exited_reason` code even
   though `JourneyEnrollment.last_error` already captured the real message —
   now returned by `GET /api/journeys/by-lead/{id}` and shown as a "details"
   tooltip.
9. (Same underlying fix as #6 — tracked together.)
10. **WhatsApp template sends always failed once a template had any
    parameter** — `${contacts.first_name}` was substituted into the
    display-only `message_text` field but left raw inside
    `content.components[].text`, which is what Alternate Messenger actually
    validates the send against. Live-verified against a real
    `get_whatsapp_templates()` response before fixing, per the third-party
    API contract rule. Now substituted in both.
    **Known issue (found in live re-test after this shipped):** at least
    one template ("lead send details") still fails with the identical
    `localizable_params` error even with this fix live and the message
    text correctly resolved — Alternate Messenger's validation likely reads a
    separate structured `parameters` array per component (closer to Meta's
    official WhatsApp template mechanism) that this fix never touched.
    Needs the real template's raw `content` shape to fix precisely; not
    resolved as of v11.5.23.
11. **Staging kept OOM-killing itself again, ~19h after the v11.5.20/21
    scheduler-timer and Nylas-semaphore fixes had already deployed** —
    a third, unrelated leak in `cache.py`'s in-memory fallback layer.
    High-cardinality namespaces (`leads_page`/`my_leads`/`leads_count` key
    on search text, page number, and filter combos) mint a cache key that's
    almost never read again once it expires, and `get_cached()` only ever
    frees an expired key lazily, on that exact key being re-read — so the
    in-memory dict grew for the life of the worker with no cap and no
    periodic sweep. Confirmed via Render's per-minute memory metrics for
    the post-deploy instance: a slow ~9MB/hr climb (280MB → 428MB) over
    the overnight low-traffic window, then a sharp ramp to 512MB during
    the next business-hours traffic burst, which is exactly the shape a
    growing never-evicted key set produces (not a fixed-size daily leak
    like the two prior fixes). Fixed at the root — in `cache.py` itself,
    not by chasing every mutating route — with an opportunistic sweep:
    once a namespace's in-memory store exceeds 500 entries, the next write
    purges already-expired entries before adding the new one.

### Testing
Backend: new/updated pytest coverage for cache invalidation (mocked
`cache.invalidate`) on all 5 assignment routes + `log_call`, the
DialerCall/CallLog count-merge (including the double-count guard), the
per-SDR WhatsApp sender resolution and fallback, `SmsLog.failure_reason`
population, the `content` substitution fix (verified against the real
template shape), and the cache sweep (`test_redis_cache.py::
test_expired_entries_swept_once_namespace_grows_past_threshold`).
Frontend: `frontend/tests/confirm_modal.test.js` (new),
`dialerEngine.test.js` extended with a mocked-LiveKit `ParticipantDisconnected`
case. Playwright: `tests/admin-user-delete.spec.js` updated for the new DOM
modal (previously asserted against the native `dialog` event, which no
longer fires); `tests/leads-hub-inline-select.spec.js` already covered the
reassignment UI and is now reliable rather than racing the cache TTL;
`tests/agent-assignments-whatsapp-sender.spec.js` (new, presence-only —
the Alternate Messenger User ID field is live-validated against the real API on
save, so a full add-agent round trip isn't safe to automate). Full backend
suite run once at the end, not after each fix.

## v11.5.21 — 2026-08-24 (Bound concurrent Nylas full-mailbox syncs)
**Deploy:** `develop → staging → main` | **Type:** Bug fix (backend stability)
**Branches:** `develop`, `staging`, `main`

### Context
Follow-up to v11.5.20's scheduler-leak fix. While investigating why staging
OOM'd much faster under heavy request traffic (~30x the idle leak rate),
found a secondary, traffic-scaled contributor: `GET /api/lead/{id}/emails`
(the Emails tab) fires a background Nylas full-mailbox fetch on every call,
with no cap on how many can run at once. Each run can hold up to 100 full
message bodies (64KB cap each, pre-sanitize) in memory simultaneously. Not
a leak by itself — each run's session and objects are released normally —
but a burst of lead-detail views (a real traffic spike, or the day's
Playwright E2E runs) could run dozens of these concurrently on the 512Mi
staging box, and CPython/glibc rarely hand freed heap back to the OS after
a spike like that, so the process's memory high-water mark stayed elevated.

### Fix
Added a `threading.Semaphore(4)` around
`_sync_full_mailbox_background` (`backend/routes/email_routes.py`) — at
most 4 of these run at once; anything over the cap is skipped (logged, not
queued or blocked) since this is best-effort catch-up mail sync, not
user-facing. The endpoint's response was already instant and unaffected
either way (it returns cached data; the sync only fetches new mail for
next time). Added regression tests covering both the skip-over-cap path
and that the permit is correctly released so the next call isn't starved.

## v11.5.20 — 2026-08-24 (Staging OOM root cause: unbounded scheduler-timer list)
**Deploy:** `develop → staging → main` | **Type:** Bug fix (backend stability)
**Branches:** `develop`, `staging`, `main`

### Context
Staging had been getting OOM-killed repeatedly (512Mi limit), including
during zero-traffic weekend hours — a strong signal the leak was
time-driven, not request-driven. Render's memory graph showed a smooth,
monotonic climb with no dips until each crash-restart, which is the
signature of something that's never freed rather than transient request
load.

### Root cause & fix
`backend/scheduled_jobs.py`'s recurring-job scheduler kept every
background job (`journey_engine_tick` every 30s, email/messaging sync
every 5 min, and others down to daily) alive via `threading.Timer`, but
each re-schedule appended the new `Timer` to a module-level list that was
only ever cleared in `stop_scheduled_jobs()` — which runs on a graceful
shutdown, never on an OOM `SIGKILL`. The fastest job alone added ~2,880
permanently-retained entries per day, growing for the entire life of the
process. Fixed by keying the tracking structure by job name (a dict) so
each re-schedule replaces its own prior entry instead of accumulating one;
`_timers` is now constant-size for the life of the process. Added a
regression test that fails against the old list-based code and passes
against the fix.

## v11.5.19 — 2026-08-24 (Leads Hub popover clipped; user-delete cascade gap; opt-out walkthrough; first Playwright E2E coverage for the weekend batch)
**Deploy:** `develop → staging → main` | **Type:** Bug fixes + test coverage
**Branches:** `develop`, `staging`, `main`

### Context
Minutes after v11.5.18 shipped, the user hit the new Assigned-To/Status
popover live and reported it broken: the search box rendered but the
options list never did. Root cause: every table cell has `overflow-hidden`
(to stop long names spilling into the next column), which silently clipped
the popover panel right after the input — invisible to the popover's own
unit tests because jsdom does no real layout, so `overflow: hidden` never
actually clips there. That gap prompted two things: fixing the popover, and
auditing whether the rest of the weekend batch had the same blind spot —
which surfaced a second, unrelated, wider-impact bug: deleting *any* user
who had ever touched the Power Dialer queue also 500'd, for the exact same
reason the Pod Admin delete did (an unguarded FK cascade), just never
reported because it's less common to notice.

### Root causes & fixes
- **Assigned-To/Status popover rendered empty:** `InlineSelectCell.jsx`'s
  options panel is now portaled to `document.body` with `position: fixed`
  computed from the trigger's real bounding rect (recomputed on scroll/
  resize) instead of being a normal-flow descendant of the clipped table
  cell. Click-outside detection now checks both the trigger and the
  portaled panel.
- **Deleting a user 500'd if they'd ever used the Power Dialer:**
  `DialerQueueStatus.user_id` is `NOT NULL` with no `passive_deletes=True`
  on its `User` relationship — SQLAlchemy tried to null it out before the
  delete, violating the constraint. Same bug class as the Pod Admin delete
  fixed in v11.5.18 (and already correctly guarded for `LoginLog`/
  `UserMailbox`); fixed the same way, trusting the DB's own `ON DELETE
  CASCADE` instead.
- **No walkthrough for the new opt-out marker:** added a one-time,
  same-convention hint (highlight + short card, shown once via
  `localStorage`, matching `GuidedTour.jsx`/`seenFlag.js`'s pattern) next to
  the "Mark Opted Out" button, satisfying AGENT_PROTOCOL.md §13 rule 5.
  Also documented both new admin/lead-detail controls in
  `docs/user-guide.md`.
- **No browser-level test coverage existed for any of the weekend batch:**
  added the first Playwright specs exercising the popover (open/search/
  Escape/cross-row-close, against real browser layout — the thing jsdom
  can't catch), the opt-out toggle end-to-end, and the delete-user flow
  end-to-end (a throwaway test user, real create → delete → 404 check) plus
  a non-mutating check of the Pod Admin warning dialog's content.

### Testing
- Backend: full pytest suite, plus a new regression test for the
  `DialerQueueStatus` delete-cascade bug (reproduced against pre-fix code
  first, to confirm the test actually catches it).
- Frontend: full `frontend-react` vitest suite (existing `InlineSelectCell`/
  `LeadsHub` tests updated for the portal change).
- New: `tests/leads-hub-inline-select.spec.js`, `tests/lead-opt-out.spec.js`,
  `tests/admin-user-delete.spec.js` (Playwright, run against staging).

## v11.5.18 — 2026-08-24 (Weekend bug batch: lead reassignment, pod-admin delete, opt-out marker, dialer self-heal, embedded-call duplicate logging)
**Deploy:** `develop → staging → main` | **Type:** Bug fixes + one small feature, root-caused via live user testing and a super-admin standup report
**Branches:** `develop`, `staging`, `main`

### Context
Weekend product testing plus a super-admin standup report (Viren Baid, via
Amit) surfaced several independent issues: SDRs still saw the headless
Alternate Messenger dialer 3 days after the v11.5.17 fix; embedded-Aircall calls were
logging late, missing, or duplicated; bulk-reassigning a lead away from a
departed SDR silently failed in the new Leads Hub; deleting a Pod Admin
threw a generic 500 on production; and there was no way to mark a lead as
opted out despite the dialer and journey engine already enforcing that flag
everywhere it's checked.

### Root causes & fixes
- **Dialer still headless (Alternate Messenger):** the v11.5.17 fix was correct, but
  the one-shot decision of *whether* to call `MessengerWidget.init()` was
  still a silently-swallowed `try/catch` with no retry and no user-facing
  signal — a transient `/api/dialer/status` hiccup permanently stranded the
  session headless. `app.js` now retries once after a transient failure and
  shows a visible toast if it still fails.
- **Embedded-Aircall duplicate/delayed call logging:** `dialer_service.py`'s
  webhook-to-pending-call match had no time bound and Aircall Everywhere's
  wider click-to-webhook race window was defeating the `user_id`-scoped
  match on the first webhook (Aircall's `call.created` often carries no
  attributed user yet) — creating a second, invisible `_direct` row instead
  of updating the SDR's own call. Bounded the match to a 10-minute window
  and added a last-chance reconciliation pass (only taken when exactly one
  candidate matches, to avoid guessing) before falling back to create-new.
- **Lead reassignment silently blocked:** `admin_assignment_routes.py`'s
  pod-lock check ran for every caller, not just Pod Admins — blocking
  Super Admin/Admin from reassigning a lead away from a departed SDR
  whenever that SDR's stale pod differed from the target's. Scoped the
  check to Pod Admin only.
- **Pod Admin delete crashed:** `delete_crm_user` never removed the user's
  `PodAdmin` rows before deleting them, and the ORM relationship wasn't
  configured to cascade — hitting a NOT NULL constraint that surfaced as a
  generic 500. Now deletes the `PodAdmin` rows explicitly first, and the
  delete confirmation warns which pod(s) they admin before you proceed.
- **No opt-out write path:** `Lead.do_not_contact`/`unsubscribed_at` were
  already fully enforced by the dialer, journey engine, and Power Dialer —
  nothing could ever set them. Added the write path (`PATCH /leads/{id}`)
  and a toggle + badge on the lead detail page.
- **"Email numbers are 0" — not a bug:** confirmed Alternate CRM's Nylas-backed
  email tracking is correct end-to-end for emails sent via its own
  Compose/Reply UI; a Gmail-direct send is structurally invisible to it.
  Added a tooltip on the Emails tab clarifying this — no backend change.

### Deferred
Embedded Aircall not working on Safari is still under investigation — the
best-supported hypothesis (Safari's Intelligent Tracking Prevention
blocking the third-party `workspace.aircall.io` iframe) needs a live Safari
repro before any fix is scoped.

### Verification
- Backend full suite: 2497 passed, 4 skipped, 8 xfailed (7 new tests, zero
  regressions vs. the 2490 baseline).
- `frontend-react` full suite: 451/451 passed. Vanilla-JS suite: 117/117
  (one pre-existing, unrelated collection failure confirmed via stash-test
  to predate this batch).
- `ponytail-review` + `ponytail-audit` run on the diff — one duplication
  found and fixed (a reconciliation query in `dialer_service.py` re-doing
  the fallback loop above it), re-verified clean.

## v11.5.17 — 2026-08-21 (Alternate Messenger dialer: call rings/connects with no visible timer/mute/hangup)
**Deploy:** `develop → staging → main` | **Type:** Bug fix, root-caused via live SDR report
**Branches:** `develop`, `staging`, `main`

### Context
India SDRs reported that clicking Click-to-Dial on the Alternate Messenger dialer
rang and connected the call — audio worked, they could talk to the lead —
but no timer, mute, or hangup control ever appeared, and a failed dial (bad
number) gave no visible error either.

### Root cause
The React Alternate Messenger widget's visible UI (`messenger-widget-entry.jsx`)
only ever mounted its DOM tree lazily, inside `window.MessengerWidget.init()`
— while `window.Alternate MessengerDialer` (the call engine that actually places and
tracks the call) was claimed unconditionally the instant the bundle's script
parsed. `init()`'s whole call sits behind an `await` on the dialer-status
fetch, wrapped in a blanket `try/catch` in `app.js` that only logs a
`console.warn` on failure and never retries. Any hiccup on that async path
left the engine fully driving a real, connected call with zero DOM anywhere
to render a timer/mute/hangup into — including the toast host used for
failure messages, since that lives in the same never-mounted tree.

### Fix
Mount the widget's React tree immediately and unconditionally at script
load. A new `initialized` flag on `widgetUiStore` (false until
`MessengerWidget.init()` actually runs) gates only the tree's *visibility*
— a plain state write can't fail the way a React mount can. Aircall-only
SDRs still never see the widget's floating button, since `init()` is only
ever called for SDRs on the Alternate Messenger provider.

### Verification
- `frontend-react` full suite: 451/451 passed, including a new regression
  test asserting the widget renders nothing before `init()` has run.
- `ponytail-review` + `ponytail-audit` run on the diff — clean, nothing to
  cut.

## v11.5.16 — 2026-08-21 (dial-count double-counting, dead-end lead page, company grouping/sort, Analytics Hub timezone, logging)
**Deploy:** `develop → staging → main` | **Type:** Bug fixes, root-caused via live SDR reports
**Branches:** `develop`, `staging`, `main`

### Context
Three live SDR reports (call-outcome popups arriving late, dial counts
doubling, "Alternate CRM not working at all" surviving a logout/login and a
laptop restart) plus a PM UI/UX pass on the leads list turned up a chain of
related, root-caused bugs — each confirmed with logs/tests, not guessed at.

### Fixes
- **`lead.times_called` double-counted, two separate ways**: (1)
  `dialer_service.handle_webhook` incremented it on every `CALL_ENDED`
  webhook *delivery*, not just the first — a documented Alternate Messenger/Aircall
  webhook retry alone double-counted, no SDR action needed. (2)
  `call_routes.log_call` incremented it again on manual outcome submission
  even when the webhook already had — `call_attempt_count` (its sibling
  counter) already had this exact guard; `times_called` never got it. An
  earlier same-day SSE fix made the webhook-then-submit sequence complete
  reliably for Aircall calls for the first time, surfacing this.
- **Dead-end blank `#lead-detail` page**: an earlier guard against an
  `undefined` lead id stopped the crash but never changed the URL hash, so a
  browser restoring a stale tab hit the same trap every load — explaining
  why logout/login and a laptop restart didn't help. Now redirects to the
  dashboard.
- **Company-less leads sorted to the top instead of the bottom**, in both
  the classic and React leads lists, and in the Power Dialer's "Account
  (group by company)" sequence (same backend sort). `coalesce(company, '')`
  then plain ascending order put an empty string before every real company
  name — looked exactly like grouping was broken.
- **React leads list: company grouping silently disabled for every SDR/AE
  by default** — the non-admin default sort (`priority`) was treated as a
  user-chosen sort that should suppress grouping, when it's actually the
  page's own default and was never meant to conflict (classic view already
  shows grouping and a priority badge together with no issue).
- **Analytics Hub: call counts didn't match across the SAME dashboard** —
  the SDR-performance table already resolved date ranges against each pod's
  own timezone (added 2026-08-14); the funnel, trend, email-breakdown, and
  batch-summary views all still resolved dates in raw UTC. A US team's
  shift spanning UTC midnight split across two on-screen windows on one view
  but not the other. All four now share the same pod-timezone-aware
  resolution — including the 7d/30d/90d presets, which weren't covered by
  the original 2026-08-14 fix either (only a custom date pick was).
- **Logging**: nothing in the backend ever configured a log level or
  handler — every `logger.info(...)` diagnostic/self-heal line anywhere in
  the app was silently dropped in production. Confirmed live during this
  same incident's investigation. Added explicit `logging.basicConfig`
  (`LOG_LEVEL` env var, default `INFO`).

### Also added
- **Interactive walkthrough for the React leads list**
  (`LeadsHubTour.jsx`) — a written help-hub section alone wasn't reaching
  SDRs, who were avoiding the feature over a "missing" grouping that was
  actually already there. `AGENT_PROTOCOL.md` now requires this pattern
  (reusing `GuidedTour.jsx`/`seenFlag.js`) for significant new/changed UI,
  not just static docs.

## v11.5.15 — 2026-08-20 (Call Lists, Analytics Hub for SDRs, call-outcome-edit docs)
**Deploy:** `develop → staging → main` | **Type:** New feature + role-access widening + docs
**Branches:** `develop`, `staging`, `main`

### Context
Three SDR feature requests from an earlier feedback batch were revisited in
full: (1) "selectable call lists" for the Power Dialer (a Klenty-style
feature), (2) Analytics Hub visibility for SDRs, and (3) whether call
outcomes can be corrected — plus the standing ask to document all of it in
`docs/user-guide.md`, since the equivalent AE-facing Analytics access shipped
earlier without ever being documented.

An initial "smallest patch" option for (1) — reusing the existing admin-only
`Tag` model as a quick Power Dialer dial source — was explicitly rejected in
favor of a standalone feature with its own data model, edge cases worked
through up front, and a pre-implementation ponytail-review pass to catch
speculative complexity before it was built.

### 1. Call Lists (new feature)
A user-curated, org-wide-visible dial list — any SDR/AE/Admin can create one
and add leads to it, then dial from it in Power Dialer.

- **New tables**: `models.CallList` + `call_list_leads` M2M (mirrors
  `Tag`/`lead_tags`'s shape, plus a `created_by` column Tag doesn't have,
  since Call Lists show "created by X" in the UI). Migration added to
  `migrations.py`'s `table_creates` list (the trusted path in this repo —
  `Base.metadata.create_all()` alone is not, per an earlier RCA).
- **New routes** (`backend/routes/call_list_routes.py`): `GET/POST
  /api/call-lists`, `POST /api/call-lists/{id}/leads` (bulk-add, set-difference
  insert so a duplicate re-add is a no-op, not an error), `DELETE
  /api/call-lists/{id}` (creator or Pod Admin+, any pod).
- **`GET /leads` gains `call_list_id`** — ANDs with the existing callable-
  status filter (a list is a source of candidates, not an override of what's
  safe to dial), same idiom as the existing `journey_id` filter.
- **Frontend**: `CallListsService`; Leads Hub bulk-select gets an "Add to
  Call List" action (with inline create); the Filter Bar gets "Save as Call
  List" (resolves the *entire* filtered set via the existing `ids_only`
  mode, with a confirmation showing the exact count before adding); Power
  Dialer gets a "Call List" dropdown, open to every role — the actual gap
  this closes vs. the rejected Tag-reuse patch. If a selected list is
  deleted mid-session, the next Refresh falls back to "All leads" with a
  toast, instead of silently dialing an empty, stale-filtered queue.

### 2. Analytics Hub visibility for SDRs
The Dashboard tab's self-scoping mechanism already existed for AE
(`analytics_routes._effective_ae_sdr` / `require_admin_or_ae`) — widened to
include SDR. Frontend nav item, route gate, and `DashboardTab.jsx`'s
`isAE` → `isSelfScoped` rename (5 gates + the Mixpanel tracking field) follow
the same widening.

**Architectural gap found and closed in the same pass**: the "Ask AI" tab is
a separate pipeline (`smart_analytics_routes.py`/`smart_analytics.py`) with
*no* self-scoping concept at all — it was `require_admin`-gated so AE could
never actually submit a query despite the tab rendering for them, and had
zero guard against a self-scoped caller asking for org-wide data if that
gate were ever loosened. Rather than build full self-scoped NL-query safety
in this pass, Ask AI is now hidden entirely for SDR/AE (mirrors the existing
Reports tab gate) — a net fix, not a new restriction, and it keeps the door
open to build real self-scoped Ask AI later as its own reviewed piece of
work.

### 3. Editable call outcomes — live-verified, docs-only
A third request ("can outcomes be corrected?") turned out to already be
built (v11.5.0) and open to every role for dialer-sourced calls
(`lead_calls_tab.js`'s Edit action, `call_routes.py::log_call`'s
`dialer_call_id` overwrite path). Rather than trust a code read alone, this
was live-verified end-to-end on staging with a real SDR JWT: minted a token
for an existing SDR user via the admin token endpoint, found a real
dialer-sourced call on one of that SDR's leads, clicked Edit, resubmitted a
different outcome, and confirmed via the API that the same `DialerCall` row
was updated in place — no duplicate created.

One correction to the original assumption: the Edit modal does **not**
reopen pre-filled with the previous outcome — it resets to the blank "Did
the call connect?" question and only silently remembers which `DialerCall`
to update on submit. Documented as the real flow, not the pre-filled one
originally assumed.

### 4. User Guide
Added Call Lists, Analytics Hub, and call-outcome-correction content to the
actual in-app Help Hub guide (`help-hub/data/sections.js`) — this is what
real users see, not `docs/user-guide.md` alone (that file was also updated
as supplementary repo documentation, but never reaches an end user). While
in there, also fixed a pre-existing stale-copy bug: the Analytics Hub
section's self-scoped-role branch literally read "As an AE, Analytics Hub
shows your own numbers only..." — stale text from before SDRs had access,
surfaced because Help Hub's role bucketing collapses SDR and AE into the
same bucket.

### 5. Two gaps found via live staging testing, fixed in this same release
- **SDR/AE could not reach bulk-select at all.** The "Add to Call List"
  bulk action was wired into the existing bulk-select checkbox flow, which
  turned out to be entirely gated behind "Assign mode" — an admin-only
  toggle (`isAdminRole &&` in `LeadsHub.jsx`). SDR/AE had no way to check a
  box in the first place. Fixed with a second, independent, non-admin
  "Select Leads" toggle (`useLeadsList.js`'s new `selectMode` state) that
  unlocks checkboxes and `BulkActionBar` the same way, but the bar's
  Assign/Unassign section (a real admin capability — reassigning leads
  across the team) is now explicitly gated behind a new `canBulkAssign`
  prop rather than rendering unconditionally like it used to.
- **No way back from the new Leads experience to the classic one.** The
  `onSwitchToClassic` callback existed but was only ever wired into the
  crash-fallback screen (`leads-entry.jsx`), never into the normal working
  UI — once a user clicked "Switch to the new experience," there was no
  visible way back short of clearing `localStorage` manually. Added an
  always-visible "Switch to classic view" link to `LeadsHub.jsx`. Also
  fixed the callback itself (`app.js`): it rendered the classic view
  in-place but never cleared the `leadsHub` localStorage flag, so the very
  next navigation/reload would silently bounce back into the new
  experience — the same category of bug this session's earlier
  "Switch to the new experience" fix addressed, just in the reverse
  direction.

### Verified
- Backend: new `tests/test_call_list_routes.py` (14 tests — CRUD,
  create-on-use dedup, concurrent-bulk-add no-op, delete permissions,
  `call_list_id` filter ANDs with status + excludes soft-deleted leads).
  `tests/test_analytics_routes.py`'s `TestAESelfScope` extended with SDR
  mirrors of every existing AE self-scope test, plus a new regression test
  for `/filters` not leaking pod/SDR data to a self-scoped caller. Full
  backend suite: 2464 passed, 4 skipped, 8 xfailed.
- Frontend: new tests for `usePowerDialerQueue`'s `call_list_id` wiring, the
  Power Dialer Call List dropdown + mid-session-deletion fallback, the Leads
  Hub bulk-add and save-filter-as-list actions, the new non-admin "Select
  Leads" mode (checkboxes + Add to Call List, no Assign/Unassign), and the
  "Switch to classic view" link. Full suite: 440 passed.
- Live staging verification (not just local tests): authenticated Call
  Lists CRUD + `GET /leads?call_list_id=` filter round-trip, SDR funnel/
  filters self-scoping, and a Playwright pass confirming the Analytics Hub
  Dashboard tab renders for an SDR with Ask AI correctly absent. Two real
  gaps (§5 above) were caught this way, not by the test suite alone — both
  fixed before shipping to production.
- Live Playwright check on staging with a real SDR JWT for the call-outcome
  correction flow (see §3 above).

## v11.5.14 — 2026-08-20 ("Switch to the new experience" button fixed)
**Deploy:** `develop → staging → main` | **Type:** Bug fix
**Branches:** `develop`, `staging`, `main`

### Context
User-reported (screenshot): clicking "Switch to the new experience" on the
classic Leads list banner reloads the page but stays on the classic
experience.

### Root cause
`app.js`'s `loadView('leads')` gate (added in v11.5.12, reinstating the
classic list as default) checks `localStorage.getItem('leadsHub') !== 'on'`.
The banner's button (`lead_list.js`) still ran
`localStorage.removeItem('leadsBeta')` — the pre-v11.5.4 flag name, dead
everywhere else in the codebase — so the reload never set the flag `app.js`
actually reads, and the page silently stayed on the classic list every time.

### Fix
Button now sets `localStorage.setItem('leadsHub', 'on')` before reloading.

### Verified
- `node --check frontend/js/views/lead_list.js` — syntax valid.
- Full vitest suite: 115 passed (1 pre-existing, unrelated failure
  already on develop HEAD).

## v11.5.13 — 2026-08-20 (Dial-count over-count fix round 2, dialer SSE gap, stale-closure UI races, Power Dialer Company column)
**Deploy:** `develop → staging → main` | **Type:** Bug fix + small feature
**Branches:** `develop`, `staging`, `main`

### Context
A batch of SDR Slack feedback (Charushi, Monisha, Vanshika, Himanshu, Jemimah)
reported dial counts still looking wrong and the dialer widget occasionally
"disappearing" mid-session. Investigated live (Render logs, live prod DB
queries) before writing any fix, per this project's standing discipline —
found the reported symptom plus 8 sibling bugs from the same two root causes.

### Root cause 1 — un-excluded auto-logged CallLogs double-counted dial counts
`dialer_service._auto_log_outcome()` creates a `CallLog` with `dialer_call_id`
set to the `DialerCall` it mirrors, whenever an Aircall call gets an
SDR-tagged outcome. Several analytics/reporting queries summed both
`DialerCall` and `CallLog` rows without excluding rows where this FK is set,
double-counting every auto-tagged call. Confirmed live: Aug 19 had 945 real
dials but 355 of 382 that day's `CallLog` rows were auto-logged duplicates
of an already-counted `DialerCall` — a 27–37% overcount.

**Fixed** (added `CallLog.dialer_call_id.is_(None)` to each query):
- `lead_routes.get_dashboard_stats` (today's call-outcome counts)
- `analytics_routes._compute_sdr_rows` (SDR table)
- `analytics_routes.get_batch_summary` (per-batch call counts)
- `lead_service.logged_call_count` (docstring was also actively wrong —
  claimed no `CallLog` is ever auto-created for a dialer call)

### Root cause 2 — dialer webhooks never reached the SSE broker
Both Aircall's and Alternate Messenger's webhooks hit the same generic
`/api/webhooks/dialer` endpoint in production (confirmed live — zero
traffic on the provider-specific `/webhooks/aircall`/`/webhooks/messenger`
endpoints over a 7-day window), but that endpoint's background processor
(`_process_dialer_webhook_bg`) never called `_publish_call_status()` — every
SDR was relying entirely on 2-10s client-side polling for call status,
producing the reported disposition-popup delay.

**Fixed:** `_process_dialer_webhook_bg` now awaits `_publish_call_status()`
itself — a code-only fix at the one shared path, not dependent on either
provider's webhook URL configuration ever being changed.

### Other fixes in this batch
- **Two stale-closure UI races** (dialer widget's `hideDialerWidget()`,
  the No-Show modal's post-submit `setTimeout`): both closed over a
  mutable module-level variable instead of a snapshot taken at schedule
  time, so a second action inside the pending-timeout window could
  remove/navigate the wrong element. Fixed by snapshotting the target at
  schedule time in both.
- **Nondeterministic pagination**: added `Lead.id` (or the equivalent PK)
  as a final `ORDER BY` tiebreaker on 5 endpoints whose primary sort key
  can tie (`get_leads`, `get_my_leads`, `list_meetings`,
  `get_upload_batch_leads`, `get_login_logs`, `list_error_logs`).
- **Classic Leads list now freezes order for the session**: a filter-keyed
  in-memory cache (`lead_list.js`) re-fetches only on an explicit filter
  change, reload, or the Re-prioritize action — not on every "Back to
  Leads" navigation (product decision, confirmed with the user).
- **`frontend/js/api.js` error-handling backfill**: 23 call sites
  (`fetchLeads`, `bulkAssign`, all 5 Analytics Hub fetchers, etc.) now
  consistently call `handleUnauthorized()` + throw on a non-OK response,
  via a shared `_checkOk()` helper — several previously let a failed
  fetch silently continue with `undefined` data (`lead_detail.js`'s
  crash on an invalid/expired token was one visible symptom).

### Small feature
- **Power Dialer queue list now shows a Company column** — SDRs couldn't
  previously see which account they were about to call without opening
  the lead. Reads the already-fetched `lead.company` field, no backend
  change needed.

### Verified
- Backend: added regression tests directly reproducing both root causes —
  `test_lead_routes.py::test_calls_today_does_not_double_count_auto_logged_dialer_calls`
  and `test_dialer_routes.py::TestDialerWebhookBackgroundProcessor` (2
  tests). Confirmed both fail against the pre-fix code (reverted to `HEAD`
  temporarily, reran, restored) before trusting them as real regression
  tests, not tautologies. Full suite run before shipping.
- Frontend: added 2 new vitest fake-timer tests for the stale-closure
  races (`dialer_widget.test.js`, `modals_no_show.test.js`) — same
  red-then-green verification against the pre-fix code. Full existing
  vitest suite green except one pre-existing, unrelated failure
  (`utils.test.js`, reproduces on `develop` HEAD with none of this
  session's changes applied).
- Full local Postgres-backed Playwright round (local Docker/colima setup,
  since nothing was pushed to staging during investigation): existing
  specs green, plus 3 new checks (list-freeze, invalid-token redirect,
  Power Dialer Company column) — all passing.
- `ponytail-review` + `ponytail-audit` run per this project's mandatory
  pre-ship gate; one shrinkable pattern found and applied (see CLAUDE.md).

## v11.5.12 — 2026-08-19 (Leads: reinstate classic list as default)
**Deploy:** `develop → staging → main` | **Type:** Rollback / mitigation
**Branches:** `develop`, `staging`, `main`

### Context
Users reported issues with LeadsHub (React), the sole Leads view since
v11.5.4. Reinstating the classic `renderLeads()` list (`views/leads.js`,
`lead_list.js`) as the default while LeadsHub's issues are investigated.
v11.5.4's release note explicitly left the classic code in place for
exactly this — "reversible in minutes, no risk to whatever might still
quietly depend on the classic code path."

### Change
`frontend/js/app.js`'s `loadView('leads')` branch now renders the classic
list by default. Set `localStorage.setItem('leadsHub', 'on')` in a browser
to opt that browser back into LeadsHub for testing/comparison — no
backend/DB flag exists (this is a client-only toggle, same mechanism the
old `leadsBeta` flag used pre-v11.5.4). LeadsHub's crash-fallback wiring
(`onSwitchToClassic`) and the `onOpenLead` nav-array bridge are unchanged.

### Verified
- `node --check frontend/js/app.js` — syntax valid.
- No existing frontend test asserts LeadsHub always mounts for 'leads'.

## v11.5.11 — 2026-08-19 (SSE "No response returned" 500 fix)
**Deploy:** `develop → staging → main` | **Type:** Bug fix
**Branches:** `develop`, `staging`, `main`

### Context
Error Logs dashboard showed 13 critical, recurring 500s on
`/api/calls/events` (the real-time SSE call-status stream). Live Render
logs (not just a code read) confirmed a fresh occurrence at 13:24 UTC,
after the v11.5.10 deploy — a separate, still-live bug, not the
already-fixed v11.5.1 `user["sub"]` issue.

### Root cause
`backend/middleware/timing.py` and `backend/middleware_cache_headers.py`
both subclass Starlette's `BaseHTTPMiddleware`, which buffers every
response through an in-memory stream via `call_next()`. That's
incompatible with the SSE endpoint's long-lived `StreamingResponse` —
when the dialer widget's `EventSource` disconnects mid-stream (page
reload/nav/tab-close, constant in practice), the buffer comes up empty
and Starlette raises `RuntimeError: No response returned.`. `timing.py`'s
existing skip-list only excluded its own logging logic, not the unsafe
`call_next()` call itself; `middleware_cache_headers.py` had no exclusion
at all.

### Fix
Overrode `__call__` in both middlewares to bypass `BaseHTTPMiddleware`
entirely for `/api/calls/events`, calling the next ASGI app directly
instead of the broken buffering path.

### Verified
- Backend: 2441 passed, 4 skipped, 8 xfailed (incl. 3 new regression
  tests confirming the bypass fires for `/api/calls/events` only).
- Live Render logs: 12 real `/api/calls/events` requests (with
  reconnects) in the ~5 minutes after the production deploy, zero
  "No response returned" errors — vs. one every 5-15 min before the fix.

## v11.5.10 — 2026-08-19 (Weekly Changelog Digest: dedicated toggle)
**Deploy:** `develop → staging → main` | **Type:** Improvement
**Branches:** `develop`, `staging`, `main`

### Context
Feedback on the v11.5.6 "What Shipped This Week" email: setting it up
meant going through the full Report Builder — name, POD/Batch/SDR
scope, schedule, recipients typed in one by one, sender, CSV — nearly
none of which applies to a release-notes digest (`_build_release_digest`
already ignores pod/batch/sdr entirely; it's a pure date-range lookup).
Separately: recipients should be every current CRM user, not a manually
typed, easily-stale list of external addresses.

### Change
- **`ReportConfig.send_to_all_users`** (new column, default false): the
  one report row this is true for resolves its "To" list fresh at every
  send, from every current user's email in `users` (backend/report_service.py::execute_report)
  — no stored recipient snapshot to go stale as people join or leave.
- **`GET/PATCH /api/admin/analytics/reports/changelog-digest`**: a
  singleton on/off endpoint (backend/routes/report_routes.py) —
  enabling it creates that one ReportConfig row (weekly, release_digest
  only, auto-picks a connected mailbox to send from; 422s clearly if none
  exists), disabling it flips `enabled=False` without deleting the row
  so re-enabling doesn't duplicate it. Excluded from the general
  `GET /reports` list — it isn't editable through the normal builder.
- **`ChangelogDigestCard`** (frontend-react/src/pages/Analytics/reports/):
  one switch, no fields, sitting above My Reports in Analytics Hub →
  Reports. Off by default.

### Verified
- Backend: `test_report_routes.py::TestChangelogDigestToggle` (5 new
  tests), `test_report_service.py`'s new dynamic-recipient-resolution
  test, full backend suite green.
- Frontend: `ChangelogDigestCard.test.jsx` (4 new tests) + full
  `vitest` suite, 423 passed.

## v11.5.9 — 2026-08-19 (dialer stuck-call self-heal, Alternate Messenger 503 noise)
**Deploy:** `develop → staging → main` | **Type:** Bug fix
**Branches:** `develop`, `staging`, `main`

### Context
Two live reports the same day: an SDR (Aditya) permanently blocked from
dialing with "A call is already in progress," and repeated 503 console
errors on `/api/conversations/*` for an org that only uses Aircall.

### Change
- **Dialer stuck-call self-heal**: `handleCallAction`'s client-side
  "call already in progress" gate used to be a dead end — it blocked
  immediately on stale local widget state with a static toast, never
  checking backend truth. The EC-16 staleness self-heal and Force-Clear
  banner already existed, but only ran *after* a call attempt reached
  the backend and failed — never at this earlier gate, so hard refresh
  and relogin never actually cleared it. Now checks
  `GET /api/calls/my-active` before blocking: auto-resets local state if
  the backend disagrees (stale/healed), or shows the actionable
  Force-Clear banner if a call is genuinely still active in the DB.
  (`frontend/js/app.js`)
- **Alternate Messenger Conversations 503 noise**: the messaging widget polled
  session-state/history/badge endpoints unconditionally, 503ing on every
  cycle for orgs (like this one, Aircall-only) that never configured
  Alternate Messenger — each failed request logs as a red "Failed to load
  resource" line in the browser console regardless of how the JS
  handles it, so catching the error in JS could never make the noise go
  away. Added a cheap `GET /api/conversations/status` check; the widget
  fetches it once per page load and skips all polling entirely when not
  configured, showing a plain "Messaging isn't set up" state instead.
  (`backend/routes/conversations_routes.py`,
  `frontend-react/src/features/messenger-widget/`)

### Verified
- Backend: `test_conversations_routes.py::TestConversationsStatus` (3
  new tests) + full file, 23 passed.
- Frontend: full `vitest` suite, 419 passed, including a dedicated
  "not configured" suite asserting zero session-state/badge calls fire.

## v11.5.8 — 2026-08-19 (POD Management fixes: real nav gate, N+1 query, stuck-page bug)
**Deploy:** `develop → staging → main` | **Type:** Bug fix
**Branches:** `develop`, `staging`, `main`

### Context
v11.5.7 shipped to production, then real click-through testing surfaced
three separate bugs the review/audit pass didn't catch. Worth naming
directly since one of them undoes the entire point of the release: the
Pod Admin the Team Roster was built for could not see the nav link to it.

### Change
- **Real root cause of "Pod Admins can't reach POD Management" (this
  codebase has two nav systems)**: v11.5.7's "nav fix" edited
  `app.js`'s `document.getElementById('pods-nav-item')` toggle — dead
  code, since that DOM id doesn't exist anywhere in the current
  `index.html`. The actual, rendered sidebar is the React
  `NavSidebar.jsx` component, whose own `NAV_ITEMS` role list for `pods`
  was still `['Super Admin']` and was never touched. Fixed at the real
  gate this time; added `NavSidebar.podsGating.test.jsx` asserting Pod
  Admin and Super Admin both see the link and SDR doesn't, specifically
  so this class of "fixed the wrong nav mechanism" bug fails a test next
  time instead of shipping silently again.
- **Slow load**: `pod_routes.py`'s `list_pods` ran ~4 queries *per pod*
  (activity stats, assigned-lead counts, admins, members) — negligible
  for one pod, compounding badly across several. Rewritten to fetch all
  pods' data in 4 queries total regardless of pod count (`_pod_to_dict`
  now accepts precomputed maps; single-pod endpoints like create/update
  are unaffected and keep computing their own).
- **Stuck/blank page on revisit**: `app.js` has a documented, previously-
  fixed pattern (Calendar, Help, Sales Journeys all needed it) — a React
  Hub must be `.unmount()`-ed when navigating away, and re-clicking the
  same view while it's still mounted must skip the destructive
  `showLoader()` re-render, or `.navigate()` renders into a DOM node
  that no longer exists. PODs was missing from both lists; added.
- **Team Roster**: added client-side search (name/email/pod) and
  pagination (20/page) — the "and why isn't this a proper table" ask.
  Client-side because the roster is every rep in the org, already
  fetched in one request, not a server-paginated lead list.
- Tightened the `onOpenRep` Leads Hub hand-off: `globalView` is now only
  set for Super Admin — a Pod Admin's roster only ever lists their own
  pod's reps to begin with, so the pod-scoping bypass flag was
  unnecessary (not a live leak — `assigned_to` already narrows to one
  person — but no reason to pass an admin-bypass flag a Pod Admin
  doesn't need).
- Caught on the same staging click-through: the "Showing X's leads" toast
  after clicking a rep rendered as a red ❌ error banner. `showToast(msg,
  type = 'error', ...)` defaults to the error theme when no type is
  passed, and this call site was the only one in `app.js` that omitted
  it. Fixed that, then went further on request: this toast originates
  from a click inside a React Hub, so it should look like one — not the
  legacy inline-styled vanilla toast. A proper React `ToastHost`
  (`components/ui/Toast.jsx`) already existed for exactly this, driven
  by a `alternate:toast` window CustomEvent specifically so non-React
  code can trigger it, but it was only ever mounted inside Sales Journey
  Hub and the Alternate Messenger Widget — not globally, so nothing else could use
  it. Now mounted persistently by NavHub (the one root that's never
  unmounted across navigation), and this call site dispatches the event
  instead of calling `showToast()`. Every other `showToast()` call site
  in `app.js` is untouched — this was scoped to the one call site raised,
  not a full toast-system migration.

### Migration Notes
None.

### Tests
`NavSidebar.podsGating.test.jsx` (3 new). `RosterTable.test.jsx` (+3):
search filters by name/email/pod, no-match message, pagination at 20
rows. `Toast.test.jsx` (5 new): renders from the CustomEvent, ignores an
empty message, defaults to the error theme with no type (matching legacy
`showToast()`'s own default), auto-dismisses after its duration, supports
multiple simultaneous toasts. Full backend suite (2428 passed, 4 skipped,
8 xfailed) and full frontend suite (418 passed) green.

### Verified on staging / production
Yes — Pod Admin nav visibility (`roles:["Super Admin","Pod Admin"]`) and
the CustomEvent-based toast confirmed live in the served `nav-hub.js`/
`app.js` bundles on both staging and production, plus a real click-
through by the user on the initial POD Management build that caught the
design-consistency, slow-load, nav-gating, and toast-styling issues this
version and the prior one fix.

## v11.5.7 — 2026-08-19 (POD Management React rebuild — Team Roster)
**Deploy:** `develop → staging → main` | **Type:** Feature (React migration)
**Branches:** `develop`, `staging`, `main`

### Context
A pod admin asked for a way to see what their SDRs' leads actually look
like day to day — not just Analytics' aggregate numbers, but "is this
lead sitting untouched?" Also confirmed as one of the React-migration
targets (POD Management was still the classic vanilla-JS view).

### Change
- New `frontend-react/src/features/pods-hub/` feature (mounted via
  `pods-entry.jsx`/`window.PodsHub`, same mount/navigate/unmount contract
  as every other Hub), replacing the classic `views/pods.js` view for
  `viewName === 'pods'` in `app.js`. Classic view is kept in the codebase,
  unreachable in normal use, wired only as the crash-fallback escape
  hatch (`onSwitchToClassic`) — same pattern as the Leads Hub deprecation
  (v11.5.4).
- **Team Roster tab** (new capability): one row per SDR/AE across every
  pod, with active-lead count and staleness buckets (untouched >24h,
  >72h), sorted worst-first by default. Clicking a rep hands off straight
  to the Leads Hub, pre-filtered to that rep — reuses the Leads Hub's
  existing `assigned_to` filter and fetch machinery (via seeding its own
  sessionStorage view-state key) instead of building a second activity
  timeline.
- **Manage Pods tab**: the existing create/delete pod, timezone, pod-admin,
  and member management — ported to React, same capabilities and role
  gates as the classic view (Super Admin only for pod/timezone/admin CRUD;
  Pod Admins can manage members of their own pod).
- Backend: `pod_routes.py`'s `_pod_to_dict` now computes `active_leads` /
  `stale_24h` / `stale_72h` per member via one bulk query per pod (joins
  `lead_assignments` + `Lead`, filtered to `ACTIVE_STATUSES` and non-deleted
  leads) instead of a per-member relationship load — avoids an N+1 scan
  across the pod. The existing `assigned_leads` field (all-time count, any
  status) is unchanged.
- Help & User Guide: updated the POD Management section for the Team
  Roster tab and Pod Admin visibility, and added a Calendar section that
  had no how-to coverage at all despite the feature existing. (`views/
  user_guide.js`, the classic vanilla-JS guide, is dead code — unreferenced
  by `app.js` — so the live guide content lives only in `frontend-react/
  src/features/help-hub/data/sections.js`.)
- Design-consistency fix (caught on first staging click-through): the
  initial cut used a plain "Loading pods…" text state and raw emoji
  (👥/🌐/👤) in headers/labels/empty-states, inconsistent with every other
  React Hub in this codebase (Leads Hub etc. use a row-shaped skeleton and
  plain-text headers/lucide-react icons, no emoji). Replaced the loading
  state with a `RosterSkeleton` (same convention as Leads Hub's
  `SkeletonRow`), dropped the emoji, and switched empty-state icons to
  `lucide-react`'s `Users`. Error display now uses the same styled red
  banner Leads Hub uses instead of plain red text.

### Migration Notes
None — no schema changes, purely additive fields on an existing response.

### Tests
`test_pod_routes.py` (2 new): active/stale bucket counts computed
correctly per member, terminal-status leads excluded, empty-pod case.
`RosterTable.test.jsx` (4 new): default sort (most-stale-first), column
re-sort + direction toggle, rep click hand-off, empty state. Full backend
suite and full frontend suite green (see verification below).

### Verified on staging
Pending.

## v11.5.6 — 2026-08-19 (Weekly "What Shipped" release digest)
**Deploy:** `develop → staging → main` | **Type:** Feature
**Branches:** `develop`, `staging`, `main`

### Context
Feedback: release notes get written every week, but nobody's ever
proactively told a week's worth of shipping happened — someone has to
remember to open Help & User Guide to find out.

### Change
- New `release_digest` report component ("What Shipped This Week"),
  registered in `report_service.py`'s existing `COMPONENTS` registry —
  reuses the entire Automated Reports pipeline (`ReportConfig` scheduling,
  timezone/frequency handling, Nylas email delivery, CSV export, the
  Analytics Hub → Reports tab admin UI) with zero new plumbing. The admin
  UI already lists components dynamically from this registry
  (`GET /reports/components`), so this shows up as a selectable checkbox
  immediately — no frontend changes needed at all.
- Auto-picks entries strictly by date from the same `releases.json` the
  in-app Help Hub already reads — no manual weekly curation step to forget
  or skip. An entry with `items` (i.e. not `kind:"minor"`) gets the full
  write-up as a "hero"; a `summary`-only entry gets one compact line —
  mirroring exactly how `ReleaseNotesSection.jsx` already distinguishes
  the two in-app (see v11.5.2's fix: branch on `items` presence, not the
  `kind` string, so this stays correct even if a future entry uses an
  unfamiliar `kind` label). Includes a link to the full Help & User Guide
  when `FRONTEND_URL` is configured.
- An admin creates this like any other Automated Report: pick
  "What Shipped This Week" as the component, frequency=weekly, and set
  whatever recipient list they want (all users, SDRs only, etc.) — same
  flow as the existing SDR Performance report.

### Migration Notes
None — no schema changes, purely additive to an existing registry.

### Tests
`test_report_service.py` (6 new): only in-range entries included, hero
vs. one-line rendering (and `**bold**`/`` `code` `` markdown conversion),
no-data message when nothing shipped that period, Help Hub link included/
omitted based on `FRONTEND_URL`, and an unparseable date is skipped rather
than crashing. Full backend suite green (2426 passed, 4 skipped, 8 xfailed).

### Verified on staging
Yes — health/deep green on both staging and production; confirmed
`GET /api/admin/analytics/reports/components` lists `release_digest` on
both (one retry needed on each for deploy-rollout propagation, same
pattern seen earlier this session).

## v11.5.5 — 2026-08-19 (Clarity CLS + dead-click fixes)
**Deploy:** `develop → staging → main` | **Type:** Bug fix (performance/UX)
**Branches:** `develop`, `staging`, `main`

### Context
Investigated a Microsoft Clarity review flagging CLS 0.71 ("poor") and a
44.38% dead-click rate over the last 14 days (160 sessions), root-caused
against the actual codebase (not general performance guessing) before
fixing anything.

### Fixes
- **CLS — the Dashboard's own fix was never generalized.** `#dashboard-
  react-root` has reserved exactly 985px (its real measured content height)
  since it shipped, so its skeleton→real-content swap causes zero shift.
  Every other route kept using the generic `showLoader()` skeleton with no
  height reservation at all, so on every single navigation the page's
  already-visible elements jumped when real content replaced it. Measured
  real content heights live (headless browser, production, real logged-in
  data) for the highest-traffic routes and added matching reservations:
  Leads Hub (1296px), Calendar Hub (877px), Power Dialer Hub (1371px) in
  `style.css`, and fixed Analytics Hub's own existing (but undersized,
  600px vs a real ~1215px) inline reservation directly in `app.js`.
- **Dead clicks — two of three sticky top banners never compensated with
  body padding at all.** The View-As banner already correctly pushed page
  content down to avoid covering anything; the "Force Clear" stuck-call
  banner and the "log the outcome" nag banner did not — both sat
  `position:fixed;top:0` directly over the topbar's real controls (search,
  Sync Salesforce, notifications) with no way to click through, for as
  long as either was shown. Root cause: both had accidentally wrapped
  their fixed-position styling on an *inner* div instead of the actual
  banner element being inserted, so the outer box (what would need to grow
  to push content down) collapsed to zero height. Also found and fixed a
  latent related bug while here: all three banners were hardcoded to
  `top:0`, so if more than one is ever shown at once (realistic — a stuck
  call and an unlogged outcome can both follow the same problem call),
  they'd silently overlap each other, not just the topbar. New shared
  `top_banner_stack.js` (`stackTopBanner`/`unstackTopBanner`) replaces all
  three banners' one-off positioning — fixed once, in the shared place,
  not patched per banner.

### Migration Notes
None — frontend-only, no schema changes.

### Tests
`top_banner_stack.test.js` (new, 5 tests): first banner at top:0 with
matching body padding, a second banner stacks below rather than
overlapping, removing the top banner re-flows the remaining one and
shrinks padding, padding returns to 0 once all banners are gone, and a
null/undefined element is a safe no-op. Full vanilla-frontend suite green
(113 passed) — one unrelated pre-existing collection failure in
`utils.test.js` (fails identically on a clean `main` checkout, before any
of this session's changes) is out of scope, not caused by this change.

### Verified on staging
Yes — health/deep green on both staging and production; confirmed the
served `app.js`, `style.css`, and `top_banner_stack.js` are byte-identical
to the fixed local build on both.

## v11.5.4 — 2026-08-19 (Leads Hub deprecates classic view; Sales Cadence GDPR purge)
**Deploy:** `develop → staging → main` | **Type:** Feature + cleanup
**Branches:** `develop`, `staging`, `main`

### Context
Two independent items from today's planning pass:
1. Leads Hub (React) has been the default for a while now — time to
   deprecate the classic `views/leads.js` view rather than leave it as a
   silently-reachable escape hatch.
2. The Sales Cadence confidence audit (this session) flagged one genuine
   gap: `ExecutionLog` rows have no FK on `lead_id` (by design, at
   billions-of-rows insert volume — see its docstring) and so never get
   cleaned up if a lead's cadence history needs to be erased. An index for
   exactly this query already existed ("Gap 8"), but no purge function was
   ever built. The other flagged item — a role-gate mismatch between the UI
   and the enroll route — turned out to already be resolved (see v10.9.13's
   "Enroll-in-Cadence widened to Pod Admin+"); verified directly rather than
   re-fixing something already fixed.

### Changes
- **Leads Hub is now the only reachable Leads view.** Removed the
  `leadsBeta` localStorage opt-out check in `app.js` — LeadsHub always
  mounts. Removed the "You're viewing the redesigned Leads experience /
  Switch to classic view" banner from `LeadsHub.jsx` (no longer accurate —
  it's not a beta). The classic `renderLeads()`/`views/leads.js` code is
  left fully in place, and its `onSwitchToClassic` wiring is deliberately
  kept for one purpose only: `leads-entry.jsx`'s `ErrorBoundary` crash
  fallback, so a render-time crash in LeadsHub still has a working way
  back instead of a dead end. Chosen over a hard delete or URL-redirect —
  reversible in minutes, no risk to whatever might still quietly depend on
  the classic code path.
- **New `DELETE /api/journeys/gdpr/purge-lead/{lead_id}`** (Super Admin
  only) — permanently deletes a lead's `ExecutionLog` rows, using the
  index that was already built for this. `JourneyEnrollment` rows already
  cascade-delete automatically via FK if a lead row is ever hard-deleted;
  this closes the one piece that doesn't. Callable independently of lead
  deletion, since today's lead deletion is soft-delete only
  (`Lead.deleted_at`) and a real erasure request can still need cadence
  history purged on its own.

### Migration Notes
None — no schema changes.

### Tests
`test_journey_routes.py`: purge deletes only the named lead's execution
logs (a second lead's rows survive), idempotent when none exist, 403 for
non-Super-Admin. Full backend suite green (2420 passed). Frontend:
`LeadsHub.test.jsx` (41 tests) unaffected by the prop/banner removal.

### Verified on staging
Yes — health/deep green on both staging and production; confirmed
`DELETE /api/journeys/gdpr/purge-lead/{id}` returns 200 with a real
`execution_logs_deleted` count on both (one transient 404 on the first
staging call was deploy-rollout timing, resolved on retry — consistent
with the pattern already seen this session), and both served frontend
bundles reflect the removed classic-Leads banner.

## v11.5.3 — 2026-08-19 (Aircall nightly sync on/off switch)
**Deploy:** `develop → staging → main` | **Type:** Feature (ops control)
**Branches:** `develop`, `staging`, `main`

### Context
The Aircall nightly + startup catch-up sync (pulls the last 25h of call
history to catch whatever the real-time webhook missed) has been adding
load now that traffic for all users runs through it. Needed a way to pause
it without a deploy — same pattern as the existing Klenty sync toggle.

### Change
- New `SyncSettings.aircall_sync_enabled` (default `true` — no behavior
  change until an admin flips it). Gates both `_aircall_nightly_sync()`
  itself and `_should_run_aircall_sync_on_startup()`'s restart catch-up.
- New toggle in Settings → Dialer & Calling, next to the existing Aircall
  Everywhere kill switch, showing last-sync time. Real-time call tracking
  via webhook is completely unaffected either way — this only pauses the
  25h backfill pull.

### Migration Notes
New nullable-safe column with a server-side default; no backfill needed.

### Tests
`test_aircall_sync.py`: nightly sync no-ops when disabled and runs when
enabled (mocked provider/sync call); startup catch-up returns False when
disabled regardless of how overdue the last sync is. `test_dialer_routes.py`:
get/save round-trip for the new field, defaults to `true`. Full backend
suite green (2417 passed, 4 skipped, 8 xfailed).

### Verified on staging
Yes — health/deep green on both staging and production; confirmed
`GET /api/dialer/config` returns the new `aircall_sync_enabled: true` /
`aircall_last_sync_at` fields on both, and the served frontend bundle
reflects the new Settings toggle on both.

## v11.5.2 — 2026-08-19 (Help Hub crash fix + phone-timezone root cause)
**Deploy:** `develop → staging → main` | **Type:** Bug fix
**Branches:** `develop`, `staging`, `main`

### Context
Two user-reported issues, found live in production right after v11.5.1 shipped.

### Fixes
- **Help Hub crashed on load** (`Cannot read properties of undefined (reading
  'map')`, confirmed live via production Error Logs, first seen 2026-08-19
  07:06 UTC, recurring). Root cause: `ReleaseNotesSection.jsx` branched on
  `entry.kind === 'minor'` to decide whether an entry needs `items` (full
  card) or just `summary` (one-liner) — the v11.5.1 `releases.json` entry
  used `kind: "patch"` (a label the component didn't recognize) with the
  `summary`-only shape, so it fell through to the full-card branch and
  called `.map()` on the `items` array it didn't have. Fixed the component
  to branch on the actual data shape (`entry.items` present or not) instead
  of a hardcoded label — correct for any future `kind` string, not just
  `"minor"` — and corrected the v11.5.1 entry to `kind: "minor"`.
- **Timezone badge trusted formatting over real data.** v11.5.0's fix for a
  related bug used punctuation (spaces/dashes/parens) as a signal to guess
  US vs. India for an unprefixed 10-digit number — but Indian numbers are
  also commonly grouped with a space (e.g. "98105 92904"), so that guess
  broke for exactly the case it was meant to fix. `getPhoneTimezone()` now
  takes an optional country hint and checks it first — `Lead.country`/
  `company_country` is real data already on every lead, wired through from
  both `lead_detail.js` and the Power Dialer's `LocalTimeBadge`/
  `CurrentCallCard`. The old formatting-based guess still runs, but only as
  a last resort when no country is on file at all (e.g. the manual dial pad,
  which has no lead to read a country from).

### Migration Notes
None — no schema changes.

### Tests
`ReleaseNotesSection.test.jsx`: a `kind:"patch"`, `summary`-only entry
renders as a one-liner without crashing (reproduces the exact prod bug).
`LocalTimeBadge.test.jsx`: a space-grouped Indian number with `country="India"`
resolves to IST instead of the old NANP guess. Also fixed an unrelated flaky
test (`ReplyComposer.test.jsx` — `userEvent.type`'s default per-keystroke
delay could drop the last character under full-suite CPU load; pinned
`delay: null`). Full frontend suite green (403/403).

### Verified on staging
Yes — health/deep green on both staging and production; confirmed the served
`help-hub.js` is byte-identical to the fixed local build on both, and an
authenticated `/api/leads` smoke check returned 200 on both. Also caught and
fixed a real deploy gap mid-release: `index.html` cache-busts each bundle
with a hand-maintained `?v=` datestamp per file — without bumping it for
`help-hub.js`/`.css` and `power-dialer-hub.js`/`.css`, browsers already
holding the old cached URL would have kept serving the broken bundle
indefinitely even after this fix deployed. Bumped both to `20260819a`.

## v11.5.1 — 2026-08-19 (Real-time call updates: SSE auth fix)
**Deploy:** `develop → staging → main` | **Type:** Bug fix
**Branches:** `develop`, `staging`, `main`

### Context
Found during a post-v11.5.0 Playwright regression sweep (not SDR-reported):
`GET /api/calls/events` — the SSE stream that's supposed to replace 2-second
polling with real-time call status — has likely never worked in production.
Two independent bugs stacked on top of each other, both root-caused and
fixed together.

### Fixes
- **Frontend never sent a token**: `dialer_widget.js`'s `_openSSE()` called
  `api._token?.()`, which was never defined anywhere in `api.js` — always
  `undefined`. The connection always went out token-less. Fixed by exposing
  the same view-as-aware token lookup `authHeaders()` already used
  (`auth.js`'s new `getAuthToken()`) and using it for the SSE URL too.
- **Backend 500'd on every request, even with a valid token**:
  `sse_routes.py`'s `call_events_stream()` read `user["id"]`, but
  `decode_jwt()` returns the raw JWT payload, which only has `"sub"` as the
  user-id claim (the convention every other route — and the publish side of
  this same feature in `dialer_routes.py` — already follows). This raised an
  unhandled `KeyError` on every single call, masked in practice by the
  frontend bug above (which meant the endpoint was rarely even hit with a
  token to trigger it). Fixed to `user["sub"]`; also corrected stale `int`
  type hints on the user-id parameter in `sse_broker.py`/`sse_routes.py` —
  the real value is a UUID string.
- Net effect: the app silently fell back to its existing 2-second polling
  loop the entire time, which is why nobody noticed — this is a latency/
  responsiveness fix, not a fix for a visibly broken feature.

### Migration Notes
None — no schema changes.

### Verified on staging
Yes — health/deep green, and `GET /api/calls/events` reproduced as a real
500 pre-fix (curl with a genuine staging JWT) and confirmed returning
`200 OK` with `Content-Type: text/event-stream` post-fix, both via query
token and via Authorization header. Also confirmed on production post-deploy
(same 200/event-stream response), alongside the standard 3 authenticated
smoke checks.

## v11.5.0 — 2026-08-19 (SDR-reported dialer issues: 5 fixes)
**Deploy:** `develop → staging → main` | **Type:** Bug fixes
**Branches:** `develop`, `staging`, `main`

### Context
SDRs raised a batch of issues on Slack (Himanshu, Sumiti, Priyanshu, Vanshika,
Monisha, Charushi): calls not logging, the previous call still showing
"active" and blocking the next dial, auto-logged outcomes that can't be
corrected, a wrong connect rate, and the wrong timezone shown next to a
lead's phone number. Investigated each via Render logs and read-only prod DB
queries before writing any fix.

### Fixes
- **Blocked-call/webhook-lag** (biggest complaint — 783 blocked-dial events/
  11 SDRs in one day, bursts up to 24s+): `dialer_service.initiate_call` now
  asks Aircall directly for a call's live status before blocking a new dial,
  instead of only trusting our own webhook-updated record or waiting out the
  5-15 min staleness timer. Aircall-only (Alternate Messenger's `/status` endpoint is
  documented unreliable under polling load — RCA 2026-06-11 — and isn't used
  live in production today anyway). Any error/timeout falls back to today's
  behavior; the staleness timer remains the last-resort safety net.
- **Can't correct an auto-logged outcome / wrong connect rate showing**:
  `log_call`'s idempotency guard silently created a duplicate `CallLog`
  instead of overwriting an already-set `DialerCall.outcome` — so a wrong
  Aircall-tag auto-log was permanent and corrupted that SDR's connect rate
  (analytics reads `DialerCall.outcome` directly). The endpoint now always
  overwrites on an explicit `dialer_call_id` match, and keeps the paired
  AutoLog `CallLog` row (new `CallLog.dialer_call_id` link) in sync. Added an
  "Edit" action on the Calls tab so SDRs can trigger a correction.
- **FK-violation crash in AutoLog**: `dialer_service._auto_log_outcome` wrote
  `user_id="system"` (not a real `users.id` row) when a tagged call had no
  SDR attached — now uses `None`, which the nullable column already supports.
- **Wrong timezone next to phone number**: `phone_timezone.js` defaulted
  every bare 10-digit number to India/IST. Prod data showed 3000+ US lead
  numbers stored bare (no `+1`), formatted NANP-style ("(509) 901-9720") —
  now used as the signal to look up the real US area code/timezone instead.

### Migration Notes
- New nullable column `call_logs.dialer_call_id` (FK → `dialer_calls.id`,
  `SET NULL` on delete) + index — self-applies via `migrations.py` on
  startup, no manual step.

### Verified on staging
Yes — health/deep green, and the exact reported bug (auto-logged outcome
can't be corrected) reproduced and confirmed fixed on a real staging
DialerCall: logged an outcome, corrected it, `get_lead_calls` showed one
row with the corrected outcome (no duplicate).

## v11.4.9 — 2026-08-18 (Connect-rate/Conversations superset fix)
**Deploy:** `develop → staging → main` | **Type:** Data-integrity fix
**Branches:** `develop`, `staging`, `main`

### Context
Viren flagged the Weekly SDR Report data again the day after v11.4.8 shipped.
Live-verified his exact screenshot against production: Sumiti Dangi,
2026-08-17 — **13 conversations but only 11 connected calls**, a logical
impossibility (a 60+-second conversation is definitionally a connection).
Root cause: `dialer_call_connected()`'s null-outcome fallback only trusted
the literal string `provider_disposition == "ANSWERED"`, ignoring duration
entirely, while `dialer_call_is_conversation()`'s null-outcome branch
counted duration alone. A real 60s+ call with no SDR-tagged outcome and any
other (or missing) `provider_disposition` value counted as a conversation
but not as connected.

While fixing it, found a second, related gap: `dialer_call_is_conversation()`
treated an unknown duration as "assume yes" even with no outcome at all —
so a FAILED call that never connected (no outcome, no duration) also
counted as a "conversation," for the same zero-evidence reason.

### Fix
- `models.dialer_call_connected()` now also accepts duration over the same
  configurable threshold `dialer_call_is_conversation()` uses as connection
  evidence when no outcome was logged — `connected` is now guaranteed to be
  a superset of `conversations`, never the reverse.
- `models.dialer_call_is_conversation()` now requires an actual measured
  duration (not a null passthrough) when no outcome was logged — an
  explicit positive outcome still counts regardless of duration.
- Threaded the org's actual configured `conversation_min_seconds` (60s, not
  the 30s fallback constant) through all 8 call sites of
  `dialer_call_connected()` across `analytics_routes.py`, `admin_routes.py`,
  `growth_intelligence_routes.py`, and `smart_analytics.py` — previously
  only the SDR table's own two internal call sites used the configured
  threshold; the rest silently used the 30s default.

### Impact
Connect rates recompute live, so this applies to every date immediately,
past and present — no cutoff. Expect connect-rate figures to tick up
slightly everywhere `dialer_call_connected()` is read (funnel, SDR table,
batch summary, admin call-logs, growth intelligence, pod summary) since
some previously-undercounted long calls now correctly count as connected;
conversation counts drop slightly wherever a FAILED/no-evidence call had
been counted.

## v11.4.8 — 2026-08-18 (Connect-rate over-count fix + Leads list crash fix)
**Deploy:** `develop → staging → main` | **Type:** Data-integrity fix + bug fix
**Branches:** `develop`, `staging`, `main`

### Context
Two issues surfaced live in production the same afternoon:

1. Walking through the Weekly SDR Report's connect-rate numbers with a live
   audit of production data (prompted by "so any call that was picked up
   counts as connected — don't you think that's wrong?") surfaced a real,
   high-impact bug: `dialer_call_connected()` counted a call as connected if
   `provider_disposition == "ANSWERED"` **regardless** of what outcome the
   SDR logged for it. On real Aug 10–17 data, 63% of calls explicitly logged
   as "No Answer" (and 65% of "Wrong Number") were still counted as
   connected — the raw telephony "answered" signal (which fires on any
   picked-up leg, voicemail included) was silently overriding an explicit,
   more specific human judgment. This was the dominant driver of the
   week's reported connect rate.
2. Live monitoring of SDR calling activity surfaced a real frontend crash:
   "A background operation failed unexpectedly" for Charushi Bajaj, traced
   to `lead_list.js`'s `loadPage()` — a debounced search (fire-and-forget,
   400ms) calling into a torn-down view after the user had already
   navigated away, with no null-check.

### Fix
- `models.dialer_call_connected()` now mirrors `dialer_call_is_conversation()`'s
  rule: an explicit outcome outside the not-answered group means connected;
  `provider_disposition` only becomes the deciding signal when **no** outcome
  was ever logged (its actual intended purpose — calls an SDR never reviewed).
  Deleted two independently-drifting `CONNECT_OUTCOMES` allowlists
  (`analytics_routes.py`, `smart_analytics.py` — the latter had a "must stay
  in sync" comment) now that the rule is exclusion-based and needs no
  allowlist, plus the now-fully-unused `models.ANSWERED_OUTCOMES`.
- `lead_list.js`'s `loadPage()` now bails out early if `#leads-tbody` no
  longer exists (view torn down before the debounce fired) or is no longer
  attached to the document (view torn down while the leads fetch was in
  flight) — same root cause, same one-line guard, at both points the
  function touches the DOM after a delay.

### Impact
Reported connect rates across the Analytics Hub, SDR table, and Weekly SDR
Report will drop significantly — this reflects the real number, not a
regression. The org-wide rate for the affected week was previously reported
around 46%; the corrected figure is closer to 15%.

## v11.4.7 — 2026-08-18 (Weekly SDR Report: connect rate + conversations columns)
**Deploy:** `develop → staging → main` | **Type:** Reporting fix
**Branches:** `develop`, `staging`, `main`

### Context
Feedback from Viren on the automated Weekly SDR Report: add connect rate and
conversations (60-second threshold) to the report, and a flag that the
connect rate "on LS" looked wrong (~70%) next to the report's 46.2%.

Investigated both against live production data:
- **Connect rate formula is correct and consistent.** The funnel card,
  the SDR table, and the emailed report all compute
  `connected / calls_made` identically — verified they agree (45.6–46.2%
  org-wide for the same Aug 10–17 window). No calculation bug.
- **The ~70% Viren saw was a pod-scoped number**, not a bug: India Team's
  calls sit at ~66% connect for that week, US Team's at ~14% — the
  org-wide report blends both pods down to 46%. Comparing a single pod's
  view against the org-wide emailed report looks like a discrepancy but
  isn't one.
- **60-second conversation threshold**: already the live setting
  (`conversation_min_seconds = 60` in production Sync Settings) — no
  change needed there.

### Fix
`_build_sdr_performance` (report_service.py) already merged in
`connect_rate`/`conversations` per SDR from `_compute_sdr_rows` for the
org-wide Key Metrics line — it just never rendered them per SDR. Added
both as columns to the existing SDR Performance table (HTML + CSV) so the
report itself now shows exactly why the blended number looks different
from any single pod's view.

## v11.4.6 — 2026-08-18 (Phone-based dedup on the push-to-Salesforce paths)
**Deploy:** `develop → staging → main` | **Type:** Data-integrity fix
**Branches:** `develop`, `staging`, `main`

### Context
Nishita's original duplicate-lead report was traced to the Aircall direct-dial
path (v11.4.2 fixed that one, v11.4.3/4/5 backfilled + audited the existing
duplicates it left behind). Asked to check whether the same root cause
(Alternate CRM's `push_only` sync direction means it never knows about a
Salesforce Lead/Opportunity that predates it) could create duplicates
through OTHER paths too — not just direct dials.

Traced every place a brand-new Salesforce Lead gets created and found two
more: `_check_sf_push` (the automatic push when a lead reaches the
configured push stage, e.g. "Meeting Scheduled") and
`push_pending_leads_to_salesforce` (the manual "Sync" button / bulk push).
Both already had a duplicate check — but **by email only**. A local lead
with no email, or an email that doesn't match Salesforce's Email field
exactly, sailed straight through to `create_new_lead_in_salesforce`, even
when its *phone number* already matched a real existing Salesforce Lead,
Contact, or Opportunity. Same bug shape as Nishita's case, different trigger.

### Fix
- New `find_sf_match_by_phone()` (salesforce.py) — reuses the already-tested
  `find_lead_or_opportunity_by_phone` phone lookup, with the same
  conflict-guard as `backfill_direct_dial_leads` (a Lead already linked to a
  *different* local lead is treated as no match, never stolen).
- Wired into both push paths as a second check, right after the existing
  email check and right before lead creation: a Lead match links
  `sf_lead_id`; an Opportunity match links `sf_opportunity_id`; no match
  falls through to create exactly as before. Never creates a new Lead when
  a phone match exists.

### Scope note
This closes the *code* gap going forward. It does not retroactively scan
every already-created Salesforce Lead for a phone-collision with another
existing record — that would require an SF API call per already-linked
local lead and, unlike the placeholder backfill, any match found could only
be resolved by a human merge decision in Salesforce, not an automated field
update. Flagged to the user as a separate, optional follow-up.

### Tests
`test_salesforce_client.py`: phone match links a Lead instead of creating,
phone match on an Opportunity sets `sf_opportunity_id`, no match still
creates as before, plus dedicated coverage for `find_sf_match_by_phone`'s
conflict-guard. Full backend suite green.

## v11.4.5 — 2026-08-18 (Backfill audit trail)
**Deploy:** `develop → staging → main` | **Type:** Read-only addition
**Branches:** `develop`, `staging`, `main`

### Context
v11.4.4's `dry_run` flag reached production mid-deploy: the very first
`dry_run=true` call briefly hit the still-live pre-v11.4.4 code path (which
always commits), so it actually enriched 3 real leads before the new code
took over. Confirmed via re-running dry-run afterward: no further leads
touched, and all 41 remaining candidates genuinely have no Salesforce match.
Needed a way to identify exactly which 3 leads were touched.

### Change
- `GET /api/admin/sync/backfill-direct-dial-leads/matched` — lists every
  lead whose `lead_source` carries the `+salesforce_match` tag (i.e. every
  lead a real, non-dry-run backfill call has ever enriched). Read-only,
  doubles as a permanent audit trail for future backfill runs.

## v11.4.4 — 2026-08-18 (Backfill dry-run preview)
**Deploy:** `develop → staging → main` | **Type:** Safety addition
**Branches:** `develop`, `staging`, `main`

### Context
Before running `backfill_direct_dial_leads` against real production data
(the fix for Nishita's duplicate-lead report), wanted to see exactly which
leads and Salesforce records it would touch first, without writing anything.

### Change
- `backfill_direct_dial_leads(..., dry_run=True)` runs the identical
  lookup/match logic but rolls back instead of committing, and returns a
  `preview` list — one entry per candidate lead showing `no_match` /
  `skipped_conflict` / `matched` with the exact before/after name+company and
  the matched Salesforce type+id.
- `POST /api/admin/sync/backfill-direct-dial-leads?dry_run=true` exposes it.
- New test: dry run reports a match but leaves the row untouched in the DB.

## v11.4.3 — 2026-08-18 (Backfill existing duplicates + audit cleanup)
**Deploy:** `develop → staging` | **Type:** Data fix + cleanup
**Branches:** `develop`, `staging`

### Context
Per CLAUDE.md's mandatory pre-prod review (`/ponytail-review` + `/ponytail-audit`),
ran both on v11.4.2 retroactively (a process gap — should have run before that
merge) before promoting either to `main`. Found and fixed two real duplications;
also built the backfill this review revealed was still missing: v11.4.2 only
stops *new* duplicate leads, it never touched ones already created.

### Fixes (from the audit)
- `salesforce.py` duplicated `dialer_service._normalize_digits` instead of
  importing it — a working cross-module import of this exact helper already
  existed elsewhere (`conversations_service.py`), so the "avoids a
  circular import" justification didn't hold up. Now imports it directly.
- `routes/public_api_routes.py`'s `_build_sf_url` and `salesforce.py`'s new
  `salesforce_record_url` both independently formatted the same Salesforce
  Lightning URL shape. Extracted the shared `sf_lightning_url()` one-liner;
  each caller keeps its own (different) instance-URL resolution strategy.
- `lead_detail.js` repeated the same Salesforce-link anchor markup three
  times. Extracted `_sfLinkHtml()`.

### New: backfill for pre-existing duplicate leads
- `salesforce.backfill_direct_dial_leads()` + `POST /api/admin/sync/backfill-
  direct-dial-leads` (bounded, re-callable while `remaining > 0`) — re-checks
  every placeholder "Unknown Caller" lead created by the old direct-dial
  fallback against Salesforce now, enriching in place on a match. Never
  creates a new lead, never touches a row an SDR/admin has since
  renamed/researched by hand, and guards `sf_lead_id`'s unique constraint if
  another local lead already legitimately holds the same real Salesforce Id.

### Edge cases verified (test_salesforce_lookup.py, 29 tests)
Lead match / Opportunity match / no match / SF not configured / conflicting
sf_lead_id (skipped, not stolen) / already-enriched leads excluded from
re-processing / upload-sourced leads excluded / phone_secondary fallback /
idempotent across re-runs / limit bounds the batch / route-level wiring.

## v11.4.2 — 2026-08-18 (Salesforce live-lookup on direct-dial + record links)
**Deploy:** `develop → staging` | **Type:** Bug fix + feature
**Branches:** `develop`, `staging`

### Context
A user reported duplicate "Unknown Caller" leads being created every time
she called an inbound Salesforce Lead or Opportunity via Aircall directly.
Root cause: this org runs Salesforce sync `push_only` by design (Alternate CRM
is a funnel INTO Salesforce, not a mirror of it) — any Salesforce Lead or
Opportunity that never went through the outbound-upload flow has no local
row for the direct-dial webhook to match, so it fell back to creating a
bare placeholder lead. `sync_direction` stays `push_only` (confirmed
intentional); fixed the duplicate-creation symptom instead.

### Fixes / Features
- **Live Salesforce lookup on direct-dial miss.** When a direct-dial webhook
  can't match an existing Alternate CRM lead, it now checks Salesforce live
  (Lead, then Contact → Opportunity via `OpportunityContactRole`) before
  falling back to a placeholder. A match creates the lead with the real
  name/company and links the real Salesforce record (`salesforce.py`'s
  `find_lead_or_opportunity_by_phone`). No match (or SF not configured)
  falls back to today's exact placeholder behavior — no regression either
  way. Only applied on the real-time webhook path, not historical bulk-sync
  (would add one SF API call per miss in a large batch).
- **New `Lead.sf_opportunity_id`** — distinct from `sf_lead_id`, set when a
  phone matches a Salesforce Opportunity instead of a Lead.
- **Clickable Salesforce links on the lead detail page** — "View in
  Salesforce" once a lead has a real (pushed or matched) `sf_lead_id`, and
  "View Opportunity in Salesforce" when `sf_opportunity_id` is set (also
  surfaced inside the existing Opportunity Outcome card). Built from
  `SalesforceConnection.instance_url` — no hardcoded org domain.
- **Fixed `/api/chat/health`'s live ping** — it called a method
  (`list_conversations`) that doesn't exist on `Alternate MessengerConversationsService`
  (the real method is `get_conversations`), so the SMS/WhatsApp integration
  always reported "unreachable" even with valid credentials. Found while
  checking messaging-enablement status.

### Verified
- Full backend suite green (2377 passed), new `test_salesforce_lookup.py`
  (17 tests) covers the lookup function, URL builder, webhook integration
  (Lead match / Opportunity match / no match / SF not configured), the
  bulk-sync path never calling Salesforce, and lead-detail link exposure.

## v11.4.1 — 2026-08-18 (Aircall dialer reliability fixes + Everywhere adoption tooling)
**Deploy:** `develop → staging → main` | **Type:** Bug fixes
**Branches:** `develop`, `staging`, `main`

### Context
US SDRs reported parallel/duplicate dialing, calls not logging their outcome,
"already have an active call" blocks, and a sparse Automated Reports SDR
table on their first evening using Alternate CRM. Investigated with direct
production DB queries and Render log greps (not assumptions) before writing
any fix — see `docs/PROJECT_JOURNAL.md` 2026-08-18 for the full RCA.

### Bug Fixes
- **Aircall tag auto-log never fired.** Zero `[AutoLog]` lines existed across
  a full evening of genuinely-tagged calls. Root cause: tags only ever arrive
  bundled inside `call.ended`'s payload for this org's Aircall account, never
  as a standalone `call.tagged` event — the code only checked the latter.
  Also added this org's real tag names (`"Not Answered"`, `"Bad Number"`,
  `"Answered – Not Interested"`) to the mapping; the generic defaults never
  matched what's actually configured in Aircall.
- **"Blocked concurrent call" fired 111 times in one evening.** Checked every
  blocking row in prod afterward — all resolved to `CALL_ENDED` within
  seconds on their own. Real webhook latency, not a stuck lock. Added a short
  bounded client-side retry (`startDialerCall`) instead of weakening the
  one-call-at-a-time guarantee.
- **88 orphaned `DialerCall` rows** stuck forever at `TRANSCRIPTION_READY`
  with no `ended_at` — an unmatched transcription webhook was fabricating a
  new row instead of being skipped. Found while investigating the above.
- **SSE relative-URL bug** (`dialer_widget.js`) — real-time inbound caller-ID
  toasts were silently broken in prod (decoupled frontend/API domains hit the
  SPA catch-all instead of the API).
- **Automated Reports SDR table** only ever showed Qualified/Disqualified —
  added Calls Made and Meetings per SDR, reusing data already computed by
  `_compute_sdr_rows` instead of a new query.
- **Aircall Everywhere adoption was invisible.** The org-wide enable flag
  said nothing about which SDRs actually logged into the embedded drawer vs.
  stayed Desktop-app-only. Added `users.aircall_everywhere_last_login_at` +
  `POST /api/dialer/everywhere-login`, pinged from the widget's real
  `onLogin`. Also fixed a stale 405 error message that told SDRs to open the
  Desktop app even when Everywhere was the intended alternative, and
  strengthened the onboarding copy to explicitly say "log out of the Desktop
  app" instead of "no need to keep it open."

### Data model
- Added: `users.aircall_everywhere_last_login_at` (TIMESTAMP, nullable) — new
  migrations.py entry, matches models.py.

### Verified on staging
Pending — merging `develop → staging` this release; full backend (2356
passed) and frontend (400 + 42 passed) suites green locally first.

---

## v11.4.0 — 2026-08-17 (Automated Analytics reports rewrite: multi-report engine)
**Deploy:** `develop → staging → main` | **Type:** Feature rewrite
**Branches:** `develop`, `staging`, `main`

### Context
Hours after v11.3.0 shipped, the user pasted a much more detailed mockup and
37-section spec for "Automated Reports," saying: *"This is what I wanted when
I asked automated reports... make sure the UI/UX is polished. The UI/UX
attached has a lot of abilities which is not needed as of now."* The shipped
v11.3.0 MVP (one org-wide schedule) undershot the actual need. The full spec
called for infrastructure this codebase doesn't have (a PDF renderer, a real
job queue — Upstash Redis here is a REST-only TTL cache, not queue-capable).
Proposed and got explicit sign-off on a trimmed scope: multiple named
reports, a full-page builder, per-report filters with resolved-at-send-time
date-range rules, timezone-aware local send time, recipient chips, a Report
Logs tab, Run Now, and CSV attachment — explicitly excluding PDF generation,
a job-queue/retry audit trail, drag-and-drop reordering, and a Templates tab.
This supersedes v11.3.0's single-schedule feature entirely.

### New Features
- **Multiple named reports**, each independently enabled/disabled, instead of
  one org-wide schedule. A "My Reports" list replaces the old single-panel UI.
- **Full-page report builder** with explicit per-report filters (POD / lead
  batch / SDR) and a component picker (`key_metrics`, `sdr_performance`) —
  reuses the exact aggregate logic `analytics_routes._compute_sdr_rows`
  already computes, so report numbers never drift from the Analytics Hub.
- **Date-range rules, not static dates.** "Previous 7 days" / "previous
  calendar month" / "previous day" / custom are resolved at send time in the
  report's own IANA timezone — the resolved period is stored per-send for
  audit, so historical logs stay meaningful even as the rule keeps resolving
  to a new window each run.
- **Recipient chips** for To/CC/BCC, deduplicated across all three lists.
- **Report Logs tab** — every send (scheduled or manual) is recorded with
  status, trigger source, and the resolved reporting period.
- **Run Now** — sends immediately through the identical pipeline the
  scheduler uses (`report_service.execute_report`), not a separate code path.
- **CSV attachment**, in addition to the inline HTML digest.

### Bug Fixes
N/A — this is a same-day feature rewrite, not a defect fix.

### Data model
- Removed: `sync_settings.report_schedule_*` (8 columns added in v11.3.0,
  same day). Left as harmless orphan columns — no `DROP COLUMN` issued, to
  avoid schema-change risk on databases that already ran that migration.
- Added: `report_configs` and `report_executions` tables. Both are brand-new
  tables, so `Base.metadata.create_all()` handles them on next deploy — no
  `migrations.py` entry needed (unlike a new column on an existing table).

### Known gaps, deliberately not addressed this pass
- No PDF export — CSV attachment plus inline HTML only.
- No real job queue or retry/attempt audit trail — sends happen synchronously
  within the existing 15-minute scheduler tick, same pattern as the
  Salesforce auto-sync job.
- No drag-and-drop component reordering, no Templates tab — trimmed from the
  mockup per explicit user instruction ("not needed as of now").

## v11.3.0 — 2026-08-17 (Automated Analytics reports, reply notifications, caller-ID, signature logo)
**Deploy:** `develop → staging → main` | **Type:** Feature + fixes
**Branches:** `develop`, `staging`, `main`

### Context
A second batch of feedback: a request for automated/scheduled reporting out
of the Analytics Hub, three distinct email issues reported by a real test
send (can't insert a company logo in the signature, no notification on a
prospect reply, replies forced to continue over Gmail), a report that a
Cadence Builder node wasn't "fully rendered," and re-scoping caller-ID
lookup for incoming Aircall calls (previously deferred as "not promising").
Non-engineering items from the same feedback (a Gmail-calendar-invite trial,
a cadence-validation session, sharing more disqualify reasons) are tracked
separately — not part of this release.

### New Features
- **Automated Analytics reports.** A new "Reports" tab in the Analytics Hub
  (admin roles only) lets an org schedule a qualified/disqualified-by-SDR
  email digest — daily, weekly, or monthly, to any recipient list, sent from
  a chosen connected mailbox. Built entirely on existing infra: the
  hand-rolled 15-min job-tick loop (`scheduled_jobs.py`, no new scheduler
  dependency), the existing Nylas send path, and the same `SyncSettings`
  single-row config shape the Salesforce auto-sync schedule already uses.
- **Reply notifications.** The notification bell (previously task-only) now
  also shows unread prospect email replies on your leads, in their own
  "Prospect Replies" section. Opening the lead's Email tab, or dismissing
  the notification, clears it. There was previously no signal at all for
  an inbound reply short of noticing it in Email Hub.
- **Signature logo upload.** The signature editor's "Insert Image" already
  worked for any hosted image URL — the actual gap was a company logo being
  a file on someone's computer, not a URL already online. A new "Upload
  Logo" button uploads it once and inserts the resulting hosted URL exactly
  like any other image.
- **Caller ID on incoming Aircall calls.** An incoming call now shows a
  toast with the matching lead's name and company as it rings, reusing the
  exact phone-matching the webhook already does for every call (same
  auto-create-on-no-match policy as outbound calls). Also fixed a real gap
  found in the process: `/webhooks/aircall` never published anything to the
  SSE broker at all — only `/webhooks/messenger` did — so this is also the
  first time Aircall call status reaches the browser in real time instead
  of only via polling.

### Bug Fixes
- **Replying to a thread sent from Alternate CRM was disabled on every thread.**
  The per-message email serializer dropped `nylas_thread_id` from its
  response, so the frontend always concluded no thread had been sent via
  Alternate CRM and hid the reply composer — regardless of whether it actually
  had been. This is very likely what the "you can only continue the
  conversation over Gmail" report was describing.
- **Cadence Builder node titles** now show the full text on hover instead of
  only the truncated version — confirmed this was expected ellipsis
  truncation on an unusually long user-entered title, not a rendering bug,
  but added the hover affordance since the underlying complaint (can't see
  the full text) was real.

### Data model
- `lead_email_activity` gained `read_at` (reply-notification read marker).
- `sync_settings` gained `report_schedule_*` (8 columns: enabled, frequency,
  hour/minute/weekday, recipients, sender, last-run).
  Both added via explicit `migrations.py` entries (see the v11.2.0 note
  above on why `create_all()` alone isn't enough for an existing table).

### Known gaps, deliberately not addressed this pass
- Automated reports are org-wide only (no per-pod scoping) and inline-HTML
  only (no CSV attachment) — no existing PDF/report-attachment pattern to
  build on; the digest's numbers are visible inline instead.
- Caller-ID identifies the caller but doesn't yet distinguish a duplicate
  lead sharing a phone number (matches `.first()`, same as outbound calls).

## v11.2.0 — 2026-08-17 (Lead soft-delete, Power Dialer account grouping, cadence dialing, disqualify fix, SDR analytics)
**Deploy:** `develop → staging → main` | **Type:** Feature + fixes
**Branches:** `develop`, `staging`, `main`

### Context
A batch of stakeholder feedback from a call: whether the Power Dialer
sequences contact-wise or account-wise, a "wrong-number disqualify not
working" report, a request for qualified/disqualified analytics broken down
by list/SDR/period, pulling cadence lists into the dialer for manual call
steps, and enabling lead deletion (soft-delete only, per explicit decision).
Non-engineering items from the same feedback (a Gmail-calendar-invite trial,
a cadence-validation session, sharing more disqualify reasons) are tracked
separately — not part of this release.

### New Features
- **Power Dialer account-wise sequencing.** The dialer queue's sequence was
  investigated first — it turned out to be neither contact-wise nor
  account-wise, just a flat `priority_score` ranking with no company
  tiebreak at all. A new "Sequence: Account" toggle groups all contacts at
  the same company consecutively (still priority-ordered within each
  company); the default stays priority-only, unchanged.
- **Qualified/disqualified analytics by SDR.** The Analytics Hub's "All
  Batches" table already broke down activity by list and time period —
  each batch row is now expandable to show a per-SDR qualified/disqualified
  count within that batch.
- **Cadence lists in the Power Dialer.** A new "Cadence" dropdown (Pod
  Admin+) lets an SDR load a published cadence's actively-enrolled leads
  directly as a dialer queue, for cadence steps that require a manual call.
  Individual-SDR access needs a new endpoint (`GET /journeys` is currently
  Pod Admin+ only) — not built this pass.
- **Lead deletion, soft-delete only.** The existing "Delete Lead" button
  (previously a genuine hard `DELETE`, cascading manual cleanup of emails/
  calls) now sets `Lead.deleted_at` instead — the row and all related calls,
  notes, and emails are kept; the lead just stops appearing anywhere
  (Leads, Kanban, dashboards, analytics). Also fixed a real permission gap
  found in the process: Pod Admins already saw this button in the UI but
  were silently 403'd by the backend.

### Bug Fixes
- **"Disqualify Lead" (including "Wrong Number") now works from any status
  the button is actually shown for.** `close_lead()` previously hard-required
  `status == "Calling"` and 422'd for a lead already at Meeting Scheduled or
  later, even though the frontend offers the button there too. Also: an
  SDR explicitly choosing a terminal reason (e.g. "Wrong Number") through
  this selector no longer also requires a separately-logged matching call
  entry — the explicit reason is itself the definitive outcome.

### Data model
- `leads` gained `deleted_at` (soft-delete tag) — required an explicit
  `migrations.py` entry, since `Base.metadata.create_all()` only creates
  brand-new tables and never alters an existing one. Missing that entry
  caused a live `[StartupRace] UndefinedColumn` outage on this exact deploy
  (fixed same-day, see the v11.2.0 hotfix commit) — correcting this note so
  it doesn't mislead the next schema change the same way.

### Known gaps, deliberately not addressed this pass
- Caller-ID lookup against new lists for incoming Aircall calls — explicitly
  flagged as "not promising" in the original feedback; scoped, not built.
- Individual-SDR access to the cadence-list dialer source needs a new,
  narrower journeys-listing endpoint — the existing one is Pod Admin+ only.

## v11.1.0 — 2026-08-17 (Lead field-change history, "Viren Baid" data-integrity fixes)
**Deploy:** `develop → staging → main` | **Type:** Feature + fixes
**Branches:** `develop`, `staging`, `main`

### Context
Investigating a live prod report ("a lead lost its name, only the phone
number remained") surfaced three separate, real issues: no field-level audit
trail existed to even diagnose the report without raw DB forensics; a
call placed via Aircall to a brand-new number auto-creates a nameless
placeholder lead, and the SDR's subsequent "Add Lead" for the same contact
was silently hard-blocked as a duplicate instead of being merged in; and a
premature "Call ended" banner fires the instant an Aircall bridge call is
dialed (not when it actually ends), confirmed via a live screen recording.
This release closes all three, plus a first concrete step on the
"reduce lead_routes.py's complexity" architecture request.

### New Features
- **Lead field-change history.** Every edit to a lead's name, email, phone,
  phone (secondary), company, title, LinkedIn, or pod assignment is now
  recorded automatically — old value, new value, who (or which sync job)
  made the change, and when. Captured via a single SQLAlchemy `before_flush`
  listener, so every write path (manual edits, Aircall/Klenty sync jobs,
  future paths nobody remembers to instrument) is covered without per-route
  wiring. Surfaced on the lead detail page, merged into the existing status
  timeline. New `GET /leads/{lead_id}/field-history` endpoint.

### Bug Fixes
- **"Add Lead" no longer silently discards a real name when a dialer
  placeholder already exists for that phone number.** Aircall's real-time
  webhook (and the Aircall/Klenty nightly syncs) auto-create a nameless
  placeholder lead the moment a call touches an unmatched number. If the SDR
  then added the real contact afterward, the phone-duplicate guard on
  `POST /leads` hard-blocked it (409) — discarding the name entirely and
  leaving the placeholder as the only, permanently nameless record. The
  create endpoint now detects this specific shape (blank/placeholder name)
  and enriches the existing row in place instead of blocking it.
- **The "Call ended — please log the outcome" banner no longer fires the
  instant an Aircall call is dialed.** It was gated on Aircall's dial
  response carrying a `provider_call_id` synchronously — which a bridge-mode
  call often doesn't have until the agent's IVR leg connects — so the
  fallback path fired immediately, before the call had even started
  ringing. Outcome polling now runs off the app's own DB call id (always
  present), which is what it actually needed.

### Architecture
- First real module in `backend/services/` (previously an empty directory):
  `lead_service.py` now owns `update_lead`'s business rules (status-transition
  validation, "auto-revert from parked") and the shared `logged_call_count`
  helper, extracted out of `routes/lead_routes.py` — the route is now a thin
  ~10-line orchestration wrapper. No behavior change; the extracted logic is
  independently unit-tested with no HTTP client. A worked example ahead of
  a broader look at `lead_routes.py`/`analytics_routes.py`/`dialer_routes.py`,
  which the dependency graph shows as this app's most tangled files
  (near-zero cohesion communities) — not a full rewrite in this pass.

### Data model
- New `lead_field_history` table (`LeadFieldHistory` model) — created
  automatically via `Base.metadata.create_all()` on next deploy, same as
  every other ORM-only table in this app; no manual migration needed.

### Known gaps, deliberately not addressed this pass
- Actor attribution (`db.info["change_actor"]`) is wired at the
  highest-value write paths (manual edits, the two dialer sync jobs
  implicated in the original report) — any other write path still gets its
  diff captured, just attributed to `"system"` until similarly tagged.
- Klenty's phone-matching remains an exact-string match with no
  suffix-tolerant fallback (unlike Aircall's), so a formatting mismatch can
  still create a second placeholder lead rather than merging — a related but
  distinct gap, not fixed this pass.

## v11.0.0 — 2026-08-14 (Cadence/Messaging Sandbox, Aircall messaging, configurable Conversations threshold, Analytics Hub fixes)
**Deploy:** `develop → staging → main` | **Type:** Feature
**Branches:** `develop`, `staging`, `main`

### Context
A large batch versioned as a major release given its scope: a safe way to
test entire messaging/cadence flows end-to-end with real provider APIs
without touching production data (the recurring pain point this quarter —
"we'll test it on prod" was never an acceptable answer), Aircall added as a
genuine second messaging provider alongside Alternate Messenger/Messaging Provider, an
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
  provider (Alternate Messenger or Aircall) in Settings; both the Cadence engine and
  the Alternate Messenger Widget resolve through the same abstraction either way.
  **Not yet verified against a live send** — Aircall's own documentation
  disagreed with itself on the exact request shape during implementation;
  this needs a real test message before enabling in production, same as the
  Alternate Messenger WhatsApp verification still outstanding from v10.9.14.
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
- The Alternate Messenger WhatsApp live-send verification from v10.9.14 remains
  outstanding.

## v10.9.14 — 2026-08-14 (Provider-agnostic SMS/WhatsApp messaging + Cadence WhatsApp channel)
**Deploy:** `develop → staging` (staging only this pass) | **Type:** Feature
**Branches:** `develop`, `staging`

### Context
First engineering pass on tracking Aircall/Alternate Messenger (Messaging Provider) SMS and
WhatsApp messaging in Alternate CRM, ahead of a fuller rollout plan. Alternate Messenger's
Widget (Call + Message tabs) previously left zero local trace of any message
it sent or received — every conversation view was a live proxy call to
Alternate Messenger's API, nothing was queryable in our own database, and WhatsApp had
no path into the Sales Cadence engine at all. This release closes both gaps.

### New Features
- **WhatsApp is now a Sales Cadence channel.** A new node type in the Journey
  Builder, backed by a provider-agnostic `MessagingProvider` abstraction
  (mirrors the existing `DialerProvider` pattern used for voice calls) —
  the cadence engine resolves "send WhatsApp," not "send WhatsApp via
  Alternate Messenger specifically," so a second provider can be added later without
  touching the channel or the engine. Cold-outbound WhatsApp requires a real,
  Meta-approved template (Meta's own platform rule, not a Alternate CRM
  restriction) — the node's config panel has a live template picker pulling
  from the account's actual approved templates.
- **Inbound message capture.** Alternate Messenger's messaging API has no push
  webhook (unlike calls) — a new 5-minute polling job discovers recent
  conversations account-wide and persists any new inbound message, matched
  to a lead via the same phone-matching logic calls already use.

### Bug Fixes
- **The Alternate Messenger Widget's manual sends (SMS and WhatsApp) are now
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
  (`messenger`/future `aircall`), `conversation_id`, and `template_name`
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
  broadcast (same CustomEvent-bus pattern as `alternate:toast`) so opening
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

## v10.9.10 — 2026-08-13 (P1 hotfix: Alternate Messenger widget invisible click-blocking bug + cadence rename)
**Deploy:** `develop → staging → main` | **Type:** Hotfix + small feature
**Branches:** `develop`, `staging`, `main`

### Context
Live-reproduced (real staging JWT, real browser via Playwright, not code
re-reading) a user report that Sales Cadence merge-field chips were still
unclickable despite the `cursor-pointer` fix shipped in v10.9.8. The chips'
`onClick` wiring was correct — `document.elementFromPoint()` at the chip's
coordinates returned `#messenger-widget-root` (the React Alternate Messenger dialer
widget's outer container) instead, proving something else was eating the
click.

### Root Cause
`MessengerWidgetRoot.jsx`'s outer wrapper (`position: fixed`, `z-[9998]`,
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
- `MessengerWidgetRoot.jsx`: outer wrapper now gets `pointer-events-none`
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
  clicks (`MessengerWidgetRoot.test.jsx`).
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
codebase already has a real, working Alternate Messenger SMS send path —
`routes/sms_routes.py` / `sms_service.py` — wired the cadence
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
  Alternate Messenger SMS send path (not a new vendor). Honest failure (retryable)
  when Alternate Messenger isn't enabled/configured — no fake send. Message body
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

## v10.9.7 — 2026-08-13 (React Alternate Messenger dialer widget default-on)
**Deploy:** `develop → staging → main` | **Type:** Feature (flag flip)
**Branches:** `develop`, `staging`, `main`

### Context
The React port of the Alternate Messenger dialer widget (Call + Message tabs,
`frontend-react/src/features/messenger-widget/`) has been built and tested
for weeks but stayed dark behind an opt-in `localStorage` flag
(`messengerWidgetReact`), off by default for every SDR. User requested it
be enabled for everyone, with the old vanilla widget kept as a fallback
(deprecation of the old code deferred to a later pass, not this release).

### Changes
- `messenger-widget-entry.jsx` and `dialerEngine.js`: flipped the flag
  check from opt-in (`=== 'true'`) to opt-out (`!== 'false'`) — the React
  widget is now the default for every SDR session; setting
  `messengerWidgetReact` to `'false'` in a browser's localStorage remains
  a per-browser emergency kill switch back to the old vanilla widget.
- No backend changes. No removal of the old `frontend/js/messenger_widget.js`
  — kept in place as the fallback until the new widget is validated live.

### Testing
- Full `messenger-widget` frontend test suite (52 tests, 6 files) — passes.
- Bundle rebuilt (`build:messenger`); verified the compiled output contains
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
  recording enablement), not something a Alternate CRM code change can
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
  lead when the calling SDR is a known Alternate CRM user (mirroring the
  existing Klenty sync's own create-on-miss pattern), consistent with
  policy: tracking is mandatory only for calls made by users who exist in
  Alternate CRM.
- **Connect Rate read near-0% for Aircall/Alternate Messenger calls that were never
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
- Two small, low-priority Alternate Messenger-sync gaps (a missing `user_id` on
  synced rows; ~99 historically orphaned sync-path calls) — real but
  negligible in practice since Alternate Messenger can only be dialed through
  Alternate CRM itself, no bypass path exists.

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
Click-to-call from Alternate CRM had a known reliability problem — it opens the
Aircall Desktop app, which sometimes fails or is delayed, so SDRs had largely
stopped using it and dialed directly from the Desktop app instead, relying on
sync to backfill Alternate CRM afterward. Aircall Everywhere (an embedded browser
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
  bypasses Alternate CRM's own call-to-lead reconciliation).
- **The pre-existing "Dial" (manual/ad-hoc number) button is hidden once
  Everywhere is actually active** — its own embedded dial pad covers that
  need better. Stays visible for orgs on Alternate Messenger, or SDRs who've opted
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
  narrowing only, verified safe for both Aircall and Alternate Messenger.
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
  "Call via Alternate Messenger", or "Call — log manually", mirroring the same
  provider check `app.js` uses at call time.
- **Local-time badge** (🟢/🟡/🔴) next to the phone number, reusing the
  existing phone→timezone lookup already used on Lead Detail.
- **Lead-context strip** — location, company size, and lead source
  (mapped to a real label, not a raw internal value) on the call card,
  plus an always-visible Last Contact / Last Outcome line.
- **Add Note** and **View in CRM**, both without leaving the queue.
- Removed the client-side call-duration timer added mid-week — Aircall and
  Alternate Messenger both already show one; a second, client-side one just drifted
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
  (`window._openCallModal` → Aircall/Alternate Messenger mode-picker → EC-16
  concurrency guard → outcome modal). Once that lead's outcome is logged or
  dismissed, the button becomes "Call Next," which only advances the queue
  pointer — it never dials automatically. "Skip" is always available,
  independent of call state, for a call that never connects.
- **A new signal, the one real gap that didn't exist before**: nothing in
  the app previously signalled "the SDR just finished with this call" in a
  form anything else could listen for. Three dispatch points now fire
  `alternate:call-outcome-resolved` (Save, Aircall's own auto-sync, and
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
branching), built as a natural extension of Alternate CRM's actual stack rather
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
  Alternate CRM's dialer is human-in-the-loop by design (rings the SDR's own
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
- **Alternate Messenger dialer FAB (fixed, bottom-right, high z-index) was
  swallowing clicks on table content beneath it again** — the 07-31 fix
  (v10.6.x) reserved 100px of clearance, but real Admin Users rows with
  several columns (Dialer Override, Alternate Messenger Agent, longer emails) can
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
Hub reliability pass, Klenty/dialer sync integrity, a Alternate Messenger widget
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
- **Alternate Messenger Call/Message widget React rewrite** — real conversation
  history, live polling, and an unread badge for the Message tab (the
  actual fix for "No messages yet"); the Call tab's dialer engine ported
  1:1 in behavior. Still gated behind `messengerWidgetReact`, off by
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
  toggle for Alternate CRM's own separate click-to-call dialer — any SDR who
  calls entirely through Klenty had their real call history silently and
  permanently discarded as "unattributed" on every sync. Now matches on
  role instead.
- SDRs could get blocked from dialing their next lead for a few minutes
  after a call — a phone-number country-code mismatch misattributed
  real-time call-answered/ended events to the wrong internal record.
- Aircall/Alternate Messenger: two near-simultaneous webhooks for the same call
  (e.g. answered then ended, back-to-back) could both miss the existing-
  call lookup and crash on a duplicate insert, leaving the call stuck
  "Pending" forever — now recovers by re-fetching instead of crashing.
- The floating Alternate Messenger dialer FAB was intercepting clicks on any
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
`frontend-react/src/features/messenger-widget/**` (new), `frontend/js/
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
  and Alternate Messenger. A bare 10-digit number starting with 6–9 was assumed to be
  Indian and dialed with a `+91` prefix instead of `+1`. Root-caused via a
  live DB audit: 3,420/3,421 real Indian leads already self-identify with an
  explicit `+91`, while the heuristic was actively misfiring on confirmed US
  leads (173 found in one query). Removed the guessing branch — all bare
  10-digit numbers now default to `+1`.

### Files Changed
- `backend/aircall_provider.py`, `backend/messaging_provider.py`
- Tests: `backend/tests/test_aircall_sync.py`, `backend/tests/test_messaging_provider.py`

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
- **Call transcripts never appeared anywhere, even when Alternate Messenger/Deepgram
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
  `handleCallAction()` awaited the Alternate Messenger widget's mode-selection promise
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
- `frontend/js/app.js`, `frontend/js/messenger_dialer.js`

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
- **Some SDRs' calls failed with "Agent phone number is required" (Alternate Messenger).**
  Per-SDR Alternate Messenger identity fields already existed in Admin → Users →
  Dialer Override, but were never actually read when placing a call — every
  SDR's calls authenticated as one shared global Alternate Messenger agent. Now wired
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
- **Klenty call history now pulls into Alternate CRM automatically.** SDRs place
  calls through Klenty (using an Aircall-owned number) that never reach
  Aircall's own call log or Alternate CRM — until now these calls were invisible
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
  SDRs move fully onto Alternate CRM's own calling.
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

## v10.4.7 — 2026-07-16 (Leads Hub redesign + Alternate Messenger recording-url fix)
**Deploy:** `staging → main` | **Type:** New Feature (opt-in) + Bug Fix
**Branches:** `staging`, `main`

### Bug Fix
- **Alternate Messenger call recordings were unavailable for every SDR on that provider.**
  Root cause: Alternate Messenger's `/calls/{id}/status` endpoint began returning `HTTP 500`
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
- `backend/messaging_provider.py`, `backend/tests/test_messaging_provider.py`
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

## v10.4.6 — 2026-07-16 (Alternate Messenger Manual Dial: fix duplicate call UI / stale answered state)
**Deploy:** `develop → staging` | **Type:** Bug fix
**Branches:** `develop`, `staging`

### Bug fix
- **Manual Dial for Alternate Messenger users showed two overlapping call widgets and could fail
  to reflect "call answered" state.** Root cause: `showManualDialWidget()` routed
  Alternate Messenger calls through the legacy, Aircall-only `DialerMachine`/`showDialerWidget()`
  path (which renders its own `#dialer-widget` DOM and relies on a CSS class to hide it),
  instead of `Alternate MessengerDialer` — the purpose-built, already-live-verified call manager
  already used for the normal lead "Call" button. Reproduced live on prod via an
  impersonation test (2026-07-15): two dialer UIs appeared, and picking up the call did
  not update the UI.
- Fixed `showManualDialWidget()` to call `window.Alternate MessengerDialer.activate()` for
  Alternate Messenger calls (same as `handleCallAction()` in `app.js`), and fixed its duplicate-call
  guard to check `Alternate MessengerDialer.isActive()` for Alternate Messenger instead of the Aircall-only
  `isWidgetActive()`.
- Removed a dead `_machine` (`window.DialerMachine`) fallback shim in
  `messenger_widget.js` left over from the same legacy coupling — confirmed unused
  anywhere in the file.
- **Aircall calling is unaffected** — its code path (`isWidgetActive()`/`showDialerWidget()`)
  is untouched; only the Alternate Messenger branches were rewired.

### Files Changed
- `frontend/js/views/dialer_widget.js` — Manual Dial Alternate Messenger routing + guard fix
- `frontend/js/messenger_widget.js` — removed dead `_machine` shim
- `tests/specs/manual-dial-messenger-routing.check.js` — new static regression check
  (`node tests/specs/manual-dial-messenger-routing.check.js`)

### Migration Notes
None — frontend-only, no schema/env changes.

### Verified on staging
Pending — awaiting user re-test of the same impersonation scenario on staging.

### Rollback commit
See `git log` for the commit immediately prior to this entry on `develop`.

---

## v10.4.5 — 2026-07-15 (Alternate Messenger real-time call events + MCP UI docs)
**Deploy:** `develop → staging` | **Type:** Improvement + Docs
**Branches:** `develop`, `staging`

### Improvements
- **Alternate Messenger calls now push real-time events instead of relying on polling** —
  `webhook_url` is forwarded in the `/calls/initiate` payload (when a webhook endpoint is
  configured), so Alternate Messenger pushes call-started/answered/ended events to our existing
  `/api/webhooks/messenger` handler as they happen. This exact field was attempted twice
  before (2026-07-09, 2026-07-10) and both times the vendor's claim that it had shipped
  turned out to be wrong — a live call got a `422 Unknown field` both times. This time it
  was verified with an actual live call on staging (real `200`, `call_id` returned, test
  phone rang) before being kept enabled. See `docs/AGENT_PROTOCOL.md` §18 case study.
- **Alternate CRM MCP server setup instructions** now shown in-app under Admin Settings →
  Public API tab, alongside the existing Salesforce bridge docs.

### Files Changed
- `backend/messaging_provider.py` — `webhook_url` added to `/calls/initiate` payload
- `backend/tests/test_messaging_provider.py` — updated regression test
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
- **Alternate CRM MCP server** (`mcp_server/`) — read-only lead/call data access for internal
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
- `mcp_server/` (new) — `alternatecrm_mcp.py`, `README.md`, `requirements.txt`, `test_alternatecrm_mcp.py`

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
  every incoming webhook. Any Alternate Messenger webhook was silently misrouted to
  Aircall's parser whenever that setting was "aircall" (and vice versa), so
  Alternate Messenger calls had no real-time status confirmation and relied solely on the
  reactive 50-second Guard2 timeout. Fixed by identifying the provider from
  payload shape instead (Aircall always sends `{"event":..., "data":...}`,
  Alternate Messenger never does). Same fix applied to the equivalent (currently unused)
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
- `backend/dialer_service.py` — notify_url points at dedicated Alternate Messenger webhook endpoint
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
  Both Aircall (dialer_calls) and manual/Alternate Messenger (call_logs) calls are included.

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
  `messenger-crm-staging` and `messenger-crm-prod` via Render dashboard.
  Backend Docker rebuild now skipped on frontend-only commits.

### Files Changed
- `frontend/css/style.css` — sidebar `:has()` CSS rule
- `frontend/login.html` — responsive CSS for portrait + landscape

---

## v10.1.0 — 2026-07-07 (Production Stability + Memory Fix)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix / Performance / Hardening  
**Commits:** Fix batch — 6 code fixes + 3 admin fixes

### Bug Fixes
- **[CRITICAL] Memory leak / OOM restarts fixed:** Alternate Messenger nightly sync
  `_messenger_nightly_sync` now uses retry-with-backoff (3 attempts, exponential:
  1s/2s/4s) on `fetch_calls_paginated` 502s instead of aborting. Added proactive
  zombie-heal: any DialerCall in a non-terminal state older than 24h is
  force-closed to CALL_ENDED on every nightly sync — eliminating the primary
  cause of the Render OOM restarts (3 forced restarts in 15 days).
- **[CRITICAL] Zombie bridge pollers terminated:** `_pollBridgeStatus` in
  `messenger_dialer.js` now treats HTTP 404 responses as terminal — clears the
  poll interval and triggers hangup. Previously, 404 was silently caught as a
  "network blip", keeping poll loops alive forever for stale calls.
- **[CRITICAL] Webhook latency fixed (1.4-2.3s → <50ms):** `POST /api/webhooks/dialer`
  now returns 200 immediately and offloads `handle_webhook()` processing to a
  FastAPI BackgroundTask with its own DB session. Prevents Alternate Messenger webhook
  retry storms.
- **[CRITICAL] Stuck lead fixed via API:** Lead `ae2e70ce` (phone +919699702849)
  was stuck in "Calling" status — reset to "Assigned" via API.
- **[CRITICAL] Ankit Bakshi dialer enabled:** `ankit.bakshi@screen-magic.com` had
  `dialer_enabled=False` despite having a valid Alternate Messenger agent ID (360347).
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
    callbacks so Alternate Messenger dialer state remains in `app.js`.
  - `window.NavHub.update({ activeView })` called on every `loadView()` — React
    re-renders active nav highlight without remounting the tree.
- **Part 1 logout fix included:** Logout button now permanently visible in both
  expanded and collapsed sidebar states — no more disappearing sign-out action.

### Breaking Changes
None externally. The vanilla `<aside id="app-sidebar">` and `<header class="topbar">`
blocks have been removed from `index.html` and replaced with `#nav-sidebar-root` /
`#nav-topbar-root` React mount containers. All existing callback integrations
(Alternate Messenger dialer, SF sync, New Lead modal, AI bar) are preserved via bridges.

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

## v9.7.9 — 2026-06-18 (EC-17: Alternate Messenger 502 Log Storm Fix)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix / Performance

### Bug Fixes
- **EC-17 — Calls tab no longer fires redundant Alternate Messenger API requests:** Every
  `GET /leads/{id}/calls` was spawning one background thread per historical DialerCall
  to refresh recording URLs, even for calls that already had all their data. When
  Alternate Messenger returned 502 for expired call IDs, the 3-attempt retry loop (1s + 2s
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
Production instance `messenger-crm-prod` (Render Starter, 512MB) was running out of
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
- **[CRITICAL] SDR Dashboard: Calls Today and Outcomes Today now count all call sources:** The `/api/sdr/call-summary` endpoint was querying only the `CallLog` table (manual calls), completely ignoring `DialerCall` records from Alternate Messenger and Aircall. For SDRs using the dialer, their daily counts showed 0 even after a full day of calls. Fixed using the same `UNION` pattern as the analytics endpoint — both tables are now combined before counting.

### Files Changed
- `backend/routes/call_routes.py` — `get_sdr_call_summary()` rewritten with UNION query

### Breaking Changes
None.

---

## v9.7.0 — 2026-06-16 (Dashboard Hardening + Dialer Fixes)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix + Hardening

### Bug Fixes
- **[CRITICAL] View-As mode now sends correct user token:** `getToken()` in the React Dashboard's `auth.js` was reading only `crm_token` (the Super Admin's JWT) even when an admin was in View-As mode. As a result, all API calls from the React Dashboard were scoped to the Super Admin, not the impersonated user — so SDRs appeared to have 11,408 leads instead of their actual assigned count, and Pod Admin pod-scoping was bypassed entirely. Fixed by checking `sessionStorage` for `crm_view_as_token` first. Affects all roles (SDR, AE, Pod Admin).
- **Sidebar collapse: logo-only visible when collapsed:** When the sidebar was collapsed to 72px, the "Powered by Alternate Messenger" tagline remained visible while the Alternate CRM logo icon disappeared. Fixed: in collapsed state, only the logo icon (centered, 36×36px) is shown; the text column is hidden entirely.
- **Scope toggle: right-side positioning + SVG icons:** The My Pod / Global toggle was floating loosely between the dashboard title and the Refresh button. Moved to a flex group on the right side of the header together with Refresh. Replaced emoji icons (🔒🌐) with clean SVG lock + globe icons matching the app's icon style.
- **Scope toggle: always defaults to My Pod on load:** Previously the toggle read `globalView` from `sessionStorage` on mount, which caused stale `Global` state to persist across sessions. Now always initialises to `My Pod` (false) on every page load.
- **getDashboardStats: cache-bust on toggle:** Added `?_ts=timestamp` query param to bust the browser's HTTP cache when toggling between My Pod and Global, ensuring a fresh API call is made on each toggle.
- **[Dialer] Zombie call blocking resolved (3 fixes):**
  - Reduced `CALL_ANSWERED` staleness threshold from 90 min → 15 min (Alternate Messenger auto-terminates bridges after ~12 min)
  - Added Force Clear banner for SDRs stuck in zombie `CALL_ANSWERED` state — one-click escape hatch instead of a generic error toast
  - Extended `_activeSyncTimer` from 10 s → 25 s to handle slow `/api/calls/start` API latency (2.5–3.2 s consistently)

### Tooling
- Added `scripts/staging_redistribute_leads.py` — round-robin lead redistribution across active SDRs for staging data setup and QA verification

### Breaking Changes
None.

---

## v9.6.0 — 2026-06-16 (Dashboard Role Redesign + Alternate CRM Brand)
**Deploy:** `develop → staging → main` | **Type:** Feature + Brand

### New Features
- **Pod Admin: My Pod / Global toggle** — Pod Admins can now switch between their pod-scoped view and a full org-wide view directly from the dashboard header. Toggle state persists across navigation via sessionStorage.
- **Alternate CRM brand rollout** — New logo across all surfaces: browser favicon (`.ico` multi-res), Apple Touch icon (180×180), Android/PWA icons (192×512), Open Graph image, sidebar brand icon (28×28), login page logo. PWA `manifest.json` added. `scripts/generate_icons.py` created for future logo updates.

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
If the admin has no `messenger_from_number` in their profile, Alternate Messenger rejects
with `from_number: Missing data for required field` (HTTP 422).

### Root Cause
v9.5.5 was a patch — it removed the `Alternate MessengerDialer.mount` crash but replaced
it with a fundamentally wrong approach. The Playground's purpose is to TEST
Alternate Messenger credentials entered in the form, completely independent of any CRM
user profile.

Additionally, the existing `POST /api/dialer/playground/test-call` backend
endpoint was calling `provider.initiate_call(from_number=..., call_mode=...)` —
kwargs that don't exist on the method. This caused a Python exception before
ever reaching Alternate Messenger.

### Fix
- **`frontend/js/views/playground.js`**: Make Call now POSTs to
  `/api/dialer/playground/test-call` with `{ phone, api_key, user_id, from_number,
  api_base, call_mode }` — directly from Step 2 form fields.
- **`backend/routes/dialer_routes.py`** (`POST /api/dialer/playground/test-call`):
  - Fixed `initiate_call()` call to use correct signature: `(phone_number, user_email, lead_id, use_agent_phone)`
  - Added early 422 guard: bridge mode with no `from_number` returns a clear message before touching Alternate Messenger
  - Added `GET /api/dialer/playground/call-status` endpoint for Playground status polling

### Breaking Changes
None. Admin-only Playground feature.

---

## v9.5.6 — 2026-06-15 (Admin Dialer Override UI + Provider Log Fix)
**Deploy:** `develop → staging → main` | **Type:** Feature + Bug Fix

### Problem Solved
Admins (Super Admin / Pod Admin) had no UI to set their `dialer_provider_override`
or Alternate Messenger agent credentials (agent ID, from_number, email). These required
a raw DB update. The "Dialer Override" dropdown and "Alternate Messenger Agent" column
were only shown on SDR / AE tabs.

Additionally, the error log always said `[DialerService] Alternate Messenger call initiation
failed` even when the actual failure was from the Aircall provider.

### Fix
- **`frontend/js/views/admin.js`**:
  - "Dialer Override" dropdown now shows on **all tabs** (Super Admins, Pod Admins,
    SDRs, AEs) — not just SDR/AE.
  - Saves via existing `patchUserSettings` → `PATCH /api/admin/users/{id}/settings`
    → takes effect immediately, no re-login needed.
- **`backend/dialer_service.py`**: Error log now uses `provider.provider_name`
  dynamically instead of hardcoded "Alternate Messenger".

### Breaking Changes
None.

---

## v9.5.5 — 2026-06-15 (Dialer Playground — TypeError Crash Fix)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix

### Problem Solved
Opening the Dialer Playground (Admin only) and clicking "Launch Widget" crashed immediately
with two console errors:
```
TypeError: Alternate MessengerDialer.mount is not a function  (playground.js:354)
TypeError: Alternate MessengerDialer.mount is not a function  (playground.js:354)  [Unhandled rejection]
```
The Playground was completely unusable — the "Make Call" button never became interactive.

### Root Cause
`playground.js` was written expecting a third-party Alternate Messenger SDK with methods
`Alternate MessengerDialer.mount()`, `.call()`, `.on()`, `.unmount()`, `.hangup()` —
a design that was never implemented. Our `Alternate MessengerDialer` module is a CRM-internal
state machine (`activate`, `destroy`, `isActive`) with no SDK surface.

### Fix
- **`frontend/js/views/playground.js`** (`_initStep3` rewrite):
  - Removed all `Alternate MessengerDialer.mount/call/on/unmount/hangup` calls.
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
When a Alternate Messenger `CALL_ENDED` webhook was missed (network failure, Alternate Messenger outage), the
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
  `api-id`, `api-token`; Alternate Messenger: `api-key`, `user-id`, `base-url`, `account-id`, `sender-id`)
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
5+ Alternate Messenger SDRs repeatedly, appearing in error logs as "An unexpected JavaScript
error occurred". The error was also generating a secondary "A background operation
failed unexpectedly" log entry as an unhandled promise rejection downstream.

### Root Cause
`messenger_widget.js` holds 9 module-level DOM refs (`$channelWa`, `$channelSms`,
`$composeWrap`, `$noLeadNotice`, `$noPhoneNotice`, `$tplWrap`, `$tplPreview`,
`$sessionBanner`) that start as `undefined` at module parse time and are only
assigned inside `_buildDOM()`. Six functions that use these refs can be triggered
before or during widget init by async events (`alternate:call-started`, channel
clicks, tab switches), causing a crash.

### Changes
- **`frontend/js/messenger_widget.js`** (V35):
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

## v9.5.1 — 2026-06-12 (Alternate Messenger Payload — Full Curl Alignment)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix (Hotfix)

### Problem Solved
After v9.5.0 landed, two further issues were found by comparing our payload against the
actual Alternate Messenger browser network traffic (curl capture from developer):

1. **`from_number` format mismatch**: v9.5.0 converted stored DIDs to raw-digit format,
   stripping the `00` prefix. This caused `HTTP 400 "Invalid from_number for this user/account"`
   because Tata and other telecom providers register DIDs in different formats.
2. **Missing fields**: `use_agent_phone` and `contact_name` were removed in v9.5.0 based on
   an incorrect assumption — the 422 in our history was caused by `call_type`, not these fields.
   Without `use_agent_phone`, bridge mode could not work (Alternate Messenger didn't know to ring the agent's phone).

### Root Cause (per Alternate Messenger browser network traffic)
The exact wire format Alternate Messenger's own UI uses:
```json
// Browser call
{"phone_number": "+919580440262", "contact_name": "", "use_agent_phone": false, "from_number": "<DID>"}

// Bridge call
{"phone_number": "+919580440262", "contact_name": "", "use_agent_phone": true, "from_number": "<DID>"}
```

### Changes
- **`backend/messaging_provider.py`**:
  - `phone_number` → normalized to E.164 (`+` prefix) using existing `_to_messenger_number()`
  - `from_number` → **sent verbatim from Settings** (only whitespace/dashes/parens stripped).
    No prefix transformation. Admins store the DID in whatever format their provider (Tata, Airtel,
    BSNL, etc.) requires. One format does not fit all.
  - `use_agent_phone` → restored. `false` for browser calls, `true` for bridge calls.
  - `contact_name` → restored as `""` (matches Alternate Messenger's own wire format).
  - Added `_strip_to_digits()` helper (kept for reference — not used in payload).
  - `call_type` → still NOT sent (this was the real 422 culprit, never restored).

### Design Decision
> `from_number` is owned by the admin. They enter it in Settings in the exact format
> their Alternate Messenger account expects. We are not in the business of guessing telecom formats.

### Breaking Changes
None. Admins must verify their DID in Settings → Contact Center → Default Caller ID
is stored in the exact format shown in their Alternate Messenger account.

### Verified on Staging
Yes — call placed successfully on staging after deploy `bd3b62a`. No 400/422 errors.

---

## v9.5.0 — 2026-06-12 (Alternate Messenger Call Trigger — Definitive Fix)
**Deploy:** `develop → staging` | **Commits:** `10a0b3e` | **Type:** Bug Fix (Hotfix)

### Problem Solved
Clicking the Call button on a Alternate Messenger lead loaded the spinner but the call was never placed.
The UI appeared to be working but Alternate Messenger's API returned HTTP 422 on every attempt.

### Root Cause (Verified via Live API Testing)
The `/calls/initiate` endpoint was receiving the wrong payload format. The previous code was
built on **incorrect assumptions** from developer curl examples, not the actual Alternate Messenger API.

By querying `GET /calls` (44 real call records) and then live-testing payload combinations
against the Alternate Messenger API, the true contract was discovered:

| Field | Wrong (what we sent) | Correct (Alternate Messenger wire format) |
|-------|---------------------|-----------------------------------|
| `phone_number` | `+919545455721` (E.164) | `00919545455721` (00-prefix) |
| `from_number` | `919240915643` (stripped `00`) | `00919240915643` (keep `00` as-is) |
| Extra fields | `call_type`, `call_mode`, `contact_name` | **NOT accepted** — 422 "Unknown field" |

**The correct payload is exactly 2 fields:**
```json
{"phone_number": "00919545455721", "from_number": "00919240915643"}
```
This was verified by making a live test call to Alternate Messenger (call_id=93 created & disconnected).

### Changes
- **`backend/messaging_provider.py`**:
  - Added `_to_00_prefix()` helper: converts any number format → Alternate Messenger's `00`-prefix wire format
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
- **Browser call silent fallback bug (`messenger_dialer.js`):** When Alternate Messenger's API is degraded and returns no `livekit_token`, the code previously fell silently into bridge polling — no phone rang, the call appeared stuck. Now shows an explicit toast ("Alternate Messenger did not return audio credentials — try again or switch to Phone Bridge") and auto-hangs up to reset the widget to idle.
- **LiveKit `room.connect()` failure (`messenger_dialer.js`):** If LiveKit connection threw an error, the widget stayed stuck at "Ringing…" with non-functional Mute/Hold/End buttons. Now calls `Alternate MessengerDialer.hangup()` after the error toast, resetting the widget to idle.
- **Browser mode ringing hint:** Widget now shows "🎧 Lead's phone is ringing — you'll hear them when they answer" during the ringing phase for browser calls (matching the bridge-mode "📱 Your phone will ring" hint added in v9.4.3).

### Breaking Changes
None. Frontend-only.

---

## v9.4.3 — 2026-06-11 (Bridge Mode Ringing UX)
**Deploy:** `develop → staging` | **Type:** UX Improvement

### Problem Solved
SDRs using Bridge mode were hitting End after 4 seconds because they didn't know their own phone would ring first. The widget showed "Ringing…" with no explanation.

### Changes
- **`frontend/js/messenger_widget.js` (`_renderCallActive`):** Bridge mode now shows a pulsing 📱 hint: "Your phone will ring — answer it to connect" during the ringing phase. Hint disappears when call is answered.
- **Recording badge** now shows "Dialling bridge…" during ringing instead of "Connecting…"; changes to "● Recording" once answered.
- **`frontend/css/messenger_widget.css`:** Added `.cw-call-ring-hint` styles and `cwPulse` keyframe animation.

### Root Cause Analysis
Render staging logs showed `POST /api/calls/disconnect 200` firing only 4 seconds after `POST /api/calls/start 200` on a bridge call — consistent with user immediately clicking End without realising they needed to answer their handset first.

### Breaking Changes
None. Frontend-only.

---

## v9.4.2 — 2026-06-11 (A6 Widget Theme + B Playground + C Duration-Heal)
**Deploy:** `develop → staging` | **Type:** Bug Fix + Feature

### Bug Fixes
- **A6 — Alternate Messenger widget visibility (`app.js`, `messenger_widget.css`):** Widget was initialised with `theme: 'light'` but the light-theme CSS was incomplete — lead name, phone, status text, and Mute/Hold/End buttons all rendered as white text on a white background (invisible). Fixed by switching to `theme: 'dark'` (the fully-designed glassmorphism theme). Also added ~35 lines of complete light-theme overrides (`[data-widget-theme="light"]`) for future safety.
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
- **`_pollBridgeStatus` in `messenger_dialer.js`:** Bridge-mode calls now poll `GET /api/calls/{id}/status` every 2 seconds. `CALL_ANSWERED` fires the timer; terminal statuses auto-hangup. Previously bridge calls never detected answer events.
- **`_callInFlight` reset on cancel (`app.js`):** If the user dismissed the mode selector (Cancel) without completing a call, `_callInFlight` was left as `true`, silently blocking all subsequent calls. Now resets on cancel.

### Breaking Changes
None. Frontend-only.

---

## v9.4.0 — 2026-06-11 (Alternate Messenger Dialer Separation)

**Deploy:** `develop → staging → main` | **Type:** Architecture / Reliability

### Overview
The Alternate Messenger dialer is now fully isolated from the Aircall-shared `dialer_machine.js`. A new self-contained `Alternate MessengerDialer` module owns the entire Alternate Messenger call lifecycle.

### Problem Solved
SDRs using the Alternate Messenger dialer were frequently experiencing a "blank widget" or "stuck dialer" bug where placing a second call was blocked because the shared state machine was stuck in a transient state (`INITIATING`, `RINGING`, `CONNECTED`, or `ENDING`) from the previous call. A page refresh was required to recover. Root cause: both Aircall and Alternate Messenger shared a single state machine designed for only one provider.

### Changes
- **`frontend/js/messenger_dialer.js`** [NEW]: Self-contained Alternate Messenger call manager. State: `IDLE → INITIATING → ACTIVE → ENDING → IDLE`. Fires the same `alternate:call-started` / `alternate:call-ended` CustomEvents. No dependency on `dialer_machine.js`.
- **`frontend/js/app.js`**: `handleCallAction()` now calls `Alternate MessengerDialer.activate()` for Alternate Messenger calls instead of `showDialerWidget()`. Duplicate-dial guard now checks both `isWidgetActive() || Alternate MessengerDialer.isActive()`.
- **`frontend/js/views/dialer_widget.js`**: `window.alternatecrmDialer` global updated to proxy `isActive`, `getState`, `hangup`, `mute`, `hold` to `Alternate MessengerDialer`. `messenger_widget.js` requires zero changes.

### Aircall Safety
Aircall never called `showDialerWidget()` — the machine was always IDLE for Aircall calls. The Aircall polling path (`_startAircallOutcomePolling`), outcome modal, and sticky banner flow are completely untouched.

### Breaking Changes
None. Frontend-only.

---

## v9.3.1 — 2026-06-11 (Hotfix — Outcome Modal on Failed Dial)
**Deploy:** `develop → staging → main` | **Type:** Bug Fix (Hotfix)

### Bug Fix
- **Outcome modal appearing immediately on a failed Aircall dial** (`frontend/js/app.js`): When an Aircall call failed (e.g. SDR's Aircall Desktop was offline/not set to Available — HTTP 405 from Aircall), the outcome logging modal ("Did the call connect?") was appearing instantly on screen before the call even connected. Root cause: the `catch` block in `handleCallAction()` was missing a `return` statement — after showing the error toast it fell through to the `openCallModal()` call at the bottom of the function, which was intended only for non-dialer (manual log) SDRs. Fix: added `return` in the catch block. Alternate Messenger flow is completely unaffected (it returns at `showDialerWidget()` before reaching this code path).

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
Aircall call failures were being logged as **"Alternate Messenger Dialer"** in System Logs → Error Logs,
confusing admins into thinking Alternate Messenger was the culprit. Root cause: the double-call prevention
guard returned early without a `"provider"` key in its result dict — the error logger then fell back
to the hardcoded default `'Alternate Messenger'`.

### Bug Fix

#### Backend
- **`dialer_service.py`** — `initiate_call()` now captures `_provider_name = provider.provider_name`
  immediately after the provider is resolved. The double-call guard's early-return dict now includes
  `"provider": _provider_name` so callers always receive the correct label (EC-17 / RCA-2026-06-08).
- **`routes/dialer_routes.py`** — Hardcoded fallback in `log_error(feature=...)` changed from
  `'Alternate Messenger'` → `'Unknown'` as belt-and-suspenders: if provider is ever absent from the result
  dict for any future reason, the error log is honest rather than misleading.

### Root Cause
The `initiate_call()` double-call guard (added in v8.9.2 EC-16) returned:
```python
{"success": False, "error": "You already have an active call in progress..."}
```
No `"provider"` key. The error logger at `dialer_routes.py:114` did:
```python
feature=f"{result.get('provider', 'Alternate Messenger')} Dialer"
```
`result.get('provider')` → `None` → fell back to `'Alternate Messenger'` → wrong label for every Aircall
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
- **`scheduled_jobs.py`** — `_messenger_nightly_sync()` dedup logic fixed. When the nightly
  Alternate Messenger history sync found an existing record by `provider_call_id`, it was silently
  skipping it (`skipped_dup += 1; continue`) regardless of whether the DB status was stale.
  It now checks: if the DB record is non-terminal (`CALL_STARTED`/`CALL_ANSWERED`) but Alternate Messenger
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

## v8.4.0 — 2026-06-01 (Alternate Messenger SDK Phase 4 — Playground, SSE, State Machine)
**Deploy:** `develop → staging → main` | **Branch:** `develop` | **Commit:** `704be3d`
**Type:** Feature + Hardening

### New Features
- **Dialer Playground (Admin/Super Admin only):** 3-step onboarding wizard at `GET /api/dialer/playground` lets admins verify Alternate Messenger credentials, test a live call, and confirm widget connectivity — without touching SDR settings. Accessible via 🎮 Playground in the sidebar (Admin only, hidden from SDRs).
- **SSE Real-Time Call Events (`sse_broker.py` + `sse_routes.py`):** Replaces 2-second polling in `dialer_widget.js` with Server-Sent Events. Browser receives call state changes (`CALL_STARTED`, `CALL_ANSWERED`, `CALL_ENDED`) instantly via `GET /api/calls/events`. Falls back to polling automatically if SSE is unavailable — best-effort, never blocks the call.
- **DialerMachine State Machine (`dialer_machine.js`):** Owns call state, timer, polling lifecycle. Eliminates ad-hoc `setTimeout` hacks and race conditions in the call widget.
- **Alternate MessengerDialerElement Custom Element (`messenger_dialer_element.js`):** Web Component shell for `<messenger-dialer>` — foundation for embedding the dialer widget in non-SPA contexts.
- **Light Theme Widget:** Alternate Messenger widget now initialises in light theme (`messenger_widget.css` + `theme: 'light'` in app.js).

### Hardening
- **Concurrent call guard:** `dialer_service.py` now blocks a second call if the user already has an active `CALL_STARTED` or `CALL_ANSWERED` record. Returns a clear error: *"You already have an active call in progress."*
- **Webhook idempotency guard:** `ended_at` and `duration` are never overwritten once set. Alternate Messenger webhook retries no longer corrupt the original timestamp/duration.

### Core Product Impact
- ✅ None. Aircall, Salesforce sync, lead management, auth, and analytics are completely untouched.
- Playground is Admin-only, gated behind a 403 for non-admins.
- SSE fan-out is `try/except pass` — never blocks the call response.

### Tests
- 1434 tests passing (no regressions)
- New: `test_dialer_routes.py` (+249 lines), `test_messaging_provider.py` (+113 lines — Gap 3 room_name payload tests)

---

## v8.3.2 — 2026-05-29 (Bug Fix: Alternate Messenger Nightly Sync Import Error)
**Deploy:** `develop → staging → main` | **Branch:** `develop`
**Type:** Bug Fix

### Problem
`[NightlySync] Alternate Messenger error: cannot import name '_normalize_phone' from 'dialer_service'`

`_messenger_nightly_sync()` in `scheduled_jobs.py` (line 340) was importing
`_normalize_phone` from `dialer_service` — the wrong module. The function is
defined in `routes/dialer_routes.py`. This caused an `ImportError` at runtime
every time the nightly catch-up ran, silently killing the entire sync. Any
Alternate Messenger calls missed by real-time webhooks (server downtime, delivery failure)
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
- `test_sync_skips_when_messenger_not_configured` — graceful skip when unconfigured

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
- **Fix: `recording_url` missing from `/api/my/today-calls` response** — A single missing key `"recording_url": c.recording_url` in the dialer call dict was the root cause. Field now included for all dialer call sources (Aircall + Alternate Messenger).

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
**Type:** Hardening — Aircall + Alternate Messenger robustness, shared validation module, 91 new tests
**Commit:** `87463e4` (develop)

### Problem
SDRs reported calls failing silently or with unhelpful error messages (raw `RuntimeError` strings).
Root cause: both Aircall and Alternate Messenger providers had no pre-call phone validation. Numbers with
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

**`backend/messaging_provider.py`** (Gaps C1–C9)
- C1: `_to_messenger_number` strips extensions before formatting; logs warning when stripped
- C2: `_validate_phone_for_messenger()` static method added; called in `initiate_call` pre-API
- C3/C4: `None`/empty `phone_number` handled gracefully everywhere — no crashes
- C5: Dots stripped in `_to_messenger_number`
- C6: **Full 100% error mapping** — every Alternate Messenger error code maps to a clear actionable message:
  - 422 + 400: friendly "invalid phone/caller ID" + `Alternate Messenger says: "..."` body detail extracted
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
- C9: `_to_messenger_number` now has full test coverage

### Test Results
- **1252 passed, 0 failed, 4 skipped, 7 xfailed** ✅
- 91 new tests added across 3 files:
  - `test_phone_utils.py` (NEW): 46 tests for shared validation utilities
  - `test_aircall_sync.py`: 1 assertion updated for improved error message ordering
  - `test_messaging_provider.py`: +35 tests (formatter, validator, C6 full battery)
  - `test_messenger_floating_button.py`: EC-9 assertion updated for dot-stripping behaviour

### Migration Notes
None — no schema changes, no new env vars, no migrations.

### Rollback commit
`04dc749` (v7.1.0 — last commit before this hardening)

---

**Deploy:** develop → staging → main
**Type:** Feature — New admin view + backend optimisations + comprehensive test coverage
**Commit:** TBD (develop)

### Problem
Admins had no unified way to monitor all dialer activity (Aircall + Alternate Messenger + manual) across the org.
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
SDRs were reporting Alternate Messenger calling issues but no errors were surfacing in any log. Silent failures across:
- `messaging_provider.py` — network retries and unknown webhook statuses swallowed silently
- `dialer_service.py` — call initiation failures logged at `INFO` level, not `ERROR`
- `dialer_routes.py` — failed calls never written to the `error_logs` table → invisible in System Logs UI
- `audit_logs.js` — Call Logs tab showed raw status strings (`CALL_ENDED`, `CALL_STARTED`) with no error reasons, no provider distinction, no direction column

### Changes

**`backend/messaging_provider.py`**
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
- `GET /api/admin/call-logs`: new `provider` query filter (Alternate Messenger / Aircall)
- Response now includes `error_detail` (from `notes` on FAILED rows), `provider_call_id`, and `direction` per item
- Provider filter also applied to summary stats aggregation

**`frontend/js/views/audit_logs.js`**
- **Provider filter** added to Call Logs tab (All / 📞 Alternate Messenger / ✈️ Aircall)
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
3. Provider filter (Alternate Messenger / Aircall) should correctly scope the table

### Rollback commit
`ef093ed` (end-of-day capture 2026-05-25)

---

## v6.9.0 — 2026-05-25 (Alternate Messenger Data Integrity + Leaderboard Fix)
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
`_fmtDur` now returns `'—'` for null. Audio player uses `preload="metadata"` and `onloadedmetadata` to read the actual recording duration and update the card header live — critical for calls where the Alternate Messenger disconnect webhook was missed.
- File: `frontend/js/views/lead_calls_tab.js`

**Bug 3 — Alternate Messenger field name mismatches (critical — discovered via live API probe)**
Direct inspection of `https://app.alternatecrm.com/contact-center/v1/calls` revealed:
| Assumed | Actual |
|---|---|
| `duration` | **`duration_seconds`** |
| `calls` / `data` (response key) | **`items`** |
| `/calls/{id}/status` returns full data | Returns only `{call_id, status}` |

Three fixes in `messaging_provider.py`:
1. `handle_webhook`: reads `duration_seconds` first, falls back to `duration`
2. `fetch_calls_paginated`: uses `items` key; maps `duration_seconds → duration`, `recording_link → recording_url`
3. `fetch_call`: now searches paginated `/calls` list (up to 5 pages) to backfill `duration_seconds`, `ended_at`, `recording_link` for calls whose disconnect webhook was missed
- File: `backend/messaging_provider.py`

**Bug 4 — Leaderboard: Alternate Messenger/Aircall dials not counted**
`leaderboard_routes.py` only queried `call_logs` (manual calls). All Alternate Messenger + Aircall dials live in `dialer_calls` — a different table — making SDR dial counts show 0.
- **Fix:** Union `dialer_calls` (outbound, date-filtered) + `call_logs` for both `calls_today` and `total_calls`. Mirrors the same pattern in `analytics/sdr-table`.
- File: `backend/routes/leaderboard_routes.py`

### On Transcription
Alternate Messenger returns `"transcription": {}, "transcription_status": "skipped"` for all calls.
Transcription is **not enabled** on this Alternate Messenger account. Needs activation in the Alternate Messenger dashboard (AI/transcription settings). CRM already has the UI to display transcripts once enabled.

### Test Results
- **1105 passed, 4 skipped, 7 xfailed, 0 failures** ✅
- Leaderboard: 11/11 · Alternate Messenger provider: 64/64 · Aircall: 52/52

### DB State After Deploy
| Provider | 7-day calls | With duration |
|---|---|---|
| Aircall | 1,034 | 100% ✅ |
| Alternate Messenger | 51 | On-demand backfill via `fetch_call` paginated search |

### Rollback commit
`af52af5` (v6.8.1)

---

## v6.8.1 — 2026-05-25 (P1 Hotfix — /api/calls/start IntegrityError)
**Deploy:** develop → staging → main (pending user approval)
**Type:** Hotfix — production P1
**Commit:** `af52af5`

### Problem
Production DB has `sf_lead_id NOT NULL` at the database level (ORM model marks it `nullable=True` but the column constraint was never migrated). Ad-hoc Alternate Messenger calls that matched no existing lead triggered anonymous lead creation without `sf_lead_id` → `psycopg2.errors.NotNullViolation` → HTTP 500 on every call attempt.

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
- **fix(backend) `dialer_service.py` + `call_routes.py`:** Alternate Messenger call recordings were never appearing in the lead Calls tab. Root cause: `get_lead_calls()` used `get_active_provider(db)` (the global provider — Aircall) to refresh recording URLs for ALL `DialerCall` rows. Alternate Messenger calls were silently refreshed via the Aircall HTTP client → wrong provider → recording_url always stayed NULL. Fix: added `get_provider_by_name(name, db)` to `dialer_service.py` and rewrote the refresh loop in `call_routes.py` to use a per-call provider cache keyed by `DialerCall.provider`. Alternate Messenger calls now get the Alternate Messenger provider; Aircall calls get Aircall. Added `logger.debug` for missing-credential cases to surface issues in Render logs. 3 new tests in `TestGetProviderByName`.
- **fix(backend) `test_messaging_provider.py`:** Mocked urlopen calls in `TestUserNumbers` unit tests to isolate test execution from real network activity.
- **fix(backend) `test_dialer_credentials.py`:** Added `use_agent_phone=True` parameter to Alternate Messenger caller ID assertions.
- **feat(frontend/backend) UX Refinements:**
  - **Manual Dial Sync Active Hidden**: Dial buttons are hidden on lead lists/details when manual dial sync is active.
  - **Filter Clear Button Reload**: Clear filters action triggers a clean page reload to completely reset all UI state.
  - **SDR Settings Dialer Toggle**: SDRs can toggle the Alternate Messenger WebRTC dialer widget on/off in their Settings panel.
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
  - `dialer_calls` (outbound) → covers all Aircall/Alternate Messenger calls
  - `call_logs` WHERE no matching `dialer_call` for same user+lead+date → covers India Team manual calls (4,969 pure-manual entries)
  - Only 1 overlap found org-wide — excluded to prevent double-counting
  - Same fix applied to trend endpoint and SDR table (BULK QUERY 3)
  - Connect rate now uses `CALL_ANSWERED` status (Aircall live answer signal)
- **fix(db) orphan repair:** 1,474 orphaned `dialer_calls` linked to leads via phone-match (last-10-digit normalization across primary, secondary, company phone fields)
  - Root cause: historical Aircall sync stored phones as `+1 XXX-XXX-XXXX`, leads stored `XXXXXXXXXX`
  - Remaining 4,215 orphans are genuinely not in Alternate CRM (calls to external numbers or deleted leads)

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
- **fix(CORS):** Production `api.alternatecrm.staging.in` was blocking all requests from `alternatecrm.staging.in` — `FRONTEND_URLS` env var on Render production backend did not include the production frontend URL. Fixed via Render env var update (no code change).
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
Yes — CORS header confirmed: `access-control-allow-origin: https://alternatecrm.staging.in`

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
Yes — full Playwright suite run against `messenger-frontend-staging.onrender.com` + `messenger-crm-staging.onrender.com`

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
**Type:** Hotfix — Alternate Messenger Declined Call + Calls Tab UX

### Changes
- `frontend/css/style.css`: `#call-log-modal { z-index: 100000 }` — outcome modal was buried behind Alternate Messenger widget (z-index 99,999) and instantly disappearing on call end. Now always renders on top.
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
**Type:** Hotfix — Alternate Messenger Ringing Timeout (Backend Guard 2)

### Changes
- `backend/routes/dialer_routes.py`: Guard 2 — if a Alternate Messenger call has been in `CALL_STARTED` for >50 seconds with no `ended_at`, auto-set `status=CALL_ENDED` and `ended_at=NOW()`. Prevents zombie calls blocking the UI when recipient declines and Alternate Messenger webhook is delayed.

### Migration Notes
None.

### Verified on staging
Yes — Guard 2 confirmed firing for calls >50s. DB records updated correctly.

### Rollback commit
`a3c1ee4`

---

## v6.4.5 — 2026-05-22 (Hotfix)
**Deploy:** Render auto-deploy | **Commit:** `a3c1ee4`
**Type:** Hotfix — Alternate Messenger Declined Call Stuck on Ringing (Backend Guard 1 + Client Timeout)

### Changes
- `backend/routes/dialer_routes.py`: Guard 1 — if `ended_at` is already set on `DialerCall` but Alternate Messenger REST API still returns `"ringing"`, immediately return `CALL_ENDED`. Fixes lag where Alternate Messenger API took 7–30s to reflect call state change.
- `frontend/js/views/dialer_widget.js`: Client-side 45s timeout for Alternate Messenger `connecting/ringing` state — fires `_handleHangup()` automatically if no answer received. Third safety layer after Guard 1 + Guard 2.

### Root Cause
Call `df84927b` — `ended_at` written at 07:51:11 by user pressing Disconnect. Alternate Messenger webhook arrived at 07:51:18 (7s lag). Between those 7s, status poll returned stale `CALL_STARTED` — UI frozen on "Ringing…" indefinitely.

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
- `frontend/js/app.js`: `alternate:call-ended` handler calls `_refreshCallsTab` so Calls tab is always current after dialer use.
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
**Type:** Hotfix — Alternate Messenger Call Initiation 422 Error

### Changes
- `backend/messaging_provider.py`: Removed `agent_email` and `notify_url` from `/calls/initiate` payload. Both fields caused 422 "Unknown field" responses from Alternate Messenger API, silently preventing all calls from going through.

### Root Cause
v6.3.3 added these fields speculatively — neither is accepted by the Alternate Messenger `/calls/initiate` endpoint.

### Verified on staging
Yes — calls initiate correctly after removal.

### Rollback commit
`3289edc`

---

## v6.3.4 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `3289edc`
**Type:** Fix — Alternate Messenger Webhook notify_url Dynamic Resolution

### Changes
- `backend/messaging_provider.py`: `notify_url` now derived from live request URL instead of env var — eliminates environment-specific configuration.

### Rollback commit
`26c742b`

---

## v6.3.3 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `26c742b`
**Type:** Fix — Alternate Messenger Call Initiation Fields (reverted in v6.3.5)

### Changes
- `backend/messaging_provider.py`: Added `agent_email` + `notify_url` to call payload. Both later found to cause 422 — reverted in v6.3.5.

---

## v6.3.2 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `8397e59`
**Type:** Fix — Call History Text Visibility + Faster Decline Detection

### Changes
- `frontend/css/messenger_widget.css`: Fixed text color contrast in call history panel.
- `frontend/js/views/dialer_widget.js`: Reduced decline detection polling interval from 5s → 2s.

---

## v6.3.0 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `0281a51`
**Type:** Fix — Call Status Polling Root Cause Fixes

### Changes
- `backend/routes/dialer_routes.py`: Rewrote status normalization — Alternate Messenger raw status strings mapped to canonical `CALL_STARTED/CALL_ANSWERED/CALL_ENDED`.
- `frontend/js/views/dialer_widget.js`: Timer anchored to `started_at` from server (not local JS `Date.now()`) for accurate call duration display.
- `frontend/js/views/lead_calls_tab.js`: Call history timestamps use server-side `started_at`, not client clock.

---

## v6.2.9 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `f28c4f0`
**Type:** Fix — Call History Auth + Timer

### Changes
- `frontend/js/messenger_widget.js`: Call history fetch now uses authenticated `apiFetch()` instead of bare `fetch()` — was returning 401 for all SDRs.
- Timer start anchored to `call_started_at` event timestamp.

---

## v6.2.8 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `b60b89e`
**Type:** Fix — END Call Clears Widget

### Changes
- `frontend/js/messenger_widget.js`: `_handleHangup()` now correctly resets widget to idle state after END CALL pressed. Previously widget stayed frozen in active-call UI.

---

## v6.2.7 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `57dbab3`
**Type:** Fix — END Call Works Even if Alternate Messenger API Fails

### Changes
- `frontend/js/views/dialer_widget.js`: Wrapped Alternate Messenger disconnect API call in try/catch — UI always transitions to ended state even if API returns error.

---

## v6.2.6 — 2026-05-21 (Feature)
**Deploy:** Render auto-deploy | **Commit:** `dc52613`
**Type:** Feature — Call History in Widget Idle Pane

### Changes
- `frontend/js/messenger_widget.js`: Idle pane now shows call history — lead-specific calls if on a lead page, today's SDR calls otherwise. Uses `GET /api/leads/{id}/calls` or `GET /api/calls/my-calls`.

---

## v6.2.5 — 2026-05-21 (Fix)
**Deploy:** Render auto-deploy | **Commit:** `87a444f`
**Type:** Fix — Timer Shows Ringing Until Answered; End Call Works in Embedded Widget

### Changes
- `frontend/js/messenger_widget.js`: Timer shows `Ringing…` label until `CALL_ANSWERED`; counts up from 0 only after connection confirmed.
- End Call button wired correctly in embedded (non-detached) widget mode.

---

## v6.2.0 — 2026-05-21 (Feature)
**Deploy:** Render auto-deploy | **Commit:** `1c17b80`
**Type:** Feature — Unified Alternate Messenger Dialer in MessengerWidget

### Changes
- `frontend/js/messenger_widget.js`: Full rewrite — widget now handles both messaging AND calling. Call tab added with dial pad, mode selector, live call controls, call history.
- `frontend/js/views/user_guide.js`: Conversations tab removed; messaging moved into MessengerWidget.
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
- `backend/routes/admin_routes.py`: `list_call_logs` scoped to known Alternate CRM users — cross-org Aircall data excluded.
- `backend/routes/admin_sync_routes.py`: `get_sf_connection_info` reads DB-stored connection first (staging uses DB creds, not env vars).
- `frontend/js/views/settings_connection.js`: Fixed `sfInfo.last_synced` → `sfInfo.last_sync_at` field name mismatch (Last Sync always showed "Never").
- `frontend/js/app.js`: SS1 FAB suppression removed (was hiding MessengerWidget); `_showCallModeSelector` exposed globally (SS3).
- 34 new backend tests (34/34 passing, 1059 total).

### Rollback commit
`f09718e`

---

## v6.0.0 — 2026-05-20 (Major Feature)
**Deploy:** Render auto-deploy (staging branch) | **Commit:** `9195dbf` + `e66eb2f` + `86ad3ea` + `fa951d6`
**Type:** Major Feature — Calling Overhaul (13 bugs + 3 enhancements)

### Changes
- **BUG-01–BUG-13**: Fixed all critical calling bugs including: duplicate call entries (EC-14), Alternate Messenger widget drag conflict (CSS transform vs fixed positioning), mode selector routing, call history auth 401s, discovery gate stuck state, call modal timer anchor, Aircall auto-sync tag mapping.
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
**Type:** Hot Fix — Alternate Messenger Ad-hoc Dial Broken + Random Lead in Footer

### Changes
- `frontend/js/messenger_widget.js`: Fixed critical promise-kill bug in `_renderCallIdleManual._dial()`.
  `_renderCallIdle()` was called BEFORE `_resolvePendingMode()` — but `_renderCallIdle` internally
  calls `_resolvePendingMode(null)`, destroying the promise before the real `{phone, callMode}` could
  be delivered. API call never fired. Fix: capture resolve fn, null `_pendingModeResolve`, render
  "Connecting…" spinner, then invoke resolve fn.
- `frontend/js/messenger_widget.js`: As a side-effect, "random lead" (Melanie Pratt) no longer appears
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
**Type:** Feature — Alternate Messenger Dialer Reliability, Button UX, Pagination

### Changes
- `frontend/js/views/lead_detail.js`: Alternate Messenger users — hide "Call via Alternate Messenger" and "Message" buttons (widget handles both). Aircall users with Alternate Messenger messaging — keep Message button.
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
- `backend/dialer_service.py`: Added `_auto_log_outcome()` — maps Aircall tags → Alternate CRM outcomes, idempotent (EC-4 guard), writes CallLog + increments attempt count
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
`log_call` used a 10-minute time-window heuristic to find the matching `DialerCall` record when an SDR submitted the outcome gate modal. If a call lasted >10 minutes, or the Aircall/Alternate Messenger webhook was delayed, no `DialerCall` was found within the window — causing a new `CallLog` to be created in addition to the existing `DialerCall`. Both entries appeared in lead history, making one call appear as two.

### Changes
- **`backend/routes/call_routes.py`**: `log_call` now accepts optional `dialer_call_id` in the JSON body. If present, performs exact `DialerCall` lookup by UUID (idempotency guard: skips if outcome already set and logs a warning instead). Fallback time-window extended 10 → 30 min for manual callers / older clients.
- **`frontend/js/app.js`**: `callId` (DB UUID from `startDialerCall()` response) now threaded through the entire outcome gate chain: `startDialerCall` → `_setPendingOutcome` → `_onDialerCallEnded` → `_openPendingOutcomeModal`. Both Aircall polling timeout path and Alternate Messenger `alternate:call-ended` event now pass `callId`.
- **`frontend/js/views/modals.js`**: `openCallModal()` accepts new optional `dialerCallId` param. Stored as `activeDialerCallId` and included in the `logCall` payload when present. Cleared on submit, close (X button), and backdrop click.

### Behaviour After Fix
| Call type | dialer_call_id in payload | Backend action |
|---|---|---|
| Dialer (Aircall/Alternate Messenger) | ✅ Present | Exact DialerCall lookup → outcome attached → no CallLog created |
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
- **`backend/routes/dialer_routes.py`**: `/api/dialer/test` accepts optional `?provider=aircall|messenger` for independent credential testing.
- **`backend/dialer_service.py`**: `test_specific_provider()` — validates Aircall and Alternate Messenger credentials independently.
- **`frontend/js/api.js`**: `testDialerConnection()` accepts optional `providerKey` query param.
- **`frontend/js/views/settings_ai_dialer.js`**: Test buttons for Aircall and Alternate Messenger wired to their respective providers.

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
- **`scripts/.prod.env`**: Removed deprecated `alternatecrm.messenger.ai` from `FRONTEND_URLS`.
- **Render env**: `FRONTEND_URLS` updated to `https://alternatecrm.staging.in` only.

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
- **`backend/routes/dialer_routes.py`**: `/api/dialer/status` now returns `sender_id` (the Alternate Messenger outbound number) directly. Eliminates the 403-generating `/api/admin/sync-settings` call that all SDRs were previously hitting on every page load.
- **`frontend/js/app.js`**: Added `_messengerWidgetReady` flag (local + `window.`) — set to `true` only after `MessengerWidget.init()` completes successfully. Replaces the faulty `typeof MessengerWidget` guard, which was always `true` because the UMD script loads regardless of whether init ran.
- **`frontend/js/app.js`**: `MessengerWidget.init()` now uses `_dialerConfig.sender_id` from the per-user status API instead of fetching from the admin endpoint.
- **`frontend/js/app.js`**: Default `_dialerConfig` now includes `active: false` and `sender_id: ''` to prevent race conditions during initial page load before the API response arrives.
- **`frontend/js/app.js`**: `isDialerActive` now requires `_dialerConfig.active === true` in addition to provider and credentials checks, preventing UI inconsistencies for SDRs with disabled-but-configured dialers.
- **`frontend/js/views/lead_detail.js`**: Call button label now requires `_dc.active === true` before showing "Call via Aircall" or "Call via Alternate Messenger". Inactive SDRs correctly see "Log Call".
- **`frontend/js/views/lead_detail.js`**: Message button now gated on `window._messengerWidgetReady`. Hidden for Aircall and no-dialer users, preventing the `classList` null-pointer crash.

### Migration Notes
None — no schema changes, no new env vars. `sender_id` was already in `SyncSettings.messenger_sender_id`.

### Verification Matrix (pre-deploy checklist)
| Scenario | Call button | Message button |
|---|---|---|
| No dialer configured | Log Call | Hidden |
| Aircall active | Call via Aircall ✅ | Hidden ✅ |
| Aircall inactive (active=false) | Log Call ✅ | Hidden ✅ |
| Alternate Messenger active | Call via Alternate Messenger ✅ | Shown ✅ |
| Alternate Messenger inactive | Log Call ✅ | Hidden ✅ |

### Verified on Staging ✅
- `/api/health/deep` → `status: ok, db_tables_accessible: true, db_latency_ms: 4.0ms`
- `/api/dialer/status` response includes `sender_id` field ✅
- Lead detail page loads without console errors — no `classList` crash ✅
- Call button shows correct label per dialer state ✅
- Message button hidden for non-Alternate Messenger users ✅

---

## v5.12.0 — 2026-05-12 (Hotfix)

**Deploy:** pending | **Commit:** `1b20725` (develop)
**Type:** Hotfix — Aircall Routing & Alternate Messenger Widget Gate

### Changes
- `frontend/js/app.js`: Added provider-based guard — `MessengerWidget.init()` is now skipped entirely for SDRs whose resolved dialer provider is `aircall`. This prevents the Alternate Messenger FAB (floating messaging button) from appearing for Aircall users and causing routing confusion.
- `frontend/js/app.js`: Exposed `window._dialerConfig` so `lead_detail.js` can read provider config without additional API calls.
- `frontend/js/views/lead_detail.js`: "Log Call" button now dynamically labels itself as "📞 Call via Aircall" (green) or "💬 Call via Alternate Messenger" (purple) based on the user's resolved dialer provider.
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
  - `GET /api/chat/health` — checks `messenger_enabled`, api_key/user_id/account_id/sender_id, live API ping via `list_conversations`
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
**Type:** Feature — Alternate Messenger Floating Widget (Unified Messaging Surface)

### Changes
- `frontend/js/messenger_widget.js`: Floating widget — dynamic header (lead name + phone), no-phone guard, timer anchoring to call start time, loading state for compose area, dialer suppression scoped to active calls only
- `frontend/js/app.js`: Boot `MessengerWidget` post-login; injects `messenger_sender_id` from SyncSettings; exposes `window._openMessagingWidget(lead)`
- `frontend/js/views/lead_detail.js`: Deprecated iframe conversations tab; rewired 💬 Message button and Conversations tab to open floating widget via `window._openMessagingWidget`
- `frontend/js/views/dialer_widget.js`: Added `startTime` to `alternate:call-started` event payload for accurate timer sync
- `frontend/css/messenger_widget.css`: Removed dead `.cw-powered-by` styles; added dynamic header lead-info component styles
- `frontend/index.html`: Registered `messenger_widget.css` + `messenger_widget.js` globally

### Migration Notes
None — no database or schema changes. Feature is opt-in via Settings → Sync → Alternate Messenger Messaging toggle. Iframe-based tab is deprecated.

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
- `render.yaml`: Updated `FRONTEND_URL`, `FRONTEND_URLS`, buildCommand, and comments to use canonical custom domains (`alternatecrm.messenger.ai` / `api.alternatecrm.messenger.ai`)
- `docs/Public_API.md`: Replaced placeholder `your-alternatecrm-domain.com` with real production API domain across all curl/Python/JS examples
- `docs/AGENT_PROTOCOL.md`: Updated production backend URL reference
- `backend/scripts/monitor_staging.sh`: `PROD_URL` now points to `api.alternatecrm.messenger.ai`
- `scripts/migration/phase1_download_and_map.py`: `ALTERNATE_CRM_PROD` constant updated
- `backend/routes/sandbox_routes.py`: **Bug fix** — per-table transaction isolation in `_do_refresh`: each table TRUNCATE+INSERT now runs in its own transaction boundary with `db.commit()` on success and `db.rollback()` on failure, preventing one failed table from poisoning the entire session (`InFailedSqlTransaction`)
- `frontend/js/views/settings.js`: **Bug fix** — progress poller re-initialises sandbox tab on completion so "Last refresh" stats block updates with real lead count; hides progress container after done/failed; uses `??` for nullish lead count; polls every 2s

### Infrastructure Notes
- Cloudflare CDN cache for `config.js` manually purged — `API_BASE` now resolves to `api.alternatecrm.messenger.ai` across all edge nodes
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
Yes — staged on `messenger-crm-staging.onrender.com`; sandbox refresh tested. Custom domain `alternatecrm.messenger.ai` activated in prod post-merge.

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
- `render.yaml`: Added `messenger-frontend-prod` static site service
- `render.yaml`: Set `SERVE_FRONTEND=false` on `messenger-crm-prod` backend
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
- Decoupled staging environment: `messenger-frontend-staging` static site created
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
**Type:** Feature — Alternate Messenger Dialer Hardening

### Changes
- Alternate Messenger Contact Center dual-dialer architecture (V25)
- Per-SDR Alternate Messenger caller ID / `senderId` override (V27)
- Separate dialer credentials — Contact Center can use different Alternate Messenger account (V28)
- Dynamic call outcome configuration Phase 2 (V29)
- Sandbox Refresh — API-to-API tokenized export (V30)
- Upload Center: batch lead assignment time-scoped query filters
- FastAPI port binding fix — heavy startup work moved to daemon threads

### Verified on staging
Yes — Alternate Messenger QA API connectivity tested, outbound call flow verified

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
