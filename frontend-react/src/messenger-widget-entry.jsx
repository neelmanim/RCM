/**
 * messenger-widget-entry.jsx
 *
 * Unlike the other hubs (LeadsHub, CalendarHub, ...), this widget has no
 * mount/navigate/unmount contract from the legacy shell — it's called via a
 * flat imperative API (window.MessengerWidget.init/setLead/openForCall/...)
 * from many places (app.js, dialer_widget.js, lead_detail.js, NavTopbar.jsx).
 * This entry constructs that exact API surface, backed by the module-level
 * dialerEngine/widgetUiStore singletons, and mounts the React tree
 * immediately and unconditionally (see the RCA below for why) — the tree
 * itself renders nothing until init() is actually called, so Aircall-only
 * SDRs (whose app.js never calls it) still never see this widget's FAB.
 *
 * Rollout: both this bundle and the old vanilla messenger_widget.js are
 * loaded on every page. Only one may actually take over
 * window.MessengerWidget — the React widget is now the default; set
 * localStorage 'messengerWidgetReact' to 'false' as a per-browser kill
 * switch to fall back to the vanilla widget if it needs to.
 *
 * RCA 2026-08-21 (live, prod): the tree used to mount lazily, only inside
 * init() — so any hiccup on that async path (app.js awaits dialer status,
 * wraps the whole thing in a try/catch that just console.warns) left
 * window.AlternateMessengerDialer (claimed unconditionally by dialerEngine.js at
 * parse time) driving a real call with no DOM to render it into: audio
 * worked, but no timer/mute/hangup ever appeared, and failures were silent
 * since even the toast host didn't exist. Mount immediately and
 * unconditionally instead — a plain state flag (widgetUiStore.initialized)
 * now gates the tree's *visibility*, and a flag write can't fail the way a
 * React mount can.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MessengerWidgetRoot } from './features/messenger-widget/components/MessengerWidgetRoot';
import { widgetUiStore } from './features/messenger-widget/engine/widgetUiStore';
import { toast } from './features/messenger-widget/engine/toast';
import './messenger-widget-tailwind.css';

const REACT_WIDGET_ENABLED = localStorage.getItem('messengerWidgetReact') !== 'false';

if (REACT_WIDGET_ENABLED) {
  // Mount immediately — the tree renders null until widgetUiStore.init()
  // (below) flips `initialized`, so this is invisible until a real
  // Alternate Messenger SDR's init() call actually happens.
  const container = document.createElement('div');
  container.id = 'messenger-widget-react-container';
  document.body.appendChild(container);
  createRoot(container).render(<MessengerWidgetRoot />);

  window.MessengerWidget = {
    init(config = {}) {
      if (config.apiBase) window.__CRM_API_BASE__ = config.apiBase;
      widgetUiStore.init(config);
    },

    setLead(leadId, phone, name) {
      widgetUiStore.setLead(leadId, phone, name);
    },

    open() { widgetUiStore.open(); },
    close() { widgetUiStore.close(); },
    openPanel() { widgetUiStore.openPanel(); },

    openForLead(args) { widgetUiStore.openForLead(args); },
    openForCall(args) { return widgetUiStore.openForCall(args); },
    openForManualDial() { return widgetUiStore.openForManualDial(); },

    showBadge(count) { widgetUiStore.showBadge(count); },

    notifyCallFailed(errorMsg) {
      toast(errorMsg || 'Could not connect', 'error', 6000);
    },
  };
}
