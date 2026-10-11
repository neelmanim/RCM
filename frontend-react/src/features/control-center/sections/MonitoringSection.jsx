import React, { useCallback, useEffect, useState } from 'react';
import {
  FileClock, Cloud, Search, LogIn, MessageSquare, AlertTriangle, Phone, Zap,
  CheckCircle2, AlertCircle, XCircle, RefreshCw, Bug, Lightbulb, Download, Bot,
} from 'lucide-react';
import { AdminService } from '../../../services/api';
import { Tabs } from '../../../components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Pagination } from '../../../components/ui/Pagination';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonTable, SkeletonStatCard } from '../../../components/ui/Skeleton';
import { SearchInput } from '../../../components/ui/SearchInput';
import { DateRangePicker } from '../../../components/ui/DateRangePicker';
import { Select } from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Modal } from '../../../components/ui/Modal';
import { Spinner } from '../../../components/ui/Spinner';
// Reused, not duplicated — activity-monitor already has the relative-time
// and duration helpers these tabs need, plus the stat-tile strip.
import { timeAgo } from '../../activity-monitor/lib/format';
import { StatStrip } from '../../activity-monitor/components/StatStrip';
import { cleanParams } from '../../activity-monitor/lib/queryParams';
import { useCanExport } from '../../../lib/useCanExport';

const PER_PAGE = 20;

const ALL_MONITORING_TABS = [
  { key: 'audit', label: 'Audit Log', icon: FileClock },
  { key: 'logins', label: 'Login History', icon: LogIn },
  { key: 'feedback', label: 'Feedback', icon: MessageSquare },
  { key: 'sf', label: 'Salesforce Sync Log', icon: Cloud },
  { key: 'error-logs', label: 'Error Logs', icon: AlertTriangle },
  { key: 'perf-health', label: 'Perf Health', icon: Zap, superAdminOnly: true },
  { key: 'claude', label: 'Claude Logs', icon: Bot, superAdminOnly: true },
];

// Phase 5 (+ 2026-09-03 follow-up): read-only parity with every tab of
// frontend/js/views/audit_logs.js (Activity, Login History, Feedback, SF
// Logs, Error Logs, Perf Health). Feedback's per-row status update is the
// one write action here — matches the legacy page exactly.
//
// 2026-09-04: Call Logs tab removed per audit — Activity Monitor already
// covers call history (its own dedicated Calls tab), so this was a
// redundant second view of the same data.
export function MonitoringSection({ userRole }) {
  const isSuperAdmin = (userRole || '').toLowerCase() === 'super admin';
  const tabs = ALL_MONITORING_TABS.filter((t) => !t.superAdminOnly || isSuperAdmin);
  const [active, setActive] = useState(tabs[0].key);

  return (
    <div>
      <Tabs tabs={tabs} active={active} onChange={setActive} className="mb-4" />
      {active === 'audit' && <AuditLogTab />}
      {active === 'logins' && <LoginHistoryTab />}
      {active === 'feedback' && <FeedbackTab />}
      {active === 'sf' && <SfSyncLogTab />}
      {active === 'error-logs' && <ErrorLogsTab />}
      {active === 'perf-health' && isSuperAdmin && <PerfHealthTab />}
      {active === 'claude' && isSuperAdmin && <ClaudeLogsTab />}
    </div>
  );
}

const OPERATION_VARIANT = { create: 'info', update: 'warning', upsert: 'purple', fetch: 'teal', query: 'default' };

