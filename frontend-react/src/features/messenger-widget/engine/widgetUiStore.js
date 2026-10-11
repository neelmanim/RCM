/**
 * widgetUiStore.js — module-level store for the widget's panel/tab/lead-context
 * UI state (NOT call state — that's dialerEngine.js; NOT message state —
 * that's useMessengerMessaging, which lives inside the always-mounted root
 * so it persists across tab switches).
 *
 * This exists at module scope, not component state, for the same reason as
 * dialerEngine: legacy code (app.js, dialer_widget.js, lead_detail.js,
 * NavTopbar.jsx) calls window.MessengerWidget's flat methods (setLead,
 * openForCall, openForManualDial, ...) completely outside React's render
 * cycle. Those methods delegate here; the mounted React tree subscribes via
 * useSyncExternalStore and re-renders whenever this store changes.
 */

import { createStore } from './createStore';

// RCA 2026-08-21 (live, prod): India SDRs reported calls that ring and connect
// (audio works — backend/engine path is fine) with literally no widget UI ever
// appearing, and call failures that show no error either. Root cause: the
// mounted React tree (messenger-widget-entry.jsx) used to only get created
// lazily inside window.MessengerWidget.init(), while window.AlternateMessengerDialer
// (the call engine) is claimed unconditionally at script-parse time. Any
// hiccup in the async init() path — swallowed by app.js's own try/catch —
// left the engine fully driving a real call with zero DOM to render it into,
// including the toast host used for failure messages. Fix: mount the tree
// unconditionally and immediately; gate only its *visibility* on this flag,
// which init() flips once app.js has actually decided this SDR uses
// Alternate Messenger. A pure state flag can't fail the way a React mount can.
let _initialized = false;
let _open = false;
let _activeTab = 'call'; // 'call' | 'message'
let _leadId = null;
let _leadPhone = null;
let _leadName = '';
let _senderId = '';
let _theme = 'dark';
let _position = 'bottom-right';
let _manualDialActive = false; // true when in ad-hoc dial mode (no lead context)
// v11.10.0: which tabs this SDR may see, from /api/me/capabilities via app.js.
// Defaults to call-only so a build that somehow inits without capabilities
// behaves like the pre-v11.10.0 widget rather than exposing channels the API
// will reject. app.js always passes real values.
let _capabilities = { call: true, sms: false, whatsapp: false };

// openForCall()/openForManualDial() resolve when the SDR picks a mode or cancels.
let _pendingCallCtx = null; // { leadId, leadName, phone } while mode selector is shown
let _pendingModeResolve = null; // fn(mode: 'bridge'|'browser'|null)
let _pendingManualDialResolve = null; // fn({ phone, callMode } | null)

let _externalBadgeCount = null; // set via the legacy showBadge() facade method

const _store = createStore(_computeSnapshot());
export const subscribe = _store.subscribe;
export const getSnapshot = _store.getSnapshot;

function _computeSnapshot() {
  return {
    initialized: _initialized,
    open: _open,
    activeTab: _activeTab,
    leadId: _leadId,
    leadPhone: _leadPhone,
    leadName: _leadName,
    senderId: _senderId,
    theme: _theme,
    position: _position,
    manualDialActive: _manualDialActive,
    capabilities: _capabilities,
    pendingCallCtx: _pendingCallCtx,
    hasPendingMode: !!_pendingModeResolve,
    hasPendingManualDial: !!_pendingManualDialResolve,
    externalBadgeCount: _externalBadgeCount,
  };
}

function _notify() {
  _store.notify(_computeSnapshot());
}

export const widgetUiStore = {
  init({ senderId = '', theme = 'dark', position = 'bottom-right', capabilities = null } = {}) {
    _senderId = senderId;
    _theme = theme;
    _position = position;
    if (capabilities) _capabilities = { ...  _capabilities, ...capabilities };
    // Don't open onto a tab this SDR can't use — a messaging-only SDR must
    // land on Message, not on an empty Call tab.
    if (!_capabilities.call && (_capabilities.sms || _capabilities.whatsapp)) _activeTab = 'message';
    _initialized = true;
    _notify();
  },

  setLead(leadId, phone, name) {
    _leadId = leadId || null;
    _leadPhone = phone || null;
    _leadName = name || '';
    _manualDialActive = false;
    // Messaging state (messages/session-state) lives in the
    // useMessengerMessaging hook, keyed off leadId/channel — it resets
    // itself once this store's leadId change propagates there.
    _notify();
  },

  open() {
    if (_open) return;
    _open = true;
    _notify();
  },

  close() {
    if (!_open) return;
    _open = false;
    _notify();
  },

  openPanel() {
    widgetUiStore.open();
  },

  // The lead page's "Message" action — opens on the Message tab, since that's
  // what was asked for (v13.7.0; it used to open on whichever tab was last).
  openForLead({ leadId, leadName, phone, lead = {} }) {
    widgetUiStore.setLead(
      leadId,
      phone || lead.phone || lead.phone_secondary || lead.company_phone || '',
      leadName,
    );
    _activeTab = 'message';
    widgetUiStore.open();
  },

  setActiveTab(tab) {
    _activeTab = tab;
    _notify();
  },

  /** Open to the Call tab's mode-selector for a specific lead. Returns a
   * Promise resolving to 'bridge' | 'browser' | null (cancelled). */
  openForCall({ leadId, leadName, phone }) {
    _pendingCallCtx = { leadId, leadName, phone };
    _manualDialActive = false;
    _leadId = leadId || null;
    _leadPhone = phone || null;
    _leadName = leadName || '';
    _activeTab = 'call';
    _open = true;

    const promise = new Promise((resolve) => { _pendingModeResolve = resolve; });
    _notify();
    return promise;
  },

  /** Open to the Call tab's manual-dial form. Returns a Promise resolving to
   * { phone, callMode } | null (cancelled). */
  openForManualDial() {
    _pendingCallCtx = null;
    _leadId = null;
    _leadName = '';
    _leadPhone = null;
    _manualDialActive = true;
    _activeTab = 'call';
    _open = true;

    const promise = new Promise((resolve) => { _pendingManualDialResolve = resolve; });
    _notify();
    return promise;
  },

  resolvePendingMode(result) {
    _pendingCallCtx = null;
    const fn = _pendingModeResolve;
    _pendingModeResolve = null;
    _notify();
    fn?.(result);
  },

  resolvePendingManualDial(result) {
    _manualDialActive = false;
    const fn = _pendingManualDialResolve;
    _pendingManualDialResolve = null;
    _notify();
    fn?.(result);
  },

  showBadge(count) {
    _externalBadgeCount = count > 0 ? count : null;
    _notify();
  },
};
