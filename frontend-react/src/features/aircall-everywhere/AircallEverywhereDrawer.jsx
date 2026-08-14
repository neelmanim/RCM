import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { OPT_OUT_KEY, CONTAINER_ID } from './useAircallEverywhere';
import { hasSeen, markSeen } from '../../utils/seenFlag';

const BODY_OPEN_CLASS = 'aircall-drawer-open';

const TOUR_SEEN_KEY = 'rcm:aircall-drawer-tour-seen';

const HeadsetIcon = ({ spinning }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ animation: spinning ? 'nh-spin 1s linear infinite' : 'none' }}>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
    <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const STATUS_COPY = {
  idle: { label: 'Checking…', cls: 'nh-aircall-btn--idle', spin: true },
  loading: { label: 'Loading dialer…', cls: 'nh-aircall-btn--idle', spin: true },
  ready: { label: 'Aircall connected', cls: 'nh-aircall-btn--ready' },
  notready: { label: 'Log in to Aircall', cls: 'nh-aircall-btn--notready' },
  error: { label: 'Dialer unavailable', cls: 'nh-aircall-btn--idle' },
};
const ON_CALL_COPY = { label: 'On a call', cls: 'nh-aircall-btn--oncall' };

/**
 * V48 Phase 4 — replaces the old Power-Dialer-scoped popover
 * (AircallEverywhereWidget.jsx) with a global drawer, reachable from the
 * persistent NavHub topbar instead of one page's header. useAircallEverywhere
 * itself is unchanged; only the outer shell moved.
 *
 * CRITICAL (same invariant the old widget had, now load-bearing app-wide):
 * the drawer's content — down to and including #aircall-everywhere-mount —
 * is ALWAYS rendered, never behind an `{open && ...}` conditional. Only
 * transform/pointer-events toggle. Conditionally unmounting the mount div
 * destroys the live iframe Aircall's SDK attached to — found and fixed twice
 * already this session (once here, once in the vanilla-JS sandbox); a global
 * drawer that gets this wrong reintroduces it for every SDR, not just one.
 *
 * The panel renders via a portal to document.body so it can be a true
 * position:fixed panel independent of NavTopbar's own stacking context.
 *
 * status/callActive come from useAircallEverywhere() called ONCE in
 * NavTopbar (it also needs the status, to hide the legacy Manual Dial
 * button while this drawer covers that need) — calling the hook a second
 * time here would construct a second, redundant Aircall SDK instance.
 */
