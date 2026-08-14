import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Search, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { Skeleton, SkeletonMetricCard, SkeletonCallRow } from '../../../components/ui/Skeleton';
import { CallsService } from '../../../services/api';

const PAGE_SIZE = 15;

function formatDuration(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TILES = [
  { key: 'total',     label: 'Total' },
  { key: 'connected', label: 'Connected' },
  { key: 'no_answer', label: 'No Answer' },
  { key: 'voicemail', label: 'Voicemail' },
  { key: 'callback',  label: 'Callback' },
  { key: 'meeting',   label: 'Meeting' },
];

/**
 * Provider-signed recording URLs expire — the initial today-calls fetch may
 * already be holding a stale one by the time the SDR clicks play. Mirrors
 * frontend/js/utils.js's bindRecordingRetry: play the URL we have, and on
 * error fetch one fresh signed URL via CallsService.getRecordingUrl and
 * retry once (not indefinitely — a genuinely missing recording should fail
 * quietly, not loop).
 */
function RecordingCell({ callId, recordingUrl }) {
  const [url, setUrl] = useState(recordingUrl);
  const [retried, setRetried] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  if (!recordingUrl && !url) return <span className="text-slate-300">—</span>;
  if (unavailable) return <span className="text-slate-400 text-xs italic">Unavailable</span>;

  const handleError = async () => {
    if (retried) { setUnavailable(true); return; }
    setRetried(true);
    try {
      const fresh = await CallsService.getRecordingUrl(callId);
      if (fresh?.recording_url) setUrl(fresh.recording_url);
      else setUnavailable(true);
    } catch {
      setUnavailable(true);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <audio controls preload="none" onError={handleError} style={{ height: 28, maxWidth: 160 }}>
        <source src={url} />
      </audio>
      <a href={url} download target="_blank" rel="noopener noreferrer"
        title="Download recording" className="text-slate-400 hover:text-indigo-600 shrink-0">
        <Download size={14} />
      </a>
    </div>
  );
}

// Local YYYY-MM-DD, not UTC — a date input's value must match what the SDR
// sees on their own clock, and the backend's `date` param is a plain
// calendar-day filter (see call_routes.py's get_my_today_calls) with no
// timezone conversion of its own.
function todayLocalISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Direct fold-in replacement for what frontend/js/views/my_calls.js computed
 * server-side (now retired) — call history/stats for a chosen day, live
 * alongside the dialing queue rather than as a separate page. Fetches on
 * mount + an explicit Refresh/date-change only, matching the queue's own
 * anti-clobber discipline (no timer-driven re-render underneath the SDR).
 */
export function TodayStatsPanel({ onTotalChange }) {
  const [date, setDate] = useState(todayLocalISO);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [page, setPage] = useState(1);
  const isToday = date === todayLocalISO();

  const fetchStats = useCallback(async (forDate) => {
    setLoading(true);
    setError(null);
    try {
      setData(await CallsService.getTodayCalls(forDate));
    } catch {
      setError('Failed to load calls for this date.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(date); }, [date, fetchStats]);

  // Lets a caller (PowerDialerHub's headline stat) read today's REAL total
  // without a second fetch — this panel already owns the only correct
  // source of it. Only reported while viewing today; a past date's total
  // isn't "today's calls made."
  useEffect(() => {
    if (isToday && data) onTotalChange?.(data.summary.total);
  }, [isToday, data, onTotalChange]);

  // 2026-08-10 review: this panel and the dialing queue sat side by side but
  // never talked to each other — logging a call didn't move these tiles
  // until the SDR remembered to click Refresh here too. Only meaningful
  // while viewing today (a past date's totals can't change from a call
  // just made now).
  useEffect(() => {
    if (!isToday) return;
    const handleResolved = () => fetchStats(date);
    window.addEventListener('rcm:call-outcome-resolved', handleResolved);
    return () => window.removeEventListener('rcm:call-outcome-resolved', handleResolved);
  }, [isToday, date, fetchStats]);

  // Distinct outcomes actually present today — the filter dropdown only ever
  // offers choices that exist in the data, so it never drifts from whatever
  // outcome strings are really in use.
  const outcomeOptions = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.calls.map(c => c.outcome).filter(Boolean))].sort();
  }, [data]);

  const filteredCalls = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.calls.filter(c => {
      if (outcomeFilter && c.outcome !== outcomeFilter) return false;
      if (!q) return true;
      const haystack = `${c.lead_name || ''} ${c.company || ''} ${c.phone_number || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [data, search, outcomeFilter]);

  // Any filter/search/date change invalidates the current page — land back
  // on page 1 rather than showing a stale, possibly out-of-range page.
  useEffect(() => { setPage(1); }, [search, outcomeFilter, date]);

  const totalPages = Math.max(1, Math.ceil(filteredCalls.length / PAGE_SIZE));
  const pagedCalls = filteredCalls.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Card className="p-5 flex flex-col gap-4" data-tour="today-stats">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold text-slate-800 m-0">
          {isToday ? "Today's Calls" : 'Calls'}
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={todayLocalISO()}
            onChange={e => e.target.value && setDate(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1 text-slate-600"
            aria-label="Select date"
          />
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => setDate(todayLocalISO())}>
              Today
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => fetchStats(date)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {loading && !data && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonMetricCard key={i} />)}
          </div>
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCallRow key={i} />)}
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {TILES.map(t => (
              <div key={t.key} className="bg-slate-50 rounded-lg px-3 py-2 text-center">
                <div className="text-xl font-bold text-slate-800">{data.summary[t.key] ?? 0}</div>
                <div className="text-xs text-slate-500">{t.label}</div>
              </div>
            ))}
          </div>

          {data.calls.length === 0 ? (
            <div className="text-sm text-slate-400 italic text-center py-6">
              {isToday ? 'No calls logged today yet.' : 'No calls logged on this date.'}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[160px]">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search name, company, phone…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
                  />
                </div>
                <select
                  value={outcomeFilter}
                  onChange={e => {
                    setOutcomeFilter(e.target.value);
                    try { window.mixpanel?.track('Today Calls Filtered', { outcome: e.target.value || 'all' }); } catch {}
                  }}
                  className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600"
                >
                  <option value="">All outcomes</option>
                  {outcomeOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {filteredCalls.length === 0 ? (
                <div className="text-sm text-slate-400 italic text-center py-6">
                  No calls match this filter.
                </div>
              ) : (
                <>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeader>Lead</TableHeader>
                        <TableHeader>Outcome</TableHeader>
                        <TableHeader>Time</TableHeader>
                        <TableHeader>Duration</TableHeader>
                        <TableHeader>Recording</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pagedCalls.map(c => (
                        <TableRow key={c.id}>
                          <TableCell>
                            <div className="font-medium text-slate-800">{c.lead_name || c.phone_number || 'Unknown'}</div>
                            <div className="text-xs text-slate-400">{c.company}</div>
                          </TableCell>
                          <TableCell><Badge>{c.outcome}</Badge></TableCell>
                          <TableCell>{c.called_at ? new Date(c.called_at).toLocaleTimeString() : '—'}</TableCell>
                          <TableCell>{formatDuration(c.duration_sec)}</TableCell>
                          <TableCell>
                            <RecordingCell callId={c.id} recordingUrl={c.recording_url} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>
                        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredCalls.length)} of {filteredCalls.length}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                          <ChevronLeft size={14} />
                        </Button>
                        <span className="px-1">Page {page} of {totalPages}</span>
                        <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                          <ChevronRight size={14} />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
