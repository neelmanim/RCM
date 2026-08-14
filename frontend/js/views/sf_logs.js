// ── views/sf_logs.js — Salesforce Integration Logs Dashboard ─────────────────
import { isSuperAdmin } from '../auth.js';
import { fetchSfLogs, fetchSfLogDetail, exportSfLogsCsvUrl } from '../api.js';
import { authHeaders } from '../auth.js';
import { ensureUTC } from '../utils.js';

let currentFilters = { page: 1, per_page: 20 };
let autoRefreshTimer = null;

export async function renderSfLogs(container) {
    if (!container || !isSuperAdmin) return;

    container.innerHTML = `
        <div class="admin-panel">
            <div class="page-header">
                <div>
                    <h1 class="page-title">📋 Salesforce Integration Logs</h1>
                    <p class="page-subtitle">Monitor all Salesforce data sync activities in real time.</p>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--text-muted);cursor:pointer;">
                        <input type="checkbox" id="sf-auto-refresh" style="cursor:pointer;">
                        Auto-refresh (30s)
                    </label>
                    <button class="btn btn-outline" id="sf-export-csv" style="padding:6px 12px;font-size:0.8rem;">📥 Export CSV</button>
                    <button class="btn btn-primary" id="sf-refresh-btn" style="padding:6px 14px;font-size:0.85rem;">🔄 Refresh</button>
                </div>
            </div>

            <!-- Filters -->
            <div class="info-card" style="margin-bottom:16px;padding:16px;">
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:12px;align-items:end;">
                    <div>
                        <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Status</label>
                        <select id="sf-filter-status" class="form-control" style="padding:6px 10px;font-size:0.82rem;width:100%;">
                            <option value="">All</option>
                            <option value="success">🟢 Success</option>
                            <option value="failed">🔴 Failed</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Operation</label>
                        <select id="sf-filter-operation" class="form-control" style="padding:6px 10px;font-size:0.82rem;width:100%;">
                            <option value="">All</option>
                            <option value="create">Create</option>
                            <option value="update">Update</option>
                            <option value="upsert">Upsert</option>
                            <option value="fetch">Fetch</option>
                            <option value="query">Query</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Object</label>
                        <select id="sf-filter-object" class="form-control" style="padding:6px 10px;font-size:0.82rem;width:100%;">
                            <option value="">All</option>
                            <option value="Lead">Lead</option>
                            <option value="User">User</option>
                            <option value="RecordType">RecordType</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">From</label>
                        <input type="date" id="sf-filter-date-from" class="form-control" style="padding:6px 10px;font-size:0.82rem;width:100%;">
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">To</label>
                        <input type="date" id="sf-filter-date-to" class="form-control" style="padding:6px 10px;font-size:0.82rem;width:100%;">
                    </div>
                    <div style="grid-column: span 2;">
                        <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Search</label>
                        <div style="display:flex;gap:8px;">
                            <input type="text" id="sf-filter-search" class="form-control" placeholder="Record ID / Name / Email..." style="padding:6px 10px;font-size:0.82rem;flex:1;">
                            <button class="btn btn-outline" id="sf-clear-filters" style="padding:6px 12px;font-size:0.78rem;white-space:nowrap;">✕ Clear</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Summary stats -->
            <div id="sf-log-stats" style="margin-bottom:16px;"></div>

            <!-- Log table -->
            <div class="info-card" style="padding:0;overflow:hidden;">
                <div id="sf-log-table" style="overflow-x:auto;"></div>
            </div>

            <!-- Pagination -->
            <div id="sf-log-pagination" style="margin-top:16px;"></div>

            <!-- Detail modal is created dynamically at body level -->
        </div>`;

    // Bind filter events
    const applyFilters = () => {
        currentFilters = {
            page: 1,
            per_page: 20,
            status: document.getElementById('sf-filter-status')?.value || '',
            operation_type: document.getElementById('sf-filter-operation')?.value || '',
            sf_object: document.getElementById('sf-filter-object')?.value || '',
            date_from: document.getElementById('sf-filter-date-from')?.value || '',
            date_to: document.getElementById('sf-filter-date-to')?.value || '',
            search: document.getElementById('sf-filter-search')?.value || '',
        };
        _loadLogs();
    };

    ['sf-filter-status', 'sf-filter-operation', 'sf-filter-object', 'sf-filter-date-from', 'sf-filter-date-to'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', applyFilters);
    });

    let searchTimeout;
    document.getElementById('sf-filter-search')?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(applyFilters, 400);
    });

    document.getElementById('sf-clear-filters')?.addEventListener('click', () => {
        ['sf-filter-status', 'sf-filter-operation', 'sf-filter-object', 'sf-filter-date-from', 'sf-filter-date-to', 'sf-filter-search'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        applyFilters();
    });

    document.getElementById('sf-refresh-btn')?.addEventListener('click', () => _loadLogs());

    document.getElementById('sf-export-csv')?.addEventListener('click', () => {
        const url = exportSfLogsCsvUrl(currentFilters);
        fetch(url, { headers: authHeaders() })
            .then(r => r.blob())
            .then(blob => {
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = 'sf_integration_logs.csv';
                link.click();
                URL.revokeObjectURL(blobUrl);
            })
            .catch(e => console.error('CSV export failed:', e));
    });

    // Auto-refresh toggle
    document.getElementById('sf-auto-refresh')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            autoRefreshTimer = setInterval(() => _loadLogs(), 30000);
        } else {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    });

    // Detail modal close on backdrop click — handled in _showLogDetail

    await _loadLogs();
}


