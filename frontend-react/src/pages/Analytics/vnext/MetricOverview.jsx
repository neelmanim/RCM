import React, { useEffect, useState } from 'react';
import { AnalyticsVNextService } from '../../../services/api';
import { formatMetricValue } from './format';

const CATEGORY_LABELS = {
  calls: 'Calls',
  pipeline: 'Pipeline',
  email: 'Email',
};

/**
 * Overview tab (Phase 4) — a glance-level KPI grid over the full registry,
 * grouped by category. Pure client-side composition of the existing
 * GET /metrics + per-metric resolve calls MetricCard already makes — no new
 * endpoint, no dimensional/group-by execution (the semantic layer stays
 * scalar-only per Phase 2). Read-only: no Inspect/Compare/Try vN here, that
 * stays the Metrics tab's job — this is the "what's the state of things"
 * landing view.
 */
export const MetricOverview = ({ metrics, filters }) => {
  const [values, setValues] = useState({});

  useEffect(() => {
    let cancelled = false;
    setValues({});
    metrics.forEach((m) => {
      AnalyticsVNextService.resolveMetric(m.id, filters).then((data) => {
        if (cancelled) return;
        setValues((prev) => ({ ...prev, [m.id]: data?.error ? null : data?.value }));
      });
    });
    return () => { cancelled = true; };
  }, [metrics, filters]);

  const byCategory = metrics.reduce((acc, m) => {
    (acc[m.category] = acc[m.category] || []).push(m);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {Object.entries(byCategory).map(([category, categoryMetrics]) => (
        <div key={category}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
            {CATEGORY_LABELS[category] || category}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {categoryMetrics.map((m) => {
              const value = values[m.id];
              return (
                <div key={m.id} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
                    {value === undefined ? '···' : formatMetricValue(value, m.unit)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
