

# Alternate CRM — Reporting, Funnel & Lead-State Plan

**Status:** DRAFT v1 · 2026-10-08 · Nothing in this plan is built yet (by decision: brainstorm first).
**Source:** MOM email of Wed 7 Oct (Neelmani → Amit, Pankaj, Raghav, Viren) + code research done 2026-10-08.
**Parked on purpose:** React migration of Leads/Lead Detail (see §12). Reporting + lead-flow come first.

Legend — **[V]** verified in code · **[A]** assumption, needs confirming · **[D]** decision needed from you.

---

## 1. What the MOM commits us to (tracker)

| # | Commitment (owner) | Where it lands | State |
|---|---|---|---|
| 1 | Build campaign + funnel dashboard directly, no MVP (Neel) | §7 | not started — blocked on definitions (§3) |
| 2 | Requirements consolidated per GTM owner: India (Raghav), US (Viren), Marketing (Pankaj) | §10 | waiting on owners |
| 3 | Review dashboard + requirements every 15 days | §10 | calendar |
| 4 | Keep activity history when leads are reassigned | §6 | history of **work** kept; history of **ownership** is NOT recorded [V] |
| 5 | Pankaj owns SDR uploads + reassignment | §10 | process owner |
| 6 | Interim downloadable Excel of dial/activity data (Neel) | §8 | quick win, ~2–3 days |
| 7 | Fix reassigned leads not showing for new SDRs (India, months-old) (Neel) | §6 | partly mitigated in v13.9.4/13.9.5; real fix is §6 |
| 8 | Change status "assigned" → "new" where required (Neel) | §5/§6 | **recommend a different fix** — decision [D1] |
| 9 | Recheck meeting-logging fix; richer weekly SDR report (Neel/Raghav) | §9 | recheck is cheap; report needs requirements |
| 10 | Alternate CRM reports up to SAL; later funnel stays in Salesforce | §4 | "Closed" depends on SF sync coverage [A] |

## 2. Verified facts that shape everything

1. **No ownership history.** `lead_assignments` holds only the *current* owner (primary key user+lead). Reassigning deletes the old row. Bulk assign/unassign write **no** activity or status log. [V] ⇒ "accounts assigned to SDR A in September" cannot be reconstructed today.
2. **"Leads Assigned" in Analytics = leads *created* in the period**, not leads assigned. [V] ⇒ a reassigned lead never counts for the new SDR.
3. **There is no Account entity.** A lead is a contact; "account" = the free-text `company` (plus optional SF ids). [V] ⇒ "accounts" and "avg contacts per account" need an account key.
4. **There is no Campaign entity.** Closest things: upload batch (`upload_log_id`), `tags`, `lead_source`, cadence (`Journey`), Instantly campaigns. [V] ⇒ Marketing must define "campaign".
5. **No ICP field, no creative field.** Available: `industry`, `vertical`, `employee_count`, `annual_revenue`, `title` (→ persona). [V]
6. **"Meeting" is defined five different ways** across Dashboard, SDR Performance, My Day, Analytics Hub and one stats endpoint (4 vs 5 vs 6 stages; status-snapshot vs date-based). [V]
7. **`meeting_scheduled_at` is overwritten with the *meeting's* date** when the SDR enters one — not the booking date. `lead_closed_at` is stamped at booking and **cleared on no-show**. [V]
8. **Flow today:** booked (Meeting Scheduled) → "Mark Meeting Complete" moves it to 1st Discovery and counts a discovery meeting → or **No-show** returns it to **Calling**, bumps `no_show_count`. [V]
9. **Conversations** already have a definition: a positive outcome, or a measured duration over an org-set threshold. India logs calls manually, so this depends on SDR discipline. [V]
10. **A scheduled-report engine exists** (daily/weekly/monthly, per-report timezone/send hour). The weekly SDR email can be a report on it, not new infrastructure. [V]
11. **Every new lead is created as "Lead Assigned" even when unassigned**; Research/Calling/Lead Assigned are one stage group (pre-meeting) and all go to Salesforce as "New Lead". [V]
12. Closed outcome fields exist (`opportunity_status` Won/Lost, `sf_opportunity_id`, synced from Salesforce). Coverage unknown. [A]

