# RCM Sales Journey — Technical Architecture

## Context

Product Discovery for **Sales Journey** — a visual, node-based, drag-and-drop workflow builder (Zapier/Make.com-style) for omnichannel sales outreach (Email, Call, LinkedIn-later) with conditional branching and event-driven triggers — is done and the PRD is approved. This document is the technical architecture: system design, DB schema, API contracts, frontend architecture, scalability guardrails, and a phased build plan, grounded in RCM's actual stack rather than a generic "modern web app" template.

**Why this isn't the generic Node/TypeScript/message-broker design the brief sketched**: RCM's backend is FastAPI + SQLAlchemy + PostgreSQL, not Node. There is **no task queue infrastructure today** — no Celery, no RQ, no Temporal. Scheduling is currently done via in-process `threading.Timer` loops (`backend/scheduled_jobs.py`), explicitly built for "Render free tier, no cron, no Celery." Redis exists only as a cache (Upstash REST), not a broker. The frontend has no node-graph/canvas library and no global state store — every feature is a standalone Vite-built React "hub" (IIFE bundle) mounted into a classic HTML/JS shell, state handled by local hooks. The design below builds Sales Journey as a natural extension of these real patterns, not a parallel stack.

**Confirmed via direct codebase exploration** (not assumed): a `DialerProvider` ABC already exists (`backend/dialer_provider.py`) abstracting Aircall/RCM behind one interface with a `NormalizedCallEvent` shape — the template for this engine's channel abstraction. An audit-log pattern already exists (`LeadStatusLog`, `UserActivityLog`) — the template for `execution_logs`. An SSE pub/sub broker already exists (`backend/sse_broker.py`) — reusable for live execution-status UI. The frontend's hub-mount contract (`window.<Name>Hub = {mount, navigate, unmount, isMounted}`) is used identically across 9 existing hubs with zero exceptions.

**Key decisions locked in with the user before this design was finalized**:
1. **Execution engine = Postgres-native poller**, not Celery+Redis-broker or Temporal — chosen explicitly as "the best and cheapest way": zero new infrastructure, zero new deploy topology (no worker dynos, no managed broker/orchestrator subscription), reuses Postgres (already running, already durable across restarts) instead of adding new ops surface for a team running a single web service today.
2. **MVA channel scope = Email + Call first, LinkedIn stubbed** — Email (Nylas) and Call (Aircall/RCM via the existing `DialerProvider`) both have working integrations to build the channel abstraction against today. LinkedIn has no official third-party messaging API — automating it means picking a unification vendor (Unipile, PhantomBuster, etc.) first, which is its own scoping exercise with real ToS/reliability tradeoffs. The `ChannelProvider` interface is architected to include LinkedIn as a first-class node type from day one; only the implementation is deferred.
3. **Auto-enrollment (entry) triggers are required from day one**, not deferred — a journey must be able to auto-enroll a lead when an event fires (e.g. "status changed to X"), not just via manual/bulk API calls. Designed symmetrically with the already-designed exit-trigger handoff (§ Entry triggers below).
4. **A minimal contact-suppression gate ships in Phase 0**, before any real lead is touched — confirmed that **no part of RCM today enforces do-not-contact/unsubscribe suppression for outreach of any kind** (manual sends rely entirely on SDR judgment). Sales Journey is the first thing that recontacts a lead repeatedly with no human re-checking each time, which is a materially different risk profile than today's manual outreach — this gate is a hard prerequisite, not a nice-to-have.

### A critical pass on this design — gaps found and closed

Before finalizing, this design was pressure-tested for edge cases rather than taken as "build it exactly as first sketched." Eight real gaps surfaced; all eight are addressed in the sections below (marked **[Gap N]** at the point each is resolved), not left as open TODOs:

1. **No lead-eligibility check before sending** — nothing stopped the engine from emailing/calling a lead who'd since been disqualified, reassigned, or unsubscribed. **Closed**: new `Lead.do_not_contact`/`unsubscribed_at` columns + a mandatory pre-send check (Fault Tolerance section).
2. **No cross-journey conflict guard** — two different journeys could both contact the same lead the same day. **Closed**: a global per-lead-per-channel-per-day cooldown, independent of and in addition to the per-journey rate cap (Guardrails section).
3. **No runaway-loop safety valve** — a cyclic graph with no real exit condition could spin a lead through the same nodes forever. **Closed**: a hard cap on `node_pass` per enrollment, forcing a dead-letter failure past the cap (Fault Tolerance section).
4. **Auto-enrollment (entry) triggers implied but never designed** — the node-type example included a `trigger` node, but only manual/bulk enrollment was actually designed. **Closed**: symmetric entry-trigger handoff, new Entry Triggers subsection (System Architecture section).
5. **Pause semantics undefined, and resume could bypass the rate cap** — pausing a journey's effect on in-flight enrollments was unspecified, and resuming a backlog could burst-inject enrollments around the guardrail. **Closed**: pause freezes `next_run_at` in place; resume re-queues overdue steps through the same rate-cap gate as new enrollments (Guardrails section).
6. **No concurrency control on the builder's autosave** — two editors on the same draft could silently clobber each other. **Closed**: optimistic-concurrency check on save (API Contracts section).
7. **Archiving a journey with active enrollments was undefined** — 200 leads mid-journey, and no stated behavior for what happens to them. **Closed**: force-exit with a confirmation gate (API Contracts section).
8. **GDPR/right-to-erasure interaction was actually broken** — `execution_logs` had no `lead_id` at all, and `journey_enrollments.lead_id` cascade-deletes, meaning a lead deletion would destroy the only join key that could ever find and purge that lead's log rows. **Closed**: denormalized `lead_id` column on `execution_logs` (no FK, same convention as `journey_id`) plus an explicit purge-by-lead-id path (Database Schema section). Note: RCM has no lead-hard-delete path today (leads are only disqualified/status-changed, never removed) — this lowers real-world urgency, but the fix is a single zero-cost column now versus a much harder retrofit on a billion-row partitioned table later.

---

## Users & Permissions

No new permission system — mapped onto the CRM's existing four roles (`Super Admin`, `Admin`, `Pod Admin`, `SDR`), enforced with the same `Depends(require_pod_admin_or_above)` / `Depends(get_current_user)` dependencies every other route already uses:

