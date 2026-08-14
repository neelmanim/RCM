# RCM CRM — Architecture Document
> **Version:** v8.4.0 (current production)
> **Original PDF:** `docs/archive/RCM_CRM_Architecture.pdf` (created 2026-04-17, snapshot of ~v5.6.x era)
> **This document:** Updated 2026-06-01 — covers all changes from v5.6.x → v8.4.0
> **Maintained by:** Neelmani + AI Pair Programming

---

## 1. Overview

RCM is a **full-stack CRM platform** for SDR (Sales Development Representative) teams. It manages the complete lead lifecycle — from Salesforce sync through research, calling, and meeting booking — with deep integrations into the sales tech stack.

**Core philosophy:**
- Backend serves JSON API only (no HTML)
- Frontend is a Vanilla JS SPA (Single Page Application)
- All environments are fully decoupled
- Production safety first — always `develop → staging → main`

---

## 2. Technology Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| **Backend** | Python 3.9 / FastAPI | Uvicorn ASGI server |
| **Frontend** | Vanilla JS (ES Modules) + HTML/CSS | Legacy; React migration deprioritised |
| **Database (prod)** | PostgreSQL (Render managed) | `rcm-db-prod` |
| **Database (dev)** | SQLite (`backend/crm.db`) | Set via `DATABASE_URL` in `.env` |
| **Hosting** | Render (backend + frontend static site) | Auto-deploy on push |
| **Auth** | JWT + Google OAuth SSO | `auth.py` |
| **AI** | Groq (Llama 3.3 70B) | Research v2 / Pre-Call Intelligence |
| **Schema Migrations** | Custom `migrations.py` | Named tuples in `_applied_migrations` |

---

## 3. Environments

| Env | Branch | Backend URL | Frontend URL | Database |
|-----|--------|-------------|--------------|----------|
| **Develop** | `develop` | localhost only | https://rcm-frontend-develop.onrender.com | SQLite (local) |
| **Staging** | `staging` | https://rcm-crm-staging.onrender.com | https://rcm-frontend-staging.onrender.com | `rcm-db-staging` (PostgreSQL) |
| **Production** | `main` | https://api.alternatecrm.com | https://rcm.txtbox.in | `rcm-db-prod` (PostgreSQL) |

**Deploy flow (non-negotiable):**
```
develop → staging (verify health/deep) → main → production auto-deploy
```

---

## 4. Repository Structure