## 3. Decisions needed (with my recommendation)

| ID | Decision | Recommendation |
|---|---|---|
| D1 | The "assigned → new" promise in the MOM | **Don't bulk-reset statuses.** It erases that a lead was already worked (Calling → Lead Assigned) and does nothing for the reports that ignore assignment. Instead: record an *assignment event* on every (re)assignment and report "Given/Assigned" from events. Offer an optional "start fresh" checkbox on reassign for the few cases that want it (that move already exists). |
| D2 | What is "a meeting" for an SDR | **Booked** (date+time entered, first time only) is the SAL; **Held** is the proof. Headline = Held, shown next to Booked / No-show / Upcoming. Later stages (discovery 2, demo…) never add to SDR credit. See §4. |
| D3 | Who gets credit | The SDR who booked it, even if the lead is reassigned or the AE takes over in Salesforce. Needs a stored booker (§6). |
| D4 | Can a lead skip the booking stage (e.g. AE/SF moves it straight to Discovery)? | Count it once, credited to whoever owned it, flagged "no booking record" so it is visible. You were unsure — decide with Raghav/Viren. |
| D5 | What is a "campaign" | Recommend a real **Campaign** record picked at upload (name, owner, region, channel), with tags/cadence/Instantly campaign attachable. Marketing signs off the list. |
| D6 | What is "ICP" and "persona" | Rule table owned by Marketing (industry × size band → ICP tier; title keywords → persona). We implement the rules, they own the content. |
| D7 | "Account" key | Normalised company name + domain of the website/email; SF Account id when present. Show "unmatched" so data quality is visible. |
| D8 | MQL vs Conversation | Keep **Conversation** as defined today; MQL stays TBD until Pankaj/Parul/Viren finish. Don't ship a made-up MQL. |
| D9 | Stage names (lead states) | See §5. Pick the first group's name and whether Research is a real step. |

## 4. Funnel definitions (proposed — each needs sign-off)

| Stage | Definition | Source of truth | Attribution | Edge cases |
|---|---|---|---|---|
| **Accounts** | Distinct account keys assigned in the period | new *assignment events* | the SDR the event names | reassign A→B: counts for B on that date, A keeps their earlier period; same account with many contacts → counted once; blank company → "unmatched" bucket |
| **Contacts / account** | contacts ÷ accounts | leads grouped by account key | same | accounts split across SDRs |
| **Conversations** | calls with a positive outcome or duration over threshold | existing `conversations` metric | the caller (`user_id`) | India manual logging → undercount; auto-synced calls with no outcome rely on duration |
| **Meetings (Booked)** | first entry to Meeting Scheduled with a date | status log + booking record | the booker | rebook after no-show = same meeting, not a new one; date missing = can't happen (mandatory) but SF-driven moves can |
| **SAL** | = Booked and pushed to Salesforce | booking record + SF push result | the booker | SF push fails or is delayed → show "booked, not yet in SF" |
| **Meetings (Held)** | "Mark Meeting Complete" (or later stage reached) | status log | the booker | lead reassigned before the meeting; AE marks it in SF; never marked → "overdue to confirm" list |
| **No-show** | no-show action | existing `no_show_count` + log | the booker | repeat no-shows; lead goes back to Calling and must not look new |
| **Closed** | opportunity Won/Lost | SF sync (`opportunity_status`) | the booker (via lead) | only as good as SF sync coverage — check first (§11 R2) |

Funnel view = Accounts → Conversations → Meetings (Booked → Held) → SAL → Closed, each with conversion % to the previous stage and time-in-stage.

## 5. Lead states — recommendation (display layer, no renames)

Keep stored status values and the Salesforce mapping untouched (≈37 backend refs, 18 React, 189 tests, two-way SF mapping, cadence/dialer rules, all history depend on them). Add:

