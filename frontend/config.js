// ── config.js — Frontend environment configuration ───────────────────────────
// This file is loaded BEFORE any ES modules. It sets window.__APP_CONFIG__
// so that auth.js can pick up the correct API_BASE for the deployment.
//
window.__APP_CONFIG__ = {
    API_BASE: "https://api.alternatecrm.com"
};
