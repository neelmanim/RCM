// ── views/pods.js — POD team management view ──────────────────────────────────
import { isSuperAdmin, isPodAdmin } from '../auth.js';
import { fetchPods, fetchAdminUsers, createPod, updatePod, deletePod, addPodMember, removePodMember, addPodAdmin, removePodAdmin } from '../api.js';
import { showLoader } from '../utils.js';

// A curated list, not the full ~600-zone IANA database — covers the
// timezones a sales team is actually likely to operate out of (same
// tradeoff as the Sales Cadence send-window's own timezone picker).
const TIMEZONES = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Johannesburg',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo',
    'Australia/Sydney', 'Pacific/Auckland',
];

function timezoneOptions(selected) {
    return `<option value="">-- Default (UTC) --</option>` +
        TIMEZONES.map(tz => `<option value="${tz}"${tz === selected ? ' selected' : ''}>${tz}</option>`).join('');
}

export async function renderPods(container) {
    showLoader(container);
    const [pods, users] = await Promise.all([fetchPods(), fetchAdminUsers()]);
    const availableSDRs = users.filter(u => u.role === 'SDR' || u.role === 'AE');
    // Users eligible to be Pod Admins (SDR, AE, or existing Pod Admin)
    const eligibleAdmins = users.filter(u => ['SDR', 'AE', 'Pod Admin'].includes(u.role));

    container.innerHTML = `
        <div class="view-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h1 style="font-size:1.5rem;font-weight:700;">👥 POD Management</h1>
            ${isSuperAdmin ? `<button class="btn btn-primary" id="create-pod-btn">+ Create POD</button>` : ''}
        </div>

        ${isSuperAdmin ? `
        <div id="create-pod-form" style="display:none;background:var(--surface-color);border:1px solid var(--border-color);border-radius:12px;padding:24px;margin-bottom:24px;">
            <h3 style="font-size:1rem;font-weight:600;margin-bottom:16px;">Create New POD</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:end;">
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.8rem;font-weight:600;margin-bottom:4px;">Pod Name</label>
                    <input type="text" id="new-pod-name" placeholder="e.g. Alpha Team" style="padding:10px 14px;">
                </div>
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.8rem;font-weight:600;margin-bottom:4px;">Initial Admin (optional)</label>
                    <select id="new-pod-admin" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);">
                        <option value="">-- No admin yet --</option>
                        ${eligibleAdmins.map(u => `<option value="${u.id}">${u.name} (${u.email})</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.8rem;font-weight:600;margin-bottom:4px;" title="Used to bucket this team's Analytics by their own local day, not UTC.">Timezone (optional)</label>
                    <select id="new-pod-timezone" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);">
                        ${timezoneOptions('')}
                    </select>
                </div>
                <button class="btn btn-primary" id="submit-create-pod">Create</button>
            </div>
        </div>
        ` : ''}

        <div id="pods-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:20px;">
            ${pods.length === 0 ? `<div style="padding:40px;text-align:center;color:var(--text-muted);grid-column:1/-1;">
                <div style="font-size:2.5rem;margin-bottom:8px;">👥</div>
                <p>No PODs created yet. ${isSuperAdmin ? 'Click "Create POD" to get started.' : ''}</p>
            </div>` : ''}
            ${pods.map(pod => `
                <div class="card" style="background:var(--surface-color);border:1px solid var(--border-color);border-radius:12px;padding:24px;overflow:hidden;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                        <h3 style="font-size:1.1rem;font-weight:700;">${pod.name}</h3>
                        <div style="display:flex;gap:8px;flex-shrink:0;">
                            <span class="badge badge-qualified" style="font-size:0.75rem;">${pod.member_count} members</span>
                            ${isSuperAdmin ? `<button class="btn btn-outline btn-sm" onclick="window._deletePod('${pod.id}','${pod.name}')" title="Delete POD" style="color:#ef4444;border-color:#ef4444;">🗑️</button>` : ''}
                        </div>
                    </div>

                    ${isSuperAdmin ? `
                    <div style="margin-bottom:16px;display:flex;gap:8px;align-items:center;">
                        <label style="font-size:0.8rem;font-weight:600;color:var(--text-muted);white-space:nowrap;" title="Used to bucket this team's Analytics by their own local day, not UTC.">🌐 Timezone</label>
                        <select id="pod-tz-${pod.id}" style="flex:1;min-width:0;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color);font-size:0.82rem;">
                            ${timezoneOptions(pod.timezone || '')}
                        </select>
                        <button class="btn btn-outline btn-sm" style="flex-shrink:0;" onclick="window._savePodTimezone('${pod.id}')">Save</button>
                    </div>
                    ` : ''}

                    <!-- Pod Admins section -->
                    <div style="margin-bottom:16px;padding:12px;background:var(--bg-secondary);border-radius:8px;">
                        <div style="font-size:0.8rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">
                            👤 Pod Admins ${pod.admins && pod.admins.length > 0 ? `<span style="font-weight:400;text-transform:none;color:var(--text-color);">(${pod.admins.length})</span>` : ''}
                        </div>
                        ${!pod.admins || pod.admins.length === 0
                            ? `<div style="font-size:0.85rem;color:var(--text-muted);font-style:italic;">No admins assigned</div>`
                            : pod.admins.map(a => `
                                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--surface-color);border-radius:6px;margin-bottom:4px;">
                                    <div>
                                        <span style="font-weight:600;font-size:0.85rem;">${a.name}</span>
                                        <span style="font-size:0.75rem;color:var(--text-muted);margin-left:6px;">${a.email}</span>
                                    </div>
                                    ${isSuperAdmin ? `<button class="btn btn-outline btn-sm" style="color:#ef4444;font-size:0.7rem;flex-shrink:0;" onclick="window._removePodAdmin('${pod.id}','${a.id}','${a.name}')">Remove</button>` : ''}
                                </div>
                            `).join('')
                        }
                        ${isSuperAdmin ? `
                        <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                            <select id="add-admin-${pod.id}" style="flex:1;min-width:0;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color);font-size:0.82rem;">
                                <option value="">-- Add Pod Admin --</option>
                                ${eligibleAdmins.filter(u => !pod.admins || !pod.admins.some(a => a.id === u.id)).map(u =>
                                    `<option value="${u.id}">${u.name} (${u.email})</option>`
                                ).join('')}
                            </select>
                            <button class="btn btn-outline btn-sm" style="flex-shrink:0;white-space:nowrap;" onclick="window._addPodAdmin('${pod.id}')">Add</button>
                        </div>
                        ` : ''}
                    </div>

                    <!-- Members section -->
                    <div style="margin-bottom:12px;">
                        <div style="font-size:0.8rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Members</div>
                        ${pod.members.length === 0 ? `<div style="font-size:0.85rem;color:var(--text-muted);padding:8px 0;">No members yet</div>` : ''}
                        ${pod.members.map(m => `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:6px;">
                                <div style="min-width:0;overflow:hidden;">
                                    <span style="font-weight:600;font-size:0.88rem;">${m.name || m.email}</span>
                                    <span style="font-size:0.75rem;color:var(--text-muted);margin-left:8px;">${m.role} · ${m.assigned_leads} leads</span>
                                </div>
                                <button class="btn btn-outline btn-sm" style="color:#ef4444;font-size:0.7rem;flex-shrink:0;" onclick="window._removePodMember('${pod.id}','${m.id}','${m.name}')">Remove</button>
                            </div>
                        `).join('')}
                    </div>
                    <div style="border-top:1px solid var(--border-color);padding-top:12px;">
                        <div style="display:flex;gap:8px;align-items:center;">
                            <select id="add-member-${pod.id}" style="flex:1;min-width:0;padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;">
                                <option value="">-- Add SDR / AE --</option>
                                ${availableSDRs.filter(s => !pod.members.some(m => m.id === s.id)).map(s =>
                                    `<option value="${s.id}">${s.name} (${s.email})</option>`
                                ).join('')}
                            </select>
                            <button class="btn btn-outline btn-sm" style="flex-shrink:0;white-space:nowrap;" onclick="window._addPodMember('${pod.id}')">Add</button>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Toggle create form
    document.getElementById('create-pod-btn')?.addEventListener('click', () => {
        const form = document.getElementById('create-pod-form');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    // Submit create pod
    document.getElementById('submit-create-pod')?.addEventListener('click', async () => {
        const name = document.getElementById('new-pod-name').value.trim();
        const adminId = document.getElementById('new-pod-admin').value;
        const timezone = document.getElementById('new-pod-timezone').value;
        if (!name) { alert('Pod name is required'); return; }
        try {
            await createPod(name, adminId || null, timezone || null);
            await renderPods(container);
        } catch (e) { alert('Failed to create POD: ' + e.message); }
    });

    window._savePodTimezone = async (podId) => {
        const timezone = document.getElementById(`pod-tz-${podId}`).value;
        try {
            const res = await updatePod(podId, { timezone: timezone || null });
            if (!res.ok) throw new Error((await res.json()).detail || 'Failed to save');
            await renderPods(container);
        } catch (e) { alert('Failed to save timezone: ' + e.message); }
    };

    // Global callbacks
    window._deletePod = async (podId, name) => {
        if (!confirm(`Delete POD "${name}"? Members will be unassigned.`)) return;
        await deletePod(podId);
        await renderPods(container);
    };

    window._addPodAdmin = async (podId) => {
        const userId = document.getElementById(`add-admin-${podId}`).value;
        if (!userId) return;
        try {
            await addPodAdmin(podId, userId);
            await renderPods(container);
        } catch (e) { alert('Failed to add Pod Admin: ' + e.message); }
    };

    window._removePodAdmin = async (podId, userId, name) => {
        if (!confirm(`Remove ${name} as Pod Admin of this POD?\n\nIf this is their only pod, their role will revert to SDR.`)) return;
        try {
            await removePodAdmin(podId, userId);
            await renderPods(container);
        } catch (e) { alert('Failed to remove Pod Admin: ' + e.message); }
    };

    window._addPodMember = async (podId) => {
        const userId = document.getElementById(`add-member-${podId}`).value;
        if (!userId) return;
        await addPodMember(podId, userId);
        await renderPods(container);
    };

    window._removePodMember = async (podId, userId, name) => {
        if (!confirm(`Remove ${name} from this POD?`)) return;
        await removePodMember(podId, userId);
        await renderPods(container);
    };
}
