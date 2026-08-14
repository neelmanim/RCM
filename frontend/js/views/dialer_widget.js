// ── views/dialer_widget.js — Floating Dialer SDK ─────────────────────────────
// Standalone SDK-style floating dialer widget for RCM/RCM CRM.
// Provides: call lifecycle management, status polling, mute/hold/hangup controls,
//           live call timer, draggable positioning, postMessage bridge support,
//           LiveKit WebRTC audio for browser-mode calling.
//
// Public API:
//   showDialerWidget(callResult, leadName, phone, options?)
//   hideDialerWidget()
//   isWidgetActive() → boolean
//   window.rcmDialer — global SDK handle (exposed for postMessage bridge)
// ──────────────────────────────────────────────────────────────────────────────
import * as api from '../api.js';
import { showToast } from '../utils.js';

// Phase 1 — state machine integration
// All call state is now owned by window.DialerMachine.
// These module-level variables are REMOVED:
//   _callState, _callAnswered, _timerInterval, _pollInterval,
//   _livekitRoom, _escHandler, _isMinimized
// They are accessed via the machine API instead.
//
// Shim for rollback safety: if dialer_machine.js failed to load, fall back
// gracefully rather than throwing on first .send() call.
const _machine = window.DialerMachine || {
    send() {}, on() { return () => {}; }, is() { return false; },
    getState() { return { name: 'IDLE', context: {} }; },
    isActive() { return false; },
    startPolling() {}, stopPolling() {},
    setLiveKitRoom() {}, getLiveKitRoom() { return null; },
};

// Subscribe to timer ticks to update the DOM
_machine.on('timer:tick', ({ seconds }) => {
    const timerEl = _widgetEl?.querySelector('.dw-timer');
    if (!timerEl) return;
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
});

// Subscribe to state transitions to update mute/hold button appearances
_machine.on('transition', ({ to, context }) => {
    if (!_widgetEl) return;
    const muteBtn = _widgetEl.querySelector('.dw-btn-mute');
    const holdBtn = _widgetEl.querySelector('.dw-btn-hold');
    if (muteBtn) muteBtn.classList.toggle('dw-btn-active', !!context.muted);
    if (holdBtn)  holdBtn.classList.toggle('dw-btn-active', to === 'HELD');
    // Sync minimize state
    const body = _widgetEl.querySelector('#dw-body');
    if (body) body.style.display = context.minimized ? 'none' : '';
    // ENDED / FAILED: show summary, schedule widget close
    if (to === 'ENDED' || to === 'FAILED') {
        const { context: ctx } = _machine.getState();
        _showEndSummary({ duration: ctx.duration, status: to });
        _emitEvent('call-ended', {
            callId:   ctx.callId,
            status:   to,
            duration: ctx.duration,
            leadName: ctx.leadName,
            phone:    ctx.phone,
        });
        setTimeout(() => hideDialerWidget(), 5000);
    }
    if (to === 'CONNECTED') {
        const timerEl = _widgetEl?.querySelector('.dw-timer');
        if (timerEl) timerEl.textContent = '00:00';
        _emitEvent('call-answered', {
            callId:    context.callId,
            startTime: context.startTime,
            leadName:  context.leadName,
            phone:     context.phone,
        });
    }
    if (to === 'IDLE') {
        hideDialerWidget();
    }
});

const POLL_INTERVAL_MS   = 2000;   // Poll every 2 seconds for faster decline/end detection
const TERMINAL_STATUSES  = new Set(['CALL_ENDED', 'CALL_FAILED', 'CALL_MISSED', 'disconnected', 'ended', 'failed', 'completed', 'no_answer', 'cancelled', 'busy']);

/**
 * Show the floating dialer widget after a call is initiated.
 * @param {object} callResult - Response from startDialerCall() with provider fields
 * @param {string} leadName - Display name of the lead being called
 * @param {string} phone - Phone number being called
 * @param {object} [options] - Additional options { callMode: 'browser'|'bridge' }
 */
