/**
 * leads-entry.jsx
 *
 * Mount/unmount contract between the Vanilla JS shell and the React Leads
 * Hub. Mirrors calendar-entry.jsx exactly. Exposes window.LeadsHub.mount,
 * .navigate, .unmount, .isMounted.
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT from localStorage('crm_token')
 *   userRole  {string}  e.g. 'Super Admin', 'Pod Admin'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 *   onSwitchToClassic {function} flips the legacy/beta toggle back
 *   onOpenLead {function} navigates to the Lead Detail page for a lead
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LeadsHub as LeadsHubComponent } from './features/leads-hub/LeadsHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './leads-tailwind.css';

let _root = null;
let _mounted = false;

// A render-time crash (unexpected API shape, a bad localStorage value) left
// the whole content area blank with no way back — this fallback keeps the
// existing "Switch to classic view" escape hatch reachable even when the
// beta view itself has thrown.
function renderCrashFallback(props) {
  return (
    <div className="p-8 text-center text-sm text-slate-500">
      <p className="mb-2">Something went wrong loading the redesigned Leads view.</p>
      {props.onSwitchToClassic && (
        <button
          type="button"
          onClick={props.onSwitchToClassic}
          className="text-blue-600 underline underline-offset-2 font-semibold"
        >
          Switch to classic view
        </button>
      )}
    </div>
  );
}

window.LeadsHub = {
  mount(container, props = {}) {
    if (_mounted) {
      console.warn('[LeadsHub] Already mounted — skipping double mount');
      return;
    }
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _root = createRoot(container);
    _root.render(
      <ErrorBoundary fallback={renderCrashFallback(props)}>
        <LeadsHubComponent {...props} />
      </ErrorBoundary>
    );
    _mounted = true;
  },

  navigate(container, props = {}) {
    if (!_mounted || !_root) {
      this.mount(container, props);
      return;
    }
    _root.render(
      <ErrorBoundary fallback={renderCrashFallback(props)}>
        <LeadsHubComponent {...props} />
      </ErrorBoundary>
    );
  },

  unmount() {
    if (!_root) return;
    _root.unmount();
    _root = null;
    _mounted = false;
  },

  get isMounted() { return _mounted; },
};
