import React from 'react';
import { InlineSelectCell } from './InlineSelectCell';

/** Inline single-lead reassignment — a dropdown of SDR/AE users plus an
 * explicit "Unassigned" option. Autosaves on change, same pattern as StatusCell. */
export function AssigneeCell({ assignedTo, sdrs, onChange }) {
  const current = assignedTo?.[0];
  const options = [{ value: '', label: 'Unassigned' }, ...sdrs.map((s) => ({ value: s.id, label: s.name }))];

  return (
    <InlineSelectCell
      value={current?.id || ''} onChange={(v) => onChange(v || null)}
      ariaLabel="Reassign lead" options={options} className="min-w-[120px]"
    >
      {current ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
            {(current.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </span>
          {current.name}
        </span>
      ) : (
        <span className="text-slate-400 italic text-sm">Unassigned</span>
      )}
    </InlineSelectCell>
  );
}
