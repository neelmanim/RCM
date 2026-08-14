/**
 * sales-journey-entry.jsx
 *
 * Mount/unmount contract between the Vanilla JS shell and the React Sales
 * Journey builder. Mirrors help-entry.jsx exactly. Exposes
 * window.SalesJourneyHub.mount, .navigate, .unmount, .isMounted.
 *
 * Props accepted from Vanilla JS:
 *   userRole  {string}  'Super Admin' | 'Pod Admin' | 'SDR' | 'AE'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SalesJourneyHub as SalesJourneyHubComponent } from './features/sales-journey/SalesJourneyHub';
import { ToastHost } from './components/ui/Toast';
import './sales-journey-tailwind.css';

let _root = null;
let _mounted = false;

function App(props) {
  return (
    <>
      <SalesJourneyHubComponent {...props} />
      <ToastHost />
    </>
  );
}

window.SalesJourneyHub = {
  mount(container, props = {}) {
    if (_mounted) {
      console.warn('[SalesJourneyHub] Already mounted — skipping double mount');
      return;
    }
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _root = createRoot(container);
    _root.render(<App {...props} />);
    _mounted = true;
  },

  navigate(container, props = {}) {
    if (!_mounted || !_root) {
      this.mount(container, props);
      return;
    }
    _root.render(<App {...props} />);
  },

  unmount() {
    if (!_root) return;
    _root.unmount();
    _root = null;
    _mounted = false;
  },

  get isMounted() { return _mounted; },
};
