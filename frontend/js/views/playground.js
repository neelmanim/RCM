/**
 * playground.js — Dialer Playground v2 (Admin only)
 * ===================================================
 * A self-contained onboarding wizard. The admin enters RCM
 * credentials, picks a call mode, and tests the widget — simulating
 * exactly what a customer goes through during SDK onboarding.
 *
 * Steps:
 *   1. RCM credentials  (API Key, User ID, From Number)
 *   2. Call settings           (mode, test phone)
 *   3. Live test               (RCMDialer SDK mounts + call fires)
 */

import { authHeaders, API_BASE } from '../auth.js';

// ── Module state ──────────────────────────────────────────────────────────────
let _config = {};          // credentials the admin entered
let _mounted = false;      // has RCMDialer been mounted?

export async function renderPlayground(vc) {
    vc.innerHTML = `<div style="padding:60px;text-align:center;color:#64748b;">
        <div style="font-size:2rem;margin-bottom:8px;">🎮</div>Loading…</div>`;

    // ── Load saved credentials from backend (pre-fill) ────────────────────────
    let saved = {};
    try {
        const res = await fetch(`${API_BASE}/api/dialer/playground`, {
            headers: authHeaders(),
        });
        if (res.status === 403) {
            vc.innerHTML = `<div style="padding:60px;text-align:center;">
                <h2>🚫 Access Denied</h2>
                <p style="color:#64748b;margin-top:8px;">The Playground is only available to Admins.</p>
            </div>`;
            return;
        }
        if (res.ok) saved = await res.json();
    } catch {}

    _injectStyles();

    vc.innerHTML = `
    <div class="pgv2-wrap">

        <!-- ── Page header ── -->
        <div class="pgv2-header">
            <div class="pgv2-header-left">
                <span class="pgv2-icon">🎮</span>
                <div>
                    <h1 class="pgv2-title">Playground</h1>
                    <p class="pgv2-sub">Test end-to-end flows safely — like a customer would, without touching real data</p>
                </div>
            </div>
            <span class="pgv2-badge">Admin only</span>
        </div>

        <!-- ── Top-level tabs ── -->
        <div class="pgv2-toptabs">
            <button class="pgv2-toptab pgv2-toptab-active" id="pg-toptab-dialer" type="button">📞 Dialer Test</button>
            <button class="pgv2-toptab" id="pg-toptab-cadence" type="button">🔀 Cadence Test</button>
        </div>

        <div id="pg-tab-dialer">
            <!-- ── Step progress bar ── -->
            <div class="pgv2-steps" id="pgv2-steps">
                <div class="pgv2-step pgv2-step-active" data-step="1">
                    <div class="pgv2-step-num">1</div>
                    <span class="pgv2-step-label">Credentials</span>
                </div>
                <div class="pgv2-step-line"></div>
                <div class="pgv2-step" data-step="2">
                    <div class="pgv2-step-num">2</div>
                    <span class="pgv2-step-label">Call Settings</span>
                </div>
                <div class="pgv2-step-line"></div>
                <div class="pgv2-step" data-step="3">
                    <div class="pgv2-step-num">3</div>
                    <span class="pgv2-step-label">Live Test</span>
                </div>
            </div>

            <!-- ── Step panels ── -->
            <div id="pgv2-panel-1" class="pgv2-panel">
                ${_renderStep1(saved)}
            </div>
            <div id="pgv2-panel-2" class="pgv2-panel pgv2-hidden">
                ${_renderStep2()}
            </div>
            <div id="pgv2-panel-3" class="pgv2-panel pgv2-hidden">
                ${_renderStep3()}
            </div>
        </div>

        <div id="pg-tab-cadence" class="pgv2-hidden"></div>

    </div>`;

    _bindStep1();
    _bindTopTabs();
}

// ── Top-level tabs ────────────────────────────────────────────────────────────
let _cadenceTabLoaded = false;

function _bindTopTabs() {
    document.getElementById('pg-toptab-dialer')?.addEventListener('click', () => _goToTopTab('dialer'));
    document.getElementById('pg-toptab-cadence')?.addEventListener('click', () => _goToTopTab('cadence'));
}

function _goToTopTab(name) {
    document.getElementById('pg-toptab-dialer')?.classList.toggle('pgv2-toptab-active', name === 'dialer');
    document.getElementById('pg-toptab-cadence')?.classList.toggle('pgv2-toptab-active', name === 'cadence');
    document.getElementById('pg-tab-dialer')?.classList.toggle('pgv2-hidden', name !== 'dialer');
    document.getElementById('pg-tab-cadence')?.classList.toggle('pgv2-hidden', name !== 'cadence');
    if (name === 'cadence' && !_cadenceTabLoaded) {
        _cadenceTabLoaded = true;
        _initCadenceTab();
    }
}

