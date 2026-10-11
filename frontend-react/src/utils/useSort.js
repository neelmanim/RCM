import { useState, useCallback } from 'react';

/** `{key, dir}` sort state + toggle, shared by every SortableTableHeader
 *  table — was copy-pasted verbatim (2 lines apiece) across ~11 features.
 *  Third return value resets to `initial`, for callers that clear sort
 *  alongside filters (e.g. switching tabs). */
export function useSort(initial = { key: null, dir: 'asc' }) {
  const [sort, setSort] = useState(initial);
  const toggleSort = useCallback((key) => {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  }, []);
  const resetSort = useCallback(() => setSort(initial), [initial]);
  return [sort, toggleSort, resetSort];
}
