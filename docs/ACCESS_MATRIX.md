# Who sees what — Activity Monitor, Call Monitor, Email, Messages

The product rule, written down so a test can hold it. **A record belongs to the pod of the person who did it.**
A record with no person on it (inbound sync rows, Instantly sends) belongs to the pod of the lead's current owner.
The pod of the *lead* never grants a Pod Admin sight of another pod's rep.

| Viewer | Own pod's reps' records | Another pod's rep calling a lead in my pod | Unowned / no-person records | Other pods' records | No-pod records |
|---|---|---|---|---|---|
| Super Admin | all | all | all | all | all |
| Pod Admin (has a pod) | **see** | **do not see** | see only if the lead's owner is in my pod | **do not see** | **do not see** |
| Pod Admin (no pod set) | **see nothing** | nothing | nothing | nothing | nothing |
| SDR / AE / CSM | 403 (no access to the monitor) | 403 | 403 | 403 | 403 |

Applies to `GET /api/admin/call-logs`, `/email-logs`, `/message-logs` and the rep dropdown on each.
Enforced by `analytics_routes._pod_scope_activity_query` (sender's pod, else lead owner's pod) and
`analytics_routes._effective_pod_id` (a Pod Admin with no pod resolves to `NO_POD`, which matches nothing).
Analytics Hub is a different question ("how are my pod's *leads* doing") and stays lead-anchored on purpose.

Tests: `backend/tests/test_access_matrix.py` — one test per cell above, including every "do not see".
Change this table first, then the tests, then the code.


# Who may export data (CSV / Excel) — v14.1.0

Exporting is **off by default**. A route's own role check still applies; the export permission is an extra condition on top.

| Who | May download a CSV / Excel file? |
|---|---|
| Super Admin (and the legacy "Admin") | yes, unless another Super Admin switched their **Data Export** off (`users.export_blocked`; you cannot switch off your own) |
| Pod Admin, SDR, AE, CSM | only if a Super Admin switched **Data Export** on for that person (Control Center → Team & Access → Users) |
| Anyone in a "View As" session by a Pod Admin | never |
| A user who has left / lost access | no (their login is refused first; offboarding also switches the flag off) |

The flags (`users.export_enabled`, `users.export_blocked`; one rule, `auth.may_export`) are read from the database on every request, so switching it off takes effect at once.
Guarded: leads export, analytics export, raw activity Excel, Team Digest and Funnel Excel, cadence roster CSV, My Day CSV,
Salesforce-log CSV, SDR-metrics export, the CSV attached to a scheduled report, and any list request bigger than 200 rows
(the Activity / Call Monitor "Export CSV" fetches 2,000 and builds the file in the browser). Every allowed export is written to the
activity log (`DATA_EXPORT`); every change of the flag too (`EXPORT_ACCESS_CHANGED`).

Not covered, on purpose: a file someone attached to a lead or an e-mail (it has its own access checks); the sandbox-refresh export
(a service token, not a user); and what a person can already read on screen — hiding a button is not a way to stop reading.

Tests: `backend/tests/test_export_guard.py` — every guarded route × (no flag / flag / Super Admin), a revoke taking effect at once,
View As, the report attachment, and a ratchet that fails the build for any route that produces a file without the guard.


# Team Digest drill-down, ICP, Export History — v14.3.0

Enforced by the real role checks (`tests/test_v14_3_persona_matrix.py`, 50 cells) and, on staging, `tests/v14-3-0-personas.spec.js`.

| What | Super Admin / Admin | Pod Admin | SDR / AE / CSM |
|---|---|---|---|
| Drill-down (By segment, Accounts, Calls, the leads behind a row) | all reps | **own pod only** (a `pod_id` they pass is ignored; a Pod Admin with no pod sees nothing) | no (403; the Team Digest page is not in their navigation) |
| Drill-down Excel | yes, unless their Data Export is switched off | only after a Super Admin switches Data Export on for them | no |
| See the ICP words | yes | yes | no |
| Change the ICP words | **Super Admin only** (recorded in the audit trail) | no | no |
| Export History / audit log | **Super Admin only** | no | no |

Guided tours: every person gets the tours for the pages in their own navigation (Help → Guided tours lists exactly those; `help-hub/data/tours.js` `roles`).
