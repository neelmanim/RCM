import React from 'react';

// Underline tab bar. `tabs`: [{key, label, icon?}]. Caller owns active-tab
// state and margin/spacing around the bar via className.
export const Tabs = ({ tabs, active, onChange, className = '' }) => (
  <div className={`flex gap-1 border-b border-white/10 ${className}`}>
    {tabs.map((t) => {
      const Icon = t.icon;
      return (
        <button
          key={t.key}
          type="button"
          data-tab={t.key}
          onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
            active === t.key ? 'border-[#C9FF68] text-[#C9FF68]' : 'border-transparent text-[#9BA9A5] hover:text-[#F4F6F2]'
          }`}
        >
          {Icon && <Icon size={15} strokeWidth={2} />}
          {t.label}
        </button>
      );
    })}
  </div>
);
