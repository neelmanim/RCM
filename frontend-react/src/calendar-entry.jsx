/**
 * calendar-entry.jsx
 *
 * Mount/unmount contract between the Vanilla JS shell and the React Calendar
 * Hub. Mirrors analytics-entry.jsx exactly. Exposes window.CalendarHub.mount,
 * .navigate, .unmount, .isMounted.
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT from localStorage('crm_token')
 *   userRole  {string}  e.g. 'Super Admin', 'Pod Admin', 'SDR'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarHub as CalendarHubComponent } from './pages/Calendar/CalendarHub';
import './calendar-tailwind.css';

let _root = null;
let _mounted = false;

window.CalendarHub = {
  mount(container, props = {}) {
    if (_mounted) {
      console.warn('[CalendarHub] Already mounted — skipping double mount');
      return;
    }
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _root = createRoot(container);
    _root.render(<CalendarHubComponent {...props} />);
    _mounted = true;
  },

  navigate(container, props = {}) {
    if (!_mounted || !_root) {
      this.mount(container, props);
      return;
    }
    _root.render(<CalendarHubComponent {...props} />);
  },

  unmount() {
    if (!_root) return;
    _root.unmount();
    _root = null;
    _mounted = false;
  },

  get isMounted() { return _mounted; },
};
