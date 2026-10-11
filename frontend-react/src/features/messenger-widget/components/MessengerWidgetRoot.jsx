import React, { useRef, useState, useSyncExternalStore } from 'react';
import { Phone, MessageSquare, X } from 'lucide-react';
import * as dialerEngine from '../engine/dialerEngine';
import { subscribe as subscribeUi, getSnapshot as getUiSnapshot, widgetUiStore } from '../engine/widgetUiStore';
import { useMessengerMessaging } from '../hooks/useMessengerMessaging';
import { CallTab } from './CallTab';
import { MessageTab } from './MessageTab';
import { ToastHost } from '../../../components/ui/Toast';
import { toast } from '../engine/toast';

const POS_STORAGE_KEY = 'cwWidgetPos';
const DRAG_THRESHOLD_PX = 4; // below this, a pointerdown+up is a click, not a drag

function loadStoredPos() {
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function MessengerWidgetRoot() {
  const dialerSnapshot = useSyncExternalStore(dialerEngine.subscribe, dialerEngine.getSnapshot);
  const ui = useSyncExternalStore(subscribeUi, getUiSnapshot);

  const [pos, setPos] = useState(loadStoredPos);
  const rootRef = useRef(null);
  const dragRef = useRef({ dragging: false, moved: false, startX: 0, startY: 0, origRight: 24, origBottom: 24 });

  const onFabPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return; // left-click / primary touch only
    const rect = rootRef.current.getBoundingClientRect();
    dragRef.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origRight: window.innerWidth - rect.right,
      origBottom: window.innerHeight - rect.bottom,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) d.moved = true;
    if (!d.moved) return;
    const fabSize = 56; // w-14
    const next = {
      right: Math.max(8, Math.min(window.innerWidth - fabSize - 8, d.origRight - dx)),
      bottom: Math.max(8, Math.min(window.innerHeight - fabSize - 8, d.origBottom - dy)),
    };
    setPos(next);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    d.dragging = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    if (d.moved) {
      setPos((current) => {
        if (current) {
          try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(current)); } catch { /* ignore quota errors */ }
        }
        return current;
      });
    }
  };

  const messaging = useMessengerMessaging({
    leadId: ui.leadId,
    leadPhone: ui.leadPhone,
    leadName: ui.leadName,
    senderId: ui.senderId,
    panelOpen: ui.open,
    tabActive: ui.activeTab === 'message',
  });

  const badgeCount = ui.externalBadgeCount ?? messaging.unreadCount;
  const callActive = dialerEngine.AlternateMessengerDialer.isActive();

  // v11.10.0: per-SDR capabilities decide which tabs exist. An in-progress call
  // pins the Call tab regardless — a live call must never be hidden by a tab
  // rule, which is the same reasoning behind mounting this tree unconditionally.
  const caps = ui.capabilities || { call: true, sms: false, whatsapp: false };
  // v13.7.0: a rep who calls on another dialer (Aircall) still gets a Call
  // tab once a lead is open — its "Dial" button goes through the same
  // window._openCallModal → handleCallAction path as the lead page's Call
  // button, so the call itself still runs on that dialer.
  const dialerCfg = (typeof window !== 'undefined' && window._dialerConfig) || {};
  const otherDialer = !caps.call && !!ui.leadId && !!dialerCfg.active && !!dialerCfg.has_credentials
    && !!dialerCfg.provider && dialerCfg.provider !== 'none';
  const canCall = !!caps.call || callActive || otherDialer;
  const canMessage = !!(caps.sms || caps.whatsapp);
  const showCallTab = canCall && (ui.activeTab === 'call' || !canMessage);

  // RCA 2026-08-21 (live, prod): this tree now mounts unconditionally and
  // early (see messenger-widget-entry.jsx) so a call can never run headless.
  // Visibility — not existence — is what's gated on init() having been
  // called for this SDR (Aircall-only SDRs must still never see the FAB).
  if (!ui.initialized) return null;

  const onFabClick = () => {
    if (dragRef.current.moved) return; // this click is the tail end of a drag, not a real click
    if (callActive) {
      if (!ui.open) widgetUiStore.open();
      else toast('End the call to close the widget', 'info', 2500);
      return;
    }
    if (ui.open) { widgetUiStore.close(); return; }
    // A mode-selection or manual-dial is already pending (e.g. the SDR minimized
    // instead of picking Bridge/Browser/Cancel) — just reopen to the same pending
    // UI. Re-running _openCallModal here would re-enter app.js's handleCallAction,
    // which stays blocked on window._callInFlight until THIS pending Promise
    // resolves — a deadlock that previously required a hard refresh to escape.
    if (ui.hasPendingMode || ui.hasPendingManualDial) { widgetUiStore.open(); return; }
    // v13.7.0: with a lead open, the button opens the panel (Message and/or
    // Call tabs) — it never dials by itself. It used to start a call to the
    // last lead the rep messaged, which on Aircall placed a real call by accident.
    if (ui.leadId) { widgetUiStore.open(); return; }
    widgetUiStore.openForManualDial();
  };

  return (
    <div
      id="messenger-widget-root"
      ref={rootRef}
      className={`cwreact fixed z-[9998] font-sans ${ui.open ? '' : 'pointer-events-none'}`}
      data-position="bottom-right"
      style={pos ? { right: pos.right, bottom: pos.bottom } : { right: 24, bottom: 24 }}
    >
      <ToastHost />

      <div
        role="dialog"
        aria-label="Communication widget"
        aria-hidden={!ui.open}
        className={`mb-3 w-[340px] h-[480px] rounded-2xl bg-[#14162a]/95 backdrop-blur-xl border border-white/10 shadow-2xl flex flex-col overflow-hidden origin-bottom-right transition-all duration-200 ease-out ${
          // RCA 2026-08-25: a non-`none` `transform` on ANY ancestor of a
          // native <select> makes Chromium render that select's dropdown
          // popup mispositioned (often centered in the viewport instead of
          // anchored under the trigger) — a well-known Chromium quirk. Once
          // open, drop the transform entirely (scale-100/translate-y-0 is
          // visually the identity transform anyway) instead of just settling
          // there, so MessageTab's template <select> isn't sitting inside a
          // transformed containing block while the panel is usable.
          ui.open ? 'opacity-100' : 'opacity-0 scale-90 translate-y-3 pointer-events-none'
        }`}
      >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 shrink-0">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 shrink-0" />
            <div className="flex-1 min-w-0">
              {(ui.leadName || ui.leadPhone) ? (
                <>
                  <div className="text-sm font-semibold text-white/90 truncate">{ui.leadName || 'Unknown'}</div>
                  {ui.leadPhone && <div className="text-[11px] text-white/45 truncate">{ui.leadPhone}</div>}
                </>
              ) : (
                <div className="text-sm font-semibold text-white/70">Alternate Messenger</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => widgetUiStore.close()}
              aria-label="Close widget"
              className="text-white/40 hover:text-white/80 shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          {/* v11.10.0: each tab renders only if this SDR holds the underlying
              capability (resolved server-side, passed through init()). A tab
              the API would refuse should never be offered — and with both tabs
              gated, a single-capability SDR gets no tab strip at all rather
              than one lone tab that does nothing. */}
          {canCall && canMessage && (
            <div role="tablist" className="flex border-b border-white/10 shrink-0">
              <button
                type="button"
                role="tab"
                aria-selected={ui.activeTab === 'call'}
                onClick={() => widgetUiStore.setActiveTab('call')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold ${
                  ui.activeTab === 'call' ? 'text-white border-b-2 border-indigo-400' : 'text-white/40'
                }`}
              >
                <Phone size={13} /> Call
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={ui.activeTab === 'message'}
                onClick={() => widgetUiStore.setActiveTab('message')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold ${
                  ui.activeTab === 'message' ? 'text-white border-b-2 border-indigo-400' : 'text-white/40'
                }`}
                style={{ opacity: ui.leadId ? 1 : 0.45 }}
                title={ui.leadId ? '' : 'Open a lead to use messaging'}
              >
                <MessageSquare size={13} /> Message
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0 flex flex-col">
            {showCallTab
              ? <CallTab dialerSnapshot={dialerSnapshot} ui={ui} />
              : <MessageTab ui={ui} messaging={messaging} />}
          </div>
        </div>

      <button
        type="button"
        onClick={onFabClick}
        onPointerDown={onFabPointerDown}
        aria-label="Open Alternate Messenger"
        aria-expanded={ui.open}
        className={`cw-fab relative w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 shadow-xl flex items-center justify-center text-white cursor-grab active:cursor-grabbing touch-none pointer-events-auto ${callActive ? 'ring-4 ring-emerald-400/50 animate-pulse' : ''}`}
      >
        <Phone size={22} />
        {badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>
    </div>
  );
}
