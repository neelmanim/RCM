/**
 * analytics-entry.jsx
 *
 * The React Analytics Hub, exposed to the Vanilla JS shell as
 * window.AnalyticsHub (mount / navigate / unmount / isMounted — see
 * hub-entry.jsx for the contract).
 *
 * Props accepted from Vanilla JS:
 *   token             {string}  JWT from localStorage('crm_token')
 *   userRole          {string}  e.g. 'Super Admin', 'Pod Admin'
 *   pendingQuery      {string?} Pre-filled AI query from topbar pill button
 */
import { AnalyticsHub } from './pages/Analytics/AnalyticsHub';
// Scoped Tailwind styles (components + utilities only — no base resets that
// would bleed into the Vanilla JS shell, see EC-11).
import './analytics-tailwind.css';
import { registerHub } from './hub-entry';

registerHub('AnalyticsHub', (props) => <AnalyticsHub {...props} />);
