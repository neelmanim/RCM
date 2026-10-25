import { useState, useEffect, useCallback, useRef } from 'react';
import { LeadsService, DialerService } from '../../services/api';
import { CALLABLE_STATUSES } from '../leads-hub/components/PhoneCell';

// RCA 2026-08-31: app.js unmounts Power Dialer on ANY navigation away (e.g.
// "View in CRM" on the current call), so returning to the dialer always
// re-ran fetchQueue() from scratch. A fresh server-side re-sort between
// those two fetches (someone's priority_score/account grouping shifted,
// even for leads this rep never touched) can put a different lead "next"
// than the one on screen a moment ago — reported as leads "getting
// shuffled while dialing". sessionStorage — not a bare module variable —
// survives that same-tab remount and clears on tab close with no need for
// an invented TTL, the identical need leads-hub's useLeadsList.js already
// solves this way (see its VIEW_STATE_KEY).
const QUEUE_STATE_KEY = 'powerDialer.queueState';

function loadQueueState() {
  try {
    const raw = window.sessionStorage.getItem(QUEUE_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      queue: parsed.queue,
      currentIndex: parsed.currentIndex,
      sessionStatus: new Map(parsed.sessionStatus),
      skipReasons: new Map(parsed.skipReasons),
    };
  } catch {
    return null;
  }
}

function persistQueueState(state) {
  try {
    window.sessionStorage.setItem(QUEUE_STATE_KEY, JSON.stringify({
      queue: state.queue,
      currentIndex: state.currentIndex,
      sessionStatus: Array.from(state.sessionStatus.entries()),
      skipReasons: Array.from(state.skipReasons.entries()),
    }));
  } catch { /* storage unavailable — just won't restore across a remount */ }
}

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
  const restoredState = loadQueueState();
  const didInit = useRef(false);

  const [queue, setQueue] = useState(restoredState ? restoredState.queue : []);
  const [currentIndex, setCurrentIndex] = useState(restoredState ? restoredState.currentIndex : 0);
  const [sessionStatus, setSessionStatus] = useState(() => restoredState ? restoredState.sessionStatus : new Map());
  const [skipReasons, setSkipReasons] = useState(() => restoredState ? restoredState.skipReasons : new Map()); // leadId -> rep's own reason, manual skips only
  const [callNextEnabled, setCallNextEnabled] = useState(false);
  const [totalAvailable, setTotalAvailable] = useState(0); // callable leads matching the filter, server-side — may exceed queue.length (per_page=50)
  const [hideCalled, setHideCalled] = useState(false); // client-side filter: drop leads someone has already logged a call against
  const [statusFilter, setStatusFilter] = useState(CALLABLE_STATUSES); // which callable stages to include — server-side
  const [search, setSearch] = useState(''); // name/company/email/phone — server-side (GET /leads' own `search` param)
  // RCA 2026-08-17: Himanshu asked whether the dialer sequence is
  // contact-wise or account-wise — it was neither, pure priority_score with
  // no company tiebreak. 'account' groups all contacts at the same company
  // consecutively (see lead_routes.py's sort_by=account); 'priority' is the
  // unchanged default.
  const [sequenceMode, setSequenceMode] = useState('priority'); // 'priority' | 'account'
  // "Load from Cadence" queue source (stakeholder ask: pull a cadence's
  // actively-enrolled leads into the dialer for a manual call step) — when
  // set, ANDs with the normal callable-status filter rather than replacing
  // it, so the queue is still "enrolled in this journey AND callable now".
  const [journeyId, setJourneyId] = useState('');
  // Call List dial source (Klenty-style selectable dial list) — available to
  // every role, unlike "Load from Cadence" above. ANDs with the normal
  // callable-status filter rather than replacing it, same as journeyId.
  const [callListId, setCallListId] = useState('');
  const [loading, setLoading] = useState(!restoredState);
  const [error, setError] = useState(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await LeadsService.getLeads({
        status: statusFilter.length ? statusFilter : CALLABLE_STATUSES, // never send an empty list — that's "all", not "none"
        search: search || undefined,
        sort_by: sequenceMode,
        sort_dir: 'desc',
        per_page: 50,
        exclude_dialer_done: true,
        journey_id: journeyId || undefined,
        call_list_id: callListId || undefined,
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
  }, [hideCalled, statusFilter, search, sequenceMode, journeyId, callListId]);

  useEffect(() => {
    // Skip only the very first fetch when sessionStorage already restored
    // state above — a later filter change (statusFilter/search/sequenceMode/
    // journeyId/callListId, all in fetchQueue's own deps) still refetches
    // normally, same as always.
    if (!didInit.current) {
      didInit.current = true;
      if (restoredState) return;
    }
    fetchQueue();
  }, [fetchQueue]);

  // Keep sessionStorage current so the next remount (e.g. returning from a
  // lead's detail page) restores exactly where this session left off.
  useEffect(() => {
    persistQueueState({ queue, currentIndex, sessionStatus, skipReasons });
  }, [queue, currentIndex, sessionStatus, skipReasons]);

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
    window.addEventListener('alternate:call-outcome-resolved', handleResolved);
    return () => window.removeEventListener('alternate:call-outcome-resolved', handleResolved);
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
    sequenceMode, setSequenceMode, journeyId, setJourneyId,
    callListId, setCallListId,
    loading, error,
    callNext, skip, reorderUpcoming, callBack,
    refresh: fetchQueue,
  };
}
