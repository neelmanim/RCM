/**
 * lead-detail-entry.jsx
 *
 * The React Lead Detail Hub, exposed to the Vanilla JS shell as
 * window.LeadDetailHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   leadId            {string}   the lead to display
 *   userRole          {string}   e.g. 'Super Admin', 'Pod Admin'
 *   userPodId         {string|null}
 *   apiBase           {string}   backend origin, sets window.__CRM_API_BASE__
 *   navPosition       {string}   e.g. "2 / 20"
 *   onPreviousLead    {function|null}
 *   onNextLead        {function|null}
 *   onBack            {function}
 *   onSwitchToClassic {function} flips the legacy/beta toggle back
 */
import { LeadDetailHub } from './features/lead-detail-hub/LeadDetailHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './lead-detail-tailwind.css';
import { registerHub } from './hub-entry';

// A render-time crash left the whole content area blank with no way back on
// other hubs (see leads-entry.jsx's RCA) — same fallback here.
function renderCrashFallback() {
  return (
    <div className="p-8 text-center text-sm text-slate-400">
      <p className="mb-2">Something went wrong loading Lead Details.</p>
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

registerHub('LeadDetailHub', (props) => (
  <ErrorBoundary fallback={renderCrashFallback(props)}>
    <LeadDetailHub {...props} />
  </ErrorBoundary>
));
