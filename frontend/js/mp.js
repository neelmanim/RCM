// ── mp.js — Safe analytics wrapper (Mixpanel removed) ─────────────────────────
// Retained as clean no-op so existing imports do not throw errors.

export const mp = {
    /** Identify user (no-op) */
    identify(_userId, _props = {}) {},

    /** Track semantic custom event (no-op) */
    track(_event, _props = {}) {},
};
