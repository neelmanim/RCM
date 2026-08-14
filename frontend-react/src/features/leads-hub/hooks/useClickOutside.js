import { useEffect, useRef } from 'react';

// Every interactive cell in this table stops click propagation before it
// reaches `document` (so the row's own onClick doesn't also navigate to the
// lead) — which means click-outside detection alone never sees a click that
// lands on a DIFFERENT row's popover trigger. Without this broadcast,
// opening Row 2's Priority menu left Row 1's still open, and both could
// stack up indefinitely. A shared window event — same CustomEvent-bus
// pattern already used for `rcm:toast` elsewhere in this codebase —
// lets every popover close whenever a different one opens, regardless of
// whether the triggering click ever reached `document`.
const POPOVER_OPENED_EVENT = 'leadhub:popover-opened';
let nextPopoverId = 0;

/** Call from a click handler that opens a popover/inline-select with no
 * managed open/close state of its own (e.g. a native <select> overlay) —
 * tells every OTHER popover using useClickOutside to close. */
export function closeOtherPopovers() {
  window.dispatchEvent(new CustomEvent(POPOVER_OPENED_EVENT, { detail: --nextPopoverId }));
}

/** Calls onOutside when a click lands outside the element `ref` points to,
 * or when a DIFFERENT popover opens anywhere in the table — shared by every
 * popover in this feature (FilterBar, PriorityDot, ColumnsMenu, the bulk-bar
 * pickers). Pass the popover's own open/closed boolean as `isOpen` so it can
 * both broadcast (when it opens) and listen (to close itself when some other
 * popover broadcasts) via the same mechanism. */
export function useClickOutside(ref, onOutside, isOpen) {
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = ++nextPopoverId;

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside(); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [ref, onOutside]);

  useEffect(() => {
    if (!isOpen) return;
    window.dispatchEvent(new CustomEvent(POPOVER_OPENED_EVENT, { detail: idRef.current }));
    const closeIfNotMine = (e) => { if (e.detail !== idRef.current) onOutside(); };
    window.addEventListener(POPOVER_OPENED_EVENT, closeIfNotMine);
    return () => window.removeEventListener(POPOVER_OPENED_EVENT, closeIfNotMine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
