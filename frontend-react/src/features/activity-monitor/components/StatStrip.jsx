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
            className={`px-5 py-4 flex items-center gap-3 bg-gradient-to-b from-[#141C1E] to-[#101517] border border-white/10 hover:border-[#C9FF68]/40 hover:-translate-y-0.5 transition-all duration-200 shadow-md ${t.onClick ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#C9FF68]/30' : ''} ${t.alert ? 'ring-1 ring-red-400/40' : ''}`}>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${t.iconClass || 'bg-white/5 text-[#9BA9A5]'}`}>
              <Icon size={20} strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <div data-stat-value className={`text-2xl font-black tracking-tight ${t.valueClass || 'text-[#F4F6F2]'}`}>{t.value}</div>
              <div data-stat-label className="text-xs font-bold text-[#9BA9A5] mt-0.5">{t.label}</div>
              {t.caption && <div className="text-[11px] leading-tight text-[#9BA9A5]/70 mt-0.5">{t.caption}</div>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
