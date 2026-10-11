import React, { useState, useEffect, useCallback } from 'react';
import { FileText, ScrollText } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { useSort } from '../../../utils/useSort';
import { Badge } from '../../../components/ui/Badge';
import { Select } from '../../../components/ui/Select';
import { SearchInput } from '../../../components/ui/SearchInput';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Pagination } from '../../../components/ui/Pagination';
import { AnalyticsService } from '../../../services/api';
import { fmtDateTime, STATUS_BADGE_VARIANT } from './reportHelpers';

const STATUSES = ['processing', 'sent', 'failed', 'skipped'];
const PER_PAGE = 25;

const cardTitle = (
  <span className="flex items-center gap-1.5">
    <ScrollText size={15} className="text-slate-400" /> Report Logs
  </span>
);

export const ReportLogs = () => {
  const [reports, setReports] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [pageInfo, setPageInfo] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reportFilter, setReportFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, toggleSort] = useSort({ key: 'started_at', dir: 'desc' });

  useEffect(() => {
    AnalyticsService.listReports().then(setReports);
  }, []);

  // Any filter change re-starts from page 1 — a stale page number past the
  // end of a narrower result set would otherwise render an empty table with
  // no obvious explanation.
  useEffect(() => { setPage(1); }, [reportFilter, statusFilter, search, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await AnalyticsService.listReportExecutions({
      report_id: reportFilter || undefined,
      status: statusFilter || undefined,
      search: search || undefined,
      sort_by: sort.key ? `${sort.dir === 'desc' ? '-' : ''}${sort.key}` : undefined,
      page,
      per_page: PER_PAGE,
    });
    setExecutions(res.items || []);
    setPageInfo({ page: res.page || 1, pages: res.pages || 1, total: res.total || 0 });
    setLoading(false);
  }, [reportFilter, statusFilter, search, sort, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card className="animate-fade-in">
      <CardHeader title={cardTitle} />
      <CardContent className="space-y-4">
        <div className="flex items-center flex-wrap gap-2">
          <Select
            value={reportFilter}
            onChange={(v) => setReportFilter(v)}
            options={reports.map((r) => ({ value: r.id, label: r.name }))}
            placeholder="All Reports"
            searchable
          />
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            options={STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
            placeholder="All Statuses"
          />
          <SearchInput
            placeholder="Search logs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] max-w-xs"
          />
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 py-8 text-center">Loading logs…</p>
        ) : executions.length === 0 ? (
          <EmptyState icon={FileText} message="No report executions match these filters." />
        ) : (
          <>
            <Table>
              <TableHead>
                <TableRow>
                  <SortableTableHeader label="Report" sortKey="report_name" sort={sort} onSort={toggleSort} />
                  <TableHeader>Reporting Period</TableHeader>
                  <SortableTableHeader label="Started" sortKey="started_at" sort={sort} onSort={toggleSort} />
                  <TableHeader>Triggered By</TableHeader>
                  <TableHeader>Recipients</TableHeader>
                  <SortableTableHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                </TableRow>
              </TableHead>
              <TableBody>
                {executions.map((e) => {
                  const recipientCount = e.recipients
                    ? (e.recipients.to?.length || 0) + (e.recipients.cc?.length || 0) + (e.recipients.bcc?.length || 0)
                    : 0;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-semibold text-slate-800">{e.report_name || '(deleted report)'}</TableCell>
                      <TableCell>
                        {e.reporting_period_start && e.reporting_period_end
                          ? `${fmtDateTime(e.reporting_period_start)} – ${fmtDateTime(e.reporting_period_end)}`
                          : '—'}
                      </TableCell>
                      <TableCell>{fmtDateTime(e.started_at)}</TableCell>
                      <TableCell className="capitalize">{e.triggered_by}</TableCell>
                      <TableCell>{recipientCount}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant={STATUS_BADGE_VARIANT[e.status]}>{e.status}</Badge>
                          {e.failure_reason && <span className="text-xs text-slate-400" title={e.failure_reason}>{e.failure_reason.slice(0, 40)}{e.failure_reason.length > 40 ? '…' : ''}</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination page={pageInfo.page} pages={pageInfo.pages} total={pageInfo.total} perPage={PER_PAGE} onChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
};
