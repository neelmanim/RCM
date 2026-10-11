/**
 * pipeline-hub-entry.jsx
 *
 * The React Pipeline Hub, exposed to the Vanilla JS shell as
 * window.PipelineHub (see hub-entry.jsx for the mount contract).
 *
 * Super-Admin-only merge of AE Pipeline + CSM Portal into one nav item with
 * a tab for each — see features/pipeline-hub/PipelineHub.jsx.
 *
 * Props accepted from Vanilla JS:
 *   userRole  {string}  always 'Super Admin' in practice
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 *   initialAccountId {string}  deep-link into the CSM Portal tab's Account 360
 */
import { PipelineHub } from './features/pipeline-hub/PipelineHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './pipeline-hub-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading Pipeline.</p>
  </div>
);

registerHub('PipelineHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <PipelineHub {...props} />
  </ErrorBoundary>
));