- **Pod Admin / Admin / Super Admin** — journey **authors**: create, edit, and publish journeys, view aggregate stats across their pod (or all pods for Super Admin). Matches the existing convention of gating structural/bulk actions behind `require_pod_admin_or_above`.
- **SDR** — journey **consumers only**: can enroll their own leads into an already-published journey and view the execution timeline for their own leads. Cannot create, edit, or publish. Matches the existing pattern of SDRs being scoped to their own leads everywhere else in the app (no new scoping logic to invent — reuse the same "is this lead mine" check already used elsewhere, e.g. in lead detail access).
- **Super Admin** — additionally gets the cross-pod "failed journeys" dead-letter view (Phase 4) for manual retry/skip across the whole org, not just one pod.

This drives every route's auth decorator in Deliverable 3 directly — authoring endpoints (`POST /journeys`, `PUT .../versions/{id}`, `POST .../publish`) require Pod Admin+; `POST .../enroll` and the per-lead status endpoint accept any authenticated user but filter to leads the caller can see (SDR: own leads only; Pod Admin+: pod-wide).

---

## Deliverable 1: System Architecture

### High-level overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  frontend-react/  (new "sales-journey-hub" Vite IIFE bundle)         │
│  ┌───────────────┐  ┌──────────────────┐  ┌───────────────────────┐ │
│  │ Canvas Builder │  │ Enrollment Modal  │  │ Execution Status View │ │
│  │ (React Flow +  │  │ (bulk-enroll w/   │  │ (SSE live updates,    │ │
│  │  Zustand)      │  │  preview + guard) │  │  per-lead timeline)   │ │
│  └───────┬───────┘  └────────┬─────────┘  └───────────┬───────────┘ │
└──────────┼───────────────────┼────────────────────────┼─────────────┘
           │ axios (services/api.js — existing shared client)         │
┌──────────▼───────────────────▼────────────────────────▼─────────────┐
│  backend/routes/journey_routes.py  (FastAPI, JWT auth via existing   │
│  Depends(require_pod_admin_or_above) etc.)                           │
├───────────────────────────────────────────────────────────────────┤
│  backend/journey_engine/                                            │
│   ├─ engine.py        — tick(), execute_step(), resolve_wait_node() │
│   ├─ channels/         — ChannelProvider ABC (mirrors DialerProvider)│
│   │   ├─ email_channel.py   (wraps existing Nylas send path)        │
│   │   ├─ call_channel.py    (creates a Task for the SDR — see Phase 1) │
│   │   └─ linkedin_channel.py (stub — NotImplementedError, vendor TBD)│
│   └─ triggers.py       — webhook/status-change handoff into queue    │
├───────────────────────────────────────────────────────────────────┤
│  scheduled_jobs.py: _schedule_recurring(journey_engine.tick, 30s)    │
│  (same threading.Timer pattern every other background job uses)     │
├───────────────────────────────────────────────────────────────────┤
│  PostgreSQL: journeys, journey_versions, journey_enrollments,        │
│  journey_execution_queue, execution_logs (partitioned)               │
└───────────────────────────────────────────────────────────────────┘
```

No new services, no new deploy target, no new language. One new Python package (`backend/journey_engine/`), one new route file, one new frontend hub, five new tables.

### Workflow Execution Engine

The engine is a **Postgres-native poller**: a durable `journey_execution_queue` table holds one row per pending step (`next_run_at`, claimed via `SELECT ... FOR UPDATE SKIP LOCKED`), ticked every 15–60s by the existing `_schedule_recurring` pattern already used for every other background job in this codebase (SF health check, nightly syncs, stale-call sweeper). No new dependency, no new process type.

**Core loop** (`journey_engine.tick()`):
```sql
SELECT id FROM journey_execution_queue
WHERE next_run_at <= now()
  AND (status = 'pending' OR (status = 'claimed' AND lease_expires_at < now()))
ORDER BY next_run_at
FOR UPDATE SKIP LOCKED
LIMIT 50;

UPDATE journey_execution_queue
SET status = 'claimed', claimed_by = :worker_id,
    lease_expires_at = now() + interval '5 minutes',
    attempt_count = attempt_count + 1
WHERE id = ANY(:claimed_ids);
COMMIT;  -- row lock released here; lease_expires_at is the only exclusivity guarantee from this point on
```

Each claimed row is then processed **outside** the claiming transaction, one `SessionLocal()` per row, so one enrollment's failure can't roll back or block another's. This slots directly into `scheduled_jobs.py`'s existing job-registration pattern — `journey_engine.tick` is just one more function passed to `_schedule_recurring`.

A crash mid-execution leaves a row `claimed` with a stale lease; after 5 minutes (deliberately far longer than any single outbound HTTP call takes) it becomes claimable again automatically — no heartbeat thread needed, since nothing here runs long enough to need one.

**Wait nodes and scheduling**: entering a wait node computes an absolute UTC `next_run_at` once (`now() + interval '3 days'`, or a recipient-timezone-resolved instant for "Tuesday 9am") and the row simply sits until that time — no relative-sleep chains, so no cumulative drift. Acceptable granularity is the poll interval (15–60s) — indistinguishable from precise scheduling to a human recipient of a sales email or call; this is explicitly not a hard-real-time system.

**Event-driven triggers** (no poll-tick lag): the webhook/event handlers that already exist and already normalize events — `DialerProvider.handle_webhook` → `NormalizedCallEvent`, the Nylas reply webhook, and the single funnel every status change already passes through, `log_status_change(db, lead_id, from_status, to_status, changed_by)` — each get one addition at the point they already persist the event: look up any enrollment parked on a matching wait-for-event node and set `next_run_at = now()`, `trigger_event = <event json>`. A best-effort **inline** call to `execute_step()` right after (swallow-and-log, same shape as `log_activity`) gets near-instant execution; the poller remains the guaranteed backstop if that inline call is skipped or fails.

**Conditional branching**: a branch/wait node's config carries both a timeout→next-node and an event-type→next-node map. Both the natural-timeout path (poller claims because time passed, `trigger_event` is null) and the event-triggered early-exit path (webhook handoff set `trigger_event` and forced `next_run_at = now()`) converge on one function:
```python
def resolve_wait_node(enrollment, node_config):
    if enrollment.trigger_event is not None:
        return node_config.branch_on_event[enrollment.trigger_event["type"]]
    return node_config.branch_on_timeout
