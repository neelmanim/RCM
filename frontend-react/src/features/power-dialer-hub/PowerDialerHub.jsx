import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, PhoneOff } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { SearchInput } from '../../components/ui/SearchInput';
import { Checkbox } from '../../components/ui/Checkbox';
import { Skeleton, SkeletonCard, SkeletonCallRow } from '../../components/ui/Skeleton';
import { usePowerDialerQueue } from './usePowerDialerQueue';
import { CurrentCallCard } from './components/CurrentCallCard';
import { QueueList } from './components/QueueList';
import { TodayStatsPanel } from './components/TodayStatsPanel';
import { SkipReasonsPanel } from './components/SkipReasonsPanel';
import { GuidedTour } from './GuidedTour';
import { CALLABLE_STATUSES } from '../leads-hub/components/PhoneCell';
import { SalesJourneyService, CallListsService } from '../../services/api';

const STATUS_LABELS = { 'Lead Assigned': 'New', Research: 'Research', Calling: 'Calling' };
const ADMIN_ROLES = ['Super Admin', 'Admin', 'Pod Admin'];
const SEQUENCE_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'account', label: 'Account (group by company)' },
];

// Mirrors CurrentCallCard's shape + a few queue rows below it — same
// SkeletonCard/SkeletonCallRow primitives every other hub's loading state
// already uses (see components/ui/Skeleton.jsx's CallsSkeleton), not a
// bespoke loading treatment for just this page.
function QueueSkeleton() {
  return (
    <div className="space-y-5">
      <SkeletonCard>
        <div className="flex items-center gap-4 mb-5">
          <Skeleton className="w-14 h-14 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
      </SkeletonCard>
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonCallRow key={i} />)}
      </div>
    </div>
  );
}

/**
 * Replaces the classic "Today's Calls" view. Two panes: the dialing queue
 * (current lead + upcoming) on the left, today's call history/stats on the
 * right — both live on screen at once, per the confirmed decision.
 */
