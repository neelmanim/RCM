// ── views/dashboard.js — Dashboard view with progressive async loading ───────
import { isAdmin, currentUser } from '../auth.js';
import { fetchCallSummary, fetchLeaderboard, fetchDashboardStats, fetchActivityFeed } from '../api.js';
import { statusBadgeClass, displayStatus, fmtDate, fullName, fmtRelativeTime, CALL_OUTCOME_ICON } from '../utils.js';

// ── Pod view state (independent from leads page) ─────────────────────────────
function _getDashGlobalView() {
    try { return JSON.parse(sessionStorage.getItem('dashboard_view_state'))?.globalView === true; } catch { return false; }
}
function _setDashGlobalView(val) {
    sessionStorage.setItem('dashboard_view_state', JSON.stringify({ globalView: val }));
}

// ── Role helpers ─────────────────────────────────────────────────────────────
function _isPodAdmin() { return currentUser?.role === 'Pod Admin'; }

// ── Skeleton shimmer helper ────────────────────────────────────────────────
function _shimmer(w, h) {
    return `<div class="analytics-shimmer" style="width:${w}px;height:${h}px;border-radius:8px;"></div>`;
}

export async function renderDashboard(container, _unused, openCallModal, renderLeadDetail) {
    // ── Phase 1: Render shell with skeletons IMMEDIATELY ────────────────
    const greeting = isAdmin ? 'Dashboard' : 'My Dashboard';
    const subtitle = isAdmin ? 'Loading org-wide stats…' : `Welcome back, ${currentUser.name?.split(' ')[0] || 'SDR'}!`;
    const isPodAdmin = _isPodAdmin();
    const globalView = _getDashGlobalView();

    // Toggle pill — only for Pod Admin
    const togglePill = isPodAdmin ? `
        <div id="dash-scope-toggle" style="display:flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;border:1.5px solid #4f46e5;background:var(--surface-color);user-select:none;" role="group" aria-label="Dashboard scope">
            <button id="dash-toggle-pod" class="${!globalView ? 'active' : ''}"
                style="padding:5px 14px;font-size:0.78rem;font-weight:600;border:none;cursor:pointer;transition:all 0.15s;background:${!globalView ? '#4f46e5' : 'transparent'};color:${!globalView ? '#fff' : 'var(--text-muted)'};border-radius:0;"
                title="Show only your pod's data">🔒 My Pod</button>
            <button id="dash-toggle-global" class="${globalView ? 'active' : ''}"
                style="padding:5px 14px;font-size:0.78rem;font-weight:600;border:none;cursor:pointer;transition:all 0.15s;background:${globalView ? '#4f46e5' : 'transparent'};color:${globalView ? '#fff' : 'var(--text-muted)'};border-radius:0;"
                title="Show all org-wide data">🌐 Global</button>
        </div>` : '';

    container.innerHTML = `
        <div class="fade-in">
            <div class="page-header">
                <div>
                    <h1 class="page-title">${greeting}</h1>
                    <p class="page-subtitle" id="dash-subtitle">${subtitle}</p>
                </div>
                ${togglePill}
            </div>

            <!-- Stats Grid (skeleton) -->
            <div class="stats-grid" id="dash-stats">
                ${Array(5).fill(`
                    <div class="stat-card">
                        <div class="stat-icon-row">${_shimmer(36, 36)}</div>
                        <div class="stat-title">${_shimmer(80, 14)}</div>
                        <div class="stat-value">${_shimmer(50, 28)}</div>
                        <div class="stat-trend">${_shimmer(60, 12)}</div>
                    </div>
                `).join('')}
            </div>

            <!-- Call Outcomes (SDR only, skeleton) -->
            <div id="dash-call-outcomes"></div>

            <div style="display:grid;grid-template-columns:1fr;gap:24px;" id="dash-bottom-grid">
                <!-- Recent Leads / Priority Queue (skeleton) -->
                <div class="table-container" id="dash-leads-table">
                    <div style="padding:16px 24px;border-bottom:1px solid var(--border-color);font-weight:600;font-size:0.95rem;">
                        ${isAdmin ? 'Recent Leads' : '🎯 Priority Queue'}
                    </div>
                    <div style="padding:40px;text-align:center;color:var(--text-muted);">
                        <div class="analytics-shimmer" style="width:100%;height:180px;border-radius:8px;"></div>
                    </div>
                </div>
            </div>

            <!-- Activity Feed placeholder (admin only) -->
            <div id="dash-activity-feed"></div>
        </div>`;

    // ── Toggle pill bindings ──────────────────────────────────────────────
    if (isPodAdmin) {
        const _reloadAll = (newGlobalView) => {
            _setDashGlobalView(newGlobalView);
            // Re-render entire dashboard with new state
            renderDashboard(container, _unused, openCallModal, renderLeadDetail);
        };
        document.getElementById('dash-toggle-pod')?.addEventListener('click', () => {
            if (_getDashGlobalView()) _reloadAll(false);
        });
        document.getElementById('dash-toggle-global')?.addEventListener('click', () => {
            if (!_getDashGlobalView()) _reloadAll(true);
        });
    }

    // ── Phase 2: Fire all fetches in parallel (non-blocking) ────────────
    // Each section populates independently as its data arrives.

    // 2a. Dashboard Stats → stat cards + recent leads table
    _loadDashboardStats(container, openCallModal, renderLeadDetail, globalView);

    // 2b. Call Summary (SDR only)
    if (!isAdmin) {
        _loadCallOutcomes(container);
    }

    // 2c. Leaderboard
    _loadLeaderboard(container, globalView);

    // 2d. Activity Feed (admin only)
    if (isAdmin) {
        _loadActivityFeed(container, globalView);
    }
}

