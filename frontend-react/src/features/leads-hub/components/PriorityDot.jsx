import React, { useEffect, useId, useState } from 'react';
import { PRIORITY_TIERS, priorityTierFor } from '../constants';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/DropdownMenu';

// Independent per-row Radix DropdownMenu instances don't know about each
// other — Radix's layer-stack only auto-dismisses the topmost layer on an
// outside click, so opening a second row's menu doesn't close a first one
// that's already open (confirmed live: both stay open, stacked). Broadcast/
// listen on open so only the most-recently-opened one stays open, matching
// this component's pre-Radix useClickOutside version's behavior. Mirrors
// the existing 'alternate:toast' event-bus convention (Toast.jsx).
const OPENED_EVENT = 'alternate:priority-dot-opened';

/** Small colored dot (not a pill) — priority sits next to Status without
 * competing with it visually. Click opens a tiny re-prioritize menu.
 *
 * `showLabel` (SDR/AE-only, see LeadRow.jsx) additionally renders the tier
 * name next to the dot for non-High tiers — classic shows this as a static,
 * unclickable badge; here it's inside the same button as the dot, so
 * clicking the label opens the same re-prioritize menu instead of being
 * pure decoration. */
export function PriorityDot({ score, onChange, showLabel = false }) {
  const tier = priorityTierFor(score);
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOtherOpened = (e) => { if (e.detail !== id) setOpen(false); };
    window.addEventListener(OPENED_EVENT, onOtherOpened);
    return () => window.removeEventListener(OPENED_EVENT, onOtherOpened);
  }, [id]);

  const handleOpenChange = (next) => {
    setOpen(next);
    if (next) window.dispatchEvent(new CustomEvent(OPENED_EVENT, { detail: id }));
  };

  return (
    // modal={false}: many of these render at once (one per row) and clicking
    // a different row's dot must open its menu even while another row's is
    // still open — Radix's default modal DropdownMenu blocks pointer events
    // on the rest of the page while open, which would make every other row's
    // dot unclickable until the current menu closes.
    <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`Priority: ${tier.label} — click to re-prioritize`}
          onClick={(e) => e.stopPropagation()}
          className="relative inline-flex items-center gap-1 p-1 -m-1 mr-2 rounded-full hover:bg-slate-100 align-middle"
        >
          <span className={`inline-block w-2 h-2 rounded-full ${tier.dotClass}`} />
          {showLabel && tier.score !== 100 && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{tier.label}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {PRIORITY_TIERS.map((t) => (
          <DropdownMenuItem
            key={t.score}
            onClick={(e) => e.stopPropagation()}
            onSelect={() => onChange(t.score)}
            className="gap-2 text-xs"
          >
            <span className={`inline-block w-2 h-2 rounded-full ${t.dotClass}`} />
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
