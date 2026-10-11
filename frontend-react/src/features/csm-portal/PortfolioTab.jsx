import React, { useEffect, useState } from 'react';
import { Users, UserCheck } from 'lucide-react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../components/ui/Table';
import { SortableTableHeader } from '../../components/ui/SortableTableHeader';
import { useSort } from '../../utils/useSort';
import { Badge } from '../../components/ui/Badge';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonTable } from '../../components/ui/Skeleton';
import { SearchInput } from '../../components/ui/SearchInput';
import { Pagination } from '../../components/ui/Pagination';
import { DonutSummaryCard } from '../../components/ui/DonutSummaryCard';
import { CsmPortalService, AdminService } from '../../services/api';
import { tierVariant, formatMoney, formatDate, emptyPortfolioCopy } from './utils';

const PER_PAGE = 15;
const TIER_FILTER_OPTIONS = [
  { value: 'all', label: 'All tiers' },
  { value: 'Critical', label: 'Critical' },
  { value: 'At Risk', label: 'At Risk' },
  { value: 'Healthy', label: 'Healthy' },
];
const TIER_CHART_COLOR = { Critical: '#dc2626', 'At Risk': '#d97706', Healthy: '#16a34a' };

/** Health-tier breakdown, at a glance — same DonutSummaryCard pattern AE
 * Pipeline's own PerformanceDonut uses, so a CSM (or admin) sees where their
 * whole portfolio stands before scanning the table row by row. */
function PortfolioHealthDonut({ accounts }) {
  const counts = { Critical: 0, 'At Risk': 0, Healthy: 0 };
  for (const a of accounts) {
    const tier = a.health?.displayed_tier;
    if (tier in counts) counts[tier] += 1;
  }
  const segments = Object.entries(counts).map(([label, value]) => ({ label, value, color: TIER_CHART_COLOR[label] }));
  return (
    <DonutSummaryCard
      title="Portfolio health"
      subtitle={`${accounts.length} account(s) total`}
      segments={segments}
      size={140}
      strokeWidth={18}
      className="mb-6"
    />
  );
}

/** Full account list — name, ARR/amount, renewal date, health tier badge.
 * Same /portfolio endpoint as InboxTab, no sort param (server default order).
 * Admins additionally get row-select + "Assign to CSM" (plan gap #1's
 * remaining piece: a one-time bulk-assignment action so Portfolio isn't
 * empty on day one for a newly onboarded CSM) — CsmPortalService.bulkAssign
 * already existed backend-side with no UI call site until this.
 *
 * `isAdmin` (true for Super Admin/Admin/Pod Admin, see utils/roles.js) gates
 * the multi-CSM filter dropdown; `canBulkAssign` (Super Admin/Admin only,
 * defaults to `isAdmin` when the caller doesn't pass it) gates row-select
 * and the assign panel — a Pod Admin's read-only pod oversight (2026-09-17)
 * must not show an action the backend will 403 on (bulk_assign_accounts is
 * Super-Admin-only). */
