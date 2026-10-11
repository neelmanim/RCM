/**
 * messenger-dialer-sdk.js — AlternateMessenger SDK v1.0.0
 * =======================================================
 * Standalone embeddable dialer widget.
 * Drop-in with a single <script> tag — no build step, no framework.
 *
 * Usage:
 *   AlternateMessenger.mount({
 *     container:     '#dialer',         // optional — defaults to floating FAB
 *     callStartUrl:  '/dialer/call/start',
 *     callActionUrl: '/dialer/call/action',
 *     disconnectUrl: '/dialer/call/end',
 *     eventsUrl:     '/dialer/events',
 *     theme:         'light',           // 'light' | 'dark'
 *     position:      'bottom-right',    // 'bottom-right' | 'bottom-left'
 *     headers:       {},                // extra headers sent with every proxy call
 *   });
 *
 *   AlternateMessenger.call({ phone: '+919876543210', contactName: 'John Doe' });
 *   AlternateMessenger.on('call.started',  (ev) => {});
 *   AlternateMessenger.on('call.answered', (ev) => {});
 *   AlternateMessenger.on('call.ended',    (ev) => {});
 *   AlternateMessenger.on('call.error',    (ev) => {});
 *   AlternateMessenger.unmount();
 *
 * Proxy contract (what callStartUrl must return):
 *   { call_id, livekit_token, livekit_url, room_name }
 *
 * CSS dependency:
 *   <link rel="stylesheet" href="messenger-dialer-sdk.css">
 *
 * @license MIT
 */
