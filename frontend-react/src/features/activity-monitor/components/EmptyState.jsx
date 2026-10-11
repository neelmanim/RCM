import { Inbox } from 'lucide-react';
import React from 'react';

/** Shared "no rows" state for all three tabs — same icon/copy, only the
 * title differs (e.g. "No calls found" vs "No emails found"). */
export function EmptyState({ title }) {
  return (
    <div className="py-16 text-center text-slate-500">
      <Inbox size={32} className="mx-auto mb-3 text-slate-300" strokeWidth={1.5} />
      <div className="font-semibold text-slate-700 mb-1">{title}</div>
      <div className="text-sm text-slate-400">Try adjusting your filters or date range.</div>
    </div>
  );
}
