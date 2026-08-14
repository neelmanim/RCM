// ── config.staging.js — Staging environment config ───────────────────────────
// Copy this over config.js on the staging static site to point at the
// staging backend. For production, create a similar config.prod.js.
//
// NOTE: This file is a REFERENCE. The actual config.js in the frontend/
// directory defaults to empty (co-hosted mode). When deploying the frontend
// as a separate static site, replace config.js with the appropriate version:
//
//   cp frontend/config.staging.js frontend/config.js   (for staging deploy)
//
window.__APP_CONFIG__ = {
    API_BASE: "https://rcm-crm-staging.onrender.com"
};
