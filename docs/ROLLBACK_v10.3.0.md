# v10.3.0 Rollback Runbook

> Created: 2026-07-08 | Scope: Pod Admin Multi-Admin + Account-Level Connect %
> Status: **STAGING COMPLETE — AWAITING PROD PUSH**

---

## Production State Before Pushing v10.3.0

| Item | Current Prod State |
|------|-------------------|
| Last prod migration | `v24_backfill_dialer_source` (2026-05-07) |
| `pods.admin_id` column | ✅ Still exists on prod |
| `pod_admins` table | ❌ Does NOT exist on prod yet |
| v10 migrations run on prod | ❌ Not yet |
| Code on prod (`main`) | v9.x — uses `pods.admin_id` |

> [!IMPORTANT]
> Prod DB and prod code are BOTH on v9.x right now. v10.3.0 has only been pushed to `staging`.
> The 4 migrations run automatically on first startup after `staging → main` merge + deploy.

---

## Step 0 — Before You Push to Prod (Mandatory)

```bash
# 1. Note current prod commit SHA (for emergency revert)
git log main -1 --format="%H %s"
# Save this SHA somewhere safe

# 2. Verify staging is healthy
curl https://rcm-crm-staging.onrender.com/api/health/deep

# 3. Check Render prod DB backup exists
# → Render Dashboard → rcm-db-prod → Backups tab
# → Confirm backup from today exists

# 4. Deploy during low-traffic window (recommended: before 8am IST)
```

---

## Deployment Steps (Normal Path)

```bash
git checkout main
git pull origin main
git merge staging -m "chore(deploy): merge staging → main for v10.3.0

Pod Admin multi-admin + Account-level Connect %
1697 unit tests passing. Staging fully verified."
git push origin main
# Render auto-deploys — Docker build ~3-5 min
```

**Migrations run automatically on first startup:**
1. `v10_create_pod_admins_table`
2. `v10_backfill_pod_admins_from_admin_id`
3. `v10_clean_lead_assignments_pod_admins`
4. `v10_drop_pods_admin_id`

**Post-deploy smoke test (within 5 min):**
```bash
curl https://rcm-crm-prod.onrender.com/api/health/deep
# Expect: {"status":"ok","db_connected":true,"startup_complete":true}

curl -H "Authorization: Bearer <token>" https://rcm-crm-prod.onrender.com/api/pods
# Expect: pods array, each with "admins": [...] field
```

---

## Rollback Decision Tree

```
Something broke in prod after v10.3.0 deploy
│
├── UI/frontend issue only?
│   └── Revert pods.js / analytics.js — push to main
│
├── Backend 500 errors?
│   ├── Migration error in logs? → Schema Rollback (Tier 2)
│   └── Route error? → Code-Only Rollback (Tier 1)
│
└── Data corrupted?
    └── Full DB Restore (Tier 3) — last resort
```

---

## Rollback Tier 1 — Code-Only (~5 min, Zero DB Risk)

**Use when:** Route returning errors, migrations ran cleanly.

```bash
git revert HEAD --no-edit
git push origin main
```

> [!WARNING]
> Tier 1 leaves v10 schema in place. Reverted v9 code looks for `pods.admin_id`
> which is now dropped. This alone won't fully fix the issue — use Tier 2 instead.

---

## Rollback Tier 2 — Schema + Code (~30 min)

**Use when:** The schema change is causing issues.

### Step 1: Run on prod DB (via Render Dashboard → Query Editor)

```sql
-- Re-add admin_id column
ALTER TABLE pods ADD COLUMN admin_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;

-- Backfill from pod_admins (first admin per pod)
UPDATE pods SET admin_id = (
    SELECT pa.user_id FROM pod_admins pa
    WHERE pa.pod_id = pods.id
    ORDER BY pa.assigned_at ASC LIMIT 1
);

-- Remove v10 migration tracking so they can re-run when ready
DELETE FROM _applied_migrations WHERE name LIKE 'v10%';
```

### Step 2: Revert code
```bash
git revert <v10-commit-sha> --no-edit
git push origin main
```

### Step 3: Verify
```bash
curl https://rcm-crm-prod.onrender.com/api/health/deep
```

---

## Rollback Tier 3 — Full DB Restore (Last Resort)

```
Render Dashboard → rcm-db-prod → Backups
→ Select latest backup (before v10.3.0 deploy)
→ Click Restore → Confirm
→ Then redeploy with pre-v10 code (git revert)
```

> [!CAUTION]
> DB restore loses ALL data created after the backup snapshot.
> Leads, calls, emails, notes will be permanently lost.
> Use only if data is critically corrupted.

---

## What's Irreversible in v10.3.0

| Change | Reversible? | Notes |
|--------|-------------|-------|
| `pod_admins` table created | ✅ Yes | `DROP TABLE pod_admins` |
| `pods.admin_id` dropped | ✅ Yes | Re-add + backfill from `pod_admins` |
| `lead_assignments` Pod Admin rows deleted | ⚠️ Partial | Rows gone. Self-heals on next AE assignment |
| User `role` field changes | ✅ Yes | Direct SQL `UPDATE users SET role=...` |

---

## Key Reference

| Item | Value |
|------|-------|
| Staging backend | https://rcm-crm-staging.onrender.com |
| Prod backend | https://rcm-crm-prod.onrender.com |
| Prod DB ID | `dpg-d6ncblh5pdvs73aacnhg-a` |
| Staging DB ID | `dpg-d6ncblh5pdvs73aacni0-a` |
| v10.3.0 staging commit | `72b9cee` |
| Pre-v10 prod commit (safe revert point) | `6b77f49` |

---

## Staging Test Results Summary

| Phase | Tests | Result |
|-------|-------|--------|
| Unit tests (SQLite, local) | 1697 | ✅ 0 failures |
| Staging API tests (live Postgres) | 62 | ✅ 59 pass, 3 false positives* |
| DB migration check (live) | 4 migrations | ✅ All applied correctly |
| Live add/remove Pod Admin cycle | manual | ✅ Role promotion/revert works |
| Analytics account % fields | manual | ✅ 3 new fields on real Postgres |
| Trend endpoint (Postgres date_trunc) | manual | ✅ Returns real bucketed data |

*False positives: Redis cache timing (role check), wrong URL path, changed response shape — all confirmed working.
