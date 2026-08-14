/**
 * power-dialer-entry.jsx
 *
 * Mount/unmount contract between the Vanilla JS shell and the React Power
 * Dialer Hub. Mirrors leads-entry.jsx / calendar-entry.jsx exactly. Exposes
 * window.PowerDialerHub.mount, .navigate, .unmount, .isMounted.
 *
 * Props accepted from Vanilla JS (app.js):
 *   token       {string}   JWT from localStorage('crm_token')
 *   userRole    {string}   e.g. 'SDR', 'AE'
 *   apiBase     {string}   backend origin, sets window.__CRM_API_BASE__
 *   onLeadClick {function} navigates to the Lead Detail page for a lead
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PowerDialerHub as PowerDialerHubComponent } from './features/power-dialer-hub/PowerDialerHub';
import './power-dialer-tailwind.css';

let _root = null;
let _mounted = false;

window.PowerDialerHub = {
  mount(container, props = {}) {
    if (_mounted) {
      console.warn('[PowerDialerHub] Already mounted — skipping double mount');
      return;
    }
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _root = createRoot(container);
    _root.render(<PowerDialerHubComponent {...props} />);
    _mounted = true;
  },

  navigate(container, props = {}) {
    if (!_mounted || !_root) {
      this.mount(container, props);
      return;
    }
    _root.render(<PowerDialerHubComponent {...props} />);
  },

  unmount() {
    if (!_root) return;
    _root.unmount();
    _root = null;
    _mounted = false;
  },

  get isMounted() { return _mounted; },
};