// ── Step 1: Credentials ───────────────────────────────────────────────────────
function _renderStep1(saved) {
    return `
    <div class="pgv2-card">
        <div class="pgv2-card-header">
            <div class="pgv2-card-icon">🔑</div>
            <div>
                <div class="pgv2-card-title">RCM Credentials</div>
                <div class="pgv2-card-desc">
                    Enter your RCM API details. These are the same values a
                    customer would supply during SDK onboarding.
                    ${saved.has_credentials
                        ? '<span class="pgv2-prefill-tag">✅ Pre-filled from your Settings</span>'
                        : '<span class="pgv2-prefill-tag pgv2-prefill-empty">⚠️ Not yet configured in Settings</span>'}
                </div>
            </div>
        </div>

        <div class="pgv2-grid-2">
            <div class="pgv2-field">
                <label class="pgv2-label" for="pg-api-key">
                    API Key
                    <span class="pgv2-tooltip" title="Found in RCM Dashboard → Developer → API Keys">ⓘ</span>
                </label>
                <input id="pg-api-key" class="pgv2-input pgv2-mono"
                       type="password"
                       placeholder="sk_live_…"
                       value="${_esc(saved.api_key || '')}"/>
                <button class="pgv2-eye-btn" data-target="pg-api-key" type="button" title="Show/hide">👁</button>
            </div>
            <div class="pgv2-field">
                <label class="pgv2-label" for="pg-user-id">
                    User ID
                    <span class="pgv2-tooltip" title="Your RCM user ID — a numeric or UUID string">ⓘ</span>
                </label>
                <input id="pg-user-id" class="pgv2-input pgv2-mono"
                       type="text"
                       placeholder="user_123 or UUID"
                       value="${_esc(saved.user_id || '')}"/>
            </div>
            <div class="pgv2-field">
                <label class="pgv2-label" for="pg-from-number">
                    From Number
                    <span class="pgv2-tooltip" title="The caller ID shown to the person you call. E.g. +919876543210">ⓘ</span>
                </label>
                <input id="pg-from-number" class="pgv2-input"
                       type="tel"
                       placeholder="+91 98765 43210"
                       value="${_esc(saved.from_number || '')}"/>
            </div>
            <div class="pgv2-field">
                <label class="pgv2-label" for="pg-api-base">
                    API Base URL
                    <span class="pgv2-tooltip" title="RCM API endpoint. Leave as default unless using a custom environment.">ⓘ</span>
                </label>
                <input id="pg-api-base" class="pgv2-input pgv2-mono"
                       type="url"
                       placeholder="https://api.bercm.com"
                       value="${_esc(saved.api_base || 'https://api.bercm.com')}"/>
            </div>
        </div>

        <div id="pg-cred-error" class="pgv2-error" style="display:none;"></div>

        <div class="pgv2-footer">
            <div class="pgv2-hint">
                💡 These credentials are only used for this test session — they are not saved unless already in your Settings.
            </div>
            <button id="pg-step1-next" class="pgv2-btn pgv2-btn-primary">
                Continue to Call Settings →
            </button>
        </div>
    </div>`;
}

function _bindStep1() {
    // Show/hide password toggle
    document.querySelectorAll('.pgv2-eye-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const inp = document.getElementById(btn.dataset.target);
            if (!inp) return;
            inp.type = inp.type === 'password' ? 'text' : 'password';
        });
    });

    document.getElementById('pg-step1-next')?.addEventListener('click', () => {
        const apiKey  = document.getElementById('pg-api-key')?.value.trim();
        const userId  = document.getElementById('pg-user-id')?.value.trim();
        const fromNum = document.getElementById('pg-from-number')?.value.trim();
        const apiBase = document.getElementById('pg-api-base')?.value.trim()
                        || 'https://api.bercm.com';

        const err = document.getElementById('pg-cred-error');
        if (!apiKey) { _showError(err, 'API Key is required.'); return; }
        if (!userId) { _showError(err, 'User ID is required.'); return; }
        err.style.display = 'none';

        // Stash in module state
        _config = { apiKey, userId, fromNum, apiBase };
        _goToStep(2);
    });
}

// ── Step 2: Call Settings ─────────────────────────────────────────────────────
function _renderStep2() {
    return `
    <div class="pgv2-card">
        <div class="pgv2-card-header">
            <div class="pgv2-card-icon">📞</div>
            <div>
                <div class="pgv2-card-title">Call Settings</div>
                <div class="pgv2-card-desc">
                    Choose how the call connects and enter a test number.
                </div>
            </div>
        </div>

        <div class="pgv2-field" style="max-width:340px;">
            <label class="pgv2-label" for="pg-phone">Phone number to call</label>
            <input id="pg-phone" class="pgv2-input" type="tel"
                   placeholder="+91 98765 43210" autocomplete="tel"/>
        </div>

        <div class="pgv2-field">
            <label class="pgv2-label">Call mode</label>
            <div class="pgv2-mode-grid">
                <label class="pgv2-mode-card pgv2-mode-selected" id="pg-mode-browser">
                    <input type="radio" name="pg-call-mode" value="browser" checked hidden/>
                    <div class="pgv2-mode-icon">🎧</div>
                    <div class="pgv2-mode-title">Browser Call</div>
                    <div class="pgv2-mode-desc">Uses your computer mic & speakers via LiveKit. Best for testing audio.</div>
                    <div class="pgv2-mode-check">✓</div>
                </label>
                <label class="pgv2-mode-card" id="pg-mode-bridge">
                    <input type="radio" name="pg-call-mode" value="bridge" hidden/>
                    <div class="pgv2-mode-icon">📱</div>
                    <div class="pgv2-mode-title">Phone Bridge</div>
                    <div class="pgv2-mode-desc">RCM calls your phone first, then bridges to the contact.</div>
                    <div class="pgv2-mode-check">✓</div>
                </label>
            </div>
        </div>

        <div id="pg-call-error" class="pgv2-error" style="display:none;"></div>

        <div class="pgv2-footer">
            <button id="pg-step2-back" class="pgv2-btn pgv2-btn-ghost">← Back</button>
            <button id="pg-step2-next" class="pgv2-btn pgv2-btn-primary">
                Launch Widget →
            </button>
        </div>
    </div>`;
}

