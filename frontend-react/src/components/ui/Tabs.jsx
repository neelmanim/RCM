import React from 'react';

// Underline tab bar. `tabs`: [{key, label, icon?}]. Caller owns active-tab
// state and margin/spacing around the bar via className.
export const Tabs = ({ tabs, active, onChange, className = '' }) => (
  <div className={`flex gap-1 border-b border-slate-200 ${className}`}>
    {tabs.map((t) => {
      const Icon = t.icon;
      return (
        <button
          key={t.key}
          type="button"
          data-tab={t.key}
          onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            active === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {Icon && <Icon size={15} strokeWidth={2} />}
          {t.label}
        </button>
      );
    })}
  </div>
);
