/**
 * dialerEngine.js — React port of frontend/js/messenger_dialer.js
 * =====================================================================
 * Owns the entire lifecycle of a Alternate Messenger call:
 *   IDLE → INITIATING → ACTIVE → ENDING → IDLE
 *
 * This is a FAITHFUL port — every guard, timer, and edge case from the
 * vanilla engine is preserved unchanged. What changed is only HOW the UI
 * observes state: a module-level singleton store (not React state — a
 * call must survive the React tree unmounting/remounting) exposed via
 * subscribe()/getSnapshot() for React's useSyncExternalStore, instead of
 * ad-hoc DOM manipulation triggered by CustomEvents.
 *
 * Backward compatibility (do not break):
 *   - window.AlternateMessengerDialer / window.alternatecrmDialer keep the exact same
 *     method surface (activate/hangup/mute/hold/isActive/getState/
 *     getInternalState/setInitiating/destroy/recoverFromActiveCall).
 *   - alternate:call-started / call-answered / call-ended CustomEvents keep
 *     firing with the exact same detail payload shapes, since app.js's own
 *     (still-vanilla) listener depends on them.
 *   - window._setPendingOutcome keeps getting called exactly as before.
 *
 * LiveKit stays a global window.LivekitClient (loaded via the existing CDN
 * <script> tag) — deliberately not bundled as an npm import, zero change to
 * how/when it loads.
 */

import { CallsService } from '../../../services/api';
import { getToken } from '../../../services/auth';
import { createStore } from './createStore';
import { toast } from './toast';

// ── State ────────────────────────────────────────────────────────────────────

const _INACTIVE = new Set(['IDLE', 'ENDING']);
const _TERMINAL = new Set([
  'CALL_ENDED', 'CALL_FAILED', 'CALL_MISSED',
  'disconnected', 'ended', 'failed', 'completed', 'no_answer', 'cancelled', 'busy',
]);

function _blank() {
  return {
    callId: null,
    leadId: null,
    leadName: '',
    phone: '',
    callMode: 'bridge',
    roomName: null,
    startTime: null,
    muted: false,
    held: false,
    connected: false,
  };
}

let _state = 'IDLE'; // IDLE | INITIATING | ACTIVE | ENDING
let _stateSetAt = Date.now();
let _ctx = _blank();
let _lkRoom = null;
let _pollInterval = null;
let _disconnectGraceTimer = null;

// ── useSyncExternalStore plumbing ───────────────────────────────────────────

const _store = createStore({ state: _state, ctx: { ..._ctx } });
export const subscribe = _store.subscribe;
export const getSnapshot = _store.getSnapshot;

function _notify() {
  _store.notify({ state: _state, ctx: { ..._ctx } });
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(`alternatecrm:${name}`, { detail }));
}

const _toast = toast;

function _setState(newState) {
  _state = newState;
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
  _ctx = _blank();
  _lkRoom = null;
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
  _clearGraceTimer();
  _notify();
}

// ── Flagged rollout guard ────────────────────────────────────────────────────
// During the rollout period BOTH this bundle and the old vanilla
// messenger_dialer.js are loaded on every page (index.html keeps both
// <script> tags until the React version is verified stable and the vanilla
// files are deleted). Both modules run their top-level side effects the
// moment they're parsed — ES module imports execute unconditionally,
// regardless of any later runtime check. Without this guard, importing this
// engine anywhere would unconditionally overwrite window.AlternateMessengerDialer,
// which the STILL-VANILLA messenger_widget.js reads directly (its hangup
// button calls the bare global `AlternateMessenger.hangup()`) — silently
// hijacking a live call's hangup button onto an engine that was never
// activated. Only take over the global (and the TTL/beforeunload side
// effects that act on it) when the React widget is actually the active one.
const _REACT_WIDGET_ENABLED = typeof localStorage !== 'undefined'
  && localStorage.getItem('messengerWidgetReact') !== 'false';

