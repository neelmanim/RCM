import React, { useState } from 'react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { fmtDate } from '../lib/formatDate';
import { JOURNEY_STATUS_LABEL, JOURNEY_STATUS_VARIANT, JOURNEY_REASON_LABEL, JOURNEY_PENDING_LABEL } from '../../sales-journey/journeyLabels';
import { SalesJourneyService } from '../../../services/api';

// Pending reasons that mean "the cadence is waiting on a person", shown
// highlighted so the rep sees it's on them (v13.7.0).
const WAITING_ON_REP = new Set(['awaiting_email_approval', 'awaiting_sms_approval', 'awaiting_rep']);

// Every enrollment, with why it's paused/exited — RCA 2026-09-29: this used
// to show only journey[0]'s raw status word, so an SDR couldn't tell why a
// cadence stalled or exited (legacy showed all of this).
function CadenceRow({ e, onJourneyChange }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(null);
  const reason = e.exited_reason && (JOURNEY_REASON_LABEL[e.exited_reason] || e.exited_reason.replace(/_/g, ' '));
  const pending = e.status === 'active' && e.pending_status
    && (JOURNEY_PENDING_LABEL[e.pending_status.reason] || e.pending_status.detail);
  const onRep = e.status === 'active' && WAITING_ON_REP.has(e.pending_status?.reason);

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await SalesJourneyService.removeEnrollment(e.enrollment_id);
      setConfirming(false);
      onJourneyChange?.();
    } catch {
      setError('Couldn’t remove the lead — please try again.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="text-sm space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-800 truncate">{e.journey_name}</span>
        <Badge variant={JOURNEY_STATUS_VARIANT[e.status]}>{JOURNEY_STATUS_LABEL[e.status] || e.status}</Badge>
      </div>
      {e.status === 'active' && (e.current_node_label || e.current_node_id) && (
        <p className="text-xs text-slate-500 m-0">Current step: {e.current_node_label || e.current_node_id}</p>
      )}
      {pending && (
        <p className={`text-xs m-0 ${onRep ? 'rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-amber-800 font-medium' : 'text-slate-500'}`}>
          {pending}
        </p>
      )}
      {reason && (
        <>
          <p className="text-xs text-slate-500 m-0">Reason: {reason}</p>
          {e.last_error && <p className="text-xs text-red-700 m-0">{e.last_error}</p>}
        </>
      )}
      {e.status === 'active' && (
        <Button variant="ghost" size="sm" className="!px-0 !py-1 text-red-600 hover:bg-transparent hover:text-red-700"
          onClick={() => { setError(null); setConfirming(true); }}>
          Remove from cadence
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remove from cadence?"
        message={`This lead stops getting any further steps of "${e.journey_name}". Open approvals and tasks for it are closed.`}
        confirmLabel="Remove"
        confirmVariant="danger"
        loading={removing}
        onConfirm={handleRemove}
      >
        {error && <p role="alert" className="text-xs text-red-600 m-0 mb-2">{error}</p>}
      </ConfirmDialog>
    </div>
  );
}

export function LeadSummary({ lead, journey = [], onJourneyChange }) {
  if (!lead) return null;

  return (
    <Card>
      <CardHeader title="Lead Summary" />
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total calls</dt>
            <dd className="text-slate-800 font-semibold m-0">{lead.call_count ?? 0}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Call attempts (all reps)</dt>
            <dd className="text-slate-800 font-semibold m-0">{lead.call_attempt_count ?? 0} / {lead.max_call_attempts ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Last contacted</dt>
            <dd className="text-slate-800 font-semibold m-0">{fmtDate(lead.last_call_timestamp)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Created</dt>
            <dd className="text-slate-800 font-semibold m-0">{fmtDate(lead.created_at)}</dd>
          </div>
        </dl>
        {journey.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider m-0">Sales Cadence</p>
            {journey.map((e) => <CadenceRow key={e.enrollment_id} e={e} onJourneyChange={onJourneyChange} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
