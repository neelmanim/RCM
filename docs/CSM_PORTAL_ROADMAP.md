# CSM Portal Roadmap — CSM Feedback Follow-up (started 2026-09-17)

Tracks the 10 line items a CSM raised after using the portal, mapped against
market research (HubSpot Service Hub, Totango, Custify, ChurnZero, Planhat,
Vitally, Gainsight, ClientSuccess, Velaris, Customerscore.io) and against
what `csm_portal_routes.py` / `salesforce.py` already do. Update the status
column as work lands — this is the single place to check "what's done."

Cross-cutting pattern from the research (build these, skip vendor CS-ops
config engines like Gainsight's Journey Orchestrator or Totango's
SuccessBLOCs — one internal team with fixed workflows doesn't need a rules
engine): composite health score, one account-360 screen, a renewal view
sorted by risk, threshold-triggered lightweight playbooks instead of full
automation.

## Status legend
`todo` · `in-progress` · `blocked` · `done`

| # | Item | Source system | Status | Notes |
|---|------|---------------|--------|-------|
| 1 | Account renewal early reminders | Portal | done | `get_digest` now returns `renewals_due_soon_count` (open opps closing within 30 days, overdue included), surfaced as a Digest tile. Shipped 2026-09-17. |
| — | Portfolio triage view (not in original 10, added from research) | Portal | done | Already existed: Inbox tab (`/portfolio?sort=at_risk`) sorts by health score, which already factors in renewal proximity + touch recency + champion-departed. No new build needed — corrected from this doc's first draft. |
| 2 | Usage (where is usage low) | PowerBI | deprioritized | User confirmed: stays in PowerBI, not duplicated in-portal. |
| 3 | Support tickets (open/closed/informed) | Zoho Desk | blocked | **Blocked on user**: (a) how a ticket maps to an Account — domain match vs. an Account-Name custom field in Zoho Desk, still "not sure yet"; (b) Zoho OAuth client id/secret/refresh token — user is checking. Cannot write real sync code without both. |
| 4 | Revenue/finance (ARR, T12M, MRR, licenses, invoices, credits) | Chargebee → SF | todo | User confirmed SF already carries Chargebee provisioning data. Checked Contact object fields (2026-09-17): they're on the Account/Opportunity side, not Contact — `chargebeeapps__*` fields exist on Contact (Auto_collection, Net_Term_Days, Payment_Method_*) but no ARR/MRR. Still need to describe() the Account and Opportunity objects to find the real ARR/MRR/license field names before building the sync. |
| 5 | Client communication tracking (email/SMS/calls) | SF | in-progress | `log_touch` exists for manual CSM logging. Gap: not auto-pulled from SF Activity/Task. Lower priority than #8 since manual logging covers the immediate need. |
| 6 | Project tracking | Mallik's tool | deprioritized | User confirmed: deprioritize. Revisit later — unknown system, no API info yet. |
| 7 | Stakeholder mapping (POC/Billing/Champion, contact-change alerts) | SF, Portal | done | Shipped 2026-09-17: new `AccountStakeholder` model + `sync_contacts_from_salesforce` (hooked into `run_full_salesforce_sync` after the Account sync) + `PATCH /accounts/{id}/stakeholders/{id}` for CSM-set role + Account 360 UI. SF's Contact object has **no field** for POC/Billing/Champion (confirmed via Contact.describe() field dump) — role is a Alternate CRM-only manual tag, same pattern as `manual_health_tier`. "New" badge uses SF's own Contact.CreatedDate within 14 days. |
| 8 | Engagement cadence (QBR timeline, milestones, meeting notes/action items) | SF | done | Shipped 2026-09-17: new `AccountMilestone` model (portal-native, no SF object backs this — checked while scoping #7) + `POST`/`PATCH /accounts/{id}/milestones` + Account 360 timeline UI. One flat table for both flavors (OB gets ae_name/use_cases/POCs, QBR gets cs_name/summary/action_items) rather than per-type tables. |
| 9 | Account health & risk (sentiment, churn flags) | Portal | in-progress | `set_health_override` (manual) + `champion_departed` flag already exist. Shipped 2026-09-17: relationship factor now also gets a bonus when an `AccountStakeholder` is tagged Champion (`_CHAMPION_PRESENT_BONUS`), on top of the existing departure penalty. Full composite score (usage + support + sentiment + billing signals) still needs #3/#4 data to be meaningful. |
| — | Portfolio/Inbox "select a single CSM" filter + pagination (not in original 10, requested 2026-09-17) | Portal | done | Pagination already existed on both tabs. Portfolio already had an admin-only CSM filter; Inbox didn't — added the same `Select` + narrowing logic there, plus a per-CSM "nothing at risk" empty state instead of the generic one. |
| 10 | Product usage (feature adoption, credits, license utilization) | Portal | deprioritized | Likely redundant with #2/PowerBI unless the ask is specifically feature-level adoption inline in the portal — revisit after #2/PowerBI gap is confirmed with the CSM. |
| — | Account Portfolio View, manual renewal stage | PowerBI (per CSM) / Portal | done (portal) | `get_portfolio` + stage kanban already exist in-portal; PowerBI version is separate and out of our scope. |
| — | CSM-manager (Pod Admin) oversight of reportee CSMs' accounts (the original problem statement this whole thread started from — Kanika's team) | Portal | done | Shipped 2026-09-17. See "Pod Admin CSM oversight" section below — the design question from day one of this thread, resolved by extending the CSM Portal's existing role gate rather than the originally-proposed-then-rejected full Pod reuse. |

