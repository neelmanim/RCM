/**
 * pods-entry.jsx
 *
 * The React Pods Hub, exposed to the Vanilla JS shell as window.PodsHub
 * (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT from localStorage('crm_token')
 *   userRole  {string}  e.g. 'Super Admin', 'Pod Admin'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 *   onOpenRep {function} navigates to Leads Hub filtered to one rep
 *   onSwitchToClassic {function} crash-fallback escape hatch to the old view
 */
import { PodsHub } from './features/pods-hub/PodsHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './pods-tailwind.css';
import { registerHub } from './hub-entry';

function renderCrashFallback() {
  return (
    <div className="p-8 text-center text-sm text-slate-400">
      <p className="mb-2">Something went wrong loading POD Management.</p>
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

registerHub('PodsHub', (props) => (
  <ErrorBoundary fallback={renderCrashFallback(props)}>
    <PodsHub {...props} />
  </ErrorBoundary>
));
