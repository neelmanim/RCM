// ── views/assignments.js — Lead Assignment view (admin-only) ─────────────────
// Replaces the assignment sections previously embedded in the Admin panel.
// Key UX: floating action bar slides up when leads are selected.
import * as api from '../api.js';
import { isSuperAdmin } from '../auth.js';
import { statusBadgeClass, displayStatus, fmtDate, fullName, renderPaginated, showToast, showLoader } from '../utils.js';

export async function renderAssignments(container) {
    showLoader(container);

    const [unassignedLeads, assignedLeads, users] = await Promise.all([
        api.fetchUnassignedLeads(),
        api.fetchAssignedLeads(),
        api.fetchAdminUsers(),
    ]);

    const sdrUsers = users.filter(u => u.role === 'SDR' || u.role === 'AE' || u.role === 'Sales');

    // Build unique SDR list from assigned leads for the filter
    const sdrMap = new Map();
    assignedLeads.forEach(l => {
        (l.assigned_to || []).forEach(u => {
            if (!sdrMap.has(u.id)) sdrMap.set(u.id, u.name);
        });
    });
    const sdrFilterOptions = [...sdrMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));

    container.innerHTML = `
        <div class="fade-in" style="position:relative;">
            <!-- Page header -->
            <div class="page-header">
                <div>
                    <h1 class="page-title">📋 Lead Assignments</h1>
                    <p class="page-subtitle">${isSuperAdmin ? 'Distribute leads across your SDR team.' : 'Assign leads to SDRs within your POD.'}</p>
                </div>
                <button class="btn btn-outline" id="auto-assign-btn"
                    style="border-color:var(--primary-color);color:var(--primary-color);">
                    🔄 Round Robin Auto-Assign
                </button>
            </div>

            <!-- ── Unassigned Leads ───────────────────────────────────── -->
            <section class="info-card fade-in" style="margin-bottom:24px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="margin:0;">📥 Unassigned Leads
                        <span style="background:var(--primary-color);color:#fff;border-radius:20px;padding:2px 10px;font-size:0.75rem;margin-left:8px;">${unassignedLeads.length}</span>
                    </h3>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead><tr>
                            <th style="width:40px;"><input type="checkbox" id="select-all-unassigned"></th>
                            <th>Lead</th>
                            <th>Company</th>
                            <th>Status</th>
                            <th>Created</th>
                        </tr></thead>
                        <tbody id="unassigned-leads-tbody"></tbody>
                    </table>
                </div>
                <div id="unassigned-pager" style="display:flex;justify-content:space-between;align-items:center;padding:12px;font-size:0.85rem;color:var(--text-muted);background:var(--background-color);border-radius:0 0 8px 8px;"></div>
            </section>

            <!-- ── Assigned Leads ─────────────────────────────────────── -->
            <section class="info-card fade-in">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px;">
                    <h3 style="margin:0;">✅ Assigned Leads
                        <span style="background:#22c55e;color:#fff;border-radius:20px;padding:2px 10px;font-size:0.75rem;margin-left:8px;">${assignedLeads.length}</span>
                    </h3>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <label style="font-size:0.78rem;color:var(--text-muted);font-weight:600;white-space:nowrap;">Filter SDR:</label>
                        <select id="assigned-sdr-filter" class="filter-select" style="min-width:180px;">
                            <option value="">All SDRs</option>
                            ${sdrFilterOptions.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead><tr>
                            <th style="width:40px;"><input type="checkbox" id="select-all-assigned"></th>
                            <th>Name</th><th>Company</th><th>Status</th>
                            <th>Calls</th><th>Assigned To</th><th></th>
                        </tr></thead>
                        <tbody id="assigned-leads-tbody"></tbody>
                    </table>
                </div>
                <div id="assigned-pager" style="display:flex;justify-content:space-between;align-items:center;padding:12px;font-size:0.85rem;color:var(--text-muted);background:var(--background-color);border-radius:0 0 8px 8px;"></div>
            </section>
        </div>

        <!-- ── Floating Action Bar ────────────────────────────────────── -->
        <div id="assign-action-bar" style="
            position:fixed; bottom:-90px; left:50%; transform:translateX(-50%);
            display:flex; align-items:center; gap:16px;
            background:var(--sidebar-bg); color:#fff;
            padding:14px 28px; border-radius:14px;
            box-shadow:0 8px 32px rgba(0,0,0,0.35);
            transition:bottom 0.3s cubic-bezier(0.34,1.56,0.64,1);
            z-index:9999; min-width:420px; max-width:700px;
        ">
            <span id="selection-count" style="font-size:0.9rem;font-weight:600;white-space:nowrap;">0 selected</span>
            <span style="opacity:0.3;">|</span>

            <!-- Assign controls (shown when unassigned leads selected) -->
            <div id="assign-controls" style="display:none;align-items:center;gap:10px;">
                <select id="assign-to-user" style="
                    flex:1; padding:8px 12px; border-radius:8px;
                    border:1px solid rgba(255,255,255,0.2);
                    background:rgba(255,255,255,0.1); color:#fff;
                    font-size:0.9rem; outline:none; cursor:pointer; min-width:180px;">
                    <option value="">— Select SDR —</option>
                    ${sdrUsers.map(u => {
                        const active = u.active_leads ?? u.assigned_leads ?? 0;
                        const max = u.max_active ?? 5;
                        const atCap = active >= max;
                        return `<option value="${u.id}" ${atCap ? 'disabled' : ''}>${u.name || u.email} (${active}/${max})${atCap ? ' — FULL' : ''}</option>`;
                    }).join('')}
                </select>
                <button id="bulk-assign-btn" class="btn btn-primary" style="white-space:nowrap;padding:8px 18px;">
                    Assign →
                </button>
            </div>

            <!-- Unassign / Delete controls (shown when assigned leads selected) -->
            <div id="unassign-controls" style="display:none;align-items:center;gap:10px;">
                <button id="bulk-unassign-btn" class="btn" style="white-space:nowrap;padding:8px 18px;background:#f59e0b;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">
                    ↩ Unassign
                </button>
                ${isSuperAdmin ? `
                <button id="bulk-delete-btn" class="btn" style="white-space:nowrap;padding:8px 18px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">
                    🗑️ Delete
                </button>` : ''}
            </div>

            <!-- Delete only (shown when unassigned leads selected, for Super Admins) -->
            ${isSuperAdmin ? `
            <div id="delete-unassigned-controls" style="display:none;align-items:center;gap:10px;">
                <button id="bulk-delete-unassigned-btn" class="btn" style="white-space:nowrap;padding:8px 18px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">
                    🗑️ Delete
                </button>
            </div>` : ''}

            <button id="cancel-selection-btn" style="background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:1.1rem;padding:0 4px;" title="Cancel">✕</button>
        </div>`;

    // ── State tracking ────────────────────────────────────────────────────────
    let activeSection = null; // 'unassigned' | 'assigned' | null
    let filteredAssigned = assignedLeads;

    // ── Populate unassigned table ─────────────────────────────────────────────
    // Null guard: the panel may have been closed before the async fetch completed
    if (!document.getElementById('unassigned-leads-tbody')) return;
    renderPaginated(
        unassignedLeads,
        'unassigned-leads-tbody',
        'unassigned-pager',
        15,
        (l) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><input type="checkbox" class="lead-checkbox unassigned-cb" value="${l.id}"></td>
                <td><strong>${fullName(l)}</strong></td>
                <td>${l.company || '—'}</td>
                <td><span class="badge ${statusBadgeClass(displayStatus(l))}">${displayStatus(l)}</span></td>
                <td><span style="font-size:0.75rem;color:var(--text-muted);">${fmtDate(l.created_at)}</span></td>`;
            return row;
        },
        `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:40px;">
            <span style="font-size:1.5rem;">🎉</span><br>All leads are assigned!
        </td></tr>`
    );

    // ── Render assigned table (filterable) ────────────────────────────────────
    function renderAssignedTable(leads) {
        renderPaginated(
            leads,
            'assigned-leads-tbody',
            'assigned-pager',
            15,
            (l) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><input type="checkbox" class="lead-checkbox assigned-cb" value="${l.id}"></td>
                    <td><strong>${fullName(l)}</strong></td>
                    <td>${l.company || '—'}</td>
                    <td><span class="badge ${statusBadgeClass(displayStatus(l))}">${displayStatus(l)}</span></td>
                    <td style="font-size:0.85rem;">${l.call_count || 0}</td>
                    <td style="font-size:0.78rem;">${(l.assigned_to || []).map(u => u.name).join(', ') || '—'}</td>
                    <td>
                        ${(l.assigned_to || []).map(u => `
                            <button class="btn btn-outline unassign-btn"
                                data-user-id="${u.id}" data-lead-id="${l.id}"
                                style="padding:3px 10px;font-size:0.72rem;color:#ef4444;border-color:#ef4444;">
                                Unassign
                            </button>`).join('')}
                    </td>`;
                return row;
            },
            `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px;">No assigned leads yet.</td></tr>`
        );
    }
    renderAssignedTable(assignedLeads);

    // ── SDR Filter ────────────────────────────────────────────────────────────
    document.getElementById('assigned-sdr-filter').addEventListener('change', (e) => {
        const sdrId = e.target.value;
        if (sdrId) {
            filteredAssigned = assignedLeads.filter(l =>
                (l.assigned_to || []).some(u => u.id === sdrId)
            );
        } else {
            filteredAssigned = assignedLeads;
        }
        renderAssignedTable(filteredAssigned);
        // Clear any assigned selections
        document.getElementById('select-all-assigned').checked = false;
        updateActionBar();
    });

    // ── Floating action bar logic ─────────────────────────────────────────────
    const actionBar = document.getElementById('assign-action-bar');
    const countLabel = document.getElementById('selection-count');
    const assignControls = document.getElementById('assign-controls');
    const unassignControls = document.getElementById('unassign-controls');
    const deleteUnassignedControls = document.getElementById('delete-unassigned-controls');

    // Safety: if action bar DOM elements are missing the view was torn down — stop
    if (!actionBar || !countLabel) return;

    function updateActionBar() {
        const unassignedChecked = [...document.querySelectorAll('.unassigned-cb:checked')];
        const assignedChecked = [...document.querySelectorAll('.assigned-cb:checked')];
        const total = unassignedChecked.length + assignedChecked.length;

        if (total === 0) {
            actionBar.style.bottom = '-90px';
            activeSection = null;
            return;
        }

        actionBar.style.bottom = '24px';
        countLabel.textContent = `${total} lead${total > 1 ? 's' : ''} selected`;

        if (unassignedChecked.length > 0 && assignedChecked.length === 0) {
            activeSection = 'unassigned';
            assignControls.style.display = 'flex';
            unassignControls.style.display = 'none';
            if (deleteUnassignedControls) deleteUnassignedControls.style.display = 'flex';
        } else if (assignedChecked.length > 0 && unassignedChecked.length === 0) {
            activeSection = 'assigned';
            assignControls.style.display = 'none';
            unassignControls.style.display = 'flex';
            if (deleteUnassignedControls) deleteUnassignedControls.style.display = 'none';
        } else {
            // Mixed selections — show delete only if super admin
            activeSection = 'mixed';
            assignControls.style.display = 'none';
            unassignControls.style.display = 'none';
            if (deleteUnassignedControls) deleteUnassignedControls.style.display = 'flex';
        }
    }

    // Delegate checkbox changes on both tbodies
    document.getElementById('unassigned-leads-tbody').addEventListener('change', e => {
        if (e.target.classList.contains('unassigned-cb')) {
            // Clear assigned selections when selecting unassigned
            document.querySelectorAll('.assigned-cb:checked').forEach(cb => cb.checked = false);
            document.getElementById('select-all-assigned').checked = false;
            updateActionBar();
        }
    });

    document.getElementById('assigned-leads-tbody').addEventListener('change', e => {
        if (e.target.classList.contains('assigned-cb')) {
            // Clear unassigned selections when selecting assigned
            document.querySelectorAll('.unassigned-cb:checked').forEach(cb => cb.checked = false);
            document.getElementById('select-all-unassigned').checked = false;
            updateActionBar();
        }
    });

    // Select All — Unassigned
    document.getElementById('select-all-unassigned').addEventListener('change', e => {
        document.querySelectorAll('.unassigned-cb').forEach(cb => cb.checked = e.target.checked);
        if (e.target.checked) {
            document.querySelectorAll('.assigned-cb:checked').forEach(cb => cb.checked = false);
            document.getElementById('select-all-assigned').checked = false;
        }
        updateActionBar();
    });

    // Select All — Assigned
    document.getElementById('select-all-assigned').addEventListener('change', e => {
        document.querySelectorAll('.assigned-cb').forEach(cb => cb.checked = e.target.checked);
        if (e.target.checked) {
            document.querySelectorAll('.unassigned-cb:checked').forEach(cb => cb.checked = false);
            document.getElementById('select-all-unassigned').checked = false;
        }
        updateActionBar();
    });

    // Cancel selection
    document.getElementById('cancel-selection-btn').addEventListener('click', () => {
        document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = false);
        document.getElementById('select-all-unassigned').checked = false;
        document.getElementById('select-all-assigned').checked = false;
        updateActionBar();
    });

    // ── Bulk Assign ───────────────────────────────────────────────────────────
    document.getElementById('bulk-assign-btn').addEventListener('click', async () => {
        const userId = document.getElementById('assign-to-user').value;
        if (!userId) { showToast('Please select an SDR first.'); return; }
        const checked = [...document.querySelectorAll('.unassigned-cb:checked')].map(cb => cb.value);
        if (!checked.length) return;

        const btn = document.getElementById('bulk-assign-btn');
        btn.textContent = 'Assigning...'; btn.disabled = true;
        try {
            const data = await api.bulkAssign(userId, checked);
            btn.textContent = `✅ ${data.message || 'Done!'}`;
            setTimeout(() => renderAssignments(container), 1500);
        } catch (e) {
            btn.textContent = 'Assign →'; btn.disabled = false;
            showToast('Assignment failed. Please try again.');
        }
    });

    // ── Bulk Unassign ─────────────────────────────────────────────────────────
    document.getElementById('bulk-unassign-btn').addEventListener('click', async () => {
        const checked = [...document.querySelectorAll('.assigned-cb:checked')].map(cb => cb.value);
        if (!checked.length) return;

        if (!confirm(`Unassign ${checked.length} lead${checked.length > 1 ? 's' : ''} from their current SDRs?`)) return;

        const btn = document.getElementById('bulk-unassign-btn');
        btn.textContent = '⏳ Unassigning...'; btn.disabled = true;
        try {
            const data = await api.bulkUnassign(checked);
            showToast(data.message || `${checked.length} leads unassigned`, 'success');
            setTimeout(() => renderAssignments(container), 1200);
        } catch (e) {
            btn.textContent = '↩ Unassign'; btn.disabled = false;
            showToast('Unassignment failed. Please try again.');
        }
    });

    // ── Bulk Delete (assigned leads) ──────────────────────────────────────────
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', async () => {
            const checked = [...document.querySelectorAll('.assigned-cb:checked')].map(cb => cb.value);
            if (!checked.length) return;
            _doBulkDelete(checked);
        });
    }

    // ── Bulk Delete (unassigned leads) ────────────────────────────────────────
    const bulkDeleteUnassignedBtn = document.getElementById('bulk-delete-unassigned-btn');
    if (bulkDeleteUnassignedBtn) {
        bulkDeleteUnassignedBtn.addEventListener('click', async () => {
            const unassignedChecked = [...document.querySelectorAll('.unassigned-cb:checked')].map(cb => cb.value);
            const assignedChecked = [...document.querySelectorAll('.assigned-cb:checked')].map(cb => cb.value);
            const checked = [...unassignedChecked, ...assignedChecked];
            if (!checked.length) return;
            _doBulkDelete(checked);
        });
    }

    async function _doBulkDelete(leadIds) {
        if (!confirm(`⚠️ PERMANENTLY DELETE ${leadIds.length} lead${leadIds.length > 1 ? 's' : ''}?\n\nThis will remove all associated calls, notes, tasks, and status history.\n\nThis action cannot be undone.`)) return;

        try {
            const data = await api.bulkDeleteLeads(leadIds);
            showToast(data.message || `${leadIds.length} leads deleted`, 'success');
            setTimeout(() => renderAssignments(container), 1200);
        } catch (e) {
            showToast('Delete failed. Please try again.');
        }
    }

    // ── Auto assign ───────────────────────────────────────────────────────────
    document.getElementById('auto-assign-btn').addEventListener('click', async () => {
        if (!confirm('This will distribute ALL unassigned leads across ALL SDRs using round-robin. Continue?')) return;
        const btn = document.getElementById('auto-assign-btn');
        btn.textContent = '⏳ Assigning...'; btn.disabled = true;
        try {
            const res = await api.autoAssignAll();
            if (res.ok) {
                const data = await res.json();
                showToast(data.message, 'success');
                renderAssignments(container);
            } else {
                const err = await res.json();
                showToast(`Auto-assign failed: ${err.message || res.statusText}`);
            }
        } catch (e) { showToast('An error occurred during auto-assignment.'); }
        finally { btn.textContent = '🔄 Round Robin Auto-Assign'; btn.disabled = false; }
    });

    // ── Single Unassign (event delegation — paginated) ────────────────────────
    document.getElementById('assigned-leads-tbody').addEventListener('click', async e => {
        if (e.target.classList.contains('unassign-btn')) {
            const btn = e.target;
            await api.unassignLead(btn.dataset.userId, btn.dataset.leadId);
            renderAssignments(container);
        }
    });
}
