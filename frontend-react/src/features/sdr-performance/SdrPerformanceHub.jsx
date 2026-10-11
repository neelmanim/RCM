import {
  ArrowLeft, ClipboardList, Flame, CircleCheck, Phone, BarChart3,
  CalendarCheck, TrendingUp, Timer, CalendarDays, TriangleAlert,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { DateRangePicker } from '../../components/ui/DateRangePicker';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonCard, SkeletonText } from '../../components/ui/Skeleton';
import { CallsService } from '../../services/api';

/**
 * SDR performance drill-down — the page Leaderboard opens when a name is
 * clicked. Port of legacy frontend/js/views/sdr_performance.js, same
 * fetchSdrPerformance(sdrId, {period, start_date, end_date}) contract and the
 * same four preset periods plus a custom range.
 *
 * Access control is entirely server-side (GET /api/sdr-performance/{id}):
 * SDR/AE get a 403 on anyone but themselves, Pod Admin is scoped to their own
 * pod. Nothing is re-checked here — same trust boundary as the legacy page.
 */
const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'all_time', label: 'All Time' },
];

const FUNNEL_COLORS = {
  'Lead Assigned': '#6366f1',
  'Research': '#8b5cf6',
  'Calling': '#3b82f6',
  'Meeting Scheduled': '#10b981',
  '1st Discovery Meeting': '#a855f7',
  'Discovery Complete': '#7c3aed',
  'Demo Scheduled': '#0ea5e9',
  'Demo Done': '#059669',
  'Completed': '#16a34a',
  'Disqualified': '#ef4444',
};

