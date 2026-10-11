import { useMemo, useState } from 'react';
import { useSort } from './useSort';

/** Search + sort + page for a list that is already in memory — what a settings table needs once it can grow.
 *  `searchKeys` are the row fields the search box looks in; `sortValue(row, key)` may override how a column sorts. */
export function useTableView(rows, { searchKeys = [], pageSize = 8, sortValue } = {}) {
  const [query, setQueryRaw] = useState('');
  const [sort, toggle] = useSort();
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q))) : rows;
  }, [rows, query, searchKeys]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const val = (r) => {
      const v = sortValue ? sortValue(r, sort.key) : r[sort.key];
      return typeof v === 'string' ? v.toLowerCase() : (typeof v === 'boolean' ? Number(v) : (v ?? ''));
    };
    const out = [...filtered].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0));
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [filtered, sort, sortValue]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages);
  return {
    shown: sorted.slice((current - 1) * pageSize, current * pageSize),
    total: sorted.length,
    query, setQuery: (q) => { setQueryRaw(q); setPage(1); },
    sort, toggleSort: (k) => { toggle(k); setPage(1); },
    page: current, pages, pageSize, setPage,
  };
}
