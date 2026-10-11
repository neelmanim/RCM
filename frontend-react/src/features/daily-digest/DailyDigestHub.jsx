import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone, Mail, NotebookPen, CalendarCheck, Layers, Download, Newspaper, TriangleAlert, ArrowRight, X, ChevronDown,
  MessagesSquare, CircleCheck, UserX, Cloud, UserPlus, ArrowRightLeft, Search, Presentation, Building2, Users, Megaphone, Repeat,
} from 'lucide-react';
import { DateRangePicker } from '../../components/ui/DateRangePicker';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { SearchInput } from '../../components/ui/SearchInput';
import { Pagination } from '../../components/ui/Pagination';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../components/ui/Table';
import { SortableTableHeader } from '../../components/ui/SortableTableHeader';
import { useSort } from '../../utils/useSort';
import { useTableView } from '../../utils/useTableView';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonMetricCard, SkeletonTable, SkeletonCard, SkeletonText } from '../../components/ui/Skeleton';
import { DailyDigestService, PodsService, SavedViewsService } from '../../services/api';
import { DailyDigestTour } from './DailyDigestTour';
import { FunnelSection } from './FunnelSection';
import { DrillDownSection } from './DrillDownSection';
import { DigestViews } from './DigestViews';
import { PERIODS, resolvePeriod, periodLabel, customProblem, lastPickableDay } from './periods';
import { useCanExport } from '../../lib/useCanExport';