(function (global) {
  'use strict';

  // ── SVG icons ────────────────────────────────────────────────────────────────
  const SVG = {
    phone: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24 11.47 11.47 0 003.59.57
               1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1
               c0 1.25.2 2.45.57 3.59a1 1 0 01-.25 1.02l-2.2 2.18z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" xmlns="http://www.w3.org/2000/svg">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`,
    mic:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 01-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
    micOff:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
    phoneOff:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 012 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07"/><path d="M14.74 14.74A6 6 0 009.26 9.26"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/><path d="M5 5a10.94 10.94 0 011.49 2.28M7.23 7.23A10 10 0 005.16 8.73"/></svg>`,
    pause:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    play:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    spinner:   `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="cd-spin"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 62.8"/></svg>`,
  };

  // ── DialerMachine (bundled inline — identical logic to dialer_machine.js) ────
  const _POLL_MS       = 2000;
  const _GUARD3_MS     = 45_000;
  const _FALLBACK_MS   = 60_000;
  const _DISMISS_MS    = 5_000;
  const _FAIL_DISMISS  = 8_000;

  const _TERMINAL = new Set([
    'CALL_ENDED','CALL_FAILED','CALL_MISSED',
    'disconnected','ended','failed','completed','no_answer','cancelled','busy',
  ]);
  const _ANSWERED_SET = new Set([
    'CALL_ANSWERED','active','connected','answered','in-progress','in_progress',
  ]);
  const _ALL_STATES = new Set([
    'IDLE','AWAITING_MODE','INITIATING','RINGING','CONNECTED','HELD','ENDING','ENDED','FAILED',
  ]);

  function _createMachine() {
    let _state = 'IDLE';
    const _listeners = new Map();
    let _poll = null, _timer = null, _g3 = null, _fallback = null, _dismiss = null, _esc = null;

    function _emptyCtx() {
      return {
        callId:null,roomName:null,phone:null,contactName:null,callMode:null,
        livekitRoom:null,livekitToken:null,livekitUrl:null,
        startTime:null,duration:0,muted:false,held:false,error:null,
      };
    }
    let _ctx = _emptyCtx();

    function _emit(ev, data) {
      (_listeners.get(ev) || []).forEach(fn => { try { fn(data); } catch(e) { console.error('[SDK:Machine]',e); } });
    }

    function _tx(next, patch) {
      if (!_ALL_STATES.has(next)) return;
      const prev = _state; _state = next;
      if (patch) Object.assign(_ctx, patch);
      _emit('transition', { from: prev, to: next, context: { ..._ctx } });
    }

    function _stopAll() {
      if (_poll)    { clearInterval(_poll);    _poll = null; }
      if (_timer)   { clearInterval(_timer);   _timer = null; }
      if (_g3)      { clearTimeout(_g3);       _g3 = null; }
      if (_fallback){ clearTimeout(_fallback); _fallback = null; }
      if (_dismiss) { clearTimeout(_dismiss);  _dismiss = null; }
      if (_esc)     { document.removeEventListener('keydown', _esc); _esc = null; }
    }

    const machine = {
      on(ev, fn) { if (!_listeners.has(ev)) _listeners.set(ev, new Set()); _listeners.get(ev).add(fn); return () => _listeners.get(ev).delete(fn); },
      getState() { return { name: _state, context: { ..._ctx } }; },
      is(s)      { return _state === s; },
      isActive() { return !['IDLE','FAILED','ENDED'].includes(_state); },

      send(ev, payload = {}) {
        switch (ev) {
          case 'INITIATE':
            if (_state !== 'IDLE') break;
            _tx('INITIATING', { phone: payload.phone || null, contactName: payload.contactName || '', callMode: payload.callMode || 'browser' });
            break;

          case 'START_CALL':
            if (!['INITIATING','IDLE'].includes(_state)) break;
            _stopAll();
            _ctx = { ..._emptyCtx(), ...payload };
            _tx('RINGING');
            // Guard3
            const cid = _ctx.callId;
            _g3 = setTimeout(() => { if (_state === 'RINGING' && _ctx.callId === cid) machine.send('TIMEOUT'); }, _GUARD3_MS);
            _fallback = setTimeout(() => { if (_state === 'RINGING' && _ctx.callId === cid) _startTimer(); }, _FALLBACK_MS);
            if (!_esc) {
              _esc = (e) => { if (e.key === 'Escape' && ['RINGING','CONNECTED','HELD'].includes(_state)) machine.send('HANGUP'); };
              document.addEventListener('keydown', _esc);
            }
            break;

          case 'POLL_UPDATE': {
            if (!['RINGING','CONNECTED','HELD','ENDING'].includes(_state)) break;
            const raw = payload.rawStatus || '';
            if (payload.duration != null) _ctx.duration = payload.duration;
            if (_TERMINAL.has(raw)) {
              _stopAll();
              _tx('ENDED', { duration: payload.duration || _ctx.duration });
              _dismiss = setTimeout(() => machine.send('RESET'), _DISMISS_MS);
            } else if (_ANSWERED_SET.has(raw) && _state === 'RINGING') {
              if (_g3) { clearTimeout(_g3); _g3 = null; }
              if (_fallback) { clearTimeout(_fallback); _fallback = null; }
              _ctx.startTime = Date.now();
              _tx('CONNECTED');
              _startTimer();
            }
            break;
          }
          case 'ANSWERED':
            if (_state !== 'RINGING') break;
            if (_g3) { clearTimeout(_g3); _g3 = null; }
            if (_fallback) { clearTimeout(_fallback); _fallback = null; }
            _ctx.startTime = Date.now(); _tx('CONNECTED'); _startTimer();
            break;

          case 'HOLD':   if (_state === 'CONNECTED') { _ctx.held = true;  _tx('HELD'); } break;
          case 'RESUME': if (_state === 'HELD')       { _ctx.held = false; _tx('CONNECTED'); } break;
          case 'MUTE':
            if (!['CONNECTED','HELD'].includes(_state)) break;
            _ctx.muted = !_ctx.muted;
            _emit('transition', { from: _state, to: _state, context: { ..._ctx } });
            break;

          case 'HANGUP':
            if (!['RINGING','CONNECTED','HELD'].includes(_state)) break;
            if (_poll) { clearInterval(_poll); _poll = null; }
            _tx('ENDING');
            break;

          case 'TIMEOUT':
            if (_state !== 'RINGING') break;
            _stopAll(); _tx('ENDED', { error: 'Call not answered (timeout)' });
            _dismiss = setTimeout(() => machine.send('RESET'), _DISMISS_MS);
            break;

          case 'INITIATION_FAILED':
            _stopAll(); _ctx.error = payload.error || 'Call failed';
            _tx('FAILED');
            _dismiss = setTimeout(() => machine.send('RESET'), _FAIL_DISMISS);
            break;

          case 'CALL_ENDED_LOCAL':
            if (!['CONNECTED','HELD','RINGING','ENDING'].includes(_state)) break;
            _stopAll(); _tx('ENDED');
            _dismiss = setTimeout(() => machine.send('RESET'), _DISMISS_MS);
            break;

          case 'RESET':
            _stopAll(); _ctx = _emptyCtx(); _tx('IDLE');
            break;
        }
      },

      startPolling(fn) { if (!_poll) _poll = setInterval(fn, _POLL_MS); },
      stopPolling()    { if (_poll) { clearInterval(_poll); _poll = null; } },
      setLiveKitRoom(r) { _ctx.livekitRoom = r; },
      getLiveKitRoom()  { return _ctx.livekitRoom; },
    };

    function _startTimer() {
      if (_timer) return;
      _ctx.startTime = _ctx.startTime || Date.now();
      _timer = setInterval(() => {
        const s = Math.floor((Date.now() - _ctx.startTime) / 1000);
        _emit('timer:tick', { seconds: s });
      }, 1000);
    }

    return machine;
  }

  // ── Module state ─────────────────────────────────────────────────────────────
  let _cfg    = {};
  let _open   = false;
  let _machine = null;
  let _sse    = null;

  // DOM refs
  let $root, $fab, $panel, $callPane;

  // Public event bus
  const _bus = new Map(); // 'call.started' | 'call.answered' | 'call.ended' | 'call.error' → Set<fn>

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function _el(tag, attrs = {}) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class')  el.className = v;
      else if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = v;
      else el.setAttribute(k, v);
    });
    return el;
  }

  function _esc(str) {
    const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML;
  }

  function _fmt(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function _emit(ev, detail = {}) {
    (_bus.get(ev) || new Set()).forEach(fn => { try { fn(detail); } catch(e) {} });
  }

  async function _apiFetch(url, body = null) {
    const opts = {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(_cfg.headers || {}) },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ── SSE connection ────────────────────────────────────────────────────────────
  function _connectSSE(callId) {
    if (_sse) { _sse.close(); _sse = null; }
    if (!_cfg.eventsUrl) return;

    const url = new URL(_cfg.eventsUrl, location.origin);
    if (callId) url.searchParams.set('call_id', callId);
    _sse = new EventSource(url.toString());

    _sse.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      if (data.type === 'CALL_STATUS') {
        _machine.send('POLL_UPDATE', { rawStatus: data.status, duration: data.duration });
      }
    };

    _sse.onerror = () => {
      // SSE closed — proxy may be doing polling fallback; we rely on machine state
    };
  }

  function _closeSSE() {
    if (_sse) { _sse.close(); _sse = null; }
  }

  // ── DOM build ─────────────────────────────────────────────────────────────────
  function _buildDOM() {
    const existing = document.getElementById('cd-sdk-root');
    if (existing) existing.remove();

    $root = _el('div', { id: 'cd-sdk-root', class: 'cd-sdk-root' });
    $root.dataset.position = _cfg.position || 'bottom-right';
    $root.dataset.theme    = _cfg.theme || 'light';

    // FAB
    $fab = _el('button', { class: 'cd-fab', 'aria-label': 'Open Alternate Messenger Dialer' });
    $fab.innerHTML = `<svg class="cd-fab-logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M 50 12 C 28 12, 12 28, 12 50 C 12 62, 18 73, 28 80 C 22 72, 19 62, 22 51 C 25 34, 40 23, 55 26 C 48 22, 50 12, 50 12 Z" fill="#E8622A"/>
      <path d="M 50 88 C 72 88, 88 72, 88 50 C 88 38, 82 27, 72 20 C 78 28, 81 38, 78 49 C 75 66, 60 77, 45 74 C 52 78, 50 88, 50 88 Z M 62 54 C 68 48, 76 46, 82 50 C 76 54, 68 56, 62 54 Z" fill="#3A7FE0"/>
    </svg>`;
    $fab.addEventListener('click', _togglePanel);

    // Panel
    $panel = _el('div', { class: 'cd-panel cd-hidden', role: 'dialog', 'aria-label': 'Alternate Messenger Dialer' });

    // Header
    const header = _el('div', { class: 'cd-header' });
    header.innerHTML = `
      <div class="cd-header-brand">
        <img src="https://messenger.ai/assets/img/messenger-formerly-logo.svg"
             alt="Alternate Messenger" class="cd-header-logo" draggable="false"/>
      </div>
      <div class="cd-header-title">Dialer</div>
      <button class="cd-close-btn" aria-label="Close dialer">${SVG.close}</button>
    `;
    header.querySelector('.cd-close-btn').addEventListener('click', _closePanel);

    // Call pane
    $callPane = _el('div', { class: 'cd-call-pane', id: 'cd-call-pane' });
    _renderIdle();

    $panel.append(header, $callPane);
    $root.append($panel, $fab);

    // Inject into container or body
    const container = _cfg.container ? document.querySelector(_cfg.container) : null;
    if (container) { container.style.position = container.style.position || 'relative'; container.appendChild($root); }
    else           { document.body.appendChild($root); }
  }

  // ── Panel toggle ─────────────────────────────────────────────────────────────
  function _togglePanel() { _open ? _closePanel() : _openPanel(); }

  function _openPanel() {
    if (_open) return;
    _open = true;
    $panel.classList.remove('cd-hidden');
    $panel.classList.add('cd-entering');
    setTimeout(() => $panel.classList.remove('cd-entering'), 280);
  }

  function _closePanel() {
    if (!_open) return;
    _open = false;
    $panel.classList.add('cd-leaving');
    setTimeout(() => { $panel.classList.add('cd-hidden'); $panel.classList.remove('cd-leaving'); }, 200);
  }

  // ── Call pane renders ─────────────────────────────────────────────────────────
  function _renderIdle(phone = '', error = '') {
    $callPane.innerHTML = `
      <div class="cd-idle-wrap">
        <div class="cd-idle-icon">${SVG.phone}</div>
        <div class="cd-idle-title">Ready to call</div>
        ${error ? `<div class="cd-error-msg">${_esc(error)}</div>` : ''}
        <div class="cd-phone-wrap">
          <label class="cd-input-label" for="cd-phone-input">PHONE NUMBER</label>
          <input id="cd-phone-input" class="cd-phone-input" type="tel"
                 placeholder="+1 555 000 0000" autocomplete="tel"
                 value="${_esc(phone)}" aria-label="Phone number"/>
        </div>
        <div class="cd-mode-label">CHOOSE HOW TO CONNECT</div>
        <button class="cd-mode-btn" id="cd-mode-bridge">
          <span class="cd-mode-icon">📱</span>
          <span class="cd-mode-text"><strong>Phone Bridge</strong><small>Rings your phone, then connects</small></span>
        </button>
        <button class="cd-mode-btn cd-mode-browser-btn" id="cd-mode-browser">
          <span class="cd-mode-icon">🎧</span>
          <span class="cd-mode-text"><strong>Browser Call</strong><small>Use your browser mic & speakers</small></span>
        </button>
      </div>`;

    const input = $callPane.querySelector('#cd-phone-input');
    $callPane.querySelector('#cd-mode-bridge').addEventListener('click', () => _startCall(input.value.trim(), 'bridge'));
    $callPane.querySelector('#cd-mode-browser').addEventListener('click', () => _startCall(input.value.trim(), 'browser'));
  }

  function _renderConnecting(phone, mode) {
    $callPane.innerHTML = `
      <div class="cd-connecting-wrap">
        ${SVG.spinner}
        <div class="cd-connecting-label">Connecting…</div>
        <div class="cd-connecting-phone">${_esc(phone)}</div>
        <div class="cd-connecting-mode">${mode === 'browser' ? 'Browser Call' : 'Phone Bridge'}</div>
      </div>`;
  }

  function _renderRinging(ctx) {
    $callPane.innerHTML = `
      <div class="cd-ringing-wrap">
        <div class="cd-avatar">${_esc((ctx.contactName || ctx.phone || '?')[0].toUpperCase())}</div>
        <div class="cd-contact-name">${_esc(ctx.contactName || ctx.phone || '')}</div>
        <div class="cd-contact-phone">${_esc(ctx.phone || '')}</div>
        <div class="cd-ringing-pulse">
          <span class="cd-ringing-dot"></span>
          <span class="cd-ringing-dot"></span>
          <span class="cd-ringing-dot"></span>
        </div>
        <div class="cd-status-label">Ringing…</div>
        <button class="cd-hangup-btn" id="cd-hangup-btn">${SVG.phoneOff} End</button>
      </div>`;
    $callPane.querySelector('#cd-hangup-btn').addEventListener('click', _hangup);
  }

  function _renderActive(ctx) {
    const muted = ctx.muted || false;
    const held  = ctx.held  || false;
    const secs  = ctx.duration || (ctx.startTime ? Math.floor((Date.now() - ctx.startTime) / 1000) : 0);

    $callPane.innerHTML = `
      <div class="cd-active-wrap">
        <div class="cd-avatar">${_esc((ctx.contactName || ctx.phone || '?')[0].toUpperCase())}</div>
        <div class="cd-contact-name">${_esc(ctx.contactName || ctx.phone || '')}</div>
        <div class="cd-contact-phone">${_esc(ctx.phone || '')}</div>
        <div class="cd-timer" id="cd-timer">${_fmt(secs)}</div>
        ${held ? '<div class="cd-held-badge">ON HOLD</div>' : ''}
        <div class="cd-controls">
          <button class="cd-ctrl-btn ${muted ? 'cd-ctrl-active' : ''}" id="cd-mute-btn"
                  aria-label="${muted ? 'Unmute' : 'Mute'}" title="${muted ? 'Unmute' : 'Mute'}">
            ${muted ? SVG.micOff : SVG.mic}
            <span>${muted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button class="cd-ctrl-btn ${held ? 'cd-ctrl-active' : ''}" id="cd-hold-btn"
                  aria-label="${held ? 'Resume' : 'Hold'}" title="${held ? 'Resume' : 'Hold'}">
            ${held ? SVG.play : SVG.pause}
            <span>${held ? 'Resume' : 'Hold'}</span>
          </button>
          <button class="cd-hangup-btn" id="cd-hangup-btn">${SVG.phoneOff} End</button>
        </div>
      </div>`;

    $callPane.querySelector('#cd-mute-btn').addEventListener('click',  _toggleMute);
    $callPane.querySelector('#cd-hold-btn').addEventListener('click',  _toggleHold);
    $callPane.querySelector('#cd-hangup-btn').addEventListener('click', _hangup);
  }

  function _renderEnding() {
    $callPane.innerHTML = `
      <div class="cd-ending-wrap">
        ${SVG.spinner}
        <div class="cd-connecting-label">Ending call…</div>
      </div>`;
  }

  function _renderEnded(ctx) {
    const dur = ctx.duration || (ctx.startTime ? Math.floor((Date.now() - ctx.startTime) / 1000) : 0);
    $callPane.innerHTML = `
      <div class="cd-ended-wrap">
        <div class="cd-ended-icon">✅</div>
        <div class="cd-ended-title">Call ended</div>
        ${dur > 0 ? `<div class="cd-ended-duration">${_fmt(dur)}</div>` : ''}
        <div class="cd-ended-hint">Returning to dial pad…</div>
      </div>`;
    _emit('call.ended', { phone: ctx.phone, contactName: ctx.contactName, duration: dur });
  }

  function _renderFailed(ctx) {
    $callPane.innerHTML = `
      <div class="cd-failed-wrap">
        <div class="cd-failed-icon">❌</div>
        <div class="cd-failed-title">Call failed</div>
        <div class="cd-failed-msg">${_esc(ctx.error || 'Could not connect')}</div>
        <div class="cd-ended-hint">Returning to dial pad…</div>
      </div>`;
    _emit('call.error', { error: ctx.error, phone: ctx.phone });
  }

  // ── Machine → UI sync ─────────────────────────────────────────────────────────
  function _syncUI({ from, to, context: ctx }) {
    switch (to) {
      case 'IDLE':        _renderIdle(ctx.phone || ''); break;
      case 'INITIATING':  _renderConnecting(ctx.phone || '', ctx.callMode); break;
      case 'RINGING':     _renderRinging(ctx); break;
      case 'CONNECTED':
      case 'HELD':        _renderActive(ctx); break;
      case 'ENDING':      _renderEnding(); break;
      case 'ENDED':       _renderEnded(ctx); break;
      case 'FAILED':      _renderFailed(ctx); break;
    }
  }

  // ── Call actions ──────────────────────────────────────────────────────────────
  async function _startCall(phone, callMode) {
    phone = (phone || '').trim();
    if (!phone) {
      const input = document.getElementById('cd-phone-input');
      if (input) { input.classList.add('cd-input-error'); setTimeout(() => input.classList.remove('cd-input-error'), 2000); }
      return;
    }
    if (!_cfg.callStartUrl) { console.error('[AlternateMessenger] callStartUrl not configured'); return; }

    _openPanel();
    _machine.send('INITIATE', { phone, callMode });

    try {
      const result = await _apiFetch(_cfg.callStartUrl, {
        phone,
        contact_name: _cfg._pendingContactName || '',
        call_mode:    callMode,
      });
      _cfg._pendingContactName = null;

      const callId       = result.call_id   || result.id || '';
      const livekitToken = result.livekit_token || result.token || null;
      const livekitUrl   = result.livekit_url   || null;
      const roomName     = result.room_name     || null;

      _machine.send('START_CALL', {
        callId,
        roomName,
        phone,
        contactName: result.contact_name || phone,
        callMode,
        livekitToken,
        livekitUrl,
      });

      _emit('call.started', { callId, phone, contactName: result.contact_name || phone, callMode });

      // Connect SSE for status events
      _connectSSE(callId);

      // Connect LiveKit for browser calls
      if (callMode === 'browser' && livekitToken && livekitUrl) {
        _connectLiveKit(livekitToken, livekitUrl, roomName);
      }

    } catch (err) {
      console.error('[AlternateMessenger] call start failed:', err);
      _machine.send('INITIATION_FAILED', { error: err.message });
    }
  }

  async function _hangup() {
    const { name: state, context: ctx } = _machine.getState();
    if (!['RINGING','CONNECTED','HELD'].includes(state)) return;

    _machine.send('HANGUP');
    _closeSSE();

    // Disconnect LiveKit room first
    const room = _machine.getLiveKitRoom?.();
    if (room) { try { await room.disconnect(); } catch {} }

    // Send disconnect to proxy
    if (_cfg.disconnectUrl) {
      _apiFetch(_cfg.disconnectUrl, { call_id: ctx.callId }).catch(() => {});
    }

    // Machine moves to ENDING — proxy polls and sends ENDED via SSE.
    // Fallback: if SSE doesn't arrive in 5s, force ENDED locally.
    setTimeout(() => {
      if (_machine.is('ENDING')) _machine.send('CALL_ENDED_LOCAL');
    }, 5000);
  }

  async function _toggleMute() {
    const { context: ctx } = _machine.getState();
    _machine.send('MUTE');

    // Mute LiveKit local track
    const room = _machine.getLiveKitRoom?.();
    if (room) {
      try {
        const pub = [...(room.localParticipant?.audioTrackPublications?.values() || [])][0];
        if (pub?.track) await pub.track.mute(!ctx.muted ? true : false);
      } catch {}
    }

    // Notify proxy
    if (_cfg.callActionUrl && ctx.callId) {
      _apiFetch(_cfg.callActionUrl, {
        call_id: ctx.callId,
        action: ctx.muted ? 'unmute' : 'mute',
        ...( ctx.roomName ? { room_name: ctx.roomName } : {} ),
      }).catch(() => {});
    }
  }

  async function _toggleHold() {
    const { name: state, context: ctx } = _machine.getState();
    if (!_cfg.callActionUrl || !ctx.callId) return;

    const action = state === 'HELD' ? 'resume' : 'hold';
    _machine.send(state === 'HELD' ? 'RESUME' : 'HOLD');

    _apiFetch(_cfg.callActionUrl, {
      call_id: ctx.callId,
      action,
      ...( ctx.roomName ? { room_name: ctx.roomName } : {} ),
    }).catch(() => {});
  }

  // ── LiveKit integration ──────────────────────────────────────────────────────
  async function _connectLiveKit(token, url, roomName) {
    if (typeof window.LivekitClient === 'undefined' && typeof window.livekit === 'undefined') {
      console.warn('[AlternateMessenger] LiveKit client not loaded — browser audio unavailable.');
      return;
    }
    const LK = window.LivekitClient || window.livekit;
    try {
      const room = new LK.Room({ adaptiveStream: true, dynacast: true });
      _machine.setLiveKitRoom(room);

      room.on(LK.RoomEvent.ParticipantConnected, () => { _machine.send('ANSWERED'); });
      room.on(LK.RoomEvent.Disconnected,         () => { _machine.send('CALL_ENDED_LOCAL'); });

      await room.connect(url, token);

      // Enable local mic
      await room.localParticipant.enableCameraAndMicrophone();

      // Attach remote audio
      room.on(LK.RoomEvent.TrackSubscribed, (track, pub, participant) => {
        if (track.kind === LK.Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          document.body.appendChild(el);
          // Clean up when call ends
          _machine.on('transition', ({ to }) => { if (to === 'IDLE') { track.detach(el); el.remove(); } });
        }
      });

    } catch (err) {
      console.error('[AlternateMessenger] LiveKit connect failed:', err);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Initialise and mount the dialer widget.
   * @param {object} config
   * @param {string}  [config.container]     CSS selector. Defaults to floating FAB on document.body.
   * @param {string}   config.callStartUrl   POST → { call_id, livekit_token, livekit_url, room_name }
   * @param {string}   config.callActionUrl  POST → mute/hold/hangup control
   * @param {string}   config.disconnectUrl  POST → end call
   * @param {string}  [config.eventsUrl]     GET  → SSE stream for call status
   * @param {object}  [config.headers]       Extra headers for every proxy request
   * @param {string}  [config.theme]         'light' | 'dark'. Default: 'light'
   * @param {string}  [config.position]      'bottom-right' | 'bottom-left'. Default: 'bottom-right'
   */
  function mount(config = {}) {
    if (!config.callStartUrl) throw new Error('[AlternateMessenger] callStartUrl is required');

    _cfg = {
      theme:    'light',
      position: 'bottom-right',
      headers:  {},
      ...config,
    };

    // Create machine (fresh on each mount)
    _machine = _createMachine();

    // Wire machine → UI
    _machine.on('transition', _syncUI);
    _machine.on('timer:tick', ({ seconds }) => {
      const el = document.getElementById('cd-timer');
      if (el) el.textContent = _fmt(seconds);
    });

    _buildDOM();
    console.info('[AlternateMessenger] v1.0.0 mounted');
  }

  /**
   * Programmatically initiate a call (opens the panel + starts dialling).
   * @param {object} opts
   * @param {string}  opts.phone        E.164 phone number
   * @param {string} [opts.contactName] Display name for the contact
   * @param {string} [opts.callMode]    'browser' | 'bridge'. Default: 'browser'
   */
  function call({ phone, contactName = '', callMode = 'browser' } = {}) {
    if (!_machine) throw new Error('[AlternateMessenger] call mount() first');
    _cfg._pendingContactName = contactName;
    _openPanel();
    _startCall(phone, callMode);
  }

  /**
   * Subscribe to an SDK event.
   * @param {'call.started'|'call.answered'|'call.ended'|'call.error'} event
   * @param {Function} handler
   */
  function on(event, handler) {
    if (!_bus.has(event)) _bus.set(event, new Set());
    _bus.get(event).add(handler);
    return () => off(event, handler);
  }

  /** Unsubscribe from an SDK event. */
  function off(event, handler) {
    _bus.get(event)?.delete(handler);
  }

  /** Remove the dialer widget from the DOM and clean up. */
  function unmount() {
    _closeSSE();
    if (_machine) { _machine.send('RESET'); _machine = null; }
    if ($root) { $root.remove(); $root = null; }
    _cfg = {}; _open = false;
    console.info('[AlternateMessenger] unmounted');
  }

  // ── Register global ──────────────────────────────────────────────────────────
  if (global.AlternateMessengerDialer) {
    console.warn('[AlternateMessenger] Already loaded — skipping re-registration.');
  } else {
    global.AlternateMessengerDialer = { mount, call, on, off, unmount };
    console.info('[AlternateMessenger] SDK v1.0.0 ready');
  }

})(window);
