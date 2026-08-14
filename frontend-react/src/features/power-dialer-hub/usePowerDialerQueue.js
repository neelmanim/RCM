import { useState, useEffect, useCallback } from 'react';
import { LeadsService, DialerService } from '../../services/api';
import { CALLABLE_STATUSES } from '../leads-hub/components/PhoneCell';

// Server status values (models.DialerQueueStatus) <-> the frontend's own
// vocabulary (QueueList's STATUS_BADGE) — kept distinct on both ends so a
// compliance-relevant DNC skip is never collapsed into an ordinary one.
const FROM_SERVER = { called: 'called', skipped: 'skipped-manual', skipped_dnc: 'skipped-dnc' };
const TO_SERVER = { called: 'called', 'skipped-manual': 'skipped', 'skipped-dnc': 'skipped_dnc' };

/**
 * Owns the Power Dialer's queue state. Fetches once on mount (+ an explicit
 * manual refresh) — never on a timer. Progress (called/skipped/skip reason)
 * is persisted server-side per lead+rep (see models.DialerQueueStatus) —
 * 2026-08-10 review: an ephemeral client-only Map couldn't survive a reload,
 * and a "called" lead had no way to drop off the next fetch, so the queue
 * could never run dry on its own even once genuinely finished.
 *
 * sessionStatus values: 'called' | 'skipped-manual' | 'skipped-dnc'.
 */