export function PowerDialerHub({ onLeadClick, userRole }) {
  const {
    queue, currentIndex, currentLead, isDone, totalAvailable,
    sessionStatus, skipReasons, callNextEnabled,
    hideCalled, setHideCalled, statusFilter, setStatusFilter, search, setSearch,
    sequenceMode, setSequenceMode, journeyId, setJourneyId,
    callListId, setCallListId,
    loading, error,
    callNext, skip, reorderUpcoming, callBack, refresh: refreshQueue,
  } = usePowerDialerQueue();
  const remaining = queue.length - currentIndex;
  const moreWaiting = totalAvailable - queue.length;

  // "Load from Cadence" — GET /journeys is Pod Admin+ only today, so this
  // stays admin-gated rather than opening a new endpoint just for SDRs.
  const canLoadFromCadence = ['Super Admin', 'Admin', 'Pod Admin'].includes(userRole);
  const [journeys, setJourneys] = useState([]);
  useEffect(() => {
    if (!canLoadFromCadence) return;
    SalesJourneyService.list().then(setJourneys).catch(() => setJourneys([]));
  }, [canLoadFromCadence]);

  // Call Lists — unlike "Load from Cadence" above, available to every role
  // (no role gate on GET /call-lists): the actual gap this feature closes.
  const [callLists, setCallLists] = useState(null); // null = not yet loaded
  const [callListsNotice, setCallListsNotice] = useState('');
  const refreshCallLists = () =>
    CallListsService.list().then(res => setCallLists(res.call_lists || [])).catch(() => setCallLists([]));
  useEffect(() => { refreshCallLists(); }, []);
  // A list selected earlier this session may have since been deleted by
  // someone else — fall back to "All leads" instead of silently dialing an
  // empty queue with a stale filter still shown as selected. callLists is
  // re-fetched on every manual Refresh (see `refresh` below), so this check
  // actually has fresh data to catch a mid-session deletion against, not
  // just the one snapshot from mount. `callLists === null` (not yet loaded)
  // must NOT count as "deleted" — only a loaded-but-missing list does.
  useEffect(() => {
    if (!callListId || callLists === null) return;
    if (!callLists.some(cl => cl.id === callListId)) {
      setCallListId('');
      setCallListsNotice('That Call List no longer exists — showing all leads.');
    }
  }, [callListId, callLists, setCallListId]);
  const refresh = () => { refreshQueue(); refreshCallLists(); };
  useEffect(() => {
    if (!callListsNotice) return;
    const t = setTimeout(() => setCallListsNotice(''), 4500);
    return () => clearTimeout(t);
  }, [callListsNotice]);

  // Today's real total (server-side, from GET /api/my/today-calls via
  // TodayStatsPanel) — deliberately NOT the session-local calledThisSession
  // below, which resets to 0 on every remount/refresh. A headline number
  // that says "0 calls today" to a rep who's already made 8 would be a
  // regression, not a redesign.
  const [todayTotal, setTodayTotal] = useState(null);

  // Debounced free-text filter — GET /leads' own `search` param (name,
  // company, email, phone), not a client-side re-implementation. 450ms, not
  // 300 — 2026-08-10 review: a shorter delay re-fired mid-keystroke often
  // enough that the queue felt like it was "already searching" before the
  // rep finished typing.
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 450);
    return () => clearTimeout(id);
  }, [searchInput, setSearch]);

  function toggleStatus(status) {
    setStatusFilter(prev => {
      if (prev.includes(status)) {
        return prev.length > 1 ? prev.filter(s => s !== status) : prev; // never end up with none selected
      }
      return [...prev, status];
    });
  }

  // Real pace, not a fixed count: calls actually logged since this page was
  // opened, projected against the leads left in the fetched page. Resets
  // whenever the hub itself remounts — "since I opened this today," not a
  // company-wide metric.
  const sessionStartRef = useRef(Date.now());
  const calledThisSession = Array.from(sessionStatus.values()).filter(s => s === 'called').length;
  const minutesElapsed = (Date.now() - sessionStartRef.current) / 60000;
  const callsPerHour = calledThisSession >= 2 && minutesElapsed >= 2 ? calledThisSession / (minutesElapsed / 60) : null;
  const etaMinutes = callsPerHour && remaining > 0 ? Math.round((remaining / callsPerHour) * 60) : null;

  return (
    <div className="powerdialerhub w-full max-w-[1600px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-xl font-bold text-slate-800 m-0">Power Dialer</h1>
            <p className="text-sm text-slate-500 mt-1">
              {queue.length > 0 && (
                <>
                  {currentIndex} of {queue.length} worked through · {Math.max(remaining, 0)} left
                  {moreWaiting > 0 && <span className="text-slate-400"> (+{moreWaiting} more waiting — Refresh to pull them in)</span>}
                  {etaMinutes != null && <span className="text-slate-400"> · ~{etaMinutes}m left at your current pace</span>}
                </>
              )}
            </p>
          </div>
          {todayTotal != null && (
            <div className="text-center px-5 border-l border-slate-200">
              <div className="text-2xl font-bold text-blue-600 tabular-nums">{todayTotal}</div>
              <div className="text-xs text-slate-500 whitespace-nowrap">calls today</div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <SearchInput
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name, company, phone…"
          className="w-56"
        />
        <div className="flex items-center gap-3">
          {CALLABLE_STATUSES.map(s => (
            <Checkbox key={s} checked={statusFilter.includes(s)} onChange={() => toggleStatus(s)} label={STATUS_LABELS[s] || s} />
          ))}
        </div>
        <Checkbox checked={hideCalled} onChange={(e) => setHideCalled(e.target.checked)} label="Hide already-called" />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          Sequence:
          <Select
            value={sequenceMode}
            onChange={setSequenceMode}
            options={SEQUENCE_OPTIONS}
            placeholder="Priority"
          />
        </label>
        {canLoadFromCadence && journeys.length > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            Cadence:
            <Select
              value={journeyId}
              onChange={setJourneyId}
              options={[{ value: '', label: 'All leads' }, ...journeys.map(j => ({ value: j.id, label: j.name }))]}
              placeholder="All leads"
              className="max-w-[220px]"
            />
          </label>
        )}
        {callLists?.length > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            Call List:
            <Select
              value={callListId}
              onChange={setCallListId}
              options={[{ value: '', label: 'All leads' }, ...callLists.map(cl => ({ value: cl.id, label: `${cl.name} (${cl.lead_count})` }))]}
              placeholder="All leads"
              className="max-w-[220px]"
            />
          </label>
        )}
      </div>
      {callListsNotice && (
        <div className="fixed left-6 bottom-6 z-[60] max-w-[340px] bg-white border border-slate-200 shadow-xl rounded-xl px-4 py-3 text-xs text-slate-700">
          {callListsNotice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-5">
        {/* Only the very first load (nothing to show yet) gets the skeleton
            treatment. A search/filter-triggered re-fetch dims the EXISTING
            content instead of yanking it away and flashing back in —
            2026-08-10 review: hiding CurrentCallCard/QueueList on every
            `loading` tick (including background re-fetches) made typing in
            the search box look like the whole card kept disappearing. */}
        <div className={`flex flex-col gap-5 min-w-0 transition-opacity duration-150 ${loading && queue.length > 0 ? 'opacity-50' : ''}`}>
          {loading && queue.length === 0 && <QueueSkeleton />}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</div>
          )}

          {!loading && !error && queue.length === 0 && (
            <div className="flex flex-col items-center gap-2 text-center py-16 text-slate-400">
              <PhoneOff size={28} />
              <div className="text-sm">No leads to call right now.</div>
            </div>
          )}

          {currentLead && (
            <CurrentCallCard
              lead={currentLead}
              callNextEnabled={callNextEnabled}
              onCallNext={callNext}
              onSkip={skip}
              onLeadClick={onLeadClick}
            />
          )}

          {isDone && (
            <div className="flex flex-col items-center gap-2 text-center py-10 text-slate-500 bg-slate-50 rounded-xl">
              <div className="text-base font-semibold text-slate-700">You've worked through today's queue!</div>
              <Button variant="secondary" size="sm" onClick={refresh}>Check for more leads</Button>
            </div>
          )}

          {queue.length > 0 && (
            <div data-tour="queue-list">
              <QueueList
                queue={queue}
                currentIndex={currentIndex}
                sessionStatus={sessionStatus}
                skipReasons={skipReasons}
                onReorderUpcoming={reorderUpcoming}
                onLeadClick={onLeadClick}
                onCallBack={callBack}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <TodayStatsPanel onTotalChange={setTodayTotal} />
          {ADMIN_ROLES.includes(userRole) && <SkipReasonsPanel />}
        </div>
      </div>

      {currentLead && <GuidedTour />}
    </div>
  );
}