1. **Ownership badge, separate from status:** `Unassigned` / `Assigned to <name>` (derived from assignments, never typed into the status column).
2. **One label map** (status → display name) used by every screen, export, the Claude connector and help text.
3. **Stage groups for monitoring** (proposed names — [D9]):
   - *To work* ← Lead Assigned (and Research if folded in)
   - *Calling* ← Calling (+ Research)
   - *Meeting booked* ← Meeting Scheduled
   - *In sales process* ← 1st Discovery, Discovery Complete, Demo Scheduled, Demo Done (AE territory)
   - *Won / Lost* ← Completed / Disqualified
   - *On hold* ← No Phone – Parked, Pending Review
   - *Other* ← legacy or unknown values (Customer Declined, Unreachable, anything new) — never dropped from counts

**Edge cases to settle before building:** born-unowned leads; reset-to-Lead-Assigned ("start fresh") must still read as *To work*; no-show returns to Calling; Pending Review used for failed-demo holding (confirm it is not also used for the reassignment/duplicate queue) [A]; stage-skip guard, kanban moves, cadence stop-on-meeting, Aircall "Meeting Set" tag and dialer queues read real values; research gate makes Research a real step when ON; AE/CSM pipelines need names that make sense to them; exports/CSV/connector must use the same labels; historical reports stay valid because stored values don't change.

## 6. Reassignment — the real fix

Today: reassigning swaps the owner row and records nothing. Reports that key off status change time, creation time or the current owner then hide the lead from the new SDR or give the old SDR's work to the new one.

**Proposal (append-only, small):**
- New table **`lead_assignment_events`**: lead_id, from_user, to_user, assigned_at, assigned_by, reason (upload | reassign | unassign | request-approved | auto-assign), batch id. Written by every assign/unassign path (bulk, auto, request approval, upload).
- New **`meeting_events`** (or columns on the booking): booked_at, booked_by_user_id, meeting_at, held_at, no_show_at(s), sf_pushed_at.
- **Backfill** what is knowable: current owner's `assigned_at`; first transitions from `lead_status_logs` (name-string `changed_by` → match to users; unmatched kept as "unattributed"); call/notes already carry user ids.
- **Reports read events, not status/created date.** "Given today/this week" (already live in My Day, v13.9.4) then uses the same source, and so do Analytics' "Accounts assigned".
- **Interim for the India backlog (289 accounts / 400+ contacts):** treat today's assignment as the event so they appear for the new SDRs immediately; no status reset needed. [V that My Day + SDR Performance "assigned now" already show them; Analytics does not.]

## 7. Dashboard spec (build once definitions are signed)

- **Views:** Campaign · Time period · ICP · Team (pod/region) · Individual SDR. Same funnel everywhere; pick any combination of filters.
- **Per campaign/period:** accounts assigned, avg contacts/account, conversations, meetings (booked/held), SALs, no-shows, closed (if SF coverage allows), plus conversion between stages.
- **Marketing extras:** leads, accounts, company size, industry, persona, creatives (needs a source — [D5/D6]).
- **Built on:** the existing Analytics Hub metric registry + semantic layer (one definition per metric) so every screen agrees. [V — registry/`MetricDefinition` already carries formula text for each metric]
- **Every number exportable** (CSV/Excel) and clickable through to the underlying leads, like the new Dashboard.
- **Not in v1:** SQL (undefined), creatives until a source exists, MQL until defined.

## 8. Interim Excel export (quick win)

- Super Admin / Pod Admin / Team lead can download **raw dial + activity rows**: date/time, SDR, lead, account, campaign (best available: upload/tag/cadence), call outcome, duration, source (Aircall / manual / Klenty), notes flag, meeting events.
- Filters: date range, SDR, pod, outcome. Uses the existing CSV/`openpyxl` plumbing; respects visibility rules (SDR sees own, Pod Admin sees pod).
- Tag each row with `counts_as_conversation` and `counts_as_connected` so the sheet reconciles to the dashboard.
- Effort: ~2–3 days incl. tests. Ship first so Raghav/Viren can validate numbers while the dashboard is built.

## 9. Weekly SDR report

