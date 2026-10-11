/**
 * calendar-entry.jsx
 *
 * The React Calendar Hub, exposed to the Vanilla JS shell as
 * window.CalendarHub (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   token     {string}  JWT from localStorage('crm_token')
 *   userRole  {string}  e.g. 'Super Admin', 'Pod Admin', 'SDR'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__
 */
import { CalendarHub } from './pages/Calendar/CalendarHub';
import './calendar-tailwind.css';
import { registerHub } from './hub-entry';

registerHub('CalendarHub', (props) => <CalendarHub {...props} />);
