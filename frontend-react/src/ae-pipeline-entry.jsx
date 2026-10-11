/**
 * ae-pipeline-entry.jsx
 *
 * The React AE Pipeline Hub, exposed to the Vanilla JS shell as
 * window.AEPipelineHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT — forwarded via the shared axios client
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 *
 * Access control is entirely server-side (GET /api/ae-pipeline/opportunities
 * scopes AE to their own rows, admins see all, SDR gets 403) — same trust
 * boundary as SdrPerformanceHub, so no role prop is needed here.
 */
import { AEPipelineHub } from './features/ae-pipeline/AEPipelineHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './ae-pipeline-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading AE Pipeline.</p>
  </div>
);

registerHub('AEPipelineHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <AEPipelineHub {...props} />
  </ErrorBoundary>
));
