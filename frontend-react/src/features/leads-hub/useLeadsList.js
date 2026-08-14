import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { LeadsService, AssignmentsService, TagsService, AdminService, DisqualifyService, CallsService } from '../../services/api';

const PER_PAGE = 20;
const SAVED_VIEWS_KEY = 'leadsHub.savedViews';
// Transient view state (filters/search/sort/page) — sessionStorage, not
// localStorage, on purpose: it should survive navigating to another CRM view
// and back (the classic leads table did this too, see app.js's "Leads view
// state is preserved across tab switches" comment) but clear on tab close,
// unlike the deliberately-durable Saved Views above.
const VIEW_STATE_KEY = 'leadsHub.viewState';

// Tracked filter types match the classic table's Mixpanel events
// ('status', 'source', 'outcome') — see lead_list.js's filter change handlers.
const TRACKED_FILTER_KEYS = ['status', 'source', 'outcome'];

function emptyFilters() {
  return { status: [], tag: [], source: '', company: '', assignedTo: '', outcome: '', uploadLogId: '', dateFrom: '', dateTo: '' };
}

function loadSavedViews() {
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Valid JSON but the wrong shape (a future schema change, manual
    // tampering, a browser extension) would otherwise crash every .map()/
    // .find() call site with no ErrorBoundary anywhere to catch it.
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedViews(views) {
  try { window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views)); } catch { /* storage unavailable — views just won't persist */ }
}

