/**
 * dialer_machine.js — RCM Dialer Finite State Machine
 * ===========================================================
 * Replaces 17 scattered module-level variables across dialer_widget.js and
 * rcm_widget.js with a single, explicit state machine.
 *
 * States:
 *   IDLE           → no active call
 *   AWAITING_MODE  → user clicked "Call", mode selector modal is open
 *   INITIATING     → POST /api/calls/start in flight
 *   RINGING        → call_id received, polling started, awaiting answer
 *   CONNECTED      → call answered (both parties live)
 *   HELD           → call on hold
 *   ENDING         → hangup sent, waiting for terminal status
 *   ENDED          → terminal; auto-transitions to IDLE after 5s
 *   FAILED         → terminal error; auto-transitions to IDLE after 8s
 *
 * Replaces:
 *   _callState        → machine.context
 *   _callAnswered     → state === 'CONNECTED' | 'HELD'
 *   _timerInterval    → machine._timerInterval (internal)
 *   _pollInterval     → machine._pollInterval (internal)
 *   _livekitRoom      → machine.context.livekitRoom
 *   _isMinimized      → machine.context.minimized
 *   _escHandler       → machine._escHandler (internal)
 *   _pendingModeResolve → machine._pendingModeResolve (internal)
 *   _pendingCallCtx   → machine.context.pendingCallCtx
 *   _cwTimerInterval  → machine._cwTimerInterval (internal)
 *   _dialerHideStyle  → eliminated (machine drives both widgets)
 *   _activeSyncTimer  → eliminated (machine's CONNECTED state is the sync)
 *
 * Fixes:
 *   BUG-10  Timer starts only on CONNECTED transition (not on widget show)
 *   BUG-05  Minimize flag lives in machine.context — persists across re-renders
 *   Guard3  45s RINGING timeout is a first-class machine transition
 *   EC-2    callId captured at transition time, not from closure-shared variable
 *   Race conditions: state transitions are synchronous and guarded by current state
 *
 * Usage:
 *   window.DialerMachine.send('START_CALL', { callId, roomName, ... })
 *   window.DialerMachine.getState()   // → { name, context }
 *   window.DialerMachine.is('RINGING')
 *   window.DialerMachine.on('transition', handler)
 *   window.DialerMachine.on('timer:tick', handler)
 *
 * Load BEFORE rcm_widget.js and dialer_widget.js.
 */

