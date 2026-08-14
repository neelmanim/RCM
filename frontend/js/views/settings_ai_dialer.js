// ── views/settings_ai_dialer.js — AI Settings + Dialer config handlers ────────
import { isSuperAdmin, API_BASE } from '../auth.js';
import { patchSyncSettings, fetchDialerConfig, saveDialerConfig, testDialerConnection, testKlentyConnection, fetchSdrDialerConfigs, patchUserSettings } from '../api.js';

/**
 * Bind AI Settings + Dialer tab event handlers.
 * @param {object} currentSettings — loaded sync settings (for initial values)
 * @param {HTMLElement} container
 * @param {Function} renderSettings — re-render callback
 */
export async function bindAiDialerTab(container, currentSettings, renderSettings) {
    const llmProviderSelect = document.getElementById('llm-provider-select');
    const llmApiKeyInput = document.getElementById('llm-api-key-input');
    const llmModelInput = document.getElementById('llm-model-input');
    const saveLlmBtn = document.getElementById('save-llm-btn');

    if (llmProviderSelect && llmApiKeyInput && saveLlmBtn) {
        // Load current values from sync settings
        if (currentSettings.llm_provider) llmProviderSelect.value = currentSettings.llm_provider;
        if (currentSettings.llm_model) llmModelInput.value = currentSettings.llm_model;

        // Show masked key status
        const keyStatusEl = document.getElementById('llm-key-status');
        if (currentSettings.llm_api_key && currentSettings.llm_api_key !== '') {
            llmApiKeyInput.placeholder = currentSettings.llm_api_key;
            keyStatusEl.innerHTML = '✅ <span style="color:#059669;font-weight:600;">API key configured</span>';
        }

        // Toggle show/hide key
        const keyToggle = document.getElementById('llm-key-toggle');
        if (keyToggle) {
            keyToggle.addEventListener('click', () => {
                const isPassword = llmApiKeyInput.type === 'password';
                llmApiKeyInput.type = isPassword ? 'text' : 'password';
                keyToggle.textContent = isPassword ? '🙈' : '👁️';
            });
        }

        // Save handler
        saveLlmBtn.addEventListener('click', async () => {
            saveLlmBtn.disabled = true;
            saveLlmBtn.textContent = '⏳ Saving...';
            const statusEl = document.getElementById('llm-save-status');

            try {
                const payload = {
                    llm_provider: llmProviderSelect.value,
                    llm_model: llmModelInput.value || 'llama-3.3-70b-versatile',
                };

                const newKey = llmApiKeyInput.value.trim();
                // Only send API key if user typed a new one
                if (newKey) {
                    payload.llm_api_key = newKey;
                }

                const result = await patchSyncSettings(payload);

                // Update status — key was saved if we sent one OR server confirms one exists
                const savedKey = result.llm_api_key || '';
                if (newKey || savedKey) {
                    llmApiKeyInput.value = '';
                    llmApiKeyInput.placeholder = savedKey || newKey.slice(0, 8) + '••••';
                    keyStatusEl.innerHTML = '✅ <span style="color:#059669;font-weight:600;">API key configured</span>';
                }

                statusEl.textContent = '✅ Saved!';
                statusEl.style.color = '#059669';
                setTimeout(() => { statusEl.textContent = ''; }, 3000);
            } catch (e) {
                statusEl.textContent = '❌ ' + (e.message || 'Save failed');
                statusEl.style.color = '#dc2626';
            } finally {
                saveLlmBtn.disabled = false;
                saveLlmBtn.textContent = '💾 Save AI Settings';
            }
        });
    }

    // ── Research Prompt Editor ─────────────────────────────────────────────
    const DEFAULT_PROMPT = `You are an expert SDR (Sales Development Representative) researcher. Given the following lead information, research this company and contact to help prepare for a sales call.

Lead Information:
{lead_context}

Based on the available information, generate a research brief. Return ONLY a valid JSON object with these exact keys:

{
  "research_company": "One clear sentence about what this company does and their value proposition",
  "research_industry": "Pick exactly ONE from: SaaS, Healthcare, Finance, Retail, Manufacturing, Real Estate, Education, Other",
  "research_company_size": "Pick exactly ONE from: 1–50, 51–200, 201–1000, 1000+",
  "research_services": "Key products or services they offer (keep under 100 chars)",
  "research_geo": "Geographic regions they operate in or serve",
  "research_timezone": "Pick exactly ONE from: IST, EST, PST, GMT, CST, AEST, Other",
  "research_hook": "A compelling, personalized opening line for a cold call to this contact (reference something specific about their company or role)",
  "research_hypothesis": "2-3 sentences: Why this contact would benefit from a CRM/lead enrichment solution. What pain points might they have?",
  "research_personalization": "One specific observation about this person or company that shows you've done your homework",
  "research_contact": "Role context: Is this person a decision maker? What's their likely influence in buying decisions?",
  "research_channels": "Pick likely engagement channels, comma-separated from: Website Chat, WhatsApp, Social Media, Phone/Calling, In-Person, Email, Chatbot"
}

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation, no code fences.`;

    const promptTextarea   = document.getElementById('research-prompt-textarea');
    const savePromptBtn    = document.getElementById('save-prompt-btn');
    const resetPromptBtn   = document.getElementById('reset-prompt-btn');
    const promptCharCount  = document.getElementById('prompt-char-count');
    const promptStatusBadge = document.getElementById('prompt-status-badge');
    const promptSaveStatus = document.getElementById('prompt-save-status');
    const defaultPreview   = document.getElementById('default-prompt-preview');
    const varChips         = document.querySelectorAll('.prompt-var-chip');

    if (promptTextarea) {
        // Populate default preview
        if (defaultPreview) defaultPreview.textContent = DEFAULT_PROMPT;

        // Load stored custom prompt
        const storedPrompt = (currentSettings.research_prompt || '').trim();
        promptTextarea.value = storedPrompt;
        _updatePromptBadge(storedPrompt);
        _updateCharCount(storedPrompt);

        // Live char count
        promptTextarea.addEventListener('input', () => {
            _updateCharCount(promptTextarea.value);
        });

        // Click chip to insert {lead_context} at cursor
        varChips.forEach(chip => {
            chip.addEventListener('click', () => {
                const varText = chip.textContent;
                const start = promptTextarea.selectionStart;
                const end   = promptTextarea.selectionEnd;
                const before = promptTextarea.value.slice(0, start);
                const after  = promptTextarea.value.slice(end);
                promptTextarea.value = before + varText + after;
                promptTextarea.selectionStart = promptTextarea.selectionEnd = start + varText.length;
                promptTextarea.focus();
                _updateCharCount(promptTextarea.value);
            });
        });

        // Save prompt
        if (savePromptBtn) {
            savePromptBtn.addEventListener('click', async () => {
                savePromptBtn.disabled = true;
                savePromptBtn.textContent = '⏳ Saving...';
                try {
                    const val = promptTextarea.value.trim();
                    await patchSyncSettings({ research_prompt: val });
                    _updatePromptBadge(val);
                    promptSaveStatus.textContent = '✅ Prompt saved!';
                    promptSaveStatus.style.color = '#059669';
                    setTimeout(() => { promptSaveStatus.textContent = ''; }, 3000);
                } catch (e) {
                    promptSaveStatus.textContent = '❌ ' + (e.message || 'Save failed');
                    promptSaveStatus.style.color = '#dc2626';
                } finally {
                    savePromptBtn.disabled = false;
                    savePromptBtn.textContent = '💾 Save Prompt';
                }
            });
        }

        // Reset to default (clears stored prompt → sends empty string → backend stores NULL)
        if (resetPromptBtn) {
            resetPromptBtn.addEventListener('click', async () => {
                if (!confirm('Reset to the built-in default prompt? Your custom prompt will be deleted.')) return;
                resetPromptBtn.disabled = true;
                resetPromptBtn.textContent = '⏳ Resetting...';
                try {
                    await patchSyncSettings({ research_prompt: '' });
                    promptTextarea.value = '';
                    _updateCharCount('');
                    _updatePromptBadge('');
                    promptSaveStatus.textContent = '✅ Reset to default!';
                    promptSaveStatus.style.color = '#059669';
                    setTimeout(() => { promptSaveStatus.textContent = ''; }, 3000);
                } catch (e) {
                    promptSaveStatus.textContent = '❌ ' + (e.message || 'Reset failed');
                    promptSaveStatus.style.color = '#dc2626';
                } finally {
                    resetPromptBtn.disabled = false;
                    resetPromptBtn.textContent = '↩ Reset to Default';
                }
            });
        }
    }

    // ── Research Gate Toggle (V40) ────────────────────────────────────────────
    // Admin-controlled: when ON, SDRs must complete research before moving to Calling
    const gateToggle = document.getElementById('require-research-toggle');
    const gateStatus = document.getElementById('research-gate-save-status');
    if (gateToggle) {
        // Initialise from current settings
        gateToggle.checked = !!(currentSettings.require_research_before_calling);
        _updateGateLabel(gateToggle.checked);

        gateToggle.addEventListener('change', async () => {
            const enabled = gateToggle.checked;
            _updateGateLabel(enabled);
            if (gateStatus) { gateStatus.textContent = '⏳ Saving...'; gateStatus.style.color = '#a1a1aa'; }
            try {
                await patchSyncSettings({ require_research_before_calling: enabled });
                if (gateStatus) {
                    gateStatus.textContent = enabled
                        ? '✅ Gate enabled — SDRs must complete research before calling'
                        : '✅ Gate disabled — SDRs can call without research';
                    gateStatus.style.color = '#059669';
                    setTimeout(() => { if (gateStatus) gateStatus.textContent = ''; }, 3500);
                }
            } catch (e) {
                // Revert toggle on error
                gateToggle.checked = !enabled;
                _updateGateLabel(!enabled);
                if (gateStatus) { gateStatus.textContent = '❌ ' + (e.message || 'Save failed'); gateStatus.style.color = '#dc2626'; }
            }
        });
    }

    function _updateGateLabel(enabled) {
        const label = document.getElementById('research-gate-label');
        if (!label) return;
        label.textContent = enabled
            ? '🔒 Research Required Before Calling (Gate ON)'
            : '🔓 Research Optional — SDRs Can Call Freely (Gate OFF)';
        label.style.color = enabled ? '#dc2626' : '#059669';
    }

    // ── Bulk Research Pre-Population ─────────────────────────────────────────
    const bulkResearchBtn = document.getElementById('bulk-research-btn');
    const bulkResearchStatus = document.getElementById('bulk-research-status');

    // On every page load: check if a job is currently running and update UI
    if (bulkResearchBtn) {
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/admin/bulk-research/status`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('crm_token') || ''}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.running) {
                        // Job already running — show running state
                        bulkResearchBtn.disabled = true;
                        bulkResearchBtn.textContent = '✅ Running in Background';
                        bulkResearchBtn.style.background = 'linear-gradient(135deg,#059669,#10b981)';
                        const s = data.stats || {};
                        if (bulkResearchStatus) {
                            bulkResearchStatus.textContent = s.processed > 0
                                ? `⚙️ In progress: ${s.processed.toLocaleString()} processed, ${s.failed} failed of ${s.total.toLocaleString()} leads.`
                                : '⚙️ Job is starting up…';
                            bulkResearchStatus.style.color = '#059669';
                        }
                    } else {
                        // Not running — ensure button is in default clickable state
                        bulkResearchBtn.disabled = false;
                        bulkResearchBtn.textContent = '🚀 Start Bulk Research';
                        bulkResearchBtn.style.background = 'linear-gradient(135deg,#7c3aed,#a855f7)';
                        if (bulkResearchStatus) bulkResearchStatus.textContent = '';
                    }
                }
            } catch (_) { /* silently ignore — button stays in default state */ }
        })();
    }

    if (bulkResearchBtn) {
        bulkResearchBtn.addEventListener('click', async () => {
            const podSelect = document.getElementById('bulk-research-pod-select');
            const podId = podSelect ? podSelect.value : '';
            const podLabel = podSelect ? podSelect.options[podSelect.selectedIndex]?.text : 'All Pods';

            bulkResearchBtn.disabled = true;
            bulkResearchBtn.textContent = '⏳ Starting...';
            if (bulkResearchStatus) { bulkResearchStatus.textContent = ''; }

            try {
                const url = podId
                    ? `${API_BASE}/api/admin/bulk-research?pod_id=${encodeURIComponent(podId)}`
                    : `${API_BASE}/api/admin/bulk-research`;

                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('crm_token') || ''}`,
                    },
                });
                const rawText = await res.text();
                let data = {};
                try { data = rawText ? JSON.parse(rawText) : {}; } catch (_) {}
                // 502/503 = Render is still deploying — server not ready yet
                if (res.status === 502 || res.status === 503 || (!rawText && !res.ok)) {
                    bulkResearchBtn.disabled = false;
                    bulkResearchBtn.textContent = '🚀 Start Bulk Research';
                    if (bulkResearchStatus) {
                        bulkResearchStatus.textContent = '⚠️ Server is starting up — wait ~1 minute and try again.';
                        bulkResearchStatus.style.color = '#d97706';
                    }
                    return;
                }

                if (res.status === 409 || (data && data.detail && data.detail.toLowerCase().includes('already running'))) {
                    bulkResearchBtn.textContent = '⏳ Already Running';
                    bulkResearchBtn.style.background = 'linear-gradient(135deg,#d97706,#f59e0b)';
                    if (bulkResearchStatus) {
                        bulkResearchStatus.textContent = '⚠️ A bulk research job is already in progress. Check back later.';
                        bulkResearchStatus.style.color = '#d97706';
                    }
                    return;
                }

                if (!res.ok) {
                    throw new Error(data?.detail || `Server error ${res.status}`);
                }

                // Success
                bulkResearchBtn.textContent = '✅ Running in Background';
                bulkResearchBtn.style.background = 'linear-gradient(135deg,#059669,#10b981)';
                if (bulkResearchStatus) {
                    const willProcess = data?.will_process ?? data?.total_leads ?? '';
                    const podInfo = podId ? ` for ${podLabel}` : '';
                    bulkResearchStatus.textContent = willProcess !== ''
                        ? `🚀 Job started${podInfo} — ${Number(willProcess).toLocaleString()} leads queued. Runs in background, safe to close this page.`
                        : `🚀 Job started${podInfo}. Runs in background — safe to close this page.`;
                    bulkResearchStatus.style.color = '#059669';
                }
            } catch (e) {
                bulkResearchBtn.disabled = false;
                bulkResearchBtn.textContent = '🚀 Start Bulk Research';
                bulkResearchBtn.style.background = '';
                if (bulkResearchStatus) {
                    bulkResearchStatus.textContent = '❌ ' + (e.message || 'Failed to start bulk research');
                    bulkResearchStatus.style.color = '#dc2626';
                }
            }
        });
    }


    function _updateCharCount(val) {
        if (!promptCharCount) return;
        const len = (val || '').length;
        promptCharCount.textContent = `${len.toLocaleString()} char${len !== 1 ? 's' : ''}`;
        promptCharCount.style.color = len > 4000 ? '#dc2626' : '#a1a1aa';
    }


    function _updatePromptBadge(val) {
        if (!promptStatusBadge) return;
        const isCustom = val && val.trim().length > 0;
        promptStatusBadge.textContent = isCustom ? '✨ Custom' : 'Default';
        promptStatusBadge.style.background = isCustom
            ? 'rgba(255,255,255,0.25)'
            : 'rgba(255,255,255,0.12)';
    }

    // ── Dialer Settings tab logic ─────────────────────────────────────────
    if (isSuperAdmin) {
        const dialerProviderSelect = document.getElementById('dialer-provider-select');
        const dialerCredsSection = document.getElementById('dialer-credentials-section');
        const dialerStatusBadge = document.getElementById('dialer-status-badge');
        const dialerSaveBtn = document.getElementById('dialer-save-btn');
        const dialerTestBtn = document.getElementById('dialer-test-btn');
        const dialerWebhookUrl = document.getElementById('dialer-webhook-url');

        // Webhook URL is set dynamically in _toggleDialerCreds()

        // Toggle credentials section shown/hidden based on provider
        function _toggleDialerCreds() {
            const provider = dialerProviderSelect ? dialerProviderSelect.value : 'none';
            const isAircall = provider === 'aircall';
            if (dialerCredsSection) dialerCredsSection.style.display = isAircall ? 'block' : 'none';
            if (dialerTestBtn) dialerTestBtn.style.display = isAircall ? 'inline-block' : 'none';

            // Webhook URL only relevant for Aircall
            const webhookSection = document.getElementById('dialer-webhook-section');
            if (webhookSection) webhookSection.style.display = isAircall ? 'block' : 'none';
            if (dialerWebhookUrl && isAircall) {
                const baseUrl = (window.__APP_CONFIG__ && window.__APP_CONFIG__.API_BASE)
                    ? window.__APP_CONFIG__.API_BASE
                    : window.location.origin;
                dialerWebhookUrl.textContent = `${baseUrl}/api/webhooks/dialer`;
            }
        }

        if (dialerProviderSelect) {
            dialerProviderSelect.addEventListener('change', _toggleDialerCreds);
        }

        // ── Klenty Sync elements (temporary bridging integration) ──────────
        const klentyToggle = document.getElementById('klenty-enabled-toggle');
        const klentyTrack = document.getElementById('klenty-toggle-track');
        const klentyStatusBadge = document.getElementById('klenty-status-badge');
        const klentySaveBtn = document.getElementById('klenty-save-btn');

        function _paintKlentyToggle() {
            if (!klentyToggle || !klentyTrack) return;
            klentyTrack.style.background = klentyToggle.checked ? '#4338ca' : '#e4e4e7';
            let knob = klentyTrack.querySelector('span');
            if (!knob) {
                knob = document.createElement('span');
                knob.style.cssText = 'position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:0.2s;box-shadow:0 1px 2px rgba(0,0,0,0.2);';
                klentyTrack.appendChild(knob);
            }
            knob.style.transform = klentyToggle.checked ? 'translateX(20px)' : 'translateX(0)';
        }

        if (klentyToggle) {
            klentyToggle.addEventListener('change', _paintKlentyToggle);
        }

        // Load existing dialer + Klenty config (single fetch, shared response)
        try {
            const dialerConf = await fetchDialerConfig();
            if (dialerProviderSelect) dialerProviderSelect.value = dialerConf.provider || 'none';
            if (dialerConf.api_id) {
                const apiIdInput = document.getElementById('dialer-api-id');
                if (apiIdInput) apiIdInput.value = dialerConf.api_id;
            }
            if (dialerConf.has_credentials) {
                const tokenInput = document.getElementById('dialer-api-token');
                if (tokenInput) tokenInput.placeholder = '••••••••  (saved)';
            }
            // V48: Aircall Everywhere kill switch
            const everywhereToggle = document.getElementById('dialer-aircall-everywhere-toggle');
            if (everywhereToggle) everywhereToggle.checked = !!dialerConf.aircall_everywhere_enabled;
            // Pre-fill credential mode (no longer used — kept for compatibility)
            // Pre-fill Default Caller ID is now in the RCM tab
            _toggleDialerCreds();

            // Item 4: Update status badge — check correct credential set per provider
            if (dialerStatusBadge) {
                const provider = dialerConf.provider || 'none';
                const hasAircallCreds = dialerConf.has_credentials;
                const hasRCMCreds = dialerConf.has_rcm_credentials;
                const hasCreds = provider === 'rcm' ? hasRCMCreds : hasAircallCreds;

                if (provider !== 'none' && hasCreds) {
                    dialerStatusBadge.textContent = '● Connected';
                    dialerStatusBadge.style.background = 'rgba(16,185,129,0.2)';
                } else if (provider !== 'none') {
                    dialerStatusBadge.textContent = '● Credentials Missing';
                    dialerStatusBadge.style.background = 'rgba(245,158,11,0.2)';
                } else {
                    dialerStatusBadge.textContent = '● Not Configured';
                    dialerStatusBadge.style.background = 'rgba(239,68,68,0.2)';
                }
            }

            // Klenty section (shares this same config response)
            if (klentyToggle) klentyToggle.checked = !!dialerConf.klenty_enabled;
            _paintKlentyToggle();

            const klentyApiKeyInput = document.getElementById('klenty-api-key');
            if (klentyApiKeyInput && dialerConf.has_klenty_credentials) {
                klentyApiKeyInput.placeholder = '••••••••  (saved)';
            }

            const lastSyncEl = document.getElementById('klenty-last-sync');
            if (lastSyncEl) {
                lastSyncEl.textContent = dialerConf.klenty_last_sync_at
                    ? `Last synced: ${new Date(dialerConf.klenty_last_sync_at).toLocaleString()}`
                    : '';
            }

            if (klentyStatusBadge) {
                if (dialerConf.klenty_enabled && dialerConf.has_klenty_credentials) {
                    klentyStatusBadge.textContent = '● Enabled';
                    klentyStatusBadge.style.background = 'rgba(16,185,129,0.2)';
                } else if (dialerConf.klenty_enabled) {
                    klentyStatusBadge.textContent = '● API Key Missing';
                    klentyStatusBadge.style.background = 'rgba(245,158,11,0.2)';
                } else {
                    klentyStatusBadge.textContent = '● Disabled';
                    klentyStatusBadge.style.background = 'rgba(255,255,255,0.15)';
                }
            }
        } catch (e) {
            if (dialerStatusBadge) {
                dialerStatusBadge.textContent = '● Not Configured';
                dialerStatusBadge.style.background = 'rgba(239,68,68,0.2)';
            }
            if (klentyStatusBadge) {
                klentyStatusBadge.textContent = '● Disabled';
                klentyStatusBadge.style.background = 'rgba(255,255,255,0.15)';
            }
            _toggleDialerCreds();
        }

        if (klentySaveBtn) {
            klentySaveBtn.addEventListener('click', async () => {
                const errDiv = document.getElementById('klenty-config-error');
                const okDiv = document.getElementById('klenty-config-success');
                errDiv.style.display = 'none';
                okDiv.style.display = 'none';

                const payload = { klenty_enabled: !!(klentyToggle && klentyToggle.checked) };
                const klentyApiKey = document.getElementById('klenty-api-key')?.value.trim();
                if (klentyApiKey) payload.klenty_api_key = klentyApiKey;

                klentySaveBtn.textContent = '⏳ Saving...';
                klentySaveBtn.disabled = true;
                try {
                    await saveDialerConfig(payload);
                    okDiv.textContent = '✅ Klenty sync configuration saved';
                    okDiv.style.display = 'block';
                    renderSettings(container);
                } catch (e) {
                    errDiv.textContent = e.message || 'Failed to save Klenty configuration.';
                    errDiv.style.display = 'block';
                }
                klentySaveBtn.textContent = '💾 Save Klenty Configuration';
                klentySaveBtn.disabled = false;
            });
        }

        const klentyTestBtn = document.getElementById('klenty-test-btn');
        if (klentyTestBtn) {
            klentyTestBtn.addEventListener('click', async () => {
                const resultDiv = document.getElementById('klenty-test-result');
                klentyTestBtn.textContent = '⏳ Testing...';
                klentyTestBtn.disabled = true;
                try {
                    const result = await testKlentyConnection();
                    const reachable = result?.checks?.api_reachable;
                    const ok = !!(reachable && reachable.ok);
                    resultDiv.textContent = reachable
                        ? reachable.message
                        : (result?.checks?.api_key_present?.message || 'Could not run the test — save an API key first.');
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
                klentyTestBtn.textContent = '🔌 Test Connection';
                klentyTestBtn.disabled = false;
            });
        }

        // Save dialer config
        if (dialerSaveBtn) {
            dialerSaveBtn.addEventListener('click', async () => {
                const errDiv = document.getElementById('dialer-config-error');
                const okDiv = document.getElementById('dialer-config-success');
                errDiv.style.display = 'none';
                okDiv.style.display = 'none';

                const provider = dialerProviderSelect.value;
                const apiId = document.getElementById('dialer-api-id')?.value.trim();
                const apiToken = document.getElementById('dialer-api-token')?.value.trim();

                const payload = { provider };
                if (apiId) payload.api_id = apiId;
                if (apiToken) payload.api_token = apiToken;
                // V48: Aircall Everywhere kill switch
                const everywhereToggle = document.getElementById('dialer-aircall-everywhere-toggle');
                if (everywhereToggle) payload.aircall_everywhere_enabled = everywhereToggle.checked;

                dialerSaveBtn.textContent = '⏳ Saving...';
                dialerSaveBtn.disabled = true;
                try {
                    await saveDialerConfig(payload);
                    okDiv.textContent = '✅ Dialer configuration saved successfully';
                    okDiv.style.display = 'block';
                    // Refresh to update badge
                    renderSettings(container);
                } catch (e) {
                    errDiv.textContent = e.message || 'Failed to save configuration.';
                    errDiv.style.display = 'block';
                }
                dialerSaveBtn.textContent = '💾 Save Configuration';
                dialerSaveBtn.disabled = false;
            });
        }

        // Test dialer connection (Aircall-specific)
        // Clear stale success/error banners whenever credential fields are edited
        ['dialer-api-id', 'dialer-api-token'].forEach(fieldId => {
            const el = document.getElementById(fieldId);
            if (el) el.addEventListener('input', () => {
                const errDiv = document.getElementById('dialer-config-error');
                const okDiv  = document.getElementById('dialer-config-success');
                if (errDiv) errDiv.style.display = 'none';
                if (okDiv)  okDiv.style.display  = 'none';
            });
        });

        if (dialerTestBtn) {
            dialerTestBtn.addEventListener('click', async () => {
                const errDiv = document.getElementById('dialer-config-error');
                const okDiv = document.getElementById('dialer-config-success');
                errDiv.style.display = 'none';
                okDiv.style.display = 'none';

                dialerTestBtn.textContent = '⏳ Testing...';
                dialerTestBtn.disabled = true;
                try {
                    const result = await testDialerConnection('aircall');
                    if (result.success) {
                        okDiv.textContent = `✅ ${result.message}`;
                        if (result.details) {
                            if (result.details.users_count !== undefined) {
                                okDiv.textContent += ` — ${result.details.users_count || 0} users, ${result.details.numbers_count || 0} numbers`;
                            } else if (result.details.total_calls !== undefined) {
                                okDiv.textContent += ` — ${result.details.total_calls} calls on record`;
                            }
                        }
                        okDiv.style.display = 'block';
                    } else {
                        errDiv.textContent = result.message || 'Connection test failed';
                        errDiv.style.display = 'block';
                    }
                } catch (e) {
                    errDiv.textContent = e.message || 'Connection test failed';
                    errDiv.style.display = 'block';
                }
                dialerTestBtn.textContent = '🧪 Test Connection';
                dialerTestBtn.disabled = false;
            });
        }
    }

    // ── RCM Dialer — Agent Assignments panel ───────────────────────
    if (isSuperAdmin) {
        const assignSection = document.getElementById('sdr-agent-assignments-section');
        const addFormRow   = document.getElementById('conv-add-form-row');
        const assignBtn    = document.getElementById('conv-assign-agent-btn');
        const cancelAddBtn = document.getElementById('conv-add-cancel-btn');
        const searchInput  = document.getElementById('conv-agent-search');

        // load & render list
        if (assignSection) await _loadAndRenderAgentList(assignSection);

        // toggle add form
        if (assignBtn) assignBtn.addEventListener('click', () => {
            if (addFormRow) {
                addFormRow.style.display = addFormRow.style.display === 'none' ? 'block' : 'none';
                if (addFormRow.style.display === 'block') _populateAddDropdown();
            }
        });
        if (cancelAddBtn) cancelAddBtn.addEventListener('click', () => {
            if (addFormRow) { addFormRow.style.display = 'none'; _clearAddForm(); }
        });

        // search
        if (searchInput) searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            document.querySelectorAll('.conv-agent-row').forEach(row => {
                const name  = (row.dataset.name  || '').toLowerCase();
                const email = (row.dataset.email || '').toLowerCase();
                row.style.display = (name.includes(q) || email.includes(q)) ? '' : 'none';
            });
        });

        // save new assignment
        const saveAddBtn = document.getElementById('conv-add-save-btn');
        if (saveAddBtn) {
            let _saving = false;
            saveAddBtn.addEventListener('click', async () => {
                if (_saving) return;
                const errDiv = document.getElementById('conv-add-form-error');
                errDiv.style.display = 'none';
                const userId = document.getElementById('conv-add-sdr-select')?.value;
                const uid    = document.getElementById('conv-add-user-id')?.value.trim();
                const phone  = document.getElementById('conv-add-phone')?.value.trim();
                const email  = document.getElementById('conv-add-email')?.value.trim().toLowerCase();
                if (!userId) { _showAddErr(errDiv, 'Please select an SDR.'); return; }
                if (!uid)    { _showAddErr(errDiv, 'RCM User ID is required.'); return; }
                _saving = true;
                saveAddBtn.textContent = '⏳';
                saveAddBtn.disabled = true;
                try {
                    const res  = await patchUserSettings(userId, {
                        rcm_user_id: uid,
                        rcm_from_number: phone || null,
                        rcm_email: email || null,
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
                    if (data.warning) _showAddErr(errDiv, `⚠️ ${data.warning}`, '#f59e0b');
                    if (assignSection) await _loadAndRenderAgentList(assignSection);
                    if (addFormRow)    { addFormRow.style.display = 'none'; _clearAddForm(); }
                } catch (e) {
                    _showAddErr(errDiv, e.message || 'Failed to save. Try again.');
                } finally {
                    _saving = false;
                    saveAddBtn.textContent = 'Assign';
                    saveAddBtn.disabled = false;
                }
            });
        }
    }

    // ── RCM / Messaging Settings tab logic ──────────────────────────
    if (isSuperAdmin) {
        const convEnableToggle = document.getElementById('rcm-enabled-toggle');
        const convBaseUrl = document.getElementById('rcm-base-url');
        const convApiKey = document.getElementById('rcm-api-key');
        const convUserId = document.getElementById('rcm-user-id');
        const convAccountId = document.getElementById('rcm-account-id');
        const convSenderId = document.getElementById('rcm-sender-id');
        const messagingProviderSelect = document.getElementById('messaging-provider-select');
        const aircallMessagingNumberId = document.getElementById('aircall-messaging-number-id');
        const sandboxTestPhoneNumber = document.getElementById('sandbox-test-phone-number');
        const convSaveBtn = document.getElementById('rcm-save-btn');
        const convTestBtn = document.getElementById('rcm-test-btn');
        const convClearBtn = document.getElementById('rcm-clear-btn');
        const convStatusBadge = document.getElementById('messaging-status-badge');

        // Load existing config from sync settings
        if (convEnableToggle) convEnableToggle.checked = !!currentSettings.rcm_enabled;
        if (convBaseUrl) convBaseUrl.value = currentSettings.rcm_base_url || 'https://app.bercm.com';
        if (convApiKey) convApiKey.value = currentSettings.rcm_api_key || '';
        if (convUserId) convUserId.value = currentSettings.rcm_user_id || '';
        if (convAccountId) convAccountId.value = currentSettings.rcm_account_id || '';
        if (convSenderId) convSenderId.value = currentSettings.rcm_sender_id || '';
        if (messagingProviderSelect) messagingProviderSelect.value = currentSettings.messaging_provider || 'rcm';
        if (aircallMessagingNumberId) aircallMessagingNumberId.value = currentSettings.aircall_messaging_number_id || '';
        if (sandboxTestPhoneNumber) sandboxTestPhoneNumber.value = currentSettings.sandbox_test_phone_number || '';

        // Update status badge
        if (convStatusBadge) {
            if (currentSettings.rcm_enabled && currentSettings.rcm_api_key && currentSettings.rcm_user_id) {
                convStatusBadge.textContent = '● Enabled';
                convStatusBadge.style.background = 'rgba(16,185,129,0.2)';
            } else if (currentSettings.rcm_enabled && currentSettings.rcm_api_key) {
                convStatusBadge.textContent = '● User ID Missing';
                convStatusBadge.style.background = 'rgba(245,158,11,0.2)';
            } else if (currentSettings.rcm_enabled) {
                convStatusBadge.textContent = '● API Key Missing';
                convStatusBadge.style.background = 'rgba(245,158,11,0.2)';
            } else {
                convStatusBadge.textContent = '● Disabled';
                convStatusBadge.style.background = 'rgba(239,68,68,0.2)';
            }
        }

        // Test RCM Messaging connection (independent of active dialer)
        if (convTestBtn) {
            convTestBtn.addEventListener('click', async () => {
                const errDiv = document.getElementById('rcm-config-error');
                const okDiv = document.getElementById('rcm-config-success');
                errDiv.style.display = 'none';
                okDiv.style.display = 'none';

                convTestBtn.textContent = '⏳ Testing...';
                convTestBtn.disabled = true;
                try {
                    const result = await testDialerConnection('rcm_messaging');
                    if (result.success) {
                        okDiv.textContent = `✅ ${result.message}`;
                        if (result.details?.total_calls !== undefined) {
                            okDiv.textContent += ` — ${result.details.total_calls} calls on record`;
                        }
                        okDiv.style.display = 'block';
                    } else {
                        errDiv.textContent = result.message || 'Connection test failed';
                        errDiv.style.display = 'block';
                    }
                } catch (e) {
                    errDiv.textContent = e.message || 'Connection test failed';
                    errDiv.style.display = 'block';
                }
                convTestBtn.textContent = '🧪 Test Connection';
                convTestBtn.disabled = false;
            });
        }

        // Clear stale banners whenever RCM credential fields are edited
        [convApiKey, convUserId, convBaseUrl, convAccountId, convSenderId].forEach(el => {
            if (!el) return;
            el.addEventListener('input', () => {
                const errDiv = document.getElementById('rcm-config-error');
                const okDiv  = document.getElementById('rcm-config-success');
                if (errDiv) errDiv.style.display = 'none';
                if (okDiv)  okDiv.style.display  = 'none';
            });
        });

        // Save handler
        if (convSaveBtn) {
            convSaveBtn.addEventListener('click', async () => {
                const errDiv = document.getElementById('rcm-config-error');
                const okDiv = document.getElementById('rcm-config-success');
                errDiv.style.display = 'none';
                okDiv.style.display = 'none';

                const payload = {
                    rcm_enabled: convEnableToggle?.checked || false,
                    rcm_base_url: convBaseUrl?.value.trim() || 'https://app.bercm.com',
                    rcm_api_key: convApiKey?.value.trim() || '',
                    rcm_user_id: convUserId?.value.trim() || '',
                    rcm_account_id: convAccountId?.value.trim() || '',
                    rcm_sender_id: convSenderId?.value.trim() || '',
                    messaging_provider: messagingProviderSelect?.value || 'rcm',
                    aircall_messaging_number_id: aircallMessagingNumberId?.value.trim() || '',
                    sandbox_test_phone_number: sandboxTestPhoneNumber?.value.trim() || '',
                };

                convSaveBtn.textContent = '⏳ Saving...';
                convSaveBtn.disabled = true;
                try {
                    await patchSyncSettings(payload);
                    okDiv.textContent = '✅ Conversations configuration saved successfully';
                    okDiv.style.display = 'block';
                    renderSettings(container);
                } catch (e) {
                    errDiv.textContent = e.message || 'Failed to save configuration.';
                    errDiv.style.display = 'block';
                }
                convSaveBtn.textContent = '💾 Save Configuration';
                convSaveBtn.disabled = false;
            });
        }

        // Clear credentials handler
        if (convClearBtn) {
            convClearBtn.addEventListener('click', async () => {
                if (!confirm('Clear all RCM credentials? This will disable the integration until re-configured.')) return;
                const errDiv = document.getElementById('rcm-config-error');
                const okDiv = document.getElementById('rcm-config-success');
                errDiv.style.display = 'none';
                okDiv.style.display = 'none';

                convClearBtn.textContent = '⏳ Clearing...';
                convClearBtn.disabled = true;
                try {
                    await patchSyncSettings({
                        rcm_enabled: false,
                        rcm_api_key: '',
                        rcm_user_id: '',
                        rcm_account_id: '',
                        rcm_sender_id: '',
                        clear_rcm_credentials: true,
                    });
                    okDiv.textContent = '✅ Credentials cleared successfully';
                    okDiv.style.display = 'block';
                    renderSettings(container);
                } catch (e) {
                    errDiv.textContent = e.message || 'Failed to clear credentials.';
                    errDiv.style.display = 'block';
                }
                convClearBtn.textContent = '🗑️ Clear Credentials';
                convClearBtn.disabled = false;
            });
        }
    }   // end if (isSuperAdmin) — RCM/Messaging

}


