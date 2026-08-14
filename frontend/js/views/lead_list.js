// ── views/lead_list.js — Leads table, filters, pagination ────────────────────
import { isAdmin, isPodAdmin } from '../auth.js';
import * as api from '../api.js';
import { reprioritizeLead } from '../api.js';
import { statusBadgeClass, displayStatus, fullName, timeInStatus, CALL_OUTCOME_ICON } from '../utils.js';
import { renderAssignments } from './assignments.js';
import { renderDisqualifyRequests } from './disqualify_requests.js';
import { renderSourceBadge, formatNoteDate } from './lead_helpers.js';
import { openDisqualifyModal } from './modals.js';
import { mp } from '../mp.js';

const ALL_STATUSES = ['Lead Assigned','Lead Unassigned','Research','Calling','Meeting Scheduled','1st Discovery Meeting','Discovery Complete','Demo Scheduled','Demo Done','Completed','Disqualified'];
const ALL_OUTCOMES = ['Call Back Later','Meeting Scheduled','Meeting Confirmed','Text Me','Not the Right Person','Referred Someone Else','Left Voicemail','No Answer','Wrong Number','Not Interested','Unreachable'];
const PER_PAGE = 20;

const _normCompany = (c) => (c || '').replace(/[ ​‌‍﻿]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// Navigation state — updated every loadPage(), read by lead_detail via getNavLeads()
let _navLeads = [];  // [{id, name, phone}] — current visible page in display order
export function getNavLeads() { return _navLeads; }

function _toNavLeads(leads) {
    return leads.map(l => ({ id: l.id, name: [l.first_name, l.last_name].filter(Boolean).join(' ') || l.company || '—', phone: l.phone || l.phone_secondary || '' }));
}

// Lets the React Leads Hub (which never runs this file's loadPage()) populate
// the same nav state so Prev/Next on the Lead Detail page still works when a
// lead is opened from there — see app.js's onOpenLead for the leads-react-root path.
export function setNavLeadsFromRaw(leads) { _navLeads = _toNavLeads(leads || []); }

// ── Leads table (paginated) ──────────────────────────────────────────────────
export async function renderLeads(container, _unused, openCallModal, navigateToDetail) {
    // ── Restore state from sessionStorage (pagination persistence) ──
    const STORAGE_KEY = 'leads_view_state';
    const saved = (() => { try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } })();

    let currentPage  = saved.currentPage  || 1;
    let searchQuery   = saved.searchQuery  || '';
    let statusFilter  = saved.statusFilter || '';
    let sourceFilter  = saved.sourceFilter || '';
    let companyFilter = saved.companyFilter || '';
    let outcomeFilter = saved.outcomeFilter || '';
    let sdrFilter     = saved.sdrFilter     || '';
    // Pod/Global toggle — persisted per session, Pod Admin only
    let globalView    = isPodAdmin ? (saved.globalView ?? false) : false;
    // Default date filter: last 6 months (unless SDR filter is active)
    const _6moAgo = new Date();
    _6moAgo.setMonth(_6moAgo.getMonth() - 6);
    let dateFrom = saved.dateFrom ?? _6moAgo.toISOString().slice(0, 10);
    let dateTo   = saved.dateTo   ?? new Date().toISOString().slice(0, 10);
    // If SDR filter is active, clear date range to show ALL their leads
    if (sdrFilter) {
        dateFrom = '';
        dateTo = '';
    }
    let debounceTimer = null;

    function _saveState() {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            currentPage, searchQuery, statusFilter, sourceFilter, companyFilter, outcomeFilter, sdrFilter, dateFrom, dateTo, globalView
        }));
    }

    // ── Fetch company list for dropdown ──
    let companies = [];
    try { companies = await api.fetchLeadCompanies(); } catch(e) { /* ignore */ }
    const companyOptions = companies.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${c}</option>`).join('');

    // ── Fetch SDR list for dropdown (admin only) ──
    let sdrList = [];
    if (isAdmin) {
        try {
            const users = await api.fetchAdminUsers();
            sdrList = (users || []).filter(u => u.role === 'SDR' || u.role === 'AE' || u.role === 'Pod Admin').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } catch(e) { /* ignore */ }
    }
    // Validate persisted sdrFilter against current SDR list
    if (sdrFilter && sdrList.length > 0 && !sdrList.some(u => u.id === sdrFilter)) {
        sdrFilter = '';
        _saveState();
    }
    const sdrOptions = sdrList.map(u => `<option value="${u.id}"${u.id === sdrFilter ? ' selected' : ''}>${u.name}${u.role === 'Pod Admin' ? ' (PA)' : ''}</option>`).join('');

    // Build static shell with tabs for admins
    const tabBar = isAdmin ? `
        <div style="display:flex;gap:0;margin-bottom:24px;border-bottom:2px solid var(--border-color);">
            <button class="leads-tab active" data-tab="leads" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--primary-color);border-bottom:2px solid var(--primary-color);margin-bottom:-2px;transition:all 0.2s;">All Leads</button>
            <button class="leads-tab" data-tab="assignments" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">Assignments</button>
            <button class="leads-tab" data-tab="disqualify-requests" style="padding:10px 24px;font-size:0.9rem;font-weight:600;border:none;background:none;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">Disqualify Requests</button>
        </div>` : '';

    container.innerHTML = `
        <div class="fade-in">
            ${tabBar}
            <div id="leads-tab-content">
            <div class="priority-info-banner" id="leads-beta-banner" style="display:flex;align-items:center;gap:8px;">
                <span class="pi-icon">✨</span>
                <span>You're viewing the classic Leads experience.</span>
                <button type="button" id="leads-beta-btn" style="margin-left:auto;font-weight:600;background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;padding:0;">Switch to the new experience</button>
            </div>
            ${!isAdmin ? `
            <div class="priority-info-banner">
                <span class="pi-icon">💡</span>
                <span>Leads are sorted by priority. After a call is logged, a lead moves to <strong>Medium</strong> (1 call today) or <strong>Deprioritized</strong> (2+ calls today). Use <strong>↑ Re-prioritize</strong> to manually restore a lead to the top.</span>
            </div>` : ''}
            <div class="page-header" style="display:flex;align-items:flex-start;gap:16px;flex-wrap:nowrap;">
                <div style="flex-shrink:0;">
                    <h1 class="page-title" style="white-space:nowrap;margin:0;">${isAdmin ? 'All Leads' : 'My Leads'}</h1>
                    <p class="page-subtitle" id="leads-subtitle" style="margin:4px 0 0;white-space:nowrap;">Loading...</p>
                </div>
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;flex:1;min-width:0;">
                    <input type="text" id="lead-search" placeholder="🔍 Search..." class="filter-input" style="min-width:150px;max-width:200px;" value="${searchQuery.replace(/"/g, '&quot;')}">
                    <select id="company-filter" class="filter-select" style="min-width:150px;max-width:200px;">
                        <option value="">🏢 All Companies</option>
                        <option value="__none__">— No Company —</option>
                        ${companyOptions}
                    </select>
                    <select id="status-filter" class="filter-select" style="min-width:120px;max-width:160px;">
                        <option value="">All Statuses</option>
                        ${ALL_STATUSES.map(s => `<option${s === statusFilter ? ' selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <select id="source-filter" class="filter-select" style="min-width:120px;max-width:160px;">
                        <option value="">All Sources</option>
                        <option value="salesforce"${sourceFilter === 'salesforce' ? ' selected' : ''}>☁️ Salesforce</option>
                        <option value="uploaded"${sourceFilter === 'uploaded' ? ' selected' : ''}>📄 File Upload</option>
                        <option value="gsheet"${sourceFilter === 'gsheet' ? ' selected' : ''}>📊 Google Sheets</option>
                        <option value="manual"${sourceFilter === 'manual' ? ' selected' : ''}>✏️ Manual</option>
                    </select>
                    <select id="outcome-filter" class="filter-select" style="min-width:140px;max-width:180px;">
                        <option value="">📞 All Outcomes</option>
                        ${ALL_OUTCOMES.map(o => `<option${o === outcomeFilter ? ' selected' : ''}>${o}</option>`).join('')}
                    </select>
                    ${isAdmin ? `<select id="sdr-filter" class="filter-select" style="min-width:140px;max-width:180px;">
                        <option value="">👤 All SDRs</option>
                        ${sdrOptions}
                    </select>` : ''}
                    ${isPodAdmin ? `
                    <div id="pod-global-toggle" style="display:flex;align-items:center;border-radius:20px;border:1.5px solid var(--primary-color,#6366f1);overflow:hidden;flex-shrink:0;" title="Toggle between your pod's leads and all leads">
                        <button id="pod-view-btn" style="padding:5px 14px;font-size:0.76rem;font-weight:600;border:none;cursor:pointer;transition:all 0.18s;background:${!globalView ? 'var(--primary-color,#6366f1)' : 'transparent'};color:${!globalView ? '#fff' : 'var(--primary-color,#6366f1)'};" title="Show only your pod's leads">🔒 My Pod</button>
                        <button id="global-view-btn" style="padding:5px 14px;font-size:0.76rem;font-weight:600;border:none;cursor:pointer;transition:all 0.18s;background:${globalView ? 'var(--primary-color,#6366f1)' : 'transparent'};color:${globalView ? '#fff' : 'var(--primary-color,#6366f1)'};" title="Show all leads across all pods">🌐 Global</button>
                    </div>` : ''}
                    <div style="display:flex;gap:6px;align-items:center;">
                        <label style="font-size:0.78rem;color:var(--text-muted);font-weight:600;white-space:nowrap;">From</label>
                        <input type="date" id="date-from-filter" value="${dateFrom}" class="filter-input" style="padding:5px 8px;font-size:0.8rem;width:130px;">
                        <label style="font-size:0.78rem;color:var(--text-muted);font-weight:600;white-space:nowrap;">To</label>
                        <input type="date" id="date-to-filter" value="${dateTo}" class="filter-input" style="padding:5px 8px;font-size:0.8rem;width:130px;">
                        <button id="clear-date-filter" class="btn btn-outline" style="padding:4px 10px;font-size:0.75rem;white-space:nowrap;" title="Show all leads (no date filter)">Clear</button>
                    </div>
                </div>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead><tr>
                        <th>Name</th><th>Email</th><th>Phone</th><th>Source</th><th>Status</th><th>Time in Status</th>
                        ${!isAdmin ? '<th>Calls</th><th>Action</th>' : '<th>Assigned To</th>'}
                    </tr></thead>
                    <tbody id="leads-tbody"><tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">Loading...</td></tr></tbody>
                </table>
            </div>
            <div id="pagination-controls" style="display:flex;justify-content:center;align-items:center;gap:8px;padding:20px 0;"></div>
            </div>
            <div id="assignments-tab-content" style="display:none;"></div>
            <div id="disqualify-requests-tab-content" style="display:none;"></div>
        </div>`;

    // ── Restore company dropdown selection ──
    if (companyFilter) {
        const cSel = document.getElementById('company-filter');
        const optExists = [...cSel.options].some(o => o.value === companyFilter);
        if (optExists) { cSel.value = companyFilter; }
        else { companyFilter = ''; _saveState(); }
    }

    async function loadPage() {
        const tbody = document.getElementById('leads-tbody');
        tbody.innerHTML = Array(8).fill('').map(() => `<tr><td colspan="8" style="padding:10px 12px;border-bottom:1px solid var(--border-color,#e5e7eb);"><div style="display:flex;gap:16px;"><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;width:120px;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;width:160px;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;width:100px;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;flex:1;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div></div></td></tr>`).join('');

        // Maker-side "pending disqualify" badge — only SDR/AE submit requests,
        // so only they need to know which of their own companies are awaiting review.
        let pendingCompanies = new Set();
        if (!isAdmin) {
            try {
                const mine = await api.fetchMyDisqualifyRequests('pending');
                pendingCompanies = new Set((mine.requests || []).map(r => _normCompany(r.company)));
            } catch (e) { /* non-critical — badge just won't show */ }
        }

        try {
            const result = await api.fetchLeads({
                page: currentPage,
                per_page: PER_PAGE,
                search: searchQuery,
                status: statusFilter === 'Lead Unassigned' ? 'Lead Assigned' : statusFilter,
                source: sourceFilter,
                company: companyFilter,
                date_from: dateFrom,
                date_to: dateTo,
                outcome: outcomeFilter,
                assigned_to: sdrFilter,
                global_view: globalView,
            });

            let leads = result.data || [];
            let total = result.total || 0;
            // Expose for Prev/Next navigation in lead detail (default to paginated list initially)
            _navLeads = _toNavLeads(leads);
            
            // Asynchronously fetch all matching leads (non-paginated) to populate _navLeads fully
            api.fetchLeads({
                page: 1,
                search: searchQuery,
                status: statusFilter === 'Lead Unassigned' ? 'Lead Assigned' : statusFilter,
                source: sourceFilter,
                company: companyFilter,
                date_from: dateFrom,
                date_to: dateTo,
                outcome: outcomeFilter,
                assigned_to: sdrFilter,
                ids_only: true,
                global_view: globalView,
            }).then(navResult => {
                let navLeads = navResult.data || [];
                if (statusFilter === 'Lead Unassigned') {
                    navLeads = navLeads.filter(l => !l.assigned_to || l.assigned_to.length === 0);
                }
                _navLeads = _toNavLeads(navLeads);
            }).catch(err => {
                console.error('[Navigation] Failed to load all matched leads:', err);
            });

            let pages = result.pages || 1;

            // Client-side filtering for the virtual "Lead Unassigned" status
            if (statusFilter === 'Lead Unassigned') {
                leads = leads.filter(l => !l.assigned_to || l.assigned_to.length === 0);
                total = leads.length;
                pages = 1;
            }

            if (currentPage > pages) {
                currentPage = Math.max(1, pages);
                _saveState();
                return loadPage();
            }

            document.getElementById('leads-subtitle').textContent =
                `${total} lead${total !== 1 ? 's' : ''}${isAdmin ? ' in total.' : ' assigned to you.'}`;

            tbody.innerHTML = _renderRows(leads, isAdmin, openCallModal, pendingCompanies);
            _renderPagination(currentPage, pages, total);
            _bindRowClicks(container, navigateToDetail, openCallModal, leads, loadPage);

            _saveState();
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444;">
                <div style="font-size:1.1rem;margin-bottom:8px;">⚠️ Unable to load leads</div>
                <div style="font-size:0.82rem;color:#71717a;">Please try refreshing the page. If the issue persists, <a href="login.html" style="color:#6366f1;font-weight:600;text-decoration:underline;" onclick="localStorage.removeItem('crm_token')">sign in again</a>.</div>
            </td></tr>`;
        }
    }

    function _renderPagination(page, pages, total) {
        const el = document.getElementById('pagination-controls');
        if (pages <= 1) { el.innerHTML = ''; return; }

        const from = (page - 1) * PER_PAGE + 1;
        const to = Math.min(page * PER_PAGE, total);

        let btns = '';
        btns += `<button class="btn btn-outline btn-sm pg-btn" data-page="1" ${page === 1 ? 'disabled' : ''} style="padding:4px 10px;">«</button>`;
        btns += `<button class="btn btn-outline btn-sm pg-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} style="padding:4px 10px;">‹</button>`;

        let start = Math.max(1, page - 2);
        let end = Math.min(pages, start + 4);
        start = Math.max(1, end - 4);

        for (let i = start; i <= end; i++) {
            btns += `<button class="btn ${i === page ? 'btn-primary' : 'btn-outline'} btn-sm pg-btn" data-page="${i}" style="padding:4px 10px;min-width:36px;">${i}</button>`;
        }

        btns += `<button class="btn btn-outline btn-sm pg-btn" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} style="padding:4px 10px;">›</button>`;
        btns += `<button class="btn btn-outline btn-sm pg-btn" data-page="${pages}" ${page === pages ? 'disabled' : ''} style="padding:4px 10px;">»</button>`;

        el.innerHTML = `
            <span style="font-size:0.82rem;color:var(--text-muted);margin-right:12px;">
                Showing ${from}–${to} of ${total}
            </span>
            ${btns}`;

        el.querySelectorAll('.pg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentPage = parseInt(btn.dataset.page);
                loadPage();
            });
        });
    }

    // Bind filter events
    document.getElementById('lead-search').addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchQuery = e.target.value.trim();
            if (searchQuery.length >= 2) mp.track('Leads Searched', { query: searchQuery });
            currentPage = 1;
            loadPage();
        }, 400);
    });
    document.getElementById('company-filter').addEventListener('change', (e) => {
        companyFilter = e.target.value;
        currentPage = 1;
        loadPage();
    });
    document.getElementById('status-filter').addEventListener('change', (e) => {
        statusFilter = e.target.value;
        if (statusFilter) mp.track('Leads Filtered', { filter_type: 'status', filter_value: statusFilter });
        currentPage = 1;
        loadPage();
    });
    document.getElementById('source-filter').addEventListener('change', (e) => {
        sourceFilter = e.target.value;
        if (sourceFilter) mp.track('Leads Filtered', { filter_type: 'source', filter_value: sourceFilter });
        currentPage = 1;
        loadPage();
    });
    document.getElementById('outcome-filter').addEventListener('change', (e) => {
        outcomeFilter = e.target.value;
        if (outcomeFilter) mp.track('Leads Filtered', { filter_type: 'outcome', filter_value: outcomeFilter });
        currentPage = 1;
        loadPage();
    });
    if (isAdmin && document.getElementById('sdr-filter')) {
        document.getElementById('sdr-filter').addEventListener('change', (e) => {
            sdrFilter = e.target.value;
            currentPage = 1;
            // Auto-clear date range when filtering by SDR to show ALL their leads
            if (sdrFilter) {
                dateFrom = '';
                dateTo = '';
                document.getElementById('date-from-filter').value = '';
                document.getElementById('date-to-filter').value = '';
                // Show info badge
                let badge = document.getElementById('sdr-date-info');
                if (!badge) {
                    badge = document.createElement('div');
                    badge.id = 'sdr-date-info';
                    badge.style.cssText = 'font-size:0.72rem;color:#4f46e5;margin-top:4px;display:flex;align-items:center;gap:4px;';
                    badge.innerHTML = '📅 Showing all dates for selected SDR';
                    document.getElementById('clear-date-filter').parentElement.after(badge);
                }
            } else {
                // Remove info badge when SDR filter cleared
                const badge = document.getElementById('sdr-date-info');
                if (badge) badge.remove();
            }
            loadPage();
        });
    }

    // Pod/Global toggle (Pod Admins only)
    if (isPodAdmin) {
        const _updateToggleStyle = () => {
            const podBtn = document.getElementById('pod-view-btn');
            const globalBtn = document.getElementById('global-view-btn');
            if (!podBtn || !globalBtn) return;
            const activeStyle = 'background:var(--primary-color,#6366f1);color:#fff;';
            const inactiveStyle = 'background:transparent;color:var(--primary-color,#6366f1);';
            podBtn.style.cssText    = `padding:5px 14px;font-size:0.76rem;font-weight:600;border:none;cursor:pointer;transition:all 0.18s;${!globalView ? activeStyle : inactiveStyle}`;
            globalBtn.style.cssText = `padding:5px 14px;font-size:0.76rem;font-weight:600;border:none;cursor:pointer;transition:all 0.18s;${globalView ? activeStyle : inactiveStyle}`;
        };
        document.getElementById('pod-view-btn')?.addEventListener('click', () => {
            if (globalView) { globalView = false; currentPage = 1; _updateToggleStyle(); loadPage(); }
        });
        document.getElementById('global-view-btn')?.addEventListener('click', () => {
            if (!globalView) { globalView = true; currentPage = 1; _updateToggleStyle(); loadPage(); }
        });
    }
    document.getElementById('leads-beta-btn')?.addEventListener('click', () => {
        localStorage.removeItem('leadsBeta');
        location.reload();
    });
    document.getElementById('date-from-filter').addEventListener('change', (e) => {
        dateFrom = e.target.value;
        currentPage = 1;
        loadPage();
    });
    document.getElementById('date-to-filter').addEventListener('change', (e) => {
        dateTo = e.target.value;
        currentPage = 1;
        loadPage();
    });
    document.getElementById('clear-date-filter').addEventListener('click', () => {
        searchQuery = '';
        companyFilter = '';
        statusFilter = '';
        sourceFilter = '';
        outcomeFilter = '';
        sdrFilter = '';
        dateFrom = '';
        dateTo = '';

        document.getElementById('lead-search').value = '';
        document.getElementById('company-filter').value = '';
        document.getElementById('status-filter').value = '';
        document.getElementById('source-filter').value = '';
        document.getElementById('outcome-filter').value = '';
        if (document.getElementById('sdr-filter')) {
            document.getElementById('sdr-filter').value = '';
        }
        document.getElementById('date-from-filter').value = '';
        document.getElementById('date-to-filter').value = '';

        const badge = document.getElementById('sdr-date-info');
        if (badge) badge.remove();

        currentPage = 1;
        loadPage();
    });

    // Tab switching for admin
    if (isAdmin) {
        container.querySelectorAll('.leads-tab').forEach(tab => {
            tab.addEventListener('click', async () => {
                container.querySelectorAll('.leads-tab').forEach(t => {
                    t.classList.remove('active');
                    t.style.color = 'var(--text-muted)';
                    t.style.borderBottomColor = 'transparent';
                });
                tab.classList.add('active');
                tab.style.color = 'var(--primary-color)';
                tab.style.borderBottomColor = 'var(--primary-color)';

                const tabName = tab.dataset.tab;
                const leadsContent = document.getElementById('leads-tab-content');
                const assignContent = document.getElementById('assignments-tab-content');
                const disqualifyContent = document.getElementById('disqualify-requests-tab-content');
                leadsContent.style.display = tabName === 'leads' ? 'block' : 'none';
                assignContent.style.display = tabName === 'assignments' ? 'block' : 'none';
                disqualifyContent.style.display = tabName === 'disqualify-requests' ? 'block' : 'none';
                if (tabName === 'assignments') {
                    await renderAssignments(assignContent);
                } else if (tabName === 'disqualify-requests') {
                    await renderDisqualifyRequests(disqualifyContent);
                }
            });
        });
    }

    // Initial load
    await loadPage();
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _getPriorityTier(lead) {
    const score = lead.priority_score !== undefined ? lead.priority_score : 100;
    if (score >= 75) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
}

