# Alternate CRM — Architecture: measured state, target, and the route between them

**Written 2026-09-09 against v12.2.3.** Every number below was measured from
the code (import graph, router parse, handler-length parse), not estimated.
Re-measure before trusting it; the commands are in §7.

---

## 0. The honest diagnosis first

The brief for this document was "a messy production codebase." It is worth
saying plainly that **the measurements do not support that characterisation**,
and the prescription changes because of it.

| What people expect to find | What is actually there |
|---|---|
| Circular dependency tangle | **1** genuine cycle (`dialer_service ⇄ salesforce`) |
| Dead abstractions everywhere | React side: **1** orphaned module (155 ln) |
| No tests, so nothing is safe to move | **45,459 lines of backend tests** to 46,333 lines of source — near 1:1 |
| God objects | 1 real one: `models.py`, 1,872 lines / 47 model classes / 65 importers |

This is not spaghetti. It is a **flat, fat, layer-less** codebase: correct,
well-commented, heavily tested, and organised by *technical kind*
(`routes/`, `services/`) rather than by *responsibility*. The failure mode
that produces is not tangling — it is **duplication of rules**, and every
significant incident in this repo's recent history has that shape:

- `dialer_service._try_live_self_heal` and `dialer_routes.get_call_status`
  each wrote `provider_call_id` independently → the v12.2.2 prod incident,
  17 unhandled 500s over four days.
- `email_routes.send_email` marked a mailbox unhealthy on a Nylas 401/403;
  `email_send.py` — the shared campaign/cadence path — did not → mailboxes
  showing "Connected" while every send failed.
- 15 hand-copied `*-entry.jsx` shims, all 15 with the same `navigate()`
  defect → two separate blank-screen bugs.
- 27 inline `role == "..."` comparisons across 12 route files → the v12.2.1
  Pod Admin privilege-escalation fixes.

**So the goal is not "clean architecture" as a shape. It is: give every
business rule exactly one home.** The folder structure in §3 is a means to
that; adopting the folders without collapsing the duplicated rules would be
pure cost.

---

## 1. Measured state

### Backend — 46,333 lines, 114 modules

```
backend/
├── main.py                    app assembly, router registration
├── models.py            1,872 47 model classes, 65 importers   ← the one god object
├── database.py                engine/session          56 importers
├── auth.py                    JWT + 8 require_* guards 42 importers
├── routes/               49 files, 313 HTTP handlers
├── services/              3 files — lead_service (129), smart_analytics (2,364)
├── analytics/  journey_engine/  middleware/  migrations/
└── 43 more root-level modules that are services in all but location
    (dialer_service 1,785 · salesforce 1,353 · scheduled_jobs 1,343 …)
```

### The four structural findings

**1. There is no service layer — `services/` is a directory, not a layer.**
Three files, one of which (`lead_service.py`, 129 ln) is the only thing that
looks like a service. The other 43 services live at the repo root as
peer modules to `main.py` and `models.py`, so nothing about the layout says
which of them may call which.

**2. The transport layer owns persistence.** Across 43 route files:

| | count |
|---|---|
| `db.query(...)` calls inside route modules | **563** |
| `db.commit / add / delete / flush` inside route modules | **272** |
| HTTP handlers over 100 lines | **16** (longest: `upload_enriched_sheet`, 427 ln) |

An HTTP handler that opens a transaction is a handler that cannot be reused
by a scheduled job, a webhook, or the public API — which is why those callers
re-implement the rule instead. This is the mechanism behind every incident
listed in §0.

**3. Authorisation is a rule with no home.** 154 uses of `Depends(require_*)`
— good — *plus* 27 bare role-string comparisons across 12 files, *plus* 52
`pod_id` filter expressions across 15 files. Pod scoping is the product's
central security invariant and it is written out by hand in fifteen places.

**4. 313 function-local imports across 59 files.** Only **one** is breaking a
real cycle. The other 312 are habit — and they hide the dependency graph from
every tool that would otherwise draw it, including the graph MCP this repo
ships with.