// ── Async section loaders ────────────────────────────────────────────────────

async function _loadDashboardStats(container, openCallModal, renderLeadDetail, globalView = false) {
    try {
        const dashStats = await fetchDashboardStats(globalView);
        const total = dashStats.total;
        const sc = dashStats.status_counts;
        const parkedCount = dashStats.parked_count || 0;
        const priorityLeads = dashStats.recent_leads || [];

        // Update subtitle
        const subEl = document.getElementById('dash-subtitle');
        if (subEl) {
            const isPodAdmin = _isPodAdmin();
            const scopeLabel = isPodAdmin
                ? (globalView ? 'Global view' : 'My Pod view')
                : 'Org-wide view';
            subEl.textContent = isAdmin
                ? `${scopeLabel} — ${total} total leads.`
                : `Welcome back, ${currentUser.name?.split(' ')[0] || 'SDR'}! Here's your queue.`;
        }

        // Render stat cards
        const statsEl = document.getElementById('dash-stats');
        if (statsEl) {
            statsEl.innerHTML = isAdmin ? `
                <div class="stat-card"><div class="stat-icon-row"><span class="stat-icon" style="background:#ede9fe;color:#7c3aed;">📋</span></div><div class="stat-title">Total Leads</div><div class="stat-value">${total}</div><div class="stat-trend trend-up">↑ All sources</div></div>
                <div class="stat-card"><div class="stat-icon-row"><span class="stat-icon" style="background:#dbeafe;color:#1d4ed8;">🆕</span></div><div class="stat-title">Lead Assigned</div><div class="stat-value">${sc['Lead Assigned'] || 0}</div><div class="stat-trend">Awaiting research</div></div>
                <div class="stat-card"><div class="stat-icon-row"><span class="stat-icon" style="background:#dbeafe;color:#2563eb;">📅</span></div><div class="stat-title">Demo Scheduled</div><div class="stat-value">${(sc['Demo Scheduled']||0)}</div><div class="stat-trend trend-up">↑ Pipeline progress</div></div>
                <div class="stat-card"><div class="stat-icon-row"><span class="stat-icon" style="background:#fef9c3;color:#b45309;">📞</span></div><div class="stat-title">Calling</div><div class="stat-value">${sc['Calling'] || 0}</div><div class="stat-trend trend-up">↑ Active calling</div></div>
                <div class="stat-card"><div class="stat-icon-row"><span class="stat-icon" style="background:#dcfce7;color:#15803d;">🏆</span></div><div class="stat-title">Meetings+</div><div class="stat-value">${(sc['Meeting Scheduled']||0)+(sc['1st Discovery Meeting']||0)+(sc['Discovery Complete']||0)+(sc['Demo Scheduled']||0)+(sc['Demo Done']||0)+(sc['Completed']||0)}</div><div class="stat-trend trend-up">↑ Qualified pipeline</div></div>
                <div class="stat-card"><div class="stat-icon-row"><span class="stat-icon" style="background:#dbeafe;color:#3b82f6;">🎯</span></div><div class="stat-title">Demos Done</div><div class="stat-value">${(sc['Demo Done']||0)+(sc['Completed']||0)}</div><div class="stat-trend trend-up">↑ SF synced</div></div>
                ${parkedCount > 0 ? `<div class="stat-card" style="border-top:3px solid #ef4444;"><div class="stat-icon-row"><span class="stat-icon" style="background:#fef2f2;color:#dc2626;">📵</span></div><div class="stat-title">No Phone</div><div class="stat-value" style="color:#dc2626;">${parkedCount}</div><div class="stat-trend" style="color:#f87171;">Parked — needs number</div></div>` : ''}
            ` : `
                <div class="stat-card"><div class="stat-icon-row"><span class="stat-icon" style="background:#ede9fe;color:#7c3aed;">👤</span></div><div class="stat-title">My Leads</div><div class="stat-value">${total}</div><div class="stat-trend">Assigned to me</div></div>
                <div class="stat-card" style="border-top:3px solid #3b82f6;"><div class="stat-icon-row"><span class="stat-icon" style="background:#dbeafe;color:#1d4ed8;">🆕</span></div><div class="stat-title">New Leads</div><div class="stat-value" style="color:#3b82f6;">${sc['Lead Assigned'] || 0}</div><div class="stat-trend">Untouched leads</div></div>
                <div class="stat-card" style="border-top:3px solid #f59e0b;"><div class="stat-icon-row"><span class="stat-icon" style="background:#fef3c7;color:#b45309;">🔬</span></div><div class="stat-title">Research Pending</div><div class="stat-value" style="color:#f59e0b;">${sc['Research'] || 0}</div><div class="stat-trend">Complete research first</div></div>
                <div class="stat-card" style="border-top:3px solid #4f46e5;"><div class="stat-icon-row"><span class="stat-icon" style="background:#ede9fe;color:#4f46e5;">📞</span></div><div class="stat-title">Calling</div><div class="stat-value" style="color:#4f46e5;">${sc['Calling'] || 0}</div><div class="stat-trend">In calling queue</div></div>
                <div class="stat-card" style="border-top:3px solid #22c55e;"><div class="stat-icon-row"><span class="stat-icon" style="background:#dcfce7;color:#15803d;">🏆</span></div><div class="stat-title">Meetings Booked</div><div class="stat-value" style="color:#22c55e;">${(sc['Meeting Scheduled']||0)+(sc['1st Discovery Meeting']||0)+(sc['Discovery Complete']||0)+(sc['Demo Scheduled']||0)+(sc['Demo Done']||0)+(sc['Completed']||0)}</div><div class="stat-trend trend-up">↑ Keep it up!</div></div>
            `;
        }

        // Render leads table
        _renderLeadsTable(container, priorityLeads, openCallModal, renderLeadDetail);
    } catch (e) {
        console.error('[Dashboard] Stats load failed:', e);
        const statsEl = document.getElementById('dash-stats');
        if (statsEl) statsEl.innerHTML = '<div class="stat-card"><div class="stat-title" style="color:var(--text-muted);">Failed to load stats</div></div>';
    }
}

