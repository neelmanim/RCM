/**
 * nav-entry.jsx
 *
 * IIFE entry point for the NavHub bundle.
 * Exposes window.NavHub = { mount, update, unmount, isMounted, openFeedback,
 * focusSearch, mountViewAsBanner }.
 *
 * Called by app.js after auth:
 *   window.NavHub.mount(sidebarEl, topbarEl, props)
 *
 * Called on every loadView():
 *   window.NavHub.update({ activeView: viewName })
 *
 * Props accepted from the Vanilla JS shell (app.js):
 *   token        {string}   JWT from localStorage('crm_token')
 *   userRole     {string}   'Super Admin' | 'Pod Admin' | 'SDR' | 'AE'
 *   userName     {string}   Full name or email for avatar/display
 *   avatarUrl    {string?}  Optional Google profile photo URL
 *   podId        {number?}  Pod ID for Pod Admin scoping
 *   apiBase      {string}   Backend origin
 *   activeView   {string}   Initial active view (e.g. 'dashboard')
 *   collapsed    {boolean}  Initial collapsed state from localStorage
 *   onNavigate   {fn}       (viewName) => void — calls app.js loadView()
 *   onLogout     {fn}       () => void — calls existing logout logic
 *   onAction     {fn}       (action, data?) => void — bridges topbar buttons
 */
import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NavSidebar } from './layout/NavSidebar';
import { NavTopbar }  from './layout/NavTopbar';
import { FeedbackModal } from './layout/FeedbackModal';
import { ViewAsBanner } from './layout/ViewAsBanner';
import { ToastHost } from './components/ui/Toast';
import './layout/NavHub.css';
import './nav-tailwind.css';

let _sidebarRoot = null;
let _topbarRoot  = null;
let _modalRoot   = null;
let _toastRoot   = null;
let _viewAsRoot  = null;
let _setModalOpen = null;  // setter exposed by the modal root component
let _focusSearch  = null;  // ref to NavTopbar's search input focus fn
let _mounted     = false;
let _currentProps = {};
let _mobileNavOpen = false; // off-canvas drawer state below the NavHub.css mobile breakpoint

function _setMobileNavOpen(open) {
  _mobileNavOpen = open;
  _render({});
}

// ── FeedbackPortal — thin wrapper so we can imperatively open the modal ──────
function FeedbackPortal() {
  const [open, setOpen] = useState(false);
  // Expose setter so window.NavHub.openFeedback() can call it
  _setModalOpen = setOpen;
  const close = useCallback(() => setOpen(false), []);
  return <FeedbackModal open={open} onClose={close} />;
}

// Internal render helper — re-renders both roots with merged props
function _render(props) {
  _currentProps = { ..._currentProps, ...props };
  if (_sidebarRoot) {
    _sidebarRoot.render(
      <NavSidebar
        {..._currentProps}
        mobileNavOpen={_mobileNavOpen}
        onCloseMobileNav={() => _setMobileNavOpen(false)}
      />
    );
  }
  if (_topbarRoot) {
    _topbarRoot.render(
      <NavTopbar
        {..._currentProps}
        onFocusSearchRef={(fn) => { _focusSearch = fn; }}
        mobileNavOpen={_mobileNavOpen}
        onToggleMobileNav={() => _setMobileNavOpen(!_mobileNavOpen)}
      />
    );
  }
}

window.NavHub = {
  mount(sidebarEl, topbarEl, props = {}) {
    if (_mounted) {
      console.warn('[NavHub] Already mounted — skipping double mount');
      return;
    }
    if (props.apiBase) {
      window.__CRM_API_BASE__ = props.apiBase;
    }
    _sidebarRoot = createRoot(sidebarEl);
    _topbarRoot  = createRoot(topbarEl);
    _render(props);

    // Mount FeedbackModal into a dedicated portal div appended to body
    const portalEl = document.createElement('div');
    portalEl.id = 'nh-feedback-portal';
    portalEl.className = 'nh-feedback-portal';
    document.body.appendChild(portalEl);
    _modalRoot = createRoot(portalEl);
    _modalRoot.render(<FeedbackPortal />);

    // Mount ToastHost into its own portal — NavHub is the one root that's
    // always present app-wide (never unmounted on loadView()), which is
    // what makes it the right host for toasts triggered from vanilla-JS
    // code (app.js) via the 'alternate:toast' CustomEvent, not just from
    // React features. See components/ui/Toast.jsx's own doc comment.
    const toastPortalEl = document.createElement('div');
    toastPortalEl.id = 'nh-toast-portal';
    document.body.appendChild(toastPortalEl);
    _toastRoot = createRoot(toastPortalEl);
    _toastRoot.render(<ToastHost />);

    _mounted = true;
  },

  /**
   * update(partialProps) — re-renders with merged props.
   * Called on every loadView() to sync activeView highlight.
   */
  update(partialProps = {}) {
    if (!_mounted) return;
    // Safety net for the mobile drawer: any real view change closes it, not
    // just clicks routed through NavSidebar's own link handler (e.g. a
    // topbar search result navigates straight via window._loadView).
    if (partialProps.activeView) _mobileNavOpen = false;
    _render(partialProps);
  },

  /**
   * openFeedback() — opens the React feedback modal.
   * Called by app.js onAction handler when action === 'feedback'.
   */
  openFeedback() {
    if (_setModalOpen) _setModalOpen(true);
  },

  /**
   * focusSearch() — focuses the React topbar search input.
   * Called by app.js '/' keyboard shortcut.
   */
  focusSearch() {
    _focusSearch?.();
  },

  /**
   * mountViewAsBanner(container, props) — renders ViewAsBanner's content
   * into `container` SYNCHRONOUSLY (flushSync), before returning. app.js
   * calls this, then immediately calls top_banner_stack.js's
   * stackTopBanner(container) — which appends container to <body> and reads
   * its offsetHeight right after. If container were still empty at that
   * point, the computed stacked height would be wrong (the same class of
   * dead-click bug stackTopBanner was written to fix). `props`: {userName,
   * userRole, onExit} — app.js owns onExit (mp.track + the actual redirect).
   */
  mountViewAsBanner(container, props = {}) {
    if (_viewAsRoot) return; // already mounted — one banner per session
    _viewAsRoot = createRoot(container);
    flushSync(() => { _viewAsRoot.render(<ViewAsBanner {...props} />); });
  },

  unmount() {
    if (_sidebarRoot) { _sidebarRoot.unmount(); _sidebarRoot = null; }
    if (_topbarRoot)  { _topbarRoot.unmount();  _topbarRoot  = null; }
    if (_modalRoot)   { _modalRoot.unmount();   _modalRoot   = null; }
    if (_toastRoot)   { _toastRoot.unmount();   _toastRoot   = null; }
    if (_viewAsRoot)  { _viewAsRoot.unmount();  _viewAsRoot  = null; }
    const portal = document.getElementById('nh-feedback-portal');
    if (portal) portal.remove();
    const toastPortal = document.getElementById('nh-toast-portal');
    if (toastPortal) toastPortal.remove();
    _mounted = false;
    _currentProps = {};
    _setModalOpen = null;
  },

  get isMounted() { return _mounted; },
};