// ─────────────────────────────────────────────────────────────────────────────
// RCM Agent Assignments — helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch all SDRs then render only configured ones. */
async function _loadAndRenderAgentList(container) {
    container.innerHTML = '<p style="color:#a1a1aa;font-size:0.84rem;padding:12px 0;">⏳ Loading…</p>';
    let allSdrs;
    try {
        allSdrs = await fetchSdrDialerConfigs();
    } catch (e) {
        container.innerHTML = `<p style="color:#ef4444;font-size:0.84rem;padding:12px 0;">❌ ${e.message}</p>`;
        return;
    }
    // Store full list for add-dropdown use
    window._convAllSdrs = allSdrs || [];
    const configured = allSdrs.filter(s => s.rcm_user_id);

    // Update count label
    const countEl = document.getElementById('conv-agent-count');
    if (countEl) countEl.textContent = `${configured.length} agent${configured.length !== 1 ? 's' : ''} configured`;

    if (configured.length === 0) {
        container.innerHTML = `
<div style="padding:20px 0 12px;text-align:center;border:1.5px dashed #e5e7eb;border-radius:10px;color:#9ca3af;font-size:0.84rem;margin:8px 0 16px;">
  No agents configured yet. Click <strong>＋ Assign Agent</strong> to get started.
</div>`;
        return;
    }

    container.innerHTML = '';
    configured.forEach(sdr => {
        container.appendChild(_buildAgentRow(sdr));
    });
}

