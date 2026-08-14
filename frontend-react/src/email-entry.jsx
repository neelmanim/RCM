/**
 * email-entry.jsx
 *
 * Mount/unmount contract between the Vanilla JS shell and the React Email Hub.
 * Exposes window.EmailHub.mount(container, props),
 *          window.EmailHub.navigate(container, props), and
 *          window.EmailHub.unmount().
 *
 * Props accepted from Vanilla JS (lead_detail.js):
 *   leadId   {string}  Lead UUID
 *   lead     {object}  Lead object (name, email, etc.)
 *   token    {string}  JWT from localStorage('crm_token')
 *   apiBase  {string}  Backend origin e.g. https://api.rcm.txtbox.in
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { EmailHub } from './pages/Email/EmailHub';

let _root = null;
let _mounted = false; // guard against double-mount

window.EmailHub = {
  mount(container, props = {}) {
    if (_mounted) {
      console.warn('[EmailHub] Already mounted — skipping double mount');
      return;
    }
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _root = createRoot(container);
    _root.render(<EmailHub {...props} />);
    _mounted = true;
  },

  /**
   * navigate(container, props) — Update props on an already-mounted root WITHOUT
   * destroying the React tree. Called when the user navigates to a different lead
   * while the email tab is already mounted (avoids full remount + all API calls).
   * Falls back to mount() if the root is not yet initialised.
   */
  navigate(container, props = {}) {
    if (!_mounted || !_root) {
      this.mount(container, props);
      return;
    }
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _root.render(<EmailHub {...props} />);
  },

  unmount() {
    if (!_root) return;
    _root.unmount();
    _root = null;
    _mounted = false;
  },

  /** Read-only flag so lead_detail.js can check mount state without importing React. */
  get isMounted() { return _mounted; },
};
