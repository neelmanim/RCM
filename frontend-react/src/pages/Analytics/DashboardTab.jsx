/**
 * DashboardTab.jsx
 *
 * Analytics dashboard panel — feature-complete port of the vanilla analytics.js
 * Changes vs original React version:
 *   1. Activity Trend line chart (Chart.js via window.Chart)
 *   2. Rich KPI cards matching prod: Connect Rate, subtitles
 *   3. Insight/rule pills bar
 *   4. SDR table: Connect % column + Inactive toggle + search filter
 *   5. Proper normalizeFunnel mapping for emails, calls details
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  BarChart3, TrendingUp, Users, Target, Calendar, RefreshCw,
  Download, Phone, Mail, CheckCircle, Sparkles, ChevronRight,
  Search, XCircle
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../components/ui/Table';
import { AnalyticsService } from '../../services/api';
import { PinnedReports } from './PinnedReports';

/* ── Helpers ─────────────────────────────────────────────── */
const _pct = v => (v == null ? '—' : `${v}%`);
const _num = v => (v == null ? '—' : Number(v).toLocaleString());

const PRESETS = [
  { value: '7d',     label: '7D' },
  { value: '30d',    label: '30D' },
  { value: '90d',    label: '90D' },
  { value: 'all',    label: 'All' },
  { value: 'custom', label: 'Custom' },
];

