// ── audit_logs.js — System Logs (Activity, Logins, Feedback, SF Logs, Error Logs, Call Logs, Perf Health) ──
import * as api from '../api.js';
import { showLoader } from '../utils.js';
import { isSuperAdmin, authHeaders, API_BASE } from '../auth.js';
import { fetchSfLogs, exportSfLogsCsvUrl } from '../api.js';
import { renderSfLogRow, showSfLogDetail } from './audit_sf_logs.js';

export async function renderAuditLogs(container) {
    showLoader(container);

    let activeTab = 'activity';  // 'activity' | 'logins' | 'feedback' | 'sf-logs' | 'error-logs' | 'call-logs' | 'perf-health'
    let activityPage = 1;
    let loginPage = 1;
    let feedbackPage = 1;
    let errorLogPage = 1;
    let callLogPage  = 1;  // ENH-03
    let callLogFilters = { sdr: '', provider: '', outcome: '', date_from: '', date_to: '', status: '' };  // ENH-03
    let errorLogFilters = { severity: '', category: '', resolved: 'false' };
    let searchQuery = '';
    let dateFrom = '';
    let dateTo = '';
    let debounceTimer = null;
    const PER_PAGE = 20;

    // SF Logs state
    let sfFilters = { page: 1, per_page: 20 };
    let sfAutoRefreshTimer = null;
    let errorBadgeTimer = null;  // 60s badge poll

    container.innerHTML = `
        <div class="fade-in">
            <div class="page-header">
                <div>
                    <h1 class="page-title">🗂️ System Logs</h1>
                    <p class="page-subtitle">Activity, logins, feedback, Salesforce integration, errors & call history</p>
                </div>
            </div>

            <div style="display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid var(--border-color);flex-wrap:wrap;">
                <button class="audit-tab active" data-tab="activity" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--primary-color);border-bottom:2px solid var(--primary-color);margin-bottom:-2px;transition:all 0.2s;">Activity Log</button>
                <button class="audit-tab" data-tab="logins" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">Login History</button>
                <button class="audit-tab" data-tab="feedback" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">Feedback</button>
                <button class="audit-tab" data-tab="sf-logs" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">SF Logs</button>
                <button class="audit-tab" id="error-logs-tab-btn" data-tab="error-logs" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;position:relative;">
                    🚨 Error Logs
                    <span id="error-logs-badge" style="display:none;position:absolute;top:6px;right:6px;background:#ef4444;color:#fff;font-size:0.6rem;font-weight:700;border-radius:9px;padding:1px 5px;line-height:1.4;">0</span>
                </button>
                <button class="audit-tab" id="call-logs-tab-btn" data-tab="call-logs" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;position:relative;">
                    📞 Call Logs
                    <span id="call-logs-badge" style="display:none;position:absolute;top:6px;right:6px;background:#ef4444;color:#fff;font-size:0.6rem;font-weight:700;border-radius:9px;padding:1px 5px;line-height:1.4;">0</span>
                </button>
                ${isSuperAdmin ? `<button class="audit-tab" id="perf-health-tab-btn" data-tab="perf-health" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">⚡ Perf Health</button>` : ''}
            </div>

            <!-- Common filters (search + date) — hidden for SF Logs which has its own filters -->
            <div id="audit-common-filters" style="display:flex;gap:12px;margin-bottom:16px;align-items:end;flex-wrap:wrap;">
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Search</label>
                    <input type="text" id="audit-search" placeholder="🔍 Search..." class="filter-input" style="min-width:220px;">
                </div>
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">From</label>
                    <input type="date" id="audit-date-from" class="filter-input" style="min-width:140px;">
                </div>
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">To</label>
                    <input type="date" id="audit-date-to" class="filter-input" style="min-width:140px;">
                </div>
                <button class="btn btn-outline" id="audit-clear-filters" style="padding:6px 14px;font-size:0.82rem;">✕ Clear</button>
            </div>

            <!-- SF Logs specific filters (only shown on SF Logs tab) -->
            <div id="sf-logs-filters" style="display:none;margin-bottom:16px;">
                <div class="info-card" style="padding:16px;">
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
                <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                    <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--text-muted);cursor:pointer;">
                        <input type="checkbox" id="sf-auto-refresh" style="cursor:pointer;">
                        Auto-refresh (30s)
                    </label>
                    <button class="btn btn-outline" id="sf-export-csv" style="padding:6px 12px;font-size:0.8rem;">📥 Export CSV</button>
                    <button class="btn btn-primary" id="sf-refresh-btn" style="padding:6px 14px;font-size:0.85rem;">🔄 Refresh</button>
                </div>
            </div>

            <!-- Error Logs specific filters -->
            <div id="error-logs-filters" style="display:none;margin-bottom:16px;">
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                    <div>
                        <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Severity</label>
                        <select id="el-filter-severity" class="form-control" style="padding:6px 10px;font-size:0.82rem;min-width:120px;">
                            <option value="">All Severities</option>
                            <option value="critical">🔴 Critical</option>
                            <option value="warning">🟡 Warning</option>
                            <option value="info">🔵 Info</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Category</label>
                        <select id="el-filter-category" class="form-control" style="padding:6px 10px;font-size:0.82rem;min-width:120px;">
                            <option value="">All Categories</option>
                            <option value="api">API</option>
                            <option value="auth">Auth</option>
                            <option value="research">AI Research</option>
                            <option value="dialer">Dialer</option>
                            <option value="salesforce">Salesforce</option>
                            <option value="upload">Upload</option>
                            <option value="general">General</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Status</label>
                        <select id="el-filter-resolved" class="form-control" style="padding:6px 10px;font-size:0.82rem;min-width:130px;">
                            <option value="false">🔴 Unresolved</option>
                            <option value="">All</option>
                            <option value="true">✅ Resolved</option>
                        </select>
                    </div>
                    <button class="btn btn-outline" id="el-clear-filters" style="padding:6px 14px;font-size:0.82rem;">✕ Clear</button>
                    <button class="btn btn-primary" id="el-refresh-btn" style="padding:6px 14px;font-size:0.85rem;">🔄 Refresh</button>
                </div>
            </div>

            <!-- Call Logs specific filters (ENH-03) -->
            <div id="call-logs-filters" style="display:none;margin-bottom:16px;flex-wrap:wrap;gap:10px;align-items:flex-end;">
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">SDR</label>
                    <select id="cl-filter-sdr" class="form-control" style="padding:6px 10px;font-size:0.82rem;min-width:150px;">
                        <option value="">All SDRs</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Provider</label>
                    <select id="cl-filter-provider" class="form-control" style="padding:6px 10px;font-size:0.82rem;min-width:130px;">
                        <option value="">All Providers</option>
                        <option value="rcm">📞 RCM</option>
                        <option value="aircall">✈️ Aircall</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Outcome</label>
                    <select id="cl-filter-outcome" class="form-control" style="padding:6px 10px;font-size:0.82rem;min-width:140px;">
                        <option value="">All Outcomes</option>
                        <option value="Call Completed">Call Completed</option>
                        <option value="Meeting">Meeting Booked</option>
                        <option value="No Answer">No Answer</option>
                        <option value="Left Voicemail">Voicemail</option>
                        <option value="Not Interested">Not Interested</option>
                        <option value="Callback">Callback</option>
                        <option value="Unreachable">Unreachable</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Status</label>
                    <select id="cl-filter-status" class="form-control" style="padding:6px 10px;font-size:0.82rem;min-width:130px;">
                        <option value="">All</option>
                        <option value="completed">✅ Completed</option>
                        <option value="failed">❌ Failed</option>
                        <option value="missed">📵 Missed</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">From</label>
                    <input type="date" id="cl-date-from" class="filter-input" style="min-width:140px;">
                </div>
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">To</label>
                    <input type="date" id="cl-date-to" class="filter-input" style="min-width:140px;">
                </div>
                <button class="btn btn-outline" id="cl-clear-filters" style="padding:6px 14px;font-size:0.82rem;">✕ Clear</button>
                <button class="btn btn-primary" id="cl-refresh-btn" style="padding:6px 14px;font-size:0.85rem;">🔄 Refresh</button>
            </div>

            <div id="audit-content">
                <div style="text-align:center;padding:40px;color:var(--text-muted);">Loading...</div>
            </div>
            <div id="audit-pagination" style="display:flex;justify-content:center;align-items:center;gap:8px;padding:20px 0;"></div>
        </div>`;

    // ── Tab switching ─────────────────────────────────────────────────────────
    container.querySelectorAll('.audit-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            searchQuery = '';
            dateFrom = '';
            dateTo = '';
            const searchEl = document.getElementById('audit-search');
            if (searchEl) searchEl.value = '';
            const dfEl = document.getElementById('audit-date-from');
            if (dfEl) dfEl.value = '';
            const dtEl = document.getElementById('audit-date-to');
            if (dtEl) dtEl.value = '';
            activityPage = 1; loginPage = 1; feedbackPage = 1;

            container.querySelectorAll('.audit-tab').forEach(t => {
                t.style.color = 'var(--text-muted)';
                t.style.borderBottomColor = 'transparent';
                t.classList.remove('active');
            });
            tab.style.color = 'var(--primary-color)';
            tab.style.borderBottomColor = 'var(--primary-color)';
            tab.classList.add('active');

            // Toggle filter bars
            const isElTab  = activeTab === 'error-logs';
            const isSfTab  = activeTab === 'sf-logs';
            const isClTab  = activeTab === 'call-logs';  // ENH-03
            const isPerfTab = activeTab === 'perf-health';
            document.getElementById('audit-common-filters').style.display = (isSfTab || isElTab || isClTab || isPerfTab) ? 'none' : 'flex';
            document.getElementById('sf-logs-filters').style.display      = isSfTab  ? 'block' : 'none';
            document.getElementById('error-logs-filters').style.display   = isElTab  ? 'flex'  : 'none';
            const clFilters = document.getElementById('call-logs-filters');
            if (clFilters) clFilters.style.display = isClTab ? 'flex' : 'none';

            // Cleanup timers when switching away
            if (activeTab !== 'sf-logs' && sfAutoRefreshTimer) {
                clearInterval(sfAutoRefreshTimer); sfAutoRefreshTimer = null;
                const cb = document.getElementById('sf-auto-refresh');
                if (cb) cb.checked = false;
            }

            loadTab();
        });
    });

    // ── Common search + date filters ──────────────────────────────────────────
    document.getElementById('audit-search').addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchQuery = e.target.value.trim();
            activityPage = 1; loginPage = 1; feedbackPage = 1;
            loadTab();
        }, 400);
    });

    document.getElementById('audit-date-from').addEventListener('change', (e) => {
        dateFrom = e.target.value;
        activityPage = 1; loginPage = 1; feedbackPage = 1;
        loadTab();
    });
    document.getElementById('audit-date-to').addEventListener('change', (e) => {
        dateTo = e.target.value;
        activityPage = 1; loginPage = 1; feedbackPage = 1;
        loadTab();
    });
    document.getElementById('audit-clear-filters').addEventListener('click', () => {
        searchQuery = ''; dateFrom = ''; dateTo = '';
        document.getElementById('audit-search').value = '';
        document.getElementById('audit-date-from').value = '';
        document.getElementById('audit-date-to').value = '';
        activityPage = 1; loginPage = 1; feedbackPage = 1;
        loadTab();
    });

    // ── SF Logs filter bindings ───────────────────────────────────────────────
    const applySfFilters = () => {
        sfFilters = {
            page: 1, per_page: 20,
            status: document.getElementById('sf-filter-status')?.value || '',
            operation_type: document.getElementById('sf-filter-operation')?.value || '',
            sf_object: document.getElementById('sf-filter-object')?.value || '',
            date_from: document.getElementById('sf-filter-date-from')?.value || '',
            date_to: document.getElementById('sf-filter-date-to')?.value || '',
            search: document.getElementById('sf-filter-search')?.value || '',
        };
        loadTab();
    };
    ['sf-filter-status', 'sf-filter-operation', 'sf-filter-object', 'sf-filter-date-from', 'sf-filter-date-to'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', applySfFilters);
    });
    let sfSearchTimeout;
    document.getElementById('sf-filter-search')?.addEventListener('input', () => {
        clearTimeout(sfSearchTimeout);
        sfSearchTimeout = setTimeout(applySfFilters, 400);
    });
    document.getElementById('sf-clear-filters')?.addEventListener('click', () => {
        ['sf-filter-status', 'sf-filter-operation', 'sf-filter-object', 'sf-filter-date-from', 'sf-filter-date-to', 'sf-filter-search'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        applySfFilters();
    });
    document.getElementById('sf-refresh-btn')?.addEventListener('click', () => loadTab());

    // ── Error Logs filter bindings ────────────────────────────────────────────
    const applyElFilters = () => {
        errorLogFilters = {
            severity: document.getElementById('el-filter-severity')?.value || '',
            category: document.getElementById('el-filter-category')?.value || '',
            resolved: document.getElementById('el-filter-resolved')?.value ?? 'false',
        };
        errorLogPage = 1;
        loadTab();
    };
    document.getElementById('el-filter-severity')?.addEventListener('change', applyElFilters);
    document.getElementById('el-filter-category')?.addEventListener('change', applyElFilters);
    document.getElementById('el-filter-resolved')?.addEventListener('change', applyElFilters);
    document.getElementById('el-refresh-btn')?.addEventListener('click', () => loadTab());
    document.getElementById('el-clear-filters')?.addEventListener('click', () => {
        ['el-filter-severity','el-filter-category'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const rs = document.getElementById('el-filter-resolved'); if (rs) rs.value = 'false';
        applyElFilters();
    });

    // ── Live error badge: poll every 60s ─────────────────────────────────────
    async function _refreshErrorBadge() {
        try {
            const r = await fetch(
                `${API_BASE}/api/admin/error-logs/summary`,
                { headers: { 'Authorization': `Bearer ${localStorage.getItem('crm_token')}` } }
            );
            if (!r.ok) return;
            const s = await r.json();
            const badge = document.getElementById('error-logs-badge');
            if (!badge) return;
            const n = s.unresolved ?? 0;
            if (n > 0) { badge.textContent = n > 99 ? '99+' : n; badge.style.display = 'inline'; }
            else { badge.style.display = 'none'; }
        } catch { /* silent */ }
    }
    _refreshErrorBadge();
    errorBadgeTimer = setInterval(_refreshErrorBadge, 60_000);
    document.getElementById('sf-export-csv')?.addEventListener('click', () => {
        const url = exportSfLogsCsvUrl(sfFilters);
        fetch(url, { headers: authHeaders() })
            .then(r => r.blob())
            .then(blob => {
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl; link.download = 'sf_integration_logs.csv'; link.click();
                URL.revokeObjectURL(blobUrl);
            })
            .catch(e => console.error('CSV export failed:', e));
    });
    document.getElementById('sf-auto-refresh')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            sfAutoRefreshTimer = setInterval(() => loadTab(), 30000);
        } else {
            clearInterval(sfAutoRefreshTimer); sfAutoRefreshTimer = null;
        }
    });

    // ── Tab loader ────────────────────────────────────────────────────────────
    async function loadTab() {
        const content = document.getElementById('audit-content');
        const pagination = document.getElementById('audit-pagination');
        content.innerHTML = '<div style="padding:16px;">' + Array(6).fill('').map(() => '<div style="display:flex;gap:16px;padding:12px 0;border-bottom:1px solid var(--border-color,#e5e7eb);"><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;width:100px;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;width:160px;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;flex:1;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div></div>').join('') + '</div>';
        pagination.innerHTML = '';

        try {
            if (activeTab === 'activity') await loadActivity(content, pagination);
            else if (activeTab === 'logins') await loadLogins(content, pagination);
            else if (activeTab === 'feedback') await loadFeedback(content, pagination);
            else if (activeTab === 'sf-logs') await loadSfLogs(content, pagination);
            else if (activeTab === 'error-logs') await loadErrorLogs(content, pagination);
            else if (activeTab === 'call-logs') await loadCallLogs(content, pagination);  // ENH-03
            else if (activeTab === 'perf-health') await loadPerfHealth(content, pagination);  // v8.9.9
        } catch (e) {
            content.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">Failed to load: ${e.message || e}</div>`;
        }
    }

    // ── Activity tab ──────────────────────────────────────────────────────────
    async function loadActivity(content, pagination) {
        const result = await api.fetchAuditActivity({ page: activityPage, per_page: PER_PAGE, search: searchQuery });
        let items = result.data || [];

        // Client-side date filter
        if (dateFrom || dateTo) {
            items = items.filter(a => {
                if (!a.changed_at) return false;
                const d = new Date(a.changed_at);
                if (dateFrom && d < new Date(dateFrom)) return false;
                if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
                return true;
            });
        }

        if (!items.length) {
            content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">No activity found.</div>';
            return;
        }
        content.innerHTML = `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr>
                        <th>Lead</th><th>Company</th><th>From</th><th>To</th><th>Changed By</th><th>When</th>
                    </tr></thead>
                    <tbody>
                        ${items.map(a => `
                            <tr>
                                <td style="font-weight:500;">${a.lead_name || '—'}</td>
                                <td>${a.company || '—'}</td>
                                <td><span class="status-badge status-${(a.from_status||'').toLowerCase().replace(/\s+/g,'-')}">${a.from_status || '—'}</span></td>
                                <td><span class="status-badge status-${(a.to_status||'').toLowerCase().replace(/\s+/g,'-')}">${a.to_status || '—'}</span></td>
                                <td>${a.changed_by || '—'}</td>
                                <td style="font-size:0.82rem;color:var(--text-muted);">${_timeAgo(a.changed_at)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
        _renderPagination(pagination, activityPage, result.pages, result.total, (p) => { activityPage = p; loadTab(); });
    }

    // ── Login History tab ─────────────────────────────────────────────────────
    async function loadLogins(content, pagination) {
        const result = await api.fetchLoginLogs({ page: loginPage, per_page: PER_PAGE, search: searchQuery });
        let items = result.data || [];

        // Client-side date filter
        if (dateFrom || dateTo) {
            items = items.filter(l => {
                if (!l.login_at) return false;
                const d = new Date(l.login_at);
                if (dateFrom && d < new Date(dateFrom)) return false;
                if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
                return true;
            });
        }

        if (!items.length) {
            content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">No login history found.</div>';
            return;
        }
        content.innerHTML = `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr>
                        <th>User</th><th>Email</th><th>Role</th><th>Login Time</th><th>Logout Time</th><th>Duration</th><th>IP Address</th>
                    </tr></thead>
                    <tbody>
                        ${items.map(l => `
                            <tr>
                                <td style="font-weight:500;">${l.name || '—'}</td>
                                <td>${l.email || '—'}</td>
                                <td><span class="role-badge role-${(l.role||'sdr').toLowerCase().replace(/\s+/g,'-')}">${l.role || '—'}</span></td>
                                <td style="font-size:0.82rem;">${_formatDate(l.login_at)}</td>
                                <td style="font-size:0.82rem;">${l.logout_at ? _formatDate(l.logout_at) : '<span style="color:var(--success-color);">Active</span>'}</td>
                                <td style="font-weight:500;">${l.duration || (l.logout_at ? '—' : '🟢 ongoing')}</td>
                                <td style="font-size:0.82rem;color:var(--text-muted);">${l.ip_address || '—'}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
        _renderPagination(pagination, loginPage, result.pages, result.total, (p) => { loginPage = p; loadTab(); });
    }

    // ── Feedback tab ──────────────────────────────────────────────────────────
    async function loadFeedback(content, pagination) {
        const result = await api.fetchFeedback({ page: feedbackPage, per_page: PER_PAGE });
        const items = result.data || [];
        if (!items.length) {
            content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">No feedback submitted yet.</div>';
            return;
        }
        const typeIcons = { bug: '🐛', feature: '💡', general: '💬' };
        const statusColors = { new: '#3b82f6', reviewed: '#f59e0b', resolved: '#10b981' };
        content.innerHTML = `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr>
                        <th>Type</th><th>User</th><th>Message</th><th>Status</th><th>Submitted</th><th>Action</th>
                    </tr></thead>
                    <tbody>
                        ${items.map(f => `
                            <tr>
                                <td>${typeIcons[f.type] || '💬'} ${f.type}</td>
                                <td style="font-weight:500;">${f.user_name || f.user_email || '—'}</td>
                                <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(f.message||'').replace(/"/g, '&quot;')}">${f.message || '—'}</td>
                                <td><span style="padding:2px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;background:${statusColors[f.status]||'#94a3b8'}22;color:${statusColors[f.status]||'#94a3b8'};text-transform:capitalize;">${f.status}</span></td>
                                <td style="font-size:0.82rem;color:var(--text-muted);">${_timeAgo(f.created_at)}</td>
                                <td>
                                    <select class="filter-select fb-status-select" data-id="${f.id}" style="padding:4px 8px;font-size:0.78rem;">
                                        <option value="new" ${f.status==='new'?'selected':''}>New</option>
                                        <option value="reviewed" ${f.status==='reviewed'?'selected':''}>Reviewed</option>
                                        <option value="resolved" ${f.status==='resolved'?'selected':''}>Resolved</option>
                                    </select>
                                </td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
        content.querySelectorAll('.fb-status-select').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                await api.patchFeedbackStatus(e.target.dataset.id, e.target.value);
            });
        });
        _renderPagination(pagination, feedbackPage, result.pages, result.total, (p) => { feedbackPage = p; loadTab(); });
    }

    // ── SF Logs tab ───────────────────────────────────────────────────────────
    async function loadSfLogs(content, pagination) {
        const data = await fetchSfLogs(sfFilters);
        const logs = data.logs || [];

        // Stats row
        const successCount = logs.filter(l => l.status === 'success').length;
        const failedCount = logs.filter(l => l.status === 'failed').length;

        let statsHtml = `
            <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;margin-bottom:16px;">
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

        if (!logs.length) {
            content.innerHTML = statsHtml + `<div style="text-align:center;color:var(--text-muted);padding:48px 24px;">
                <div style="font-size:2rem;margin-bottom:8px;">📋</div>
                <p>No integration logs found. Sync some leads to see activity here.</p>
            </div>`;
            return;
        }

        content.innerHTML = statsHtml + `
            <div class="info-card" style="padding:0;overflow:hidden;">
                <div style="overflow-x:auto;">
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
                        <tbody>${logs.map(log => renderSfLogRow(log)).join('')}</tbody>
                    </table>
                </div>
            </div>`;

        // Detail click
        content.querySelectorAll('.sf-log-detail-btn').forEach(btn => {
            btn.addEventListener('click', () => showSfLogDetail(btn.dataset.logId));
        });

        // SF pagination
        const { page, total_pages } = data;
        const btns = [];
        if (page > 1) btns.push(`<button class="btn btn-outline btn-sm sf-page-btn" data-page="${page - 1}">← Prev</button>`);
        btns.push(`<span style="font-size:0.82rem;color:var(--text-muted);padding:4px 8px;">Page ${page} of ${total_pages}</span>`);
        if (page < total_pages) btns.push(`<button class="btn btn-outline btn-sm sf-page-btn" data-page="${page + 1}">Next →</button>`);
        pagination.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:8px;">${btns.join('')}</div>`;
        pagination.querySelectorAll('.sf-page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                sfFilters.page = parseInt(btn.dataset.page);
                loadTab();
            });
        });
    }

    // ── Error Logs tab ────────────────────────────────────────────────────────
    async function loadErrorLogs(content, pagination) {
        const params = new URLSearchParams({
            page: errorLogPage,
            per_page: PER_PAGE,
            ...(errorLogFilters.severity  && { severity:  errorLogFilters.severity }),
            ...(errorLogFilters.category  && { category:  errorLogFilters.category }),
            ...(errorLogFilters.resolved !== '' && { resolved: errorLogFilters.resolved }),
        });
        const token = localStorage.getItem('crm_token');
        let data;
        try {
            const r = await fetch(`${API_BASE}/api/admin/error-logs?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!r.ok) throw new Error(`Status ${r.status}`);
            data = await r.json();
        } catch (e) {
            content.innerHTML = `<div style="text-align:center;padding:48px;color:#ef4444;">⚠️ Could not load error logs: ${e.message}</div>`;
            return;
        }

        const logs    = data.items || [];
        const total   = data.total || 0;
        const pages   = data.pages || 1;
        const summary = data.summary || {};

        // ── Stats banner ─────────────────────────────────────────────────────
        const criticalCount  = summary.critical  ?? logs.filter(l => l.severity === 'critical').length;
        const warningCount   = summary.warning   ?? logs.filter(l => l.severity === 'warning').length;
        const unresolvedCount = summary.unresolved ?? logs.filter(l => !l.resolved).length;

        let html = `
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
                <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);letter-spacing:0.5px;">Total Errors</div>
                    <div style="font-size:1.5rem;font-weight:700;">${total}</div>
                </div>
                <div style="background:var(--bg-secondary);border:1px solid #fee2e2;border-radius:10px;padding:12px 16px;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:#ef4444;letter-spacing:0.5px;">🔴 Critical</div>
                    <div style="font-size:1.5rem;font-weight:700;color:#ef4444;">${criticalCount}</div>
                </div>
                <div style="background:var(--bg-secondary);border:1px solid #fef3c7;border-radius:10px;padding:12px 16px;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:#f59e0b;letter-spacing:0.5px;">🟡 Warnings</div>
                    <div style="font-size:1.5rem;font-weight:700;color:#f59e0b;">${warningCount}</div>
                </div>
                <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);letter-spacing:0.5px;">Unresolved</div>
                    <div style="font-size:1.5rem;font-weight:700;color:${unresolvedCount > 0 ? '#ef4444' : '#22c55e'};">${unresolvedCount}</div>
                </div>
            </div>`;

        if (!logs.length) {
            html += `<div style="text-align:center;padding:64px 24px;color:var(--text-muted);">
                <div style="font-size:3rem;margin-bottom:12px;">🟢</div>
                <h3 style="font-weight:600;margin:0 0 6px;">All Clear</h3>
                <p style="font-size:0.85rem;">No errors match the current filters. The system is operating normally.</p>
            </div>`;
            content.innerHTML = html;
            pagination.innerHTML = '';
            return;
        }

        // ── Error cards ───────────────────────────────────────────────────────
        const severityMeta = {
            critical: { bg: '#fef2f2', border: '#fecaca', badge: '#ef4444', icon: '🔴' },
            warning:  { bg: '#fffbeb', border: '#fde68a', badge: '#f59e0b', icon: '🟡' },
            info:     { bg: '#eff6ff', border: '#bfdbfe', badge: '#3b82f6', icon: '🔵' },
        };
        const categoryLabels = {
            api: 'API', auth: 'Auth', research: 'AI Research',
            dialer: 'Dialer', salesforce: 'Salesforce',
            upload: 'Upload', general: 'General',
        };

        html += '<div style="display:flex;flex-direction:column;gap:12px;">';
        logs.forEach(log => {
            const meta  = severityMeta[log.severity] || severityMeta.warning;
            const catLabel = categoryLabels[log.category] || log.category || 'General';
            const resolvedStyle = log.resolved
                ? 'opacity:0.6;border-left-color:#d1fae5;'
                : `border-left: 4px solid ${meta.badge};`;

            html += `
            <div class="error-log-card" data-id="${log.id}" style="
                background:${log.resolved ? 'var(--bg-secondary)' : meta.bg};
                border:1px solid ${log.resolved ? 'var(--border-color)' : meta.border};
                border-radius:12px;padding:16px 20px;
                ${resolvedStyle}
                transition:opacity 0.2s;">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                            <span style="background:${meta.badge}22;color:${meta.badge};border-radius:6px;padding:2px 8px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${meta.icon} ${log.severity}</span>
                            <span style="background:#f1f5f9;color:#64748b;border-radius:6px;padding:2px 8px;font-size:0.72rem;font-weight:600;">${catLabel}</span>
                            ${log.feature ? `<span style="background:#f1f5f9;color:#64748b;border-radius:6px;padding:2px 8px;font-size:0.72rem;">${log.feature}</span>` : ''}
                            ${log.dedup_count > 1 ? `<span title="This error occurred ${log.dedup_count} times" style="background:#f3e8ff;color:#7c3aed;border-radius:6px;padding:2px 8px;font-size:0.72rem;font-weight:600;">×${log.dedup_count}</span>` : ''}
                        </div>
                        <div style="font-size:0.95rem;font-weight:700;color:var(--text-primary);margin-bottom:4px;">${_escHtml(log.title)}</div>
                        ${log.description ? `<div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:6px;line-height:1.5;">${_escHtml(log.description)}</div>` : ''}
                        ${log.action_hint ? `<div style="font-size:0.8rem;color:#0891b2;background:#ecfeff;border-radius:6px;padding:6px 10px;margin-top:6px;">💡 <strong>What to do:</strong> ${_escHtml(log.action_hint)}</div>` : ''}
                        <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap;">
                            ${log.endpoint ? `<span style="font-size:0.75rem;color:var(--text-muted);">📡 ${_escHtml(log.endpoint)}</span>` : ''}
                            ${log.http_status ? `<span style="font-size:0.75rem;color:var(--text-muted);">HTTP ${log.http_status}</span>` : ''}
                            ${log.user_email ? `<span style="font-size:0.75rem;color:var(--text-muted);">👤 ${_escHtml(log.user_email)}</span>` : ''}
                            <span style="font-size:0.75rem;color:var(--text-muted);margin-left:auto;">${_timeAgo(log.created_at)}</span>
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
                        ${log.resolved
                            ? `<span style="font-size:0.78rem;color:#22c55e;font-weight:600;">✅ Resolved</span>`
                            : ''
                        }
                    </div>
                </div>
            </div>`;
        });
        html += '</div>';
        content.innerHTML = html;

        _renderPagination(pagination, errorLogPage, pages, total, (p) => { errorLogPage = p; loadTab(); });
    }

    // ── Helpers ────────────────────────────────────────────────────────────────
    function _renderPagination(el, page, pages, total, onPage) {
        if (pages <= 1) { el.innerHTML = ''; return; }
        const from = (page - 1) * PER_PAGE + 1;
        const to = Math.min(page * PER_PAGE, total);
        let btns = '';
        btns += `<button class="btn btn-outline btn-sm pg-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} style="padding:4px 10px;">‹</button>`;
        let start = Math.max(1, page - 2);
        let end = Math.min(pages, start + 4);
        start = Math.max(1, end - 4);
        for (let i = start; i <= end; i++) {
            btns += `<button class="btn ${i === page ? 'btn-primary' : 'btn-outline'} btn-sm pg-btn" data-page="${i}" style="padding:4px 10px;min-width:36px;">${i}</button>`;
        }
        btns += `<button class="btn btn-outline btn-sm pg-btn" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} style="padding:4px 10px;">›</button>`;
        el.innerHTML = `<span style="font-size:0.82rem;color:var(--text-muted);margin-right:12px;">Showing ${from}–${to} of ${total}</span>${btns}`;
        el.querySelectorAll('.pg-btn').forEach(btn => {
            btn.addEventListener('click', () => onPage(parseInt(btn.dataset.page)));
        });
    }

    function _timeAgo(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        const now = new Date();
        const diff = Math.floor((now - d) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
        return d.toLocaleDateString();
    }

    function _formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function _escHtml(str) {
        if (!str) return '';
        const el = document.createElement('span');
        el.textContent = String(str);
        return el.innerHTML;
    }


    // ── Call Logs filter bindings (ENH-03) ───────────────────────────────────
    const applyClFilters = () => {
        callLogFilters = {
            sdr:       document.getElementById('cl-filter-sdr')?.value      || '',
            provider:  document.getElementById('cl-filter-provider')?.value  || '',
            outcome:   document.getElementById('cl-filter-outcome')?.value   || '',
            status:    document.getElementById('cl-filter-status')?.value    || '',
            date_from: document.getElementById('cl-date-from')?.value        || '',
            date_to:   document.getElementById('cl-date-to')?.value          || '',
        };
        callLogPage = 1;
        loadTab();
    };
    ['cl-filter-sdr', 'cl-filter-provider', 'cl-filter-outcome', 'cl-filter-status', 'cl-date-from', 'cl-date-to'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', applyClFilters);
    });
    document.getElementById('cl-refresh-btn')?.addEventListener('click', () => loadTab());
    document.getElementById('cl-clear-filters')?.addEventListener('click', () => {
        ['cl-filter-sdr','cl-filter-provider','cl-filter-outcome','cl-filter-status','cl-date-from','cl-date-to'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        callLogFilters = { sdr: '', provider: '', outcome: '', date_from: '', date_to: '', status: '' };
        callLogPage = 1;
        loadTab();
    });

    // ── Call Logs failed-call badge ───────────────────────────────────────────
    async function _refreshCallLogsBadge() {
        try {
            const params = new URLSearchParams({ page: 1, per_page: 1, status: 'failed' });
            const r = await fetch(`${API_BASE}/api/admin/call-logs?${params}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('crm_token')}` }
            });
            if (!r.ok) return;
            const d = await r.json();
            const badge = document.getElementById('call-logs-badge');
            if (!badge) return;
            const n = d.total ?? 0;
            if (n > 0) { badge.textContent = n > 99 ? '99+' : n; badge.style.display = 'inline'; }
            else { badge.style.display = 'none'; }
        } catch { /* silent */ }
    }
    _refreshCallLogsBadge();
    setInterval(_refreshCallLogsBadge, 60_000);

    // ── Call Logs tab (ENH-03) ────────────────────────────────────────────────
    async function loadCallLogs(content, pagination) {
        const params = new URLSearchParams({
            page: callLogPage, per_page: PER_PAGE,
            ...(callLogFilters.sdr       && { sdr_id:    callLogFilters.sdr }),
            ...(callLogFilters.provider  && { provider:  callLogFilters.provider }),
            ...(callLogFilters.outcome   && { outcome:   callLogFilters.outcome }),
            ...(callLogFilters.status    && { status:    callLogFilters.status }),
            ...(callLogFilters.date_from && { date_from: callLogFilters.date_from }),
            ...(callLogFilters.date_to   && { date_to:   callLogFilters.date_to }),
        });
        const token = localStorage.getItem('crm_token');
        let data;
        try {
            const r = await fetch(`${API_BASE}/api/admin/call-logs?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!r.ok) throw new Error(`Status ${r.status}`);
            data = await r.json();
        } catch (e) {
            content.innerHTML = `<div style="text-align:center;padding:48px;color:#ef4444;">⚠️ Could not load call logs: ${_escHtml(e.message)}</div>`;
            return;
        }

        const logs  = data.items || [];
        const total = data.total || 0;
        const pages = data.pages || 1;
        const stats = data.summary || {};

        // Populate SDR dropdown (first load)
        const sdrSel = document.getElementById('cl-filter-sdr');
        if (sdrSel && sdrSel.options.length <= 1 && data.sdrs?.length) {
            data.sdrs.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id; opt.textContent = s.name || s.email;
                sdrSel.appendChild(opt);
            });
        }

        // Stats banner
        const failedCount = stats.failed ?? 0;
        const statCard = (label, val, color) =>
            `<div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;padding:12px 16px;">
                <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:${color};letter-spacing:0.5px;">${label}</div>
                <div style="font-size:1.5rem;font-weight:700;color:${color};">${val}</div>
            </div>`;
        let html = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
            ${statCard('Total Calls', total, 'var(--text-primary)')}
            ${statCard('✅ Completed', stats.completed ?? 0, '#22c55e')}
            ${statCard('❌ Failed', failedCount, failedCount > 0 ? '#ef4444' : 'var(--text-muted)')}
            ${statCard('📵 Missed', stats.missed ?? 0, '#f59e0b')}
        </div>`;

        // Update the tab badge with live failed count
        const clBadge = document.getElementById('call-logs-badge');
        if (clBadge) {
            if (failedCount > 0) { clBadge.textContent = failedCount > 99 ? '99+' : failedCount; clBadge.style.display = 'inline'; }
            else { clBadge.style.display = 'none'; }
        }

        if (!logs.length) {
            html += `<div style="text-align:center;padding:64px 24px;color:var(--text-muted);">
                <div style="font-size:3rem;margin-bottom:12px;">📞</div>
                <h3 style="font-weight:600;margin:0 0 6px;">No Call Logs</h3>
                <p style="font-size:0.85rem;">No calls match the current filters.</p>
            </div>`;
            content.innerHTML = html;
            pagination.innerHTML = '';
            return;
        }

        const _dur = (s) => {
            if (!s && s !== 0) return '—';
            return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
        };
        const _outcome = (o) => o
            ? `<span style="padding:2px 8px;border-radius:10px;font-size:0.78rem;font-weight:600;background:#f1f5f9;color:#334155;">${_escHtml(o)}</span>`
            : '<span style="color:var(--text-muted);">—</span>';
        const _dirBadge = (d) => {
            if (!d) return '—';
            const cfg = { outbound: ['#6366f1','#eef2ff','↗'], inbound: ['#0ea5e9','#f0f9ff','↙'] };
            const [c, bg, arrow] = cfg[d] || ['#94a3b8','#f1f5f9','→'];
            return `<span style="padding:2px 7px;border-radius:10px;font-size:0.74rem;font-weight:600;background:${bg};color:${c};">${arrow} ${d}</span>`;
        };
        const _statusBadge = (s) => {
            const raw = (s || '').toUpperCase();
            let color = '#94a3b8', bg = '#f1f5f9', label = s || '—';
            if (raw.includes('ENDED') || raw === 'COMPLETED')  { color = '#22c55e'; bg = '#f0fdf4'; label = 'Completed'; }
            else if (raw === 'FAILED')                          { color = '#ef4444'; bg = '#fef2f2'; label = '❌ Failed'; }
            else if (raw.includes('MISS') || raw === 'NO_ANSWER') { color = '#f59e0b'; bg = '#fffbeb'; label = 'Missed'; }
            else if (raw.includes('STARTED') || raw.includes('CONNECTING')) { color = '#6366f1'; bg = '#eef2ff'; label = 'Connecting'; }
            else if (raw.includes('ANSWER'))                    { color = '#22c55e'; bg = '#f0fdf4'; label = 'Answered'; }
            return `<span style="padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:600;background:${bg};color:${color};">${_escHtml(label)}</span>`;
        };
        const _providerBadge = (p) => {
            const cfg = { rcm: ['#7c3aed','#f5f3ff','📞'], aircall: ['#0d9488','#f0fdfa','✈️'] };
            const [c, bg, icon] = cfg[(p||'').toLowerCase()] || ['#64748b','#f8fafc','📲'];
            return `<span style="padding:2px 7px;border-radius:10px;font-size:0.74rem;font-weight:600;background:${bg};color:${c};text-transform:capitalize;">${icon} ${_escHtml(p||'—')}</span>`;
        };

        html += `<div class="table-container" style="overflow-x:auto;">
            <table class="data-table" style="width:100%;min-width:900px;">
                <thead><tr>
                    <th>SDR</th><th>Lead</th><th>Phone</th><th>Provider</th>
                    <th>Direction</th><th>Status</th><th>Outcome</th><th>Duration</th><th>When</th>
                </tr></thead>
                <tbody>
                    ${logs.map(c => {
                        const isFailed = (c.status || '').toUpperCase() === 'FAILED';
                        const rowBg = isFailed ? 'background:#fef2f2;' : '';
                        return `<tr style="${rowBg}">
                            <td style="font-weight:500;">${_escHtml(c.sdr_name || c.user_email || '—')}</td>
                            <td>${_escHtml(c.lead_name || 'Unknown')}<br>
                                <span style="font-size:0.75rem;color:var(--text-muted);">${_escHtml(c.lead_company||'')}</span></td>
                            <td style="font-family:monospace;font-size:0.85rem;">${_escHtml(c.phone_number||'—')}</td>
                            <td>${_providerBadge(c.provider)}</td>
                            <td>${_dirBadge(c.direction)}</td>
                            <td>
                                ${_statusBadge(c.status)}
                                ${c.provider_call_id ? `<div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px;font-family:monospace;">${_escHtml(c.provider_call_id.slice(0,18))}${c.provider_call_id.length > 18 ? '…' : ''}</div>` : ''}
                                ${isFailed && c.error_detail ? `<div style="margin-top:6px;padding:6px 8px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:0.75rem;color:#b91c1c;line-height:1.4;max-width:260px;">⚠️ ${_escHtml(c.error_detail)}</div>` : ''}
                            </td>
                            <td>${_outcome(c.outcome)}</td>
                            <td>${_dur(c.duration)}</td>
                            <td style="font-size:0.8rem;color:var(--text-muted);">${_timeAgo(c.created_at)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
        content.innerHTML = html;
        _renderPagination(pagination, callLogPage, pages, total, (p) => { callLogPage = p; loadTab(); });
    }

    // ── ⚡ Performance Health tab (v8.9.9 Phase 4) ────────────────────────────
    // ── Time-window state (persists within the page session) ──────────────────
    let _perfHours = 24;
    let _perfSinceDeploy = false;

    async function loadPerfHealth(content, pagination) {
        pagination.innerHTML = '';
        const token = localStorage.getItem('crm_token');
        let data;
        try {
            const qs = _perfSinceDeploy ? 'since_deploy=true' : `hours=${_perfHours}`;
            const r = await fetch(`${API_BASE}/api/admin/perf-summary?${qs}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!r.ok) throw new Error(`Status ${r.status}`);
            data = await r.json();
        } catch (e) {
            content.innerHTML = `<div style="text-align:center;padding:48px;color:#ef4444;">⚠️ Could not load perf data: ${e.message}</div>`;
            return;
        }

        const rail = data.rail_distribution || {};
        const total = data.total_requests || 0;
        const slowest = data.slowest_endpoints || [];
        const idx = data.index_health || {};
        const conv = data.rcm_health || {};

        // ── RAIL tier distribution cards ──────────────────────────────────────
        const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(1) : '0';
        const railCards = [
            { label: '✅ OK (<100ms)',         key: 'OK',         color: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0' },
            { label: '🟡 Acceptable (<300ms)', key: 'ACCEPTABLE', color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
            { label: '🟠 Slow (<1s)',           key: 'SLOW',       color: '#f97316', bg: '#fff7ed', border: '#fed7aa' },
            { label: '🔴 Critical (>1s)',       key: 'CRITICAL',   color: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
        ].map(t => `
            <div style="background:${t.bg};border:1px solid ${t.border};border-radius:12px;padding:16px 20px;">
                <div style="font-size:0.72rem;font-weight:600;color:${t.color};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${t.label}</div>
                <div style="font-size:1.8rem;font-weight:800;color:${t.color};">${rail[t.key] ?? 0}</div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">${pct(rail[t.key] ?? 0)}% of ${total.toLocaleString()} requests</div>
            </div>
        `).join('');

        // -- Benchmark targets (industry standard for CRM SaaS APIs) ----------
        const BENCHMARKS = [
            [/\/api\/leads\/dashboard-stats/, 150,  'Dashboard aggregate'],
            [/\/api\/leads\/my/,              200,  'SDR lead list'],
            [/\/api\/leads\/activity-feed/,   150,  'Activity feed'],
            [/\/api\/leads\/search/,          200,  'Lead search'],
            [/\/api\/leads/,                  200,  'Lead list'],
            [/\/api\/admin\/users/,           300,  'Admin user list'],
            [/\/api\/admin\/call-logs/,       250,  'Call log list'],
            [/\/api\/admin\/error-logs/,      200,  'Error log list'],
            [/\/api\/leaderboard/,            200,  'Leaderboard'],
            [/\/api\/auth\/callback/,         600,  'SSO callback (network)'],
            [/\/api\/dialer/,                 300,  'Dialer'],
            [/\/api\/webhooks/,               100,  'Webhook handler'],
            [/\/api\/admin/,                  350,  'Admin endpoint'],
        ];
        function getBenchmark(endpoint) {
            for (const [pat, target, label] of BENCHMARKS) {
                if (pat.test(endpoint)) return { target, label };
            }
            return { target: 300, label: 'API endpoint' };
        }

        // -- Slowest endpoints table -------------------------------------------
        const endpointRows = slowest.map(e => {
            const critPct = (e.count > 0 && e.critical_count != null)
                ? ((e.critical_count / e.count) * 100).toFixed(0) + '%'
                : '--';
            const p95 = e.p95_ms ?? 0;
            const p95Color = p95 > 1000 ? '#ef4444' : p95 > 300 ? '#f97316' : '#22c55e';

            const { target, label } = getBenchmark(e.endpoint);
            const ratio = p95 > 0 ? p95 / target : 0;
            let benchIcon, benchColor, benchText;
            if (p95 === 0) {
                benchIcon = '--'; benchColor = 'var(--text-muted)'; benchText = 'no data';
            } else if (ratio <= 0.5) {
                benchIcon = '&#x2705;'; benchColor = '#22c55e'; benchText = Math.round(ratio*100) + '% of target';
            } else if (ratio <= 0.85) {
                benchIcon = '&#x1F7E2;'; benchColor = '#22c55e'; benchText = Math.round(ratio*100) + '% of target';
            } else if (ratio <= 1.0) {
                benchIcon = '&#x1F7E1;'; benchColor = '#f59e0b'; benchText = Math.round(ratio*100) + '% of target';
            } else if (ratio <= 2.0) {
                benchIcon = '&#x26A0;&#xFE0F;'; benchColor = '#f97316'; benchText = Math.round(ratio*100) + '% of target';
            } else {
                benchIcon = '&#x1F534;'; benchColor = '#ef4444'; benchText = Math.round(ratio*100) + '% of target';
            }
            const barFill = Math.min(ratio * 100, 100).toFixed(1);
            const barColor = ratio <= 0.85 ? '#22c55e' : ratio <= 1.0 ? '#f59e0b' : '#ef4444';

            return `
                <tr>
                    <td style="font-family:monospace;font-size:0.8rem;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escHtml(e.endpoint)}">${_escHtml(e.endpoint)}</td>
                    <td style="text-align:right;">${(e.count ?? 0).toLocaleString()}</td>
                    <td style="text-align:right;color:${p95Color};font-weight:700;">${e.p95_ms != null ? e.p95_ms.toLocaleString() + 'ms' : '--'}</td>
                    <td style="text-align:right;">${e.p50_ms != null ? e.p50_ms.toLocaleString() + 'ms' : '--'}</td>
                    <td style="text-align:right;">${e.max_ms != null ? e.max_ms.toLocaleString() + 'ms' : '--'}</td>
                    <td style="text-align:right;color:${e.critical_count > 0 ? '#ef4444' : 'var(--text-muted)'};">${critPct}</td>
                    <td style="text-align:right;padding-right:16px;">
                        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
                            <div style="display:flex;align-items:center;gap:5px;">
                                <span style="font-size:0.68rem;color:var(--text-muted);">${label} &lt;${target}ms</span>
                                <span style="font-size:0.82rem;">${benchIcon}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;">
                                <div style="width:72px;height:5px;background:var(--border-color);border-radius:3px;overflow:hidden;">
                                    <div style="width:${barFill}%;height:100%;background:${barColor};border-radius:3px;transition:width 0.4s ease;"></div>
                                </div>
                                <span style="font-size:0.7rem;color:${benchColor};font-weight:600;white-space:nowrap;">${p95 > 0 ? benchText : '--'}</span>
                            </div>
                        </div>
                    </td>
                </tr>`;
        }).join('');

        // ── Index health ──────────────────────────────────────────────────────
        const idxStatusColor = idx.healthy === true ? '#22c55e' : idx.healthy === false ? '#ef4444' : '#94a3b8';
        const idxStatusLabel = idx.healthy === true ? '✅ All indexes present' : idx.healthy === false ? `⚠️ ${(idx.missing_indexes || []).length} index(es) missing` : '— Check unavailable';
        const missingHtml = (idx.missing_indexes || []).length > 0
            ? `<div style="margin-top:8px;font-size:0.8rem;color:#ef4444;">Missing: ${idx.missing_indexes.join(', ')}</div>`
            : '';

        // ── RCM health ─────────────────────────────────────────────────
        const convColor = conv.healthy ? '#22c55e' : '#ef4444';
        const convLabel = conv.healthy ? '✅ No 502s today' : `⚠️ ${conv.errors_today} 502 error(s) today`;
        const convLastAt = conv.last_502_at ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">Last at ${new Date(conv.last_502_at).toLocaleTimeString()}</div>` : '';

        // ── time filter pills ─────────────────────────────────────────────────
        const pillStyle = (active) => `
            display:inline-flex;align-items:center;gap:4px;
            padding:5px 12px;border-radius:20px;font-size:0.78rem;font-weight:600;
            cursor:pointer;border:1.5px solid;
            transition:all 0.15s ease;
            ${active
                ? 'background:#1e40af;border-color:#1e40af;color:#fff;'
                : 'background:var(--bg-primary);border-color:var(--border-color);color:var(--text-muted);'}
        `;
        const deployAt = data.deploy_time
            ? new Date(data.deploy_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
            : null;
        const windowDesc = _perfSinceDeploy
            ? `Since deploy ${deployAt ? '(' + deployAt + ')' : ''}`
            : `Last ${_perfHours}h`;

        content.innerHTML = `
            <div style="margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
                    <div>
                        <h3 style="font-size:1rem;font-weight:700;margin:0;">⚡ Performance Health — ${windowDesc}</h3>
                        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">
                            ${total.toLocaleString()} total requests · source: ${data.data_source || 'db'}
                            · snapshot: ${new Date(data.snapshot_at).toLocaleTimeString()}
                        </div>
                    </div>
                    <button class="btn btn-outline" id="perf-refresh-btn" style="padding:6px 14px;font-size:0.82rem;">🔄 Refresh</button>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-right:2px;">WINDOW:</span>
                    <span id="pill-1h"  style="${pillStyle(!_perfSinceDeploy && _perfHours===1)}">Last 1h</span>
                    <span id="pill-4h"  style="${pillStyle(!_perfSinceDeploy && _perfHours===4)}">Last 4h</span>
                    <span id="pill-24h" style="${pillStyle(!_perfSinceDeploy && _perfHours===24)}">Last 24h</span>
                    <span id="pill-deploy" style="${pillStyle(_perfSinceDeploy)}">
                        🚀 Since Deploy${deployAt && _perfSinceDeploy ? ' &mdash; ' + deployAt : ''}
                    </span>
                </div>
            </div>

            <!-- RAIL distribution -->
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:24px;">
                ${railCards}
            </div>

            <!-- Slowest endpoints -->
            <div class="info-card" style="padding:0;overflow:hidden;margin-bottom:20px;">
                <div style="padding:14px 20px;border-bottom:1px solid var(--border-color);font-weight:700;font-size:0.9rem;">🐢 Slowest Endpoints (P95)</div>
                <div style="overflow-x:auto;">
                    <table class="data-table" style="width:100%;table-layout:fixed;">
                        <thead><tr>
                            <th>Endpoint</th>
                            <th style="text-align:right;width:65px;">Hits</th>
                            <th style="text-align:right;width:80px;">P95</th>
                            <th style="text-align:right;width:80px;">P50</th>
                            <th style="text-align:right;width:80px;">Max</th>
                            <th style="text-align:right;width:65px;">Crit%</th>
                            <th style="text-align:right;width:200px;">vs Benchmark</th>
                        </tr></thead>
                        <tbody>${endpointRows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No data yet — metrics are collected per request.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>

            <!-- Health status row -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                <div class="info-card" style="padding:16px;">
                    <div style="font-weight:700;font-size:0.85rem;margin-bottom:10px;">🗄️ Index Health</div>
                    <div style="font-size:0.9rem;font-weight:600;color:${idxStatusColor};">${idxStatusLabel}</div>
                    <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">${idx.total_present ?? '—'} / ${idx.total_expected ?? '—'} indexes present</div>
                    ${missingHtml}
                    ${idx.note ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;font-style:italic;">${idx.note}</div>` : ''}
                </div>
                <div class="info-card" style="padding:16px;">
                    <div style="font-weight:700;font-size:0.85rem;margin-bottom:10px;">📞 RCM API Health</div>
                    <div style="font-size:0.9rem;font-weight:600;color:${convColor};">${convLabel}</div>
                    ${convLastAt}
                </div>
            </div>
        `;

        document.getElementById('perf-refresh-btn')?.addEventListener('click', () => loadTab());
        ['1h','4h','24h','deploy'].forEach(id => {
            document.getElementById(`pill-${id}`)?.addEventListener('click', () => {
                if (id === 'deploy') {
                    _perfSinceDeploy = true;
                } else {
                    _perfSinceDeploy = false;
                    _perfHours = parseInt(id);
                }
                loadTab();
            });
        });

    }

    function _escHtml(s) {
        return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    await loadTab();
}

// Cleanup timers when navigating away from Audit Logs
let _activeBadgeTimer = null;
export function cleanupAuditLogs() {
    if (_activeBadgeTimer) { clearInterval(_activeBadgeTimer); _activeBadgeTimer = null; }
}