export function showDialerWidget(callResult, leadName, phone, options = {}) {
    // Clean up any existing widget
    hideDialerWidget();

    // Inform the machine a call has started
    const callMode = options.callMode || callResult.call_mode || 'browser';
    _machine.send('START_CALL', {
        callId:       callResult.call_id || callResult.provider_call_id,
        roomName:     callResult.room_name || null,
        phone:        phone || '',
        leadName:     leadName || 'Unknown',
        leadId:       options.leadId || null,
        callMode,
        provider:     callResult.provider || 'rcm',
        livekitToken: callResult.livekit_token || null,
        livekitUrl:   callResult.livekit_url   || null,
    });

    _widgetEl = document.createElement('div');
    _widgetEl.id = 'dialer-widget';
    _widgetEl.innerHTML = _renderWidget();
    document.body.appendChild(_widgetEl);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            _widgetEl.classList.add('dialer-widget-visible');
        });
    });

    _bindControls();

    const timerEl = _widgetEl.querySelector('.dw-timer');
    if (timerEl) timerEl.textContent = 'Ringing\u2026';

    // Phase 3: Open SSE stream for real-time call status.
    // If EventSource fails or errors, _openSSE falls back to polling automatically.
    _openSSE();

    // For browser mode, connect LiveKit.
    // BUGFIX: 'context' was undefined here — must read from machine state
    // after _machine.send('START_CALL') has committed the livekit fields.
    const _ctx = _machine.getState().context;
    if (callMode === 'browser' && _ctx.livekitToken && _ctx.livekitUrl) {
        _connectLiveKit(_ctx.livekitUrl, _ctx.livekitToken);
    }

    // BUGFIX: 'context' was also undefined here (same as line 132).
    // Re-read from machine state so the rcm:call-started event
    // always dispatches with correct fields — this drives _renderCallActive
    // in rcm_widget.js which populates the Call tab during a live call.
    const _startCtx = _machine.getState().context;
    _emitEvent('call-started', {
        callId:    _startCtx.callId,
        leadName:  _startCtx.leadName,
        phone:     _startCtx.phone,
        callMode,
        startTime: Date.now(),
    });
}


/** Hide and destroy the dialer widget. */
export function hideDialerWidget() {
    _closeSSE();
    _machine.stopPolling();
    _disconnectLiveKit();
    if (_widgetEl) {
        _widgetEl.classList.remove('dialer-widget-visible');
        setTimeout(() => {
            _widgetEl?.remove();
            _widgetEl = null;
        }, 300);
    }
    // Only reset the machine if it's not already managing the IDLE→close sequence
    if (!_machine.is('IDLE') && !_machine.is('ENDED') && !_machine.is('FAILED')) {
        _machine.send('RESET');
    }
}

/** Check if the widget is currently visible. */
export function isWidgetActive() {
    return _machine.isActive();
}

/** Get current call state (for external consumers). */
export function getCallState() {
    const { context } = _machine.getState();
    if (!context.callId) return null;
    return { ...context };
}



// ── LiveKit WebRTC ──────────────────────────────────────────────────────────

async function _connectLiveKit(url, token) {
    if (!window.LivekitClient) {
        console.warn('[DialerSDK] LiveKit SDK not loaded, cannot connect to room');
        showToast('⚠️ Browser calling unavailable — LiveKit SDK not loaded', 'warning', 5000);
        return;
    }

    try {
        console.log('[DialerSDK] Connecting to LiveKit room...');
        const room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
        _machine.setLiveKitRoom(room);

        room.on(LivekitClient.RoomEvent.Connected, () => {
            console.log('[DialerSDK] ✅ Connected to LiveKit room');
            _updateStatusIndicator();
        });

        room.on(LivekitClient.RoomEvent.Disconnected, (reason) => {
            console.log('[DialerSDK] LiveKit disconnected:', reason);
            // If we disconnect while still in an active call, tell the machine
            if (_machine.isActive()) {
                _machine.send('CALL_ENDED_LOCAL');
            }
        });

        room.on(LivekitClient.RoomEvent.ParticipantConnected, (p) => {
            console.log('[DialerSDK] Participant joined:', p.identity);
            // First remote participant joining = call answered
            _machine.send('ANSWERED');
            _updateStatusIndicator();
        });

        room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (p) => {
            console.log(
                `[DialerSDK] Participant left: ${p.identity}`,
                '— reason:', p.disconnectReason ?? 'unknown'
            );
        });

        room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, pub, participant) => {
            console.log('[DialerSDK] Audio track from:', participant.identity);
            if (track.kind === 'audio') {
                const el = track.attach();
                el.id = `livekit-audio-${participant.identity}`;
                document.body.appendChild(el);
            }
        });

        room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
            track.detach().forEach(el => el.remove());
        });

        // Connect and enable microphone
        await room.connect(url, token);
        console.log('[DialerSDK] Room connected, enabling microphone...');
        await room.localParticipant.setMicrophoneEnabled(true);
        console.log('[DialerSDK] ✅ Microphone enabled');
        // Note: 'Browser audio connected' toast suppressed — RCM panel shows unified status
        console.log('[DialerSDK] ✅ Browser audio connected');

    } catch (err) {
        console.error('[DialerSDK] LiveKit connection failed:', err);
        showToast(`⚠️ Browser audio failed: ${err.message}`, 'warning', 5000);
    }
}

function _disconnectLiveKit() {
    const room = _machine.getLiveKitRoom();
    if (room) {
        try { room.disconnect(); } catch { /* ignore */ }
        _machine.setLiveKitRoom(null);
    }
    document.querySelectorAll('[id^="livekit-audio-"]').forEach(el => el.remove());
}


