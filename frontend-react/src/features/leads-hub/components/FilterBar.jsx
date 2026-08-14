import React, { useState, useRef, useMemo } from 'react';
import { Search, Check, X } from 'lucide-react';
import { STATUSES, SOURCES } from '../constants';
import { useClickOutside } from '../hooks/useClickOutside';

function Popover({ def, value, onPick, onToggleMulti, uploadLogs }) {
  const [search, setSearch] = useState('');

  if (def.type === 'list-multi') {
    return (
      <>
        {def.options.map((o) => {
          const picked = value.includes(o);
          return (
            <button key={o} type="button" onClick={() => onToggleMulti(o)}
              className={`w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-xs ${picked ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}>
              <span className={`inline-flex w-3.5 h-3.5 rounded border ${picked ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`} />
              {o}
            </button>
          );
        })}
      </>
    );
  }
  if (def.type === 'list') {
    return (
      <>
        <button type="button" onClick={() => onPick('')}
          className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs ${!value ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}>
          All
        </button>
        {def.options.map((o) => {
          const optValue = typeof o === 'object' ? o.value : o;
          const optLabel = typeof o === 'object' ? o.label : o;
          return (
            <button key={optValue} type="button" onClick={() => onPick(optValue)}
              className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs ${value === optValue ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}>
              {optLabel}
            </button>
          );
        })}
      </>
    );
  }
  if (def.type === 'upload') {
    const q = search.trim().toLowerCase();
    const filtered = uploadLogs.filter((u) => !q || `${u.filename} ${u.uploaded_by}`.toLowerCase().includes(q));
    return (
      <>
        <input
          type="text" placeholder="Search by file name…" value={search}
          onChange={(e) => setSearch(e.target.value)} onClick={(e) => e.stopPropagation()}
          className="w-full mb-1 px-2.5 py-1.5 text-xs rounded-md border border-slate-200 bg-slate-50 focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
        />
        <button type="button" onClick={() => onPick('')}
          className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs ${!value ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}>
          All uploads
        </button>
        {filtered.length === 0 && <div className="px-2.5 py-2 text-xs text-slate-400">No files match.</div>}
        {filtered.map((u) => (
          <button key={u.id} type="button" onClick={() => onPick(u.id)}
            className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex flex-col ${value === u.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50'}`}>
            <span className="font-semibold">{u.filename}</span>
            <span className="text-[10.5px] text-slate-400">{u.uploaded_by} · {u.created} leads</span>
          </button>
        ))}
      </>
    );
  }
  return null;
}

function DateRangePopover({ dateFrom, dateTo, onApply }) {
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  return (
    <div className="p-1">
      <div className="flex gap-2">
        <label className="flex-1 text-[10px] font-bold uppercase text-slate-400">
          From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="block w-full mt-1 px-1.5 py-1 text-xs border border-slate-200 rounded" />
        </label>
        <label className="flex-1 text-[10px] font-bold uppercase text-slate-400">
          To<input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="block w-full mt-1 px-1.5 py-1 text-xs border border-slate-200 rounded" />
        </label>
      </div>
      <button type="button" onClick={() => onApply(from, to)}
        className="w-full mt-2 py-1.5 rounded-md bg-blue-600 text-white text-xs font-bold">Apply</button>
    </div>
  );
}

function chipLabel(def, filters, uploadLogs) {
  if (def.type === 'list-multi') {
    const vals = filters[def.key];
    if (!vals.length) return def.label;
    return `${def.label}: ${vals[0]}${vals.length > 1 ? ` +${vals.length - 1}` : ''}`;
  }
  if (def.key === 'dateFrom') {
    if (!filters.dateFrom && !filters.dateTo) return def.label;
    return `Created: ${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`;
  }
  if (def.key === 'uploadLogId') {
    if (!filters.uploadLogId) return def.label;
    const log = uploadLogs.find((u) => u.id === filters.uploadLogId);
    return log ? log.filename : def.label;
  }
  const v = filters[def.key];
  if (!v) return def.label;
  const opt = (def.options || []).find((o) => (typeof o === 'object' ? o.value === v : o === v));
  const optLabel = opt ? (typeof opt === 'object' ? opt.label : opt) : v;
  return `${def.label}: ${optLabel}`;
}

export function FilterBar({ list }) {
  const { filters, setFilter, toggleMultiFilter, clearFilter, activeFilterKeys, addFilterKey, removeFilterKey, clearAllFilters, searchInput, setSearchInput, tags, sdrs, companies, uploadLogs, outcomes, isAdmin } = list;

  const FILTER_DEFS = useMemo(() => [
    { key: 'status', label: 'Status', type: 'list-multi', options: ['Unassigned', ...STATUSES] },
    { key: 'tag', label: 'Tag', type: 'list-multi', options: tags.map((t) => t.name) },
    { key: 'source', label: 'Source', type: 'list', options: SOURCES },
    // Upload-batch filtering relies on GET /leads/upload-logs, which is
    // admin-only server-side (see useLeadsList.js) — for a non-admin this
    // would always be a permanently-empty dropdown, so skip it entirely.
    ...(isAdmin ? [{ key: 'uploadLogId', label: 'Upload', type: 'upload' }] : []),
    { key: 'assignedTo', label: 'Assigned to', type: 'list', options: ['Unassigned only', ...sdrs.map((s) => ({ value: s.id, label: s.name }))] },
    { key: 'outcome', label: 'Last outcome', type: 'list', options: outcomes },
    { key: 'company', label: 'Company', type: 'list', options: companies },
    { key: 'dateFrom', label: 'Created', type: 'date' },
  ], [tags, sdrs, companies, outcomes, isAdmin]);

  const [openKey, setOpenKey] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const barRef = useRef(null);
  useClickOutside(barRef, () => { setOpenKey(null); setAddOpen(false); }, openKey !== null || addOpen);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-3.5" ref={barRef}>
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-[250px]">
        <Search size={14} strokeWidth={2.25} className="text-slate-400 shrink-0" />
        <input
          type="text" placeholder="Search name, email, or company…" value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full text-sm outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
        />
      </div>
      <div className="w-px self-stretch bg-slate-200 my-0.5" />

      {FILTER_DEFS.filter((d) => activeFilterKeys.includes(d.key)).map((def) => (
        <div key={def.key} className="relative">
          <button
            type="button"
            onClick={() => setOpenKey((k) => (k === def.key ? null : def.key))}
            className="inline-flex items-center gap-1.5 border border-blue-200 bg-blue-50 text-blue-700 rounded-md px-2.5 py-1.5 text-xs font-bold"
          >
            {chipLabel(def, filters, uploadLogs)}
            <span
              role="button" tabIndex={-1} aria-label={`Remove ${def.label} filter`}
              onClick={(e) => { e.stopPropagation(); removeFilterKey(def.key); }}
              className="opacity-60 hover:opacity-100"
            >
              <X size={11} strokeWidth={2.5} />
            </span>
          </button>
          {openKey === def.key && (
            <div className="absolute z-40 top-full left-0 mt-1.5 min-w-[220px] max-h-[300px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1.5">
              {def.type === 'date' ? (
                <DateRangePopover
                  dateFrom={filters.dateFrom} dateTo={filters.dateTo}
                  onApply={(from, to) => { setFilter('dateFrom', from); setFilter('dateTo', to); setOpenKey(null); }}
                />
              ) : (
                <Popover
                  def={def} value={filters[def.key]} uploadLogs={uploadLogs}
                  onPick={(v) => { setFilter(def.key, v); setOpenKey(null); }}
                  onToggleMulti={(v) => toggleMultiFilter(def.key, v)}
                />
              )}
            </div>
          )}
        </div>
      ))}

      <div className="relative">
        <button
          type="button" onClick={() => setAddOpen((o) => !o)}
          className="inline-flex items-center gap-1 border border-dashed border-slate-400 text-slate-600 hover:text-slate-800 hover:border-slate-500 rounded-md px-2.5 py-1.5 text-xs font-semibold"
        >
          + Filter
        </button>
        {addOpen && (
          <div className="absolute z-40 top-full left-0 mt-1.5 min-w-[190px] bg-white border border-slate-200 rounded-lg shadow-lg p-1.5">
            <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400 px-2.5 py-1">Add a filter</div>
            {FILTER_DEFS.map((def) => {
              const added = activeFilterKeys.includes(def.key);
              return (
                <button
                  key={def.key} type="button"
                  onClick={() => { setAddOpen(false); if (!added) { addFilterKey(def.key); setOpenKey(def.key); } }}
                  className={`w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded-md text-xs ${added ? 'text-slate-300' : 'hover:bg-slate-50'}`}
                >
                  {def.label}{added && <Check size={13} strokeWidth={2.5} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {activeFilterKeys.length > 0 && (
        <button type="button" onClick={clearAllFilters} className="text-xs font-bold text-red-600 underline underline-offset-2">
          Clear all
        </button>
      )}
    </div>
  );
}
