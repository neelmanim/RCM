// ── views/admin.js — Admin panel: User Management with V2 roles ──────────────
import { isSuperAdmin, currentUser, authHeaders } from '../auth.js';
import { fetchAdminUsers, deleteUser, patchUserAccess, patchUserRole, fetchUserToken, createUser, uploadSdrCsv, patchUserSettings } from '../api.js';
import { ssoTag, fmtRelativeTime, showLoader } from '../utils.js';

const isPodAdmin = () => currentUser?.role === 'Pod Admin';
const PER_PAGE = 10;

export async function renderAdmin(container, renderAssignments) {
    if (!container) return;
    showLoader(container);

    const users = await fetchAdminUsers();
    const superAdmins = users.filter(u => u.role === 'Super Admin');
    const podAdmins   = users.filter(u => u.role === 'Pod Admin');
    const sdrUsers    = users.filter(u => u.role === 'SDR');
    const aeUsers     = users.filter(u => u.role === 'AE');

    const showSuperAdminTab = isSuperAdmin;
    const showAddUser = isSuperAdmin;

    // ── Compute stats ────────────────────────────────────────────────────
    const now = Date.now();
    const _daysSinceLogin = (u) => {
        if (!u.last_login_at) return Infinity;
        return (now - new Date(u.last_login_at).getTime()) / 86400000;
    };
    const totalUsers = users.length;
    const activeUsers = users.filter(u => _daysSinceLogin(u) <= 7).length;
    const neverLoggedIn = users.filter(u => !u.last_login_at).length;
    const revokedUsers = users.filter(u => !u.access_allowed).length;

    // ── Collect unique PODs for filter ────────────────────────────────────
    const allPods = [...new Set(users.map(u => u.pod?.name).filter(Boolean))].sort();

    // ── State ─────────────────────────────────────────────────────────────
    let activeTab = showSuperAdminTab ? 'super-admins' : 'my-team';
    let searchQuery = '';
    let podFilter = '';
    let sortField = 'name';
    let sortDir = 'asc';
    let currentPage = 1;

    container.innerHTML = `
        <div class="admin-panel">
            <div class="page-header">
                <div>
                    <h1 class="page-title">🛡️ ${isPodAdmin() ? 'Team Management' : 'Admin Panel'}</h1>
                    <p class="page-subtitle">${isPodAdmin() ? 'Manage your POD team members.' : 'Manage users, roles, and access.'}</p>
                </div>
                ${showAddUser ? '<button class="btn btn-primary" id="open-add-user-btn" style="padding:8px 18px;font-size:0.85rem;">+ Add User</button>' : ''}
            </div>

            ${isSuperAdmin ? `
            <div id="admin-stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;">
                <div class="info-card" style="padding:16px 20px;text-align:left;margin-bottom:0;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:4px;">Total Users</div>
                    <div style="font-size:1.6rem;font-weight:700;color:var(--text-primary);">${totalUsers}</div>
                </div>
                <div class="info-card" style="padding:16px 20px;text-align:left;margin-bottom:0;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:4px;">Active (7d)</div>
                    <div style="font-size:1.6rem;font-weight:700;color:var(--success-color);">${activeUsers}</div>
                </div>
                <div class="info-card" style="padding:16px 20px;text-align:left;margin-bottom:0;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:4px;">Never Logged In</div>
                    <div style="font-size:1.6rem;font-weight:700;color:#f59e0b;">${neverLoggedIn}</div>
                </div>
                <div class="info-card" style="padding:16px 20px;text-align:left;margin-bottom:0;">
                    <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:4px;">Access Revoked</div>
                    <div style="font-size:1.6rem;font-weight:700;color:#ef4444;">${revokedUsers}</div>
                </div>
            </div>` : ''}

            <div id="admin-board" class="info-card" style="padding:0;overflow:hidden;"></div>
        </div>`;

    const adminBoard = document.getElementById('admin-board');

    // ── Render the full interactive panel ──────────────────────────────────
    function renderBoard() {
        const tabs = showSuperAdminTab
            ? [
                { id: 'super-admins', label: '🏆 Super Admins', count: superAdmins.length },
                { id: 'pod-admins', label: '👥 Pod Admins', count: podAdmins.length },
                { id: 'sdrs', label: '📋 SDRs', count: sdrUsers.length },
                { id: 'aes', label: '💼 AEs', count: aeUsers.length },
              ]
            : [{ id: 'my-team', label: '👥 My Team', count: users.length }];

        // Determine current user list
        let currentUsers;
        let roleType;
        if (activeTab === 'super-admins') { currentUsers = superAdmins; roleType = 'Super Admin'; }
        else if (activeTab === 'pod-admins') { currentUsers = podAdmins; roleType = 'Pod Admin'; }
        else if (activeTab === 'sdrs') { currentUsers = sdrUsers; roleType = 'SDR'; }
        else if (activeTab === 'aes') { currentUsers = aeUsers; roleType = 'AE'; }
        else { currentUsers = users; roleType = 'team'; }

        // Apply search filter
        let filtered = currentUsers;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(u =>
                (u.name || '').toLowerCase().includes(q) ||
                (u.email || '').toLowerCase().includes(q)
            );
        }

        // Apply POD filter
        if (podFilter) {
            filtered = filtered.filter(u => (u.pod?.name || '') === podFilter);
        }

        // Apply sort
        filtered = [...filtered].sort((a, b) => {
            let valA, valB;
            if (sortField === 'name') {
                valA = (a.name || '').toLowerCase();
                valB = (b.name || '').toLowerCase();
            } else if (sortField === 'email') {
                valA = (a.email || '').toLowerCase();
                valB = (b.email || '').toLowerCase();
            } else if (sortField === 'last_login') {
                valA = a.last_login_at ? new Date(a.last_login_at).getTime() : 0;
                valB = b.last_login_at ? new Date(b.last_login_at).getTime() : 0;
            } else if (sortField === 'pod') {
                valA = (a.pod?.name || '').toLowerCase();
                valB = (b.pod?.name || '').toLowerCase();
            }
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        // Pagination
        const totalFiltered = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalFiltered / PER_PAGE));
        if (currentPage > totalPages) currentPage = totalPages;
        const startIdx = (currentPage - 1) * PER_PAGE;
        const pageUsers = filtered.slice(startIdx, startIdx + PER_PAGE);

        // Sort arrow helper
        const sortArrow = (field) => {
            if (sortField !== field) return '';
            return sortDir === 'asc' ? ' ↑' : ' ↓';
        };
        const sortClass = (field) => sortField === field ? 'color:var(--primary-color);' : '';

        adminBoard.innerHTML = `
            <!-- Tabs -->
            <div style="display:flex;gap:0;border-bottom:2px solid var(--border-color);padding:0 24px;">
                ${tabs.map(t => `
                    <button class="admin-tab-trigger" data-tab="${t.id}"
                      style="padding:12px 20px;font-size:0.9rem;font-weight:600;background:none;border:none;
                        border-bottom:2px solid ${t.id === activeTab ? 'var(--primary-color)' : 'transparent'};
                        color:${t.id === activeTab ? 'var(--primary-color)' : 'var(--text-muted)'};
                        cursor:pointer;margin-bottom:-2px;">
                        ${t.label}
                        <span style="background:${t.id === activeTab ? 'var(--primary-color)' : 'var(--border-color)'};
                            color:${t.id === activeTab ? '#fff' : 'var(--text-muted)'};
                            border-radius:10px;padding:1px 8px;font-size:0.75rem;margin-left:4px;">${t.count}</span>
                    </button>`).join('')}
            </div>

            <!-- Filter bar -->
            <div style="display:flex;gap:10px;padding:12px 24px;align-items:center;flex-wrap:wrap;background:var(--bg-secondary);border-bottom:1px solid var(--border-color);">
                <div style="flex:1;min-width:200px;position:relative;">
                    <input type="text" id="admin-search" placeholder="🔍 Search by name or email..."
                        value="${searchQuery}"
                        style="width:100%;padding:8px 14px;border:1px solid var(--border-color);border-radius:8px;font-size:0.85rem;background:var(--bg-primary);">
                </div>
                ${allPods.length > 0 ? `
                <select id="admin-pod-filter" style="padding:8px 14px;border:1px solid var(--border-color);border-radius:8px;font-size:0.85rem;background:var(--bg-primary);">
                    <option value="">POD: All</option>
                    ${allPods.map(p => `<option value="${p}" ${podFilter === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select>` : ''}
                <button class="btn btn-outline admin-sort-btn" data-field="last_login"
                    style="padding:6px 14px;font-size:0.82rem;white-space:nowrap;${sortField === 'last_login' ? 'border-color:var(--primary-color);color:var(--primary-color);' : ''}">
                    Sort: Last Login${sortArrow('last_login')}
                </button>
                <button class="btn btn-outline" id="admin-export-csv" style="padding:6px 14px;font-size:0.82rem;">📥 Export</button>
                ${activeTab === 'sdrs' ? `
                <button class="btn btn-outline" id="admin-upload-csv" style="padding:6px 12px;font-size:0.8rem;">📤 Upload CSV</button>
                <input type="file" id="sdr-csv-input" accept=".csv" style="display:none;">` : ''}
            </div>

            <!-- Table -->
            <div class="table-container" style="min-height:120px;">
                ${pageUsers.length === 0
                    ? `<div style="text-align:center;color:var(--text-muted);padding:40px;">
                        ${searchQuery || podFilter ? 'No users match your filters.' : `No ${roleType} users.`}
                       </div>`
                    : `<table class="data-table">
                        <thead><tr>
                            <th style="cursor:pointer;${sortClass('name')}" class="admin-sort-btn" data-field="name">Name${sortArrow('name')}</th>
                            <th style="cursor:pointer;${sortClass('email')}" class="admin-sort-btn" data-field="email">Email${sortArrow('email')}</th>
                            <th>Status</th>
                            <th style="cursor:pointer;${sortClass('last_login')}" class="admin-sort-btn" data-field="last_login">Last Login${sortArrow('last_login')}</th>
                            <th style="cursor:pointer;${sortClass('pod')}" class="admin-sort-btn" data-field="pod">POD${sortArrow('pod')}</th>
                            ${(isSuperAdmin || (isPodAdmin() && (roleType === 'SDR' || roleType === 'AE' || roleType === 'team'))) ? '<th>Access</th>' : ''}
                            ${roleType === 'SDR' || roleType === 'AE' || roleType === 'team' ? '<th>Leads</th>' : ''}
                            ${isSuperAdmin && (roleType === 'SDR' || roleType === 'AE' || roleType === 'team') ? '<th title="Toggle Aircall dialer widget visibility per SDR">Dialer Access</th>' : ''}
                            ${isSuperAdmin && (roleType === 'SDR' || roleType === 'AE' || roleType === 'team') ? '<th title="Toggle Email Sync tab visibility per SDR">Email Sync</th>' : ''}
                            ${isSuperAdmin ? '<th title="Per-user dialer provider override">Dialer Override</th>' : ''}
                             ${isSuperAdmin && (roleType === 'SDR' || roleType === 'AE' || roleType === 'team') ? '<th title="RCM sub-agent ID and caller number">RCM Agent</th>' : ''}
                            <th>Role</th>
                            ${(isSuperAdmin || (isPodAdmin() && (roleType === 'SDR' || roleType === 'AE' || roleType === 'team'))) ? '<th>Action</th>' : ''}
                        </tr></thead>
                        <tbody>${pageUsers.map(user => _renderRow(user, roleType)).join('')}</tbody>
                    </table>`}
            </div>

            <!-- Pagination -->
            ${totalPages > 1 ? `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 24px;border-top:1px solid var(--border-color);">
                <span style="font-size:0.82rem;color:var(--text-muted);">
                    Showing ${startIdx + 1}–${Math.min(startIdx + PER_PAGE, totalFiltered)} of ${totalFiltered}
                </span>
                <div style="display:flex;gap:4px;">
                    <button class="btn btn-outline btn-sm admin-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} style="padding:4px 10px;">‹</button>
                    ${_pageButtons(currentPage, totalPages)}
                    <button class="btn btn-outline btn-sm admin-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} style="padding:4px 10px;">›</button>
                </div>
            </div>` : `
            <div style="padding:8px 24px;border-top:1px solid var(--border-color);">
                <span style="font-size:0.82rem;color:var(--text-muted);">Showing ${totalFiltered} ${roleType} user${totalFiltered !== 1 ? 's' : ''}</span>
            </div>`}
        `;

        // ── Bind events ────────────────────────────────────────────────────
        // Tab clicks
        adminBoard.querySelectorAll('.admin-tab-trigger').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                searchQuery = '';
                podFilter = '';
                currentPage = 1;
                renderBoard();
            });
        });

        // Search
        const searchInput = document.getElementById('admin-search');
        if (searchInput) {
            let timer;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    searchQuery = e.target.value.trim();
                    currentPage = 1;
                    renderBoard();
                    // Refocus + restore cursor
                    const el = document.getElementById('admin-search');
                    if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
                }, 300);
            });
        }

        // POD filter
        document.getElementById('admin-pod-filter')?.addEventListener('change', (e) => {
            podFilter = e.target.value;
            currentPage = 1;
            renderBoard();
        });

        // Sort buttons (both in filter bar and in thead)
        adminBoard.querySelectorAll('.admin-sort-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const field = btn.dataset.field;
                if (sortField === field) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                else { sortField = field; sortDir = field === 'last_login' ? 'desc' : 'asc'; }
                renderBoard();
            });
        });

        // Pagination
        adminBoard.querySelectorAll('.admin-page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentPage = parseInt(btn.dataset.page);
                renderBoard();
            });
        });

        // Export CSV
        document.getElementById('admin-export-csv')?.addEventListener('click', () => {
            const headers = ['Name', 'Email', 'Role', 'POD', 'Last Login', 'Status', 'Access'];
            const rows = filtered.map(u => [
                u.name || '', u.email || '', u.role || '',
                u.pod?.name || '', u.last_login_at || 'Never',
                _activityLabel(u), u.access_allowed ? 'Active' : 'Revoked'
            ]);
            const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `users_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(link.href);
        });

        // Upload CSV (SDRs tab)
        document.getElementById('admin-upload-csv')?.addEventListener('click', () => {
            document.getElementById('sdr-csv-input')?.click();
        });

        // View-as, Delete, Toggle access, Role change
        if (isSuperAdmin) {
            adminBoard.querySelectorAll('.view-user-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        const data = await fetchUserToken(btn.dataset.userId);
                        if (data?.token) window.open(`index.html?token=${data.token}`, '_blank');
                    } catch (e) { console.error('View screen failed:', e); }
                });
            });
        }

        adminBoard.querySelectorAll('.delete-user').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('Permanently delete this user?')) {
                    const res = await deleteUser(btn.dataset.userId);
                    if (res.ok) renderAdmin(container, renderAssignments);
                    else { const e = await res.json().catch(() => ({})); alert(e.detail || 'Delete failed'); }
                }
            });
        });

        adminBoard.querySelectorAll('.toggle-access-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.action;
                if (!confirm(`${action === 'revoke' ? 'Revoke' : 'Restore'} access?`)) return;
                btn.disabled = true; btn.textContent = '...';
                const res = await patchUserAccess(btn.dataset.userId, action);
                if (res.ok) renderAdmin(container, renderAssignments);
                else { const e = await res.json().catch(() => ({})); alert(e.detail || 'Action failed'); btn.disabled = false; }
            });
        });

        if (isSuperAdmin) {
            adminBoard.querySelectorAll('.role-change-select').forEach(sel => {
                sel.addEventListener('change', async () => {
                    const userId = sel.dataset.userId;
                    const newRole = sel.value;
                    if (!confirm(`Change role to ${newRole}?`)) { sel.value = sel.dataset.currentRole; return; }
                    const res = await patchUserRole(userId, newRole);
                    if (res.ok) renderAdmin(container, renderAssignments);
                    else { const e = await res.json().catch(() => ({})); alert(e.detail || 'Role change failed'); }
                });
            });
        }
        // Toggle dialer access
        if (isSuperAdmin) {
            adminBoard.querySelectorAll('.toggle-dialer-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const userId = btn.dataset.userId;
                    const newVal = btn.dataset.current === 'true' ? false : true;
                    btn.disabled = true;
                    const res = await patchUserSettings(userId, { dialer_enabled: newVal });
                    if (res.ok) {
                        // Update user object in-place so re-render is instant
                        const u = [...superAdmins, ...podAdmins, ...sdrUsers, ...aeUsers].find(u => u.id === userId);
                        if (u) u.dialer_enabled = newVal;
                        renderBoard();
                    } else {
                        const e = await res.json().catch(() => ({}));
                        alert(e.detail || 'Failed to update dialer access');
                        btn.disabled = false;
                    }
                });
            });

            // Toggle email sync access
            adminBoard.querySelectorAll('.toggle-email-sync-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const userId = btn.dataset.userId;
                    const newVal = btn.dataset.current === 'true' ? false : true;
                    btn.disabled = true;
                    const res = await patchUserSettings(userId, { email_sync_enabled: newVal });
                    if (res.ok) {
                        const u = [...superAdmins, ...podAdmins, ...sdrUsers, ...aeUsers].find(u => u.id === userId);
                        if (u) u.email_sync_enabled = newVal;
                        renderBoard();
                    } else {
                        const e = await res.json().catch(() => ({}));
                        alert(e.detail || 'Failed to update email sync access');
                        btn.disabled = false;
                    }
                });
            });

            // Item 2: Dialer provider override per SDR
            adminBoard.querySelectorAll('.dialer-override-select').forEach(sel => {
                // Store the current value so we can revert on failure
                sel.dataset.prevValue = sel.value;
                sel.addEventListener('change', async () => {
                    const userId = sel.dataset.userId;
                    const prevValue = sel.dataset.prevValue || '';
                    const newVal = sel.value || null;  // null = use global
                    sel.disabled = true;
                    const res = await patchUserSettings(userId, { dialer_provider_override: newVal });
                    if (res.ok) {
                        const u = [...superAdmins, ...podAdmins, ...sdrUsers, ...aeUsers].find(u => u.id === userId);
                        if (u) u.dialer_provider_override = newVal;
                        sel.dataset.prevValue = sel.value;  // update stored value
                        sel.disabled = false;
                    } else {
                        const e = await res.json().catch(() => ({}));
                        alert(e.detail || 'Failed to update dialer override');
                        sel.value = prevValue;  // revert to previous value
                        sel.disabled = false;
                    }
                });
            });

            // RCM sub-agent: Agent ID and From-Number (blur-to-save)
            function _bindConvInput(cssClass, fieldKey) {
                adminBoard.querySelectorAll(`.${cssClass}`).forEach(input => {
                    const originalValue = input.value;
                    input.dataset.original = originalValue;

                    input.addEventListener('blur', async () => {
                        const userId = input.dataset.userId;
                        const newVal = input.value.trim();
                        if (newVal === input.dataset.original) return; // no change

                        input.style.borderColor = 'var(--border-color)';
                        const res = await patchUserSettings(userId, { [fieldKey]: newVal });
                        if (res.ok) {
                            const body = await res.json().catch(() => ({}));
                            input.dataset.original = newVal;
                            input.style.borderColor = '#10b981'; // green
                            setTimeout(() => { input.style.borderColor = 'var(--border-color)'; }, 2000);
                            // Update user object in-place for instant re-render
                            const u = [...superAdmins, ...podAdmins, ...sdrUsers, ...aeUsers].find(u => u.id === userId);
                            if (u) u[fieldKey] = body[fieldKey] ?? newVal;
                            if (body.warning) {
                                alert(`⚠️ ${body.warning}`);
                            }
                        } else {
                            const e = await res.json().catch(() => ({}));
                            alert(e.detail || `Failed to update ${fieldKey}`);
                            input.value = input.dataset.original; // revert
                            input.style.borderColor = '#ef4444'; // red
                            setTimeout(() => { input.style.borderColor = 'var(--border-color)'; }, 2000);
                        }
                    });
                });
            }
            _bindConvInput('conv-agent-id-input', 'rcm_user_id');
            _bindConvInput('conv-from-number-input', 'rcm_from_number');
            _bindConvInput('conv-email-input', 'rcm_email');
        }
    }

    renderBoard();

    // Add user button
    if (showAddUser) {
        document.getElementById('open-add-user-btn')?.addEventListener('click', () => {
            document.getElementById('new-user-name').value = '';
            document.getElementById('new-user-email').value = '';
            document.getElementById('new-user-role').value = 'SDR';
            document.getElementById('add-user-modal').classList.add('active');
        });
    }
}

