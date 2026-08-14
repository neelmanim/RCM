// ── views/upload.js — Upload Center orchestrator ──────────────────────────────
//
// Split from a 681-line monolith into focused modules:
//   upload_csv.js    — CSV file upload wizard handlers
//   upload_gsheet.js — Google Sheets import wizard handlers
// ──────────────────────────────────────────────────────────────────────────────
import * as api from '../api.js';
import { fetchUploadLogs, fetchAdminUsers, fetchPods, fetchUploadBatchMetrics, fetchBatchLeadDetail, rollbackUploadBatch } from '../api.js';
import { bindCsvEvents } from './upload_csv.js';
import { bindGSheetEvents } from './upload_gsheet.js';
import { ensureUTC } from '../utils.js';

// ── Pagination state for upload history ──────────────────────────────────────
let _histPage = 1;
const HIST_PAGE_SIZE = 10;

export async function renderUpload(container) {
    // ── Render shell immediately with skeleton history ─────────────────────
    // Pod/SDR dropdowns start empty and are populated once data arrives.
    const podOptions = '';
    const sdrOptions = '';

    // Skeleton placeholders for stats
    const _sk = (w, h = '14px', r = '6px') =>
        `<div style="background:var(--skeleton-bg,#e5e7eb);border-radius:${r};width:${w};height:${h};animation:skeletonPulse 1.4s ease-in-out infinite;"></div>`;


    container.innerHTML = `
    <style>
        @keyframes skeletonPulse {
            0%, 100% { opacity: 1; }
            50%      { opacity: 0.4; }
        }
    </style>
    <div class="upload-page">
        <!-- Header -->
        <div class="upload-header">
            <div>
                <h1 style="font-size:1.5rem;font-weight:700;margin:0;">📤 Upload Center</h1>
                <p style="font-size:0.85rem;color:var(--text-muted);margin:4px 0 0;">Upload and manage enriched lead sheets with smart field mapping</p>
            </div>
        </div>

        <!-- Stats Cards (skeleton → populated after fetch) -->
        <div class="upload-stats-grid">
            <div class="upload-stat-card">
                <span class="upload-stat-label">Total Uploads</span>
                <span class="upload-stat-value" id="uc-stat-uploads">${_sk('60px', '24px', '6px')}</span>
            </div>
            <div class="upload-stat-card">
                <span class="upload-stat-label">Leads Created</span>
                <span class="upload-stat-value" style="color:#059669;" id="uc-stat-created">${_sk('80px', '24px', '6px')}</span>
            </div>
            <div class="upload-stat-card">
                <span class="upload-stat-label">Leads Updated</span>
                <span class="upload-stat-value" style="color:#6366f1;" id="uc-stat-updated">${_sk('80px', '24px', '6px')}</span>
            </div>
            <div class="upload-stat-card">
                <span class="upload-stat-label">Duplicates Skipped</span>
                <span class="upload-stat-value" style="color:#f59e0b;" id="uc-stat-skipped">${_sk('80px', '24px', '6px')}</span>
            </div>
        </div>

        <!-- Upload Card with Tabs -->
        <div class="upload-card">
            <!-- Tab Bar -->
            <div id="uc-tab-bar" style="display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid var(--border-color);">
                <button type="button" class="uc-tab active" data-tab="file" style="padding:10px 24px;font-size:0.88rem;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid var(--primary-color);margin-bottom:-2px;color:var(--primary-color);display:inline-flex;align-items:center;gap:6px;">
                    📄 Upload File
                </button>
                <button type="button" class="uc-tab" data-tab="gsheet" style="padding:10px 24px;font-size:0.88rem;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-muted);display:inline-flex;align-items:center;gap:6px;">
                    📊 Google Sheets
                </button>

            </div>

            <!-- ═══ FILE UPLOAD TAB ═══ -->
            <div id="uc-tab-file">
                <!-- Step Indicator -->
                <div class="upload-stepper">
                    <div class="upload-step-item active" data-step="1"><span class="step-circle">1</span> Choose File</div>
                    <div class="step-line"></div>
                    <div class="upload-step-item" data-step="2"><span class="step-circle">2</span> Map Fields</div>
                    <div class="step-line"></div>
                    <div class="upload-step-item" data-step="3"><span class="step-circle">3</span> Results</div>
                </div>

                <!-- STEP 1: File Selection -->
                <div id="uc-step-1">
                    <div id="uc-dropzone" class="upload-dropzone">
                        <div class="upload-dropzone-icon">
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M24 18V30M18 24l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </div>
                        <p class="upload-dropzone-title">Drag & drop your file here</p>
                        <p class="upload-dropzone-subtitle">or <span class="upload-browse-link" id="uc-browse">browse</span> to choose a file</p>
                        <p class="upload-dropzone-formats">Supports <b>CSV</b>, <b>XLSX</b>, and <b>XLS</b></p>
                        <input type="file" id="uc-file-input" accept=".csv,.xlsx,.xls" style="display:none;">
                    </div>
                    <!-- Selected file card -->
                    <div id="uc-file-card" class="upload-file-card" style="display:none;">
                        <div class="upload-file-card-icon">📄</div>
                        <div class="upload-file-card-info">
                            <div id="uc-file-name" style="font-weight:600;font-size:0.9rem;"></div>
                            <div id="uc-file-size" style="font-size:0.8rem;color:var(--text-muted);"></div>
                        </div>
                        <button type="button" class="upload-file-card-remove" id="uc-file-remove" title="Remove file">&times;</button>
                    </div>

                    <!-- Update Existing Toggle -->
                    <div class="upload-toggle-row" style="flex-direction:column;align-items:stretch;gap:14px;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <label class="toggle-switch">
                                <input type="checkbox" id="uc-update-toggle">
                                <span class="toggle-slider"></span>
                            </label>
                            <div>
                                <div style="font-weight:600;font-size:0.85rem;">Update existing leads</div>
                                <div style="font-size:0.78rem;color:var(--text-muted);">If a matching lead is found, update its fields instead of skipping</div>
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;">Assign to Pod</div>
                            <select id="uc-assign-pod" aria-label="Assign to Pod" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);font-size:0.85rem;flex:1;max-width:300px;">
                                <option value="">— No pod assignment —</option>
                                ${podOptions}
                            </select>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;">or Assign to SDR</div>
                            <select id="uc-assign-sdr" aria-label="Assign to SDR" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);font-size:0.85rem;flex:1;max-width:300px;">
                                <option value="">— No SDR assignment —</option>
                                ${sdrOptions}
                            </select>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;">🏷️ Upload Tag</div>
                            <input type="text" id="uc-tag-input" placeholder="e.g. Apollo, Lusha, Hunter (optional)" maxlength="50" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);font-size:0.85rem;flex:1;max-width:300px;">
                        </div>
                        <button type="button" class="btn btn-primary" id="uc-next-btn" disabled style="padding:10px 28px;align-self:flex-end;">
                            Next: Preview & Map Fields →
                        </button>
                    </div>
                </div>

                <!-- STEP 2: Field Mapping -->
                <div id="uc-step-2" style="display:none;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                        <h4 style="margin:0;font-size:0.9rem;">Map file columns to lead fields</h4>
                        <span id="uc-file-badge" style="font-size:0.78rem;background:var(--primary-color);color:#fff;padding:3px 12px;border-radius:12px;"></span>
                    </div>
                    <div id="uc-mapping-container" style="max-height:280px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px;"></div>
                    <div id="uc-data-preview" style="margin-top:14px;max-height:150px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px;padding:10px;"></div>
                    <div style="display:flex;gap:10px;justify-content:space-between;margin-top:18px;">
                        <button type="button" class="btn btn-outline" id="uc-back-btn">← Back</button>
                        <button type="button" class="btn btn-primary" id="uc-import-btn" style="padding:10px 28px;">🚀 Import Leads</button>
                    </div>
                </div>

                <!-- STEP 3: Results -->
                <div id="uc-step-3" style="display:none;">
                    <div id="uc-result-banner"></div>
                    <div id="uc-skip-details" style="margin-top:16px;"></div>
                    <div style="display:flex;gap:10px;justify-content:center;margin-top:24px;">
                        <button type="button" class="btn btn-outline" id="uc-new-btn">📄 Upload Another</button>
                    </div>
                </div>
            </div>

            <!-- ═══ GOOGLE SHEETS TAB ═══ -->
            <div id="uc-tab-gsheet" style="display:none;">
                <!-- GS Step Indicator -->
                <div class="upload-stepper">
                    <div class="upload-step-item active" data-gs-step="1"><span class="step-circle">1</span> Paste URL</div>
                    <div class="step-line"></div>
                    <div class="upload-step-item" data-gs-step="2"><span class="step-circle">2</span> Map Fields</div>
                    <div class="step-line"></div>
                    <div class="upload-step-item" data-gs-step="3"><span class="step-circle">3</span> Results</div>
                </div>

                <!-- GS STEP 1: URL Input -->
                <div id="gs-step-1">
                    <div style="margin-bottom:16px;">
                        <label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:8px;">Google Sheets URL</label>
                        <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 12px;">Paste the link to a <b>publicly shared</b> Google Sheet. The sheet must be shared as "Anyone with the link can view".</p>
                        <input type="url" id="gs-url-input" class="filter-input" placeholder="https://docs.google.com/spreadsheets/d/..." style="width:100%;padding:12px 16px;font-size:0.88rem;border-radius:10px;">
                        <div id="gs-url-error" style="display:none;margin-top:8px;"></div>
                    </div>

                    <!-- Update Existing Toggle -->
                    <div class="upload-toggle-row" style="flex-direction:column;align-items:stretch;gap:14px;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <label class="toggle-switch">
                                <input type="checkbox" id="gs-update-toggle">
                                <span class="toggle-slider"></span>
                            </label>
                            <div>
                                <div style="font-weight:600;font-size:0.85rem;">Update existing leads</div>
                                <div style="font-size:0.78rem;color:var(--text-muted);">If a matching lead is found, update its fields instead of skipping</div>
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;">Assign to Pod</div>
                            <select id="gs-assign-pod" aria-label="Assign to Pod" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);font-size:0.85rem;flex:1;max-width:300px;">
                                <option value="">— No pod assignment —</option>
                                ${podOptions}
                            </select>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;">or Assign to SDR</div>
                            <select id="gs-assign-sdr" aria-label="Assign to SDR" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);font-size:0.85rem;flex:1;max-width:300px;">
                                <option value="">— No SDR assignment —</option>
                                ${sdrOptions}
                            </select>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;">🏷️ Upload Tag</div>
                            <input type="text" id="gs-tag-input" placeholder="e.g. Apollo, Lusha, Hunter (optional)" maxlength="50" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);font-size:0.85rem;flex:1;max-width:300px;">
                        </div>
                        <button type="button" class="btn btn-primary" id="gs-fetch-btn" style="padding:10px 28px;display:inline-flex;align-items:center;gap:6px;align-self:flex-end;">
                            📊 Fetch Sheet
                        </button>
                    </div>
                </div>

                <!-- GS STEP 2: Preview & Mapping -->
                <div id="gs-step-2" style="display:none;">
                    <div id="gs-sheet-info" style="margin-bottom:14px;"></div>
                    <div id="gs-large-warning" style="display:none;margin-bottom:14px;"></div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                        <h4 style="margin:0;font-size:0.9rem;">Map sheet columns to lead fields</h4>
                        <span id="gs-sheet-badge" style="font-size:0.78rem;background:#059669;color:#fff;padding:3px 12px;border-radius:12px;"></span>
                    </div>
                    <div id="gs-mapping-container" style="max-height:280px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px;"></div>
                    <div id="gs-data-preview" style="margin-top:14px;max-height:150px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px;padding:10px;"></div>
                    <div style="display:flex;gap:10px;justify-content:space-between;margin-top:18px;">
                        <button type="button" class="btn btn-outline" id="gs-back-btn">← Back</button>
                        <button type="button" class="btn btn-primary" id="gs-import-btn" style="padding:10px 28px;">🚀 Import Leads</button>
                    </div>
                </div>

                <!-- GS STEP 3: Results -->
                <div id="gs-step-3" style="display:none;">
                    <div id="gs-result-banner"></div>
                    <div id="gs-skip-details" style="margin-top:16px;"></div>
                    <div style="display:flex;gap:10px;justify-content:center;margin-top:24px;">
                        <button type="button" class="btn btn-outline" id="gs-new-btn">📊 Import Another Sheet</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Upload History -->
        <div class="upload-card">
            <h3 style="font-size:0.95rem;font-weight:600;margin:0 0 16px;">📋 Upload History</h3>
            <div id="uc-history-table">
                <!-- Skeleton rows while loading -->
                <div style="overflow-x:auto;"><table class="data-table" style="font-size:0.8rem;">
                    <thead><tr><th>File</th><th>By</th><th>Status</th><th>Created</th><th>Updated</th><th>Skipped</th><th>Errors</th><th>Date</th><th style="min-width:120px;">Actions</th></tr></thead>
                    <tbody>${Array(5).fill('').map(() => `
                        <tr>
                            <td>${_sk('140px')}</td>
                            <td>${_sk('80px')}</td>
                            <td>${_sk('60px')}</td>
                            <td>${_sk('30px')}</td>
                            <td>${_sk('30px')}</td>
                            <td>${_sk('30px')}</td>
                            <td>${_sk('30px')}</td>
                            <td>${_sk('100px')}</td>
                            <td>${_sk('70px', '22px', '6px')}</td>
                        </tr>
                    `).join('')}</tbody>
                </table></div>
            </div>
            <!-- Pagination controls -->
            <div id="uc-history-pager" style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid var(--border-color, #e5e7eb);"></div>
        </div>
    </div>`;

    const helpers = { showStep: _showStep, showGsStep: _showGsStep, formatSize: _formatSize, renderResultBanner: _renderResultBanner, refreshHistory: _refreshHistory, switchTab: _switchTab };
    bindCsvEvents(container, helpers);
    bindGSheetEvents(container, helpers);

    // ── Tab switching (extended to support Batch Tracker) ────────────────────
    container.querySelectorAll('#uc-tab-bar .uc-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            _switchTab(tab);
        });
    });

    // ── Fetch all data in parallel ──────────────────────────────────────────
    _histPage = 1;
    const [logsRes, podsRes, usersRes] = await Promise.allSettled([
        fetchUploadLogs(1, HIST_PAGE_SIZE),
        fetchPods(),
        fetchAdminUsers(),
    ]);

    // Populate pod & SDR dropdowns
    const pods  = podsRes.status  === 'fulfilled' ? podsRes.value  : [];
    const users = usersRes.status === 'fulfilled' ? usersRes.value : [];
    const sdrs  = (users || []).filter(u => u.role === 'SDR' || u.role === 'AE' || u.role === 'Pod Admin');

    // Fill pod dropdowns (file + gsheet tabs)
    ['uc-assign-pod', 'gs-assign-pod'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
            (pods || []).forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.name} (${p.member_count} SDRs)`;
                sel.appendChild(opt);
            });
        }
    });
    // Fill SDR dropdowns
    ['uc-assign-sdr', 'gs-assign-sdr'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
            sdrs.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = `${u.name} (${u.role})`;
                sel.appendChild(opt);
            });
        }
    });

    // Populate stats & history from paginated response
    const logsData = logsRes.status === 'fulfilled' ? logsRes.value : { logs: [], total: 0, page: 1, pages: 1, summary: {} };
    _updateStats(logsData.summary || {});
    _renderPaginatedHistory(logsData);
}

/** Populate stat cards from server-side summary data. */
function _updateStats(summary) {
    const el = (id, val) => {
        const e = document.getElementById(id);
        if (e) e.textContent = (val || 0).toLocaleString();
    };
    el('uc-stat-uploads', summary.total_uploads);
    el('uc-stat-created', summary.total_created);
    el('uc-stat-updated', summary.total_updated);
    el('uc-stat-skipped', summary.total_skipped);
}

/** Render paginated history table + pagination controls. */
function _renderPaginatedHistory(data) {
    const { logs = [], total = 0, page = 1, pages = 1 } = data;
    const histEl = document.getElementById('uc-history-table');
    const pagerEl = document.getElementById('uc-history-pager');
    if (!histEl) return;

    histEl.innerHTML = _renderHistory(logs);
    _bindHistoryEvents(histEl);

    // Pagination controls
    if (pagerEl) {
        const startIdx = (page - 1) * HIST_PAGE_SIZE + 1;
        const endIdx = Math.min(page * HIST_PAGE_SIZE, total);
        pagerEl.innerHTML = total > 0 ? `
            <span style="font-size:0.78rem;color:#71717a;">Showing ${startIdx}–${endIdx} of ${total} uploads</span>
            <div style="display:flex;align-items:center;gap:6px;">
                <button id="uc-hist-prev" ${page <= 1 ? 'disabled' : ''} style="padding:6px 12px;border-radius:8px;border:1px solid ${page <= 1 ? '#f4f4f5' : '#e4e4e7'};background:${page <= 1 ? '#fafafa' : '#fff'};font-size:0.78rem;font-weight:600;color:${page <= 1 ? '#d4d4d8' : '#475569'};cursor:${page <= 1 ? 'not-allowed' : 'pointer'};transition:all 0.15s;">← Prev</button>
                <span style="font-size:0.78rem;font-weight:600;color:#18181b;padding:0 8px;">${page} / ${pages}</span>
                <button id="uc-hist-next" ${page >= pages ? 'disabled' : ''} style="padding:6px 12px;border-radius:8px;border:1px solid ${page >= pages ? '#f4f4f5' : '#e4e4e7'};background:${page >= pages ? '#fafafa' : '#fff'};font-size:0.78rem;font-weight:600;color:${page >= pages ? '#d4d4d8' : '#475569'};cursor:${page >= pages ? 'not-allowed' : 'pointer'};transition:all 0.15s;">Next →</button>
            </div>
        ` : '';

        // Wire pagination buttons
        const prevBtn = document.getElementById('uc-hist-prev');
        const nextBtn = document.getElementById('uc-hist-next');
        if (prevBtn && page > 1) {
            prevBtn.addEventListener('click', () => _loadHistoryPage(page - 1));
        }
        if (nextBtn && page < pages) {
            nextBtn.addEventListener('click', () => _loadHistoryPage(page + 1));
        }
    }
}

/** Load a specific page of upload history. */
async function _loadHistoryPage(page) {
    _histPage = page;
    try {
        const data = await fetchUploadLogs(page, HIST_PAGE_SIZE);
        _renderPaginatedHistory(data);
    } catch(e) {
        console.error('Failed to load history page:', e);
    }
}

function _renderHistory(logs) {
    if (!logs.length) return '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px;">No uploads yet.</p>';
    return `<div style="overflow-x:auto;"><table class="data-table" style="font-size:0.8rem;">
        <thead><tr><th>File</th><th>By</th><th>Status</th><th>Created</th><th>Updated</th><th>Skipped</th><th>Errors</th><th>Date</th><th style="min-width:120px;">Actions</th></tr></thead>
        <tbody>${logs.map(l => {
            const sc = l.status === 'completed' ? '#10b981' : l.status === 'partial' ? '#f59e0b' : l.status === 'rolled_back' ? '#94a3b8' : '#ef4444';
            const si = l.status === 'completed' ? '✅' : l.status === 'partial' ? '⚠️' : l.status === 'rolled_back' ? '↩️' : '❌';
            const dt = l.created_at ? new Date(ensureUTC(l.created_at)).toLocaleString(undefined, { timeZoneName: 'short' }) : '—';
            const icon = (l.filename || '').startsWith('gsheet-') ? '📊' : '📄';
            const tagChip = l.tag ? ` <span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:0.68rem;font-weight:600;background:#6366f115;color:#6366f1;border:1px solid #6366f130;">🏷️ ${l.tag}</span>` : '';

            // Rollback button
            let rollbackHtml = '';
            if (l.can_rollback) {
                const h = Math.floor(l.rollback_hours_remaining);
                const m = Math.round((l.rollback_hours_remaining - h) * 60);
                const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
                rollbackHtml = `<button class="uc-rollback-btn" data-log-id="${l.id}" data-filename="${_ucHistEsc(l.filename)}" data-created="${l.created || 0}" style="padding:3px 10px;border:1px solid #ef4444;border-radius:6px;background:#fef2f2;color:#dc2626;font-size:0.7rem;font-weight:600;cursor:pointer;white-space:nowrap;" title="Rollback this upload (${timeStr} remaining)">↩️ Rollback <span style="color:#94a3b8;font-weight:400;">(${timeStr})</span></button>`;
            } else if (l.status === 'rolled_back') {
                rollbackHtml = '<span style="color:#94a3b8;font-size:0.72rem;font-weight:600;">↩️ Rolled back</span>';
            }

            return `<tr class="uc-history-row" data-log-id="${l.id}" style="cursor:pointer;">
                <td title="${l.filename}" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${icon} ${l.filename || '—'}${tagChip}</td>
                <td>${l.uploaded_by}</td>
                <td style="color:${sc};font-weight:600;">${si} ${l.status}</td>
                <td style="font-weight:600;color:#10b981;">${l.created}</td>
                <td style="font-weight:600;color:#6366f1;">${l.updated || 0}</td>
                <td>${l.skipped}</td>
                <td style="color:${l.errors > 0 ? '#ef4444' : 'inherit'};">${l.errors}</td>
                <td style="font-size:0.75rem;">${dt}</td>
                <td class="uc-actions-cell" style="text-align:center;">${rollbackHtml}</td>
            </tr>
            <tr class="uc-history-detail" data-detail-for="${l.id}" style="display:none;">
                <td colspan="9" style="padding:0;">
                    <div class="uc-detail-container" style="padding:12px 16px;background:var(--bg-secondary, #f8fafc);border-top:1px solid var(--border-color, #e2e8f0);">
                        <div class="uc-detail-body" style="font-size:0.8rem;color:var(--text-muted);">🔄 Click to load assignment details…</div>
                    </div>
                </td>
            </tr>`;
        }).join('')}</tbody>
    </table></div>`;
}

function _ucHistEsc(s) { return s ? String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;') : ''; }

/**
 * Custom confirmation modal — replaces native confirm()/alert() which can
 * be auto-dismissed by Chrome when event bubbling interferes.
 * @param {object} opts — { title, body, confirmText, cancelText, danger }
 * @returns {Promise<boolean>} — true if confirmed, false if cancelled
 */
function _showConfirmModal({ title, body, confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
    return new Promise(resolve => {
        // Remove any existing modal
        document.getElementById('uc-confirm-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'uc-confirm-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease;';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:var(--card-bg,#fff);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:440px;width:90%;padding:28px;animation:slideUp 0.2s ease;';

        modal.innerHTML = `
            <div style="font-size:1.1rem;font-weight:700;margin-bottom:16px;">${title}</div>
            <div style="font-size:0.88rem;line-height:1.5;color:var(--text-secondary,#555);">${body}</div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px;">
                ${cancelText ? `<button id="uc-confirm-cancel" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border-color,#ddd);background:var(--card-bg,#fff);color:var(--text-primary,#333);font-size:0.85rem;font-weight:600;cursor:pointer;">${cancelText}</button>` : ''}
                <button id="uc-confirm-ok" style="padding:8px 20px;border-radius:8px;border:none;background:${danger ? '#DC2626' : 'var(--primary,#4F46E5)'};color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">${confirmText}</button>
            </div>`;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Add animation keyframes if not present
        if (!document.getElementById('uc-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'uc-modal-styles';
            style.textContent = `
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            `;
            document.head.appendChild(style);
        }

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        document.getElementById('uc-confirm-ok').addEventListener('click', () => cleanup(true));
        document.getElementById('uc-confirm-cancel')?.addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) cleanup(false); });
        document.addEventListener('keydown', function handler(ev) {
            if (ev.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', handler); }
        });

        // Focus confirm button
        document.getElementById('uc-confirm-ok').focus();
    });
}

function _bindHistoryEvents(container) {
    // Expandable rows — click row to show/hide assignment details
    container.querySelectorAll('.uc-history-row').forEach(row => {
        row.addEventListener('click', async (e) => {
            // Don't expand if clicking the rollback button
            if (e.target.closest('.uc-rollback-btn')) return;

            const logId = row.dataset.logId;
            const detailRow = container.querySelector(`.uc-history-detail[data-detail-for="${logId}"]`);
            if (!detailRow) return;

            const isVisible = detailRow.style.display !== 'none';
            // Collapse all other detail rows
            container.querySelectorAll('.uc-history-detail').forEach(r => r.style.display = 'none');

            if (!isVisible) {
                detailRow.style.display = 'table-row';
                const body = detailRow.querySelector('.uc-detail-body');
                if (!detailRow.dataset.loaded) {
                    body.innerHTML = '<span style="color:var(--text-muted);">🔄 Loading assignment details…</span>';
                    try {
                        // Fetch ALL leads for accurate counts (remove per_page:15 cap)
                        const result = await fetchBatchLeadDetail(logId, { per_page: 200 });
                        detailRow.dataset.loaded = '1';
                        _renderHistoryDetail(body, result, logId);
                    } catch (err) {
                        body.innerHTML = `<span style="color:#ef4444;">⚠️ ${err.message}</span>`;
                    }
                }
            }
        });
    });

    // Rollback buttons
    container.querySelectorAll('.uc-rollback-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const logId = btn.dataset.logId;
            const filename = btn.dataset.filename;
            const created = btn.dataset.created;

            const confirmed = await _showConfirmModal({
                title: '⚠️ Rollback Confirmation',
                body: `
                    <div style="margin-bottom:12px;">
                        <strong>File:</strong> ${filename}<br>
                        <strong>Leads created:</strong> ${created}
                    </div>
                    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:0.85rem;color:#991B1B;">
                        This will <strong>permanently delete</strong> leads that:
                        <ul style="margin:6px 0 0 16px;padding:0;">
                            <li>Are still in "Lead Assigned", "Research", or "Parked" status</li>
                            <li>Have NOT been called</li>
                        </ul>
                    </div>
                    <div style="font-size:0.85rem;color:#166534;">
                        ✅ Leads that have progressed or been called will be <strong>protected</strong>.
                    </div>`,
                confirmText: '🗑️ Yes, Rollback',
                cancelText: 'Cancel',
                danger: true
            });
            if (!confirmed) return;

            btn.disabled = true;
            btn.innerHTML = '⏳ Rolling back…';

            try {
                const result = await rollbackUploadBatch(logId);
                await _showConfirmModal({
                    title: '✅ Rollback Complete',
                    body: `
                        <div style="font-size:0.9rem;">
                            <strong>${result.rolled_back}</strong> lead(s) deleted<br>
                            <strong>${result.protected}</strong> lead(s) protected
                            ${result.protected_details?.length > 0
                                ? `<div style="margin-top:8px;font-size:0.82rem;color:var(--text-muted);">
                                    Protected reasons:<ul style="margin:4px 0 0 16px;">${result.protected_details.map(d => `<li>${d.reason}</li>`).join('')}</ul>
                                   </div>`
                                : ''}
                        </div>`,
                    confirmText: 'OK',
                    cancelText: null,
                    danger: false
                });
                await _refreshHistory();
            } catch (err) {
                await _showConfirmModal({
                    title: '❌ Rollback Failed',
                    body: `<div style="color:#DC2626;">${err.message}</div>`,
                    confirmText: 'OK',
                    cancelText: null,
                    danger: false
                });
                btn.disabled = false;
                btn.innerHTML = '↩️ Rollback';
            }
        });
    });
}

function _renderHistoryDetail(body, result, logId) {
    const { leads = [], total = 0, assignment_summary } = result;
    if (!leads.length && !assignment_summary) {
        body.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem;">No leads found for this batch.</span>';
        return;
    }

    // Use server-side assignment_summary (accurate across ALL leads) if available,
    // otherwise fall back to client-side grouping from paginated data
    let sdrEntries;
    if (assignment_summary && assignment_summary.length > 0) {
        sdrEntries = assignment_summary.map(entry => ({
            sdr: entry.sdr,
            count: entry.count,
            statuses: entry.statuses || {},
        }));
    } else {
        // Fallback: group from paginated leads (may be partial)
        const sdrMap = {};
        leads.forEach(l => {
            const sdr = (l.assigned_to && l.assigned_to.length > 0) ? l.assigned_to.join(', ') : 'Unassigned';
            if (!sdrMap[sdr]) sdrMap[sdr] = { count: 0, statuses: {} };
            sdrMap[sdr].count++;
            const st = l.status || 'Unknown';
            sdrMap[sdr].statuses[st] = (sdrMap[sdr].statuses[st] || 0) + 1;
        });
        sdrEntries = Object.entries(sdrMap).map(([sdr, info]) => ({
            sdr, count: info.count, statuses: info.statuses,
        }));
    }

    const sdrRows = sdrEntries.map(({ sdr, count, statuses }) => {
        const statusChips = Object.entries(statuses).map(([st, cnt]) => {
            const color = st.includes('Meeting') ? '#059669' : st.includes('Calling') ? '#6366f1' : st === 'Research' ? '#7c3aed' : '#64748b';
            return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:0.68rem;font-weight:600;background:${color}15;color:${color};margin-right:4px;">${st}: ${cnt}</span>`;
        }).join('');
        const isUnassigned = sdr === 'Unassigned';
        return `<tr>
            <td style="font-weight:600;color:${isUnassigned ? '#f59e0b' : '#1e293b'};font-size:0.78rem;">${isUnassigned ? '⚠️ ' : '👤 '}${sdr}</td>
            <td style="font-weight:700;font-size:0.8rem;">${count}</td>
            <td>${statusChips}</td>
        </tr>`;
    }).join('');

    body.innerHTML = `
        <div style="margin-bottom:6px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;">📋 Assignment Summary · ${total} total lead${total !== 1 ? 's' : ''}</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
            <thead><tr style="border-bottom:1px solid var(--border-color, #e2e8f0);">
                <th style="text-align:left;padding:4px 8px;font-size:0.68rem;font-weight:700;text-transform:uppercase;color:#94a3b8;">SDR</th>
                <th style="text-align:left;padding:4px 8px;font-size:0.68rem;font-weight:700;text-transform:uppercase;color:#94a3b8;">Leads</th>
                <th style="text-align:left;padding:4px 8px;font-size:0.68rem;font-weight:700;text-transform:uppercase;color:#94a3b8;">Statuses</th>
            </tr></thead>
            <tbody>${sdrRows}</tbody>
        </table>`;
}