// ── Status Push (Phase 3 SSE) — falls back to polling if SSE unavailable ────
// _startPolling / _stopPolling are still owned by the machine.
// _pollStatus remains as an explicit fallback if SSE is unavailable or fails.
//
// SSE flow:
//   1. showDialerWidget() opens EventSource → GET /api/calls/events
//   2. Backend pushes CALL_STATUS events to the stream
//   3. Each event calls _machine.send('POLL_UPDATE', ...) — identical to polling
//   4. hideDialerWidget() calls _closeSSE() to clean up the EventSource
//
// Fallback flow (SSE unavailable):
//   machine.startPolling(_pollStatus) runs every 2s (unchanged from Phase 1)

let _widgetEl = null;   // the active floating widget DOM element (null when hidden)
let _sseSource = null;  // active EventSource, if connected


function _openSSE() {
    if (_sseSource) return;  // already connected
    try {
        // Pass JWT via query-string since EventSource doesn't support headers.
        // api._token() reads the in-memory JWT (same as all other API calls).
        const token = api._token?.() || '';
        const url = token
            ? `/api/calls/events?token=${encodeURIComponent(token)}`
            : '/api/calls/events';

        _sseSource = new EventSource(url);

        _sseSource.onopen = () => {
            console.log('[DialerSDK] SSE stream connected — real-time status active');
        };

        _sseSource.onmessage = (e) => {
            try {
                const event = JSON.parse(e.data);
                if (event.type === 'KEEPALIVE') return;
                if (!_machine.isActive()) return;

                _machine.send('POLL_UPDATE', {
                    rawStatus: event.status,
                    duration:  event.duration ?? null,
                });
                _updateStatusIndicator();

                if (event.status === 'CALL_ANSWERED') {
                    const ctx = _machine.getState().context;
                    _emitEvent('call-connected', { callId: ctx.callId });
                }
            } catch (err) {
                console.warn('[DialerSDK] SSE parse error:', err);
            }
        };

        _sseSource.onerror = (err) => {
            console.warn('[DialerSDK] SSE error — falling back to polling', err);
            _closeSSE();
            // Activate polling fallback so the call doesn't go unmonitored
            _machine.startPolling(_pollStatus);
        };
    } catch (err) {
        console.warn('[DialerSDK] EventSource not available — using polling', err);
        _machine.startPolling(_pollStatus);
    }
}

function _closeSSE() {
    if (_sseSource) {
        _sseSource.close();
        _sseSource = null;
        console.log('[DialerSDK] SSE stream closed');
    }
}

async function _pollStatus() {
    const { context } = _machine.getState();
    if (!context.callId) return;

    try {
        const status = await api.getCallStatus(context.callId);
        // Guard: machine may have reset while the network call was in-flight.
        if (!_machine.isActive()) return;
        if (!status) return;

        // Fan status update into the machine — it decides what transitions to make
        _machine.send('POLL_UPDATE', {
            rawStatus: status.status,
            duration:  status.duration ?? null,
        });

        // Update visual indicator (non-state UI)
        _updateStatusIndicator();

        // Connecting → active emission (for postMessage bridge consumers)
        if (status.status === 'CALL_ANSWERED' || status.status === 'connected') {
            const ctx = _machine.getState().context;
            _emitEvent('call-connected', { callId: ctx.callId });
        }
    } catch (err) {
        console.warn(
            `[DialerSDK] Poll error for call ${_machine.getState().context?.callId}:`,
            err.message, err
        );
    }
}



function _mapProviderStatus(rawStatus) {
    switch (rawStatus) {
        case 'CALL_STARTED':   return 'connecting';
        case 'CALL_ANSWERED':  return 'active';
        case 'CALL_ENDED':     return 'ended';
        case 'CALL_FAILED':    return 'ended';
        case 'CALL_MISSED':    return 'ended';
        default:               return rawStatus || 'connecting';
    }
}


// ── Rendering ───────────────────────────────────────────────────────────────

