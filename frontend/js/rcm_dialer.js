/**
 * rcm_dialer.js — Self-Contained RCM Call Manager
 * =============================================================
 *
 * Owns the entire lifecycle of a RCM call:
 *   IDLE → INITIATING → ACTIVE → ENDING → IDLE
 *
 * Replaces the dependency on dialer_machine.js for RCM calls.
 * dialer_machine.js is now Aircall-only.
 *
 * API:
 *   RCMDialer.activate(callResult, leadName, phone, callMode)
 *   RCMDialer.hangup()
 *   RCMDialer.mute()
 *   RCMDialer.hold()
 *   RCMDialer.isActive()   → boolean
 *   RCMDialer.getState()   → { callId, leadId, leadName, phone, callMode,
 *                                     startTime, muted, held, connected }
 *   RCMDialer.destroy()             → hard reset (page unload / error recovery)
 *   RCMDialer.recoverFromActiveCall() → restore widget after page reload mid-call
 *
 * Fires CustomEvents (same as before so rcm_widget.js needs NO changes):
 *   rcm:call-started  — when call initiates
 *   rcm:call-answered — bridge: when lead picks up; browser: LiveKit ParticipantConnected
 *   rcm:call-ended    — when call ends (triggers outcome modal in app.js)
 *
 * Import:
 *   import { disconnectCall, callAction, getCallStatus } from './api.js';
 *   import { RCMDialer } from './rcm_dialer.js';
 *
 * Load order (index.html — must come before app.js):
 *   dialer_machine.js → rcm_widget.js
 *   → rcm_dialer.js (type="module") → app.js (type="module")
 */

import { disconnectCall, callAction, getCallStatus, forceEndCall, getMyActiveCall } from './api.js';
import { API_BASE } from './auth.js';

import { showToast } from './utils.js';

// ── State ────────────────────────────────────────────────────────────────────

// Valid states and the ones considered "inactive" for isActive() checks.
const _INACTIVE = new Set(['IDLE', 'ENDING']);

// Terminal call statuses — any of these means the call is over on the backend.
const _TERMINAL = new Set([
    'CALL_ENDED', 'CALL_FAILED', 'CALL_MISSED',
    'disconnected', 'ended', 'failed', 'completed', 'no_answer', 'cancelled', 'busy',
]);

let _state        = 'IDLE';    // IDLE | INITIATING | ACTIVE | ENDING
let _stateSetAt   = Date.now(); // tracks when _state last changed (for 4h TTL)
let _ctx          = _blank();  // call context — reset on every new call
let _lkRoom       = null;      // LiveKit Room instance (browser mode only)
let _pollInterval = null;      // bridge-mode status poll (setInterval handle)
let _disconnectGraceTimer = null;  // browser-mode: grace window before treating a LiveKit
                                    // Disconnected event as a real hangup (see _connectLiveKit)

function _blank() {
    return {
        callId:    null,
        leadId:    null,
        leadName:  '',
        phone:     '',
        callMode:  'bridge',  // 'browser' | 'bridge'
        roomName:  null,
        startTime: null,
        muted:     false,
        held:      false,
        connected: false,
    };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(`rcm:${name}`, { detail }));
}

/** Centralised state setter — always tracks when state last changed for TTL checks. */
function _setState(newState) {
    _state      = newState;
    _stateSetAt = Date.now();
}

function _clearGraceTimer() {
    if (_disconnectGraceTimer) {
        clearTimeout(_disconnectGraceTimer);
        _disconnectGraceTimer = null;
    }
}

function _reset() {
    _setState('IDLE');
    _ctx    = _blank();
    _lkRoom = null;
    // Always clear bridge poll on reset — prevents stale intervals after page nav
    if (_pollInterval) {
        clearInterval(_pollInterval);
        _pollInterval = null;
    }
    _clearGraceTimer();
}

