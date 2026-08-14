/**
 * analytics-entry.jsx
 *
 * The mount/unmount contract between the Vanilla JS shell and the React
 * Analytics Hub. Exposes window.AnalyticsHub.mount(container, props),
 * window.AnalyticsHub.navigate(container, props), and
 * window.AnalyticsHub.unmount().
 *
 * Props accepted from Vanilla JS:
 *   token             {string}  JWT from localStorage('crm_token')
 *   userRole          {string}  e.g. 'Super Admin', 'Pod Admin'
 *   pendingQuery      {string?} Pre-filled AI query from topbar pill button
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnalyticsHub } from './pages/Analytics/AnalyticsHub';
// Import scoped Tailwind styles (components + utilities only — no base resets
// that would bleed into the Vanilla JS shell, see EC-11).
import './analytics-tailwind.css';

let _root = null;
let _mounted = false; // EC-05: guard against double-mount

window.AnalyticsHub = {
  mount(container, props = {}) {
    // EC-05: do not double-mount if already alive
    if (_mounted) {
      console.warn('[AnalyticsHub] Already mounted — skipping double mount');
      return;
    }
    // Expose apiBase so api.js can configure the axios baseURL correctly.
    // The Vanilla JS shell passes API_BASE (the backend origin) via props.
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _root = createRoot(container);
    _root.render(<AnalyticsHub {...props} />);
    _mounted = true;
  },

  /**
   * navigate(props) — Update props on an already-mounted root WITHOUT
   * destroying the React tree. Called by app.js when the user navigates
   * back to #analytics while the hub is already alive (R-3 fix).
   * Falls back to mount() if the root is not yet initialised.
   */
  navigate(container, props = {}) {
    if (!_mounted || !_root) {
      // Not mounted yet — fall through to normal mount
      this.mount(container, props);
      return;
    }
    // Re-render the existing root with new props (no teardown, no API refetch)
    _root.render(<AnalyticsHub {...props} />);
  },

  unmount() {
    if (!_root) return;
    _root.unmount();
    _root = null;
    _mounted = false;
  },

  /** Read-only flag so app.js can check mount state without importing React. */
  get isMounted() { return _mounted; },
};