- Recheck the meeting-logging fix first (look at last 2 weeks of meeting_scheduled outcomes vs `meeting_scheduled_at`/status changes; list gaps).
- Rebuild as a scheduled report on the existing report engine: per SDR and team — accounts given, calls, conversations, booked / held / no-show, SAL, week-over-week, top gaps (e.g. booked but not confirmed held).
- Content comes from Raghav's list (action item).

## 10. Phasing (rough effort; confirm after requirements land)

| Phase | What | Why first | Rough effort |
|---|---|---|---|
| **A — this week** | Excel raw export (§8); recheck meeting logging (§9); stage-group labels + ownership badge design; take-down decision on public stray files (§12) | unblocks validation, no definitions needed | 3–5 days |
| **B — foundations** | assignment events + meeting events + backfill (§6); campaign record at upload; account key; label map | every later number depends on these; history is lost every day we wait | 1–1.5 weeks |
| **C — definitions sign-off** | run the 15-day review loop: D1–D9 signed by Raghav/Viren/Pankaj | prevents building the wrong thing | parallel to B |
| **D — dashboard v1** | funnel + 5 views + exports + click-through | needs B and C | 1.5–2 weeks |
| **E — weekly report + polish** | scheduled funnel email; ICP/persona rules; Closed (if SF coverage) | needs D + requirements | 1 week |

Total ≈ 5–6 weeks of focused work, assuming requirements arrive in the next 1–2 weeks. Estimates are mine, not measured.

## 11. Research still to do (read-only, before Phase B)

- **R1 Prod data quality (needs the prod DB password, read-only):** how many meetings have a booking record; how many leads were reassigned and how often; how many leads sit in each status incl. Research; how many have no company.
- **R2 Salesforce coverage:** share of booked leads with `sf_lead_id`/opportunity synced; how Won/Lost arrives; delay.
- **R3 Meeting-logging recheck** (§9): compare outcomes vs status/date stamps for the last 2 weeks.
- **R4 Who writes statuses:** enumerate every path that changes a lead's status (call log, stage actions, kanban, cadence engine, dialer, Salesforce pull, assignments, uploads, approvals) so the event writes don't miss one. Use the code graph.
- **R5 Reassignment paths:** every path that changes `lead_assignments` (bulk, auto, approvals, uploads) so no path skips the event log.

## 12. Parked / not in this plan

- **Retire vanilla JS / make React default** — deprioritised by decision. For reference: Leads and Lead Detail still default to the classic vanilla views (React only via per-browser opt-in); the call-outcome modal (`modals.js`) is vanilla and used by React; fallbacks for Pods/Leaderboard/SDR Performance/My Settings/Activity Monitor and 17 orphan `.gz` files are dead weight; Playground stays HTML. **Consequence to remember:** features built in the React Leads page (saved views, tag filter, Dashboard click-through filters) do not reach classic-view users. Mitigation to decide later: flip the default, or port just those features.
- **Public stray files on prod** (`technicalunderstanding.html` "Technical Handoff Bible", `proxy.py`, `mock.html`, `research-prototype.html`, two dialer test pages) are served without login. A pattern scan found hostnames but no connection strings; not read end to end. Recommend removal as its own small release when you say go.
- **Staging memory:** staging is a 512 MB instance running 2 workers; heavy test runs can OOM it (happened 2026-10-08 09:48 IST). Left as is by decision.
- **Credential hygiene:** prod DB password and Render API key were pasted in chat — rotate.

## 13. Open questions by owner

- **Raghav / India (with Karan, Priyanka):** weekly report data points; is booked-vs-held the right SDR success measure; do discovery stages ever count for SDRs; list of India campaigns.
- **Viren / US:** same requirements; how US calling data should reconcile (Aircall vs Klenty).
- **Pankaj / Marketing:** campaign definition and list; ICP + persona rules; where "creatives" live; MQL/SQL definitions (with Parul).
- **Amit:** upload/reassignment process — who picks the campaign at upload; reassign reasons.
- **Neel:** D1–D9 above; confirm no status bulk-reset; confirm Excel export audience and roles.

## 14. Change log

- 2026-10-08 — v1 drafted from the MOM and code research (this doc).
