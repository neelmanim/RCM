import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../../components/ui/Table';
import { SortableTableHeader } from '../../components/ui/SortableTableHeader';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonTable } from '../../components/ui/Skeleton';
import { InfoTip } from '../../components/ui/InfoTip';
import { useSort } from '../../utils/useSort';
import { FunnelService } from '../../services/api';
import { useCanExport } from '../../lib/useCanExport';

const PAGE = 8;                                   // same cap as the Team table
const GROUPS = [
  { value: 'none', label: 'All together' }, { value: 'sdr', label: 'By rep' }, { value: 'campaign', label: 'By campaign' },
];
const COLS = [
  ['accounts', 'Accounts'], ['contacts', 'Contacts'], ['conversations', 'Conversations'], ['booked', 'Booked'],
  ['sal', 'SAL'], ['held', 'Held'], ['no_show', 'No-show'], ['won', 'Won'], ['lost', 'Lost'],
];
// Plain-language help for each column of the funnel.
const TIPS = {
  accounts: 'Companies given to the team in this period. Several people at one company count once.',
  contacts: 'People given to the team in this period.',
  conversations: 'Calls where someone actually talked with you.',
  booked: 'Meetings booked in this period, credited to the rep who booked them.',
  sal: 'Booked meetings whose lead is also in Salesforce.',
  held: 'Booked meetings that actually took place.',
  no_show: 'Booked meetings where the person did not turn up.',
  won: 'Booked meetings whose Salesforce deal was won.',
  lost: 'Booked meetings whose Salesforce deal was lost.',
};
const HEADLINE = [
  ['accounts', 'Accounts'], ['conversations', 'Conversations'], ['booked', 'Meetings booked'], ['sal', 'SAL'], ['held', 'Held'],
];

// Date-range funnel: accounts given -> conversations -> meetings booked -> SAL -> held. Definitions: docs/definitions/METRICS_GLOSSARY.md.
// The period is the Digest's own (`range` = { from, to }): one date control for the whole page.
export function FunnelSection({ podId, range }) {
  const [groupBy, setGroupBy] = useState('none');
  const [campaign, setCampaign] = useState('');
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const canExport = useCanExport();
  const [sort, toggleSort] = useSort();

  const from = range?.from;
  const to = range?.to;
  const params = { from, to, pod_id: podId, group_by: groupBy, campaign };
  useEffect(() => {
    if (!from || !to) return undefined;
    let off = false;
    setData(null);
    setPage(1);
    FunnelService.get(params).then((r) => { if (!off) setData(r); });
    return () => { off = true; };
  }, [from, to, podId, groupBy, campaign]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.rows || [];
  const sorted = (() => {
    if (!sort.key) return rows;
    const acc = (r) => (sort.key === 'label' ? (r.label || '').toLowerCase() : r[sort.key] || 0);
    const out = [...rows].sort((a, b) => (acc(a) < acc(b) ? -1 : acc(a) > acc(b) ? 1 : 0));
    return sort.dir === 'desc' ? out.reverse() : out;
  })();
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const shown = sorted.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);
  const total = data?.total;

  const doExport = async () => {
    setExporting(true);
    try { await FunnelService.exportXlsx(params); } finally { setExporting(false); }
  };

  return (
    <Card className="mb-5" data-tour="digest-funnel">
      <CardHeader
        title="Funnel"
        subtitle="Accounts given, conversations, meetings booked, in Salesforce (SAL) and held — for the period above"
        actions={(
          <>
            <Select value={groupBy} onChange={setGroupBy} ariaLabel="Group funnel by" options={GROUPS} />
            <Select
              value={campaign}
              onChange={setCampaign}
              ariaLabel="Funnel campaign"
              searchable
              options={[{ value: '', label: 'All campaigns' }, ...(data?.campaigns || []).map((c) => ({ value: c, label: c }))]}
            />
            {canExport && (
              <Button size="sm" variant="outline" onClick={doExport} disabled={exporting || !data || data.error}>
                <Download size={14} /> {exporting ? 'Exporting…' : 'Export'}
              </Button>
            )}
          </>
        )}
      />
      <CardContent className="p-0">
        {data === null ? (
          <SkeletonTable rows={4} cols={8} />
        ) : data.error ? (
          <EmptyState title="Funnel unavailable" message={data.error} />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4">
              {HEADLINE.map(([k, label]) => (
                <div key={k} className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}{TIPS[k] && <InfoTip text={TIPS[k]} label={`About ${label}`} />}</div>
                  <div className="text-2xl font-bold text-slate-800">{(total?.[k] ?? 0).toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div className="px-4 pb-3 text-xs text-slate-500">
              {total?.contacts_per_account ? `${total.contacts_per_account} contacts per account · ` : ''}
              {total?.booked ? `${total.held_rate}% of bookings held · ${total.no_show_rate}% no-show · ` : ''}
              {total?.conversations ? `${total.booked_per_100_conversations} booked per 100 conversations` : 'No conversations in this range'}
            </div>
            {rows.length ? (
              <>
                <Table>
                  <TableHead>
                    <TableRow>
                      <SortableTableHeader label={{ sdr: 'Rep', campaign: 'Campaign' }[groupBy] || 'Group'} sortKey="label" sort={sort} onSort={toggleSort} />
                      {COLS.map(([k, label]) => <SortableTableHeader key={k} label={label} sortKey={k} sort={sort} onSort={toggleSort}>{TIPS[k] && <InfoTip text={TIPS[k]} label={`About ${label}`} />}</SortableTableHeader>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {shown.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-semibold text-slate-700">
                          {r.label}
                          {r.label === 'No campaign' && <span className="ml-2 align-middle"><Badge variant="warning">Untagged</Badge></span>}
                        </TableCell>
                        {COLS.map(([k]) => <TableCell key={k}>{r[k]}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > PAGE && (
                  <div className="px-4 pb-3">
                    <Pagination page={Math.min(page, pages)} pages={pages} total={rows.length} perPage={PAGE} onChange={setPage} />
                  </div>
                )}
              </>
            ) : (
              <EmptyState title="No activity" message="Nothing was assigned, called or booked in this range." />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
