/**
 * dashboard-entry.jsx
 *
 * The React Dashboard, exposed to the Vanilla JS shell as
 * window.DashboardHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from the Vanilla JS shell (app.js):
 *   token      {string}  JWT from localStorage('crm_token')
 *   userRole   {string}  'Super Admin' | 'Pod Admin' | 'SDR' | 'AE'
 *   podId      {number?} Pod ID for Pod Admin scoping
 *   apiBase    {string}  Backend origin, e.g. 'https://crm-api.onrender.com'
 *   onLeadClick     {fn} (id) => void  — fires loadView('lead-detail', id)
 *   onNavigate      {fn} (view) => void — fires loadView(view)
 *
 * Mixpanel: window.mixpanel is initialised by the CDN stub in index.html with
 * autocapture + session recording enabled. DO NOT call mixpanel.init() here —
 * it causes the "already downloaded" double-init warning. The mp.js wrapper
 * (frontend/js/mp.js) reads window.mixpanel directly.
 */
import { Dashboard } from './pages/Dashboard';
import './dashboard-tailwind.css';
import { registerHub } from './hub-entry';

registerHub('DashboardHub', (props) => <Dashboard {...props} />);
