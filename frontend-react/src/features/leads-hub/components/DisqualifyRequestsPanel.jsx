import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { DisqualifyService } from '../../../services/api';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { SortableTableHeader } from './SortableTableHeader';

const SORTABLE = {
  company: (r) => (r.company || '').toLowerCase(),
  leads: (r) => r.lead_ids.length,
  requested_by: (r) => (r.requested_by_name || '').toLowerCase(),
  requested_at: (r) => r.requested_at || '',
};

export function DisqualifyRequestsPanel({ onToast }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sort, setSort] = useState({ key: 'requested_at', dir: 'desc' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await DisqualifyService.getRequests('pending');
      setRequests(data.requests || []);
      setSelected(new Set());
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load disqualify requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const getVal = SORTABLE[sort.key] || SORTABLE.requested_at;
    const copy = [...requests];
    copy.sort((a, b) => {
      const av = getVal(a), bv = getVal(b);
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [requests, sort]);

  const handleSort = (key) => {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAll = (checked) => setSelected(checked ? new Set(requests.map((r) => r.id)) : new Set());

  const approve = async (req) => {
    try {
      const result = await DisqualifyService.approve(req.id);
      onToast(result.message);
      load();
    } catch (e) {
      onToast(e?.response?.data?.detail || 'Failed to approve request');
    }
  };
  const confirmReject = async (req) => {
    try {
      await DisqualifyService.reject(req.id, rejectReason);
      onToast(`Request for ${req.company} rejected`);
      setRejectingId(null);
      setRejectReason('');
      load();
    } catch (e) {
      onToast(e?.response?.data?.detail || 'Failed to reject request');
    }
  };

  const [bulkConfirmAction, setBulkConfirmAction] = useState(null); // 'approve' | 'reject' | null

  const runBulkApprove = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selected];
      const results = await Promise.all(ids.map((id) => DisqualifyService.approve(id).catch(() => null)));
      const okCount = results.filter(Boolean).length;
      onToast(`${okCount} of ${ids.length} request(s) approved`);
      load();
    } finally {
      setBulkBusy(false);
      setBulkConfirmAction(null);
    }
  };
  const runBulkReject = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selected];
      const results = await Promise.all(ids.map((id) => DisqualifyService.reject(id, '').catch(() => null)));
      const okCount = results.filter(Boolean).length;
      onToast(`${okCount} of ${ids.length} request(s) rejected`);
      load();
    } finally {
      setBulkBusy(false);
      setBulkConfirmAction(null);
    }
  };

  if (loading) return <div className="text-sm text-slate-400 py-10 text-center">Loading…</div>;

  return (
    <div className="relative">
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 mb-4 text-xs font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
          <span>Couldn't load disqualify requests: {error}</span>
        </div>
      )}
      <Table>
        <TableHead>
          <TableRow>
            <TableHeader className="w-8">
              <input
                type="checkbox"
                checked={requests.length > 0 && selected.size === requests.length}
                onChange={(e) => selectAll(e.target.checked)}
                aria-label="Select all requests"
                className="w-4 h-4 rounded border-slate-300 accent-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-0"
              />
            </TableHeader>
            <SortableTableHeader label="Company" sortKey="company" sort={sort} onSort={handleSort} />
            <SortableTableHeader label="Leads" sortKey="leads" sort={sort} onSort={handleSort} />
            <TableHeader>Reason</TableHeader>
            <SortableTableHeader label="Requested by" sortKey="requested_by" sort={sort} onSort={handleSort} />
            <SortableTableHeader label="Requested" sortKey="requested_at" sort={sort} onSort={handleSort} />
            <TableHeader></TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {!error && sorted.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center italic text-slate-400 py-10">No pending requests.</TableCell></TableRow>
          )}
          {sorted.map((req) => (
            <React.Fragment key={req.id}>
              <TableRow>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(req.id)}
                    onChange={() => toggleSelect(req.id)}
                    aria-label={`Select ${req.company}`}
                    className="w-4 h-4 rounded border-slate-300 accent-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-0"
                  />
                </TableCell>
                <TableCell className="font-bold">{req.company}</TableCell>
                <TableCell>{req.lead_ids.length}</TableCell>
                <TableCell className="max-w-[320px] whitespace-normal">{req.reason}</TableCell>
                <TableCell>{req.requested_by_name || '—'}</TableCell>
                <TableCell>{req.requested_at ? new Date(req.requested_at).toLocaleDateString() : '—'}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button size="sm" variant="primary" className="!bg-emerald-600 hover:!bg-emerald-700 mr-1.5" onClick={() => approve(req)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" className="!text-red-600 !border-red-200" onClick={() => setRejectingId(req.id)}>
                    Reject
                  </Button>
                </TableCell>
              </TableRow>
              {rejectingId === req.id && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <textarea
                      rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for rejecting (optional)…"
                      className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-lg bg-slate-50"
                    />
                    <div className="flex justify-end gap-2 mt-1.5">
                      <Button size="sm" variant="outline" onClick={() => { setRejectingId(null); setRejectReason(''); }}>Cancel</Button>
                      <Button size="sm" variant="primary" onClick={() => confirmReject(req)}>Confirm reject</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>

      {selected.size > 0 && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-2xl text-xs">
          <span className="font-bold">{selected.size} selected</span>
          <div className="w-px h-5 bg-white/20" />
          <button type="button" disabled={bulkBusy} onClick={() => setBulkConfirmAction('approve')}
            className="bg-emerald-600 rounded-lg px-3.5 py-1.5 font-bold disabled:opacity-60 text-white">
            Approve all
          </button>
          <button type="button" disabled={bulkBusy} onClick={() => setBulkConfirmAction('reject')}
            className="text-red-300 border border-red-400/40 rounded-lg px-3.5 py-1.5 font-bold disabled:opacity-60">
            Reject all
          </button>
          <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection" title="Clear selection"
            className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white ml-1">
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!bulkConfirmAction}
        onClose={() => setBulkConfirmAction(null)}
        title={bulkConfirmAction === 'approve' ? 'Approve requests' : 'Reject requests'}
        message={`${bulkConfirmAction === 'approve' ? 'Approve' : 'Reject'} ${selected.size} disqualify request(s)?`}
        confirmLabel={bulkConfirmAction === 'approve' ? 'Approve' : 'Reject'}
        confirmVariant={bulkConfirmAction === 'approve' ? 'primary' : 'danger'}
        onConfirm={bulkConfirmAction === 'approve' ? runBulkApprove : runBulkReject}
        loading={bulkBusy}
      />
    </div>
  );
}