```
No duplicated branch logic between the two entry paths.

### Entry triggers (auto-enrollment) — **[Gap 4]**

A `graph_definition` may include one or more `trigger` nodes (e.g. `{"type":"trigger","data":{"event":"status_changed","to_status":"New"}}`) marking the graph's entry point. These must auto-enroll a matching lead the moment the event fires — not just support manual/bulk enrollment via the API.

Mechanism, symmetric to the exit-trigger handoff above: the same funnel points that already normalize events — `log_status_change(...)`, `DialerProvider.handle_webhook(...)`, the Nylas reply webhook — get one more addition at the point they already persist the event: look up `journeys` where `status='active'` and the live version's `graph_definition` contains a matching trigger node (served by the `ix_journey_versions_graph_gin` GIN index — `graph_definition @> '{"nodes":[{"type":"trigger","data":{"event":"status_changed"}}]}'`), skip any journey where `(lead_id, journey_id)` already has an active enrollment (the same partial-unique-index check manual enrollment already enforces), then call the exact same internal enrollment function `POST /enroll` calls. **One enrollment code path, not two** — auto-enrollment just supplies the (lead, journey) pair automatically instead of a human picking it via the UI.

Journey publish-time validation (Deliverable 4) must reject a graph with no reachable trigger node — a graph with no entry point is very likely an authoring mistake.

### Fault tolerance

**What actually happens if the email-send API call fails mid-step**: retry policy is `max_attempts=5`, backoff `[1m, 5m, 30m, 2h, 6h]` on `attempt_count`, honoring a `Retry-After` header on 429s. Exhausting attempts marks the enrollment `failed` (a dead-letter state, surfaced in an admin "failed journeys" view for manual retry/skip) rather than silently dropping the lead. Non-retryable errors (invalid address, 401) skip straight to `failed` without burning through the schedule.

**Preventing double-send on retry/duplicate-claim** — the one place a duplicate is genuinely a customer-visible problem — is solved with an idempotency key (`f"{enrollment_id}:{node_id}:{node_pass}"`) checked against `execution_logs` before every outbound provider call: if a `send_attempted`/`success` log row already exists for that key, skip the send and just advance to the next node. This check happens in the channel layer, not the scheduling layer.

**Guarantee actually provided**: at-least-once execution of a step, with idempotent side effects enforced at the integration layer. Re-evaluating a branch condition twice or re-claiming a row twice is harmless and cheap; sending a duplicate email or placing a duplicate call is not, so that gets its own explicit guard (the idempotency check above), independent of the scheduling machinery. This is a deliberately lighter guarantee than Temporal's exactly-once-with-replay — chasing that would reintroduce the infrastructure cost decision #1 already rejected, for a guarantee this domain doesn't actually need (occasionally re-checking "did the lead reply yet" costs nothing; it's only the side effect that must not double-fire).

**Lead-eligibility check before every send — [Gap 1]**: confirmed no part of RCM today has a `do_not_contact`/`unsubscribed`/bounce-suppression concept, for any outreach. Adding two columns to the existing `leads` table (via the normal `migrations.py` idempotent-guard pattern, no new table needed): `do_not_contact Boolean not null default false` and `unsubscribed_at DateTime(tz), nullable`. Every `ChannelProvider.send()` implementation checks both **and** the lead's current `status` (not a terminal/disqualified state) immediately before acting — not once at enrollment time, but fresh on every single send, since a lead's eligibility can change at any point during a multi-day journey. A lead that fails this check gets `exited_reason='suppressed'` and the enrollment exits early — not silently skipped, not retried.

**Runaway-loop cap — [Gap 3]**: `journey_enrollments` gets a `node_pass` counter (increments on every node transition, not on retry). A hard ceiling — `MAX_NODE_PASSES = 500` — is checked on every transition; exceeding it force-fails the enrollment into the same dead-letter state as any other terminal failure, with `last_error = "exceeded max node passes — likely an unintended loop"`, surfaced in the admin failed-journeys view rather than spinning forever unnoticed.

---

## Deliverable 2: Database Schema Design

Conventions carried over from `backend/models.py`: UUID4 string PKs (`generate_uuid`), `DateTime(timezone=True)` timestamps, explicit `ondelete=` + `passive_deletes=True`. One deliberate deviation: **`JSONB` (not `Text` + `json.dumps`)** for the graph definition and log detail — the existing string-blob convention (`ErrorLog.context_json`) was fine for unqueried audit blobs, but a node graph needs `@>`/GIN-indexed containment queries ("which journeys use node type X"), which `Text` can't support and JSONB can natively. Defined as `JSON().with_variant(JSONB(), "postgresql")` for SQLite-dev/Postgres-prod parity, matching this repo's existing dual-DB test setup.

### `journeys` + `journey_versions` — metadata and versioning

The real hazard: editing a live graph out from under leads actively enrolled in it. Solved with immutable published snapshots, not row locking.

```
journeys
  id              String PK (uuid)
  name            String, not null
  owner_id        String FK -> users.id ON DELETE SET NULL, index
  status          String not null default 'draft'   -- draft | active | paused | archived
  live_version_id String FK -> journey_versions.id ON DELETE SET NULL, nullable
  created_at / updated_at  DateTime(tz)

journey_versions
  id               String PK (uuid)
  journey_id       String FK -> journeys.id ON DELETE CASCADE, not null, index
  version_number   Integer not null
  graph_definition JSONB not null    -- {nodes:[{id,type,position:{x,y},data:{config}}], edges:[{id,source,target,condition_expr?}]}
  status           String not null default 'draft'   -- draft | published | superseded
  published_at     DateTime(tz), nullable
  created_by       String FK -> users.id ON DELETE SET NULL, nullable
  created_at       DateTime(tz)
  UNIQUE (journey_id, version_number)

CREATE INDEX ix_journey_versions_graph_gin ON journey_versions USING GIN (graph_definition jsonb_path_ops);
```

The builder autosaves freely into a `draft` version. "Publish" is one transaction: mark this version `published`, flip the prior published version to `superseded`, update `journeys.live_version_id`. A published version is never mutated again — editing forks a new draft (`version_number + 1`). Enrollments pin to a specific `version_id`, so an in-flight lead keeps executing against the exact graph it enrolled on even after the journey moves to v2.

**Graph storage decision**: one JSONB blob per version, not normalized `journey_nodes`/`journey_edges` tables. The builder's save unit is "the whole canvas," so normalizing would turn every autosave into N row upserts with delete-diffing, for no transactional benefit. "Which journeys use node type X" is exactly what a GIN index is for — the reason to use JSONB here, not a reason to normalize.

### `journey_enrollments`

```
journey_enrollments
  id               String PK (uuid)
  journey_id       String FK -> journeys.id ON DELETE CASCADE, not null, index
  version_id       String FK -> journey_versions.id ON DELETE RESTRICT, not null   -- RESTRICT: a version with live enrollments can't be deleted out from under them
  lead_id          String FK -> leads.id ON DELETE CASCADE, not null, index
  current_node_id  String not null       -- node id from graph_definition.nodes[].id — not an FK, lives inside JSONB
  status           String not null default 'active'   -- active | completed | failed | exited_early | paused
  trigger_event    JSONB, nullable       -- set by webhook handoff when an event short-circuits a wait node
  enrolled_at      DateTime(tz)
  completed_at     DateTime(tz), nullable
  exited_reason    String, nullable

  UNIQUE (lead_id, journey_id) WHERE status = 'active'   -- partial unique index: any number of historical
                                                          -- enrollments, only one concurrently active
  INDEX ix_enrollments_journey_status (journey_id, status)
