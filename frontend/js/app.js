// ── app.js — Entry point: boot, router, global search, sync button ────────────
import { currentUser, isAdmin, isSuperAdmin, isPodAdmin, isSDR, authHeaders, API_BASE, dialerEnabled, isViewAsSession } from './auth.js';
import { fetchKanbanLeads, syncSalesforce, globalSearch, uploadSdrCsv, fetchDialerStatus, startDialerCall, getCallStatus, addLeadNote, getMyActiveCall, forceEndCall } from './api.js';
import { showLoader, showToast, fullName } from './utils.js';

// renderDashboard removed — replaced by DashboardHub React IIFE (v9.6.0)

import { renderLeads, renderLeadDetail, renderKanban, setNavLeadsFromRaw } from './views/leads.js';
import { renderAssignments } from './views/assignments.js';
import { renderDisqualifyRequests } from './views/disqualify_requests.js';
import { renderSettings }   from './views/settings.js';
import { renderAdmin }      from './views/admin.js';
import { renderPods }       from './views/pods.js';
import { renderLeaderboard } from './views/leaderboard.js';
import { initModals, openCallModal } from './views/modals.js';
import { showDialerWidget, showManualDialWidget, isWidgetActive } from './views/dialer_widget.js';
// Side-effect-only import: rcm_dialer.js's module body registers the
// TTL safety net, the beforeunload beacon, and window.RCMDialer —
// that global (not this binding) is what every call site below reads, so
// whichever engine currently owns it (this vanilla one, or the React port
// when the rcmWidgetReact flag is on) is the one that actually
// drives a call. A bound import here would freeze every call to this
// vanilla module regardless of the flag — see dialerEngine.js's own
// comment on why that's unsafe.
import './rcm_dialer.js?v=20260729a';

import { renderSfLogs, cleanupSfLogs } from './views/sf_logs.js';
import { renderSdrPerformance } from './views/sdr_performance.js';
import { getPhoneTimezone, renderPhoneLocalTime } from './phone_timezone.js'; // ENH-01

// Expose phone timezone utils for manual dial widget TZ preview
window._phoneTimezoneUtils = { getPhoneTimezone, renderPhoneLocalTime };
import { renderAuditLogs } from './views/audit_logs.js';
import { renderUpload } from './views/upload.js';
// metrics.js sunset — legacy 'metrics' route redirects to 'analytics' (line 352)
import { renderSdrSettings } from './views/sdr_settings.js';
import { fetchPendingTasks, snoozeTask, dismissTask } from './api.js';
import { renderActivityFeed } from './views/activity_feed.js';
import { renderAnalytics } from './views/analytics.js';
import { renderSmartAnalytics, runAiQuery, injectSmartAnalyticsStyles } from './views/smart_analytics.js';
import { renderDigest } from './views/digest.js';
import { renderCallMonitor } from './views/call_monitor.js';
import { renderPlayground } from './views/playground.js';
import { initErrorReporter, flushPendingErrors } from './error_reporter.js';
import { mp } from './mp.js';

// ── Init error reporter early — before any views load ────────────────────────
initErrorReporter({ getToken: () => localStorage.getItem('crm_token') });

// ── Mixpanel: identify user on load ──────────────────────────────────────────
if (currentUser?.sub) {
    mp.identify(currentUser.sub, {
        $name:  currentUser.name  || currentUser.email || '',
        $email: currentUser.email || '',
        role:   currentUser.role  || '',
        pod_id: currentUser.pod_id || null,
        view_as: isViewAsSession,
    });
}
// Expose for dialer_machine.js Mixpanel listener (reads role/pod_id without importing auth.js)
window.__CRM_CURRENT_USER__ = currentUser || null;

// ── State ─────────────────────────────────────────────────────────────────────
let currentView = 'dashboard';
let currentExtra = null;  // tracks lead ID when on lead-detail
let _dialerConfig = { active: false, provider: 'none', has_credentials: false, sender_id: '' }; // cached dialer config
let _rcmWidgetReady = false; // true only when RCMWidget.init() completed successfully
window._rcmWidgetReady = false; // expose for lead_detail.js template render

const vc = document.getElementById('view-container');

