import React from 'react';

// Shared section wrapper for everything inside ReportingTab — extracted once
// this exact header markup hit its third copy (Engagement, RepPerformance,
// Trend all had it inline).
export function ReportingSection({ icon: Icon, title, children }) {
  return (
    <div className="border-t border-slate-200 px-4 py-4">
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mb-3">
        <Icon size={14} /> {title}
      </div>
      {children}
    </div>
  );
}
