// ── mp.js — Safe Mixpanel wrapper ────────────────────────────────────────────
// All custom event tracking goes through here.
// window.mixpanel is set by dashboard-hub.js (React IIFE bundle).
// If it hasn't loaded yet or fails, these calls are silent no-ops.
//
// Usage:
//   import { mp } from '../mp.js';
//   mp.track('Call Logged', { lead_id, outcome, source: 'manual' });
//   mp.identify(userId, { name, email, role });

export const mp = {
    /** Identify the logged-in user in Mixpanel with profile properties. */
    identify(userId, props = {}) {
        try {
            if (!window.mixpanel) return;
            window.mixpanel.identify(userId);
            window.mixpanel.people.set(props);
        } catch { /* silent */ }
    },

    /** Track a semantic custom event with optional properties. */
    track(event, props = {}) {
        try {
            window.mixpanel?.track(event, props);
        } catch { /* silent */ }
    },
};