// ── Toggle button helper ─────────────────────────────────────────────────────
function _toggleButton(userId, cssClass, isOn, icon, label) {
    const onStyle  = 'background:#059669;color:#fff;border-color:#059669;';
    const offStyle = 'background:var(--bg-secondary);color:var(--text-muted);border-color:var(--border-color);';
    return `<button
        class="btn btn-sm ${cssClass}"
        data-user-id="${userId}"
        data-current="${isOn}"
        title="${isOn ? 'Click to disable' : 'Click to enable'} ${label} access"
        style="padding:3px 10px;font-size:0.75rem;font-weight:600;border-radius:20px;border:1px solid;${isOn ? onStyle : offStyle}">
        ${isOn ? `${icon} ON` : `${icon} OFF`}
    </button>`;
}

// ── Activity status helpers ──────────────────────────────────────────────────
function _activityStatus(user) {
    if (!user.last_login_at) return 'never';
    const days = (Date.now() - new Date(user.last_login_at).getTime()) / 86400000;
    if (days <= 7) return 'active';
    if (days <= 30) return 'idle';
    return 'inactive';
}

function _activityLabel(user) {
    const s = _activityStatus(user);
    if (s === 'active') return 'Active';
    if (s === 'idle') return 'Idle';
    if (s === 'inactive') return 'Inactive';
    return 'Never';
}