/** Build a single read-mode agent row element. */
function _buildAgentRow(sdr) {
    const initials = _getInitials(sdr.name || sdr.email);

    // Outer wrapper — block-level, just for border + hover bg
    const div = document.createElement('div');
    div.className = 'conv-agent-row';
    div.dataset.userId = sdr.id;
    div.dataset.name   = sdr.name || sdr.email;
    div.dataset.email  = sdr.email || '';
    div.style.borderBottom = '1px solid #f3f4f6';
    div.style.transition   = 'background 0.15s';

    // Inner flex row — always horizontal, never wraps
    const inner = document.createElement('div');
    inner.style.display        = 'flex';
    inner.style.alignItems     = 'center';
    inner.style.gap            = '14px';
    inner.style.padding        = '12px 0';
    inner.style.cursor         = 'default';
    inner.style.width          = '100%';
    inner.style.boxSizing      = 'border-box';

    inner.innerHTML = `
<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;font-weight:700;font-size:0.85rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>
<div style="flex:1;min-width:0;">
  <div style="font-weight:600;font-size:0.88rem;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(sdr.name || sdr.email)}</div>
  <div style="font-size:0.75rem;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(sdr.email)}</div>
</div>
<div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:center;">
  <span style="${_pillStyle()}" title="RCM User ID">ID: ${_esc(sdr.rcm_user_id || '—')}</span>
  <span style="${_pillStyle()}" title="Caller Number">${_esc(sdr.rcm_from_number || '—')}</span>
  ${sdr.rcm_email ? `<span style="${_pillStyle()}" title="RCM Email">${_esc(sdr.rcm_email)}</span>` : ''}
</div>
<div style="position:relative;flex-shrink:0;">
  <button class="conv-menu-btn" style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:#9ca3af;padding:4px 8px;border-radius:6px;" title="Actions">⋮</button>
  <div class="conv-menu-dropdown" style="display:none;position:fixed;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:130px;z-index:9999;">
    <button class="conv-edit-btn" style="display:block;width:100%;text-align:left;padding:9px 14px;font-size:0.82rem;background:none;border:none;cursor:pointer;color:#111;">✏️ Edit</button>
    <button class="conv-remove-btn" style="display:block;width:100%;text-align:left;padding:9px 14px;font-size:0.82rem;background:none;border:none;cursor:pointer;color:#ef4444;">🗑️ Remove</button>
  </div>
</div>`;

    div.appendChild(inner);

    // ⋮ menu toggle
    const menuBtn  = div.querySelector('.conv-menu-btn');
    const menuDrop = div.querySelector('.conv-menu-dropdown');
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // close all other open menus first
        document.querySelectorAll('.conv-menu-dropdown').forEach(d => { if (d !== menuDrop) d.style.display = 'none'; });
        const isOpen = menuDrop.style.display !== 'none';
        if (isOpen) { menuDrop.style.display = 'none'; return; }
        // BUG-01: position fixed relative to button so it never clips behind parent overflow
        const rect = menuBtn.getBoundingClientRect();
        menuDrop.style.top  = (rect.bottom + 4) + 'px';
        menuDrop.style.left = (rect.right - 130) + 'px';
        menuDrop.style.display = 'block';
    });
    document.addEventListener('click', () => { menuDrop.style.display = 'none'; }, { once: false });

    // Edit
    div.querySelector('.conv-edit-btn').addEventListener('click', () => {
        menuDrop.style.display = 'none';
        _openInlineEdit(div, sdr);
    });

    // Remove
    div.querySelector('.conv-remove-btn').addEventListener('click', async () => {
        menuDrop.style.display = 'none';
        if (!confirm(`Remove ${sdr.name || sdr.email}'s RCM assignment?`)) return;
        try {
            const res  = await patchUserSettings(sdr.id, { rcm_user_id: null, rcm_from_number: null, rcm_email: null });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
            const section = document.getElementById('sdr-agent-assignments-section');
            if (section) await _loadAndRenderAgentList(section);
            _populateAddDropdown(); // refresh dropdown
        } catch (e) {
            alert(`❌ ${e.message}`);
        }
    });

    // Hover
    div.addEventListener('mouseenter', () => { div.style.background = '#faf5ff'; });
    div.addEventListener('mouseleave', () => { div.style.background = ''; });

    return div;
}