// ── View-As banner (impersonation mode) ───────────────────────────────────────
if (isViewAsSession) {
    const banner = document.createElement('div');
    banner.id = 'view-as-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,#f59e0b,#ef4444);color:#fff;padding:8px 20px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:0.85rem;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    banner.innerHTML = `
        <span>👁️ Viewing as <strong>${currentUser?.name || currentUser?.email || 'User'}</strong> (${currentUser?.role || 'Unknown'})</span>
        <button id="exit-view-as" style="background:#fff;color:#ef4444;border:none;padding:4px 14px;border-radius:6px;font-weight:700;font-size:0.8rem;cursor:pointer;">✕ Exit View-As</button>
    `;
    document.body.prepend(banner);
    document.body.style.paddingTop = '40px';
    mp.track('View-As Entered', {
        target_name: currentUser?.name || currentUser?.email || '',
        target_role: currentUser?.role || '',
    });
    document.getElementById('exit-view-as').addEventListener('click', () => {
        mp.track('View-As Exited');
        sessionStorage.removeItem('crm_view_as_token');
        window.close();  // Close the View-As tab
        // Fallback if window.close() is blocked by browser
        window.location.href = 'login.html';
    });
}

// ── NavHub mount (React Sidebar + Topbar) ───────────────────────────────────
// Polls for window.NavHub up to 5s (same pattern as DashboardHub).
// Called once after auth; sidebar/topbar are persistent chrome.
(function mountNavHub() {
    if (!currentUser) return;

    const logoutFn = async () => {
        mp.track('Logged Out', { role: currentUser?.role || '' });
        try { await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', headers: authHeaders() }); } catch {}
        localStorage.removeItem('crm_token');
        sessionStorage.clear();
        window.location.href = 'login.html';
    };

    const navProps = {
        token:       localStorage.getItem('crm_token'),
        userRole:    currentUser?.role || '',
        userName:    currentUser?.name || currentUser?.email || '',
        avatarUrl:   currentUser?.avatar_url || null,
        podId:       currentUser?.pod_id || null,
        apiBase:     API_BASE,
        activeView:  'dashboard',
        collapsed:   localStorage.getItem('sidebar_collapsed') === 'true',
        onNavigate:  (view) => loadView(view),
        onLogout:    logoutFn,
        onAction:    (action, data) => {
            // NOTE: The old vanilla topbar buttons (#new-lead-btn, #manual-dial-btn,
            // #ai-bar-trigger, #sync-btn) no longer exist in index.html — they were
            // removed when NavHub (React) replaced the topbar. onAction must call
            // functions directly instead of relying on .click() on ghost DOM nodes.
            if (action === 'syncSF') {
                // Call syncSalesforce directly and show toast feedback
                syncSalesforce()
                    .then(() => showToast('Salesforce sync started', 'success'))
                    .catch(() => showToast('Sync failed — check API connection', 'error'));
            }
            if (action === 'dial') {
                // showManualDialWidget() is imported from dialer_widget.js
                showManualDialWidget();
            }
            if (action === 'newLead') {
                // Open the new-lead-modal directly (the modal HTML is still in index.html)
                const modal = document.getElementById('new-lead-modal');
                if (modal) modal.style.display = 'flex';
            }
            if (action === 'askAI') {
                // window._expandAiBar is set up by the AI bar init block below
                window._expandAiBar?.();
            }
            if (action === 'feedback') {
                window.NavHub?.openFeedback?.();
            }
        },
    };

    function _doMount() {
        const sidebarEl = document.getElementById('nav-sidebar-root');
        const topbarEl  = document.getElementById('nav-topbar-root');
        if (sidebarEl && topbarEl && window.NavHub) {
            window.NavHub.mount(sidebarEl, topbarEl, navProps);
        }
    }

    if (window.NavHub) {
        _doMount();
    } else {
        // Poll up to 5s (50 × 100ms) — bundle loads in parallel via defer
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            if (window.NavHub) { clearInterval(poll); _doMount(); }
            if (attempts >= 50)  { clearInterval(poll); console.warn('[NavHub] bundle did not load in 5s'); }
        }, 100);
    }
})();


// ── Activity-based heartbeat (prevents inflated Time Spent) ───────────────────
{
    let _lastActivity = Date.now();
    const HEARTBEAT_INTERVAL = 5 * 60 * 1000;  // 5 minutes
    const IDLE_THRESHOLD = 5 * 60 * 1000;       // 5 min idle = stop heartbeats

    // Track user activity (lightweight — just timestamp updates)
    const _markActive = () => { _lastActivity = Date.now(); };
    document.addEventListener('click', _markActive, { passive: true });
    document.addEventListener('keypress', _markActive, { passive: true });
    document.addEventListener('scroll', _markActive, { passive: true });

    // Send heartbeat every 5 min, but only if user was recently active
    setInterval(() => {
        if (document.hidden) return;  // Tab not visible
        if (Date.now() - _lastActivity > IDLE_THRESHOLD) return;  // User idle
        const token = localStorage.getItem('crm_token');
        if (!token) return;
        fetch(`${API_BASE}/api/auth/heartbeat`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
        }).catch(() => {});  // Fire-and-forget
    }, HEARTBEAT_INTERVAL);
}

// ── Global error boundary ─────────────────────────────────────────────────────
// Catches unhandled Promise rejections (e.g. a failed view render) and shows
// a user-friendly toast instead of leaving the UI silently broken.
window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    // Ignore AbortError (intentional fetch cancellations)
    if (reason && reason.name === 'AbortError') return;
    // Ignore 401s — those are handled by handleUnauthorized
    if (reason && (String(reason.message).includes('401') || String(reason.message).includes('Unauthorized'))) return;

    console.error('[App] Unhandled rejection:', reason);
    try {
        showToast('Something went wrong. Please try refreshing the page.', 'error', 6000);
    } catch {}
});

window.addEventListener('error', (event) => {
    // Only surface script errors, not resource load errors (img, css, etc.)
    if (event.filename) {
        console.error('[App] Uncaught error:', event.error);
    }
});

// ── Role-based visibility ─────────────────────────────────────────────────────
if (isAdmin) {
    const adminNav       = document.getElementById('admin-nav-item');
    const podsNav        = document.getElementById('pods-nav-item');
    const settingsNav    = document.getElementById('settings-nav-item');
    if (adminNav) adminNav.style.display = 'block';
    if (settingsNav) settingsNav.style.display = 'block';
    if (podsNav && isSuperAdmin) podsNav.style.display = 'block';

    // Super Admin only: Sync, Bulk Import, Upload Leads, Audit Logs
    if (isSuperAdmin) {
        if (document.getElementById('sync-btn'))     document.getElementById('sync-btn').style.display = 'inline-flex';
        if (document.getElementById('upload-nav-item')) document.getElementById('upload-nav-item').style.display = 'block';
        if (document.getElementById('audit-logs-nav-item')) document.getElementById('audit-logs-nav-item').style.display = 'block';
    }

    // Daily Digest: Super Admin + Pod Admin — backend (require_admin) and the
    // React nav both already permit Pod Admin (pod-scoped); this legacy shell
    // was the one place still gating it to Super Admin only.
    if (isAdmin) {
        if (document.getElementById('digest-nav-item')) document.getElementById('digest-nav-item').style.display = 'block';
    }

    // Call Monitor: Super Admin + Pod Admin
    if (document.getElementById('call-monitor-nav-item')) {
        document.getElementById('call-monitor-nav-item').style.display = 'block';
    }

    if (document.getElementById('playground-nav-item')) {
        document.getElementById('playground-nav-item').style.display = 'block';
    }

    // Analytics Hub: Super Admin + Pod Admin — single nav item
    if (isAdmin) {
        if (document.getElementById('analytics-hub-nav-item')) document.getElementById('analytics-hub-nav-item').style.display = 'block';
        // Inject SA styles now so the topbar AI bar dropdown looks correct immediately
        injectSmartAnalyticsStyles();
        // Keep legacy items hidden — they redirect to analytics via routes
        if (document.getElementById('metrics-nav-item'))       document.getElementById('metrics-nav-item').style.display = 'none';
        if (document.getElementById('activity-feed-nav-item')) document.getElementById('activity-feed-nav-item').style.display = 'none';
        if (document.getElementById('analytics-nav-item'))     document.getElementById('analytics-nav-item').style.display = 'none';
        if (document.getElementById('smart-analytics-nav-item')) document.getElementById('smart-analytics-nav-item').style.display = 'none';

        // ── Global AI Query Bar ────────────────────────────────────────────────
        const aiBar     = document.getElementById('ai-query-bar');
        const aiInput   = document.getElementById('ai-query-input');
        const aiBtn     = document.getElementById('ai-query-btn');
        const aiResult  = document.getElementById('ai-query-result');

        if (aiBar && aiInput && aiBtn && aiResult) {
            aiBar.style.display = 'block'; // show the collapsed trigger pill

            const trigger  = document.getElementById('ai-bar-trigger');
            const expanded = document.getElementById('ai-bar-expanded');
            const closeBtn = document.getElementById('ai-bar-close');

            // ── Expand / collapse helpers ─────────────────────────────────
            const _expand = () => {
                if (trigger)  { trigger.style.display = 'none'; trigger.setAttribute('aria-expanded', 'true'); }
                if (expanded) { expanded.style.display = 'block'; expanded.setAttribute('aria-hidden', 'false'); }
                // Small delay so the DOM is visible before focusing
                requestAnimationFrame(() => { aiInput.focus(); aiInput.select(); });
            };

            // Expose globally so window._expandAiBar() works from NavHub onAction
            window._expandAiBar = _expand;

            const _collapse = () => {
                if (trigger)  { trigger.style.display = ''; trigger.setAttribute('aria-expanded', 'false'); }
                if (expanded) { expanded.style.display = 'none'; expanded.setAttribute('aria-hidden', 'true'); }
                aiResult.style.display = 'none';
            };

            // Trigger pill click → expand
            trigger?.addEventListener('click', _expand);

            // Close button → collapse
            closeBtn?.addEventListener('click', () => { aiInput.value = ''; _collapse(); });

            // ── Keyboard shortcut: ⌘/ expands the bar ─────────────────────
            document.addEventListener('keydown', e => {
                if ((e.metaKey || e.ctrlKey) && e.key === '/') {
                    e.preventDefault();
                    _expand();
                }
                // Escape collapses the expanded bar (regardless of where focus is)
                if (e.key === 'Escape') {
                    _collapse();
                    trigger?.focus();
                }
            });

            // ── Submit handler ────────────────────────────────────────────
            const _runAiBar = async () => {
                const q = aiInput.value.trim();
                if (!q || aiBtn.disabled) return;  // EC-02: guard double-submit on rapid Enter

                // Show inline dropdown for quick preview
                aiResult.style.display = 'block';
                aiBtn.disabled = true;
                aiBtn.textContent = '…';

                try {
                    await runAiQuery(q, aiResult);
                    // After result renders, show a "See full analytics →" link
                    const link = document.createElement('div');
                    link.style.cssText = 'padding:10px 0 2px;text-align:right;';
                    link.innerHTML = `<a href="#analytics" id="ai-bar-full-link"
                        style="font-size:0.78rem;color:var(--primary-color);text-decoration:none;font-weight:600;cursor:pointer;">
                        📊 Open full Analytics Hub →</a>`;
                    aiResult.appendChild(link);
                    document.getElementById('ai-bar-full-link')?.addEventListener('click', e => {
                        e.preventDefault();
                        sessionStorage.setItem('ls_ai_pending_query', q);
                        aiResult.style.display = 'none';
                        aiInput.value = '';
                        _collapse();
                        loadView('analytics');
                    });
                } catch {} finally {
                    aiBtn.disabled = false;
                    aiBtn.textContent = 'Run';
                }
            };

            aiBtn.addEventListener('click', _runAiBar);
            aiInput.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _runAiBar(); }
            });

            // Close result when clicking outside the entire AI bar
            document.addEventListener('click', e => {
                if (!aiBar.contains(e.target)) {
                    aiResult.style.display = 'none';
                    // Only auto-collapse if the click was truly outside (not on a result link)
                    if (!aiBar.contains(e.target)) _collapse();
                }
            });
        }
    }


    const leadsNavLink = document.querySelector('.sidebar-nav a[data-view="leads"]');
    if (leadsNavLink) leadsNavLink.innerHTML = '<span class=\"nav-icon\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/></svg></span><span class=\"nav-label\">Leads</span>';
}

// All roles: New Lead button (SDRs create leads for referrals mid-call)
if (document.getElementById('new-lead-btn')) document.getElementById('new-lead-btn').style.display = 'inline-flex';

// Show "My Settings" only for SDR and Pod Admin (Super Admin has full Settings)
if (!isSuperAdmin) {
    const mySettingsNav = document.getElementById('my-settings-nav-item');
    if (mySettingsNav) mySettingsNav.style.display = 'block';
}

// Show "Today's Calls" only for SDR (not relevant for Super Admin / Pod Admin)
if (isSDR) {
    const myCallsNav = document.getElementById('my-calls-nav-item');
    if (myCallsNav) myCallsNav.style.display = 'block';
}

// ── Router ────────────────────────────────────────────────────────────────────
let _skipHashUpdate = false;  // prevent recursive hashchange → loadView loop
let _analyticsLoading = false; // EC-15: guard against concurrent analytics mounts
let _calendarLoading = false;  // same double-mount guard, for CalendarHub
let _powerDialerLoading = false; // same double-mount guard, for PowerDialerHub

// Calendar-shaped placeholder for the window between vc.innerHTML being set and
// CalendarHub's bundle mounting (previously a bare div — showed as blank space,
// or the leftover generic Dashboard skeleton if this ran before it). Mirrors
// CalendarHub.jsx's own MonthGridSkeleton so there's no visual swap on mount.
function _calendarSkeleton() {
    const cell = `<div style="min-height:104px;border-radius:8px;background:#f1f5f9;animation:calSkPulse 1.4s ease-in-out infinite;"></div>`;
    return `
        <style>@keyframes calSkPulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }</style>
        <div style="padding:24px;max-width:1152px;margin:0 auto;">
            <div style="height:64px;border-radius:16px;background:#f1f5f9;margin-bottom:20px;animation:calSkPulse 1.4s ease-in-out infinite;"></div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;">
                ${Array(35).fill(cell).join('')}
            </div>
        </div>`;
}

async function loadView(viewName, extra, backView) {
    // R-3 fix: only unmount the Analytics Hub when LEAVING analytics for a
    // different view. Unconditional unmount() here was destroying the React
    // root on every loadView() call — including navigating back TO analytics —
    // forcing a full remount + all API calls on every visit.
    if (viewName !== 'analytics') {
        window.AnalyticsHub?.unmount();
    }
    if (viewName !== 'dashboard') {
        window.DashboardHub?.unmount();
    }
    if (viewName !== 'calendar') {
        window.CalendarHub?.unmount();
    }
    if (viewName !== 'leads') {
        window.LeadsHub?.unmount();
    }
    if (viewName !== 'user-guide') {
        window.HelpHub?.unmount();
    }
    if (viewName !== 'sales-journeys') {
        window.SalesJourneyHub?.unmount();
    }
    if (viewName !== 'my-calls') {
        window.PowerDialerHub?.unmount();
    }
    // ── RCM Widget: clear lead context when leaving a lead page ────────
    // This ensures the FAB opens in ad-hoc mode (no stale lead) on non-lead pages.
    // setLead(null, null, null) is a pure state write — safe to call any time.
    if (currentView === 'lead-detail' && viewName !== 'lead-detail') {
        if (window._rcmWidgetReady && typeof RCMWidget !== 'undefined') {
            RCMWidget.setLead(null, null, null);
        }
        window._currentLead = null;
        // Unmount the React Email Hub when navigating away from lead-detail so it
        // doesn't hold open polling intervals or stale references.
        window.EmailHub?.unmount();
    }

    // Re-clicking the view you're already on, while its React Hub is still
    // mounted (Dashboard/Analytics/Calendar/Leads/User Guide/Sales Journeys all
    // preserve their mount across same-view re-navigation — see the unmount
    // guards above), must skip showLoader(): it replaces #view-container's
    // entire innerHTML, destroying the Hub's mount point (e.g. #calendar-react-root)
    // out from under the "already mounted, navigate() in place" fast path each
    // branch below takes. Every hub's navigate() calls _root.render(...) against
    // its ORIGINAL root, ignoring the container argument passed in — so if that
    // original mount point was just destroyed by showLoader(), navigate() renders
    // into a detached, invisible DOM node with no error, leaving this generic
    // skeleton stuck on screen forever — originally reproduced on Calendar;
    // User Guide and Sales Journeys use the identical navigate() pattern and were
    // missing from this list (2026-08-05).
    const hubStillMounted = viewName === currentView && (
        (viewName === 'dashboard' && window.DashboardHub?.isMounted) ||
        (viewName === 'analytics' && window.AnalyticsHub?.isMounted) ||
        (viewName === 'calendar' && window.CalendarHub?.isMounted) ||
        (viewName === 'leads' && window.LeadsHub?.isMounted) ||
        (viewName === 'user-guide' && window.HelpHub?.isMounted) ||
        (viewName === 'sales-journeys' && window.SalesJourneyHub?.isMounted) ||
        (viewName === 'my-calls' && window.PowerDialerHub?.isMounted)
    );

    currentView = viewName;
    currentExtra = extra || null;
    if (!hubStillMounted) showLoader(vc);

    // ── Mixpanel: Page Viewed ─────────────────────────────────────────────
    mp.track('Page Viewed', { view: viewName, role: currentUser?.role || '' });

    // Leads view state is preserved across tab switches.
    // sessionStorage clears naturally on browser tab close.
    // Users can use "Clear Filters" button to reset manually.

    // Persist current view in URL hash so refresh restores it
    // EC-15b: set _skipHashUpdate BEFORE mutating location.hash so the hashchange
    // listener does not re-enter loadView for the same view we are already loading.
    if (!_skipHashUpdate) {
        const hash = extra ? `${viewName}/${extra}` : viewName;
        if (location.hash !== `#${hash}`) {
            _skipHashUpdate = true;
            location.hash = hash;
            // Reset after a tick — the hashchange event is synchronous so by the time
            // JS resumes here, the listener has already run and been guarded.
            setTimeout(() => { _skipHashUpdate = false; }, 0);
        }
    }

    // Sync active nav item in NavHub React sidebar
    window.NavHub?.update({ activeView: viewName });

    if (viewName === 'dashboard') {
        // ── DashboardHub IIFE (React) ────────────────────────────────────────
        // Mirrors the Analytics Hub mount pattern exactly.
        const dashProps = {
            token:      localStorage.getItem('crm_token'),
            userRole:   currentUser?.role,
            podId:      currentUser?.pod_id,
            userName:   currentUser?.name || currentUser?.email || '',
            apiBase:    API_BASE,
            onLeadClick:  (id) => loadView('lead-detail', id),
            onNavigate:   (view) => loadView(view),
        };

        // If already mounted, re-render in-place (no teardown, no extra API calls)
        if (window.DashboardHub?.isMounted && typeof window.DashboardHub.navigate === 'function') {
            window.DashboardHub.navigate(
                document.getElementById('dashboard-react-root'),
                dashProps
            );
            return;
        }

        // Fresh mount — index.html skeleton is already visible inside #dashboard-skeleton.
        // Do NOT replace #view-container here — that destroys the pre-reserved height and
        // causes a CLS shift. Simply ensure #dashboard-react-root exists as the mount point.
        // (style.css reserves min-height:985px on #dashboard-react-root from HTML parse time)
        if (!document.getElementById('dashboard-react-root')) {
            vc.innerHTML = '<div id="dashboard-react-root"></div>';
        }

        // Poll until bundle is ready (handles slow connections, up to 5s).
        // 50ms interval = faster detection when bundle is preloaded from cache.
        let waited = 0;
        while (!window.DashboardHub && waited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            waited += 50;
        }
        if (!window.DashboardHub) {
            document.getElementById('dashboard-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Dashboard. Please refresh.</div>';
            return;
        }

        window.DashboardHub.mount(
            document.getElementById('dashboard-react-root'),
            dashProps
        );
    } else if (viewName === 'leads') {
        if (localStorage.getItem('leadsBeta') !== 'false') {
            // ── LeadsHub IIFE (React) — redesigned All Leads (now the default;
            // 'leadsBeta' persists as an explicit opt-out, set to 'false' only
            // when an SDR clicks "Switch to classic view") ───────────────────
            // Mirrors the Dashboard Hub mount pattern exactly.
            const leadsProps = {
                token:    localStorage.getItem('crm_token'),
                userRole: currentUser?.role,
                apiBase:  API_BASE,
                onSwitchToClassic: () => { localStorage.setItem('leadsBeta', 'false'); loadView('leads'); },
                // R-4 fix: lead_detail.js's Prev/Next nav bar reads a module-level
                // array in lead_list.js that only the classic renderLeads() populated —
                // opening a lead from here left it stale/empty and the nav bar silently
                // didn't render. LeadsHub passes its currently-loaded rows through.
                onOpenLead: (lead, currentLeads) => {
                    if (currentLeads) setNavLeadsFromRaw(currentLeads);
                    loadView('lead-detail', lead.id);
                },
            };

            if (window.LeadsHub?.isMounted && typeof window.LeadsHub.navigate === 'function') {
                window.LeadsHub.navigate(document.getElementById('leads-react-root'), leadsProps);
                return;
            }

            if (!document.getElementById('leads-react-root')) {
                vc.innerHTML = '<div id="leads-react-root"></div>';
            }

            let waited = 0;
            while (!window.LeadsHub && waited < 5000) {
                await new Promise(r => setTimeout(r, 50));
                waited += 50;
            }
            if (!window.LeadsHub) {
                document.getElementById('leads-react-root').innerHTML =
                  '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Leads. Please refresh.</div>';
                return;
            }

            window.LeadsHub.mount(document.getElementById('leads-react-root'), leadsProps);
        } else {
            await renderLeads(vc, null, handleCallAction, (id) => loadView('lead-detail', id));
        }
    } else if (viewName === 'lead-detail') {
        await renderLeadDetail(vc, extra, handleCallAction, loadView, backView || 'leads');
    } else if (viewName === 'kanban') {
        const kanbanLeads = await fetchKanbanLeads().catch(() => []);
        renderKanban(vc, kanbanLeads, loadView, handleCallAction);
    } else if (viewName === 'settings') {
        await renderSettings(vc);
    } else if (viewName === 'my-settings') {
        await renderSdrSettings(vc);
    } else if (viewName === 'assignments') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderAssignments(vc);
    } else if (viewName === 'disqualify-requests') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderDisqualifyRequests(vc);
    } else if (viewName === 'admin') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderAdmin(vc, () => renderAssignments(vc));
    } else if (viewName === 'pods') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderPods(vc);
    } else if (viewName === 'leaderboard') {
        await renderLeaderboard(vc);
    } else if (viewName === 'sf-logs') {
        // Redirect legacy sf-logs route to unified audit-logs view
        loadView('audit-logs').catch(() => {});
        return;
    } else if (viewName === 'sdr-performance') {
        await renderSdrPerformance(vc, extra, loadView);
    } else if (viewName === 'user-guide') {
        // ── HelpHub IIFE (React) ──────────────────────────────────────────
        // Mirrors the Dashboard Hub mount pattern exactly (full cutover, no
        // beta flag — same as Dashboard's own migration).
        const helpProps = {
            userRole: currentUser?.role,
            apiBase:  API_BASE,
        };

        if (window.HelpHub?.isMounted && typeof window.HelpHub.navigate === 'function') {
            window.HelpHub.navigate(document.getElementById('help-react-root'), helpProps);
            return;
        }

        vc.innerHTML = '<div id="help-react-root"></div>';

        let waited = 0;
        while (!window.HelpHub && waited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            waited += 50;
        }
        if (!window.HelpHub) {
            document.getElementById('help-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Help Guide. Please refresh.</div>';
            return;
        }

        window.HelpHub.mount(document.getElementById('help-react-root'), helpProps);
    } else if (viewName === 'sales-journeys') {
        // ── Sales Journey Hub IIFE (React) ─────────────────────────────────
        // Mirrors the Help Hub mount pattern exactly.
        const journeyProps = {
            userRole: currentUser?.role,
            apiBase:  API_BASE,
        };

        if (window.SalesJourneyHub?.isMounted && typeof window.SalesJourneyHub.navigate === 'function') {
            window.SalesJourneyHub.navigate(document.getElementById('sales-journey-react-root'), journeyProps);
            return;
        }

        vc.innerHTML = '<div id="sales-journey-react-root"></div>';

        let sjWaited = 0;
        while (!window.SalesJourneyHub && sjWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            sjWaited += 50;
        }
        if (!window.SalesJourneyHub) {
            document.getElementById('sales-journey-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Sales Cadences. Please refresh.</div>';
            return;
        }

        window.SalesJourneyHub.mount(document.getElementById('sales-journey-react-root'), journeyProps);
    } else if (viewName === 'upload') {
        if (!isSuperAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderUpload(vc);
    } else if (viewName === 'audit-logs') {
        if (!isSuperAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderAuditLogs(vc);
    } else if (viewName === 'metrics' || viewName === 'activity-feed') {
        // Legacy redirects → unified Analytics Hub
        loadView('analytics').catch(() => {});
        return;
    } else if (viewName === 'smart-analytics') {
        // EC-10: kept as a routable view (sidebar item hidden, accessible via "Full AI Workspace" link)
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderSmartAnalytics(vc);
    } else if (viewName === 'analytics') {
        // AE gets Analytics Hub too, forced to their own leads/calls only —
        // see backend analytics_routes._effective_ae_sdr and
        // DashboardTab.jsx's isAE (pod picker hidden, no pod-wide access).
        if (!isAdmin && currentUser?.role !== 'AE') { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }

        // EC-15: prevent double-mount when loadView('analytics') is called a second
        // time while the first call is still in the bundle-poll loop (up to 3 s).
        if (_analyticsLoading) {
            console.warn('[AnalyticsHub] Load already in progress — skipping duplicate call');
            return;
        }

        // R-3 fix: if the hub is already mounted and the bundle exposes navigate(),
        // update props in place — no teardown, no remount, no API calls.
        const props = {
            token:    localStorage.getItem('crm_token'),
            userRole: currentUser?.role,
            pendingQuery: sessionStorage.getItem('ls_ai_pending_query') || '',
            apiBase:  API_BASE,
        };
        sessionStorage.removeItem('ls_ai_pending_query');

        if (window.AnalyticsHub?.isMounted && typeof window.AnalyticsHub.navigate === 'function') {
            // Hub is alive — just update props, React reconciles without refetching
            window.AnalyticsHub.navigate(
                document.getElementById('analytics-react-root'),
                props
            );
            return;
        }

        _analyticsLoading = true;

        try {
            // EC-14: light skeleton shown immediately so there's no white flash
            vc.innerHTML = `
              <div id="analytics-react-root" style="min-height:600px;">
                <div style="display:flex;flex-direction:column;gap:20px;padding:32px 24px;">
                  <div style="height:36px;width:280px;background:#f1f5f9;border-radius:8px;animation:ah-pulse 1.4s ease-in-out infinite;"></div>
                  <div style="display:flex;gap:16px;">
                    <div style="flex:1;height:120px;background:#f1f5f9;border-radius:12px;animation:ah-pulse 1.4s ease-in-out infinite;"></div>
                    <div style="flex:1;height:120px;background:#f1f5f9;border-radius:12px;animation:ah-pulse 1.4s ease-in-out 0.15s infinite;"></div>
                    <div style="flex:1;height:120px;background:#f1f5f9;border-radius:12px;animation:ah-pulse 1.4s ease-in-out 0.3s infinite;"></div>
                  </div>
                  <div style="height:360px;background:#f1f5f9;border-radius:12px;animation:ah-pulse 1.4s ease-in-out 0.1s infinite;"></div>
                </div>
                <style>
                  @keyframes ah-pulse {
                    0%,100%{opacity:1} 50%{opacity:0.45}
                  }
                </style>
              </div>`;

            // EC-03: poll until bundle is ready (handles slow connections, up to 3s)
            let waited = 0;
            while (!window.AnalyticsHub && waited < 3000) {
                await new Promise(r => setTimeout(r, 100));
                waited += 100;
            }
            if (!window.AnalyticsHub) {
                document.getElementById('analytics-react-root').innerHTML =
                  '<div style="padding:60px;text-align:center;color:#ef4444;">⚠️ Failed to load Analytics Hub. Please refresh the page.</div>';
                return;
            }

            window.AnalyticsHub.mount(
                document.getElementById('analytics-react-root'),
                props
            );
        } finally {
            _analyticsLoading = false;
        }
    } else if (viewName === 'calendar') {
        // Unified calendar — every role can see it (own leads for SDR/AE, own
        // pod for Pod Admin, everything for Super Admin). Mirrors the
        // AnalyticsHub mount/navigate pattern above.
        if (_calendarLoading) return;

        const props = {
            token:      localStorage.getItem('crm_token'),
            userRole:   currentUser?.role,
            apiBase:    API_BASE,
            onLeadClick: (id) => loadView('lead-detail', id),
        };

        if (window.CalendarHub?.isMounted && typeof window.CalendarHub.navigate === 'function') {
            window.CalendarHub.navigate(document.getElementById('calendar-react-root'), props);
            return;
        }

        _calendarLoading = true;
        try {
            vc.innerHTML = `<div id="calendar-react-root">${_calendarSkeleton()}</div>`;

            // Poll until bundle is ready (handles slow connections, up to 5s) —
            // matches the Dashboard Hub's wait/interval above for consistency.
            let waited = 0;
            while (!window.CalendarHub && waited < 5000) {
                await new Promise(r => setTimeout(r, 50));
                waited += 50;
            }
            if (!window.CalendarHub) {
                document.getElementById('calendar-react-root').innerHTML = `
                  <div style="padding:60px;text-align:center;color:#ef4444;">
                    <div>⚠️ Failed to load Calendar.</div>
                    <button id="calendar-retry-btn" style="margin-top:14px;font-size:0.85rem;font-weight:600;color:#4338ca;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:6px 16px;cursor:pointer;">Retry</button>
                  </div>`;
                document.getElementById('calendar-retry-btn')?.addEventListener('click', () => loadView('calendar'));
                return;
            }
            window.CalendarHub.mount(document.getElementById('calendar-react-root'), props);
        } finally {
            _calendarLoading = false;
        }
    } else if (viewName === 'my-calls') {
        // Power Dialer — replaces the old classic "Today's Calls" log view.
        // Mirrors the CalendarHub mount/navigate pattern above.
        if (_powerDialerLoading) return;

        const props = {
            token:      localStorage.getItem('crm_token'),
            userRole:   currentUser?.role,
            apiBase:    API_BASE,
            onLeadClick: (id) => loadView('lead-detail', id, 'my-calls'),
        };

        if (window.PowerDialerHub?.isMounted && typeof window.PowerDialerHub.navigate === 'function') {
            window.PowerDialerHub.navigate(document.getElementById('power-dialer-react-root'), props);
            return;
        }

        _powerDialerLoading = true;
        try {
            vc.innerHTML = `<div id="power-dialer-react-root"></div>`;

            let waited = 0;
            while (!window.PowerDialerHub && waited < 5000) {
                await new Promise(r => setTimeout(r, 50));
                waited += 50;
            }
            if (!window.PowerDialerHub) {
                document.getElementById('power-dialer-react-root').innerHTML = `
                  <div style="padding:60px;text-align:center;color:#ef4444;">
                    <div>⚠️ Failed to load Power Dialer.</div>
                    <button id="power-dialer-retry-btn" style="margin-top:14px;font-size:0.85rem;font-weight:600;color:#4338ca;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:6px 16px;cursor:pointer;">Retry</button>
                  </div>`;
                document.getElementById('power-dialer-retry-btn')?.addEventListener('click', () => loadView('my-calls'));
                return;
            }
            window.PowerDialerHub.mount(document.getElementById('power-dialer-react-root'), props);
        } finally {
            _powerDialerLoading = false;
        }
    } else if (viewName === 'digest') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderDigest(vc);
    } else if (viewName === 'call-monitor') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderCallMonitor(vc);
    } else if (viewName === 'playground') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderPlayground(vc);
    } else {
        vc.innerHTML = `<h2>View not found</h2>`;
    }
}

