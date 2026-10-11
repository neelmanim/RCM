import React, { useEffect, useState } from 'react';
import { Inbox as InboxIcon, Clock, CheckCircle2 } from 'lucide-react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonTable } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { CsmPortalService, AdminService } from '../../services/api';
import { tierVariant, formatMoney, formatDate, emptyPortfolioCopy } from './utils';

const PER_PAGE = 15;

/** At-risk queue — same /portfolio endpoint as PortfolioTab, sort=at_risk
 * (worst computed score first), filtered down to non-Healthy accounts.
 * Plus the /digest time-saved KPI, per the mockup. */
export function InboxTab({ isAdmin, onOpenAccount }) {
  const [accounts, setAccounts] = useState(null); // null = loading
  const [totalCount, setTotalCount] = useState(0);
  const [digest, setDigest] = useState(null);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [csmOptions, setCsmOptions] = useState([]);
  const [csmFilter, setCsmFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      CsmPortalService.getPortfolio({ sort: 'at_risk' }),
      CsmPortalService.getDigest(),
    ])
      .then(([portfolioRes, digestRes]) => {
        if (cancelled) return;
        setTotalCount(portfolioRes.count || 0);
        setAccounts((portfolioRes.accounts || []).filter((a) => a.health.displayed_tier !== 'Healthy'));
        setDigest(digestRes);
      })
      .catch(() => { if (!cancelled) { setError('Failed to load the inbox.'); setAccounts([]); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    AdminService.getUsers()
      .then((users) => setCsmOptions((users || []).filter((u) => u.role === 'CSM').map((u) => ({ value: u.id, label: u.name }))))
      .catch(() => setCsmOptions([]));
  }, [isAdmin]);

  useEffect(() => { setPage(1); }, [csmFilter]);

  if (accounts === null) return <SkeletonTable rows={5} cols={4} />;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  if (totalCount === 0) {
    const { title, message } = emptyPortfolioCopy(isAdmin);
    return <EmptyState icon={InboxIcon} title={title} message={message} />;
  }

  const filtered = csmFilter === 'all' ? accounts : accounts.filter((a) => a.assigned_csm_id === csmFilter);

  return (
    <div className="space-y-4">
      {isAdmin && csmOptions.length > 0 && (
        <Select
          ariaLabel="Filter by CSM"
          value={csmFilter}
          onChange={setCsmFilter}
          options={[{ value: 'all', label: 'All CSMs' }, ...csmOptions]}
        />
      )}

      {digest && (
        <div
          className="flex items-center gap-2 flex-wrap bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm"
          data-tour="csm-portal-time-saved"
        >
          <Clock size={16} className="text-emerald-600 shrink-0" />
          <span className="text-slate-700">
            <strong>{digest.estimated_minutes_saved} min</strong> saved this week via playbooks
          </span>
          <span className="text-xs text-slate-400">{digest.estimate_label}</span>
        </div>
      )}

      {!filtered.length ? (
        <EmptyState
          icon={CheckCircle2}
          title={csmFilter === 'all' ? 'Nothing at risk right now' : 'Nothing at risk for this CSM'}
          message={csmFilter === 'all'
            ? 'Every account in scope is Healthy — check back as things change.'
            : 'Every account assigned to this CSM is Healthy, or none are assigned yet.'}
        />
      ) : (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Account</TableHeader>
                <TableHeader>CSM</TableHeader>
                <TableHeader>Owner</TableHeader>
                <TableHeader>Renewal</TableHeader>
                <TableHeader>Health</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((a) => (
                <TableRow key={a.id} onClick={() => onOpenAccount(a.id)}>
                  <TableCell className="font-semibold text-slate-700">{a.name}</TableCell>
                  <TableCell>{a.assigned_csm_name || '—'}</TableCell>
                  <TableCell className="text-slate-500">{a.owner_name || '—'}</TableCell>
                  <TableCell>
                    {a.open_opportunity ? `${formatMoney(a.open_opportunity.amount)} · ${formatDate(a.open_opportunity.close_date)}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={tierVariant(a.health.displayed_tier)}>{a.health.displayed_tier}</Badge>
                    <span className="ml-2 text-xs text-slate-400 tabular-nums">{a.health.score}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={page} pages={Math.max(1, Math.ceil(filtered.length / PER_PAGE))} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
        </>
      )}
    </div>
  );
}
