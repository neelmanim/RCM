/**
 * email-entry.jsx
 *
 * The React Email Hub, exposed to lead_detail.js as window.EmailHub (see
 * hub-entry.jsx for the mount contract).
 *
 * Props accepted from Vanilla JS (lead_detail.js):
 *   leadId   {string}  Lead UUID
 *   lead     {object}  Lead object (name, email, etc.)
 *   token    {string}  JWT from localStorage('crm_token')
 *   apiBase  {string}  Backend origin e.g. https://api.alternatecrm.staging.in
 */
import { EmailHub } from './pages/Email/EmailHub';
import { registerHub } from './hub-entry';

registerHub('EmailHub', (props) => <EmailHub {...props} />);
