import React, { useRef, useState } from 'react';
import { UploadCloud, FileText, X } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { UploadService } from '../../../../services/api';
import { AssignmentFields, MappingTable, ResultSummary } from './UploadCenterCard';

const STEPS = ['Choose File', 'Map Fields', 'Results'];

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

// Ported from frontend/js/views/upload_csv.js's bindCsvEvents() flow:
// pick file -> read as text -> UploadService.previewCsv() for auto-mapping ->
// user adjusts mapping -> UploadService.uploadSheet() -> result banner.
// ponytail: CSV only, not XLSX/XLS — frontend-react has no xlsx parser
// dependency installed and package.json is off-limits for this task; add
// the `xlsx` dep (already used by the legacy page via a global) if XLSX
// support is required here.
export function CsvUploadFlow({ pods, sdrs }) {
    const [step, setStep] = useState(1);
    const [file, setFile] = useState(null);
    const [csvText, setCsvText] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [updateExisting, setUpdateExisting] = useState(false);
    const [podId, setPodId] = useState(null);
    const [sdrId, setSdrId] = useState(null);
    const [tag, setTag] = useState(null);
    const [headers, setHeaders] = useState([]);
    const [availableFields, setAvailableFields] = useState([]);
    const [previewRows, setPreviewRows] = useState([]);
    const [mapping, setMapping] = useState({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const fileInputRef = useRef(null);

    const pickFile = (f) => {
        if (!f) return;
        const ext = f.name.split('.').pop().toLowerCase();
        if (ext !== 'csv') { setError('Only CSV files are supported here.'); return; }
        setError('');
        setFile(f);
    };

    const goNext = async () => {
        if (!file) return;
        setBusy(true); setError('');
        try {
            const text = await file.text();
            setCsvText(text);
            const preview = await UploadService.previewCsv(text);
            setHeaders(preview.headers || []);
            setAvailableFields(preview.available_fields || []);
            setPreviewRows(preview.preview_rows || []);
            setMapping(preview.auto_mapping || {});
            setStep(2);
        } catch (e) {
            setError(e.response?.data?.detail || e.message || 'Failed to parse file');
        } finally { setBusy(false); }
    };

    const doImport = async () => {
        setBusy(true); setError(''); setResult(null);
        try {
            const res = await UploadService.uploadSheet(csvText, mapping, {
                filename: file.name,
                update_existing: updateExisting,
                assign_to_user_id: sdrId,
                assign_to_pod_id: podId,
                tag,
            });
            setResult(res);
            setStep(3);
        } catch (e) {
            setError(e.response?.data?.detail || e.message || 'Import failed');
            setStep(3);
        } finally { setBusy(false); }
    };

    const reset = () => {
        setStep(1); setFile(null); setCsvText(''); setUpdateExisting(false);
        setPodId(null); setSdrId(null); setTag(null); setHeaders([]);
        setAvailableFields([]); setPreviewRows([]); setMapping({}); setError(''); setResult(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div>
            <Stepper step={step} />
            {error && step !== 3 && <div className="mb-4 text-sm font-semibold text-red-600">{error}</div>}

            {step === 1 && (
                <div className="space-y-4">
                    {!file ? (
                        <div
                            className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
                            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer?.files?.[0]); }}
                        >
                            <UploadCloud className="mx-auto mb-2 text-slate-400" size={36} />
                            <p className="font-semibold text-slate-700 m-0">Drag & drop your file here</p>
                            <p className="text-sm text-slate-400 mt-1">or <span className="text-blue-600 font-semibold">browse</span> to choose a file</p>
                            <p className="text-xs text-slate-400 mt-2">Supports <b>CSV</b></p>
                            <input
                                ref={fileInputRef} type="file" accept=".csv" className="hidden"
                                onChange={(e) => pickFile(e.target.files?.[0])}
                            />
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
                            <FileText className="text-blue-500" size={24} />
                            <div className="flex-1">
                                <div className="font-semibold text-sm">{file.name}</div>
                                <div className="text-xs text-slate-400">{formatSize(file.size)}</div>
                            </div>
                            <button type="button" onClick={reset} className="text-slate-400 hover:text-slate-700" aria-label="Remove file">
                                <X size={18} />
                            </button>
                        </div>
                    )}

                    <AssignmentFields
                        updateExisting={updateExisting} onUpdateExisting={setUpdateExisting}
                        podId={podId} onPodId={setPodId} sdrId={sdrId} onSdrId={setSdrId}
                        tag={tag} onTag={setTag} pods={pods} sdrs={sdrs}
                    />

                    <div className="flex justify-end">
                        <Button onClick={goNext} disabled={!file || busy}>
                            {busy ? 'Reading file...' : 'Next: Preview & Map Fields →'}
                        </Button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-4">
                    <MappingTable
                        headers={headers} mapping={mapping} onChange={setMapping}
                        availableFields={availableFields} previewRows={previewRows} columnLabel="File Column"
                    />
                    <div className="flex justify-between">
                        <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                        <Button onClick={doImport} disabled={busy}>{busy ? 'Importing...' : 'Import Leads'}</Button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="space-y-5">
                    <ResultSummary result={result} error={result ? null : error} />
                    <div className="flex justify-center">
                        <Button variant="outline" onClick={reset}>Upload Another</Button>
                    </div>
                </div>
            )}
        </div>
    );
}

function Stepper({ step }) {
    return (
        <div className="flex items-center gap-2 mb-6 text-xs font-semibold">
            {STEPS.map((label, i) => {
                const n = i + 1;
                const active = n === step;
                const done = n < step;
                return (
                    <React.Fragment key={label}>
                        {i > 0 && <div className="w-8 h-px bg-slate-200" />}
                        <div className={`flex items-center gap-1.5 ${active ? 'text-blue-600' : done ? 'text-slate-500' : 'text-slate-300'}`}>
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${active ? 'bg-blue-600 text-white' : done ? 'bg-slate-200 text-slate-600' : 'bg-slate-100'}`}>{n}</span>
                            {label}
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
}
