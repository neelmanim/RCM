// ── views/settings.js — Settings page orchestrator ────────────────────────────
//
// Split from a 1,077-line monolith into focused modules:
//   settings_connection.js  — Connection + Nylas tab (HTML + handlers)
//   settings_sync.js        — Sync settings + Pipeline config handlers
//   settings_ai_dialer.js   — AI Settings + Dialer config handlers
// ──────────────────────────────────────────────────────────────────────────────
import { isAdmin, isSuperAdmin, currentUser, API_BASE } from '../auth.js';
import { showToast, ensureUTC } from '../utils.js';
import { fetchDashboardStats, fetchSfConnectionStatus } from '../api.js';
import { connectionTabHTML, bindConnectionTab } from './settings_connection.js';
import { bindSyncTab, renderCallOutcomesConfig } from './settings_sync.js';
import { bindAiDialerTab } from './settings_ai_dialer.js';

const PIPELINE_STAGES = ['Lead Assigned', 'Research', 'Calling', 'Meeting Scheduled', '1st Discovery Meeting', 'Discovery Complete', 'Demo Scheduled', 'Demo Done', 'Completed', 'Disqualified'];

/**
 * Custom confirmation modal — replaces native window.confirm() which can
 * be auto-dismissed by Chrome when event bubbling interferes in SPAs.
 * Same pattern as _showConfirmModal in upload.js.
 * @param {object} opts — { title, body, confirmText, cancelText, danger }
 * @returns {Promise<boolean>} — true if confirmed, false if cancelled
 */
