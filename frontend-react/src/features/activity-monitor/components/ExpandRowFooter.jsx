import { ArrowRight, ChevronUp } from 'lucide-react';
import React from 'react';

/** Shared footer for all three ExpandRow variants: a row of metadata pills
 * (each pre-built by the caller so per-pill styling — e.g. Email's amber
 * "Auto-reply" badge — stays caller-controlled) plus an optional "Open
 * Lead" link and an optional "Collapse" affordance so closing an expanded
 * row never requires scrolling back up to the original table row. Falsy
 * pills are filtered out so callers can list conditionals inline without an
 * extra && wrapper. */
export function ExpandRowFooter({ pills, leadId, onOpenLead, onCollapse, className = 'flex items-center justify-between mt-3 pt-3 border-t border-slate-200' }) {
  return (
    <div className={className}>
      <div className="flex gap-2 text-xs text-slate-500">
        {pills.filter(Boolean)}
      </div>
      <div className="flex items-center gap-4">
        {leadId && (
          <button className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline" onClick={() => onOpenLead(leadId)}>
            Open Lead <ArrowRight size={12} />
          </button>
        )}
        {onCollapse && (
          <button className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600" onClick={onCollapse}>
            <ChevronUp size={13} /> Collapse
          </button>
        )}
      </div>
    </div>
  );
}