```
CRM Alternate/
├── backend/                          # FastAPI application
│   ├── main.py                       # App entry point, 36 routers registered
│   ├── auth.py                       # JWT auth, Google SSO, role guards
│   ├── models.py                     # SQLAlchemy models (~35KB, 35+ tables)
│   ├── migrations.py                 # Schema migrations (V1–V23+, named tuples)
│   ├── database.py                   # DB engine — NO SQLite fallback (intentional)
│   ├── dialer_service.py             # Dialer orchestration layer
│   ├── rcm_provider.py        # RCM Contact Center (WebRTC/LiveKit)
│   ├── aircall_provider.py           # Aircall dialer integration
│   ├── phone_utils.py                # Shared phone validation (v7.2.0+)
│   ├── salesforce.py                 # SF sync (push/pull/SDRs)
│   ├── scheduled_jobs.py             # Background cron jobs (nightly sync, etc.)
│   ├── sse_broker.py                 # [v8.4.0] SSE fan-out broker (in-memory)
│   ├── error_reporter.py             # Frontend error ingestion
│   └── routes/
│       ├── admin_routes.py           # Thin shim → admin sub-routers
│       ├── admin_user_routes.py      # User mgmt
│       ├── admin_assignment_routes.py
│       ├── admin_upload_routes.py
│       ├── analytics_routes.py       # Analytics hub (funnel, trend, SDR table)
│       ├── auth_routes.py            # Login, OAuth callback, health, heartbeat
│       ├── lead_routes.py            # Lead CRUD, kanban, dashboard
│       ├── lead_helpers.py           # Shared lead query helpers
│       ├── leaderboard_routes.py
│       ├── metrics_routes.py         # SDR metrics (legacy, redirected to analytics)
│       ├── note_routes.py
│       ├── task_routes.py            # Tasks + notifications (503 guard v8.3.1)
│       ├── email_routes.py           # Nylas email integration
│       ├── sf_connection_routes.py
│       ├── sf_log_routes.py
│       ├── public_api_routes.py      # CMT↔SF bridge (X-API-Key auth)
│       ├── dialer_routes.py          # Dialer endpoints (Aircall + RCM + Playground)
│       ├── attachment_routes.py
│       ├── call_routes.py            # Call logs, today-calls, call monitor
│       ├── call_monitor_routes.py    # Admin call monitor (v7.1.0+)
│       ├── search_routes.py          # 9-path global search
│       ├── activity_feed_routes.py   # Unified activity feed (v6.x+)
│       ├── sms_routes.py             # RCM SMS/WhatsApp (v5.x+)
│       ├── conversations_routes.py   # Native Converse Desk (v5.x+)
│       ├── monitoring_routes.py      # Authenticated deep health endpoint
│       ├── integration_health_routes.py  # Dialer + Chat health diagnostics
│       ├── growth_intelligence_routes.py # AI research (v8.0.0+)
│       └── sse_routes.py             # [v8.4.0] GET /api/calls/events (SSE stream)
│   └── tests/                        # 1,434 tests (pytest)
│
├── frontend/                         # Vanilla JS SPA
│   ├── index.html                    # App shell, sidebar nav
│   ├── login.html                    # Login page
│   ├── config.js                     # API_BASE injected at build time
│   ├── css/
│   │   ├── style.css                 # Main stylesheet
│   │   └── rcm_widget.css     # RCM widget (light theme v8.4.0)
│   └── js/
│       ├── app.js                    # Router, nav, dialer init, global handlers
│       ├── api.js                    # All API call wrappers
│       ├── auth.js                   # JWT parsing, role derivation
│       ├── error_reporter.js         # Frontend error boundary
│       ├── phone_timezone.js         # TZ display for manual dial
│       ├── rcm_widget.js      # RCM floating widget (UMD global)
│       ├── dialer_machine.js         # [v8.4.0] Call state machine (XState-style)
│       ├── rcm_dialer_element.js  # [v8.4.0] <rcm-dialer> Web Component
│       └── views/
│           ├── dashboard.js          # SDR dashboard
│           ├── leads.js              # Lead list + kanban + lead detail
│           ├── lead_detail.js        # Lead detail page
│           ├── admin.js              # Admin panel
│           ├── analytics.js          # Analytics Hub (v6.6.0+)
│           ├── assignments.js        # Lead assignments
│           ├── call_monitor.js       # [v7.1.0] Admin call monitor
│           ├── my_calls.js           # [v7.0.0] SDR Today's Calls
│           ├── dialer_widget.js      # RCM call overlay (SSE-driven v8.4.0)
│           ├── activity_feed.js      # Unified activity feed
│           ├── digest.js             # Daily Digest (Super Admin)
│           ├── leaderboard.js
│           ├── metrics.js
│           ├── modals.js             # Call outcome modal
│           ├── settings.js           # Settings page (HTML)
│           ├── settings_ai_dialer.js # AI Dialer settings JS
│           ├── sf_logs.js
│           ├── sdr_performance.js
│           ├── sdr_settings.js       # SDR My Settings
│           ├── task_notifications.js # Bell icon, task reminders (60s poll v8.3.1)
│           ├── upload.js             # Upload Center
│           ├── user_guide.js         # In-app Help + What's New release notes
│           └── playground.js         # [v8.4.0, HIDDEN] Admin onboarding wizard
│
├── docs/
│   ├── AGENT_PROTOCOL.md             # Single source of truth for all AI agents
│   ├── RELEASES.md                   # Full changelog (v5.6.x → v8.4.0, 63 releases)
│   ├── PROJECT_JOURNAL.md            # Architecture + priorities + carry-forward
│   ├── WORKFLOW.md                   # Active work modes
│   ├── backlog.md                    # Backlog items (Playground, notifications, etc.)
│   ├── user-guide.md                 # Non-technical SDR/Admin guide
│   ├── Public_API.md                 # CMT↔SF bridge API docs
│   ├── daily_logs/                   # Per-day session logs (close_day.sh)
│   └── archive/
│       └── RCM_CRM_Architecture.pdf  # Original PDF (2026-04-17, v5.6.x era)
│
└── scripts/
    ├── start_day.sh                  # Morning context loader
    ├── close_day.sh                  # Evening context capture
    ├── pre-deploy-check.sh           # Pre-merge checklist automation
    ├── render_env_manager.py         # SAFE Render env var manager (GET→merge→PUT)
    ├── setup_uptimerobot.py          # UptimeRobot monitor provisioning
    └── .prod.env                     # Full prod env var snapshot (gitignored)
```

