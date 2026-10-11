import React, { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { Badge } from '../../../components/ui/Badge';
import { timeAgo } from '../lib/format';
import { DirectionBadge } from './CallsTable';
import { EmptyState } from './EmptyState';
import { MessagesExpandRow } from './MessagesExpandRow';

// No dedicated WhatsApp/SMS brand icon exists anywhere in this app's icon
// set — matching the established convention (JourneyNode.jsx, activityEvents.jsx)
// of a generic message icon distinguished only by badge color/text.
function ChannelBadge({ channel }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <MessageSquare size={13} className="text-slate-400" />
      <Badge variant={channel === 'whatsapp' ? 'success' : 'info'}>{channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}</Badge>
    </span>
  );
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const su = status.toLowerCase();
  const variant = su.includes('fail') ? 'danger'
    : su.includes('deliver') ? 'success'
    : su.includes('receiv') ? 'info' : 'default';
  return <Badge variant={variant}>{status}</Badge>;
}

export const COLUMNS = ['Time', 'SDR', 'Lead', 'Channel', 'Direction', 'Status', 'Template'];
const SORT_KEYS = { Time: 'time', Channel: 'channel', Direction: 'direction', Status: 'status' };

export function MessagesTable({ items, onOpenLead, sort, onSort }) {
  const [expandedId, setExpandedId] = useState(null);

  if (!items.length) {
    return <EmptyState title="No messages found" />;
  }

  return (
    <Table>
      <TableHead>
        <TableRow>{COLUMNS.map((h) => {
          const sortKey = SORT_KEYS[h];
          return sortKey && sort && onSort
            ? <SortableTableHeader key={h} label={h} sortKey={sortKey} sort={sort} onSort={onSort} />
            : <TableHeader key={h}>{h}</TableHeader>;
        })}</TableRow>
      </TableHead>
      <TableBody>
        {items.map((m) => {
          const isExpanded = expandedId === m.id;
          return (
            <React.Fragment key={m.id}>
              <TableRow onClick={() => setExpandedId(isExpanded ? null : m.id)}>
                <TableCell title={m.sent_at || ''}>{timeAgo(m.sent_at)}</TableCell>
                <TableCell>{m.sdr_name || <span className="text-slate-400">Unknown</span>}</TableCell>
                <TableCell className="whitespace-normal">
                  {m.lead_name ? (
                    <>
                      <div className="font-semibold text-slate-800">{m.lead_name}</div>
                      {m.lead_company && <div className="text-xs text-slate-400">{m.lead_company}</div>}
                    </>
                  ) : <span className="text-slate-400">{m.phone_number || '—'}</span>}
                </TableCell>
                <TableCell><ChannelBadge channel={m.channel} /></TableCell>
                <TableCell><DirectionBadge direction={m.direction} /></TableCell>
                <TableCell><StatusBadge status={m.status} /></TableCell>
                <TableCell>{m.template_name || <span className="text-slate-400">—</span>}</TableCell>
              </TableRow>
              {isExpanded && (
                <tr>
                  <TableCell colSpan={7} className="bg-slate-50 whitespace-normal">
                    <MessagesExpandRow message={m} onOpenLead={onOpenLead} onCollapse={() => setExpandedId(null)} />
                  </TableCell>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