async function _loadLogs() {
    const tableEl = document.getElementById('sf-log-table');
    const paginationEl = document.getElementById('sf-log-pagination');
    const statsEl = document.getElementById('sf-log-stats');
    if (!tableEl) return;

    tableEl.innerHTML = '<div style="padding:12px;">' + Array(5).fill('').map(() => '<div style="display:flex;gap:16px;padding:10px 0;border-bottom:1px solid var(--border-color,#e5e7eb);"><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;width:100px;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;width:60px;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;flex:1;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div></div>').join('') + '</div>';

    const data = await fetchSfLogs(currentFilters);
    const logs = data.logs || [];

    // Stats row
    const successCount = logs.filter(l => l.status === 'success').length;
    const failedCount = logs.filter(l => l.status === 'failed').length;
    if (statsEl) {
        statsEl.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;">
                <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);letter-spacing:0.5px;">Total Logs</div>
                    <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${data.total}</div>
                </div>
                <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);letter-spacing:0.5px;">This Page</div>
                    <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${logs.length}</div>
                </div>
                <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:#22c55e;letter-spacing:0.5px;">🟢 Success</div>
                    <div style="font-size:1.5rem;font-weight:700;color:#22c55e;">${successCount}</div>
                </div>
                <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:#ef4444;letter-spacing:0.5px;">🔴 Failed</div>
                    <div style="font-size:1.5rem;font-weight:700;color:#ef4444;">${failedCount}</div>
                </div>
            </div>`;
    }

    if (!logs.length) {
        tableEl.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:48px 24px;">
            <div style="font-size:2rem;margin-bottom:8px;">📋</div>
            <p>No integration logs found. Sync some leads to see activity here.</p>
        </div>`;
        if (paginationEl) paginationEl.innerHTML = '';
        return;
    }

    tableEl.innerHTML = `
        <table class="data-table" style="width:100%;table-layout:fixed;">
            <thead><tr>
                <th style="width:130px;">Timestamp</th>
                <th style="width:80px;">Operation</th>
                <th style="width:60px;">Status</th>
                <th>Name</th>
                <th>Email</th>
                <th style="width:140px;">Record ID</th>
                <th style="width:48px;"></th>
            </tr></thead>
            <tbody>${logs.map(log => _renderLogRow(log)).join('')}</tbody>
        </table>`;

    // Bind row click for detail
    tableEl.querySelectorAll('.sf-log-detail-btn').forEach(btn => {
        btn.addEventListener('click', () => _showLogDetail(btn.dataset.logId));
    });

    // Pagination
    if (paginationEl) {
        const { page, total_pages } = data;
        const buttons = [];
        if (page > 1) buttons.push(`<button class="btn btn-outline btn-sm sf-page-btn" data-page="${page - 1}">← Prev</button>`);
        buttons.push(`<span style="font-size:0.82rem;color:var(--text-muted);padding:4px 8px;">Page ${page} of ${total_pages}</span>`);
        if (page < total_pages) buttons.push(`<button class="btn btn-outline btn-sm sf-page-btn" data-page="${page + 1}">Next →</button>`);
        paginationEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:8px;">${buttons.join('')}</div>`;
        paginationEl.querySelectorAll('.sf-page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentFilters.page = parseInt(btn.dataset.page);
                _loadLogs();
            });
        });
    }
}


function _renderLogRow(log) {
    const ts = log.timestamp ? new Date(ensureUTC(log.timestamp)).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : '—';
    const statusIcon = log.status === 'success' ? '🟢' : '🔴';
    const opBadgeColor = {
        create: '#3b82f6', update: '#f59e0b', upsert: '#8b5cf6', fetch: '#06b6d4', query: '#6b7280'
    }[log.operation_type] || '#6b7280';

    const name = [log.first_name, log.last_name].filter(Boolean).join(' ') || '—';
    const email = log.email || '—';
    const recordId = log.record_identifier || '—';

    return `<tr class="sf-log-row" style="cursor:pointer;">
        <td style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ts}</td>
        <td><span style="background:${opBadgeColor};color:white;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:600;text-transform:uppercase;">${log.operation_type}</span></td>
        <td style="text-align:center;">${statusIcon}</td>
        <td style="font-size:0.82rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${email}</td>
        <td style="font-family:monospace;font-size:0.7rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${recordId}">${recordId}</td>
        <td><button class="btn btn-outline btn-sm sf-log-detail-btn" data-log-id="${log.id}" style="padding:3px 8px;font-size:0.72rem;">🔍</button></td>
    </tr>`;
}