function _renderWidget() {
    const s = _machine.getState().context;
    const modeBadge = s.callMode === 'browser'
        ? '<span class="dw-mode-badge dw-mode-browser">🎧 Browser</span>'
        : '<span class="dw-mode-badge dw-mode-bridge">📱 Phone</span>';

    return `
        <div class="dw-header" id="dw-header-drag">
            <div class="dw-drag-handle" title="Drag to move">
                <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
                    <circle cx="3" cy="3"  r="1.5" fill="rgba(255,255,255,0.4)"/>
                    <circle cx="9" cy="3"  r="1.5" fill="rgba(255,255,255,0.4)"/>
                    <circle cx="3" cy="8"  r="1.5" fill="rgba(255,255,255,0.4)"/>
                    <circle cx="9" cy="8"  r="1.5" fill="rgba(255,255,255,0.4)"/>
                    <circle cx="3" cy="13" r="1.5" fill="rgba(255,255,255,0.4)"/>
                    <circle cx="9" cy="13" r="1.5" fill="rgba(255,255,255,0.4)"/>
                </svg>
            </div>
            <div class="dw-status-dot connecting"></div>
            <div class="dw-info">
                <div class="dw-lead-name">${_esc(s.leadName)}</div>
                <div class="dw-phone">${_esc(s.phone)} ${modeBadge}</div>
            </div>
            <div class="dw-timer" id="dw-live-timer">Ringing…</div>
            <button class="dw-btn dw-btn-minimize" id="dw-minimize-btn" title="Minimize widget" style="margin-left:auto;padding:4px;border:none;background:rgba(255,255,255,0.12);border-radius:6px;cursor:pointer;color:#fff;display:flex;align-items:center;flex-shrink:0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </button>
        </div>
        <div class="dw-body" id="dw-body">
            <div class="dw-controls">
                <button class="dw-btn dw-btn-mute" title="Mute" data-action="mute">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                    <span>Mute</span>
                </button>
                <button class="dw-btn dw-btn-hold" title="Hold" data-action="hold">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                    <span>Hold</span>
                </button>
                <button class="dw-btn dw-btn-hangup" id="dw-hangup-btn" title="End call (Esc)" data-action="hangup">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path>
                        <line x1="23" y1="1" x2="1" y2="23"></line>
                    </svg>
                    <span>End</span>
                </button>
            </div>
            <div class="dw-recording-badge">
                <span class="dw-rec-dot"></span> Recording
            </div>
        </div>
    `;
}

function _showEndSummary(status) {
    if (!_widgetEl) return;
    const controlsEl = _widgetEl.querySelector('.dw-controls');
    if (!controlsEl) return;

    const duration = status.duration || 0;
    const mins = String(Math.floor(duration / 60)).padStart(2, '0');
    const secs = String(duration % 60).padStart(2, '0');

    controlsEl.innerHTML = `
        <div class="dw-end-summary">
            <span class="dw-end-icon">✅</span>
            <span class="dw-end-text">Call ended · ${mins}:${secs}</span>
        </div>
    `;
}


// ── Event Handlers ──────────────────────────────────────────────────────────

// BUG-05 resolved: _isMinimized now lives in machine.context.minimized

function _bindControls() {
    if (!_widgetEl) return;

    _widgetEl.querySelector('.dw-btn-mute')?.addEventListener('click', _handleMute);
    _widgetEl.querySelector('.dw-btn-hold')?.addEventListener('click', _handleHold);
    _widgetEl.querySelector('.dw-btn-hangup')?.addEventListener('click', _handleHangup);

    // Minimize / expand toggle — machine owns the flag (BUG-05 fix)
    const minBtn = _widgetEl.querySelector('#dw-minimize-btn');
    if (minBtn) {
        minBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            _machine.send('MINIMIZE');
            const minimized = _machine.getState().context.minimized;
            minBtn.innerHTML = minimized
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
            minBtn.title = minimized ? 'Expand widget' : 'Minimize widget';
        });
    }

    // ENH-02 / Guard3 / Answer-fallback: ALL handled by the machine (esc handler
    // is installed in machine.send('START_CALL')).  No setTimeout hacks here.

    // Make widget draggable
    _makeDraggable();
}


async function _handleMute() {
    const { context } = _machine.getState();
    if (!context.callId) return;
    const btn = _widgetEl?.querySelector('.dw-btn-mute');
    try {
        const room = _machine.getLiveKitRoom();
        if (context.callMode === 'browser' && room) {
            const isMuted = !room.localParticipant.isMicrophoneEnabled;
            await room.localParticipant.setMicrophoneEnabled(isMuted);
        } else {
            const action = context.muted ? 'unmute' : 'mute';
            await api.callAction(context.callId, action, context.roomName);
        }
        _machine.send('MUTE');
        const muted = _machine.getState().context.muted;
        if (btn) btn.querySelector('span').textContent = muted ? 'Unmute' : 'Mute';
        _emitEvent('call-mute-changed', { callId: context.callId, muted });
    } catch (err) {
        showToast(`Mute failed: ${err.message}`, 'error');
    }
}


async function _handleHold() {
    const { context } = _machine.getState();
    if (!context.callId) return;
    const btn = _widgetEl?.querySelector('.dw-btn-hold');
    try {
        const action = context.held ? 'unhold' : 'hold';
        await api.callAction(context.callId, action, context.roomName);
        _machine.send(action === 'hold' ? 'HOLD' : 'RESUME');
        const held = _machine.getState().context.held;
        if (btn) btn.querySelector('span').textContent = held ? 'Resume' : 'Hold';
        _emitEvent('call-hold-changed', { callId: context.callId, held });
    } catch (err) {
        showToast(`Hold failed: ${err.message}`, 'error');
    }
}


