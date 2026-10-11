import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Select } from '../../../../components/ui/Select';
import { DateRangePicker } from '../../../../components/ui/DateRangePicker';
import { Popover, PopoverContent, PopoverTrigger } from '../../../../components/ui/Popover';
import { AdminService, UploadService } from '../../../../services/api';

// Same toggle-a-checkbox-square list pattern as leads-hub/FilterBar.jsx's
// 'list-multi' Status filter, adapted to {value,label} options instead of
// bare strings.
function SdrMultiSelect({ sdrs, selectedIds, onToggle }) {
    const label = selectedIds.length === 0
        ? 'Any SDR'
        : `${sdrs.find((s) => s.id === selectedIds[0])?.name || sdrs.find((s) => s.id === selectedIds[0])?.email || '1 selected'}${selectedIds.length > 1 ? ` +${selectedIds.length - 1}` : ''}`;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
                    <span className="truncate">{label}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent className="p-1.5 w-64 max-h-72 overflow-y-auto">
                {sdrs.map((u) => {
                    const picked = selectedIds.includes(u.id);
                    return (
                        <button key={u.id} type="button" onClick={() => onToggle(u.id)}
                            className={`w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-xs ${picked ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}>
                            <span className={`inline-flex w-3.5 h-3.5 rounded border shrink-0 ${picked ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`} />
                            {u.name || u.email}
                        </button>
                    );
                })}
            </PopoverContent>
        </Popover>
    );
}

// New per audit: Upload Center only ever covered getting lead data in —
// there was no way to get one SDR's full lead data back out as a CSV.
// Reuses GET /api/admin/leads/export (admin_assignment_routes.py), now
// filterable by SDR, upload batch, and/or a date range — any combination,
// at least one required (enforced server-side, guards an accidental
// unfiltered export).
export function DataSectionExportCard() {
    const [sdrs, setSdrs] = useState([]);
    const [sdrIds, setSdrIds] = useState([]);
    const [uploadLogs, setUploadLogs] = useState([]);
    const [uploadLogId, setUploadLogId] = useState('');
    const [dateRange, setDateRange] = useState({ from: '', to: '' });
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        AdminService.getUsers()
            .then((users) => setSdrs((users || []).filter((u) => ['SDR', 'AE', 'Pod Admin'].includes(u.role))))
            .catch(() => setSdrs([]));
        // Recent batches only — a filter dropdown, not the full paginated
        // Upload History list above it. 50 is the route's own per_page cap.
        UploadService.getLogs(1, 50)
            .then((res) => setUploadLogs(res?.logs || []))
            .catch(() => setUploadLogs([]));
    }, []);

    const hasFilter = sdrIds.length > 0 || uploadLogId || dateRange.from || dateRange.to;

    const toggleSdr = (id) => setSdrIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

    const doExport = async () => {
        if (!hasFilter) { setError('Choose at least one filter first.'); return; }
        setError('');
        setExporting(true);
        try {
            await AdminService.exportLeadsBySdr({
                sdrIds: sdrIds.length ? sdrIds : undefined,
                uploadLogId: uploadLogId || undefined,
                dateFrom: dateRange.from || undefined,
                dateTo: dateRange.to || undefined,
            });
        } catch (e) {
            setError(e.response?.data?.detail || e.message || 'Export failed.');
        } finally {
            setExporting(false);
        }
    };

    return (
        <Card>
            <CardHeader title="Export Leads" subtitle="Download leads by SDR, upload batch, and/or date range, as a CSV" />
            <CardContent>
                <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[220px]">
                        <label className="block text-sm font-medium text-slate-700 mb-1">SDR</label>
                        <SdrMultiSelect sdrs={sdrs} selectedIds={sdrIds} onToggle={toggleSdr} />
                    </div>
                    <div className="min-w-[220px]">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Upload batch</label>
                        <Select
                            className="w-full justify-between"
                            ariaLabel="Upload batch"
                            value={uploadLogId}
                            onChange={setUploadLogId}
                            options={uploadLogs.map((log) => ({
                                value: log.id,
                                label: `${log.filename || 'Upload'}${log.tag ? ` (${log.tag})` : ''} — ${log.created_at ? new Date(log.created_at).toLocaleDateString() : ''}`,
                            }))}
                            placeholder="Any batch"
                            searchable={uploadLogs.length > 20}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Created date range</label>
                        <DateRangePicker
                            from={dateRange.from}
                            to={dateRange.to}
                            onChange={setDateRange}
                            ariaLabel="Created date range"
                        />
                    </div>
                    <Button onClick={doExport} disabled={exporting || !hasFilter}>
                        <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
                    </Button>
                </div>
                {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            </CardContent>
        </Card>
    );
}