// ── T2: 4-hour state TTL safety net ─────────────────────────────────────────
// Belt-and-suspenders: even if beforeunload beacon failed AND EC-16 auto-healed
// the backend, the widget could stay stuck in ACTIVE forever.
// This interval auto-hangups after 4 hours — safely beyond any real call length.
const _TTL_MS       = 4 * 60 * 60 * 1000;  // 4 hours
const _TTL_CHECK_MS = 5 * 60 * 1000;       // check every 5 minutes
setInterval(() => {
    if (_state === 'ACTIVE' && (Date.now() - _stateSetAt) > _TTL_MS) {
        console.warn('[RCMDialer] TTL: call active >4h — auto-hangup to release zombie state');
        RCMDialer.hangup();
    }
}, _TTL_CHECK_MS);

// ── T2: beforeunload sendBeacon — ghost call prevention ──────────────────────
// When the SDR closes the tab/window/navigates away while a call is active,
// send a fire-and-forget beacon to force-end the call on the backend.
// navigator.sendBeacon cannot send Authorization headers — embed token in body.
window.addEventListener('beforeunload', () => {
    if (_INACTIVE.has(_state) || !_ctx?.callId) return;
    const token = localStorage.getItem('crm_token') || '';
    if (!token) return;
    const payload = JSON.stringify({ call_id: _ctx.callId, _token: token });
    try {
        navigator.sendBeacon(`${API_BASE}/api/calls/force-end`, payload);
    } catch {
        // sendBeacon may throw in some edge cases — silently ignore.
    }
});

// ── Bridge mode: status polling ───────────────────────────────────────────────
// For bridge calls there's no LiveKit, so we poll the backend every 2 s to:
//   1. Detect CALL_ANSWERED → fire rcm:call-answered (starts the timer)
//   2. Detect terminal status → auto-hangup (lead/bridge hung up without SDR clicking END)

async function _pollBridgeStatus() {
    if (_state !== 'ACTIVE') return;          // guard — may have been called after hangup
    const { callId } = _ctx;
    if (!callId) return;

    try {
        const status = await getCallStatus(callId);
        if (!status || _state !== 'ACTIVE') return;   // re-check after async gap

        const raw = (status.status || '').trim();

        // ── Lead picked up ────────────────────────────────────────────────────
        if (raw === 'CALL_ANSWERED' && !_ctx.connected) {
            _ctx.connected = true;
            _ctx.startTime = Date.now();
            _emit('call-answered', {
                callId:    _ctx.callId,
                leadName:  _ctx.leadName,
                phone:     _ctx.phone,
                startTime: _ctx.startTime,
                connected: true,
                callMode:  _ctx.callMode,
            });
        }

        // ── Call over on backend ───────────────────────────────────────────────
        if (_TERMINAL.has(raw) || _TERMINAL.has(raw.toLowerCase())) {
            // Stop polling immediately — hangup() will _reset() and clear it too
            if (_pollInterval) {
                clearInterval(_pollInterval);
                _pollInterval = null;
            }
            if (!_INACTIVE.has(_state)) {
                await RCMDialer.hangup();
            }
        }
    } catch (err) {
        // 404 = call no longer exists on the backend → terminal, stop polling immediately.
        // This is the primary cause of zombie bridge pollers: a stale call_id returns
        // {"detail":"Call not found"} (404) which was previously treated as a non-fatal
        // network blip, keeping the poll alive indefinitely.
        const is404 = (err?.status === 404)
            || (err?.response?.status === 404)
            || /not found/i.test(err?.message || '')
            || /404/i.test(err?.message || '');
        if (is404) {
            console.warn('[RCMDialer] Poll 404 — call not found on backend, terminating poll');
            if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
            if (!_INACTIVE.has(_state)) { await RCMDialer.hangup(); }
            return;
        }
        // Other errors (transient network blip) — poll continues normally
        console.warn('[RCMDialer] Poll error (non-fatal, will retry):', err?.message || err);
    }
}

// ── LiveKit helpers (browser-mode only) ──────────────────────────────────────

