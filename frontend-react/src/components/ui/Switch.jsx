import React from 'react';

// A label+checkbox styled as a toggle switch.
export const Switch = ({ checked, onChange, label, hint, ariaLabel, disabled = false, className = '' }) => (
  <label className={`flex items-start justify-between gap-3 cursor-pointer ${className}`}>
    <span>
      {label && <span className="block text-sm font-semibold text-slate-800">{label}</span>}
      {hint && <span className="block text-xs text-slate-500 mt-0.5">{hint}</span>}
    </span>
    <span className="relative inline-flex items-center shrink-0 mt-0.5">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={ariaLabel} disabled={disabled} className="peer sr-only" />
      <span className="w-9 h-5 rounded-full bg-slate-200 peer-checked:bg-indigo-600 transition-colors" />
      <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
    </span>
  </label>
);
