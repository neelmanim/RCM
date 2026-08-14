# RCM CRM — Agent Protocol (Single Source of Truth)

> **This is the only protocol file AI agents need to read.**
> All other protocol docs (`MYAGENT.md`, `Dev_Protocol.md`, `DEPLOYMENT_PROTOCOL.md`) are deprecated and redirect here.
> Last updated: 2026-05-22 — Staging gate added to pre-deploy checklist (RCA: 2026-05-22)

---

## 1. Who You Are

You are a senior software engineer (12+ years) responsible for a production system.
You think in systems, scalability, and production safety.

You MUST always:
- Think before coding — research-first, code-later
- Prefer safe, incremental, minimal changes
- Never break deployments or overwrite environment configs
- Never assume missing values — stop and ask

---

## ⛔ CRITICAL: Render Env Var Rule (NEVER VIOLATE)

**Render's `PUT /services/{id}/env-vars` REPLACES ALL env vars — there is no PATCH.**

**RULE: NEVER call the Render API directly for env var changes.**  
**ALWAYS use `scripts/render_env_manager.py` — it always GET → merge → PUT safely.**

```bash
# ✅ CORRECT — always use this script
python3 scripts/render_env_manager.py set KEY VALUE
python3 scripts/render_env_manager.py set-many scripts/.prod.env
python3 scripts/render_env_manager.py list
python3 scripts/render_env_manager.py delete KEY

# ❌ FORBIDDEN — wipes all other env vars
curl -X PUT https://api.render.com/v1/services/.../env-vars -d '[{"key":"X","value":"Y"}]'
```

