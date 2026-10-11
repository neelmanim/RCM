import React from 'react';

/** One setting inside a settings card: what it is and what it does on the left, its control on the right.
 *  Stack rows in a single Card (they get a divider) instead of a card per switch. `status` is a short inline
 *  message ("Saving…", an error) shown under the description; `danger` tints the description for settings that
 *  write to another system or overwrite data. `children` is a wider control (a list, a grid) that sits under the
 *  label inside the same row, so it never floats apart from the setting it belongs to. */
export const SettingRow = ({ label, description, control, status, statusTone = 'info', danger = false, children, className = '' }) => (
  <div className={`py-4 border-b border-slate-100 last:border-b-0 ${className}`}>
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-800">{label}</div>
        {description && <div className={`text-xs mt-0.5 ${danger ? 'text-amber-700' : 'text-slate-500'}`}>{description}</div>}
        {status && (
          <div role="status" className={`text-xs mt-1 ${statusTone === 'error' ? 'text-red-600' : 'text-slate-500'}`}>{status}</div>
        )}
      </div>
      {control && <div className="shrink-0 flex items-center">{control}</div>}
    </div>
    {children && <div className="mt-3">{children}</div>}
  </div>
);
