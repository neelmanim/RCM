import React, { useState } from 'react';
import { ConfirmDialog } from '../../components/ui/Modal';
import { SalesJourneyService } from '../../services/api';

/** The confirm step after a cadence is picked: checks each lead's sending
 *  mailbox first (the same sender resolution the real send uses), so a
 *  broken mailbox shows before enrolling instead of as a failed enrollment
 *  later. Returns `start(journey)` and the dialog to render. */
export function useEnrollInCadence({ leadIds, onToast, onDone }) {
  const [target, setTarget] = useState(null);       // journey pending confirmation
  const [warnings, setWarnings] = useState(null);   // null = still checking
  const [busy, setBusy] = useState(false);
  const count = leadIds.length;

  const start = (journey) => {
    if (count > 200) {
      onToast?.('Enroll in Cadence supports up to 200 leads at a time — narrow your selection.', 'error');
      return;
    }
    setTarget(journey);
    setWarnings(null);
    SalesJourneyService.checkEnrollmentMailboxes(journey.id, leadIds)
      .then((r) => setWarnings(r.warnings))
      .catch(() => setWarnings([])); // non-blocking — a failed check shouldn't block enrolling
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await SalesJourneyService.enroll(target.id, leadIds);
      const blocked = r.skipped.filter((x) => x.reason === 'reenrollment_not_allowed');
      if (count === 1) {
        const why = blocked[0]?.detail;
        onToast?.(r.enrolled ? `Enrolled in "${target.name}"`
          : why ? `Not enrolled — ${why}` : `Already in "${target.name}" — nothing changed`,
        r.enrolled ? 'success' : 'info');
      } else {
        onToast?.(`Enrolled ${r.enrolled}/${r.requested} lead(s) into "${target.name}"` +
          (r.skipped.length ? ` — ${r.skipped.length} skipped` : '') +
          (blocked.length ? ` (${blocked.length} already went through it; re-enrollment is off or waiting)` : ''), 'success');
      }
      setTarget(null);
      onDone?.(r);
    } catch (err) {
      onToast?.(err?.response?.data?.detail || 'Failed to enroll — please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <ConfirmDialog
      open={!!target}
      onClose={() => setTarget(null)}
      title="Enroll in Cadence"
      message={target ? (count === 1 ? `Enroll this lead into "${target.name}"?` : `Enroll ${count} lead(s) into "${target.name}"?`) : ''}
      confirmLabel="Enroll"
      onConfirm={confirm}
      loading={busy}
    >
      {warnings?.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-1">
          {warnings.map((w, i) => (
            <div key={w.lead_id || i}>
              ⚠ {w.detail || (
                <>
                  {w.sender_name}'s mailbox isn't connected{w.mailbox_status ? ` (${w.mailbox_status.replace(/_/g, ' ')})` : ''}
                  {w.falls_back_to ? ` — will fall back to ${w.falls_back_to}` : ' — this lead will likely fail to send'}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </ConfirmDialog>
  );

  return { start, dialog };
}
