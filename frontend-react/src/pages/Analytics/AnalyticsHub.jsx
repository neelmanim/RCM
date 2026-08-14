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
import { BarChart3, Sparkles } from 'lucide-react';
import { DashboardTab } from './DashboardTab';
import { AskAiTab } from './AskAiTab';

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

  return (
    <div className="analytics-hub-root" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Tab bar */}
      <div className="ah-tab-bar">
        <button
          className={`ah-tab ${tab === 'dashboard' ? 'ah-tab--active' : ''}`}
          onClick={() => setTab('dashboard')}
          id="ah-tab-dashboard"
        >
          <BarChart3 size={15} style={{ display: 'inline', marginRight: 6 }} />
          Dashboard
        </button>
        <button
          className={`ah-tab ${tab === 'ask-ai' ? 'ah-tab--active' : ''}`}
          onClick={() => setTab('ask-ai')}
          id="ah-tab-ask-ai"
        >
          <Sparkles size={15} style={{ display: 'inline', marginRight: 6 }} />
          Ask AI
        </button>
      </div>

      {/* Tab panels */}
      <div className="ah-tab-content">
        {tab === 'dashboard' ? (
          <DashboardTab
            token={token}
            userRole={userRole}
            filters={filters}
            onFiltersChange={stableSetFilters}
            pinRefresh={pinRefresh}
          />
        ) : (
          <AskAiTab
            token={token}
            filters={filters}
            initialQuery={pendingQuery || ''}
            onPinSuccess={handlePinSuccess}
          />
        )}
      </div>
    </div>
  );
};
