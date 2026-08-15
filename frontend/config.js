// ── config.js — Frontend environment configuration ───────────────────────────
// This file is loaded BEFORE any ES modules. It sets window.__APP_CONFIG__
// so that auth.js can pick up the correct API_BASE for the deployment.
//
// BRANCH: develop
// The develop frontend static site (rcm-frontend-develop) calls the
// staging backend. This is intentional — develop has no dedicated cloud backend.
// Developers running a local backend should use localhost:8000 directly.
//
window.__APP_CONFIG__ = {
    API_BASE: "https://backend-production-4147.up.railway.app"
};