// ── Nav links ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.sidebar-nav a[data-view]').forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        loadView(e.currentTarget.getAttribute('data-view'));
    });
});

// ── Sidebar Collapse/Expand ───────────────────────────────────────────────────
// Handled inside NavSidebar.jsx (React). localStorage('sidebar_collapsed')
// is still the source of truth — NavSidebar reads and writes it directly.

// Feedback modal is handled entirely by the React NavHub bundle
// (window.NavHub.openFeedback(), see nav-entry.jsx / layout/FeedbackModal.jsx).

// ── Sync Button ───────────────────────────────────────────────────────────────
const syncBtn = document.getElementById('sync-btn');
if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
        const orig = syncBtn.innerHTML;
        syncBtn.innerHTML = '<span class="icon">⏳</span> Syncing...'; syncBtn.disabled = true;
        try {
            const res = await syncSalesforce();
            if (res.ok) {
                const data = await res.json();
                const pulled = data.leads_synced || 0;
                const pushed = data.leads_pushed_to_sf || 0;
                const parts = [];
                if (pulled) parts.push(`${pulled} pulled`);
                if (pushed) parts.push(`${pushed} pushed`);
                const summary = parts.length ? parts.join(', ') : 'No changes';
                syncBtn.innerHTML = `<span class="icon">✅</span> Synced (${summary})`;
                await loadView(currentView, currentExtra);
            } else {
                const err = await res.json().catch(() => ({}));
                syncBtn.innerHTML = '<span class="icon">❌</span> Sync Failed';
                showToast(`Sync failed: ${err.detail || 'Unknown error'}`);
            }
        } catch (e) { syncBtn.innerHTML = '<span class="icon">❌</span> API Error'; console.error(e); }
        setTimeout(() => { syncBtn.innerHTML = orig; syncBtn.disabled = false; }, 5000);
    });
}