---

## 5. Integrations

| Integration | Purpose | Status | Notes |
|-------------|---------|--------|-------|
| **Salesforce** | Two-way lead sync, SDR metrics push, SF Description enrichment | ✅ Production | Push/pull + SF log dashboard |
| **Aircall** | Click-to-call, recording, transcript | ✅ Production | Dial → Aircall app; outcome modal auto-opens |
| **RCM** | WebRTC browser calling + WhatsApp/SMS messaging (multi-SDR sub-agents) | ✅ Production | LiveKit-based; per-SDR sub-agent config |
| **Nylas** | Email send/receive, open tracking | ✅ Production | |
| **Groq (Llama 3.3 70B)** | AI research (Pre-Call Intelligence v2) | ✅ Production | Heat score, opening line, pitch angle |
| **Google OAuth** | SSO authentication | ✅ Production | `FRONTEND_URL` redirect |
| **CMT Public API** | CMT↔SF bridge for Contract Management Tool | ✅ Production | `X-API-Key` auth, no SF credentials shared |
| **UptimeRobot** | 6-tier production monitoring | ✅ Production | 5-min intervals, 6 monitors |

---

## 6. Authentication & Roles

**JWT-based auth** with Google OAuth SSO fallback.

| Role | Access |
|------|--------|
| `Super Admin` | Full access — settings, SF sync, bulk import, analytics, audit logs, digest |
| `Pod Admin` | Pod-scoped admin — assignments, leaderboard, SDR metrics, call monitor |
| `SDR` | Lead pipeline, calling, research, today's calls, my settings |

**Key rule:** JWT `dialerEnabled` claim is stale at login. All dialer calls resolve the live DB `dialer_enabled` via `get_provider_for_user()` on every request.

---

## 7. Dialer Architecture

This is the most complex subsystem. Two providers share a unified orchestration layer.

### 7.1 Dual-Provider Orchestration

```
                    ┌─────────────────────┐
   SDR clicks Call  │   dialer_service.py  │
   ─────────────►  │   initiate_call()    │
                    │                     │
                    │  get_provider_for_user()
                    │  → reads DB dialer_enabled
                    │  → resolves: Aircall | RCM | none
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                  ▼
   ┌─────────────────────┐          ┌─────────────────────────┐
   │  aircall_provider.py │          │  rcm_provider.py  │
   │  POST /calls/dial    │          │  POST /calls/start       │
   │  Aircall Desktop app │          │  LiveKit WebRTC session  │
   └──────────┬──────────┘          └───────────┬─────────────┘
              │                                  │
              ▼                                  ▼
   Outcome modal auto-opens        Floating dialer widget overlay
   (provider_call_id polling)      (SSE-driven v8.4.0)
```

### 7.2 RCM Call Widget — Phase Evolution

| Phase | Version | What changed |
|-------|---------|-------------|
| Phase 1 | v5.4.0 | Initial WebRTC integration (LiveKit), floating draggable widget, dual-dialer architecture |
| Phase 2 | v5.8.x | Per-SDR sub-agent configuration (`rcm_user_id`, `rcm_from_number`, `rcm_email`) |
| Phase 3 | v6.x | Guard system: `ended_at` override guard, 50s server-side zombie timeout, 45s client-side timeout |
| Phase 4 | v8.4.0 | State machine (`dialer_machine.js`), SSE real-time events (`sse_broker.py`), concurrent call guard, webhook idempotency, light theme |

### 7.3 SSE Real-Time Call Events (v8.4.0)

Replaced 2-second polling with Server-Sent Events:

```
Browser (dialer_widget.js)
  │  EventSource → GET /api/calls/events?token=<jwt>
  │
  ▼
sse_routes.py
  └─ _get_sse_user()  ← JWT via query param (EventSource can't set headers)
  └─ Streams: CALL_STARTED / CALL_STATUS / CALL_ENDED / KEEPALIVE (25s)

sse_broker.py
  └─ In-memory asyncio.Queue per user_id
  └─ publish(user_id, event) ← called from dialer_routes.py webhook handler

Fallback: _machine.startPolling(_pollStatus) if SSE fails
```

### 7.4 RCM Sub-Agent System

