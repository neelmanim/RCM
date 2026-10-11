import React, { useState, useCallback, useMemo } from 'react';
import {
  Activity, Download, ShieldAlert, BarChart3, Clock, CheckCircle2, XCircle,
  Mail, Eye, TrendingUp, Reply, Send, MessageSquare, CalendarCheck,
} from 'lucide-react';
import { SkeletonStatCard, SkeletonTable } from '../../components/ui/Skeleton';
import { ActivityMonitorService } from '../../services/api';
import { useActivityMonitorData } from './useActivityMonitorData';
import { useSort } from '../../utils/useSort';
import { ChannelTabs } from './components/ChannelTabs';
import { FilterBar } from './components/FilterBar';
import { StatStrip } from './components/StatStrip';
import { Pagination } from '../../components/ui/Pagination';
import { CallsTable, COLUMNS as CALLS_COLUMNS } from './components/CallsTable';
import { EmailTable, COLUMNS as EMAIL_COLUMNS } from './components/EmailTable';
import { MessagesTable, COLUMNS as MESSAGES_COLUMNS } from './components/MessagesTable';
import { exportCsv } from './lib/exportCsv';
import { cleanParams } from './lib/queryParams';
import { EMPTY_FILTERS, PER_PAGE, CSV_EXPORT_CAP } from './constants';
import { useCanExport } from '../../lib/useCanExport';

const ACTIVITY_MONITOR_ALLOWED_ROLES = ['super admin', 'pod admin'];

// Skeleton column count while loading — read from each table's own COLUMNS
// so it can't drift out of sync if a column is ever added or removed.
const TABLE_COLS = { calls: CALLS_COLUMNS.length, email: EMAIL_COLUMNS.length, messages: MESSAGES_COLUMNS.length };

const FETCHERS = {
  calls: ActivityMonitorService.getCallLogs,
  email: ActivityMonitorService.getEmailLogs,
  messages: ActivityMonitorService.getMessageLogs,
};

const CSV_COLUMNS = {
  calls: [
    { key: 'sdr_name', label: 'SDR' }, { key: 'lead_name', label: 'Lead' }, { key: 'lead_company', label: 'Company' },
    { key: 'phone_number', label: 'Phone' }, { key: 'provider', label: 'Provider' }, { key: 'direction', label: 'Direction' },
    { key: 'status', label: 'Status' }, { key: 'outcome', label: 'Outcome' }, { key: 'duration', label: 'Duration' },
    { key: 'started_at', label: 'Started' }, { key: 'ended_at', label: 'Ended' }, { key: 'recording_url', label: 'Recording' },
  ],
  email: [
    { key: 'sdr_name', label: 'SDR' }, { key: 'lead_name', label: 'Lead' }, { key: 'lead_company', label: 'Company' },
    { key: 'direction', label: 'Direction' }, { key: 'subject', label: 'Subject' }, { key: 'from_email', label: 'From' },
    { key: 'to_email', label: 'To' }, { key: 'open_count', label: 'Opens' }, { key: 'click_count', label: 'Clicks' },
    { key: 'timestamp', label: 'Time' },
  ],
  messages: [
    { key: 'sdr_name', label: 'SDR' }, { key: 'lead_name', label: 'Lead' }, { key: 'phone_number', label: 'Phone' },
    { key: 'channel', label: 'Channel' }, { key: 'direction', label: 'Direction' }, { key: 'status', label: 'Status' },
    { key: 'message_text', label: 'Message' }, { key: 'template_name', label: 'Template' }, { key: 'sent_at', label: 'Time' },
  ],
};

function fmtPct(part, total) {
  if (!total) return '—';
  return `${Math.round(((part || 0) / total) * 100)}%`;
}

/**
 * Props from the Vanilla JS shell (mirrors pods-entry.jsx's contract):
 *   token, userRole, podId, apiBase
 *   onOpenLead(leadId) — defaults to window._loadView('lead-detail', id),
 *   the same global the legacy call_monitor.js's "Open Lead" button used.
 */
