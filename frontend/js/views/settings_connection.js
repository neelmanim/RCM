// ── views/settings_connection.js — Connection + Nylas tab HTML + handlers ──────
import { isSuperAdmin } from '../auth.js';
import { connectSalesforce, disconnectSalesforce, getNylasConfig, saveNylasConfig, testNylasConnection } from '../api.js';

/**
 * Returns the Connection tab panel HTML.
 * Called by settings.js to compose the settings page.
 */
export function connectionTabHTML({ isAdmin, isSuperAdmin, sfInfo, sfInstanceDisplay, stats, sc }) {
    if (!isAdmin) return '';
    return `<div class="settings-tab-panel active" data-panel="connection">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start;">

                        <!-- ── SF Connection Card ─────────────────────── -->
                        <div id="sf-connection-card" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                            <!-- Gradient Header -->
                            <div style="background:linear-gradient(135deg,#0176d3,#1b96ff);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                                <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                    <span style="font-size:1.3rem;">☁️</span>
                                </div>
                                <div>
                                    <div style="font-size:1rem;font-weight:700;color:#fff;">Salesforce Connection</div>
                                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);">Manage your CRM integration</div>
                                </div>
                            </div>
                            <!-- Body -->
                            <div style="padding:20px 24px;">
                                ${sfInfo.connected ? `
                                    <!-- Status Pill -->
                                    <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f0fdf4;border-radius:10px;margin-bottom:16px;">
                                        <span style="display:inline-block;width:8px;height:8px;background:#22c55e;border-radius:50%;animation:pulse 2s infinite;"></span>
                                        <span style="font-size:0.82rem;font-weight:600;color:#166534;">Connected via ${sfInfo.source === 'ui' ? 'Portal' : 'Environment'}</span>
                                    </div>

                                    <!-- Instance / Environment Tiles -->
                                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                                        <div style="padding:12px 14px;background:#f0f9ff;border-radius:10px;">
                                            <div style="font-size:0.65rem;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Instance</div>
                                            <div style="font-size:0.82rem;font-weight:600;color:#0c4a6e;word-break:break-all;">${sfInstanceDisplay}</div>
                                        </div>
                                        <div style="padding:12px 14px;background:#f0fdf4;border-radius:10px;">
                                            <div style="font-size:0.65rem;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Environment</div>
                                            <div style="font-size:0.82rem;font-weight:600;color:#166534;">${sfInfo.environment || 'Production'}</div>
                                        </div>
                                    </div>

                                    <!-- Detail Rows -->
                                    <div style="border-radius:10px;overflow:hidden;margin-bottom:16px;">
                                        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#f8fafc;">
                                            <span style="font-size:0.78rem;color:#71717a;">👤 Username</span>
                                            <span style="font-size:0.78rem;font-weight:600;color:#18181b;">${sfInfo.username || '—'}</span>
                                        </div>
                                        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#fff;">
                                            <span style="font-size:0.78rem;color:#71717a;">🏢 Org Name</span>
                                            <span style="font-size:0.78rem;font-weight:600;color:#18181b;">${sfInfo.org_name || '—'}</span>
                                        </div>
                                        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#f8fafc;">
                                            <span style="font-size:0.78rem;color:#71717a;">🔗 Connected By</span>
                                            <span style="font-size:0.78rem;font-weight:600;color:#18181b;">${sfInfo.connected_by || '—'}</span>
                                        </div>
                                        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f0fdf4;">
                                            <span style="font-size:0.78rem;color:#71717a;">✅ Last Sync</span>
                                            <div style="text-align:right;">
                                                <div style="font-size:0.78rem;font-weight:600;color:#166534;">${sfInfo.last_sync_at ? new Date(sfInfo.last_sync_at).toLocaleString() : 'Never'}</div>
                                                ${sfInfo.last_sync_status ? `<div style="font-size:0.68rem;color:${sfInfo.last_sync_status === 'success' ? '#059669' : '#dc2626'};margin-top:1px;">${sfInfo.last_sync_status === 'success' ? '✓ Succeeded' : '✗ ' + sfInfo.last_sync_status}</div>` : ''}
                                            </div>
                                        </div>
                                        ${sfInfo.records_synced_last_run > 0 ? `
                                        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#eff6ff;">
                                            <span style="font-size:0.78rem;color:#2563eb;">📋 Records Last Run</span>
                                            <span style="font-size:0.78rem;font-weight:600;color:#2563eb;">${sfInfo.records_synced_last_run.toLocaleString()}</span>
                                        </div>` : ''}
                                    </div>

                                    <!-- Action Buttons (Super Admin only) -->
                                    ${isSuperAdmin ? `
                                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
                                        <button id="settings-sync-btn" style="padding:10px;border-radius:10px;border:1px solid #e4e4e7;background:#fff;font-size:0.82rem;font-weight:600;color:#475569;cursor:pointer;transition:all 0.2s;">🔄 Sync Now</button>
                                        <button id="sf-disconnect-btn" style="padding:10px;border-radius:10px;border:1px solid #fecaca;background:#fef2f2;font-size:0.82rem;font-weight:600;color:#dc2626;cursor:pointer;transition:all 0.2s;">🔌 Disconnect</button>
                                    </div>

                                    <!-- Update Credentials Toggle -->
                                    <button id="sf-show-override-btn" style="width:100%;padding:10px;border-radius:10px;border:1px solid #e4e4e7;background:#f8fafc;font-size:0.78rem;color:#71717a;cursor:pointer;transition:all 0.2s;">
                                        🔄 ${sfInfo.source === 'ui' ? 'Update Portal Credentials' : 'Switch to Portal Credentials'}
                                    </button>
                                    <div id="sf-override-form" style="display:none;margin-top:16px;">
                                        <p style="font-size:0.78rem;color:#71717a;margin-bottom:12px;padding:10px 14px;background:#f0f9ff;border-radius:8px;border-left:3px solid #0176d3;">
                                            ${sfInfo.source === 'ui' ? 'Update your stored credentials below.' : 'Enter new credentials to override the environment variable connection.'}
                                        </p>
                                        <div style="display:flex;flex-direction:column;gap:10px;">
                                            <div>
                                                <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Environment</label>
                                                <select id="sf-env-select" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;background:#fff;">
                                                    <option value="sandbox">🧪 Sandbox</option>
                                                    <option value="production">🚀 Production</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Username</label>
                                                <input type="text" id="sf-username" placeholder="user@company.com" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                            </div>
                                            <div>
                                                <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Password</label>
                                                <input type="password" id="sf-password" placeholder="••••••••" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                            </div>
                                            <div>
                                                <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Security Token <span style="color:#ef4444;">*</span></label>
                                                <input type="password" id="sf-token" placeholder="Your Salesforce security token" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                                <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">Salesforce → Settings → Reset Security Token</p>
                                            </div>
                                            <button class="btn btn-primary" id="sf-connect-btn" style="width:100%;border-radius:10px;padding:11px;font-weight:700;font-size:0.88rem;background:linear-gradient(135deg,#0176d3,#1b96ff);border:none;color:#fff;cursor:pointer;box-shadow:0 4px 14px rgba(1,118,211,0.3);">🔗 Connect to Salesforce</button>
                                            <div id="sf-connect-error" style="color:#ef4444;font-size:0.78rem;display:none;padding:10px 14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;"></div>
                                        </div>
                                    </div>
                                    ` : `
                                    <div style="padding:10px;border-radius:10px;background:#f0f9ff;border:1px solid #bae6fd;font-size:0.78rem;color:#0369a1;">
                                        🔒 Salesforce credentials are managed by your Super Admin.
                                    </div>
                                    `}
                                ` : `
                                    <!-- Not connected -->
                                    ${isSuperAdmin ? `
                                    <div style="text-align:center;padding:8px 0 16px;">
                                        <div style="width:52px;height:52px;background:linear-gradient(135deg,#f0f9ff,#dbeafe);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;border:1px solid #bae6fd;">
                                            <span style="font-size:1.5rem;">🔗</span>
                                        </div>
                                        <p style="font-size:0.85rem;font-weight:600;color:#18181b;margin-bottom:4px;">Connect Your Salesforce</p>
                                        <p style="font-size:0.78rem;color:#71717a;">Enter credentials to sync leads and data.</p>
                                    </div>
                                    <div style="display:flex;flex-direction:column;gap:10px;">
                                        <div>
                                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Environment</label>
                                            <select id="sf-env-select" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;background:#fff;">
                                                <option value="sandbox">🧪 Sandbox</option>
                                                <option value="production">🚀 Production</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Username</label>
                                            <input type="text" id="sf-username" placeholder="user@company.com" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                        </div>
                                        <div>
                                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Password</label>
                                            <input type="password" id="sf-password" placeholder="••••••••" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                        </div>
                                        <div>
                                            <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Security Token <span style="color:#ef4444;">*</span></label>
                                            <input type="password" id="sf-token" placeholder="Your Salesforce security token" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                            <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">Salesforce → Settings → Reset Security Token</p>
                                        </div>
                                        <button class="btn btn-primary" id="sf-connect-btn" style="width:100%;border-radius:10px;padding:11px;font-weight:700;font-size:0.88rem;background:linear-gradient(135deg,#0176d3,#1b96ff);border:none;color:#fff;cursor:pointer;box-shadow:0 4px 14px rgba(1,118,211,0.3);">🔗 Connect to Salesforce</button>
                                        <div id="sf-connect-error" style="color:#ef4444;font-size:0.78rem;display:none;padding:10px 14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;"></div>
                                    </div>
                                    ` : `
                                    <div style="text-align:center;padding:20px 0;">
                                        <div style="width:52px;height:52px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;border:1px solid #fde68a;">
                                            <span style="font-size:1.5rem;">🔌</span>
                                        </div>
                                        <p style="font-size:0.85rem;font-weight:600;color:#18181b;margin-bottom:4px;">Salesforce Not Connected</p>
                                        <p style="font-size:0.78rem;color:#71717a;margin-bottom:12px;">Contact your Super Admin to set up the Salesforce connection.</p>
                                        <div style="padding:10px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;font-size:0.78rem;color:#92400e;">
                                            🔒 Only Super Admins can configure Salesforce credentials.
                                        </div>
                                    </div>
                                    `}
                                `}
                            </div>
                        </div>

                        <!-- ── Data Summary Sidebar ──────────────────────── -->
                        <div style="display:flex;flex-direction:column;gap:20px;">
                            <div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                                <h3 style="font-size:0.9rem;font-weight:700;color:#18181b;margin:0 0 14px;">📊 Data Summary</h3>
                                <div style="display:flex;flex-direction:column;gap:6px;">
                                    <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#f8fafc;border-radius:8px;">
                                        <span style="font-size:0.78rem;color:#71717a;">Leads Loaded</span>
                                        <span style="font-size:0.85rem;font-weight:700;color:#18181b;">${stats.total}</span>
                                    </div>
                                    <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#f8fafc;border-radius:8px;">
                                        <span style="font-size:0.78rem;color:#71717a;">Lead Assigned</span>
                                        <span style="font-size:0.85rem;font-weight:700;color:#18181b;">${sc['Lead Assigned'] || 0}</span>
                                    </div>
                                    <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#eff6ff;border-radius:8px;">
                                        <span style="font-size:0.78rem;color:#2563eb;">Research</span>
                                        <span style="font-size:0.85rem;font-weight:700;color:#2563eb;">${sc['Research'] || 0}</span>
                                    </div>
                                    <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#f8fafc;border-radius:8px;">
                                        <span style="font-size:0.78rem;color:#71717a;">Calling</span>
                                        <span style="font-size:0.85rem;font-weight:700;color:#18181b;">${sc['Calling'] || 0}</span>
                                    </div>
                                    <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#f0fdf4;border-radius:8px;">
                                        <span style="font-size:0.78rem;color:#166534;">Meetings+</span>
                                        <span style="font-size:0.85rem;font-weight:700;color:#166534;">${(sc['Meeting Scheduled']||0)+(sc['1st Discovery Meeting']||0)+(sc['Discovery Complete']||0)+(sc['Demo Scheduled']||0)+(sc['Demo Done']||0)+(sc['Completed']||0)}</span>
                                    </div>
                                    <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#eff6ff;border-radius:8px;">
                                        <span style="font-size:0.78rem;color:#2563eb;">Demos Done</span>
                                        <span style="font-size:0.85rem;font-weight:700;color:#2563eb;">${(sc['Demo Done']||0)+(sc['Completed']||0)}</span>
                                    </div>
                                    <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#fef2f2;border-radius:8px;">
                                        <span style="font-size:0.78rem;color:#dc2626;">Disqualified</span>
                                        <span style="font-size:0.85rem;font-weight:700;color:#dc2626;">${sc['Disqualified'] || 0}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ═══ Nylas Email Configuration (Super Admin only) ═══ -->
                    ${isSuperAdmin ? `
                    <div id="nylas-config-card" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);grid-column:1/-1;margin-top:8px;">
                        <div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:20px 24px;display:flex;align-items:center;gap:14px;">
                            <div style="width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                                <span style="font-size:1.3rem;">📧</span>
                            </div>
                            <div style="flex:1;">
                                <div style="font-size:1rem;font-weight:700;color:#fff;">Nylas Email Integration</div>
                                <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);">Configure Nylas API credentials for email sending</div>
                            </div>
                            <span id="nylas-status-badge" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;background:rgba(255,255,255,0.15);color:#fff;">Loading...</span>
                        </div>
                        <div style="padding:20px 24px;">
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                                <div>
                                    <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Client ID</label>
                                    <input type="text" id="nylas-client-id" placeholder="Enter Nylas Client ID" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                </div>
                                <div>
                                    <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">API Key</label>
                                    <input type="password" id="nylas-api-key" placeholder="Enter Nylas API Key" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                    <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">🔒 Encrypted at rest (AES-256-GCM)</p>
                                </div>
                            </div>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                                <div>
                                    <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Redirect URI</label>
                                    <input type="text" id="nylas-redirect-uri" placeholder="https://your-domain.com/api/email/callback" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                    <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">Copy this to your Nylas dashboard → Callback URI</p>
                                </div>
                                <div>
                                    <label style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;display:block;margin-bottom:4px;">Webhook Secret</label>
                                    <input type="password" id="nylas-webhook-secret" placeholder="Enter Webhook Secret" style="width:100%;padding:9px 12px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
                                    <p style="font-size:0.68rem;color:#a1a1aa;margin-top:3px;">🔒 Used to validate incoming webhook signatures</p>
                                </div>
                            </div>
                            <div style="display:flex;gap:10px;">
                                <button id="nylas-save-btn" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(99,102,241,0.3);">💾 Save Configuration</button>
                                <button id="nylas-test-btn" style="padding:10px 20px;border-radius:10px;border:1px solid #e4e4e7;background:#fff;font-size:0.82rem;font-weight:600;color:#475569;cursor:pointer;">🧪 Test Connection</button>
                            </div>
                            <p style="font-size:0.68rem;color:#a1a1aa;margin-top:6px;">Save the configuration first, then Test Connection to confirm the stored key actually decrypts and works — a stale or mismatched key otherwise only surfaces when an SDR tries to connect their mailbox.</p>
                            <div id="nylas-config-error" style="color:#ef4444;font-size:0.78rem;display:none;padding:10px 14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;margin-top:12px;"></div>
                            <div id="nylas-config-success" style="color:#059669;font-size:0.78rem;display:none;padding:10px 14px;background:#ecfdf5;border-radius:8px;border:1px solid #a7f3d0;margin-top:12px;"></div>
                            <div id="nylas-test-result" style="font-size:0.78rem;display:none;padding:10px 14px;border-radius:8px;margin-top:12px;"></div>
                        </div>
                    </div>
                    ` : ''}

    </div>`;
}

