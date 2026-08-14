import React from 'react';
import { Badge } from '../../components/ui/Badge';
import { StatusCell } from './components/StatusCell';
import { AssigneeCell } from './components/AssigneeCell';
import { PhoneCell } from './components/PhoneCell';

// Phone resolution priority, matching the classic table exactly: phone →
// phone_secondary → company_phone, first non-blank. Shared by the Phone
// column's own render, the quick-call handler, and the Contact cell's
// placeholder-name fallback so there's one copy of this chain, not three.
export function resolveLeadPhone(lead) {
  return (lead.phone && lead.phone.trim()) || (lead.phone_secondary && lead.phone_secondary.trim()) || (lead.company_phone && lead.company_phone.trim()) || null;
}

// The reorderable/resizable/hideable columns — Contact is pinned first and
// rendered separately in LeadsHub.jsx/LeadRow.jsx, since it's the row's click
// target and always needs at least one visible identifying column.
//
// Single source of truth for both the header row (label, sortKey, width) and
// the body row (renderCell) — avoids the two staying independently in sync.

function timeInStatusClass(hours) {
  if (hours == null) return 'text-slate-400';
  if (hours < 24) return 'text-emerald-600 font-semibold';
  if (hours < 72) return 'text-amber-600 font-semibold';
  return 'text-red-600 font-semibold';
}

// Bulk imports store lead_source as "upload:<batch name>:<ISO timestamp>"
// (or "gsheet:...") — show just the batch name, not the internal prefix/timestamp.
// Klenty's nightly call sync ("klenty_sync:<date>") and the dialer's anonymous
// manual-dial leads ("Manual Dial") don't fit that shape and previously fell
// through unlabeled/mislabeled — give them their own badge text.
export function formatLeadSource(source) {
  if (!source) return '—';
  const m = source.match(/^(?:upload|gsheet):(.+):\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/);
  if (m) return m[1];
  if (source.startsWith('klenty_sync')) return 'Klenty';
  if (source.startsWith('aircall_webhook') || source.startsWith('aircall_sync')) return 'Aircall';
  if (source === 'Manual Dial') return 'Manual Dial';
  // Legacy pre-enhancement tags (predate the upload:/gsheet: prefixed
  // format above) — the classic view has always had these two cases;
  // this port dropped them, leaving the raw lowercase string on screen.
  if (source === 'uploaded') return 'Uploaded';
  if (source === 'manual') return 'Manual';
  return source;
}

export const COLUMN_DEFS = [
  {
    key: 'status', label: 'Status', sortKey: 'status', defaultWidth: 150, interactive: true,
    renderCell: (lead, { onSetStatus }) => (
      <StatusCell status={lead.status} onChange={(status) => onSetStatus(lead.id, status)} />
    ),
  },
  {
    key: 'source', label: 'Source', sortKey: 'source', defaultWidth: 140,
    renderCell: (lead) => {
      const source = formatLeadSource(lead.lead_source);
      return (
        <Badge variant="info" className="max-w-full" title={source}>
          <span className="truncate">{source}</span>
        </Badge>
      );
    },
  },
  {
    key: 'assignedTo', label: 'Assigned to', sortKey: null, defaultWidth: 170, interactive: true,
    renderCell: (lead, { onSetAssignee, sdrs }) => (
      <AssigneeCell assignedTo={lead.assigned_to} sdrs={sdrs} onChange={(userId) => onSetAssignee(lead.id, userId)} />
    ),
  },
  {
    key: 'timeInStatus', label: 'Time in status', sortKey: 'time_in_status', defaultWidth: 130,
    renderCell: (lead) => (
      <span className={timeInStatusClass(lead.time_in_status_hours)}>{lead.time_in_status || '—'}</span>
    ),
  },
  {
    key: 'lastActivity', label: 'Last activity', sortKey: null, defaultWidth: 200,
    renderCell: (lead) => (
      lead.last_activity ? (
        <span className="block max-w-[190px]">
          <span className="block text-xs truncate">{lead.last_activity.summary}</span>
          <span className="block text-[11px] text-slate-400">{lead.last_activity.author}</span>
        </span>
      ) : <span className="text-slate-400">—</span>
    ),
  },
  {
    key: 'phone', label: 'Phone', sortKey: 'phone', defaultWidth: 170, interactive: true,
    renderCell: (lead, { onQuickCall, isAdmin }) => (
      <PhoneCell lead={lead} isAdmin={isAdmin} onQuickCall={onQuickCall} />
    ),
  },
];

export const DEFAULT_COLUMN_ORDER = COLUMN_DEFS.map((c) => c.key);
export const COLUMN_BY_KEY = new Map(COLUMN_DEFS.map((c) => [c.key, c]));
