import React, { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import {
  Trophy, TriangleAlert, CircleCheck, TrendingUp, Target, PhoneCall, ClipboardCheck, Info, Sparkles, Activity, ArrowRight,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { AnalyticsService, LeadsService, LeaderboardService } from '../../services/api';

Chart.register(...registerables);

export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const go = (onNavigate, view) => (typeof onNavigate === 'function' ? onNavigate(view) : window._loadView?.(view));

// Secondary cards load staggered after the main stats call (RCA 2026-06-17: fanning out ~7 requests at once caused an OOM).
function useStaggered(delayMs, fn) {
  const [state, setState] = useState({ data: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      let data = null;
      try { data = await fn(); } catch { data = null; }
      if (!cancelled) setState({ data, loading: false });
    }, delayMs);
    return () => { cancelled = true; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

// ─── Insight badges (rule engine over the stats) ────────────────────────────────────────────────────────────────
export function runRuleEngine(stats) {
  if (!stats) return [];
  const leads = stats.total ?? 0;
  const sc = stats.status_counts ?? {};
  const calls = sc.Calling ?? 0;
  const meetings = (sc['Meeting Scheduled'] ?? 0) + (sc['Demo Scheduled'] ?? 0) + (sc['Demo Done'] ?? 0);
  const disq = sc.Disqualified ?? 0;
  const out = [];
  if (leads > 10 && calls === 0) out.push({ icon: TriangleAlert, text: `${fmt(leads)} leads assigned with no calls`, level: 'warning' });
  else if (leads > 20 && calls < leads * 0.3) out.push({ icon: TriangleAlert, text: `Only ${Math.round((calls / leads) * 100)}% of leads called`, level: 'warning' });
  if (calls >= 20 && meetings === 0) out.push({ icon: Target, text: `${fmt(calls)} calls logged but 0 meetings booked`, level: 'warning' });
  else if (calls >= 10 && meetings > 0 && Math.round(calls / meetings) > 30) out.push({ icon: Target, text: `${Math.round(calls / meetings)} calls per meeting — high effort`, level: 'warning' });
  if (leads > 5 && disq / leads > 0.35) out.push({ icon: TriangleAlert, text: `${Math.round((disq / leads) * 100)}% disqualification rate`, level: 'warning' });
  if (calls > 0 && meetings > 0) out.push({ icon: TrendingUp, text: `${meetings} meetings booked · ${Math.round((meetings / calls) * 100)}% call-to-meeting rate`, level: 'success' });
  const seen = new Set();
  return out.filter((i) => (seen.has(i.text) ? false : seen.add(i.text))).slice(0, 3);
}

export function InsightBadges({ stats }) {
  const insights = runRuleEngine(stats);
  if (!insights.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-4" data-testid="insights">
      {insights.map((i) => (
        <Badge key={i.text} variant={i.level} className="gap-1.5 px-3 py-1.5 text-xs"><i.icon size={13} />{i.text}</Badge>
      ))}
    </div>
  );
}

// ─── Meetings booked over time ──────────────────────────────────────────────────────────────────────────────────
export function MeetingsChartCard() {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [range, setRange] = useState('7D');
  const { data, loading } = useStaggered(200, async () => {
    const [r7, r30] = await Promise.all([
      AnalyticsService.getTrend({ preset: '7d' }).catch(() => null),
      AnalyticsService.getTrend({ preset: '30d' }).catch(() => null),
    ]);
    return { r7, r30 };
  });
  const raw = range === '7D' ? data?.r7 : data?.r30;
  const series = Array.isArray(raw?.series) ? raw.series : [];
  const values = series.map((p) => p.meetings ?? 0);
  const total = values.reduce((a, b) => a + b, 0);

  useEffect(() => {
    if (loading || !canvasRef.current) return undefined;
    const labels = series.map((d) => {
      const dt = new Date(d.period);
      if (Number.isNaN(dt.getTime())) return d.period;
      return range === '7D' ? dt.toLocaleDateString('en-GB', { weekday: 'short' }) : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    });
    const ctx = canvasRef.current.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(37,99,235,0.18)');
    gradient.addColorStop(1, 'rgba(37,99,235,0)');
    chartRef.current?.destroy();
    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ data: values, borderColor: '#2563EB', borderWidth: 2, backgroundColor: gradient, fill: true, tension: 0.4,
        pointBackgroundColor: '#fff', pointBorderColor: '#2563EB', pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#fff', titleColor: '#0F172A', bodyColor: '#2563EB', borderColor: '#E2E8F0', borderWidth: 1, cornerRadius: 8, padding: 10,
          callbacks: { label: (item) => ` ${item.raw} meeting${item.raw !== 1 ? 's' : ''}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94A3B8', font: { size: 10 }, maxRotation: 0 }, border: { display: false } },
          y: { beginAtZero: true, grid: { color: '#F1F5F9' }, ticks: { color: '#94A3B8', font: { size: 10 }, stepSize: 3 }, border: { display: false } },
        },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, range, data]);

  return (
    <Card>
      <CardHeader
        title="Meetings booked"
        subtitle="Meetings scheduled over time"
        actions={['7D', '30D'].map((r) => (
          <Button key={r} size="sm" variant={range === r ? 'primary' : 'outline'} onClick={() => setRange(r)}>{r}</Button>
        ))}
      />
      <CardContent>
        {loading ? <Skeleton className="h-[220px] w-full" /> : <div className="relative h-[220px]"><canvas ref={canvasRef} /></div>}
        {!loading && (
          <div className="flex gap-2 mt-3">
            <Badge>Total {total}</Badge>
            <Badge>Peak {values.length ? Math.max(...values) : 0}</Badge>
            <Badge>Avg/day {values.length ? (total / values.length).toFixed(1) : '0.0'}</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Leaderboard (top 5) ────────────────────────────────────────────────────────────────────────────────────────
export function LeaderboardCard({ onNavigate }) {
  const { data, loading } = useStaggered(400, async () => {
    const rows = await LeaderboardService.getTop();
    return Array.isArray(rows) ? rows.slice(0, 5) : [];
  });
  const rows = data || [];
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Trophy size={15} className="text-amber-500" />Leaderboard</span>}
        subtitle="Top performers by meetings"
        actions={<Button size="sm" variant="ghost" onClick={() => go(onNavigate, 'leaderboard')}>View all <ArrowRight size={13} /></Button>}
      />
      <div className="px-2 py-1">
        {loading && Array.from({ length: 5 }).map((_, i) => <div key={i} className="px-3 py-2.5"><Skeleton className="h-8 w-full" /></div>)}
        {!loading && rows.length === 0 && <EmptyState icon={Trophy} title="No leaderboard data yet" className="py-6" />}
        {!loading && rows.map((row, i) => {
          const name = row.name || row.sdr_name;
          return (
            <div key={`${name}-${i}`} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50">
              <span className="w-5 text-center text-xs font-bold text-slate-400">{row.rank ?? i + 1}</span>
              <Avatar name={name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800 truncate">{name}{row.left && ' '}{row.left && <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold text-slate-500" title="This person has left — their access was removed">Left</span>}</div>
                {row.pod_name && <div className="text-xs text-slate-400 truncate">{row.pod_name}</div>}
              </div>
              <div className="text-right">
                <div className="text-sm font-extrabold text-slate-900">{row.meetings_scheduled ?? 0}</div>
                <div className="text-[11px] text-slate-400">meetings</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Needs attention (admins) ───────────────────────────────────────────────────────────────────────────────────
export function NeedsAttentionCard() {
  const { data, loading } = useStaggered(600, async () => {
    const res = await AnalyticsService.getSdrTable({ preset: '1d' });
    const list = Array.isArray(res?.sdrs) ? res.sdrs : [];
    // No calls AND no emails today (someone who left needs no nudge). The pod's own calendar day is applied server-side.
    return list.filter((s) => !s.left && (s.calls_made ?? 0) === 0 && (s.emails_sent ?? 0) === 0);
  });
  const sdrs = data || [];
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><TriangleAlert size={15} className="text-amber-600" />Needs attention</span>} subtitle="SDRs with no calls or emails today" />
      <div className="px-2 py-1">
        {loading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="px-3 py-2.5"><Skeleton className="h-8 w-full" /></div>)}
        {!loading && sdrs.length === 0 && <EmptyState icon={CircleCheck} title="All SDRs are active today" className="py-6" />}
        {!loading && sdrs.slice(0, 8).map((s, i) => {
          const name = s.name || s.sdr_name || 'SDR';
          return (
            <div key={`${name}-${i}`} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50">
              <Avatar name={name} size={30} />
              <span className="flex-1 text-sm font-semibold text-slate-800 truncate">{name}</span>
              <Badge variant="warning">No activity today</Badge>
            </div>
          );
        })}
      </div>
      {!loading && sdrs.length > 0 && <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">{sdrs.length} SDR{sdrs.length > 1 ? 's' : ''} need a nudge{sdrs.length > 8 ? ` · showing 8` : ''}</div>}
    </Card>
  );
}

// ─── Pipeline by stage + AI health ──────────────────────────────────────────────────────────────────────────────
const STAGES = [
  ['Lead Assigned', 'bg-blue-500'], ['Calling', 'bg-emerald-600'], ['Meeting Scheduled', 'bg-amber-500'],
  ['Demo Scheduled', 'bg-indigo-500'], ['Demo Done', 'bg-teal-600'], ['Completed', 'bg-green-600'], ['Disqualified', 'bg-slate-400'],
];
const AI_METRICS = [
  ['velocity', 'Pipeline velocity', TrendingUp, 'text-blue-700'],
  ['conversion', 'Conversion rate', Target, 'text-green-700'],
  ['health', 'Call connect rate', PhoneCall, 'text-purple-700'],
  ['efficiency', 'Research readiness', ClipboardCheck, 'text-amber-700'],
];
const shortMetric = (raw) => {
  if (raw == null) return '—';
  const s = String(raw);
  const lead = s.match(/^([\d,.]+%?)/);
  return lead ? lead[1] : (s.length > 12 ? `${s.slice(0, 10)}…` : s);
};

export function PipelineCard({ statusCounts = {}, total = 0, loading: statsLoading, onStage }) {
  const { data: gi, loading: giLoading } = useStaggered(800, () => LeadsService.getGrowthIntelligence());
  const score = gi?.ai?.health_score ?? null;
  const byCat = Object.fromEntries((Array.isArray(gi?.ai?.insights) ? gi.ai.insights : []).map((i) => [i.category, i]));
  const rows = STAGES.map(([label, color]) => ({ label, color, count: statusCounts[label] ?? 0 }))
    .filter((r) => r.count > 0 || r.label === 'Lead Assigned');
  const scoreVariant = score == null ? 'default' : score >= 60 ? 'success' : score >= 35 ? 'warning' : 'danger';
  return (
    <Card>
      <CardHeader
        title="Pipeline intelligence"
        subtitle="Live stage distribution · AI health scoring"
        actions={!giLoading && score !== null && <Badge variant={scoreVariant} className="gap-1"><Activity size={12} />Health {score}/100</Badge>}
      />
      <CardContent>
        {statsLoading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full mb-3" />)
          : rows.map((r) => (
            <button key={r.label} type="button" onClick={() => onStage?.(r.label)} title={`Open ${r.label} leads`}
              className="w-full flex items-center gap-3 mb-1 px-1 py-1 rounded-md text-left hover:bg-slate-50">
              <span className="w-36 text-xs font-medium text-slate-600 shrink-0">{r.label}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${r.color}`} style={{ width: `${Math.max(total ? (r.count / total) * 100 : 0, r.count > 0 ? 1 : 0)}%` }} />
              </div>
              <span className="w-14 text-right text-xs font-bold text-slate-700">{fmt(r.count)}</span>
            </button>
          ))}
      </CardContent>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 py-3 border-t border-slate-100">
        {AI_METRICS.map(([cat, label, Icon, color]) => {
          const ins = byCat[cat];
          const trend = ins?.trend;
          return (
            <div key={cat}>
              <div className={`flex items-center gap-1 text-[11px] font-semibold ${color}`}><Icon size={12} />{label}</div>
              {giLoading ? <Skeleton className="h-5 w-12 mt-1" /> : (
                <div className="text-base font-extrabold text-slate-900">
                  {shortMetric(ins?.metric_value)}
                  {trend === 'up' && <span className="text-green-600 text-xs ml-1">↑</span>}
                  {trend === 'down' && <span className="text-red-600 text-xs ml-1">↓</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1"><Info size={11} />Pipeline bars: live CRM data · Health metrics: 30-day rolling window</span>
        <span className="inline-flex items-center gap-1"><Sparkles size={11} />AI-scored</span>
      </div>
    </Card>
  );
}
