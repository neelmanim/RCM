import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowLeft, BarChart3, Sparkles } from 'lucide-react';
import { AnalyticsVNextService, AnalyticsService } from '../../../services/api';
import { Select } from '../../../components/ui/Select';
import { Tabs } from '../../../components/ui/Tabs';
import { MetricCard } from './MetricCard';
import { MetricInspect } from './MetricInspect';
import { MetricOverview } from './MetricOverview';
import { AskAnalyticsVNext } from './AskAnalyticsVNext';

/**
 * Analytics Hub vNext — Phase 1 parallel beta, Phase 4 UX pass.
 *
 * Purely additive: mounted as an alternate `view` inside the existing
 * AnalyticsHub.jsx root (see AnalyticsHub.jsx's `view` state), not a
 * separate bundle/route. Demonstrates the full registry, current
 * scope/filtering, metric inspection, old-vs-new comparison, Phase 3
 * governance (Try vN), and Ask Analytics over the semantic layer.
 *
 * 3 tabs: Overview (KPI grid, client-side composition of the existing
 * GET /metrics — no new endpoint), Metrics (the original catalog view),
 * Ask Analytics. Still no Explore tab — that implies dimensional
 * breakdown, which isn't implemented in the semantic layer yet (scalar
 * resolution only, see backend/analytics/semantic.py). A tab that looks
 * like it explores but doesn't would be worse than not having it.
 */
// Phase 3 governance roles. Backend (auth.py's require_metric_editor/
// require_metric_publisher) actually accepts Pod Admin+ for editing, but
// vNext entry itself is Super-Admin-only (VNEXT_ALLOWED_ROLES in
// AnalyticsHub.jsx) — these stay within that gate rather than widen it, so
// Pod Admin editing becomes reachable only once/if vNext entry itself opens up.
const METRIC_EDITOR_ROLES = ['super admin'];
const METRIC_PUBLISHER_ROLES = ['super admin'];

const VNEXT_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'ask', label: 'Ask Analytics', icon: Sparkles },
];

export const AnalyticsHubVNext = ({ userRole, onBackToClassic }) => {
  const [tab, setTab] = useState('metrics');
  const [metrics, setMetrics] = useState([]);
  const [pods, setPods] = useState([]);
  const [preset, setPreset] = useState('30d');
  const [podId, setPodId] = useState('');
  const [inspecting, setInspecting] = useState(null);

  const isSuperAdminOrAdmin = ['super admin', 'admin'].includes((userRole || '').toLowerCase());
  const canEditMetrics = METRIC_EDITOR_ROLES.includes((userRole || '').toLowerCase());
  const canPublishMetrics = METRIC_PUBLISHER_ROLES.includes((userRole || '').toLowerCase());

  useEffect(() => {
    AnalyticsVNextService.listMetrics().then(setMetrics);
    if (isSuperAdminOrAdmin) {
      AnalyticsService.getFilters({}).then((opts) => setPods(opts.pods || [])).catch(() => {});
    }
  }, [isSuperAdminOrAdmin]);

  // Memoized so opening Inspect (which only changes `inspecting` state)
  // doesn't create a new filters object identity and re-trigger every
  // MetricCard's resolve effect.
  const filters = useMemo(
    () => ({ preset: preset === 'all' ? undefined : preset, pod_id: podId || undefined }),
    [preset, podId]
  );

  const handleInspect = useCallback((metricId) => setInspecting(metricId), []);

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BarChart3 size={18} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Analytics Hub vNext</h2>
          <span style={{ fontSize: 11, color: '#fff', background: '#4F46E5', borderRadius: 999, padding: '2px 8px' }}>BETA</span>
        </div>
        <button
          onClick={onBackToClassic}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#4F46E5', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <ArrowLeft size={14} /> Back to current Analytics Hub
        </button>
      </div>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>
        A parallel, in-progress experience proving one canonical definition per metric.
        The current Analytics Hub is unchanged and remains the default.
      </div>

      <Tabs tabs={VNEXT_TABS} active={tab} onChange={setTab} className="mb-4" />

      {(tab === 'overview' || tab === 'metrics') && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, fontSize: 13 }}>
          <span style={{ color: '#64748B' }}>Scope:</span>
          <Select
            value={preset}
            onChange={(v) => setPreset(v)}
            options={[
              { value: '7d', label: 'Last 7 Days' },
              { value: '30d', label: 'Last 30 Days' },
              { value: '90d', label: 'Last 90 Days' },
              { value: 'all', label: 'All Time' },
            ]}
          />
          {isSuperAdminOrAdmin && pods.length > 0 && (
            <Select
              value={podId}
              onChange={(v) => setPodId(v)}
              options={pods.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="All PODs"
              searchable
            />
          )}
        </div>
      )}

      {tab === 'overview' && <MetricOverview metrics={metrics} filters={filters} />}

      {tab === 'metrics' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {metrics.map((m) => (
              <MetricCard
                key={m.id} metric={m} filters={filters} onInspect={handleInspect}
                canEdit={canEditMetrics} canPublish={canPublishMetrics}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'ask' && <AskAnalyticsVNext />}

      {inspecting && (
        <MetricInspect metricId={inspecting} filters={filters} onClose={() => setInspecting(null)} />
      )}
    </div>
  );
};