(function (global) {
    'use strict';

    // ── Constants ────────────────────────────────────────────────────────────

    const POLL_INTERVAL_MS    = 2000;
    const GUARD3_TIMEOUT_MS   = 45_000;  // max ringing before auto-hangup
    const ANSWER_FALLBACK_MS  = 60_000;  // start timer even if answered status never arrives
    const ENDED_AUTODISMISS_MS = 5_000;
    const FAILED_AUTODISMISS_MS = 8_000;

    const TERMINAL_RAW = new Set([
        'CALL_ENDED', 'CALL_FAILED', 'CALL_MISSED',
        'disconnected', 'ended', 'failed', 'completed',
        'no_answer', 'cancelled', 'busy',
    ]);

    const ANSWERED_RAW = new Set([
        'CALL_ANSWERED', 'active', 'connected', 'answered',
        'in-progress', 'in_progress',
    ]);

    // ── Valid state names (used to catch typos) ──────────────────────────────

    const STATES = new Set([
        'IDLE', 'AWAITING_MODE', 'INITIATING',
        'RINGING', 'CONNECTED', 'HELD',
        'ENDING', 'ENDED', 'FAILED',
    ]);

    // ── State machine factory ─────────────────────────────────────────────────

    function createDialerMachine() {

        // ── Private state ────────────────────────────────────────────────────

        let _state = 'IDLE';

        /** @type {Object} All call-specific data. Reset on every new call. */
        let _ctx = _emptyContext();

        /** @type {Map<string, Set<Function>>} event → handlers */
        const _listeners = new Map();

        // Internal timer references — never leaked to consumers
        let _pollInterval    = null;
        let _timerInterval   = null;
        let _guard3Timer     = null;
        let _answerFallback  = null;
        let _dismissTimer    = null;
        let _cwTimerInterval = null;
        let _escHandler      = null;

        // Pending mode resolution (for the mode-select modal)
        let _pendingModeResolve = null;

        // ── Context helpers ─────────────────────────────────────────────────

        function _emptyContext() {
            return {
                // call identity
                callId:      null,
                roomName:    null,
                phone:       null,
                leadName:    null,
                leadId:      null,
                callMode:    null,   // 'browser' | 'bridge'
                provider:    null,

                // LiveKit
                livekitRoom:  null,
                livekitToken: null,
                livekitUrl:   null,

                // timing
                startTime:    null,   // epoch ms when call was answered
                duration:     0,      // seconds, from polling

                // UI flags
                minimized:    false,
                muted:        false,
                held:         false,

                // pending (before mode selection)
                pendingCallCtx: null,

                // last error
                error: null,
            };
        }

        // ── Internal event bus ───────────────────────────────────────────────

        function _emit(event, data) {
            const handlers = _listeners.get(event);
            if (handlers) {
                handlers.forEach(fn => {
                    try { fn(data); }
                    catch (e) { console.error(`[DialerMachine] listener error (${event}):`, e); }
                });
            }
        }

        // ── Transition guard ─────────────────────────────────────────────────

        function _transition(newState, contextPatch) {
            if (!STATES.has(newState)) {
                console.error(`[DialerMachine] Unknown state: ${newState}`);
                return;
            }
            const prev = _state;
            _state = newState;
            if (contextPatch) Object.assign(_ctx, contextPatch);

            _emit('transition', { from: prev, to: newState, context: { ..._ctx } });
        }

        // ── Timer management ─────────────────────────────────────────────────

        function _startPolling(pollFn) {
            if (_pollInterval) return;
            _pollInterval = setInterval(pollFn, POLL_INTERVAL_MS);
        }

        function _stopPolling() {
            if (_pollInterval) {
                clearInterval(_pollInterval);
                _pollInterval = null;
            }
        }

        /** Starts or resets the answered-call timer. Safe to call repeatedly. */
        function _startAnsweredTimer() {
            if (_timerInterval) return;  // already running
            _ctx.startTime = _ctx.startTime || Date.now();
            _timerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - _ctx.startTime) / 1000);
                _emit('timer:tick', { seconds: elapsed });
            }, 1000);
        }

        function _stopTimers() {
            if (_timerInterval)   { clearInterval(_timerInterval);   _timerInterval = null;   }
            if (_pollInterval)    { clearInterval(_pollInterval);     _pollInterval = null;     }
            if (_guard3Timer)     { clearTimeout(_guard3Timer);       _guard3Timer = null;       }
            if (_answerFallback)  { clearTimeout(_answerFallback);    _answerFallback = null;    }
            if (_dismissTimer)    { clearTimeout(_dismissTimer);      _dismissTimer = null;      }
            if (_cwTimerInterval) { clearInterval(_cwTimerInterval);  _cwTimerInterval = null;  }
            if (_escHandler) {
                document.removeEventListener('keydown', _escHandler);
                _escHandler = null;
            }
        }

        // ── Guard 3: ringing timeout ─────────────────────────────────────────
        // RCM returns stale "ringing" for 30-90s after a decline.
        // After GUARD3_TIMEOUT_MS with no answer, auto-send TIMEOUT event.
        // EC-2 fix: capture callId at schedule time — not at fire time — so
        //           a second call cannot accidentally trigger this timer.

        function _scheduleGuard3(capturedCallId) {
            if (_guard3Timer) clearTimeout(_guard3Timer);
            _guard3Timer = setTimeout(() => {
                if (_state !== 'RINGING') return;
                if (_ctx.callId !== capturedCallId) return;
                console.warn('[DialerMachine] Guard3: 45s ringing timeout — auto-ending call');
                machine.send('TIMEOUT');
            }, GUARD3_TIMEOUT_MS);
        }

        function _scheduleAnswerFallback(capturedCallId) {
            if (_answerFallback) clearTimeout(_answerFallback);
            _answerFallback = setTimeout(() => {
                if (_state !== 'RINGING') return;
                if (_ctx.callId !== capturedCallId) return;
                // BUG-10 fix: if we never saw an answered status, start timer anyway
                _startAnsweredTimer();
            }, ANSWER_FALLBACK_MS);
        }

        // ── ESC key handler ──────────────────────────────────────────────────

        function _installEscHandler() {
            if (_escHandler) return;
            _escHandler = (e) => {
                if (e.key !== 'Escape') return;
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (_state === 'RINGING' || _state === 'CONNECTED' || _state === 'HELD') {
                    machine.send('HANGUP');
                }
            };
            document.addEventListener('keydown', _escHandler);
        }

        // ── Public machine API ───────────────────────────────────────────────

        const machine = {

            /**
             * Subscribe to machine events.
             * Events: 'transition', 'timer:tick'
             */
            on(event, handler) {
                if (!_listeners.has(event)) _listeners.set(event, new Set());
                _listeners.get(event).add(handler);
                return () => _listeners.get(event).delete(handler);  // returns unsubscribe fn
            },

            /** Current state name. */
            getState() {
                return { name: _state, context: { ..._ctx } };
            },

            /** True if the machine is in the given state. */
            is(stateName) {
                return _state === stateName;
            },

            /** True if a call is currently active (non-IDLE, non-FAILED, non-terminal). */
            isActive() {
                // ENDING is included here — it is transient (CONNECTED→ENDED) and from
                // the user's perspective the call is already over when ENDING is reached.
                // Excluding it prevents _handleHangup races from permanently blocking dials.
                return !['IDLE', 'FAILED', 'ENDED', 'ENDING'].includes(_state);
            },


            /**
             * Send an event to the machine.
             *
             * Events and required payload fields:
             *
             *  AWAIT_MODE         { pendingCallCtx: { leadId, leadName, phone } }
             *  MODE_SELECTED      { mode: 'browser'|'bridge' }
             *  MODE_CANCELLED     {}
             *  INITIATE           {}  (transitions AWAITING_MODE → INITIATING)
             *  START_CALL         { callId, roomName, phone, leadName, leadId, callMode,
             *                       provider, livekitToken?, livekitUrl? }
             *  POLL_UPDATE        { rawStatus, duration? }
             *  ANSWERED           {}  (explicit answered event from LiveKit participant join)
             *  HOLD               {}
             *  RESUME             {}
             *  HANGUP             {}
             *  TIMEOUT            {}  (Guard3 — internal use)
             *  CALL_ENDED_LOCAL   {}  (widget disconnect before webhook)
             *  RESET              {}  (force back to IDLE — emergency escape)
             */
            send(event, payload = {}) {
                const prev = _state;

                switch (event) {

                    // ── AWAIT_MODE: user clicked Call, show mode selector ──────
                    case 'AWAIT_MODE':
                        if (_state !== 'IDLE') break;
                        _ctx.pendingCallCtx = payload.pendingCallCtx || null;
                        _transition('AWAITING_MODE');
                        // Resolve the mode-select promise used by rcm_widget.js
                        if (_pendingModeResolve) {
                            _pendingModeResolve = null;
                        }
                        break;

                    // ── MODE_SELECTED: SDR picked bridge or browser ────────────
                    case 'MODE_SELECTED':
                        if (_state !== 'AWAITING_MODE') break;
                        _transition('INITIATING', { callMode: payload.mode || 'browser' });
                        if (_pendingModeResolve) {
                            _pendingModeResolve(payload.mode);
                            _pendingModeResolve = null;
                        }
                        break;

                    // ── MODE_CANCELLED: SDR closed mode modal ─────────────────
                    case 'MODE_CANCELLED':
                        if (_state !== 'AWAITING_MODE') break;
                        if (_pendingModeResolve) {
                            _pendingModeResolve(null);
                            _pendingModeResolve = null;
                        }
                        _ctx = _emptyContext();
                        _transition('IDLE');
                        break;

                    // ── START_CALL: backend returned call_id ──────────────────
                    case 'START_CALL':
                        if (!['INITIATING', 'IDLE'].includes(_state)) break;
                        _stopTimers();
                        _ctx = {
                            ..._emptyContext(),
                            callId:       payload.callId       || null,
                            roomName:     payload.roomName     || null,
                            phone:        payload.phone        || null,
                            leadName:     payload.leadName     || '',
                            leadId:       payload.leadId       || null,
                            callMode:     payload.callMode     || 'browser',
                            provider:     payload.provider     || 'rcm',
                            livekitToken: payload.livekitToken || null,
                            livekitUrl:   payload.livekitUrl   || null,
                        };
                        _transition('RINGING');
                        _scheduleGuard3(_ctx.callId);
                        _scheduleAnswerFallback(_ctx.callId);
                        _installEscHandler();
                        break;

                    // ── POLL_UPDATE: status polling returned new data ──────────
                    case 'POLL_UPDATE': {
                        if (!['RINGING', 'CONNECTED', 'HELD', 'ENDING'].includes(_state)) break;
                        const raw = payload.rawStatus || '';
                        if (payload.duration != null) _ctx.duration = payload.duration;

                        if (TERMINAL_RAW.has(raw)) {
                            _stopTimers();
                            _transition('ENDED', { duration: payload.duration || _ctx.duration });
                            _dismissTimer = setTimeout(() => {
                                machine.send('RESET');
                            }, ENDED_AUTODISMISS_MS);

                        } else if (ANSWERED_RAW.has(raw) && _state === 'RINGING') {
                            // First answered poll — transition RINGING → CONNECTED
                            if (_guard3Timer) { clearTimeout(_guard3Timer); _guard3Timer = null; }
                            if (_answerFallback) { clearTimeout(_answerFallback); _answerFallback = null; }
                            _ctx.startTime = Date.now();
                            _transition('CONNECTED');
                            _startAnsweredTimer();
                        }
                        break;
                    }

                    // ── ANSWERED: LiveKit ParticipantConnected fired ───────────
                    case 'ANSWERED':
                        if (_state !== 'RINGING') break;
                        if (_guard3Timer) { clearTimeout(_guard3Timer); _guard3Timer = null; }
                        if (_answerFallback) { clearTimeout(_answerFallback); _answerFallback = null; }
                        _ctx.startTime = Date.now();
                        _transition('CONNECTED');
                        _startAnsweredTimer();
                        break;

                    // ── HOLD / RESUME ─────────────────────────────────────────
                    case 'HOLD':
                        if (_state !== 'CONNECTED') break;
                        _ctx.held = true;
                        _transition('HELD');
                        break;

                    case 'RESUME':
                        if (_state !== 'HELD') break;
                        _ctx.held = false;
                        _transition('CONNECTED');
                        break;

                    // ── MUTE toggle (not a state change — context update only) ─
                    case 'MUTE':
                        if (!['CONNECTED', 'HELD'].includes(_state)) break;
                        _ctx.muted = !_ctx.muted;
                        _emit('transition', { from: _state, to: _state, context: { ..._ctx } });
                        break;

                    // ── MINIMIZE toggle ───────────────────────────────────────
                    case 'MINIMIZE':
                        if (_state === 'IDLE') break;
                        _ctx.minimized = !_ctx.minimized;
                        _emit('transition', { from: _state, to: _state, context: { ..._ctx } });
                        break;

                    // ── HANGUP: user pressed End ──────────────────────────────
                    case 'HANGUP':
                        if (!['RINGING', 'CONNECTED', 'HELD'].includes(_state)) break;
                        _stopPolling();
                        _transition('ENDING');
                        break;

                    // ── TIMEOUT: Guard3 — ringing too long ───────────────────
                    case 'TIMEOUT':
                        if (_state !== 'RINGING') break;
                        _stopTimers();
                        _transition('ENDED', { error: 'Call not answered (timeout)' });
                        _dismissTimer = setTimeout(() => machine.send('RESET'), ENDED_AUTODISMISS_MS);
                        break;

                    // ── INITIATION_FAILED: POST /calls/start returned error ───
                    case 'INITIATION_FAILED':
                        if (!['INITIATING', 'AWAITING_MODE'].includes(_state)) break;
                        _stopTimers();
                        _ctx.error = payload.error || 'Call failed to start';
                        _transition('FAILED');
                        _dismissTimer = setTimeout(() => machine.send('RESET'), FAILED_AUTODISMISS_MS);
                        break;

                    // ── CALL_ENDED_LOCAL: LiveKit disconnected first ──────────
                    case 'CALL_ENDED_LOCAL':
                        if (!['CONNECTED', 'HELD', 'RINGING', 'ENDING'].includes(_state)) break;
                        _stopTimers();
                        _transition('ENDED');
                        _dismissTimer = setTimeout(() => machine.send('RESET'), ENDED_AUTODISMISS_MS);
                        break;

                    // ── RESET: back to IDLE ───────────────────────────────────
                    case 'RESET':
                        _stopTimers();
                        _ctx = _emptyContext();
                        _transition('IDLE');
                        break;

                    default:
                        console.warn(`[DialerMachine] Unknown event: ${event}`);
                }
            },

            // ── Polling integration ─────────────────────────────────────────

            /** Start polling — called by dialer_widget.js when entering RINGING. */
            startPolling(pollFn) {
                _startPolling(pollFn);
            },

            /** Stop polling — called when entering ENDED/FAILED/IDLE. */
            stopPolling() {
                _stopPolling();
            },

            // ── LiveKit room storage ─────────────────────────────────────────

            setLiveKitRoom(room) {
                _ctx.livekitRoom = room;
            },

            getLiveKitRoom() {
                return _ctx.livekitRoom;
            },

            // ── Mode resolution (for rcm_widget.js modal) ─────────────

            /**
             * Returns a Promise that resolves to 'browser'|'bridge'|null
             * when the SDR selects a mode or cancels.
             * Also sends AWAIT_MODE to transition the machine.
             */
            requestMode(pendingCallCtx) {
                return new Promise((resolve) => {
                    _pendingModeResolve = resolve;
                    machine.send('AWAIT_MODE', { pendingCallCtx });
                });
            },

        };

        return machine;
    }

    // ── Singleton export ─────────────────────────────────────────────────────

    if (global.DialerMachine) {
        console.warn('[DialerMachine] Already initialised — skipping re-initialisation.');
    } else {
        global.DialerMachine = createDialerMachine();
        console.info('[DialerMachine] v1.0.0 ready — state: IDLE');
    }

    // ── Mixpanel: call lifecycle analytics ────────────────────────────────
    // Hooks onto the existing _emit('transition') bus — zero coupling to call logic.
    // Every state transition is synchronous, so we capture context at fire time.
    global.DialerMachine.on('transition', function (data) {
        try {
            if (!global.mixpanel) return;
            const { from, to, context: ctx } = data;
            const user = global.__CRM_CURRENT_USER__ || {};
            const base = {
                lead_id:   ctx.leadId   || null,
                lead_name: ctx.leadName || null,
                call_mode: ctx.callMode || null,
                provider:  ctx.provider || null,
                role:      user.role    || null,
                pod_id:    user.pod_id  || null,
            };

            // Call Initiated: any → INITIATING (user pressed Call, backend in-flight)
            if (to === 'INITIATING') {
                global.mixpanel.track('Call Initiated', base);
            }

            // Call Connected: RINGING → CONNECTED (call answered)
            if (from === 'RINGING' && to === 'CONNECTED') {
                global.mixpanel.track('Call Connected', base);
            }

            // Call Ended: anything → ENDED
            if (to === 'ENDED') {
                const isMissed = from === 'RINGING' || !!ctx.error;
                if (isMissed) {
                    // 45s Guard3 timeout or declined before answer
                    global.mixpanel.track('Call Missed', { ...base, reason: ctx.error || 'no_answer' });
                } else {
                    global.mixpanel.track('Call Ended', {
                        ...base,
                        duration_sec: ctx.duration || 0,
                        from_state:   from,
                    });
                }
            }

            // Call Failed: INITIATING → FAILED (backend error)
            if (to === 'FAILED') {
                global.mixpanel.track('Call Failed', { ...base, error: ctx.error || 'unknown' });
            }
        } catch (e) { /* silent — never interrupt the machine */ }
    });

})(window);
