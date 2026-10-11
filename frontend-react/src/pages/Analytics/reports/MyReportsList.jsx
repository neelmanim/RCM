import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Play, Pencil, Copy, Trash2, Mail } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { useSort } from '../../../utils/useSort';
import { IconButton } from '../../../components/ui/IconButton';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { EmptyState } from '../../../components/ui/EmptyState';
import { AnalyticsService } from '../../../services/api';
import { fmtSchedule, fmtDate, STATUS_BADGE_VARIANT } from './reportHelpers';

const SORT_ACCESSORS = {
  name: (r) => (r.name || '').toLowerCase(),
  recipients: (r) => r.recipient_count || 0,
  next_run: (r) => r.next_run_at || '',
  last_run: (r) => r.last_run_at || '',
  status: (r) => (r.enabled ? 1 : 0),
};

export const MyReportsList = ({ onCreateNew, onEdit, onLogsChanged }) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState('');
  const [sort, toggleSort] = useSort();

  const sortedReports = useMemo(() => {
    if (!sort.key) return reports;
    const accessor = SORT_ACCESSORS[sort.key];
    const sorted = [...reports].sort((a, b) => {
      const av = accessor(a), bv = accessor(b);
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return sort.dir === 'desc' ? sorted.reverse() : sorted;
  }, [reports, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    setReports(await AnalyticsService.listReports());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleToggle = async (report) => {
    await AnalyticsService.toggleReport(report.id, !report.enabled);
    load();
  };

  const handleRunNow = async (report) => {
    setRunningId(report.id);
    try {
      const execution = await AnalyticsService.runReportNow(report.id);
      showToast(
        execution.status === 'sent' ? `"${report.name}" sent.`
        : execution.status === 'skipped' ? `"${report.name}" skipped — ${execution.failure_reason}`
        : `"${report.name}" failed — ${execution.failure_reason || 'see Report Logs'}`
      );
      load();
      onLogsChanged?.();
    } catch (err) {
      showToast(`Failed to run "${report.name}".`);
    } finally {
      setRunningId(null);
    }
  };

  const handleDuplicate = async (report) => {
    await AnalyticsService.duplicateReport(report.id);
    load();
  };

  const handleDelete = async () => {
    await AnalyticsService.deleteReport(deleteTarget.id);
    setDeleteTarget(null);
    load();
    onLogsChanged?.();
  };

  return (
    <Card className="animate-fade-in">
      <CardHeader
        title="My Reports"
        subtitle={reports.length === 0 ? 'No reports yet.' : `${reports.length} report${reports.length === 1 ? '' : 's'} configured.`}
        actions={<Button onClick={onCreateNew}><Plus size={15} className="mr-1" /> New Report</Button>}
      />
      <CardContent className="space-y-4">
      {toast && (
        <div className="px-4 py-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm font-medium">
          {toast}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 py-8 text-center">Loading reports…</p>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={Mail}
          message="Create a report to send scheduled Analytics summaries to stakeholders."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <SortableTableHeader label="Report Name" sortKey="name" sort={sort} onSort={toggleSort} />
              <TableHeader>Components</TableHeader>
              <TableHeader>Schedule</TableHeader>
              <SortableTableHeader label="Recipients" sortKey="recipients" sort={sort} onSort={toggleSort} />
              <SortableTableHeader label="Next Run" sortKey="next_run" sort={sort} onSort={toggleSort} />
              <SortableTableHeader label="Last Run" sortKey="last_run" sort={sort} onSort={toggleSort} />
              <SortableTableHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
              <TableHeader>Actions</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedReports.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold text-slate-800">{r.name}</TableCell>
                <TableCell>{r.components.length} component{r.components.length === 1 ? '' : 's'}</TableCell>
                <TableCell>{fmtSchedule(r)}</TableCell>
                <TableCell>{r.recipient_count} recipient{r.recipient_count === 1 ? '' : 's'}</TableCell>
                <TableCell>{r.enabled ? fmtDate(r.next_run_at) : '—'}</TableCell>
                <TableCell>
                  {r.last_run_at ? (
                    <span className="inline-flex items-center gap-1.5">
                      {fmtDate(r.last_run_at)}
                      {r.last_status && <Badge variant={STATUS_BADGE_VARIANT[r.last_status]}>{r.last_status}</Badge>}
                    </span>
                  ) : '—'}
                </TableCell>
                <TableCell>
                  {/* Kept as a real <button> (not Badge, which only renders a
                      <span>) — this is a clickable toggle, and swapping it
                      for a non-interactive element would drop native
                      keyboard/focus semantics. */}
                  <button
                    onClick={() => handleToggle(r)}
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                    title="Click to toggle"
                  >
                    {r.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <IconButton onClick={() => handleRunNow(r)} disabled={runningId === r.id} title="Run Now">
                      <Play size={14} />
                    </IconButton>
                    <IconButton onClick={() => onEdit(r)} title="Edit">
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton onClick={() => handleDuplicate(r)} title="Duplicate">
                      <Copy size={14} />
                    </IconButton>
                    <IconButton onClick={() => setDeleteTarget(r)} variant="danger" title="Delete">
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      </CardContent>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Report"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? Its past execution history in Report Logs will also be removed.` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDelete}
      />
    </Card>
  );
};