function _priorityBadge(tier) {
    if (tier === 'high')   return `<span class="priority-badge priority-badge-high">🔴 High</span>`;
    if (tier === 'medium') return `<span class="priority-badge priority-badge-medium">🟡 Called Today</span>`;
    return                        `<span class="priority-badge priority-badge-low">⬇️ Deprioritized</span>`;
}

function _reprioritizeBtn(leadId) {
    return `<button class="reprioritize-btn" data-reprioritize-id="${leadId}" onclick="event.stopPropagation()" title="Move this lead back to High priority">↑ Re-prioritize</button>`;
}

function _renderRows(data, isAdmin, openCallModal, pendingCompanies) {
    if (!data.length) return `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px;">No leads match your filter.</td></tr>`;
    const colSpan = isAdmin ? 7 : 8;
    let lastCompanyKey = null;
    let rows = '';
    data.forEach(lead => {
        const company = (lead.company || '').replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
        const companyKey = _normCompany(lead.company);
        if (companyKey && companyKey !== lastCompanyKey) {
            const companyLeads = data.filter(l => _normCompany(l.company) === companyKey);
            const companyCount = companyLeads.length;
            // Check if any lead in this group has company_resolved
            const companyResolved = companyLeads.find(l => l.company_resolved && l.company_resolved.resolved);
            const resolvedBadge = companyResolved
                ? `<span style="margin-left:10px;display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:6px;background:#fef3c7;color:#92400e;font-size:0.72rem;font-weight:600;border:1px solid #fde68a;" title="Meeting booked via ${companyResolved.company_resolved.resolved_by}">✅ Company Connected — via ${companyResolved.company_resolved.resolved_by}</span>`
                : '';
            // Maker step: only SDR/AE can request disqualify (Pod Admin+ is the checker, via the
            // Disqualify Requests screen) \u2014 mirrors the isAdmin-gated buttons used elsewhere in this file.
            const companyLeadIds = companyLeads.map(l => l.id);
            const isPending = pendingCompanies && pendingCompanies.has(companyKey);
            const disqualifyBtn = !isAdmin && isPending
                ? `<span style="margin-left:12px;font-size:0.7rem;font-weight:600;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:2px 10px;" title="Waiting on Pod Admin review">\u23f3 Disqualify Requested</span>`
                : !isAdmin
                ? `<button class="disqualify-account-btn" data-company="${company.replace(/"/g, '&quot;')}" data-lead-ids="${companyLeadIds.join(',')}" onclick="event.stopPropagation()" style="margin-left:12px;font-size:0.7rem;font-weight:600;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:2px 10px;cursor:pointer;">\uD83D\uDEAB Disqualify Account</button>`
                : '';
            rows += `<tr class="company-group-header"><td colspan="${colSpan}" style="background:#f0f4ff;padding:8px 16px;font-size:0.78rem;font-weight:700;color:#4338ca;border-left:3px solid #6366f1;"><div style="display:flex;align-items:center;justify-content:space-between;">\uD83C\uDFE2 ${company} <span style="font-weight:500;color:#6b7280;margin-left:6px;">${companyCount} lead${companyCount > 1 ? 's' : ''}</span>${resolvedBadge}${disqualifyBtn}</div></td></tr>`;
            lastCompanyKey = companyKey;
        } else if (!companyKey && lastCompanyKey !== '__no_company__') {
            rows += `<tr class="company-group-header"><td colspan="${colSpan}" style="background:#fefce8;padding:8px 16px;font-size:0.78rem;font-weight:700;color:#92400e;border-left:3px solid #f59e0b;">\u26a0\ufe0f No Company</td></tr>`;
            lastCompanyKey = '__no_company__';
        }
        const displayPhone = (lead.phone && lead.phone.trim()) ? lead.phone : (lead.phone_secondary && lead.phone_secondary.trim()) ? lead.phone_secondary : (lead.company_phone && lead.company_phone.trim()) ? lead.company_phone : null;
        const noPhone = !displayPhone;
        const rowBg = noPhone ? 'background:#fffbeb;' : '';
        // Priority tier (SDR view only)
        const tier = !isAdmin ? _getPriorityTier(lead) : 'high';
        const priorityRowClass = !isAdmin ? ` lead-row-${tier}` : '';
        const noteRowClass = !isAdmin ? ` note-preview-row-${tier}` : '';
        // Company resolved indicator for individual lead rows
        const _meetingOrBeyond = ['Meeting Scheduled','1st Discovery Meeting','Discovery Complete','Demo Scheduled','Demo Done','Completed'];
        const leadResolvedHint = (lead.company_resolved && lead.company_resolved.resolved && !_meetingOrBeyond.includes(lead.status))
            ? `<div style="font-size:0.68rem;color:#92400e;margin-top:2px;display:flex;align-items:center;gap:3px;" title="A meeting is already booked at this company via ${lead.company_resolved.resolved_by}"><span style="width:6px;height:6px;border-radius:50%;background:#f59e0b;display:inline-block;"></span> Company connected</div>`
            : '';
        rows += `
        <tr class="lead-row${noPhone ? ' no-phone-row' : ''}${priorityRowClass}" data-id="${lead.id}" style="cursor:pointer;${rowBg}">
            <td style="max-width:180px;">
                <strong>${fullName(lead)}</strong>
                ${lead.company ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;" title="${lead.company}">${lead.company}</div>` : ''}
                ${leadResolvedHint}
                ${!isAdmin && tier !== 'high' ? `<div style="margin-top:4px;">${_priorityBadge(tier)}</div>` : ''}
                ${!isAdmin && tier !== 'high' ? `<div>${_reprioritizeBtn(lead.id)}</div>` : ''}
            </td>
            <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${lead.email || ''}">${lead.email || '—'}</td>
            <td style="white-space:nowrap;">${noPhone ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;background:#fef2f2;color:#dc2626;font-size:0.72rem;font-weight:600;">📵 No Phone</span>' : displayPhone}</td>
            <td style="max-width:220px;">${renderSourceBadge(lead)}</td>
            <td><span class="badge ${statusBadgeClass(displayStatus(lead))}">${displayStatus(lead)}</span>${['Meeting Scheduled','1st Discovery Meeting','Discovery Complete','Demo Scheduled','Demo Done','Completed'].includes(lead.status) ? `<span style="margin-left:4px;padding:2px 6px;border-radius:6px;font-size:0.62rem;font-weight:700;${lead.opportunity_status === 'Won' ? 'background:#ecfdf5;color:#059669;' : lead.opportunity_status === 'Lost' ? 'background:#fef2f2;color:#dc2626;' : 'background:#fffbeb;color:#b45309;'}">${lead.opportunity_status || '⏳'}</span>` : ''}${lead.last_call_outcome ? `<div style="font-size:0.7rem;margin-top:3px;display:flex;align-items:center;gap:4px;color:var(--text-muted);" title="Last call: ${lead.last_call_outcome}"><span style="display:inline-block;width:14px;height:14px;">${CALL_OUTCOME_ICON[lead.last_call_outcome] ? CALL_OUTCOME_ICON[lead.last_call_outcome].replace(/width="18"/g, 'width="14"').replace(/height="18"/g, 'height="14"') : '📞'}</span><span>${lead.last_call_outcome}</span></div>` : ''}</td>
            <td>${timeInStatus(lead.status_changed_at)}</td>
            ${!isAdmin ? `
            <td><span style="font-size:0.8rem;color:var(--text-muted);">${lead.call_count || 0} calls</span></td>
            <td>${['Lead Assigned', 'Research', 'Calling'].includes(lead.status) && !noPhone
                ? `<button class="btn btn-primary quick-call-btn" data-id="${lead.id}" data-name="${fullName(lead)}" data-phone="${displayPhone || ''}" style="padding:6px 12px;font-size:0.78rem;display:inline-flex;align-items:center;gap:6px;" onclick="event.stopPropagation()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg> Call</button>`
                : noPhone ? `<span style="font-size:0.72rem;color:#f59e0b;font-weight:600;" title="No phone number available">📵 N/A</span>`
                : `<span style="font-size:0.72rem;color:var(--text-muted);">—</span>`
            }</td>
            ` : `<td style="font-size:0.78rem;color:var(--text-muted);">${(lead.assigned_to || []).map(u => u.name).join(', ') || '—'}</td>`}
        </tr>
        <tr class="note-preview-row${noteRowClass}" data-id="${lead.id}" style="cursor:pointer;">
            <td colspan="${colSpan}" style="padding:4px 16px 8px;border-bottom:1px solid #e5e7eb;background:${noPhone ? '#fffdf5' : '#fafbfc'};">
                ${lead.latest_note
                    ? `<div style="display:flex;align-items:flex-start;gap:8px;">
                        <span style="font-size:0.7rem;flex-shrink:0;padding:2px 6px;border-radius:4px;background:#e0e7ff;color:#4338ca;font-weight:600;">\u{1F4DD} ${lead.note_count}</span>
                        <div style="font-size:0.76rem;color:#4b5563;line-height:1.4;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(lead.latest_note.content || '').replace(/"/g, '&quot;')}">${lead.latest_note.content || ''}</div>
                        <span style="font-size:0.68rem;color:#9ca3af;flex-shrink:0;white-space:nowrap;">${lead.latest_note.author} \u00b7 ${formatNoteDate(lead.latest_note.created_at)}</span>
                       </div>`
                    : `<div style="font-size:0.72rem;color:#c4c4c4;font-style:italic;">\u{1F4DD} No notes yet</div>`
                }
            </td>
        </tr>`;
    });
    return rows;
}