```

A lead can go through the same journey multiple times over its lifetime (re-triggered by a later event), never concurrently — enforced DB-side by the partial unique index, not just an app-side check (race-safe).

### `journey_execution_queue` — the poller's due-queue

```
journey_execution_queue
  id                String PK (uuid)
  enrollment_id     String FK -> journey_enrollments.id ON DELETE CASCADE, not null, index
  node_id           String not null
  next_run_at       DateTime(tz) not null, index
  status            String not null default 'pending'   -- pending | claimed | done | failed
  claimed_by        String, nullable      -- worker id (hostname+pid)
  lease_expires_at  DateTime(tz), nullable
  attempt_count     Integer not null default 0
  idempotency_key   String not null unique
  created_at        DateTime(tz)

CREATE INDEX ix_queue_claimable ON journey_execution_queue (next_run_at)
  WHERE status IN ('pending', 'claimed');   -- partial index: done/failed rows (the long-run majority) never
                                              -- need to be found by the poller, so they don't bloat this index
```

One row per pending step, not one persistent row per enrollment — a wait node just means the next row's `next_run_at` is days out. On step completion, the worker deletes/marks the row `done` and inserts the next node's queue row in the same transaction as the `execution_logs` insert, making step-advance atomic. Old `done`/`failed` rows are reaped on a schedule (this table stays small by design; `execution_logs` is the permanent audit trail).

### `execution_logs` — designed for billions of rows

```
execution_logs (
  id              String not null default gen_random_uuid()
  created_at      DateTime(tz) not null, server_default now()
  enrollment_id   String not null       -- no FK, see below
  journey_id      String not null       -- denormalized, avoids a join for time-range analytics
  lead_id         String not null       -- denormalized, no FK — see Gap 8 below
  node_id         String not null
  event_type      String not null       -- node_entered | node_completed | node_failed | send_attempted | ...
  channel         String, nullable      -- email | call | linkedin
  status          String not null       -- success | failure | skipped
  idempotency_key String, nullable      -- carried through for the duplicate-send check (see Fault Tolerance)
  detail          JSONB, nullable       -- provider response / error message / condition-eval result

  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);

CREATE INDEX ix_execution_logs_lead ON execution_logs (lead_id, created_at);
```

- **Composite PK `(created_at, id)`**: a Postgres requirement for range-partitioned tables — the partition key must be part of the PK.
- **Monthly partitions** (`execution_logs_2026_08`, etc.), created ahead of time by a small scheduled job following this repo's existing `migrations.py` style (raw `CREATE TABLE ... PARTITION OF ...`, guarded by `_table_exists`, run monthly).
- **No FK constraint** on `enrollment_id`/`journey_id`/`lead_id` — addressed directly, not hand-waved: a real FK would force an index lookup against `journey_enrollments` on every single insert at billions-of-rows volume, for a fire-and-forget audit log where referential integrity is already guaranteed at the application layer (the id always comes from a row read in the same transaction). This mirrors `UserActivityLog`'s existing lack of FK enforcement beyond `user_id`, just applied at a much larger scale where it matters more.
- **Indexes**: `(enrollment_id, created_at)` for the hot "get history for one enrollment" query, plus `(lead_id, created_at)` for the purge/lookup query below. No separate index on `journey_id` or `node_id` — "logs for a time range" is served by partition pruning on `created_at` itself; adding more indexes here just taxes every one of the billions of inserts for a pattern already covered.
- **`lead_id` denormalized here — [Gap 8]**: `journey_enrollments.lead_id` is `ON DELETE CASCADE`, so if a lead is ever hard-deleted, the enrollment row disappears — and without a `lead_id` column directly on `execution_logs`, that would destroy the only join key that could ever find and purge that lead's log rows, leaving unpurgeable PII scattered across a billion-row partitioned table forever. Storing `lead_id` directly (denormalized, no FK, same convention as `journey_id`) means a future purge/right-to-erasure request is a direct, indexed `DELETE FROM execution_logs WHERE lead_id = :id` regardless of what's happened to the enrollment row. Note: RCM has no lead-hard-delete path today (leads are only disqualified/status-changed, never removed) — this is cheap insurance against a future feature, not a fix for an active bug.

### Idempotency mechanism

The key lives on `journey_execution_queue.idempotency_key` (unique, generated once when the queue row is created, stable across retries of the same step). No separate `idempotency_keys` table — that would just be a second place to check the same fact. Before any provider call, the channel layer checks `execution_logs` for an existing `send_attempted`/`success` row with that key; if found (a retry after a crash post-send-but-pre-commit), skip the send and just advance. `idempotency_key` is carried onto the (permanent) `execution_logs` row specifically because the (transient) queue row gets reaped after completion — the duplicate-send check needs to survive that cleanup.

---

## Deliverable 3: API Contracts

New router: `backend/routes/journey_routes.py`, `APIRouter(prefix="/api/journeys", tags=["journeys"])`, mounted in `main.py` like every other route file. Auth follows the existing `Depends(require_pod_admin_or_above)` / `Depends(get_current_user)` pattern — journey authoring requires Pod Admin+, enrollment can be triggered by an SDR on their own leads. Responses are plain `dict`/FastAPI-serialized (matching the codebase's existing no-Pydantic-response-model convention), errors are `raise HTTPException(status_code, detail)` inline.

**`POST /api/journeys`** — create a journey (empty draft version 1)
```json
// request
{ "name": "New SDR Outreach Sequence" }
// response  201
{ "id": "8f3e...", "name": "New SDR Outreach Sequence", "status": "draft",
  "live_version_id": null, "draft_version_id": "a1c2..." }
