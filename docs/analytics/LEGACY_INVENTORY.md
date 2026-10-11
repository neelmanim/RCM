# Legacy Analytics Inventory

Phase 7 of the Alternate CRM Analytics Transformation program. Inventory only —
**zero code deletion**. The master doc's retirement checklist requires
"production has been monitored" as a precondition, and nothing from this
program has reached `main` yet, so that precondition is categorically
unsatisfiable this round. This document exists so the removal decision is
easy to make later, not to make it now.

| Legacy implementation | Consumer | Replacement | Status | Removal criteria |
|---|---|---|---|---|
| `_compute_meetings_booked_snapshot()` / `_compute_disqualified_snapshot()` (current-state snapshot, `analytics_routes.py`) | Legacy Analytics Hub funnel card, `report_service.py`'s `_sdr_qualified_disqualified_rows` | `meetings_scheduled` / `disqualified` canonical event metrics (`analytics/adapters.py`) | **Not removable — intentionally kept.** Different business question (current-state vs. event), not drift. Principle 5. | Never, unless the business explicitly redefines "Meetings"/"Disqualified" on the legacy Dashboard to mean the event, not the snapshot. |
| `DISQUALIFIED_STATUSES`'s 3 legacy outcome-as-status values (`"Not Interested"`, `"Unreachable"`, `"Customer Declined"`) | Legacy Dashboard snapshot only — current app code no longer writes these to `Lead.status` | Canonical `disqualified` metric only counts `status == "Disqualified"` | Live, historical-data-only | Once no `Lead` row still carries one of these 3 statuses (a one-time data check), the snapshot and the event metric converge and the distinction can be dropped from documentation — no code to remove. |
| Ask AI's grouped/ranked DSL paths (`smart_analytics.py`'s `_q_*` `group_by` branches: sdr/pod/source/status) | Legacy (non-vNext) Ask AI tab | None yet — the semantic layer is deliberately scalar-only (Phase 1/2 scope decision) | Live, population/date-column aligned to canonical in Phase 2, but still a separate implementation | Only if the semantic layer later gains real dimensional (group-by) execution — not planned in this program. |
| Ask AI's day/week/month time-series paths (`_q_time_series()`, called from `_q_calls`/`_q_emails`/`_q_meetings`/`_q_demos_*`) | Legacy Ask AI tab *and* (Phase 6) Analytics Hub vNext's Trend carve-out | Reused directly, not replaced — vNext's `/ask` Trend carve-out calls the same `execute_dsl()` path rather than duplicating it | Shared, not legacy | N/A — this is the one place vNext deliberately reuses the legacy engine instead of building a parallel one. |
| Daily Digest's own scope closures (`_is_pod_admin`/`_pod_id`/`_pod_scope_leads`/`_pod_scope_calls`/`_pod_scope_status_log`, `analytics_digest_routes.py`) | Daily Digest email generation (admin-only route, 34 call sites) | `_effective_pod_id`/`_pod_scope_lead_query`/`_pod_scope_call_query` (`analytics_routes.py`) — the shared scope helpers everything else uses | **Deferred, not migrated** (Phase 2 investigation: population differs — Digest's calls-made is CallLog-only, the shared helper's is DialerCall+CallLog union; swapping would silently change Digest's numbers). No live security gap today (route is `require_admin`-gated). | A deliberate decision to unify Digest's calls-made definition with the canonical one, made and tested independently of this program — not a mechanical swap. |
| Legacy (non-vNext) Ask AI tab as a whole | End users asking analytics questions in chat | Analytics Hub vNext's Ask Analytics tab (scalar registry metrics + Phase 6 Trend) | Live, full-featured (ranking/compare/multi/funnel/pod_summary — vNext has none of these) | Not before vNext reaches feature parity on ranking/compare/multi/funnel/pod_summary modes — none of which are in this program's scope. |
| Vanilla Analytics Hub (`view === 'legacy'` in `frontend-react/src/pages/Analytics/AnalyticsHub.jsx`) | All non-Super-Admin users (vNext entry is Super-Admin-only, `VNEXT_ALLOWED_ROLES`) | Analytics Hub vNext | Live, byte-for-byte untouched, still the default | Not before vNext entry opens beyond Super Admin and reaches UI/feature parity — a separate, later decision. |

## Not inventoried here

Refactor cleanup that happens inline as part of a Phase 2 change (e.g. an old
function body removed in the same diff that replaces its only call site)
isn't legacy retirement — it's normal migration hygiene, and doesn't appear
in this table.
