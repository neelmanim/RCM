import { useEffect, useState } from 'react';

// Whether this user may download data (CSV / Excel). The server is the real guard — every export route refuses without
// users.export_enabled — this only decides whether to SHOW the export buttons, so nobody is offered something that will say no.
// The shell (frontend/js/app.js) loads /api/me/capabilities live from the database and publishes it here; until it has answered
// the answer is "no" (fail closed), so a button never flashes up for someone who may not use it.
export const canExportNow = () => window.__CRM_CAPS__?.export === true;

export function useCanExport() {
  const [can, setCan] = useState(canExportNow);
  useEffect(() => {
    const update = () => setCan(canExportNow());
    update();
    window.addEventListener('alternate:caps', update);
    return () => window.removeEventListener('alternate:caps', update);
  }, []);
  return can;
}
