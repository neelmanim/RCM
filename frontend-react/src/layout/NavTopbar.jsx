/**
 * NavTopbar.jsx
 *
 * React topbar: Search (live dropdown) + Ask AI overlay + action buttons.
 * Fully self-contained — zero dependency on vanilla DOM elements.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AircallEverywhereDrawer } from '../features/aircall-everywhere/AircallEverywhereDrawer';
import { useAircallEverywhere } from '../features/aircall-everywhere/useAircallEverywhere';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/Popover';
import { SearchInput } from '../components/ui/SearchInput';
import { Spinner } from '../components/ui/Spinner';
import { isAdminRole } from '../utils/roles';
import { Bell, Check, CheckCircle2, Clock, Compass, X } from 'lucide-react';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { CreateLeadModal } from './CreateLeadModal';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { describeDue, isApproval, splitTitle, taskKind } from '../components/tasks/taskMeta';

// ── Icons ─────────────────────────────────────────────────────────────────────
const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
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

/** One notification: the main area is a real button that opens it; the
 *  small icon actions sit beside it (not inside), so Enter/Space on an action
 *  never also opens the item. */
function BellItem({ item, kindLabel, when, onOpen, actions }) {
  const { title } = splitTitle(item.title);
  return (
    <div className="flex items-start gap-1 pr-3 hover:bg-slate-50 focus-within:bg-slate-50">
      <button type="button" onClick={onOpen}
        className="flex flex-1 min-w-0 items-start gap-3 pl-4 py-3 text-left bg-transparent border-0 cursor-pointer font-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-lg">
        <Avatar name={item.lead_name || '?'} size={30} className="mt-0.5 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-slate-800 truncate">{title}</span>
          <span className="block mt-0.5 text-xs text-slate-500 truncate">
            {kindLabel && <span className="text-slate-600">{kindLabel} · </span>}
            {item.lead_name}{item.lead_company ? ` · ${item.lead_company}` : ''}
          </span>
          {when && <span className="block mt-0.5 text-[11px] text-slate-400">{when}</span>}
        </span>
      </button>
      {actions && <div className="flex items-center gap-0.5 pt-3">{actions}</div>}
    </div>
  );
}

function BellSection({ label, count, children }) {
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <Badge>{count}</Badge>
      </div>
      {children}
    </div>
  );
}

/** v13.7.0 bell: what needs the rep now — approvals the cadence is paused on,
 *  unread prospect replies, and due task reminders. Every item opens where
 *  the rep acts on it (My Tasks for approvals, the lead otherwise). */
// "Guide": replays the guided tour of the page you are on. Pages with a tour announce it (alternate:tours-changed); pages without one
// show no button. The tour itself lives in components/ui/GuidedTour.jsx.
function PageGuideButton() {
  const [has, setHas] = useState(() => Object.keys(window.__CRM_TOURS__ || {}).length > 0);
  useEffect(() => {
    const sync = () => setHas(Object.keys(window.__CRM_TOURS__ || {}).length > 0);
    window.addEventListener('alternate:tours-changed', sync);
    sync();
    return () => window.removeEventListener('alternate:tours-changed', sync);
  }, []);
  if (!has) return null;
  return (
    <button type="button" className="nh-bell__btn" id="nh-page-guide-btn" title="Show me around this page" aria-label="Show me around this page"
      onClick={() => window.dispatchEvent(new CustomEvent('alternate:start-tour'))}>
      <Compass size={16} strokeWidth={2} />
    </button>
  );
}