function _bindStep2() {
    // Mode card selection UX
    document.querySelectorAll('.pgv2-mode-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.pgv2-mode-card').forEach(c => c.classList.remove('pgv2-mode-selected'));
            card.classList.add('pgv2-mode-selected');
            card.querySelector('input[type=radio]').checked = true;
        });
    });

    document.getElementById('pg-step2-back')?.addEventListener('click', () => _goToStep(1));

    document.getElementById('pg-step2-next')?.addEventListener('click', () => {
        const phone = document.getElementById('pg-phone')?.value.trim();
        const mode  = document.querySelector('input[name="pg-call-mode"]:checked')?.value || 'browser';
        const err   = document.getElementById('pg-call-error');
        if (!phone) { _showError(err, 'Please enter a phone number to call.'); return; }
        err.style.display = 'none';
        _config.phone = phone;
        _config.callMode = mode;
        _goToStep(3);
        _initStep3();
    });
}

// ── Step 3: Live Test ─────────────────────────────────────────────────────────
function _renderStep3() {
    return `
    <div class="pgv2-card">
        <div class="pgv2-card-header">
            <div class="pgv2-card-icon">🚀</div>
            <div>
                <div class="pgv2-card-title">Live Test</div>
                <div class="pgv2-card-desc">
                    The widget is mounted with your credentials. Hit <strong>Make Call</strong> to place a real call.
                </div>
            </div>
        </div>

        <!-- Config summary -->
        <div class="pgv2-summary" id="pg-summary"></div>

        <!-- Call action -->
        <div class="pgv2-call-row">
            <div class="pgv2-call-phone" id="pg-call-display"></div>
            <button id="pg-make-call-btn" class="pgv2-btn pgv2-btn-call" disabled>
                <span class="pgv2-btn-spinner pgv2-hidden" id="pg-call-spinner">⟳</span>
                📞 Make Call
            </button>
            <button id="pg-hangup-btn" class="pgv2-btn pgv2-btn-hangup pgv2-hidden">
                📵 Hang Up
            </button>
        </div>

        <!-- Widget status -->
        <div class="pgv2-widget-status" id="pg-widget-status">
            <div class="pgv2-ws-idle">⏳ Mounting widget…</div>
        </div>

        <!-- Event log -->
        <div class="pgv2-event-section">
            <div class="pgv2-event-header">
                <span>📡 SDK Events</span>
                <button id="pg-clear-log" class="pgv2-btn pgv2-btn-ghost pgv2-btn-xs">Clear</button>
            </div>
            <div id="pg-event-log" class="pgv2-event-log">
                <span class="pgv2-log-placeholder">Events will appear as the call progresses…</span>
            </div>
        </div>

        <div class="pgv2-footer">
            <button id="pg-step3-back" class="pgv2-btn pgv2-btn-ghost">← Edit Settings</button>
            <button id="pg-restart-btn" class="pgv2-btn pgv2-btn-outline">🔄 Start Over</button>
        </div>
    </div>`;
}

