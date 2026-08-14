// ── views/lead_messaging_tab.js — RCM conversation component ───────────
import { fetchMessagingConfig } from '../api.js';

/**
 * Load the Conversations tab content for a lead.
 * Flow: Get config (backend does server-side auth) → Load iframe with embedded tokens.
 * Note: The refresh_token has a 2000+ year lifespan — RCM's iframe JS
 * handles token renewal internally, so no client-side refresh timer is needed.
 */
export async function loadMessagingTab(leadId) {
    const container = document.getElementById('messaging-tab-content');
    if (!container) return;

    container.innerHTML = `
        <div style="padding:40px 0;text-align:center;color:var(--text-muted);">
            <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
            <h3 style="font-size:1rem;font-weight:600;color:var(--text-main);margin-bottom:6px;">Loading conversation...</h3>
            <p style="font-size:0.78rem;color:var(--text-muted);">Syncing with Audience Manager...</p>
        </div>`;

    try {
        const config = await fetchMessagingConfig(leadId);

        if (!config.enabled) {
            container.innerHTML = `
                <div style="padding:40px 0;text-align:center;">
                    <div style="font-size:2.5rem;margin-bottom:12px;">💬</div>
                    <h3 style="font-size:1rem;font-weight:600;color:var(--text-main);margin-bottom:6px;">Conversations Not Configured</h3>
                    <p style="font-size:0.82rem;color:var(--text-muted);max-width:400px;margin:0 auto;">${config.reason || 'Please configure RCM in Settings → Conversations.'}</p>
                </div>`;
            return;
        }

        if (!config.has_phone) {
            container.innerHTML = `
                <div style="padding:40px 0;text-align:center;">
                    <div style="font-size:2.5rem;margin-bottom:12px;">📱</div>
                    <h3 style="font-size:1rem;font-weight:600;color:var(--text-main);margin-bottom:6px;">No Phone Number</h3>
                    <p style="font-size:0.82rem;color:var(--text-muted);">This lead doesn't have a phone number. Add one to enable conversation.</p>
                </div>`;
            return;
        }

        if (!config.synced) {
            container.innerHTML = `
                <div style="padding:40px 0;text-align:center;">
                    <div style="font-size:2.5rem;margin-bottom:12px;">🔄</div>
                    <h3 style="font-size:1rem;font-weight:600;color:var(--text-main);margin-bottom:6px;">Contact Not Synced</h3>
                    <p style="font-size:0.82rem;color:var(--text-muted);max-width:400px;margin:0 auto 16px;">${config.reason || 'The contact could not be synced to Audience Manager.'}</p>
                    <button id="conv-retry-btn" style="padding:8px 20px;border-radius:8px;border:none;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;">🔄 Retry Sync</button>
                </div>`;
            document.getElementById('conv-retry-btn')?.addEventListener('click', () => loadMessagingTab(leadId));
            return;
        }

        // Build auth warning banner if server-side auth failed
        const authWarning = !config.auth_ok ? `
            <div id="conv-auth-warning" style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:#fffbeb;border:1px solid #fde68a;border-bottom:none;border-radius:12px 12px 0 0;">
                <span style="font-size:1rem;">⚠️</span>
                <div style="flex:1;">
                    <span style="font-size:0.78rem;font-weight:600;color:#92400e;">Authentication issue</span>
                    <span style="font-size:0.72rem;color:#b45309;margin-left:6px;">${config.auth_error || 'Session tokens could not be loaded. Messages may not display.'}</span>
                </div>
                <button id="conv-auth-retry-btn" style="padding:4px 12px;border-radius:6px;border:1px solid #fde68a;background:#fef3c7;font-size:0.72rem;font-weight:600;cursor:pointer;color:#92400e;white-space:nowrap;">🔄 Retry</button>
            </div>` : '';

        const headerRadius = !config.auth_ok ? 'border-radius:0;' : 'border-radius:12px 12px 0 0;';
        const wrapperRadius = !config.auth_ok ? 'border-radius:0 0 12px 12px;' : 'border-radius:12px;';

        container.innerHTML = `
            <div style="${wrapperRadius}overflow:hidden;border:1px solid #e4e4e7;background:#fff;">
                ${authWarning}
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e4e4e7;${headerRadius}">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:1.1rem;">💬</span>
                        <span style="font-size:0.82rem;font-weight:600;color:#18181b;">Conversations</span>
                        <span style="font-size:0.68rem;color:#059669;background:#ecfdf5;padding:2px 8px;border-radius:10px;">● Synced</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:0.72rem;color:#71717a;">📱 ${config.phone}</span>
                        <button id="conv-refresh-btn" style="background:none;border:1px solid #e4e4e7;border-radius:6px;padding:4px 10px;font-size:0.72rem;cursor:pointer;color:#71717a;" title="Refresh">🔄 Refresh</button>
                        <button id="conv-fullscreen-btn" style="background:none;border:1px solid #e4e4e7;border-radius:6px;padding:4px 10px;font-size:0.72rem;cursor:pointer;color:#71717a;" title="Open in new window">↗️ Open</button>
                    </div>
                </div>
                <iframe
                    id="rcm-iframe"
                    src="${config.iframe_url}"
                    style="width:100%;height:500px;border:none;display:block;"
                    allow="geolocation; microphone; camera; midi; encrypted-media; clipboard-write"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation"
                ></iframe>
            </div>`;

        // Auth retry button (re-fetches config with fresh tokens)
        document.getElementById('conv-auth-retry-btn')?.addEventListener('click', () => loadMessagingTab(leadId));

        // Refresh button
        document.getElementById('conv-refresh-btn')?.addEventListener('click', () => loadMessagingTab(leadId));

        // Open in new window button
        document.getElementById('conv-fullscreen-btn')?.addEventListener('click', () => {
            window.open(config.iframe_url, '_blank', 'width=800,height=700');
        });

        // Listen for iframe load errors
        const iframe = document.getElementById('rcm-iframe');
        if (iframe) {
            iframe.addEventListener('error', () => {
                console.error('[Conversation] iframe failed to load');
                _showIframeError(container, leadId);
            });

            // Fallback: if iframe loads but RCM returns an error page,
            // we can't detect cross-origin content, but we can catch network-level failures
            iframe.addEventListener('load', () => {
                console.log('[Conversation] iframe loaded successfully');
            });
        }

    } catch (err) {
        console.error('[Conversation] Failed to load:', err);
        container.innerHTML = `
            <div style="padding:40px 0;text-align:center;">
                <div style="font-size:2.5rem;margin-bottom:12px;">⚠️</div>
                <h3 style="font-size:1rem;font-weight:600;color:#ef4444;margin-bottom:6px;">Failed to Load Conversations</h3>
                <p style="font-size:0.82rem;color:var(--text-muted);">${err.message || 'An unexpected error occurred.'}</p>
                <button id="conv-retry-err-btn" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid #e4e4e7;background:#fff;font-size:0.82rem;cursor:pointer;">🔄 Retry</button>
            </div>`;
        document.getElementById('conv-retry-err-btn')?.addEventListener('click', () => loadMessagingTab(leadId));
    }
}

/**
 * Show an error state inside the iframe container when the iframe fails to load.
 */
function _showIframeError(container, leadId) {
    const iframe = container.querySelector('#rcm-iframe');
    if (iframe) {
        iframe.style.display = 'none';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'padding:40px 0;text-align:center;background:#fff;';
        errDiv.innerHTML = `
            <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
            <h3 style="font-size:0.92rem;font-weight:600;color:#ef4444;margin-bottom:6px;">Conversations Failed to Load</h3>
            <p style="font-size:0.78rem;color:var(--text-muted);max-width:360px;margin:0 auto 12px;">The RCM service could not be reached. This may be a temporary network issue.</p>
            <button id="conv-iframe-retry-btn" style="padding:8px 20px;border-radius:8px;border:none;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;">🔄 Try Again</button>`;
        iframe.parentElement.appendChild(errDiv);
        document.getElementById('conv-iframe-retry-btn')?.addEventListener('click', () => loadMessagingTab(leadId));
    }
}
