import React, { useEffect, useState, useCallback } from 'react';
import { TrendingUp } from 'lucide-react';
import { SalesJourneyService } from '../../services/api';
import { toast } from './toast';
import { ReportingSection } from './ReportingSection';

const pct = (rate) => Math.round((rate || 0) * 100);

function formatPeriod(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// v13.1.8 — GET /stats/trend was built in v13.0.6 to answer "is this
// cadence improving or decaying" but, like by-rep, had no service method
// even wrapping it, so it was unreachable from any screen. A plain table
// with an inline bar is the honest v1 here — no new charting dependency
// for one sparkline; a real chart lib is worth it once this has more than
// a handful of weeks of data to show.
export function TrendPanel({ journeyId }) {
  const [points, setPoints] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPoints((await SalesJourneyService.getStatsTrend(journeyId)).points || []);
    } catch {
      toast('Failed to load the trend.', 'error');
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !points || points.length === 0) return null;

  return (
    <ReportingSection icon={TrendingUp} title="Weekly trend">
      <div className="space-y-1.5">
        {points.map((p) => (
          <div key={p.period} className="flex items-center gap-3 text-xs">
            <span className="w-16 shrink-0 text-slate-500">{formatPeriod(p.period)}</span>
            <div className="flex-1 h-1.5 rounded bg-slate-100 overflow-hidden">
              <div className="h-full bg-blue-500 rounded" style={{ width: `${pct(p.open_rate)}%` }} />
            </div>
            <span className="w-24 shrink-0 text-slate-500">{p.sent} sent · {pct(p.open_rate)}% open</span>
          </div>
        ))}
      </div>
    </ReportingSection>
  );
}