function _showStep(n) {
    [1, 2, 3].forEach(s => {
        const el = document.getElementById(`uc-step-${s}`);
        if (el) el.style.display = s === n ? 'block' : 'none';
    });
    document.querySelectorAll('.upload-step-item[data-step]').forEach(el => {
        const s = parseInt(el.dataset.step);
        el.className = 'upload-step-item' + (s === n ? ' active' : s < n ? ' done' : '');
    });
}

function _showGsStep(n) {
    [1, 2, 3].forEach(s => {
        const el = document.getElementById(`gs-step-${s}`);
        if (el) el.style.display = s === n ? 'block' : 'none';
    });
    document.querySelectorAll('.upload-step-item[data-gs-step]').forEach(el => {
        const s = parseInt(el.dataset.gsStep);
        el.className = 'upload-step-item' + (s === n ? ' active' : s < n ? ' done' : '');
    });
}

function _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function _switchTab(tab) {
    document.querySelectorAll('.uc-tab').forEach(t => {
        const isActive = t.dataset.tab === tab;
        t.style.borderBottomColor = isActive ? 'var(--primary-color)' : 'transparent';
        t.style.color = isActive ? 'var(--primary-color)' : 'var(--text-muted)';
        t.classList.toggle('active', isActive);
    });
    document.getElementById('uc-tab-file').style.display    = tab === 'file'    ? 'block' : 'none';
    document.getElementById('uc-tab-gsheet').style.display  = tab === 'gsheet'  ? 'block' : 'none';
        document.getElementById('uc-tab-tracker') && (document.getElementById('uc-tab-tracker').style.display = 'none');
}


