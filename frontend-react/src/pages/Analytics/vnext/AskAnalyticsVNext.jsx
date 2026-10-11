import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AnalyticsVNextService } from '../../../services/api';
import { formatMetricValue } from './format';

/**
 * Ask Analytics — natural language over the semantic layer, scalar-only for
 * Phase 1, plus day/week/month Trend (Phase 6). Shows the AI interpretation
 * BEFORE the answer (docs §18) so a misunderstood question is visible, and
 * refuses (doesn't guess) when the question names a metric or breakdown
 * that isn't supported yet (docs §17).
 */
const GROUP_BY_ADVERB = { day: 'daily', week: 'weekly', month: 'monthly' };

const TrendBars = ({ data }) => {
  const max = Math.max(1, ...data.map((d) => d.value || 0));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <div style={{ width: 70, color: '#64748B', flexShrink: 0 }}>{d.label}</div>
          <div style={{ flex: 1, background: '#EEF2FF', borderRadius: 4, height: 14 }}>
            <div style={{ width: `${(d.value / max) * 100}%`, background: '#4F46E5', borderRadius: 4, height: '100%' }} />
          </div>
          <div style={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{d.value}</div>
        </div>
      ))}
    </div>
  );
};
export const AskAnalyticsVNext = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setResponse(null);
    try {
      const data = await AnalyticsVNextService.ask(query.trim());
      setResponse(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. what's our connect rate this month?"
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14 }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#4F46E5', color: '#fff', cursor: 'pointer' }}
        >
          <Sparkles size={14} /> Ask
        </button>
      </form>

      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
        Answers Connect Rate, Disqualified, Meetings Scheduled, and Leads Assigned, plus
        day/week/month trends for Calls Made, Meetings Scheduled, Emails Sent, and Demos —
        no other breakdowns or rankings yet in vNext. Use the existing Ask AI tab for those.
      </div>

      {loading && <div style={{ marginTop: 16, fontSize: 13, color: '#64748B' }}>Thinking…</div>}

      {response && !loading && (
        <div style={{ marginTop: 16, border: '1px solid #E2E8F0', borderRadius: 10, padding: 16 }}>
          {response.interpretation && (
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
              I understood this as: <strong>{response.interpretation.metric}</strong>
              {response.interpretation.breakdown && <> broken down by {response.interpretation.breakdown}</>}
              {response.interpretation.group_by && <> as a {GROUP_BY_ADVERB[response.interpretation.group_by] || response.interpretation.group_by} trend</>}
              {response.interpretation.period && <>, {response.interpretation.period.replaceAll('_', ' ')}</>}
            </div>
          )}
          {response.unsupported ? (
            <div style={{ color: '#B45309' }}>{response.message}</div>
          ) : response.result?.data ? (
            <TrendBars data={response.result.data} />
          ) : (
            <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {formatMetricValue(response.result?.value, response.result?.metric?.unit)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
