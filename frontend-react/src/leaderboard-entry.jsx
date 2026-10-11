/**
 * leaderboard-entry.jsx
 *
 * The React Leaderboard Hub, exposed to the Vanilla JS shell as
 * window.LeaderboardHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT — forwarded via the shared axios client
 *   userRole  {string}  e.g. 'Super Admin' — drives the admin-only SDR/AE
 *                       tabs and the Pod Admin scope toggle. Open to every
 *                       role (nav roles: ['all']); the backend scopes rows.
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 *   userId    {string}  the viewer's own id — for the "You" highlight and the
 *                       SDR-sees-only-own-performance rule.
 *   onOpenPerson {fn}   (personId) => void — navigate to that person's
 *                       performance dashboard. Passed in rather than calling
 *                       window._loadView directly, so the component stays
 *                       independent of the vanilla shell's router.
 */
import { LeaderboardHub } from './features/leaderboard/LeaderboardHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './leaderboard-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading Leaderboard.</p>
  </div>
);

registerHub('LeaderboardHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <LeaderboardHub {...props} />
  </ErrorBoundary>
));
