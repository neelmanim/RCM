import React, { useState } from 'react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { Badge } from '../../../components/ui/Badge';
import { timeAgo } from '../lib/format';
import { DirectionBadge } from './CallsTable';
import { EmailExpandRow } from './EmailExpandRow';
import { EmptyState } from './EmptyState';

export const COLUMNS = ['Time', 'SDR', 'Lead', 'Direction', 'Subject', 'Opens', 'Clicks'];
const SORT_KEYS = { Time: 'time', Direction: 'direction' };

export function EmailTable({ items, onOpenLead, sort, onSort }) {
  const [expandedId, setExpandedId] = useState(null);

  if (!items.length) {
    return <EmptyState title="No emails found" />;
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
        {items.map((e) => {
          const isExpanded = expandedId === e.id;
          return (
            <React.Fragment key={e.id}>
              <TableRow onClick={() => setExpandedId(isExpanded ? null : e.id)}>
                <TableCell title={e.timestamp || ''}>{timeAgo(e.timestamp)}</TableCell>
                <TableCell>{e.sdr_name || <span className="text-slate-400">Unknown</span>}</TableCell>
                <TableCell className="whitespace-normal">
                  {e.lead_name ? (
                    <>
                      <div className="font-semibold text-slate-800">{e.lead_name}</div>
                      {e.lead_company && <div className="text-xs text-slate-400">{e.lead_company}</div>}
                    </>
                  ) : <span className="text-slate-400">—</span>}
                </TableCell>
                <TableCell><DirectionBadge direction={e.direction} /></TableCell>
                <TableCell className="whitespace-normal max-w-xs truncate">
                  {e.subject || <span className="text-slate-400">(no subject)</span>}
                </TableCell>
                <TableCell>{e.open_count > 0 ? <Badge variant="success">{e.open_count}</Badge> : <span className="text-slate-400">0</span>}</TableCell>
                <TableCell>{e.click_count > 0 ? <Badge variant="purple">{e.click_count}</Badge> : <span className="text-slate-400">0</span>}</TableCell>
              </TableRow>
              {isExpanded && (
                <tr>
                  <TableCell colSpan={7} className="bg-slate-50 whitespace-normal">
                    <EmailExpandRow email={e} onOpenLead={onOpenLead} onCollapse={() => setExpandedId(null)} />
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
