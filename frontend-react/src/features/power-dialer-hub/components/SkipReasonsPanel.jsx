import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { DialerService } from '../../../services/api';

/**
 * Manager-facing read side of the skip data every rep's queue already
 * writes (POST /dialer/queue-status) — nothing rendered this anywhere
 * before 2026-08-10. Admin-only: mounted by PowerDialerHub based on userRole.
 */
export function SkipReasonsPanel() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSummary = useCallback(async (forDays) => {
    setLoading(true);
    setError(null);
    try {
      setData(await DialerService.getSkipSummary(forDays));
    } catch {
      setError('Failed to load skip summary.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSummary(days); }, [days, fetchSummary]);

  return (
    <Card className="p-5 flex flex-col gap-4" data-tour="skip-reasons-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold text-slate-800 m-0 flex items-center gap-2">
          <ShieldAlert size={16} className="text-slate-400" /> Skip Reasons
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1 text-slate-600"
            aria-label="Date range"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => fetchSummary(days)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
              <div className="text-xl font-bold text-slate-800">{data.total_skips}</div>
              <div className="text-xs text-slate-500">Total skips</div>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
              <div className="text-xl font-bold text-red-600">{data.dnc_skips}</div>
              <div className="text-xs text-slate-500">Do-not-contact skips</div>
            </div>
          </div>

          {data.by_reason.length === 0 ? (
            <div className="text-sm text-slate-400 italic text-center py-4">No skips with a reason in this range.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.by_reason.map(r => (
                <div key={r.reason} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{r.reason}</span>
                  <Badge variant="default">{r.count}</Badge>
                </div>
              ))}
            </div>
          )}

          {data.by_rep.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">By rep</div>
              {data.by_rep.map(r => (
                <div key={r.user_id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{r.name}</span>
                  <Badge variant="default">{r.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
