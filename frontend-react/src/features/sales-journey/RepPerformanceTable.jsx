import React, { useEffect, useState, useCallback } from 'react';
import { Users } from 'lucide-react';
import { SalesJourneyService } from '../../services/api';
import { toast } from './toast';
import { ReportingSection } from './ReportingSection';

const pct = (rate) => `${Math.round((rate || 0) * 100)}%`;

// v13.1.8 — GET /stats/by-rep was built in v13.0.6 to answer "whose sends
// on this cadence convert best" but was never wired into any screen until
// now (the reporting revamp that moved everything off a 384px drawer and
// onto a full tab finally gave it room to live).
export function RepPerformanceTable({ journeyId }) {
  const [reps, setReps] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReps((await SalesJourneyService.getStatsByRep(journeyId)).reps || []);
    } catch {
      toast('Failed to load rep performance.', 'error');
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !reps || reps.length === 0) return null;

  return (
    <ReportingSection icon={Users} title="Rep performance">
      <div className="overflow-x-auto rounded-lg border border-slate-100">
        <table className="text-xs w-full">
          <thead>
            <tr className="text-slate-400 text-left bg-slate-50">
              <th className="font-semibold pl-3 pr-3 py-2">Rep</th>
              <th className="font-semibold pr-3 py-2">Sent</th>
              <th className="font-semibold pr-3 py-2">Open %</th>
              <th className="font-semibold pr-3 py-2">Click %</th>
              <th className="font-semibold pr-3 py-2">Reply %</th>
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.user_id} className="border-t border-slate-100">
                <td className="pl-3 pr-3 py-1.5 text-slate-700 font-medium">{r.name}</td>
                <td className="pr-3 py-1.5">{r.sent}</td>
                <td className="pr-3 py-1.5">{pct(r.open_rate)}</td>
                <td className="pr-3 py-1.5">{pct(r.click_rate)}</td>
                <td className="pr-3 py-1.5">{pct(r.reply_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportingSection>
  );
}
