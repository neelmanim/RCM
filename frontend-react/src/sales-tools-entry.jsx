/**
 * sales-tools-entry.jsx
 *
 * The React Sales Tools Hub, exposed to the Vanilla JS shell as
 * window.SalesToolsHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   userRole  {string}  e.g. 'Super Admin' — passed straight through to the
 *                       embedded Cadence tab (Sales Journey), same gate it
 *                       already enforced as a standalone nav entry.
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 */
import { SalesToolsHub } from './features/sales-tools/SalesToolsHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './sales-tools-tailwind.css';
// ponytail: also pulls in sales-journey-tailwind.css's full @tailwind
// utilities a second time (tailwind.config.js scans the whole src/ tree per
// bundle, so every hub's CSS entry already regenerates the complete utility
// set) — needed only for its .salesjourney-hub border/button-reset rules,
// which JourneyList.jsx/JourneyBuilder.jsx's own root divs still reference
// unchanged. Gzips away almost entirely (near-exact repeated content); not
// worth hand-splitting the file to avoid a few KB of duplicate CSS.
import './sales-journey-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading Sales Tools.</p>
  </div>
);

registerHub('SalesToolsHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <SalesToolsHub {...props} />
  </ErrorBoundary>
));
