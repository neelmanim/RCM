import React from 'react';
import { Info } from 'lucide-react';
import { TableRow, TableCell } from '../../../components/ui/Table';
import { PriorityDot } from './PriorityDot';
import { resolveLeadPhone } from '../columns';

// Auto-created leads (Klenty sync with no caller name, manual-dial anonymous
// leads) get a hardcoded "Unknown"/"Unknown Caller" name so the DB's
// NOT NULL last_name constraint is satisfied — showing that placeholder to
// the user reads as a bug. The phone number is the one real identifier these
// rows always have, so surface that instead of the word "Unknown".
export function displayName(lead) {
  const raw = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
  const isPlaceholder = !raw || /^unknown(\s+caller)?$/i.test(raw);
  // `|| raw` here would silently reintroduce the literal "Unknown"/"Unknown
  // Caller" placeholder on a lead with no phone at all — the exact case
  // this function exists to hide.
  return isPlaceholder ? (resolveLeadPhone(lead) || '—') : raw;
}

export function LeadRow({ lead, columns, sdrs, isAdmin, assignMode, selected, onToggleSelect, onSetStatus, onSetAssignee, onSetPriority, onQuickCall, onOpenLead }) {
  const name = displayName(lead);
  const cellActions = { onSetStatus, onSetAssignee, sdrs, onQuickCall, onOpenLead, isAdmin };
  return (
    <TableRow onClick={() => onOpenLead(lead)}>
      {assignMode && (
        <TableCell className="w-8">
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect(lead.id)}
            aria-label={`Select ${name}`}
            className="w-4 h-4 rounded border-slate-300 accent-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-0"
          />
        </TableCell>
      )}
      <TableCell className="overflow-hidden">
        <PriorityDot score={lead.priority_score} onChange={(score) => onSetPriority(lead.id, score)} showLabel={!isAdmin} />
        <span className="inline-block align-middle max-w-[calc(100%-24px)]">
          <span className="font-bold text-sm text-slate-800 block truncate">
            {name}
            {lead.company_resolved && (
              <span
                title={`Resolved elsewhere — ${lead.company_resolved.resolved_by} (${lead.company_resolved.resolved_outcome})`}
                className="inline-flex ml-1.5 -mb-0.5 text-amber-500 cursor-help"
              >
                <Info size={13} strokeWidth={2.25} />
              </span>
            )}
          </span>
          {lead.title && <span className="block text-xs text-slate-400 font-normal truncate">{lead.title}</span>}
          {!!(lead.tags && lead.tags.length) && (
            <span className="flex gap-1 mt-1 flex-wrap">
              {lead.tags.map((t) => (
                <span key={t} className="text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 border border-slate-200 rounded px-1 py-0.5">{t}</span>
              ))}
            </span>
          )}
          {lead.latest_note?.content && (
            <span className="block text-xs text-slate-400 italic mt-0.5 max-w-[220px] truncate" title={lead.latest_note.content}>
              {lead.latest_note.content}
            </span>
          )}
        </span>
      </TableCell>
      {columns.map((col) => (
        <TableCell key={col.key} className="overflow-hidden" onClick={col.interactive ? (e) => e.stopPropagation() : undefined}>
          {col.renderCell(lead, cellActions)}
        </TableCell>
      ))}
    </TableRow>
  );
}
