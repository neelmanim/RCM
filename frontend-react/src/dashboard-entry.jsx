/**
 * dashboard-entry.jsx
 *
 * IIFE entry point — mirrors analytics-entry.jsx exactly.
 * Exposes window.DashboardHub with mount / navigate / unmount / isMounted.
 *
 * Props accepted from the Vanilla JS shell (app.js):
 *   token      {string}  JWT from localStorage('crm_token')
 *   userRole   {string}  'Super Admin' | 'Pod Admin' | 'SDR' | 'AE'
 *   podId      {number?} Pod ID for Pod Admin scoping
 *   apiBase    {string}  Backend origin, e.g. 'https://crm-api.onrender.com'
 *   onLeadClick     {fn} (id) => void  — fires loadView('lead-detail', id)
 *   onNavigate      {fn} (view) => void — fires loadView(view)
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './pages/Dashboard';
import './pages/Dashboard.css';
import './pages/DashboardResponsive.css';

// ── Mixpanel ──────────────────────────────────────────────────────────────────
// window.mixpanel is initialised by the CDN stub in index.html with
// autocapture + session recording enabled. DO NOT call mixpanel.init() here —
// doing so causes the "already downloaded" double-init warning.
// The mp.js wrapper (frontend/js/mp.js) reads window.mixpanel directly.

let _root = null;
let _mounted = false; // guard against double-mount

window.DashboardHub = {
  mount(container, props = {}) {
    // EC-05: do not double-mount if already alive
    if (_mounted) {
      console.warn('[DashboardHub] Already mounted — skipping double mount');
      return;
    }
    // Expose apiBase so api.js can configure the axios baseURL correctly.
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _root = createRoot(container);
    _root.render(<Dashboard {...props} />);
    _mounted = true;
  },

  /**
   * navigate(container, props) — re-render an already-mounted root WITHOUT
   * destroying the React tree. Called when navigating back to #dashboard
   * while the hub is already alive (mirrors AnalyticsHub R-3 fix).
   */
  navigate(container, props = {}) {
    if (!_mounted || !_root) {
      this.mount(container, props);
      return;
    }
    _root.render(<Dashboard {...props} />);
  },

  unmount() {
    if (!_root) return;
    _root.unmount();
    _root = null;
    _mounted = false;
  },

  get isMounted() { return _mounted; },
};