async function _handleHangup() {
    const { context } = _machine.getState();

    // Optimistic UI — disable button immediately (BUG-11)
    const btn = _widgetEl?.querySelector('#dw-hangup-btn');
    if (btn) {
        btn.disabled = true;
        btn.querySelector('span').textContent = 'Ending…';
        btn.style.opacity = '0.6';
    }

    _disconnectLiveKit();
    _machine.send('HANGUP');

    // Only call disconnect API if we have a callId
    if (context.callId) {
        try {
            await api.disconnectCall(context.callId, context.phone);
        } catch (err) {
            console.warn('[DialerSDK] API disconnect failed (will still clean up):', err.message);
            showToast(`⚠️ Disconnect API error: ${err.message}`, 'warning', 3000);
        }
    } else {
        // No callId — call was never fully initiated on the backend.
        // Still clean up the machine so the SDR can dial again immediately.
        console.warn('[DialerSDK] _handleHangup: no callId in context — skipping API call, resetting machine');
    }

    if (_widgetEl) {
        const timerEl = _widgetEl.querySelector('.dw-timer, #dw-live-timer');
        if (timerEl) timerEl.textContent = 'Call ended ✓';
    }

    _emitEvent('call-ended', {
        callId:   context.callId,
        reason:   'user_hangup',
        leadName: context.leadName,
        phone:    context.phone,
    });

    // Always reset machine to IDLE — even if callId was missing.
    // This is the ONLY path that guarantees isWidgetActive() returns false
    // so the SDR can place the next call without being blocked.
    _machine.send('RESET');
    setTimeout(() => hideDialerWidget(), 1500);
}



// ── Timer & Status Updates ──────────────────────────────────────────────────
// _startAnsweredTimer and _updateTimer are removed — the machine owns the timer.
// The 'timer:tick' event subscription at the top of this file updates the DOM.

function _updateStatusIndicator() {
    if (!_widgetEl) return;
    const { name: state } = _machine.getState();
    const dot = _widgetEl.querySelector('.dw-status-dot');
    if (dot) {
        // Map machine states to CSS class names used by the stylesheet
        const cssMap = {
            RINGING:   'connecting',
            CONNECTED: 'active',
            HELD:      'held',
            ENDING:    'ending',
            ENDED:     'ended',
            FAILED:    'ended',
        };
        dot.className = `dw-status-dot ${cssMap[state] || 'connecting'}`;
    }
}


// ── Draggable (BUG-05: fixed CSS transform conflict) ────────────────────────
function _makeDraggable() {
    if (!_widgetEl) return;
    const header = _widgetEl.querySelector('.dw-header');
    if (!header) return;

    let isDragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    // Pin widget to left/top coordinates (clear CSS right/bottom/transform)
    function _pinPosition() {
        const rect = _widgetEl.getBoundingClientRect();
        _widgetEl.style.left       = `${rect.left}px`;
        _widgetEl.style.top        = `${rect.top}px`;
        _widgetEl.style.right      = 'auto';
        _widgetEl.style.bottom     = 'auto';
        _widgetEl.style.transform  = 'none';  // ← kills CSS class transform
        _widgetEl.style.transition = 'none';
    }

    function onStart(clientX, clientY) {
        if (!_widgetEl) return;
        _pinPosition();
        isDragging = true;
        startX = clientX;
        startY = clientY;
        startLeft = parseFloat(_widgetEl.style.left);
        startTop  = parseFloat(_widgetEl.style.top);
        header.style.cursor = 'grabbing';
    }

    function onMove(clientX, clientY) {
        if (!isDragging || !_widgetEl) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        // Clamp to viewport
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w  = _widgetEl.offsetWidth;
        const h  = _widgetEl.offsetHeight;
        const newLeft = Math.max(0, Math.min(vw - w, startLeft + dx));
        const newTop  = Math.max(0, Math.min(vh - h, startTop  + dy));
        _widgetEl.style.left = `${newLeft}px`;
        _widgetEl.style.top  = `${newTop}px`;
    }

    function onEnd() {
        if (!isDragging) return;
        isDragging = false;
        header.style.cursor = 'grab';
        if (_widgetEl) _widgetEl.style.transition = '';
    }

    // Mouse
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.dw-btn')) return;
        e.preventDefault();
        onStart(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    document.addEventListener('mouseup', onEnd);

    // Touch (mobile / tablet)
    header.addEventListener('touchstart', (e) => {
        if (e.target.closest('.dw-btn')) return;
        const t = e.touches[0];
        onStart(t.clientX, t.clientY);
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const t = e.touches[0];
        onMove(t.clientX, t.clientY);
    }, { passive: true });
    document.addEventListener('touchend', onEnd);
}


// ── postMessage Bridge ──────────────────────────────────────────────────────

function _emitEvent(type, payload) {
    // 1. Dispatch CustomEvent for same-page listeners
    window.dispatchEvent(new CustomEvent(`rcm:${type}`, { detail: payload }));

    // 2. postMessage for cross-origin iframe consumers
    try {
        if (window.parent !== window) {
            window.parent.postMessage({ source: 'rcm-dialer', type, payload }, '*');
        }
    } catch { /* ignore cross-origin errors */ }
}

// Listen for incoming postMessage commands (bridge mode)
window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'rcm-dialer-command') return;
    const { command, args } = event.data;

    switch (command) {
        case 'initiate-call':
            // External trigger: { leadId, phone, leadName, callMode }
            // This would need integration with app-level logic
            _emitEvent('bridge-request', { command, args });
            break;
        case 'hangup':
            _handleHangup();
            break;
        case 'mute':
            _handleMute();
            break;
        case 'hold':
            _handleHold();
            break;
        case 'get-status':
            _emitEvent('status-response', getCallState());
            break;
    }
});


