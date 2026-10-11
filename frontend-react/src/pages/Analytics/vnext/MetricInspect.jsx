import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { AnalyticsVNextService } from '../../../services/api';
import { formatMetricValue } from './format';

const LABEL_STYLE = { fontWeight: 600, color: '#64748B', textTransform: 'uppercase', fontSize: 11 };

/**
 * MetricInspect — the Inspect surface every migrated metric must provide
 * (docs §13/Phase 1 "Metric inspection"). Shows definition, formula,
 * numerator/denominator, date basis, scope, version, source, and — for
 * Admin/Super Admin only — a pointer to the implementing function (never
 * raw/editable SQL, per §14).
 */
export const MetricInspect = ({ metricId, filters, onClose }) => {
  const [envelope, setEnvelope] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    AnalyticsVNextService.resolveMetric(metricId, filters).then((data) => {
      if (cancelled) return;
      if (data?.error) setError(data.message || 'Could not resolve this metric.');
      else setEnvelope(data);
    });
    return () => { cancelled = true; };
  }, [metricId, filters]);

  return (
    <Modal open onClose={onClose} title={envelope?.metric?.name || metricId} maxWidth="max-w-[480px]">
      <div style={{ fontSize: 13 }}>
        {error && <div style={{ color: '#B91C1C' }}>{error}</div>}

        {envelope && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
            <div>
              <div style={LABEL_STYLE}>Definition</div>
              <div>{envelope.explanation.definition}</div>
            </div>
            <div>
              <div style={LABEL_STYLE}>Formula</div>
              <div>{envelope.explanation.formula}</div>
            </div>
            {(envelope.explanation.numerator !== null || envelope.explanation.denominator !== null) && (
              <div>
                <div style={LABEL_STYLE}>Calculation</div>
                <div>
                  {envelope.explanation.numerator}
                  {envelope.explanation.numerator_label && ` (${envelope.explanation.numerator_label})`}
                  {' / '}
                  {envelope.explanation.denominator}
                  {envelope.explanation.denominator_label && ` (${envelope.explanation.denominator_label})`}
                  {' → '}{formatMetricValue(envelope.value, envelope.metric.unit)}
                </div>
              </div>
            )}
            <div>
              <div style={LABEL_STYLE}>Date basis</div>
              <div>{envelope.explanation.date_basis}</div>
            </div>
            <div>
              <div style={LABEL_STYLE}>Scope</div>
              <div>
                Pod: {envelope.explanation.filters_applied.pod_id || 'All'} ·{' '}
                Batch: {envelope.explanation.filters_applied.batch_id || 'All'} ·{' '}
                {envelope.explanation.date_range.start
                  ? `${envelope.explanation.date_range.start.slice(0, 10)} → ${envelope.explanation.date_range.end?.slice(0, 10) || 'now'}`
                  : 'All time'}
              </div>
            </div>
            <div>
              <div style={LABEL_STYLE}>Metric version</div>
              <div>v{envelope.metric.version} · {envelope.metric.status}</div>
            </div>
            {envelope.explanation.query_implementation && (
              <div>
                <div style={LABEL_STYLE}>Query implementation</div>
                <code style={{ fontSize: 12 }}>{envelope.explanation.query_implementation}</code>
              </div>
            )}
            {envelope.explanation.known_caveats?.length > 0 && (
              <div>
                <div style={LABEL_STYLE}>Known caveats</div>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {envelope.explanation.known_caveats.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {envelope.explanation.warnings?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, color: '#B45309', background: '#FFFBEB', padding: 8, borderRadius: 6 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <div>{envelope.explanation.warnings.join(' ')}</div>
              </div>
            )}
            <div style={{ color: '#94A3B8', fontSize: 11 }}>Resolved in {envelope.explanation.execution_ms}ms</div>
          </div>
        )}
      </div>
    </Modal>
  );
};
