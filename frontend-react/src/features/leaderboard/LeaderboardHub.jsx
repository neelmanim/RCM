import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy, Users, Lock, Globe, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../components/ui/Table';
import { SortableTableHeader } from '../../components/ui/SortableTableHeader';
import { useSort } from '../../utils/useSort';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonCard, SkeletonTable } from '../../components/ui/Skeleton';
import { LeaderboardService } from '../../services/api';
import { isAdminRole } from '../../utils/roles';
import { LeaderboardTour } from './LeaderboardTour';

/**
 * Leaderboard — SDR/AE performance ranking. React port of legacy
 * frontend/js/views/leaderboard.js, built on components/ui primitives
 * (Card/Badge/Tabs/Table/EmptyState/Skeleton) instead of the inline-styled
 * innerHTML template it replaces.
 *
 * Parity carried over in full: range presets, the admin-only SDR/AE tabs
 * (with AE/SDR viewers pinned to their own board), the Pod Admin
 * My Pod / Global scope toggle persisted in sessionStorage, the top-3
 * podium, the "You" highlight, the whole metric table, and name links to a
 * person's performance page under the same visibility rule.
 */
const RANGES = [
  { value: 7, label: '7 Days' },
  { value: 30, label: '30 Days' },
  { value: 90, label: '90 Days' },
  { value: 0, label: 'All Time' },
];

const TABS = [
  { key: 'sdr', label: 'SDRs', icon: Users },
  { key: 'ae', label: 'AEs', icon: Trophy },
];

// Same sessionStorage key the legacy page used, so a Pod Admin's chosen scope
// survives the switch to this implementation instead of silently resetting.
const VIEW_STATE_KEY = 'leaderboard_view_state';

function readGlobalView() {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_STATE_KEY))?.globalView === true;
  } catch {
    return false;
  }
}

function writeGlobalView(value) {
  try {
    sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ globalView: value }));
  } catch {
    /* private-mode storage failure must not break the page */
  }
}

// Gold / silver / bronze. Kept as explicit token sets rather than an index
// lookup into Tailwind strings so each medal reads as one decision.
const PODIUM = [
  { card: 'bg-amber-50 border-amber-200', rankBg: 'bg-amber-200 text-amber-900', value: 'text-amber-600' },
  { card: 'bg-slate-50 border-slate-200', rankBg: 'bg-slate-200 text-slate-700', value: 'text-slate-600' },
  { card: 'bg-orange-50 border-orange-200', rankBg: 'bg-orange-200 text-orange-900', value: 'text-orange-700' },
];

const conversionVariant = (rate) => (rate >= 20 ? 'success' : rate >= 10 ? 'warning' : 'default');