// Icon and colour for each number in the Digest's catalog (the server owns the list and the labels; this only dresses them).
const TILE_META = {
  calls_made: { icon: Phone, color: 'text-sky-600', bg: 'bg-sky-50' },
  emails_sent: { icon: Mail, color: 'text-cyan-600', bg: 'bg-cyan-50' },
  research_notes: { icon: NotebookPen, color: 'text-amber-600', bg: 'bg-amber-50' },
  meetings_booked: { icon: CalendarCheck, color: 'text-purple-600', bg: 'bg-purple-50' },
  leads_touched: { icon: Layers, color: 'text-blue-600', bg: 'bg-blue-50' },
  conversations: { icon: MessagesSquare, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  meetings_held: { icon: CircleCheck, color: 'text-green-600', bg: 'bg-green-50' },
  no_shows: { icon: UserX, color: 'text-red-600', bg: 'bg-red-50' },
  sal_meetings: { icon: Cloud, color: 'text-sky-600', bg: 'bg-sky-50' },
  new_leads: { icon: UserPlus, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  pipeline_moved: { icon: ArrowRightLeft, color: 'text-slate-600', bg: 'bg-slate-100' },
  leads_researched: { icon: Search, color: 'text-amber-600', bg: 'bg-amber-50' },
  demos_completed: { icon: Presentation, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50' },
  accounts_given: { icon: Building2, color: 'text-teal-600', bg: 'bg-teal-50' },
  contacts_given: { icon: Users, color: 'text-teal-600', bg: 'bg-teal-50' },
  campaigns_sent: { icon: Megaphone, color: 'text-orange-600', bg: 'bg-orange-50' },
  cadence_enrollments: { icon: Repeat, color: 'text-violet-600', bg: 'bg-violet-50' },
};
const FALLBACK_META = { icon: Layers, color: 'text-slate-600', bg: 'bg-slate-100' };
const DEFAULT_KEYS = ['calls_made', 'emails_sent', 'research_notes', 'meetings_booked', 'leads_touched'];
const ACTIVITY_LABEL = { calls: 'Calls', emails: 'Emails', notes: 'Research notes', meetings: 'Meetings booked' };
const FOLLOW_UPS = [
  { value: '', label: 'Any follow-up' }, { value: 'Overdue', label: 'Overdue' },
  { value: 'Scheduled', label: 'Scheduled' }, { value: 'None set', label: 'None set' },
];
const PER_PAGE = 10;
const TEAM_PAGE_SIZES = [8, 15, 25, 50];   // the Team table shows 8 reps by default so a big team never makes the page endless
// Columns for the number tiles on a wide screen, chosen so the last row is never a lone card (literal class names: Tailwind scans the source).
const TILE_COLS = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-3', 7: 'lg:grid-cols-4', 8: 'lg:grid-cols-4', 9: 'lg:grid-cols-5', 10: 'lg:grid-cols-5' };
const NO_ROWS = [];
const CAMPAIGN_SEARCH = ['campaign'];
const EMPTY_FILTERS = { rep: '', followUp: '', activity: '', campaign: '', q: '' };

function delta(kpi) {
  if (!kpi || kpi.delta_pct == null) return { label: '—', variant: 'default' };
  if (kpi.delta_pct === 'new') return { label: 'new', variant: 'success' };
  return { label: `${kpi.delta_pct > 0 ? '+' : ''}${kpi.delta_pct}%`, variant: kpi.delta_pct > 0 ? 'success' : kpi.delta_pct < 0 ? 'danger' : 'default' };
}

function HeadlineTile({ item, kpi, compareLabel, active, onClick }) {
  const meta = TILE_META[item.key] || FALLBACK_META;
  const Icon = meta.icon;
  const d = delta(kpi);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={item.activity ? `Show the leads with ${ACTIVITY_LABEL[item.activity].toLowerCase()}` : (item.hint || 'Show every lead touched')}
      className={`text-left bg-white border rounded-2xl p-4 shadow-sm flex flex-col gap-1 transition hover:border-blue-300 hover:shadow ${active ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200'}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className={`w-8 h-8 ${meta.bg} rounded-xl flex items-center justify-center ${meta.color}`}><Icon size={16} /></div>
        <Badge variant={d.variant}>{d.label}</Badge>
      </div>
      <p className="text-2xl font-extrabold text-slate-800 leading-tight tabular-nums m-0">{kpi?.today ?? 0}</p>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide m-0">{item.label}</p>
      <p className="text-[11px] text-slate-400 m-0">vs {kpi?.compare ?? 0} {compareLabel}</p>
    </button>
  );
}

const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

function followUpBadge(row) {
  const variant = row.follow_up === 'Overdue' ? 'danger' : row.follow_up === 'Scheduled' ? 'success' : 'default';
  return <Badge variant={variant}>{row.follow_up}{row.next_follow_up ? ` · ${fmtDay(row.next_follow_up)}` : ''}</Badge>;
}

function whatHappened(r) {
  const parts = [];
  if (r.calls) parts.push(`${r.calls} call${r.calls > 1 ? 's' : ''}`);
  if (r.emails) parts.push(`${r.emails} email${r.emails > 1 ? 's' : ''}`);
  if (r.notes) parts.push(`${r.notes} note${r.notes > 1 ? 's' : ''}`);
  return parts.join(' · ') || '—';
}

export function DailyDigestHub() {
  const [periodKey, setPeriodKey] = useState('yesterday');
  const [custom, setCustom] = useState({ from: '', to: '' });      // the range being shown (always complete and valid, or empty)
  const [draft, setDraft] = useState({ from: '', to: '' });        // what the picker shows while someone is still choosing
  const rangeProblem = customProblem(draft);
  const [podId, setPodId] = useState('');
  const [pods, setPods] = useState([]);
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);
  const [leads, setLeads] = useState(null);
  const [exporting, setExporting] = useState(false);
  const canExport = useCanExport();
  const [teamSort, toggleTeamSort] = useSort();
  const [teamSize, setTeamSize] = useState(TEAM_PAGE_SIZES[0]);
  const [teamPage, setTeamPage] = useState(1);
  const [views, setViews] = useState([]);              // this person's saved digest views
  const [activeView, setActiveView] = useState('standard');   // 'standard' | a saved view's id | 'custom'
  const [customKeys, setCustomKeys] = useState(DEFAULT_KEYS);
  const leadsRef = useRef(null);
  const teamRef = useRef(null);

  // Choosing Custom starts from the last 7 days, so the page is never blank while someone is picking dates.
  const pickPeriod = (key) => {
    if (key === 'custom' && !(custom.from && custom.to)) { const w = resolvePeriod('last7'); if (w) { setCustom({ from: w.from, to: w.to }); setDraft({ from: w.from, to: w.to }); } }
    setPeriodKey(key);
  };

  // The page keeps showing the last good range until a complete, valid one is chosen, so picking dates never blanks it.
  const pickDates = (next) => {
    setDraft(next);
    if (!next.from && !next.to) setCustom({ from: '', to: '' });
    else if (next.from && next.to && !customProblem(next)) setCustom(next);
  };

  const resolved = useMemo(() => resolvePeriod(periodKey, custom), [periodKey, custom]);
  const range = resolved?.params;
  const rangeKey = JSON.stringify(range || null);
  const noRange = periodKey === 'custom' && !range;      // nothing to show until both dates are chosen

  // A Super Admin can look at one pod; a Pod Admin gets at most their own, so the picker stays hidden for them.
  useEffect(() => {
    let off = false;
    PodsService.getAll().then((p) => { if (!off && Array.isArray(p)) setPods(p); }).catch(() => {});
    SavedViewsService.list('digest').then((v) => { if (!off && Array.isArray(v)) setViews(v); }).catch(() => {});
    return () => { off = true; };
  }, []);

  useEffect(() => {
    if (!range) return undefined;           // a custom range that is not filled in yet
    let cancelled = false;
    setData(null);
    setError(null);
    setPage(1);
    DailyDigestService.get(range, podId).then((res) => {
      if (cancelled) return;
      if (!res || res.error) { setError(res?.error || 'Failed to load the digest for this period.'); setData({}); return; }
      setData(res);
    });
    return () => { cancelled = true; };
  }, [rangeKey, podId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The search box waits for a pause in typing before it asks the server.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === qInput.trim() ? f : { ...f, q: qInput.trim() })), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => { setPage(1); }, [filters]);

  useEffect(() => {
    if (!data || !data.kpi || !range) return undefined;
    let cancelled = false;
    setLeads((prev) => (prev ? { ...prev, loading: true } : null));
    DailyDigestService.leads({
      ...range, pod_id: podId, page, per_page: PER_PAGE, rep_id: filters.rep, follow_up: filters.followUp,
      activity: filters.activity, campaign: filters.campaign, q: filters.q,
    }).then((res) => { if (!cancelled) setLeads(res ? { ...res, loading: false } : { items: [], total: 0, pages: 1, loading: false }); });
    return () => { cancelled = true; };
  }, [data, rangeKey, podId, page, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const team = data?.sdr_snapshot || NO_ROWS;
  const sortedTeam = useMemo(() => {
    if (!teamSort.key) return team;
    const acc = (r) => (teamSort.key === 'name' ? (r.name || '').toLowerCase() : (r[teamSort.key] || 0));
    const out = [...team].sort((a, b) => (acc(a) < acc(b) ? -1 : acc(a) > acc(b) ? 1 : 0));
    return teamSort.dir === 'desc' ? out.reverse() : out;
  }, [team, teamSort]);

  const teamPages = Math.max(1, Math.ceil(sortedTeam.length / teamSize));
  const tp = Math.min(teamPage, teamPages);
  const shownTeam = sortedTeam.slice((tp - 1) * teamSize, tp * teamSize);
  useEffect(() => { setTeamPage(1); }, [teamSize, teamSort.key, teamSort.dir, rangeKey, podId]);

  const campaigns = useTableView(data?.campaigns || NO_ROWS, { searchKeys: CAMPAIGN_SEARCH, pageSize: 8 });

  const setFilter = useCallback((patch) => setFilters((f) => ({ ...f, ...patch })), []);
  const clearFilters = () => { setQInput(''); setFilters(EMPTY_FILTERS); };
  const toLeads = () => leadsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const repName = team.find((r) => r.user_id === filters.rep)?.name;
  const anyFilter = filters.rep || filters.followUp || filters.activity || filters.campaign || filters.q;
  const loading = data === null && !!range;
  const summary = data?.lead_summary;
  const idleIds = data?.attention?.find((a) => a.key === 'idle_reps')?.rep_ids || [];
  const statusEntries = data?.status_snapshot ? Object.entries(data.status_snapshot) : [];
  const compareLabel = data?.compare_label || 'same weekday last week';
  const when = data?.from ? periodLabel(data.from, data.to) : '';

  // Which numbers the strip shows: the person's chosen view, else the standard five.
  const catalog = data?.catalog || NO_ROWS;
  const catalogByKey = useMemo(() => Object.fromEntries(catalog.map((c) => [c.key, c])), [catalog]);
  const standardKeys = data?.default_kpis || DEFAULT_KEYS;
  const shownKeys = activeView === 'standard' ? standardKeys : activeView === 'custom' ? customKeys : (views.find((v) => v.id === activeView)?.keys || standardKeys);
  const tiles = shownKeys.map((k) => catalogByKey[k]).filter(Boolean);
  const otherNumbers = catalog.filter((c) => !shownKeys.includes(c.key) && data?.kpi?.[c.key]);

  const pickView = (id) => {
    setActiveView(id);
    const v = views.find((x) => x.id === id);
    if (v?.filters?.period && PERIODS.some((p) => p.key === v.filters.period)) setPeriodKey(v.filters.period);
  };
  const saveView = async (name, keys, shared) => {
    const created = await SavedViewsService.create({ scope: 'digest', name, keys, shared, filters: periodKey === 'custom' ? {} : { period: periodKey } });
    setViews((v) => [...v, created]);
    setActiveView(created.id);
  };
  const deleteView = async (v) => {
    await SavedViewsService.remove(v.id);
    setViews((all) => all.filter((x) => x.id !== v.id));
    if (activeView === v.id) setActiveView('standard');
  };

  const doExport = async () => {
    setExporting(true);
    try { await DailyDigestService.exportXlsx(range, podId); } finally { setExporting(false); }
  };
  const openLead = (id) => window._loadView?.('lead-detail', id);

  const onAttention = (a) => {
    if (a.key === 'overdue') { setFilter({ followUp: 'Overdue', rep: '' }); toLeads(); }
    if (a.key === 'idle_reps') teamRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="daily-digest-hub min-h-full bg-slate-50 px-6 py-6 max-w-6xl mx-auto">
      <DailyDigestTour />

      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 m-0 flex items-center gap-2">
            <Newspaper size={20} className="text-slate-400" /> Team Digest
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {when && !noRange ? `What your team did ${data.days > 1 ? 'over' : 'on'} ${when}, compared with ${compareLabel}.` : 'What your team did, compared with the period before.'}
            {data?.timezone && !noRange ? ` Days in ${data.timezone}.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap" data-tour="digest-date-picker">
          {pods.length > 1 && (
            <Select
              value={podId}
              onChange={setPodId}
              ariaLabel="Pod"
              options={[{ value: '', label: 'All pods' }, ...pods.map((p) => ({ value: p.id, label: p.name }))]}
            />
          )}
          <Select
            value={periodKey}
            onChange={pickPeriod}
            ariaLabel="Period"
            options={PERIODS.map((p) => ({ value: p.key, label: p.label, disabled: p.key !== 'custom' && !resolvePeriod(p.key) }))}
          />
          {periodKey === 'custom' && <DateRangePicker from={draft.from} to={draft.to} onChange={pickDates} ariaLabel="Digest dates" maxDate={lastPickableDay()} />}
          {canExport && (
            <Button size="sm" variant="outline" onClick={doExport} disabled={exporting || loading || !!error || !range} data-tour="digest-export">
              <Download size={14} /> {exporting ? 'Preparing…' : 'Export Excel'}
            </Button>
          )}
        </div>
      </div>

      {periodKey === 'custom' && rangeProblem && <p className="text-sm text-amber-700 mb-4" role="alert">{rangeProblem}</p>}
      {error && <p className="text-sm text-red-600 mb-4" role="alert">{error}</p>}
      {noRange ? <EmptyState title="Pick the dates" message="Choose a start and an end date (up to 92 days, all in the past) to see the digest." /> : (<>
      {data?.mode === 'day' && data?.original_date && data.original_date !== data.digest_date && (
        <p className="text-xs text-amber-600 mb-4">
          {data.original_date} falls on a weekend — showing the nearest working day, {data.digest_date}, instead.
        </p>
      )}

      {/* Needs attention — only what someone can act on, each one opens the thing it counts */}
      {!loading && data?.attention?.length > 0 && (
        <Card className="mb-5" data-tour="digest-notable-events">
          <CardHeader title={<span className="inline-flex items-center gap-2"><TriangleAlert size={15} className="text-amber-600" />Needs attention</span>} subtitle="Click one to see who and which leads" />
          <CardContent className="flex flex-wrap gap-2">
            {data.attention.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => onAttention(a)}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100"
              >
                <strong className="tabular-nums">{a.count}</strong> {a.label}
                {a.key !== 'stuck' && <ArrowRight size={13} className="text-amber-500" />}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {!loading && catalog.length > 0 && (
        <DigestViews catalog={catalog} keys={shownKeys} views={views} activeId={activeView}
          onPick={pickView} onApply={(k) => { setCustomKeys(k); setActiveView('custom'); }} onSave={saveView} onDelete={deleteView} canShare={['Super Admin', 'Admin', 'Pod Admin'].includes(window.__CRM_CURRENT_USER__?.role)} />
      )}

      {/* The numbers the chosen view shows */}
      <div className={`mb-3 grid grid-cols-2 sm:grid-cols-3 ${TILE_COLS[tiles.length] || TILE_COLS[5]} gap-4`} data-tour="digest-kpi-grid">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonMetricCard key={i} />)
          : tiles.map((item) => (
            <HeadlineTile
              key={item.key}
              item={item}
              kpi={data.kpi?.[item.key]}
              compareLabel={compareLabel}
              active={item.activity ? filters.activity === item.activity : false}
              onClick={() => { if (item.activity) { setFilter({ activity: item.activity }); toLeads(); } else toLeads(); }}
            />
          ))}
      </div>

      {/* Everything else, one click away rather than on screen */}
      {!loading && data?.kpi && (
        <details className="mb-6 group" data-tour="digest-pipeline-flow">
          <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 select-none">
            <ChevronDown size={14} className="transition group-open:rotate-180" /> More numbers and pipeline movement
          </summary>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Other numbers" subtitle={`This period, ${compareLabel}`} />
              <CardContent className="space-y-2">
                {otherNumbers.length === 0 && <p className="text-xs text-slate-400">Every number is already shown above.</p>}
                {otherNumbers.map((c) => {
                  const d = delta(data.kpi[c.key]);
                  return (
                    <div key={c.key} className="flex items-center justify-between text-sm" title={c.hint}>
                      <span className="text-slate-600">{c.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums text-slate-800">{data.kpi[c.key].today}</span>
                        <span className="text-xs text-slate-400">vs {data.kpi[c.key].compare}</span>
                        <Badge variant={d.variant}>{d.label}</Badge>
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader title="Pipeline movement" subtitle="Status changes in this period, most common first" />
              <CardContent>
                {data.pipeline_flow?.length ? (
                  <div className="space-y-2">
                    {data.pipeline_flow.slice(0, 8).map((t, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 min-w-0 flex-1">
                          <Badge className="shrink-0">{t.from_status}</Badge>
                          <ArrowRight size={12} className="text-slate-300 shrink-0" />
                          <Badge className="shrink-0">{t.to_status}</Badge>
                        </span>
                        <span className="font-semibold text-slate-700 tabular-nums shrink-0">{t.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No status changes" message="No leads moved between statuses in this period." />
                )}
              </CardContent>
            </Card>
          </div>
        </details>
      )}

      {/* Team — one row per rep, idle ones included; click a row to see just their leads */}
      <Card className="mb-5" data-tour="digest-sdr-snapshot">
        <div ref={teamRef} />
        <CardHeader
          title="Team"
          subtitle="Click a rep to see only their leads below"
          actions={team.length > TEAM_PAGE_SIZES[0] ? (
            <Select
              value={String(teamSize)}
              onChange={(v) => setTeamSize(Number(v))}
              ariaLabel="Reps per page"
              options={TEAM_PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} per page` }))}
            />
          ) : null}
        />
        <CardContent className="p-0">
          {loading ? (
            <SkeletonTable rows={4} cols={7} />
          ) : team.length ? (
            <>
            <Table>
              <TableHead>
                <TableRow>
                  <SortableTableHeader label="Rep" sortKey="name" sort={teamSort} onSort={toggleTeamSort} />
                  <SortableTableHeader label="Calls" sortKey="calls" sort={teamSort} onSort={toggleTeamSort} />
                  <SortableTableHeader label="Emails" sortKey="emails" sort={teamSort} onSort={toggleTeamSort} />
                  <SortableTableHeader label="Research notes" sortKey="research_notes" sort={teamSort} onSort={toggleTeamSort} />
                  <SortableTableHeader label="Meetings" sortKey="meetings" sort={teamSort} onSort={toggleTeamSort} />
                  <SortableTableHeader label="Leads touched" sortKey="leads_touched" sort={teamSort} onSort={toggleTeamSort} />
                  <SortableTableHeader label="Overdue follow-ups" sortKey="overdue_follow_ups" sort={teamSort} onSort={toggleTeamSort} />
                </TableRow>
              </TableHead>
              <TableBody>
                {shownTeam.map((r) => (
                  <TableRow
                    key={r.user_id}
                    onClick={() => { setFilter({ rep: filters.rep === r.user_id ? '' : r.user_id }); toLeads(); }}
                    className={`cursor-pointer ${filters.rep === r.user_id ? 'bg-blue-50' : ''} ${idleIds.includes(r.user_id) ? 'bg-amber-50/50' : ''}`}
                  >
                    <TableCell className="font-semibold text-slate-700">
                      {r.name}
                      {r.left && <span className="ml-2 align-middle"><Badge>Left</Badge></span>}
                      {r.no_activity && !r.left && <span className="ml-2 align-middle"><Badge variant="warning">No activity</Badge></span>}
                    </TableCell>
                    <TableCell title={`${compareLabel}: ${r.calls_last_week}`}>{r.calls}</TableCell>
                    <TableCell title={`${compareLabel}: ${r.emails_last_week}`}>{r.emails}</TableCell>
                    <TableCell title={`${compareLabel}: ${r.research_notes_last_week}`}>{r.research_notes}</TableCell>
                    <TableCell title={`${compareLabel}: ${r.meetings_last_week}`}>{r.meetings}</TableCell>
                    <TableCell>{r.leads_touched}</TableCell>
                    <TableCell>{r.overdue_follow_ups ? <Badge variant="danger">{r.overdue_follow_ups}</Badge> : <span className="text-slate-400">0</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {team.length > teamSize && (
              <div className="px-4 pb-3">
                <Pagination page={tp} pages={teamPages} total={team.length} perPage={teamSize} onChange={setTeamPage} />
              </div>
            )}
            </>
          ) : (
            <EmptyState title="No reps" message="There are no active reps in this view." />
          )}
        </CardContent>
      </Card>

      {/* Campaigns — the campaign tag on every lead worked in this period; click one to see just its leads */}
      <Card className="mb-5" data-tour="digest-campaigns">
        <CardHeader title="Campaigns" subtitle="What was worked, by the campaign each lead belongs to. Leads with no campaign tag are shown too." />
        <CardContent>
          {loading ? (
            <SkeletonTable rows={3} cols={6} />
          ) : (data?.campaigns || NO_ROWS).length ? (
            <>
              {(data.campaigns.length > 8) && (
                <div className="mb-3">
                  <SearchInput className="w-72" placeholder="Search campaigns…" aria-label="Search campaigns" value={campaigns.query} onChange={(e) => campaigns.setQuery(e.target.value)} />
                </div>
              )}
              <Table>
                <TableHead>
                  <TableRow>
                    <SortableTableHeader label="Campaign" sortKey="campaign" sort={campaigns.sort} onSort={campaigns.toggleSort} />
                    <SortableTableHeader label="Leads touched" sortKey="leads_touched" sort={campaigns.sort} onSort={campaigns.toggleSort} />
                    <SortableTableHeader label="Calls" sortKey="calls" sort={campaigns.sort} onSort={campaigns.toggleSort} />
                    <SortableTableHeader label="Emails" sortKey="emails" sort={campaigns.sort} onSort={campaigns.toggleSort} />
                    <SortableTableHeader label="Notes" sortKey="notes" sort={campaigns.sort} onSort={campaigns.toggleSort} />
                    <SortableTableHeader label="Meetings booked" sortKey="meetings_booked" sort={campaigns.sort} onSort={campaigns.toggleSort} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {campaigns.shown.map((c) => (
                    <TableRow key={c.campaign} onClick={() => { setFilter({ campaign: filters.campaign === c.campaign ? '' : c.campaign }); toLeads(); }}
                      className={`cursor-pointer ${filters.campaign === c.campaign ? 'bg-blue-50' : ''}`}>
                      <TableCell className="font-semibold text-slate-700">
                        {c.campaign}
                        {c.campaign === 'No campaign' && <span className="ml-2 align-middle"><Badge variant="warning">Untagged</Badge></span>}
                      </TableCell>
                      <TableCell>{c.leads_touched}</TableCell>
                      <TableCell>{c.calls}</TableCell>
                      <TableCell>{c.emails}</TableCell>
                      <TableCell>{c.notes}</TableCell>
                      <TableCell>{c.meetings_booked}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {campaigns.total > campaigns.pageSize && (
                <Pagination page={campaigns.page} pages={campaigns.pages} total={campaigns.total} perPage={campaigns.pageSize} onChange={campaigns.setPage} />
              )}
            </>
          ) : (
            <EmptyState title="No campaign activity" message="No leads were worked in this period." />
          )}
        </CardContent>
      </Card>

      <FunnelSection podId={podId} range={data?.from ? { from: data.from, to: data.to } : null} />

      <DrillDownSection podId={podId} range={data?.from ? { from: data.from, to: data.to } : null} />

      {/* Leads touched — filtered and paged on the server; overdue follow-ups first */}
      <Card className="mb-5" data-tour="digest-lead-activity">
        <div ref={leadsRef} />
        <CardHeader
          title="Leads touched"
          subtitle={summary ? `${summary.total} in this period · ${summary.overdue} overdue follow-up${summary.overdue === 1 ? '' : 's'} · ${summary.meetings} with a meeting booked` : 'Calls, emails, research notes and meetings, lead by lead'}
        />
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
            <SearchInput
              className="w-64"
              placeholder="Search lead or company"
              aria-label="Search leads touched"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
            <Select
              value={filters.rep}
              onChange={(v) => setFilter({ rep: v })}
              ariaLabel="Rep"
              searchable={team.length > 20}
              options={[{ value: '', label: 'All reps' }, ...team.map((r) => ({ value: r.user_id, label: r.name }))]}
            />
            <Select value={filters.followUp} onChange={(v) => setFilter({ followUp: v })} ariaLabel="Follow-up" options={FOLLOW_UPS} />
            <Select
              value={filters.campaign}
              onChange={(v) => setFilter({ campaign: v })}
              ariaLabel="Campaign"
              searchable
              options={[{ value: '', label: 'All campaigns' }, ...(data?.campaign_options || NO_ROWS).map((c) => ({ value: c, label: c }))]}
            />
            {filters.activity && (
              <Badge variant="info" className="inline-flex items-center gap-1">
                With {ACTIVITY_LABEL[filters.activity].toLowerCase()}
                <button type="button" aria-label="Clear activity filter" onClick={() => setFilter({ activity: '' })}><X size={12} /></button>
              </Badge>
            )}
            {filters.rep && repName && (
              <Badge variant="info" className="inline-flex items-center gap-1">
                {repName}
                <button type="button" aria-label="Clear rep filter" onClick={() => setFilter({ rep: '' })}><X size={12} /></button>
              </Badge>
            )}
            {anyFilter && <Button size="sm" variant="ghost" onClick={clearFilters}>Clear all</Button>}
          </div>

          {leads === null ? (
            <SkeletonTable rows={5} cols={6} />
          ) : leads.items.length ? (
            <div className={leads.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>Lead</TableHeader>
                    <TableHeader>Rep</TableHeader>
                    <TableHeader>Campaign</TableHeader>
                    <TableHeader>What happened</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Follow-up</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {leads.items.map((r) => (
                    <TableRow key={`${r.rep_id}-${r.lead_id}`} onClick={() => openLead(r.lead_id)} className="cursor-pointer">
                      <TableCell>
                        <div className="font-semibold text-slate-800">{r.lead}</div>
                        <div className="text-xs text-slate-500">{r.company}</div>
                      </TableCell>
                      <TableCell>{r.rep}</TableCell>
                      <TableCell>{r.campaign === 'No campaign' ? <span className="text-slate-400">—</span> : <Badge variant="info">{r.campaign}</Badge>}</TableCell>
                      <TableCell>
                        {whatHappened(r)}
                        {r.meeting_booked && <span className="ml-2 align-middle"><Badge variant="success">Meeting booked</Badge></span>}
                      </TableCell>
                      <TableCell><Badge>{r.status}</Badge></TableCell>
                      <TableCell>{followUpBadge(r)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="px-5 pb-4">
                <Pagination page={leads.page || page} pages={leads.pages || 1} total={leads.total} perPage={PER_PAGE} onChange={setPage} />
              </div>
            </div>
          ) : (
            <EmptyState
              title={anyFilter ? 'No leads match these filters' : 'No lead activity'}
              message={anyFilter ? 'Try clearing a filter.' : 'No calls, emails, notes or meetings on leads in this period.'}
              action={anyFilter ? <Button size="sm" variant="outline" onClick={clearFilters}>Clear filters</Button> : undefined}
            />
          )}
        </CardContent>
      </Card>

      {/* Not period-scoped — kept last and labelled so it is not read as part of the period */}
      {loading ? (
        <SkeletonCard><SkeletonText lines={2} /></SkeletonCard>
      ) : statusEntries.length > 0 && (
        <Card>
          <CardHeader title="Current pipeline" subtitle="Where every lead stands right now — not specific to the selected period" />
          <CardContent className="flex flex-wrap gap-2">
            {statusEntries.map(([status, count]) => (
              <span key={status} className="inline-flex items-center gap-1.5">
                <Badge>{status}</Badge>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">{count}</span>
              </span>
            ))}
          </CardContent>
        </Card>
      )}
      </>)}
    </div>
  );
}
