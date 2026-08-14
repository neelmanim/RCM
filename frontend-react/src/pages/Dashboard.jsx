/**
 * Dashboard.jsx — v4 Final Design
 *
 * Plugged into the Vanilla JS shell via DashboardHub IIFE.
 * Uses Chart.js (already a dependency) for the meetings trend chart.
 *
 * Sections:
 *   1. KPI stat cards (7 cards, reordered: pipeline-first)
 *   2. Bento grid:
 *      Left  (60%) — Meetings Booked line chart (7D / 30D toggle)
 *      Right (40%) — Leaderboard mini + Needs Attention
 *   3. Pipeline by Stage (full-width horizontal bar chart)
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Chart, registerables } from 'chart.js';
import { LeadsService, AnalyticsService } from '../services/api';

Chart.register(...registerables);

// Resolve API base from config.js (injected by Render build)
const API_BASE = window.__APP_CONFIG__?.API_BASE || '';

const authHeaders = () => {
  // View-As: prefer the impersonation token stored in sessionStorage by app.js.
  // Falls back to the real user's token from localStorage.
  const token = sessionStorage.getItem('crm_view_as_token') || localStorage.getItem('crm_token');
  return { Authorization: `Bearer ${token}` };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = n => (n == null ? '—' : Number(n).toLocaleString());

// ─── Greeting helpers (WS2) ────────────────────────────────────────────────
const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const getFirstName = (raw = '') => {
  if (!raw) return '';
  if (raw.includes('@')) {
    const local = raw.split('@')[0].replace(/[._-]/g, ' ');
    return local.split(' ')[0].replace(/^\w/, c => c.toUpperCase());
  }
  return raw.trim().split(' ')[0];
};

// sessionStorage: first visit this session = true, subsequent = false
const checkFirstVisit = () => {
  try {
    const key = 'ls_session_greeted';
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch { return false; }
};

// ─── Rule Engine (matches Harshit's DashboardTab.jsx logic) ─────────────────

const runRuleEngine = (stats) => {
  if (!stats) return [];
  const leads    = stats.total ?? 0;
  const sc       = stats.status_counts ?? {};
  const calls    = sc['Calling'] ?? 0;
  const meetings = (sc['Meeting Scheduled'] ?? 0) + (sc['Demo Scheduled'] ?? 0) + (sc['Demo Done'] ?? 0);
  const disq     = sc['Disqualified'] ?? 0;
  const insights = [];

  if (leads > 10 && calls === 0)
    insights.push({ icon: '🔴', text: `${fmt(leads)} leads assigned with no calls`, level: 'warn' });
  else if (leads > 20 && calls < leads * 0.3)
    insights.push({ icon: '⚠️', text: `Only ${Math.round(calls / leads * 100)}% of leads called`, level: 'warn' });

  if (calls >= 20 && meetings === 0)
    insights.push({ icon: '🎯', text: `${fmt(calls)} calls logged but 0 meetings booked`, level: 'warn' });
  else if (calls >= 10 && meetings > 0 && Math.round(calls / meetings) > 30)
    insights.push({ icon: '⏱️', text: `${Math.round(calls / meetings)} calls per meeting — high effort`, level: 'warn' });

  if (leads > 5 && disq / leads > 0.35)
    insights.push({ icon: '🚫', text: `${Math.round(disq / leads * 100)}% disqualification rate`, level: 'warn' });

  if (calls > 0 && meetings > 0)
    insights.push({ icon: '📈', text: `${meetings} meetings booked · ${Math.round(meetings / calls * 100)}% call-to-meeting rate`, level: 'good' });

  const seen = new Set();
  return insights.filter(i => { if (seen.has(i.text)) return false; seen.add(i.text); return true; }).slice(0, 3);
};

const AVATAR_COLORS = [
  '#2563EB','#7C3AED','#059669','#D97706','#0D9488',
  '#DB2777','#4F46E5','#DC2626','#0369A1','#65A30D',
];
const avatarColor = (str = '') =>
  AVATAR_COLORS[(str.charCodeAt(0) || 0) % AVATAR_COLORS.length];

const initials = (name = '') =>
  name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';

// ─── KPI Card ───────────────────────────────────────────────────────────────

const KpiCard = ({ label, value, desc, descColor, valueColor, alert, loading }) => (
  <div className={`db-kpi-card${alert ? ' alert' : ''}`}>
    <div className="db-kpi-label">{label}</div>
    {loading ? (
      <>
        <div className="db-kpi-skeleton" style={{ height: 28, width: '60%', borderRadius: 6, margin: '6px 0' }} />
        <div className="db-kpi-skeleton" style={{ height: 11, width: '80%', borderRadius: 4 }} />
      </>
    ) : (
      <>
        <div className={`db-kpi-value${valueColor ? ` ${valueColor}` : ''}`}>{fmt(value)}</div>
        <div className={`db-kpi-desc${descColor ? ` ${descColor}` : ''}`}>{desc}</div>
      </>
    )}
  </div>
);

// ─── Meetings Chart ──────────────────────────────────────────────────────────

const MeetingsChart = () => {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);
  const [range, setRange]     = useState('7D');
  const [data7, setData7]     = useState(null);
  const [data30, setData30]   = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch both ranges — staggered 200ms after mount to avoid fan-out storm.
  // RCA 2026-06-17: all sub-components were firing simultaneously, causing OOM.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        // Backend uses ?preset=7d / preset=30d  (not ?range=)
        const [r7, r30] = await Promise.all([
          AnalyticsService.getTrend({ preset: '7d' }).catch(() => null),
          AnalyticsService.getTrend({ preset: '30d' }).catch(() => null),
        ]);
        if (!cancelled) { setData7(r7); setData30(r30); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200); // 200ms stagger — after main dashboard-stats call
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Build or update chart whenever data/range changes
  useEffect(() => {
    if (loading || !canvasRef.current) return;

    const raw    = range === '7D' ? data7 : data30;
    const days   = range === '7D' ? 7 : 30;

    // Backend returns { granularity, series: [{period, calls, emails, meetings, ...}] }
    // Also handles legacy shapes: { trend: [...] } or { dates, meetings }
    let labels = [];
    let values = [];
    if (Array.isArray(raw?.series)) {
      // Primary shape (current backend)
      labels = raw.series.map(d => d.period);
      values = raw.series.map(d => d.meetings ?? 0);
    } else if (raw?.dates && raw?.meetings) {
      // Legacy shape 1
      labels = raw.dates;
      values = raw.meetings;
    } else if (Array.isArray(raw?.trend)) {
      // Legacy shape 2
      labels = raw.trend.map(d => d.date || d.day || d.period);
      values = raw.trend.map(d => d.meetings_scheduled ?? d.meetings ?? 0);
    } else {
      // Fallback — generate empty days so the chart still renders
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        values.push(0);
      }
    }

    // Shorten labels for 30D (show only day/month without year)
    const shortLabels = labels.map(l => {
      const d = new Date(l);
      if (isNaN(d)) return l;
      return range === '7D'
        ? d.toLocaleDateString('en-GB', { weekday: 'short' })
        : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    });

    const ctx = canvasRef.current.getContext('2d');

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0,   'rgba(37,99,235,0.18)');
    gradient.addColorStop(1,   'rgba(37,99,235,0)');

    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: shortLabels,
        datasets: [{
          data: values,
          borderColor: '#2563EB',
          borderWidth: 2,
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#2563EB',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#fff',
            titleColor: '#0F172A',
            bodyColor: '#2563EB',
            borderColor: '#E2E8F0',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
            callbacks: {
              title: items => items[0]?.label || '',
              label: item => ` ${item.raw} meeting${item.raw !== 1 ? 's' : ''}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94A3B8', font: { size: 10 }, maxRotation: 0 },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            grid: { color: '#F1F5F9', drawBorder: false },
            ticks: { color: '#94A3B8', font: { size: 10 }, stepSize: 3 },
            border: { display: false },
          },
        },
      },
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [loading, range, data7, data30]);

  const raw    = range === '7D' ? data7 : data30;
  const series = raw?.series || [];
  const values = series.map(p => p.meetings ?? 0);
  const total  = values.reduce((a, b) => a + b, 0);
  const peak   = values.length ? Math.max(...values) : 0;
  const avg    = values.length ? (total / values.length).toFixed(1) : '0.0';

  return (
    <div className="db-card">
      <div className="db-card-header">
        <div>
          <p className="db-card-title">Meetings Booked</p>
          <p className="db-card-subtitle">Meetings scheduled over time</p>
        </div>
        <div className="db-toggle-group">
          {['7D', '30D'].map(r => (
            <button
              key={r}
              className={`db-toggle-btn${range === r ? ' active' : ''}`}
              onClick={() => setRange(r)}
            >{r}</button>
          ))}
        </div>
      </div>
      <div className="db-card-body">
        {loading ? (
          <div className="db-kpi-skeleton" style={{ height: 220, borderRadius: 8 }} />
        ) : (
          <div className="db-chart-wrap">
            <canvas ref={canvasRef} />
          </div>
        )}
        {!loading && (
          <div className="db-chart-pills">
            <span className="db-chart-pill">Total: <strong>{total}</strong></span>
            <span className="db-chart-pill">Peak: <strong>{peak}</strong></span>
            <span className="db-chart-pill">Avg/day: <strong>{avg}</strong></span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Leaderboard Mini ────────────────────────────────────────────────────────

const rankClass = r => r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : 'plain';

const LeaderboardMini = ({ onNavigate }) => {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  // Staggered 400ms after mount — lower priority than main stats + chart.
  // RCA 2026-06-17: was firing simultaneously with 6 other API calls.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        // Uses the correct API_BASE so the call hits the backend, not the static host
        const res = await fetch(`${API_BASE}/api/leaderboard`, { headers: authHeaders() });
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setRows(Array.isArray(data) ? data.slice(0, 5) : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400); // 400ms stagger
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return (
    <div className="db-card">
      <div className="db-card-header">
        <p className="db-card-title" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8', fontWeight: 600 }}>
          Leaderboard
        </p>
        <button className="db-card-link" onClick={() => typeof onNavigate === 'function' ? onNavigate('leaderboard') : window._loadView?.('leaderboard')}>
          View all →
        </button>
      </div>
      <div className="db-lb-rows">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="db-lb-row">
                <div className="db-kpi-skeleton" style={{ width: 22, height: 22, borderRadius: '50%' }} />
                <div style={{ flex: 1 }}>
                  <div className="db-kpi-skeleton" style={{ height: 13, width: '70%', borderRadius: 4 }} />
                </div>
                <div className="db-kpi-skeleton" style={{ height: 15, width: 28, borderRadius: 4 }} />
              </div>
            ))
          : rows.length === 0
            ? <div style={{ padding: '16px 20px', fontSize: 12, color: '#94A3B8' }}>No leaderboard data</div>
            : rows.map((row, i) => (
                <div key={i} className="db-lb-row">
                  <div className={`db-lb-rank ${rankClass(row.rank ?? i + 1)}`}>
                    {row.rank ?? i + 1}
                  </div>
                  <div className="db-lb-name">
                    <div className="db-lb-name-text">{row.name || row.sdr_name}</div>
                    {row.pod_name && <div className="db-lb-pod">{row.pod_name}</div>}
                  </div>
                  <div className="db-lb-meetings">
                    <div className="db-lb-meetings-num">{row.meetings_scheduled ?? 0}</div>
                    <div className="db-lb-meetings-label">meetings</div>
                  </div>
                </div>
              ))
        }
      </div>
    </div>
  );
};

// ─── Needs Attention ─────────────────────────────────────────────────────────

const NeedsAttention = () => {
  const [sdrs, setSdrs]       = useState([]);
  const [loading, setLoading] = useState(true);

  // Staggered 600ms — below-fold component, lowest fetch priority.
  // RCA 2026-06-17: was firing simultaneously with 6 other API calls.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        // getSdrTable returns { sdrs: [...] } — filter for SDRs with 0 calls today
        const data = await AnalyticsService.getSdrTable({ preset: '1d' });
        const sdrList = Array.isArray(data?.sdrs) ? data.sdrs : [];
        const inactive = sdrList.filter(s => (s.calls_made ?? s.calls ?? s.total_calls ?? 0) === 0);
        if (!cancelled) setSdrs(inactive.slice(0, 5));
      } catch {
        if (!cancelled) setSdrs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 600); // 600ms stagger — lowest priority
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return (
    <div className="db-card">
      <div className="db-card-header">
        <div>
          <p className="db-card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Needs Attention
          </p>
          <p className="db-card-subtitle">SDRs with no moves today</p>
        </div>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>Today</span>
      </div>
      <div className="db-attn-rows">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="db-attn-row">
                <div className="db-kpi-skeleton" style={{ width: 30, height: 30, borderRadius: '50%' }} />
                <div className="db-kpi-skeleton" style={{ flex: 1, height: 13, borderRadius: 4 }} />
                <div className="db-kpi-skeleton" style={{ width: 80, height: 20, borderRadius: 20 }} />
              </div>
            ))
          : sdrs.length === 0
            ? <div className="db-attn-empty">✓ All SDRs active today</div>
            : sdrs.map((s, i) => {
                const name = s.name || s.sdr_name || 'SDR';
                return (
                  <div key={i} className="db-attn-row">
                    <div
                      className="db-attn-avatar"
                      style={{ background: avatarColor(name) }}
                    >
                      {initials(name)}
                    </div>
                    <span className="db-attn-name">{name}</span>
                    <span className="db-attn-badge">0 moves today</span>
                  </div>
                );
              })
        }
      </div>
      {!loading && sdrs.length > 0 && (
        <div className="db-attn-footer">{sdrs.length} SDR{sdrs.length > 1 ? 's' : ''} need a nudge</div>
      )}
    </div>
  );
};

// ─── Pipeline by Stage ───────────────────────────────────────────────────────

const STAGE_COLORS = {
  'Lead Assigned':       '#3B82F6',
  'Calling':             '#059669',
  'Meeting Scheduled':   '#D97706',
  'Demo Scheduled':      '#6366F1',
  'Demo Done':           '#0D9488',
  'Completed':           '#16A34A',
  'Disqualified':        '#94A3B8',
};

// ─── SVG icon helpers for PipelineIntelligence metrics (Option B) ─────────
// TrendingUp, Target, PhoneCall, ClipboardCheck
const IconVelocity = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  </svg>
);
const IconConversion = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="6"/>
    <circle cx="12" cy="12" r="2"/>
  </svg>
);
const IconConnect = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 17.3z"/>
    <path d="M14.05 2a9 9 0 0 1 8 7.94"/>
    <path d="M14.05 6A5 5 0 0 1 18 10"/>
  </svg>
);
const IconResearch = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <path d="m9 14 2 2 4-4"/>
  </svg>
);

// Metric display config — maps backend category → { label, Icon, colors }
const METRIC_META = {
  velocity:   { label: 'Pipeline Velocity',  Icon: IconVelocity,   color: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' },
  conversion: { label: 'Conversion Rate',    Icon: IconConversion,  color: '#15803D', bg: '#F0FDF4', border: '#BBF7D0' },
  health:     { label: 'Call Connect Rate',  Icon: IconConnect,     color: '#7C3AED', bg: '#FDF4FF', border: '#E9D5FF' },
  efficiency: { label: 'Research Readiness', Icon: IconResearch,   color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
};

// ─── Pipeline Intelligence (merged: pipeline bars + AI health metrics) ────────
// Option A: bars are the hero; AI score is a header chip; 4 metrics in a
// horizontal inline strip at the bottom. Data-source note is always visible.

const PipelineIntelligence = ({ statusCounts = {}, total = 0, loading: statsLoading }) => {
  const [gi, setGi]         = useState(null);
  const [giLoading, setGiLoading] = useState(true);

  // Staggered 800ms — Groq AI call is heaviest; fires last after all UI is visible.
  // RCA 2026-06-17: growth-intelligence was firing simultaneously with 6 other calls.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        const res = await LeadsService.getGrowthIntelligence();
        if (!cancelled) setGi(res);
      } catch { if (!cancelled) setGi(null); }
      finally { if (!cancelled) setGiLoading(false); }
    }, 800); // 800ms stagger — Groq AI is heaviest, fire last
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // ── Pipeline bars config ─────────────────────────────────────────────────
  const SHOW_STAGES = [
    'Lead Assigned', 'Calling', 'Meeting Scheduled',
    'Demo Scheduled', 'Demo Done', 'Completed', 'Disqualified',
  ];
  const rows = SHOW_STAGES
    .map(stage => ({
      label: stage,
      count: statusCounts[stage] ?? 0,
      color: STAGE_COLORS[stage] ?? '#94A3B8',
      pct:   total ? ((statusCounts[stage] ?? 0) / total) * 100 : 0,
    }))
    .filter(r => r.count > 0 || r.label === 'Lead Assigned');

  // ── AI health score ──────────────────────────────────────────────────────
  const score      = gi?.ai?.health_score ?? null;
  const insights   = Array.isArray(gi?.ai?.insights) ? gi.ai.insights : [];
  const scoreColor = score === null ? '#94A3B8'
    : score >= 60 ? '#16a34a'
    : score >= 35 ? '#d97706'
    : '#dc2626';

  // Map insights array to the 4 known categories in display order
  const ORDER = ['velocity', 'conversion', 'health', 'efficiency'];
  const metricMap = {};
  insights.forEach(ins => { metricMap[ins.category] = ins; });
  const metrics = ORDER.map(cat => ({
    meta: METRIC_META[cat],
    ins:  metricMap[cat] ?? null,
  })).filter(m => m.meta);

  return (
    <div className="db-card">
      {/* Header */}
      <div className="db-card-header">
        <div>
          <p className="db-card-title">Pipeline Intelligence</p>
          <p className="db-card-subtitle">Live stage distribution · AI health scoring</p>
        </div>
        {/* Health score chip */}
        {!giLoading && score !== null && (
          <span className="db-pi-score-chip" style={{ color: scoreColor, borderColor: scoreColor + '33' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
            Health {score}/100
          </span>
        )}
      </div>

      {/* Pipeline bars */}
      <div className="db-card-body" style={{ paddingBottom: 12 }}>
        {statsLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="db-pipeline-row">
                <div className="db-kpi-skeleton" style={{ width: 130, height: 12, borderRadius: 4 }} />
                <div className="db-kpi-skeleton" style={{ flex: 1, height: 7, borderRadius: 4 }} />
                <div className="db-kpi-skeleton" style={{ width: 48, height: 12, borderRadius: 4 }} />
              </div>
            ))
          : rows.map(row => (
              <div key={row.label} className="db-pipeline-row">
                <span className="db-pipeline-label">{row.label}</span>
                <div className="db-pipeline-track">
                  <div
                    className="db-pipeline-fill"
                    style={{ width: `${Math.max(row.pct, row.count > 0 ? 1 : 0)}%`, background: row.color }}
                  />
                </div>
                <span className="db-pipeline-count">{fmt(row.count)}</span>
              </div>
            ))
        }
      </div>

      {/* Divider + AI metric strip */}
      <div className="db-pi-metrics-strip">
        {giLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="db-pi-metric">
                <div className="db-kpi-skeleton" style={{ width: 80, height: 10, borderRadius: 4, marginBottom: 4 }} />
                <div className="db-kpi-skeleton" style={{ width: 48, height: 16, borderRadius: 4 }} />
              </div>
            ))
          : metrics.map(({ meta, ins }) => {
              const rawVal   = ins?.metric_value ?? null;
              // Clean verbose API strings like '66 (meetings booked) and 0 (calls made)'
              const fmtMetricVal = (raw) => {
                if (raw === null || raw === undefined) return '—';
                const s = String(raw);
                const lead = s.match(/^([\d,.]+%?)/);
                return lead ? lead[1] : (s.length > 12 ? s.slice(0, 10) + '…' : s);
              };
              const val      = fmtMetricVal(rawVal);
              const trend    = ins?.trend;
              const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : null;
              const trendColor = trend === 'up' ? '#16a34a' : trend === 'down' ? '#dc2626' : '#94A3B8';
              return (
                <div key={meta.label} className="db-pi-metric">
                  <span className="db-pi-metric-label" style={{ color: meta.color }}>
                    <meta.Icon />
                    {meta.label}
                  </span>
                  <span className="db-pi-metric-val">
                    {val}
                    {trendIcon && <span style={{ color: trendColor, fontSize: 10, marginLeft: 2 }}>{trendIcon}</span>}
                  </span>
                </div>
              );
            })
        }
      </div>

      {/* Data-source transparency footer */}
      <div className="db-pi-footer">
        <span className="db-pi-footer-src">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Pipeline bars: live CRM data &nbsp;·&nbsp; Health metrics: 30-day rolling window
        </span>
        <span className="db-pi-footer-ai">✦ AI-scored</span>
      </div>
    </div>
  );
};