const METRIC_COLORS = {
  calls:        { border: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
  meetings:     { border: '#10b981', bg: 'rgba(16,185,129,0.06)' },
  disqualified: { border: '#ef4444', bg: 'rgba(239,68,68,0.06)'  },
  emails:       { border: '#0ea5e9', bg: 'rgba(14,165,233,0.06)' },
};

/* ── normalizeFunnel: full mapping of /analytics/funnel API shape ── */
const normalizeFunnel = (d) => {
  if (!d) return null;
  const e = d.emails   || {};
  const c = d.calls    || {};
  const m = d.meetings || {};
  return {
    // KPI values
    leads_assigned:        d.leads_assigned              ?? 0,
    emails_sent:           e.sent                        ?? 0,
    emails_open_rate:      e.open_rate                   ?? null,
    emails_reply_rate:     e.reply_rate                  ?? null,
    calls_made:            c.made                        ?? 0,
    calls_unique_leads:    c.unique_leads_called          ?? null,
    calls_avg_per_lead:    c.avg_calls_per_lead           ?? null,
    calls_connected:       c.connected                   ?? null,
    connect_rate:          d.connect_rate                ?? null,
    meetings:              m.booked                      ?? 0,
    conversion_rate:       m.conversion_pct              ?? null,
    disqualified:          d.disqualified                ?? 0,
    demo:                  d.opportunity?.won            ?? 0,
    // Funnel strip — every bar counts leads reaching that stage, not events;
    // "Calling" was mapped to c.made (call attempts) which is a different
    // unit from every other bar and made a single repeatedly-dialed lead
    // look like N leads reached the stage. c.unique_leads_called is the
    // leads-count equivalent, same as the other bars.
    funnel_assigned:       d.leads_assigned              ?? 0,
    funnel_calling:        c.unique_leads_called          ?? 0,
    funnel_meeting:        m.booked                      ?? 0,
    funnel_disqualified:   d.disqualified                ?? 0,
  };
};

/* ── Rule engine (mirrors analytics.js _runRuleEngine) ──────────── */
const runRuleEngine = (f) => {
  if (!f) return [];
  const insights = [];
  const leads    = f.leads_assigned || 0;
  const calls    = f.calls_made     || 0;
  const connects = f.calls_connected|| 0;
  const meetings = f.meetings       || 0;
  const disq     = f.disqualified   || 0;
  const connRate = f.connect_rate;

  if (connRate !== null && connRate !== undefined && calls >= 10) {
    if (connRate < 20)
      insights.push({ icon: '📉', text: `Low connect rate at ${connRate}% — review call timing`, level: 'warn' });
    else if (connRate >= 45)
      insights.push({ icon: '📈', text: `Strong connect rate at ${connRate}%`, level: 'good' });
  }

  if (calls >= 20 && meetings === 0)
    insights.push({ icon: '🎯', text: `${calls} calls logged but 0 meetings booked`, level: 'warn' });
  else if (calls >= 10 && meetings > 0 && Math.round(calls / meetings) > 30)
    insights.push({ icon: '⏱️', text: `${Math.round(calls / meetings)} calls per meeting — high effort`, level: 'warn' });

  if (leads > 10 && calls === 0)
    insights.push({ icon: '🔴', text: `${leads} leads assigned with no calls`, level: 'warn' });
  else if (leads > 20 && calls < leads * 0.3)
    insights.push({ icon: '⚠️', text: `Only ${Math.round(calls / leads * 100)}% of leads called`, level: 'warn' });

  if (leads > 5 && disq / leads > 0.35)
    insights.push({ icon: '🚫', text: `${Math.round(disq / leads * 100)}% disqualification rate`, level: 'warn' });

  if (leads === 0 && calls === 0 && meetings === 0) return [];
  const seen = new Set();
  return insights.filter(i => { if (seen.has(i.text)) return false; seen.add(i.text); return true; }).slice(0, 3);
};

/* ── Rich KPI Card (with subtitle + badge) ────────────────── */
const RichKpiCard = ({ label, value, subtitle, badge, icon: Icon, colorClass, bgClass, tooltip }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-1" title={tooltip || ''}>
    <div className="flex items-center justify-between mb-1">
      <div className={`w-8 h-8 ${bgClass} rounded-xl flex items-center justify-center ${colorClass}`}>
        <Icon size={16} />
      </div>
      {badge && <span dangerouslySetInnerHTML={{ __html: badge }} />}
    </div>
    <p className="text-2xl font-extrabold text-slate-800 leading-tight">{value}</p>
    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</p>
    {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
  </div>
);

/* ── Funnel Strip ────────────────────────────────────────── */
const FunnelStrip = ({ data }) => {
  if (!data) return null;
  const stages = [
    { label: 'Assigned',     val: data.funnel_assigned,     color: 'bg-blue-500' },
    { label: 'Calling',      val: data.funnel_calling,      color: 'bg-sky-500' },
    { label: 'Meeting',      val: data.funnel_meeting,      color: 'bg-green-500' },
    { label: 'Disqualified', val: data.funnel_disqualified, color: 'bg-red-400' },
  ].filter(s => s.val != null && s.val > 0);
  if (!stages.length) return <p className="text-sm text-slate-400 py-4 text-center">No lead data for this filter.</p>;
  const max = Math.max(...stages.map(s => s.val), 1);

  return (
    <div className="flex items-end gap-2 h-20">
      {stages.map((s, i) => (
        <div key={i} className="flex flex-col items-center gap-1 flex-1">
          <span className="text-[10px] font-bold text-slate-600">{_num(s.val)}</span>
          <div className={`w-full ${s.color} rounded-t-lg transition-all duration-700`}
            style={{ height: `${Math.max(8, (s.val / max) * 56)}px` }} />
          <span className="text-[9px] text-slate-500 font-semibold truncate w-full text-center">{s.label}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Step Pill ───────────────────────────────────────────── */
const StepPill = ({ num: n, label, active, locked }) => (
  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all
    ${active ? 'bg-indigo-600 text-white shadow-md' : locked ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-600'}`}>
    <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-extrabold
      ${active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'}`}>{n}</span>
    {label} {locked && '🔒'}
  </span>
);

/* ── Activity Trend Chart (Chart.js via window.Chart) ────── */
const TrendChart = ({ data, filters }) => {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);
  const [metricToggles, setMetricToggles] = useState({
    calls: true, meetings: true, disqualified: true, emails: true,
  });

  const toggleMetric = (key) => {
    setMetricToggles(prev => {
      const next = { ...prev, [key]: !prev[key] };
      // Update chart visibility directly
      if (chartRef.current) {
        const idx = Object.keys(METRIC_COLORS).indexOf(key);
        if (idx >= 0) {
          // RCA 2026-07-27: this was inverted — `!!next[key] === false ? false : true`
          // sets hidden=true when the metric is turned ON and hidden=false when
          // turned OFF (verified by truth table), so clicking any chip after the
          // initial render made that metric's line disappear instead of appear.
          chartRef.current.data.datasets[idx].hidden = !next[key];
          // Recompute Y max
          const series = (data?.series || []);
          const allVals = Object.entries(next).flatMap(([k, on]) =>
            on ? series.map(s => s[k] ?? 0) : []
          );
          const dataMax = allVals.length ? Math.max(...allVals) : 10;
          const yMax = Math.max(5, Math.ceil(dataMax * 1.25));
          chartRef.current.options.scales.y.max = yMax;
          chartRef.current.update();
        }
      }
      return next;
    });
  };

  useEffect(() => {
    if (!data?.series?.length || !canvasRef.current) return;
    if (!window.Chart) return;

    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const series = data.series || [];
    const granularity = data.granularity || 'daily';

    const fmtLabel = (iso) => {
      if (!iso || iso === 'unknown') return '?';
      const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
      if (granularity === 'monthly') return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    };

    const labels = series.map(s => fmtLabel(s.period));
    const metricKeys = Object.keys(METRIC_COLORS);

    const allVals = metricKeys.flatMap(k => metricToggles[k] ? series.map(s => s[k] ?? 0) : []);
    const dataMax = allVals.length ? Math.max(...allVals) : 10;
    const yMax = Math.max(5, Math.ceil(dataMax * 1.25));
    const stepSize = yMax <= 10 ? 1 : yMax <= 50 ? 5 : yMax <= 200 ? 20 : 50;

    const datasets = metricKeys.map((key, idx) => ({
      label:           key.charAt(0).toUpperCase() + key.slice(1),
      data:            series.map(s => s[key] ?? 0),
      borderColor:     METRIC_COLORS[key].border,
      backgroundColor: idx === 0 ? METRIC_COLORS[key].bg : 'transparent',
      borderWidth:     2,
      tension:         series.length <= 7 ? 0.3 : 0.4,
      fill:            idx === 0,
      pointRadius:     series.length <= 14 ? 4 : 2,
      pointHoverRadius: 6,
      hidden:          !metricToggles[key],
    }));

    chartRef.current = new window.Chart(canvasRef.current, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}` },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 }, color: '#94a3b8', maxTicksLimit: 10, maxRotation: 0 },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            grid: { color: 'rgba(148,163,184,0.12)' },
            ticks: { font: { size: 11 }, color: '#94a3b8', precision: 0, stepSize },
          },
        },
      },
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [data]); // eslint-disable-line

  if (!data?.series?.length) {
    return <p className="text-sm text-slate-400 py-8 text-center">No trend data for this period.</p>;
  }

  return (
    <div>
      {/* Toggle buttons — same METRIC_COLORS the chart itself uses, so the
          dot/label can't drift from the line it's toggling. */}
      <div className="flex items-center flex-wrap gap-2 mb-4">
        {Object.entries(METRIC_COLORS).map(([key, { border: dot }]) => (
          <button key={key} onClick={() => toggleMetric(key)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all
              ${metricToggles[key]
                ? 'border-transparent text-slate-700'
                : 'border-slate-200 text-slate-400 opacity-50'}`}
            style={metricToggles[key] ? { backgroundColor: dot + '18', borderColor: dot + '40' } : {}}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>
      {/* Canvas */}
      <div style={{ position: 'relative', height: 260, width: '100%' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════ */
/* ── DashboardTab ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export const DashboardTab = ({ token, userRole, filters: externalFilters, onFiltersChange, pinRefresh }) => {
  const isSuperAdmin = userRole === 'Super Admin' || userRole === 'Admin' || userRole === 'Pod Admin';
  // AE: Analytics Hub is forced to their own leads/calls server-side
  // regardless of any pod_id sent (see backend analytics_routes._effective_ae_sdr)
  // — no pod-wide view exists for this role, so the pod picker (which
  // /filters now returns empty for an AE anyway) is hidden.
  const isAE = userRole === 'AE';

  useEffect(() => {
    try { window.mixpanel?.track('Analytics Hub Viewed', { role: userRole, self_scoped: isAE }); } catch { /* analytics is best-effort */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter state — these are the DRAFT values the wizard widgets edit.
  // Nothing is fetched until "Apply Filters" commits them (see `applied` below).
  const [podId, setPodId]           = useState(externalFilters?.pod_id || '');
  const [preset, setPreset]         = useState(externalFilters?.preset || '');
  const [dateFrom, setDateFrom]     = useState(externalFilters?.date_from || '');
  const [dateTo, setDateTo]         = useState(externalFilters?.date_to || '');
  const [batchId, setBatchId]       = useState(externalFilters?.upload_log_id || '');
  const [viewMode, setViewMode]     = useState('single');

  // Applied filters — what's actually fetched. Only updated by handleApply().
  // RCA 2026-08-03: filters used to feed loadAll() directly off the draft
  // state above, so every keystroke (e.g. filling the "from" date before the
  // "to" date) fired a real fetch with a half-filled, wrong-shaped date
  // range. A wide/incomplete-range request can resolve slower than the
  // narrow correct one that fires right after it, and its response can land
  // last and silently overwrite the correct data — live-reproduced.
  const [applied, setApplied] = useState({
    podId: externalFilters?.pod_id || '',
    preset: externalFilters?.preset || '',
    dateFrom: externalFilters?.date_from || '',
    dateTo: externalFilters?.date_to || '',
    batchId: externalFilters?.upload_log_id || '',
  });

  const isDirty = (
    podId !== applied.podId || preset !== applied.preset ||
    dateFrom !== applied.dateFrom || dateTo !== applied.dateTo || batchId !== applied.batchId
  );

  const handleApply = () => setApplied({ podId, preset, dateFrom, dateTo, batchId });

  // Filter options
  const [pods, setPods]     = useState([]);
  const [batches, setBatches] = useState([]);

  // Data
  const [funnel, setFunnel]               = useState(null);
  const [rawFunnel, setRawFunnel]         = useState(null); // for rule engine
  const [sdrTable, setSdrTable]           = useState([]);
  const [trendData, setTrendData]         = useState(null);
  const [batchSummary, setBatchSummary]   = useState([]);
  const [aiRec, setAiRec]                 = useState('');

  // UI
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [sdrSortBy, setSdrSortBy]       = useState('calls_made');
  const [showCustomDates, setShowCustomDates] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [sdrSearch, setSdrSearch]       = useState('');
  // Trend SDR filter — separate from global filters; refetches trend only
  const [trendSdrId, setTrendSdrId]     = useState('');

  // Current step
  const step = useMemo(() => {
    if (batchId) return 4;
    if (dateFrom || dateTo || preset) return 3;
    if (podId || isAE) return 2; // AE has no pod step to complete
    return 1;
  }, [podId, preset, dateFrom, dateTo, batchId, isAE]);

  // Build API filters from APPLIED state, not the draft widgets — this is
  // what actually drives loadAll(). Deps EXCLUDE pods so an async pod-list
  // fetch does NOT cascade a second loadAll() (D-5 fix).
  const filters = useMemo(() => {
    const f = {};
    if (applied.podId) f.pod_id = applied.podId;
    if (applied.preset && applied.preset !== 'custom') f.preset = applied.preset;
    if (applied.dateFrom) f.date_from = applied.dateFrom;
    if (applied.dateTo) f.date_to = applied.dateTo;
    if (applied.batchId) f.upload_log_id = applied.batchId;
    return f;
  }, [applied]);

  const podNameById = (id) => (id ? pods.find(p => String(p.id) === String(id))?.name || null : null);

  // Resolve pod name separately (for Ask AI scoping banner) — does not affect API calls
  const podName = useMemo(() => podNameById(podId), [podId, pods]); // eslint-disable-line

  // Applied pod name — for the breadcrumb, which must reflect what's actually
  // displayed, not what's still being edited in the draft widgets.
  const appliedPodName = useMemo(() => podNameById(applied.podId), [applied.podId, pods]); // eslint-disable-line

  useEffect(() => { onFiltersChange?.(filters); }, [filters, onFiltersChange]);

  // Load pods
  useEffect(() => {
    AnalyticsService.getFilters({}).then(opts => setPods(opts.pods || [])).catch(() => {});
  }, []);

  // Load batches — scoped to the current POD/date selection via the same
  // /analytics/filters endpoint the POD dropdown uses (D-6 fix: was pulling
  // from the unrelated, unscoped /admin/leads/upload-logs rollback-history
  // endpoint, which ignores pod/date and returns the 10 most recent uploads
  // org-wide regardless of selection).
  useEffect(() => {
    if (step < 2) { setBatches([]); return; }
    const params = {};
    if (podId) params.pod_id = podId;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (preset && preset !== 'custom') params.preset = preset;
    AnalyticsService.getFilters(params)
      .then(opts => setBatches(Array.isArray(opts?.batches) ? opts.batches : []))
      .catch(() => setBatches([]));
  }, [podId, dateFrom, dateTo, preset, step]);

  // Main data load. Guarded by a request-id ref so a slower, stale response
  // (e.g. from a rapid double-Apply) can never overwrite a newer one that
  // already landed — the exact race that produced wrong data with a
  // correct-looking date-range breadcrumb (live-reproduced 2026-08-03).
  const requestIdRef = useRef(0);
  const loadAll = useCallback(async () => {
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      if (viewMode === 'all_batches') {
        const data = await AnalyticsService.getBatchSummary(filters);
        if (myRequestId !== requestIdRef.current) return; // superseded — discard
        setBatchSummary(Array.isArray(data?.batches) ? data.batches : []);
      } else {
        const [funnelData, sdrData, trendRaw] = await Promise.all([
          AnalyticsService.getFunnel(filters).catch(() => null),
          AnalyticsService.getSdrTable(filters, 1, sdrSortBy).catch(() => ({ sdrs: [] })),
          AnalyticsService.getTrend(filters).catch(() => null),
        ]);
        if (myRequestId !== requestIdRef.current) return; // superseded — discard
        const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
        const normalised = isObj(funnelData) ? normalizeFunnel(funnelData) : null;
        setFunnel(normalised);
        setRawFunnel(isObj(funnelData) ? funnelData : null);
        setSdrTable(Array.isArray(sdrData?.sdrs) ? sdrData.sdrs : []);
        setTrendData(isObj(trendRaw) ? trendRaw : null);
      }
    } catch {
      if (myRequestId === requestIdRef.current) setError('Failed to load analytics data.');
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
  }, [filters, viewMode, sdrSortBy]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Re-fetch trend whenever the SDR filter on the trend chart changes
  useEffect(() => {
    if (loading) return; // avoid double-fetch on initial load
    const trendFilters = { ...filters };
    if (trendSdrId) trendFilters.sdr_id = trendSdrId;
    AnalyticsService.getTrend(trendFilters)
      .then(raw => setTrendData(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendSdrId]);

  // AI recommendation — fire on stable filter key, not funnel object reference
  // D-2 fix: funnel is a new object on every loadAll() even when values are identical,
  // so using [funnel] as dep caused a Groq AI POST on every filter change.
  // Using a JSON key of filters means it only fires when the user actually changes filters.
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
  useEffect(() => {
    if (!funnel) return;
    setAiRec('');
    const ctrl = new AbortController();
    // Pass pod_name via separate prop so the API payload is correct
    const enrichedFilters = podName ? { ...filters, pod_name: podName } : filters;
    AnalyticsService.getAiRecommendation(enrichedFilters, ctrl.signal)
      .then(data => setAiRec(data.recommendation || data.text || ''))
      .catch(() => {});
    return () => ctrl.abort();
  }, [filterKey]); // eslint-disable-line

  const handlePreset = (p) => {
    setPreset(p);
    setBatchId('');
    if (p === 'custom') { setShowCustomDates(true); }
    else { setShowCustomDates(false); setDateFrom(''); setDateTo(''); }
  };

  const handleExport = () => AnalyticsService.downloadCsv(filters);

  // Breadcrumb reflects APPLIED state — it must describe what's actually on
  // screen, not whatever is still being edited in the draft widgets.
  const breadcrumb = useMemo(() => {
    const parts = [];
    if (applied.podId) parts.push(appliedPodName || 'Pod');
    if (applied.preset && applied.preset !== 'custom') {
      const labels = { '7d': 'Last 7 Days', '30d': 'Last 30 Days', '90d': 'Last 90 Days', all: 'All Time' };
      parts.push(labels[applied.preset] || applied.preset.toUpperCase());
    } else if (applied.dateFrom && applied.dateTo) {
      parts.push(`${applied.dateFrom} → ${applied.dateTo}`);
    }
    if (applied.batchId) parts.push(batches.find(b => String(b.id) === applied.batchId)?.label || 'Batch');
    return parts.length ? parts.join(' › ') : 'All Pods · All Time';
  }, [applied, appliedPodName, batches]);

  // Rule engine insights
  const insights = useMemo(() => runRuleEngine(funnel), [funnel]);

  // SDR filtered list
  const filteredSdrs = useMemo(() => {
    let list = sdrTable;
    if (!showInactive) list = list.filter(s => !s.is_inactive);
    if (sdrSearch.trim()) {
      const q = sdrSearch.toLowerCase();
      list = list.filter(s => (s.sdr_name || s.name || '').toLowerCase().includes(q));
    }
    return list;
  }, [sdrTable, showInactive, sdrSearch]);

  // ── KPI cards config ─────────────────────────────────────
  const kpiCards = funnel ? [
    {
      label:    'Leads Assigned',
      value:    _num(funnel.leads_assigned),
      subtitle: 'Leads created in this period',
      icon:     Users,
      colorClass: 'text-blue-600',
      bgClass:    'bg-blue-50',
      tooltip:  'Filtered by lead created date',
      badge:    null,
    },
    {
      label:    'Emails Sent',
      value:    _num(funnel.emails_sent),
      subtitle: `${_pct(funnel.emails_open_rate)} open · ${_pct(funnel.emails_reply_rate)} reply`,
      icon:     Mail,
      colorClass: 'text-sky-600',
      bgClass:    'bg-sky-50',
      tooltip:  'Outbound emails filtered by send date',
      badge:    null,
    },
    {
      label:    'Calls Made',
      value:    _num(funnel.calls_made),
      subtitle: funnel.calls_unique_leads != null
        ? `${_num(funnel.calls_unique_leads)} unique leads · ${funnel.calls_avg_per_lead ?? 0} avg/lead`
        : 'All outcomes recorded',
      icon:     Phone,
      colorClass: 'text-indigo-600',
      bgClass:    'bg-indigo-50',
      tooltip:  'Filtered by call date',
      badge:    null,
    },
    {
      label:    'Connect Rate',
      value:    _pct(funnel.connect_rate),
      subtitle: `${_num(funnel.calls_connected)} live connects`,
      icon:     Target,
      colorClass: funnel.connect_rate >= 30 ? 'text-green-600' : 'text-amber-600',
      bgClass:    funnel.connect_rate >= 30 ? 'bg-green-50'  : 'bg-amber-50',
      tooltip:  'Live connects / calls with outcome',
      badge: funnel.connect_rate != null
        ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${funnel.connect_rate >= 30 ? '#dcfce7' : '#fef3c7'};color:${funnel.connect_rate >= 30 ? '#15803d' : '#92400e'};">${funnel.connect_rate >= 30 ? '✓ Strong' : '↓ Low'}</span>`
        : null,
    },
    {
      label:    'Disqualified',
      value:    _num(funnel.disqualified),
      subtitle: funnel.leads_assigned > 0
        ? `${_pct(Math.round(funnel.disqualified / funnel.leads_assigned * 1000) / 10)} of assigned`
        : '—',
      icon:     XCircle,
      colorClass: 'text-red-600',
      bgClass:    'bg-red-50',
      tooltip:  'Not Interested, Disqualified, Unreachable',
      badge:    null,
    },
  ] : [];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-800 m-0">
            <BarChart3 size={22} className="text-indigo-600" /> Analytics Hub
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Hierarchical SDR activity by POD, date range, and batch</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-slate-200 rounded-xl p-1">
            <button onClick={() => setViewMode('single')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'single' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
              Single Batch
            </button>
            <button onClick={() => setViewMode('all_batches')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'all_batches' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
              All Batches
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={handleExport}><Download size={14} /> Export</Button>
          <Button variant="secondary" size="sm" onClick={loadAll} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {/* Step Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {!isAE && <>
          <StepPill num={1} label="POD"        active={step >= 1} />
          <ChevronRight size={14} className="text-slate-300" />
        </>}
        <StepPill num={2} label="Date Range" active={step >= 2} locked={!isAE && step < 1} />
        <ChevronRight size={14} className="text-slate-300" />
        <StepPill num={3} label="Batch"      active={step >= 3} locked={step < 2} />
        <ChevronRight size={14} className="text-slate-300" />
        <StepPill num={4} label="Refine"     active={step >= 4} locked={step < 3} />
      </div>

      {/* Filters Row */}
      <div className="flex items-end gap-4 flex-wrap bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        {/* POD — hidden for AE, whose data is always self-scoped server-side */}
        {!isAE && (
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">① POD</label>
            <select value={podId} onChange={e => { setPodId(e.target.value); setBatchId(''); }}
              className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white font-medium outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 min-w-[160px]">
              <option value="">All Pods</option>
              {pods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {/* Date Presets */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">② Date Range</label>
          <div className="flex gap-1">
            {PRESETS.map(p => (
              <button key={p.value} onClick={() => handlePreset(p.value)}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${preset === p.value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {showCustomDates && (
            <div className="flex items-center gap-2 mt-2">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none" />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none" />
            </div>
          )}
        </div>

        {/* Batch */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">③ Batch</label>
          <select value={batchId} onChange={e => setBatchId(e.target.value)} disabled={step < 2}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white font-medium outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 min-w-[180px] disabled:opacity-50">
            <option value="">{step < 2 ? 'Select date first' : 'All Batches'}</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.label || b.name}</option>)}
          </select>
        </div>

        {/* Apply — nothing above fetches until this is clicked */}
        <Button variant="primary" size="sm" onClick={handleApply} disabled={!isDirty}>
          <Search size={14} /> Apply Filters
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="text-xs text-slate-500 font-semibold px-1">📍 {breadcrumb}</div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-semibold">{error}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : viewMode === 'all_batches' ? (
        /* ── All Batches Comparison ─────────────────────────── */
        <Card>
          <CardHeader title="Batch Comparison" subtitle={`${batchSummary.length} batch(es)`} />
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHead><TableRow>
                  <TableHeader className="pl-4">Batch</TableHeader>
                  <TableHeader className="text-center">Leads</TableHeader>
                  <TableHeader className="text-center">Calls</TableHeader>
                  <TableHeader className="text-center">Meetings</TableHeader>
                  <TableHeader className="text-center">Emails</TableHeader>
                  <TableHeader className="text-center">Connect %</TableHeader>
                </TableRow></TableHead>
                <TableBody>
                  {batchSummary.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-slate-400 italic">No batch data</TableCell></TableRow>
                  ) : batchSummary.map((b, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4 font-bold text-sm">{b.batch_name || b.label || `Batch ${i + 1}`}</TableCell>
                      <TableCell className="text-center font-mono">{_num(b.leads)}</TableCell>
                      <TableCell className="text-center font-mono text-indigo-600 font-semibold">{_num(b.calls)}</TableCell>
                      <TableCell className="text-center font-mono text-emerald-600 font-semibold">{_num(b.meetings)}</TableCell>
                      <TableCell className="text-center font-mono">{_num(b.emails)}</TableCell>
                      <TableCell className="text-center"><Badge>{_pct(b.connect_rate ?? b.conversion_rate)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Insight Pills Bar ────────────────────────────── */}
          {insights.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {insights.map((ins, i) => {
                const cls = ins.level === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-700'
                          : ins.level === 'good' ? 'bg-green-50 border-green-200 text-green-700'
                          : 'bg-blue-50 border-blue-200 text-blue-700';
                return (
                  <span key={i} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${cls}`}>
                    {ins.icon} {ins.text}
                  </span>
                );
              })}
            </div>
          )}

          {/* ── Pipeline Funnel ──────────────────────────────── */}
          {funnel && (
            <Card>
              <CardHeader title="Pipeline Funnel" subtitle="Lead distribution across pipeline stages" />
              <CardContent><FunnelStrip data={funnel} /></CardContent>
            </Card>
          )}

          {/* ── Pinned AI Reports (above KPI cards) ─────────── */}
          <PinnedReports token={token} key={`pinned-${pinRefresh}`} />

          {/* ── KPI Cards (5) ───────────────────────────────── */}
          {funnel && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {kpiCards.map((card, i) => (
                <RichKpiCard key={i} {...card} />
              ))}
            </div>
          )}

          {/* ── AI Recommendation ───────────────────────────── */}
          {aiRec && (
            <div className="flex items-start gap-3 bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-2xl p-4">
              <Sparkles size={16} className="text-indigo-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">AI Recommendation</p>
                <p className="text-sm text-slate-700 leading-relaxed">{aiRec}</p>
              </div>
            </div>
          )}

          {/* ── Activity Trend + SDR Performance (side by side) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Activity Trend Chart */}
            <Card>
              <CardHeader
                title="Activity Trend"
                subtitle="Calls, meetings & more over time"
                actions={
                  <select
                    value={trendSdrId}
                    onChange={e => setTrendSdrId(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1 outline-none bg-white text-slate-600 cursor-pointer hover:border-indigo-300 transition-colors"
                    title="Filter trend by SDR/AE"
                  >
                    <option value="">All SDRs / AEs</option>
                    {sdrTable.map(sdr => (
                      <option key={sdr.user_id || sdr.sdr_id} value={sdr.user_id || sdr.sdr_id}>
                        {sdr.sdr_name || sdr.name}
                      </option>
                    ))}
                  </select>
                }
              />
              <CardContent>
                <TrendChart data={trendData} filters={filters} />
              </CardContent>
            </Card>

            {/* SDR Performance */}
            <Card>
              <CardHeader
                title="SDR Performance"
                subtitle={`${filteredSdrs.length} SDR(s)`}
                actions={
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer select-none">
                    <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
                      className="rounded" />
                    Inactive
                  </label>
                }
              />
              <CardContent>
                {/* Search */}
                <div className="relative mb-3">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search SDR…"
                    value={sdrSearch}
                    onChange={e => setSdrSearch(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 bg-slate-50"
                  />
                </div>
                {/* Bounded height + its own vertical scroll — without this,
                    a pod with many SDRs (or a broad search match) just grew
                    the whole card past the viewport with no way to reach the
                    rows below except the page's own scroll, which a mouse
                    positioned over the table/search box doesn't always
                    reach cleanly. Sticky header keeps column labels visible
                    while scrolling through rows. Passed as an additive
                    className (not a border/rounding override) — Tailwind
                    resolves conflicting utilities by stylesheet definition
                    order, not by string position (see TableCell's own RCA
                    comment on whitespace- above), so fighting Table's
                    default border/rounded-xl classes here isn't safe. */}
                  <Table className="max-h-[320px] overflow-y-auto">
                    <TableHead className="sticky top-0 z-10 bg-slate-50"><TableRow>
                      <TableHeader className="pl-3">SDR</TableHeader>
                      <TableHeader className="text-center">Leads</TableHeader>
                      <TableHeader className="text-center">Calls ↓</TableHeader>
                      <TableHeader className="text-center" title="Calls over 30s that weren't a no-answer, wrong number, or voicemail">Conversations</TableHeader>
                      <TableHeader className="text-center">Connect %</TableHeader>
                      <TableHeader className="text-center">Emails</TableHeader>
                      <TableHeader className="text-center">Meetings</TableHeader>
                    </TableRow></TableHead>
                    <TableBody>
                      {filteredSdrs.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-400 italic text-xs">
                          No SDR data for this period
                        </TableCell></TableRow>
                      ) : filteredSdrs.map((sdr, idx) => {
                        const rate = sdr.connect_rate ?? null;
                        const rateBg = rate == null ? '' : rate >= 30 ? '#dcfce7' : '#fef3c7';
                        const rateColor = rate == null ? '' : rate >= 30 ? '#15803d' : '#92400e';
                        return (
                          <TableRow key={sdr.user_id || idx}
                            style={sdr.is_inactive ? { opacity: 0.55 } : {}}>
                            <TableCell className="pl-3">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                                  <Users size={11} className="text-indigo-500" />
                                </div>
                                <div>
                                  <p className="text-xs font-bold text-slate-800 leading-tight">
                                    {sdr.sdr_name || sdr.name || 'SDR'}
                                    {sdr.is_inactive && (
                                      <span className="ml-1 px-1 py-0.5 text-[9px] bg-slate-100 text-slate-400 rounded font-semibold">Inactive</span>
                                    )}
                                  </p>
                                  {sdr.pod_name && <p className="text-[10px] text-slate-400">{sdr.pod_name}</p>}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs">{_num(sdr.leads_assigned)}</TableCell>
                            <TableCell className="text-center font-mono text-xs text-indigo-600 font-semibold">{_num(sdr.calls_made ?? sdr.calls)}</TableCell>
                            <TableCell className="text-center font-mono text-xs">{_num(sdr.conversations)}</TableCell>
                            <TableCell className="text-center">
                              {rate != null
                                ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                                    style={{ background: rateBg, color: rateColor }}>{rate}%</span>
                                : <span className="text-slate-300 text-xs">—</span>}
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs">{_num(sdr.emails_sent)}</TableCell>
                            <TableCell className="text-center font-mono text-xs text-emerald-600 font-semibold">{_num(sdr.meetings)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
