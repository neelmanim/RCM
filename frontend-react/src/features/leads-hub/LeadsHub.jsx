import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, Ban, TriangleAlert, BadgeCheck } from 'lucide-react';
import { useLeadsList } from './useLeadsList';
import { useColumnLayout } from './useColumnLayout';
import { resolveLeadPhone } from './columns';
import { FilterBar } from './components/FilterBar';
import { SavedViewsTabs } from './components/SavedViewsTabs';
import { LeadRow, displayName } from './components/LeadRow';
import { BulkActionBar } from './components/BulkActionBar';
import { DisqualifyRequestsPanel } from './components/DisqualifyRequestsPanel';
import { SortableTableHeader } from './components/SortableTableHeader';
import { ColumnsMenu } from './components/ColumnsMenu';
import { Table, TableHead, TableBody, TableRow, TableHeader } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Modal';
import { DisqualifyService } from '../../services/api';

// Drag-the-border resize handle, shared by every reorderable column header.
// Native mouse events, not a library — a single-axis resize on one element
// doesn't need more than that.
function ResizeHandle({ onResize }) {
  const startRef = useRef({ x: 0, width: 0 });
  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest('th');
    startRef.current = { x: e.clientX, width: th.offsetWidth };
    // Without these, moving the mouse off the 6px handle mid-drag (easy at
    // any real drag speed) drops the resize cursor back to the default arrow
    // and can select surrounding page text — same fix a native <input
    // type="range"> gets for free from the browser.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent) => onResize(startRef.current.width + (moveEvent.clientX - startRef.current.x));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return (
    <span
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-300/60 active:bg-blue-400/70"
    />
  );
}

// "Assigned to" and "Last activity" are intentionally excluded from sorting —
// neither maps to a single sortable Lead column server-side (see GET /leads'
// docstring).

function groupByCompany(leads) {
  const groups = new Map();
  leads.forEach((l) => {
    const key = l.company || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  });
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

const SKELETON_WIDTHS = ['70%', '55%', '80%', '60%', '45%', '75%', '65%', '50%'];
// Contact is pinned (not part of the resizable/hideable column system) but
// still needs an explicit width once the table uses table-layout:fixed —
// without one, long content (a name, or the phone-number fallback for
// placeholder-named leads) has no column boundary to wrap/truncate against
// and visually bleeds into the Status column next to it.
const CONTACT_COLUMN_WIDTH = 260;

function SkeletonRow({ colCount }) {
  return (
    <TableRow>
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3.5 bg-slate-100 rounded animate-pulse" style={{ width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }} />
        </td>
      ))}
    </TableRow>
  );
}

function Toast({ message, onDismiss }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div className="fixed left-6 bottom-6 z-[60] max-w-[340px] bg-white border border-slate-200 shadow-xl rounded-xl px-4 py-3 text-xs text-slate-700">
      {message}
    </div>
  );
}

/**
 * Top-level Leads experience — orchestrates useLeadsList() and renders the
 * composed pieces (FilterBar, SavedViewsTabs, LeadRow, BulkActionBar,
 * DisqualifyRequestsPanel). Mounted into the legacy page via leads-entry.jsx,
 * same pattern as CalendarHub.
 */
