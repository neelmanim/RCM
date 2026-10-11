/**
 * Dashboard — the landing page for every role except CSM. Built entirely from components/ui/* and lucide icons
 * (the page used to carry ~1,000 lines of its own db-* CSS, inline SVG and emoji). The cards live in
 * features/dashboard/*; this file owns the data load, the role split and the header controls.
 *
 * Reps (SDR/AE): cards that say what they count + My Day (what was given to me / what I did).
 * Pod Admin / Super Admin: org or pod KPIs, insights, meetings trend, pipeline, leaderboard, needs-attention.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Download, Lock, Globe, ClipboardList, Inbox, PhoneMissed, PhoneCall, CalendarCheck, Users,
  Presentation, BadgeCheck, PhoneOff, CircleCheck, TriangleAlert, ChevronDown, Hand, PhoneOutgoing, Phone,
} from 'lucide-react';
import { LeadsService, MyDayService } from '../services/api';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { SkeletonMetricCard } from '../components/ui/Skeleton';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../components/ui/DropdownMenu';
import { StatStrip } from '../features/activity-monitor/components/StatStrip';
import { exportCsv } from '../features/activity-monitor/lib/exportCsv';
import { getGreeting, getFirstName } from '../utils/greeting';
import { OutboundRepliesCard } from './OutboundRepliesCard';
import { DashboardTour } from '../features/dashboard/DashboardTour';
import { openLeads } from '../features/dashboard/openLeads';
import { MyDayCard } from '../features/dashboard/MyDayCard';
import {
  InsightBadges, MeetingsChartCard, LeaderboardCard, NeedsAttentionCard, PipelineCard, fmt,
} from '../features/dashboard/cards';
import { useCanExport } from '../lib/useCanExport';

const SESSION_GREETED = 'ls_session_greeted';
const go = (onNavigate, view) => (typeof onNavigate === 'function' ? onNavigate(view) : window._loadView?.(view));

export const Dashboard = ({ onLeadClick, onNavigate, userName = '', userRole = '' }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorLog, setErrorLog] = useState(null);     // { total } — Super Admin only
  const [myDay, setMyDay] = useState(null);           // today's My Day summary, reported up by the card
  const [lifecycle, setLifecycle] = useState(null);     // my leads by state (reps only)
  const [refreshKey, setRefreshKey] = useState(0);
  const [globalView, setGlobalView] = useState(false); // Pod Admin: always opens on "My Pod"

  const role = (userRole || '').toLowerCase();
  const isSuperAdmin = ['super_admin', 'super admin', 'admin'].includes(role);
  const isPodAdmin = role.includes('pod');
  const isRep = !isSuperAdmin && !isPodAdmin;

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [data, el] = await Promise.all([
        LeadsService.getDashboardStats(globalView, Date.now()),
        isSuperAdmin ? LeadsService.getErrorLogSummary(24).catch(() => null) : Promise.resolve(null),
      ]);
      setStats(data);
      if (isSuperAdmin) setErrorLog(el);
    } catch (err) {
      const detail = err?.response?.data?.detail || (err?.code === 'ERR_CANCELED' ? 'Request timed out' : err?.message) || 'Check API connectivity';
      setError(`Failed to load dashboard metrics: ${detail}`);
    } finally {
      setLoading(false);
    }
  }, [globalView, isSuperAdmin]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isRep) MyDayService.lifecycle().then((d) => setLifecycle(d.counts)).catch(() => setLifecycle(null));
  }, [isRep, refreshKey]);
  useEffect(() => { try { sessionStorage.setItem(SESSION_GREETED, '1'); } catch { /* storage blocked */ } }, []);

  const refresh = () => { load(); setRefreshKey((k) => k + 1); };

  const sc = stats?.status_counts ?? {};
  const total = stats?.total ?? 0;
  const meetingsPlus = (sc['Meeting Scheduled'] ?? 0) + (sc['Demo Scheduled'] ?? 0) + (sc['Demo Done'] ?? 0) + (sc.Completed ?? 0);

  // Every number opens the thing it counts. Plain statuses become a Leads filter; "Given today" / "Not yet called" are
  // server-side views (the same code My Day counts with), so the list always has exactly the number on the card.
  const toLeads = (opts) => () => openLeads(onNavigate, opts);
  // Today in the person's own timezone, known without waiting for My Day to load (so the tile is clickable at once).
  const utc = (d) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  const todaySmart = { key: 'given_today', label: 'Given to you today', from: utc(dayStart), to: utc(dayEnd) };
  const MEETING_STATUSES = ['Meeting Scheduled', 'Demo Scheduled', 'Demo Done', 'Completed'];
  const repTiles = [
    { label: 'Assigned to me', value: fmt(total), icon: ClipboardList, iconClass: 'bg-blue-50 text-blue-600', caption: lifecycle ? `${fmt(lifecycle['New to me'])} new · ${fmt(lifecycle.Inherited)} inherited · ${fmt(lifecycle['In progress'])} in progress` : 'All leads with you right now',
      onClick: toLeads({}), hint: 'Open all your leads' },
    { label: 'Given today', value: fmt(myDay?.given?.total), icon: Inbox, iconClass: 'bg-indigo-50 text-indigo-600', valueClass: 'text-indigo-700',
      caption: myDay ? `${fmt(myDay.given.assigned)} assigned · ${fmt(myDay.given.reset)} reset` : 'New or reset today',
      onClick: toLeads({ smart: todaySmart }), hint: 'Open the leads given to you today' },
    { label: 'Not yet called', value: fmt(myDay?.now?.not_yet_called), icon: PhoneMissed, iconClass: 'bg-amber-50 text-amber-600', valueClass: 'text-amber-600', caption: 'Never called — start here',
      onClick: toLeads({ smart: { key: 'not_yet_called', label: 'Leads nobody has called yet' } }), hint: 'Open the leads nobody has called yet' },
    { label: 'Calls today', value: fmt(myDay?.did?.calls), icon: Phone, iconClass: 'bg-sky-50 text-sky-600', valueClass: 'text-sky-700', caption: 'Open the Power Dialer for the call list',
      onClick: () => go(onNavigate, 'my-calls'), hint: "Today's calls and outcomes live in the Power Dialer" },
    { label: 'Calling stage', value: fmt(sc.Calling ?? 0), icon: PhoneCall, iconClass: 'bg-emerald-50 text-emerald-600', valueClass: 'text-emerald-700', caption: 'In the Calling status',
      onClick: toLeads({ statuses: ['Calling'] }), hint: 'Open leads in Calling' },
    { label: 'Meetings+', value: fmt(meetingsPlus), icon: CalendarCheck, iconClass: 'bg-purple-50 text-purple-600', valueClass: 'text-purple-700', caption: 'Meeting stage or beyond',
      onClick: toLeads({ statuses: MEETING_STATUSES }), hint: 'Open leads at meeting stage or beyond' },
  ];
  const adminTiles = [
    { label: 'Total leads', value: fmt(total), icon: Users, iconClass: 'bg-blue-50 text-blue-600', caption: 'All sources', onClick: toLeads({}), hint: 'Open all leads' },
    { label: 'Calling', value: fmt(sc.Calling ?? 0), icon: PhoneCall, iconClass: 'bg-emerald-50 text-emerald-600', valueClass: 'text-emerald-700', caption: 'Active calling', onClick: toLeads({ statuses: ['Calling'] }), hint: 'Open leads in Calling' },
    { label: 'Meetings+', value: fmt(sc['Meeting Scheduled'] ?? 0), icon: CalendarCheck, iconClass: 'bg-amber-50 text-amber-600', valueClass: 'text-amber-600', caption: 'Qualified pipeline', onClick: toLeads({ statuses: ['Meeting Scheduled'] }), hint: 'Open leads with a meeting scheduled' },
    { label: 'Lead assigned', value: fmt(sc['Lead Assigned'] ?? 0), icon: ClipboardList, iconClass: 'bg-blue-50 text-blue-600', caption: 'Awaiting research', onClick: toLeads({ statuses: ['Lead Assigned'] }), hint: 'Open leads in Lead Assigned' },
    { label: 'Demo scheduled', value: fmt(sc['Demo Scheduled'] ?? 0), icon: Presentation, iconClass: 'bg-indigo-50 text-indigo-600', caption: 'Pipeline', onClick: toLeads({ statuses: ['Demo Scheduled'] }), hint: 'Open leads with a demo scheduled' },
    { label: 'Demos done', value: fmt((sc['Demo Done'] ?? 0) + (sc.Completed ?? 0)), icon: BadgeCheck, iconClass: 'bg-teal-50 text-teal-600', caption: 'Synced to Salesforce', onClick: toLeads({ statuses: ['Demo Done', 'Completed'] }), hint: 'Open leads with a demo done' },
    { label: 'No phone', value: fmt(stats?.parked_count ?? 0), icon: PhoneOff, iconClass: 'bg-red-50 text-red-600', valueClass: 'text-red-600', caption: 'Needs attention', alert: (stats?.parked_count ?? 0) > 0, onClick: toLeads({ statuses: ['No Phone - Parked'] }), hint: 'Open leads parked for no phone number' },
  ];
  const tiles = isRep ? repTiles : adminTiles;
  const gridCols = isRep ? '2xl:grid-cols-6' : 'xl:grid-cols-4 2xl:grid-cols-7';

  const canExport = useCanExport();
  // Share-ready snapshot of exactly what is on screen (the KPI tiles + pipeline stages).
  const exportSnapshot = () => exportCsv({
    rows: [
      ...tiles.map((t) => ({ metric: t.label, value: t.value, note: t.caption })),
      ...Object.entries(sc).map(([stage, count]) => ({ metric: `Stage: ${stage}`, value: count, note: '' })),
    ],
    columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }, { key: 'note', label: 'Note' }],
    filenamePrefix: `dashboard-${(userName || 'me').toLowerCase().replace(/\s+/g, '-')}`,
  });

  return (
    <div className="dashboard-hub-root bg-slate-50 min-h-full px-6 py-5">
      {!loading && <DashboardTour isRep={isRep} />}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="db-page-title text-xl font-bold text-slate-900 m-0">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5 m-0">
            {loading ? 'Loading…'
              : isRep ? `My Dashboard · ${fmt(total)} my leads`
                : isPodAdmin ? `${globalView ? 'Global view' : 'My Pod view'} — ${fmt(total)} leads`
                  : `Org-wide view · ${fmt(total)} total leads`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isPodAdmin && (
            <div className="flex gap-1" role="group" aria-label="Dashboard scope">
              <Button size="sm" variant={!globalView ? 'primary' : 'outline'} onClick={() => setGlobalView(false)} title="Show only your pod's data"><Lock size={13} /> My Pod</Button>
              <Button size="sm" variant={globalView ? 'primary' : 'outline'} onClick={() => setGlobalView(true)} title="Show all org-wide data"><Globe size={13} /> Global</Button>
            </div>
          )}
          {isRep && <Button size="sm" onClick={() => go(onNavigate, 'my-calls')} data-tour="dashboard-dial"><PhoneOutgoing size={14} /> Start calling</Button>}
          {canExport && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={loading} data-tour="dashboard-export"><Download size={14} /> Export <ChevronDown size={13} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={exportSnapshot}><Download size={14} /> Dashboard snapshot (CSV)</DropdownMenuItem>
              {!isRep && <DropdownMenuItem onSelect={() => MyDayService.exportActivity(7)}><Download size={14} /> Raw calls + meetings, last 7 days (Excel)</DropdownMenuItem>}
              {isRep && <DropdownMenuItem onSelect={() => MyDayService.exportCsv()}><Download size={14} /> My Day — today (CSV)</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>}
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading} aria-label="Refresh dashboard">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="mb-4 px-4 py-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 border-red-200"><TriangleAlert size={15} />{error}</Card>
      )}

      {userName && (
        <Card className="mb-4 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-blue-50/60 border-blue-100">
          <div className="flex items-center gap-2">
            <Hand size={18} className="text-blue-600" />
            <div>
              <div className="text-sm font-bold text-slate-900">{getGreeting()}, {getFirstName(userName)}</div>
              <div className="text-xs text-slate-500">
                {isSuperAdmin ? "Here's your org-wide pipeline" : isPodAdmin ? "Your pod's pipeline" : 'Good to have you back'} ·{' '}
                {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </div>
            </div>
          </div>
          {!loading && !isRep && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">{fmt(sc.Calling ?? 0)} Calling</Badge>
              <Badge variant="primary">{fmt(sc['Meeting Scheduled'] ?? 0)} Meetings+</Badge>
              {isSuperAdmin && errorLog !== null && ((errorLog?.total ?? 0) > 0
                ? <Badge variant="danger" className="gap-1"><TriangleAlert size={11} />{fmt(errorLog.total)} error{errorLog.total !== 1 ? 's' : ''} · 24h</Badge>
                : <Badge variant="success" className="gap-1"><CircleCheck size={11} />Clean · 24h</Badge>)}
            </div>
          )}
        </Card>
      )}

      {!loading && !isRep && <InsightBadges stats={stats} />}

      {loading
        ? <div className={`grid gap-4 mb-5 grid-cols-2 md:grid-cols-3 ${gridCols}`}>{tiles.map((t) => <SkeletonMetricCard key={t.label} />)}</div>
        : <div data-tour="dashboard-kpis"><StatStrip tiles={tiles} columns={`grid-cols-2 md:grid-cols-3 ${gridCols}`} /></div>}

      <div className="grid gap-4 grid-cols-1 xl:grid-cols-3" key={`bento-${globalView}`}>
        <div className="xl:col-span-2 flex flex-col gap-4 min-w-0">
          {isRep ? (
            <>
              <div data-tour="dashboard-my-day"><MyDayCard onLeadClick={onLeadClick} onSummary={setMyDay} refreshKey={refreshKey} /></div>
            </>
          ) : (
            <>
              <MeetingsChartCard />
              <PipelineCard statusCounts={sc} total={total} loading={loading} onStage={(stage) => openLeads(onNavigate, { statuses: [stage] })} />
            </>
          )}
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <div data-tour="dashboard-leaderboard"><LeaderboardCard onNavigate={onNavigate} /></div>
          {!isRep && <NeedsAttentionCard />}
          <OutboundRepliesCard userRole={userRole} />
        </div>
      </div>
    </div>
  );
};
