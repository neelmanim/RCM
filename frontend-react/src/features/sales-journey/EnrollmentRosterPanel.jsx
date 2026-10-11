import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, Download, Users, Search, X } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { SalesJourneyService } from '../../services/api';
import { toast } from './toast';
import { JOURNEY_STATUS_LABEL, JOURNEY_STATUS_VARIANT, JOURNEY_REASON_LABEL } from './journeyLabels';
import { ActivityRow } from './activityEvents';
import { Pagination } from '../../components/ui/Pagination';
import { useCanExport } from '../../lib/useCanExport';

const PAGE_SIZE = 20;
const ENROLLED_VIA_LABEL = {
  'trigger:status_changed': 'automatically, when the lead\'s status changed',
  manual: 'manually (Enroll in Cadence)',
  sandbox: 'sandbox test lead',
};
const SORTERS = {
  lead: (r) => r.lead_name || '',
  status: (r) => JOURNEY_STATUS_LABEL[r.status] || r.status || '',
  step: (r) => (r.status === 'active' ? r.current_node_label : (JOURNEY_REASON_LABEL[r.exited_reason] || r.exited_reason)) || '',
};

// Feedback #8/#9, plus live-demo feedback ("what happened to those leads,
// what stage are they at"): a per-lead roster — /stats only has status
// COUNTS, this names who's where. Open by default (was collapsed, which is
// exactly why this didn't come up during the demo — a presenter had no
// reason to click to expand it) with a status/stage breakdown up top for
// the "at a glance" answer, and the full per-lead list below it for the
// drill-down. CSV export (#10) for anything beyond what's comfortable to
// scroll through here.
//
// v13.1.8 — a row expands in place to show that lead's events (reusing the
// activity-monitor expand-row convention). This is what replaced the old
// standalone "Activity" button: Activity was a flat feed naming leads with
// no link back to their roster row, so answering "what happened to THIS
// lead" meant opening two separate modals and matching names by eye. The
// `activity` prop is the cadence's full event list (already fetched once
// by the parent reporting tab, capped at 100 server-side) filtered
// client-side by lead_id on expand — no new endpoint needed.
export function EnrollmentRosterPanel({ journeyId, activity = [] }) {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState({});
  const [stageBreakdown, setStageBreakdown] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canExport = useCanExport();
  const [expandedId, setExpandedId] = useState(null);
  // Client-side only — these narrow what's already loaded, same spirit as
  // "Load more": no new endpoint, no new params, since the status/stage
  // badges and lead names are already sitting in `rows`.
  const [statusFilter, setStatusFilter] = useState(null); // {type: 'status'|'stage', value} | null
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('lead');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const data = await SalesJourneyService.getEnrollmentRoster(journeyId, offset);
      setRows((prev) => (offset === 0 ? data.enrollments : [...prev, ...data.enrollments]));
      setTotal(data.total);
      setStatusCounts(data.status_counts || {});
      setStageBreakdown(data.stage_breakdown || []);
    } catch {
      toast('Failed to load the enrollment roster.', 'error');
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => { if (open && rows.length === 0) load(0); }, [open, rows.length, load]);

  // Reset to page 1 whenever the visible set would change shape — otherwise
  // a narrower filter can leave you stranded on a now-empty page 4.
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const visibleRows = useMemo(() => {
    let out = rows;
    if (statusFilter?.type === 'status') out = out.filter((r) => r.status === statusFilter.value);
    if (statusFilter?.type === 'stage') out = out.filter((r) => r.status === 'active' && r.current_node_label === statusFilter.value);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => r.lead_name?.toLowerCase().includes(q) || r.lead_company?.toLowerCase().includes(q));
    }
    const getKey = SORTERS[sortKey] || SORTERS.lead;
    out = [...out].sort((a, b) => {
      const cmp = getKey(a).localeCompare(getKey(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [rows, statusFilter, search, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const pageRows = visibleRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = async () => {
    setExporting(true);
    try {
      await SalesJourneyService.exportEnrollmentsCsv(journeyId);
    } catch {
      toast('Failed to export — please try again.', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="border-t border-slate-200">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
        <span className="flex items-center gap-1.5"><Users size={14} /> Enrolled leads {total ? `(${total})` : ''}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && Object.keys(statusCounts).length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap items-center gap-1.5">
          {Object.entries(statusCounts).map(([status, count]) => {
            const isActive = statusFilter?.type === 'status' && statusFilter.value === status;
            return (
              <button key={status} type="button"
                onClick={() => setStatusFilter(isActive ? null : { type: 'status', value: status })}
                className={isActive ? 'ring-2 ring-offset-1 ring-blue-400 rounded-full' : ''}
                title={`Show only ${JOURNEY_STATUS_LABEL[status] || status}`}>
                <Badge variant={JOURNEY_STATUS_VARIANT[status] || 'default'}>
                  {count} {JOURNEY_STATUS_LABEL[status] || status}
                </Badge>
              </button>
            );
          })}
          {stageBreakdown.map((s) => {
            const isActive = statusFilter?.type === 'stage' && statusFilter.value === s.label;
            return (
              <button key={s.node_id} type="button"
                onClick={() => setStatusFilter(isActive ? null : { type: 'stage', value: s.label })}
                className={isActive ? 'ring-2 ring-offset-1 ring-blue-400 rounded-full' : ''}
                title={`Show only leads at ${s.label}`}>
                <Badge variant="info">{s.count} at {s.label}</Badge>
              </button>
            );
          })}
          {statusFilter && (
            <button type="button" onClick={() => setStatusFilter(null)}
              className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 ml-1">
              <X size={12} /> clear filter
            </button>
          )}
        </div>
      )}
      {open && (
        // No inner scroll box: a nested scrollable region here competes with
        // the page's own scroll for mouse-wheel input — if the cursor is
        // over this box, the page stops scrolling and only this list moves,
        // which reads as the panel "disappearing" once it scrolls past its
        // own small viewport. Flowing with the page keeps one scroll
        // surface; "Load more"/CSV already handle large rosters.
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="relative flex-1 max-w-xs">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by lead or company…"
                className="w-full text-xs border border-slate-200 rounded-md pl-6 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            {canExport && (
              <Button size="sm" variant="outline" disabled={exporting} onClick={handleExport}>
                <Download size={12} /> {exporting ? 'Exporting…' : 'Download CSV'}
              </Button>
            )}
          </div>
          {loading && rows.length === 0 ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-slate-400">No leads have been enrolled yet.</p>
          ) : visibleRows.length === 0 ? (
            <p className="text-xs text-slate-400">No leads match this filter/search.</p>
          ) : (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="font-semibold pb-1 w-4" />
                    {[['lead', 'Lead'], ['status', 'Status'], ['step', 'Current step / reason']].map(([key, label]) => (
                      <th key={key} className="font-semibold pb-1 cursor-pointer select-none hover:text-slate-600" onClick={() => toggleSort(key)}>
                        {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const isExpanded = expandedId === r.enrollment_id;
                    const leadEvents = isExpanded ? activity.filter((e) => e.lead_id === r.lead_id) : [];
                    return (
                      <React.Fragment key={r.enrollment_id}>
                        <tr
                          className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
                          onClick={() => setExpandedId(isExpanded ? null : r.enrollment_id)}
                        >
                          <td className="py-1.5 text-slate-300">
                            <ChevronRight size={12} className={isExpanded ? 'rotate-90' : ''} />
                          </td>
                          <td className="py-1.5 pr-2 text-slate-700">{r.lead_name}{r.lead_company ? ` · ${r.lead_company}` : ''}</td>
                          <td className="py-1.5 pr-2 text-slate-500">{JOURNEY_STATUS_LABEL[r.status] || r.status}</td>
                          <td className="py-1.5 text-slate-500">
                            {r.status === 'active' ? (r.current_node_label || '—')
                              : (JOURNEY_REASON_LABEL[r.exited_reason] || r.exited_reason || '—')}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t border-slate-50 bg-slate-50/50">
                            <td colSpan={4} className="px-3 py-2">
                              {r.enrolled_via && (
                                <p className="text-xs text-slate-400 pb-1">Enrolled: {ENROLLED_VIA_LABEL[r.enrolled_via] || r.enrolled_via}</p>
                              )}
                              {leadEvents.length === 0 ? (
                                <p className="text-xs text-slate-400 py-1">No tracked activity for this lead yet.</p>
                              ) : (
                                leadEvents.map((e, i) => <ActivityRow key={i} event={e} />)
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              <Pagination page={page} pages={pageCount} total={visibleRows.length} perPage={PAGE_SIZE} onChange={setPage} />
              {/* "Load more" fetches additional rows from the server (past the
                  first 500); pagination above only pages through what's already
                  loaded — different concerns, both needed. */}
              {rows.length < total && (
                <Button size="sm" variant="ghost" className="mt-2 w-full" disabled={loading} onClick={() => load(rows.length)}>
                  {loading ? 'Loading…' : `Load more (${total - rows.length} remaining)`}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