function _bindRowClicks(container, navigateToDetail, openCallModal, leads = [], reloadFn = null) {
    container.querySelectorAll('.lead-row').forEach(row => {
        row.addEventListener('click', () => navigateToDetail(row.dataset.id));
    });
    container.querySelectorAll('.note-preview-row').forEach(row => {
        row.addEventListener('click', () => navigateToDetail(row.dataset.id));
    });
    container.querySelectorAll('.quick-call-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const lead = leads.find(l => l.id === btn.dataset.id) || {};
            openCallModal(btn.dataset.id, btn.dataset.name, btn.dataset.phone, lead);
        });
    });
    // Re-prioritize buttons
    container.querySelectorAll('.reprioritize-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const leadId = btn.dataset.reprioritizeId;
            btn.disabled = true;
            btn.textContent = '...';
            try {
                await reprioritizeLead(leadId, 100);
                if (reloadFn) await reloadFn();
            } catch (err) {
                btn.disabled = false;
                btn.textContent = '↑ Re-prioritize';
                console.error('[Deprioritize] Re-prioritize failed:', err);
            }
        });
    });
    // Disqualify Account buttons (maker step)
    container.querySelectorAll('.disqualify-account-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const leadIds = btn.dataset.leadIds.split(',').filter(Boolean);
            openDisqualifyModal(btn.dataset.company, leadIds);
        });
    });
}