// ── Upload Leads: now handled by views/upload.js ─────────────────────────────

// ── Global Search ─────────────────────────────────────────────────────────────
// The old vanilla #global-search input was removed when NavHub (React) replaced
// the topbar. Search is now driven by NavTopbar.jsx via the onSearch callback,
// which calls window._runGlobalSearch(query).
// We still render #search-results in index.html as the dropdown container.
const searchResults  = document.getElementById('search-results');
let searchTimeout;

// Expose globalSearch for NavTopbar's inline React dropdown
window._globalSearchFn = globalSearch;

// Expose runAiQuery for NavTopbar's React Ask AI overlay panel
window._runAiQuery = runAiQuery;

// Expose task-notification API for NavTopbar's React NotificationBell.
// RCA-2026-07-13: the vanilla bell (task_notifications.js) injected into
// `.topbar-actions`, which NavHub (React) removed on 2026-06-18 — the bell
// silently stopped appearing for every SDR/AE from that point on.
window._fetchPendingTasks = fetchPendingTasks;
window._snoozeTask = snoozeTask;
window._dismissTask = dismissTask;

/**
 * _runGlobalSearch — called by NavTopbar onSearch prop with the typed query.
 * Renders matching leads/users in #search-results dropdown.
 * Also used by the '/' keyboard shortcut below.
 */