function formatHours(hours) {
  if (hours == null) return '—';
  return hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`;
}

function MetricCard({ icon: Icon, label, value, color }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Icon size={16} color={color} />
          <span className="text-[0.78rem] font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-[1.6rem] font-extrabold leading-none" style={{ color }}>{value}</div>
      </CardContent>
    </Card>
  );
}

function FunnelBar({ stage, count, total }) {
  const pct = Math.round((count / (total || 1)) * 100);
  const color = FUNNEL_COLORS[stage] || '#94a3b8';
  return (
    <div className="flex items-center gap-3 mb-2.5">
      <div className="w-40 text-right text-[0.82rem] font-semibold text-slate-800 shrink-0">{stage}</div>
      <div className="flex-1 bg-slate-100 rounded-lg h-7 relative overflow-hidden">
        <div
          className="h-full rounded-lg transition-all duration-500"
          style={{ width: `${pct}%`, minWidth: count > 0 ? '24px' : '0', background: color }}
        />
      </div>
      <div className="w-16 text-[0.85rem] font-bold text-slate-800">
        {count} <span className="font-normal text-slate-400 text-xs">({pct}%)</span>
      </div>
    </div>
  );
}

export function SdrPerformanceHub({ sdrId, onBack }) {
  const [period, setPeriod] = useState('all_time');
  const [range, setRange] = useState({ start_date: '', end_date: '' });
  const [showCustom, setShowCustom] = useState(false);
  const [data, setData] = useState(null);   // null = loading
  const [error, setError] = useState(null);

  const load = useCallback(async (p, r) => {
    setError(null);
    setData(null);
    try {
      const result = await CallsService.getSdrPerformance(sdrId, {
        period: p,
        start_date: p === 'custom' ? r.start_date : undefined,
        end_date: p === 'custom' ? r.end_date : undefined,
      });
      setData(result);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load SDR performance.');
    }
  }, [sdrId]);

  useEffect(() => { load(period, range); }, [sdrId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPreset = (key) => {
    setShowCustom(key === 'custom');
    if (key === 'custom') return;
    setPeriod(key);
    load(key, range);
  };

  const applyCustomRange = (next) => {
    setRange(next);
    if (next.start_date && next.end_date) {
      setPeriod('custom');
      load('custom', next);
    }
  };

  if (error) {
    return (
      <div className="sdr-performance-hub min-h-full bg-slate-50 px-6 py-6 max-w-3xl mx-auto">
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this SDR's performance"
          message={error}
          action={<Button variant="outline" onClick={onBack}><ArrowLeft size={14} /> Back to Leaderboard</Button>}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="sdr-performance-hub min-h-full bg-slate-50 px-6 py-6 max-w-5xl mx-auto space-y-4">
        <SkeletonCard><SkeletonText lines={2} /></SkeletonCard>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i}><SkeletonText lines={2} /></SkeletonCard>)}
        </div>
        <SkeletonCard><SkeletonText lines={5} /></SkeletonCard>
      </div>
    );
  }

  const { sdr, productivity: prod, conversion: conv, efficiency: eff, funnel } = data;
  const funnelNow = data.funnel_now || {};
  const funnelTotal = Object.values(funnel).reduce((a, b) => a + b, 0);
  const funnelNowTotal = Object.values(funnelNow).reduce((a, b) => a + b, 0);
  const inPeriod = period === 'all_time' && !showCustom ? '' : ' in period';
  const convRateColor = conv.conversion_rate >= 20 ? '#10b981' : conv.conversion_rate >= 10 ? '#f59e0b' : '#ef4444';

  return (
    <div className="sdr-performance-hub min-h-full bg-slate-50 px-6 py-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={14} /> Back</Button>
          <h1 className="text-xl font-bold text-slate-900 m-0">{sdr.name || sdr.email}</h1>
        </div>
        <p className="text-sm text-slate-500 m-0">
          {sdr.pod_name ? `POD: ${sdr.pod_name} · ` : ''}{sdr.email} · Performance Analytics
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {PERIODS.map(({ key, label }) => (
          <Button
            key={key}
            size="sm"
            variant={period === key && !showCustom ? 'primary' : 'outline'}
            onClick={() => selectPreset(key)}
          >
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={showCustom ? 'primary' : 'outline'}
          onClick={() => selectPreset('custom')}
        >
          <CalendarDays size={14} /> Custom
        </Button>
        {showCustom && (
          <DateRangePicker
            from={range.start_date}
            to={range.end_date}
            onChange={(next) => applyCustomRange({ start_date: next.from, end_date: next.to })}
          />
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-7">
        <MetricCard icon={ClipboardList} label="Assigned Now (all)" value={prod.assigned_now ?? prod.total_leads_assigned} color="#6366f1" />
        <MetricCard icon={Flame} label={`Leads Started${inPeriod}`} value={prod.total_leads_assigned} color="#3b82f6" />
        <MetricCard icon={CircleCheck} label={`Closed${inPeriod}`} value={prod.leads_closed} color="#10b981" />
        <MetricCard icon={Phone} label="Calls Made" value={prod.calls_made} color="#8b5cf6" />
        <MetricCard icon={BarChart3} label="Avg Calls/Lead" value={prod.avg_calls_per_lead} color="#f59e0b" />
        <MetricCard icon={CalendarCheck} label="Meetings" value={conv.meetings_scheduled} color="#10b981" />
        <MetricCard icon={TrendingUp} label="Conv. Rate" value={`${conv.conversion_rate}%`} color={convRateColor} />
        <MetricCard icon={Timer} label={`Moved Stage${inPeriod}`} value={prod.active_leads} color="#64748b" />
      </div>

      <Card className="mb-7">
        <CardContent>
          <h3 className="text-base font-bold mb-1">Current Pipeline</h3>
          <p className="text-xs text-slate-500 mb-5">Every lead assigned to {sdr.name || 'this person'} right now, by current status.</p>
          {Object.entries(funnelNow).map(([stage, count]) => (
            <FunnelBar key={`now-${stage}`} stage={stage} count={count} total={funnelNowTotal} />
          ))}
        </CardContent>
      </Card>

      <Card className="mb-7">
        <CardContent>
          <h3 className="text-base font-bold mb-1">Stage Movement{inPeriod || ' (all time)'}</h3>
          <p className="text-xs text-slate-500 mb-5">Leads whose status changed{inPeriod ? ' during the selected period' : ''} — not the whole pipeline.</p>
          {Object.entries(funnel).map(([stage, count]) => (
            <FunnelBar key={stage} stage={stage} count={count} total={funnelTotal} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h3 className="text-base font-bold mb-4">Efficiency Metrics</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-[0.78rem] text-slate-500 uppercase mb-1.5">Avg Time Per Lead</div>
              <div className="text-2xl font-extrabold text-slate-800">{formatHours(eff.avg_time_per_lead_hours)}</div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-[0.78rem] text-slate-500 uppercase mb-1.5">Median Time Per Lead</div>
              <div className="text-2xl font-extrabold text-slate-800">{formatHours(eff.median_time_per_lead_hours)}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
