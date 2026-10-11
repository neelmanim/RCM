/**
 * power-dialer-entry.jsx
 *
 * The React Power Dialer Hub, exposed to the Vanilla JS shell as
 * window.PowerDialerHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS (app.js):
 *   token       {string}   JWT from localStorage('crm_token')
 *   userRole    {string}   e.g. 'SDR', 'AE'
 *   apiBase     {string}   backend origin, sets window.__CRM_API_BASE__
 *   onLeadClick {function} navigates to the Lead Detail page for a lead
 */
import { PowerDialerHub } from './features/power-dialer-hub/PowerDialerHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './power-dialer-tailwind.css';
import { registerHub } from './hub-entry';

// RCA 2026-08-31: a render-time crash here left the whole Power Dialer blank
// with no way back (reported as "shows blank screen" when trying to call) —
// leads-entry.jsx got this same fallback earlier for the identical failure
// mode, it was never carried over to this entry point.
const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading the Power Dialer.</p>
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="text-blue-600 underline underline-offset-2 font-semibold"
    >
      Reload
    </button>
  </div>
);

registerHub('PowerDialerHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <PowerDialerHub {...props} />
  </ErrorBoundary>
));