// ── Global SDK Handle ───────────────────────────────────────────────────────
// RCM-specific methods (isActive, getState, hangup, mute, hold) proxy
// to window.RCMDialer so rcm_widget.js needs zero changes.
// Aircall-specific methods (show, hide, dial) stay here.
// window.RCMDialer is set by rcm_dialer.js which loads before app.js.

window.rcmDialer = {
    show:     showDialerWidget,
    hide:     hideDialerWidget,
    dial:     showManualDialWidget,

    // RCM path: delegate to RCMDialer; fall back to machine for Aircall
    hangup:   () => window.RCMDialer?.isActive()
                        ? window.RCMDialer.hangup()
                        : _handleHangup(),
    mute:     () => window.RCMDialer?.isActive()
                        ? window.RCMDialer.mute()
                        : _handleMute(),
    hold:     () => window.RCMDialer?.isActive()
                        ? window.RCMDialer.hold()
                        : _handleHold(),
    isActive: ()  => (window.RCMDialer?.isActive() || isWidgetActive()),
    getState: ()  => window.RCMDialer?.isActive()
                        ? window.RCMDialer.getState()
                        : getCallState(),
};



// ── Utilities ───────────────────────────────────────────────────────────────

function _esc(str) {
    const el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
}


// ── BUG-04: Manual Dial Widget ───────────────────────────────────────────────
// Opens the widget in "dial mode" without a pre-existing call.
// Allows SDRs to type any number and initiate a call directly from the widget.
// The backend auto-matches or creates a lead for the number.

