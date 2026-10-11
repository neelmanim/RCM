import React, { useState, useEffect, useMemo } from 'react';
import { BarChart3, AlertTriangle } from 'lucide-react';
import { InstantlyInboxService } from '../../../services/api';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Select } from '../../../components/ui/Select';
import { DateRangePicker } from '../../../components/ui/DateRangePicker';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { useSort } from '../../../utils/useSort';
import { pct } from './lib';
import { errorMessage } from '../../../utils/errorMessage';

const GROUPS = [
  { value: 'cadence', label: 'Cadence' }, { value: 'step', label: 'Step' },
  { value: 'mailbox', label: 'Mailbox' }, { value: 'rep', label: 'Rep' },
];
const NUM = [
  ['sent', 'Sent'], ['contacted', 'Contacted'], ['replied', 'Replied'], ['positive', 'Positive'],
];

function RateCell({ value }) {
  return (
    <TableCell className="tabular-nums">
      <div className="flex items-center gap-2">
        <span className="w-12 text-right">{pct(value)}</span>
        <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden" aria-hidden="true">
          <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, Math.max(0, value || 0))}%` }} />
        </div>
      </div>
    </TableCell>
  );
}

export function ReportTab() {
  const [groupBy, setGroupBy] = useState('cadence');
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [sort, toggleSort] = useSort();

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const params = { group_by: groupBy };
    if (range.from) params.from = range.from;
    if (range.to) params.to = range.to;
    InstantlyInboxService.report(params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupBy, range, attempt]);

  const rows = useMemo(() => {
    const r = [...(data?.rows || [])];
    if (!sort.key) return r;
    const dir = sort.dir === 'desc' ? -1 : 1;
    return r.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x == null) return 1; // nulls last either way
      if (y == null) return -1;
      return typeof x === 'string' ? dir * x.localeCompare(y) : dir * (x - y);
    });
  }, [data, sort]);
  const t = data?.totals;
  const groupLabel = GROUPS.find((g) => g.value === groupBy).label;

  return (
    <div className="space-y-4">
      <Card className="p-4 hover:shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupBy} onChange={setGroupBy} options={GROUPS} placeholder="Group by" ariaLabel="Group by" icon={BarChart3} />
          <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
        </div>
      </Card>

      {error ? (
        <div role="alert" className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm font-semibold">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">Couldn't load the report: {error}</span>
          <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
        </div>
      ) : loading && !data ? (
        <div role="status" aria-label="Loading report"><SkeletonTable rows={6} cols={9} /></div>
      ) : rows.length === 0 ? (
        <Card className="hover:shadow-sm">
          <EmptyState icon={BarChart3} title="No Instantly activity in this range" message="Widen the date range, or check that Instantly is connected." />
        </Card>
      ) : (
        <Table>
          <TableHead>
            <tr>
              <SortableTableHeader label={groupLabel} sortKey="label" sort={sort} onSort={toggleSort} />
              {NUM.map(([k, l]) => <SortableTableHeader key={k} label={l} sortKey={k} sort={sort} onSort={toggleSort} />)}
              <SortableTableHeader label="Reply rate" sortKey="reply_rate" sort={sort} onSort={toggleSort} />
              <SortableTableHeader label="Positive rate" sortKey="positive_rate" sort={sort} onSort={toggleSort} />
              <SortableTableHeader label="Opens" sortKey="opens" sort={sort} onSort={toggleSort} />
              <SortableTableHeader label="Clicks" sortKey="clicks" sort={sort} onSort={toggleSort} />
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-semibold text-slate-800">{r.label}</TableCell>
                {NUM.map(([k]) => <TableCell key={k} className="tabular-nums">{(r[k] ?? 0).toLocaleString()}</TableCell>)}
                <RateCell value={r.reply_rate} />
                <RateCell value={r.positive_rate} />
                <TableCell className="tabular-nums">{r.opens == null ? '—' : r.opens.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{r.clicks == null ? '—' : r.clicks.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {t && (
              <TableRow className="bg-slate-50 font-bold">
                <TableCell>Total</TableCell>
                {NUM.map(([k]) => <TableCell key={k} className="tabular-nums">{(t[k] ?? 0).toLocaleString()}</TableCell>)}
                <TableCell className="tabular-nums">{pct(t.reply_rate)}</TableCell>
                <TableCell className="tabular-nums">{pct(t.positive_rate)}</TableCell>
                <TableCell className="tabular-nums">{t.opens == null ? '—' : t.opens.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{t.clicks == null ? '—' : t.clicks.toLocaleString()}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-slate-400 m-0">Positive = the lead's current Instantly label (Interested, Meeting Booked, Meeting Completed, Won).</p>
    </div>
  );
}
