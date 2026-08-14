// ── views/sdr_settings.js — SDR Settings Page (integration status & prefs) ───
//
// Available to ALL users (SDRs see their own settings; admins see theirs).
// Cards: Email Sync, Aircall Dialer, Notifications (placeholder).
// ──────────────────────────────────────────────────────────────────────────────
import { currentUser, dialerEnabled, emailSyncEnabled } from '../auth.js';
import * as api from '../api.js';
import { showToast, showLoader } from '../utils.js';
import { mp } from '../mp.js';

export async function renderSdrSettings(container) {
    showLoader(container);

    // ── Check for email_connected success param (post-OAuth redirect) ────
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('email_connected') === 'true') {
        // Clean up URL without reloading
        const cleanUrl = window.location.pathname + '#my-settings';
        window.history.replaceState({}, '', cleanUrl);
        // Show success toast after a short delay to let the UI render
        setTimeout(() => {
            showToast('✅ Email connected successfully! You can now send and receive emails from RCM.', 'success', 5000);
        }, 500);
    }

    // Fetch live mailbox and dialer status
    let emailStatus = { connected: false, nylas_configured: false, email: null };
    try { emailStatus = await api.getEmailStatus(); } catch { /* ignore */ }

    let dialerStatus = { active: false, provider: 'none', has_credentials: false, dialer_enabled: false };
    try { dialerStatus = await api.fetchDialerStatus(); } catch { /* ignore */ }

    let signatureData = { signature_html: '' };
    try { signatureData = await api.getMySignature(); } catch { /* ignore */ }

    const emailEnabled = emailSyncEnabled;
    const dialerOn = dialerStatus.dialer_enabled;

    container.innerHTML = `
    <div class="fade-in" style="max-width:740px;margin:0 auto;">
        <div class="page-header" style="margin-bottom:28px;">
            <div>
                <h1 class="page-title">⚙️ SDR Settings</h1>
                <p class="page-subtitle">Manage your integrations and preferences</p>
            </div>
        </div>

        <!-- ── Email Sync Card ────────────────────────────────────── -->
        <div class="sdr-settings-card" style="border-left:4px solid ${emailEnabled ? '#6366f1' : '#d1d5db'};">
            <div class="sdr-settings-card-header">
                <div class="sdr-settings-icon" style="background:#eef2ff;color:#6366f1;">✉️</div>
                <div class="sdr-settings-info">
                    <div class="sdr-settings-title">Email Sync</div>
                    <div class="sdr-settings-desc">Connect your email to send and receive from RCM</div>
                </div>
                <div class="sdr-settings-status">
                    ${emailEnabled
                        ? `<span class="sdr-toggle on" title="Enabled by Admin">
                             <span class="sdr-toggle-knob"></span>
                           </span>`
                        : `<span class="sdr-badge disabled">Disabled by Admin</span>`
                    }
                </div>
            </div>

            ${emailEnabled ? `
            <div class="sdr-settings-card-body" id="email-sync-body">
                ${emailStatus.connected
                    ? `<div class="sdr-connected-row">
                         <span class="sdr-connected-dot"></span>
                         <span class="sdr-connected-email">Connected as ${emailStatus.email || currentUser?.email || ''}</span>
                         <button class="sdr-disconnect-btn" id="sdr-disconnect-email">Disconnect</button>
                       </div>`
                    : emailStatus.nylas_configured
                        ? `<div class="sdr-connect-row">
                             <span style="font-size:0.85rem;color:var(--text-muted);">No email connected yet.</span>
                             <button class="btn btn-primary sdr-connect-btn" id="sdr-connect-email" style="padding:8px 18px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;font-size:0.82rem;font-weight:600;">🔗 Connect Email</button>
                           </div>`
                        : `<div style="padding:12px 16px;font-size:0.85rem;color:var(--text-muted);">
                             ℹ️ Email integration is not configured yet. Contact your Super Admin.
                           </div>`
                }
            </div>` : `
            <div class="sdr-settings-card-body">
                <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;font-size:0.85rem;color:var(--text-muted);">
                    <span>ℹ️</span>
                    <span>Email access is managed by your admin. Contact your Pod Admin to request access.</span>
                </div>
            </div>`}
        </div>

        <!-- ── Dialer Card ────────────────────────────────── -->
        <div class="sdr-settings-card" style="border-left:4px solid ${dialerOn ? '#f97316' : '#d1d5db'};">
            <div class="sdr-settings-card-header">
                <div class="sdr-settings-icon" style="background:#fff7ed;color:#f97316;">📞</div>
                <div class="sdr-settings-info">
                    <div class="sdr-settings-title">Dialer</div>
                    <div class="sdr-settings-desc">Make calls directly from RCM</div>
                </div>
                <div class="sdr-settings-status">
                    <span class="sdr-toggle ${dialerOn ? 'on' : ''}" id="sdr-dialer-toggle" style="cursor:pointer;" title="Click to toggle dialer">
                         <span class="sdr-toggle-knob"></span>
                    </span>
                </div>
            </div>

            <div class="sdr-settings-card-body">
                ${dialerOn ? `
                <div style="padding:14px 16px;">
                    <label style="font-size:0.82rem;font-weight:600;color:var(--text-primary);display:block;margin-bottom:6px;">
                        📱 Caller ID
                    </label>
                    <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 10px;">
                        Your outbound caller ID is assigned by your Admin and cannot be changed here.
                    </p>
                    <div id="sdr-caller-id-display" style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
                        border-radius:8px;">
                        <span style="font-size:1.1rem;">📞</span>
                        <div>
                            <div id="sdr-phone-status" style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">Loading…</div>
                            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">Managed by Admin • Read-only</div>
                        </div>
                    </div>
                </div>
                ` : `
                <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;font-size:0.85rem;color:var(--text-muted);">
                    <span>ℹ️</span>
                    <span>Dialer is currently disabled. Toggle the switch above to enable.</span>
                </div>
                `}
            </div>
        </div>

        <!-- ── Email Branding Card ────────────────────────────────── -->
        <div class="sdr-settings-card" style="border-left:4px solid ${emailStatus.hide_branding_in_email ? '#6366f1' : '#d1d5db'};">
            <div class="sdr-settings-card-header">
                <div class="sdr-settings-icon" style="background:#eef2ff;color:#6366f1;">🏷️</div>
                <div class="sdr-settings-info">
                    <div class="sdr-settings-title">Hide "Powered by RCM"</div>
                    <div class="sdr-settings-desc">Suppress the footer on emails you send from RCM</div>
                </div>
                <div class="sdr-settings-status">
                    <span class="sdr-toggle ${emailStatus.hide_branding_in_email ? 'on' : ''}" id="sdr-branding-toggle" style="cursor:pointer;" title="Click to toggle">
                         <span class="sdr-toggle-knob"></span>
                    </span>
                </div>
            </div>
        </div>

        <!-- ── Email Signature Card ───────────────────────────────── -->
        <div class="sdr-settings-card">
            <div class="sdr-settings-card-header">
                <div class="sdr-settings-icon" style="background:#eef2ff;color:#6366f1;">✍️</div>
                <div class="sdr-settings-info">
                    <div class="sdr-settings-title">Email Signature</div>
                    <div class="sdr-settings-desc">Appended automatically to every email you send from RCM</div>
                </div>
            </div>
            <div class="sdr-settings-card-body" style="padding:14px 16px;">
                <div class="email-rte-toolbar" style="margin-bottom:8px;">
                    <button type="button" class="email-rte-btn" id="sig-bold" title="Bold"><b>B</b></button>
                    <button type="button" class="email-rte-btn" id="sig-italic" title="Italic"><i>I</i></button>
                    <button type="button" class="email-rte-btn" id="sig-link" title="Insert link">🔗</button>
                    <button type="button" class="email-rte-btn" id="sig-image" title="Insert image">🖼️</button>
                </div>
                <div class="email-reply-textarea" id="sig-editor" contenteditable="true"
                    data-placeholder="e.g. Cheers,&#10;Jane Doe · Account Executive&#10;Book a meeting: https://..."
                    style="min-height:110px;"></div>
                <div style="display:flex;justify-content:flex-end;margin-top:10px;">
                    <button class="btn btn-primary" id="sig-save-btn" style="padding:6px 16px;font-size:0.82rem;">Save Signature</button>
                </div>
            </div>
        </div>

        <!-- ── Notifications Card (placeholder) ──────────────────── -->
        <div class="sdr-settings-card" style="border-left:4px solid #d1d5db;opacity:0.7;">
            <div class="sdr-settings-card-header">
                <div class="sdr-settings-icon" style="background:#f0fdf4;color:#22c55e;">🔔</div>
                <div class="sdr-settings-info">
                    <div class="sdr-settings-title">Notifications</div>
                    <div class="sdr-settings-desc">Email and in-app notification preferences</div>
                </div>
                <div class="sdr-settings-status">
                    <span style="font-size:1.2rem;color:var(--text-muted);">›</span>
                </div>
            </div>

            <div class="sdr-settings-card-body">
                <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;font-size:0.85rem;color:var(--text-muted);">
                    <span>🚧</span>
                    <span>Notification preferences coming soon.</span>
                </div>
            </div>
        </div>
    </div>`;

    // ── Event bindings ────────────────────────────────────────────────────

    // Connect email — navigate in same tab so OAuth callback lands correctly
    document.getElementById('sdr-connect-email')?.addEventListener('click', async () => {
        const btn = document.getElementById('sdr-connect-email');
        btn.textContent = '⏳ Redirecting...'; btn.disabled = true;
        try {
            const authData = await api.getEmailAuthUrl();
            if (authData?.auth_url) {
                // Navigate in the same window — Nylas OAuth will redirect back
                // to /api/email/callback → /frontend/index.html?email_connected=true#settings
                window.location.href = authData.auth_url;
            } else {
                showToast('Failed to get auth URL', 'error');
                btn.textContent = '🔗 Connect Email'; btn.disabled = false;
            }
        } catch (e) {
            showToast('Error: ' + (e.message || e), 'error');
            btn.textContent = '🔗 Connect Email'; btn.disabled = false;
        }
    });

    // Disconnect email
    document.getElementById('sdr-disconnect-email')?.addEventListener('click', async () => {
        if (!confirm('Disconnect your email? You won\u2019t be able to send emails until you reconnect.')) return;
        try {
            await api.disconnectEmail();
            showToast('Email disconnected', 'success');
            await renderSdrSettings(container);  // Re-render
        } catch (e) {
            showToast('Failed to disconnect: ' + (e.message || e), 'error');
        }
    });

    // ── Read-only Caller ID display (plan item 4D) ───────────────────────
    const phoneStatus = document.getElementById('sdr-phone-status');
    if (phoneStatus) {
        try {
            const data = await api.getMyPhone();
            if (data.phone_number) {
                phoneStatus.textContent = data.phone_number;
                phoneStatus.style.color = '#22c55e';
            } else {
                phoneStatus.textContent = 'No number assigned yet — contact your Admin';
                phoneStatus.style.color = '#f59e0b';
                // 4D: Inline warning block — leads will see RCM's number, not yours
                const callerIdWrap = document.getElementById('sdr-caller-id-display');
                if (callerIdWrap) {
                    const warn = document.createElement('div');
                    warn.id = 'sdr-caller-id-warning';
                    warn.style.cssText = [
                        'display:flex', 'align-items:flex-start', 'gap:10px',
                        'margin-top:10px', 'padding:10px 14px',
                        'background:#fffbeb', 'border:1.5px solid #fcd34d',
                        'border-radius:8px', 'font-size:0.8rem', 'color:#92400e',
                    ].join(';');
                    warn.innerHTML = `
                        <span style="font-size:1rem;flex-shrink:0;">⚠️</span>
                        <div>
                            <strong>No caller ID configured.</strong>
                            Leads will see a RCM number instead of your number.
                            Ask your Pod Admin or Super Admin to assign a caller ID under
                            <em>Settings → SDR Management</em>.
                        </div>`;
                    callerIdWrap.insertAdjacentElement('afterend', warn);
                }
            }
        } catch {
            phoneStatus.textContent = 'No number assigned yet — contact your Admin';
            phoneStatus.style.color = '#f59e0b';
        }
    }

    // ── Toggle dialer ─────────────────────────────────────────────────────
    document.getElementById('sdr-dialer-toggle')?.addEventListener('click', async () => {
        const toggleEl = document.getElementById('sdr-dialer-toggle');
        if (!toggleEl) return;
        
        const currentlyOn = toggleEl.classList.contains('on');
        const nextState = !currentlyOn;
        
        toggleEl.style.opacity = '0.5';
        toggleEl.style.pointerEvents = 'none';
        
        try {
            const res = await api.toggleMyDialer(nextState);
            if (res && res.dialer_enabled !== undefined) {
                const isEnabled = res.dialer_enabled;
                if (isEnabled) {
                    toggleEl.classList.add('on');
                } else {
                    toggleEl.classList.remove('on');
                }
                showToast(`Dialer ${isEnabled ? 'enabled' : 'disabled'}`, 'success');
                if (window._refreshDialerConfig) {
                    await window._refreshDialerConfig();
                }
            } else {
                showToast('Failed to toggle dialer status', 'error');
            }
        } catch (e) {
            showToast('Error toggling dialer: ' + (e.message || e), 'error');
        } finally {
            toggleEl.style.opacity = '';
            toggleEl.style.pointerEvents = '';
            // Re-render settings page to reflect the new state (e.g. show/hide caller ID)
            await renderSdrSettings(container);
        }
    });

    // ── Toggle "hide branding" ────────────────────────────────────────────
    document.getElementById('sdr-branding-toggle')?.addEventListener('click', async () => {
        const toggleEl = document.getElementById('sdr-branding-toggle');
        if (!toggleEl) return;

        const nextState = !toggleEl.classList.contains('on');
        toggleEl.style.opacity = '0.5';
        toggleEl.style.pointerEvents = 'none';

        try {
            const res = await api.toggleEmailBranding(nextState);
            if (res && res.hide_branding_in_email !== undefined) {
                toggleEl.classList.toggle('on', res.hide_branding_in_email);
                mp.track('Email Branding Toggled', { hidden: res.hide_branding_in_email });
                showToast(res.hide_branding_in_email ? 'Branding hidden on sent mail' : 'Branding footer restored', 'success');
            } else {
                showToast('Failed to update setting', 'error');
            }
        } catch (e) {
            showToast('Error: ' + (e.message || e), 'error');
        } finally {
            toggleEl.style.opacity = '';
            toggleEl.style.pointerEvents = '';
        }
    });

    // ── Email signature editor ────────────────────────────────────────────
    const sigEditor = document.getElementById('sig-editor');
    if (sigEditor) {
        sigEditor.innerHTML = signatureData.signature_html || '';

        const sigExec = (cmd, arg) => {
            sigEditor.focus();
            document.execCommand(cmd, false, arg);
        };
        document.getElementById('sig-bold')?.addEventListener('click', () => sigExec('bold'));
        document.getElementById('sig-italic')?.addEventListener('click', () => sigExec('italic'));
        document.getElementById('sig-link')?.addEventListener('click', () => {
            const url = window.prompt('Link URL (include https://)');
            if (url) sigExec('createLink', url);
        });
        document.getElementById('sig-image')?.addEventListener('click', () => {
            const url = window.prompt('Image URL (include https://)');
            if (url) sigExec('insertImage', url);
        });

        document.getElementById('sig-save-btn')?.addEventListener('click', async () => {
            const btn = document.getElementById('sig-save-btn');
            btn.disabled = true; btn.textContent = 'Saving...';
            try {
                await api.saveMySignature(sigEditor.innerHTML);
                mp.track('Email Signature Saved');
                showToast('Signature saved', 'success');
            } catch (e) {
                showToast('Failed to save signature: ' + (e.message || e), 'error');
            } finally {
                btn.disabled = false; btn.textContent = 'Save Signature';
            }
        });
    }
}
