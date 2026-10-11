/**
 * daily-digest-entry.jsx
 *
 * The React Team Digest Hub (formerly Daily Digest), exposed to the Vanilla JS shell as
 * window.DailyDigestHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT — forwarded via the shared axios client
 *   userRole  {string}  e.g. 'Super Admin' — access is already gated by
 *                       app.js before mount, same as Activity Monitor;
 *                       not re-checked here.
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 */
import { DailyDigestHub } from './features/daily-digest/DailyDigestHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './daily-digest-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading Team Digest.</p>
  </div>
);

registerHub('DailyDigestHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <DailyDigestHub {...props} />
  </ErrorBoundary>
));
