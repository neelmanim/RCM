import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLUMN_DEFS, COLUMN_BY_KEY, DEFAULT_COLUMN_ORDER } from './columns';

const COLUMN_LAYOUT_KEY = 'leadsHub.columnLayout';
const MIN_COLUMN_WIDTH = 70;

function loadColumnLayout() {
  try {
    const raw = window.localStorage.getItem(COLUMN_LAYOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistColumnLayout(layout) {
  try { window.localStorage.setItem(COLUMN_LAYOUT_KEY, JSON.stringify(layout)); } catch { /* storage unavailable — layout just won't persist */ }
}

// A column added/removed from COLUMN_DEFS after a layout was already saved
// shouldn't produce a missing or a stuck-forever-hidden column — reconcile the
// persisted order against the current column set every time it's read.
function reconcileOrder(savedOrder) {
  if (!Array.isArray(savedOrder)) return DEFAULT_COLUMN_ORDER;
  const known = new Set(DEFAULT_COLUMN_ORDER);
  const kept = savedOrder.filter((k) => known.has(k));
  const missing = DEFAULT_COLUMN_ORDER.filter((k) => !kept.includes(k));
  return [...kept, ...missing];
}

// A schema-drifted (valid JSON, wrong shape) localStorage value would
// otherwise crash the whole Leads Hub with no ErrorBoundary anywhere to
// catch it — same class of gap `reconcileOrder` above already guards
// against for `order`, just never applied to `widths`/`hidden`.
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function reconcileWidths(savedWidths) {
  return isPlainObject(savedWidths) ? savedWidths : {};
}
function reconcileHidden(savedHidden) {
  return new Set(Array.isArray(savedHidden) ? savedHidden : []);
}

/**
 * Column order/width/visibility for the Leads table — drag to reorder, drag
 * the header border to resize, a Columns menu to hide/show. Persisted
 * per-browser in localStorage (same durability tier as Saved Views), separate
 * from the sessionStorage-backed transient filter/search state in
 * useLeadsList, since a column layout is a personal preference someone sets
 * once, not per-visit state.
 */
export function useColumnLayout(isAdmin = true) {
  const saved = loadColumnLayout(); // only consumed below, by lazy useState initializers

  const [order, setOrder] = useState(() => reconcileOrder(saved?.order));
  const [widths, setWidths] = useState(() => reconcileWidths(saved?.widths));
  const [hidden, setHidden] = useState(() => reconcileHidden(saved?.hidden));

  useEffect(() => {
    persistColumnLayout({ order, widths, hidden: Array.from(hidden) });
  }, [order, widths, hidden]);

  // "Assigned to" reassignment is an admin-only capability server-side (see
  // useLeadsList.js) — a non-admin would see a column whose dropdown is
  // always empty and whose edits always 403. Excluded here, not just at the
  // render call site, so it also never appears as a toggle in the Columns
  // menu (allColumns below) that would silently do nothing if enabled.
  const roleFilter = (k) => isAdmin || k !== 'assignedTo';

  const columns = useMemo(
    () => order.filter((k) => !hidden.has(k) && roleFilter(k)).map((k) => COLUMN_BY_KEY.get(k)).filter(Boolean),
    [order, hidden, isAdmin]
  );
  const allColumns = useMemo(() => COLUMN_DEFS.filter((c) => roleFilter(c.key)), [isAdmin]);

  const reorder = useCallback((draggedKey, targetKey) => {
    if (draggedKey === targetKey) return;
    setOrder((o) => {
      const next = o.filter((k) => k !== draggedKey);
      // Insert right AFTER the drop target — with "before" semantics, dragging
      // an item onto its immediate right neighbor is a no-op (it re-inserts at
      // the same spot it started from), which reads as the drag doing nothing.
      const targetIdx = next.indexOf(targetKey);
      next.splice(targetIdx + 1, 0, draggedKey);
      return next;
    });
  }, []);

  const resize = useCallback((key, width) => {
    setWidths((w) => ({ ...w, [key]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)) }));
  }, []);

  const toggleHidden = useCallback((key) => {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    setOrder(DEFAULT_COLUMN_ORDER);
    setWidths({});
    setHidden(new Set());
  }, []);

  const widthOf = useCallback((key) => widths[key] || COLUMN_BY_KEY.get(key)?.defaultWidth || 120, [widths]);

  return { columns, allColumns, order, hidden, reorder, resize, widthOf, toggleHidden, resetLayout };
}
