// ── views/upload_gsheet.js — Google Sheets import wizard event handlers ───────
import { fetchGoogleSheetPreview, importGoogleSheet } from '../api.js';
import { showToast } from '../utils.js';

// ── Module-level state for the GSheet import wizard ──────────────────────────
let _gsUrl = '';
let _gsMapping = {};
let _gsSheetName = 'Google Sheet';
let _gsUpdateExisting = false;
let _gsAssignToPodId = null;
let _gsAssignToUserId = null;
let _gsTag = null;

/**
 * Bind all Google Sheets import wizard events (URL input, preview, column mapping, submit).
 * @param {HTMLElement} container
 * @param {object} helpers — { showGsStep, renderResultBanner, refreshHistory }
 */
export function bindGSheetEvents(container, helpers) {
    const { showGsStep: _showGsStep, renderResultBanner: _renderResultBanner, refreshHistory: _refreshHistory } = helpers;
    const fetchBtn = document.getElementById('gs-fetch-btn');
    const urlInput = document.getElementById('gs-url-input');
    const urlError = document.getElementById('gs-url-error');

    // Update existing toggle
    document.getElementById('gs-update-toggle')?.addEventListener('change', e => {
        _gsUpdateExisting = e.target.checked;
    });

    // Tag input
    document.getElementById('gs-tag-input')?.addEventListener('input', e => {
        _gsTag = (e.target.value || '').trim() || null;
    });

    // GS Assign Pod dropdown (clears SDR when selected)
    document.getElementById('gs-assign-pod')?.addEventListener('change', e => {
        _gsAssignToPodId = e.target.value || null;
        if (_gsAssignToPodId) {
            _gsAssignToUserId = null;
            const sdrSel = document.getElementById('gs-assign-sdr');
            if (sdrSel) sdrSel.value = '';
        }
    });

    // GS Assign SDR dropdown (clears Pod when selected)
    document.getElementById('gs-assign-sdr')?.addEventListener('change', e => {
        _gsAssignToUserId = e.target.value || null;
        if (_gsAssignToUserId) {
            _gsAssignToPodId = null;
            const podSel = document.getElementById('gs-assign-pod');
            if (podSel) podSel.value = '';
        }
    });

    // GS STEP 1 → STEP 2: Fetch
    fetchBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) { showToast('Please enter a Google Sheets URL.'); return; }
        _gsUrl = url;
        fetchBtn.disabled = true;
        fetchBtn.textContent = '⏳ Fetching...';
        urlError.style.display = 'none';
        urlInput.style.borderColor = '';

        try {
            const preview = await fetchGoogleSheetPreview(url);
            _gsMapping = preview.auto_mapping || {};
            _gsSheetName = preview.sheet_name || 'Google Sheet';

            // Show sheet info card
            document.getElementById('gs-sheet-info').innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:#F0FDF4;border:1px solid #86EFAC;border-radius:10px;">
                    <div style="width:40px;height:40px;background:#DCFCE7;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;">📊</div>
                    <div style="flex:1;">
                        <div style="color:#166534;font-size:0.9rem;font-weight:700;">${_gsSheetName}</div>
                        <div style="color:#15803D;font-size:0.78rem;">${preview.total_rows} rows · ${preview.headers.length} columns</div>
                    </div>
                </div>`;

            // Large sheet warning
            const largeWarn = document.getElementById('gs-large-warning');
            if (preview.large_sheet) {
                largeWarn.style.display = 'block';
                largeWarn.innerHTML = `
                    <div style="display:flex;align-items:center;gap:8px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 16px;">
                        <span style="font-size:14px;">⚠️</span>
                        <div style="color:#92400E;">
                            <div style="font-size:0.82rem;font-weight:600;">Large sheet detected — ${preview.total_rows.toLocaleString()} rows</div>
                            <div style="font-size:0.75rem;">Processing may take several minutes.</div>
                        </div>
                    </div>`;
            } else {
                largeWarn.style.display = 'none';
            }

            document.getElementById('gs-sheet-badge').textContent = `${preview.total_rows} rows`;

            // Mapping table (reuse same structure)
            const mapContainer = document.getElementById('gs-mapping-container');
            mapContainer.innerHTML = `<table class="data-table" style="font-size:0.82rem;">
                <thead><tr><th>Sheet Column</th><th>Maps To</th></tr></thead>
                <tbody>${preview.headers.map(h => {
                    const mapped = _gsMapping[h] || '';
                    const options = ['', ...preview.available_fields].map(f =>
                        `<option value="${f}" ${f === mapped ? 'selected' : ''}>${f || '— Skip —'}</option>`
                    ).join('');
                    return `<tr><td style="font-weight:600;">${h}</td><td><select class="gs-field-map" data-header="${h}" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);">${options}</select></td></tr>`;
                }).join('')}</tbody></table>`;

            // Data preview
            const dataPreview = document.getElementById('gs-data-preview');
            if (preview.preview_rows?.length > 0) {
                dataPreview.innerHTML = `<h4 style="font-size:0.8rem;margin-bottom:8px;color:var(--text-muted);">Data Preview (${preview.preview_rows.length} rows)</h4>
                <table class="data-table" style="font-size:0.75rem;"><thead><tr>${preview.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${preview.preview_rows.map(row => `<tr>${preview.headers.map(h => `<td>${row[h] || ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
            }

            mapContainer.querySelectorAll('.gs-field-map').forEach(sel => {
                sel.addEventListener('change', e => {
                    const header = e.target.dataset.header;
                    if (e.target.value) _gsMapping[header] = e.target.value;
                    else delete _gsMapping[header];
                });
            });

            _showGsStep(2);
        } catch (err) {
            // Parse structured error
            let errMsg = err.message || 'Failed to fetch Google Sheet';
            let errCode = '';
            try {
                const parsed = JSON.parse(errMsg);
                errMsg = parsed.message || errMsg;
                errCode = parsed.error_code || '';
            } catch(e) { /* not JSON */ }

            urlInput.style.borderColor = '#EF4444';
            urlError.style.display = 'block';

            // Pick icon based on error code
            const icon = errCode === 'access_denied' ? '🔒'
                        : errCode === 'network_timeout' ? '🌐'
                        : errCode === 'empty_sheet' ? '⚠️'
                        : '❌';
            const bgColor = errCode === 'empty_sheet' ? '#FFFBEB' : '#FEF2F2';
            const borderColor = errCode === 'empty_sheet' ? '#FDE68A' : '#FECACA';
            const textColor = errCode === 'empty_sheet' ? '#92400E' : '#DC2626';

            urlError.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:12px 16px;">
                    <span style="font-size:14px;">${icon}</span>
                    <div style="color:${textColor};font-size:0.82rem;font-weight:500;">${errMsg}</div>
                </div>`;
        }
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '📊 Fetch Sheet';
    });

    // GS Back
    document.getElementById('gs-back-btn')?.addEventListener('click', () => _showGsStep(1));

    // GS STEP 2 → STEP 3: Import
    document.getElementById('gs-import-btn')?.addEventListener('click', async () => {
        const importBtn = document.getElementById('gs-import-btn');
        importBtn.disabled = true;
        importBtn.textContent = '⏳ Importing...';
        const resultBanner = document.getElementById('gs-result-banner');
        const skipDetails = document.getElementById('gs-skip-details');

        try {
            const result = await importGoogleSheet(_gsUrl, _gsMapping, _gsUpdateExisting, _gsSheetName, _gsAssignToUserId, _gsAssignToPodId, _gsTag);
            _renderResultBanner(resultBanner, skipDetails, result);
            _showGsStep(3);
            _refreshHistory();
        } catch (err) {
            resultBanner.className = 'upload-result-banner error';
            resultBanner.innerHTML = `<div style="display:flex;align-items:center;gap:14px;">
                <span style="font-size:2.5rem;">❌</span>
                <div><strong style="font-size:1.05rem;">Import Failed</strong><br>
                <span style="font-size:0.85rem;">${err.message || err}</span></div></div>`;
            _showGsStep(3);
        }
        importBtn.disabled = false;
        importBtn.textContent = '🚀 Import Leads';
    });

    // Import Another Sheet
    document.getElementById('gs-new-btn')?.addEventListener('click', () => {
        _gsUrl = '';
        _gsMapping = {};
        _gsSheetName = 'Google Sheet';
        _gsUpdateExisting = false;
        _gsAssignToPodId = null;
        _gsAssignToUserId = null;
        _gsTag = null;
        const toggle = document.getElementById('gs-update-toggle');
        if (toggle) toggle.checked = false;
        const gsPodSelect = document.getElementById('gs-assign-pod');
        if (gsPodSelect) gsPodSelect.value = '';
        const gsSdrSelect = document.getElementById('gs-assign-sdr');
        if (gsSdrSelect) gsSdrSelect.value = '';
        const gsTagInput = document.getElementById('gs-tag-input');
        if (gsTagInput) gsTagInput.value = '';
        document.getElementById('gs-url-input').value = '';
        document.getElementById('gs-url-input').style.borderColor = '';
        document.getElementById('gs-url-error').style.display = 'none';
        document.getElementById('gs-result-banner').innerHTML = '';
        document.getElementById('gs-skip-details').innerHTML = '';
        _showGsStep(1);
    });
}