```

**`PUT /api/journeys/{id}/versions/{version_id}`** — autosave the draft graph (called frequently by the builder; only touches `draft` versions, 409s if `version_id` isn't the current draft)
```json
// request
{ "graph_definition": { "nodes": [ {"id":"n1","type":"trigger","position":{"x":0,"y":0},"data":{"event":"lead_created"}},
                                     {"id":"n2","type":"email","position":{"x":200,"y":0},"data":{"template_id":"tpl_1"}},
                                     {"id":"n3","type":"wait","position":{"x":400,"y":0},"data":{"duration_hours":72}} ],
                        "edges": [ {"id":"e1","source":"n1","target":"n2"}, {"id":"e2","source":"n2","target":"n3"} ] },
  "expected_updated_at": "2026-08-05T09:58:00Z" }
// response  200
{ "version_id": "a1c2...", "version_number": 1, "status": "draft", "saved_at": "2026-08-05T10:00:00Z" }
// response  409 (someone else saved first)
{ "detail": "This journey was modified by another editor since you last loaded it. Refresh to see their changes." }
```
**Optimistic concurrency — [Gap 6]**: the builder sends back the `updated_at` it last saw for this draft version as `expected_updated_at`; the route does `UPDATE journey_versions SET ... WHERE id=:version_id AND updated_at=:expected_updated_at`, and treats zero rows affected as a 409, not a silent overwrite. No new locking table — reuses the `updated_at` column every table already has.

**`POST /api/journeys/{id}/publish`** — publish the current draft (atomic: draft→published, prior published→superseded, `journeys.live_version_id` updated). Also validates: at least one reachable trigger node exists, and no unreachable/misconfigured nodes remain (server-side re-check of the client-side canvas validation — Deliverable 4 — since publish is a state-changing action that must not trust client-only checks).
```json
// response  200
{ "id": "8f3e...", "status": "active", "live_version_id": "a1c2...", "version_number": 1 }
```

**`POST /api/journeys/{id}/archive`** — **[Gap 7]** archive a journey, force-exiting any active enrollments
```json
// request
{ "confirm_exit_count": 214 }   // caller must echo back the current active-enrollment count, same
                                 // count-confirmation pattern as bulk enroll (Deliverable 5) — a UI-only
                                 // "Archive" button with no visibility into blast radius is how 214 leads
                                 // get silently orphaned
// response  200
{ "id": "8f3e...", "status": "archived", "enrollments_exited": 214 }
// response  409 if confirm_exit_count doesn't match the current live count (someone enrolled more since the confirm dialog opened)
```
Every force-exited enrollment gets `status='exited_early'`, `exited_reason='journey_archived'` — visible in that lead's history, not silently dropped.

**`POST /api/journeys/{id}/enroll`** — enroll leads (see Deliverable 5 for the guardrail this endpoint enforces)
```json
// request
{ "lead_ids": ["l1", "l2", "l3"] }               // or: { "filter": { "pod_id": "p1", "status": "new" } }
// response  200
{ "requested": 3, "enrolled": 2, "skipped": [ { "lead_id": "l3", "reason": "already_active_in_journey" } ] }
```

**`GET /api/journeys/{id}/enrollments/{lead_id}`** — execution status for one lead (drives the per-lead timeline UI)
```json
// response  200
{ "enrollment_id": "e1", "lead_id": "l1", "journey_id": "8f3e...", "status": "active",
  "current_node_id": "n3", "enrolled_at": "2026-08-01T09:00:00Z",
  "history": [
    { "node_id": "n1", "event_type": "node_entered", "status": "success", "created_at": "2026-08-01T09:00:00Z" },
    { "node_id": "n2", "event_type": "send_attempted", "status": "success", "channel": "email", "created_at": "2026-08-01T09:00:05Z" },
    { "node_id": "n3", "event_type": "node_entered", "status": "success", "created_at": "2026-08-01T09:00:05Z" }
  ] }
