import React, { useEffect, useState } from 'react';
import { FileText, FileSpreadsheet } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../../components/ui/Card';
import { Tabs } from '../../../../components/ui/Tabs';
import { Switch } from '../../../../components/ui/Switch';
import { Input } from '../../../../components/ui/Input';
import { Select } from '../../../../components/ui/Select';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../../components/ui/Table';
import { PodsService, AdminService } from '../../../../services/api';
import { CsvUploadFlow } from './CsvUploadFlow';
import { GSheetImportFlow } from './GSheetImportFlow';

const UPLOAD_TABS = [
    { key: 'file', label: 'Upload File', icon: FileText },
    { key: 'gsheet', label: 'Google Sheets', icon: FileSpreadsheet },
];

// Ported from frontend/js/views/upload.js (shell + history) /
// upload_csv.js (file wizard) / upload_gsheet.js (sheet wizard). This card
// covers the file picker + mapping + result summary, and URL input + result
// summary. Upload history + rollback now live in the sibling
// UploadHistoryCard.jsx (added 2026-09-04) — batch-tracker stays out of
// scope, it's unreachable dead code in the legacy page itself (no tab button
// renders it), so there's nothing to port.
export function DataSectionUploadCard() {
    const [tab, setTab] = useState('file');
    const [pods, setPods] = useState([]);
    const [sdrs, setSdrs] = useState([]);

    useEffect(() => {
        PodsService.getAll().then(setPods).catch(() => setPods([]));
        AdminService.getUsers().then((users) => {
            setSdrs((users || []).filter((u) => ['SDR', 'AE', 'Pod Admin'].includes(u.role)));
        }).catch(() => setSdrs([]));
    }, []);

    return (
        <Card>
            <CardHeader title="Upload Center" subtitle="Upload and manage enriched lead sheets with smart field mapping" />
            <CardContent>
                <Tabs tabs={UPLOAD_TABS} active={tab} onChange={setTab} className="mb-5" />
                {tab === 'file'
                    ? <CsvUploadFlow pods={pods} sdrs={sdrs} />
                    : <GSheetImportFlow pods={pods} sdrs={sdrs} />}
            </CardContent>
        </Card>
    );
}

// ── Shared: pod/SDR assignment + tag row (both wizards, step 1) ────────────
export function AssignmentFields({ updateExisting, onUpdateExisting, podId, onPodId, sdrId, onSdrId, tag, onTag, pods, sdrs }) {
    return (
        <div className="space-y-4">
            <Switch
                checked={updateExisting}
                onChange={(e) => onUpdateExisting(e.target.checked)}
                label="Update existing leads"
                hint="If a matching lead is found, update its fields instead of skipping"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Assign to Pod</label>
                    <Select
                        ariaLabel="Assign to Pod"
                        className="w-full justify-between"
                        value={podId || ''}
                        onChange={(v) => { onPodId(v || null); if (v) onSdrId(null); }}
                        placeholder="— No pod assignment —"
                        options={pods.map((p) => ({ value: p.id, label: `${p.name} (${p.member_count} SDRs)` }))}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">or Assign to SDR</label>
                    <Select
                        ariaLabel="Assign to SDR"
                        className="w-full justify-between"
                        value={sdrId || ''}
                        onChange={(v) => { onSdrId(v || null); if (v) onPodId(null); }}
                        placeholder="— No SDR assignment —"
                        options={sdrs.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))}
                        searchable
                    />
                </div>
            </div>
            <Input
                label="Upload Tag"
                placeholder="e.g. Apollo, Lusha, Hunter (optional)"
                maxLength={50}
                value={tag || ''}
                onChange={(e) => onTag(e.target.value.trim() || null)}
                containerClassName="mb-0"
            />
        </div>
    );
}

// ── Shared: column-mapping table + data preview (both wizards, step 2) ────
export function MappingTable({ headers, mapping, onChange, availableFields, previewRows, columnLabel }) {
    return (
        <div className="space-y-4">
            <Table>
                <TableHead>
                    <TableRow>
                        <TableHeader>{columnLabel}</TableHeader>
                        <TableHeader>Maps To</TableHeader>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {headers.map((h) => (
                        <TableRow key={h}>
                            <TableCell className="font-semibold">{h}</TableCell>
                            <TableCell>
                                <Select
                                    ariaLabel={`Maps to for ${h}`}
                                    value={mapping[h] || ''}
                                    onChange={(v) => {
                                        const next = { ...mapping };
                                        if (v) next[h] = v; else delete next[h];
                                        onChange(next);
                                    }}
                                    placeholder="— Skip —"
                                    options={availableFields.map((f) => ({ value: f, label: f }))}
                                    searchable
                                />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {previewRows?.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-2">
                        Data preview ({previewRows.length} rows · {headers.length} columns)
                    </h4>
                    <Table>
                        <TableHead>
                            <tr>{headers.map((h) => <TableHeader key={h}>{h}</TableHeader>)}</tr>
                        </TableHead>
                        <TableBody>
                            {previewRows.map((row, i) => (
                                <TableRow key={i}>
                                    {headers.map((h) => <TableCell key={h} className="text-xs">{row[h] || ''}</TableCell>)}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

// ── Shared: success/error result banner + row-level skip/update details ───
export function ResultSummary({ result, error }) {
    if (error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <div className="font-bold text-red-700">Import failed</div>
                <div className="text-sm text-red-600 mt-1">{error}</div>
            </div>
        );
    }
    if (!result) return null;
    const isSuccess = (result.created || 0) > 0 || (result.updated || 0) > 0;
    const details = [...(result.dup_details || []), ...(result.update_details || [])];
    return (
        <div className="space-y-4">
            <div className={`rounded-xl border p-4 ${isSuccess ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className={`font-bold ${isSuccess ? 'text-green-700' : 'text-amber-700'}`}>
                    {isSuccess ? 'Import successful' : 'Import complete (with issues)'}
                </div>
                <div className="text-sm text-slate-600 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Total rows: <b>{result.total_rows || 0}</b></span>
                    <span>Created: <b>{result.created || 0}</b></span>
                    {(result.updated || 0) > 0 && <span>Updated: <b>{result.updated}</b></span>}
                    {(result.duplicates || 0) > 0 && <span>Duplicates: <b>{result.duplicates}</b></span>}
                    <span>Skipped: <b>{result.skipped || 0}</b></span>
                    {result.errors?.length > 0 && <span>Errors: <b>{result.errors.length}</b></span>}
                </div>
            </div>
            {details.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-2">Row details ({details.length})</h4>
                    <Table>
                        <TableHead>
                            <tr><TableHeader>Row</TableHeader><TableHeader>Lead</TableHeader><TableHeader>Reason</TableHeader></tr>
                        </TableHead>
                        <TableBody>
                            {details.map((d, i) => (
                                <TableRow key={i}>
                                    <TableCell className="font-semibold">#{d.row}</TableCell>
                                    <TableCell>{d.name || '—'}</TableCell>
                                    <TableCell className="text-xs">{d.reason}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