/**
 * Bind all Connection + Nylas tab event handlers.
 */
export async function bindConnectionTab(container, renderSettings) {
    const settingsSyncBtn = document.getElementById('settings-sync-btn');
    if (settingsSyncBtn) {
        settingsSyncBtn.addEventListener('click', () => {
            const globalSync = document.getElementById('sync-btn');
            if (globalSync) globalSync.click();
        });
    }

    // Toggle override credential form
    const overrideBtn = document.getElementById('sf-show-override-btn');
    if (overrideBtn) {
        overrideBtn.addEventListener('click', () => {
            const form = document.getElementById('sf-override-form');
            if (form) {
                const isHidden = form.style.display === 'none';
                form.style.display = isHidden ? 'block' : 'none';
                overrideBtn.textContent = isHidden ? '✕ Cancel' : overrideBtn.dataset.origText;
                if (!overrideBtn.dataset.origText) overrideBtn.dataset.origText = overrideBtn.textContent;
            }
        });
        overrideBtn.dataset.origText = overrideBtn.textContent;
    }

    // SF Connect button
    const sfConnectBtn = document.getElementById('sf-connect-btn');
    if (sfConnectBtn) {
        sfConnectBtn.addEventListener('click', async () => {
            const errDiv = document.getElementById('sf-connect-error');
            const username = document.getElementById('sf-username').value.trim();
            const password = document.getElementById('sf-password').value;
            const token = document.getElementById('sf-token').value.trim();
            const environment = document.getElementById('sf-env-select').value;

            if (!username || !password || !token) {
                errDiv.textContent = 'Username, password, and security token are all required.';
                errDiv.style.display = 'block';
                return;
            }

            errDiv.style.display = 'none';
            sfConnectBtn.textContent = '⏳ Connecting...';
            sfConnectBtn.disabled = true;
            try {
                await connectSalesforce({ username, password, security_token: token, environment });
                renderSettings(container);
            } catch (e) {
                errDiv.textContent = e.message;
                errDiv.style.display = 'block';
                sfConnectBtn.textContent = '🔗 Connect to Salesforce';
                sfConnectBtn.disabled = false;
            }
        });
    }

    // SF Disconnect button
    const sfDisconnectBtn = document.getElementById('sf-disconnect-btn');
    if (sfDisconnectBtn) {
        sfDisconnectBtn.addEventListener('click', async () => {
            if (!confirm('Disconnect Salesforce? The system will fall back to environment variables if configured.')) return;
            sfDisconnectBtn.textContent = '⏳ Disconnecting...';
            sfDisconnectBtn.disabled = true;
            try {
                await disconnectSalesforce();
                renderSettings(container);
            } catch (e) {
                alert('Failed to disconnect: ' + e.message);
                sfDisconnectBtn.textContent = '🔌 Disconnect';
                sfDisconnectBtn.disabled = false;
            }
        });
    }

    // ── Nylas Config (Super Admin only) ────────────────────────────────────────
    if (isSuperAdmin) {
        const nylasStatusBadge = document.getElementById('nylas-status-badge');
        const NYLAS_SENTINEL = '••••••••';   // sentinel — means "not changed, keep existing"
        try {
            const nylasConf = await getNylasConfig();
            if (nylasConf.configured && nylasConf.is_active) {
                nylasStatusBadge.textContent = '● Configured';
                nylasStatusBadge.style.background = 'rgba(16,185,129,0.2)';
                nylasStatusBadge.style.color = '#fff';
                document.getElementById('nylas-client-id').value = nylasConf.client_id || '';
                document.getElementById('nylas-redirect-uri').value = nylasConf.redirect_uri || '';
                // Show masked dots in the value (not just placeholder) so the field looks filled in
                document.getElementById('nylas-api-key').value = NYLAS_SENTINEL;
                document.getElementById('nylas-api-key').placeholder = '••••••••  (saved)';
                if (nylasConf.has_webhook_secret) {
                    document.getElementById('nylas-webhook-secret').value = NYLAS_SENTINEL;
                    document.getElementById('nylas-webhook-secret').placeholder = '••••••••  (saved)';
                } else {
                    document.getElementById('nylas-webhook-secret').placeholder = 'Enter Webhook Secret';
                }
            } else {
                nylasStatusBadge.textContent = '● Not Configured';
                nylasStatusBadge.style.background = 'rgba(239,68,68,0.2)';
            }
        } catch (e) {
            if (nylasStatusBadge) { nylasStatusBadge.textContent = '● Not Configured'; nylasStatusBadge.style.background = 'rgba(239,68,68,0.2)'; }
        }

        const nylasSaveBtn = document.getElementById('nylas-save-btn');
        if (nylasSaveBtn) {
            nylasSaveBtn.addEventListener('click', async () => {
                const errDiv = document.getElementById('nylas-config-error');
                const okDiv = document.getElementById('nylas-config-success');
                errDiv.style.display = 'none';
                okDiv.style.display = 'none';

                const clientId = document.getElementById('nylas-client-id').value.trim();
                const rawApiKey = document.getElementById('nylas-api-key').value.trim();
                const redirectUri = document.getElementById('nylas-redirect-uri').value.trim();
                const rawWebhookSecret = document.getElementById('nylas-webhook-secret').value.trim();

                // Strip sentinel: if user didn't change the field, don't send it to backend
                const apiKey = rawApiKey === NYLAS_SENTINEL ? '' : rawApiKey;
                const webhookSecret = rawWebhookSecret === NYLAS_SENTINEL ? '' : rawWebhookSecret;

                if (!clientId || !apiKey) {
                    errDiv.textContent = 'Client ID and API Key are required.';
                    errDiv.style.display = 'block';
                    return;
                }

                nylasSaveBtn.textContent = '⏳ Saving...';
                nylasSaveBtn.disabled = true;
                try {
                    const result = await saveNylasConfig({ client_id: clientId, api_key: apiKey, redirect_uri: redirectUri, webhook_secret: webhookSecret });
                    if (result.message) {
                        okDiv.textContent = '✅ ' + result.message;
                        okDiv.style.display = 'block';
                        renderSettings(container);
                    } else {
                        errDiv.textContent = result.detail || 'Failed to save configuration.';
                        errDiv.style.display = 'block';
                    }
                } catch (e) {
                    errDiv.textContent = e.message || 'Failed to save configuration.';
                    errDiv.style.display = 'block';
                }
                nylasSaveBtn.textContent = '💾 Save Configuration';
                nylasSaveBtn.disabled = false;
            });
        }

        const nylasTestBtn = document.getElementById('nylas-test-btn');
        if (nylasTestBtn) {
            nylasTestBtn.addEventListener('click', async () => {
                const resultDiv = document.getElementById('nylas-test-result');
                nylasTestBtn.textContent = '⏳ Testing...';
                nylasTestBtn.disabled = true;
                try {
                    const result = await testNylasConnection();
                    const reachable = result?.checks?.api_reachable;
                    const ok = !!(reachable && reachable.ok);
                    resultDiv.textContent = reachable
                        ? reachable.message
                        : (result?.message || result?.checks?.api_key_present?.message || 'Could not run the test — save a configuration first.');
                    resultDiv.style.display = 'block';
                    resultDiv.style.color = ok ? '#059669' : '#ef4444';
                    resultDiv.style.background = ok ? '#ecfdf5' : '#fef2f2';
                    resultDiv.style.border = `1px solid ${ok ? '#a7f3d0' : '#fecaca'}`;
                } catch (e) {
                    resultDiv.textContent = 'Connection test failed to run.';
                    resultDiv.style.display = 'block';
                    resultDiv.style.color = '#ef4444';
                    resultDiv.style.background = '#fef2f2';
                    resultDiv.style.border = '1px solid #fecaca';
                }
                nylasTestBtn.textContent = '🧪 Test Connection';
                nylasTestBtn.disabled = false;
            });
        }
    }
}
