import React, { useState, useRef, useMemo, useEffect } from 'react';
import { X, Workflow } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { SalesJourneyService } from '../../../services/api';

/** Custom searchable SDR picker — a native <select> with 20+ names opens as
 * unstyled OS dropdown chrome that clashes with the dark bar around it.
 * Same visual language as FilterBar's upload search popover. */
// Capacity fields (active_leads/max_active) already come back on every user
// from GET /admin/users — classic's assign picker shows them and disables
// at-cap SDRs; sorting most-available-first (rather than whatever order the
// endpoint returns) is what actually makes that capacity info useful for
// spreading load, not just informational.
function withCapacity(s) {
  const active = s.active_leads ?? 0;
  const max = s.max_active ?? 5;
  return { ...s, active, max, atCap: active >= max };
}

function AssigneePicker({ sdrs, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);

  const ranked = useMemo(
    () => [...sdrs].map(withCapacity).sort((a, b) => (a.active / a.max) - (b.active / b.max)),
    [sdrs]
  );
  const selectedName = ranked.find((s) => s.id === value)?.name;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ranked.filter((s) => s.name.toLowerCase().includes(q)) : ranked;
  }, [ranked, search]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="bg-white/10 border border-white/20 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap max-w-[160px] truncate text-white">
        {selectedName || 'Assign to…'}
      </button>
      {open && (
        <div className="absolute z-50 bottom-full left-0 mb-1.5 w-[220px] max-h-[260px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1.5 text-slate-700">
          <input
            type="text" placeholder="Search SDR…" value={search} autoFocus
            onChange={(e) => setSearch(e.target.value)}
            className="w-full mb-1 px-2.5 py-1.5 text-xs rounded-md border border-slate-200 bg-slate-50 focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
          />
          {filtered.length === 0 && <div className="px-2.5 py-2 text-xs text-slate-400">No SDRs match.</div>}
          {filtered.map((s) => (
            <button key={s.id} type="button" disabled={s.atCap} onClick={() => { onChange(s.id); setOpen(false); setSearch(''); }}
              className={`w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded-md text-xs ${s.atCap ? 'text-slate-300 cursor-not-allowed' : value === s.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}>
              <span className="truncate">{s.name}</span>
              <span className="shrink-0 font-mono">{s.active}/{s.max}{s.atCap ? ' — FULL' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Enroll in Journey — mirrors AssigneePicker's dropdown shape, fetches the
// journey list lazily on first open rather than on every BulkActionBar mount
// (this bar renders/re-renders far more often than a user actually enrolls).
function JourneyPicker({ onEnroll }) {
  const [open, setOpen] = useState(false);
  const [journeys, setJourneys] = useState(null); // null = not yet loaded
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);

  useEffect(() => {
    if (open && journeys === null) {
      SalesJourneyService.list()
        .then((all) => setJourneys(all.filter((j) => j.status === 'active')))
        .catch(() => setJourneys([]));
    }
  }, [open, journeys]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap text-white">
        <Workflow size={13} /> Enroll in Cadence
      </button>
      {open && (
        <div className="absolute z-50 bottom-full left-0 mb-1.5 w-[220px] max-h-[260px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1.5 text-slate-700">
          {journeys === null && <div className="px-2.5 py-2 text-xs text-slate-400">Loading…</div>}
          {journeys?.length === 0 && <div className="px-2.5 py-2 text-xs text-slate-400">No published cadences yet.</div>}
          {journeys?.map((j) => (
            <button key={j.id} type="button" onClick={() => { onEnroll(j); setOpen(false); }}
              className="w-full text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-slate-50 truncate">
              {j.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function BulkActionBar({ list, onToast, canDelete, canEnrollJourney }) {
  const { selected, total, clearSelection, sdrs, bulkAssign, bulkUnassign, bulkDelete, selectAllMatching, selectingAllMatching } = list;
  const [assignee, setAssignee] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [enrollTarget, setEnrollTarget] = useState(null); // journey object pending confirmation
  const [enrollBusy, setEnrollBusy] = useState(false);

  if (selected.size === 0) return null;

  const handleEnrollPick = (journey) => {
    if (selected.size > 200) {
      onToast('Enroll in Cadence supports up to 200 leads at a time — narrow your selection.');
      return;
    }
    setEnrollTarget(journey);
  };
  const confirmEnroll = async () => {
    setEnrollBusy(true);
    try {
      const result = await SalesJourneyService.enroll(enrollTarget.id, Array.from(selected));
      onToast(`Enrolled ${result.enrolled}/${result.requested} lead(s) into "${enrollTarget.name}"` +
        (result.skipped.length ? ` — ${result.skipped.length} skipped` : ''));
      setEnrollTarget(null);
    } catch (err) {
      onToast('Failed to enroll leads — please try again.');
    } finally {
      setEnrollBusy(false);
    }
  };

  const handleAssign = async () => {
    if (!assignee) { onToast('Pick an SDR first.'); return; }
    try {
      const result = await bulkAssign(assignee);
      onToast(result.message);
      setAssignee('');
    } catch (err) {
      onToast('Failed to assign leads — please try again.');
    }
  };
  const handleUnassign = async () => {
    try {
      const result = await bulkUnassign();
      onToast(result.message);
    } catch (err) {
      onToast('Failed to unassign leads — please try again.');
    }
  };
  const confirmDelete = async () => {
    setDeleteBusy(true);
    try {
      const result = await bulkDelete();
      onToast(result.message);
      setDeleteConfirmOpen(false);
    } catch (err) {
      onToast('Failed to delete leads — please try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-2xl text-xs max-w-[92vw]">
      <span className="font-bold whitespace-nowrap">{selected.size} selected</span>
      {selected.size < total && (
        <button type="button" onClick={selectAllMatching} disabled={selectingAllMatching}
          className="text-blue-300 underline underline-offset-2 font-semibold whitespace-nowrap disabled:opacity-60">
          {selectingAllMatching ? 'Fetching matching lead IDs…' : `Select all ${total} matching leads`}
        </button>
      )}
      <div className="w-px h-5 bg-white/20" />
      <AssigneePicker sdrs={sdrs} value={assignee} onChange={setAssignee} />
      <button type="button" onClick={handleAssign} className="bg-blue-600 rounded-lg px-3.5 py-1.5 font-bold whitespace-nowrap text-white">Assign</button>
      <div className="w-px h-5 bg-white/20" />
      <button type="button" onClick={handleUnassign} className="bg-white/10 border border-white/20 rounded-lg px-3.5 py-1.5 font-bold whitespace-nowrap text-white">Unassign</button>
      {canEnrollJourney && <div className="w-px h-5 bg-white/20" />}
      {canEnrollJourney && <JourneyPicker onEnroll={handleEnrollPick} />}
      {canDelete && (
        <button type="button" onClick={() => setDeleteConfirmOpen(true)} className="text-red-300 border border-red-400/40 rounded-lg px-3.5 py-1.5 font-bold whitespace-nowrap">Delete</button>
      )}
      <button type="button" onClick={clearSelection} aria-label="Clear selection" title="Clear selection"
        className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white ml-1">
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>

    {canDelete && (
    <ConfirmDialog
      open={deleteConfirmOpen}
      onClose={() => setDeleteConfirmOpen(false)}
      title="Delete leads"
      message={`Delete ${selected.size} lead(s)? This cannot be undone.`}
      confirmLabel="Delete"
      confirmVariant="danger"
      onConfirm={confirmDelete}
      loading={deleteBusy}
    />
    )}

    <ConfirmDialog
      open={!!enrollTarget}
      onClose={() => setEnrollTarget(null)}
      title="Enroll in Cadence"
      message={enrollTarget ? `Enroll ${selected.size} lead(s) into "${enrollTarget.name}"?` : ''}
      confirmLabel="Enroll"
      onConfirm={confirmEnroll}
      loading={enrollBusy}
    />
    </>
  );
}
