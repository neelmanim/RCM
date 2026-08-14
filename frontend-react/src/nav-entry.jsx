/**
 * nav-entry.jsx
 *
 * IIFE entry point for the NavHub bundle.
 * Exposes window.NavHub = { mount, update, unmount, isMounted, openFeedback }.
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
import { NavSidebar } from './layout/NavSidebar';
import { NavTopbar }  from './layout/NavTopbar';
import { FeedbackModal } from './layout/FeedbackModal';
import './layout/NavHub.css';
import './nav-tailwind.css';

let _sidebarRoot = null;
let _topbarRoot  = null;
let _modalRoot   = null;
let _setModalOpen = null;  // setter exposed by the modal root component
let _focusSearch  = null;  // ref to NavTopbar's search input focus fn
let _mounted     = false;
let _currentProps = {};

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
    _sidebarRoot.render(<NavSidebar {..._currentProps} />);
  }
  if (_topbarRoot) {
    _topbarRoot.render(
      <NavTopbar
        {..._currentProps}
        onFocusSearchRef={(fn) => { _focusSearch = fn; }}
        onSearch={(q) => window._runGlobalSearch?.(q)}
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

    _mounted = true;
  },

  /**
   * update(partialProps) — re-renders with merged props.
   * Called on every loadView() to sync activeView highlight.
   */
  update(partialProps = {}) {
    if (!_mounted) return;
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

  unmount() {
    if (_sidebarRoot) { _sidebarRoot.unmount(); _sidebarRoot = null; }
    if (_topbarRoot)  { _topbarRoot.unmount();  _topbarRoot  = null; }
    if (_modalRoot)   { _modalRoot.unmount();   _modalRoot   = null; }
    const portal = document.getElementById('nh-feedback-portal');
    if (portal) portal.remove();
    _mounted = false;
    _currentProps = {};
    _setModalOpen = null;
  },

  get isMounted() { return _mounted; },
};
