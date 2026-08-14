// ── views/settings_sync.js — Sync settings + Pipeline config handlers ─────────
import { patchSyncSettings, fetchSyncSettings, fetchRecordTypes, fetchCallOutcomes } from '../api.js';

/**
 * Load sync settings data and bind all Sync + Pipeline tab event handlers.
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function bindSyncTab(container) {
    let currentSettings = { lead_limit: 1000, record_type_ids: [], sf_push_stage: 'Demo Done' };
    let recordTypes = [];
    let settingsLoadError = null;
    try {
        [currentSettings, recordTypes] = await Promise.all([
            fetchSyncSettings(),
            fetchRecordTypes()
        ]);
    } catch (e) {
        settingsLoadError = e;
        console.error('Failed to load sync settings:', e);
    }

    // BUG-4 FIX: Surface a visible error if settings couldn't load — previously
    // the catch just console.error'd and all fields showed blank/default values
    // silently, making it impossible to diagnose without dev tools.
    if (settingsLoadError) {
        const errorBanner = document.createElement('div');
        errorBanner.style.cssText = 'padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;color:#dc2626;font-size:0.82rem;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px;';
        errorBanner.innerHTML = `⚠️ Settings could not be loaded (${settingsLoadError.message || 'Network error'}). Showing defaults. <button onclick="this.closest('div').remove()" style="margin-left:auto;background:none;border:none;color:#dc2626;cursor:pointer;font-size:1rem;" title="Dismiss">✕</button>`;
        // Insert at the top of the panel
        const syncPanel = document.querySelector('[data-panel="sync"]');
        if (syncPanel) syncPanel.insertAdjacentElement('afterbegin', errorBanner);
    }

    // Multi-pod toggle
    const multiPodToggle = document.getElementById('allow-multi-pod-toggle');
    if (multiPodToggle) {
        multiPodToggle.checked = currentSettings.allow_multi_pod_sdr || false;
        multiPodToggle.addEventListener('change', async () => {
            const statusEl = document.getElementById('multi-pod-save-status');
            try {
                await patchSyncSettings({ allow_multi_pod_sdr: multiPodToggle.checked });
                statusEl.textContent = '✅ Saved';
                setTimeout(() => { statusEl.textContent = ''; }, 2000);
            } catch (e) {
                statusEl.textContent = '❌ Error';
                multiPodToggle.checked = !multiPodToggle.checked;
            }
        });
    }

    // Lead limit
    const limitInput = document.getElementById('lead-limit-input');
    if (limitInput) {
        limitInput.value = currentSettings.lead_limit ?? 1000;
        document.getElementById('save-limit-btn').addEventListener('click', async () => {
            const newLimit = parseInt(limitInput.value ?? '1000');
            const btn = document.getElementById('save-limit-btn');
            btn.textContent = 'Saving…'; btn.disabled = true;
            try {
                await patchSyncSettings({ lead_limit: newLimit });
                btn.textContent = '✅ Saved';
                setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
            } catch (e) { btn.textContent = '❌ Error'; btn.disabled = false; }
        });
    }

    // SF Push Stage
    const pushStageSelect = document.getElementById('sf-push-stage-select');
    if (pushStageSelect) {
        pushStageSelect.value = currentSettings.sf_push_stage || 'Demo Done';
        document.getElementById('save-push-stage-btn').addEventListener('click', async () => {
            const btn = document.getElementById('save-push-stage-btn');
            btn.textContent = 'Saving…'; btn.disabled = true;
            try {
                await patchSyncSettings({ sf_push_stage: pushStageSelect.value });
                btn.textContent = '✅ Saved';
                setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
            } catch (e) { btn.textContent = '❌ Error'; btn.disabled = false; }
        });
    }

    // Sync Direction toggle
    const syncDirToggle = document.getElementById('sync-direction-toggle');
    const syncDirLabel = document.getElementById('sync-direction-label');
    if (syncDirToggle) {
        const isBoth = (currentSettings.sync_direction || 'push_only') === 'both';
        syncDirToggle.checked = isBoth;
        if (syncDirLabel) syncDirLabel.textContent = isBoth ? 'Two-Way Sync (CRM ↔ SF)' : 'Push Only (CRM → SF)';
        syncDirToggle.addEventListener('change', async () => {
            const newDir = syncDirToggle.checked ? 'both' : 'push_only';
            if (syncDirLabel) syncDirLabel.textContent = syncDirToggle.checked ? 'Two-Way Sync (CRM ↔ SF)' : 'Push Only (CRM → SF)';
            const statusEl = document.getElementById('sync-direction-save-status');
            try {
                await patchSyncSettings({ sync_direction: newDir });
                statusEl.textContent = '✅ Saved';
                setTimeout(() => { statusEl.textContent = ''; }, 2000);
            } catch (e) {
                statusEl.textContent = '❌ Error';
                syncDirToggle.checked = !syncDirToggle.checked;
                if (syncDirLabel) syncDirLabel.textContent = syncDirToggle.checked ? 'Two-Way Sync (CRM ↔ SF)' : 'Push Only (CRM → SF)';
            }
        });
    }

    // Record types
    const rtContainer = document.getElementById('record-types-container');
    if (rtContainer) {
        if (!Array.isArray(recordTypes) || recordTypes.length === 0) {
            rtContainer.innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem;">
                ${recordTypes?.detail ? '⚠️ Check SF connection.' : '✅ No custom record types.'}
            </span>`;
        } else {
            const selectedIds = new Set(currentSettings.record_type_ids || []);
            rtContainer.innerHTML = recordTypes.map(rt => `
                <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:0.88rem;">
                    <input type="checkbox" class="rt-checkbox" data-id="${rt.id}"
                        ${selectedIds.has(rt.id) ? 'checked' : ''}
                        style="width:15px;height:15px;cursor:pointer;">
                    ${rt.name}
                </label>`).join('');

            rtContainer.addEventListener('change', async () => {
                const checked = [...rtContainer.querySelectorAll('.rt-checkbox:checked')].map(cb => cb.dataset.id);
                await patchSyncSettings({ record_type_ids: checked });
            });
        }
    }

    // ── Phase 3: Call & Pipeline settings ──────────────────────────────────────
    const capInput = document.getElementById('active-lead-cap-input');
    if (capInput) {
        capInput.value = currentSettings.active_lead_cap ?? 5;
        document.getElementById('save-lead-cap-btn').addEventListener('click', async () => {
            const btn = document.getElementById('save-lead-cap-btn');
            btn.textContent = 'Saving…'; btn.disabled = true;
            try {
                await patchSyncSettings({ active_lead_cap: parseInt(capInput.value) });
                btn.textContent = '✅ Saved';
                setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
            } catch (e) { btn.textContent = '❌ Error'; btn.disabled = false; }
        });
    }

    const maxAttemptsInput = document.getElementById('max-call-attempts-input');
    if (maxAttemptsInput) {
        maxAttemptsInput.value = currentSettings.max_call_attempts ?? 5;
        document.getElementById('save-max-attempts-btn').addEventListener('click', async () => {
            const btn = document.getElementById('save-max-attempts-btn');
            btn.textContent = 'Saving…'; btn.disabled = true;
            try {
                await patchSyncSettings({ max_call_attempts: parseInt(maxAttemptsInput.value) });
                btn.textContent = '✅ Saved';
                setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
            } catch (e) { btn.textContent = '❌ Error'; btn.disabled = false; }
        });
    }

    const minUnreachableInput = document.getElementById('min-unreachable-input');
    if (minUnreachableInput) {
        minUnreachableInput.value = currentSettings.min_call_attempts_for_unreachable ?? 3;
        document.getElementById('save-min-unreachable-btn').addEventListener('click', async () => {
            const btn = document.getElementById('save-min-unreachable-btn');
            btn.textContent = 'Saving…'; btn.disabled = true;
            try {
                await patchSyncSettings({ min_call_attempts_for_unreachable: parseInt(minUnreachableInput.value) });
                btn.textContent = '✅ Saved';
                setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
            } catch (e) { btn.textContent = '❌ Error'; btn.disabled = false; }
        });
    }

    const cooldownInput = document.getElementById('cooldown-days-input');
    if (cooldownInput) {
        cooldownInput.value = currentSettings.terminal_lead_cooldown_days ?? 30;
        document.getElementById('save-cooldown-btn').addEventListener('click', async () => {
            const btn = document.getElementById('save-cooldown-btn');
            btn.textContent = 'Saving…'; btn.disabled = true;
            try {
                await patchSyncSettings({ terminal_lead_cooldown_days: parseInt(cooldownInput.value) });
                btn.textContent = '✅ Saved';
                setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
            } catch (e) { btn.textContent = '❌ Error'; btn.disabled = false; }
        });
    }

    const conversationMinSecondsInput = document.getElementById('conversation-min-seconds-input');
    if (conversationMinSecondsInput) {
        conversationMinSecondsInput.value = currentSettings.conversation_min_seconds ?? 30;
        document.getElementById('save-conversation-min-seconds-btn').addEventListener('click', async () => {
            const btn = document.getElementById('save-conversation-min-seconds-btn');
            btn.textContent = 'Saving…'; btn.disabled = true;
            try {
                await patchSyncSettings({ conversation_min_seconds: parseInt(conversationMinSecondsInput.value) });
                btn.textContent = '✅ Saved';
                setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
            } catch (e) { btn.textContent = '❌ Error'; btn.disabled = false; }
        });
    }

    // SF sync toggles for terminal statuses
    const syncDeclinedToggle = document.getElementById('sync-declined-toggle');
    if (syncDeclinedToggle) {
        syncDeclinedToggle.checked = currentSettings.sync_declined_to_salesforce || false;
        syncDeclinedToggle.addEventListener('change', async () => {
            const statusEl = document.getElementById('sync-declined-status');
            try {
                await patchSyncSettings({ sync_declined_to_salesforce: syncDeclinedToggle.checked });
                statusEl.textContent = '✅ Saved';
                setTimeout(() => { statusEl.textContent = ''; }, 2000);
            } catch (e) {
                statusEl.textContent = '❌ Error';
                syncDeclinedToggle.checked = !syncDeclinedToggle.checked;
            }
        });
    }

    const syncUnreachableToggle = document.getElementById('sync-unreachable-toggle');
    if (syncUnreachableToggle) {
        syncUnreachableToggle.checked = currentSettings.sync_unreachable_to_salesforce || false;
        syncUnreachableToggle.addEventListener('change', async () => {
            const statusEl = document.getElementById('sync-unreachable-status');
            try {
                await patchSyncSettings({ sync_unreachable_to_salesforce: syncUnreachableToggle.checked });
                statusEl.textContent = '✅ Saved';
                setTimeout(() => { statusEl.textContent = ''; }, 2000);
            } catch (e) {
                statusEl.textContent = '❌ Error';
                syncUnreachableToggle.checked = !syncUnreachableToggle.checked;
            }
        });
    }

    // Auto-Sync Schedule (V44) — daily UTC time, runs the same sync as the manual button
    const autoSyncToggle = document.getElementById('sf-auto-sync-toggle');
    const autoSyncTime = document.getElementById('sf-auto-sync-time');
    const autoSyncLastRun = document.getElementById('sf-auto-sync-last-run');
    if (autoSyncToggle && autoSyncTime) {
        autoSyncToggle.checked = currentSettings.sf_auto_sync_enabled || false;
        const hour = currentSettings.sf_auto_sync_hour_utc;
        autoSyncTime.value = hour != null
            ? `${String(hour).padStart(2, '0')}:${String(currentSettings.sf_auto_sync_minute_utc || 0).padStart(2, '0')}`
            : '02:00';
        if (autoSyncLastRun) {
            autoSyncLastRun.textContent = currentSettings.sf_auto_sync_last_run_at
                ? `Last auto-sync: ${new Date(currentSettings.sf_auto_sync_last_run_at).toLocaleString()}`
                : '';
        }

        autoSyncToggle.addEventListener('change', async () => {
            const statusEl = document.getElementById('sf-auto-sync-status');
            try {
                const [hh, mm] = autoSyncTime.value.split(':').map(Number);
                await patchSyncSettings({
                    sf_auto_sync_enabled: autoSyncToggle.checked,
                    sf_auto_sync_hour_utc: hh,
                    sf_auto_sync_minute_utc: mm,
                });
                statusEl.textContent = '✅ Saved';
                setTimeout(() => { statusEl.textContent = ''; }, 2000);
            } catch (e) {
                statusEl.textContent = '❌ Error';
                autoSyncToggle.checked = !autoSyncToggle.checked;
            }
        });

        autoSyncTime.addEventListener('change', async () => {
            const statusEl = document.getElementById('sf-auto-sync-status');
            if (!autoSyncTime.value) return;
            const [hh, mm] = autoSyncTime.value.split(':').map(Number);
            try {
                await patchSyncSettings({ sf_auto_sync_hour_utc: hh, sf_auto_sync_minute_utc: mm });
                statusEl.textContent = '✅ Saved';
                setTimeout(() => { statusEl.textContent = ''; }, 2000);
            } catch (e) {
                statusEl.textContent = '❌ Error';
            }
        });
    }

    return currentSettings;
}

/**
 * Render the Call Outcomes configuration table inside the Sync Settings tab.
 * Phase 2: Interactive admin UI with toggles, action/group dropdowns, add form, and save.
 */
