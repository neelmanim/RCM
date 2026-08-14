import React, { useState, useEffect } from 'react';
import { GripVertical, Mail, PhoneCall, ChevronLeft, ChevronRight } from 'lucide-react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { displayName } from '../../leads-hub/components/LeadRow';
import { resolveLeadPhone } from '../../leads-hub/columns';

const STATUS_BADGE = {
  called:          { label: 'Called',              variant: 'success' },
  'skipped-manual': { label: 'Skipped',             variant: 'default' },
  'skipped-dnc':    { label: 'Skipped — do not contact', variant: 'danger' },
};

const PAGE_SIZE = 15;

/**
 * The full session queue — already-resolved leads above the current row for
 * visibility, the current lead highlighted, everything after reorderable
 * (native HTML5 drag-and-drop — no library for what this needs). Reordering
 * the current lead itself is disabled: dragging the in-progress lead out
 * from under itself has no sensible meaning.
 *
 * Paginated client-side (the whole queue — up to 50 leads — is already
 * fetched; this only windows the render) rather than a second server round
 * trip. Drag-and-drop reorder is therefore scoped to the visible page —
 * HTML5 DnD can't target a row that isn't rendered anyway.
 */
export function QueueList({ queue, currentIndex, sessionStatus, skipReasons, onReorderUpcoming, onLeadClick, onCallBack }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE));

  // Jump to whichever page the current lead is on — a rep advancing past a
  // page boundary must never land on a page that no longer shows "Current".
  useEffect(() => {
    setPage(Math.floor(currentIndex / PAGE_SIZE));
  }, [currentIndex]);

  if (queue.length === 0) return null;

  const handleDrop = (targetIndex) => {
    if (dragIndex == null || dragIndex === targetIndex) { setDragIndex(null); return; }
    onReorderUpcoming(dragIndex, targetIndex);
    setDragIndex(null);
  };

  const pageRows = queue.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-2">
    <Table>
      <TableHead>
        <TableRow>
          <TableHeader className="w-8" />
          <TableHeader>Lead</TableHeader>
          <TableHeader>Phone</TableHeader>
          <TableHeader>Status</TableHeader>
          <TableHeader className="w-8" title="Emailed via a synced mailbox" data-tour="email-column">
            <Mail size={13} />
          </TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {pageRows.map((lead, pageI) => {
          const i = page * PAGE_SIZE + pageI;
          const isCurrent = i === currentIndex;
          const resolved = sessionStatus.get(lead.id);
          const badge = resolved ? STATUS_BADGE[resolved] : null;
          const reorderable = i > currentIndex;
          return (
            <TableRow
              key={lead.id}
              className={isCurrent ? 'bg-blue-50' : ''}
              onClick={onLeadClick ? () => onLeadClick(lead.id) : undefined}
              draggable={reorderable}
              onDragStart={reorderable ? () => setDragIndex(i) : undefined}
              onDragOver={reorderable ? (e) => e.preventDefault() : undefined}
              onDrop={reorderable ? () => handleDrop(i) : undefined}
            >
              <TableCell className="w-8">
                {reorderable && <GripVertical size={14} className="text-slate-300 cursor-grab" />}
              </TableCell>
              <TableCell className={isCurrent ? 'font-semibold text-slate-900' : ''}>
                {displayName(lead)}
                {isCurrent && <span className="ml-2 text-xs text-blue-600 font-semibold">← Current</span>}
              </TableCell>
              <TableCell>{resolveLeadPhone(lead) || <span className="text-slate-400 italic">—</span>}</TableCell>
              <TableCell>
                {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : <Badge variant="default">Pending</Badge>}
                {resolved === 'skipped-manual' && skipReasons?.get(lead.id) && (
                  <span className="ml-1.5 text-xs text-slate-400 italic">— {skipReasons.get(lead.id)}</span>
                )}
                {resolved && resolved !== 'called' && onCallBack && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-1.5 h-6 px-1.5 text-xs"
                    onClick={(e) => { e.stopPropagation(); onCallBack(lead.id); }}
                    title="Move back into the queue as the next call"
                  >
                    <PhoneCall size={12} /> Call back
                  </Button>
                )}
              </TableCell>
              <TableCell className="w-8">
                <Mail
                  size={15}
                  className={lead.last_email_sent_at ? 'text-green-600' : 'text-slate-300'}
                  aria-label={lead.last_email_sent_at ? 'Email sent' : 'No email sent yet'}
                  title={lead.last_email_sent_at
                    ? `Emailed ${new Date(lead.last_email_sent_at).toLocaleDateString()}`
                    : 'No email sent yet'}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    {totalPages > 1 && (
      <div className="flex items-center justify-between text-sm text-slate-500 px-1">
        <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
          <ChevronLeft size={14} /> Prev
        </Button>
        <span>Page {page + 1} of {totalPages}</span>
        <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
          Next <ChevronRight size={14} />
        </Button>
      </div>
    )}
    </div>
  );
}
