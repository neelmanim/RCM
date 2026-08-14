// ── views/upload_csv.js — CSV file upload wizard event handlers ───────────────
import { uploadLeadPreview, uploadLeadSheet } from '../api.js';
import { showToast } from '../utils.js';

// ── Module-level state for the CSV upload wizard ─────────────────────────────
let _csvText = '';
let _fieldMapping = {};
let _fileName = 'unknown';
let _updateExisting = false;
let _assignToPodId = null;
let _assignToUserId = null;

/**
 * Bind all CSV upload wizard events (file drag-drop, preview, column mapping, submit).
 * @param {HTMLElement} container
 * @param {object} helpers — { showStep, formatSize, renderResultBanner, refreshHistory }
 */
export function bindCsvEvents(container, helpers) {
    const { showStep: _showStep, formatSize: _formatSize, renderResultBanner: _renderResultBanner, refreshHistory: _refreshHistory, switchTab: _switchTab } = helpers;
    // Tab switching
    document.querySelectorAll('.uc-tab').forEach(tab => {
        tab.addEventListener('click', () => _switchTab(tab.dataset.tab));
    });

    const fileInput = document.getElementById('uc-file-input');
    const dropzone = document.getElementById('uc-dropzone');
    const fileCard = document.getElementById('uc-file-card');
    const nextBtn = document.getElementById('uc-next-btn');

    function showFileCard(file) {
        document.getElementById('uc-file-name').textContent = file.name;
        document.getElementById('uc-file-size').textContent = _formatSize(file.size) + ' · ' + file.name.split('.').pop().toUpperCase();
        fileCard.style.display = 'flex';
        dropzone.style.display = 'none';
        nextBtn.disabled = false;
    }

    function resetFile() {
        fileInput.value = '';
        fileCard.style.display = 'none';
        dropzone.style.display = '';
        nextBtn.disabled = true;
    }

    function handleFile(file) {
        if (!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['csv', 'xlsx', 'xls'].includes(ext)) {
            showToast('Invalid file type. Please select CSV, XLSX, or XLS.', 'warning');
            return;
        }
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        showFileCard(file);
    }

    // Dropzone events
    dropzone.addEventListener('click', () => fileInput.click());
    document.getElementById('uc-browse')?.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
    dropzone.addEventListener('dragenter', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', e => { e.preventDefault(); dropzone.classList.remove('drag-over'); });
    dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('drag-over'); handleFile(e.dataTransfer?.files?.[0]); });
    fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) showFileCard(fileInput.files[0]); });
    document.getElementById('uc-file-remove')?.addEventListener('click', resetFile);

    // Update existing toggle
    document.getElementById('uc-update-toggle')?.addEventListener('change', e => {
        _updateExisting = e.target.checked;
    });

    // Tag input
    let _tag = null;
    document.getElementById('uc-tag-input')?.addEventListener('input', e => {
        _tag = (e.target.value || '').trim() || null;
    });

    // Assign Pod dropdown (clears SDR when selected)
    document.getElementById('uc-assign-pod')?.addEventListener('change', e => {
        _assignToPodId = e.target.value || null;
        if (_assignToPodId) {
            _assignToUserId = null;
            const sdrSel = document.getElementById('uc-assign-sdr');
            if (sdrSel) sdrSel.value = '';
        }
    });

    // Assign SDR dropdown (clears Pod when selected)
    document.getElementById('uc-assign-sdr')?.addEventListener('change', e => {
        _assignToUserId = e.target.value || null;
        if (_assignToUserId) {
            _assignToPodId = null;
            const podSel = document.getElementById('uc-assign-pod');
            if (podSel) podSel.value = '';
        }
    });

    // STEP 1 → STEP 2
    nextBtn.addEventListener('click', async () => {
        const file = fileInput.files?.[0];
        if (!file) { showToast('Please select a file first.'); return; }
        const ext = file.name.split('.').pop().toLowerCase();
        _fileName = file.name;
        nextBtn.disabled = true;
        nextBtn.textContent = 'Reading file...';
        try {
            if (ext === 'xlsx' || ext === 'xls') {
                if (typeof XLSX === 'undefined') { showToast('Excel library not loaded. Please reload.'); return; }
                const ab = await file.arrayBuffer();
                const wb = XLSX.read(ab, { type: 'array' });
                _csvText = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
            } else {
                _csvText = await file.text();
            }
            const preview = await uploadLeadPreview(_csvText);
            _fieldMapping = preview.auto_mapping || {};

            document.getElementById('uc-file-badge').textContent = _fileName;

            const mapContainer = document.getElementById('uc-mapping-container');
            mapContainer.innerHTML = `<table class="data-table" style="font-size:0.82rem;">
                <thead><tr><th>File Column</th><th>Maps To</th></tr></thead>
                <tbody>${preview.headers.map(h => {
                    const mapped = _fieldMapping[h] || '';
                    const options = ['', ...preview.available_fields].map(f =>
                        `<option value="${f}" ${f === mapped ? 'selected' : ''}>${f || '— Skip —'}</option>`
                    ).join('');
                    return `<tr><td style="font-weight:600;">${h}</td><td><select class="uc-field-map" data-header="${h}" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);">${options}</select></td></tr>`;
                }).join('')}</tbody></table>`;

            const dataPreview = document.getElementById('uc-data-preview');
            if (preview.preview_rows?.length > 0) {
                dataPreview.innerHTML = `<h4 style="font-size:0.8rem;margin-bottom:8px;color:var(--text-muted);">Data Preview (${preview.preview_rows.length} rows · ${preview.headers.length} columns)</h4>
                <table class="data-table" style="font-size:0.75rem;"><thead><tr>${preview.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${preview.preview_rows.map(row => `<tr>${preview.headers.map(h => `<td>${row[h] || ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
            }

            mapContainer.querySelectorAll('.uc-field-map').forEach(sel => {
                sel.addEventListener('change', e => {
                    const header = e.target.dataset.header;
                    if (e.target.value) _fieldMapping[header] = e.target.value;
                    else delete _fieldMapping[header];
                });
            });

            _showStep(2);
        } catch (err) {
            showToast('Failed to parse file: ' + (err.message || err));
        }
        nextBtn.disabled = false;
        nextBtn.textContent = 'Next: Preview & Map Fields →';
    });

    // Back
    document.getElementById('uc-back-btn')?.addEventListener('click', () => _showStep(1));

    // STEP 2 → STEP 3: Import
    document.getElementById('uc-import-btn')?.addEventListener('click', async () => {
        const importBtn = document.getElementById('uc-import-btn');
        importBtn.disabled = true;
        importBtn.textContent = '⏳ Importing...';
        const resultBanner = document.getElementById('uc-result-banner');
        const skipDetails = document.getElementById('uc-skip-details');
        try {
            const result = await uploadLeadSheet(_csvText, _fieldMapping, true, _fileName, _updateExisting, _assignToUserId, _assignToPodId, _tag);
            _renderResultBanner(resultBanner, skipDetails, result);
            _showStep(3);
            _refreshHistory();
        } catch (err) {
            resultBanner.className = 'upload-result-banner error';
            resultBanner.innerHTML = `<div style="display:flex;align-items:center;gap:14px;">
                <span style="font-size:2.5rem;">❌</span>
                <div><strong style="font-size:1.05rem;">Import Failed</strong><br>
                <span style="font-size:0.85rem;">${err.message || err}</span></div></div>`;
            _showStep(3);
        }
        importBtn.disabled = false;
        importBtn.textContent = '🚀 Import Leads';
    });

    // Upload Another
    document.getElementById('uc-new-btn')?.addEventListener('click', () => {
        resetFile();
        _csvText = '';
        _fieldMapping = {};
        _fileName = 'unknown';
        _updateExisting = false;
        _assignToPodId = null;
        _assignToUserId = null;
        _tag = null;
        const toggle = document.getElementById('uc-update-toggle');
        if (toggle) toggle.checked = false;
        const podSelect = document.getElementById('uc-assign-pod');
        if (podSelect) podSelect.value = '';
        const sdrSelect = document.getElementById('uc-assign-sdr');
        if (sdrSelect) sdrSelect.value = '';
        const tagInput = document.getElementById('uc-tag-input');
        if (tagInput) tagInput.value = '';
        document.getElementById('uc-result-banner').innerHTML = '';
        document.getElementById('uc-skip-details').innerHTML = '';
        _showStep(1);
    });
}