async function _connectLiveKit(url, token) {
    if (!window.LivekitClient) {
        showToast('⚠️ Browser calling unavailable — LiveKit SDK not loaded', 'warning', 5000);
        return;
    }
    try {
        const room = new window.LivekitClient.Room({ adaptiveStream: true, dynacast: true });
        _lkRoom = room;

        room.on(window.LivekitClient.RoomEvent.ParticipantConnected, () => {
            // First remote participant = lead answered (RCM bridges them in)
            _ctx.connected = true;
            _ctx.startTime = _ctx.startTime || Date.now();
            _emit('call-answered', {
                callId:    _ctx.callId,
                leadName:  _ctx.leadName,
                phone:     _ctx.phone,
                startTime: _ctx.startTime,
                connected: true,
                callMode:  _ctx.callMode,
            });
        });

        // RCA 2026-07-22: previously called hangup() the instant Disconnected fired.
        // LiveKit emits Disconnected on ANY connection drop, including a transient
        // network blip it then recovers from on its own (Reconnecting → Reconnected) —
        // ending the call immediately made the widget disappear mid-call on a brief
        // hiccup. Give it a grace window to self-heal before treating it as final;
        // Reconnecting/Reconnected cancel the pending hangup if it recovers in time.
        room.on(window.LivekitClient.RoomEvent.Reconnecting, _clearGraceTimer);
        room.on(window.LivekitClient.RoomEvent.Reconnected, _clearGraceTimer);
        room.on(window.LivekitClient.RoomEvent.Disconnected, (reason) => {
            if (_INACTIVE.has(_state)) return;
            console.warn('[RCMDialer] LiveKit Disconnected (reason:', reason, ') — waiting to see if it recovers');
            _clearGraceTimer();
            _disconnectGraceTimer = setTimeout(() => {
                _disconnectGraceTimer = null;
                if (!_INACTIVE.has(_state)) {
                    RCMDialer.hangup();
                }
            }, 4000);
        });

        room.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track) => {
            if (track.kind === 'audio') {
                const el = track.attach();
                el.id = 'cd-audio-remote';
                document.body.appendChild(el);
            }
        });

        room.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
            track.detach().forEach(el => el.remove());
        });

        await room.connect(url, token);
        await room.localParticipant.setMicrophoneEnabled(true);

    } catch (err) {
        console.error('[RCMDialer] LiveKit connect failed:', err);
        showToast(`⚠️ Browser audio failed: ${err.message}`, 'warning', 5000);
        // Auto-hangup: the call is in a broken state (no audio). Reset widget to idle
        // rather than leaving it stuck at "Ringing..." with non-functional controls.
        if (!_INACTIVE.has(_state)) {
            RCMDialer.hangup();
        }
    }
}

function _disconnectLiveKit() {
    if (_lkRoom) {
        try { _lkRoom.disconnect(); } catch { /* ignore */ }
        _lkRoom = null;
    }
    document.querySelectorAll('#cd-audio-remote').forEach(el => el.remove());
}

// ── Public API ───────────────────────────────────────────────────────────────

