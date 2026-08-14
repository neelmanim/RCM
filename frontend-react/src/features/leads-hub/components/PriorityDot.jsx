import React, { useState, useRef } from 'react';
import { PRIORITY_TIERS, priorityTierFor } from '../constants';
import { useClickOutside } from '../hooks/useClickOutside';

/** Small colored dot (not a pill) — priority sits next to Status without
 * competing with it visually. Click opens a tiny re-prioritize menu.
 *
 * `showLabel` (SDR/AE-only, see LeadRow.jsx) additionally renders the tier
 * name next to the dot for non-High tiers — classic shows this as a static,
 * unclickable badge; here it's inside the same button as the dot, so
 * clicking the label opens the same re-prioritize menu instead of being
 * pure decoration. */
export function PriorityDot({ score, onChange, showLabel = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const tier = priorityTierFor(score);

  useClickOutside(ref, () => setOpen(false), open);

  return (
    <div
      className="relative inline-block align-middle mr-2"
      ref={ref}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
    >
      <button
        type="button"
        title={`Priority: ${tier.label} — click to re-prioritize`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="inline-flex items-center gap-1 p-1 -m-1 rounded-full hover:bg-slate-100"
      >
        <span className={`inline-block w-2 h-2 rounded-full ${tier.dotClass}`} />
        {showLabel && tier.score !== 100 && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{tier.label}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 min-w-[160px] bg-white border border-slate-200 rounded-lg shadow-lg p-1.5">
          {PRIORITY_TIERS.map((t) => (
            <button
              key={t.score}
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(t.score); setOpen(false); }}
              className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs hover:bg-slate-50"
            >
              <span className={`inline-block w-2 h-2 rounded-full ${t.dotClass}`} />
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
