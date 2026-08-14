/**
 * NavSidebar.jsx
 *
 * Self-contained React sidebar component for the NavHub IIFE bundle.
 * Mirrors the exact nav structure of index.html sidebar but in React,
 * with role-based visibility, collapse persistence, and fixed-position
 * tooltips (same v9.7.11 approach to escape overflow:hidden).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { POWERED_BY } from '../generated/version.js';

// ── Nav item definitions ──────────────────────────────────────────────────────
// SVG paths are taken directly from the existing index.html icons.
// roles: ['all'] = visible to everyone; otherwise list exact role strings.
const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    tooltip: 'Dashboard',
    roles: ['all'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/>
        <rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>
      </svg>
    ),
  },
  {
    id: 'digest',
    label: 'Daily Digest',
    tooltip: 'Daily Digest',
    roles: ['Super Admin', 'Pod Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>
        <path d="M4 7h5v7H4z"/><path d="M11 7h8"/><path d="M11 11h8"/><path d="M11 15h5"/>
      </svg>
    ),
  },
  {
    id: 'leads',
    label: 'Leads',
    tooltip: 'Leads',
    roles: ['all'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    id: 'sales-journeys',
    label: 'Sales Cadences',
    tooltip: 'Sales Cadences',
    // Widened to Pod Admin+ (2026-08-14) to match the backend's
    // require_pod_admin_or_above gate on journey_routes.py — was
    // Super-Admin-only for a one-week soft launch starting 2026-08-07. SDRs
    // still see their own leads' enrollment status via the Lead Detail page's
    // Journey Status card, which uses a separate, unrestricted endpoint.
    roles: ['Super Admin', 'Admin', 'Pod Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect width="8" height="8" x="3" y="3" rx="2"/><rect width="8" height="8" x="13" y="13" rx="2"/>
        <path d="M7 11v3a2 2 0 0 0 2 2h2"/><path d="M17 13v-3a2 2 0 0 0-2-2h-2"/>
      </svg>
    ),
  },
  {
    id: 'pods',
    label: 'POD Management',
    tooltip: 'POD Management',
    roles: ['Super Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    tooltip: 'Leaderboard',
    roles: ['all'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
        <path d="M4 22h16"/>
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    tooltip: 'Settings',
    roles: ['Super Admin', 'Pod Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 7h-9"/><path d="M14 17H5"/>
        <circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>
      </svg>
    ),
  },
  {
    id: 'admin',
    label: 'Admin',
    tooltip: 'Admin',
    roles: ['Super Admin', 'Pod Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
  {
    id: 'upload',
    label: 'Upload Center',
    tooltip: 'Upload Center',
    roles: ['Super Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    ),
  },
  {
    id: 'audit-logs',
    label: 'System Logs',
    tooltip: 'System Logs',
    roles: ['Super Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/>
        <path d="M19 17V5a2 2 0 0 0-2-2H4"/>
        <line x1="10" y1="13" x2="16" y2="13"/><line x1="10" y1="9" x2="16" y2="9"/>
      </svg>
    ),
  },
  {
    id: 'call-monitor',
    label: 'Call Monitor',
    tooltip: 'Call Monitor',
    roles: ['Super Admin', 'Pod Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    id: 'analytics',
    label: 'Analytics Hub',
    tooltip: 'Analytics Hub',
    roles: ['Super Admin', 'Pod Admin', 'AE'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18"/><path d="M18 17V5"/><path d="M13 17V9"/><path d="M8 17v-5"/>
      </svg>
    ),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    tooltip: 'Calendar',
    roles: ['all'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
  },
  {
    id: 'my-calls',
    label: 'Power Dialer',
    tooltip: 'Power Dialer',
    roles: ['SDR', 'AE'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 7 23 1 17 1"/><line x1="16" y1="8" x2="23" y2="1"/>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5 19.79 19.79 0 0 1 1.61 4.87 2 2 0 0 1 3.58 2.69h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10a16 16 0 0 0 6 6l.92-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 17.3z"/>
      </svg>
    ),
  },
  {
    id: 'my-settings',
    label: 'My Settings',
    tooltip: 'My Settings',
    roles: ['SDR', 'AE', 'Pod Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="15" r="3"/>
        <path d="M18 12v-1a4 4 0 0 0-4-4h-1"/><path d="M10 20.7V22a4 4 0 0 0 4-4v-.3"/>
        <path d="m21.7 16.4-.9-.3"/><path d="m15.2 13.9-.9-.3"/><path d="m16.6 21.7.3-.9"/>
        <path d="m19.1 15.2.3-.9"/><path d="m19.6 21.7-.4-1"/><path d="m16.8 15-.4-1"/>
        <path d="m14.3 19.6 1-.4"/><path d="m20.7 17.8 1-.4"/>
        <path d="M2 21v-2a4 4 0 0 1 4-4h3"/><circle cx="7" cy="9" r="4"/>
      </svg>
    ),
  },
  {
    id: 'playground',
    label: 'Playground',
    tooltip: 'Playground',
    roles: ['Super Admin', 'Pod Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3z"/>
        <path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>
      </svg>
    ),
  },
  {
    id: 'user-guide',
    label: 'Help',
    tooltip: 'Help',
    roles: ['all'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
];

// Logout SVG icon
const LogoutIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

// Collapse toggle icon
const CollapseIcon = ({ collapsed }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    {collapsed
      ? <polyline points="9 18 15 12 9 6"/>   // › expand
      : <polyline points="15 18 9 12 15 6"/>  // ‹ collapse
    }
  </svg>
);

// ── Role visibility helper ────────────────────────────────────────────────────
function isItemVisible(item, userRole) {
  if (item.roles.includes('all')) return true;
  const role = (userRole || '').trim();
  return item.roles.some(r => r.toLowerCase() === role.toLowerCase());
}

// ── Avatar initials helper ───────────────────────────────────────────────────
function getInitial(name) {
  return (name || 'U')[0].toUpperCase();
}

function getRoleColor(userRole) {
  const r = (userRole || '').toLowerCase();
  if (r.includes('super') || r === 'admin') return '#7c3aed';
  if (r.includes('pod'))  return '#2563eb';
  if (r === 'ae')         return '#059669';
  return '#6366f1'; // SDR default
}

// ── NavSidebar ────────────────────────────────────────────────────────────────
export function NavSidebar({
  userRole = '',
  userName = '',
  activeView = 'dashboard',
  collapsed: initialCollapsed = false,
  onNavigate,
  onAction,
  onLogout,
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === 'true' || initialCollapsed
  );
  const tooltipRef = useRef(null);
  const roleColor = getRoleColor(userRole);
  const initial   = getInitial(userName);

  // Persist collapse state to localStorage — keeps app.js toggle in sync too
  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  // ── Fixed-position tooltip (v9.7.11 pattern — escapes overflow:hidden) ───
  const showTooltip = useCallback((e, text) => {
    if (!collapsed) return; // only in collapsed mode
    const tip = tooltipRef.current;
    if (!tip) return;
    const rect = e.currentTarget.getBoundingClientRect();
    tip.textContent = text;
    tip.style.top  = (rect.top + rect.height / 2) + 'px';
    tip.style.left = (rect.right + 10) + 'px';
    tip.style.opacity = '1';
    tip.style.pointerEvents = 'none';
  }, [collapsed]);

  const hideTooltip = useCallback(() => {
    const tip = tooltipRef.current;
    if (tip) tip.style.opacity = '0';
  }, []);

  // Visible items for this role
  const visibleItems = NAV_ITEMS.filter(item => isItemVisible(item, userRole));

  return (
    <aside className={`nh-sidebar${collapsed ? ' nh-sidebar--collapsed' : ''}`}>

      {/* Logo */}
      <div className="nh-logo">
        <img
          src="img/rcm-logo.png"
          alt="RCM"
          className="nh-logo__icon"
        />
        {!collapsed && (
          <div className="nh-logo__text">
            <span className="nh-logo__name">RCM</span>
            <span className="nh-logo__sub">{POWERED_BY}</span>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="nh-nav">
        <ul className="nh-nav__list">
          {visibleItems.map(item => {
            const isActive = activeView === item.id;
            return (
              <li key={item.id} className={`nh-nav__item${isActive ? ' nh-nav__item--active' : ''}`}>
                <a
                  href="#"
                  className="nh-nav__link"
                  onClick={e => { e.preventDefault(); onNavigate?.(item.id); }}
                  onMouseEnter={e => showTooltip(e, item.tooltip)}
                  onMouseLeave={hideTooltip}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="nh-nav__icon">{item.icon}</span>
                  {!collapsed && <span className="nh-nav__label">{item.label}</span>}
                </a>
              </li>
            );
          })}

          {/* Feedback — separator before */}
          <li className="nh-nav__item nh-nav__item--feedback">
            <a
              href="#"
              className="nh-nav__link"
              onClick={e => { e.preventDefault(); onAction?.('feedback'); }}
              onMouseEnter={e => showTooltip(e, 'Send Feedback')}
              onMouseLeave={hideTooltip}
              aria-label="Send Feedback"
            >
              <span className="nh-nav__icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </span>
              {!collapsed && <span className="nh-nav__label">Send Feedback</span>}
            </a>
          </li>
        </ul>
      </nav>

      {/* User footer — avatar + name + logout (always visible) */}
      <div
        className="nh-footer"
        onMouseEnter={e => collapsed && showTooltip(e, userName || 'Account')}
        onMouseLeave={hideTooltip}
      >
        <div
          className="nh-avatar"
          style={{ background: `linear-gradient(135deg, ${roleColor}, #7c3aed)` }}
          title={!collapsed ? undefined : userName}
        >
          {initial}
        </div>
        {!collapsed && (
          <div className="nh-footer__info">
            <span className="nh-footer__name">{userName}</span>
            <span className="nh-footer__role">{userRole}</span>
          </div>
        )}
        {/* Logout — always visible (fixes Part 1 bug) */}
        <button
          className="nh-logout-btn"
          onClick={onLogout}
          title="Sign out"
          aria-label="Sign out"
          onMouseEnter={e => { e.stopPropagation(); collapsed && showTooltip(e, 'Sign out'); }}
          onMouseLeave={hideTooltip}
        >
          <LogoutIcon />
        </button>
      </div>

      {/* Collapse toggle button — floats on sidebar edge */}
      <button
        className="nh-collapse-btn"
        onClick={toggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <CollapseIcon collapsed={collapsed} />
      </button>

      {/* Fixed-position tooltip div — escapes overflow:hidden (v9.7.11 pattern) */}
      <div ref={tooltipRef} className="nh-tooltip" aria-hidden="true" />
    </aside>
  );
}