window._runGlobalSearch = async (q) => {
    if (!searchResults) return;
    if (!q || q.length < 2) { searchResults.style.display = 'none'; return; }
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            const data = await globalSearch(q);
            let html = '';
            if (data.leads?.length > 0) {
                html += `<div style="padding:8px 12px;font-weight:600;font-size:0.75rem;text-transform:uppercase;color:var(--text-muted);background:#f8fafc;">Leads</div>`;
                data.leads.forEach(l => {
                    html += `<div style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;transition:background 0.15s;" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''" onclick="document.getElementById('search-results').style.display='none';window._loadView('lead-detail','${l.id}')">
                        <div style="font-weight:600;font-size:0.9rem;">${fullName(l)}</div>
                        <div style="font-size:0.8rem;color:var(--text-muted);">${l.company || ''} &middot; ${l.email || ''}${l.phone ? ' · 📞 ' + l.phone : ''}</div>
                    </div>`;
                });
            }
            if (data.users?.length > 0) {
                html += `<div style="padding:8px 12px;font-weight:600;font-size:0.75rem;text-transform:uppercase;color:var(--text-muted);background:#f8fafc;">Users/SDRs</div>`;
                data.users.forEach(u => {
                    html += `<div style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">
                        <div style="font-weight:600;font-size:0.9rem;">${u.name || ''} <span class="badge" style="float:right;">${u.role}</span></div>
                        <div style="font-size:0.8rem;color:var(--text-muted);">${u.email || ''}</div>
                    </div>`;
                });
            }
            if (!html) html = `<div style="padding:12px;color:var(--text-muted);font-size:0.85rem;text-align:center;">No results found.</div>`;
            searchResults.innerHTML = html;
            searchResults.style.display = 'block';
        } catch (err) { console.error('Search error', err); }
    }, 300);
};

// Close dropdown on outside click
if (searchResults) {
    document.addEventListener('click', e => {
        if (!searchResults.contains(e.target)) searchResults.style.display = 'none';
    });
}

// ── Keyboard shortcuts for search ─────────────────────────────────────────────
// ⌘K is handled inside NavTopbar.jsx — NavHub.focusSearch() is the bridge.
// The '/' shortcut below also delegates to the React search input.
document.addEventListener('keydown', e => {
    // '/' focuses search (GitHub-style), only when not typing in a form field
    if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        window.NavHub?.focusSearch?.();
    }
    // Escape — close results dropdown
    if (e.key === 'Escape' && searchResults) {
        searchResults.style.display = 'none';
    }
});

// ── CSV SDR Upload (Admin) ────────────────────────────────────────────────────
document.addEventListener('change', async e => {
    if (e.target.id === 'sdr-csv-input') {
        const file = e.target.files[0];
        if (!file) return;
        showLoader(vc);
        const text = await file.text();
        try {
            const res  = await uploadSdrCsv(text);
            const data = await res.json();
            if (res.ok) { showToast('Success: ' + data.message, 'success'); if (currentView === 'admin') loadView('admin'); }
            else showToast('Error: ' + data.detail);
        } catch (err) { console.error(err); showToast('Upload failed.'); }
        finally { e.target.value = ''; }
    }
});

// ── Globals (used by kanban inline onclick, search results) ───────────────────
window._openCallModal = handleCallAction;
window._loadView      = (view, extra) => loadView(view, extra);
window._navigateToDetail = (id, backView) => loadView('lead-detail', id, backView || null);

/** Race a promise against a timeout so a hung UI (e.g. a widget panel that
 * never mounts) can never block forever on a resolve that's never coming. */
function _withTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message || 'Timed out')), ms)),
    ]);
}

// ── Dialer-aware call handler ─────────────────────────────────────────────────
/**
 * Flow for dialer-enabled SDRs:
 *   1. Confirm → Aircall places the call
 *   2. Outcome modal opens → SDR selects result (Meeting Confirmed, Not Interested, etc.)
 *   3. Backend creates CallLog → status transitions fire
 *
 * Flow for non-dialer SDRs:
 *   1. Outcome modal opens directly (manual logging)
 *
 * Note: isDialerActive is derived entirely from _dialerConfig (live DB via /api/dialer/status).
 * We intentionally do NOT gate on the JWT dialerEnabled claim here because that claim is
 * baked at login time and goes stale when admins toggle the flag.  The backend's
 * get_provider_for_user() performs the authoritative dialer_enabled check on every request.
 */
