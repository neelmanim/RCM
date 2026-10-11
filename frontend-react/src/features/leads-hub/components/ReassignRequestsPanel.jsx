import React, { useState, useEffect, useCallback } from 'react';
import { ReassignService } from '../../../services/api';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';

/** Approve/reject queue for "move this lead to me" requests (Pod Admin and above).
 *  Approving reassigns the lead; its calls, notes and status history stay on it. */
export function ReassignRequestsPanel({ onToast }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRequests((await ReassignService.getRequests('pending')).requests || []);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load reassign requests');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (req, fn, okMsg) => {
    setBusyId(req.id);
    try {
      const r = await fn();
      onToast(okMsg || r.message);
      setRejectingId(null);
      setRejectReason('');
      load();
    } catch (e) {
      onToast(e?.response?.data?.detail || 'Request failed');
      load();   // e.g. someone else already reviewed it — refresh the list
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="text-sm text-slate-400 py-10 text-center">Loading…</div>;

  return (
    <div>
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 mb-4 text-xs font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
          <span>Couldn't load reassign requests: {error}</span>
        </div>
      )}
      <Table>
        <TableHead>
          <TableRow>
            <TableHeader>Lead</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Currently with</TableHeader>
            <TableHeader>Requested by</TableHeader>
            <TableHeader>Note</TableHeader>
            <TableHeader>Requested</TableHeader>
            <TableHeader></TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {!error && requests.length === 0 && (
            <TableRow><TableCell colSpan={7}><EmptyState title="No pending reassign requests." /></TableCell></TableRow>
          )}
          {requests.map((req) => (
            <React.Fragment key={req.id}>
              <TableRow>
                <TableCell>
                  <div className="font-bold">{req.lead_name || '—'}</div>
                  <div className="text-xs text-slate-500">{req.company || ''}</div>
                </TableCell>
                <TableCell>{req.lead_status || '—'}</TableCell>
                <TableCell>{req.current_owner || 'No owner'}</TableCell>
                <TableCell>{req.requested_by_name || '—'}</TableCell>
                <TableCell className="max-w-[260px] whitespace-normal">{req.note || '—'}</TableCell>
                <TableCell>{req.requested_at ? new Date(req.requested_at).toLocaleDateString() : '—'}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button size="sm" variant="primary" className="!bg-emerald-600 hover:!bg-emerald-700 mr-1.5"
                    disabled={busyId === req.id} onClick={() => act(req, () => ReassignService.approve(req.id))}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" className="!text-red-600 !border-red-200"
                    disabled={busyId === req.id} onClick={() => setRejectingId(req.id)}>
                    Reject
                  </Button>
                </TableCell>
              </TableRow>
              {rejectingId === req.id && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for rejecting (optional)…" aria-label="Rejection reason"
                      className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-lg bg-slate-50" />
                    <div className="flex justify-end gap-2 mt-1.5">
                      <Button size="sm" variant="outline" onClick={() => { setRejectingId(null); setRejectReason(''); }}>Cancel</Button>
                      <Button size="sm" variant="primary" disabled={busyId === req.id}
                        onClick={() => act(req, () => ReassignService.reject(req.id, rejectReason), 'Request rejected')}>
                        Confirm reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
