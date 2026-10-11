import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { SearchInput } from '../../../components/ui/SearchInput';
import { Select } from '../../../components/ui/Select';
import { DateRangePicker } from '../../../components/ui/DateRangePicker';
import { Pagination } from '../../../components/ui/Pagination';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import { AuditService } from '../../../services/api';
import { errorText } from '../notify';
import { Banner } from './Banner';

const ACTION_BADGE = {
  DOWNLOAD: ['Downloaded', 'info'], BULK_READ: ['Bulk read', 'info'], BROWSER_CSV: ['CSV in browser', 'info'],
  ALLOWED: ['Allowed', 'success'], BLOCKED: ['Switched off', 'danger'],
  ADDED: ['Added', 'success'], CHANGED: ['Changed', 'primary'], REMOVED: ['Removed', 'danger'],
};
export const formatWhen = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

/** The permanent who / what / when trail (Super Admin). `category` is what to list ("export,export_access", "sf_mapping"); `kinds`
 *  optionally adds a menu that narrows it. Read-only: nothing here can be edited or deleted. */
export function AuditLogPanel({ category, kinds, searchLabel = 'Search by person or action…', emptyMessage = 'Nothing has been recorded yet.', pageSize = 15 }) {
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    try {
      setData(await AuditService.list({ category: kind || category, q: query || undefined, date_from: range.from || undefined,
        date_to: range.to || undefined, page, per_page: pageSize }));
      setError('');
    } catch (e) { setError(errorText(e)); setData((d) => d || { items: [], total: 0, pages: 1 }); }
  }, [category, kind, query, range.from, range.to, page, pageSize, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const filtered = !!(query || range.from || kind);
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <SearchInput className="w-72" placeholder={searchLabel} value={q} onChange={(e) => setQ(e.target.value)} aria-label={searchLabel} />
        {kinds && <Select value={kind} onChange={(v) => { setKind(v); setPage(1); }} ariaLabel="Kind" options={kinds} />}
        <DateRangePicker from={range.from} to={range.to} onChange={(r) => { setRange(r.from && !r.to ? { from: r.from, to: r.from } : r); setPage(1); }}
          ariaLabel="Dates" placeholder="Any date" maxDate={today()} />
        <Button size="sm" variant="ghost" onClick={() => setTick((t) => t + 1)} aria-label="Refresh"><RefreshCw size={14} /></Button>
        {data && <span className="ml-auto text-xs text-slate-500">{data.total} record{data.total === 1 ? '' : 's'}</span>}
      </div>
      <Banner text={error} tone="error" />
      {!data ? <SkeletonTable rows={6} cols={3} /> : data.items.length ? (
        <>
          <Table>
            <TableHead>
              <TableRow><TableHeader>When</TableHeader><TableHeader>Who</TableHeader><TableHeader>What</TableHeader></TableRow>
            </TableHead>
            <TableBody>
              {data.items.map((e) => {
                const [label, variant] = ACTION_BADGE[e.action] || [e.action, 'default'];
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-slate-600">{formatWhen(e.at)}</TableCell>
                    <TableCell>
                      <div className="font-semibold text-slate-700">{e.actor_name || e.actor_email || 'Unknown'}</div>
                      <div className="text-xs text-slate-400">{[e.actor_email, e.actor_role].filter(Boolean).join(' · ')}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={variant}>{label}</Badge> <span className="text-sm text-slate-700">{e.summary}</span>
                      {e.detail?.rows ? <span className="text-xs text-slate-400"> · {e.detail.rows} rows</span> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {data.pages > 1 && <Pagination page={data.page} pages={data.pages} total={data.total} perPage={data.per_page} onChange={setPage} />}
        </>
      ) : (
        <EmptyState title={filtered ? 'No matches' : 'No records yet'} message={filtered ? 'Nothing recorded matches those filters.' : emptyMessage} />
      )}
    </div>
  );
}