Each SDR maps to a unique RCM sub-agent:

| Field | Purpose |
|-------|---------|
| `rcm_user_id` | RCM internal sub-agent ID (integer). Required for outbound. |
| `rcm_from_number` | Outbound caller ID. Normalised to `00<cc><num>` at call time. |
| `rcm_email` | RCM login email for the sub-agent. |

Number normalisation (`_to_rcm_number`):
- `+919240915643` → `00919240915643` (E.164)
- `9240915643` → `00919240915643` (bare 10-digit, assumes India cc=91)

### 7.5 Phone Validation (v7.2.0)

Shared `phone_utils.py` module — same logic for Aircall and RCM:
- Extension stripping (`ext 288` → stripped)
- Invalid number blocking (Indian 1860/1800, bad area codes, too short/long)
- Dot/space normalisation
- All errors surface as user-friendly messages (not raw error codes)

---

## 8. AI Research — Pre-Call Intelligence (v8.0.0)

Replaces the v1 flat research card with a structured intelligence report per lead.

**Trigger:** Auto-runs when SDR opens a lead detail page. Cached per company.

**Output fields:**
- `heat_score` — 🔥 Hot / 🟡 Warm / 🔵 Cool
- `opening_line` — Personalised first sentence for the call
- `persona_signal` — Contact's likely pain point / motivation
- `company_description` — Refined from public data
- `pain_points` — Array of pain points
- `pitch_angle` — Recommended approach
- `hypothesis` — SDR's call hypothesis

**Groq model:** Llama 3.3 70B (free tier, ~1 call/sec)

**Bulk Research (v8.1.0):** Admin can upgrade all v1 leads to v2 format via:
- `POST /api/admin/bulk-research/start` — launches background thread
- `GET /api/admin/bulk-research/status` — live progress
- Pod selector to run in phases (avoid overloading Groq)
- Chunked 100 leads at a time (was OOM-crashing on 11K leads)

---

## 9. Analytics Architecture (v6.6.0+)

The analytics refactor was the biggest data fix in the project's history.

**Root cause discovered (v6.6.0):** Analytics only queried `call_logs` table (India manual: ~19 calls). US Team (Aircall) calls live in `dialer_calls`. Funnel showed 19 calls_made — actual was ~10,315.

**Dual-query pattern (current):**
```python
# get_funnel() — analytics_routes.py
dialer_calls_q  = db.query(DialerCall).filter(...)   # Aircall + RCM outbound
call_logs_q     = db.query(CallLog).filter(...)        # Manual logs
overlap_count   = 1  # org-wide dedup (intentional, documented in comment)
calls_total     = dialer_total + manual_total - overlap_count
```