## Pod Admin CSM oversight (2026-09-17 decision)
Kanika (and any CSM with reportee CSMs) gets a `Pod` created for her team; her
reportee CSMs join it via `User.pod_id`; she's made that pod's Pod Admin
(`User.role = "Pod Admin"`, `User.pod_id` = her team's pod — same field
`leaderboard_routes`/`analytics_digest_routes` already read for Pod Admin
scoping, not the `pod_admins` join table, which only tracks who administers
a pod for audit purposes).
- `require_admin_or_csm` now admits Pod Admin.
- `_effective_csm_scope` is a three-tier scope: Admin (everyone, or narrowed
  to `?csm_id`) / Pod Admin (every CSM in their own pod, optionally narrowed
  to `?csm_id` if it's actually theirs) / CSM (self only).
- **Read-only**: `_require_account_write_access` still requires being the
  actual assigned CSM, so Pod Admin sees the portfolio but can't log
  touches, close deals, etc. Health-override (the one endpoint with no
  write-access gate — a documented CSM/Super-Admin escape hatch) got an
  explicit Pod Admin block too, so oversight doesn't accidentally inherit it.
- Bulk-assign stays Super-Admin-only (`_ADMIN_ROLES` unchanged) — frontend
  now has a separate `canBulkAssign` prop (Super Admin/Admin only) distinct
  from `isAdmin` (includes Pod Admin, shares the CSM filter dropdown), so
  Pod Admin doesn't see a button the backend would 403 on.
- This directly reverses the earlier recommendation in this doc's first
  design conversation to use a `reports_to_id` column instead of Pod reuse —
  the user's explicit call was to use Pods, so this implements that.

## Build order (excludes deprioritized/blocked)
1. ~~Portfolio triage view~~ — done, already existed (Inbox `sort=at_risk`).
2. ~~Renewal early-reminder digest line (#1)~~ — done 2026-09-17.
3. ~~Stakeholder/contact model synced from SF (#7)~~ — done 2026-09-17.
4. ~~Health score v1 refresh (#9)~~ — done 2026-09-17 (champion-present bonus).
4b. ~~Portfolio/Inbox CSM filter + pagination~~ — done 2026-09-17.
4c. ~~Engagement cadence / QBR timeline (#8)~~ — done 2026-09-17.
4d. ~~Pod Admin CSM oversight~~ — done 2026-09-17.
5. Chargebee/finance fields on Opportunity + Account (#4) — once the real SF field names are confirmed via describe(). **Next up.**
6. Zoho Desk ticket integration (#3) — once matching key + OAuth credentials are provided.

## Open questions blocking #3
- Ticket→Account matching key: domain match (needs a `domain`/`website` field added to `Account`) vs. an existing Zoho Desk "Account Name" custom field.
- Zoho OAuth client id/secret/refresh token — user checking, not yet provided.
