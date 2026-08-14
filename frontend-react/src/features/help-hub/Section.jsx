import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Accordion shell for one guide section. Collapsed by default (matches the
 * classic guide's behavior — no section pre-expanded). `forceOpen` is set
 * by the search filter to auto-expand a matching section.
 */
export const Section = ({ title, Icon, open, onToggle, children }) => (
  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white mb-3">
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-4 sm:px-5 py-4 text-left hover:bg-slate-50 transition-colors"
    >
      <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
        <Icon size={16} className="text-blue-600" />
      </div>
      <span className="flex-1 text-sm font-semibold text-slate-800">{title}</span>
      {open ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
    </button>
    {open && (
      <div className="helphub-content px-4 sm:px-5 pb-5 pt-0 text-sm text-slate-600 leading-relaxed">
        {children}
      </div>
    )}
  </div>
);