/** Replace a row element with an inline edit form, pre-filled. */
function _openInlineEdit(rowEl, sdr) {
    // Close any other open edit rows first
    document.querySelectorAll('.conv-edit-row').forEach(r => r.remove());

    const editDiv = document.createElement('div');
    editDiv.className = 'conv-edit-row';
    editDiv.dataset.userId = sdr.id;
    editDiv.style.cssText = 'padding:12px 0;border-bottom:1px solid #f3f4f6;';
    editDiv.innerHTML = `
<div style="font-size:0.78rem;font-weight:600;color:#7c3aed;margin-bottom:10px;">Editing: ${_esc(sdr.name || sdr.email)}</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
  <div style="flex:1;min-width:120px;">
    <label style="font-size:0.7rem;color:#6b7280;font-weight:500;display:block;margin-bottom:4px;">RCM User ID</label>
    <input class="edit-uid" type="text" value="${_esc(sdr.rcm_user_id || '')}" placeholder="e.g. 1128097"
      style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.82rem;box-sizing:border-box;outline:none;font-family:inherit;">
  </div>
  <div style="flex:1;min-width:130px;">
    <label style="font-size:0.7rem;color:#6b7280;font-weight:500;display:block;margin-bottom:4px;">Caller Number</label>
    <input class="edit-phone" type="text" value="${_esc(sdr.rcm_from_number || '')}" placeholder="+91..."
      style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.82rem;box-sizing:border-box;outline:none;font-family:inherit;">
  </div>
  <div style="flex:1;min-width:150px;">
    <label style="font-size:0.7rem;color:#6b7280;font-weight:500;display:block;margin-bottom:4px;">RCM Email</label>
    <input class="edit-email" type="email" value="${_esc(sdr.rcm_email || '')}" placeholder="agent@company.com"
      style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.82rem;box-sizing:border-box;outline:none;font-family:inherit;">
  </div>
  <div style="display:flex;gap:8px;">
    <button class="edit-save-btn" style="padding:8px 16px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;">Save</button>
    <button class="edit-cancel-btn" style="padding:8px 12px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;font-size:0.82rem;color:#6b7280;cursor:pointer;">Cancel</button>
  </div>
</div>
<div class="edit-err" style="display:none;margin-top:8px;font-size:0.78rem;color:#ef4444;padding:6px 10px;background:#fef2f2;border-radius:6px;"></div>`;

    rowEl.style.display = 'none';
    rowEl.after(editDiv);

    editDiv.querySelector('.edit-cancel-btn').addEventListener('click', () => {
        editDiv.remove();
        rowEl.style.display = '';
    });

    let _saving = false;
    editDiv.querySelector('.edit-save-btn').addEventListener('click', async () => {
        if (_saving) return;
        const errDiv = editDiv.querySelector('.edit-err');
        errDiv.style.display = 'none';
        const uid   = editDiv.querySelector('.edit-uid').value.trim();
        const phone = editDiv.querySelector('.edit-phone').value.trim();
        const email = editDiv.querySelector('.edit-email').value.trim().toLowerCase();
        if (!uid) { _showAddErr(errDiv, 'RCM User ID is required.'); return; }
        _saving = true;
        const btn = editDiv.querySelector('.edit-save-btn');
        btn.textContent = '⏳'; btn.disabled = true;
        try {
            const res  = await patchUserSettings(sdr.id, {
                rcm_user_id: uid,
                rcm_from_number: phone || null,
                rcm_email: email || null,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
            if (data.warning) _showAddErr(errDiv, `⚠️ ${data.warning}`, '#f59e0b');
            const section = document.getElementById('sdr-agent-assignments-section');
            if (section) await _loadAndRenderAgentList(section);
            editDiv.remove();
        } catch (e) {
            _showAddErr(errDiv, e.message || 'Failed to save.');
        } finally {
            _saving = false;
            btn.textContent = 'Save'; btn.disabled = false;
        }
    });
}

/** Populate the "Select SDR" dropdown with only unassigned SDRs. */
function _populateAddDropdown() {
    const sel = document.getElementById('conv-add-sdr-select');
    if (!sel) return;
    const configured = new Set((window._convAllSdrs || []).filter(s => s.rcm_user_id).map(s => s.id));
    const unassigned = (window._convAllSdrs || []).filter(s => !configured.has(s.id));
    sel.innerHTML = '<option value="">— Select SDR —</option>';
    if (unassigned.length === 0) {
        sel.innerHTML = '<option value="" disabled>All SDRs already assigned</option>';
        return;
    }
    unassigned.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name || s.email;
        sel.appendChild(opt);
    });
}

function _clearAddForm() {
    ['conv-add-sdr-select', 'conv-add-user-id', 'conv-add-phone', 'conv-add-email'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const err = document.getElementById('conv-add-form-error');
    if (err) err.style.display = 'none';
}

function _showAddErr(el, msg, color = '#ef4444') {
    if (!el) return;
    el.textContent = msg;
    el.style.color = color;
    el.style.display = 'block';
}

function _getInitials(name = '') {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] || '?').toUpperCase();
}

function _pillStyle() {
    return 'display:inline-block;padding:3px 10px;background:#f3f4f6;border-radius:20px;font-size:0.75rem;color:#374151;white-space:nowrap;';
}

function _esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
