import { useEffect, useCallback } from 'react';

/**
 * useCallController(lead, { onOutcomeResolved })
 *
 * Deliberately does NOT reimplement the call-outcome state machine. Reuses
 * the existing global bridge: window._openCallModal (frontend/js/app.js's
 * handleCallAction, already exposed for exactly this purpose — LeadsHub.jsx
 * calls it the same way today) and the `alternate:call-outcome-resolved`
 * event modals.js already dispatches on every outcome-resolution path. See
 * the Lead Detail Hub plan §5 for the full "reuse, don't rebuild" rationale.
 */
export function useCallController(lead, { onOutcomeResolved } = {}) {
  const leadId = lead?.id;

  const startCall = useCallback((phone) => {
    if (!lead) return;
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Lead';
    const targetPhone = phone || lead.phone;
    if (typeof window._openCallModal === 'function') {
      window._openCallModal(lead.id, name, targetPhone, lead);
    } else {
      window.dispatchEvent(new CustomEvent('alternate:toast', {
        detail: { message: 'Dialer is not available right now.', type: 'error' },
      }));
    }
  }, [lead]);

  useEffect(() => {
    if (!leadId || !onOutcomeResolved) return;
    const handler = (ev) => {
      if (ev.detail?.leadId === leadId) onOutcomeResolved(ev.detail);
    };
    window.addEventListener('alternate:call-outcome-resolved', handler);
    return () => window.removeEventListener('alternate:call-outcome-resolved', handler);
  }, [leadId, onOutcomeResolved]);

  return { startCall };
}
