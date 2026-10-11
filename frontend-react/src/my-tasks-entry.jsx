/**
 * my-tasks-entry.jsx
 *
 * The React My Tasks Hub, exposed to the Vanilla JS shell as
 * window.MyTasksHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS (app.js):
 *   token       {string}   JWT from localStorage('crm_token')
 *   apiBase     {string}   backend origin, sets window.__CRM_API_BASE__
 *   onLeadClick {function} navigates to the Lead Detail page for a lead
 *                          (same contract as PowerDialerHub's own prop)
 *
 * Access control: GET /api/my/tasks scopes to the current user's own tasks
 * server-side (models.Task.user_id == current user) — there is no role
 * gate, every authenticated user can have tasks assigned to them.
 */
import { MyTasksHub } from './features/my-tasks/MyTasksHub';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './my-tasks-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading My Tasks.</p>
  </div>
);

registerHub('MyTasksHub', (props) => (
  <ErrorBoundary fallback={crashFallback}>
    <MyTasksHub {...props} />
  </ErrorBoundary>
));
