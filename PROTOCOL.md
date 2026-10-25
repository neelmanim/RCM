# AlternateCRM — Single Canonical System Protocol & Operations Blueprint

> **Notice of Authoritative Source**: This document is the single source of truth for all agents, engineers, and deployment pipelines working on AlternateCRM. All previous markdown context files (`CONTEXT.md`, old audit logs) have been consolidated into this protocol.

---

## 1. 🏛️ Infrastructure & Hosting Topology (Strict Boundary)

### 🚫 Complete Decommission of Render
* **Render has been permanently shut down and decommissioned.**
* **Strict Rule**: No code, test fixtures, CI scripts, or documentation may reference `onrender.com` or Render service IDs. All runtime traffic is strictly segregated between **Vercel** and **Railway**.

### 🌐 Active Hosting Architecture
1. **Frontend & Marketing Site (Vercel)**:
   - **`marketing-site/`**: Next.js 16 (App Router + Turbopack). Serves public landing page, `/blog`, and `/status`.
   - **`frontend/`**: Static compiled single-page application & client hubs (Vite / React 19). Serves `/sandbox`, `/login`, and app dashboard.
   - **API Proxy Rewrite**: `frontend/vercel.json` transparently proxies all requests on `https://app.alternatecrm.com/api/*` directly to the Railway backend API.
2. **Backend API & Database (Railway)**:
   - **Backend Service**: High-performance FastAPI on Railway (`uvicorn main:app --host 0.0.0.0 --port $PORT`), managed by `railway.toml` (Nixpacks builder).
   - **Database**: Railway Managed PostgreSQL. Zero SQLite runtime in production.
   - **Liveness & Health Probe**: `GET /api/public/health` (Unauthenticated) & `GET /api/health` (Deep DB Check).

---

## 2. 🌐 Canonical URL & Environment Matrix

| Environment | Service Layer | Canonical URL | Hosting Provider | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Production** | **Marketing Homepage** | [https://alternatecrm.com](https://alternatecrm.com) | Vercel (`marketing-site`) | Aliased to `www.alternatecrm.com` (307 redirect) |
| **Production** | **App & 1-Click Sandbox** | [https://app.alternatecrm.com/sandbox](https://app.alternatecrm.com/sandbox) | Vercel (`frontend`) | Zero-login interactive stateful demo |
| **Production** | **App Login Hub** | [https://app.alternatecrm.com/login](https://app.alternatecrm.com/login) | Vercel (`frontend`) | Clean URL redirection enforced |
| **Production** | **Backend API** | [https://api.alternatecrm.com](https://api.alternatecrm.com) | Railway (`backend`) | Also accessible via `https://app.alternatecrm.com/api/*` |
| **Production** | **PostgreSQL Database** | Railway Managed Postgres | Railway Cloud | Service ID: `bfc89358-ba9b-4415-bb24-5bd10c06684d` |
| **Staging** | **Preview Frontends** | Vercel Preview Deployments | Vercel | Automatic per-branch or PR preview URLs |
| **Staging** | **Staging API** | Railway Staging Environment | Railway | Connected to Salesforce sandbox (`test`) |
| **Local (Dev)** | **Marketing Site** | `http://localhost:3000` | Local Node / Turbopack | `cd marketing-site && npm run dev` |
| **Local (Dev)** | **React Frontend** | `http://localhost:5173` | Local Vite Dev Server | `cd frontend-react && npm run dev` |
| **Local (Dev)** | **Backend API** | `http://127.0.0.1:8000` | Local Uvicorn | `uvicorn main:app --reload --port 8000` |
| **Local (Dev)** | **Local PostgreSQL** | `localhost:5432` (DB: `crm`) | PostgreSQL 16 | `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crm` |

---

## 3. 🚀 Standard Deployment & Release Protocol

### Monorepo Vercel Deployment Protocol
Because `marketing-site/` and `frontend/` live in subdirectories of the monorepo, automatic git-push webhooks do not automatically trigger Vercel productions without explicit directory promotion. Deployments must follow this standard sequence:

```bash
# 1. Deploy Marketing Site (alternatecrm.com)
cd marketing-site
npm run build
npx vercel deploy --prod --yes

# 2. Deploy Frontend App (app.alternatecrm.com)
cd ../frontend-react
npm run build
npm run build:login
cd ../frontend
npx vercel deploy --prod --yes
```

### Git Multi-Remote Synchronization Protocol
Always keep both remotes (`mauji` and `origin`) in lockstep across all lifecycle branches:
```bash
git push mauji main
git push origin main
git branch -f develop main && git push mauji develop --force && git push origin develop --force
git branch -f staging main && git push mauji staging --force && git push origin staging --force
git branch -f prod main && git push mauji prod --force && git push origin prod --force
```

---

## 4. 🏷️ Continuous Versioning & Footer Display Protocol

1. **Semantic Version Invariant**:
   - Every code release MUST bump the version string across:
     - `backend/config.py` (`APP_VERSION = "14.4.0"`)
     - `marketing-site/package.json`
     - `frontend/js/generated-version.js`
2. **Footer Transparency**:
   - The active version (e.g. `v14.4.0`) MUST be rendered cleanly in the footer of both the marketing homepage and the application login view, linked directly to `/status`.

---

## 5. 🛡️ Inbound Lead Capture & Enterprise SaaS Positioning

### Zero-Friction Enterprise Lead Gateway
* **Endpoint**: `POST /api/public/leads/inbound`
* **Protection Mechanisms**:
  - RFC 5322 work email sanitization & Unicode normalization.
  - Invisible honeypot trap (`website_hp`) for zero-latency bot filtering.
  - Stored XSS HTML stripping and SQL injection escaping.
  - Lead deduplication with auto-assignment to active sales pods.

### Copy & Positioning Rule (Strict)
* **Never use developer jargon in customer-facing UI.**
* Terms such as *"dogfooding"*, *"internal testing"*, or *"playground"* are strictly forbidden on landing pages and customer modals.
* All customer-facing copy must reflect high-trust B2B Enterprise SaaS standards:
  - *"Priority Access to Conversation OS"*
  - *"Enterprise-grade security. SOC2 compliant isolation. Zero spam guarantee."*
  - *"Your VIP request is confirmed. Our solutions engineering team is preparing your dedicated workspace configuration."*

### Resilient Client-Side Failover
* The lead capture modal must employ dual-target dispatch (`https://app.alternatecrm.com/api/public/leads/inbound` with fallback to `https://api.alternatecrm.com/api/public/leads/inbound`).
* In the event of an unexpected edge network failure, the client gracefully stores the lead parameters locally and immediately transitions the prospect to Step 2 (VIP Calendly booking + instant Sandbox launch), ensuring no prospective buyer is ever shown an error banner.