// ── 4-hour state TTL safety net ──────────────────────────────────────────────
// Belt-and-suspenders: even if the beforeunload beacon failed, the widget
// could stay stuck in ACTIVE forever. Auto-hangup after 4 hours — safely
// beyond any real call length.
const _TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const _TTL_CHECK_MS = 5 * 60 * 1000; // check every 5 minutes

if (_REACT_WIDGET_ENABLED) {
  setInterval(() => {
    if (_state === 'ACTIVE' && Date.now() - _stateSetAt > _TTL_MS) {
      console.warn('[dialerEngine] TTL: call active >4h — auto-hangup to release zombie state');
      AlternateMessenger.hangup();
    }
  }, _TTL_CHECK_MS);

  // ── beforeunload sendBeacon — ghost call prevention ────────────────────────
  // When the SDR closes the tab/window/navigates away while a call is active,
  // send a fire-and-forget beacon to force-end the call on the backend.
  // navigator.sendBeacon cannot send Authorization headers — embed token in body.
  window.addEventListener('beforeunload', () => {
    if (_INACTIVE.has(_state) || !_ctx?.callId) return;
    const token = getToken() || '';
    if (!token) return;
    const base = window.__CRM_API_BASE__ || window.__APP_CONFIG__?.API_BASE || '';
    const payload = JSON.stringify({ call_id: _ctx.callId, _token: token });
    try {
      navigator.sendBeacon(`${base}/api/calls/force-end`, payload);
    } catch {
      // sendBeacon may throw in some edge cases — silently ignore.
    }
  });

  // ── Page-refresh recovery ───────────────────────────────────────────────
  // app.js's own boot-time recovery check (`getMyActiveCall().then(data =>
  // AlternateMessenger.recoverFromActiveCall(data))`) calls the STATICALLY
  // IMPORTED vanilla messenger_dialer.js engine directly — that import is
  // compile-time-bound and unaffected by which bundle currently owns
  // window.AlternateMessengerDialer/window.MessengerWidget, so it can never reach
  // this engine. Without this, an SDR refreshing mid-call while the React
  // widget is active would see no active call at all: the vanilla engine
  // would "recover" silently in the background (its own dead widget never
  // renders it), while this engine stayed IDLE. Self-contained duplicate
  // bootstrap rather than editing app.js — keeps the vanilla boot path
  // completely untouched.
  CallsService.getMyActive().then((activeCallData) => {
    if (activeCallData?.active && !AlternateMessenger.isActive()) {
      AlternateMessenger.recoverFromActiveCall(activeCallData);
    }
  }).catch(() => {});
}

// ── Bridge mode: status polling ───────────────────────────────────────────────
// For bridge calls there's no LiveKit, so we poll the backend every 2s to:
//   1. Detect CALL_ANSWERED → fire alternate:call-answered (starts the timer)
//   2. Detect terminal status → auto-hangup (lead/bridge hung up without SDR clicking END)

async function _pollBridgeStatus() {
  if (_state !== 'ACTIVE') return; // guard — may have been called after hangup
  const { callId } = _ctx;
  if (!callId) return;

  try {
    const status = await CallsService.getStatus(callId);
    if (!status || _state !== 'ACTIVE') return; // re-check after async gap

    const raw = (status.status || '').trim();

    // ── Lead picked up ────────────────────────────────────────────────────
    if (raw === 'CALL_ANSWERED' && !_ctx.connected) {
      _ctx.connected = true;
      _ctx.startTime = Date.now();
      _notify();
      _emit('call-answered', {
        callId: _ctx.callId,
        leadName: _ctx.leadName,
        phone: _ctx.phone,
        startTime: _ctx.startTime,
        connected: true,
        callMode: _ctx.callMode,
      });
    }

    // ── Call over on backend ───────────────────────────────────────────────
    if (_TERMINAL.has(raw) || _TERMINAL.has(raw.toLowerCase())) {
      if (_pollInterval) {
        clearInterval(_pollInterval);
        _pollInterval = null;
      }
      if (!_INACTIVE.has(_state)) {
        await AlternateMessenger.hangup();
      }
    }
  } catch (err) {
    // 404 = call no longer exists on the backend → terminal, stop polling immediately.
    // This is the primary cause of zombie bridge pollers: a stale call_id returns
    // a 404 which was previously treated as a non-fatal network blip, keeping the
    // poll alive indefinitely.
    const is404 = err?.response?.status === 404 || err?.status === 404
      || /not found/i.test(err?.message || '') || /404/i.test(err?.message || '');
    if (is404) {
      console.warn('[dialerEngine] Poll 404 — call not found on backend, terminating poll');
      if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
      if (!_INACTIVE.has(_state)) { await AlternateMessenger.hangup(); }
      return;
    }
    // Other errors (transient network blip) — poll continues normally
    console.warn('[dialerEngine] Poll error (non-fatal, will retry):', err?.message || err);
  }
}