// ─── Insight Pills (rule-engine based, mirrors DashboardTab) ─────────────────

const InsightPills = ({ stats }) => {
  const insights = runRuleEngine(stats);
  if (!insights.length) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      {insights.map((ins, i) => {
        const styles = {
          warn: { background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' },
          good: { background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#15803D' },
          info: { background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8' },
        }[ins.level] || { background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#475569' };
        return (
          <span key={i} style={{
            ...styles,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 999,
            fontSize: 12, fontWeight: 600,
          }}>
            {ins.icon} {ins.text}
          </span>
        );
      })}
    </div>
  );
};


// ─── Call Outcomes Today (SDR only) ──────────────────────────────────────────
const OUTCOME_COLORS = {
  'Connected':           { bg: '#DCFCE7', color: '#15803D' },
  'Voicemail':           { bg: '#DBEAFE', color: '#1D4ED8' },
  'No Answer':           { bg: '#F1F5F9', color: '#64748B' },
  'Not Interested':      { bg: '#FEE2E2', color: '#DC2626' },
  'Wrong Number':        { bg: '#FEF3C7', color: '#B45309' },
  'Callback Requested':  { bg: '#EDE9FE', color: '#7C3AED' },
  'Do Not Call':         { bg: '#FEE2E2', color: '#DC2626' },
  'Busy':                { bg: '#F1F5F9', color: '#64748B' },
};
const defaultOutcomeStyle = { bg: '#F1F5F9', color: '#475569' };

const CallOutcomesCard = ({ onNavigate }) => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res  = await fetch(`${API_BASE}/api/sdr/call-summary`, { headers: authHeaders() });
        const json = res.ok ? await res.json() : null;
        if (!cancelled) setData(json);
      } catch { if (!cancelled) setData(null); }
      finally  { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const allOutcomes  = data?.outcomes_today ? Object.entries(data.outcomes_today) : [];
  // Only show outcomes with count > 0
  const outcomes     = allOutcomes.filter(([, count]) => count > 0);
  const callsToday   = data?.calls_today ?? 0;

  const handleOutcomeClick = (outcome) => {
    try {
      const state = JSON.parse(sessionStorage.getItem('leads_view_state') || '{}');
      state.outcomeFilter = outcome;
      state.currentPage   = 1;
      sessionStorage.setItem('leads_view_state', JSON.stringify(state));
    } catch {}
    // Mixpanel: Outcome Card Clicked
    try { window.mixpanel?.track('Outcome Card Clicked', { outcome, count: data?.outcomes_today?.[outcome] ?? 0 }); } catch {}
    // Use onNavigate prop if available, fall back to window._loadView for robustness
    if (typeof onNavigate === 'function') {
      onNavigate('leads');
    } else {
      window._loadView?.('leads');
    }
  };

  return (
    <div className="db-card">
      <div className="db-card-header">
        <div>
          <p className="db-card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.21 12 19.79 19.79 0 0 1 1.14 3.38 2 2 0 0 1 3.12 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            Today's Call Outcomes
          </p>
          <p className="db-card-subtitle">{callsToday} call{callsToday !== 1 ? 's' : ''} logged today</p>
        </div>
        {outcomes.length > 0 && (
          <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 500 }}>Click to filter leads</span>
        )}
      </div>
      <div style={{ padding: '12px 20px 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[90, 100, 85, 95].map((w, i) => (
              <div key={i} className="db-kpi-skeleton" style={{ width: w, height: 64, borderRadius: 10 }} />
            ))}
          </div>
        ) : outcomes.length === 0 ? (
          <div style={{ padding: '20px 0', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
            {callsToday === 0 ? 'No calls logged today yet — go make some! 📞' : 'All outcomes recorded'}
          </div>
        ) : (
          <div className="db-outcomes-grid">
            {outcomes.map(([outcome, count]) => {
              const style = OUTCOME_COLORS[outcome] ?? defaultOutcomeStyle;
              return (
                <div
                  key={outcome}
                  className="db-outcome-card"
                  onClick={() => handleOutcomeClick(outcome)}
                  title={`Click to filter leads by "${outcome}"`}
                  style={{ background: style.bg, borderColor: style.color + '30' }}
                >
                  <div className="db-outcome-count" style={{ color: style.color }}>{count}</div>
                  <div className="db-outcome-label" style={{ color: style.color }}>{outcome}</div>
                  <div className="db-outcome-arrow" style={{ color: style.color }}>→</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Dashboard ──────────────────────────────────────────────────────────


export const Dashboard = ({ onLeadClick, onNavigate, userName = '', userRole = '' }) => {
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [spinning, setSpinning] = useState(false);
  const [isFirst]             = useState(() => checkFirstVisit());
  const [errorLog, setErrorLog] = useState(null);  // { total, critical, warning }

  // Pod Admin: My Pod / Global toggle — persisted in sessionStorage
  const _getGlobalView = () => {
    try { return JSON.parse(sessionStorage.getItem('dashboard_view_state'))?.globalView === true; } catch { return false; }
  };
  const [globalView, setGlobalView] = useState(false);  // Always default to My Pod view
  const toggleGlobalView = (val) => {
    try { sessionStorage.setItem('dashboard_view_state', JSON.stringify({ globalView: val })); } catch {}
    setGlobalView(val);
  };

  const _role       = (userRole || '').toLowerCase();
  const isSuperAdmin = ['super_admin','super admin','admin'].includes(_role);
  const isPodAdmin   = _role.includes('pod');
  const isSDR        = !isSuperAdmin && !isPodAdmin;

  const load = useCallback(async () => {
    try {
      setError('');
      setLoading(true);
      setSpinning(true);
      const isSA = ['super_admin','super admin','admin'].includes((userRole||'').toLowerCase());
      // Fire both requests in parallel — getErrorLogSummary was sequential before,
      // adding ~640ms to the critical path for Super Admins on every dashboard load.
      const [data, el] = await Promise.all([
        LeadsService.getDashboardStats(globalView, Date.now()),
        isSA ? LeadsService.getErrorLogSummary(24).catch(() => null) : Promise.resolve(null),
      ]);
      setStats(data);
      if (isSA) setErrorLog(el);
    } catch (err) {
      const detail = err?.response?.data?.detail
        || (err?.code === 'ERR_CANCELED' ? 'Request timed out' : err?.message)
        || 'Check API connectivity';
      setError(`Failed to load dashboard metrics: ${detail}`);
    } finally {
      setLoading(false);
      setTimeout(() => setSpinning(false), 600);
    }
  }, [globalView, userRole]);

  useEffect(() => { load(); }, [load]);

  const sc = stats?.status_counts ?? {};
  const total = stats?.total ?? 0;

  const meetingsTotal = (sc['Meeting Scheduled'] ?? 0) + (sc['Demo Scheduled'] ?? 0) + (sc['Demo Done'] ?? 0) + (sc['Completed'] ?? 0);
  const KPI_CARDS = isSDR ? [
    { label: 'MY LEADS',         value: total,                       desc: 'Assigned to me' },
    { label: 'NEW LEADS',        value: sc['Lead Assigned'] ?? 0,    valueColor: 'blue',  desc: 'Untouched leads' },
    { label: 'RESEARCH PENDING', value: sc['Research'] ?? 0,         valueColor: 'amber', desc: 'Complete research first' },
    { label: 'CALLING',          value: sc['Calling'] ?? 0,          valueColor: 'green', desc: '↑ In calling queue', descColor: 'green' },
    { label: 'MEETINGS BOOKED',  value: meetingsTotal,               valueColor: 'green', desc: '↑ Keep it up!', descColor: 'green' },
  ] : [
    { label: 'TOTAL LEADS',      value: total,                                              desc: 'All sources' },
    { label: 'CALLING',          value: sc['Calling'] ?? 0,         valueColor: 'green',   desc: '↑ Active calling', descColor: 'green' },
    { label: 'MEETINGS+',        value: sc['Meeting Scheduled'] ?? 0, valueColor: 'amber', desc: 'Qualified pipeline' },
    { label: 'LEAD ASSIGNED',    value: sc['Lead Assigned'] ?? 0,                          desc: 'Awaiting research' },
    { label: 'DEMO SCHEDULED',   value: sc['Demo Scheduled'] ?? 0,                         desc: 'Pipeline' },
    { label: 'DEMOS DONE',       value: (sc['Demo Done'] ?? 0) + (sc['Completed'] ?? 0),   desc: '↑ SF synced', descColor: 'green' },
    { label: 'NO PHONE',         value: stats?.parked_count ?? 0,   valueColor: 'red',     desc: 'Needs attention', descColor: 'red', alert: (stats?.parked_count ?? 0) > 0 },
  ];

  return (
    <div className="dashboard-hub-root" style={{ padding: '16px 24px' }}>

      {/* Page header */}
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Dashboard</h1>
          {/* Welcome greeting line removed — moved to WelcomeStrip below */}
          <p className="db-page-subtitle">
            {loading
              ? <span className="db-kpi-skeleton" style={{ display:'inline-block', width:160, height:12, borderRadius:4, verticalAlign:'middle' }} />
              : isSDR
                ? <>My Dashboard · {fmt(total)} my leads</>
                : isPodAdmin
                  ? <>{globalView ? 'Global view' : 'My Pod view'} — {fmt(total)} leads</>
                  : <>Org-wide view · {fmt(total)} total leads</>
            }
          </p>
        </div>
        {/* Right-side controls: Pod Admin toggle + Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {isPodAdmin && (
            <div className="db-scope-toggle" role="group" aria-label="Dashboard scope">
              <button
                className={`db-scope-toggle-btn${!globalView ? ' active' : ''}`}
                onClick={() => toggleGlobalView(false)}
                title="Show only your pod's data"
              >
                {/* Lock icon — My Pod */}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: 'middle' }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                My Pod
              </button>
              <button
                className={`db-scope-toggle-btn${globalView ? ' active' : ''}`}
                onClick={() => toggleGlobalView(true)}
                title="Show all org-wide data"
              >
                {/* Globe icon — Global */}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: 'middle' }}>
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                Global
              </button>
            </div>
          )}
          <button
            className={`db-refresh-btn${spinning ? ' spinning' : ''}`}
            onClick={load}
            disabled={loading}
            aria-label="Refresh dashboard"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="db-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      {/* ── Welcome Briefing Strip (Option A) ────────────────────── */}
      {userName && (() => {
        // ── Role-based greeting subtitle ──────────────────────────
        const _role = (userRole || '').toLowerCase();
        const _isPodAdmin = _role.includes('pod');
        const _subText = isSuperAdmin
          ? `Here's your org-wide pipeline · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
          : _isPodAdmin
            ? `Your pod's pipeline · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
            : `Good to have you back · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;

        return (
          <div className="db-welcome-strip">
            <div className="db-welcome-left">
              <span className="db-welcome-greeting">
                {getGreeting()}, {getFirstName(userName)} 👋
              </span>
              <span className="db-welcome-time">{_subText}</span>
            </div>

            {/* Super Admin: Calling + Meetings + Error count (last 24h) */}
            {isSuperAdmin && (
              <div className="db-welcome-pills">
                {loading ? (
                  <>
                    <span className="db-kpi-skeleton" style={{width:88,height:26,borderRadius:20,display:'inline-block'}}/>
                    <span className="db-kpi-skeleton" style={{width:100,height:26,borderRadius:20,display:'inline-block'}}/>
                    <span className="db-kpi-skeleton" style={{width:90,height:26,borderRadius:20,display:'inline-block'}}/>
                  </>
                ) : (
                  <>
                    <span className="db-wpill db-wpill--green">
                      <span className="db-wpill-dot"/>
                      {fmt(sc['Calling'] ?? 0)} Calling
                    </span>
                    <span className="db-wpill db-wpill--blue">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      {fmt(sc['Meeting Scheduled'] ?? 0)} Meetings+
                    </span>
                    {errorLog !== null && (errorLog?.total ?? 0) > 0 && (
                      <span className="db-wpill db-wpill--red">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        {fmt(errorLog.total)} Error{errorLog.total !== 1 ? 's' : ''} · 24h
                      </span>
                    )}
                    {errorLog !== null && (errorLog?.total ?? 0) === 0 && (
                      <span className="db-wpill db-wpill--green-clean">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Clean · 24h
                      </span>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Pod Admin: Calling + Meetings only */}
            {!isSuperAdmin && _isPodAdmin && !loading && (
              <div className="db-welcome-pills">
                <span className="db-wpill db-wpill--green">
                  <span className="db-wpill-dot"/>
                  {fmt(sc['Calling'] ?? 0)} Calling
                </span>
                <span className="db-wpill db-wpill--blue">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  {fmt(sc['Meeting Scheduled'] ?? 0)} Meetings+
                </span>
              </div>
            )}
            {/* SDR: no pills — just the warm greeting */}
          </div>
        );
      })()}

      {/* Row 1 — Insight Pills (admin/pod admin only — org-wide stats not relevant for SDR) */}
      {!loading && !isSDR && <InsightPills stats={stats} />}

      {/* Row 2 — KPI Cards */}
      <div className="db-kpi-row">
        {KPI_CARDS.map(card => (
          <KpiCard key={card.label} {...card} loading={loading} />
        ))}
      </div>

      {/* Row 2 — Bento grid, role-aware. key forces remount when Pod Admin toggles scope */}
      <div className="db-bento" key={`bento-${globalView}`}>
        <div className="db-bento-left">
          {/* MeetingsChart — admin/pod admin only (SDR would get 403 on /admin/analytics/trend) */}
          {!isSDR && <MeetingsChart />}
          {/* Pipeline Intelligence — admin/pod admin only */}
          {!isSDR && (
            <PipelineIntelligence
              statusCounts={sc}
              total={total}
              loading={loading}
            />
          )}
          {/* SDR: show today's call outcome summary instead */}
          {isSDR && <CallOutcomesCard onNavigate={onNavigate} />}
        </div>
        <div className="db-bento-right">
          <LeaderboardMini onNavigate={onNavigate} />
          {/* Needs Attention — admin/pod admin only (SDR doesn't manage other SDRs) */}
          {!isSDR && <NeedsAttention />}
        </div>
      </div>
    </div>
  );
};
