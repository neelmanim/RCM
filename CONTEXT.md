# Project Context & Environment Reference: RCM (Alternate CRM)

This document is the single source of truth for repository structure, hosting platforms, environments, database configurations, and operational protocols.

---

## 🏛️ Hosting Architecture (Strictly Vercel & Railway Only)

- **Frontend Hosting**: **Vercel**
  - Project: `frontend` (`projectId`: `prj_1qYzsjrZpMAEvPJuupfHZixk2NIQ`, `orgId`: `team_wMCAf6JEh4Lrfw3as2EaCQrJ`)
  - Config directory: `frontend/.vercel`
- **Backend Hosting**: **Railway**
  - Configuration: `railway.toml` (Nixpacks builder, `uvicorn main:app --host 0.0.0.0 --port $PORT`, healthcheck `/api/health`)
  - Service: `RCM` (`bfc89358-ba9b-4415-bb24-5bd10c06684d`)
- **Hosting Boundary**: **Render is NOT used.** All hosting is exclusively **Vercel (Frontend)** and **Railway (Backend & Database)**.

---

## 🌐 Environment Matrix & URLs

| Environment | Frontend (Vercel) | Backend API (Railway) | Database Details (Railway / Local Postgres) | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Production** | [https://alternatecrm.staging.in](https://alternatecrm.staging.in)<br>([https://alternatecrm.com](https://alternatecrm.com)) | [https://api.alternatecrm.staging.in](https://api.alternatecrm.staging.in)<br>(Railway Production Service) | **Railway PostgreSQL** (Service `bfc89358-ba9b-4415-bb24-5bd10c06684d`) | Super Admin: `tpsoircm@gmail.com`<br>Production security gates enforced. |
| **Staging** | Vercel Staging Deployment / Preview | Railway Staging Service | Railway Staging PostgreSQL | Connected to Salesforce sandbox (`test`) |
| **Local (Dev)** | `http://localhost:5173` (Vite) | `http://localhost:8000` (FastAPI / Uvicorn) | **Local PostgreSQL** (`localhost:5432`, DB: `crm`) | `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crm` |

---

## 🗄️ Database Strategy & Local PostgreSQL

- **Engine**: **PostgreSQL exclusively**.
  - SQLite is deprecated for application runtime to prevent datetime, schema, and trigger divergence between local and production.
- **Local Dev Connection String**:
  ```env
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crm
  ```
- **Superuser**: `postgres`
- **Port**: `5432`

---

## 🚫 Hard Boundaries & Architectural Rules

1. **Strict Service Isolation**:
   - **NEVER TOUCH `jobbus-backend`** (`90ab9d2d-7972-4039-b0fb-c29423cc8e01`). All work remains strictly within `RCM`.
2. **Retired Components & APIs**:
   - **Converse Desk**: Fully retired. Replaced by the **"Inbox"** tab (`view=inbox`) in Sales Tools SMS Campaigns.
   - **Audience Manager**: External API calls retired/neutralized to safe no-ops in `backend/audience_manager.py`.
   - **Alternate Messenger Conversations**: Retired card removed from Control Center Integrations.
3. **Workspace Root**:
   - Project Root is `E:\Neel Antigravity Projects\crmalternate\RCM`.
   - All code changes, tests, and graph indexing must be executed in `RCM`.
   - No scratch/temporary files outside or inside git; `.codegraph/` and `.code-review-graph/` are gitignored.

---

## 🔍 Code Intelligence Graphs & Review Workflow

Before and after every change, use the code intelligence graphs:

1. **`code-review-graph` (MCP)**:
   - Tool `build_or_update_graph_tool(repo_root="...")`: Incremental AST and FTS rebuild.
   - Tool `detect_changes_tool(repo_root="...")`: Automated blast radius analysis, changed symbol discovery, and test coverage gap reporting.
2. **`codegraph` (AST Cross-Reference Engine)**:
   - Database: `RCM/.codegraph/codegraph.db` (1,077 files, 46,143 AST nodes).
   - Sync command: `codegraph sync` inside `RCM`.
   - Inspection: `codegraph status`, `codegraph query`, `codegraph callers <symbol>`.