**Analytics endpoints:**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/admin/analytics/funnel` | Pipeline funnel — dual-query |
| `GET /api/admin/analytics/trend` | Daily trend — UNION call rows, period-key merge |
| `GET /api/admin/analytics/sdr-table` | Per-SDR metrics table |

---

## 10. Call Monitor (v7.1.0)

Admin-only view at `📞 Call Monitor` in sidebar.

- Real-time view of all dialer activity (Aircall + RCM + Manual)
- Filters: SDR, Provider, Direction, Outcome, Date Range, Has Recording
- Auto-refresh every 60s + manual refresh
- Pod Admin scoping: only sees calls from own pod SDRs
- Inline audio playback + transcript preview
- `GET /api/admin/call-monitor` backend endpoint

---

## 11. Scheduling & Background Jobs

`backend/scheduled_jobs.py` runs via APScheduler on startup:

| Job | Schedule | Purpose |
|-----|----------|---------|
| Salesforce sync | Configurable (admin setting) | Pull new leads, push status changes |
| RCM nightly sync | Nightly | Recover missed RCM calls (fixed v8.3.2 — was silently failing) |
| Lead recycling | Daily | Recycle terminal leads after cooldown period |
| Scheduled notifications | Per-task due date | Task reminders |

**Critical:** All startup work runs in daemon threads — never blocks port binding. Each job checks `_applied_migrations` flag before running (Rule 4).

---

## 12. Database Schema — Key Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `leads` | Core lead data | `status`, `pod_id`, `assigned_to`, `sf_lead_id` |
| `users` | SDR/Admin accounts | `role`, `dialer_enabled`, `rcm_user_id`, `rcm_from_number` |
| `dialer_calls` | Aircall + RCM calls | `status`, `user_id`, `lead_id`, `started_at`, `ended_at`, `duration` |
| `call_logs` | Manual call logs | `outcome`, `notes`, `lead_id` |
| `tasks` | SDR tasks + reminders | `due_at`, `completed`, `notify_before_minutes` |
| `notes` | Lead notes | `body`, `author_id`, `lead_id` |
| `sf_logs` | Salesforce sync audit | `operation`, `status`, `error` |
| `api_error_logs` | Frontend error ingestion | `endpoint`, `severity`, `message` |
| `settings` | Global config | `dialer_provider`, `rcm_*`, `aircall_*` |
| `lead_upload_logs` | Upload Center audit | `filename`, `lead_count`, `tag` |

**Critical rules:**
- `DATABASE_URL` must be explicit — no SQLite fallback in prod (Rule 9)
- All DDL migrations use `lock_timeout` guards (Rule 12)
- `db.add(upload_log)` + `db.commit()` in one atomic transaction (Rule 11)

---

## 13. Monitoring (Production)

**6-tier UptimeRobot strategy (5-min intervals):**

| Tier | Monitor | Type |
|------|---------|------|
| T1 | Frontend `rcm.txtbox.in` | HTTP 200 |
| T1 | `GET /api/health` | Keyword: `ok` |
| T2 | `GET /api/health/deep` | Keyword: `true` (DB tables accessible) |
| T3 | `GET /api/config` | HTTP 200 (post-startup only) |
| T4 | `GET /api/auth/login` | HTTP |
| T5 | `GET /api/public/health` | Keyword: `ok` |
| T6 | `GET /api/monitoring/health?key=<key>` | Keyword: `"status":"ok"` — full stack |

**Key startup log checks (post-deploy):**
- `[Startup] DB type: postgresql` (not sqlite)
- `[Startup] DB sanity: N leads` where N > 0
- `[Startup] Background tasks complete`

---

## 14. Test Coverage

| Suite | Count | Framework | Notes |
|-------|-------|-----------|-------|
| Backend unit/integration | 1,434+ | pytest | Run: `JWT_SECRET=test_secret pytest backend/tests/ -x -q` |
| Frontend unit | 146+ | Vitest | |
| E2E (Playwright) | 148+ | Playwright | Legacy specs — deprioritised |

**Known pre-existing failures (non-blocking, fixture isolation):**
- `test_call_routes.py` × 7 — pass in isolation, fail in full suite (DB ordering)
- `test_stability_ux_fixes.py` × 4 — rollback test expectations outdated

---

## 15. Release History Summary (v5.6.x → v8.4.0)

63 releases from April–June 2026. Grouped by era:

### Era 1: Dialer Foundation (v5.6.x–v5.8.x, May 2026)
- v5.6.x: RCM Contact Center WebRTC integration (LiveKit), dual-dialer architecture
- v5.7.x: Test coverage hardening, SF `last_name` NOT NULL bug, analytics cache-key fix
- v5.8.x: Per-SDR RCM sub-agent configuration, Agent Assignments UI

### Era 2: Calling Overhaul (v6.0.0–v6.9.0, May 20–25)
- v6.0.0: 13 bug fixes + 3 enhancements — drag fix, manual dial, TZ badges, Call Logs tab
- v6.1.x–v6.4.x: RCM ad-hoc dial, full-name search (9-path), widget hardening, poll null guard
- v6.5.x: Guard system — zombie call prevention (50s server timeout, 45s client timeout)
- v6.6.x: **Analytics overhaul** — dual-query (dialer_calls + call_logs), 5,144 DB orphan repair, 15,371 calls_total restored
- v6.7.x–v6.9.x: Cross-page lead traversal, Today's Calls nav, P1 IntegrityError hotfix, RCM data integrity

### Era 3: Logging & Visibility (v7.0.0–v7.2.0, May 26–27)
- v7.0.0: Dialer errors in System Logs, Call Logs tab (Provider/Direction filters), Leads table polish
- v7.1.0: **Call Monitor** — admin real-time view, 44 new tests, pod-scoped
- v7.2.0: **Shared phone validation** — extension stripping, 91 new tests, consistent Aircall+RCM behaviour

### Era 4: AI + Research (v8.0.0–v8.2.0, May 27–28)
- v8.0.0: **Pre-Call Intelligence (Research v2)** — heat score, opening line, persona signal; Lead→Calling auto-move; dial spam prevention; AI cache fix
- v8.1.0: Bulk Research 5-bug fix — was silently doing nothing; now 7× faster; chunked 100 leads
- v8.2.0: Call recording SDR listen (Today's Calls), audio seek bar fix, Refresh link button

### Era 5: Hardening (v8.3.x, May 29)
- v8.3.1: DB timeout → 503 (not 500), task poll 60s (was 30s), Aircall 405 severity → warning
- v8.3.2: RCM nightly sync `ImportError` fixed — was silently not running every night

### Era 6: SDK Phase 4 (v8.4.0, June 1)
- **Dialer Playground** (Admin only, hidden pending UX review — backlogged)
- **SSE real-time call events** — replaces 2s polling; `sse_broker.py` + `sse_routes.py`
- **DialerMachine state machine** — owns call state, timer, polling lifecycle
- **RCMDialerElement** — Web Component shell for `<rcm-dialer>`
- **Concurrent call guard** — blocks double-calls at service layer
- **Webhook idempotency** — `ended_at`/`duration` never overwritten on retry
- **Light theme widget**

---

## 16. Open Items & Backlog

### 🔴 High Priority
- [ ] **Fix ad-hoc dial UX** — RCM widget shows "Ready to call" while dialer overlay renders separately. Proposed fix: render active call state INSIDE RCM widget when `isActive()` is true.

### 🟡 Medium Priority
- [ ] **Dialer Playground** — Code complete (v8.4.0), hidden pending UX review. Re-enable: 3 uncomments in `app.js`. See `docs/backlog.md`.
- [ ] **Staging OAuth callback** — Staging env needs Google OAuth redirect registered
- [ ] **Enriched SF Description** — Deployed to staging, verify in next push cycle

### 🟢 Backlog
- [ ] Browser notifications for lead assignment (bell icon, 30s poll)
- [ ] SDR settings "Load My Numbers" helper (calls `/dialer/my-numbers`)
- [ ] Google Drive lead ingestion
- [ ] Lead attachments system
- [ ] Aircall historical sync resilience (rate limiting)

---

## 17. Key Files Quick Reference

| File | What it does |
|------|-------------|
| `backend/main.py` | Registers all 36 routers |
| `backend/dialer_service.py` | Dialer orchestration — `initiate_call()`, `handle_webhook()`, concurrent call guard |
| `backend/sse_broker.py` | In-memory asyncio queue per user for SSE fan-out |
| `backend/routes/sse_routes.py` | `GET /api/calls/events` — SSE stream endpoint |
| `backend/routes/analytics_routes.py` | `get_funnel()` dual-query, `get_trend()` UNION pattern |
| `backend/routes/dialer_routes.py` | All dialer endpoints including Playground (admin-gated) |
| `backend/scripts/render_env_manager.py` | **ONLY safe way to update Render env vars** |
| `frontend/js/app.js` | Router, nav, dialer init — entry point |
| `frontend/js/rcm_widget.js` | RCM floating widget (UMD global) |
| `frontend/js/dialer_machine.js` | Call state machine (v8.4.0) |
| `frontend/js/views/dialer_widget.js` | RCM call overlay card (SSE-driven) |
| `docs/AGENT_PROTOCOL.md` | **Read this first every session** |
| `docs/RELEASES.md` | Full changelog — 63 releases |
| `scripts/pre-deploy-check.sh` | Run before every merge to `main` |

---

## 18. Critical Rules (from AGENT_PROTOCOL.md)

| Rule | Summary |
|------|---------|
| **Render Env Vars** | NEVER call Render API directly. Always use `render_env_manager.py` |
| **Branch Safety** | Never commit to `main` or `staging` directly. All work on `develop`. |
| **No SQLite Fallback** | `DATABASE_URL` must be explicit. No default fallback. If missing → app fails. |
| **No Split Commits** | `db.add(upload_log)` + `db.commit()` in one atomic transaction |
| **Staging Gate** | Always merge `develop → staging → main`. Never skip staging. |
| **Migration Safety** | Column migrations MUST `raise` on failure — never catch and log |
| **In-App Release Notes** | `user_guide.js` What's New MUST be updated on every release |

---

*This document supersedes the original `docs/archive/RCM_CRM_Architecture.pdf` (v5.6.x era, 2026-04-17). Update this file at the start of each major new era or significant architectural change.*