export async function renderCallOutcomesConfig() {
    const container = document.getElementById('call-outcomes-config-container');
    if (!container) return;

    try {
        const data = await fetchCallOutcomes();
        let outcomes = data.outcomes || [];
        if (outcomes.length === 0) {
            container.innerHTML = '<span style="color:#a1a1aa;font-size:0.82rem;">No outcomes configured.</span>';
            return;
        }

        // Deep clone to track mutations
        let workingConfig = JSON.parse(JSON.stringify(outcomes));

        const GROUP_BADGES = {
            'answered':     { label: 'Answered',     bg: '#ecfdf5', color: '#059669' },
            'not_answered': { label: 'Not Answered', bg: '#f9fafb', color: '#6b7280' },
            'terminal':     { label: 'Terminal',     bg: '#fef2f2', color: '#dc2626' },
        };
        const ACTION_LABELS = {
            'none':              '— None',
            'disqualify':        'Auto-Disqualify',
            'meeting_scheduled': '→ Meeting Scheduled',
            'meeting_complete':  '→ Meeting Complete',
            'pending_review':    '→ Pending Review',
        };

        function renderTable() {
            let html = `<div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                    <thead>
                        <tr style="border-bottom:2px solid #e4e4e7;">
                            <th style="text-align:center;padding:8px 10px;font-weight:600;color:#71717a;width:70px;">Enabled</th>
                            <th style="text-align:left;padding:8px 10px;font-weight:600;color:#71717a;">Outcome</th>
                            <th style="text-align:left;padding:8px 10px;font-weight:600;color:#71717a;width:130px;">Group</th>
                            <th style="text-align:left;padding:8px 10px;font-weight:600;color:#71717a;width:160px;">Action</th>
                            <th style="text-align:center;padding:8px 10px;font-weight:600;color:#71717a;width:90px;">Notes Req.</th>
                            <th style="text-align:center;padding:8px 10px;font-weight:600;color:#71717a;width:50px;">Type</th>
                        </tr>
                    </thead>
                    <tbody>`;

            for (let idx = 0; idx < workingConfig.length; idx++) {
                const o = workingConfig[idx];
                const grp = GROUP_BADGES[o.group] || { label: o.group, bg: '#f9fafb', color: '#6b7280' };
                const isBuiltin = o.builtin !== false;

                // Enabled toggle
                const toggleChecked = o.enabled ? 'checked' : '';
                const toggleStyle = `position:relative;display:inline-block;width:36px;height:20px;`;
                const sliderStyle = `position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;
                    background:${o.enabled ? '#22c55e' : '#d4d4d8'};border-radius:10px;transition:0.3s;`;
                const knobStyle = `position:absolute;height:16px;width:16px;left:${o.enabled ? '18px' : '2px'};
                    bottom:2px;background:#fff;border-radius:50%;transition:0.3s;`;

                // Group dropdown (only for custom outcomes)
                let groupCell;
                if (isBuiltin) {
                    groupCell = `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:0.75rem;font-weight:500;background:${grp.bg};color:${grp.color};">${grp.label}</span>`;
                } else {
                    groupCell = `<select data-idx="${idx}" data-field="group" style="font-size:0.78rem;padding:4px 8px;border:1px solid #e4e4e7;border-radius:8px;background:#fff;cursor:pointer;">
                        <option value="answered" ${o.group === 'answered' ? 'selected' : ''}>Answered</option>
                        <option value="not_answered" ${o.group === 'not_answered' ? 'selected' : ''}>Not Answered</option>
                        <option value="terminal" ${o.group === 'terminal' ? 'selected' : ''}>Terminal</option>
                        <option value="demo" ${o.group === 'demo' ? 'selected' : ''}>Demo</option>
                    </select>`;
                }

                // Action dropdown
                let actionCell;
                if (isBuiltin) {
                    const actLabel = ACTION_LABELS[o.action] || '— None';
                    const actColor = o.action === 'disqualify' ? '#dc2626' : o.action === 'meeting_scheduled' ? '#059669' : '#9ca3af';
                    actionCell = `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:0.75rem;font-weight:500;background:${o.action === 'disqualify' ? '#fef2f2' : o.action === 'meeting_scheduled' ? '#ecfdf5' : '#f9fafb'};color:${actColor};">${actLabel}</span>`;
                } else {
                    actionCell = `<select data-idx="${idx}" data-field="action" style="font-size:0.78rem;padding:4px 8px;border:1px solid #e4e4e7;border-radius:8px;background:#fff;cursor:pointer;">
                        <option value="none" ${o.action === 'none' ? 'selected' : ''}>— None</option>
                        <option value="disqualify" ${o.action === 'disqualify' ? 'selected' : ''}>Auto-Disqualify</option>
                        <option value="meeting_scheduled" ${o.action === 'meeting_scheduled' ? 'selected' : ''}>→ Meeting Scheduled</option>
                        <option value="meeting_complete" ${o.action === 'meeting_complete' ? 'selected' : ''}>→ Meeting Complete</option>
                        <option value="pending_review" ${o.action === 'pending_review' ? 'selected' : ''}>→ Pending Review</option>
                    </select>`;
                }

                html += `<tr style="border-bottom:1px solid #f4f4f5;${!o.enabled ? 'opacity:0.5;' : ''}" data-row="${idx}">
                    <td style="padding:8px 10px;text-align:center;">
                        <label style="${toggleStyle}">
                            <input type="checkbox" data-idx="${idx}" data-field="enabled" ${toggleChecked}
                                   style="opacity:0;width:0;height:0;">
                            <span style="${sliderStyle}"><span style="${knobStyle}"></span></span>
                        </label>
                    </td>
                    <td style="padding:8px 10px;font-weight:500;color:#18181b;">
                        ${o.value}
                        ${!isBuiltin ? '<span style="font-size:0.68rem;color:#a78bfa;margin-left:6px;">✦ custom</span>' : ''}
                    </td>
                    <td style="padding:8px 10px;">${groupCell}</td>
                    <td style="padding:8px 10px;">${actionCell}</td>
                    <td style="padding:8px 10px;text-align:center;">
                        <input type="checkbox" data-idx="${idx}" data-field="notes_required" ${o.notes_required ? 'checked' : ''}
                               style="width:16px;height:16px;accent-color:#7c3aed;cursor:pointer;">
                    </td>
                    <td style="padding:8px 10px;text-align:center;">
                        <span style="font-size:0.68rem;color:${isBuiltin ? '#a1a1aa' : '#7c3aed'};">${isBuiltin ? 'built-in' : 'custom'}</span>
                    </td>
                </tr>`;
            }

            html += '</tbody></table></div>';

            // Add Outcome form
            const customCount = workingConfig.filter(o => o.builtin === false).length;
            if (customCount < 10) {
                html += `<div id="add-outcome-form" style="margin-top:16px;padding:16px;background:#faf5ff;border-radius:12px;border:1px dashed #c4b5fd;">
                    <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">
                        <div style="flex:1;min-width:180px;">
                            <label style="font-size:0.72rem;color:#71717a;font-weight:600;display:block;margin-bottom:4px;">Outcome Name</label>
                            <input type="text" id="new-outcome-value" placeholder="e.g. Budget Freeze"
                                   style="width:100%;padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.82rem;box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:0.72rem;color:#71717a;font-weight:600;display:block;margin-bottom:4px;">Group</label>
                            <select id="new-outcome-group" style="padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.82rem;">
                                <option value="terminal">Terminal</option>
                                <option value="answered">Answered</option>
                                <option value="not_answered">Not Answered</option>
                                <option value="demo">Demo</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.72rem;color:#71717a;font-weight:600;display:block;margin-bottom:4px;">Action</label>
                            <select id="new-outcome-action" style="padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.82rem;">
                                <option value="none">— None</option>
                                <option value="disqualify">Auto-Disqualify</option>
                                <option value="meeting_scheduled">→ Meeting Scheduled</option>
                                <option value="meeting_complete">→ Meeting Complete</option>
                                <option value="pending_review">→ Pending Review</option>
                            </select>
                        </div>
                        <button id="btn-add-outcome" style="padding:8px 16px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:0.82rem;font-weight:600;cursor:pointer;white-space:nowrap;">
                            + Add Outcome
                        </button>
                    </div>
                    <p style="font-size:0.68rem;color:#a78bfa;margin:8px 0 0;">${customCount}/10 custom outcomes used</p>
                </div>`;
            }

            // Save button
            html += `<div style="margin-top:16px;display:flex;align-items:center;gap:12px;">
                <button id="btn-save-outcomes" style="padding:10px 24px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
                    💾 Save Outcomes Configuration
                </button>
                <span id="outcome-save-status" style="font-size:0.78rem;color:#a1a1aa;"></span>
            </div>`;

            container.innerHTML = html;
            attachEventListeners();
        }

        function attachEventListeners() {
            // Toggle enabled
            container.querySelectorAll('input[data-field="enabled"]').forEach(el => {
                el.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.dataset.idx);
                    workingConfig[idx].enabled = e.target.checked;
                    renderTable();
                });
            });

            // Notes required
            container.querySelectorAll('input[data-field="notes_required"]').forEach(el => {
                el.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.dataset.idx);
                    workingConfig[idx].notes_required = e.target.checked;
                });
            });

            // Group dropdown
            container.querySelectorAll('select[data-field="group"]').forEach(el => {
                el.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.dataset.idx);
                    workingConfig[idx].group = e.target.value;
                    // If group changed away from terminal, reset disqualify action
                    if (e.target.value !== 'terminal' && workingConfig[idx].action === 'disqualify') {
                        workingConfig[idx].action = 'none';
                        renderTable();
                    }
                });
            });

            // Action dropdown
            container.querySelectorAll('select[data-field="action"]').forEach(el => {
                el.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.dataset.idx);
                    const newAction = e.target.value;
                    // Validate disqualify only on terminal
                    if (newAction === 'disqualify' && workingConfig[idx].group !== 'terminal') {
                        alert('Auto-Disqualify action is only allowed for Terminal group outcomes.');
                        e.target.value = workingConfig[idx].action;
                        return;
                    }
                    workingConfig[idx].action = newAction;
                });
            });

            // Add outcome
            const addBtn = container.querySelector('#btn-add-outcome');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    const value = document.getElementById('new-outcome-value').value.trim();
                    const group = document.getElementById('new-outcome-group').value;
                    const action = document.getElementById('new-outcome-action').value;

                    if (!value || value.length < 2 || value.length > 50) {
                        alert('Outcome name must be 2-50 characters.');
                        return;
                    }
                    if (workingConfig.some(o => o.value.toLowerCase() === value.toLowerCase())) {
                        alert('An outcome with this name already exists.');
                        return;
                    }
                    if (action === 'disqualify' && group !== 'terminal') {
                        alert('Auto-Disqualify is only allowed for Terminal group.');
                        return;
                    }

                    workingConfig.push({
                        value, group, action,
                        notes_required: false,
                        builtin: false,
                        enabled: true,
                    });
                    renderTable();
                });
            }

            // Save
            const saveBtn = container.querySelector('#btn-save-outcomes');
            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    const statusEl = document.getElementById('outcome-save-status');
                    saveBtn.disabled = true;
                    saveBtn.textContent = '⏳ Saving...';
                    statusEl.textContent = '';

                    try {
                        // Use the shared patchSyncSettings (API_BASE + authHeaders) — not a raw fetch
                        await patchSyncSettings({ outcome_config: workingConfig });
                        statusEl.textContent = '✅ Saved successfully!';
                        statusEl.style.color = '#22c55e';
                        // Re-fetch to sync
                        const freshData = await fetchCallOutcomes();
                        workingConfig = JSON.parse(JSON.stringify(freshData.outcomes || []));
                        setTimeout(() => { statusEl.textContent = ''; }, 3000);
                    } catch (e) {
                        statusEl.textContent = `❌ ${e.message}`;
                        statusEl.style.color = '#ef4444';
                    } finally {
                        saveBtn.disabled = false;
                        saveBtn.textContent = '💾 Save Outcomes Configuration';
                    }
                });
            }
        }

        renderTable();
    } catch (e) {
        console.error('Failed to load call outcomes config:', e);
        container.innerHTML = '<span style="color:#ef4444;font-size:0.82rem;">❌ Failed to load outcomes.</span>';
    }
}
