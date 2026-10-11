/**
 * sdr-performance-entry.jsx
 *
 * The React SDR Performance drill-down, exposed to the Vanilla JS shell as
 * window.SdrPerformanceHub (see hub-entry.jsx for the mount contract).
 *
 * Reached only from Leaderboard's onOpenPerson — a name click — and from the
 * legacy leaderboard.js fallback's own equivalent link. Read-only: no writes,
 * so unlike most islands there is no crash-fallback to a classic page, only
 * the shared component-level error boundary.
 *
 * Props accepted from Vanilla JS:
 *   sdrId   {string}   the person whose performance to show
 *   onBack  {function} navigates back to Leaderboard
 *   apiBase {string}   backend origin, sets window.__CRM_API_BASE__
 */
import { SdrPerformanceHub } from './features/sdr-performance/SdrPerformanceHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './sdr-performance-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading this SDR's performance.</p>
  </div>
);

registerHub('SdrPerformanceHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <SdrPerformanceHub {...props} />
  </ErrorBoundary>
));
