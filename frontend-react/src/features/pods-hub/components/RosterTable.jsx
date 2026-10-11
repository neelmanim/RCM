import React, { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { SearchInput } from '../../../components/ui/SearchInput';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Pagination } from '../../../components/ui/Pagination';

const COLUMNS = [
  { key: 'name', label: 'Rep' },
  { key: 'podName', label: 'Pod' },
  { key: 'role', label: 'Role' },
  { key: 'activeLeads', label: 'Active leads' },
  { key: 'stale24h', label: 'Untouched > 24h' },
  { key: 'stale72h', label: 'Untouched > 72h' },
];

const PER_PAGE = 20;

const SKELETON_WIDTHS = ['60%', '45%', '70%', '35%', '50%'];

/** Row-shaped skeleton, same convention as LeadsHub's SkeletonRow — shown
 * while the pods+users fetch is in flight instead of a bare "Loading…" line. */
export function RosterSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>{COLUMNS.map((col) => <TableHeader key={col.key}>{col.label}</TableHeader>)}</TableRow>
      </TableHead>
      <TableBody>
        {Array.from({ length: 6 }).map((_, i) => (
          <TableRow key={i}>
            {COLUMNS.map((col, j) => (
              <TableCell key={col.key}>
                <div className="h-3.5 bg-slate-100 rounded animate-pulse" style={{ width: SKELETON_WIDTHS[(i + j) % SKELETON_WIDTHS.length] }} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StaleBadge({ count, level }) {
  if (!count) return <span className="text-slate-400">0</span>;
  return <Badge variant={level === 'high' ? 'danger' : 'warning'}>{count}</Badge>;
}

/**
 * Flat, cross-pod roster: one row per rep with their active-lead count and
 * staleness. Sorted by "most stale first" by default — that's the actual
 * question a Pod Admin asked ("what exactly is my SDR's work going on").
 * Clicking a row hands off to Leads Hub, pre-filtered to that rep, instead
 * of building a second activity-timeline feature.
 *
 * Search + pagination are client-side — the roster is every rep in the org
 * (already fetched in one request), not a server-paginated lead list, so
 * there's no separate endpoint to page against.
 */
export function RosterTable({ roster, onOpenRep }) {
  const [sort, setSort] = useState({ key: 'stale72h', dir: 'desc' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((r) =>
      r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.podName.toLowerCase().includes(q));
  }, [roster, search]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const pageRows = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const toggleSort = (key) => {
    setSort((s) => (key === s.key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
    setPage(1);
  };

  if (!roster.length) {
    return <EmptyState icon={Users} title="No SDRs or AEs assigned to a pod yet." />;
  }

  return (
    <div>
      <div className="mb-3 max-w-xs">
        <SearchInput
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search rep, email, or pod…"
        />
      </div>

      {sorted.length === 0 ? (
        <EmptyState title={`No reps match "${search}".`} />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              {COLUMNS.map((col) => (
                <SortableTableHeader key={col.key} label={col.label} sortKey={col.key} sort={sort} onSort={toggleSort} />
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow key={row.userId} onClick={() => onOpenRep(row)}>
                <TableCell>
                  <div className="font-semibold text-slate-800">{row.name}</div>
                  <div className="text-xs text-slate-400">{row.email}</div>
                </TableCell>
                <TableCell className="text-slate-600">{row.podName}</TableCell>
                <TableCell className="text-slate-600">{row.role}</TableCell>
                <TableCell className="font-semibold text-slate-700">{row.activeLeads}</TableCell>
                <TableCell><StaleBadge count={row.stale24h} level="mid" /></TableCell>
                <TableCell><StaleBadge count={row.stale72h} level="high" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination page={page} pages={totalPages} total={sorted.length} perPage={PER_PAGE} onChange={setPage} />
    </div>
  );
}
