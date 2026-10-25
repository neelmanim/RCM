/**
 * leads-entry.jsx
 *
 * The React Leads Hub, exposed to the Vanilla JS shell as window.LeadsHub
 * (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT from localStorage('crm_token')
 *   userRole  {string}  e.g. 'Super Admin', 'Pod Admin'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 *   onSwitchToClassic {function} flips the legacy/beta toggle back
 *   onOpenLead {function} navigates to the Lead Detail page for a lead
 */
import { LeadsHub } from './features/leads-hub/LeadsHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './leads-tailwind.css';
import { registerHub } from './hub-entry';

// A render-time crash (unexpected API shape, a bad localStorage value) left
// the whole content area blank with no way back — this fallback keeps the
// existing "Switch to classic view" escape hatch reachable even when the
// beta view itself has thrown.
function renderCrashFallback() {
  return (
    <div className="p-8 text-center text-sm text-slate-400">
      <p className="mb-2">Something went wrong loading Leads.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="text-[#C9FF68] underline underline-offset-2 font-semibold"
      >
        Reload page
      </button>
    </div>
  );
}

registerHub('LeadsHub', (props) => (
  <ErrorBoundary fallback={renderCrashFallback(props)}>
    <LeadsHub {...props} />
  </ErrorBoundary>
));