// ── Audit Log tab — ports audit_logs.js loadActivity() (lines 409-448) ───────
function AuditLogTab() {
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Debounced search, same 400ms as the legacy page (audit_logs.js:274-278).
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchDraft); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    AdminService.getAuditLogs({ page, per_page: PER_PAGE, search, date_from: range.from, date_to: range.to })
      .then((res) => { if (!cancelled) { setResult(res); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, search, range.from, range.to]);

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search lead or changed by…"
          className="flex-1 min-w-[220px]"
        />
        <DateRangePicker from={range.from} to={range.to} onChange={(next) => { setRange(next); setPage(1); }} />
      </div>

      {loading && !result ? (
        <SkeletonTable cols={6} />
      ) : error ? (
        <EmptyState icon={FileClock} title="Failed to load" message={error} />
      ) : !result.data.length ? (
        <EmptyState icon={Search} title="No activity found" />
      ) : (
        <>
          <Table>
            <TableHead>
              <tr>
                <TableHeader>Lead</TableHeader>
                <TableHeader>Company</TableHeader>
                <TableHeader>From</TableHeader>
                <TableHeader>To</TableHeader>
                <TableHeader>Changed By</TableHeader>
                <TableHeader>When</TableHeader>
              </tr>
            </TableHead>
            <TableBody>
              {result.data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-semibold text-slate-800">{a.lead_name || '—'}</TableCell>
                  <TableCell>{a.company || '—'}</TableCell>
                  <TableCell>{a.from_status ? <Badge>{a.from_status}</Badge> : '—'}</TableCell>
                  <TableCell>{a.to_status ? <Badge>{a.to_status}</Badge> : '—'}</TableCell>
                  <TableCell>{a.changed_by || '—'}</TableCell>
                  <TableCell title={a.changed_at || ''} className="text-slate-400">{timeAgo(a.changed_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={result.page} pages={result.pages} total={result.total} perPage={PER_PAGE} onChange={setPage} />
        </>
      )}
    </div>
  );
}

// ── Login History tab — ports audit_logs.js loadLogins() (lines 451-491) ────
function LoginHistoryTab() {
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchDraft); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    AdminService.getLoginLogs({ page, per_page: PER_PAGE, search })
      .then((res) => { if (!cancelled) { setResult(res); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, search]);

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <SearchInput
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search name or email…"
          className="max-w-sm"
        />
      </div>

      {loading && !result ? (
        <SkeletonTable cols={7} />
      ) : error ? (
        <EmptyState icon={LogIn} title="Failed to load" message={error} />
      ) : !result.data.length ? (
        <EmptyState icon={Search} title="No login history found" />
      ) : (
        <>
          <Table>
            <TableHead>
              <tr>
                <TableHeader>User</TableHeader>
                <TableHeader>Email</TableHeader>
                <TableHeader>Role</TableHeader>
                <TableHeader>Login Time</TableHeader>
                <TableHeader>Logout Time</TableHeader>
                <TableHeader>Duration</TableHeader>
                <TableHeader>IP Address</TableHeader>
              </tr>
            </TableHead>
            <TableBody>
              {result.data.map((l, i) => (
                <TableRow key={l.id ?? i}>
                  <TableCell className="font-semibold text-slate-800">{l.name || '—'}</TableCell>
                  <TableCell>{l.email || '—'}</TableCell>
                  <TableCell><Badge>{l.role || '—'}</Badge></TableCell>
                  <TableCell title={l.login_at || ''}>{timeAgo(l.login_at)}</TableCell>
                  <TableCell title={l.logout_at || ''}>
                    {l.logout_at ? timeAgo(l.logout_at) : <span className="text-green-600 font-semibold">Active</span>}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {l.duration || (l.logout_at ? '—' : (
                      <span className="inline-flex items-center gap-1.5 text-green-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> ongoing
                      </span>
                    ))}
                  </TableCell>
                  <TableCell className="text-slate-400">{l.ip_address || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={result.page} pages={result.pages} total={result.total} perPage={PER_PAGE} onChange={setPage} />
        </>
      )}
    </div>
  );
}

const CLAUDE_ACTIONS = {
  CLAUDE_CONNECTOR_READ: { label: 'Looked up', variant: 'default' },
  CLAUDE_CONNECTOR_WRITE: { label: 'Change', variant: 'indigo' },
  CLAUDE_CONNECTOR_AUTHORIZED: { label: 'Connected', variant: 'info' },
  PERSONAL_API_KEY_CREATED: { label: 'Key created', variant: 'teal' },
  PERSONAL_API_KEY_REVOKED: { label: 'Key revoked', variant: 'warning' },
};

function claudeDetail(r) {
  if (r.tool) {
    const args = Object.entries(r.arguments || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
    return args ? `${r.tool} (${args})` : r.tool;
  }
  return r.key_name || r.client || '—';
}

// ── Claude Logs tab — every Claude connector call, connection and key event ──
function ClaudeLogsTab() {
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchDraft); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    AdminService.getClaudeLogs({ page, per_page: PER_PAGE, search })
      .then((res) => { if (!cancelled) { setResult(res); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.detail || err.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, search]);

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <SearchInput
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search person, email or tool…"
          className="max-w-sm"
        />
      </div>

      {loading && !result ? (
        <SkeletonTable cols={5} />
      ) : error ? (
        <EmptyState icon={Bot} title="Failed to load" message={error} />
      ) : !result.data.length ? (
        <EmptyState icon={Bot} title="No Claude activity yet" message="Lookups and changes made through the Claude connector show up here." />
      ) : (
        <>
          <Table>
            <TableHead>
              <tr>
                <TableHeader>Person</TableHeader>
                <TableHeader>Action</TableHeader>
                <TableHeader>Details</TableHeader>
                <TableHeader>Result</TableHeader>
                <TableHeader>When</TableHeader>
              </tr>
            </TableHead>
            <TableBody>
              {result.data.map((r) => {
                const action = CLAUDE_ACTIONS[r.action] || { label: r.action, variant: 'default' };
                const detail = claudeDetail(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold text-slate-800" title={r.email || ''}>{r.user || '—'}</TableCell>
                    <TableCell><Badge variant={action.variant}>{action.label}</Badge></TableCell>
                    <TableCell className="max-w-md truncate text-slate-600" title={detail}>{detail}</TableCell>
                    <TableCell>{r.ok ? <Badge variant="success">Done</Badge> : <Badge variant="warning">Refused</Badge>}</TableCell>
                    <TableCell title={r.at || ''} className="text-slate-400">{timeAgo(r.at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination page={result.page} pages={result.pages} total={result.total} perPage={PER_PAGE} onChange={setPage} />
        </>
      )}
    </div>
  );
}

const FEEDBACK_TYPE_ICON = { bug: Bug, feature: Lightbulb, general: MessageSquare };
const FEEDBACK_STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'resolved', label: 'Resolved' },
];
const FEEDBACK_STATUS_VARIANT = { new: 'info', reviewed: 'warning', resolved: 'success' };
const FEEDBACK_FILTER_OPTIONS = [{ value: '', label: 'All statuses' }, ...FEEDBACK_STATUS_OPTIONS];

// ── Feedback tab — ports audit_logs.js loadFeedback() (lines 494-534) ───────
function FeedbackTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    let cancelled = false;
    setLoading(true);
    AdminService.getFeedback({ page, per_page: PER_PAGE, status })
      .then((res) => { if (!cancelled) { setResult(res); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  };
  useEffect(load, [page, status]);

  const updateStatus = (id, newStatus) => {
    setResult((r) => ({ ...r, data: r.data.map((f) => (f.id === id ? { ...f, status: newStatus } : f)) }));
    AdminService.patchFeedbackStatus(id, newStatus).catch(() => load());
  };

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={FEEDBACK_FILTER_OPTIONS} placeholder="All statuses" />
      </div>

      {loading && !result ? (
        <SkeletonTable cols={5} />
      ) : error ? (
        <EmptyState icon={MessageSquare} title="Failed to load" message={error} />
      ) : !result.data.length ? (
        <EmptyState icon={MessageSquare} title="No feedback submitted yet" />
      ) : (
        <>
          <Table>
            <TableHead>
              <tr>
                <TableHeader>Type</TableHeader>
                <TableHeader>User</TableHeader>
                <TableHeader>Message</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Submitted</TableHeader>
              </tr>
            </TableHead>
            <TableBody>
              {result.data.map((f) => {
                const TypeIcon = FEEDBACK_TYPE_ICON[f.type] || MessageSquare;
                return (
                <TableRow key={f.id}>
                  <TableCell className="whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><TypeIcon size={13} className="text-slate-400" /> {f.type}</span></TableCell>
                  <TableCell className="font-semibold text-slate-800">{f.user_name || f.user_email || '—'}</TableCell>
                  <TableCell className="max-w-[300px] truncate" title={f.message || ''}>{f.message || '—'}</TableCell>
                  <TableCell>
                    <Select
                      value={f.status}
                      onChange={(v) => updateStatus(f.id, v)}
                      options={FEEDBACK_STATUS_OPTIONS}
                      ariaLabel={`Feedback status for ${f.id}`}
                    >
                      <Badge variant={FEEDBACK_STATUS_VARIANT[f.status] || 'default'} className="cursor-pointer">{f.status}</Badge>
                    </Select>
                  </TableCell>
                  <TableCell title={f.created_at || ''} className="text-slate-400">{timeAgo(f.created_at)}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination page={result.page} pages={result.pages} total={result.total} perPage={PER_PAGE} onChange={setPage} />
        </>
      )}
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
];
const OPERATION_OPTIONS = [
  { value: '', label: 'All operations' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'upsert', label: 'Upsert' },
  { value: 'fetch', label: 'Fetch' },
  { value: 'query', label: 'Query' },
];
const OBJECT_OPTIONS = [
  { value: '', label: 'All objects' },
  { value: 'Lead', label: 'Lead' },
  { value: 'Account', label: 'Account' },
  { value: 'Opportunity', label: 'Opportunity' },
  { value: 'User', label: 'User' },
  { value: 'RecordType', label: 'RecordType' },
];
const DIRECTION_OPTIONS = [
  { value: '', label: 'All directions' },
  { value: 'outbound', label: 'Pushed to Salesforce' },
  { value: 'inbound', label: 'Pulled from Salesforce' },
];
const DIRECTION_LABEL = { outbound: 'Pushed to SF', inbound: 'Pulled from SF' };
const DIRECTION_VARIANT = { outbound: 'warning', inbound: 'teal' };

const EMPTY_SF_FILTERS = { status: '', operation_type: '', sf_object: '', direction: '', search: '', date_from: '', date_to: '' };

// ── SF Sync Log tab — ports sf_logs.js (_loadLogs/_renderLogRow/_showLogDetail) ──
function SfSyncLogTab() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_SF_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLogId, setDetailLogId] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canExport = useCanExport();

  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => ({ ...f, search: searchDraft })); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    AdminService.getSfLogs({ page, per_page: PER_PAGE, ...filters })
      .then((res) => { if (!cancelled) { setData(res); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, filters]);

  useEffect(load, [load]);

  // Auto-refresh (30s) — sf_logs.js:143-151. Reruns the same load(), no second fetch path.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const setFilter = (key) => (val) => { setFilters((f) => ({ ...f, [key]: val })); setPage(1); };
  const logs = data?.logs || [];

  // Summary stats row — sf_logs.js:170-193. Same caveat as Error Logs above:
  // computed from the current page of logs only, not the full filtered set.
  const successCount = logs.filter((l) => l.status === 'success').length;
  const failedCount = logs.filter((l) => l.status === 'failed').length;
  const statTiles = [
    { label: 'Total Logs', value: data?.total ?? 0, icon: Cloud, iconClass: 'bg-slate-100 text-slate-500' },
    { label: 'This Page', value: logs.length, icon: FileClock, iconClass: 'bg-slate-100 text-slate-500' },
    { label: 'Success', value: successCount, icon: CheckCircle2, iconClass: 'bg-green-50 text-green-500', valueClass: successCount ? 'text-green-600' : undefined },
    { label: 'Failed', value: failedCount, icon: XCircle, iconClass: failedCount ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-400', valueClass: failedCount ? 'text-red-500' : undefined },
  ];

  const exportCsv = async () => {
    setExporting(true);
    try {
      await AdminService.exportSfLogsCsv(filters);
    } catch {
      // ponytail: silent — same failure mode as legacy's console.error-only handler
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-2">
        <Select value={filters.status} onChange={setFilter('status')} options={STATUS_OPTIONS} placeholder="All statuses" />
        <Select value={filters.operation_type} onChange={setFilter('operation_type')} options={OPERATION_OPTIONS} placeholder="All operations" />
        <Select value={filters.sf_object} onChange={setFilter('sf_object')} options={OBJECT_OPTIONS} placeholder="All objects" />
        <Select value={filters.direction} onChange={setFilter('direction')} options={DIRECTION_OPTIONS} placeholder="All directions" />
        <DateRangePicker
          from={filters.date_from} to={filters.date_to}
          onChange={({ from, to }) => { setFilters((f) => ({ ...f, date_from: from, date_to: to })); setPage(1); }}
        />
        <SearchInput
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Record ID / Name / Email…"
          className="flex-1 min-w-[200px]"
        />
        <Checkbox
          checked={autoRefresh}
          onChange={(e) => setAutoRefresh(e.target.checked)}
          className="whitespace-nowrap"
          label={<span className="text-xs text-slate-500">Auto-refresh (30s)</span>}
        />
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
            <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        )}
      </div>

      {data && <StatStrip tiles={statTiles} />}

      {loading && !data ? (
        <SkeletonTable cols={9} />
      ) : error ? (
        <EmptyState icon={Cloud} title="Failed to load" message={error} />
      ) : !logs.length ? (
        <EmptyState icon={Search} title="No integration logs found" message="Sync some leads to see activity here." />
      ) : (
        <>
          <Table>
            <TableHead>
              <tr>
                <TableHeader>Timestamp</TableHeader>
                <TableHeader>Direction</TableHeader>
                <TableHeader>Operation</TableHeader>
                <TableHeader>Object</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Name</TableHeader>
                <TableHeader>Email</TableHeader>
                <TableHeader>Record ID</TableHeader>
                <TableHeader />
              </tr>
            </TableHead>
            <TableBody>
              {logs.map((log) => {
                const name = [log.first_name, log.last_name].filter(Boolean).join(' ') || '—';
                return (
                  <TableRow key={log.id} onClick={() => setDetailLogId(log.id)}>
                    <TableCell title={log.timestamp || ''} className="text-slate-400">{timeAgo(log.timestamp)}</TableCell>
                    <TableCell><Badge variant={DIRECTION_VARIANT[log.direction] || 'default'}>{DIRECTION_LABEL[log.direction] || log.direction || '—'}</Badge></TableCell>
                    <TableCell><Badge variant={OPERATION_VARIANT[log.operation_type] || 'default'}>{log.operation_type}</Badge></TableCell>
                    <TableCell className="text-slate-500">{log.sf_object || '—'}</TableCell>
                    <TableCell><Badge variant={log.status === 'success' ? 'success' : 'danger'}>{log.status}</Badge></TableCell>
                    <TableCell className="font-semibold text-slate-800">{name}</TableCell>
                    <TableCell className="text-slate-400">{log.email || '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-400" title={log.record_identifier || ''}>{log.record_identifier || '—'}</TableCell>
                    <TableCell className="text-blue-600 font-semibold">View</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination page={data.page} pages={data.total_pages} total={data.total} perPage={data.per_page} onChange={setPage} />
        </>
      )}

      <SfLogDetailModal logId={detailLogId} onClose={() => setDetailLogId(null)} />
    </div>
  );
}

// Ports the legacy _showLogDetail() modal body onto the shared Modal shell
// instead of the hand-rolled overlay+panel DOM the old page built itself.
// Source was views/sf_logs.js:264-371 / audit_sf_logs.js:27-113 — sf_logs.js
// has since been deleted as unreachable (v12.2.4), so this is now the only
// implementation.
function SfLogDetailModal({ logId, onClose }) {
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!logId) { setLog(null); return; }
    let cancelled = false;
    setLoading(true);
    AdminService.getSfLogDetail(logId)
      .then((res) => { if (!cancelled) setLog(res); })
      .catch(() => { if (!cancelled) setLog(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [logId]);

  const fields = (() => {
    if (!log?.fields_updated) return [];
    if (Array.isArray(log.fields_updated)) return log.fields_updated;
    try { return JSON.parse(log.fields_updated); } catch { return [log.fields_updated]; }
  })();

  return (
    <Modal open={!!logId} onClose={onClose} title="Log Details" maxWidth="max-w-xl">
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : !log ? (
        <p className="text-sm text-slate-400 text-center py-8">Log not found.</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <DetailField label="Status"><Badge variant={log.status === 'success' ? 'success' : 'danger'}>{log.status}</Badge></DetailField>
            <DetailField label="Timestamp">{log.timestamp || '—'}</DetailField>
            <DetailField label="Direction">
              <Badge variant={DIRECTION_VARIANT[log.direction] || 'default'}>{DIRECTION_LABEL[log.direction] || log.direction || '—'}</Badge>
            </DetailField>
            <DetailField label="Operation">{log.operation_type}</DetailField>
            <DetailField label="Object">{log.sf_object}</DetailField>
            <DetailField label="Source">{log.source_system || '—'}</DetailField>
            <DetailField label="Record ID"><span className="font-mono text-xs break-all">{log.record_identifier || '—'}</span></DetailField>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-400 mb-1">Lead Info</div>
            <div>{[log.first_name, log.last_name].filter(Boolean).join(' ') || '—'}{log.email ? ` · ${log.email}` : ''}</div>
          </div>
          {fields.length > 0 && (
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-400 mb-2">Fields Updated</div>
              <div className="flex flex-wrap gap-1.5">{fields.map((f) => <Badge key={f} variant="info">{f}</Badge>)}</div>
            </div>
          )}
          {log.error_message && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3">
              <div className="text-xs font-semibold text-red-500 mb-1">Error Message</div>
              <pre className="text-xs text-red-600 whitespace-pre-wrap break-all m-0">{log.error_message}</pre>
            </div>
          )}
          {log.request_payload && (
            <div>
              <div className="text-xs font-semibold text-slate-400 mb-1">Request Payload</div>
              <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs overflow-x-auto max-h-40 whitespace-pre-wrap break-all">{JSON.stringify(log.request_payload, null, 2)}</pre>
            </div>
          )}
          {log.response_payload && (
            <div>
              <div className="text-xs font-semibold text-slate-400 mb-1">Response Payload</div>
              <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs overflow-x-auto max-h-40 whitespace-pre-wrap break-all">{JSON.stringify(log.response_payload, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function DetailField({ label, children }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2.5">
      <div className="text-[0.68rem] font-semibold uppercase text-slate-400">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

const SEVERITY_OPTIONS = [
  { value: '', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];
const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'api', label: 'API' },
  { value: 'auth', label: 'Auth' },
  { value: 'research', label: 'AI Research' },
  { value: 'dialer', label: 'Dialer' },
  { value: 'salesforce', label: 'Salesforce' },
  { value: 'upload', label: 'Upload' },
  { value: 'general', label: 'General' },
];
const RESOLVED_OPTIONS = [
  { value: 'false', label: 'Unresolved' },
  { value: '', label: 'All' },
  { value: 'true', label: 'Resolved' },
];
const SEVERITY_VARIANT = { critical: 'danger', warning: 'warning', info: 'info' };
const EMPTY_EL_FILTERS = { severity: '', category: '', resolved: 'false' };

// ── Error Logs tab — ports audit_logs.js loadErrorLogs() (lines 612-732) ────
// Note (parity, not a fix): the backend's list response carries no aggregate
// `summary` — same as the legacy page, the 3 stat tiles below are computed
// from the current page of items only, not the full filtered set.
function ErrorLogsTab() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_EL_FILTERS);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    AdminService.getErrorLogs(cleanParams({ page, per_page: PER_PAGE, ...filters }))
      .then((res) => { if (!cancelled) { setData(res); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, filters]);

  const setFilter = (key) => (val) => { setFilters((f) => ({ ...f, [key]: val })); setPage(1); };
  const logs = data?.items || [];
  const critical = logs.filter((l) => l.severity === 'critical').length;
  const warning = logs.filter((l) => l.severity === 'warning').length;
  const unresolved = logs.filter((l) => !l.resolved).length;

  const tiles = [
    { label: 'Total Errors', value: data?.total ?? 0, icon: AlertTriangle, iconClass: 'bg-slate-100 text-slate-500' },
    { label: 'Critical', value: critical, icon: XCircle, iconClass: 'bg-red-50 text-red-500', valueClass: critical ? 'text-red-500' : undefined },
    { label: 'Warnings', value: warning, icon: AlertCircle, iconClass: 'bg-amber-50 text-amber-500', valueClass: warning ? 'text-amber-500' : undefined },
    { label: 'Unresolved', value: unresolved, icon: AlertTriangle, iconClass: unresolved ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500', valueClass: unresolved ? 'text-red-500' : 'text-green-600' },
  ];

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-2">
        <Select value={filters.severity} onChange={setFilter('severity')} options={SEVERITY_OPTIONS} placeholder="All severities" />
        <Select value={filters.category} onChange={setFilter('category')} options={CATEGORY_OPTIONS} placeholder="All categories" />
        <Select value={filters.resolved} onChange={setFilter('resolved')} options={RESOLVED_OPTIONS} placeholder="Unresolved" />
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-4 gap-4 mb-5">{Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}</div>
      ) : (
        <StatStrip tiles={tiles} />
      )}

      {loading && !data ? (
        <SkeletonTable cols={1} rows={4} />
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Failed to load" message={error} />
      ) : !logs.length ? (
        <EmptyState icon={CheckCircle2} title="All Clear" message="No errors match the current filters. The system is operating normally." />
      ) : (
        <>
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`rounded-xl border p-4 ${log.resolved ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200 border-l-4'}`}
                style={log.resolved ? {} : { borderLeftColor: log.severity === 'critical' ? '#ef4444' : log.severity === 'info' ? '#3b82f6' : '#f59e0b' }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <Badge variant={SEVERITY_VARIANT[log.severity] || 'warning'}>{log.severity}</Badge>
                      <Badge>{CATEGORY_OPTIONS.find((c) => c.value === log.category)?.label || log.category || 'General'}</Badge>
                      {log.feature && <Badge>{log.feature}</Badge>}
                      {log.dedup_count > 1 && <Badge variant="purple" title={`This error occurred ${log.dedup_count} times`}>×{log.dedup_count}</Badge>}
                    </div>
                    <div className="text-sm font-bold text-slate-800 mb-1">{log.title}</div>
                    {log.description && <div className="text-sm text-slate-600 mb-1.5 leading-snug">{log.description}</div>}
                    {log.action_hint && (
                      <div className="text-xs text-cyan-700 bg-cyan-50 rounded-md px-2.5 py-1.5 mt-1.5 flex items-start gap-1.5">
                        <Lightbulb size={13} className="shrink-0 mt-0.5" /> <span><strong>What to do:</strong> {log.action_hint}</span>
                      </div>
                    )}
                    <div className="flex gap-4 mt-2.5 flex-wrap text-xs text-slate-400">
                      {log.endpoint && <span>{log.endpoint}</span>}
                      {log.http_status && <span>HTTP {log.http_status}</span>}
                      {log.user_email && <span>{log.user_email}</span>}
                      <span className="ml-auto" title={log.created_at || ''}>{timeAgo(log.created_at)}</span>
                    </div>
                  </div>
                  {log.resolved && <span className="text-xs text-green-600 font-semibold shrink-0">Resolved</span>}
                </div>
              </div>
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} total={data.total} perPage={PER_PAGE} onChange={setPage} />
        </>
      )}
    </div>
  );
}

// Real, vetted product benchmarks (industry-standard targets for CRM SaaS
// APIs) — ported verbatim from audit_logs.js:1002-1016, not reinvented.
const PERF_BENCHMARKS = [
  [/\/api\/leads\/dashboard-stats/, 150, 'Dashboard aggregate'],
  [/\/api\/leads\/my/, 200, 'SDR lead list'],
  [/\/api\/leads\/activity-feed/, 150, 'Activity feed'],
  [/\/api\/leads\/search/, 200, 'Lead search'],
  [/\/api\/leads/, 200, 'Lead list'],
  [/\/api\/admin\/users/, 300, 'Admin user list'],
  [/\/api\/admin\/call-logs/, 250, 'Call log list'],
  [/\/api\/admin\/error-logs/, 200, 'Error log list'],
  [/\/api\/leaderboard/, 200, 'Leaderboard'],
  [/\/api\/auth\/callback/, 600, 'SSO callback (network)'],
  [/\/api\/dialer/, 300, 'Dialer'],
  [/\/api\/webhooks/, 100, 'Webhook handler'],
  [/\/api\/admin/, 350, 'Admin endpoint'],
];
function getPerfBenchmark(endpoint) {
  for (const [pattern, target, label] of PERF_BENCHMARKS) {
    if (pattern.test(endpoint)) return { target, label };
  }
  return { target: 300, label: 'API endpoint' };
}

const RAIL_TIERS = [
  { key: 'OK', label: 'OK (<100ms)', variant: 'success', valueClass: 'text-green-600' },
  { key: 'ACCEPTABLE', label: 'Acceptable (<300ms)', variant: 'warning', valueClass: 'text-amber-600' },
  { key: 'SLOW', label: 'Slow (<1s)', variant: 'warning', valueClass: 'text-orange-600' },
  { key: 'CRITICAL', label: 'Critical (>1s)', variant: 'danger', valueClass: 'text-red-600' },
];
const PERF_WINDOWS = [
  { id: '1h', label: 'Last 1h', hours: 1 },
  { id: '4h', label: 'Last 4h', hours: 4 },
  { id: '24h', label: 'Last 24h', hours: 24 },
  { id: 'deploy', label: 'Since Deploy', hours: null },
];

// ── Perf Health tab (Super Admin only) — ports audit_logs.js loadPerfHealth()
// (lines 964-1182). Read-only, no write actions.
function PerfHealthTab() {
  const [window_, setWindow] = useState('24h');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const win = PERF_WINDOWS.find((w) => w.id === window_);
    const params = win.id === 'deploy' ? { since_deploy: true } : { hours: win.hours };
    AdminService.getPerfSummary(params)
      .then((res) => { setData(res); setError(null); })
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [window_]);

  if (loading && !data) return <SkeletonTable cols={1} rows={6} />;
  if (error) return <EmptyState icon={Zap} title="Failed to load" message={error} />;

  const rail = data.rail_distribution || {};
  const total = data.total_requests || 0;
  const idx = data.index_health || {};
  const conv = data.messenger_health || {};
  const pct = (n) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0');
  const deployAt = data.deploy_time ? new Date(data.deploy_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div>
      <div className="flex justify-between items-start flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-base font-bold m-0 inline-flex items-center gap-1.5"><Zap size={16} /> Performance Health — {window_ === 'deploy' ? `Since deploy${deployAt ? ` (${deployAt})` : ''}` : `Last ${PERF_WINDOWS.find((w) => w.id === window_).hours}h`}</h3>
          <div className="text-xs text-slate-400 mt-0.5">
            {total.toLocaleString()} total requests · source: {data.data_source || 'db'} · snapshot: {new Date(data.snapshot_at).toLocaleTimeString()}
          </div>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-slate-200 bg-white hover:bg-slate-50">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-5">
        <span className="text-xs font-semibold text-slate-400 mr-0.5">WINDOW:</span>
        {PERF_WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setWindow(w.id)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border ${window_ === w.id ? 'bg-blue-800 border-blue-800 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {RAIL_TIERS.map((t) => (
          <div key={t.key} className="rounded-xl border border-slate-200 p-4">
            <div className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${t.valueClass}`}>{t.label}</div>
            <div className={`text-2xl font-extrabold ${t.valueClass}`}>{rail[t.key] ?? 0}</div>
            <div className="text-xs text-slate-400 mt-0.5">{pct(rail[t.key] ?? 0)}% of {total.toLocaleString()} requests</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-5">
        <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm">Slowest Endpoints (P95)</div>
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <tr>
                <TableHeader>Endpoint</TableHeader>
                <TableHeader className="text-right">Hits</TableHeader>
                <TableHeader className="text-right">P95</TableHeader>
                <TableHeader className="text-right">P50</TableHeader>
                <TableHeader className="text-right">Max</TableHeader>
                <TableHeader className="text-right">Crit%</TableHeader>
                <TableHeader className="text-right">vs Benchmark</TableHeader>
              </tr>
            </TableHead>
            <TableBody>
              {!(data.slowest_endpoints || []).length ? (
                <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-6">No data yet — metrics are collected per request.</TableCell></TableRow>
              ) : data.slowest_endpoints.map((e) => {
                const p95 = e.p95_ms ?? 0;
                const { target, label } = getPerfBenchmark(e.endpoint);
                const ratio = p95 > 0 ? p95 / target : 0;
                const benchVariant = p95 === 0 ? 'default' : ratio <= 0.85 ? 'success' : ratio <= 1.0 ? 'warning' : 'danger';
                const critPct = e.count > 0 && e.critical_count != null ? `${((e.critical_count / e.count) * 100).toFixed(0)}%` : '—';
                return (
                  <TableRow key={e.endpoint}>
                    <TableCell className="font-mono text-xs max-w-[240px] truncate" title={e.endpoint}>{e.endpoint}</TableCell>
                    <TableCell className="text-right">{(e.count ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-bold">{p95 ? `${p95.toLocaleString()}ms` : '—'}</TableCell>
                    <TableCell className="text-right">{e.p50_ms != null ? `${e.p50_ms.toLocaleString()}ms` : '—'}</TableCell>
                    <TableCell className="text-right">{e.max_ms != null ? `${e.max_ms.toLocaleString()}ms` : '—'}</TableCell>
                    <TableCell className="text-right">{critPct}</TableCell>
                    <TableCell className="text-right">
                      <div className="text-[0.65rem] text-slate-400 mb-0.5">{label} &lt;{target}ms</div>
                      {p95 > 0 ? <Badge variant={benchVariant}>{Math.round(ratio * 100)}% of target</Badge> : <span className="text-slate-400">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-bold text-sm mb-2.5">Index Health</div>
          <div className={`text-sm font-semibold ${idx.healthy === true ? 'text-green-600' : idx.healthy === false ? 'text-red-600' : 'text-slate-400'}`}>
            {idx.healthy === true ? 'All indexes present' : idx.healthy === false ? `${(idx.missing_indexes || []).length} index(es) missing` : '— Check unavailable'}
          </div>
          <div className="text-xs text-slate-400 mt-1">{idx.total_present ?? '—'} / {idx.total_expected ?? '—'} indexes present</div>
          {(idx.missing_indexes || []).length > 0 && <div className="text-xs text-red-600 mt-1.5">Missing: {idx.missing_indexes.join(', ')}</div>}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-bold text-sm mb-2.5 inline-flex items-center gap-1.5"><Phone size={14} /> Alternate Messenger API Health</div>
          <div className={`text-sm font-semibold ${conv.healthy ? 'text-green-600' : 'text-red-600'}`}>
            {conv.healthy ? 'No 502s today' : `${conv.errors_today} 502 error(s) today`}
          </div>
          {conv.last_502_at && <div className="text-xs text-slate-400 mt-1">Last at {new Date(conv.last_502_at).toLocaleTimeString()}</div>}
        </div>
      </div>
    </div>
  );
}