export function LeadsHub({ userRole = '', onSwitchToClassic, onOpenLead }) {
  const normalizedRole = (userRole || '').toLowerCase();
  // Only Pod Admin actually belongs to a single pod — Super Admin/Admin see
  // everything by default and "My Pod" has no meaning for them.
  const isSuperAdmin = ['super admin', 'admin'].includes(normalizedRole);
  const isPodAdmin = normalizedRole === 'pod admin';
  // The single admin/non-admin boolean everything else in this file gates
  // on (bulk-management controls, priority-sort default,
  // "Assigned To"/"Upload" visibility) — deliberately computed as "is one of
  // the admin roles", never as a non-admin allowlist, so any role that isn't
  // explicitly an admin (SDR, AE, Sales, anything added later) gets the same
  // non-admin treatment classic's own `!isAdmin` gates give it.
  const isAdminRole = isSuperAdmin || isPodAdmin;
  const list = useLeadsList(isAdminRole);
  const layout = useColumnLayout(isAdminRole);
  const [draggingColKey, setDraggingColKey] = useState(null);
  // Disqualify Requests is the approve/reject queue — matches the backend's
  // require_pod_admin_or_above gate. SDR/AE can still request a disqualify
  // (the "Disqualify Account…" row action, open to every role) but can't
  // approve/reject one, so they don't get the review queue tab.
  const canManageDisqualify = isSuperAdmin || isPodAdmin;
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState('leads');
  const [pendingDqCount, setPendingDqCount] = useState(0);

  const refreshPendingCount = useCallback(() => {
    if (!canManageDisqualify) return;
    DisqualifyService.getRequests('pending').then((d) => setPendingDqCount((d.requests || []).length)).catch(() => {});
  }, [canManageDisqualify]);
  useEffect(() => { refreshPendingCount(); }, [refreshPendingCount]);

  // Grouping by company visually re-clusters rows, which would contradict a
  // user-chosen column sort (e.g. sorting by Status to see all "Meeting
  // Scheduled" leads together, regardless of company) — skip it while a sort
  // is active and show a flat, honestly-ordered list instead.
  const groups = useMemo(
    () => (list.sort.key ? [['', list.leads]] : groupByCompany(list.leads)),
    [list.leads, list.sort.key]
  );
  const showGroupHeader = !list.sort.key && groups.length > 1;

  const toggleGroup = (company) => setCollapsed((c) => {
    const next = new Set(c);
    if (next.has(company)) next.delete(company); else next.add(company);
    return next;
  });

  const [autoAssignConfirmOpen, setAutoAssignConfirmOpen] = useState(false);
  const [autoAssignBusy, setAutoAssignBusy] = useState(false);
  const confirmAutoAssign = async () => {
    setAutoAssignBusy(true);
    try {
      const result = await list.autoAssignAll();
      setToast(result.message);
      setAutoAssignConfirmOpen(false);
    } finally {
      setAutoAssignBusy(false);
    }
  };

  const [dqModal, setDqModal] = useState(null); // { company, leadIds } | null
  const [dqReason, setDqReason] = useState('');
  const [dqBusy, setDqBusy] = useState(false);
  const handleDisqualifyAccount = (company, leadIds) => {
    setDqReason('');
    setDqModal({ company, leadIds });
  };
  const confirmDisqualifyAccount = async () => {
    if (!dqReason.trim()) return;
    const { company, leadIds } = dqModal;
    setDqBusy(true);
    try {
      await list.requestDisqualifyAccount(company, leadIds, dqReason.trim());
      setToast(`Disqualify request submitted for ${company} — pending review`);
      refreshPendingCount();
      setDqModal(null);
    } finally {
      setDqBusy(false);
    }
  };

  // window._openCallModal is app.js's handleCallAction, exposed globally
  // specifically so call sites like this one can trigger the exact same
  // flow the classic row's Call button uses (opens the RCM widget
  // panel with lead context, Bridge/Browser mode picker, active-call guard,
  // ghost-call recovery) — no new dialer plumbing needed here.
  const handleQuickCall = (lead) => {
    const phone = resolveLeadPhone(lead);
    if (window._openCallModal) window._openCallModal(lead.id, displayName(lead), phone, lead);
    else setToast('Dialer is not available right now.');
  };

  // Inline edits (status/assignee/priority) autosave with no explicit save
  // step — without this, a failed request left the user with zero signal
  // that their change didn't actually stick.
  const handleSetStatus = useCallback(async (leadId, status) => {
    try { await list.setLeadStatus(leadId, status); }
    catch (e) { setToast(e?.response?.data?.detail || 'Failed to update status — please try again.'); }
  }, [list]);
  const handleSetAssignee = useCallback(async (leadId, userId) => {
    try { await list.setLeadAssignee(leadId, userId); }
    catch (e) { setToast(e?.response?.data?.detail || 'Failed to update assignee — please try again.'); }
  }, [list]);
  const handleSetPriority = useCallback(async (leadId, score) => {
    try { await list.setLeadPriority(leadId, score); }
    catch (e) { setToast(e?.response?.data?.detail || 'Failed to update priority — please try again.'); }
  }, [list]);

  // Lead Detail's Prev/Next nav bar reads a legacy module-level list that only
  // the classic leads view ever populated — pass our currently-loaded rows up
  // so app.js can seed it before navigating (see app.js's onOpenLead).
  const handleOpenLead = (lead) => (onOpenLead || (() => {}))(lead, list.leads);

  const colCount = 1 + layout.columns.length + (list.assignMode ? 1 : 0);

  return (
    <div className="leadshub w-full max-w-[1800px] mx-auto px-4 py-6">
      <div className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1 mb-5">
        <button type="button" onClick={() => setTab('leads')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold ${tab === 'leads' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>
          All Leads
        </button>
        {canManageDisqualify && (
          <button type="button" onClick={() => setTab('disqualify')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${tab === 'disqualify' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>
            Disqualify Requests
            {pendingDqCount > 0 && <span className="bg-red-600 text-white text-[10px] font-extrabold rounded-full px-1.5">{pendingDqCount}</span>}
          </button>
        )}
      </div>

      {tab === 'leads' ? (
        <>
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl px-4 py-2.5 mb-5 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
            <span>You're viewing the redesigned Leads experience.</span>
            <span className="flex-1" />
            <button type="button" onClick={onSwitchToClassic} className="underline underline-offset-2">Switch to classic view</button>
          </div>

          {list.error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 mb-5 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
              <span>Couldn't load leads: {list.error}</span>
            </div>
          )}

          <div className="flex items-end justify-between gap-4 mb-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight m-0">All Leads</h1>
              <div className="text-xs text-slate-500 mt-1">
                <b className="text-slate-800">{list.total}</b> leads in pipeline
                {isPodAdmin && (
                  <>
                    {' · '}{list.globalView ? 'Viewing Global' : 'Viewing My Pod'}
                    {' · '}
                    <button type="button" onClick={list.toggleGlobalView} className="text-blue-600 font-bold underline underline-offset-2">
                      Switch to {list.globalView ? 'My Pod' : 'Global'}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <ColumnsMenu allColumns={layout.allColumns} hidden={layout.hidden} onToggle={layout.toggleHidden} onReset={layout.resetLayout} />
              {isAdminRole && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setAutoAssignConfirmOpen(true)}>Round Robin Auto-Assign</Button>
                  <Button variant={list.assignMode ? 'primary' : 'outline'} size="sm" onClick={list.toggleAssignMode}>Assign mode</Button>
                </>
              )}
            </div>
          </div>

          <SavedViewsTabs
            savedViews={list.savedViews} activeViewId={list.activeViewId} activeFilterKeys={list.activeFilterKeys}
            onApply={list.applyView} onSave={list.saveCurrentView} onRemove={list.removeView}
          />
          <FilterBar list={list} />

          <Table tableStyle={{ tableLayout: 'fixed' }}>
            <TableHead className="bg-white">
              <TableRow>
                {list.assignMode && (
                  <TableHeader className="w-8">
                    <input type="checkbox" onChange={(e) => list.selectAllVisible(e.target.checked)} aria-label="Select all visible"
                      className="w-4 h-4 rounded border-slate-300 accent-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-0" />
                  </TableHeader>
                )}
                <SortableTableHeader label="Contact" sortKey="name" sort={list.sort} onSort={list.toggleSort} style={{ width: CONTACT_COLUMN_WIDTH }} />
                {layout.columns.map((col) => {
                  const headerProps = {
                    className: 'relative select-none',
                    style: { width: layout.widthOf(col.key) },
                    draggable: true,
                    onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; setDraggingColKey(col.key); },
                    onDragOver: (e) => e.preventDefault(),
                    onDrop: (e) => { e.preventDefault(); if (draggingColKey) layout.reorder(draggingColKey, col.key); setDraggingColKey(null); },
                    onDragEnd: () => setDraggingColKey(null),
                  };
                  return col.sortKey ? (
                    <SortableTableHeader key={col.key} label={col.label} sortKey={col.sortKey} sort={list.sort} onSort={list.toggleSort} {...headerProps}>
                      <ResizeHandle onResize={(w) => layout.resize(col.key, w)} />
                    </SortableTableHeader>
                  ) : (
                    <TableHeader key={col.key} {...headerProps}>
                      {col.label}
                      <ResizeHandle onResize={(w) => layout.resize(col.key, w)} />
                    </TableHeader>
                  );
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {list.loading && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} colCount={colCount} />)}
              {!list.loading && !list.error && groups.length === 0 && (
                <TableRow><td colSpan={colCount} className="text-center italic text-slate-400 py-10">No leads match these filters.</td></TableRow>
              )}
              {!list.loading && groups.map(([company, rows]) => {
                const isNoCompany = company === '—';
                // A meeting already booked for this company via another channel
                // (e.g. inbound, a different SDR) — surfaced in the classic table's
                // group header so a fresh SDR doesn't cold-call a company that's
                // already progressing; dropped in the initial port.
                const resolvedLead = rows.find((r) => r.company_resolved?.resolved);
                return (
                <React.Fragment key={company}>
                  {showGroupHeader && (
                    <TableRow>
                      <td colSpan={colCount} className={`px-0 py-0 border-b ${isNoCompany ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                        <div className="flex items-center justify-between px-3.5 py-1.5">
                          <button type="button" onClick={() => toggleGroup(company)}
                            className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wide hover:text-slate-800 ${isNoCompany ? 'text-amber-700' : 'text-slate-500'}`}>
                            <ChevronDown size={14} strokeWidth={2.5} className={`transition-transform ${collapsed.has(company) ? '-rotate-90' : ''}`} />
                            {isNoCompany ? (
                              <span className="inline-flex items-center gap-1"><TriangleAlert size={12} strokeWidth={2.5} /> No Company</span>
                            ) : company}
                            <span className="text-[9.5px] font-bold bg-white border border-slate-200 rounded-full px-1.5 py-0.5 normal-case text-slate-400">
                              {rows.length} contact{rows.length === 1 ? '' : 's'}
                            </span>
                            {resolvedLead && (
                              <span
                                title={`Meeting already booked via ${resolvedLead.company_resolved.resolved_by}`}
                                className="inline-flex items-center gap-1 text-[9.5px] font-bold normal-case bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5"
                              >
                                <BadgeCheck size={11} strokeWidth={2.5} /> Connected via {resolvedLead.company_resolved.resolved_by}
                              </span>
                            )}
                          </button>
                          <button type="button" onClick={() => handleDisqualifyAccount(company, rows.filter((r) => r.status !== 'Disqualified' && r.status !== 'Completed').map((r) => r.id))}
                            aria-label="Disqualify account" title="Disqualify account"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50">
                            <Ban size={15} strokeWidth={2.25} />
                          </button>
                        </div>
                      </td>
                    </TableRow>
                  )}
                  {!collapsed.has(company) && rows.map((lead) => (
                    <LeadRow
                      key={lead.id} lead={lead} columns={layout.columns} isAdmin={isAdminRole}
                      sdrs={list.sdrs} assignMode={list.assignMode} selected={list.selected.has(lead.id)}
                      onToggleSelect={list.toggleSelect}
                      onSetStatus={handleSetStatus} onSetAssignee={handleSetAssignee} onSetPriority={handleSetPriority}
                      onQuickCall={handleQuickCall} onOpenLead={handleOpenLead}
                    />
                  ))}
                </React.Fragment>
              );})}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between px-1 py-3 text-xs text-slate-500">
            <span>Showing <b className="text-slate-800">{list.leads.length}</b> of <b className="text-slate-800">{list.total}</b></span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={list.page <= 1} onClick={() => list.setPage((p) => p - 1)}>Previous</Button>
              <span className="font-mono">{list.page} / {list.totalPages}</span>
              <Button size="sm" variant="outline" disabled={list.page >= list.totalPages} onClick={() => list.setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>

          <BulkActionBar list={list} onToast={setToast} canDelete={isSuperAdmin} canEnrollJourney={isAdminRole} />
        </>
      ) : (
        <DisqualifyRequestsPanel onToast={(msg) => { setToast(msg); refreshPendingCount(); }} />
      )}

      <Toast message={toast} onDismiss={() => setToast('')} />

      <ConfirmDialog
        open={autoAssignConfirmOpen}
        onClose={() => setAutoAssignConfirmOpen(false)}
        title="Round Robin Auto-Assign"
        message="Distribute all unassigned leads across your SDR team by Round Robin?"
        confirmLabel="Distribute"
        onConfirm={confirmAutoAssign}
        loading={autoAssignBusy}
      />

      <ConfirmDialog
        open={!!dqModal}
        onClose={() => setDqModal(null)}
        title={dqModal ? `Disqualify ${dqModal.company}` : ''}
        message={dqModal ? `Reason for disqualifying the ${dqModal.company} account (${dqModal.leadIds.length} lead${dqModal.leadIds.length === 1 ? '' : 's'}):` : ''}
        confirmLabel="Submit request"
        confirmVariant="danger"
        onConfirm={confirmDisqualifyAccount}
        loading={dqBusy}
      >
        <textarea
          autoFocus rows={3} value={dqReason} onChange={(e) => setDqReason(e.target.value)}
          placeholder="Why should this account be disqualified?"
          className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
        />
      </ConfirmDialog>
    </div>
  );
}