```

**`GET /api/journeys/{id}/stats`** — aggregate enrollment counts per status, for the builder's dashboard header (backed by `ix_enrollments_journey_status`).

Live updates while the status view is open reuse the existing `sse_broker.publish(user_id, {...})` mechanism (generalized to also key by `journey_id` if a Pod Admin needs to watch a journey they don't personally own — the queue/backpressure/keepalive mechanics of `sse_broker.py` carry over unchanged).

---

## Deliverable 4: Frontend Architecture (Visual Builder)

### Where this shows up in the actual product

Checked the real nav (`NavSidebar.jsx`) and lead detail page (`pages/Leads/LeadDetail.jsx`) rather than leaving this implicit — three touchpoints, all reusing existing UI real estate:

1. **New sidebar nav item, "Sales Journeys"**, placed right after "Leads" (`roles: ['all']`, matching the existing per-item role convention) — the hub branches its own UI by role internally (authors get the builder + all journeys; SDRs get a read-only list scoped to their own enrolled leads), the same way `HelpHub` already branches content by `userRole` rather than needing separate nav entries per role.
2. **`LeadsHub`'s existing `BulkActionBar`** (confirmed already handles multi-select bulk actions like tag/assign) gets a new "Enroll in Journey" action — this, not the builder, is the actual day-to-day entry point for getting real leads into a journey.
3. **`LeadDetail.jsx`** gets an inline "Journey Status" card for any lead currently enrolled — "Enrolled in *SDR Outreach Sequence* — at step 3 (Wait 3 days), next action Thu 9am," backed by `GET /journeys/{id}/enrollments/{lead_id}`. This is where an SDR actually notices the feature exists day-to-day, more than the dedicated nav destination in #1.

### Hub scaffolding

Follows the existing hub recipe exactly, confirmed with zero exceptions across 9 existing hubs — no reason for this one to break the pattern:
- `frontend-react/vite.config.sales-journey.js` (copy of `vite.config.leads.js` — IIFE build, output to `frontend/js/`)
- `frontend-react/src/sales-journey-entry.jsx` exposing `window.SalesJourneyHub = {mount, navigate, unmount, isMounted}`
- `frontend-react/src/features/sales-journey/` — the feature folder

**Canvas library: React Flow (`@xyflow/react`)**. Confirmed this repo has zero existing node-graph/canvas library (no reactflow/d3/konva/fabric) — this is a clean new addition, not a duplicate of anything. It's the standard choice for exactly this UI (infinite canvas, custom node types, edges, minimap, drag-to-connect) and the brief itself named it.

**State management: a new `useSalesJourneyBuilder` hook + Zustand for canvas state only.** This repo has no global state library today (confirmed — no Redux/Zustand/Jotai/React Query; everything else is local hooks + `useState`/`sessionStorage`, e.g. `useLeadsList.js`). That pattern is right for list/filter state but genuinely doesn't fit a canvas with deeply-nested, frequently-mutated state (nodes, edges, per-node config panel, selection, undo/redo) — trying to force that shape through plain `useState` at the hub root would mean prop-drilling or excessive re-renders on every drag frame. Zustand is the standard pairing with React Flow specifically because it lets node components subscribe to only the slice of state they need (avoiding a full-canvas re-render per drag), and it's one small new dependency for a state shape nothing existing was built to handle — not a speculative addition.
- Canvas state (nodes, edges, selected node, dirty flag) → Zustand store, scoped to this feature folder only (not a repo-wide store).
- Server state (loading/saving the journey, enrollment stats) → the existing local-hook + `SalesJourneyService` pattern (mirrors `useLeadsList.js`), reusing the shared `services/api.js` axios client (auth/baseURL already solved there).

**Design system reuse**: node config side-panels, the enrollment modal, and the publish confirmation all reuse `components/ui/Modal`, `Card`, `Input`, `Button` (`variant`/`size` conventions already established), `Badge` (new variant for node-type/status pills, following the existing `default|primary|success|warning|danger|info|purple|emerald|indigo|teal|rose` set — no new color system invented). Save/validation feedback uses the existing `rcm:toast` event convention.

**Validation before save**: client-side graph validation (unreachable nodes, a branch node missing a required edge, an email node with no template selected) runs on every node/edge change via a pure function over the Zustand graph state, surfaced as inline node-border warnings (red outline + `Badge variant="danger"` on the offending node) — publish is disabled while any validation error exists, checked again server-side in `POST /publish` as the authoritative gate (never trust client-only validation for a state-changing action).

**Testing**: Vitest + Testing Library, same convention as every other hub — `frontend-react/src/test/sales-journey/`, mocking `services/api.js` the same way `LeadsHub.test.jsx` does.

---

## Deliverable 5: Scalability & Performance Guardrails

**Preventing an accidental 100k-lead enrollment blast**:
- `POST /enroll` is synchronous only up to a small inline batch (e.g. 200 leads); above that, the request itself is rejected with a 400 telling the caller to use the filter-based bulk path, which enrolls in application-level batches (e.g. 500 at a time) via the same background-thread pattern `email_routes.py` already uses for bulk mailbox sync — not all inserted in one request/transaction.
- A **hard per-journey enrollment-rate cap**, enforced in the enrollment endpoint itself: no more than N new enrollments per journey per hour (configurable, default conservative — e.g. 2,000/hour), independent of how many leads were requested. Excess requests queue behind the cap rather than being enrolled instantly, which is also what naturally protects the email/dialer providers downstream (see next point) — the cap is a single row-count check against recent `enrolled_at` timestamps, no new infrastructure.
- The publish/enroll UI surfaces a **confirmation step showing the exact enrollment count** before it happens (not a blind "Enroll" button) — the same category of guard as `ConfirmDialog` already provides elsewhere in the design system, reused here, not reinvented.

**Cross-journey per-lead cooldown — [Gap 2]**: the per-journey rate cap above doesn't stop two *different* journeys both contacting the same lead the same day. A second, global check runs in the channel layer right alongside the eligibility check (Deliverable 1): no more than one outbound touch per lead per channel per rolling 24h, queried across `execution_logs` by `lead_id` regardless of which journey it came from (the same `ix_execution_logs_lead` index added for Gap 8 serves this query too). A step blocked by this cooldown reschedules itself a few hours out rather than failing — it's a timing conflict, not an error.

**Pause/resume semantics — [Gap 5]**: pausing a journey (`journeys.status='paused'`) freezes every one of its enrollments in place — the poller's claim query adds `AND j.status != 'paused'` (joined through `journey_enrollments.journey_id`), so `next_run_at` timestamps are simply not advanced while paused, not lost. Resuming does **not** fire every now-overdue step at once (that would burst-inject enrollments straight around the rate cap): overdue steps are re-queued through the exact same enrollment-rate-cap gate `POST /enroll` uses, spreading the backlog out rather than bypassing the guardrail that exists specifically to prevent bursts.

**Rate limits and deliverability**: outbound sends don't hit Nylas/Aircall directly from the enrollment burst — they're paced by the poller's own `LIMIT 50`-per-tick claim, which is already a natural throttle (50 sends/calls per 15–60s tick, tunable). On top of that, the channel layer respects each provider's actual rate-limit signal (`Retry-After` on Nylas/Aircall 429s, already handled per-provider in `aircall_provider.py`/`rcm_provider.py` — reused, not rebuilt) and a configurable **per-domain email cadence limit** (e.g. no more than N emails/hour to the same recipient domain, checked before send) to protect sender reputation/deliverability, since a workflow engine sending at machine speed is exactly the kind of traffic that gets a sending domain flagged if unthrottled.

**Keeping `execution_logs` fast as it grows to billions of rows**: covered in Deliverable 2 — monthly range partitioning (so old data is never scanned for current queries and can be dropped/archived by simply detaching old partitions, not a slow `DELETE`), a single indexed hot-path query (`enrollment_id, created_at`), and time-range analytics served by partition pruning instead of a secondary index. `journey_execution_queue` stays small by design (transient rows, reaped after completion) so the poller's claim query never has to search through history — the two tables are deliberately separated (queue = small and hot, logs = huge and append-only) rather than one table trying to serve both jobs.

### Monitoring & Observability

Checked first: there is no Sentry/Datadog/Prometheus/APM anywhere in this backend. Production monitoring today is **UptimeRobot polling `GET /api/monitoring/health`** (`backend/routes/monitoring_routes.py`) — a single rich, key-authenticated endpoint already reporting DB connectivity, scheduler/background-job state, and row counts, with UptimeRobot alerting on a keyword match (`"status":"ok"` missing). The right move is extending this existing endpoint, not standing up a new monitoring stack — same "best and cheapest, reuse what's already paid for and working" reasoning as the execution engine decision itself.

Signals to add to that endpoint's payload:
- **Last poller-tick timestamp** — alert if stale beyond ~2x the tick interval (mirrors the scheduler-liveness check this endpoint already does for other background jobs).
- **Queue depth** — count of `pending`/`claimed` rows in `journey_execution_queue` (a healthy system keeps this near zero; a growing number means the poller is falling behind or stuck).
- **Oldest overdue unclaimed row age** — `now() - next_run_at` for the oldest `pending` row past due. This catches a poller that's technically still ticking but not actually making progress (queue depth alone wouldn't distinguish "busy" from "stuck").
- **Failed-enrollment count in the last 24h** — a sudden spike signals a channel-level outage (e.g. Nylas down) rather than isolated bad data.

Two existing fire-and-forget logging helpers are reused as-is, not replaced:
- **`error_logger.log_error(...)`** for every enrollment that hits the `failed` (dead-letter) terminal state — this helper already has deduplication, PII redaction, and per-user rate-limiting built in, plus an `action_hint` field that's exactly what the admin "failed journeys" view (Phase 4) needs to show ("Ask the SDR to re-check this lead's email address" style guidance), rather than inventing new error-logging plumbing.
- **`activity_logger.log_activity(...)`** for journey lifecycle events (created, published, enrolled) — same convention every other feature already uses for its audit trail.

---

## Deliverable 6: Implementation Phases

Each phase ships independently and is individually verifiable — no phase depends on a later one existing yet. Follows this repo's established `develop → staging → main` promotion discipline, one phase per promotion, `/ponytail-review` + `/ponytail-audit` before each `staging → main` step per `CLAUDE.md`.

**Phase 0 — MVA backbone (prove the engine works, no UI yet)**
- `journeys`, `journey_versions`, `journey_enrollments`, `journey_execution_queue`, `execution_logs` tables (via `migrations.py`, following its existing idempotent-guard pattern), plus `leads.do_not_contact`/`leads.unsubscribed_at` (Gap 1).
- `journey_engine.tick()` wired into `scheduled_jobs.py`, with exactly **one** hardcoded node type working end-to-end: `email` (reusing the existing Nylas send path) plus `wait`. No LinkedIn yet.
- **The suppression gate (Gap 1) and the runaway-loop cap (Gap 3) ship in this phase, not later** — per the decision to treat suppression as a hard prerequisite before any real lead is touched, and the loop cap is nearly free to include from the start.
- **Entry triggers / auto-enrollment (Gap 4) also ship in this phase**, per the decision that it's required from day one, not deferred — the trigger-matching query and the shared enroll-path handoff described in System Architecture.
- No conditional branching, no builder UI yet (both Phase 1/2) — but the trigger and suppression mechanisms that everything else depends on are in place from the start.
- Prove it: seed one journey via a script/fixture (not the UI), auto-enroll a test lead via a simulated status-change event, watch it progress through email → wait → complete, verify `execution_logs` and idempotency (kill the poller mid-tick, confirm no duplicate send on restart), and verify a `do_not_contact=true` lead is skipped rather than emailed.
- This phase alone validates the two highest-risk architectural bets — the Postgres-poller execution model AND the trigger/suppression mechanics every later phase builds on — before a single line of frontend code is written.

**Phase 1 — Call channel + conditional branching — SHIPPED, revised from the original plan**
- **`call_channel.py` deliberately does NOT wrap `dialer_service.initiate_call`, contrary to the original sketch above.** Reading that function closely during implementation surfaced a real product/safety issue: it's built for a live SDR clicking "Dial" (rings the SDR's own phone in bridge mode, or requires them actively in the browser) — there is no automated-outbound-call path in this dialer system at all. Auto-firing it from the engine would ring an SDR's phone unprompted whenever a wait timer happened to expire (could be 3am), with no context. Confirmed with the user before building: a "call" node instead creates a `Task` reminder for the lead's assigned SDR (same model `task_routes.py` already uses) — the SDR places the call when they see it. Keeps a human in the loop for calling, matching how this dialer system works everywhere else in the app.
- `ChannelProvider` abstraction formalized (mirrors `DialerProvider`) — `email` and `call` both implemented.
- New `condition` node type (distinct from `wait`): resides at `current_node_id` for up to `timeout_hours`, resolving via `branch_on_event`/`branch_on_timeout` in `_handle_condition_node`. A `wait` node's delay was also corrected during implementation to apply when *entering* the node (its own residency), not when *leaving* it — the original Phase 0 sketch had this backwards, caught by writing the timing test precisely rather than just eyeballing it.
- Event-driven early-exit (`check_exit_triggers`) wired into all three real funnel points: `models.log_status_change` (status-changed branches), `dialer_service.handle_webhook` (CALL_ANSWERED/CALL_ENDED branches), and the Nylas inbound-message webhook (`email_replied` branches) — not just proven in isolation.
- Cross-journey per-lead-per-channel cooldown (Gap 2) implemented in `_handle_channel_node`, checked via `execution_logs` (`ix_execution_logs_lead`).
- Still no builder UI — journeys authored via API/fixtures.

**Phase 2 — Visual builder (read-only + save, no publish yet) — SHIPPED**
- `sales-journey-hub` bundle scaffolded (`vite.config.sales-journey.js`, `sales-journey-entry.jsx`, mount contract identical to every other hub). **Not yet wired into `index.html`/`app.js`/the nav sidebar** — deliberately deferred to Phase 3, when publish/enroll make the feature actually usable end-to-end; building the nav entry now would just point at a builder with nothing to publish to yet.
- Two backend endpoints the builder needed that weren't in the original API sketch: `GET /journeys` (list) and `GET /journeys/{id}` (fetch a journey + its current draft graph) — the builder can't load existing work without them, added with route-level tests.
- React Flow (`@xyflow/react`) canvas + Zustand (`useJourneyStore`) for canvas state, exactly as planned. One node-type UI component (`JourneyNode`) reused across all 5 backend node types (trigger/email/wait/condition/call) rather than five near-identical files.
- **Condition-node branching is authored via the config panel's node-id dropdowns (`branch_on_timeout`, `branch_on_event`), not drag-connected edges.** The backend reads these fields from the node's own `data`, not from graph edges (see Phase 1) — building custom multi-handle edge UI to visually represent the same thing would be real added complexity for no behavioral difference, so this was a deliberate simplification, not an oversight.
- Client-side validation (Deliverable 4) implemented as a pure function (`validation.js`) — orphaned/unreachable nodes, missing required fields, dangling condition-branch targets — surfaced both as a header count and per-node indicators. Still not the authoritative gate; `POST /publish` re-validates server-side (already enforced the trigger-node check in Phase 0).
- Optimistic concurrency (Gap 6) wired end-to-end: the builder sends back the `updated_at` it loaded, a stale value 409s with a clear message instead of silently overwriting.
- A real jsdom gap surfaced and was fixed globally: `@xyflow/react` needs `ResizeObserver`, which jsdom doesn't implement — added a no-op polyfill to the shared Vitest setup (safe for every other test, since nothing else uses it).

**Phase 3 — Publish, enroll, and status UI — SHIPPED, one deliberate simplification**
- Publish flow (draft → published version, atomic swap, server-side trigger validation — already enforced since Phase 0) wired into the builder with a `ConfirmDialog`; Publish is disabled while there are unsaved changes or validation errors, so a stale/invalid draft can't go live.
- Archive flow (Gap 7) implemented exactly as designed: `POST /journeys/{id}/archive` requires the caller to echo back the current active-enrollment count, force-exits them (`exited_reason='journey_archived'`), and cancels their pending queue rows so the poller doesn't touch them again.
- Enrollment guardrail (Deliverable 5) implemented as the simpler of two options: excess requests beyond `ENROLLMENT_RATE_CAP_PER_HOUR` (2000) are skipped with a `rate_cap_reached_try_again_later` reason the caller can retry on, rather than deferred into a separate queuing mechanism — no new infrastructure for what's fundamentally a "try again shortly" case.
- **Live SSE-backed status updates were NOT built — a deliberate scope cut, not an oversight.** The original plan's own language flagged the `sse_broker` keying (today `user_id`-only) as needing to "widen" for multi-watcher journey status, which is real added complexity for a nice-to-have (the alternative — manual refresh via the existing `GET /journeys/{id}/enrollments/{lead_id}` and the new `GET /journeys/by-lead/{lead_id}` — already gives correct, just non-live, status). Upgrade to real SSE if live-updating status actually becomes a product ask.
- **Where this shows up in the product** (Deliverable 4), built exactly as planned, with one real gap caught before wasting effort: `frontend-react/src/pages/Leads/LeadDetail.jsx` has **zero importers** (confirmed via the code-review-graph) — it's dead code from the same abandoned SPA-rewrite tree as the earlier `Login.jsx` false lead. The live lead detail page is the classic `frontend/js/views/lead_detail.js`; the Journey Status card was built there instead, as a progressively-loaded vanilla-JS card matching that file's existing Notes/Tasks/Calls pattern exactly, backed by a new `GET /journeys/by-lead/{lead_id}` endpoint (the existing per-journey status endpoint requires already knowing the journey_id, which a lead detail page doesn't have).
- New nav item "Sales Journeys" — scoped to `Pod Admin+` (not `roles: ['all']` as the original Deliverable 4 sketch assumed), because the hub doesn't yet branch into a read-only SDR view; showing SDRs a destination that 403s on every request would be worse than not showing it. SDRs still see their own leads' status via the Lead Detail card, which uses `get_current_user`, not the Pod-Admin+ gate.
- "Enroll in Journey" added to `LeadsHub`'s `BulkActionBar` — fetches the active-journey list lazily on first open (not on every bar render), reuses the existing 200-lead cap with a clear message rather than silently truncating.
- This is the first phase where an SDR could plausibly use the feature end-to-end for a real (small) journey — build → publish → bulk-enroll → see status on the lead page.

**Phase 4 — Hardening & scale — SHIPPED**
- Partition-creation upkeep now also runs as a recurring daily job (`journey_partition_upkeep` in `scheduled_jobs.py`), not just at boot — a long-lived instance that never restarts would otherwise eventually run past the "current + 2 months ahead" window created at startup.
- Pause/Resume implemented for real — this closed an actual gap: the poller's claim query never checked `journeys.status` at all before this phase, so "paused" was a value the model allowed but the engine silently ignored. `_claim_due_rows` now joins through `JourneyEnrollment → Journey` and excludes paused journeys' rows, with `FOR UPDATE OF journey_execution_queue` specifically (not the joined tables) so the lock doesn't contend with the enroll/publish/pause endpoints touching those same rows.
- **Resume's "spread the backlog out" requirement (Gap 5) turned out to already be satisfied — no new rate-limiting was built.** The poller's existing per-tick claim batch (`CLAIM_BATCH_SIZE=50`, ticked every 30s) already paces execution regardless of how many rows are simultaneously due; a resumed journey's overdue backlog is processed at exactly the same pace as any other backlog. Resume is a one-line status flip; building a second, redundant rate-limiter on top would have been unrequested complexity.
- Admin dead-letter view: `GET /journeys/{id}/failed-enrollments` (lead name, `exited_reason`, `last_error`), `POST /journeys/enrollments/{id}/retry` (reactivates at the current node, due immediately), `POST /journeys/enrollments/{id}/skip` (dismisses permanently) — surfaced inline in the builder (not a separate page) since an admin checking on a journey is already looking at this screen.
- Per-domain deliverability throttle (`EMAIL_DOMAIN_CADENCE_LIMIT_PER_HOUR`, default 50/hour) — distinct axis from the Gap 2 cross-journey cooldown: protects the *sending* domain's reputation across all leads/journeys, not one lead from over-contact. Implemented as a join from `execution_logs` to `leads` for the domain match (`ponytail`-flagged: a LIKE match, not an indexed domain column — fine at current volume, upgrade path noted if it becomes a hot query).
- Both the enrollment-rate cap and the domain-cadence limit are now env-var overridable (`JOURNEY_ENROLLMENT_RATE_CAP_PER_HOUR`, `JOURNEY_EMAIL_DOMAIN_CADENCE_LIMIT_PER_HOUR`) — "tuning based on real usage" without a redeploy.
- 8 new engine-level tests + 12 new route tests (pause/resume, dead-letter list, retry, skip, domain cadence), plus frontend Pause/Resume buttons and an inline `FailedEnrollmentsPanel` with 4 new tests.

**Phase 5 (deferred, not scoped yet)** — LinkedIn channel, once a unification vendor (Unipile/PhantomBuster/etc.) is chosen; the `ChannelProvider` interface from Phase 1 accepts it as a new implementation with no changes to the engine itself.

---

## Files to create (Phase 0 first)

- `backend/journey_engine/__init__.py`, `engine.py`, `channels/base.py`, `channels/email_channel.py`
- New tables added to `backend/models.py`, applied via `backend/migrations.py` (idempotent-guard style, matching existing functions in that file)
- `backend/routes/journey_routes.py`, mounted in `backend/main.py`
- One new job registration in `backend/scheduled_jobs.py::start_scheduled_jobs()`

## Verification

- Phase 0: a `backend/tests/test_journey_engine.py` (pytest, matching existing test conventions in `backend/tests/`) covering the claim-query concurrency (two simulated workers, `SKIP LOCKED` correctness), the idempotency check (duplicate claim doesn't double-send), and the wait-node timing math.
- Each phase: full backend suite (`JWT_SECRET=test_secret python3 -m pytest`) plus, from Phase 2 on, `npm run test` in `frontend-react/` for the new hub, following the existing `vi.mock('../../services/api', ...)` convention.
- Phase 3 (first user-facing phase): manual click-through — build a 3-node journey (email → wait → call), enroll 2 test leads, confirm the status UI updates live via SSE, confirm the enrollment-count confirmation guard actually blocks a bulk enroll above the configured cap.