export function AircallEverywhereDrawer({ status, callActive }) {
  // Single toggle-owned boolean, seeded open (preserves the "nudge login on
  // first view" behavior) — deliberately NOT re-derived from `status` on
  // every render. An earlier version OR'd in `status !== 'ready'` directly,
  // which meant toggling this to false had no effect while status wasn't
  // 'ready': the close button rendered but did nothing. Confirmed as a real
  // blocker by two independent adversarial reviews before this shipped.
  const [drawerOpen, setDrawerOpen] = useState(() => status !== 'ready');
  const triggerRef = useRef(null);
  const drawerRef = useRef(null);
  const [tourRect, setTourRect] = useState(null);

  // Mirror the two edges of the old status-driven derivation now that
  // `drawerOpen` isn't recomputed from `status` every render: arriving at
  // 'ready' auto-collapses (the forced-open nudge did its job), leaving
  // 'ready' re-opens (a fresh disconnect/login-error re-nudges even if the
  // SDR dismissed a previous prompt) — otherwise dismissing once during
  // setup would silently suppress the drawer forever, including the next
  // time login is actually needed again.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev !== 'ready' && status === 'ready') setDrawerOpen(false);
    else if (prev === 'ready' && status !== 'ready') setDrawerOpen(true);
    prevStatusRef.current = status;
  }, [status]);

  // Forced open during an active call (mute/hold/hangup only exist inside
  // Aircall's own UI, no CRM-side hangup button exists) — otherwise a manual
  // toggle, dismissible any time else. The status check is not applicable at
  // all for 'ineligible'/'opted_out' (nothing to show, or the SDR opted
  // out) — must force `open` false here rather than only in the early-return
  // JSX below, since hooks (the body-class effect in particular) run on
  // every render regardless of status.
  const open = status !== 'ineligible' && status !== 'opted_out' && (callActive || drawerOpen);
  // Broad: any explicit dismiss action (X click, trigger click, Escape) works
  // any time except mid-call. Deliberately NOT used to gate the outside-click
  // listener below — see that effect's own comment.
  const canToggle = !callActive;
  const toggleDrawer = () => { if (canToggle) setDrawerOpen((v) => !v); };

  // One-time callout pointing at the trigger, once it's showing real status
  // (not the initial 'idle' check) and the drawer isn't already covering the
  // thing it would point at — only one thing to point at here, unlike Power
  // Dialer's multi-target GuidedTour, so no step sequencing needed.
  useLayoutEffect(() => {
    if (hasSeen(TOUR_SEEN_KEY) || status === 'idle' || open || !triggerRef.current) return;
    const measure = () => setTourRect(triggerRef.current?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [status, open]);

  const finishTour = () => { setTourRect(null); markSeen(TOUR_SEEN_KEY); };

  // Push the page's own content out of the way instead of overlaying it
  // (see frontend/css/style.css's .view-container) — an SDR on a call needs
  // to read the lead's page while talking, not have it hidden behind the
  // panel. Toggled on <body> since the page content lives in the legacy
  // shell's DOM, outside this component's own React tree entirely.
  useEffect(() => {
    document.body.classList.toggle(BODY_OPEN_CLASS, open);
    return () => document.body.classList.remove(BODY_OPEN_CLASS);
  }, [open]);

  // No backdrop (content beside the drawer stays interactive), so closing on
  // an outside click needs an explicit listener instead — same pattern
  // NavTopbar already uses for its own search/Ask-AI dropdowns. Deliberately
  // scoped narrower than `canToggle`: an accidental click elsewhere on the
  // page (a lead row, a scroll) is far more common than a deliberate X
  // click, so this only fires once the SDR is actually logged in — the
  // login-nudge state can only be dismissed via an explicit X/Escape.
  const outsideClickCloseEnabled = status === 'ready' && !callActive;
  useEffect(() => {
    if (!open || !outsideClickCloseEnabled) return;
    const onMouseDown = (e) => {
      if (drawerRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setDrawerOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, outsideClickCloseEnabled]);

  // Explicit dismiss actions (X, trigger, Escape) use the broader `canToggle`
  // gate — unlike the outside-click listener above, these are deliberate.
  useEffect(() => {
    if (!open || !canToggle) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, canToggle]);

  // If the SDR was still focused inside Aircall's own login iframe the
  // instant the drawer auto-collapses (e.g. login just resolved), that focus
  // is now inside an aria-hidden subtree — move it back to the trigger
  // rather than stranding a keyboard/screen-reader user.
  useEffect(() => {
    if (open) return;
    if (drawerRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
  }, [open]);

  if (status === 'ineligible') return null;

  if (status === 'opted_out') {
    return (
      <button
        type="button"
        className="nh-aircall-optback"
        onClick={() => { localStorage.removeItem(OPT_OUT_KEY); window.location.reload(); }}
      >
        Using Aircall Desktop app
      </button>
    );
  }

  const copy = callActive ? ON_CALL_COPY : (STATUS_COPY[status] || STATUS_COPY.idle);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`nh-btn nh-aircall-btn ${copy.cls}`}
        onClick={() => { toggleDrawer(); if (tourRect) finishTour(); }}
        title={copy.label}
        aria-label={copy.label}
        id="nh-aircall-drawer-btn"
      >
        <HeadsetIcon spinning={copy.spin} />
        <span>{copy.label}</span>
      </button>

      {tourRect && createPortal(
        <div className="nh-aircall-tour" style={{ top: tourRect.bottom + 10, left: Math.min(window.innerWidth - 300, tourRect.right - 288) }}>
          <p className="nh-aircall-tour__body">
            Calls now ring right here — log in once and clicking Call on any lead rings in this drawer automatically, no need to keep the Desktop app open. Still dial from the lead's Call button, not the pad in here, so calls stay attached to the right record.
          </p>
          <button type="button" className="nh-btn nh-btn--primary nh-aircall-tour__dismiss" onClick={finishTour}>Got it</button>
        </div>,
        document.body
      )}

      {createPortal(
        <div
          ref={drawerRef}
          className={`nh-aircall-drawer${open ? ' nh-aircall-drawer--open' : ''}`}
          style={{ pointerEvents: open ? 'auto' : 'none' }}
          role="dialog"
          aria-label="Aircall"
          aria-hidden={!open}
        >
            <div className="nh-overlay-header nh-aircall-drawer__header">
              <span className="nh-aircall-drawer__title">
                <HeadsetIcon />
                {callActive ? 'Aircall — call in progress' : status === 'ready' ? 'Aircall' : 'Aircall — log in below'}
              </span>
              {canToggle && (
                <button type="button" className="nh-overlay-close" onClick={() => setDrawerOpen(false)} aria-label="Close">
                  <CloseIcon />
                </button>
              )}
            </div>
            <div className="nh-aircall-drawer__body">
              {!callActive && status !== 'ready' && (
                <p className="nh-aircall-drawer__hint">
                  Same account as your Desktop app. Once logged in, Call will ring here automatically — you won't need to open this again.
                </p>
              )}
              {callActive && (
                <p className="nh-aircall-drawer__hint">Use the controls below to mute or hang up.</p>
              )}
              {/* No forced width/height — matches Aircall's own #workspace CSS
                  in their official demo. The SDK's own fixed iframe (376x666
                  for size:'big' — confirmed via live measurement; docs/plan
                  notes elsewhere describing this as "666x376" have width and
                  height transposed) dictates the actual box. */}
              <div id={CONTAINER_ID} className="nh-aircall-drawer__mount" />
              {status !== 'error' && !callActive && (
                <button
                  type="button"
                  className="nh-aircall-optout"
                  onClick={() => { localStorage.setItem(OPT_OUT_KEY, 'bridge_only'); window.location.reload(); }}
                >
                  Prefer your Aircall Desktop app instead?
                </button>
              )}
            </div>
          </div>,
        document.body
      )}
    </>
  );
}
