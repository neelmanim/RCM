import React from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { resolveLeadPhone } from '../columns';

// Statuses where a quick-call from the list actually makes sense — matches
// classic's gate exactly (after these, the SDR should be doing something
// else next, not re-dialing from the list). Exported so the Power Dialer
// queue (usePowerDialerQueue.js) filters on the exact same set — single
// source of truth, not a second copy that can drift.
export const CALLABLE_STATUSES = ['Lead Assigned', 'Research', 'Calling'];

/** Phone column — resolves phone/phone_secondary/company_phone and offers a
 * quick-call button to non-admins on a lead in a callable status. */
export function PhoneCell({ lead, isAdmin, onQuickCall }) {
  const phone = resolveLeadPhone(lead);

  if (!phone) {
    return (
      <span className="inline-flex items-center gap-1 text-slate-400 text-xs">
        <PhoneOff size={12} strokeWidth={2.25} /> No Phone
      </span>
    );
  }

  const canCall = !isAdmin && CALLABLE_STATUSES.includes(lead.status);

  return (
    <>
      <span className="font-mono text-xs">{phone}</span>
      {canCall && (
        <button
          type="button"
          title={`Call ${phone}`}
          onClick={() => onQuickCall(lead)}
          className="w-6 h-6 ml-0.5 inline-flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 align-middle"
        >
          <Phone size={13} strokeWidth={2.25} />
        </button>
      )}
    </>
  );
}
