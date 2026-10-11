import React from 'react';
import { Card } from '../../../components/ui/Card';

// tiles: [{ label, value, icon, iconClass?, valueClass?, caption?, alert? }]. `columns` (a Tailwind grid-cols string,
// e.g. "grid-cols-2 md:grid-cols-5") makes the strip responsive; without it the strip is one row of tiles.length columns.
export function StatStrip({ tiles, columns, className = 'mb-5' }) {
  return (
    <div className={`grid gap-4 ${columns || ''} ${className}`}
      style={columns ? undefined : { gridTemplateColumns: `repeat(${tiles.length}, minmax(0,1fr))` }}>
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Card key={t.label} data-stat={t.label}
            {...(t.onClick ? {
              role: 'button', tabIndex: 0, title: t.hint, onClick: t.onClick,
              onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.onClick(); } },
            } : {})}
            className={`px-5 py-4 flex items-center gap-3 hover:shadow-sm ${t.onClick ? 'cursor-pointer hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300' : ''} ${t.alert ? 'ring-1 ring-red-200' : ''}`}>
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${t.iconClass || 'bg-slate-50 text-slate-400'}`}>
              <Icon size={18} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div data-stat-value className={`text-xl font-extrabold ${t.valueClass || 'text-slate-900'}`}>{t.value}</div>
              <div data-stat-label className="text-xs font-semibold text-slate-500">{t.label}</div>
              {t.caption && <div className="text-[11px] leading-tight text-slate-400">{t.caption}</div>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