// ── Shared helpers (used by both CSV and GSheet modules) ──────────────────────
function _renderResultBanner(banner, skipDetails, result) {
    const isSuccess = (result.created || 0) > 0 || (result.updated || 0) > 0;
    banner.className = `upload-result-banner ${isSuccess ? 'success' : 'warning'}`;
    banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:14px;">
            <span style="font-size:2.5rem;">${isSuccess ? '✅' : '⚠️'}</span>
            <div>
                <strong style="font-size:1.05rem;">${isSuccess ? 'Import Successful!' : 'Import Complete (with issues)'}</strong><br>
                <span style="font-size:0.85rem;margin-top:4px;display:inline-block;">
                    📊 Total rows: <b>${result.total_rows || 0}</b> &nbsp;·&nbsp;
                    ✅ Created: <b>${result.created || 0}</b> &nbsp;·&nbsp;
                    ${(result.updated || 0) > 0 ? `🔄 Updated: <b>${result.updated}</b> &nbsp;·&nbsp;` : ''}
                    ${(result.duplicates || 0) > 0 ? `🔁 Duplicates: <b>${result.duplicates}</b> &nbsp;·&nbsp;` : ''}
                    ⏭️ Skipped: <b>${result.skipped || 0}</b>
                    ${result.errors?.length ? ' &nbsp;·&nbsp; ❌ Errors: <b>' + result.errors.length + '</b>' : ''}
                </span>
            </div>
        </div>`;

    const allDetails = [...(result.dup_details || []), ...(result.update_details || [])];
    if (allDetails.length > 0) {
        skipDetails.innerHTML = `
            <div style="margin-top:8px;">
                <h4 style="font-size:0.85rem;margin:0 0 8px;color:var(--text-muted);">📋 Row Details (${allDetails.length} items)</h4>
                <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px;">
                    <table class="data-table" style="font-size:0.78rem;">
                        <thead><tr><th>Row</th><th>Lead</th><th>Reason</th></tr></thead>
                        <tbody>${allDetails.map(d => `<tr>
                            <td style="font-weight:600;">#${d.row}</td>
                            <td>${d.name || '—'}</td>
                            <td><span style="background:${d.reason?.includes('updated') ? '#EEF2FF' : '#FEF3C7'};color:${d.reason?.includes('updated') ? '#4F46E5' : '#92400E'};padding:2px 8px;border-radius:4px;font-size:0.75rem;">${d.reason}</span></td>
                        </tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>`;
    } else {
        skipDetails.innerHTML = '';
    }
}

/** Refresh upload history table and stats after an import. */
async function _refreshHistory() {
    try {
        _histPage = 1;  // Jump to page 1 to show newest upload
        const data = await fetchUploadLogs(1, HIST_PAGE_SIZE);
        _updateStats(data.summary || {});
        _renderPaginatedHistory(data);
    } catch(e) { /* ignore */ }
}

// ═════════════════════════════════════════════════════════════════
// ── Batch Tracker ────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

let _trackerState = { date_range: 'all', pod_id: '' };
let _trackerPods  = [];

async function _loadBatchTracker(container, pods) {
    _trackerPods = pods || [];
    const el = container.querySelector('#uc-tracker-content');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">🔄 Loading batch metrics…</div>';
    try {
        const result = await fetchUploadBatchMetrics(_trackerState);
        _renderBatchTrackerView(el, result);
    } catch (err) {
        el.innerHTML = `<div style="text-align:center;padding:40px;"><h3>⚠️ Failed to load</h3><p style="color:var(--text-muted);">${_ucEsc(err.message)}</p></div>`;
    }
}

function _renderBatchTrackerView(el, result) {
    const { batches = [], total_batches = 0, pod_filtered = false } = result;
    const totalLeads    = batches.reduce((s, b) => s + b.actual_in_db, 0);
    const totalMeetings = batches.reduce((s, b) => s + b.meetings, 0);
    const overallCvr    = totalLeads > 0 ? (totalMeetings / totalLeads * 100).toFixed(1) : '0.0';

    el.innerHTML = `
<style>
.uct-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px;}
.uct-stat{background:var(--surface-color,#fff);border-radius:10px;padding:14px 16px;border:1px solid var(--border-color,#e2e8f0);position:relative;overflow:hidden;}
.uct-stat::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;}
.uct-stat.c1::before{background:linear-gradient(90deg,#818cf8,#6366f1);}
.uct-stat.c2::before{background:linear-gradient(90deg,#34d399,#10b981);}
.uct-stat.c3::before{background:linear-gradient(90deg,#fbbf24,#f59e0b);}
.uct-stat.c4::before{background:linear-gradient(90deg,#f87171,#ef4444);}
.uct-stat-lbl{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted,#64748b);margin-bottom:3px;}
.uct-stat-num{font-size:1.5rem;font-weight:800;color:var(--text-color,#0f172a);letter-spacing:-.03em;}
.uct-filters{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center;}
.uct-sel{padding:6px 10px;border:1px solid var(--border-color,#e2e8f0);border-radius:7px;background:var(--surface-color,#fff);font-size:.8rem;color:#334155;outline:none;min-width:130px;cursor:pointer;font-family:inherit;}
.uct-sel:focus{border-color:#818cf8;}
.uct-list{display:flex;flex-direction:column;gap:10px;}
.uct-card{background:var(--surface-color,#fff);border-radius:12px;border:1px solid var(--border-color,#e2e8f0);overflow:hidden;transition:box-shadow .15s;}
.uct-card:hover{box-shadow:0 3px 14px rgba(0,0,0,.06);}
.uct-card-hdr{display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;}
.uct-card-icon{width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;}
.uct-icon-csv{background:#e0f2fe;}.uct-icon-gsheet{background:#dcfce7;}.uct-icon-legacy{background:#f1f5f9;}
.uct-card-title{flex:1;min-width:0;}
.uct-card-title h4{font-weight:700;font-size:.88rem;color:var(--text-color,#0f172a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.uct-card-title p{font-size:.72rem;color:var(--text-muted,#64748b);margin-top:2px;}
.uct-minis{display:flex;gap:18px;align-items:center;flex-shrink:0;}
.uct-mini{text-align:center;}
.uct-mini-num{font-size:1rem;font-weight:800;color:var(--text-color,#0f172a);}
.uct-mini-lbl{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#94a3b8);}
.uct-mini.green .uct-mini-num{color:#059669;}.uct-mini.purple .uct-mini-num{color:#7c3aed;}.uct-mini.red .uct-mini-num{color:#dc2626;}
.uct-chevron{color:#94a3b8;font-size:.7rem;transition:transform .2s;margin-left:6px;}
.uct-chevron.open{transform:rotate(90deg);}
.uct-badge-ok{background:#d1fae5;color:#065f46;padding:1px 7px;border-radius:10px;font-size:.65rem;font-weight:700;margin-left:6px;}
.uct-badge-err{background:#fee2e2;color:#991b1b;padding:1px 7px;border-radius:10px;font-size:.65rem;font-weight:700;margin-left:6px;}
.uct-badge-warn{background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:10px;font-size:.65rem;font-weight:700;margin-left:6px;}
.uct-detail{display:none;border-top:1px solid var(--border-color,#e2e8f0);padding:16px 18px;}
.uct-detail.open{display:block;}
.uct-bar-wrap{display:flex;height:10px;border-radius:5px;overflow:hidden;margin:10px 0 6px;background:#e2e8f0;}
.uct-bar-active{background:#818cf8;}.uct-bar-meeting{background:#10b981;}.uct-bar-disq{background:#f87171;}
.uct-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.72rem;color:#475569;}
.uct-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:4px;}
.uct-warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:7px;padding:8px 12px;font-size:.78rem;color:#92400e;margin-top:8px;}
.uct-leads-section{margin-top:14px;}
.uct-leads-section h6{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:8px;}
.uct-tbl{width:100%;border-collapse:collapse;font-size:.78rem;}
.uct-tbl thead th{background:#f1f5f9;padding:6px 10px;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0;}
.uct-tbl tbody tr{border-bottom:1px solid #f1f5f9;}
.uct-tbl tbody tr:hover{background:#fafafa;}
.uct-tbl td{padding:7px 10px;vertical-align:middle;}
.uct-lead-name{font-weight:600;color:#1e293b;cursor:pointer;}
.uct-lead-name:hover{color:#4f46e5;text-decoration:underline;}
.uct-lead-co{font-size:.72rem;color:#64748b;margin-top:1px;}
.uct-sdr-no{color:#f59e0b;font-style:italic;}
.uct-called-y{color:#059669;font-weight:700;font-size:.75rem;}
.uct-called-n{color:#dc2626;font-weight:700;font-size:.75rem;}
.uct-chip{display:inline-block;padding:1px 7px;border-radius:9px;font-size:.65rem;font-weight:700;}
.uct-chip.green{background:#d1fae5;color:#065f46;}.uct-chip.yellow{background:#fef3c7;color:#92400e;}.uct-chip.gray{background:#f1f5f9;color:#475569;}.uct-chip.red{background:#fee2e2;color:#991b1b;}
.uct-pg{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:.72rem;color:#64748b;}
.uct-pg button{padding:3px 10px;border:1px solid #e2e8f0;border-radius:5px;background:#fff;font-size:.75rem;cursor:pointer;font-family:inherit;}
.uct-pg button:hover{background:#f8fafc;}.uct-pg button:disabled{opacity:.4;cursor:default;}
.uct-loading{text-align:center;padding:16px;color:#94a3b8;font-size:.8rem;}
@media(max-width:900px){.uct-stats{grid-template-columns:repeat(2,1fr);}.uct-minis{display:none;}}
</style>

<div style="margin-bottom:14px;">
    <h2 style="font-size:1.1rem;font-weight:800;letter-spacing:-.02em;margin:0 0 3px;">📂 Batch Tracker</h2>
    <p style="font-size:.8rem;color:var(--text-muted);margin:0;">See what happened to every lead in each upload batch</p>
</div>

<div class="uct-stats">
    <div class="uct-stat c1"><div class="uct-stat-lbl">Total Batches</div><div class="uct-stat-num">${total_batches}</div></div>
    <div class="uct-stat c2"><div class="uct-stat-lbl">Leads in DB</div><div class="uct-stat-num">${totalLeads.toLocaleString()}</div></div>
    <div class="uct-stat c3"><div class="uct-stat-lbl">Meetings Booked</div><div class="uct-stat-num">${totalMeetings.toLocaleString()}</div></div>
    <div class="uct-stat c4"><div class="uct-stat-lbl">Conversion</div><div class="uct-stat-num">${overallCvr}%</div></div>
</div>

<div class="uct-filters">
    <select class="uct-sel" id="uct-date">
        <option value="all"    ${_trackerState.date_range==='all'     ?'selected':''}>All Time</option>
        <option value="today"  ${_trackerState.date_range==='today'   ?'selected':''}>Today</option>
        <option value="7d"     ${_trackerState.date_range==='7d'      ?'selected':''}>Last 7 Days</option>
        <option value="30d"    ${_trackerState.date_range==='30d'     ?'selected':''}>Last 30 Days</option>
        <option value="quarter"${_trackerState.date_range==='quarter' ?'selected':''}>This Quarter</option>
    </select>
    <select class="uct-sel" id="uct-pod">
        <option value="">All PODs</option>
        ${_trackerPods.map(p => `<option value="${p.id}" ${_trackerState.pod_id===String(p.id)?'selected':''}>${_ucEsc(p.name)}</option>`).join('')}
    </select>
    ${pod_filtered ? '<span style="font-size:.75rem;color:#7c3aed;font-weight:600;">🔍 POD filter active</span>' : ''}
</div>

${batches.length === 0
  ? '<div style="text-align:center;padding:40px;color:var(--text-muted);"><div style="font-size:2.5rem;margin-bottom:10px;">📭</div><h3>No batches found</h3><p>Try a wider date range</p></div>'
  : `<div class="uct-list">${batches.map((b, i) => _renderBatchCardUC(b, i)).join('')}</div>`
}`;

    // Filters
    const dateEl = el.querySelector('#uct-date');
    if (dateEl) dateEl.addEventListener('change', () => { _trackerState.date_range = dateEl.value; _loadBatchTracker(el.closest('.upload-page')?.parentElement || document.body, _trackerPods); });
    const podEl = el.querySelector('#uct-pod');
    if (podEl) podEl.addEventListener('change', () => { _trackerState.pod_id = podEl.value; _loadBatchTracker(el.closest('.upload-page')?.parentElement || document.body, _trackerPods); });

    // Expand cards → lazy-load leads
    el.querySelectorAll('.uct-card-hdr').forEach(hdr => {
        hdr.addEventListener('click', () => {
            const card    = hdr.closest('.uct-card');
            const detail  = hdr.nextElementSibling;
            const chevron = hdr.querySelector('.uct-chevron');
            if (!detail) return;
            const isOpen = detail.classList.toggle('open');
            chevron?.classList.toggle('open', isOpen);
            if (isOpen && !card.dataset.leadsLoaded) {
                card.dataset.leadsLoaded = '1';
                const leadsEl = card.querySelector('.uct-leads-body');
                _loadBatchLeadsUC(card.dataset.logId, leadsEl, 1);
            }
        });
    });
}

function _renderBatchCardUC(b, i) {
    const ICON = { csv: '📄', gsheet: '📊', legacy: '🗂️' };
    const iCls = { csv: 'uct-icon-csv', gsheet: 'uct-icon-gsheet', legacy: 'uct-icon-legacy' };
    const icon = ICON[b.source_type] || '📄';
    const iClass = iCls[b.source_type] || 'uct-icon-csv';
    const logId = b.log_id || 'legacy';
    const dt = b.uploaded_at ? new Date(ensureUTC(b.uploaded_at)).toLocaleDateString() : '—';
    const total = b.actual_in_db || 1;
    const ap = (b.active_count / total * 100).toFixed(1);
    const mp = (b.meetings     / total * 100).toFixed(1);
    const dp = (b.disqualified / total * 100).toFixed(1);
    const deletedDiff = b.log_created - b.actual_in_db;

    let badge = `<span class="uct-badge-ok">${b.log_created} created</span>`;
    if (b.log_errors  > 0) badge += `<span class="uct-badge-err">${b.log_errors} errors</span>`;
    if (b.log_skipped > 0) badge += `<span class="uct-badge-warn">${b.log_skipped} skipped</span>`;

    return `
<div class="uct-card" data-batch-idx="${i}" data-log-id="${logId}">
    <div class="uct-card-hdr">
        <div class="uct-card-icon ${iClass}">${icon}</div>
        <div class="uct-card-title">
            <h4>${_ucEsc(b.filename)} ${badge}</h4>
            <p>${dt} · by ${_ucEsc(b.uploaded_by)}</p>
        </div>
        <div class="uct-minis">
            <div class="uct-mini"><div class="uct-mini-num">${b.actual_in_db}</div><div class="uct-mini-lbl">In DB</div></div>
            <div class="uct-mini green"><div class="uct-mini-num">${b.meetings}</div><div class="uct-mini-lbl">Meetings</div></div>
            <div class="uct-mini purple"><div class="uct-mini-num">${b.conversion_rate}%</div><div class="uct-mini-lbl">Conv.</div></div>
            <div class="uct-mini red"><div class="uct-mini-num">${b.avg_calls}</div><div class="uct-mini-lbl">Avg Calls</div></div>
        </div>
        <span class="uct-chevron">▶</span>
    </div>
    <div class="uct-detail">
        <!-- Status bar -->
        <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:4px;">📊 Status Breakdown</div>
        <div class="uct-bar-wrap">
            <div class="uct-bar-active"  style="width:${ap}%;height:100%;" title="Active"></div>
            <div class="uct-bar-meeting" style="width:${mp}%;height:100%;" title="Meetings"></div>
            <div class="uct-bar-disq"    style="width:${dp}%;height:100%;" title="Disqualified"></div>
        </div>
        <div class="uct-legend">
            <span><span class="uct-dot" style="background:#818cf8;"></span>Active: <strong>${b.active_count}</strong> (${b.active_rate}%)</span>
            <span><span class="uct-dot" style="background:#10b981;"></span>Meetings: <strong>${b.meetings}</strong> (${b.conversion_rate}%)</span>
            <span><span class="uct-dot" style="background:#f87171;"></span>Disqualified: <strong>${b.disqualified}</strong> (${b.disq_rate}%)</span>
            <span>📞 Avg calls/lead: <strong>${b.avg_calls}</strong></span>
        </div>
        ${deletedDiff > 0 ? `<div class="uct-warn">⚠️ ${deletedDiff} lead${deletedDiff > 1 ? 's' : ''} deleted after upload (log recorded ${b.log_created})</div>` : ''}
        <!-- Leads -->
        <div class="uct-leads-section">
            <h6>👤 Leads in this batch — click name to open</h6>
            <div class="uct-leads-body"><div class="uct-loading">Expand to load leads…</div></div>
        </div>
    </div>
</div>`;
}

async function _loadBatchLeadsUC(logId, containerEl, page) {
    if (!containerEl) return;
    containerEl.innerHTML = '<div class="uct-loading">🔄 Loading leads…</div>';
    try {
        const result = await fetchBatchLeadDetail(logId, { pod_id: _trackerState.pod_id, page, per_page: 25 });
        _renderLeadRowsUC(logId, containerEl, result);
    } catch (err) {
        containerEl.innerHTML = `<div class="uct-loading">⚠️ ${_ucEsc(err.message)}</div>`;
    }
}

function _renderLeadRowsUC(logId, el, result) {
    const { leads = [], total = 0, page = 1, pages = 1 } = result;
    if (!leads.length) { el.innerHTML = '<div class="uct-loading">No leads found.</div>'; return; }

    const rows = leads.map(l => {
        const sc = _ucStatusCls(l.status);
        const oc = _ucOutcomeCls(l.last_call_outcome);
        const calledHtml = l.ever_called
            ? `<span class="uct-called-y">✅ ${l.call_count} call${l.call_count !== 1 ? 's' : ''}</span>`
            : `<span class="uct-called-n">❌ Not called</span>`;
        const outcomeHtml = l.last_call_outcome
            ? `<span class="uct-chip ${oc}">${_ucEsc(l.last_call_outcome)}</span>`
            : '<span style="color:#94a3b8;">—</span>';
        return `<tr>
            <td><div class="uct-lead-name" data-lead-id="${l.lead_id}">${_ucEsc(l.name)}</div><div class="uct-lead-co">${_ucEsc(l.company)}</div></td>
            <td><span class="uct-chip gray">${_ucEsc(l.status)}</span></td>
            <td class="${l.sdr_assigned ? '' : 'uct-sdr-no'}" style="font-size:.78rem;">${_ucEsc(l.sdr_name)}</td>
            <td>${calledHtml}</td>
            <td>${outcomeHtml}</td>
            <td style="font-size:.72rem;color:${l.research_done ? '#7c3aed' : '#94a3b8'}">${l.research_done ? '🔬 Done' : 'Not done'}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `
<table class="uct-tbl">
<thead><tr><th>Lead</th><th>Status</th><th>SDR</th><th>Called?</th><th>Last Outcome</th><th>Research</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="uct-pg">
    <span>${total} lead${total !== 1 ? 's' : ''}</span>
    <div style="display:flex;gap:5px;">
        <button class="uct-pg-prev" ${page<=1?'disabled':''} data-log="${logId}" data-page="${page-1}">← Prev</button>
        <span>${page}/${pages}</span>
        <button class="uct-pg-next" ${page>=pages?'disabled':''} data-log="${logId}" data-page="${page+1}">Next →</button>
    </div>
</div>`;

    el.querySelectorAll('.uct-pg-prev,.uct-pg-next').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            _loadBatchLeadsUC(btn.dataset.log, el, parseInt(btn.dataset.page, 10));
        });
    });
    el.querySelectorAll('.uct-lead-name[data-lead-id]').forEach(n => {
        n.addEventListener('click', () => {
            if (typeof window._navigateToDetail === 'function') window._navigateToDetail(n.dataset.leadId);
        });
    });
}

function _ucEsc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _ucStatusCls(s) { return (s||'').toLowerCase().replace(/\s+/g,'-'); }
function _ucOutcomeCls(o) {
    if (!o) return 'gray';
    const v = o.toLowerCase();
    if (v.includes('meeting')||v.includes('confirmed')) return 'green';
    if (v.includes('not interested')||v.includes('unreachable')||v.includes('wrong')) return 'red';
    if (v.includes('call back')||v.includes('text')||v.includes('referred')) return 'yellow';
    return 'gray';
}
