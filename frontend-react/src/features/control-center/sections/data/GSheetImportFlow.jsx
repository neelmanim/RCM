import React, { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { UploadService } from '../../../../services/api';
import { AssignmentFields, MappingTable, ResultSummary } from './UploadCenterCard';

// Ported from frontend/js/views/upload_gsheet.js's bindGSheetEvents() flow:
// paste URL -> UploadService.previewGSheet() -> adjust mapping ->
// UploadService.importGSheet() -> result banner. Error payloads from the
// backend are a JSON string in `detail` with { error_code, message } —
// same structured-error parsing as the legacy handler.
export function GSheetImportFlow({ pods, sdrs }) {
    const [step, setStep] = useState(1);
    const [url, setUrl] = useState('');
    const [updateExisting, setUpdateExisting] = useState(false);
    const [podId, setPodId] = useState(null);
    const [sdrId, setSdrId] = useState(null);
    const [tag, setTag] = useState(null);
    const [sheetName, setSheetName] = useState('Google Sheet');
    const [headers, setHeaders] = useState([]);
    const [availableFields, setAvailableFields] = useState([]);
    const [previewRows, setPreviewRows] = useState([]);
    const [mapping, setMapping] = useState({});
    const [meta, setMeta] = useState(null); // { total_rows, large_sheet }
    const [busy, setBusy] = useState(false);
    const [urlError, setUrlError] = useState('');
    const [result, setResult] = useState(null);
    const [importError, setImportError] = useState('');

    const parseError = (e) => {
        const detail = e.response?.data?.detail;
        if (typeof detail === 'string') {
            try {
                const parsed = JSON.parse(detail);
                return parsed.message || detail;
            } catch { return detail; }
        }
        return e.message || 'Failed to fetch Google Sheet';
    };

    const doFetch = async () => {
        if (!url.trim()) { setUrlError('Please enter a Google Sheets URL.'); return; }
        setBusy(true); setUrlError('');
        try {
            const preview = await UploadService.previewGSheet(url.trim());
            setSheetName(preview.sheet_name || 'Google Sheet');
            setHeaders(preview.headers || []);
            setAvailableFields(preview.available_fields || []);
            setPreviewRows(preview.preview_rows || []);
            setMapping(preview.auto_mapping || {});
            setMeta({ total_rows: preview.total_rows, large_sheet: preview.large_sheet });
            setStep(2);
        } catch (e) {
            setUrlError(parseError(e));
        } finally { setBusy(false); }
    };

    const doImport = async () => {
        setBusy(true); setImportError(''); setResult(null);
        try {
            const res = await UploadService.importGSheet(url.trim(), mapping, {
                update_existing: updateExisting,
                sheet_name: sheetName,
                assign_to_user_id: sdrId,
                assign_to_pod_id: podId,
                tag,
            });
            setResult(res);
            setStep(3);
        } catch (e) {
            setImportError(parseError(e));
            setStep(3);
        } finally { setBusy(false); }
    };

    const reset = () => {
        setStep(1); setUrl(''); setUpdateExisting(false); setPodId(null); setSdrId(null);
        setTag(null); setSheetName('Google Sheet'); setHeaders([]); setAvailableFields([]);
        setPreviewRows([]); setMapping({}); setMeta(null); setUrlError(''); setResult(null); setImportError('');
    };

    return (
        <div className="space-y-5">
            {step === 1 && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Google Sheets URL</label>
                        <p className="text-xs text-slate-400 mb-2">
                            Paste the link to a publicly shared Google Sheet. The sheet must be shared as
                            "Anyone with the link can view".
                        </p>
                        <Input
                            type="url" placeholder="https://docs.google.com/spreadsheets/d/..."
                            value={url} onChange={(e) => setUrl(e.target.value)} containerClassName="mb-0"
                            error={urlError}
                        />
                    </div>

                    <AssignmentFields
                        updateExisting={updateExisting} onUpdateExisting={setUpdateExisting}
                        podId={podId} onPodId={setPodId} sdrId={sdrId} onSdrId={setSdrId}
                        tag={tag} onTag={setTag} pods={pods} sdrs={sdrs}
                    />

                    <div className="flex justify-end">
                        <Button onClick={doFetch} disabled={busy}>
                            <FileSpreadsheet size={14} /> {busy ? 'Fetching...' : 'Fetch Sheet'}
                        </Button>
                    </div>
                </>
            )}

            {step === 2 && (
                <>
                    <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3.5">
                        <FileSpreadsheet className="text-green-600" size={22} />
                        <div>
                            <div className="font-bold text-green-800 text-sm">{sheetName}</div>
                            <div className="text-xs text-green-700">{meta?.total_rows} rows · {headers.length} columns</div>
                        </div>
                    </div>
                    {meta?.large_sheet && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="text-sm font-semibold text-amber-800">Large sheet detected — {meta.total_rows.toLocaleString()} rows</div>
                            <div className="text-xs text-amber-700">Processing may take several minutes.</div>
                        </div>
                    )}
                    <MappingTable
                        headers={headers} mapping={mapping} onChange={setMapping}
                        availableFields={availableFields} previewRows={previewRows} columnLabel="Sheet Column"
                    />
                    <div className="flex justify-between">
                        <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                        <Button onClick={doImport} disabled={busy}>{busy ? 'Importing...' : 'Import Leads'}</Button>
                    </div>
                </>
            )}

            {step === 3 && (
                <>
                    <ResultSummary result={result} error={importError || null} />
                    <div className="flex justify-center">
                        <Button variant="outline" onClick={reset}>Import Another Sheet</Button>
                    </div>
                </>
            )}
        </div>
    );
}