async function _showLogDetail(logId) {
    // Create or find overlay at body level (not inside scrollable containers)
    let overlay = document.getElementById('sf-log-detail-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sf-log-detail-overlay';
        overlay.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;';
        const panel = document.createElement('div');
        panel.id = 'sf-log-detail-panel';
        panel.style.cssText = 'background:var(--bg-primary);border-radius:16px;width:580px;max-width:92vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:28px;position:relative;';
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        // Close on backdrop click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.style.display = 'none';
        });
    }
    const panel = document.getElementById('sf-log-detail-panel');
    if (!panel) return;

    overlay.style.display = 'flex';
    panel.innerHTML = '<div style="padding:20px;">' + Array(4).fill('').map(() => '<div style="display:flex;gap:12px;padding:8px 0;"><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;width:80px;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;flex:1;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div></div>').join('') + '</div>';

    const log = await fetchSfLogDetail(logId);
    if (!log) {
        panel.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:48px;">Log not found.</p>`;
        return;
    }

    const ts = log.timestamp ? new Date(ensureUTC(log.timestamp)).toLocaleString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : '—';
    const statusIcon = log.status === 'success' ? '🟢' : '🔴';
    const name = [log.first_name, log.last_name].filter(Boolean).join(' ') || '—';

    // Parse fields_updated
    let fieldsHtml = '';
    if (log.fields_updated) {
        let fields = log.fields_updated;
        if (typeof fields === 'string') {
            try { fields = JSON.parse(fields); } catch { fields = [fields]; }
        }
        if (Array.isArray(fields) && fields.length) {
            fieldsHtml = `
            <div style="background:var(--bg-secondary);border-radius:8px;padding:12px;margin-bottom:12px;">
                <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Fields Updated</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                    ${fields.map(f => `<span style="background:var(--primary-color);color:white;padding:2px 8px;border-radius:4px;font-size:0.72rem;">${f}</span>`).join('')}
                </div>
            </div>`;
        }
    }

    panel.innerHTML = `
        <button id="sf-detail-close" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted);padding:4px 8px;border-radius:6px;transition:background 0.15s;" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background='none'">✕</button>

        <h3 style="margin:0 0 20px 0;font-size:1.1rem;">📋 Log Details</h3>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Status</div>
                <div style="font-size:1rem;font-weight:700;margin-top:2px;">${statusIcon} ${log.status.toUpperCase()}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Timestamp</div>
                <div style="font-size:0.82rem;font-weight:500;margin-top:2px;">${ts}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Operation</div>
                <div style="font-size:0.9rem;font-weight:600;text-transform:capitalize;margin-top:2px;">${log.operation_type}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Object</div>
                <div style="font-size:0.9rem;font-weight:500;margin-top:2px;">${log.sf_object}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Source</div>
                <div style="font-size:0.82rem;font-weight:500;margin-top:2px;">${log.source_system || '—'}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Record ID</div>
                <div style="font-size:0.75rem;font-family:monospace;word-break:break-all;margin-top:2px;">${log.record_identifier || '—'}</div>
            </div>
        </div>

        <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;margin-bottom:12px;">
            <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);margin-bottom:2px;">Lead Info</div>
            <div style="font-size:0.85rem;"><b>${name}</b> ${log.email ? `· ${log.email}` : ''}</div>
        </div>

        ${fieldsHtml}

        ${log.error_message ? `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:12px;">
            <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:#ef4444;margin-bottom:4px;">Error Message</div>
            <pre style="font-size:0.78rem;color:#dc2626;white-space:pre-wrap;word-break:break-all;margin:0;font-family:monospace;">${log.error_message}</pre>
        </div>` : ''}

        ${log.request_payload ? `
        <div style="margin-bottom:12px;">
            <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);margin-bottom:4px;">Request Payload</div>
            <pre style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:12px;font-size:0.75rem;overflow-x:auto;max-height:180px;margin:0;white-space:pre-wrap;word-break:break-all;">${JSON.stringify(log.request_payload, null, 2)}</pre>
        </div>` : ''}

        ${log.response_payload ? `
        <div style="margin-bottom:12px;">
            <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);margin-bottom:4px;">Response Payload</div>
            <pre style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:12px;font-size:0.75rem;overflow-x:auto;max-height:180px;margin:0;white-space:pre-wrap;word-break:break-all;">${JSON.stringify(log.response_payload, null, 2)}</pre>
        </div>` : ''}
    `;

    document.getElementById('sf-detail-close')?.addEventListener('click', () => {
        document.getElementById('sf-log-detail-overlay').style.display = 'none';
    });

    // Close on Escape key
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.style.display = 'none';
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// Cleanup auto-refresh when navigating away
export function cleanupSfLogs() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}
