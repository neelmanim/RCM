/**
 * help-entry.jsx
 *
 * Mount/unmount contract between the Vanilla JS shell and the React Help
 * Hub. Mirrors leads-entry.jsx exactly. Exposes window.HelpHub.mount,
 * .navigate, .unmount, .isMounted.
 *
 * Props accepted from Vanilla JS:
 *   userRole  {string}  'Super Admin' | 'Pod Admin' | 'SDR' | 'AE'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__ (unused
 *                       today — no API calls in this bundle — but set for
 *                       consistency with every other hub's mount contract)
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HelpHub as HelpHubComponent } from './features/help-hub/HelpHub';
import './help-tailwind.css';

let _root = null;
let _mounted = false;

window.HelpHub = {
  mount(container, props = {}) {
    if (_mounted) {
      console.warn('[HelpHub] Already mounted — skipping double mount');
      return;
    }
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _root = createRoot(container);
    _root.render(<HelpHubComponent {...props} />);
    _mounted = true;
  },

  navigate(container, props = {}) {
    if (!_mounted || !_root) {
      this.mount(container, props);
      return;
    }
    _root.render(<HelpHubComponent {...props} />);
  },

  unmount() {
    if (!_root) return;
    _root.unmount();
    _root = null;
    _mounted = false;
  },

  get isMounted() { return _mounted; },
};
