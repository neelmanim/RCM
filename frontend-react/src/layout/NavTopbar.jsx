/**
 * NavTopbar.jsx
 *
 * React topbar: Search (live dropdown) + Ask AI overlay + action buttons.
 * Fully self-contained — zero dependency on vanilla DOM elements.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AircallEverywhereDrawer } from '../features/aircall-everywhere/AircallEverywhereDrawer';
import { useAircallEverywhere } from '../features/aircall-everywhere/useAircallEverywhere';

// ── Icons ─────────────────────────────────────────────────────────────────────
const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

const SyncIcon = ({ spinning }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ animation: spinning ? 'nh-spin 1s linear infinite' : 'none' }}>
    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>
);

const PhoneIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
);

const PlusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

const SparkleIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3z"/>
  </svg>
);

const SendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const BellIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);

const ClockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

// RCA-2026-05-29: 60s (not 30s) — halved poll frequency to reduce burst DB
// connections under load. Carried over from the vanilla-JS bell this replaces.
const TASK_POLL_MS = 60_000;

function _fmtRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z')).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NotificationBell() {
  const [tasks, setTasks] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const panelRef = useRef(null);

  const fetchTasks = useCallback(async () => {
    if (!window._fetchPendingTasks) return;
    try {
      const data = await window._fetchPendingTasks();
      setTasks(data || []);
      setError(false);
    } catch (err) {
      console.error('[NotificationBell] failed to fetch pending tasks', err);
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const id = setInterval(fetchTasks, TASK_POLL_MS);
    return () => clearInterval(id);
  }, [fetchTasks]);

  useEffect(() => {
    const h = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const handleSnooze = async (taskId, minutes) => {
    try {
      await window._snoozeTask?.(taskId, minutes);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch { /* keep it in the list — user can retry */ }
  };

  const handleDismiss = async (taskId) => {
    try {
      await window._dismissTask?.(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch { /* keep it in the list — user can retry */ }
  };

  const count = tasks.length;

  return (
    <div className="nh-bell" ref={panelRef}>
      <button
        className="nh-bell__btn"
        onClick={() => setOpen(v => !v)}
        title="Task Reminders"
        aria-label="Task Reminders"
        id="nh-notification-bell-btn"
      >
        <BellIcon />
        {count > 0 && (
          <span className="nh-bell__badge">{count > 9 ? '9+' : count}</span>
        )}
        {error && count === 0 && <span className="nh-bell__error-dot" title="Couldn't load notifications" />}
      </button>

      {open && (
        <div className="nh-bell__panel" role="dialog" aria-label="Task Reminders">
          <div className="nh-bell__header">
            <span>Task Reminders</span>
            {count > 0 && <span className="nh-bell__count">{count} pending</span>}
          </div>
          <div className="nh-bell__body">
            {tasks.length === 0 ? (
              <div className="nh-bell__empty">All caught up! 🎉</div>
            ) : (
              tasks.map(t => (
                <div key={t.id} className="nh-bell__item">
                  <div className="nh-bell__item-top">
                    <span className="nh-bell__item-title">{t.title}</span>
                    <span className="nh-bell__item-time">{_fmtRelative(t.due_time)}</span>
                  </div>
                  {t.lead_name && (
                    <div className="nh-bell__item-lead">
                      {t.lead_name}{t.lead_company ? ` · ${t.lead_company}` : ''}
                    </div>
                  )}
                  <div className="nh-bell__item-actions">
                    <button onClick={() => handleSnooze(t.id, 15)} title="Snooze 15 min"><ClockIcon /> 15m</button>
                    <button onClick={() => handleSnooze(t.id, 60)} title="Snooze 1 hour"><ClockIcon /> 1h</button>
                    <button onClick={() => handleDismiss(t.id)} title="Dismiss"><CheckIcon /></button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── NavTopbar ─────────────────────────────────────────────────────────────────
export function NavTopbar({
  userRole = '',
  userName = '',
  onNavigate,
  onAction,
  onSearch,
  onFocusSearchRef,
}) {
  // ── Search state ─────────────────────────────────────────────────────────
  const [searchVal,  setSearchVal]  = useState('');
  const [searchRes,  setSearchRes]  = useState(null);  // null=hidden, obj=show
  const [searching,  setSearching]  = useState(false);
  const searchRef   = useRef(null);
  const wrapperRef  = useRef(null);
  const searchTimer = useRef(null);

  // ── Ask AI state ────────────────────────────────────────────────
  const [aiOpen,     setAiOpen]     = useState(false);
  const [aiQuery,    setAiQuery]    = useState('');
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiHasResult, setAiHasResult] = useState(false); // show/hide result container + footer
  const [aiError,    setAiError]    = useState(null);    // string | null
  const aiInputRef   = useRef(null);
  const aiOverlayRef = useRef(null);
  const aiResultRef  = useRef(null); // REAL DOM node passed to runAiQuery()

  // ── Other ─────────────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);

  // Called once here (not inside AircallEverywhereDrawer) so there's only
  // ever one Aircall SDK instance. Also used below to hide the legacy
  // Manual Dial button once the drawer itself covers that need.
  const { status: aircallStatus, callActive: aircallCallActive } = useAircallEverywhere();
  const aircallEverywhereActive = ['loading', 'ready', 'notready'].includes(aircallStatus);

  const isAdmin      = ['super admin', 'admin', 'pod admin'].includes((userRole || '').toLowerCase());
  const isSuperAdmin = ['super admin', 'admin'].includes((userRole || '').toLowerCase());

  // ── Register focus fn for NavHub.focusSearch() ────────────────────────────
  useEffect(() => {
    onFocusSearchRef?.(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, [onFocusSearchRef]);

  // ── Expose window._expandAiBar so app.js onAction('askAI') still works ───
  useEffect(() => {
    window._expandAiBar = () => setAiOpen(true);
    return () => { delete window._expandAiBar; };
  }, []);

  // ── ⌘K focuses search ────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      // ⌘/ opens Ask AI
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        if (isAdmin) setAiOpen(v => !v);
      }
      // Escape closes both
      if (e.key === 'Escape') {
        setSearchRes(null);
        setAiOpen(false);
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isAdmin]);

  // ── Close search dropdown on outside click ────────────────────────────────
  useEffect(() => {
    const h = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setSearchRes(null);
      }
      if (aiOverlayRef.current && !aiOverlayRef.current.contains(e.target)) {
        setAiOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Focus AI input when overlay opens ────────────────────────────────────
  useEffect(() => {
    if (aiOpen) {
      setTimeout(() => aiInputRef.current?.focus(), 50);
    } else {
      // Clear result when closed
      setAiHasResult(false);
      setAiError(null);
      setAiQuery('');
      setAiLoading(false);
      if (aiResultRef.current) aiResultRef.current.innerHTML = '';
    }
  }, [aiOpen]);

  // ── Live search on every keystroke ───────────────────────────────────────
  const handleSearchChange = useCallback((e) => {
    const q = e.target.value;
    setSearchVal(q);
    onSearch?.(q.trim());

    clearTimeout(searchTimer.current);

    // BUG FIX: always clear searching state when input is too short
    if (!q || q.trim().length < 2) {
      setSearching(false);  // ← was missing: spinner stuck on clear
      setSearchRes(null);
      return;
    }

    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await window._globalSearchFn?.(q.trim());
        if (data) {
          setSearchRes({ leads: data.leads || [], users: data.users || [] });
        }
      } catch {
        setSearchRes({ leads: [], users: [] });
      } finally {
        setSearching(false);  // always stop spinner
      }
    }, 300);
  }, [onSearch]);

  // ── Enter → navigate to leads ─────────────────────────────────────────────
  const handleSearchKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && searchVal.trim()) {
      sessionStorage.setItem('leads_search_query', searchVal.trim());
      onNavigate?.('leads');
      setSearchVal('');
      setSearchRes(null);
      setSearching(false);
    }
    if (e.key === 'Escape') {
      setSearchRes(null);
      setSearching(false);
      searchRef.current?.blur();
    }
  }, [searchVal, onNavigate]);

  // ── Ask AI submit ─────────────────────────────────────────────────────────
  const handleAiSubmit = useCallback(async () => {
    const q = aiQuery.trim();
    if (!q || aiLoading) return;
    if (!aiResultRef.current) return;

    setAiLoading(true);
    setAiHasResult(true);  // show container so runAiQuery can render into it
    setAiError(null);
    // Clear previous result — runAiQuery will immediately write "Thinking…" into it
    aiResultRef.current.innerHTML = '';

    try {
      // Pass the REAL mounted DOM element — runAiQuery mutates it directly
      // (includes requestAnimationFrame chart draws that need a mounted node)
      if (window._runAiQuery) {
        await window._runAiQuery(q, aiResultRef.current);
      } else {
        setAiError('AI query engine not ready. Please wait a moment and try again.');
        setAiHasResult(false);
      }
    } catch (err) {
      setAiError('Query failed. Please try again.');
      setAiHasResult(false);
    } finally {
      setAiLoading(false);
    }
  }, [aiQuery, aiLoading]);

  const handleAiKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAiSubmit();
    }
  }, [handleAiSubmit]);

  // ── Sync SF ───────────────────────────────────────────────────────────────
  const handleSync = useCallback(() => {
    if (syncing) return;
    setSyncing(true);
    onAction?.('syncSF');
    setTimeout(() => setSyncing(false), 3000);
  }, [syncing, onAction]);

  const hasResults = searchRes && (searchRes.leads.length > 0 || searchRes.users.length > 0);

  return (
    <header className="nh-topbar">

      {/* ── Search ────────────────────────────────────────────────────────── */}
      <div className="nh-search" ref={wrapperRef}>
        <span className="nh-search__icon"><SearchIcon /></span>
        <input
          ref={searchRef}
          id="nh-search-input"
          type="text"
          className="nh-search__input"
          placeholder="Search leads, phone, SDRs..."
          value={searchVal}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          aria-label="Search"
          autoComplete="off"
        />
        {searching
          ? <span className="nh-search__spinner" aria-hidden="true" />
          : <kbd className="nh-search__kbd">⌘K</kbd>
        }

        {/* Inline results dropdown */}
        {searchRes !== null && (
          <div className="nh-search__results" role="listbox" aria-label="Search results">
            {!hasResults && (
              <div className="nh-search__empty">No results found.</div>
            )}
            {searchRes.leads?.length > 0 && (
              <>
                <div className="nh-search__group-label">Leads</div>
                {searchRes.leads.map(l => (
                  <div
                    key={l.id}
                    className="nh-search__result"
                    role="option"
                    onClick={() => {
                      setSearchRes(null);
                      setSearchVal('');
                      window._loadView?.('lead-detail', l.id);
                    }}
                  >
                    <div className="nh-search__result-name">{l.first_name || ''} {l.last_name || ''}</div>
                    <div className="nh-search__result-sub">{l.company || ''}{l.email ? ` · ${l.email}` : ''}{l.phone ? ` · 📞 ${l.phone}` : ''}</div>
                  </div>
                ))}
              </>
            )}
            {searchRes.users?.length > 0 && (
              <>
                <div className="nh-search__group-label">Users / SDRs</div>
                {searchRes.users.map(u => (
                  <div key={u.id ?? u.email} className="nh-search__result" role="option">
                    <div className="nh-search__result-name">{u.name || ''} <span className="nh-search__result-badge">{u.role}</span></div>
                    <div className="nh-search__result-sub">{u.email || ''}</div>
                  </div>
                ))}
              </>
            )}
            {hasResults && (
              <div className="nh-search__footer" onClick={() => {
                sessionStorage.setItem('leads_search_query', searchVal.trim());
                onNavigate?.('leads');
                setSearchVal('');
                setSearchRes(null);
              }}>
                Press Enter or <strong>view all results →</strong>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Ask AI button (admins only) ───────────────────────────────────── */}
      {isAdmin && (
        <button
          className={`nh-btn nh-btn--ai${aiOpen ? ' nh-btn--ai-active' : ''}`}
          onClick={() => setAiOpen(v => !v)}
          title="Ask AI (⌘/)"
          aria-label="Ask AI"
          id="nh-ask-ai-btn"
        >
          <SparkleIcon />
          <span>Ask AI</span>
        </button>
      )}

      {/* ── Ask AI overlay panel ──────────────────────────────────────────── */}
      {isAdmin && aiOpen && (
        <div className="nh-ai-overlay" ref={aiOverlayRef} role="dialog" aria-label="Ask AI">
          <div className="nh-overlay-header nh-ai-overlay__header">
            <div className="nh-ai-overlay__title">
              <SparkleIcon />
              <span>Ask AI</span>
            </div>
            <button className="nh-overlay-close" onClick={() => setAiOpen(false)} aria-label="Close">
              <CloseIcon />
            </button>
          </div>

          <div className="nh-ai-overlay__body">
            <div className="nh-ai-overlay__input-row">
              <input
                ref={aiInputRef}
                type="text"
                className="nh-ai-overlay__input"
                placeholder="e.g. How many calls did pod 2 make this week?"
                value={aiQuery}
                onChange={e => setAiQuery(e.target.value)}
                onKeyDown={handleAiKeyDown}
                disabled={aiLoading}
                aria-label="AI query"
              />
              <button
                className="nh-ai-overlay__submit"
                onClick={handleAiSubmit}
                disabled={aiLoading || !aiQuery.trim()}
                aria-label="Submit query"
              >
                {aiLoading
                  ? <span className="nh-search__spinner" style={{width:13,height:13}} />
                  : <SendIcon />
                }
              </button>
            </div>

            {/* Error state */}
            {aiError && (
              <div className="nh-ai-overlay__result nh-ai-overlay__result--error">
                ⚠️ {aiError}
              </div>
            )}

            {/* Real DOM result container — runAiQuery writes directly into this node */}
            <div
              ref={aiResultRef}
              className="nh-ai-overlay__result"
              style={{ display: aiHasResult && !aiError ? 'block' : 'none' }}
            />

            {/* Analytics Hub link — shown after a successful query */}
            {aiHasResult && !aiError && !aiLoading && (
              <button
                className="nh-ai-overlay__analytics-link"
                onClick={() => {
                  sessionStorage.setItem('ls_ai_pending_query', aiQuery);
                  setAiOpen(false);
                  onNavigate?.('analytics');
                }}
              >
                📊 Open full Analytics Hub →
              </button>
            )}

            {/* Hint chips — shown before first query */}
            {!aiHasResult && !aiLoading && !aiError && (
              <div className="nh-ai-overlay__hints">
                {['Calls this week by SDR', 'Top performing pod this month', 'Leads contacted today'].map(hint => (
                  <button key={hint} className="nh-ai-overlay__hint" onClick={() => {
                    setAiQuery(hint);
                    setTimeout(() => aiInputRef.current?.focus(), 10);
                  }}>
                    {hint}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Right-side actions ────────────────────────────────────────────── */}
      <div className="nh-topbar__actions">

        <NotificationBell />

        {isSuperAdmin && (
          <button
            className={`nh-btn nh-btn--ghost${syncing ? ' nh-btn--syncing' : ''}`}
            onClick={handleSync}
            disabled={syncing}
            title="Sync Salesforce"
            aria-label="Sync Salesforce"
            id="nh-sync-sf-btn"
          >
            <SyncIcon spinning={syncing} />
            <span>{syncing ? 'Syncing…' : 'Sync Salesforce'}</span>
          </button>
        )}

        {/* Hidden once Aircall Everywhere is actually usable (loading/ready/
            notready) — its drawer covers ad-hoc dialing better (Aircall's own
            dial pad, not a bespoke one). Still shown if ineligible, opted
            out, or the SDK errored, since those SDRs have no other way to
            dial a number that isn't tied to a lead. */}
        {!aircallEverywhereActive && (
          <button
            className="nh-btn nh-btn--primary"
            onClick={() => onAction?.('dial')}
            title="Dial any number"
            aria-label="Dial"
            id="nh-manual-dial-btn"
          >
            <PhoneIcon />
            <span>Dial</span>
          </button>
        )}

        <AircallEverywhereDrawer status={aircallStatus} callActive={aircallCallActive} />

        <button
          className="nh-btn nh-btn--live"
          id="nh-active-call-indicator"
          style={{ display: 'none' }}
          onClick={() => window.RCMWidget?.openPanel?.()}
          title="Active call in progress — click to manage"
          aria-live="polite"
        >
          <span className="nh-live-dot" aria-hidden="true" />
          🔴 Live Call
        </button>

        <button
          className="nh-btn nh-btn--primary"
          onClick={() => onAction?.('newLead')}
          title="Create a new lead"
          aria-label="New Lead"
          id="nh-new-lead-btn"
        >
          <PlusIcon />
          <span>New Lead</span>
        </button>

      </div>
    </header>
  );
}
