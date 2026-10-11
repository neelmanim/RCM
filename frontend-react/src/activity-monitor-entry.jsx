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

function renderCrashFallback(props) {
  return (
    <div className="p-8 text-center text-sm text-slate-500">
      <p className="mb-2">Something went wrong loading Activity Monitor.</p>
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

registerHub('ActivityMonitorHub', (props) => (
  <ErrorBoundary fallback={renderCrashFallback(props)}>
    <ActivityMonitorHub {...props} />
  </ErrorBoundary>
));