### Frontend — 32,586 lines

Hybrid by design: a vanilla-JS shell mounting 15 React islands (see the
`alternatecrm` skill for the full map). Two findings:

- `services/api.js`: 795 lines, **29 `*Service` objects** in one file. Every
  island imports the whole thing.
- 4 components over 800 lines, led by `IntegrationsSection.jsx` at 1,339.
- Legacy views no user could reach: 3,621 lines deleted in v12.2.4; ~1,400
  remain behind two routes nothing links to (`alternatecrm` skill §3).

---

## 2. Clean architecture breakdown — applied to this product

Four rings, dependencies pointing inward only.

```
        ┌─────────────────────────────────────────────┐
        │  Transport      routes/ · webhooks · jobs   │  HTTP, JWT, JSON,
        │                 FastAPI, HTTPException      │  status codes
        ├─────────────────────────────────────────────┤
        │  Application    use cases — orchestrate one │  transactions,
        │                 business operation          │  side-effect order
        ├─────────────────────────────────────────────┤
        │  Domain         rules, policies, entities   │  no I/O, no framework
        ├─────────────────────────────────────────────┤
        │  Infrastructure repositories · providers    │  SQLAlchemy, Aircall,
        │                 (Aircall/Nylas/Salesforce)  │  Nylas, Salesforce, SF
        └─────────────────────────────────────────────┘
```

The ring that matters most here is **Domain**, because that is the one this
codebase has no equivalent of, and its absence is what lets a rule exist in
two places.

The ring to be *pragmatic* about is **Application**. A pure use-case-object
layer over 313 handlers is a lot of ceremony for a team this size. The rule
that pays for itself: **a handler may contain orchestration, but never a
business rule and never a raw query.**

### Provider abstractions already earn their keep — keep them

`dialer_provider.py` / `messaging_provider.py` with Aircall, Alternate Messenger and
Klenty implementations is textbook ports-and-adapters, and it is why
"calling on Aircall while messaging on Alternate Messenger" is a supported config
rather than a fork. **This is the pattern to copy, not to redesign.**

---

## 3. Target folder structure

```
backend/
├── main.py                          app assembly only
│
├── domain/                          ← NEW. No framework, no I/O.
│   ├── actor.py                     who is asking (role tiers, service accts)
│   ├── lead_access.py               which leads an actor may see
│   ├── policies/
│   │   ├── call_policy.py           active-call/EC-16 window, dedup identity
│   │   ├── email_policy.py          mailbox health, send eligibility
│   │   └── assignment_policy.py     round-robin, pod ownership
│   └── entities/                    status/outcome enums + transition rules
│
├── application/                     ← NEW. One module per business operation.
│   ├── leads/       assign.py  disqualify.py  import_batch.py  export.py
│   ├── calls/       start_call.py  log_outcome.py  heal_stale_call.py
│   ├── email/       send_one.py  dispatch_campaign.py  run_cadence_step.py
│   └── sync/        salesforce_push.py  salesforce_pull.py
│
├── infrastructure/                  ← NEW home for existing code
│   ├── db/
│   │   ├── models/                  models.py split by aggregate (see §4.3)
│   │   ├── session.py               was database.py
│   │   └── repositories/            leads.py  calls.py  users.py  email.py
│   ├── providers/                   dialer_*, messaging_*, aircall_*,
│   │   │                            messenger_*, klenty_* (moved as-is)
│   ├── external/                    salesforce.py  nylas_calendar.py
│   └── cache.py  crypto.py  sse_broker.py
│
├── transport/
│   ├── http/
│   │   ├── routes/                  thin handlers — validate, call, serialise
│   │   ├── dependencies.py          was auth.py's require_* guards
│   │   └── schemas/                 Pydantic request/response models
│   ├── webhooks/
│   └── jobs/                        was scheduled_jobs.py, one module per job
│
├── platform/                        config.py  logging  middleware/  migrations/
└── tests/
    ├── domain/          fast, no DB
    ├── application/     DB, no HTTP
    └── http/            full stack
```