// ── LiveKit helpers (browser-mode only) ──────────────────────────────────────

async function _connectLiveKit(url, token) {
  if (!window.LivekitClient) {
    _toast('⚠️ Browser calling unavailable — LiveKit SDK not loaded', 'warning', 5000);
    return;
  }
  try {
    const room = new window.LivekitClient.Room({ adaptiveStream: true, dynacast: true });
    _lkRoom = room;

    room.on(window.LivekitClient.RoomEvent.ParticipantConnected, () => {
      // First remote participant = lead answered (Alternate Messenger bridges them in)
      _ctx.connected = true;
      _ctx.startTime = _ctx.startTime || Date.now();
      _notify();
      _emit('call-answered', {
        callId: _ctx.callId,
        leadName: _ctx.leadName,
        phone: _ctx.phone,
        startTime: _ctx.startTime,
        connected: true,
        callMode: _ctx.callMode,
      });
    });

    // RCA 2026-08-25 (live, prod): our own connection dropping fires
    // Disconnected (handled below), but the LEAD hanging up first fires this
    // instead — with no handler here, the engine stayed stuck ACTIVE forever
    // whenever the SDR didn't click the in-app hangup button. The NEXT call
    // attempt then had to go through handleCallAction's "client says active,
    // backend disagrees" auto-heal path, and the widget UI didn't reliably
    // reopen even though the new call itself still connected. Ending the
    // call here, the same as ParticipantConnected marks it started, keeps
    // the engine's state honest without waiting for the next call to notice.
    room.on(window.LivekitClient.RoomEvent.ParticipantDisconnected, () => {
      if (_INACTIVE.has(_state)) return;
      console.info('[dialerEngine] Lead left the room — ending call');
      AlternateMessenger.hangup();
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
      console.warn('[dialerEngine] LiveKit Disconnected (reason:', reason, ') — waiting to see if it recovers');
      _clearGraceTimer();
      _disconnectGraceTimer = setTimeout(() => {
        _disconnectGraceTimer = null;
        if (!_INACTIVE.has(_state)) {
          AlternateMessenger.hangup();
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
      track.detach().forEach((el) => el.remove());
    });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (err) {
    console.error('[dialerEngine] LiveKit connect failed:', err);
    _toast(`⚠️ Browser audio failed: ${err.message}`, 'warning', 5000);
    // Auto-hangup: the call is in a broken state (no audio). Reset widget to idle
    // rather than leaving it stuck at "Ringing..." with non-functional controls.
    if (!_INACTIVE.has(_state)) {
      AlternateMessenger.hangup();
    }
  }
}

function _disconnectLiveKit() {
  if (_lkRoom) {
    try { _lkRoom.disconnect(); } catch { /* ignore */ }
    _lkRoom = null;
  }
  document.querySelectorAll('#cd-audio-remote').forEach((el) => el.remove());
}

// ── Public API ───────────────────────────────────────────────────────────────

export const AlternateMessenger = {
  /**
   * Called immediately after POST /api/calls/start succeeds.
   * callResult = { call_id, room_name, livekit_token, livekit_url, provider, ... }
   */
  async activate(callResult, leadName, phone, callMode) {
    if (_state !== 'IDLE') {
      console.warn('[dialerEngine] activate() called in non-IDLE state:', _state);
      // Force-reset stale state (e.g. ENDING that never resolved) then proceed
      _reset();
    }

    _setState('INITIATING');
    _ctx = {
      ..._blank(),
      callId: callResult.call_id,
      leadId: callResult.lead_id || null,
      leadName: leadName || '',
      phone: phone || '',
      callMode: callMode || 'bridge',
      roomName: callResult.room_name || null,
    };

    // Store pending outcome so page-refresh recovery works (unchanged behaviour)
    window._setPendingOutcome?.({
      leadId: _ctx.leadId,
      leadName: _ctx.leadName,
      phone: _ctx.phone,
      callId: _ctx.callId,
    });

    // Fire call-started → widget UI shows the ringing state
    _emit('call-started', {
      callId: _ctx.callId,
      leadId: _ctx.leadId,
      leadName: _ctx.leadName,
      phone: _ctx.phone,
      callMode: _ctx.callMode,
      provider: 'messenger',
      connected: false,
      startTime: Date.now(),
    });

    _setState('ACTIVE');
    _notify();

    if (callMode === 'browser') {
      if (callResult.livekit_token && callResult.livekit_url) {
        // Browser mode: LiveKit fires call-answered when lead joins the room.
        // Don't await — let UI show "Ringing…" while LiveKit connects.
        _connectLiveKit(callResult.livekit_url, callResult.livekit_token);
      } else {
        // Alternate Messenger returned a call_id but no LiveKit token.
        // This happens when their API is degraded (e.g. 502 on token endpoint).
        // Don't silently fall to bridge polling — that would ring the SDR's phone
        // for a call they selected as browser mode.
        console.error('[dialerEngine] Browser mode selected but no livekit_token in response:', callResult);
        _toast('⚠️ Browser call failed — Alternate Messenger did not return audio credentials. Try again or switch to Phone Bridge.', 'error', 7000);
        AlternateMessenger.hangup();
      }
    } else {
      // Bridge mode: poll backend every 2s for CALL_ANSWERED / terminal status.
      // This is the ONLY mechanism that:
      //   a) fires alternate:call-answered (starts the timer when lead picks up)
      //   b) detects call end when the lead or bridge hangs up without SDR clicking END
      _pollInterval = setInterval(_pollBridgeStatus, 2000);
    }
  },

  /** SDR pressed End, or remote side hung up. */
  async hangup() {
    if (_INACTIVE.has(_state)) return; // already ended or idle

    const { callId, phone, leadId, leadName } = _ctx;
    _setState('ENDING');
    _notify();

    // Stop bridge poll immediately (safe to call even if null)
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }

    _disconnectLiveKit();

    if (callId) {
      try {
        // GROUND TRUTH: Alternate Messenger /calls/disconnect only needs call_id.
        await CallsService.disconnect(callId);
      } catch (err) {
        // Non-fatal — call may have already ended on the server
        console.warn('[dialerEngine] disconnect API error (non-fatal):', err.message);
      }
    }

    // Fire call-ended → app.js listener opens the outcome modal
    _emit('call-ended', { callId, leadId, leadName, phone, reason: 'user_hangup' });

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
        await CallsService.action(_ctx.callId, action, _ctx.roomName);
      }
      _ctx.muted = !_ctx.muted;
      _notify();
    } catch (err) {
      _toast(`Mute failed: ${err.message}`, 'error');
    }
  },

  /** Toggle hold. Always via API (hold applies to both bridge and browser). */
  async hold() {
    if (_state !== 'ACTIVE') return;
    try {
      const action = _ctx.held ? 'unhold' : 'hold';
      await CallsService.action(_ctx.callId, action, _ctx.roomName);
      _ctx.held = !_ctx.held;
      _notify();
    } catch (err) {
      _toast(`Hold failed: ${err.message}`, 'error');
    }
  },

  /**
   * True when a call is in progress from the user's perspective.
   * ENDING is excluded — the call is over once hangup() is called.
   */
  isActive() {
    return !_INACTIVE.has(_state);
  },

  /** Returns state shape: { leadName, phone, callMode, startTime, connected, muted, held, callId } */
  getState() {
    return { ..._ctx };
  },

  /**
   * Raw internal state string: 'IDLE' | 'INITIATING' | 'ACTIVE' | 'ENDING'.
   * Used to avoid resetting the UI to idle during the INITIATING phase
   * (async gap between mode selection and activate()).
   */
  getInternalState() {
    return _state;
  },

  /**
   * Called immediately BEFORE POST /api/calls/start is fired.
   * Sets state to INITIATING so consumers don't reset the widget to idle
   * during the async gap between mode selection and activate().
   * If startDialerCall fails, the caller calls destroy() to revert to IDLE.
   */
  setInitiating() {
    if (_state === 'IDLE') {
      _setState('INITIATING');
      _notify();
      console.info('[dialerEngine] state → INITIATING');
    }
  },

  /** Hard reset — use only for error recovery or page unload. */
  destroy() {
    _disconnectLiveKit();
    _reset();
  },

  /**
   * Restore widget state from a DB-confirmed active call after page reload.
   *
   * Called at app boot if GET /api/calls/my-active returns { active: true }
   * and the engine's in-memory state is IDLE (i.e. the page was reloaded
   * mid-call).
   *
   * IMPORTANT — Browser mode limitation:
   *   The LiveKit token is a one-time JWT. We cannot reconnect audio after a
   *   reload. Recovery is management-only: the widget shows the call state
   *   and End Call button. The SDR can cleanly end the call and log the
   *   outcome normally.
   */
  recoverFromActiveCall(callData) {
    if (!_INACTIVE.has(_state)) {
      console.warn('[dialerEngine] recoverFromActiveCall() called in non-IDLE state:', _state);
      return;
    }
    if (!callData?.call_id) return;

    _setState('INITIATING');
    _ctx = {
      callId: callData.call_id,
      leadId: callData.lead_id || null,
      leadName: callData.lead_name || 'Unknown Lead',
      phone: callData.phone || '',
      callMode: callData.call_mode || 'bridge',
      roomName: null,
      startTime: callData.answered_at
        ? new Date(callData.answered_at).getTime()
        : (callData.started_at ? new Date(callData.started_at).getTime() : Date.now()),
      muted: false,
      held: false,
      connected: !!callData.answered_at,
    };
    _setState('ACTIVE');
    _notify();

    // Restore pending outcome context so the outcome modal gets the right data
    window._setPendingOutcome?.({
      leadId: _ctx.leadId,
      leadName: _ctx.leadName,
      phone: _ctx.phone,
      callId: _ctx.callId,
    });

    // Fire call-started with recovered:true so the widget shows the recovery banner
    _emit('call-started', {
      callId: _ctx.callId,
      leadId: _ctx.leadId,
      leadName: _ctx.leadName,
      phone: _ctx.phone,
      callMode: _ctx.callMode,
      provider: 'messenger',
      connected: _ctx.connected,
      startTime: _ctx.startTime,
      recovered: true,
    });

    // Bridge mode: resume polling (detects if call already ended on Alternate Messenger side)
    // Browser mode: no LiveKit token available — audio cannot be restored.
    if (_ctx.callMode === 'bridge') {
      _pollInterval = setInterval(_pollBridgeStatus, 2000);
    }

    console.info(
      `[dialerEngine] Recovered call ${_ctx.callId} (${_ctx.callMode} mode, ${_ctx.connected ? 'answered' : 'ringing'})`
    );
  },
};

// Expose globally — preserves window.AlternateMessengerDialer as the exact same
// bridge target app.js already assigns to window.alternatecrmDialer. Guarded
// (see _REACT_WIDGET_ENABLED above) so the vanilla engine's own global isn't
// clobbered while the flag is off.
if (_REACT_WIDGET_ENABLED) {
  window.AlternateMessengerDialer = AlternateMessenger;
}