async function _initStep3() {
    // ── Populate summary ──────────────────────────────────────────────────────
    const summary = document.getElementById('pg-summary');
    const phone   = document.getElementById('pg-call-display');
    if (summary) {
        summary.innerHTML = `
            <div class="pgv2-summary-row"><span>API Key</span><code>${_mask(_config.apiKey)}</code></div>
            <div class="pgv2-summary-row"><span>User ID</span><code>${_esc(_config.userId)}</code></div>
            <div class="pgv2-summary-row"><span>From Number</span><code>${_esc(_config.fromNum || '—')}</code></div>
            <div class="pgv2-summary-row"><span>Call Mode</span><code>${_config.callMode}</code></div>
            <div class="pgv2-summary-row"><span>API Base</span><code>${_esc(_config.apiBase)}</code></div>`;
    }
    if (phone) phone.textContent = `Calling: ${_config.phone}`;

    // ── Ready state ───────────────────────────────────────────────────────────
    // The Playground calls the CRM's own /api/calls/start endpoint directly —
    // no third-party SDK needed. This is identical to a real SDR placing a call.
    _log('✅ Ready — click Make Call to place a test call via RCM', 'success');
    _setWidgetStatus('ready');
    _mounted = true;

    const callBtn   = document.getElementById('pg-make-call-btn');
    const hangupBtn = document.getElementById('pg-hangup-btn');
    if (callBtn) callBtn.disabled = false;

    let _activeCallId = null;
    let _pollTimer    = null;

    function _stopPoll() {
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    }

    async function _pollStatus(callId) {
        try {
            const res = await fetch(`${API_BASE}/api/dialer/playground/call-status?call_id=${encodeURIComponent(callId)}`, {
                headers: authHeaders(),
            });
            if (!res.ok) return;
            const data = await res.json();
            const s = data.status || '';
            if (s === 'CALL_ANSWERED') {
                _log('📣 call.answered — call connected', 'success');
                _setWidgetStatus('active', 'Call in progress');
            } else if (['CALL_ENDED', 'CALL_FAILED', 'DISCONNECTED'].includes(s)) {
                _log(`🔴 call.ended — status: ${s} | duration: ${data.duration ?? 0}s`, 'info');
                _setWidgetStatus('ended', `Call ended · ${data.duration ?? 0}s`);
                hangupBtn?.classList.add('pgv2-hidden');
                callBtn?.classList.remove('pgv2-hidden');
                if (callBtn) callBtn.disabled = false;
                _activeCallId = null;
                _stopPoll();
            }
        } catch {}
    }


    // ── Make Call ─────────────────────────────────────────────────────────────
    // Uses the dedicated Playground endpoint which takes credentials directly
    // from the form — independent of the admin's own CRM dialer profile.
    document.getElementById('pg-make-call-btn')?.addEventListener('click', async () => {
        if (callBtn) callBtn.disabled = true;
        document.getElementById('pg-call-spinner')?.classList.remove('pgv2-hidden');
        _log(`📞 Calling ${_config.phone} via ${_config.callMode}…`, 'info');
        _setWidgetStatus('connecting', 'Connecting…');

        try {
            const res = await fetch(`${API_BASE}/api/dialer/playground/test-call`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone:       _config.phone,
                    api_key:     _config.apiKey,
                    user_id:     _config.userId,
                    from_number: _config.fromNum || '',
                    api_base:    _config.apiBase  || 'https://api.bercm.com',
                    call_mode:   _config.callMode,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || data.error || `HTTP ${res.status}`);
            }
            _activeCallId = data.call_id;
            _log(`🟢 call.started — call_id: ${_activeCallId}`, 'success');
            _setWidgetStatus('active', 'Ringing…');
            hangupBtn?.classList.remove('pgv2-hidden');
            callBtn?.classList.add('pgv2-hidden');

            // Poll for terminal status every 3s
            _pollTimer = setInterval(() => _pollStatus(_activeCallId), 3000);
        } catch (err) {
            _log(`❌ ${err.message}`, 'error');
            _setWidgetStatus('error', err.message);
            if (callBtn) callBtn.disabled = false;
        }
        document.getElementById('pg-call-spinner')?.classList.add('pgv2-hidden');
    });

    // ── Hang Up ───────────────────────────────────────────────────────────────
    document.getElementById('pg-hangup-btn')?.addEventListener('click', async () => {
        _log('⏹ Hanging up…', 'info');
        _stopPoll();
        if (_activeCallId) {
            try {
                await fetch(`${API_BASE}/api/calls/end`, {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ call_id: _activeCallId }),
                });
                _log('🔴 Call ended by admin', 'info');
            } catch (e) {
                _log(`⚠️ Disconnect error: ${e.message}`, 'warn');
            }
            _activeCallId = null;
        }
        _setWidgetStatus('ended', 'Call ended');
        hangupBtn?.classList.add('pgv2-hidden');
        callBtn?.classList.remove('pgv2-hidden');
        if (callBtn) callBtn.disabled = false;
    });

    // ── Navigation buttons ────────────────────────────────────────────────────
    document.getElementById('pg-step3-back')?.addEventListener('click', () => {
        _stopPoll();
        _mounted = false;
        _goToStep(2);
    });

    document.getElementById('pg-restart-btn')?.addEventListener('click', () => {
        _stopPoll();
        _mounted = false;
        _config = {};
        _goToStep(1);
    });

    document.getElementById('pg-clear-log')?.addEventListener('click', () => {
        const log = document.getElementById('pg-event-log');
        if (log) log.innerHTML = '<span class="pgv2-log-placeholder">Log cleared.</span>';
    });
}


// ── Cadence Test tab ──────────────────────────────────────────────────────────
// Enrolls a throwaway Lead (Lead.is_test=True) in a real, published Journey
// and lets the admin force each step through immediately instead of waiting
// real hours/days. Every send is redirected server-side to
// SyncSettings.sandbox_test_phone_number regardless of the test lead's own
// phone field — the actual safety guarantee lives in the whatsapp/sms
// channel providers, not in this UI.
let _cadence = { journeyId: null, leadId: null, enrollmentId: null };

