import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Workflow, Search, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { SkeletonTable } from '../../components/ui/Skeleton';
import { SalesJourneyService, PodsService } from '../../services/api';

const STATUS_VARIANT = { draft: 'default', active: 'success', paused: 'warning', archived: 'danger' };
const PAGE_SIZE = 10;

export function JourneyList({ onOpen }) {
  const [journeys, setJourneys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPodId, setNewPodId] = useState('');
  const [creating, setCreating] = useState(false);
  const [pods, setPods] = useState([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [deleteTarget, setDeleteTarget] = useState(null); // { ids, activeCounts: {id: count} }
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setJourneys(await SalesJourneyService.list());
    } catch (err) {
      setError('Failed to load cadences.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { PodsService.getAll().then(setPods).catch(() => {}); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await SalesJourneyService.create(newName.trim(), newPodId || null);
      try { window.mixpanel?.track('Cadence Created', { journey_id: created.id }); } catch {}
      setShowCreate(false);
      setNewName('');
      setNewPodId('');
      onOpen(created.id, created.name);
    } catch (err) {
      setError('Failed to create cadence.');
    } finally {
      setCreating(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return journeys.filter(j => {
      if (statusFilter && j.status !== statusFilter) return false;
      if (q && !j.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [journeys, search, statusFilter]);

  const filteredIds = useMemo(() => new Set(filtered.map(j => j.id)), [filtered]);

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  // A selection made under one search/status filter shouldn't silently carry
  // into a bulk delete after the filter changes — a lead-name search that no
  // longer matches a previously-selected cadence must drop it from
  // "N selected", or that cadence gets deleted without ever being visible
  // under the new filter.
  useEffect(() => {
    setSelected(prev => {
      const next = new Set([...prev].filter(id => filteredIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredIds]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSelected = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = paged.map(j => j.id);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      pageIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  // Fetch each journey's active-enrollment count before showing the confirm
  // dialog — /archive requires it echoed back (confirm_exit_count), same
  // safeguard as a single archive, so a bulk delete can't silently strand
  // in-flight enrollments across many cadences either.
  const openDeleteConfirm = async (ids) => {
    setError(null);
    try {
      const stats = await Promise.all(ids.map(id => SalesJourneyService.getStats(id)));
      const activeCounts = {};
      ids.forEach((id, i) => { activeCounts[id] = stats[i].active; });
      setDeleteTarget({ ids, activeCounts });
    } catch {
      setError('Failed to check enrollment status — try again.');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // allSettled, not all — a bulk delete's 2nd of 3 archive calls failing
      // must not leave the 1st (already archived server-side) silently
      // un-reflected in the list, and must not block retrying just the
      // failure instead of re-archiving cadences that already succeeded.
      const results = await Promise.allSettled(
        deleteTarget.ids.map(id => SalesJourneyService.archive(id, deleteTarget.activeCounts[id]))
      );
      const failedIds = deleteTarget.ids.filter((_, i) => results[i].status === 'rejected');
      const succeededCount = deleteTarget.ids.length - failedIds.length;
      if (succeededCount > 0) {
        try { window.mixpanel?.track('Cadence Deleted', { count: succeededCount, total_active_enrollments_exited: totalActiveEnrollments }); } catch {}
      }
      await load();
      if (failedIds.length > 0) {
        setError(`Failed to delete ${failedIds.length} cadence${failedIds.length > 1 ? 's' : ''} — try again.`);
        setDeleteTarget({ ids: failedIds, activeCounts: deleteTarget.activeCounts });
        setSelected(new Set(failedIds));
      } else {
        setDeleteTarget(null);
        setSelected(prev => new Set([...prev].filter(id => !deleteTarget.ids.includes(id))));
      }
    } catch {
      setError('Failed to delete — try again.');
    } finally {
      setDeleting(false);
    }
  };

  const totalActiveEnrollments = deleteTarget
    ? Object.values(deleteTarget.activeCounts).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="salesjourney-hub max-w-4xl mx-auto px-4 py-6 sm:px-6 sm:py-8 w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shrink-0">
            <Workflow size={20} className="text-white" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 m-0">Sales Cadences</h1>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Cadence
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {!loading && journeys.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search cadences by name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-blue-400"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600"
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
          {selected.size > 0 && (
            <Button variant="secondary" size="sm" onClick={() => openDeleteConfirm([...selected])} className="gap-1.5 text-red-600">
              <Trash2 size={13} /> Delete {selected.size} selected
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={4} />
      ) : journeys.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-16">No cadences yet — create one to get started.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-16">No cadences match this filter.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1 mb-1">
            <input
              type="checkbox"
              checked={paged.length > 0 && paged.every(j => selected.has(j.id))}
              onChange={toggleSelectAllOnPage}
              aria-label="Select all on this page"
            />
            <span className="text-xs text-slate-400">Select all on this page</span>
          </div>
          <div className="space-y-2">
            {paged.map((j) => (
              <Card key={j.id} className="hover:border-blue-300 transition-colors">
                <div className="flex items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(j.id)}
                    onChange={(e) => { e.stopPropagation(); toggleSelected(j.id); }}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${j.name}`}
                  />
                  <div
                    className="flex-1 flex items-center justify-between cursor-pointer min-w-0"
                    role="button" tabIndex={0}
                    onClick={() => onOpen(j.id, j.name)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOpen(j.id, j.name); }}
                  >
                    <span className="text-sm font-semibold text-slate-800 truncate">{j.name}</span>
                    <Badge variant={STATUS_VARIANT[j.status] || 'default'} className="capitalize shrink-0 ml-2">{j.status}</Badge>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); openDeleteConfirm([j.id]); }}
                    title="Delete cadence"
                    className="text-slate-300 hover:text-red-600 shrink-0"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-500 mt-4">
              <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft size={14} />
                </Button>
                <span className="px-1">Page {page} of {totalPages}</span>
                <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Cadence" maxWidth="max-w-sm">
        <Input
          label="Cadence name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. SDR Outreach Sequence"
          autoFocus
        />
        <div className="mt-3">
          <label className="block text-sm font-medium text-slate-700 mb-1">Pod (optional)</label>
          <select
            className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white outline-none focus:border-blue-500"
            value={newPodId}
            onChange={(e) => setNewPodId(e.target.value)}
          >
            <option value="">All pods</option>
            {pods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <p className="text-xs text-slate-400 mt-1">Only leads in this pod can be auto-enrolled. Can be changed later.</p>
        </div>
        <Button className="w-full mt-3" onClick={handleCreate} disabled={creating || !newName.trim()}>
          {creating ? 'Creating…' : 'Create'}
        </Button>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete cadence" maxWidth="max-w-sm">
        {deleteTarget && (
          <>
            <p className="text-sm text-slate-600 mb-1">
              {deleteTarget.ids.length === 1
                ? 'Delete this cadence?'
                : `Delete ${deleteTarget.ids.length} cadences?`}
            </p>
            {totalActiveEnrollments > 0 && (
              <p className="text-sm text-amber-600 mb-3">
                {totalActiveEnrollments} lead(s) currently enrolled will be exited from {deleteTarget.ids.length === 1 ? 'it' : 'them'}.
              </p>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
              <Button variant="secondary" size="sm" onClick={confirmDelete} disabled={deleting} className="text-red-600">
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