async function handleCallAction(leadId, leadName, phone, lead = {}) {
    // Ensure dialer config is loaded before deciding flow
    if (_dialerConfigPromise) {
        try { await _dialerConfigPromise; } catch {}
    }
    // Rely on live _dialerConfig.active (backend checks DB dialer_enabled on every /api/dialer/status call)
    // — not the stale JWT dialerEnabled flag baked at login time.
    const isDialerActive = _dialerConfig.active && _dialerConfig.provider !== 'none' && _dialerConfig.has_credentials;

    // Prevent duplicate calls while any dialer is active.
    // IMPORTANT: isWidgetActive() checks window.DialerMachine which is the AIRCALL-only
    // XState machine. For RCM SDRs, DialerMachine may be stuck in AWAITING_MODE
    // or INITIATING from a previous failed attempt — this causes isWidgetActive()=true
    // and silently blocks every call attempt (no _callInFlight set, no backend call).
    // FIX: gate each provider on its own state machine only.
    const _provider = (_dialerConfig.provider || '').toLowerCase();
    const _isRCMActive = window.RCMDialer?.isActive?.() ?? false;
    // For Aircall: check DialerMachine. For RCM: ignore DialerMachine entirely.
    const _isAircallActive = _provider !== 'rcm' && isWidgetActive();

    // Auto-heal: if DialerMachine is stuck in non-IDLE state for a RCM SDR,
    // reset it so it never blocks future Aircall calls either (if provider switches).
    if (_provider === 'rcm' && isWidgetActive()) {
        console.warn('[handleCallAction] DialerMachine stuck in non-IDLE for RCM SDR — auto-resetting');
        if (window.DialerMachine) window.DialerMachine.send('RESET');
    }

    if (_isAircallActive || _isRCMActive) {
        showToast('📞 A call is already in progress. End the current call first.', 'warning', 4000);
        return;
    }


    // Prevent rapid retries: block a second call attempt while the first API request
    // is still in-flight. Without this, a failed Aircall call can be retried 4+ times
    // in quick succession (as seen in prod), generating repeated FAILED entries.
    if (window._callInFlight) {
        showToast('📞 Please wait — connecting call...', 'info', 2000);
        return;
    }
    window._callInFlight = true;

    if (isDialerActive && phone) {
        const provider = (_dialerConfig.provider || '').toLowerCase();

        // ── RCM: open the RCMWidget Call tab for mode selection ────
        // The widget renders "Phone Bridge / Browser Call" buttons inside its own
        // Call tab pane, returning the chosen mode via a Promise.
        // Aircall routes directly to startDialerCall() — no mode selection needed.
        // (V48: Aircall Everywhere doesn't need a branch here either — an SDR logged
        // into the embedded workspace instead of the Desktop app is just another
        // device Aircall's existing click-to-dial REST call already rings. See
        // useAircallEverywhere.js's docblock.)
        let callMode = 'bridge'; // default for Aircall
        if (provider === 'rcm') {
            // RCA 2026-07-22: this promise only resolves when the SDR clicks a mode
            // button inside the widget panel. If the panel fails to mount/render for
            // any reason, the promise hangs forever with no error — _callInFlight
            // stayed stuck `true` permanently, silently blocking every future call
            // attempt until a hard refresh. Guarded with a try/catch (was previously
            // outside any try/catch entirely) and a timeout so this can never brick
            // the call button again, regardless of the underlying widget glitch.
            try {
                const modeSelection = (!_rcmWidgetReady || typeof RCMWidget === 'undefined')
                    // Widget not initialised (no credentials / wrong provider) — fall back
                    ? _showCallModeSelector(leadName, phone)
                    : RCMWidget.openForCall({ leadId, leadName, phone });
                callMode = await _withTimeout(modeSelection, 45000, 'Dialer did not respond');
            } catch (err) {
                window._callInFlight = false;
                showToast('❌ Could not open the dialer. Please try again.', 'warning', 5000);
                console.error('[handleCallAction] Mode selection failed:', err);
                return;
            }
            if (!callMode) {
                // User cancelled mode selection — release the in-flight lock
                window._callInFlight = false;
                return;
            }
        }

        const providerLabel = _dialerConfig.provider.charAt(0).toUpperCase() + _dialerConfig.provider.slice(1);
        showToast(`📞 Initiating call via ${providerLabel}...`, 'info', 3000);

        // For RCM: set INITIATING state before the API call so _syncCallPane()
        // in rcm_widget.js doesn't reset the "Connecting..." spinner to idle
        // during the async gap between mode selection and activate().
        if (provider === 'rcm') {
            window.RCMDialer.setInitiating();
        }

        try {
            const result = await startDialerCall(leadId, phone, callMode);


            // Activate RCMDialer for RCM calls — replaces showDialerWidget()
            if (result.provider === 'rcm') {
                // RCMDialer owns state, fires rcm:call-started (renders panel)
                // and rcm:call-ended (opens outcome modal). No machine dependency.
                await window.RCMDialer.activate(result, leadName, phone, callMode);
                window._callInFlight = false;
                return;
            } else {
                // Aircall: initiate in the Aircall phone app.
                // If Aircall returned a provider_call_id, poll for termination and auto-open modal.
                // If provider_call_id is missing (call not registered in Aircall app yet, or
                // staging/test environment), open the outcome modal immediately so the SDR
                // can still log the result without being stuck waiting forever.
                const callId = result.call_id;  // our DB UUID — always present
                const hasProviderCallId = result.provider_call_id && result.provider_call_id.trim() !== '';

                if (hasProviderCallId && callId && window._startAircallOutcomePolling) {
                    window._startAircallOutcomePolling(callId, leadId, leadName, phone);
                    showToast(`✅ Aircall initiated. The outcome form will open automatically when the call ends.`, 'success', 5000);
                    window._callInFlight = false;
                    return;
                } else {
                    // No provider_call_id — can't poll. Show banner and open modal immediately.
                    _setPendingOutcome({ leadId, leadName, phone, callId });
                    _showStickyBanner({ leadId, leadName, phone });
                    showToast(`📞 Aircall initiated. Please log the outcome below.`, 'info', 4000);
                    openCallModal(leadId, leadName, phone, lead, callId, _dialerConfig.provider || null);
                    window._callInFlight = false;
                    return;
                }
            }
        } catch (err) {
            // Dialer call failed (e.g. Aircall 405 — user offline/unavailable, or
            // RCM API error). Show the error toast but do NOT open the outcome
            // modal — the call never connected, so there is nothing to log.
            window._callInFlight = false;

            // For RCM: reset the dialer state machine (INITIATING → IDLE)
            // so the next call attempt is not blocked by a stale INITIATING state.
            if ((_dialerConfig.provider || '').toLowerCase() === 'rcm') {
                try { window.RCMDialer?.destroy?.(); } catch { /* ignore */ }
                // Revert widget from "Connecting..." back to lead idle view.
                if (typeof RCMWidget !== 'undefined') {
                    RCMWidget.notifyCallFailed(err.message);
                }
            }

            // Ghost call auto-heal: if the error is "active call in progress",
            // hit GET /api/calls/my-active which applies EC-16 staleness thresholds
            // and auto-heals stale CALL_STARTED records (e.g. missed RCM webhook).
            // If EC-16 already healed the ghost call → prompt retry.
            // If the call is still live (CALL_ANSWERED zombie from a lost disconnect 502) →
            // show an actionable "Force Clear" banner so the SDR doesn't have to wait.
            if (err.message && err.message.toLowerCase().includes('active call')) {
                try {
                    const activeData = await getMyActiveCall();
                    if (!activeData?.active) {
                        // EC-16 already healed the ghost — SDR can retry immediately
                        showToast('✅ Cleared a stuck call. Please try calling again.', 'success', 5000);
                        window._callInFlight = false;
                        return;
                    }
                    // Call is still live in DB (zombie CALL_ANSWERED from lost disconnect webhook).
                    // Show a dismissable force-clear banner with a one-click resolution.
                    _showForceClearBanner(activeData);
                    window._callInFlight = false;
                    return;
                } catch (_healErr) { /* ignore — show original error below */ }
            }

            showToast(`❌ ${err.message}`, 'warning', 6000);
            return;
        }

    }
    window._callInFlight = false;

    // Non-dialer (manual SDR) or dialer error fallback: open outcome modal immediately
    openCallModal(leadId, leadName, phone, lead, null, null);
}

/**
 * RCA 2026-06-16: Show a dismissable "Force Clear" banner when the SDR's new call
 * is blocked by a zombie CALL_ANSWERED record that EC-16 hasn't healed yet.
 * This happens when RCMDialer.hangup() got a 502 from /calls/disconnect,
 * silently caught it, and reset the local state to IDLE — leaving the DB stuck.
 * The SDR now has a one-click escape instead of waiting 15 minutes (new EC-16 threshold).
 */
function _showForceClearBanner(activeCallData) {
    const _FORCE_CLEAR_ID = 'force-clear-call-banner';
    document.getElementById(_FORCE_CLEAR_ID)?.remove();

    const banner = document.createElement('div');
    banner.id = _FORCE_CLEAR_ID;
    banner.innerHTML = `
        <div style="
            position:fixed;top:0;left:0;right:0;z-index:10000;
            background:linear-gradient(135deg,#7c3aed,#4f46e5);
            color:#fff;padding:11px 20px;
            display:flex;align-items:center;justify-content:space-between;
            font-size:0.84rem;font-weight:600;box-shadow:0 4px 20px rgba(124,58,237,0.4);
            animation:slideDown 0.3s ease;gap:12px;
        ">
            <span>⚠️ A previous call is still active in the system. If your last call already ended, click <strong>Force Clear</strong> to unblock your dialer.</span>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                <button id="force-clear-btn" style="
                    padding:6px 16px;border-radius:8px;border:none;
                    background:rgba(255,255,255,0.2);color:#fff;
                    cursor:pointer;font-size:0.82rem;font-weight:700;
                    white-space:nowrap;
                ">Force Clear</button>
                <button id="force-clear-dismiss" style="
                    padding:6px 10px;border-radius:8px;border:none;
                    background:transparent;color:rgba(255,255,255,0.6);
                    cursor:pointer;font-size:0.82rem;
                ">Dismiss</button>
            </div>
        </div>
    `;
    document.body.prepend(banner);

    // Dismiss
    document.getElementById('force-clear-dismiss')?.addEventListener('click', () => {
        banner.remove();
    });

    // Force clear
    document.getElementById('force-clear-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('force-clear-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Clearing…'; }
        try {
            if (activeCallData?.call_id) {
                await forceEndCall(activeCallData.call_id);
            }
            // Also reset local RCMDialer state in case it's in a partial state
            try { window.RCMDialer?.destroy?.(); } catch { /* ignore */ }
            banner.remove();
            showToast('✅ Cleared. You can now make a new call.', 'success', 5000);
        } catch (err) {
            showToast(`❌ Force clear failed: ${err.message}`, 'warning', 5000);
            if (btn) { btn.disabled = false; btn.textContent = 'Force Clear'; }
        }
    });
}


/**
 * Show an inline call mode selector (browser vs phone bridge).
 * Returns 'browser' | 'bridge' | null (cancelled).
 */
function _showCallModeSelector(leadName, phone) {

    return new Promise((resolve) => {
        // Remove any existing selector
        document.getElementById('call-mode-selector')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'call-mode-selector';
        overlay.innerHTML = `
            <div class="cms-backdrop"></div>
            <div class="cms-card">
                <div class="cms-header">
                    <span class="cms-icon">📞</span>
                    <div>
                        <div class="cms-title">Call ${_escHtml(leadName)}</div>
                        <div class="cms-phone">${_escHtml(phone)}</div>
                    </div>
                </div>
                <div class="cms-label">Choose how to connect:</div>
                <div class="cms-options">
                    <button class="cms-option" data-mode="bridge">
                        <span class="cms-opt-icon">📱</span>
                        <div class="cms-opt-text">
                            <strong>Phone Bridge</strong>
                            <small>Rings your phone, then connects to the lead</small>
                        </div>
                    </button>
                    <button class="cms-option" data-mode="browser">
                        <span class="cms-opt-icon">🎧</span>
                        <div class="cms-opt-text">
                            <strong>Browser Call</strong>
                            <small>Use your browser microphone & speakers</small>
                        </div>
                    </button>
                </div>
                <button class="cms-cancel">Cancel</button>
            </div>
        `;
        document.body.appendChild(overlay);

        // Animate in
        requestAnimationFrame(() => overlay.classList.add('cms-visible'));

        // Bind handlers
        const cleanup = (result) => {
            overlay.classList.remove('cms-visible');
            setTimeout(() => overlay.remove(), 200);
            resolve(result);
        };

        overlay.querySelector('.cms-backdrop').addEventListener('click', () => cleanup(null));
        overlay.querySelector('.cms-cancel').addEventListener('click', () => cleanup(null));
        overlay.querySelectorAll('.cms-option').forEach(btn => {
            btn.addEventListener('click', () => cleanup(btn.dataset.mode));
        });
    });
}