async function _initCadenceTab() {
    const container = document.getElementById('pg-tab-cadence');
    if (!container) return;
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b;">Loading…</div>`;

    let sandboxPhone = '';
    try {
        const res = await fetch(`${API_BASE}/api/admin/sync-settings`, { headers: authHeaders() });
        if (res.ok) sandboxPhone = (await res.json()).sandbox_test_phone_number || '';
    } catch {}

    let journeys = [];
    try {
        const res = await fetch(`${API_BASE}/api/journeys`, { headers: authHeaders() });
        if (res.ok) journeys = (await res.json()).filter(j => j.status === 'active');
    } catch {}

    container.innerHTML = `
    <div class="pgv2-card">
        <div class="pgv2-card-header">
            <div class="pgv2-card-icon">🔀</div>
            <div>
                <div class="pgv2-card-title">Cadence Test</div>
                <div class="pgv2-card-desc">
                    Enroll a throwaway test lead in a real Sales Cadence and step through it live —
                    real sends, no real customer ever touched.
                </div>
            </div>
        </div>

        ${sandboxPhone
            ? `<div class="pgv2-cadence-banner pgv2-cadence-banner-ok">🔒 TEST MODE — every send in this tab goes to <strong>${_esc(sandboxPhone)}</strong> only, never a real lead.</div>`
            : `<div class="pgv2-cadence-banner pgv2-cadence-banner-warn">⚠️ Set a Sandbox Test Phone Number in Settings → RCM Conversations before running a test.</div>`}

        <div class="pgv2-field" style="max-width:420px;margin-top:16px;">
            <label class="pgv2-label" for="pg-cadence-journey">Journey</label>
            <select id="pg-cadence-journey" class="pgv2-input" ${journeys.length ? '' : 'disabled'}>
                ${journeys.length
                    ? journeys.map(j => `<option value="${j.id}">${_esc(j.name)}</option>`).join('')
                    : '<option>No published journeys found</option>'}
            </select>
        </div>

        <div class="pgv2-footer" style="border-top:none;padding-top:0;margin-top:16px;">
            <button id="pg-cadence-enroll-btn" class="pgv2-btn pgv2-btn-primary" ${sandboxPhone && journeys.length ? '' : 'disabled'}>
                ▶️ Create Test Lead &amp; Enroll
            </button>
            <button id="pg-cadence-clear-btn" class="pgv2-btn pgv2-btn-ghost">🗑️ Clear All Test Data</button>
        </div>

        <div id="pg-cadence-error" class="pgv2-error" style="display:none;"></div>
        <div id="pg-cadence-timeline"></div>
    </div>`;

    document.getElementById('pg-cadence-enroll-btn')?.addEventListener('click', _cadenceEnroll);
    document.getElementById('pg-cadence-clear-btn')?.addEventListener('click', _cadenceClearTestData);
}