**Frontend**, same principle — vertical slices, not technical kinds:

```
frontend-react/src/
├── features/<feature>/
│   ├── api.js          this feature's endpoints only (split from api.js's 29)
│   ├── hooks/          data fetching + local state
│   ├── components/     presentational, feature-owned
│   └── <Feature>Hub.jsx
├── shared/  components/ui/  hooks/  lib/
└── platform/  api-client.js (axios instance, interceptors, auth)  hub-entry.jsx
```

---

## 4. Migration sequence — behaviour-preserving, shippable in increments

> A big-bang restructure of 114 modules would rewrite the import path of all
> 45,459 lines of tests, destroying the safety net that makes the refactor
> possible at all, while delivering zero user value. **Strangler fig instead:**
> new code goes to the new address, old callers reach it through a delegating
> shim, and the shim is deleted when its last caller moves.
>
> Every phase below ends with the full suite green and is independently
> shippable.

### Phase 0 — free wins (no architecture change)

- ~~Delete the unreachable frontend views.~~ **Done in v12.2.4** — 3,621
  lines across six files, verified by import graph plus a per-symbol
  call-site check. `#kanban` and `#smart-analytics` (~1,400 lines) are left:
  both still answer a typed hash, so removing them is a product call rather
  than a cleanup. See the `alternatecrm` skill §3.
- Hoist the 312 non-cyclic function-local imports to module scope. Mechanical,
  and it makes the dependency graph visible to tooling for the first time.
- Break the one real cycle (`dialer_service ⇄ salesforce`) by extracting the
  shared piece rather than deferring the import.

### Phase 1 — `domain/` and the authorisation rule ✅ **reference slice built**

Highest value because it is the most security-sensitive duplication.
Implemented in this pass — see §5.

### Phase 2 — repositories, one aggregate at a time

Start with `LeadRepository`, absorbing the 563 route-level `db.query` calls
for leads. Route → repository, one file per commit. Handlers keep their
signatures; only their bodies shrink.

### Phase 3 — application services for the multi-step operations

Not all 313 handlers — only the 16 handlers over 100 lines and the operations
with more than one caller. `upload_enriched_sheet` (427 ln) and
`log_call` (348 ln) first. `_dispatch_campaign` already has two callers (a
request path and the scheduled job) and already drifted once (§0) — it is a
use case wearing a helper's clothes.

### Phase 4 — split `models.py` by aggregate

47 classes / 65 importers. Split into `models/lead.py`, `models/call.py`,
`models/email.py`, `models/user.py`, `models/settings.py`, with
`models/__init__.py` re-exporting everything so all 65 importers keep working
unchanged. Zero-risk, and it is what makes Phase 2's repositories reviewable.

### Phase 5 — transport reshuffle

Move `routes/`, `middleware/`, `scheduled_jobs.py` under `transport/`. Last
because it is the largest diff and the least behavioural value — pure
addressing.

### Frontend, in parallel

1. Split `api.js`'s 29 services into `features/<feature>/api.js`; keep
   `services/api.js` re-exporting until the last import moves.
2. Break the four 800+ line components along their own tab boundaries.
3. Finish the React migration per the `alternatecrm` skill §4 — flipping
   `leadsHub` / `leadDetailHub` to on by default is the highest-traffic win.

---

## 5. Phase 1 as built — the reference implementation

Three files added, two edited, behaviour unchanged.

### `domain/actor.py` — the boundary type

The rule used to take `get_current_user`'s raw JWT claims dict, which made
every authorisation rule an HTTP concern. Two concrete costs:

- `public_api_routes.py` fabricated
  `_FULL_ACCESS_USER = {"role": "Super Admin", "sub": "public-api-key"}`
  to call a domain rule. **A synthetic Super Admin sitting in module scope is
  a liability**, and it existed only because the rule demanded a token shape.
