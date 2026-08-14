import React, { useState, useEffect } from 'react';
// Reusing the existing phone-number -> IANA timezone lookup (ENH-01) instead
// of a second one — it's already used in lead_detail.js/dialer_widget.js,
// and phone-number-based resolution is more reliable here than guessing
// from city/state text anyway: Power Dialer only ever shows a lead with a
// phone number, but state/country fields are often blank or messy.
import { getPhoneTimezone } from '../../../../../frontend/js/phone_timezone.js';

const _bucket = (hour) => hour >= 8 && hour < 18 ? 'green' : (hour >= 7 && hour < 8) || (hour >= 18 && hour < 20) ? 'yellow' : 'red';
const DOT = { green: '🟢', yellow: '🟡', red: '🔴' };
const HINT = {
  green: 'Business hours',
  yellow: 'Early/late — use discretion',
  red: 'Outside office hours — avoid calling',
};

/** Live local time for a lead's phone number, same 🟢🟡🔴 business-hours
 * convention as the classic Lead Detail page's phone badge — a power dialer
 * is exactly where "don't cold-call this person at 3am their time" matters. */
export function LocalTimeBadge({ phone }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000); // matches phone_timezone.js's own cadence
    return () => clearInterval(id);
  }, []);

  const info = getPhoneTimezone(phone);
  if (!info) return null;

  const time = now.toLocaleTimeString('en-US', { timeZone: info.tz, hour: '2-digit', minute: '2-digit', hour12: true });
  const hour = parseInt(now.toLocaleString('en-US', { timeZone: info.tz, hour: 'numeric', hour12: false }), 10);
  const bucket = _bucket(hour);

  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-0.5 whitespace-nowrap"
      title={`${HINT[bucket]} · ${info.label}`}
    >
      {`${DOT[bucket]} ${time}`}
    </span>
  );
}