export function usePowerDialerQueue() {
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionStatus, setSessionStatus] = useState(() => new Map());
  const [skipReasons, setSkipReasons] = useState(() => new Map()); // leadId -> rep's own reason, manual skips only
  const [callNextEnabled, setCallNextEnabled] = useState(false);
  const [totalAvailable, setTotalAvailable] = useState(0); // callable leads matching the filter, server-side — may exceed queue.length (per_page=50)
  const [hideCalled, setHideCalled] = useState(false); // client-side filter: drop leads someone has already logged a call against
  const [statusFilter, setStatusFilter] = useState(CALLABLE_STATUSES); // which callable stages to include — server-side
  const [search, setSearch] = useState(''); // name/company/email/phone — server-side (GET /leads' own `search` param)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await LeadsService.getLeads({
        status: statusFilter.length ? statusFilter : CALLABLE_STATUSES, // never send an empty list — that's "all", not "none"
        search: search || undefined,
        sort_by: 'priority',
        sort_dir: 'desc',
        per_page: 50,
        exclude_dialer_done: true,
      });
      // totalAvailable is the server-side total before this filter — an
      // honest approximation when hideCalled is on, not an exact remaining count.
      const leads = hideCalled ? (res.data || []).filter(l => !l.last_call_outcome) : (res.data || []);
      setQueue(leads);
      setTotalAvailable(res.total ?? leads.length);
      setCallNextEnabled(false);

      let restored = new Map();
      let restoredReasons = new Map();
      if (leads.length) {
        try {
          const statuses = await DialerService.getQueueStatus(leads.map(l => l.id));
          const entries = Object.entries(statuses).filter(([, v]) => FROM_SERVER[v.status]);
          restored = new Map(entries.map(([leadId, v]) => [leadId, FROM_SERVER[v.status]]));
          restoredReasons = new Map(
            entries.filter(([, v]) => v.skip_reason).map(([leadId, v]) => [leadId, v.skip_reason])
          );
        } catch {
          // Non-fatal — worst case the queue just re-shows already-skipped
          // leads as Pending this one time; the fetch itself still succeeded.
        }
      }
      setSessionStatus(restored);
      setSkipReasons(restoredReasons);
      // First lead with no persisted status is where the rep actually left off.
      const resumeAt = leads.findIndex(l => !restored.has(l.id));
      setCurrentIndex(resumeAt === -1 ? leads.length : resumeAt);
    } catch {
      setError('Failed to load your call queue.');
    } finally {
      setLoading(false);
    }
  }, [hideCalled, statusFilter, search]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const persistStatus = useCallback((leadId, status, skipReason) => {
    DialerService.setQueueStatus(leadId, TO_SERVER[status], skipReason).catch(() => {
      // Best-effort — see fetchQueue's restore catch. A failed persist only
      // costs "this lead re-shows as Pending after a reload", not data loss.
    });
  }, []);

  // Pre-filter DNC/unsubscribed leads — skip automatically, no call attempt,
  // no waiting on Call Next. This is a UX nicety only: the actual
  // enforcement is the backend gate in dialer_service.initiate_call, which
  // always re-checks live DB state even if this client-side copy is stale.
  useEffect(() => {
    const lead = queue[currentIndex];
    if (!lead) return;
    if (lead.do_not_contact || lead.unsubscribed_at) {
      setSessionStatus(prev => new Map(prev).set(lead.id, 'skipped-dnc'));
      persistStatus(lead.id, 'skipped-dnc');
      setCurrentIndex(i => i + 1);
    }
  }, [queue, currentIndex, persistStatus]);

  // The one signal for "the SDR just finished with this call" — fired from
  // modals.js (Save, Aircall auto-sync) and app.js (dismiss). Re-enables
  // Call Next only when it matches the lead the queue is currently on.
  useEffect(() => {
    function handleResolved(e) {
      const { leadId } = e.detail || {};
      const lead = queue[currentIndex];
      if (!lead || lead.id !== leadId) return;
      setSessionStatus(prev => new Map(prev).set(leadId, 'called'));
      persistStatus(leadId, 'called');
      setCallNextEnabled(true);
    }
    window.addEventListener('rcm:call-outcome-resolved', handleResolved);
    return () => window.removeEventListener('rcm:call-outcome-resolved', handleResolved);
  }, [queue, currentIndex, persistStatus]);

  const callNext = useCallback(() => {
    setCallNextEnabled(false);
    setCurrentIndex(i => i + 1);
  }, []);

  // Always available, independent of call/outcome state — the escape hatch
  // for "this attempt didn't work out" (call never connected, wrong number,
  // etc.). Must never be gated behind a successful call. reason is optional
  // (rep's own words) — Skip itself must stay a single, frictionless click.
  const skip = useCallback((reason) => {
    const lead = queue[currentIndex];
    if (!lead) return;
    setSessionStatus(prev => new Map(prev).set(lead.id, 'skipped-manual'));
    if (reason) setSkipReasons(prev => new Map(prev).set(lead.id, reason));
    persistStatus(lead.id, 'skipped-manual', reason);
    setCallNextEnabled(false);
    setCurrentIndex(i => i + 1);
  }, [queue, currentIndex, persistStatus]);

  // Requeue a skipped lead — nothing today auto-expires a skip (see
  // usePowerDialerQueue's own header note + models.DialerQueueStatus), so
  // this is the only way a rep gets a skipped lead back into rotation
  // without leaving the hub. Moves it to right after the current lead.
  const callBack = useCallback((leadId) => {
    const fromIndex = queue.findIndex(l => l.id === leadId);
    if (fromIndex === -1 || fromIndex >= currentIndex) return;
    DialerService.clearQueueStatus(leadId).catch(() => {});
    setSessionStatus(prev => { const next = new Map(prev); next.delete(leadId); return next; });
    setSkipReasons(prev => { const next = new Map(prev); next.delete(leadId); return next; });
    setQueue(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(currentIndex, 0, moved);
      return next;
    });
    setCurrentIndex(i => i - 1);
  }, [queue, currentIndex]);

  // Reorder the *upcoming* portion of the queue only — dragging the
  // currently-active lead out from under itself has no sensible meaning.
  // Session-only (not persisted): manual mid-queue reordering has little
  // precedent outside Aircall's own dialer (see 2026-08-10 market research),
  // so it isn't worth a durable ordering model — priority_score sort is
  // what survives a reload, this is just a same-session convenience.
  const reorderUpcoming = useCallback((fromIndex, toIndex) => {
    setQueue(prev => {
      if (fromIndex <= currentIndex || toIndex <= currentIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [currentIndex]);

  const currentLead = queue[currentIndex] || null;
  const upcoming = queue.slice(currentIndex + 1);
  const isDone = queue.length > 0 && currentIndex >= queue.length;

  return {
    queue, currentIndex, currentLead, upcoming, isDone, totalAvailable,
    sessionStatus, skipReasons, callNextEnabled,
    hideCalled, setHideCalled, statusFilter, setStatusFilter, search, setSearch,
    loading, error,
    callNext, skip, reorderUpcoming, callBack,
    refresh: fetchQueue,
  };
}