function _showConfirmModal({ title, body, confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
    return new Promise(resolve => {
        document.getElementById('settings-confirm-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'settings-confirm-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease;';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:var(--card-bg,#fff);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:440px;width:90%;padding:28px;animation:slideUp 0.2s ease;';

        modal.innerHTML = `
            <div style="font-size:1.1rem;font-weight:700;margin-bottom:16px;">${title}</div>
            <div style="font-size:0.88rem;line-height:1.5;color:var(--text-secondary,#555);">${body}</div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px;">
                ${cancelText ? `<button id="stg-confirm-cancel" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border-color,#ddd);background:var(--card-bg,#fff);color:var(--text-primary,#333);font-size:0.85rem;font-weight:600;cursor:pointer;">${cancelText}</button>` : ''}
                <button id="stg-confirm-ok" style="padding:8px 20px;border-radius:8px;border:none;background:${danger ? '#DC2626' : 'var(--primary,#4F46E5)'};color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">${confirmText}</button>
            </div>`;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        if (!document.getElementById('stg-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'stg-modal-styles';
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

        document.getElementById('stg-confirm-ok').addEventListener('click', () => cleanup(true));
        document.getElementById('stg-confirm-cancel')?.addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) cleanup(false); });
        document.addEventListener('keydown', function handler(ev) {
            if (ev.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', handler); }
        });

        document.getElementById('stg-confirm-ok').focus();
    });
}

export async function renderSettings(container, _internal = false) {
    // Preserve whichever tab was active before rebuilding the DOM — a save
    // button inside any tab calls this as a "refresh data" re-render, and
    // without this it always snapped back to the Connection tab (bug report:
    // "any change in any settings tab pushes you back to settings home").
    const _activeTab = container.querySelector('#settings-tabs .settings-tab.active')?.dataset.tab || 'connection';

    // ── Check for email_connected success param (post-OAuth redirect) ────
    // Skip this block when called internally as a re-render callback to avoid
    // triggering window.history.replaceState which fires a hashchange and
    // causes the SPA router to navigate away from the settings page.
    if (!_internal) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('email_connected') === 'true') {
            const cleanUrl = window.location.pathname + '#settings';
            window.history.replaceState({}, '', cleanUrl);
            setTimeout(() => {
                showToast('✅ Email connected successfully! You can now send and receive emails from RCM.', 'success', 5000);
            }, 500);
        }
    }

    const stats = await fetchDashboardStats().catch(() => ({ total: 0, status_counts: {} }));
    const sc = stats.status_counts || {};

    // Fetch SF connection info for admins
    let sfInfo = { connected: false, source: null };
    if (isAdmin) {
        sfInfo = await fetchSfConnectionStatus().catch(() => sfInfo);
    }

    const sfInstanceDisplay = sfInfo.instance_url
        ? sfInfo.instance_url.replace('https://', '').replace(/\/$/, '')
        : 'N/A';

    container.innerHTML = `
        <div class="fade-in">
            <!-- ── Settings Header ──────────────────────────────────────── -->
            <div style="background:#fff;border-bottom:1px solid #e4e4e7;padding:20px 32px 0;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                    <div>
                        <h1 style="font-size:1.35rem;font-weight:700;color:#18181b;margin:0;">⚙️ Settings</h1>
                        <p style="font-size:0.82rem;color:#71717a;margin:4px 0 0;">Manage your integrations, team, and application configuration.</p>
                    </div>
                </div>
                <!-- ── Tab Navigation ─────────────────────────────────────── -->
                <div style="display:flex;gap:0;" id="settings-tabs">
                    ${isAdmin ? `<button class="settings-tab active" data-tab="connection" style="padding:10px 20px 12px;font-size:0.82rem;font-weight:600;color:#2563eb;border:none;background:none;cursor:pointer;border-bottom:3px solid #2563eb;position:relative;">☁️ Connection</button>` : ''}
                    ${isSuperAdmin ? `<button class="settings-tab" data-tab="sync" style="padding:10px 20px 12px;font-size:0.82rem;font-weight:500;color:#71717a;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;">🔄 Sync Settings</button>` : ''}
                    ${isSuperAdmin ? `<button class="settings-tab" data-tab="ai" style="padding:10px 20px 12px;font-size:0.82rem;font-weight:500;color:#71717a;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;">🤖 AI Settings</button>` : ''}
                    ${isSuperAdmin ? `<button class="settings-tab" data-tab="dialer" style="padding:10px 20px 12px;font-size:0.82rem;font-weight:500;color:#71717a;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;">📞 Dialer</button>` : ''}
                    ${isSuperAdmin ? `<button class="settings-tab" data-tab="rcm" style="padding:10px 20px 12px;font-size:0.82rem;font-weight:500;color:#71717a;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;">💜 RCM</button>` : ''}
                    ${isSuperAdmin ? `<button class="settings-tab" data-tab="publicapi" style="padding:10px 20px 12px;font-size:0.82rem;font-weight:500;color:#71717a;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;">🔌 Public API</button>` : ''}
                    ${isSuperAdmin ? `<button class="settings-tab" data-tab="sandbox" style="padding:10px 20px 12px;font-size:0.82rem;font-weight:500;color:#71717a;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;">🧪 Sandbox</button>` : ''}
                </div>
            </div>

            <!-- ── Tab Content Container ──────────────────────────────────── -->
            <div style="padding:28px 32px;">

                <!-- Connection Tab (from settings_connection.js) -->
                <div class="settings-tab-panel" data-panel="connection">
                    ${connectionTabHTML({ isAdmin, isSuperAdmin, sfInfo, sfInstanceDisplay, stats, sc })}
                </div>

                <!-- ═══════════════════════════════════════════════════════════
                     TAB 2: SYNC SETTINGS
                     ═══════════════════════════════════════════════════════════ -->
                ${isSuperAdmin ? `<div class="settings-tab-panel" data-panel="sync" style="display:none;">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">

                        <!-- Salesforce Sync Config Card -->
                        <div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);grid-column:1/-1;">
                            <h3 style="font-size:1rem;font-weight:700;color:#18181b;margin:0 0 6px;">🔄 Salesforce Sync Settings</h3>
                            <p style="font-size:0.78rem;color:#71717a;margin:0 0 20px;">Configure how your CRM syncs with Salesforce.</p>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                                <div>
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Lead Sync Limit</label>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <input type="number" id="lead-limit-input" min="0" step="100" style="width:120px;padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.9rem;" placeholder="e.g. 1000">
                                        <button class="btn btn-outline btn-sm" id="save-limit-btn" style="padding:8px 14px;">Save</button>
                                    </div>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Set to <strong>0</strong> to remove limit. Default: 1000.</p>
                                </div>
                                <div>
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Salesforce Push Stage</label>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <select id="sf-push-stage-select" style="padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.9rem;">
                                            ${PIPELINE_STAGES.map(s => `<option value="${s}">${s}</option>`).join('')}
                                        </select>
                                        <button class="btn btn-outline btn-sm" id="save-push-stage-btn" style="padding:8px 14px;">Save</button>
                                    </div>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Leads reaching this stage push to Salesforce.</p>
                                </div>
                                <div>
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Record Types to Sync</label>
                                    <div id="record-types-container" style="min-height:50px;padding:12px;border:1px solid #e4e4e7;border-radius:8px;max-height:200px;overflow-y:auto;">
                                        <span style="color:#a1a1aa;font-size:0.82rem;">⏳ Loading...</span>
                                    </div>
                                </div>
                                <div>
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Sync Direction</label>
                                    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#f8fafc;border-radius:10px;border:1px solid #e4e4e7;">
                                        <label class="toggle-switch"><input type="checkbox" id="sync-direction-toggle"><span class="toggle-slider"></span></label>
                                        <div>
                                            <div id="sync-direction-label" style="font-weight:600;font-size:0.85rem;">Push Only (CRM → SF)</div>
                                            <div style="font-size:0.7rem;color:#a1a1aa;">Toggle for 2-way sync</div>
                                        </div>
                                        <span id="sync-direction-save-status" style="font-size:0.75rem;color:var(--status-won);margin-left:auto;"></span>
                                    </div>
                                </div>
                            </div>
                            <!-- Terminal Status Sync -->
                            <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e4e4e7;">
                                <h4 style="font-size:0.85rem;font-weight:600;margin-bottom:12px;">Terminal Status Sync Options</h4>
                                <div style="display:flex;gap:24px;flex-wrap:wrap;">
                                    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#f8fafc;border-radius:10px;border:1px solid #e4e4e7;">
                                        <label class="toggle-switch"><input type="checkbox" id="sync-declined-toggle"><span class="toggle-slider"></span></label>
                                        <div>
                                            <div style="font-weight:600;font-size:0.85rem;">Sync Customer Declined</div>
                                            <div style="font-size:0.7rem;color:#a1a1aa;">Push declined leads to Salesforce</div>
                                        </div>
                                        <span id="sync-declined-status" style="font-size:0.75rem;color:var(--status-won);margin-left:auto;"></span>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#f8fafc;border-radius:10px;border:1px solid #e4e4e7;">
                                        <label class="toggle-switch"><input type="checkbox" id="sync-unreachable-toggle"><span class="toggle-slider"></span></label>
                                        <div>
                                            <div style="font-weight:600;font-size:0.85rem;">Sync Unreachable</div>
                                            <div style="font-size:0.7rem;color:#a1a1aa;">Push unreachable leads to Salesforce</div>
                                        </div>
                                        <span id="sync-unreachable-status" style="font-size:0.75rem;color:var(--status-won);margin-left:auto;"></span>
                                    </div>
                                </div>
                            </div>
                            <!-- Auto-Sync Schedule -->
                            <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e4e4e7;">
                                <h4 style="font-size:0.85rem;font-weight:600;margin-bottom:12px;">Auto-Sync Schedule</h4>
                                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:10px 14px;background:#f8fafc;border-radius:10px;border:1px solid #e4e4e7;">
                                    <label class="toggle-switch"><input type="checkbox" id="sf-auto-sync-toggle"><span class="toggle-slider"></span></label>
                                    <div>
                                        <div style="font-weight:600;font-size:0.85rem;">Run automatically every day</div>
                                        <div style="font-size:0.7rem;color:#a1a1aa;">Runs the same sync as the manual button above, once per day at the time below (UTC).</div>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
                                        <input type="time" id="sf-auto-sync-time" style="padding:7px 10px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.85rem;">
                                        <span style="font-size:0.72rem;color:#a1a1aa;">UTC</span>
                                    </div>
                                    <span id="sf-auto-sync-status" style="font-size:0.75rem;color:var(--status-won);"></span>
                                </div>
                                <p id="sf-auto-sync-last-run" style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;"></p>
                            </div>
                        </div>

                        <!-- POD Settings Card -->
                        <div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);grid-column:1/-1;">
                            <h3 style="font-size:1rem;font-weight:700;color:#18181b;margin:0 0 6px;">🏷️ POD Settings</h3>
                            <p style="font-size:0.78rem;color:#71717a;margin:0 0 16px;">Configure POD team behavior.</p>
                            <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:#f8fafc;border-radius:10px;">
                                <label class="toggle-switch"><input type="checkbox" id="allow-multi-pod-toggle"><span class="toggle-slider"></span></label>
                                <div>
                                    <div style="font-weight:600;font-size:0.88rem;">Allow SDR in Multiple PODs</div>
                                    <div style="font-size:0.75rem;color:#a1a1aa;">When enabled, an SDR can be in more than one POD.</div>
                                </div>
                                <span id="multi-pod-save-status" style="font-size:0.75rem;color:var(--status-won);margin-left:auto;"></span>
                            </div>
                        </div>

                        <!-- Call & Pipeline Settings Card -->
                        <div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);grid-column:1/-1;">
                            <h3 style="font-size:1rem;font-weight:700;color:#18181b;margin:0 0 6px;">📞 Call & Pipeline Settings</h3>
                            <p style="font-size:0.78rem;color:#71717a;margin:0 0 16px;">Configure attempt limits and lead lifecycle behavior.</p>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                                <div>
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Active Lead Cap (per SDR)</label>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <input type="number" id="active-lead-cap-input" min="0" step="1" style="width:100px;padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.9rem;">
                                        <button class="btn btn-outline btn-sm" id="save-lead-cap-btn" style="padding:8px 14px;">Save</button>
                                    </div>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Max active leads per SDR. <strong>0</strong> pauses assignments.</p>
                                </div>
                                <div>
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Max Call Attempts</label>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <input type="number" id="max-call-attempts-input" min="1" step="1" style="width:100px;padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.9rem;">
                                        <button class="btn btn-outline btn-sm" id="save-max-attempts-btn" style="padding:8px 14px;">Save</button>
                                    </div>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Warning after this many No Answer/Voicemail attempts.</p>
                                </div>
                                <div>
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Min Attempts for Unreachable</label>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <input type="number" id="min-unreachable-input" min="1" step="1" style="width:100px;padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.9rem;">
                                        <button class="btn btn-outline btn-sm" id="save-min-unreachable-btn" style="padding:8px 14px;">Save</button>
                                    </div>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Min attempts before Unreachable option unlocks.</p>
                                </div>
                                <div>
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Terminal Lead Cooldown (days)</label>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <input type="number" id="cooldown-days-input" min="0" step="1" style="width:100px;padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.9rem;">
                                        <button class="btn btn-outline btn-sm" id="save-cooldown-btn" style="padding:8px 14px;">Save</button>
                                    </div>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;"><strong>0</strong> disables recycling.</p>
                                </div>
                                <div>
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Conversation Threshold (seconds)</label>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <input type="number" id="conversation-min-seconds-input" min="1" step="1" style="width:100px;padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:0.9rem;">
                                        <button class="btn btn-outline btn-sm" id="save-conversation-min-seconds-btn" style="padding:8px 14px;">Save</button>
                                    </div>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Calls longer than this count as a real "Conversation" in Analytics (default 30s).</p>
                                </div>
                            </div>
                        </div>

                        <!-- Call Outcomes Configuration Card -->
                        <div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);grid-column:1/-1;">
                            <h3 style="font-size:1rem;font-weight:700;color:#18181b;margin:0 0 6px;">📋 Call Outcomes Configuration</h3>
                            <p style="font-size:0.78rem;color:#71717a;margin:0 0 16px;">View and manage call outcomes available to SDRs. Toggle outcomes on/off, configure auto-actions, and set mandatory notes.</p>
                            <div id="call-outcomes-config-container" style="min-height:80px;">
                                <span style="color:#a1a1aa;font-size:0.82rem;">⏳ Loading outcomes...</span>
                            </div>
                        </div>
                    </div>
                </div>` : ''}

                <!-- ═══════════════════════════════════════════════════════════
                     TAB 3: AI SETTINGS
                     ═══════════════════════════════════════════════════════════ -->
                ${isSuperAdmin ? `<div class="settings-tab-panel" data-panel="ai" style="display:none;">
                    <div style="max-width:720px;display:flex;flex-direction:column;gap:20px;">

                        <!-- Card 1: LLM Provider Config -->
                        <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                            <!-- Gradient Header -->
                            <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">🤖</span>
                                </div>
                                <div>
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">AI Research Configuration</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);">Auto-runs on every lead in Research or Calling status</div>
                                </div>
                            </div>
                            <!-- Body -->
                            <div style="padding:24px;">
                                <div style="margin-bottom:20px;">
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Provider</label>
                                    <select id="llm-provider-select" style="width:100%;padding:10px 14px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.88rem;background:#fff;">
                                        <option value="groq">Groq (Free — Llama 3.3 70B)</option>
                                        <option value="gemini">Google Gemini</option>
                                        <option value="openai">OpenAI</option>
                                    </select>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Groq offers a generous free tier. Get your key at <a href="https://console.groq.com" target="_blank" style="color:#7c3aed;">console.groq.com</a></p>
                                </div>
                                <div style="margin-bottom:20px;">
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">API Key</label>
                                    <div style="position:relative;">
                                        <input type="password" id="llm-api-key-input" placeholder="gsk_xxxxxxxxxxxxxxxx" style="width:100%;padding:10px 44px 10px 14px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.88rem;font-family:monospace;box-sizing:border-box;">
                                        <button id="llm-key-toggle" type="button" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1.1rem;padding:4px;" title="Show/Hide">👁️</button>
                                    </div>
                                    <p id="llm-key-status" style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Not configured</p>
                                </div>
                                <div style="margin-bottom:20px;">
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Model</label>
                                    <input type="text" id="llm-model-input" placeholder="llama-3.3-70b-versatile" style="width:100%;padding:10px 14px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.88rem;box-sizing:border-box;">
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Default: llama-3.3-70b-versatile (recommended for Groq)</p>
                                </div>
                                <div style="display:flex;align-items:center;gap:12px;">
                                    <button class="btn btn-primary" id="save-llm-btn" style="border-radius:10px;padding:10px 24px;">💾 Save AI Settings</button>
                                    <span id="llm-save-status" style="font-size:0.78rem;color:var(--text-muted);"></span>
                                </div>
                            </div>
                        </div>

                        <!-- Card 2: Research Prompt Editor -->
                        <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                            <!-- Header -->
                            <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">✏️</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">Research Prompt Editor</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);">Customise the system prompt sent to the AI for every research run</div>
                                </div>
                                <span id="prompt-status-badge" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;background:rgba(255,255,255,0.15);color:#fff;">Default</span>
                            </div>
                            <!-- Body -->
                            <div style="padding:24px;">
                                <!-- Variable reference strip -->
                                <div style="padding:12px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;margin-bottom:16px;">
                                    <div style="font-size:0.8rem;font-weight:700;color:#1e40af;margin-bottom:6px;">📌 Available placeholders</div>
                                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                                        <code style="background:#dbeafe;color:#1d4ed8;padding:3px 10px;border-radius:6px;font-size:0.78rem;cursor:pointer;" title="Click to insert" class="prompt-var-chip">{lead_context}</code>
                                        <span style="font-size:0.75rem;color:#64748b;align-self:center;">← Injects contact + company data. Required for the AI to know who it's researching.</span>
                                    </div>
                                </div>

                                <!-- Textarea -->
                                <div style="position:relative;">
                                    <textarea id="research-prompt-textarea"
                                        placeholder="Leave empty to use the default prompt. Use {lead_context} to include lead data."
                                        style="width:100%;min-height:240px;padding:14px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.82rem;font-family:'SFMono-Regular',Consolas,monospace;line-height:1.6;resize:vertical;box-sizing:border-box;color:#1e293b;background:#fafafa;transition:border-color 0.15s;"
                                        spellcheck="false"
                                    ></textarea>
                                    <div style="position:absolute;bottom:10px;right:14px;font-size:0.7rem;color:#a1a1aa;" id="prompt-char-count">0 chars</div>
                                </div>

                                <!-- Actions row -->
                                <div style="display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap;">
                                    <button id="save-prompt-btn" style="padding:10px 22px;border-radius:10px;border:none;background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,0.25);">💾 Save Prompt</button>
                                    <button id="reset-prompt-btn" style="padding:10px 18px;border-radius:10px;border:1px solid #e4e4e7;background:#fff;font-size:0.82rem;font-weight:600;color:#71717a;cursor:pointer;">↩ Reset to Default</button>
                                    <span id="prompt-save-status" style="font-size:0.78rem;color:var(--text-muted);margin-left:auto;"></span>
                                </div>

                                <!-- Default prompt preview (collapsed) -->
                                <details style="margin-top:18px;">
                                    <summary style="font-size:0.8rem;font-weight:600;color:#7c3aed;cursor:pointer;user-select:none;">📖 View default prompt template</summary>
                                    <pre id="default-prompt-preview" style="margin-top:10px;padding:14px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;font-size:0.75rem;color:#4c1d95;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;"></pre>
                                </details>

                                <!-- Info box -->
                                <div style="margin-top:20px;padding:14px 16px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;">
                                    <div style="font-size:0.82rem;font-weight:600;color:#5b21b6;margin-bottom:6px;">💡 How it works</div>
                                    <ul style="margin:0;padding-left:16px;font-size:0.78rem;color:#6d28d9;line-height:1.7;">
                                        <li>AI research runs <strong>automatically</strong> when an SDR opens a lead in Research or Calling status</li>
                                        <li>Gap-fill logic only populates <strong>empty</strong> fields — existing data is never overwritten</li>
                                        <li>Research is <strong>cached per company</strong> — all contacts from the same company share the result</li>
                                        <li>Custom prompt overrides the default — leave empty to restore the built-in template</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        </div>

                        <!-- Card 3: Research Gate Toggle -->
                        <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                            <!-- Header -->
                            <div style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">🔒</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">Research Gate</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);">Control whether SDRs must complete research before moving to Calling</div>
                                </div>
                            </div>
                            <!-- Body -->
                            <div style="padding:24px;">
                                <div style="display:flex;align-items:center;gap:14px;padding:16px 18px;background:#f8fafc;border-radius:12px;border:1px solid #e4e4e7;">
                                    <label class="toggle-switch"><input type="checkbox" id="require-research-toggle"><span class="toggle-slider"></span></label>
                                    <div style="flex:1;">
                                        <div id="research-gate-label" style="font-weight:600;font-size:0.88rem;color:#059669;">🔓 Research Optional — SDRs Can Call Freely (Gate OFF)</div>
                                        <div style="font-size:0.72rem;color:#a1a1aa;margin-top:3px;">When gate is ON, the Move to Calling button is blocked until all 4 research fields are filled.</div>
                                    </div>
                                    <span id="research-gate-save-status" style="font-size:0.75rem;color:var(--status-won);margin-left:auto;white-space:nowrap;"></span>
                                </div>
                                <div style="margin-top:16px;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">
                                    <div style="font-size:0.82rem;font-weight:600;color:#c2410c;margin-bottom:6px;">⚠️ Impact when Gate is ON</div>
                                    <ul style="margin:0;padding-left:16px;font-size:0.78rem;color:#b45309;line-height:1.7;">
                                        <li>SDRs must fill: Company description, Contact context, Pitch angle, Personalization note</li>
                                        <li>AI auto-research runs on every lead open — SDRs can approve or edit before moving forward</li>
                                        <li>US SDRs doing 200+ calls/day should keep the gate <strong>OFF</strong> (use research as a guide, not a blocker)</li>
                                        <li>Gate is always bypassed for Admins and Super Admins</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- Card 4: Bulk Research Pre-Population -->
                        <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-top:20px;">
                            <!-- Gradient Header -->
                            <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">🚀</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">Bulk Research Pre-Population</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);">Run AI research for all leads that don't have v2 data yet</div>
                                </div>
                            </div>
                            <!-- Body -->
                            <div style="padding:24px;">
                                <div style="font-size:0.85rem;color:#52525b;line-height:1.6;margin-bottom:16px;">
                                    Triggers a background job that runs Pre-Call Intelligence for every lead missing v2 research fields (<strong>heat score</strong> + <strong>opening line</strong>). Once done, SDRs open leads instantly — no waiting for the AI card to populate.
                                </div>
                                <div style="padding:12px 16px;background:#fef9c3;border:1px solid #fde047;border-radius:10px;font-size:0.8rem;color:#713f12;margin-bottom:20px;">
                                    ⚠️ <strong>Rate limit aware:</strong> Processes ~1 lead/sec with Groq's free tier. For 10K+ leads, expect 3–4 hours. It runs in the background — you can close this page safely.
                                </div>
                                <div style="margin-bottom:16px;">
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">🎯 Target Pod (Phased Upgrade)</label>
                                    <select id="bulk-research-pod-select" style="width:100%;padding:9px 14px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;background:#fff;">
                                        <option value="">All Pods (upgrade everything)</option>
                                        <option value="b22f17bd-d06e-4f04-9a9f-306958a2b335">🇺🇸 US Team (1,906 leads)</option>
                                        <option value="41340b44-7dec-42d7-b45e-de9670483a42">🇮🇳 India Team (3,046 leads)</option>
                                    </select>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Run US Team first, wait for completion, then run India Team.</p>
                                </div>
                                <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
                                    <button id="bulk-research-btn" class="btn btn-primary" style="background:linear-gradient(135deg,#7c3aed,#a855f7);border:none;border-radius:10px;padding:10px 24px;font-weight:600;">
                                        🚀 Start Bulk Research
                                    </button>
                                    <span id="bulk-research-status" style="font-size:0.82rem;color:var(--text-muted);"></span>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>` : ''}


                <!-- ═══════════════════════════════════════════════════════════
                     TAB 4: DIALER
                     ═══════════════════════════════════════════════════════════ -->
                ${isSuperAdmin ? `<div class="settings-tab-panel" data-panel="dialer" style="display:none;">
                    <div style="max-width:720px;">
                        <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                            <!-- Gradient Header -->
                            <div style="background:linear-gradient(135deg,#059669,#10b981);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">📞</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">Aircall Configuration</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);">Configure Aircall as the outbound calling provider</div>
                                </div>
                                <span id="dialer-status-badge" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;background:rgba(255,255,255,0.15);color:#fff;">Loading...</span>
                            </div>
                            <!-- Body -->
                            <div style="padding:24px;">
                                <div style="margin-bottom:20px;">
                                    <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:8px;">Calling Provider</label>
                                    <select id="dialer-provider-select" style="width:100%;padding:10px 14px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.88rem;background:#fff;">
                                        <option value="none">None (Manual call logging only)</option>
                                        <option value="aircall">Aircall</option>
                                    </select>
                                    <p style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;">Select Aircall to enable outbound calling via the Aircall dialer.</p>
                                </div>
                                <!-- Aircall credentials (shown when Aircall selected) -->
                                <div id="dialer-credentials-section" style="display:none;">
                                    <div id="aircall-fields">
                                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                                            <div>
                                                <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">API ID</label>
                                                <input type="text" id="dialer-api-id" placeholder="Enter Aircall API ID" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                            </div>
                                            <div>
                                                <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">API Token</label>
                                                <input type="password" id="dialer-api-token" placeholder="Enter Aircall API Token" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                                <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">🔒 Encrypted at rest (AES-256-GCM)</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div id="dialer-webhook-section" style="margin-bottom:16px;padding:14px 16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;display:none;">
                                        <div style="font-size:0.78rem;font-weight:600;color:#065f46;margin-bottom:4px;">🔗 Webhook URL</div>
                                        <code id="dialer-webhook-url" style="display:block;font-size:0.78rem;color:#059669;word-break:break-all;"></code>
                                        <p id="dialer-webhook-hint" style="font-size:0.68rem;color:#6b7280;margin-top:6px;">Paste this URL into your Aircall webhook settings.</p>
                                    </div>
                                    <!-- V48: Aircall Everywhere kill switch — org-wide, off by default until piloted -->
                                    <div style="margin-bottom:16px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
                                            <input type="checkbox" id="dialer-aircall-everywhere-toggle" style="margin-top:2px;">
                                            <span>
                                                <span style="font-size:0.82rem;font-weight:600;color:#1e293b;">Enable Aircall Everywhere (embedded browser dialer)</span>
                                                <p style="font-size:0.72rem;color:#64748b;margin-top:3px;">Lets SDRs dial directly from the browser inside Power Dialer, without needing the Aircall Desktop app open. Off by default — flip on only after piloting with a couple of SDRs. Can be turned off instantly, mid-incident, with no deploy — active calls already in progress are unaffected.</p>
                                            </span>
                                        </label>
                                    </div>
                                </div>
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <button id="dialer-save-btn" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(5,150,105,0.3);">💾 Save Configuration</button>
                                    <button id="dialer-test-btn" style="padding:10px 20px;border-radius:10px;border:1px solid #e4e4e7;background:#fff;font-size:0.82rem;font-weight:600;color:#475569;cursor:pointer;display:none;">🧪 Test Connection</button>
                                </div>
                                <div id="dialer-config-error" style="color:#ef4444;font-size:0.78rem;display:none;padding:10px 14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;margin-top:12px;"></div>
                                <div id="dialer-config-success" style="color:#059669;font-size:0.78rem;display:none;padding:10px 14px;background:#ecfdf5;border-radius:8px;border:1px solid #a7f3d0;margin-top:12px;"></div>
                                <!-- How it works -->
                                <div id="dialer-how-it-works" style="margin-top:20px;padding:14px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;">
                                    <div style="font-size:0.82rem;font-weight:600;color:#166534;margin-bottom:6px;">💡 How it works</div>
                                    <ul id="dialer-how-list" style="margin:0;padding-left:16px;font-size:0.78rem;color:#15803d;line-height:1.6;">
                                        <li>SDRs click <strong>📞 Call</strong> on any lead — the call is initiated via Aircall</li>
                                        <li>Users are <strong>auto-matched by email</strong> — CRM email must match Aircall account</li>
                                        <li>Webhooks receive <strong>CALL_STARTED</strong>, <strong>CALL_ANSWERED</strong>, <strong>CALL_ENDED</strong> events</li>
                                        <li>Paste the webhook URL above into your Aircall settings to enable call tracking</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- Klenty Sync — temporary bridge, pulls call activity Klenty
                             SDRs make outside RCM into dialer_calls. Admin-only
                             infra toggle, no SDR-facing UI. -->
                        <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-top:20px;">
                            <div style="background:linear-gradient(135deg,#4338ca,#6366f1);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">🔄</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">Klenty Sync</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);">Temporary bridge — pulls call activity from Klenty into RCM until SDRs move fully off it</div>
                                </div>
                                <span id="klenty-status-badge" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;background:rgba(255,255,255,0.15);color:#fff;">Loading...</span>
                            </div>
                            <div style="padding:24px;">
                                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                                    <div>
                                        <div style="font-weight:600;font-size:0.85rem;margin-bottom:4px;">Nightly Klenty Call Sync</div>
                                        <p style="font-size:0.72rem;color:#a1a1aa;margin:0;max-width:420px;">When enabled, pulls the last 3 days of call activity per SDR from Klenty every night. Unmatched contacts are added as new leads automatically.</p>
                                        <p id="klenty-last-sync" style="font-size:0.68rem;color:#a1a1aa;margin-top:6px;"></p>
                                    </div>
                                    <span style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;">
                                        <input type="checkbox" id="klenty-enabled-toggle" style="position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;">
                                        <span id="klenty-toggle-track" style="position:absolute;pointer-events:none;inset:0;background:#e4e4e7;border-radius:24px;transition:0.2s;"></span>
                                    </span>
                                </div>
                                <div style="margin-bottom:16px;">
                                    <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Klenty API Key</label>
                                    <input type="password" id="klenty-api-key" placeholder="Enter your Klenty API key" style="width:100%;max-width:360px;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                    <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">Generate this in Klenty: Settings → Integrations → Klenty API Key.</p>
                                </div>
                                <div style="display:flex;gap:10px;">
                                    <button id="klenty-save-btn" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#4338ca,#6366f1);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(67,56,202,0.3);">💾 Save Klenty Configuration</button>
                                    <button id="klenty-test-btn" style="padding:10px 20px;border-radius:10px;border:1px solid #d1d5db;background:#fff;color:#374151;font-size:0.82rem;font-weight:600;cursor:pointer;">🔌 Test Connection</button>
                                </div>
                                <p style="font-size:0.68rem;color:#a1a1aa;margin-top:6px;">Save the API key first, then Test Connection to verify it actually works before enabling the nightly sync — a bad key otherwise only surfaces as a silent failure in the server logs.</p>
                                <div id="klenty-test-result" style="font-size:0.78rem;display:none;padding:10px 14px;border-radius:8px;margin-top:12px;"></div>
                                <div id="klenty-config-error" style="color:#ef4444;font-size:0.78rem;display:none;padding:10px 14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;margin-top:12px;"></div>
                                <div id="klenty-config-success" style="color:#059669;font-size:0.78rem;display:none;padding:10px 14px;background:#ecfdf5;border-radius:8px;border:1px solid #a7f3d0;margin-top:12px;"></div>
                            </div>
                        </div>

                    </div>
                </div>` : ''}

                <!-- ═══════════════════════════════════════════════════════════
                     TAB 5: MESSAGING (RCM / RCM Messaging)
                     ═══════════════════════════════════════════════════════════ -->
                ${isSuperAdmin ? `<div class="settings-tab-panel" data-panel="rcm" style="display:none;">
                    <div style="max-width:720px;">
                        <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                            <!-- Gradient Header -->
                            <div style="background:linear-gradient(135deg,#2563eb,#3b82f6);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">💬</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">RCM Conversations</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);">Embed RCM Messaging conversation component in lead detail pages</div>
                                </div>
                                <span id="messaging-status-badge" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;background:rgba(255,255,255,0.15);color:#fff;">Loading...</span>
                            </div>
                            <!-- Body -->
                            <div style="padding:24px;">
                                <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:#f8fafc;border-radius:10px;border:1px solid #e4e4e7;margin-bottom:20px;">
                                    <label class="toggle-switch"><input type="checkbox" id="rcm-enabled-toggle"><span class="toggle-slider"></span></label>
                                    <div>
                                        <div style="font-weight:600;font-size:0.88rem;">Enable Conversations Tab</div>
                                        <div style="font-size:0.72rem;color:#a1a1aa;">Show the Conversations tab on lead detail pages</div>
                                    </div>
                                </div>
                                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;padding:14px 16px;background:#f8fafc;border-radius:10px;border:1px solid #e4e4e7;">
                                    <div>
                                        <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Messaging Provider <span style="color:#a1a1aa;font-weight:400;text-transform:none;">(Cadences + Widget)</span></label>
                                        <select id="messaging-provider-select" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;box-sizing:border-box;">
                                            <option value="rcm">RCM / RCM Messaging</option>
                                            <option value="aircall">Aircall</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Aircall Number ID <span style="color:#a1a1aa;font-weight:400;">(only if Aircall selected)</span></label>
                                        <input type="text" id="aircall-messaging-number-id" placeholder="e.g. 123456" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:monospace;box-sizing:border-box;">
                                        <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">Uses the same Aircall API credentials already configured under Dialer settings</p>
                                    </div>
                                    <div style="grid-column:1 / -1;">
                                        <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Sandbox Test Phone Number <span style="color:#a1a1aa;font-weight:400;">(Playground → Cadence Test)</span></label>
                                        <input type="text" id="sandbox-test-phone-number" placeholder="e.g. 919545455721" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:monospace;box-sizing:border-box;">
                                        <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">A real number you control. Every test cadence send in the Playground goes here, never to a real lead — required before Cadence Test can run.</p>
                                    </div>
                                </div>
                                <div id="rcm-credentials-section">
                                    <div style="margin-bottom:16px;">
                                        <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Base URL</label>
                                        <input type="text" id="rcm-base-url" placeholder="https://app.bercm.com" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;box-sizing:border-box;">
                                    </div>
                                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                                        <div>
                                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">API Key</label>
                                            <input type="text" id="rcm-api-key" placeholder="e.g. 88d57264020ca091fcf14b2ec01ad2e2" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:monospace;box-sizing:border-box;">
                                        </div>
                                        <div>
                                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">User ID</label>
                                            <input type="text" id="rcm-user-id" placeholder="e.g. 1128360" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:monospace;box-sizing:border-box;">
                                        </div>
                                    </div>
                                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                                        <div>
                                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Account ID <span style="color:#a1a1aa;font-weight:400;">(Converse Desk)</span></label>
                                            <input type="text" id="rcm-account-id" placeholder="e.g. 80054247" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:monospace;box-sizing:border-box;">
                                            <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">Found in RCM platform settings</p>
                                        </div>
                                        <div>
                                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Sender Number <span style="color:#22c55e;font-weight:400;">📱 WhatsApp</span></label>
                                            <input type="text" id="rcm-sender-id" placeholder="e.g. 918956778474" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:monospace;box-sizing:border-box;">
                                            <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">Number without + (country code + number)</p>
                                        </div>
                                    </div>
                                </div>
                                <div style="padding:12px 16px;background:#f0fdf4;border:1px solid #a7f3d0;border-radius:10px;margin-bottom:16px;">
                                    <p style="font-size:0.78rem;color:#166534;margin:0;">✅ Authentication is automatic — JWTs are generated using HMAC signatures. No manual token entry needed.</p>
                                </div>
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <button id="rcm-save-btn" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,0.3);">💾 Save Configuration</button>
                                    <button id="rcm-test-btn" style="padding:10px 20px;border-radius:10px;border:1px solid #e4e4e7;background:#fff;font-size:0.82rem;font-weight:600;color:#475569;cursor:pointer;">🧪 Test Connection</button>
                                    <button id="rcm-clear-btn" style="padding:10px 20px;border-radius:10px;border:1px solid #fecaca;background:#fff;font-size:0.82rem;font-weight:600;color:#ef4444;cursor:pointer;">🗑️ Clear Credentials</button>
                                </div>
                                <div id="rcm-config-error" style="color:#ef4444;font-size:0.78rem;display:none;padding:10px 14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;margin-top:12px;"></div>
                                <div id="rcm-config-success" style="color:#059669;font-size:0.78rem;display:none;padding:10px 14px;background:#ecfdf5;border-radius:8px;border:1px solid #a7f3d0;margin-top:12px;"></div>
                                <div style="margin-top:20px;padding:14px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
                                    <div style="font-size:0.82rem;font-weight:600;color:#1e40af;margin-bottom:6px;">💡 How it works</div>
                                    <ul style="margin:0;padding-left:16px;font-size:0.78rem;color:#1d4ed8;line-height:1.6;">
                                        <li>A <strong>Conversations</strong> tab appears on every lead detail page</li>
                                        <li>The tab embeds the RCM conversation component</li>
                                        <li>SDRs can view SMS history and send messages directly from the CRM</li>
                                        <li>Credentials are stored in the database — no environment variables needed</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- ── RCM Dialer — SDR Agent Assignments ──── -->
                        <div style="margin-top:24px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                            <!-- Header row -->
                            <div style="padding:20px 24px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
                                <div>
                                    <div style="font-size:1rem;font-weight:700;color:#111;">Agent Assignments</div>
                                    <div style="font-size:0.78rem;color:#6b7280;margin-top:2px;">RCM sub-agents assigned for outbound calling</div>
                                </div>
                                <button id="conv-assign-agent-btn" style="flex-shrink:0;padding:8px 16px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-size:0.8rem;font-weight:600;cursor:pointer;white-space:nowrap;">＋ Assign Agent</button>
                            </div>
                            <div style="margin:14px 24px 0;border-top:1px solid #f0f0f0;"></div>
                            <!-- Search -->
                            <div style="padding:14px 24px 0;">
                                <div style="position:relative;">
                                    <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:0.9rem;">🔍</span>
                                    <input id="conv-agent-search" type="text" placeholder="Search agents..." style="width:100%;padding:9px 12px 9px 34px;border:1px solid #e5e7eb;border-radius:10px;font-size:0.84rem;background:#fafafa;box-sizing:border-box;outline:none;font-family:inherit;">
                                </div>
                                <div id="conv-agent-count" style="font-size:0.72rem;color:#9ca3af;margin-top:6px;"></div>
                            </div>
                            <!-- Agent list -->
                            <div id="sdr-agent-assignments-section" style="padding:8px 24px 8px;">
                                <!-- Populated by bindAiDialerTab() in settings_ai_dialer.js -->
                            </div>
                            <!-- Add form (hidden by default) -->
                            <div id="conv-add-form-row" style="display:none;padding:0 24px 20px;">
                                <div style="border:1.5px dashed #7c3aed;border-radius:10px;padding:16px;">
                                    <div style="font-size:0.78rem;font-weight:600;color:#7c3aed;margin-bottom:12px;">New Agent Assignment</div>
                                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
                                        <div style="flex:1;min-width:140px;">
                                            <label style="font-size:0.7rem;color:#6b7280;font-weight:500;display:block;margin-bottom:4px;">Select SDR</label>
                                            <select id="conv-add-sdr-select" style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.82rem;font-family:inherit;background:#fff;color:#111;outline:none;">
                                                <option value="">— Select SDR —</option>
                                            </select>
                                        </div>
                                        <div style="flex:1;min-width:120px;">
                                            <label style="font-size:0.7rem;color:#6b7280;font-weight:500;display:block;margin-bottom:4px;">RCM User ID</label>
                                            <input id="conv-add-user-id" type="text" placeholder="e.g. 1128097" style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.82rem;font-family:inherit;box-sizing:border-box;outline:none;">
                                        </div>
                                        <div style="flex:1;min-width:130px;">
                                            <label style="font-size:0.7rem;color:#6b7280;font-weight:500;display:block;margin-bottom:4px;">Caller Number</label>
                                            <input id="conv-add-phone" type="text" placeholder="+91..." style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.82rem;font-family:inherit;box-sizing:border-box;outline:none;">
                                        </div>
                                        <div style="flex:1;min-width:150px;">
                                            <label style="font-size:0.7rem;color:#6b7280;font-weight:500;display:block;margin-bottom:4px;">RCM Email</label>
                                            <input id="conv-add-email" type="email" placeholder="agent@company.com" style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.82rem;font-family:inherit;box-sizing:border-box;outline:none;">
                                        </div>
                                        <div style="display:flex;gap:8px;">
                                            <button id="conv-add-save-btn" style="padding:8px 18px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;white-space:nowrap;">Assign</button>
                                            <button id="conv-add-cancel-btn" style="padding:8px 14px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;font-size:0.82rem;color:#6b7280;cursor:pointer;">Cancel</button>
                                        </div>
                                    </div>
                                    <div id="conv-add-form-error" style="display:none;margin-top:10px;font-size:0.78rem;color:#ef4444;padding:8px 12px;background:#fef2f2;border-radius:6px;border:1px solid #fecaca;"></div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>` : ''}

                <!-- ═══════════════════════════════════════════════════════════
                     TAB 6: PUBLIC API (CMT ↔ SF Bridge)
                     ═══════════════════════════════════════════════════════════ -->
                ${isSuperAdmin ? `<div class="settings-tab-panel" data-panel="publicapi" style="display:none;">
                    <div style="max-width:680px;">
                        <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                            <!-- Gradient Header -->
                            <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.12);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">🔌</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">Public API — CMT ↔ Salesforce Bridge</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.6);">Allow external tools to look up Salesforce Account IDs via RCM</div>
                                </div>
                                <span id="public-api-status-badge" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;background:rgba(255,255,255,0.1);color:#fff;">⏳ Loading...</span>
                            </div>
                            <!-- Body -->
                            <div style="padding:24px;">

                                <!-- Status Banner -->
                                <div id="public-api-status-banner" style="padding:12px 16px;border-radius:10px;margin-bottom:20px;font-size:0.82rem;font-weight:500;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;">
                                    Checking API key status...
                                </div>

                                <!-- Key Display (shown only after generation) -->
                                <div id="public-api-key-display" style="display:none;margin-bottom:20px;">
                                    <div style="padding:16px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;">
                                        <div style="font-size:0.78rem;font-weight:700;color:#166534;margin-bottom:8px;">✅ API Key Generated — Copy it now!</div>
                                        <div style="display:flex;align-items:center;gap:8px;">
                                            <code id="public-api-key-value" style="flex:1;font-family:monospace;font-size:0.82rem;background:#fff;padding:10px 12px;border-radius:8px;border:1px solid #bbf7d0;word-break:break-all;color:#064e3b;"></code>
                                            <button id="public-api-copy-btn" style="padding:8px 14px;border-radius:8px;border:none;background:#16a34a;color:#fff;font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap;">📋 Copy</button>
                                        </div>
                                        <div style="font-size:0.72rem;color:#166534;margin-top:8px;">⚠️ This key will NOT be shown again. Store it securely.</div>
                                    </div>
                                </div>

                                <!-- Action Buttons -->
                                <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
                                    <button id="public-api-generate-btn" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(15,23,42,0.3);">🔑 Generate New Key</button>
                                    <button id="public-api-revoke-btn" style="display:none;padding:10px 20px;border-radius:10px;border:1px solid #fca5a5;background:#fff;font-size:0.82rem;font-weight:600;color:#dc2626;cursor:pointer;">🗑️ Revoke Key</button>
                                    <span id="public-api-action-status" style="font-size:0.78rem;color:#64748b;"></span>
                                </div>

                                <!-- How it works -->
                                <div style="padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:16px;">
                                    <div style="font-size:0.82rem;font-weight:700;color:#1e293b;margin-bottom:10px;">📋 How to use this API</div>
                                    <div style="font-size:0.78rem;color:#475569;line-height:1.7;">
                                        <strong>Endpoint:</strong><br>
                                        <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:0.75rem;">GET /api/public/sf/account</code><br><br>
                                        <strong>Headers:</strong><br>
                                        <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:0.75rem;">X-API-Key: &lt;your-key&gt;</code><br><br>
                                        <strong>Parameters (at least one required):</strong><br>
                                        <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:0.75rem;">rcm_messaging_id</code> — RCM Messaging Account ID from Salesforce<br>
                                        <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:0.75rem;">company_name</code> — Salesforce Account Name<br><br>
                                        <strong>Returns:</strong> Full Salesforce Lightning URL + Record ID for the matched Account (or Lead fallback).
                                    </div>
                                </div>

                                <div style="padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;margin-bottom:16px;">
                                    <div style="font-size:0.8rem;font-weight:600;color:#92400e;margin-bottom:4px;">⚠️ Security Notice</div>
                                    <div style="font-size:0.75rem;color:#78350f;line-height:1.5;">Generating a new key immediately invalidates the old one. Share keys securely — anyone with the key can query your Salesforce data. Use Revoke to disable access instantly.</div>
                                </div>

                                <!-- RCM MCP server -->
                                <div style="padding:16px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;">
                                    <div style="font-size:0.82rem;font-weight:700;color:#5b21b6;margin-bottom:10px;">🤖 RCM MCP Server (for Claude)</div>
                                    <div style="font-size:0.78rem;color:#4c1d95;line-height:1.7;">
                                        Read-only lead/call data access via Claude, for teams who need one-off
                                        data pulls without asking engineering. Uses the same API key above.
                                        <br><br>
                                        <strong>1. Install</strong> (needs Python 3.10+):<br>
                                        <code style="background:#ede9fe;padding:2px 6px;border-radius:4px;font-size:0.72rem;display:inline-block;margin:2px 0;">cd mcp_server &amp;&amp; uv venv --python 3.12 .venv &amp;&amp; uv pip install --python .venv/bin/python -r requirements.txt</code>
                                        <br><br>
                                        <strong>2. Register</strong> in your MCP client config (Claude Desktop or Claude Code):<br>
                                        <code style="background:#ede9fe;padding:2px 6px;border-radius:4px;font-size:0.72rem;display:block;white-space:pre;margin:4px 0;">{
  "mcpServers": {
    "rcm": {
      "command": "/absolute/path/to/mcp_server/.venv/bin/python",
      "args": ["/absolute/path/to/mcp_server/rcm_mcp.py"],
      "env": {
        "RCM_BASE_URL": "&lt;this environment's API URL&gt;",
        "RCM_API_KEY": "&lt;your key from above&gt;"
      }
    }
  }
}</code>
                                        <br>
                                        <strong>3. Tools available:</strong> <code style="background:#ede9fe;padding:2px 6px;border-radius:4px;font-size:0.72rem;">search_leads</code>,
                                        <code style="background:#ede9fe;padding:2px 6px;border-radius:4px;font-size:0.72rem;">get_lead_calls</code>
                                        <br><br>
                                        Full setup docs: <code style="background:#ede9fe;padding:2px 6px;border-radius:4px;font-size:0.72rem;">mcp_server/README.md</code> in the repo.
                                        An API key is Super-Admin-equivalent read access — treat it as the access boundary, one key per consumer.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>` : ''}

                <!-- ═══════════════════════════════════════════════════════════
                     TAB 7: SANDBOX ACCESS (Prod token mgmt + Staging refresh)
                     ═══════════════════════════════════════════════════════════ -->
                ${isSuperAdmin ? `<div class="settings-tab-panel" data-panel="sandbox" style="display:none;">
                    <div style="max-width:720px;">
                        <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                            <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">🧪</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">Sandbox Data Refresh</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);" id="sandbox-env-label">Detecting environment...</div>
                                </div>
                                <span id="sandbox-env-badge" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;background:rgba(255,255,255,0.15);color:#fff;">⏳ Loading...</span>
                            </div>
                            <div style="padding:24px;" id="sandbox-body">
                                <div style="text-align:center;padding:30px;color:#a1a1aa;font-size:0.85rem;">Loading sandbox configuration...</div>
                            </div>
                        </div>
                    </div>
                </div>` : ''}


            </div>
        </div>`;

    // ── Tab switching logic ───────────────────────────────────────────────
    document.querySelectorAll('#settings-tabs .settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#settings-tabs .settings-tab').forEach(t => {
                t.style.color = '#71717a';
                t.style.fontWeight = '500';
                t.style.borderBottom = '3px solid transparent';
                t.classList.remove('active');
            });
            tab.style.color = '#2563eb';
            tab.style.fontWeight = '600';
            tab.style.borderBottom = '3px solid #2563eb';
            tab.classList.add('active');
            document.querySelectorAll('.settings-tab-panel').forEach(p => p.style.display = 'none');
            const panel = document.querySelector(`.settings-tab-panel[data-panel="${tab.dataset.tab}"]`);
            if (panel) panel.style.display = 'block';

            // Load Public API key status when tab is opened
            if (tab.dataset.tab === 'publicapi') {
                _loadPublicApiStatus();
            }
            if (tab.dataset.tab === 'sandbox') {
                _initSandboxTab();
            }
        });
    });

    // Restore whichever tab was active before this re-render (see _activeTab above).
    // Real .click() (not a manual style/display patch) so tab-specific side
    // effects (_loadPublicApiStatus, _initSandboxTab) still run correctly.
    if (_activeTab !== 'connection') {
        document.querySelector(`#settings-tabs .settings-tab[data-tab="${_activeTab}"]`)?.click();
    }

    // ── Public API Key tab handlers ───────────────────────────────────────
    async function _loadPublicApiStatus() {
        const badge = document.getElementById('public-api-status-badge');
        const banner = document.getElementById('public-api-status-banner');
        const revokeBtn = document.getElementById('public-api-revoke-btn');
        if (!badge) return;

        try {
            const resp = await fetch(`${API_BASE}/api/admin/public-api-key/status`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('crm_token')}` }
            });
            const data = await resp.json();

            if (data.configured) {
                badge.style.background = 'rgba(34,197,94,0.25)';
                badge.style.color = '#bbf7d0';
                badge.textContent = '✅ Active';
                banner.style.background = '#f0fdf4';
                banner.style.borderColor = '#86efac';
                banner.style.color = '#166534';
                banner.textContent = '✅ Public API key is configured. CMT can make authenticated requests.';
                if (revokeBtn) revokeBtn.style.display = 'inline-flex';
            } else {
                badge.style.background = 'rgba(239,68,68,0.2)';
                badge.style.color = '#fca5a5';
                badge.textContent = '❌ No Key';
                banner.style.background = '#fff7ed';
                banner.style.borderColor = '#fed7aa';
                banner.style.color = '#9a3412';
                banner.textContent = '⚠️ No Public API key configured. Generate one to allow CMT access.';
                if (revokeBtn) revokeBtn.style.display = 'none';
            }
        } catch (e) {
            if (badge) badge.textContent = '⚠️ Error';
        }
    }

    const generateBtn = document.getElementById('public-api-generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            const confirmed = await _showConfirmModal({
                title: '⚠️ Generate New API Key?',
                body: 'Any existing key will be <strong>immediately invalidated</strong>. The new key will be shown once — store it securely.',
                confirmText: '🔑 Generate',
                danger: false
            });
            if (!confirmed) return;

            generateBtn.disabled = true;
            generateBtn.textContent = '⏳ Generating...';
            const statusEl = document.getElementById('public-api-action-status');

            try {
                const resp = await fetch(`${API_BASE}/api/admin/public-api-key/generate`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('crm_token')}` }
                });
                const data = await resp.json();

                if (data.success) {
                    // Show the key
                    const display = document.getElementById('public-api-key-display');
                    const keyCode = document.getElementById('public-api-key-value');
                    if (display && keyCode) {
                        keyCode.textContent = data.api_key;
                        display.style.display = 'block';
                    }
                    if (statusEl) statusEl.textContent = '✅ Key generated';
                    await _loadPublicApiStatus();
                } else {
                    if (statusEl) statusEl.textContent = '❌ Failed: ' + (data.detail || 'Unknown error');
                }
            } catch (e) {
                if (statusEl) statusEl.textContent = '❌ Network error';
            } finally {
                generateBtn.disabled = false;
                generateBtn.textContent = '🔑 Generate New Key';
            }
        });
    }

    const copyBtn = document.getElementById('public-api-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const val = document.getElementById('public-api-key-value');
            if (val && val.textContent) {
                navigator.clipboard.writeText(val.textContent).then(() => {
                    copyBtn.textContent = '✅ Copied!';
                    setTimeout(() => copyBtn.textContent = '📋 Copy', 2000);
                });
            }
        });
    }

    const revokeBtn = document.getElementById('public-api-revoke-btn');
    if (revokeBtn) {
        revokeBtn.addEventListener('click', async () => {
            const confirmed = await _showConfirmModal({
                title: '🗑️ Revoke API Key?',
                body: 'All external API access will be <strong>disabled immediately</strong>. You can generate a new key at any time.',
                confirmText: '🗑️ Revoke',
                danger: true
            });
            if (!confirmed) return;

            revokeBtn.disabled = true;
            revokeBtn.textContent = '⏳ Revoking...';

            try {
                const resp = await fetch(`${API_BASE}/api/admin/public-api-key`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('crm_token')}` }
                });
                const data = await resp.json();
                const statusEl = document.getElementById('public-api-action-status');
                if (data.success) {
                    if (statusEl) statusEl.textContent = '✅ Key revoked';
                    const display = document.getElementById('public-api-key-display');
                    if (display) display.style.display = 'none';
                    await _loadPublicApiStatus();
                } else {
                    if (statusEl) statusEl.textContent = '❌ ' + (data.message || 'Failed');
                }
            } catch (e) {
                console.error(e);
            } finally {
                revokeBtn.disabled = false;
                revokeBtn.textContent = '🗑️ Revoke Key';
            }
        });
    }

    // ── Sandbox Tab ──────────────────────────────────────────────────────
    let _sandboxInitialized = false;
    async function _initSandboxTab() {
        if (_sandboxInitialized) return;
        _sandboxInitialized = true;
        const body = document.getElementById('sandbox-body');
        const badge = document.getElementById('sandbox-env-badge');
        const envLabel = document.getElementById('sandbox-env-label');
        if (!body) return;

        const authH = { 'Authorization': `Bearer ${localStorage.getItem('crm_token')}`, 'Content-Type': 'application/json' };

        // Detect environment
        let envInfo;
        try {
            const r = await fetch(`${API_BASE}/api/admin/sandbox/env`, { headers: authH });
            envInfo = await r.json();
        } catch {
            envInfo = { is_staging: false, environment: 'unknown' };
        }

        if (envInfo.is_staging) {
            badge.textContent = '🧪 Staging';
            badge.style.background = 'rgba(255,255,255,0.25)';
            envLabel.textContent = 'Pull anonymized data from production or generate synthetic leads';
            // Self-test mode: also show token management so user can generate + use tokens on same server
            if (envInfo.self_test_enabled) {
                _renderProdUI(body, authH);
                const divider = document.createElement('hr');
                divider.style.cssText = 'margin:32px 0;border:none;border-top:2px dashed #e4e4e7;';
                body.appendChild(divider);
                const selfTestBanner = document.createElement('div');
                selfTestBanner.style.cssText = 'padding:12px 16px;border-radius:10px;margin-bottom:20px;font-size:0.82rem;font-weight:600;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;';
                selfTestBanner.textContent = '⚠️ Self-test mode: Use the token above with this server\'s URL to test the full refresh pipeline.';
                body.appendChild(selfTestBanner);
                _renderStagingUI(body, authH, /* skipClear */ true);
            } else {
                _renderStagingUI(body, authH);
            }
        } else {
            badge.textContent = '🔒 Production';
            badge.style.background = 'rgba(255,255,255,0.2)';
            envLabel.textContent = 'Generate a sandbox access token for staging environments';
            _renderProdUI(body, authH);
        }
    }

    // ── PRODUCTION UI: Token management ──────────────────────────────────
    async function _renderProdUI(body, authH) {
        body.innerHTML = `
            <div id="sb-token-status-banner" style="padding:12px 16px;border-radius:10px;margin-bottom:20px;font-size:0.82rem;font-weight:500;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;">Checking token status...</div>
            <div id="sb-token-display" style="display:none;margin-bottom:20px;">
                <div style="padding:16px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;">
                    <div style="font-size:0.78rem;font-weight:700;color:#166534;margin-bottom:8px;">✅ Token Generated — Copy it now!</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <code id="sb-token-value" style="flex:1;font-family:monospace;font-size:0.82rem;background:#fff;padding:10px 12px;border-radius:8px;border:1px solid #bbf7d0;word-break:break-all;color:#064e3b;"></code>
                        <button id="sb-copy-btn" style="padding:8px 14px;border-radius:8px;border:none;background:#16a34a;color:#fff;font-size:0.78rem;font-weight:600;cursor:pointer;">📋 Copy</button>
                    </div>
                    <div style="font-size:0.72rem;color:#166534;margin-top:8px;">⚠️ This token will NOT be shown again. Store it securely.</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
                <button id="sb-generate-btn" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(245,158,11,0.3);">🔑 Generate Sandbox Token</button>
                <button id="sb-revoke-btn" style="display:none;padding:10px 20px;border-radius:10px;border:1px solid #fca5a5;background:#fff;font-size:0.82rem;font-weight:600;color:#dc2626;cursor:pointer;">🗑️ Revoke Token</button>
            </div>
            <div style="padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
                <div style="font-size:0.82rem;font-weight:600;color:#92400e;margin-bottom:6px;">💡 How Sandbox Refresh works</div>
                <ul style="margin:0;padding-left:16px;font-size:0.78rem;color:#78350f;line-height:1.7;">
                    <li>Generate a token here on <strong>production</strong></li>
                    <li>On <strong>staging</strong>, go to this same tab and paste the token + production URL</li>
                    <li>Click <strong>Refresh</strong> on staging — it pulls anonymized data from production via API</li>
                    <li>All customer PII is anonymized <em>before</em> it leaves production</li>
                </ul>
            </div>
        `;

        // Load status
        async function loadStatus() {
            const banner = document.getElementById('sb-token-status-banner');
            const revokeBtn = document.getElementById('sb-revoke-btn');
            try {
                const r = await fetch(`${API_BASE}/api/admin/sandbox/token/status`, { headers: authH });
                const d = await r.json();
                if (d.configured) {
                    banner.innerHTML = '✅ Sandbox token is <strong>active</strong>. Staging can pull anonymized data.';
                    banner.style.background = '#f0fdf4'; banner.style.borderColor = '#86efac'; banner.style.color = '#166534';
                    revokeBtn.style.display = 'inline-flex';
                } else {
                    banner.textContent = '⚠️ No sandbox token configured. Generate one to allow staging access.';
                    banner.style.background = '#fff7ed'; banner.style.borderColor = '#fed7aa'; banner.style.color = '#9a3412';
                    revokeBtn.style.display = 'none';
                }
            } catch { banner.textContent = '❌ Error checking status'; }
        }
        await loadStatus();

        // Generate — uses custom modal (same fix as rollback button in upload.js)
        document.getElementById('sb-generate-btn')?.addEventListener('click', async () => {
            const confirmed = await _showConfirmModal({
                title: '🔑 Generate Sandbox Token?',
                body: 'Any existing token will be <strong>invalidated immediately</strong>. The new token will be shown once — store it securely.',
                confirmText: '🔑 Generate',
                danger: false
            });
            if (!confirmed) return;
            const btn = document.getElementById('sb-generate-btn');
            btn.disabled = true; btn.textContent = '⏳ Generating...';
            try {
                const r = await fetch(`${API_BASE}/api/admin/sandbox/token/generate`, { method: 'POST', headers: authH });
                const d = await r.json();
                if (d.success && d.token) {
                    document.getElementById('sb-token-value').textContent = d.token;
                    document.getElementById('sb-token-display').style.display = 'block';
                    showToast('Sandbox token generated successfully!', 'success');
                    await loadStatus();
                } else {
                    showToast(d.detail || d.error || 'Token generation failed — check server logs.', 'error');
                }
            } catch (err) {
                console.error('[Sandbox] Token generation error:', err);
                showToast('Network error generating token. Check console for details.', 'error');
            } finally { btn.disabled = false; btn.textContent = '🔑 Generate Sandbox Token'; }
        });

        // Copy
        document.getElementById('sb-copy-btn')?.addEventListener('click', () => {
            const v = document.getElementById('sb-token-value')?.textContent;
            if (v) navigator.clipboard.writeText(v).then(() => {
                const b = document.getElementById('sb-copy-btn'); b.textContent = '✅ Copied!';
                setTimeout(() => b.textContent = '📋 Copy', 2000);
            });
        });

        // Revoke
        document.getElementById('sb-revoke-btn')?.addEventListener('click', async () => {
            const confirmed = await _showConfirmModal({
                title: '🗑️ Revoke Sandbox Token?',
                body: 'Staging will <strong>lose access immediately</strong>. You can generate a new token at any time.',
                confirmText: '🗑️ Revoke',
                danger: true
            });
            if (!confirmed) return;
            const btn = document.getElementById('sb-revoke-btn');
            btn.disabled = true;
            try {
                await fetch(`${API_BASE}/api/admin/sandbox/token`, { method: 'DELETE', headers: authH });
                document.getElementById('sb-token-display').style.display = 'none';
                showToast('Sandbox token revoked.', 'success');
                await loadStatus();
            } catch (err) {
                console.error('[Sandbox] Token revoke error:', err);
                showToast('Failed to revoke token.', 'error');
            } finally { btn.disabled = false; btn.textContent = '🗑️ Revoke Token'; }
        });
    }

    // ── STAGING UI: Connection + Refresh + Generate + Clear ──────────────
    async function _renderStagingUI(body, authH, skipClear = false) {
        // Check connection status
        let connInfo;
        try {
            const r = await fetch(`${API_BASE}/api/admin/sandbox/connection`, { headers: authH });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            connInfo = await r.json();
        } catch (err) {
            console.warn('[Sandbox] connection fetch failed:', err);
            connInfo = { connected: false };
        }

        // Clear the loading placeholder before rendering (unless self-test already populated body)
        if (!skipClear) body.innerHTML = '';
        body.insertAdjacentHTML('beforeend', `
            <!-- Connection Section -->
            <div style="margin-bottom:24px;">
                <h4 style="font-size:0.9rem;font-weight:700;margin:0 0 12px;">🔗 Production Connection</h4>
                <div id="sb-conn-status" style="padding:12px 16px;border-radius:10px;margin-bottom:14px;font-size:0.82rem;font-weight:500;background:${connInfo.connected ? '#f0fdf4' : '#fff7ed'};color:${connInfo.connected ? '#166534' : '#9a3412'};border:1px solid ${connInfo.connected ? '#86efac' : '#fed7aa'};">
                    ${connInfo.connected ? `✅ Connected to <strong>${connInfo.prod_url || 'production'}</strong>` : '⚠️ Not connected. Enter your production URL and sandbox token below.'}
                </div>
                <div id="sb-conn-form" style="${connInfo.connected ? 'display:none' : ''}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                        <div>
                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;color:#71717a;display:block;margin-bottom:4px;">Production URL</label>
                            <input type="url" id="sb-prod-url" placeholder="https://your-prod.onrender.com" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;color:#71717a;display:block;margin-bottom:4px;">Sandbox Token</label>
                            <input type="password" id="sb-token-input" placeholder="sb_live_xxxxx" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:monospace;box-sizing:border-box;">
                        </div>
                    </div>
                    <button id="sb-connect-btn" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;">🔗 Connect to Production</button>
                    <span id="sb-conn-error" style="font-size:0.78rem;color:#ef4444;margin-left:10px;"></span>
                </div>
                ${connInfo.connected ? '<button id="sb-disconnect-btn" style="padding:8px 16px;border-radius:8px;border:1px solid #fca5a5;background:#fff;font-size:0.78rem;color:#dc2626;cursor:pointer;">✂️ Disconnect</button>' : ''}
            </div>

            <!-- Last Refresh Info -->
            ${connInfo.last_refresh_at ? `<div style="padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:24px;font-size:0.82rem;color:#475569;">📊 Last refresh: <strong>${new Date(ensureUTC(connInfo.last_refresh_at)).toLocaleString(undefined, { timeZoneName: 'short' })}</strong> — ${connInfo.last_refresh_lead_count || 0} leads — Status: <strong>${connInfo.last_refresh_status || 'unknown'}</strong></div>` : ''}

            <!-- Actions -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
                <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:18px;">
                    <div style="font-size:0.88rem;font-weight:700;color:#166534;margin-bottom:6px;">🪞 Mirror Refresh</div>
                    <div style="font-size:0.75rem;color:#15803d;margin-bottom:14px;">Pull anonymized real data from production</div>
                    <button id="sb-refresh-btn" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;width:100%;${connInfo.connected ? '' : 'opacity:0.5;cursor:not-allowed;'}" ${connInfo.connected ? '' : 'disabled'}>🔄 Refresh from Production</button>
                </div>
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:18px;">
                    <div style="font-size:0.88rem;font-weight:700;color:#1e40af;margin-bottom:6px;">🏭 Synthetic Data</div>
                    <div style="font-size:0.75rem;color:#2563eb;margin-bottom:14px;">Generate fake leads for testing (no prod needed)</div>
                    <div style="display:flex;gap:8px;">
                        <select id="sb-gen-count" style="flex:1;padding:9px;border:1px solid #bfdbfe;border-radius:8px;font-size:0.82rem;">
                            <option value="100">100 leads</option>
                            <option value="500">500 leads</option>
                            <option value="1000">1,000 leads</option>
                            <option value="2000">2,000 leads</option>
                        </select>
                        <button id="sb-gen-synthetic-btn" style="padding:9px 16px;border-radius:8px;border:none;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;">Generate</button>
                    </div>
                </div>
            </div>

            <!-- Progress Bar (hidden until refresh starts) -->
            <div id="sb-progress-container" style="display:none;margin-bottom:24px;">
                <div style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:18px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                        <span id="sb-progress-step" style="font-size:0.82rem;font-weight:600;color:#18181b;">Starting...</span>
                        <span id="sb-progress-pct" style="font-size:0.82rem;font-weight:700;color:#f59e0b;">0%</span>
                    </div>
                    <div style="height:10px;background:#f4f4f5;border-radius:99px;overflow:hidden;">
                        <div id="sb-progress-bar" style="height:100%;width:0%;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:99px;transition:width 0.5s ease;"></div>
                    </div>
                    <div id="sb-progress-detail" style="font-size:0.72rem;color:#a1a1aa;margin-top:6px;"></div>
                </div>
            </div>

            <!-- Clear Data -->
            <div style="border-top:1px solid #e4e4e7;padding-top:20px;">
                <button id="sb-clear-btn" style="padding:9px 18px;border-radius:10px;border:1px solid #fca5a5;background:#fff;font-size:0.78rem;font-weight:600;color:#dc2626;cursor:pointer;">🗑️ Clear All Staging Data</button>
            </div>
        `);

        // Connect
        document.getElementById('sb-connect-btn')?.addEventListener('click', async () => {
            const url = document.getElementById('sb-prod-url')?.value?.trim();
            const token = document.getElementById('sb-token-input')?.value?.trim();
            const errEl = document.getElementById('sb-conn-error');
            if (!url || !token) { errEl.textContent = 'Both fields are required.'; return; }
            const btn = document.getElementById('sb-connect-btn');
            btn.disabled = true; btn.textContent = '⏳ Testing connection...';
            errEl.textContent = '';
            try {
                const r = await fetch(`${API_BASE}/api/admin/sandbox/connection`, { method: 'POST', headers: authH, body: JSON.stringify({ prod_url: url, token }) });
                const d = await r.json();
                if (d.success) { _sandboxInitialized = false; _initSandboxTab(); showToast('Connected to production!', 'success'); }
                else { errEl.textContent = d.detail || 'Connection failed'; }
            } catch (e) { errEl.textContent = 'Network error'; } finally { btn.disabled = false; btn.textContent = '🔗 Connect to Production'; }
        });

        // Disconnect
        document.getElementById('sb-disconnect-btn')?.addEventListener('click', async () => {
            const confirmed = await _showConfirmModal({
                title: '✂️ Disconnect from Production?',
                body: 'The staging sandbox will no longer be able to pull data from production until reconnected.',
                confirmText: '✂️ Disconnect',
                danger: true
            });
            if (!confirmed) return;
            await fetch(`${API_BASE}/api/admin/sandbox/connection`, { method: 'DELETE', headers: authH });
            _sandboxInitialized = false; _initSandboxTab();
        });

        // Refresh
        document.getElementById('sb-refresh-btn')?.addEventListener('click', async () => {
            const confirmed = await _showConfirmModal({
                title: '⚠️ Replace Staging Data?',
                body: 'This will <strong>REPLACE all staging data</strong> with anonymized production data. This action cannot be undone.',
                confirmText: '🔄 Yes, Refresh',
                danger: true
            });
            if (!confirmed) return;
            const btn = document.getElementById('sb-refresh-btn');
            btn.disabled = true; btn.textContent = '⏳ Starting...';
            try {
                const r = await fetch(`${API_BASE}/api/admin/sandbox/refresh`, { method: 'POST', headers: authH, body: JSON.stringify({ confirm: 'REFRESH' }) });
                const d = await r.json();
                if (d.success) { _startProgressPolling(authH); }
                else { showToast(d.detail || 'Failed to start refresh', 'error'); btn.disabled = false; btn.textContent = '🔄 Refresh from Production'; }
            } catch { btn.disabled = false; btn.textContent = '🔄 Refresh from Production'; }
        });

        // Generate synthetic leads
        document.getElementById('sb-gen-synthetic-btn')?.addEventListener('click', async () => {
            const count = parseInt(document.getElementById('sb-gen-count')?.value || '100');
            const confirmed = await _showConfirmModal({
                title: '🏭 Generate Synthetic Leads?',
                body: `Generate <strong>${count}</strong> fake leads for testing purposes. No production data is involved.`,
                confirmText: '🏭 Generate',
                danger: false
            });
            if (!confirmed) return;
            const btn = document.getElementById('sb-gen-synthetic-btn');
            btn.disabled = true; btn.textContent = '⏳...';
            try {
                const r = await fetch(`${API_BASE}/api/admin/sandbox/generate`, { method: 'POST', headers: authH, body: JSON.stringify({ count, confirm: 'GENERATE' }) });
                const d = await r.json();
                if (d.success) showToast(`Generated ${d.count} leads!`, 'success');
                else showToast(d.detail || 'Failed', 'error');
            } catch { showToast('Network error', 'error'); } finally { btn.disabled = false; btn.textContent = 'Generate'; }
        });

        // Clear
        document.getElementById('sb-clear-btn')?.addEventListener('click', async () => {
            const confirmed = await _showConfirmModal({
                title: '🗑️ Clear All Staging Data?',
                body: 'This will <strong>permanently delete ALL</strong> leads, notes, calls, and activity from staging. This cannot be undone.',
                confirmText: '🗑️ Yes, Clear Everything',
                danger: true
            });
            if (!confirmed) return;
            const btn = document.getElementById('sb-clear-btn');
            btn.disabled = true; btn.textContent = '⏳ Clearing...';
            try {
                const r = await fetch(`${API_BASE}/api/admin/sandbox/clear`, { method: 'POST', headers: authH, body: JSON.stringify({ confirm: 'CLEAR' }) });
                const d = await r.json();
                if (d.success) showToast(`Cleared ${d.tables?.length || 0} tables.`, 'success');
                else showToast(d.detail || 'Failed', 'error');
            } catch { showToast('Network error', 'error'); } finally { btn.disabled = false; btn.textContent = '🗑️ Clear All Staging Data'; }
        });
    }

    // ── Progress polling ─────────────────────────────────────────────────
    function _startProgressPolling(authH) {
        const container = document.getElementById('sb-progress-container');
        if (container) container.style.display = 'block';

        const poll = setInterval(async () => {
            try {
                const r = await fetch(`${API_BASE}/api/admin/sandbox/status`, { headers: authH });
                const d = await r.json();
                const stepEl = document.getElementById('sb-progress-step');
                const pctEl = document.getElementById('sb-progress-pct');
                const barEl = document.getElementById('sb-progress-bar');
                const detailEl = document.getElementById('sb-progress-detail');

                if (stepEl) stepEl.textContent = d.step || '';
                if (pctEl) pctEl.textContent = `${d.percent || 0}%`;
                if (barEl) barEl.style.width = `${d.percent || 0}%`;
                if (detailEl) detailEl.textContent = d.detail || '';

                if (d.status === 'done') {
                    clearInterval(poll);
                    if (barEl) barEl.style.background = 'linear-gradient(135deg,#16a34a,#15803d)';
                    const leadCount = d.lead_count ?? 0;
                    showToast(`✅ Refresh complete! ${leadCount} leads loaded.`, 'success');
                    // Re-init sandbox tab so the "Last refresh" stats block updates
                    setTimeout(() => {
                        const refreshBtn = document.getElementById('sb-refresh-btn');
                        if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '🔄 Refresh from Production'; }
                        const cont = document.getElementById('sb-progress-container');
                        if (cont) cont.style.display = 'none';
                        _sandboxInitialized = false;
                        _initSandboxTab();
                    }, 1200);
                } else if (d.status === 'failed') {
                    clearInterval(poll);
                    if (barEl) barEl.style.background = '#ef4444';
                    showToast(`❌ Refresh failed: ${d.error || 'Unknown error'}`, 'error');
                    const refreshBtn = document.getElementById('sb-refresh-btn');
                    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '🔄 Refresh from Production'; }
                    const cont = document.getElementById('sb-progress-container');
                    if (cont) cont.style.display = 'none';
                }
            } catch { /* keep polling */ }
        }, 2000);
    }


    // ── Bind tab handlers from modules ────────────────────────────────────
    // Use a scoped re-render callback that marks the call as internal,
    // preventing URL manipulation and unwanted hashchange events.
    const _rerender = (c) => renderSettings(c, true);
    await bindConnectionTab(container, _rerender);

    if (!isAdmin) return;

    const currentSettings = await bindSyncTab(container);
    await renderCallOutcomesConfig();
    await bindAiDialerTab(container, currentSettings, _rerender);
}
