/**
 * activity-monitor-entry.jsx
 *
 * The React Activity Monitor Hub, exposed to the Vanilla JS shell as
 * window.ActivityMonitorHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT from localStorage('crm_token')
 *   userRole  {string}  e.g. 'Super Admin', 'Pod Admin'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 *   onOpenLead {function} navigates to Lead Detail for a given lead id
 *   onSwitchToClassic {function} crash-fallback escape hatch to the old view
 */
import { ActivityMonitorHub } from './features/activity-monitor/ActivityMonitorHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './activity-monitor-tailwind.css';
import { registerHub } from './hub-entry';

function renderCrashFallback() {
  return (
    <div className="p-8 text-center text-sm text-slate-400">
      <p className="mb-2">Something went wrong loading Activity Monitor.</p>
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

registerHub('ActivityMonitorHub', (props) => (
  <ErrorBoundary fallback={renderCrashFallback(props)}>
    <ActivityMonitorHub {...props} />
  </ErrorBoundary>
));