function _renderLeadsTable(container, priorityLeads, openCallModal, renderLeadDetail) {
    const tableEl = document.getElementById('dash-leads-table');
    if (!tableEl) return;

    tableEl.innerHTML = `
        <div style="padding:16px 24px;border-bottom:1px solid var(--border-color);font-weight:600;font-size:0.95rem;">
            ${isAdmin ? 'Recent Leads' : '🎯 Priority Queue'}
        </div>
        <table class="data-table">
            <thead><tr>
                <th>Name</th><th>Company</th><th>Phone</th><th>Status</th>
                ${!isAdmin ? '<th>Calls</th><th>Action</th>' : '<th>Last Synced</th>'}
            </tr></thead>
            <tbody>
                ${priorityLeads.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:40px;">No leads yet.</td></tr>` : ''}
                ${priorityLeads.map(lead => {
                    const _displayPhone = (lead.phone && lead.phone.trim()) ? lead.phone : (lead.phone_secondary && lead.phone_secondary.trim()) ? lead.phone_secondary : (lead.company_phone && lead.company_phone.trim()) ? lead.company_phone : null;
                    const _noPhone = !_displayPhone;
                    const _phoneCell = _noPhone
                        ? '<span style="color:#dc2626;font-size:0.72rem;font-weight:600;">📵 No Phone</span>'
                        : _displayPhone;
                    return `
                    <tr class="lead-row" data-id="${lead.id}" style="cursor:pointer;">
                        <td><strong>${fullName(lead)}</strong></td>
                        <td>${lead.company || '—'}</td>
                        <td>${_phoneCell}</td>
                        <td><span class="badge ${statusBadgeClass(displayStatus(lead))}">${displayStatus(lead)}</span></td>
                        ${!isAdmin ? `
                        <td><span style="font-size:0.8rem;color:var(--text-muted);">${lead.call_count || 0}</span></td>
                        <td>${lead.status === 'Calling' && !_noPhone
                            ? `<button class="btn btn-primary quick-call-btn" data-id="${lead.id}" data-name="${fullName(lead)}" data-phone="${lead.phone || ''}" style="padding:6px 12px;font-size:0.78rem;display:inline-flex;align-items:center;gap:6px;" onclick="event.stopPropagation()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg> Call</button>`
                            : `<button class="btn btn-outline" disabled style="padding:6px 12px;font-size:0.78rem;opacity:0.5;cursor:not-allowed;" onclick="event.stopPropagation()">—</button>`
                        }</td>
                        ` : `<td>${fmtDate(lead.last_synced_at)}</td>`}
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;

    // Bind event handlers
    tableEl.querySelectorAll('.lead-row').forEach(row => {
        row.addEventListener('click', () => renderLeadDetail(row.dataset.id));
    });
    tableEl.querySelectorAll('.quick-call-btn').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); openCallModal(btn.dataset.id, btn.dataset.name, btn.dataset.phone); });
    });
}

async function _loadCallOutcomes(container) {
    try {
        const summary = await fetchCallSummary();
        if (!summary) return;
        const outcomesEl = document.getElementById('dash-call-outcomes');
        if (!outcomesEl) return;

        outcomesEl.innerHTML = `
            <div class="info-card" style="margin-bottom:24px;">
                <div class="info-card-title" style="display:flex;justify-content:space-between;align-items:center;">Today's Call Outcomes<span style="font-size:0.85rem;font-weight:500;color:var(--text-muted);">${summary.calls_today} call${summary.calls_today !== 1 ? 's' : ''} today</span></div>
                <div style="display:flex;gap:16px;flex-wrap:wrap;padding:4px 0;">
                    ${Object.entries(summary.outcomes_today).map(([outcome, count]) => `
                        <div class="outcome-card-clickable" data-outcome="${outcome}" style="display:flex;align-items:center;gap:8px;background:var(--bg-secondary);border-radius:8px;padding:10px 16px;cursor:pointer;transition:all 0.15s ease;border:1px solid transparent;" onmouseover="this.style.borderColor='var(--primary-color)';this.style.background='var(--surface-color)'" onmouseout="this.style.borderColor='transparent';this.style.background='var(--bg-secondary)'" title="Click to filter leads by '${outcome}'">
                            <span style="font-size:1.2rem;">${CALL_OUTCOME_ICON[outcome] || '📞'}</span>
                            <div><div style="font-weight:700;font-size:1.1rem;">${count}</div><div style="font-size:0.75rem;color:var(--text-muted);">${outcome}</div></div>
                        </div>`).join('')}
                </div>
            </div>`;

        // Bind outcome card clicks
        outcomesEl.querySelectorAll('.outcome-card-clickable').forEach(card => {
            card.addEventListener('click', () => {
                const outcome = card.dataset.outcome;
                const saved = (() => { try { return JSON.parse(sessionStorage.getItem('leads_view_state')) || {}; } catch { return {}; } })();
                saved.outcomeFilter = outcome;
                saved.currentPage = 1;
                sessionStorage.setItem('leads_view_state', JSON.stringify(saved));
                window._loadView('leads');
            });
        });
    } catch (e) {
        console.error('[Dashboard] Call summary load failed:', e);
    }
}

async function _loadLeaderboard(container, globalView = false) {
    try {
        const leaderboard = await fetchLeaderboard(0, globalView);
        const topSDRs = leaderboard.slice(0, 5);
        if (topSDRs.length === 0) return;

        // Expand the bottom grid to 2 columns
        const grid = document.getElementById('dash-bottom-grid');
        if (grid) grid.style.gridTemplateColumns = '1fr 380px';

        // Append leaderboard card
        const leaderboardHTML = `
            <div class="info-card" id="dash-leaderboard" style="align-self:start;border-radius:12px;padding:20px 24px;">
                <div class="info-card-title" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:none;padding-bottom:0;">
                    <span style="font-size:1.05rem;font-weight:700;color:var(--text-main);letter-spacing:-0.01em;">Leaderboard</span>
                    <a href="#" data-view="leaderboard" class="nav-to-leaderboard" style="font-size:0.8rem;color:var(--primary-color);text-decoration:none;font-weight:500;">View all →</a>
                </div>
                <div style="display:flex;flex-direction:column;gap:12px;">
                ${topSDRs.map((sdr, i) => `
                    <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:10px;background:var(--background-color);border:1px solid var(--border-color);transition:box-shadow var(--transition-speed) ease;${i===0?'box-shadow:0 2px 8px -2px rgba(234,179,8,0.15);border-color:#fef08a;':''}">
                        <div class="rank-badge rank-${i+1}" style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;background:${i===0?'#fef08a':(i===1?'#e2e8f0':(i===2?'#ffedd5':'var(--surface-color)'))};color:${i===0?'#854d0e':(i===1?'#475569':(i===2?'#9a3412':'var(--text-muted)'))};border:1px solid ${i===0?'#fef08a':(i===1?'#cbd5e1':(i===2?'#fed7aa':'var(--border-color)'))};">
                            ${i + 1}
                        </div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:600;font-size:0.9rem;color:var(--text-main);">${sdr.name}</div>
                            <div style="font-size:0.75rem;color:var(--text-muted);">${sdr.pod_name || ''}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-weight:700;font-size:1.1rem;color:${i<3?'var(--text-main)':'var(--text-muted)'};">${sdr.meetings_scheduled}</div>
                            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">Meetings</div>
                        </div>
                    </div>
                `).join('')}
                </div>
            </div>`;

        if (grid) grid.insertAdjacentHTML('beforeend', leaderboardHTML);

        // Bind leaderboard nav
        container.querySelector('.nav-to-leaderboard')?.addEventListener('click', (e) => {
            e.preventDefault();
            window._loadView('leaderboard');
        });
    } catch (e) {
        console.error('[Dashboard] Leaderboard load failed:', e);
    }
}

async function _loadActivityFeed(container, globalView = false) {
    try {
        const activityFeed = await fetchActivityFeed(20, globalView);
        if (!activityFeed || activityFeed.length === 0) return;

        const feedEl = document.getElementById('dash-activity-feed');
        if (!feedEl) return;

        feedEl.innerHTML = `
            <div class="info-card" style="margin-top:24px;">
                <div class="info-card-title" style="display:flex;align-items:center;gap:8px;">📊 Live Activity Feed</div>
                <div style="max-height:400px;overflow-y:auto;">
                    ${activityFeed.map(e => {
                        return `
                        <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-color);">
                            <span style="font-size:1rem;margin-top:2px;">📊</span>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:0.88rem;"><strong>${e.changed_by || 'System'}</strong> moved <strong>${e.lead_name}</strong>${e.company ? ` (${e.company})` : ''}</div>
                                <div style="font-size:0.82rem;margin-top:2px;">
                                    <span class="badge ${statusBadgeClass(e.from_status)}" style="font-size:0.7rem;">${e.from_status || '—'}</span>
                                    <span style="margin:0 4px;">→</span>
                                    <span class="badge ${statusBadgeClass(e.to_status)}" style="font-size:0.7rem;">${e.to_status}</span>
                                </div>
                            </div>
                            <span style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;margin-top:2px;">${fmtRelativeTime(e.changed_at)}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
    } catch (e) {
        console.error('[Dashboard] Activity feed load failed:', e);
    }
}