- Role decisions spread as bare string comparisons — 27 across 12 files, each
  an independent chance to write `== "Pod Admin"` where the rule needed
  `in ("Super Admin", "Pod Admin")`. That is precisely the v12.2.1 bug shape.

`Actor` is a frozen dataclass with `from_claims()` (HTTP) and `service()`
(API keys, jobs), normalising the legacy `"Admin"` spelling once, and
exposing `is_super_admin` / `is_pod_admin` / `is_admin` /
`is_individual_contributor` so there is **one place to be wrong instead of
27**. Frozen matters: a rule cannot widen its own caller's scope.

### `domain/lead_access.py` — the rule, moved not rewritten

`visible_leads(db, actor, global_view=False)`. The query is unchanged
line-for-line, including both Pod Admin branches and the
`Lead.id == None` fail-closed path. Only its address and input type changed.

It had been at **line 813 of `routes/lead_helpers.py`**, a 1,023-line
transport-layer file of serialisation, batching, formatting and caching
helpers — and every list, count, export, analytics aggregate and CSV download
in the product is only correct because it starts there.

### `routes/lead_helpers._build_lead_query` — a 6-line delegating shim

All 313 handlers and every existing test keep working untouched. The shim is
the strangler-fig seam: it is deleted when its last caller has moved.

### `routes/public_api_routes.py` — the payoff, made concrete

```python
- _FULL_ACCESS_USER = {"role": "Super Admin", "sub": "public-api-key"}
- base = _build_lead_query(db, _FULL_ACCESS_USER, global_view=True)
+ _API_KEY_ACTOR = Actor.service("public-api-key")
+ base = visible_leads(db, _API_KEY_ACTOR, global_view=True)
```

Same reach, but audit trails can now distinguish a service token from a human
Super Admin, and the domain rule no longer needs a JWT-shaped input to be
callable.

### `tests/test_domain_lead_access.py` — 13 cases

The existing 2,790 tests are the behaviour-preservation net. These add what
that net never had: direct, transport-free coverage of each role's scope,
including the two that only matter when something has already gone wrong —

- a Pod Admin with no `pod_id` sees **nothing**, not everything (failing open
  would hand one pod's admin the entire lead database);
- an unknown role falls through to assignment scoping, not open access.

---

## 6. Why this is an improvement — concretely, not by adjective

| Change | What it prevents |
|---|---|
| One home per rule | The v12.2.2 incident shape: two copies of a write, one fixed |
| `Actor` over a claims dict | Non-HTTP callers inventing fake identities to reuse a rule |
| Role predicates over string compares | The v12.2.1 privilege-escalation shape, in 27 places |
| Domain has no framework import | Rules become testable in 0.28 s without a DB or a request |
| Repositories | Handlers become reusable by jobs and webhooks, so they stop being re-implemented |
| Vertical frontend slices | A feature's blast radius stops being "every bundle" |
| `models.py` split by aggregate | A model change stops touching 65 modules |

**What is deliberately *not* changed:** the provider abstractions (already
correct), the test layout (it is the asset), the hybrid island frontend
(a full SPA rewrite is a different project with different risk), and product
behaviour anywhere.

---

## 7. Re-measure before trusting this

```bash
# route-layer DB coupling
grep -rc "db\.query(" backend/routes/*.py | sort -t: -k2 -rn | head
# authorisation spread
grep -rhoE "role\"?\]? *(==|!=|in) *[\(\[]?[\"'](Super Admin|Pod Admin|SDR|AE)" backend/routes/*.py | wc -l
# handlers over 100 lines, cycles, fan-in, local imports
#   → the python one-liners used to produce §1 are in this doc's git history
# frontend reachability + island map
#   → .claude/skills/alternatecrm/SKILL.md §2-3
```

Per `docs/AGENT_PROTOCOL.md` Rule 20, structural changes update the
`alternatecrm` skill. Update this file too when a phase lands, and strike it
from §4.
