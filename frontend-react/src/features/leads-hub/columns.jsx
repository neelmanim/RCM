import React from 'react';
import { Badge } from '../../components/ui/Badge';
import { StatusCell } from './components/StatusCell';
import { AssigneeCell } from './components/AssigneeCell';
import { PhoneCell } from './components/PhoneCell';
import { formatLeadSource } from '../../lib/leadSource';

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

export const COLUMN_DEFS = [
  {
    key: 'status', label: 'Status', sortKey: 'status', defaultWidth: 150, interactive: true,
    renderCell: (lead, { onSetStatus }) => (
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusCell status={lead.status} onChange={(status) => onSetStatus(lead.id, status)} />
        {/* Instantly.ai pull-sync signal — informational only, never implies
            a status change. Most leads won't have one. */}
        {lead.instantly_interest_label && (
          <Badge variant="info" title="Instantly.ai signal — informational only">{lead.instantly_interest_label}</Badge>
        )}
      </div>
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