function _escHtml(str) {
    const el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Fetch dialer config at startup (store promise to await later)
const _dialerConfigPromise = fetchDialerStatus().then(conf => {
    _dialerConfig = conf;
    window._dialerConfig = conf;

    // BUG-04: Show manual dial button if dialer is active
    const manualDialBtn = document.getElementById('manual-dial-btn');
    if (manualDialBtn && conf.active && conf.has_credentials && conf.provider !== 'none') {
        const _accentColor = (conf.provider || '').toLowerCase() === 'aircall' ? '#00b388' : '#4f46e5';
        manualDialBtn.style.display = 'inline-flex';
        manualDialBtn.style.background = _accentColor;
        manualDialBtn.style.borderColor = _accentColor;
        manualDialBtn.addEventListener('click', () => {
            // v6.2.0: Route all manual dial through showManualDialWidget().
            // For RCM, that function calls RCMWidget.openForManualDial()
            // internally AND attaches the .then() handler that POSTs /api/calls/start.
            // Calling openForManualDial() directly here dropped the Promise result,
            // so the call never went through our backend — calls/start was never hit.
            showManualDialWidget();
        });

    }

    return conf;
}).catch(() => {});

initModals(loadView, () => currentView, () => []);

// ── RCM Messaging Widget ───────────────────────────────────────────────
// Initialize the floating WhatsApp/SMS widget if RCM messaging is enabled.
// RCMWidget is a UMD global loaded via <script src="js/rcm_widget.js">.
// GUARD: Skip init for SDRs whose resolved dialer provider is 'aircall' — the
// RCM SDK floating button conflicts with the Aircall call flow and causes
// confusion (Monisha bug: widget FAB visible even when provider override = aircall).
try {
    // Await dialer status — already fetched at startup, this resolves instantly
    let _resolvedProvider = 'none';
    try { const _ds = await _dialerConfigPromise; _resolvedProvider = (_ds?.provider || 'none').toLowerCase(); } catch {}

    const _aircallUser    = _resolvedProvider === 'aircall';
    const _rcmUser = _resolvedProvider === 'rcm';

    // Only init the widget if:
    //  • SDR's resolved provider is RCM (not Aircall, not none)
    //  • SDR has valid credentials (has_credentials=true from /api/dialer/status)
    // Note: _dialerConfig.active already encodes the live DB dialer_enabled check performed
    // by get_provider_for_user() on every /api/dialer/status call — no JWT flag needed here.
    if (_rcmUser && _dialerConfig.has_credentials && !_aircallUser) {
        if (typeof RCMWidget !== 'undefined') {
            RCMWidget.init({
                apiBase:  API_BASE,
                senderId: _dialerConfig.sender_id || '',
                theme:    'dark',   // dark glassmorphism — light theme CSS incomplete (white-on-white)
            });
            _rcmWidgetReady = true;
            window._rcmWidgetReady = true;

            // ── Bridge window.rcmDialer → RCMDialer ────────────────────
            // rcm_widget.js uses window.rcmDialer.isActive() in its
            // _activeSyncTimer safety net (line ~1239). Without this bridge, the timer
            // always sees isActive()=undefined, waits 10 s, then calls _renderCallIdle()
            // → "Ready to call" appears mid-call AND _pendingModeResolve is cleared,
            // blocking every subsequent call attempt in the same session.
            window.rcmDialer = window.RCMDialer;

            console.info('[RCMWidget] Initialised — provider=rcm, senderId set');

            // ── T4D: Caller ID startup warning ─────────────────────────────────────
            // If the SDR has no personal caller ID AND the global from_number is not
            // set, leads will see a RCM default number. Warn once per session.
            if (!_dialerConfig.from_number && !sessionStorage.getItem('_cwCallerIdWarnShown')) {
                sessionStorage.setItem('_cwCallerIdWarnShown', '1');
                setTimeout(() => {
                    showToast(
                        '⚠️ No caller ID set — leads may see an unknown number. ' +
                        'Set it in SDR Settings → Dialer.',
                        'warning', 9000
                    );
                }, 2000); // slight delay so it doesn\'t compete with page-load toasts
            }

            // ── T3: Page-load call recovery ────────────────────────────────────────
            // Non-blocking: check if the SDR has an active call in the DB (ghost call).
            // If yes and widget is IDLE (page was reloaded mid-call), restore the widget.
            getMyActiveCall().then(activeCallData => {
                if (activeCallData?.active && !window.RCMDialer?.isActive?.()) {
                    console.info('[App] Recovering mid-call state from DB:', activeCallData.call_id);
                    window.RCMDialer?.recoverFromActiveCall?.(activeCallData);
                }
            }).catch(() => {}); // non-fatal — page loads normally

            // NOTE (SS1 revisited): The original SS1 fix tried to suppress a
            // "third-party RCM SDK FAB", but RCMWidget is our own
            // custom component — #rcm-widget-root and .cw-fab are OUR
            // elements. Suppressing them hides the entire widget. Removed.
        }
    } else if (_aircallUser) {
        console.info('[RCMWidget] Init skipped — user is on Aircall provider');
    } else {
        console.info('[RCMWidget] Init skipped — provider:', _resolvedProvider);
    }
} catch (_e) { console.warn('[RCMWidget] Init skipped:', _e.message); }

// ── Dialer Outcome Gate ────────────────────────────────────────────────────────
// Ensures SDRs always log an outcome after a dialer-assisted call.
// Works across page refreshes via localStorage persistence.

const _OUTCOME_KEY  = 'ls_pending_outcome';  // localStorage key
const _BANNER_ID    = 'outcome-gate-banner';
let   _aircallPollInterval = null;

/** Persist a pending outcome to localStorage. */
function _setPendingOutcome(data) {
    localStorage.setItem(_OUTCOME_KEY, JSON.stringify({ ...data, timestamp: Date.now() }));
}

/** Clear a pending outcome from localStorage. */
function _clearPendingOutcome() {
    localStorage.removeItem(_OUTCOME_KEY);
    _removeStickyBanner();
    if (_aircallPollInterval) {
        clearInterval(_aircallPollInterval);
        _aircallPollInterval = null;
    }
}

/** Read pending outcome from localStorage. Returns null if none. */
function _getPendingOutcome() {
    try {
        const raw = localStorage.getItem(_OUTCOME_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

/** Show/refresh the sticky "You haven't logged the outcome" banner. */
function _showStickyBanner(pending) {
    _removeStickyBanner();  // avoid duplicates
    const banner = document.createElement('div');
    banner.id = _BANNER_ID;
    banner.innerHTML = `
        <div style="
            position:fixed;top:0;left:0;right:0;z-index:9999;
            background:linear-gradient(135deg,#dc2626,#b91c1c);
            color:#fff;padding:10px 20px;
            display:flex;align-items:center;justify-content:space-between;
            font-size:0.85rem;font-weight:600;box-shadow:0 4px 20px rgba(220,38,38,0.4);
            animation:slideDown 0.3s ease;
        ">
            <span>📞 Call ended — please log the outcome for <strong>${_escHtml(pending.leadName)}</strong></span>
            <button id="outcome-banner-log-btn" style="
                padding:6px 16px;border-radius:8px;border:none;
                background:rgba(255,255,255,0.15);color:#fff;
                cursor:pointer;font-size:0.82rem;font-weight:700;
                margin-left:16px;flex-shrink:0;
            ">Log Outcome</button>
        </div>
    `;
    document.body.prepend(banner);
    document.getElementById('outcome-banner-log-btn')?.addEventListener('click', () => {
        _openPendingOutcomeModal();
    });
}

function _removeStickyBanner() {
    document.getElementById(_BANNER_ID)?.remove();
}

/** Open the outcome modal for the current pending call. */
async function _openPendingOutcomeModal() {
    const pending = _getPendingOutcome();
    if (!pending) { _clearPendingOutcome(); return; }
    // Fetch fresh lead data for the modal, then open with the dialer_call_id so the backend
    // can attach the outcome to the exact DialerCall record (prevents duplicate entries).
    try {
        const lead = { call_attempt_count: 0 };  // minimal fallback
        openCallModal(pending.leadId, pending.leadName, pending.phone || '', lead, pending.callId || null, pending.callId ? (_dialerConfig.provider || null) : null);
    } catch { /* still open with minimal data */ }
}

/**
 * Called when the SDR dismisses the outcome modal without logging.
 * Adds an automatic comment to the lead and clears the pending state.
 */
async function _handleOutcomeDismissed() {
    const pending = _getPendingOutcome();
    if (!pending) return;
    _clearPendingOutcome();
    // Power Dialer hook — same event as modals.js's Save/auto-sync paths, so
    // a queue re-enables "Call Next" on dismiss too, not just a logged outcome.
    window.dispatchEvent(new CustomEvent('rcm:call-outcome-resolved',
        { detail: { leadId: pending.leadId, outcome: null, resolved: 'dismissed' } }));
    try {
        const ts = new Date().toLocaleString();
        await addLeadNote(
            pending.leadId,
            `⚠️ Call outcome not logged by SDR (${ts}). Call was made via dialer.`,
            'System'
        );
        showToast('Outcome skipped — auto-comment added to lead.', 'warning', 4000);
    } catch { /* non-critical */ }
}

/**
 * Fired whenever a dialer call ends (RCM widget event or Aircall poll).
 * Saves to localStorage + shows the sticky banner + opens the modal.
 * @param {string} leadId
 * @param {string} leadName
 * @param {string} phone
 * @param {string|null} callId - DB UUID of the DialerCall record (for exact outcome attachment)
 */
function _onDialerCallEnded(leadId, leadName, phone, callId = null) {
    if (!leadId) return;
    _setPendingOutcome({ leadId, leadName, phone, callId });
    _showStickyBanner({ leadId, leadName, phone });
    // Open the modal immediately
    _openPendingOutcomeModal();
}

/**
 * Start polling Aircall call status every 10 s.
 * Stops when the call reaches a terminal state and fires _onDialerCallEnded.
 */
function _startAircallOutcomePolling(callId, leadId, leadName, phone) {
    // Terminal statuses from aircall_provider.py webhook mapping
    const TERMINAL = new Set(['ended', 'done', 'CALL_ENDED', 'disconnected', 'missed',
                              'failed', 'cancelled', 'busy', 'unanswered', 'CALL_MISSED']);
    const MAX_POLLS = 60;  // 60 × 10 s = 10 min timeout
    let polls = 0;

    if (_aircallPollInterval) clearInterval(_aircallPollInterval);

    _aircallPollInterval = setInterval(async () => {
        polls++;
        if (polls > MAX_POLLS) {
            // Timeout: open modal anyway so SDR isn't stuck without a prompt
            clearInterval(_aircallPollInterval);
            _aircallPollInterval = null;
            _onDialerCallEnded(leadId, leadName, phone, callId);
            return;
        }
        try {
            const data = await getCallStatus(callId);
            // Terminal if: status string matches, OR ended_at is set (webhook fired)
            const isTerminal = TERMINAL.has(data?.status) || !!data?.ended_at;
            if (isTerminal) {
                clearInterval(_aircallPollInterval);
                _aircallPollInterval = null;
                _onDialerCallEnded(leadId, leadName, phone, callId);
            }
        } catch { /* polling errors are non-fatal */ }
    }, 10_000);
}

// ── Wire up the 'call-ended' CustomEvent from the dialer widget ───────────────
// The widget fires window.dispatchEvent(new CustomEvent('rcm:call-ended', { detail: ... }))
// whenever a RCM call ends (via status poll or manual hangup).
window.addEventListener('rcm:call-ended', (ev) => {
    const state = ev.detail || {};
    // Guard: if a modal is already open don't re-open
    const existingModal = document.getElementById('call-log-modal');
    if (existingModal?.style?.display === 'flex') return;
    // leadId comes from localStorage (set at call start); leadName/phone from the event payload.
    // callId (our DB UUID) is stored in pending state from when the call was initiated.
    const pending  = _getPendingOutcome();
    const leadId   = pending?.leadId   || state.leadId;
    const leadName = pending?.leadName || state.leadName || 'Unknown';
    const phone    = pending?.phone    || state.phone    || '';
    const callId   = pending?.callId   || state.callId   || null;
    if (!leadId) return;  // no lead context — skip
    _onDialerCallEnded(leadId, leadName, phone, callId);
});

// ── Page-load recovery: restore pending outcome banner after refresh ───────────
(function _recoverPendingOutcome() {
    const pending = _getPendingOutcome();
    if (!pending) return;

    const age = Date.now() - (pending.timestamp || 0);
    const MAX_AGE = 24 * 60 * 60 * 1000;  // 24 hours

    if (age > MAX_AGE) {
        // Auto-expire stale pending outcomes
        _handleOutcomeDismissed();
        return;
    }

    // Show the sticky banner so the SDR is reminded
    _showStickyBanner(pending);
    showToast('📞 You have an unlogged call outcome. Tap the banner to complete it.', 'warning', 6000);
})();

// ── Expose dismiss handler so modals.js can call it on close ─────────────────
window._onCallModalDismissed = _handleOutcomeDismissed;
window._clearPendingOutcome  = _clearPendingOutcome;
window._setPendingOutcome    = _setPendingOutcome;
window._startAircallOutcomePolling = _startAircallOutcomePolling;
// BUG-3 FIX: Expose mode selector globally so dialer_widget.js (Manual Dial button)
// routes through the same unified "Phone Bridge / Browser Call" modal as lead 📞 buttons.
window._showCallModeSelector = _showCallModeSelector;
window._refreshDialerConfig  = _refreshDialerConfig;

async function _refreshDialerConfig() {
    try {
        const conf = await fetchDialerStatus();
        _dialerConfig = conf;
        window._dialerConfig = conf;

        const manualDialBtn = document.getElementById('manual-dial-btn');
        if (manualDialBtn) {
            if (conf.active && conf.has_credentials && conf.provider !== 'none') {
                const _accentColor = (conf.provider || '').toLowerCase() === 'aircall' ? '#00b388' : '#4f46e5';
                manualDialBtn.style.display = 'inline-flex';
                manualDialBtn.style.background = _accentColor;
                manualDialBtn.style.borderColor = _accentColor;
            } else {
                manualDialBtn.style.display = 'none';
            }
        }
        
        // Hide RCM widget FAB if dialer is now disabled
        if (!conf.active || conf.provider !== 'rcm') {
            const fab = document.querySelector('.cw-fab');
            if (fab) fab.style.display = 'none';
            const widgetRoot = document.getElementById('rcm-widget-root');
            if (widgetRoot) widgetRoot.style.display = 'none';
        } else {
            const fab = document.querySelector('.cw-fab');
            if (fab) fab.style.display = 'flex';
            const widgetRoot = document.getElementById('rcm-widget-root');
            if (widgetRoot) widgetRoot.style.display = 'block';
        }
    } catch (e) {
        console.error('Failed to refresh dialer config:', e);
    }
}

// Global hook for lead_detail.js to open the messaging widget for a specific lead.
// Guard uses _rcmWidgetReady — NOT typeof RCMWidget, which is always defined
// because the UMD script is always loaded regardless of whether init() ran.
window._openMessagingWidget = (leadId, leadName, phone, lead = {}) => {
    if (!_rcmWidgetReady) {
        showToast('Messaging is not available for your account configuration. Contact your admin.', 'warning', 4000);
        return;
    }
    RCMWidget.openForLead({ leadId, leadName, phone, lead });
};

// Parse hash to restore view on page refresh / initial load
function _parseHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return { view: 'dashboard', extra: null };
    const parts = raw.split('/');
    return { view: parts[0], extra: parts.slice(1).join('/') || null };
}

// Listen for back/forward navigation
window.addEventListener('hashchange', () => {
    // EC-15b: skip if this hashchange was triggered by loadView itself setting the hash
    if (_skipHashUpdate) return;
    const { view, extra } = _parseHash();
    if (view !== currentView || extra !== currentExtra) {
        _skipHashUpdate = true;
        loadView(view, extra).finally(() => { _skipHashUpdate = false; });
    }
});

try {
    const { view: initView, extra: initExtra } = _parseHash();
    await loadView(initView, initExtra);
    // Flush any errors that were queued before the token was available
    flushPendingErrors().catch(() => {});
} catch (err) {
    console.error('Boot Error:', err);

    // Check if this is a cold-start / 503 error
    const isColdStart = err.message?.includes('503') ||
                        err.message?.includes('Failed to fetch') ||
                        err.message?.includes('NetworkError') ||
                        err.message?.includes('Load failed');

    if (isColdStart) {
        // ── Cold Start Recovery Overlay ──────────────────────────────────
        vc.innerHTML = `
            <div id="cold-start-overlay" style="padding:80px 40px;text-align:center;max-width:480px;margin:0 auto;">
                <div style="font-size:3rem;margin-bottom:16px;">✨</div>
                <h2 style="font-size:1.3rem;font-weight:700;color:#18181b;margin:0 0 8px;">RCM is waking up...</h2>
                <p style="font-size:0.88rem;color:#71717a;margin:0 0 24px;line-height:1.5;">
                    Our server fell asleep due to inactivity.<br>It's booting up now — this usually takes 20–40 seconds.
                </p>
                <div style="width:100%;max-width:320px;height:6px;background:#e4e4e7;border-radius:3px;margin:0 auto 16px;overflow:hidden;">
                    <div id="cold-start-bar" style="width:5%;height:100%;background:linear-gradient(90deg,#6366f1,#a855f7);border-radius:3px;transition:width 0.4s ease;"></div>
                </div>
                <div id="cold-start-status" style="font-size:0.78rem;color:#a1a1aa;">Checking server status...</div>
                <div style="margin-top:28px;padding:14px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;font-size:0.75rem;color:#6d28d9;">
                    💡 <strong>Tip:</strong> This only happens after the server has been idle. Once active, it stays fast.
                </div>
            </div>`;

        const bar = document.getElementById('cold-start-bar');
        const statusEl = document.getElementById('cold-start-status');
        let attempt = 0;
        const maxAttempts = 20;  // 20 × 3s = 60s max wait

        const checkHealth = setInterval(async () => {
            attempt++;
            const pct = Math.min(5 + (attempt / maxAttempts) * 90, 95);
            if (bar) bar.style.width = pct + '%';
            if (statusEl) statusEl.textContent = `Attempt ${attempt}/${maxAttempts} — pinging server...`;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const resp = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (resp.ok || resp.status === 404) {
                    // Server is up (404 fine — it just means /api/health doesn't exist as a route)
                    clearInterval(checkHealth);
                    if (bar) bar.style.width = '100%';
                    if (statusEl) {
                        statusEl.textContent = '✅ Server is ready! Loading...';
                        statusEl.style.color = '#059669';
                    }
                    setTimeout(() => location.reload(), 500);
                }
            } catch (e) {
                // Still waking up
                if (attempt >= maxAttempts) {
                    clearInterval(checkHealth);
                    if (statusEl) {
                        statusEl.innerHTML = '⚠️ Taking longer than usual. <a href="#" onclick="location.reload()" style="color:#6366f1;font-weight:600;">Retry manually</a>';
                    }
                }
            }
        }, 3000);
    } else {
        // Non-cold-start error — show standard error page
        vc.innerHTML = `
            <div style="padding:40px;text-align:center;color:#ef4444;">
                <h3>⚠️ Loading Error</h3>
                <p style="font-size:0.9rem;margin-top:8px;">${err.message}</p>
                <button class="btn btn-outline" onclick="location.reload()" style="margin-top:20px;">Retry</button>
            </div>`;
    }
}