function PodiumCard({ person, index, isMe, onOpenPerson, canOpen }) {
  const style = PODIUM[index];
  return (
    <Card className={`${style.card} ${isMe ? 'ring-2 ring-blue-500/30 border-blue-500' : ''} relative`}>
      {isMe && (
        <Badge variant="info" className="absolute top-3 right-3 uppercase tracking-wide">You</Badge>
      )}
      <CardContent>
        <div className="flex items-center gap-3.5 mb-5">
          <div className={`w-10 h-10 rounded-full ${style.rankBg} flex items-center justify-center text-lg font-extrabold shrink-0`}>
            {index + 1}
          </div>
          <div className="min-w-0">
            {canOpen ? (
              <button
                type="button"
                onClick={() => onOpenPerson(person.id)}
                className="font-bold text-base text-slate-800 truncate hover:underline text-left"
              >
                {person.name}
              </button>
            ) : (
              <div className="font-bold text-base text-slate-800 truncate" title="You can only view your own performance">
                {person.name}
              </div>
            )}
            <div className="text-xs text-slate-500 truncate">{person.pod_name || '—'}{person.left && ' · '}{person.left && <Badge variant="default" className="ml-1 !text-[9px] !px-1 !py-0.5 !rounded" title="This person has left — their access was removed">Left</Badge>}</div>
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className={`text-4xl font-extrabold leading-none tabular-nums ${style.value}`}>
            {person.meetings_scheduled}
          </span>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Meetings</span>
        </div>
        <div className="flex gap-6 mt-4 pt-3.5 border-t border-slate-200/70">
          {[
            { label: 'Today', value: person.calls_today },
            { label: 'Total Calls', value: person.total_calls },
            { label: 'Conv. Rate', value: `${person.conversion_rate}%` },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="font-bold text-sm text-slate-800 tabular-nums">{stat.value}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function LeaderboardHub({ userRole, userId, onOpenPerson }) {
  const isAdmin = isAdminRole(userRole);
  const isPodAdmin = userRole === 'Pod Admin';
  const isSdrViewer = userRole === 'SDR';

  // An AE only ever has an AE board, an SDR only an SDR board — the tab strip
  // is admin-only, so a non-admin's tab must be pinned, not merely defaulted.
  const [tab, setTab] = useState(() => (userRole === 'AE' ? 'ae' : 'sdr'));
  const [range, setRange] = useState(0);
  const [globalView, setGlobalView] = useState(readGlobalView);
  const [rows, setRows] = useState(null); // null = loading
  // Default (no sort clicked) keeps the API's own meetings-based rank order
  // and shows person.rank in the Rank column. Once a different column is
  // sorted, the Rank column switches to showing plain row position instead —
  // showing the original meetings-rank next to a table now ordered by, say,
  // Total Calls would silently misrepresent what "rank" means here.
  const [sort, toggleSort] = useSort();

  useEffect(() => {
    if (userRole === 'AE') setTab('ae');
    else if (isSdrViewer) setTab('sdr');
  }, [userRole, isSdrViewer]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const fetch = tab === 'ae' ? LeaderboardService.getAes : LeaderboardService.getSdrs;
    fetch(range, globalView)
      .then((data) => { if (!cancelled) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [tab, range, globalView]);

  const setScope = useCallback((next) => {
    writeGlobalView(next);
    setGlobalView(next);
  }, []);

  const rangeLabel = RANGES.find((r) => r.value === range)?.label || 'All Time';
  const noun = tab === 'ae' ? 'AEs' : 'SDRs';
  const loading = rows === null;

  // An SDR may only open their own performance page — same rule the legacy
  // page enforced by only attaching a click handler to their own row.
  const canOpen = useCallback(
    (personId) => !isSdrViewer || personId === userId,
    [isSdrViewer, userId],
  );

  const top3 = useMemo(() => (rows || []).slice(0, 3), [rows]);

  const SORT_ACCESSORS = {
    name: (p) => (p.name || '').toLowerCase(),
    pod: (p) => (p.pod_name || '').toLowerCase(),
    calls_today: (p) => p.calls_today || 0,
    total_calls: (p) => p.total_calls || 0,
    meetings: (p) => p.meetings_scheduled || 0,
    disqualified: (p) => p.disqualified || 0,
    total_leads: (p) => p.total_leads || 0,
    conversion_rate: (p) => p.conversion_rate || 0,
  };
  const sortedRows = useMemo(() => {
    if (!sort.key || !rows) return rows;
    const accessor = SORT_ACCESSORS[sort.key];
    const sorted = [...rows].sort((a, b) => {
      const av = accessor(a), bv = accessor(b);
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return sort.dir === 'desc' ? sorted.reverse() : sorted;
  }, [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="leaderboard-hub min-h-full bg-slate-50 px-6 py-6">
      <LeaderboardTour />

      <div className="flex items-start justify-between flex-wrap gap-4 mb-7">
        <div>
          <h1 className="text-xl font-bold text-slate-900 m-0 flex items-center gap-2">
            <Trophy size={20} className="text-amber-500" /> Leaderboard
          </h1>
          <p className="text-sm text-slate-500 mt-1 mb-0">
            {tab === 'ae' ? 'AE' : 'SDR'} performance · Ranked by meetings booked ·{' '}
            <strong className="text-slate-700">{rangeLabel}</strong>
            {isPodAdmin && !globalView && <> · <span className="font-semibold text-indigo-600">My Pod</span></>}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* Pod Admin scope toggle */}
          {isPodAdmin && (
            <div
              className="inline-flex rounded-full border-[1.5px] border-indigo-600 overflow-hidden"
              role="group"
              aria-label="Leaderboard scope"
              data-tour="leaderboard-scope"
            >
              {[
                { value: false, label: 'My Pod', icon: Lock, title: "Show only your pod's people" },
                { value: true, label: 'Global', icon: Globe, title: 'Show everyone' },
              ].map((opt) => {
                const Icon = opt.icon;
                const on = globalView === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    title={opt.title}
                    aria-pressed={on}
                    onClick={() => setScope(opt.value)}
                    className={`flex items-center gap-1.5 px-3.5 py-1 text-xs font-semibold transition-colors ${
                      on ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={11} /> {opt.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* SDR/AE tabs — admins only; everyone else is pinned to their own board */}
          {isAdmin && (
            <div data-tour="leaderboard-tabs">
              <Tabs tabs={TABS} active={tab} onChange={setTab} />
            </div>
          )}

          <div className="flex items-center gap-1.5" data-tour="leaderboard-range">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                onClick={() => setRange(r.value)}
                className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                  range === r.value
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
            {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
          </div>
          <Card><SkeletonTable rows={5} cols={9} /></Card>
        </>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={`No ${noun} to rank yet`}
          message={isPodAdmin && !globalView
            ? `No ${noun} in your pod yet. Switch to Global to see everyone.`
            : `No ${noun} found. Add ${noun} to start tracking performance.`}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-8" data-tour="leaderboard-podium">
            {top3.map((person, i) => (
              <PodiumCard
                key={person.id}
                person={person}
                index={i}
                isMe={!!userId && person.id === userId}
                canOpen={canOpen(person.id)}
                onOpenPerson={onOpenPerson}
              />
            ))}
          </div>

          <Card data-tour="leaderboard-table">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader className="text-center w-14">Rank</TableHeader>
                  <SortableTableHeader label={tab === 'ae' ? 'AE' : 'SDR'} sortKey="name" sort={sort} onSort={toggleSort} />
                  <SortableTableHeader label="POD" sortKey="pod" sort={sort} onSort={toggleSort} />
                  <SortableTableHeader label="Calls Today" sortKey="calls_today" sort={sort} onSort={toggleSort} className="text-center" />
                  <SortableTableHeader label="Total Calls" sortKey="total_calls" sort={sort} onSort={toggleSort} className="text-center" />
                  <SortableTableHeader label="Meetings" sortKey="meetings" sort={sort} onSort={toggleSort} className="text-center" />
                  <SortableTableHeader label="Disqualified" sortKey="disqualified" sort={sort} onSort={toggleSort} className="text-center" />
                  <SortableTableHeader label="Leads" sortKey="total_leads" sort={sort} onSort={toggleSort} className="text-center" />
                  <SortableTableHeader label="Conv. Rate" sortKey="conversion_rate" sort={sort} onSort={toggleSort} className="text-center" />
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedRows.map((person, i) => {
                  const isMe = !!userId && person.id === userId;
                  return (
                    <TableRow key={person.id} className={isMe ? 'bg-blue-50/60 border-l-[3px] border-l-blue-600' : ''}>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold tabular-nums ${
                          i < 3 && !sort.key ? PODIUM[i].rankBg : 'text-slate-400'
                        }`}>
                          {sort.key ? i + 1 : (person.rank || i + 1)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="min-w-0">
                            {canOpen(person.id) ? (
                              <button
                                type="button"
                                onClick={() => onOpenPerson(person.id)}
                                className="font-semibold text-sm text-blue-600 hover:underline text-left truncate block"
                              >
                                {person.name}
                              </button>
                            ) : (
                              <div className="font-semibold text-sm text-slate-800 truncate" title="You can only view your own performance">
                                {person.name}
                              </div>
                            )}
                            <div className="text-xs text-slate-400 truncate">{person.email}{person.left && ' '}{person.left && <Badge variant="default" className="ml-1 !text-[9px] !px-1 !py-0.5 !rounded" title="This person has left — their access was removed">Left</Badge>}</div>
                          </div>
                          {isMe && <Badge variant="info" className="uppercase shrink-0">You</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-500">{person.pod_name || '—'}</TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">{person.calls_today}</TableCell>
                      <TableCell className="text-center tabular-nums">{person.total_calls}</TableCell>
                      <TableCell className="text-center font-bold text-emerald-600 tabular-nums">{person.meetings_scheduled}</TableCell>
                      <TableCell className="text-center font-semibold text-red-500 tabular-nums">{person.disqualified || 0}</TableCell>
                      <TableCell className="text-center tabular-nums">{person.total_leads}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={conversionVariant(person.conversion_rate)}>{person.conversion_rate}%</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
