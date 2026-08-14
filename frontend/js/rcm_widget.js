/**
 * rcm_widget.js — V34
 * Floating Communication Widget: WhatsApp (template + free-text) + SMS + Call
 *
 * Flow for WhatsApp:
 *   1. SDR opens Message tab → selects WhatsApp channel
 *   2. Widget calls GET /api/conversations/session-state
 *   3a. requires_template=true  → shows template picker dropdown
 *   3b. requires_template=false → shows free-text textarea
 *   4. Send → POST /api/conversations/send
 */
(function (global) {
  'use strict';

  // ── SVGs ──────────────────────────────────────────────────────────────────
  const SVG = {
    phone: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24 11.47 11.47 0 003.59.57
               1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1
               c0 1.25.2 2.45.57 3.59a1 1 0 01-.25 1.02l-2.2 2.18z"/></svg>`,
    message: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z"/></svg>`,
    send: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" xmlns="http://www.w3.org/2000/svg">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`,
    whatsapp: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15
               -.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475
               -.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.521
               .149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207
               -.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372
               -.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2
               5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085
               1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.89.52 3.656 1.428 5.168L2 22l4.981-1.402
               A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.522 2 12 2zm0 18a7.95 7.95 0
               01-4.29-1.255l-.308-.183-3.182.895.896-3.107-.2-.319A7.952 7.952 0 014 12c0-4.418
               3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z"/>
    </svg>`,
    sms: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
    </svg>`,
    spinner: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="cw-spin">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 62.8"/>
    </svg>`,
    rcm: `<svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="9" cy="9" r="9" fill="#7c3aed" opacity="0.85"/>
      <path d="M5 9a4 4 0 108 0" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`,
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let _cfg        = {};
  let _open       = false;
  let _leadId     = null;
  let _leadPhone  = null;
  let _leadName   = null;     // for ${contacts.first_name} substitution
  let _messages   = [];
  let _sending    = false;
  let _toastTimer = null;
  let _dialerHideStyle = null;  // PHASE 1 REPLACED: see _suppressDialerWidget() below

  // Module-level handle for the _syncTimer spawned by _dial() in _renderCallIdleManual.
  // Stored here so the rcm:call-started listener can cancel it immediately
  // when the call event fires — preventing a 500ms race condition re-render.
  // PHASE 2 TARGET: replace with machine.is('RINGING') check in _syncCallPane
  let _activeSyncTimer = null;

  // v6.2.0: mode-selection Promise bridge
  // When openForCall() is called, we render mode buttons in the Call tab and store
  // a resolve function here. Clicking a mode button calls _resolvePendingMode(mode).
  // PHASE 2 TARGET: replace with machine.requestMode() — see dialer_machine.js
  let _pendingModeResolve = null;   // fn(mode: 'bridge'|'browser'|null)
  let _pendingCallCtx     = null;   // { leadId, leadName, phone } stored while awaiting mode
  // PHASE 2 TARGET: replace with machine.on('timer:tick')
  let _cwTimerInterval    = null;   // module-level timer for the embedded active-call display

  // Messaging state
  let _channel        = 'whatsapp';   // 'whatsapp' | 'sms'
  let _sessionState   = null;         // result of /session-state
  let _templates      = [];           // WhatsApp templates
  let _selectedTpl    = null;         // chosen template object
  let _sessionLoading = false;

  // DOM refs
  let $root, $fab, $panel, $historyEl, $badge;
  let $channelWa, $channelSms;
  let $sessionBanner, $tplWrap, $tplSelect, $tplPreview;
  let $composeWrap, $inputEl, $sendBtn;
  let $headerTitle;     // BUG2: module-level ref so setLead/openForLead can update it
  let $noPhoneNotice;   // BUG3: inline warning when lead has no phone
  let $noLeadNotice;    // v6.2.0: shown in Message tab when widget is in ad-hoc (no-lead) mode

  // ── Public API ────────────────────────────────────────────────────────────
  const RCMWidget = {

    init(config = {}) {
      _cfg = Object.assign({
        apiBase:       '',
        leadId:        null,
        leadPhone:     null,
        leadName:      '',
        position:      'bottom-right',
        theme:         'light',
        senderId:      '',   // rcm_sender_id from settings
        callIframeUrl: '',
        poweredByUrl:  'https://bercm.com',
      }, config);

      _leadId    = _cfg.leadId    || null;
      _leadPhone = _cfg.leadPhone || null;
      _leadName  = _cfg.leadName  || '';

      _injectCSS();
      _buildDOM();
      _attachEvents();
    },

    setLead(leadId, phone, name) {
      _leadId    = leadId  || null;
      _leadPhone = phone   || null;
      _leadName  = name    || '';
      _messages  = [];
      _sessionState = null;
      _selectedTpl  = null;

      // Always update tab state (dim/restore) — this is CSS only, safe even when closed
      _updateMsgTabState();

      // Only trigger UI updates if the widget is open — avoids flicker on page load
      if (!_open) return;
      _renderMessages();
      _updateHeader();
      _applyMsgPaneForState();
    },

    open()  { if (!_open) _toggle(); },
    close() { if (_open) _toggle(); },

    /**
     * T4C: Open the panel programmatically without entering a specific mode.
     * Used by the navbar active-call indicator click handler.
     * If a call is active, also switches to the Call tab.
     */
    openPanel() {
      if (!_open) _toggle();
      if (window.rcmDialer?.isActive?.()) {
        _switchToCallTab();
      }
    },


    // Convenience: called from lead_detail via window._openMessagingWidget
    openForLead({ leadId, leadName, phone, lead = {} }) {
      this.setLead(leadId, phone || lead.phone || lead.phone_secondary || lead.company_phone || '', leadName);
      if (!_open) _toggle();
    },

    /**
     * v6.2.0: Open the widget to the Call tab for a specific lead.
     * Renders the mode selector (Phone Bridge / Browser Call) inside the Call pane.
     * Returns a Promise that resolves to 'bridge' | 'browser' | null (cancelled).
     *
     * Called by handleCallAction() in app.js instead of the old standalone
     * _showCallModeSelector overlay.
     */
    openForCall({ leadId, leadName, phone }) {
      // Fix B: kill any stale _activeSyncTimer from the previous call before
      // this new openForCall() sets up a fresh one.  Without this, a timer
      // left over from call 1 can fire _renderCallIdle() during call 2's
      // connecting phase — showing "Ready to call" instead of the spinner.
      if (_activeSyncTimer) {
        clearInterval(_activeSyncTimer);
        _activeSyncTimer = null;
      }

      _pendingCallCtx = { leadId, leadName, phone };
      // Update lead context for messaging tab too
      _leadId    = leadId   || null;
      _leadPhone = phone    || null;
      _leadName  = leadName || '';

      // IMPORTANT: set _pendingModeResolve BEFORE calling _toggle()/_switchToCallTab()
      // so that _syncCallPane() (called inside _toggle) sees the pending resolver
      // and preserves the mode-selector pane instead of resetting to idle.
      const promise = new Promise((resolve) => {
        _pendingModeResolve = resolve;
      });

      // Render Call pane in "idle with lead" state (mode selector)
      _renderCallIdleLead(leadName, phone);

      // Ensure widget is open and on the Call tab
      if (!_open) _toggle();
      _switchToCallTab();

      return promise;
    },

    /**
     * v6.2.0: Open the widget to the Call tab in manual (ad-hoc) dial mode.
     * Shows a phone number input + mode buttons inside the Call pane.
     *
     * Called by showManualDialWidget() in dialer_widget.js and the nav "Manual Dial" button.
     * Returns a Promise that resolves to { phone, callMode } | null (cancelled).
     */
    openForManualDial() {
      // Clear ALL lead context so the header doesn't show a stale contact name
      _pendingCallCtx = null;
      _leadId    = null;
      _leadName  = '';
      _leadPhone = null;
      _updateMsgTabState();   // v6.2.0: dim Message tab in ad-hoc mode

      // IMPORTANT: set _pendingModeResolve BEFORE calling _toggle()/_switchToCallTab()
      // so that _syncCallPane() (called inside _toggle) sees the pending resolver
      // and preserves the manual dial pane instead of resetting to idle.
      const promise = new Promise((resolve) => {
        _pendingModeResolve = resolve;
      });

      // Render Call pane in "idle manual dial" state
      _renderCallIdleManual();

      // Ensure widget is open and on the Call tab
      if (!_open) _toggle();
      _switchToCallTab();

      return promise;
    },

    showBadge(count) {
      if (!$badge) return;
      if (count > 0) {
        $badge.textContent = count > 9 ? '9+' : String(count);
        $badge.style.display = 'flex';
      } else {
        $badge.style.display = 'none';
      }
    },

    /**
     * Called by dialer_widget.js when the /api/calls/start request fails.
     * Reverts the RCM widget Call pane from "Connecting…" back to
     * idle (manual dial form) and shows an inline error so the SDR can retry.
     */
    notifyCallFailed(errorMsg) {
      // Cancel any pending sync timer — no call started
      if (_activeSyncTimer) {
        clearInterval(_activeSyncTimer);
        _activeSyncTimer = null;
      }
      // Show error banner inside the Call pane, then revert to manual dial form
      const p = document.getElementById('cw-pane-call');
      if (p) {
        p.innerHTML = `
          <div class="cw-msg-empty cw-call-native" style="gap:10px">
            <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="1.5" style="width:36px;height:36px">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12" stroke-linecap="round"/>
              <circle cx="12" cy="16" r="0.5" fill="#f87171" stroke="none"/>
            </svg>
            <span style="font-size:13px;font-weight:600;color:#f87171">Call Failed</span>
            <span style="font-size:11.5px;opacity:0.6;text-align:center;padding:0 16px">${_esc(errorMsg || 'Could not connect')}</span>
            <button id="cw-retry-dial" class="cw-mode-btn" style="margin-top:4px">
              <span class="cw-mode-btn-icon">🔄</span>
              <span class="cw-mode-btn-text"><strong>Try Again</strong><small>Enter a number to dial</small></span>
            </button>
          </div>`;
        p.querySelector('#cw-retry-dial')?.addEventListener('click', () => RCMWidget.openForManualDial());
      }
    },
  };


  // ── DOM Build ─────────────────────────────────────────────────────────────

  function _injectCSS() {
    if (!document.querySelector('link[href*="rcm_widget.css"]')) {
      const link = document.createElement('link');
      link.rel  = 'stylesheet';
      link.href = (_cfg.apiBase || '') + '/frontend/css/rcm_widget.css';
      document.head.appendChild(link);
    }
  }

  function _buildDOM() {
    const existing = document.getElementById('rcm-widget-root');
    if (existing) existing.remove();

    $root = _el('div', { id: 'rcm-widget-root' });
    $root.dataset.position    = _cfg.position;
    $root.dataset.widgetTheme = _cfg.theme;

    // FAB
    $fab = _el('button', { class: 'cw-fab', 'aria-label': 'Open RCM' });
    $fab.innerHTML = `<svg class="cw-fab-logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <!-- Orange C curl (top-left) -->
      <path d="M 50 12
               C 28 12, 12 28, 12 50
               C 12 62, 18 73, 28 80
               C 22 72, 19 62, 22 51
               C 25 34, 40 23, 55 26
               C 48 22, 50 12, 50 12 Z"
            fill="#E8622A"/>
      <!-- Blue infinity swoosh (bottom-right) -->
      <path d="M 50 88
               C 72 88, 88 72, 88 50
               C 88 38, 82 27, 72 20
               C 78 28, 81 38, 78 49
               C 75 66, 60 77, 45 74
               C 52 78, 50 88, 50 88 Z
               M 62 54
               C 68 48, 76 46, 82 50
               C 76 54, 68 56, 62 54 Z"
            fill="#3A7FE0"/>
    </svg>`;
    $badge = _el('span', { class: 'cw-badge' });
    $badge.style.display = 'none';
    $fab.appendChild($badge);

    // Panel
    $panel = _el('div', { class: 'cw-panel cw-hidden', role: 'dialog', 'aria-label': 'Communication widget' });

    // Header
    const header = _el('div', { class: 'cw-header' });
    const brand  = _el('div', { class: 'cw-header-brand' });
    brand.innerHTML = `<img
      src="https://rcm.ai/assets/img/rcm-formerly-logo.svg"
      alt="RCM"
      class="cw-header-logo"
      draggable="false"
    />`;
    $headerTitle = _el('div', { class: 'cw-header-title' }); // BUG2: module-level ref
    _updateHeader();  // set initial text
    const closeBtn = _el('button', { class: 'cw-close-btn', 'aria-label': 'Close widget' });
    closeBtn.innerHTML = SVG.close;
    closeBtn.addEventListener('click', _toggle);
    header.append(brand, $headerTitle, closeBtn);

    // Tabs: Call / Message
    const tabBar  = _el('div', { class: 'cw-tabs', role: 'tablist' });
    const tabCall = _el('button', { class: 'cw-tab cw-active', role: 'tab', 'aria-selected': 'true',  id: 'cw-tab-call' });
    tabCall.innerHTML = SVG.phone + ' Call';
    const tabMsg  = _el('button', { class: 'cw-tab', role: 'tab', 'aria-selected': 'false', id: 'cw-tab-msg' });
    tabMsg.innerHTML  = SVG.message + ' Message';
    tabBar.append(tabCall, tabMsg);

    // Pane: Call — Unified native panel.
    // When a call is active (rcm:call-started), the standalone #dialer-widget
    // is hidden and the live call UI is rendered inline here instead.
    const paneCall = _el('div', { class: 'cw-pane cw-active', id: 'cw-pane-call', role: 'tabpanel' });
    _renderCallIdle(paneCall);  // default: idle state

    // Pane: Message
    const paneMsg = _el('div', { class: 'cw-pane', id: 'cw-pane-msg', role: 'tabpanel' });

    // BUG3: No-phone notice (shown when lead has no phone; everything else hidden)
    $noPhoneNotice = _el('div', { class: 'cw-msg-empty cw-hidden' });
    $noPhoneNotice.innerHTML = `<span style="font-size:1.6rem">📵</span>
      <span style="font-weight:600;font-size:13.5px;color:rgba(255,255,255,0.8)">No phone number</span>
      <span style="font-size:12px;opacity:0.5;text-align:center;padding:0 20px;line-height:1.5">
        Add a phone number to this lead to enable messaging.
      </span>`;

    // v6.2.0: No-lead notice (shown in Message tab during ad-hoc / manual dial mode)
    $noLeadNotice = _el('div', { class: 'cw-msg-empty cw-hidden' });
    $noLeadNotice.innerHTML = `<span style="font-size:1.6rem">💬</span>
      <span style="font-weight:600;font-size:13.5px;color:rgba(255,255,255,0.8)">No lead selected</span>
      <span style="font-size:12px;opacity:0.5;text-align:center;padding:0 20px;line-height:1.5">
        Open a lead and click <strong>Message</strong> to send &amp; receive messages.
      </span>`;

    // Channel selector
    const channelBar = _el('div', { class: 'cw-channel-bar' });
    $channelWa  = _el('button', { class: 'cw-channel-btn cw-active', 'data-channel': 'whatsapp', 'aria-label': 'WhatsApp' });
    $channelWa.innerHTML  = SVG.whatsapp + ' WhatsApp';
    $channelSms = _el('button', { class: 'cw-channel-btn', 'data-channel': 'sms', 'aria-label': 'SMS' });
    $channelSms.innerHTML = SVG.sms + ' SMS';
    channelBar.append($channelWa, $channelSms);

    // Session banner (loading / expired notice)
    $sessionBanner = _el('div', { class: 'cw-session-banner cw-hidden' });

    // Template picker (shown when session is expired)
    $tplWrap = _el('div', { class: 'cw-tpl-wrap cw-hidden' });
    const tplLabel = _el('label', { class: 'cw-tpl-label', for: 'cw-tpl-select' });
    tplLabel.textContent = 'Select template';
    $tplSelect = _el('select', { class: 'cw-tpl-select', id: 'cw-tpl-select', 'aria-label': 'Choose WhatsApp template' });
    const defaultOpt = _el('option', { value: '' });
    defaultOpt.textContent = '— choose a template —';
    $tplSelect.appendChild(defaultOpt);
    $tplPreview = _el('div', { class: 'cw-tpl-preview cw-hidden' });
    $tplWrap.append(tplLabel, $tplSelect, $tplPreview);

    // Message history
    $historyEl = _el('div', { class: 'cw-msg-history', 'aria-live': 'polite' });

    // Compose
    $composeWrap = _el('div', { class: 'cw-compose' });
    $inputEl = _el('textarea', {
      class: 'cw-compose-input', placeholder: 'Type a message…',
      rows: '1', 'aria-label': 'Message text',
    });
    $sendBtn = _el('button', { class: 'cw-send-btn', 'aria-label': 'Send message' });
    $sendBtn.innerHTML = SVG.send;
    $sendBtn.disabled  = true;
    $composeWrap.append($inputEl, $sendBtn);

    paneMsg.append($noLeadNotice, $noPhoneNotice, channelBar, $sessionBanner, $tplWrap, $historyEl, $composeWrap);

    $panel.append(header, tabBar, paneCall, paneMsg);
    $root.append($panel, $fab);
    document.body.appendChild($root);

    _renderMessages();

    tabCall.addEventListener('click', () => _switchTab('call', tabCall, tabMsg, paneCall, paneMsg));
    tabMsg.addEventListener('click',  () => {
      _switchTab('msg', tabMsg, tabCall, paneMsg, paneCall);
      _applyMsgPaneForState();   // BUG3: guard no-phone, then load session
    });
  }

  function _attachEvents() {
    // FAB click: open in manual dial mode by default.
    // If a call is already active, just toggle the panel open/closed.
    $fab.addEventListener('click', () => {
      if (window.rcmDialer?.isActive()) {
        if (!_open) {
          // Call active, panel closed — open it
          _toggle();
        } else {
          // Call active, panel open — show soft tooltip instead of closing
          _showInlineToast('End the call to close the widget');
        }
      } else if (_open) {
        // Widget is already open — close it
        _toggle();
      } else if (_leadId) {
        // On a lead page — delegate to the app's unified call handler.
        // This is identical to clicking the 📞 button on a lead and ensures
        // _pendingModeResolve is set so the mode buttons (Bridge/Browser) work.
        if (typeof window._openCallModal === 'function') {
          window._openCallModal(_leadId, _leadName || '', _leadPhone || '', window._currentLead || {});
        } else {
          // Fallback: just open the panel if app handler not available
          _toggle();
          _switchToCallTab();
        }
      } else {
        // No lead context — ad-hoc / manual dial mode
        RCMWidget.openForManualDial();
      }
    });

    // Channel buttons
    $channelWa.addEventListener('click', () => _setChannel('whatsapp'));
    $channelSms.addEventListener('click', () => _setChannel('sms'));

    // Template picker
    $tplSelect.addEventListener('change', () => {
      const id = parseInt($tplSelect.value, 10);
      _selectedTpl = _templates.find(t => t.id === id) || null;
      _renderTemplatePreview();
      $sendBtn.disabled = !_selectedTpl;
    });

    // Free-text input
    $inputEl.addEventListener('input', () => {
      $sendBtn.disabled = !$inputEl.value.trim();
      $inputEl.style.height = 'auto';
      $inputEl.style.height = Math.min($inputEl.scrollHeight, 80) + 'px';
    });
    $inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!$sendBtn.disabled) _send(); }
    });
    $sendBtn.addEventListener('click', _send);

    // ── Dialer integration: react to call lifecycle events ──────────────────
    // When a call starts:
    //   a) always hide the standalone #dialer-widget
    //   b) render live call state in the Call tab
    //   c) auto-open the panel and switch to Call tab so there's one unified UI
    window.addEventListener('rcm:call-started', (e) => {
      // Cancel any pending sync timer — call-started is the authoritative signal.
      if (_activeSyncTimer) {
        clearInterval(_activeSyncTimer);
        _activeSyncTimer = null;
      }
      const sdkState  = window.rcmDialer?.getState?.() || {};
      const isRecovered = !!e.detail?.recovered;

      const callState = Object.assign({}, sdkState, {
        startTime: e.detail?.startTime || sdkState.startTime || Date.now(),
        leadName:  e.detail?.leadName  || sdkState.leadName,
        phone:     e.detail?.phone     || sdkState.phone,
        callMode:  e.detail?.callMode  || sdkState.callMode,
        connected: !!e.detail?.connected,  // honour recovered call's answered state
        recovered: isRecovered,
      });
      _renderCallActive(callState);

      // T4A: FAB pulsing active ring
      $fab?.classList.add('cw-call-active');
      $fab?.setAttribute('aria-label', 'Active call — click to manage');

      // T4C: Navbar active call indicator
      const navIndicator = document.getElementById('active-call-indicator');
      if (navIndicator) {
        navIndicator.hidden = false;
        navIndicator.setAttribute('data-call-id', callState.callId || '');
      }
      // BUG1: suppress standalone dialer ONLY during an active call (not on every open)
      // Phase 1: use a body CSS class instead of injecting a <style> tag.
      // The class .dialer-call-active suppresses #dialer-widget via rcm_widget.css.
      // This eliminates the _dialerHideStyle variable while preserving BUG1 semantics.
      document.body.classList.add('dialer-call-active');
      _dialerHideStyle = true;  // sentinel so _toggle() below still works

      // Auto-open panel to Call tab
      if (!_open) _toggle();
      // Switch to Call tab
      const tabCall = document.getElementById('cw-tab-call');
      const tabMsg  = document.getElementById('cw-tab-msg');
      const paneCall = document.getElementById('cw-pane-call');
      const paneMsg  = document.getElementById('cw-pane-msg');
      if (tabCall && tabMsg && paneCall && paneMsg) {
        tabCall.classList.add('cw-active');    tabCall.setAttribute('aria-selected','true');
        tabMsg.classList.remove('cw-active');  tabMsg.setAttribute('aria-selected','false');
        paneCall.classList.add('cw-active');   paneMsg.classList.remove('cw-active');
      }
    });
    // When a call ends, revert Call tab to idle and collapse the panel
    window.addEventListener('rcm:call-ended', () => {
      // Clear the embedded timer interval before rendering
      if (_cwTimerInterval) { clearInterval(_cwTimerInterval); _cwTimerInterval = null; }

      // Show brief "Call ended" confirmation in the Call pane — gives SDR
      // visual feedback before the panel collapses automatically.
      const pane = document.getElementById('cw-pane-call');
      if (pane) {
        pane.innerHTML = `
          <div class="cw-msg-empty cw-call-native" style="gap:12px">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:600">Call ended</span>
          </div>`;
      }

      // Lift CSS suppression + auto-collapse panel after 1.6s
      // Fix D: the SDR may have already dialled the next lead within 1.6s.
      // Every step of this cleanup checks isActive() first — if a new call
      // has started we abort rather than clobber the connecting UI.
      setTimeout(() => {
        // Fix D: abort entire cleanup if a new call is already in progress.
        if (window.rcmDialer?.isActive?.()) return;

        document.body.classList.remove('dialer-call-active');
        _dialerHideStyle = null;

        // T4A: Remove FAB active ring
        $fab?.classList.remove('cw-call-active');
        $fab?.setAttribute('aria-label', 'Open RCM');

        // T4C: Hide navbar indicator
        const navIndicator = document.getElementById('active-call-indicator');
        if (navIndicator) navIndicator.hidden = true;

        // Collapse (close) the panel so the SDR has a clean slate for the next call.
        // Only close if no new call has already started (machine back to IDLE).
        if (_open && !window.rcmDialer?.isActive?.()) {
          _toggle(); // collapses the panel
        }
        // Revert Call pane to idle state — guard again in case isActive changed
        // between the outer check and the inner 400ms timeout.
        setTimeout(() => {
          if (!window.rcmDialer?.isActive?.()) _renderCallIdle();
        }, 400);
      }, 1600);
    });

    // When call is answered (polling confirmed active) — switch from 'Ringing...' to live timer
    window.addEventListener('rcm:call-answered', (e) => {
      const sdkState = window.rcmDialer?.getState?.() || {};
      _renderCallActive(Object.assign({}, sdkState, {
        startTime: e.detail?.startTime || Date.now(),
        leadName:  e.detail?.leadName  || sdkState.leadName,
        phone:     e.detail?.phone     || sdkState.phone,
        connected: true,   // triggers timer start and "Recording" badge
      }));
    });
  }

  // ── Channel & Session ─────────────────────────────────────────────────────

  function _setChannel(ch) {
    _channel = ch;
    $channelWa?.classList.toggle('cw-active',  ch === 'whatsapp');
    $channelSms?.classList.toggle('cw-active', ch === 'sms');
    _sessionState = null;
    _selectedTpl  = null;
    if (!_leadPhone) return;   // BUG3: guard — no phone = nothing to do
    _updateComposeArea();
    _loadSessionState();
  }

  async function _loadSessionState() {
    if (_sessionLoading || !_leadPhone) return;
    _sessionLoading = true;
    _setBanner(SVG.spinner + ' Checking session…', 'info');

    const senderId = _cfg.senderId || '';
    const token    = _getToken();

    try {
      const qs = new URLSearchParams({ phone: _leadPhone, sender_id: senderId, channel: _channel });
      const resp = await fetch(`${_cfg.apiBase}/api/conversations/session-state?${qs}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      _sessionState = await resp.json();

      if (_channel === 'whatsapp' && _sessionState.requires_template) {
        _setBanner('⚠️ Session expired — select a WhatsApp template to start', 'warn');
        await _loadTemplates();
        _showTemplatePicker(true);
        _showFreeText(false);
      } else {
        _setBanner('', '');
        _showTemplatePicker(false);
        _showFreeText(true);
      }
    } catch (e) {
      _setBanner('Could not check session state', 'error');
      _showFreeText(true);   // graceful fallback
    } finally {
      _sessionLoading = false;
    }
  }

  async function _loadTemplates() {
    if (_templates.length) return;   // already loaded
    try {
      const token = _getToken();
      const resp  = await fetch(`${_cfg.apiBase}/api/conversations/templates`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data  = await resp.json();
      _templates  = data.templates || [];

      // Populate select
      $tplSelect.innerHTML = '';
      const def = _el('option', { value: '' });
      def.textContent = '— choose a template —';
      $tplSelect.appendChild(def);
      _templates.forEach(t => {
        const opt = _el('option', { value: String(t.id) });
        opt.textContent = t.name.replace(/_/g, ' ');
        $tplSelect.appendChild(opt);
      });
    } catch (e) {
      _showToast('Failed to load templates', 'error');
    }
  }

  function _updateComposeArea() {
    if (!_sessionState) {
      // BUG6: don't flash free-text while session is loading — show spinner instead
      if (_sessionLoading) {
        _showTemplatePicker(false);
        _showFreeText(false);
        $composeWrap?.classList.add('cw-hidden');
        return;
      }
      _showTemplatePicker(false);
      _showFreeText(true);
      $composeWrap?.classList.remove('cw-hidden');
      return;
    }
    $composeWrap?.classList.remove('cw-hidden');
    const needsTpl = _channel === 'whatsapp' && _sessionState.requires_template;
    _showTemplatePicker(needsTpl);
    _showFreeText(!needsTpl);
  }

  // BUG3 / v6.2.0: Show/hide message pane elements based on lead and phone state
  function _applyMsgPaneForState() {
    // SS3 fix: if _leadId was cleared (e.g. by openForManualDial) but we are
    // still on a lead page, recover context from window._currentLead.
    if (!_leadId && window._currentLead?.id) {
      _leadId    = window._currentLead.id;
      _leadPhone = window._currentLead.phone || window._currentLead.phone_secondary || null;
      _leadName  = [window._currentLead.first_name, window._currentLead.last_name].filter(Boolean).join(' ')
                   || window._currentLead.company || '';
      _updateMsgTabState();
      _updateHeader();
    }
    // v6.2.0: In ad-hoc mode (no lead), show the no-lead notice and hide everything else
    if (!_leadId) {
      $noLeadNotice?.classList.remove('cw-hidden');
      $noPhoneNotice?.classList.add('cw-hidden');
      [$channelWa?.parentElement, $sessionBanner, $tplWrap, $historyEl, $composeWrap]
        .forEach(el => { if (el) el.classList.add('cw-hidden'); });
      return;
    }
    // Lead is set — hide no-lead notice, proceed with normal phone/session checks
    $noLeadNotice?.classList.add('cw-hidden');
    const hasPhone = !!_leadPhone;
    // Toggle no-phone notice
    $noPhoneNotice?.classList.toggle('cw-hidden', hasPhone);
    // Toggle everything else
    [$channelWa?.parentElement, $sessionBanner, $tplWrap, $historyEl, $composeWrap]
      .forEach(el => { if (el) el.classList.toggle('cw-hidden', !hasPhone); });
    if (!hasPhone) return;
    // Phone present — load session if not already loaded
    if (!_sessionState && !_sessionLoading) _loadSessionState();
  }

  /** Dim/restore the Message tab depending on whether a lead is set. */
  function _updateMsgTabState() {
    const tabMsg = document.getElementById('cw-tab-msg');
    if (!tabMsg) return;
    if (!_leadId) {
      tabMsg.style.opacity = '0.45';
      tabMsg.title = 'Open a lead to use messaging';
    } else {
      tabMsg.style.opacity = '';
      tabMsg.title = '';
    }
  }

  // BUG2: Update header title to reflect current lead or fallback to brand name
  function _updateHeader() {
    if (!$headerTitle) return;
    if (_leadName || _leadPhone) {
      $headerTitle.innerHTML =
        `<span class="cw-header-lead-name">${_esc(_leadName || 'Unknown')}</span>`
        + (_leadPhone ? `<span class="cw-header-lead-phone">${_esc(_leadPhone)}</span>` : '');
    } else {
      // No lead context — leave title empty; 'RCM' brand on the left is sufficient
      $headerTitle.textContent = '';
    }
  }

  function _showTemplatePicker(show) {
    if (!$tplWrap || !$composeWrap) return;  // guard: DOM not yet built
    $tplWrap.classList.toggle('cw-hidden', !show);
    $composeWrap.classList.toggle('cw-hidden', show);
    if (show) {
      $sendBtn.disabled = !_selectedTpl;
      // Move send button into tplWrap area for template mode
      if (!$tplWrap.contains($sendBtn)) $tplWrap.appendChild($sendBtn);
    } else {
      if (!$composeWrap.contains($sendBtn)) $composeWrap.appendChild($sendBtn);
      $sendBtn.disabled = !$inputEl.value.trim();
    }
  }

  function _showFreeText(show) {
    $inputEl.style.display = show ? '' : 'none';
    if (show) $inputEl.focus();
  }

  function _renderTemplatePreview() {
    if (!$tplPreview) return;  // guard: DOM not yet built
    if (!_selectedTpl) {
      $tplPreview.classList.add('cw-hidden');
      $tplPreview.textContent = '';
      return;
    }
    let preview = _selectedTpl.template_text || '';
    if (_leadName) {
      preview = preview.replace(/\$\{contacts\.first_name\}/g, _leadName);
    }
    $tplPreview.textContent = preview;
    $tplPreview.classList.remove('cw-hidden');
  }

  function _setBanner(html, type) {
    if (!$sessionBanner) return;  // guard: DOM not yet built
    if (!html) { $sessionBanner.classList.add('cw-hidden'); return; }
    $sessionBanner.innerHTML  = html;
    $sessionBanner.className  = `cw-session-banner cw-banner-${type}`;
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  async function _send() {
    if (_sending) return;
    const useTemplate = _channel === 'whatsapp' && _sessionState && _sessionState.requires_template;

    if (useTemplate && !_selectedTpl) { _showToast('Please select a template', 'error'); return; }
    if (!useTemplate && !$inputEl.value.trim()) return;
    if (!_leadPhone) { _showToast('No lead phone number', 'error'); return; }

    _sending = true;
    $sendBtn.disabled = true;
    if (!useTemplate) $inputEl.disabled = true;

    const token    = _getToken();
    const senderId = _cfg.senderId || '';

    const body = {
      phone:               _leadPhone,
      sender_id:           senderId,
      channel:             _channel,
      conversation_id:     _sessionState ? _sessionState.conversation_id : null,
      contact_first_name:  _leadName || '',
      reference_type:      'contacts',
    };
    if (useTemplate) {
      body.template_name = _selectedTpl.name;
    } else {
      body.text = $inputEl.value.trim();
    }

    try {
      const resp = await fetch(`${_cfg.apiBase}/api/conversations/send`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (resp.ok) {
        const displayText = useTemplate
          ? (_selectedTpl.template_text || '').replace(/\$\{contacts\.first_name\}/g, _leadName || '')
          : $inputEl.value.trim();

        _messages.push({ id: 'local-' + Date.now(), dir: 'outbound', text: displayText, time: new Date(), status: 'sent' });
        _renderMessages();

        if (!useTemplate) { $inputEl.value = ''; $inputEl.style.height = 'auto'; }
        _showToast('Message sent ✓', 'success');

        // After first template send, session window opens → switch to free-text
        if (useTemplate && _sessionState) {
          _sessionState.requires_template = false;
          _showTemplatePicker(false);
          _showFreeText(true);
          _setBanner('', '');
        }
      } else {
        const err = await resp.json().catch(() => ({ detail: 'Send failed' }));
        _showToast(err.detail || 'Send failed', 'error');
      }
    } catch (e) {
      _showToast('Network error — please retry', 'error');
    } finally {
      _sending = false;
      $sendBtn.disabled = false;
      if (!useTemplate) $inputEl.disabled = false;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function _renderMessages() {
    if (!$historyEl) return;
    $historyEl.innerHTML = '';
    if (!_messages.length) {
      const empty = _el('div', { class: 'cw-msg-empty' });
      empty.innerHTML = SVG.message + '<span>No messages yet</span>';
      $historyEl.appendChild(empty);
      return;
    }
    _messages.forEach(msg => {
      const bubble  = _el('div', { class: `cw-bubble cw-${msg.dir}` });
      bubble.textContent = msg.text;
      const timeEl  = _el('div', { class: 'cw-bubble-time' });
      timeEl.textContent = _formatTime(msg.time);
      const wrapper = _el('div', {});
      wrapper.append(bubble, timeEl);
      $historyEl.appendChild(wrapper);
    });
    $historyEl.scrollTop = $historyEl.scrollHeight;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function _toggle() {
    _open = !_open;
    if (_open) {
      $panel.classList.remove('cw-hidden');
      $panel.classList.add('cw-entering');
      $panel.classList.remove('cw-leaving');
      $fab.setAttribute('aria-expanded', 'true');
      setTimeout(() => $panel.classList.remove('cw-entering'), 250);
      // BUG1: do NOT suppress #dialer-widget on open — only suppress during active calls
      // (suppression is now handled exclusively by the rcm:call-started listener)
      _updateHeader();    // BUG2: refresh title on every open
      _syncCallPane();    // sync call pane state
    } else {
      $panel.classList.add('cw-leaving');
      $panel.classList.remove('cw-entering');
      $fab.setAttribute('aria-expanded', 'false');
      // Fix C: use RCMDialer (via window.rcmDialer), not window.DialerMachine
      // (the legacy Aircall XState machine) — it is always IDLE for RCM SDRs, so
      // checking it always removed the CSS suppression even during an active RCM
      // call (showing the Aircall widget).
      if (!window.rcmDialer?.isActive?.()) {
        document.body.classList.remove('dialer-call-active');
        _dialerHideStyle = null;
      }

      setTimeout(() => {
        $panel.classList.add('cw-hidden');
        $panel.classList.remove('cw-leaving');
      }, 200);
    }
  }

  // ── Call Pane Helpers ─────────────────────────────────────────────────────

  /** Resolve and clear any pending mode-selection Promise. */
  function _resolvePendingMode(result) {
    if (_pendingModeResolve) {
      const fn = _pendingModeResolve;
      _pendingModeResolve = null;
      fn(result);
    }
  }

  /** Switch widget to the Call tab (no-op if already active). */
  function _switchToCallTab() {
    const tabCall  = document.getElementById('cw-tab-call');
    const tabMsg   = document.getElementById('cw-tab-msg');
    const paneCall = document.getElementById('cw-pane-call');
    const paneMsg  = document.getElementById('cw-pane-msg');
    if (!tabCall || !paneCall) return;
    tabCall.classList.add('cw-active');    tabCall.setAttribute('aria-selected', 'true');
    if (tabMsg)   { tabMsg.classList.remove('cw-active');  tabMsg.setAttribute('aria-selected', 'false'); }
    paneCall.classList.add('cw-active');
    if (paneMsg)  paneMsg.classList.remove('cw-active');
  }

  /**
   * Default idle state — shown when widget is opened without a pending call.
   * e.g. SDR opens the FAB without clicking a lead 📞 button.
   */
  function _renderCallIdle(paneEl) {
    paneEl = paneEl || document.getElementById('cw-pane-call');
    if (!paneEl) return;
    // If a mode-selection was pending, cancel it
    _resolvePendingMode(null);
    // When lead context exists, show the lead avatar + "Dial" button + lead call history
    if (_leadId && _leadPhone) {
      const initials = (_leadName || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      paneEl.innerHTML = `
        <div class="cw-call-idle-lead">
          <div class="cw-call-lead-info">
            <div class="cw-call-lead-avatar">${_esc(initials)}</div>
            <div class="cw-call-lead-name">${_esc(_leadName || 'Unknown')}</div>
            <div class="cw-call-lead-phone">${_esc(_leadPhone)}</div>
            <div style="font-size:11px;opacity:0.5;margin-top:4px">Ready to call</div>
          </div>
          <button class="cw-mode-btn" id="cw-idle-lead-dial" style="margin-top:8px">
            <span class="cw-mode-btn-icon">📞</span>
            <span class="cw-mode-btn-text"><strong>Dial ${_esc(_leadName || 'Lead')}</strong><small>Choose bridge or browser next</small></span>
          </button>
        </div>`;
      paneEl.querySelector('#cw-idle-lead-dial')?.addEventListener('click', () => {
        if (typeof window._openCallModal === 'function') {
          window._openCallModal(_leadId, _leadName || '', _leadPhone, window._currentLead || {});
        }
      });
      // Append lead-specific call history below the dial button (async)
      _appendCallHistory(paneEl, _leadId);
      return;
    }
    // Generic idle — no lead context. Clean widget: no call history shown here.
    // History is only relevant when a lead is open (handled in the _leadId branch above).
    paneEl.innerHTML = `
      <div class="cw-msg-empty cw-call-native">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:40px;height:40px;opacity:0.45">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372
               c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293
               c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21
               l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0
               00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
        </svg>
        <span style="font-size:13.5px;font-weight:600;color:rgba(255,255,255,0.75);margin-top:4px">Ready to call</span>
        <span style="font-size:12px;opacity:0.45;text-align:center;padding:0 20px;line-height:1.5">
          Open a lead and click the <strong>📞 Call</strong> button to start a call.
        </span>
      </div>`;
  }

  /**
   * Fetches and appends call history below the idle pane content.
   * leadId set → last 10 calls for that lead.  null → today's SDR calls (up to 10).
   */
  async function _appendCallHistory(paneEl, leadId) {
    const wrap = document.createElement('div');
    wrap.id = 'cw-call-history-wrap';
    wrap.style.cssText = 'margin-top:12px;padding:0 4px;overflow-y:auto;max-height:240px;';
    wrap.innerHTML = `
      <div style="font-size:10.5px;font-weight:700;letter-spacing:0.5px;opacity:0.35;text-transform:uppercase;margin-bottom:6px;padding:0 4px">
        ${leadId ? 'Call History' : "Today's Calls"}
      </div>
      <div id="cw-call-history-list" style="display:flex;flex-direction:column;gap:4px;">
        <div style="height:34px;background:rgba(255,255,255,0.05);border-radius:8px;opacity:0.3;"></div>
        <div style="height:34px;background:rgba(255,255,255,0.05);border-radius:8px;opacity:0.2;"></div>
      </div>`;
    paneEl.appendChild(wrap);
    try {
      // Use the same auth pattern as _loadSessionState / _loadTemplates:
      // _cfg.apiBase + _getToken() — no dynamic import() needed
      const base    = _cfg.apiBase || '';
      const token   = _getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      let calls = [];
      if (leadId) {
        const res = await fetch(`${base}/api/leads/${leadId}/calls`, { headers, credentials: 'include' });
        if (res.ok) { const d = await res.json(); calls = (d.calls || []).slice(0, 10); }
      } else {
        const res = await fetch(`${base}/api/my/today-calls`, { headers, credentials: 'include' });
        if (res.ok) { const d = await res.json(); calls = (d.calls || []).slice(0, 10); }
      }
      const list = document.getElementById('cw-call-history-list');
      if (!list) return;
      if (!calls.length) {
        list.innerHTML = `<div style="font-size:11.5px;opacity:0.35;text-align:center;padding:8px 0">No calls yet${leadId ? ' for this lead' : ' today'}</div>`;
        return;
      }
      list.innerHTML = calls.map(c => {
        // Normalise timestamp - ISO 8601 from backend after isoformat() fix
        const ts    = c.called_at || c.started_at || '';
        const d     = ts ? new Date(ts) : null;
        const valid = d && !isNaN(d.getTime());
        const time  = valid ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
        const date  = valid ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
        // Duration: /leads/{id}/calls uses 'duration', /my/today-calls uses 'duration_sec'
        const dur    = c.duration || c.duration_sec || 0;
        const durStr = dur > 0 ? `${Math.floor(dur / 60)}m ${dur % 60}s` : '';
        // Outcome: server may send “—” literal for no-outcome rows
        const rawOutcome = (c.outcome && c.outcome !== '—') ? c.outcome : '';
        const outcome    = rawOutcome.replace(/_/g, ' ');
        const { bg, text } = _outcomeColor(rawOutcome);
        const leadName = c.lead_name || '';

        return `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(255,255,255,0.05);border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
            <div style="flex:1;min-width:0;">
              ${leadName && !leadId ? `<div style="font-size:11.5px;font-weight:600;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">${_esc(leadName)}</div>` : ''}
              <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                ${outcome
                  ? `<span style="font-size:10px;background:${bg};color:${text};padding:2px 7px;border-radius:10px;font-weight:600;white-space:nowrap">${_esc(outcome)}</span>`
                  : `<span style="font-size:10px;color:rgba(255,255,255,0.45);font-style:italic">No outcome</span>`}
                ${durStr ? `<span style="font-size:10px;color:rgba(255,255,255,0.4)">${durStr}</span>` : ''}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:10.5px;color:rgba(255,255,255,0.65);white-space:nowrap">${time}</div>
              ${date && !leadId ? `<div style="font-size:9.5px;color:rgba(255,255,255,0.35);margin-top:1px">${date}</div>` : ''}
            </div>
          </div>`;
      }).join('');
    } catch (err) {
      console.warn('[RCMWidget] _appendCallHistory failed:', err.message);
      const list = document.getElementById('cw-call-history-list');
      if (list) list.innerHTML = '';
    }
  }

  /** Map a call outcome to a subtle colour badge */
  function _outcomeColor(outcome) {
    const o = (outcome || '').toLowerCase().replace(/ /g, '_');
    if (['meeting_scheduled','meeting_confirmed','interested','call_completed'].includes(o))
      return { bg: 'rgba(16,185,129,0.18)', text: '#34d399' };
    if (['no_answer','no answer','unreachable'].includes(o))
      return { bg: 'rgba(107,114,128,0.2)', text: 'rgba(255,255,255,0.7)' };
    if (['left_voicemail','left voicemail'].includes(o))
      return { bg: 'rgba(124,58,237,0.2)', text: '#c4b5fd' };
    if (['not_interested','not interested','wrong_number','wrong number'].includes(o))
      return { bg: 'rgba(239,68,68,0.15)', text: '#fca5a5' };
    if (['call_back_later','call back later'].includes(o))
      return { bg: 'rgba(245,158,11,0.18)', text: '#fcd34d' };
    return { bg: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.65)' };
  }

  /**
   * v6.2.0: Idle-with-lead state.
   * Shown when handleCallAction() calls openForCall() — SDR clicked 📞 on a lead.
   * Displays lead info + mode selector buttons inside the Call tab.
   */
  function _renderCallIdleLead(leadName, phone) {
    const pane = document.getElementById('cw-pane-call');
    if (!pane) return;

    const initials = (leadName || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const tzInfo   = _getTimezoneInfo(phone);

    pane.innerHTML = `
      <div class="cw-call-idle-lead">
        <div class="cw-call-lead-info">
          <div class="cw-call-lead-avatar">${_esc(initials)}</div>
          <div class="cw-call-lead-name">${_esc(leadName || 'Unknown')}</div>
          <div class="cw-call-lead-phone">${_esc(phone || '')}</div>
          <div class="cw-call-lead-tz" id="cw-lead-tz">${_esc(tzInfo)}</div>
        </div>
        <div class="cw-call-mode-label">Choose how to connect</div>
        <button class="cw-mode-btn" id="cw-mode-bridge">
          <span class="cw-mode-btn-icon">📱</span>
          <span class="cw-mode-btn-text">
            <strong>Phone Bridge</strong>
            <small>Rings your phone, then connects to the lead</small>
          </span>
        </button>
        <button class="cw-mode-btn" id="cw-mode-browser">
          <span class="cw-mode-btn-icon">🎧</span>
          <span class="cw-mode-btn-text">
            <strong>Browser Call</strong>
            <small>Use your browser microphone &amp; speakers</small>
          </span>
        </button>
        <button class="cw-call-cancel" id="cw-mode-cancel">Cancel</button>
      </div>`;

    // Bind mode buttons
    pane.querySelector('#cw-mode-bridge').addEventListener('click', () => {
      _renderCallConnecting('Phone Bridge');
      _resolvePendingMode('bridge');
    });
    pane.querySelector('#cw-mode-browser').addEventListener('click', () => {
      _renderCallConnecting('Browser Call');
      _resolvePendingMode('browser');
    });
    pane.querySelector('#cw-mode-cancel').addEventListener('click', () => {

      _renderCallIdle();
      _resolvePendingMode(null);
    });
  }

  /**
   * Connecting state — shown between mode selection and rcm:call-started event.
   * Replaces the confusing generic idle state during the async call initiation period.
   */
  function _renderCallConnecting(modeLabel) {
    const pane = document.getElementById('cw-pane-call');
    if (!pane) return;
    pane.innerHTML = `
      <div class="cw-msg-empty cw-call-native" style="gap:10px">
        <div style="width:36px;height:36px;border-radius:50%;border:3px solid rgba(124,58,237,0.2);border-top-color:#7c3aed;animation:cwSpin 0.8s linear infinite;"></div>
        <span style="font-size:13.5px;font-weight:600;color:rgba(255,255,255,0.85)">Connecting…</span>
        <span style="font-size:11.5px;opacity:0.5">${_esc(modeLabel)}</span>
      </div>`;
  }

  /**
   * v6.2.0: Idle-manual-dial state.
   * Shown when openForManualDial() is called (nav "Manual Dial" button or FAB dial).
   * Displays a phone number input + mode buttons inside the Call tab.
   * Resolves _pendingModeResolve with { phone, callMode } or null.
   */
  function _renderCallIdleManual() {
    const pane = document.getElementById('cw-pane-call');
    if (!pane) return;

    pane.innerHTML = `
      <div class="cw-call-idle-manual">
        <div class="cw-call-mode-label" style="text-align:left;margin-bottom:2px">Ad-hoc Dial</div>
        <div class="cw-manual-input-wrap">
          <div class="cw-manual-input-label">Phone Number</div>
          <input type="tel" id="cw-manual-phone"
            class="cw-manual-input"
            placeholder="+91 9876543210"
            autocomplete="tel" />
          <div class="cw-manual-tz" id="cw-manual-tz"></div>
        </div>
        <div class="cw-manual-mode-row">
          <div class="cw-call-mode-label">Choose how to connect</div>
          <button class="cw-mode-btn" id="cw-manual-bridge">
            <span class="cw-mode-btn-icon">📱</span>
            <span class="cw-mode-btn-text">
              <strong>Phone Bridge</strong>
              <small>Rings your phone, then connects to the lead</small>
            </span>
          </button>
          <button class="cw-mode-btn" id="cw-manual-browser">
            <span class="cw-mode-btn-icon">🎧</span>
            <span class="cw-mode-btn-text">
              <strong>Browser Call</strong>
              <small>Use your browser microphone &amp; speakers</small>
            </span>
          </button>
        </div>
        <button class="cw-call-cancel" id="cw-manual-cancel">Cancel</button>
      </div>`;

    const input   = pane.querySelector('#cw-manual-phone');
    const tzLabel = pane.querySelector('#cw-manual-tz');

    // Live timezone badge
    input.addEventListener('input', () => {
      tzLabel.textContent = _getTimezoneInfo(input.value.trim());
    });

    // Bind mode buttons — validate phone first
    const _dial = (mode) => {
      const phone = input.value.trim();
      if (!phone) {
        input.classList.add('cw-input-error');
        setTimeout(() => input.classList.remove('cw-input-error'), 1500);
        input.focus();
        return;
      }
      // ── FIX: capture + clear the resolve fn BEFORE calling _renderCallIdle().
      // _renderCallIdle() internally calls _resolvePendingMode(null) which would
      // kill the promise (resolving it with null → dialer_widget.js returns early
      // → call never fires). By clearing first, that internal call is a no-op.
      const resolveFn = _pendingModeResolve;
      _pendingModeResolve = null;

      // Show a brief "Connecting…" state while the API call is in-flight.
      // Do NOT call _renderCallIdle() here — that would load SDR call history
      // (causing random lead names to appear in the footer) and kill the promise.
      const p = document.getElementById('cw-pane-call');
      if (p) p.innerHTML = `
        <div class="cw-msg-empty cw-call-native" style="gap:8px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;opacity:0.5;animation:cw-rotate 1.2s linear infinite">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          <span style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.7)">Connecting…</span>
          <span style="font-size:11.5px;opacity:0.4">${phone}</span>
        </div>`;

      if (resolveFn) resolveFn({ phone, callMode: mode });

      // After the promise resolves, showDialerWidget (dialer_widget.js) will
      // render its own overlay and window.rcmDialer.isActive() → true.
      // However, the rcm:call-started event fires synchronously inside
      // showDialerWidget and our listener (line ~420) already calls
      // _renderCallActive() + CSS-suppresses #dialer-widget. The timer below
      // is only a safety net for cases where the event is missed or the API
      // takes unusually long. It clears itself via _activeSyncTimer when the
      // event fires. Give up after 25 s (API error / slow network).
      // RCA 2026-06-16: /api/calls/start consistently takes 2.5–3.2 s in prod;
      // the old 10 s threshold was too tight for RCM bridge initiation latency.
      let _syncAttempts = 0;
      _activeSyncTimer = setInterval(() => {
        _syncAttempts++;
        if (window.rcmDialer?.isActive()) {
          clearInterval(_activeSyncTimer);
          _activeSyncTimer = null;
          // rcm:call-started already handled rendering; nothing to do here.
        } else if (_syncAttempts >= 50) {
          // 50 × 500 ms = 25 s — API probably failed; revert to idle
          clearInterval(_activeSyncTimer);
          _activeSyncTimer = null;
          _renderCallIdle();
        }
      }, 500);


    };

    pane.querySelector('#cw-manual-bridge').addEventListener('click',  () => _dial('bridge'));
    pane.querySelector('#cw-manual-browser').addEventListener('click', () => _dial('browser'));
    pane.querySelector('#cw-manual-cancel').addEventListener('click',  () => {
      _renderCallIdle();
      _resolvePendingMode(null);
    });

    // Enter key on input focuses the bridge button
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pane.querySelector('#cw-manual-bridge')?.click();
    });

    setTimeout(() => input.focus(), 80);
  }

  /** Get a human-readable timezone badge for a phone number (uses global util if available). */
  function _getTimezoneInfo(phone) {
    try {
      const { getPhoneTimezone } = window._phoneTimezoneUtils || {};
      if (!getPhoneTimezone || !phone) return '';
      const info = getPhoneTimezone(phone);
      if (!info) return '';
      const now   = new Date();
      const local = now.toLocaleTimeString('en-US', { timeZone: info.tz, hour: '2-digit', minute: '2-digit', hour12: true });
      const hour  = parseInt(now.toLocaleString('en-US', { timeZone: info.tz, hour: 'numeric', hour12: false }), 10);
      const dot   = hour >= 8 && hour < 18 ? '🟢' : (hour >= 7 || hour < 20) ? '🟡' : '🔴';
      return `${dot} ${info.label} · ${local} local`;
    } catch { return ''; }
  }

  function _renderCallActive(state) {
    const pane = document.getElementById('cw-pane-call');
    if (!pane) return;

    // Always clear any existing timer before re-rendering
    if (_cwTimerInterval) {
      clearInterval(_cwTimerInterval);
      _cwTimerInterval = null;
    }

    const name = state?.leadName || 'Unknown';
    const phone = state?.phone || '';
    const muted = state?.muted ? 'dw-btn-active' : '';
    const held  = state?.held  ? 'dw-btn-active' : '';
    const isConnected  = !!state?.connected;   // false = ringing, true = answered
    const isBridgeMode = (state?.callMode || 'bridge') === 'bridge';
    const isRecovered  = !!state?.recovered;   // true = restored from DB after page reload

    // Phase labels — RCA-3 fix: corrected semantics for both bridge and browser.
    //   Bridge:  CALL_ANSWERED = SDR's bridge phone rings. Lead hasn't rung yet.
    //   Browser: ParticipantConnected = RCM agent bot joined. Lead hasn't rung yet.
    // "🔴 Recording" only shows when genuinely connected (BOTH sides on the call).
    let ringHint = '';
    if (!isConnected) {
      ringHint = isBridgeMode
        ? `<span class="cw-call-ring-hint"><span style="display:inline-block;animation:cwPulse 1.2s ease-in-out infinite;">📱</span> Your bridge phone will ring — answer it to connect</span>`
        : `<span class="cw-call-ring-hint"><span style="display:inline-block;animation:cwPulse 1.2s ease-in-out infinite;">🎧</span> Lead's phone is ringing — you'll hear them when they answer</span>`;
    }

    // Recovery banner — shown when widget was restored after page reload.
    const recoveryBanner = isRecovered
      ? `<div class="cw-recovery-banner">
           <span>🔄 Call recovered</span>
           ${state?.callMode === 'browser'
             ? '<span class="cw-recovery-note">Audio unavailable after refresh</span>'
             : '<span class="cw-recovery-note">Bridge reconnected</span>'
           }
         </div>`
      : '';

    // Recording/mode badge — only shown once genuinely connected.
    // Bridge: shows "Bridge" badge. Browser: shows "Live" badge.
    // Both upgrade to "Recording" once the call is really underway (connected).
    const badgeLabel = isConnected
      ? (isBridgeMode ? 'Bridge' : 'Live')
      : (isBridgeMode ? 'Dialling bridge&hellip;' : 'Connecting&hellip;');

    pane.innerHTML = `
      <div class="cw-call-live">
        ${recoveryBanner}
        <div class="cw-call-live-info">
          <span class="cw-call-live-name">${_esc(name)}</span>
          <span class="cw-call-live-phone">${_esc(phone)}</span>
          <span class="cw-call-live-timer" id="cw-call-timer">${isConnected ? '00:00' : 'Ringing\u2026'}</span>
          ${ringHint}
        </div>
        <div class="cw-call-live-controls">
          <button class="dw-btn dw-btn-mute ${muted}" title="Mute"
            onclick="window.rcmDialer?.mute?.()"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            <span>${state?.muted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button class="dw-btn dw-btn-hold ${held}" title="Hold"
            onclick="window.rcmDialer?.hold?.()"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
            <span>${state?.held ? 'Resume' : 'Hold'}</span>
          </button>
          <button class="dw-btn dw-btn-hangup" id="cw-hangup-btn" title="End Call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path>
              <line x1="23" y1="1" x2="1" y2="23"></line>
            </svg>
            <span>End</span>
          </button>
        </div>
        <div class="dw-recording-badge" style="justify-content:center;margin-top:8px">
          ${isConnected ? '<span class="dw-rec-dot"></span>' : ''}
          ${badgeLabel}
        </div>
      </div>`;
    // Bind End Call button
    const hangupBtn = pane.querySelector('#cw-hangup-btn');
    if (hangupBtn) {
      hangupBtn.addEventListener('click', async () => {
        hangupBtn.disabled = true;
        hangupBtn.querySelector('span').textContent = 'Ending…';
        hangupBtn.style.opacity = '0.6';
        try {
          // Call RCMDialer directly — avoids window.rcmDialer timing
          // dependency (bridge is assigned at init, but direct ref is always safe).
          if (typeof RCMDialer !== 'undefined' && RCMDialer.hangup) {
            await RCMDialer.hangup();
          } else {
            await window.rcmDialer?.hangup?.();
          }
        } catch (err) {
          console.error('[Widget] hangup error:', err);
        } finally {
          // Always re-enable — the pane will be replaced by the rcm:call-ended
          // listener, but if that fails the SDR must still be able to click End again.
          hangupBtn.disabled = false;
          hangupBtn.querySelector('span').textContent = 'End';
          hangupBtn.style.opacity = '';
        }
      });
    }


    // Timer — only start when call is connected (answered), not during ringing.
    // Use module-level _cwTimerInterval (cleared above on each render) rather than
    // a DOM-property hack, which breaks across innerHTML replacements.
    if (isConnected) {
      const startTime = state?.startTime || Date.now();
      _cwTimerInterval = setInterval(() => {
        const el = document.getElementById('cw-call-timer');
        if (!el) { clearInterval(_cwTimerInterval); _cwTimerInterval = null; return; }
        const secs = Math.floor((Date.now() - startTime) / 1000);
        el.textContent =
          `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
      }, 1000);
    }
  }

  // Sync the Call pane with whatever the dialer SDK currently reports
  function _syncCallPane() {
    // RCMDialer states: IDLE | INITIATING | ACTIVE | ENDING
    // IMPORTANT: check RCMDialer directly (not just window.rcmDialer)
    // because this is the same module. INITIATING = mode was selected, API call
    // is in-flight — do NOT reset to idle during this async gap.
    const dialerState = window.rcmDialer;
    if (dialerState?.isActive?.()) {
      _renderCallActive(dialerState.getState());
    } else if (dialerState?.getInternalState?.() === 'INITIATING') {
      // Call API is in-flight — keep the Connecting... spinner, don't reset.
      // The rcm:call-started event will call _renderCallActive once live.
      return;
    } else if (_pendingModeResolve && _pendingCallCtx) {
      // A mode-selection is pending for a specific lead (via openForCall Promise)
      _renderCallIdleLead(_pendingCallCtx.leadName, _pendingCallCtx.phone);
    } else if (_pendingModeResolve && !_pendingCallCtx) {
      // Manual dial mode is pending (via openForManualDial Promise)
      _renderCallIdleManual();
    } else {
      // No pending action — generic idle state
      _renderCallIdle();
    }
  }

  function _switchTab(activeKey, activeBtn, inactiveBtn, activePane, inactivePane) {
    if (!activeBtn || !inactiveBtn || !activePane || !inactivePane) return;  // guard: stale DOM refs
    activeBtn.classList.add('cw-active');    activeBtn.setAttribute('aria-selected', 'true');
    inactiveBtn.classList.remove('cw-active'); inactiveBtn.setAttribute('aria-selected', 'false');
    activePane.classList.add('cw-active');   inactivePane.classList.remove('cw-active');
    if (activeKey === 'msg' && _leadPhone && !_sessionState) _loadSessionState();
  }

  /**
   * T4A: Show a brief tooltip anchored to the FAB.
   * Used when SDR taps FAB while a call is active and panel is already open.
   * Does NOT use $root.querySelector — anchored to the FAB element directly.
   */
  function _showInlineToast(msg) {
    const existing = $fab?.querySelector('.cw-fab-tooltip');
    if (existing) existing.remove();
    const tip = _el('span', { class: 'cw-fab-tooltip' });
    tip.textContent = msg;
    $fab?.appendChild(tip);
    // Force reflow before adding visible class for transition
    void tip.offsetWidth;
    tip.classList.add('cw-fab-tooltip-visible');
    setTimeout(() => { tip.classList.remove('cw-fab-tooltip-visible'); setTimeout(() => tip.remove(), 300); }, 2500);
  }

  function _showToast(msg, type = '') {

    const existing = $root.querySelector('.cw-toast');
    if (existing) existing.remove();
    if (_toastTimer) clearTimeout(_toastTimer);
    const toast = _el('div', { class: `cw-toast${type ? ' cw-toast-' + type : ''}` });
    toast.textContent = msg;
    $root.appendChild(toast);
    _toastTimer = setTimeout(() => toast.remove(), 3500);
  }

  function _getToken() {
    if (global.__CRM_TOKEN) return global.__CRM_TOKEN;
    try { return localStorage.getItem('crm_token') || ''; } catch { return ''; }
  }

  function _formatTime(d) {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function _el(tag, attrs = {}) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  // HTML-escape helper (used in _renderCallActive template literals)
  function _esc(str) {
    const el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
  }

  global.RCMWidget = RCMWidget;

})(typeof window !== 'undefined' ? window : this);
