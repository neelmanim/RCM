/**
 * control-center-entry.jsx
 *
 * The React Control Center Hub, exposed to the Vanilla JS shell as
 * window.ControlCenterHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT from localStorage('crm_token')
 *   userRole  {string}  e.g. 'Super Admin' — Control Center is
 *                       visible/reachable only for role === 'Super Admin'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 */
import { ControlCenterHub } from './features/control-center/ControlCenterHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './control-center-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading Control Center.</p>
  </div>
);

registerHub('ControlCenterHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <ControlCenterHub {...props} />
  </ErrorBoundary>
));
