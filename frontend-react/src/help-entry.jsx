/**
 * help-entry.jsx
 *
 * The React Help Hub, exposed to the Vanilla JS shell as window.HelpHub
 * (see hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS:
 *   userRole  {string}  'Super Admin' | 'Pod Admin' | 'SDR' | 'AE'
 *   apiBase   {string}  backend origin, sets window.__CRM_API_BASE__ (unused
 *                       today — no API calls in this bundle — but set for
 *                       consistency with every other hub's mount contract)
 */
import { HelpHub } from './features/help-hub/HelpHub';
import './help-tailwind.css';
import { registerHub } from './hub-entry';

registerHub('HelpHub', (props) => <HelpHub {...props} />);
