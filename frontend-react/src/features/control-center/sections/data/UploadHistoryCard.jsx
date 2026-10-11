import React, { useEffect, useState } from 'react';
import { History, RotateCcw, Inbox, UploadCloud, UserPlus, RefreshCcw, Copy } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../../components/ui/Card';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../../components/ui/Table';
import { SortableTableHeader } from '../../../../components/ui/SortableTableHeader';
import { useSort } from '../../../../utils/useSort';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Pagination } from '../../../../components/ui/Pagination';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { SkeletonTable, SkeletonStatCard } from '../../../../components/ui/Skeleton';
import { Modal, ConfirmDialog } from '../../../../components/ui/Modal';
import { Spinner } from '../../../../components/ui/Spinner';
import { StatStrip } from '../../../activity-monitor/components/StatStrip';
import { UploadService } from '../../../../services/api';

const PER_PAGE = 10;

const STATUS_VARIANT = { completed: 'success', partial: 'warning', rolled_back: 'default', failed: 'danger' };

// Ports the pieces UploadCenterCard.jsx's comment says were left out of the
// initial port: stat cards (upload.js:44-62), paginated history table
// (upload.js:252-435), and rollback with confirm/result (upload.js:404-596).
// Per-SDR breakdown (upload.js:496-527/598-652) opens as a modal on row
// click instead of an inline expand row — matches how MonitoringSection's
// SF Sync Log tab already does row-click-for-detail in this codebase.
export function DataSectionUploadHistoryCard() {
    const [page, setPage] = useState(1);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [detailLogId, setDetailLogId] = useState(null);
    const [rollbackTarget, setRollbackTarget] = useState(null);
    const [rollingBack, setRollingBack] = useState(false);
    const [rollbackError, setRollbackError] = useState('');
    const [rollbackResult, setRollbackResult] = useState(null);
    const [sort, toggleSortRaw] = useSort();
    const toggleSort = (key) => { toggleSortRaw(key); setPage(1); };

    const load = () => {
        let cancelled = false;
        setLoading(true);
        const sortBy = sort.key ? `${sort.dir === 'desc' ? '-' : ''}${sort.key}` : undefined;
        UploadService.getLogs(page, PER_PAGE, sortBy)
            .then((res) => { if (!cancelled) { setResult(res); setError(null); } })
            .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load upload history'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    };
    useEffect(load, [page, sort]);

    const logs = result?.logs || [];
    const summary = result?.summary || {};

    const tiles = [
        { label: 'Total Uploads', value: (summary.total_uploads || 0).toLocaleString(), icon: UploadCloud, iconClass: 'bg-slate-50 text-slate-500' },
        { label: 'Leads Created', value: (summary.total_created || 0).toLocaleString(), icon: UserPlus, iconClass: 'bg-green-50 text-green-600', valueClass: 'text-green-600' },
        { label: 'Leads Updated', value: (summary.total_updated || 0).toLocaleString(), icon: RefreshCcw, iconClass: 'bg-indigo-50 text-indigo-600', valueClass: 'text-indigo-600' },
        { label: 'Duplicates Skipped', value: (summary.total_skipped || 0).toLocaleString(), icon: Copy, iconClass: 'bg-amber-50 text-amber-600', valueClass: 'text-amber-600' },
    ];

    const doRollback = async () => {
        if (!rollbackTarget) return;
        setRollingBack(true);
        setRollbackError('');
        try {
            const res = await UploadService.rollback(rollbackTarget.id);
            setRollbackTarget(null);
            setRollbackResult(res);
            load();
        } catch (err) {
            setRollbackError(err.response?.data?.detail || err.message || 'Rollback failed.');
        } finally {
            setRollingBack(false);
        }
    };

    return (
        <Card>
            <CardHeader title="Upload History" subtitle="Every lead upload, with rollback for eligible batches" />
            <CardContent>
                {loading && !result ? (
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}
                        </div>
                        <SkeletonTable cols={9} />
                    </div>
                ) : error ? (
                    <EmptyState icon={History} title="Failed to load" message={error} />
                ) : (
                    <>
                        <StatStrip tiles={tiles} />
                        {!logs.length ? (
                            <EmptyState icon={Inbox} title="No uploads yet" />
                        ) : (
                            <>
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <SortableTableHeader label="File" sortKey="filename" sort={sort} onSort={toggleSort} />
                                            <TableHeader>By</TableHeader>
                                            <SortableTableHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                                            <TableHeader>Created</TableHeader>
                                            <TableHeader>Updated</TableHeader>
                                            <TableHeader>Skipped</TableHeader>
                                            <TableHeader>Errors</TableHeader>
                                            <SortableTableHeader label="Date" sortKey="created_at" sort={sort} onSort={toggleSort} />
                                            <TableHeader>Actions</TableHeader>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {logs.map((l) => (
                                            <TableRow key={l.id} onClick={() => setDetailLogId(l.id)}>
                                                <TableCell className="font-semibold text-slate-800 max-w-[220px] truncate" title={l.filename}>
                                                    {l.filename || '—'}{l.tag && <Badge variant="indigo" className="ml-1.5">{l.tag}</Badge>}
                                                </TableCell>
                                                <TableCell>{l.uploaded_by}</TableCell>
                                                <TableCell><Badge variant={STATUS_VARIANT[l.status] || 'default'}>{l.status}</Badge></TableCell>
                                                <TableCell className="font-semibold text-green-600">{l.created}</TableCell>
                                                <TableCell className="font-semibold text-indigo-600">{l.updated || 0}</TableCell>
                                                <TableCell>{l.skipped}</TableCell>
                                                <TableCell className={l.errors > 0 ? 'text-red-600' : ''}>{l.errors}</TableCell>
                                                <TableCell className="text-xs text-slate-400">{l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</TableCell>
                                                <TableCell onClick={(e) => e.stopPropagation()}>
                                                    {l.can_rollback ? (
                                                        <Button size="sm" variant="danger" onClick={() => setRollbackTarget(l)}>
                                                            <RotateCcw size={13} /> Rollback
                                                        </Button>
                                                    ) : l.status === 'rolled_back' ? (
                                                        <span className="text-xs text-slate-400 font-semibold">Rolled back</span>
                                                    ) : null}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                <Pagination page={result.page} pages={result.pages} total={result.total} perPage={PER_PAGE} onChange={setPage} />
                            </>
                        )}
                    </>
                )}

                <AssignmentDetailModal logId={detailLogId} onClose={() => setDetailLogId(null)} />

                <ConfirmDialog
                    open={!!rollbackTarget}
                    onClose={() => { setRollbackTarget(null); setRollbackError(''); }}
                    onConfirm={doRollback}
                    loading={rollingBack}
                    title="Rollback Confirmation"
                    confirmLabel="Yes, Rollback"
                    confirmVariant="danger"
                >
                    {rollbackTarget && (
                        <div className="text-sm text-slate-600 space-y-3">
                            <div><strong>File:</strong> {rollbackTarget.filename}<br /><strong>Leads created:</strong> {rollbackTarget.created}</div>
                            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
                                This will <strong>permanently delete</strong> leads that:
                                <ul className="list-disc ml-5 mt-1">
                                    <li>Are still in "Lead Assigned", "Research", or "Parked" status</li>
                                    <li>Have NOT been called</li>
                                </ul>
                            </div>
                            <div className="text-green-700">Leads that have progressed or been called will be protected.</div>
                            {rollbackError && <div className="text-red-600 font-semibold">{rollbackError}</div>}
                        </div>
                    )}
                </ConfirmDialog>

                <Modal open={!!rollbackResult} onClose={() => setRollbackResult(null)} title="Rollback Complete" maxWidth="max-w-md">
                    {rollbackResult && (
                        <div className="text-sm space-y-2">
                            <div><strong>{rollbackResult.rolled_back}</strong> lead(s) deleted</div>
                            <div><strong>{rollbackResult.protected}</strong> lead(s) protected</div>
                            {rollbackResult.protected_details?.length > 0 && (
                                <div className="text-xs text-slate-500">
                                    Protected reasons:
                                    <ul className="list-disc ml-5 mt-1">
                                        {rollbackResult.protected_details.map((d) => <li key={d.lead_id}>{d.reason}</li>)}
                                    </ul>
                                </div>
                            )}
                            <div className="flex justify-end pt-2">
                                <Button size="sm" onClick={() => setRollbackResult(null)}>OK</Button>
                            </div>
                        </div>
                    )}
                </Modal>
            </CardContent>
        </Card>
    );
}

function AssignmentDetailModal({ logId, onClose }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!logId) { setData(null); return; }
        let cancelled = false;
        setLoading(true);
        // Fetch ALL leads for accurate counts (upload.js:518's per_page:200,
        // removing the old per_page:15 cap).
        UploadService.getBatchDetail(logId, { per_page: 200 })
            .then((res) => { if (!cancelled) setData(res); })
            .catch(() => { if (!cancelled) setData({}); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [logId]);

    const summary = data?.assignment_summary || [];

    return (
        <Modal open={!!logId} onClose={onClose} title="Assignment Summary" maxWidth="max-w-xl">
            {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
            ) : !summary.length ? (
                <p className="text-sm text-slate-400 text-center py-8">No leads found for this batch.</p>
            ) : (
                <>
                    <div className="text-xs font-semibold text-slate-400 mb-3">{data.total} total lead{data.total !== 1 ? 's' : ''}</div>
                    <Table>
                        <TableHead>
                            <TableRow><TableHeader>SDR</TableHeader><TableHeader>Leads</TableHeader><TableHeader>Statuses</TableHeader></TableRow>
                        </TableHead>
                        <TableBody>
                            {summary.map((entry) => (
                                <TableRow key={entry.sdr}>
                                    <TableCell className={`font-semibold ${entry.sdr === 'Unassigned' ? 'text-amber-600' : 'text-slate-800'}`}>{entry.sdr}</TableCell>
                                    <TableCell className="font-bold">{entry.count}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {Object.entries(entry.statuses || {}).map(([st, cnt]) => (
                                                <Badge key={st}>{st}: {cnt}</Badge>
                                            ))}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </>
            )}
        </Modal>
    );
}
