/**
 * NavSidebar.jsx
 *
 * Self-contained React sidebar component for the NavHub IIFE bundle.
 * Mirrors the exact nav structure of index.html sidebar but in React,
 * with role-based visibility, collapse persistence, and fixed-position
 * tooltips (same v9.7.11 approach to escape overflow:hidden).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
const POWERED_BY = (typeof window !== 'undefined' && window.__POWERED_BY__) || 'Powered by Alternate Messenger';
import { Avatar } from '../components/ui/Avatar';
import { hasSeen, markSeen } from '../utils/seenFlag';

// Bumped 2026-09-04 when Control Center gained Upload Center history/rollback
// + the 9 missing SF Sync settings and opened to all Super Admins — clears
// itself the first time a Super Admin visits, same pattern as GuidedTour.
const CONTROL_CENTER_UPDATE_KEY = 'alternate:control-center-2026-09-parity-seen';

// ── Nav item definitions ──────────────────────────────────────────────────────
// SVG paths are taken directly from the existing index.html icons.
// roles: ['all'] = visible to everyone; otherwise list exact role strings.
const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    tooltip: 'Dashboard',
    // 2026-09-16: excludes CSM — this dashboard's whole model (My Leads,
    // Calling, Meetings Booked, an SDR/AE meetings leaderboard) is
    // lead/call activity that doesn't exist for a CSM's account-portfolio
    // work; it rendered as an all-zero, meaningless landing screen. CSM's
    // default landing view is now csm-portal itself (see app.js _parseHash).
    roles: ['Super Admin', 'Pod Admin', 'AE', 'SDR'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/>
        <rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>
      </svg>
    ),
  },
  {
    id: 'my-tasks',
    label: 'My Tasks',
    tooltip: 'My Tasks',
    // Tasks (models.Task) have no role restriction — any user can be
    // assigned one, whether created manually from a lead's detail page or
    // by a cadence step. v13.7.0: Super Admin too — reversing 2026-09-16's
    // exclusion (product owner, 2026-10-06): a Super Admin who owns leads
    // gets cadence approvals and had nowhere to find them.
    roles: ['Super Admin', 'Pod Admin', 'AE', 'SDR', 'CSM'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="6" height="6" rx="1"/>
        <path d="m3 17 2 2 4-4"/>
        <path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>
      </svg>
    ),
  },
  {
    id: 'digest',
    label: 'Team Digest',
    tooltip: 'Team Digest',
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
    // 2026-09-16: excludes CSM — live check showed "0 leads in pipeline"
    // plus a guided tour teaching Call Lists/Cadence/Email Campaigns, none
    // of which apply to a CSM (leads belong to SDR/AE; a CSM works accounts).
    roles: ['Super Admin', 'Pod Admin', 'AE', 'SDR'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    // v12: renamed from 'sales-journeys'/"Sales Cadences" — Cadence is now a
    // tab inside this umbrella (Sales Tools), alongside the new Campaigns
    // (bulk email) tab. Widened from the old Pod-Admin+ gate to 'all':
    // Campaigns has no role restriction (any SDR can email their own
    // selected leads, same reasoning as Call Lists), so the nav entry itself
    // must be reachable by everyone — Cadence keeps its own Pod-Admin+
    // restriction as an internal check inside SalesToolsHub.jsx instead of a
    // nav-level gate, mirroring Control Center's per-component gate idiom.
    id: 'sales-tools',
    label: 'Sales Tools',
    tooltip: 'Sales Tools',
    // 2026-09-16: excludes CSM — every tab here (Cadence, Email/SMS
    // Campaigns) operates on leads a rep selects themselves; a CSM has no
    // leads to select. Live check showed a CSM's Cadence tab listing other
    // reps' cadences with nothing of their own to act on.
    roles: ['Super Admin', 'Pod Admin', 'AE', 'SDR'],
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
    // Widened to Pod Admin (2026-08-19) — the Team Roster tab was built
    // specifically for Pod Admins to see their own team's lead activity;
    // the backend's GET /pods already scoped results to their own pod.
    roles: ['Super Admin', 'Pod Admin'],
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
    // 2026-09-16: excludes CSM, same reasoning as Dashboard above — it's a
    // meetings-booked competition, a metric that only applies to SDR/AE
    // outbound activity.
    roles: ['Super Admin', 'Pod Admin', 'AE', 'SDR'],
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
    id: 'ae-pipeline',
    label: 'AE Pipeline',
    tooltip: 'AE Pipeline',
    // Own-Opportunity view for AE; Pod Admin gets the same oversight
    // extension already given to the AE leaderboard. SDR excluded.
    // 2026-09-16: Super Admin removed — they now reach this same view (plus
    // CSM Portal) through the merged 'pipeline-hub' item below, one nav
    // entry with a tab for each instead of two entries for the same content.
    roles: ['AE', 'Pod Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
  },
  // 2026-09-16: CSM Portal's 4 sections promoted to their own flat top-level
  // nav items for a CSM, replacing the single 'csm-portal' item + its
  // internal tab strip — explicit product direction: "all the tabs should
  // come outside for the CSM's — a view which greets them." Super Admin
  // oversight of these same 4 sections moved to the merged 'pipeline-hub'
  // item below (CSM Portal tab), which keeps the internal tab strip since
  // that's browsing, not a CSM's own daily-driver nav.
  {
    id: 'csm-inbox',
    label: 'Inbox',
    tooltip: 'Inbox — accounts that need you today',
    roles: ['CSM'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-6l-2 3h-4l-2-3H2"/>
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
      </svg>
    ),
  },
  {
    id: 'csm-portfolio',
    label: 'Portfolio',
    tooltip: 'Portfolio — your accounts',
    roles: ['CSM'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    id: 'csm-playbooks',
    label: 'Playbooks',
    tooltip: 'Playbooks — plays worth acting on today',
    roles: ['CSM'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="6" height="6" rx="1"/>
        <path d="m3 17 2 2 4-4"/>
        <path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>
      </svg>
    ),
  },
  {
    id: 'csm-digest',
    label: 'Digest',
    tooltip: 'Digest — your weekly roll-up',
    roles: ['CSM'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>
        <path d="M4 7h5v7H4z"/><path d="M11 7h8"/><path d="M11 11h8"/><path d="M11 15h5"/>
      </svg>
    ),
  },
  {
    id: 'pipeline-hub',
    // Short label — the full "AE Pipeline & CSM Portal" name truncated to
    // "AE Pipeline & CSM Po..." at the sidebar's real width (live screenshot,
    // 2026-09-16). Tooltip keeps the full name for clarity on hover.
    label: 'Pipeline & CSM',
    tooltip: 'AE Pipeline & CSM Portal',
    // 2026-09-16: Super Admin's merged view of the two items above —
    // "the both the items should be merged as they have a tab for
    // themselves" — one nav entry, an AE Pipeline tab and a CSM Portal tab
    // inside (see features/pipeline-hub/PipelineHub.jsx).
    roles: ['Super Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
  },
  // 2026-09-09 (v12.2): 'settings' and 'admin' entries removed. Both were
  // down to roles:['Pod Admin'] purely because "Control Center is
  // Super-Admin-only for now" — no longer true, leaving a Pod Admin four
  // config entries for two concerns. Team & Access covers #admin for them;
  // #settings showed them only read-only SF status (every action on it is
  // isSuperAdmin-gated). Routes still resolve in app.js, as with
  // v11.12.3's upload/audit-logs removal.
  // 2026-09-04: 'upload' (Upload Center) and 'audit-logs' (System Logs)
  // removed entirely — both were Super-Admin-only in legacy (no Pod Admin
  // dependency to preserve, unlike Settings/Admin above) and are now fully
  // covered by Control Center's Data and Monitoring sections. Routes
  // (#upload, #audit-logs) still work in app.js if navigated to directly;
  // only the nav entries are gone.
  {
    id: 'activity-monitor',
    label: 'Activity Monitor',
    tooltip: 'Activity Monitor',
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
    roles: ['Super Admin', 'Pod Admin', 'AE', 'SDR'],
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
    // 2026-09-09 (v12.2): Super Admin added. Legacy hid this from them
    // ("Super Admin has full Settings"), but no Settings/Control Center page
    // has ever had a signature editor — so a Super Admin sent every email
    // with no signature and nowhere to set one. Route was already ungated.
    // 2026-09-16: CSM added — this item's roles list was never updated when
    // CSM was introduced, so a CSM had no way at all to connect their email
    // or manage their own dialer access. MySettingsHub itself has no role
    // logic (Email Sync/Dialer/Signature apply to any user), so this was a
    // pure nav-gating omission, not a feature that needed building.
    roles: ['Super Admin', 'SDR', 'AE', 'Pod Admin', 'CSM'],
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
    id: 'control-center',
    label: 'Control Center',
    tooltip: 'Control Center',
    // 2026-09-04: widened from single-owner allowedEmails to all Super
    // Admins — see app.js's control-center route guard for why this is
    // safe (every legacy page it consolidates is already at minimum
    // Super-Admin-accessible). Placed above Help (2026-09-04) — it's the
    // more frequently used of the two for this role.
    // 2026-09-09 (v12.2): Pod Admin added — sections are individually
    // role-gated now (control-center/constants.js), so a Pod Admin gets
    // only Team & Access, matching what admin.js already gives them.
    roles: ['Super Admin', 'Pod Admin'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2"/>
        <path d="M3 9h18"/>
        <path d="M8 4v5"/>
        <circle cx="12.5" cy="14.5" r="1.5"/>
        <circle cx="17" cy="14.5" r="1.5"/>
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
// Temporary lockdown: Pipeline & CSM Portal (the Super Admin oversight tab,
// AE's own AE Pipeline, and CSM's own Inbox/Portfolio/Playbooks/Digest) are
// hidden from EVERYONE, including admins, while that surface is reworked —
// additive on top of the existing role check, so restoring it for a role
// later is a one-line revert. Nav-hide only, not a backend gate (see
// routes/ae_pipeline_routes.py, routes/csm_portal_routes.py). Unlocked only
// for this one account, by navigating to #mogambo once per browser session
// (see app.js _parseHash, which sets MOGAMBO_KEY in sessionStorage and
// itself checks the email too — this is a second, independent gate).
export const MOGAMBO_KEY = 'alternate:mogambo-unlocked';
const PIPELINE_CSM_LOCKDOWN_EMAIL = 'neelmani.mishra@screen-magic.com';
const isPipelineOrCsmItem = (id) => id === 'pipeline-hub' || id === 'ae-pipeline' || id.startsWith('csm-');

function hasMogamboUnlock(userEmail) {
  if ((userEmail || '').trim().toLowerCase() !== PIPELINE_CSM_LOCKDOWN_EMAIL) return false;
  try { return sessionStorage.getItem(MOGAMBO_KEY) === '1'; } catch { return false; }
}

function isItemVisible(item, userRole, userEmail) {
  const role = (userRole || '').trim();
  const roleAllowed = item.roles.includes('all') || item.roles.some(r => r.toLowerCase() === role.toLowerCase());
  if (!roleAllowed) return false;
  if (isPipelineOrCsmItem(item.id)) return hasMogamboUnlock(userEmail);
  return true;
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
  userEmail = '',
  activeView = 'dashboard',
  collapsed: initialCollapsed = false,
  mobileNavOpen = false,
  onCloseMobileNav,
  onNavigate,
  onAction,
  onLogout,
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === 'true' || initialCollapsed
  );
  const [ccUnseen, setCcUnseen] = useState(() => !hasSeen(CONTROL_CENTER_UPDATE_KEY));
  // v13.7.0: approvals waiting on me, for the My Tasks badge — the bell
  // (NavTopbar) already polls them and broadcasts the count, so no second poll.
  const [approvals, setApprovals] = useState(0);
  useEffect(() => {
    const onCounts = (e) => setApprovals(e.detail?.approvals || 0);
    window.addEventListener('alternate:task-counts', onCounts);
    return () => window.removeEventListener('alternate:task-counts', onCounts);
  }, []);
  const tooltipRef = useRef(null);
  const roleColor = getRoleColor(userRole);

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
  const visibleItems = NAV_ITEMS.filter(item => isItemVisible(item, userRole, userEmail));

  // Tapping a nav link closes the mobile drawer too — a no-op on desktop.
  const navigate = useCallback((id) => {
    if (id === 'control-center' && ccUnseen) {
      markSeen(CONTROL_CENTER_UPDATE_KEY);
      setCcUnseen(false);
    }
    onNavigate?.(id);
    onCloseMobileNav?.();
  }, [onNavigate, onCloseMobileNav, ccUnseen]);

  return (
    <>
    <div
      className={`nh-mobile-backdrop${mobileNavOpen ? ' nh-mobile-backdrop--open' : ''}`}
      onClick={onCloseMobileNav}
      aria-hidden="true"
    />
    <aside className={`nh-sidebar${collapsed ? ' nh-sidebar--collapsed' : ''}${mobileNavOpen ? ' nh-sidebar--mobile-open' : ''}`}>

      {/* Brand Header */}
      <div className="nh-logo">
        <div className="w-8 h-8 rounded-xl bg-[#C9FF68] flex items-center justify-center text-[#090D0E] shrink-0 font-black shadow-[0_0_15px_rgba(201,255,104,0.3)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="2" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            <line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
          </svg>
        </div>
        {!collapsed && (
          <div className="nh-logo__text">
            <div className="flex items-center gap-1.5 leading-none">
              <span className="nh-logo__name font-black text-sm text-[#F4F6F2] tracking-tight">alternate<span className="text-[#C9FF68]">crm</span></span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-white/10 text-[#9BA9A5]">OS</span>
            </div>
            <span className="nh-logo__sub text-[10px] text-[#9BA9A5] mt-1 font-medium tracking-wide">Connected Workspace</span>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="nh-nav">
        <ul className="nh-nav__list">
          {visibleItems.map(item => {
            const isActive = activeView === item.id;
            // One badge slot per item: "Updated" for a changed page, or a count.
            const badge = item.id === 'control-center' && ccUnseen ? 'Updated'
              : item.id === 'my-tasks' && approvals > 0 ? String(approvals) : null;
            return (
              <li key={item.id} className={`nh-nav__item${isActive ? ' nh-nav__item--active' : ''}`}>
                <a
                  href="#"
                  className="nh-nav__link"
                  onClick={e => { e.preventDefault(); navigate(item.id); }}
                  onMouseEnter={e => showTooltip(e, item.tooltip)}
                  onMouseLeave={hideTooltip}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="nh-nav__icon">
                    {item.icon}
                    {badge && collapsed && <span className="nh-nav__dot" aria-hidden="true" />}
                  </span>
                  {!collapsed && <span className="nh-nav__label">{item.label}</span>}
                  {!collapsed && badge && (
                    <span className="nh-nav__badge" title={item.id === 'my-tasks' ? `${badge} approvals waiting for you` : undefined}>{badge}</span>
                  )}
                </a>
              </li>
            );
          })}

          {/* Conversation OS Sandbox Demo */}
          <li className="nh-nav__item">
            <a
              href="sandbox.html"
              className="nh-nav__link"
              style={{ color: '#818cf8' }}
              onMouseEnter={e => showTooltip(e, 'Conversation OS Sandbox')}
              onMouseLeave={hideTooltip}
              aria-label="Conversation OS Sandbox"
            >
              <span className="nh-nav__icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </span>
              {!collapsed && (
                <span className="nh-nav__label flex items-center justify-between w-full">
                  <span className="font-semibold text-indigo-300">Conversation OS</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/25 text-indigo-200 font-bold border border-indigo-500/30">DEMO</span>
                </span>
              )}
            </a>
          </li>

          {/* Feedback — separator before */}
          <li className="nh-nav__item nh-nav__item--feedback">
            <a
              href="#"
              className="nh-nav__link"
              onClick={e => { e.preventDefault(); onAction?.('feedback'); onCloseMobileNav?.(); }}
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

      {/* User footer — elevated card */}
      <div
        className="nh-footer"
        onMouseEnter={e => collapsed && showTooltip(e, userName || 'Account')}
        onMouseLeave={hideTooltip}
      >
        <div className="relative shrink-0">
          <Avatar
            name={userName}
            background={`linear-gradient(135deg, ${roleColor}, #7c3aed)`}
            className="nh-avatar"
            size={34}
          />
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#C9FF68] ring-2 ring-[#090D0E]" />
        </div>
        {!collapsed && (
          <div className="nh-footer__info">
            <span className="nh-footer__name font-bold text-xs text-[#F4F6F2]">{userName}</span>
            <span className="nh-footer__role text-[10px] font-semibold text-[#9BA9A5]">{userRole}</span>
          </div>
        )}
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
    </>
  );
}
