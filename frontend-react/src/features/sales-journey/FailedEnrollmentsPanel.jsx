import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SalesJourneyService } from '../../services/api';
import { toast } from './toast';

// Mirrors frontend/js/views/lead_detail.js's JOURNEY_REASON_LABEL — the same
// enum values are shown to SDRs there, keep both surfaces consistent.
const REASON_LABEL = {
  suppressed: 'Contact suppressed (opted out / disqualified)',
  journey_archived: 'Cadence archived',
  exceeded_max_node_passes: 'Exceeded max steps — likely a loop',
  send_failed: 'Send failed',
  manually_skipped: 'Manually skipped',
  unexpected_error: 'Unexpected error',
  cooldown_stalled: 'Blocked by another cadence for too long',
  node_not_found: 'Internal error — step no longer exists',
  unknown_node_type: 'Internal error — unsupported step type',
};

// Phase 4 dead-letter view — surfaced inline in the builder rather than a
// separate page, since an admin publishing/monitoring a journey is already
// looking at this screen when they'd want to check on failures.
export function FailedEnrollmentsPanel({ journeyId }) {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEnrollments(await SalesJourneyService.getFailedEnrollments(journeyId));
    } catch (err) {
      toast('Failed to load failed enrollments.', 'error');
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => { load(); }, [load]);

  const handleRetry = async (enrollmentId) => {
    setBusyId(enrollmentId);
    try {
      await SalesJourneyService.retryEnrollment(enrollmentId);
      toast('Enrollment re-activated.', 'success');
      await load();
    } catch (err) {
      toast('Failed to retry — please try again.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleSkip = async (enrollmentId) => {
    setBusyId(enrollmentId);
    try {
      await SalesJourneyService.skipEnrollment(enrollmentId);
      toast('Enrollment skipped.', 'success');
      await load();
    } catch (err) {
      toast('Failed to skip — please try again.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="text-sm text-slate-400 px-4 py-3">Loading failed enrollments…</p>;
  if (enrollments.length === 0) return null;

  return (
    <div className="border-t border-slate-200 bg-amber-50/50 px-4 py-3 max-h-48 overflow-y-auto shrink-0">
      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 mb-2">
        <AlertTriangle size={14} /> {enrollments.length} failed enrollment{enrollments.length > 1 ? 's' : ''}
      </div>
      <div className="space-y-1.5">
        {enrollments.map((e) => (
          <div key={e.enrollment_id} className="flex items-center justify-between gap-2 bg-white rounded-lg border border-slate-200 px-3 py-2 text-xs">
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">{e.lead_name}</span>
              <span className="text-slate-400"> — {REASON_LABEL[e.exited_reason] || e.exited_reason || 'Unknown reason'}</span>
              {e.last_error && (
                <div className="text-slate-400 truncate" title={e.last_error}>Details: {e.last_error}</div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="outline" disabled={busyId === e.enrollment_id}
                onClick={() => handleRetry(e.enrollment_id)}>
                <RotateCcw size={12} /> Retry
              </Button>
              <Button size="sm" variant="ghost" disabled={busyId === e.enrollment_id}
                onClick={() => handleSkip(e.enrollment_id)}>
                <XCircle size={12} /> Skip
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