export const RCMDialer = {

    /**
     * Called by app.js immediately after POST /api/calls/start succeeds.
     * callResult = { call_id, room_name, livekit_token, livekit_url, provider, ... }
     */
    async activate(callResult, leadName, phone, callMode) {
        if (_state !== 'IDLE') {
            console.warn('[RCMDialer] activate() called in non-IDLE state:', _state);
            // Force-reset stale state (e.g. ENDING that never resolved) then proceed
            _reset();
        }

        _setState('INITIATING');
        _ctx = {
            ..._blank(),
            callId:   callResult.call_id,
            leadId:   callResult.lead_id  || null,
            leadName: leadName             || '',
            phone:    phone                || '',
            callMode: callMode             || 'bridge',
            roomName: callResult.room_name || null,
        };

        // Store pending outcome so page-refresh recovery works (unchanged behaviour)
        window._setPendingOutcome?.({
            leadId:   _ctx.leadId,
            leadName: _ctx.leadName,
            phone:    _ctx.phone,
            callId:   _ctx.callId,
        });

        // Fire call-started → rcm_widget.js _renderCallActive (ringing state)
        _emit('call-started', {
            callId:    _ctx.callId,
            leadId:    _ctx.leadId,
            leadName:  _ctx.leadName,
            phone:     _ctx.phone,
            callMode:  _ctx.callMode,
            provider:  'rcm',
            connected: false,
            startTime: Date.now(),
        });

        _setState('ACTIVE');

        if (callMode === 'browser') {
            if (callResult.livekit_token && callResult.livekit_url) {
                // Browser mode: LiveKit fires call-answered when lead joins the room
                // Don't await — let UI show "Ringing…" while LiveKit connects
                _connectLiveKit(callResult.livekit_url, callResult.livekit_token);
            } else {
                // RCM returned a call_id but no LiveKit token.
                // This happens when their API is degraded (e.g. 502 on token endpoint).
                // Don't silently fall to bridge polling — that would ring the SDR's phone
                // for a call they selected as browser mode.
                console.error('[RCMDialer] Browser mode selected but no livekit_token in response:', callResult);
                showToast('⚠️ Browser call failed — RCM did not return audio credentials. Try again or switch to Phone Bridge.', 'error', 7000);
                RCMDialer.hangup();
            }
        } else {
            // Bridge mode: poll backend every 2 s for CALL_ANSWERED / terminal status.
            // This is the ONLY mechanism that:
            //   a) fires rcm:call-answered (starts the timer when lead picks up)
            //   b) detects call end when the lead or bridge hangs up without SDR clicking END
            _pollInterval = setInterval(_pollBridgeStatus, 2000);
        }
    },

    /** SDR pressed End, or remote side hung up. */
    async hangup() {
        if (_INACTIVE.has(_state)) return;   // already ended or idle

        const { callId, phone, leadId, leadName } = _ctx;
        _setState('ENDING');

        // Stop bridge poll immediately (safe to call even if null)
        if (_pollInterval) {
            clearInterval(_pollInterval);
            _pollInterval = null;
        }

        _disconnectLiveKit();

        if (callId) {
            try {
                // GROUND TRUTH: RCM /calls/disconnect only needs call_id.
                // No phone_number — that was our wrong assumption.
                await disconnectCall(callId);
            } catch (err) {
                // Non-fatal — call may have already ended on the server
                console.warn('[RCMDialer] disconnect API error (non-fatal):', err.message);
            }
        }


        // Fire call-ended → app.js listener opens outcome modal
        _emit('call-ended', {
            callId,
            leadId,
            leadName,
            phone,
            reason: 'user_hangup',
        });

        _reset();
    },

    /** Toggle microphone mute. Browser mode: LiveKit. Bridge mode: API. */
    async mute() {
        if (_state !== 'ACTIVE') return;
        try {
            if (_ctx.callMode === 'browser' && _lkRoom) {
                const nowEnabled = _lkRoom.localParticipant.isMicrophoneEnabled;
                await _lkRoom.localParticipant.setMicrophoneEnabled(!nowEnabled);
            } else {
                const action = _ctx.muted ? 'unmute' : 'mute';
                await callAction(_ctx.callId, action, _ctx.roomName);
            }
            _ctx.muted = !_ctx.muted;
        } catch (err) {
            showToast(`Mute failed: ${err.message}`, 'error');
        }
    },

    /** Toggle hold. Always via API (hold applies to both bridge and browser). */
    async hold() {
        if (_state !== 'ACTIVE') return;
        try {
            const action = _ctx.held ? 'unhold' : 'hold';
            await callAction(_ctx.callId, action, _ctx.roomName);
            _ctx.held = !_ctx.held;
        } catch (err) {
            showToast(`Hold failed: ${err.message}`, 'error');
        }
    },

    /**
     * True when a call is in progress from the user's perspective.
     * ENDING is excluded — the call is over once hangup() is called.
     */
    isActive() {
        return !_INACTIVE.has(_state);
    },

    /**
     * Returns state shape matching what rcm_widget.js _renderCallActive expects:
     * { leadName, phone, callMode, startTime, connected, muted, held, callId }
     */
    getState() {
        return { ..._ctx };
    },

    /**
     * Returns the raw internal state string: 'IDLE' | 'INITIATING' | 'ACTIVE' | 'ENDING'.
     * Used by rcm_widget.js _syncCallPane to avoid resetting the UI to idle
     * during the INITIATING phase (async gap between mode selection and activate()).
     */
    getInternalState() {
        return _state;
    },

    /**
     * Called by app.js immediately BEFORE POST /api/calls/start is fired.
     * Sets state to INITIATING so _syncCallPane() doesn't reset widget to idle
     * during the async gap between mode selection and activate().
     * If startDialerCall fails, app.js calls destroy() to revert to IDLE.
     */
    setInitiating() {
        if (_state === 'IDLE') {
            _setState('INITIATING');
            console.info('[RCMDialer] state → INITIATING');
        }
    },

    /** Hard reset — use only for error recovery or page unload. */
    destroy() {
        _disconnectLiveKit();
        _reset();
    },

    /**
     * T3: Restore widget state from a DB-confirmed active call after page reload.
     *
     * Called by app.js startup if GET /api/calls/my-active returns { active: true }
     * and the widget's in-memory state is IDLE (i.e. the page was reloaded mid-call).
     *
     * IMPORTANT — Browser mode limitation:
     *   The LiveKit token is a one-time JWT. We cannot reconnect audio after a reload.
     *   Recovery is management-only: the widget shows the call state and End Call button.
     *   The SDR can cleanly end the call and log the outcome normally.
     *
     * @param {Object} callData  Response from GET /api/calls/my-active
     */
    recoverFromActiveCall(callData) {
        if (!_INACTIVE.has(_state)) {
            console.warn('[RCMDialer] recoverFromActiveCall() called in non-IDLE state:', _state);
            return;
        }
        if (!callData?.call_id) return;

        _setState('INITIATING');
        _ctx = {
            callId:    callData.call_id,
            leadId:    callData.lead_id    || null,
            leadName:  callData.lead_name  || 'Unknown Lead',
            phone:     callData.phone      || '',
            callMode:  callData.call_mode  || 'bridge',
            roomName:  null,
            startTime: callData.answered_at
                ? new Date(callData.answered_at).getTime()
                : (callData.started_at ? new Date(callData.started_at).getTime() : Date.now()),
            muted:     false,
            held:      false,
            connected: !!callData.answered_at,
        };
        _setState('ACTIVE');

        // Restore pending outcome context so the outcome modal gets the right data
        window._setPendingOutcome?.({
            leadId:   _ctx.leadId,
            leadName: _ctx.leadName,
            phone:    _ctx.phone,
            callId:   _ctx.callId,
        });

        // Fire call-started with recovered:true so the widget shows the recovery banner
        _emit('call-started', {
            callId:    _ctx.callId,
            leadId:    _ctx.leadId,
            leadName:  _ctx.leadName,
            phone:     _ctx.phone,
            callMode:  _ctx.callMode,
            provider:  'rcm',
            connected: _ctx.connected,
            startTime: _ctx.startTime,
            recovered: true,  // widget uses this to show the recovery banner
        });

        // Bridge mode: resume polling (detects if call already ended on RCM side)
        // Browser mode: no LiveKit token available — audio cannot be restored.
        if (_ctx.callMode === 'bridge') {
            _pollInterval = setInterval(_pollBridgeStatus, 2000);
        }

        console.info(
            `[RCMDialer] Recovered call ${_ctx.callId} ` +
            `(${_ctx.callMode} mode, ${_ctx.connected ? 'answered' : 'ringing'})`
        );
    },
};

// Expose globally so window.rcmDialer proxy (in dialer_widget.js) can
// delegate to us, and so rcm_widget.js's hangup button can call us
// directly via the bare global.
//
// Guarded during the React port's flagged rollout: this module is reachable
// ONLY via app.js's `import './rcm_dialer.js'` — an ES module import,
// resolved as part of app.js's (deferred, type="module") dependency graph,
// which always runs AFTER every classic <script> tag has already executed —
// including dialerEngine.js's own flag-gated `window.RCMDialer`
// assignment. Without this guard, this line would unconditionally run LAST
// and silently overwrite the React engine's takeover on every page load,
// regardless of the flag. See dialerEngine.js's matching guard/comment.
if (localStorage.getItem('rcmWidgetReact') !== 'true') {
    window.RCMDialer = RCMDialer;
}