function _activityBadge(user) {
    const status = _activityStatus(user);
    const config = {
        active:   { color: '#10b981', bg: '#ecfdf5', label: 'Active', dot: '🟢' },
        idle:     { color: '#f59e0b', bg: '#fffbeb', label: 'Idle',   dot: '🟡' },
        inactive: { color: '#ef4444', bg: '#fef2f2', label: 'Inactive', dot: '🔴' },
        never:    { color: '#9ca3af', bg: '#f3f4f6', label: 'Never',  dot: '⚪' },
    }[status];
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:10px;font-size:0.75rem;font-weight:600;background:${config.bg};color:${config.color};">
        ${config.dot} ${config.label}
    </span>`;
}

// ── Render a single user row ─────────────────────────────────────────────────
function _renderRow(user, roleType) {
    // Pod Admins can manage SDRs in their own team, but only Super Admins
    // can manage other admins (Pod Admin / Super Admin rows).
    const isManagingAdmins = roleType === 'Super Admin' || roleType === 'Pod Admin';
    const showAccessControls = isSuperAdmin || (!isManagingAdmins && isPodAdmin());
    const showViewAs = isSuperAdmin;
    const showDelete = isSuperAdmin || (!isManagingAdmins && isPodAdmin());
    const showRoleDropdown = isSuperAdmin;

    const status = _activityStatus(user);
    const rowBg = status === 'never' ? 'background:#fefce8;' : !user.access_allowed ? 'background:#fef2f2;' : '';

    const accessIcon = user.access_allowed
        ? `<span style="color:var(--status-won);">🔓</span>
           <button class="btn btn-outline btn-sm toggle-access-btn" data-user-id="${user.id}" data-action="revoke"
             style="margin-left:4px;padding:2px 6px;font-size:0.7rem;color:#f59e0b;border-color:#f59e0b;">Revoke</button>`
        : `<span style="color:#ef4444;">🔒</span>
           <button class="btn btn-outline btn-sm toggle-access-btn" data-user-id="${user.id}" data-action="grant"
             style="margin-left:4px;padding:2px 6px;font-size:0.7rem;color:var(--status-won);border-color:var(--status-won);">Restore</button>`;

    const roles = ['SDR', 'AE', 'Pod Admin', 'Super Admin'];
    const roleCell = showRoleDropdown
        ? `<select class="role-change-select" data-user-id="${user.id}" data-current-role="${user.role}" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);font-size:0.8rem;">
            ${roles.map(r => `<option value="${r}" ${r === user.role ? 'selected' : ''}>${r}</option>`).join('')}
           </select>`
        : `<span style="font-size:0.82rem;">${user.role}</span>`;

    const actionBtns = [];
    if (showViewAs) actionBtns.push(`<button class="btn btn-outline btn-sm view-user-btn" data-user-id="${user.id}" title="View As" style="padding:4px 8px;font-size:1rem;">👁️</button>`);
    if (showDelete) actionBtns.push(`<button class="btn btn-outline btn-sm delete-user" data-user-id="${user.id}" title="Delete" style="padding:4px 8px;font-size:1rem;color:#ef4444;border-color:#ef4444;">🗑️</button>`);

    return `<tr data-user-id="${user.id}" style="${rowBg}">
        <td><b>${user.name || roleType}</b></td>
        <td style="font-size:0.85rem;">${user.email}</td>
        <td>${_activityBadge(user)}</td>
        <td style="font-size:0.82rem;${_activityStatus(user) === 'never' ? 'color:#ef4444;font-weight:600;' : ''}">${fmtRelativeTime(user.last_login_at)}</td>
        <td style="font-size:0.82rem;">${user.pod?.name || '—'}</td>
        ${showAccessControls ? `<td style="white-space:nowrap;">${accessIcon}</td>` : ''}
        ${roleType === 'SDR' || roleType === 'AE' || roleType === 'team' ? `<td>${user.assigned_leads ?? 0}</td>` : ''}
        ${showAccessControls && (roleType === 'SDR' || roleType === 'AE' || roleType === 'team') ? `
        <td style="text-align:center;">
            ${_toggleButton(user.id, 'toggle-dialer-btn', user.dialer_enabled, '📞', 'Dialer')}
        </td>
        <td style="text-align:center;">
            ${_toggleButton(user.id, 'toggle-email-sync-btn', user.email_sync_enabled, '✉️', 'Email')}
        </td>` : ''}
        ${isSuperAdmin ? `
        <td style="text-align:center;">
            <select class="dialer-override-select" data-user-id="${user.id}"
              title="Override dialer provider for this user"
              style="padding:3px 6px;font-size:0.75rem;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-primary);">
                <option value="" ${!user.dialer_provider_override ? 'selected' : ''}>Global</option>
                <option value="aircall" ${user.dialer_provider_override === 'aircall' ? 'selected' : ''}>Aircall</option>
                <option value="rcm" ${user.dialer_provider_override === 'rcm' ? 'selected' : ''}>RCM</option>
            </select>
        </td>` : ''}
        ${isSuperAdmin && (roleType === 'SDR' || roleType === 'AE' || roleType === 'team') ? `
        <td style="min-width:220px;">
            <div style="display:flex;flex-direction:column;gap:4px;">
                <input
                    type="text"
                    class="conv-agent-id-input"
                    data-user-id="${user.id}"
                    data-field="rcm_user_id"
                    value="${user.rcm_user_id || ''}"
                    placeholder="Agent ID"
                    title="RCM sub-agent user ID"
                    style="width:100%;padding:3px 6px;font-size:0.75rem;border-radius:5px;border:1px solid var(--border-color);background:var(--bg-primary);"
                />
                <input
                    type="text"
                    class="conv-from-number-input"
                    data-user-id="${user.id}"
                    data-field="rcm_from_number"
                    value="${user.rcm_from_number || ''}"
                    placeholder="Caller ID (e.g. 0091…)"
                    title="RCM caller ID (from_number)"
                    style="width:100%;padding:3px 6px;font-size:0.75rem;border-radius:5px;border:1px solid var(--border-color);background:var(--bg-primary);"
                />
                <input
                    type="email"
                    class="conv-email-input"
                    data-user-id="${user.id}"
                    data-field="rcm_email"
                    value="${user.rcm_email || ''}"
                    placeholder="agent@rcm.com"
                    title="SDR’s RCM login email (display/audit only)"
                    style="width:100%;padding:3px 6px;font-size:0.75rem;border-radius:5px;border:1px solid var(--border-color);background:var(--bg-primary);"
                />
            </div>
        </td>` : ''}
        <td>${roleCell}</td>
        ${actionBtns.length ? `<td><div style="display:flex;gap:6px;">${actionBtns.join('')}</div></td>` : ''}
    </tr>`;

}

// ── Page buttons ─────────────────────────────────────────────────────────────
function _pageButtons(current, total) {
    let buttons = '';
    let start = Math.max(1, current - 2);
    let end = Math.min(total, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) {
        buttons += `<button class="btn ${i === current ? 'btn-primary' : 'btn-outline'} btn-sm admin-page-btn" data-page="${i}" style="padding:4px 10px;min-width:32px;">${i}</button>`;
    }
    return buttons;
}