export function ActivityMonitorHub({ userRole, onOpenLead }) {
  const allowed = ACTIVITY_MONITOR_ALLOWED_ROLES.includes((userRole || '').toLowerCase());

  const [channel, setChannel] = useState('calls');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, toggleSortRaw, resetSort] = useSort();
  const [page, setPage] = useState(1);
  const toggleSort = useCallback((key) => { toggleSortRaw(key); setPage(1); }, [toggleSortRaw]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canExport = useCanExport();
  const [exportError, setExportError] = useState(null);

  const changeChannel = useCallback((next) => {
    setChannel(next);
    setFilters(EMPTY_FILTERS);
    resetSort();
    setPage(1);
  }, [resetSort]);

  const applyFilters = useCallback((next) => {
    setFilters(next);
    setPage(1);
  }, []);

  const sortedFilters = useMemo(
    () => (sort.key ? { ...filters, sort_by: `${sort.dir === 'desc' ? '-' : ''}${sort.key}` } : filters),
    [filters, sort]
  );

  const { items, total, pages, sdrs, summary, loading, error, lastUpdated } = useActivityMonitorData(
    FETCHERS[channel], sortedFilters, page, { pausePolling: !autoRefresh || playing, enabled: allowed },
  );

  const handleOpenLead = onOpenLead || ((leadId) => window._loadView?.('lead-detail', leadId));

  // The two legacy pages this replaced (call_monitor.js, activity_feed.js)
  // both wrapped their export fetch in try/catch and surfaced a toast on
  // failure — that defensive layer was dropped during the React port, so a
  // slow/failed export (this request pulls 80x more rows than normal
  // pagination, through heavier joined/aggregate queries) silently did
  // nothing with no visible error at all.
  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const resp = await FETCHERS[channel](
        cleanParams({ ...filters, page: 1, per_page: CSV_EXPORT_CAP }),
        { timeout: 30000 },
      );
      exportCsv({ rows: resp.items || [], columns: CSV_COLUMNS[channel], filenamePrefix: `activity-monitor-${channel}` });
    } catch (err) {
      setExportError(err?.response?.data?.detail || err?.message || 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [channel, filters]);

  const tiles = useMemo(() => {
    if (channel === 'calls') {
      return [
        { label: 'Total Calls', value: (total ?? 0).toLocaleString(), icon: BarChart3, iconClass: 'bg-blue-50 text-blue-600' },
        { label: 'Avg Duration', value: summary.avg_duration != null ? `${summary.avg_duration}s` : '—', icon: Clock, iconClass: 'bg-slate-100 text-slate-500' },
        { label: 'Connected', value: fmtPct(summary.connected, total), icon: CheckCircle2, iconClass: 'bg-emerald-50 text-emerald-600' },
        { label: 'Failed', value: summary.failed ?? '—', icon: XCircle, iconClass: 'bg-red-50 text-red-600', valueClass: 'text-red-600' },
        // "Are SDRs actually creating meeting invites when they log a
        // Meeting Confirmed call" — a gap here (invites_created <
        // meetings_confirmed) means the calendar integration isn't firing
        // (no mailbox connected, or the Nylas call failed) for that many
        // confirmed meetings.
        {
          label: 'Invites Created',
          value: summary.meetings_confirmed
            ? `${summary.invites_created ?? 0}/${summary.meetings_confirmed}`
            : '—',
          icon: CalendarCheck,
          iconClass: 'bg-indigo-50 text-indigo-600',
          valueClass: (summary.invites_created ?? 0) < (summary.meetings_confirmed ?? 0) ? 'text-amber-600' : 'text-slate-900',
        },
      ];
    }
    if (channel === 'email') {
      return [
        { label: 'Sent', value: (summary.sent ?? 0).toLocaleString(), icon: Mail, iconClass: 'bg-blue-50 text-blue-600' },
        { label: 'Opened', value: (summary.opened ?? 0).toLocaleString(), icon: Eye, iconClass: 'bg-slate-100 text-slate-500' },
        { label: 'Open Rate', value: summary.open_rate != null ? `${summary.open_rate}%` : '—', icon: TrendingUp, iconClass: 'bg-emerald-50 text-emerald-600' },
        { label: 'Reply Rate', value: summary.reply_rate != null ? `${summary.reply_rate}%` : '—', icon: Reply, iconClass: 'bg-indigo-50 text-indigo-600' },
      ];
    }
    return [
      { label: 'Sent', value: (summary.sent ?? 0).toLocaleString(), icon: Send, iconClass: 'bg-blue-50 text-blue-600' },
      { label: 'Delivered', value: (summary.delivered ?? 0).toLocaleString(), icon: CheckCircle2, iconClass: 'bg-emerald-50 text-emerald-600' },
      { label: 'Failed', value: summary.failed ?? '—', icon: XCircle, iconClass: 'bg-red-50 text-red-600', valueClass: 'text-red-600' },
      { label: 'WhatsApp', value: (summary.whatsapp_count ?? 0).toLocaleString(), icon: MessageSquare, iconClass: 'bg-emerald-50 text-emerald-600' },
    ];
  }, [channel, summary, total]);

  if (!allowed) {
    return (
      <div className="p-16 text-center text-slate-500">
        <ShieldAlert size={36} className="mx-auto mb-3 text-slate-300" strokeWidth={1.5} />
        <div className="font-semibold text-slate-700">You don't have access to Activity Monitor.</div>
      </div>
    );
  }

  return (
    <div className="activitymonitor w-full max-w-[1400px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Activity size={20} strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight m-0">Activity Monitor</h1>
            <p className="text-sm text-slate-500 mt-1">Real-time calls, emails, and messages across your team</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              autoRefresh ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-green-500' : 'bg-slate-400'}`} />
            Auto-refresh: {autoRefresh ? 'ON' : 'OFF'}
          </button>
          {lastUpdated && <span className="text-xs text-slate-400">Updated {lastUpdated}</span>}
          {canExport && (
            <button onClick={handleExport} disabled={exporting} className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
              <Download size={14} />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 mb-5 text-xs font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
          <span>Couldn't load activity: {error}</span>
        </div>
      )}

      {exportError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 mb-5 text-xs font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
          <span>Export failed: {exportError}</span>
        </div>
      )}

      <ChannelTabs active={channel} onChange={changeChannel} />
      <FilterBar channel={channel} sdrs={sdrs} onApply={applyFilters} />

      {loading && !items.length ? (
        <div className="grid grid-cols-4 gap-4 mb-5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
      ) : (
        <StatStrip tiles={tiles} />
      )}

      {loading && !items.length ? (
        <SkeletonTable rows={8} cols={TABLE_COLS[channel]} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {channel === 'calls' && <CallsTable items={items} onOpenLead={handleOpenLead} onPlayingChange={setPlaying} sort={sort} onSort={toggleSort} />}
          {channel === 'email' && <EmailTable items={items} onOpenLead={handleOpenLead} sort={sort} onSort={toggleSort} />}
          {channel === 'messages' && <MessagesTable items={items} onOpenLead={handleOpenLead} sort={sort} onSort={toggleSort} />}
          <div className="px-4 pb-4">
            <Pagination page={page} pages={pages} total={total} perPage={PER_PAGE} onChange={setPage} />
          </div>
        </div>
      )}
    </div>
  );
}
