/**
 * my-settings-entry.jsx
 *
 * The React My Settings Hub, exposed to the Vanilla JS shell as
 * window.MySettingsHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT — forwarded via the shared axios client
 *   userRole  {string}  e.g. 'Super Admin'. Open to every role — this is
 *                       personal account preferences, not org config.
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 */
import { MySettingsHub } from './features/my-settings/MySettingsHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './my-settings-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading My Settings.</p>
  </div>
);

registerHub('MySettingsHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <MySettingsHub {...props} />
  </ErrorBoundary>
));