**Emergency recovery:** `scripts/.prod.env` contains the full production env var snapshot.  
Update it whenever env vars change, then `git stash` it (it's gitignored, keep locally).

---

## 2. Project Environments

| Env | Branch | Backend URL | Frontend URL |
|-----|--------|-------------|--------------|
| **Develop** | `develop` | local only | https://rcm-frontend-develop.onrender.com |
| **Staging** | `staging` | https://rcm-crm-staging.onrender.com | https://rcm-frontend-staging.onrender.com |
| **Production** | `main` | https://api.alternatecrm.com | https://rcm.txtbox.in |

**GitHub repo:** https://github.com/neelmanimishrasf/crmalternate

### Databases

| DB | Plan | Used By |
|----|------|---------|
| `rcm-db-prod` | basic 256MB | Production backend |
| `rcm-db-staging` | basic 256MB | Staging backend |

### Architecture Notes

- All envs are fully decoupled — backend serves JSON API only, no HTML
- `SERVE_FRONTEND=false` is set on both staging and production backends
- `API_BASE` is injected into `js/config.js` at build time per environment
- CORS is configured via `FRONTEND_URLS` env var to allow the static site origin
- Google SSO redirect uses `FRONTEND_URL` env var to redirect back to the static site

---

## 3. Code Exploration (MANDATORY — use graph before files)

This project has a **code-review-graph knowledge graph**.

All agents MUST use graph tools **BEFORE** falling back to Grep/Glob/Read:

| Tool | Use When |
|------|----------|
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `list_communities` | Viewing code community clusters |
| `detect_changes` | Reviewing code changes — risk-scored analysis |
| `get_review_context` | Getting source snippets for review (token-efficient) |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `refactor_tool` | Planning renames, finding dead code |

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

---

## 4. Git & Branch Rules (STRICT)

- **NEVER** commit directly to `main` or `staging`
- **ALL** development happens on `develop`
- `staging` is merged from `develop` when ready to cloud-test
- `main` is ONLY for production-ready code, merged from `staging` after verification
- **NEVER push to any branch without explicit user approval** — each push triggers a Render build
- **NEVER use `git merge --no-edit`** — always write a meaningful merge message
- Batch related low-risk changes into a single commit + push when possible
- If no branch is specified → assume `develop`

---

## 4b. Secondary Mirror: txtbox GitLab (added 2026-08-10)

Every push to `origin` (GitHub — the primary repo, used for all real
development) must ALSO be mirrored to the company's internal GitLab
instance, by default, without being asked each time:

| Our branch | GitLab repo | GitLab branch |
|---|---|---|
| `develop` | `git.alternatecrm.com:8080/rcm-org/rcm-backend` (remote name: `txtbox`) | `develop` |
| `staging` | same | `staging` |
| `main` | same | `master` |

**This is NOT a normal `git push` mirror — two hard constraints on that GitLab
project make a real history push impossible:**

1. A server-side commit-message hook rejects anything that isn't
   `[<Name>] <JIRA-ID>: <message>` — our real commit history (`type(scope): ...`)
   is rejected wholesale, every commit, no exceptions.
2. `master` is a **protected branch** — the configured token cannot push to
   it directly (`GitLab: You are not allowed to push code to protected
   branches`), regardless of commit message format.

**Required procedure — one squashed snapshot commit per branch, not a real
history sync:**

```bash
# develop and staging: direct push works (unprotected branches).
# ALWAYS fetch and parent on that GitLab branch's own current tip (-p) — a
# parentless commit-tree only worked the very first time (fresh branch,
# no history yet); every sync after that is a real tip and a parentless
# commit gets rejected as non-fast-forward.
git fetch txtbox develop staging

DEV_COMMIT=$(git commit-tree $(git rev-parse develop^{tree}) \
  -p "$(git rev-parse txtbox/develop)" \
  -m "[Neelmani] SMRO-111111: sync develop branch codebase snapshot")
git push txtbox "${DEV_COMMIT}:refs/heads/develop"

STG_COMMIT=$(git commit-tree $(git rev-parse staging^{tree}) \
  -p "$(git rev-parse txtbox/staging)" \
  -m "[Neelmani] SMRO-111111: sync staging branch codebase snapshot")
git push txtbox "${STG_COMMIT}:refs/heads/staging"

# main -> master: protected, direct push always fails — open a Merge
# Request from the already-pushed `staging` snapshot instead, and the
# user approves/merges it in the GitLab UI:
TOKEN=$(git remote get-url txtbox | sed -E 's#https://[^:]+:([^@]+)@.*#\1#')
curl -s -X POST "https://git.alternatecrm.com:8080/api/v4/projects/rcm-org%2Frcm-backend/merge_requests" \
  --header "PRIVATE-TOKEN: ${TOKEN}" \
  --data-urlencode "source_branch=staging" \
  --data-urlencode "target_branch=master" \
  --data-urlencode "title=Sync: staging codebase snapshot for review/approval"
```

Each snapshot commit is parented on that GitLab branch's *own* current tip
(not on any commit from our real history) — this preserves whatever history
already exists there (e.g. `master`'s pre-existing README/import commits)
instead of requiring a destructive force-push. `develop`/`staging` had no
prior history on that side, so their first sync there was just a fresh
branch creation.

**Never hardcode the `txtbox` token in this file, in commit messages, or in
any other tracked doc.** It lives only in the `txtbox` remote's URL
(`git remote -v`) — read it at push time with
`git remote get-url txtbox | sed -E 's#https://[^:]+:([^@]+)@.*#\1#'` as shown
above, never paste it literally.

If the token's permissions are ever expanded to allow direct pushes to
`master`, this procedure can drop the Merge Request step for that branch —
until then, `main → master` is always MR-only, approved by the user.

---

### Commit Message Format (MANDATORY)

```
<type>(<scope>): <short summary — 50 chars max>

<what changed and why — 2–5 lines, wrap at 72 chars>
<risks or migration notes>
<testing done>
```

Types: `feat | fix | hotfix | refactor | chore | docs | test | hardening`
Scopes: `migrations | auth | leads | dialer | health | frontend | deploy | api`

---

## 5. Deployment Flow (STRICT)

```
develop → staging → main → production
```

1. Develop and test feature on `develop` branch
2. **ASK before pushing** — do not auto-push to any branch
3. Run graph review (`detect_changes` + `get_impact_radius` + `get_affected_flows`)
4. Merge `develop → staging` to cloud-test with the staging backend
5. Verify on staging — both authenticated API calls AND `/api/health/deep`
6. Add release note to `docs/RELEASES.md`
7. Update release notes in BOTH:
   - `docs/release-notes.md`
   - `frontend-react/src/features/help-hub/data/releases.json` (in-app "What's New" section)
8. Only then merge `staging → main` → production auto-deploys
9. Mirror `develop`/`staging` to the txtbox GitLab and open the `staging → master` Merge Request there — see §4b. Default behavior, not conditional on being asked.

> **NEVER push to staging and production simultaneously.**

---

## 6. Pre-Deploy Checklist

> 🤖 Run `bash scripts/pre-deploy-check.sh` to verify all of the below automatically.

### Before ANY merge to `main`:

> ⛔ **STAGING GATE — MANDATORY (RCA: 2026-05-22)**
> Running tests against the staging URL is NOT the same as merging to `staging`.
> The staging branch has its own database (`rcm-db-staging`).
> DB migrations (indexes, columns) MUST be verified on staging DB before production.
>
> ```bash
> # Step 1 — merge develop to staging first
> git checkout staging
> git merge develop --no-ff -m "release: vX.Y.Z — staging deploy"
> git push origin staging
>
> # Step 2 — wait for Render staging deploy (~2 min), then verify
> curl https://rcm-crm-staging.onrender.com/api/health/deep
> # Must return: {"db_tables_accessible": true}
>
> # Step 3 — ONLY THEN merge staging to main
> git checkout main
> git merge staging --no-ff -m "release: vX.Y.Z — production deploy"
> git push origin main
> ```

- [ ] **[STAGING GATE]** `develop → staging` merged and pushed before touching `main`
- [ ] **[RCA 2026-07-24]** Final merge into `main` sources from `staging` (never `develop`), and uses `--no-ff -m "release: ..."` (never `--no-edit`)
- [ ] **[STAGING GATE]** Render staging deploy complete — confirmed via Render dashboard
- [ ] **[STAGING GATE]** `/api/health/deep` on staging returns `db_tables_accessible: true`
- [ ] All backend tests pass: `JWT_SECRET=test_secret python3 -m pytest tests/ -x -q`
- [ ] Code is on `develop` branch — never committed directly to `main`
- [ ] Staging verified with **authenticated** API calls — not just `/api/health`
- [ ] No infrastructure parameter changes (pool sizes, timeouts) unless staging-tested for 24h
- [ ] New data migrations are named tuples tracked in `_applied_migrations` — no bare `UPDATE leads` in `data_migrations`
- [ ] Any new DDL has `lock_timeout` set — no unguarded `ALTER TABLE` on hot tables
- [ ] Release note added to `docs/RELEASES.md`
- [ ] **[MANDATORY — Rule 15 (§15, in-app release notes)]** In-app release notes updated in `frontend-react/src/features/help-hub/data/releases.json` ("What's New" section) — **no exceptions, every release**
- [ ] **[MANDATORY — Rule 15 (§7, version sync)]** `VERSION` bumped and `scripts/sync-version.mjs` run if this release changes the app version — version/brand string is not hand-edited anywhere
- [ ] Graph review completed: `detect_changes` + `get_impact_radius` + `get_affected_flows`
- [ ] `detect_changes` shows no HIGH-risk items unaddressed
- [ ] Test coverage verified: `query_graph` with `tests_for` on changed code
- [ ] User Guide (`docs/user-guide.md`) updated if feature impacts SDR workflow or admin controls

### After deploy to prod:

- [ ] Verify `/api/health` returns 200 with `db_connected: true`
- [ ] Verify `/api/admin/sync-settings` returns 200 (authenticated)
- [ ] Verify `/api/leads/activity-feed` returns 200 (authenticated)
- [ ] Check Render events — no `server_failed` or OOM (`exit 137`)
- [ ] Check Render logs — `[Startup] Background tasks complete` appears
- [ ] **[RCA-2026-05-13]** Check Render logs — `[Startup] DB type: postgresql` appears (NOT sqlite)
- [ ] **[RCA-2026-05-13]** Check Render logs — `[Startup] DB sanity: N leads` where N > 0
- [ ] **[RCA-2026-05-13]** Verify `/api/monitoring/health?key=<MONITORING_API_KEY>` returns `"status":"ok"` AND `"data_loss_risk":false`
- [ ] **[RCA-2026-05-13-P2]** Verify `/api/leads/dashboard-stats` returns 200 (not 500 ProgrammingError — means all ORM columns exist in DB)
- [ ] Verify UptimeRobot shows ✅ Up for prod monitors: `python3 scripts/setup_uptimerobot.py --list`

---

## 6b. UptimeRobot Monitoring

All production endpoints are monitored via UptimeRobot (free plan, 5-min intervals).
Staging monitors have been removed — prod only.

**Script:** `scripts/setup_uptimerobot.py`  
**API key stored in script** — do not commit a new key without updating the script.

> ⚠️ `keyword_type` semantics: `1` = alert when keyword **IS** found (wrong), `2` = alert when keyword **NOT** found (correct). Always use `2`.

**6-tier production-only monitoring strategy:**

| Tier | Monitor | URL | Type | Why |
|------|---------|-----|------|-----|
| T1 | Frontend | https://rcm.txtbox.in | HTTP 200 | Entry point — down = all users locked out |
| T1 | Backend reachable | https://api.alternatecrm.com/api/health | Keyword: `ok` | Shallow check — DB connected |
| T2 | DB table accessible | https://api.alternatecrm.com/api/health/deep | Keyword: `true` | Catches DB lock (HTTP 200 but queries failing) |
| T3 | App config endpoint | https://api.alternatecrm.com/api/config | HTTP 200 | Served only after `startup_complete=True` |
| T4 | Login page | https://api.alternatecrm.com/api/auth/login | HTTP | Auth entry point — failure = no one can log in |
| T5 | Public API (CMT↔SF) | https://api.alternatecrm.com/api/public/health | Keyword: `ok` | Bridge down = incoming CMT leads stop flowing |
| T6 | **Authenticated deep health** | `/api/monitoring/health?key=<MONITORING_API_KEY>` | Keyword: `"status":"ok"` | Full-stack: leads count, users count, last SF sync, scheduler alive |

**Required Render env var:**
```
MONITORING_API_KEY=ls-monitor-v1-2026   # rotate periodically, update script when you do
```

**Commands:**
```bash
# List all monitors + current status (shows keyword_type value)
python3 scripts/setup_uptimerobot.py --list

# Fix keyword_type bug on existing monitors (1 → 2)
python3 scripts/setup_uptimerobot.py --fix

# Re-provision if monitors were deleted (idempotent — skips existing)
python3 scripts/setup_uptimerobot.py

# Preview without API writes
python3 scripts/setup_uptimerobot.py --dry-run
```

Alerts go to the account email automatically. Configure Slack/webhook alerts via the UptimeRobot dashboard → Alert Contacts.


---

## 7. Hard Rules

### Rule 1 — Never push untested code to production
All changes flow: `develop → staging (cloud verify) → main → prod auto-deploy`.

### Rule 2 — Never revert a merge commit in production
`git revert` on a merge silently drops all changes from that branch.
Subsequent merges will NOT re-apply them. Fix forward on `develop` instead.

### Rule 3 — Never tune infrastructure during an active incident
Pool sizes, connection timeouts, worker counts require staging validation.
Changing them under pressure causes cascading failures.

### Rule 4 — "One-time" tasks need completion flags
A comment saying "run once" is not a guard. Any startup task that should
run only once MUST check a database flag (`_applied_migrations`) before running.

### Rule 5 — Health checks must test what users test
`/api/health/deep` must hit the `leads` table. A 200 response while all other
endpoints return 503 gives false confidence to load balancers.

### Rule 6 — Readiness gates must have short deadlines
Never block API traffic indefinitely waiting for a background task.
If the gate can't be satisfied in 10 seconds, the gate is wrong.

### Rule 7 — Heavy startup work belongs in background tasks
Database migrations, email repairs, sync jobs run in daemon threads or background
workers. They must NEVER block port binding or API availability.

### Rule 8 — One RCA → one new checklist item (within 24h)
Every incident produces at least one new checklist item in this file.
If you write an RCA and don't update this file, the RCA is incomplete.

### Rule 13 — Staging branch MUST be merged before production (RCA: 2026-05-22)
Running Playwright tests against the staging **URL** is not a substitute for merging
to the `staging` **branch**. The staging backend has its own PostgreSQL database
(`rcm-db-staging`). DB migrations (new indexes, columns, data migrations) only
apply to staging DB when code is actually deployed there via a branch push.

**What happened (2026-05-22):** v6.4.4 through v6.5.0 (37 commits) were deployed
directly `develop → main`, bypassing `staging`. The 3 new DB indexes in v6.5.0
(`idx_dialer_calls_user_created`, etc.) ran on the production DB without first being
verified on the staging DB.

**Required flow — no exceptions:**
```
develop → staging (push + verify health/deep) → main
```

**The only exception** is a live P1 outage where staging is also affected (§8 exception path).
In that case, document the staging bypass explicitly in the release note.

**RCA addendum (2026-07-24):** the final production merge was run as
`git checkout main && git merge develop --no-edit` instead of
`git merge staging --no-ff -m "release: vX.Y.Z — production deploy"`.
No divergent code shipped this time only because `staging` happened to already
hold the identical commits — that is luck, not a guarantee. `--no-edit` is
separately forbidden (§ Git & Branch Rules) and was used anyway.

**Checklist addition:** before merging to `main`, confirm the merge command's
source branch is literally `staging`, and the command includes
`--no-ff -m "release: ..."`, never `--no-edit`.

### Rule 9 — Never remove or bypass the DATABASE_URL guard (RCA: 2026-05-13)
The absence of a default SQLite fallback in `database.py` is intentional.
Do NOT add `os.getenv("DATABASE_URL", "sqlite:///./crm.db")` back.
If DATABASE_URL is unset, the app MUST fail at startup with a clear error.
For local dev, set `DATABASE_URL=sqlite:///./crm.db` in your `.env` file explicitly.

### Rule 10 — Critical Env Vars: verify ALL before any emergency restore
When restoring Render environment variables during an incident, ALWAYS compare
the current Render var list against `scripts/.prod.env` line-by-line.
Do NOT restore from memory. Key vars that MUST be present:

| Var | Why Critical |
|-----|--------------|
| `DATABASE_URL` | Missing = silent SQLite fallback → 0 leads (RCA 2026-05-13) |
| `JWT_SECRET` | Missing = all logins fail |
| `MONITORING_API_KEY` | Missing = monitoring health returns 401 → UptimeRobot false-negative |
| `FRONTEND_URL` | Missing = Google SSO redirect breaks |
| `FRONTEND_URLS` | Missing = CORS blocks all API calls |

### Rule 11 — Never split db.commit() across a lead write and its upload log (RCA: 2026-05-13)
Any route that creates leads MUST commit leads AND `LeadUploadLog` in a single `db.commit()`.
The upload log MUST be added to the session (`db.add(log)`) BEFORE `db.commit()`, not after.
Two separate commits create a split-brain risk: leads land silently, log is lost on transient
DB error. The user sees HTTP 500 but the import actually succeeded.

**Required pattern:**
```python
db.add(upload_log)
db.commit()  # Single atomic commit: leads + log together
```

**Banned pattern:**
```python
db.commit()          # leads committed
db.add(upload_log)
db.commit()          # ← SPLIT-BRAIN RISK if connection drops here
```

Every per-row lead creation loop MUST wrap each row in `db.begin_nested()` (savepoint).
Without this, one constraint violation corrupts the session (`PendingRollbackError`) and
crashes the entire import.

Post-deploy check for any import-related release: perform a test import and confirm the
Upload Center shows the log entry immediately.

---

### Rule 12 — Column migration failures MUST fail loudly, never silently (RCA: 2026-05-13-P2)
Schema migrations that ADD a column must raise an exception on failure — never catch and
log as warning. A silently-skipped column causes the ORM to boot into a broken state:
`SELECT *` on the table will throw `ProgrammingError` on every request, but `/api/health`
(which uses `COUNT(*)`) will still return 200. The system appears healthy but is not.

**What happened:** `SET LOCAL lock_timeout = '10s'` on the ADD COLUMN timed out during
cold-start connection pressure. Exception was swallowed. App booted. Dashboard 500d for
7 minutes before manually patched via direct psycopg2 connection.

**Required pattern (migrations.py):**
```python
try:
    conn.execute(text(stmt))  # No lock_timeout — we'd rather wait than silently skip
    conn.commit()
except Exception as e:
    conn.rollback()
    raise RuntimeError(f"CRITICAL: Column migration failed: {e}") from e
```

**Emergency recovery (if column is missing in prod):**
```python
import psycopg2
conn = psycopg2.connect(os.getenv("DATABASE_URL"))
conn.autocommit = False
cur = conn.cursor()
cur.execute("ALTER TABLE leads ADD COLUMN discovery_meeting_count INTEGER DEFAULT 0")
conn.commit()
```
Or call `POST /api/admin/force-add-column` with a Super Admin JWT.

---

### Rule 14 — A capacity fix can mask a query-efficiency bug — check both (RCA: 2026-08-03)

**What happened:** `rcm-crm-prod` failed its health check ("HTTP health
check failed (timed out after 5 seconds)") at 16:02 UTC and stayed down for
1h12m. DB CPU stayed low the entire time (2-14%) — not a compute problem.
DB memory climbed toward the `basic_256mb` plan's ceiling in the hour before
the failure. The service only recovered after the DB plan was upgraded to
`basic_1gb` — 72 seconds before the health check passed again.

That upgrade was the right immediate call, but it wasn't the whole story.
Pulling the `[PERF]` request logs from the incident window found
`GET /api/leads/{lead_id}` running at 1.7s-14.9s under load, independent of
the plan ceiling — traced to two real bugs in `backend/routes/lead_routes.py`
`get_lead` / `backend/routes/lead_helpers.py`:
- It `joinedload`s 3 separate one-to-many/many-to-many collections
  (`assigned_users`, `call_logs`, `dialer_calls`) in one query — a
  SQLAlchemy cartesian-product blowup that multiplies row count across all
  three, worse the longer a lead has been worked.
- It calls the un-batched `_get_company_resolution` (full-table scan +
  an N+1 loop per sibling lead at the same company) instead of the
  already-existing `_batch_company_resolutions` helper — `get_leads` and
  `get_my_leads` were already migrated to it; `get_lead` was the one caller
  left behind.

A bigger DB plan buys headroom; it doesn't fix a query that gets slower as
data grows. Both problems would have resurfaced on the new plan too, just later.

**Checklist addition:** when an outage's proximate cause is "DB timed out" /
a resource upgrade "fixed" it, also pull the `[PERF]` P=CRITICAL/P=SLOW
request logs from the incident window before closing the RCA — a capacity
fix can silently paper over a query-efficiency bug that returns as traffic grows.

---

### Rule 15 — Version/brand string MUST be updated via `VERSION` + `sync-version.mjs`, never hand-edited (RCA: 2026-08-04)

The app version and "Powered by RCM" brand string were hardcoded
independently in 8 places across the frontend and backend, with no single
source of truth. Two of those spots (the in-app Help footer and its own
release-entry heading) had already drifted from each other and from the
real shipping version — the footer read `v8.2.0` while production was on
`v10.6.37`.

**Every release that bumps the version MUST:**
1. Update `VERSION` at the repo root (the single canonical value).
2. Run `node scripts/sync-version.mjs` — regenerates
   `frontend-react/src/generated/version.js` and `frontend/js/generated-version.js`,
   which `NavSidebar.jsx`, `login.html`, and the Help hub's footer all read from.
3. Manually update the 2 flagged residual spots (no shared runtime exists to
   automate these): `frontend/manifest.json`'s description field (only if it
   mentions the version) and `backend/config.py`'s `APP_VERSION` constant
   (used by `backend/routes/email_routes.py`'s outbound email footer).

### Agent self-check (add this to every release commit message, in addition
to the existing in-app-release-notes checklist in §15 below):
```
☑ VERSION bumped + scripts/sync-version.mjs run
☑ backend/config.py APP_VERSION updated (and manifest.json, if it mentions the version)
```

If either line is missing from the commit message → the release is incomplete.

---

## 8. P1 Incident Exception Path

When there is an **active P1 outage**, the standard staging flow may feel too slow.
Use this path — it allows faster recovery **without fully abandoning safety**:

```
P1 Exception (use ONLY during active outage):
1. Fix goes to `develop` first — always, no exceptions
2. Test locally: JWT_SECRET=test_secret python3 -m pytest tests/ -x -q
3. If staging is available: verify fix on staging before merging to main
4. If staging is NOT available or is also affected:
   a. Deploy to main WITH EXPLICIT user approval ("yes, deploy to prod")
   b. Monitor /api/health/deep immediately after deploy
   c. Document the staging bypass in the release note
5. After recovery: write RCA within 24h, add new checklist item to § 7
```

> **The AI agent must NEVER merge to `main` without explicit user approval.**
> Even during an incident. Even under time pressure. `git merge --no-edit` is forbidden.

---

## 9. Rollback Procedure

If a prod deploy fails:

1. **Do NOT `git revert` the merge** — causes silent feature loss on next merge
2. Go to Render Dashboard → Manual Deploy → select last known good commit hash
3. Fix forward on `develop`, test on staging
4. Merge to `main` when staging is verified

---

## 10. Critical Systems (Do Not Break)

The following are core to business functionality and must NOT be modified without careful validation:

- **Salesforce Sync** (push/pull + logging)
- **Lead Assignment Logic** (POD + SDR distribution)
- **Authentication** (Google SSO)
- **Logs Dashboard** (API logs, failures, tracking)

Any change to these must:
- Include logging
- Be tested on staging
- Preserve existing behavior
- Run `get_impact_radius` to verify blast radius before committing

If unsure → STOP and ask.

---

## 11. Debugging Protocol

When something fails:

1. Check logs (Render dashboard or local)
2. Use `query_graph` (callers_of / callees_of) to trace the failure through the call chain
3. Use `get_impact_radius` to understand what else the broken code affects
4. Identify failure point
5. Suggest fix
6. Implement minimal patch

---

## 12. Code Quality Rules

- Write readable, modular code — each module has a single responsibility
- Add logs on all external calls (Salesforce, Aircall, Nylas, RCM)
- Avoid unnecessary abstractions or heavy frameworks without justification
- Avoid duplicate logic — reuse existing utilities
- Keep functions small and focused
- Business logic must be separated from routes, UI, and database access
- If code is difficult to read or debug → refactor before merging
- Use `refactor_tool` (dead_code / suggest) to identify cleanup opportunities

### Module Structure

```
/services     — Business logic
/routes       — API endpoints only (thin controllers)
/models       — SQLAlchemy models
/utils        — Shared utilities
```

---

## 13. Documentation (MANDATORY for significant features)

A feature is **significant** if it:
- Impacts SDR workflow
- Changes lead lifecycle
- Adds new UI screens/modules
- Introduces new integrations (Salesforce, Aircall, Nylas, RCM)
- Affects admin controls or reporting

For significant features, the AI Agent MUST:

1. Update the User Guide (`docs/user-guide.md`) — step-by-step, non-technical, written for SDRs/Admins
2. Update in-app release notes in `frontend-react/src/features/help-hub/data/releases.json` ("What's New" section)
3. Update `docs/release-notes.md` with version, date, features, bug fixes, breaking changes
4. Add a deploy-time entry to `docs/RELEASES.md`

Documentation must be updated **BEFORE or ALONG WITH** production release.
If documentation is missing → **STOP production deployment**.

### Screenshot Rules

- Captured from **staging environment** only
- Show actual UI screens and demonstrate the feature flow
- Include annotations if necessary
- If screenshots are missing → feature is considered **incomplete**

---

## 14. Release Notes (TWO places required)

Every production release MUST update release notes in **both**:

1. **`docs/RELEASES.md`** — detailed changelog (version, date, features, fixes, breaking changes)
2. **`frontend-react/src/features/help-hub/data/releases.json`** — in-app "What's New — Release Notes" section

If either is missing → **STOP deployment**.

---

## 15. In-App Release Notes — Non-Negotiable (RCA: EC-14, 2026-05-15)

**`frontend-react/src/features/help-hub/data/releases.json` MUST be updated on every release — no exceptions.**

This was missed on v5.15.0 and v5.15.1 because `docs/RELEASES.md` was treated as the only
release artefact. The in-app Help → "What's New" section is the **primary user-facing changelog**
— it is what SDRs see. Updating only the markdown file is invisible to users.

### The two-file rule:

| File | Who reads it |
|------|--------------|
| `docs/RELEASES.md` | Developers / agents reviewing history |
| `frontend-react/src/features/help-hub/data/releases.json` | SDRs and Admins inside the app |

**Both must be updated before staging merge. If you push to `develop` without updating
`releases.json`, the deploy is incomplete — do not merge to staging.**

### Agent self-check (add this to every release commit message):
```
☑ docs/RELEASES.md updated
☑ frontend-react/src/features/help-hub/data/releases.json What's New section updated
```

If either line is missing from the commit message → the release is incomplete.

### Release Entry Format

```markdown
## vX.Y.Z – DD Month YYYY

### New Features
- Feature description

### Improvements
- Improvement description

### Bug Fixes
- Fix description

### Breaking Changes
None / describe them
```

### `releases.json` grouping convention (added 2026-08-04, go-forward only)

The in-app release notes are grouped by **minor-version family** (e.g. every
`10.7.x` release under one `v10.7` header), with only the **first release in
a new family** getting full multi-bullet detail — every subsequent patch in
that same family gets a one-line summary nested under the same header. This
keeps the list from being 100+ near-identical full-detail cards for a family
of small patches.

**This applies only going forward — the entries migrated during the Help Hub
build (everything through v10.6.38) are NOT retroactively regrouped or
reclassified.** They have no `family`/`kind` field and render exactly as
they always have, flat and ungrouped — `ReleaseNotesSection.jsx` handles
both shapes.

**Classification rule: by version number, not judgment call.**
- `x.y.0` (the first release of a new minor version, e.g. `10.7.0`) → **major** — full entry, same shape as today: `{version, date, tags, title, items[]}`.
- `x.y.1`, `x.y.2`, ... (patches within that same family) → **minor** — one-liner: `{version, date, family, kind: "minor", tags, summary}` (a single string, not an `items[]` array).

Both major and minor entries in the same family carry a matching `family`
field (e.g. `"family": "10.7"`) — `ReleaseNotesSection.jsx` groups
consecutive entries that share one.

```json
{ "version": "v10.7.0", "date": "10 Aug 2026", "family": "10.7", "kind": "major",
  "tags": [{ "label": "NEW", "variant": "indigo" }], "title": "Big feature",
  "items": ["**First bullet**", "**Second bullet**"] },
{ "version": "v10.7.1", "date": "11 Aug 2026", "family": "10.7", "kind": "minor",
  "tags": [{ "label": "FIX", "variant": "danger" }], "summary": "**One-line summary** of the patch" }
```

---

## 15. Work Mode Context

See `docs/WORKFLOW.md` for active work modes (React migration vs legacy).
The `frontend-react/` **live bundles** (`leads-hub`, `analytics-hub`, and the
shared `components/ui/*` primitives they import) are under active,
explicitly-directed work — see §19. The separate full-SPA rewrite scope
documented in `docs/WORKFLOW.md` ("React Refactor — Harshit Work",
`staging-refactor-continue` branch — `Assignments.jsx`, classic
`LeadsList.jsx`, `Calls.jsx`, `Admin/*`, `Settings/*`, etc.) remains
deprioritized — do NOT touch unless explicitly asked.
Legacy mode (`develop` branch): only bug fixes or small improvements.

---

---

## 16. Context Recovery

If context seems missing or environment values are unknown:
→ Check `docs/PROJECT_JOURNAL.md` for architecture, version history, and current priorities
→ Check `docs/WORKFLOW.md` for active work modes
→ Re-read this file (AGENT_PROTOCOL.md)
→ Do **NOT** guess URLs, config values, or branch states — ask

---

## 17. Karpathy Principles (Added 2026-06-11)

> Source: https://github.com/multica-ai/andrej-karpathy-skills
> Derived from Andrej Karpathy's observations on LLM coding pitfalls.
> These are MANDATORY — not optional guidelines.

### 17.1 Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State assumptions explicitly. If uncertain, **ask** — do not guess.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. **Push back when warranted.**
- If something is unclear, stop. Name what's confusing. Ask.

> ⚠️ This session (2026-06-11): We applied 6 patches to the RCM dialer
> without fully understanding the machine state architecture first. Each patch
> created a new edge case. Proper upfront analysis (which took 10min to do at
> the end) revealed the correct fix was architectural, not patch-level.

### 17.2 Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: **"Would a senior engineer say this is overcomplicated?"** If yes, simplify.

### 17.3 Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, **mention it — don't delete it**.

When your changes create orphans:
- Remove imports/variables/functions that **YOUR** changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: **Every changed line should trace directly to the user's request.**

### 17.4 Goal-Driven Execution

**Define success criteria. Loop until verified.**

For multi-step tasks, state a brief plan before starting:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let the agent loop independently.
Weak criteria ("make it work") require constant clarification.

> **Key insight from Karpathy:** "LLMs are exceptionally good at looping until
> they meet specific goals... Don't tell it what to do, give it success criteria
> and watch it go."

---

## 18. Third-Party API Contract Rule (RCA: 2026-06-12)

> **Never assume external API payload format from documentation or developer curl examples.**
> Always verify against REAL data from the live API before coding any integration.

### What happened (2026-06-12)
The RCM `/calls/initiate` payload was coded based on developer-provided curl examples,
which showed `call_mode: "bridge"` and E.164 phone format. After 5+ failed fix attempts, we
queried the **actual RCM call history** (`GET /calls`) and live-tested the endpoint.

The real contract (from 44 live calls + live API test that created call_id=93):
```json
{"phone_number": "00919545455721", "from_number": "00919240915643"}
```
— Only 2 fields. All other fields (call_type, call_mode, contact_name) caused `422 Unknown field`.
— Number format is `00`-prefix, NOT E.164 `+91...` as the curl example showed.

### Required verification steps for any external API integration:

1. **Query real response history first** — `GET /calls`, `GET /records`, etc.
   Look at what the API returns — that tells you what it expects as input.
2. **Live-test minimal payloads** — start with 1 field, add one at a time.
   Stop when the API succeeds. Any extra field is a liability.
3. **`py_compile` before every commit** — never push Python with syntax errors.
   Run: `python3 -m py_compile <file> && echo OK`
4. **Document the verified contract in the code** — include the live test result
   (e.g. `# LIVE-TESTED 2026-06-12: call_id=93 created OK`) so future agents don't re-investigate.

### Case study: `webhook_url` on RCM `/calls/initiate` (resolved 2026-07-15)

This field was a repeat offender for this rule — a good example of why "vendor confirmed it's live"
is never sufficient evidence on its own:

- **2026-07-09:** Vendor claimed `webhook_url` shipped. Live test → `422 {"errors":{"webhook_url":
  ["Unknown field."]}}` on `app.bercm.com`. Reverted.
- **2026-07-10:** Vendor re-confirmed it was live. Re-tested live → identical 422. Reverted again.
- **2026-07-15:** Vendor reported it live a third time. This time verified with an actual live call
  placed against staging credentials (not just a code review) → real `200`, `call_id` returned, and
  the test phone number actually rang. Kept enabled in `rcm_provider.py`.

The lesson isn't "the vendor eventually told the truth" — it's that the *only* thing that changed
between attempt 2 and attempt 3 was a live test result, not vendor communication. Two "it's live now"
claims were wrong; treat the next one the same way if this or a similar field ever regresses.


## 19. Design-System Consolidation (leads-hub + analytics-hub, 2026-07-28)

**Note:** there is a pre-existing duplicate `## 15.` heading above (both
"In-App Release Notes" and "Work Mode Context" are numbered 15) — flagging,
not fixing, since renumbering cascades into 4 downstream sections.

A multi-round live-staging bug hunt on the redesigned "All Leads" view kept
surfacing the same root cause: the same domain concept (a filter's valid
values, a focus-ring color, a loading skeleton, an icon) reinvented slightly
differently in 2-3 places instead of coming from one shared definition,
because `frontend-react/src/components/ui/` isn't consistently discovered
or reused. This pass fixes the cause, not just the individual instances.

**Scope**: only code live in production today — the `leads-hub` and
`analytics-hub` Vite bundles and the shared `components/ui/*` primitives
they import. Confirmed via grep that the other 4 live bundles
(`dashboard-hub`, `calendar-hub`, `email-hub`, `nav-hub`) don't import
`components/ui/` at all, and that none of Harshit's separate SPA-rewrite
pages (`Assignments.jsx`, classic `LeadsList.jsx`, `Calls.jsx`, `Admin/*`,
`Settings/*`) are reachable from any shipped `build:*` bundle — that work
remains untouched and deprioritized per §15.

**Phases shipped** (one commit each, combined `develop → staging → main`
promotion):
1. Additive `focus-ring` Tailwind semantic token (`tailwind.config.js`).
2. Focus-ring convergence across `FilterBar.jsx`, `BulkActionBar.jsx`,
   `DashboardTab.jsx`, `AskAiTab.jsx`.
3. Replaced raw `&times;` glyphs with lucide `X` icons in
   `BulkActionBar.jsx`, `DisqualifyRequestsPanel.jsx`, `FilterBar.jsx`
   (the latter gained a missing `aria-label` in the process).
4. Corrected `Badge.jsx`'s call-outcome variant map to the real backend
   values (dead-code correctness — no live call site renders a bare
   outcome string through `Badge` today).
5. Deleted zero-importer, wrong-shaped dead code from `Skeleton.jsx`
   (`LeadsTableSkeleton`, `AnalyticsSkeleton`).

**Not solved by this pass**: there is no ESLint rule, pre-commit hook, or
CI check enforcing "check `components/ui/` first" — a future agent can
still reinvent a pattern. Follow-up, not bundled here.

## Deprecated Files (Do Not Edit)

The following files are kept for historical reference only. Do not edit them.
All their content has been merged into this file.

- `docs/MYAGENT.md` → replaced by AGENT_PROTOCOL.md
- `docs/Dev_Protocol.md` → replaced by AGENT_PROTOCOL.md
- `docs/DEPLOYMENT_PROTOCOL.md` → replaced by AGENT_PROTOCOL.md