function NotificationBell() {
  const [tasks, setTasks] = useState([]);
  const [replies, setReplies] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);

  const fetchTasks = useCallback(async () => {
    const results = await Promise.allSettled([
      window._fetchPendingTasks?.(),
      window._fetchPendingReplies?.(),
    ]);
    const [taskResult, replyResult] = results;
    if (taskResult.status === 'fulfilled') {
      setTasks(taskResult.value || []);
      // The sidebar's My Tasks badge listens for this (one poll, two consumers).
      window.dispatchEvent(new CustomEvent('alternate:task-counts', {
        detail: { approvals: (taskResult.value || []).filter(isApproval).length },
      }));
    }
    if (replyResult.status === 'fulfilled') setReplies(replyResult.value || []);
    const failed = results.some(r => r.status === 'rejected');
    if (failed) console.error('[NotificationBell] failed to fetch pending notifications', results);
    setError(failed);
  }, []);

  useEffect(() => {
    fetchTasks();
    const id = setInterval(fetchTasks, TASK_POLL_MS);
    window.addEventListener('alternate:tasks-changed', fetchTasks);
    return () => { clearInterval(id); window.removeEventListener('alternate:tasks-changed', fetchTasks); };
  }, [fetchTasks]);

  const go = (view, extra) => { setOpen(false); window._loadView?.(view, extra); };

  const drop = (setter, id) => setter(prev => prev.filter(x => x.id !== id));
  const handleSnooze = async (taskId) => {
    try { await window._snoozeTask?.(taskId, 60); drop(setTasks, taskId); } catch { /* keep it — user can retry */ }
  };
  const handleDismiss = async (taskId) => {
    try { await window._dismissTask?.(taskId); drop(setTasks, taskId); } catch { /* keep it — user can retry */ }
  };
  const handleDismissReply = async (activityId) => {
    try { await window._dismissReply?.(activityId); drop(setReplies, activityId); } catch { /* keep it — user can retry */ }
  };

  const approvals = tasks.filter(isApproval);
  const reminders = tasks.filter(t => !isApproval(t));
  const count = tasks.length + replies.length;

  return (
    <div className="nh-bell">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="nh-bell__btn"
            title="Notifications"
            aria-label={count ? `Notifications — ${count} waiting` : 'Notifications'}
            id="nh-notification-bell-btn"
          >
            <Bell size={16} strokeWidth={2} />
            {count > 0 && (
              <span className="nh-bell__badge">{count > 9 ? '9+' : count}</span>
            )}
            {error && count === 0 && <span className="nh-bell__error-dot" title="Couldn't load notifications" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8}
          className="nh-feedback-portal w-[380px] max-w-[calc(100vw-24px)] p-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-800">Notifications</span>
            {count > 0 && <Badge variant="primary">{count} waiting</Badge>}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {count === 0 ? (
              <EmptyState icon={CheckCircle2} title="You're all caught up" message="Approvals, replies and due tasks show up here." className="py-8" />
            ) : (
              <>
                {approvals.length > 0 && (
                  <BellSection label="Approvals waiting" count={approvals.length}>
                    {approvals.map(t => (
                      <BellItem key={t.id} item={t} onOpen={() => go('my-tasks', 'approvals')}
                        kindLabel={taskKind(t)?.label}
                        when={describeDue(t)?.text} />
                    ))}
                  </BellSection>
                )}
                {replies.length > 0 && (
                  <BellSection label="Replies" count={replies.length}>
                    {replies.map(r => (
                      <BellItem key={r.id} item={r} onOpen={() => go('lead-detail', r.lead_id)} when={_fmtRelative(r.due_time)}
                        actions={<IconButton onClick={() => handleDismissReply(r.id)} title="Mark as read" aria-label="Mark reply as read"><Check size={14} /></IconButton>} />
                    ))}
                  </BellSection>
                )}
                {reminders.length > 0 && (
                  <BellSection label="Due tasks" count={reminders.length}>
                    {reminders.map(t => (
                      <BellItem key={t.id} item={t} onOpen={() => go('lead-detail', t.lead_id)} when={describeDue(t)?.text}
                        actions={<>
                          <IconButton onClick={() => handleSnooze(t.id)} title="Snooze 1 hour" aria-label="Snooze 1 hour"><Clock size={14} /></IconButton>
                          <IconButton onClick={() => handleDismiss(t.id)} title="Dismiss reminder (the task stays open)" aria-label="Dismiss reminder"><X size={14} /></IconButton>
                        </>} />
                    ))}
                  </BellSection>
                )}
              </>
            )}
          </div>
          <div className="border-t border-slate-100 px-2 py-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => go('my-tasks')}>Open My Tasks</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ── NavTopbar ─────────────────────────────────────────────────────────────────
export function NavTopbar({
  userRole = '',
  userName = '',
  onNavigate,
  onAction,
  onFocusSearchRef,
  mobileNavOpen = false,
  onToggleMobileNav,
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
  const aiResultRef  = useRef(null); // REAL DOM node passed to runAiQuery()

  // ── Other ─────────────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setCreateLeadOpen(true);
    window.addEventListener('alternate:open-new-lead', onOpen);
    return () => window.removeEventListener('alternate:open-new-lead', onOpen);
  }, []);

  // Called once here (not inside AircallEverywhereDrawer) so there's only
  // ever one Aircall SDK instance. Also used below to hide the legacy
  // Manual Dial button once the drawer itself covers that need.
  const { status: aircallStatus, callActive: aircallCallActive } = useAircallEverywhere();
  const aircallEverywhereActive = ['loading', 'ready', 'notready'].includes(aircallStatus);

  const isAdmin      = isAdminRole(userRole);
  const isSuperAdmin = ['super admin', 'admin'].includes((userRole || '').toLowerCase());
  const isCSM        = (userRole || '').toLowerCase() === 'csm';

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
      // Escape closes search (Ask AI's Popover handles its own Escape close)
      if (e.key === 'Escape') {
        setSearchRes(null);
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

  // ── Live search ──────────────────────────────────────────────────────────
  // One request per pause in typing, never a pile-up: the previous request is cancelled when a new one starts, a late
  // answer for an older query is ignored, identical recent queries come from a small in-memory cache (backspacing is
  // instant), and the old results stay on screen (dimmed) while the next ones load instead of flashing empty.
  const searchSeq   = useRef(0);
  const searchAbort = useRef(null);
  const searchCache = useRef(new Map());                 // query -> { at, data }, max 20 entries, 15 s
  const runSearch = useCallback(async (q) => {
    const hit = searchCache.current.get(q);
    if (hit && Date.now() - hit.at < 15000) {
      setSearchRes(hit.data);
      setSearching(false);
      return;
    }
    searchAbort.current?.abort();
    const ctl = new AbortController();
    searchAbort.current = ctl;
    const seq = ++searchSeq.current;
    try {
      const data = await window._globalSearchFn?.(q, ctl.signal);
      if (seq !== searchSeq.current) return;             // a newer query already took over
      const res = { leads: data?.leads || [], users: data?.users || [], accounts: data?.accounts || [] };
      searchCache.current.set(q, { at: Date.now(), data: res });
      if (searchCache.current.size > 20) searchCache.current.delete(searchCache.current.keys().next().value);
      setSearchRes(res);
    } catch (err) {
      if (err?.name === 'AbortError' || seq !== searchSeq.current) return;
      setSearchRes({ leads: [], users: [], accounts: [] });
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, []);

  const handleSearchChange = useCallback((e) => {
    const q = e.target.value;
    setSearchVal(q);
    clearTimeout(searchTimer.current);
    if (!q || q.trim().length < 2) {
      searchSeq.current += 1;                            // drop anything still in flight
      searchAbort.current?.abort();
      setSearching(false);
      setSearchRes(null);
      return;
    }
    setSearching(true);
    setSearchRes((prev) => prev ?? { leads: [], users: [], accounts: [] });   // open the dropdown now, no dead wait
    searchTimer.current = setTimeout(() => runSearch(q.trim()), 250);
  }, [runSearch]);

  // ── Enter → navigate to leads ─────────────────────────────────────────────
  const handleSearchKeyDown = useCallback((e) => {
    // No "view all results" destination applies to a CSM — their search is
    // scoped to accounts/users, not leads, and there's no all-accounts
    // search results page (Portfolio's own filter is a separate, local
    // search box). Individual account results are still directly clickable.
    if (e.key === 'Enter' && searchVal.trim() && !isCSM) {
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
  }, [searchVal, onNavigate, isCSM]);

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

  const hasResults = searchRes && (searchRes.leads.length > 0 || searchRes.users.length > 0 || searchRes.accounts?.length > 0);

  return (
    <header className="nh-topbar">

      {/* ── Mobile nav toggle — hidden on desktop, see NavHub.css breakpoint ── */}
      <button
        type="button"
        className="nh-mobile-menu-btn"
        onClick={onToggleMobileNav}
        aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={mobileNavOpen}
      >
        <MenuIcon />
      </button>

      {/* ── Search ────────────────────────────────────────────────────────── */}
      <div className="nh-search" ref={wrapperRef}>
        <SearchInput
          ref={searchRef}
          id="nh-search-input"
          placeholder={isCSM ? 'Search accounts...' : 'Search leads, phone, SDRs...'}
          value={searchVal}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          aria-label="Search"
          autoComplete="off"
          className="w-full"
          inputClassName="pr-9"
        />
        {searching
          ? <Spinner size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2" />
          : <kbd className="nh-search__kbd">⌘K</kbd>
        }

        {/* Inline results dropdown */}
        {searchRes !== null && (
          <div className="nh-search__results" role="listbox" aria-label="Search results" aria-busy={searching}
               style={searching && hasResults ? { opacity: 0.6, transition: 'opacity 120ms' } : undefined}>
            {!hasResults && (
              <div className="nh-search__empty">{searching ? 'Searching…' : 'No results found.'}</div>
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
                    <div className="nh-search__result-sub">{l.company || ''}{l.email ? ` · ${l.email}` : ''}{(l.phone || l.phone_secondary || l.company_phone) ? ` · 📞 ${l.phone || l.phone_secondary || l.company_phone}` : ''}</div>
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
            {searchRes.accounts?.length > 0 && (
              <>
                <div className="nh-search__group-label">Accounts</div>
                {searchRes.accounts.map(a => (
                  <div
                    key={a.id}
                    className="nh-search__result"
                    role="option"
                    onClick={() => {
                      setSearchRes(null);
                      setSearchVal('');
                      // CSM's own flat Portfolio nav item, or Super Admin's
                      // merged Pipeline hub (opens straight on its CSM
                      // Portal tab) — 'csm-portal' itself no longer exists
                      // as a route (2026-09-16 nav restructuring).
                      window._loadView?.(isSuperAdmin ? 'pipeline-hub' : 'csm-portfolio', a.id);
                    }}
                  >
                    <div className="nh-search__result-name">{a.name}</div>
                    {a.industry && <div className="nh-search__result-sub">{a.industry}</div>}
                  </div>
                ))}
              </>
            )}
            {hasResults && !isCSM && (
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

      {/* ── Ask AI button + overlay panel (admins only) ─────────────────────── */}
      {isAdmin && (
        <Popover open={aiOpen} onOpenChange={setAiOpen}>
          <PopoverTrigger asChild>
            <button
              className={`nh-btn nh-btn--ai${aiOpen ? ' nh-btn--ai-active' : ''}`}
              title="Ask AI (⌘/)"
              aria-label="Ask AI"
              id="nh-ask-ai-btn"
            >
              <SparkleIcon />
              <span>Ask AI</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="nh-ai-overlay" align="center" sideOffset={8}>
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
                    ? <Spinner size={13} tone="light" />
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
          </PopoverContent>
        </Popover>
      )}

      {/* ── Right-side actions ────────────────────────────────────────────── */}
      <div className="nh-topbar__actions">

        <PageGuideButton />
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
          onClick={() => window.MessengerWidget?.openPanel?.()}
          title="Active call in progress — click to manage"
          aria-live="polite"
        >
          <span className="nh-live-dot" aria-hidden="true" />
          🔴 Live Call
        </button>

        {/* CSM works accounts, not leads — a CSM creating a "lead" has
            nowhere sensible for it to go in their own workflow. */}
        {!isCSM && (
          <button
            className="nh-btn nh-btn--primary"
            onClick={() => setCreateLeadOpen(true)}
            title="Create a new lead"
            aria-label="New Lead"
            id="nh-new-lead-btn"
          >
            <PlusIcon />
            <span>New Lead</span>
          </button>
        )}

      </div>

      <CreateLeadModal
        isOpen={createLeadOpen}
        onClose={() => setCreateLeadOpen(false)}
        onLeadCreated={(lead) => onAction?.('leadCreated', lead)}
      />
    </header>
  );
}