export function PortfolioTab({ isAdmin, canBulkAssign = isAdmin, onOpenAccount }) {
  const [accounts, setAccounts] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [csmOptions, setCsmOptions] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [assignCsmId, setAssignCsmId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState('');
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [csmFilter, setCsmFilter] = useState('all');
  const [sort, toggleSort] = useSort();
  const [page, setPage] = useState(1);

  const load = () => CsmPortalService.getPortfolio()
    .then((res) => setAccounts(res.accounts || []))
    .catch(() => { setError('Failed to load the portfolio.'); setAccounts([]); });

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!isAdmin) return;
    AdminService.getUsers()
      .then((users) => setCsmOptions((users || []).filter((u) => u.role === 'CSM').map((u) => ({ value: u.id, label: u.name }))))
      .catch(() => setCsmOptions([]));
  }, [isAdmin]);

  useEffect(() => { setPage(1); }, [search, tierFilter, csmFilter]);

  if (accounts === null) return <SkeletonTable rows={6} cols={5} />;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  if (!accounts.length) {
    const { title, message } = emptyPortfolioCopy(isAdmin);
    return <EmptyState icon={Users} title={title} message={message} />;
  }

  const q = search.trim().toLowerCase();
  const filtered = accounts.filter((a) => {
    if (tierFilter !== 'all' && a.health?.displayed_tier !== tierFilter) return false;
    if (csmFilter !== 'all' && a.assigned_csm_id !== csmFilter) return false;
    if (q && !a.name?.toLowerCase().includes(q)) return false;
    return true;
  });
  const SORT_ACCESSORS = {
    name: (a) => (a.name || '').toLowerCase(),
    csm: (a) => (a.assigned_csm_name || '').toLowerCase(),
    owner: (a) => (a.owner_name || '').toLowerCase(),
    renewal_amount: (a) => a.open_opportunity?.amount || 0,
    renewal_date: (a) => a.open_opportunity?.close_date || '',
    health: (a) => (a.health?.displayed_tier || '').toLowerCase(),
  };
  const sorted = sort.key ? [...filtered].sort((a, b) => {
    const av = SORT_ACCESSORS[sort.key](a), bv = SORT_ACCESSORS[sort.key](b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sort.dir === 'desc' ? -cmp : cmp;
  }) : filtered;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const pageAccounts = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const toggleSelected = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const submitAssign = async () => {
    if (!assignCsmId || selected.size === 0) return;
    setAssigning(true);
    setAssignMessage('');
    try {
      const res = await CsmPortalService.bulkAssign([...selected], assignCsmId);
      setAssignMessage(`Assigned ${res.updated} account(s).`);
      setSelected(new Set());
      await load();
    } catch (err) {
      setAssignMessage(err.response?.data?.detail || 'Failed to assign these accounts.');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div>
      <PortfolioHealthDonut accounts={accounts} />

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <SearchInput
          placeholder="Search by account…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56"
          aria-label="Search accounts"
        />
        <Select ariaLabel="Filter by health tier" value={tierFilter} onChange={setTierFilter} options={TIER_FILTER_OPTIONS} />
        {isAdmin && csmOptions.length > 0 && (
          <Select
            ariaLabel="Filter by CSM"
            value={csmFilter}
            onChange={setCsmFilter}
            options={[{ value: 'all', label: 'All CSMs' }, ...csmOptions]}
          />
        )}
      </div>

      {canBulkAssign && selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 flex-wrap bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-blue-800">{selected.size} selected</span>
          <Select value={assignCsmId} onChange={setAssignCsmId} options={csmOptions} placeholder="Assign to CSM…" ariaLabel="Assign to CSM" />
          <Button size="sm" onClick={submitAssign} disabled={!assignCsmId || assigning}>
            <UserCheck size={14} /> {assigning ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      )}
      {/* Outside the selection-count bar above — clearing the selection on a
          successful assign must not also hide the confirmation. */}
      {canBulkAssign && assignMessage && <p className="mb-3 text-xs text-blue-700">{assignMessage}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No accounts match these filters" message="Try a different search or clear a filter." />
      ) : (
      <div data-tour="csm-portal-portfolio-table">
      <Table>
        <TableHead>
          <TableRow>
            {canBulkAssign && <TableHeader className="w-8"></TableHeader>}
            <SortableTableHeader label="Account" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortableTableHeader label="CSM" sortKey="csm" sort={sort} onSort={toggleSort} />
            <SortableTableHeader label="Owner" sortKey="owner" sort={sort} onSort={toggleSort} />
            <SortableTableHeader label="Renewal amount" sortKey="renewal_amount" sort={sort} onSort={toggleSort} />
            <SortableTableHeader label="Renewal date" sortKey="renewal_date" sort={sort} onSort={toggleSort} />
            <SortableTableHeader label="Health" sortKey="health" sort={sort} onSort={toggleSort} />
          </TableRow>
        </TableHead>
        <TableBody>
          {pageAccounts.map((a) => (
            <TableRow key={a.id} onClick={() => onOpenAccount(a.id)}>
              {canBulkAssign && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(a.id)} onChange={() => toggleSelected(a.id)} aria-label={`Select ${a.name}`} />
                </TableCell>
              )}
              <TableCell className="font-semibold text-slate-700">{a.name}</TableCell>
              <TableCell>{a.assigned_csm_name || '—'}</TableCell>
              <TableCell className="text-slate-500">{a.owner_name || '—'}</TableCell>
              <TableCell>{a.open_opportunity ? formatMoney(a.open_opportunity.amount) : '—'}</TableCell>
              <TableCell>{a.open_opportunity ? formatDate(a.open_opportunity.close_date) : '—'}</TableCell>
              <TableCell>
                <Badge variant={tierVariant(a.health.displayed_tier)}>{a.health.displayed_tier}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination page={page} pages={totalPages} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
      </div>
      )}
    </div>
  );
}
