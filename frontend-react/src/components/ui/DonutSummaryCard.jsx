import React, { useState } from 'react';
import { Card, CardHeader, CardContent } from './Card';
import { DonutChart } from './DonutChart';

/** Card > DonutChart (hover swaps the center total for the hovered segment)
 *  > a legend list with value + share% — the shared shape behind Campaigns'
 *  "Delivery outcomes" and Cadence's "Enrollment outcomes" performance
 *  summaries. `filter` is optional extra content (e.g. a per-item <select>)
 *  rendered above the chart. */
export function DonutSummaryCard({ title, subtitle, segments, size = 180, strokeWidth = 22, filter, className }) {
  const [hovered, setHovered] = useState(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} />
      <CardContent className="flex flex-col items-center gap-4">
        {filter}
        <DonutChart
          data={segments}
          size={size}
          strokeWidth={strokeWidth}
          onSegmentHover={setHovered}
          centerContent={
            <div className="text-center">
              <div className="text-2xl font-bold text-slate-800 tabular-nums">{hovered ? hovered.value : total}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{hovered ? hovered.label : 'Total'}</div>
            </div>
          }
        />
        <div className="w-full space-y-1.5">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-semibold text-slate-700 tabular-nums">
                {s.value}{total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ''}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