async function _cadenceEnroll() {
    const journeyId = document.getElementById('pg-cadence-journey')?.value;
    const errEl = document.getElementById('pg-cadence-error');
    if (errEl) errEl.style.display = 'none';
    if (!journeyId) return;

    try {
        const res = await fetch(`${API_BASE}/api/journeys/${journeyId}/sandbox/enroll-test-lead`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: 'Playground Test Lead' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

        _cadence.journeyId = journeyId;
        _cadence.leadId = data.lead_id;
        _cadence.enrollmentId = data.enrollment_id;
        await _cadenceRefreshTimeline();
    } catch (e) {
        if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    }
}

async function _cadenceRefreshTimeline() {
    const el = document.getElementById('pg-cadence-timeline');
    if (!el || !_cadence.journeyId || !_cadence.leadId) return;

    let status;
    try {
        const res = await fetch(`${API_BASE}/api/journeys/${_cadence.journeyId}/enrollments/${_cadence.leadId}`, { headers: authHeaders() });
        if (!res.ok) return;
        status = await res.json();
    } catch { return; }

    const historyRows = (status.history || []).map(h => `
        <div class="pgv2-cadence-step">
            <span class="pgv2-cadence-step-node">${_esc(h.node_id)}</span>
            <span class="pgv2-cadence-step-status pgv2-cadence-step-${_esc(h.status)}">${_esc(h.status)}</span>
            <span class="pgv2-cadence-step-time">${h.created_at ? new Date(h.created_at).toLocaleTimeString() : ''}</span>
        </div>`).join('');

    const isActive = status.status === 'active';
    el.innerHTML = `
        <div class="pgv2-cadence-status-row">
            <span>Enrollment status: <strong>${_esc(status.status)}</strong></span>
            <span>Current step: <strong>${_esc(status.current_node_label || status.current_node_id || '—')}</strong></span>
            ${isActive ? `<button id="pg-cadence-force-btn" class="pgv2-btn pgv2-btn-primary pgv2-btn-xs">⏩ Force Next Step</button>` : ''}
        </div>
        ${historyRows ? `<div class="pgv2-cadence-history">${historyRows}</div>` : ''}`;

    document.getElementById('pg-cadence-force-btn')?.addEventListener('click', _cadenceForceNextStep);
}

async function _cadenceForceNextStep() {
    const errEl = document.getElementById('pg-cadence-error');
    if (errEl) errEl.style.display = 'none';
    try {
        const res = await fetch(`${API_BASE}/api/journeys/enrollments/${_cadence.enrollmentId}/force-next-step`, {
            method: 'POST',
            headers: authHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        await _cadenceRefreshTimeline();
    } catch (e) {
        if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    }
}

async function _cadenceClearTestData() {
    if (!confirm('Delete every test lead and its enrollments? This cannot be undone.')) return;
    try {
        await fetch(`${API_BASE}/api/journeys/sandbox/test-leads`, { method: 'DELETE', headers: authHeaders() });
    } catch {}
    _cadence = { journeyId: null, leadId: null, enrollmentId: null };
    const el = document.getElementById('pg-cadence-timeline');
    if (el) el.innerHTML = '';
}

// ── Navigation ────────────────────────────────────────────────────────────────

function _goToStep(n) {
    // Update step indicators
    document.querySelectorAll('.pgv2-step').forEach(el => {
        const s = parseInt(el.dataset.step);
        el.classList.toggle('pgv2-step-active', s === n);
        el.classList.toggle('pgv2-step-done', s < n);
    });
    // Show/hide panels
    [1, 2, 3].forEach(i => {
        const p = document.getElementById(`pgv2-panel-${i}`);
        if (p) p.classList.toggle('pgv2-hidden', i !== n);
    });
    // Bind appropriate step
    if (n === 2) _bindStep2();
}

// ── Widget status display ─────────────────────────────────────────────────────
function _setWidgetStatus(state, msg) {
    const el = document.getElementById('pg-widget-status');
    if (!el) return;
    const states = {
        mounting:   { cls: 'pgv2-ws-mounting',   icon: '⟳', text: msg || 'Mounting…' },
        ready:      { cls: 'pgv2-ws-ready',       icon: '✅', text: msg || 'Widget ready — click Make Call' },
        connecting: { cls: 'pgv2-ws-connecting',  icon: '📡', text: msg || 'Connecting…' },
        active:     { cls: 'pgv2-ws-active',      icon: '🟢', text: msg || 'Call in progress' },
        ended:      { cls: 'pgv2-ws-ended',       icon: '⏹', text: msg || 'Call ended' },
        error:      { cls: 'pgv2-ws-error',       icon: '❌', text: msg || 'Error' },
    };
    const s = states[state] || states.ready;
    el.innerHTML = `<div class="${s.cls}">${s.icon} ${s.text}</div>`;
}

// ── Event log ─────────────────────────────────────────────────────────────────
function _log(msg, level = 'info') {
    const log = document.getElementById('pg-event-log');
    if (!log) return;
    log.querySelector('.pgv2-log-placeholder')?.remove();
    const div = document.createElement('div');
    div.className = `pgv2-log-entry pgv2-log-${level}`;
    div.innerHTML = `<span class="pgv2-log-time">${new Date().toLocaleTimeString()}</span> ${msg}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.classList.add('pgv2-shake');
    setTimeout(() => el.classList.remove('pgv2-shake'), 400);
}

function _mask(val) {
    if (!val) return '—';
    if (val.length <= 8) return '••••••••';
    return val.slice(0, 4) + '••••••••' + val.slice(-4);
}

function _esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Styles ────────────────────────────────────────────────────────────────────
function _injectStyles() {
    if (document.getElementById('pgv2-styles')) return;
    const s = document.createElement('style');
    s.id = 'pgv2-styles';
    s.textContent = `
    /* ── Wrapper ── */
    .pgv2-wrap { padding: 28px 32px; max-width: 860px; }
    @media (max-width: 720px) { .pgv2-wrap { padding: 14px; } }

    /* ── Header ── */
    .pgv2-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:12px; }
    .pgv2-header-left { display:flex; align-items:center; gap:14px; }
    .pgv2-icon { font-size:2rem; }
    .pgv2-title { font-size:1.5rem; font-weight:800; color:var(--text-main,#0f172a); margin:0 0 2px; }
    .pgv2-sub { font-size:.85rem; color:var(--text-muted,#64748b); margin:0; }
    .pgv2-badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
                  background:rgba(239,68,68,.10); color:#dc2626;
                  border:1px solid rgba(239,68,68,.25); border-radius:20px; padding:4px 12px; }

    /* ── Top-level tabs ── */
    .pgv2-toptabs { display:flex; gap:6px; margin-bottom:20px; border-bottom:1.5px solid #e2e8f0; }
    .pgv2-toptab { padding:10px 16px; border:none; background:none; cursor:pointer;
                   font-size:13.5px; font-weight:600; color:#94a3b8;
                   border-bottom:2px solid transparent; margin-bottom:-2px; transition:color .15s; }
    .pgv2-toptab:hover { color:#475569; }
    .pgv2-toptab-active { color:#4f46e5; border-bottom-color:#4f46e5; }

    /* ── Cadence Test ── */
    .pgv2-cadence-banner { padding:10px 14px; border-radius:10px; font-size:.82rem; font-weight:600; }
    .pgv2-cadence-banner-ok { background:rgba(34,197,94,.08); color:#15803d; border:1px solid rgba(34,197,94,.2); }
    .pgv2-cadence-banner-warn { background:rgba(245,158,11,.08); color:#b45309; border:1px solid rgba(245,158,11,.2); }
    .pgv2-cadence-status-row { display:flex; gap:20px; flex-wrap:wrap; align-items:center;
                                padding:12px 16px; background:#f8fafc; border:1px solid #e2e8f0;
                                border-radius:10px; margin-top:16px; font-size:.82rem; color:#334155; }
    .pgv2-cadence-history { margin-top:12px; display:flex; flex-direction:column; gap:6px; }
    .pgv2-cadence-step { display:flex; gap:12px; align-items:center; padding:8px 12px;
                         background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; font-size:.8rem; }
    .pgv2-cadence-step-node { font-family:monospace; color:#334155; flex:1; }
    .pgv2-cadence-step-status { font-weight:700; text-transform:uppercase; font-size:.7rem; letter-spacing:.04em; }
    .pgv2-cadence-step-sent, .pgv2-cadence-step-success { color:#15803d; }
    .pgv2-cadence-step-failed { color:#dc2626; }
    .pgv2-cadence-step-time { color:#94a3b8; }

    /* ── Steps ── */
    .pgv2-steps { display:flex; align-items:center; gap:0; margin-bottom:24px; }
    .pgv2-step { display:flex; align-items:center; gap:8px; flex-shrink:0; }
    .pgv2-step-num {
        width:28px; height:28px; border-radius:50%; display:flex; align-items:center;
        justify-content:center; font-size:13px; font-weight:700;
        background:#e2e8f0; color:#94a3b8;
        transition: all .2s;
    }
    .pgv2-step-label { font-size:12.5px; font-weight:600; color:#94a3b8; transition: color .2s; }
    .pgv2-step-active .pgv2-step-num  { background:#4f46e5; color:#fff; box-shadow:0 0 0 3px rgba(79,70,229,.2); }
    .pgv2-step-active .pgv2-step-label { color:#4f46e5; }
    .pgv2-step-done .pgv2-step-num   { background:#22c55e; color:#fff; }
    .pgv2-step-done .pgv2-step-label  { color:#22c55e; }
    .pgv2-step-line { flex:1; height:2px; background:#e2e8f0; min-width:24px; max-width:60px; margin:0 6px; }

    /* ── Card ── */
    .pgv2-card { background:#fff; border:1px solid var(--border-color,#e2e8f0); border-radius:16px;
                 padding:28px; box-shadow:0 1px 4px rgba(0,0,0,.06); }
    .pgv2-card-header { display:flex; align-items:flex-start; gap:14px; margin-bottom:24px; }
    .pgv2-card-icon { font-size:1.6rem; flex-shrink:0; margin-top:2px; }
    .pgv2-card-title { font-size:1rem; font-weight:700; color:var(--text-main,#0f172a); margin-bottom:4px; }
    .pgv2-card-desc { font-size:.85rem; color:var(--text-muted,#64748b); line-height:1.55; }
    .pgv2-prefill-tag { display:inline-block; font-size:11px; font-weight:600; border-radius:6px;
                        padding:2px 8px; margin-left:8px;
                        background:rgba(34,197,94,.08); color:#15803d;
                        border:1px solid rgba(34,197,94,.2); }
    .pgv2-prefill-empty { background:rgba(245,158,11,.08); color:#b45309; border-color:rgba(245,158,11,.2); }

    /* ── Grid ── */
    .pgv2-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px; }
    @media (max-width:600px) { .pgv2-grid-2 { grid-template-columns:1fr; } }

    /* ── Form fields ── */
    .pgv2-field { position:relative; display:flex; flex-direction:column; gap:5px; }
    .pgv2-label { font-size:11px; font-weight:600; text-transform:uppercase;
                  letter-spacing:.05em; color:var(--text-muted,#64748b); }
    .pgv2-tooltip { cursor:help; color:#94a3b8; font-size:12px; }
    .pgv2-input {
        width:100%; box-sizing:border-box;
        padding:9px 12px; border:1.5px solid var(--border-color,#e2e8f0);
        border-radius:10px; font-size:13.5px; font-family:inherit;
        color:var(--text-main,#0f172a); background:var(--bg,#f8fafc);
        outline:none; transition:border-color .2s, box-shadow .2s;
    }
    .pgv2-input:focus { border-color:#4f46e5; box-shadow:0 0 0 3px rgba(79,70,229,.10); }
    .pgv2-mono { font-family:'JetBrains Mono','Fira Code',monospace; font-size:12.5px; }
    .pgv2-eye-btn {
        position:absolute; right:10px; bottom:9px;
        background:none; border:none; cursor:pointer; font-size:14px;
        color:#94a3b8; padding:0; line-height:1;
    }

    /* ── Error ── */
    .pgv2-error { padding:10px 14px; background:rgba(239,68,68,.07);
                  border:1px solid rgba(239,68,68,.2); color:#dc2626;
                  border-radius:10px; font-size:.85rem; font-weight:500; margin-top:4px; }
    @keyframes pgv2-shake {
        0%,100% { transform:translateX(0); }
        20%,60%  { transform:translateX(-6px); }
        40%,80%  { transform:translateX(6px); }
    }
    .pgv2-shake { animation:pgv2-shake .35s ease; }

    /* ── Mode cards ── */
    .pgv2-mode-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    @media (max-width:560px) { .pgv2-mode-grid { grid-template-columns:1fr; } }
    .pgv2-mode-card {
        position:relative; display:flex; flex-direction:column; gap:6px;
        padding:16px; border:1.5px solid var(--border-color,#e2e8f0);
        border-radius:12px; cursor:pointer; transition:all .15s;
        background:var(--bg,#f8fafc);
    }
    .pgv2-mode-card:hover { border-color:#4f46e5; }
    .pgv2-mode-selected { border-color:#4f46e5; background:rgba(79,70,229,.05); }
    .pgv2-mode-icon  { font-size:1.4rem; }
    .pgv2-mode-title { font-size:13.5px; font-weight:700; color:var(--text-main,#0f172a); }
    .pgv2-mode-desc  { font-size:12px; color:var(--text-muted,#64748b); line-height:1.5; }
    .pgv2-mode-check {
        position:absolute; top:10px; right:12px; font-size:13px; color:#4f46e5;
        opacity:0; transition:opacity .15s;
    }
    .pgv2-mode-selected .pgv2-mode-check { opacity:1; }

    /* ── Summary ── */
    .pgv2-summary { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px;
                    padding:14px 16px; background:#f8fafc;
                    border:1px solid #e2e8f0; border-radius:12px; }
    .pgv2-summary-row { display:flex; gap:8px; align-items:center;
                        font-size:12.5px; flex:1; min-width:200px; }
    .pgv2-summary-row span { color:#64748b; font-weight:600; white-space:nowrap; }
    .pgv2-summary-row code { font-family:monospace; font-size:12px; color:#4338ca;
                              background:rgba(79,70,229,.07); padding:2px 6px; border-radius:4px; }

    /* ── Call row ── */
    .pgv2-call-row { display:flex; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
    .pgv2-call-phone { font-size:.85rem; color:#64748b; flex:1; }

    /* ── Widget status ── */
    .pgv2-widget-status { border-radius:10px; margin-bottom:16px; overflow:hidden; }
    .pgv2-widget-status > div { padding:12px 16px; font-size:.88rem; font-weight:600; }
    .pgv2-ws-idle, .pgv2-ws-mounting { background:rgba(100,116,139,.08); color:#475569; }
    .pgv2-ws-ready   { background:rgba(34,197,94,.08);  color:#15803d; }
    .pgv2-ws-connecting { background:rgba(245,158,11,.08); color:#b45309; }
    .pgv2-ws-active  { background:rgba(34,197,94,.12); color:#15803d; }
    .pgv2-ws-ended   { background:rgba(100,116,139,.08); color:#475569; }
    .pgv2-ws-error   { background:rgba(239,68,68,.08); color:#dc2626; }

    /* ── Event log ── */
    .pgv2-event-section { margin-bottom:20px; }
    .pgv2-event-header { display:flex; justify-content:space-between; align-items:center;
                         margin-bottom:8px; }
    .pgv2-event-header span { font-size:.88rem; font-weight:700; color:var(--text-main,#0f172a); }
    .pgv2-event-log { background:#1e293b; border-radius:10px; padding:14px 16px;
                      min-height:90px; max-height:200px; overflow-y:auto;
                      font-family:'JetBrains Mono','Fira Code',monospace; font-size:12px; }
    .pgv2-log-placeholder { color:#475569; font-style:italic; }
    .pgv2-log-entry { line-height:1.7; }
    .pgv2-log-time { color:#475569; margin-right:6px; }
    .pgv2-log-info    { color:#94a3b8; }
    .pgv2-log-success { color:#4ade80; }
    .pgv2-log-error   { color:#f87171; }
    .pgv2-log-warn    { color:#fbbf24; }

    /* ── Buttons ── */
    .pgv2-btn { padding:9px 20px; border-radius:10px; font-size:13px; font-weight:600;
                font-family:inherit; cursor:pointer; border:none; transition:all .15s;
                display:inline-flex; align-items:center; gap:6px; }
    .pgv2-btn:disabled { opacity:.45; cursor:not-allowed; }
    .pgv2-btn-primary { background:#4f46e5; color:#fff; }
    .pgv2-btn-primary:not(:disabled):hover { background:#4338ca; transform:translateY(-1px); }
    .pgv2-btn-ghost   { background:none; border:1.5px solid #e2e8f0; color:#334155; }
    .pgv2-btn-ghost:hover { border-color:#4f46e5; color:#4f46e5; }
    .pgv2-btn-outline { background:none; border:1.5px solid #e2e8f0; color:#334155; }
    .pgv2-btn-outline:hover { background:#f8fafc; }
    .pgv2-btn-call    { background:linear-gradient(135deg,#22c55e,#16a34a); color:#fff;
                        box-shadow:0 3px 12px rgba(34,197,94,.3); }
    .pgv2-btn-call:not(:disabled):hover { transform:translateY(-1px); box-shadow:0 5px 18px rgba(34,197,94,.35); }
    .pgv2-btn-hangup  { background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff;
                        box-shadow:0 3px 12px rgba(239,68,68,.3); }
    .pgv2-btn-xs { padding:4px 10px; font-size:11.5px; }
    .pgv2-btn-spinner { display:inline-block; animation:pgv2-spin .7s linear infinite; }
    @keyframes pgv2-spin { to { transform:rotate(360deg); } }

    /* ── Footer ── */
    .pgv2-footer { display:flex; align-items:center; justify-content:space-between;
                   margin-top:24px; padding-top:16px; border-top:1px solid #e2e8f0; flex-wrap:wrap; gap:10px; }
    .pgv2-hint { font-size:.82rem; color:#94a3b8; flex:1; }

    /* ── Utilities ── */
    .pgv2-hidden { display:none !important; }
    .pgv2-panel  { animation:pgv2-fadein .2s ease; }
    @keyframes pgv2-fadein { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
    `;
    document.head.appendChild(s);
}
