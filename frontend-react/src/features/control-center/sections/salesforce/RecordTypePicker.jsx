import React, { useMemo, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Checkbox } from '../../../../components/ui/Checkbox';
import { SearchInput } from '../../../../components/ui/SearchInput';

const SEARCH_FROM = 8;     // below this many record types a search box is just noise

/** Which Salesforce record types the sync reads. Nothing ticked means ALL of them — said out loud, because an empty
 *  list reads as "sync nothing". `selected` is a Set of ids. */
export function RecordTypePicker({ types, selected, onChange, loadFailed }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? types.filter((t) => t.name.toLowerCase().includes(q)) : types;
  }, [types, query]);

  if (types === null) return <p className="text-xs text-slate-400">Loading…</p>;
  if (!types.length) return <p className="text-xs text-slate-400">{loadFailed ? 'Could not load record types — check the Salesforce connection.' : 'This Salesforce org has no custom record types, so every lead is read.'}</p>;

  const toggle = (id) => { const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); onChange(next); };
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50/60">
        <span className="text-xs text-slate-600">
          {selected.size === 0 ? `All ${types.length} record types are read` : `${selected.size} of ${types.length} selected — only these are read`}
        </span>
        <div className="flex items-center gap-1">
          {types.length >= SEARCH_FROM && <SearchInput className="w-48" placeholder="Search…" aria-label="Search record types" value={query} onChange={(e) => setQuery(e.target.value)} />}
          <Button size="sm" variant="ghost" onClick={() => onChange(new Set(types.map((t) => t.id)))} disabled={selected.size === types.length}>Select all</Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(new Set())} disabled={selected.size === 0}>Clear</Button>
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
        {shown.map((t) => <Checkbox key={t.id} checked={selected.has(t.id)} onChange={() => toggle(t.id)} label={t.name} />)}
        {!shown.length && <p className="text-xs text-slate-400 col-span-full">No record type matches “{query}”.</p>}
      </div>
    </div>
  );
}
