/**
 * CalendarHub.jsx — Unified calendar: everyone's scheduled meetings, scoped to
 * their own records. Day/Week/Month range + a List display toggle. Read-only
 * (no drag/drop, no recurrence), so plain Date math is used instead of a
 * calendar library — this codebase has zero calendar/date dependencies today.
 *
 * Visibility mirrors GET /api/leads: Super Admin sees everything, Pod Admin
 * is scoped to their own pod (with a Global toggle), SDR/AE see only their
 * own assigned leads' meetings. This scoping happens entirely server-side in
 * /api/meetings and is range-agnostic, so every view mode below inherits it
 * automatically — nothing to duplicate here.
 *
 * Clicking a meeting opens a right-docked detail panel (matching the visual
 * language of components/ui/Modal.jsx and the Email Hub's ComposeDrawer)
 * rather than navigating away immediately, so calendar context isn't lost —
 * "Go to lead" inside the panel is the explicit opt-in to leave.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const ChevronLeft = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
);
const ChevronRight = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
);
const CalendarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const AlertIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);
const ListIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);
const ClockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const ArrowRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);
const BuildingIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="1"/><line x1="9" y1="7" x2="9" y2="7.01"/><line x1="15" y1="7" x2="15" y2="7.01"/><line x1="9" y1="12" x2="9" y2="12.01"/><line x1="15" y1="12" x2="15" y2="12.01"/><line x1="9" y1="17" x2="9" y2="17.01"/><line x1="15" y1="17" x2="15" y2="17.01"/>
  </svg>
);
const PhoneIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
);
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

function _buildMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, inMonth: false, date: new Date(year, month - 1, daysInPrevMonth - i) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, inMonth: true, date: new Date(year, month, d) });
  }
  while (cells.length % 7 !== 0 || cells.length < 35) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    cells.push({ day: next.getDate(), inMonth: false, date: next });
  }
  return cells;
}

function _isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function _startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function _endOfDay(d) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function _startOfWeek(d) { const r = _startOfDay(d); r.setDate(r.getDate() - r.getDay()); return r; }
function _weekDates(d) {
  const start = _startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x; });
}

// One range function per mode — month reuses the existing grid bounds, day/week are plain Date math.
function _rangeFor(rangeMode, cursor) {
  if (rangeMode === 'day') return [_startOfDay(cursor), _endOfDay(cursor)];
  if (rangeMode === 'week') { const wk = _weekDates(cursor); return [_startOfDay(wk[0]), _endOfDay(wk[6])]; }
  const cells = _buildMonthGrid(cursor.getFullYear(), cursor.getMonth());
  return [cells[0].date, cells[cells.length - 1].date];
}

// One step function instead of per-mode prev/next conditionals.
const STEP_DAYS = { day: 1, week: 7 };
function _stepCursor(rangeMode, cursor, dir) {
  if (rangeMode === 'month') return new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
  const next = new Date(cursor);
  next.setDate(next.getDate() + dir * STEP_DAYS[rangeMode]);
  return next;
}

function _headerLabel(rangeMode, cursor) {
  if (rangeMode === 'day') return cursor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (rangeMode === 'week') {
    const wk = _weekDates(cursor);
    const sameMonth = wk[0].getMonth() === wk[6].getMonth();
    const startLabel = wk[0].toLocaleDateString([], { month: 'short', day: 'numeric' });
    // { day: 'numeric', year: 'numeric' } with no month is a degenerate Intl
    // option combination -- some engines render it as "2026 (day: 18)" instead
    // of a real date (confirmed in Node/V8). Keep month out of the same-month
    // case a different way: day only, then append the year ourselves.
    const endLabel = wk[6].toLocaleDateString([], sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
    return `${startLabel} – ${endLabel}, ${wk[6].getFullYear()}`;
  }
  return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
}

// Deterministic accent per lead so the same person's chips are recognizable
// across days without needing a real "event color" concept. Kept subtle —
// a single indigo family with varying weight, not a rainbow of hues.
const CHIP_PALETTE = [
  { bg: '#eef2ff', text: '#3730a3', dot: '#6366f1' },
  { bg: '#f1f5f9', text: '#334155', dot: '#64748b' },
  { bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6' },
  { bg: '#f0fdfa', text: '#115e59', dot: '#14b8a6' },
  { bg: '#faf5ff', text: '#6b21a8', dot: '#a855f7' },
];
function _chipColor(leadId) {
  let h = 0;
  for (let i = 0; i < leadId.length; i++) h = (h * 31 + leadId.charCodeAt(i)) >>> 0;
  return CHIP_PALETTE[h % CHIP_PALETTE.length];
}

// Real calendar event subject, when the meeting was booked with one — falls
// back to the synthesized label for meetings booked before this existed.
function _meetingSubject(m) {
  return m.calendar_event_title || `${m.lead_name}${m.company ? ` — ${m.company}` : ''}`;
}

function MonthGridSkeleton() {
  return (
    <div className="grid grid-cols-7 gap-2">
      {Array.from({ length: 35 }).map((_, i) => (
        <div key={i} className="min-h-[104px] rounded-lg bg-slate-100 animate-pulse" />
      ))}
    </div>
  );
}

// Live clock + timezone, native Intl only — updates once a minute, not every
// render tick, since a calendar has no need for second-level precision.
function useNowClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const timeLabel = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const tzLabel = new Intl.DateTimeFormat([], { timeZoneName: 'short' })
    .formatToParts(now)
    .find(p => p.type === 'timeZoneName')?.value || '';
  return `${timeLabel} ${tzLabel}`;
}

// One row renderer shared by List, Day, and uncapped Week — the one real
// extraction, used by 3 call sites.
function MeetingRow({ m, onSelect }) {
  const c = _chipColor(m.lead_id);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(m)}
      onKeyDown={e => { if (e.key === 'Enter') onSelect(m); }}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.dot }} />
      <span className="text-xs font-semibold tabular-nums text-slate-400 w-16 shrink-0">
        {m._time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </span>
      <span className="text-sm font-medium text-slate-700 truncate">{m.lead_name}</span>
      {m.company && <span className="text-xs text-slate-400 truncate">— {m.company}</span>}
    </div>
  );
}

function MeetingList({ meetings, onSelect, emptyLabel }) {
  const grouped = useMemo(() => {
    const map = new Map();
    for (const m of meetings) {
      const key = `${m._time.getFullYear()}-${m._time.getMonth()}-${m._time.getDate()}`;
      if (!map.has(key)) map.set(key, { date: m._time, items: [] });
      map.get(key).items.push(m);
    }
    return Array.from(map.values()).sort((a, b) => a.date - b.date);
  }, [meetings]);

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-14 text-slate-400">
        <div className="w-11 h-11 rounded-full bg-slate-50 flex items-center justify-center text-slate-300"><CalendarIcon /></div>
        <p className="text-sm font-medium">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="calhub-card divide-y divide-slate-100">
      {grouped.map(g => (
        <div key={g.date.toISOString()} className="px-2 py-2">
          <div className="px-3 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
            {g.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          {g.items.map(m => <MeetingRow key={m.lead_id} m={m} onSelect={onSelect} />)}
        </div>
      ))}
    </div>
  );
}

// Right-docked read-only detail panel. Matches components/ui/Modal.jsx's
// visual language (rounded-2xl, shadow-2xl, slate-100 borders) but slides in
// from the right and never auto-navigates — "Go to lead" is the one explicit
// exit, so calendar context (range, cursor, scroll position) is preserved.
// Recent call history for the panel — reuses the same merged manual+dialer
// endpoint the lead detail page's Calls tab already calls, just capped to a
// handful of rows. No new backend endpoint needed.
function useLeadCalls(leadId) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.get(`/leads/${leadId}/calls`, { params: { page: 1, limit: 5 } })
      .then(res => { if (!cancelled) setCalls(res.data?.calls || []); })
      .catch(err => {
        console.error('[CalendarHub] failed to fetch call history', err);
        if (!cancelled) setError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [leadId]);

  return { calls, loading, error };
}

function CallHistorySkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
      ))}
    </div>
  );
}

function CallHistorySection({ leadId }) {
  const { calls, loading, error } = useLeadCalls(leadId);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wide mb-2.5">
        <ClockIcon /> Recent Activity
      </div>
      {loading ? (
        <CallHistorySkeleton />
      ) : error ? (
        <p className="text-xs text-slate-400">Couldn't load call history.</p>
      ) : calls.length === 0 ? (
        <p className="text-xs text-slate-400">No calls logged yet.</p>
      ) : (
        <div className="space-y-2.5">
          {calls.map(call => (
            <div key={call.id} className="calhub-card !shadow-none px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-700">{call.outcome || 'Call logged'}</span>
                <span className="text-[11px] text-slate-400 shrink-0">
                  {call.called_at ? new Date(call.called_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                </span>
              </div>
              {call.user_name && (
                <p className="text-[11px] text-slate-400 mb-1">by {call.user_name}</p>
              )}
              {call.notes && (
                <p className="text-xs text-slate-600 line-clamp-2">{call.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingDetailPanel({ meeting, onClose, onGoToLead }) {
  if (!meeting) return null;
  const c = _chipColor(meeting.lead_id);
  return (
    <div className="fixed inset-0 z-[100]" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/20" />
      <div
        className="calhub-card absolute top-0 right-0 h-full w-full max-w-sm rounded-none rounded-l-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Meeting Details</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          ><CloseIcon /></button>
        </div>

        <div className="px-5 py-5 flex-1 overflow-y-auto">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.dot }} />
            <h2 className="text-base font-bold text-slate-800">{meeting.lead_name || 'Unnamed lead'}</h2>
          </div>
          <p className="text-xs font-semibold text-slate-400 mb-1 pl-[18px]">
            {meeting._time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {meeting._time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
          {meeting.calendar_event_title && (
            <p className="text-sm font-semibold text-indigo-700 mb-5 pl-[18px]">{meeting.calendar_event_title}</p>
          )}
          {!meeting.calendar_event_title && <div className="mb-5" />}

          <div className="space-y-3">
            {meeting.company && (
              <div className="flex items-center gap-2.5 text-sm text-slate-600">
                <span className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 shrink-0"><BuildingIcon /></span>
                {meeting.company}
              </div>
            )}
            {meeting.phone && (
              <div className="flex items-center gap-2.5 text-sm text-slate-600">
                <span className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 shrink-0"><PhoneIcon /></span>
                {meeting.phone}
              </div>
            )}
            {meeting.calendar_event_agenda && (
              <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-line">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Agenda</div>
                {meeting.calendar_event_agenda}
              </div>
            )}
          </div>

          <CallHistorySection leadId={meeting.lead_id} />
        </div>

        <div className="px-5 py-4 border-t border-slate-100">
          <button
            onClick={() => onGoToLead(meeting.lead_id)}
            className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg py-2.5 transition-colors"
          >
            Go to lead <ArrowRightIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

export function CalendarHub({ userRole = '', onLeadClick }) {
  const today = useMemo(() => new Date(), []);
  const [rangeMode, setRangeMode] = useState('month'); // 'day' | 'week' | 'month'
  const [showList, setShowList] = useState(false);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [globalView, setGlobalView] = useState(false);
  const [selected, setSelected] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sdrFilter, setSdrFilter] = useState('');
  const clockLabel = useNowClock();

  const isPodAdmin = (userRole || '').toLowerCase() === 'pod admin';

  const [rangeStart, rangeEnd] = useMemo(() => _rangeFor(rangeMode, cursor), [rangeMode, cursor]);
  const monthCells = useMemo(
    () => (rangeMode === 'month' ? _buildMonthGrid(cursor.getFullYear(), cursor.getMonth()) : null),
    [rangeMode, cursor]
  );

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get('/meetings', {
        params: {
          date_from: rangeStart.toISOString(),
          date_to: rangeEnd.toISOString(),
          global_view: globalView,
        },
      });
      setMeetings(res.data?.meetings || []);
    } catch (err) {
      console.error('[CalendarHub] failed to fetch meetings', err);
      setError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart.getTime(), rangeEnd.getTime(), globalView]);

  useEffect(() => { fetchMeetings(); }, [fetchMeetings]);

  const meetingsWithTime = useMemo(() => {
    return meetings
      .filter(m => m.meeting_scheduled_at)
      .map(m => {
        const d = new Date(m.meeting_scheduled_at.replace(' ', 'T') + (m.meeting_scheduled_at.includes('Z') || m.meeting_scheduled_at.includes('+') ? '' : 'Z'));
        return { ...m, _time: d };
      });
  }, [meetings]);

  // SDR/AE options are derived from whatever's actually in the current range —
  // no separate endpoint, and it naturally hides itself when there's nothing
  // to filter by (an individual SDR's own leads all share one assignee).
  const sdrOptions = useMemo(() => {
    const names = new Set(meetingsWithTime.map(m => m.assigned_to_name).filter(Boolean));
    return Array.from(names).sort();
  }, [meetingsWithTime]);

  // Navigating to a different range (month/week/day) can leave sdrFilter
  // pointing at a name absent from the new range's options — the <select>
  // then visually falls back to "All SDRs/AEs" while the stale filter value
  // keeps silently applying, showing 0 meetings with no indication why.
  useEffect(() => {
    if (sdrFilter && !sdrOptions.includes(sdrFilter)) setSdrFilter('');
  }, [sdrOptions, sdrFilter]);

  const filteredMeetings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return meetingsWithTime.filter(m => {
      if (sdrFilter && m.assigned_to_name !== sdrFilter) return false;
      if (q && !(`${m.lead_name} ${m.company || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [meetingsWithTime, searchQuery, sdrFilter]);

  const meetingsByDay = useMemo(() => {
    const map = new Map();
    for (const m of filteredMeetings) {
      const key = `${m._time.getFullYear()}-${m._time.getMonth()}-${m._time.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    }
    return map;
  }, [meetingsWithTime]);

  const isToday = _isSameDay(cursor, today);
  const totalCount = filteredMeetings.length;
  const asList = rangeMode === 'day' || showList;

  return (
    <div className="calhub p-6 max-w-6xl mx-auto">
      {/* Header card */}
      <div className="calhub-card flex items-center justify-between gap-4 mb-5 px-5 py-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shrink-0">
            <CalendarIcon />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-800 leading-tight">{_headerLabel(rangeMode, cursor)}</h1>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5 flex items-center gap-1.5">
              {loading ? 'Loading…' : `${totalCount} meeting${totalCount === 1 ? '' : 's'} scheduled`}
              <span className="text-slate-300">·</span>
              <ClockIcon /> {clockLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isPodAdmin && (
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mr-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={globalView}
                onChange={e => setGlobalView(e.target.checked)}
                className="accent-indigo-600 w-3.5 h-3.5"
              />
              All pods
            </label>
          )}

          {/* Day / Week / Month segmented control */}
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
            {['day', 'week', 'month'].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setRangeMode(m)}
                className={`px-2.5 py-1.5 capitalize transition-colors ${rangeMode === m ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* List display toggle — disabled (not hidden) for Day, which is
              always list-shaped; hiding it made the header appear to lose a
              button when switching Month/Week -> Day. Matches the disabled
              (not hidden) treatment the "Today" button already uses below. */}
          <button
            type="button"
            onClick={() => setShowList(v => !v)}
            disabled={rangeMode === 'day'}
            aria-label="Toggle list view"
            title={rangeMode === 'day' ? 'Today is always shown as a list' : 'Toggle list view'}
            className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-colors
              disabled:opacity-40 disabled:cursor-default
              ${showList || rangeMode === 'day' ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >
            <ListIcon />
          </button>

          <button
            type="button"
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}
            disabled={isToday}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600
              hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            Today
          </button>
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => setCursor(c => _stepCursor(rangeMode, c, -1))}
              className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
            ><ChevronLeft /></button>
            <div className="w-px h-5 bg-slate-200" />
            <button
              type="button"
              aria-label="Next"
              onClick={() => setCursor(c => _stepCursor(rangeMode, c, 1))}
              className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
            ><ChevronRight /></button>
          </div>
        </div>
      </div>

      {/* Search + SDR/AE filter — client-side over the current range's already-
          fetched meetings, so no extra API round trip. SDR dropdown only shows
          when the range actually has more than one assignee to filter by. */}
      <div className="calhub-card flex items-center gap-2 mb-5 px-4 py-2.5 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          {/* inset-y-0 + flex/items-center spans the input's full height and
              centers the icon within it -- avoids the top-1/2/-translate-y-1/2
              trick, whose centering math depends on the span's own box height
              (line-height, inherited font metrics) rather than the input's. */}
          <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-300 pointer-events-none">
            <SearchIcon />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by lead or company…"
            className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-indigo-300"
          />
        </div>
        {sdrOptions.length > 1 && (
          <select
            value={sdrFilter}
            onChange={e => setSdrFilter(e.target.value)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white focus:outline-none focus:border-indigo-300"
          >
            <option value="">All SDRs/AEs</option>
            {sdrOptions.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertIcon />
          <span>Couldn't load meetings.</span>
          <button className="font-semibold underline underline-offset-2 hover:text-red-800" onClick={fetchMeetings}>Retry</button>
        </div>
      )}

      {loading ? (
        <MonthGridSkeleton />
      ) : asList ? (
        <MeetingList
          meetings={filteredMeetings}
          onSelect={setSelected}
          emptyLabel={
            searchQuery || sdrFilter
              ? 'No meetings match your search/filter.'
              : rangeMode === 'day' ? 'No meetings scheduled today.' : 'No meetings scheduled in this range.'
          }
        />
      ) : rangeMode === 'week' ? (
        <div className="calhub-card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-100">
            {_weekDates(cursor).map((d, i) => (
              <div key={i} className="py-2.5 text-center border-slate-100 border-r last:border-r-0">
                <div className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide">{DAY_NAMES[i]}</div>
                <div className={`mx-auto mt-1 text-[11px] font-bold w-[22px] h-[22px] flex items-center justify-center rounded-full
                  ${_isSameDay(d, today) ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>
                  {d.getDate()}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 min-h-[300px]">
            {_weekDates(cursor).map((d, i) => {
              const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
              const dayMeetings = (meetingsByDay.get(key) || []).sort((a, b) => a._time - b._time);
              return (
                <div key={i} className="p-1.5 border-slate-100 border-r last:border-r-0 space-y-1">
                  {dayMeetings.map(m => {
                    const c = _chipColor(m.lead_id);
                    return (
                      <div
                        key={m.lead_id}
                        onClick={() => setSelected(m)}
                        title={_meetingSubject(m)}
                        className="flex items-center gap-1 text-[10px] font-medium leading-tight rounded-md px-1.5 py-1 truncate cursor-pointer"
                        style={{ background: c.bg, color: c.text }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.dot }} />
                        <span className="truncate">
                          <span className="tabular-nums opacity-75">{m._time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>{' '}{m.lead_name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="calhub-card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-100">
            {DAY_NAMES.map(d => (
              <div key={d} className="py-2.5 text-center text-[10.5px] font-bold text-slate-400 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthCells.map((cell, i) => {
              const key = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`;
              const dayMeetings = (meetingsByDay.get(key) || []).sort((a, b) => a._time - b._time);
              const isTodayCell = _isSameDay(cell.date, today);
              const col = i % 7;
              const row = Math.floor(i / 7);
              return (
                <div
                  key={i}
                  className={`min-h-[104px] p-1.5 border-slate-100
                    ${col !== 6 ? 'border-r' : ''} ${row !== 4 ? 'border-b' : ''}
                    ${cell.inMonth ? 'bg-white' : 'bg-slate-50/60'}`}
                >
                  <div className={`text-[11px] font-bold mb-1.5 w-[22px] h-[22px] flex items-center justify-center rounded-full
                    ${isTodayCell ? 'bg-indigo-600 text-white' : cell.inMonth ? 'text-slate-600' : 'text-slate-300'}`}>
                    {cell.day}
                  </div>
                  <div className="space-y-1">
                    {dayMeetings.slice(0, 3).map(m => {
                      const c = _chipColor(m.lead_id);
                      return (
                        <div
                          key={m.lead_id}
                          onClick={() => setSelected(m)}
                          title={_meetingSubject(m)}
                          className="flex items-center gap-1 text-[10px] font-medium leading-tight rounded-md px-1.5 py-1 truncate cursor-pointer"
                          style={{ background: c.bg, color: c.text }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.dot }} />
                          <span className="truncate">
                            <span className="tabular-nums opacity-75">{m._time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>{' '}{m.lead_name}
                          </span>
                        </div>
                      );
                    })}
                    {dayMeetings.length > 3 && (
                      <div className="text-[10px] font-semibold text-slate-400 px-1.5">+{dayMeetings.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && !asList && totalCount === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-14 text-slate-400">
          <div className="w-11 h-11 rounded-full bg-slate-50 flex items-center justify-center text-slate-300">
            <CalendarIcon />
          </div>
          <p className="text-sm font-medium">No meetings scheduled{rangeMode === 'week' ? ' this week' : ' this month'}.</p>
        </div>
      )}

      <MeetingDetailPanel
        meeting={selected}
        onClose={() => setSelected(null)}
        onGoToLead={(id) => { setSelected(null); onLeadClick?.(id); }}
      />
    </div>
  );
}