export function showManualDialWidget(options = {}) {
    // Same per-provider guard as handleCallAction() in app.js: RCM calls
    // are owned by RCMDialer, not the Aircall-only DialerMachine behind
    // isWidgetActive() — checking the wrong one lets a real RCM call go
    // undetected (or blocks dialling on stale DialerMachine state that was never
    // actually touched by a RCM call).
    const provider = (window._dialerConfig?.provider || '').toLowerCase();
    const _isActive = provider === 'rcm'
        ? window.RCMDialer?.isActive()
        : isWidgetActive();
    if (_isActive) {
        showToast('⚠️ A call is already active. End it first before dialling.', 'warning', 3000);
        return;
    }

    // v6.2.0: RCM SDRs → delegate to RCMWidget which renders
    // the manual dial input inside its own Call tab pane.
    // The widget returns a Promise resolving to { phone, callMode } | null.
    if (provider === 'rcm' && window._rcmWidgetReady && typeof RCMWidget !== 'undefined') {
        RCMWidget.openForManualDial().then(async (result) => {
            if (!result) return;  // user cancelled
            const { phone, callMode } = result;
            try {
                const { API_BASE, authHeaders } = await import('../auth.js');
                const res = await fetch(`${API_BASE}/api/calls/start`, {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone_number: phone, call_mode: callMode }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Call failed');

                // Use RCMDialer (same manager as lead-button calls), not
                // showDialerWidget — that drives the Aircall-only DialerMachine and
                // renders its own #dialer-widget DOM, causing a second, desynced UI
                // alongside RCMWidget's Call tab pane for RCM calls.
                // activate() already calls window._setPendingOutcome internally.
                await window.RCMDialer.activate(data, data.lead_name || 'Ad-hoc Call', phone, callMode);
            } catch (err) {
                // API failed — tell RCMWidget to revert to idle so user can retry
                console.error('[DialerSDK] Manual dial API error:', err);
                if (typeof RCMWidget?.notifyCallFailed === 'function') {
                    RCMWidget.notifyCallFailed(err.message);
                }
                showToast(`❌ Dial failed: ${err.message}`, 'error', 5000);
            }
        });
        return;
    }

    // ── Standalone manual dial widget (Aircall / non-RCM) ─────────────
    // Remove any existing manual dial widget
    document.getElementById('dw-manual-dial')?.remove();

    const el = document.createElement('div');
    el.id = 'dw-manual-dial';

    // Detect provider from global config (standalone Aircall widget path)
    const cfg = window._dialerConfig || {};
    const _legacyProvider = (cfg.provider || 'aircall').toLowerCase();
    const providerLabel = _legacyProvider === 'aircall' ? 'Aircall' : _legacyProvider === 'rcm' ? 'RCM' : 'Provider';
    const accentColor = _legacyProvider === 'aircall' ? '#00b388' : '#7c3aed';

    el.innerHTML = `
        <div style="position:fixed;bottom:24px;right:24px;width:300px;
                    background:linear-gradient(135deg,#1e1b4b,#312e81,#1e1b4b);
                    border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.08);
                    z-index:10000;font-family:'Inter',sans-serif;overflow:hidden;"
             id="dw-manual-inner">
            <!-- Header -->
            <div id="dw-manual-header" style="display:flex;align-items:center;gap:10px;padding:14px 16px 10px;cursor:grab;user-select:none;">
                <div style="display:flex;flex-direction:column;gap:3px;margin-right:2px;opacity:0.5;flex-shrink:0;">
                    <div style="display:flex;gap:4px;">
                        <div style="width:4px;height:4px;border-radius:50%;background:#fff;"></div>
                        <div style="width:4px;height:4px;border-radius:50%;background:#fff;"></div>
                    </div>
                    <div style="display:flex;gap:4px;">
                        <div style="width:4px;height:4px;border-radius:50%;background:#fff;"></div>
                        <div style="width:4px;height:4px;border-radius:50%;background:#fff;"></div>
                    </div>
                    <div style="display:flex;gap:4px;">
                        <div style="width:4px;height:4px;border-radius:50%;background:#fff;"></div>
                        <div style="width:4px;height:4px;border-radius:50%;background:#fff;"></div>
                    </div>
                </div>
                <div style="flex:1;">
                    <div style="font-size:0.82rem;font-weight:700;color:#fff;">Manual Dial</div>
                    <div style="font-size:0.7rem;color:rgba(255,255,255,0.55);">via ${providerLabel}</div>
                </div>
                <button id="dw-md-close" style="border:none;background:rgba(255,255,255,0.1);color:#fff;border-radius:6px;padding:4px 8px;font-size:0.75rem;cursor:pointer;">✕ Close</button>
            </div>
            <!-- Dial input -->
            <div style="padding:0 16px 16px;">
                <div style="font-size:0.65rem;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Phone Number</div>
                <div style="display:flex;gap:8px;">
                    <input type="tel" id="dw-md-number" placeholder="+91 9876543210"
                        style="flex:1;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);
                               border-radius:10px;padding:10px 12px;color:#fff;font-size:0.95rem;font-family:'Inter',sans-serif;
                               outline:none;" autocomplete="tel"/>
                </div>
                <div id="dw-md-tz" style="font-size:0.68rem;color:rgba(255,255,255,0.45);margin-top:5px;min-height:16px;"></div>
                <!-- Dial button -->
                <button id="dw-md-dial" style="margin-top:12px;width:100%;padding:12px;border:none;border-radius:12px;
                    background:${accentColor};color:#fff;font-size:0.9rem;font-weight:700;cursor:pointer;
                    display:flex;align-items:center;justify-content:center;gap:8px;transition:opacity 0.2s;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                    </svg>
                    Dial Now
                </button>
            </div>
        </div>`;
    document.body.appendChild(el);

    const inner = el.querySelector('#dw-manual-inner');
    const input = el.querySelector('#dw-md-number');
    const dialBtn = el.querySelector('#dw-md-dial');
    const tzLabel = el.querySelector('#dw-md-tz');

    // Animate in
    requestAnimationFrame(() => {
        inner.style.transition = 'opacity 0.25s ease, transform 0.25s cubic-bezier(0.34,1.56,0.64,1)';
        inner.style.opacity = '0';
        inner.style.transform = 'translateY(20px) scale(0.95)';
        requestAnimationFrame(() => {
            inner.style.opacity = '1';
            inner.style.transform = 'translateY(0) scale(1)';
        });
    });

    // Timezone preview as user types
    input.addEventListener('input', () => {
        try {
            const { getPhoneTimezone } = window._phoneTimezoneUtils || {};
            if (!getPhoneTimezone) { tzLabel.textContent = ''; return; }
            const info = getPhoneTimezone(input.value.trim());
            if (info) {
                const now = new Date();
                const local = now.toLocaleTimeString('en-US', { timeZone: info.tz, hour: '2-digit', minute: '2-digit', hour12: true });
                const hour = parseInt(now.toLocaleString('en-US', { timeZone: info.tz, hour: 'numeric', hour12: false }), 10);
                const dot = hour >= 8 && hour < 18 ? '🟢' : (hour >= 7 || hour < 20) ? '🟡' : '🔴';
                tzLabel.textContent = `${dot} ${info.label} · ${local} local`;
            } else {
                tzLabel.textContent = '';
            }
        } catch { tzLabel.textContent = ''; }
    });

    // Mode selection styling (RCM only)
    el.querySelectorAll('.dw-md-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            el.querySelectorAll('.dw-md-mode-btn').forEach(b => {
                b.style.background = 'transparent';
                b.style.color = 'rgba(255,255,255,0.55)';
                b.style.borderColor = 'rgba(255,255,255,0.12)';
                b.classList.remove('dw-md-mode-selected');
            });
            btn.style.background = 'rgba(255,255,255,0.12)';
            btn.style.color = '#fff';
            btn.style.borderColor = 'rgba(255,255,255,0.3)';
            btn.classList.add('dw-md-mode-selected');
            const radio = btn.closest('label').querySelector('input[type=radio]');
            if (radio) radio.checked = true;
        });
    });

    // Close
    el.querySelector('#dw-md-close').addEventListener('click', () => {
        inner.style.opacity = '0';
        inner.style.transform = 'translateY(10px) scale(0.95)';
        setTimeout(() => el.remove(), 250);
    });

    // Enter key to dial
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') dialBtn.click(); });

    // Drag on header
    const header = el.querySelector('#dw-manual-header');
    _makeDraggableEl(inner, header);

    // Dial
    dialBtn.addEventListener('click', async () => {
        const phone = input.value.trim();
        if (!phone) { input.style.borderColor = '#f87171'; setTimeout(() => input.style.borderColor = '', 1500); return; }

        // BUG-3 FIX: Route RCM manual dials through the unified mode selector modal
        // (same "Phone Bridge / Browser Call" modal used by lead 📞 buttons).
        // Aircall always uses 'bridge' mode (no browser calls).
        let callMode = 'bridge';
        if (provider === 'rcm' && typeof window._showCallModeSelector === 'function') {
            // Close the manual dial widget first so the modal isn't obscured
            inner.style.opacity = '0';
            inner.style.transform = 'translateY(10px) scale(0.95)';
            await new Promise(r => setTimeout(r, 200));
            el.remove();

            const chosen = await window._showCallModeSelector('Manual Dial', phone);
            if (!chosen) return;  // user cancelled
            callMode = chosen;
        } else {
            // Aircall / fallback: remove widget immediately
            inner.style.opacity = '0';
            inner.style.transform = 'translateY(10px) scale(0.95)';
            await new Promise(r => setTimeout(r, 200));
            el.remove();
        }

        dialBtn.disabled = true;
        dialBtn.innerHTML = '<span style="opacity:0.7;font-size:0.85rem;">Connecting…</span>';

        try {
            const { API_BASE, authHeaders } = await import('../auth.js');
            const res = await fetch(`${API_BASE}/api/calls/start`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone_number: phone, call_mode: callMode }),  // no lead_id
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Call failed');

            // Transition: show active call widget
            showDialerWidget(data, data.lead_name || 'Manual Dial', phone, { callMode });

            // Track pending outcome
            if (data.lead_id && window._setPendingOutcome) {
                window._setPendingOutcome({ leadId: data.lead_id, leadName: data.lead_name || 'Manual Dial', phone, callId: data.call_id });
            }
        } catch (err) {
            showToast(`❌ Dial failed: ${err.message}`, 'error', 5000);
        }
    });

    // Focus input
    setTimeout(() => input.focus(), 100);
}

/** Generic drag helper for an arbitrary element — used by manual dial widget */
function _makeDraggableEl(el, handle) {
    if (!el || !handle) return;
    let isDragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    function _pin() {
        const rect = el.getBoundingClientRect();
        el.style.position = 'fixed';
        el.style.left   = `${rect.left}px`;
        el.style.top    = `${rect.top}px`;
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
        el.style.transition = 'none';
    }

    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, input')) return;
        e.preventDefault();
        _pin();
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
        startLeft = parseFloat(el.style.left); startTop = parseFloat(el.style.top);
        handle.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = el.offsetWidth, h = el.offsetHeight;
        el.style.left = `${Math.max(0, Math.min(vw - w, startLeft + dx))}px`;
        el.style.top  = `${Math.max(0, Math.min(vh - h, startTop  + dy))}px`;
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
        handle.style.cursor = 'grab';
    });
}