function loadViewState() {
  try {
    const raw = window.sessionStorage.getItem(VIEW_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function track(event, props) {
  try { window.mixpanel?.track(event, props); } catch { /* analytics is best-effort */ }
}

// Tags/SDRs/companies/call-outcomes are admin-configured reference data that
// barely changes within a session — but LeadsHub fully unmounts on every
// navigation away (see leads-entry.jsx), so without this, going into a lead
// and back re-fetches all 4 lists from scratch every time. Cached for the
// lifetime of the page (cleared naturally on reload/logout).
const referenceCache = {};
function fetchOnce(key, fetcher) {
  if (!referenceCache[key]) referenceCache[key] = fetcher().catch((e) => { delete referenceCache[key]; throw e; });
  return referenceCache[key];
}

/**
 * Owns everything the redesigned Leads table needs: fetch/pagination, all
 * filter state (including the virtual "Unassigned" status and the personal,
 * localStorage-persisted Saved Views), debounced search, row selection for
 * bulk actions, and the mutation handlers (inline edit, reassignment,
 * auto-assign, disqualify). One hook, composed pieces render off of it —
 * per the explicit ask to use React's component/hook model properly rather
 * than porting the mockup's imperative DOM manipulation.
 */
export function useLeadsList(isAdmin) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const restored = loadViewState(); // only consumed below, by lazy useState initializers

  const [page, setPage] = useState(restored?.page || 1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [searchInput, setSearchInput] = useState(restored?.searchTerm || '');
  const [searchTerm, setSearchTerm] = useState(restored?.searchTerm || '');
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchTerm(searchInput);
      setPage(1);
      if (searchInput.trim().length >= 2) track('Leads Searched', { query: searchInput.trim() });
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [filters, setFilters] = useState(() => (restored?.filters ? { ...emptyFilters(), ...restored.filters } : emptyFilters()));
  const [activeFilterKeys, setActiveFilterKeys] = useState(restored?.activeFilterKeys || []);
  // Pod Admins default to their own pod, matching the classic table — not
  // "Global" (everyone across every pod), which is what this used to default
  // to here regardless of role.
  const [globalView, setGlobalView] = useState(restored?.globalView ?? false);

  const [savedViews, setSavedViews] = useState(loadSavedViews);
  const [activeViewId, setActiveViewId] = useState('all');

  const [selected, setSelected] = useState(() => new Set());
  const [assignMode, setAssignMode] = useState(false);

  // Column sort — only covers columns backed by a single Lead column
  // server-side (see GET /leads' _SORT_COLUMNS). "Assigned to" and
  // "Last activity" are not sortable; see LeadsHub's header comment.
  // Non-admins default to a priority-sorted list (matching classic's "My
  // Leads" ordering) the first time they land here — only when nothing was
  // already restored from a prior session, so it's a one-time default, not
  // a forced state a user can't move away from.
  const [sort, setSort] = useState(restored?.sort || (!isAdmin ? { key: 'priority', dir: 'desc' } : { key: null, dir: 'asc' }));
  const toggleSort = useCallback((key) => {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
    setPage(1);
  }, []);

  // Persist the transient view state so leaving Leads (Dashboard, a lead's
  // detail page, ...) and coming back restores filters/search/sort/page/scope
  // instead of resetting to defaults — LeadsHub unmounts for real on every
  // view switch (see leads-entry.jsx), so this can't just live in React state.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ filters, activeFilterKeys, globalView, page, sort, searchTerm }));
    } catch { /* storage unavailable — state just won't persist across navigation */ }
  }, [filters, activeFilterKeys, globalView, page, sort, searchTerm]);

  const [tags, setTags] = useState([]);
  useEffect(() => { fetchOnce('tags', TagsService.list).then((d) => setTags(d.tags || [])).catch(() => {}); }, []);

  // GET /admin/users and GET /leads/upload-logs both require an admin role
  // server-side — fetching them for a non-admin would just be a guaranteed
  // 403 on every mount (and the "Assigned To" column/"Upload" filter that
  // consume them are hidden for non-admins anyway, see useColumnLayout.js /
  // FilterBar.jsx), so skip both fetches entirely rather than let them fail.
  const [sdrs, setSdrs] = useState([]);
  useEffect(() => {
    if (!isAdmin) return;
    fetchOnce('sdrs', AdminService.getUsers)
      .then((users) => setSdrs((users || []).filter((u) => ['SDR', 'AE', 'Sales'].includes(u.role))))
      .catch(() => {});
  }, [isAdmin]);

  const [companies, setCompanies] = useState([]);
  useEffect(() => { fetchOnce('companies', LeadsService.getCompanies).then((d) => setCompanies(d.companies || d || [])).catch(() => {}); }, []);

  // Upload logs aren't cached — a just-finished import should show up in the
  // filter picker immediately, not after a stale reference-data snapshot.
  const [uploadLogs, setUploadLogs] = useState([]);
  useEffect(() => {
    if (!isAdmin) return;
    AssignmentsService.getUploadLogs(1, 50).then((d) => setUploadLogs(d.logs || [])).catch(() => {});
  }, [isAdmin]);

  // Outcomes are admin-configurable (Settings > Sync > Call Outcomes), not a
  // fixed list — fetch the real enabled set instead of hardcoding one that
  // can silently drift from what's actually stored on calls.
  const [outcomes, setOutcomes] = useState([]);
  useEffect(() => {
    fetchOnce('outcomes', CallsService.getCallOutcomes)
      .then((d) => setOutcomes((d.enabled_outcomes || d.outcomes || []).map((o) => o.value)))
      .catch(() => {});
  }, []);

  const setFilter = useCallback((key, value) => {
    setFilters((f) => {
      const next = { ...f, [key]: value };
      // "Status: Unassigned" and a specific "Assigned to" SDR are mutually
      // exclusive — assigned_to only ever carries one value server-side
      // (see `params` below), so setting a real SDR here would silently
      // make the Unassigned checkbox a no-op while both chips stay visibly
      // "active". Picking a real assignee clears the contradictory checkbox
      // instead of just ignoring it.
      if (key === 'assignedTo' && value && value !== 'Unassigned only' && f.status.includes('Unassigned')) {
        next.status = f.status.filter((s) => s !== 'Unassigned');
      }
      return next;
    });
    setPage(1);
    if (value && TRACKED_FILTER_KEYS.includes(key)) track('Leads Filtered', { filter_type: key, filter_value: value });
  }, []);
  const toggleMultiFilter = useCallback((key, value) => {
    setFilters((f) => {
      const arr = f[key];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      const nextFilters = { ...f, [key]: next };
      // Same mutual-exclusivity guard, other direction — see setFilter above.
      if (key === 'status' && value === 'Unassigned' && next.includes('Unassigned')
          && f.assignedTo && f.assignedTo !== 'Unassigned only') {
        nextFilters.assignedTo = '';
      }
      return nextFilters;
    });
    setPage(1);
    if (TRACKED_FILTER_KEYS.includes(key)) track('Leads Filtered', { filter_type: key, filter_value: value });
  }, []);
  const clearFilter = useCallback((key) => {
    setFilters((f) => {
      const next = { ...f, [key]: Array.isArray(f[key]) ? [] : '' };
      // The "Created" chip is one UI element backing two fields (dateFrom
      // AND dateTo) — clearing only dateFrom left dateTo silently applied
      // with no visible chip explaining why leads still looked filtered.
      if (key === 'dateFrom') next.dateTo = '';
      return next;
    });
    setPage(1);
  }, []);
  const addFilterKey = useCallback((key) => {
    setActiveFilterKeys((keys) => (keys.includes(key) ? keys : [...keys, key]));
  }, []);
  const removeFilterKey = useCallback((key) => {
    setActiveFilterKeys((keys) => keys.filter((k) => k !== key));
    clearFilter(key);
  }, [clearFilter]);
  // Search lives outside `filters` (it's debounced separately), so every
  // filter-reset path below has to clear it explicitly too — otherwise a
  // search typed before switching views/clearing filters kept silently
  // narrowing results with no visible chip explaining why. Sets both the
  // input and the debounced term directly so the reset is immediate, not
  // 400ms later.
  const resetSearch = useCallback(() => { setSearchInput(''); setSearchTerm(''); }, []);

  const clearAllFilters = useCallback(() => {
    setActiveFilterKeys([]);
    setFilters(emptyFilters());
    setActiveViewId('all');
    resetSearch();
    setPage(1);
  }, [resetSearch]);

  const applyView = useCallback((viewId) => {
    setActiveViewId(viewId);
    if (viewId === 'all') {
      setFilters(emptyFilters());
      setActiveFilterKeys([]);
      resetSearch();
    } else {
      const view = savedViews.find((v) => v.id === viewId);
      if (!view) return;
      setFilters({ ...emptyFilters(), ...view.filters });
      setActiveFilterKeys(view.keys);
      setSearchInput(view.search || '');
      setSearchTerm(view.search || '');
    }
    setPage(1);
  }, [savedViews, resetSearch]);

  const saveCurrentView = useCallback((name) => {
    if (!activeFilterKeys.length || !name) return;
    const view = { id: `v-${crypto.randomUUID()}`, name, filters: { ...filters }, keys: [...activeFilterKeys], search: searchTerm };
    setSavedViews((views) => {
      const next = [...views, view];
      persistSavedViews(next);
      return next;
    });
    setActiveViewId(view.id);
  }, [filters, activeFilterKeys, searchTerm]);

  const removeView = useCallback((viewId) => {
    setSavedViews((views) => {
      const next = views.filter((v) => v.id !== viewId);
      persistSavedViews(next);
      return next;
    });
    if (activeViewId === viewId) {
      setActiveViewId('all');
      setFilters(emptyFilters());
      setActiveFilterKeys([]);
      resetSearch();
      setPage(1);
    }
  }, [activeViewId, resetSearch]);

  const toggleGlobalView = useCallback(() => setGlobalView((g) => !g), []);

  const params = useMemo(() => {
    const p = { page, per_page: PER_PAGE, global_view: globalView };
    if (searchTerm.trim()) p.search = searchTerm.trim();
    // Virtual "Unassigned" lives inside the status multi-select in the UI, but
    // the backend already has a dedicated assigned_to=unassigned filter for it.
    const realStatuses = filters.status.filter((s) => s !== 'Unassigned');
    if (realStatuses.length) p.status = realStatuses;
    if (filters.status.includes('Unassigned') && !filters.assignedTo) p.assigned_to = 'unassigned';
    else if (filters.assignedTo) p.assigned_to = filters.assignedTo === 'Unassigned only' ? 'unassigned' : filters.assignedTo;
    if (filters.tag.length) p.tag = filters.tag;
    if (filters.source) p.source = filters.source;
    if (filters.company) p.company = filters.company;
    if (filters.outcome) p.outcome = filters.outcome;
    if (filters.uploadLogId) p.upload_log_id = filters.uploadLogId;
    if (filters.dateFrom) p.date_from = filters.dateFrom;
    if (filters.dateTo) p.date_to = filters.dateTo;
    if (sort.key) { p.sort_by = sort.key; p.sort_dir = sort.dir; }
    return p;
  }, [page, globalView, searchTerm, filters, sort]);

  // Guards against a slower, now-stale request's response landing after a
  // newer one (e.g. rapid filter/tag toggling) and overwriting the table
  // with results for a filter combination the user already moved away from
  // — same requestIdRef pattern used in Analytics Hub's DashboardTab.jsx.
  const requestIdRef = useRef(0);
  const fetchLeads = useCallback(async () => {
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await LeadsService.getLeads(params);
      if (myRequestId !== requestIdRef.current) return; // superseded — discard
      const pages = data.pages || 1;
      // A page number restored from a previous session (see loadViewState
      // above) can outlive the filters/result set it was valid for — land on
      // the last real page instead of rendering an empty table.
      if (params.page > pages) { setPage(Math.max(1, pages)); return; }
      setLeads(data.data || []);
      setTotal(data.total || 0);
      setTotalPages(pages);
    } catch (e) {
      if (myRequestId !== requestIdRef.current) return;
      setError(e?.response?.data?.detail || 'Failed to load leads');
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
  }, [params]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // ── Selection (Assign mode) ──────────────────────────────────────
  const toggleSelect = useCallback((id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const selectAllVisible = useCallback((checked) => {
    setSelected(checked ? new Set(leads.map((l) => l.id)) : new Set());
  }, [leads]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const toggleAssignMode = useCallback(() => {
    setAssignMode((m) => !m);
    setSelected(new Set());
  }, []);

  // "Select all N matching" — a real cross-page fetch (GET /leads?ids_only=true
  // with the same active filters), not a client-side stub over the current page.
  const [selectingAllMatching, setSelectingAllMatching] = useState(false);
  const selectAllMatching = useCallback(async () => {
    setSelectingAllMatching(true);
    try {
      const { page: _page, per_page: _perPage, ...filterParams } = params;
      const data = await LeadsService.getLeads({ ...filterParams, ids_only: true });
      setSelected(new Set((data.data || []).map((l) => l.id)));
    } finally {
      setSelectingAllMatching(false);
    }
  }, [params]);

  // ── Mutations ─────────────────────────────────────────────────────
  const setLeadStatus = useCallback(async (leadId, status) => {
    await LeadsService.updateLead(leadId, { status });
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, status } : l)));
  }, []);
  const setLeadAssignee = useCallback(async (leadId, userId) => {
    if (userId) await AssignmentsService.bulkAssign(userId, [leadId]);
    else await AssignmentsService.bulkUnassign([leadId]);
    await fetchLeads();
  }, [fetchLeads]);
  const setLeadPriority = useCallback(async (leadId, score) => {
    await LeadsService.reprioritize(leadId, score);
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, priority_score: score } : l)));
  }, []);

  const bulkAssign = useCallback(async (userId) => {
    const ids = Array.from(selected);
    const result = await AssignmentsService.bulkAssign(userId, ids);
    clearSelection();
    await fetchLeads();
    return result;
  }, [selected, clearSelection, fetchLeads]);
  const bulkUnassign = useCallback(async () => {
    const ids = Array.from(selected);
    const result = await AssignmentsService.bulkUnassign(ids);
    clearSelection();
    await fetchLeads();
    return result;
  }, [selected, clearSelection, fetchLeads]);
  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selected);
    const result = await AssignmentsService.bulkDelete(ids);
    clearSelection();
    await fetchLeads();
    return result;
  }, [selected, clearSelection, fetchLeads]);
  const autoAssignAll = useCallback(async () => {
    const result = await AssignmentsService.autoAssignAll();
    await fetchLeads();
    return result;
  }, [fetchLeads]);

  const requestDisqualifyAccount = useCallback(
    (company, leadIds, reason) => DisqualifyService.create(company, leadIds, reason),
    []
  );

  return {
    leads, loading, error, total, page, setPage, totalPages, isAdmin,
    searchInput, setSearchInput,
    filters, setFilter, toggleMultiFilter, clearFilter,
    activeFilterKeys, addFilterKey, removeFilterKey, clearAllFilters,
    globalView, toggleGlobalView,
    savedViews, activeViewId, applyView, saveCurrentView, removeView,
    tags, sdrs, companies, uploadLogs, outcomes,
    selected, toggleSelect, selectAllVisible, clearSelection, assignMode, toggleAssignMode,
    sort, toggleSort,
    selectAllMatching, selectingAllMatching,
    setLeadStatus, setLeadAssignee, setLeadPriority,
    bulkAssign, bulkUnassign, bulkDelete, autoAssignAll, requestDisqualifyAccount,
    refetch: fetchLeads,
  };
}
