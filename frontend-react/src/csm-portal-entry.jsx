/**
 * csm-portal-entry.jsx
 *
 * The React CSM Portal Hub, exposed to the Vanilla JS shell as
 * window.CsmPortalHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   userRole  {string}  e.g. 'CSM' | 'Super Admin' — see CsmPortalHub.jsx
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 */
import { CsmPortalHub } from './features/csm-portal/CsmPortalHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './csm-portal-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading the CSM Portal.</p>
  </div>
);

registerHub('CsmPortalHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <CsmPortalHub {...props} />
  </ErrorBoundary>
));
