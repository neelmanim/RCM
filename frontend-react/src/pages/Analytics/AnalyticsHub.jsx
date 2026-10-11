/**
 * AnalyticsHub.jsx
 *
 * Root component mounted by analytics-entry.jsx into the Vanilla JS shell.
 * Owns:
 *   - Tab state:    'dashboard' | 'ask-ai'
 *   - Shared filters: pod/date/batch (Dashboard sets → Ask AI inherits)
 *   - pendingQuery: pre-filled query from topbar pill button
 *   - pinRefresh:  counter bumped by AskAiTab on pin → DashboardTab re-fetches PinnedReports
 *
 * Does NOT use AuthProvider/AuthContext — auth is handled by the Vanilla shell.
 * Token is passed as a prop and forwarded to child components.
 */
import React, { useState, useCallback } from 'react';
import { BarChart3, Sparkles, Mail, FlaskConical } from 'lucide-react';
import { DashboardTab } from './DashboardTab';
import { AskAiTab } from './AskAiTab';
import { ReportsTab } from './ReportsTab';
import { AnalyticsHubVNext } from './vnext/AnalyticsHubVNext';
import { isAdminRole } from '../../utils/roles';

// Phase 1 (Analytics Transformation): vNext entry restricted to Super Admin
// during development (docs §5 — "prefer an existing role mechanism...
// restrict during development if required"). No new config/flag system —
// same role-string-check idiom already used below for isAdmin/isSelfScoped.
// Flip to include 'admin'/'pod admin' when ready to widen access; no
// deployment is needed to leave vNext once inside it (view is plain React
// state, not a route) — only entry is gated.
const VNEXT_ALLOWED_ROLES = ['super admin'];

// The legacy Vanilla shell unmounts this whole React root on every navigation
// away from Analytics (app.js's loadView calls window.AnalyticsHub.unmount()),
// so plain useState here loses the user's applied filters on any tab switch —
// live-reproduced complaint. sessionStorage survives the unmount/remount cycle
// without needing a new store/context.
const FILTERS_STORAGE_KEY = 'analytics_hub_filters';

function loadStoredFilters() {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const AnalyticsHub = ({ token, userRole, pendingQuery }) => {
  const [tab, setTab]         = useState('dashboard');
  const [view, setView]       = useState('legacy'); // 'legacy' | 'vnext' — Phase 1 parallel beta
  const [filters, setFilters] = useState(loadStoredFilters);
  // Bumped when a report is pinned from AskAiTab → DashboardTab re-fetches PinnedReports
  const [pinRefresh, setPinRefresh] = useState(0);

  // Stable ref — prevents onFiltersChange from being a new prop on every navigate() re-render
  // Without this, DashboardTab's useEffect([filters, onFiltersChange]) fires on every navigate.
  const stableSetFilters = useCallback((f) => {
    setFilters(f);
    try { sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(f)); } catch { /* storage unavailable, filters just won't persist */ }
  }, []);

  const handlePinSuccess = useCallback(() => {
    setPinRefresh(n => n + 1);
    // Also switch to Dashboard so user can see the pinned card immediately
    setTab('dashboard');
  }, []);

  // Report scheduling hits an admin-only backend endpoint (require_admin —
  // Super Admin/Admin/Pod Admin) — hide the tab entirely for SDR/AE rather
  // than showing it and 403ing on load.
  const isAdmin = isAdminRole(userRole);
  // Ask AI's own pipeline (smart_analytics_routes.py/smart_analytics.py) has
  // no AE/SDR self-scoping at all — unlike the Dashboard tab, which is
  // fully self-scoped via _effective_ae_sdr. Hiding the tab for SDR/AE here
  // (rather than building full self-scoped NL-query safety) closes that gap
  // instead of leaving a tab that either silently 403s (AE, previously) or
  // could leak org-wide data to a self-scoped role.
  const isSelfScoped = ['ae', 'sdr'].includes((userRole || '').toLowerCase());
  const canTryVNext = VNEXT_ALLOWED_ROLES.includes((userRole || '').toLowerCase());

  if (view === 'vnext') {
    return (
      <div className="analytics-hub-root" style={{ fontFamily: 'Inter, sans-serif' }}>
        <AnalyticsHubVNext userRole={userRole} onBackToClassic={() => setView('legacy')} />
      </div>
    );
  }

  return (
    <div className="analytics-hub-root" style={{ fontFamily: 'Inter, sans-serif' }}>
      {canTryVNext && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 4px 0' }}>
          <button
            onClick={() => setView('vnext')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#4F46E5', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <FlaskConical size={13} /> Try the new Analytics Hub
          </button>
        </div>
      )}
      {/* Tab bar */}
      <div className="ah-tab-bar">
        <button
          className={`ah-tab ${tab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setTab('dashboard')}
          id="ah-tab-dashboard"
        >
          <BarChart3 size={15} style={{ display: 'inline', marginRight: 6 }} />
          Dashboard
        </button>
        {!isSelfScoped && (
          <button
            className={`ah-tab ${tab === 'ask-ai' ? 'active' : ''}`}
            onClick={() => setTab('ask-ai')}
            id="ah-tab-ask-ai"
          >
            <Sparkles size={15} style={{ display: 'inline', marginRight: 6 }} />
            Ask AI
          </button>
        )}
        {isAdmin && (
          <button
            className={`ah-tab ${tab === 'reports' ? 'active' : ''}`}
            onClick={() => setTab('reports')}
            id="ah-tab-reports"
          >
            <Mail size={15} style={{ display: 'inline', marginRight: 6 }} />
            Reports
          </button>
        )}
      </div>

      {/* Tab panels */}
      <div className="ah-tab-content">
        {tab === 'dashboard' && (
          <DashboardTab
            token={token}
            userRole={userRole}
            filters={filters}
            onFiltersChange={stableSetFilters}
            pinRefresh={pinRefresh}
          />
        )}
        {tab === 'ask-ai' && !isSelfScoped && (
          <AskAiTab
            token={token}
            filters={filters}
            initialQuery={pendingQuery || ''}
            onPinSuccess={handlePinSuccess}
            onEditFilters={() => setTab('dashboard')}
          />
        )}
        {tab === 'reports' && isAdmin && <ReportsTab />}
      </div>
    </div>
  );
};
