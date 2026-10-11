import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Workflow, Trash2, AlertTriangle, Copy } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { SearchInput } from '../../components/ui/SearchInput';
import { Checkbox } from '../../components/ui/Checkbox';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonTable, SkeletonCard, Skeleton } from '../../components/ui/Skeleton';
import { DonutSummaryCard } from '../../components/ui/DonutSummaryCard';
import { ReplyRateChart } from './ReplyRateChart';
import { SalesJourneyService, PodsService } from '../../services/api';

const STATUS_VARIANT = { draft: 'default', active: 'success', paused: 'warning', archived: 'danger' };
const STATUS_FILTER_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];
const PAGE_SIZE = 10;

// Cross-journey rollup — every role sees this, not just admins, per the
// transparency goal that also opened up read-only builder access.
// v13.0.6: one call to the bulk stats endpoint instead of N per-journey
// /stats calls (the old Promise.all below is what this replaced) — also
// the only place that can answer "which cadence performs best," which the
// enrollment-status donut alone never could (it only shows part-of-whole
// enrollment counts, not engagement).
function CadencePerformanceSummary({ journeys }) {
  const [byJourney, setByJourney] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    if (journeys.length === 0) { setByJourney({}); return; }
    SalesJourneyService.getStatsBulk(journeys.map((j) => j.id))
      .then((data) => { if (!cancelled) setByJourney(data.journeys || {}); })
      .catch(() => { if (!cancelled) setByJourney({}); });
    return () => { cancelled = true; };
  }, [journeys]);

  if (byJourney === null) {
    return (
      <SkeletonCard><div className="flex flex-col items-center gap-4"><Skeleton className="w-[140px] h-[140px] rounded-full" /></div></SkeletonCard>
    );
  }

  const sum = { active: 0, completed: 0, failed: 0, exited_early: 0, paused: 0 };
  Object.values(byJourney).forEach((s) => {
    sum.active += s.active || 0;
    sum.completed += s.completed || 0;
    sum.failed += s.failed || 0;
    sum.exited_early += s.exited_early || 0;
    sum.paused += s.paused || 0;
  });
  const segments = [
    { label: 'Active', value: sum.active, color: '#2563eb' },
    { label: 'Completed', value: sum.completed, color: '#16a34a' },
    { label: 'Failed', value: sum.failed, color: '#dc2626' },
    { label: 'Exited early', value: sum.exited_early, color: '#94a3b8' },
    { label: 'Paused', value: sum.paused, color: '#d97706' },
  ];

  // A donut can show parts-of-a-whole (enrollment status); it can't show
  // "cadence A beats cadence B" — that needs a ranking, not a chart.
  const ranked = journeys
    .map((j) => ({ id: j.id, name: j.name, engagement: byJourney[j.id]?.engagement }))
    .filter((r) => r.engagement && r.engagement.sent > 0)
    .sort((a, b) => b.engagement.reply_rate - a.engagement.reply_rate);

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-start">
      <DonutSummaryCard
        title="Enrollment outcomes"
        subtitle={`Across all ${journeys.length} cadence(s)`}
        segments={segments}
        size={140}
        strokeWidth={18}
      />
      {ranked.length > 0 && <ReplyRateChart ranked={ranked} />}
    </div>
  );
}

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
  const [mineOnly, setMineOnly] = useState(false);
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

  // Any Pod Admin+ can copy any cadence (they're org-readable); the copy is a
  // draft they own, opened straight away for editing.
  const handleDuplicate = async (j) => {
    try {
      const copy = await SalesJourneyService.duplicate(j.id);
      onOpen(copy.id, copy.name);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to duplicate cadence.');
    }
  };

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
      if (mineOnly && !j.is_mine) return false;
      // Archived cadences (often one-off QA/test artifacts) clutter the
      // default view — hidden unless the caller explicitly asks for them via
      // the status filter.
      if (!statusFilter && j.status === 'archived') return false;
      if (statusFilter && j.status !== statusFilter) return false;
      if (q && !j.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [journeys, search, statusFilter, mineOnly]);

  const filteredIds = useMemo(() => new Set(filtered.map(j => j.id)), [filtered]);

  useEffect(() => { setPage(1); }, [search, statusFilter, mineOnly]);

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
    // Skip cadences owned by someone else — they can't be deleted by this
    // user, so including them only produces a partly-failing bulk action.
    const pageIds = paged.filter(j => j.can_edit).map(j => j.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
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

  // Which of the cadences being deleted are live right now.
  const activeTargets = deleteTarget
    ? journeys.filter(j => deleteTarget.ids.includes(j.id) && j.status === 'active')
    : [];

  const totalActiveEnrollments = deleteTarget
    ? Object.values(deleteTarget.activeCounts).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="salesjourney-hub max-w-4xl mx-auto px-4 py-6 sm:px-6 sm:py-8 w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3" data-tour="cadence-list-header">
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
        <details className="mb-5">
          <summary className="text-sm font-semibold text-slate-600 cursor-pointer select-none mb-3">
            Performance snapshot
          </summary>
          <div className="mt-3">
            {/* Archived cadences are frequently one-off QA/test artifacts
                (Playwright specs name-and-archive their own scratch
                cadences) — excluding them keeps this snapshot answering
                "how are our real cadences doing", not padded with dead
                test runs. A real cadence someone intentionally retires
                drops out too, which is correct: it's no longer current. */}
            <CadencePerformanceSummary journeys={journeys.filter(j => j.status !== 'archived')} />
          </div>
        </details>
      )}

      {!loading && journeys.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <SearchInput
            placeholder="Search cadences by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[200px]"
          />
          <Select
            className="text-sm"
            ariaLabel="Filter by status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_FILTER_OPTIONS}
            placeholder="All statuses"
          />
          <Checkbox
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
            label={<span className="text-sm text-slate-600">My cadences only</span>}
          />
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
            <Checkbox
              checked={paged.some(j => j.can_edit) && paged.filter(j => j.can_edit).every(j => selected.has(j.id))}
              disabled={!paged.some(j => j.can_edit)}
              onChange={toggleSelectAllOnPage}
              aria-label="Select all on this page"
              label={<span className="text-xs text-slate-400">Select all on this page</span>}
            />
          </div>
          <div className="space-y-2">
            {paged.map((j) => (
              <Card key={j.id} className="hover:border-blue-300 transition-colors">
                <div className="flex items-center gap-3 px-4 py-3">
                  <Checkbox
                    checked={selected.has(j.id)}
                    // Only selectable if you could actually delete it —
                    // otherwise "select all" quietly loaded other owners'
                    // cadences into a bulk delete that 403s partway through.
                    disabled={!j.can_edit}
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
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-slate-800 truncate block">{j.name}</span>
                      {/* Subtle ownership line — present but quiet, so you can
                          tell whose cadence you're looking at (and why it's
                          read-only) without it competing with the name. */}
                      {!j.is_mine && (
                        <span className="text-[11px] text-slate-400 truncate block mt-0.5">
                          Owned by {j.owner_name}
                        </span>
                      )}
                    </div>
                    <Badge variant={STATUS_VARIANT[j.status] || 'default'} className="capitalize shrink-0 ml-2">{j.status}</Badge>
                  </div>
                  {/* Duplicating creates a new draft the caller owns, so it's
                      offered on every cadence, not just ones they can edit. */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDuplicate(j); }}
                    title="Duplicate cadence"
                    aria-label={`Duplicate ${j.name}`}
                    className="text-slate-300 hover:text-blue-600 shrink-0"
                  >
                    <Copy size={15} />
                  </button>
                  {j.can_edit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openDeleteConfirm([j.id]); }}
                      title="Delete cadence"
                      className="text-slate-300 hover:text-red-600 shrink-0"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination
              page={page}
              pages={totalPages}
              total={filtered.length}
              perPage={PAGE_SIZE}
              onChange={setPage}
            />
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
          <Select
            className="w-full justify-between"
            ariaLabel="Pod"
            value={newPodId}
            onChange={setNewPodId}
            options={pods.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="All pods"
          />
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
            {/* An Active cadence is live — it can still auto-enrol new leads
                right now. That's a materially different thing to delete than
                a draft, so say so before the click, not after. */}
            {activeTargets.length > 0 && (
              <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 m-0">
                  {deleteTarget.ids.length === 1
                    ? <><strong>This cadence is Active.</strong> It's live and can still enrol new leads — deleting it stops that immediately.</>
                    : <><strong>{activeTargets.length} of these cadences {activeTargets.length === 1 ? 'is' : 'are'} Active.</strong> They're live and can still enrol new leads — deleting them stops that immediately.</>}
                </p>
              </div>
            )}
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
