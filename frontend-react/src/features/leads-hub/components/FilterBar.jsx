import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Check, X, ListPlus, Loader2 } from 'lucide-react';
import { STATUSES, SOURCES } from '../constants';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { Calendar } from '../../../components/ui/Calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/Popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/DropdownMenu';
import { CallListsService } from '../../../services/api';

function FilterOptions({ def, value, onPick, onToggleMulti, uploadLogs }) {
  const [search, setSearch] = useState('');

  if (def.type === 'list-multi') {
    if (def.options.length === 0) {
      return <div className="px-2.5 py-2 text-xs text-slate-400">{`No ${def.label.toLowerCase()}s yet.`}</div>;
    }
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
  const toIso = (date) => {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const range = { from: from ? new Date(`${from}T00:00:00`) : undefined, to: to ? new Date(`${to}T00:00:00`) : undefined };
  return (
    <div className="p-1">
      <Calendar
        mode="range"
        selected={range}
        defaultMonth={range.from}
        onSelect={(next) => { setFrom(toIso(next?.from)); setTo(toIso(next?.to)); }}
      />
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

// "Save current filter as a Call List" — resolves the FULL filtered set
// (not just the current page) via list.saveFilterAsCallList, after a
// confirmation showing the exact count (list.total, from the normal
// paginated fetch — no extra count-only request needed). Only shown once at
// least one filter is active; "save everything" with zero filters would
// mean snapshotting the entire org, so this stays gated behind activeFilterKeys.
function SaveFilterAsCallList({ total, onSave, onToast }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState(null);
  const [newName, setNewName] = useState('');
  const [pending, setPending] = useState(null); // call list object awaiting confirmation
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && lists === null) {
      CallListsService.list().then((r) => setLists(r.call_lists || [])).catch(() => setLists([]));
    }
  }, [open, lists]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const created = await CallListsService.create(name);
    setNewName('');
    setOpen(false);
    setPending(created);
  };

  const confirmSave = async () => {
    setBusy(true);
    try {
      const result = await onSave(pending);
      onToast(`Added ${result.added} lead(s) to "${pending.name}"` +
        (result.already_present ? ` — ${result.already_present} already in the list` : ''));
      setPending(null);
    } catch {
      onToast('Failed to save this filter as a Call List — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button"
            className="inline-flex items-center gap-1.5 border border-slate-300 text-slate-600 hover:text-slate-800 hover:border-slate-400 rounded-md px-2.5 py-1.5 text-xs font-semibold">
            <ListPlus size={13} /> Save as Call List
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="min-w-[240px] max-h-[300px] overflow-y-auto p-1.5">
          {lists === null && <div className="px-2.5 py-2 text-xs text-slate-400">Loading…</div>}
          {lists?.length === 0 && <div className="px-2.5 py-2 text-xs text-slate-400">No Call Lists yet.</div>}
          {lists?.map((cl) => (
            <button key={cl.id} type="button" onClick={() => { setOpen(false); setPending(cl); }}
              className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-slate-50">
              <span className="truncate">{cl.name}</span>
              <span className="shrink-0 text-slate-400">{cl.lead_count}</span>
            </button>
          ))}
          <div className="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-slate-100">
            <input
              type="text" placeholder="New list name…" value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-md border border-slate-200 bg-slate-50 focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
            />
            <button type="button" onClick={handleCreate} disabled={!newName.trim()}
              className="shrink-0 px-2.5 py-1.5 text-xs font-bold rounded-md bg-blue-600 text-white disabled:opacity-40">
              Create
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title="Save filter as Call List"
        message={pending ? `This will add ${total} lead(s) matching your current filters to "${pending.name}" — continue?` : ''}
        confirmLabel="Add leads"
        onConfirm={confirmSave}
        loading={busy}
      />
    </>
  );
}

export function FilterBar({ list, onToast }) {
  const { filters, setFilter, toggleMultiFilter, clearFilter, activeFilterKeys, addFilterKey, removeFilterKey, clearAllFilters, searchInput, setSearchInput, tags, refreshTags, sdrs, companies, uploadLogs, outcomes, isAdmin, total, saveFilterAsCallList } = list;

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
  useEffect(() => { if (openKey === 'tag') refreshTags?.(); }, [openKey, refreshTags]);
  const [addOpen, setAddOpen] = useState(false);
  const pendingOpenKey = useRef(null);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-3.5">
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-[250px]">
        {list.loading
          ? <Loader2 size={14} strokeWidth={2.25} className="text-blue-500 shrink-0 animate-spin" aria-label="Searching" />
          : <Search size={14} strokeWidth={2.25} className="text-slate-400 shrink-0" />}
        <input
          type="text" placeholder="Search name, email, or company…" value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full text-sm outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
        />
      </div>
      <div className="w-px self-stretch bg-slate-200 my-0.5" />

      {FILTER_DEFS.filter((d) => activeFilterKeys.includes(d.key)).map((def) => (
        <Popover key={def.key} open={openKey === def.key} onOpenChange={(o) => setOpenKey(o ? def.key : null)}>
          <PopoverTrigger asChild>
            <button
              type="button"
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
          </PopoverTrigger>
          <PopoverContent align="start" className="min-w-[220px] max-h-[300px] overflow-y-auto p-1.5">
            {def.type === 'date' ? (
              <DateRangePopover
                dateFrom={filters.dateFrom} dateTo={filters.dateTo}
                onApply={(from, to) => { setFilter('dateFrom', from); setFilter('dateTo', to); setOpenKey(null); }}
              />
            ) : (
              <FilterOptions
                def={def} value={filters[def.key]} uploadLogs={uploadLogs}
                onPick={(v) => { setFilter(def.key, v); setOpenKey(null); }}
                onToggleMulti={(v) => toggleMultiFilter(def.key, v)}
              />
            )}
          </PopoverContent>
        </Popover>
      ))}

      <DropdownMenu open={addOpen} onOpenChange={setAddOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 border border-dashed border-slate-400 text-slate-600 hover:text-slate-800 hover:border-slate-500 rounded-md px-2.5 py-1.5 text-xs font-semibold"
          >
            + Filter
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[190px]"
          onCloseAutoFocus={(e) => {
            // Opening this filter's own Popover from onSelect (same tick as
            // this menu's close) races Radix's own close-focus-return and
            // the Popover never actually opens — a known Radix chained-
            // overlay gotcha. onCloseAutoFocus is Radix's own extension point
            // for exactly this: fires once the close lifecycle settles, so
            // preventing the default focus-return and opening the Popover
            // here is deterministic instead of a fixed-delay guess.
            if (pendingOpenKey.current) {
              e.preventDefault();
              setOpenKey(pendingOpenKey.current);
              pendingOpenKey.current = null;
            }
          }}
        >
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400 px-2.5 py-1">Add a filter</div>
          {FILTER_DEFS.map((def) => {
            const added = activeFilterKeys.includes(def.key);
            return (
              <DropdownMenuItem
                key={def.key}
                onSelect={() => {
                  if (added) return;
                  addFilterKey(def.key);
                  pendingOpenKey.current = def.key;
                }}
                className={`justify-between text-xs ${added ? 'text-slate-300' : ''}`}
              >
                {def.label}{added && <Check size={13} strokeWidth={2.5} />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {activeFilterKeys.length > 0 && (
        <SaveFilterAsCallList total={total} onSave={saveFilterAsCallList} onToast={onToast} />
      )}
      {activeFilterKeys.length > 0 && (
        <button type="button" onClick={clearAllFilters} className="text-xs font-bold text-red-600 underline underline-offset-2">
          Clear all
        </button>
      )}
    </div>
  );
}
